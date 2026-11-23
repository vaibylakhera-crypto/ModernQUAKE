import { lifts, liftBoxes, Lift } from './level';

// Lifts glide between two heights on a clock shared by every player (server time online), so everyone sees the same lift
// in the same place without any network messages: wait at the bottom, rise, wait at the top, descend.
const ease = (k: number) => k * k * (3 - 2 * k);
/** height of a lift's top surface at `tSec` seconds on the shared clock */
export function liftTop(l: Lift, tSec: number): number {
  const total = 2 * l.wait + 2 * l.travel;
  let t = (((tSec + l.phase) % total) + total) % total;
  if (t < l.wait) return l.y0; t -= l.wait;
  if (t < l.travel) return l.y0 + (l.y1 - l.y0) * ease(t / l.travel); t -= l.travel;
  if (t < l.wait) return l.y1; t -= l.wait;
  return l.y1 - (l.y1 - l.y0) * ease(t / l.travel);
}
/** true while the lift is about to move / moving (used for the glow on its edge) */
export function liftMoving(l: Lift, tSec: number): boolean {
  const total = 2 * l.wait + 2 * l.travel, t = (((tSec + l.phase) % total) + total) % total;
  return (t >= l.wait && t < l.wait + l.travel) || t >= 2 * l.wait + l.travel;
}

export interface Rider { x: number; y: number; z: number; vy: number }
export class LiftSystem {
  private prev: number[] = lifts.map(l => l.y0);
  /** move every lift to its place at `tSec` and carry anyone standing on one */
  update(tSec: number, riders: Rider[] = []) {
    for (let i = 0; i < lifts.length; i++) {
      const l = lifts[i], b = liftBoxes[i], top = liftTop(l, tSec), old = this.prev[i];
      b.max[1] = top; b.min[1] = top - 0.5;
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
