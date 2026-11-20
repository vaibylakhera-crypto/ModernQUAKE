import * as THREE from 'three';
import { Rig, poseBone } from './character';
import { buildWeapon, WeaponId } from './weapons';

// Procedural animation for the base rig. Deltas are WORLD-space rotations relative to the T-pose
// (character faces +Z, character-left is +X). Composition `A.mul(B)` means B is applied first, then A.

const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const R = (axis: 'x' | 'y' | 'z', a: number) => new THREE.Quaternion().setFromAxisAngle(AX[axis], a);
const mul = (...qs: THREE.Quaternion[]) => qs.reduce((a, b) => a.clone().multiply(b));
const ID = new THREE.Quaternion();
const D = Math.PI / 180;

export interface AnimState {
  t: number;          // seconds
  speed: number;      // 0..1 of run speed
  dead: number;       // 0..1 fall progress
  look: number;       // head yaw offset (rad)
  pain: number;       // 0..1 flinch
  fire: number;       // 0..1 recoil kick
}

export const ORDER = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];

/** two-handed rifle-ready stance with an optional recoil kick */
function armsHold(rig: Rig, fire: number, bob: number) {
  const k = fire * 6 * D;
  // right arm (-X in T-pose): down-forward, elbow bent up toward the grip
  poseBone(rig, 'upperarm_r', mul(R('x', (62 + k * 0.5) * D), R('y', 62 * D)));
  poseBone(rig, 'lowerarm_r', mul(R('x', (-12 - k) * D), R('y', 108 * D)));
  poseBone(rig, 'hand_r', mul(R('x', (-12 - k) * D), R('y', 108 * D)));
  // left arm (+X): reaches further forward to support the gun
  poseBone(rig, 'upperarm_l', mul(R('x', (52 + k * 0.5) * D), R('y', -56 * D)));
  poseBone(rig, 'lowerarm_l', mul(R('x', (-6 - k) * D), R('y', -84 * D)));
  poseBone(rig, 'hand_l', mul(R('x', (-6 - k) * D), R('y', -84 * D)));
  void bob;
}

export function animate(rig: Rig, a: AnimState) {
  const run = a.speed;
  const ph = a.t * (7 + run * 5);
  const sw = Math.sin(ph), sw2 = Math.sin(ph + Math.PI);
  const bob = Math.abs(Math.cos(ph)) * 0.045 * run;

  // spine: lean into the run, twist toward the aim, flinch on damage
  const lean = (6 + run * 14) * D + a.pain * 0.25;
  poseBone(rig, 'pelvis', mul(R('y', sw * 0.12 * run), R('z', sw * 0.04 * run)));
  poseBone(rig, 'spine_01', mul(R('x', lean * 0.4), R('y', -sw * 0.1 * run)));
  poseBone(rig, 'spine_02', mul(R('x', lean * 0.35), R('y', -sw * 0.08 * run)));
  poseBone(rig, 'spine_03', mul(R('x', lean * 0.3 - a.fire * 0.05), R('y', 0.1)));
  poseBone(rig, 'neck_01', mul(R('x', -lean * 0.4), R('y', a.look * 0.4)));
  poseBone(rig, 'Head', mul(R('x', -lean * 0.3), R('y', a.look * 0.6)));
  poseBone(rig, 'clavicle_l', ID); poseBone(rig, 'clavicle_r', ID);

  armsHold(rig, a.fire, bob);

  // legs: swing about X (positive = backwards), knee flexes only when the leg moves back/up
  const amp = 0.95 * run + 0.0;
  const legs: [string, string, string, number][] = [['thigh_l', 'calf_l', 'foot_l', sw], ['thigh_r', 'calf_r', 'foot_r', sw2]];
  for (const [th, ca, ft, s] of legs) {
    const thigh = s * amp * 0.75 + (run < 0.05 ? 0.0 : 0);
    const knee = (Math.max(0, -Math.cos(ph + (s === sw ? 0 : Math.PI)) * 1.0) * 1.15 + 0.05) * (0.15 + run);
    poseBone(rig, th, R('x', thigh));
    poseBone(rig, ca, R('x', thigh + knee));
    poseBone(rig, ft, R('x', -0.15 * run + (thigh + knee) * 0.0));
  }

  // whole-body: bob + death fall (about the feet)
  rig.root.position.y = bob * (1 - a.dead);
  rig.root.rotation.x = -a.dead * (Math.PI / 2 - 0.05);
  rig.root.position.y -= a.dead * 0.12;
}

