// The King of the Hill zone: a glowing ring on the floor with a soft light column. Gold when free, green when you hold it,
// red when an enemy holds it, white when it is contested.
import * as THREE from 'three';
import { hill } from './level';
import { columnMesh } from './pads';

export interface HillVis { group: THREE.Group; setState(s: 'free' | 'mine' | 'theirs' | 'contested'): void; update(t: number): void }
const COLORS = { free: 0xffc84a, mine: 0x5dff8a, theirs: 0xff4a3a, contested: 0xffffff };

export function buildHill(): HillVis {
  const group = new THREE.Group(); group.position.set(hill.pos[0], hill.pos[1] + 0.05, hill.pos[2]);
  const mat = new THREE.MeshBasicMaterial({ color: COLORS.free, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(hill.r - 0.18, hill.r, 64).rotateX(-Math.PI / 2), mat); ring.renderOrder = 3; group.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(hill.r, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COLORS.free, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false })); disc.renderOrder = 2; group.add(disc);
  const col = columnMesh(new THREE.Color(COLORS.free), 6, hill.r * 0.96); group.add(col);
  const inner = new THREE.Mesh(new THREE.RingGeometry(hill.r * 0.55, hill.r * 0.6, 48).rotateX(-Math.PI / 2), mat.clone()); inner.renderOrder = 3; group.add(inner);
  const setColor = (c: number) => { mat.color.setHex(c); (disc.material as THREE.MeshBasicMaterial).color.setHex(c); (inner.material as THREE.MeshBasicMaterial).color.setHex(c); ((col.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setHex(c); };
  return { group, setState: s => setColor(COLORS[s]), update: t => { inner.scale.setScalar(1 + 0.06 * Math.sin(t * 3)); mat.opacity = 0.75 + 0.2 * Math.sin(t * 2.2); } };
}
