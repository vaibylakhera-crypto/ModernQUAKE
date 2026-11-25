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
// room: { code, players: Map<id,{ws,name,color,team,frags,deaths,p}>, bots: Map<id,{name,color,team,weapon,frags,deaths}>, host, cfg, state, endsAt,
//         ts: {1,2} team scores (TDM frags / CTF captures), flags: {1,2} (CTF) }
//  state: 'lobby' (warmup) -> 'playing' (host pressed START) -> 'ended' (results) -> back to 'lobby'
//  team ids: 0 = none (free-for-all), 1 = RED, 2 = BLUE
const rooms = new Map();
let nextId = 1, nextBot = 1000;
const MAPS = new Set(['boreal', 'void', 'spire', 'bastion', 'foundry', 'crypt', 'ring', 'tower', 'canyon']);
const CTF_MAPS = new Set(['spire', 'bastion', 'foundry', 'crypt', 'ring', 'tower', 'canyon']);     // maps that have flag bases
const MODES = new Set(['ffa', 'tdm', 'ctf', 'insta', 'lms', 'koth']);
const LIVES = 3, KOTH_PER_STEP = 4;       // last man standing lives; king-of-the-hill points per frag-limit step (1 point = 1 second held)
const BOT_POOL = [
  { name: 'RAZOR', weapon: 'plasma' }, { name: 'VEX', weapon: 'plasma' }, { name: 'KRAIT', weapon: 'rocket' }, { name: 'NYX', weapon: 'nailer' },
  { name: 'ONYX', weapon: 'plasma' }, { name: 'HEX', weapon: 'rocket' }, { name: 'MORROW', weapon: 'nailer' }, { name: 'ZOLA', weapon: 'plasma' },
];
const MAX_BOTS = 7;
const FLAG_RETURN_MS = 20000;
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const DEF_CFG = { map: 'boreal', mode: 'ffa', bots: 3, skill: 1, frag: 20, caps: 3, time: 10, open: true };
function cleanCfg(c, prev = DEF_CFG) {
  c = c && typeof c === 'object' ? c : {};
  const map = MAPS.has(c.map) ? c.map : prev.map;
  let mode = MODES.has(c.mode) ? c.mode : prev.mode;
  if (mode === 'ctf' && !CTF_MAPS.has(map)) mode = 'tdm';                  // that map has no flag bases
  return {
    map, mode,
    bots: clampInt(c.bots ?? prev.bots, 0, MAX_BOTS, prev.bots),
    skill: clampInt(c.skill ?? prev.skill, 0, 2, prev.skill),               // 0 easy, 1 normal, 2 hard
    frag: clampInt(c.frag ?? prev.frag, 0, 100, prev.frag),                  // 0 = no frag limit (DM: player frags, TDM: team frags)
    caps: clampInt(c.caps ?? prev.caps, 1, 10, prev.caps),                   // CTF capture limit
    time: clampInt(c.time ?? prev.time, 0, 60, prev.time),                   // minutes, 0 = no time limit
    open: c.open === undefined ? prev.open : !!c.open,                       // listed in OPEN GAMES
  };
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16384 });
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const board = room => [
  ...[...room.players.entries()].map(([id, p]) => ({ id, name: p.name, color: p.color, team: p.team, frags: p.frags, deaths: p.deaths })),
  ...[...room.bots.entries()].map(([id, b]) => ({ id, name: b.name, color: b.color, team: b.team, frags: b.frags, deaths: b.deaths, bot: true, weapon: b.weapon })),
];
const bcast = (room, o, except) => { const s = JSON.stringify(o); for (const [id, p] of room.players) if (id !== except && p.ws.readyState === 1) p.ws.send(s); };
const bcastTeam = (room, team, o) => { const s = JSON.stringify(o); for (const p of room.players.values()) if ((!team || p.team === team) && p.ws.readyState === 1) p.ws.send(s); };
const usedColors = room => new Set([...room.players.values(), ...room.bots.values()].map(p => p.color));
const pickColor = (room, id) => COLORS.find(c => !usedColors(room).has(c)) ?? COLORS[id % COLORS.length];
const teamMode = room => room.cfg.mode === 'tdm' || room.cfg.mode === 'ctf';
const flagView = room => ({ 1: { s: room.flags[1].s, c: room.flags[1].c, p: room.flags[1].p }, 2: { s: room.flags[2].s, c: room.flags[2].c, p: room.flags[2].p } });
const roomInfo = room => ({ room: room.code, host: room.host, cfg: room.cfg, state: room.state, endsAt: room.endsAt, now: Date.now(), players: board(room), ts: room.ts, flags: flagView(room) });
const everyone = room => [...room.players.values(), ...room.bots.values()];

