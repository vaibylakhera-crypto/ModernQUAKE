import * as THREE from 'three';
import { buildFighter, Dressed } from './dress';
import { animate, holdWeapon, AnimState } from './anim';
import { Target, rayWorld } from './combat';
import { WeaponId } from './weapons';
import { boxes } from './level';

// Arena bot: runs and strafes on the central platform, tracks the player, fires visible projectiles, dies and respawns.

export interface BotCtx {
  player: { pos: THREE.Vector3; eye: THREE.Vector3; vel: THREE.Vector3 };
  fire(id: WeaponId, origin: THREE.Vector3, dir: THREE.Vector3, dmg: number, speedScale: number): void;
  onKilled(b: Bot): void;
  onHit(b: Bot, dmg: number): void;
}

const ARENA = 13.2;
const SPAWNS: [number, number][] = [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, -13], [0, 13], [-13, 0], [13, 0]];

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

  constructor(public name: string, private rigP: Dressed, weapon: WeaponId, private ctx: BotCtx, private color: number) {
    this.id = name; this.weapon = weapon; this.rig = rigP;
    animate(rigP, { t: 0, speed: 0, dead: 0, look: 0, pain: 0, fire: 0 });   // pose FIRST so the gun is aligned to the posed hand
    const g = holdWeapon(rigP, weapon); this.muzzle = (g as any).userData.muzzle;
    const label = nameSprite(name, color); label.position.set(0, 2.25, 0); rigP.root.add(label);
    this.bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.07), new THREE.MeshBasicMaterial({ color: 0x3dff7a, depthTest: false, transparent: true })); this.bar.position.set(0, 2.08, 0); this.bar.renderOrder = 10; rigP.root.add(this.bar);
    this.respawn();
  }
  get root() { return this.rig.root; }

  respawn(far?: THREE.Vector3) {
    let best = SPAWNS[0], bd = -1;
    for (const s of SPAWNS) { const d = far ? Math.hypot(s[0] - far.x, s[1] - far.z) + Math.random() * 6 : Math.random(); if (d > bd) { bd = d; best = s; } }
    this.pos.set(best[0], 0, best[1]); this.vel.set(0, 0, 0); this.health = 100; this.alive = true; this.fall = 0; this.deadT = 0; this.destT = 0; this.cooldown = 1.2;
    this.root.visible = true; this.apply(0, 0);
  }

  hit(dmg: number, _from: THREE.Vector3, _dir: THREE.Vector3, _kind: string) {
    if (!this.alive) return;
    this.health -= dmg; this.pain = 1; this.ctx.onHit(this, dmg);
    if (this.health <= 0) { this.alive = false; this.deadT = 0; this.ctx.onKilled(this); }
  }

  private pickDest() {
    const p = this.ctx.player.pos;
    for (let i = 0; i < 8; i++) {
      const x = (Math.random() * 2 - 1) * ARENA, z = (Math.random() * 2 - 1) * ARENA;
      const dp = Math.hypot(x - p.x, z - p.z);
      if (dp > 5 && dp < 16) { this.dest.set(x, z); return; }
    }
    this.dest.set((Math.random() * 2 - 1) * ARENA, (Math.random() * 2 - 1) * ARENA);
  }

  update(dt: number) {
    this.t += dt;
    const P = this.ctx.player;
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
    this.pos.x = Math.max(-ARENA, Math.min(ARENA, this.pos.x)); this.pos.z = Math.max(-ARENA, Math.min(ARENA, this.pos.z));
    for (const b of boxes) {                        // push out of cover (pillars, crate wall)
      if (b.max[1] < 0.4 || b.min[1] > 2 || b.max[1] > 6 && b.min[1] > 0.5) continue;
      if (b.max[0] - b.min[0] > 20) continue;
      const m = 0.45;
      if (this.pos.x > b.min[0] - m && this.pos.x < b.max[0] + m && this.pos.z > b.min[2] - m && this.pos.z < b.max[2] + m) {
        const l = this.pos.x - (b.min[0] - m), r = (b.max[0] + m) - this.pos.x, f = this.pos.z - (b.min[2] - m), k = (b.max[2] + m) - this.pos.z; const mn = Math.min(l, r, f, k);
        if (mn === l) this.pos.x = b.min[0] - m; else if (mn === r) this.pos.x = b.max[0] + m; else if (mn === f) this.pos.z = b.min[2] - m; else this.pos.z = b.max[2] + m;
      }
    }
    // face the player
    const ty = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
    let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * 7);

    // shooting
    this.cooldown -= dt; this.fireK = Math.max(0, this.fireK - dt * 6); this.pain = Math.max(0, this.pain - dt * 3);
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z);
    const to = P.eye.clone().sub(eye); const dist = to.length();
    if (this.cooldown <= 0 && dist < 38 && Math.abs(d) < 0.5) {
      const dirN = to.clone().normalize();
      const blocked = rayWorld(eye, dirN, dist - 0.5);
      if (!blocked) {
        const rocket = this.weapon === 'rocket';
        const speed = rocket ? 20 : 28;
        const lead = P.vel.clone().multiplyScalar((dist / speed) * 0.75);
        const target = (rocket ? P.pos.clone().add(new THREE.Vector3(0, 0.15, 0)) : P.eye.clone()).add(lead);
        target.add(new THREE.Vector3((Math.random() - .5) * 1.4, (Math.random() - .5) * 0.8, (Math.random() - .5) * 1.4));
        this.root.updateMatrixWorld(true);
        const o = this.muzzle.getWorldPosition(new THREE.Vector3());
        this.ctx.fire(this.weapon, o, target.sub(o).normalize(), rocket ? 70 : 11, 0.72);
        this.cooldown = rocket ? 1.6 + Math.random() * 0.6 : 0.42 + Math.random() * 0.3; this.fireK = 1;
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

export async function spawnBots(parent: THREE.Object3D, ctx: BotCtx): Promise<Bot[]> {
  const defs: { name: string; g: 'male' | 'female'; w: WeaponId; c: number }[] = [
    { name: 'RAZOR', g: 'male', w: 'plasma', c: 0xff4a3a },
    { name: 'VEX', g: 'female', w: 'plasma', c: 0xff2fa0 },
    { name: 'KRAIT', g: 'male', w: 'rocket', c: 0xffb02e },
  ];
  const bots: Bot[] = [];
  for (const d of defs) {
    const rig = await buildFighter(d.g, d.c); parent.add(rig.root);
    bots.push(new Bot(d.name, rig, d.w, ctx, d.c));
  }
  return bots;
}
