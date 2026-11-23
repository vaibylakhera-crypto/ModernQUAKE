// Menus: title · solo / host setup · join (code + open games list) · lobby · pause · settings · match results.
// Pure DOM; main.ts supplies the hooks and pushes room / scoreboard updates in.
import type { MatchCfg, PlayerInfo } from './net';

export type Screen = 'title' | 'solo' | 'host' | 'join' | 'lobby' | 'pause' | 'settings';
export interface OpenGame { room: string; host: string; players: number; bots: number; map: string; state: string; frag: number; time: number }
export interface MenuHooks {
  touch: boolean;
  /** close the menu and play */
  resume(): void;
  /** start / restart a solo match with these settings */
  startSolo(cfg: MatchCfg, name: string): void;
  /** create an online room as host */
  host(cfg: MatchCfg, name: string): void;
  join(code: string, name: string): void;
  /** back to the title (ends the current session) */
  leave(): void;
  /** host: change match settings / start / end the match */
  hostCfg(cfg: MatchCfg): void;
  hostStart(): void;
  hostStop(): void;
  restartSolo(): void;
  fetchGames(): Promise<OpenGame[]>;
  settingsChanged(s: Settings): void;
}
export interface Settings { name: string; sens: number; vol: number; quality: 'low' | 'med' | 'high' }
export interface LobbyView {
  mode: 'solo' | 'online';
  room: string; link: string; meId: number; hostId: number; isHost: boolean;
  cfg: MatchCfg; state: 'lobby' | 'playing' | 'ended'; remaining: number;   // seconds left (-1 = no time limit)
  players: PlayerInfo[]; status: string;
}

