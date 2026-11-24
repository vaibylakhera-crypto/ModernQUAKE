import * as THREE from 'three';
import { boxes, pads, Box, BounceTier, jumpPadVelocity } from './level';
import { Kit, mergeStatic } from './kit';
import { Quality } from './quality';
import { buildPad, padTime } from './pads';

const BOUNCE_COLOR: Record<BounceTier, number> = { small: 0x45ff7a, medium: 0xffc02d, mega: 0xff2d9a };
const EDGE_COLORS = [0x2dffb0, 0x37c8ff, 0xff9a2d, 0xc27bff, 0xff3d7a, 0xffe14a];

const PIECES = [
  'Platform_Metal', 'Platform_Metal2', 'Platform_Squares', 'Platform_DarkPlates', 'Platform_3Plates', 'Platform_Simple', 'Platform_X',
  'WallAstra_Straight', 'WallBand_Straight', 'WallAstra_Corner_Square_Outer',
  'Column_Hollow', 'Column_Pipes', 'Prop_Crate3', 'Prop_Crate4', 'Prop_Light_Floor', 'Prop_Barrel_Large', 'Prop_Cable_3',
];

// deterministic pseudo-random so the arena looks the same every load
const rnd = (a: number, b: number) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };

export class World {
  group = new THREE.Group();
  arch = new THREE.Group();          // static architecture, merged into a few meshes after build
  kit = new Kit(this.arch);
  private pulses: THREE.Material[] = [];
  stats = { pieces: 0, merged: 0 };

  constructor(private q: Quality) {
    this.group.add(this.arch);
    pads.forEach((p, i) => this.group.add(buildPad(p, i, { beams: q.padBeams })));
  }

  async build() {
    await this.kit.preload(PIECES);
    for (const b of boxes) {
      if (b.kind === 'pillar') this.buildPillar(b);
      else if (b.kind === 'crates') this.buildCrates(b);
      else if (b.kind !== 'prop') this.buildPlatform(b);
    }
    const r = mergeStatic(this.arch);
    this.stats = { pieces: r.before, merged: r.after };
  }

  private buildPillar(b: Box) {
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    this.kit.place('Column_Hollow', cx, b.min[1], cz, 0, 0, 1.08);
  }

  private buildCrates(b: Box) {
    const n = Math.round(b.max[0] - b.min[0]);
    const cz = (b.min[2] + b.max[2]) / 2;
    for (let i = 0; i < n; i++) this.kit.place('Prop_Crate3', b.min[0] + 0.5 + i, b.min[1] + 0.5, cz + (rnd(i, 2) - .5) * .04, (rnd(i, 5) - .5) * .12);
  }

  private buildPlatform(b: Box) {
    const [x0, , z0] = b.min, [x1, top, z1] = b.max;
    const nx = Math.round((x1 - x0) / 4), nz = Math.round((z1 - z0) / 4);
    const hull = 3;                       // skirt height under the top surface
    const color = EDGE_COLORS[(b.tint ?? 0) % EDGE_COLORS.length];

    // top surface: border ring + varied interior
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      const edge = ix === 0 || iz === 0 || ix === nx - 1 || iz === nz - 1;
      const r = rnd(ix + x0, iz + z0);
      const name = edge ? 'Platform_DarkPlates' : r < .35 ? 'Platform_Squares' : r < .7 ? 'Platform_Metal' : r < .85 ? 'Platform_3Plates' : 'Platform_X';
      const cx = x0 + 2 + ix * 4, cz = z0 + 2 + iz * 4;
      this.kit.place(name, cx, top + 0.01, cz, Math.floor(rnd(ix, iz) * 4) * Math.PI / 2);
      this.kit.place('Platform_Metal2', cx, top - hull, cz, 0, Math.PI);   // underside
    }
    // hanging hull panels, facing outward on all four edges
    const wall = (name: string, x: number, z: number, rot: number) => this.kit.place(name, x, top - hull, z, rot);
    for (let i = 0; i < nz; i++) { wall(i % 3 === 1 ? 'WallBand_Straight' : 'WallAstra_Straight', x0 + 2, z0 + 2 + i * 4, 0); wall(i % 3 === 1 ? 'WallBand_Straight' : 'WallAstra_Straight', x1 - 2, z0 + 2 + i * 4, Math.PI); }
    for (let i = 0; i < nx; i++) { wall(i % 3 === 1 ? 'WallBand_Straight' : 'WallAstra_Straight', x0 + 2 + i * 4, z0 + 2, -Math.PI / 2); wall(i % 3 === 1 ? 'WallBand_Straight' : 'WallAstra_Straight', x0 + 2 + i * 4, z1 - 2, Math.PI / 2); }

    // coloured underglow so each platform has its own identity against the sky
    const w = x1 - x0, d = z1 - z0;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.15, d * 1.15), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.1), transparent: true, opacity: .28, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = Math.PI / 2; glow.position.set((x0 + x1) / 2, top - hull - 0.1, (z0 + z1) / 2); this.group.add(glow);
    if (this.q.platformLights) { const lamp = new THREE.PointLight(color, 40, 26, 2); lamp.position.set((x0 + x1) / 2, top - hull - 2, (z0 + z1) / 2); this.group.add(lamp); }
  }

  update(t: number) { padTime.value = t; }
}
