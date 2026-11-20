import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rig, makeRig, Gender } from './character';

// "Vanguard" armour: original plates authored in bind-pose (T-pose) world space, attached to the matching bones,
// merged per bone+material so a fully armoured fighter costs ~20 draw calls.

interface Piece { bone: string; geo: THREE.BufferGeometry; m: THREE.Matrix4; mat: 'armor' | 'dark' | 'glow' | 'trim' }

const rb = (w: number, h: number, d: number, r = 0.02) => new RoundedBoxGeometry(w, h, d, 3, r);
const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const strip = (g: THREE.BufferGeometry) => { for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n); return g; };

export interface Dressed extends Rig { teamColor: number }

export async function buildFighter(gender: Gender, teamColor: number, armorColor = 0x8d97ab): Promise<Dressed> {
  const rig = await makeRig(gender);
  rig.root.updateMatrixWorld(true);
  const P: Piece[] = [];
  const add = (bone: string, geo: THREE.BufferGeometry, m: THREE.Matrix4, mat: Piece['mat'] = 'armor') => P.push({ bone, geo: strip(geo.index ? geo : geo), m, mat });
  const mirror = (f: (s: number, side: string) => void) => { f(1, 'l'); f(-1, 'r'); };

  // hide the bare face/eyebrows: a helmet covers them
  rig.root.traverse(o => { if (o.name === 'Eyes' || o.name === 'Eyebrows' || o.name.startsWith('Face')) o.visible = false; });

  // ───────── bodysuit: dark tint on the skin texture keeps the baked anatomy shading
  // tint colour cancels the warm skin tone -> dark blue-grey suit, baked anatomy shading kept
  const body = rig.body; const src = body.material as THREE.MeshStandardMaterial;
  body.material = new THREE.MeshLambertMaterial({ map: src.map, color: new THREE.Color(0.1, 0.2, 0.55) });

  // ───────── helmet
  add('Head', new THREE.SphereGeometry(1, 28, 20), T(0, 1.715, -0.012, 0, 0, 0, 0.128, 0.146, 0.158));                 // shell
  add('Head', rb(0.215, 0.062, 0.07, 0.02), T(0, 1.705, 0.112, -0.05), 'dark');                                          // visor
  add('Head', rb(0.2, 0.012, 0.06, 0.004), T(0, 1.708, 0.139, -0.05), 'glow');                                           // visor glow
  add('Head', rb(0.17, 0.07, 0.085, 0.02), T(0, 1.628, 0.07, 0.15), 'armor');                                            // jaw / chin guard
  add('Head', rb(0.018, 0.09, 0.2, 0.006), T(0, 1.815, -0.02, 0.08), 'trim');                                            // top fin
  mirror(s => { add('Head', new THREE.CylinderGeometry(0.036, 0.036, 0.05, 16).rotateZ(Math.PI / 2), T(s * 0.128, 1.7, -0.015), 'dark'); add('Head', new THREE.CylinderGeometry(0.02, 0.02, 0.012, 12).rotateZ(Math.PI / 2), T(s * 0.156, 1.7, -0.015), 'glow'); });
  add('neck_01', new THREE.CylinderGeometry(0.062, 0.075, 0.1, 16), T(0, 1.545, -0.035), 'dark');                          // neck collar

  // ───────── torso: chest plate, back plate, ribs, belt, thruster pack
  add('spine_03', rb(0.36, 0.25, 0.2, 0.06), T(0, 1.34, 0.03, 0.05));
  add('spine_03', rb(0.2, 0.2, 0.05, 0.02), T(0, 1.34, 0.158, 0.05), 'trim');                                             // sternum plate
  add('spine_03', rb(0.1, 0.012, 0.012, 0.003), T(0, 1.385, 0.186, 0.05), 'glow');                                        // chest light
  add('spine_03', rb(0.36, 0.26, 0.15, 0.04), T(0, 1.34, -0.14, -0.04));                                                  // back plate
  add('spine_03', rb(0.22, 0.2, 0.1, 0.03), T(0, 1.33, -0.235, -0.02), 'dark');                                           // pack
  mirror(s => { add('spine_03', rb(0.05, 0.16, 0.05, 0.01), T(s * 0.07, 1.3, -0.29), 'glow'); add('spine_03', rb(0.035, 0.28, 0.035, 0.01), T(s * 0.12, 1.45, -0.275, 0.08), 'trim'); });
  add('spine_02', rb(0.33, 0.12, 0.2, 0.035), T(0, 1.14, 0.01), 'dark');                                                   // abdomen
  add('pelvis', rb(0.37, 0.085, 0.235, 0.03), T(0, 0.985, -0.01), 'trim');                                                 // belt
  add('pelvis', rb(0.085, 0.07, 0.03, 0.01), T(0, 0.985, 0.113), 'glow');                                                  // buckle light
  add('pelvis', rb(0.16, 0.09, 0.05, 0.015), T(0, 0.925, 0.11), 'armor');                                                  // groin guard

  // ───────── shoulders / arms
  mirror((s, side) => {
    add('clavicle_' + side, new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), T(s * 0.265, 1.5, -0.07, 0, 0, s * -0.3, 0.105, 0.085, 0.115));   // pauldron dome
    add('clavicle_' + side, rb(0.09, 0.014, 0.125, 0.006), T(s * 0.28, 1.47, -0.07, 0, 0, s * -0.3), 'trim');                                                   // pauldron rim
    add('upperarm_' + side, new THREE.CylinderGeometry(0.058, 0.052, 0.2, 16).rotateZ(Math.PI / 2), T(s * 0.34, 1.455, -0.07), 'dark');                         // arm band
    add('lowerarm_' + side, new THREE.CylinderGeometry(0.058, 0.049, 0.235, 18).rotateZ(Math.PI / 2), T(s * 0.595, 1.46, -0.07));                               // gauntlet
    add('lowerarm_' + side, rb(0.14, 0.03, 0.06, 0.012), T(s * 0.595, 1.51, -0.07), 'trim');
    add('lowerarm_' + side, rb(0.1, 0.01, 0.025, 0.003), T(s * 0.6, 1.526, -0.07), 'glow');
    add('lowerarm_' + side, new THREE.CylinderGeometry(0.062, 0.062, 0.025, 18).rotateZ(Math.PI / 2), T(s * 0.49, 1.46, -0.07), 'dark');                         // elbow cuff
  });

  // ───────── legs
  mirror((s, side) => {
    add('thigh_' + side, rb(0.115, 0.27, 0.125, 0.04), T(s * 0.118, 0.83, 0.03));                                             // thigh plate
    add('thigh_' + side, rb(0.07, 0.014, 0.03, 0.004), T(s * 0.118, 0.86, 0.095), 'glow');
    add('calf_' + side, new THREE.SphereGeometry(1, 16, 12), T(s * 0.115, 0.545, 0.05, 0, 0, 0, 0.085, 0.07, 0.07), 'trim');  // knee cap
    add('calf_' + side, rb(0.095, 0.27, 0.105, 0.035), T(s * 0.115, 0.33, 0.02));                                             // shin guard
    add('calf_' + side, rb(0.06, 0.012, 0.02, 0.003), T(s * 0.115, 0.4, 0.075), 'glow');
    add('foot_' + side, rb(0.115, 0.085, 0.27, 0.03), T(s * 0.115, 0.06, 0.035), 'dark');                                    // boot
    add('foot_' + side, rb(0.125, 0.025, 0.285, 0.01), T(s * 0.115, 0.015, 0.04), 'trim');                                   // sole
  });

  // ───────── merge by (bone, material) into bone-local space
  const mats = {
    armor: new THREE.MeshPhongMaterial({ color: armorColor, emissive: new THREE.Color(armorColor).multiplyScalar(0.22), specular: 0x9aa6b8, shininess: 38 }),
    dark: new THREE.MeshPhongMaterial({ color: 0x3a414d, emissive: 0x0c0f14, specular: 0x4a5668, shininess: 40 }),
    trim: new THREE.MeshPhongMaterial({ color: new THREE.Color(armorColor).multiplyScalar(0.6), emissive: new THREE.Color(teamColor).multiplyScalar(0.1), specular: 0x667488, shininess: 60 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColor).multiplyScalar(1.7) }),
  };
  const groups = new Map<string, THREE.BufferGeometry[]>();
  for (const p of P) {
    const bone = rig.bones[p.bone]; if (!bone) continue;
    const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert();
    let g = p.geo.clone(); if (g.index) g = g.toNonIndexed(); strip(g);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, p.m));
    const k = p.bone + '|' + p.mat; let l = groups.get(k); if (!l) groups.set(k, (l = [])); l.push(g);
  }
  for (const [k, geos] of groups) {
    const [bn, mn] = k.split('|'); const merged = mergeGeometries(geos); if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mats[mn as keyof typeof mats]); mesh.frustumCulled = false; rig.bones[bn].add(mesh);
  }
  return Object.assign(rig, { teamColor }) as Dressed;
}
