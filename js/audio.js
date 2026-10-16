'use strict';
// Procedural sound: engine rumble, separation thunk, explosions, achievement chime.

const Sound = {
  ctx: null, muted: store.get('orbitforge.muted', false),
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(ctx.destination);
      // brown noise buffer shared by everything
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      this.noise = buf;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 300;
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
      src.connect(this.engFilter); this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
      src.start();
    } catch (e) { this.ctx = null; }
  },
  setMuted(m) {
    this.muted = m; store.set('orbitforge.muted', m);
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  },
  engine(level, air) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = clamp(level, 0, 1) * (0.25 + 0.75 * clamp(air, 0, 1)) * 0.9;
    this.engGain.gain.setTargetAtTime(g, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(180 + 520 * clamp(level, 0, 1) * (0.4 + 0.6 * air), t, 0.1);
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
  separate() { this.burst(0.25, 900, 0.9, 'bandpass'); },
  explode() { this.burst(1.6, 260, 1.6); this.burst(0.5, 1200, 0.5); },
  click() { this.burst(0.06, 2400, 0.25, 'highpass'); },
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
