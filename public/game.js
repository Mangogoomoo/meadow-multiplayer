// Meadow Multiplayer client
// Visual remake: world, player, monsters, boss, particles and map styling.
(()=>{'use strict';
const canvas=document.getElementById('game');
const ctx=canvas.getContext('2d');
const ui=id=>document.getElementById(id);
const minimap=ui('minimap');
const miniCtx=minimap.getContext('2d');
const miniBase=document.createElement('canvas');
miniBase.width=minimap.width; miniBase.height=minimap.height;
const miniBaseCtx=miniBase.getContext('2d');

const TILE=32,COLS=120,ROWS=80,WIDTH=COLS*TILE,HEIGHT=ROWS*TILE;
const SERVER_URL='';
const STORAGE_KEY='meadow-rpg-save-v1';
const DELETE_KEY='meadow-rpg-delete-on-reconnect';
const SERVER_VERSION_KEY='meadow-rpg-server-version-v1';
const MAX_LEVEL=99;
const STAT_DESC={STR:'Melee damage',AGI:'Attack speed',VIT:'Maximum HP',INT:'Magic damage (future spells)',DEX:'Hit rating / accuracy',LUK:'Critical rate and damage'};
const players=new Map(),monsters=new Map(),projectiles=new Map();
const damageFx=[],crackFx=[],particleFx=[],quakeFx=[];
const keys=new Set();
const movement=new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright']);
let ws=null,myId=null,retries=0,serverClockOffset=0;
let attackingHeld=false,lastAttackSent=-9999,mouseX=0,mouseY=0;
let last=performance.now(),lastInput=0,lastSaved=0,lastHp=null,readyToSave=false;
let dpr=1,viewW=0,viewH=0,cameraX=0,cameraY=0,renderNow=0;
let sentInputX=0,sentInputY=0,sentRun=false;
let heldStat=null,heldStatTimer=null;

function checkServerVersion(version){
  if(typeof version!=='string'||!version)return false;
  try{
    const previous=sessionStorage.getItem(SERVER_VERSION_KEY);
    sessionStorage.setItem(SERVER_VERSION_KEY,version);
    if(previous&&previous!==version){ persist(); location.reload(); return true; }
  }catch(error){ console.warn('Version check unavailable:',error); }
  return false;
}
function readSave(){ try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{};}catch{return{};} }
const save=readSave();
ui('name').value=typeof save.name==='string'?save.name:'Adventurer';
function persist(){
  const p=players.get(myId);
  if(!p||!readyToSave)return;
  const s={name:p.name,x:p.tx,y:p.ty,hp:p.hp,exp:p.exp,level:p.level,stats:p.stats};
  try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(s)); }catch(error){ console.warn('Unable to save:',error); }
}
addEventListener('pagehide',persist);
document.addEventListener('visibilitychange',()=>{ if(document.hidden)persist(); });

