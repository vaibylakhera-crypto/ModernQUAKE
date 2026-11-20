import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Original sci-fi weapon models, modelled from primitives. Every gun points down -Z, origin at the grip.
// Each returns { group, muzzle, glow[] } - `glow` materials can be pulsed when charging / firing.

export type WeaponId = 'scatter' | 'nailer' | 'rocket' | 'plasma' | 'rail';

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
  const gr = at(box(0.045, 0.16, 0.06, M.rubber, 0.015), 0, -0.1, z); gr.rotation.x = -0.28; g.add(gr);
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
  g.add(at(box(0.1, 0.1, 0.26, M.gun, 0.03), 0, -0.04, 0.24));                            // stock block
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
  g.add(at(box(0.1, 0.1, 0.1, M.gun, 0.03), 0, -0.01, 0.2));
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
  g.add(at(box(0.09, 0.12, 0.3, M.gun, 0.03), 0, 0.0, 0.28));                             // stock
  const muzzle = at(new THREE.Object3D(), 0, 0.03, -1.24); g.add(muzzle);
  return { group: g, muzzle, glow };
}

export interface WeaponModel { group: THREE.Group; muzzle: THREE.Object3D; glow: THREE.MeshBasicMaterial[]; spin?: THREE.Object3D }

export const WEAPON_DEFS: Record<WeaponId, { name: string; build: () => WeaponModel; color: number }> = {
  scatter: { name: 'WARDEN',     build: scatter, color: 0xff7a1a },
  nailer:  { name: 'RIVET',      build: nailer,  color: 0xffc02d },
  rocket:  { name: 'HAMMERFALL', build: rocket,  color: 0xff3a2a },
  plasma:  { name: 'PULSE',      build: plasma,  color: 0x35d0ff },
  rail:    { name: 'LONGSHOT',   build: rail,    color: 0x4af0ff },
};
export const WEAPON_ORDER: WeaponId[] = ['scatter', 'nailer', 'rocket', 'plasma', 'rail'];
export const buildWeapon = (id: WeaponId): WeaponModel => WEAPON_DEFS[id].build();
