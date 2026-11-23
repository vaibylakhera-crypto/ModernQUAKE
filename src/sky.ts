import * as THREE from 'three';

// Sky v2: a physically-motivated deep-space dome, baked once to a cubemap (zero per-frame cost).
// Layers: black-violet base · Milky Way band with dust lanes · domain-warped nebula · thin aurora ribbons
//         · lit gas giant with shadowed rings · cratered moon · sun.
const vert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}`;

const frag = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir, uPlanetDir, uMoonDir, uBandN;
uniform float uSeed; uniform vec4 uK;
uniform vec3 uAurA, uAurB, uAurC, uNebA, uNebB, uNebC;

float h31(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float n3(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(h31(i), h31(i+vec3(1,0,0)), f.x), mix(h31(i+vec3(0,1,0)), h31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)), h31(i+vec3(1,0,1)), f.x), mix(h31(i+vec3(0,1,1)), h31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a*n3(p); p = p*2.02 + vec3(7.1, 3.7, 11.3); a *= 0.5; } return s; }

// ---- Milky Way ----
vec3 galaxy(vec3 d){
  float lat = dot(d, uBandN);
  float band = exp(-lat*lat*16.0);
  float clump = fbm3(d*3.2 + 1.7);
  float dust = smoothstep(0.42, 0.72, fbm3(d*6.0 + 8.0)) * exp(-lat*lat*26.0);
  float lum = band * (0.25 + 1.0*clump) * (1.0 - dust*0.9);
  float warm = smoothstep(0.15, 0.9, exp(-lat*lat*45.0) * clump * 1.6);
  vec3 col = mix(vec3(0.40, 0.50, 0.95), vec3(1.0, 0.72, 0.52), warm);
  float grain = pow(n3(d*520.0), 14.0) * 4.0 * band * (1.0 - dust*0.7);
  return col*lum*0.55 + grain*vec3(0.9, 0.95, 1.0);
}

// ---- nebula: domain-warped fbm in patches, bright filaments ----
vec3 nebula(vec3 d){
  vec3 p = d*2.3 + uSeed;
  vec3 w = vec3(fbm3(p*1.2), fbm3(p*1.2 + 5.2), fbm3(p*1.2 + 9.7));
  float n = fbm3(p + w*1.7);
  float mask = smoothstep(0.40, 0.78, fbm3(d*1.15 + 3.3 + uSeed*0.37));
  float dens = smoothstep(0.34, 0.86, n) * mask;
  float ridge = 1.0 - abs(2.0*fbm3(p*2.4 + w) - 1.0);
  vec3 c = mix(uNebA, uNebB, smoothstep(0.3, 0.8, fbm3(p*0.8 + 2.0)));
  c = mix(c, uNebC, smoothstep(0.55, 0.92, ridge) * 0.7);
  return c * (dens*0.5 + pow(ridge, 7.0)*dens*0.55);
}

// ---- aurora: thin sinuous ribbons, hard-ish lower edge, soft upward fade, no dripping ----
vec3 aurora(vec3 d){
  vec3 col = vec3(0.0);
  float ang = atan(d.z, d.x);
  float e = asin(clamp(d.y, -1.0, 1.0));
  for (int i = 0; i < 3; i++){
    float fi = float(i), s = uSeed + fi*13.0;
    vec3 ring = vec3(cos(ang), sin(ang), fi);
    float c = 0.20 + fi*0.15 + 0.10*sin(ang*2.0 + s) + 0.05*sin(ang*5.0 + s*2.0) + 0.12*(fbm3(ring*1.4 + s) - 0.5);
    float x = e - c;
    float lower = smoothstep(-0.012, 0.010, x);
    float upper = exp(-max(x, 0.0) * mix(12.0, 6.0, fract(s*0.37)));
    float along = smoothstep(0.42, 0.80, fbm3(vec3(cos(ang)*1.6, sin(ang)*1.6, fi*3.0 + s)));
    float rays = 0.82 + 0.18*n3(vec3(ang*70.0, x*14.0, s));
    float v = clamp(x*6.5, 0.0, 1.0);
    vec3 cc = mix(uAurA, uAurB, smoothstep(0.0, 0.40, v));
    cc = mix(cc, uAurC, smoothstep(0.45, 1.0, v));
    col += cc * lower * upper * along * rays * (1.0 - fi*0.2);
  }
  return col * smoothstep(-0.05, 0.12, d.y);
}

// ---- sun ----
vec3 sun(vec3 d){
  float sd = max(dot(d, uSunDir), 0.0);
  return vec3(1.0, 0.92, 0.75) * (smoothstep(0.99965, 0.99985, sd)*9.0 + pow(sd, 600.0)*1.2 + pow(sd, 40.0)*0.14);
}

// ray-sphere: returns t of near hit or -1
float hitSphere(vec3 d, vec3 C, float r){
  float b = dot(d, C); float disc = b*b - (dot(C, C) - r*r);
  if (disc < 0.0) return -1.0;
  float t = b - sqrt(disc); return t > 0.0 ? t : -1.0;
}

// ---- gas giant with rings; writes colour and coverage ----
vec4 planet(vec3 d){
  float R = 0.30, r = sin(R);
  vec3 C = uPlanetDir;
  vec3 axis = normalize(vec3(0.18, 1.0, 0.12));
  vec3 ringN = normalize(vec3(0.30, 1.0, 0.18));
  float tp = hitSphere(d, C, r);
  // ring plane
  float tr = -1.0; float rr = 0.0;
  float den = dot(d, ringN);
  if (abs(den) > 1e-4){ tr = dot(C, ringN) / den; if (tr > 0.0){ vec3 P = d*tr; rr = length(P - C) / r; } }
  bool ringHit = tr > 0.0 && rr > 1.35 && rr < 2.45;
  vec3 col = vec3(0.0); float cov = 0.0;
  // ring (behind or in front of the planet)
  vec4 ringC = vec4(0.0);
  if (ringHit){
    float bands = 0.55 + 0.45*sin(rr*70.0 + fbm3(vec3(rr*9.0, 1.0, 2.0))*5.0);
    float gaps = smoothstep(0.18, 0.32, fbm3(vec3(rr*22.0, 3.0, 5.0)));
    float edge = smoothstep(1.35, 1.46, rr) * (1.0 - smoothstep(2.30, 2.45, rr));
    float a = edge * gaps * (0.35 + 0.65*bands);
    vec3 P = d*tr;
    float sh = hitSphere(uSunDir, C - P, r) > 0.0 ? 0.12 : 1.0;      // planet shadow on the ring
    vec3 rc = mix(vec3(0.62, 0.50, 0.40), vec3(0.88, 0.78, 0.66), bands) * sh * (0.25 + 0.9*max(0.0, abs(dot(ringN, uSunDir))));
    ringC = vec4(rc, a * 0.92);
  }
  if (tp > 0.0){
    vec3 N = normalize(d*tp - C);
    float lat = dot(N, axis);
    vec3 q = vec3(N.x*3.0, lat*5.0, N.z*3.0);
    float warp = fbm3(q*1.7 + 3.0);
    float bnd = 0.5 + 0.5*sin(lat*11.0 + warp*9.0 + fbm3(q*3.0)*2.5);
    vec3 base = mix(vec3(0.34, 0.24, 0.40), vec3(0.80, 0.60, 0.48), smoothstep(0.15, 0.85, bnd));
    base *= 1.0 - 0.45*pow(abs(lat), 3.0);                 // darker poles
    base = mix(base, vec3(0.95, 0.85, 0.70), smoothstep(0.6, 0.95, fbm3(q*2.6 + 7.0))*0.35);
    float diff = clamp(dot(N, uSunDir), 0.0, 1.0);
    float term = smoothstep(0.0, 0.35, diff);
    vec3 V = -d;
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col = base * (0.012 + term*0.8) + vec3(0.30, 0.50, 1.0) * rim * (0.08 + 0.85*diff);
    // ring in front of the planet
    if (ringHit && tr < tp) col = mix(col, ringC.rgb, ringC.a);
    cov = 1.0;
  } else {
    float ang = acos(clamp(dot(d, C), -1.0, 1.0));
    float glow = exp(-(ang - R)*55.0) * step(R, ang);
    vec3 side = vec3(0.25, 0.45, 1.0) * glow * (0.15 + 0.85*clamp(dot(normalize(d - C*dot(d, C)), uSunDir)*0.5 + 0.5, 0.0, 1.0));
    col = side; cov = clamp(glow, 0.0, 1.0)*0.9;
    if (ringHit){ col = col*(1.0 - ringC.a) + ringC.rgb*ringC.a; cov = max(cov, ringC.a); }
  }
  return vec4(col, cov);
}

// ---- cratered moon ----
vec4 moon(vec3 d){
  float R = 0.06, r = sin(R); vec3 C = uMoonDir;
  float t = hitSphere(d, C, r); if (t < 0.0) return vec4(0.0);
  vec3 N = normalize(d*t - C);
  float tex = 0.55 + 0.35*fbm3(N*7.0 + 2.0);
  float crater = smoothstep(0.55, 0.62, n3(N*13.0)) * 0.35 + smoothstep(0.6, 0.66, n3(N*27.0)) * 0.2;
  float diff = clamp(dot(N, uSunDir), 0.0, 1.0);
  return vec4(vec3(0.74, 0.72, 0.70) * (tex - crater) * (0.07 + diff*1.25), 1.0);
}

void main(){
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.004, 0.005, 0.012) * (0.4 + uK.y) + vec3(0.012, 0.006, 0.02) * (0.5 + 0.5*d.y) * uK.y;
  col += galaxy(d) * uK.x;
  col += nebula(d) * uK.y;
  col += aurora(d) * uK.z;
  col += sun(d) * uK.w;
  vec4 m = moon(d);   col = mix(col, m.rgb, m.a);
  vec4 p = planet(d); col = mix(col, p.rgb, clamp(p.a, 0.0, 1.0));
  col = col / (1.0 + col*0.45);      // soft shoulder, no hard clipping
  gl_FragColor = vec4(col, 1.0);
}`;