function resize(){
  dpr=Math.min(devicePixelRatio||1,2);
  viewW=innerWidth; viewH=innerHeight;
  canvas.width=Math.floor(viewW*dpr); canvas.height=Math.floor(viewH*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.imageSmoothingEnabled=false;
}
addEventListener('resize',resize); resize();

// The world is a continuous authored pixel-art image, not thousands of drawn square tiles.
const ART={};
const IMG_NAMES=['world','hero','rat','bat','baphomet','baphometjr','oak','pine','cherry','rock','bush','mushroom','obelisk'];
let WORLD=null,OBJECTS=[];
let visualReady=false;
const TERRAIN_LABELS=['grass','road','grass','water','cliff','tree','ruin'];
function tileAt(tx,ty){
  if(!WORLD||tx<0||ty<0||tx>=COLS||ty>=ROWS)return 'wall';
  return TERRAIN_LABELS[WORLD.grid[ty][tx]]||'grass';
}
function loadImage(name){
  return new Promise((resolve,reject)=>{
    const img=new Image();img.onload=()=>{ART[name]=img;resolve(img);};
    img.onerror=()=>reject(new Error('Could not load asset: '+name));
    img.src='assets/'+name+'.png';
  });
}
async function loadWorld(){
  const resp=await fetch('assets/world.json',{cache:'no-store'});
  if(!resp.ok)throw new Error('World layout failed to load');
  WORLD=await resp.json();OBJECTS=WORLD.objects||[];
  await Promise.all(IMG_NAMES.map(loadImage));
  visualReady=true;buildMinimapBase();
}
function buildMinimapBase(){
  if(!WORLD)return;
  const sx=minimap.width/WIDTH,sy=minimap.height/HEIGHT;
  miniBaseCtx.clearRect(0,0,minimap.width,minimap.height);
  // The minimap uses the new map artwork and obstacles with no tile grid.
  miniBaseCtx.drawImage(ART.world,0,0,minimap.width,minimap.height);
  for(const obj of OBJECTS){
    miniBaseCtx.fillStyle=obj.kind==='cherry'?'#df97b2':obj.kind==='pine'?'#2e6657':obj.kind==='oak'?'#367750':'#57694b';
    if(['oak','pine','cherry'].includes(obj.kind))miniBaseCtx.fillRect(obj.x*sx-1,obj.y*sy-1.5,2.5,2.5);
  }
}

// ---------- networking ----------
function emit(type,payload={}){ if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type,...payload})); }
function connect(){
  ui('status').textContent='Connecting…';
  ui('dot').classList.remove('online');
  const url=SERVER_URL?SERVER_URL.replace(/^http/,'ws').replace(/\/$/,''):(location.protocol==='https:'?'wss://':'ws://')+location.host;
  ws=new WebSocket(url);
  ws.onopen=()=>{
    ui('status').textContent='Connected'; ui('dot').classList.add('online'); retries=0;
    emit('init',{save:{...readSave(),name:ui('name').value}});
  };
  ws.onmessage=e=>{
    let m; try{ m=JSON.parse(e.data); }catch{return; }
    if(m.type==='welcome'){
      if(checkServerVersion(m.version))return;
      readyToSave=false; myId=m.id; players.clear(); monsters.clear(); projectiles.clear();
      (m.players||[]).forEach(updatePlayer); (m.monsters||[]).forEach(updateMonster);
      ui('chat-messages').replaceChildren(); (m.chat||[]).forEach(addChatLine);
    }else if(m.type==='join') updatePlayer(m.player);
    else if(m.type==='state'){
      serverClockOffset=(m.serverNow||Date.now())-Date.now();
      if((m.players||[]).some(p=>p.id===myId))readyToSave=true;
      const pids=new Set();
      (m.players||[]).forEach(p=>{ pids.add(p.id); updatePlayer(p); });
      for(const id of players.keys()) if(!pids.has(id)) players.delete(id);
      const mids=new Set();
      (m.monsters||[]).forEach(mon=>{ mids.add(mon.id); updateMonster(mon); });
      for(const id of monsters.keys()) if(!mids.has(id)) monsters.delete(id);
      const shots=new Set();
      for(const b of (m.projectiles||[])){
        shots.add(b.id); const old=projectiles.get(b.id);
        if(old){ old.tx=b.x; old.ty=b.y; old.type=b.type; }
        else projectiles.set(b.id,{...b,tx:b.x,ty:b.y});
      }
      for(const id of projectiles.keys()) if(!shots.has(id)) projectiles.delete(id);
    }else if(m.type==='leave') players.delete(m.id);
    else if(m.type==='action_ack'&&m.ok){
      const me=players.get(myId); if(me){ const now=performance.now(); if(m.action==='slash') me.visualAttackStart=now; else me.visualJumpStart=now; }
    }else if(m.type==='damage_fx'){
      const fx={x:m.x,y:m.y,amount:m.amount,kind:m.kind,start:performance.now(),angle:m.angle};
      damageFx.push(fx); if(damageFx.length>140)damageFx.shift(); spawnDamageParticles(fx);
    }else if(m.type==='message') notice(m.text);
    else if(m.type==='chat') addChatLine(m.item);
    else if(m.type==='skill_ack'){ if(!m.ok)notice(m.slot===2?'Earthbreaker unavailable':'Whirlwind cooling down'); }
    else if(m.type==='leap_impact'){ crackFx.push({x:m.x,y:m.y,start:performance.now()}); spawnEarthImpact(m.x,m.y); }
    else if(m.type==='quake_impact'){
      quakeFx.push({x:m.x,y:m.y,r:m.radius,start:performance.now()});
      for(let i=0;i<64;i++){const a=Math.random()*Math.PI*2,r=Math.random()*m.radius;spawnParticle(m.x+Math.cos(a)*r,m.y+Math.sin(a)*r,(Math.random()-.5)*95,-55-Math.random()*100,600+Math.random()*700,'#cb9871',3+Math.random()*5,110);}
    }
    ui('count').textContent=players.size; updateHUD();
  };
  ws.onclose=()=>{
    persist(); readyToSave=false; ui('status').textContent='Disconnected'; ui('dot').classList.remove('online');
    myId=null; players.clear(); monsters.clear(); projectiles.clear(); ui('count').textContent='0';
    setTimeout(connect,Math.min(1000*2**retries++,8000));
  };
  ws.onerror=()=>ws.close();
}

function updatePlayer(p){
  if(!p)return;
  const old=players.get(p.id);
  if(old){
    if(Math.hypot(p.x-old.tx,p.y-old.ty)>.15)old.motionAt=performance.now();
    const newJump=p.jumpAt>0&&p.jumpAt!==old.jumpAt;
    const newAttack=p.attackAt>0&&p.attackAt!==old.attackAt;
    const newSpin=p.spinAt>0&&p.spinAt!==old.spinAt;
    const newLeap=p.leapAt>0&&p.leapAt!==old.leapAt;
    Object.assign(old,{...p,tx:p.x,ty:p.y,x:old.x,y:old.y});
    const now=performance.now();
    if(newJump)old.visualJumpStart=now;
    if(newAttack)old.visualAttackStart=now;
    if(newSpin)old.visualSpinStart=now;
    if(newLeap)old.visualLeapStart=now;
  }else{
    players.set(p.id,{...p,tx:p.x,ty:p.y,visualJumpStart:p.jumpAt>0?performance.now():0,visualAttackStart:p.attackAt>0?performance.now():0,visualSpinStart:0,visualLeapStart:0,motionAt:0});
  }
}
function updateMonster(m){
  if(!m)return;
  const old=monsters.get(m.id);
  if(old){
    const castNew=m.quakeStart&&m.quakeStart!==old.quakeStart;
    if(Math.hypot(m.x-old.tx,m.y-old.ty)>.15)old.motionAt=performance.now();
    Object.assign(old,{...m,tx:m.x,ty:m.y,x:old.x,y:old.y});
    if(castNew)old.localQuakeStart=performance.now();
    if(!m.quakeStart)old.localQuakeStart=0;
  }else monsters.set(m.id,{...m,tx:m.x,ty:m.y,localQuakeStart:m.quakeStart?performance.now():0,motionAt:0});
}

