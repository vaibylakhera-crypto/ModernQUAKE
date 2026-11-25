import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Original sci-fi weapon models, modelled from primitives. Every gun points down -Z, origin at the grip.
// Each returns { group, muzzle, glow[] } - `glow` materials can be pulsed when charging / firing.

export type WeaponId = 'blade' | 'pistol' | 'scatter' | 'nailer' | 'rocket' | 'arc' | 'rail' | 'plasma';

const phong = (color: number, shininess = 60, specular = 0x667080) => new THREE.MeshPhongMaterial({ color, specular, shininess });
const M = {
  gun: phong(0x3a414d, 70),
  gunLight: phong(0x5d6676, 80),
  steel: phong(0xa4adbb, 110, 0xccd6e6),
  black: phong(0x0f1115, 30, 0x222222),
  rubber: new THREE.MeshLambertMaterial({ color: 0x15171b }),
  hazard: phong(0xd9a21b, 40),
};
const glowMat = (c: number, k = 1.8) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });

function cyl(r1: number, r2: number, len: number, mat: THREE.Material, seg = 28): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r1, r2, len, seg, 1).rotateX(Math.PI / 2);   // axis along Z
  return new THREE.Mesh(g, mat);
}
function box(w: number, h: number, d: number, mat: THREE.Material, r = 0.008): THREE.Mesh {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
}
function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T { o.position.set(x, y, z); return o; }

function grip(g: THREE.Group, z = 0.06) {
  const gr = at(box(0.064, 0.16, 0.078, M.rubber, 0.02), 0, -0.1, z); gr.rotation.x = -0.28; g.add(gr);
  g.add(at(box(0.012, 0.05, 0.1, M.gun, 0.004), 0, -0.04, z - 0.07));                    // trigger guard front
  g.add(at(box(0.012, 0.012, 0.1, M.gun, 0.004), 0, -0.075, z - 0.075));                 // trigger guard bottom
  g.add(at(box(0.008, 0.028, 0.012, M.steel, 0.003), 0, -0.04, z - 0.04));               // trigger
}

function ring(g: THREE.Group, r: number, z: number, len: number, mat: THREE.Material) { g.add(at(cyl(r, r, len, mat), 0, 0, z)); }

// ───────────────────────── Scattergun "Warden": pump shotgun, twin barrels, heat-sink fins
function scatter() {
  const g = new THREE.Group(), glow: THREE.MeshBasicMaterial[] = [];
  const hot = glowMat(0xff7a1a); glow.push(hot);
  for (const sx of [-0.036, 0.036]) {
    g.add(at(cyl(0.033, 0.033, 0.78, M.steel), sx, 0.02, -0.46));
    g.add(at(cyl(0.039, 0.039, 0.05, M.gun), sx, 0.02, -0.86));                          // muzzle collar
    g.add(at(cyl(0.026, 0.026, 0.012, M.black), sx, 0.02, -0.887));                      // bore
  }
  for (let i = 0; i < 6; i++) g.add(at(box(0.15, 0.012, 0.018, M.gunLight, 0.003), 0, 0.075, -0.30 - i * 0.045));   // heat fins
  g.add(at(box(0.13, 0.15, 0.34, M.gun, 0.02), 0, -0.01, -0.02));                         // receiver
  g.add(at(box(0.105, 0.05, 0.24, M.gunLight, 0.012), 0, 0.085, -0.02));
  g.add(at(box(0.138, 0.012, 0.3, hot, 0.002), 0, -0.065, -0.02));                        // underglow strip
  const pump = at(box(0.1, 0.075, 0.2, M.gunLight, 0.02), 0, -0.065, -0.42); g.add(pump);
  for (let i = 0; i < 5; i++) g.add(at(box(0.104, 0.078, 0.008, M.black, 0.002), 0, -0.065, -0.5 + i * 0.04));
  g.add(at(box(0.022, 0.03, 0.05, M.gunLight, 0.006), 0.075, 0.03, 0.04));               // charging handle
  grip(g, 0.1);
  const muzzle = at(new THREE.Object3D(), 0, 0.02, -0.9); g.add(muzzle);
  return { group: g, muzzle, glow };
}

