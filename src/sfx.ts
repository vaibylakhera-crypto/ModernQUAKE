// Synthesised sound effects (Web Audio): no audio files to download.
// Every sound is built in layers, the way real gun sounds are:
//   CRACK  a very short bright noise transient (the "snap")
//   BODY   a pitched thump that drops in pitch (the "punch")
//   TAIL   noise that fades through a small room reverb (the "space")
// Each shot has a little random pitch / level variation so rapid fire doesn't sound like one repeated sample, and other
// players' shots and explosions are panned left / right and made quieter with distance.
// Browsers (iOS especially) only allow audio after a user gesture: call unlock() from one.
import type { WeaponId } from './weapons';

let ctx: AudioContext | BaseAudioContext | null = null;
let master: AudioNode | null = null;
let verb: ConvolverNode | null = null;
let slapIn: AudioNode | null = null;
let noise: AudioBuffer | null = null;
let volume = 0.7;
let live = 0;                                      // voices currently playing (to keep phones from choking)
try { const v = localStorage.getItem('mq-vol'); if (v !== null) volume = Number(v); } catch { /* ignore */ }

let masterGain: GainNode | null = null;
function buildGraph(c: BaseAudioContext, out: AudioNode) {
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.14;
  const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 9500; tone.Q.value = 0.5;      // takes the papery hiss off the top
  const makeup = c.createGain(); makeup.gain.value = 1.35;                                                           // the layers are mixed conservatively: bring the whole thing up
  masterGain = c.createGain(); masterGain.gain.value = volume;
  // safety: a smooth saturation curve (like an amp) so a firefight can never clip harshly; it also adds a little warmth to the punch
  const sat = c.createWaveShaper(), n = 2048, curve = new Float32Array(n), drive = 1.4;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(drive * x) / Math.tanh(drive); }
  sat.curve = curve; sat.oversample = '2x';
  masterGain.connect(tone).connect(comp).connect(makeup).connect(sat).connect(out); master = masterGain; ctx = c;
  noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // a small, dark "room": decaying noise, softened so it adds space without hiss
  const len = Math.floor(c.sampleRate * 0.9), ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const a = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.2; a[i] = lp * Math.pow(1 - i / len, 2.6); } }
  verb = c.createConvolver(); verb.buffer = ir; const vg = c.createGain(); vg.gain.value = 0.55; verb.connect(vg).connect(masterGain);
  // a single quick echo off a nearby wall (about 85 ms), dulled: gives gunfire its sense of place
  const slap = c.createDelay(0.5); slap.delayTime.value = 0.085; const sl = c.createBiquadFilter(); sl.type = 'lowpass'; sl.frequency.value = 2400; const sg = c.createGain(); sg.gain.value = 0.7;
  slap.connect(sl).connect(sg).connect(masterGain); slapIn = slap;
}
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return;
      const c = new AC(); buildGraph(c, c.destination);
    }
    if ((ctx as AudioContext).state !== 'running') void (ctx as AudioContext).resume();      // also wakes an iOS 'interrupted' context
  } catch { ctx = null; }
}
export function setVolume(v: number) { volume = v; if (masterGain) masterGain.gain.value = v; try { localStorage.setItem('mq-vol', String(v)); } catch { /* ignore */ } }
export function getVolume() { return volume; }
/** for the performance overlay */
export function stats() { return { state: ctx ? ((ctx as AudioContext).state ?? 'offline') : 'none', live }; }
/** the shared audio context (music uses it so there is only one) */
export function audioContext(): AudioContext | null { return ctx as AudioContext | null; }
const ready = () => !!(ctx && master && noise && verb && slapIn && ((ctx as AudioContext).state === undefined || (ctx as AudioContext).state === 'running') && live < 28);

