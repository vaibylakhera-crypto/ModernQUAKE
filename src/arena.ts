import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxes, pads, Box, teleporters, THEME } from './level';
import { Quality } from './quality';
import { buildPad, padTime, buildTeleporter, teleTime } from './pads';

// "Alien fortress" arena: solid brush-style geometry built straight from the collision boxes, with original procedural
// textures (scripts/make-alien-textures.py): worn slab floors, dark stone walls with alien veins, corroded iron trim,
// rock undersides that hang into the void. Baked vertex shading fakes ambient occlusion; dim warm sconces add light.
// Everything is merged into one mesh per material, so the whole level is ~6 draw calls.

const tex = (() => {
  const loader = new THREE.TextureLoader();
  const cache = new Map<string, THREE.Texture>();
  return (name: string, data = false) => {          // data = normal/specular maps (stored linear, not sRGB colour)
    let t = cache.get(name);
    if (!t) {
      t = loader.load(`/tex-alien/${name}.webp`);
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 8;
      cache.set(name, t);
    }
    return t;
  };
})();

type Part = 'floor' | 'wall' | 'trim' | 'rock' | 'pillar' | 'lamp';
const rnd = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

/** axis-aligned box with world-space UVs (texture density independent of size) and baked top-to-bottom shading */
function brush(min: THREE.Vector3, max: THREE.Vector3, o: { top?: number; side?: number; bottom?: number; aoLow?: number } = {}): THREE.BufferGeometry {
  const size = new THREE.Vector3().subVectors(max, min), c = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  const g = new THREE.BoxGeometry(size.x, size.y, size.z).toNonIndexed(); g.translate(c.x, c.y, c.z);
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2), col = new Float32Array(pos.count * 3);
  const sTop = o.top ?? 8, sSide = o.side ?? 4, sBot = o.bottom ?? 6, aoLow = o.aoLow ?? 0.42;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), nx = nor.getX(i), ny = nor.getY(i);
    let u: number, v: number, k = 1;
    if (ny > 0.5) { u = x / sTop; v = z / sTop; }
    else if (ny < -0.5) { u = x / sBot; v = z / sBot; k = 0.5; }
    else { u = (Math.abs(nx) > 0.5 ? z : x) / sSide; v = y / sSide; k = aoLow + (1 - aoLow) * ((y - min.y) / Math.max(0.01, size.y)) ** 0.7; }
    uv[i * 2] = u; uv[i * 2 + 1] = v; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
/** splits a brush into floor (top face) and wall (sides+bottom) geometries */
function splitTop(g: THREE.BufferGeometry): { top: THREE.BufferGeometry; rest: THREE.BufferGeometry } {
  const nor = g.getAttribute('normal'); const topIdx: number[] = [], restIdx: number[] = [];
  for (let t = 0; t < nor.count; t += 3) (nor.getY(t) > 0.5 ? topIdx : restIdx).push(t, t + 1, t + 2);
  const pick = (idx: number[]) => {
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const a = g.getAttribute(name) as THREE.BufferAttribute; const arr = new Float32Array(idx.length * a.itemSize);
      idx.forEach((v, j) => { for (let k = 0; k < a.itemSize; k++) arr[j * a.itemSize + k] = a.array[v * a.itemSize + k]; });
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
    return out;
  };
  return { top: pick(topIdx), rest: pick(restIdx) };
}

/**
 * platform top as a 1 m grid: UVs put one 4 m floor tile per 4x4 m cell; vertex colours give every 4 m cell its own
 * slight tint/brightness (hides the texture repeat) and darken the last ~1.5 m before the platform edge (grime / AO).
 */
