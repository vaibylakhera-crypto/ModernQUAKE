// Level data. Pure data so the server can import the same file later (shared sim).
export interface Box { min: [number, number, number]; max: [number, number, number]; tint?: number; kind?: 'pillar' | 'crates' }

export type BounceTier = 'small' | 'medium' | 'mega';
export interface BouncePad { kind: 'bounce'; pos: [number, number, number]; tier: BounceTier }
export interface JumpPad { kind: 'jump'; pos: [number, number, number]; target: [number, number, number] }
export type Pad = BouncePad | JumpPad;

export const BOUNCE_VY: Record<BounceTier, number> = { small: 11, medium: 16, mega: 26 };
export const GRAVITY = 25;

/** platform: centre x,z, top y, size x,z, thickness */
function plat(cx: number, top: number, cz: number, sx: number, sz: number, th = 1.2, tint = 0): Box {
  return { min: [cx - sx / 2, top - th, cz - sz / 2], max: [cx + sx / 2, top, cz + sz / 2], tint };
}
function pillar(cx: number, baseY: number, cz: number, s: number, h: number): Box {
  return { min: [cx - s / 2, baseY, cz - s / 2], max: [cx + s / 2, baseY + h, cz + s / 2], tint: 1, kind: 'pillar' };
}

// All platform sizes are multiples of 4 m so they tile with the kit's 4x4 m floor pieces.
export const boxes: Box[] = [
  // central arena
  plat(0, 0, 0, 32, 32, 1.5),
  // satellite platforms (N, E, S, W) at different heights
  plat(0, 4, -40, 16, 16, 1.2, 1),
  plat(40, 8, 0, 16, 16, 1.2, 2),
  plat(0, 12, 40, 16, 16, 1.2, 3),
  plat(-40, 6, 0, 16, 16, 1.2, 4),
  // high tower platform (power weapon spot)
  plat(0, 20, 0, 12, 12, 1),
  // corner cover on the central arena (kit columns, 1.4 m wide, 5 m tall)
  pillar(-10, 0, -10, 1.4, 5),
  pillar(10, 0, -10, 1.4, 5),
  pillar(-10, 0, 10, 1.4, 5),
  pillar(10, 0, 10, 1.4, 5),
  // low cover wall (crate row)
  { min: [-4, 0, -0.5], max: [4, 1.0, 0.5], tint: 1, kind: 'crates' },
  // narrow bridge (a movement challenge)
  plat(18, 3, -18, 4, 12, 0.5, 5),
];

export const spawns: { pos: [number, number, number]; yaw: number }[] = [
  { pos: [-12, 0, 0], yaw: -Math.PI / 2 },
  { pos: [12, 0, 12], yaw: Math.PI },
  { pos: [0, 0, -12], yaw: 0 },
];

export const pads: Pad[] = [
  // JUMP pads: fixed trajectory to a target (centre → satellites → tower)
  { kind: 'jump', pos: [0, 0, -12.5], target: [0, 4, -40] },
  { kind: 'jump', pos: [12.5, 0, 0], target: [40, 8, 0] },
  { kind: 'jump', pos: [0, 0, 12.5], target: [0, 12, 40] },
  { kind: 'jump', pos: [-12.5, 0, 0], target: [-40, 6, 0] },
  // satellites → tower and back
  { kind: 'jump', pos: [0, 4, -44], target: [0, 20, -1] },
  { kind: 'jump', pos: [44, 8, 0], target: [1, 20, 0] },
  { kind: 'jump', pos: [0, 12, 44], target: [0, 20, 1] },
  { kind: 'jump', pos: [-44, 6, 0], target: [-1, 20, 0] },
  { kind: 'jump', pos: [0, 20, 4], target: [0, 0, 8] },
  // BOUNCE pads: vertical launch by tier (momentum preserved)
  { kind: 'bounce', pos: [-6, 0, -6], tier: 'small' },
  { kind: 'bounce', pos: [6, 0, 6], tier: 'medium' },
  { kind: 'bounce', pos: [-6, 0, 6], tier: 'mega' },
  { kind: 'bounce', pos: [6, 0, -6], tier: 'small' },
];

/** Compute launch velocity from `from` to land at `to` with a given apex height above the higher point. */
export function jumpPadVelocity(from: [number, number, number], to: [number, number, number], apexExtra = 3): [number, number, number] {
  const dy = to[1] - from[1];
  const h = Math.max(dy, 0) + apexExtra;
  const vy = Math.sqrt(2 * GRAVITY * h);
  const tUp = vy / GRAVITY;
  const tDown = Math.sqrt(2 * (h - dy) / GRAVITY);
  const T = tUp + tDown;
  return [(to[0] - from[0]) / T, vy, (to[2] - from[2]) / T];
}
