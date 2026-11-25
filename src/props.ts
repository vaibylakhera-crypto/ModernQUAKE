// Map dressing: team banners at the flag bases, glowing rings turning around the big pickups, and drifting embers in the air.
import * as THREE from 'three';
import { flags, pickups, THEME, MAP_ID } from './level';
import { BOOSTERS } from './pickups';

export const propTime = { value: 0 };

const clothVert = /* glsl */ `
varying vec2 vUv; uniform float uTime;
void main(){ vUv = uv; vec3 p = position; float k = (1.0 - uv.y); p.z += sin(p.y * 2.4 + uTime * 2.2 + p.x * 3.0) * 0.13 * k + sin(p.y * 5.0 - uTime * 3.1) * 0.04 * k; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`;
const clothFrag = /* glsl */ `
precision mediump float;
uniform vec3 uColor; varying vec2 vUv;
void main(){
  vec2 q = vUv - 0.5; float edge = max(abs(q.x) * 2.0, 0.0);
  vec3 c = uColor * (0.55 + 0.35 * vUv.y);
  float border = step(0.86, edge) + step(0.94, 1.0 - vUv.y) * 0.0;                         // dark trim down both sides
  c = mix(c, uColor * 0.25, border);
  vec2 d = vec2(q.x, (vUv.y - 0.55) * 0.55);                                                // a gold diamond emblem
  float dia = 1.0 - smoothstep(0.17, 0.2, abs(d.x) + abs(d.y) * 1.8);
  float ring = smoothstep(0.1, 0.12, abs(d.x) + abs(d.y) * 1.8) * dia;
  c = mix(c, vec3(1.0, 0.8, 0.3) * 0.9, ring);
  float tail = smoothstep(0.0, 0.07, vUv.y + (abs(q.x) - 0.15) * 0.18);                    // swallow-tail cut at the bottom
  if (tail < 0.5) discard;
  gl_FragColor = vec4(c, 1.0);
}`;
const ironMat = new THREE.MeshLambertMaterial({ color: 0x2c2826 });

