import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky, Stars, SKY_PRESETS } from './sky';
import { World } from './world';
import { kitOptions } from './kit';
import { getQuality } from './quality';
import { Player, PM, Input } from './player';
import { boxes } from './level';
import { Viewmodel } from './viewmodel';
import { Loadout } from './loadout';
import { Combat, Target, rayWorld } from './combat';
import { Pickups } from './pickups';
import { Bot, spawnBots } from './bot';
import { buildSurround } from './surround';
import { Net, RemotePlayer, PlayerInfo } from './net';
import { WEAPON_ORDER, WEAPON_DEFS } from './weapons';
import { TouchControls, isTouch as touchDevice, goFullscreen } from './touch';
import { setupAssets } from './assets';

const Q = getQuality();
const MAP = new URLSearchParams(location.search).get('map') === 'void' ? 'void' : 'boreal';
const SKYP = SKY_PRESETS[MAP];
kitOptions.cheap = !Q.pbr;
{ const bar = document.getElementById('loadbar'), txt = document.getElementById('loadtxt');
  setupAssets({ cheap: !Q.pbr, lowTex: Q.tier === 'low', onProgress(done, total) {
    const f = total ? done / total : 1;
    if (bar) bar.style.width = `${Math.round(f * 100)}%`;
    if (txt) txt.textContent = f >= 1 ? 'READY' : `LOADING ${Math.round(f * 100)}%`;
    if (f >= 1) setTimeout(() => document.getElementById('loading')?.classList.add('done'), 400);
  } }); }

const renderer = new THREE.WebGLRenderer({ antialias: Q.antialias, powerPreference: 'high-performance', stencil: false });
let renderScale = Q.renderScale;
const applyRes = () => { renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio) * renderScale); renderer.setSize(innerWidth, innerHeight); };
applyRes();
renderer.localClippingEnabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(100, innerWidth / innerHeight, 0.05, 1200);
camera.rotation.order = 'YXZ';

// sky: live shader on high, baked once to a cubemap on low/med (no per-frame noise cost)
const sky = new Sky(MAP);
// default sky: pure black + crisp stars (cheap, sharp on any screen). ?sky=nebula brings back the painted space sky.
const PLAIN_SKY = new URLSearchParams(location.search).get('sky') !== 'nebula';
if (PLAIN_SKY) {
  scene.background = new THREE.Color(0x000000);
  if (Q.pbr) {                                               // PBR tiers still want something to reflect
    const pm = new THREE.PMREMGenerator(renderer); const sk = new THREE.Scene(); sk.add(new Sky(MAP).mesh);
    scene.environment = pm.fromScene(sk, 0, 0.1, 1000).texture; scene.environmentIntensity = 1.6;
  }
} else if (Q.liveSky) scene.add(sky.mesh);
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
if (Q.liveSky && !PLAIN_SKY) {                               // high: reflections from the live sky shader
  const pm = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene(); skyScene.add(new Sky(MAP).mesh);
  scene.environment = pm.fromScene(skyScene, 0, 0.1, 1000).texture; scene.environmentIntensity = 1.6;
}

const stars = PLAIN_SKY ? new Stars(sky.bandN, 2600, true) : new Stars(sky.bandN, SKYP.stars);
scene.add(stars.mesh);
scene.fog = new THREE.FogExp2(0x05070f, 0.0025);   // depth cue: far platforms sink into the void

const surround = buildSurround(); if (MAP === 'boreal' && !PLAIN_SKY) scene.add(surround.group);
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
let frames = 0, accMs = 0, goodSecs = 0;
function adapt(ms: number) {
  accMs += ms; frames++;
  if (accMs < 1000) return;
  const avg = accMs / frames; frames = 0; accMs = 0;
  const med = document.getElementById('medal'); if (med) med.textContent = `FFA · PRACTICE   |   ${Math.round(1000 / avg)} FPS · ${Q.tier.toUpperCase()} · RES ${Math.round(renderScale * 100)}%`;
  if (avg > 18.5 && renderScale > Q.minScale) { renderScale = Math.max(Q.minScale, renderScale - 0.08); applyRes(); goodSecs = 0; }
  else if (avg < (TOUCH ? 17.4 : 12.5) && renderScale < Q.renderScale) {
    // phones are capped at 60 fps, so "fast" means holding the cap; climb back slowly after 3 steady seconds
    if (!TOUCH || ++goodSecs >= 3) { renderScale = Math.min(Q.renderScale, renderScale + 0.04); applyRes(); goodSecs = 0; }
  } else goodSecs = 0;
}