export interface SkyPreset { aurA: number; aurB: number; aurC: number; nebA: number; nebB: number; nebC: number; planet: [number, number, number]; moon: [number, number, number]; sun: [number, number, number]; band: [number, number, number]; seed: number; k?: [number, number, number, number]; stars?: number }
export const SKY_PRESETS: Record<string, SkyPreset> = {
  void:    { aurA: 0x000000, aurB: 0x000000, aurC: 0x000000, nebA: 0x14103a, nebB: 0x0a2440, nebC: 0x301030, planet: [0.62, 0.16, -0.77], moon: [0.30, 0.42, -0.86], sun: [-0.78, 0.22, 0.58], band: [0.35, 0.85, 0.40], seed: 5.2, k: [0.7, 0.16, 0, 0.5], stars: 3200 },
  boreal:  { aurA: 0x32ff9c, aurB: 0x1ec8e8, aurC: 0xb454ff, nebA: 0x2a1466, nebB: 0x0d4a72, nebC: 0xc02a8a, planet: [0.62, 0.16, -0.77], moon: [0.30, 0.42, -0.86], sun: [-0.78, 0.22, 0.58], band: [0.35, 0.85, 0.40], seed: 3.7 },
  crimson: { aurA: 0xff4d86, aurB: 0xff9a2d, aurC: 0x8a3dff, nebA: 0x5a0f2a, nebB: 0x2a1a6a, nebC: 0xff6a2a, planet: [-0.70, 0.22, -0.68], moon: [0.5, 0.25, -0.82], sun: [0.8, 0.2, 0.55], band: [-0.3, 0.9, 0.3], seed: 9.1 },
};

