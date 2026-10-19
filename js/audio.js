'use strict';
// Procedural sound: engine rumble, wind and reentry roar, staging, explosions, chimes.

const Sound = {
  ctx: null,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
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
    } catch (err) { this.ctx = null; }
  },
  applyVolume() {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(Settings.get('volume'), this.ctx.currentTime, 0.05);
  },
  engine(level, air) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = clamp(level, 0, 1) * (0.25 + 0.75 * clamp(air, 0, 1)) * 0.9;
    this.engGain.gain.setTargetAtTime(g, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(180 + 520 * clamp(level, 0, 1) * (0.4 + 0.6 * air), t, 0.1);
  },
  wind(k) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    k = clamp(k, 0, 1.5);
    this.windGain.gain.setTargetAtTime(k * 0.35, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(400 + k * 900, t, 0.2);
  },
  burst(dur, freq, vol, type = 'lowpass') {
    if (!this.ctx) return;
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
  beep(f = 880) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.18);
  },
  // Sonic boom: the double crack of an N-wave (bow and tail shocks), then a rolling rumble.
  boom(k = 1) {
    if (!this.ctx) return;
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
