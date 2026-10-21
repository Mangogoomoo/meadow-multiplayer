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
// ======================= PIXEL ART ENGINE =======================
function createArt(D){
const {TILE,COLS,ROWS,tileAt}=D;
const mkCanvas=()=>document.createElement('canvas');
const hx=c=>[parseInt(c.slice(1,3),16),parseInt(c.slice(3,5),16),parseInt(c.slice(5,7),16)];
const mix=(a,b,t)=>{const A=hx(a),B=hx(b);return '#'+A.map((v,i)=>Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0')).join('');};
const nz=(a,b,s=0)=>{let n=(Math.imul(a|0,374761393)+Math.imul(b|0,668265263)+Math.imul(s|0,1442695041))|0;n=Math.imul(n^(n>>>13),1274126177);n^=n>>>16;return(n>>>0)/4294967296;};
class Pix{
  constructor(w,h){this.w=w;this.h=h;this.d=new Array(w*h).fill(null);this.ox=0;this.oy=0;}
  set(x,y,c){x=Math.floor(x)+this.ox;y=Math.floor(y)+this.oy;if(x>=0&&y>=0&&x<this.w&&y<this.h)this.d[y*this.w+x]=c;}
  get(x,y){return(x<0||y<0||x>=this.w||y>=this.h)?null:this.d[y*this.w+x];}
  rect(x,y,w,h,c){for(let j=0;j<h;j++)for(let i=0;i<w;i++)this.set(x+i,y+j,c);}
  ell(cx,cy,rx,ry,c){for(let y=Math.floor(cy-ry);y<=Math.ceil(cy+ry);y++)for(let x=Math.floor(cx-rx);x<=Math.ceil(cx+rx);x++){const dx=(x+.5-cx)/rx,dy=(y+.5-cy)/ry;if(dx*dx+dy*dy<=1)this.set(x,y,c);}}
  poly(pts,c){let mn=1e9,mx=-1e9;for(const p of pts){mn=Math.min(mn,p[1]);mx=Math.max(mx,p[1]);}
    for(let y=Math.floor(mn);y<=Math.ceil(mx);y++){const yy=y+.5,xs=[];for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length];if((a[1]<=yy&&b[1]>yy)||(b[1]<=yy&&a[1]>yy))xs.push(a[0]+(yy-a[1])/(b[1]-a[1])*(b[0]-a[0]));}
      xs.sort((p,q)=>p-q);for(let i=0;i+1<xs.length;i+=2)for(let x=Math.round(xs[i]);x<Math.round(xs[i+1]);x++)this.set(x,y,c);}}
  line(x0,y0,x1,y1,c,t=1,t1=t){const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)*2));for(let i=0;i<=n;i++){const u=i/n;this.ell(x0+(x1-x0)*u,y0+(y1-y0)*u,(t+(t1-t)*u)/2,(t+(t1-t)*u)/2,c);}}
  path(pts,c,t0,t1){const segs=pts.length-1;for(let i=0;i<segs;i++){const a=t0+(t1-t0)*i/segs,b=t0+(t1-t0)*(i+1)/segs;this.line(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1],typeof c==='function'?c(i):c,a,b);}}
  outline(c){const o=this.d.slice(),w=this.w,h=this.h;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(this.d[i]!==null)continue;if((x>0&&this.d[i-1])||(x<w-1&&this.d[i+1])||(y>0&&this.d[i-w])||(y<h-1&&this.d[i+w]))o[i]=c;}this.d=o;return this;}
  dilate(c,n){let src=this.d.slice();const w=this.w,h=this.h;for(let k=0;k<n;k++){const o=src.slice();for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(src[i])continue;if((x>0&&src[i-1])||(x<w-1&&src[i+1])||(y>0&&src[i-w])||(y<h-1&&src[i+w])||(x>0&&y>0&&src[i-w-1])||(x<w-1&&y>0&&src[i-w+1])||(x>0&&y<h-1&&src[i+w-1])||(x<w-1&&y<h-1&&src[i+w+1]))o[i]=c;}src=o;}const r=new Pix(w,h);r.d=src.map((v,i)=>this.d[i]?null:v);return r;}
  flip(){const r=new Pix(this.w,this.h);for(let y=0;y<this.h;y++)for(let x=0;x<this.w;x++)r.d[y*this.w+x]=this.d[y*this.w+(this.w-1-x)];return r;}
  canvas(s=2){const c=mkCanvas();c.width=this.w*s;c.height=this.h*s;const g=c.getContext('2d');for(let y=0;y<this.h;y++)for(let x=0;x<this.w;x++){const v=this.d[y*this.w+x];if(v){g.fillStyle=v;g.fillRect(x*s,y*s,s,s);}}return c;}
}
const OL='#241830';
// ---------- Hero (chibi knight, after reference 2) ----------
const HERO={hair:'#c85a2a',hairHi:'#ee8f40',hairDk:'#8e3a20',gold:'#f6d153',goldDk:'#c8942a',skin:'#f9d3ab',skinDk:'#e2a77f',eye:'#1c2b78',cape:'#c7333d',capeHi:'#e65a5a',capeDk:'#8a1f2e',boot:'#7a4528',bootDk:'#4a2818',pant:'#5a3b2e',belt:'#7a4a2a',shield:'#3f70d6',gem:'#86e4ff'};
function heroSprite(dir,frame,armor){
  const H=HERO,A=armor,AD=mix(A,'#0b1030',.42),AH=mix(A,'#ffffff',.32);
  const P=new Pix(18,22);P.ox=1;P.oy=1;
  const lL=frame===1?-1:0,lR=frame===2?-1:0;
  if(dir==='down'){
    P.rect(2,10,12,8,H.cape);P.rect(1,14,14,4,H.cape);P.rect(1,17,14,1,H.capeDk);P.rect(2,11,1,5,H.capeHi);P.rect(13,11,1,5,H.capeDk);
    P.rect(5,15+lL,2,3,H.pant);P.rect(9,15+lR,2,3,H.pant);P.rect(4,17+lL,3,2,H.boot);P.rect(9,17+lR,3,2,H.boot);P.rect(4,18+lL,3,1,H.bootDk);P.rect(9,18+lR,3,1,H.bootDk);
    P.rect(4,10,8,6,A);P.rect(4,15,8,1,AD);P.rect(11,11,1,4,AD);P.rect(5,11,2,1,AH);P.rect(7,10,2,1,H.gold);P.rect(4,13,8,1,H.belt);P.rect(7,13,2,1,H.gold);
    P.rect(3,10,2,2,H.gold);P.rect(11,10,2,2,H.gold);
    P.rect(12,11,2,3,A);P.rect(12,14,2,2,H.skin);
    P.rect(3,11,2,3,A);P.ell(3,13.5,2.7,3.7,H.goldDk);P.ell(3,13.5,2.2,3.2,H.gold);P.ell(3,13.5,1.5,2.5,H.shield);P.set(2,12,'#9cc0ff');P.set(3,13,H.gold);
    // head
    P.ell(8,6.6,5.6,4.3,H.skin);P.rect(3,9,10,2,H.skin);P.rect(4,10,8,1,H.skinDk);
    P.rect(1,3,2,6,H.hair);P.rect(13,3,2,6,H.hair);P.rect(1,7,2,2,H.hairDk);P.rect(13,7,2,2,H.hairDk);
    P.ell(8,3.4,6.6,3.6,H.hair);
    P.poly([[2,3],[3.5,0],[6,2]],H.hair);P.poly([[5,2],[8,-0.5],[11,2]],H.hairHi);P.poly([[10,2],[12.5,0],[14,3]],H.hair);
    P.rect(3,4,10,1,H.gold);P.rect(7,3,2,2,H.gold);P.set(8,4,H.gem);P.set(2,4,H.goldDk);P.set(13,4,H.goldDk);
    P.poly([[3,5],[7,5],[4.5,8]],H.hair);P.poly([[6,5],[10,5],[8,7.5]],H.hairHi);P.poly([[9,5],[13,5],[11.5,8]],H.hair);
    P.rect(5,2,2,1,H.hairHi);P.rect(10,2,2,1,H.hairHi);
    P.rect(4,8,2,2,H.eye);P.rect(10,8,2,2,H.eye);P.set(4,8,'#ffffff');P.set(10,8,'#ffffff');P.set(5,9,'#4d7be0');P.set(11,9,'#4d7be0');
    P.rect(3,10,2,1,'#f0948c');P.rect(11,10,2,1,'#f0948c');
  } else if(dir==='up'){
    P.rect(2,9,12,9,H.cape);P.rect(1,14,14,4,H.cape);P.rect(1,17,14,1,H.capeDk);P.rect(5,10,1,7,H.capeHi);P.rect(10,10,1,7,H.capeDk);P.rect(7,12,2,5,H.capeDk);
    P.rect(5,15+lL,2,3,H.pant);P.rect(9,15+lR,2,3,H.pant);P.rect(4,17+lL,3,2,H.boot);P.rect(9,17+lR,3,2,H.boot);P.rect(4,18+lL,3,1,H.bootDk);P.rect(9,18+lR,3,1,H.bootDk);
    P.rect(1,10,2,2,H.gold);P.rect(13,10,2,2,H.gold);P.rect(6,9,4,1,H.gold);
    P.ell(2.5,13.5,2.3,3.5,H.goldDk);P.ell(2.5,13.5,1.8,3,H.shield);
    P.ell(8,5.4,6.6,5.2,H.hair);P.rect(1,5,14,5,H.hair);
    P.poly([[2,3],[3.5,0],[6,2]],H.hair);P.poly([[5,2],[8,-0.5],[11,2]],H.hairHi);P.poly([[10,2],[12.5,0],[14,3]],H.hair);
    P.rect(3,2,3,1,H.hairHi);P.rect(9,3,3,1,H.hairHi);P.rect(7,6,2,3,H.hairDk);P.rect(3,8,3,2,H.hairDk);P.rect(10,8,3,2,H.hairDk);
    P.poly([[2,9],[5,9],[3,11.5]],H.hairDk);P.poly([[11,9],[14,9],[13,11.5]],H.hairDk);P.poly([[6,9],[10,9],[8,11.5]],H.hair);
    P.rect(3,5,10,1,H.gold);
  } else { // side (faces right)
    P.ell(3.6,13,2,3.6,H.goldDk);P.ell(3.8,13,1.5,3,H.shield);
    P.poly([[2,10],[9,10],[8,18],[0,18]],H.cape);P.poly([[2,10],[5,10],[2,18],[0,18]],H.capeDk);P.rect(1,17,8,1,H.capeDk);
    const bx=lL?0:0;
    P.rect(5,15+lL,2,3,H.pant);P.rect(8,15+lR,2,3,H.pant);P.rect(4,17+lL,4,2,H.boot);P.rect(8,17+lR,4,2,H.boot);P.rect(4,18+lL,4,1,H.bootDk);P.rect(8,18+lR,4,1,H.bootDk);
    P.rect(5,10,6,6,A);P.rect(5,15,6,1,AD);P.rect(5,13,6,1,H.belt);P.rect(8,13,2,1,H.gold);P.rect(5,11,2,1,AH);P.rect(5,10,3,2,H.gold);
    P.rect(8,11,3,3,A);P.rect(10,13,2,2,H.skin);
    P.ell(8.5,6.6,5,4.2,H.skin);P.rect(10,9,3,1,H.skin);P.set(14,8,H.skin);P.set(14,9,H.skinDk);P.rect(7,10,5,1,H.skinDk);
    P.ell(7,4.3,6.3,4.3,H.hair);P.rect(2,4,5,5,H.hair);P.rect(2,8,4,2,H.hairDk);
    P.poly([[2,4],[0,7],[3,8]],H.hairDk);P.poly([[3,2],[3,0],[7,1.5]],H.hair);P.poly([[6,2],[10,-0.5],[11,2]],H.hairHi);P.poly([[10,2],[13,1],[13,4]],H.hair);
    P.rect(6,4,8,1,H.gold);P.set(13,4,H.gem);
    P.poly([[9,5],[13,5],[12,7.5]],H.hairHi);P.poly([[7,5],[10,5],[8.5,7]],H.hair);
    P.rect(11,8,2,2,H.eye);P.set(11,8,'#ffffff');P.set(12,9,'#4d7be0');P.rect(10,10,2,1,'#f0948c');
  }
  P.outline(OL);return P;
}
const heroCache={};
function getHero(dir,frame,armor){
  const key=dir+frame+armor;let e=heroCache[key];if(e)return e;
  const isLeft=dir==='left',d=isLeft?'side':dir==='right'?'side':dir;let P=heroSprite(d,frame,armor);if(isLeft)P=P.flip();
  return heroCache[key]=P.canvas(2);
}
// ---------- Baphomet (after references 3 & 4) ----------
const BP={skin:'#7d7088',skinMid:'#665a72',skinDk:'#463d52',skinHi:'#a89db8',head:'#85656c',headDk:'#5c444c',headHi:'#b08e94',horn:'#74606a',hornHi:'#a58f9a',silver:'#c3cde0',silverHi:'#eef3ff',silverDk:'#7c879e',robe:'#2b3688',robeDk:'#171d5a',robeHi:'#4658bd',red:'#ff2e2e',redHi:'#ffb0a0',steel:'#2a2633',blood:'#d83a3a'};
function baphometSprite(){
  const P=new Pix(44,60);P.ox=2;P.oy=2;const B=BP;
  // robe (floating, tapering, ragged)
  P.poly([[7,38],[33,38],[30,46],[25,53],[20,57],[15,53],[10,46]],B.robe);
  P.poly([[20,40],[33,38],[30,46],[25,53],[20,57]],B.robeDk);
  P.poly([[8,38],[14,38],[12,46],[10,46]],B.robeHi);
  P.poly([[13,50],[11,54],[15,53]],B.robeDk);P.poly([[27,50],[30,54],[25,53]],B.robe);
  P.rect(8,38,24,2,B.robeHi);P.set(16,44,B.robeHi);P.set(22,47,B.robeHi);
  // spear (behind right arm)
  P.line(35,12,32,56,B.steel,2);P.line(35,12,34,30,'#4a4458',1);
  P.poly([[35,3],[32,9],[35,11],[38,8],[37,5]],B.silver);P.poly([[35,3],[36,9],[35,11]],B.silverDk);P.set(35,5,B.silverHi);
  P.poly([[38,7],[41,5],[40,9]],B.silver);
  // torso
  P.ell(20,32,10,8.5,B.skin);P.ell(11,28,4.5,4,B.skin);P.ell(29,28,4.5,4,B.skin);
  P.ell(15,31,4.2,3.5,B.skinHi);P.ell(25,31,4.2,3.5,B.skinMid);
  P.rect(13,34,14,1,B.skinDk);P.rect(14,36,12,1,B.skinDk);P.rect(19,32,2,7,B.skinDk);P.rect(13,38,14,2,B.skinMid);
  P.ell(20,38,8,2.5,B.skinMid);
  P.rect(8,26,3,1,B.skinHi);P.rect(10,25,4,1,B.skinHi);P.rect(27,25,4,1,B.skinMid);
  // glowing cracks
  [[14,29,16,32],[16,32,15,35],[26,30,24,33],[24,33,26,36],[12,37,14,39]].forEach(s=>P.line(s[0],s[1],s[2],s[3],B.blood,1));
  P.set(16,32,'#ff9a8a');P.set(24,33,'#ff9a8a');
  // left arm raised (viewer left), hand giving the sign
  P.path([[10,28],[5,32],[4,26],[5,21]],B.skin,5,3.6);P.path([[9,27],[5,31],[4,26]],B.skinHi,1.6,1.4);
  P.ell(5,19,2.8,3.2,B.skin);P.rect(3,13,1,5,B.skin);P.rect(5,12,1,6,B.skin);P.rect(7,15,1,3,B.skin);P.set(3,13,B.skinHi);P.set(5,12,B.skinHi);
  P.rect(1,25,8,1,B.silverDk);P.rect(1,26,8,1,B.silver);
  // right arm holding spear
  P.path([[30,28],[35,32],[34,38]],B.skin,5,4);P.path([[31,28],[34,31]],B.skinHi,1.6,1.4);P.ell(33.5,39,2.6,2.6,B.skinMid);
  P.rect(31,31,6,1,B.silverDk);P.rect(31,32,6,1,B.silver);
  // neck / head
  P.ell(20,25,5,3,B.skinMid);
  P.ell(20,17,7,6.6,B.head);P.ell(18,15,3,3,B.headHi);P.ell(20,24,3.6,5,B.head);P.ell(20,27,2.6,4,B.headDk);
  P.rect(18,25,1,4,'#2a1a22');P.rect(22,25,1,4,'#2a1a22');P.rect(19,29,3,1,'#5a2a30');
  P.poly([[19,30],[22,30],[20.5,36]],B.headDk);P.poly([[18,30],[20,30],[19,34]],B.skinMid);
  P.poly([[14,16],[8,14],[13,21]],B.head);P.poly([[26,16],[32,14],[27,21]],B.head);P.poly([[13,17],[10,15.5],[13,19.5]],'#b17a82');P.poly([[27,17],[30,15.5],[27,19.5]],'#b17a82');
  // horns with silver bands
  P.path([[15,13],[10,10],[5,9],[2,5],[2,1]],B.horn,5,1.2);P.path([[15,12],[10,9],[6,8]],B.hornHi,1.2,1);
  P.path([[25,13],[30,10],[35,9],[38,5],[38,1]],B.horn,5,1.2);
  [[12,11,2,5],[8,9.5,2,4.5],[4,7,2,3.5]].forEach(b=>{P.rect(b[0],b[1],b[2],b[3],B.silver);P.rect(b[0],b[1],1,b[3],B.silverHi);});
  [[28,11,2,5],[32,9.5,2,4.5],[36,7,2,3.5]].forEach(b=>{P.rect(b[0],b[1],b[2],b[3],B.silver);P.rect(b[0]+1,b[1],1,b[3],B.silverDk);});
  // crown stub for flame
  P.rect(18,8,5,3,'#1c1522');P.rect(19,7,3,1,'#1c1522');
  // pentagram
  [[20,12],[19,13],[20,13],[21,13],[18,14],[19,14],[20,14],[21,14],[22,14],[19,15],[21,15],[18,16],[22,16]].forEach(p=>P.set(p[0],p[1],'#f4eaff'));
  // eyes
  P.rect(16,18,3,2,B.red);P.rect(22,18,3,2,B.red);P.set(16,18,B.redHi);P.set(22,18,B.redHi);P.rect(15,17,4,1,B.headDk);P.rect(22,17,4,1,B.headDk);
  const body=P.d.slice();
  P.outline(OL);
  return P;
}
let _boss=null;
function getBoss(){
  if(_boss)return _boss;
  const P=baphometSprite();
  const aura=P.dilate('#9a5ee8',2);
  return _boss={body:P.canvas(2),aura:aura.canvas(2),auraRed:(()=>{const a=P.dilate('#ff4a2a',2);return a.canvas(2);})(),w:P.w*2,h:P.h*2};
}
// ---------- Baphomet.Jr (after references 5 & 6) ----------
function jrSprite(wing){
  const P=new Pix(26,28);P.ox=2;P.oy=2;
  const pk='#ff9cc8',pkHi='#ffc8e0',pkDk='#e9709f',pkDk2='#c9508a',wg='#8d52c8',wgDk='#5a2f93',wgHi='#b982ee',pant='#7b3fa8',pantDk='#4f2478';
  // wings
  const up=wing?0:4;
  P.poly([[7,16],[1,11+up],[0,16+up],[3,17+up],[2,20+up],[7,20]],wg);P.poly([[4,18+up],[2,20+up],[7,20]],wgDk);P.set(2,13+up,wgHi);P.set(3,12+up,wgHi);
  P.poly([[17,16],[23,11+up],[24,16+up],[21,17+up],[22,20+up],[17,20]],wg);P.poly([[20,18+up],[22,20+up],[17,20]],wgDk);P.set(22,13+up,wgHi);P.set(21,12+up,wgHi);
  // body + crossed legs
  P.ell(12,19,4.6,4.2,pk);P.ell(12,20,3,2.5,pkHi);
  P.ell(12,23,7,3,pant);P.ell(12,24,6,1.6,pantDk);P.rect(6,22,12,1,pant);
  P.ell(7,24,2.4,1.8,pkDk);P.ell(17,24,2.4,1.8,pkDk);
  // arms (right one waves the peace sign)
  P.ell(7.5,19,1.8,2.4,pkDk);P.ell(17,17,1.8,2.6,pk);P.rect(17,12,1,4,pk);P.rect(19,12,1,4,pk);P.rect(17,15,3,2,pk);P.set(17,12,pkHi);
  // ears
  P.poly([[5,10],[0,8],[1,13],[5,13]],pk);P.poly([[19,10],[24,8],[23,13],[19,13]],pk);P.poly([[4,11],[2,10],[2.5,12.5]],pkDk2);P.poly([[20,11],[22,10],[21.5,12.5]],pkDk2);
  // head
  P.ell(12,11,8,6.4,pk);P.ell(10,8,4.4,2.4,pkHi);P.rect(7,15,10,1,pkDk);P.ell(12,15,5,1.2,pkDk);
  // horns (striped, curling)
  const hs=i=>i%2?'#3a3a9c':'#ff4d97';
  P.path([[8,7],[6,3],[3,1.5],[1.5,4.5]],hs,4,1.4);
  P.path([[16,7],[18,3],[21,1.5],[22.5,4.5]],i=>i%2?'#3a3a9c':'#ff4d97',4,1.4);
  P.set(6,3,'#ffb0d0');P.set(18,3,'#ffb0d0');
  // flame stub
  P.rect(11,3,3,2,'#1d1630');P.rect(10,5,5,1,'#1d1630');
  // pentagram
  [[12,6],[11,7],[12,7],[13,7],[10,8],[12,8],[14,8]].forEach(p=>P.set(p[0],p[1],'#5a1f78'));P.set(11,8,'#5a1f78');P.set(13,8,'#5a1f78');
  // big eyes
  P.rect(6,10,4,4,'#1fc0d4');P.rect(14,10,4,4,'#1fc0d4');P.rect(7,11,2,3,'#12304a');P.rect(15,11,2,3,'#12304a');P.set(6,10,'#ffffff');P.set(7,10,'#ffffff');P.set(14,10,'#ffffff');P.set(15,10,'#ffffff');P.set(8,13,'#8af0f8');P.set(16,13,'#8af0f8');
  P.rect(5,9,5,1,'#3a1f5a');P.rect(14,9,5,1,'#3a1f5a');
  // blush, nose, mouth
  P.rect(4,13,2,1,'#ff5f8f');P.rect(18,13,2,1,'#ff5f8f');P.rect(11,13,2,1,pkDk2);P.rect(11,15,2,1,'#8a2a5c');
  P.outline(OL);return P;
}
let _jr=null;
function getJr(){
  if(_jr)return _jr;
  const f=[jrSprite(true),jrSprite(false)];
  return _jr={frames:f.map(p=>p.canvas(2)),aura:f[0].dilate('#ffb3dd',1).canvas(2),w:52,h:56};
}
// ---------- World: ground bake, trees, decor ----------
const c32=h=>{const [r,g,b]=hx(h);return((255<<24)|(b<<16)|(g<<8)|r)>>>0;};
const GC={g0:c32('#58b240'),g1:c32('#4aa339'),g2:c32('#69c34c'),g3:c32('#3f9433'),g4:c32('#8fcf4f'),gEdge:c32('#2f7f2e'),
 p0:c32('#dbac6a'),p1:c32('#c89556'),p2:c32('#eac37f'),p3:c32('#a97a47'),pEdge:c32('#b88850'),
 w0:c32('#3aa2f0'),w1:c32('#7fd0ff'),w2:c32('#2a86d6'),foam:c32('#f4fcff'),foam2:c32('#a8e4ff'),
 c0:c32('#7e4e2d'),c1:c32('#5a3520'),c2:c32('#9c6b40'),c3:c32('#3a2216'),c4:c32('#b07a4a'),
 bank:c32('#8a5a36'),bankDk:c32('#5a3520')};
