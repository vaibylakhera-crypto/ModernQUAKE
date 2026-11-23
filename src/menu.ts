// Menus: welcome · home · setup (solo / host) · join · lobby · pause · settings · results.
// Pure DOM; main.ts supplies the hooks and pushes room / scoreboard updates in.
import type { MatchCfg, PlayerInfo } from './net';
import type { GyroMode } from './gyro';
import type { VoiceMode } from './comms';
import { MAP_LIST, MAPS } from './level';
import { TEAMS, MODES, modeName } from './teams';

export type Screen = 'welcome' | 'title' | 'setup' | 'join' | 'lobby' | 'pause' | 'settings';
export interface OpenGame { room: string; host: string; players: number; bots: number; map: string; mode?: string; state: string; frag: number; time: number }
export interface MenuHooks {
  touch: boolean;
  resume(): void;
  startSolo(cfg: MatchCfg, name: string): void;
  host(cfg: MatchCfg, name: string): void;
  join(code: string, name: string): void;
  leave(): void;
  hostCfg(cfg: MatchCfg): void;
  hostStart(): void;
  hostStop(): void;
  pickTeam(team: number): void;
  restartSolo(): void;
  fetchGames(): Promise<OpenGame[]>;
  settingsChanged(s: Settings): void;
  showGuide(): void;
  gyro: {
    state(): { mode: GyroMode; sens: number; invertY: boolean; supported: boolean; seen: boolean };
    setMode(m: GyroMode): Promise<boolean>;
    setSens(v: number): void; setInvert(v: boolean): void;
  };
  voice: {
    state(): { mode: VoiceMode; volume: number; supported: boolean; error: string; on: boolean };
    setMode(m: VoiceMode): void; setVolume(v: number): void; test(): Promise<boolean>;
  };
  chatChannel?: unknown;
}
export interface Settings { name: string; sens: number; vol: number; quality: 'low' | 'med' | 'high'; ctl: number; cta: number; vibe: boolean }
export interface LobbyView {
  mode: 'solo' | 'online';
  room: string; link: string; meId: number; hostId: number; isHost: boolean;
  cfg: MatchCfg; state: 'lobby' | 'playing' | 'ended'; remaining: number;
  players: PlayerInfo[]; status: string; ts: { 1: number; 2: number }; myTeam: number;
}

const SKILLS = ['EASY', 'NORMAL', 'HARD'];
const FRAGS = [0, 10, 20, 30, 50];
const CAPS = [1, 2, 3, 5, 10];
const TIMES = [0, 5, 10, 15, 20];
const esc = (t: string) => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const hasFlags = (map: string) => !!MAPS[map]?.flags;
const DEFAULT_CFG: MatchCfg = { map: 'foundry', mode: 'ffa', bots: 3, skill: 1, frag: 20, caps: 3, time: 10, open: true };

// ───────── map previews: a top-down sketch drawn from the level data ─────────
const previews = new Map<string, string>();
function mapPreview(id: string): string {
  const cached = previews.get(id); if (cached) return cached;
  const m = MAPS[id]; if (!m) return '';
  const W = 260, H = 160, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!;
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const b of m.boxes) { x0 = Math.min(x0, b.min[0]); x1 = Math.max(x1, b.max[0]); z0 = Math.min(z0, b.min[2]); z1 = Math.max(z1, b.max[2]); }
  const pad = 12, s = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (z1 - z0));
  const ox = (W - (x1 - x0) * s) / 2 - x0 * s, oz = (H - (z1 - z0) * s) / 2 - z0 * s;
  const X = (x: number) => ox + x * s, Z = (z: number) => oz + z * s;
  const lamp = hex(m.theme.lamp);
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0d0a09'); bg.addColorStop(1, '#070504'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.04)'; for (let i = 0; i < W; i += 20) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, H); g.stroke(); }
  const walk = m.boxes.filter(b => !['block', 'light', 'pillar', 'crates'].includes(b.kind ?? '')).sort((a, b) => a.max[1] - b.max[1]);
  const maxY = Math.max(1, ...walk.map(b => b.max[1]));
  for (const b of walk) {
    const k = 0.22 + 0.55 * (b.max[1] / maxY), r = Math.round(40 + 120 * k), gr = Math.round(36 + 96 * k), bl = Math.round(34 + 70 * k);
    g.fillStyle = `rgb(${r},${gr},${bl})`; g.fillRect(X(b.min[0]), Z(b.min[2]), (b.max[0] - b.min[0]) * s, (b.max[2] - b.min[2]) * s);
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.strokeRect(X(b.min[0]) + 0.5, Z(b.min[2]) + 0.5, (b.max[0] - b.min[0]) * s - 1, (b.max[2] - b.min[2]) * s - 1);
  }
  for (const b of m.boxes) {                                              // walls and cover on top
    if (b.kind === 'block' && b.max[1] - b.min[1] > 3) { g.fillStyle = '#6a5a4c'; g.fillRect(X(b.min[0]), Z(b.min[2]), Math.max(2, (b.max[0] - b.min[0]) * s), Math.max(2, (b.max[2] - b.min[2]) * s)); }
    else if (b.kind === 'pillar' || b.kind === 'crates') { g.fillStyle = '#2a2420'; g.fillRect(X(b.min[0]), Z(b.min[2]), Math.max(2, (b.max[0] - b.min[0]) * s), Math.max(2, (b.max[2] - b.min[2]) * s)); }
  }
  const dot = (x: number, z: number, col: string, r = 2.6) => { g.fillStyle = col; g.beginPath(); g.arc(X(x), Z(z), r, 0, Math.PI * 2); g.fill(); };
  for (const p of m.pads) dot(p.pos[0], p.pos[2], p.kind === 'jump' ? '#35d0ff' : '#7dff6a', 3);
  for (const t of m.teleporters) { g.strokeStyle = '#c28bff'; g.lineWidth = 1.6; g.beginPath(); g.arc(X(t.pos[0]), Z(t.pos[2]), 3.6, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 1;
  for (const l of m.lifts ?? []) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.6; g.strokeRect(X(l.x0), Z(l.z0), (l.x1 - l.x0) * s, (l.z1 - l.z0) * s); g.lineWidth = 1; }
  for (const p of m.pickups) dot(p.pos[0], p.pos[2], p.kind === 'weapon' ? '#ffb02e' : p.kind === 'booster' ? '#ff4ad8' : p.kind === 'health' ? '#5dff7a' : '#7a9cff', 1.8);
  if (m.flags) for (const [pos, col] of [[m.flags.red, TEAMS[1].css], [m.flags.blue, TEAMS[2].css]] as [number[], string][]) { g.fillStyle = col; g.fillRect(X(pos[0]) - 4, Z(pos[2]) - 4, 8, 8); g.strokeStyle = '#fff'; g.strokeRect(X(pos[0]) - 4, Z(pos[2]) - 4, 8, 8); }
  g.fillStyle = lamp; g.globalAlpha = 0.9; g.fillRect(0, H - 3, W, 3); g.globalAlpha = 1;
  const url = c.toDataURL('image/png'); previews.set(id, url); return url;
}
const mapTags = (id: string) => {
  const m = MAPS[id]; const sealed = m.boxes.some(b => b.kind === 'block' && b.min[1] >= 10);
  return [sealed ? 'SEALED' : 'OPEN SKY', m.lifts?.length ? `${m.lifts.length} LIFTS` : '', m.teleporters.length ? `${m.teleporters.length} TELEPORTS` : '', m.flags ? 'CTF' : ''].filter(Boolean);
};

