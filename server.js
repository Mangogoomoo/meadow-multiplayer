const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=Number(process.env.PORT)||3000,ROOT=path.join(__dirname,'public');
const GAME_VERSION=crypto.createHash('sha256')
  .update(fs.readFileSync(__filename))
  .update(fs.readFileSync(path.join(ROOT,'game.js')))
  .update(fs.readFileSync(path.join(ROOT,'index.html')))
  .update(fs.readFileSync(path.join(ROOT,'assets','world.json')))
  .update(fs.readFileSync(path.join(ROOT,'assets','world.png')))
  .digest('hex').slice(0,16);

const TILE=32,COLS=120,ROWS=80,WIDTH=COLS*TILE,HEIGHT=ROWS*TILE;
const SPEED=178,RUN_SPEED=292,MAX_ENERGY=100,MAX_LEVEL=99;
const SPIN_DURATION=3000,SPIN_COOLDOWN=11000,SPIN_TICK=220;
const LEAP_RANGE=240, LEAP_DURATION=520, LEAP_COOLDOWN=9000, LEAP_STUN=2000, LEAP_RADIUS=104;
const players=new Map(),monsters=new Map(),projectiles=new Map();
const chatHistory=[];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const STAT_NAMES=['STR','AGI','VIT','INT','DEX','LUK'];
const statCost=n=>1+Math.floor(n/20);
const spentStats=stats=>STAT_NAMES.reduce((sum,key)=>{let n=stats[key]||0;for(let i=0;i<n;i++)sum+=statCost(i);return sum;},0);
const totalPoints=level=>(level-1)*5;
const maxHP=p=>5+(p.level-1)*1.5+p.stats.VIT*2;
const slashCooldown=p=>Math.max(135,400-p.stats.AGI*5);
const hitRating=p=>4+p.stats.DEX*2;
const critChance=p=>Math.min(.55,.05+p.stats.LUK*.01);
const critMultiplier=p=>1.5+p.stats.LUK*.025;
const attackDamage=p=>1+(p.level-1)*0.18+p.stats.STR*.35;
const expNeeded=level=>Math.round(10+level*6+level*level*1.3);
// Collision and scenery share exactly one authored world. Visual map PNG is rendered from this same data.
const WORLD_DATA=JSON.parse(fs.readFileSync(path.join(ROOT,'assets','world.json'),'utf8'));
const WORLD_GRID=WORLD_DATA.grid;
const WALL_TYPES=new Set([3,4,5]);
function tileAt(tx,ty){if(tx<0||ty<0||tx>=COLS||ty>=ROWS)return 4;return WORLD_GRID[ty][tx];}
function collides(x,y,r=10){for(const xx of[x-r,x+r])for(const yy of[y-r,y+r])if(WALL_TYPES.has(tileAt(Math.floor(xx/TILE),Math.floor(yy/TILE))))return true;return false;}
function cleanName(n){return typeof n==='string'?(n.replace(/[\x00-\x1f\x7f<>]/g,'').trim().slice(0,18)||'Adventurer'):'Adventurer';}
function broadcast(o){const str=JSON.stringify(o);for(const p of players.values())if(p.ws.readyState===WebSocket.OPEN)p.ws.send(str);}
function bossCenter(){return{x:WORLD_DATA.boss.x,y:WORLD_DATA.boss.y};}
function spawn(){const sp=WORLD_DATA.spawn;for(let i=0;i<200;i++){const x=sp.x+(Math.random()-.5)*280,y=sp.y+(Math.random()-.5)*240;if(!collides(x,y))return{x,y};}return{x:sp.x,y:sp.y};}
function randomMonsterSpawn(type){const spawnAt=WORLD_DATA.spawn,boss=bossCenter();for(let i=0;i<1400;i++){const x=(2+Math.floor(Math.random()*(COLS-4)))*TILE+16,y=(2+Math.floor(Math.random()*(ROWS-4)))*TILE+16;if(collides(x,y,12))continue;if(Math.hypot(x-spawnAt.x,y-spawnAt.y)<280)continue;if(Math.hypot(x-boss.x,y-boss.y)<290)continue;return{x,y};}return{x:spawnAt.x+300,y:spawnAt.y-200};}
function monsterBase(type){
  switch(type){
    case 'rat': return {name:'Rat',hp:7,exp:9,hitReq:10,knockResist:1,respawn:6000};
    case 'bat': return {name:'Bat',hp:6,exp:11,hitReq:14,knockResist:.85,respawn:6500};
    case 'baphomet': return {name:'Baphomet',hp:1800,exp:800,hitReq:28,knockResist:.18,respawn:60000};
    case 'baphometjr': return {name:'Baphomet.Jr',hp:95,exp:55,hitReq:18,knockResist:.45,respawn:0};
  }
}
function addMonster(type,index,point=null){const base=monsterBase(type); if(!point) point= type==='baphomet' ? bossCenter() : randomMonsterSpawn(type); const id=(type==='baphomet'?'boss':type)+'-'+index+'-'+Math.random().toString(36).slice(2,6); const boss=type==='baphomet'; monsters.set(id,{id,type,name:base.name,x:point.x,y:point.y,homeX:point.x,homeY:point.y,dir:'down',hp:base.hp,maxHp:base.hp,alive:true,respawnAt:0,nextAttack:0,attackAt:0,chargeUntil:0,vx:0,vy:0,wander:Math.random()*6,hitCooldown:new Map(),knockX:0,knockY:0,stunnedUntil:0,exp:base.exp,hitReq:base.hitReq,knockResist:base.knockResist,respawnMs:base.respawn,bossPhase:false,spawnedAdds:false,quake75:false,quake25:false,quakeStart:0,quakeX:0,quakeY:0,boss}); return id;}
for(let i=0;i<36;i++) addMonster('rat',i);
for(let i=0;i<32;i++) addMonster('bat',i);
addMonster('baphomet',1,bossCenter());
function playerView(p){return{id:p.id,x:+p.x.toFixed(1),y:+p.y.toFixed(1),dir:p.dir,color:p.color,name:p.name,level:p.level,exp:p.exp,hp:+p.hp.toFixed(2),maxHp:maxHP(p),stats:p.stats,statPoints:totalPoints(p.level)-spentStats(p.stats),spinAt:p.spinAt,spinCooldownUntil:p.spinCooldownUntil,leapAt:p.leapAt,leapCooldownUntil:p.leapCooldownUntil,hitRating:hitRating(p),magicAttack:1+p.stats.INT*.35,attacking:p.attacking,attackAt:p.attackAt,attackAngle:p.attackAngle,jumpAt:p.jumpAt,invulnerableUntil:p.invulnerableUntil,energy:+p.energy.toFixed(1),maxEnergy:MAX_ENERGY};}
function monsterView(m){return{id:m.id,type:m.type,name:m.name,x:+m.x.toFixed(1),y:+m.y.toFixed(1),hp:+m.hp.toFixed(2),maxHp:m.maxHp,dir:m.dir,attackAt:m.attackAt,chargeUntil:m.chargeUntil,stunnedUntil:m.stunnedUntil,alive:m.alive,boss:m.boss,quakeStart:m.quakeStart||0,quakeX:m.quakeX||0,quakeY:m.quakeY||0};}
function awardExp(p,amount){if(p.level===MAX_LEVEL)return; p.exp+=amount; while(p.level<MAX_LEVEL&&p.exp>=expNeeded(p.level)){p.exp-=expNeeded(p.level);p.level++;p.hp=Math.min(maxHP(p),p.hp+1.5);broadcast({type:'message',text:`${p.name} reached level ${p.level}!`});} if(p.level===MAX_LEVEL)p.exp=0;}
function knock(entity,vx,vy,mult=1){entity.knockX=(entity.knockX||0)+vx*mult; entity.knockY=(entity.knockY||0)+vy*mult;}
function showDamage(x,y,amount,kind,now,angle=null){broadcast({type:'damage_fx',x:+x.toFixed(1),y:+y.toFixed(1),amount:+amount.toFixed(1),kind,at:now,angle:Number.isFinite(angle)?+angle.toFixed(3):null});}
function applyDamage(p,amount,now,sourceX=p.x,sourceY=p.y){if(p.hp<=0||now<p.invulnerableUntil||(p.leapAt&&now-p.leapAt<LEAP_DURATION))return;p.hp=Math.max(0,Math.round((p.hp-amount)*100)/100);p.invulnerableUntil=now+650;const a=Math.atan2(p.y-sourceY,p.x-sourceX);knock(p,Math.cos(a)*240,Math.sin(a)*240);showDamage(p.x,p.y,amount,'player',now,a);if(p.hp<=0){const at=spawn();p.x=at.x;p.y=at.y;p.hp=maxHP(p);p.invulnerableUntil=now+1800;broadcast({type:'message',text:`${p.name} was knocked out and respawned!`});}}
function defeatMonster(m,p,now){m.alive=false;m.respawnAt=now+m.respawnMs;if(m.type==='baphomet'){m.quakeStart=0;for(const [id,add] of monsters)if(add.type==='baphometjr')monsters.delete(id);broadcast({type:'message',text:'Baphomet has fallen! His summons vanish.'});}if(m.type==='baphometjr')monsters.delete(m.id); if(m.type!=='baphomet'&&m.type!=='baphometjr'){const rp=randomMonsterSpawn(m.type); m.homeX=rp.x;m.homeY=rp.y;} awardExp(p,m.exp); broadcast({type:'message',text:`${p.name} defeated ${m.name} (+${m.exp} EXP)`});}
function hitChance(p,m){const requirement=m.hitReq||8; return Math.min(.98,hitRating(p)>=requirement?.95:.55+hitRating(p)/requirement*.35);}
function performSlash(p,now,angle){if(now-p.lastSlash<slashCooldown(p)||p.hp<=0||(p.spinAt&&now-p.spinAt<SPIN_DURATION))return false; p.lastSlash=now;p.attacking=true;p.attackAt=now;p.attackAngle=angle; const ux=Math.cos(angle),uy=Math.sin(angle); for(const m of monsters.values()){ if(!m.alive)continue; const dx=m.x-p.x,dy=m.y-p.y,forward=dx*ux+dy*uy,side=Math.abs(dx*uy-dy*ux); const range=m.type==='baphomet'?92:78; const width=m.type==='baphomet'?50:36; if(forward>0&&forward<range&&side<width){ if(Math.random()>hitChance(p,m)){showDamage(m.x,m.y,0,'miss',now,angle); if(p.ws.readyState===1)p.ws.send(JSON.stringify({type:'message',text:'Miss! Increase DEX to improve accuracy.'})); continue;} const crit=Math.random()<critChance(p),damage=attackDamage(p)*(crit?critMultiplier(p):1); m.hp=Math.max(0,m.hp-damage); knock(m,ux*270,uy*270,m.knockResist); showDamage(m.x,m.y,damage,crit?'crit':'monster',now,angle); if(crit&&p.ws.readyState===1)p.ws.send(JSON.stringify({type:'message',text:'Critical hit!'})); if(m.hp<=0) defeatMonster(m,p,now); }} return true;}

