// Mobile / touch controls: floating move stick (left), drag-to-look (right), FIRE / JUMP / CROUCH / weapon / pause buttons.
// The FIRE button doubles as a look pad: hold it and drag to aim while shooting.

export const isTouch = (() => {
  try { return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches; } catch { return false; }
})();

export interface TouchHooks {
  look(dx: number, dy: number): void;   // pixels moved by a look finger
  jump(): void;
  nextWeapon(): void;
  pause(): void;
  chat(): void;
  mic(on: boolean): void;
  music(): void;
  playpause(): void;
  reload(): void;
}

export class TouchControls {
  forward = 0; side = 0;
  fire = false; crouch = false;
  readonly el: HTMLDivElement;
  private stickId: number | null = null; private sx = 0; private sy = 0;
  private lookIds = new Map<number, { x: number; y: number }>();
  private fireId: number | null = null; private micId: number | null = null;
  private base: HTMLDivElement; private knob: HTMLDivElement;
  /** user-moved controls: offsets in px from the default spot, saved on the device */
  private layout: Record<string, [number, number]> = {};
  private editing = false; private dragId: number | null = null; private dragKey = ''; private dragFrom: [number, number] = [0, 0]; private dragStart: [number, number] = [0, 0];
  private static readonly MOVABLE = ['fire', 'jump', 'crouch', 'weap', 'reload', 'stick'];