const CSS = `
#start{cursor:default !important;background:radial-gradient(ellipse at 50% 20%,rgba(46,22,10,.5),rgba(0,0,0,.86)) !important;backdrop-filter:blur(5px)}
#start.wall{background:linear-gradient(180deg,rgba(0,0,0,.2),rgba(0,0,0,.66)),url(/menu-bg.webp) center/cover no-repeat !important;backdrop-filter:none}
@media (max-width:1300px){#start.wall{background:linear-gradient(180deg,rgba(0,0,0,.2),rgba(0,0,0,.66)),url(/menu-bg-m.webp) center/cover no-repeat !important}}
#menu{width:min(760px,calc(100vw - 24px));max-height:calc(100dvh - 12px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:4px 2px 14px;box-sizing:border-box;scrollbar-width:thin;scrollbar-color:#e0782a55 transparent}
#menu *{box-sizing:border-box}
.m-logo{text-align:center;margin:4px 0 0;font-size:clamp(26px,min(6.2vw,9vh),58px);white-space:nowrap;font-weight:800;letter-spacing:.1em;line-height:1;background:linear-gradient(180deg,#ffe0b8,#e0782a 55%,#7a2a10);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 2px 0 #000)}
.m-sub{text-align:center;font-size:11px;letter-spacing:.4em;color:#c9a888;opacity:.7;margin-bottom:14px}
.m-top{display:flex;align-items:center;gap:10px;margin:0 0 10px}
.m-back{appearance:none;width:38px;height:38px;border-radius:50%;border:1px solid #ffffff2a;background:#150e0aa8;color:#f3e3d0;font-size:18px;cursor:pointer;flex:none}
.m-back:hover{border-color:#e0782a}
.m-title{font-size:22px;letter-spacing:.22em;font-weight:800;color:#f3e3d0;flex:1}
.m-h{font-size:12px;letter-spacing:.32em;color:#e0a060;margin:16px 0 8px;font-weight:700;display:flex;align-items:center;gap:8px}
.m-h::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,#e0782a55,transparent)}
.m-col{display:flex;flex-direction:column;gap:9px}
.m-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.m-btn{appearance:none;border:1px solid #e0782a88;background:linear-gradient(180deg,#2a1a12,#160d09);color:#f3e3d0;font:700 16px "Rajdhani","Segoe UI",system-ui,sans-serif;letter-spacing:.22em;padding:13px 18px;border-radius:8px;cursor:pointer;text-align:center;box-shadow:inset 0 1px 0 #ffffff14,0 2px 0 #000;-webkit-tap-highlight-color:transparent}
.m-btn:hover,.m-btn:focus-visible{border-color:#ffb070;background:linear-gradient(180deg,#3a2216,#1e110a);outline:none}
.m-btn:active{transform:translateY(1px)}
.m-btn.pri{background:linear-gradient(180deg,#f08a3a,#a84816);color:#140804;border-color:#ffc090;box-shadow:0 0 22px #e0782a44,0 2px 0 #000}
.m-btn.pri:hover{background:linear-gradient(180deg,#ff9a4a,#b8521a)}
.m-btn.ghost{background:transparent;border-color:#ffffff22;color:#c9b6a2}
.m-btn.small{padding:8px 12px;font-size:13px}
.m-btn[disabled]{opacity:.4;pointer-events:none}
.m-seg{display:flex;border:1px solid #ffffff22;border-radius:8px;overflow:hidden;flex-wrap:wrap;background:#0d0907}
.m-seg button{flex:1;min-width:48px;appearance:none;border:0;border-right:1px solid #ffffff14;background:transparent;color:#bba48e;font:700 14px "Rajdhani","Segoe UI",system-ui,sans-serif;letter-spacing:.1em;padding:10px 6px;cursor:pointer}
.m-seg button:last-child{border-right:0}
.m-seg button.on{background:#e0782a;color:#140804}
.m-seg button[disabled]{opacity:.45;pointer-events:none}
.m-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.m-field label{font-size:11px;letter-spacing:.28em;color:#a89480;font-weight:700}
.m-input{background:#0d0907;border:1px solid #ffffff26;color:#f3e3d0;padding:12px;border-radius:8px;font:700 18px "Rajdhani","Segoe UI",system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;width:100%}
.m-input:focus{outline:none;border-color:#e0782a}
.m-step{display:flex;align-items:center;gap:10px}
.m-step b{min-width:44px;text-align:center;font-size:24px;color:#f3e3d0}
.m-note{font-size:13px;color:#a89480;letter-spacing:.05em;line-height:1.45}
.m-status{text-align:center;font-weight:700;letter-spacing:.22em;font-size:13px;color:#e0a060;margin:6px 0}
.m-range{width:100%;accent-color:#e0782a}
.m-help{font-size:12px;color:#8a7a6c;letter-spacing:.06em;line-height:1.5;text-align:center;margin-top:12px}
.m-help kbd{border:1px solid #ffffff30;border-radius:3px;padding:0 5px;margin:0 1px;font-size:11px}
.m-chip{display:flex;justify-content:center;align-items:center;gap:8px;margin:0 auto 14px;width:max-content;max-width:100%;padding:6px 14px;border:1px solid #ffffff22;border-radius:20px;background:#0d0907aa;font-size:12px;letter-spacing:.2em;color:#a89480;cursor:pointer}
.m-chip b{color:#ffd9a8;letter-spacing:.15em} .m-chip span{color:#e0782a;font-weight:700}
.m-chip:hover{border-color:#e0782a}
/* home tiles */
.m-tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.m-tile{appearance:none;text-align:left;border:1px solid #ffffff1c;background:linear-gradient(155deg,rgba(40,24,14,.85),rgba(12,8,6,.85));color:#f3e3d0;border-radius:12px;padding:14px 16px;cursor:pointer;min-height:84px;font-family:inherit;-webkit-tap-highlight-color:transparent;transition:transform .12s,border-color .12s}
.m-tile:hover{border-color:#e0782a;transform:translateY(-1px)}
.m-tile b{display:block;font-size:18px;letter-spacing:.2em;margin-bottom:3px}
.m-tile span{font-size:12px;color:#b8a48e;letter-spacing:.05em;line-height:1.35;display:block}
.m-tile.pri{border-color:#e0782a;background:linear-gradient(155deg,rgba(150,70,22,.9),rgba(40,18,8,.9))}
.m-tile .ic{font-size:20px;float:right;opacity:.85}
@media (max-height:480px){.m-tile{min-height:66px;padding:9px 12px}.m-tile span{display:none}.m-tile b{font-size:16px;margin:0}.m-sub{margin-bottom:8px}}
/* mode + map cards */
.m-modes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.mm{position:relative;border:1px solid #ffffff1f;border-radius:12px;padding:12px;cursor:pointer;background:linear-gradient(160deg,#1c130d,#0b0807);min-height:96px}
.mm b{display:block;letter-spacing:.14em;color:#f3e3d0;font-size:14px;margin:2px 0 4px}
.mm span{font-size:11.5px;color:#a89480;line-height:1.3;display:block}
.mm .ic{font-size:22px;display:block}
.mm.on{border-color:#e0782a;box-shadow:0 0 0 1px #e0782a inset,0 0 18px #e0782a33}
.mm.dis{opacity:.45;pointer-events:none}
.mm em{position:absolute;top:8px;right:8px;font-style:normal;font-size:9px;letter-spacing:.14em;color:#ffb070;border:1px solid #e0782a88;border-radius:4px;padding:1px 5px}
.m-maps{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:8px}
.mc{border:1px solid #ffffff1f;border-radius:12px;overflow:hidden;cursor:pointer;background:#0b0807}
.mc img{display:block;width:100%;aspect-ratio:260/160;object-fit:cover;background:#0a0807}
.mc div{padding:8px 10px 9px}
.mc b{display:block;letter-spacing:.14em;color:#f3e3d0;font-size:13.5px}
.mc span{display:block;font-size:11px;color:#a89480;line-height:1.3;margin:2px 0 5px}
.mc em{font-style:normal;font-size:9.5px;letter-spacing:.12em;color:#e0a060}
.mc.on{border-color:#e0782a;box-shadow:0 0 0 1px #e0782a inset,0 0 18px #e0782a33}
.mc.dis{opacity:.4}
@media (max-width:560px){.m-modes{grid-template-columns:1fr}.mm{min-height:0;display:grid;grid-template-columns:auto 1fr;column-gap:12px;align-items:center}.mm .ic{grid-row:span 2}}
.m-sticky{position:sticky;bottom:0;margin-top:14px;padding:10px 0 2px;background:linear-gradient(180deg,transparent,rgba(8,5,4,.92) 30%)}
/* lobby */
.m-code{font-size:46px;font-weight:800;letter-spacing:.3em;text-align:center;color:#ffd9a8;margin:0;user-select:text;-webkit-user-select:text;line-height:1.1}
.m-lsum{display:flex;gap:12px;align-items:center;padding:8px;border:1px solid #ffffff1c;border-radius:12px;background:#0d0907bb;margin:10px 0}
.m-lsum img{width:96px;border-radius:8px;flex:none}
.m-lsum b{display:block;letter-spacing:.16em;font-size:15px;color:#f3e3d0} .m-lsum span{font-size:12px;color:#a89480;letter-spacing:.06em}
.m-teams{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.m-team{border-radius:12px;border:1px solid #ffffff1c;background:#0d0907bb;overflow:hidden}
.m-team h4{margin:0;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;letter-spacing:.22em;font-size:13px;background:linear-gradient(90deg,var(--c),transparent);color:#fff}
.m-team .list{padding:6px;display:flex;flex-direction:column;gap:4px;min-height:48px}
.m-team .jt{margin:0 6px 8px}
.m-list{display:flex;flex-direction:column;gap:4px}
.m-pl{display:grid;grid-template-columns:22px 1fr 44px 44px;align-items:center;gap:6px;padding:7px 10px;background:#0f0b09cc;border-left:3px solid var(--c,#888);font-weight:700;letter-spacing:.08em;font-size:14px;border-radius:4px}
.m-pl.me{background:#2a1a10cc}
.m-pl i{font-style:normal;font-size:9.5px;letter-spacing:.15em;color:#a89480;margin-left:6px;border:1px solid #ffffff30;padding:0 4px;border-radius:3px}
.m-pl .n{text-align:right;color:#f3e3d0} .m-pl .d{text-align:right;color:#8a7a6c}
.m-pl.head{background:none;border-left-color:transparent;font-size:10.5px;color:#8a7a6c;letter-spacing:.25em;padding:2px 10px}
.m-pl.lobbyrow{grid-template-columns:1fr auto}
.m-game{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:10px 12px;background:#120c09;border:1px solid #ffffff1a;border-radius:10px;cursor:pointer}
.m-game:hover{border-color:#e0782a}
.m-game b{letter-spacing:.2em;color:#ffd9a8;font-size:18px} .m-game span{font-size:12px;color:#a89480;letter-spacing:.06em}
.m-game em{grid-row:span 2;align-self:center;font-style:normal;font-weight:700;color:#e0782a;letter-spacing:.15em}
.m-badge{display:inline-block;font-size:10px;letter-spacing:.14em;border:1px solid #e0782a88;color:#ffb070;border-radius:4px;padding:0 5px;margin-right:6px}
/* overlays */
#endscreen{position:fixed;inset:0;z-index:6;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.62);pointer-events:none}
#endscreen .box{width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 20px);overflow:auto;padding:18px;background:#0c0806ee;border:1px solid #e0782a66;border-radius:12px;pointer-events:auto}
#endscreen h2{margin:0 0 4px;text-align:center;font-size:30px;letter-spacing:.2em;color:#ffd9a8}
#scoreov{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:4;width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 20px);overflow:auto;padding:14px;background:#0c0806e6;border:1px solid #ffffff22;border-radius:12px;display:none;pointer-events:none}
.m-tscore{display:flex;justify-content:center;gap:18px;font-size:26px;font-weight:800;letter-spacing:.12em;margin:4px 0 10px}
#matchbar{position:absolute;top:14px;left:50%;transform:translateX(-50%);font-weight:700;letter-spacing:.22em;font-size:15px;color:#f3e3d0;text-shadow:0 0 6px #000;white-space:nowrap;text-align:center;line-height:1.25}
#matchbar b{color:#ffb070} #matchbar small{font-size:.72em;letter-spacing:.18em;opacity:.85} .tr{color:#ff6a58} .tb{color:#5aa8ff}
body.touch #matchbar{top:calc(56px + env(safe-area-inset-top));font-size:12px}
body.touch .m-btn{padding:12px 14px;font-size:15px}
@media (max-height:520px){.m-btn{padding:10px 14px;font-size:14px}.m-title{font-size:18px}.m-code{font-size:34px}.m-field{margin-bottom:8px}.m-seg button{padding:8px 4px}.mm,.mc div{padding:8px}.m-h{margin:12px 0 6px}}
`;

