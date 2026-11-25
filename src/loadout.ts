import { WEAPON_DEFS, WEAPON_ORDER, WeaponId } from './weapons';

/** The sidearm has infinite ammo but a 12-round magazine and a short reload (everything else is Quake-style: one pool, no reloading). */
export const PISTOL_MAG = 12, PISTOL_RELOAD = 1.15;

/** match rules that change what you carry: instagib gives everyone only an infinite rail */
export const rules = { insta: false };

/** What the player carries: owned weapons + ammo. Blade and sidearm are always owned and need no ammo. */
export class Loadout {
  owned = new Set<WeaponId>();
  ammo = {} as Record<WeaponId, number>;
  cooldown = 0;
  /** rounds left in the sidearm's magazine, and seconds of reload still to go */
  mag = PISTOL_MAG; reloadT = 0;
  constructor() { this.reset(); }

  reset() {
    this.owned = new Set<WeaponId>(rules.insta ? ['rail'] : ['blade', 'pistol']);
    for (const id of WEAPON_ORDER) this.ammo[id] = WEAPON_DEFS[id].stats.ammoStart < 0 || (rules.insta && id === 'rail') ? Infinity : 0;
    this.cooldown = 0; this.mag = PISTOL_MAG; this.reloadT = 0;
  }
  get reloading() { return this.reloadT > 0; }
  /** begin reloading the sidearm (does nothing if it is full or already reloading) */
  startReload(): boolean { if (this.mag >= PISTOL_MAG || this.reloadT > 0) return false; this.reloadT = PISTOL_RELOAD; return true; }
  tick(dt: number) { if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { this.reloadT = 0; this.mag = PISTOL_MAG; } } }
  has(id: WeaponId) { return this.owned.has(id); }
  cost(id: WeaponId) { return WEAPON_DEFS[id].stats.kind === 'melee' ? 0 : 1; }
  canFire(id: WeaponId) { return id === 'pistol' ? this.mag > 0 && this.reloadT <= 0 : this.ammo[id] >= this.cost(id); }
  consume(id: WeaponId) { if (id === 'pistol') { this.mag = Math.max(0, this.mag - 1); if (this.mag <= 0) this.startReload(); return; } if (this.ammo[id] !== Infinity) this.ammo[id] -= this.cost(id); }

  /** returns what happened so the HUD can say it */
  give(id: WeaponId): 'new' | 'ammo' | 'full' {
    const st = WEAPON_DEFS[id].stats;
    if (!this.owned.has(id)) { this.owned.add(id); this.ammo[id] = st.ammoStart; return 'new'; }
    if (this.ammo[id] >= st.ammoMax) return 'full';
    this.ammo[id] = Math.min(st.ammoMax, this.ammo[id] + st.ammoPickup); return 'ammo';
  }
  wouldAccept(id: WeaponId) { if (rules.insta) return false; return !this.owned.has(id) || this.ammo[id] < WEAPON_DEFS[id].stats.ammoMax; }

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
