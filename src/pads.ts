import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Pad, BounceTier, jumpPadVelocity } from './level';

// Quake-style launch pads: bevelled metal housing, animated glowing plate, soft light column, rising motes.
// Jump pads show chevrons pointing along the launch direction; bounce pads show pulsing rings (1/2/3 = small/medium/mega).

// muted, warm signal colours (readable, not neon)
const COLORS: Record<string, number> = { small: 0x8ac05a, medium: 0xd89a3a, mega: 0xc8402e, jump: 0xe0782a };
const COLUMN_H: Record<string, number> = { small: 3.2, medium: 5.5, mega: 9, jump: 6.5 };
const RINGS: Record<BounceTier, number> = { small: 1.2, medium: 2.2, mega: 3.4 };

export const padTime = { value: 0 };

// ---- shared geometry ----
const housing = (() => {
  const prof = [[2.0, 0], [2.0, 0.1], [1.86, 0.2], [1.62, 0.22], [1.5, 0.15], [1.5, 0.07], [0.01, 0.07]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(prof, 48);
})();
const plateGeo = new THREE.CircleGeometry(1.5, 48).rotateX(-Math.PI / 2).translate(0, 0.075, 0);
const trimGeo = (() => {
  const ring = new THREE.RingGeometry(1.52, 1.66, 64).rotateX(-Math.PI / 2).translate(0, 0.2, 0);
  const parts: THREE.BufferGeometry[] = [ring.toNonIndexed()];
  for (let i = 0; i < 8; i++) {   // light blocks around the rim
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const b = new THREE.BoxGeometry(0.34, 0.07, 0.14).rotateY(-a).translate(Math.cos(a) * 1.83, 0.235, Math.sin(a) * 1.83);
    parts.push(b.toNonIndexed());
  }
  for (const g of parts) { g.deleteAttribute('uv'); }
  return mergeGeometries(parts)!;
})();
const housingMat = new THREE.MeshLambertMaterial({ color: 0x3a414d });

const plateVert = /* glsl */ `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const plateFrag = /* glsl */ `
precision mediump float;
uniform float uTime; uniform vec3 uColor; uniform vec2 uDir; uniform float uMode; uniform float uRings;
varying vec2 vP;
void main(){
  float r = length(vP) / 1.5;
  float edge = smoothstep(1.0, 0.86, r);
  float a = 0.0;
  if (uMode < 0.5) {
    vec2 d = normalize(uDir); vec2 n = vec2(-d.y, d.x);
    float along = dot(vP, d), side = abs(dot(vP, n));
    float t = fract((along + side * 0.85) * 1.1 - uTime * 1.2);
    a = smoothstep(0.0, 0.07, t) * smoothstep(0.42, 0.22, t);
  } else {
    float t = fract(r * uRings - uTime * 0.9);
    a = smoothstep(0.0, 0.1, t) * smoothstep(0.45, 0.25, t) * (1.0 - r * 0.45);
    a += smoothstep(0.28, 0.0, r) * (0.5 + 0.3 * sin(uTime * 6.0));
  }
  gl_FragColor = vec4(uColor * (0.35 + a * 2.0), edge * (0.55 + a * 0.45));
}`;

const columnVert = /* glsl */ `
varying float vY; varying vec3 vN; varying vec3 vV;
void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const columnFrag = /* glsl */ `
precision mediump float;
uniform vec3 uColor; uniform float uTime;
varying float vY; varying vec3 vN; varying vec3 vV;
void main(){
  float f = abs(dot(normalize(vN), normalize(vV)));          // soft silhouette: bright core, fading edges
  float fade = pow(1.0 - vY, 1.7);
  float shimmer = 0.85 + 0.15 * sin(vY * 14.0 - uTime * 4.0);
  gl_FragColor = vec4(uColor, pow(f, 1.4) * fade * 0.42 * shimmer * smoothstep(1.2, 5.5, length(vV)));   // fades out when the camera is inside / close
}`;

const moteVert = /* glsl */ `
attribute vec3 aSeed; uniform float uTime; uniform float uH; varying float vA;
void main(){
  float ang = aSeed.x * 6.2831, rad = (0.25 + aSeed.y * 0.75) * 1.1;
  float sp = 0.7 + aSeed.z * 1.1;
  float y = mod(aSeed.z * 13.7 + uTime * sp, uH);
  float k = y / uH;
  vec3 p = vec3(cos(ang + uTime * 0.4 + k * 3.0) * rad * (1.0 - k * 0.5), 0.25 + y, sin(ang + uTime * 0.4 + k * 3.0) * rad * (1.0 - k * 0.5));
  vA = (1.0 - k) * (1.0 - k) * smoothstep(0.0, 0.08, k) * (0.55 + 0.45 * sin(uTime * 3.0 + aSeed.x * 40.0));
  gl_PointSize = (3.0 + 4.0 * aSeed.y) * (1.0 - k * 0.6);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const moteFrag = /* glsl */ `
precision mediump float;
uniform vec3 uColor; varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor, a * a * vA); }`;

function moteGeometry(n: number, seedBase: number) {
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(n * 3), pos = new Float32Array(n * 3);
  const rnd = (i: number) => { const x = Math.sin(i * 91.7 + seedBase * 17.3) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < n; i++) { seed[i * 3] = rnd(i); seed[i * 3 + 1] = Math.sqrt(rnd(i + 100)); seed[i * 3 + 2] = rnd(i + 200); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 12);   // positions are computed in the shader
  return g;
}

export function buildPad(p: Pad, index: number, opts: { beams: boolean }): THREE.Group {
  const key = p.kind === 'bounce' ? p.tier : 'jump';
  const color = new THREE.Color(COLORS[key]);
  const g = new THREE.Group();
  g.position.set(p.pos[0], p.pos[1] + 0.012, p.pos[2]);

  g.add(new THREE.Mesh(housing, housingMat));
  g.add(new THREE.Mesh(trimGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.6) })));

  let dir = new THREE.Vector2(0, 1);
  if (p.kind === 'jump') { const v = jumpPadVelocity(p.pos, p.target); dir = new THREE.Vector2(v[0], v[2]).normalize(); }
  const plate = new THREE.Mesh(plateGeo, new THREE.ShaderMaterial({
    vertexShader: plateVert, fragmentShader: plateFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: padTime, uColor: { value: color }, uDir: { value: dir }, uMode: { value: p.kind === 'jump' ? 0 : 1 }, uRings: { value: p.kind === 'bounce' ? RINGS[p.tier] : 1 } },
  }));
  plate.renderOrder = 2; g.add(plate);

  if (opts.beams) {
    const H = COLUMN_H[key];
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, H, 28, 1, true).translate(0, H / 2 + 0.1, 0), new THREE.ShaderMaterial({
      vertexShader: columnVert, fragmentShader: columnFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: color }, uTime: padTime },
    }));
    col.renderOrder = 3; g.add(col);
    const motes = new THREE.Points(moteGeometry(18, index), new THREE.ShaderMaterial({
      vertexShader: moteVert, fragmentShader: moteFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: color.clone().lerp(new THREE.Color(1, 1, 1), 0.35) }, uTime: padTime, uH: { value: H } },
    }));
    motes.frustumCulled = false; motes.renderOrder = 4; g.add(motes);
  }
  return g;
}

/** Soft additive light column (reused by pickups). */
export function columnMesh(color: THREE.Color, H: number, r = 1.0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, H, 24, 1, true).translate(0, H / 2, 0), new THREE.ShaderMaterial({
    vertexShader: columnVert, fragmentShader: columnFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uTime: padTime },
  }));
  m.renderOrder = 3; return m;
}

// ───────────── teleporter gates ─────────────
// An upright stone-and-steel doorway filled with a swirling blue-white energy surface; sparks orbit inside it.
// Walk through and you come out at the other end (the arrival point has a softer glow of its own).
const GATE_BLUE = new THREE.Color(0x56a8ff), GATE_W = 2.5, GATE_H = 3.2, GATE_Y0 = 0.25;
const gateSurfVert = /* glsl */ `varying vec2 vQ; void main(){ vQ = (uv - 0.5) * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const gateSurfFrag = /* glsl */ `
precision mediump float;
uniform float uTime; uniform vec3 uColor; varying vec2 vQ;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 q = vec2(vQ.x * 1.0, vQ.y * 1.25);                       // roughly circular coordinates inside the tall doorway
  float r = length(q), a = atan(q.y, q.x);
  float spiral = sin(a * 3.0 - r * 8.0 + uTime * 3.2);          // slow arms winding into the centre
  float rings = sin(r * 15.0 - uTime * 5.0);                    // ripples racing inward
  float arms = smoothstep(0.25, 1.0, spiral * 0.5 + 0.5);
  float core = smoothstep(0.75, 0.0, r);
  float fl = 0.5;
  float edge = smoothstep(1.0, 0.72, max(abs(vQ.x), abs(vQ.y) * 0.96));       // soft edge so it blends into the frame
  vec3 c = mix(uColor * 0.55, vec3(0.85, 0.95, 1.0), core * 0.85 + arms * 0.25);
  float light = 0.45 + arms * 0.9 + (rings * 0.5 + 0.5) * 0.35 + core * 1.1 + fl * 0.18;
  gl_FragColor = vec4(c * light, edge * (0.55 + arms * 0.25 + core * 0.2));
}`;
const gateSparkVert = /* glsl */ `
attribute vec3 aSeed; uniform float uTime; varying float vA;
void main(){
  float dir = aSeed.z > 0.5 ? 1.0 : -1.0;
  float ang = aSeed.x * 6.2831 + uTime * dir * (0.7 + aSeed.y * 1.7);
  float rad = 0.18 + aSeed.y * 0.95;
  vec3 p = vec3(cos(ang) * rad * 0.98, 1.85 + sin(ang) * rad * 1.38, sin(uTime * 2.1 + aSeed.x * 31.0) * 0.1);
  vA = 0.45 + 0.55 * sin(uTime * 4.0 + aSeed.x * 50.0);
  gl_PointSize = 3.0 + 5.0 * (1.0 - aSeed.y) * (0.7 + 0.3 * vA);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const gateSparkFrag = /* glsl */ `
precision mediump float;
varying float vA;
void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(0.8, 0.93, 1.0, a * a * vA); }`;
const glowFrag = /* glsl */ `
precision mediump float;
uniform vec3 uColor; uniform float uTime; varying vec2 vQ;
void main(){ float r = length(vQ); float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(uColor, a * a * (0.32 + 0.08 * sin(uTime * 3.0))); }`;
const gateFrameMat = new THREE.MeshLambertMaterial({ color: 0x59606c });
const gateTrimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fd2ff).multiplyScalar(1.5) });
const gateFrameGeo = (() => {
  const box = (w: number, h: number, d: number, x: number, y: number, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
  const parts = [
    box(3.5, 0.25, 1.1, 0, 0.125), box(0.5, 3.75, 0.7, -1.5, GATE_Y0 + 1.875), box(0.5, 3.75, 0.7, 1.5, GATE_Y0 + 1.875),   // plinth, posts
    box(3.5, 0.5, 0.7, 0, GATE_Y0 + GATE_H + 0.25), box(1.3, 0.28, 0.5, 0, GATE_Y0 + GATE_H + 0.64),                      // lintel + crest
    box(0.3, 0.3, 0.8, -1.5, 0.4), box(0.3, 0.3, 0.8, 1.5, 0.4),                                                            // foot braces
  ];
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts)!;
})();
const gateTrimGeo = (() => {
  const box = (w: number, h: number, d: number, x: number, y: number, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
  const parts = [box(0.07, GATE_H, 0.1, -1.26, GATE_Y0 + GATE_H / 2, 0.38), box(0.07, GATE_H, 0.1, 1.26, GATE_Y0 + GATE_H / 2, 0.38), box(2.6, 0.07, 0.1, 0, GATE_Y0 + GATE_H - 0.02, 0.38),
    box(0.07, GATE_H, 0.1, -1.26, GATE_Y0 + GATE_H / 2, -0.38), box(0.07, GATE_H, 0.1, 1.26, GATE_Y0 + GATE_H / 2, -0.38), box(2.6, 0.07, 0.1, 0, GATE_Y0 + GATE_H - 0.02, -0.38),
    box(0.9, 0.08, 0.1, 0, GATE_Y0 + GATE_H + 0.64, 0.27), box(0.9, 0.08, 0.1, 0, GATE_Y0 + GATE_H + 0.64, -0.27)];
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts)!;
})();
const gateSurfGeo = new THREE.PlaneGeometry(GATE_W, GATE_H).translate(0, GATE_Y0 + GATE_H / 2, 0);
const gateGlowGeo = new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2).translate(0, 0.04, 0);
function gateSparks(n: number, seedBase: number) {
  const g = new THREE.BufferGeometry(), seed = new Float32Array(n * 3);
  const rnd = (i: number) => { const x = Math.sin(i * 77.3 + seedBase * 13.1) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < n; i++) { seed[i * 3] = rnd(i); seed[i * 3 + 1] = Math.sqrt(rnd(i + 50)); seed[i * 3 + 2] = rnd(i + 90); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 3);
  return g;
}
export const teleTime = { value: 0 };
let gateCount = 0;
export function buildTeleporter(t: { pos: [number, number, number]; dest: [number, number, number]; face: number }, fancy = true): { gate: THREE.Group; exit: THREE.Group; spin: THREE.Object3D[] } {
  const gate = new THREE.Group(); gate.position.set(t.pos[0], t.pos[1] + 0.012, t.pos[2]); gate.rotation.y = t.face;
  gate.add(new THREE.Mesh(gateFrameGeo, gateFrameMat), new THREE.Mesh(gateTrimGeo, gateTrimMat));
  const surf = new THREE.Mesh(gateSurfGeo, new THREE.ShaderMaterial({ vertexShader: gateSurfVert, fragmentShader: gateSurfFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uTime: teleTime, uColor: { value: GATE_BLUE } } }));
  surf.renderOrder = 3; gate.add(surf);
  if (fancy) {
  const sparks = new THREE.Points(gateSparks(46, gateCount++), new THREE.ShaderMaterial({ vertexShader: gateSparkVert, fragmentShader: gateSparkFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: teleTime } }));
  sparks.frustumCulled = false; sparks.renderOrder = 4; gate.add(sparks);
  }
  const glow = new THREE.Mesh(gateGlowGeo, new THREE.ShaderMaterial({ vertexShader: gateSurfVert, fragmentShader: glowFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: teleTime, uColor: { value: GATE_BLUE } } }));
  glow.renderOrder = 2; if (fancy) gate.add(glow);
  // where you come out: a soft ring of light and a thin rising column
  const exit = new THREE.Group(); exit.position.set(t.dest[0], t.dest[1] + 0.03, t.dest[2]);
  exit.add(new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: GATE_BLUE, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })));
  if (fancy) exit.add(columnMesh(GATE_BLUE, 2.2, 0.75));
  return { gate, exit, spin: [] };
}
