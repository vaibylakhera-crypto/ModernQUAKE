import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky, Stars, SKY_PRESETS } from './sky';
import { World } from './world';
import { Arena } from './arena';
import { updateFireLights, setFireQuality } from './torches';
import { buildEmbers } from './props';
import { Radar } from './radar';
import { GamepadInput } from './gamepad';
import { PISTOL_MAG, PISTOL_RELOAD } from './loadout';
import { botAdapt } from './bot';
import { kitOptions } from './kit';
import { getQuality } from './quality';
import { Player, PM, Input } from './player';
import { blackout as levelBlackout, hill as levelHill, flags as levelFlags, torches as levelTorches, boxes, MAP_ID, BoosterId, THEME, pads as levelPads, teleporters as levelTeleporters, pickups as levelPickups, spawns as levelSpawns } from './level';
import { BOOSTERS } from './pickups';
import { Viewmodel } from './viewmodel';
import { Loadout } from './loadout';
import { Combat, Target, rayWorld } from './combat';
import { Pickups } from './pickups';
import { Bot, BotDef, BotTarget, BotCtx, BOT_ROSTER, spawnBot, disposeBot } from './bot';
import { buildSurround } from './surround';
import { Net, RemotePlayer, PlayerInfo, MatchCfg, RoomInfo } from './net';
import { Menu, LobbyView, OpenGame } from './menu';
import { WEAPON_ORDER, WEAPON_DEFS } from './weapons';
import { TouchControls, isTouch as touchDevice, goFullscreen } from './touch';
import { setupAssets } from './assets';
import * as sfx from './sfx';
import { Music } from './music';
import { Announcer } from './announcer';
import { Gyro } from './gyro';
import { LiftSystem } from './lifts';
import * as navMod from './nav';
import { TEAMS, MODES, isTeamMode, LIVES, KOTH_PER_STEP } from './teams';
import { buildHill } from './hill';
import { rules as loadoutRules } from './loadout';
import { Ctf } from './ctf';
import { Voice, QUICK, quickText, VoiceMode } from './comms';
import { lifts as __lifts, flags as flagBases } from './level';
import { WeaponId } from './weapons';

const Q = getQuality();
const MAP = MAP_ID;
const SKYP = SKY_PRESETS[MAP === 'void' ? 'void' : 'boreal'];
// default look: dark alien fortress (original procedural textures). ?style=kit = the older bright sci-fi kit
const STYLE = new URLSearchParams(location.search).get('style') === 'kit' ? 'kit' : 'alien';
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
const sky = new Sky(MAP === 'void' ? 'void' : 'boreal');
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
scene.fog = STYLE === 'kit' ? new THREE.FogExp2(0x05070f, 0.0025) : new THREE.FogExp2(THEME.fog, THEME.fogD);   // depth cue: far platforms sink into the void

const surround = buildSurround(); if (MAP === 'boreal' && !PLAIN_SKY) scene.add(surround.group);
const world = STYLE === 'kit' ? new World(Q) : new Arena(Q);
scene.add(world.group);
world.build();
const sceneLights: { l: THREE.Light; base: number }[] = [];

// lighting: aurora-tinted fill + planet key light (cheap: 1 hemisphere + 2 directional, no shadows)
if (STYLE === 'kit') {
  scene.add(new THREE.HemisphereLight(0x8fdcff, 0x3a2a78, Q.pbr ? 1.4 : 2.6));
  scene.add(new THREE.AmbientLight(0x6070a0, Q.pbr ? 0.2 : 0.7));
} else {
  // alien fortress: dim, warm from above, near-black from below, faint sickly-green bounce
  scene.add(new THREE.HemisphereLight(THEME.hemiSky, THEME.hemiGround, Q.pbr ? 1.2 : 2.0));
  scene.add(new THREE.AmbientLight(THEME.ambient, Q.pbr ? 0.25 : 0.6));
}
const key = new THREE.DirectionalLight(STYLE === 'kit' ? 0xffe2c0 : THEME.key, Q.pbr ? 3.2 : 2.4);
key.position.copy(sky.sunDir).multiplyScalar(100); scene.add(key);
const rim = new THREE.DirectionalLight(STYLE === 'kit' ? 0x7a8cff : THEME.rim, Q.pbr ? 1.6 : 1.0); rim.position.set(-40, 20, 60); scene.add(rim);

for (const o of scene.children) if ((o as any).isLight) sceneLights.push({ l: o as THREE.Light, base: (o as THREE.Light).intensity });

let composer: EffectComposer | null = null;
// ---- safety nets for phone GPUs ----
// glow (bloom) needs float render targets; some phones lack them and would show a black screen
const canBloom = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
if (Q.bloom && !canBloom) Q.bloom = false;
// a shader that fails to compile on this phone: drop to the FAST look once (reloads), and show what happened
const gfxErrors: string[] = [];
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const log = (gl.getProgramInfoLog(program) || '') + (gl.getShaderInfoLog(vs) || '') + (gl.getShaderInfoLog(fs) || '');
  gfxErrors.push(log.slice(0, 300)); console.error('shader error', log);
  let tried = false; try { tried = sessionStorage.getItem('mq-gfx-fallback') === '1'; } catch { /* ignore */ }
  if (Q.tier !== 'low' && !tried) { try { sessionStorage.setItem('mq-gfx-fallback', '1'); localStorage.setItem('mq-quality', 'low'); } catch { /* ignore */ } location.reload(); }
};
// ?debug: small panel with the GPU, WebGL version and any graphics errors (to diagnose a phone remotely)
if (new URLSearchParams(location.search).has('debug')) {
  const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:9;max-width:60vw;font:11px monospace;color:#ffd9a8;background:#000c;padding:6px;white-space:pre-wrap;pointer-events:none';
  document.body.appendChild(d);
  const gl = renderer.getContext(); const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  setInterval(() => { d.textContent = `BUILD ${__BUILD__} · ${Q.tier.toUpperCase()} · WebGL${renderer.capabilities.isWebGL2 ? 2 : 1}\nGPU ${gpu}\ncalls ${renderer.info.render.calls} tris ${renderer.info.render.triangles} progs ${renderer.info.programs?.length}\n${gfxErrors.length ? 'ERRORS:\n' + gfxErrors.join('\n') : 'no graphics errors'}`; }, 1000);
}
// offline play: a service worker keeps the game files after the first visit (not in dev, only over https or localhost)
if ('serviceWorker' in navigator && location.port !== '5173' && !new URLSearchParams(location.search).has('nosw')) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* optional */ }); });
}
// stale copy guard: if the server has a newer build than the code running here, reload once
fetch('/version.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => {
  if (!v || !v.v || v.v === __BUILD__) return;
  let done = false; try { done = sessionStorage.getItem('mq-reloaded-for') === v.v; sessionStorage.setItem('mq-reloaded-for', v.v); } catch { /* ignore */ }
  if (!done) location.reload();
}).catch(() => { /* offline / dev server */ });

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
let frames = 0, accMs = 0, goodSecs = 0, lowSecs = 0, fxLevel = 0, lastFps = 0, worstMs = 0, lastWorst = 0;
// diagnostics overlay: add ?perf=1 to the address, or tap the top centre of the screen three times quickly
const perfEl = document.getElementById('perf')!;
if (new URLSearchParams(location.search).has('perf')) document.body.classList.add('perf');
{ let taps: number[] = []; addEventListener('touchstart', e => { const t = e.touches[0]; if (!t || t.clientY > 70 || Math.abs(t.clientX - innerWidth / 2) > innerWidth * 0.2) return; const n = performance.now(); taps = taps.filter(x => n - x < 900); taps.push(n); if (taps.length >= 3) { taps = []; document.body.classList.toggle('perf'); } }, { passive: true }); }
function adapt(ms: number) {
  accMs += ms; frames++; if (ms > worstMs) worstMs = ms;
  if (accMs < 1000) return;
  const avg = accMs / frames; frames = 0; accMs = 0;
  const med = document.getElementById('medal'); if (med) med.textContent = `${Math.round(1000 / avg)} FPS · ${Q.tier.toUpperCase()} · RES ${Math.round(renderScale * 100)}%`;
  lastFps = Math.round(1000 / avg); const worst = Math.round(worstMs); worstMs = 0; lastWorst = worst;
  // already at the lowest resolution and still slow: switch effects off, one step at a time
  if (avg > 24 && renderScale <= Q.minScale + 0.001) { if (++lowSecs >= 3 && fxLevel < 2) { fxLevel++; setFireQuality(fxLevel, TOUCH); lowSecs = 0; } } else lowSecs = 0;
  if (document.body.classList.contains('perf')) { const a = sfx.stats(), ri = renderer.info.render; perfEl.textContent = `${lastFps} FPS (worst frame ${lastWorst} ms)  ·  ${Q.tier.toUpperCase()}  ·  res ${Math.round(renderScale * 100)}%\neffects level ${fxLevel}  ·  draws ${ri.calls}  ·  tris ${Math.round(ri.triangles / 1000)}k\naudio ${a.state}  ·  voices ${a.live}  ·  music ${music.playing ? 'on' : 'off'}\nping ${net.online ? Math.round((net as any).ping ?? 0) + ' ms' : 'solo'}`; }
  if (avg > 18.5 && renderScale > Q.minScale) { renderScale = Math.max(Q.minScale, renderScale - 0.08); applyRes(); goodSecs = 0; }
  else if (avg < (TOUCH ? 17.4 : 12.5) && renderScale < (saverOn ? Math.min(Q.renderScale, 0.6) : Q.renderScale)) {
    // phones are capped at 60 fps, so "fast" means holding the cap; climb back slowly after 3 steady seconds
    if (!TOUCH || ++goodSecs >= 3) { renderScale = Math.min(saverOn ? Math.min(Q.renderScale, 0.6) : Q.renderScale, renderScale + 0.04); applyRes(); goodSecs = 0; }
  } else goodSecs = 0;
}

// ---- input ----
const keys = new Set<string>();
let jumpQueued = false;
let yaw = 0, pitch = 0;
const startEl = document.getElementById('start')!;
const TOUCH = touchDevice || new URLSearchParams(location.search).has('touch');
setFireQuality(0, TOUCH);
const radar = new Radar(document.body); let radarT = 0;
const embers = buildEmbers(TOUCH ? 70 : 140); scene.add(embers.points);
if (new URLSearchParams(location.search).has('fps')) document.body.classList.add('fps');
let touchPlaying = false;
// ---- phone aim assist: friction over an enemy + a gentle pull while firing ----
let assistFriction = 1;
const _ad = new THREE.Vector3(), _ae = new THREE.Vector3();
function aimAssist(dt: number) {
  assistFriction = 1;
  const lvl = menu.settings.assist; if (!TOUCH || !lvl || deadT > 0 || matchState === 'ended') return;
  _ae.set(player.x, player.y + player.eye, player.z);
  const cone = lvl === 2 ? 0.1 : 0.07, mt = myTeam();
  let best: Target | null = null, bestErr = cone, ey = 0, ep = 0;
  for (const tg of targets) {
    if (!tg.alive || (mt && ((tg as any).team ?? 0) === mt)) continue;
    const cx = tg.pos.x - _ae.x, cy = tg.pos.y + tg.height * 0.6 - _ae.y, cz = tg.pos.z - _ae.z, d = Math.hypot(cx, cy, cz);
    if (d < 1.5 || d > 45) continue;
    const wy = Math.atan2(-cx, -cz), wp = Math.asin(cy / d);
    const dyaw = Math.atan2(Math.sin(wy - yaw), Math.cos(wy - yaw)), dp = wp - pitch, err = Math.hypot(dyaw * Math.cos(pitch), dp);
    if (err >= bestErr) continue;
    _ad.set(cx / d, cy / d, cz / d); if (rayWorld(_ae, _ad, d - 0.6)) continue;          // a wall is in the way
    best = tg; bestErr = err; ey = dyaw; ep = dp;
  }
  if (!best) return;
  assistFriction = lvl === 2 ? 0.45 : 0.62;                       // thumb drags move the crosshair less while it is on a target
  if (firing()) { const pull = Math.min(1, dt * (lvl === 2 ? 7 : 3.5)); yaw += ey * pull; pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch + ep * pull)); }
}
// ---- mini-map data ----
let radarShown = false;
function radarFrame() {
  const mt = myTeam(), items: any[] = [], friends: any[] = [], enemies: any[] = [], flagDots: any[] = [];
  for (const it of pickupSys.items) if (it.active && it.def.kind === 'booster') items.push({ x: it.def.pos[0], y: it.def.pos[1], z: it.def.pos[2], color: '#' + it.color.toString(16).padStart(6, '0'), r: 3.8 });
  const add = (pos: THREE.Vector3, team: number, alive: boolean) => { if (!alive) return; const d = { x: pos.x, y: pos.y, z: pos.z, color: '' }; if (mt && team === mt) { d.color = '#5dff8a'; friends.push(d); } else { d.color = '#ff4a3a'; enemies.push(d); } };
  for (const b of bots) add(b.pos, b.team, b.alive);
  for (const r of remotes.values()) add(r.pos, r.team, r.alive);
  if (cfg.mode === 'ctf' && levelFlags) for (const [k, team] of [['red', 1], ['blue', 2]] as const) { const f = levelFlags[k]; flagDots.push({ x: f[0], y: f[1], z: f[2], color: team === 1 ? '#ff5a48' : '#4f8dff' }); }
  return { x: player.x, y: player.y, z: player.z, yaw, items, friends, enemies, flags: flagDots };
}
// ---- battery saver: fewer pixels, no real firelight or sparks ----
let saverOn = false;
function applySaver(on: boolean) {
  if (on === saverOn) return; saverOn = on;
  setFireQuality(on ? 2 : fxLevel, TOUCH); embers.points.visible = !on;
  renderScale = on ? Math.max(Q.minScale, Math.min(renderScale, 0.6)) : Q.renderScale; applyRes();
}
const gpad = new GamepadInput(); let padPlaying = false, padFire = false, padScores = false;
const locked = () => touchPlaying || document.pointerLockElement === renderer.domElement || (padPlaying && !menu.open && mode !== 'title');
let lockedAt = 0, lockExitAt = 0;
function resume() {
  sfx.unlock(); music.start();     // audio may only start from a user gesture (iOS)
  if (mode === 'title') return;
  menu.hide(); menu.showScores(false);
  if (TOUCH) { goFullscreen(); touchPlaying = true; touch?.show(true); if (!guideSeen()) setTimeout(() => showGuide(), 250); return; }
  const wait = Math.max(0, 1300 - (performance.now() - lockExitAt));      // Chrome refuses a re-lock for ~1 s after Esc
  const go = () => { try { const r: any = renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => setTimeout(go, 400)); } catch { /* wait for a click */ } };
  if (wait > 0) setTimeout(go, wait); else go();
}
void startEl;
/** the menu screen to show when the game is paused */
const pauseScreen = () => mode === 'online' ? 'lobby' as const : mode === 'solo' ? 'pause' as const : 'title' as const;
function openPause() { mouseDown = false; if (!menu.open) { pushView(); menu.show(pauseScreen()); } }
document.addEventListener('pointerlockchange', () => { if (locked()) { lockedAt = performance.now(); menu.hide(); } else { lockExitAt = performance.now(); openPause(); } });
addEventListener('mousemove', e => {
  if (!locked()) return;
  const k = 0.0022 * aimSens; yaw -= e.movementX * k; pitch -= e.movementY * k; lookDX += e.movementX; lookDY += e.movementY;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});
