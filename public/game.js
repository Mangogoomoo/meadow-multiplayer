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
function updateMonster(m){const old=monsters.get(m.id);if(old){const castNew=m.quakeStart&&m.quakeStart!==old.quakeStart;Object.assign(old,{...m,tx:m.x,ty:m.y,x:old.x,y:old.y});if(castNew)old.localQuakeStart=performance.now();if(!m.quakeStart)old.localQuakeStart=0;}else monsters.set(m.id,{...m,tx:m.x,ty:m.y,localQuakeStart:m.quakeStart?performance.now():0});}
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
function drawPlayer(p,now){const x=p.x,y=p.y,walking=Math.hypot(p.tx-p.x,p.ty-p.y)>.25,bob=walking?Math.sin(now/95)*1.3:0;const age=now-(p.visualJumpStart||0),jumping=!!p.visualJumpStart&&age>=0&&age<480,progress=jumping?age/480:0,height=jumping?Math.sin(progress*Math.PI)*20:0,shadowScale=1-height/33;ellipse(x,y+12,12*shadowScale,4.4*shadowScale,'#203c2a8c');ctx.save();const leapAge=now-(p.visualLeapStart||0);const leapHeight=p.visualLeapStart&&leapAge>=0&&leapAge<520?Math.sin(Math.PI*leapAge/520)*46:0;ctx.translate(0,-height-leapHeight);const spinAge=now-(p.visualSpinStart||0),spinning=!!p.visualSpinStart&&spinAge>=0&&spinAge<3000;if(spinning){ctx.translate(x,y);ctx.rotate(spinAge/105);ctx.translate(-x,-y);}if(Date.now()<p.invulnerableUntil&&Math.floor(now/85)%2===0)ctx.globalAlpha=.45;
const skin='#efc79d',hair='#9a5a28',hairHi='#cf8a3c',cape='#b13f47',trim='#f4d56b',armor=colors[p.color%colors.length]||colors[0],dark='#243447';
ctx.fillStyle=dark;ctx.fillRect(x-8,y+5+bob,6,11);ctx.fillRect(x+2,y+5-bob,6,11);ctx.fillStyle='#6e4932';ctx.fillRect(x-8,y+14+bob,6,2);ctx.fillRect(x+2,y+14-bob,6,2);
ctx.fillStyle=cape;ctx.fillRect(x-13,y-8+bob,6,20);ctx.fillRect(x+7,y-8+bob,6,20);ctx.fillStyle='#8b2834';ctx.fillRect(x-13,y+9+bob,6,3);ctx.fillRect(x+7,y+9+bob,6,3);
ctx.fillStyle=dark;ctx.fillRect(x-10,y-10+bob,20,19);ctx.fillStyle=armor;ctx.fillRect(x-8,y-8+bob,16,15);ctx.fillStyle=trim;ctx.fillRect(x-2,y-8+bob,4,15);ctx.fillRect(x-8,y-1+bob,16,2);
ctx.fillStyle=skin;ctx.fillRect(x-12,y-7+bob,4,11);ctx.fillRect(x+8,y-7+bob,4,11);
ctx.fillStyle='#3f5e9c';ctx.fillRect(x-11,y-2+bob,3,5);
ctx.fillStyle=dark;ctx.fillRect(x-8,y-23+bob,16,14);ctx.fillStyle=skin;ctx.fillRect(x-7,y-20+bob,14,11);
ctx.fillStyle=hair;ctx.fillRect(x-8,y-24+bob,16,6);ctx.fillRect(x-10,y-19+bob,4,5);ctx.fillStyle=hairHi;ctx.fillRect(x-4,y-24+bob,6,3);ctx.fillRect(x+2,y-22+bob,4,2);
ctx.fillStyle='#203039';if(p.dir==='left')ctx.fillRect(x-6,y-15+bob,2,2);else if(p.dir==='right')ctx.fillRect(x+4,y-15+bob,2,2);else if(p.dir==='down'){ctx.fillRect(x-4,y-15+bob,2,2);ctx.fillRect(x+2,y-15+bob,2,2);}ctx.fillStyle='#de8c8f';if(p.dir==='down')ctx.fillRect(x-1,y-11+bob,2,1);
const dirs={up:-Math.PI/2,down:Math.PI/2,left:Math.PI,right:0};const slashAge=now-(p.visualAttackStart||0),swing=!!p.visualAttackStart&&slashAge>=0&&slashAge<230;const facing=swing&&Number.isFinite(p.attackAngle)?p.attackAngle:(dirs[p.dir]??Math.PI/2);const bladeAngle=spinning?0:facing+(swing?(-1.2+2.4*slashAge/230):.58);
ctx.save();ctx.translate(x,y-5+bob);ctx.rotate(bladeAngle);ctx.fillStyle='#6b492d';ctx.fillRect(8,-2,12,4);ctx.fillStyle=trim;ctx.fillRect(18,-7,3,14);ctx.fillStyle='#d9e8ef';ctx.beginPath();ctx.moveTo(20,-3);ctx.lineTo(39,-2);ctx.lineTo(48,0);ctx.lineTo(39,2);ctx.lineTo(20,3);ctx.closePath();ctx.fill();ctx.strokeStyle='#ffffff';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(22,-1);ctx.lineTo(44,0);ctx.stroke();ctx.restore();
ctx.save();ctx.translate(x-13,y-5+bob);ctx.rotate(p.dir==='left'?-.3:p.dir==='right'?.3:0);ctx.fillStyle='#3e5fae';ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(8,-11);ctx.lineTo(12,-2);ctx.lineTo(8,10);ctx.lineTo(0,7);ctx.closePath();ctx.fill();ctx.strokeStyle=trim;ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
if(spinning){ctx.save();ctx.translate(x,y-4+bob);ctx.strokeStyle='#f5ecab';ctx.lineWidth=4;ctx.globalAlpha=.75;ctx.beginPath();ctx.arc(0,0,83,0,Math.PI*2);ctx.stroke();ctx.restore();}
if(swing){ctx.save();ctx.translate(x,y-4+bob);ctx.rotate(facing);ctx.strokeStyle='#fff4bd';ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.arc(0,0,60,-1.15+slashAge/230*1.45,-.7+slashAge/230*1.45);ctx.stroke();ctx.restore();}
ctx.restore();label(`${p.name}  Lv.${p.level}`,x,y-36-height-leapHeight+bob,p.id===myId?'#ffef9d':'#fff',11);ctx.fillStyle='#172b21';ctx.fillRect(x-18,y-31-height-leapHeight+bob,36,4);ctx.fillStyle='#e86c71';ctx.fillRect(x-18,y-31-height-leapHeight+bob,36*Math.max(0,p.hp/p.maxHp),4);}

