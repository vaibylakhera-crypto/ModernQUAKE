// ModernQUAKE room server: serves the built game (dist/) and relays player state over WebSocket (/ws?room=CODE&name=NAME).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { WebSocketServer } from 'ws';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT) || 8080;
const MAX = 8;            // humans per room (bots come on top)
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
  if (p === '/api/rooms') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(listRooms())); return; }
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

// ───────────── rooms, lobby, matches ─────────────
// room: { code, players: Map<id,{ws,name,color,frags,deaths}>, bots: Map<id,{name,color,weapon,frags,deaths}>, host, cfg, state, endsAt }
//  state: 'lobby' (warmup, scores not counted) -> 'playing' (host pressed START) -> 'ended' (results) -> back to 'lobby'
const rooms = new Map();
let nextId = 1, nextBot = 1000;
const MAPS = new Set(['boreal', 'void', 'spire', 'bastion', 'foundry', 'crypt', 'ring']);
const BOT_POOL = [
  { name: 'RAZOR', weapon: 'plasma' }, { name: 'VEX', weapon: 'plasma' }, { name: 'KRAIT', weapon: 'rocket' }, { name: 'NYX', weapon: 'nailer' },
  { name: 'ONYX', weapon: 'plasma' }, { name: 'HEX', weapon: 'rocket' }, { name: 'MORROW', weapon: 'nailer' }, { name: 'ZOLA', weapon: 'plasma' },
];
const MAX_BOTS = 7;
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
function cleanCfg(c, prev = { map: 'boreal', bots: 3, skill: 1, frag: 20, time: 10, open: true }) {
  c = c && typeof c === 'object' ? c : {};
  return {
    map: MAPS.has(c.map) ? c.map : prev.map,
    bots: clampInt(c.bots ?? prev.bots, 0, MAX_BOTS, prev.bots),
    skill: clampInt(c.skill ?? prev.skill, 0, 2, prev.skill),        // 0 easy, 1 normal, 2 hard
    frag: clampInt(c.frag ?? prev.frag, 0, 100, prev.frag),           // 0 = no frag limit
    time: clampInt(c.time ?? prev.time, 0, 60, prev.time),            // minutes, 0 = no time limit
    open: c.open === undefined ? prev.open : !!c.open,                // listed in OPEN GAMES
  };
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const board = room => [
  ...[...room.players.entries()].map(([id, p]) => ({ id, name: p.name, color: p.color, frags: p.frags, deaths: p.deaths })),
  ...[...room.bots.entries()].map(([id, b]) => ({ id, name: b.name, color: b.color, frags: b.frags, deaths: b.deaths, bot: true, weapon: b.weapon })),
];
const bcast = (room, o, except) => { const s = JSON.stringify(o); for (const [id, p] of room.players) if (id !== except && p.ws.readyState === 1) p.ws.send(s); };
const usedColors = room => new Set([...room.players.values(), ...room.bots.values()].map(p => p.color));
const pickColor = (room, id) => COLORS.find(c => !usedColors(room).has(c)) ?? COLORS[id % COLORS.length];
const roomInfo = room => ({ room: room.code, host: room.host, cfg: room.cfg, state: room.state, endsAt: room.endsAt, now: Date.now(), players: board(room) });

/** add/remove bots until the room has cfg.bots of them (humans + bots capped at MAX + MAX_BOTS) */
function syncBots(room) {
  while (room.bots.size > room.cfg.bots) { const last = [...room.bots.keys()].pop(); room.bots.delete(last); }
  const names = new Set([...room.bots.values()].map(b => b.name));
  for (const def of BOT_POOL) {
    if (room.bots.size >= room.cfg.bots) break;
    if (names.has(def.name)) continue;
    const id = nextBot++; room.bots.set(id, { name: def.name, weapon: def.weapon, color: pickColor(room, id), frags: 0, deaths: 0 });
  }
}
function resetScores(room) { for (const p of [...room.players.values(), ...room.bots.values()]) { p.frags = 0; p.deaths = 0; } }
function endMatch(room, why) {
  if (room.state !== 'playing') return;
  room.state = 'ended'; room.endsAt = 0;
  const b = board(room).sort((a, z) => z.frags - a.frags || a.deaths - z.deaths);
  bcast(room, { t: 'end', why, board: b, winner: b[0] ? b[0].id : 0, next: 12 });
  clearTimeout(room.endTimer);
  room.endTimer = setTimeout(() => { if (!rooms.has(room.code)) return; room.state = 'lobby'; resetScores(room); bcast(room, { t: 'lobby', ...roomInfo(room) }); }, 12000);
}
function checkFragLimit(room) {
  if (room.state === 'playing' && room.cfg.frag > 0 && board(room).some(p => p.frags >= room.cfg.frag)) endMatch(room, 'frag');
}
setInterval(() => { for (const room of rooms.values()) if (room.state === 'playing' && room.endsAt && Date.now() >= room.endsAt) endMatch(room, 'time'); }, 500);
const credit = (room, id) => room.players.get(id) || room.bots.get(id);

wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x');
  const code = (u.searchParams.get('room') || 'LOBBY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'LOBBY';
  const name = (u.searchParams.get('name') || 'PLAYER').replace(/[^\w \-]/g, '').slice(0, 14) || 'PLAYER';
  let room = rooms.get(code);
  if (!room) {
    let cfg = {}; try { cfg = JSON.parse(u.searchParams.get('cfg') || '{}'); } catch { /* defaults */ }
    if (!cfg.map) cfg.map = u.searchParams.get('map');
    room = { code, players: new Map(), bots: new Map(), host: 0, cfg: cleanCfg(cfg), state: 'lobby', endsAt: 0, endTimer: null };
    rooms.set(code, room); syncBots(room);
  }
  if (room.players.size >= MAX) { send(ws, { t: 'full' }); ws.close(); return; }
  const id = nextId++;
  room.players.set(id, { ws, name, color: pickColor(room, id), frags: 0, deaths: 0 });
  if (!room.host || !room.players.has(room.host)) room.host = id;
  send(ws, { t: 'welcome', id, ...roomInfo(room) });
  bcast(room, { t: 'join', player: board(room).find(p => p.id === id), host: room.host }, id);
  console.log(`[${code}] + ${name} (#${id}) — ${room.players.size} in room${room.host === id ? ' (host)' : ''}`);

  let last = 0;
  const isHost = () => room.host === id;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const me = room.players.get(id); if (!me || !m || typeof m !== 'object') return;
    switch (m.t) {
      case 'state': { const n = Date.now(); if (n - last < 30) return; last = n; bcast(room, { t: 'state', id, p: m.p, yaw: m.yaw, pitch: m.pitch, w: m.w, hp: m.hp, dead: m.dead }, id); break; }
      case 'bots': if (isHost() && Array.isArray(m.l)) bcast(room, { t: 'bots', l: m.l.slice(0, MAX_BOTS) }, id); break;
      case 'fire': {
        const as = Number(m.as);                                   // the host fires on behalf of its bots
        const shooter = as && isHost() && room.bots.has(as) ? as : id;
        bcast(room, { t: 'fire', id: shooter, w: m.w, o: m.o, d: m.d, k: Math.min(2, Math.max(1, Number(m.k) || 1)) }, id); break;
      }
      case 'hit': {
        const to = Number(m.to), dmg = Math.min(150, Number(m.dmg) || 0);
        const target = room.players.get(to);
        if (target) send(target.ws, { t: 'hit', from: id, dmg, dir: m.dir, kind: m.kind });
        else if (room.bots.has(to)) { const h = room.players.get(room.host); if (h) send(h.ws, { t: 'bothit', from: id, to, dmg, dir: m.dir, kind: m.kind }); }
        break;
      }
      case 'dead': {                                                // a player died; by = killer (player or bot id)
        const by = Number(m.by) || 0, w = typeof m.w === 'string' && /^[a-z]{1,12}$/.test(m.w) ? m.w : '';
        if (room.state !== 'ended') {
          if (room.state === 'playing') { me.deaths++; const k = credit(room, by); if (k && k !== me) k.frags++; else if (!k || k === me) me.frags = Math.max(0, me.frags - (by === id ? 1 : 0)); }
          bcast(room, { t: 'killed', id, by, w, board: board(room) });
          checkFragLimit(room);
        }
        break;
      }
      case 'botdead': {                                             // host reports one of its bots died
        if (!isHost()) return; const bid = Number(m.id), bot = room.bots.get(bid); if (!bot) return;
        const by = Number(m.by) || 0, w = typeof m.w === 'string' && /^[a-z]{1,12}$/.test(m.w) ? m.w : '';
        if (room.state === 'playing') { bot.deaths++; const k = credit(room, by); if (k && k !== bot) k.frags++; }
        if (room.state !== 'ended') { bcast(room, { t: 'killed', id: bid, by, w, board: board(room) }); checkFragLimit(room); }
        break;
      }
      case 'cfg': {                                                 // host edits match settings in the lobby
        if (!isHost()) return;
        room.cfg = cleanCfg(m.cfg, room.cfg); syncBots(room);
        bcast(room, { t: 'cfg', ...roomInfo(room) }); break;
      }
      case 'start': {
        if (!isHost() || room.state === 'playing') return;
        clearTimeout(room.endTimer); resetScores(room); room.state = 'playing';
        room.endsAt = room.cfg.time > 0 ? Date.now() + room.cfg.time * 60000 : 0;
        bcast(room, { t: 'start', ...roomInfo(room) }); break;
      }
      case 'stop': { if (isHost() && room.state === 'playing') endMatch(room, 'host'); break; }
      case 'rename': {
        const nn = String(m.name || '').replace(/[^\w \-]/g, '').slice(0, 14).trim(); if (!nn) return;
        me.name = nn; bcast(room, { t: 'renamed', id, name: nn, board: board(room) }); break;
      }
    }
  });
  ws.on('close', () => {
    room.players.delete(id); bcast(room, { t: 'leave', id });
    console.log(`[${code}] - ${name} (#${id}) — ${room.players.size} left`);
    if (!room.players.size) { clearTimeout(room.endTimer); rooms.delete(code); return; }
    if (room.host === id) { room.host = Math.min(...room.players.keys()); bcast(room, { t: 'host', host: room.host }); }
  });
});

/** GET /api/rooms: open games for the JOIN screen */
function listRooms() {
  return [...rooms.values()].filter(r => r.cfg.open && r.players.size < MAX).map(r => ({
    room: r.code, host: r.players.get(r.host)?.name ?? '?', players: r.players.size, bots: r.bots.size, map: r.cfg.map, state: r.state,
    frag: r.cfg.frag, time: r.cfg.time,
  }));
}

server.listen(PORT, '0.0.0.0', () => console.log(`ModernQUAKE server on http://0.0.0.0:${PORT}  (serving ${root})`));