// ---- input ----
const keys = new Set<string>();
let jumpQueued = false;
let yaw = 0, pitch = 0;
const startEl = document.getElementById('start')!;
const TOUCH = touchDevice || new URLSearchParams(location.search).has('touch');
let touchPlaying = false;
const locked = () => touchPlaying || document.pointerLockElement === renderer.domElement;
let lockedAt = 0, lockExitAt = 0;
function resume() {
  if (TOUCH) { goFullscreen(); touchPlaying = true; startEl.style.display = 'none'; touch?.show(true); return; }
  const wait = Math.max(0, 1300 - (performance.now() - lockExitAt));      // Chrome refuses a re-lock for ~1 s after Esc
  const go = () => { try { const r: any = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => setTimeout(go, 400)); } catch { /* wait for a click */ } };
  if (wait > 0) setTimeout(go, wait); else go();
}
startEl.addEventListener('click', resume);
document.addEventListener('pointerlockchange', () => { if (locked()) lockedAt = performance.now(); else lockExitAt = performance.now(); startEl.style.display = locked() ? 'none' : 'flex'; });
addEventListener('mousemove', e => {
  if (!locked()) return;
  yaw -= e.movementX * 0.0022; pitch -= e.movementY * 0.0022; lookDX += e.movementX; lookDY += e.movementY;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});
addEventListener('keydown', e => {
  if (!locked() && (e.code === 'Escape' || e.code === 'Enter') && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) { resume(); return; }
  if (e.repeat) return;           // holding space never auto-hops
  keys.add(e.code);
  if (e.code === 'Space') jumpQueued = true;
  if (e.code === 'KeyR') { die('DIED'); }
});
addEventListener('keyup', e => keys.delete(e.code));
let touch: TouchControls | null = null;
if (TOUCH) {
  document.body.classList.add('touch');
  touch = new TouchControls({
    look(dx, dy) {
      if (!touchPlaying) return;
      const k = 0.0058 * touchSens; yaw -= dx * k; pitch -= dy * k; lookDX += dx * 0.6; lookDY += dy * 0.6;
      pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    },
    jump() { jumpQueued = true; },
    nextWeapon() { vm.select(loadout.step(vm.target, 1)); },
    pause() { touchPlaying = false; touch!.show(false); startEl.style.display = 'flex'; },
  });
  touch.show(false);
  document.addEventListener('visibilitychange', () => { if (document.hidden && touchPlaying) { touchPlaying = false; touch!.show(false); startEl.style.display = 'flex'; } });
}
let touchSens = 1;
try { touchSens = Number(localStorage.getItem('mq-sens')) || 1; } catch { /* ignore */ }
{ const si = document.getElementById('psens') as HTMLInputElement | null;
  if (si) { si.value = String(touchSens); for (const ev of ['click', 'touchstart', 'touchend'] as const) si.addEventListener(ev, e => e.stopPropagation());
    si.addEventListener('input', () => { touchSens = Number(si.value) || 1; try { localStorage.setItem('mq-sens', String(touchSens)); } catch { /* ignore */ } }); } }

