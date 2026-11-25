// Bot navigation: a graph of walkable points built automatically from the level data, so every map works without hand-placed waypoints.
//  - floor nodes: a grid over every platform / floor slab (checked for walls and ground)
//  - links: walking, short jumps up (<= 1.3 m), drops down, jump pads, teleporters, lifts
//  - item nodes: one per pickup, so bots can plan a route to health, armour and weapons
import { boxes, pads, teleporters, pickups, lifts, jumpPadVelocity } from './level';

export type EdgeKind = 'walk' | 'jump' | 'pad' | 'tele' | 'lift';
export interface NavEdge { to: number; cost: number; kind: EdgeKind }
export interface NavNode { x: number; y: number; z: number; kind: 'floor' | 'pad' | 'tele' | 'item' | 'lift'; edges: NavEdge[]; item?: number; lift?: number; up?: boolean; pad?: number }

const SOLID = () => boxes.filter(b => b.kind !== 'light');
/** highest solid surface at (x, z) that is at or below yRef + 0.6 (the live lift positions count), or -Infinity */
export function groundAt(x: number, z: number, yRef: number): number {
  let best = -Infinity;
  for (const b of boxes) {
    if (b.kind === 'light') continue;
    if (x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && b.max[1] <= yRef + 0.6 && b.max[1] > best) best = b.max[1];
  }
  return best;
}
/** is a body (radius r, 1.8 m tall) standing at (x, y, z) inside a wall or cover? */
export function blockedAt(x: number, y: number, z: number, r = 0.42): boolean {
  for (const b of boxes) {
    if (b.kind === 'light') continue;
    if (x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2] && b.min[1] < y + 1.7 && b.max[1] > y + 0.35) return true;
  }
  return false;
}

export const nodes: NavNode[] = [];
/** node index for each pickup (same order as the level's pickups) */
export const itemNode: number[] = [];
let built = false;

const hd = (a: NavNode, b: NavNode) => Math.hypot(a.x - b.x, a.z - b.z);
function addNode(n: Omit<NavNode, 'edges'>): number { nodes.push({ ...n, edges: [] }); return nodes.length - 1; }
function link(a: number, b: number, kind: EdgeKind, cost?: number) {
  const A = nodes[a], B = nodes[b]; if (a === b || A.edges.some(e => e.to === b)) return;
  A.edges.push({ to: b, kind, cost: cost ?? (hd(A, B) + Math.abs(A.y - B.y) * 1.5 + (kind === 'jump' ? 2 : 0)) });
}
const both = (a: number, b: number, kind: EdgeKind) => { link(a, b, kind); link(b, a, kind); };

