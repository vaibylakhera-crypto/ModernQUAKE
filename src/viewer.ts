import * as THREE from 'three';
import { Sky } from './sky';
import { WEAPON_ORDER, WEAPON_DEFS, buildWeapon } from './weapons';
import { Viewmodel } from './viewmodel';
import { makeRig } from './character';
import { buildFighter } from './dress';
import { animate, holdWeapon, AnimState } from './anim';

// Standalone model viewer: /viewer.html?m=weapons  (grid of every weapon on turntables)
const params = new URLSearchParams(location.search);
const mode = params.get('m') || 'weapons';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.localClippingEnabled = true; renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
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

// m=vm: every weapon exactly as it appears in first person (hands + gun), 4x2 grid
const vms: Viewmodel[] = [];
if (mode === 'vm') {
  WEAPON_ORDER.forEach(id => { const v = new Viewmodel(); v.show(id); vms.push(v); });
  label.textContent = 'FIRST-PERSON AUDIT  ·  ' + WEAPON_ORDER.map(i => WEAPON_DEFS[i].name).join(' · ');
}
const only = params.get('only');   // ?only=rail renders one weapon fullscreen
function renderVM() {
  const W = innerWidth, H = innerHeight;
  renderer.setScissorTest(true); renderer.setClearColor(0x1b2029, 1);
  const list = only ? [vms[WEAPON_ORDER.indexOf(only as any)]] : vms;
  const cols = only ? 1 : 4, rows = only ? 1 : 2, cw = W / cols, ch = H / rows;
  list.forEach((v, i) => {
    const x = (i % cols) * cw, y = H - (Math.floor(i / cols) + 1) * ch;
    v.update(0.016, { speed: 0, grounded: true, lookDX: 0, lookDY: 0, spinning: false, beam: false });
    renderer.setViewport(x, y, cw, ch); renderer.setScissor(x, y, cw, ch); renderer.clear(); v.resize(cw / ch);
    if (params.get('fov')) { v.camera.fov = Number(params.get('fov')); v.camera.updateProjectionMatrix(); v.camera.lookAt(0.12, -0.22, -0.6); }
    if (params.get('close')) {     // 3/4 audit camera close to the hands + gun
      const a = Number(params.get('close')) || 0.5;
      v.camera.fov = 38; v.camera.updateProjectionMatrix();
      v.camera.position.set(0.2 + Math.sin(a) * 0.62, -0.12 + 0.12, -0.55 + Math.cos(a) * 0.62 - 0.06); v.camera.lookAt(0.2, -0.24, -0.6);
    }
    renderer.render(v.scene, v.camera);
  });
}

// m=char: load the base character and print bind-pose bone positions
if (mode === 'char') {
  buildFighter((params.get('g') as any) || 'male', params.get('team') ? parseInt(params.get('team')!, 16) : 0x35d8ff).then(rig => {
    scene.add(rig.root);
    const bb = new THREE.Box3().setFromObject(rig.root); const sz = bb.getSize(new THREE.Vector3()); const c = bb.getCenter(new THREE.Vector3());
    camera.position.set(0, c.y, 9); camera.lookAt(0, c.y, 0);
    const pick = ['root','pelvis','spine_03','neck_01','Head','clavicle_l','upperarm_l','lowerarm_l','hand_l','thigh_l','calf_l','foot_l','ball_l','upperarm_r','hand_r'];
    (window as any).__rig = rig;
    label.textContent = `size ${sz.x.toFixed(2)} x ${sz.y.toFixed(2)} x ${sz.z.toFixed(2)}  min y ${bb.min.y.toFixed(2)}  ` + pick.map(n => `${n}(${rig.restPos[n].toArray().map(v => v.toFixed(2)).join(',')})`).join(' ');
    label.style.whiteSpace = 'pre-wrap'; label.style.maxWidth = '1100px'; label.style.fontSize = '11px';
    // visible with PBR-less default material? show what we get
    turn.push(rig.root);
    const st: AnimState = { t: Number(params.get('t') || 0), speed: Number(params.get('run') || 0), dead: Number(params.get('dead') || 0), look: 0, pain: 0, fire: 0 };
    animate(rig, st);
    if (params.get('gun')) holdWeapon(rig, params.get('gun') as any);
    (window as any).__anim = st;
    (window as any).__tick = () => animate(rig, st);
    if (!params.get('freeze')) { const t0 = performance.now(); setInterval(() => { st.t = (performance.now() - t0) / 1000; animate(rig, st); }, 16); }
  });
}

const fixedYaw = params.get('yaw'); // freeze for screenshots
let t0 = performance.now();
function frame(now: number) {
  const t = (now - t0) / 1000;
  turn.forEach(p => { p.rotation.y = fixedYaw ? Number(fixedYaw) : -0.6 + t * 0.5; });
  if (mode === 'vm') renderVM(); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
(window as any).__v = { scene, camera, renderer, THREE };
(window as any).__vms = vms;
