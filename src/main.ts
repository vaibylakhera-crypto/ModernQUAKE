import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky, Stars, SKY_PRESETS } from './sky';
import { World } from './world';
import { Arena } from './arena';
import { kitOptions } from './kit';
import { getQuality } from './quality';
import { Player, PM, Input } from './player';
import { boxes } from './level';
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
import { Gyro } from './gyro';
import { WeaponId } from './weapons';

const Q = getQuality();
const MAP = new URLSearchParams(location.search).get('map') === 'void' ? 'void' : 'boreal';
const SKYP = SKY_PRESETS[MAP];
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
scene.fog = STYLE === 'kit' ? new THREE.FogExp2(0x05070f, 0.0025) : new THREE.FogExp2(0x060405, 0.0075);   // depth cue: far platforms sink into the void

const surround = buildSurround(); if (MAP === 'boreal' && !PLAIN_SKY) scene.add(surround.group);
const world = STYLE === 'kit' ? new World(Q) : new Arena(Q);
scene.add(world.group);
world.build();

// lighting: aurora-tinted fill + planet key light (cheap: 1 hemisphere + 2 directional, no shadows)
if (STYLE === 'kit') {
  scene.add(new THREE.HemisphereLight(0x8fdcff, 0x3a2a78, Q.pbr ? 1.4 : 2.6));
  scene.add(new THREE.AmbientLight(0x6070a0, Q.pbr ? 0.2 : 0.7));
} else {
  // alien fortress: dim, warm from above, near-black from below, faint sickly-green bounce
  scene.add(new THREE.HemisphereLight(0xd8c4a8, 0x141016, Q.pbr ? 1.2 : 2.0));
  scene.add(new THREE.AmbientLight(0x3a4a40, Q.pbr ? 0.25 : 0.6));
}
const key = new THREE.DirectionalLight(STYLE === 'kit' ? 0xffe2c0 : 0xffc890, Q.pbr ? 3.2 : 2.4);
key.position.copy(sky.sunDir).multiplyScalar(100); scene.add(key);
const rim = new THREE.DirectionalLight(STYLE === 'kit' ? 0x7a8cff : 0x5a6a90, Q.pbr ? 1.6 : 1.0); rim.position.set(-40, 20, 60); scene.add(rim);

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
  const med = document.getElementById('medal'); if (med) med.textContent = `${Math.round(1000 / avg)} FPS · ${Q.tier.toUpperCase()} · RES ${Math.round(renderScale * 100)}%`;
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
if (new URLSearchParams(location.search).has('fps')) document.body.classList.add('fps');
let touchPlaying = false;
const locked = () => touchPlaying || document.pointerLockElement === renderer.domElement;
let lockedAt = 0, lockExitAt = 0;
function resume() {
  sfx.unlock();                    // audio may only start from a user gesture (iOS)
  if (mode === 'title') return;
  menu.hide(); menu.showScores(false);
  if (TOUCH) { goFullscreen(); touchPlaying = true; touch?.show(true); return; }
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
  if (e.code === 'Tab') { e.preventDefault(); if (locked()) { pushView(); menu.showScores(true); } return; }
  if (e.repeat) return;           // holding space never auto-hops
  keys.add(e.code);
  if (e.code === 'Space') jumpQueued = true;
  if (e.code === 'KeyR') { die('DIED'); }
});
addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Tab') menu.showScores(false); });
let touch: TouchControls | null = null;
if (TOUCH) {
  document.body.classList.add('touch');
  touch = new TouchControls({
    look(dx, dy) {
      if (!touchPlaying) return;
      const k = 0.0058 * aimSens; yaw -= dx * k; pitch -= dy * k; lookDX += dx * 0.6; lookDY += dy * 0.6;
      pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    },
    jump() { jumpQueued = true; },
    nextWeapon() { vm.select(loadout.step(vm.target, 1)); },
    pause() { touchPlaying = false; touch!.show(false); openPause(); },
  });
  touch.show(false);
  document.addEventListener('visibilitychange', () => { if (document.hidden && touchPlaying) { touchPlaying = false; touch!.show(false); openPause(); } });
}
const gyro = new Gyro();
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
  hurt(dmg, dir, weapon, owner) { blame(owner, weapon); player.knock(dir.x * 1.5, 0.3, dir.z * 1.5); sfx.hurt(); if (player.takeDamage(dmg)) die('DIED'); },
  landed(tg, dmg, point, weapon, killed) { onLanded(tg, dmg, point, weapon, killed); },
  boom(pos, size) { sfx.boom(size, pos.distanceTo(camera.position)); },
  explode(pos, radius, dmg, knock, fromPlayer, weapon, owner) {
    // splash on the local player (rocket jumps!)
    const c = new THREE.Vector3(player.x, player.y + 0.9, player.z); const d = c.distanceTo(pos);
    if (d >= radius) return;
    const f = 1 - d / radius; const dir = c.sub(pos).normalize(); dir.y += 0.3; dir.normalize();
    player.knock(dir.x * knock * f, dir.y * knock * f * 1.15, dir.z * knock * f);
    const self = fromPlayer ? 0.4 : 1;
    blame(fromPlayer ? 'SELF' : owner, weapon); if (!fromPlayer) sfx.hurt();
    if (player.takeDamage(dmg * f * self)) die('EXPLODED');
  },
});
const pickupSys = new Pickups(scene);
const hitEl = document.getElementById('hit')!; let hitT = 0;
const crossEl = document.getElementById('cross')!; let crossKick = 0, crossGap = 6;
// ───────────── sessions: title screen · solo match · online room ─────────────
const qs = new URLSearchParams(location.search);
let roomCode = (qs.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
const savedName = (() => { try { return (localStorage.getItem('mq-name') || '').toUpperCase(); } catch { return ''; } })();
let myName = ((qs.get('name') || savedName || 'PLAYER').toUpperCase().replace(/[^\w \-]/g, '').slice(0, 14)) || 'PLAYER';
let mode: 'title' | 'solo' | 'online' = 'title';
const intParam = (k: string, d: number) => { const v = Number(qs.get(k)); return qs.has(k) && Number.isFinite(v) ? v : d; };
let cfg: MatchCfg = { map: MAP, bots: intParam('bots', 3), skill: intParam('skill', 1), frag: intParam('frag', 20), time: intParam('time', 10), open: true };
let matchState: 'lobby' | 'playing' | 'ended' = 'playing';
let endsAt = 0, timeOffset = 0, hostId = 0;
const isHost = () => mode === 'online' && net.online && hostId === net.id;
/** solo pauses while the menu is open; online the world keeps going */
const paused = () => mode !== 'online' && menu.open;

// ---- bots (solo: local; online: run by the host, everyone else sees them as remote players) ----
const bots: Bot[] = [];
const botVel = new THREE.Vector3(), botPrev = new THREE.Vector3(); let botPrevSet = false;
const botCtxPlayer: BotTarget = { pos: new THREE.Vector3(), eye: new THREE.Vector3(), vel: botVel };
const humanTargets = new Map<number, BotTarget>();
const zeroVel = new THREE.Vector3();
const botCtx: BotCtx = {
  player: botCtxPlayer,
  target(b) {
    if (mode !== 'online') return botCtxPlayer;
    let best = botCtxPlayer, bd = Math.hypot(botCtxPlayer.pos.x - b.pos.x, botCtxPlayer.pos.z - b.pos.z);
    for (const t of humanTargets.values()) { const d = Math.hypot(t.pos.x - b.pos.x, t.pos.z - b.pos.z); if (d < bd) { bd = d; best = t; } }
    return best;
  },
  fire(id, o, d, dmg, sp, owner, bot) {
    combat.fireEnemy(id, o, d, dmg, sp, owner); sfx.shot(id, Math.min(0.8, 9 / (o.distanceTo(camera.position) + 4)));
    if (mode === 'online' && bot.netId) net.send({ t: 'fire', as: bot.netId, w: id, o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] });
  },
  onKilled(b, by, w) {
    if (mode === 'online') { net.send({ t: 'botdead', id: b.netId, by: by ? Number(by) : net.id, w }); return; }
    if (matchState === 'playing') { score('me').frags++; score(b.name).deaths++; }
    say(`YOU FRAGGED ${b.name}`); refreshFrags(); checkSoloEnd();
  },
  onHit() { /* feedback comes from combat.landed */ },
};
let wantBots: BotDef[] = [];
const sameBot = (b: Bot, d: BotDef) => b.name === d.name && b.netId === (d.netId ?? 0);
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
const w0 = (b: Bot): BotDef => ({ name: b.name, weapon: b.weaponId, color: 0, netId: b.netId });

