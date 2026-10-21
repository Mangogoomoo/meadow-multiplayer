// Meadow Multiplayer - browser client
(() => {
'use strict';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d');
const status=document.getElementById('status'),dot=document.getElementById('dot'),count=document.getElementById('count');
const TILE=32,COLS=60,ROWS=40,WORLD_W=COLS*TILE,WORLD_H=ROWS*TILE;
const keys=new Set(), players=new Map();
let myId=null,ws=null,last=performance.now(),cameraX=0,cameraY=0,retry=0;
const colors=['#f2a378','#8edbff','#d6a7ff','#ffe08d','#ffc0d9','#9be7ae'];
let viewW=0,viewH=0,dpr=1;
function resize(){dpr=Math.min(devicePixelRatio||1,2);viewW=innerWidth;viewH=innerHeight;canvas.width=Math.floor(viewW*dpr);canvas.height=Math.floor(viewH*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=false;}
addEventListener('resize',resize);resize();
function hash(x,y,seed=12345){let n=(Math.imul(x+seed,374761393)+Math.imul(y-seed,668265263))|0;n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967296;}
function tileAt(x,y){if(x<0||y<0||x>=COLS||y>=ROWS)return 'wall';const pond=((x-43)/9)**2+((y-13)/7)**2;if(pond<1+(hash(x,y,44)-.5)*.27)return 'water';if(x>42&&y>23&&Math.abs(x-(47+Math.sin(y*.42)*3))<1.4)return 'water';const safeSpawn=Math.abs(x-15)<6&&Math.abs(y-18)<6;if(!safeSpawn&&hash(x,y,91)>.887&&hash(x+1,y,55)>.24)return 'tree';return 'grass';}
function connect(){
  status.textContent='Connecting…';dot.classList.remove('online');
  const protocol=location.protocol==='https:'?'wss:':'ws:';
  ws=new WebSocket(`${protocol}//${location.host}`);
  ws.onopen=()=>{status.textContent='Connected';dot.classList.add('online');retry=0;};
  ws.onmessage=evt=>{let m;try{m=JSON.parse(evt.data);}catch{return;}
    if(m.type==='welcome'){myId=m.id;players.clear();m.players.forEach(updatePlayer);}
    else if(m.type==='join')updatePlayer(m.player);
    else if(m.type==='state'){const ids=new Set();m.players.forEach(p=>{ids.add(p.id);updatePlayer(p);});for(const id of players.keys())if(!ids.has(id))players.delete(id);}
    else if(m.type==='leave')players.delete(m.id);
    count.textContent=players.size;
  };
  ws.onclose=()=>{status.textContent='Disconnected';dot.classList.remove('online');myId=null;players.clear();count.textContent='0';setTimeout(connect,Math.min(1000*2**retry++,8000));};
  ws.onerror=()=>ws.close();
}
function updatePlayer(p){const old=players.get(p.id);if(old){old.tx=p.x;old.ty=p.y;old.dir=p.dir;old.color=p.color;}else players.set(p.id,{...p,tx:p.x,ty:p.y});}
const valid=new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright']);
addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(valid.has(k)){e.preventDefault();keys.add(k);}});
addEventListener('keyup',e=>{const k=e.key.toLowerCase();if(valid.has(k)){e.preventDefault();keys.delete(k);}});
addEventListener('blur',()=>keys.clear());
let lastInput=0;
function sendInput(now){if(now-lastInput<40||!ws||ws.readyState!==WebSocket.OPEN)return;lastInput=now;const x=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));const y=Number(keys.has('s')||keys.has('arrowdown'))-Number(keys.has('w')||keys.has('arrowup'));ws.send(JSON.stringify({type:'input',x,y}));}
function drawTile(x,y){const px=x*TILE,py=y*TILE;const kind=tileAt(x,y),v=hash(x,y);
  ctx.fillStyle=kind==='water'?'#458aa7':'#70aa64';ctx.fillRect(px,py,TILE,TILE);
  if(kind==='water'){ctx.fillStyle='#5faac1';ctx.fillRect(px+5+(v*10|0),py+7,13,2);ctx.fillRect(px+13,py+21,10,2);return;}
  if(v>.68){ctx.fillStyle='#8bc27a';ctx.fillRect(px+5,py+8,2,5);ctx.fillRect(px+9,py+6,2,7);ctx.fillRect(px+23,py+22,2,4);}
  else if(v<.07){ctx.fillStyle='#d7c676';ctx.fillRect(px+14,py+14,3,3);ctx.fillStyle='#f2e7b0';ctx.fillRect(px+18,py+13,2,2);}
  if(kind==='tree'){
    ctx.fillStyle='#396849';ctx.beginPath();ctx.ellipse(px+17,py+25,13,5,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#76553a';ctx.fillRect(px+13,py+15,7,15);
    ctx.fillStyle='#285e3b';ctx.beginPath();ctx.arc(px+16,py+14,14,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#3a8050';ctx.beginPath();ctx.arc(px+13,py+10,11,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#62a464';ctx.beginPath();ctx.arc(px+9,py+8,5,0,Math.PI*2);ctx.fill();
  }
}
function drawPlayer(p,now){let x=p.x,y=p.y,walking=Math.hypot(p.tx-p.x,p.ty-p.y)>.25;const bob=walking?Math.sin(now/95)*1.3:0;
  ctx.fillStyle='#203c2a8c';ctx.beginPath();ctx.ellipse(x,y+11,11,4,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#3e485b';ctx.fillRect(x-7,y+4+bob,5,9);ctx.fillRect(x+2,y+4-bob,5,9);
  ctx.fillStyle=colors[p.color%colors.length]||colors[0];ctx.fillRect(x-9,y-9+bob,18,16);ctx.fillStyle='#f7d4a8';ctx.fillRect(x-7,y-20+bob,14,13);
  ctx.fillStyle='#5b4633';ctx.fillRect(x-8,y-22+bob,16,5);ctx.fillRect(x-9,y-19+bob,3,6);
  ctx.fillStyle='#26394a';if(p.dir==='left'){ctx.fillRect(x-7,y-14+bob,2,2);}else if(p.dir==='right'){ctx.fillRect(x+5,y-14+bob,2,2);}else if(p.dir==='down'){ctx.fillRect(x-4,y-14+bob,2,2);ctx.fillRect(x+3,y-14+bob,2,2);}else{ctx.fillStyle='#715037';ctx.fillRect(x-5,y-19+bob,10,5);}
  if(p.id===myId){ctx.strokeStyle='#f9ec91';ctx.lineWidth=2;ctx.strokeRect(Math.round(x-12),Math.round(y-25+bob),24,40);}
  ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.strokeStyle='#1b3127';ctx.lineWidth=3;ctx.strokeText(p.id===myId?'You':`Player ${p.id.slice(0,4)}`,x,y-30+bob);ctx.fillStyle='#fff';ctx.fillText(p.id===myId?'You':`Player ${p.id.slice(0,4)}`,x,y-30+bob);
}
function frame(now){const dt=Math.min((now-last)/1000,.05);last=now;sendInput(now);
  for(const p of players.values()){const factor=1-Math.exp(-dt*18);p.x+=(p.tx-p.x)*factor;p.y+=(p.ty-p.y)*factor;}
  const mine=players.get(myId);if(mine){const tx=mine.x-viewW/2,ty=mine.y-viewH/2;const f=1-Math.exp(-dt*8);cameraX+=(tx-cameraX)*f;cameraY+=(ty-cameraY)*f;}
  cameraX=Math.max(0,Math.min(WORLD_W-viewW,cameraX));cameraY=Math.max(0,Math.min(WORLD_H-viewH,cameraY));if(viewW>=WORLD_W)cameraX=(WORLD_W-viewW)/2;if(viewH>=WORLD_H)cameraY=(WORLD_H-viewH)/2;
  ctx.clearRect(0,0,viewW,viewH);ctx.fillStyle='#162d25';ctx.fillRect(0,0,viewW,viewH);ctx.save();ctx.translate(-Math.round(cameraX),-Math.round(cameraY));
  const left=Math.max(0,Math.floor(cameraX/TILE)-1),right=Math.min(COLS,Math.ceil((cameraX+viewW)/TILE)+1),top=Math.max(0,Math.floor(cameraY/TILE)-1),bottom=Math.min(ROWS,Math.ceil((cameraY+viewH)/TILE)+1);
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)drawTile(x,y);
  [...players.values()].sort((a,b)=>a.y-b.y).forEach(p=>drawPlayer(p,now));ctx.restore();requestAnimationFrame(frame);
}
connect();requestAnimationFrame(frame);
})();
