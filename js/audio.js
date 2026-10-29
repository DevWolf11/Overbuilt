'use strict';
// Procedural sound: engine rumble, wind and reentry roar, staging, explosions, chimes.

const Sound = {
  ctx: null,
  live: false, // a flight is under way: the engine and wind loops are wanted
  quietAt: 0,  // performance.now() once the last one-off sound (a click in the hangar) has played, and a little after
  unlock() {
    if (this.ctx) { this.settle(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.applyVolume();
      // brown noise buffer shared by everything
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      this.noise = buf;
      const loop = (type, freq) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(f); f.connect(g); g.connect(this.master);
        src.start(0, Math.random() * 1.5);
        return { f, g };
      };
      const e = loop('lowpass', 300); this.engFilter = e.f; this.engGain = e.g;
      const w = loop('bandpass', 700); this.windFilter = w.f; this.windGain = w.g;
      this.windFilter.Q.value = 0.6;
      this.settle();
    } catch (err) { this.ctx = null; }
  },
  // The context only runs while something needs it: a flight under way, or a one-off sound for as long as it
  // plays. Otherwise, and whenever the game is out of sight, it is suspended, so a phone's audio can sleep.
  setLive(on) { this.live = !!on; this.settle(); },
  oneOff(dur) { this.quietAt = Math.max(this.quietAt, performance.now() + dur * 1000 + 3000); this.settle(); },
  settle() {
    const ctx = this.ctx;
    if (!ctx) return;
    clearTimeout(this.napT);
    const now = performance.now(), on = !document.hidden && (this.live || now < this.quietAt);
    if (on) {
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      if (!this.live) this.napT = setTimeout(() => this.settle(), this.quietAt - now + 20);
    } else if (ctx.state === 'running') { // (once the engine and wind have faded out; at once when hidden)
      this.napT = setTimeout(() => {
        if (document.hidden || !(this.live || performance.now() < this.quietAt)) ctx.suspend().catch(() => {});
      }, document.hidden ? 100 : 1000);
    }
  },
  // out of sight: fade out and sleep (the frames stop, so nothing else would turn the engine down); back: fade in
  onVisibility() {
    if (!this.ctx) return;
    if (document.hidden) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02); else this.applyVolume();
    this.settle();
  },
  applyVolume() {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(Settings.get('volume'), this.ctx.currentTime, 0.05);
  },
  // Glide a loop's parameter towards v, but only once v has moved more than eps from where it was last sent
  // (engine and wind are set every frame, mostly to what they already were)
  glide(k, param, v, tau, eps) {
    const A = this.aims || (this.aims = {});
    if (Math.abs(v - A[k]) <= eps) return;
    A[k] = v;
    param.setTargetAtTime(v, this.ctx.currentTime, tau);
  },
  engine(level, air) {
    if (!this.ctx) return;
    const g = clamp(level, 0, 1) * (0.25 + 0.75 * clamp(air, 0, 1)) * 0.9;
    this.glide('eg', this.engGain.gain, g, 0.08, 1e-3);
    this.glide('ef', this.engFilter.frequency, 180 + 520 * clamp(level, 0, 1) * (0.4 + 0.6 * air), 0.1, 0.5);
  },
  wind(k) {
    if (!this.ctx) return;
    k = clamp(k, 0, 1.5);
    this.glide('wg', this.windGain.gain, k * 0.35, 0.15, 1e-3);
    this.glide('wf', this.windFilter.frequency, 400 + k * 900, 0.2, 0.5);
  },
  burst(dur, freq, vol, type = 'lowpass') {
    if (!this.ctx) return;
    this.oneOff(dur);
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  },
  ignite() { this.burst(0.5, 500, 0.9); this.burst(0.15, 2000, 0.3, 'highpass'); },
  separate() { this.burst(0.25, 900, 0.9, 'bandpass'); },
  explode() { this.burst(1.6, 260, 1.6); this.burst(0.5, 1200, 0.5); },
  click() { this.burst(0.06, 2400, 0.25, 'highpass'); },
  // weapons: a gun's crack (deeper for a cannon), a missile's whoosh, the tick of a hit on metal
  gun(big) { this.burst(big ? 0.12 : 0.06, big ? 700 : 1400, big ? 0.55 : 0.32, 'bandpass'); },
  missile() { this.burst(1.1, 900, 0.6, 'bandpass'); this.burst(0.3, 300, 0.5); },
  hit() { this.burst(0.05, 3200, 0.3, 'highpass'); },
  // A tank gun's report: a blast of noise through a lowpass that closes, over a 60 Hz thump, deeper and longer the bigger
  // the gun (cal, mm). Further off (dist, m) it is quieter, duller (only the low end carries) and later: sound takes its
  // time, 340 m/s, so a far gun's flash comes first. Nothing past 2 km.
  cannon(cal, dist = 0) {
    const d = Math.max(0, +dist || 0);
    if (!this.ctx || d > 2000) return;
    const k = clamp((+cal || 75) / 100, 0.3, 1.6), fall = 1 / (1 + d / 150), late = d / 340, dur = 0.45 + 0.55 * k;
    this.oneOff(dur + late);
    const ctx = this.ctx, t = ctx.currentTime + late;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime((1500 - 450 * k) * (0.3 + 0.7 * fall), t); f.frequency.exponentialRampToValueAtTime(110, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 + 1.5 * k * fall, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
    const o = ctx.createOscillator(), og = ctx.createGain(); // (the thump)
    o.type = 'sine'; o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.35 + 0.2 * k);
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.9 * k * fall + 0.02, t + 0.01); og.gain.exponentialRampToValueAtTime(0.001, t + 0.4 + 0.25 * k);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.7 + 0.25 * k);
  },
  // the seeker's growl and lock tone: a sine, not the square beep
  tone(f = 1000, dur = 0.12, vol = 0.05) {
    if (!this.ctx) return;
    this.oneOff(dur);
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  beep(f = 880) {
    if (!this.ctx) return;
    this.oneOff(0.18);
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.18);
  },
  // Sonic boom: the double crack of an N-wave (bow and tail shocks), then a rolling rumble.
  boom(k = 1) {
    if (!this.ctx) return;
    this.oneOff(1.8);
    const ctx = this.ctx, t = ctx.currentTime, sr = ctx.sampleRate;
    if (!this.nwave) {
      const len = Math.round(sr * 0.32), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0), n = Math.round(sr * 0.045);
      for (const at of [0, Math.round(sr * 0.13)]) for (let i = 0; i < n && at + i < len; i++) d[at + i] += (1 - (2 * i) / n) * (at ? 0.8 : 1);
      this.nwave = buf;
    }
    const src = ctx.createBufferSource(); src.buffer = this.nwave;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = 1.4 * k;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    this.burst(1.8, 140, 1.1 * k);
    this.burst(0.35, 600, 0.4 * k, 'bandpass');
  },
  chime() {
    if (!this.ctx) return;
    this.oneOff(0.9);
    const ctx = this.ctx, t = ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.18, t + i * 0.09 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.6);
      o.connect(g); g.connect(this.master); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.7);
    });
  },
};
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => Sound.unlock(), { passive: true });
document.addEventListener('visibilitychange', () => Sound.onVisibility());