// ───────── building blocks ─────────
const jit = (amt = 0.06) => 1 + (Math.random() * 2 - 1) * amt;
/** a mixing bus for one sound: level, stereo position, room reverb amount and a slap echo (the bounce off a nearby wall) */
function bus(vol: number, pan: number, rev: number, slap = 0): GainNode {
  const c = ctx!, g = c.createGain(); g.gain.value = vol;
  const p = (c as any).createStereoPanner ? (c as AudioContext).createStereoPanner() : null;
  if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master!); } else g.connect(master!);
  if (rev > 0) { const r = c.createGain(); r.gain.value = rev; g.connect(r); r.connect(verb!); }
  if (slap > 0 && slapIn) { const r = c.createGain(); r.gain.value = slap; g.connect(r); r.connect(slapIn); }
  return g;
}
function env(g: GainNode, t: number, atk: number, peak: number, dec: number) {
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
}
function done(node: AudioScheduledSourceNode, end: number) { live++; node.onended = () => { live--; }; node.stop(end); }
let distCurve: Float32Array<ArrayBuffer> | null = null;
/** hard clipping curve: turns a clean noise burst into a gritty, barking "crack" */
function dist(c: BaseAudioContext, amount = 6): WaveShaperNode {
  if (!distCurve) { distCurve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; distCurve[i] = Math.tanh(x * 6) ; } }
  const w = c.createWaveShaper(); w.curve = distCurve; w.oversample = '2x'; void amount; return w;
}
/** filtered noise. `grit` runs it through the clipper; `am` amplitude-modulates it (Hz) for a buzzy / sizzling texture */
function nz(dest: AudioNode, o: { t?: number; dur: number; peak: number; type: BiquadFilterType; f0: number; f1?: number; q?: number; atk?: number; grit?: boolean; am?: number }) {
  const c = ctx!, t = c.currentTime + (o.t ?? 0), f1 = o.f1 ?? o.f0;
  const s = c.createBufferSource(); s.buffer = noise!; s.playbackRate.value = jit(0.3); s.loop = true;
  const f = c.createBiquadFilter(); f.type = o.type; f.Q.value = o.q ?? 0.8; f.frequency.setValueAtTime(o.f0, t); if (f1 !== o.f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + o.dur);
  const g = c.createGain(); env(g, t, o.atk ?? 0.001, o.peak, o.dur);
  let node: AudioNode = f; s.connect(f);
  if (o.grit) { const w = dist(c); f.connect(w); node = w; }
  if (o.am) {                                                      // amplitude modulation: sizzle / buzz
    const am = c.createGain(); am.gain.value = 0.55; const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = o.am * jit(0.1); lg.gain.value = 0.45; lfo.connect(lg).connect(am.gain);
    node.connect(am); node = am; lfo.start(t); done(lfo, t + o.dur + 0.1);
  }
  node.connect(g).connect(dest); s.start(t, Math.random() * 1.2); done(s, t + o.dur + (o.atk ?? 0.001) + 0.05);
}
/** a low "punch": a sine that drops only a little and quickly (a pressure thump, not a laser sweep) */
function thump(dest: AudioNode, o: { t?: number; dur: number; peak: number; f: number; drop?: number }) {
  const c = ctx!, t = c.currentTime + (o.t ?? 0), osc = c.createOscillator(); osc.type = 'sine';
  osc.frequency.setValueAtTime(o.f * (o.drop ?? 1.5), t); osc.frequency.exponentialRampToValueAtTime(o.f, t + Math.min(0.05, o.dur * 0.5));
  const g = c.createGain(); env(g, t, 0.002, o.peak, o.dur); const w = dist(c); const wg = c.createGain(); wg.gain.value = 0.7;
  osc.connect(w).connect(wg).connect(g).connect(dest); osc.start(t); done(osc, t + o.dur + 0.05);
}
/** a steady (non-gliding) ring: metal tinks, rail whine */
function ring(dest: AudioNode, o: { t?: number; dur: number; peak: number; f: number; type?: OscillatorType }) {
  const c = ctx!, t = c.currentTime + (o.t ?? 0), osc = c.createOscillator(); osc.type = o.type ?? 'sine'; osc.frequency.value = o.f;
  const g = c.createGain(); env(g, t, 0.001, o.peak, o.dur); osc.connect(g).connect(dest); osc.start(t); done(osc, t + o.dur + 0.05);
}
/** a gliding tone: only for non-gun sounds (pickups, teleporters, power-ups) */
function tn(dest: AudioNode, o: { t?: number; dur: number; peak: number; type: OscillatorType; f0: number; f1: number; atk?: number }) {
  const c = ctx!, t = c.currentTime + (o.t ?? 0), osc = c.createOscillator(); osc.type = o.type;
  osc.frequency.setValueAtTime(o.f0, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
  const g = c.createGain(); env(g, t, o.atk ?? 0.002, o.peak, o.dur);
  osc.connect(g).connect(dest); osc.start(t); done(osc, t + o.dur + (o.atk ?? 0.002) + 0.05);
}
/** a spent brass casing hitting the floor: a couple of tiny, fast metallic pings */
function casing(dest: AudioNode, t0: number, peak = 0.07) {
  for (let i = 0; i < 3; i++) ring(dest, { t: t0 + i * (0.045 + Math.random() * 0.03), dur: 0.05, peak: peak / (1 + i * 0.7), f: (4300 + Math.random() * 2400) * (1 - i * 0.08), type: 'sine' });
}

// ───────── weapons ─────────
const lastAt: Record<string, number> = {};
const gate = (k: string, ms: number) => { const n = performance.now(); if (n - (lastAt[k] ?? 0) < ms) return false; lastAt[k] = n; return true; };

/**
 * A weapon firing. Built like a real firearm recording: CRACK (clipped noise transient) + BARK (mid band that survives phone speakers)
 * + BODY (low noise and a pressure thump) + TAIL (room reverb and a wall slap), plus mechanical details. Almost no pitch sweeps.
 * vol < 1 for other players' shots (distance), pan -1 (left) .. 1 (right).
 */
/** other people's / bots' shots at a distance: two layers only, no reverb, and skipped when the mixer is busy (keeps your own gun and the music clean) */
function farShot(id: WeaponId, vol: number, pan: number) {
  if (live > 16) return; const b = bus(0.95 * vol, pan, 0);
  nz(b, { dur: 0.07, peak: 0.8, type: 'bandpass', f0: 1100 * jit(0.2), f1: 500, q: 0.7, grit: true });
  thump(b, { dur: 0.1, peak: 0.5, f: id === 'rocket' || id === 'scatter' ? 70 : 105 });
}
export function shot(id: WeaponId, vol = 1, pan = 0) {
  if (!ready() || vol < 0.03) return;
  if (vol < 0.6) { farShot(id, vol, pan); return; }
  const j = jit(0.1);
  switch (id) {
    case 'pistol': {   // a dry, punchy 9mm: crack, bark, short body, one brass tinkle
      const b = bus(1.0 * vol, pan, 0.3, 0.22);
      nz(b, { dur: 0.045, peak: 0.95, type: 'bandpass', f0: 2600 * j, f1: 1500, q: 0.7, grit: true });
      nz(b, { dur: 0.07, peak: 0.75, type: 'bandpass', f0: 950 * j, f1: 600, q: 0.8, grit: true });
      nz(b, { dur: 0.1, peak: 0.6, type: 'lowpass', f0: 520, f1: 220, q: 0.7 });
      thump(b, { dur: 0.1, peak: 0.55, f: 110 * j });
      nz(b, { t: 0.012, dur: 0.2, peak: 0.16, type: 'lowpass', f0: 2600, f1: 400 });
      casing(b, 0.16 + Math.random() * 0.1);
      break;
    }
    case 'scatter': {  // a shotgun blast: huge broadband crack, heavy body, then pump-action and a shell hitting the floor
      const b = bus(1.05 * vol, pan, 0.55, 0.35);
      nz(b, { dur: 0.1, peak: 1.0, type: 'highpass', f0: 700, f1: 1200, q: 0.5, grit: true });
      nz(b, { dur: 0.16, peak: 0.9, type: 'bandpass', f0: 1100 * j, f1: 450, q: 0.5, grit: true });
      nz(b, { dur: 0.3, peak: 0.95, type: 'lowpass', f0: 650, f1: 130, q: 0.6 });
      thump(b, { dur: 0.35, peak: 0.95, f: 70 * j, drop: 1.8 });
      nz(b, { t: 0.03, dur: 0.55, peak: 0.3, type: 'lowpass', f0: 2200, f1: 180 });
      nz(b, { t: 0.42, dur: 0.035, peak: 0.45, type: 'bandpass', f0: 1500, f1: 1500, q: 3 });             // pump back
      ring(b, { t: 0.42, dur: 0.05, peak: 0.1, f: 2100, type: 'square' });
      nz(b, { t: 0.54, dur: 0.04, peak: 0.5, type: 'bandpass', f0: 2600, f1: 2600, q: 3 });               // pump forward
      casing(b, 0.62, 0.09);
      break;
    }
    case 'nailer': {   // a rapid dry machine-gun clatter: tak + thunk + metal tick. Centre frequencies wobble so a burst chatters.
      if (!gate('nailer', 34)) return;
      const b = bus(1.05 * vol, pan, 0.1, 0.14);
      nz(b, { dur: 0.022, peak: 0.85, type: 'bandpass', f0: 3000 * jit(0.14), f1: 1700, q: 1.1, grit: true });
      nz(b, { dur: 0.045, peak: 0.7, type: 'bandpass', f0: 800 * jit(0.12), f1: 500, q: 0.9, grit: true });
      nz(b, { dur: 0.05, peak: 0.45, type: 'lowpass', f0: 420, f1: 200 });
      thump(b, { dur: 0.05, peak: 0.4, f: 140 * j });
      nz(b, { t: 0.004, dur: 0.012, peak: 0.25, type: 'bandpass', f0: 5600 * jit(0.1), f1: 5600, q: 6 });  // bolt tick
      if (Math.random() < 0.35) casing(b, 0.1 + Math.random() * 0.1, 0.04);
      break;
    }
    case 'rocket': {   // launcher: a big pressure "thoomp", a rushing exhaust whoosh, and a metallic latch
      const b = bus(1.05 * vol, pan, 0.55, 0.3);
      nz(b, { dur: 0.3, peak: 1.0, type: 'lowpass', f0: 500, f1: 90, q: 0.6, grit: true });
      thump(b, { dur: 0.4, peak: 0.95, f: 62 * j, drop: 2 });
      nz(b, { atk: 0.05, dur: 0.75, peak: 0.55, type: 'bandpass', f0: 500, f1: 2600, q: 0.7 });
      nz(b, { dur: 0.09, peak: 0.55, type: 'bandpass', f0: 1400, f1: 900, q: 0.7, grit: true });
      nz(b, { t: 0.04, dur: 0.06, peak: 0.3, type: 'bandpass', f0: 1800, f1: 1800, q: 5 });
      break;
    }
    case 'rail': {     // railgun: a sharp electric crack, a heavy low boom, and a ringing metallic whine (steady pitch)
      const b = bus(1.05 * vol, pan, 0.6, 0.3);
      nz(b, { dur: 0.07, peak: 1.0, type: 'highpass', f0: 2600, f1: 1800, q: 0.6, grit: true });
      nz(b, { dur: 0.18, peak: 0.7, type: 'bandpass', f0: 4200, f1: 2200, q: 1.2, am: 130 });
      thump(b, { dur: 0.5, peak: 0.9, f: 58, drop: 1.7 });
      nz(b, { dur: 0.25, peak: 0.6, type: 'lowpass', f0: 700, f1: 120 });
      ring(b, { dur: 0.9, peak: 0.2, f: 1760 * j });
      ring(b, { dur: 0.7, peak: 0.12, f: 2640 * j, type: 'triangle' });
      break;
    }
    case 'plasma': {   // plasma: a fizzing, sizzling spit with a soft thump (Quake style), no glide
      if (!gate('plasma', 40)) return;
      const b = bus(1.05 * vol, pan, 0.25, 0.12);
      nz(b, { dur: 0.13, peak: 0.85, type: 'bandpass', f0: 3300 * j, f1: 2400, q: 1.6, am: 62, grit: true });
      nz(b, { dur: 0.05, peak: 0.45, type: 'highpass', f0: 5200, f1: 4000 });
      nz(b, { dur: 0.1, peak: 0.6, type: 'bandpass', f0: 900, f1: 600, q: 0.9 });
      thump(b, { dur: 0.1, peak: 0.55, f: 120 * j });
      break;
    }
    case 'arc': {      // lightning gun: crackling electrical discharge (throttled: it fires many times a second)
      if (!gate('arc', 100)) return;
      const b = bus(1.2 * vol, pan, 0.2, 0.1);
      nz(b, { dur: 0.12, peak: 0.7, type: 'bandpass', f0: 2300 * j, f1: 1500, q: 2.2, am: 95, grit: true });
      nz(b, { dur: 0.12, peak: 0.45, type: 'lowpass', f0: 500, f1: 300, am: 55 });
      for (let i = 0; i < 3; i++) nz(b, { t: Math.random() * 0.1, dur: 0.012, peak: 0.5, type: 'bandpass', f0: 3000 + Math.random() * 3000, f1: 2500, q: 2 });   // crackle
      break;
    }
    case 'blade': {    // an energy blade: a swing whoosh and a short metallic ring
      const b = bus(1.2 * vol, pan, 0.2, 0.1);
      nz(b, { atk: 0.05, dur: 0.24, peak: 0.6, type: 'bandpass', f0: 500, f1: 3200 * j, q: 1.1 });
      ring(b, { t: 0.02, dur: 0.18, peak: 0.1, f: 2300 * j });
      break;
    }
  }
}
/** our attack landed: a short bright "tink" (steady pitch) with a tiny click */
export function hit(dmg: number) {
  if (!ready() || !gate('hit', 45)) return;
  const b = bus(1.3, 0, 0.1), k = 1 + Math.min(0.3, dmg / 260);
  ring(b, { dur: 0.07, peak: 0.4, f: 2300 * k }); ring(b, { dur: 0.05, peak: 0.16, f: 3450 * k, type: 'triangle' });
  nz(b, { dur: 0.012, peak: 0.12, type: 'bandpass', f0: 4200, f1: 3500, q: 1 });
}
/** a frag: a short rising two-note chime */
export function kill() {
  if (!ready()) return; const b = bus(0.62, 0, 0.35);
  tn(b, { dur: 0.14, peak: 0.4, type: 'triangle', f0: 880, f1: 880 }); tn(b, { t: 0.1, dur: 0.3, peak: 0.42, type: 'triangle', f0: 1320, f1: 1320 });
  tn(b, { t: 0.1, dur: 0.3, peak: 0.12, type: 'sine', f0: 1980, f1: 1980 }); tn(b, { dur: 0.25, peak: 0.25, type: 'sine', f0: 220, f1: 165 });
}
/** an explosion: sub thump, rolling body, sharp crack and falling debris. quieter with distance, panned */
export function boom(size: number, dist: number, pan = 0) {
  if (!ready()) return; const vol = Math.min(1, 15 / (dist + 6)) * Math.min(1.25, size / 3.5); if (vol < 0.04) return;
  const b = bus(1.0 * vol, pan, 0.62, 0.3);
  thump(b, { dur: 0.8, peak: 1.0, f: 46, drop: 2.2 });
  nz(b, { dur: 1.0, peak: 0.85, type: 'lowpass', f0: 2200, f1: 70, q: 0.5, grit: true });
  nz(b, { dur: 0.09, peak: 0.7, type: 'highpass', f0: 1200, f1: 700, grit: true });
  nz(b, { t: 0.02, dur: 0.5, peak: 0.4, type: 'bandpass', f0: 900, f1: 200, q: 0.7 });
  for (let i = 0; i < 5; i++) nz(b, { t: 0.1 + Math.random() * 0.55, dur: 0.05, peak: 0.12 + Math.random() * 0.12, type: 'bandpass', f0: 1500 + Math.random() * 2500, f1: 900, q: 1.5 });
}
/** the hit that plays under an announcer line: a low boom, a brass-like chord and (for big calls) a riser and crash */
export function stinger(level: number) {
  if (!ready()) return; const b = bus(0.9, 0, 0.5, 0.2);
  thump(b, { dur: 0.7, peak: 0.9, f: 52, drop: 2 });
  nz(b, { dur: 0.35, peak: 0.45, type: 'lowpass', f0: 1800, f1: 120, grit: true });
  const chord = level >= 3 ? [110, 165, 220, 330] : [110, 165, 220];
  for (const f of chord) for (const d of [0.994, 1.006]) {
    const c = ctx!, t = c.currentTime, o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * d;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(2400, t + 0.18); lp.frequency.exponentialRampToValueAtTime(500, t + 0.9);
    const g = c.createGain(); env(g, t, 0.02, 0.1, 0.9); o.connect(lp).connect(g).connect(b); o.start(t); done(o, t + 1.0);
  }
  if (level >= 2) nz(b, { atk: 0.35, dur: 0.4, peak: 0.3, type: 'bandpass', f0: 400, f1: 5000, q: 1.2 });
  if (level >= 3) { nz(b, { t: 0.4, dur: 1.0, peak: 0.35, type: 'highpass', f0: 3600, f1: 3600 }); ring(b, { t: 0.4, dur: 0.9, peak: 0.1, f: 880, type: 'triangle' }); }
}
/** we took damage: a dull thump with a grunt-like noise */
export function hurt() { if (!ready() || !gate('hurt', 80)) return; const b = bus(1.1, 0, 0.18); tn(b, { dur: 0.16, peak: 0.55, type: 'sine', f0: 170, f1: 58 }); nz(b, { dur: 0.13, peak: 0.3, type: 'lowpass', f0: 1300, f1: 180 }); }
/** a footstep: a dull boot thump on a hard floor, with a tiny metallic scuff. `k` 0..1 = how fast you run */
export function step(k = 1) {
  if (!ready() || live > 14 || !gate('step', 110)) return; const b = bus(0.3 + 0.32 * k, 0, 0);          // no reverb send: footsteps are frequent
  thump(b, { dur: 0.09, peak: 0.55, f: 84 * jit(0.12), drop: 1.7 });
  nz(b, { dur: 0.05, peak: 0.2, type: 'bandpass', f0: 1000 * jit(0.2), f1: 420, q: 0.9 });
}
/** switching weapons: a short metallic handling click */
export function swap() {
  if (!ready() || !gate('swap', 120)) return; const b = bus(0.5, 0, 0.08);
  nz(b, { dur: 0.03, peak: 0.25, type: 'highpass', f0: 2200, f1: 1600, grit: true }); thump(b, { t: 0.05, dur: 0.08, peak: 0.4, f: 150, drop: 1.3 }); ring(b, { t: 0.05, dur: 0.05, peak: 0.08, f: 2900 });
}
/** pushing off the floor */
export function jump() {
  if (!ready() || !gate('jump', 120)) return; const b = bus(0.55, 0, 0.12);
  thump(b, { dur: 0.12, peak: 0.4, f: 66, drop: 1.8 }); nz(b, { dur: 0.1, peak: 0.12, type: 'highpass', f0: 1600, f1: 700 });
}
/** coming down: heavier the faster you hit the ground (`v` in m/s) */
export function land(v: number) {
  if (v < 5 || !ready() || !gate('land', 140)) return; const k = Math.min(1, (v - 4) / 16), b = bus(0.5 + 0.6 * k, 0, 0.18);
  thump(b, { dur: 0.16 + 0.12 * k, peak: 0.6 + 0.5 * k, f: 62, drop: 1.9 }); nz(b, { dur: 0.12, peak: 0.12 + 0.3 * k, type: 'lowpass', f0: 1400, f1: 150, q: 0.6 });
  if (k > 0.45) nz(b, { dur: 0.05, peak: 0.12, type: 'bandpass', f0: 2600, f1: 1200, q: 1 });
}
/** low health: a slow double heartbeat (louder the worse it gets, k 0..1) */
export function heartbeat(k = 1) {
  if (!ready() || !gate('heart', 500)) return; const b = bus(0.7 + 0.5 * k, 0, 0);
  thump(b, { dur: 0.16, peak: 0.85, f: 52, drop: 1.6 }); thump(b, { t: 0.2, dur: 0.14, peak: 0.55, f: 46, drop: 1.5 });
}
/** coming back into the arena: a rising shimmer */
export function spawn() {
  if (!ready()) return; const b = bus(0.55, 0, 0.45);
  tn(b, { dur: 0.5, peak: 0.16, type: 'sine', f0: 240, f1: 960 }); nz(b, { atk: 0.25, dur: 0.35, peak: 0.12, type: 'bandpass', f0: 500, f1: 4200, q: 1.2 });
  ring(b, { t: 0.3, dur: 0.35, peak: 0.1, f: 1760, type: 'triangle' }); ring(b, { t: 0.34, dur: 0.4, peak: 0.07, f: 2637, type: 'sine' });
}
/** health: a soft warm bell */
export function health() {
  if (!ready()) return; const b = bus(0.7, 0, 0.35);
  ring(b, { dur: 0.35, peak: 0.28, f: 784 }); ring(b, { t: 0.09, dur: 0.45, peak: 0.26, f: 1175 }); ring(b, { t: 0.09, dur: 0.3, peak: 0.07, f: 2349, type: 'triangle' });
}
/** armour: a heavy metallic clank */
export function armor() {
  if (!ready()) return; const b = bus(0.8, 0, 0.25);
  thump(b, { dur: 0.12, peak: 0.5, f: 110, drop: 1.4 }); ring(b, { dur: 0.22, peak: 0.2, f: 520, type: 'square' }); ring(b, { dur: 0.3, peak: 0.12, f: 1180, type: 'triangle' });
  nz(b, { dur: 0.05, peak: 0.2, type: 'bandpass', f0: 3200, f1: 1800, q: 1.2 });
}
/** a weapon or ammo: a mechanical ka-chunk */
export function weapon() {
  if (!ready()) return; const b = bus(0.8, 0, 0.2);
  nz(b, { dur: 0.025, peak: 0.28, type: 'highpass', f0: 2400, f1: 1800, grit: true }); thump(b, { dur: 0.1, peak: 0.5, f: 130, drop: 1.4 }); ring(b, { dur: 0.06, peak: 0.12, f: 3300 });
  nz(b, { t: 0.09, dur: 0.03, peak: 0.3, type: 'highpass', f0: 2000, f1: 1500, grit: true }); thump(b, { t: 0.09, dur: 0.12, peak: 0.6, f: 95, drop: 1.5 }); ring(b, { t: 0.1, dur: 0.18, peak: 0.1, f: 2100, type: 'triangle' });
}
/** countdown beep (the last one is higher and longer) */
export function tick(last = false) {
  if (!ready()) return; const b = bus(0.7, 0, 0.25);
  ring(b, { dur: last ? 0.5 : 0.14, peak: last ? 0.3 : 0.22, f: last ? 1320 : 880, type: 'triangle' }); if (last) ring(b, { dur: 0.4, peak: 0.1, f: 1980 });
}
export function pickup() { if (!ready()) return; const b = bus(0.8, 0, 0.25); tn(b, { dur: 0.09, peak: 0.28, type: 'sine', f0: 660, f1: 990 }); tn(b, { t: 0.07, dur: 0.14, peak: 0.26, type: 'sine', f0: 990, f1: 1320 }); }
export function jumpPad() { if (!ready()) return; const b = bus(0.55, 0, 0.3); tn(b, { dur: 0.32, peak: 0.28, type: 'sine', f0: 200, f1: 900 }); nz(b, { atk: 0.05, dur: 0.3, peak: 0.2, type: 'bandpass', f0: 600, f1: 3000, q: 1 }); }
export function teleport() {
  if (!ready()) return; const b = bus(0.75, 0, 0.55, 0.15);
  tn(b, { dur: 0.35, peak: 0.28, type: 'sine', f0: 180, f1: 1800 }); tn(b, { t: 0.04, dur: 0.4, peak: 0.12, type: 'sawtooth', f0: 3000, f1: 380 });
  nz(b, { atk: 0.12, dur: 0.4, peak: 0.3, type: 'bandpass', f0: 300, f1: 6000, q: 1.4, am: 38 });                         // crackling electric swell
  thump(b, { t: 0.28, dur: 0.3, peak: 0.7, f: 58, drop: 2 });                                                          // the thud of arriving
  for (let i = 0; i < 4; i++) ring(b, { t: 0.18 + i * 0.07, dur: 0.3, peak: 0.07, f: [2093, 2637, 3136, 3951][i], type: 'sine' });   // sparkle tail
}
export function powerup() { if (!ready()) return; const b = bus(0.6, 0, 0.4); tn(b, { dur: 0.12, peak: 0.28, type: 'square', f0: 440, f1: 880 }); tn(b, { t: 0.1, dur: 0.14, peak: 0.28, type: 'square', f0: 660, f1: 1320 }); tn(b, { t: 0.2, dur: 0.34, peak: 0.26, type: 'triangle', f0: 880, f1: 1760 }); }
export function died() { if (!ready()) return; const b = bus(0.7, 0, 0.5); tn(b, { dur: 0.7, peak: 0.4, type: 'sawtooth', f0: 320, f1: 48 }); nz(b, { dur: 0.5, peak: 0.3, type: 'lowpass', f0: 1500, f1: 90 }); }

let fakeClock = 1e6;
/** test hook: render one sound into an offline buffer so it can be measured without speakers */
export async function renderForTest(play: () => void, seconds = 1.6): Promise<Float32Array[]> {
  const saved = { ctx, master, verb, noise, masterGain, live, slapIn };
  const off = new OfflineAudioContext(2, Math.floor(44100 * seconds), 44100);
  buildGraph(off, off.destination); live = 0;
  const prevNow = performance.now.bind(performance); performance.now = () => (fakeClock += 500);                    // defeat the retrigger gates
  Object.defineProperty(off, 'state', { value: 'running' });
  play();
  performance.now = prevNow;
  const buf = await off.startRendering();
  ({ ctx, master, verb, noise, masterGain, live, slapIn } = saved);
  return [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
}
