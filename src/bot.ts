import * as THREE from 'three';
import { buildFighter, Dressed } from './dress';
import { animate, holdWeapon, AnimState } from './anim';
import { Target, rayWorld } from './combat';
import { WeaponId } from './weapons';
import { boxes, botZones, BotZone } from './level';
import { TEAMS } from './teams';

// Arena bot: runs and strafes on the central platform, tracks the player, fires visible projectiles, dies and respawns.

export interface BotTarget { pos: THREE.Vector3; eye: THREE.Vector3; vel: THREE.Vector3 }
export interface BotCtx {
  player: BotTarget;
  /** multiplayer host: pick who this bot hunts (nearest human). Defaults to `player` */
  target?(b: Bot): BotTarget;
  fire(id: WeaponId, origin: THREE.Vector3, dir: THREE.Vector3, dmg: number, speedScale: number, owner: string, bot: Bot): void;
  /** by: who landed the killing blow ('' = local player in solo, otherwise a network id as text) */
  onKilled(b: Bot, by: string, weapon: string): void;
  onHit(b: Bot, dmg: number): void;
}
/** 0 easy · 1 normal · 2 hard */
const SKILL = {
  aim:  [2.6, 1.4, 0.55],     // random aim error (m at the target)
  lead: [0.35, 0.75, 0.95],   // how well they lead a moving target
  cool: [1.7, 1.0, 0.62],     // fire interval multiplier
  turn: [3.5, 7, 11],         // how fast they turn to face you
  range: [26, 38, 48],
};
/** per-weapon bot fire pattern */
const BOT_GUN: Partial<Record<WeaponId, { dmg: number; cd: number; jitter: number; speed: number }>> = {
  plasma: { dmg: 11, cd: 0.42, jitter: 0.3, speed: 28 },
  rocket: { dmg: 70, cd: 1.6, jitter: 0.6, speed: 20 },
  nailer: { dmg: 7, cd: 0.13, jitter: 0.06, speed: 40 },
};

// each bot roams one flat zone of the map (picked from its name, so bots spread over the zones)
const zoneFor = (name: string): BotZone => botZones[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % botZones.length];

function nameSprite(text: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d')!;
  x.font = '700 34px Rajdhani, "Segoe UI", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#' + color.toString(16).padStart(6, '0'); x.shadowBlur = 10; x.fillStyle = '#fff'; x.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false })); s.scale.set(1.5, 0.375, 1); return s;
}

export class Bot implements Target {
  id: string; pos = new THREE.Vector3(); vel = new THREE.Vector3(); radius = 0.42; height = 1.8; alive = true;
  health = 100; yaw = 0; private dest = new THREE.Vector2(); private destT = 0; private cooldown = 1; private deadT = 0; private pain = 0; private fireK = 0; private t = Math.random() * 10;
  private weapon: WeaponId; private muzzle!: THREE.Object3D; private fall = 0; private bar: THREE.Mesh; private rig!: Dressed;
  frags = 0;
  /** network id when the bot lives in an online room (0 offline) */
  netId = 0;
  skill = 1;
  /** 0 = free-for-all, 1 = RED, 2 = BLUE */
  team = 0;
  private lastBy = ''; private lastW = '';
  private zone: BotZone;

