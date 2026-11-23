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
}
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return;
      const c = new AC(); buildGraph(c, c.destination);
    }
    if ((ctx as AudioContext).state === 'suspended') void (ctx as AudioContext).resume();
  } catch { ctx = null; }
}
export function setVolume(v: number) { volume = v; if (masterGain) masterGain.gain.value = v; try { localStorage.setItem('mq-vol', String(v)); } catch { /* ignore */ } }
export function getVolume() { return volume; }
const ready = () => !!(ctx && master && noise && verb && ((ctx as AudioContext).state === undefined || (ctx as AudioContext).state === 'running') && live < 28);

// ───────── building blocks ─────────
const jit = (amt = 0.06) => 1 + (Math.random() * 2 - 1) * amt;
/** a mixing bus for one sound: level, stereo position and how much goes to the reverb */
function bus(vol: number, pan: number, rev: number): GainNode {
  const c = ctx!, g = c.createGain(); g.gain.value = vol;
  const p = (c as any).createStereoPanner ? (c as AudioContext).createStereoPanner() : null;
  if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master!); } else g.connect(master!);
  if (rev > 0) { const s = c.createGain(); s.gain.value = rev; g.connect(s); s.connect(verb!); }
  return g;
}
function env(g: GainNode, t: number, atk: number, peak: number, dec: number) {
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + atk); g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
}
function done(node: AudioScheduledSourceNode, end: number) { live++; node.onended = () => { live--; }; node.stop(end); }
/** filtered noise: sweeps its filter from f0 to f1 while fading out */
function nz(dest: AudioNode, o: { t?: number; dur: number; peak: number; type: BiquadFilterType; f0: number; f1: number; q?: number; atk?: number }) {
  const c = ctx!, t = c.currentTime + (o.t ?? 0);
  const s = c.createBufferSource(); s.buffer = noise!; s.playbackRate.value = jit(0.3); s.loop = true;
  const f = c.createBiquadFilter(); f.type = o.type; f.Q.value = o.q ?? 0.8; f.frequency.setValueAtTime(o.f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + o.dur);
  const g = c.createGain(); env(g, t, o.atk ?? 0.002, o.peak, o.dur);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 1.2); done(s, t + o.dur + (o.atk ?? 0.002) + 0.05);
}
/** a pitched tone that glides from f0 to f1 */
function tn(dest: AudioNode, o: { t?: number; dur: number; peak: number; type: OscillatorType; f0: number; f1: number; atk?: number }) {
  const c = ctx!, t = c.currentTime + (o.t ?? 0), osc = c.createOscillator(); osc.type = o.type;
  osc.frequency.setValueAtTime(o.f0, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + o.dur);
  const g = c.createGain(); env(g, t, o.atk ?? 0.002, o.peak, o.dur);
  osc.connect(g).connect(dest); osc.start(t); done(osc, t + o.dur + (o.atk ?? 0.002) + 0.05);
}

// ───────── weapons ─────────
const lastAt: Record<string, number> = {};
const gate = (k: string, ms: number) => { const n = performance.now(); if (n - (lastAt[k] ?? 0) < ms) return false; lastAt[k] = n; return true; };

