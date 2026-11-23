// Level data for every map. Pure data (no three.js) so the server could share it later.
// The map is chosen once per page load from ?map=… ; everything else imports the resolved arrays below.
export interface Box { min: [number, number, number]; max: [number, number, number]; tint?: number; kind?: 'pillar' | 'crates' }

export type BounceTier = 'small' | 'medium' | 'mega';
export interface BouncePad { kind: 'bounce'; pos: [number, number, number]; tier: BounceTier }
export interface JumpPad { kind: 'jump'; pos: [number, number, number]; target: [number, number, number] }
export type Pad = BouncePad | JumpPad;
/** step on `pos`, come out at `dest` facing `yaw` (0 = -Z), keeping your horizontal speed */
export interface Teleporter { pos: [number, number, number]; dest: [number, number, number]; yaw: number }
/** an area bots roam in (one flat floor) */
export interface BotZone { x0: number; x1: number; z0: number; z1: number; y: number }

export const BOUNCE_VY: Record<BounceTier, number> = { small: 11, medium: 16, mega: 26 };
export const GRAVITY = 25;

export type BoosterId = 'haste' | 'overdrive' | 'regen' | 'jump' | 'mega' | 'shield';
export type PickupDef =
  | { kind: 'weapon'; id: 'scatter' | 'nailer' | 'rocket' | 'arc' | 'rail' | 'plasma'; pos: [number, number, number] }
  | { kind: 'health'; amount: number; pos: [number, number, number] }
  | { kind: 'armor'; amount: number; pos: [number, number, number] }
  | { kind: 'booster'; id: BoosterId; pos: [number, number, number] };

export interface MapDef {
  id: string; boxes: Box[]; pads: Pad[]; spawns: { pos: [number, number, number]; yaw: number }[];
  pickups: PickupDef[]; teleporters: Teleporter[]; botZones: BotZone[];
}

/** platform: centre x,z, top y, size x,z, thickness */
function plat(cx: number, top: number, cz: number, sx: number, sz: number, th = 1.2, tint = 0): Box {
  return { min: [cx - sx / 2, top - th, cz - sz / 2], max: [cx + sx / 2, top, cz + sz / 2], tint };
}
function pillar(cx: number, baseY: number, cz: number, s: number, h: number): Box {
  return { min: [cx - s / 2, baseY, cz - s / 2], max: [cx + s / 2, baseY + h, cz + s / 2], tint: 1, kind: 'pillar' };
}
function wall(x0: number, z0: number, x1: number, z1: number, y: number, h = 1): Box {
  return { min: [x0, y, z0], max: [x1, y + h, z1], tint: 1, kind: 'crates' };
}
const W = Math.PI / 2;   // yaw helpers: facing +X = -W, facing -X = +W, facing +Z = PI, facing -Z = 0

