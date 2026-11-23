// ModernQUAKE room server: serves the built game (dist/) and relays player state over WebSocket (/ws?room=CODE&name=NAME).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { WebSocketServer } from 'ws';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
const MAX = 8;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const COLORS = [0xff4a3a, 0x35d0ff, 0xffb02e, 0xff2fa0, 0x7dff6a, 0xb08cff, 0x2effd0, 0xffffff];

// Static files: ETag + 304 so phones only download each file once, gzip for text/geometry, long caching for assets.
const GZ = new Set(['.html', '.js', '.css', '.json', '.gltf', '.bin', '.svg', '.txt', '.webmanifest']);
const memo = new Map();   // path -> { mtime, etag, raw, gz }
function cacheFor(p) {
  if (p.startsWith('/assets/')) return 'public, max-age=31536000, immutable';           // vite output: hashed names
  if (/^\/(kit|chars|tex-lo)\//.test(p) || /\.(png|webp)$/.test(p)) return 'public, max-age=604800, stale-while-revalidate=86400';
  return 'no-cache';                                                                     // index.html, manifest: always revalidate (cheap 304)
}
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(root, p));
  if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
    const ext = path.extname(f);
    const head = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheFor(p), ETag: etag, Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head).end(); return; }
    const gzipOk = GZ.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    const m = memo.get(f);
    const serve = e => {
      const body = gzipOk && e.gz ? e.gz : e.raw;
      if (body === e.gz) head['Content-Encoding'] = 'gzip';
      head['Content-Length'] = body.length; res.writeHead(200, head); res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (m && m.etag === etag) { serve(m); return; }
    fs.readFile(f, (err2, raw) => {
      if (err2) { res.writeHead(404).end('not found'); return; }
      const e = { etag, raw, gz: GZ.has(ext) && raw.length > 1024 ? zlib.gzipSync(raw, { level: 9 }) : null };
      if (e.gz && e.gz.length >= raw.length) e.gz = null;
      if (raw.length < 8e6) memo.set(f, e);
      serve(e);
    });
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
      const w = typeof m.w === 'string' && /^[a-z]{1,12}$/.test(m.w) ? m.w : '';
      bcast(room, { t: 'killed', id, by: Number(m.by) || 0, w, board: board(room) });
    }
  });
  ws.on('close', () => {
    room.players.delete(id); bcast(room, { t: 'leave', id });
    console.log(`[${code}] - ${name} (#${id}) — ${room.players.size} left`);
    if (!room.players.size) rooms.delete(code);
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`ModernQUAKE server on http://0.0.0.0:${PORT}  (serving ${root})`));