const kindOf=(x,y)=>(x<0||y<0||x>=COLS||y>=ROWS)?'wall':tileAt(x,y);
let ground=null;
const trees=[];
const waterTiles=[];
function bakeGround(){
  const LW=COLS*16,LH=ROWS*16,W=LW*2,H=LH*2;
  const L=new Uint32Array(LW*LH);
  const kinds=new Array(COLS*ROWS);for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)kinds[y*COLS+x]=tileAt(x,y);
  const K=(x,y)=>(x<0||y<0||x>=COLS||y>=ROWS)?'wall':kinds[y*COLS+x];
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)if(kinds[y*COLS+x]==='water')waterTiles.push({x:x*TILE,y:y*TILE,a:nz(x,y,61),b:nz(x,y,62),c:nz(x,y,63)});
  for(let ty=0;ty<ROWS;ty++)for(let tx=0;tx<COLS;tx++){
    const kind=K(tx,ty),gx0=tx*16,gy0=ty*16;
    for(let ly=0;ly<16;ly++)for(let lx=0;lx<16;lx++){
      const gx=gx0+lx,gy=gy0+ly,r=nz(gx,gy,1),coarse=nz(gx>>2,gy>>2,2),big=nz(gx>>3,gy>>3,3);let c;
      if(kind==='water'){
        const w=(gx+gy*2)%12;c=GC.w0;if(w<2)c=GC.w1;else if((gx*2-gy+400)%14===0||(gx*2-gy+400)%14===1&&r>.5)c=GC.w2;if(r<.03)c=GC.w2;
      }else if(kind==='cliff'){
        const col=nz(gx,0,9),seg=nz(gx,gy>>2,11);c=GC.c0;
        if(col<.4&&seg>.25)c=GC.c1;else if(col>.78&&seg>.3)c=GC.c2;else if(r<.07)c=GC.c1;else if(r>.93)c=GC.c2;
        if(nz(gx>>1,gy>>1,13)>.94)c=GC.c4;
        const band=gy%28;
        if(band===0&&nz(gx>>2,gy/28|0,14)>.3)c=GC.c3;else if(band===1&&nz(gx>>2,gy/28|0,14)>.3)c=GC.c1;else if(band===2&&nz(gx>>1,gy/28|0,15)>.5)c=GC.c2;
        if(band>=24&&band<=26&&col<.5)c=GC.c1;
      }else if(kind==='path'){
        c=coarse>.82?GC.p1:GC.p0;if(r<.12)c=GC.p1;else if(r>.91)c=GC.p2;else if(r>.5&&r<.505)c=GC.p3;
      }else{
        c=coarse>.8?GC.g2:GC.g0;if(r<.12)c=GC.g1;else if(r>.93)c=GC.g2;else if(r>.5&&r<.515)c=GC.g3;if(big>.93&&r>.4)c=GC.g4;
      }
      L[gy*LW+gx]=c;
    }
    const put=(lx,ly,c)=>{L[(gy0+ly)*LW+gx0+lx]=c;};
    const sideXY=(s,i,d)=>s===0?[i,d]:s===1?[15-d,i]:s===2?[i,15-d]:[d,i];
    const nb=[K(tx,ty-1),K(tx+1,ty),K(tx,ty+1),K(tx-1,ty)];
    if(kind==='path'){
      for(let s=0;s<4;s++){const k=nb[s];if(k==='path'||k==='cliff'||k==='wall'||k==='water')continue;
        for(let i=0;i<16;i++){const depth=1+(nz(gx0+i*(s%2?0:1)+s*31,gy0+i*(s%2?1:0)+s*17,5)*3|0);
          for(let d=0;d<depth;d++){const [lx,ly]=sideXY(s,i,d);put(lx,ly,d===depth-1?GC.gEdge:GC.g0);}
          const [lx,ly]=sideXY(s,i,depth);put(lx,ly,GC.pEdge);}}
    }
    if(kind==='grass'||kind==='tree'||kind==='path'){
      for(let s=0;s<4;s++)if(nb[s]==='water'){
        for(let i=0;i<16;i++){const depth=2+(nz(gx0+i+s*7,gy0+i+s*13,6)*2|0);
          for(let d=0;d<depth;d++){const [lx,ly]=sideXY(s,i,d);put(lx,ly,d===0?GC.bank:GC.bank);}
          {const [lx,ly]=sideXY(s,i,depth);put(lx,ly,GC.bankDk);}}}
      if(nb[0]==='cliff'){for(let i=0;i<16;i++){put(i,0,GC.g3);put(i,1,GC.g1);if(nz(gx0+i,gy0,8)>.5)put(i,2,GC.g1);}}
    }
    if(kind==='water'){
      for(let s=0;s<4;s++)if(nb[s]!=='water'){for(let i=0;i<16;i++){const [a,b]=sideXY(s,i,0),[c,d]=sideXY(s,i,1);put(a,b,GC.foam);put(c,d,GC.foam2);}}
    }
    if(kind==='cliff'){
      if(nb[0]!=='cliff'&&nb[0]!=='wall'){for(let i=0;i<16;i++){const depth=2+(nz(gx0+i,gy0,21)*3|0);for(let d=0;d<depth;d++)put(i,d,d===depth-1?GC.gEdge:GC.g0);put(i,depth,GC.c3);put(i,depth+1,GC.c1);if(nz(gx0+i,gy0,22)>.7)put(i,0,GC.g2);}}
      if(nb[2]!=='cliff'){for(let i=0;i<16;i++){const depth=3+(nz(gx0+i,gy0,23)*3|0);for(let d=0;d<depth;d++)put(i,15-d,GC.c3);put(i,15-depth,GC.c1);put(i,14-depth,GC.c1);}}
      if(nb[3]!=='cliff'&&nb[3]!=='wall'){for(let i=0;i<16;i++){put(0,i,GC.c3);if(nz(gx0,gy0+i,24)>.5)put(1,i,GC.c1);}}
      if(nb[1]!=='cliff'&&nb[1]!=='wall'){for(let i=0;i<16;i++){put(15,i,GC.c3);if(nz(gx0,gy0+i,25)>.5)put(14,i,GC.c1);}}
    }
  }
  // upscale x2 into ImageData
  const gc=mkCanvas();gc.width=W;gc.height=H;const g=gc.getContext('2d');
  const id=g.createImageData(W,H),u=new Uint32Array(id.data.buffer);
  for(let y=0;y<LH;y++){const row=y*LW;for(let x=0;x<LW;x++){const c=L[row+x];const o=(y*2)*W+x*2;u[o]=c;u[o+1]=c;u[o+W]=c;u[o+W+1]=c;}}
  g.putImageData(id,0,0);
  // decor sprites
  const decor=makeDecor();
  for(let ty=0;ty<ROWS;ty++)for(let tx=0;tx<COLS;tx++){
    const kind=K(tx,ty);const px=tx*TILE,py=ty*TILE;
    if(kind==='tree'){const v=nz(tx,ty,31);trees.push({x:px+16,y:py+TILE,v:v<.035?2:v<.55?0:1,i:(nz(tx,ty,32)*2|0)});continue;}
    if(kind!=='grass')continue;
    const r=nz(tx,ty,41),r2=nz(tx,ty,42),ox=(nz(tx,ty,43)*14|0),oy=(nz(tx,ty,44)*12|0);
    if(K(tx,ty-1)==='cliff'||K(tx-1,ty)==='water'||K(tx+1,ty)==='water'||K(tx,ty-1)==='water'||K(tx,ty+1)==='water')continue;
    let s=null;
    if(r<.10)s=decor.flowers[(r2*decor.flowers.length)|0];
    else if(r<.145)s=decor.tuft[(r2*decor.tuft.length)|0];
    else if(r<.165)s=decor.rock[(r2*decor.rock.length)|0];
    else if(r<.18)s=decor.mush[(r2*decor.mush.length)|0];
    else if(r<.19)s=decor.stump;
    else if(r<.21)s=decor.bush;
    else if(r<.215)s=decor.log;
    if(s)g.drawImage(s,px+ox,py+oy-(s.height-14>0?0:0));
  }
  ground=gc;
}
function makeDecor(){
  const out={flowers:[],tuft:[],rock:[],mush:[]};
  const mk=(w,h,fn)=>{const P=new Pix(w,h);P.ox=1;P.oy=1;fn(P);P.outline('#1f3d28');return P.canvas(2);};
  const mkNo=(w,h,fn)=>{const P=new Pix(w,h);fn(P);return P.canvas(2);};
  [['#5aa8ff','#cfe6ff'],['#f9a3d3','#fff0f8'],['#ffe066','#fff6c0'],['#ffffff','#ffe066']].forEach(([a,b])=>{
    out.flowers.push(mkNo(11,8,P=>{[[1,2],[6,0],[8,5]].forEach(([x,y])=>{P.set(x+1,y,a);P.set(x,y+1,a);P.set(x+2,y+1,a);P.set(x+1,y+2,a);P.set(x+1,y+1,b);});P.set(2,4,'#2f7f2e');P.set(7,2,'#2f7f2e');P.set(9,7,'#2f7f2e');}));
  });
  for(let i=0;i<3;i++)out.tuft.push(mkNo(9,7,P=>{const d='#2f7f2e',m='#3f9a35',l='#7fd157';P.line(2,6,1,1+i,d,1);P.line(4,6,4,0,m,1);P.line(6,6,7,1+(i+1)%3,d,1);P.set(4,1,l);P.set(1+(i%2),2,l);}));
  for(let i=0;i<2;i++)out.rock.push(mk(10+i*2,7,P=>{P.ell(5+i,4,4.5+i,2.8,'#8d93a0');P.ell(4+i,3,2.5,1.4,'#b6bcc8');P.rect(5+i,5,4,1,'#656b78');}));
  for(let i=0;i<2;i++)out.mush.push(mk(8,8,P=>{P.rect(3,4,2,3,'#f2e6d0');P.ell(4,3,3.2,2.2,i?'#8a5ad8':'#e03a3a');P.set(3,2,'#ffffff');P.set(5,3,'#ffffff');}));
  out.stump=mk(11,9,P=>{P.rect(1,3,8,5,'#7a4a2a');P.rect(2,7,6,1,'#523018');P.ell(5,3,4,2,'#c99a62');P.ell(5,3,2.2,1.1,'#a97a47');});
  out.bush=mk(14,10,P=>{P.ell(7,5,6,4,'#2f8a3a');P.ell(5,4,3,2.4,'#4ab04a');P.ell(10,5,3,2.6,'#3a9d3f');P.set(4,3,'#8ddc5a');P.set(5,3,'#8ddc5a');P.rect(2,8,10,1,'#1f6a2c');});
  out.log=mk(14,7,P=>{P.rect(1,1,11,5,'#8a5a36');P.rect(1,5,11,1,'#5a3520');P.ell(12,3.5,1.6,2.4,'#d9ae74');P.rect(3,2,6,1,'#a9774a');});
  return out;
}
// trees
const treeCache={};
function treeSprite(kind){
  if(treeCache[kind])return treeCache[kind];
  const P=new Pix(28,38);P.ox=1;P.oy=1;
  if(kind===1){ // pine
    const d='#1d6234',m='#2d8c44',l='#58bb5a',tr='#6e4429';
    P.rect(11,29,4,6,tr);P.rect(11,29,1,6,'#8a5a36');P.rect(14,32,2,3,'#4a2a18');P.rect(9,34,3,1,tr);P.rect(15,34,3,1,tr);
    [[13,0,5,12],[13,7,8,12],[13,15,11,13]].forEach(([cx,top,hw,h],i)=>{const y0=top;
      P.poly([[cx,y0],[cx-hw,y0+h],[cx+hw,y0+h]],m);P.poly([[cx,y0],[cx+hw,y0+h],[cx+1,y0+h]],d);P.poly([[cx,y0],[cx-hw*0.7,y0+h*0.65],[cx-hw*0.2,y0+h*0.5]],l);
      for(let k=0;k<3;k++){P.set(cx-hw+1+k*2+(i%2),y0+h-1,m);}
    });
    P.rect(7,26,13,1,d);
  }else{
    const pink=kind===2,d=pink?'#c96a92':'#235f2c',m=pink?'#ee98b8':'#379a3c',l=pink?'#ffd0e2':'#6fcc4e',hl=pink?'#fff0f6':'#a6e86a',tr='#6e4429';
    P.rect(11,22,5,10,tr);P.rect(11,22,1,10,'#8a5a36');P.rect(15,24,1,8,'#4a2a18');P.poly([[9,33],[11,28],[12,33]],tr);P.poly([[18,33],[16,28],[15,33]],'#4a2a18');
    P.ell(13.5,13,11,10,m);P.ell(6,15,5,5,m);P.ell(21,15,5,5,m);P.ell(13,6,7,5,m);
    P.ell(16,18,10,6,d);P.ell(20,15,5,4,d);
    P.ell(10,9,6,4.6,l);P.ell(6,13,3,3,l);P.ell(14,5,4,3,l);
    P.rect(8,7,3,2,hl);P.rect(12,4,3,1,hl);P.set(5,12,hl);
    [[7,18],[12,20],[18,21],[22,18]].forEach(([x,y])=>{P.ell(x,y,3,2,d);});
    P.ell(14,22,8,1.6,'#1b4a24');
    if(pink)for(let k=0;k<8;k++)P.set(5+nz(k,1,2)*18|0,6+nz(k,2,3)*12|0,'#fff0f6');
  }
  P.outline('#1c3626');
  return treeCache[kind]=P.canvas(2);
}
return {getHero,getBoss,getJr,bakeGround,treeSprite,trees,waterTiles,getGround:()=>ground,Pix,mix};
}

