// Fire across the map, built as real structures: stone stands with an iron bowl, bowls crowning tall pillars, and wall sconces
// (backplate, arm and cup) inside the sealed buildings. Flames and the warm glow around them are fake light (additive meshes),
// merged into a handful of draw calls so phones barely notice.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { torches, Torch, THEME } from './level';

export const torchTime = { value: 0 };

// fire colour follows each map's lamp colour, pushed toward gold so it always reads as fire
const FIRE = new THREE.Color(THEME.lamp).lerp(new THREE.Color(1.0, 0.55, 0.14), 0.62);
const fireU = { value: new THREE.Vector3(FIRE.r, FIRE.g, FIRE.b) };
// flames are camera-facing, layered (wide dim outer, mid, small hot core) and shaped by scrolling noise, so they look like soft, living fire
const flameVert = /* glsl */ `
attribute vec3 aCenter; attribute vec3 aSize; attribute vec2 aSeed; varying vec2 vUv; varying vec2 vS; varying float vL;
void main(){ vUv = uv; vS = aSeed; vL = aSize.z; vec4 mv = modelViewMatrix * vec4(aCenter, 1.0); mv.xy += vec2(position.x * aSize.x, position.y * aSize.y); gl_Position = projectionMatrix * mv; }`;
const flameFrag = /* glsl */ `
precision mediump float;
uniform float uTime; uniform vec3 uFire; varying vec2 vUv; varying vec2 vS; varying float vL;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  float y = vUv.y, t = uTime;
  float x = (vUv.x - 0.5) * 2.0;
  float wob = (n(vec2(y * 2.6 - t * 3.0, vS.x * 9.0)) - 0.5) * 0.95 * y + (n(vec2(y * 6.0 - t * 5.5, vS.x * 4.0 + 3.0)) - 0.5) * 0.35 * y;   // licking side to side
  float lick = 0.72 + 0.28 * n(vec2(y * 3.0 - t * 2.4, vS.x * 5.0));                                                                              // the width breathes
  float w = pow(1.0 - y, 0.75) * 0.9 * lick;
  float d = abs(x + wob) / max(w, 0.001);
  float body = (1.0 - smoothstep(0.25, 1.0, d)) * smoothstep(0.0, 0.07, y) * (1.0 - smoothstep(0.62, 1.0, y));
  float heat = clamp(1.0 - d * 0.75 - y * 0.8 + vL * 0.35, 0.0, 1.0);
  vec3 col = mix(uFire * vec3(0.55, 0.22, 0.12), uFire, smoothstep(0.1, 0.5, heat));
  col = mix(col, vec3(1.0, 0.93, 0.62), smoothstep(0.55, 0.95, heat));
  float flick = 0.9 + 0.2 * n(vec2(t * 6.0, vS.x * 20.0));
  gl_FragColor = vec4(col * 1.5 * flick, body * (0.62 + vL * 0.2));
}`;
const sparkVert = /* glsl */ `
attribute vec3 aCenter; attribute vec3 aSeed; uniform float uTime; varying float vA;
void main(){
  float sp = 0.5 + aSeed.z * 0.9, life = mod(uTime * sp + aSeed.x * 13.0, 1.0);
  vec3 p = aCenter + vec3(sin(aSeed.x * 40.0 + uTime * 1.3 + life * 5.0) * 0.45 * life, 0.2 + life * (2.0 + aSeed.y * 2.0), cos(aSeed.y * 31.0 + uTime + life * 4.0) * 0.45 * life);
  vA = (1.0 - life) * smoothstep(0.0, 0.1, life);
  gl_PointSize = 2.5 + 3.0 * aSeed.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const sparkFrag = /* glsl */ `precision mediump float; uniform vec3 uFire; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(mix(uFire, vec3(1.0, 0.9, 0.6), 0.5) * 1.5, a * vA); }`;
const glowVert = /* glsl */ `varying vec2 vQ; attribute vec2 aSeed; varying float vS; void main(){ vQ = (uv - 0.5) * 2.0; vS = aSeed.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const glowFrag = /* glsl */ `
precision mediump float;
uniform float uTime; uniform vec3 uFire; varying vec2 vQ; varying float vS;
void main(){ float r = length(vQ); float a = smoothstep(1.0, 0.0, r); a *= a; float fl = 0.8 + 0.2 * sin(uTime * 9.0 + vS * 40.0) * sin(uTime * 5.3 + vS * 17.0); gl_FragColor = vec4(uFire, a * 0.42 * fl); }`;

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
  const stone: THREE.BufferGeometry[] = [], iron: THREE.BufferGeometry[] = [], embers: THREE.BufferGeometry[] = [], flames: THREE.BufferGeometry[] = [], glows: THREE.BufferGeometry[] = [], sparkPts: number[] = [];
  const flame = (cx: number, cy: number, cz: number, w: number, h: number, seed: number, nSpark: number) => {
    ([[1, 1, 0], [0.72, 0.86, 1], [0.42, 0.62, 2]] as const).forEach(([kw, kh, layer]) => {
      const q = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), n = q.getAttribute('position').count, c = new Float32Array(n * 3), sz = new Float32Array(n * 3), sd = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) { c.set([cx, cy, cz], k * 3); sz.set([w * kw, h * kh, layer], k * 3); sd.set([(seed + layer * 0.31) % 1, layer], k * 2); }
      q.setAttribute('aCenter', new THREE.BufferAttribute(c, 3)); q.setAttribute('aSize', new THREE.BufferAttribute(sz, 3)); q.setAttribute('aSeed', new THREE.BufferAttribute(sd, 2)); flames.push(q);
    });
    for (let k = 0; k < nSpark; k++) sparkPts.push(cx, cy, cz, (seed * 7.13 + k * 0.173) % 1, (seed * 3.7 + k * 0.411) % 1, (k * 0.29 + seed) % 1);
  };
  torches.forEach((t: Torch, i) => {
    const [x, y, z] = t.pos, seed = (i * 0.37) % 1;
    if (t.kind === 'stand') {
      const f = t.floor;
      stone.push(cyl(0.58, 0.62, 0.16, x, f, z, 8), cyl(0.42, 0.5, 0.18, x, f + 0.16, z, 8), cyl(0.3, 0.36, 0.66, x, f + 0.34, z, 8), cyl(0.4, 0.3, 0.1, x, f + 0.98, z, 8));  // stepped base, tapering shaft, collar
      iron.push(cyl(0.62, 0.34, 0.34, x, f + 1.0, z, 12));                                        // the bowl
      embers.push(solid(new THREE.CircleGeometry(0.56, 12).rotateX(-Math.PI / 2).translate(x, f + 1.3, z)));
      flame(x, f + 1.3, z, 1.9, 2.9, seed, 6);
      glows.push(seeded(new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2).translate(x, f + 0.04, z), seed));
    } else if (t.kind === 'cap') {
      iron.push(cyl(0.78, 0.78, 0.1, x, y - 0.1, z, 12), cyl(0.7, 0.4, 0.4, x, y, z, 12), box(0.12, 0.5, 0.12, x + 0.5, y + 0.2, z), box(0.12, 0.5, 0.12, x - 0.5, y + 0.2, z), box(0.12, 0.5, 0.12, x, y + 0.2, z + 0.5), box(0.12, 0.5, 0.12, x, y + 0.2, z - 0.5));
      embers.push(solid(new THREE.CircleGeometry(0.64, 12).rotateX(-Math.PI / 2).translate(x, y + 0.38, z)));
      flame(x, y + 0.38, z, 2.4, 3.8, seed, 8);
      glows.push(seeded(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2).translate(x, t.floor + 0.04, z), seed));       // light pooling at the pillar's foot
    } else {
      const n = t.n!, th = Math.atan2(n[0], n[1]);                                                    // local +z points out of the wall
      const at = (lx: number, ly: number, lz: number): [number, number, number] => [x + lx * Math.cos(th) + lz * Math.sin(th), y + ly, z - lx * Math.sin(th) + lz * Math.cos(th)];
      const p = at(0, 0, 0), q = at(0, -0.1, 0.34), c = at(0, 0.0, 0.46);
      iron.push(box(0.5, 0.8, 0.1, p[0] - n[0] * 0.0, p[1], p[2] - n[1] * 0.0, th), box(0.12, 0.12, 0.42, q[0], q[1], q[2], th), cyl(0.3, 0.16, 0.28, c[0], c[1] - 0.12, c[2], 10));
      embers.push(solid(new THREE.CircleGeometry(0.27, 10).rotateX(-Math.PI / 2).translate(c[0], c[1] + 0.15, c[2])));
      flame(c[0], c[1] + 0.15, c[2], 1.2, 1.9, seed, 4);
      glows.push(seeded(new THREE.PlaneGeometry(7, 6).rotateY(th).translate(x + n[0] * 0.08, y, z + n[1] * 0.08), seed));      // warm wash on the wall
    }
  });
  const am = (v: string, f: string) => new THREE.ShaderMaterial({ vertexShader: v, fragmentShader: f, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: torchTime, uFire: fireU } });
  if (stone.length) g.add(new THREE.Mesh(mergeGeometries(stone)!, new THREE.MeshLambertMaterial({ color: 0x6a6258 })));
  if (iron.length) g.add(new THREE.Mesh(mergeGeometries(iron)!, new THREE.MeshLambertMaterial({ color: 0x2c2826 })));
  if (embers.length) g.add(new THREE.Mesh(mergeGeometries(embers)!, new THREE.MeshBasicMaterial({ color: 0xff7a22 })));
  const gm = new THREE.Mesh(mergeGeometries(glows)!, am(glowVert, glowFrag)); gm.renderOrder = 1; gm.frustumCulled = false; g.add(gm);
  const fm = new THREE.Mesh(mergeGeometries(flames)!, am(flameVert, flameFrag)); fm.renderOrder = 4; fm.frustumCulled = false; g.add(fm);
  // rising sparks
  const sg = new THREE.BufferGeometry(), np = sparkPts.length / 6, ctr = new Float32Array(np * 3), sd = new Float32Array(np * 3);
  for (let k = 0; k < np; k++) { ctr.set(sparkPts.slice(k * 6, k * 6 + 3), k * 3); sd.set(sparkPts.slice(k * 6 + 3, k * 6 + 6), k * 3); }
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(np * 3), 3)); sg.setAttribute('aCenter', new THREE.BufferAttribute(ctr, 3)); sg.setAttribute('aSeed', new THREE.BufferAttribute(sd, 3));
  const sp = new THREE.Points(sg, new THREE.ShaderMaterial({ vertexShader: sparkVert, fragmentShader: sparkFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: torchTime, uFire: fireU } }));
  sp.frustumCulled = false; sp.renderOrder = 5; g.add(sp);
  g.add(...fireLights);
  return g;
}