/** Put a weapon model in the right hand (grip centre on the palm, barrel along the character's forward). */
export function holdWeapon(rig: Rig, id: WeaponId): THREE.Group {
  const w = buildWeapon(id);
  const holder = new THREE.Group();
  w.group.position.set(0, 0.1, 0);                 // grip centre (0,-0.1) -> origin
  holder.add(w.group);
  holder.rotation.y = Math.PI;                     // guns point -Z; character faces +Z
  // place at the right hand in the current pose, then parent to the hand bone keeping the world transform
  rig.root.updateMatrixWorld(true);
  const hand = rig.bones['hand_r'];
  const wp = hand.getWorldPosition(new THREE.Vector3());
  holder.position.copy(wp).add(new THREE.Vector3(0.0, 0.01, 0.07));
  rig.root.add(holder); rig.root.updateMatrixWorld(true);
  hand.attach(holder);
  holder.traverse(o => { (o as THREE.Mesh).frustumCulled = false; });
  holder.userData.muzzle = w.muzzle;
  return holder;
}

// ───────────────────────── arm IK + finger curl (used for the first-person arms) ─────────────────────────
const _Z = new THREE.Vector3(0, 0, 1);

/**
 * Two-bone IK for one arm in the CHARACTER frame. The wrist is placed at `T`; the elbow bends toward `pole`.
 * The hand is oriented so its fingers point along `fingerDir` and its palm faces `palmN`; fingers curl by `curl` (0..1).
 */
export function ikArm(rig: Rig, side: 'l' | 'r', T: THREE.Vector3, pole: THREE.Vector3, fingerDir: THREE.Vector3, palmN: THREE.Vector3, curl: number) {
  const up = `upperarm_${side}`, lo = `lowerarm_${side}`, ha = `hand_${side}`;
  const S = rig.restPos[up], E0 = rig.restPos[lo], H0 = rig.restPos[ha];
  const L1 = E0.distanceTo(S), L2 = H0.distanceTo(E0);
  const toT = T.clone().sub(S); let d = toT.length();
  const max = (L1 + L2) * 0.997, min = Math.abs(L1 - L2) + 0.02;
  d = Math.min(max, Math.max(min, d)); toT.setLength(d);
  const u = toT.clone().normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const pp = pole.clone().sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
  const E = S.clone().addScaledVector(u, a).addScaledVector(pp, h);
  const W = S.clone().add(toT);
  const restU = E0.clone().sub(S).normalize(), restL = H0.clone().sub(E0).normalize();
  poseBone(rig, up, new THREE.Quaternion().setFromUnitVectors(restU, E.clone().sub(S).normalize()));
  poseBone(rig, lo, new THREE.Quaternion().setFromUnitVectors(restL, W.clone().sub(E).normalize()));

  // hand orientation: fingers along fingerDir, palm toward palmN
  const f = fingerDir.clone().normalize();
  const restF = rig.restPos[`middle_01_${side}`].clone().sub(H0).normalize();
  const q1 = new THREE.Quaternion().setFromUnitVectors(restF, f);
  const n1 = new THREE.Vector3(0, -1, 0).applyQuaternion(q1);
  const proj = (v: THREE.Vector3) => v.clone().sub(f.clone().multiplyScalar(v.dot(f))).normalize();
  const a1 = proj(n1), a2 = proj(palmN);
  let ang = Math.acos(Math.max(-1, Math.min(1, a1.dot(a2))));
  if (new THREE.Vector3().crossVectors(a1, a2).dot(f) < 0) ang = -ang;
  const dHand = new THREE.Quaternion().setFromAxisAngle(f, ang).multiply(q1);
  poseBone(rig, ha, dHand);

  // fingers: cumulative curl about the rest-pose Z axis (palms face down in the T-pose)
  const sign = side === 'l' ? -1 : 1;
  const per = [1.0, 1.15, 0.8];
  for (const fg of ['index', 'middle', 'ring', 'pinky']) {
    let cum = 0;
    for (let j = 1; j <= 3; j++) {
      cum += per[j - 1] * curl * (fg === 'pinky' ? 1.08 : 1);
      poseBone(rig, `${fg}_0${j}_${side}`, dHand.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_Z, sign * cum)));
    }
  }
  const tcum = [0.25, 0.35, 0.3];
  let tc = 0;
  for (let j = 1; j <= 3; j++) { tc += tcum[j - 1] * curl; poseBone(rig, `thumb_0${j}_${side}`, dHand.clone().multiply(new THREE.Quaternion().setFromAxisAngle(_Z, sign * tc))); }
}