  constructor(public name: string, private rigP: Dressed, weapon: WeaponId, private ctx: BotCtx, private color: number) {
    this.id = name; this.weapon = weapon; this.rig = rigP; this.zone = zoneFor(name);
    animate(rigP, { t: 0, speed: 0, dead: 0, look: 0, pain: 0, fire: 0 });   // pose FIRST so the gun is aligned to the posed hand
    const g = holdWeapon(rigP, weapon); this.muzzle = (g as any).userData.muzzle;
    const label = nameSprite(name, color); label.position.set(0, 2.25, 0); rigP.root.add(label);
    this.bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.07), new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true })); this.bar.position.set(0, 2.08, 0); this.bar.renderOrder = 10; rigP.root.add(this.bar);
    this.respawn();
  }
  get root() { return this.rig.root; }

  respawn(far?: THREE.Vector3) {
    const Z = this.zone; let best: [number, number] = [Z.x0, Z.z0], bd = -1;
    for (let i = 0; i < 8; i++) {
      const s: [number, number] = [Z.x0 + 0.8 + Math.random() * (Z.x1 - Z.x0 - 1.6), Z.z0 + 0.8 + Math.random() * (Z.z1 - Z.z0 - 1.6)];
      const d = far ? Math.hypot(s[0] - far.x, s[1] - far.z) + Math.random() * 6 : Math.random(); if (d > bd) { bd = d; best = s; }
    }
    this.pos.set(best[0], Z.y, best[1]); this.vel.set(0, 0, 0); this.health = 100; this.alive = true; this.fall = 0; this.deadT = 0; this.destT = 0; this.cooldown = 1.2;
    this.root.visible = true; this.apply(0, 0);
  }

  /** by: attacker id ('' = local player); weapon: what hit us */
  hit(dmg: number, _from: THREE.Vector3, _dir: THREE.Vector3, kind: string, by = '', weapon = '') {
    if (!this.alive) return;
    this.lastBy = by; this.lastW = weapon || (kind === 'splash' ? '' : kind);
    this.health -= dmg; this.pain = 1; this.ctx.onHit(this, dmg);
    if (this.health <= 0) { this.alive = false; this.deadT = 0; this.ctx.onKilled(this, this.lastBy, this.lastW); }
  }
  /** for network snapshots */
  get weaponId() { return this.weapon; }
  get healthPct() { return Math.max(0, this.health); }

  private pickDest() {
    const p = this.ctx.player.pos;
    for (let i = 0; i < 8; i++) {
      const Z = this.zone, x = Z.x0 + Math.random() * (Z.x1 - Z.x0), z = Z.z0 + Math.random() * (Z.z1 - Z.z0);
      const dp = Math.hypot(x - p.x, z - p.z);
      if (dp > 5 && dp < 16) { this.dest.set(x, z); return; }
    }
    this.dest.set(this.zone.x0 + Math.random() * (this.zone.x1 - this.zone.x0), this.zone.z0 + Math.random() * (this.zone.z1 - this.zone.z0));
  }

  update(dt: number) {
    this.t += dt;
    const P = this.ctx.target ? this.ctx.target(this) : this.ctx.player;
    if (!this.alive) {
      this.deadT += dt; this.fall = Math.min(1, this.deadT * 2.2);
      if (this.deadT > 4.5) this.respawn(P.pos);
      this.apply(dt, 0); this.bar.visible = false; return;
    }
    // movement: head for the destination, repick regularly; keep ~5-14 m from the player
    this.destT -= dt;
    if (this.destT <= 0 || Math.hypot(this.dest.x - this.pos.x, this.dest.y - this.pos.z) < 0.8) { this.pickDest(); this.destT = 1.2 + Math.random() * 1.6; }
    const dx = this.dest.x - this.pos.x, dz = this.dest.y - this.pos.z, dl = Math.hypot(dx, dz) || 1;
    const want = new THREE.Vector3(dx / dl, 0, dz / dl).multiplyScalar(6.2 * (this.pain > 0.5 ? 0.6 : 1));
    this.vel.lerp(want, Math.min(1, dt * 6));
    this.pos.addScaledVector(this.vel, dt);
    const Z = this.zone;
    this.pos.x = Math.max(Z.x0, Math.min(Z.x1, this.pos.x)); this.pos.z = Math.max(Z.z0, Math.min(Z.z1, this.pos.z)); this.pos.y = Z.y;
    for (const b of boxes) {                        // push out of cover (pillars, low walls) standing on this floor
      if (b.max[1] < Z.y + 0.4 || b.min[1] > Z.y + 2) continue;
      if (b.max[0] - b.min[0] > 20) continue;
      const m = 0.45;
      if (this.pos.x > b.min[0] - m && this.pos.x < b.max[0] + m && this.pos.z > b.min[2] - m && this.pos.z < b.max[2] + m) {
        const l = this.pos.x - (b.min[0] - m), r = (b.max[0] + m) - this.pos.x, f = this.pos.z - (b.min[2] - m), k = (b.max[2] + m) - this.pos.z; const mn = Math.min(l, r, f, k);
        if (mn === l) this.pos.x = b.min[0] - m; else if (mn === r) this.pos.x = b.max[0] + m; else if (mn === f) this.pos.z = b.min[2] - m; else this.pos.z = b.max[2] + m;
      }
    }
    // face the player
    const ty = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * SKILL.turn[this.skill]);

    // shooting
    this.cooldown -= dt; this.fireK = Math.max(0, this.fireK - dt * 6); this.pain = Math.max(0, this.pain - dt * 3);
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z);
    const to = P.eye.clone().sub(eye); const dist = to.length();
    if (this.cooldown <= 0 && dist < SKILL.range[this.skill] && Math.abs(d) < 0.5) {
      const dirN = to.clone().normalize();
      const blocked = rayWorld(eye, dirN, dist - 0.5);
      if (!blocked) {
        const rocket = this.weapon === 'rocket';
        const gun = BOT_GUN[this.weapon] ?? BOT_GUN.plasma!;
        const lead = P.vel.clone().multiplyScalar((dist / gun.speed) * SKILL.lead[this.skill]);
        const target = (rocket ? P.pos.clone().add(new THREE.Vector3(0, 0.15, 0)) : P.eye.clone()).add(lead);
        const e = SKILL.aim[this.skill];
        target.add(new THREE.Vector3((Math.random() - .5) * e, (Math.random() - .5) * e * 0.6, (Math.random() - .5) * e));
        this.root.updateMatrixWorld(true);
        const o = this.muzzle.getWorldPosition(new THREE.Vector3());
        this.ctx.fire(this.weapon, o, target.sub(o).normalize(), gun.dmg, 0.72, this.netId ? String(this.netId) : this.name, this);
        this.cooldown = (gun.cd + Math.random() * gun.jitter) * SKILL.cool[this.skill]; this.fireK = 1;
      } else this.cooldown = 0.2;
    }
    this.apply(dt, Math.min(1, this.vel.length() / 6.2));
    const hp = Math.max(0.02, this.health / 100); this.bar.scale.x = hp; this.bar.position.x = (hp - 1) * 0.5; this.bar.visible = true;
    (this.bar.material as THREE.MeshBasicMaterial).color.setHex(hp > 0.5 ? 0x3dff7a : hp > 0.25 ? 0xffc02d : 0xff4040);
  }

  private apply(dt: number, speed: number) {
    void dt;
    const st: AnimState = { t: this.t, speed, dead: this.fall, look: 0, pain: this.pain, fire: this.fireK };
    this.root.position.x = this.pos.x; this.root.position.z = this.pos.z;
    this.root.rotation.y = this.yaw;
    animate(this.rig, st);
    this.root.position.y = this.pos.y + this.root.position.y;   // animate() writes bob into position.y
    this.root.position.x = this.pos.x; this.root.position.z = this.pos.z;
  }
}