// ---------- hud / stats / chat ----------
function xpNeeded(level){ return Math.round(10+level*6+level*level*1.3); }
function updateCombatDetails(p){
  const s=p.stats||{},agi=s.AGI||0,luk=s.LUK||0;
  const details=[
    ['Melee attack',(1+(p.level-1)*.18+(s.STR||0)*.35).toFixed(2)],
    ['Attack speed',(1000/Math.max(135,400-agi*5)).toFixed(2)+'/sec'],
    ['Magic attack',(1+(s.INT||0)*.35).toFixed(2)],
    ['Hit rating',String(4+(s.DEX||0)*2)],
    ['Crit rate',Math.round(Math.min(.55,.05+luk*.01)*100)+'%'],
    ['Crit damage',Math.round((1.5+luk*.025)*100)+'%'],
    ['Max HP',(5+(p.level-1)*1.5+(s.VIT||0)*2).toFixed(1)],
    ['Movement','175 / 285 sprint']
  ];
  ui('combat-details').innerHTML=details.map(([k,v])=>`<span>${k}</span><b>${v}</b>`).join('');
}
function renderStats(p){
  ui('stat-points').textContent=`Available stat points: ${p.statPoints||0}`;
  const signature=JSON.stringify([p.stats,p.statPoints]);
  if(ui('stat-rows').dataset.signature!==signature){
    ui('stat-rows').dataset.signature=signature;
    ui('stat-rows').innerHTML=Object.entries(STAT_DESC).map(([k,description])=>{
      const n=p.stats?.[k]||0; const cost=1+Math.floor(n/20); const affordable=(p.statPoints||0)>=cost&&n<99;
      return `<div class="stat-row"><strong>${k}</strong><strong>${n}/99</strong><span class="stat-desc">${description} · Cost ${n<99?cost:'MAX'}</span><button data-stat="${k}" ${affordable?'':'disabled'}>+</button></div>`;
    }).join('');
  }
  if(!ui('stat-panel').hidden)updateCombatDetails(p);
}
function updateHUD(){
  const p=players.get(myId); if(!p)return;
  ui('level').textContent=`Level ${p.level}${p.level===MAX_LEVEL?' (MAX)':''}`;
  ui('hptext').textContent=`${+p.hp.toFixed(1)} / ${+p.maxHp.toFixed(1)} HP`;
  ui('hpbar').style.width=(p.hp/p.maxHp*100)+'%';
  ui('energytext').textContent=`${Math.ceil(p.energy??100)} / 100 Energy`;
  ui('energybar').style.width=`${p.energy??100}%`;
  const required=p.level>=MAX_LEVEL?0:xpNeeded(p.level);
  ui('exptext').textContent=p.level===MAX_LEVEL?'MAX':`${Math.floor(p.exp)} / ${required}`;
  ui('expbar').style.width=p.level===MAX_LEVEL?'100%':(p.exp/required*100)+'%';
  ui('hpbar').style.background=(lastHp!==null&&p.hp<lastHp)?'#ff4949':'#eb6c72';
  lastHp=p.hp; renderStats(p);
}
function addChatLine(item){
  if(!item||typeof item.text!=='string')return;
  const box=ui('chat-messages'); const line=document.createElement('div'); const name=document.createElement('b');
  name.textContent=(item.name||'Adventurer')+': '; line.append(name,document.createTextNode(item.text)); box.append(line);
  while(box.children.length>60)box.firstChild.remove(); box.scrollTop=box.scrollHeight;
}
function notice(text){
  const el=document.createElement('div'); el.className='notice'; el.textContent=text; ui('notices').prepend(el); setTimeout(()=>el.remove(),3800);
}

// ---------- particles ----------
function spawnParticle(x,y,vx,vy,life,color,size=3,gravity=0){
  particleFx.push({x,y,vx,vy,life,maxLife:life,color,size,gravity});
  if(particleFx.length>360)particleFx.splice(0,particleFx.length-360);
}
function spawnDamageParticles(fx){
  const base=Number.isFinite(fx.angle)?fx.angle:-Math.PI/2;
  if(fx.kind==='monster'||fx.kind==='crit'){
    const count=fx.kind==='crit'?14:9;
    for(let i=0;i<count;i++){
      const a=base+(Math.random()-.5)*1.0; const speed=80+Math.random()*120;
      spawnParticle(fx.x+Math.cos(a)*8,fx.y+Math.sin(a)*8,Math.cos(a)*speed,Math.sin(a)*speed-20,520+Math.random()*280,fx.kind==='crit'?'#ffe085':'#b23d48',2+Math.random()*3,40);
    }
    for(let i=0;i<6;i++)spawnParticle(fx.x,fx.y,(Math.random()-.5)*38,-40-Math.random()*60,290,'#fff0dc',1.6,18);
  }else if(fx.kind==='player'){
    for(let i=0;i<8;i++){ const a=base+(Math.random()-.5)*1.1,speed=60+Math.random()*85; spawnParticle(fx.x,fx.y,Math.cos(a)*speed,Math.sin(a)*speed-18,460+Math.random()*180,'#ff998d',2+Math.random()*2,45); }
  }else if(fx.kind==='miss'){
    for(let i=0;i<5;i++)spawnParticle(fx.x,fx.y,(Math.random()-.5)*25,-25-Math.random()*35,300,'#d4f1ff',1.8,15);
  }
}
function spawnEarthImpact(x,y){
  for(let i=0;i<28;i++){
    const a=(Math.PI*2*i)/28+(Math.random()-.5)*.18, speed=70+Math.random()*120;
    spawnParticle(x,y,Math.cos(a)*speed,Math.sin(a)*speed-10,900+Math.random()*240,i%3===0?'#f6d7a3':i%2===0?'#8e6a47':'#d5ba8c',2+Math.random()*3,38);
  }
  for(let i=0;i<20;i++){ const a=(Math.PI*2*i)/20; spawnParticle(x+Math.cos(a)*18,y+Math.sin(a)*10,Math.cos(a)*(35+Math.random()*45),Math.sin(a)*(22+Math.random()*35)-55,700,'#fff2c3',2.2,50); }
}