export class Sky {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  sunDir: THREE.Vector3;
  bandN: THREE.Vector3;
  constructor(preset = 'boreal') {
    const p = SKY_PRESETS[preset];
    this.sunDir = new THREE.Vector3(...p.sun).normalize();
    this.bandN = new THREE.Vector3(...p.band).normalize();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: {
        uSunDir: { value: this.sunDir }, uPlanetDir: { value: new THREE.Vector3(...p.planet).normalize() },
        uMoonDir: { value: new THREE.Vector3(...p.moon).normalize() }, uBandN: { value: this.bandN }, uSeed: { value: p.seed }, uK: { value: new THREE.Vector4(...(p.k ?? [1, 1, 1, 1])) },
        uAurA: { value: new THREE.Color(p.aurA) }, uAurB: { value: new THREE.Color(p.aurB) }, uAurC: { value: new THREE.Color(p.aurC) },
        uNebA: { value: new THREE.Color(p.nebA) }, uNebB: { value: new THREE.Color(p.nebB) }, uNebC: { value: new THREE.Color(p.nebC) },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 32), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }
  get planetDir() { return this.mat.uniforms.uPlanetDir.value as THREE.Vector3; }
  update(_t: number, cam: THREE.Camera) { this.mesh.position.copy(cam.position); }
}

// Crisp round point stars, denser inside the Milky Way band. Follows the camera.
export class Stars {
  mesh: THREE.Points;
  /** plain = even sky-wide spread, crisp pinpoints for a pure black background */
  constructor(bandN: THREE.Vector3, count = 1700, plain = false) {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
    let seed = 1337; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    let i = 0;
    while (i < count) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const dx = s * Math.cos(a), dy = u, dz = s * Math.sin(a);
      const lat = dx * bandN.x + dy * bandN.y + dz * bandN.z;
      if (!plain && r() > (count > 2500 ? 0.45 : 0.08) + (count > 2500 ? 0.55 : 0.92) * Math.exp(-lat * lat * 10)) continue;       // bias towards the band
      pos.set([dx * 450, dy * 450, dz * 450], i * 3);
      const b = Math.pow(r(), 3.4), warm = r();
      const c = new THREE.Color().setRGB(0.72 + warm * 0.28, 0.82 + (1 - warm) * 0.14, 1.0 - warm * 0.4);
      col.set([c.r * (0.3 + b), c.g * (0.3 + b), c.b * (0.3 + b)], i * 3);
      if (plain) { const k = 0.45 + b * 1.4; col.set([c.r * k, c.g * k, c.b * k], i * 3); size[i] = 1.3 + b * 2.2; i++; continue; }
      size[i] = count > 2500 ? 1.0 + b * 1.6 : 0.9 + b * 2.4; i++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, uniforms: { uPx: { value: 1 } },
      vertexShader: `attribute vec3 aCol; attribute float aSize; uniform float uPx; varying vec3 vC;
        void main(){ vC = aCol; gl_PointSize = aSize * uPx; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `precision mediump float; varying vec3 vC;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); gl_FragColor = vec4(vC * a * a * 1.6, a); }`,
    });
    this.mesh = new THREE.Points(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = -900;
  }
  update(cam: THREE.Camera, pxRatio: number) { this.mesh.position.copy(cam.position); (this.mesh.material as THREE.ShaderMaterial).uniforms.uPx.value = pxRatio; }
}
