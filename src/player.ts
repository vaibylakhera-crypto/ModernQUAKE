// Quake-style player movement. Deterministic fixed-step, no three.js dependency (shareable with the server).
import { Box, GRAVITY, BOUNCE_VY, pads, jumpPadVelocity, spawns, teleporters, inGate } from './level';

export const PM = {
  runSpeed: 10,        // m/s  (~320 u/s)
  accel: 10,
  airAccel: 1,         // Q3 air accel (steering with forward + turn)
  airStrafeAccel: 70,  // CPM-style strafe accel when only side keys are held
  airStrafeCap: 0.94,  // m/s wishspeed cap while strafing (30 u/s)
  friction: 6,
  stopSpeed: 3.1,
  jumpV: 8.4,
  hw: 0.47,
  hStand: 1.75,
  hCrouch: 1.1,
  eyeStand: 1.6,
  eyeCrouch: 0.95,
  crouchScale: 0.35,
  voidY: -45,
  jumpBuffer: 0.1,     // s: press just before landing still counts (still one press per hop)
};

export interface Input { forward: number; side: number; jumpPressed: boolean; crouch: boolean; yaw: number }

export class Player {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = 0; pitch = 0;
  grounded = false;
  crouched = false;
  jumpBuf = 0;
  padCooldown = new Map<number, number>();
  lastPad = '';
  lastPadTime = 0;
  spawnIdx = 0;
  health = 100; armor = 0;
  onVoid?: () => void;
  hurtT = 0;
  /** booster multipliers (HASTE / HIGH JUMP), set by the game each frame */
  speedMul = 1; jumpMul = 1;
  /** set when a teleporter fires: the game turns the view to `yaw` and plays the effect */
  teleported: { yaw: number; from: [number, number, number]; to: [number, number, number] } | null = null;
  private tpCooldown = 0;

  constructor(private boxes: Box[]) { this.respawn(); }

  get height() { return this.crouched ? PM.hCrouch : PM.hStand; }
  get eye() { return this.crouched ? PM.eyeCrouch : PM.eyeStand; }
  get speedXZ() { return Math.hypot(this.vx, this.vz); }

  respawn() {
    const s = spawns[this.spawnIdx++ % spawns.length];
    [this.x, this.y, this.z] = s.pos;
    this.yaw = s.yaw; this.pitch = 0;
    this.vx = this.vy = this.vz = 0;
    this.grounded = false; this.crouched = false;
    this.health = 100; this.armor = 0;
  }

  /** Q3 rules: armour soaks two thirds of incoming damage while it lasts. Returns true if this killed the player. */
  takeDamage(amount: number): boolean {
    const soak = Math.min(this.armor, amount * (2 / 3));
    this.armor -= soak; this.health -= amount - soak; this.hurtT = 0.25;
    return this.health <= 0;
  }
  knock(x: number, y: number, z: number) { this.vx += x; this.vy += y; this.vz += z; if (y > 0.5) this.grounded = false; }

  private overlaps(px: number, py: number, pz: number, h: number): Box | null {
    const hw = PM.hw;
    for (const b of this.boxes) {
      if (px + hw > b.min[0] && px - hw < b.max[0] && py + h > b.min[1] && py < b.max[1] && pz + hw > b.min[2] && pz - hw < b.max[2]) return b;
    }
    return null;
  }

  private accelerate(wx: number, wz: number, wishSpeed: number, accel: number, dt: number) {
    const cur = this.vx * wx + this.vz * wz;
    const add = wishSpeed - cur;
    if (add <= 0) return;
    let a = accel * dt * wishSpeed;
    if (a > add) a = add;
    this.vx += a * wx; this.vz += a * wz;
  }

