import * as THREE from 'three';
import { buildFighter, Dressed } from './dress';
import { animate, holdWeapon, AnimState } from './anim';
import { Target, rayWorld } from './combat';
import { WeaponId } from './weapons';
import { pickups, pads, teleporters, spawns, liftBoxes, BOUNCE_VY, GRAVITY, jumpPadVelocity, PickupDef } from './level';
import { buildNav, nodes, itemNode, nearestNode, dijkstra, pathTo, groundAt, blockedAt } from './nav';
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
  /** pickups: is item i available, and take it (returns what it was) */
  itemActive?(i: number): boolean;
  claimItem?(i: number): PickupDef | null;
  /** projectiles that could hit a bot soon (for dodging) */
  incoming?(p: THREE.Vector3, owner: string): { pos: THREE.Vector3; vel: THREE.Vector3; splash: number }[];
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
function nameSprite(text: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d')!;
  x.font = '700 34px Rajdhani, "Segoe UI", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#' + color.toString(16).padStart(6, '0'); x.shadowBlur = 10; x.fillStyle = '#fff'; x.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false })); s.scale.set(1.5, 0.375, 1); return s;
}

const BOT_WEAPONS = new Set<WeaponId>(['plasma', 'rocket', 'nailer']);      // bots only use projectile weapons
const SPEED = 6.2;

export class Bot implements Target {
  id: string; pos = new THREE.Vector3(); vel = new THREE.Vector3(); radius = 0.42; height = 1.8; alive = true;
  health = 100; armor = 0; yaw = 0; vy = 0; grounded = true;
  private cooldown = 1; private deadT = 0; private pain = 0; private fireK = 0; private t = Math.random() * 10;
  private weapon: WeaponId; private muzzle!: THREE.Object3D; private holder!: THREE.Object3D; private fall = 0; private bar: THREE.Mesh; private rig!: Dressed;
  frags = 0;
  /** network id when the bot lives in an online room (0 offline) */
  netId = 0;
  skill = 1;
  /** 0 = free-for-all, 1 = RED, 2 = BLUE */
  team = 0;
  private lastBy = ''; private lastW = '';
  // brain
  private path: number[] = []; private pi = 0; private brainT = Math.random() * 0.4; private dodgeCheckT = 0;
  private seen = false; private strafe = Math.random() < 0.5 ? 1 : -1; private strafeT = 0;
  private dodgeT = 0; private dodgeDir = new THREE.Vector3(); private padCool = 0; private tpCool = 0; private collectT = 0;
  private stuckT = 0; private stuckAt = new THREE.Vector3(); private haste = 0; private od = 0;
  private want = new THREE.Vector3();