const ART=createArt({TILE,COLS,ROWS,tileAt});ART.bakeGround();
function buildMinimapBase(){
  const sx=minimap.width/WIDTH,sy=minimap.height/HEIGHT;
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    const kind=tileAt(x,y);
    miniBaseCtx.fillStyle=kind==='water'?'#3aa2f0':kind==='tree'?'#2d8c44':kind==='path'?'#dbac6a':kind==='cliff'?'#7e4e2d':'#58b240';
    miniBaseCtx.fillRect(x*TILE*sx,y*TILE*sy,Math.ceil(TILE*sx),Math.ceil(TILE*sy));
  }
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
function drawTile(x,y){const px=x*TILE,py=y*TILE,kind=tileAt(x,y),v=hash(x,y),v2=hash(x,y,77);
  if(kind==='water'){ctx.fillStyle='#79c9ef';ctx.fillRect(px,py,TILE,TILE);ctx.fillStyle='#a8e0ff';ctx.fillRect(px+4+(v*12|0),py+6,11,2);ctx.fillRect(px+14,py+18,10,2);ctx.fillStyle='#55a6d4';ctx.fillRect(px+8,py+26,14,2);if(x>109){ctx.fillStyle='#dff8ff';ctx.fillRect(px+2,py,3,TILE);}return;}
  if(kind==='cliff'){ctx.fillStyle='#7f563f';ctx.fillRect(px,py,TILE,TILE);ctx.fillStyle='#93634b';for(let i=0;i<6;i++)ctx.fillRect(px+(i*5+v2*3)%28,py+3+(i*4)%24,2,8);ctx.strokeStyle='#52382a';ctx.lineWidth=2;for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(px+3,py+6+i*7);ctx.lineTo(px+28,py+12+i*6);ctx.stroke();}if(y===9||y===27||y===63){ctx.fillStyle='#92d37e';ctx.fillRect(px,py,32,5);}return;}
  ctx.fillStyle=kind==='path'?'#c8a66d':'#6fbe64';ctx.fillRect(px,py,TILE,TILE);
  if(kind==='grass'){ctx.fillStyle='#86cf71';ctx.fillRect(px+2,py+2,28,28); if(v>.56){ctx.fillStyle='#58a64f';ctx.fillRect(px+6,py+8,2,7);ctx.fillRect(px+11,py+5,2,10);ctx.fillRect(px+23,py+18,2,6);} if(v<.13){ctx.fillStyle='#80a85f';ctx.fillRect(px+15,py+19,2,2);} if(v2>.78){ctx.fillStyle='#93dbff';ctx.fillRect(px+8,py+14,3,3);ctx.fillRect(px+11,py+12,3,3);ctx.fillRect(px+13,py+15,3,3);} if(v2<.08){ctx.fillStyle='#f5a3d7';ctx.fillRect(px+20,py+10,3,3);ctx.fillRect(px+23,py+13,3,3);} }
  if(kind==='path'){ctx.fillStyle='#d6b37f';ctx.fillRect(px+2,py+2,28,28);ctx.fillStyle='#b68f5e';ctx.fillRect(px+10,py+13,3,2);ctx.fillRect(px+20,py+19,2,2);}
  if(kind==='tree'){ellipse(px+16,py+26,13,5,'#21432b88');ctx.fillStyle='#6f4a34';ctx.fillRect(px+13,py+16,6,13);ctx.fillStyle='#2f6e45';ctx.beginPath();ctx.arc(px+16,py+16,13,0,Math.PI*2);ctx.fill();ctx.fillStyle='#3b8d58';ctx.beginPath();ctx.arc(px+11,py+12,10,0,Math.PI*2);ctx.arc(px+20,py+12,9,0,Math.PI*2);ctx.fill();ctx.fillStyle='#78c27e';ctx.beginPath();ctx.arc(px+9,py+9,4,0,Math.PI*2);ctx.fill();}}