export interface BotDef { name: string; weapon: WeaponId; color: number; netId?: number; team?: number }
/** the solo roster (online rooms get theirs from the server, same names) */
export const BOT_ROSTER: BotDef[] = [
  { name: 'RAZOR', weapon: 'plasma', color: 0xff4a3a }, { name: 'VEX', weapon: 'plasma', color: 0xff2fa0 },
  { name: 'KRAIT', weapon: 'rocket', color: 0xffb02e }, { name: 'NYX', weapon: 'nailer', color: 0x7dff6a },
  { name: 'ONYX', weapon: 'plasma', color: 0xb08cff }, { name: 'HEX', weapon: 'rocket', color: 0x2effd0 },
  { name: 'MORROW', weapon: 'nailer', color: 0x35d0ff }, { name: 'ZOLA', weapon: 'plasma', color: 0xffffff },
];
const FEMALE = new Set(['VEX', 'NYX', 'ZOLA', 'HEX']);

export async function spawnBot(parent: THREE.Object3D, ctx: BotCtx, d: BotDef, skill: number): Promise<Bot> {
  const t = TEAMS[d.team ?? 0];
  const rig = await buildFighter(FEMALE.has(d.name) ? 'female' : 'male', t ? t.hex : d.color, t ? t.armor : undefined, t ? t.suit : undefined); parent.add(rig.root);
  const b = new Bot(d.name, rig, d.weapon, ctx, t ? t.hex : d.color); b.netId = d.netId ?? 0; b.skill = Math.max(0, Math.min(2, skill)); b.team = d.team ?? 0; return b;
}
export async function spawnBots(parent: THREE.Object3D, ctx: BotCtx, defs: BotDef[], skill = 1): Promise<Bot[]> {
  return Promise.all(defs.map(d => spawnBot(parent, ctx, d, skill)));
}
/** remove a bot's model from the scene */
export function disposeBot(b: Bot) { b.root.removeFromParent(); b.alive = false; }
