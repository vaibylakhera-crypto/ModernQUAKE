import * as THREE from 'three';
import { boxes } from './level';
import { WEAPON_DEFS, WeaponId } from './weapons';

// ───────────── ray helpers (slab test) ─────────────
export interface Target { id: string; pos: THREE.Vector3; radius: number; height: number; alive: boolean; hit(dmg: number, from: THREE.Vector3, dir: THREE.Vector3, kind: string): void }

function slab(o: THREE.Vector3, d: THREE.Vector3, min: ArrayLike<number>, max: ArrayLike<number>, maxT: number): { t: number; axis: number; sgn: number } | null {
  let tmin = 0, tmax = maxT, axis = -1, sgn = 0;
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z, da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    if (Math.abs(da) < 1e-9) { if (oa < min[a] || oa > max[a]) return null; continue; }
    let t1 = (min[a] - oa) / da, t2 = (max[a] - oa) / da, s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sgn = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { t: tmin, axis, sgn };
}
export function rayWorld(o: THREE.Vector3, d: THREE.Vector3, maxT: number): { t: number; n: THREE.Vector3 } | null {
  let best = maxT, bn: THREE.Vector3 | null = null;
  for (const b of boxes) { const h = slab(o, d, b.min, b.max, best); if (h && h.axis >= 0 && h.t < best) { best = h.t; bn = new THREE.Vector3(); bn.setComponent(h.axis, h.sgn); } }
  return bn ? { t: best, n: bn } : null;
}
function rayTarget(o: THREE.Vector3, d: THREE.Vector3, maxT: number, t: Target): number | null {
  const h = slab(o, d, [t.pos.x - t.radius, t.pos.y, t.pos.z - t.radius], [t.pos.x + t.radius, t.pos.y + t.height, t.pos.z + t.radius], maxT);
  return h ? h.t : null;
}

// ───────────── textures ─────────────
function radial(stops: [number, string][], size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d')!;
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2); for (const [p, col] of stops) g.addColorStop(p, col);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const texGlow = radial([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,.95)'], [0.7, 'rgba(255,255,255,.3)'], [1, 'rgba(255,255,255,0)']]);
const texSmoke = radial([[0, 'rgba(255,255,255,.7)'], [0.6, 'rgba(255,255,255,.25)'], [1, 'rgba(255,255,255,0)']]);

// ───────────── particles (sprite pool) ─────────────
interface P { s: THREE.Sprite; vel: THREE.Vector3; life: number; max: number; s0: number; s1: number; grav: number; a0: number }
class Particles {
  pool: P[] = []; free: P[] = [];
  constructor(scene: THREE.Scene, n = 360) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      s.visible = false; scene.add(s);
      const p: P = { s, vel: new THREE.Vector3(), life: 0, max: 1, s0: 1, s1: 1, grav: 0, a0: 1 }; this.pool.push(p); this.free.push(p);
    }
  }
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, life: number, s0: number, s1: number, color: number, o: { add?: boolean; grav?: number; a?: number; smoke?: boolean } = {}) {
    const p = this.free.pop(); if (!p) return;
    const m = p.s.material as THREE.SpriteMaterial;
    m.map = o.smoke ? texSmoke : texGlow; m.color.set(color); m.blending = o.add === false ? THREE.NormalBlending : THREE.AdditiveBlending; m.needsUpdate = true;
    p.s.position.copy(pos); p.vel.copy(vel); p.life = p.max = life; p.s0 = s0; p.s1 = s1; p.grav = o.grav ?? 0; p.a0 = o.a ?? 1; p.s.visible = true;
  }
  update(dt: number) {
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; this.free.push(p); continue; }
      p.vel.y -= p.grav * dt; p.s.position.addScaledVector(p.vel, dt);
      const k = 1 - p.life / p.max;
      p.s.scale.setScalar(p.s0 + (p.s1 - p.s0) * k);
      (p.s.material as THREE.SpriteMaterial).opacity = p.a0 * (1 - k) * (1 - k * 0.3);
    }
  }
}

