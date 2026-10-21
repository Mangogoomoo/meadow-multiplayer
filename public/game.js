// Browser client. Saves progress in localStorage (usually inside the browser's AppData profile).
(()=>{'use strict';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d'),ui=id=>document.getElementById(id);
const minimap=ui('minimap'),miniCtx=minimap.getContext('2d');
const miniBase=document.createElement('canvas');miniBase.width=minimap.width;miniBase.height=minimap.height;const miniBaseCtx=miniBase.getContext('2d');
const TILE=32,COLS=60,ROWS=40,WIDTH=COLS*TILE,HEIGHT=ROWS*TILE;
// To host the HTML client on InfinityFree, set SERVER_URL to your Render HTTPS URL, e.g.
// const SERVER_URL = 'https://meadow-multiplayer.onrender.com';
const SERVER_URL=''; // Empty = connect to same host (works when the game is served by Render).
const STORAGE_KEY='meadow-rpg-save-v1';
const DELETE_KEY='meadow-rpg-delete-on-reconnect';
const SERVER_VERSION_KEY='meadow-rpg-server-version-v1';
function checkServerVersion(version) {
  if (typeof version !== 'string' || !version) return false;
  try {
    const previous = sessionStorage.getItem(SERVER_VERSION_KEY);
    sessionStorage.setItem(SERVER_VERSION_KEY, version);
    if (previous && previous !== version) {
      persist(); // Save before reloading for the newest game files.
      location.reload();
      return true;
    }
  } catch (error) { console.warn('Version check unavailable:', error); }
  return false;
}
const readSave=()=>{try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{};}catch{return{};}};
const save=readSave();
const players=new Map(),monsters=new Map(),projectiles=new Map(),keys=new Set(),damageFx=[],crackFx=[],particleFx=[];
let attackingHeld=false,lastAttackSent=-9999,serverClockOffset=0;
let mouseX=0,mouseY=0,ws=null,myId=null,last=performance.now(),cameraX=0,cameraY=0,retries=0,viewW=0,viewH=0,dpr=1,lastInput=0,lastSaved=0,lastHp=null,readyToSave=false;
const colors=['#f2a378','#8edbff','#d6a7ff','#ffe08d','#ffc0d9','#9be7ae'];
ui('name').value=typeof save.name==='string'?save.name:'Adventurer';
function persist(){const p=players.get(myId);if(!p||!readyToSave)return;const s={name:p.name,x:p.tx,y:p.ty,hp:p.hp,exp:p.exp,level:p.level,stats:p.stats};try{localStorage.setItem(STORAGE_KEY,JSON.stringify(s));}catch(e){console.warn('Unable to save:',e);}}
addEventListener('pagehide',persist);document.addEventListener('visibilitychange',()=>{if(document.hidden)persist();});
function resize(){dpr=Math.min(devicePixelRatio||1,2);viewW=innerWidth;viewH=innerHeight;canvas.width=Math.floor(viewW*dpr);canvas.height=Math.floor(viewH*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=false;}addEventListener('resize',resize);resize();
function hash(x,y,seed=12345){let n=(Math.imul(x+seed,374761393)+Math.imul(y-seed,668265263))|0;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
function tileAt(x,y){if(x<0||y<0||x>=COLS||y>=ROWS)return'wall';const pond=((x-43)/9)**2+((y-13)/7)**2;if(pond<1+(hash(x,y,44)-.5)*.27)return'water';if(x>42&&y>23&&Math.abs(x-(47+Math.sin(y*.42)*3))<1.4)return'water';const safe=Math.abs(x-15)<6&&Math.abs(y-18)<6;if(!safe&&hash(x,y,91)>.887&&hash(x+1,y,55)>.24)return'tree';return'grass';}
function buildMinimapBase(){
  const sx=minimap.width/WIDTH,sy=minimap.height/HEIGHT;
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    const kind=tileAt(x,y);
    miniBaseCtx.fillStyle=kind==='water'?'#3d819b':kind==='tree'?'#2b5d37':'#6da463';
    miniBaseCtx.fillRect(x*TILE*sx,y*TILE*sy,Math.ceil(TILE*sx),Math.ceil(TILE*sy));
  }
  miniBaseCtx.strokeStyle='#d9f2cd33';miniBaseCtx.strokeRect(.5,.5,minimap.width-1,minimap.height-1);
}
buildMinimapBase();

function connect(){ui('status').textContent='Connecting…';ui('dot').classList.remove('online');const url=SERVER_URL?SERVER_URL.replace(/^http/,'ws').replace(/\/$/,''):(location.protocol==='https:'?'wss://':'ws://')+location.host;ws=new WebSocket(url);
ws.onopen=()=>{ui('status').textContent='Connected';ui('dot').classList.add('online');retries=0;ws.send(JSON.stringify({type:'init',save:{...readSave(),name:ui('name').value}}));};
ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}if(m.type==='welcome'){if(checkServerVersion(m.version))return;readyToSave=false;myId=m.id;players.clear();monsters.clear();projectiles.clear();m.players.forEach(updatePlayer);m.monsters.forEach(updateMonster);ui('chat-messages').replaceChildren();(m.chat||[]).forEach(addChatLine);}
else if(m.type==='join')updatePlayer(m.player);
else if(m.type==='state'){serverClockOffset=(m.serverNow||Date.now())-Date.now();if(m.players.some(p=>p.id===myId))readyToSave=true;const ids=new Set();m.players.forEach(p=>{ids.add(p.id);updatePlayer(p);});for(const id of players.keys())if(!ids.has(id))players.delete(id);m.monsters.forEach(updateMonster);const shots=new Set();for(const b of m.projectiles){shots.add(b.id);const old=projectiles.get(b.id);if(old){old.tx=b.x;old.ty=b.y;}else projectiles.set(b.id,{...b,tx:b.x,ty:b.y});}for(const id of projectiles.keys())if(!shots.has(id))projectiles.delete(id);}
else if(m.type==='leave')players.delete(m.id);
else if(m.type==='action_ack'){
  const action=m.action==='slash'?'Sword':'Jump';

  // Show an accepted action immediately. The server's clock can differ
  // from this browser's clock (especially when hosted remotely).
  if(m.ok){const me=players.get(myId);if(me){
    const field=m.action==='slash'?'visualAttackStart':'visualJumpStart';
    const duration=m.action==='slash'?230:480;
    const now=performance.now();
    if(!me[field]||now-me[field]>duration)me[field]=now;
  }}
}
else if(m.type==='damage_fx'){const fx={x:m.x,y:m.y,amount:m.amount,kind:m.kind,start:performance.now(),angle:m.angle};damageFx.push(fx);if(damageFx.length>100)damageFx.shift();spawnDamageParticles(fx);}
else if(m.type==='message')notice(m.text);
else if(m.type==='chat')addChatLine(m.item);
else if(m.type==='skill_ack'){if(!m.ok)notice(m.slot===2?'Earthbreaker unavailable':'Whirlwind cooling down');}
else if(m.type==='leap_impact'){crackFx.push({x:m.x,y:m.y,start:performance.now()});spawnEarthImpact(m.x,m.y);}
ui('count').textContent=players.size;updateHUD();};
ws.onclose=()=>{persist();readyToSave=false;ui('status').textContent='Disconnected';ui('dot').classList.remove('online');myId=null;players.clear();monsters.clear();projectiles.clear();ui('count').textContent='0';setTimeout(connect,Math.min(1000*2**retries++,8000));};ws.onerror=()=>ws.close();}
function updatePlayer(p){
  const old=players.get(p.id);
  if(old){
    const newJump=p.jumpAt>0&&p.jumpAt!==old.jumpAt;
    const newAttack=p.attackAt>0&&p.attackAt!==old.attackAt;
    const newSpin=p.spinAt>0&&p.spinAt!==old.spinAt;
    const newLeap=p.leapAt>0&&p.leapAt!==old.leapAt;
    // Compare server timestamps only against earlier server timestamps.
    // Never subtract a server timestamp from the browser's Date.now().
    Object.assign(old,{...p,tx:p.x,ty:p.y,x:old.x,y:old.y});
    const now=performance.now();
    if(newJump&&(!old.visualJumpStart||now-old.visualJumpStart>300))old.visualJumpStart=now;
    if(newAttack&&(!old.visualAttackStart||now-old.visualAttackStart>125))old.visualAttackStart=now;
    if(newSpin)old.visualSpinStart=now;
    if(newLeap)old.visualLeapStart=now;
  }else players.set(p.id,{...p,tx:p.x,ty:p.y,
    visualJumpStart:p.jumpAt>0?performance.now():0,
    visualAttackStart:p.attackAt>0?performance.now():0,visualSpinStart:0,visualLeapStart:0});
}
function updateMonster(m){const old=monsters.get(m.id);if(old)Object.assign(old,{...m,tx:m.x,ty:m.y,x:old.x,y:old.y});else monsters.set(m.id,{...m,tx:m.x,ty:m.y});}
function xpNeeded(level){return Math.round(10+level*6+level*level*1.3);}
function updateHUD(){const p=players.get(myId);if(!p)return;ui('level').textContent=`Level ${p.level}${p.level===99?' (MAX)':''}`;ui('hptext').textContent=`${+p.hp.toFixed(1)} / ${+p.maxHp.toFixed(1)} HP`;ui('hpbar').style.width=(p.hp/p.maxHp*100)+'%';ui('energytext').textContent=`${Math.ceil(p.energy??100)} / 100 Energy`;ui('energybar').style.width=`${p.energy??100}%`;const required=p.level>=99?0:xpNeeded(p.level);ui('exptext').textContent=p.level===99?'MAX':`${Math.floor(p.exp)} / ${required}`;ui('expbar').style.width=p.level===99?'100%':(p.exp/required*100)+'%';if(lastHp!==null&&p.hp<lastHp)ui('hpbar').style.background='#ff4949';else ui('hpbar').style.background='#eb6c72';lastHp=p.hp;renderStats(p);if(!ui('stat-panel').hidden)updateCombatDetails(p);}
function addChatLine(item){if(!item||typeof item.text!=='string')return;const box=ui('chat-messages');const line=document.createElement('div'),name=document.createElement('b');name.textContent=(item.name||'Adventurer')+': ';line.append(name,document.createTextNode(item.text));box.append(line);while(box.children.length>60)box.firstChild.remove();box.scrollTop=box.scrollHeight;}
function useSkill(slot){if(slot===1)emit('spin');else if(slot===2){const me=players.get(myId);if(me)emit('leap',{x:mouseX+cameraX,y:mouseY+cameraY});}}
function notice(s){const el=document.createElement('div');el.className='notice';el.textContent=s;ui('notices').prepend(el);setTimeout(()=>el.remove(),3800);}
function spawnParticle(x,y,vx,vy,life,color,size=3,gravity=0,fade=.02){particleFx.push({x,y,vx,vy,life,maxLife:life,color,size,gravity,fade});if(particleFx.length>300)particleFx.splice(0,particleFx.length-300);}
function spawnDamageParticles(fx){const base=Number.isFinite(fx.angle)?fx.angle:-Math.PI/2;if(fx.kind==='monster'||fx.kind==='crit'){const count=fx.kind==='crit'?12:8;for(let i=0;i<count;i++){const a=base+(Math.random()-.5)*0.9;const speed=75+Math.random()*110;spawnParticle(fx.x+Math.cos(a)*6,fx.y+Math.sin(a)*6,Math.cos(a)*speed,Math.sin(a)*speed-20,520+Math.random()*280,fx.kind==='crit'?'#ffd16f':'#b43f46',2+Math.random()*3,40,.03);}for(let i=0;i<4;i++)spawnParticle(fx.x,fx.y,(Math.random()-.5)*35,-30-Math.random()*50,280,'#ffe8d1',1.5,20,.04);}
 else if(fx.kind==='player'){for(let i=0;i<7;i++){const a=base+(Math.random()-.5)*1.1,speed=55+Math.random()*75;spawnParticle(fx.x,fx.y,Math.cos(a)*speed,Math.sin(a)*speed-18,450+Math.random()*180,'#ff9b8a',2+Math.random()*2,45,.03);}}
 else if(fx.kind==='miss'){for(let i=0;i<4;i++)spawnParticle(fx.x,fx.y,(Math.random()-.5)*24,-25-Math.random()*30,300,'#d4f1ff',1.8,15,.05);}}
