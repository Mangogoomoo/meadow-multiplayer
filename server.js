// Meadow Multiplayer - authoritative movement, monsters, combat and levels.
// Player progress persists in the browser (localStorage), not on this ephemeral server.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=Number(process.env.PORT)||3000,ROOT=path.join(__dirname,'public');
// A deploy changes this fingerprint when any game/server source changes.
const GAME_VERSION=crypto.createHash('sha256')
  .update(fs.readFileSync(__filename))
  .update(fs.readFileSync(path.join(ROOT,'game.js')))
  .update(fs.readFileSync(path.join(ROOT,'index.html')))
  .digest('hex').slice(0,16);
const TILE=32,COLS=60,ROWS=40,SPEED=175,RUN_SPEED=285,MAX_ENERGY=100,MAX_LEVEL=50;
const players=new Map(),monsters=new Map(),projectiles=new Map();
const chatHistory=[];
const SPIN_DURATION=3000,SPIN_COOLDOWN=11000,SPIN_TICK=220;
const LEAP_RANGE=230, LEAP_DURATION=520, LEAP_COOLDOWN=9000, LEAP_STUN=2000, LEAP_RADIUS=100;
function hash(x,y,seed=12345){let n=Math.imul(x+seed,374761393)+Math.imul(y-seed,668265263);n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
function tileAt(x,y){if(x<0||y<0||x>=COLS||y>=ROWS)return'wall';const pond=((x-43)/9)**2+((y-13)/7)**2;if(pond<1+(hash(x,y,44)-.5)*.27)return'water';if(x>42&&y>23&&Math.abs(x-(47+Math.sin(y*.42)*3))<1.4)return'water';const safe=Math.abs(x-15)<6&&Math.abs(y-18)<6;if(!safe&&hash(x,y,91)>.887&&hash(x+1,y,55)>.24)return'tree';return'grass';}
function collides(x,y,r=10){for(const cx of[x-r,x+r])for(const cy of[y-r,y+r])if(tileAt(Math.floor(cx/TILE),Math.floor(cy/TILE))!=='grass')return true;return false;}
function spawn(){for(let i=0;i<150;i++){const x=(12+Math.floor(Math.random()*7))*TILE+16,y=(15+Math.floor(Math.random()*7))*TILE+16;if(!collides(x,y))return{x,y};}return{x:496,y:592};}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const STAT_NAMES=['STR','AGI','VIT','INT','DEX','LUK'];
const statCost=n=>1+Math.floor(n/10); // 1-10 cost 1; 11-20 cost 2, ... 41-50 cost 5
function spentStats(stats){return STAT_NAMES.reduce((sum,key)=>{let n=stats[key]||0;for(let i=0;i<n;i++)sum+=statCost(i);return sum;},0);}
const totalPoints=level=>(level-1)*5;
const maxHP=p=>5+(p.level-1)*1.5+p.stats.VIT*2;
const slashCooldown=p=>Math.max(135,400-p.stats.AGI*5);
const hitRating=p=>4+p.stats.DEX*2;
const critChance=p=>Math.min(.55,.05+p.stats.LUK*.01);
const critMultiplier=p=>1.5+p.stats.LUK*.025;
const attackDamage=p=>1+(p.level-1)*0.18+p.stats.STR*.35;
const expNeeded=level=>Math.round(10+level*6+level*level*1.3);
function cleanName(n){return typeof n==='string'?(n.replace(/[\x00-\x1f\x7f<>]/g,'').trim().slice(0,18)||'Adventurer'):'Adventurer';}
function broadcast(o){const s=JSON.stringify(o);for(const p of players.values())if(p.ws.readyState===WebSocket.OPEN)p.ws.send(s);}
function playerView(p){return{id:p.id,x:+p.x.toFixed(1),y:+p.y.toFixed(1),dir:p.dir,color:p.color,name:p.name,level:p.level,exp:p.exp,hp:+p.hp.toFixed(2),maxHp:maxHP(p),stats:p.stats,statPoints:totalPoints(p.level)-spentStats(p.stats),spinAt:p.spinAt,spinCooldownUntil:p.spinCooldownUntil,leapAt:p.leapAt,leapCooldownUntil:p.leapCooldownUntil,hitRating:hitRating(p),magicAttack:1+p.stats.INT*.35,attacking:p.attacking,attackAt:p.attackAt,attackAngle:p.attackAngle,jumpAt:p.jumpAt,invulnerableUntil:p.invulnerableUntil,energy:+p.energy.toFixed(1),maxEnergy:MAX_ENERGY};}
function monsterView(m){return{id:m.id,type:m.type,x:+m.x.toFixed(1),y:+m.y.toFixed(1),hp:+m.hp.toFixed(2),maxHp:m.maxHp,dir:m.dir,attackAt:m.attackAt,chargeUntil:m.chargeUntil,stunnedUntil:m.stunnedUntil,alive:m.alive};}
const server=http.createServer((req,res)=>{let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end('Bad request');}const target=path.resolve(ROOT,'.'+(pathname==='/'?'/index.html':pathname));if(target!==ROOT&&!target.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('Forbidden');}fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}const ext=path.extname(target);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[ext]||'application/octet-stream','Cache-Control':'no-store, max-age=0','Pragma':'no-cache','Expires':'0','X-Content-Type-Options':'nosniff'});res.end(data);});});
function addMonster(type,index){const cx=type==='rat'?10+(index*9)%37:17+(index*11)%35,cy=type==='rat'?8+(index*7)%24:7+(index*9)%26;let point=null;for(let j=0;j<90;j++){const x=clamp(cx+(j%11)-5,2,COLS-3)*TILE+16,y=clamp(cy+Math.floor(j/11)-4,2,ROWS-3)*TILE+16;if(!collides(x,y,12)&&Math.hypot(x-496,y-592)>135){point={x,y};break;}}if(!point)point=spawn();const id=type+'-'+index;monsters.set(id,{id,type,x:point.x,y:point.y,homeX:point.x,homeY:point.y,dir:'down',hp:type==='rat'?3:2.5,maxHp:type==='rat'?3:2.5,alive:true,respawnAt:0,nextAttack:0,attackAt:0,chargeUntil:0,vx:0,vy:0,wander:Math.random()*6,hitCooldown:new Map(),knockX:0,knockY:0,stunnedUntil:0});}
for(let i=0;i<10;i++){addMonster('rat',i);addMonster('bat',i);}
function knock(entity,vx,vy){entity.knockX=(entity.knockX||0)+vx;entity.knockY=(entity.knockY||0)+vy;}
function showDamage(x,y,amount,kind,now,angle=null){broadcast({type:'damage_fx',x:+x.toFixed(1),y:+y.toFixed(1),amount:+amount.toFixed(1),kind,at:now,angle:Number.isFinite(angle)?+angle.toFixed(3):null});}
function applyDamage(p,amount,now,sourceX=p.x,sourceY=p.y){if(p.hp<=0||now<p.invulnerableUntil||(p.leapAt&&now-p.leapAt<LEAP_DURATION))return;p.hp=Math.max(0,Math.round((p.hp-amount)*100)/100);p.invulnerableUntil=now+650;const a=Math.atan2(p.y-sourceY,p.x-sourceX);knock(p,Math.cos(a)*230,Math.sin(a)*230);showDamage(p.x,p.y,amount,'player',now,a);if(p.hp<=0){const at=spawn();p.x=at.x;p.y=at.y;p.hp=maxHP(p);p.invulnerableUntil=now+1800;broadcast({type:'message',text:`${p.name} was knocked out and respawned!`});}}
function awardExp(p,amount){if(p.level===MAX_LEVEL)return;p.exp+=amount;while(p.level<MAX_LEVEL&&p.exp>=expNeeded(p.level)){p.exp-=expNeeded(p.level);p.level++;p.hp=Math.min(maxHP(p),p.hp+1.5);broadcast({type:'message',text:`${p.name} reached level ${p.level}!`});}if(p.level===MAX_LEVEL)p.exp=0;}
function performSlash(p,now,angle){if(now-p.lastSlash<slashCooldown(p)||p.hp<=0||(p.spinAt&&now-p.spinAt<SPIN_DURATION))return false;
p.lastSlash=now;p.attacking=true;p.attackAt=now;p.attackAngle=angle;
const ux=Math.cos(angle),uy=Math.sin(angle);
for(const m of monsters.values()){if(!m.alive)continue;
 const dx=m.x-p.x,dy=m.y-p.y,forward=dx*ux+dy*uy,side=Math.abs(dx*uy-dy*ux);
 if(forward>0&&forward<72&&side<34){
  // A high hit requirement can cause misses. DEX raises accuracy.
  const requirement=m.type==='bat'?12:6;
  const chance=Math.min(.98,hitRating(p)>=requirement?.95:.55+hitRating(p)/requirement*.35);
  if(Math.random()>chance){showDamage(m.x,m.y,0,'miss',now,angle);if(p.ws.readyState===1)p.ws.send(JSON.stringify({type:'message',text:'Miss! Increase DEX to improve accuracy.'}));continue;}
  const crit=Math.random()<critChance(p),damage=attackDamage(p)*(crit?critMultiplier(p):1);
  m.hp=Math.max(0,m.hp-damage);knock(m,ux*270,uy*270);showDamage(m.x,m.y,damage,crit?'crit':'monster',now,angle);
  if(crit&&p.ws.readyState===1)p.ws.send(JSON.stringify({type:'message',text:'Critical hit!'}));
  if(m.hp<=0){m.alive=false;m.respawnAt=now+6000;awardExp(p,m.type==='rat'?6:8);broadcast({type:'message',text:`${p.name} defeated a ${m.type} (+${m.type==='rat'?6:8} EXP)`});}
 }
}
return true;
}
const wss=new WebSocketServer({server,maxPayload:4096});
wss.on('connection',ws=>{const id=crypto.randomUUID(),point=spawn(),now=Date.now();const p={id,ws,x:point.x,y:point.y,dir:'down',color:Math.floor(Math.random()*6),name:'Adventurer',level:1,exp:0,hp:5,inputX:0,inputY:0,lastInput:now,lastSlash:0,attacking:false,attackAt:0,jumpAt:0,lastJump:0,invulnerableUntil:0,attackAngle:Math.PI/2,energy:MAX_ENERGY,running:false,knockX:0,knockY:0,stats:Object.fromEntries(STAT_NAMES.map(k=>[k,0])),initialized:false,spinAt:0,spinCooldownUntil:0,spinHitAt:0,leapAt:0,leapCooldownUntil:0,leapX:0,leapY:0,lastStatAt:0,chatAt:0};players.set(id,p);
ws.send(JSON.stringify({type:'welcome',version:GAME_VERSION,id,world:{cols:COLS,rows:ROWS,tile:TILE},players:[...players.values()].map(playerView),monsters:[...monsters.values()].map(monsterView),maxLevel:MAX_LEVEL,chat:chatHistory}));
ws.on('message',raw=>{let msg;try{msg=JSON.parse(raw.toString());}catch{return;}if(!msg||typeof msg!=='object')return;
if(msg.type==='init'&&!p.initialized){p.initialized=true;const data=msg.save||{};p.name=cleanName(data.name);const level=Number(data.level);p.level=Number.isInteger(level)?clamp(level,1,MAX_LEVEL):1;const exp=Number(data.exp);p.exp=p.level===MAX_LEVEL?0:clamp(Number.isFinite(exp)?exp:0,0,expNeeded(p.level)-1);const hp=Number(data.hp);// Reject invalid allocations and saves claiming more stat points than the level earned.
 const savedStats=data.stats||{};
 const candidate=Object.fromEntries(STAT_NAMES.map(k=>[k,Number.isInteger(savedStats[k])?clamp(savedStats[k],0,50):0]));
 if(spentStats(candidate)<=totalPoints(p.level))p.stats=candidate;
 p.hp=Number.isFinite(hp)?clamp(hp,0.5,maxHP(p)):maxHP(p);const x=Number(data.x),y=Number(data.y);if(Number.isFinite(x)&&Number.isFinite(y)&&!collides(x,y)&&x>10&&y>10){p.x=x;p.y=y;}broadcast({type:'join',player:playerView(p)});return;}
if(!p.initialized)return;
if(msg.type==='name'){p.name=cleanName(msg.name);broadcast({type:'join',player:playerView(p)});}
else if(msg.type==='stat'){const statNow=Date.now();if(statNow-p.lastStatAt<65)return;p.lastStatAt=statNow;const key=String(msg.stat||'').toUpperCase();if(STAT_NAMES.includes(key)&&p.stats[key]<50){const cost=statCost(p.stats[key]);if(totalPoints(p.level)-spentStats(p.stats)>=cost){const oldMax=maxHP(p);p.stats[key]++;if(key==='VIT')p.hp+=maxHP(p)-oldMax;}}}
else if(msg.type==='reset_stats'){
 if(spentStats(p.stats)===0)return;
 const oldMax=maxHP(p),oldHp=p.hp;
 p.stats=Object.fromEntries(STAT_NAMES.map(k=>[k,0]));
 p.hp=Math.min(maxHP(p),Math.max(.5,oldHp*maxHP(p)/Math.max(1,oldMax)));
 if(ws.readyState===1)ws.send(JSON.stringify({type:'message',text:'Stats reset. All spent points returned.'}));
}
else if(msg.type==='debug_level'){
 if(p.level>=MAX_LEVEL){if(ws.readyState===1)ws.send(JSON.stringify({type:'message',text:'Already at max level.'}));return;}
 p.level++;p.exp=0;p.hp=maxHP(p);
 broadcast({type:'message',text:`${p.name} debug-leveled to ${p.level}!`});
}
else if(msg.type==='chat'){
 const now=Date.now();if(now-p.chatAt<700)return;
 const text=typeof msg.text==='string'?msg.text.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,160):'';
 if(!text)return;p.chatAt=now;
 const item={name:p.name,text,time:now};chatHistory.push(item);if(chatHistory.length>30)chatHistory.shift();broadcast({type:'chat',item});
}
else if(msg.type==='spin'){
 const now=Date.now(),ok=now>=p.spinCooldownUntil&&p.hp>0;
 if(ok){p.spinAt=now;p.spinHitAt=0;p.spinCooldownUntil=now+SPIN_COOLDOWN;}
 if(ws.readyState===1)ws.send(JSON.stringify({type:'skill_ack',slot:1,ok,remaining:Math.max(0,p.spinCooldownUntil-now)}));
}
else if(msg.type==='leap'){
 const now=Date.now();let ok=now>=p.leapCooldownUntil&&p.hp>0&&!(p.leapAt&&now-p.leapAt<LEAP_DURATION);
 if(ok){const x=Number(msg.x),y=Number(msg.y);
  if(!Number.isFinite(x)||!Number.isFinite(y))ok=false;
  else {const dx=x-p.x,dy=y-p.y,dist=Math.hypot(dx,dy),scale=Math.min(1,LEAP_RANGE/Math.max(1,dist));
   const destX=clamp(p.x+dx*scale,16,COLS*TILE-16),destY=clamp(p.y+dy*scale,16,ROWS*TILE-16);
   // Land only on clear ground and never travel through blocked tiles.
   let landing=null;const count=Math.ceil(Math.hypot(destX-p.x,destY-p.y)/8);
   for(let i=1;i<=count;i++){const xx=p.x+(destX-p.x)*i/count,yy=p.y+(destY-p.y)*i/count;if(collides(xx,yy,12))break;landing={x:xx,y:yy};}
   if(!landing||Math.hypot(landing.x-p.x,landing.y-p.y)<12)ok=false;
   else{p.leapFromX=p.x;p.leapFromY=p.y;p.leapX=landing.x;p.leapY=landing.y;p.leapAt=now;p.leapCooldownUntil=now+LEAP_COOLDOWN;}
  }
 }
 if(ws.readyState===1)ws.send(JSON.stringify({type:'skill_ack',slot:2,ok,remaining:Math.max(0,p.leapCooldownUntil-now)}));
}
else if(msg.type==='input'){const ix=Number(msg.x),iy=Number(msg.y);if(!Number.isFinite(ix)||!Number.isFinite(iy))return;p.inputX=clamp(ix,-1,1);p.inputY=clamp(iy,-1,1);const length=Math.hypot(p.inputX,p.inputY);if(length>1){p.inputX/=length;p.inputY/=length;}p.running=msg.run===true;p.lastInput=Date.now();}
else if(msg.type==='jump'){
  const now=Date.now();const ok=now-p.lastJump>470;
  if(ok){p.lastJump=now;p.jumpAt=now;}
  if(ws.readyState===1)ws.send(JSON.stringify({type:'action_ack',action:'jump',ok,reason:ok?'':'cooldown'}));
}
else if(msg.type==='slash'){
  const now=Date.now();const ok=now-p.lastSlash>=slashCooldown(p)&&p.hp>0;
  const angle=Number(msg.angle);
  if(ok){const a=Number.isFinite(angle)?angle:Math.PI/2;p.attackAngle=Math.atan2(Math.sin(a),Math.cos(a));
  p.dir=Math.abs(Math.cos(a))>Math.abs(Math.sin(a))?(Math.cos(a)>0?'right':'left'):(Math.sin(a)>0?'down':'up');
  performSlash(p,now,p.attackAngle);}
  if(ws.readyState===1)ws.send(JSON.stringify({type:'action_ack',action:'slash',ok,reason:ok?'':p.hp<=0?'no HP':'cooldown'}));
}
});ws.on('close',()=>{players.delete(id);broadcast({type:'leave',id});});ws.on('error',()=>{});
});
let last=performance.now(),snapshot=0;
setInterval(()=>{const now=Date.now(),time=performance.now(),dt=Math.min((time-last)/1000,.05);last=time;
for(const p of players.values()){if(!p.initialized)continue;if(now-p.lastInput>1000){p.inputX=0;p.inputY=0;}if(p.leapAt&&now-p.leapAt>=LEAP_DURATION&&p.leapX){
  p.x=p.leapX;p.y=p.leapY;p.leapX=0;p.leapY=0;
  for(const m of monsters.values())if(m.alive&&Math.hypot(m.x-p.x,m.y-p.y)<=LEAP_RADIUS){m.stunnedUntil=now+LEAP_STUN;m.chargeUntil=0;m.vx=0;m.vy=0;}
  broadcast({type:'leap_impact',x:p.x,y:p.y,at:now});
 }
 const airborne=p.leapAt&&now-p.leapAt<LEAP_DURATION;
 if(airborne){const q=clamp((now-p.leapAt)/LEAP_DURATION,0,1);p.x=p.leapFromX+(p.leapX-p.leapFromX)*q;p.y=p.leapFromY+(p.leapY-p.leapFromY)*q;}
 const moving=!airborne&&Math.hypot(p.inputX,p.inputY)>.01;const sprint=moving&&p.running&&p.energy>.2;const speed=sprint?RUN_SPEED:SPEED;p.energy=clamp(p.energy+(sprint?-33:19)*dt,0,MAX_ENERGY);const dx=(airborne?0:(p.inputX*speed+p.knockX)*dt),dy=(airborne?0:(p.inputY*speed+p.knockY)*dt);p.knockX*=Math.exp(-dt*13);p.knockY*=Math.exp(-dt*13);if(dx||dy){if(Math.abs(dx)>Math.abs(dy))p.dir=dx>0?'right':'left';else p.dir=dy>0?'down':'up';if(!collides(p.x+dx,p.y))p.x+=dx;if(!collides(p.x,p.y+dy))p.y+=dy;}p.attacking=now-p.attackAt<240;
 if(p.spinAt&&now-p.spinAt<SPIN_DURATION&&now-p.spinHitAt>=SPIN_TICK){
  p.spinHitAt=now;
  for(const m of monsters.values()){
   if(!m.alive||Math.hypot(m.x-p.x,m.y-p.y)>92)continue;
   const requirement=m.type==='bat'?12:6;
   const chance=Math.min(.98,hitRating(p)>=requirement?.95:.55+hitRating(p)/requirement*.35);
   if(Math.random()>chance){showDamage(m.x,m.y,0,'miss',now,Math.atan2(m.y-p.y,m.x-p.x));continue;}
   const critical=Math.random()<critChance(p),damage=attackDamage(p)*.64*(critical?critMultiplier(p):1);
   const angle=Math.atan2(m.y-p.y,m.x-p.x);m.hp=Math.max(0,m.hp-damage);
   knock(m,Math.cos(angle)*190,Math.sin(angle)*190);showDamage(m.x,m.y,damage,critical?'crit':'monster',now,angle);
   if(m.hp<=0){m.alive=false;m.respawnAt=now+6000;awardExp(p,m.type==='rat'?6:8);broadcast({type:'message',text:`${p.name} defeated a ${m.type} (+${m.type==='rat'?6:8} EXP)`});}
  }
 }
 }
for(const m of monsters.values()){
if(m.alive&&(m.knockX||m.knockY)){const kx=m.knockX*dt,ky=m.knockY*dt;if(!collides(m.x+kx,m.y,11))m.x+=kx;if(!collides(m.x,m.y+ky,11))m.y+=ky;m.knockX*=Math.exp(-dt*11);m.knockY*=Math.exp(-dt*11);}
if(!m.alive){if(now>=m.respawnAt){m.alive=true;m.hp=m.maxHp;m.x=m.homeX;m.y=m.homeY;m.nextAttack=now+1000;}continue;}
if(now<m.stunnedUntil)continue;
let target=null,dist=Infinity;for(const p of players.values()){if(!p.initialized)continue;const d=Math.hypot(p.x-m.x,p.y-m.y);if(d<dist){dist=d;target=p;}}
if(target&&dist<260){const ux=(target.x-m.x)/Math.max(1,dist),uy=(target.y-m.y)/Math.max(1,dist);m.dir=Math.abs(ux)>Math.abs(uy)?(ux>0?'right':'left'):(uy>0?'down':'up');
if(m.type==='rat'){
if(now<m.chargeUntil){const dx=m.vx*dt,dy=m.vy*dt;if(!collides(m.x+dx,m.y,11))m.x+=dx;if(!collides(m.x,m.y+dy,11))m.y+=dy;if(Math.hypot(m.x-target.x,m.y-target.y)<24&&now-(m.hitCooldown.get(target.id)||0)>750){m.hitCooldown.set(target.id,now);applyDamage(target,.5+Math.random()*.5,now,m.x,m.y);}}
else if(dist<165&&now>m.nextAttack){m.vx=ux*300;m.vy=uy*300;m.chargeUntil=now+430;m.attackAt=now;m.nextAttack=now+2500;}
else if(dist>45){if(!collides(m.x+ux*30*dt,m.y,11))m.x+=ux*30*dt;if(!collides(m.x,m.y+uy*30*dt,11))m.y+=uy*30*dt;}
}else{if(dist<230&&now>m.nextAttack){const id=crypto.randomUUID();projectiles.set(id,{id,x:m.x,y:m.y,vx:ux*205,vy:uy*205,created:now});m.attackAt=now;m.nextAttack=now+2000;}if(dist<175&&dist>80){if(!collides(m.x+ux*35*dt,m.y,11))m.x+=ux*35*dt;if(!collides(m.x,m.y+uy*35*dt,11))m.y+=uy*35*dt;}}
}else{m.wander-=dt;if(m.wander<0){m.wander=2+Math.random()*3;m.vx=(Math.random()-.5)*24;m.vy=(Math.random()-.5)*24;}if(Math.hypot(m.x-m.homeX,m.y-m.homeY)>85){m.vx=(m.homeX-m.x)*.45;m.vy=(m.homeY-m.y)*.45;}if(!collides(m.x+m.vx*dt,m.y,11))m.x+=m.vx*dt;if(!collides(m.x,m.y+m.vy*dt,11))m.y+=m.vy*dt;}
}
for(const [id,b]of projectiles){b.x+=b.vx*dt;b.y+=b.vy*dt;if(now-b.created>2500||collides(b.x,b.y,3)){projectiles.delete(id);continue;}for(const p of players.values()){if(!p.initialized)continue;if(Math.hypot(p.x-b.x,p.y-b.y)<17){if(now-p.jumpAt<480&&now-p.jumpAt>0){projectiles.delete(id);break;}applyDamage(p,.5+Math.random()*.5,now,b.x-b.vx*.07,b.y-b.vy*.07);projectiles.delete(id);break;}}}
snapshot+=dt;if(snapshot>=.05){snapshot=0;broadcast({type:'state',serverNow:now,players:[...players.values()].filter(p=>p.initialized).map(playerView),monsters:[...monsters.values()].map(monsterView),projectiles:[...projectiles.values()].map(b=>({id:b.id,x:+b.x.toFixed(1),y:+b.y.toFixed(1)}))});}
},1000/60);
server.listen(PORT,'0.0.0.0',()=>console.log(`Meadow Multiplayer running on port ${PORT}`));
