import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky, Stars } from './sky';
import { World } from './world';
import { kitOptions } from './kit';
import { getQuality } from './quality';
import { Player, PM, Input } from './player';
import { boxes } from './level';
import { Viewmodel } from './viewmodel';
import { WEAPON_ORDER, WEAPON_DEFS, WeaponId } from './weapons';

const Q = getQuality();
kitOptions.cheap = !Q.pbr;

const renderer = new THREE.WebGLRenderer({ antialias: Q.antialias, powerPreference: 'high-performance', stencil: false });
let renderScale = Q.renderScale;
const applyRes = () => { renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio) * renderScale); renderer.setSize(innerWidth, innerHeight); };
applyRes();
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(100, innerWidth / innerHeight, 0.05, 1200);
camera.rotation.order = 'YXZ';

// sky: live shader on high, baked once to a cubemap on low/med (no per-frame noise cost)
const sky = new Sky('boreal');
if (Q.liveSky) scene.add(sky.mesh);
else {
  const rt = new THREE.WebGLCubeRenderTarget(Q.skyCube, { generateMipmaps: false, minFilter: THREE.LinearFilter });
  const skyScene = new THREE.Scene(); skyScene.add(sky.mesh);
  sky.update(8.0, new THREE.PerspectiveCamera());            // fixed time: a nice frozen aurora pose
  new THREE.CubeCamera(0.1, 1000, rt).update(renderer, skyScene);
  scene.background = rt.texture;
  if (Q.pbr) {                                               // med: reflections from the baked sky
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromCubemap(rt.texture).texture; scene.environmentIntensity = 1.6;
  }
}
if (Q.liveSky) {                                             // high: reflections from the live sky shader
  const pm = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene(); skyScene.add(new Sky('boreal').mesh);
  scene.environment = pm.fromScene(skyScene, 0, 0.1, 1000).texture; scene.environmentIntensity = 1.6;
}

const stars = new Stars(sky.bandN);
scene.add(stars.mesh);
scene.fog = new THREE.FogExp2(0x05070f, 0.0025);   // depth cue: far platforms sink into the void

const world = new World(Q);
scene.add(world.group);
world.build();

// lighting: aurora-tinted fill + planet key light (cheap: 1 hemisphere + 2 directional, no shadows)
scene.add(new THREE.HemisphereLight(0x8fdcff, 0x3a2a78, Q.pbr ? 1.4 : 2.6));
scene.add(new THREE.AmbientLight(0x6070a0, Q.pbr ? 0.2 : 0.7));
const key = new THREE.DirectionalLight(0xffe2c0, Q.pbr ? 3.2 : 2.4);
key.position.copy(sky.sunDir).multiplyScalar(100); scene.add(key);
const rim = new THREE.DirectionalLight(0x7a8cff, Q.pbr ? 1.6 : 1.1); rim.position.set(-40, 20, 60); scene.add(rim);

let composer: EffectComposer | null = null;
if (Q.bloom) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 1.0));
  composer.addPass(new OutputPass());
}

addEventListener('resize', () => {
  applyRes(); composer?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vm.resize(innerWidth / innerHeight);
});

// adaptive resolution: keep >= ~55 fps by trading render scale (weak GPUs); recovers when there is headroom
let frames = 0, accMs = 0;
function adapt(ms: number) {
  accMs += ms; frames++;
  if (accMs < 1000) return;
  const avg = accMs / frames; frames = 0; accMs = 0;
  const med = document.getElementById('medal'); if (med) med.textContent = `FFA · PRACTICE   |   ${Math.round(1000 / avg)} FPS · ${Q.tier.toUpperCase()} · RES ${Math.round(renderScale * 100)}%`;
  if (avg > 18.5 && renderScale > Q.minScale) { renderScale = Math.max(Q.minScale, renderScale - 0.08); applyRes(); }
  else if (avg < 12.5 && renderScale < Q.renderScale) { renderScale = Math.min(Q.renderScale, renderScale + 0.04); applyRes(); }
}

