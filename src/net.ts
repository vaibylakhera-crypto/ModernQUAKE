import * as THREE from 'three';
import { buildFighter, Dressed } from './dress';
import { animate, holdWeapon, AnimState } from './anim';
import { Target } from './combat';
import { WeaponId } from './weapons';

// Online play: a tiny room server relays state. Each client simulates itself; shooters report hitscan hits, victims apply projectile damage.

export interface PlayerInfo { id: number; name: string; color: number; frags: number; deaths: number; bot?: boolean; weapon?: WeaponId }
/** match settings chosen by the host (or for a solo game) */
export interface MatchCfg { map: string; bots: number; skill: number; frag: number; time: number; open?: boolean }
/** everything the server says about a room */
export interface RoomInfo { room: string; host: number; cfg: MatchCfg; state: 'lobby' | 'playing' | 'ended'; endsAt: number; now: number; players: PlayerInfo[] }
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
  private tPos = new THREE.Vector3(); private tYaw = 0; private yaw = 0; private t = Math.random() * 10; private speed = 0; private fall = 0; private fireK = 0; private first = true;
  hp = 100;
  constructor(public info: PlayerInfo, private parent: THREE.Object3D, private sendHit: (to: number, dmg: number, dir: THREE.Vector3, kind: string) => void) {
    this.id = 'p' + info.id;
    if (info.weapon) this.weapon = info.weapon;
    buildFighter(info.id % 2 ? 'male' : 'female', info.color).then(rig => {
      this.rig = rig; parent.add(rig.root);
      const label = nameSprite(info.name, info.color); label.position.set(0, 2.25, 0); rig.root.add(label);
      animate(rig, { t: 0, speed: 0, dead: 0, look: 0, pain: 0, fire: 0 }); this.holder = holdWeapon(rig, this.weapon); this.apply();
    });
  }
  setWeapon(w: WeaponId) {
    if (w === this.weapon) return; this.weapon = w;
    if (!this.rig) return; this.holder?.removeFromParent(); this.holder = holdWeapon(this.rig, w);
  }
  setState(p: number[], yawPlayer: number, w: WeaponId, hp: number, dead: boolean) {
    this.tPos.set(p[0], p[1], p[2]); this.tYaw = yawPlayer + Math.PI; this.hp = hp; this.alive = !dead; this.setWeapon(w);
    if (this.first) { this.pos.copy(this.tPos); this.yaw = this.tYaw; this.first = false; }
  }
  flashFire() { this.fireK = 1; }
  hit(dmg: number, _from: THREE.Vector3, dir: THREE.Vector3, kind: string) { if (!PROJECTILE_KINDS.has(kind)) this.sendHit(this.info.id, dmg, dir, kind); }
  update(dt: number) {
    const bx = this.pos.x, bz = this.pos.z;
    this.pos.lerp(this.tPos, Math.min(1, dt * 14));
    let d = this.tYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * 14);
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
  end(board: PlayerInfo[], winner: number, why: string, next: number): void;
  host(id: number): void;
  bots(list: { id: number; p: number[]; yaw: number; w: WeaponId; hp: number; dead: boolean }[]): void;
  bothit(from: number, to: number, dmg: number, dir: number[], kind: string): void;
  state(id: number, m: any): void; fire(id: number, m: any): void;
  hit(from: number, dmg: number, dir: number[], kind: string): void;
  killed(id: number, by: number, board: PlayerInfo[], weapon?: string): void;
  status(s: 'connecting' | 'online' | 'offline' | 'full'): void;
}

export class Net {
  ws: WebSocket | null = null; id = 0; online = false; private acc = 0;
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
    this.ev.status('connecting');
    const ws = new WebSocket(Net.url(room, name, map, cfg)); this.ws = ws;
    ws.onopen = () => { this.online = true; };
    ws.onclose = () => { if (this.online) this.ev.status('offline'); this.online = false; };
    ws.onerror = () => { if (!this.online) this.ev.status('offline'); };
    ws.onmessage = e => {
      let m: any; try { m = JSON.parse(e.data); } catch { return; }
      switch (m.t) {
        case 'welcome': this.id = m.id; this.ev.status('online'); this.ev.welcome(m.id, m); break;
        case 'full': this.ev.status('full'); break;
        case 'join': this.ev.join(m.player, m.host); break;
        case 'cfg': case 'start': case 'lobby': this.ev.room(m.t, m); break;
        case 'end': this.ev.end(m.board, m.winner, m.why, m.next); break;
        case 'host': this.ev.host(m.host); break;
        case 'bots': this.ev.bots(m.l); break;
        case 'bothit': this.ev.bothit(m.from, m.to, m.dmg, m.dir, m.kind); break;
        case 'leave': this.ev.leave(m.id); break;
        case 'state': this.ev.state(m.id, m); break;
        case 'fire': this.ev.fire(m.id, m); break;
        case 'hit': this.ev.hit(m.from, m.dmg, m.dir, m.kind); break;
        case 'killed': this.ev.killed(m.id, m.by, m.board, typeof m.w === 'string' ? m.w : ''); break;
      }
    };
  }
  send(o: object) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  /** throttled to ~20 Hz */
  sendState(dt: number, o: { p: number[]; yaw: number; pitch: number; w: string; hp: number; dead: boolean }) {
    this.acc += dt; if (this.acc < 0.05) return; this.acc = 0;
    this.send({ t: 'state', p: o.p.map(v => Math.round(v * 100) / 100), yaw: Math.round(o.yaw * 1000) / 1000, pitch: Math.round(o.pitch * 1000) / 1000, w: o.w, hp: Math.round(o.hp), dead: o.dead });
  }
}
