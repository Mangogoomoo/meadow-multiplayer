// Browser client. Saves progress in localStorage (usually inside the browser's AppData profile).
(()=>{'use strict';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d'),ui=id=>document.getElementById(id);
const minimap=ui('minimap'),miniCtx=minimap.getContext('2d');
const miniBase=document.createElement('canvas');miniBase.width=minimap.width;miniBase.height=minimap.height;const miniBaseCtx=miniBase.getContext('2d');
const TILE=32,COLS=120,ROWS=80,WIDTH=COLS*TILE,HEIGHT=ROWS*TILE;
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
const players=new Map(),monsters=new Map(),projectiles=new Map(),keys=new Set(),damageFx=[],crackFx=[],particleFx=[],quakeFx=[];
let attackingHeld=false,lastAttackSent=-9999,serverClockOffset=0;
let mouseX=0,mouseY=0,ws=null,myId=null,last=performance.now(),cameraX=0,cameraY=0,retries=0,viewW=0,viewH=0,dpr=1,lastInput=0,lastSaved=0,lastHp=null,readyToSave=false;
const colors=['#2f5fa7','#b3484d','#5c79c5','#8e5abb','#3a7a68','#c58a43'];
ui('name').value=typeof save.name==='string'?save.name:'Adventurer';
function persist(){const p=players.get(myId);if(!p||!readyToSave)return;const s={name:p.name,x:p.tx,y:p.ty,hp:p.hp,exp:p.exp,level:p.level,stats:p.stats};try{localStorage.setItem(STORAGE_KEY,JSON.stringify(s));}catch(e){console.warn('Unable to save:',e);}}
addEventListener('pagehide',persist);document.addEventListener('visibilitychange',()=>{if(document.hidden)persist();});
function resize(){dpr=Math.min(devicePixelRatio||1,2);viewW=innerWidth;viewH=innerHeight;canvas.width=Math.floor(viewW*dpr);canvas.height=Math.floor(viewH*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=false;}addEventListener('resize',resize);resize();
function hash(x,y,seed=12345){let n=(Math.imul(x+seed,374761393)+Math.imul(y-seed,668265263))|0;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
function isRiver(x,y){const center=113+Math.sin(y*0.15)*1.4;return x>=center-2&&x<=center+2;}
function isPond(x,y,cx,cy,rx,ry,seed){return ((x-cx)/rx)**2+((y-cy)/ry)**2<1+(hash(x,y,seed)-.5)*.2;}
function isPath(x,y){if(Math.abs(x-58)<=2&&y>8&&y<74)return true; if(Math.abs(y-41)<=2&&x>10&&x<108)return true; if(Math.abs(x-26)<=2&&y>34&&y<48)return true; if(Math.abs(x-90)<=2&&y>32&&y<52)return true; return false;}
function isCliff(x,y){if(y<10 && x>12 && x<105 && !(x>52&&x<64))return true; if(y>18&&y<28&&x>2&&x<20)return true; if(y>54&&y<64&&x>6&&x<22)return true; return false;}
function isTree(x,y){if(isPath(x,y)||isCliff(x,y)||isRiver(x,y))return false; if(isPond(x,y,95,16,8,6,44)||isPond(x,y,20,60,10,7,55)||isPond(x,y,77,64,7,5,77))return false; const safe=((x-22)**2+(y-41)**2)<60; const boss=((x-100)**2+(y-41)**2)<36; if(safe||boss)return false; return hash(x,y,91)>.92&&hash(x+1,y,57)>.2;}
function tileAt(x,y){if(x<0||y<0||x>=COLS||y>=ROWS)return'wall'; if(isRiver(x,y)||isPond(x,y,95,16,8,6,44)||isPond(x,y,20,60,10,7,55)||isPond(x,y,77,64,7,5,77))return'water'; if(isCliff(x,y))return'cliff'; if(isTree(x,y))return'tree'; if(isPath(x,y))return'path'; return'grass';}
// ============================================================================
// WORLD ART — pixel-art terrain, trees and props.
// The map LAYOUT (tileAt and friends above) is unchanged, so collisions still
// match the server. Everything below is purely visual.
// The ground is pre-rendered once at 16 "art pixels" per tile and drawn at 2x,
// which gives the chunky, crisp pixel-art look.
// ============================================================================
const AP=2,AT=TILE/AP; // screen pixels per art pixel, art pixels per tile
const hexRgb=c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
const P={line:'#1b3522',
 g0:'#3a7634',g1:'#4a933f',g2:'#5dad49',g3:'#76c356',g4:'#9ad86c',  // grass
 p2:'#67b84f',p3:'#80ca5d',                                          // plateau grass (raised, a bit lighter)
 d0:'#8a5930',d1:'#ad753e',d2:'#cd9354',d3:'#e1af72',                // dirt path
 w0:'#1b62aa',w1:'#2a83d3',w2:'#3ea2ee',w3:'#7acbff',w4:'#effbff',   // water
 c0:'#2b1a10',c1:'#4a2e1b',c2:'#694227',c3:'#865934',c4:'#a7764a'};  // cliff earth
const PC={};for(const k in P)PC[k]=hexRgb(P[k]);
const LEAF=['#22552f','#2e773a','#45a04a','#80cf60'].map(hexRgb),LEAF_LINE=hexRgb('#132c1a');
const PINE=['#1d4b31','#286b41','#3a8c50','#6cbb6b'].map(hexRgb),PINE_LINE=hexRgb('#11261a');
const BLOSSOM=['#a0537d','#d57ca8','#f0a7c9','#ffdcec'].map(hexRgb),BLOSSOM_LINE=hexRgb('#5a2743');
const BARK=['#3b2415','#5a3921','#7a4f2d','#9b6b3e'].map(hexRgb),BARK_LINE=hexRgb('#22140b');
const STONE=['#4a5357','#6d787b','#929d9e','#c4cdcd'].map(hexRgb),STONE_LINE=hexRgb('#23292b');

const K_GRASS=0,K_PATH=1,K_WATER=2,K_CLIFF=3,K_TREE=4;
const KG=new Uint8Array(COLS*ROWS);
for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const k=tileAt(x,y);KG[y*COLS+x]=k==='path'?K_PATH:k==='water'?K_WATER:k==='cliff'?K_CLIFF:k==='tree'?K_TREE:K_GRASS;}
const kg=(x,y)=>KG[Math.max(0,Math.min(ROWS-1,y))*COLS+Math.max(0,Math.min(COLS-1,x))];
const groundKind=k=>k===K_TREE?K_GRASS:k;
const isWaterfall=(x,y)=>y<=3&&x>=105&&kg(x,y)===K_WATER;
function vnoise(x,y,seed){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
 const a=hash(xi,yi,seed),b=hash(xi+1,yi,seed),c=hash(xi,yi+1,seed),d=hash(xi+1,yi+1,seed);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;}

// Smooth "fields" turn the square tile grid into rounded, organic shorelines and path edges.
// Each field is 1 on target tiles and 0 elsewhere, smoothly interpolated between tile centres;
// the visual edge is where the field crosses 0.5. Collision tiles are untouched.
const WF=new Float32Array(COLS*ROWS),PF=new Float32Array(COLS*ROWS);
for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const k=KG[y*COLS+x];
 let nearWater=false;if(k===K_CLIFF)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(kg(x+dx,y+dy)===K_WATER)nearWater=true;
 WF[y*COLS+x]=k===K_WATER||nearWater?1:0;PF[y*COLS+x]=k===K_PATH?1:0;}
const fAt=(F,x,y)=>F[Math.max(0,Math.min(ROWS-1,y))*COLS+Math.max(0,Math.min(COLS-1,x))];
function field(F,X,Y){const u=(X+.5)/AT-.5,v=(Y+.5)/AT-.5,i=Math.floor(u),j=Math.floor(v);let a=u-i,b=v-j;a=a*a*(3-2*a);b=b*b*(3-2*b);
 const p=fAt(F,i,j),q=fAt(F,i+1,j),r=fAt(F,i,j+1),s=fAt(F,i+1,j+1);return p+(q-p)*a+(r-p)*b+(p-q-r+s)*a*b;}
// Signed distance in art pixels: >0 inside the feature, <0 outside.
function sdist(F,X,Y,seed){const f=field(F,X,Y);if(f<=0)return-99;if(f>=1)return 99;
 const gx=(field(F,X+1,Y)-field(F,X-1,Y))/2,gy=(field(F,X,Y+1)-field(F,X,Y-1))/2,g=Math.hypot(gx,gy);
 const wob=(vnoise(X*.16,Y*.16,seed)-.5)*1.8;if(g<1e-5)return f>.5?99:-99;return (f-.5)/g+wob;}
function grassPx(X,Y,plateau){
 const n=vnoise(X/26,Y/26,31),chk=((X+Y)&1)===0,h=hash(X,Y,33);
 let c=plateau?PC.p2:PC.g2;
 if(n>.68||(n>.64&&chk))c=plateau?PC.p3:PC.g3;
 else if(n<.16&&chk)c=PC.g1;
 if(h<.015)c=PC.g3;else if(h<.024)c=PC.g1;
 return c;
}
function dirtPx(X,Y){
 const n=vnoise(X/12,Y/12,41),chk=((X+Y)&1)===0,h=hash(X,Y,42);
 let c=PC.d2;if(n>.8||(n>.77&&chk))c=PC.d3;else if(n<.17&&chk)c=PC.d1;
 if(h<.012)c=PC.d1;else if(h<.02)c=PC.d3;return c;
}
function waterPx(X,Y){
 const w=Math.sin(X*.3+Math.sin(Y*.17)*2.6)*Math.sin(Y*.26+Math.sin(X*.13)*2);
 if(w>.84&&w<.92&&((X+Y)&1)===0)return PC.w3;if(w>.92)return PC.w3;if(w<-.9)return PC.w1;return PC.w2;
}
function waterfallPx(X,Y){const v=hash(X,0,40),seg=hash(X,Y>>2,43);let c=v>.6?PC.w3:v<.2?PC.w1:PC.w2;if(v>.84&&seg>.25)c=PC.w4;return c;}
function shade(c,f){return[c[0]*f|0,c[1]*f|0,c[2]*f|0];}
// Cliff walls are made of rounded earth "columns" of varying width, like the reference.
const COL_START=new Int32Array(COLS*AT),COL_W=new Int32Array(COLS*AT);
for(let X=0,id=0;X<COLS*AT;id++){const w=4+(hash(id,0,80)*4|0);for(let i=0;i<w&&X<COLS*AT;i++,X++){COL_START[X]=X-i;COL_W[X]=w;}}
function cliffWallPx(X,fy,hang){
 if(fy===0)return PC.g4;if(fy<hang-1)return PC.g2;if(fy<hang)return PC.g1;if(fy===hang)return PC.c0;
 const st=COL_START[X],w=COL_W[X],u=(X-st)/w,bottom=AT*2-3-(hash(st,1,81)*4|0);
 if(fy>bottom)return fy>=AT*2-1?PC.c0:PC.c1;
 if(X===st&&fy>hang+1)return PC.c0;
 let c=u<.34?PC.c3:u<.75?PC.c2:PC.c1;
 if(u<.34&&fy<hang+7&&((X+fy)&1))c=PC.c4;
 if(fy<hang+2)c=PC.c1;
 if(fy===bottom)c=PC.c1;
 const hh=hash(X,fy,83);if(hh<.03)c=PC.c1;else if(hh<.045&&u<.75)c=PC.c4;
 return c;
}

function terrainPx(X,Y){
 const tx=X>>4,ty=Y>>4,lx=X&15,ly=Y&15,tk=groundKind(kg(tx,ty));let c,k=tk;
 if(tk===K_CLIFF){
  const b1=kg(tx,ty+1)===K_CLIFF,b2=kg(tx,ty+2)===K_CLIFF,L=kg(tx-1,ty)!==K_CLIFF,Rt=kg(tx+1,ty)!==K_CLIFF;
  if(!b1||!b2){const fy=(b1?0:AT)+ly,hang=3+(hash(X,5,12)>.55?1:0)+(hash(X>>1,6,13)>.8?2:0);
   c=cliffWallPx(X,fy,hang);
   if(L&&lx<1||Rt&&lx>14)c=PC.c0;else if(L&&lx<2||Rt&&lx>13)c=fy<hang?PC.g0:PC.c1;
  }else{c=grassPx(X,Y,true);
   if(kg(tx,ty-1)!==K_CLIFF&&ty>0){if(ly<1)c=PC.line;else if(ly<2)c=PC.g4;}
   if(L&&lx<1||Rt&&lx>14)c=PC.line;else if(L&&lx<2||Rt&&lx>13)c=PC.g1;
  }
 }else{
  const sw=sdist(WF,X,Y,23);
  if(sw>0){k=K_WATER;
   const fall=ty<=3&&tx>=105;
   if(fall){c=sw<1?PC.c0:sw<2.5?(((X+Y)&1)?PC.c3:PC.c2):sw<3.5?PC.c1:waterfallPx(X,Y);} // rocky rim beside the waterfall
   else if(sw<1)c=PC.line;else if(sw<2.4)c=PC.w4;else if(sw<3.4)c=PC.w3;
   else if(ty===4&&tx>=105&&ly<5)c=(ly<3||((X+Y)&1))?PC.w4:PC.w3; // foam at the waterfall's foot
   else c=waterPx(X,Y);
  }else{
   const sp=sdist(PF,X,Y,24);
   if(sp>.4){k=K_PATH;c=sp<1.9?PC.g0:sp<3?PC.d1:dirtPx(X,Y);}
   else if(sp>-.9)c=PC.g3;
   else c=grassPx(X,Y,false);
  }
 }
 // soft shadow cast by a cliff wall onto the ground below it
 if(tk!==K_CLIFF&&kg(tx,ty-1)===K_CLIFF){if(ly<2)c=shade(c,.66);else if(ly<4||(ly<6&&((X+Y)&1)))c=shade(c,.82);}
 return c;
}

// ---------- sprite helpers (pixel shapes with outlines + top-left lighting) ----------
function makeSprite(w,h,shapes,outline,extra){
 const cv=document.createElement('canvas');cv.width=w;cv.height=h;const c=cv.getContext('2d'),id=c.createImageData(w,h),d=id.data;
 const top=new Int16Array(w*h).fill(-1);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let i=shapes.length-1;i>=0;i--)if(shapes[i].in(x+.5,y+.5)){top[y*w+x]=i;break;}
 const at=(x,y)=>x<0||y<0||x>=w||y>=h?-1:top[y*w+x];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const s=at(x,y);if(s<0)continue;const sh=shapes[s];let col;
  if(at(x-1,y)<0||at(x+1,y)<0||at(x,y-1)<0||at(x,y+1)<0)col=sh.line||outline;
  else{const below=at(x,y+1);col=(below>=0&&below<s&&!sh.noInner)?sh.pal[0]:sh.pal[sh.shade(x+.5,y+.5,x,y)];}
  const i=(y*w+x)*4;d[i]=col[0];d[i+1]=col[1];d[i+2]=col[2];d[i+3]=255;}
 c.putImageData(id,0,0);if(extra)extra(c);return cv;
}
const litIndex=(s,x,y)=>{s+=((x+y)&1)*.12;return s>.48?3:s>.02?2:s>-.5?1:0;};
const circ=(cx,cy,r,pal)=>({pal,in:(x,y)=>(x-cx)**2+(y-cy)**2<=r*r,shade:(x,y,ix,iy)=>litIndex((-(x-cx)*.55-(y-cy)*.85)/r,ix,iy)});
const ell=(cx,cy,rx,ry,pal)=>({pal,in:(x,y)=>((x-cx)/rx)**2+((y-cy)/ry)**2<=1,shade:(x,y,ix,iy)=>litIndex(-(x-cx)/rx*.55-(y-cy)/ry*.85,ix,iy)});
const box=(x0,y0,x1,y1,pal)=>({pal,noInner:true,in:(x,y)=>x>=x0&&x<=x1&&y>=y0&&y<=y1,shade:(x,y,ix,iy)=>{const r=(x-x0)/(x1-x0);return r<.3?3:r<.65?2:1;}});
const seg=(x1,y1,x2,y2,wd,pal)=>({pal,noInner:true,in:(x,y)=>{const dx=x2-x1,dy=y2-y1,t=Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-x1-t*dx,y-y1-t*dy)<=wd;},shade:(x,y,ix,iy)=>((ix+iy)%4===0?1:2)});
const tri=(cx,top,bot,hw,pal,seed)=>({pal,in:(x,y)=>{if(y<top||y>bot)return false;const half=(y-top)/(bot-top)*hw+.6;if(Math.abs(x-cx)>half)return false;return !(bot-y<1.6&&(Math.floor(x)+seed)%3===0);},
 shade:(x,y,ix,iy)=>{const rel=(x-cx)/hw,dep=(y-top)/(bot-top);let i=rel<-.3?3:rel<.2?2:rel<.55?1:0;if(dep>.82)i=Math.max(0,i-1);if(i===3&&dep>.6&&((ix+iy)&1))i=2;return i;}});