// ───────────────────────── Nailer "Rivet": rotary multi-barrel
function nailer() {
  const g = new THREE.Group(), glow: THREE.MeshBasicMaterial[] = [];
  const amber = glowMat(0xffc02d); glow.push(amber);
  g.add(at(box(0.13, 0.17, 0.4, M.gun, 0.025), 0, 0, -0.08));
  g.add(at(box(0.1, 0.05, 0.3, M.gunLight, 0.012), 0, 0.105, -0.1));
  const rot = new THREE.Group(); rot.position.set(0, 0.005, -0.52); rot.name = 'rotor';
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; rot.add(at(cyl(0.017, 0.017, 0.5, M.steel, 14), Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0)); }
  for (const z of [-0.22, 0, 0.22]) rot.add(at(cyl(0.078, 0.078, 0.035, M.gun), 0, 0, z));
  rot.add(at(cyl(0.032, 0.032, 0.52, M.black, 16), 0, 0, 0));
  g.add(rot);
  g.add(at(cyl(0.09, 0.09, 0.05, M.gunLight), 0, 0.005, -0.78));
  g.add(at(box(0.15, 0.014, 0.26, amber, 0.003), 0, -0.088, -0.08));
  g.add(at(box(0.095, 0.15, 0.13, M.gunLight, 0.02), 0, -0.14, -0.1));                    // ammo box
  g.add(at(box(0.098, 0.02, 0.134, amber, 0.004), 0, -0.19, -0.1));
  grip(g, 0.1);
  const muzzle = at(new THREE.Object3D(), 0, 0.005, -0.82); g.add(muzzle);
  return { group: g, muzzle, glow, spin: rot };
}

// ───────────────────────── Rocket launcher "Hammerfall": shoulder tube, side magazine, hazard bands
function rocket() {
  const g = new THREE.Group(), glow: THREE.MeshBasicMaterial[] = [];
  const red = glowMat(0xff2a1a, 2.2); glow.push(red);
  const orange = glowMat(0xff8a1a);
  g.add(at(cyl(0.078, 0.078, 0.8, M.gun), 0, 0.03, -0.42));                               // main tube
  g.add(at(cyl(0.078, 0.118, 0.2, M.gunLight), 0, 0.03, 0.08));                           // rear flare
  g.add(at(cyl(0.118, 0.118, 0.03, M.steel), 0, 0.03, 0.18));                              // exhaust rim
  g.add(at(cyl(0.097, 0.097, 0.012, M.black), 0, 0.03, 0.197));                            // dark back-blast opening
  g.add(at(cyl(0.05, 0.05, 0.004, glowMat(0xff5a1a, 1.2)), 0, 0.03, 0.2));                 // ember glow inside
  g.add(at(cyl(0.104, 0.104, 0.09, M.steel), 0, 0.03, -0.84));                            // muzzle ring
  g.add(at(cyl(0.108, 0.108, 0.02, M.hazard), 0, 0.03, -0.9));
  g.add(at(cyl(0.07, 0.07, 0.006, M.black), 0, 0.03, -0.912));                            // dark bore
  for (const z of [-0.2, -0.5]) g.add(at(cyl(0.09, 0.09, 0.05, M.steel), 0, 0.03, z));
  for (const z of [-0.265, -0.435]) g.add(at(cyl(0.083, 0.083, 0.014, orange), 0, 0.03, z));
  g.add(at(box(0.055, 0.035, 0.42, M.gunLight, 0.01), 0, 0.125, -0.36));                  // top rail
  g.add(at(box(0.02, 0.05, 0.02, M.steel, 0.004), 0, 0.16, -0.58));                       // front sight post
  g.add(at(box(0.05, 0.03, 0.03, M.steel, 0.006), 0, 0.15, -0.16));                      // rear sight
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), red), 0, 0.155, -0.12));// armed light
  const mag = at(box(0.1, 0.12, 0.3, M.gun, 0.02), -0.125, -0.005, -0.28); g.add(mag);    // side magazine
  g.add(at(box(0.102, 0.016, 0.26, orange, 0.003), -0.125, 0.06, -0.28));
  g.add(at(box(0.05, 0.12, 0.08, M.gunLight, 0.015), 0, -0.1, -0.5));                     // foregrip
  grip(g, 0.0);
  const muzzle = at(new THREE.Object3D(), 0, 0.03, -0.92); g.add(muzzle);
  return { group: g, muzzle, glow };
}

