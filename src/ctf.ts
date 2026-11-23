import * as THREE from 'three';
import { TEAMS } from './teams';
import type { FlagState } from './net';

// Capture-the-flag visuals: a flag at each base (ring + pole + waving banner + tall beam so you can spot it from across the map).
// Where a flag is depends on its state: base, dropped where the carrier fell, or carried by a player (floats above their head).
type Fl = 1 | 2;
interface FlagObj { g: THREE.Group; cloth: THREE.Mesh; base: THREE.Vector3 }
export class Ctf {
  group = new THREE.Group();
  private f: Record<Fl, FlagObj>;
  constructor(scene: THREE.Scene, bases: { red: number[]; blue: number[] }) {
    const mk = (team: Fl, b: number[]): FlagObj => {
      const col = new THREE.Color(TEAMS[team].hex), g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      ring.position.y = 0.05;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, depthWrite: false }));
      disc.position.y = 0.04;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.6, 8), new THREE.MeshLambertMaterial({ color: 0x9aa4b4 })); pole.position.y = 1.3;
      const cg = new THREE.PlaneGeometry(1.2, 0.8, 10, 1); cg.translate(0.6, 0, 0);
      const cloth = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.25), side: THREE.DoubleSide })); cloth.position.set(0.05, 2.15, 0);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.16), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })); stripe.position.set(0.65, 0, 0.004); cloth.add(stripe);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 60, 10, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); beam.position.y = 30;
      g.add(ring, disc, pole, cloth, beam); scene.add(g);
      return { g, cloth, base: new THREE.Vector3(b[0], b[1], b[2]) };
    };
    this.f = { 1: mk(1, bases.red), 2: mk(2, bases.blue) };
    scene.add(this.group); this.group.visible = false;
  }
  /** where flag `n` is right now. carrierPos looks up a player's feet position by network id */
  pos(n: Fl, st: FlagState, carrierPos: (id: number) => THREE.Vector3 | null, out = new THREE.Vector3()): THREE.Vector3 {
    const o = this.f[n];
    if (st.s === 'dropped' && st.p) return out.set(st.p[0], st.p[1], st.p[2]);
    if (st.s === 'carried') { const c = carrierPos(st.c); if (c) return out.copy(c); }
    return out.copy(o.base);
  }
  update(t: number, st: { 1: FlagState; 2: FlagState }, carrierPos: (id: number) => THREE.Vector3 | null, visible: boolean) {
    for (const n of [1, 2] as Fl[]) {
      const o = this.f[n]; o.g.visible = visible; if (!visible) continue;
      this.pos(n, st[n], carrierPos, o.g.position);
      const carried = st[n].s === 'carried';
      o.g.scale.setScalar(carried ? 0.7 : 1); if (carried) o.g.position.y += 0.6;       // floats a little above the carrier's head
      o.g.rotation.y = carried ? t * 1.2 : 0;
      // flutter: the cloth waves more toward its free end
      const p = o.cloth.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, Math.sin(x * 5 - t * 6 + n) * 0.09 * x); }
      p.needsUpdate = true;
    }
  }
}