let seedState=1;const rnd=()=>{seedState=(Math.imul(seedState,1664525)+1013904223)>>>0;return seedState/4294967296;};

function makeOak(pal,line,v){seedState=901+v*77;const j=()=>(rnd()-.5)*2.2;
 return makeSprite(36,38,[box(15,24,20,37,BARK),seg(12,37,16,32,1.4,BARK),seg(23,37,19,32,1.4,BARK),
  circ(9+j(),23+j(),7.5,pal),circ(27+j(),23+j(),7.5,pal),circ(18,23+j(),8,pal),circ(9+j(),14+j(),7.5,pal),circ(27+j(),14+j(),7.5,pal),circ(18+j(),9,8,pal),circ(18+j(),16,7,pal)],line);}
function makePine(v){seedState=501+v*31;const w=v===2?1.12:1;
 return makeSprite(24,40,[box(10,32,13,39,BARK),tri(11.5,13,33,11*w,PINE,1),tri(11.5,7,25,8.5*w,PINE,2),tri(11.5,1,16,6*w,PINE,0)],PINE_LINE);}
function makeDeadTree(){return makeSprite(24,32,[box(10,12,13,31,BARK),seg(11,17,4,9,1.2,BARK),seg(4,9,2,4,.9,BARK),seg(12,14,19,6,1.2,BARK),seg(19,6,21,2,.9,BARK),seg(12,11,12,2,1.1,BARK),seg(16,10,20,11,.8,BARK)],BARK_LINE);}
function makeBush(v){seedState=301+v*13;return makeSprite(16,12,[circ(4.5,7,4.2,LEAF),circ(11.5,7,4.2,LEAF),circ(8,4.6+rnd(),4.6,LEAF)],LEAF_LINE,v===1?c=>{c.fillStyle='#ff6b7a';c.fillRect(5,5,1,1);c.fillRect(10,4,1,1);c.fillRect(8,8,1,1);}:null);}
function makeRock(v){return makeSprite(12,9,v?[ell(6,5,5,3.4,STONE),ell(4,3.5,2.6,2,STONE)]:[ell(6,5,5,3.4,STONE)],STONE_LINE,v?c=>{c.fillStyle='#5aa84a';c.fillRect(3,1,3,1);c.fillRect(2,2,2,1);}:null);}
function makeStump(){return makeSprite(12,10,[box(1.5,3,10.5,9,BARK),ell(6,3.2,4.6,2.2,[hexRgb('#8f6a3f'),hexRgb('#b38653'),hexRgb('#d1a46a'),hexRgb('#e3bd83')])],BARK_LINE,c=>{c.fillStyle='#9a6f43';c.fillRect(4,3,4,1);});}
function makeLog(){return makeSprite(18,8,[box(2,1.5,15,6.5,BARK),ell(15.5,4,2.2,2.6,[hexRgb('#8f6a3f'),hexRgb('#b38653'),hexRgb('#d1a46a'),hexRgb('#e3bd83')])],BARK_LINE);}

