import { lifts, liftBoxes, Lift, CRUSH_H } from './level';

// Lifts glide between two heights on a clock shared by every player (server time online), so everyone sees the same lift
// in the same place without any network messages: wait at the bottom, rise, wait at the top, descend.
const ease = (k: number) => k * k * (3 - 2 * k);
/** how far along its route a lift is, 0 = start (bottom / raised / home) .. 1 = the far end, at `tSec` seconds on the shared clock */
export function liftProgress(l: Lift, tSec: number): number {
  if (l.crush) {                                                       // wait raised, slam down fast, hold, rise slowly
    const D = l.travel, H = 0.9, R = 1.7, total = l.wait + D + H + R;
    let t = (((tSec + l.phase) % total) + total) % total;
    if (t < l.wait) return 0; t -= l.wait;
    if (t < D) return t / D; t -= D;
    if (t < H) return 1; t -= H;
    return 1 - ease(t / R);
  }
  const total = 2 * l.wait + 2 * l.travel;
  let t = (((tSec + l.phase) % total) + total) % total;
  if (t < l.wait) return 0; t -= l.wait;
  if (t < l.travel) return ease(t / l.travel); t -= l.travel;
  if (t < l.wait) return 1; t -= l.wait;
  return 1 - ease(t / l.travel);
}
/** height of a lift's top surface at `tSec` */
export function liftTop(l: Lift, tSec: number): number { return l.y0 + (l.y1 - l.y0) * liftProgress(l, tSec); }
/** true while the lift is about to move / moving (used for the glow on its edge) */
export function liftMoving(l: Lift, tSec: number): boolean {
  if (l.crush) { const p = liftProgress(l, tSec); return p > 0.01 && p < 0.99; }
  const total = 2 * l.wait + 2 * l.travel, t = (((tSec + l.phase) % total) + total) % total;
  return (t >= l.wait && t < l.wait + l.travel) || t >= 2 * l.wait + l.travel;
}

export interface Rider { x: number; y: number; z: number; vy: number }
export class LiftSystem {
  private prev: number[] = lifts.map(l => l.y0);
  private prevP: number[] = lifts.map(() => 0);
  /** move every lift to its place at `tSec` and carry anyone standing on one */
  update(tSec: number, riders: Rider[] = []) {
    for (let i = 0; i < lifts.length; i++) {
      const l = lifts[i], b = liftBoxes[i], top = liftTop(l, tSec), old = this.prev[i], p = liftProgress(l, tSec), dp = p - this.prevP[i];
      b.max[1] = top; b.min[1] = top - (l.crush ? CRUSH_H : 0.5);
      if (l.dx || l.dz) {                                            // a drifting platform: slide it, and carry whoever stands on it
        const ox = l.x0 + (l.dx ?? 0) * this.prevP[i], oz = l.z0 + (l.dz ?? 0) * this.prevP[i], mx = (l.dx ?? 0) * dp, mz = (l.dz ?? 0) * dp, w = l.x1 - l.x0, d = l.z1 - l.z0;
        for (const r of riders) if (r.x > ox - 0.2 && r.x < ox + w + 0.2 && r.z > oz - 0.2 && r.z < oz + d + 0.2 && Math.abs(r.y - top) < 0.15 && r.vy <= 0.5) { r.x += mx; r.z += mz; }
        b.min[0] = l.x0 + (l.dx ?? 0) * p; b.max[0] = b.min[0] + w; b.min[2] = l.z0 + (l.dz ?? 0) * p; b.max[2] = b.min[2] + d;
      }
      this.prevP[i] = p;
      if (top !== old) {
        for (const r of riders) {
          const inside = r.x > l.x0 - 0.2 && r.x < l.x1 + 0.2 && r.z > l.z0 - 0.2 && r.z < l.z1 + 0.2;
          if (inside && Math.abs(r.y - old) < 0.15 && r.vy <= 0.5) { r.y = top; r.vy = 0; }
        }
      }
      this.prev[i] = top;
    }
  }
}
