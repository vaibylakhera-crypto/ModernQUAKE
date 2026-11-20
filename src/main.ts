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
import { Loadout } from './loadout';
import { Combat, Target } from './combat';
import { Pickups } from './pickups';
import { WEAPON_ORDER, WEAPON_DEFS } from './weapons';

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
  if (e.code === 'KeyR') { die('DIED'); }
});
addEventListener('keyup', e => keys.delete(e.code));

// ---- weapons / loadout / combat / pickups ----
const vm = new Viewmodel();
const loadout = new Loadout();
const wbar = document.getElementById('wbar')!;
WEAPON_ORDER.forEach((id, i) => {
  const d = document.createElement('div'); d.className = 'wslot'; d.id = 'w-' + id; d.style.setProperty('--c', '#' + WEAPON_DEFS[id].color.toString(16).padStart(6, '0'));
  d.innerHTML = `<b>${i + 1}</b>${WEAPON_DEFS[id].name}<i></i>`; wbar.appendChild(d);
});
let lastBar = '';
function refreshBar() {
  const key = WEAPON_ORDER.map(w => `${loadout.has(w) ? 1 : 0}${loadout.ammo[w]}${w === vm.target ? 'x' : ''}`).join('|');
  if (key === lastBar) return; lastBar = key;
  for (const w of WEAPON_ORDER) {
    const el = document.getElementById('w-' + w)!; const own = loadout.has(w);
    el.classList.toggle('own', own); el.classList.toggle('on', w === vm.target); el.classList.toggle('dry', own && !loadout.canFire(w));
    el.querySelector('i')!.textContent = own ? (loadout.ammo[w] === Infinity ? '∞' : String(loadout.ammo[w])) : '';
  }
}
let mouseDown = false, lookDX = 0, lookDY = 0;
addEventListener('mousedown', e => { if (locked() && e.button === 0) mouseDown = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
addEventListener('wheel', e => { if (locked()) vm.select(loadout.step(vm.target, e.deltaY > 0 ? 1 : -1)); });
addEventListener('keydown', e => {
  const n = Number(e.code.replace('Digit', ''));
  if (n >= 1 && n <= WEAPON_ORDER.length && loadout.has(WEAPON_ORDER[n - 1])) vm.select(WEAPON_ORDER[n - 1]);
});

const player = new Player(boxes);
yaw = player.yaw;
const speedEl = document.getElementById('speed')!;
const msgEl = document.getElementById('msg')!;
const hpEl = document.getElementById('hp')!, arEl = document.getElementById('ar')!;
let sayTimer: number | undefined;
function say(text: string) { msgEl.textContent = text; msgEl.style.opacity = '1'; clearTimeout(sayTimer); sayTimer = window.setTimeout(() => (msgEl.style.opacity = '0'), 1100); }

const targets: Target[] = [];            // bots / dummies register here
const flashEl = document.createElement('div'); flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#ff2a1a;opacity:0;z-index:3'; document.body.appendChild(flashEl);
const combat = new Combat(scene, {
  targets: () => targets,
  explode(pos, radius, dmg, knock, fromPlayer) {
    // splash on the local player (rocket jumps!)
    const c = new THREE.Vector3(player.x, player.y + 0.9, player.z); const d = c.distanceTo(pos);
    if (d >= radius) return;
    const f = 1 - d / radius; const dir = c.sub(pos).normalize(); dir.y += 0.3; dir.normalize();
    player.knock(dir.x * knock * f, dir.y * knock * f * 1.15, dir.z * knock * f);
    const self = fromPlayer ? 0.4 : 1;
    if (player.takeDamage(dmg * f * self)) die('EXPLODED');
  },
});
const pickupSys = new Pickups(scene);
function die(why: string) {
  say(why === 'EXPLODED' ? 'YOU BLEW UP' : why === 'FELL' ? 'YOU FELL' : 'YOU DIED'); player.respawn(); yaw = player.yaw; pitch = 0;
  loadout.reset(); vm.show('pistol'); lastBar = '';
}
player.onVoid = () => die('FELL');

// ---- HUD ----
let shownPadTime = 0;
function hud() {
  speedEl.firstChild!.textContent = String(Math.round(player.speedXZ * 32));
  speedEl.style.color = player.speedXZ > 15 ? '#ff9a3c' : player.speedXZ > 11 ? '#ffe14a' : '#7ffff0';
  hpEl.firstChild!.textContent = String(Math.max(0, Math.ceil(player.health))); hpEl.style.color = player.health > 50 ? '#ffd24a' : player.health > 25 ? '#ff9a3c' : '#ff4040';
  arEl.firstChild!.textContent = String(Math.ceil(player.armor));
  flashEl.style.opacity = String(Math.max(0, player.hurtT) * 1.6);
  if (player.lastPadTime !== shownPadTime) { shownPadTime = player.lastPadTime; say(player.lastPad); }
  refreshBar();
}

const _dir = new THREE.Vector3(), _eye = new THREE.Vector3();
function tryFire(dt: number) {
  loadout.cooldown -= dt;
  const id = vm.current; const st = WEAPON_DEFS[id].stats;
  if (!(mouseDown && locked()) || loadout.cooldown > 0 || vm.switching) return;
  if (!loadout.canFire(id)) { loadout.cooldown = 0.3; if (id !== 'blade' && id !== 'pistol') vm.select(loadout.best()); return; }
  loadout.cooldown = st.interval; loadout.consume(id);
  doFire(id);
}
function doFire(id: Parameters<typeof combat.fire>[0]) {
  _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  _eye.set(player.x, player.y + player.eye, player.z);
  camera.updateMatrixWorld(true);
  const muzzle = camera.localToWorld(vm.muzzleCamSpace());
  combat.fire(id, _eye, _dir, muzzle);
  vm.fire(id);
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
  const sh = combat.shake;
  camera.position.set(player.x + (Math.random() - .5) * sh * 0.06, player.y + player.eye + (Math.random() - .5) * sh * 0.06, player.z);
  camera.rotation.set(pitch + (Math.random() - .5) * sh * 0.02, yaw, 0);
  player.hurtT = Math.max(0, player.hurtT - frameMs / 1000);
  tryFire(Math.min(0.05, frameMs / 1000));
  for (const got of pickupSys.update(now / 1000, player, d => d.kind === 'weapon' ? loadout.wouldAccept(d.id) : d.kind === 'health' ? player.health < 100 : player.armor < 100)) {
    if (got.kind === 'weapon') { const r = loadout.give(got.id); say(r === 'new' ? `${WEAPON_DEFS[got.id].name} ACQUIRED` : `+${WEAPON_DEFS[got.id].stats.ammoPickup} ${WEAPON_DEFS[got.id].name} AMMO`); if (r === 'new') vm.select(got.id); }
    else if (got.kind === 'health') { player.health = Math.min(100, player.health + got.amount); say(`+${got.amount} HEALTH`); }
    else { player.armor = Math.min(100, player.armor + got.amount); say(`+${got.amount} ARMOR`); }
  }
  if (!(window as any).__freeze) combat.update(Math.min(0.05, frameMs / 1000));
  stars.update(camera, renderer.getPixelRatio());
  if (!Q.liveSky) { const a = now / 1000 * 0.004; scene.backgroundRotation.y = a; stars.mesh.rotation.y = a; }
  if (Q.liveSky) sky.update(now / 1000, camera);
  world.update(now / 1000);
  hud();
  if (composer) composer.render(); else renderer.render(scene, camera);
  vm.update(Math.min(0.05, frameMs / 1000), { speed: player.speedXZ, grounded: player.grounded, lookDX, lookDY, spinning: mouseDown && locked() && vm.current === 'nailer', beam: mouseDown && locked() && vm.current === 'arc' }); lookDX = lookDY = 0;
  { const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(vm.scene, vm.camera); renderer.autoClear = ac; }
  adapt(frameMs);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// dev/test hook
(window as any).__game = { doFire, player, camera, vm, loadout, combat, pickupSys, targets, say, die, renderer, world, Q, get scale() { return renderScale; }, setLook: (y: number, p: number) => { yaw = y; pitch = p; }, PM };