  constructor(public name: string, private rigP: Dressed, weapon: WeaponId, private ctx: BotCtx, private color: number) {
    this.id = name; this.weapon = weapon; this.rig = rigP;
    animate(rigP, { t: 0, speed: 0, dead: 0, look: 0, pain: 0, fire: 0 });   // pose FIRST so the gun is aligned to the posed hand
    this.holder = holdWeapon(rigP, weapon); this.muzzle = (this.holder as any).userData.muzzle;
    const label = nameSprite(name, color); label.position.set(0, 2.25, 0); rigP.root.add(label);
    this.bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.07), new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true })); this.bar.position.set(0, 2.08, 0); this.bar.renderOrder = 10; rigP.root.add(this.bar);
    this.respawn();
  }
  get root() { return this.rig.root; }
  get weaponId() { return this.weapon; }
  get healthPct() { return Math.max(0, this.health); }
  /** rider adapter so the lift system can carry a bot standing on a lift */
  get rider() { const b = this; return { get x() { return b.pos.x; }, get z() { return b.pos.z; }, get y() { return b.pos.y; }, set y(v: number) { b.pos.y = v; }, get vy() { return b.vy; }, set vy(v: number) { b.vy = v; } }; }

  /** spawn at a random floor point near one of the map's spawn points, preferring the one farthest from `far` */
  respawn(far?: THREE.Vector3) {
    buildNav();
    let sp = spawns[Math.floor(Math.random() * spawns.length)];
    if (far) { let bd = -1; for (const s of spawns) { const d = Math.hypot(s.pos[0] - far.x, s.pos[2] - far.z) + Math.random() * 8; if (d > bd) { bd = d; sp = s; } } }
    const cand = nodes.filter(n => n.kind === 'floor' && Math.abs(n.y - sp.pos[1]) < 0.3 && Math.hypot(n.x - sp.pos[0], n.z - sp.pos[2]) < 10);
    const n = cand.length ? cand[Math.floor(Math.random() * cand.length)] : { x: sp.pos[0], y: sp.pos[1], z: sp.pos[2] };
    this.pos.set(n.x, n.y, n.z); this.vel.set(0, 0, 0); this.vy = 0; this.grounded = true;
    this.health = 100; this.armor = 0; this.haste = this.od = 0; this.alive = true; this.fall = 0; this.deadT = 0; this.cooldown = 1.2; this.path = []; this.brainT = Math.random() * 0.3;
    this.root.visible = true; this.apply(0, 0);
  }

  /** by: attacker id ('' = local player); weapon: what hit us */
  hit(dmg: number, _from: THREE.Vector3, _dir: THREE.Vector3, kind: string, by = '', weapon = '') {
    if (!this.alive) return;
    this.lastBy = by; this.lastW = weapon || (kind === 'splash' ? '' : kind);
    const soak = Math.min(this.armor, dmg * (2 / 3)); this.armor -= soak;                 // armour soaks two thirds, like the player's
    this.health -= dmg - soak; this.pain = 1; this.ctx.onHit(this, dmg);
    if (this.health <= 0) { this.alive = false; this.deadT = 0; this.ctx.onKilled(this, this.lastBy, this.lastW); }
  }
  setWeapon(w: WeaponId) {
    if (w === this.weapon) return; this.weapon = w; this.holder.removeFromParent();
    this.holder = holdWeapon(this.rig, w); this.muzzle = (this.holder as any).userData.muzzle;
  }

  // ───── what the bot wants right now ─────
  private itemValue(def: PickupDef): number {
    switch (def.kind) {
      case 'health': return Math.max(0, 100 - this.health) * 0.5 + (this.health < 40 ? 40 : 0);
      case 'armor': return Math.max(0, 100 - this.armor) * 0.18;
      case 'weapon': return BOT_WEAPONS.has(def.id) && def.id !== this.weapon ? (def.id === 'rocket' ? 22 : 14) : 0;
      case 'booster':
        if (def.id === 'overdrive') return 22; if (def.id === 'haste') return 13;
        if (def.id === 'mega') return this.health < 150 ? 12 + (100 - Math.min(100, this.health)) * 0.3 : 0;
        if (def.id === 'shield') return this.armor < 150 ? 12 : 0; if (def.id === 'regen') return this.health < 100 ? 10 : 0; return 0;
    }
  }
  private think(P: BotTarget) {
    buildNav();
    const cur = nearestNode(this.pos.x, this.pos.y, this.pos.z, 8, true); if (cur < 0) { this.path = []; return; }
    const { dist, prev } = dijkstra(cur);
    const dxe = P.pos.x - this.pos.x, dze = P.pos.z - this.pos.z, dE = Math.hypot(dxe, dze);
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z), to = P.eye.clone().sub(eye), d3 = to.length();
    this.seen = dE < SKILL.range[this.skill] && Math.abs(P.pos.y - this.pos.y) < 9 && !rayWorld(eye, to.clone().normalize(), Math.max(0.5, d3 - 0.5));
    // 1) the best item within reach: health when hurt, armour, weapons, boosters
    let bestItem = -1, bestScore = 0;
    for (let i = 0; i < pickups.length; i++) {
      const n = itemNode[i]; if (n === undefined || !(dist[n] < 80) || !this.ctx.itemActive?.(i)) continue;
      const v = this.itemValue(pickups[i]); if (v <= 0) continue;
      const sc = v / (1 + dist[n] / 14); if (sc > bestScore) { bestScore = sc; bestItem = i; }
    }
    const hurt = this.health < 35, want = hurt ? 0.8 : this.seen ? 6 : 3.5;
    let goal = -1;
    if (bestItem >= 0 && bestScore > want) goal = itemNode[bestItem];
    else if (hurt && this.seen) {                                  // retreat: run to a far corner away from the enemy
      let bd = -1; for (let k = 0; k < 8; k++) { const i = Math.floor(Math.random() * nodes.length), n = nodes[i]; if (n.kind !== 'floor' || !(dist[i] < 50)) continue; const d = Math.hypot(n.x - P.pos.x, n.z - P.pos.z); if (d > bd) { bd = d; goal = i; } }
    } else if (this.seen && dE > 6 && dE < 16) goal = -1;           // in range with a clear shot: hold and strafe
    else if (dE < 70) goal = nearestNode(P.pos.x, P.pos.y, P.pos.z, 9);   // hunt the enemy
    if (goal < 0 && !(this.seen && dE > 6 && dE < 16)) {            // nothing to do: wander
      for (let k = 0; k < 10; k++) { const i = Math.floor(Math.random() * nodes.length), n = nodes[i]; if (n.kind === 'floor' && dist[i] < 60 && dist[i] > 12) { goal = i; break; } }
    }
    this.path = goal >= 0 && dist[goal] < Infinity ? pathTo(prev, goal) : []; this.pi = this.path[0] === cur ? 1 : 0;
  }
  /** would a jump with this horizontal speed land on solid ground at about the same height? (no leaps into the void) */
  private landingSafe(vx: number, vz: number) {
    const g = groundAt(this.pos.x + vx * 0.68, this.pos.z + vz * 0.68, this.pos.y + 0.1), g2 = groundAt(this.pos.x + vx * 0.34, this.pos.z + vz * 0.34, this.pos.y + 0.1);
    return g > -1e8 && g2 > -1e8 && Math.abs(g - this.pos.y) < 1.0;
  }
  private liftAt(n: { lift?: number }) { return n.lift !== undefined ? liftBoxes[n.lift].max[1] : 0; }

  private steer(dt: number, P: BotTarget) {
    const sp = SPEED * (this.haste > 0 ? 1.35 : 1) * (this.pain > 0.5 ? 0.8 : 1), w = this.want.set(0, 0, 0);
    if (this.dodgeT > 0) w.copy(this.dodgeDir).multiplyScalar(sp * 1.2);
    else if (this.pi < this.path.length) {
      const n = nodes[this.path[this.pi]], dx = n.x - this.pos.x, dz = n.z - this.pos.z, d = Math.hypot(dx, dz), dyN = n.y - this.pos.y;
      if (n.kind === 'lift' && n.up === false) {                          // wait for the lift to come down, then step on
        if (d < 0.8 && this.liftAt(n) < n.y + 0.3) this.pi++; else if (d < 0.8) { /* wait */ } else w.set(dx / d, 0, dz / d).multiplyScalar(sp);
      } else if (n.kind === 'lift') {                                      // ride: stand still until we are level with the top (or the bottom)
        if (Math.abs(dyN) < 0.6) this.pi++;
      } else if (d < (n.kind === 'floor' ? 1.0 : 0.8) && Math.abs(dyN) < 1.4) this.pi++;
      else {
        w.set(dx / d, 0, dz / d).multiplyScalar(sp);
        if (this.grounded && dyN > 0.35 && d < 3.4) { this.vy = 8.4; this.grounded = false; }   // hop up a step
      }
    }
    // fighting: strafe across the enemy's line of fire, back off if too close
    if (this.seen && this.dodgeT <= 0) {
      this.strafeT -= dt; if (this.strafeT <= 0) { this.strafe = -this.strafe; this.strafeT = 0.7 + Math.random() * 1.3; }
      const dxe = P.pos.x - this.pos.x, dze = P.pos.z - this.pos.z, de = Math.hypot(dxe, dze) || 1;
      w.x += (-dze / de) * this.strafe * sp * 0.75; w.z += (dxe / de) * this.strafe * sp * 0.75;
      if (de < 6) { w.x -= (dxe / de) * sp * 0.7; w.z -= (dze / de) * sp * 0.7; }
    }
    // never stroll off a platform edge while strafing / dodging (planned path steps may drop)
    if ((this.seen || this.dodgeT > 0) && this.grounded && w.lengthSq() > 0) {
      const gx = this.pos.x + w.x * 0.45, gz = this.pos.z + w.z * 0.45;
      if (groundAt(gx, gz, this.pos.y + 0.1) < this.pos.y - 0.7) { w.multiplyScalar(0); this.strafe = -this.strafe; this.dodgeT = 0; }
    }
    if (w.lengthSq() > sp * sp * 1.6) w.setLength(sp * 1.2);
  }

  /** sidestep incoming rockets / plasma / nails */
  private dodge() {
    const inc = this.ctx.incoming?.(this.pos, this.netId ? String(this.netId) : this.name); if (!inc || !inc.length) return;
    const chance = [0.25, 0.55, 0.9][this.skill]; if (Math.random() > chance) return;
    for (const p of inc) {
      const rel = this.pos.clone().sub(p.pos); const vv = p.vel.lengthSq(); if (vv < 1) continue;
      const t = rel.dot(p.vel) / vv; if (t < 0.05 || t > 0.75) continue;
      const miss = rel.clone().sub(p.vel.clone().multiplyScalar(t)); miss.y = 0; if (miss.length() > 2.8 + p.splash * 0.5) continue;
      const side = new THREE.Vector3(-p.vel.z, 0, p.vel.x).normalize(); if (side.dot(miss) < 0) side.negate();
      if (miss.length() < 0.2) side.multiplyScalar(Math.random() < 0.5 ? 1 : -1);
      this.dodgeDir.copy(side); this.dodgeT = 0.4;
      if (this.grounded && Math.random() < 0.4 && this.landingSafe(side.x * SPEED * 1.2, side.z * SPEED * 1.2)) { this.vy = 8.4; this.grounded = false; }
      return;
    }
  }

  /** bots treat bounce pads as obstacles: a bounce throws them off the platform */
  private onBounce(x: number, z: number) {
    for (const p of pads) if (p.kind === 'bounce' && Math.hypot(p.pos[0] - x, p.pos[2] - z) < 1.9 && Math.abs(p.pos[1] - this.pos.y) < 0.7 && this.grounded) return true;
    return false;
  }

  private collect() {
    if (!this.ctx.claimItem) return;
    for (let i = 0; i < pickups.length; i++) {
      const p = pickups[i].pos; if (Math.abs(p[0] - this.pos.x) > 1.3 || Math.abs(p[2] - this.pos.z) > 1.3 || Math.abs(p[1] - this.pos.y) > 1.6) continue;
      if (!this.ctx.itemActive?.(i) || this.itemValue(pickups[i]) <= 0) continue;
      const def = this.ctx.claimItem(i); if (!def) continue;
      if (def.kind === 'health') this.health = Math.min(100, this.health + def.amount);
      else if (def.kind === 'armor') this.armor = Math.min(100, this.armor + def.amount);
      else if (def.kind === 'weapon') { if (BOT_WEAPONS.has(def.id)) this.setWeapon(def.id); }
      else if (def.id === 'mega') this.health = Math.min(200, this.health + 100);
      else if (def.id === 'shield') this.armor = Math.min(200, this.armor + 100);
      else if (def.id === 'haste') this.haste = 20; else if (def.id === 'overdrive') this.od = 20; else if (def.id === 'regen') this.health = Math.min(150, this.health + 40);
    }
  }

  update(dt: number) {
    this.t += dt;
    const P = this.ctx.target ? this.ctx.target(this) : this.ctx.player;
    if (!this.alive) {
      this.deadT += dt; this.fall = Math.min(1, this.deadT * 2.2);
      if (this.deadT > 4.5) this.respawn(P.pos);
      this.apply(dt, 0); this.bar.visible = false; return;
    }
    this.pain = Math.max(0, this.pain - dt * 3); this.fireK = Math.max(0, this.fireK - dt * 6); this.cooldown -= dt;
    this.dodgeT = Math.max(0, this.dodgeT - dt); this.padCool = Math.max(0, this.padCool - dt); this.tpCool = Math.max(0, this.tpCool - dt);
    this.haste = Math.max(0, this.haste - dt); this.od = Math.max(0, this.od - dt);
    this.brainT -= dt; if (this.brainT <= 0 && this.grounded) { this.brainT = 0.35 + Math.random() * 0.2; this.think(P); }
    this.dodgeCheckT -= dt; if (this.dodgeCheckT <= 0) { this.dodgeCheckT = 0.12; this.dodge(); }
    this.collectT -= dt; if (this.collectT <= 0) { this.collectT = 0.1; this.collect(); }

    // ---- movement
    if (this.grounded) { this.steer(dt, P); this.vel.x += (this.want.x - this.vel.x) * Math.min(1, dt * 9); this.vel.z += (this.want.z - this.vel.z) * Math.min(1, dt * 9); }
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    if (!blockedAt(nx, this.pos.y, this.pos.z) && !this.onBounce(nx, this.pos.z)) this.pos.x = nx; else this.vel.x = 0;
    if (!blockedAt(this.pos.x, this.pos.y, nz) && !this.onBounce(this.pos.x, nz)) this.pos.z = nz; else this.vel.z = 0;
    if (this.grounded) {
      const g = groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1);
      if (g > -1e8 && g >= this.pos.y - 0.5) this.pos.y = g; else { this.grounded = false; this.vy = 0; }       // walked off an edge
    } else {
      this.vy -= GRAVITY * dt; const ny = this.pos.y + this.vy * dt;
      const g = this.vy <= 0 ? groundAt(this.pos.x, this.pos.z, this.pos.y + 0.1) : -Infinity;
      if (this.vy <= 0 && g > -1e8 && ny <= g + 0.01) { this.pos.y = g; this.vy = 0; this.grounded = true; this.brainT = 0; } else this.pos.y = ny;
    }
    // pads and teleporters work on bots exactly like on the player
    if (this.padCool <= 0) for (const p of pads) {
      if (Math.hypot(p.pos[0] - this.pos.x, p.pos[2] - this.pos.z) > 1.5 || Math.abs(p.pos[1] - this.pos.y) > 0.6) continue;
      if (p.kind === 'bounce') { this.vy = BOUNCE_VY[p.tier]; const ax = this.pos.x - p.pos[0], az = this.pos.z - p.pos[2], al = Math.hypot(ax, az) || 1; this.vel.set((ax / al) * 3, 0, (az / al) * 3); } else { const v = jumpPadVelocity([this.pos.x, p.pos[1], this.pos.z], p.target); this.vel.set(v[0], 0, v[2]); this.vy = v[1]; }
      this.grounded = false; this.padCool = 0.5; this.path = []; break;
    }
    if (this.tpCool <= 0) for (const t of teleporters) {
      if (Math.hypot(t.pos[0] - this.pos.x, t.pos[2] - this.pos.z) > 1.15 || Math.abs(t.pos[1] - this.pos.y) > 1.4) continue;
      const sp = Math.hypot(this.vel.x, this.vel.z); this.pos.set(t.dest[0], t.dest[1] + 0.05, t.dest[2]);
      this.vel.set(-Math.sin(t.yaw) * sp, 0, -Math.cos(t.yaw) * sp); this.grounded = false; this.vy = 0; this.tpCool = 0.8; this.path = []; this.brainT = 0.2; break;
    }
    if (this.pos.y < -45) { this.respawn(P.pos); return; }
    // stuck against a wall? pick a new route (and hop)
    this.stuckT += dt;
    if (this.stuckT > 1.4) {
      const tn = nodes[this.path[this.pi]], waiting = !!tn && tn.kind === 'lift';        // waiting for a lift is not being stuck
      if (!waiting && this.path.length && this.grounded && this.pos.distanceTo(this.stuckAt) < 0.35) { this.path = []; this.brainT = 0; this.vel.set(0, 0, 0); }
      this.stuckT = 0; this.stuckAt.copy(this.pos);
    }

    // ---- facing: the enemy when we can see it, otherwise where we are going
    const sx = this.seen ? P.pos.x - this.pos.x : this.vel.x, sz = this.seen ? P.pos.z - this.pos.z : this.vel.z;
    if (Math.hypot(sx, sz) > 0.3) { const ty = Math.atan2(sx, sz); let dd = ty - this.yaw; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); this.yaw += dd * Math.min(1, dt * SKILL.turn[this.skill]); }

    // ---- shooting
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z);
    const to = P.eye.clone().sub(eye); const dist = to.length();
    let dAng = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z) - this.yaw; dAng = Math.atan2(Math.sin(dAng), Math.cos(dAng));
    if (this.cooldown <= 0 && dist < SKILL.range[this.skill] && Math.abs(dAng) < 0.5) {
      const dirN = to.clone().normalize();
      if (!rayWorld(eye, dirN, dist - 0.5)) {
        const rocket = this.weapon === 'rocket';
        const gun = BOT_GUN[this.weapon] ?? BOT_GUN.plasma!;
        const lead = P.vel.clone().multiplyScalar((dist / gun.speed) * SKILL.lead[this.skill]);
        const target = (rocket ? P.pos.clone().add(new THREE.Vector3(0, 0.15, 0)) : P.eye.clone()).add(lead);
        const e = SKILL.aim[this.skill];
        target.add(new THREE.Vector3((Math.random() - .5) * e, (Math.random() - .5) * e * 0.6, (Math.random() - .5) * e));
        this.root.updateMatrixWorld(true);
        const o = this.muzzle.getWorldPosition(new THREE.Vector3());
        this.ctx.fire(this.weapon, o, target.sub(o).normalize(), gun.dmg * (this.od > 0 ? 2 : 1), 0.72, this.netId ? String(this.netId) : this.name, this);
        this.cooldown = (gun.cd + Math.random() * gun.jitter) * SKILL.cool[this.skill]; this.fireK = 1;
      } else this.cooldown = 0.2;
    }
    this.apply(dt, Math.min(1, Math.hypot(this.vel.x, this.vel.z) / SPEED));
    const hp = Math.max(0.02, Math.min(1, this.health / 100)); this.bar.scale.x = hp; this.bar.position.x = (hp - 1) * 0.5; this.bar.visible = true;
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
