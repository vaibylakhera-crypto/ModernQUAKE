import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPON_ORDER, WEAPON_DEFS, buildWeapon, WeaponId, WeaponModel } from './weapons';
import { GRIP_Z, SUPPORT } from './grips';
import { FpArms } from './fparms';

// First-person weapon + armoured gloved hands, drawn in its own pass so it never clips into level geometry.
// Hands are authored in the same real-world metre scale as the guns and scaled together with them,
// so finger/grip proportions stay correct.
const HOLDER_SCALE = 0.62;

const FIRE_FX: Record<WeaponId, { kick: number; flash: number }> = {
  blade: { kick: 0.0, flash: 0 }, pistol: { kick: 0.5, flash: 0.5 }, scatter: { kick: 1.0, flash: 1.0 }, nailer: { kick: 0.18, flash: 0.45 },
  rocket: { kick: 1.3, flash: 1.2 }, arc: { kick: 0.05, flash: 0.0 }, rail: { kick: 1.6, flash: 1.3 }, plasma: { kick: 0.22, flash: 0.55 },
};
const glove = new THREE.MeshPhongMaterial({ color: 0x39414d, specular: 0x7a8aa0, shininess: 40 });
const gloveDark = new THREE.MeshPhongMaterial({ color: 0x1f252d, specular: 0x4a5668, shininess: 30 });
const plate = new THREE.MeshPhongMaterial({ color: 0x5a6472, specular: 0xb4c0d0, shininess: 95 });
const sleeve = new THREE.MeshPhongMaterial({ color: 0x343b47, specular: 0x667488, shininess: 50 });

const rbox = (w: number, h: number, d: number, m: THREE.Material, r = 0.006) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m);
const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number) => { o.position.set(x, y, z); return o; };

/** Forearm: wrist cuff + tapered sleeve + armour plate + accent strip. `reach` is the direction (toward the camera/outside) it extends. */
function forearm(reach: THREE.Vector3, accent: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const len = reach.length();
  const arm = new THREE.Group();
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.035, 20).rotateX(Math.PI / 2), plate); cuff.position.z = 0.02; arm.add(cuff);
  const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.046, len, 22).rotateX(Math.PI / 2), sleeve); sl.position.z = len / 2 + 0.03; arm.add(sl);
  const pl = rbox(0.05, 0.03, 0.17, plate, 0.01); pl.position.set(0, 0.04, 0.16); arm.add(pl);
  const ridge = rbox(0.014, 0.008, 0.12, accent, 0.002); ridge.position.set(0, 0.058, 0.16); arm.add(ridge);
  for (const z of [0.3, 0.36]) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.006, 8, 24), gloveDark); b.position.z = z; arm.add(b); }
  arm.lookAt(reach); g.add(arm);
  return g;
}

/** Right-hand pistol grip: palm on the right of the grip, four fingers forming a ring around the front, thumb on the left. */
function gripHand(accent: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(put(rbox(0.034, 0.1, 0.07, glove, 0.014), 0.042, 0.0, 0.012));                 // palm
  g.add(put(rbox(0.012, 0.088, 0.062, plate, 0.004), 0.062, 0.0, 0.012));               // back-of-hand plate
  g.add(put(rbox(0.004, 0.09, 0.012, accent, 0.001), 0.068, 0.0, 0.012));
  for (let i = 0; i < 4; i++) {
    const y = 0.036 - i * 0.021, sz = 1 - i * 0.04;
    g.add(put(rbox(0.018, 0.019, 0.034, glove, 0.007), 0.034, y, -0.03));               // proximal, around the front corner
    g.add(put(rbox(0.082, 0.019 * sz, 0.019, glove, 0.007), 0.0, y, -0.048));           // across the front of the grip
    g.add(put(rbox(0.018, 0.018 * sz, 0.03, glove, 0.007), -0.033, y, -0.034));         // curling back round the far side
    g.add(put(rbox(0.004, 0.012, 0.014, gloveDark, 0.001), 0.0, y, -0.0585));           // fingertip pad
  }
  const th = rbox(0.016, 0.017, 0.05, glove, 0.007); th.position.set(-0.033, 0.058, 0.006); th.rotation.x = 0.2; g.add(th);   // thumb
  g.add(put(rbox(0.016, 0.017, 0.03, glove, 0.007), -0.034, 0.061, -0.03));
  return g;
}