// ---- weapons / loadout / combat / pickups ----
const vm = new Viewmodel();
const loadout = new Loadout();
const wbar = document.getElementById('wbar')!;
WEAPON_ORDER.forEach((id, i) => {
  const d = document.createElement('div'); d.className = 'wslot'; d.id = 'w-' + id; d.style.setProperty('--c', '#' + WEAPON_DEFS[id].color.toString(16).padStart(6, '0'));
  d.innerHTML = `<b>${i + 1}</b>${WEAPON_DEFS[id].name}<i></i>`; wbar.appendChild(d);
  d.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); if (loadout.has(id)) vm.select(id); }, { passive: false });
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
const firing = () => mouseDown || !!touch?.fire;
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
const playerBody = { pos: new THREE.Vector3(), radius: 0.42, height: 1.75 };
let frags = 0; const fragsEl = document.getElementById('frags')!;
const combat = new Combat(scene, {
  targets: () => targets,
  playerBody: () => { playerBody.pos.set(player.x, player.y, player.z); playerBody.height = player.height; return playerBody; },
  hurt(dmg, dir) { player.knock(dir.x * 1.5, 0.3, dir.z * 1.5); if (player.takeDamage(dmg)) die('DIED'); },
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
const hitEl = document.getElementById('hit')!; let hitT = 0;
const crossEl = document.getElementById('cross')!; let crossKick = 0, crossGap = 6;
const bots: Bot[] = [];
const botVel = new THREE.Vector3(), botPrev = new THREE.Vector3(); let botPrevSet = false;
const qs = new URLSearchParams(location.search); const roomCode = (qs.get('room') || '').trim(); const myName = (qs.get('name') || 'PLAYER').slice(0, 14);
if (!roomCode) spawnBots(scene, {
  player: { pos: new THREE.Vector3(), eye: new THREE.Vector3(), vel: botVel },
  fire: (id, o, d, dmg, sp) => combat.fireEnemy(id, o, d, dmg, sp),
  onKilled: b => { frags++; fragsEl.textContent = `FRAGS ${frags}`; say(`YOU FRAGGED ${b.name}`); },
  onHit: () => { hitT = 0.18; },
}).then(list => { for (const b of list) { bots.push(b); targets.push(b); (b as any).ctx.player = botCtxPlayer; } });
const botCtxPlayer = { pos: new THREE.Vector3(), eye: new THREE.Vector3(), vel: botVel };

// ---- online ----
const remotes = new Map<number, RemotePlayer>();
const netEl = document.getElementById('net')!;
let lastAttacker = 0; let scoreboard: PlayerInfo[] = []; let netState = 'offline';
const dirV = (a: number[]) => new THREE.Vector3(a?.[0] ?? 0, a?.[1] ?? 0, a?.[2] ?? 0);
function addRemote(p: PlayerInfo) {
  if (p.id === net.id || remotes.has(p.id)) return;
  const r = new RemotePlayer(p, scene, (to, dmg, dir, kind) => { net.send({ t: 'hit', to, dmg, dir: [dir.x, dir.y, dir.z], kind }); hitT = 0.18; });
  remotes.set(p.id, r); targets.push(r);
}
function drawNet() {
  if (!roomCode) { netEl.textContent = ''; return; }
  const rows = [...scoreboard].sort((a, b) => b.frags - a.frags).map(p => `<div class="${p.id === net.id ? 'me' : ''}">${p.name} <b>${p.frags}</b> / ${p.deaths}</div>`).join('');
  netEl.innerHTML = `ROOM <b>${roomCode.toUpperCase()}</b> · ${netState.toUpperCase()}${rows}`;
}
const net = new Net({
  status(st) { netState = st; (document.getElementById('netstat')!).textContent = st === 'offline' ? 'Could not reach the server - playing offline' : st === 'full' ? 'Room is full (8 max)' : ''; drawNet(); },
  welcome(_id, _room, players, map) { if (map && map !== MAP) { const u = new URLSearchParams(location.search); u.set('map', map); location.search = u.toString(); return; } scoreboard = players; for (const p of players) addRemote(p); say('CONNECTED'); drawNet(); },
  join(p) { scoreboard.push(p); addRemote(p); say(`${p.name} JOINED`); drawNet(); },
  leave(id) { const r = remotes.get(id); if (r) { say(`${r.info.name} LEFT`); r.dispose(); targets.splice(targets.indexOf(r), 1); remotes.delete(id); } scoreboard = scoreboard.filter(p => p.id !== id); drawNet(); },
  state(id, m) { remotes.get(id)?.setState(m.p, m.yaw, m.w, m.hp, !!m.dead); },
  fire(id, m) { const r = remotes.get(id); r?.flashFire(); combat.remoteShot(m.w, dirV(m.o), dirV(m.d)); lastAttacker = id; },
  hit(from, dmg, dir, _kind) { lastAttacker = from; const d = dirV(dir); player.knock(d.x * 1.5, 0.3, d.z * 1.5); if (player.takeDamage(dmg)) die('DIED'); },
  killed(id, by, board) {
    scoreboard = board; drawNet();
    const v = board.find(p => p.id === id), k = board.find(p => p.id === by);
    if (v && id !== net.id) say(k && by === net.id ? `YOU FRAGGED ${v.name}` : k ? `${k.name} FRAGGED ${v.name}` : `${v.name} DIED`);
  },
});
function wireOnlineUI() {
  const nameI = document.getElementById('pname') as HTMLInputElement, roomI = document.getElementById('proom') as HTMLInputElement, go = document.getElementById('pgo')!;
  const saved = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  nameI.value = myName !== 'PLAYER' ? myName : saved('mq-name'); roomI.value = roomCode || saved('mq-room');
  for (const e of [nameI, roomI, go]) e.addEventListener('click', ev => ev.stopPropagation());
  for (const e of [nameI, roomI]) e.addEventListener('keydown', ev => { ev.stopPropagation(); if ((ev as KeyboardEvent).key === 'Enter') go.click(); });
  const mapI = document.getElementById('pmap') as HTMLSelectElement; mapI.value = MAP; mapI.addEventListener('click', ev => ev.stopPropagation());
  mapI.addEventListener('change', () => { const u = new URLSearchParams(location.search); u.set('map', mapI.value); location.search = u.toString(); });
  go.addEventListener('click', () => {
    const n = (nameI.value || 'PLAYER').trim(), r = (roomI.value || 'LOBBY').trim();
    try { localStorage.setItem('mq-name', n); localStorage.setItem('mq-room', r); } catch { /* ignore */ }
    location.search = `?room=${encodeURIComponent(r)}&name=${encodeURIComponent(n)}&map=${mapI.value}`;
  });
}
wireOnlineUI();
if (roomCode) net.connect(roomCode, myName, MAP);
function die(why: string) {
  if (net.online) net.send({ t: 'dead', by: lastAttacker });
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
  if (!(firing() && locked()) || loadout.cooldown > 0 || vm.switching) return;
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
  if (net.online) { const w = rayWorld(_eye, _dir, 200); const aim = _eye.clone().addScaledVector(_dir, w ? w.t : 200); const dd = aim.sub(muzzle).normalize(); net.send({ t: 'fire', w: id, o: [muzzle.x, muzzle.y, muzzle.z], d: [dd.x, dd.y, dd.z] }); }
  vm.fire(id); crossKick = 1;
}

// ---- loop (fixed 120 Hz sim) ----
const DT = 1 / 120;
let acc = 0, last = performance.now();
function frame(now: number) {
  // phones: cap at ~60 fps. 90/120 Hz screens otherwise double the GPU work, the phone heats up and throttles into stutter.
  if (TOUCH && now - last < 15.5) { requestAnimationFrame(frame); return; }
  const frameMs = now - last;
  acc += Math.min(0.1, frameMs / 1000); last = now;
  while (acc >= DT) {
    const input: Input = {
      forward: Math.max(-1, Math.min(1, (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + (touch?.forward ?? 0))),
      side: Math.max(-1, Math.min(1, (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + (touch?.side ?? 0))),
      jumpPressed: jumpQueued, crouch: keys.has('KeyC') || keys.has('ControlLeft') || !!touch?.crouch, yaw,
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
  { botCtxPlayer.pos.set(player.x, player.y, player.z); botCtxPlayer.eye.set(player.x, player.y + player.eye, player.z);
    if (botPrevSet) botVel.set(player.x - botPrev.x, 0, player.z - botPrev.z).multiplyScalar(1 / Math.max(0.008, frameMs / 1000)); botPrev.set(player.x, player.y, player.z); botPrevSet = true;
    const bdt = Math.min(0.05, frameMs / 1000);
    if (!(window as any).__freezeBots) for (const b of bots) b.update(bdt);
    for (const r of remotes.values()) r.update(bdt);
    hitT = Math.max(0, hitT - bdt); hitEl.style.opacity = String(Math.min(1, hitT * 8));
    // dynamic crosshair: opens up with speed, air time and each shot, then settles back
    crossKick = Math.max(0, crossKick - bdt * 5);
    const gap = 6 + Math.min(6, player.speedXZ * 0.35) + (player.grounded ? 0 : 3) + crossKick * 7;
    if (Math.abs(gap - crossGap) > 0.25) { crossGap += (gap - crossGap) * Math.min(1, bdt * 18); crossEl.style.setProperty('--g', `${crossGap.toFixed(1)}px`); }
    crossEl.classList.toggle('dry', !loadout.canFire(vm.current));
    net.sendState(bdt, { p: [player.x, player.y, player.z], yaw, pitch, w: vm.current, hp: player.health, dead: false }); }
  if (!(window as any).__freeze) combat.update(Math.min(0.05, frameMs / 1000));
  stars.update(camera, renderer.getPixelRatio());
  if (!Q.liveSky || PLAIN_SKY) { const a = now / 1000 * 0.004; scene.backgroundRotation.y = a; stars.mesh.rotation.y = a; }
  if (Q.liveSky && !PLAIN_SKY) sky.update(now / 1000, camera);
  world.update(now / 1000); surround.update(now / 1000);
  hud();
  if (composer) composer.render(); else renderer.render(scene, camera);
  vm.update(Math.min(0.05, frameMs / 1000), { speed: player.speedXZ, grounded: player.grounded, lookDX, lookDY, spinning: firing() && locked() && vm.current === 'nailer', beam: firing() && locked() && vm.current === 'arc' }); lookDX = lookDY = 0;
  { const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(vm.scene, vm.camera); renderer.autoClear = ac; }
  adapt(frameMs);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// dev/test hook
(window as any).__game = { bots, net, remotes, doFire, player, camera, vm, loadout, combat, pickupSys, targets, say, die, renderer, world, Q, get scale() { return renderScale; }, setLook: (y: number, p: number) => { yaw = y; pitch = p; }, PM };