addEventListener('keydown', e => {
  if (!locked() && (e.code === 'Escape' || e.code === 'Enter') && !(e.target instanceof HTMLInputElement) && (menu.screen === 'pause' || menu.screen === 'lobby')) { resume(); return; }
  if (mode === 'online' && locked()) {
    if (e.code === 'KeyY') { toggleQuick(); return; }
    if (e.code === 'KeyV' && !e.repeat) { void voice.press(true); return; }
    if (e.code === 'KeyM' && !e.repeat) { void voice.toggleOpen(); return; }
    if (qchatOpen && /^Digit[1-8]$/.test(e.code)) { sendQuick(QUICK[Number(e.code.slice(5)) - 1].k); return; }
  }
  if (locked() && e.code === 'KeyP' && !e.repeat) { music.toggle(); return; }
  if (locked() && e.code === 'KeyN' && !e.repeat) { music.next(); return; }
  if (e.code === 'Tab') { e.preventDefault(); if (locked()) { pushView(); menu.showScores(true); } return; }
  if (e.repeat) return;           // holding space never auto-hops
  keys.add(e.code);
  if (e.code === 'Space') jumpQueued = true;
  if (e.code === 'KeyR' && vm.current === 'pistol') loadout.startReload();
});
addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab') menu.showScores(false); if (e.code === 'KeyV') void voice.press(false); });
let touch: TouchControls | null = null;
if (TOUCH) {
  document.body.classList.add('touch');
  touch = new TouchControls({
    look(dx, dy) {
      if (!touchPlaying) return;
      const k = 0.0058 * aimSens * assistFriction; yaw -= dx * k; pitch -= dy * k; lookDX += dx * 0.6; lookDY += dy * 0.6;
      pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    },
    jump() { jumpQueued = true; },
    nextWeapon() { vm.select(loadout.step(vm.target, 1)); },
    pause() { touchPlaying = false; touch!.show(false); openPause(); },
    chat() { toggleQuick(); },
    reload() { if (vm.current === 'pistol') loadout.startReload(); },
    weapon(id) { if (loadout.has(id as WeaponId)) vm.select(id as WeaponId); },
    music() { toggleMusicPanel(); },
    playpause() { music.toggle(); },
    mic(on) { if (voice.mode === 'open') { if (on) void voice.toggleOpen(); } else void voice.press(on); },
  });
  touch.show(false);
  document.addEventListener('visibilitychange', () => { if (document.hidden && touchPlaying) { touchPlaying = false; touch!.show(false); openPause(); } });
}
const gyro = new Gyro();
const liftSys = new LiftSystem();
const riders = () => [player, ...bots.filter(b => b.alive).map(b => b.rider)];
let aimSens = 1;
try { aimSens = Number(localStorage.getItem('mq-sens')) || 1; } catch { /* ignore */ }