// ───────────── tracers / beams (additive stretched cylinders) ─────────────
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).rotateX(Math.PI / 2);
interface Tr { m: THREE.Mesh; life: number; max: number; r: number; shrink: boolean }
class Tracers {
  pool: Tr[] = []; free: Tr[] = [];
  constructor(scene: THREE.Scene, n = 80) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(unitCyl, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      m.visible = false; m.frustumCulled = false; scene.add(m);
      const t: Tr = { m, life: 0, max: 1, r: 1, shrink: false }; this.pool.push(t); this.free.push(t);
    }
  }
  add(a: THREE.Vector3, b: THREE.Vector3, r: number, color: number, life: number, shrink = false) {
    const t = this.free.pop(); if (!t) return;
    const len = a.distanceTo(b); if (len < 1e-4) { this.free.push(t); return; }
    t.m.position.copy(a).add(b).multiplyScalar(0.5); t.m.lookAt(b); t.m.scale.set(r, r, len);
    (t.m.material as THREE.MeshBasicMaterial).color.set(color); t.m.visible = true; t.life = t.max = life; t.r = r; t.shrink = shrink;
  }
  update(dt: number) {
    for (const t of this.pool) {
      if (t.life <= 0) continue; t.life -= dt;
      if (t.life <= 0) { t.m.visible = false; this.free.push(t); continue; }
      const k = t.life / t.max;
      (t.m.material as THREE.MeshBasicMaterial).opacity = k;
      if (t.shrink) { const r = t.r * (0.35 + 0.65 * k); t.m.scale.x = t.m.scale.y = r; }
    }
  }
}

// ───────────── projectiles ─────────────
interface Proj { kind: WeaponId; pos: THREE.Vector3; vel: THREE.Vector3; life: number; obj: THREE.Object3D; trail: number; fromPlayer: boolean; dmg: number }

export interface CombatHooks {
  /** called for every explosion so the game can apply splash to the local player */
  explode(pos: THREE.Vector3, radius: number, damage: number, knock: number, fromPlayer: boolean): void;
  targets(): Target[];
  playerBody(): { pos: THREE.Vector3; radius: number; height: number };
  hurt(dmg: number, dir: THREE.Vector3): void;
}

export class Combat {
  private particles: Particles; private tracers: Tracers; private projs: Proj[] = [];
  private rings: { m: THREE.Mesh; life: number; r: number }[] = [];
  private arc: { core: THREE.Mesh; glow: THREE.Mesh }[] = []; private arcT = 0; private arcA = new THREE.Vector3(); private arcB = new THREE.Vector3();
  shake = 0;
  private bolts: THREE.Object3D[] = []; private rocketProto!: THREE.Group;