function drawWaterShine(now,x0,y0,x1,y1){ctx.fillStyle='#ffffff';for(const w of ART.waterTiles){if(w.x<x0-32||w.x>x1||w.y<y0-32||w.y>y1)continue;for(let k=0;k<2;k++){const ph=(k?w.b:w.a)*6.283,a=Math.sin(now/520+ph+k*2);if(a<.35)continue;ctx.globalAlpha=(a-.35)*.75;const sx=w.x+4+((k?w.c:w.a)*18|0)*1,sy=w.y+4+(((k?w.a:w.b)*20)|0);ctx.fillRect(sx&~1,sy&~1,6,2);}}ctx.globalAlpha=1;}
function pixFlame(fx,fy,s,now){const u=2*s,f=Math.round(Math.sin(now/85)),h=Math.round(Math.sin(now/120+1.7));ctx.save();ctx.translate(Math.round(fx),Math.round(fy));
 ctx.fillStyle='#d6301f';ctx.fillRect(-3*u,-2*u,6*u,2*u);ctx.fillRect(-2*u,-5*u,4*u,3*u);ctx.fillRect((-1+f)*u,-7*u,2*u,2*u);ctx.fillRect((h)*u,-9*u+u*(f?0:1),1*u,2*u);
 ctx.fillStyle='#ff9b2c';ctx.fillRect(-2*u,-2*u,4*u,2*u);ctx.fillRect(-1*u,-5*u,2*u,3*u);ctx.fillRect(f*u,-7*u,1*u,2*u);
 ctx.fillStyle='#ffe85a';ctx.fillRect(-1*u,-2*u,2*u,1*u);ctx.fillRect(0,-4*u,1*u,2*u);ctx.restore();}