const SPR={oak:[0,1,2].map(v=>makeOak(LEAF,LEAF_LINE,v)),pine:[0,1,2].map(makePine),blossom:[0,1].map(v=>makeOak(BLOSSOM,BLOSSOM_LINE,v+5)),dead:[makeDeadTree()],
 bush:[0,1].map(makeBush),rock:[0,1].map(makeRock),stump:makeStump(),log:makeLog()};

// ---------- build the ground canvas ----------
const ground=document.createElement('canvas');ground.width=COLS*AT;ground.height=ROWS*AT;
const gctx=ground.getContext('2d');
(function paintTerrain(){
 const W=ground.width,H=ground.height,img=gctx.createImageData(W,H),d=img.data;
 for(let Y=0;Y<H;Y++)for(let X=0;X<W;X++){const c=terrainPx(X,Y),i=(Y*W+X)*4;d[i]=c[0];d[i+1]=c[1];d[i+2]=c[2];d[i+3]=255;}
 gctx.putImageData(img,0,0);
})();
const R=(x,y,w,h,c)=>{gctx.fillStyle=c;gctx.fillRect(x,y,w,h);};
function flower(x,y,pet,dark,mid){R(x,y+2,1,2,P.g0);R(x,y-1,1,1,pet);R(x-1,y,1,1,pet);R(x+1,y,1,1,pet);R(x-1,y+1,1,1,dark);R(x+1,y+1,1,1,dark);R(x,y+1,1,1,dark);R(x,y,1,1,mid);}
const FLOWERS={blue:['#79bdff','#3c6fd0','#fff2b8'],white:['#ffffff','#bfc9d6','#ffd64f'],purple:['#c28bf0','#7d4bbf','#ffe9a8'],pink:['#ff9fcf','#d0598f','#fff2c0'],yellow:['#ffe06a','#d39a2a','#fff7d6']};
function tuft(x,y,light){R(x,y+1,1,2,P.g1);R(x+1,y,1,3,light?P.g4:P.g3);R(x+2,y+2,1,1,P.g1);R(x+3,y,1,3,light?P.g4:P.g3);R(x+4,y+1,1,2,P.g1);}
function blob(x,y,rx,ry,col){gctx.fillStyle=col;for(let dy=-ry;dy<=ry;dy++){const w=Math.round(rx*Math.sqrt(1-(dy/(ry+.5))**2));gctx.fillRect(x-w,y+dy,w*2,1);}}
const plain=(x,y)=>{const k=kg(x,y);return k===K_GRASS||k===K_TREE;};
(function paintProps(){
 for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
  const k=KG[y*COLS+x],px=x*AT,py=y*AT;
  if(k===K_PATH){for(let i=0;i<2;i++)if(hash(x,y,620+i)<.35){const bx=px+3+(hash(x,y,630+i)*10|0),by=py+3+(hash(x,y,640+i)*10|0);R(bx,by,2,1,P.d3);R(bx,by+1,2,1,P.d0);}continue;}
  if(k===K_TREE){blob(px+8,py+15,7,2,'rgba(15,45,22,.38)');continue;}
  const plateau=k===K_CLIFF&&kg(x,y+1)===K_CLIFF&&kg(x,y+2)===K_CLIFF&&kg(x,y-1)===K_CLIFF;
  if(plateau){const h=hash(x,y,610);if(h<.3)tuft(px+3+(hash(x,y,611)*8|0),py+4+(hash(x,y,612)*8|0),true);else if(h<.36){const f=FLOWERS[h<.33?'yellow':'white'];flower(px+5+(hash(x,y,613)*6|0),py+6,...f);}continue;}
  if(k!==K_GRASS)continue;let open=true;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(!plain(x+dx,y+dy))open=false;if(!open)continue;
  const h=hash(x,y,601),ox=px+3+(hash(x,y,602)*8|0),oy=py+3+(hash(x,y,603)*8|0);
  if(h<.05){const f=FLOWERS.blue;flower(ox,oy,...f);flower(ox+4,oy+3,...f);if(hash(x,y,604)>.5)flower(ox-1,oy+6,...f);}
  else if(h<.068){const f=FLOWERS[hash(x,y,605)>.5?'white':'yellow'];flower(ox,oy,...f);flower(ox+5,oy+2,...f);}
  else if(h<.08){const f=FLOWERS[hash(x,y,606)>.5?'purple':'pink'];flower(ox,oy+1,...f);flower(ox+4,oy+4,...f);}
  else if(h<.088){R(ox-2,oy+1,5,2,'#d3433b');R(ox-1,oy,3,1,'#e8564c');R(ox-1,oy+1,1,1,'#ffffff');R(ox+1,oy,1,1,'#ffffff');R(ox-2,oy+3,5,1,'#7a2a26');R(ox-1,oy+3,3,2,'#f2e6c9');} // mushroom
  else if(h<.1)gctx.drawImage(SPR.rock[hash(x,y,607)>.5?1:0],px+2+(hash(x,y,608)*3|0),py+5);
  else if(h<.14){blob(px+8,py+14,7,2,'rgba(15,45,22,.3)');gctx.drawImage(SPR.bush[hash(x,y,609)>.75?1:0],px,py+3);}
  else if(h<.146){blob(px+8,py+13,6,2,'rgba(15,45,22,.3)');gctx.drawImage(SPR.stump,px+2,py+4);}
  else if(h<.15){gctx.drawImage(SPR.log,px-1,py+6);}
  else if(h<.6){tuft(ox,oy,h<.3);if(h>.48)tuft(px+1+(hash(x,y,614)*10|0),py+9+(hash(x,y,615)*4|0),false);}
 }
})();

// ---------- trees (y-sorted with players/monsters so you can walk behind them) ----------
const treeAt=new Array(COLS*ROWS).fill(null);
for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
 const k=KG[y*COLS+x];let spr=null;
 if(k===K_TREE){const h=hash(x,y,501),v=hash(x,y,502);
  spr=h<.04?SPR.dead[0]:h<.1?SPR.blossom[v*2|0]:h<.56?SPR.pine[v*3|0]:SPR.oak[v*3|0];}
 else if(k===K_CLIFF&&kg(x,y+1)===K_CLIFF&&kg(x,y+2)===K_CLIFF&&kg(x,y+3)===K_CLIFF&&hash(x,y,503)>.8)spr=SPR.pine[hash(x,y,504)*3|0]; // pines on the cliff tops
 if(spr)treeAt[y*COLS+x]={x,y,spr,dx:x*TILE+TILE/2-spr.width*AP/2+((hash(x,y,505)-.5)*6|0)*AP,dy:y*TILE+TILE-2-spr.height*AP,base:y*TILE+TILE*.75};
}
function visibleTrees(left,right,top,bottom,me){
 const out=[];
 for(let y=top;y<Math.min(ROWS,bottom+3);y++)for(let x=Math.max(0,left-1);x<Math.min(COLS,right+1);x++){const t=treeAt[y*COLS+x];if(!t)continue;
  out.push({y:t.base,draw:()=>{
   // Fade a tree a little when the local player is hidden behind it.
   const hide=me&&me.y<t.base&&me.y>t.dy+8&&Math.abs(me.x-(t.dx+t.spr.width*AP/2))<t.spr.width*AP/2-2;
   if(hide)ctx.globalAlpha=.55;ctx.drawImage(t.spr,t.dx,t.dy,t.spr.width*AP,t.spr.height*AP);if(hide)ctx.globalAlpha=1;}});}
 return out;
}