export function buildProps(): { group: THREE.Group; spin: THREE.Object3D[] } {
  const group = new THREE.Group(), spin: THREE.Object3D[] = [];
  // banners: a pole with a cross-arm beside each flag base, the cloth in the team's colour
  if (flags) for (const team of ['red', 'blue'] as const) {
    const f = flags[team], away = f[0] < 0 ? -1 : 1, x = f[0] + away * 2.2, z = f[2] + 3.2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.9, 8).translate(0, 1.95, 0), ironMat), arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.07).translate(0, 3.8, 0), ironMat);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 2.5, 6, 14).translate(0, 2.45, 0.06), new THREE.ShaderMaterial({ vertexShader: clothVert, fragmentShader: clothFrag, side: THREE.DoubleSide, uniforms: { uTime: propTime, uColor: { value: new THREE.Color(team === 'red' ? 0xd8392b : 0x2f6fe0) } } }));
    const g = new THREE.Group(); g.add(pole, arm, cloth); g.position.set(x, f[1], z); g.rotation.y = away > 0 ? -Math.PI / 2 : Math.PI / 2; group.add(g);
  }
  // rings: two tilted rings turning around mega health and overdrive
  for (const p of pickups) {
    if (p.kind !== 'booster' || (p.id !== 'mega' && p.id !== 'overdrive')) continue;
    const col = new THREE.Color(BOOSTERS[p.id].color).lerp(new THREE.Color(1, 1, 1), 0.35);
    for (const [i, tilt] of [[0, 1.05], [1, -1.05]] as const) {
      const holder = new THREE.Group(); holder.position.set(p.pos[0], p.pos[1] + 1.05, p.pos[2]); holder.rotation.x = tilt; holder.rotation.y = i * 1.2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05 - i * 0.18, 0.035, 6, 48), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      holder.add(ring); group.add(holder); spin.push(ring);
    }
  }
  // Foundry: pairs of big interlocking gears turning slowly on the north and south walls
  if (MAP_ID === 'foundry') {
    const gear = (r: number, teeth: number) => {
      const sh = new THREE.Shape(), step = Math.PI * 2 / teeth;
      for (let i = 0; i < teeth; i++) { const a = i * step, pts = [[a, r], [a + step * 0.2, r], [a + step * 0.3, r + 0.38], [a + step * 0.7, r + 0.38], [a + step * 0.8, r]]; for (const [aa, rr] of pts) { const x = Math.cos(aa) * rr, y = Math.sin(aa) * rr; if (i === 0 && aa === a) sh.moveTo(x, y); else sh.lineTo(x, y); } }
      sh.closePath(); const hole = new THREE.Path(); hole.absarc(0, 0, r * 0.28, 0, Math.PI * 2, true); sh.holes.push(hole);
      for (let k = 0; k < 4; k++) { const sp = new THREE.Path(), a0 = k * Math.PI / 2 + 0.55, rr = r * 0.62; sp.absarc(Math.cos(a0) * rr, Math.sin(a0) * rr, r * 0.17, 0, Math.PI * 2, true); sh.holes.push(sp); }     // lightening holes
      return new THREE.ExtrudeGeometry(sh, { depth: 0.45, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
    };
    const mat = new THREE.MeshLambertMaterial({ color: 0x8a7868, emissive: 0x2a1a10 }), rim = new THREE.MeshBasicMaterial({ color: new THREE.Color(THEME.lamp).multiplyScalar(0.7), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const side of [-1, 1]) for (const [x, r, teeth, sp] of [[-6, 1.7, 14, 0.3], [-2.95, 1.25, 10, -0.41], [6, 1.5, 12, -0.34], [9, 1.1, 9, 0.46]] as const) {
      const holder = new THREE.Group(); holder.position.set(x, 8.7, side * 15.8); holder.rotation.y = side < 0 ? 0 : Math.PI;
      const g = new THREE.Mesh(gear(r, teeth), mat); g.userData.speed = sp * (side < 0 ? 1 : -1); g.position.z = 0;
      const glow = new THREE.Mesh(new THREE.TorusGeometry(r * 0.3, 0.03, 6, 32), rim); glow.position.z = 0.5; g.add(glow);
      holder.add(g); group.add(holder); spin.push(g);
    }
  }
  return { group, spin };
}

// ---- drifting embers / dust: one Points object that follows the camera, positions computed in the shader ----
const emberVert = /* glsl */ `
attribute vec3 aSeed; uniform float uTime; uniform vec3 uCam; varying float vA;
void main(){
  vec3 box = vec3(40.0, 20.0, 40.0);
  vec3 p = aSeed * box + vec3(sin(uTime * 0.3 + aSeed.x * 20.0) * 1.5, uTime * (0.35 + aSeed.y * 0.5), cos(uTime * 0.25 + aSeed.z * 20.0) * 1.5);
  p = mod(p - uCam + box * 0.5, box) - box * 0.5; vec4 mv = modelViewMatrix * vec4(p + uCam, 1.0);
  float d = length(p); vA = (0.35 + 0.65 * sin(uTime * 2.0 + aSeed.x * 60.0) * 0.5 + 0.325) * (1.0 - smoothstep(10.0, 20.0, d));
  gl_PointSize = 2.0 + aSeed.y * 2.5; gl_Position = projectionMatrix * mv;
}`;
const emberFrag = /* glsl */ `precision mediump float; uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uColor, smoothstep(0.5, 0.1, d) * vA * 0.7); }`;
export function buildEmbers(n: number): { points: THREE.Points; update: (cam: THREE.Vector3, t: number) => void } {
  const g = new THREE.BufferGeometry(), seed = new Float32Array(n * 3); for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const col = new THREE.Color(THEME.lamp).lerp(new THREE.Color(1, 0.6, 0.25), 0.55);
  const m = new THREE.ShaderMaterial({ vertexShader: emberVert, fragmentShader: emberFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uColor: { value: col } } });
  const points = new THREE.Points(g, m); points.frustumCulled = false; points.renderOrder = 6;
  return { points, update: (cam, t) => { m.uniforms.uTime.value = t; m.uniforms.uCam.value.copy(cam); } };
}
