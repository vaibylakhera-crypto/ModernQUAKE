import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// Quaternius Universal Base Characters (CC0). Rigged, but ships with no animations and in underwear,
// so we dress it (bodysuit tint + armour plates attached to bones) and pose the bones ourselves.

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

export type Gender = 'male' | 'female';

export function loadBase(g: Gender): Promise<THREE.Group> {
  const file = g === 'male' ? 'Superhero_Male_FullBody' : 'Superhero_Female_FullBody';
  let p = cache.get(file);
  if (!p) { p = loader.loadAsync(`/chars/${file}.gltf`).then(r => r.scene); cache.set(file, p); }
  return p;
}

export interface Rig {
  root: THREE.Group;
  bones: Record<string, THREE.Bone>;
  rest: Record<string, THREE.Quaternion>;   // world-space rest quaternion per bone
  restPos: Record<string, THREE.Vector3>;   // world-space rest position per bone (bind pose)
  body: THREE.SkinnedMesh;
}

/** Fresh clone of a base character with bone lookup tables. */
export async function makeRig(g: Gender): Promise<Rig> {
  const src = await loadBase(g);
  const root = cloneSkinned(src) as THREE.Group;
  root.updateMatrixWorld(true);
  const bones: Record<string, THREE.Bone> = {};
  let body: THREE.SkinnedMesh | null = null;
  root.traverse(o => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
    const m = o as THREE.SkinnedMesh;
    if (m.isSkinnedMesh) { if (!body || m.geometry.attributes.position.count > body.geometry.attributes.position.count) body = m; }
  });
  const rest: Record<string, THREE.Quaternion> = {}, restPos: Record<string, THREE.Vector3> = {};
  for (const [n, b] of Object.entries(bones)) { rest[n] = b.getWorldQuaternion(new THREE.Quaternion()); restPos[n] = b.getWorldPosition(new THREE.Vector3()); }
  return { root, bones, rest, restPos, body: body! };
}

/** rotate a bone by `delta` relative to its bind pose, expressed in the CHARACTER's own frame (so it follows root yaw / falls) */
const _pq = new THREE.Quaternion(), _tq = new THREE.Quaternion(), _rq = new THREE.Quaternion();
export function poseBone(rig: Rig, name: string, delta: THREE.Quaternion) {
  const b = rig.bones[name]; if (!b || !b.parent) return;
  rig.root.updateWorldMatrix(true, false); rig.root.getWorldQuaternion(_rq);
  b.parent.updateWorldMatrix(true, false);
  b.parent.getWorldQuaternion(_pq);
  _tq.copy(_rq).multiply(delta).multiply(rig.rest[name]);   // root * delta * bind
  b.quaternion.copy(_pq.invert().multiply(_tq));
}