// ---------- input ----------
function rename(){ emit('name',{name:ui('name').value}); }
ui('rename').addEventListener('click',rename);
ui('name').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); rename(); ui('name').blur(); } });
ui('debug-level').addEventListener('click',()=>emit('debug_level'));
ui('stat-toggle').addEventListener('click',()=>{ ui('stat-panel').hidden=!ui('stat-panel').hidden; renderStats(players.get(myId)||{stats:{},statPoints:0}); });
ui('reset-stats').addEventListener('click',()=>{ if(confirm('Reset all six stats and refund every spent stat point?'))emit('reset_stats'); });
ui('delete-character').addEventListener('click',()=>{
  if(!confirm('Permanently delete your locally saved character and start again at level 1?'))return;
  if(!confirm('This cannot be undone. Delete the character?'))return;
  try{ localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(DELETE_KEY); }catch{}
  readyToSave=false; if(ws){ ws.onclose=null; ws.close(); } location.reload();
});
ui('chat-form').addEventListener('submit',e=>{ e.preventDefault(); const input=ui('chat-input'); const value=input.value.trim(); if(value){ emit('chat',{text:value}); input.value=''; } input.blur(); });
ui('actionbar').addEventListener('click',e=>{ const b=e.target.closest('button[data-slot]'); if(b)useSkill(Number(b.dataset.slot)); });
ui('stat-rows').addEventListener('pointerdown',e=>{ const b=e.target.closest('button[data-stat]'); if(!b||b.disabled)return; e.preventDefault(); releaseStat(); heldStat=b.dataset.stat; emit('stat',{stat:heldStat}); heldStatTimer=setInterval(()=>{ if(heldStat)emit('stat',{stat:heldStat}); },105); });
ui('stat-rows').addEventListener('click',e=>{ if(e.detail===0){ const b=e.target.closest('button[data-stat]'); if(b&&!b.disabled)emit('stat',{stat:b.dataset.stat}); } });
addEventListener('pointerup',releaseStat); addEventListener('pointercancel',releaseStat); addEventListener('blur',()=>{ releaseStat(); attackingHeld=false; keys.clear(); });
function releaseStat(){ heldStat=null; clearInterval(heldStatTimer); heldStatTimer=null; }
function useSkill(slot){ if(slot===1)emit('spin'); else if(slot===2&&players.get(myId))emit('leap',{x:mouseX+cameraX,y:mouseY+cameraY}); }
function handleAction(action){ if(!ws||ws.readyState!==WebSocket.OPEN)return; if(action==='slash'){ const me=players.get(myId); emit('slash',{angle:Math.atan2(mouseY+cameraY-(me?.y||0),mouseX+cameraX-(me?.x||0))}); } else emit(action); }
function sendInput(now){
  let x=0,y=0;
  if(keys.has('a')||keys.has('arrowleft'))x-=1;
  if(keys.has('d')||keys.has('arrowright'))x+=1;
  if(keys.has('w')||keys.has('arrowup'))y-=1;
  if(keys.has('s')||keys.has('arrowdown'))y+=1;
  if(x&&y){ const inv=Math.SQRT1_2; x*=inv; y*=inv; }
  const run=keys.has('shiftleft');
  if(now-lastInput<45&&Math.abs(x-sentInputX)<.001&&Math.abs(y-sentInputY)<.001&&run===sentRun)return;
  sentInputX=x; sentInputY=y; sentRun=run; lastInput=now; emit('input',{x,y,run});
}
addEventListener('keydown',e=>{
  if(document.activeElement===ui('name')||document.activeElement===ui('chat-input')){ if(e.key==='Enter'&&document.activeElement===ui('name')){ e.preventDefault(); rename(); ui('name').blur(); } return; }
  const k=e.key.toLowerCase();
  if(e.code==='Enter'){ e.preventDefault(); ui('chat-input').focus(); return; }
  if(e.code==='Digit1'||e.code==='Digit2'){ e.preventDefault(); if(!e.repeat)useSkill(Number(e.code.slice(-1))); return; }
  if(['Digit3','Digit4','Digit5'].includes(e.code)){ e.preventDefault(); return; }
  if(movement.has(k)){ e.preventDefault(); keys.add(k); return; }
  if(e.code==='Space'||k===' '){ e.preventDefault(); if(!e.repeat)handleAction('jump'); return; }
  if(e.code==='ShiftLeft'){ e.preventDefault(); keys.add('shiftleft'); return; }
});
addEventListener('keyup',e=>{ const k=e.key.toLowerCase(); if(movement.has(k))keys.delete(k); if(e.code==='ShiftLeft')keys.delete('shiftleft'); });
canvas.addEventListener('pointermove',e=>{ mouseX=e.clientX; mouseY=e.clientY; });
canvas.addEventListener('pointerdown',e=>{ if(document.activeElement===ui('name'))ui('name').blur(); if(e.button===0){ mouseX=e.clientX; mouseY=e.clientY; attackingHeld=true; lastAttackSent=performance.now(); handleAction('slash'); } });
addEventListener('pointerup',e=>{ if(e.button===0)attackingHeld=false; });
canvas.addEventListener('contextmenu',e=>e.preventDefault());

