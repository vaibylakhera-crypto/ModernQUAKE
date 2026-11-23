// Level data for every map. Pure data (no three.js) so the server could share it later.
// The map is chosen once per page load from ?map=… ; everything else imports the resolved arrays below.
export interface Box { min: [number, number, number]; max: [number, number, number]; tint?: number; kind?: 'pillar' | 'crates' | 'block' | 'floor' | 'light' | 'lift' }

export type BounceTier = 'small' | 'medium' | 'mega';
export interface BouncePad { kind: 'bounce'; pos: [number, number, number]; tier: BounceTier }
export interface JumpPad { kind: 'jump'; pos: [number, number, number]; target: [number, number, number] }
export type Pad = BouncePad | JumpPad;
/** step on `pos`, come out at `dest` facing `yaw` (0 = -Z), keeping your horizontal speed */
export interface Teleporter { pos: [number, number, number]; dest: [number, number, number]; yaw: number }
/**
 * A lift: a platform that glides between two heights on a fixed clock (so every player sees the same lift).
 * It waits `wait` seconds at each end and takes `travel` seconds to move. y0/y1 are the heights of its top surface.
 */
export interface Lift { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; wait: number; travel: number; phase: number }
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

/** mood of a map: lights, fog, a colour multiplier for the level textures and the colour of the wall lamps */
export interface MapTheme { fog: number; fogD: number; hemiSky: number; hemiGround: number; ambient: number; key: number; rim: number; lamp: number; tint: [number, number, number] }
const T_DEFAULT: MapTheme = { fog: 0x060405, fogD: 0.0075, hemiSky: 0xd8c4a8, hemiGround: 0x141016, ambient: 0x3a4a40, key: 0xffc890, rim: 0x5a6a90, lamp: 0xffa050, tint: [1, 1, 1] };
export interface MapDef {
  id: string; name: string; desc: string; theme: MapTheme;
  boxes: Box[]; pads: Pad[]; spawns: { pos: [number, number, number]; yaw: number }[];
  pickups: PickupDef[]; teleporters: Teleporter[]; botZones: BotZone[];
  lifts?: Lift[];
  /** capture-the-flag bases (maps without them only offer deathmatch modes) */
  flags?: { red: [number, number, number]; blue: [number, number, number] };
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
/** solid wall / ceiling block (all faces use the wall texture) */
function block(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box {
  return { min: [x0, y0, z0], max: [x1, y1, z1], tint: 1, kind: 'block' };
}
/** flat indoor floor slab (no hull, no rock underneath: you can't see it from outside) */
function floorSlab(x0: number, z0: number, x1: number, z1: number, top: number, th = 0.6): Box {
  return { min: [x0, top - th, z0], max: [x1, top, z1], tint: 0, kind: 'floor' };
}
/** a glowing ceiling light strip */
function light(x0: number, z0: number, x1: number, z1: number, y: number): Box {
  return { min: [x0, y - 0.15, z0], max: [x1, y, z1], kind: 'light' };
}
const lift = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, phase = 0, wait = 2.5, travel = 1.8): Lift => ({ x0, x1, z0, z1, y0, y1, wait, travel, phase });
const W = Math.PI / 2;   // yaw helpers: facing +X = -W, facing -X = +W, facing +Z = PI, facing -Z = 0

// ───────────── IRON CRADLE / DEEP VOID (the original arena; no teleporters or boosters) ─────────────
const CRADLE: Omit<MapDef, 'id' | 'name' | 'desc'> = {
  theme: T_DEFAULT,
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
const SPIRE: Omit<MapDef, 'id' | 'name' | 'desc'> = {
  theme: { fog: 0x0a0614, fogD: 0.0075, hemiSky: 0xc8b0ff, hemiGround: 0x100820, ambient: 0x3a3060, key: 0xd0b8ff, rim: 0x6a50c0, lamp: 0xb080ff, tint: [1.0, 0.92, 1.22] },
  flags: { red: [-9, 0, 0], blue: [9, 0, 0] },
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
const BASTION: Omit<MapDef, 'id' | 'name' | 'desc'> = {
  theme: { fog: 0x040810, fogD: 0.007, hemiSky: 0xa8c8ff, hemiGround: 0x080c18, ambient: 0x283a58, key: 0xb8d4ff, rim: 0x4070c0, lamp: 0x60a8ff, tint: [0.88, 1.0, 1.22] },
  flags: { red: [-34, 4, 0], blue: [34, 4, 0] },
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

// ───────────── FOUNDRY ─────────────
// A walled industrial hall (40x32) with a catwalk loop 5 m up. The loop is fast and exposed; the floor is cover-rich.
// Rocket and rail sit on opposite catwalks, mega health on the low reactor in the middle, jump pads and bounce pads lift you up,
// and two teleporters throw you across the hall.
const FOUNDRY: Omit<MapDef, 'id' | 'name' | 'desc'> = {
  theme: { fog: 0x120804, fogD: 0.006, hemiSky: 0xffb070, hemiGround: 0x1a0c06, ambient: 0x70402a, key: 0xff9a50, rim: 0x803018, lamp: 0xff7a28, tint: [1.3, 0.92, 0.7] },
  flags: { red: [-17, 0, 0], blue: [17, 0, 0] },
  boxes: [
    plat(0, 0, 0, 40, 32, 1.5, 0),
    block(-21, -1.5, -17, 21, 11, -16), block(-21, -1.5, 16, 21, 11, 17), block(-21, -1.5, -16, -20, 11, 16), block(20, -1.5, -16, 21, 11, 16),
    block(-21, 11, -17, 21, 12, 17),                                                    // ceiling: a sealed building
    light(-12, -8, 12, -6, 11), light(-12, 6, 12, 8, 11), light(-14, -1, -10, 1, 11), light(10, -1, 14, 1, 11), light(-2, -14, 2, -12, 11), light(-2, 12, 2, 14, 11),
    plat(0, 5, -13.5, 40, 5, 0.6, 2), plat(0, 5, 13.5, 40, 5, 0.6, 4), plat(-17.5, 5, 0, 5, 22, 0.6, 3), plat(17.5, 5, 0, 5, 22, 0.6, 1),
    plat(0, 1.2, 0, 8, 8, 1.2, 5),
    pillar(-8, 0, -5, 1.4, 5), pillar(8, 0, -5, 1.4, 5), pillar(-8, 0, 5, 1.4, 5), pillar(8, 0, 5, 1.4, 5),
    wall(-6, -10, -1.5, -9, 0), wall(1.5, 9, 6, 10, 0), wall(-14, -1, -13, 3, 0, 1.2), wall(13, -3, 14, 1, 0, 1.2),
  ],
  spawns: [{ pos: [-16, 0, -10], yaw: -W }, { pos: [16, 0, 10], yaw: W }, { pos: [-16, 0, 10], yaw: -W }, { pos: [16, 0, -10], yaw: W }],
  pads: [
    { kind: 'jump', pos: [-12, 0, -8], target: [-12, 5, -13.5] }, { kind: 'jump', pos: [12, 0, 8], target: [12, 5, 13.5] },
    { kind: 'jump', pos: [-16, 0, 6], target: [-17.5, 5, 8] }, { kind: 'jump', pos: [16, 0, -6], target: [17.5, 5, -8] },
    { kind: 'bounce', pos: [-10, 0, 0], tier: 'medium' }, { kind: 'bounce', pos: [10, 0, 0], tier: 'medium' },
  ],
  teleporters: [
    { pos: [17.5, 5, 10], dest: [-16, 0, -7], yaw: -W },
    { pos: [-17.5, 5, -10], dest: [16, 0, 7], yaw: W },
  ],
  pickups: [
    { kind: 'booster', id: 'mega', pos: [0, 1.2, 0] },
    { kind: 'weapon', id: 'rocket', pos: [0, 5, -13.5] }, { kind: 'weapon', id: 'rail', pos: [0, 5, 13.5] },
    { kind: 'weapon', id: 'plasma', pos: [-17.5, 5, 0] }, { kind: 'weapon', id: 'nailer', pos: [17.5, 5, 0] },
    { kind: 'weapon', id: 'scatter', pos: [-9, 0, 9] }, { kind: 'weapon', id: 'scatter', pos: [9, 0, -9] }, { kind: 'weapon', id: 'arc', pos: [0, 0, 13] },
    { kind: 'booster', id: 'overdrive', pos: [-18, 5, -14] }, { kind: 'booster', id: 'haste', pos: [18, 5, 14] },
    { kind: 'booster', id: 'regen', pos: [18, 5, -14] }, { kind: 'booster', id: 'shield', pos: [-18, 5, 14] },
    { kind: 'health', amount: 25, pos: [-18, 0, -14] }, { kind: 'health', amount: 25, pos: [18, 0, 14] },
    { kind: 'armor', amount: 25, pos: [-18, 0, 14] }, { kind: 'armor', amount: 25, pos: [18, 0, -14] },
  ],
  botZones: [{ x0: -18, x1: 18, z0: -14, z1: 14, y: 0 }],
  lifts: [lift(-16, 7, -12, 11, 0, 5, 0), lift(12, -11, 16, -7, 0, 5, 3)],   // up to the south-west / north-east catwalks
};

// ───────────── CRYPT ─────────────
// A tight 60x28 tomb: three halls joined by narrow doorways (walls to 6 m), with a catwalk along the north and south walls.
// Corridors, doorways and corners make this close-quarters; teleporters connect the far corners.
const CRYPT: Omit<MapDef, 'id' | 'name' | 'desc'> = {
  theme: { fog: 0x03100e, fogD: 0.013, hemiSky: 0x90e8d0, hemiGround: 0x04120e, ambient: 0x2c6e60, key: 0x70ffd0, rim: 0x20605a, lamp: 0x50ffc0, tint: [0.78, 1.18, 1.05] },
  flags: { red: [-27, 0, 0], blue: [27, 0, 0] },
  boxes: [
    plat(0, 0, 0, 60, 28, 1.5, 0),
    block(-31, -1.5, -15, 31, 12, -14), block(-31, -1.5, 14, 31, 12, 15), block(-31, -1.5, -14, -30, 12, 14), block(30, -1.5, -14, 31, 12, 14),
    block(-31, 12, -15, 31, 13, 15),                                                    // ceiling
    light(-26, -1, -22, 1, 12), light(-2, -1, 2, 1, 12), light(22, -1, 26, 1, 12), light(-16, -8, -12, -6, 12), light(12, 6, 16, 8, 12),
    block(-10.5, -1.5, -14, -9.5, 6, -2.5), block(-10.5, -1.5, 2.5, -9.5, 6, 14),
    block(9.5, -1.5, -14, 10.5, 6, -2.5), block(9.5, -1.5, 2.5, 10.5, 6, 14),
    plat(0, 6, -11.5, 60, 5, 0.6, 3), plat(0, 6, 11.5, 60, 5, 0.6, 3),
    pillar(-20, 0, -5, 1.6, 5), pillar(-20, 0, 5, 1.6, 5), pillar(20, 0, -5, 1.6, 5), pillar(20, 0, 5, 1.6, 5), pillar(0, 0, -5, 1.6, 5), pillar(0, 0, 5, 1.6, 5),
    wall(-26, -1, -24, 1, 0, 1.2), wall(24, -1, 26, 1, 0, 1.2),
  ],
  spawns: [{ pos: [-27, 0, -6], yaw: -W }, { pos: [27, 0, 6], yaw: W }, { pos: [-27, 0, 6], yaw: -W }, { pos: [27, 0, -6], yaw: W }],
  pads: [
    { kind: 'jump', pos: [-26, 0, -9], target: [-26, 6, -11.5] }, { kind: 'jump', pos: [26, 0, 9], target: [26, 6, 11.5] },
    { kind: 'jump', pos: [0, 0, -8], target: [0, 6, -11.5] }, { kind: 'jump', pos: [0, 0, 8], target: [0, 6, 11.5] },
    { kind: 'bounce', pos: [-15, 0, 0], tier: 'small' }, { kind: 'bounce', pos: [15, 0, 0], tier: 'small' },
  ],
  teleporters: [
    { pos: [-28, 0, 12], dest: [28, 0, -10], yaw: W },
    { pos: [28, 0, -12], dest: [-28, 0, 10], yaw: -W },
    { pos: [-29, 6, 11.5], dest: [0, 0, 2], yaw: 0 },
    { pos: [29, 6, -11.5], dest: [0, 0, -2], yaw: Math.PI },
  ],
  pickups: [
    { kind: 'booster', id: 'mega', pos: [0, 0, 0] },
    { kind: 'weapon', id: 'rail', pos: [0, 6, -11.5] }, { kind: 'weapon', id: 'rocket', pos: [0, 6, 11.5] },
    { kind: 'weapon', id: 'scatter', pos: [-15, 0, -8] }, { kind: 'weapon', id: 'scatter', pos: [15, 0, 8] },
    { kind: 'weapon', id: 'nailer', pos: [-22, 6, -11.5] }, { kind: 'weapon', id: 'plasma', pos: [22, 6, 11.5] }, { kind: 'weapon', id: 'arc', pos: [-22, 6, 11.5] },
    { kind: 'booster', id: 'overdrive', pos: [27, 6, -11.5] }, { kind: 'booster', id: 'haste', pos: [-27, 6, 11.5] },
    { kind: 'booster', id: 'regen', pos: [-12, 0, 11] }, { kind: 'booster', id: 'shield', pos: [12, 0, -11] },
    { kind: 'health', amount: 25, pos: [-27, 0, -12] }, { kind: 'health', amount: 25, pos: [27, 0, 12] },
    { kind: 'armor', amount: 25, pos: [-27, 0, 12] }, { kind: 'armor', amount: 25, pos: [27, 0, -12] },
  ],
  botZones: [{ x0: -28, x1: 28, z0: -12, z1: 12, y: 0 }],
  lifts: [lift(-18, -9, -14, -5, 0, 6, 0), lift(14, 5, 18, 9, 0, 6, 3)],
};

// ───────────── TOWER ─────────────
// A sealed three-storey building (40x28). The atrium in the middle drops to the ground floor; two lifts there carry you up to the
// mezzanine, jump pads throw you to the narrow top gallery, and the teleporters at the gallery corners send you back to the ground.
// Rocket and rail are on the gallery, mega health sits in the atrium between the lifts.
const TOWER: Omit<MapDef, 'id' | 'name' | 'desc'> = {
  theme: { fog: 0x0a0a12, fogD: 0.007, hemiSky: 0xc0c8e8, hemiGround: 0x14121c, ambient: 0x58587a, key: 0xd8d8ff, rim: 0x5060a0, lamp: 0xffe0a0, tint: [0.92, 0.95, 1.1] },
  flags: { red: [-17, 0, 0], blue: [17, 0, 0] },
  boxes: [
    floorSlab(-20, -14, 20, 14, 0, 1.5),
    block(-21, -1.5, -15, 21, 19, -14), block(-21, -1.5, 14, 21, 19, 15), block(-21, -1.5, -14, -20, 19, 14), block(20, -1.5, -14, 21, 19, 14),
    block(-21, 18, -15, 21, 19, 15),                                                    // ceiling
    light(-14, -2, -10, 2, 18), light(10, -2, 14, 2, 18), light(-2, -10, 2, -6, 18), light(-2, 6, 2, 10, 18), light(-2, -2, 2, 2, 18),
    // mezzanine (y=6): four plates around a 12x10 atrium
    floorSlab(-20, -14, -6, 14, 6), floorSlab(6, -14, 20, 14, 6), floorSlab(-6, -14, 6, -5, 6), floorSlab(-6, 5, 6, 14, 6),
    // top gallery (y=12): a ring of narrow walkways along the walls
    floorSlab(-20, -14, 20, -10, 12), floorSlab(-20, 10, 20, 14, 12), floorSlab(-20, -10, -16, 10, 12), floorSlab(16, -10, 20, 10, 12),
    pillar(-10, 6, -8, 1.2, 6), pillar(10, 6, -8, 1.2, 6), pillar(-10, 6, 8, 1.2, 6), pillar(10, 6, 8, 1.2, 6),
    pillar(-10, 0, -9, 1.4, 6), pillar(10, 0, 9, 1.4, 6),
    wall(-14, -4, -13, 4, 0, 1.2), wall(13, -4, 14, 4, 0, 1.2),
  ],
  spawns: [{ pos: [-16, 0, -9], yaw: -W }, { pos: [16, 0, 9], yaw: W }, { pos: [-16, 0, 9], yaw: -W }, { pos: [16, 0, -9], yaw: W }],
  pads: [
    { kind: 'jump', pos: [-18, 6, 8], target: [-18, 12, 4] }, { kind: 'jump', pos: [18, 6, -8], target: [18, 12, -4] },
    { kind: 'jump', pos: [-12, 6, 0], target: [-12, 12, 12] }, { kind: 'jump', pos: [12, 6, 0], target: [12, 12, -12] },
    { kind: 'bounce', pos: [-12, 0, 8], tier: 'medium' }, { kind: 'bounce', pos: [12, 0, -8], tier: 'medium' },
  ],
  teleporters: [
    { pos: [-18, 12, -12], dest: [17, 0, 11], yaw: W }, { pos: [18, 12, 12], dest: [-17, 0, -11], yaw: -W },
    { pos: [-18, 12, 12], dest: [0, 6, -9.5], yaw: Math.PI }, { pos: [18, 12, -12], dest: [0, 6, 9.5], yaw: 0 },
  ],
  pickups: [
    { kind: 'booster', id: 'mega', pos: [0, 0, 0] },
    { kind: 'weapon', id: 'rocket', pos: [0, 12, -12] }, { kind: 'weapon', id: 'rail', pos: [0, 12, 12] },
    { kind: 'weapon', id: 'plasma', pos: [-18, 12, 0] }, { kind: 'weapon', id: 'nailer', pos: [18, 12, 0] },
    { kind: 'weapon', id: 'scatter', pos: [-8, 0, 0] }, { kind: 'weapon', id: 'scatter', pos: [8, 0, 0] }, { kind: 'weapon', id: 'arc', pos: [0, 6, -12] },
    { kind: 'booster', id: 'overdrive', pos: [0, 6, 12] }, { kind: 'booster', id: 'haste', pos: [-17, 6, -12] }, { kind: 'booster', id: 'regen', pos: [17, 6, 12] },
    { kind: 'booster', id: 'shield', pos: [-17, 6, 12] }, { kind: 'booster', id: 'jump', pos: [17, 6, -12] },
    { kind: 'health', amount: 25, pos: [-18, 0, -12] }, { kind: 'health', amount: 25, pos: [18, 0, 12] },
    { kind: 'armor', amount: 25, pos: [-18, 0, 12] }, { kind: 'armor', amount: 25, pos: [18, 0, -12] },
  ],
  botZones: [{ x0: -18, x1: 18, z0: -12, z1: 12, y: 0 }],
  lifts: [lift(-2, -4.8, 2, -0.8, 0, 6, 0), lift(-2, 0.8, 2, 4.8, 0, 6, 2.2)],
};

// ───────────── RING ─────────────
// A square loop of 10 m-wide strips around a bottomless void: you can run the whole ring but a mistake is a fall.
// The tower in the middle (rail + overdrive) is only reachable by the four launch pads on the strips; the corner
// teleporters cut across the diagonal. Long sight lines along the strips make it the sniper's map.
const RING: Omit<MapDef, 'id' | 'name' | 'desc'> = {
  theme: { fog: 0x140408, fogD: 0.0045, hemiSky: 0xffa0a0, hemiGround: 0x180408, ambient: 0x502028, key: 0xff6a50, rim: 0x802040, lamp: 0xff4060, tint: [1.22, 0.84, 0.92] },
  flags: { red: [-30, 0, 0], blue: [30, 0, 0] },
  boxes: [
    plat(0, 0, -30, 50, 10, 1.2, 1), plat(0, 0, 30, 50, 10, 1.2, 3), plat(-30, 0, 0, 10, 50, 1.2, 4), plat(30, 0, 0, 10, 50, 1.2, 2),
    plat(-30, 0, -30, 10, 10, 1.2, 5), plat(30, 0, -30, 10, 10, 1.2, 5), plat(-30, 0, 30, 10, 10, 1.2, 5), plat(30, 0, 30, 10, 10, 1.2, 5),
    plat(0, 10, 0, 12, 12, 1.2, 0),
    pillar(-30, 0, -30, 1.4, 4), pillar(30, 0, -30, 1.4, 4), pillar(-30, 0, 30, 1.4, 4), pillar(30, 0, 30, 1.4, 4),
    wall(-14, -32, -10, -31, 0, 1.2), wall(10, -29, 14, -28, 0, 1.2), wall(-14, 28, -10, 29, 0, 1.2), wall(10, 31, 14, 32, 0, 1.2),
    wall(-32, -14, -31, -10, 0, 1.2), wall(-29, 10, -28, 14, 0, 1.2), wall(31, -14, 32, -10, 0, 1.2), wall(28, 10, 29, 14, 0, 1.2),
  ],
  spawns: [{ pos: [-30, 0, -8], yaw: 0 }, { pos: [30, 0, 8], yaw: Math.PI }, { pos: [-8, 0, 30], yaw: -W }, { pos: [8, 0, -30], yaw: W }],
  pads: [
    { kind: 'jump', pos: [0, 0, -26], target: [0, 10, -3] }, { kind: 'jump', pos: [0, 0, 26], target: [0, 10, 3] },
    { kind: 'jump', pos: [-26, 0, 0], target: [-3, 10, 0] }, { kind: 'jump', pos: [26, 0, 0], target: [3, 10, 0] },
    { kind: 'jump', pos: [4.5, 10, 4.5], target: [0, 0, -27] },
    { kind: 'bounce', pos: [-20, 0, -30], tier: 'small' }, { kind: 'bounce', pos: [20, 0, 30], tier: 'small' },
  ],
  teleporters: [
    { pos: [-30, 0, -30], dest: [29, 0, 29], yaw: Math.PI / 2 + 0.8 }, { pos: [30, 0, 30], dest: [-29, 0, -29], yaw: -Math.PI / 2 - 0.8 + Math.PI },
    { pos: [30, 0, -30], dest: [-29, 0, 29], yaw: -Math.PI / 4 }, { pos: [-30, 0, 30], dest: [29, 0, -29], yaw: Math.PI * 3 / 4 },
  ],
  pickups: [
    { kind: 'weapon', id: 'rail', pos: [0, 10, 0] }, { kind: 'booster', id: 'overdrive', pos: [3, 10, -3] },
    { kind: 'weapon', id: 'rocket', pos: [0, 0, -34] }, { kind: 'weapon', id: 'rocket', pos: [0, 0, 34] },
    { kind: 'weapon', id: 'plasma', pos: [-34, 0, 0] }, { kind: 'weapon', id: 'nailer', pos: [34, 0, 0] },
    { kind: 'weapon', id: 'scatter', pos: [-14, 0, -30] }, { kind: 'weapon', id: 'scatter', pos: [14, 0, 30] }, { kind: 'weapon', id: 'arc', pos: [-30, 0, 14] },
    { kind: 'booster', id: 'haste', pos: [-30, 0, -14] }, { kind: 'booster', id: 'jump', pos: [30, 0, 14] },
    { kind: 'booster', id: 'regen', pos: [14, 0, -30] }, { kind: 'booster', id: 'shield', pos: [-14, 0, 30] }, { kind: 'booster', id: 'mega', pos: [30, 0, -14] },
    { kind: 'health', amount: 25, pos: [-24, 0, -30] }, { kind: 'health', amount: 25, pos: [24, 0, 30] },
    { kind: 'armor', amount: 25, pos: [30, 0, 24] }, { kind: 'armor', amount: 25, pos: [-30, 0, -24] },
  ],
  botZones: [{ x0: -34, x1: 34, z0: -34, z1: -26, y: 0 }],
};

export const MAPS: Record<string, MapDef> = {
  boreal: { id: 'boreal', name: 'IRON CRADLE', desc: 'Floating islands, jump pads, one high tower', ...CRADLE },
  void: { id: 'void', name: 'DEEP VOID', desc: 'The same arena in a darker, colder light', ...CRADLE, theme: { ...T_DEFAULT, hemiSky: 0x9aa8d0, key: 0xb0bce0, ambient: 0x2a3048, lamp: 0x80a0ff, tint: [0.8, 0.88, 1.1] } },
  spire: { id: 'spire', name: 'SPIRE RING', desc: 'Hub, bridges, high perches and a spire. 6 teleporters', ...SPIRE },
  bastion: { id: 'bastion', name: 'TWIN BASTIONS', desc: 'Two fortresses facing off over a sunken island', ...BASTION },
  foundry: { id: 'foundry', name: 'FOUNDRY', desc: 'Sealed hall with a catwalk loop, lifts and a reactor core', ...FOUNDRY },
  crypt: { id: 'crypt', name: 'CRYPT', desc: 'Sealed halls and doorways, lifts to the catwalks. Close-quarters', ...CRYPT },
  ring: { id: 'ring', name: 'THE RING', desc: 'A loop around a void. Long lines of fire', ...RING },
  tower: { id: 'tower', name: 'TOWER', desc: 'Sealed three-storey building with lifts, atrium and a top gallery', ...TOWER },
};
export const MAP_LIST = Object.values(MAPS);
function pickMap(): string {
  try { const m = new URLSearchParams(location.search).get('map') || ''; return m in MAPS ? m : 'boreal'; } catch { return 'boreal'; }
}
export const MAP_ID = typeof location === 'undefined' ? 'boreal' : pickMap();
const DEF = MAPS[MAP_ID];
export const lifts = DEF.lifts ?? [];
/** each lift's collision box (moved every step by lifts.ts) shares the same list the player collides with */
export const liftBoxes: Box[] = lifts.map(l => ({ min: [l.x0, l.y0 - 0.5, l.z0] as [number, number, number], max: [l.x1, l.y0, l.z1] as [number, number, number], kind: 'lift' as const }));
export const boxes = [...DEF.boxes, ...liftBoxes];
export const pads = DEF.pads;
export const spawns = DEF.spawns;
export const pickups = DEF.pickups;
export const teleporters = DEF.teleporters;
export const botZones = DEF.botZones;
export const THEME = DEF.theme;
export const flags = DEF.flags;

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
