// Mini-map: a small round radar, heading up. The map layout is drawn once; power-ups, gates and teammates are always shown,
// enemies only when they are close (so it is a sense of the room, not a wall-hack).
import { Box, boxes, teleporters } from './level';

export interface RadarDot { x: number; y: number; z: number; color: string; r?: number }
export interface RadarFrame { x: number; y: number; z: number; yaw: number; items: RadarDot[]; friends: RadarDot[]; enemies: RadarDot[]; flags: RadarDot[] }

let RANGE = 36;                  // metres from the centre to the rim (set from the map size)
const ENEMY_RANGE = 16;          // enemies show up inside this distance only

export class Radar {
  readonly el: HTMLCanvasElement; private g: CanvasRenderingContext2D; private stat: HTMLCanvasElement;
  private k = 3; private minX = 0; private minZ = 0; private size = 0; private dpr = 1;
  constructor(parent: HTMLElement) {
    this.el = document.createElement('canvas'); this.el.id = 'radar'; parent.appendChild(this.el); this.g = this.el.getContext('2d')!;
    this.stat = this.bake(); this.resize();
    addEventListener('resize', () => this.resize());
  }
  /** the fixed layer: every floor, pillar and wall seen from above, higher ground drawn lighter */
  private bake(): HTMLCanvasElement {
    const use = boxes.filter(b => b.kind !== 'light' && b.kind !== 'lift' && b.kind !== 'prop' && !(b.kind === 'block' && b.min[1] > 5));
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y1 = 1;
    for (const b of use) { x0 = Math.min(x0, b.min[0]); z0 = Math.min(z0, b.min[2]); x1 = Math.max(x1, b.max[0]); z1 = Math.max(z1, b.max[2]); y1 = Math.max(y1, b.max[1]); }
    this.minX = x0 - 2; this.minZ = z0 - 2; const w = x1 - x0 + 4, h = z1 - z0 + 4;
    this.k = Math.min(4, 700 / Math.max(w, h));
    RANGE = Math.max(22, Math.min(40, Math.max(w, h) * 0.45));
    const c = document.createElement('canvas'); c.width = Math.ceil(w * this.k); c.height = Math.ceil(h * this.k); const g = c.getContext('2d')!;
    const sorted = [...use].sort((a, b) => a.max[1] - b.max[1]);
    for (const b of sorted) {
      const wall = b.kind === 'block', t = Math.max(0, Math.min(1, b.max[1] / y1));
      const L = wall ? 78 : 22 + t * 50;                                 // lightness: walls bright, high ground lighter
      g.fillStyle = wall ? `hsl(30 10% ${L}%)` : b.kind === 'pillar' || b.kind === 'crates' ? 'hsl(25 30% 62%)' : `hsl(28 28% ${L}%)`;
      g.fillRect((b.min[0] - this.minX) * this.k, (b.min[2] - this.minZ) * this.k, (b.max[0] - b.min[0]) * this.k, (b.max[2] - b.min[2]) * this.k);
      if (!wall && b.kind !== 'pillar' && b.kind !== 'crates') { g.strokeStyle = 'rgba(255,200,140,.35)'; g.lineWidth = 1; g.strokeRect((b.min[0] - this.minX) * this.k + .5, (b.min[2] - this.minZ) * this.k + .5, (b.max[0] - b.min[0]) * this.k - 1, (b.max[2] - b.min[2]) * this.k - 1); }
    }
    return c;
  }
  private resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1); const css = this.el.clientWidth || 100; this.size = css;
    this.el.width = this.el.height = Math.round(css * this.dpr);
  }
  update(f: RadarFrame) {
    if (Math.abs((this.el.clientWidth || 100) - this.size) > 1) this.resize();
    const g = this.g, S = this.el.width, c = S / 2, s = (S / 2) / RANGE;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(8,5,4,.72)'; g.fillRect(0, 0, S, S);
    // the world, turned so the way you face is up
    g.translate(c, c); g.rotate(f.yaw); g.scale(s, s); g.translate(-f.x, -f.z);
    g.globalAlpha = 0.9; g.drawImage(this.stat, this.minX, this.minZ, this.stat.width / this.k, this.stat.height / this.k); g.globalAlpha = 1;
    const dot = (d: RadarDot, shape: 'dot' | 'diamond' = 'dot') => {
      const near = Math.abs(d.y - f.y) < 3.2, r = (d.r ?? 3.4) / s * (S / 140);
      g.globalAlpha = near ? 1 : 0.4; g.fillStyle = d.color; g.strokeStyle = 'rgba(0,0,0,.75)'; g.lineWidth = 1.2 / s * (S / 140);
      g.beginPath(); if (shape === 'diamond') { g.moveTo(d.x, d.z - r * 1.3); g.lineTo(d.x + r * 1.3, d.z); g.lineTo(d.x, d.z + r * 1.3); g.lineTo(d.x - r * 1.3, d.z); g.closePath(); } else g.arc(d.x, d.z, r, 0, Math.PI * 2);
      g.fill(); g.stroke(); g.globalAlpha = 1;
    };
    for (const t of teleporters) dot({ x: t.pos[0], y: t.pos[1], z: t.pos[2], color: '#b98cff', r: 3.2 }, 'diamond');
    for (const d of f.items) dot(d);
    for (const d of f.flags) dot({ ...d, r: 4.4 }, 'diamond');
    for (const d of f.friends) dot(d);
    for (const d of f.enemies) if (Math.hypot(d.x - f.x, d.z - f.z) < ENEMY_RANGE) dot(d);
    g.restore();
    // you: a white arrow in the middle, and the rim
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = 1.5 * this.dpr;
    const a = 5.5 * this.dpr; g.beginPath(); g.moveTo(c, c - a * 1.25); g.lineTo(c + a, c + a); g.lineTo(c, c + a * 0.45); g.lineTo(c - a, c + a); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = 'rgba(255,190,140,.55)'; g.lineWidth = 2 * this.dpr; g.beginPath(); g.arc(c, c, c - this.dpr, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(255,190,140,.18)'; g.lineWidth = this.dpr; g.beginPath(); g.arc(c, c, c * 0.5, 0, Math.PI * 2); g.stroke();
  }
  show(on: boolean) { this.el.style.display = on ? 'block' : 'none'; }
}
