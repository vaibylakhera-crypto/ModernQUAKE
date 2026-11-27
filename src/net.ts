import * as THREE from 'three';
import { buildFighter, Dressed } from './dress';
import { animate, holdWeapon, AnimState } from './anim';
import { Target } from './combat';
import { WeaponId } from './weapons';
import { TEAMS } from './teams';

// Online play: a tiny room server relays state. Each client simulates itself; shooters report hitscan hits, victims apply projectile damage.

export interface PlayerInfo { id: number; name: string; color: number; team?: number; frags: number; deaths: number; bot?: boolean; weapon?: WeaponId }
/** match settings chosen by the host (or for a solo game) */
export interface MatchCfg { map: string; mode: string; bots: number; skill: number; frag: number; caps: number; time: number; open?: boolean }
export interface FlagState { s: 'base' | 'carried' | 'dropped'; c: number; p: number[] | null }
/** everything the server says about a room */
export interface RoomInfo { room: string; host: number; cfg: MatchCfg; state: 'lobby' | 'playing' | 'ended'; endsAt: number; now: number; players: PlayerInfo[]; ts: { 1: number; 2: number }; flags: { 1: FlagState; 2: FlagState } }
const INTERP_MS = 100;       // other players are drawn this far in the past (smoothness vs latency)
const PROJECTILE_KINDS = new Set(['nailer', 'rocket', 'plasma', 'splash']);   // victim applies these locally from the replicated projectile

function nameSprite(text: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d')!;
  x.font = '700 34px Rajdhani, "Segoe UI", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#' + color.toString(16).padStart(6, '0'); x.shadowBlur = 10; x.fillStyle = '#fff'; x.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false })); s.scale.set(1.5, 0.375, 1); return s;
}

