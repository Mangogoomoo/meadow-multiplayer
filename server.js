// Meadow Multiplayer - Node.js server
// Serves the website and synchronizes player movement over WebSockets.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, 'public');
const TILE = 32, COLS = 60, ROWS = 40;
const SPEED = 175; // world pixels per second
const players = new Map();

// Deterministic terrain shared with the browser.
function hash(x, y, seed = 12345) {
  let n = Math.imul(x + seed, 374761393) + Math.imul(y - seed, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function tileAt(x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return 'wall';
  // Pond with irregular edges and a small creek.
  const pond = ((x - 43) / 9) ** 2 + ((y - 13) / 7) ** 2;
  if (pond < 1 + (hash(x, y, 44) - 0.5) * 0.27) return 'water';
  if (x > 42 && y > 23 && Math.abs(x - (47 + Math.sin(y * 0.42) * 3)) < 1.4) return 'water';
  const safeSpawn = Math.abs(x - 15) < 6 && Math.abs(y - 18) < 6;
  if (!safeSpawn && hash(x, y, 91) > 0.887 && hash(x + 1, y, 55) > 0.24) return 'tree';
  return 'grass';
}
function collides(x, y) {
  const r = 10;
  for (const cx of [x-r, x+r]) for (const cy of [y-r, y+r]) {
    if (tileAt(Math.floor(cx/TILE), Math.floor(cy/TILE)) !== 'grass') return true;
  }
  return false;
}
function spawn() {
  for (let i = 0; i < 100; i++) {
    const x = (12 + Math.floor(Math.random() * 7)) * TILE + TILE/2;
    const y = (15 + Math.floor(Math.random() * 7)) * TILE + TILE/2;
    if (!collides(x,y)) return { x,y };
  }
  return { x: 15 * TILE+16, y: 18 * TILE+16 };
}
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const p of players.values()) if (p.ws.readyState === WebSocket.OPEN) p.ws.send(msg);
}
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.ico':'image/x-icon' };
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  const target = path.resolve(publicDir, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (target !== publicDir && !target.startsWith(publicDir + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(target, (err, contents) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff' });
    res.end(contents);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 1024 });
wss.on('connection', ws => {
  const id = crypto.randomUUID();
  const pos = spawn();
  const p = { id, ws, x:pos.x, y:pos.y, dir:'down', color:Math.floor(Math.random()*6), inputX:0, inputY:0, lastInput:Date.now() };
  players.set(id,p);
  ws.send(JSON.stringify({ type:'welcome', id, world:{cols:COLS, rows:ROWS, tile:TILE}, players:[...players.values()].map(({id,x,y,dir,color})=>({id,x,y,dir,color})) }));
  broadcast({type:'join', player:{id:p.id,x:p.x,y:p.y,dir:p.dir,color:p.color}});
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg?.type !== 'input') return;
    const ix = Number(msg.x), iy = Number(msg.y);
    if (!Number.isFinite(ix) || !Number.isFinite(iy)) return;
    p.inputX = Math.max(-1, Math.min(1, ix));
    p.inputY = Math.max(-1, Math.min(1, iy));
    const length = Math.hypot(p.inputX,p.inputY);
    if (length > 1) { p.inputX /= length; p.inputY /= length; }
    p.lastInput = Date.now();
  });
  ws.on('close', () => { players.delete(id); broadcast({type:'leave', id}); });
  ws.on('error', () => {});
});
let lastTick = performance.now(), elapsedForSnapshot = 0;
setInterval(() => {
  const now = performance.now(), dt = Math.min((now-lastTick)/1000, 0.05);
  lastTick = now;
  for (const p of players.values()) {
    if (Date.now()-p.lastInput > 1000) { p.inputX=0; p.inputY=0; }
    const dx = p.inputX * SPEED * dt, dy = p.inputY * SPEED * dt;
    if (dx !== 0 || dy !== 0) {
      if (Math.abs(dx) > Math.abs(dy)) p.dir=dx>0?'right':'left';
      else p.dir=dy>0?'down':'up';
      if (!collides(p.x+dx, p.y)) p.x += dx;
      if (!collides(p.x, p.y+dy)) p.y += dy;
    }
  }
  elapsedForSnapshot += dt;
  if (elapsedForSnapshot >= 0.05) {
    elapsedForSnapshot = 0;
    broadcast({type:'state', players:[...players.values()].map(({id,x,y,dir,color})=>({id,x:Math.round(x*10)/10,y:Math.round(y*10)/10,dir,color}))});
  }
}, 1000/60);
server.listen(PORT, '0.0.0.0', () => console.log(`Meadow Multiplayer running at http://localhost:${PORT}`));
