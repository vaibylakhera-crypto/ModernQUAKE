// Burning braziers scattered over every map: a dark metal bowl, a flickering flame and a warm pool of light on the floor.
// Everything is fake light (additive meshes merged into three draw calls), so it costs almost nothing, even on phones.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Box, pads, pickups, spawns, teleporters } from './level';

export const torchTime = { value: 0 };

/** where braziers stand: corners and long edges of the big floors, and beside pillars; kept clear of pads, pickups, spawns and gates */
export function torchSpots(boxes: Box[]): [number, number, number][] {
  const cand: [number, number, number][] = [];
  for (const b of boxes) {
    if (b.kind === 'lift' || b.kind === 'light' || b.kind === 'block' || b.kind === 'crates') continue;
    const sx = b.max[0] - b.min[0], sz = b.max[2] - b.min[2], top = b.max[1];
    if (b.kind === 'pillar') { cand.push([b.max[0] + 0.8, b.min[1], (b.min[2] + b.max[2]) / 2]); continue; }
    if (sx * sz < 28 || sx < 3 || sz < 3) continue;
    const i = 1.3, xs = [b.min[0] + i, b.max[0] - i], zs = [b.min[2] + i, b.max[2] - i];
    for (const x of xs) for (const z of zs) cand.push([x, top, z]);
    if (sx > 20) for (const z of zs) for (let x = b.min[0] + 12; x < b.max[0] - 6; x += 12) cand.push([x, top, z]);
    if (sz > 20) for (const x of xs) for (let z = b.min[2] + 12; z < b.max[2] - 6; z += 12) cand.push([x, top, z]);
  }
  const keep: [number, number, number][] = [];
  const near = (p: number[], q: number[], r: number) => Math.hypot(p[0] - q[0], p[2] - q[2]) < r && Math.abs(p[1] - q[1]) < 2.5;
  for (const c of cand) {
    if (keep.length >= 44) break;
    if (keep.some(k => near(c, k, 6))) continue;
    if (pads.some(p => near(c, p.pos, 3)) || pickups.some(p => near(c, p.pos, 2.5)) || spawns.some(s => near(c, s.pos, 2.5)) || teleporters.some(t => near(c, t.pos, 3.5) || near(c, t.dest, 2.5))) continue;
    if (boxes.some(b => b.kind !== 'lift' && b.kind !== 'light' && c[0] > b.min[0] - 0.5 && c[0] < b.max[0] + 0.5 && c[2] > b.min[2] - 0.5 && c[2] < b.max[2] + 0.5 && c[1] + 0.6 > b.min[1] + 0.05 && c[1] + 0.6 < b.max[1])) continue;
    // must stand on a floor
    if (!boxes.some(b => Math.abs(b.max[1] - c[1]) < 0.1 && c[0] > b.min[0] && c[0] < b.max[0] && c[2] > b.min[2] && c[2] < b.max[2]) && !boxes.some(b => b.kind === 'pillar' && Math.abs(b.min[1] - c[1]) < 0.1)) continue;
    keep.push(c);
  }
  return keep;
}

const flameVert = /* glsl */ `attribute vec2 aSeed; varying vec2 vUv; varying float vS; void main(){ vUv = uv; vS = aSeed.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const flameFrag = /* glsl */ `
precision mediump float;
uniform float uTime; varying vec2 vUv; varying float vS;
void main(){
  float y = vUv.y, t = uTime * 7.0 + vS * 40.0;
  float x = (vUv.x - 0.5) * 2.0 + sin(y * 6.0 - t) * 0.16 * y + sin(y * 11.0 - t * 1.7) * 0.07 * y;   // the flame licks side to side
  float w = pow(1.0 - y, 0.8) * 0.78;
  float a = smoothstep(w, w * 0.25, abs(x)) * smoothstep(0.0, 0.08, y) * (1.0 - y * 0.35);
  vec3 c = mix(vec3(1.0, 0.95, 0.6), vec3(1.0, 0.42, 0.06), smoothstep(0.0, 0.55, y));
  c = mix(c, vec3(0.7, 0.1, 0.02), smoothstep(0.55, 1.0, y));
  gl_FragColor = vec4(c * (1.5 + 0.4 * sin(t * 1.3)), a);
}`;
const poolVert = /* glsl */ `varying vec2 vQ; attribute vec2 aSeed; varying float vS; void main(){ vQ = (uv - 0.5) * 2.0; vS = aSeed.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const poolFrag = /* glsl */ `
precision mediump float;
uniform float uTime; varying vec2 vQ; varying float vS;
void main(){ float r = length(vQ); float a = smoothstep(1.0, 0.0, r); a *= a; float fl = 0.8 + 0.2 * sin(uTime * 9.0 + vS * 40.0) * sin(uTime * 5.3 + vS * 17.0); gl_FragColor = vec4(1.0, 0.55, 0.18, a * 0.55 * fl); }`;

export function buildTorches(boxes: Box[]): THREE.Group {
  const g = new THREE.Group(), spots = torchSpots(boxes);
  if (!spots.length) return g;
  const flames: THREE.BufferGeometry[] = [], pools: THREE.BufferGeometry[] = [], bowls: THREE.BufferGeometry[] = [];
  spots.forEach(([x, y, z], i) => {
    const seed = (i * 0.37) % 1, add = (geo: THREE.BufferGeometry, into: THREE.BufferGeometry[]) => {
      const n = geo.getAttribute('position').count, s = new Float32Array(n * 2); for (let k = 0; k < n; k++) { s[k * 2] = seed; }
      geo.setAttribute('aSeed', new THREE.BufferAttribute(s, 2)); into.push(geo);
    };
    for (const rot of [0, Math.PI / 2]) add(new THREE.PlaneGeometry(1.6, 2.8).translate(0, 1.4, 0).rotateY(rot + seed).translate(x, y + 0.95, z), flames);
    add(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2).translate(x, y + 0.04, z), pools);
    const bowl = new THREE.CylinderGeometry(0.42, 0.22, 0.4, 10).translate(x, y + 0.75, z).toNonIndexed(), stem = new THREE.CylinderGeometry(0.07, 0.12, 0.6, 6).translate(x, y + 0.3, z).toNonIndexed();
    bowl.deleteAttribute('uv'); stem.deleteAttribute('uv'); bowls.push(bowl, stem);
  });
  const mat = (v: string, f: string) => new THREE.ShaderMaterial({ vertexShader: v, fragmentShader: f, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: torchTime } });
  const fm = new THREE.Mesh(mergeGeometries(flames)!, mat(flameVert, flameFrag)); fm.renderOrder = 4; fm.frustumCulled = false;
  const pm = new THREE.Mesh(mergeGeometries(pools)!, mat(poolVert, poolFrag)); pm.renderOrder = 1; pm.frustumCulled = false;
  const bm = new THREE.Mesh(mergeGeometries(bowls)!, new THREE.MeshBasicMaterial({ color: 0x2a2220 }));
  // glowing embers in the bowl
  const emb = new THREE.Mesh(mergeGeometries(spots.map(([x, y, z]) => new THREE.CircleGeometry(0.36, 10).rotateX(-Math.PI / 2).translate(x, y + 0.93, z).toNonIndexed()))!, new THREE.MeshBasicMaterial({ color: 0xff7a22 }));
  g.add(bm, emb, pm, fm);
  return g;
}