// ---------- completely new sprite-based rendering ----------
function rect(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x,y,w,h);}
function ellipse(x,y,rx,ry,c){ctx.fillStyle=c;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function label(text,x,y,color='#fff',size=12){ctx.save();ctx.font=`bold ${size}px system-ui`;ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='rgba(14,17,25,.9)';ctx.strokeText(text,x,y);ctx.fillStyle=color;ctx.fillText(text,x,y);ctx.restore();}
function spriteFrame(name,fw,fh,frame,row,x,y,w=fw,h=fh){
  const im=ART[name];if(!im)return;
  ctx.drawImage(im,frame*fw,row*fh,fw,fh,Math.round(x-w/2),Math.round(y-h),w,h);
}
function directionRow(dir){return ({down:0,left:1,right:2,up:3})[dir]??0;}
function movingAnimation(o,now){return o.motionAt&&now-o.motionAt<150?1+Math.floor(now/115)%3:0;}
function drawPlayer(p,now){
  const x=p.x,y=p.y; const leapAge=now-(p.visualLeapStart||0);
  const jumpAge=now-(p.visualJumpStart||0);
  const leapH=p.visualLeapStart&&leapAge>=0&&leapAge<520?Math.sin(Math.PI*leapAge/520)*46:0;
  const jumpH=p.visualJumpStart&&jumpAge>=0&&jumpAge<480?Math.sin(Math.PI*jumpAge/480)*22:0;
  const height=jumpH+leapH;
  const spinAge=now-(p.visualSpinStart||0),spinning=p.visualSpinStart&&spinAge>=0&&spinAge<3000;
  const slashAge=now-(p.visualAttackStart||0),swing=p.visualAttackStart&&slashAge>=0&&slashAge<240;
  ellipse(x,y+4,15*(1-height/120),5*(1-height/120),'rgba(11,36,25,.33)');
  if(spinning){
    ctx.save();ctx.translate(x,y-height-24);ctx.rotate(spinAge/130);
    for(let k=0;k<4;k++){
      ctx.strokeStyle=k%2?'#e0d4ff':'#fff5bf';ctx.lineWidth=k%2?3:5;
      ctx.globalAlpha=.8-k*.12;ctx.beginPath();ctx.arc(0,0,69,Math.PI*.55*k,Math.PI*.55*k+Math.PI*.9);ctx.stroke();
    }
    ctx.restore();
  }
  ctx.save(); if(Date.now()<p.invulnerableUntil&&Math.floor(now/80)%2===0)ctx.globalAlpha=.5;
  let facing=p.dir||'down';
  const frame=movingAnimation(p,now);
  spriteFrame('hero',54,68,frame,directionRow(facing),x,y-height+8);
  if(swing){
    const angle=Number.isFinite(p.attackAngle)?p.attackAngle:({up:-Math.PI/2,down:Math.PI/2,left:Math.PI,right:0})[facing];
    drawSlash(x,y-height-19,angle,slashAge/240);
  }
  ctx.restore();
  label(`${p.name}  Lv.${p.level}`,x,y-66-height,p.id===myId?'#fff0b6':'#fff',11);
  rect(x-20,y-59-height,40,5,'#172d30');
  rect(x-19,y-58-height,38*Math.max(0,p.hp/p.maxHp),3,'#ef6673');
}
function drawSlash(x,y,angle,q){
  // A tapered, fast moving silver-and-gold slash; no old circular line arc.
  const alpha=Math.sin(Math.min(1,q)*Math.PI);
  ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.globalAlpha=alpha*.96;
  const offset=q*1.8-1.0;
  const a1=-1.17+offset,a2=.08+offset;
  for(let k=0;k<12;k++){
    const a=a1+(a2-a1)*k/11;
    const r=49+Math.sin(k/11*Math.PI)*9;
    ctx.strokeStyle=k%3===0?'#fff8c2':k%3===1?'#d5f3ff':'#ffdda0';
    ctx.lineWidth=2.5+Math.sin(k/11*Math.PI)*4;
    ctx.beginPath();ctx.moveTo(Math.cos(a)*(r-17),Math.sin(a)*(r-17));ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);ctx.stroke();
  }
  ctx.fillStyle='#fff8de';
  for(let i=0;i<4;i++){const a=a1+(a2-a1)*i/3;const r=59;
    ctx.fillRect(Math.cos(a)*r-1,Math.sin(a)*r-1,3,3);
  }
  ctx.restore();
}
function drawMonster(m,now){
  if(!m.alive)return;
  const name=m.type;
  const im=ART[name];if(!im)return;
  const x=m.x,y=m.y;
  const isBoss=name==='baphomet',isJunior=name==='baphometjr';
  const fw=isBoss?120:isJunior?58:name==='bat'?60:58;
  const fh=isBoss?142:isJunior?66:name==='bat'?54:46;
  const floating=(name==='bat'||isBoss)?Math.sin(now/200+m.x)*4:0;
  const frame=movingAnimation(m,now);
  const w=isBoss?126:isJunior?58:name==='bat'?60:58;
  const h=isBoss?149:isJunior?66:name==='bat'?54:46;
  ellipse(x,y+6,isBoss?26:14,isBoss?7:4,'rgba(11,36,25,.36)');
  spriteFrame(name,fw,fh,frame,0,x,y+8+floating,w,h);
  if(Date.now()<m.stunnedUntil){
    for(let i=0;i<4;i++){
      const a=now/210+i*Math.PI/2,px=x+Math.cos(a)*(isBoss?34:17),py=y-h+8+Math.sin(a)*8;
      ctx.fillStyle='#ffe17a';ctx.beginPath();ctx.moveTo(px,py-6);ctx.lineTo(px+3,py-2);ctx.lineTo(px+6,py);ctx.lineTo(px+3,py+2);ctx.lineTo(px,py+6);ctx.lineTo(px-3,py+2);ctx.lineTo(px-6,py);ctx.lineTo(px-3,py-2);ctx.closePath();ctx.fill();
    }
  }
  const nameY=y-h-15+floating;
  label(m.name||name,x,nameY,isBoss?'#ffc99f':'#ffebe2',isBoss?14:11);
  const bw=isBoss?92:isJunior?43:36;
  rect(x-bw/2,y-h-9+floating,bw,6,'#191b2a');
  rect(x-bw/2+1,y-h-8+floating,(bw-2)*Math.max(0,m.hp/m.maxHp),4,isBoss?'#e75f67':isJunior?'#fd83b1':'#e89177');
  if(name==='rat'&&Date.now()<m.chargeUntil){ctx.strokeStyle='#ffd59c';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y-10,23,0,Math.PI*2);ctx.stroke();}
}
function drawProjectile(p){
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(renderNow/240);
  const dark=p.type==='darkbolt';
  ctx.fillStyle=dark?'#402050':'#3978ab';ctx.beginPath();ctx.moveTo(0,-13);ctx.lineTo(11,0);ctx.lineTo(0,13);ctx.lineTo(-11,0);ctx.closePath();ctx.fill();
  ctx.fillStyle=dark?'#efafff':'#d3efff';ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(6,0);ctx.lineTo(0,6);ctx.lineTo(-6,0);ctx.closePath();ctx.fill();
  ctx.restore();
}
function drawObject(obj){
  const im=ART[obj.kind];if(!im)return;
  const x=obj.x,y=obj.y;
  ctx.drawImage(im,Math.round(x-im.width/2),Math.round(y-im.height+13));
}