// ───────────── IRON CRADLE / DEEP VOID (the original arena; no teleporters or boosters) ─────────────
const CRADLE: Omit<MapDef, 'id'> = {
  boxes: [
    plat(0, 0, 0, 32, 32, 1.5),
    plat(0, 4, -40, 16, 16, 1.2, 1), plat(40, 8, 0, 16, 16, 1.2, 2), plat(0, 12, 40, 16, 16, 1.2, 3), plat(-40, 6, 0, 16, 16, 1.2, 4),
    plat(0, 20, 0, 12, 12, 1),
    pillar(-10, 0, -10, 1.4, 5), pillar(10, 0, -10, 1.4, 5), pillar(-10, 0, 10, 1.4, 5), pillar(10, 0, 10, 1.4, 5),
    { min: [-4, 0, -0.5], max: [4, 1.0, 0.5], tint: 1, kind: 'crates' },
    plat(18, 3, -18, 4, 12, 0.5, 5),
  ],
  spawns: [{ pos: [-12, 0, 0], yaw: -W }, { pos: [12, 0, 12], yaw: Math.PI }, { pos: [0, 0, -12], yaw: 0 }],
  pads: [
    { kind: 'jump', pos: [0, 0, -12.5], target: [0, 4, -40] }, { kind: 'jump', pos: [12.5, 0, 0], target: [40, 8, 0] },
    { kind: 'jump', pos: [0, 0, 12.5], target: [0, 12, 40] }, { kind: 'jump', pos: [-12.5, 0, 0], target: [-40, 6, 0] },
    { kind: 'jump', pos: [0, 4, -44], target: [0, 20, -1] }, { kind: 'jump', pos: [44, 8, 0], target: [1, 20, 0] },
    { kind: 'jump', pos: [0, 12, 44], target: [0, 20, 1] }, { kind: 'jump', pos: [-44, 6, 0], target: [-1, 20, 0] },
    { kind: 'jump', pos: [0, 20, 4], target: [0, 0, 8] },
    { kind: 'bounce', pos: [-6, 0, -6], tier: 'small' }, { kind: 'bounce', pos: [6, 0, 6], tier: 'medium' },
    { kind: 'bounce', pos: [-6, 0, 6], tier: 'mega' }, { kind: 'bounce', pos: [6, 0, -6], tier: 'small' },
  ],
  pickups: [
    { kind: 'weapon', id: 'scatter', pos: [-8, 0, 12] }, { kind: 'weapon', id: 'nailer', pos: [8, 0, -12] },
    { kind: 'weapon', id: 'rocket', pos: [0, 20, -3] }, { kind: 'weapon', id: 'arc', pos: [38, 8, -3] },
    { kind: 'weapon', id: 'rail', pos: [3, 4, -38] }, { kind: 'weapon', id: 'plasma', pos: [-38, 6, 3] },
    { kind: 'health', amount: 50, pos: [0, 12, 38] }, { kind: 'armor', amount: 50, pos: [18, 3, -18] },
    { kind: 'health', amount: 25, pos: [-12, 0, -12] }, { kind: 'armor', amount: 25, pos: [12, 0, 12] },
    { kind: 'weapon', id: 'scatter', pos: [38, 8, 4] }, { kind: 'weapon', id: 'nailer', pos: [-38, 6, -4] },
  ],
  teleporters: [],
  botZones: [{ x0: -13.2, x1: 13.2, z0: -13.2, z1: 13.2, y: 0 }],
};