/** the closest floor node to a point (|height difference| < 1.3) */
export function nearestNode(x: number, y: number, z: number, maxD = 7, withLifts = false): number {
  let best = -1, bd = maxD;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]; if (n.kind !== 'floor' && !(withLifts && n.kind === 'lift')) continue;
    const dy = Math.abs(n.y - y); if (dy > 1.3) continue;
    const d = Math.hypot(n.x - x, n.z - z) + dy * 2; if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function buildNav() {
  if (built) return; built = true;
  const bounce = pads.filter(p => p.kind === 'bounce');
  // ---- floor nodes: a ~3.5 m grid on every platform and floor slab
  for (const b of boxes) {
    if (b.kind && b.kind !== 'floor') continue;
    const top = b.max[1], w = b.max[0] - b.min[0], d = b.max[2] - b.min[2]; if (w < 2.4 || d < 2.4) continue;
    const nx = Math.max(1, Math.round((w - 1.8) / 3.5)), nz = Math.max(1, Math.round((d - 1.8) / 3.5));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const x = b.min[0] + 0.9 + (w - 1.8) * (nx ? i / nx : 0.5), z = b.min[2] + 0.9 + (d - 1.8) * (nz ? j / nz : 0.5);
      if (Math.abs(groundAt(x, z, top + 0.05) - top) > 0.05 || blockedAt(x, top, z, 0.45)) continue;
      if (lifts.some(l => l.crush && x > l.x0 - 1.6 && x < l.x1 + 1.6 && z > l.z0 - 1.6 && z < l.z1 + 1.6)) continue;           // keep bots out from under crushers
      if (bounce.some(p => Math.hypot(p.pos[0] - x, p.pos[2] - z) < 2.6 && Math.abs(p.pos[1] - top) < 0.5)) continue;     // don't route over bounce pads
      if (nodes.some(n => n.kind === 'floor' && Math.abs(n.y - top) < 0.05 && Math.hypot(n.x - x, n.z - z) < 1.2)) continue;
      addNode({ x, y: top, z, kind: 'floor' });
    }
  }
  const floors = nodes.length;
  // ---- walking, jumping up and dropping down between neighbours
  for (let i = 0; i < floors; i++) for (let j = i + 1; j < floors; j++) {
    const A = nodes[i], B = nodes[j], h = hd(A, B); if (h > 5.2) continue;
    const dy = B.y - A.y, ady = Math.abs(dy);
    if (ady < 0.35) {
      let ok = true; const n = Math.ceil(h / 0.6);
      for (let k = 1; k < n && ok; k++) { const t = k / n, x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t; if (Math.abs(groundAt(x, z, A.y + 0.05) - A.y) > 0.3 || blockedAt(x, A.y, z, 0.4)) ok = false; }
      if (ok) both(i, j, 'walk');
    } else if (ady <= 1.3 && h <= 5.2) {
      const lo = dy > 0 ? A : B, hi = dy > 0 ? B : A, li = dy > 0 ? i : j, hiI = dy > 0 ? j : i;
      const mx = (lo.x + hi.x) / 2, mz = (lo.z + hi.z) / 2;
      if (!blockedAt(mx, hi.y, mz, 0.4) && !blockedAt(lo.x, lo.y, lo.z, 0.4)) { link(li, hiI, 'jump'); link(hiI, li, 'walk'); }   // the step itself is not a wall: check the space at the upper height
    }
  }
  // ---- jump pads: stand-on node -> where the pad throws you
  pads.forEach((p, pi) => {
    if (p.kind !== 'jump') return;
    const from = nearestNode(p.pos[0], p.pos[1], p.pos[2], 5), to = nearestNode(p.target[0], p.target[1], p.target[2], 5);
    if (from < 0 || to < 0) return;
    const n = addNode({ x: p.pos[0], y: p.pos[1], z: p.pos[2], kind: 'pad', pad: pi });
    link(from, n, 'walk'); link(n, to, 'pad', 6);
  });
  // ---- teleporters
  teleporters.forEach(t => {
    const from = nearestNode(t.pos[0], t.pos[1], t.pos[2], 5), to = nearestNode(t.dest[0], t.dest[1], t.dest[2], 5);
    if (from < 0 || to < 0) return;
    const n = addNode({ x: t.pos[0], y: t.pos[1], z: t.pos[2], kind: 'tele' });
    link(from, n, 'walk'); link(n, to, 'tele', 3);
  });
  // ---- lifts: a node at each end, linked to the floors they connect
  lifts.forEach((l, li) => {
    if (l.crush || l.dx || l.dz) return;                              // drifting platforms and crushers are not routes
    const cx = (l.x0 + l.x1) / 2, cz = (l.z0 + l.z1) / 2;
    const lo = addNode({ x: cx, y: l.y0, z: cz, kind: 'lift', lift: li, up: false }), hi = addNode({ x: cx, y: l.y1, z: cz, kind: 'lift', lift: li, up: true });
    link(lo, hi, 'lift', 9); link(hi, lo, 'lift', 9);
    const a = nearestNode(cx, l.y0, cz, 6), b = nearestNode(cx, l.y1, cz, 6.5);
    if (a >= 0) both(lo, a, 'walk'); if (b >= 0) both(hi, b, 'walk');
  });
  // ---- items
  pickups.forEach((p, i) => {
    const n = addNode({ x: p.pos[0], y: p.pos[1], z: p.pos[2], kind: 'item', item: i }); itemNode[i] = n;
    for (let k = 0; k < floors; k++) { const F = nodes[k]; if (Math.abs(F.y - p.pos[1]) < 0.5 && Math.hypot(F.x - p.pos[0], F.z - p.pos[2]) < 4.4) both(n, k, 'walk'); }
  });
}

/** single-source shortest paths (Dijkstra). nodes are few (a few hundred), so a simple scan is fine */
export function dijkstra(src: number): { dist: number[]; prev: number[] } {
  const n = nodes.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  dist[src] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1, bd = Infinity; for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
    if (u < 0) break; done[u] = true;
    for (const e of nodes[u].edges) { const nd = dist[u] + e.cost; if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; } }
  }
  return { dist, prev };
}
export function pathTo(prev: number[], dst: number): number[] {
  const p: number[] = []; for (let c = dst; c >= 0; c = prev[c]) p.push(c); return p.reverse();
}
export const edgeBetween = (a: number, b: number): NavEdge | undefined => nodes[a]?.edges.find(e => e.to === b);
export { jumpPadVelocity };
