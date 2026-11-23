import * as THREE from 'three';
import { pickups, PickupDef, BoosterId } from './level';
import { buildWeapon, WEAPON_DEFS } from './weapons';
import { columnMesh } from './pads';

// Quake-style item spawns: a pedestal with the item floating above it. Stand on it to take it; it respawns after a delay.
const RESPAWN = { weapon: 15, health: 20, armor: 25, booster: 45 };

/** timed power-ups placed on the newer maps */
export const BOOSTERS: Record<BoosterId, { name: string; color: number; secs: number }> = {
  haste:     { name: 'HASTE',       color: 0x35e0ff, secs: 20 },
  overdrive: { name: 'OVERDRIVE',   color: 0xff3ad8, secs: 20 },
  regen:     { name: 'REGEN',       color: 0x5dff7a, secs: 20 },
  jump:      { name: 'HIGH JUMP',   color: 0xffe14a, secs: 20 },
  mega:      { name: 'MEGA HEALTH', color: 0xff5a4a, secs: 0 },
  shield:    { name: 'HEAVY ARMOR', color: 0x7a9cff, secs: 0 },
};
function boosterModel(id: BoosterId): THREE.Object3D {
  // solid, crisp shapes: dark metal body + glowing accents in the booster colour (no soft glow blobs)
  const c = BOOSTERS[id].color, g = new THREE.Group();
  const accent = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1.15) });
  const metal = new THREE.MeshPhongMaterial({ color: 0x2a2e36, specular: 0x9aa4b4, shininess: 80, emissive: new THREE.Color(c).multiplyScalar(0.08) });
  const tinted = new THREE.MeshPhongMaterial({ color: new THREE.Color(c).multiplyScalar(0.55), specular: 0xffffff, shininess: 110, emissive: new THREE.Color(c).multiplyScalar(0.25), flatShading: true });
  if (id === 'haste') {            // two arrowheads pointing forward
    for (const z of [-0.18, 0.18]) {
      const sh = new THREE.Shape(); sh.moveTo(-0.34, -0.3); sh.lineTo(0.1, 0); sh.lineTo(-0.34, 0.3); sh.lineTo(-0.18, 0); sh.closePath();
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }), z < 0 ? tinted : accent);
      m.position.set(z * 1.6, 0, -0.05); g.add(m);
    }
  } else if (id === 'overdrive') { // faceted crystal core with spikes
    g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), tinted));
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as [number, number, number][]) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 4), accent);
      const v = new THREE.Vector3(...d); sp.position.copy(v).multiplyScalar(0.4); sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v); g.add(sp);
    }
  } else if (id === 'regen') {     // cross inside a ring
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 10, 36), metal));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.14), accent), new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.46, 0.14), accent));
  } else if (id === 'jump') {      // arrow on a spring
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.32, 4), accent); arrow.position.y = 0.3; arrow.rotation.y = Math.PI / 4; g.add(arrow);
    for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 8, 24), metal); r.rotation.x = Math.PI / 2; r.position.y = 0.02 - i * 0.13; g.add(r); }
  } else if (id === 'mega') {      // armoured capsule with a glowing cross
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 16), tinted));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.76), accent), new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.76), accent));
  } else {                         // heavy armor: hex plate with a raised rim
    const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 6), tinted); hex.rotation.x = Math.PI / 2; g.add(hex);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.05, 6, 6), metal); rim.rotation.z = Math.PI / 6; g.add(rim);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.16, 6), accent); core.rotation.x = Math.PI / 2; g.add(core);
  }
  // thin orbit ring so it reads as "special" from a distance
  const orbit = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.018, 6, 48), accent); orbit.rotation.x = Math.PI / 2 - 0.3; orbit.name = 'orbit'; g.add(orbit);
  g.scale.setScalar(1.25);
  return g;
}

function labelSprite(text: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256; const x = c.getContext('2d')!;
  x.font = '700 120px Rajdhani, "Segoe UI", system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 14; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(text, 512, 128);      // dark outline: readable on any background
  x.shadowColor = '#' + color.toString(16).padStart(6, '0'); x.shadowBlur = 16; x.fillStyle = '#ffffff'; x.fillText(text, 512, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
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
      const color = def.kind === 'weapon' ? WEAPON_DEFS[def.id].color : def.kind === 'booster' ? BOOSTERS[def.id].color : def.kind === 'health' ? 0x3dff7a : 0xffc02d;
      const g = new THREE.Group(); g.position.set(def.pos[0], def.pos[1] + 0.01, def.pos[2]);
      g.add(new THREE.Mesh(baseGeo, baseMat));
      const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.7) });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 6).rotateX(-Math.PI / 2).translate(0, 0.165, 0), ringMat); g.add(ring);
      // boosters: a dimmer, slimmer light column so the item itself stays sharp
      const col = columnMesh(new THREE.Color(color).multiplyScalar(def.kind === 'booster' ? 0.45 : 1), def.kind === 'weapon' ? 3.0 : def.kind === 'booster' ? 2.6 : 2.2, def.kind === 'booster' ? 0.6 : 0.8); col.position.y = 0.15; g.add(col);

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
      } else if (def.kind === 'booster') {
        item = boosterModel(def.id); name = BOOSTERS[def.id].name;
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
      const orb = it.item.getObjectByName('orbit'); if (orb) orb.rotation.z = t * 2.4;
      const dx = p.x - it.def.pos[0], dz = p.z - it.def.pos[2], dy = p.y - it.def.pos[1];
      if (dx * dx + dz * dz < 1.3 * 1.3 && dy > -0.4 && dy < 1.8 && accept(it.def)) {
        it.active = false; it.respawnAt = t + RESPAWN[it.def.kind]; it.item.visible = it.label.visible = it.col.visible = false; got.push(it.def);
      }
    }
    return got;
  }

  /** a bot takes item i (same respawn timers as for the player) */
  claim(i: number, t: number): PickupDef | null {
    const it = this.items[i]; if (!it || !it.active) return null;
    it.active = false; it.respawnAt = t + RESPAWN[it.def.kind]; it.item.visible = it.label.visible = it.col.visible = false; return it.def;
  }

  respawnAll() { for (const it of this.items) { it.active = true; it.item.visible = it.label.visible = it.col.visible = true; } }
}