// ---- input ----
const keys = new Set<string>();
let jumpQueued = false;
let yaw = 0, pitch = 0;
const startEl = document.getElementById('start')!;
const locked = () => document.pointerLockElement === renderer.domElement;
startEl.addEventListener('click', () => renderer.domElement.requestPointerLock());
document.addEventListener('pointerlockchange', () => { startEl.style.display = locked() ? 'none' : 'flex'; });
addEventListener('mousemove', e => {
  if (!locked()) return;
  yaw -= e.movementX * 0.0022; pitch -= e.movementY * 0.0022; lookDX += e.movementX; lookDY += e.movementY;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});
addEventListener('keydown', e => {
  if (e.repeat) return;           // holding space never auto-hops
  keys.add(e.code);
  if (e.code === 'Space') jumpQueued = true;
  if (e.code === 'KeyR') { player.respawn(); yaw = player.yaw; pitch = 0; }
});
addEventListener('keyup', e => keys.delete(e.code));

const vm = new Viewmodel();
const wbar = document.getElementById('wbar')!;
WEAPON_ORDER.forEach((id, i) => {
  const d = document.createElement('div'); d.className = 'wslot'; d.id = 'w-' + id; d.style.setProperty('--c', '#' + WEAPON_DEFS[id].color.toString(16).padStart(6, '0'));
  d.innerHTML = `<b>${i + 1}</b>${WEAPON_DEFS[id].name}`; wbar.appendChild(d);
});
const markWeapon = (id: WeaponId) => { for (const w of WEAPON_ORDER) document.getElementById('w-' + w)!.classList.toggle('on', w === id); };
markWeapon(vm.current); vm.onSwitch = markWeapon;
let firing = false, lookDX = 0, lookDY = 0;
addEventListener('mousedown', e => { if (locked() && e.button === 0) firing = true; });
addEventListener('mouseup', e => { if (e.button === 0) firing = false; });
addEventListener('wheel', e => { if (locked()) vm.cycle(e.deltaY > 0 ? 1 : -1); });
addEventListener('keydown', e => { const n = Number(e.code.replace('Digit', '')); if (n >= 1 && n <= WEAPON_ORDER.length) vm.select(WEAPON_ORDER[n - 1]); });

const player = new Player(boxes);
yaw = player.yaw;

// ---- HUD ----
const speedEl = document.getElementById('speed')!;
const msgEl = document.getElementById('msg')!;
let shownPadTime = 0;
function hud() {
  speedEl.firstChild!.textContent = String(Math.round(player.speedXZ * 32));
  speedEl.style.color = player.speedXZ > 15 ? '#ff9a3c' : player.speedXZ > 11 ? '#ffe14a' : '#7ffff0';
  if (player.lastPadTime !== shownPadTime) { shownPadTime = player.lastPadTime; msgEl.textContent = player.lastPad; msgEl.style.opacity = '1'; setTimeout(() => (msgEl.style.opacity = '0'), 900); }
}

// ---- loop (fixed 120 Hz sim) ----
const DT = 1 / 120;
let acc = 0, last = performance.now();
function frame(now: number) {
  const frameMs = now - last;
  acc += Math.min(0.1, frameMs / 1000); last = now;
  while (acc >= DT) {
    const input: Input = {
      forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
      side: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
      jumpPressed: jumpQueued, crouch: keys.has('KeyC') || keys.has('ControlLeft'), yaw,
    };
    jumpQueued = false;
    player.step(input, DT);
    acc -= DT;
  }
  camera.position.set(player.x, player.y + player.eye, player.z);
  camera.rotation.set(pitch, yaw, 0);
  stars.update(camera, renderer.getPixelRatio());
  if (!Q.liveSky) { const a = now / 1000 * 0.004; scene.backgroundRotation.y = a; stars.mesh.rotation.y = a; }
  if (Q.liveSky) sky.update(now / 1000, camera);
  world.update(now / 1000);
  hud();
  if (composer) composer.render(); else renderer.render(scene, camera);
  vm.update(Math.min(0.05, frameMs / 1000), { speed: player.speedXZ, grounded: player.grounded, lookDX, lookDY, firing: firing && locked() }); lookDX = lookDY = 0;
  { const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(vm.scene, vm.camera); renderer.autoClear = ac; }
  adapt(frameMs);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// dev/test hook
(window as any).__game = { player, camera, vm, renderer, world, Q, get scale() { return renderScale; }, setLook: (y: number, p: number) => { yaw = y; pitch = p; }, PM };