// ---------- per-frame drawing ----------
function drawWorldGround(now,left,right,top,bottom){
 const sx=Math.max(0,Math.floor(cameraX/AP)-1),sy=Math.max(0,Math.floor(cameraY/AP)-1);
 const sw=Math.min(ground.width-sx,Math.ceil(viewW/AP)+4),sh=Math.min(ground.height-sy,Math.ceil(viewH/AP)+4);
 ctx.drawImage(ground,sx,sy,sw,sh,sx*AP,sy*AP,sw*AP,sh*AP);
 // animated water: drifting sparkles, falling waterfall streaks, foam bubbles
 for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){
  if(KG[y*COLS+x]!==K_WATER)continue;const px=x*TILE,py=y*TILE;
  if(isWaterfall(x,y)){ctx.fillStyle='rgba(239,251,255,.75)';for(let i=0;i<3;i++){const col=2+(hash(x,i,700)*12|0),off=((now*.09+hash(x,i,701)*64)%64)-y*16;if(off>-8&&off<16)ctx.fillRect(px+col*AP,py+Math.max(0,off)*AP,AP,Math.min(6,16-Math.max(0,off))*AP);}continue;}
  if(y===4&&isWaterfall(x,3)){ctx.fillStyle='#ffffff';for(let i=0;i<4;i++){const t=(now/700+hash(x,i,720))%1;ctx.globalAlpha=1-t;ctx.fillRect(px+(2+hash(x,i,721)*12|0)*AP,py+(4+t*9|0)*AP,AP,AP);}ctx.globalAlpha=1;continue;}
  if(hash(x,y,711)<.45)continue;
  const t=(now/1400+hash(x,y,710))%1,a=Math.sin(t*Math.PI);if(a<.15)continue;
  const sx2=px+(3+hash(x,y,712)*9|0)*AP,sy2=py+(4+hash(x,y,713)*8|0)*AP;
  ctx.globalAlpha=a*.9;ctx.fillStyle=P.w4;ctx.fillRect(sx2,sy2,AP*3,AP);ctx.fillRect(sx2+AP,sy2-AP,AP,AP);ctx.globalAlpha=1;
 }
}
// Soft diagonal sunbeams in screen space, like the reference art.
function drawLightRays(now){
 ctx.save();
 for(let i=0;i<4;i++){
  const span=viewW+viewH*.7,x0=((i*.29+.08)*span-cameraX*.12+now*.006)%span;const x=(x0<0?x0+span:x0)-viewH*.1,w=50+i*26;
  const gr=ctx.createLinearGradient(0,0,0,viewH);gr.addColorStop(0,'rgba(255,248,214,.13)');gr.addColorStop(.7,'rgba(255,248,214,.04)');gr.addColorStop(1,'rgba(255,248,214,0)');
  ctx.fillStyle=gr;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+w,0);ctx.lineTo(x+w-viewH*.55,viewH);ctx.lineTo(x-viewH*.55,viewH);ctx.closePath();ctx.fill();
 }
 ctx.restore();
}
function buildMinimapBase(){
 miniBaseCtx.imageSmoothingEnabled=true;miniBaseCtx.drawImage(ground,0,0,minimap.width,minimap.height);
 const sx=minimap.width/COLS,sy=minimap.height/ROWS;miniBaseCtx.fillStyle='#2a5e36';
 for(const t of treeAt)if(t&&KG[t.y*COLS+t.x]===K_TREE)miniBaseCtx.fillRect(t.x*sx,t.y*sy,Math.max(1,sx),Math.max(1,sy));
 miniBaseCtx.strokeStyle='#d9f2cd33';miniBaseCtx.strokeRect(.5,.5,minimap.width-1,minimap.height-1);
}
buildMinimapBase();


function connect(){ui('status').textContent='Connecting…';ui('dot').classList.remove('online');const url=SERVER_URL?SERVER_URL.replace(/^http/,'ws').replace(/\/$/,''):(location.protocol==='https:'?'wss://':'ws://')+location.host;ws=new WebSocket(url);
ws.onopen=()=>{ui('status').textContent='Connected';ui('dot').classList.add('online');retries=0;ws.send(JSON.stringify({type:'init',save:{...readSave(),name:ui('name').value}}));};
ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}if(m.type==='welcome'){if(checkServerVersion(m.version))return;readyToSave=false;myId=m.id;players.clear();monsters.clear();projectiles.clear();m.players.forEach(updatePlayer);m.monsters.forEach(updateMonster);ui('chat-messages').replaceChildren();(m.chat||[]).forEach(addChatLine);}
else if(m.type==='join')updatePlayer(m.player);
else if(m.type==='state'){serverClockOffset=(m.serverNow||Date.now())-Date.now();if(m.players.some(p=>p.id===myId))readyToSave=true;const ids=new Set();m.players.forEach(p=>{ids.add(p.id);updatePlayer(p);});for(const id of players.keys())if(!ids.has(id))players.delete(id);const activeMonsterIds=new Set();m.monsters.forEach(mon=>{activeMonsterIds.add(mon.id);updateMonster(mon);});for(const id of monsters.keys())if(!activeMonsterIds.has(id))monsters.delete(id);const shots=new Set();for(const b of m.projectiles){shots.add(b.id);const old=projectiles.get(b.id);if(old){old.tx=b.x;old.ty=b.y;}else projectiles.set(b.id,{...b,tx:b.x,ty:b.y});}for(const id of projectiles.keys())if(!shots.has(id))projectiles.delete(id);}
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
else if(m.type==='quake_impact'){quakeFx.push({x:m.x,y:m.y,r:m.radius,start:performance.now()});for(let i=0;i<55;i++){const a=Math.random()*Math.PI*2,r=Math.random()*m.radius;spawnParticle(m.x+Math.cos(a)*r,m.y+Math.sin(a)*r,(Math.random()-.5)*95,-55-Math.random()*100,600+Math.random()*700,'#cb9871',3+Math.random()*5,110);}}
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
function updateMonster(m){const old=monsters.get(m.id);if(old){if(Math.abs(m.x-old.tx)>.3)old.face=m.x>old.tx?1:-1;const castNew=m.quakeStart&&m.quakeStart!==old.quakeStart;Object.assign(old,{...m,tx:m.x,ty:m.y,x:old.x,y:old.y});if(castNew)old.localQuakeStart=performance.now();if(!m.quakeStart)old.localQuakeStart=0;}else monsters.set(m.id,{...m,tx:m.x,ty:m.y,localQuakeStart:m.quakeStart?performance.now():0});}
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
// ============================================================================
// CHARACTER ART — pixel sprites for the hero and monsters, built in code and
// cached. Drawn at 2x (AP) to match the world. Every sprite gets an automatic
// dark outline, which is what gives the reference art its crisp look.
// ============================================================================
function inPoly(pts,x,y){let c=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const[xi,yi]=pts[i],[xj,yj]=pts[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}
function segD(x,y,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/l)):0;return Math.hypot(x-x1-t*dx,y-y1-t*dy);}
function pix(w,h,oy=0){const d=new Array(w*h).fill(null);const P={w,h,d,
 set(x,y,c){x=Math.floor(x);y=Math.floor(y+oy);if(c&&x>=0&&y>=0&&x<w&&y<h)d[y*w+x]=c;},
 rect(x,y,ww,hh,c){for(let j=0;j<hh;j++)for(let i=0;i<ww;i++)P.set(x+i,y+j,typeof c==='function'?c(x+i,y+j):c);},
 fill(test,c){for(let y=-oy;y<h-oy;y++)for(let x=0;x<w;x++)if(test(x+.5,y+.5))P.set(x,y,typeof c==='function'?c(x,y):c);},
 ell(cx,cy,rx,ry,c){P.fill((x,y)=>((x-cx)/rx)**2+((y-cy)/ry)**2<=1,c);},
 poly(pts,c){P.fill((x,y)=>inPoly(pts,x,y),c);},
 line(x1,y1,x2,y2,r,c){P.fill((x,y)=>segD(x,y,x1,y1,x2,y2)<=r,c);},
 outline(c){const s=d.slice(),n=(i,j)=>i>=0&&j>=0&&i<w&&j<h&&s[j*w+i];for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(!s[y*w+x]&&(n(x-1,y)||n(x+1,y)||n(x,y-1)||n(x,y+1)))d[y*w+x]=c;},
 canvas(){const cv=document.createElement('canvas');cv.width=w;cv.height=h;const c=cv.getContext('2d');for(let i=0;i<d.length;i++)if(d[i]){c.fillStyle=d[i];c.fillRect(i%w,(i/w)|0,1,1);}return cv;}};return P;}