const MAPS: { id: string; name: string; desc: string }[] = [
  { id: 'boreal', name: 'IRON CRADLE', desc: 'Floating fortress islands, jump pads, one high tower' },
  { id: 'void', name: 'DEEP VOID', desc: 'Same arena, darker sky, nothing between you and the stars' },
];
const SKILLS = ['EASY', 'NORMAL', 'HARD'];
const FRAGS = [0, 10, 20, 30, 50];
const TIMES = [0, 5, 10, 15, 20];
const esc = (t: string) => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const load = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const CSS = `
#start.wall{background:linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.6)),url(/menu-bg.webp) center/cover no-repeat !important;backdrop-filter:none}
@media (max-width:1300px){#start.wall{background:linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.6)),url(/menu-bg-m.webp) center/cover no-repeat !important}}
#start{cursor:default !important;background:radial-gradient(ellipse at 50% 30%,rgba(40,18,8,.55),rgba(0,0,0,.82)) !important;backdrop-filter:blur(4px)}
#menu{width:min(560px,calc(100vw - 32px));max-height:calc(100dvh - 24px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:4px 2px 12px;box-sizing:border-box}
#menu *{box-sizing:border-box}
.m-logo{text-align:center;margin:6px 0 2px;font-size:clamp(26px,min(6.4vw,10vh),60px);white-space:nowrap;font-weight:800;letter-spacing:.1em;line-height:1;background:linear-gradient(180deg,#ffd9a8,#e0782a 55%,#7a2a10);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 2px 0 #000)}
.m-sub{text-align:center;font-size:12px;letter-spacing:.4em;color:#c9a888;opacity:.75;margin-bottom:18px}
.m-h{font-size:13px;letter-spacing:.35em;color:#e0a060;margin:16px 0 8px;font-weight:700}
.m-title{font-size:26px;letter-spacing:.2em;font-weight:800;color:#f3e3d0;margin:4px 0 10px;text-align:center}
.m-col{display:flex;flex-direction:column;gap:10px}
.m-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.m-btn{appearance:none;border:1px solid #e0782a88;background:linear-gradient(180deg,#2a1a12,#160d09);color:#f3e3d0;font:700 16px "Rajdhani","Segoe UI",system-ui,sans-serif;letter-spacing:.22em;padding:14px 18px;border-radius:4px;cursor:pointer;text-align:center;box-shadow:inset 0 1px 0 #ffffff14,0 2px 0 #000;-webkit-tap-highlight-color:transparent}
.m-btn:hover,.m-btn:focus-visible{border-color:#ffb070;background:linear-gradient(180deg,#3a2216,#1e110a);outline:none}
.m-btn:active{transform:translateY(1px)}
.m-btn.pri{background:linear-gradient(180deg,#e0782a,#9a3e12);color:#140804;border-color:#ffb070}
.m-btn.pri:hover{background:linear-gradient(180deg,#f08a3a,#a84816)}
.m-btn.ghost{background:transparent;border-color:#ffffff22;color:#c9b6a2}
.m-btn.small{padding:9px 12px;font-size:13px}
.m-btn[disabled]{opacity:.4;pointer-events:none}
.m-seg{display:flex;border:1px solid #ffffff22;border-radius:4px;overflow:hidden;flex-wrap:wrap}
.m-seg button{flex:1;min-width:52px;appearance:none;border:0;border-right:1px solid #ffffff14;background:#120c09;color:#bba48e;font:700 14px "Rajdhani","Segoe UI",system-ui,sans-serif;letter-spacing:.12em;padding:10px 6px;cursor:pointer}
.m-seg button:last-child{border-right:0}
.m-seg button.on{background:#e0782a;color:#140804}
.m-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.m-field label{font-size:12px;letter-spacing:.3em;color:#a89480;font-weight:700}
.m-input{background:#0d0907;border:1px solid #ffffff26;color:#f3e3d0;padding:12px;border-radius:4px;font:700 18px "Rajdhani","Segoe UI",system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;width:100%}
.m-input:focus{outline:none;border-color:#e0782a}
.m-step{display:flex;align-items:center;gap:10px}
.m-step b{min-width:44px;text-align:center;font-size:24px;color:#f3e3d0}
.m-maps{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.m-map{border:1px solid #ffffff22;border-radius:4px;padding:10px;cursor:pointer;background:linear-gradient(160deg,#1a120d,#0b0807);min-height:74px}
.m-map b{display:block;letter-spacing:.18em;color:#f3e3d0;font-size:15px}
.m-map span{font-size:12px;color:#a89480;line-height:1.3}
.m-map.on{border-color:#e0782a;box-shadow:0 0 0 1px #e0782a inset,0 0 18px #e0782a33}
.m-code{font-size:44px;font-weight:800;letter-spacing:.3em;text-align:center;color:#ffd9a8;margin:2px 0;user-select:text;-webkit-user-select:text}
.m-note{font-size:13px;color:#a89480;letter-spacing:.06em;line-height:1.45;text-align:center}
.m-status{text-align:center;font-weight:700;letter-spacing:.25em;font-size:14px;color:#e0a060;margin:6px 0}
.m-list{display:flex;flex-direction:column;gap:4px}
.m-pl{display:grid;grid-template-columns:22px 1fr 48px 48px;align-items:center;gap:6px;padding:8px 10px;background:#0f0b09cc;border-left:3px solid var(--c,#888);font-weight:700;letter-spacing:.08em;font-size:15px}
.m-pl.me{background:#2a1a10cc}
.m-pl i{font-style:normal;font-size:10px;letter-spacing:.15em;color:#a89480;margin-left:6px;border:1px solid #ffffff30;padding:0 4px;border-radius:2px}
.m-pl .n{text-align:right;color:#f3e3d0} .m-pl .d{text-align:right;color:#8a7a6c}
.m-pl.head{background:none;border-left-color:transparent;font-size:11px;color:#8a7a6c;letter-spacing:.25em;padding:2px 10px}
.m-game{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:10px 12px;background:#120c09;border:1px solid #ffffff1a;border-radius:4px;cursor:pointer}
.m-game:hover{border-color:#e0782a}
.m-game b{letter-spacing:.2em;color:#ffd9a8;font-size:18px} .m-game span{font-size:12px;color:#a89480;letter-spacing:.08em}
.m-game em{grid-row:span 2;align-self:center;font-style:normal;font-weight:700;color:#e0782a;letter-spacing:.15em}
.m-range{width:100%;accent-color:#e0782a}
.m-help{font-size:12px;color:#8a7a6c;letter-spacing:.06em;line-height:1.5;text-align:center;margin-top:12px}
.m-help kbd{border:1px solid #ffffff30;border-radius:3px;padding:0 5px;margin:0 1px;font-size:11px}
#endscreen{position:fixed;inset:0;z-index:6;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.6);pointer-events:none}
#endscreen .box{width:min(520px,calc(100vw - 32px));padding:18px;background:#0c0806ee;border:1px solid #e0782a66;border-radius:6px;pointer-events:auto}
#endscreen h2{margin:0;text-align:center;font-size:30px;letter-spacing:.2em;color:#ffd9a8}
#scoreov{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:4;width:min(480px,calc(100vw - 32px));padding:14px;background:#0c0806dd;border:1px solid #ffffff22;border-radius:6px;display:none;pointer-events:none}
#matchbar{position:absolute;top:14px;left:50%;transform:translateX(-50%);font-weight:700;letter-spacing:.25em;font-size:15px;color:#f3e3d0;text-shadow:0 0 6px #000;white-space:nowrap}
#matchbar b{color:#ffb070}
body.touch #matchbar{top:calc(56px + env(safe-area-inset-top));font-size:12px}
body.touch .m-btn{padding:13px 14px;font-size:15px}
@media (max-height:520px){.m-btn{padding:10px 14px;font-size:14px}.m-sub{margin-bottom:10px}.m-col{gap:7px}.m-title{font-size:20px;margin:0 0 6px}.m-code{font-size:34px}.m-field{margin-bottom:8px}.m-seg button{padding:8px 4px}}
`;