  constructor(private hooks: TouchHooks) {
    const el = this.el = document.createElement('div'); el.id = 'touch';
    const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    el.innerHTML = `
      <div class="tstick"><i></i></div>
      <button class="tbtn tfire" data-b="fire">${svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>')}<span>FIRE</span></button>
      <button class="tbtn tjump" data-b="jump">${svg('<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>')}<span>JUMP</span></button>
      <button class="tbtn tcrouch" data-b="crouch">${svg('<path d="M6 8l6 6 6-6M6 19h12"/>')}<span>DUCK</span></button>
      <button class="tbtn tweap" data-b="weap">${svg('<path d="M4 8h13l-3-3M20 16H7l3 3"/>')}</button>
      <button class="tbtn treload" data-b="reload">${svg('<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>')}<span>RELOAD</span></button>
      <button class="tbtn tmusic" data-b="music">${svg('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>')}</button>
      <button class="tbtn tplay" data-b="play"><span class="ic-play">${svg('<path d="M8 5l11 7-11 7z"/>')}</span><span class="ic-pause">${svg('<path d="M8 5v14M16 5v14"/>')}</span></button>
      <button class="tbtn tchat" data-b="chat">${svg('<path d="M4 5h16v10H9l-5 4z"/>')}</button>
      <button class="tbtn tmic" data-b="mic">${svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>')}</button>
      <button class="tbtn tpause" data-b="pause">${svg('<path d="M5 7h14M5 12h14M5 17h14"/>')}</button>`;
    document.body.appendChild(el);
    this.base = el.querySelector<HTMLDivElement>('.tstick')!; this.knob = this.base.querySelector<HTMLDivElement>('i')!;
    try { this.layout = JSON.parse(localStorage.getItem('mq-layout') || '{}') || {}; } catch { this.layout = {}; }
    this.applyLayout(); this.home();
    const opt = { passive: false } as AddEventListenerOptions;
    el.addEventListener('touchstart', e => { if (this.editing) { e.preventDefault(); this.editStart(e); } else this.start(e); }, opt);
    el.addEventListener('touchmove', e => { if (this.editing) { e.preventDefault(); this.editMove(e); } else this.move(e); }, opt);
    el.addEventListener('touchend', e => { if (this.editing) { e.preventDefault(); this.editEnd(e); } else this.end(e); }, opt);
    el.addEventListener('touchcancel', e => { if (this.editing) this.editEnd(e); else this.end(e); }, opt);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  private applyLayout() {
    for (const k of TouchControls.MOVABLE) {
      if (k === 'stick') continue;
      const b = this.el.querySelector<HTMLElement>(`.tbtn[data-b=${k}]`), o = this.layout[k] ?? [0, 0];
      if (b) { b.style.setProperty('--dx', `${o[0]}px`); b.style.setProperty('--dy', `${o[1]}px`); }
    }
  }
  private save() { try { localStorage.setItem('mq-layout', JSON.stringify(this.layout)); } catch { /* ignore */ } }
  /** drag-to-place mode: the controls can be moved with a finger; the stick's resting spot too */
  setEdit(on: boolean) { this.editing = on; this.el.classList.toggle('editing', on); if (on) { this.reset(); this.home(); } }
  resetLayout() { this.layout = {}; this.save(); this.applyLayout(); this.home(); }
  /** keep a moved control fully on screen */
  private clamp(el: HTMLElement, key: string) {
    const o = this.layout[key] ?? [0, 0], r = el.getBoundingClientRect(), m = 6;
    let dx = 0, dy = 0;
    if (r.left < m) dx = m - r.left; else if (r.right > innerWidth - m) dx = innerWidth - m - r.right;
    if (r.top < m) dy = m - r.top; else if (r.bottom > innerHeight - m) dy = innerHeight - m - r.bottom;
    if (dx || dy) { this.layout[key] = [o[0] + dx, o[1] + dy]; this.applyLayout(); this.home(); }
  }
  private editStart(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      if (this.dragId !== null) continue;
      const btn = (t.target as HTMLElement).closest?.('.tbtn') as HTMLElement | null, key = btn?.dataset.b ?? (t.clientX < innerWidth * 0.45 && t.clientY > innerHeight * 0.3 ? 'stick' : '');
      if (!key || !TouchControls.MOVABLE.includes(key)) continue;
      this.dragId = t.identifier; this.dragKey = key; this.dragFrom = [...(this.layout[key] ?? [0, 0])] as [number, number]; this.dragStart = [t.clientX, t.clientY];
      (btn ?? this.base).classList.add('dragging');
    }
  }
  private editMove(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== this.dragId) continue;
      this.layout[this.dragKey] = [Math.round(this.dragFrom[0] + t.clientX - this.dragStart[0]), Math.round(this.dragFrom[1] + t.clientY - this.dragStart[1])];
      this.applyLayout(); this.home();
      const el = this.dragKey === 'stick' ? this.base : this.el.querySelector<HTMLElement>(`.tbtn[data-b=${this.dragKey}]`); if (el) this.clamp(el, this.dragKey);
    }
  }
  private editEnd(e: TouchEvent) {
    for (const t of Array.from(e.changedTouches)) if (t.identifier === this.dragId) { this.dragId = null; this.save(); this.el.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); }
  }

  /** show the reload button only while the sidearm is out and not full */
  setReload(on: boolean) { this.el.querySelector('.treload')?.classList.toggle('show', on); }

  /** reflect the music play / pause state on the top button */
  setPlaying(on: boolean) { this.el.querySelector('.tplay')?.classList.toggle('playing', on); }

  show(on: boolean) { this.el.style.display = on ? 'block' : 'none'; if (!on) this.reset(); }

  reset() {
    this.stickId = this.fireId = null; this.lookIds.clear();
    this.forward = this.side = 0; this.fire = false;
    this.home();
    this.el.querySelectorAll('.tbtn.on').forEach(b => { if ((b as HTMLElement).dataset.b !== 'crouch' || !this.crouch) b.classList.remove('on'); });
  }

  /** park the stick in the bottom-left corner (always visible) */
  private home() {
    this.base.classList.remove('active'); this.knob.style.transform = 'translate(-50%,-50%)';
    const o = this.layout.stick ?? [0, 0];
    this.base.style.left = `calc(max(84px, 9vw + 40px) + env(safe-area-inset-left) + ${o[0]}px)`; this.base.style.top = `calc(100% - clamp(78px, 27vh, 118px) - env(safe-area-inset-bottom) + ${o[1]}px)`;
  }

  private start(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const btn = (t.target as HTMLElement).closest?.('.tbtn') as HTMLElement | null;
      if (btn) {
        const b = btn.dataset.b;
        if (b === 'fire') { this.fire = true; this.fireId = t.identifier; this.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY }); btn.classList.add('on'); }
        else if (b === 'jump') { this.hooks.jump(); this.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY }); flash(btn); }
        else if (b === 'crouch') { this.crouch = !this.crouch; btn.classList.toggle('on', this.crouch); }
        else if (b === 'weap') { this.hooks.nextWeapon(); flash(btn); }
        else if (b === 'reload') { this.hooks.reload(); flash(btn); }
        else if (b === 'pause') { this.hooks.pause(); }
        else if (b === 'chat') { this.hooks.chat(); flash(btn); }
        else if (b === 'music') { this.hooks.music(); flash(btn); }
        else if (b === 'play') { this.hooks.playpause(); }
        else if (b === 'mic') { this.micId = t.identifier; this.hooks.mic(true); btn.classList.add('on'); }
        continue;
      }
      if (t.clientX < innerWidth * 0.42 && this.stickId === null) {
        this.stickId = t.identifier; this.sx = t.clientX; this.sy = t.clientY;
        this.base.style.left = `${t.clientX}px`; this.base.style.top = `${t.clientY}px`; this.base.classList.add('active');
        this.knob.style.transform = 'translate(-50%,-50%)';
      } else {
        this.lookIds.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
  }

  private move(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        const R = 56; let dx = t.clientX - this.sx, dy = t.clientY - this.sy;
        const d = Math.hypot(dx, dy);
        if (d > R) {                                   // stick follows the thumb so it never feels "stuck"
          this.sx += dx * (1 - R / d); this.sy += dy * (1 - R / d); dx = t.clientX - this.sx; dy = t.clientY - this.sy;
          this.base.style.left = `${this.sx}px`; this.base.style.top = `${this.sy}px`;
        }
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const dz = 0.18, f = -dy / R, s = dx / R;
        this.forward = Math.abs(f) < dz ? 0 : Math.max(-1, Math.min(1, f * 1.25));
        this.side = Math.abs(s) < dz ? 0 : Math.max(-1, Math.min(1, s * 1.25));
        continue;
      }
      const p = this.lookIds.get(t.identifier);
      if (p) { this.hooks.look(t.clientX - p.x, t.clientY - p.y); p.x = t.clientX; p.y = t.clientY; }
    }
  }

  private end(e: TouchEvent) {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) { this.stickId = null; this.forward = this.side = 0; this.home(); }
      if (t.identifier === this.micId) { this.micId = null; this.hooks.mic(false); this.el.querySelector('.tmic')!.classList.remove('on'); }
      if (t.identifier === this.fireId) { this.fireId = null; this.fire = false; this.el.querySelector('.tfire')!.classList.remove('on'); }
      this.lookIds.delete(t.identifier);
    }
  }
}

function flash(b: HTMLElement) { b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 120); }

/** Fullscreen + landscape lock where the browser allows it (Android Chrome). iOS home-screen apps are already fullscreen. */
export function goFullscreen() {
  const d: any = document.documentElement;
  try {
    if (!document.fullscreenElement && d.requestFullscreen) {
      d.requestFullscreen({ navigationUI: 'hide' }).then(() => (screen.orientation as any)?.lock?.('landscape').catch(() => {})).catch(() => {});
    }
  } catch { /* not supported */ }
}
