// Gyro aiming: turn / tilt the phone to aim, added on top of the touch look controls.
// Uses the raw gyroscope rate (DeviceMotionEvent.rotationRate, degrees per second), mapped to the current screen
// orientation, so turning the phone 10 degrees turns the view 10 degrees at sensitivity 1.
// iOS needs permission, which can only be asked from a tap: call requestPermission() inside a click handler.

export type GyroMode = 'off' | 'on' | 'fire';

export class Gyro {
  mode: GyroMode = 'off';
  sens = 1;
  invertY = false;
  /** a rotation-rate event has arrived since enabling (false = no gyroscope or permission denied) */
  seen = false;
  private yaw = 0; private pitch = 0;          // accumulated since the last take(), radians
  private last = 0; private listening = false;

  constructor() {
    try {
      const m = localStorage.getItem('mq-gyro'); if (m === 'on' || m === 'fire') this.mode = m;
      this.sens = Number(localStorage.getItem('mq-gyro-sens')) || 1;
      this.invertY = localStorage.getItem('mq-gyro-inv') === '1';
    } catch { /* private mode */ }
    if (this.mode !== 'off') this.listen();     // Android: no prompt needed. iOS re-asks on the next toggle.
  }

  static get supported() { return typeof window !== 'undefined' && 'DeviceMotionEvent' in window; }
  private static get needsPermission() { return typeof (DeviceMotionEvent as any)?.requestPermission === 'function'; }

  /** call from a click / tap handler. false = the browser said no (we still listen: some browsers deliver anyway) */
  async requestPermission(): Promise<boolean> {
    if (!Gyro.supported) return false;
    let ok = true;
    if (Gyro.needsPermission) {
      try { ok = await (DeviceMotionEvent as any).requestPermission() === 'granted'; } catch { ok = false; }
    }
    this.listen(); return ok;
  }

  setMode(m: GyroMode) { this.mode = m; this.save(); if (m !== 'off') this.listen(); }
  setSens(v: number) { this.sens = v; this.save(); }
  setInvert(v: boolean) { this.invertY = v; this.save(); }
  private save() { try { localStorage.setItem('mq-gyro', this.mode); localStorage.setItem('mq-gyro-sens', String(this.sens)); localStorage.setItem('mq-gyro-inv', this.invertY ? '1' : '0'); } catch { /* ignore */ } }

  private listen() {
    if (this.listening || !Gyro.supported) return; this.listening = true;
    window.addEventListener('devicemotion', e => this.onMotion(e));
  }

  private onMotion(e: DeviceMotionEvent) {
    const r = e.rotationRate; if (!r || r.alpha === null || r.beta === null || r.gamma === null) return;
    this.seen = true;
    const now = performance.now(); const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0; this.last = now;
    if (this.mode === 'off' || dt <= 0) return;
    // device axes: x = right edge of the phone in portrait, y = top edge, z = out of the screen.
    // Rotate them into screen axes for the current orientation (90 = landscape with the top of the phone to the left).
    const ang = ((screen.orientation?.angle ?? (window as any).orientation ?? 0) as number) * Math.PI / 180;
    const s = Math.sin(ang), c = Math.cos(ang);
    const wx = r.beta, wy = r.gamma;                                  // deg/s about device x and y
    let up = wx * s + wy * c;                                         // about the screen's up axis  -> turn left/right
    let right = wx * c - wy * s;                                      // about the screen's right axis -> look up/down
    const dz = 0.6;                                                    // ignore hand tremor / sensor noise (deg/s)
    up = Math.abs(up) < dz ? 0 : up - Math.sign(up) * dz;
    right = Math.abs(right) < dz ? 0 : right - Math.sign(right) * dz;
    const k = Math.PI / 180 * dt * this.sens;
    this.yaw += up * k; this.pitch += right * k * (this.invertY ? -1 : 1);
  }

  /** rotation since the last call (radians); `active` false just discards it */
  take(active: boolean): { yaw: number; pitch: number } {
    const o = { yaw: active ? this.yaw : 0, pitch: active ? this.pitch : 0 }; this.yaw = this.pitch = 0; return o;
  }
}