function floorGrid(min: THREE.Vector3, max: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [];
  const nx = Math.max(1, Math.round(max.x - min.x)), nz = Math.max(1, Math.round(max.z - min.z));
  const sx = (max.x - min.x) / nx, sz = (max.z - min.z) / nz, y = max.y;
  const shade = (x: number, z: number, tx: number, tz: number) => {
    const d = Math.min(x - min.x, max.x - x, z - min.z, max.z - z);
    const edge = 0.6 + 0.4 * Math.min(1, d / 1.5);
    const r = rnd(tx * 3.1 + 0.5, tz * 7.7 + 0.5), r2 = rnd(tz * 1.7, tx * 5.3);
    const k = (0.84 + r * 0.24) * edge;
    return [k * (0.97 + r2 * 0.06), k, k * (1.03 - r2 * 0.06)];
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x0 = min.x + i * sx, x1 = x0 + sx, z0 = min.z + j * sz, z1 = z0 + sz;
    const tx = Math.floor(((x0 + x1) / 2) / 4), tz = Math.floor(((z0 + z1) / 2) / 4);
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) {
      pos.push(x, y, z); nor.push(0, 1, 0); uv.push(x / 4, -z / 4); col.push(...shade(x, z, tx, tz));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // flat floor with uv = (x, -z) / 4: tangent is +X, bitangent -Z. Giving it explicitly means the normal map never has to
  // rebuild a tangent frame from screen derivatives, which produces black / flickering pixels on some phone GPUs.
  const tan = new Float32Array((pos.length / 3) * 4); for (let i = 0; i < tan.length; i += 4) { tan[i] = 1; tan[i + 3] = 1; }
  g.setAttribute('tangent', new THREE.BufferAttribute(tan, 4));
  return g;
}

/** jagged rock cone hanging under a platform (floating-fortress silhouette) */
function rockUnder(b: Box, seed: number): THREE.BufferGeometry {
  const sx = b.max[0] - b.min[0], sz = b.max[2] - b.min[2];
  const h = Math.min(16, 4 + Math.max(sx, sz) * 0.55);
  const g = new THREE.CylinderGeometry(0.5, 0.06, h, 10, 5, true).toNonIndexed();
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ang = Math.atan2(z, x), lvl = (y + h / 2) / h;           // lvl 1 = top ring (kept flush to the slab)
    const j = lvl > 0.98 ? 0 : (rnd(Math.round(ang * 10) + seed, Math.round(lvl * 10)) - 0.5) * 0.28;
    pos.setXYZ(i, x * (1 + j) * sx * 0.98, y - h / 2 + 0.02, z * (1 + j) * sz * 0.98);
  }
  g.computeVertexNormals();
  const uv = g.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * h / 6);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const k = 0.25 + 0.75 * Math.max(0, Math.min(1, (pos.getY(i) + h) / h)) ** 1.5; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.translate((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2);
  return g;
}

export class Arena {
  group = new THREE.Group();
  stats = { pieces: 0, merged: 0 };
  private parts = new Map<Part, THREE.BufferGeometry[]>();
  constructor(private q: Quality) {
    pads.forEach((p, i) => this.group.add(buildPad(p, i, { beams: q.padBeams })));
    for (const t of teleporters) { const g = buildTeleporter(t.pos, t.dest); this.group.add(g.gate, g.exit); this.spin.push(...g.spin); }
  }
  private spin: THREE.Object3D[] = [];

  private add(part: Part, g: THREE.BufferGeometry) {
    let l = this.parts.get(part); if (!l) this.parts.set(part, (l = [])); l.push(g); this.stats.pieces++;
  }

