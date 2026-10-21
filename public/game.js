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

// ---------- world layout (must mirror server.js) ----------
function hash(x,y,seed=12345){ let n=(Math.imul(x+seed,374761393)+Math.imul(y-seed,668265263))|0; n=Math.imul(n^(n>>>13),1274126177); return ((n^(n>>>16))>>>0)/4294967296; }
function isRiver(tx,ty){ const center=113+Math.sin(ty*0.17)*2+Math.sin(ty*0.043)*1.5; return tx>=center-2&&tx<=center+2; }
function isPond(tx,ty,cx,cy,rx,ry,seed){ return ((tx-cx)/rx)**2+((ty-cy)/ry)**2<1+(hash(tx,ty,seed)-.5)*.26; }
function isBossFloor(tx,ty){ const dx=(tx-102)/9,dy=(ty-40)/8; return dx*dx+dy*dy<1; }
function isBossRing(tx,ty){ const dx=(tx-102)/11,dy=(ty-40)/10; const d=dx*dx+dy*dy; return d<1.08&&d>.72; }
function mainRoadY(tx){ return 41+Math.sin(tx*0.11)*2+Math.sin(tx*0.043)*2; }
function isRoad(tx,ty){
  if(tx>16&&tx<103&&Math.abs(ty-mainRoadY(tx))<=2)return true;
  if(Math.abs(tx-22)<=2&&ty>36&&ty<47)return true;
  if(tx>32&&tx<49&&Math.abs(ty-58)<=2)return true;
  if(Math.abs(tx-44)<=2&&ty>48&&ty<63)return true;
  if(tx>65&&tx<83&&Math.abs(ty-26)<=2)return true;
  if(Math.abs(tx-74)<=2&&ty>25&&ty<42)return true;
  if(isBossRing(tx,ty))return true;
  return false;
}
function isCliff(tx,ty){
  if(ty<12&&tx>7&&tx<109&&!((tx>14&&tx<25)||(tx>54&&tx<64)||(tx>93&&tx<103)))return true;
  if(tx<7&&ty>14&&ty<31)return true;
  if(tx<10&&ty>55&&ty<74)return true;
  if(tx>91&&tx<111&&ty>10&&ty<22)return true;
  if(tx>88&&tx<108&&ty>58&&ty<71)return true;
  return false;
}
function isWater(tx,ty){
  return isRiver(tx,ty)||
    isPond(tx,ty,19,18,7,5,41)||
    isPond(tx,ty,36,61,8,6,73)||
    isPond(tx,ty,77,21,10,6,91)||
    isPond(tx,ty,87,61,7,5,39);
}
function isTree(tx,ty){
  if(isRoad(tx,ty)||isWater(tx,ty)||isCliff(tx,ty)||isBossFloor(tx,ty)||isBossRing(tx,ty))return false;
  const spawnClear=((tx-22)**2+(ty-41)**2)<90;
  const bossClear=((tx-102)**2+(ty-40)**2)<130;
  if(spawnClear||bossClear)return false;
  const grove=((tx-34)**2+(ty-59)**2)<190 || ((tx-76)**2+(ty-23)**2)<160 || ((tx-18)**2+(ty-16)**2)<140;
  const chance=grove?.70:.82;
  return hash(tx,ty,91)>chance&&hash(tx+3,ty-2,57)>.25;
}
function tileAt(tx,ty){
  if(tx<0||ty<0||tx>=COLS||ty>=ROWS)return 'wall';
  if(isWater(tx,ty))return 'water';
  if(isCliff(tx,ty))return 'cliff';
  if(isBossFloor(tx,ty))return 'ruin';
  if(isTree(tx,ty))return 'tree';
  if(isRoad(tx,ty))return 'road';
  return 'grass';
}
function buildMinimapBase(){
  const sx=minimap.width/WIDTH,sy=minimap.height/HEIGHT;
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
    const kind=tileAt(x,y);
    miniBaseCtx.fillStyle=
      kind==='water'?'#76caef':
      kind==='tree'?'#346947':
      kind==='road'?'#cfab72':
      kind==='ruin'?'#6d687a':
      kind==='cliff'?'#7b573d':'#6fc168';
    miniBaseCtx.fillRect(x*TILE*sx,y*TILE*sy,Math.ceil(TILE*sx),Math.ceil(TILE*sy));
  }
  miniBaseCtx.strokeStyle='#d9f2cd33';
  miniBaseCtx.strokeRect(.5,.5,minimap.width-1,minimap.height-1);
}
buildMinimapBase();

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
    players.set(p.id,{...p,tx:p.x,ty:p.y,visualJumpStart:p.jumpAt>0?performance.now():0,visualAttackStart:p.attackAt>0?performance.now():0,visualSpinStart:0,visualLeapStart:0});
  }
}
function updateMonster(m){
  if(!m)return;
  const old=monsters.get(m.id);
  if(old){
    const castNew=m.quakeStart&&m.quakeStart!==old.quakeStart;
    Object.assign(old,{...m,tx:m.x,ty:m.y,x:old.x,y:old.y});
    if(castNew)old.localQuakeStart=performance.now();
    if(!m.quakeStart)old.localQuakeStart=0;
  }else monsters.set(m.id,{...m,tx:m.x,ty:m.y,localQuakeStart:m.quakeStart?performance.now():0});
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

// ---------- drawing helpers ----------
function rect(x,y,w,h,c){ ctx.fillStyle=c; ctx.fillRect(x,y,w,h); }
function ellipse(x,y,rx,ry,c){ ctx.fillStyle=c; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill(); }
function label(text,x,y,color='#fff',size=12){ ctx.save(); ctx.font=`bold ${size}px system-ui`; ctx.textAlign='center'; ctx.lineWidth=3; ctx.strokeStyle='rgba(0,0,0,.55)'; ctx.strokeText(text,x,y); ctx.fillStyle=color; ctx.fillText(text,x,y); ctx.restore(); }
function diamond(x,y,w,h,c){ ctx.fillStyle=c; ctx.beginPath(); ctx.moveTo(x,y-h); ctx.lineTo(x+w,y); ctx.lineTo(x,y+h); ctx.lineTo(x-w,y); ctx.closePath(); ctx.fill(); }

function drawTile(tx,ty){
  const px=tx*TILE, py=ty*TILE, kind=tileAt(tx,ty);
  const v=hash(tx,ty),v2=hash(tx,ty,77),v3=hash(tx,ty,913);
  if(kind==='water'){
    rect(px,py,TILE,TILE,'#7bcaf0'); rect(px+2,py+2,28,28,'#6bbce6');
    rect(px+4+(v*8|0),py+6,12,2,'#d7f6ff'); rect(px+15,py+17,9,2,'#a6e9ff'); rect(px+8,py+25,10,2,'#4b9bc8');
    if(isRiver(tx,ty)&&tx>110){ rect(px,py,3,TILE,'#dff8ff'); rect(px+3,py,2,TILE,'#8dd2f2'); }
    return;
  }
  if(kind==='cliff'){
    rect(px,py,TILE,TILE,'#8c6345'); rect(px,py+4,TILE,28,'#7c553d'); rect(px,py,32,5,'#9ed178');
    ctx.strokeStyle='#5d3d2b'; ctx.lineWidth=2;
    for(let i=0;i<4;i++){ ctx.beginPath(); ctx.moveTo(px+3,py+7+i*6); ctx.lineTo(px+28,py+12+i*5); ctx.stroke(); }
    for(let i=0;i<6;i++) rect(px+((i*5+v2*7)%27|0),py+5+((i*4)%21),2,8,'#9d7556');
    return;
  }
  if(kind==='ruin'){
    rect(px,py,TILE,TILE,'#7f7b8f'); rect(px+2,py+2,28,28,'#6d687a');
    rect(px+2,py+2,13,13,'#8f8ba1'); rect(px+17,py+2,13,13,'#79758d'); rect(px+2,py+17,13,13,'#79758d'); rect(px+17,py+17,13,13,'#8a869d');
    if(v>.45){ ctx.strokeStyle='#514d5d'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(px+6,py+14); ctx.lineTo(px+12,py+10); ctx.lineTo(px+19,py+13); ctx.lineTo(px+24,py+8); ctx.stroke(); }
    return;
  }
  if(kind==='road'){
    rect(px,py,TILE,TILE,'#cbac77'); rect(px+2,py+2,28,28,'#d7b883');
    rect(px+6,py+8,3,2,'#b68d59'); rect(px+17,py+19,2,2,'#b68d59'); rect(px+24,py+11,3,2,'#e7c99c');
    if(v2>.7) rect(px+10,py+24,4,2,'#b68d59');
  }else{
    rect(px,py,TILE,TILE,'#6cc061'); rect(px+2,py+2,28,28,'#79ca6e');
    if(v>.28){ rect(px+6,py+10,2,7,'#58a750'); rect(px+11,py+6,2,10,'#58a750'); rect(px+22,py+17,2,6,'#58a750'); }
    if(v2>.76){ rect(px+8,py+13,3,3,'#9ed7ff'); rect(px+11,py+11,3,3,'#9ed7ff'); rect(px+13,py+14,3,3,'#9ed7ff'); }
    if(v2<.08){ rect(px+20,py+10,3,3,'#f8a7d5'); rect(px+23,py+13,3,3,'#f8a7d5'); }
    if(v3>.9){ rect(px+15,py+20,2,2,'#ffe98a'); rect(px+17,py+21,2,2,'#ffe98a'); }
  }
  if(kind==='tree'){
    const variant=hash(tx,ty,501);
    ellipse(px+16,py+27,14,5,'#22473077'); rect(px+13,py+15,6,13,'#6c4b36'); rect(px+14,py+27,4,3,'#573726');
    if(variant<.18){ // blossom
      ellipse(px+16,py+16,12,10,'#f1b4d2'); ellipse(px+10,py+13,9,8,'#f7c7de'); ellipse(px+21,py+12,9,8,'#f0a6c7'); ellipse(px+16,py+8,8,7,'#ffd9eb');
    }else if(variant>.72){ // pine
      ctx.fillStyle='#2d6a45'; ctx.beginPath(); ctx.moveTo(px+16,py+2); ctx.lineTo(px+5,py+16); ctx.lineTo(px+11,py+16); ctx.lineTo(px+3,py+25); ctx.lineTo(px+29,py+25); ctx.lineTo(px+21,py+16); ctx.lineTo(px+27,py+16); ctx.closePath(); ctx.fill();
      ctx.fillStyle='#3b8f5d'; ctx.beginPath(); ctx.moveTo(px+16,py+4); ctx.lineTo(px+8,py+15); ctx.lineTo(px+24,py+15); ctx.closePath(); ctx.fill();
    }else{ // round tree
      ellipse(px+16,py+15,13,11,'#2f6f46'); ellipse(px+11,py+12,10,9,'#3d8a58'); ellipse(px+21,py+12,9,8,'#3a7d53'); ellipse(px+16,py+8,8,7,'#61b26d');
    }
  }
}

function drawPlayer(p,now){
  const x=p.x,y=p.y;
  const walking=Math.hypot(p.tx-p.x,p.ty-p.y)>.2;
  const bob=walking?Math.sin(now/95)*1.25:0;
  const jumpAge=now-(p.visualJumpStart||0), jumping=jumpAge>=0&&jumpAge<470;
  const jumpH=jumping?Math.sin(jumpAge/470*Math.PI)*18:0;
  const shadowScale=1-jumpH/28;
  const leapAge=now-(p.visualLeapStart||0), leapH=(p.visualLeapStart&&leapAge>=0&&leapAge<520)?Math.sin(leapAge/520*Math.PI)*46:0;
  const slashAge=now-(p.visualAttackStart||0), swing=slashAge>=0&&slashAge<230;
  const spinAge=now-(p.visualSpinStart||0), spinning=(p.visualSpinStart&&spinAge>=0&&spinAge<3000);
  ellipse(x,y+12,12*shadowScale,4.5*shadowScale,'#1839227f');
  ctx.save(); ctx.translate(0,-jumpH-leapH);
  if(spinning){ ctx.translate(x,y); ctx.rotate(spinAge/95); ctx.translate(-x,-y); }
  if(Date.now()<p.invulnerableUntil&&Math.floor(now/85)%2===0)ctx.globalAlpha=.45;
  const skin='#f2ca9f',hairDark='#8b5122',hairLight='#d88a43',cape='#c84d5a',capeDark='#a5333d',tunic='#356dca',trim='#f6d67a',boots='#6c4325',metal='#ecf1f3',metalDark='#b7c8d2';
  const dirs={up:-Math.PI/2,down:Math.PI/2,left:Math.PI,right:0};
  const face=swing&&Number.isFinite(p.attackAngle)?p.attackAngle:(dirs[p.dir]??Math.PI/2);
  const bladeAngle=face+(swing?(-1.25+2.5*(slashAge/230)):.55);

  // cape back and legs
  rect(x-12,y-6+bob,6,18,capeDark); rect(x+6,y-6+bob,6,18,capeDark);
  rect(x-8,y+5+bob,5,11,boots); rect(x+3,y+5-bob,5,11,boots); rect(x-8,y+15+bob,5,2,'#3f2619'); rect(x+3,y+15-bob,5,2,'#3f2619');
  // torso
  rect(x-10,y-10+bob,20,18,'#233247'); rect(x-8,y-8+bob,16,15,tunic); rect(x-2,y-8+bob,4,15,trim); rect(x-8,y-1+bob,16,2,'#4b8ae5');
  // arms
  rect(x-12,y-7+bob,4,10,skin); rect(x+8,y-7+bob,4,10,skin); rect(x-13,y-3+bob,3,5,'#214b8a');
  // shield
  ctx.save(); ctx.translate(x-13,y-4+bob); ctx.rotate(p.dir==='left'?-0.25:p.dir==='right'?0.25:0);
  ctx.fillStyle='#3f66bb'; ctx.beginPath(); ctx.moveTo(0,-8); ctx.lineTo(8,-11); ctx.lineTo(12,-2); ctx.lineTo(8,10); ctx.lineTo(0,7); ctx.closePath(); ctx.fill();
  ctx.strokeStyle=trim; ctx.lineWidth=1.6; ctx.stroke(); ctx.restore();
  // head
  rect(x-8,y-24+bob,16,6,hairDark); rect(x-10,y-20+bob,4,5,hairDark); rect(x+6,y-19+bob,3,4,hairDark); rect(x-7,y-20+bob,14,11,skin);
  rect(x-6,y-25+bob,7,3,hairLight); rect(x+1,y-24+bob,6,2,hairLight); rect(x+4,y-19+bob,3,2,hairLight);
  rect(x-4,y-15+bob,2,2,'#2b2b30'); rect(x+2,y-15+bob,2,2,'#2b2b30'); if(p.dir==='left'){ rect(x-5,y-15+bob,2,2,'#2b2b30'); } if(p.dir==='right'){ rect(x+3,y-15+bob,2,2,'#2b2b30'); } if(p.dir==='down'){ rect(x-1,y-11+bob,2,1,'#db8c90'); }
  // sword
  ctx.save(); ctx.translate(x,y-4+bob); ctx.rotate(bladeAngle);
  rect(10,-2,11,4,'#6f4a2d'); rect(20,-7,3,14,trim);
  ctx.fillStyle=metal; ctx.beginPath(); ctx.moveTo(23,-3); ctx.lineTo(40,-2); ctx.lineTo(49,0); ctx.lineTo(40,2); ctx.lineTo(23,3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle=metalDark; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(24,0); ctx.lineTo(45,0); ctx.stroke(); ctx.restore();
  if(spinning){ ctx.save(); ctx.translate(x,y-3+bob); ctx.strokeStyle='#fff1b6'; ctx.lineWidth=5; ctx.globalAlpha=.75; ctx.beginPath(); ctx.arc(0,0,82,0,Math.PI*2); ctx.stroke(); ctx.restore(); }
  if(swing){
    ctx.save(); ctx.translate(x,y-3+bob); ctx.rotate(face); ctx.strokeStyle='#fff4bf'; ctx.lineWidth=5; ctx.lineCap='round'; ctx.beginPath(); ctx.arc(0,0,62,-1.18+slashAge/230*1.5,-.75+slashAge/230*1.5); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.translate(x,y-3+bob); ctx.rotate(face); ctx.strokeStyle='rgba(255,255,255,.65)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,55,-1.1+slashAge/230*1.45,-.8+slashAge/230*1.45); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
  label(`${p.name}  Lv.${p.level}`,x,y-38-jumpH-leapH+bob,p.id===myId?'#fff3a5':'#fff',11);
  rect(x-18,y-32-jumpH-leapH+bob,36,4,'#183022'); rect(x-18,y-32-jumpH-leapH+bob,36*Math.max(0,p.hp/p.maxHp),4,'#e86c71');
}

function drawMonster(m,now){
  if(!m.alive)return;
  const x=m.x,y=m.y; const floating=(m.type==='bat'||m.type==='baphomet')?Math.sin(now/180+m.x)*4:0;
  ellipse(x,y+(m.type==='baphomet'?17:10),m.type==='baphomet'?23:(m.type==='baphometjr'?13:11),m.type==='baphomet'?7:4,'#1839227f');
  if(m.type==='rat'){
    ellipse(x-2,y+1,14,10,'#6c625f'); ellipse(x+11,y-2,7,6,'#857875'); ellipse(x+15,y-7,3,4,'#958987'); ellipse(x+8,y-8,3,4,'#958987');
    rect(x+11,y-3,2,2,'#e85a6e'); rect(x+15,y-1,2,2,'#fff2dd'); rect(x+15,y+1,2,2,'#fff2dd');
    ctx.strokeStyle='#9e8e8b'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x-12,y+6); ctx.quadraticCurveTo(x-26,y+14,x-28,y-1); ctx.stroke();
  }else if(m.type==='bat'){
    ctx.fillStyle='#5d496e'; ctx.beginPath(); ctx.moveTo(x-3,y-8+floating); ctx.lineTo(x-23,y-18+floating); ctx.lineTo(x-18,y+3+floating); ctx.lineTo(x-4,y+1+floating); ctx.moveTo(x+3,y-8+floating); ctx.lineTo(x+23,y-18+floating); ctx.lineTo(x+18,y+3+floating); ctx.lineTo(x+4,y+1+floating); ctx.fill();
    ellipse(x,y-5+floating,10,10,'#7d6690'); rect(x-6,y-7+floating,3,3,'#ef6e88'); rect(x+3,y-7+floating,3,3,'#ef6e88'); rect(x-2,y-1+floating,4,2,'#f7d2e3');
  }else if(m.type==='baphomet'){
    ctx.save(); ctx.translate(x,y-5+floating);
    ellipse(0,18,12,4,'#4c2632'); rect(-17,6,12,24,'#2e2740'); rect(5,6,12,24,'#2e2740');
    rect(-22,-1,44,24,'#5f5454'); rect(-12,-4,24,14,'#c7b48c'); rect(-4,3,8,10,'#221516'); rect(-10,-12,4,4,'#ff3845'); rect(6,-12,4,4,'#ff3845');
    ctx.fillStyle='#6b5d58'; ctx.beginPath(); ctx.moveTo(-18,-25); ctx.lineTo(-8,-46); ctx.lineTo(0,-35); ctx.lineTo(-12,-18); ctx.closePath(); ctx.moveTo(18,-25); ctx.lineTo(8,-46); ctx.lineTo(0,-35); ctx.lineTo(12,-18); ctx.closePath(); ctx.fill();
    rect(-2,-55,4,18,'#5b3529'); ctx.fillStyle='#f25c2b'; ctx.beginPath(); ctx.moveTo(0,-63); ctx.lineTo(6,-53); ctx.lineTo(0,-48); ctx.lineTo(-6,-53); ctx.closePath(); ctx.fill(); ctx.fillStyle='#f5b246'; ctx.beginPath(); ctx.arc(0,-60,5,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }else if(m.type==='baphometjr'){
    ctx.save(); ctx.translate(x,y+floating);
    ellipse(0,0,12,14,'#ffabd2'); rect(-6,9,12,6,'#7d3174'); rect(-5,-4,3,3,'#fff4ff'); rect(2,-4,3,3,'#fff4ff'); rect(-4,-5,2,2,'#4e243f'); rect(3,-5,2,2,'#4e243f');
    ctx.fillStyle='#c257a1'; ctx.beginPath(); ctx.moveTo(-7,-7); ctx.lineTo(-15,-20); ctx.lineTo(-8,-18); ctx.lineTo(-3,-9); ctx.closePath(); ctx.moveTo(7,-7); ctx.lineTo(15,-20); ctx.lineTo(8,-18); ctx.lineTo(3,-9); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#ff7f9b'; ctx.beginPath(); ctx.arc(0,-16,7,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#ff5c6c'; ctx.beginPath(); ctx.moveTo(0,-27); ctx.lineTo(4,-18); ctx.lineTo(0,-15); ctx.lineTo(-4,-18); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const name=m.name||(m.type==='bat'?'Bat':m.type==='rat'?'Rat':m.type==='baphomet'?'Baphomet':'Baphomet.Jr');
  const nameY=y-(m.type==='baphomet'?60:27)+floating;
  label(name,x,nameY,m.type==='baphomet'?'#ffd1ae':'#ffecdf',m.type==='baphomet'?12:11);
  const bw=m.type==='baphomet'?66:m.type==='baphometjr'?36:30;
  rect(x-bw/2,y-(m.type==='baphomet'?53:23)+floating,bw,5,'#24342a');
  rect(x-bw/2,y-(m.type==='baphomet'?53:23)+floating,bw*Math.max(0,m.hp/m.maxHp),5,m.type==='baphomet'?'#c04d5b':m.type==='baphometjr'?'#ff85b6':'#e67d78');
  if(Date.now()<m.stunnedUntil){
    for(let i=0;i<3;i++){ const a=now/180+i*Math.PI*2/3; diamond(x+Math.cos(a)*13,y-(m.type==='baphomet'?68:37)+floating+Math.sin(a)*4,4,4,'#ffe299'); }
    label('STUN',x,y-(m.type==='baphomet'?78:46)+floating,'#ffe4a2',10);
  }
  if(m.type==='rat'&&Date.now()<m.chargeUntil){ ctx.strokeStyle='#ffd99f'; ctx.lineWidth=2; ctx.strokeRect(x-17,y-13,34,25); }
}

function drawProjectile(p){
  if(p.type==='darkbolt'){
    ellipse(p.x,p.y,11,11,'#6f44a2'); ellipse(p.x,p.y,5,5,'#ead0ff'); ctx.strokeStyle='#c996ff'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(p.x,p.y,14,0,Math.PI*2); ctx.stroke();
  }else{ ellipse(p.x,p.y,7,7,'#90a8d8'); ellipse(p.x-2,p.y-2,3,3,'#ecf4ff'); ctx.strokeStyle='#d9efff'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(p.x-9,p.y); ctx.lineTo(p.x-2,p.y); ctx.stroke(); }
}
function drawQuakes(now){
  for(const m of monsters.values()) if(m.type==='baphomet'&&m.alive&&m.quakeStart){
    const age=Math.min(3000,Math.max(0,now-(m.localQuakeStart||now))),progress=age/3000; const x=m.quakeX,y=m.quakeY,r=360;
    ctx.save(); ctx.fillStyle='rgba(180,50,39,0.16)'; ctx.strokeStyle='#ff5b45'; ctx.lineWidth=5; ctx.setLineDash([15,10]); ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle='#ffbb56'; ctx.lineWidth=4; ctx.beginPath(); ctx.arc(x,y,r*(1-progress),0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='rgba(255,60,35,0.10)'; ctx.beginPath(); ctx.arc(x,y,r*Math.min(1,progress*1.1),0,Math.PI*2); ctx.fill(); ctx.restore();
  }
  for(let i=quakeFx.length-1;i>=0;i--){ const f=quakeFx[i],age=now-f.start; if(age>700){ quakeFx.splice(i,1); continue; } ctx.save(); ctx.globalAlpha=1-age/700; ctx.strokeStyle='#ffe9ac'; ctx.lineWidth=9*(1-age/700)+1; ctx.beginPath(); ctx.arc(f.x,f.y,f.r*(.92+age/700*.12),0,Math.PI*2); ctx.stroke(); ctx.restore(); }
}
function drawBossCastbars(now){
  for(const m of monsters.values()) if(m.type==='baphomet'&&m.alive&&m.quakeStart){
    const age=Math.max(0,Math.min(3000,now-(m.localQuakeStart||now))),ratio=age/3000; const x=m.x,y=m.y-103,w=128,h=12;
    ctx.save(); ctx.font='bold 13px system-ui'; ctx.textAlign='center'; ctx.lineWidth=3; ctx.strokeStyle='#301715'; ctx.strokeText('EARTHQUAKE',x,y-13); ctx.fillStyle='#ffcc85'; ctx.fillText('EARTHQUAKE',x,y-13);
    rect(x-w/2-2,y-2,w+4,h+4,'#251b1b'); rect(x-w/2,y,w,h,'#823629'); rect(x-w/2,y,w*ratio,h,'#ffa14c'); ctx.strokeStyle='#ffe0af'; ctx.strokeRect(x-w/2,y,w,h); ctx.restore();
  }
}
function drawDamageFx(now){
  for(let i=damageFx.length-1;i>=0;i--){ const f=damageFx[i],age=now-f.start; if(age>850){ damageFx.splice(i,1); continue; } ctx.save(); ctx.globalAlpha=1-age/850; label(f.kind==='miss'?'MISS':String(f.amount),f.x,f.y-22-age*.04,f.kind==='player'?'#ff8080':f.kind==='crit'?'#ffe16e':'#fff',f.kind==='crit'?17:14); ctx.restore(); }
}
function drawCracks(now){
  for(let i=crackFx.length-1;i>=0;i--){ const fx=crackFx[i],age=now-fx.start; if(age>4400){ crackFx.splice(i,1); continue; }
    ctx.save(); ctx.translate(fx.x,fx.y); ctx.globalAlpha=age<1900?.85:.85*(1-(age-1900)/2500); ctx.strokeStyle='#362d25'; ctx.lineWidth=3;
    for(let k=0;k<12;k++){ const a=k*Math.PI/6,reach=28+(k%3)*14; ctx.beginPath(); ctx.moveTo(Math.cos(a)*5,Math.sin(a)*5); ctx.lineTo(Math.cos(a)*reach*.55-Math.sin(a)*5,Math.sin(a)*reach*.55+Math.cos(a)*5); ctx.lineTo(Math.cos(a)*reach,Math.sin(a)*reach); ctx.stroke(); }
    ctx.strokeStyle='#e4c48e'; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(0,0,90,0,Math.PI*2); ctx.stroke(); ctx.restore();
  }
}
function drawParticles(dt){
  for(let i=particleFx.length-1;i>=0;i--){ const p=particleFx[i]; p.life-=dt*1000; if(p.life<=0){ particleFx.splice(i,1); continue; } p.vy+=p.gravity*dt; p.x+=p.vx*dt; p.y+=p.vy*dt; ctx.save(); ctx.globalAlpha=Math.max(0,p.life/p.maxLife); ellipse(p.x,p.y,p.size,p.size*.7,p.color); ctx.restore(); }
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
  for(let y=top;y<bottom;y++) for(let x=left;x<right;x++) drawTile(x,y);
  drawCracks(now); drawQuakes(now);
  const actors=[...players.values()].map(p=>({y:p.y,draw:()=>drawPlayer(p,now)})).concat([...monsters.values()].filter(m=>m.alive).map(m=>({y:m.y,draw:()=>drawMonster(m,now)})));
  actors.sort((a,b)=>a.y-b.y).forEach(a=>a.draw());
  for(const b of projectiles.values())drawProjectile(b);
  drawParticles(dt); drawDamageFx(now); drawBossCastbars(now);
  ctx.restore();
  drawMinimap();
  if(now-lastSaved>1000){ lastSaved=now; persist(); }
  requestAnimationFrame(frame);
}

connect(); requestAnimationFrame(frame);
})();
