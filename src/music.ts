// Background music.
//  • BATTLE SCORE (default): an adaptive drum-driven score that builds as the match goes on and as the fighting heats up:
//    low war-drum pulse -> syncopated toms -> hats and bass -> snare rolls -> four-on-the-floor and full layers.
//  • Four original synthesised tracks (funk, drift/phonk, techno, synthwave) that loop.
//  • Your own music: add audio files from your phone; they are stored on the device (IndexedDB) and join the playlist.
// Everything synthesised is generated live, so there are no audio files to download.
import { audioContext } from './sfx';

export interface Track { id: string; name: string; sub: string; kind: 'score' | 'synth' | 'file' }
export const BUILTIN: Track[] = [
  { id: 'score', name: 'BATTLE SCORE', sub: 'Adaptive drums · builds with the match', kind: 'score' },
  { id: 'funk', name: 'NIGHT FUNK', sub: 'Funk groove · 104 BPM', kind: 'synth' },
  { id: 'drift', name: 'DRIFT MODE', sub: 'Phonk · 138 BPM', kind: 'synth' },
  { id: 'pulse', name: 'ARENA PULSE', sub: 'Techno · 128 BPM', kind: 'synth' },
  { id: 'chase', name: 'SYNTH CHASE', sub: 'Synthwave · 112 BPM', kind: 'synth' },
];
const BPM: Record<string, number> = { funk: 104, drift: 138, pulse: 128, chase: 112 };
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = () => Math.random();
/** music sits under the sound effects: the volume slider is scaled by this */
const LEVEL = 0.5;

// ───────── instruments ─────────
class Synth {
  private curve: Float32Array<ArrayBuffer>;
  constructor(private c: BaseAudioContext, private out: AudioNode, private noise: AudioBuffer) {
    this.curve = new Float32Array(512); for (let i = 0; i < 512; i++) { const x = (i / 511) * 2 - 1; this.curve[i] = Math.tanh(x * 2.6); }
  }
  private g(t: number, a: number, peak: number, d: number) { const g = this.c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; }
  private noiseSrc(t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, atk = 0.001) {
    const c = this.c, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true; s.playbackRate.value = 0.8 + rnd() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = this.g(t, atk, peak, dur); s.connect(f).connect(g).connect(this.out); s.start(t, rnd() * 1.5); s.stop(t + dur + atk + 0.05);
  }
  private osc(t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number, atk = 0.002, sat = false, dest?: AudioNode) {
    const c = this.c, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur * 0.5);
    const g = this.g(t, atk, peak, dur); let n: AudioNode = o; if (sat) { const w = c.createWaveShaper(); w.curve = this.curve; o.connect(w); n = w; }
    n.connect(g).connect(dest ?? this.out); o.start(t); o.stop(t + dur + atk + 0.05);
  }
  kick(t: number, v = 1) { this.osc(t, 'sine', 165, 46, 0.3, 0.95 * v, 0.002, true); this.noiseSrc(t, 0.02, 'highpass', 2500, 2500, 0.7, 0.18 * v); }
  snare(t: number, v = 1) { this.noiseSrc(t, 0.2, 'bandpass', 2100, 1500, 0.7, 0.6 * v); this.osc(t, 'triangle', 200, 150, 0.12, 0.38 * v); }
  hat(t: number, v = 0.3, open = false) { this.noiseSrc(t, open ? 0.26 : 0.045, 'highpass', 7600, 7600, 0.6, v); }
  clap(t: number, v = 0.7) { for (let i = 0; i < 3; i++) this.noiseSrc(t + i * 0.011, i === 2 ? 0.16 : 0.025, 'bandpass', 1500, 1300, 0.8, 0.5 * v); }
  tom(t: number, f: number, v = 1) { this.osc(t, 'sine', f * 1.7, f, 0.55, 0.95 * v, 0.002, true); this.noiseSrc(t, 0.07, 'lowpass', 500, 200, 0.7, 0.35 * v); }
  bass(t: number, m: number, dur: number, v = 0.5, type: OscillatorType = 'sawtooth', cut = 900) {
    const c = this.c, o = c.createOscillator(); o.type = type; o.frequency.value = mtof(m);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(cut * 1.6, t); f.frequency.exponentialRampToValueAtTime(Math.max(120, cut * 0.35), t + dur);
    const g = this.g(t, 0.004, v, dur); o.connect(f).connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.06);
  }
  /** 808-style sub bass (saturated so phone speakers hear its harmonics), optional glide */
  sub(t: number, m: number, dur: number, v = 0.8, glideTo?: number) {
    const c = this.c, o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(mtof(m), t); if (glideTo !== undefined) o.frequency.exponentialRampToValueAtTime(mtof(glideTo), t + dur * 0.8);
    const w = c.createWaveShaper(); w.curve = this.curve; const g = this.g(t, 0.003, v, dur); o.connect(w).connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.06);
  }
  stab(t: number, notes: number[], dur: number, v = 0.3) {
    const c = this.c, f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(650, t + dur);
    const g = this.g(t, 0.003, v, dur); f.connect(g).connect(this.out);
    for (const m of notes) for (const d of [-6, 6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = d; const og = c.createGain(); og.gain.value = 1 / (notes.length * 2); o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.08); }
  }
  pluck(t: number, m: number, v = 0.15, cut = 2400, dur = 0.16, type: OscillatorType = 'sawtooth') {
    const c = this.c, o = c.createOscillator(); o.type = type; o.frequency.value = mtof(m);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 3; f.frequency.setValueAtTime(cut, t); f.frequency.exponentialRampToValueAtTime(300, t + dur);
    const g = this.g(t, 0.002, v, dur); o.connect(f).connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.06);
  }
  cowbell(t: number, v = 0.22) {
    const c = this.c, f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.2; const g = this.g(t, 0.001, v, 0.13); f.connect(g).connect(this.out);
    for (const fr of [587, 845]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = fr; const og = c.createGain(); og.gain.value = 0.5; o.connect(og).connect(f); o.start(t); o.stop(t + 0.2); }
  }
  pad(t: number, notes: number[], dur: number, v = 0.1, cut = 1100) {
    const c = this.c, f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cut; f.Q.value = 0.7;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.35); g.gain.setValueAtTime(v, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur); f.connect(g).connect(this.out);
    for (const m of notes) for (const d of [-9, 0, 9]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = d; const og = c.createGain(); og.gain.value = 1 / (notes.length * 3); o.connect(og).connect(f); o.start(t); o.stop(t + dur + 0.1); }
  }
  riser(t: number, dur: number, v = 0.35) { this.noiseSrc(t, dur, 'bandpass', 300, 7000, 1.4, v, dur * 0.9); }
  crash(t: number, v = 0.4) { this.noiseSrc(t, 1.3, 'highpass', 3800, 3800, 0.5, v); }
}

