import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPON_ORDER, WEAPON_DEFS, buildWeapon, WeaponId, WeaponModel } from './weapons';

// First-person weapon + armoured gloved hands, drawn in its own pass so it never clips into level geometry.
const GUN_SCALE = 0.5;

const FIRE: Record<WeaponId, { interval: number; kick: number; flash: number; auto: boolean }> = {
  scatter: { interval: 0.85, kick: 1.0, flash: 1.0, auto: false },
  nailer:  { interval: 0.075, kick: 0.18, flash: 0.45, auto: true },
  rocket:  { interval: 0.8, kick: 1.3, flash: 1.2, auto: false },
  plasma:  { interval: 0.1, kick: 0.22, flash: 0.55, auto: true },
  rail:    { interval: 1.4, kick: 1.6, flash: 1.3, auto: false },
};
// where the left hand supports the weapon (gun space, before scaling) and the right-hand grip
const LEFT_HAND: Record<WeaponId, [number, number, number]> = {
  scatter: [0, -0.07, -0.42], nailer: [0, -0.12, -0.1], rocket: [0, -0.1, -0.5], plasma: [0, -0.1, -0.12], rail: [0, -0.06, -0.34],
};
const RIGHT_HAND: [number, number, number] = [0, -0.1, 0.07];

const glove = new THREE.MeshPhongMaterial({ color: 0x1b1e24, specular: 0x445060, shininess: 40 });
const plate = new THREE.MeshPhongMaterial({ color: 0x59626f, specular: 0xaab4c4, shininess: 90 });
const sleeve = new THREE.MeshPhongMaterial({ color: 0x2c323b, specular: 0x556070, shininess: 50 });

function rbox(w: number, h: number, d: number, m: THREE.Material, r = 0.01) { return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m); }

/** Gloved hand wrapped around a grip, with a forearm sleeve running back toward the camera. side: +1 right, -1 left */
function buildHand(side: number, accent: THREE.Material, reach: [number, number, number]): THREE.Group {
  const g = new THREE.Group();
  const palm = rbox(0.07, 0.075, 0.1, glove, 0.02); g.add(palm);
  for (let i = 0; i < 4; i++) { const f = rbox(0.016, 0.02, 0.085, glove, 0.007); f.position.set(-side * 0.0 + (i - 1.5) * 0.0, -0.03 + (i - 1.5) * 0.0, 0); f.position.set(0, 0, 0); f.rotation.z = 0; f.position.set(side * 0.04, -0.02 + (i - 1.5) * 0.02, -0.0); f.scale.set(1, 1, 1); g.add(f); }
  const thumb = rbox(0.02, 0.022, 0.06, glove, 0.008); thumb.position.set(-side * 0.04, 0.03, -0.02); thumb.rotation.y = side * 0.4; g.add(thumb);
  const knuckle = rbox(0.078, 0.018, 0.05, plate, 0.006); knuckle.position.set(0, 0.045, -0.02); g.add(knuckle);
  // forearm: tapered sleeve from the wrist back toward the camera
  const len = Math.hypot(...reach);
  const arm = new THREE.Group();
  const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.034, len, 20).rotateX(Math.PI / 2), sleeve); sl.position.z = len / 2 + 0.03; arm.add(sl);
  const gaunt = rbox(0.072, 0.058, 0.16, plate, 0.014); gaunt.position.set(0, 0.0, 0.13); arm.add(gaunt);
  const stripe = rbox(0.022, 0.008, 0.12, accent, 0.002); stripe.position.set(0, 0.033, 0.13); arm.add(stripe);
  arm.lookAt(new THREE.Vector3(...reach)); // arm's +Z points along `reach`
  g.add(arm);
  return g;
}

