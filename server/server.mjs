// ModernQUAKE room server: serves the built game (dist/) and relays player state over WebSocket (/ws?room=CODE&name=NAME).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
const MAX = 8;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2' };
const COLORS = [0xff4a3a, 0x35d0ff, 0xffb02e, 0xff2fa0, 0x7dff6a, 0xb08cff, 0x2effd0, 0xffffff];

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(root, p));
  if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': f.includes('/assets/') ? 'public,max-age=31536000' : 'no-cache' });
    res.end(data);
  });
});

/** room code -> { players: Map<id, {ws,name,color,frags,deaths}> } */
const rooms = new Map();
let nextId = 1;
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const board = room => [...room.players.entries()].map(([id, p]) => ({ id, name: p.name, color: p.color, frags: p.frags, deaths: p.deaths }));
const bcast = (room, o, except) => { const s = JSON.stringify(o); for (const [id, p] of room.players) if (id !== except && p.ws.readyState === 1) p.ws.send(s); };

wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x');
  const code = (u.searchParams.get('room') || 'LOBBY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'LOBBY';
  const name = (u.searchParams.get('name') || 'PLAYER').replace(/[^\w \-]/g, '').slice(0, 14) || 'PLAYER';
  let room = rooms.get(code); if (!room) { room = { players: new Map(), map: u.searchParams.get('map') === 'void' ? 'void' : 'boreal' }; rooms.set(code, room); }
  if (room.players.size >= MAX) { send(ws, { t: 'full' }); ws.close(); return; }
  const id = nextId++; const used = new Set([...room.players.values()].map(p => p.color));
  const color = COLORS.find(c => !used.has(c)) ?? COLORS[id % COLORS.length];
  room.players.set(id, { ws, name, color, frags: 0, deaths: 0 });
  send(ws, { t: 'welcome', id, room: code, map: room.map, players: board(room) });
  bcast(room, { t: 'join', player: { id, name, color, frags: 0, deaths: 0 } }, id);
  console.log(`[${code}] + ${name} (#${id}) — ${room.players.size} in room`);

  let last = 0;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const me = room.players.get(id); if (!me || typeof m !== 'object') return;
    if (m.t === 'state') { const n = Date.now(); if (n - last < 30) return; last = n; bcast(room, { t: 'state', id, p: m.p, yaw: m.yaw, pitch: m.pitch, w: m.w, hp: m.hp, dead: m.dead }, id); }
    else if (m.t === 'fire') bcast(room, { t: 'fire', id, w: m.w, o: m.o, d: m.d }, id);
    else if (m.t === 'hit') { const to = room.players.get(Number(m.to)); if (to) send(to.ws, { t: 'hit', from: id, dmg: Math.min(150, Number(m.dmg) || 0), dir: m.dir, kind: m.kind }); }
    else if (m.t === 'dead') {
      me.deaths++; const k = room.players.get(Number(m.by)); if (k && k !== me) k.frags++;
      bcast(room, { t: 'killed', id, by: Number(m.by) || 0, board: board(room) });
    }
  });
  ws.on('close', () => {
    room.players.delete(id); bcast(room, { t: 'leave', id });
    console.log(`[${code}] - ${name} (#${id}) — ${room.players.size} left`);
    if (!room.players.size) rooms.delete(code);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`ModernQUAKE server on http://0.0.0.0:${PORT}  (serving ${root})`));
