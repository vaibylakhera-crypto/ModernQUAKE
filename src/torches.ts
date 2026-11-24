// Fire across the map, built as real structures: stone stands with an iron bowl, bowls crowning tall pillars, and wall sconces
// (backplate, arm and cup) inside the sealed buildings. Flames and the warm glow around them are fake light (additive meshes),
// merged into a handful of draw calls so phones barely notice.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { torches, Torch } from './level';

export const torchTime = { value: 0 };

const flameVert = /* glsl */ `attribute vec2 aSeed; varying vec2 vUv; varying float vS; void main(){ vUv = uv; vS = aSeed.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const flameFrag = /* glsl */ `
precision mediump float;
uniform float uTime; varying vec2 vUv; varying float vS;
void main(){
  float y = vUv.y, t = uTime * 7.0 + vS * 40.0;
  float x = (vUv.x - 0.5) * 2.0 + sin(y * 6.0 - t) * 0.16 * y + sin(y * 11.0 - t * 1.7) * 0.07 * y;
  float w = pow(1.0 - y, 0.8) * 0.78;
  float a = smoothstep(w, w * 0.25, abs(x)) * smoothstep(0.0, 0.08, y) * (1.0 - y * 0.35);
  vec3 c = mix(vec3(1.0, 0.95, 0.6), vec3(1.0, 0.42, 0.06), smoothstep(0.0, 0.55, y));
  c = mix(c, vec3(0.7, 0.1, 0.02), smoothstep(0.55, 1.0, y));
  gl_FragColor = vec4(c * (1.5 + 0.4 * sin(t * 1.3)), a);
}`;
const glowVert = /* glsl */ `varying vec2 vQ; attribute vec2 aSeed; varying float vS; void main(){ vQ = (uv - 0.5) * 2.0; vS = aSeed.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const glowFrag = /* glsl */ `
precision mediump float;
uniform float uTime; varying vec2 vQ; varying float vS;
void main(){ float r = length(vQ); float a = smoothstep(1.0, 0.0, r); a *= a; float fl = 0.8 + 0.2 * sin(uTime * 9.0 + vS * 40.0) * sin(uTime * 5.3 + vS * 17.0); gl_FragColor = vec4(1.0, 0.55, 0.18, a * 0.5 * fl); }`;

const seeded = (geo: THREE.BufferGeometry, seed: number) => {
  const n = geo.getAttribute('position').count, s = new Float32Array(n * 2); for (let k = 0; k < n; k++) s[k * 2] = seed;
  geo.setAttribute('aSeed', new THREE.BufferAttribute(s, 2)); return geo;
};
const solid = (g: THREE.BufferGeometry) => { const o = g.index ? g.toNonIndexed() : g; o.deleteAttribute('uv'); return o; };
const cyl = (rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 12) => solid(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z));
const box = (w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0) => solid(new THREE.BoxGeometry(w, h, d).rotateY(rotY).translate(x, y, z));

export function buildTorches(): THREE.Group {
  const g = new THREE.Group();
  if (!torches.length) return g;
  const stone: THREE.BufferGeometry[] = [], iron: THREE.BufferGeometry[] = [], embers: THREE.BufferGeometry[] = [], flames: THREE.BufferGeometry[] = [], glows: THREE.BufferGeometry[] = [];
  torches.forEach((t: Torch, i) => {
    const [x, y, z] = t.pos, seed = (i * 0.37) % 1;
    const fl = (w: number, h: number, yy: number) => { for (const r of [0, Math.PI / 2]) flames.push(seeded(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0).rotateY(r + seed * 3).translate(x, yy, z), seed)); };
    if (t.kind === 'stand') {
      const f = t.floor;
      stone.push(cyl(0.58, 0.62, 0.16, x, f, z, 8), cyl(0.42, 0.5, 0.18, x, f + 0.16, z, 8), cyl(0.3, 0.36, 0.66, x, f + 0.34, z, 8), cyl(0.4, 0.3, 0.1, x, f + 0.98, z, 8));  // stepped base, tapering shaft, collar
      iron.push(cyl(0.62, 0.34, 0.34, x, f + 1.0, z, 12));                                        // the bowl
      embers.push(solid(new THREE.CircleGeometry(0.56, 12).rotateX(-Math.PI / 2).translate(x, f + 1.3, z)));
      fl(1.5, 2.4, f + 1.3);
      glows.push(seeded(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2).translate(x, f + 0.04, z), seed));
    } else if (t.kind === 'cap') {
      iron.push(cyl(0.78, 0.78, 0.1, x, y - 0.1, z, 12), cyl(0.7, 0.4, 0.4, x, y, z, 12), box(0.12, 0.5, 0.12, x + 0.5, y + 0.2, z), box(0.12, 0.5, 0.12, x - 0.5, y + 0.2, z), box(0.12, 0.5, 0.12, x, y + 0.2, z + 0.5), box(0.12, 0.5, 0.12, x, y + 0.2, z - 0.5));
      embers.push(solid(new THREE.CircleGeometry(0.64, 12).rotateX(-Math.PI / 2).translate(x, y + 0.38, z)));
      fl(2.0, 3.2, y + 0.38);
      glows.push(seeded(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2).translate(x, t.floor + 0.04, z), seed));       // light pooling at the pillar's foot
    } else {
      const n = t.n!, th = Math.atan2(n[0], n[1]);                                                    // local +z points out of the wall
      const at = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * Math.cos(th) + lz * Math.sin(th), y + ly, z - lx * Math.sin(th) + lz * Math.cos(th)];
      const p = at(0, 0, 0), q = at(0, -0.1, 0.34), c = at(0, 0.0, 0.46);
      iron.push(box(0.5, 0.8, 0.1, p[0] - n[0] * 0.0, p[1], p[2] - n[1] * 0.0, th), box(0.12, 0.12, 0.42, q[0], q[1], q[2], th), cyl(0.3, 0.16, 0.28, c[0], c[1] - 0.12, c[2], 10));
      embers.push(solid(new THREE.CircleGeometry(0.27, 10).rotateX(-Math.PI / 2).translate(c[0], c[1] + 0.15, c[2])));
      flames.push(...[0, Math.PI / 2].map(r => seeded(new THREE.PlaneGeometry(0.95, 1.6).translate(0, 0.8, 0).rotateY(r + seed * 3).translate(c[0], c[1] + 0.15, c[2]), seed)));
      glows.push(seeded(new THREE.PlaneGeometry(7, 6).rotateY(th).translate(x + n[0] * 0.08, y, z + n[1] * 0.08), seed));      // warm wash on the wall
    }
  });
  const am = (v: string, f: string) => new THREE.ShaderMaterial({ vertexShader: v, fragmentShader: f, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: torchTime } });
  if (stone.length) g.add(new THREE.Mesh(mergeGeometries(stone)!, new THREE.MeshLambertMaterial({ color: 0x6a6258 })));
  if (iron.length) g.add(new THREE.Mesh(mergeGeometries(iron)!, new THREE.MeshLambertMaterial({ color: 0x2c2826 })));
  if (embers.length) g.add(new THREE.Mesh(mergeGeometries(embers)!, new THREE.MeshBasicMaterial({ color: 0xff7a22 })));
  const gm = new THREE.Mesh(mergeGeometries(glows)!, am(glowVert, glowFrag)); gm.renderOrder = 1; gm.frustumCulled = false; g.add(gm);
  const fm = new THREE.Mesh(mergeGeometries(flames)!, am(flameVert, flameFrag)); fm.renderOrder = 4; fm.frustumCulled = false; g.add(fm);
  return g;
}
