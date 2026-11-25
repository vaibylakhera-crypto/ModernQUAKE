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
  private said = new Set<string>(); private stand: number | null = null;
  /** this match's bests, for the medals screen */
  bestSpree = 0; bestMulti = 0; gotFirstBlood = false;
  /** new match: first blood is available again */
  reset() { this.kills = []; this.spree = 0; this.first = true; this.said.clear(); this.stand = null; this.bestSpree = 0; this.bestMulti = 0; this.gotFirstBlood = false; }
  /**
   * match calls, checked a few times a second while playing.
   * timeLeft: seconds on the clock (-1 = no limit) · fragsLeft: what the leader still needs (-1 = none) ·
   * standing: where the local player is (1 leading, 0 tied for the lead, -1 behind, null = nobody has scored) · elapsed: seconds played
   */
  match(timeLeft: number, fragsLeft: number, standing: number | null, elapsed: number) {
    const once = (k: string, text: string, level = 2) => { if (this.said.has(k)) return; this.said.add(k); this.say(text, '', level); };
    if (timeLeft >= 0) for (const [w, t] of [[60, 'ONE MINUTE REMAINING'], [30, '30 SECONDS'], [10, '10 SECONDS']] as [number, string][]) if (timeLeft <= w && timeLeft > w - 4) once('t' + w, t, w === 10 ? 3 : 2);
    if (fragsLeft >= 1 && fragsLeft <= 3) once('f' + fragsLeft, fragsLeft === 1 ? 'ONE FRAG LEFT' : `${fragsLeft} FRAGS LEFT`, fragsLeft === 1 ? 3 : 2);
    if (standing !== null) {
      if (this.stand !== null && standing !== this.stand && elapsed > 12) this.say(standing === 1 ? 'YOU HAVE TAKEN THE LEAD' : standing === 0 ? 'TIED FOR THE LEAD' : 'YOU HAVE LOST THE LEAD', '', 2);
      this.stand = standing;
    }
  }
  /** the local player died: the spree and the chain end */
  died() { this.kills = []; this.spree = 0; }
  /** the local player scored a kill */
  kill(now = performance.now()) {
    this.spree++; this.kills = this.kills.filter(t => now - t < WINDOW_MS); this.kills.push(now);
    const n = this.kills.length; this.bestSpree = Math.max(this.bestSpree, this.spree); this.bestMulti = Math.max(this.bestMulti, n); if (this.first) this.gotFirstBlood = true;
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
      if (matchMedia('(pointer: coarse)').matches) return;               // phones: speech can interrupt the game's audio (iOS), so banner + stinger only
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text.toLowerCase()), v = this.pickVoice(); if (v) u.voice = v;
      u.pitch = 0.3; u.rate = 0.8; u.volume = 1;                                       // low and measured, like an arena announcer
      speechSynthesis.cancel(); speechSynthesis.speak(u); this.onSpeak?.();
    } catch { /* speech is optional */ }
  }
}