export class RemotePlayer implements Target {
  id: string; pos = new THREE.Vector3(); radius = 0.42; height = 1.8; alive = true;
  private rig: Dressed | null = null; private holder: THREE.Object3D | null = null; private weapon: WeaponId = 'pistol';
  private yaw = 0; private t = Math.random() * 10; private speed = 0; private fall = 0; private fireK = 0; private first = true;
  hp = 100;
  constructor(public info: PlayerInfo, private parent: THREE.Object3D, private sendHit: (to: number, dmg: number, dir: THREE.Vector3, kind: string) => void) {
    this.id = 'p' + info.id;
    if (info.weapon) this.weapon = info.weapon;
    this.build();
  }
  get team() { return this.info.team ?? 0; }
  private gen = 0;
  /** (re)creates the 3D character: team modes dress everyone in red or blue armour */
  private build() {
    const my = ++this.gen, info = this.info, t = TEAMS[info.team ?? 0];
    buildFighter(info.id % 2 ? 'male' : 'female', t ? t.hex : info.color, t ? t.armor : undefined, t ? t.suit : undefined).then(rig => {
      if (my !== this.gen) return;                                   // a newer build (team changed) replaced this one
      this.rig?.root.removeFromParent();
      this.rig = rig; this.parent.add(rig.root);
      const label = nameSprite(info.name, t ? t.hex : info.color); label.position.set(0, 2.25, 0); rig.root.add(label); this.label = label;
      animate(rig, { t: 0, speed: 0, dead: 0, look: 0, pain: 0, fire: 0 }); this.holder = holdWeapon(rig, this.weapon); this.apply();
    });
  }
  /** the player moved to another team: new outfit and name colour */
  setTeam(team: number) { if ((this.info.team ?? 0) === team) return; this.info.team = team; this.build(); }
  setWeapon(w: WeaponId) {
    if (w === this.weapon) return; this.weapon = w;
    if (!this.rig) return; this.holder?.removeFromParent(); this.holder = holdWeapon(this.rig, w);
  }
  setState(p: number[], yawPlayer: number, w: WeaponId, hp: number, dead: boolean, v?: number[]) {
    const yaw = yawPlayer + Math.PI, last = this.snaps[this.snaps.length - 1];
    // teleported / respawned: start a fresh history so the character jumps instead of sliding across the map
    if (last && Math.hypot(p[0] - last.x, p[2] - last.z) + Math.abs(p[1] - last.y) > 6) this.snaps.length = 0;
    { // adapt the display delay to how steady this player's updates arrive: calm link = low delay, jittery link = more cushion
      const now = performance.now(), gap = last ? now - last.t : 0;
      if (last && gap < 600) { this.gapEma += (gap - this.gapEma) * 0.1; this.gapDev += (Math.abs(gap - this.gapEma) - this.gapDev) * 0.1; this.interp += (Math.max(80, Math.min(190, this.gapEma + 3 * this.gapDev + 45)) - this.interp) * 0.05; }
    }
    this.snaps.push({ t: performance.now(), x: p[0], y: p[1], z: p[2], yaw, vx: v?.[0], vz: v?.[1] }); if (this.snaps.length > 20) this.snaps.shift();
    this.hp = hp; this.alive = !dead; this.setWeapon(w);
    if (this.first) { this.pos.set(p[0], p[1], p[2]); this.yaw = yaw; this.first = false; }
  }
  /** recent position snapshots (arrival time + state): drawn ~100 ms in the past so there are always two real samples to blend */
  private gapEma = 33; private gapDev = 5; private interp = INTERP_MS;
  private snaps: { t: number; x: number; y: number; z: number; yaw: number; vx?: number; vz?: number }[] = [];
  /** where this player really was when it last fired: while shooting it is drawn there, so its bullets start at it */
  private pin: { x: number; z: number; t: number } | null = null;
  fireFrom(o: THREE.Vector3) { this.pin = { x: o.x, z: o.z, t: performance.now() }; }
  /** the position / facing to show right now, from the snapshot history */
  private sample() {
    const S = this.snaps; if (!S.length) return;
    const rt = performance.now() - this.interp, n = S.length, newest = S[n - 1];
    let x: number, y: number, z: number, yaw: number;
    if (rt >= newest.t) {                                         // the data is late: coast on the last velocity (up to 400 ms, fading out)
      const prev = S[n - 2] ?? newest, span = Math.max(1, newest.t - prev.t), age = Math.min(400, rt - newest.t) / 1000;
      const vx = newest.vx ?? (newest.x - prev.x) / span * 1000, vz = newest.vz ?? (newest.z - prev.z) / span * 1000, fade = Math.max(0, 1 - age / 0.5);
      x = newest.x + vx * age * fade; z = newest.z + vz * age * fade; y = newest.y; yaw = newest.yaw;
    } else if (rt <= S[0].t) { x = S[0].x; y = S[0].y; z = S[0].z; yaw = S[0].yaw; }
    else {
      let i = 0; while (i < n - 2 && S[i + 1].t <= rt) i++;
      const a = S[i], b = S[i + 1], k = (rt - a.t) / Math.max(1, b.t - a.t);
      x = a.x + (b.x - a.x) * k; y = a.y + (b.y - a.y) * k; z = a.z + (b.z - a.z) * k;
      let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yaw = a.yaw + dy * k;
    }
    if (this.pin) {                                               // just fired: pull toward where the shot really came from, easing off over 250 ms
      const a = performance.now() - this.pin.t;
      if (a > 250) this.pin = null; else { const k = (1 - a / 250) * 0.9; x += (this.pin.x - x) * k; z += (this.pin.z - z) * k; }
    }
    this.pos.set(x, y, z); this.yaw = yaw;
  }
  flashFire() { this.fireK = 1; }
  private label: THREE.Sprite | null = null;
  /** the player changed their name mid-game: redraw the tag over their head */
  rename(name: string) {
    this.info.name = name; if (!this.label || !this.rig) return;
    const old = this.label; const nl = nameSprite(name, this.info.color); nl.position.copy(old.position);
    this.rig.root.add(nl); old.removeFromParent(); (old.material as THREE.SpriteMaterial).map?.dispose(); this.label = nl;
  }
  hit(dmg: number, _from: THREE.Vector3, dir: THREE.Vector3, kind: string) { if (!PROJECTILE_KINDS.has(kind)) this.sendHit(this.info.id, dmg, dir, kind); }
  update(dt: number) {
    const bx = this.pos.x, bz = this.pos.z;
    this.sample();
    const v = Math.hypot(this.pos.x - bx, this.pos.z - bz) / Math.max(dt, 1e-3) / 8;
    this.speed += (Math.min(1, v) - this.speed) * Math.min(1, dt * 8);
    this.t += dt; this.fireK = Math.max(0, this.fireK - dt * 6);
    this.fall += ((this.alive ? 0 : 1) - this.fall) * Math.min(1, dt * 6);
    this.apply();
  }
  private apply() {
    const r = this.rig; if (!r) return;
    const st: AnimState = { t: this.t, speed: this.speed, dead: this.fall, look: 0, pain: 0, fire: this.fireK };
    r.root.position.x = this.pos.x; r.root.position.z = this.pos.z; r.root.rotation.y = this.yaw;
    animate(r, st); r.root.position.y = this.pos.y + r.root.position.y; r.root.position.x = this.pos.x; r.root.position.z = this.pos.z;
  }
  dispose() { this.rig?.root.removeFromParent(); }
}

