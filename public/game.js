// Meadow Multiplayer client
// Original authored sprite atlas, continuous pixel-art world and authoritative shared map.
(()=>{'use strict';
const canvas=document.getElementById('game');
const ctx=canvas.getContext('2d');
const ui=id=>document.getElementById(id);
const minimap=ui('minimap');
const miniCtx=minimap.getContext('2d');
const miniBase=document.createElement('canvas');
miniBase.width=minimap.width; miniBase.height=minimap.height;
const miniBaseCtx=miniBase.getContext('2d');

const WORLD=window.MEADOW_WORLD;
const ART=window.MEADOW_ART;
if(!WORLD||!ART)throw new Error('Required world and sprite data not loaded');
const TILE=WORLD.tile,COLS=WORLD.rows[0].length,ROWS=WORLD.rows.length,WIDTH=WORLD.width,HEIGHT=WORLD.height;
const worldImage=new Image(),atlasImage=new Image();
let artLoaded=0;
for(const [im,src] of [[worldImage,'assets/world.png'],[atlasImage,'assets/atlas.png']]){
  im.onload=()=>{artLoaded++;};
  im.onerror=()=>{ui('status').textContent='Pixel art failed to load: '+src;};
  im.src=src;
}
const groundProps=WORLD.props.map(([x,y,type,variant])=>({x,y,type,variant}));
// Exact transparent atlas frames, bottom-center anchored to an object's foot position.
function sprite(key,x,y,scale=1){
  const a=ART[key];if(!a||!atlasImage.complete||!atlasImage.naturalWidth)return;
  const [sx,sy,sw,sh]=a;const ww=Math.round(sw*scale),hh=Math.round(sh*scale);
  ctx.drawImage(atlasImage,sx,sy,sw,sh,Math.round(x-ww/2),Math.round(y-hh),ww,hh);
}
function propSprite(p){
  const key=p.type+'_'+(ART[p.type+'_'+p.variant]?p.variant:0);
  const shadowW=['cottage','barn','windmill'].includes(p.type)?60:['oak','pine','willow','blossom'].includes(p.type)?28:11;
  ellipse(p.x,p.y-1,shadowW,Math.max(3,shadowW/5),'#1b393655');
  sprite(key,p.x,p.y,1);
  if(p.type==='campfire'){
    const t=renderNow/195;ctx.fillStyle='#ffdf8970';ctx.fillRect(p.x-2+Math.sin(t)*3,p.y-46+Math.sin(t*2)*4,4,4);
  }
  if(p.type==='lantern'){
    ctx.fillStyle='#ffd88a44';ctx.fillRect(p.x-7,p.y-66,14,14);
  }
}
const SERVER_URL='';
const STORAGE_KEY='meadow-rpg-save-v1';
const DELETE_KEY='meadow-rpg-delete-on-reconnect';
const SERVER_VERSION_KEY='meadow-rpg-server-version-v1';
const MAX_LEVEL=99;
const STAT_DESC={STR:'Melee damage',AGI:'Attack speed',VIT:'Maximum HP',INT:'Magic damage (future spells)',DEX:'Hit rating / accuracy',LUK:'Critical rate and damage'};
const players=new Map(),monsters=new Map(),projectiles=new Map();
const damageFx=[],crackFx=[],particleFx=[],quakeFx=[],deathFx=[];
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

// ---------- shared authored world (also required by server.js) ----------
const kinds={g:'grass',d:'road',w:'water',c:'cliff',r:'ruin',t:'tree'};
function tileAt(tx,ty){
  if(tx<0||ty<0||tx>=COLS||ty>=ROWS)return 'wall';
  return kinds[WORLD.rows[ty][tx]]||'wall';
}
function buildMinimapBase(){
  const sx=minimap.width/WIDTH,sy=minimap.height/HEIGHT;
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    const kind=tileAt(x,y);
    miniBaseCtx.fillStyle=kind==='water'?'#367f98':kind==='tree'?'#284e42':kind==='road'?'#ceb185':kind==='ruin'?'#a5aa90':kind==='cliff'?'#775844':'#659456';
    miniBaseCtx.fillRect(x*TILE*sx,y*TILE*sy,Math.ceil(TILE*sx),Math.ceil(TILE*sy));
  }
  miniBaseCtx.strokeStyle='#d9f2cd33';miniBaseCtx.strokeRect(.5,.5,minimap.width-1,minimap.height-1);
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
      for(const id of monsters.keys()) if(!mids.has(id)){
        const old=monsters.get(id);if(old?.alive)spawnDefeatFx(old);
        monsters.delete(id);
      }
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
    if(old.alive&&!m.alive)spawnDefeatFx(old);
    if(old.alive&&m.alive&&Number.isFinite(m.hp)&&m.hp<old.hp)old.hitFlashUntil=performance.now()+155;
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

function drawSlash(x,y,angle,progress,spin=false){
  // Layered faceted sword arcs with pixel-fragment edge highlights, not a primitive circle.
  ctx.save();ctx.translate(x,y-20);ctx.rotate(angle);
  const a=-1.23+progress*2.5;
  for(let i=0;i<10;i++){
    const t=i/9,theta=a-t*.85;
    const outer=53-t*4,inner=outer-6-(1-t)*7;
    const c=Math.cos(theta),s=Math.sin(theta),c2=Math.cos(theta-.08),s2=Math.sin(theta-.08);
    ctx.fillStyle=i%3===0?'#fff7ce':i%2===0?'#b9eef1':'#e7f6dd';
    ctx.beginPath();ctx.moveTo(c*inner,s*inner);ctx.lineTo(c*outer,s*outer);
    ctx.lineTo(c2*outer,s2*outer);ctx.lineTo(c2*inner,s2*inner);ctx.fill();
  }
  for(let j=0;j<6;j++){
    const t=j/6,ang=a-j*.21;
    rect(Math.cos(ang)*58-2,Math.sin(ang)*58-2,2+j%2*2,3,j%2?'#f9e9b1':'#bbf7e5');
  }
  ctx.restore();
}
function drawPlayer(p,now){
  const x=p.x,y=p.y;
  // Only movement INPUT changes facing on the server; idle and attack retain last walk direction.
  const moving=Math.hypot(p.tx-p.x,p.ty-p.y)>.7;
  const frame=moving?Math.floor(now/135)%4:0;
  const jumpAge=now-(p.visualJumpStart||0),jumping=jumpAge>=0&&jumpAge<470;
  const jumpH=jumping?Math.sin(jumpAge/470*Math.PI)*19:0;
  const leapAge=now-(p.visualLeapStart||0);
  const leapH=(p.visualLeapStart&&leapAge>=0&&leapAge<520)?Math.sin(leapAge/520*Math.PI)*43:0;
  const slashAge=now-(p.visualAttackStart||0),swing=slashAge>=0&&slashAge<240;
  const spinAge=now-(p.visualSpinStart||0),spinning=p.visualSpinStart&&spinAge>=0&&spinAge<3000;
  ellipse(x,y+7,17*(1-jumpH/43),5*(1-jumpH/43),'#162d2855');
  ctx.save();ctx.translate(0,-jumpH-leapH);
  if(Date.now()<p.invulnerableUntil&&Math.floor(now/95)%2===0)ctx.globalAlpha=.46;
  // Character silhouettes from original four-direction x four-frame atlas.
  sprite('hero_'+(p.dir||'down')+'_'+frame,x,y+15,.80);
  const dirs={up:-Math.PI/2,down:Math.PI/2,left:Math.PI,right:0};
  const face=swing&&Number.isFinite(p.attackAngle)?p.attackAngle:(dirs[p.dir]??Math.PI/2);
  const bladeAngle=face+(swing?(-1.35+2.8*slashAge/240):.55);
  // Gilded aquamarine blade lives in sprite atlas as its own transparent weapon.
  ctx.save();ctx.translate(x,y-16);ctx.rotate(bladeAngle);
  sprite('sword_0',28,17,.76);ctx.restore();
  if(swing)drawSlash(x,y,face,slashAge/240);
  if(spinning){
    for(let i=0;i<4;i++)drawSlash(x,y,spinAge/150+i*Math.PI/2,.65,true);
    for(let j=0;j<8;j++){
      const ang=spinAge/180+j*Math.PI/4;
      rect(x+Math.cos(ang)*75,y-18+Math.sin(ang)*36,4,5,j%2?'#ffe6a1':'#a8eee2');
    }
  }
  ctx.restore();
  label(`${p.name}  Lv.${p.level}`,x,y-59-jumpH-leapH,p.id===myId?'#fff3a5':'#fff',11);
  rect(x-19,y-53-jumpH-leapH,38,4,'#183022');
  rect(x-19,y-53-jumpH-leapH,38*Math.max(0,p.hp/p.maxHp),4,'#e86c71');
}
function drawMonster(m,now){
  if(!m.alive)return;
  const x=m.x,y=m.y;
  const boss=m.type==='baphomet',flying=m.type==='bat';
  const floating=flying?Math.sin(now/175+m.x)*5:boss?Math.sin(now/280+m.x)*2:0;
  const frame=Math.floor((now+(m.x*7)%300)/180)%4;
  const scale=boss?.94:m.type==='baphometjr'?.83:.86;
  const sw=ART[m.type+'_'+frame]||ART[m.type+'_0'];
  ellipse(x,y+(boss?13:8),boss?45:14,boss?11:4,'#17392c77');
  ctx.save();
  if(m.hitFlashUntil>now)ctx.filter='brightness(1.9) saturate(.65)';
  sprite(m.type+'_'+frame,x,y+16+floating,scale);
  ctx.restore();
  if(Date.now()<m.chargeUntil&&m.type==='rat'){
    for(let j=0;j<5;j++)rect(x-25+j*5,y+20+Math.sin(now/90+j)*5,3,3,'#d5b07f');
  }
  if(boss){
    // Ruin guardian's runic embers signal attack / cast without primitive circles.
    for(let j=0;j<4;j++){
      const a=now/560+j*Math.PI/2;
      rect(x+Math.cos(a)*61,y-57+Math.sin(a)*18,5,7,j%2?'#9bdec0':'#ffd194');
    }
  }
  const name=m.name||(boss?'Baphomet':m.type==='bat'?'Bat':m.type==='rat'?'Rat':'Baphomet.Jr');
  const ny=y-(boss?116:43)+floating;
  label(name,x,ny,boss?'#ffe3b5':'#ffeddb',boss?13:11);
  const bw=boss?105:m.type==='baphometjr'?41:38;
  const by=y-(boss?109:37)+floating;
  rect(x-bw/2,by,bw,5,'#24342a');
  rect(x-bw/2,by,bw*Math.max(0,m.hp/m.maxHp),5,boss?'#df927a':'#e67d78');
  if(Date.now()<m.stunnedUntil){
    for(let i=0;i<3;i++){
      const a=now/180+i*Math.PI*2/3;
      diamond(x+Math.cos(a)*16,y-(boss?123:58)+floating+Math.sin(a)*6,4,5,'#ffe299');
    }
    label('STUN',x,y-(boss?136:69)+floating,'#ffe4a2',10);
  }
}

function spawnDefeatFx(m){
  const start=performance.now();deathFx.push({x:m.x,y:m.y,type:m.type,start});
  if(deathFx.length>90)deathFx.shift();
  // Original pixel confetti: moss flakes and faint magical ember pixels.
  const isBoss=m.type==='baphomet',n=isBoss?45:15;
  for(let i=0;i<n;i++){
    const a=(i/n)*Math.PI*2,velocity=(isBoss?130:52)+Math.random()*100;
    spawnParticle(m.x+Math.cos(a)*(isBoss?30:10),m.y-12+Math.sin(a)*11,
      Math.cos(a)*velocity,Math.sin(a)*velocity-95,520+Math.random()*470,
      i%4===0?'#f4d79e':i%2===0?'#a7e8c0':'#608e79',isBoss?5:3,140);
  }
}
function drawDefeats(now){
  for(let i=deathFx.length-1;i>=0;i--){
    const f=deathFx[i],age=now-f.start,duration=f.type==='baphomet'?820:500;
    if(age>duration){deathFx.splice(i,1);continue;}
    const p=age/duration;
    ctx.save();ctx.globalAlpha=(1-p)*.76;
    const rise=p*26,scale=(f.type==='baphomet'?.94:.85)*(1-p*.65);
    sprite(f.type+'_0',f.x,f.y+16-rise,scale);
    // Successively broken pixel rows trail off the dissolving silhouette.
    for(let j=0;j<12;j++){
      const dx=Math.sin(j*29+f.x)*26*p;
      const dy=Math.cos(j*17+f.y)*21*p;
      rect(f.x+dx-3,f.y-35+dy-rise,2+(j%3)*2,3,j%3===0?'#d5dba2':'#7bd0a1');
    }
    ctx.restore();
  }
}
function drawProjectile(p){
  const t=performance.now()/130;
  ctx.save();ctx.translate(p.x,p.y);ctx.rotate(t);
  if(p.type==='darkbolt'){
    ctx.fillStyle='#35415a';ctx.fillRect(-9,-9,18,18);
    ctx.fillStyle='#ac91e1';ctx.fillRect(-5,-11,10,22);
    ctx.fillStyle='#d1e3ed';ctx.fillRect(-4,-5,8,10);
    for(let i=0;i<4;i++){ctx.rotate(Math.PI/2);rect(13,-2,6,4,'#a3e6c2');}
  }else{
    rect(-8,-5,15,9,'#453e65');rect(-6,-7,10,11,'#7c77b5');rect(-2,-3,6,6,'#d3caf2');
    rect(-13,1,5,3,'#c99ada');
  }
  ctx.restore();
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
  for(let i=particleFx.length-1;i>=0;i--){
    const p=particleFx[i];p.life-=dt*1000;
    if(p.life<=0){particleFx.splice(i,1);continue;}
    p.vy+=p.gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
    ctx.save();ctx.globalAlpha=Math.min(1,Math.max(0,p.life/p.maxLife));
    const s=Math.max(2,Math.round(p.size));
    ctx.fillStyle=p.color;
    ctx.fillRect(Math.round(p.x),Math.round(p.y),s,s);
    if(s>=4)ctx.fillRect(Math.round(p.x+s),Math.round(p.y+s),Math.ceil(s/2),Math.ceil(s/2));
    ctx.restore();
  }
}
function drawAmbience(now){
  // Slow fireflies and drifting leaves, stable world-space positions and viewport culling.
  for(let i=0;i<90;i++){
    const x=((i*1039+Math.sin(i*2.4)*67)%WIDTH+WIDTH)%WIDTH;
    const y=((i*541+Math.sin(i*1.7)*113)%HEIGHT+HEIGHT)%HEIGHT;
    if(Math.abs(x-cameraX-viewW/2)>viewW/2+20||Math.abs(y-cameraY-viewH/2)>viewH/2+20)continue;
    if(i%3===0){
      const glow=.38+.36*Math.sin(now/750+i*2);
      ctx.save();ctx.globalAlpha=glow;rect(x+Math.sin(now/1000+i)*10,y+Math.cos(now/950+i)*8,3,3,'#ffffb7');ctx.restore();
    }else{
      const dx=Math.sin(now/2300+i)*16,dy=(now/90+i*19)%80;
      rect(x+dx,y+dy-40,3,2,i%2?'#ceaf67':'#a1b875');
    }
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

  ctx.clearRect(0,0,viewW,viewH);
  rect(0,0,viewW,viewH,'#263e35');
  ctx.save(); ctx.translate(-Math.round(cameraX),-Math.round(cameraY));
  if(worldImage.complete&&worldImage.naturalWidth){
    const sx=Math.max(0,Math.floor(cameraX)),sy=Math.max(0,Math.floor(cameraY));
    const sw=Math.max(1,Math.min(WIDTH-sx,Math.ceil(viewW)+3));
    const sh=Math.max(1,Math.min(HEIGHT-sy,Math.ceil(viewH)+3));
    ctx.drawImage(worldImage,sx,sy,sw,sh,sx,sy,sw,sh);
  }
  drawCracks(now);drawQuakes(now);
  const actors=[...players.values()].map(p=>({y:p.y,draw:()=>drawPlayer(p,now)}))
    .concat([...monsters.values()].filter(m=>m.alive).map(m=>({y:m.y,draw:()=>drawMonster(m,now)})));
  // Trees, houses and shrubs share the player depth order; walk behind a crown, in front of a trunk.
  for(const prop of groundProps){
    if(prop.x<cameraX-170||prop.x>cameraX+viewW+170||prop.y<cameraY-225||prop.y>cameraY+viewH+85)continue;
    actors.push({y:prop.y,draw:()=>propSprite(prop)});
  }
  actors.sort((a,b)=>a.y-b.y).forEach(a=>a.draw());
  drawDefeats(now);
  for(const b of projectiles.values())drawProjectile(b);
  drawAmbience(now);drawParticles(dt);drawDamageFx(now);drawBossCastbars(now);
  ctx.restore();
  drawMinimap();
  if(now-lastSaved>1000){ lastSaved=now; persist(); }
  requestAnimationFrame(frame);
}

connect(); requestAnimationFrame(frame);
})();