export class Menu {
  readonly root: HTMLElement; private el: HTMLElement;
  screen: Screen = 'title';
  private back: Screen = 'title';
  private view: LobbyView | null = null;
  private lastKey = '';
  private draft: MatchCfg;
  settings: Settings;
  private gamesTimer = 0;
  private endEl: HTMLElement; private scoreEl: HTMLElement;
  sessionActive = false;

  constructor(private h: MenuHooks) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    this.root = document.getElementById('start')!;
    this.el = document.getElementById('menu')!;
    this.settings = {
      name: load('mq-name', ''), sens: Number(load('mq-sens', '1')) || 1, vol: Number(load('mq-vol', '0.7')),
      quality: (load('mq-quality', 'low') as Settings['quality']),
    };
    try { this.draft = { map: 'boreal', bots: 3, skill: 1, frag: 20, time: 10, open: true, ...JSON.parse(load('mq-cfg', '{}')) }; }
    catch { this.draft = { map: 'boreal', bots: 3, skill: 1, frag: 20, time: 10, open: true }; }
    this.endEl = document.createElement('div'); this.endEl.id = 'endscreen'; document.body.appendChild(this.endEl);
    this.scoreEl = document.createElement('div'); this.scoreEl.id = 'scoreov'; document.body.appendChild(this.scoreEl);
    // the menu scrolls on phones: keep its touches away from the game's touch handlers
    for (const ev of ['touchstart', 'touchmove', 'touchend', 'click', 'mousedown', 'keydown'] as const) this.root.addEventListener(ev, e => e.stopPropagation());
    this.el.addEventListener('click', e => this.onClick(e));
    this.el.addEventListener('input', e => this.onInput(e));
  }

  get open() { return this.root.style.display !== 'none'; }
  show(s: Screen) {
    if (s !== 'settings') this.back = s;
    this.screen = s; this.root.style.display = 'flex'; this.root.classList.toggle('wall', !this.sessionActive); this.render();
    clearInterval(this.gamesTimer);
    if (s === 'join') { this.refreshGames(); this.gamesTimer = window.setInterval(() => this.refreshGames(), 3000); }
  }
  hide() { this.root.style.display = 'none'; clearInterval(this.gamesTimer); }
  /** live room / match data for the lobby + pause screens */
  setView(v: LobbyView) {
    this.view = v;
    if (this.open && (this.screen === 'lobby' || this.screen === 'pause')) this.render(true);
  }

  private name() { return (this.settings.name || '').trim().toUpperCase().slice(0, 14) || 'PLAYER'; }

  // ───────── rendering ─────────
  private render(soft = false) {
    // soft re-render (live data) must not wipe a field the user is typing in
    if (soft && this.el.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text') return;
    const html: string = (this as any)['r_' + this.screen]();
    // live updates usually only move the clock: patch that line instead of rebuilding (a rebuild can swallow a tap)
    const key = html.replace(/<div class="m-status" data-o="status">[^<]*<\/div>/g, '');
    if (soft && key === this.lastKey) {
      const st = html.match(/<div class="m-status" data-o="status">([^<]*)<\/div>/), el = this.el.querySelector('[data-o="status"]');
      if (st && el && el.innerHTML !== st[1]) el.innerHTML = st[1];
      return;
    }
    this.lastKey = key;
    const top = this.el.scrollTop;
    this.el.innerHTML = html;
    if (soft) this.el.scrollTop = top;
  }
  private help() {
    return this.h.touch
      ? `<div class="m-help">Left thumb: move · right thumb: drag to aim · hold FIRE and drag to aim while shooting · tap JUMP each hop</div>`
      : `<div class="m-help"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>SPACE</kbd> jump (tap each hop) · <kbd>C</kbd> crouch · <kbd>1</kbd>-<kbd>8</kbd>/wheel weapons · hold <kbd>TAB</kbd> scores · <kbd>ESC</kbd> menu</div>`;
  }
  private r_title() {
    const a = this.sessionActive;
    return `<div class="m-logo">MODERNQUAKE</div><div class="m-sub">ARENA · FRAG · REPEAT</div>
      <div class="m-col">
        ${a ? `<button class="m-btn pri" data-a="resume">RESUME</button>` : ''}
        <button class="m-btn ${a ? '' : 'pri'}" data-a="go-solo">PLAY SOLO</button>
        <button class="m-btn" data-a="go-host">HOST GAME</button>
        <button class="m-btn" data-a="go-join">JOIN GAME</button>
        <button class="m-btn ghost" data-a="go-settings">SETTINGS</button>
        ${a ? `<button class="m-btn ghost" data-a="leave">LEAVE MATCH</button>` : ''}
      </div>${this.help()}`;
  }
  private cfgControls(c: MatchCfg, host: boolean, editable = true) {
    const dis = editable ? '' : 'disabled';
    const seg = (key: string, vals: number[], label: (v: number) => string, cur: number) =>
      `<div class="m-seg">${vals.map(v => `<button ${dis} data-a="cfg" data-k="${key}" data-v="${v}" class="${v === cur ? 'on' : ''}">${label(v)}</button>`).join('')}</div>`;
    return `
      <div class="m-field"><label>MAP</label><div class="m-maps">${MAPS.map(m => `<div class="m-map ${m.id === c.map ? 'on' : ''}" ${editable ? `data-a="cfg" data-k="map" data-v="${m.id}"` : ''}><b>${m.name}</b><span>${m.desc}</span></div>`).join('')}</div></div>
      <div class="m-field"><label>BOTS</label><div class="m-step"><button class="m-btn small" ${dis} data-a="cfg" data-k="bots" data-v="${Math.max(0, c.bots - 1)}">−</button><b>${c.bots}</b><button class="m-btn small" ${dis} data-a="cfg" data-k="bots" data-v="${Math.min(7, c.bots + 1)}">+</button></div></div>
      <div class="m-field"><label>BOT SKILL</label>${seg('skill', [0, 1, 2], v => SKILLS[v], c.skill)}</div>
      <div class="m-field"><label>FRAG LIMIT</label>${seg('frag', FRAGS, v => v ? String(v) : 'OFF', c.frag)}</div>
      <div class="m-field"><label>TIME LIMIT (MIN)</label>${seg('time', TIMES, v => v ? String(v) : 'OFF', c.time)}</div>
      ${host ? `<div class="m-field"><label>VISIBILITY</label><div class="m-seg"><button ${dis} data-a="cfg" data-k="open" data-v="1" class="${c.open !== false ? 'on' : ''}">LISTED IN OPEN GAMES</button><button ${dis} data-a="cfg" data-k="open" data-v="0" class="${c.open === false ? 'on' : ''}">CODE ONLY</button></div></div>` : ''}`;
  }
  private r_solo() {
    return `<div class="m-title">SOLO MATCH</div>
      ${this.cfgControls(this.draft, false)}
      <div class="m-col"><button class="m-btn pri" data-a="start-solo">START MATCH</button><button class="m-btn ghost" data-a="back">BACK</button></div>`;
  }
  private r_host() {
    return `<div class="m-title">HOST A GAME</div>
      <div class="m-field"><label>YOUR NAME</label><input class="m-input" data-f="name" maxlength="14" value="${esc(this.settings.name)}" placeholder="NAME"></div>
      ${this.cfgControls(this.draft, true)}
      <div class="m-col"><button class="m-btn pri" data-a="create">CREATE ROOM</button><button class="m-btn ghost" data-a="back">BACK</button></div>
      <div class="m-help">You get a room code and a link to send to friends. Bots run on your device.</div>`;
  }
  private games: OpenGame[] | null = null;
  private r_join() {
    const list = this.games === null ? `<div class="m-note">Looking for games…</div>`
      : !this.games.length ? `<div class="m-note">No open games right now. Ask your friend for their room code, or host one.</div>`
      : this.games.map(g => `<div class="m-game" data-a="join-room" data-v="${esc(g.room)}"><b>${esc(g.room)}</b><em>JOIN</em>
          <span>${esc(g.host)}'s game · ${g.players}/8 players · ${g.bots} bots · ${MAPS.find(m => m.id === g.map)?.name ?? esc(g.map)} · ${g.state === 'playing' ? 'MATCH ON' : 'WARMUP'}</span></div>`).join('');
    return `<div class="m-title">JOIN A GAME</div>
      <div class="m-field"><label>YOUR NAME</label><input class="m-input" data-f="name" maxlength="14" value="${esc(this.settings.name)}" placeholder="NAME"></div>
      <div class="m-field"><label>ROOM CODE</label><div class="m-row"><input class="m-input" style="flex:1" data-f="code" maxlength="12" placeholder="E.G. K7QX" value="${esc(load('mq-room', ''))}"><button class="m-btn pri" data-a="join-code">JOIN</button></div></div>
      <div class="m-h">OPEN GAMES</div><div class="m-list">${list}</div>
      <div class="m-col" style="margin-top:14px"><button class="m-btn ghost" data-a="back">BACK</button></div>`;
  }
  private scoreRows(players: PlayerInfo[], meId: number, hostId = -1) {
    const rows = [...players].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths).map((p, i) => `
      <div class="m-pl ${p.id === meId ? 'me' : ''}" style="--c:#${p.color.toString(16).padStart(6, '0')}">
        <span>${i + 1}</span><span>${esc(p.name)}${p.id === hostId ? '<i>HOST</i>' : ''}${p.bot ? '<i>BOT</i>' : ''}${p.id === meId ? '<i>YOU</i>' : ''}</span>
        <span class="n">${p.frags}</span><span class="d">${p.deaths}</span></div>`).join('');
    return `<div class="m-list"><div class="m-pl head"><span>#</span><span>PLAYER</span><span class="n">FRAGS</span><span class="d">DEATHS</span></div>${rows}</div>`;
  }
  private matchLine(v: LobbyView) {
    const t = v.remaining >= 0 ? `${Math.floor(v.remaining / 60)}:${String(Math.floor(v.remaining % 60)).padStart(2, '0')} LEFT` : 'NO TIME LIMIT';
    const f = v.cfg.frag ? `FIRST TO ${v.cfg.frag}` : 'NO FRAG LIMIT';
    return v.state === 'playing' ? `MATCH ON · ${t} · ${f}` : v.state === 'ended' ? 'MATCH OVER' : v.mode === 'online' ? (v.isHost ? 'WARMUP · START WHEN READY' : 'WARMUP · WAITING FOR HOST') : 'READY';
  }
  private r_lobby() {
    const v = this.view; if (!v) return `<div class="m-status">CONNECTING…</div>`;
    const canShare = typeof navigator.share === 'function';
    return `<div class="m-h" style="text-align:center;margin-top:4px">ROOM CODE</div>
      <div class="m-code">${esc(v.room)}</div>
      <div class="m-row" style="justify-content:center"><button class="m-btn small" data-a="copy">COPY INVITE LINK</button>${canShare ? `<button class="m-btn small" data-a="share">SHARE</button>` : ''}</div>
      <div class="m-status" data-o="status">${this.matchLine(v)}${v.status ? ` · ${esc(v.status)}` : ''}</div>
      <div class="m-col"><button class="m-btn pri" data-a="resume">${v.state === 'lobby' ? 'WARM UP' : 'PLAY'}</button>
        ${v.isHost ? (v.state === 'playing' ? `<button class="m-btn" data-a="stop">END MATCH</button>` : `<button class="m-btn" data-a="start" ${v.state === 'ended' ? 'disabled' : ''}>START MATCH</button>`) : ''}</div>
      <div class="m-h">PLAYERS (${v.players.filter(p => !p.bot).length}/8 + ${v.players.filter(p => p.bot).length} BOTS)</div>
      ${this.scoreRows(v.players, v.meId, v.hostId)}
      <div class="m-h">MATCH SETTINGS ${v.isHost ? '' : '<span style="opacity:.6">(HOST ONLY)</span>'}</div>
      ${v.isHost && v.state !== 'playing' ? this.cfgControls(v.cfg, true) : this.cfgControls(v.cfg, true, false)}
      <div class="m-col"><button class="m-btn ghost" data-a="go-settings">SETTINGS</button><button class="m-btn ghost" data-a="leave">LEAVE ROOM</button></div>`;
  }
  private r_pause() {
    const v = this.view;
    if (v && v.mode === 'online') return this.r_lobby();
    return `<div class="m-title">PAUSED</div>
      ${v ? `<div class="m-status" data-o="status">${this.matchLine(v)}</div>${this.scoreRows(v.players, v.meId)}` : ''}
      <div class="m-col" style="margin-top:14px"><button class="m-btn pri" data-a="resume">RESUME</button>
        <button class="m-btn" data-a="restart">RESTART MATCH</button>
        <button class="m-btn" data-a="go-solo">MATCH SETTINGS</button>
        <button class="m-btn ghost" data-a="go-settings">SETTINGS</button>
        <button class="m-btn ghost" data-a="leave">QUIT TO TITLE</button></div>${this.help()}`;
  }
  private r_settings() {
    const s = this.settings;
    const q = (v: Settings['quality'], label: string) => `<button data-a="set-q" data-v="${v}" class="${s.quality === v ? 'on' : ''}">${label}</button>`;
    return `<div class="m-title">SETTINGS</div>
      <div class="m-field"><label>NAME</label><input class="m-input" data-f="name" maxlength="14" value="${esc(s.name)}" placeholder="NAME"></div>
      <div class="m-field"><label>${this.h.touch ? 'AIM SPEED' : 'MOUSE SENSITIVITY'} · <span data-o="sens">${s.sens.toFixed(1)}</span></label><input class="m-range" type="range" min="0.3" max="3" step="0.1" data-f="sens" value="${s.sens}"></div>
      <div class="m-field"><label>VOLUME · <span data-o="vol">${Math.round(s.vol * 100)}</span>%</label><input class="m-range" type="range" min="0" max="1" step="0.05" data-f="vol" value="${s.vol}"></div>
      <div class="m-field"><label>GRAPHICS</label><div class="m-seg">${q('low', 'FAST')}${q('med', 'BALANCED')}${q('high', 'BEST')}</div>
        <div class="m-note" style="text-align:left;margin-top:4px">FAST suits phones. Changing graphics reloads the game.</div></div>
      <div class="m-col"><button class="m-btn pri" data-a="back">DONE</button></div>`;
  }

  // ───────── input ─────────
  private onInput(e: Event) {
    const t = e.target as HTMLInputElement; const f = t.dataset.f; if (!f) return;
    if (f === 'name') { this.settings.name = t.value.replace(/[^\w \-]/g, '').toUpperCase(); save('mq-name', this.settings.name); }
    if (f === 'code') save('mq-room', t.value.toUpperCase());
    if (f === 'sens') { this.settings.sens = Number(t.value); save('mq-sens', t.value); const o = this.el.querySelector('[data-o="sens"]'); if (o) o.textContent = this.settings.sens.toFixed(1); }
    if (f === 'vol') { this.settings.vol = Number(t.value); save('mq-vol', t.value); const o = this.el.querySelector('[data-o="vol"]'); if (o) o.textContent = String(Math.round(this.settings.vol * 100)); }
    this.h.settingsChanged(this.settings);
  }
  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (!b) return;
    const a = b.dataset.a!, v = b.dataset.v ?? '';
    switch (a) {
      case 'resume': this.h.resume(); break;
      case 'go-solo': this.show('solo'); break;
      case 'go-host': this.show('host'); break;
      case 'go-join': this.show('join'); break;
      case 'go-settings': this.show('settings'); break;
      case 'back': this.show(this.screen === 'settings' ? this.back : this.sessionActive && this.view ? 'pause' : 'title'); break;
      case 'leave': this.h.leave(); break;
      case 'restart': this.h.restartSolo(); break;
      case 'cfg': {
        const k = b.dataset.k as keyof MatchCfg;
        const target = this.screen === 'lobby' || (this.screen === 'pause' && this.view?.mode === 'online') ? { ...this.view!.cfg } : this.draft;
        (target as any)[k] = k === 'map' ? v : k === 'open' ? v === '1' : Number(v);
        if (target === this.draft) { save('mq-cfg', JSON.stringify(this.draft)); this.render(true); }
        else this.h.hostCfg(target);
        break;
      }
      case 'start-solo': save('mq-cfg', JSON.stringify(this.draft)); this.h.startSolo({ ...this.draft }, this.name()); break;
      case 'create': save('mq-cfg', JSON.stringify(this.draft)); this.h.host({ ...this.draft }, this.name()); break;
      case 'join-code': { const c = (this.el.querySelector('[data-f="code"]') as HTMLInputElement)?.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c) this.h.join(c, this.name()); break; }
      case 'join-room': this.h.join(v, this.name()); break;
      case 'start': this.h.hostStart(); break;
      case 'stop': this.h.hostStop(); break;
      case 'copy': if (this.view) { const l = this.view.link; navigator.clipboard?.writeText(l).then(() => this.flash(b, 'COPIED!'), () => prompt('Copy this link:', l)); } break;
      case 'share': if (this.view) navigator.share?.({ title: 'ModernQUAKE', text: `Join my ModernQUAKE game · room ${this.view.room}`, url: this.view.link }).catch(() => {}); break;
      case 'set-q': if (v !== this.settings.quality) { this.settings.quality = v as Settings['quality']; save('mq-quality', v); this.h.settingsChanged(this.settings); location.reload(); } break;
    }
  }
  private flash(b: HTMLElement, text: string) { const t = b.textContent; b.textContent = text; setTimeout(() => (b.textContent = t), 1400); }
  private async refreshGames() {
    try { this.games = await this.h.fetchGames(); } catch { this.games = []; }
    if (this.screen === 'join' && this.open) this.render(true);
  }

  // ───────── overlays ─────────
  showEnd(players: PlayerInfo[], winner: number, meId: number, next: number) {
    const w = players.find(p => p.id === winner);
    const title = w ? (w.id === meId ? 'YOU WIN' : `${esc(w.name)} WINS`) : 'MATCH OVER';
    this.endEl.innerHTML = `<div class="box"><h2>${title}</h2><div class="m-status">NEXT MATCH IN <span data-n>${next}</span>S</div>${this.scoreRows(players, meId)}</div>`;
    this.endEl.style.display = 'flex';
    let n = next; const span = this.endEl.querySelector('[data-n]')!;
    const iv = setInterval(() => { n--; span.textContent = String(Math.max(0, n)); if (n <= 0) { clearInterval(iv); this.endEl.style.display = 'none'; } }, 1000);
  }
  hideEnd() { this.endEl.style.display = 'none'; }
  /** hold-TAB scoreboard */
  showScores(on: boolean) {
    if (on && this.view) { this.scoreEl.innerHTML = `<div class="m-status">${this.matchLine(this.view)}</div>${this.scoreRows(this.view.players, this.view.meId, this.view.mode === 'online' ? this.view.hostId : -1)}`; }
    this.scoreEl.style.display = on ? 'block' : 'none';
  }
}