// ───────────────────────── Plasma rifle "Pulse": emitter dish + glowing plasma chamber
function plasma() {
  const g = new THREE.Group(), glow: THREE.MeshBasicMaterial[] = [];
  const blue = glowMat(0x35d0ff, 2.0); glow.push(blue);
  g.add(at(box(0.14, 0.17, 0.46, M.gun, 0.03), 0, 0, -0.12));
  g.add(at(box(0.11, 0.05, 0.34, M.gunLight, 0.012), 0, 0.105, -0.12));
  g.add(at(cyl(0.04, 0.095, 0.16, M.gunLight), 0, 0.01, -0.42));                          // emitter flare
  g.add(at(cyl(0.1, 0.1, 0.03, M.steel), 0, 0.01, -0.5));
  g.add(at(cyl(0.07, 0.07, 0.01, blue), 0, 0.01, -0.516));                                // emitter glow disc
  for (let i = 0; i < 3; i++) g.add(at(cyl(0.062 + i * 0.006, 0.062 + i * 0.006, 0.012, M.steel), 0, 0.01, -0.36 - i * 0.045));
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.062, 24, 18), new THREE.MeshPhongMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.35, shininess: 120, specular: 0xffffff, depthWrite: false }));
  g.add(at(shell, 0, 0.16, -0.16));
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.036, 18, 14), blue), 0, 0.16, -0.16));  // plasma core
  g.add(at(cyl(0.07, 0.07, 0.03, M.steel), 0, 0.105, -0.16));
  for (const sx of [-0.072, 0.072]) for (let i = 0; i < 4; i++) g.add(at(box(0.006, 0.07, 0.022, blue, 0.002), sx, 0.0, -0.02 - i * 0.05));   // side vents
  g.add(at(box(0.145, 0.012, 0.34, blue, 0.002), 0, -0.09, -0.12));
  grip(g, 0.1);
  const muzzle = at(new THREE.Object3D(), 0, 0.01, -0.52); g.add(muzzle);
  return { group: g, muzzle, glow };
}

// ───────────────────────── Railgun "Longshot": coil stack, slim barrel, glowing capacitor
function rail() {
  const g = new THREE.Group(), glow: THREE.MeshBasicMaterial[] = [];
  const cy = glowMat(0x4af0ff, 2.2); glow.push(cy);
  g.add(at(cyl(0.017, 0.017, 1.15, M.steel, 14), 0, 0.03, -0.62));                        // rail barrel
  g.add(at(cyl(0.028, 0.028, 1.1, M.black, 14), 0, 0.03, -0.62));
  g.add(at(cyl(0.012, 0.012, 1.18, M.steel, 10), 0, 0.075, -0.62));                       // upper rail
  g.add(at(cyl(0.012, 0.012, 1.18, M.steel, 10), 0, -0.015, -0.62));                      // lower rail
  for (let i = 0; i < 8; i++) {
    const z = -0.3 - i * 0.1;
    g.add(at(cyl(0.062, 0.062, 0.026, M.gunLight), 0, 0.03, z));
    g.add(at(cyl(0.064, 0.064, 0.008, cy), 0, 0.03, z - 0.017));                          // coil glow band
  }
  g.add(at(cyl(0.05, 0.05, 0.06, M.gun), 0, 0.03, -1.2));                                 // muzzle brake
  g.add(at(box(0.12, 0.17, 0.34, M.gun, 0.025), 0, 0.01, 0.02));                          // rear housing
  g.add(at(box(0.1, 0.05, 0.28, M.gunLight, 0.012), 0, 0.105, 0.02));
  g.add(at(box(0.125, 0.022, 0.2, cy, 0.004), 0, 0.035, 0.0));                            // capacitor window
  g.add(at(box(0.1, 0.12, 0.12, M.gunLight, 0.02), 0, -0.055, -0.2));                     // under-barrel block
  g.add(at(box(0.03, 0.07, 0.34, M.gunLight, 0.01), 0, 0.15, -0.55));                     // scope rail
  g.add(at(cyl(0.025, 0.025, 0.16, M.black, 16), 0, 0.2, -0.5));                          // scope tube
  g.add(at(cyl(0.022, 0.022, 0.004, cy, 16), 0, 0.2, -0.582));                            // scope lens
  grip(g, 0.1);
  const muzzle = at(new THREE.Object3D(), 0, 0.03, -1.24); g.add(muzzle);
  return { group: g, muzzle, glow };
}