function drawQuakes(now){
  // Jagged volcanic warning field with animated runic sparks and an exact safe boundary.
  for(const m of monsters.values())if(m.type==='baphomet'&&m.alive&&m.quakeStart){
    const age=Math.min(3000,Math.max(0,now-(m.localQuakeStart||now)));
    const q=age/3000,x=m.quakeX,y=m.quakeY,r=360;
    ctx.save();
    ctx.fillStyle='rgba(147,35,49,.17)';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#f77556';ctx.lineWidth=4;ctx.setLineDash([13,7]);
    ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    for(let k=0;k<26;k++){
      const a=k*Math.PI*2/26+q*.3;
      const bx=x+Math.cos(a)*(r-12),by=y+Math.sin(a)*(r-12);
      ctx.save();ctx.translate(bx,by);ctx.rotate(a);
      ctx.globalAlpha=.5+q*.48;ctx.strokeStyle=k%2?'#ffb565':'#ff756b';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(-5,-4);ctx.lineTo(0,3);ctx.lineTo(5,-4);ctx.moveTo(0,3);ctx.lineTo(0,9);ctx.stroke();ctx.restore();
    }
    // Rock-splitting fissures grow towards the outer ring during the 3-second warning.
    ctx.strokeStyle='rgba(245,130,94,.6)';ctx.lineWidth=2;
    for(let k=0;k<15;k++){
      const a=k*Math.PI*2/15+1.4;
      const length=r*q*.88;
      ctx.beginPath();ctx.moveTo(x+Math.cos(a)*22,y+Math.sin(a)*22);
      for(let t=1;t<=7;t++){
        const dd=20+length*t/7,side=(Math.sin(k*13+t*19)*10)*(t%2?1:-1);
        ctx.lineTo(x+Math.cos(a)*dd-Math.sin(a)*side,y+Math.sin(a)*dd+Math.cos(a)*side);
      }ctx.stroke();
    }
    ctx.restore();
  }
  for(let i=quakeFx.length-1;i>=0;i--){
    const f=quakeFx[i],age=now-f.start;if(age>850){quakeFx.splice(i,1);continue;}
    const q=age/850;
    ctx.save();ctx.globalAlpha=1-q;
    ctx.lineWidth=8*(1-q)+1;ctx.strokeStyle='#ffdab0';
    ctx.beginPath();ctx.arc(f.x,f.y,f.r*(.88+q*.18),0,Math.PI*2);ctx.stroke();
    ctx.strokeStyle='#d2644a';ctx.lineWidth=3*(1-q)+.5;
    for(let k=0;k<20;k++){
      const a=k*Math.PI*2/20,r=f.r*(.5+q*.55);
      ctx.beginPath();ctx.moveTo(f.x+Math.cos(a)*r,f.y+Math.sin(a)*r);
      ctx.lineTo(f.x+Math.cos(a)*(r+30*q),f.y+Math.sin(a)*(r+30*q));ctx.stroke();
    }ctx.restore();
  }
}
function drawBossCastbars(now){
  for(const m of monsters.values())if(m.type==='baphomet'&&m.alive&&m.quakeStart){
    const age=Math.max(0,Math.min(3000,now-(m.localQuakeStart||now))),q=age/3000;
    const x=m.x,y=m.y-169,w=152,h=15;
    ctx.save();label('☄  EARTHQUAKE  ☄',x,y-9,'#ffe0a9',14);
    ctx.fillStyle='#2b1928';ctx.fillRect(x-w/2-3,y-2,w+6,h+4);
    ctx.fillStyle='#6d2e3c';ctx.fillRect(x-w/2,y,w,h);
    ctx.fillStyle='#f6ab58';ctx.fillRect(x-w/2,y,Math.max(0,w*q),h);
    ctx.fillStyle='#ffdc96';ctx.fillRect(x-w/2,y,Math.max(0,w*q),3);
    ctx.strokeStyle='#d4a985';ctx.lineWidth=2;ctx.strokeRect(x-w/2,y,w,h);
    label((3-age/1000).toFixed(1)+'s',x,y+28,'#f7d9b8',11);
    ctx.restore();
  }
}
function drawDamageFx(now){
  for(let i=damageFx.length-1;i>=0;i--){ const f=damageFx[i],age=now-f.start; if(age>850){ damageFx.splice(i,1); continue; } ctx.save(); ctx.globalAlpha=1-age/850; label(f.kind==='miss'?'MISS':String(f.amount),f.x,f.y-22-age*.04,f.kind==='player'?'#ff8080':f.kind==='crit'?'#ffe16e':'#fff',f.kind==='crit'?17:14); ctx.restore(); }
}
function drawCracks(now){
  for(let i=crackFx.length-1;i>=0;i--){
    const fx=crackFx[i],age=now-fx.start;
    if(age>4400){crackFx.splice(i,1);continue;}
    const fade=age<2400?1:1-(age-2400)/2000;
    ctx.save();ctx.translate(fx.x,fx.y);ctx.globalAlpha=fade;
    // Thick dark fractures edged by freshly exposed golden soil.
    for(let k=0;k<14;k++){
      const a=k*2*Math.PI/14;const reach=39+(k%3)*17;
      ctx.strokeStyle='#382c32';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,0);
      ctx.lineTo(Math.cos(a)*22-Math.sin(a)*7,Math.sin(a)*22+Math.cos(a)*7);
      ctx.lineTo(Math.cos(a)*reach,Math.sin(a)*reach);ctx.stroke();
      ctx.strokeStyle='#d3b083';ctx.lineWidth=1.4;ctx.stroke();
      const r=57+(k%4)*6;ctx.fillStyle=k%3?'#685567':'#91766a';
      ctx.save();ctx.translate(Math.cos(a)*r,Math.sin(a)*r);ctx.rotate(a);
      ctx.beginPath();ctx.moveTo(-7,-2);ctx.lineTo(6,-5);ctx.lineTo(8,3);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.restore();
    }
    ctx.strokeStyle='#ead7a5';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,94,0,Math.PI*2);ctx.stroke();
    ctx.restore();
  }
}
function drawParticles(dt){
  for(let i=particleFx.length-1;i>=0;i--){
    const p=particleFx[i];p.life-=dt*1000;
    if(p.life<=0){particleFx.splice(i,1);continue;}
    p.vy+=p.gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
    const q=Math.max(0,p.life/p.maxLife),sz=Math.max(1,Math.round(p.size*(.3+.7*q)));
    ctx.save();ctx.globalAlpha=q;ctx.fillStyle=p.color;
    // Pixel chips, not the former smooth circular particle ellipses.
    ctx.fillRect(Math.round(p.x)-sz/2,Math.round(p.y)-sz/2,sz,sz);
    if(sz>3){ctx.globalAlpha=q*.34;ctx.fillRect(Math.round(p.x)-sz/2-2,Math.round(p.y)-sz/2+1,2,sz-1);}
    ctx.restore();
  }
}
function drawMinimap(){
  const sx=minimap.width/WIDTH,sy=minimap.height/HEIGHT;
  miniCtx.clearRect(0,0,minimap.width,minimap.height); miniCtx.drawImage(miniBase,0,0);
  miniCtx.fillStyle='#00000033'; miniCtx.fillRect(cameraX*sx,cameraY*sy,viewW*sx,viewH*sy);
  miniCtx.strokeStyle='#dff6cd'; miniCtx.lineWidth=1; miniCtx.strokeRect(cameraX*sx+.5,cameraY*sy+.5,Math.max(8,viewW*sx)-1,Math.max(8,viewH*sy)-1);
  for(const m of monsters.values()) if(m.alive){ miniCtx.fillStyle=m.type==='bat'?'#7f6cd2':m.type==='rat'?'#8f6f59':m.type==='baphomet'?'#ff6b6b':'#ff93cb'; miniCtx.fillRect(m.x*sx-(m.type==='baphomet'?2.5:1.5),m.y*sy-(m.type==='baphomet'?2.5:1.5),m.type==='baphomet'?5:3,m.type==='baphomet'?5:3); }
  for(const p of players.values()){ miniCtx.beginPath(); miniCtx.fillStyle=p.id===myId?'#ffef92':'#fff'; miniCtx.arc(p.x*sx,p.y*sy,p.id===myId?3.3:2.5,0,Math.PI*2); miniCtx.fill(); }
  ui('minimap-status').textContent=`${players.size}p · ${[...monsters.values()].filter(m=>m.alive).length}m`;
}