// ---- real firelight: the two fires nearest the camera light the walls, floor, your gun and the enemies around them ----
const fireLights = [0, 1].map(() => { const l = new THREE.PointLight(FIRE.clone(), 0, 26, 2); return l; });
const lightPos = fireLights.map(() => new THREE.Vector3()), lightK = [0, 0];
const _t = new THREE.Vector3();
/** call every frame with the camera position and time */
export function updateFireLights(cam: THREE.Vector3, t: number, dt: number) {
  if (!torches.length) return;
  const ranked = torches.map((q, i) => ({ i, d: Math.hypot(q.pos[0] - cam.x, q.pos[2] - cam.z) + Math.abs(q.pos[1] - cam.y) * 0.5 })).sort((a, b) => a.d - b.d).slice(0, 2);
  const k = Math.min(1, dt * 6);
  fireLights.forEach((l, n) => {
    const r = ranked[n]; if (!r) { l.intensity = 0; return; }
    const q = torches[r.i]; _t.set(q.pos[0] + (q.n ? q.n[0] * 0.6 : 0), q.pos[1] + 0.9, q.pos[2] + (q.n ? q.n[1] * 0.6 : 0));
    if (lightK[n] === 0) lightPos[n].copy(_t); else lightPos[n].lerp(_t, k);
    lightK[n] = 1; l.position.copy(lightPos[n]);
    const fl = 0.86 + 0.14 * Math.sin(t * 11 + n * 3) * Math.sin(t * 7.3 + n) + 0.05 * Math.sin(t * 27);
    l.intensity = 260 * fl;
  });
}