// ───────────── SPIRE RING ─────────────
// Hub with bridges north/south, raised east/west decks on jump pads, four high corner perches linked by teleporters,
// and a floating spire in the middle holding OVERDRIVE.
const SPIRE: Omit<MapDef, 'id'> = {
  boxes: [
    plat(0, 0, 0, 24, 24, 1.5, 0),                                   // hub
    pillar(-7, 0, -7, 1.4, 4), pillar(7, 0, -7, 1.4, 4), pillar(-7, 0, 7, 1.4, 4), pillar(7, 0, 7, 1.4, 4),
    wall(-3, -0.5, 3, 0.5, 0),                                       // low cover in the middle of the hub
    plat(0, 0, -21, 4, 18, 0.6, 5), plat(0, 0, 21, 4, 18, 0.6, 5),   // bridges
    plat(0, 0, -36, 16, 12, 1.2, 1), plat(0, 0, 36, 16, 12, 1.2, 3), // north / south decks
    wall(-6, -38, -2, -37, 0), wall(2, 35, 6, 36, 0),
    plat(36, 6, 0, 14, 16, 1.2, 2), plat(-36, 6, 0, 14, 16, 1.2, 4), // east / west decks
    pillar(36, 6, 6, 1.2, 3), pillar(-36, 6, -6, 1.2, 3),
    plat(30, 10, -30, 10, 10, 1, 2), plat(-30, 10, -30, 10, 10, 1, 4), plat(30, 10, 30, 10, 10, 1, 3), plat(-30, 10, 30, 10, 10, 1, 1),   // perches
    plat(0, 16, 0, 8, 8, 1, 5),                                      // spire top
  ],
  spawns: [{ pos: [-9, 0, 0], yaw: -W }, { pos: [9, 0, 0], yaw: W }, { pos: [0, 0, -34], yaw: Math.PI }, { pos: [0, 0, 34], yaw: 0 }],
  pads: [
    { kind: 'jump', pos: [10, 0, 0], target: [33, 6, 0] }, { kind: 'jump', pos: [-10, 0, 0], target: [-33, 6, 0] },
    { kind: 'jump', pos: [31, 6, 5], target: [9, 0, 3] }, { kind: 'jump', pos: [-31, 6, -5], target: [-9, 0, -3] },
    { kind: 'jump', pos: [40, 6, 5], target: [30, 10, 29] }, { kind: 'jump', pos: [-40, 6, -5], target: [-30, 10, -29] },
    { kind: 'jump', pos: [31, 6, -5], target: [2, 16, 0] }, { kind: 'jump', pos: [-31, 6, 5], target: [-2, 16, 0] },
    { kind: 'jump', pos: [0, 16, 2.5], target: [0, 0, 34] },
    { kind: 'bounce', pos: [-9, 0, 9], tier: 'medium' }, { kind: 'bounce', pos: [9, 0, -9], tier: 'medium' },
  ],
  teleporters: [
    { pos: [-6, 0, -39], dest: [-28, 10, 28], yaw: -3 * Math.PI / 4 },   // north deck  -> SW perch
    { pos: [6, 0, 39], dest: [28, 10, -28], yaw: W / 2 },                // south deck  -> NE perch
    { pos: [33, 10, -33], dest: [-5, 0, 6], yaw: Math.PI / 2 + 0.6 },   // NE perch -> hub
    { pos: [-33, 10, 33], dest: [5, 0, -6], yaw: -Math.PI / 2 + 0.6 },  // SW perch -> hub
    { pos: [-33, 10, -33], dest: [0, 0, 33], yaw: 0 },                   // NW perch -> south deck
    { pos: [33, 10, 33], dest: [0, 0, -33], yaw: Math.PI },              // SE perch -> north deck
  ],
  pickups: [
    { kind: 'booster', id: 'overdrive', pos: [0, 16, -1.5] },
    { kind: 'booster', id: 'haste', pos: [4, 0, -36] }, { kind: 'booster', id: 'regen', pos: [-4, 0, 36] },
    { kind: 'booster', id: 'jump', pos: [-38, 6, 4] }, { kind: 'booster', id: 'shield', pos: [30, 10, -28] }, { kind: 'booster', id: 'mega', pos: [-30, 10, 28] },
    { kind: 'weapon', id: 'nailer', pos: [-4, 0, -9] }, { kind: 'weapon', id: 'scatter', pos: [4, 0, 9] },
    { kind: 'weapon', id: 'plasma', pos: [38, 6, -2] }, { kind: 'weapon', id: 'arc', pos: [-38, 6, 2] },
    { kind: 'weapon', id: 'rail', pos: [-30, 10, -28] }, { kind: 'weapon', id: 'rocket', pos: [30, 10, 28] },
    { kind: 'health', amount: 25, pos: [-10, 0, -10] }, { kind: 'health', amount: 25, pos: [10, 0, 10] },
    { kind: 'armor', amount: 25, pos: [10, 0, -10] }, { kind: 'armor', amount: 25, pos: [-10, 0, 10] },
  ],
  botZones: [{ x0: -10.5, x1: 10.5, z0: -10.5, z1: 10.5, y: 0 }, { x0: -6.5, x1: 6.5, z0: -40.5, z1: -31.5, y: 0 }, { x0: -6.5, x1: 6.5, z0: 31.5, z1: 40.5, y: 0 }],
};