function drawPlayer(p,now){const x=p.x,y=p.y,walking=Math.hypot(p.tx-p.x,p.ty-p.y)>.25,bob=walking?Math.sin(now/95)*1.3:0;const age=now-(p.visualJumpStart||0),jumping=!!p.visualJumpStart&&age>=0&&age<480,progress=jumping?age/480:0,height=jumping?Math.sin(progress*Math.PI)*20:0,shadowScale=1-height/33;ellipse(x,y+12,12*shadowScale,4.4*shadowScale,'#203c2a8c');ctx.save();const leapAge=now-(p.visualLeapStart||0);const leapHeight=p.visualLeapStart&&leapAge>=0&&leapAge<520?Math.sin(Math.PI*leapAge/520)*46:0;ctx.translate(0,-height-leapHeight);const spinAge=now-(p.visualSpinStart||0),spinning=!!p.visualSpinStart&&spinAge>=0&&spinAge<3000;if(spinning){ctx.translate(x,y);ctx.rotate(spinAge/105);ctx.translate(-x,-y);}if(Date.now()<p.invulnerableUntil&&Math.floor(now/85)%2===0)ctx.globalAlpha=.45;
const armor=colors[p.color%colors.length]||colors[0],dark='#243447',trim='#f4d56b';const wf=walking?1+(Math.floor(now/130)%2):0,spr=ART.getHero(p.dir||'down',wf,armor);ctx.drawImage(spr,Math.round(x-spr.width/2),Math.round(y+18-spr.height+(wf===1?-1:0)));
const dirs={up:-Math.PI/2,down:Math.PI/2,left:Math.PI,right:0};const slashAge=now-(p.visualAttackStart||0),swing=!!p.visualAttackStart&&slashAge>=0&&slashAge<230;const facing=swing&&Number.isFinite(p.attackAngle)?p.attackAngle:(dirs[p.dir]??Math.PI/2);const bladeAngle=spinning?0:facing+(swing?(-1.2+2.4*slashAge/230):.58);
ctx.save();ctx.translate(x,y-5+bob);ctx.rotate(bladeAngle);ctx.fillStyle='#7a4a2a';ctx.fillRect(8,-2,12,4);ctx.strokeStyle='#241830';ctx.lineWidth=1;ctx.strokeRect(8,-2,12,4);ctx.fillStyle=trim;ctx.fillRect(18,-7,3,14);ctx.fillStyle='#d9e8ef';ctx.beginPath();ctx.moveTo(20,-3);ctx.lineTo(39,-2);ctx.lineTo(48,0);ctx.lineTo(39,2);ctx.lineTo(20,3);ctx.closePath();ctx.fill();ctx.strokeStyle='#ffffff';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(22,-1);ctx.lineTo(44,0);ctx.stroke();ctx.restore();

if(spinning){ctx.save();ctx.translate(x,y-4+bob);ctx.strokeStyle='#f5ecab';ctx.lineWidth=4;ctx.globalAlpha=.75;ctx.beginPath();ctx.arc(0,0,83,0,Math.PI*2);ctx.stroke();ctx.restore();}
if(swing){ctx.save();ctx.translate(x,y-4+bob);ctx.rotate(facing);ctx.strokeStyle='#fff4bd';ctx.lineWidth=3;ctx.lineCap='round';ctx.beginPath();ctx.arc(0,0,60,-1.15+slashAge/230*1.45,-.7+slashAge/230*1.45);ctx.stroke();ctx.restore();}
ctx.restore();label(`${p.name}  Lv.${p.level}`,x,y-38-height-leapHeight+bob,p.id===myId?'#ffef9d':'#fff',11);ctx.fillStyle='#172b21';ctx.fillRect(x-18,y-33-height-leapHeight+bob,36,4);ctx.fillStyle='#e86c71';ctx.fillRect(x-18,y-33-height-leapHeight+bob,36*Math.max(0,p.hp/p.maxHp),4);}

