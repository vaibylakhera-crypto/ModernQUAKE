import * as THREE from 'three';
import { pickups, PickupDef } from './level';
import { buildWeapon, WEAPON_DEFS } from './weapons';
import { columnMesh } from './pads';

// Quake-style item spawns: a pedestal with the item floating above it. Stand on it to take it; it respawns after a delay.
const RESPAWN = { weapon: 15, health: 20, armor: 25 };

function labelSprite(text: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const x = c.getContext('2d')!;
  x.font = '700 64px Rajdhani, "Segoe UI", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = '#' + color.toString(16).padStart(6, '0'); x.shadowBlur = 18; x.fillStyle = '#ffffff'; x.fillText(text, 256, 64); x.fillText(text, 256, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(2.4, 0.6, 1); return s;
}

interface Item { def: PickupDef; group: THREE.Group; item: THREE.Object3D; ring: THREE.MeshBasicMaterial; label: THREE.Sprite; col: THREE.Mesh; active: boolean; respawnAt: number; phase: number; color: number }

export class Pickups {
  items: Item[] = [];
  constructor(parent: THREE.Object3D) {
    const baseMat = new THREE.MeshLambertMaterial({ color: 0x3a414d });
    const baseGeo = new THREE.LatheGeometry([[1.25, 0], [1.25, 0.08], [1.1, 0.16], [0.9, 0.16], [0.82, 0.1], [0.01, 0.1]].map(([r, y]) => new THREE.Vector2(r, y)), 6);
    pickups.forEach((def, i) => {
      const color = def.kind === 'weapon' ? WEAPON_DEFS[def.id].color : def.kind === 'health' ? 0x3dff7a : 0xffc02d;
      const g = new THREE.Group(); g.position.set(def.pos[0], def.pos[1] + 0.01, def.pos[2]);
      g.add(new THREE.Mesh(baseGeo, baseMat));
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.7) });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 6).rotateX(-Math.PI / 2).translate(0, 0.165, 0), ringMat); g.add(ring);
      const col = columnMesh(new THREE.Color(color), def.kind === 'weapon' ? 3.0 : 2.2, 0.8); col.position.y = 0.15; g.add(col);

      let item: THREE.Object3D; let name: string;
      if (def.kind === 'weapon') {
        const w = buildWeapon(def.id); const bb = new THREE.Box3().setFromObject(w.group); const c = bb.getCenter(new THREE.Vector3());
        w.group.position.sub(c); const holder = new THREE.Group(); holder.add(w.group);
        holder.scale.setScalar(1.15 / Math.max(...bb.getSize(new THREE.Vector3()).toArray())); item = holder; name = WEAPON_DEFS[def.id].name;
      } else if (def.kind === 'health') {
        const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3dff7a).multiplyScalar(1.5) });
        const h = new THREE.Group(); h.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.18), m), new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.18), m));
        const shell = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0x3dff7a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false })); h.add(shell);
        h.scale.setScalar(def.amount >= 50 ? 1.3 : 1); item = h; name = `+${def.amount} HEALTH`;
      } else {
        const m = new THREE.MeshPhongMaterial({ color: 0xffc02d, emissive: 0x7a4a00, shininess: 100, flatShading: true });
        const a = new THREE.Mesh(new THREE.OctahedronGeometry(0.42).scale(1, 1.35, 0.7), m);
        const h = new THREE.Group(); h.add(a); h.scale.setScalar(def.amount >= 50 ? 1.3 : 1); item = h; name = `+${def.amount} ARMOR`;
      }
      item.position.y = 1.35; g.add(item);
      const label = labelSprite(name, color); label.position.y = 2.35; g.add(label);
      parent.add(g);
      this.items.push({ def, group: g, item, ring: ringMat, label, col, active: true, respawnAt: 0, phase: i * 1.7, color });
    });
  }

  /** returns the defs picked up this frame; `accept` decides whether the player can use it (e.g. not already full) */
  update(t: number, p: { x: number; y: number; z: number }, accept: (d: PickupDef) => boolean): PickupDef[] {
    const got: PickupDef[] = [];
    for (const it of this.items) {
      if (!it.active) {
        if (t >= it.respawnAt) { it.active = true; it.item.visible = it.label.visible = it.col.visible = true; it.ring.color.set(it.color).multiplyScalar(1.7); }
        else it.ring.color.set(it.color).multiplyScalar(0.25 + 0.15 * Math.sin(t * 6));
        continue;
      }
      it.item.rotation.y = t * 1.6 + it.phase; it.item.position.y = 1.3 + Math.sin(t * 2.2 + it.phase) * 0.1;
      const dx = p.x - it.def.pos[0], dz = p.z - it.def.pos[2], dy = p.y - it.def.pos[1];
      if (dx * dx + dz * dz < 1.3 * 1.3 && dy > -0.4 && dy < 1.8 && accept(it.def)) {
        it.active = false; it.respawnAt = t + RESPAWN[it.def.kind]; it.item.visible = it.label.visible = it.col.visible = false; got.push(it.def);
      }
    }
    return got;
  }

  respawnAll() { for (const it of this.items) { it.active = true; it.item.visible = it.label.visible = it.col.visible = true; } }
}
