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
  // A death's blast (the damage model's: a craft or a vehicle going up, death.js): a burst of noise through a lowpass
  // closing to 80 Hz over a 45 -> 25 Hz thump, deeper and longer the bigger it is (size, m). Further off (dist, m) it is
  // quieter, duller and later (340 m/s); heard to 8 km when it is big (6 m or more), else 3 km. At most three start in a
  // second (the rest are dropped: a missile shredding a jet is one bang, not ten).
  blast(size, dist = 0) {
    const d = Math.max(0, +dist || 0), s = +size || 0;
    if (!this.ctx || !(s > 0) || d > (s >= 6 ? 8000 : 3000)) return;
    const now = performance.now(), B = this._blasts || (this._blasts = []);
    while (B.length && now - B[0] > 1000) B.shift();
    if (B.length >= 3) return;
    B.push(now);
    const k = clamp(s / 4, 0.4, 2), fall = 1 / (1 + d / 400), late = d / 340, dur = 1.2 + 0.8 * k;
    this.oneOff(dur + late);
    const ctx = this.ctx, t = ctx.currentTime + late;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(900 * (0.3 + 0.7 * fall), t); f.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.01 + 0.5 * k * fall, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
    const o = ctx.createOscillator(), og = ctx.createGain(); // (the thump)
    o.type = 'sine'; o.frequency.setValueAtTime(45, t); o.frequency.exponentialRampToValueAtTime(25, t + 0.5 + 0.3 * k);
    og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.02 + 0.6 * k * fall, t + 0.015); og.gain.exponentialRampToValueAtTime(0.001, t + 0.6 + 0.4 * k);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.9 + 0.4 * k);
  },
  // A fire's crackle (the damage model's: a part of the player's craft burning, death.js): a 40 ms click of band-passed
  // noise, each at its own pitch, quiet (0.04), `at` s from now (death.js spaces them 0.15-0.35 s apart).
  crackle(at = 0) {
    if (!this.ctx) return;
    const a = Math.max(0, +at || 0), dur = 0.04;
    this.oneOff(dur + a);
    const ctx = this.ctx, t = ctx.currentTime + a;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200 + 2000 * Math.random(); f.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
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
  // (the big update's drones) A hostile drone's buzz: one band-passed noise loop, made on first use, its gain the level
  // asked (0 stops it: drone.js asks 0.05·(1 − d/250) while one is within 250 m); and a detector's chirp on a new contact
  // (900 then 1200 Hz, 80 ms each)
  buzz(level) {
    if (!this.ctx) return;
    const k = clamp(+level || 0, 0, 0.2);
    if (!this.buzzG) {
      if (!(k > 0)) return;
      const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 6;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start(0, Math.random() * 1.5);
      this.buzzG = g; this.buzzF = f;
    }
    this.glide('bz', this.buzzG.gain, k, 0.1, 1e-4);
    this.glide('bf', this.buzzF.frequency, 380 + 400 * (k / 0.05), 0.2, 2);
  },
  chirp() { this.tone(900, 0.08, 0.06); setTimeout(() => this.tone(1200, 0.08, 0.06), 80); },
  // an anti-drone laser burning near the camera: a thin high whine (one oscillator, made on first use; 0 stops it)
  laser(level) {
    if (!this.ctx) return;
    const k = clamp(+level || 0, 0, 0.1);
    if (!this.lasG) {
      if (!(k > 0)) return;
      const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = 2200; g.gain.value = 0;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 4;
      o.connect(f); f.connect(g); g.connect(this.master); o.start();
      this.lasG = g;
    }
    this.glide('ls', this.lasG.gain, k, 0.05, 1e-4);
  },
  // (the ships update, WP12) A ship's loops, made on first use, each glided to the level asked (ship.js sounds: the
  // player's ship, or one within 1.5 km of the view; null or 0: all of them to nothing): her diesels' throb (low noise
  // beaten by their firing pulse, quickening with their load: rpm 0..1), a gas turbine's roar and whine (rising with its
  // spool), an outboard's two-stroke buzz, the bow wave's hiss with her speed, flooding's gurgle (the bridge view), a
  // close-in gun's ripping buzz while it fires. size (0..1: a RIB's 330 kW to a destroyer's 80 MW) makes the engines
  // louder and lower. At full, a destroyer at flank (about -18 dB) is as present as a tank at full power (-17), a RIB a
  // little under it (-20), and the close-in gun beside the view as loud as either; with both her loops and the gun at full,
  // or every loop at once, the mix still peaks under 1 (test/browser/ship-flight.mjs measures them).
  // seaOn: any of them still playing (Flight.update keeps asking while so).
  seaOn: false,
  SEA: { diesel: 1.6, turbine: 1.5, whine: 0.11, petrol: 0.24, hiss: 0.25, gurgle: 1.2, ciws: 1.0, gun: 0.4, sum: 2.6 }, // (each voice's gain at full; sum: theirs together at most)
  sea(L) {
    if (!this.ctx) { this.seaOn = false; return; }
    const ctx = this.ctx, G = this._sea || (this._sea = {}), on = !!L, K = this.SEA;
    const sz = on ? clamp(+L.size || 0, 0, 1) : G.sz || 0, big = 0.55 + 0.45 * sz, low = 1.25 - 0.5 * sz;
    G.sz = sz;
    const lv = (k, m) => (on ? clamp(+L[k] || 0, 0, 1) * m : 0);
    const want = { diesel: lv('diesel', big), turbine: lv('turbine', big), petrol: lv('petrol', big), hiss: lv('hiss', 1), gurgle: lv('gurgle', 1), ciws: lv('ciws', 1) }, rpm = on ? clamp(+L.rpm || 0, 0, 1) : 0;
    // (their gains together held to 2.6, a little under a destroyer's at flank with her gun firing (2.75): that peaked at
    // 0.93, and a CODAG at flank, flooding, the gun going, all of them at once, would clip)
    let sum = 0;
    for (const k in want) sum += want[k] * K[k];
    if (sum > K.sum) for (const k in want) want[k] *= K.sum / sum;
    // (white noise for the hiss and the gun: the shared brown noise has little above a kilohertz)
    const white = () => { if (!G.white) { const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; G.white = b; } return G.white; };
    const out = (vol) => { const g = ctx.createGain(); g.gain.value = 0; const m = ctx.createGain(); m.gain.value = vol; g.connect(m); m.connect(this.master); return g; };
    const noise = (buf, type, f, q, to) => { const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; if (q) fl.Q.value = q; src.connect(fl); fl.connect(to); src.start(0, Math.random() * 1.5); return fl; };
    const osc = (type, f, to) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(to); o.start(); return o; };
    const lfo = (target, f, depth, type = 'sine') => { const d = ctx.createGain(); d.gain.value = depth; osc(type, f, d); d.connect(target); return d; };
    if (want.diesel > 0 && !G.diesel) { // (low noise through a pulse at the firing rate)
      const g = out(K.diesel), amp = ctx.createGain(); amp.gain.value = 0.55; amp.connect(g);
      const f = noise(this.noise, 'lowpass', 160, 0.9, amp), d = ctx.createGain(); d.gain.value = 0.45; const o = osc('sine', 4, d); d.connect(amp.gain);
      G.diesel = { g, f, o };
    }
    if (want.turbine > 0 && !G.turbine) { // (a roar of air through it, and the compressor's whine over it)
      const g = out(K.turbine), f = noise(this.noise, 'bandpass', 500, 0.7, g), wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1400; wf.Q.value = 6;
      const wg = ctx.createGain(); wg.gain.value = K.whine / K.turbine; wf.connect(wg); wg.connect(g);
      G.turbine = { g, f, o: osc('sawtooth', 700, wf), wf };
    }
    if (want.petrol > 0 && !G.petrol) { // (two outboards' two-stroke buzz, a hair apart, through a lowpass that opens with the throttle)
      const g = out(K.petrol), f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 2; f.connect(g);
      G.petrol = { g, f, o: osc('sawtooth', 60, f), o2: osc('sawtooth', 60.7, f) };
    }
    if (want.hiss > 0 && !G.hiss) { const g = out(K.hiss); G.hiss = { g, f: noise(white(), 'bandpass', 1800, 0.45, g) }; }
    if (want.gurgle > 0 && !G.gurgle) { const g = out(K.gurgle), f = noise(this.noise, 'bandpass', 420, 4, g); lfo(f.frequency, 3.3, 160, 'triangle'); G.gurgle = { g, f }; }
    if (want.ciws > 0 && !G.ciws) { // (a gun firing 75 rounds a second: noise and a growl, chopped by a square wave at that rate)
      const g = out(K.ciws), amp = ctx.createGain(); amp.gain.value = 0.5; amp.connect(g); lfo(amp.gain, 75, 0.5, 'square');
      noise(white(), 'bandpass', 1000, 0.7, amp);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; const lg = ctx.createGain(); lg.gain.value = K.gun / K.ciws; lp.connect(lg); lg.connect(amp); osc('sawtooth', 75, lp);
      G.ciws = { g };
    }
    for (const k in want) if (G[k]) this.glide('sea' + k, G[k].g.gain, want[k], k === 'ciws' ? 0.03 : 0.25, 1e-4);
    if (G.diesel) { this.glide('seadf', G.diesel.f.frequency, (110 + 230 * rpm) * low, 0.4, 1); this.glide('seadl', G.diesel.o.frequency, (2.5 + 8 * rpm) * low, 0.4, 0.05); }
    if (G.turbine) { this.glide('seatr', G.turbine.f.frequency, (380 + 520 * rpm) * low, 0.6, 2); this.glide('seatf', G.turbine.o.frequency, (500 + 1500 * rpm) * low, 0.6, 2); this.glide('seatb', G.turbine.wf.frequency, (1000 + 3000 * rpm) * low, 0.6, 2); }
    if (G.petrol) { const f = (45 + 125 * rpm) * low; this.glide('seapo', G.petrol.o.frequency, f, 0.3, 0.5); this.glide('seapp', G.petrol.o2.frequency, f * 1.012, 0.3, 0.5); this.glide('seapf', G.petrol.f.frequency, 700 + 1800 * rpm, 0.3, 5); }
    this.seaOn = want.diesel + want.turbine + want.petrol + want.hiss + want.gurgle + want.ciws > 0;
  },
  // the engine-order telegraph's bell: n strokes of a small brass bell (three partials, a quick decay), 0.2 s apart
  bell(n = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.oneOff(0.2 * n + 0.9);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + 0.2 * i;
      for (const [f, v, d] of [[1180, 0.07, 0.8], [2710, 0.035, 0.45], [4020, 0.02, 0.25]]) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + d + 0.05);
      }
    }
  },
  // a torpedo out of its tube (a puff of air and a splash; dropped from a plane: the splash), dist m from the camera:
  // quieter, duller and later (340 m/s) further off
  torpedo(dist = 0, drop = false) {
    const d = Math.max(0, +dist || 0);
    if (!this.ctx || d > 2000) return;
    const fall = 1 / (1 + d / 200), late = d / 340, ctx = this.ctx, t = ctx.currentTime + late;
    this.oneOff(1 + late);
    const hit = (dt, dur, f, type, vol) => { const src = ctx.createBufferSource(); src.buffer = this.noise; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + dt); g.gain.linearRampToValueAtTime(vol * fall, t + dt + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dt + dur); src.connect(fl); fl.connect(g); g.connect(this.master); src.start(t + dt, Math.random()); src.stop(t + dt + dur + 0.05); };
    if (!drop) hit(0, 0.3, 380, 'lowpass', 0.7);
    hit(drop ? 0 : 0.35, 0.6, 1500, 'bandpass', 0.35);
  },
  // a hull holed: a deep clang of steel (inharmonic low partials and a crack of noise), k its size (0.2..2), dist m from the
  // camera (quieter and later further off; ship.js asks within 1.5 km, nothing past 3 km whoever asks); at most three a second
  clang(k = 1, dist = 0) {
    const d = Math.max(0, +dist || 0);
    if (!this.ctx || d > 3000) return;
    const now = performance.now(), B = this._clangs || (this._clangs = []);
    while (B.length && now - B[0] > 1000) B.shift();
    if (B.length >= 3) return;
    B.push(now);
    const s = clamp(+k || 1, 0.2, 2), fall = 1 / (1 + d / 250), late = d / 340, ctx = this.ctx, t = ctx.currentTime + late;
    this.oneOff(1.4 + late);
    for (const [f, v, dur] of [[72, 0.5, 1.1], [117, 0.3, 0.8], [191, 0.18, 0.55], [305, 0.08, 0.35]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.value = f * (1.15 - 0.15 * (s / 2));
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * fall * (0.5 + 0.5 * s), t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
    const src = ctx.createBufferSource(); src.buffer = this.noise; const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 900; fl.Q.value = 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.3 * fall, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(fl); fl.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + 0.15);
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