function spawnEarthImpact(x,y){for(let i=0;i<26;i++){const a=(Math.PI*2*i)/26+(Math.random()-.5)*.18;const speed=70+Math.random()*120;spawnParticle(x,y,Math.cos(a)*speed,Math.sin(a)*speed-10,900+Math.random()*240,i%3===0?'#f6d7a3':i%2===0?'#8e6a47':'#d5ba8c',2+Math.random()*3,38,.02);}for(let i=0;i<18;i++){const a=(Math.PI*2*i)/18;spawnParticle(x+Math.cos(a)*18,y+Math.sin(a)*10,Math.cos(a)*(35+Math.random()*45),Math.sin(a)*(22+Math.random()*35)-55,700,'#fff2c3',2.2,50,.025);}}
const movement=new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright']);
function emit(type,payload={}){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type,...payload}));}
// Use physical key codes as well as characters: works with different keyboard layouts.
// Controls are disabled only while actively editing the name field.
function handleAction(action){
  if(!ws||ws.readyState!==WebSocket.OPEN)return;
  emit(action,action==='slash'?{angle:Math.atan2(mouseY+cameraY-(players.get(myId)?.y||0),mouseX+cameraX-(players.get(myId)?.x||0))}:{});
}
addEventListener('keydown',e=>{
  if(document.activeElement===ui('name')||document.activeElement===ui('chat-input')){
    if(e.key==='Enter'){rename();ui('name').blur();}
    return;
  }
  const k=e.key.toLowerCase();
  if(e.code==='Enter'){e.preventDefault();ui('chat-input').focus();return;}
  if(e.code==='Digit1'||e.code==='Digit2'){e.preventDefault();if(!e.repeat)useSkill(Number(e.code.slice(-1)));return;}
  if(['Digit3','Digit4','Digit5'].includes(e.code)){e.preventDefault();return;}
  if(movement.has(k)){e.preventDefault();keys.add(k);return;}
  if(e.code==='Space'||k===' '){e.preventDefault();if(!e.repeat)handleAction('jump');return;}
  if(e.code==='ShiftLeft'){e.preventDefault();keys.add('shiftleft');return;}
});
// Clicking the world returns focus from the name input to the game controls.
canvas.addEventListener('pointerdown',()=>{if(document.activeElement===ui('name'))ui('name').blur();});
canvas.addEventListener('pointermove',e=>{mouseX=e.clientX;mouseY=e.clientY;});
canvas.addEventListener('pointerdown',e=>{if(e.button===0){mouseX=e.clientX;mouseY=e.clientY;attackingHeld=true;lastAttackSent=performance.now();handleAction('slash');}});
addEventListener('pointerup',e=>{if(e.button===0)attackingHeld=false;});
addEventListener('blur',()=>{attackingHeld=false;keys.clear();});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
const STAT_DESC={STR:'Melee damage',AGI:'Attack speed',VIT:'Maximum HP',INT:'Magic damage (future spells)',DEX:'Hit rating / accuracy',LUK:'Critical rate and damage'};
ui('stat-toggle').addEventListener('click',()=>{ui('stat-panel').hidden=!ui('stat-panel').hidden;});
ui('reset-stats').addEventListener('click',()=>{if(confirm('Reset all six stats and refund every spent stat point?'))emit('reset_stats');});
ui('delete-character').addEventListener('click',()=>{if(!confirm('Permanently delete your locally saved character and start again at level 1?'))return;if(!confirm('This cannot be undone. Delete the character?'))return;try{localStorage.removeItem(STORAGE_KEY);}catch{}readyToSave=false;if(ws){ws.onclose=null;ws.close();}location.reload();});
ui('chat-form').addEventListener('submit',e=>{e.preventDefault();const input=ui('chat-input'),value=input.value.trim();if(value){emit('chat',{text:value});input.value='';}input.blur();});
ui('actionbar').addEventListener('click',e=>{const b=e.target.closest('button[data-slot]');if(b)useSkill(Number(b.dataset.slot));});
let heldStat=null,heldStatTimer=null;
function releaseStat(){heldStat=null;clearInterval(heldStatTimer);heldStatTimer=null;}
ui('stat-rows').addEventListener('pointerdown',e=>{const b=e.target.closest('button[data-stat]');if(!b||b.disabled)return;e.preventDefault();releaseStat();heldStat=b.dataset.stat;emit('stat',{stat:heldStat});heldStatTimer=setInterval(()=>{if(heldStat)emit('stat',{stat:heldStat});},105);});
addEventListener('pointerup',releaseStat);addEventListener('pointercancel',releaseStat);addEventListener('blur',releaseStat);
ui('stat-rows').addEventListener('click',e=>{if(e.detail===0){const b=e.target.closest('button[data-stat]');if(b&&!b.disabled)emit('stat',{stat:b.dataset.stat});}});
function renderStats(p){
 ui('stat-points').textContent=`Available stat points: ${p.statPoints||0}`;
 const current=ui('stat-rows').dataset.signature;
 const signature=JSON.stringify([p.stats,p.statPoints]);if(current===signature)return;
 ui('stat-rows').dataset.signature=signature;
 ui('stat-rows').innerHTML=Object.entries(STAT_DESC).map(([k,description])=>{const n=p.stats?.[k]||0;const cost=1+Math.floor(n/20);const affordable=(p.statPoints||0)>=cost&&n<99;
 return `<div class="stat-row"><strong>${k}</strong><strong>${n}/99</strong><span class="stat-desc">${description} · Cost ${n<99?cost:'MAX'}</span><button data-stat="${k}" ${affordable?'':'disabled'}>+</button></div>`;}).join('');
}
function updateCombatDetails(p){
 const s=p.stats||{},agi=s.AGI||0,luk=s.LUK||0;
 const values=[['Melee attack',(1+(p.level-1)*.18+(s.STR||0)*.35).toFixed(2)],['Attack speed',(1000/Math.max(135,400-agi*5)).toFixed(2)+'/sec'],['Magic attack',(1+(s.INT||0)*.35).toFixed(2)],['Hit rating',4+(s.DEX||0)*2],['Crit rate',Math.round(Math.min(.55,.05+luk*.01)*100)+'%'],['Crit damage',(150+luk*2.5).toFixed(1)+'%'],['Max HP',p.maxHp.toFixed(1)],['Movement','175 / 285 sprint']];
 ui('combat-details').innerHTML=values.map(([k,v])=>`<span>${k}</span><b>${v}</b>`).join('');
}
addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(movement.has(k)){e.preventDefault();keys.delete(k);}if(e.code==='ShiftLeft')keys.delete('shiftleft');});addEventListener('blur',()=>keys.clear());
function rename(){const name=ui('name').value.trim().slice(0,18)||'Adventurer';ui('name').value=name;emit('name',{name});const p=players.get(myId);if(p)p.name=name;persist();}
ui('rename').addEventListener('click',rename);
ui('debug-level').addEventListener('click',()=>emit('debug_level'));
function sendInput(now){if(now-lastInput<40)return;lastInput=now;const x=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft')),y=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));emit('input',{x,y,run:keys.has('shiftleft')});}
function ellipse(x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function label(text,x,y,color='#fff',size=11){ctx.font=`bold ${size}px system-ui`;ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#17271f';ctx.strokeText(text,x,y);ctx.fillStyle=color;ctx.fillText(text,x,y);}
function drawTile(x,y){const px=x*TILE,py=y*TILE,kind=tileAt(x,y),v=hash(x,y);ctx.fillStyle=kind==='water'?'#458aa7':'#70aa64';ctx.fillRect(px,py,TILE,TILE);if(kind==='water'){ctx.fillStyle='#5faac1';ctx.fillRect(px+5+(v*10|0),py+7,13,2);ctx.fillRect(px+13,py+21,10,2);return;}if(v>.68){ctx.fillStyle='#8bc27a';ctx.fillRect(px+5,py+8,2,5);ctx.fillRect(px+9,py+6,2,7);ctx.fillRect(px+23,py+22,2,4);}else if(v<.07){ctx.fillStyle='#d7c676';ctx.fillRect(px+14,py+14,3,3);ctx.fillStyle='#f2e7b0';ctx.fillRect(px+18,py+13,2,2);}if(kind==='tree'){ellipse(px+17,py+25,13,5,'#396849');ctx.fillStyle='#76553a';ctx.fillRect(px+13,py+15,7,15);ctx.fillStyle='#285e3b';ctx.beginPath();ctx.arc(px+16,py+14,14,0,Math.PI*2);ctx.fill();ctx.fillStyle='#3a8050';ctx.beginPath();ctx.arc(px+13,py+10,11,0,Math.PI*2);ctx.fill();ctx.fillStyle='#62a464';ctx.beginPath();ctx.arc(px+9,py+8,5,0,Math.PI*2);ctx.fill();}}
function drawPlayer(p,now){const x=p.x,y=p.y,walking=Math.hypot(p.tx-p.x,p.ty-p.y)>.25,bob=walking?Math.sin(now/95)*1.3:0;const age=now-(p.visualJumpStart||0),jumping=!!p.visualJumpStart&&age>=0&&age<480,progress=jumping?age/480:0,height=jumping?Math.sin(progress*Math.PI)*20:0,shadowScale=1-height/33;ellipse(x,y+11,11*shadowScale,4*shadowScale,'#203c2a8c');ctx.save();const leapAge=now-(p.visualLeapStart||0);const leapHeight=p.visualLeapStart&&leapAge>=0&&leapAge<520?Math.sin(Math.PI*leapAge/520)*46:0;ctx.translate(0,-height-leapHeight);const spinAge=now-(p.visualSpinStart||0),spinning=!!p.visualSpinStart&&spinAge>=0&&spinAge<3000;if(spinning){ctx.translate(x,y);ctx.rotate(spinAge/105);ctx.translate(-x,-y);}if(Date.now()<p.invulnerableUntil&&Math.floor(now/85)%2===0)ctx.globalAlpha=.45;
// Boots, tunic, belt, hair and arms with a crisp outlined silhouette.
const skin='#eec89b', armor=colors[p.color%colors.length]||colors[0];
ctx.fillStyle='#1c2d31';ctx.fillRect(x-8,y+4+bob,7,11);ctx.fillRect(x+1,y+4-bob,7,11);
ctx.fillStyle='#535466';ctx.fillRect(x-7,y+5+bob,5,8);ctx.fillRect(x+2,y+5-bob,5,8);
ctx.fillStyle='#26363b';ctx.fillRect(x-11,y-11+bob,22,18);ctx.fillStyle=armor;ctx.fillRect(x-9,y-9+bob,18,15);
ctx.fillStyle='#5b453b';ctx.fillRect(x-9,y+2+bob,18,4);ctx.fillStyle='#d9b476';ctx.fillRect(x-2,y+2+bob,4,4);
ctx.fillStyle=skin;ctx.fillRect(x-13,y-7+bob,4,11);ctx.fillRect(x+9,y-7+bob,4,11);
ctx.fillStyle='#29313d';ctx.fillRect(x-8,y-22+bob,16,15);ctx.fillStyle=skin;ctx.fillRect(x-7,y-20+bob,14,13);
ctx.fillStyle='#493c35';ctx.fillRect(x-8,y-23+bob,16,6);ctx.fillRect(x-9,y-20+bob,3,7);
ctx.fillStyle='#203039';if(p.dir==='left')ctx.fillRect(x-7,y-14+bob,2,3);else if(p.dir==='right')ctx.fillRect(x+5,y-14+bob,2,3);else if(p.dir==='down'){ctx.fillRect(x-4,y-14+bob,2,2);ctx.fillRect(x+3,y-14+bob,2,2);}
// Always show the equipped sword. The swing uses the actual mouse direction.
const dirs={up:-Math.PI/2,down:Math.PI/2,left:Math.PI,right:0};const slashAge=now-(p.visualAttackStart||0),swing=!!p.visualAttackStart&&slashAge>=0&&slashAge<230;
const facing=swing&&Number.isFinite(p.attackAngle)?p.attackAngle:(dirs[p.dir]??Math.PI/2);
const bladeAngle=spinning?0:facing+(swing?(-1.2+2.4*slashAge/230):.68);
ctx.save();ctx.translate(x,y-4+bob);ctx.rotate(bladeAngle);
ctx.fillStyle='#704a28';ctx.fillRect(10,-3,13,6);ctx.fillStyle='#d9b666';ctx.fillRect(19,-9,4,18);
ctx.fillStyle='#c2d8e0';ctx.beginPath();ctx.moveTo(23,-4);ctx.lineTo(43,-3);ctx.lineTo(51,0);ctx.lineTo(43,3);ctx.lineTo(23,4);ctx.closePath();ctx.fill();ctx.strokeStyle='#f6faff';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(25,-2);ctx.lineTo(47,0);ctx.stroke();ctx.restore();

if(spinning){ctx.save();ctx.translate(x,y-4+bob);ctx.strokeStyle='#f5ecab';ctx.lineWidth=4;ctx.globalAlpha=.75;ctx.beginPath();ctx.arc(0,0,83,0,Math.PI*2);ctx.stroke();ctx.restore();}
if(swing){ctx.save();ctx.translate(x,y-4+bob);ctx.rotate(facing);ctx.strokeStyle='#fff4bd';ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.arc(0,0,56,-1.15+slashAge/230*1.45,-.7+slashAge/230*1.45);ctx.stroke();ctx.restore();}
ctx.restore();label(`${p.name}  Lv.${p.level}`,x,y-32-height-leapHeight+bob,p.id===myId?'#ffef9d':'#fff',11);ctx.fillStyle='#172b21';ctx.fillRect(x-18,y-28-height-leapHeight+bob,36,4);ctx.fillStyle='#e86c71';ctx.fillRect(x-18,y-28-height-leapHeight+bob,36*Math.max(0,p.hp/p.maxHp),4);
}
function drawMonster(m,now){if(!m.alive)return;const x=m.x,y=m.y,bat=m.type==='bat',float=bat?Math.sin(now/180+m.x)*4:0;ellipse(x,y+10,bat?13:11,4,'#203c2a8c');if(bat){ctx.fillStyle='#553b82';ctx.beginPath();ctx.moveTo(x-4,y-8+float);ctx.lineTo(x-23,y-18+float);ctx.lineTo(x-18,y+5+float);ctx.lineTo(x-3,y+2+float);ctx.moveTo(x+4,y-8+float);ctx.lineTo(x+23,y-18+float);ctx.lineTo(x+18,y+5+float);ctx.lineTo(x+3,y+2+float);ctx.fill();ellipse(x,y-5+float,10,10,'#7955a7');ctx.fillStyle='#f2c9f6';ctx.fillRect(x-6,y-7+float,3,3);ctx.fillRect(x+3,y-7+float,3,3);}else{ellipse(x,y+2,13,9,'#91725c');ellipse(x+9,y+1,6,6,'#b18a70');ellipse(x-3,y-6,4,6,'#b18a70');ctx.strokeStyle='#ac8177';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-11,y+5);ctx.quadraticCurveTo(x-25,y+13,x-28,y-2);ctx.stroke();ctx.fillStyle='#ecb8b4';ctx.fillRect(x+11,y,2,2);}label(bat?'Bat':'Rat',x,y-27+float,'#ffddd2');ctx.fillStyle='#24342a';ctx.fillRect(x-15,y-23+float,30,4);ctx.fillStyle='#e77a76';ctx.fillRect(x-15,y-23+float,30*Math.max(0,m.hp/m.maxHp),4);if(Date.now()<m.stunnedUntil){for(let i=0;i<3;i++){const a=now/180+i*Math.PI*2/3;ctx.fillStyle='#ffe299';ctx.beginPath();ctx.moveTo(x+Math.cos(a)*13,y-36+float+Math.sin(a)*4);for(let k=1;k<5;k++){const aa=a+k*Math.PI*2/5,r=k%2?4.8:2.2;ctx.lineTo(x+Math.cos(aa)*13+Math.cos(aa)*r,y-36+float+Math.sin(a)*4+Math.sin(aa)*r);}ctx.closePath();ctx.fill();}label('STUN',x,y-46+float,'#ffe4a2',10);}if(m.type==='rat'&&Date.now()<m.chargeUntil){ctx.strokeStyle='#ffe19c';ctx.lineWidth=2;ctx.strokeRect(x-16,y-13,32,25);}}
function drawProjectile(p){ellipse(p.x,p.y,7,7,'#ac83d8');ellipse(p.x-2,p.y-2,3,3,'#e8cffc');}
function drawDamageFx(now){for(let i=damageFx.length-1;i>=0;i--){const f=damageFx[i],age=now-f.start;if(age>850){damageFx.splice(i,1);continue;}ctx.save();ctx.globalAlpha=1-age/850;label(f.kind==='miss'?'MISS':String(f.amount),f.x,f.y-22-age*.04,f.kind==='player'?'#ff8080':f.kind==='crit'?'#ffe16e':'#fff',f.kind==='crit'?17:14);ctx.restore();}}
function drawCracks(now){for(let i=crackFx.length-1;i>=0;i--){const fx=crackFx[i],age=now-fx.start;if(age>4400){crackFx.splice(i,1);continue;}ctx.save();ctx.translate(fx.x,fx.y);ctx.globalAlpha=age<1900?.85:.85*(1-(age-1900)/2500);ctx.strokeStyle='#362d25';ctx.lineWidth=3;for(let k=0;k<12;k++){const a=k*Math.PI/6,reach=28+(k%3)*14;ctx.beginPath();ctx.moveTo(Math.cos(a)*5,Math.sin(a)*5);ctx.lineTo(Math.cos(a)*reach*.55-Math.sin(a)*5,Math.sin(a)*reach*.55+Math.cos(a)*5);ctx.lineTo(Math.cos(a)*reach,Math.sin(a)*reach);ctx.stroke();}ctx.strokeStyle='#e4c48e';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,90,0,Math.PI*2);ctx.stroke();ctx.restore();}}
function drawParticles(dt){for(let i=particleFx.length-1;i>=0;i--){const p=particleFx[i];p.life-=dt*1000;if(p.life<=0){particleFx.splice(i,1);continue;}p.vy+=p.gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;ctx.save();ctx.globalAlpha=Math.max(0,p.life/p.maxLife);ctx.fillStyle=p.color;ctx.beginPath();ctx.ellipse(p.x,p.y,p.size,p.size*.7,0,0,Math.PI*2);ctx.fill();ctx.restore();}}
function drawMinimap(){const sx=minimap.width/WIDTH,sy=minimap.height/HEIGHT;miniCtx.clearRect(0,0,minimap.width,minimap.height);miniCtx.drawImage(miniBase,0,0);miniCtx.fillStyle='#00000033';miniCtx.fillRect(cameraX*sx,cameraY*sy,viewW*sx,viewH*sy);miniCtx.strokeStyle='#dff6cd';miniCtx.lineWidth=1;miniCtx.strokeRect(cameraX*sx+.5,cameraY*sy+.5,Math.max(8,viewW*sx)-1,Math.max(8,viewH*sy)-1);for(const m of monsters.values()){if(!m.alive)continue;miniCtx.fillStyle=m.type==='bat'?'#9e84db':'#c58a6c';miniCtx.fillRect(m.x*sx-1.5,m.y*sy-1.5,3,3);}for(const p of players.values()){miniCtx.beginPath();miniCtx.fillStyle=p.id===myId?'#ffef92':'#fff';miniCtx.arc(p.x*sx,p.y*sy,p.id===myId?3.3:2.5,0,Math.PI*2);miniCtx.fill();}ui('minimap-status').textContent=`${players.size}p · ${[...monsters.values()].filter(m=>m.alive).length}m`;}
function frame(now){if(attackingHeld&&now-lastAttackSent>=65&&document.activeElement!==ui('name')&&document.activeElement!==ui('chat-input')){lastAttackSent=now;const me=players.get(myId);const cooldown=Math.max(135,400-(me?.stats?.AGI||0)*5);if(now-(me?.visualAttackStart||0)>cooldown-45)handleAction('slash');}const dt=Math.min((now-last)/1000,.05);last=now;sendInput(now);for(const p of [...players.values(),...monsters.values(),...projectiles.values()]){const f=1-Math.exp(-dt*55);p.x+=(p.tx-p.x)*f;p.y+=(p.ty-p.y)*f;}
const mine=players.get(myId);
const cooldownBox=ui('skill-cooldown');if(mine){const end=mine.spinCooldownUntil||0;const active=mine.visualSpinStart&&now-mine.visualSpinStart<3000;const timeLeft=Math.max(0,end-(Date.now()+serverClockOffset));cooldownBox.hidden=active||timeLeft<=0;cooldownBox.textContent=timeLeft>100?(Math.ceil(timeLeft/1000)+'s'):'';const leapBox=ui('leap-cooldown'),leapLeft=Math.max(0,(mine.leapCooldownUntil||0)-(Date.now()+serverClockOffset));leapBox.hidden=leapLeft<100;leapBox.textContent=leapLeft>=100?Math.ceil(leapLeft/1000)+'s':'';}else{cooldownBox.hidden=true;ui('leap-cooldown').hidden=true;}
if(mine){const f=1-Math.exp(-dt*24);cameraX+=(mine.x-viewW/2-cameraX)*f;cameraY+=(mine.y-viewH/2-cameraY)*f;}cameraX=viewW>=WIDTH?(WIDTH-viewW)/2:Math.max(0,Math.min(WIDTH-viewW,cameraX));cameraY=viewH>=HEIGHT?(HEIGHT-viewH)/2:Math.max(0,Math.min(HEIGHT-viewH,cameraY));ctx.clearRect(0,0,viewW,viewH);ctx.fillStyle='#162d25';ctx.fillRect(0,0,viewW,viewH);ctx.save();ctx.translate(-Math.round(cameraX),-Math.round(cameraY));const left=Math.max(0,Math.floor(cameraX/TILE)-1),right=Math.min(COLS,Math.ceil((cameraX+viewW)/TILE)+1),top=Math.max(0,Math.floor(cameraY/TILE)-1),bottom=Math.min(ROWS,Math.ceil((cameraY+viewH)/TILE)+1);for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)drawTile(x,y);drawCracks(now);const actors=[...players.values()].map(p=>({y:p.y,draw:()=>drawPlayer(p,now)})).concat([...monsters.values()].filter(m=>m.alive).map(m=>({y:m.y,draw:()=>drawMonster(m,now)})));actors.sort((a,b)=>a.y-b.y).forEach(a=>a.draw());for(const b of projectiles.values())drawProjectile(b);drawParticles(dt);drawDamageFx(now);ctx.restore();drawMinimap();if(now-lastSaved>1000){lastSaved=now;persist();}requestAnimationFrame(frame);}
connect();requestAnimationFrame(frame);
})();
