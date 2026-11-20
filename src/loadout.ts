import { WEAPON_DEFS, WEAPON_ORDER, WeaponId } from './weapons';

/** What the player carries: owned weapons + ammo. Blade and sidearm are always owned and need no ammo. */
export class Loadout {
  owned = new Set<WeaponId>();
  ammo = {} as Record<WeaponId, number>;
  cooldown = 0;
  constructor() { this.reset(); }

  reset() {
    this.owned = new Set<WeaponId>(['blade', 'pistol']);
    for (const id of WEAPON_ORDER) this.ammo[id] = WEAPON_DEFS[id].stats.ammoStart < 0 ? Infinity : 0;
    this.cooldown = 0;
  }
  has(id: WeaponId) { return this.owned.has(id); }
  cost(id: WeaponId) { return WEAPON_DEFS[id].stats.kind === 'melee' ? 0 : 1; }
  canFire(id: WeaponId) { return this.ammo[id] >= this.cost(id); }
  consume(id: WeaponId) { if (this.ammo[id] !== Infinity) this.ammo[id] -= this.cost(id); }

  /** returns what happened so the HUD can say it */
  give(id: WeaponId): 'new' | 'ammo' | 'full' {
    const st = WEAPON_DEFS[id].stats;
    if (!this.owned.has(id)) { this.owned.add(id); this.ammo[id] = st.ammoStart; return 'new'; }
    if (this.ammo[id] >= st.ammoMax) return 'full';
    this.ammo[id] = Math.min(st.ammoMax, this.ammo[id] + st.ammoPickup); return 'ammo';
  }
  wouldAccept(id: WeaponId) { return !this.owned.has(id) || this.ammo[id] < WEAPON_DEFS[id].stats.ammoMax; }

  /** owned weapons in slot order */
  list(): WeaponId[] { return WEAPON_ORDER.filter(w => this.owned.has(w)); }
  /** next/prev owned weapon relative to `from` (skips weapons with no ammo) */
  step(from: WeaponId, dir: number): WeaponId {
    const l = this.list().filter(w => this.canFire(w) || w === from); const i = Math.max(0, l.indexOf(from));
    return l[(i + dir + l.length) % l.length];
  }
  /** best weapon with ammo (higher slot = stronger) for auto-switch */
  best(): WeaponId { const l = this.list().filter(w => this.canFire(w)); return l[l.length - 1] ?? 'blade'; }
}