function drawMonster(m,now){if(!m.alive)return;const x=m.x,y=m.y,float=(m.type==='bat'||m.type==='baphomet')?Math.sin(now/180+m.x)*4:0;ellipse(x,y+(m.type==='baphomet'?18:10),m.type==='baphomet'?22:(m.type==='baphometjr'?13:11),m.type==='baphomet'?7:4,'#203c2a8c');
if(m.type==='rat'){ctx.fillStyle='#5f5148';ctx.beginPath();ctx.ellipse(x,y+1,15,10,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#74645c';ctx.beginPath();ctx.ellipse(x+11,y-1,7,6,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d44e58';ctx.fillRect(x+11,y-2,2,2);ctx.strokeStyle='#8f7b76';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-11,y+5);ctx.quadraticCurveTo(x-25,y+13,x-28,y-2);ctx.stroke();ctx.strokeStyle='#c7c7c7';ctx.beginPath();ctx.moveTo(x+13,y+4);ctx.lineTo(x+18,y+9);ctx.moveTo(x+10,y+4);ctx.lineTo(x+15,y+10);ctx.stroke();}
else if(m.type==='bat'){ctx.fillStyle='#473b63';ctx.beginPath();ctx.moveTo(x-4,y-8+float);ctx.lineTo(x-23,y-18+float);ctx.lineTo(x-18,y+5+float);ctx.lineTo(x-3,y+2+float);ctx.moveTo(x+4,y-8+float);ctx.lineTo(x+23,y-18+float);ctx.lineTo(x+18,y+5+float);ctx.lineTo(x+3,y+2+float);ctx.fill();ellipse(x,y-5+float,10,10,'#6a5d88');ctx.fillStyle='#ef7f94';ctx.fillRect(x-7,y-7+float,3,3);ctx.fillRect(x+4,y-7+float,3,3);ctx.fillStyle='#f2cfda';ctx.fillRect(x-2,y-1+float,4,2);}
else if(m.type==='baphomet'){ctx.save();ctx.translate(x,y-4+float);ctx.fillStyle='#6e6158';ctx.beginPath();ctx.moveTo(-18,-26);ctx.lineTo(-8,-46);ctx.lineTo(-1,-34);ctx.lineTo(-13,-20);ctx.closePath();ctx.moveTo(18,-26);ctx.lineTo(8,-46);ctx.lineTo(1,-34);ctx.lineTo(13,-20);ctx.closePath();ctx.fill();ctx.fillStyle='#7d736c';ctx.beginPath();ctx.ellipse(0,-12,20,24,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#544b46';ctx.fillRect(-23,-3,46,33);ctx.fillStyle='#30253a';ctx.fillRect(-17,17,14,18);ctx.fillRect(3,17,14,18);ctx.fillStyle='#c7b48c';ctx.fillRect(-12,-2,24,15);ctx.fillStyle='#ff3f42';ctx.fillRect(-10,-12,4,4);ctx.fillRect(6,-12,4,4);ctx.fillStyle='#1e1414';ctx.fillRect(-4,-2,8,10);ctx.fillStyle='#9d2c2f';ctx.beginPath();ctx.moveTo(0,-50);ctx.lineTo(8,-33);ctx.lineTo(0,-28);ctx.lineTo(-8,-33);ctx.closePath();ctx.fill();ctx.fillStyle='#f0a53c';ctx.beginPath();ctx.arc(0,-53,8,0,Math.PI*2);ctx.fill();ctx.restore();}
else if(m.type==='baphometjr'){ctx.save();ctx.translate(x,y+float);ctx.fillStyle='#ff9cc8';ctx.beginPath();ctx.ellipse(0,0,12,14,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#c5589c';ctx.beginPath();ctx.moveTo(-7,-7);ctx.lineTo(-15,-20);ctx.lineTo(-8,-18);ctx.lineTo(-3,-9);ctx.closePath();ctx.moveTo(7,-7);ctx.lineTo(15,-20);ctx.lineTo(8,-18);ctx.lineTo(3,-9);ctx.closePath();ctx.fill();ctx.fillStyle='#ff7f9b';ctx.beginPath();ctx.arc(0,-16,7,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ff5d6f';ctx.beginPath();ctx.moveTo(0,-27);ctx.lineTo(4,-18);ctx.lineTo(0,-15);ctx.lineTo(-4,-18);ctx.closePath();ctx.fill();ctx.fillStyle='#ffd0e1';ctx.fillRect(-5,-3,3,3);ctx.fillRect(2,-3,3,3);ctx.fillStyle='#7f2b72';ctx.fillRect(-10,10,20,5);ctx.restore();}
const name=m.name||(m.type==='bat'?'Bat':m.type==='rat'?'Rat':m.type==='baphomet'?'Baphomet':'Baphomet.Jr');label(name,x,y-(m.type==='baphomet'?58:27)+float,m.type==='baphomet'?'#ffb995':'#ffddd2',m.type==='baphomet'?12:11);ctx.fillStyle='#24342a';const bw=m.type==='baphomet'?64:m.type==='baphometjr'?36:30;ctx.fillRect(x-bw/2,y-(m.type==='baphomet'?52:23)+float,bw,5);ctx.fillStyle=m.type==='baphomet'?'#b44555':m.type==='baphometjr'?'#ff85b6':'#e77a76';ctx.fillRect(x-bw/2,y-(m.type==='baphomet'?52:23)+float,bw*Math.max(0,m.hp/m.maxHp),5);if(Date.now()<m.stunnedUntil){for(let i=0;i<3;i++){const a=now/180+i*Math.PI*2/3;ctx.fillStyle='#ffe299';ctx.beginPath();ctx.moveTo(x+Math.cos(a)*13,y-(m.type==='baphomet'?67:36)+float+Math.sin(a)*4);for(let k=1;k<5;k++){const aa=a+k*Math.PI*2/5,r=k%2?4.8:2.2;ctx.lineTo(x+Math.cos(aa)*13+Math.cos(aa)*r,y-(m.type==='baphomet'?67:36)+float+Math.sin(a)*4+Math.sin(aa)*r);}ctx.closePath();ctx.fill();}label('STUN',x,y-(m.type==='baphomet'?76:46)+float,'#ffe4a2',10);}if(m.type==='rat'&&Date.now()<m.chargeUntil){ctx.strokeStyle='#ffe19c';ctx.lineWidth=2;ctx.strokeRect(x-16,y-13,32,25);}}

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
 const x=m.x,y=m.y-103,w=128,h=12;
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