/** a weapon firing. vol < 1 for other players' shots (distance), pan -1 (left) .. 1 (right) */
export function shot(id: WeaponId, vol = 1, pan = 0) {
  if (!ready() || vol < 0.03) return;
  const j = jit();
  switch (id) {
    case 'pistol': {   // sharp snap, tight punch, short room tail
      const b = bus(0.95 * vol, pan, 0.34);
      nz(b, { dur: 0.06, peak: 0.85, type: 'bandpass', f0: 4200, f1: 1100, q: 0.7 });
      tn(b, { dur: 0.11, peak: 0.7, type: 'sine', f0: 300 * j, f1: 70 });
      tn(b, { dur: 0.03, peak: 0.16, type: 'square', f0: 2100 * j, f1: 500 });
      nz(b, { t: 0.01, dur: 0.22, peak: 0.16, type: 'lowpass', f0: 3000, f1: 300 });
      break;
    }
    case 'scatter': {  // heavy boom, wide noise blast, then the pump action
      const b = bus(1.0 * vol, pan, 0.5);
      nz(b, { dur: 0.1, peak: 0.95, type: 'bandpass', f0: 3000, f1: 500, q: 0.6 });
      tn(b, { dur: 0.42, peak: 0.95, type: 'sine', f0: 120 * j, f1: 34 });
      nz(b, { dur: 0.5, peak: 0.6, type: 'lowpass', f0: 1800, f1: 120 });
      nz(b, { t: 0.02, dur: 0.3, peak: 0.18, type: 'bandpass', f0: 2200, f1: 700, q: 0.7 });
      nz(b, { t: 0.4, dur: 0.05, peak: 0.3, type: 'bandpass', f0: 1400, f1: 900, q: 2 });          // pump: clack
      tn(b, { t: 0.4, dur: 0.045, peak: 0.16, type: 'square', f0: 330, f1: 190 });
      nz(b, { t: 0.5, dur: 0.05, peak: 0.28, type: 'bandpass', f0: 1000, f1: 1600, q: 2 });       // pump: forward
      break;
    }
    case 'nailer': {   // a crisp mechanical tick with a small thump; pitch varies so a burst rattles
      if (!gate('nailer', 36)) return;
      const b = bus(1.0 * vol, pan, 0.12);
      nz(b, { dur: 0.03, peak: 0.55, type: 'bandpass', f0: 2600 * j, f1: 1400, q: 0.9 });
      tn(b, { dur: 0.055, peak: 0.7, type: 'triangle', f0: 200 * jit(0.12), f1: 80 });
      tn(b, { dur: 0.025, peak: 0.1, type: 'square', f0: 1700 * j, f1: 1100 });
      break;
    }
    case 'rocket': {   // launch thump, rushing whoosh, ignition crackle
      const b = bus(1.0 * vol, pan, 0.5);
      tn(b, { dur: 0.35, peak: 0.85, type: 'sine', f0: 125 * j, f1: 42 });
      nz(b, { atk: 0.04, dur: 0.7, peak: 0.55, type: 'bandpass', f0: 350, f1: 1900, q: 1.1 });
      nz(b, { dur: 0.16, peak: 0.4, type: 'highpass', f0: 2200, f1: 900 });
      nz(b, { t: 0.05, dur: 0.5, peak: 0.22, type: 'lowpass', f0: 1200, f1: 150 });
      break;
    }
    case 'rail': {     // electric zap up, a ringing ping, a heavy crack and a deep sub
      const b = bus(1.0 * vol, pan, 0.55);
      tn(b, { dur: 0.13, peak: 0.34, type: 'sawtooth', f0: 160, f1: 3400 });
      tn(b, { t: 0.02, dur: 0.6, peak: 0.36, type: 'sine', f0: 2400 * j, f1: 650 });
      nz(b, { dur: 0.11, peak: 0.6, type: 'highpass', f0: 3800, f1: 1800 });
      tn(b, { dur: 0.35, peak: 0.6, type: 'sine', f0: 95, f1: 38 });
      tn(b, { t: 0.03, dur: 0.4, peak: 0.12, type: 'triangle', f0: 4400 * j, f1: 3000 });
      break;
    }
    case 'plasma': {   // a rounded "pew": fast pitch drop with a fizzy edge
      if (!gate('plasma', 40)) return;
      const b = bus(1.1 * vol, pan, 0.3);
      tn(b, { dur: 0.15, peak: 0.45, type: 'sine', f0: 1900 * j, f1: 330 });
      tn(b, { dur: 0.11, peak: 0.14, type: 'square', f0: 950 * j, f1: 240 });
      nz(b, { dur: 0.06, peak: 0.14, type: 'bandpass', f0: 3600, f1: 1800, q: 1.5 });
      tn(b, { dur: 0.18, peak: 0.28, type: 'sine', f0: 140, f1: 70 });
      break;
    }
    case 'arc': {      // a crackling electric buzz (throttled: it fires 20 times a second)
      if (!gate('arc', 110)) return;
      const b = bus(1.3 * vol, pan, 0.2);
      tn(b, { dur: 0.13, peak: 0.28, type: 'sawtooth', f0: 105 * jit(0.15), f1: 80 });
      nz(b, { dur: 0.13, peak: 0.2, type: 'bandpass', f0: 2000 * j, f1: 1300, q: 3 });
      nz(b, { t: Math.random() * 0.08, dur: 0.02, peak: 0.22, type: 'bandpass', f0: 3600, f1: 2800, q: 1.2 });
      break;
    }
    case 'blade': {    // a quick whoosh
      const b = bus(1.3 * vol, pan, 0.2);
      nz(b, { atk: 0.04, dur: 0.22, peak: 0.5, type: 'bandpass', f0: 500, f1: 3000 * j, q: 1.2 });
      tn(b, { dur: 0.16, peak: 0.1, type: 'triangle', f0: 380, f1: 900 });
      break;
    }
  }
}
/** our attack landed: a bright two-part tick whose pitch rises with the damage */
export function hit(dmg: number) {
  if (!ready() || !gate('hit', 45)) return;
  const b = bus(1.4, 0, 0.12), k = 1 + Math.min(0.35, dmg / 220);
  tn(b, { dur: 0.07, peak: 0.45, type: 'sine', f0: 1500 * k, f1: 1250 * k });
  tn(b, { t: 0.012, dur: 0.05, peak: 0.2, type: 'triangle', f0: 3000 * k, f1: 2600 * k });
  nz(b, { dur: 0.015, peak: 0.1, type: 'bandpass', f0: 4200, f1: 3000, q: 1 });
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
  const b = bus(1.0 * vol, pan, 0.62);
  tn(b, { dur: 0.7, peak: 1.0, type: 'sine', f0: 85, f1: 26 });
  nz(b, { dur: 1.0, peak: 0.8, type: 'lowpass', f0: 2400, f1: 70, q: 0.5 });
  nz(b, { dur: 0.09, peak: 0.55, type: 'highpass', f0: 1500, f1: 700 });
  nz(b, { t: 0.02, dur: 0.5, peak: 0.35, type: 'bandpass', f0: 900, f1: 200, q: 0.7 });
  for (let i = 0; i < 4; i++) nz(b, { t: 0.12 + Math.random() * 0.5, dur: 0.05, peak: 0.12 + Math.random() * 0.1, type: 'bandpass', f0: 1800 + Math.random() * 2500, f1: 900, q: 1.5 });
}
/** we took damage: a dull thump with a grunt-like noise */
export function hurt() { if (!ready() || !gate('hurt', 80)) return; const b = bus(1.1, 0, 0.18); tn(b, { dur: 0.16, peak: 0.55, type: 'sine', f0: 170, f1: 58 }); nz(b, { dur: 0.13, peak: 0.3, type: 'lowpass', f0: 1300, f1: 180 }); }
export function pickup() { if (!ready()) return; const b = bus(0.8, 0, 0.25); tn(b, { dur: 0.09, peak: 0.28, type: 'sine', f0: 660, f1: 990 }); tn(b, { t: 0.07, dur: 0.14, peak: 0.26, type: 'sine', f0: 990, f1: 1320 }); }
export function jumpPad() { if (!ready()) return; const b = bus(0.55, 0, 0.3); tn(b, { dur: 0.32, peak: 0.28, type: 'sine', f0: 200, f1: 900 }); nz(b, { atk: 0.05, dur: 0.3, peak: 0.2, type: 'bandpass', f0: 600, f1: 3000, q: 1 }); }
export function teleport() { if (!ready()) return; const b = bus(0.6, 0, 0.5); tn(b, { dur: 0.4, peak: 0.3, type: 'sine', f0: 280, f1: 1500 }); tn(b, { t: 0.05, dur: 0.45, peak: 0.16, type: 'triangle', f0: 1900, f1: 420 }); nz(b, { dur: 0.35, peak: 0.2, type: 'bandpass', f0: 4200, f1: 800, q: 2 }); }
export function powerup() { if (!ready()) return; const b = bus(0.6, 0, 0.4); tn(b, { dur: 0.12, peak: 0.28, type: 'square', f0: 440, f1: 880 }); tn(b, { t: 0.1, dur: 0.14, peak: 0.28, type: 'square', f0: 660, f1: 1320 }); tn(b, { t: 0.2, dur: 0.34, peak: 0.26, type: 'triangle', f0: 880, f1: 1760 }); }
export function died() { if (!ready()) return; const b = bus(0.7, 0, 0.5); tn(b, { dur: 0.7, peak: 0.4, type: 'sawtooth', f0: 320, f1: 48 }); nz(b, { dur: 0.5, peak: 0.3, type: 'lowpass', f0: 1500, f1: 90 }); }

let fakeClock = 1e6;
/** test hook: render one sound into an offline buffer so it can be measured without speakers */
export async function renderForTest(play: () => void, seconds = 1.6): Promise<Float32Array[]> {
  const saved = { ctx, master, verb, noise, masterGain, live };
  const off = new OfflineAudioContext(2, Math.floor(44100 * seconds), 44100);
  buildGraph(off, off.destination); live = 0;
  const prevNow = performance.now.bind(performance); performance.now = () => (fakeClock += 500);                    // defeat the retrigger gates
  Object.defineProperty(off, 'state', { value: 'running' });
  play();
  performance.now = prevNow;
  const buf = await off.startRendering();
  ({ ctx, master, verb, noise, masterGain, live } = saved);
  return [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
}