// ---- scores ----
const soloScore = new Map<string, { frags: number; deaths: number }>();
function score(k: string) { let s = soloScore.get(k); if (!s) soloScore.set(k, (s = { frags: 0, deaths: 0 })); return s; }
let scoreboard: PlayerInfo[] = [];
/** the current scoreboard (solo is built locally; online comes from the server) */
function board(): PlayerInfo[] {
  if (mode === 'online') return scoreboard;
  const me = score('me');
  return [{ id: 0, name: myName, color: 0xffd24a, frags: me.frags, deaths: me.deaths },
    ...bots.map((b, i) => ({ id: i + 1, name: b.name, color: BOT_ROSTER.find(r => r.name === b.name)?.color ?? 0xffffff, frags: score(b.name).frags, deaths: score(b.name).deaths, bot: true }))];
}
const myId = () => mode === 'online' ? net.id : 0;
function refreshFrags() { const me = board().find(p => p.id === myId()); fragsEl.textContent = `FRAGS ${me ? me.frags : frags}`; }

// ---- match flow ----
const nowServer = () => Date.now() + timeOffset;
const remaining = () => endsAt ? Math.max(0, (endsAt - nowServer()) / 1000) : -1;
function startSoloMatch() {
  soloScore.clear(); matchState = 'playing'; endsAt = cfg.time ? Date.now() + cfg.time * 60000 : 0; timeOffset = 0;
  player.respawn(); yaw = player.yaw; pitch = 0; loadout.reset(); vm.show('pistol'); lastBar = '';
  for (const b of bots) b.respawn(); menu.hideEnd(); refreshFrags(); say('FIGHT!'); pushView();
}
let soloEndTimer = 0;
function checkSoloEnd() {
  if (mode !== 'solo' || matchState !== 'playing') return;
  const b = board(), lead = Math.max(...b.map(p => p.frags));
  if ((cfg.frag && lead >= cfg.frag) || (endsAt && Date.now() >= endsAt)) {
    matchState = 'ended';
    const sorted = [...b].sort((x, y) => y.frags - x.frags || x.deaths - y.deaths);
    menu.showEnd(sorted, sorted[0]?.id ?? -1, 0, 10); sfx.kill();
    clearTimeout(soloEndTimer); soloEndTimer = window.setTimeout(() => { if (mode === 'solo') startSoloMatch(); }, 10000);
    pushView();
  }
}
const matchEl = document.getElementById('matchbar')!;
let matchAcc = 0;
function matchTick(dt: number) {
  matchAcc += dt; if (matchAcc < 0.25) return; matchAcc = 0;
  if (mode === 'solo') checkSoloEnd();
  let text = '';
  if (mode !== 'title') {
    const r = remaining(), clock = r >= 0 ? `<b>${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}</b>` : '';
    if (matchState === 'lobby') text = isHost() ? 'WARMUP · OPEN MENU TO START' : 'WARMUP · WAITING FOR HOST';
    else if (matchState === 'ended') text = 'MATCH OVER';
    else text = [clock, cfg.frag ? `FIRST TO ${cfg.frag}` : ''].filter(Boolean).join(' · ');
  }
  if (matchEl.innerHTML !== text) matchEl.innerHTML = text;
  if (menu.open) pushView();
}
function pushView() {
  const v: LobbyView = {
    mode: mode === 'online' ? 'online' : 'solo', room: roomCode, link: `${location.origin}/?room=${roomCode}`,
    meId: myId(), hostId, isHost: isHost(), cfg, state: matchState, remaining: remaining(), players: board(),
    status: mode === 'online' ? (net.online ? '' : netState === 'full' ? 'ROOM IS FULL' : netState === 'connecting' ? 'CONNECTING…' : 'DISCONNECTED') : '',
  };
  menu.setView(v);
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
  const defs: BotDef[] = scoreboard.filter(p => p.bot).map(p => ({ name: p.name, weapon: p.weapon ?? 'plasma', color: p.color, netId: p.id }));
  if (isHost()) { for (const d of defs) dropRemote(d.netId!); setBots(defs, cfg.skill); }
  else { setBots([], cfg.skill); for (const p of scoreboard) if (p.bot) addRemote(p); }
  for (const id of [...remotes.keys()]) if (!scoreboard.some(p => p.id === id)) dropRemote(id);
}
function drawNet() { netEl.innerHTML = mode === 'online' ? `ROOM <b>${roomCode}</b>${net.online ? '' : ` · ${netState.toUpperCase()}`}` : ''; }
function reloadInto(params: Record<string, string>) { location.search = new URLSearchParams(params).toString(); }
function applyRoom(info: RoomInfo) {
  if (info.cfg.map !== MAP) { reloadInto({ room: roomCode, name: myName, map: info.cfg.map }); return false; }
  cfg = info.cfg; matchState = info.state; timeOffset = info.now - Date.now(); endsAt = info.endsAt; hostId = info.host;
  scoreboard = info.players; for (const p of scoreboard) if (!p.bot) addRemote(p);
  syncNetBots(); refreshFrags(); drawNet(); pushView(); return true;
}
let localKillAt = 0;
const net = new Net({
  status(st) { netState = st; drawNet(); pushView(); if (st === 'offline' && mode === 'online') say('DISCONNECTED'); },
  welcome(_id, info) { if (applyRoom(info)) say(hostId === net.id ? 'ROOM CREATED' : 'CONNECTED'); },
  join(p, host) { scoreboard = [...scoreboard.filter(x => x.id !== p.id), p]; hostId = host; if (!p.bot) { addRemote(p); say(`${p.name} JOINED`); } pushView(); },
  leave(id) { const r = remotes.get(id); if (r) say(`${r.info.name} LEFT`); dropRemote(id); scoreboard = scoreboard.filter(p => p.id !== id); pushView(); },
  room(kind, info) {
    if (!applyRoom(info)) return;
    if (kind === 'start') { menu.hideEnd(); player.respawn(); yaw = player.yaw; pitch = 0; loadout.reset(); vm.show('pistol'); lastBar = ''; for (const b of bots) b.respawn(); say('FIGHT!'); sfx.kill(); }
    if (kind === 'lobby') { menu.hideEnd(); say('WARMUP'); }
  },
  end(b, winner, _why, next) { matchState = 'ended'; scoreboard = b; endsAt = 0; menu.showEnd(b, winner, net.id, next); refreshFrags(); pushView(); },
  host(id) { hostId = id; syncNetBots(); if (id === net.id) say('YOU ARE NOW THE HOST'); pushView(); },
  bots(list) { if (isHost()) return; for (const b of list) remotes.get(b.id)?.setState(b.p, b.yaw, b.w, b.hp, b.dead); },
  bothit(from, to, dmg, dir, kind) {
    if (!isHost()) return; const b = bots.find(x => x.netId === to);
    b?.hit(dmg, b.pos, dirV(dir), kind, String(from), kind in WEAPON_DEFS ? kind : '');
  },
  state(id, m) { remotes.get(id)?.setState(m.p, m.yaw, m.w, m.hp, !!m.dead); },
  fire(id, m) {
    const r = remotes.get(id); r?.flashFire(); const o = dirV(m.o);
    combat.remoteShot(m.w, o, dirV(m.d), String(id)); sfx.shot(m.w, Math.min(0.85, 10 / (o.distanceTo(camera.position) + 4)));
  },
  hit(from, dmg, dir, kind) { blame(String(from), (kind in WEAPON_DEFS ? kind : 'pistol') as WeaponId); const d = dirV(dir); player.knock(d.x * 1.5, 0.3, d.z * 1.5); sfx.hurt(); if (player.takeDamage(dmg)) die('DIED'); },
  killed(id, by, b, w) {
    scoreboard = b; refreshFrags(); pushView();
    const v = b.find(p => p.id === id), k = b.find(p => p.id === by);
    if (!v) return;
    const weapon = (w && w in WEAPON_DEFS ? w : '') as WeaponId | '';
    feed(k && k !== v ? k.name : '', weapon, v.name, k ? k.id === net.id : false, v.id === net.id, !k || k === v);
    if (id !== net.id) {
      if (k && by === net.id) { say(`YOU FRAGGED ${v.name}`); if (performance.now() - localKillAt > 800) { sfx.kill(); killMark(); } }
      else say(k ? `${k.name} FRAGGED ${v.name}` : `${v.name} DIED`);
    }
  },
});
// host: other players' rockets / plasma / nails can hit the host's bots
combat.hooks.foreignTargets = owner => (isHost() && owner && Number(owner) < 1000 ? bots : []);
combat.hooks.foreignHit = (tg, dmg, owner, weapon) => (tg as Bot).hit(dmg, tg.pos, new THREE.Vector3(), weapon, owner, weapon);
let botSnapAcc = 0;
function netTick(dt: number) {
  if (mode !== 'online') return;
  // remote humans as bot targets (host)
  if (isHost()) {
    for (const [id, r] of remotes) {
      if (r.info.bot) continue;
      let t = humanTargets.get(id); if (!t) humanTargets.set(id, (t = { pos: new THREE.Vector3(), eye: new THREE.Vector3(), vel: zeroVel }));
      t.pos.copy(r.pos); t.eye.set(r.pos.x, r.pos.y + 1.6, r.pos.z);
      if (!r.alive) t.pos.y = -999;               // dead players are not hunted
    }
    botSnapAcc += dt;
    if (botSnapAcc >= 0.066 && bots.length) {
      botSnapAcc = 0; const R = (v: number) => Math.round(v * 100) / 100;
      net.send({ t: 'bots', l: bots.map(b => ({ id: b.netId, p: [R(b.pos.x), R(b.pos.y), R(b.pos.z)], yaw: Math.round((b.yaw - Math.PI) * 1000) / 1000, w: b.weaponId, hp: Math.round(b.healthPct), dead: !b.alive })) });
    }
  }
}

