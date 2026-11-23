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
}

export class TouchControls {
  forward = 0; side = 0;
  fire = false; crouch = false;
  readonly el: HTMLDivElement;
  private stickId: number | null = null; private sx = 0; private sy = 0;
  private lookIds = new Map<number, { x: number; y: number }>();
  private fireId: number | null = null;
  private base: HTMLDivElement; private knob: HTMLDivElement;

  constructor(private hooks: TouchHooks) {
    const el = this.el = document.createElement('div'); el.id = 'touch';
    el.innerHTML = `
      <div class="tstick"><i></i></div>
      <button class="tbtn tfire" data-b="fire">FIRE</button>
      <button class="tbtn tjump" data-b="jump">JUMP</button>
      <button class="tbtn tcrouch" data-b="crouch">DUCK</button>
      <button class="tbtn tweap" data-b="weap">⇄</button>
      <button class="tbtn tpause" data-b="pause">❚❚</button>`;
    document.body.appendChild(el);
    this.base = el.querySelector<HTMLDivElement>('.tstick')!; this.knob = this.base.querySelector<HTMLDivElement>('i')!;
    this.home();
    const opt = { passive: false } as AddEventListenerOptions;
    el.addEventListener('touchstart', e => this.start(e), opt);
    el.addEventListener('touchmove', e => this.move(e), opt);
    el.addEventListener('touchend', e => this.end(e), opt);
    el.addEventListener('touchcancel', e => this.end(e), opt);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

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
    this.base.style.left = 'calc(max(84px, 9vw + 40px) + env(safe-area-inset-left))'; this.base.style.top = 'calc(100% - clamp(78px, 27vh, 118px) - env(safe-area-inset-bottom))';
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
        else if (b === 'pause') { this.hooks.pause(); }
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