// ───────── custom tracks on the device (IndexedDB) ─────────
interface Rec { id: string; name: string; blob: Blob }
function openDb(): Promise<IDBDatabase | null> {
  return new Promise(res => { try { const r = indexedDB.open('mq-music', 1); r.onupgradeneeded = () => r.result.createObjectStore('tracks', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch { res(null); } });
}
async function dbAll(): Promise<Rec[]> { const db = await openDb(); if (!db) return []; return new Promise(res => { const q = db.transaction('tracks').objectStore('tracks').getAll(); q.onsuccess = () => res(q.result as Rec[]); q.onerror = () => res([]); }); }
async function dbPut(r: Rec) { const db = await openDb(); if (!db) return; await new Promise<void>(res => { const t = db.transaction('tracks', 'readwrite'); t.objectStore('tracks').put(r); t.oncomplete = () => res(); t.onerror = () => res(); }); }
async function dbDel(id: string) { const db = await openDb(); if (!db) return; await new Promise<void>(res => { const t = db.transaction('tracks', 'readwrite'); t.objectStore('tracks').delete(id); t.oncomplete = () => res(); t.onerror = () => res(); }); }

export class Music {
  volume = 0.45;
  playing = true;                         // the user's play/pause choice
  currentId = 'score';
  custom: (Track & { blob: Blob })[] = [];
  private ctx: BaseAudioContext | null = null; private bus: GainNode | null = null; private synth: Synth | null = null;
  private timer = 0; private nextT = 0; private stepNo = 0;
  private intensity = 0.15; private target = 0.15;
  private fileEl: HTMLAudioElement | null = null; private fileUrl = ''; private fileSrc: MediaElementAudioSourceNode | null = null;
  private listeners: (() => void)[] = [];
  /** set by the game: called on a user-visible track change (to show "now playing") */
  onNow?: (t: Track) => void;

  constructor() {
    try {
      this.volume = Number(localStorage.getItem('mq-music-vol') ?? '0.45'); this.currentId = localStorage.getItem('mq-music-track') || 'score'; this.playing = localStorage.getItem('mq-music-on') !== '0';
    } catch { /* ignore */ }
    void this.loadCustom();
  }
  onChange(f: () => void) { this.listeners.push(f); }
  private emit() { for (const f of this.listeners) f(); }
  tracks(): Track[] { return [...BUILTIN, ...this.custom]; }
  get current(): Track { return this.tracks().find(t => t.id === this.currentId) ?? BUILTIN[0]; }
  private async loadCustom() { const all = await dbAll(); this.custom = all.map(r => ({ id: r.id, name: r.name, sub: 'Your music', kind: 'file' as const, blob: r.blob })); this.emit(); }

  /** call after the first user tap (audio is allowed from then on) */
  start() {
    const c = audioContext(); if (!c) return; if (!this.ctx) this.build(c);
    if (this.playing) this.begin();
  }
  private build(c: BaseAudioContext, out?: AudioNode) {
    this.ctx = c;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.2;
    this.bus = c.createGain(); this.bus.gain.value = this.volume * LEVEL;
    const sat = c.createWaveShaper(), curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 1.2) / Math.tanh(1.2); sat.curve = curve;   // soft limiter: never clips
    this.bus.connect(comp).connect(sat).connect(out ?? c.destination);
    const noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.synth = new Synth(c, this.bus, noise);
  }
  private begin() {
    this.stopAll(); const t = this.current;
    if (t.kind === 'file') { void this.playFile(t as Track & { blob: Blob }); return; }
    const c = this.ctx!; this.stepNo = 0; this.nextT = c.currentTime + 0.12;
    this.timer = window.setInterval(() => { this.run(c.currentTime + 1.2); }, 100);     // schedule well ahead: a slow frame can't leave a gap
  }
  private stopAll() {
    clearInterval(this.timer); this.timer = 0;
    if (this.fileEl) { this.fileEl.pause(); this.fileEl.src = ''; this.fileEl = null; this.fileSrc = null; }
    if (this.fileUrl) { URL.revokeObjectURL(this.fileUrl); this.fileUrl = ''; }
  }
  private async playFile(t: Track & { blob: Blob }) {
    const c = this.ctx as AudioContext; this.fileUrl = URL.createObjectURL(t.blob);
    const a = new Audio(this.fileUrl); (a as any).playsInline = true; a.loop = false; this.fileEl = a;
    try { this.fileSrc = c.createMediaElementSource(a); this.fileSrc.connect(this.bus!); } catch { a.volume = this.volume; }
    a.onended = () => this.next();
    try { await a.play(); } catch { /* needs a tap */ }
  }

  // ───── controls ─────
  play(id?: string) { if (id) { this.currentId = id; try { localStorage.setItem('mq-music-track', id); } catch { /* ignore */ } } this.playing = true; try { localStorage.setItem('mq-music-on', '1'); } catch { /* ignore */ } this.start(); this.emit(); this.onNow?.(this.current); }
  pause() { this.playing = false; try { localStorage.setItem('mq-music-on', '0'); } catch { /* ignore */ } this.stopAll(); this.emit(); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  next(d = 1) { const l = this.tracks(), i = l.findIndex(t => t.id === this.currentId); this.play(l[(i + d + l.length) % l.length].id); }
  setVolume(v: number) { this.volume = v; try { localStorage.setItem('mq-music-vol', String(v)); } catch { /* ignore */ } if (this.bus) this.bus.gain.value = v * LEVEL; if (this.fileEl && !this.fileSrc) this.fileEl.volume = v; }
  /** turn the music down for a moment (an announcer line is being spoken) */
  duck(ms = 1700) {
    if (!this.bus || !this.ctx) return; const t = this.ctx.currentTime, g = this.bus.gain, v = this.volume * LEVEL;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v * 0.35, t + 0.12); g.setValueAtTime(v * 0.35, t + ms / 1000); g.linearRampToValueAtTime(v, t + ms / 1000 + 0.5);
  }
  /** 0 calm .. 1 frantic: drives the adaptive score */
  setIntensity(x: number) { this.target = Math.max(0, Math.min(1, x)); }
  async addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('audio/') && !/\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(f.name)) continue;
      const rec: Rec = { id: 'u' + Date.now() + Math.floor(Math.random() * 1000), name: f.name.replace(/\.[^.]+$/, '').toUpperCase().slice(0, 40), blob: f };
      await dbPut(rec); this.custom.push({ id: rec.id, name: rec.name, sub: 'Your music', kind: 'file', blob: f });
    }
    this.emit();
  }
  async remove(id: string) { await dbDel(id); this.custom = this.custom.filter(t => t.id !== id); if (this.currentId === id) this.play('score'); else this.emit(); }

  // ───── the sequencer ─────
  /** schedule every step that starts before `until` (seconds on the audio clock) */
  run(until: number) {
    while (this.nextT < until) {
      const i = this.stepNo % 16, bar = Math.floor(this.stepNo / 16);
      this.intensity += (this.target - this.intensity) * 0.035;
      const bpm = this.currentId === 'score' ? 88 + 44 * this.intensity : (BPM[this.currentId] ?? 110);
      const sixteenth = 60 / bpm / 4, swing = this.currentId === 'funk' && i % 2 === 1 ? sixteenth * 0.18 : 0;
      this.pattern(this.currentId, i, bar, this.nextT + swing);
      this.nextT += sixteenth; this.stepNo++;
    }
  }
  private pattern(id: string, i: number, bar: number, t: number) {
    const s = this.synth!;
    if (id === 'score') return this.score(i, bar, t, s);
    if (id === 'funk') {          // E minor funk: slapped bass, offbeat chord stabs, ghost-note snares
      const r = [40, 40, 45, 40, 40, 45, 47, 47][bar % 8], dom = r === 45 || r === 47;
      if ([0, 6, 10].includes(i)) s.kick(t, i === 6 ? 0.7 : 1);
      if (i === 4 || i === 12) s.snare(t, 0.9); if (i === 7 || i === 15) s.snare(t, 0.16);
      s.hat(t, i % 2 ? 0.14 : 0.27, i === 14);
      const bn: Record<number, number> = { 0: r, 3: r, 6: r + 12, 8: r, 10: r + 7, 14: r + (dom ? 4 : 5) }; if (bn[i] !== undefined) s.bass(t, bn[i], 0.13, 0.55, 'sawtooth', 800);
      if (i === 2 || i === 11) s.stab(t, [r + 12, r + (dom ? 16 : 15), r + 19, r + 22], 0.11, 0.3);
      if (i % 4 === 3 && bar % 2) s.pluck(t, r + 24, 0.1, 3000, 0.1, 'square');
      if (bar % 8 === 7 && i >= 12) s.snare(t, 0.4 + (i - 12) * 0.12);
    } else if (id === 'drift') {  // phonk: saturated 808 slides, cowbell melody, half-time clap, hat rolls
      const r = [29, 25, 27, 24][Math.floor(bar / 2) % 4] + 12;
      if (i === 0 || i === 10) s.kick(t, 0.95); if (i === 3) s.kick(t, 0.5);
      if (i === 0) s.sub(t, r, 0.7, 0.85); if (i === 3) s.sub(t, r, 0.2, 0.6); if (i === 10) s.sub(t, r, 0.5, 0.8, r - 5);
      if (i === 8) { s.clap(t, 0.9); s.snare(t, 0.5); }
      if (i >= 12) { s.hat(t, 0.2); s.hat(t + 0.05, 0.12); } else s.hat(t, i % 2 ? 0.1 : 0.2, i === 6);
      if (i === 6 || i === 10 || i === 14) s.cowbell(t, i === 10 ? 0.26 : 0.2);
      if (i === 0 && bar % 2 === 0) s.pad(t, [r + 12, r + 15, r + 19, r + 22], 60 / 138 * 8, 0.09, 800);
    } else if (id === 'pulse') {  // techno: four on the floor, acid bass, plucked arpeggio
      if (i % 4 === 0) s.kick(t, 1); if (i % 4 === 2) s.hat(t, 0.3, true); else s.hat(t, 0.1);
      if (i === 4 || i === 12) s.clap(t, 0.8);
      const acid = i % 4 !== 2 ? [33, 33, 0, 36, 33, 33, 0, 40, 33, 33, 0, 36, 33, 33, 0, 45][i] : 0;
      if (acid) s.bass(t, acid, 0.13, 0.5, 'sawtooth', 450 + 1700 * (0.5 + 0.5 * Math.sin(bar * 0.45 + i * 0.12)));
      s.pluck(t, [57, 60, 64, 67, 64, 60, 69, 64][i % 8] + (bar % 4 === 3 ? 5 : 0), 0.11, 2600, 0.12);
      if (bar % 8 === 7 && i === 0) s.riser(t, 60 / 128 * 8, 0.3); if (bar % 4 === 0 && i === 0) s.crash(t, 0.3);
    } else if (id === 'chase') {  // synthwave: gated bass, big snare, rolling arpeggio, wide pad
      const r = [42, 38, 45, 40][bar % 4], ch = [r + 12, r + (bar % 4 === 2 || bar % 4 === 1 ? 16 : 15), r + 19];
      if (i === 0 || i === 8 || i === 10) s.kick(t, 0.95); if (i === 4 || i === 12) { s.snare(t, 1); s.clap(t, 0.4); }
      if (i % 2 === 0) { s.hat(t, 0.2); s.bass(t, i % 4 === 2 ? r + 12 : r, 0.15, 0.5, 'sawtooth', 700); }
      s.pluck(t, ch[[0, 1, 2, 1][i % 4]] + (i >= 8 ? 12 : 0), 0.1, 2200, 0.12);
      if (i === 0) s.pad(t, ch, 60 / 112 * 4, 0.1, 1400);
    }
  }
  /** the adaptive battle score: layers switch on as the intensity rises */
  /** phones: cap how busy the battle score gets (fewer sounds per beat = less audio work and less garbage) */
  light = false;
  private score(i: number, bar: number, t: number, s: Synth) {
    const k = this.light ? Math.min(0.6, this.intensity) : this.intensity, minor = [40, 36, 43, 38][Math.floor(bar / 2) % 4];
    if (i === 0 && bar % 4 === 0) s.pad(t, [minor - 12, minor - 5, minor], 60 / (88 + 44 * k) * 16, 0.1 + 0.06 * k, 500 + 900 * k);        // dark drone
    // 1) the war-drum heartbeat: "DUM . . . dum . . ."
    if (i === 0) s.tom(t, 62, 1); if (i === 8) s.tom(t, 70, 0.7);
    // 2) the toms start to answer
    if (k > 0.18 && (i === 6 || i === 14)) s.tom(t, i === 6 ? 88 : 96, 0.55 + k * 0.4); if (k > 0.3 && i === 11) s.tom(t, 80, 0.5);
    // 3) the pulse: hats and a driving sub
    if (k > 0.36) { if (i % 2 === 0) s.hat(t, 0.08 + 0.18 * k); if (i % 4 === 0) s.sub(t, minor, 0.22, 0.4 + 0.2 * k); }
    // 4) snare rolls build to the end of every four-bar phrase; the kick joins
    if (k > 0.5) { if (i === 0 || i === 10) s.kick(t, 0.8); if (bar % 4 === 3 && i >= 8) s.snare(t, 0.25 + (i - 8) * 0.07 * (0.5 + k)); else if (i === 12) s.snare(t, 0.5); }
    // 5) full drive: four on the floor, claps, 16th taiko, strings
    if (k > 0.66) { if (i % 4 === 0) s.kick(t, 0.9); if (i === 4 || i === 12) s.clap(t, 0.5); if (i % 2 === 1) s.tom(t, 110 + (i % 4) * 14, 0.25); s.hat(t, 0.1); }
    if (k > 0.8) { if (i === 0) s.pad(t, [minor + 12, minor + 15, minor + 19], 60 / (88 + 44 * k) * 4, 0.12, 2200); if (bar % 4 === 0 && i === 0) s.crash(t, 0.35); if (i % 4 === 2) s.pluck(t, minor + 24 + (i % 8), 0.08, 2400, 0.1); }
    if (bar % 8 === 7 && i === 0 && k > 0.4) s.riser(t, 60 / (88 + 44 * k) * 16, 0.25);
  }

  /** test hook: render a stretch of a track offline so it can be measured without speakers */
  static async renderForTest(id: string, seconds: number, intensity = 0.5): Promise<Float32Array> {
    const off = new OfflineAudioContext(1, Math.floor(44100 * seconds), 44100), m = new Music(); m.currentId = id; m.intensity = m.target = intensity;
    m.build(off, off.destination); m.nextT = 0.02; m.stepNo = 0; m.run(seconds);
    return (await off.startRendering()).getChannelData(0).slice();
  }
}