  constructor(private scene: THREE.Scene, private hooks: CombatHooks) {
    this.particles = new Particles(scene); this.tracers = new Tracers(scene);
    for (let i = 0; i < 10; i++) {
      const core = new THREE.Mesh(unitCyl, new THREE.MeshBasicMaterial({ color: 0xe8e0ff, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const glow = new THREE.Mesh(unitCyl, new THREE.MeshBasicMaterial({ color: 0x8f6bff, fog: false, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.visible = glow.visible = false; core.frustumCulled = glow.frustumCulled = false; scene.add(core, glow); this.arc.push({ core, glow });
    }
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.visible = false; scene.add(m); this.rings.push({ m, life: 0, r: 1 });
    }
    // rocket model
    const rk = new THREE.Group(); const steel = new THREE.MeshPhongMaterial({ color: 0xb8c0cc, shininess: 90 });
    rk.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 14).rotateX(Math.PI / 2), steel));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 14).rotateX(-Math.PI / 2), new THREE.MeshPhongMaterial({ color: 0xff3a2a })); nose.position.z = -0.28; rk.add(nose);
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.1, 0.12), steel); f.position.z = 0.15; f.rotation.z = (i * Math.PI) / 2; f.translateY(0.07); rk.add(f); }
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow, color: 0xffa040, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); flame.scale.setScalar(0.8); flame.position.z = 0.32; rk.add(flame);
    this.rocketProto = rk;
  }

  // ───── firing ─────
  /** eye/dir: aim ray; muzzle: where the effect visibly starts. Returns nothing; applies damage to targets. */
  fire(id: WeaponId, eye: THREE.Vector3, dir: THREE.Vector3, muzzle: THREE.Vector3) {
    const st = WEAPON_DEFS[id].stats; const col = WEAPON_DEFS[id].color;
    if (st.kind === 'melee') return this.melee(eye, dir, st.range!, st.damage);
    if (st.kind === 'projectile') {
      const aim = this.aimPoint(eye, dir, 200);
      const d = aim.clone().sub(muzzle).normalize();
      const spread = st.spread ?? 0; if (spread) { d.x += (Math.random() - .5) * spread * 2; d.y += (Math.random() - .5) * spread * 2; d.z += (Math.random() - .5) * spread * 2; d.normalize(); }
      return this.spawnProj(id, muzzle.clone(), d.multiplyScalar(st.speed!));
    }
    if (st.kind === 'beam') { this.arcT = 0.09; this.arcA.copy(muzzle); const r = this.trace(eye, dir, st.range!, st.damage, 'arc'); this.arcB.copy(r.point); if (r.hitWorld) this.sparks(r.point, r.n!, 0x9a7bff, 3); return; }
    const pellets = st.pellets ?? 1;
    for (let i = 0; i < pellets; i++) {
      const d = dir.clone(); const sp = st.spread ?? 0;
      if (sp) { d.x += (Math.random() - .5) * sp * 2; d.y += (Math.random() - .5) * sp * 2; d.z += (Math.random() - .5) * sp * 2; d.normalize(); }
      const r = this.trace(eye, d, st.range!, st.damage, id, st.kind === 'rail');
      if (st.kind === 'rail') { this.railBeam(muzzle, r.point); this.sparks(r.point, r.n ?? new THREE.Vector3(0, 1, 0), col, 14); this.shake = Math.max(this.shake, 0.5); }
      else {
        this.tracers.add(muzzle, r.point, id === 'scatter' ? 0.028 : 0.04, id === 'scatter' ? 0xffb050 : 0xfff0a0, id === 'scatter' ? 0.09 : 0.12, false);
        if (r.hitWorld) this.sparks(r.point, r.n!, col, id === 'scatter' ? 3 : 6);
      }
    }
    if (id === 'scatter') this.shake = Math.max(this.shake, 0.35);
  }

  private aimPoint(eye: THREE.Vector3, dir: THREE.Vector3, max: number): THREE.Vector3 {
    const w = rayWorld(eye, dir, max); return eye.clone().addScaledVector(dir, w ? w.t : max);
  }

  /** ray vs world + targets; applies damage to the nearest target (rail pierces) */
  private trace(o: THREE.Vector3, d: THREE.Vector3, range: number, dmg: number, kind: string, pierce = false): { point: THREE.Vector3; n: THREE.Vector3 | null; hitWorld: boolean } {
    const w = rayWorld(o, d, range); const maxT = w ? w.t : range;
    const hits: { t: number; tg: Target }[] = [];
    for (const tg of this.hooks.targets()) { if (!tg.alive) continue; const t = rayTarget(o, d, maxT, tg); if (t !== null) hits.push({ t, tg }); }
    hits.sort((a, b) => a.t - b.t);
    let endT = maxT, hitWorld = !!w;
    for (const h of hits) {
      h.tg.hit(dmg, o, d, kind);
      this.sparks(o.clone().addScaledVector(d, h.t), d.clone().negate(), 0xff4040, 8);
      if (!pierce) { endT = h.t; hitWorld = false; break; }
    }
    return { point: o.clone().addScaledVector(d, endT), n: hitWorld && w ? w.n : null, hitWorld };
  }

  private melee(eye: THREE.Vector3, dir: THREE.Vector3, range: number, dmg: number) {
    const w = rayWorld(eye, dir, range);
    for (const tg of this.hooks.targets()) {
      if (!tg.alive) continue;
      const c = tg.pos.clone(); c.y += tg.height * 0.6; const to = c.sub(eye); const dist = to.length();
      if (dist < range + tg.radius && to.normalize().dot(dir) > 0.55) { tg.hit(dmg, eye, dir, 'blade'); this.sparks(eye.clone().addScaledVector(dir, Math.min(dist, range)), dir.clone().negate(), 0x5ee8ff, 12); return; }
    }
    if (w) this.sparks(eye.clone().addScaledVector(dir, w.t), w.n, 0x5ee8ff, 8);
  }

  private railBeam(a: THREE.Vector3, b: THREE.Vector3) {
    this.tracers.add(a, b, 0.045, 0xeaffff, 0.55, true);
    this.tracers.add(a, b, 0.17, 0x35d8ff, 0.85, true);
    this.tracers.add(a, b, 0.34, 0x1a90ff, 0.6, true);
    // helix of motes around the beam
    const dir = b.clone().sub(a); const len = dir.length(); dir.normalize();
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(dir, up).normalize(), v = new THREE.Vector3().crossVectors(dir, u);
    const n = Math.min(70, Math.floor(len / 1.4));
    for (let i = 0; i < n; i++) {
      const t = i / n * len, ang = i * 0.9;
      const p = a.clone().addScaledVector(dir, t).addScaledVector(u, Math.cos(ang) * 0.22).addScaledVector(v, Math.sin(ang) * 0.22);
      this.particles.spawn(p, new THREE.Vector3(), 0.5 + (i % 5) * 0.06, 0.4, 0.04, 0x8af4ff);
    }
  }

  /** a bot's shot: same visuals, hurts the player, ignores other bots */
  fireEnemy(id: WeaponId, origin: THREE.Vector3, dir: THREE.Vector3, dmg: number, speedScale: number) {
    const st = WEAPON_DEFS[id].stats; this.spawnProj(id, origin.clone(), dir.clone().multiplyScalar((st.speed ?? 30) * speedScale), false, dmg);
  }

  private spawnProj(id: WeaponId, pos: THREE.Vector3, vel: THREE.Vector3, fromPlayer = true, dmg?: number) {
    let obj: THREE.Object3D;
    if (id === 'rocket') { obj = this.rocketProto.clone(true); }
    else if (id === 'plasma') {
      const g = new THREE.Group();
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow, color: 0x35d0ff, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); halo.scale.setScalar(1.6);
      const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: texGlow, color: 0xe0fbff, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending })); core.scale.setScalar(0.65);
      g.add(halo, core); obj = g;
    } else {
      const g = new THREE.Group();
      const bolt = new THREE.Mesh(unitCyl, new THREE.MeshBasicMaterial({ color: 0xfff0a0, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      bolt.scale.set(0.04, 0.04, 0.9); g.add(bolt);
      const halo = new THREE.Mesh(unitCyl, new THREE.MeshBasicMaterial({ color: 0xffa020, fog: false, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.set(0.13, 0.13, 1.1); g.add(halo); obj = g;
    }
    obj.position.copy(pos); if (id === 'rocket') obj.scale.setScalar(3.2); if (id !== 'plasma') obj.lookAt(pos.clone().sub(vel));   // model faces -Z, lookAt aims +Z this.scene.add(obj);
    this.projs.push({ kind: id, pos, vel, life: 6, obj, trail: 0, fromPlayer, dmg: dmg ?? WEAPON_DEFS[id].stats.damage });
  }

  // ───── effects ─────
  sparks(p: THREE.Vector3, n: THREE.Vector3, color: number, count: number) {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(3).addScaledVector(n, 3 + Math.random() * 4);
      this.particles.spawn(p.clone().addScaledVector(n, 0.04), v, 0.25 + Math.random() * 0.3, 0.18, 0.03, color, { grav: 9 });
    }
    this.particles.spawn(p.clone().addScaledVector(n, 0.05), new THREE.Vector3(), 0.14, 0.9, 1.6, color, { a: 0.9 });
  }

  explosion(p: THREE.Vector3, radius: number, color = 0xff8a2a) {
    this.shake = Math.max(this.shake, Math.min(1, radius / 4.5));
    this.particles.spawn(p, new THREE.Vector3(), 0.14, radius * 1.1, radius * 2.4, 0xfff0c0, { a: 1 });
    for (let i = 0; i < 18; i++) {
      const v = new THREE.Vector3(Math.random() - .5, Math.random() - .3, Math.random() - .5).normalize().multiplyScalar(4 + Math.random() * 8);
      this.particles.spawn(p.clone(), v, 0.35 + Math.random() * 0.35, radius * 0.5, radius * 1.4, Math.random() < 0.5 ? color : 0xff4a10, { a: 0.95 });
    }
    for (let i = 0; i < 12; i++) {
      const v = new THREE.Vector3((Math.random() - .5) * 3, 1 + Math.random() * 2.5, (Math.random() - .5) * 3);
      this.particles.spawn(p.clone().add(new THREE.Vector3((Math.random() - .5), (Math.random() - .5), (Math.random() - .5))), v, 1.0 + Math.random() * 0.8, radius * 0.5, radius * 1.7, 0x3a3640, { add: false, a: 0.55, smoke: true });
    }
    for (let i = 0; i < 26; i++) {
      const v = new THREE.Vector3(Math.random() - .5, Math.random(), Math.random() - .5).normalize().multiplyScalar(6 + Math.random() * 9);
      this.particles.spawn(p.clone(), v, 0.5 + Math.random() * 0.5, 0.09, 0.02, 0xffd080, { grav: 14 });
    }
    const r = this.rings.find(x => x.life <= 0); if (r) { r.life = 0.35; r.r = radius; r.m.visible = true; r.m.position.copy(p); r.m.lookAt(p.clone().add(new THREE.Vector3(0, 1, 0))); }
  }

  plasmaSplash(p: THREE.Vector3, n: THREE.Vector3) {
    this.particles.spawn(p.clone().addScaledVector(n, 0.1), new THREE.Vector3(), 0.18, 0.5, 1.8, 0x35d0ff, { a: 0.9 });
    for (let i = 0; i < 10; i++) {
      const v = new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(4).addScaledVector(n, 3);
      this.particles.spawn(p.clone().addScaledVector(n, 0.1), v, 0.3 + Math.random() * 0.2, 0.2, 0.02, 0x8af4ff, { grav: 4 });
    }
  }

  // ───── update ─────
  update(dt: number) {
    // projectiles: swept test against world + targets
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const pr = this.projs[i]; pr.life -= dt;
      const step = pr.vel.clone().multiplyScalar(dt); const dist = step.length(); const dir = step.clone().divideScalar(dist || 1);
      let hitT = dist, kindHit: 'none' | 'world' | 'target' | 'player' = 'none'; let n: THREE.Vector3 | null = null, tgHit: Target | null = null;
      const w = rayWorld(pr.pos, dir, dist); if (w) { hitT = w.t; n = w.n; kindHit = 'world'; }
      if (pr.fromPlayer) { for (const tg of this.hooks.targets()) { if (!tg.alive) continue; const t = rayTarget(pr.pos, dir, hitT, tg); if (t !== null && t <= hitT) { hitT = t; kindHit = 'target'; tgHit = tg; n = dir.clone().negate(); } } }
      else { const b = this.hooks.playerBody(); const t = rayTarget(pr.pos, dir, hitT, { pos: b.pos, radius: b.radius, height: b.height } as unknown as Target); if (t !== null && t <= hitT) { hitT = t; kindHit = 'player'; n = dir.clone().negate(); } }
      const st = WEAPON_DEFS[pr.kind].stats;
      if (kindHit === 'none') {
        pr.pos.add(step); pr.obj.position.copy(pr.pos);
        // trails
        pr.trail -= dt;
        if (pr.kind === 'rocket') {
          const back = pr.pos.clone().addScaledVector(dir, -0.35);
          if (pr.trail <= 0) { pr.trail = 0.012;
            this.particles.spawn(back, dir.clone().multiplyScalar(-2).add(new THREE.Vector3((Math.random() - .5), (Math.random() - .5), (Math.random() - .5))), 0.34, 1.3, 0.15, 0xffa040);
            this.particles.spawn(back, new THREE.Vector3((Math.random() - .5) * .6, 0.4 + Math.random() * .6, (Math.random() - .5) * .6), 1.2, 1.2, 3.4, 0x6a666e, { add: false, a: 0.55, smoke: true }); }
        } else if (pr.kind === 'plasma' && pr.trail <= 0) { pr.trail = 0.02; this.particles.spawn(pr.pos.clone(), new THREE.Vector3(), 0.22, 0.6, 0.08, 0x35d0ff, { a: 0.7 }); }
        if (pr.life <= 0) { this.scene.remove(pr.obj); this.projs.splice(i, 1); }
        continue;
      }
      const hp = pr.pos.clone().addScaledVector(dir, hitT);
      this.scene.remove(pr.obj); this.projs.splice(i, 1);
      if (tgHit) tgHit.hit(pr.dmg, pr.pos, dir, pr.kind);
      if (kindHit === 'player') this.hooks.hurt(pr.dmg, dir);
      if (pr.kind === 'rocket') { const e = hp.clone().addScaledVector(n!, 0.15); this.explosion(e, st.splash!); this.hooks.explode(e, st.splash!, pr.dmg, st.knock!, pr.fromPlayer); if (pr.fromPlayer) this.splashTargets(e, st.splash!, pr.dmg, tgHit); }
      else if (pr.kind === 'plasma') { const e = hp.clone().addScaledVector(n!, 0.1); this.plasmaSplash(e, n!); this.hooks.explode(e, st.splash!, pr.dmg * 0.5, st.knock!, pr.fromPlayer); if (pr.fromPlayer) this.splashTargets(e, st.splash!, pr.dmg * 0.5, tgHit); }
      else this.sparks(hp, n!, 0xffc02d, 5);
    }
    // arc beam: jagged segments re-rolled every frame while active
    this.arcT -= dt;
    const on = this.arcT > 0;
    for (let i = 0; i < this.arc.length; i++) {
      const seg = this.arc[i]; seg.core.visible = seg.glow.visible = on;
    }
    if (on) {
      const A = this.arcA, B = this.arcB; const dir = B.clone().sub(A); const len = dir.length(); dir.normalize();
      const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(dir, up).normalize(), v = new THREE.Vector3().crossVectors(dir, u);
      let prev = A.clone();
      for (let i = 0; i < this.arc.length; i++) {
        const t = (i + 1) / this.arc.length; const amp = i === this.arc.length - 1 ? 0 : 0.18 * Math.sin(t * Math.PI) + 0.04;
        const next = A.clone().addScaledVector(dir, len * t).addScaledVector(u, (Math.random() - .5) * 2 * amp).addScaledVector(v, (Math.random() - .5) * 2 * amp);
        const s = this.arc[i]; s.core.position.copy(prev).add(next).multiplyScalar(0.5); s.core.lookAt(next); s.core.scale.set(0.034, 0.034, prev.distanceTo(next));
        s.glow.position.copy(s.core.position); s.glow.quaternion.copy(s.core.quaternion); s.glow.scale.set(0.16, 0.16, prev.distanceTo(next));
        prev = next;
      }
      if (Math.random() < 0.5) this.sparks(B, dir.clone().negate(), 0x9a7bff, 2);
    }
    // shockwave rings
    for (const r of this.rings) {
      if (r.life <= 0) continue; r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const k = 1 - r.life / 0.35; r.m.scale.setScalar(r.r * (0.3 + k * 1.0)); (r.m.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
    }
    this.particles.update(dt); this.tracers.update(dt);
    this.shake = Math.max(0, this.shake - dt * 3);
  }

  private splashTargets(p: THREE.Vector3, radius: number, dmg: number, skip: Target | null) {
    for (const tg of this.hooks.targets()) {
      if (!tg.alive || tg === skip) continue;
      const c = tg.pos.clone(); c.y += tg.height * 0.5; const d = c.distanceTo(p);
      if (d < radius) tg.hit(dmg * (1 - d / radius), p, c.sub(p).normalize(), 'splash');
    }
  }
}