// ───────────────────────── Blade "Edge": vibro-blade, always available
function blade() {
  const g = new THREE.Group(), glow: THREE.MeshBasicMaterial[] = [];
  const core = glowMat(0xb8f6ff, 1.6); glow.push(core);
  g.add(at(cyl(0.022, 0.02, 0.2, M.rubber, 16), 0, 0, 0.02));
  for (let i = 0; i < 4; i++) g.add(at(cyl(0.0235, 0.0235, 0.012, M.gunLight, 16), 0, 0, 0.07 - i * 0.045));
  g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 12), M.steel), 0, 0, 0.13));
  g.add(at(box(0.11, 0.024, 0.035, M.steel, 0.008), 0, 0, -0.085));                         // guard
  g.add(at(box(0.02, 0.07, 0.04, M.gun, 0.006), 0.05, 0, -0.095)); g.add(at(box(0.02, 0.07, 0.04, M.gun, 0.006), -0.05, 0, -0.095));
  g.add(at(box(0.02, 0.05, 0.1, M.gunLight, 0.006), 0, 0, -0.12));                          // emitter housing
  const blade = at(box(0.012, 0.06, 0.62, core, 0.004), 0, 0, -0.45); g.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4).rotateX(-Math.PI / 2).rotateZ(Math.PI / 2), core); tip.position.set(0, 0, -0.82); tip.scale.set(0.4, 1, 1); g.add(tip);
  const halo = new THREE.MeshBasicMaterial({ color: 0x36d6ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false });
  g.add(at(box(0.05, 0.11, 0.64, halo, 0.02), 0, 0, -0.45));
  const muzzle = at(new THREE.Object3D(), 0, 0, -0.8); g.add(muzzle);
  return { group: g, muzzle, glow };
}

// ───────────────────────── Pistol "Sidearm": compact energy pistol, starting weapon
function pistol() {
  const g = new THREE.Group(), glow: THREE.MeshBasicMaterial[] = [];
  const g1 = glowMat(0xffe14a, 1.8); glow.push(g1);
  g.add(at(box(0.05, 0.06, 0.26, M.gun, 0.014), 0, 0.02, -0.1));                            // slide
  g.add(at(box(0.04, 0.025, 0.2, M.gunLight, 0.008), 0, 0.058, -0.1));                      // top plate
  g.add(at(cyl(0.014, 0.014, 0.07, M.steel, 14), 0, 0.02, -0.26));                          // barrel
  g.add(at(cyl(0.02, 0.02, 0.016, M.black, 14), 0, 0.02, -0.298));
  g.add(at(box(0.052, 0.012, 0.12, g1, 0.002), 0, 0.02, -0.12));                            // energy strip
  g.add(at(box(0.052, 0.05, 0.1, M.gunLight, 0.01), 0, -0.02, 0.0));                        // frame
  g.add(at(box(0.012, 0.03, 0.03, M.steel, 0.004), 0, 0.075, -0.2));                        // front sight
  grip(g, 0.035);
  const muzzle = at(new THREE.Object3D(), 0, 0.02, -0.3); g.add(muzzle);
  return { group: g, muzzle, glow };
}