/** Fist around a cylindrical handle running along Z (blade): knuckle ring segments around the handle. */
function fistHand(accent: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(put(rbox(0.078, 0.034, 0.09, glove, 0.014), 0, -0.036, 0.015));                 // palm below
  g.add(put(rbox(0.06, 0.012, 0.075, plate, 0.004), 0, -0.056, 0.015));
  for (let i = 0; i < 4; i++) {
    const z = -0.022 + i * 0.022;
    g.add(put(rbox(0.016, 0.034, 0.019, glove, 0.007), 0.036, -0.005, z));              // finger side
    g.add(put(rbox(0.07, 0.016, 0.019, glove, 0.007), 0.0, 0.03, z));                   // finger over the top
    g.add(put(rbox(0.016, 0.034, 0.019, glove, 0.007), -0.036, -0.005, z));
  }
  g.add(put(rbox(0.017, 0.017, 0.055, glove, 0.007), 0.0, 0.045, -0.01));               // thumb
  g.add(put(rbox(0.004, 0.012, 0.07, accent, 0.001), 0.0, -0.0575, 0.015));
  return g;
}

/** Support hand cupped under a flat surface: palm below, fingers curling up the outer side, thumb on the inner side. */
function cupHand(side: number, accent: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(put(rbox(0.088, 0.03, 0.086, glove, 0.013), 0, 0, 0));
  g.add(put(rbox(0.07, 0.012, 0.07, plate, 0.004), 0, -0.02, 0));
  g.add(put(rbox(0.05, 0.004, 0.012, accent, 0.001), 0, -0.027, 0));
  for (let i = 0; i < 4; i++) {
    const z = 0.03 - i * 0.021;
    g.add(put(rbox(0.026, 0.019, 0.019, glove, 0.007), side * 0.054, 0.004, z));       // proximal out to the side
    g.add(put(rbox(0.019, 0.04, 0.019, glove, 0.007), side * 0.066, 0.028, z));        // curling up
    g.add(put(rbox(0.03, 0.017, 0.017, glove, 0.007), side * 0.05, 0.05, z));          // fingertip over the top edge
  }
  const th = rbox(0.045, 0.017, 0.017, glove, 0.007); th.position.set(-side * 0.052, 0.016, -0.034); th.rotation.z = -side * 0.5; g.add(th);
  return g;
}

/** Support hand wrapped around a vertical box grip of width gw, depth gd. */
function wrapHand(side: number, gw: number, gd: number, accent: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const px = side * (gw / 2 + 0.019);
  g.add(put(rbox(0.034, 0.1, 0.07, glove, 0.014), px, 0, gd / 2 - 0.02));
  g.add(put(rbox(0.012, 0.088, 0.062, plate, 0.004), px + side * 0.02, 0, gd / 2 - 0.02));
  g.add(put(rbox(0.004, 0.09, 0.012, accent, 0.001), px + side * 0.026, 0, gd / 2 - 0.02));
  for (let i = 0; i < 4; i++) {
    const y = 0.036 - i * 0.021, fz = -gd / 2 - 0.011;
    g.add(put(rbox(0.018, 0.019, 0.03, glove, 0.007), side * (gw / 2 + 0.009), y, -gd / 2 + 0.01));
    g.add(put(rbox(gw + 0.036, 0.019, 0.019, glove, 0.007), 0, y, fz));
    g.add(put(rbox(0.018, 0.018, 0.03, glove, 0.007), -side * (gw / 2 + 0.009), y, -gd / 2 + 0.01));
  }
  g.add(put(rbox(0.016, 0.017, 0.05, glove, 0.007), -side * (gw / 2 + 0.01), 0.058, gd / 2 - 0.04));
  return g;
}

