'use strict';
// Flight scene: simulation loop, camera, map view, HUD and controls.

const WARPS = [1, 2, 4, 8, 10, 50, 100, 500, 1000, 5000, 10000, 50000];
const PHYS_WARP_MAX = 3; // index of the last physics warp (8x)
const PHYS_DT = 1 / 120;

const ACHIEVEMENTS = [
  { id: 'liftoff', name: 'Liftoff' },
  { id: 'space', name: 'Reached space' },
  { id: 'orbit', name: 'Orbit achieved' },
  { id: 'moonSoi', name: 'Lunar encounter' },
  { id: 'moonOrbit', name: 'Lunar orbit' },
  { id: 'moonLanding', name: 'Moon landing' },
  { id: 'home', name: 'Home from the Moon' },
];

const Flight = {
  running: false,

  init(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pointers = new Map();
    this.touchRot = 0;
    this.scale = 12;
    this.mapScale = 0.0005;
    this.mapOffset = { x: 0, y: 0 };
    this.bindDom();
    this.stars = [];
    const rnd = mulberry32(7);
    for (let i = 0; i < 380; i++) this.stars.push({ x: rnd(), y: rnd(), m: rnd() * rnd(), t: rnd() * TAU });
  },

  // ------------------------------------------------------------------ lifecycle
  start(design) {
    this.design = design;
    const parts = design.parts.map((q) => makePart(q.type, q.x, q.y, { flip: !!q.flip }));
    const adjAll = buildAdjacency(parts);
    const ctrl = findControlPart(parts);
    const keep = componentOf(ctrl.id, adjAll);
    const ps = parts.filter((p) => keep.has(p.id));
    const adj = new Map();
    for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
    this.stages = computeStages(ps, adj, ctrl.id);
    this.stageIdx = 0;
    const v = new Vessel(ps, adj, EARTH);
    v.rebuildGroups();
    const surf = EARTH.radius + terrainHeight(EARTH, EARTH.padAngle);
    v.x = 0; v.y = surf + (v.com.y - v.bounds.minY) + 0.02; v.rot = 0;
    v.landed = true;
    this.vessels = [v];
    this.active = v;
    this.time = 0;
    this.warpIdx = 0;
    this.mapMode = false;
    this.particles = [];
    this.flags = {};
    this.stats = { maxAlt: 0, maxSpeed: 0 };
    this.destroyed = false;
    this.ended = false;
    this.flash = null;
    this.prediction = null;
    this.predTimer = 0; this.hudTimer = 0; this.dvTimer = 0;
    this.dvLeft = 0;
    const h = v.bounds.maxY - v.bounds.minY;
    this.scale = clamp((innerHeight * 0.42) / h, 2, 40);
    this.viewRot = 0;
    this.camAbs = this.absPos(v);
    this.mapOffset = { x: 0, y: 0 };
    this.running = true;
    this.paused = false;
    this.updateDvEstimate();
    this.updateHUD(true);
    $('#map-legend').hidden = true;
  },

  stop() {
    this.running = false;
    Sound.engine(0, 0);
  },

  revert() { this.start(this.design); },

  // ------------------------------------------------------------------ helpers
  absPos(v) {
    const b = bodyPos(v.body, this.time);
    return { x: b.x + v.x, y: b.y + v.y };
  },
  toast(t, k) { UI.toast(t, k); },

  canRails() {
    const v = this.active;
    if (!v || !v.parts.length) return false;
    if (v.landed && v.speed() < 0.2) return true;
    if (v.thrust > 0) return 'engines';
    if (v.altitude() < v.body.warpAlt) return v.body.atmoHeight ? 'atmosphere' : 'surface';
    return true;
  },

  setWarp(i) {
    i = clamp(i, 0, WARPS.length - 1);
    if (i > PHYS_WARP_MAX) {
      const ok = this.canRails();
      if (ok !== true) {
        const why = ok === 'engines' ? 'Cut the engines to time warp faster' : ok === 'atmosphere' ? 'Can’t time warp faster inside the atmosphere' : 'Too close to the surface for faster time warp';
        this.toast(why);
        i = Math.min(i, PHYS_WARP_MAX);
        if (this.warpIdx >= PHYS_WARP_MAX && i === PHYS_WARP_MAX && this.warpIdx === i) return;
      }
    }
    if (i > PHYS_WARP_MAX && this.warpIdx <= PHYS_WARP_MAX) for (const v of this.vessels) v.w = 0;
    this.warpIdx = i;
    this.updateHUD(true);
  },

  // ------------------------------------------------------------------ actions
  stage() {
    if (this.destroyed) return;
    if (this.warpIdx > PHYS_WARP_MAX) this.setWarp(0);
    const v = this.active;
    if (this.stageIdx >= this.stages.length) { this.toast('No stages left. Tap parts to use them.'); return; }
    const ids = this.stages[this.stageIdx];
    const parts = ids.map((id) => v.byId.get(id)).filter(Boolean);
    let used = false, chutesOnly = parts.length > 0;
    for (const p of parts) if (p.def.separator) { this.fireSeparator(v, p); used = true; }
    for (const p of parts) {
      if (p.def.thrust) {
        chutesOnly = false;
        if (v.hasFuelFor(p)) { p.active = true; used = true; } else this.toast(`${p.def.name}: no fuel`);
      } else if (p.def.chute) {
        if (this.deployChute(v, p)) used = true;
      } else chutesOnly = false;
    }
    if (chutesOnly && !used) return; // keep the parachute stage for later
    this.stageIdx++;
    if (used) Sound.click();
    this.updateDvEstimate();
    this.updateHUD(true);
  },

  fireSeparator(v, sep) {
    if (sep.fired) return;
    sep.fired = true;
    const ctrl = v.control;
    if (ctrl) cutSeparator(sep.id, v.adj, ctrl.id);
    else for (const n of [...v.adj.get(sep.id)]) { v.adj.get(sep.id).delete(n); v.adj.get(n).delete(sep.id); }
    const mBefore = v.mass;
    const pieces = v.splitComponents();
    for (const piece of pieces) {
      let dx = piece.x - v.x, dy = piece.y - v.y;
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const mu = (piece.mass * v.mass) / (piece.mass + v.mass);
      const J = 2.2 * mu;
      piece.vx += dx * J / piece.mass; piece.vy += dy * J / piece.mass;
      v.vx -= dx * J / v.mass; v.vy -= dy * J / v.mass;
      piece.w += (Math.random() - 0.5) * 0.15;
      this.vessels.push(piece);
    }
    const wp = v.toWorld(sep.x, sep.y);
    this.puff(v.body, wp.x, wp.y, v.vx, v.vy, 10, '#e8edf2');
    Sound.separate();
    if (pieces.length) this.toast(`Separated ${fmt.mass(mBefore - v.mass)}`);
  },

  deployChute(v, p) {
    if (p.deployed > 0 || p.used) return false;
    const b = v.body;
    if (!b.atmoHeight) { this.toast('No air here. Parachutes need an atmosphere.'); return false; }
    const alt = v.altitude();
    if (alt > b.atmoHeight * 0.85) { this.toast('Too high: wait until you are in the thicker air'); return false; }
    if (v.speed() > 250) { this.toast(`Too fast to deploy (${Math.round(v.speed())} m/s, limit 250)`); return false; }
    p.deployed = 0.01;
    Sound.separate();
    this.toast('Parachute deployed');
    return true;
  },

  breakParts(v, parts) {
    for (const p of parts) {
      const wp = v.toWorld(p.x, p.y);
      this.explosion(v.body, wp.x, wp.y, v.vx * 0.2, v.vy * 0.2, Math.max(p.def.w, p.def.h));
      v.parts = v.parts.filter((q) => q !== p);
      for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id);
      v.adj.delete(p.id);
    }
    Sound.explode();
    if (!v.parts.length) { v.dead = true; if (v === this.active) this.onDestroyed(); return; }
    const hadControl = !!v.control;
    const pieces = v.splitComponents();
    for (const piece of pieces) { piece.isDebris = true; this.vessels.push(piece); }
    v.rebuildGroups();
    if (v === this.active && !v.control) this.onDestroyed();
    else if (!hadControl) v.isDebris = true;
  },

  onDestroyed() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.warpIdx = 0;
    setTimeout(() => {
      if (!this.running || this.ended) return;
      this.ended = true;
      UI.modal({
        kicker: 'Mission ended', title: 'Vessel destroyed',
        body: this.summaryHTML(),
        actions: [
          { label: 'Back to builder', onClick: () => App.toBuild() },
          { label: 'Revert to launch', primary: true, onClick: () => this.revert() },
        ],
      });
    }, 1600);
  },

  recover() {
    const v = this.active;
    if (!v.landed || v.body !== EARTH) return;
    this.ended = true;
    this.paused = true;
    UI.modal({
      kicker: 'Recovered', title: this.flags.home ? 'Welcome home' : 'Mission complete',
      body: this.summaryHTML(),
      actions: [
        { label: 'Fly again', onClick: () => this.revert() },
        { label: 'Back to builder', primary: true, onClick: () => App.toBuild() },
      ],
    });
  },

  summaryHTML() {
    const got = ACHIEVEMENTS.filter((a) => this.flags[a.id]);
    const list = got.length ? got.map((a) => `<li>${a.name}</li>`).join('') : '<li class="muted">None this flight</li>';
    return `<dl class="summary">
      <div><dt>Flight time</dt><dd>${fmt.clock(this.time)}</dd></div>
      <div><dt>Highest point</dt><dd>${fmt.dist(this.stats.maxAlt)}</dd></div>
      <div><dt>Top speed</dt><dd>${fmt.speed(this.stats.maxSpeed)}</dd></div>
    </dl><h3 class="summary-h">Milestones</h3><ul class="milestones">${list}</ul>`;
  },

  openMenu() {
    if (this.ended) return;
    this.paused = true;
    const canRecover = this.active.landed && this.active.body === EARTH && this.active.speed() < 1;
    const acts = [
      { label: 'Back to builder', onClick: () => App.toBuild() },
      { label: 'Revert to launch', onClick: () => this.revert() },
    ];
    if (canRecover) acts.push({ label: 'Recover', onClick: () => this.recover() });
    acts.push({ label: 'Resume', primary: true, onClick: () => {} });
    UI.modal({
      kicker: `T+ ${fmt.clock(this.time)}`, title: 'Paused',
      body: Flight.controlsHelp(),
      actions: acts,
      onClose: () => { if (!this.ended) this.paused = false; },
    });
  },

  controlsHelp() {
    return `<div class="help-grid">
      <div><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd><span>Rotate</span></div>
      <div><kbd>W</kbd><kbd>S</kbd> / <kbd>Shift</kbd><kbd>Ctrl</kbd><span>Throttle up / down</span></div>
      <div><kbd>Z</kbd><kbd>X</kbd><span>Full throttle / cut</span></div>
      <div><kbd>Space</kbd><span>Activate next stage</span></div>
      <div><kbd>M</kbd><span>Map view</span></div>
      <div><kbd>,</kbd><kbd>.</kbd><span>Time warp down / up</span></div>
      <div><kbd>Wheel</kbd><span>Zoom (pinch on touch)</span></div>
      <div><span class="tap">Tap a part</span><span>Toggle an engine, fire a separator, open a parachute</span></div>
    </div>`;
  },

  // ------------------------------------------------------------------ particles
  puff(body, x, y, vx, vy, n, color) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = 2 + Math.random() * 6;
      this.particles.push({ b: body, x, y, vx: vx + Math.cos(a) * s, vy: vy + Math.sin(a) * s, life: 0, max: 0.8 + Math.random() * 0.6, size: 0.6, grow: 2.5, color, alpha: 0.6 });
    }
  },
  explosion(body, x, y, vx, vy, size) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * TAU, s = 4 + Math.random() * 22;
      this.particles.push({ b: body, x, y, vx: vx + Math.cos(a) * s, vy: vy + Math.sin(a) * s, life: 0, max: 0.6 + Math.random() * 1.4, size: size * 0.5, grow: size * 1.5, color: i % 3 ? '#ff9a3c' : '#ffe08a', fire: true, alpha: 1 });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, s = 2 + Math.random() * 8;
      this.particles.push({ b: body, x, y, vx: vx + Math.cos(a) * s, vy: vy + Math.sin(a) * s, life: 0, max: 2 + Math.random() * 2, size: size * 0.6, grow: size * 2.5, color: '#4a4f57', alpha: 0.7 });
    }
  },
  emitExhaust(dt) {
    for (const v of this.vessels) {
      const rho = airDensity(v.body, v.altitude());
      if (rho < 0.01) continue;
      const fx = -Math.sin(v.rot), fy = Math.cos(v.rot);
      for (const g of v.groups) for (const e of g.engines) {
        if (!e.firing) continue;
        const rate = 26 * e.firing * e.def.w * Math.min(1, rho * 2);
        e._emit = (e._emit || 0) + rate * dt;
        while (e._emit >= 1) {
          e._emit -= 1;
          const wp = v.toWorld(e.x, e.y - e.def.h / 2 - e.def.w * 0.6);
          const sp = 25 + Math.random() * 25;
          const j = (Math.random() - 0.5) * 10;
          this.particles.push({
            b: v.body, x: wp.x, y: wp.y,
            vx: v.vx - fx * sp + j * fy, vy: v.vy - fy * sp - j * fx,
            life: 0, max: 2.2 + Math.random() * 2.2, size: e.def.w * 0.7, grow: e.def.w * 3.2,
            color: '#d9dde2', alpha: 0.32,
          });
        }
      }
    }
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
  },
  updateParticles(dt) {
    const keep = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.exp(-(p.fire ? 2.5 : 1.6) * dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
      keep.push(p);
    }
    this.particles = keep;
  },

  // ------------------------------------------------------------------ simulation
  update(rdt) {
    if (!this.running) return;
    const dt = Math.min(rdt, 0.05);
    this.readControls(dt);
    if (!this.paused) {
      let warp = WARPS[this.warpIdx];
      if (this.warpIdx > PHYS_WARP_MAX && this.canRails() !== true) {
        this.warpIdx = 0; warp = 1;
        this.toast('Time warp stopped');
      }
      if (this.warpIdx <= PHYS_WARP_MAX) {
        const total = dt * warp;
        const n = Math.max(1, Math.ceil(total / (warp >= 4 ? PHYS_DT * 2 : PHYS_DT) - 1e-6));
        const h = total / n;
        for (let i = 0; i < n; i++) this.physicsTick(h);
        this.emitExhaust(dt * warp);
        this.updateParticles(dt * warp);
      } else {
        this.railsTick(dt * warp);
        this.particles.length = 0;
      }
      this.cleanup();
      this.checkMilestones();
    }
    const v = this.active;
    // engine sound
    const thrustFrac = v && v.parts.length && !this.paused ? (v.thrust || 0) / Math.max(1, v.parts.reduce((s, p) => s + (p.def.thrust || 0) * 1000, 0)) : 0;
    Sound.engine(thrustFrac, v ? clamp(airDensity(v.body, v.altitude()) / 0.6, 0, 1) : 0);

    this.predTimer -= rdt;
    if (this.predTimer <= 0) { this.predTimer = this.mapMode ? 0.1 : 0.25; this.updatePrediction(); }
    this.dvTimer -= rdt;
    if (this.dvTimer <= 0) { this.dvTimer = 0.5; this.updateDvEstimate(); }
    this.hudTimer -= rdt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.08; this.updateHUD(); }
  },

  readControls(dt) {
    const k = this.keys;
    let rot = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    rot += this.touchRot;
    const v = this.active;
    if (!v) return;
    v.input = clamp(rot, -1, 1);
    let dT = 0;
    if (k.has('KeyW') || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('ArrowUp')) dT += 1;
    if (k.has('KeyS') || k.has('ControlLeft') || k.has('ControlRight') || k.has('ArrowDown')) dT -= 1;
    if (dT) this.setThrottle(v.throttle + dT * dt * 0.9);
  },

  setThrottle(t) {
    if (!this.active) return;
    this.active.throttle = clamp(t, 0, 1);
    this.updateThrottleDom();
  },

  physicsTick(h) {
    const list = this.vessels.slice();
    for (const v of list) {
      if (v.dead) continue;
      if (v !== this.active && v.landed && v.restTime > 2 && !v.thrust) continue; // sleeping debris
      v.physicsStep(h, this);
      this.checkSOI(v);
    }
    this.time += h;
  },

  checkSOI(v) {
    if (v.body === EARTH) {
      const m = bodyPos(MOON, this.time);
      const dx = v.x - m.x, dy = v.y - m.y;
      if (dx * dx + dy * dy < MOON.soi * MOON.soi) {
        const mv = bodyVel(MOON, this.time);
        v.x = dx; v.y = dy; v.vx -= mv.x; v.vy -= mv.y; v.body = MOON;
        if (v === this.active) { this.toast('Entered the Moon’s sphere of influence'); this.prediction = null; }
        return true;
      }
    } else if (v.body.parent && Math.hypot(v.x, v.y) > v.body.soi) {
      const b = v.body, bp = bodyPos(b, this.time), bv = bodyVel(b, this.time);
      v.x += bp.x; v.y += bp.y; v.vx += bv.x; v.vy += bv.y; v.body = b.parent;
      if (v === this.active) { this.toast(`Escaped the ${b.name}’s gravity`); this.prediction = null; }
      return true;
    }
    return false;
  },

  // On-rails propagation with event detection (atmosphere/surface, SOI changes).
  railsTick(T) {
    const a = this.active;
    const used = this.railsAdvance(a, T, true);
    for (const v of this.vessels) if (v !== a && !v.dead) this.railsAdvance(v, used, false);
    this.time += used;
  },

  railsAdvance(v, T, isActive) {
    if (v.landed && v.speed() < 0.2) return T;
    v.w = 0;
    const t0 = this.time;
    let done = 0;
    for (let guard = 0; guard < 400 && done < T - 1e-9; guard++) {
      const body = v.body;
      const start = { x: v.x, y: v.y, vx: v.vx, vy: v.vy };
      const o = elementsFromState(start.x, start.y, start.vx, start.vy, body.mu);
      const stateFn = (dtt) => {
        if (!o.degenerate) return stateAt(o, dtt);
        const s = { ...start };
        const n = Math.max(1, Math.ceil(dtt / 0.5));
        for (let i = 0; i < n; i++) gravityStep(s, body.mu, dtt / n);
        return s;
      };
      const minR = body.radius + body.warpAlt;
      const event = (s, tt) => {
        const r = Math.hypot(s.x, s.y);
        if (r < minR) return 'low';
        if (body.parent && r > body.soi) return 'out';
        if (!body.parent) {
          const m = bodyPos(MOON, t0 + done + tt);
          if (Math.hypot(s.x - m.x, s.y - m.y) < MOON.soi) return 'in';
        }
        return null;
      };
      // march in chunks from this state
      let elapsed = 0, hit = null;
      const remaining = T - done;
      while (elapsed < remaining - 1e-9) {
        const r = Math.hypot(v.x, v.y);
        const tdyn = Math.sqrt((r * r * r) / body.mu);
        const chunk = Math.min(remaining - elapsed, 120, Math.max(1, tdyn * 0.04));
        const s = stateFn(elapsed + chunk);
        const ev = event(s, elapsed + chunk);
        if (ev) {
          let lo = elapsed, hi = elapsed + chunk;
          for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            if (event(stateFn(mid), mid)) hi = mid; else lo = mid;
          }
          const sh = stateFn(hi);
          v.x = sh.x; v.y = sh.y; v.vx = sh.vx; v.vy = sh.vy;
          elapsed = hi; hit = ev;
          break;
        }
        v.x = s.x; v.y = s.y; v.vx = s.vx; v.vy = s.vy;
        elapsed += chunk;
      }
      done += elapsed;
      if (!hit) break;
      if (hit === 'low') {
        if (isActive) {
          this.warpIdx = 0;
          this.toast(body.atmoHeight ? 'Entering the atmosphere' : 'Approaching the surface');
          // nudge just inside the boundary so physics takes over cleanly
          return done;
        }
        return done; // debris just pauses here; physics resumes later
      }
      // SOI change: evaluate in the new frame at the event time
      const saveTime = this.time;
      this.time = t0 + done;
      this.checkSOI(v);
      this.time = saveTime;
    }
    return done;
  },

  cleanup() {
    const a = this.active;
    const ap = this.absPos(a);
    this.vessels = this.vessels.filter((v) => {
      if (v.dead || !v.parts.length) return false;
      if (v === a) return true;
      const p = this.absPos(v);
      return Math.hypot(p.x - ap.x, p.y - ap.y) < 120000;
    });
  },

  checkMilestones() {
    const v = this.active;
    if (!v || !v.parts.length || this.destroyed) return;
    const alt = v.altitude(), sp = v.speed();
    if (v.body === EARTH) this.stats.maxAlt = Math.max(this.stats.maxAlt, alt);
    else this.stats.maxAlt = Math.max(this.stats.maxAlt, Math.hypot(this.absPos(v).x, this.absPos(v).y) - EARTH.radius);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, sp);
    const o = this.prediction && this.prediction[0] && this.prediction[0].o;
    const award = (id) => {
      if (this.flags[id]) return;
      this.flags[id] = true;
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      this.toast(a.name, 'achievement');
      Sound.chime();
      const all = store.get('rss.achievements', {});
      all[id] = true; store.set('rss.achievements', all);
    };
    if (v.body === EARTH && alt > 60 && this.time > 1) award('liftoff');
    if (v.body === EARTH && alt > EARTH.atmoHeight) award('space');
    if (o && v.body === EARTH && !o.degenerate && o.e < 1 && o.rp > EARTH.radius + EARTH.atmoHeight) award('orbit');
    if (v.body === MOON) award('moonSoi');
    if (o && v.body === MOON && !o.degenerate && o.e < 1 && o.rp > MOON.radius + MOON.terrainMax && o.ra < MOON.soi) award('moonOrbit');
    const settled = v.landed && v.contactTime > 1.5 && sp < 0.6;
    if (v.body === MOON && settled) award('moonLanding');
    if (v.body === EARTH && this.flags.moonSoi && settled) award('home');
    if (settled) for (const p of v.parts) if (p.def.chute && p.deployed > 0 && !p.used) p.used = true; // canopy collapses
  },

  updatePrediction() {
    const v = this.active;
    if (!v || !v.parts.length) { this.prediction = null; return; }
    this.prediction = predictTrajectory(v.body, { x: v.x, y: v.y, vx: v.vx, vy: v.vy }, this.time, 3);
  },

  updateDvEstimate() {
    const v = this.active;
    if (!v || !v.parts.length || !v.control) { this.dvLeft = 0; return; }
    // remaining stages + currently burning engines
    const remaining = [v.parts.filter((p) => p.def.thrust && p.active).map((p) => p.id), ...this.stages.slice(this.stageIdx)];
    const est = estimateDeltaV(v.parts, v.adj, v.control.id, remaining, false);
    this.dvLeft = est.total;
  },

  // ------------------------------------------------------------------ input
  bindDom() {
    const c = this.canvas;
    addEventListener('keydown', (e) => {
      if (App.scene !== 'flight' || UI.modalOpen) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) { this.keys.add(e.code); return; }
      this.keys.add(e.code);
      switch (e.code) {
        case 'Space': this.stage(); break;
        case 'KeyM': this.toggleMap(); break;
        case 'Comma': this.setWarp(this.warpIdx - 1); break;
        case 'Period': this.setWarp(this.warpIdx + 1); break;
        case 'KeyZ': this.setThrottle(1); break;
        case 'KeyX': this.setThrottle(0); break;
        case 'Escape': case 'KeyP': this.openMenu(); break;
        case 'KeyR': if (this.active.landed && this.active.body === EARTH) this.recover(); break;
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touchRot = 0; });

    c.addEventListener('wheel', (e) => {
      if (App.scene !== 'flight') return;
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      this.zoomBy(f, e.clientX, e.clientY);
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      if (App.scene !== 'flight') return;
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (this.pointers.size === 2) this.pinch = this.pinchInfo();
    });
    c.addEventListener('pointermove', (e) => {
      if (App.scene !== 'flight') return;
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 2 && this.pinch) {
        const now = this.pinchInfo();
        this.zoomBy(now.d / this.pinch.d, now.cx, now.cy);
        if (this.mapMode) this.panMap(now.cx - this.pinch.cx, now.cy - this.pinch.cy);
        this.pinch = now;
      } else if (this.pointers.size === 1 && this.mapMode) {
        this.panMap(dx, dy);
      }
    });
    const up = (e) => {
      if (App.scene !== 'flight') return;
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (!p || e.type === 'pointercancel') return;
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (moved < 10 && performance.now() - p.t < 400 && !this.mapMode && this.pointers.size === 0) this.tapAt(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

    // HUD controls
    const hold = (btn, val) => {
      const on = (e) => { e.preventDefault(); btn.setPointerCapture && btn.setPointerCapture(e.pointerId); this.touchRot = val; btn.classList.add('held'); };
      const off = () => { if (this.touchRot === val) this.touchRot = 0; btn.classList.remove('held'); };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('lostpointercapture', off);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold($('#rot-left'), -1);
    hold($('#rot-right'), 1);
    $('#btn-stage').addEventListener('click', () => this.stage());
    $('#btn-map').addEventListener('click', () => this.toggleMap());
    $('#btn-menu').addEventListener('click', () => this.openMenu());
    $('#btn-recover').addEventListener('click', () => this.recover());
    $('#warp-up').addEventListener('click', () => this.setWarp(this.warpIdx + 1));
    $('#warp-down').addEventListener('click', () => this.setWarp(this.warpIdx - 1));
    $('#btn-tmax').addEventListener('click', () => this.setThrottle(1));
    $('#btn-tcut').addEventListener('click', () => this.setThrottle(0));
    $('#btn-center').addEventListener('click', () => { this.mapOffset = { x: 0, y: 0 }; this.fitMap(); });
    const track = $('#throttle-track');
    const setFromY = (e) => {
      const r = track.getBoundingClientRect();
      this.setThrottle(1 - (e.clientY - r.top) / r.height);
    };
    track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); setFromY(e); this.dragThrottle = true; });
    track.addEventListener('pointermove', (e) => { if (this.dragThrottle) setFromY(e); });
    track.addEventListener('pointerup', () => { this.dragThrottle = false; });
    track.addEventListener('pointercancel', () => { this.dragThrottle = false; });
  },

  pinchInfo() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  },

  zoomBy(f, cx, cy) {
    if (this.mapMode) {
      const W = innerWidth, H = innerHeight;
      // keep the point under the cursor fixed
      const before = this.mapScale;
      this.mapScale = clamp(this.mapScale * f, 1e-6, 0.5);
      const k = 1 / before - 1 / this.mapScale;
      this.mapOffset.x += (cx - W / 2) * k;
      this.mapOffset.y -= (cy - H / 2) * k;
    } else {
      this.scale = clamp(this.scale * f, 0.0002, 80);
    }
  },
  panMap(dx, dy) {
    this.mapOffset.x -= dx / this.mapScale;
    this.mapOffset.y += dy / this.mapScale;
  },

  toggleMap() {
    this.mapMode = !this.mapMode;
    if (this.mapMode) { this.mapOffset = { x: 0, y: 0 }; this.fitMap(); this.updatePrediction(); }
    $('#btn-map').classList.toggle('on', this.mapMode);
    $('#map-legend').hidden = !this.mapMode;
    $('#btn-center').hidden = !this.mapMode;
  },

  fitMap() {
    const v = this.active, b = v.body;
    const o = this.prediction && this.prediction[0] && this.prediction[0].o;
    let r = b.radius * 2.6;
    if (o && !o.degenerate && o.e < 1) r = Math.max(r, o.ra * 1.15);
    else if (o && o.e >= 1) r = Math.max(r, b.soi ? b.soi * 1.2 : MOON.orbitRadius * 1.1);
    r = Math.min(r, MOON.orbitRadius * 1.35);
    this.mapScale = (Math.min(innerWidth, innerHeight) * 0.46) / r;
    // centre on the parent body
    const bp = bodyPos(b, this.time), vp = this.absPos(v);
    this.mapOffset = { x: bp.x - vp.x, y: bp.y - vp.y };
  },

  tapAt(cx, cy) {
    const v = this.active;
    if (!v || !v.parts.length || this.destroyed) return;
    const W = innerWidth, H = innerHeight;
    const dx = (cx - W / 2) / this.scale, dy = -(cy - H / 2) / this.scale;
    const c = Math.cos(-this.viewRot), s = Math.sin(-this.viewRot);
    const wx = c * dx - s * dy, wy = s * dx + c * dy;
    const bp = bodyPos(v.body, this.time);
    const lp = v.toLocal(this.camAbs.x + wx - bp.x, this.camAbs.y + wy - bp.y);
    const p = v.hitTest(lp.x, lp.y);
    if (!p) return;
    if (v.activatePart(p, this)) {
      this.flash = { id: p.id, t: performance.now() };
      Sound.click();
      this.updateDvEstimate();
      this.updateHUD(true);
    }
  },

  // ------------------------------------------------------------------ HUD
  updateThrottleDom() {
    const t = this.active ? this.active.throttle : 0;
    $('#throttle-fill').style.height = `${t * 100}%`;
    $('#throttle-label').textContent = `${Math.round(t * 100)}%`;
  },

  updateHUD(force) {
    const v = this.active;
    if (!v || !v.parts.length) return;
    const b = v.body;
    const r = Math.hypot(v.x, v.y);
    const alt = r - b.radius;
    const ground = r - surfaceRadius(b, Math.atan2(v.y, v.x)) - (v.com.y - v.bounds.minY);
    const vs = (v.x * v.vx + v.y * v.vy) / r;
    const set = (id, txt) => { const e = document.getElementById(id); if (e.textContent !== txt) e.textContent = txt; };
    set('t-body', b.name + (v.landed ? ' · landed' : ''));
    set('t-alt', fmt.dist(alt));
    $('#row-ground').hidden = !(ground < 5000);
    set('t-ground', fmt.dist(Math.max(0, ground)));
    set('t-speed', fmt.speed(v.speed()));
    set('t-vs', (vs >= 0 ? '+' : '') + fmt.speed(vs));
    const o = this.prediction && this.prediction[0] && this.prediction[0].body === b ? this.prediction[0].o : null;
    let ap = '—', pe = '—';
    if (o && !o.degenerate) {
      ap = o.e < 1 ? (o.ra > (b.soi || Infinity) ? 'Escape' : fmt.dist(o.ra - b.radius)) : 'Escape';
      pe = fmt.dist(o.rp - b.radius);
    } else if (o) { ap = fmt.dist(o.ra - b.radius); pe = 'Suborbital'; }
    if (o && o.rp < b.radius) pe = 'Suborbital';
    set('t-ap', ap); set('t-pe', pe);
    set('t-dv', `${Math.round(this.dvLeft).toLocaleString('en-US')} m/s`);
    set('t-time', fmt.clock(this.time));
    // encounter / escape line
    let enc = '';
    if (this.prediction && this.prediction.length > 1) {
      const p0 = this.prediction[0], p1 = this.prediction[1];
      if (p0.end === 'encounter') {
        const pe2 = p1.o.degenerate ? 0 : p1.o.rp - MOON.radius;
        enc = `Moon in ${fmt.duration(p0.tEnd - this.time)} · Pe ${pe2 < 0 ? 'impact' : fmt.dist(pe2)}`;
      } else if (p0.end === 'escape') enc = `Leaves ${b.name} SOI in ${fmt.duration(p0.tEnd - this.time)}`;
    }
    if (!enc && this.prediction && this.prediction[0].end === 'impact' && !v.landed && alt > 200) enc = `Impact in ${fmt.duration(this.prediction[0].tEnd - this.time)}`;
    $('#row-enc').hidden = !enc;
    set('t-enc', enc);

    const warp = WARPS[this.warpIdx];
    set('warp-label', `${warp.toLocaleString('en-US')}×`);
    $('#warp').classList.toggle('rails', this.warpIdx > PHYS_WARP_MAX);

    const sf = v.stageFuel();
    const frac = sf.cap ? sf.fuel / sf.cap : 0;
    $('#fuel-fill').style.width = `${frac * 100}%`;
    set('fuel-label', sf.cap ? `Stage fuel ${fmt.mass(sf.fuel)}` : 'No engines running');

    const next = this.stages[this.stageIdx];
    set('stage-num', this.stageIdx < this.stages.length ? `Stage ${this.stageIdx + 1}/${this.stages.length}` : 'Staging done');
    set('stage-next', next ? describeStage(next, v.byId) : 'Tap parts to use them');
    $('#btn-stage').disabled = !next || this.destroyed;
    $('#btn-recover').hidden = !(v.landed && b === EARTH && v.speed() < 1 && this.time > 3);
    if (force) this.updateThrottleDom();
  },

  // ------------------------------------------------------------------ rendering
  render(ctx, W, H, dpr) {
    if (!this.running) return;
    const v = this.active;
    if (v.parts.length) {
      const target = this.absPos(v);
      this.camAbs = target;
      const up = Math.atan2(v.y, v.x);
      const want = Math.PI / 2 - up;
      this.viewRot += wrapAngle(want - this.viewRot) * 0.25;
    }
    if (this.mapMode) return this.renderMap(ctx, W, H, dpr);
    const S = this.scale * dpr;
    const cos = Math.cos(this.viewRot), sin = Math.sin(this.viewRot);
    const base = [S * cos, -S * sin, -S * sin, -S * cos, (W * dpr) / 2, (H * dpr) / 2];
    const cam = this.camAbs;

    // sky
    const b = v.body;
    const alt = Math.hypot(cam.x - bodyPos(b, this.time).x, cam.y - bodyPos(b, this.time).y) - b.radius;
    let skyT = 1;
    if (b.atmoHeight) skyT = clamp(alt / b.atmoHeight, 0, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sky = b.atmoHeight ? mixColor(b.colors.sky, '#03050b', Math.pow(skyT, 0.55)) : '#03050b';
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W * dpr, H * dpr);
    const starA = b.atmoHeight ? smoothstep(0.35, 0.95, skyT) : 1;
    if (starA > 0) this.drawStars(ctx, W * dpr, H * dpr, starA, this.viewRot);

    for (const body of BODIES) this.drawBody(ctx, body, cam, S, base, W * dpr, H * dpr);
    if (b === EARTH || Math.hypot(cam.x, cam.y) < EARTH.radius + 50000) this.drawPad(ctx, cam, base, S);

    // particles
    ctx.setTransform(...base);
    for (const p of this.particles) {
      const bp = bodyPos(p.b, this.time);
      const x = bp.x + p.x - cam.x, y = bp.y + p.y - cam.y;
      const k = p.life / p.max;
      const size = p.size + p.grow * k;
      if (size * S < 0.4) continue;
      ctx.globalAlpha = p.alpha * (1 - k) * (p.fire ? 1 : 0.9);
      ctx.fillStyle = p.fire && k > 0.4 ? '#7a6a5a' : p.color;
      ctx.beginPath(); ctx.arc(x, y, size, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const ves of this.vessels) if (ves !== v) this.drawVessel(ctx, ves, cam, base, S);
    if (v.parts.length) this.drawVessel(ctx, v, cam, base, S);

    // small-scale marker so the craft stays visible when zoomed far out
    if (v.parts.length && (v.bounds.maxY - v.bounds.minY) * S < 6 * dpr) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc((W * dpr) / 2, (H * dpr) / 2, 7 * dpr, 0, TAU); ctx.stroke();
    }
  },

  drawStars(ctx, W, H, alpha, rot) {
    const off = (rot / TAU) * W * 0.6;
    for (const s of this.stars) {
      let x = (s.x * W + off) % W; if (x < 0) x += W;
      const y = s.y * H;
      ctx.globalAlpha = alpha * (0.25 + 0.75 * s.m);
      ctx.fillStyle = s.m > 0.7 ? '#ffe9c4' : '#dfe8ff';
      const sz = (0.6 + s.m * 1.6) * (W > 2000 ? 1.6 : 1);
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.globalAlpha = 1;
  },

  drawBody(ctx, b, cam, S, base, W, H) {
    const bc = bodyPos(b, this.time);
    const rx = bc.x - cam.x, ry = bc.y - cam.y;
    const d = Math.hypot(rx, ry);
    const diag = Math.hypot(W, H) / 2 / S; // metres from centre to screen corner
    const R = b.radius;
    ctx.setTransform(...base);
    // atmosphere halo when seen from afar
    if (b.atmoHeight && R * S < 4e4 && d - R - b.atmoHeight * 1.6 < diag) {
      const fade = clamp((d - R - b.atmoHeight * 0.5) / (b.atmoHeight * 3), 0, 1);
      if (fade > 0) {
        const g = ctx.createRadialGradient(rx, ry, R * 0.98, rx, ry, R + b.atmoHeight * 1.6);
        g.addColorStop(0, `rgba(${b.colors.halo},${0.6 * fade})`); g.addColorStop(1, `rgba(${b.colors.halo},0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(rx, ry, R + b.atmoHeight * 1.6, 0, TAU); ctx.fill();
      }
    }
    if (d - R - b.terrainMax > diag) return; // the surface doesn't reach the screen
    // terrain polygon around the part of the surface near the camera
    const camAng = Math.atan2(-ry, -rx);
    // conservative: any surface point (R ± terrainMax) within the screen circle
    const reach = diag * 1.15 + b.terrainMax * 2;
    const cosSpan = (d * d + R * R - reach * reach) / (2 * d * R);
    if (cosSpan > 1) return; // nothing of the surface reaches the screen
    const span = cosSpan < -1 ? Math.PI : Math.min(Math.PI, Math.acos(cosSpan) * 1.05 + 0.0005);
    const N = span >= Math.PI ? 720 : 360;
    const useTerrain = R * S > 300;
    ctx.setTransform(...base);
    ctx.beginPath();
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const a = camAng - span + (2 * span * i) / N;
      const rr = useTerrain ? R + terrainHeight(b, a) : R;
      const x = rx + rr * Math.cos(a), y = ry + rr * Math.sin(a);
      pts.push(x, y);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    if (span < Math.PI) {
      const deep = Math.max(R * 0.2, R - reach * 3);
      ctx.lineTo(rx + deep * Math.cos(camAng + span), ry + deep * Math.sin(camAng + span));
      ctx.lineTo(rx + deep * Math.cos(camAng - span), ry + deep * Math.sin(camAng - span));
    }
    ctx.closePath();
    ctx.fillStyle = b.colors.ground;
    ctx.fill();
    // lighter surface band
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) { if (i === 0) ctx.moveTo(pts[i], pts[i + 1]); else ctx.lineTo(pts[i], pts[i + 1]); }
    ctx.strokeStyle = b.colors.deep; ctx.lineWidth = Math.min(40, 14 / S); ctx.stroke();
    ctx.strokeStyle = b.colors.surface; ctx.lineWidth = Math.min(8, 4 / S); ctx.stroke();
  },

  drawPad(ctx, cam, base, S) {
    // the pad sits at angle pi/2, so its local axes match world axes
    const ox = -cam.x, oy = EARTH.radius - cam.y;
    ctx.setTransform(...base);
    ctx.translate(ox, oy);
    ctx.fillStyle = '#3b4048'; ctx.fillRect(-9, -2.4, 18, 2.4);
    ctx.fillStyle = '#585f69'; ctx.fillRect(-9, -0.5, 18, 0.5);
    ctx.fillStyle = '#ffc93c';
    for (let x = -8.5; x < 8.5; x += 2) ctx.fillRect(x, -0.45, 1, 0.12);
    // tower
    ctx.strokeStyle = '#8a929c'; ctx.lineWidth = 0.25;
    const tx = 6.5, th = 26;
    ctx.beginPath();
    ctx.moveTo(tx, 0); ctx.lineTo(tx, th); ctx.moveTo(tx + 2, 0); ctx.lineTo(tx + 2, th);
    for (let y = 0; y < th; y += 2) { ctx.moveTo(tx, y); ctx.lineTo(tx + 2, y + 2); ctx.moveTo(tx + 2, y); ctx.lineTo(tx, y + 2); }
    ctx.stroke();
    ctx.fillStyle = '#ff5d5d'; ctx.beginPath(); ctx.arc(tx + 1, th + 0.5, 0.45, 0, TAU); ctx.fill();
  },

  drawVessel(ctx, v, cam, base, S) {
    const bp = bodyPos(v.body, this.time);
    const x = bp.x + v.x - cam.x, y = bp.y + v.y - cam.y;
    const ext = Math.max(v.bounds.maxX - v.bounds.minX, v.bounds.maxY - v.bounds.minY) + 30;
    const W = this.canvas.width, H = this.canvas.height;
    if (Math.hypot(x, y) - ext > Math.hypot(W, H) / 2 / S) return; // off-screen
    ctx.setTransform(...base);
    ctx.translate(x, y);
    ctx.rotate(v.rot);
    ctx.translate(-v.com.x, -v.com.y);
    const lw = 1.1 / this.scale;
    const rho = airDensity(v.body, v.altitude());
    // flames
    for (const p of v.parts) if (p.def.thrust && p.firing > 0) this.drawFlame(ctx, p, p.firing, rho);
    // reentry glow
    if (v.heat > 4e7) {
      const k = clamp((v.heat - 4e7) / 1.6e8, 0, 1);
      const sp = v.speed() || 1;
      const c = Math.cos(-v.rot), s = Math.sin(-v.rot);
      const lvx = (c * v.vx - s * v.vy) / sp, lvy = (s * v.vx + c * v.vy) / sp;
      const cx = v.com.x + lvx * (v.width * 0.6), cy = v.com.y + lvy * ((v.bounds.maxY - v.bounds.minY) * 0.5);
      const rad = Math.max(v.width, 2) * (1.4 + k);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(255,236,190,${0.75 * k})`); g.addColorStop(0.4, `rgba(255,140,40,${0.5 * k})`); g.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    for (const p of v.parts) if (p.def.chute) drawCanopy(ctx, p, lw);
    for (const p of v.parts) if (p.def.leg) drawPart(ctx, p, lw);
    for (const p of v.parts) if (!p.def.leg) drawPart(ctx, p, lw);
    if (this.flash && v === this.active) {
      const age = (performance.now() - this.flash.t) / 500;
      const p = v.byId.get(this.flash.id);
      if (age < 1 && p) {
        const r = partRect(p);
        ctx.strokeStyle = `rgba(255,181,71,${1 - age})`; ctx.lineWidth = 3 / this.scale;
        ctx.strokeRect(r.l - 0.1, r.b - 0.1, r.r - r.l + 0.2, r.t - r.b + 0.2);
      } else this.flash = null;
    }
  },

  drawFlame(ctx, e, k, rho) {
    const d = e.def;
    const vac = 1 - clamp(rho / 0.4, 0, 1);
    const nozzleY = e.y - d.h / 2;
    const bw = (d.w * d.bellBot) / 2;
    const flick = 0.85 + Math.random() * 0.3;
    const len = d.w * (1.6 + 3.2 * k) * (1 + vac * 0.8) * flick;
    const spread = bw * (1 + vac * 1.6);
    ctx.globalCompositeOperation = 'lighter';
    let g = ctx.createLinearGradient(0, nozzleY, 0, nozzleY - len);
    g.addColorStop(0, 'rgba(255,214,140,0.95)'); g.addColorStop(0.35, 'rgba(255,140,40,0.75)'); g.addColorStop(1, 'rgba(255,70,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(e.x - bw * 0.92, nozzleY);
    ctx.quadraticCurveTo(e.x - spread, nozzleY - len * 0.35, e.x, nozzleY - len);
    ctx.quadraticCurveTo(e.x + spread, nozzleY - len * 0.35, e.x + bw * 0.92, nozzleY);
    ctx.closePath(); ctx.fill();
    g = ctx.createLinearGradient(0, nozzleY, 0, nozzleY - len * 0.5);
    g.addColorStop(0, 'rgba(255,255,240,0.95)'); g.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(e.x - bw * 0.55, nozzleY);
    ctx.quadraticCurveTo(e.x - bw * 0.5, nozzleY - len * 0.2, e.x, nozzleY - len * 0.5);
    ctx.quadraticCurveTo(e.x + bw * 0.5, nozzleY - len * 0.2, e.x + bw * 0.55, nozzleY);
    ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  },

  // ------------------------------------------------------------------ map view
  renderMap(ctx, W, H, dpr) {
    const v = this.active;
    const S = this.mapScale * dpr;
    const vp = this.absPos(v);
    const cx = vp.x + this.mapOffset.x, cy = vp.y + this.mapOffset.y;
    const Wd = W * dpr, Hd = H * dpr;
    const X = (x) => Wd / 2 + (x - cx) * S, Y = (y) => Hd / 2 - (y - cy) * S;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04060c'; ctx.fillRect(0, 0, Wd, Hd);
    this.drawStars(ctx, Wd, Hd, 0.45, 0);
    // map grid
    ctx.strokeStyle = 'rgba(98,208,255,0.05)'; ctx.lineWidth = 1;
    const step = Math.pow(10, Math.floor(Math.log10(200 / S * dpr)));
    const gx0 = Math.floor((cx - Wd / 2 / S) / step) * step;
    const gy0 = Math.floor((cy - Hd / 2 / S) / step) * step;
    ctx.beginPath();
    for (let x = gx0; x < cx + Wd / 2 / S; x += step) { ctx.moveTo(X(x), 0); ctx.lineTo(X(x), Hd); }
    for (let y = gy0; y < cy + Hd / 2 / S; y += step) { ctx.moveTo(0, Y(y)); ctx.lineTo(Wd, Y(y)); }
    ctx.stroke();

    // moon orbit + SOI
    ctx.strokeStyle = 'rgba(160,170,190,0.25)'; ctx.lineWidth = 1 * dpr;
    ctx.beginPath(); ctx.arc(X(0), Y(0), MOON.orbitRadius * S, 0, TAU); ctx.stroke();
    const mp = bodyPos(MOON, this.time);
    ctx.setLineDash([4 * dpr, 6 * dpr]);
    ctx.strokeStyle = 'rgba(160,170,190,0.35)';
    ctx.beginPath(); ctx.arc(X(mp.x), Y(mp.y), MOON.soi * S, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);

    // bodies
    for (const b of BODIES) {
      const p = bodyPos(b, this.time);
      const r = Math.max(b.radius * S, 3 * dpr);
      if (b.atmoHeight) {
        ctx.fillStyle = `rgba(${b.colors.halo},0.25)`;
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), (b.radius + b.atmoHeight) * S, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = b.colors.map;
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(220,228,240,0.8)';
      ctx.font = `600 ${11 * dpr}px "Chakra Petch", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(b.name.toUpperCase(), X(p.x), Y(p.y) + r + 14 * dpr);
    }

    // trajectory
    const pred = this.prediction;
    const labels = [];
    if (pred && !v.landed) {
      pred.forEach((patch, i) => {
        const pts = this.patchPoints(patch);
        if (pts.length < 4) return;
        ctx.strokeStyle = i === 0 ? '#ffb547' : i === 1 ? '#62d0ff' : '#b48cff';
        ctx.lineWidth = (i === 0 ? 2 : 1.6) * dpr;
        ctx.beginPath();
        for (let k = 0; k < pts.length; k += 2) { const sx = X(pts[k]), sy = Y(pts[k + 1]); if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); }
        ctx.stroke();
        const o = patch.o, b = patch.body;
        if (o.degenerate) return;
        const origin = bodyPos(b, patch.t0);
        const within = (nu) => (patch.tEnd === Infinity) || (timeToNu(o, nu) <= patch.tEnd - patch.t0);
        if (o.e > 0.002 && o.rp > b.radius * 0.2 && within(0)) {
          const s = stateFromNu(o, 0);
          labels.push({ x: origin.x + s.x, y: origin.y + s.y, text: `Pe ${fmt.dist(o.rp - b.radius)}`, color: ctx.strokeStyle });
        }
        if (o.e < 1 && o.e > 0.002 && o.ra < (b.soi || Infinity) && within(Math.PI)) {
          const s = stateFromNu(o, Math.PI);
          labels.push({ x: origin.x + s.x, y: origin.y + s.y, text: `Ap ${fmt.dist(o.ra - b.radius)}`, color: ctx.strokeStyle });
        }
        if (patch.end === 'encounter') {
          const m = bodyPos(MOON, patch.tEnd);
          ctx.strokeStyle = 'rgba(98,208,255,0.5)'; ctx.lineWidth = 1 * dpr;
          ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), Math.max(MOON.radius * S, 3 * dpr), 0, TAU); ctx.stroke();
        }
        if (patch.end === 'impact') {
          const s = stateAt(o, patch.tEnd - patch.t0);
          labels.push({ x: origin.x + s.x, y: origin.y + s.y, text: 'Impact', color: '#ff5d5d', cross: true });
        }
      });
    }
    // debris
    ctx.fillStyle = 'rgba(180,190,205,0.6)';
    for (const d of this.vessels) if (d !== v) { const p = this.absPos(d); ctx.fillRect(X(p.x) - 1.5 * dpr, Y(p.y) - 1.5 * dpr, 3 * dpr, 3 * dpr); }
    // labels
    ctx.font = `500 ${11 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'left';
    for (const l of labels) {
      const sx = X(l.x), sy = Y(l.y);
      ctx.fillStyle = l.color;
      if (l.cross) {
        ctx.strokeStyle = l.color; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.moveTo(sx - 5 * dpr, sy - 5 * dpr); ctx.lineTo(sx + 5 * dpr, sy + 5 * dpr); ctx.moveTo(sx + 5 * dpr, sy - 5 * dpr); ctx.lineTo(sx - 5 * dpr, sy + 5 * dpr); ctx.stroke();
      } else { ctx.beginPath(); ctx.arc(sx, sy, 3.5 * dpr, 0, TAU); ctx.fill(); }
      ctx.fillText(l.text, sx + 8 * dpr, sy - 6 * dpr);
    }
    // vessel marker
    const sx = X(vp.x), sy = Y(vp.y);
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(-v.rot);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#04060c'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(0, -9 * dpr); ctx.lineTo(6 * dpr, 7 * dpr); ctx.lineTo(0, 4 * dpr); ctx.lineTo(-6 * dpr, 7 * dpr); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  },

  patchPoints(patch) {
    const o = patch.o, b = patch.body;
    const origin = bodyPos(b, patch.t0);
    const pts = [];
    if (o.degenerate) {
      const s = { x: 0, y: 0, vx: 0, vy: 0 };
      const v = this.active;
      Object.assign(s, { x: v.x, y: v.y, vx: v.vx, vy: v.vy });
      const tFall = 2 * Math.abs(v.vx * v.x + v.vy * v.y) / Math.hypot(v.x, v.y) / (b.mu / (v.x * v.x + v.y * v.y)) + 60;
      const n = 200;
      for (let i = 0; i <= n; i++) {
        pts.push(origin.x + s.x, origin.y + s.y);
        gravityStep(s, b.mu, tFall / n);
        if (Math.hypot(s.x, s.y) < b.radius) break;
      }
      return pts;
    }
    let nuA = o.nu0, nuB;
    if (patch.end) {
      nuB = stateAt(o, patch.tEnd - patch.t0).nu;
      if (o.e < 1) { while (nuB <= nuA) nuB += TAU; }
    } else if (o.e < 1) nuB = nuA + TAU;
    else {
      nuB = o.nuMax * 0.985;
      const lim = nuAtRadius(o, MOON.orbitRadius * 3);
      if (lim != null) nuB = Math.min(nuB, lim);
    }
    if (nuB <= nuA) return pts;
    const n = 360;
    for (let i = 0; i <= n; i++) {
      const s = stateFromNu(o, nuA + ((nuB - nuA) * i) / n);
      pts.push(origin.x + s.x, origin.y + s.y);
    }
    return pts;
  },
};