// ───────────────────────── Arc gun "Stormcaller": twin prongs + electrode, power cell
function arc() {
  const g = new THREE.Group(), glow: THREE.MeshBasicMaterial[] = [];
  const vio = glowMat(0x8f6bff, 2.2); glow.push(vio);
  g.add(at(box(0.12, 0.15, 0.34, M.gun, 0.025), 0, 0, -0.05));
  g.add(at(box(0.09, 0.05, 0.26, M.gunLight, 0.012), 0, 0.1, -0.05));
  const cell = at(cyl(0.056, 0.056, 0.22, M.gunLight, 24), 0, 0.02, 0.22); g.add(cell);
  for (let i = 0; i < 3; i++) g.add(at(cyl(0.058, 0.058, 0.02, vio, 24), 0, 0.02, 0.15 + i * 0.07));
  for (const sx of [-1, 1]) {
    const p = box(0.02, 0.034, 0.36, M.steel, 0.008); p.position.set(sx * 0.05, 0.03, -0.37); p.rotation.y = sx * 0.07; g.add(p);   // prongs angle inward
    g.add(at(new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 10), vio), sx * 0.034, 0.03, -0.545));
  }
  g.add(at(cyl(0.01, 0.01, 0.4, vio, 10), 0, 0.03, -0.36));                                  // central electrode
  for (let i = 0; i < 4; i++) g.add(at(cyl(0.045, 0.045, 0.014, M.gunLight, 18), 0, 0.03, -0.26 - i * 0.07));
  g.add(at(box(0.125, 0.012, 0.28, vio, 0.002), 0, -0.07, -0.05));
  grip(g, 0.08);
  const muzzle = at(new THREE.Object3D(), 0, 0.03, -0.56); g.add(muzzle);
  return { group: g, muzzle, glow };
}

export interface WeaponModel { group: THREE.Group; muzzle: THREE.Object3D; glow: THREE.MeshBasicMaterial[]; spin?: THREE.Object3D }

export interface WeaponStats {
  slot: number; interval: number; auto: boolean; kind: 'melee' | 'hitscan' | 'projectile' | 'beam' | 'rail';
  damage: number; ammoStart: number; ammoMax: number; ammoPickup: number;   // ammo -1 = infinite
  speed?: number; pellets?: number; spread?: number; range?: number; splash?: number; knock?: number; ammoPerShot?: number;
}

export const WEAPON_DEFS: Record<WeaponId, { name: string; build: () => WeaponModel; color: number; stats: WeaponStats }> = {
  blade:   { name: 'EDGE',       build: blade,   color: 0x5ee8ff, stats: { slot: 1, interval: 0.38, auto: false, kind: 'melee', damage: 50, ammoStart: -1, ammoMax: -1, ammoPickup: 0, range: 2.1 } },
  pistol:  { name: 'SIDEARM',    build: pistol,  color: 0xffe14a, stats: { slot: 2, interval: 0.26, auto: false, kind: 'hitscan', damage: 12, ammoStart: -1, ammoMax: -1, ammoPickup: 0, spread: 0.004, range: 200 } },
  scatter: { name: 'WARDEN',     build: scatter, color: 0xff7a1a, stats: { slot: 3, interval: 0.9, auto: false, kind: 'hitscan', damage: 8, pellets: 12, spread: 0.055, range: 60, ammoStart: 12, ammoMax: 30, ammoPickup: 10 } },
  nailer:  { name: 'RIVET',      build: nailer,  color: 0xffc02d, stats: { slot: 4, interval: 0.085, auto: true, kind: 'projectile', damage: 9, speed: 55, spread: 0.012, ammoStart: 60, ammoMax: 200, ammoPickup: 50 } },
  rocket:  { name: 'HAMMERFALL', build: rocket,  color: 0xff3a2a, stats: { slot: 5, interval: 0.8, auto: false, kind: 'projectile', damage: 100, speed: 28, splash: 4.2, knock: 17, ammoStart: 5, ammoMax: 25, ammoPickup: 5 } },
  arc:     { name: 'STORMCALLER', build: arc,    color: 0x9a7bff, stats: { slot: 6, interval: 0.05, auto: true, kind: 'beam', damage: 6, range: 18, ammoStart: 80, ammoMax: 200, ammoPickup: 50 } },
  rail:    { name: 'LONGSHOT',   build: rail,    color: 0x4af0ff, stats: { slot: 7, interval: 1.4, auto: false, kind: 'rail', damage: 100, range: 400, ammoStart: 5, ammoMax: 25, ammoPickup: 5 } },
  plasma:  { name: 'PULSE',      build: plasma,  color: 0x35d0ff, stats: { slot: 8, interval: 0.11, auto: true, kind: 'projectile', damage: 14, speed: 45, splash: 1.4, knock: 3, ammoStart: 50, ammoMax: 200, ammoPickup: 40 } },
};
export const WEAPON_ORDER: WeaponId[] = ['blade', 'pistol', 'scatter', 'nailer', 'rocket', 'arc', 'rail', 'plasma'];
export const buildWeapon = (id: WeaponId): WeaponModel => WEAPON_DEFS[id].build();