// ---- entering sessions (from the menu) ----
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const cfgParams = (c: MatchCfg) => ({ map: c.map, bots: String(c.bots), skill: String(c.skill), frag: String(c.frag), time: String(c.time) });
function enterSolo(c: MatchCfg, name: string) {
  myName = name;
  if (c.map !== MAP) { reloadInto({ mode: 'solo', name, ...cfgParams(c) }); return; }
  if (mode === 'online') { reloadInto({ mode: 'solo', name, ...cfgParams(c) }); return; }
  mode = 'solo'; cfg = c; menu.sessionActive = true;
  history.replaceState(null, '', `?${new URLSearchParams({ mode: 'solo', ...cfgParams(c) })}`);
  setBots(BOT_ROSTER.slice(0, c.bots).map(d => ({ ...d })), c.skill);
  startSoloMatch(); resume();
}
function enterOnline(code: string, name: string, create?: MatchCfg) {
  myName = name; roomCode = code;
  if ((create && create.map !== MAP) || mode === 'solo') { reloadInto({ room: code, name, map: create?.map ?? MAP, ...(create ? { cfg: JSON.stringify(create) } : {}) }); return; }
  mode = 'online'; menu.sessionActive = true; matchState = 'lobby';
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
  hostStop() { if (isHost()) net.send({ t: 'stop' }); },
  restartSolo() { startSoloMatch(); resume(); },
  async fetchGames(): Promise<OpenGame[]> { const r = await fetch(`${Net.httpBase()}/api/rooms`, { cache: 'no-store' }); return r.ok ? r.json() : []; },
  gyro: {
    state: () => ({ mode: gyro.mode, sens: gyro.sens, invertY: gyro.invertY, supported: Gyro.supported, seen: gyro.seen }),
    async setMode(m) { gyro.setMode(m); if (m === 'off') return true; return (await gyro.requestPermission()) || gyro.seen; },
    setSens: v => gyro.setSens(v), setInvert: v => gyro.setInvert(v),
  },
  settingsChanged(st) { aimSens = st.sens; sfx.setVolume(st.vol); if (st.name) myName = st.name.slice(0, 14); },
});
sfx.setVolume(menu.settings.vol);
// ---- what to show on load ----
if (roomCode) {
  const nm = qs.get('name') || savedName;
  if (nm) { let create: MatchCfg | undefined; try { create = qs.get('cfg') ? JSON.parse(qs.get('cfg')!) : undefined; } catch { /* ignore */ }
    enterOnline(roomCode, nm.toUpperCase().slice(0, 14), create); }
  else { try { localStorage.setItem('mq-room', roomCode); } catch { /* ignore */ } menu.show('join'); }
} else if (qs.get('mode') === 'solo') {
  mode = 'solo'; menu.sessionActive = true;
  setBots(BOT_ROSTER.slice(0, Math.max(0, Math.min(7, cfg.bots))).map(d => ({ ...d })), cfg.skill);
  startSoloMatch(); menu.show('pause');
} else menu.show('title');