export class Viewmodel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.01, 10);
  private root = new THREE.Group();
  private models = new Map<WeaponId, { holder: THREE.Group; model: WeaponModel; flash: THREE.Mesh }>();
  current: WeaponId = 'pistol';
  private pending: WeaponId = 'pistol';
  private raise = 1;
  private kick = 0; private kz = 0; private kzv = 0; private breath = 0; private wasAir = false; private land = 0; private tilt = 0; private bobT = 0; private swayX = 0; private swayY = 0; private flashT = 0; private spin = 0; private swing = 0;
  onSwitch?: (id: WeaponId) => void;
  fp: FpArms; private procHands: THREE.Object3D[] = [];
  get armsReady() { return this.fp.ready; }

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a3a8a, 2.4));
    this.scene.add(new THREE.AmbientLight(0x8090b0, 1.0));
    const key = new THREE.DirectionalLight(0xfff0e0, 3.4); key.position.set(-1.5, 2, 1.5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8aa0ff, 2.0); rim.position.set(2, 1, -1); this.scene.add(rim);
    this.scene.add(this.camera, this.root);
    this.root.position.set(0.2, -0.21, -0.55);

    const flashTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d')!;
      const g = x.createRadialGradient(64, 64, 2, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,230,160,.85)'); g.addColorStop(1, 'rgba(255,120,20,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      x.strokeStyle = 'rgba(255,240,200,.9)'; x.lineWidth = 3; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); x.stroke(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();

    for (const id of WEAPON_ORDER) {
      const model = buildWeapon(id);
      const holder = new THREE.Group();
      holder.add(model.group);
      const accent = new THREE.MeshBasicMaterial({ color: new THREE.Color(WEAPON_DEFS[id].color).multiplyScalar(0.95) });
      const gz = GRIP_Z[id];
      // right hand
      const rh = new THREE.Group();
      if (id === 'blade') { rh.add(fistHand(accent)); rh.position.set(0, 0, gz); }
      else { rh.add(gripHand(accent)); rh.position.set(0, -0.1, gz); rh.rotation.x = -0.28; }
      rh.scale.setScalar(1.45);
      holder.add(rh); this.procHands.push(rh);
      const fa = put(forearm(new THREE.Vector3(0.3, -0.42, 0.7), accent), 0.0, id === 'blade' ? -0.03 : -0.13, gz + 0.03); holder.add(fa); this.procHands.push(fa);
      // support hand
      const sup = SUPPORT[id];
      if (sup) {
        const lh = sup.type === 'cup' ? cupHand(-1, accent) : wrapHand(-1, sup.gw, sup.gd, accent);
        lh.position.set(0, sup.y, sup.z); lh.scale.setScalar(1.35); holder.add(lh); this.procHands.push(lh);
        const fl = put(forearm(new THREE.Vector3(-0.32, -0.34, 0.72), accent), -0.0, sup.y - 0.02, sup.z + 0.06); holder.add(fl); this.procHands.push(fl);
      }
      const fm = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(WEAPON_DEFS[id].color).lerp(new THREE.Color(1, 1, 1), 0.5) });
      const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), fm); flash.visible = false;
      flash.position.copy(model.muzzle.position); flash.position.z -= 0.02; holder.add(flash);
      holder.scale.setScalar(HOLDER_SCALE);
      holder.visible = false; this.root.add(holder);
      this.models.set(id, { holder, model, flash });
    }
    this.models.get(this.current)!.holder.visible = true;
    // real-hand arms load async; swap out the placeholder box hands when they are ready
    this.fp = new FpArms(this.scene);
    this.fp.init().then(() => { for (const o of this.procHands) o.visible = false; });
  }

  resize(aspect: number) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  /** instant (no animation); used by the model viewer and on respawn */
  show(id: WeaponId) {
    this.models.get(this.current)!.holder.visible = false;
    this.current = this.pending = id; this.raise = 1; this.models.get(id)!.holder.visible = true;
  }
  /** animated swap (caller checks ownership) */
  select(id: WeaponId) { if (id !== this.pending) this.pending = id; }
  get target() { return this.pending; }
  get switching() { return this.pending !== this.current || this.raise < 0.85; }

  /** muzzle position in camera space (for spawning tracers/projectiles from the barrel) */
  muzzleCamSpace(): THREE.Vector3 {
    this.scene.updateMatrixWorld(true);
    return this.models.get(this.current)!.model.muzzle.getWorldPosition(new THREE.Vector3());
  }

  fire(id: WeaponId) {
    const m = this.models.get(id)!; const f = FIRE_FX[id];
    this.kick = Math.min(1.6, this.kick + f.kick);
    if (id === 'blade') this.swing = 1;
    if (f.flash > 0) { this.flashT = 0.05 + f.flash * 0.03; m.flash.rotation.z = Math.random() * 6.28; m.flash.scale.setScalar(f.flash * (0.8 + Math.random() * 0.5)); }
  }

  update(dt: number, o: { speed: number; grounded: boolean; lookDX: number; lookDY: number; spinning: boolean; beam: boolean }) {
    if (this.pending !== this.current) {
      this.raise -= dt * 7;
      if (this.raise <= 0) {
        this.models.get(this.current)!.holder.visible = false; this.current = this.pending;
        this.models.get(this.current)!.holder.visible = true; this.raise = 0; this.onSwitch?.(this.current);
      }
    } else this.raise = Math.min(1, this.raise + dt * 7);

    const m = this.models.get(this.current)!;
    this.kick = Math.max(0, this.kick - dt * 9);
    // spring-damped recoil: snaps back, overshoots a hair, settles
    this.kzv += (-this.kz * 260 - this.kzv * 22 + this.kick * 160) * dt; this.kz += this.kzv * dt;
    this.breath += dt;
    if (this.wasAir && o.grounded) this.land = 1; this.wasAir = !o.grounded; this.land = Math.max(0, this.land - dt * 4);
    this.swing = Math.max(0, this.swing - dt * 5);
    this.flashT -= dt; m.flash.visible = this.flashT > 0;
    const pulse = 1 + 0.3 * Math.sin(performance.now() / 160) + (this.flashT > 0 || o.beam ? 1.0 : 0);
    for (const g of m.model.glow) g.color.set(WEAPON_DEFS[this.current].color).multiplyScalar(1.3 * pulse);
    if (m.model.spin) { this.spin += dt * (o.spinning ? 38 : 3); m.model.spin.rotation.z = this.spin; }

    const moving = o.grounded ? Math.min(1, o.speed / 10) : 0.15;
    this.bobT += dt * (6 + o.speed * 0.6);
    const idle = 1 - moving;
    const bx = Math.cos(this.bobT * 0.5) * 0.011 * moving + Math.sin(this.breath * 1.3) * 0.0015 * idle,
          by = Math.abs(Math.sin(this.bobT * 0.5)) * 0.014 * moving + Math.sin(this.breath * 1.7) * 0.0022 * idle - this.land * 0.03;
    this.swayX += (-o.lookDX * 0.0016 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (o.lookDY * 0.0016 - this.swayY) * Math.min(1, dt * 10);
    const lower = (1 - this.raise) * (1 - this.raise);
    const h = m.holder;
    const sw = Math.sin(this.swing * Math.PI);   // blade slash arc
    h.position.set(bx + this.swayX * 0.5 - sw * 0.12, by - lower * 0.35 + this.swayY * 0.5 - sw * 0.04, this.kz * 0.05 - sw * 0.12);
    h.rotation.set(-this.kz * 0.07 + this.land * 0.05 + this.swayY - lower * 0.9 + sw * 0.4, this.swayX + sw * 0.7, -this.swayX * 0.6 + Math.sin(this.bobT * 0.5) * 0.004 * moving - sw * 0.9);
    if (this.fp.ready) { h.updateMatrixWorld(true); this.fp.update(h, this.current); }
  }
}