const mixHex=(a,b,t)=>{const A=hexRgb(a),B=hexRgb(b);return'#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('');};

// ---------------- Hero ----------------
const HAIR=['#5a2711','#8e431b','#bd6428','#e3944a'],SKIN=['#d89570','#f5c79d','#ffe3c6'];
const CAPE=['#6c1521','#a5252f','#d4443e'],GOLDC=['#9a6a1c','#e1ab37','#ffe680'],PANTS=['#4a2117','#783824'],BOOT=['#2f1910','#5e321c','#83502c'];
const HERO_OUT='#28150f',EYE=['#1c2a58','#4b87da'];
const heroCache=new Map();
function heroSprite(dir,frame,armor){
 const key=dir+frame+armor;let s=heroCache.get(key);if(s)return s;
 const p=pix(28,32),A=[mixHex(armor,'#0d1022',.45),armor,mixHex(armor,'#ffffff',.3)],G=GOLDC,C=CAPE,H=HAIR,S=SKIN;
 const lL=frame===1?1:0,lR=frame===3?1:0,b=frame===1||frame===3?-1:0,fl=frame===1?1:frame===3?-1:0;
 const leg=(x,l)=>{p.rect(x,23-l,3,3,PANTS[1]);p.rect(x+2,23-l,1,3,PANTS[0]);p.rect(x,26-l,3,3,BOOT[1]);p.rect(x,26-l,1,2,BOOT[2]);p.rect(x,28-l,3,1,BOOT[0]);};
 const eye=(x)=>{p.rect(x,12,2,3,EYE[0]);p.rect(x,14,2,1,EYE[1]);p.set(x,12,'#ffffff');};
 if(dir==='down'){
  p.rect(8,16+b,12,9,C[1]);p.rect(8,16+b,1,9,C[0]);p.rect(19,16+b,1,9,C[0]);p.rect(7,24+b,3,2+(fl>0?1:0),C[0]);p.rect(18,24+b,3,2+(fl<0?1:0),C[0]);
  leg(10,lL);leg(15,lR);
  p.rect(9,16+b,10,6,A[1]);p.rect(9,16+b,2,6,A[2]);p.rect(17,16+b,2,6,A[0]);p.rect(13,17+b,2,4,A[0]);
  p.rect(8,21+b,12,3,A[1]);p.rect(8,21+b,2,3,A[2]);p.rect(18,21+b,2,3,A[0]);p.rect(8,23+b,12,1,A[0]);
  p.rect(9,21+b,10,1,G[1]);p.rect(13,21+b,2,1,G[2]);p.rect(12,16+b,4,1,G[1]);
  p.rect(6,16+b,4,2,G[1]);p.rect(6,16+b,2,1,G[2]);p.rect(18,16+b,4,2,G[1]);p.rect(20,17+b,2,1,G[0]);
  p.rect(7,18+b,2,3,A[0]);p.rect(7,21+b,2,2,S[1]);
  const sx=21,sy=21+b;p.ell(sx,sy,4.6,4.6,G[1]);p.ell(sx,sy,3.5,3.5,'#2b6aa8');p.ell(sx-.7,sy-.7,2.3,2.3,'#4b93d4');p.rect(sx-1,sy-1,2,2,'#cc3a3a');p.set(sx-1,sy-1,'#ff8a7a');p.set(sx-3,sy-2,G[2]);p.set(sx-2,sy-3,G[2]);
  p.rect(9,9,10,7,S[1]);p.rect(18,10,1,6,S[0]);p.rect(10,15,8,1,S[1]);
  p.ell(14,7,7.6,5,H[2]);
  [[13,3,11,0],[16,3,18,.5],[10,5,6,3],[19,5,23,4],[8,9,5,10],[20,9,23,11]].forEach(([a,c,e,f])=>p.line(a,c,e,f,1.25,H[2]));
  p.rect(7,9,2,6,H[1]);p.rect(19,9,2,6,H[1]);
  p.line(10,4,8,2,.6,H[3]);p.line(15,2.5,17,1.5,.6,H[3]);p.line(12,6,15,5,.6,H[3]);p.rect(8,7,12,1,H[1]);
  p.rect(8,9,12,1,G[1]);p.set(9,9,G[2]);p.rect(13,9,2,1,'#d4383a');p.set(13,9,'#ff8a80');
  [2,1,2,1,1,2,1,2,1,2].forEach((n,i)=>p.rect(9+i,10,1,n,i%2?H[2]:H[1]));
  eye(10);eye(16);p.set(14,15,S[0]);
 }else if(dir==='up'){
  leg(10,lL);leg(15,lR);
  p.rect(8,16+b,12,10,C[1]);p.rect(9,16+b,1,9,C[2]);p.rect(11,18+b,1,8,C[0]);p.rect(16,18+b,1,8,C[0]);p.rect(8,25+b,12,1,C[0]);p.rect(7,22+b,1,3+(fl>0?1:0),C[0]);p.rect(20,22+b,1,3+(fl<0?1:0),C[0]);
  p.rect(6,16+b,4,2,G[1]);p.rect(18,16+b,4,2,G[1]);p.rect(19,18+b,2,3,A[0]);p.rect(19,21+b,2,2,S[1]);
  p.ell(7,21+b,4.6,4.6,G[1]);p.ell(7,21+b,3.5,3.5,'#6b4426');p.rect(6,19+b,1,5,'#87582f');p.rect(8,19+b,1,5,'#87582f');
  p.ell(14,8,7.6,6.4,H[2]);
  [[13,3,11,0],[16,3,18,.5],[10,5,6,3],[19,5,23,4],[8,9,5,11],[20,9,23,11],[11,13,10,16],[17,13,18,16],[14,14,14,16.5]].forEach(([a,c,e,f])=>p.line(a,c,e,f,1.25,H[2]));
  p.rect(8,11,13,4,H[1]);p.line(10,4,8,2,.6,H[3]);p.line(15,2.5,17,1.5,.6,H[3]);p.line(11,7,16,6,.6,H[3]);
  p.set(6,9,G[1]);p.set(22,9,G[1]);
 }else{ // right (left is mirrored at draw time)
  const st=fl;p.poly([[11,16+b],[6,17+b],[3,26+b+(fl>0?1:0)],[11,26+b]],C[1]);p.line(6,18+b,4,25+b,.6,C[0]);p.rect(3,25+b,8,1,C[0]);
  leg(11-st,lR);leg(14+st,lL);p.set(17+st,28-lL,BOOT[1]);
  p.rect(11,16+b,7,6,A[1]);p.rect(15,16+b,2,6,A[2]);p.rect(11,16+b,1,6,A[0]);
  p.rect(10,21+b,9,3,A[1]);p.rect(10,23+b,9,1,A[0]);p.rect(15,21+b,2,2,A[2]);p.rect(10,21+b,9,1,G[1]);p.rect(15,21+b,2,1,G[2]);
  p.rect(12,16+b,5,2,G[1]);p.rect(15,16+b,2,1,G[2]);
  p.rect(14+st,18+b,2,3,A[0]);p.rect(14+st,21+b,2,2,S[1]);
  p.rect(12,9,7,7,S[1]);p.set(19,12,S[1]);p.set(19,13,S[0]);p.rect(13,15,5,1,S[1]);
  p.ell(13.5,7,7,5,H[2]);p.rect(8,7,6,8,H[2]);
  [[13,3,12,0],[16,3,19,1],[10,4,6,2],[8,7,4,7],[8,10,4,12],[9,13,6,15],[18,6,21,7]].forEach(([a,c,e,f])=>p.line(a,c,e,f,1.25,H[2]));
  p.rect(7,11,6,4,H[1]);p.line(10,4,8,2,.6,H[3]);p.line(14,4,17,2,.6,H[3]);p.rect(12,10,2,5,H[1]);p.set(13,12,S[0]);
  p.rect(13,9,7,1,G[1]);p.set(14,9,G[2]);p.rect(18,9,1,1,'#d4383a');
  [1,2,1,2,1,1].forEach((n,i)=>p.rect(14+i,10,1,n,i%2?H[2]:H[1]));
  p.rect(16,12,2,3,EYE[0]);p.rect(16,14,2,1,EYE[1]);p.set(17,12,'#ffffff');
 }
 p.outline(HERO_OUT);s=p.canvas();heroCache.set(key,s);return s;
}
const SWORD=(()=>{const p=pix(22,9);p.rect(1,3,4,3,'#6b3f22');p.rect(1,3,4,1,'#8f5a30');p.rect(0,3,1,3,GOLDC[1]);p.rect(5,1,2,7,GOLDC[1]);p.rect(5,1,1,7,GOLDC[2]);p.rect(7,3,12,3,'#c9d8e2');p.rect(7,3,12,1,'#ffffff');p.rect(7,5,12,1,'#8fa3b3');p.rect(19,4,1,1,'#c9d8e2');p.outline(HERO_OUT);return p.canvas();})();

// ---------------- Monsters ----------------
const monCache=new Map();
function monSprite(type,frame){const key=type+frame;let s=monCache.get(key);if(s)return s;
 s=type==='rat'?ratSprite(frame):type==='bat'?batSprite(frame):type==='baphomet'?baphSprite(frame):jrSprite(frame);monCache.set(key,s);return s;}
function ratSprite(f){const p=pix(24,15),B=['#4c403a','#6c5c53','#8d7c71','#ad9d90'];
 p.line(1,7,2,10,.7,'#c98d8a');p.line(2,10,6,10,.7,'#c98d8a');
 p.ell(10,9,6.6,4.2,(x,y)=>y<7?B[2]:y>11?B[0]:B[1]);p.ell(9,7,3,1.2,B[3]);p.ell(11,11,4,1.2,'#a39083');
 p.ell(16.5,8,3.8,3.2,B[1]);p.ell(16,7,2,1.2,B[2]);p.ell(20,9,2.2,1.6,B[1]);p.set(22,9,'#f08b9c');
 p.ell(14.5,4.2,2,2,B[1]);p.set(14,4,'#f3a0b2');p.set(15,4,'#f3a0b2');p.set(18,7,'#e23a3a');p.set(18,6,'#ff9a8a');
 p.rect(6+(f?1:0),12,2,2,'#f3a0b2');p.rect(13-(f?1:0),12,2,2,'#f3a0b2');
 p.outline('#211915');p.set(22,11,'#d9d9d9');p.set(23,12,'#d9d9d9');return p.canvas();}
function batSprite(f){const p=pix(30,19),Wc='#3d2f5c',Wr='#5b4a85';
 const L=f?[[13,9],[3,13],[6,13],[4,17],[8,14],[10,16],[13,12]]:[[13,9],[2,1],[4,5],[1,9],[6,9],[8,12],[13,12]];
 const R=L.map(([x,y])=>[29-x,y]);p.poly(L,Wc);p.poly(R,Wc);
 [L,R].forEach(W=>{p.line(W[0][0],W[0][1],W[1][0],W[1][1],.6,Wr);p.line(W[0][0],W[0][1],W[3][0],W[3][1],.5,Wr);});
 p.line(12,6,11,2,.9,'#5b4c84');p.line(17,6,18,2,.9,'#5b4c84');
 p.ell(14.5,9.5,4.6,5,(x,y)=>x<14&&y<9?'#7c6aa8':'#5b4c84');p.ell(14.5,12,2.6,1.6,'#6c5c96');
 p.rect(12,8,2,2,'#ff6f91');p.rect(16,8,2,2,'#ff6f91');p.set(12,8,'#ffd0dc');p.set(16,8,'#ffd0dc');
 p.set(13,12,'#ffffff');p.set(16,12,'#ffffff');p.outline('#191223');return p.canvas();}
function jrSprite(f){const p=pix(26,30),F=['#262a3a','#3b4158','#565e7e'],ROBE=['#5e1a49','#9a2f72','#c8569a'];
 const wy=f?2:0;[[10,13],[3,7+wy],[4,12+wy],[1,16+wy],[8,17]].forEach(()=>{});
 const Wl=[[10,13],[3,6+wy],[4,11+wy],[1,15+wy],[7,17],[10,17]];p.poly(Wl,'#24222f');p.poly(Wl.map(([x,y])=>[25-x,y]),'#24222f');
 p.line(10,13,3,6+wy,.5,'#3c3a52');p.line(15,13,22,6+wy,.5,'#3c3a52');
 p.rect(9,22,3,5,F[0]);p.rect(14,22,3,5,F[0]);p.rect(9,26,3,1,'#111');p.rect(14,26,3,1,'#111');
 p.poly([[8.5,14],[17.5,14],[20,25],[6,25]],(x,y)=>y>=23?GOLDC[1]:x<10?ROBE[2]:x>16?ROBE[0]:ROBE[1]);p.rect(12,15,2,8,ROBE[0]);
 p.line(9,16,6,21,1.2,F[1]);p.line(17,16,20,21,1.2,F[1]);
 p.ell(13,8.5,4.8,4.4,(x,y)=>x<12&&y<8?F[2]:F[1]);p.ell(13,12,2.6,2.2,F[1]);p.rect(12,13,2,1,F[0]);
 p.line(10,5,7,1,1,'#d9c39a');p.line(16,5,19,1,1,'#d9c39a');p.set(7,1,'#8a7550');p.set(19,1,'#8a7550');
 p.line(9,8,6,7,.8,F[1]);p.line(17,8,20,7,.8,F[1]);
 p.rect(10,8,2,2,'#ffd23a');p.rect(14,8,2,2,'#ffd23a');p.set(10,8,'#fff6c0');p.set(14,8,'#fff6c0');
 p.rect(11,15,4,1,GOLDC[1]);p.set(13,16,GOLDC[2]);
 p.outline('#15121c');return p.canvas();}
function baphSprite(f){
 const p=pix(63,78,10),cx=31,dy=[0,3,6,3][f],FUR=['#20263a','#323a52','#4a5472','#66729a'],M='#14141c',GD=['#8a6220','#d9aa3c','#ffe07a'];
 // wings
 for(const s of[-1,1]){const X=x=>cx+s*x;
  const sh=[X(7),25],el=[X(18),5+dy*.5],tip=[X(31),-7+dy],pts=[sh,el,tip,[X(31),9+dy],[X(25),13+dy*.8],[X(28),25+dy*.6],[X(21),26+dy*.4],[X(21),38+dy*.2],[X(14),33],[X(11),41],[X(8),33]];
  p.poly(pts,(x,y)=>segD(x,y,...sh,...el)<4||segD(x,y,...el,...tip)<3?'#2a2c3e':'#1b1c28');
  for(const q of[pts[3],pts[5],pts[7],pts[9]])p.line(...el,...q,.55,'#383b54');
  p.line(...sh,...el,1.5,'#3b3e58');p.line(...el,...tip,1.1,'#3b3e58');p.line(...tip,X(31),tip[1]-2,.7,'#cfb98c');p.line(...el,X(18),el[1]-3,.7,'#cfb98c');}
 // tail
 p.line(38,60,49,63,1,FUR[1]);p.line(49,63,54,56,1,FUR[1]);p.poly([[54,51],[57.5,55],[54,58],[50.5,55]],FUR[1]);
 // robe
 p.poly([[21,37],[41,37],[46,64],[16,64]],(x,y)=>{if(y>=62)return GD[1];const k=(Math.floor(x)+Math.floor(y/3))%8;return x<24?'#7e2838':k===0||x>38?'#3b0f19':'#5e1a28';});
 p.rect(29,38,4,24,'#3b0f19');p.rect(30,38,1,24,GD[0]);p.rect(32,38,1,24,GD[0]);
 p.rect(22,64,6,2,'#15151b');p.rect(34,64,6,2,'#15151b');
 // torso + arms
 p.ell(cx,31,10.5,8.5,(x,y)=>x<cx-3&&y<30?FUR[2]:FUR[1]);
 for(const s of[-1,1]){const sx=cx+s*10,ex=cx+s*14,hx=cx+s*10;
  p.line(sx,26,ex,37,2.6,s<0?FUR[2]:FUR[1]);p.line(ex,37,hx,46,2.3,FUR[1]);p.line(ex-s*.5,40,ex-s*1.4,42.5,2.2,GD[1]);p.line(ex-s*.5,40,ex-s*.9,41,.6,GD[2]);
  p.ell(hx,47,2.4,2,FUR[2]);[-1.5,0,1.5].forEach(o=>p.set(hx+o,49.5,'#cfb98c'));}
 p.poly([[23,24],[39,24],[31,38]],(x,y)=>(Math.floor(x)%3===0)?'#262634':M);
 for(let i=0;i<=10;i++){const a=Math.PI*(.12+.76*i/10);p.ell(cx+Math.cos(a)*8.5,24+Math.sin(a)*7,1.1,1.1,i===5?'#d4383a':GD[1]);}
 // head
 p.ell(cx,13,9,8.5,M);[[22,9,17,5],[40,9,45,5],[22,15,16,16],[40,15,46,16],[24,19,20,23],[38,19,42,23]].forEach(([a,b,c,d])=>p.line(a,b,c,d,1.4,M));
 p.rect(28,19,6,6,FUR[0]);
 for(const s of[-1,1]){const e=[[cx+s*5,13],[cx+s*12,11],[cx+s*11,14],[cx+s*5,16]];p.poly(e,FUR[1]);p.line(cx+s*6,14,cx+s*10,12.5,.5,'#7a2a3a');}
 p.ell(cx,12,5.6,5,(x,y)=>x<cx-1?FUR[3]:FUR[2]);p.poly([[26,13],[36,13],[34,24],[28,24]],(x,y)=>x<cx-1.5?FUR[3]:x>cx+2?FUR[1]:FUR[2]);
 p.rect(28,22,6,3,FUR[0]);p.set(29,23,'#07070b');p.set(32,23,'#07070b');p.rect(29,25,4,1,FUR[0]);
 p.poly([[28,25],[34,25],[31,31]],M);
 p.rect(26,12,3,2,'#ff2e2e');p.rect(33,12,3,2,'#ff2e2e');p.set(27,12,'#ffd090');p.set(34,12,'#ffd090');p.rect(25,11,4,1,FUR[0]);p.rect(33,11,4,1,FUR[0]);
 // ridged horns
 for(const s of[-1,1]){const P0=[cx+s*3,8],P1=[cx+s*5,-9],P2=[cx+s*12,-8];
  for(let i=0;i<=40;i++){const t=i/40,x=(1-t)**2*P0[0]+2*(1-t)*t*P1[0]+t*t*P2[0],y=(1-t)**2*P0[1]+2*(1-t)*t*P1[1]+t*t*P2[1],r=3-2.1*t;
   p.ell(x,y,r,r,(Math.floor(t*14)%2)?'#8b7650':t<.5?'#ead5a6':'#cdb688');}}
 p.outline('#0c0a12');return p.canvas();}

function drawPlayer(p,now){const x=p.x,y=p.y,walking=Math.hypot(p.tx-p.x,p.ty-p.y)>.25;
 const age=now-(p.visualJumpStart||0),jumping=!!p.visualJumpStart&&age>=0&&age<480,height=jumping?Math.sin(age/480*Math.PI)*20:0,shadowScale=1-height/40;
 const leapAge=now-(p.visualLeapStart||0),leapHeight=p.visualLeapStart&&leapAge>=0&&leapAge<520?Math.sin(Math.PI*leapAge/520)*46:0;
 ellipse(x,y+15,12*shadowScale,4*shadowScale,'#14301c70');
 ctx.save();ctx.translate(0,-height-leapHeight);
 const spinAge=now-(p.visualSpinStart||0),spinning=!!p.visualSpinStart&&spinAge>=0&&spinAge<3000;
 if(spinning){ctx.translate(x,y);ctx.rotate(spinAge/105);ctx.translate(-x,-y);}
 if(Date.now()<p.invulnerableUntil&&Math.floor(now/85)%2===0)ctx.globalAlpha=.45;
 const dir=['up','down','left','right'].includes(p.dir)?p.dir:'down',armor=colors[p.color%colors.length]||colors[0];
 const frame=walking&&!jumping&&!leapHeight?[1,0,3,0][Math.floor(now/120)%4]:0,bob=frame?-AP:0;
 const spr=heroSprite(dir==='left'?'right':dir,frame,armor);
 const dirs={up:-Math.PI/2,down:Math.PI/2,left:Math.PI,right:0};const slashAge=now-(p.visualAttackStart||0),swing=!!p.visualAttackStart&&slashAge>=0&&slashAge<230;
 const facing=swing&&Number.isFinite(p.attackAngle)?p.attackAngle:(dirs[dir]??Math.PI/2);const bladeAngle=spinning?0:facing+(swing?(-1.2+2.4*slashAge/230):.58);
 // sword hand position (screen px relative to the player)
 const hand={down:[-12,0],up:[12,-2],right:[5,-2],left:[-5,-2]}[dir];
 const drawSword=()=>{ctx.save();ctx.translate(x+hand[0],y+hand[1]+bob);ctx.rotate(bladeAngle);ctx.drawImage(SWORD,-5,-9,SWORD.width*AP,SWORD.height*AP);ctx.restore();};
 const swordBehind=!spinning&&(swing?Math.sin(facing)<-.35:dir==='up');
 if(swordBehind)drawSword();
 const sx=-14*AP,sy=y+16-30*AP;
 if(dir==='left'){ctx.save();ctx.translate(x,0);ctx.scale(-1,1);ctx.drawImage(spr,sx,sy,spr.width*AP,spr.height*AP);ctx.restore();}
 else ctx.drawImage(spr,x+sx,sy,spr.width*AP,spr.height*AP);
 if(!swordBehind)drawSword();
 if(spinning){ctx.save();ctx.translate(x,y-4);ctx.strokeStyle='#f5ecab';ctx.lineWidth=4;ctx.globalAlpha=.75;ctx.beginPath();ctx.arc(0,0,83,0,Math.PI*2);ctx.stroke();ctx.restore();}
 if(swing){ctx.save();ctx.translate(x,y-4);ctx.rotate(facing);ctx.strokeStyle='#fff4bd';ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.arc(0,0,60,-1.15+slashAge/230*1.45,-.7+slashAge/230*1.45);ctx.stroke();ctx.restore();}
 ctx.restore();
 const top=y-48-height-leapHeight;
 label(`${p.name}  Lv.${p.level}`,x,top-6,p.id===myId?'#ffef9d':'#fff',11);ctx.fillStyle='#172b21';ctx.fillRect(x-18,top-1,36,4);ctx.fillStyle='#e86c71';ctx.fillRect(x-18,top-1,36*Math.max(0,p.hp/p.maxHp),4);}

// Where each monster sprite sits relative to its position, and where its name goes.
const MON_LAYOUT={rat:{feet:12,anchorY:13,top:-26,shadow:[11,4,10]},bat:{feet:0,anchorY:10,top:-30,shadow:[10,3,14]},
 baphometjr:{feet:13,anchorY:27,top:-48,shadow:[12,4,12]},baphomet:{feet:22,anchorY:76,top:-136,shadow:[30,9,22]}};
function drawMonster(m,now){if(!m.alive)return;const x=m.x,y=m.y,L=MON_LAYOUT[m.type]||MON_LAYOUT.rat;
 const flying=m.type==='bat'||m.type==='baphomet'||m.type==='baphometjr',float=flying?Math.sin(now/180+m.x)*4:0;
 if(m.type==='baphomet'){const g=ctx.createRadialGradient(x,y+L.feet,4,x,y+L.feet,90);g.addColorStop(0,'rgba(210,30,45,.32)');g.addColorStop(1,'rgba(210,30,45,0)');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(x,y+L.feet,90,40,0,0,Math.PI*2);ctx.fill();}
 ellipse(x,y+L.shadow[2],L.shadow[0],L.shadow[1],'#14301c70');
 const frame=m.type==='bat'?Math.floor(now/110)%2:m.type==='baphomet'?Math.floor(now/160)%4:m.type==='baphometjr'?Math.floor(now/200)%2:(Math.hypot(m.tx-m.x,m.ty-m.y)>.3?Math.floor(now/110)%2:0);
 const spr=monSprite(m.type,frame),w=spr.width*AP,h=spr.height*AP,dy=y+L.feet-L.anchorY*AP+(flying?float:0);
 if(m.type==='rat'&&m.face<0){ctx.save();ctx.translate(x,0);ctx.scale(-1,1);ctx.drawImage(spr,-w/2,dy,w,h);ctx.restore();}else ctx.drawImage(spr,x-w/2,dy,w,h);
 if(m.type==='baphomet'){ctx.save();ctx.globalAlpha=.45+Math.sin(now/220)*.2;ctx.fillStyle='#ff4a3a';for(const ex of[-8,8]){ctx.beginPath();ctx.arc(x+ex,dy+23*AP,4,0,Math.PI*2);ctx.fill();}ctx.restore();}
 const top=y+L.top+float,big=m.type==='baphomet';
 const name=m.name||(m.type==='bat'?'Bat':m.type==='rat'?'Rat':big?'Baphomet':'Baphomet.Jr');label(name,x,top-6,big?'#ffb995':'#ffddd2',big?12:11);
 ctx.fillStyle='#24342a';const bw=big?64:m.type==='baphometjr'?36:30;ctx.fillRect(x-bw/2,top,bw,5);ctx.fillStyle=big?'#b44555':m.type==='baphometjr'?'#ff85b6':'#e77a76';ctx.fillRect(x-bw/2,top,bw*Math.max(0,m.hp/m.maxHp),5);
 if(Date.now()<m.stunnedUntil){const sy=top-14;for(let i=0;i<3;i++){const a=now/180+i*Math.PI*2/3;ctx.fillStyle='#ffe299';ctx.beginPath();ctx.moveTo(x+Math.cos(a)*13,sy+Math.sin(a)*4);for(let k=1;k<5;k++){const aa=a+k*Math.PI*2/5,r=k%2?4.8:2.2;ctx.lineTo(x+Math.cos(aa)*13+Math.cos(aa)*r,sy+Math.sin(a)*4+Math.sin(aa)*r);}ctx.closePath();ctx.fill();}label('STUN',x,sy-10,'#ffe4a2',10);}
 if(m.type==='rat'&&Date.now()<m.chargeUntil){ctx.strokeStyle='#ffe19c';ctx.lineWidth=2;ctx.strokeRect(x-24,dy-2,48,h+4);}}

function drawProjectile(p){if(p.type==='darkbolt'){ellipse(p.x,p.y,10,10,'#7a4fb2');ellipse(p.x,p.y,5,5,'#e6b9ff');ctx.strokeStyle='#c992ff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,13,0,Math.PI*2);ctx.stroke();}else{ellipse(p.x,p.y,7,7,'#ac83d8');ellipse(p.x-2,p.y-2,3,3,'#e8cffc');}}
function drawQuakes(now){
 for(const m of monsters.values())if(m.type==='baphomet'&&m.alive&&m.quakeStart){
  const age=Math.min(3000,Math.max(0,now-(m.localQuakeStart||now))),progress=age/3000;
  const x=m.quakeX,y=m.quakeY,r=360;
  ctx.save();ctx.fillStyle='rgba(180,50,39,0.16)';ctx.strokeStyle='#ff5b45';ctx.lineWidth=5;ctx.setLineDash([15,10]);ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle='#ffbb56';ctx.lineWidth=4;ctx.beginPath();ctx.arc(x,y,r*(1-progress),0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='rgba(255,60,35,0.10)';ctx.beginPath();ctx.arc(x,y,r*Math.min(1,progress*1.1),0,Math.PI*2);ctx.fill();ctx.restore();
 }
 for(let i=quakeFx.length-1;i>=0;i--){const f=quakeFx[i],age=now-f.start;if(age>700){quakeFx.splice(i,1);continue;}ctx.save();ctx.globalAlpha=1-age/700;ctx.strokeStyle='#ffe9ac';ctx.lineWidth=9*(1-age/700)+1;ctx.beginPath();ctx.arc(f.x,f.y,f.r*(.92+age/700*.12),0,Math.PI*2);ctx.stroke();ctx.restore();}
}
function drawBossCastbars(now){for(const m of monsters.values())if(m.type==='baphomet'&&m.alive&&m.quakeStart){const age=Math.max(0,Math.min(3000,now-(m.localQuakeStart||now))),ratio=age/3000;
 const x=m.x,y=m.y-165,w=128,h=12;
 ctx.save();ctx.font='bold 13px system-ui';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#301715';ctx.strokeText('EARTHQUAKE',x,y-13);ctx.fillStyle='#ffcc85';ctx.fillText('EARTHQUAKE',x,y-13);ctx.fillStyle='#251b1b';ctx.fillRect(x-w/2-2,y-2,w+4,h+4);ctx.fillStyle='#823629';ctx.fillRect(x-w/2,y,w,h);ctx.fillStyle='#ffa14c';ctx.fillRect(x-w/2,y,w*ratio,h);ctx.strokeStyle='#ffe0af';ctx.strokeRect(x-w/2,y,w,h);ctx.restore();
}}
function drawDamageFx(now){for(let i=damageFx.length-1;i>=0;i--){const f=damageFx[i],age=now-f.start;if(age>850){damageFx.splice(i,1);continue;}ctx.save();ctx.globalAlpha=1-age/850;label(f.kind==='miss'?'MISS':String(f.amount),f.x,f.y-22-age*.04,f.kind==='player'?'#ff8080':f.kind==='crit'?'#ffe16e':'#fff',f.kind==='crit'?17:14);ctx.restore();}}
function drawCracks(now){for(let i=crackFx.length-1;i>=0;i--){const fx=crackFx[i],age=now-fx.start;if(age>4400){crackFx.splice(i,1);continue;}ctx.save();ctx.translate(fx.x,fx.y);ctx.globalAlpha=age<1900?.85:.85*(1-(age-1900)/2500);ctx.strokeStyle='#362d25';ctx.lineWidth=3;for(let k=0;k<12;k++){const a=k*Math.PI/6,reach=28+(k%3)*14;ctx.beginPath();ctx.moveTo(Math.cos(a)*5,Math.sin(a)*5);ctx.lineTo(Math.cos(a)*reach*.55-Math.sin(a)*5,Math.sin(a)*reach*.55+Math.cos(a)*5);ctx.lineTo(Math.cos(a)*reach,Math.sin(a)*reach);ctx.stroke();}ctx.strokeStyle='#e4c48e';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,90,0,Math.PI*2);ctx.stroke();ctx.restore();}}
function drawParticles(dt){for(let i=particleFx.length-1;i>=0;i--){const p=particleFx[i];p.life-=dt*1000;if(p.life<=0){particleFx.splice(i,1);continue;}p.vy+=p.gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;ctx.save();ctx.globalAlpha=Math.max(0,p.life/p.maxLife);ctx.fillStyle=p.color;ctx.beginPath();ctx.ellipse(p.x,p.y,p.size,p.size*.7,0,0,Math.PI*2);ctx.fill();ctx.restore();}}
function drawMinimap(){const sx=minimap.width/WIDTH,sy=minimap.height/HEIGHT;miniCtx.clearRect(0,0,minimap.width,minimap.height);miniCtx.drawImage(miniBase,0,0);miniCtx.fillStyle='#00000033';miniCtx.fillRect(cameraX*sx,cameraY*sy,viewW*sx,viewH*sy);miniCtx.strokeStyle='#dff6cd';miniCtx.lineWidth=1;miniCtx.strokeRect(cameraX*sx+.5,cameraY*sy+.5,Math.max(8,viewW*sx)-1,Math.max(8,viewH*sy)-1);for(const m of monsters.values()){if(!m.alive)continue;miniCtx.fillStyle=m.type==='bat'?'#8a6fd1':m.type==='rat'?'#8d6c58':m.type==='baphomet'?'#ff6b6b':'#ff91c7';miniCtx.fillRect(m.x*sx-(m.type==='baphomet'?2.5:1.5),m.y*sy-(m.type==='baphomet'?2.5:1.5),m.type==='baphomet'?5:3,m.type==='baphomet'?5:3);}for(const p of players.values()){miniCtx.beginPath();miniCtx.fillStyle=p.id===myId?'#ffef92':'#fff';miniCtx.arc(p.x*sx,p.y*sy,p.id===myId?3.3:2.5,0,Math.PI*2);miniCtx.fill();}ui('minimap-status').textContent=`${players.size}p · ${[...monsters.values()].filter(m=>m.alive).length}m`;}
function frame(now){if(attackingHeld&&now-lastAttackSent>=65&&document.activeElement!==ui('name')&&document.activeElement!==ui('chat-input')){lastAttackSent=now;const me=players.get(myId);const cooldown=Math.max(135,400-(me?.stats?.AGI||0)*5);if(now-(me?.visualAttackStart||0)>cooldown-45)handleAction('slash');}const dt=Math.min((now-last)/1000,.05);last=now;sendInput(now);for(const p of [...players.values(),...monsters.values(),...projectiles.values()]){const f=1-Math.exp(-dt*55);p.x+=(p.tx-p.x)*f;p.y+=(p.ty-p.y)*f;}
const mine=players.get(myId);
const cooldownBox=ui('skill-cooldown');if(mine){const end=mine.spinCooldownUntil||0;const active=mine.visualSpinStart&&now-mine.visualSpinStart<3000;const timeLeft=Math.max(0,end-(Date.now()+serverClockOffset));cooldownBox.hidden=active||timeLeft<=0;cooldownBox.textContent=timeLeft>100?(Math.ceil(timeLeft/1000)+'s'):'';const leapBox=ui('leap-cooldown'),leapLeft=Math.max(0,(mine.leapCooldownUntil||0)-(Date.now()+serverClockOffset));leapBox.hidden=leapLeft<100;leapBox.textContent=leapLeft>=100?Math.ceil(leapLeft/1000)+'s':'';}else{cooldownBox.hidden=true;ui('leap-cooldown').hidden=true;}
if(mine){const f=1-Math.exp(-dt*24);cameraX+=(mine.x-viewW/2-cameraX)*f;cameraY+=(mine.y-viewH/2-cameraY)*f;}cameraX=viewW>=WIDTH?(WIDTH-viewW)/2:Math.max(0,Math.min(WIDTH-viewW,cameraX));cameraY=viewH>=HEIGHT?(HEIGHT-viewH)/2:Math.max(0,Math.min(HEIGHT-viewH,cameraY));ctx.clearRect(0,0,viewW,viewH);ctx.fillStyle='#162d25';ctx.fillRect(0,0,viewW,viewH);ctx.save();ctx.translate(-Math.round(cameraX),-Math.round(cameraY));const left=Math.max(0,Math.floor(cameraX/TILE)-1),right=Math.min(COLS,Math.ceil((cameraX+viewW)/TILE)+1),top=Math.max(0,Math.floor(cameraY/TILE)-1),bottom=Math.min(ROWS,Math.ceil((cameraY+viewH)/TILE)+1);drawWorldGround(now,left,right,top,bottom);drawCracks(now);drawQuakes(now);const actors=[...players.values()].map(p=>({y:p.y,draw:()=>drawPlayer(p,now)})).concat([...monsters.values()].filter(m=>m.alive).map(m=>({y:m.y,draw:()=>drawMonster(m,now)}))).concat(visibleTrees(left,right,top,bottom,mine));actors.sort((a,b)=>a.y-b.y).forEach(a=>a.draw());for(const b of projectiles.values())drawProjectile(b);drawParticles(dt);drawDamageFx(now);drawBossCastbars(now);ctx.restore();drawLightRays(now);drawMinimap();if(now-lastSaved>1000){lastSaved=now;persist();}requestAnimationFrame(frame);}
connect();requestAnimationFrame(frame);
})();