// ---- weapons / loadout / combat / pickups ----
const vm = new Viewmodel();
const loadout = new Loadout();
const wbar = document.getElementById('wbar')!;
WEAPON_ORDER.forEach((id, i) => {
  const d = document.createElement('div'); d.className = 'wslot'; d.id = 'w-' + id; d.style.setProperty('--c', '#' + WEAPON_DEFS[id].color.toString(16).padStart(6, '0'));
  d.innerHTML = `<b>${i + 1}</b>${WEAPON_DEFS[id].name}<i></i>`; wbar.appendChild(d);
  d.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); if (loadout.has(id)) vm.select(id); }, { passive: false });
  d.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && loadout.has(id)) { e.preventDefault(); vm.select(id); } });
});
let lastBar = '';
function refreshBar() {
  const key = WEAPON_ORDER.map(w => `${loadout.has(w) ? 1 : 0}${loadout.ammo[w]}${w === vm.target ? 'x' : ''}`).join('|') + `|${loadout.mag}${loadout.reloading ? 'r' : ''}`;
  if (key === lastBar) return; lastBar = key;
  for (const w of WEAPON_ORDER) {
    const el = document.getElementById('w-' + w)!; const own = loadout.has(w);
    el.classList.toggle('own', own); el.classList.toggle('on', w === vm.target); el.classList.toggle('dry', own && !loadout.canFire(w));
    el.querySelector('i')!.textContent = !own ? '' : w === 'pistol' ? (loadout.reloading ? '↻' : `${loadout.mag}`) : (loadout.ammo[w] === Infinity ? '∞' : String(loadout.ammo[w]));
  }
}
let mouseDown = false, lookDX = 0, lookDY = 0;
const firing = () => mouseDown || !!touch?.fire || padFire;
addEventListener('mousedown', e => { if (locked() && e.button === 0) mouseDown = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
addEventListener('wheel', e => { if (locked()) vm.select(loadout.step(vm.target, e.deltaY > 0 ? 1 : -1)); });
addEventListener('keydown', e => {
  const n = qchatOpen ? 0 : Number(e.code.replace('Digit', ''));
  if (n >= 1 && n <= WEAPON_ORDER.length && loadout.has(WEAPON_ORDER[n - 1])) vm.select(WEAPON_ORDER[n - 1]);
});

const player = new Player(boxes);
yaw = player.yaw;
const speedEl = document.getElementById('speed')!;
const msgEl = document.getElementById('msg')!;
const hpEl = document.getElementById('hp')!, arEl = document.getElementById('ar')!;
const hpFill = document.getElementById('hpfill')!, hpOver = document.getElementById('hpover')!, arFill = document.getElementById('arfill')!, arOver = document.getElementById('arover')!;
const vitalsEl = document.getElementById('vitals')!, pnameEl = document.getElementById('pname')!, dmgDirEl = document.getElementById('dmgdir')!;
let shownHp = -1, shownAr = -1, dmgDirT = 0;
/** red arc around the crosshair pointing toward whoever hurt us (ax, az: world direction to the attacker) */
function showDamageDir(ax: number, az: number) {
  combat.shake = Math.max(combat.shake, 0.55);                // a kick on the view when you are hit
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const rel = Math.atan2(ax * rx + az * rz, ax * fx + az * fz);
  dmgDirEl.style.transform = `rotate(${rel.toFixed(3)}rad)`; dmgDirT = 1;
}
let vibrate = true;
try { vibrate = localStorage.getItem('mq-vibe') !== '0'; } catch { /* ignore */ }
const buzz = (ms: number) => { if (vibrate && TOUCH) try { navigator.vibrate?.(ms); } catch { /* unsupported */ } if (padPlaying) gpad.rumble(ms * 3, 0.45); };
let sayTimer: number | undefined;
function say(text: string) { msgEl.textContent = text; msgEl.style.opacity = '1'; clearTimeout(sayTimer); sayTimer = window.setTimeout(() => (msgEl.style.opacity = '0'), 1100); }

const targets: Target[] = [];            // bots / dummies register here
const flashEl = document.createElement('div'); flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#ff2a1a;opacity:0;z-index:3'; document.body.appendChild(flashEl);
const playerBody = { pos: new THREE.Vector3(), radius: 0.42, height: 1.75 };
let frags = 0; const fragsEl = document.getElementById('frags')!;
const combat = new Combat(scene, {
  targets: () => targets,
  playerBody: () => { playerBody.pos.set(player.x, player.y, player.z); playerBody.height = player.height; return playerBody; },
  friendly: tg => { const t = myTeam(); return t > 0 && ((tg as any).team ?? 0) === t; },
  ownerFriendly: owner => friendlyOwner(owner),
  hurt(dmg, dir, weapon, owner) { if (friendlyOwner(owner) || player.health <= 0 || player.invuln > 0) return; blame(owner, weapon); showDamageDir(-dir.x, -dir.z); buzz(30); player.knock(dir.x * 1.5, 0.3, dir.z * 1.5); sfx.hurt(); if (player.takeDamage(dmg)) die('DIED'); },
  landed(tg, dmg, point, weapon, killed, head) { onLanded(tg, dmg, point, weapon, killed, !!head); },
  boom(pos, size) { sfx.boom(size, pos.distanceTo(camera.position), panOf(pos)); },
  explode(pos, radius, dmg, knock, fromPlayer, weapon, owner) {
    // splash on the local player (rocket jumps!); teammates' splash does not hurt
    if (!fromPlayer && friendlyOwner(owner)) return;
    if (player.health <= 0) return;
    const c = new THREE.Vector3(player.x, player.y + 0.9, player.z); const d = c.distanceTo(pos);
    if (d >= radius) return;
    const f = 1 - d / radius; const dir = c.sub(pos).normalize(); dir.y += 0.3; dir.normalize();
    player.knock(dir.x * knock * f, dir.y * knock * f * 1.15, dir.z * knock * f);
    const self = fromPlayer ? 0.4 : 1;
    blame(fromPlayer ? 'SELF' : owner, weapon); if (!fromPlayer) { sfx.hurt(); showDamageDir(pos.x - player.x, pos.z - player.z); buzz(40); }
    if (player.takeDamage(dmg * f * self)) die('EXPLODED');
  },
});
const pickupSys = new Pickups(scene);
const hitEl = document.getElementById('hit')!; let hitT = 0;
let lastWeapon = ''; const crossEl = document.getElementById('cross')!; let crossKick = 0, crossGap = 6;
// ---- music + announcer ----
const music = new Music();
music.light = TOUCH;
{ // each map plays the battle score in its own key and tempo
  const T: Record<string, [number, number]> = { boreal: [0, 1], void: [-2, 0.92], spire: [3, 1.04], bastion: [-4, 0.96], foundry: [2, 1.08], crypt: [-5, 0.9], ring: [5, 1.05], tower: [-1, 1], canyon: [1, 0.98], inferno: [4, 1.1], skywell: [-3, 1.02], citadel: [3, 1] };
  const t = T[MAP_ID]; if (t) music.theme = { transpose: t[0], bpmMul: t[1] };
}                 // phones get a lighter battle score
const announcer = new Announcer(document.getElementById('announce')!);
announcer.onSpeak = () => music.duck();
music.onNow = t => say(`♪ ${t.name}`);
// browsers only allow sound after a tap / key press: start audio and music on the very first one, wherever it lands
for (const ev of ['pointerdown', 'touchstart', 'keydown'] as const) addEventListener(ev, () => { sfx.unlock(); music.start(); }, { capture: true, once: true });
const recentKills: number[] = [];                 // when kills happened lately (drives the music's intensity)
let matchStartMs = performance.now();

// ───────────── sessions: title screen · solo match · online room ─────────────
const qs = new URLSearchParams(location.search);
let roomCode = (qs.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const savedName = (() => { try { return (localStorage.getItem('mq-name') || '').toUpperCase(); } catch { return ''; } })();
let myName = ((qs.get('name') || savedName || 'PLAYER').toUpperCase().replace(/[^\w \-]/g, '').slice(0, 14)) || 'PLAYER';
let mode: 'title' | 'solo' | 'online' = 'title';
const intParam = (k: string, d: number) => { const v = Number(qs.get(k)); return qs.has(k) && Number.isFinite(v) ? v : d; };
let cfg: MatchCfg = { map: MAP, mode: MODES.some(m => m.id === qs.get('gm')) ? qs.get('gm')! : 'ffa', bots: intParam('bots', 3), skill: intParam('skill', 1), frag: intParam('frag', 20), caps: intParam('caps', 3), time: intParam('time', 10), open: true };
let ts: { 1: number; 2: number } = { 1: 0, 2: 0 };                   // team scores (TDM frags / CTF captures)
let soloTeam = 0;                                                       // the local player's team in a solo match
type FlagSt = { s: 'base' | 'carried' | 'dropped'; c: number; p: number[] | null };
let flagSt: { 1: FlagSt; 2: FlagSt } = { 1: { s: 'base', c: 0, p: null }, 2: { s: 'base', c: 0, p: null } };
let matchState: 'lobby' | 'playing' | 'ended' = 'playing';
let endsAt = 0, timeOffset = 0, hostId = 0;
const isHost = () => mode === 'online' && net.online && hostId === net.id;
const teamMode = () => isTeamMode(cfg.mode);
/** the score a match is played to: frags (DM, instagib), hold-seconds (hill), none for last man standing, captures for CTF handled apart */
const fragLimit = () => cfg.mode === 'ctf' || cfg.mode === 'lms' ? 0 : cfg.mode === 'koth' ? cfg.frag * KOTH_PER_STEP : cfg.frag;
const myTeam = () => (!teamMode() ? 0 : mode === 'online' ? (scoreboard.find(p => p.id === net.id)?.team ?? 0) : soloTeam);
/** team of a projectile's owner: a bot's name (solo) or a network id as text (online) */
function teamOfOwner(owner: string): number {
  if (!owner || owner === 'SELF') return 0;
  if (/^\d+$/.test(owner)) return scoreboard.find(p => p.id === Number(owner))?.team ?? 0;
  return bots.find(b => b.name === owner)?.team ?? 0;
}
const friendlyOwner = (owner: string) => { const t = myTeam(); return t > 0 && teamOfOwner(owner) === t; };
/** solo pauses while the menu is open; online the world keeps going */
let layoutEditing = false;
const paused = () => mode !== 'online' && (menu.open || guideOpen || layoutEditing);

// ---- bots (solo: local; online: run by the host, everyone else sees them as remote players) ----
const bots: Bot[] = [];
const botVel = new THREE.Vector3(), botPrev = new THREE.Vector3(); let botPrevSet = false;
const botCtxPlayer: BotTarget = { pos: new THREE.Vector3(), eye: new THREE.Vector3(), vel: botVel };
const humanTargets = new Map<number, BotTarget>();
const botViews = new WeakMap<Bot, BotTarget>();
function botView(o: Bot): BotTarget { let v = botViews.get(o); if (!v) botViews.set(o, (v = { pos: o.pos, eye: new THREE.Vector3(), vel: o.vel })); v.eye.set(o.pos.x, o.pos.y + 1.5, o.pos.z); return v; }
const zeroVel = new THREE.Vector3();
const botCtx: BotCtx = {
  player: botCtxPlayer,
  /** the nearest living enemy: the local player, other humans (online) and the other team's bots (everyone's an enemy in deathmatch) */
  target(b) {
    let best: BotTarget | null = null, bd = 1e9;
    const consider = (t: BotTarget, team: number) => {
      if (b.team && team === b.team) return;
      const d = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z) + Math.abs(t.pos.y - b.pos.y) * 2; if (d < bd) { bd = d; best = t; }
    };
    if (player.health > 0) consider(botCtxPlayer, myTeam());
    if (mode === 'online') for (const [id, t] of humanTargets) consider(t, remotes.get(id)?.team ?? 0);
    for (const o of bots) if (o !== b && o.alive) consider(botView(o), o.team);
    return best ?? botCtxPlayer;
  },
  fire(id, o, d, dmg, sp, owner, bot) {
    combat.fireEnemy(id, o, d, dmg * (loadoutRules.insta ? 12 : 1), sp, owner); sfx.shot(id, Math.min(0.8, 9 / (o.distanceTo(camera.position) + 4)), panOf(o));
    if (mode === 'online' && bot.netId) net.send({ t: 'fire', as: bot.netId, w: id, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] });
  },
  hill: () => (cfg.mode === 'koth' ? { x: levelHill.pos[0], y: levelHill.pos[1], z: levelHill.pos[2], r: levelHill.r } : null),
  canRespawn: b => !(cfg.mode === 'lms' && matchState === 'playing' && deathsOfBot(b) >= LIVES),
  onKilled(b, by, w) {
    if (mode === 'online') { net.send({ t: 'botdead', id: b.netId, by: by ? Number(by) : net.id, w }); return; }
    soloKill(by || 'me', b.name);
    if (by && by !== 'me') { feed(by, (w in WEAPON_DEFS ? w : '') as WeaponId | '', b.name, false, false, false); }
    else say(`YOU FRAGGED ${b.name}`);
  },
  onHit() { /* feedback comes from combat.landed */ },
  itemActive: i => !!pickupSys.items[i]?.active,
  claimItem: i => pickupSys.claim(i, performance.now() / 1000),
  incoming: (p, owner) => combat.incoming(p, owner),
};
let wantBots: BotDef[] = [];
const sameBot = (b: Bot, d: BotDef) => b.name === d.name && b.netId === (d.netId ?? 0) && b.team === (d.team ?? 0);
/** make the local bot set match `defs` (spawns are async: anything no longer wanted when it arrives is dropped) */
function setBots(defs: BotDef[], skill: number) {
  wantBots = defs;
  for (const b of [...bots]) if (!defs.some(d => sameBot(b, d))) { disposeBot(b); bots.splice(bots.indexOf(b), 1); targets.splice(targets.indexOf(b), 1); }
  for (const b of bots) b.skill = skill;
  for (const d of defs) {
    if (bots.some(b => sameBot(b, d))) continue;
    spawnBot(scene, botCtx, d, skill).then(b => {
      if (!wantBots.some(w => sameBot(b, w)) || bots.some(x => sameBot(x, w0(b)))) { disposeBot(b); return; }
      bots.push(b); targets.push(b);
    });
  }
}
const w0 = (b: Bot): BotDef => ({ name: b.name, weapon: b.weaponId, color: 0, netId: b.netId, team: b.team });
const soloTeamOf = (k: string) => (k === 'me' ? soloTeam : (bots.find(b => b.name === k)?.team ?? 0));
/** solo scoring: deaths always count; kills count unless they are suicides or team kills; TDM also scores the team */
function soloKill(killerKey: string, victimKey: string) {
  if (matchState !== 'playing') return;
  score(victimKey).deaths++;
  if (!killerKey || killerKey === victimKey) { refreshFrags(); return; }
  const kt = soloTeamOf(killerKey), vt = soloTeamOf(victimKey);
  if (kt && kt === vt) { refreshFrags(); return; }
  score(killerKey).frags++; if (cfg.mode === 'tdm' && kt) ts[kt as 1 | 2]++;
  if (killerKey === 'me') announcer.kill();
  refreshFrags(); checkSoloEnd();
}

// ---- scores ----
const soloScore = new Map<string, { frags: number; deaths: number }>();
function score(k: string) { let s = soloScore.get(k); if (!s) soloScore.set(k, (s = { frags: 0, deaths: 0 })); return s; }
let scoreboard: PlayerInfo[] = [];
/** the current scoreboard (solo is built locally; online comes from the server) */
function board(): PlayerInfo[] {
  if (mode === 'online') return scoreboard;
  const me = score('me');
  return [{ id: 0, name: myName, color: 0xffd24a, team: soloTeam, frags: me.frags, deaths: me.deaths },
    ...bots.map((b, i) => ({ id: i + 1, name: b.name, color: BOT_ROSTER.find(r => r.name === b.name)?.color ?? 0xffffff, team: b.team, frags: score(b.name).frags, deaths: score(b.name).deaths, bot: true }))];
}
const myId = () => mode === 'online' ? net.id : 0;
function refreshFrags() {
  const b = [...board()].sort((x, y) => y.frags - x.frags || x.deaths - y.deaths), i = b.findIndex(p => p.id === myId());
  const me = b[i]; fragsEl.textContent = `${me ? me.frags : frags} FRAGS${mode !== 'title' && b.length > 1 && i >= 0 && !teamMode() ? `  ·  #${i + 1} OF ${b.length}` : ''}`;
}

// ---- match flow ----
const mstat = { shots: 0, hits: 0, fire: 0, hitFire: -1, pickups: 0, heads: 0 };
// ---- game-mode rules: instagib, last man standing, king of the hill ----
let eliminated = false, wasInsta = false;
const deathsOfBot = (b: Bot) => (mode === 'online' ? (scoreboard.find(p => p.id === b.netId)?.deaths ?? 0) : score(b.name).deaths);
/** call whenever the room / match settings may have changed */
function applyRules() {
  loadoutRules.insta = cfg.mode === 'insta';
  if (loadoutRules.insta !== wasInsta) { wasInsta = loadoutRules.insta; pickupSys.setEnabled(!loadoutRules.insta); }
}
/** a new match begins: everyone is back in */
function resetModeState() { eliminated = false; hillAcc = 0; hillText = ''; Object.assign(mstat, { shots: 0, hits: 0, hitFire: -1, pickups: 0, heads: 0 }); }
/** last man standing: out of lives = out for the rest of the match (you watch from above) */
function checkMyElimination() {
  if (cfg.mode !== 'lms' || matchState !== 'playing' || eliminated) return;
  const me = board().find(p => p.id === myId()); if (!me || me.deaths < LIVES) return;
  eliminated = true; player.health = 0; deadT = 1e9; vm.setVisible(false); say('ELIMINATED');
}
// king of the hill
const hillVis = buildHill(); hillVis.group.visible = false; scene.add(hillVis.group);
let hillText = '', hillAcc = 0;
const inHill = (x: number, y: number, z: number) => Math.hypot(x - levelHill.pos[0], z - levelHill.pos[2]) < levelHill.r && Math.abs(y - levelHill.pos[1]) < 3;
function hillTick(dt: number) {
  const on = cfg.mode === 'koth' && matchState === 'playing' && mode !== 'title';
  if (hillVis.group.visible !== on) hillVis.group.visible = on;
  if (!on) { hillText = ''; return; }
  hillVis.update(performance.now() / 1000);
  hillAcc += dt; if (hillAcc < 1) return; hillAcc = 0;
  const occ: { key: string; id: number; me?: boolean }[] = [];
  if (player.health > 0 && inHill(player.x, player.y, player.z)) occ.push({ key: 'me', id: myId(), me: true });
  for (const b of bots) if (b.alive && inHill(b.pos.x, b.pos.y, b.pos.z)) occ.push({ key: b.name, id: b.netId });
  for (const r of remotes.values()) if (r.alive && inHill(r.pos.x, r.pos.y, r.pos.z)) occ.push({ key: 'p' + r.info.id, id: r.info.id });
  const st = occ.length === 0 ? 'free' : occ.length > 1 ? 'contested' : occ[0].me ? 'mine' : 'theirs';
  hillVis.setState(st); hillText = st === 'free' ? 'HILL FREE' : st === 'contested' ? 'CONTESTED' : st === 'mine' ? 'YOU HOLD' : 'ENEMY HOLDS';
  if (occ.length !== 1) return;
  if (mode === 'solo') { score(occ[0].key).frags++; refreshFrags(); checkSoloEnd(); }
  else if (isHost()) net.send({ t: 'award', l: [[occ[0].id, 1]] });
}
const DEAD_TIME = 1.7;
let deadT = 0, deadFor = 0, deathLook: THREE.Vector3 | null = null;
function endDeath() { deadT = 0; vm.setVisible(true); }
/** where the enemies are (x, z): the player respawns as far from them as it can */
function enemyXZ(): [number, number][] {
  const mt = myTeam(), out: [number, number][] = [];
  for (const b of bots) if (b.alive && !(mt && b.team === mt)) out.push([b.pos.x, b.pos.z]);
  if (mode === 'online') for (const r of remotes.values()) if (r.alive && !(mt && r.team === mt)) out.push([r.pos.x, r.pos.z]);
  return out;
}
const nowServer = () => Date.now() + timeOffset;
const remaining = () => endsAt ? Math.max(0, (endsAt - nowServer()) / 1000) : -1;
function startSoloMatch() {
  applyRules(); resetModeState(); announcer.reset(); matchStartMs = performance.now(); ts = { 1: 0, 2: 0 }; soloScore.clear(); matchState = 'playing'; endsAt = cfg.time ? Date.now() + cfg.time * 60000 : 0; timeOffset = 0;
  endDeath(); player.respawn(); yaw = player.yaw; pitch = 0; loadout.reset(); vm.show(loadout.best()); lastBar = '';
  for (const b of bots) b.respawn(); menu.hideEnd(); refreshFrags(); announcer.say('FIGHT', '', 2); pushView();
}
let soloEndTimer = 0;
function checkSoloEnd() {
  if (mode !== 'solo' || matchState !== 'playing') return;
  const b = board(), lead = teamMode() ? Math.max(ts[1], ts[2]) : Math.max(...b.map(p => p.frags));
  const lmsDone = cfg.mode === 'lms' && b.length > 1 && b.filter(p => p.deaths < LIVES).length <= 1;
  if ((fragLimit() && lead >= fragLimit()) || lmsDone || (endsAt && Date.now() >= endsAt)) {
    matchState = 'ended';
    const left = (p: PlayerInfo) => Math.max(0, LIVES - p.deaths);
    const sorted = [...b].sort((x, y) => cfg.mode === 'lms' ? left(y) - left(x) || y.frags - x.frags : y.frags - x.frags || x.deaths - y.deaths);
    menu.showEnd(sorted, sorted[0]?.id ?? -1, 0, 10, teamMode() ? (ts[1] > ts[2] ? 1 : ts[2] > ts[1] ? 2 : 0) : 0, ts, endStats(sorted, 0)); sfx.kill();
    clearTimeout(soloEndTimer); soloEndTimer = window.setTimeout(() => { if (mode === 'solo') startSoloMatch(); }, 10000);
    pushView();
  }
}
const matchEl = document.getElementById('matchbar')!, timersEl = document.getElementById('timers')!; let timersHtml = '';
let matchAcc = 0;
function matchTick(dt: number) {
  matchAcc += dt; if (matchAcc < 0.25) return; matchAcc = 0;
  refreshFrags();
  { // how heated is the match? time used, how close someone is to winning, and how many kills just happened
    const now = performance.now(); while (recentKills.length && now - recentKills[0] > 22000) recentKills.shift();
    const total = cfg.time * 60000, prog = total ? Math.min(1, (now - matchStartMs) / total) : Math.min(1, (now - matchStartMs) / 600000);
    const lead = teamMode() ? Math.max(ts[1], ts[2]) : Math.max(0, ...board().map(p => p.frags)), limit = cfg.mode === 'ctf' ? cfg.caps : fragLimit();
    const heat = Math.min(1, recentKills.length / 6), toWin = limit ? Math.min(1, lead / limit) : 0;
    music.setIntensity(matchState === 'playing' ? Math.min(1, 0.12 + 0.36 * prog + 0.3 * toWin + 0.3 * heat) : 0.14);
  }
  if (matchState === 'playing' && mode !== 'title') {
    const b = board(), mt = myTeam(), meId = myId(), r = remaining();
    const mine = teamMode() ? (mt ? ts[mt as 1 | 2] : 0) : (b.find(p => p.id === meId)?.frags ?? 0);
    const rest = teamMode() ? (mt ? ts[(3 - mt) as 1 | 2] : 0) : Math.max(-99, ...b.filter(p => p.id !== meId).map(p => p.frags));
    const top = Math.max(mine, rest), limit = fragLimit();
    announcer.match(r, limit ? limit - top : -1, top > 0 && (teamMode() ? mt > 0 : true) ? (mine > rest ? 1 : mine === rest ? 0 : -1) : null, (performance.now() - matchStartMs) / 1000);
  }
  { const tl = pickupSys.timers(performance.now() / 1000), html = matchState === 'playing' ? tl.map(x => `<div class="tm" style="--c:#${x.color.toString(16).padStart(6, '0')}">${x.name}<i>${x.left}</i></div>`).join('') : ''; if (html !== timersHtml) { timersHtml = html; timersEl.innerHTML = html; } }
  if (mode === 'solo' && matchState === 'playing') {            // adaptive difficulty: nudge the bots toward making the match close
    const b = board(), me = b.find(p => p.id === 0), others = b.filter(p => p.id !== 0 && (!teamMode() || p.team !== soloTeam));
    if (me && others.length) { const lead = me.frags - Math.max(...others.map(p => p.frags)); const want = Math.max(-1, Math.min(1, lead / 6)); botAdapt.k += (want - botAdapt.k) * 0.02; }
  } else botAdapt.k = 0;
  if (mode === 'solo') checkSoloEnd();
  let text = '';
  if (mode !== 'title') {
    const r = remaining(), clock = r >= 0 ? `<b>${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}</b>` : '';
    if (matchState === 'lobby') text = isHost() ? 'WARMUP · OPEN MENU TO START' : 'WARMUP · WAITING FOR HOST';
    else if (matchState === 'ended') text = 'MATCH OVER';
    else if (teamMode()) {
      const limit = cfg.mode === 'ctf' ? `FIRST TO ${cfg.caps}` : cfg.frag ? `FIRST TO ${cfg.frag}` : '';
      text = `<span class="tr">RED ${ts[1]}</span> ${clock ? `<b>${clock}</b>` : '·'} <span class="tb">${ts[2]} BLUE</span>${limit ? `<br><small>${limit}</small>` : ''}`;
      if (cfg.mode === 'ctf') { const fl = (n: 1 | 2) => { const s = flagSt[n]; return s.s === 'base' ? 'HOME' : s.s === 'carried' ? (s.c === net.id ? 'YOU HAVE IT' : 'TAKEN') : 'DROPPED'; }; text += `<br><small><span class="tr">⚑ ${fl(1)}</span> &nbsp; <span class="tb">⚑ ${fl(2)}</span></small>`; }
    }
    else if (cfg.mode === 'lms') { const b = board(), mine = b.find(p => p.id === myId()); text = [clock, `${b.filter(p => p.deaths < LIVES).length} ALIVE`, mine ? `<b>${'♥'.repeat(Math.max(0, LIVES - mine.deaths))}</b>` : ''].filter(Boolean).join(' · '); }
    else if (cfg.mode === 'koth') text = [clock, `FIRST TO ${fragLimit()}`, hillText].filter(Boolean).join(' · ');
    else text = [clock, fragLimit() ? `FIRST TO ${fragLimit()}` : ''].filter(Boolean).join(' · ');
  }
  if (matchEl.innerHTML !== text) matchEl.innerHTML = text;
  if (menu.open) pushView();
}
function pushView() {
  const v: LobbyView = {
    mode: mode === 'online' ? 'online' : 'solo', room: roomCode, link: `${location.origin}/?room=${roomCode}`,
    meId: myId(), hostId, isHost: isHost(), cfg, state: matchState, remaining: remaining(), players: board(), ts, myTeam: myTeam(),
    status: mode === 'online' ? (net.online ? '' : netState === 'full' ? 'ROOM IS FULL' : netState === 'connecting' ? 'CONNECTING…' : 'DISCONNECTED') : '',
  };
  menu.setView(v);
}

// ---- touch controls: drag-to-place layout editor ----
const layoutBar = document.createElement('div'); layoutBar.id = 'layoutbar';
layoutBar.innerHTML = '<span>DRAG THE BUTTONS</span><button data-r="1">RESET</button><button class="go" data-d="1">DONE</button>'; document.body.appendChild(layoutBar);
function editLayout() {
  if (!touch) return;
  layoutEditing = true; menu.hide(); touch.show(true); touch.setEdit(true); layoutBar.classList.add('open');
}
layoutBar.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  if (t.dataset.r) touch?.resetLayout();
  if (t.dataset.d) { layoutEditing = false; touch?.setEdit(false); layoutBar.classList.remove('open'); menu.show('settings'); }
});
for (const ev of ['touchstart', 'touchend'] as const) layoutBar.addEventListener(ev, e => e.stopPropagation(), { passive: true });

