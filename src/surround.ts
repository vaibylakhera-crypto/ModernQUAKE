import * as THREE from 'three';

// Distant set-dressing that makes the void feel inhabited: an asteroid belt, a huge ring-station, derelict spires.
// All static, merged into a handful of draw calls; slow drift is a single group rotation (nearly free on a GT 730).

function rng(seed: number) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

function rockGeometry(r: () => number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.7 + r() * 0.55; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); }
  g.computeVertexNormals(); return g.toNonIndexed();
}

export function buildSurround(): { group: THREE.Group; update(t: number): void } {
  const group = new THREE.Group(); const r = rng(77);

  // asteroid belt: two shells, instanced
  const belt = new THREE.Group();
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x5a5368 });
  for (let v = 0; v < 3; v++) {
    const n = 46; const im = new THREE.InstancedMesh(rockGeometry(r), rockMat, n); const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, rad = 150 + r() * 220, y = (r() - 0.5) * 170 + (r() < 0.2 ? 90 : 0);
      const sc = 2 + Math.pow(r(), 3) * 26;
      e.set(r() * 6, r() * 6, r() * 6); q.setFromEuler(e);
      m.compose(new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad), q, new THREE.Vector3(sc, sc * (0.7 + r() * 0.5), sc));
      im.setMatrixAt(i, m);
    }
    im.frustumCulled = false; belt.add(im);
  }
  group.add(belt);

  // ring-station: a huge dark torus with glowing trim bands and window strips, tilted on the horizon
  const ring = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.TorusGeometry(260, 9, 8, 96), new THREE.MeshLambertMaterial({ color: 0x4a5266 }));
  ring.add(hull);
  const trimMat = new THREE.MeshBasicMaterial({ color: 0x5ee8ff, fog: false });
  const trim = new THREE.Mesh(new THREE.TorusGeometry(260, 1.2, 4, 96).translate(0, 0, 8), trimMat); ring.add(trim);
  const trim2 = new THREE.Mesh(new THREE.TorusGeometry(260, 1.2, 4, 96).translate(0, 0, -8), new THREE.MeshBasicMaterial({ color: 0xff7a3a, fog: false })); ring.add(trim2);
  // lit windows: points scattered on the ring
  const wp: number[] = []; for (let i = 0; i < 420; i++) { const a = (i / 420) * Math.PI * 2 + r() * 0.01, off = (r() - 0.5) * 12; wp.push(Math.cos(a) * (260 + (r() - 0.5) * 12), Math.sin(a) * (260 + (r() - 0.5) * 12), off * 0.9); }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  ring.add(new THREE.Points(wg, new THREE.PointsMaterial({ color: 0xffe2a0, size: 4.2, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.95 })));
  // spokes toward a central hub far behind it
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; const s = new THREE.Mesh(new THREE.BoxGeometry(4, 258, 4), hull.material); s.position.set(Math.cos(a) * 130, Math.sin(a) * 130, 0); s.rotation.z = a - Math.PI / 2; ring.add(s); }
  ring.add(new THREE.Mesh(new THREE.SphereGeometry(26, 16, 12), hull.material));
  ring.position.set(-120, 150, -430); ring.rotation.set(1.05, 0.35, 0.2);
  group.add(ring);

  // derelict spires / wrecked pylons drifting far out
  const spireMat = new THREE.MeshLambertMaterial({ color: 0x3d4357 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff4a3a, fog: false });
  const spires = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, rad = 210 + r() * 120; const h = 50 + r() * 90, w = 5 + r() * 7;
    const s = new THREE.Group(); const body = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.35, w, h, 6), spireMat); s.add(body);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 6), glowMat); cap.position.y = h / 2 + 1; s.add(cap);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w * 3.2, 1.2, w * 1.4), spireMat); slab.position.y = -h * 0.12; s.add(slab);
    s.position.set(Math.cos(a) * rad, (r() - 0.5) * 120 - 20, Math.sin(a) * rad); s.rotation.set((r() - 0.5) * 0.5, r() * 6, (r() - 0.5) * 0.5);
    spires.add(s);
  }
  group.add(spires);

  return {
    group,
    update(t: number) { belt.rotation.y = t * 0.006; spires.rotation.y = -t * 0.004; ring.rotation.z = 0.2 + t * 0.004; },
  };
}
