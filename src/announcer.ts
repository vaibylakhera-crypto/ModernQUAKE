// Kill announcer: multi-kills (kills in quick succession), killing sprees (kills without dying), first blood and match calls.
// Each call shows a banner, plays a stinger and speaks the line with the phone's own speech voice (deep and slow).
import * as sfx from './sfx';

const SPREES: Record<number, string> = { 5: 'KILLING SPREE', 10: 'RAMPAGE', 15: 'DOMINATING', 20: 'UNSTOPPABLE', 25: 'GODLIKE' };
const MULTI = ['', '', 'DOUBLE KILL', 'MULTI KILL', 'ULTRA KILL', 'MONSTER KILL'];
const WINDOW_MS = 4500;      // kills this close together chain into a multi-kill

export class Announcer {
  enabled = true;
  /** called when a line starts (the game ducks the music so the voice is clear) */
  onSpeak?: () => void;
  private kills: number[] = []; private spree = 0; private first = true;
  private voice: SpeechSynthesisVoice | null = null; private hideT = 0;
  constructor(private el: HTMLElement) {
    try { this.enabled = localStorage.getItem('mq-announcer') !== '0'; } catch { /* ignore */ }
    try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => { this.voice = null; }; } catch { /* no speech */ }
  }
  setEnabled(v: boolean) { this.enabled = v; try { localStorage.setItem('mq-announcer', v ? '1' : '0'); } catch { /* ignore */ } if (!v) try { speechSynthesis.cancel(); } catch { /* ignore */ } }
  /** new match: first blood is available again */
  reset() { this.kills = []; this.spree = 0; this.first = true; }
  /** the local player died: the spree and the chain end */
  died() { this.kills = []; this.spree = 0; }
  /** the local player scored a kill */
  kill(now = performance.now()) {
    this.spree++; this.kills = this.kills.filter(t => now - t < WINDOW_MS); this.kills.push(now);
    const n = this.kills.length;
    if (SPREES[this.spree]) this.say(SPREES[this.spree], `${this.spree} KILLS IN A ROW`, 3);
    else if (n >= 2) this.say(MULTI[Math.min(5, n)], `${n} KILLS IN A ROW`.replace('IN A ROW', 'IN QUICK SUCCESSION'), Math.min(3, n));
    else if (this.first) this.say('FIRST BLOOD', '', 2);
    this.first = false;
  }
  /** any line: banner + stinger + voice */
  say(text: string, sub = '', level = 2) {
    if (!this.enabled) return;
    this.banner(text, sub, level); sfx.stinger(level); this.speak(text);
  }
  private banner(text: string, sub: string, level: number) {
    const e = this.el; e.className = ''; void e.offsetWidth;                        // restart the animation
    e.innerHTML = `<div class="ann-t">${text}</div>${sub ? `<div class="ann-s">${sub}</div>` : ''}`; e.className = 'show l' + level;
    clearTimeout(this.hideT); this.hideT = window.setTimeout(() => { e.className = ''; }, 2600);
  }
  private pickVoice(): SpeechSynthesisVoice | null {
    if (this.voice) return this.voice;
    try {
      const all = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); if (!all.length) return null;
      const male = all.find(v => /(male|daniel|david|alex|fred|george|mark|james|arthur|rishi|aaron|gordon|google uk english male)/i.test(v.name) && !/female/i.test(v.name));
      return (this.voice = male ?? all[0]);
    } catch { return null; }
  }
  private speak(text: string) {
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text.toLowerCase()), v = this.pickVoice(); if (v) u.voice = v;
      u.pitch = 0.3; u.rate = 0.8; u.volume = 1;                                       // low and measured, like an arena announcer
      speechSynthesis.cancel(); speechSynthesis.speak(u); this.onSpeak?.();
    } catch { /* speech is optional */ }
  }
}