// ---- touch controls: size / opacity, first-time guide ----
function applyControlLook(size: number, alpha: number) {
  document.body.style.setProperty('--ctl', String(size || 1)); document.body.style.setProperty('--cta', String(alpha || 0.9));
}
let guideOpen = false;
const guideSeen = () => { try { return localStorage.getItem('mq-guide') === '1'; } catch { return true; } };
/** labels drawn next to the real on-screen controls (positions read from the layout, so it fits every screen) */
function showGuide(fromSettings = false) {
  if (!TOUCH) return;
  if (fromSettings && mode === 'title') { say('START A MATCH TO SEE THE GUIDE'); try { localStorage.removeItem('mq-guide'); } catch { /* ignore */ } return; }
  if (fromSettings) { try { localStorage.removeItem('mq-guide'); } catch { /* ignore */ } resume(); return; }
  const el = document.createElement('div'); el.id = 'guide';
  const tip = (sel: string, text: string, side: 'l' | 'r' | 't' | 'b') => {
    const t = document.querySelector(sel) as HTMLElement | null; if (!t) return '';
    const r = t.getBoundingClientRect(); if (!r.width) return '';
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pos = side === 'l' ? `right:${innerWidth - r.left + 10}px;top:${cy}px;transform:translateY(-50%)` : side === 'r' ? `left:${r.right + 10}px;top:${cy}px;transform:translateY(-50%)`
      : side === 't' ? `left:${cx}px;bottom:${innerHeight - r.top + 8}px;transform:translateX(-50%)` : `left:${cx}px;top:${r.bottom + 8}px;transform:translateX(-50%)`;
    return `<div class="g-ring" style="left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px"></div><div class="g-tip g-${side}" style="${pos}">${text}</div>`;
  };
  // the right-hand cluster gets numbered rings + one legend beside it (separate tips would overlap)
  const rectOf = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect();
  const badge = (sel: string, n: number) => { const r = rectOf(sel); if (!r || !r.width) return '';
    return `<div class="g-ring" style="left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px"></div><b class="g-num" style="left:${r.left + r.width * 0.15 - 11}px;top:${r.top + r.height * 0.15 - 11}px">${n}</b>`; };
  const legendPos = () => {
    const xs = ['.tfire', '.tjump', '.tcrouch', '.tweap'].map(rectOf).filter(Boolean) as DOMRect[];
    const left = Math.min(...xs.map(r => r.left)), top = Math.min(...xs.map(r => r.top)), bottom = Math.max(...xs.map(r => r.bottom));
    return `right:${innerWidth - left + 14}px;top:${(top + bottom) / 2}px;transform:translateY(-50%);text-align:left`;
  };
  el.innerHTML = `<div class="g-dim"></div>
    ${tip('.tstick', 'DRAG TO MOVE<small>anywhere on the left half</small>', 't')}
    ${badge('.tfire', 1)}${badge('.tjump', 2)}${badge('.tcrouch', 3)}${badge('.tweap', 4)}
    <div class="g-tip g-legend" style="${legendPos()}">
      <p><i>1</i>HOLD TO FIRE<small>drag while holding to aim</small></p>
      <p><i>2</i>JUMP<small>tap again on each landing to bunny-hop</small></p>
      <p><i>3</i>DUCK<small>tap to crouch, tap again to stand</small></p>
      <p><i>4</i>NEXT WEAPON<small>or tap a slot in the weapon bar</small></p>
    </div>
    ${tip('.tpause', 'MENU &amp; SCORES', 'b')}
    <div class="g-tip g-aim" style="left:62%;top:38%;transform:translate(-50%,-50%)">SWIPE HERE TO AIM<small>gyro aim: Settings → Controls</small></div>
    <div class="g-go">TAP ANYWHERE TO PLAY</div>`;
  document.body.appendChild(el); guideOpen = true;
  const close = (e: Event) => { e.preventDefault(); e.stopPropagation(); el.remove(); guideOpen = false; try { localStorage.setItem('mq-guide', '1'); } catch { /* ignore */ } };
  setTimeout(() => { el.addEventListener('touchstart', close, { passive: false }); el.addEventListener('click', close); }, 400);
}