const server=http.createServer((req,res)=>{let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end('Bad request');}const target=path.resolve(ROOT,'.'+(pathname==='/'?'/index.html':pathname));if(target!==ROOT&&!target.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('Forbidden');}fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}const ext=path.extname(target);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png'}[ext]||'application/octet-stream','Cache-Control':'no-store, max-age=0','Pragma':'no-cache','Expires':'0','X-Content-Type-Options':'nosniff'});res.end(data);});});

const wss=new WebSocketServer({server,maxPayload:4096});
wss.on('connection',ws=>{
  const id=crypto.randomUUID(),point=spawn(),now=Date.now();
  const p={id,ws,x:point.x,y:point.y,dir:'down',color:Math.floor(Math.random()*6),name:'Adventurer',level:1,exp:0,hp:5,inputX:0,inputY:0,lastInput:now,lastSlash:0,attacking:false,attackAt:0,jumpAt:0,lastJump:0,invulnerableUntil:0,attackAngle:Math.PI/2,energy:MAX_ENERGY,running:false,knockX:0,knockY:0,stats:Object.fromEntries(STAT_NAMES.map(k=>[k,0])),initialized:false,spinAt:0,spinCooldownUntil:0,spinHitAt:0,leapAt:0,leapCooldownUntil:0,leapX:0,leapY:0,lastStatAt:0,chatAt:0};
  players.set(id,p);
  ws.send(JSON.stringify({type:'welcome',version:GAME_VERSION,id,world:{cols:COLS,rows:ROWS,tile:TILE},players:[...players.values()].map(playerView),monsters:[...monsters.values()].map(monsterView),maxLevel:MAX_LEVEL,chat:chatHistory}));
  ws.on('message',raw=>{let msg;try{msg=JSON.parse(raw.toString());}catch{return;}if(!msg||typeof msg!=='object')return;
    if(msg.type==='init'&&!p.initialized){p.initialized=true;const data=msg.save||{};p.name=cleanName(data.name);const level=Number(data.level);p.level=Number.isInteger(level)?clamp(level,1,MAX_LEVEL):1;const exp=Number(data.exp);p.exp=p.level===MAX_LEVEL?0:clamp(Number.isFinite(exp)?exp:0,0,expNeeded(p.level)-1);const hp=Number(data.hp); const savedStats=data.stats||{}; const candidate=Object.fromEntries(STAT_NAMES.map(k=>[k,Number.isInteger(savedStats[k])?clamp(savedStats[k],0,99):0])); if(spentStats(candidate)<=totalPoints(p.level))p.stats=candidate; p.hp=Number.isFinite(hp)?clamp(hp,0.5,maxHP(p)):maxHP(p);const x=Number(data.x),y=Number(data.y);if(Number.isFinite(x)&&Number.isFinite(y)&&!collides(x,y)&&x>10&&y>10){p.x=x;p.y=y;}broadcast({type:'join',player:playerView(p)});return;}
    if(!p.initialized)return;
    if(msg.type==='name'){p.name=cleanName(msg.name);broadcast({type:'join',player:playerView(p)});} 
    else if(msg.type==='stat'){const statNow=Date.now();if(statNow-p.lastStatAt<65)return;p.lastStatAt=statNow;const key=String(msg.stat||'').toUpperCase();if(STAT_NAMES.includes(key)&&p.stats[key]<99){const cost=statCost(p.stats[key]);if(totalPoints(p.level)-spentStats(p.stats)>=cost){const oldMax=maxHP(p);p.stats[key]++;if(key==='VIT')p.hp+=maxHP(p)-oldMax;}}}
    else if(msg.type==='reset_stats'){if(spentStats(p.stats)===0)return;const oldMax=maxHP(p),oldHp=p.hp;p.stats=Object.fromEntries(STAT_NAMES.map(k=>[k,0]));p.hp=Math.min(maxHP(p),Math.max(.5,oldHp*maxHP(p)/Math.max(1,oldMax)));if(ws.readyState===1)ws.send(JSON.stringify({type:'message',text:'Stats reset. All spent points returned.'}));}
    else if(msg.type==='debug_level'){ if(p.level>=MAX_LEVEL){if(ws.readyState===1)ws.send(JSON.stringify({type:'message',text:'Already at max level.'}));return;} p.level++;p.exp=0;p.hp=maxHP(p); broadcast({type:'message',text:`${p.name} debug-leveled to ${p.level}!`}); }
    else if(msg.type==='chat'){const now=Date.now();if(now-p.chatAt<700)return; const text=typeof msg.text==='string'?msg.text.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,160):''; if(!text)return;p.chatAt=now; const item={name:p.name,text,time:now};chatHistory.push(item);if(chatHistory.length>30)chatHistory.shift();broadcast({type:'chat',item});}
    else if(msg.type==='spin'){const now=Date.now(),ok=now>=p.spinCooldownUntil&&p.hp>0; if(ok){p.spinAt=now;p.spinHitAt=0;p.spinCooldownUntil=now+SPIN_COOLDOWN;} if(ws.readyState===1)ws.send(JSON.stringify({type:'skill_ack',slot:1,ok,remaining:Math.max(0,p.spinCooldownUntil-now)}));}
    else if(msg.type==='leap'){const now=Date.now();let ok=now>=p.leapCooldownUntil&&p.hp>0&&!(p.leapAt&&now-p.leapAt<LEAP_DURATION); if(ok){const x=Number(msg.x),y=Number(msg.y); if(!Number.isFinite(x)||!Number.isFinite(y))ok=false; else {const dx=x-p.x,dy=y-p.y,dist=Math.hypot(dx,dy),scale=Math.min(1,LEAP_RANGE/Math.max(1,dist)); const destX=clamp(p.x+dx*scale,16,WIDTH-16),destY=clamp(p.y+dy*scale,16,HEIGHT-16); let landing=null;const count=Math.ceil(Math.hypot(destX-p.x,destY-p.y)/8); for(let i=1;i<=count;i++){const xx=p.x+(destX-p.x)*i/count,yy=p.y+(destY-p.y)*i/count;if(collides(xx,yy,12))break;landing={x:xx,y:yy};} if(!landing||Math.hypot(landing.x-p.x,landing.y-p.y)<12)ok=false; else{p.leapFromX=p.x;p.leapFromY=p.y;p.leapX=landing.x;p.leapY=landing.y;p.leapAt=now;p.leapCooldownUntil=now+LEAP_COOLDOWN;}}} if(ws.readyState===1)ws.send(JSON.stringify({type:'skill_ack',slot:2,ok,remaining:Math.max(0,p.leapCooldownUntil-now)}));}
    else if(msg.type==='input'){const ix=Number(msg.x),iy=Number(msg.y);if(!Number.isFinite(ix)||!Number.isFinite(iy))return;p.inputX=clamp(ix,-1,1);p.inputY=clamp(iy,-1,1);const length=Math.hypot(p.inputX,p.inputY);if(length>1){p.inputX/=length;p.inputY/=length;}p.running=msg.run===true;p.lastInput=Date.now();}
    else if(msg.type==='jump'){const now=Date.now();const ok=now-p.lastJump>470; if(ok){p.lastJump=now;p.jumpAt=now;} if(ws.readyState===1)ws.send(JSON.stringify({type:'action_ack',action:'jump',ok,reason:ok?'':'cooldown'}));}
    else if(msg.type==='slash'){const now=Date.now();const ok=now-p.lastSlash>=slashCooldown(p)&&p.hp>0; const angle=Number(msg.angle); if(ok){const a=Number.isFinite(angle)?angle:Math.PI/2;p.attackAngle=Math.atan2(Math.sin(a),Math.cos(a)); p.dir=Math.abs(Math.cos(a))>Math.abs(Math.sin(a))?(Math.cos(a)>0?'right':'left'):(Math.sin(a)>0?'down':'up'); performSlash(p,now,p.attackAngle);} if(ws.readyState===1)ws.send(JSON.stringify({type:'action_ack',action:'slash',ok,reason:ok?'':p.hp<=0?'no HP':'cooldown'}));}
  });
  ws.on('close',()=>{players.delete(id);broadcast({type:'leave',id});});
  ws.on('error',()=>{});
});

