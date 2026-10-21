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
const TILE=32,COLS=60,ROWS=40,SPEED=175,MAX_LEVEL=50;
const players=new Map(),monsters=new Map(),projectiles=new Map();
function hash(x,y,seed=12345){let n=Math.imul(x+seed,374761393)+Math.imul(y-seed,668265263);n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
function tileAt(x,y){if(x<0||y<0||x>=COLS||y>=ROWS)return'wall';const pond=((x-43)/9)**2+((y-13)/7)**2;if(pond<1+(hash(x,y,44)-.5)*.27)return'water';if(x>42&&y>23&&Math.abs(x-(47+Math.sin(y*.42)*3))<1.4)return'water';const safe=Math.abs(x-15)<6&&Math.abs(y-18)<6;if(!safe&&hash(x,y,91)>.887&&hash(x+1,y,55)>.24)return'tree';return'grass';}
function collides(x,y,r=10){for(const cx of[x-r,x+r])for(const cy of[y-r,y+r])if(tileAt(Math.floor(cx/TILE),Math.floor(cy/TILE))!=='grass')return true;return false;}
function spawn(){for(let i=0;i<150;i++){const x=(12+Math.floor(Math.random()*7))*TILE+16,y=(15+Math.floor(Math.random()*7))*TILE+16;if(!collides(x,y))return{x,y};}return{x:496,y:592};}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const maxHP=level=>5+(level-1)*1.5;
const attackDamage=level=>1+(level-1)*0.18;
const expNeeded=level=>Math.round(10+level*6+level*level*1.3);
function cleanName(n){return typeof n==='string'?(n.replace(/[\x00-\x1f\x7f<>]/g,'').trim().slice(0,18)||'Adventurer'):'Adventurer';}
function broadcast(o){const s=JSON.stringify(o);for(const p of players.values())if(p.ws.readyState===WebSocket.OPEN)p.ws.send(s);}
function playerView(p){return{id:p.id,x:+p.x.toFixed(1),y:+p.y.toFixed(1),dir:p.dir,color:p.color,name:p.name,level:p.level,exp:p.exp,hp:+p.hp.toFixed(2),maxHp:maxHP(p.level),attacking:p.attacking,attackAt:p.attackAt,jumpAt:p.jumpAt,invulnerableUntil:p.invulnerableUntil};}
function monsterView(m){return{id:m.id,type:m.type,x:+m.x.toFixed(1),y:+m.y.toFixed(1),hp:+m.hp.toFixed(2),maxHp:m.maxHp,dir:m.dir,attackAt:m.attackAt,chargeUntil:m.chargeUntil,alive:m.alive};}
const server=http.createServer((req,res)=>{let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end('Bad request');}const target=path.resolve(ROOT,'.'+(pathname==='/'?'/index.html':pathname));if(target!==ROOT&&!target.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end('Forbidden');}fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}const ext=path.extname(target);res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[ext]||'application/octet-stream','Cache-Control':'no-store, max-age=0','Pragma':'no-cache','Expires':'0','X-Content-Type-Options':'nosniff'});res.end(data);});});
function addMonster(type,index){const cx=type==='rat'?10+(index*9)%37:17+(index*11)%35,cy=type==='rat'?8+(index*7)%24:7+(index*9)%26;let point=null;for(let j=0;j<90;j++){const x=clamp(cx+(j%11)-5,2,COLS-3)*TILE+16,y=clamp(cy+Math.floor(j/11)-4,2,ROWS-3)*TILE+16;if(!collides(x,y,12)&&Math.hypot(x-496,y-592)>135){point={x,y};break;}}if(!point)point=spawn();const id=type+'-'+index;monsters.set(id,{id,type,x:point.x,y:point.y,homeX:point.x,homeY:point.y,dir:'down',hp:type==='rat'?3:2.5,maxHp:type==='rat'?3:2.5,alive:true,respawnAt:0,nextAttack:0,attackAt:0,chargeUntil:0,vx:0,vy:0,wander:Math.random()*6,hitCooldown:new Map()});}
for(let i=0;i<10;i++){addMonster('rat',i);addMonster('bat',i);}
function applyDamage(p,amount,now){if(p.hp<=0||now<p.invulnerableUntil)return;p.hp=Math.max(0,Math.round((p.hp-amount)*100)/100);p.invulnerableUntil=now+650;if(p.hp<=0){const at=spawn();p.x=at.x;p.y=at.y;p.hp=maxHP(p.level);p.invulnerableUntil=now+1800;broadcast({type:'message',text:`${p.name} was knocked out and respawned!`});}}
function awardExp(p,amount){if(p.level===MAX_LEVEL)return;p.exp+=amount;while(p.level<MAX_LEVEL&&p.exp>=expNeeded(p.level)){p.exp-=expNeeded(p.level);p.level++;p.hp=Math.min(maxHP(p.level),p.hp+1.5);broadcast({type:'message',text:`${p.name} reached level ${p.level}!`});}if(p.level===MAX_LEVEL)p.exp=0;}
function performSlash(p,now){if(now-p.lastSlash<400||p.hp<=0)return;p.lastSlash=now;p.attacking=true;p.attackAt=now;const d={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[p.dir];for(const m of monsters.values()){if(!m.alive)continue;const dx=m.x-p.x,dy=m.y-p.y,forward=dx*d[0]+dy*d[1],side=Math.abs(dx*d[1]-dy*d[0]);if(forward>0&&forward<56&&side<29){m.hp=Math.max(0,m.hp-attackDamage(p.level));if(m.hp<=0){m.alive=false;m.respawnAt=now+6000;awardExp(p,m.type==='rat'?6:8);broadcast({type:'message',text:`${p.name} defeated a ${m.type} (+${m.type==='rat'?6:8} EXP)`});}}}}
const wss=new WebSocketServer({server,maxPayload:4096});
wss.on('connection',ws=>{const id=crypto.randomUUID(),point=spawn(),now=Date.now();const p={id,ws,x:point.x,y:point.y,dir:'down',color:Math.floor(Math.random()*6),name:'Adventurer',level:1,exp:0,hp:5,inputX:0,inputY:0,lastInput:now,lastSlash:0,attacking:false,attackAt:0,jumpAt:0,lastJump:0,invulnerableUntil:0,initialized:false};players.set(id,p);
ws.send(JSON.stringify({type:'welcome',version:GAME_VERSION,id,world:{cols:COLS,rows:ROWS,tile:TILE},players:[...players.values()].map(playerView),monsters:[...monsters.values()].map(monsterView),maxLevel:MAX_LEVEL}));
ws.on('message',raw=>{let msg;try{msg=JSON.parse(raw.toString());}catch{return;}if(!msg||typeof msg!=='object')return;
if(msg.type==='init'&&!p.initialized){p.initialized=true;const data=msg.save||{};p.name=cleanName(data.name);const level=Number(data.level);p.level=Number.isInteger(level)?clamp(level,1,MAX_LEVEL):1;const exp=Number(data.exp);p.exp=p.level===MAX_LEVEL?0:clamp(Number.isFinite(exp)?exp:0,0,expNeeded(p.level)-1);const hp=Number(data.hp);p.hp=Number.isFinite(hp)?clamp(hp,0.5,maxHP(p.level)):maxHP(p.level);const x=Number(data.x),y=Number(data.y);if(Number.isFinite(x)&&Number.isFinite(y)&&!collides(x,y)&&x>10&&y>10){p.x=x;p.y=y;}broadcast({type:'join',player:playerView(p)});return;}
if(!p.initialized)return;
if(msg.type==='name'){p.name=cleanName(msg.name);broadcast({type:'join',player:playerView(p)});}
else if(msg.type==='input'){const ix=Number(msg.x),iy=Number(msg.y);if(!Number.isFinite(ix)||!Number.isFinite(iy))return;p.inputX=clamp(ix,-1,1);p.inputY=clamp(iy,-1,1);const length=Math.hypot(p.inputX,p.inputY);if(length>1){p.inputX/=length;p.inputY/=length;}p.lastInput=Date.now();}
else if(msg.type==='jump'){if(Date.now()-p.lastJump>650){p.lastJump=Date.now();p.jumpAt=p.lastJump;}}
else if(msg.type==='slash')performSlash(p,Date.now());
});ws.on('close',()=>{players.delete(id);broadcast({type:'leave',id});});ws.on('error',()=>{});
});
let last=performance.now(),snapshot=0;
setInterval(()=>{const now=Date.now(),time=performance.now(),dt=Math.min((time-last)/1000,.05);last=time;
for(const p of players.values()){if(!p.initialized)continue;if(now-p.lastInput>1000){p.inputX=0;p.inputY=0;}const dx=p.inputX*SPEED*dt,dy=p.inputY*SPEED*dt;if(dx||dy){if(Math.abs(dx)>Math.abs(dy))p.dir=dx>0?'right':'left';else p.dir=dy>0?'down':'up';if(!collides(p.x+dx,p.y))p.x+=dx;if(!collides(p.x,p.y+dy))p.y+=dy;}p.attacking=now-p.attackAt<240;}
for(const m of monsters.values()){
if(!m.alive){if(now>=m.respawnAt){m.alive=true;m.hp=m.maxHp;m.x=m.homeX;m.y=m.homeY;m.nextAttack=now+1000;}continue;}
let target=null,dist=Infinity;for(const p of players.values()){if(!p.initialized)continue;const d=Math.hypot(p.x-m.x,p.y-m.y);if(d<dist){dist=d;target=p;}}
if(target&&dist<260){const ux=(target.x-m.x)/Math.max(1,dist),uy=(target.y-m.y)/Math.max(1,dist);m.dir=Math.abs(ux)>Math.abs(uy)?(ux>0?'right':'left'):(uy>0?'down':'up');
if(m.type==='rat'){
if(now<m.chargeUntil){const dx=m.vx*dt,dy=m.vy*dt;if(!collides(m.x+dx,m.y,11))m.x+=dx;if(!collides(m.x,m.y+dy,11))m.y+=dy;if(Math.hypot(m.x-target.x,m.y-target.y)<24&&now-(m.hitCooldown.get(target.id)||0)>750){m.hitCooldown.set(target.id,now);applyDamage(target,.5+Math.random()*.5,now);}}
else if(dist<165&&now>m.nextAttack){m.vx=ux*300;m.vy=uy*300;m.chargeUntil=now+430;m.attackAt=now;m.nextAttack=now+2500;}
else if(dist>45){if(!collides(m.x+ux*30*dt,m.y,11))m.x+=ux*30*dt;if(!collides(m.x,m.y+uy*30*dt,11))m.y+=uy*30*dt;}
}else{if(dist<230&&now>m.nextAttack){const id=crypto.randomUUID();projectiles.set(id,{id,x:m.x,y:m.y,vx:ux*205,vy:uy*205,created:now});m.attackAt=now;m.nextAttack=now+2000;}if(dist<175&&dist>80){if(!collides(m.x+ux*35*dt,m.y,11))m.x+=ux*35*dt;if(!collides(m.x,m.y+uy*35*dt,11))m.y+=uy*35*dt;}}
}else{m.wander-=dt;if(m.wander<0){m.wander=2+Math.random()*3;m.vx=(Math.random()-.5)*24;m.vy=(Math.random()-.5)*24;}if(Math.hypot(m.x-m.homeX,m.y-m.homeY)>85){m.vx=(m.homeX-m.x)*.45;m.vy=(m.homeY-m.y)*.45;}if(!collides(m.x+m.vx*dt,m.y,11))m.x+=m.vx*dt;if(!collides(m.x,m.y+m.vy*dt,11))m.y+=m.vy*dt;}
}
for(const [id,b]of projectiles){b.x+=b.vx*dt;b.y+=b.vy*dt;if(now-b.created>2500||collides(b.x,b.y,3)){projectiles.delete(id);continue;}for(const p of players.values()){if(!p.initialized)continue;if(Math.hypot(p.x-b.x,p.y-b.y)<17){applyDamage(p,.5+Math.random()*.5,now);projectiles.delete(id);break;}}}
snapshot+=dt;if(snapshot>=.05){snapshot=0;broadcast({type:'state',players:[...players.values()].filter(p=>p.initialized).map(playerView),monsters:[...monsters.values()].map(monsterView),projectiles:[...projectiles.values()].map(b=>({id:b.id,x:+b.x.toFixed(1),y:+b.y.toFixed(1)}))});}
},1000/60);
server.listen(PORT,'0.0.0.0',()=>console.log(`Meadow Multiplayer running on port ${PORT}`));