// ---- online ----
const remotes = new Map<number, RemotePlayer>();
const netEl = document.getElementById('net')!;
let lastAttacker = 0; let netState = 'offline';
const dirV = (a: number[]) => new THREE.Vector3(a?.[0] ?? 0, a?.[1] ?? 0, a?.[2] ?? 0);
function addRemote(p: PlayerInfo) {
  if (p.id === net.id || remotes.has(p.id)) return;
  const r = new RemotePlayer(p, scene, (to, dmg, dir, kind) => { net.send({ t: 'hit', to, dmg, dir: [dir.x, dir.y, dir.z], kind }); });
  remotes.set(p.id, r); targets.push(r);
}
function dropRemote(id: number) { const r = remotes.get(id); if (!r) return; r.dispose(); const i = targets.indexOf(r); if (i >= 0) targets.splice(i, 1); remotes.delete(id); humanTargets.delete(id); }
/** host runs the room's bots locally; everyone else shows them as remote players */
function syncNetBots() {
  const defs: BotDef[] = scoreboard.filter(p => p.bot).map(p => ({ name: p.name, weapon: p.weapon ?? 'plasma', color: p.color, netId: p.id, team: p.team ?? 0 }));
  if (isHost()) { for (const d of defs) dropRemote(d.netId!); setBots(defs, cfg.skill); }
  else { setBots([], cfg.skill); for (const p of scoreboard) if (p.bot) addRemote(p); }
  for (const id of [...remotes.keys()]) if (!scoreboard.some(p => p.id === id)) dropRemote(id);
}
function drawNet() {
  const q = net.ping, col = q < 80 ? '#7dff6a' : q < 160 ? '#ffd24a' : '#ff6a58';
  netEl.innerHTML = mode === 'online' ? `ROOM <b>${roomCode}</b>${net.online ? (q ? ` · <span style="color:${col}">${q} MS</span>` : '') : ` · ${netState.toUpperCase()}`}` : '';
}
function reloadInto(params: Record<string, string>) { location.search = new URLSearchParams(params).toString(); }
function applyRoom(info: RoomInfo) {
  if (info.cfg.map !== MAP) { reloadInto({ room: roomCode, name: myName, map: info.cfg.map }); return false; }
  cfg = info.cfg; matchState = info.state; timeOffset = info.now - Date.now(); endsAt = info.endsAt; hostId = info.host;
  scoreboard = info.players; for (const p of scoreboard) if (!p.bot) addRemote(p);
  ts = info.ts ?? { 1: 0, 2: 0 }; flagSt = info.flags ?? flagSt;
  syncNetBots(); for (const p of scoreboard) remotes.get(p.id)?.setTeam(p.team ?? 0);     // red / blue outfits
  const mt = myTeam(); if (mt !== armTeam) { armTeam = mt; vm.setTeam(mt); }
  applyRules(); refreshFrags(); drawNet(); pushView(); syncVoicePeers(); return true;
}
let localKillAt = 0, armTeam = 0;
const net = new Net({
  status(st) { netState = st; drawNet(); pushView(); if (st === 'offline' && mode === 'online') say('DISCONNECTED'); else if (st === 'connecting' && mode === 'online' && net.id) say('RECONNECTING…'); },
  welcome(_id, info) { if (applyRoom(info)) say(hostId === net.id ? 'ROOM CREATED' : 'CONNECTED'); },
  join(p, host) { scoreboard = [...scoreboard.filter(x => x.id !== p.id), p]; hostId = host; if (!p.bot) { addRemote(p); say(`${p.name} JOINED`); } pushView(); syncVoicePeers(); },
  leave(id) { const r = remotes.get(id); if (r) say(`${r.info.name} LEFT`); dropRemote(id); scoreboard = scoreboard.filter(p => p.id !== id); speaking.delete(id); drawSpeakers(); pushView(); syncVoicePeers(); },
  room(kind, info) {
    if (!applyRoom(info)) return;
    if (kind === 'start') { menu.hideEnd(); endDeath(); player.respawn(); yaw = player.yaw; pitch = 0; loadout.reset(); vm.show(loadout.best()); lastBar = ''; for (const b of bots) b.respawn(); announcer.reset(); resetModeState(); matchStartMs = performance.now(); announcer.say('FIGHT', '', 2); }
    if (kind === 'lobby') { menu.hideEnd(); say('WARMUP'); }
  },
  end(b, winner, _why, next, team, tsv) { matchState = 'ended'; scoreboard = b; endsAt = 0; if (tsv) ts = tsv; menu.showEnd(b, winner, net.id, next, team ?? 0, tsv ?? ts, endStats(b, net.id)); refreshFrags(); pushView(); },
  flags(fl, tsv, ev) { flagSt = fl; ts = tsv ?? ts; onFlagEvent(ev); pushView(); },
  chat(from, to, k, txt) { onChat(from, to, k, txt); },
  rtc(from, d) { onRtc(from, d); },
  talk(id, on) { onTalk(id, on); },
  board(b) { scoreboard = b; refreshFrags(); pushView(); if (cfg.mode === 'lms') checkMyElimination(); },
  host(id) { hostId = id; syncNetBots(); if (id === net.id) say('YOU ARE NOW THE HOST'); pushView(); },
  bots(list) { if (isHost()) return; for (const b of list) remotes.get(b.id)?.setState(b.p, b.yaw, b.w, b.hp, b.dead, b.v); },
  renamed(id, name, b) { scoreboard = b; remotes.get(id)?.rename(name); refreshFrags(); pushView(); },
  bothit(from, to, dmg, dir, kind) {
    if (!isHost()) return; const b = bots.find(x => x.netId === to);
    b?.hit(dmg, b.pos, dirV(dir), kind, String(from), kind in WEAPON_DEFS ? kind : '');
  },
  state(id, m) { remotes.get(id)?.setState(m.p, m.yaw, m.w, m.hp, !!m.dead); },
  fire(id, m) {
    const r = remotes.get(id); r?.flashFire(); const o = dirV(m.o); r?.fireFrom(o);
    combat.remoteShot(m.w, o, dirV(m.d), String(id), Number(m.k) || 1); sfx.shot(m.w, Math.min(0.85, 10 / (o.distanceTo(camera.position) + 4)), panOf(o));
  },
  hit(from, dmg, dir, kind) { if (player.health <= 0 || player.invuln > 0) return; blame(String(from), (kind in WEAPON_DEFS ? kind : 'pistol') as WeaponId); const d = dirV(dir); showDamageDir(-d.x, -d.z); buzz(30); player.knock(d.x * 1.5, 0.3, d.z * 1.5); sfx.hurt(); if (player.takeDamage(dmg)) die('DIED'); },
  killed(id, by, b, w, tsv, cap) {
    scoreboard = b; if (tsv) ts = tsv; refreshFrags(); pushView(); checkMyElimination();
    if (cap) return;                                                          // a flag capture: the flag event announces it
    const v = b.find(p => p.id === id), k = b.find(p => p.id === by);
    if (!v) return;
    const weapon = (w && w in WEAPON_DEFS ? w : '') as WeaponId | '';
    feed(k && k !== v ? k.name : '', weapon, v.name, k ? k.id === net.id : false, v.id === net.id, !k || k === v);
    if (id !== net.id) {
      if (k && by === net.id) { say(`YOU FRAGGED ${v.name}`); announcer.kill(); if (performance.now() - localKillAt > 800) { sfx.kill(); killMark(); } }
      else say(k ? `${k.name} FRAGGED ${v.name}` : `${v.name} DIED`);
    }
  },
});
// host: other players' rockets / plasma / nails can hit the host's bots
combat.hooks.foreignTargets = owner => {
  // a bot's shots (solo: its name; online host: its network id) can hurt the other team's bots; everyone's an enemy in deathmatch
  const ob = bots.find(b => b.name === owner || (b.netId && String(b.netId) === owner));
  if (ob) return bots.filter(b => b !== ob && b.alive && !(b.team && b.team === ob.team));
  if (isHost() && owner && Number(owner) < 1000) { const t = teamOfOwner(owner); return bots.filter(b => !(t && b.team === t)); }   // remote humans hit the host's bots, never their own team's
  return [];
};
combat.hooks.foreignHit = (tg, dmg, owner, weapon) => (tg as Bot).hit(dmg, tg.pos, new THREE.Vector3(), weapon, owner, weapon);
let botSnapAcc = 0, pingAcc = 0;
/** the host sends its bots' positions 20 times a second on a wall clock (not tied to the frame rate), with their velocity so other phones can coast smoothly */
setInterval(() => {
  if (mode !== 'online' || !net.online || !isHost() || !bots.length) return;
  const R = (v: number) => Math.round(v * 100) / 100;
  net.send({ t: 'bots', l: bots.map(b => ({ id: b.netId, p: [R(b.pos.x), R(b.pos.y), R(b.pos.z)], yaw: Math.round((b.yaw - Math.PI) * 1000) / 1000, w: b.weaponId, hp: Math.round(b.healthPct), dead: !b.alive, v: [R(b.vel.x), R(b.vel.z)] })) });
}, 50);
function netTick(dt: number) {
  if (mode !== 'online') return;
  pingAcc += dt; if (pingAcc > 1) { pingAcc = 0; drawNet(); }
  // remote humans as bot targets (host)
  if (isHost()) {
    for (const [id, r] of remotes) {
      if (r.info.bot) continue;
      let t = humanTargets.get(id); if (!t) humanTargets.set(id, (t = { pos: new THREE.Vector3(), eye: new THREE.Vector3(), vel: zeroVel }));
      t.pos.copy(r.pos); t.eye.set(r.pos.x, r.pos.y + 1.6, r.pos.z);
      if (!r.alive) t.pos.y = -999;               // dead players are not hunted
    }
  }
}

// ---- capture the flag ----
const ctf = flagBases ? new Ctf(scene, flagBases) : null;
const _cp = new THREE.Vector3(), _fp = new THREE.Vector3(); let flagCool = 0;
const carrierPos = (id: number): THREE.Vector3 | null => (id === net.id ? _cp.set(player.x, player.y, player.z) : (remotes.get(id)?.pos ?? null));
function ctfTick(t: number) {
  if (!ctf) return;
  const vis = cfg.mode === 'ctf' && mode === 'online'; ctf.update(t, flagSt, carrierPos, vis);
  if (!vis || matchState !== 'playing' || !net.online || performance.now() < flagCool) return;
  const mt = myTeam() as 0 | 1 | 2; if (!mt) return;
  for (const f of [1, 2] as const) {
    const st = flagSt[f]; if (st.s === 'carried') continue;
    const p = ctf.pos(f, st, carrierPos, _fp), dx = player.x - p.x, dz = player.z - p.z, dy = player.y - p.y;
    if (dx * dx + dz * dz > 4 || dy < -1 || dy > 2.2) continue;
    const mine = flagSt[(3 - mt) as 1 | 2];
    if (f !== mt) net.send({ t: 'flag', a: 'take', f });                                        // grab the enemy flag
    else if (st.s === 'dropped') net.send({ t: 'flag', a: 'return', f });                       // send our flag home
    else if (mine.s === 'carried' && mine.c === net.id) net.send({ t: 'flag', a: 'cap', f });   // bring theirs to our base
    else continue;
    flagCool = performance.now() + 500; break;
  }
}
const _pr = new THREE.Vector3(), _pd = new THREE.Vector3();
/** -1 (left) .. 1 (right): where a sound at `pos` is relative to where we are looking */
function panOf(pos: THREE.Vector3): number { _pd.copy(pos).sub(camera.position); const l = _pd.length() || 1; _pr.set(1, 0, 0).applyQuaternion(camera.quaternion); return Math.max(-1, Math.min(1, (_pd.dot(_pr) / l) * 0.9)); }
const nameById = (id: number) => scoreboard.find(p => p.id === id)?.name ?? 'PLAYER';
function onFlagEvent(ev: any) {
  if (!ev || !TEAMS[ev.f]) return;
  const fn = TEAMS[ev.f].name, who = nameById(ev.by);
  if (ev.k === 'take') { say(ev.by === net.id ? 'YOU HAVE THE FLAG! GET HOME' : `${who} TOOK THE ${fn} FLAG`); sfx.powerup(); }
  else if (ev.k === 'drop') say(`${fn} FLAG DROPPED`);
  else if (ev.k === 'return') say(ev.why === 'cap' ? `${TEAMS[3 - ev.f].name} CAPTURED THE FLAG!` : `${fn} FLAG RETURNED`);
  if (ev.k === 'return' && ev.why === 'cap') { sfx.kill(); announcer.say(`${TEAMS[3 - ev.f].name} TEAM SCORES`, '', 3); }
}

// ---- playlist panel ----
const mpanel = document.getElementById('mpanel')!, mfile = document.createElement('input');
mfile.type = 'file'; mfile.accept = 'audio/*'; mfile.multiple = true; mfile.style.display = 'none'; document.body.appendChild(mfile);
mfile.addEventListener('change', () => { if (mfile.files?.length) void music.addFiles(mfile.files).then(() => { mfile.value = ''; renderMusic(); }); });
function renderMusic() {
  touch?.setPlaying(music.playing);
  if (!mpanel.classList.contains('open')) return;
  const row = (t: { id: string; name: string; sub: string; kind: string }) => `<div class="row ${t.id === music.current.id && music.playing ? 'on' : ''}" data-play="${t.id}"><i>${t.id === music.current.id && music.playing ? '♪' : '▶'}</i><div><b>${esc(t.name)}</b><span>${esc(t.sub)}</span></div>${t.kind === 'file' ? `<u data-del="${t.id}" title="Remove">✕</u>` : ''}</div>`;
  const all = music.tracks();
  mpanel.innerHTML = `<h3><span>♪ PLAYLIST</span><button class="mx" data-x="1">✕</button></h3>
    <div class="tr"><button data-prev="1">⏮</button><button class="big" data-toggle="1">${music.playing ? '⏸ PAUSE' : '▶ PLAY'}</button><button data-next="1">⏭</button></div>
    <div class="sec">BUILT-IN</div>${all.filter(t => t.kind !== 'file').map(row).join('')}
    <div class="sec">YOUR MUSIC</div>${all.filter(t => t.kind === 'file').map(row).join('') || '<div class="note">Nothing yet. Add songs from your phone: they stay on this device and play like any other track.</div>'}
    <div style="margin-top:8px"><button class="add" data-add="1">＋ ADD YOUR OWN MUSIC</button></div>
    <div class="sec">VOLUME</div><input type="range" min="0" max="1" step="0.05" value="${music.volume}" data-vol="1">
    <div class="note">The BATTLE SCORE starts calm and builds with the match: more drums, snare rolls and finally the full beat as the fight heats up.</div>`;
}
function toggleMusicPanel(force?: boolean) { const open = force ?? !mpanel.classList.contains('open'); mpanel.classList.toggle('open', open); if (open) renderMusic(); }
music.onChange(() => renderMusic());
mpanel.addEventListener('click', e => {
  const t = e.target as HTMLElement, d = (k: string) => t.closest(`[data-${k}]`) as HTMLElement | null;
  if (d('x')) toggleMusicPanel(false);
  else if (d('del')) void music.remove(d('del')!.dataset.del!);
  else if (d('play')) music.play(d('play')!.dataset.play!);
  else if (d('toggle')) music.toggle(); else if (d('prev')) music.next(-1); else if (d('next')) music.next();
  else if (d('add')) mfile.click();
});
mpanel.addEventListener('input', e => { const t = e.target as HTMLInputElement; if (t.dataset.vol) music.setVolume(Number(t.value)); });
for (const ev of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'mousedown'] as const) mpanel.addEventListener(ev, e => e.stopPropagation(), { passive: true });