export interface NetEvents {
  welcome(id: number, info: RoomInfo): void;
  join(p: PlayerInfo, host: number): void; leave(id: number): void;
  room(kind: 'cfg' | 'start' | 'lobby', info: RoomInfo): void;
  end(board: PlayerInfo[], winner: number, why: string, next: number, team?: number, ts?: { 1: number; 2: number }): void;
  flags(flags: { 1: FlagState; 2: FlagState }, ts: { 1: number; 2: number }, ev: any): void;
  chat(from: number, to: string, k: string, txt: string): void;
  rtc(from: number, d: any): void;
  talk(id: number, on: boolean): void;
  host(id: number): void;
  board(b: PlayerInfo[]): void;
  bots(list: { id: number; p: number[]; yaw: number; w: WeaponId; hp: number; dead: boolean; v?: number[] }[]): void;
  bothit(from: number, to: number, dmg: number, dir: number[], kind: string): void;
  renamed(id: number, name: string, board: PlayerInfo[]): void;
  state(id: number, m: any): void; fire(id: number, m: any): void;
  hit(from: number, dmg: number, dir: number[], kind: string): void;
  killed(id: number, by: number, board: PlayerInfo[], weapon?: string, ts?: { 1: number; 2: number }, cap?: boolean): void;
  status(s: 'connecting' | 'online' | 'offline' | 'full'): void;
}