  step(inp: Input, dt: number) {
    this.yaw = inp.yaw;
    if (inp.jumpPressed) this.jumpBuf = PM.jumpBuffer;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    // crouch (can only stand if there is headroom)
    if (inp.crouch) this.crouched = true;
    else if (this.crouched && !this.overlaps(this.x, this.y, this.z, PM.hStand)) this.crouched = false;

    // wish direction from yaw (yaw 0 faces -Z)
    const sin = Math.sin(inp.yaw), cos = Math.cos(inp.yaw);
    let wx = -sin * inp.forward + cos * inp.side;
    let wz = -cos * inp.forward - sin * inp.side;
    let wlen = Math.hypot(wx, wz);
    if (wlen > 0) { wx /= wlen; wz /= wlen; }
    let wishSpeed = wlen > 0 ? PM.runSpeed * this.speedMul * Math.min(1, wlen) : 0;
    if (this.crouched) wishSpeed *= PM.crouchScale;

    // jump: needs a fresh press (buffered). Jumping skips ground friction -> bunny hop keeps speed.
    let jumped = false;
    if (this.grounded && this.jumpBuf > 0) {
      this.vy = PM.jumpV * this.jumpMul; this.grounded = false; this.jumpBuf = 0; jumped = true;
    }

    if (this.grounded && !jumped) {
      // friction
      const speed = Math.hypot(this.vx, this.vz);
      if (speed > 0.01) {
        const control = Math.max(speed, PM.stopSpeed);
        const ns = Math.max(0, speed - control * PM.friction * dt) / speed;
        this.vx *= ns; this.vz *= ns;
      } else { this.vx = 0; this.vz = 0; }
      if (wlen > 0) this.accelerate(wx, wz, wishSpeed, PM.accel, dt);
      this.vy = 0;
    } else {
      // air
      if (wlen > 0) {
        if (inp.forward === 0 && inp.side !== 0) this.accelerate(wx, wz, Math.min(wishSpeed, PM.airStrafeCap), PM.airStrafeAccel, dt);
        else this.accelerate(wx, wz, wishSpeed, PM.airAccel, dt);
      }
      this.vy -= GRAVITY * dt;
    }

    this.move(dt);
    this.checkPads(dt);
    this.checkTeleporters(dt);
    if (this.y < PM.voidY) { if (this.onVoid) this.onVoid(); else this.respawn(); }
  }

  private move(dt: number) {
    const h = this.height, hw = PM.hw, e = 1e-4;
    // X
    this.x += this.vx * dt;
    let b = this.overlaps(this.x, this.y, this.z, h);
    if (b) { this.x = this.vx > 0 ? b.min[0] - hw - e : b.max[0] + hw + e; this.vx = 0; }
    // Z
    this.z += this.vz * dt;
    b = this.overlaps(this.x, this.y, this.z, h);
    if (b) { this.z = this.vz > 0 ? b.min[2] - hw - e : b.max[2] + hw + e; this.vz = 0; }
    // Y
    this.y += this.vy * dt;
    b = this.overlaps(this.x, this.y, this.z, h);
    if (b) {
      if (this.vy <= 0) { this.y = b.max[1]; this.vy = 0; this.grounded = true; }
      else { this.y = b.min[1] - h - e; this.vy = 0; }
    } else if (this.vy <= 0.1) {
      // ground probe slightly below feet
      this.grounded = !!this.overlaps(this.x, this.y - 0.05, this.z, h);
      if (this.grounded) this.vy = 0;
    } else this.grounded = false;
    if (this.vy > 0.1) this.grounded = false;
  }

  private checkTeleporters(dt: number) {
    this.tpCooldown = Math.max(0, this.tpCooldown - dt);
    if (this.tpCooldown > 0) return;
    for (const t of teleporters) {
      if (!inGate(t, this.x, this.y, this.z)) continue;
      // come out facing the gate's direction, keeping horizontal speed (teleport mid-run)
      const sp = Math.hypot(this.vx, this.vz), s = Math.sin(t.yaw), c = Math.cos(t.yaw);
      const from: [number, number, number] = [this.x, this.y, this.z];
      this.x = t.dest[0]; this.y = t.dest[1] + 0.05; this.z = t.dest[2];
      this.vx = -s * sp; this.vz = -c * sp; this.vy = Math.max(0, this.vy);
      this.grounded = false; this.tpCooldown = 0.8; this.yaw = t.yaw;
      this.teleported = { yaw: t.yaw, from, to: [t.dest[0], t.dest[1], t.dest[2]] };
      return;
    }
  }

  private checkPads(dt: number) {
    for (const [i, t] of this.padCooldown) { if (t - dt <= 0) this.padCooldown.delete(i); else this.padCooldown.set(i, t - dt); }
    for (let i = 0; i < pads.length; i++) {
      if (this.padCooldown.has(i)) continue;
      const p = pads[i];
      const dx = this.x - p.pos[0], dz = this.z - p.pos[2], dy = this.y - p.pos[1];
      if (dx * dx + dz * dz > 1.5 * 1.5 || dy < -0.3 || dy > 0.9) continue;
      if (p.kind === 'bounce') {
        this.vy = BOUNCE_VY[p.tier]; this.lastPad = `${p.tier.toUpperCase()} BOUNCE`;
      } else {
        const v = jumpPadVelocity([this.x, p.pos[1], this.z], p.target);
        this.vx = v[0]; this.vy = v[1]; this.vz = v[2]; this.lastPad = 'JUMP PAD';
      }
      this.grounded = false; this.padCooldown.set(i, 0.4); this.lastPadTime = performance.now();
    }
  }
}