export class Viewmodel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.01, 10);
  private root = new THREE.Group();
  private models = new Map<WeaponId, { holder: THREE.Group; model: WeaponModel; flash: THREE.Mesh; flashLight: THREE.Mesh }>();
  current: WeaponId = 'rocket';
  private pending: WeaponId = 'rocket';
  private raise = 1;
  private kick = 0; private bobT = 0; private swayX = 0; private swayY = 0; private cooldown = 0; private flashT = 0; private spin = 0;
  onSwitch?: (id: WeaponId) => void;
  onFire?: (id: WeaponId, muzzle: THREE.Vector3) => void;

  constructor() {
    this.scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x4a3a8a, 2.4));
    this.scene.add(new THREE.AmbientLight(0x8090b0, 1.0));
    const key = new THREE.DirectionalLight(0xfff0e0, 3.4); key.position.set(-1.5, 2, 1.5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8aa0ff, 2.0); rim.position.set(2, 1, -1); this.scene.add(rim);
    this.scene.add(this.camera, this.root);
    this.root.position.set(0.19, -0.2, -0.62);

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
      model.group.scale.setScalar(GUN_SCALE); holder.add(model.group);
      const accent = new THREE.MeshBasicMaterial({ color: new THREE.Color(WEAPON_DEFS[id].color).multiplyScalar(0.9) });
      const rh = buildHand(1, accent, [0.28, -0.3, 0.5]); rh.position.set(...RIGHT_HAND.map(v => v * GUN_SCALE) as [number, number, number]); rh.rotation.x = 0.1; holder.add(rh);
      const lh = buildHand(-1, accent, [-0.3, -0.28, 0.5]); lh.position.set(...LEFT_HAND[id].map(v => v * GUN_SCALE) as [number, number, number]); holder.add(lh);
      const fm = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(WEAPON_DEFS[id].color).lerp(new THREE.Color(1, 1, 1), 0.5) });
      const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), fm); flash.visible = false;
      flash.position.copy(model.muzzle.position).multiplyScalar(GUN_SCALE); flash.position.z -= 0.02; holder.add(flash);
      holder.visible = false; this.root.add(holder);
      this.models.set(id, { holder, model, flash, flashLight: flash });
    }
    this.models.get(this.current)!.holder.visible = true;
  }

  resize(aspect: number) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  select(id: WeaponId) { if (id !== this.pending) { this.pending = id; } }
  cycle(dir: number) { const i = WEAPON_ORDER.indexOf(this.pending); this.select(WEAPON_ORDER[(i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length]); }

  update(dt: number, o: { speed: number; grounded: boolean; lookDX: number; lookDY: number; firing: boolean }) {
    // weapon swap: lower -> swap -> raise
    if (this.pending !== this.current) {
      this.raise -= dt * 7;
      if (this.raise <= 0) {
        this.models.get(this.current)!.holder.visible = false; this.current = this.pending;
        this.models.get(this.current)!.holder.visible = true; this.raise = 0; this.onSwitch?.(this.current);
      }
    } else this.raise = Math.min(1, this.raise + dt * 7);

    const F = FIRE[this.current]; const m = this.models.get(this.current)!;
    this.cooldown -= dt;
    if (o.firing && this.cooldown <= 0 && this.raise > 0.85) {
      this.cooldown = F.interval; this.kick = Math.min(1.6, this.kick + F.kick); this.flashT = 0.06 + F.flash * 0.03;
      m.flash.rotation.z = Math.random() * 6.28; m.flash.scale.setScalar(F.flash * (0.8 + Math.random() * 0.5));
      const wp = new THREE.Vector3(); m.model.muzzle.getWorldPosition(wp); this.onFire?.(this.current, wp);
    }
    this.kick = Math.max(0, this.kick - dt * 9);
    this.flashT -= dt; m.flash.visible = this.flashT > 0;
    for (const g of m.model.glow) g.color.setScalar(1.0).multiplyScalar(1); // keep base colour; pulse below
    const pulse = 1 + 0.35 * Math.sin(performance.now() / 160) + (this.flashT > 0 ? 1.2 : 0);
    for (const g of m.model.glow) g.color.set(WEAPON_DEFS[this.current].color).multiplyScalar(1.4 * pulse);
    if (m.model.spin) { this.spin += dt * (o.firing ? 38 : 3); m.model.spin.rotation.z = this.spin; }

    // bob + mouse sway
    const moving = o.grounded ? Math.min(1, o.speed / 10) : 0.15;
    this.bobT += dt * (6 + o.speed * 0.6);
    const bx = Math.cos(this.bobT * 0.5) * 0.006 * moving, by = Math.abs(Math.sin(this.bobT * 0.5)) * 0.008 * moving;
    this.swayX += (-o.lookDX * 0.0016 - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (o.lookDY * 0.0016 - this.swayY) * Math.min(1, dt * 10);
    const lower = (1 - this.raise) * (1 - this.raise);
    const h = m.holder;
    h.position.set(bx + this.swayX * 0.5, by - lower * 0.35 + this.swayY * 0.5, this.kick * 0.07);
    h.rotation.set(-this.kick * 0.06 + this.swayY - lower * 0.9, this.swayX, -this.swayX * 0.6 + Math.sin(this.bobT * 0.5) * 0.004 * moving);
  }
}