export class Net {
  ws: WebSocket | null = null; id = 0; online = false; private acc = 0;
  /** auto-reconnect: remembers the room so a dropped connection (phone locked, app switched) comes straight back */
  private params: [string, string, string, MatchCfg | undefined] | null = null; private wantOnline = false; private tries = 0; private retryT = 0;
  /** round-trip time to the server in ms (0 until the first reply) */
  ping = 0; private pingTimer = 0;
  constructor(private ev: NetEvents) {}
  static url(room: string, name: string, map = 'boreal', cfg?: MatchCfg): string {
    const override = new URLSearchParams(location.search).get('server');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const base = override ? (/^wss?:/.test(override) ? override : `${proto}://${override}`) : `${proto}://${location.port === '5173' ? `${location.hostname}:8080` : location.host}`;
    return `${base}/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(name)}&map=${map}${cfg ? `&cfg=${encodeURIComponent(JSON.stringify(cfg))}` : ''}`;
  }
  /** the server base URL for http calls (open games list) */
  static httpBase(): string {
    const override = new URLSearchParams(location.search).get('server');
    if (override) return /^https?:/.test(override) ? override : `${location.protocol}//${override.replace(/^wss?:\/\//, '')}`;
    return location.port === '5173' ? `${location.protocol}//${location.hostname}:8080` : '';
  }
  connect(room: string, name: string, map = 'boreal', cfg?: MatchCfg) {
    this.params = [room, name, map, cfg]; this.wantOnline = true; this.tries = 0; this.open();
    if (!this.visHooked) { this.visHooked = true; document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.wantOnline && !this.online) { clearTimeout(this.retryT); this.open(); } }); }
  }
  private visHooked = false;
  /** leave for good: no more reconnect attempts */
  disconnect() { this.wantOnline = false; clearTimeout(this.retryT); this.ws?.close(); }
  private open() {
    if (!this.params) return; const [room, name, map, cfg0] = this.params;
    // after the first connect the room exists (or is kept for a while): rejoin it without re-sending the creation settings
    const cfg = this.tries === 0 ? cfg0 : undefined;
    this.ev.status('connecting'); this.ws?.close();
    const ws = new WebSocket(Net.url(room, name, map, cfg)); this.ws = ws;
    ws.onopen = () => { this.online = true; clearInterval(this.pingTimer); this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000); };
    ws.onclose = () => {
      if (ws !== this.ws) return;                                // an old socket we replaced
      clearInterval(this.pingTimer); const was = this.online; this.online = false;
      if (this.wantOnline && this.tries < 15) { this.tries++; this.ev.status('connecting'); clearTimeout(this.retryT); this.retryT = window.setTimeout(() => this.open(), Math.min(4000, 600 * this.tries)); }
      else if (was) this.ev.status('offline');
    };
    ws.onerror = () => { /* onclose follows and decides what to do */ };
    ws.onmessage = e => {
      let m: any; try { m = JSON.parse(e.data); } catch { return; }
      switch (m.t) {
        case 'welcome': this.tries = 0; this.id = m.id; this.ev.status('online'); this.ev.welcome(m.id, m); break;
        case 'full': this.ev.status('full'); break;
        case 'join': this.ev.join(m.player, m.host); break;
        case 'cfg': case 'start': case 'lobby': this.ev.room(m.t, m); break;
        case 'end': this.ev.end(m.board, m.winner, m.why, m.next, m.team, m.ts); break;
        case 'flags': this.ev.flags(m.flags, m.ts, m.ev); break;
        case 'chat': this.ev.chat(m.from, m.to, m.k || '', m.txt || ''); break;
        case 'rtc': this.ev.rtc(m.from, m.d); break;
        case 'talk': this.ev.talk(m.id, !!m.on); break;
        case 'pong': this.ping = Math.round(performance.now() - m.c); break;
        case 'host': this.ev.host(m.host); break;
        case 'board': this.ev.board(m.board); break;
        case 'bots': this.ev.bots(m.l); break;
        case 'bothit': this.ev.bothit(m.from, m.to, m.dmg, m.dir, m.kind); break;
        case 'renamed': this.ev.renamed(m.id, m.name, m.board); break;
        case 'leave': this.ev.leave(m.id); break;
        case 'state': this.ev.state(m.id, m); break;
        case 'states': for (const e of m.l as any[]) if (e && e.id !== this.id) this.ev.state(e.id, e); break;
        case 'fire': this.ev.fire(m.id, m); break;
        case 'hit': this.ev.hit(m.from, m.dmg, m.dir, m.kind); break;
        case 'killed': this.ev.killed(m.id, m.by, m.board, typeof m.w === 'string' ? m.w : '', m.ts, !!m.cap); break;
      }
    };
  }
  send(o: object) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  /** throttled to ~20 Hz */
  sendState(dt: number, o: { p: number[]; yaw: number; pitch: number; w: string; hp: number; dead: boolean }) {
    this.acc += dt; if (this.acc < 0.033) return; this.acc = 0;       // ~30 updates per second
    this.send({ t: 'state', p: o.p.map(v => Math.round(v * 100) / 100), yaw: Math.round(o.yaw * 1000) / 1000, pitch: Math.round(o.pitch * 1000) / 1000, w: o.w, hp: Math.round(o.hp), dead: o.dead });
  }
}