// ---- quick chat + voice ----
const esc = (t: string) => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const chatFeedEl = document.getElementById('chatfeed')!, speakEl = document.getElementById('speakers')!, qchatEl = document.getElementById('qchat')!;
let chatToTeam = true, qchatOpen = false; const speaking = new Set<number>();
const voice = new Voice(() => net.id, (to, d) => net.send({ t: 'rtc', to, d }), on => { if (on) speaking.add(net.id); else speaking.delete(net.id); net.send({ t: 'talk', on }); drawSpeakers(); });
function drawSpeakers() { speakEl.innerHTML = [...speaking].map(id => `<div>🎙 ${esc(id === net.id ? 'YOU' : nameById(id))}</div>`).join(''); }
function onTalk(id: number, on: boolean) { if (on) speaking.add(id); else speaking.delete(id); drawSpeakers(); }
function onRtc(from: number, d: any) { if (voice.mode !== 'off') void voice.onSignal(from, d); }
/** connect voice to the right players: teammates in team games, everyone in deathmatch */
function syncVoicePeers() {
  const ids = mode === 'online' && net.online && voice.mode !== 'off' ? scoreboard.filter(p => !p.bot && p.id !== net.id && (!teamMode() || p.team === myTeam())).map(p => p.id) : [];
  voice.setPeers(ids);
}
function onChat(from: number, to: string, k: string, txt: string) {
  const p = scoreboard.find(x => x.id === from), col = p?.team ? TEAMS[p.team].css : '#ffd9a8';
  const line = document.createElement('div'); line.className = 'cl';
  line.innerHTML = `<b style="color:${col}">${esc(p?.name ?? '?')}</b>${to === 'team' ? '<i>TEAM</i>' : ''}${esc(k ? quickText(k) : txt)}`;
  chatFeedEl.appendChild(line); while (chatFeedEl.children.length > 5) chatFeedEl.firstElementChild!.remove();
  setTimeout(() => line.remove(), 7000); if (from !== net.id) sfx.pickup();
}
function buildQuick() {
  qchatEl.innerHTML = `<div class="qh"><span>QUICK CHAT</span>${teamMode() ? `<button data-ch="1" class="${chatToTeam ? 'on' : ''}">TEAM</button><button data-ch="0" class="${!chatToTeam ? 'on' : ''}">ALL</button>` : ''}</div>` +
    QUICK.map((q, i) => `<button data-q="${q.k}"><i>${i + 1}</i>${q.text}</button>`).join('');
}
function toggleQuick() { if (mode !== 'online') return; qchatOpen = !qchatOpen; if (qchatOpen) buildQuick(); qchatEl.classList.toggle('open', qchatOpen); }
function sendQuick(k: string) { net.send({ t: 'chat', to: teamMode() && chatToTeam ? 'team' : 'all', k }); qchatOpen = false; qchatEl.classList.remove('open'); }
qchatEl.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest('button') as HTMLElement | null; if (!t) return;
  if (t.dataset.q) sendQuick(t.dataset.q); else if (t.dataset.ch) { chatToTeam = t.dataset.ch === '1'; buildQuick(); }
});
qchatEl.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) void voice.press(false); });

// ---- entering sessions (from the menu) ----
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const cfgParams = (c: MatchCfg) => ({ map: c.map, gm: c.mode, bots: String(c.bots), skill: String(c.skill), frag: String(c.frag), caps: String(c.caps), time: String(c.time) });
/** solo roster: in team deathmatch the bots split between the player's team (red) and the enemy (blue) */
function soloBotDefs(c: MatchCfg): BotDef[] {
  return BOT_ROSTER.slice(0, Math.max(0, Math.min(7, c.bots))).map((d, i) => ({ ...d, team: c.mode === 'tdm' ? (i % 2 === 0 ? 2 : 1) : 0 }));
}
function enterSolo(c: MatchCfg, name: string) {
  myName = name;
  if (c.map !== MAP) { reloadInto({ mode: 'solo', name, ...cfgParams(c) }); return; }
  if (mode === 'online') { reloadInto({ mode: 'solo', name, ...cfgParams(c) }); return; }
  if (c.mode === 'ctf') c = { ...c, mode: 'tdm' };                     // capture the flag needs friends online
  mode = 'solo'; cfg = c; menu.sessionActive = true; soloTeam = c.mode === 'tdm' ? 1 : 0;
  history.replaceState(null, '', `?${new URLSearchParams({ mode: 'solo', ...cfgParams(c) })}`);
  setBots(soloBotDefs(c), c.skill); if (armTeam !== soloTeam) { armTeam = soloTeam; vm.setTeam(soloTeam); }
  startSoloMatch(); resume();
}
function enterOnline(code: string, name: string, create?: MatchCfg) {
  myName = name; roomCode = code;
  if ((create && create.map !== MAP) || mode === 'solo') { reloadInto({ room: code, name, map: create?.map ?? MAP, ...(create ? { cfg: JSON.stringify(create) } : {}) }); return; }
  mode = 'online'; menu.sessionActive = true; matchState = 'lobby';
  document.body.classList.add('online');
  history.replaceState(null, '', `?${new URLSearchParams({ room: code, name, map: MAP })}`);
  try { localStorage.setItem('mq-room', code); } catch { /* ignore */ }
  setBots([], 1); net.connect(code, name, MAP, create); drawNet(); pushView(); menu.show('lobby');
}
const menu = new Menu({
  touch: TOUCH,
  resume,
  startSolo: enterSolo,
  host: (c, name) => enterOnline(newCode(), name, c),
  join: (code, name) => enterOnline(code, name),
  leave() { location.href = location.pathname; },
  hostCfg(c) { if (isHost()) net.send({ t: 'cfg', cfg: c }); },
  hostStart() { if (isHost()) net.send({ t: 'start' }); },
  pickTeam(team) { if (mode === 'online') net.send({ t: 'team', team }); },
  voice: {
    state: () => ({ mode: voice.mode, volume: voice.volume, supported: Voice.supported, error: voice.error, on: voice.micOn }),
    setMode(m: VoiceMode) { voice.setMode(m); syncVoicePeers(); },
    setVolume(v: number) { voice.setVolume(v); },
    test: async () => voice.ensureMic(),
  },
  hostStop() { if (isHost()) net.send({ t: 'stop' }); },
  restartSolo() { startSoloMatch(); resume(); },
  async fetchGames(): Promise<OpenGame[]> { const r = await fetch(`${Net.httpBase()}/api/rooms`, { cache: 'no-store' }); return r.ok ? r.json() : []; },
  gyro: {
    state: () => ({ mode: gyro.mode, sens: gyro.sens, invertY: gyro.invertY, supported: Gyro.supported, seen: gyro.seen }),
    async setMode(m) { gyro.setMode(m); if (m === 'off') return true; return (await gyro.requestPermission()) || gyro.seen; },
    setSens: v => gyro.setSens(v), setInvert: v => gyro.setInvert(v),
  },
  settingsChanged(st) {
    aimSens = st.sens; sfx.setVolume(st.vol); vibrate = st.vibe; applyControlLook(st.ctl, st.cta);
    const nm = (st.name || '').trim().slice(0, 14);
    if (nm && nm !== myName) {
      myName = nm; refreshFrags();
      if (mode === 'online' && net.online) net.send({ t: 'rename', name: nm });    // everyone in the room sees the new name
      history.replaceState(null, '', location.search.replace(/([?&]name=)[^&]*/, `$1${encodeURIComponent(nm)}`));
    }
  },
  showGuide: () => showGuide(true),
  editLayout: () => editLayout(),
  audio: {
    musicVolume: () => music.volume, setMusicVolume: v => music.setVolume(v),
    announcer: () => announcer.enabled, setAnnouncer: v => announcer.setEnabled(v),
    openPlaylist: () => toggleMusicPanel(true),
  },
});
sfx.setVolume(menu.settings.vol);
applyControlLook(menu.settings.ctl, menu.settings.cta);
if (!myName || myName === 'PLAYER') myName = (menu.settings.name || 'PLAYER').slice(0, 14);
// ---- what to show on load ----
if (roomCode) {
  const nm = qs.get('name') || savedName;
  if (nm) { let create: MatchCfg | undefined; try { create = qs.get('cfg') ? JSON.parse(qs.get('cfg')!) : undefined; } catch { /* ignore */ }
    enterOnline(roomCode, nm.toUpperCase().slice(0, 14), create); }
  else { try { localStorage.setItem('mq-room', roomCode); } catch { /* ignore */ } menu.afterWelcome = 'join'; menu.show('welcome'); }
} else if (qs.get('mode') === 'solo') {
  mode = 'solo'; menu.sessionActive = true; soloTeam = cfg.mode === 'tdm' ? 1 : 0;
  setBots(soloBotDefs(cfg), cfg.skill); if (soloTeam) { armTeam = soloTeam; vm.setTeam(soloTeam); }
  startSoloMatch(); menu.show('pause');
} else menu.show(menu.needsName ? 'welcome' : 'title');

function die(why: string) {
  const recent = performance.now() - killer.at < 6000;
  const by = why === 'FELL' || !recent ? '' : killer.who, weapon: WeaponId | '' = why === 'FELL' || !recent ? '' : killer.weapon;
  if (net.online) net.send({ t: 'dead', by: by && by !== 'SELF' ? Number(by) || 0 : 0, w: weapon });
  else {
    feed(by === 'SELF' || !by ? '' : nameOf(by), weapon, myName, false, true, by === 'SELF' || !by);
    if (mode === 'solo') soloKill(by === 'SELF' || !by ? '' : by, 'me');
  }
  killer.who = ''; sfx.died(); announcer.died(); refreshFrags();
  say(why === 'EXPLODED' ? 'YOU BLEW UP' : why === 'FELL' ? 'YOU FELL' : why === 'BURNED' ? 'YOU BURNED' : why === 'CRUSHED' ? 'YOU WERE CRUSHED' : 'YOU DIED');
  if (why === 'FELL') { respawnNow(); checkMyElimination(); return; }
  // death cam: the view sinks to the floor and turns to the one who got you; a moment later you are back
  player.health = 0; player.armor = 0; deadT = DEAD_TIME; deadFor = 0; vm.setVisible(false); clearBoosters();
  const kp = by && by !== 'SELF' ? (/^\d+$/.test(by) ? remotes.get(Number(by))?.pos : bots.find(b => b.name === by)?.pos) : undefined;
  deathLook = kp ? new THREE.Vector3(kp.x, kp.y, kp.z) : null;
  checkMyElimination();
}
function respawnNow() {
  if (eliminated) return;
  endDeath(); player.respawn(enemyXZ()); yaw = player.yaw; pitch = 0; loadout.reset(); vm.show(loadout.best()); lastBar = ''; clearBoosters(); sfx.spawn();
}
player.onVoid = () => die('FELL');
player.onLava = () => die('BURNED');
player.onCrush = () => die('CRUSHED');
/** blackout: on some maps the lights go out together every so often (same moment for everyone: it runs on the shared clock) */
let darkNow = false;
function blackoutTick(tSec: number) {
  if (!levelBlackout) return;
  const ph = ((tSec % 45) + 45) % 45, flick = (x: number) => { const v = Math.sin(Math.floor(x * 9) * 12.9898) * 43758.5453; return v - Math.floor(v) > 0.45 ? 1 : 0.1; };
  const f = ph < 34 ? 1 : ph < 35.3 ? flick(ph) : ph < 40.5 ? 0.07 : ph < 42 ? flick(ph + 3) : 1;
  const dark = ph >= 34 && ph < 41.5;
  if (dark !== darkNow) { darkNow = dark; if (matchState === 'playing') announcer.say(dark ? 'LIGHTS OUT' : 'POWER RESTORED', '', 2); }
  for (const s of sceneLights) s.l.intensity = s.base * (0.04 + 0.96 * f);
  const lm = (world as any).lampMat as THREE.MeshBasicMaterial | null; if (lm) lm.color.set(THEME.lamp).multiplyScalar(0.05 + 0.95 * f);
}

