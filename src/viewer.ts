import * as THREE from 'three';
import { Sky } from './sky';
import { WEAPON_ORDER, WEAPON_DEFS, buildWeapon } from './weapons';

// Standalone model viewer: /viewer.html?m=weapons  (grid of every weapon on turntables)
const params = new URLSearchParams(location.search);
const mode = params.get('m') || 'weapons';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(13, innerWidth / innerHeight, 0.05, 100);

scene.background = new THREE.Color(0x232834);
const env = new THREE.PMREMGenerator(renderer);
{ const sky = new Sky('boreal'); const rt = new THREE.WebGLCubeRenderTarget(256, { generateMipmaps: false, minFilter: THREE.LinearFilter }); const s2 = new THREE.Scene(); s2.add(sky.mesh); new THREE.CubeCamera(0.1, 1000, rt).update(renderer, s2); scene.environment = env.fromCubemap(rt.texture).texture; }
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x3a2a78, 2.2));
scene.add(new THREE.AmbientLight(0x8090b0, 1.0));
const key = new THREE.DirectionalLight(0xfff0e0, 4.0); key.position.set(-3, 4, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0x8aa0ff, 2.5); rim.position.set(4, 2, -3); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 1.4); fill.position.set(0, -2, 5); scene.add(fill);

const turn: THREE.Object3D[] = [];
const label = document.getElementById('l')!;

if (mode === 'weapons') {
  const n = WEAPON_ORDER.length;
  WEAPON_ORDER.forEach((id, i) => {
    const w = buildWeapon(id);
    const pivot = new THREE.Group(); pivot.add(w.group);
    // centre each gun on its own bounding box
    const bb = new THREE.Box3().setFromObject(w.group); const c = bb.getCenter(new THREE.Vector3());
    w.group.position.sub(c);
    pivot.position.set((i - (n - 1) / 2) * 1.55, 0, 0);
    const sz = bb.getSize(new THREE.Vector3()); const s = 1.35 / Math.max(sz.x, sz.y, sz.z); pivot.scale.setScalar(s);
    scene.add(pivot); turn.push(pivot);
  });
  camera.position.set(0, 0.9, 17); camera.lookAt(0, 0, 0);
  label.textContent = WEAPON_ORDER.map(i => WEAPON_DEFS[i].name).join('   ·   ');
}

const fixedYaw = params.get('yaw'); // freeze for screenshots
let t0 = performance.now();
function frame(now: number) {
  const t = (now - t0) / 1000;
  turn.forEach(p => { p.rotation.y = fixedYaw ? Number(fixedYaw) : -0.6 + t * 0.5; });
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
(window as any).__v = { scene, camera, renderer, THREE };