  async build() {
    boxes.forEach((b, i) => {
      if (b.kind === 'pillar') this.pillar(b);
      else if (b.kind === 'crates') this.lowWall(b);
      else if (b.kind === 'block') this.solid(b);
      else this.platform(b, i);
    });
    const mat = (part: Part): THREE.Material => {
      if (part === 'lamp') return new THREE.MeshBasicMaterial({ color: THEME.lamp });
      const o = { map: tex(part), vertexColors: true };
      if (part === 'floor') {
        // deck plates: normal map for real relief under the lights, specular map so worn metal glints and grime stays dull
        return this.q.pbr
          ? new THREE.MeshStandardMaterial({ ...o, normalMap: tex('floor_n', true), roughnessMap: tex('floor_r', true), roughness: 1, metalness: 0.55 })
          : new THREE.MeshPhongMaterial({ ...o, normalMap: tex('floor_n', true), specularMap: tex('floor_s', true), specular: 0x8a8a84, shininess: 42 });
      }
      return this.q.pbr ? new THREE.MeshStandardMaterial({ ...o, roughness: part === 'trim' ? 0.55 : 0.9, metalness: part === 'trim' ? 0.45 : 0.05 })
        : new THREE.MeshLambertMaterial(o);
    };
    const tn = THEME.tint;
    for (const [part, geos] of this.parts) {
      if (part !== 'lamp' && (tn[0] !== 1 || tn[1] !== 1 || tn[2] !== 1)) for (const g of geos) {
        const c = g.getAttribute('color') as THREE.BufferAttribute | undefined; if (!c) continue;
        for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * tn[0], c.getY(i) * tn[1], c.getZ(i) * tn[2]);
      }
      const m = new THREE.Mesh(mergeGeometries(geos.map(g => { for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'tangent'].includes(n)) g.deleteAttribute(n); if (!g.getAttribute('color')) { const c = new Float32Array(g.getAttribute('position').count * 3).fill(1); g.setAttribute('color', new THREE.BufferAttribute(c, 3)); } if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2)); return g.index ? g.toNonIndexed() : g; }))!, mat(part));
      m.matrixAutoUpdate = false; this.group.add(m); this.stats.merged++;
    }
  }

  private platform(b: Box, i: number) {
    const min = new THREE.Vector3(...b.min), max = new THREE.Vector3(...b.max);
    const { rest } = splitTop(brush(min, max, { side: 4, aoLow: 0.35 }));
    this.add('floor', floorGrid(min, max)); this.add('wall', rest);
    // corroded iron lip around the top edge (slightly proud of the walls)
    const t = 0.12, lipH = 0.55, y0 = max.y - lipH, y1 = max.y + 0.03;
    const lips: [THREE.Vector3, THREE.Vector3][] = [
      [new THREE.Vector3(min.x - t, y0, min.z - t), new THREE.Vector3(max.x + t, y1, min.z + 0.02)],
      [new THREE.Vector3(min.x - t, y0, max.z - 0.02), new THREE.Vector3(max.x + t, y1, max.z + t)],
      [new THREE.Vector3(min.x - t, y0, min.z), new THREE.Vector3(min.x + 0.02, y1, max.z)],
      [new THREE.Vector3(max.x - 0.02, y0, min.z), new THREE.Vector3(max.x + t, y1, max.z)],
    ];
    for (const [a, c] of lips) this.add('trim', brush(a, c, { top: 2, side: 2, aoLow: 0.7 }));
    // buttresses down the walls every ~8 m, and a warm sconce on every other one
    const sx = max.x - min.x, sz = max.z - min.z, h = max.y - min.y;
    const edge = (x: number, z: number, nx: number, nz: number, k: number) => {
      const w = 0.7, d = 0.35;
      const a = new THREE.Vector3(x - (nz ? w / 2 : 0) + Math.min(0, nx) * d, min.y - 0.3, z - (nx ? w / 2 : 0) + Math.min(0, nz) * d);
      const c = new THREE.Vector3(x + (nz ? w / 2 : 0) + Math.max(0, nx) * d, max.y - lipH, z + (nx ? w / 2 : 0) + Math.max(0, nz) * d);
      this.add('trim', brush(a, c, { side: 2, aoLow: 0.5 }));
      if (k % 2 === 0 && h > 0.9) {
        const ly = max.y - lipH - 0.35, o = 0.42;
        this.add('lamp', brush(new THREE.Vector3(x + nx * o - 0.12, ly - 0.14, z + nz * o - 0.12), new THREE.Vector3(x + nx * o + 0.12, ly + 0.14, z + nz * o + 0.12)));
      }
    };
    const n = (len: number) => Math.max(1, Math.round(len / 8));
    for (let k = 0, m = n(sx); k <= m; k++) { const x = min.x + 0.6 + (sx - 1.2) * k / m; edge(x, min.z, 0, -1, k); edge(x, max.z, 0, 1, k + 1); }
    for (let k = 1, m = n(sz); k < m; k++) { const z = min.z + 0.6 + (sz - 1.2) * k / m; edge(min.x, z, -1, 0, k); edge(max.x, z, 1, 0, k + 1); }
    if (sx >= 8) this.add('rock', rockUnder(b, i * 7));
  }

  private pillar(b: Box) {
    const min = new THREE.Vector3(...b.min), max = new THREE.Vector3(...b.max);
    this.add('pillar', brush(min, max, { side: 2.2, aoLow: 0.45 }));
    const cap = 0.22;   // base and capital slabs
    this.add('trim', brush(new THREE.Vector3(min.x - cap, min.y, min.z - cap), new THREE.Vector3(max.x + cap, min.y + 0.45, max.z + cap), { side: 2 }));
    this.add('trim', brush(new THREE.Vector3(min.x - cap, max.y - 0.4, min.z - cap), new THREE.Vector3(max.x + cap, max.y, max.z + cap), { side: 2 }));
    const cx = (min.x + max.x) / 2, cz = (min.z + max.z) / 2;
    this.add('lamp', brush(new THREE.Vector3(cx - 0.14, max.y - 1.1, max.z + 0.01), new THREE.Vector3(cx + 0.14, max.y - 0.8, max.z + 0.12)));
    this.add('lamp', brush(new THREE.Vector3(cx - 0.14, max.y - 1.1, min.z - 0.12), new THREE.Vector3(cx + 0.14, max.y - 0.8, min.z - 0.01)));
  }

  /** solid wall / ceiling slab: every face uses the wall texture */
  private solid(b: Box) {
    const min = new THREE.Vector3(...b.min), max = new THREE.Vector3(...b.max);
    this.add('wall', brush(min, max, { top: 4, side: 4, bottom: 4, aoLow: 0.5 }));
  }

  private lowWall(b: Box) {
    const min = new THREE.Vector3(...b.min), max = new THREE.Vector3(...b.max);
    const { top, rest } = splitTop(brush(min, max, { side: 2, top: 2, aoLow: 0.4 }));
    this.add('trim', top); this.add('wall', rest);
  }

  update(t: number) { padTime.value = t; teleTime.value = t; this.spin.forEach((o, i) => { o.rotation.z = t * (i % 2 ? -1.4 : 1.1); o.position.y += Math.sin(t * 2 + i) * 0.002; }); }
}