export class Menu {
  readonly root: HTMLElement; private el: HTMLElement;
  screen: Screen = 'title';
  private stack: Screen[] = [];
  private setupFor: 'solo' | 'host' = 'solo';
  private view: LobbyView | null = null;
  private lastKey = '';
  private draft: MatchCfg;
  settings: Settings;
  private gamesTimer = 0; private games: OpenGame[] | null = null;
  private endEl: HTMLElement; private scoreEl: HTMLElement;
  sessionActive = false;
  afterWelcome: Screen = 'title';
  private gyroNote = ''; private voiceNote = '';

  constructor(private h: MenuHooks) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.root = document.getElementById('start')!; this.el = document.getElementById('menu')!;
    this.settings = {
      name: load('mq-name', ''), sens: Number(load('mq-sens', '1')) || 1, vol: Number(load('mq-vol', '0.7')),
      quality: load('mq-quality', 'low') as Settings['quality'],
      ctl: Number(load('mq-ctl', '1')) || 1, cta: Number(load('mq-cta', '0.9')) || 0.9, vibe: load('mq-vibe', '1') !== '0',
    };
    try { this.draft = { ...DEFAULT_CFG, ...JSON.parse(load('mq-cfg', '{}')) }; } catch { this.draft = { ...DEFAULT_CFG }; }
    if (!MAPS[this.draft.map]) this.draft.map = DEFAULT_CFG.map;
    this.endEl = document.createElement('div'); this.endEl.id = 'endscreen'; document.body.appendChild(this.endEl);
    this.scoreEl = document.createElement('div'); this.scoreEl.id = 'scoreov'; document.body.appendChild(this.scoreEl);
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'click', 'mousedown', 'keydown'] as const) this.root.addEventListener(ev, e => e.stopPropagation());
    this.el.addEventListener('click', e => this.onClick(e));
    this.el.addEventListener('input', e => this.onInput(e));
  }

  get open() { return this.root.style.display !== 'none'; }
  get needsName() { return !(this.settings.name || '').trim(); }
  static randomName() {
    const a = ['RUST', 'ASH', 'IRON', 'NOVA', 'GRIM', 'VOID', 'EMBER', 'HOLLOW', 'STATIC', 'COLD', 'FERAL', 'DUSK'];
    const b = ['WOLF', 'VIPER', 'RAVEN', 'GHOST', 'FANG', 'BOLT', 'MOTH', 'HOUND', 'SHADE', 'WRAITH', 'HAWK', 'TALON'];
    const r = (l: string[]) => l[Math.floor(Math.random() * l.length)];
    return `${r(a)}${r(b)}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 14);
  }
  private name() { return (this.settings.name || '').trim().toUpperCase().slice(0, 14) || 'PLAYER'; }

  show(s: Screen) {
    if (s !== this.screen && !['lobby', 'pause'].includes(s)) { if (this.screen === 'settings' || ['setup', 'join'].includes(this.screen)) { /* keep stack */ } }
    this.screen = s; this.root.style.display = 'flex'; this.root.classList.toggle('wall', !this.sessionActive); this.lastKey = ''; this.render();
    clearInterval(this.gamesTimer);
    if (s === 'join') { this.refreshGames(); this.gamesTimer = window.setInterval(() => this.refreshGames(), 3000); }
  }
  /** go to a sub-screen and remember where to come back to */
  private push(s: Screen) { this.stack.push(this.screen); this.show(s); }
  private pop() { this.show(this.stack.pop() ?? (this.sessionActive && this.view ? (this.view.mode === 'online' ? 'lobby' : 'pause') : 'title')); }
  hide() { this.root.style.display = 'none'; clearInterval(this.gamesTimer); this.stack = []; }
  setView(v: LobbyView) { this.view = v; if (this.open && (this.screen === 'lobby' || this.screen === 'pause')) this.render(true); }

  // ───────── rendering ─────────
  private render(soft = false) {
    if (soft && this.el.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text') return;
    const html: string = (this as any)['r_' + this.screen]();
    // live updates usually only move the clock: patch that line instead of rebuilding (a rebuild can swallow a tap)
    const key = html.replace(/<div class="m-status" data-o="status">[^<]*<\/div>/g, '');
    if (soft && key === this.lastKey) {
      const st = html.match(/<div class="m-status" data-o="status">([^<]*)<\/div>/), el = this.el.querySelector('[data-o="status"]');
      if (st && el && el.innerHTML !== st[1]) el.innerHTML = st[1];
      return;
    }
    this.lastKey = key; const top = this.el.scrollTop; this.el.innerHTML = html; if (soft) this.el.scrollTop = top;
  }
  private head(title: string, back = true) { return `<div class="m-top">${back ? `<button class="m-back" data-a="back" aria-label="Back">←</button>` : ''}<div class="m-title">${title}</div></div>`; }
  private help() {
    return this.h.touch
      ? `<div class="m-help">Left thumb: move · right thumb: drag to aim · hold FIRE and drag to aim while shooting · tap JUMP each hop</div>`
      : `<div class="m-help"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>SPACE</kbd> jump (tap each hop) · <kbd>C</kbd> crouch · <kbd>1</kbd>-<kbd>8</kbd>/wheel weapons · <kbd>TAB</kbd> scores · <kbd>Y</kbd> quick chat · hold <kbd>V</kbd> to talk · <kbd>ESC</kbd> menu</div>`;
  }

  private r_welcome() {
    return `<div class="m-logo">MODERNQUAKE</div><div class="m-sub">ARENA · FRAG · REPEAT</div>
      <div class="m-title" style="text-align:center;margin-top:6px">CHOOSE YOUR NAME</div>
      <div class="m-note" style="margin:6px 0 12px;text-align:center">This is what friends see in lobbies, on the scoreboard and in the kill feed. You can change it later in Settings.</div>
      <div class="m-field"><div class="m-row"><input class="m-input" style="flex:1" data-f="wname" maxlength="14" placeholder="YOUR NAME" value="${esc(this.settings.name)}"><button class="m-btn small" data-a="dice" title="Random name">🎲</button></div>
        <div class="m-note" data-o="werr" style="color:#ff8a6a;min-height:16px"></div></div>
      <div class="m-col"><button class="m-btn pri" data-a="welcome-go">CONTINUE</button></div>`;
  }
  private r_title() {
    const a = this.sessionActive;
    return `<div class="m-logo">MODERNQUAKE</div><div class="m-sub">ARENA · FRAG · REPEAT</div>
      <div class="m-chip" data-a="go-settings">PLAYING AS <b>${esc(this.name())}</b> <span>✎ CHANGE</span></div>
      <div class="m-tiles">
        ${a ? `<button class="m-tile pri" data-a="resume"><span class="ic">▶</span><b>RESUME</b><span>Back to the match</span></button>` : ''}
        <button class="m-tile ${a ? '' : 'pri'}" data-a="go-solo"><span class="ic">⚔</span><b>QUICK PLAY</b><span>Fight bots. Pick a mode, map and bot skill.</span></button>
        <button class="m-tile" data-a="go-host"><span class="ic">＋</span><b>CREATE LOBBY</b><span>Host a game and invite friends with a code.</span></button>
        <button class="m-tile" data-a="go-join"><span class="ic">⇢</span><b>JOIN LOBBY</b><span>Enter a code or pick an open game.</span></button>
        <button class="m-tile" data-a="go-settings"><span class="ic">⚙</span><b>SETTINGS</b><span>Name, controls, voice chat, graphics.</span></button>
        ${a ? `<button class="m-tile" data-a="leave"><span class="ic">✕</span><b>LEAVE MATCH</b><span>Back to the title screen.</span></button>` : ''}
      </div>${this.help()}<div class="m-help" style="opacity:.45;margin-top:4px">BUILD ${typeof __BUILD__ === 'string' ? __BUILD__ : 'DEV'}</div>`;
  }

  /** mode cards, map cards and match options. solo: CTF is online-only. editable=false shows a read-only copy (lobby, non-host) */
  private setupControls(c: MatchCfg, o: { solo: boolean; host: boolean; editable: boolean }) {
    const dis = o.editable ? '' : 'disabled';
    const icons: Record<string, string> = { ffa: '☠', tdm: '⚑', ctf: '⛿' };
    const modes = MODES.map(m => {
      const blocked = o.solo && m.id === 'ctf';
      return `<div class="mm ${c.mode === m.id ? 'on' : ''} ${blocked || !o.editable ? 'dis' : ''}" ${!blocked && o.editable ? `data-a="cfg" data-k="mode" data-v="${m.id}"` : ''}>${blocked ? '<em>ONLINE</em>' : ''}<span class="ic">${icons[m.id] ?? '•'}</span><b>${m.name}</b><span>${m.desc}</span></div>`;
    }).join('');
    const maps = MAP_LIST.map(m => {
      const noFlag = c.mode === 'ctf' && !m.flags;
      return `<div class="mc ${c.map === m.id ? 'on' : ''} ${noFlag || !o.editable ? 'dis' : ''}" ${o.editable && !noFlag ? `data-a="cfg" data-k="map" data-v="${m.id}"` : ''}><img alt="" src="${mapPreview(m.id)}"><div><b>${m.name}</b><span>${m.desc}</span><em>${mapTags(m.id).join(' · ')}</em></div></div>`;
    }).join('');
    const seg = (key: string, vals: number[], label: (v: number) => string, cur: number) =>
      `<div class="m-seg">${vals.map(v => `<button ${dis} data-a="cfg" data-k="${key}" data-v="${v}" class="${v === cur ? 'on' : ''}">${label(v)}</button>`).join('')}</div>`;
    const limit = c.mode === 'ctf'
      ? `<div class="m-field"><label>CAPTURE LIMIT</label>${seg('caps', CAPS, v => String(v), c.caps)}</div>`
      : `<div class="m-field"><label>${c.mode === 'tdm' ? 'TEAM FRAG LIMIT' : 'FRAG LIMIT'}</label>${seg('frag', FRAGS, v => (v ? String(v) : 'OFF'), c.frag)}</div>`;
    return `<div class="m-h">GAME MODE</div><div class="m-modes">${modes}</div>
      <div class="m-h">MAP</div><div class="m-maps">${maps}</div>
      <div class="m-h">MATCH</div>
      <div class="m-field"><label>BOTS ${c.mode !== 'ffa' ? '· FILL BOTH TEAMS' : ''}</label><div class="m-step"><button class="m-btn small" ${dis} data-a="cfg" data-k="bots" data-v="${Math.max(0, c.bots - 1)}">−</button><b>${c.bots}</b><button class="m-btn small" ${dis} data-a="cfg" data-k="bots" data-v="${Math.min(7, c.bots + 1)}">+</button></div></div>
      <div class="m-field"><label>BOT SKILL</label>${seg('skill', [0, 1, 2], v => SKILLS[v], c.skill)}</div>
      ${limit}
      <div class="m-field"><label>TIME LIMIT (MIN)</label>${seg('time', TIMES, v => (v ? String(v) : 'OFF'), c.time)}</div>
      ${o.host ? `<div class="m-field"><label>VISIBILITY</label><div class="m-seg"><button ${dis} data-a="cfg" data-k="open" data-v="1" class="${c.open !== false ? 'on' : ''}">LISTED IN OPEN GAMES</button><button ${dis} data-a="cfg" data-k="open" data-v="0" class="${c.open === false ? 'on' : ''}">CODE ONLY</button></div></div>` : ''}`;
  }
  private r_setup() {
    const solo = this.setupFor === 'solo';
    if (solo && this.draft.mode === 'ctf') this.draft.mode = 'tdm';
    return `${this.head(solo ? 'QUICK PLAY' : 'CREATE LOBBY')}
      ${solo ? '' : `<div class="m-note" style="margin-bottom:4px">Friends join with a code or link. Bots run on your device and fill the teams.</div>`}
      ${this.setupControls(this.draft, { solo, host: !solo, editable: true })}
      <div class="m-sticky"><button class="m-btn pri" style="width:100%" data-a="${solo ? 'start-solo' : 'create'}">${solo ? 'START MATCH' : 'CREATE LOBBY'}</button></div>`;
  }
  private games2() {
    return this.games === null ? `<div class="m-note">Looking for games…</div>` : !this.games.length ? `<div class="m-note">No open games right now. Ask a friend for their code, or create a lobby.</div>`
      : this.games.map(g => `<div class="m-game" data-a="join-room" data-v="${esc(g.room)}"><b>${esc(g.room)}</b><em>JOIN</em>
          <span><i class="m-badge">${esc((g.mode ?? 'ffa').toUpperCase())}</i>${esc(g.host)}'s game · ${g.players}/8 · ${g.bots} bots · ${esc(MAPS[g.map]?.name ?? g.map)} · ${g.state === 'playing' ? 'MATCH ON' : 'WARMUP'}</span></div>`).join('');
  }
  private r_join() {
    return `${this.head('JOIN LOBBY')}
      <div class="m-field"><label>YOUR NAME</label><input class="m-input" data-f="name" maxlength="14" value="${esc(this.settings.name)}" placeholder="NAME"></div>
      <div class="m-field"><label>LOBBY CODE</label><div class="m-row"><input class="m-input" style="flex:1" data-f="code" maxlength="12" placeholder="E.G. K7QX" value="${esc(load('mq-room', ''))}"><button class="m-btn pri" data-a="join-code">JOIN</button></div></div>
      <div class="m-h">OPEN GAMES</div><div class="m-list">${this.games2()}</div>`;
  }

  private teamName(t: number) { return TEAMS[t]?.name ?? ''; }
  private row(p: PlayerInfo, v: { meId: number; hostId?: number }, scores = true) {
    const col = p.team && TEAMS[p.team] ? TEAMS[p.team].css : hex(p.color);
    const tags = `${p.id === v.hostId ? '<i>HOST</i>' : ''}${p.bot ? '<i>BOT</i>' : ''}${p.id === v.meId ? '<i>YOU</i>' : ''}`;
    return scores ? `<div class="m-pl ${p.id === v.meId ? 'me' : ''}" style="--c:${col}"><span></span><span>${esc(p.name)}${tags}</span><span class="n">${p.frags}</span><span class="d">${p.deaths}</span></div>`
      : `<div class="m-pl lobbyrow ${p.id === v.meId ? 'me' : ''}" style="--c:${col}"><span>${esc(p.name)}${tags}</span></div>`;
  }
  /** scoreboard: ranked list (deathmatch) or two team columns with team scores */
  private scoreRows(players: PlayerInfo[], meId: number, hostId = -1, ts?: { 1: number; 2: number }, teamGame = false) {
    const sorted = [...players].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
    const head = `<div class="m-pl head"><span>#</span><span>PLAYER</span><span class="n">FRAGS</span><span class="d">DEATHS</span></div>`;
    if (!teamGame) return `<div class="m-list">${head}${sorted.map((p, i) => this.row(p, { meId, hostId }).replace('<span></span>', `<span>${i + 1}</span>`)).join('')}</div>`;
    const col = (t: 1 | 2) => `<div class="m-team" style="--c:${TEAMS[t].css}"><h4><span>${TEAMS[t].name}</span><span>${ts ? ts[t] : ''}</span></h4><div class="list">${sorted.filter(p => p.team === t).map(p => this.row(p, { meId, hostId })).join('') || '<div class="m-note" style="padding:6px">—</div>'}</div></div>`;
    return `<div class="m-teams">${col(1)}${col(2)}</div>`;
  }
  private matchLine(v: LobbyView) {
    const t = v.remaining >= 0 ? `${Math.floor(v.remaining / 60)}:${String(Math.floor(v.remaining % 60)).padStart(2, '0')} LEFT` : 'NO TIME LIMIT';
    const f = v.cfg.mode === 'ctf' ? `FIRST TO ${v.cfg.caps} CAPTURES` : v.cfg.frag ? `FIRST TO ${v.cfg.frag}` : 'NO FRAG LIMIT';
    return v.state === 'playing' ? `MATCH ON · ${t} · ${f}` : v.state === 'ended' ? 'MATCH OVER' : v.mode === 'online' ? (v.isHost ? 'WARMUP · START WHEN READY' : 'WARMUP · WAITING FOR HOST') : 'READY';
  }
  private r_lobby() {
    const v = this.view; if (!v) return `<div class="m-status">CONNECTING…</div>`;
    const m = MAPS[v.cfg.map], teamGame = v.cfg.mode !== 'ffa', canShare = typeof navigator.share === 'function';
    const vs = this.h.voice.state();
    const humans = v.players.filter(p => !p.bot), bots = v.players.filter(p => p.bot);
    let body: string;
    if (teamGame) {
      const col = (t: 1 | 2) => {
        const mine = v.myTeam === t, list = v.players.filter(p => p.team === t);
        return `<div class="m-team" style="--c:${TEAMS[t].css}"><h4><span>${TEAMS[t].name}</span><span>${list.length}</span></h4><div class="list">${list.map(p => this.row(p, { meId: v.meId, hostId: v.hostId }, false)).join('') || '<div class="m-note" style="padding:6px">empty</div>'}</div>
          ${!mine && v.state !== 'playing' ? `<button class="m-btn small jt" style="width:calc(100% - 12px)" data-a="team" data-v="${t}">JOIN ${TEAMS[t].name}</button>` : '<div style="height:8px"></div>'}</div>`;
      };
      body = `<div class="m-teams">${col(1)}${col(2)}</div>`;
    } else body = `<div class="m-list">${v.players.map(p => this.row(p, { meId: v.meId, hostId: v.hostId }, false)).join('')}</div>`;
    return `<div class="m-note" style="text-align:center;letter-spacing:.3em;margin-top:2px">LOBBY CODE</div>
      <div class="m-code">${esc(v.room)}</div>
      <div class="m-row" style="justify-content:center;margin-top:6px"><button class="m-btn small" data-a="copy">COPY INVITE LINK</button>${canShare ? `<button class="m-btn small" data-a="share">SHARE</button>` : ''}</div>
      <div class="m-lsum"><img alt="" src="${mapPreview(v.cfg.map)}"><div><b>${modeName(v.cfg.mode).toUpperCase()}</b><span>${esc(m?.name ?? v.cfg.map)} · ${v.cfg.bots} BOTS · ${SKILLS[v.cfg.skill]}</span></div></div>
      <div class="m-status" data-o="status">${this.matchLine(v)}${v.status ? ` · ${esc(v.status)}` : ''}</div>
      <div class="m-col"><button class="m-btn pri" data-a="resume">${v.state === 'lobby' ? 'WARM UP' : 'PLAY'}</button>
        ${v.isHost ? (v.state === 'playing' ? `<button class="m-btn" data-a="stop">END MATCH</button>` : `<button class="m-btn" data-a="start" ${v.state === 'ended' ? 'disabled' : ''}>START MATCH</button>`) : ''}</div>
      <div class="m-h">${teamGame ? 'TEAMS' : 'PLAYERS'} · ${humans.length}/8${bots.length ? ` + ${bots.length} BOTS` : ''}</div>${body}
      <div class="m-h">VOICE CHAT</div>
      <div class="m-note">${vs.mode === 'off' ? 'Voice is off.' : teamGame ? 'You talk to your team only.' : 'Everyone in the lobby hears you.'} ${vs.mode === 'ptt' ? 'Hold the mic button (or V) to talk.' : vs.mode === 'open' ? 'Open mic.' : ''} <a style="color:#e0782a;cursor:pointer" data-a="go-settings">Voice settings</a></div>
      <div class="m-h">MATCH SETTINGS ${v.isHost ? '' : '<span style="opacity:.6">(HOST ONLY)</span>'}</div>
      ${this.setupControls(v.cfg, { solo: false, host: true, editable: v.isHost && v.state !== 'playing' })}
      <div class="m-col" style="margin-top:12px"><button class="m-btn ghost" data-a="go-settings">SETTINGS</button><button class="m-btn ghost" data-a="leave">LEAVE LOBBY</button></div>`;
  }
  private r_pause() {
    const v = this.view;
    if (v && v.mode === 'online') return this.r_lobby();
    const teamGame = !!v && v.cfg.mode !== 'ffa';
    return `${this.head('PAUSED', false)}
      ${v ? `<div class="m-status" data-o="status">${this.matchLine(v)}</div>${teamGame ? `<div class="m-tscore"><span class="tr">RED ${v.ts[1]}</span><span class="tb">${v.ts[2]} BLUE</span></div>` : ''}${this.scoreRows(v.players, v.meId, -1, v.ts, teamGame)}` : ''}
      <div class="m-col" style="margin-top:14px"><button class="m-btn pri" data-a="resume">RESUME</button>
        <button class="m-btn" data-a="restart">RESTART MATCH</button>
        <button class="m-btn" data-a="go-solo">MATCH SETTINGS</button>
        <button class="m-btn ghost" data-a="go-settings">SETTINGS</button>
        <button class="m-btn ghost" data-a="leave">QUIT TO TITLE</button></div>${this.help()}`;
  }

  private gyroControls() {
    const g = this.h.gyro.state();
    if (!g.supported) return `<div class="m-field"><label>GYRO AIM</label><div class="m-note">This device or browser has no motion sensor access.</div></div>`;
    const b = (m: GyroMode, label: string) => `<button data-a="gyro" data-v="${m}" class="${g.mode === m ? 'on' : ''}">${label}</button>`;
    return `<div class="m-field"><label>GYRO AIM</label><div class="m-seg">${b('off', 'OFF')}${b('on', 'ON')}${b('fire', 'WHILE FIRING')}</div>
        <div class="m-note">${esc(this.gyroNote || 'Turn and tilt the phone to aim. WHILE FIRING only uses the gyro while you hold FIRE.')}</div></div>
      ${g.mode !== 'off' ? `<div class="m-field"><label>GYRO SENSITIVITY · <span data-o="gsens">${g.sens.toFixed(1)}</span></label><input class="m-range" type="range" min="0.3" max="3" step="0.1" data-f="gsens" value="${g.sens}"></div>
      <div class="m-field"><label>GYRO UP / DOWN</label><div class="m-seg"><button data-a="ginv" data-v="0" class="${!g.invertY ? 'on' : ''}">NORMAL</button><button data-a="ginv" data-v="1" class="${g.invertY ? 'on' : ''}">INVERTED</button></div></div>` : ''}`;
  }
  private voiceControls() {
    const v = this.h.voice.state();
    if (!v.supported) return `<div class="m-note">This browser cannot use voice chat.</div>`;
    const b = (m: VoiceMode, label: string) => `<button data-a="voice" data-v="${m}" class="${v.mode === m ? 'on' : ''}">${label}</button>`;
    return `<div class="m-field"><label>VOICE CHAT</label><div class="m-seg">${b('off', 'OFF')}${b('ptt', 'PUSH TO TALK')}${b('open', 'OPEN MIC')}</div>
        <div class="m-note">${esc(this.voiceNote || v.error || 'Talk to your team (team games) or everyone (deathmatch). Voice goes directly between players.')}</div></div>
      ${v.mode !== 'off' ? `<div class="m-field"><label>VOICE VOLUME · <span data-o="vvol">${Math.round(v.volume * 100)}</span>%</label><input class="m-range" type="range" min="0" max="1" step="0.05" data-f="vvol" value="${v.volume}"></div>
      <div class="m-col"><button class="m-btn small" data-a="vtest">${v.on ? 'MICROPHONE READY ✓' : 'TEST MICROPHONE'}</button></div>` : ''}`;
  }
  private r_settings() {
    const s = this.settings, touch = this.h.touch;
    const q = (v: Settings['quality'], label: string) => `<button data-a="set-q" data-v="${v}" class="${s.quality === v ? 'on' : ''}">${label}</button>`;
    return `${this.head('SETTINGS')}
      <div class="m-h">PROFILE</div>
      <div class="m-field"><label>NAME</label><div class="m-row"><input class="m-input" style="flex:1" data-f="name" maxlength="14" value="${esc(s.name)}" placeholder="NAME"><button class="m-btn small" data-a="dice-set" title="Random name">🎲</button></div></div>
      <div class="m-h">CONTROLS</div>
      <div class="m-field"><label>${touch ? 'AIM SPEED' : 'MOUSE SENSITIVITY'} · <span data-o="sens">${s.sens.toFixed(1)}</span></label><input class="m-range" type="range" min="0.3" max="3" step="0.1" data-f="sens" value="${s.sens}"></div>
      ${touch ? `
      <div class="m-field"><label>BUTTON SIZE · <span data-o="ctl">${Math.round(s.ctl * 100)}</span>%</label><input class="m-range" type="range" min="0.8" max="1.3" step="0.05" data-f="ctl" value="${s.ctl}"></div>
      <div class="m-field"><label>BUTTON OPACITY · <span data-o="cta">${Math.round(s.cta * 100)}</span>%</label><input class="m-range" type="range" min="0.35" max="1" step="0.05" data-f="cta" value="${s.cta}"></div>
      <div class="m-field"><label>VIBRATION</label><div class="m-seg"><button data-a="vibe" data-v="1" class="${s.vibe ? 'on' : ''}">ON</button><button data-a="vibe" data-v="0" class="${!s.vibe ? 'on' : ''}">OFF</button></div><div class="m-note">A short buzz when you are hit or get a kill (Android).</div></div>
      ${this.gyroControls()}
      <div class="m-col" style="margin-bottom:8px"><button class="m-btn small" data-a="guide">SHOW CONTROLS GUIDE</button></div>` : ''}
      <div class="m-h">VOICE</div>${this.voiceControls()}
      <div class="m-h">AUDIO</div>
      <div class="m-field"><label>VOLUME · <span data-o="vol">${Math.round(s.vol * 100)}</span>%</label><input class="m-range" type="range" min="0" max="1" step="0.05" data-f="vol" value="${s.vol}"></div>
      <div class="m-h">GRAPHICS</div>
      <div class="m-field"><div class="m-seg">${q('low', 'FAST')}${q('med', 'BALANCED')}${q('high', 'BEST')}</div>
        <div class="m-note">FAST suits phones. Changing graphics reloads the game.</div></div>
      <div class="m-col"><button class="m-btn pri" data-a="back">DONE</button></div>`;
  }

  // ───────── input ─────────
  private onInput(e: Event) {
    const t = e.target as HTMLInputElement; const f = t.dataset.f; if (!f) return;
    const out = (k: string, txt: string) => { const o = this.el.querySelector(`[data-o="${k}"]`); if (o) o.textContent = txt; };
    if (f === 'name') { this.settings.name = t.value.replace(/[^\w \-]/g, '').toUpperCase(); save('mq-name', this.settings.name); }
    if (f === 'wname') { this.settings.name = t.value.replace(/[^\w \-]/g, '').toUpperCase(); out('werr', ''); }
    if (f === 'code') save('mq-room', t.value.toUpperCase());
    if (f === 'sens') { this.settings.sens = Number(t.value); save('mq-sens', t.value); out('sens', this.settings.sens.toFixed(1)); }
    if (f === 'vol') { this.settings.vol = Number(t.value); save('mq-vol', t.value); out('vol', String(Math.round(this.settings.vol * 100))); }
    if (f === 'ctl' || f === 'cta') { (this.settings as any)[f] = Number(t.value); save('mq-' + f, t.value); out(f, String(Math.round(Number(t.value) * 100))); }
    if (f === 'gsens') { this.h.gyro.setSens(Number(t.value)); out('gsens', Number(t.value).toFixed(1)); }
    if (f === 'vvol') { this.h.voice.setVolume(Number(t.value)); out('vvol', String(Math.round(Number(t.value) * 100))); }
    this.h.settingsChanged(this.settings);
  }
  /** apply one setup option to a config, keeping mode and map compatible (capture the flag needs a map with flag bases) */
  private applyCfg(c: MatchCfg, k: string, v: string) {
    if (k === 'map') c.map = v; else if (k === 'mode') c.mode = v; else if (k === 'open') c.open = v === '1'; else (c as any)[k] = Number(v);
    if (c.mode === 'ctf' && !hasFlags(c.map)) { if (k === 'mode') c.map = MAP_LIST.find(m => m.flags)!.id; else c.mode = 'tdm'; }
  }
  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (!b) return;
    const a = b.dataset.a!, v = b.dataset.v ?? '';
    switch (a) {
      case 'resume': this.h.resume(); break;
      case 'go-solo': this.setupFor = 'solo'; this.push('setup'); break;
      case 'go-host': this.setupFor = 'host'; this.push('setup'); break;
      case 'go-join': this.push('join'); break;
      case 'go-settings': this.push('settings'); break;
      case 'back': this.pop(); break;
      case 'leave': this.h.leave(); break;
      case 'restart': this.h.restartSolo(); break;
      case 'cfg': {
        const k = b.dataset.k!;
        const live = (this.screen === 'lobby' || (this.screen === 'pause' && this.view?.mode === 'online')) && this.view;
        const target: MatchCfg = live ? { ...this.view!.cfg } : this.draft;
        this.applyCfg(target, k, v);
        if (live) this.h.hostCfg(target); else { save('mq-cfg', JSON.stringify(this.draft)); this.lastKey = ''; this.render(); }
        break;
      }
      case 'start-solo': save('mq-cfg', JSON.stringify(this.draft)); this.h.startSolo({ ...this.draft }, this.name()); break;
      case 'create': save('mq-cfg', JSON.stringify(this.draft)); this.h.host({ ...this.draft }, this.name()); break;
      case 'join-code': { const c = (this.el.querySelector('[data-f="code"]') as HTMLInputElement)?.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c) this.h.join(c, this.name()); break; }
      case 'join-room': this.h.join(v, this.name()); break;
      case 'start': this.h.hostStart(); break;
      case 'stop': this.h.hostStop(); break;
      case 'team': this.h.pickTeam(Number(v)); break;
      case 'copy': if (this.view) { const l = this.view.link; navigator.clipboard?.writeText(l).then(() => this.flash(b, 'COPIED!'), () => prompt('Copy this link:', l)); } break;
      case 'share': if (this.view) navigator.share?.({ title: 'ModernQUAKE', text: `Join my ModernQUAKE lobby · code ${this.view.room}`, url: this.view.link }).catch(() => {}); break;
      case 'set-q': if (v !== this.settings.quality) { this.settings.quality = v as Settings['quality']; save('mq-quality', v); this.h.settingsChanged(this.settings); location.reload(); } break;
      case 'dice': case 'dice-set': {
        const n = Menu.randomName(); const inp = this.el.querySelector(a === 'dice' ? '[data-f="wname"]' : '[data-f="name"]') as HTMLInputElement | null;
        if (inp) inp.value = n; this.settings.name = n; if (a === 'dice-set') { save('mq-name', n); this.h.settingsChanged(this.settings); }
        break;
      }
      case 'welcome-go': {
        const n = (this.settings.name || '').trim().toUpperCase();
        if (n.length < 2) { const e2 = this.el.querySelector('[data-o="werr"]'); if (e2) e2.textContent = 'Pick a name with at least 2 letters (or tap 🎲).'; break; }
        this.settings.name = n; save('mq-name', n); this.h.settingsChanged(this.settings); this.show(this.afterWelcome); break;
      }
      case 'vibe': this.settings.vibe = v === '1'; save('mq-vibe', v); this.h.settingsChanged(this.settings); this.render(); break;
      case 'guide': this.h.showGuide(); break;
      case 'gyro': this.h.gyro.setMode(v as GyroMode).then(ok => {
        this.gyroNote = ok ? '' : 'Motion access may be blocked. If aiming does not move, allow motion & orientation access for this site in your browser settings.';
        if (ok && v !== 'off') setTimeout(() => { if (!this.h.gyro.state().seen) { this.gyroNote = 'No gyroscope readings from this phone.'; if (this.screen === 'settings') this.render(); } }, 1500);
        this.render();
      }); break;
      case 'ginv': this.h.gyro.setInvert(v === '1'); this.render(); break;
      case 'voice': this.h.voice.setMode(v as VoiceMode); this.voiceNote = ''; this.render(); break;
      case 'vtest': this.h.voice.test().then(ok => { this.voiceNote = ok ? 'Microphone is working.' : ''; this.render(); }); break;
    }
  }
  private flash(b: HTMLElement, text: string) { const t = b.textContent; b.textContent = text; setTimeout(() => (b.textContent = t), 1400); }
  private async refreshGames() {
    try { this.games = await this.h.fetchGames(); } catch { this.games = []; }
    if (this.screen === 'join' && this.open) { const l = this.el.querySelector('.m-list'); if (l) l.innerHTML = this.games2(); }
  }

  // ───────── overlays ─────────
  showEnd(players: PlayerInfo[], winner: number, meId: number, next: number, team = 0, ts?: { 1: number; 2: number }) {
    const w = players.find(p => p.id === winner), teamGame = players.some(p => p.team);
    const title = teamGame ? (team ? `${TEAMS[team].name} TEAM WINS` : 'DRAW') : w ? (w.id === meId ? 'YOU WIN' : `${esc(w.name)} WINS`) : 'MATCH OVER';
    const me = players.find(p => p.id === meId), mine = teamGame && me?.team ? (team === me.team ? 'VICTORY' : team ? 'DEFEAT' : '') : '';
    const col = team ? TEAMS[team].css : '#ffd9a8';
    this.endEl.innerHTML = `<div class="box"><h2 style="color:${col}">${title}</h2>${mine ? `<div class="m-status">${mine}</div>` : ''}${teamGame && ts ? `<div class="m-tscore"><span class="tr">RED ${ts[1]}</span><span class="tb">${ts[2]} BLUE</span></div>` : ''}
      <div class="m-status">NEXT MATCH IN <span data-n>${next}</span>S</div>${this.scoreRows(players, meId, -1, ts, teamGame)}</div>`;
    this.endEl.style.display = 'flex';
    let n = next; const span = this.endEl.querySelector('[data-n]')!;
    const iv = setInterval(() => { n--; span.textContent = String(Math.max(0, n)); if (n <= 0) { clearInterval(iv); this.endEl.style.display = 'none'; } }, 1000);
  }
  hideEnd() { this.endEl.style.display = 'none'; }
  /** hold-TAB scoreboard */
  showScores(on: boolean) {
    const v = this.view;
    if (on && v) {
      const tg = v.cfg.mode !== 'ffa';
      this.scoreEl.innerHTML = `<div class="m-status">${this.matchLine(v)}</div>${tg ? `<div class="m-tscore"><span class="tr">RED ${v.ts[1]}</span><span class="tb">${v.ts[2]} BLUE</span></div>` : ''}${this.scoreRows(v.players, v.meId, v.mode === 'online' ? v.hostId : -1, v.ts, tg)}`;
    }
    this.scoreEl.style.display = on ? 'block' : 'none';
  }
}