let last=performance.now(),snapshot=0;
setInterval(()=>{
  const now=Date.now(),time=performance.now(),dt=Math.min((time-last)/1000,.05);last=time;
  for(const p of players.values()){
    if(!p.initialized)continue;
    if(now-p.lastInput>1000){p.inputX=0;p.inputY=0;}
    if(p.leapAt&&now-p.leapAt>=LEAP_DURATION&&p.leapX){
      p.x=p.leapX;p.y=p.leapY;p.leapX=0;p.leapY=0;
      for(const m of monsters.values()) if(m.alive&&Math.hypot(m.x-p.x,m.y-p.y)<=LEAP_RADIUS){m.stunnedUntil=now+LEAP_STUN;m.chargeUntil=0;m.vx=0;m.vy=0;}
      broadcast({type:'leap_impact',x:p.x,y:p.y,at:now});
    }
    const airborne=p.leapAt&&now-p.leapAt<LEAP_DURATION;
    if(airborne){const q=clamp((now-p.leapAt)/LEAP_DURATION,0,1);p.x=p.leapFromX+(p.leapX-p.leapFromX)*q;p.y=p.leapFromY+(p.leapY-p.leapFromY)*q;}
    const moving=!airborne&&Math.hypot(p.inputX,p.inputY)>.01; const sprint=moving&&p.running&&p.energy>.2; const speed=sprint?RUN_SPEED:SPEED; p.energy=clamp(p.energy+(sprint?-33:19)*dt,0,MAX_ENERGY);
    const dx=(airborne?0:(p.inputX*speed+p.knockX)*dt),dy=(airborne?0:(p.inputY*speed+p.knockY)*dt); p.knockX*=Math.exp(-dt*13); p.knockY*=Math.exp(-dt*13);
    if(!airborne&&Math.hypot(p.inputX,p.inputY)>.1){if(Math.abs(p.inputX)>Math.abs(p.inputY))p.dir=p.inputX>0?'right':'left';else p.dir=p.inputY>0?'down':'up';}
    if(dx||dy){if(!collides(p.x+dx,p.y))p.x+=dx;if(!collides(p.x,p.y+dy))p.y+=dy;}
    p.attacking=now-p.attackAt<240;
    if(p.spinAt&&now-p.spinAt<SPIN_DURATION&&now-p.spinHitAt>=SPIN_TICK){p.spinHitAt=now; for(const m of monsters.values()){ if(!m.alive||Math.hypot(m.x-p.x,m.y-p.y)>96)continue; if(Math.random()>hitChance(p,m)){showDamage(m.x,m.y,0,'miss',now,Math.atan2(m.y-p.y,m.x-p.x));continue;} const critical=Math.random()<critChance(p),damage=attackDamage(p)*.64*(critical?critMultiplier(p):1); const angle=Math.atan2(m.y-p.y,m.x-p.x);m.hp=Math.max(0,m.hp-damage); knock(m,Math.cos(angle)*190,Math.sin(angle)*190,m.knockResist); showDamage(m.x,m.y,damage,critical?'crit':'monster',now,angle); if(m.hp<=0) defeatMonster(m,p,now); }}
  }

  for(const m of monsters.values()){
    if(m.alive&&(m.knockX||m.knockY)){const kx=m.knockX*dt,ky=m.knockY*dt;if(!collides(m.x+kx,m.y,11))m.x+=kx;if(!collides(m.x,m.y+ky,11))m.y+=ky;m.knockX*=Math.exp(-dt*11);m.knockY*=Math.exp(-dt*11);}
    if(!m.alive){ if(m.type==='baphometjr'){monsters.delete(m.id);continue;} if(now>=m.respawnAt){m.alive=true;m.hp=m.maxHp;m.nextAttack=now+1000;m.stunnedUntil=0;m.hitCooldown.clear(); if(m.type==='baphomet'){const p=bossCenter();m.homeX=p.x;m.homeY=p.y;m.x=p.x;m.y=p.y;m.spawnedAdds=false;m.quake75=false;m.quake25=false;m.quakeStart=0;} else {const rp=m.type==='baphometjr' ? {x:bossCenter().x+(Math.random()-.5)*180,y:bossCenter().y+(Math.random()-.5)*160} : randomMonsterSpawn(m.type); m.homeX=rp.x;m.homeY=rp.y;m.x=rp.x;m.y=rp.y;}} continue; }
    if(m.type==='baphomet'){
      // Two once-per-life earthquake casts at 75% and 25% HP. A cast pauses other boss attacks.
      if(m.quakeStart && now-m.quakeStart>=3000){
        const qx=m.quakeX,qy=m.quakeY;
        for(const player of players.values())if(player.initialized&&Math.hypot(player.x-qx,player.y-qy)<=360){
          // Shockwaves punish anyone inside the clearly telegraphed zone.
          applyDamage(player,13+Math.random()*5,now,qx,qy);
        }
        broadcast({type:'quake_impact',x:qx,y:qy,radius:360,at:now});
        m.quakeStart=0;m.nextAttack=now+850;
      }
      if(!m.quakeStart){
        if(!m.quake75&&m.hp<=m.maxHp*.75){m.quake75=true;m.quakeStart=now;m.quakeX=m.x;m.quakeY=m.y;}
        else if(!m.quake25&&m.hp<=m.maxHp*.25){m.quake25=true;m.quakeStart=now;m.quakeX=m.x;m.quakeY=m.y;}
        if(m.quakeStart)broadcast({type:'message',text:'Baphomet begins casting Earthquake! Get out of the circle!'});
      }
    }
    if(m.type==='baphomet'&&!m.spawnedAdds&&m.hp<=m.maxHp*.5){m.spawnedAdds=true;for(let i=0;i<5;i++){const ang=(Math.PI*2*i)/5;addMonster('baphometjr',Date.now()+i,{x:m.x+Math.cos(ang)*80,y:m.y+Math.sin(ang)*70});}broadcast({type:'message',text:'Baphomet summons 5 Baphomet.Jr!'});}
    if(now<m.stunnedUntil||(m.type==='baphomet'&&m.quakeStart))continue;
    let target=null,dist=Infinity; for(const p of players.values()){if(!p.initialized)continue; const d=Math.hypot(p.x-m.x,p.y-m.y); if(d<dist){dist=d;target=p;}}
    if(target&&dist<420){const ux=(target.x-m.x)/Math.max(1,dist),uy=(target.y-m.y)/Math.max(1,dist);m.dir=Math.abs(ux)>Math.abs(uy)?(ux>0?'right':'left'):(uy>0?'down':'up');
      if(m.type==='rat'){
        if(now<m.chargeUntil){const dx=m.vx*dt,dy=m.vy*dt;if(!collides(m.x+dx,m.y,11))m.x+=dx;if(!collides(m.x,m.y+dy,11))m.y+=dy;if(Math.hypot(m.x-target.x,m.y-target.y)<24&&now-(m.hitCooldown.get(target.id)||0)>750){m.hitCooldown.set(target.id,now);applyDamage(target,.6+Math.random()*.6,now,m.x,m.y);}}
        else if(dist<170&&now>m.nextAttack){m.vx=ux*320;m.vy=uy*320;m.chargeUntil=now+430;m.attackAt=now;m.nextAttack=now+2400;}
        else if(dist>44){if(!collides(m.x+ux*40*dt,m.y,11))m.x+=ux*40*dt;if(!collides(m.x,m.y+uy*40*dt,11))m.y+=uy*40*dt;}
      }else if(m.type==='bat'){
        if(dist<240&&now>m.nextAttack){const id=crypto.randomUUID();projectiles.set(id,{id,type:'spit',x:m.x,y:m.y,vx:ux*220,vy:uy*220,created:now,damage:.6+Math.random()*.5});m.attackAt=now;m.nextAttack=now+1950;} if(dist<175&&dist>82){if(!collides(m.x+ux*36*dt,m.y,11))m.x+=ux*36*dt;if(!collides(m.x,m.y+uy*36*dt,11))m.y+=uy*36*dt;}
      }else if(m.type==='baphomet'){
        if(dist<86&&now>m.nextAttack){m.attackAt=now;m.nextAttack=now+1100;applyDamage(target,2.8+Math.random()*1.6,now,m.x,m.y);} else if(dist<330&&now>m.nextAttack){const id=crypto.randomUUID();projectiles.set(id,{id,type:'darkbolt',x:m.x,y:m.y,vx:ux*245,vy:uy*245,created:now,damage:3+Math.random()*1.4});m.attackAt=now;m.nextAttack=now+1850;} if(dist>70){if(!collides(m.x+ux*52*dt,m.y,14))m.x+=ux*52*dt;if(!collides(m.x,m.y+uy*52*dt,14))m.y+=uy*52*dt;}
      }else if(m.type==='baphometjr'){
        if(dist<60&&now>m.nextAttack){m.attackAt=now;m.nextAttack=now+1200;applyDamage(target,1.1+Math.random()*.8,now,m.x,m.y);} else if(dist>38){if(!collides(m.x+ux*72*dt,m.y,12))m.x+=ux*72*dt;if(!collides(m.x,m.y+uy*72*dt,12))m.y+=uy*72*dt;}
      }
    }else if(m.type!=='baphomet'){
      m.wander-=dt; if(m.wander<0){m.wander=2+Math.random()*3; m.vx=(Math.random()-.5)*28; m.vy=(Math.random()-.5)*28;} if(Math.hypot(m.x-m.homeX,m.y-m.homeY)>110){m.vx=(m.homeX-m.x)*.45;m.vy=(m.homeY-m.y)*.45;} if(!collides(m.x+m.vx*dt,m.y,11))m.x+=m.vx*dt; if(!collides(m.x,m.y+m.vy*dt,11))m.y+=m.vy*dt;
    }
  }

  for(const [id,b]of projectiles){b.x+=b.vx*dt;b.y+=b.vy*dt; if(now-b.created>2500||collides(b.x,b.y,4)){projectiles.delete(id);continue;} for(const p of players.values()){if(!p.initialized)continue; if(Math.hypot(p.x-b.x,p.y-b.y)<18){if(now-p.jumpAt<480&&now-p.jumpAt>0){projectiles.delete(id);break;} applyDamage(p,b.damage||(.5+Math.random()*.5),now,b.x-b.vx*.07,b.y-b.vy*.07); projectiles.delete(id);break;}}}
  snapshot+=dt; if(snapshot>=.05){snapshot=0;broadcast({type:'state',serverNow:now,players:[...players.values()].filter(p=>p.initialized).map(playerView),monsters:[...monsters.values()].map(monsterView),projectiles:[...projectiles.values()].map(b=>({id:b.id,type:b.type,x:+b.x.toFixed(1),y:+b.y.toFixed(1)}))});}
},1000/60);
server.listen(PORT,'0.0.0.0',()=>console.log(`Meadow Multiplayer running on port ${PORT}`));