// ---- hit feedback: hit marker, damage numbers, kill feed ----
const killer = { who: '', weapon: 'pistol' as WeaponId, at: 0 };
/** remember who last hurt us (bot name, remote id as string, or 'SELF') so the death can be credited */
function blame(who: string, weapon: WeaponId) { if (!who) return; killer.who = who; killer.weapon = weapon; killer.at = performance.now(); if (/^\d+$/.test(who)) lastAttacker = Number(who); }
const nameOf = (who: string) => /^\d+$/.test(who) ? (remotes.get(Number(who))?.info.name ?? 'PLAYER') : who;
let killT = 0;
function killMark() { killT = 0.45; hitT = 0.3; hitEl.classList.add('kill'); buzz(15); }
// per-match personal stats for the medals screen
function endStats(players: PlayerInfo[], meId: number) {
  const me = players.find(p => p.id === meId), kills = me?.frags ?? 0, deaths = me?.deaths ?? 0, acc = mstat.shots ? Math.min(100, Math.round(100 * mstat.hits / mstat.shots)) : 0;
  const medals: string[] = [];
  if (mstat.shots >= 20 && acc >= 40) medals.push('SHARPSHOOTER');
  if (kills >= 3 && deaths === 0) medals.push('UNTOUCHABLE');
  if (announcer.bestSpree >= 5) medals.push('KILLING MACHINE');
  if (announcer.bestMulti >= 2) medals.push(announcer.bestMulti >= 3 ? 'MULTI KILLER' : 'DOUBLE KILL');
  if (announcer.gotFirstBlood) medals.push('FIRST BLOOD');
  if (mstat.pickups >= 5) medals.push('COLLECTOR');
  if (mstat.heads >= 5) medals.push('HEADHUNTER');
  if (kills >= 10 && kills >= 3 * Math.max(1, deaths)) medals.push('DOMINATOR');
  return { kills, deaths, acc, streak: announcer.bestSpree, medals };
}
function onLanded(tg: Target, dmg: number, point: THREE.Vector3, weapon: WeaponId, killed: boolean, head = false) {
  if (mstat.hitFire !== mstat.fire) { mstat.hitFire = mstat.fire; mstat.hits++; }
  hitT = 0.2; sfx.hit(dmg); if (head) { sfx.headshot(); hitT = 0.3; mstat.heads++; } damageNumber(tg, point, dmg, killed, head);
  if (killed) {
    sfx.kill(); killMark();
    if (!net.online) feed(myName === 'PLAYER' ? 'YOU' : myName, weapon, (tg as Bot).name ?? 'BOT', true, false, false);
  }
}
// damage numbers: small DOM pool, projected from the 3D hit point each frame; pellets on the same target merge into one number
interface DmgNum { el: HTMLDivElement; pos: THREE.Vector3; t: number; v: number; tg: Target | null }
const dmgNums: DmgNum[] = [];
for (let i = 0; i < 10; i++) { const el = document.createElement('div'); el.className = 'dmg'; document.getElementById('hud')!.appendChild(el); dmgNums.push({ el, pos: new THREE.Vector3(), t: 0, v: 0, tg: null }); }
function damageNumber(tg: Target, p: THREE.Vector3, dmg: number, killed: boolean, head = false) {
  let d = dmgNums.find(n => n.tg === tg && n.t > 0.55);                     // still fresh: add pellets/ticks together
  if (!d) { d = dmgNums.reduce((a, b) => (a.t < b.t ? a : b)); d.v = 0; d.pos.copy(p); d.pos.x += (Math.random() - .5) * 0.3; }
  d.tg = tg; d.v += dmg; d.t = 0.8; d.el.textContent = (head ? '✦ ' : '') + String(Math.round(d.v)); d.el.classList.toggle('big', killed || d.v >= 50); d.el.classList.toggle('head', head);
}
const _np = new THREE.Vector3();
function drawNumbers(dt: number) {
  for (const n of dmgNums) {
    if (n.t <= 0) { if (n.el.style.opacity !== '0') n.el.style.opacity = '0'; continue; }
    n.t -= dt; n.pos.y += dt * 0.9;
    _np.copy(n.pos).project(camera);
    if (_np.z > 1) { n.el.style.opacity = '0'; continue; }
    const x = (_np.x * 0.5 + 0.5) * innerWidth, y = (-_np.y * 0.5 + 0.5) * innerHeight;
    const pop = n.t > 0.68 ? 1 + (n.t - 0.68) * 4 : 1;
    n.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${pop.toFixed(2)})`;
    n.el.style.opacity = String(Math.min(1, n.t * 2.5));
  }
}
// kill feed (top right): KILLER [WEAPON] VICTIM, newest on top, fades after 5 s
const feedEl = document.getElementById('feed')!;
function feed(killerName: string, weapon: WeaponId | '', victim: string, meKiller: boolean, meVictim: boolean, selfOrWorld: boolean) {
  recentKills.push(performance.now());
  const row = document.createElement('div'); row.className = 'kf' + (meKiller ? ' mek' : '') + (meVictim ? ' mev' : '');
  const esc = (t: string) => t.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
  const wcol = weapon ? '#' + WEAPON_DEFS[weapon].color.toString(16).padStart(6, '0') : '#9ab';
  const tag = `<i style="--w:${wcol}">${weapon ? WEAPON_DEFS[weapon].name : 'VOID'}</i>`;
  row.innerHTML = selfOrWorld || !killerName ? `${tag}<b class="v">${esc(victim)}</b>${weapon ? '<span>SELF</span>' : ''}` : `<b class="k">${esc(killerName)}</b>${tag}<b class="v">${esc(victim)}</b>`;
  feedEl.prepend(row);
  while (feedEl.children.length > 5) feedEl.lastElementChild!.remove();
  setTimeout(() => { row.classList.add('out'); setTimeout(() => row.remove(), 500); }, 5000);
}

// ---- HUD ----
let shownPadTime = 0;
// ---- boosters (power-ups) ----
const boost: Record<'haste' | 'overdrive' | 'regen' | 'jump', number> = { haste: 0, overdrive: 0, regen: 0, jump: 0 };
const boostEl = document.getElementById('boosts')!, auraEl = document.getElementById('aura')!;
function grantBooster(id: BoosterId) {
  const b = BOOSTERS[id]; sfx.powerup(); say(b.name);
  if (id === 'mega') player.health = Math.min(200, player.health + 100);
  else if (id === 'shield') player.armor = Math.min(200, player.armor + 100);
  else boost[id] = b.secs;
}
function clearBoosters() { boost.haste = boost.overdrive = boost.regen = boost.jump = 0; }
let boostHtml = '', decayAcc = 0;
function boosterTick(dt: number) {
  for (const k of Object.keys(boost) as (keyof typeof boost)[]) if (boost[k] > 0) { boost[k] = Math.max(0, boost[k] - dt); if (boost[k] === 0) say(`${BOOSTERS[k].name} WORE OFF`); }
  player.speedMul = boost.haste > 0 ? 1.35 : 1; player.jumpMul = boost.jump > 0 ? 1.45 : 1; combat.dmgMul = boost.overdrive > 0 ? 2 : 1;
  if (boost.regen > 0 && player.health < 150) player.health = Math.min(150, player.health + 8 * dt);
  // MEGA HEALTH / HEAVY ARMOR above 100 drain back down, one point per second
  decayAcc += dt; if (decayAcc >= 1) { decayAcc -= 1; if (player.health > 100 && boost.regen <= 0) player.health -= 1; if (player.armor > 100) player.armor -= 1; }
  const html = (Object.keys(boost) as (keyof typeof boost)[]).filter(k => boost[k] > 0)
    .map(k => `<div class="bst" style="--c:#${BOOSTERS[k].color.toString(16).padStart(6, '0')}"><b>${BOOSTERS[k].name}</b><i>${Math.ceil(boost[k])}</i></div>`).join('');
  if (html !== boostHtml) { boostHtml = html; boostEl.innerHTML = html; }
  const aura = boost.overdrive > 0 ? 'od' : boost.haste > 0 ? 'hs' : '';
  if (auraEl.dataset.k !== aura) { auraEl.dataset.k = aura; auraEl.className = aura; }
  // teleporters: turn the view to the exit direction, flash and burst at both ends
  if (player.teleported) {
    const t = player.teleported; player.teleported = null;
    yaw = t.yaw; combat.teleportFx(new THREE.Vector3(...t.from)); combat.teleportFx(new THREE.Vector3(...t.to)); sfx.teleport();
    tpFlash = 0.35;
  }
  if (tpFlash > 0) { tpFlash = Math.max(0, tpFlash - dt); tpEl.style.opacity = String(tpFlash * 2.2); }
}
let tpFlash = 0; const tpEl = document.createElement('div'); tpEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(circle,#e8d8ff,#7a3aff88 60%,transparent);opacity:0;z-index:3'; document.body.appendChild(tpEl);

function hud() {
  speedEl.firstChild!.textContent = String(Math.round(player.speedXZ * 32));
  speedEl.style.color = player.speedXZ > 15 ? '#ff9a3c' : player.speedXZ > 11 ? '#ffe14a' : '#7ffff0';
  const hp = Math.max(0, Math.ceil(player.health)), ar = Math.max(0, Math.ceil(player.armor));
  if (hp !== shownHp) {
    shownHp = hp; hpEl.textContent = String(hp); hpFill.style.width = `${Math.min(100, hp)}%`; hpOver.style.width = `${Math.max(0, Math.min(100, hp - 100))}%`;
    const low = hp > 0 && hp <= 25; vitalsEl.classList.toggle('low', low); document.body.classList.toggle('lowhp', low);
  }
  if (ar !== shownAr) { shownAr = ar; arEl.textContent = String(ar); arFill.style.width = `${Math.min(100, ar)}%`; arOver.style.width = `${Math.max(0, Math.min(100, ar - 100))}%`; }
  if (pnameEl.textContent !== myName) pnameEl.textContent = myName;
  if (dmgDirT > 0) { dmgDirT = Math.max(0, dmgDirT - 1 / 60); dmgDirEl.style.opacity = String(Math.min(1, dmgDirT * 1.6)); }
  flashEl.style.opacity = String(Math.max(0, player.hurtT) * 1.6);
  if (player.lastPadTime !== shownPadTime) { shownPadTime = player.lastPadTime; say(player.lastPad); sfx.jumpPad(); }
  refreshBar();
}

const _dir = new THREE.Vector3(), _eye = new THREE.Vector3();
let reloadFx = false;
function tryFire(dt: number) {
  loadout.cooldown -= dt; loadout.tick(dt);
  if (loadout.reloading && !reloadFx) { reloadFx = true; sfx.reload(); vm.reloadDip(PISTOL_RELOAD); } else if (!loadout.reloading) reloadFx = false;
  touch?.setReload(vm.current === 'pistol' && loadout.mag < PISTOL_MAG);
  const id = vm.current; const st = WEAPON_DEFS[id].stats;
  if (!(firing() && locked()) || loadout.cooldown > 0 || vm.switching || matchState === 'ended' || deadT > 0) return;
  if (!loadout.canFire(id)) { loadout.cooldown = 0.3; if (id !== 'blade' && id !== 'pistol') vm.select(loadout.best()); return; }
  // keep the real fire rate even when a frame is slow: carry leftover time and fire up to 3 shots this frame
  for (let n = 0; n < 3 && loadout.cooldown <= 0 && loadout.canFire(id); n++) {
    const iv = loadoutRules.insta ? 0.8 : st.interval;
    loadout.cooldown = Math.max(loadout.cooldown, -iv) + iv; loadout.consume(id);
    doFire(id);
  }
}
function doFire(id: Parameters<typeof combat.fire>[0]) {
  mstat.shots++; mstat.fire++;
  _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  _eye.set(player.x, player.y + player.eye, player.z);
  camera.updateMatrixWorld(true);
  const muzzle = camera.localToWorld(vm.muzzleCamSpace());
  combat.fire(id, _eye, _dir, muzzle);
  if (net.online) { const w = rayWorld(_eye, _dir, 200); const aim = _eye.clone().addScaledVector(_dir, w ? w.t : 200); const dd = aim.sub(muzzle).normalize(); net.send({ t: 'fire', w: id, o: [muzzle.x, muzzle.y, muzzle.z], d: [dd.x, dd.y, dd.z], k: combat.dmgMul }); }
  vm.fire(id); crossKick = 1; sfx.shot(id);
}

// ---- other fighters' footsteps: heard from their direction, fading with distance (no sound beyond ~24 m) ----
const stepTrack = new WeakMap<object, { x: number; y: number; z: number; a: number }>();
function otherSteps() {
  const everyone: { pos: THREE.Vector3; alive: boolean }[] = [...bots, ...remotes.values()];
  for (const t of everyone) {
    if (!t.alive) continue;
    const s = stepTrack.get(t) ?? { x: t.pos.x, y: t.pos.y, z: t.pos.z, a: 0 };
    const d = Math.hypot(t.pos.x - s.x, t.pos.z - s.z), dy = Math.abs(t.pos.y - s.y);
    if (d > 0.02 && d < 1.5 && dy < 0.06) s.a += d; else if (d >= 1.5) s.a = 0;
    s.x = t.pos.x; s.y = t.pos.y; s.z = t.pos.z;
    if (s.a > 2.3) { s.a = 0; const dist = camera.position.distanceTo(t.pos); if (dist < 24) sfx.step(0.8, Math.min(1, 10 / (dist + 3)) * 0.8, panOf(t.pos), true); }
    stepTrack.set(t, s);
  }
}

// ---- feel: footsteps, jump and landing sounds, heartbeat, death cam ----
let stepDist = 0, heartT = 0, lastJumps = 0;
function feelTick(dt: number) {
  if (deadT > 0) {                                           // death cam: sink to the floor, tilt, and look at whoever got us
    if (eliminated) {                                        // out of lives: orbit a fighter who is still alive
      const t = bots.find(b => b.alive)?.pos ?? [...remotes.values()].find(r => r.alive)?.pos;
      if (t) { const a = performance.now() / 4500; camera.position.set(t.x + Math.sin(a) * 6, t.y + 3.4, t.z + Math.cos(a) * 6); camera.lookAt(t.x, t.y + 1.2, t.z); camera.rotation.z = 0; }
      return;
    }
    deadFor += dt; deadT -= dt;
    const k = Math.min(1, deadFor / 0.45);
    camera.position.y = player.y + player.eye + (0.3 - player.eye) * k; camera.rotation.z = 0.55 * k;
    if (deathLook) {
      const want = Math.atan2(-(deathLook.x - player.x), -(deathLook.z - player.z)); let d = want - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 5); camera.rotation.y = yaw;
    }
    if (deadT <= 0) respawnNow();
    return;
  }
  if (player.jumps !== lastJumps) { lastJumps = player.jumps; sfx.jump(); stepDist = 0; }
  if (player.landSpeed > 0) { sfx.land(player.landSpeed); player.landSpeed = 0; stepDist = 1.2; }
  if (player.grounded && !player.crouched && player.speedXZ > 2.2) { stepDist += player.speedXZ * dt; if (stepDist > 2.3) { stepDist = 0; sfx.step(Math.min(1, player.speedXZ / 10)); } }
  else if (!player.grounded) stepDist = 1.4;
  if (player.health > 0 && player.health <= 25 && matchState !== 'ended') { heartT -= dt; if (heartT <= 0) { sfx.heartbeat(1 - player.health / 25); heartT = 0.6 + (player.health / 25) * 0.55; } } else heartT = 0;
}

// ---- loop (fixed 120 Hz sim) ----
const DT = 1 / 120;
let acc = 0, last = performance.now();
function frame(now: number) {
  // phones: cap at ~60 fps. 90/120 Hz screens otherwise double the GPU work, the phone heats up and throttles into stutter.
  if (TOUCH && now - last < (saverOn ? 31 : 15.5)) { requestAnimationFrame(frame); return; }      // 60 fps, or 30 in battery saver
  const frameMs = now - last;
  acc += Math.min(0.1, frameMs / 1000); last = now;
  const frozen = paused();
  { // gyro aim (touch): added on top of the drag-to-look
    const g = gyro.take(touchPlaying && !frozen && (gyro.mode === 'on' || (gyro.mode === 'fire' && firing())));
    if (g.yaw || g.pitch) {
      yaw += g.yaw; pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch + g.pitch));
      lookDX -= g.yaw * 260; lookDY -= g.pitch * 260;             // weapon sway follows the motion
    }
  }
  if (frozen) acc = 0;
  const pd = gpad.poll();                                          // controller: sticks, triggers and buttons
  if (pd.connected) {
    if (pd.anyInput && !padPlaying && !menu.open && mode !== 'title') padPlaying = true;
    if (pd.start) { if (menu.open) { if (menu.screen === 'pause' || menu.screen === 'lobby') resume(); } else if (padPlaying) openPause(); }
    padFire = padPlaying && pd.fire; if (padPlaying && pd.scores !== padScores) { padScores = pd.scores; if (pd.scores) pushView(); menu.showScores(pd.scores); }
    if (padPlaying && locked() && !frozen) {
      const dt = Math.min(0.05, frameMs / 1000), r = 3.3 * aimSens * assistFriction;
      yaw -= pd.lookX * r * dt; pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch - pd.lookY * r * 0.8 * dt)); lookDX += pd.lookX * 40 * dt; lookDY += pd.lookY * 40 * dt;
      if (pd.jump) jumpQueued = true;
      if (pd.next) vm.select(loadout.step(vm.target, 1)); if (pd.prev) vm.select(loadout.step(vm.target, -1));
      if (pd.reload && vm.current === 'pistol') loadout.startReload();
    }
  } else { padPlaying = false; padFire = false; }
  if (!frozen) aimAssist(Math.min(0.05, frameMs / 1000));
  applySaver(menu.settings.saver);
  { // mini-map: redrawn ten times a second
    const on = menu.settings.radar && mode !== 'title' && !frozen;
    if (on !== radarShown) { radarShown = on; radar.show(on); document.body.classList.toggle('radar', on); }
    radarT -= frameMs; if (on && radarT <= 0) { radarT = 100; radar.update(radarFrame()); }
  }
  while (acc >= DT) {
    const input: Input = {
      forward: deadT > 0 ? 0 : Math.max(-1, Math.min(1, (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0) + (touch?.forward ?? 0) + (padPlaying ? pd.forward : 0))),
      side: deadT > 0 ? 0 : Math.max(-1, Math.min(1, (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + (touch?.side ?? 0) + (padPlaying ? pd.side : 0))),
      jumpPressed: jumpQueued && deadT <= 0, crouch: deadT <= 0 && (keys.has('KeyC') || keys.has('ControlLeft') || !!touch?.crouch || (padPlaying && pd.crouch)), yaw,
    };
    jumpQueued = false;
    liftSys.update((Date.now() + timeOffset) / 1000, riders());
    player.step(input, DT);
    acc -= DT;
  }
  const sh = combat.shake;
  camera.position.set(player.x + (Math.random() - .5) * sh * 0.06, player.y + player.eye + (Math.random() - .5) * sh * 0.06, player.z);
  camera.rotation.set(pitch + (Math.random() - .5) * sh * 0.02, yaw, 0);
  player.hurtT = Math.max(0, player.hurtT - frameMs / 1000);
  if (!frozen) feelTick(Math.min(0.05, frameMs / 1000));
  if (!frozen) otherSteps();
  tryFire(Math.min(0.05, frameMs / 1000));
  for (const got of frozen || deadT > 0 ? [] : pickupSys.update(now / 1000, player, d => d.kind === 'weapon' ? loadout.wouldAccept(d.id) : d.kind === 'booster' ? (d.id === 'mega' ? player.health < 200 : d.id === 'shield' ? player.armor < 200 : true) : d.kind === 'health' ? player.health < 100 : player.armor < 100)) {
    mstat.pickups++;
    (got.kind === 'weapon' ? sfx.weapon : got.kind === 'health' ? sfx.health : got.kind === 'armor' ? sfx.armor : sfx.pickup)();
    if (got.kind === 'weapon') { const r = loadout.give(got.id); say(r === 'new' ? `${WEAPON_DEFS[got.id].name} ACQUIRED` : `+${WEAPON_DEFS[got.id].stats.ammoPickup} ${WEAPON_DEFS[got.id].name} AMMO`); if (r === 'new') vm.select(got.id); }
    else if (got.kind === 'health') { player.health = Math.min(100, player.health + got.amount); say(`+${got.amount} HEALTH`); }
    else if (got.kind === 'booster') { grantBooster(got.id); }
    else { player.armor = Math.min(100, player.armor + got.amount); say(`+${got.amount} ARMOR`); }
  }
  { botCtxPlayer.pos.set(player.x, deadT > 0 ? -999 : player.y, player.z); botCtxPlayer.eye.set(player.x, deadT > 0 ? -999 : player.y + player.eye, player.z);
    if (botPrevSet) botVel.set(player.x - botPrev.x, 0, player.z - botPrev.z).multiplyScalar(1 / Math.max(0.008, frameMs / 1000)); botPrev.set(player.x, player.y, player.z); botPrevSet = true;
    const bdt = Math.min(0.05, frameMs / 1000);
    if (!(window as any).__freezeBots && !frozen) for (const b of bots) b.update(bdt);
    for (const r of remotes.values()) r.update(bdt);
    hitT = Math.max(0, hitT - bdt); hitEl.style.opacity = String(Math.min(1, hitT * 8));
    hitEl.style.setProperty('--hs', (1 + Math.max(0, hitT - 0.12) * 4).toFixed(2));
    if (killT > 0) { killT -= bdt; if (killT <= 0) hitEl.classList.remove('kill'); }
    drawNumbers(bdt);
    // dynamic crosshair: opens up with speed, air time and each shot, then settles back
    crossKick = Math.max(0, crossKick - bdt * 5);
    const gap = (TOUCH ? 3.5 : 6) + Math.min(TOUCH ? 3 : 6, player.speedXZ * 0.35) + (player.grounded ? 0 : (TOUCH ? 1.5 : 3)) + crossKick * (TOUCH ? 4 : 7);
    if (Math.abs(gap - crossGap) > 0.25) { crossGap += (gap - crossGap) * Math.min(1, bdt * 18); crossEl.style.setProperty('--g', `${crossGap.toFixed(1)}px`); }
    crossEl.classList.toggle('dry', !loadout.canFire(vm.current)); if (crossEl.dataset.w !== vm.current) crossEl.dataset.w = vm.current;
    if (vm.target !== lastWeapon) { if (lastWeapon) sfx.swap(); lastWeapon = vm.target; }
    net.sendState(bdt, { p: [player.x, player.y, player.z], yaw, pitch, w: vm.current, hp: player.health, dead: deadT > 0 });
    netTick(bdt); matchTick(bdt); hillTick(bdt); ctfTick(now / 1000); if (!frozen) boosterTick(bdt); }
  combat.setViewHeight(renderer.domElement.height);
  if (!(window as any).__freeze && !frozen) combat.update(Math.min(0.05, frameMs / 1000));
  stars.update(camera, renderer.getPixelRatio());
  if (!Q.liveSky || PLAIN_SKY) { const a = now / 1000 * 0.004; scene.backgroundRotation.y = a; stars.mesh.rotation.y = a; }
  if (Q.liveSky && !PLAIN_SKY) sky.update(now / 1000, camera);
  blackoutTick((Date.now() + timeOffset) / 1000);
  world.update(now / 1000, (Date.now() + timeOffset) / 1000); surround.update(now / 1000);
  updateFireLights(camera.position, now / 1000, Math.min(0.05, frameMs / 1000)); embers.update(camera.position, now / 1000);
  hud();
  if (composer) composer.render(); else renderer.render(scene, camera);
  vm.update(Math.min(0.05, frameMs / 1000), { speed: player.speedXZ, grounded: player.grounded, lookDX, lookDY, spinning: firing() && locked() && vm.current === 'nailer', beam: firing() && locked() && vm.current === 'arc' }); lookDX = lookDY = 0;
  { const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(vm.scene, vm.camera); renderer.autoClear = ac; }
  adapt(frameMs);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// dev/test hook
(window as any).__game = { bots, net, remotes, menu, stars, scene, sfx, Music, music, announcer, feed, riders, nav: navMod, voice, get ts() { return ts; }, myTeam, flagSt: () => flagSt, teamOfOwner, soloKill, grantBooster, boost, liftSys, lifts: __lifts, level: { torches: levelTorches, pads: levelPads, teleporters: levelTeleporters, boxes, pickups: levelPickups, spawns: levelSpawns }, get mode() { return mode; }, get matchState() { return matchState; }, scores: () => board(), doFire, player, camera, vm, loadout, combat, pickupSys, targets, say, die, renderer, world, Q, get scale() { return renderScale; }, setLook: (y: number, p: number) => { yaw = y; pitch = p; }, PM, fx: (lvl: number) => setFireQuality(lvl, TOUCH), modeDbg: { blackoutAt: (t: number) => { blackoutTick(t); return sceneLights.map(x => +(x.l.intensity / x.base).toFixed(2)); }, get eliminated() { return eliminated; }, get hillText() { return hillText; }, get cfg() { return cfg; }, get deadT() { return deadT; }, score }, assistTest: { get yaw() { return yaw; }, get pitch() { return pitch; }, get friction() { return assistFriction; }, setFire: (v: boolean) => { mouseDown = v; }, step: (dt: number) => aimAssist(dt) } };