/** teams: humans keep their pick (or go to the smaller side); bots always fill whichever side is smaller */
function assignTeams(room) {
  if (!teamMode(room)) { for (const p of everyone(room)) p.team = 0; return; }
  const cnt = { 1: 0, 2: 0 };
  for (const p of room.players.values()) if (p.team === 1 || p.team === 2) cnt[p.team]++;
  for (const p of room.players.values()) if (p.team !== 1 && p.team !== 2) { const t = cnt[1] <= cnt[2] ? 1 : 2; p.team = t; cnt[t]++; }
  for (const b of room.bots.values()) { const t = cnt[1] <= cnt[2] ? 1 : 2; b.team = t; cnt[t]++; }
}
/** add/remove bots until the room has cfg.bots of them */
function syncBots(room) {
  while (room.bots.size > room.cfg.bots) { const last = [...room.bots.keys()].pop(); room.bots.delete(last); }
  const names = new Set([...room.bots.values()].map(b => b.name));
  for (const def of BOT_POOL) {
    if (room.bots.size >= room.cfg.bots) break;
    if (names.has(def.name)) continue;
    const id = nextBot++; room.bots.set(id, { name: def.name, weapon: def.weapon, color: pickColor(room, id), team: 0, frags: 0, deaths: 0 });
  }
  assignTeams(room);
}
const newFlags = () => ({ 1: { s: 'base', c: 0, p: null, t: null }, 2: { s: 'base', c: 0, p: null, t: null } });
function clearFlags(room) { for (const f of [1, 2]) clearTimeout(room.flags[f].t); room.flags = newFlags(); }
function resetScores(room) { for (const p of everyone(room)) { p.frags = 0; p.deaths = 0; } room.ts = { 1: 0, 2: 0 }; clearFlags(room); }
function returnFlag(room, f, why, by = 0) {
  const F = room.flags[f]; clearTimeout(F.t); F.s = 'base'; F.c = 0; F.p = null;
  bcast(room, { t: 'flags', flags: flagView(room), ts: room.ts, ev: { k: 'return', f, why, by } });
}
/** a carrier died or left: the flag drops where they were last seen and returns by itself after a while */
function dropFlagsOf(room, id) {
  for (const f of [1, 2]) {
    const F = room.flags[f]; if (F.s !== 'carried' || F.c !== id) continue;
    const pl = room.players.get(id);
    if (!pl || !pl.p) { returnFlag(room, f, 'lost'); continue; }
    F.s = 'dropped'; F.c = 0; F.p = pl.p; F.t = setTimeout(() => returnFlag(room, f, 'timeout'), FLAG_RETURN_MS);
    bcast(room, { t: 'flags', flags: flagView(room), ts: room.ts, ev: { k: 'drop', f, by: id } });
  }
}
function endMatch(room, why) {
  if (room.state !== 'playing') return;
  room.state = 'ended'; room.endsAt = 0;
  const lms = room.cfg.mode === 'lms', left = p => Math.max(0, LIVES - p.deaths);
  const b = board(room).sort((a, z) => lms ? left(z) - left(a) || z.frags - a.frags : z.frags - a.frags || a.deaths - z.deaths);
  const winTeam = teamMode(room) ? (room.ts[1] > room.ts[2] ? 1 : room.ts[2] > room.ts[1] ? 2 : 0) : 0;
  bcast(room, { t: 'end', why, board: b, winner: b[0] ? b[0].id : 0, team: winTeam, ts: room.ts, next: 12 });
  clearTimeout(room.endTimer);
  room.endTimer = setTimeout(() => { if (!rooms.has(room.code)) return; room.state = 'lobby'; resetScores(room); bcast(room, { t: 'lobby', ...roomInfo(room) }); }, 12000);
}
function checkLimits(room) {
  if (room.state !== 'playing') return;
  const m = room.cfg.mode, mx = Math.max(room.ts[1], room.ts[2]);
  if (m === 'ffa' || m === 'insta') { if (room.cfg.frag > 0 && board(room).some(p => p.frags >= room.cfg.frag)) endMatch(room, 'frag'); }
  else if (m === 'koth') { if (room.cfg.frag > 0 && board(room).some(p => p.frags >= room.cfg.frag * KOTH_PER_STEP)) endMatch(room, 'hill'); }
  else if (m === 'lms') { const all = board(room); if (all.length > 1 && all.filter(p => p.deaths < LIVES).length <= 1) endMatch(room, 'last'); }
  else if (m === 'tdm') { if (room.cfg.frag > 0 && mx >= room.cfg.frag) endMatch(room, 'frag'); }
  else if (mx >= room.cfg.caps) endMatch(room, 'caps');
}
setInterval(() => { for (const room of rooms.values()) if (room.state === 'playing' && room.endsAt && Date.now() >= room.endsAt) endMatch(room, 'time'); }, 500);
const credit = (room, id) => room.players.get(id) || room.bots.get(id);
const sameTeam = (a, b) => !!(a && b && a.team && a.team === b.team);
/** a kill: no credit for team kills or suicides; TDM also scores the team */
function scoreKill(room, killer, victim) {
  victim.deaths++;
  if (!killer || killer === victim) return;
  if (sameTeam(killer, victim)) return;
  if (room.cfg.mode === 'koth') return;                          // king of the hill scores only from holding the zone
  killer.frags++; if (room.cfg.mode === 'tdm' && killer.team) room.ts[killer.team]++;
}
const okPos = p => Array.isArray(p) && p.length === 3 && p.every(v => Number.isFinite(v)) ? [p[0], p[1], p[2]] : null;

wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x');
  const code = (u.searchParams.get('room') || 'LOBBY').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'LOBBY';
  const name = (u.searchParams.get('name') || 'PLAYER').replace(/[^\w \-]/g, '').slice(0, 14) || 'PLAYER';
  let room = rooms.get(code);
  if (!room) {
    let cfg = {}; try { cfg = JSON.parse(u.searchParams.get('cfg') || '{}'); } catch { /* defaults */ }
    if (!cfg.map) cfg.map = u.searchParams.get('map');
    room = { code, players: new Map(), bots: new Map(), host: 0, cfg: cleanCfg(cfg), state: 'lobby', endsAt: 0, endTimer: null, ts: { 1: 0, 2: 0 }, flags: newFlags() };
    rooms.set(code, room); syncBots(room);
  }
  if (room.players.size >= MAX) { send(ws, { t: 'full' }); ws.close(); return; }
  clearTimeout(room.reapTimer);                                    // somebody is back: the room stays
  const id = nextId++;
  room.players.set(id, { ws, name, color: pickColor(room, id), team: 0, frags: 0, deaths: 0, p: null });
  { // a player who dropped out a moment ago (phone locked, app switched) comes back with their score
    const g = room.ghosts?.get(name); room.ghosts?.delete(name);
    if (g && Date.now() - g.t < 90000 && room.state === 'playing') { const pl = room.players.get(id); pl.frags = g.frags; pl.deaths = g.deaths; }
  }
  if (!room.host || !room.players.has(room.host)) room.host = id;
  assignTeams(room);
  send(ws, { t: 'welcome', id, ...roomInfo(room) });
  bcast(room, { t: 'join', player: board(room).find(p => p.id === id), host: room.host }, id);
  if (teamMode(room)) bcast(room, { t: 'cfg', ...roomInfo(room) }, id);           // bots may have moved sides
  console.log(`[${code}] + ${name} (#${id}) — ${room.players.size} in room${room.host === id ? ' (host)' : ''}`);

  let last = 0, lastChat = 0;
  const isHost = () => room.host === id;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const me = room.players.get(id); if (!me || !m || typeof m !== 'object') return;
    switch (m.t) {
      case 'ping': send(ws, { t: 'pong', c: m.c }); break;
      case 'state': { const n = Date.now(); if (n - last < 20) return; last = n; me.p = okPos(m.p) || me.p; bcast(room, { t: 'state', id, p: m.p, yaw: m.yaw, pitch: m.pitch, w: m.w, hp: m.hp, dead: m.dead, v: m.v, n: m.n }, id); break; }
      case 'bots': if (isHost() && Array.isArray(m.l)) bcast(room, { t: 'bots', l: m.l.slice(0, MAX_BOTS) }, id); break;
      case 'fire': {
        const as = Number(m.as);                                   // the host fires on behalf of its bots
        const shooter = as && isHost() && room.bots.has(as) ? as : id;
        bcast(room, { t: 'fire', id: shooter, w: m.w, o: m.o, d: m.d, k: Math.min(2, Math.max(1, Number(m.k) || 1)) }, id); break;
      }
      case 'hit': {
        const to = Number(m.to), dmg = Math.min(150, Number(m.dmg) || 0);
        const target = room.players.get(to) || room.bots.get(to);
        if (!target || sameTeam(me, target)) break;                // friendly fire is off
        if (room.players.has(to)) send(target.ws, { t: 'hit', from: id, dmg, dir: m.dir, kind: m.kind });
        else { const h = room.players.get(room.host); if (h) send(h.ws, { t: 'bothit', from: id, to, dmg, dir: m.dir, kind: m.kind }); }
        break;
      }
      case 'dead': {                                                // a player died; by = killer (player or bot id)
        const by = Number(m.by) || 0, w = typeof m.w === 'string' && /^[a-z]{1,12}$/.test(m.w) ? m.w : '';
        if (room.state !== 'ended') {
          dropFlagsOf(room, id);
          if (room.state === 'playing') { const k = credit(room, by); scoreKill(room, k, me); if (!k && by === 0) { /* fell / self */ } if (by === id) me.frags = Math.max(0, me.frags - 1); }
          bcast(room, { t: 'killed', id, by, w, board: board(room), ts: room.ts });
          checkLimits(room);
        }
        break;
      }
      case 'botdead': {                                             // host reports one of its bots died
        if (!isHost()) return; const bid = Number(m.id), bot = room.bots.get(bid); if (!bot) return;
        const by = Number(m.by) || 0, w = typeof m.w === 'string' && /^[a-z]{1,12}$/.test(m.w) ? m.w : '';
        if (room.state === 'playing') scoreKill(room, credit(room, by), bot);
        if (room.state !== 'ended') { bcast(room, { t: 'killed', id: bid, by, w, board: board(room), ts: room.ts }); checkLimits(room); }
        break;
      }
      case 'cfg': {                                                 // host edits match settings in the lobby
        if (!isHost()) return;
        const prev = room.cfg; room.cfg = cleanCfg(m.cfg, room.cfg);
        if (room.cfg.mode !== prev.mode) for (const p of room.players.values()) p.team = 0;     // re-balance when the mode changes
        syncBots(room);
        bcast(room, { t: 'cfg', ...roomInfo(room) }); break;
      }
      case 'team': {                                                // a player picks RED or BLUE in the lobby
        const t = Number(m.team); if (!teamMode(room) || room.state === 'playing' || (t !== 1 && t !== 2)) return;
        me.team = t; assignTeams(room); bcast(room, { t: 'cfg', ...roomInfo(room) }); break;
      }
      case 'start': {
        if (!isHost() || room.state === 'playing') return;
        clearTimeout(room.endTimer); resetScores(room); room.state = 'playing';
        room.endsAt = room.cfg.time > 0 ? Date.now() + room.cfg.time * 60000 : 0;
        bcast(room, { t: 'start', ...roomInfo(room) }); break;
      }
      case 'award': {                                               // king of the hill: the host reports who held the zone this second
        if (!isHost() || room.state !== 'playing' || room.cfg.mode !== 'koth' || !Array.isArray(m.l)) return;
        for (const e of m.l.slice(0, 10)) { const t = credit(room, Number(e[0])); if (t) t.frags += Math.min(3, Math.max(0, Number(e[1]) || 0)); }
        bcast(room, { t: 'board', board: board(room) }); checkLimits(room); break;
      }
      case 'stop': { if (isHost() && room.state === 'playing') endMatch(room, 'host'); break; }
      case 'rename': {
        const nn = String(m.name || '').replace(/[^\w \-]/g, '').slice(0, 14).trim(); if (!nn) return;
        me.name = nn; bcast(room, { t: 'renamed', id, name: nn, board: board(room) }); break;
      }
      case 'flag': {                                                // capture the flag: take / return / capture
        if (room.cfg.mode !== 'ctf' || room.state !== 'playing' || !me.team) return;
        const f = Number(m.f); if (f !== 1 && f !== 2) return;
        const F = room.flags[f], enemy = f !== me.team;
        if (m.a === 'take' && enemy && (F.s === 'base' || F.s === 'dropped')) {
          clearTimeout(F.t); F.s = 'carried'; F.c = id; F.p = null;
          bcast(room, { t: 'flags', flags: flagView(room), ts: room.ts, ev: { k: 'take', f, by: id } });
        } else if (m.a === 'return' && !enemy && F.s === 'dropped') {
          returnFlag(room, f, 'touch', id);
        } else if (m.a === 'cap' && !enemy) {                       // standing at your own base (flag f is yours) while carrying theirs
          const ef = 3 - me.team, E = room.flags[ef];
          if (F.s === 'base' && E.s === 'carried' && E.c === id) {
            room.ts[me.team]++; me.frags += 3; returnFlag(room, ef, 'cap', id); checkLimits(room);
            bcast(room, { t: 'killed', id: 0, by: id, w: '', cap: true, board: board(room), ts: room.ts });
          }
        }
        break;
      }
      case 'chat': {                                                // quick chat + typed messages. to: 'all' | 'team'
        const n = Date.now(); if (n - lastChat < 500) return; lastChat = n;
        const to = m.to === 'team' && me.team ? 'team' : 'all';
        const out = { t: 'chat', from: id, to, k: typeof m.k === 'string' ? m.k.slice(0, 16) : '', txt: typeof m.txt === 'string' ? m.txt.replace(/[<>]/g, '').slice(0, 80) : '' };
        if (!out.k && !out.txt) return;
        if (to === 'team') bcastTeam(room, me.team, out); else bcast(room, out); break;
      }
      case 'rtc': {                                                 // WebRTC signalling for voice: forward to one peer
        const to = Number(m.to), peer = room.players.get(to); if (peer && m.d) send(peer.ws, { t: 'rtc', from: id, d: m.d }); break;
      }
      case 'talk': { bcast(room, { t: 'talk', id, on: !!m.on }, id); break; }
    }
  });
  ws.on('close', () => {
    dropFlagsOf(room, id);
    { const gone = room.players.get(id); if (gone && room.state === 'playing') { (room.ghosts ??= new Map()).set(gone.name, { frags: gone.frags, deaths: gone.deaths, t: Date.now() }); } }
    room.players.delete(id); bcast(room, { t: 'leave', id });
    console.log(`[${code}] - ${name} (#${id}) — ${room.players.size} left`);
    if (!room.players.size) {
      // keep an empty room for a short while so a dropped connection can come straight back into the same match
      clearTimeout(room.reapTimer);
      room.reapTimer = setTimeout(() => { if (!room.players.size) { clearTimeout(room.endTimer); clearFlags(room); rooms.delete(code); console.log(`[${code}] closed (empty)`); } }, 30000);
      return;
    }
    if (room.host === id) { room.host = Math.min(...room.players.keys()); bcast(room, { t: 'host', host: room.host }); }
    if (teamMode(room)) { assignTeams(room); bcast(room, { t: 'cfg', ...roomInfo(room) }); }
  });
});

/** GET /api/rooms: open games for the JOIN screen */
function listRooms() {
  return [...rooms.values()].filter(r => r.cfg.open && r.players.size > 0 && r.players.size < MAX).map(r => ({
    room: r.code, host: r.players.get(r.host)?.name ?? '?', players: r.players.size, bots: r.bots.size, map: r.cfg.map, state: r.state,
    frag: r.cfg.frag, time: r.cfg.time, mode: r.cfg.mode,
  }));
}

server.listen(PORT, '0.0.0.0', () => console.log(`ModernQUAKE server on http://0.0.0.0:${PORT}  (serving ${root})`));
