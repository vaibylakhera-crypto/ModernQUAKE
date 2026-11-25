// Gamepad support (phones/tablets/PCs with a controller). Standard layout:
//   left stick move · right stick look · RT (or LT) fire · A jump · B duck (hold) · X reload · Y / RB / D-pad up next weapon ·
//   LB / D-pad down previous weapon · Select scores (hold) · Start pause / resume
export interface PadFrame {
  connected: boolean;
  /** any button or stick was touched this frame */
  anyInput: boolean;
  forward: number; side: number; lookX: number; lookY: number;
  fire: boolean; crouch: boolean; scores: boolean;
  /** pressed this frame (not held) */
  jump: boolean; next: boolean; prev: boolean; reload: boolean; start: boolean;
}
const DEAD = 0.18;
const stick = (x: number, y: number): [number, number] => {
  const m = Math.hypot(x, y); if (m < DEAD) return [0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m; return [x * k, y * k];
};
const EMPTY: PadFrame = { connected: false, anyInput: false, forward: 0, side: 0, lookX: 0, lookY: 0, fire: false, crouch: false, scores: false, jump: false, next: false, prev: false, reload: false, start: false };

export class GamepadInput {
  private prev: boolean[] = [];
  /** read the first connected controller; call once per frame */
  poll(): PadFrame {
    let gp: Gamepad | null = null;
    try { for (const g of navigator.getGamepads?.() ?? []) if (g && g.connected) { gp = g; break; } } catch { /* blocked */ }
    if (!gp) { this.prev = []; return EMPTY; }
    const b = (i: number) => !!gp!.buttons[i]?.pressed || (gp!.buttons[i]?.value ?? 0) > 0.5;
    const now = gp.buttons.map((_, i) => b(i)), edge = (i: number) => now[i] && !this.prev[i];
    const [mx, my] = stick(gp.axes[0] ?? 0, gp.axes[1] ?? 0), [lx, ly] = stick(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
    const curve = (v: number) => Math.sign(v) * Math.abs(v) ** 1.7;              // fine control near the centre, fast at the edge
    const f: PadFrame = {
      connected: true, anyInput: now.some(Boolean) || mx !== 0 || my !== 0 || lx !== 0 || ly !== 0,
      forward: -my, side: mx, lookX: curve(lx), lookY: curve(ly),
      fire: b(7) || b(6), crouch: b(1), scores: b(8),
      jump: edge(0), next: edge(3) || edge(5) || edge(12), prev: edge(4) || edge(13), reload: edge(2), start: edge(9),
    };
    this.prev = now; return f;
  }
  /** a short rumble (hit, kill) */
  rumble(ms: number, strength = 0.5) {
    try { for (const g of navigator.getGamepads?.() ?? []) (g as any)?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength }); } catch { /* unsupported */ }
  }
}
