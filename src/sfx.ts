// Synthesised sound effects (Web Audio): no audio files to download. Every sound is a few oscillator / noise nodes
// that free themselves when done. Browsers (iOS especially) only allow audio after a user gesture: call unlock() from one.
import type { WeaponId } from './weapons';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let volume = 0.7;
try { const v = localStorage.getItem('mq-vol'); if (v !== null) volume = Number(v); } catch { /* ignore */ }

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext; if (!AC) return;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = volume;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}
export function setVolume(v: number) { volume = v; if (master) master.gain.value = v; try { localStorage.setItem('mq-vol', String(v)); } catch { /* ignore */ } }
export function getVolume() { return volume; }

const ready = () => !!(ctx && master && noise && ctx.state === 'running');

function env(g: GainNode, t: number, a: number, peak: number, d: number) {
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
/** filtered noise burst */
function burst(dur: number, peak: number, type: BiquadFilterType, f0: number, f1: number, q = 0.8, vol = 1) {
  const c = ctx!, t = c.currentTime;
  const s = c.createBufferSource(); s.buffer = noise!; s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain(); env(g, t, 0.002, peak * vol, dur);
  s.connect(f).connect(g).connect(master!); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
/** pitched tone with a frequency sweep */
function tone(dur: number, peak: number, type: OscillatorType, f0: number, f1: number, delay = 0, vol = 1) {
  const c = ctx!, t = c.currentTime + delay;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = c.createGain(); env(g, t, 0.003, peak * vol, dur);
  o.connect(g).connect(master!); o.start(t); o.stop(t + dur + 0.05);
}

let arcLast = 0;
/** a weapon firing. vol < 1 for other players' shots (distance) */
export function shot(id: WeaponId, vol = 1) {
  if (!ready() || vol < 0.03) return;
  switch (id) {
    case 'pistol':  burst(0.09, 0.55, 'bandpass', 2600, 700, 0.9, vol); tone(0.07, 0.25, 'square', 420, 120, 0, vol); break;
    case 'scatter': burst(0.32, 0.9, 'lowpass', 4200, 180, 0.7, vol); tone(0.22, 0.5, 'sine', 140, 45, 0, vol); break;
    case 'nailer':  burst(0.05, 0.32, 'highpass', 3200, 1500, 0.7, vol); tone(0.05, 0.16, 'square', 900, 380, 0, vol); break;
    case 'rocket':  burst(0.5, 0.5, 'lowpass', 1400, 120, 0.6, vol); tone(0.35, 0.3, 'sawtooth', 160, 60, 0, vol); break;
    case 'rail':    tone(0.5, 0.35, 'sawtooth', 220, 1800, 0, vol); tone(0.4, 0.3, 'sine', 1800, 300, 0.02, vol); burst(0.25, 0.4, 'highpass', 6000, 2000, 0.6, vol); break;
    case 'plasma':  tone(0.1, 0.22, 'square', 1300, 420, 0, vol); burst(0.07, 0.15, 'bandpass', 3000, 1200, 2, vol); break;
    case 'arc': { const n = ctx!.currentTime; if (n - arcLast < 0.11) return; arcLast = n; tone(0.12, 0.13, 'sawtooth', 95 + Math.random() * 30, 80, 0, vol); burst(0.12, 0.12, 'bandpass', 2200, 1800, 3, vol); break; }
    case 'blade':   burst(0.18, 0.35, 'bandpass', 900, 3200, 1.5, vol); break;
  }
}
/** our attack landed */
let hitLast = 0;
export function hit(dmg: number) {
  if (!ready()) return; const n = ctx!.currentTime; if (n - hitLast < 0.045) return; hitLast = n;   // minigun/shotgun: one tick per burst
  tone(0.06, 0.32, 'sine', 1900 - Math.min(700, dmg * 6), 1500, 0, 1); tone(0.04, 0.12, 'triangle', 3800, 3000, 0, 1);
}
/** we fragged someone */
export function kill() { if (!ready()) return; tone(0.12, 0.35, 'triangle', 880, 880); tone(0.22, 0.35, 'triangle', 1320, 1320, 0.09); }
/** explosion, attenuated by distance */
export function boom(size: number, dist: number) {
  if (!ready()) return; const vol = Math.min(1, 14 / (dist + 6)) * Math.min(1.2, size / 3.5); if (vol < 0.04) return;
  burst(0.8, 0.9, 'lowpass', 1800, 60, 0.6, vol); tone(0.5, 0.6, 'sine', 90, 32, 0, vol);
}
/** we took damage */
export function hurt() { if (!ready()) return; tone(0.14, 0.4, 'sine', 160, 70); burst(0.1, 0.25, 'lowpass', 900, 200, 0.8); }
export function pickup() { if (!ready()) return; tone(0.08, 0.2, 'sine', 660, 990); tone(0.1, 0.18, 'sine', 990, 1320, 0.06); }
export function jumpPad() { if (!ready()) return; tone(0.3, 0.22, 'sine', 220, 880); }
export function died() { if (!ready()) return; tone(0.6, 0.35, 'sawtooth', 300, 50); }
