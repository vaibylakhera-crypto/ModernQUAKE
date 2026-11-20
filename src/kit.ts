import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Loader/cache for the Quaternius Modular SciFi MegaKit (CC0), served from /kit.
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
export const kitOptions = { cheap: false };
const cheapCache = new Map<string, THREE.Material>();

/** PBR -> Lambert: keeps the albedo and emissive map, drops normal/ORM/env (far fewer texture fetches + lighting cost). */
function cheapMaterial(src: THREE.MeshStandardMaterial): THREE.Material {
  let m = cheapCache.get(src.uuid);
  if (m) return m;
  if (src.transparent || src.name.includes('Glass')) {
    m = new THREE.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.25, depthWrite: false });
  } else if (src.name.includes('Light') || src.name.includes('Screen') || src.name.includes('Decal')) {
    m = new THREE.MeshBasicMaterial({ map: src.map, color: src.emissiveMap ? 0xffffff : src.color, side: src.side });
  } else {
    m = new THREE.MeshLambertMaterial({ map: src.map, color: src.color.clone().multiplyScalar(1.5), emissiveMap: src.emissiveMap, emissive: src.emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0), emissiveIntensity: src.emissiveMap ? 1.2 : 0, side: src.side });
  }
  m.name = src.name; cheapCache.set(src.uuid, m); return m;
}

export function loadPiece(name: string): Promise<THREE.Group> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`/kit/${name}.gltf`).then(g => {
      g.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = false; m.receiveShadow = false;
          if (kitOptions.cheap) {
            m.material = Array.isArray(m.material) ? m.material.map(x => cheapMaterial(x as THREE.MeshStandardMaterial)) : cheapMaterial(m.material as THREE.MeshStandardMaterial);
            const tex = (m.material as THREE.MeshLambertMaterial).map; if (tex) tex.anisotropy = 2;
          } else {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats as THREE.MeshStandardMaterial[]) { if (mat.map) mat.map.anisotropy = 8; mat.envMapIntensity = 1.0; }
          }
        }
      });
      return g.scene;
    });
    cache.set(name, p);
  }
  return p;
}

export class Kit {
  private pieces = new Map<string, THREE.Group>();
  constructor(public parent: THREE.Object3D) {}

  async preload(names: string[]) {
    await Promise.all(names.map(async n => this.pieces.set(n, await loadPiece(n))));
  }

  /** Place a clone of a piece. rotY in radians. */
  place(name: string, x: number, y: number, z: number, rotY = 0, rotX = 0, scale = 1): THREE.Object3D {
    const src = this.pieces.get(name);
    if (!src) throw new Error(`kit piece not preloaded: ${name}`);
    const o = src.clone(true);
    o.position.set(x, y, z); o.rotation.set(rotX, rotY, 0); o.scale.setScalar(scale);
    this.parent.add(o);
    return o;
  }
}

/**
 * Merge every mesh under `root` into one mesh per material (draw calls ~ number of materials, not number of pieces).
 * Only position/normal/uv are kept. Static geometry only.
 */
export function mergeStatic(root: THREE.Object3D): { before: number; after: number } {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const geo0 = m.geometry as THREE.BufferGeometry;
    const groups = geo0.groups.length ? geo0.groups : [{ start: 0, count: geo0.index ? geo0.index.count : geo0.attributes.position.count, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0];
      let g = geo0.clone();
      if (g.index) g = g.toNonIndexed();
      // slice to this group (non-indexed: start/count in vertices; indexed groups were in index units == vertex units after toNonIndexed)
      const full = g.attributes.position.count;
      if (groups.length > 1 || grp.count < full) {
        const sliced = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
          const a = g.getAttribute(name) as THREE.BufferAttribute | undefined; if (!a) continue;
          sliced.setAttribute(name, new THREE.BufferAttribute(a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize) as Float32Array, a.itemSize));
        }
        g = sliced;
      }
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      let list = buckets.get(mat); if (!list) buckets.set(mat, (list = [])); list.push(g);
    }
  }
  for (const m of meshes) m.parent?.remove(m);
  let after = 0;
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos, false); if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat); mesh.matrixAutoUpdate = false; root.add(mesh); after++;
  }
  return { before: meshes.length, after };
}