function die(why: string) {
  const recent = performance.now() - killer.at < 6000;
  const by = why === 'FELL' || !recent ? '' : killer.who, weapon: WeaponId | '' = why === 'FELL' || !recent ? '' : killer.weapon;
  if (net.online) net.send({ t: 'dead', by: by && by !== 'SELF' ? Number(by) || 0 : 0, w: weapon });
  else {
    feed(by === 'SELF' || !by ? '' : nameOf(by), weapon, myName, false, true, by === 'SELF' || !by);
    if (mode === 'solo' && matchState === 'playing') { score('me').deaths++; if (by && by !== 'SELF') score(by).frags++; checkSoloEnd(); }
  }
  killer.who = ''; sfx.died(); refreshFrags();
  say(why === 'EXPLODED' ? 'YOU BLEW UP' : why === 'FELL' ? 'YOU FELL' : 'YOU DIED'); player.respawn(); yaw = player.yaw; pitch = 0;
  loadout.reset(); vm.show('pistol'); lastBar = '';
}
player.onVoid = () => die('FELL');

// ---- hit feedback: hit marker, damage numbers, kill feed ----
const killer = { who: '', weapon: 'pistol' as WeaponId, at: 0 };
/** remember who last hurt us (bot name, remote id as string, or 'SELF') so the death can be credited */
function blame(who: string, weapon: WeaponId) { if (!who) return; killer.who = who; killer.weapon = weapon; killer.at = performance.now(); if (/^\d+$/.test(who)) lastAttacker = Number(who); }
const nameOf = (who: string) => /^\d+$/.test(who) ? (remotes.get(Number(who))?.info.name ?? 'PLAYER') : who;
let killT = 0;
function killMark() { killT = 0.45; hitT = 0.3; hitEl.classList.add('kill'); }
function onLanded(tg: Target, dmg: number, point: THREE.Vector3, weapon: WeaponId, killed: boolean) {
  hitT = 0.2; sfx.hit(dmg); damageNumber(tg, point, dmg, killed);
  if (killed) {
    sfx.kill(); killMark();
    if (!net.online) feed(myName === 'PLAYER' ? 'YOU' : myName, weapon, (tg as Bot).name ?? 'BOT', true, false, false);
  }
}
// damage numbers: small DOM pool, projected from the 3D hit point each frame; pellets on the same target merge into one number
interface DmgNum { el: HTMLDivElement; pos: THREE.Vector3; t: number; v: number; tg: Target | null }
const dmgNums: DmgNum[] = [];
for (let i = 0; i < 10; i++) { const el = document.createElement('div'); el.className = 'dmg'; document.getElementById('hud')!.appendChild(el); dmgNums.push({ el, pos: new THREE.Vector3(), t: 0, v: 0, tg: null }); }
function damageNumber(tg: Target, p: THREE.Vector3, dmg: number, killed: boolean) {
  let d = dmgNums.find(n => n.tg === tg && n.t > 0.55);                     // still fresh: add pellets/ticks together
  if (!d) { d = dmgNums.reduce((a, b) => (a.t < b.t ? a : b)); d.v = 0; d.pos.copy(p); d.pos.x += (Math.random() - .5) * 0.3; }
  d.tg = tg; d.v += dmg; d.t = 0.8; d.el.textContent = String(Math.round(d.v)); d.el.classList.toggle('big', killed || d.v >= 50);
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
function hud() {
  speedEl.firstChild!.textContent = String(Math.round(player.speedXZ * 32));
  speedEl.style.color = player.speedXZ > 15 ? '#ff9a3c' : player.speedXZ > 11 ? '#ffe14a' : '#7ffff0';
  hpEl.firstChild!.textContent = String(Math.max(0, Math.ceil(player.health))); hpEl.style.color = player.health > 50 ? '#ffd24a' : player.health > 25 ? '#ff9a3c' : '#ff4040';
  arEl.firstChild!.textContent = String(Math.ceil(player.armor));
  flashEl.style.opacity = String(Math.max(0, player.hurtT) * 1.6);
  if (player.lastPadTime !== shownPadTime) { shownPadTime = player.lastPadTime; say(player.lastPad); sfx.jumpPad(); }
  refreshBar();
}

const _dir = new THREE.Vector3(), _eye = new THREE.Vector3();
function tryFire(dt: number) {
  loadout.cooldown -= dt;
  const id = vm.current; const st = WEAPON_DEFS[id].stats;
  if (!(firing() && locked()) || loadout.cooldown > 0 || vm.switching || matchState === 'ended') return;
  if (!loadout.canFire(id)) { loadout.cooldown = 0.3; if (id !== 'blade' && id !== 'pistol') vm.select(loadout.best()); return; }
  // keep the real fire rate even when a frame is slow: carry leftover time and fire up to 3 shots this frame
  for (let n = 0; n < 3 && loadout.cooldown <= 0 && loadout.canFire(id); n++) {
    loadout.cooldown = Math.max(loadout.cooldown, -st.interval) + st.interval; loadout.consume(id);
    doFire(id);
  }
}
function doFire(id: Parameters<typeof combat.fire>[0]) {
  _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  _eye.set(player.x, player.y + player.eye, player.z);
  camera.updateMatrixWorld(true);
  const muzzle = camera.localToWorld(vm.muzzleCamSpace());
  combat.fire(id, _eye, _dir, muzzle);
  if (net.online) { const w = rayWorld(_eye, _dir, 200); const aim = _eye.clone().addScaledVector(_dir, w ? w.t : 200); const dd = aim.sub(muzzle).normalize(); net.send({ t: 'fire', w: id, o: [muzzle.x, muzzle.y, muzzle.z], d: [dd.x, dd.y, dd.z] }); }
  vm.fire(id); crossKick = 1; sfx.shot(id);
}

// ---- loop (fixed 120 Hz sim) ----
const DT = 1 / 120;
let acc = 0, last = performance.now();
function frame(now: number) {
  // phones: cap at ~60 fps. 90/120 Hz screens otherwise double the GPU work, the phone heats up and throttles into stutter.
  if (TOUCH && now - last < 15.5) { requestAnimationFrame(frame); return; }
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
  for (const got of frozen ? [] : pickupSys.update(now / 1000, player, d => d.kind === 'weapon' ? loadout.wouldAccept(d.id) : d.kind === 'health' ? player.health < 100 : player.armor < 100)) {
    sfx.pickup();
    if (got.kind === 'weapon') { const r = loadout.give(got.id); say(r === 'new' ? `${WEAPON_DEFS[got.id].name} ACQUIRED` : `+${WEAPON_DEFS[got.id].stats.ammoPickup} ${WEAPON_DEFS[got.id].name} AMMO`); if (r === 'new') vm.select(got.id); }
    else if (got.kind === 'health') { player.health = Math.min(100, player.health + got.amount); say(`+${got.amount} HEALTH`); }
    else { player.armor = Math.min(100, player.armor + got.amount); say(`+${got.amount} ARMOR`); }
  }
  { botCtxPlayer.pos.set(player.x, player.y, player.z); botCtxPlayer.eye.set(player.x, player.y + player.eye, player.z);
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
    const gap = 6 + Math.min(6, player.speedXZ * 0.35) + (player.grounded ? 0 : 3) + crossKick * 7;
    if (Math.abs(gap - crossGap) > 0.25) { crossGap += (gap - crossGap) * Math.min(1, bdt * 18); crossEl.style.setProperty('--g', `${crossGap.toFixed(1)}px`); }
    crossEl.classList.toggle('dry', !loadout.canFire(vm.current));
    net.sendState(bdt, { p: [player.x, player.y, player.z], yaw, pitch, w: vm.current, hp: player.health, dead: false });
    netTick(bdt); matchTick(bdt); }
  combat.setViewHeight(renderer.domElement.height);
  if (!(window as any).__freeze && !frozen) combat.update(Math.min(0.05, frameMs / 1000));
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
(window as any).__game = { bots, net, remotes, menu, get mode() { return mode; }, get matchState() { return matchState; }, scores: () => board(), doFire, player, camera, vm, loadout, combat, pickupSys, targets, say, die, renderer, world, Q, get scale() { return renderScale; }, setLook: (y: number, p: number) => { yaw = y; pitch = p; }, PM };
