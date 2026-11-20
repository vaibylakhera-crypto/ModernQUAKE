import type { WeaponId } from './weapons';

// Where each hand holds each weapon, in gun space (metres, before viewmodel scaling).
// right-hand grip centre z (grip() in weapons.ts); the blade is held around its handle
export const GRIP_Z: Record<WeaponId, number> = { blade: 0.02, pistol: 0.035, scatter: 0.1, nailer: 0.1, rocket: 0.0, arc: 0.08, rail: 0.1, plasma: 0.1 };

// support hand: cup = palm under a flat surface, wrap = fingers around a vertical grip box
export type Support = { type: 'cup'; y: number; z: number } | { type: 'wrap'; y: number; z: number; gw: number; gd: number } | null;
export const SUPPORT: Record<WeaponId, Support> = {
  blade: null, pistol: null,
  scatter: { type: 'cup', y: -0.118, z: -0.42 },
  nailer: { type: 'wrap', y: -0.14, z: -0.1, gw: 0.095, gd: 0.13 },
  rocket: { type: 'wrap', y: -0.1, z: -0.5, gw: 0.05, gd: 0.08 },
  arc: { type: 'cup', y: -0.11, z: -0.14 },
  rail: { type: 'cup', y: -0.135, z: -0.2 },
  plasma: { type: 'cup', y: -0.115, z: -0.12 },
};