// ---------- frame ----------
function frame(now){
  renderNow=now;
  if(attackingHeld&&now-lastAttackSent>=65&&document.activeElement!==ui('name')&&document.activeElement!==ui('chat-input')){
    lastAttackSent=now; const me=players.get(myId); const cooldown=Math.max(135,400-(me?.stats?.AGI||0)*5); if(now-(me?.visualAttackStart||0)>cooldown-45)handleAction('slash');
  }
  const dt=Math.min((now-last)/1000,.05); last=now; sendInput(now);
  for(const item of [...players.values(),...monsters.values(),...projectiles.values()]){ const f=1-Math.exp(-dt*55); item.x+=(item.tx-item.x)*f; item.y+=(item.ty-item.y)*f; }
  const me=players.get(myId);
  const cooldownBox=ui('skill-cooldown'); const leapBox=ui('leap-cooldown');
  if(me){
    const spinEnd=me.spinCooldownUntil||0; const active=me.visualSpinStart&&now-me.visualSpinStart<3000; const timeLeft=Math.max(0,spinEnd-(Date.now()+serverClockOffset));
    cooldownBox.hidden=active||timeLeft<=0; cooldownBox.textContent=timeLeft>100?Math.ceil(timeLeft/1000)+'s':'';
    const leapLeft=Math.max(0,(me.leapCooldownUntil||0)-(Date.now()+serverClockOffset)); leapBox.hidden=leapLeft<100; leapBox.textContent=leapLeft>=100?Math.ceil(leapLeft/1000)+'s':'';
    const f=1-Math.exp(-dt*24); cameraX+=(me.x-viewW/2-cameraX)*f; cameraY+=(me.y-viewH/2-cameraY)*f;
  }else{ cooldownBox.hidden=true; leapBox.hidden=true; }
  cameraX=viewW>=WIDTH?(WIDTH-viewW)/2:Math.max(0,Math.min(WIDTH-viewW,cameraX));
  cameraY=viewH>=HEIGHT?(HEIGHT-viewH)/2:Math.max(0,Math.min(HEIGHT-viewH,cameraY));

  ctx.clearRect(0,0,viewW,viewH); rect(0,0,viewW,viewH,'#162d25');
  ctx.save(); ctx.translate(-Math.round(cameraX),-Math.round(cameraY));
  const left=Math.max(0,Math.floor(cameraX/TILE)-1), right=Math.min(COLS,Math.ceil((cameraX+viewW)/TILE)+1), top=Math.max(0,Math.floor(cameraY/TILE)-1), bottom=Math.min(ROWS,Math.ceil((cameraY+viewH)/TILE)+1);
  // One continuous image, pixel snapped: there are no 32px background tiles or visible seams.
  const sx=Math.max(0,Math.floor(cameraX)),sy=Math.max(0,Math.floor(cameraY));
  const sw=Math.min(WIDTH-sx,Math.ceil(viewW+2)),sh=Math.min(HEIGHT-sy,Math.ceil(viewH+2));
  ctx.drawImage(ART.world,sx,sy,sw,sh,sx,sy,sw,sh);
  drawCracks(now);drawQuakes(now);
  const actors=[...players.values()].map(p=>({y:p.y,draw:()=>drawPlayer(p,now)}))
    .concat([...monsters.values()].filter(m=>m.alive).map(m=>({y:m.y,draw:()=>drawMonster(m,now)})));
  // Trees, stones, mushrooms and ruins are genuine image sprites and depth-sort with actors.
  const margin=140;
  for(const o of OBJECTS){if(o.x<cameraX-margin||o.x>cameraX+viewW+margin||o.y<cameraY-margin||o.y>cameraY+viewH+margin)continue;
    actors.push({y:o.y,draw:()=>drawObject(o)});
  }
  actors.sort((a,b)=>a.y-b.y).forEach(a=>a.draw());
  for(const b of projectiles.values())drawProjectile(b);
  drawParticles(dt); drawDamageFx(now); drawBossCastbars(now);
  ctx.restore();
  drawMinimap();
  if(now-lastSaved>1000){ lastSaved=now; persist(); }
  requestAnimationFrame(frame);
}

loadWorld().then(()=>{connect();requestAnimationFrame(frame);}).catch(error=>{
  console.error(error);
  ui('status').textContent='Artwork download failed — refresh the page';
});
})();
