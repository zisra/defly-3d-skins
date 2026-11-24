// Sound for the demo, all synthesized with Web Audio (no audio files): a
// soundtrack that builds act by act, locked to the show clock, plus effects.

const BPM = 110;
const SIX = 60 / BPM / 4; // a sixteenth note, seconds
const BAR = SIX * 16;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
// A minor: Am, F, C, G, two bars each
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const ROOTS = [33, 29, 36, 31];

// How full the soundtrack is at show time s.
function level(s) {
  if (s < 7) return 0;
  if (s < 15) return 1;
  if (s < 46) return 2;
  if (s < 56) return 2.5; // paint wave: arpeggio
  if (s < 93) return 3;
  if (s < 111) return 4;
  if (s < 121) return 1.5; // dawn
  return 0;
}

export class DemoAudio {
  constructor({ muted = false } = {}) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC() : null;
    this.enabled = true;
    this.muted = muted;
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);
    // a soft room
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.#impulse(2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    this.verb.connect(wet).connect(this.master);
    this.noise = this.#noiseBuffer();
    this.scheduled = 0; // show time up to which music is scheduled
  }

  #impulse(sec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
    }
    return b;
  }

  #noiseBuffer() {
    const ctx = this.ctx, n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  resume() { this.ctx?.resume?.(); }

  setMuted(m) {
    this.muted = m;
    if (!this.ctx) return;
    this.resume();
    this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  // Pause/seek: drop what's queued and restart scheduling from show time s.
  restart(s) { this.scheduled = s; }

  setPaused(p) {
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(p ? 0 : 0.55, this.ctx.currentTime, 0.08);
  }

  close() { this.ctx?.close?.(); }

  get live() { return !!this.ctx && this.enabled && this.ctx.state === 'running'; }

  // ------------------------------------------------------------------ music
  // Called every frame with the show time; schedules the next notes.
  music(T) {
    if (!this.live) { this.scheduled = T; return; }
    const ahead = T + 0.18;
    let n = Math.ceil(this.scheduled / SIX - 1e-6);
    for (; n * SIX < ahead; n++) {
      const s = n * SIX;
      if (s < T - 0.02) continue;
      this.#note(n, s, this.ctx.currentTime + (s - T));
    }
    this.scheduled = ahead;
  }

  #note(n, s, when) {
    const lv = level(s);
    const step = n % 16, bar = Math.floor(n / 16), chord = Math.floor(bar / 2) % 4;
    const notes = CHORDS[chord];
    if (s >= 121 && s < 121 + SIX) this.#pad([45, 52, 57, 59, 64], when, 7, 0.11); // the sunrise chord, held
    if (s >= 128) return;
    // pad on each chord change
    if (n % 32 === 0 && s < 121) this.#pad(notes, when, BAR * 2 + 0.6, lv === 0 ? 0.1 : lv >= 4 ? 0.06 : 0.075, lv >= 4 ? 2600 : 1300);
    if (lv >= 1 && lv !== 1.5 && step % 2 === 0) this.#bass(ROOTS[chord], when, lv >= 4 && step % 4 === 2 ? 0.2 : 0.15);
    if (lv >= 2) {
      if (step % 4 === 0) this.#kick(when);
      if (step % 2 === 0 || lv >= 4) this.#hat(when, lv >= 3 && step % 4 === 2 ? 0.16 : 0.035, lv >= 4 ? 0.05 : 0.04);
    }
    if (lv >= 3 && (step === 4 || step === 12)) this.#snare(when);
    if (lv === 2.5 || lv >= 4) {
      const pat = [0, 1, 2, 1, 2, 0, 1, 2];
      this.#arp(notes[pat[step % 8]] + 24 + (step >= 8 ? 12 : 0) * (lv >= 4 ? 1 : 0), when);
    }
    if (lv === 1.5 && step % 8 === 0) { // dawn bells
      const mel = [76, 74, 72, 71, 72, 74, 76, 79];
      this.#bell(mel[(bar * 2 + step / 8) % 8], when);
    }
  }

  #env(g, when, attack, peak, dur, release) {
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.setValueAtTime(peak, when + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, when + dur);
  }

  #out(node, bus, send = 0.3) {
    node.connect(bus);
    if (send) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      node.connect(s).connect(this.verb);
    }
  }

  #pad(notes, when, dur, gain, cutoff = 1300) {
    const ctx = this.ctx, g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff * 0.5, when);
    f.frequency.linearRampToValueAtTime(cutoff, when + dur * 0.5);
    f.Q.value = 0.7;
    this.#env(g, when, Math.min(1.2, dur * 0.3), gain, dur, Math.min(1.6, dur * 0.4));
    for (const n of notes) for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = det;
      o.connect(f);
      o.start(when);
      o.stop(when + dur + 0.05);
    }
    f.connect(g);
    this.#out(g, this.musicBus, 0.5);
  }

  #bass(n, when, gain) {
    const ctx = this.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = midi(n);
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(900, when);
    f.frequency.exponentialRampToValueAtTime(180, when + 0.2);
    this.#env(g, when, 0.005, gain, 0.22, 0.12);
    o.connect(f).connect(g);
    this.#out(g, this.musicBus, 0);
    o.start(when);
    o.stop(when + 0.25);
  }

  #kick(when) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.14);
    g.gain.setValueAtTime(0.75, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.38);
    o.connect(g);
    this.#out(g, this.musicBus, 0);
    o.start(when);
    o.stop(when + 0.4);
  }

  #noiseHit(when, { type = 'highpass', freq = 7000, q = 0.7, gain = 0.05, decay = 0.05, bus = this.musicBus, send = 0.1 } = {}) {
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0008, when + decay);
    src.connect(f).connect(g);
    this.#out(g, bus, send);
    src.start(when, Math.random() * 1.5);
    src.stop(when + decay + 0.02);
    return { f, g };
  }

  #hat(when, decay, gain) { this.#noiseHit(when, { freq: 7500, gain, decay }); }

  #snare(when) {
    this.#noiseHit(when, { type: 'bandpass', freq: 1900, q: 0.8, gain: 0.22, decay: 0.2, send: 0.35 });
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(200, when);
    o.frequency.exponentialRampToValueAtTime(120, when + 0.08);
    g.gain.setValueAtTime(0.18, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
    o.connect(g);
    this.#out(g, this.musicBus, 0.2);
    o.start(when);
    o.stop(when + 0.14);
  }

  #arp(n, when) {
    const ctx = this.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = midi(n);
    f.type = 'lowpass';
    f.frequency.value = 2800;
    g.gain.setValueAtTime(0.035, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + SIX * 1.6);
    o.connect(f).connect(g);
    this.#out(g, this.musicBus, 0.45);
    o.start(when);
    o.stop(when + SIX * 1.7);
  }

  #bell(n, when, gain = 0.07, dur = 1.8) {
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    for (const [ratio, amp] of [[1, 1], [2.01, 0.35], [3.98, 0.12]]) {
      const o = ctx.createOscillator(), a = ctx.createGain();
      o.frequency.value = midi(n) * ratio;
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(when);
      o.stop(when + dur);
    }
    this.#out(g, this.musicBus, 0.6);
  }

  // ------------------------------------------------------------------ effects
  get now() { return this.ctx.currentTime; }

  #sweepNoise(when, dur, f0, f1, gain, { pan = 0, q = 1.2, bus = this.sfxBus, send = 0.3 } = {}) {
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    src.loop = true;
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, when);
    f.frequency.exponentialRampToValueAtTime(f1, when + dur);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + dur * 0.45);
    g.gain.linearRampToValueAtTime(0, when + dur);
    let node = src.connect(f).connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node = node.connect(p);
    }
    this.#out(node, bus, send);
    src.start(when, Math.random());
    src.stop(when + dur + 0.05);
  }

  #tone(when, dur, f0, f1, gain, type = 'sine', send = 0.3) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, when);
    o.frequency.exponentialRampToValueAtTime(f1, when + dur);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g);
    this.#out(g, this.sfxBus, send);
    o.start(when);
    o.stop(when + dur + 0.02);
  }

  swell() { // the grid lighting up
    if (!this.live) return;
    const w = this.now;
    this.#tone(w, 3.5, 40, 80, 0.3, 'sine', 0.4);
    this.#sweepNoise(w, 3.2, 200, 2400, 0.08, { q: 0.6 });
  }

  scan(dur) {
    if (!this.live) return;
    const w = this.now;
    this.#tone(w, dur, 260, 1300, 0.045, 'triangle', 0.5);
    this.#sweepNoise(w, dur, 900, 5000, 0.035, { q: 2 });
  }

  thump() {
    if (!this.live) return;
    this.#tone(this.now, 0.32, 120, 44, 0.32, 'sine', 0.2);
  }

  liftoff(pan = 0) {
    if (!this.live) return;
    this.#sweepNoise(this.now, 1.5, 250, 1500, 0.11, { pan, q: 0.9 });
  }

  whoosh(pan = 0, k = 1) {
    if (!this.live) return;
    this.#sweepNoise(this.now, 0.95, 2200, 380, 0.2 * k, { pan, q: 1.4 });
  }

  boom() {
    if (!this.live) return;
    const w = this.now;
    this.#tone(w, 1.2, 90, 30, 0.45, 'sine', 0.5);
    for (const pan of [-0.8, -0.3, 0.3, 0.8]) this.#sweepNoise(w + Math.abs(pan) * 0.1, 1.6, 2600, 300, 0.09, { pan });
  }

  tracer(pan = 0) {
    if (!this.live) return;
    this.#tone(this.now, 0.05, 1500, 700, 0.022, 'square', 0.1);
    void pan;
  }

  hit() {
    if (!this.live) return;
    const w = this.now;
    this.#noiseHit(w, { type: 'lowpass', freq: 2600, gain: 0.22, decay: 0.32, bus: this.sfxBus, send: 0.3 });
    for (let i = 1; i < 5; i++) this.#noiseHit(w + i * 0.045, { type: 'highpass', freq: 3500, gain: 0.06, decay: 0.03, bus: this.sfxBus });
  }

  shimmer() {
    if (!this.live) return;
    const w = this.now;
    [81, 84, 88, 93, 96, 100].forEach((n, i) => this.#bell(n, w + i * 0.07, 0.035, 1.4));
  }

  zap() {
    if (!this.live) return;
    this.#tone(this.now, 0.3, 2200, 260, 0.05, 'sawtooth', 0.3);
  }

  chime() {
    if (!this.live) return;
    const w = this.now;
    [69, 76, 81, 83, 88].forEach((n, i) => this.#bell(n, w + i * 0.09, 0.05, 3));
  }

  swish() {
    if (!this.live) return;
    this.#sweepNoise(this.now, 0.7, 500, 3200, 0.07, { q: 1 });
  }
}