function drawMonster(m,now){if(!m.alive)return;const x=m.x,y=m.y,float=(m.type==='bat'||m.type==='baphomet')?Math.sin(now/180+m.x)*4:0;ellipse(x,y+(m.type==='baphomet'?38:(m.type==='baphometjr'?14:10)),m.type==='baphomet'?26:(m.type==='baphometjr'?13:11),m.type==='baphomet'?8:4,'#203c2a8c');
if(m.type==='rat'){ctx.fillStyle='#5f5148';ctx.beginPath();ctx.ellipse(x,y+1,15,10,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#74645c';ctx.beginPath();ctx.ellipse(x+11,y-1,7,6,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d44e58';ctx.fillRect(x+11,y-2,2,2);ctx.strokeStyle='#8f7b76';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-11,y+5);ctx.quadraticCurveTo(x-25,y+13,x-28,y-2);ctx.stroke();ctx.strokeStyle='#c7c7c7';ctx.beginPath();ctx.moveTo(x+13,y+4);ctx.lineTo(x+18,y+9);ctx.moveTo(x+10,y+4);ctx.lineTo(x+15,y+10);ctx.stroke();}
else if(m.type==='bat'){ctx.fillStyle='#473b63';ctx.beginPath();ctx.moveTo(x-4,y-8+float);ctx.lineTo(x-23,y-18+float);ctx.lineTo(x-18,y+5+float);ctx.lineTo(x-3,y+2+float);ctx.moveTo(x+4,y-8+float);ctx.lineTo(x+23,y-18+float);ctx.lineTo(x+18,y+5+float);ctx.lineTo(x+3,y+2+float);ctx.fill();ellipse(x,y-5+float,10,10,'#6a5d88');ctx.fillStyle='#ef7f94';ctx.fillRect(x-7,y-7+float,3,3);ctx.fillRect(x+4,y-7+float,3,3);ctx.fillStyle='#f2cfda';ctx.fillRect(x-2,y-1+float,4,2);}
else if(m.type==='baphomet'){const B=ART.getBoss(),casting=!!m.quakeStart,by=y-4+float,sx=Math.round(x-B.w/2),sy=Math.round(by-B.h+34);ctx.save();ctx.globalAlpha=casting?.85+Math.sin(now/70)*.1:.45+Math.sin(now/260)*.25;ctx.drawImage(casting?B.auraRed:B.aura,sx,sy);ctx.restore();ctx.drawImage(B.body,sx,sy);pixFlame(sx+44,sy+17,1.6,now);}
else if(m.type==='baphometjr'){const J=ART.getJr(),fr=Math.floor(now/200)%2,sx=Math.round(x-J.w/2),sy=Math.round(y+float+14-J.h);ctx.drawImage(J.frames[fr],sx,sy);pixFlame(sx+28,sy+9,.8,now);}
const name=m.name||(m.type==='bat'?'Bat':m.type==='rat'?'Rat':m.type==='baphomet'?'Baphomet':'Baphomet.Jr');label(name,x,y-(m.type==='baphomet'?118:(m.type==='baphometjr'?58:27))+float,m.type==='baphomet'?'#ffb995':'#ffddd2',m.type==='baphomet'?12:11);ctx.fillStyle='#24342a';const bw=m.type==='baphomet'?64:m.type==='baphometjr'?36:30;ctx.fillRect(x-bw/2,y-(m.type==='baphomet'?110:(m.type==='baphometjr'?54:23))+float,bw,5);ctx.fillStyle=m.type==='baphomet'?'#b44555':m.type==='baphometjr'?'#ff85b6':'#e77a76';ctx.fillRect(x-bw/2,y-(m.type==='baphomet'?110:(m.type==='baphometjr'?54:23))+float,bw*Math.max(0,m.hp/m.maxHp),5);if(Date.now()<m.stunnedUntil){for(let i=0;i<3;i++){const a=now/180+i*Math.PI*2/3;ctx.fillStyle='#ffe299';ctx.beginPath();ctx.moveTo(x+Math.cos(a)*13,y-(m.type==='baphomet'?134:(m.type==='baphometjr'?70:36))+float+Math.sin(a)*4);for(let k=1;k<5;k++){const aa=a+k*Math.PI*2/5,r=k%2?4.8:2.2;ctx.lineTo(x+Math.cos(aa)*13+Math.cos(aa)*r,y-(m.type==='baphomet'?134:(m.type==='baphometjr'?70:36))+float+Math.sin(a)*4+Math.sin(aa)*r);}ctx.closePath();ctx.fill();}label('STUN',x,y-(m.type==='baphomet'?144:(m.type==='baphometjr'?80:46))+float,'#ffe4a2',10);}if(m.type==='rat'&&Date.now()<m.chargeUntil){ctx.strokeStyle='#ffe19c';ctx.lineWidth=2;ctx.strokeRect(x-16,y-13,32,25);}}

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
 const x=m.x,y=m.y-162,w=128,h=12;
 ctx.save();ctx.font='bold 13px system-ui';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#301715';ctx.strokeText('EARTHQUAKE',x,y-13);ctx.fillStyle='#ffcc85';ctx.fillText('EARTHQUAKE',x,y-13);ctx.fillStyle='#251b1b';ctx.fillRect(x-w/2-2,y-2,w+4,h+4);ctx.fillStyle='#823629';ctx.fillRect(x-w/2,y,w,h);ctx.fillStyle='#ffa14c';ctx.fillRect(x-w/2,y,w*ratio,h);ctx.strokeStyle='#ffe0af';ctx.strokeRect(x-w/2,y,w,h);ctx.restore();
}}
function drawDamageFx(now){for(let i=damageFx.length-1;i>=0;i--){const f=damageFx[i],age=now-f.start;if(age>850){damageFx.splice(i,1);continue;}ctx.save();ctx.globalAlpha=1-age/850;label(f.kind==='miss'?'MISS':String(f.amount),f.x,f.y-22-age*.04,f.kind==='player'?'#ff8080':f.kind==='crit'?'#ffe16e':'#fff',f.kind==='crit'?17:14);ctx.restore();}}
function drawCracks(now){for(let i=crackFx.length-1;i>=0;i--){const fx=crackFx[i],age=now-fx.start;if(age>4400){crackFx.splice(i,1);continue;}ctx.save();ctx.translate(fx.x,fx.y);ctx.globalAlpha=age<1900?.85:.85*(1-(age-1900)/2500);ctx.strokeStyle='#362d25';ctx.lineWidth=3;for(let k=0;k<12;k++){const a=k*Math.PI/6,reach=28+(k%3)*14;ctx.beginPath();ctx.moveTo(Math.cos(a)*5,Math.sin(a)*5);ctx.lineTo(Math.cos(a)*reach*.55-Math.sin(a)*5,Math.sin(a)*reach*.55+Math.cos(a)*5);ctx.lineTo(Math.cos(a)*reach,Math.sin(a)*reach);ctx.stroke();}ctx.strokeStyle='#e4c48e';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,90,0,Math.PI*2);ctx.stroke();ctx.restore();}}
function drawParticles(dt){for(let i=particleFx.length-1;i>=0;i--){const p=particleFx[i];p.life-=dt*1000;if(p.life<=0){particleFx.splice(i,1);continue;}p.vy+=p.gravity*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;ctx.save();ctx.globalAlpha=Math.max(0,p.life/p.maxLife);ctx.fillStyle=p.color;ctx.beginPath();ctx.ellipse(p.x,p.y,p.size,p.size*.7,0,0,Math.PI*2);ctx.fill();ctx.restore();}}
function drawMinimap(){const sx=minimap.width/WIDTH,sy=minimap.height/HEIGHT;miniCtx.clearRect(0,0,minimap.width,minimap.height);miniCtx.drawImage(miniBase,0,0);miniCtx.fillStyle='#00000033';miniCtx.fillRect(cameraX*sx,cameraY*sy,viewW*sx,viewH*sy);miniCtx.strokeStyle='#dff6cd';miniCtx.lineWidth=1;miniCtx.strokeRect(cameraX*sx+.5,cameraY*sy+.5,Math.max(8,viewW*sx)-1,Math.max(8,viewH*sy)-1);for(const m of monsters.values()){if(!m.alive)continue;miniCtx.fillStyle=m.type==='bat'?'#8a6fd1':m.type==='rat'?'#8d6c58':m.type==='baphomet'?'#ff6b6b':'#ff91c7';miniCtx.fillRect(m.x*sx-(m.type==='baphomet'?2.5:1.5),m.y*sy-(m.type==='baphomet'?2.5:1.5),m.type==='baphomet'?5:3,m.type==='baphomet'?5:3);}for(const p of players.values()){miniCtx.beginPath();miniCtx.fillStyle=p.id===myId?'#ffef92':'#fff';miniCtx.arc(p.x*sx,p.y*sy,p.id===myId?3.3:2.5,0,Math.PI*2);miniCtx.fill();}ui('minimap-status').textContent=`${players.size}p · ${[...monsters.values()].filter(m=>m.alive).length}m`;}
function frame(now){if(attackingHeld&&now-lastAttackSent>=65&&document.activeElement!==ui('name')&&document.activeElement!==ui('chat-input')){lastAttackSent=now;const me=players.get(myId);const cooldown=Math.max(135,400-(me?.stats?.AGI||0)*5);if(now-(me?.visualAttackStart||0)>cooldown-45)handleAction('slash');}const dt=Math.min((now-last)/1000,.05);last=now;sendInput(now);for(const p of [...players.values(),...monsters.values(),...projectiles.values()]){const f=1-Math.exp(-dt*55);p.x+=(p.tx-p.x)*f;p.y+=(p.ty-p.y)*f;}
const mine=players.get(myId);
const cooldownBox=ui('skill-cooldown');if(mine){const end=mine.spinCooldownUntil||0;const active=mine.visualSpinStart&&now-mine.visualSpinStart<3000;const timeLeft=Math.max(0,end-(Date.now()+serverClockOffset));cooldownBox.hidden=active||timeLeft<=0;cooldownBox.textContent=timeLeft>100?(Math.ceil(timeLeft/1000)+'s'):'';const leapBox=ui('leap-cooldown'),leapLeft=Math.max(0,(mine.leapCooldownUntil||0)-(Date.now()+serverClockOffset));leapBox.hidden=leapLeft<100;leapBox.textContent=leapLeft>=100?Math.ceil(leapLeft/1000)+'s':'';}else{cooldownBox.hidden=true;ui('leap-cooldown').hidden=true;}
if(mine){const f=1-Math.exp(-dt*24);cameraX+=(mine.x-viewW/2-cameraX)*f;cameraY+=(mine.y-viewH/2-cameraY)*f;}cameraX=viewW>=WIDTH?(WIDTH-viewW)/2:Math.max(0,Math.min(WIDTH-viewW,cameraX));cameraY=viewH>=HEIGHT?(HEIGHT-viewH)/2:Math.max(0,Math.min(HEIGHT-viewH,cameraY));ctx.clearRect(0,0,viewW,viewH);ctx.fillStyle='#162d25';ctx.fillRect(0,0,viewW,viewH);ctx.save();ctx.translate(-Math.round(cameraX),-Math.round(cameraY));const left=Math.max(0,Math.floor(cameraX/TILE)-1),right=Math.min(COLS,Math.ceil((cameraX+viewW)/TILE)+1),top=Math.max(0,Math.floor(cameraY/TILE)-1),bottom=Math.min(ROWS,Math.ceil((cameraY+viewH)/TILE)+1);{const gx=Math.max(0,Math.floor(cameraX)),gy=Math.max(0,Math.floor(cameraY)),gw=Math.min(WIDTH-gx,viewW+2),gh=Math.min(HEIGHT-gy,viewH+2);if(gw>0&&gh>0)ctx.drawImage(ART.getGround(),gx,gy,gw,gh,gx,gy,gw,gh);drawWaterShine(now,gx,gy,gx+gw,gy+gh);}drawCracks(now);drawQuakes(now);const actors=ART.trees.filter(t=>t.x>cameraX-60&&t.x<cameraX+viewW+60&&t.y>cameraY&&t.y<cameraY+viewH+90).map(t=>({y:t.y-14,draw:()=>{const s=ART.treeSprite(t.v);ctx.drawImage(s,Math.round(t.x-s.width/2),Math.round(t.y-(t.v===1?70:68)));}})).concat([...players.values()].map(p=>({y:p.y,draw:()=>drawPlayer(p,now)}))).concat([...monsters.values()].filter(m=>m.alive).map(m=>({y:m.y,draw:()=>drawMonster(m,now)})));actors.sort((a,b)=>a.y-b.y).forEach(a=>a.draw());for(const b of projectiles.values())drawProjectile(b);drawParticles(dt);drawDamageFx(now);drawBossCastbars(now);ctx.restore();drawMinimap();if(now-lastSaved>1000){lastSaved=now;persist();}requestAnimationFrame(frame);}
connect();requestAnimationFrame(frame);
})();
