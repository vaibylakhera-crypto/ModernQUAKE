// Quick chat + voice chat.
//  - Quick chat: a short list of phrases (tap one to send). Team games send to your team by default.
//  - Voice: WebRTC audio, peer to peer. The room server only relays the setup messages. In team games you connect to (and
//    hear) your teammates only; in deathmatch everyone hears everyone. Push-to-talk or open mic, chosen in Settings.

export const QUICK: { k: string; text: string }[] = [
  { k: 'nice', text: 'NICE SHOT!' }, { k: 'help', text: 'NEED HELP!' }, { k: 'enemy', text: 'ENEMY SPOTTED' }, { k: 'omw', text: 'ON MY WAY' },
  { k: 'flag', text: 'GET THE FLAG!' }, { k: 'def', text: 'DEFEND THE BASE!' }, { k: 'thx', text: 'THANKS!' }, { k: 'gg', text: 'GOOD GAME' },
];
export const quickText = (k: string) => QUICK.find(q => q.k === k)?.text ?? k.toUpperCase();

export type VoiceMode = 'off' | 'ptt' | 'open';
const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };   // public STUN: lets phones behind a router find each other

interface Peer { pc: RTCPeerConnection; audio: HTMLAudioElement; sender: RTCRtpSender | null; pending: RTCIceCandidateInit[]; hasRemote: boolean; id: number }

export class Voice {
  mode: VoiceMode = 'ptt';
  volume = 1;
  private stream: MediaStream | null = null; private track: MediaStreamTrack | null = null;
  private peers = new Map<number, Peer>();
  private talking = false;
  /** why the mic is not working (shown in Settings) */
  error = '';
  constructor(private myId: () => number, private signal: (to: number, d: any) => void, private onTalking: (on: boolean) => void) {
    try { const m = localStorage.getItem('mq-voice'); if (m === 'off' || m === 'ptt' || m === 'open') this.mode = m; this.volume = Number(localStorage.getItem('mq-vvol') ?? '1'); } catch { /* ignore */ }
  }
  static get supported() { return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia; }
  get micOn() { return !!this.track; }

  setMode(m: VoiceMode) { this.mode = m; try { localStorage.setItem('mq-voice', m); } catch { /* ignore */ } if (m === 'off') this.stopMic(); else if (m === 'open') void this.ensureMic().then(() => this.apply()); else this.apply(); }
  setVolume(v: number) { this.volume = v; try { localStorage.setItem('mq-vvol', String(v)); } catch { /* ignore */ } for (const p of this.peers.values()) p.audio.volume = v; }

  /** asks for the microphone (must be called from a tap / key press) */
  async ensureMic(): Promise<boolean> {
    if (this.track) return true;
    if (!Voice.supported) { this.error = 'This browser cannot use the microphone.'; return false; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.track = this.stream.getAudioTracks()[0]; this.track.enabled = this.mode === 'open';
      for (const p of this.peers.values()) void p.sender?.replaceTrack(this.track);
      this.error = ''; return true;
    } catch { this.error = 'Microphone blocked. Allow microphone access for this site, then try again.'; return false; }
  }
  private stopMic() { this.track?.stop(); this.stream?.getTracks().forEach(t => t.stop()); this.track = null; this.stream = null; for (const p of this.peers.values()) void p.sender?.replaceTrack(null); this.setTalking(false); }
  private apply() { if (this.track) this.track.enabled = this.mode === 'open' || this.talking; }
  private setTalking(on: boolean) { if (this.talking === on) return; this.talking = on; this.onTalking(on && this.mode !== 'off'); }

  /** push-to-talk button / key */
  async press(down: boolean) {
    if (this.mode === 'off') return;
    if (this.mode === 'open') return;
    if (down && !this.track) { if (!(await this.ensureMic())) return; }
    this.setTalking(down); this.apply();
  }
  /** open mic: turn it on / mute it */
  async toggleOpen() { if (this.mode !== 'open') return; if (!this.track) await this.ensureMic(); else this.stopMic(); this.onTalking(this.micOn); }

  /** the set of players we should be connected to (teammates in team games, everyone otherwise) */
  setPeers(ids: number[]) {
    const want = new Set(ids.filter(i => i !== this.myId()));
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.close(id);
    for (const id of want) if (!this.peers.has(id)) { const p = this.make(id); if (this.myId() < id) void this.offer(p); }   // the lower id always makes the offer
  }
  closeAll() { for (const id of [...this.peers.keys()]) this.close(id); this.stopMic(); }
  private close(id: number) { const p = this.peers.get(id); if (!p) return; try { p.pc.close(); } catch { /* ignore */ } p.audio.srcObject = null; p.audio.remove(); this.peers.delete(id); }

  private make(id: number): Peer {
    const pc = new RTCPeerConnection(ICE), audio = new Audio(); audio.autoplay = true; (audio as any).playsInline = true; audio.volume = this.volume; document.body.appendChild(audio);
    const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const p: Peer = { pc, audio, sender: tr.sender, pending: [], hasRemote: false, id };
    if (this.track) void tr.sender.replaceTrack(this.track);
    pc.onicecandidate = e => { if (e.candidate) this.signal(id, { ice: e.candidate.toJSON() }); };
    pc.ontrack = e => { audio.srcObject = e.streams[0] ?? new MediaStream([e.track]); void audio.play().catch(() => { /* needs a tap first */ }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { this.close(id); } };
    this.peers.set(id, p); return p;
  }
  private async offer(p: Peer) { try { const o = await p.pc.createOffer(); await p.pc.setLocalDescription(o); this.signal(p.id, { sdp: p.pc.localDescription }); } catch { /* retry on next room update */ } }

  /** a setup message from another player */
  async onSignal(from: number, d: any) {
    let p = this.peers.get(from);
    if (!p) { if (!d.sdp) return; p = this.make(from); }
    try {
      if (d.sdp) {
        await p.pc.setRemoteDescription(d.sdp); p.hasRemote = true;
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        if (d.sdp.type === 'offer') { const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a); this.signal(from, { sdp: p.pc.localDescription }); }
      } else if (d.ice) { if (p.hasRemote) await p.pc.addIceCandidate(d.ice).catch(() => {}); else p.pending.push(d.ice); }
    } catch { /* ignore a bad message */ }
  }
  /** how many voice links are up (for tests / the lobby) */
  get connected() { return [...this.peers.values()].filter(p => p.pc.connectionState === 'connected').length; }
}