// ───────────── TWIN BASTIONS ─────────────
// Two fortress bases face each other across the void, joined by two sky bridges. A sunken island sits between them
// (OVERDRIVE). Each base's back corner teleports to the other base's flank; balconies drop-teleport to the island.
const BASTION: Omit<MapDef, 'id'> = {
  boxes: [
    plat(-30, 4, 0, 20, 24, 1.5, 4), plat(30, 4, 0, 20, 24, 1.5, 2),     // bases
    wall(-26, -4, -25, 4, 4, 1.1), wall(25, -4, 26, 4, 4, 1.1),          // cover walls at the base fronts
    pillar(-34, 4, -8, 1.4, 4), pillar(-34, 4, 8, 1.4, 4), pillar(34, 4, -8, 1.4, 4), pillar(34, 4, 8, 1.4, 4),
    plat(-37, 9, 0, 6, 10, 1, 4), plat(37, 9, 0, 6, 10, 1, 2),           // balconies
    plat(0, 4, -10, 40, 3, 0.5, 5), plat(0, 4, 10, 40, 3, 0.5, 5),       // sky bridges
    plat(0, 0, 0, 14, 14, 1.2, 0),                                       // sunken island
    pillar(-4, 0, -4, 1.2, 3), pillar(4, 0, 4, 1.2, 3),
  ],
  spawns: [{ pos: [-30, 4, -6], yaw: -W }, { pos: [30, 4, 6], yaw: W }, { pos: [-30, 4, 6], yaw: -W }, { pos: [30, 4, -6], yaw: W }],
  pads: [
    { kind: 'jump', pos: [-31, 4, 0], target: [-36.5, 9, 0] }, { kind: 'jump', pos: [31, 4, 0], target: [36.5, 9, 0] },
    { kind: 'jump', pos: [-5, 0, 0], target: [-23, 4, 0] }, { kind: 'jump', pos: [5, 0, 0], target: [23, 4, 0] },
    { kind: 'bounce', pos: [0, 0, -4.5], tier: 'small' }, { kind: 'bounce', pos: [0, 0, 4.5], tier: 'small' },
  ],
  teleporters: [
    { pos: [-38, 4, -10], dest: [36, 4, 10], yaw: W },                   // west back corner -> east flank
    { pos: [38, 4, 10], dest: [-36, 4, -10], yaw: -W },                  // east back corner -> west flank
    { pos: [-38.5, 9, 3.5], dest: [-3, 0, -3], yaw: -W },                // west balcony -> island
    { pos: [38.5, 9, -3.5], dest: [3, 0, 3], yaw: W },                   // east balcony -> island
  ],
  pickups: [
    { kind: 'booster', id: 'overdrive', pos: [0, 0, 0] },
    { kind: 'booster', id: 'haste', pos: [0, 4, -10] }, { kind: 'booster', id: 'regen', pos: [0, 4, 10] },
    { kind: 'booster', id: 'mega', pos: [-37, 9, -3] }, { kind: 'booster', id: 'shield', pos: [37, 9, 3] },
    { kind: 'booster', id: 'jump', pos: [5, 0, -5] },
    { kind: 'weapon', id: 'rail', pos: [-37, 9, 2] }, { kind: 'weapon', id: 'rail', pos: [37, 9, -2] },
    { kind: 'weapon', id: 'rocket', pos: [-5, 0, 5] },
    { kind: 'weapon', id: 'plasma', pos: [-30, 4, 9] }, { kind: 'weapon', id: 'plasma', pos: [30, 4, -9] },
    { kind: 'weapon', id: 'nailer', pos: [-30, 4, -9] }, { kind: 'weapon', id: 'nailer', pos: [30, 4, 9] },
    { kind: 'weapon', id: 'scatter', pos: [-22, 4, 0] }, { kind: 'weapon', id: 'scatter', pos: [22, 4, 0] },
    { kind: 'health', amount: 25, pos: [-12, 4, -10] }, { kind: 'health', amount: 25, pos: [12, 4, 10] },
    { kind: 'armor', amount: 25, pos: [12, 4, -10] }, { kind: 'armor', amount: 25, pos: [-12, 4, 10] },
  ],
  botZones: [{ x0: -38.5, x1: -21.5, z0: -10.5, z1: 10.5, y: 4 }, { x0: 21.5, x1: 38.5, z0: -10.5, z1: 10.5, y: 4 }],
};

export const MAPS: Record<string, MapDef> = {
  boreal: { id: 'boreal', ...CRADLE },
  void: { id: 'void', ...CRADLE },
  spire: { id: 'spire', ...SPIRE },
  bastion: { id: 'bastion', ...BASTION },
};
function pickMap(): string {
  try { const m = new URLSearchParams(location.search).get('map') || ''; return m in MAPS ? m : 'boreal'; } catch { return 'boreal'; }
}
export const MAP_ID = typeof location === 'undefined' ? 'boreal' : pickMap();
const DEF = MAPS[MAP_ID];
export const boxes = DEF.boxes;
export const pads = DEF.pads;
export const spawns = DEF.spawns;
export const pickups = DEF.pickups;
export const teleporters = DEF.teleporters;
export const botZones = DEF.botZones;

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
