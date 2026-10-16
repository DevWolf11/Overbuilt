'use strict';
// Flight scene: simulation loop, time warp, camera, HUD, controls, missions and saving.

const WARPS = [1, 2, 4, 8, 25, 100, 500, 2500, 10000, 50000, 250000, 1000000];
const PHYS_WARP_MAX = 3; // index of the last physics warp (8x)
const PHYS_DT = 1 / 120;
const NEAR_DIST = 6000;  // vessels closer than this to the active one get full physics
const SAS_KEYS = { Digit1: 'hold', Digit2: 'prograde', Digit3: 'retrograde', Digit4: 'radialOut', Digit5: 'radialIn', Digit6: 'target' };
const FLAG_NAMES = { liftoff: 'Liftoff', splashdown: 'Splashdown' };

const Flight = {
  running: false,

  init(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pointers = new Map();
    this.touchRot = 0;
    this.scale = 12;
    this.bindDom();
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
    const v = new Vessel(ps, adj, EARTH);
    v.name = design.name || 'Rocket';
    v.stages = computeStages(ps, adj, ctrl.id);
    v.rebuildGroups();
    const surf = EARTH.radius + terrainHeight(EARTH, EARTH.padAngle);
    v.x = 0; v.y = surf + (v.com.y - v.bounds.minY) + 0.02; v.rot = 0;
    v.landed = true;
    this.launchCost = designCost(ps);
    Career.spend(this.launchCost);
    Career.data.flights++; Career.save();
    this.resetState([v], v, 0);
    const h = v.bounds.maxY - v.bounds.minY;
    this.scale = clamp((innerHeight * 0.42) / h, 1.5, 40);
    this.updateDvEstimate();
    this.updateHUD(true);
    this.save();
  },

  resetState(vessels, active, time) {
    this.vessels = vessels;
    this.active = active;
    this.time = time;
    this.warpIdx = 0;
    this.mapMode = false;
    FX.clear();
    this.flags = {};
    this.stats = { maxAlt: 0, maxSpeed: 0, maxG: 0 };
    this.destroyed = false;
    this.ended = false;
    this.paused = false;
    this.flash = null;
    this.prediction = null;
    this.approach = null;
    this.window = null;
    this.target = null;
    this.predTimer = 0; this.hudTimer = 0; this.dvTimer = 0; this.saveTimer = 10;
    this.dvLeft = 0;
    this.viewRot = Math.PI / 2 - Math.atan2(active.y, active.x);
    this.camAbs = this.absPos(active);
    this.running = true;
    MapView.focusVessel();
    $('#btn-map').classList.remove('on');
    $('#map-legend').hidden = true;
    $('#btn-center').hidden = true;
    this.syncSas();
    this.requestWakeLock();
  },

  stop() {
    this.running = false;
    Sound.engine(0, 0); Sound.wind(0);
    if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
  },

  revert() {
    Career.earn(this.launchCost);
    store.set('rss.flight', null);
    this.start(this.design);
  },

  requestWakeLock() {
    try {
      if (navigator.wakeLock && !this.wakeLock) navigator.wakeLock.request('screen').then((l) => { this.wakeLock = l; }).catch(() => {});
    } catch (e) { /* not available */ }
  },

  // ------------------------------------------------------------------ save / resume
  serialize() {
    const keep = this.vessels.filter((v) => (v.control || v === this.active) && !v.dead && v.parts.length);
    return {
      v: 2, time: this.time, design: this.design, launchCost: this.launchCost,
      active: keep.indexOf(this.active), flags: this.flags, stats: this.stats,
      target: this.target ? this.target.id : null, scale: this.scale,
      vessels: keep.map((v) => v.serialize()),
    };
  },
  save() {
    if (!this.running || this.ended || !this.active || !this.active.parts.length) return;
    if (this.destroyed && !this.vessels.some((v) => v.control && !v.dead && v !== this.active)) return;
    store.set('rss.flight', this.serialize());
  },
  restore(d) {
    const vessels = d.vessels.map((x) => Vessel.restore(x));
    let maxId = 0;
    for (const v of vessels) for (const p of v.parts) maxId = Math.max(maxId, p.id);
    _partSeq = Math.max(_partSeq, maxId + 1);
    const active = vessels[clamp(d.active, 0, vessels.length - 1)] || vessels[0];
    this.design = d.design;
    this.launchCost = d.launchCost || 0;
    this.resetState(vessels, active, d.time || 0);
    this.flags = d.flags || {};
    this.stats = d.stats || this.stats;
    this.target = d.target ? BODY_BY_ID[d.target] : null;
    this.scale = d.scale || 12;
    this.updatePrediction();
    this.updateDvEstimate();
    this.updateHUD(true);
  },

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
    if (v.altitude() < v.body.warpAlt) return v.body.atmoHeight ? 'atmosphere' : v.body.star ? 'star' : 'surface';
    return true;
  },

  setWarp(i) {
    i = clamp(i, 0, WARPS.length - 1);
    if (i > PHYS_WARP_MAX) {
      const ok = this.canRails();
      if (ok !== true) {
        const why = { engines: 'Cut the engines to time warp faster', atmosphere: 'Can’t time warp faster inside an atmosphere', star: 'Too close to the Sun for faster time warp' }[ok]
          || 'Too close to the surface for faster time warp';
        this.toast(why);
        i = Math.min(i, PHYS_WARP_MAX);
      }
    }
    if (i > PHYS_WARP_MAX && this.warpIdx <= PHYS_WARP_MAX) for (const v of this.vessels) v.w = 0;
    this.warpIdx = i;
    this.updateHUD(true);
  },

  setSas(mode) {
    const v = this.active;
    if (!v) return;
    if (mode === 'target' && !this.target) { this.toast('Pick a target on the map first'); return; }
    v.sas = v.sas === mode && mode !== 'hold' ? 'hold' : mode;
    this.syncSas();
  },
  syncSas() {
    const m = this.active ? this.active.sas : 'hold';
    document.querySelectorAll('[data-sas]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sas === m)));
  },

  setTarget(b) {
    this.target = b && b !== this.active.body ? b : null;
    if (!this.target && this.active.sas === 'target') { this.active.sas = 'hold'; this.syncSas(); }
    this.toast(this.target ? `Target: ${this.target.name}` : 'Target cleared');
    this.updatePrediction();
    this.updateHUD(true);
  },

  switchTo(v) {
    if (!v || v === this.active || !v.control) return;
    this.active = v;
    this.destroyed = false;
    this.prediction = null;
    MapView.focusVessel();
    this.syncSas();
    this.updatePrediction();
    this.updateDvEstimate();
    this.updateHUD(true);
    this.toast(`Controlling ${v.name}`);
  },

  // ------------------------------------------------------------------ actions
  stage() {
    if (this.destroyed) return;
    if (this.warpIdx > PHYS_WARP_MAX) this.setWarp(0);
    const v = this.active;
    if (v.stageIdx >= v.stages.length) { this.toast('No stages left. Tap parts to use them.'); return; }
    const ids = v.stages[v.stageIdx];
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
    v.stageIdx++;
    if (used) { Sound.ignite(); haptic(15); }
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
    FX.puff(v.body, wp.x, wp.y, v.vx, v.vy, 12, '#e8edf2');
    FX.sparks(v.body, wp.x, wp.y, v.vx, v.vy, 10);
    Sound.separate();
    if (pieces.length) this.toast(`Separated ${fmt.mass(mBefore - v.mass)}`);
  },

  deployChute(v, p) {
    if (p.deployed > 0 || p.used) return false;
    const b = v.body;
    if (!b.atmoHeight) { this.toast('No air here. Parachutes need an atmosphere.'); return false; }
    if (v.altitude() > b.atmoHeight * 0.85) { this.toast('Too high: wait for thicker air'); return false; }
    // the limit is how hard the air pushes: 250 m/s in Earth's lower air, faster where the air is thin
    const q = 0.5 * airDensity(b, v.altitude()) * v.speed() ** 2;
    if (v.speed() > 250 && q > 12000) { this.toast(`Too fast to deploy (${Math.round(v.speed())} m/s). Slow down first.`); return false; }
    p.deployed = 0.01;
    Sound.separate();
    this.toast('Parachute deployed');
    return true;
  },

  breakParts(v, parts, cause) {
    const air = airDensity(v.body, v.altitude()) > 0.01;
    for (const p of parts) {
      const wp = v.toWorld(p.x, p.y);
      FX.explosion(v.body, wp.x, wp.y, v.vx * (cause === 'heat' ? 0.9 : 0.2), v.vy * (cause === 'heat' ? 0.9 : 0.2), Math.max(p.def.w, p.def.h), air);
      v.parts = v.parts.filter((q) => q !== p);
      for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id);
      v.adj.delete(p.id);
    }
    if (v === this.active || Math.hypot(this.absPos(v).x - this.camAbs.x, this.absPos(v).y - this.camAbs.y) < 3000) { Sound.explode(); haptic([40, 30, 60]); }
    if (!v.parts.length) { v.dead = true; if (v === this.active) this.onDestroyed(); return; }
    const hadControl = !!v.control;
    const pieces = v.splitComponents();
    for (const piece of pieces) { piece.isDebris = !piece.control; this.vessels.push(piece); }
    v.rebuildGroups();
    if (v === this.active && !v.control) this.onDestroyed();
    else if (!hadControl) v.isDebris = true;
  },

  onDestroyed() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.warpIdx = 0;
    setTimeout(() => {
      if (!this.running || this.ended || !this.destroyed) return;
      const others = this.vessels.filter((x) => x.control && !x.dead && x !== this.active);
      if (!others.length) { this.ended = true; store.set('rss.flight', null); }
      const acts = [
        { label: 'Back to hangar', onClick: () => App.toBuild() },
        { label: 'Revert to launch', primary: !others.length, onClick: () => this.revert() },
      ];
      if (others.length) acts.push({ label: `Switch to ${others[0].name}`, primary: true, onClick: () => this.switchTo(others[0]) });
      UI.modal({ kicker: 'Mission update', title: 'Vessel destroyed', body: this.summaryHTML(), actions: acts });
    }, 1600);
  },

  canRecover() {
    const v = this.active;
    return v && v.parts.length && (v.landed || v.splashed) && v.body === EARTH && v.speed() < 1.2 && this.time > 3;
  },

  recover() {
    if (!this.canRecover()) return;
    const v = this.active;
    const refund = Math.round(v.value() * 0.9);
    if (this.flags.space) this.award('recoveredSpace');
    for (const b of BODIES) if (this.flags[`land:${b.id}`]) this.award(`home:${b.id}`);
    if (v.splashed) this.award('splashdown');
    Career.earn(refund);
    this.ended = true;
    this.paused = true;
    store.set('rss.flight', null);
    UI.modal({
      kicker: 'Recovered', title: Object.keys(this.flags).some((k) => k.startsWith('home:')) ? 'Welcome home' : 'Mission complete',
      body: this.summaryHTML(Career.sandbox ? '' : `<p class="refund">Recovered parts refunded: <b>${money(refund)}</b></p>`),
      actions: [
        { label: 'Fly again', onClick: () => this.revert() },
        { label: 'Back to hangar', primary: true, onClick: () => App.toBuild() },
      ],
    });
  },

  summaryHTML(extra = '') {
    const got = Object.keys(this.flags).map((f) => {
      const m = MISSIONS.find((x) => x.flag === f);
      return m ? m.title : FLAG_NAMES[f];
    }).filter(Boolean);
    const list = got.length ? got.map((a) => `<li>${a}</li>`).join('') : '<li class="muted">None this flight</li>';
    return `<dl class="summary">
      <div><dt>Flight time</dt><dd>${fmt.clock(this.time)}</dd></div>
      <div><dt>Farthest</dt><dd>${fmt.dist(this.stats.maxAlt)}</dd></div>
      <div><dt>Top speed</dt><dd>${fmt.speed(this.stats.maxSpeed)}</dd></div>
    </dl>${extra}<h3 class="summary-h">Milestones</h3><ul class="milestones">${list}</ul>`;
  },

  openMenu() {
    if (this.ended) return;
    this.paused = true;
    const acts = [
      { label: 'Save & exit', onClick: () => { this.save(); App.toBuild(); } },
      { label: 'Revert to launch', onClick: () => this.revert() },
    ];
    if (this.canRecover()) acts.push({ label: 'Recover', onClick: () => this.recover() });
    acts.push({ label: 'Resume', primary: true, onClick: () => {} });
    UI.modal({
      kicker: `T+ ${fmt.clock(this.time)} · ${this.active.name}`, title: 'Paused',
      body: Flight.controlsHelp(),
      actions: acts,
      onClose: () => { if (!this.ended) this.paused = false; },
    });
  },

  controlsHelp() {
    return `<div class="help-grid">
      <div><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd><span>Rotate (drive on wheels)</span></div>
      <div><kbd>W</kbd><kbd>S</kbd> / <kbd>Shift</kbd><kbd>Ctrl</kbd><span>Throttle up / down</span></div>
      <div><kbd>Z</kbd><kbd>X</kbd><span>Full throttle / cut</span></div>
      <div><kbd>Space</kbd><span>Activate next stage</span></div>
      <div><kbd>1</kbd>–<kbd>6</kbd><span>Autopilot: hold, prograde, retrograde, radial out/in, target</span></div>
      <div><kbd>M</kbd><span>Map view (tap a planet to target it)</span></div>
      <div><kbd>,</kbd><kbd>.</kbd><span>Time warp down / up</span></div>
      <div><kbd>[</kbd><kbd>]</kbd><span>Switch between your vessels</span></div>
      <div><kbd>Wheel</kbd><span>Zoom (pinch on touch)</span></div>
      <div><span class="tap">Tap a part</span><span>Toggle an engine, fire a separator, open a parachute</span></div>
    </div>`;
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
        const t0 = this.time;
        const near = [], far = [];
        const ap = this.absPos(this.active);
        for (const v of this.vessels) {
          if (v === this.active) { near.push(v); continue; }
          const p = this.absPos(v);
          const d = Math.hypot(p.x - ap.x, p.y - ap.y);
          if (d < NEAR_DIST || (v.control && !v.landed && v.altitude() < v.body.warpAlt)) near.push(v);
          else if (!v.landed) far.push(v);
        }
        const n = Math.max(1, Math.ceil(total / (warp >= 4 ? PHYS_DT * 2 : PHYS_DT) - 1e-6));
        const h = total / n;
        for (let i = 0; i < n; i++) this.physicsTick(h, near);
        for (const v of far) {
          const used = this.railsAdvance(v, total, false, t0);
          if (used < total - 1e-6 && !v.control) v.dead = true; // fell into an atmosphere out of sight
        }
        this.emitParticles(dt * warp);
        FX.update(dt * warp, this);
      } else {
        const t0 = performance.now();
        this.railsTick(dt * warp);
        FX.clear();
        if (performance.now() - t0 > 14 && this.warpIdx > PHYS_WARP_MAX + 1) {
          this.warpIdx--;
          this.toast('Time warp lowered to keep things smooth');
        }
      }
      this.cleanup();
      this.checkMilestones();
    }
    const v = this.active;
    if (v && v.parts.length && !this.paused) {
      const maxT = v.parts.reduce((s, p) => s + (p.def.thrust || 0) * 1000, 0);
      const air = clamp(airDensity(v.body, v.altitude()) / 0.6, 0, 1);
      Sound.engine(maxT ? (v.thrust || 0) / maxT : 0, air);
      Sound.wind(clamp((v.q || 0) / 30000, 0, 1) + clamp((v.heatFlux || 0) / 2e8, 0, 1));
    } else { Sound.engine(0, 0); Sound.wind(0); }

    this.predTimer -= rdt;
    if (this.predTimer <= 0) { this.predTimer = this.mapMode ? 0.12 : 0.3; this.updatePrediction(); }
    this.dvTimer -= rdt;
    if (this.dvTimer <= 0) { this.dvTimer = 0.5; this.updateDvEstimate(); }
    this.hudTimer -= rdt;
    if (this.hudTimer <= 0) { this.hudTimer = 0.08; this.updateHUD(); }
    this.saveTimer -= rdt;
    if (this.saveTimer <= 0) { this.saveTimer = 10; this.save(); }
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

  physicsTick(h, list) {
    for (const v of list.slice()) {
      if (v.dead) continue;
      if (v !== this.active && v.landed && v.restTime > 2 && !v.thrust) continue; // sleeping
      v.physicsStep(h, this);
      this.checkSOI(v, this.time);
    }
    this.time += h;
  },

  checkSOI(v, t) {
    const b = v.body;
    for (const c of b.children) {
      const cp = childRel(c, t);
      const dx = v.x - cp.x, dy = v.y - cp.y;
      if (dx * dx + dy * dy < c.soi * c.soi) {
        const cv = childRelVel(c, t);
        v.x = dx; v.y = dy; v.vx -= cv.x; v.vy -= cv.y; v.body = c;
        if (v === this.active) { this.toast(`Entered ${c.name}’s sphere of influence`); this.prediction = null; }
        return true;
      }
    }
    if (b.parent && Math.hypot(v.x, v.y) > b.soi) {
      const bp = childRel(b, t), bv = childRelVel(b, t);
      v.x += bp.x; v.y += bp.y; v.vx += bv.x; v.vy += bv.y; v.body = b.parent;
      if (v === this.active) { this.toast(`Left ${b.name}’s sphere of influence`); this.prediction = null; }
      return true;
    }
    return false;
  },

  railsTick(T) {
    const a = this.active;
    const t0 = this.time;
    const used = this.railsAdvance(a, T, true, t0);
    for (const v of this.vessels) {
      if (v === a || v.dead) continue;
      const u = this.railsAdvance(v, used, false, t0);
      if (u < used - 1e-6 && !v.control) v.dead = true;
    }
    this.time = t0 + used;
  },

  // On-rails Kepler propagation with event detection (atmosphere/surface, SOI changes).
  railsAdvance(v, T, isActive, t0) {
    if (v.landed && v.speed() < 0.2) return T;
    v.w = 0;
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
      const tBase = t0 + done;
      const event = (s, tt) => {
        const r = Math.hypot(s.x, s.y);
        if (r < minR) return 'low';
        if (body.parent && r > body.soi) return 'out';
        for (const c of body.children) {
          if (Math.abs(r - c.orbitRadius) > c.soi) continue;
          const cp = childRel(c, tBase + tt);
          if ((s.x - cp.x) ** 2 + (s.y - cp.y) ** 2 < c.soi * c.soi) return 'in';
        }
        return null;
      };
      const speed = Math.hypot(start.vx, start.vy);
      let maxChunk = 120;
      for (const c of body.children) maxChunk = Math.min(maxChunk, (c.soi * 0.5) / (speed + c.orbitSpeed + 1));
      let elapsed = 0, hit = null;
      const remaining = T - done;
      while (elapsed < remaining - 1e-9) {
        const r = Math.hypot(v.x, v.y);
        const tdyn = Math.sqrt((r * r * r) / body.mu);
        const chunk = Math.min(remaining - elapsed, maxChunk, Math.max(0.5, tdyn * 0.04));
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
          this.toast(body.atmoHeight ? `Entering ${body.name}’s atmosphere` : 'Approaching the surface');
        }
        return done;
      }
      this.checkSOI(v, t0 + done);
    }
    return done;
  },

  cleanup() {
    const a = this.active;
    const ap = this.absPos(a);
    this.vessels = this.vessels.filter((v) => {
      if (v.dead || !v.parts.length) return false;
      if (v === a || v.control) return true;
      const p = this.absPos(v);
      return Math.hypot(p.x - ap.x, p.y - ap.y) < 150000;
    });
  },

  award(flag) {
    if (this.flags[flag]) return;
    this.flags[flag] = true;
    const done = Career.onFlag(flag);
    for (const m of done) {
      this.toast(Career.sandbox ? m.title : `${m.title} · +${money(m.reward)}`, 'achievement');
      Sound.chime();
    }
    if (!done.length && FLAG_NAMES[flag]) this.toast(FLAG_NAMES[flag], 'achievement');
  },

  checkMilestones() {
    const v = this.active;
    if (!v || !v.parts.length || this.destroyed) return;
    const b = v.body, alt = v.altitude(), sp = v.speed();
    const ap = this.absPos(v), ep = bodyPos(EARTH, this.time);
    this.stats.maxAlt = Math.max(this.stats.maxAlt, Math.hypot(ap.x - ep.x, ap.y - ep.y) - EARTH.radius);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, sp);
    const o = this.prediction && this.prediction[0] && this.prediction[0].body === b ? this.prediction[0].o : null;
    if (b === EARTH && alt > EARTH.padHeight + 60 && this.time > 1) this.award('liftoff');
    if (b === EARTH && alt > 1000) this.award('alt1k');
    if (b === EARTH && alt > EARTH.atmoHeight) this.award('space');
    if (b !== EARTH && !b.star) this.award(`soi:${b.id}`);
    if (b.star) { this.award('space'); if (alt < 3e6) this.award('sunDive'); if (o && !o.degenerate && o.e >= 1) this.award('escapeSun'); }
    if (o && !b.star && !o.degenerate && o.e < 1 && o.rp > b.radius + b.warpAlt && o.ra < b.soi) this.award(`orbit:${b.id}`);
    const settled = v.landed && v.contactTime > 1.5 && sp < 0.6 && v.control;
    if (settled && b !== EARTH && !b.star) this.award(`land:${b.id}`);
    if (settled) for (const p of v.parts) if (p.def.chute && p.deployed > 0 && !p.used) p.used = true; // canopy collapses
  },

  updatePrediction() {
    const v = this.active;
    if (!v || !v.parts.length) { this.prediction = null; return; }
    this.prediction = predictTrajectory(v.body, { x: v.x, y: v.y, vx: v.vx, vy: v.vy }, this.time, 4);
    this.approach = this.target ? closestApproach(this.prediction, this.target) : null;
    this.window = null;
    const t = this.target;
    if (t && t.parent && !v.landed) {
      const o = this.prediction[0].o;
      if (t.parent === v.body && !o.degenerate && o.e < 0.5 && Math.sign(o.dir) === Math.sign(t.orbitDir)) {
        const r = Math.hypot(v.x, v.y);
        this.window = transferWindow(r, Math.atan2(v.y, v.x), Math.sqrt(v.body.mu / (r * r * r)), t, this.time);
      } else if (v.body.parent && t.parent === v.body.parent && t !== v.body) {
        const bp = childRel(v.body, this.time);
        this.window = transferWindow(v.body.orbitRadius, Math.atan2(bp.y, bp.x), v.body.n, t, this.time);
      }
    }
  },

  updateDvEstimate() {
    const v = this.active;
    if (!v || !v.parts.length || !v.control) { this.dvLeft = 0; return; }
    const remaining = [v.parts.filter((p) => p.def.thrust && p.active).map((p) => p.id), ...v.stages.slice(v.stageIdx)];
    this.dvLeft = estimateDeltaV(v.parts, v.adj, v.control.id, remaining, false).total;
  },

  emitParticles(dt) {
    if (dt <= 0) return;
    const rate = Settings.high ? 1 : 0.45;
    for (const v of this.vessels) {
      const rho = airDensity(v.body, v.altitude());
      const fx = -Math.sin(v.rot), fy = Math.cos(v.rot);
      for (const e of v.parts) {
        if (!e.firing) continue;
        const nz = nozzleOf(e.def);
        if (rho > 0.01 || e.def.solid) {
          const smoky = e.def.solid ? 2.2 : e.def.plume === 'hydro' || e.def.plume === 'ion' || e.def.plume === 'nuclear' ? 0.35 : 1;
          e._emit = (e._emit || 0) + 22 * e.firing * Math.max(e.def.w, 1) * smoky * Math.min(1, rho * 2 + (e.def.solid ? 0.3 : 0)) * rate * dt;
          while (e._emit >= 1) {
            e._emit -= 1;
            const wp = v.toWorld(e.x, e.y + nz.y - e.def.w * 0.6);
            const sp = 25 + Math.random() * 25, j = (Math.random() - 0.5) * 10;
            FX.add({ kind: 'smoke', b: v.body, x: wp.x, y: wp.y, vx: v.vx - fx * sp + j * fy, vy: v.vy - fy * sp - j * fx,
              max: 2.2 + Math.random() * 2.6, size: Math.max(e.def.w, 1) * 0.7, grow: Math.max(e.def.w, 1) * 3.4, color: e.def.solid ? '#e9e6e0' : '#d9dde2', alpha: 0.34 });
          }
        }
        // ground interaction: dust or spray kicked up near the surface
        if (v === this.active && Settings.high) {
          const ga = v.groundAltitude();
          if (ga < 40 && ga > -5 && e.firing > 0.2) {
            const ang = Math.atan2(v.y, v.x), n = surfaceNormal(v.body, ang);
            const water = waterAt(v.body, ang);
            const base = surfaceRadius(v.body, ang);
            e._dust = (e._dust || 0) + 30 * e.firing * (1 - ga / 40) * dt;
            while (e._dust >= 1) {
              e._dust -= 1;
              const side = Math.random() < 0.5 ? -1 : 1, s = 8 + Math.random() * 18;
              FX.add({ kind: 'smoke', b: v.body, x: n.x * base, y: n.y * base, vx: v.vx + (-n.y * side) * s + n.x * 3, vy: v.vy + (n.x * side) * s + n.y * 3,
                max: 1.5 + Math.random() * 1.5, size: 1, grow: 5, color: water ? '#eaf4ff' : v.body.colors.surface, alpha: 0.45 });
            }
          }
        }
      }
      // reentry plasma trail
      if (v.heatFlux > 4e7 && Settings.high) {
        const k = clamp((v.heatFlux - 4e7) / 1.5e8, 0, 1);
        if (Math.random() < 0.6 * k + 0.2) {
          const sp = v.speed() || 1;
          FX.add({ kind: 'plasma', b: v.body, x: v.x - (v.vx / sp) * 2, y: v.y - (v.vy / sp) * 2, vx: v.vx * 0.85, vy: v.vy * 0.85,
            max: 0.4 + Math.random() * 0.4, size: Math.max(v.width, 1.5) * 0.6, grow: Math.max(v.width, 1.5), color: '#ff9a4a', alpha: 0.5 * k });
        }
      }
      if (v.splashed && !v._splashFx) { v._splashFx = true; const ang = Math.atan2(v.y, v.x), n = surfaceNormal(v.body, ang); FX.splash(v.body, v.x, v.y, n.x, n.y, 30); }
      if (!v.splashed) v._splashFx = false;
    }
  },

  // ------------------------------------------------------------------ input
  bindDom() {
    const c = this.canvas;
    addEventListener('keydown', (e) => {
      if (App.scene !== 'flight' || UI.modalOpen) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (SAS_KEYS[e.code]) { this.setSas(SAS_KEYS[e.code]); return; }
      switch (e.code) {
        case 'Space': this.stage(); break;
        case 'KeyM': this.toggleMap(); break;
        case 'Comma': this.setWarp(this.warpIdx - 1); break;
        case 'Period': this.setWarp(this.warpIdx + 1); break;
        case 'KeyZ': this.setThrottle(1); break;
        case 'KeyX': this.setThrottle(0); break;
        case 'BracketLeft': case 'BracketRight': this.cycleVessel(e.code === 'BracketRight' ? 1 : -1); break;
        case 'Escape': case 'KeyP': this.openMenu(); break;
        case 'KeyR': if (this.canRecover()) this.recover(); break;
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.touchRot = 0; });

    c.addEventListener('wheel', (e) => {
      if (App.scene !== 'flight') return;
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
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
        if (this.mapMode) MapView.pan(now.cx - this.pinch.cx, now.cy - this.pinch.cy);
        this.pinch = now;
      } else if (this.pointers.size === 1 && this.mapMode) MapView.pan(dx, dy);
    });
    const up = (e) => {
      if (App.scene !== 'flight') return;
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (!p || e.type === 'pointercancel') return;
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy);
      if (moved < 10 && performance.now() - p.t < 450 && this.pointers.size === 0) this.tapAt(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

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
    $('#warp-label').addEventListener('click', () => this.setWarp(0));
    $('#btn-tmax').addEventListener('click', () => this.setThrottle(1));
    $('#btn-tcut').addEventListener('click', () => this.setThrottle(0));
    $('#btn-center').addEventListener('click', () => { MapView.focusVessel(); MapView.fit(this); MapView.focusVessel(); });
    document.querySelectorAll('[data-sas]').forEach((b) => b.addEventListener('click', () => this.setSas(b.dataset.sas)));
    const track = $('#throttle-track');
    const setFromY = (e) => { const r = track.getBoundingClientRect(); this.setThrottle(1 - (e.clientY - r.top) / r.height); };
    track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); setFromY(e); this.dragThrottle = true; });
    track.addEventListener('pointermove', (e) => { if (this.dragThrottle) setFromY(e); });
    track.addEventListener('pointerup', () => { this.dragThrottle = false; });
    track.addEventListener('pointercancel', () => { this.dragThrottle = false; });
  },

  cycleVessel(dir) {
    const list = this.vessels.filter((v) => v.control && !v.dead);
    if (list.length < 2) { this.toast('No other vessels to switch to'); return; }
    const i = list.indexOf(this.active);
    this.switchTo(list[(i + dir + list.length) % list.length]);
  },

  pinchInfo() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  },

  zoomBy(f, cx, cy) {
    if (this.mapMode) MapView.zoom(f, cx, cy);
    else this.scale = clamp(this.scale * f, 0.00005, 80);
  },

  toggleMap() {
    this.mapMode = !this.mapMode;
    if (this.mapMode) { this.updatePrediction(); MapView.fit(this); }
    $('#btn-map').classList.toggle('on', this.mapMode);
    $('#map-legend').hidden = !this.mapMode;
    $('#btn-center').hidden = !this.mapMode;
  },

  tapAt(cx, cy) {
    const v = this.active;
    if (!v || !v.parts.length) return;
    if (this.mapMode) {
      const hit = MapView.hit(this, cx, cy);
      if (!hit) return;
      if (hit.vessel) { this.switchTo(hit.vessel); return; }
      const b = hit.body;
      if (b === this.target) { this.setTarget(null); return; }
      MapView.focusBody(b, this);
      if (b !== v.body) this.setTarget(b);
      return;
    }
    if (this.destroyed) return;
    const W = innerWidth, H = innerHeight;
    const dx = (cx - W / 2) / this.scale, dy = -(cy - H / 2) / this.scale;
    const c = Math.cos(-this.viewRot), s = Math.sin(-this.viewRot);
    const wx = c * dx - s * dy, wy = s * dx + c * dy;
    const pad = Math.max(0.25, 14 / this.scale);
    for (const ves of [v, ...this.vessels.filter((x) => x !== v)]) {
      const bp = bodyPos(ves.body, this.time);
      const lp = ves.toLocal(this.camAbs.x + wx - bp.x, this.camAbs.y + wy - bp.y);
      const p = ves.hitTest(lp.x, lp.y, pad);
      if (!p) continue;
      if (ves !== v) { if (ves.control) this.switchTo(ves); return; }
      if (v.activatePart(p, this)) {
        this.flash = { id: p.id, t: performance.now() };
        Sound.click();
        this.updateDvEstimate();
        this.updateHUD(true);
      }
      return;
    }
  },

  // ------------------------------------------------------------------ HUD
  updateThrottleDom() {
    const t = this.active ? this.active.throttle : 0;
    $('#throttle-fill').style.height = `${t * 100}%`;
    $('#throttle-label').textContent = `${Math.round(t * 100)}%`;
  },

  hint() {
    if (!Settings.get('hints')) return '';
    const v = this.active, b = v.body;
    if (this.destroyed) return '';
    const o = this.prediction && this.prediction[0] && this.prediction[0].o;
    const alt = v.altitude();
    if (b === EARTH) {
      if (v.stageIdx === 0 && v.landed && this.time < 20) return 'Tap STAGE (Space) to light the engines.';
      const lean = Math.abs(wrapAngle(v.rot - (Math.atan2(v.y, v.x) - Math.PI / 2)));
      if (!this.flags.space && alt < 2500 && v.thrust > 0) return 'Climb straight up for now.';
      if (!this.flags.space && alt < 22000 && v.thrust > 0 && lean < 0.35) return 'Lean right (D or ⟳) toward 45° to build sideways speed.';
      if (o && !o.degenerate && o.ra - EARTH.radius > 34000 && o.rp < EARTH.radius + 30000 && alt < 30000 && v.thrust > 0)
        return 'Apoapsis is above the air. Cut the throttle (X) and coast up.';
      if (o && !o.degenerate && o.e < 1 && o.rp < EARTH.radius + 30000 && alt > 28000 && v.thrust === 0 && !v.landed)
        return 'Coast to apoapsis, press PRO (2) and burn until periapsis passes 30 km.';
      if (o && !o.degenerate && o.e < 1 && o.rp > EARTH.radius + 30000 && !this.flags['soi:moon'] && !this.target)
        return 'In orbit! Open the map (M) and tap the Moon to target it.';
      if (this.target && this.window && this.window.wait > 120) return `Warp ahead: the ${this.target.name} transfer window opens in ${fmt.duration(this.window.wait)}.`;
      if (this.target && this.window && this.window.wait <= 120 && !(this.approach && this.approach.encounter)) return 'Window open: burn prograde until the map shows an encounter.';
      const chute = v.parts.find((p) => p.def.chute && !p.deployed && !p.used);
      if (chute && alt < 9000 && (v.speed() < 250 || (v.q || 0) < 12000) && !v.landed && (v.x * v.vx + v.y * v.vy) < 0) return 'Deploy the parachute now (STAGE).';
      if (this.canRecover()) return 'Safely down. Tap Recover to finish the mission.';
    }
    if (b !== EARTH && !b.star && v.landed && this.flags[`land:${b.id}`]) return `You landed on ${b.name}. Plan your trip home from the map.`;
    if (b !== EARTH && !b.star && o && !o.degenerate && o.e >= 1 && !v.landed) return `Burn retrograde (3) near periapsis to be captured by ${b.name}.`;
    return '';
  },

  updateHUD(force) {
    const v = this.active;
    if (!v || !v.parts.length) return;
    const b = v.body;
    const r = Math.hypot(v.x, v.y);
    const alt = r - b.radius;
    const ground = v.groundAltitude();
    const vs = (v.x * v.vx + v.y * v.vy) / r;
    const set = (id, txt) => { const e = document.getElementById(id); if (e.textContent !== txt) e.textContent = txt; };
    set('t-body', b.name + (v.splashed ? ' · splashed' : v.landed ? ' · landed' : ''));
    set('t-vessel', v.name);
    set('t-alt', fmt.dist(alt));
    $('#row-ground').hidden = !(ground < 5000);
    set('t-ground', fmt.dist(Math.max(0, ground)));
    set('t-speed', fmt.speed(v.speed()));
    set('t-vs', (vs >= 0 ? '+' : '') + fmt.speed(vs));
    const o = this.prediction && this.prediction[0] && this.prediction[0].body === b ? this.prediction[0].o : null;
    let ap = '—', pe = '—', apT = '', peT = '';
    if (o && !o.degenerate) {
      if (o.e < 1 && o.ra < b.soi) { ap = fmt.dist(o.ra - b.radius); apT = fmt.duration(timeToNu(o, Math.PI)); }
      else ap = 'Escape';
      pe = o.rp < b.radius ? 'Suborbital' : fmt.dist(o.rp - b.radius);
      if (o.rp >= b.radius && (o.e < 1 || o.nu0 < 0)) peT = fmt.duration(timeToNu(o, 0));
    } else if (o) { ap = fmt.dist(o.ra - b.radius); pe = 'Suborbital'; }
    if (v.landed) { apT = ''; peT = ''; }
    set('t-ap', ap); set('t-apt', apT);
    set('t-pe', pe); set('t-pet', peT);
    set('t-dv', `${Math.round(this.dvLeft).toLocaleString('en-US')} m/s`);
    set('t-time', fmt.clock(this.time));
    // heat
    $('#row-heat').hidden = !(v.maxHeat > 0.3);
    $('#heat-fill').style.width = `${clamp(v.maxHeat, 0, 1) * 100}%`;
    $('#row-heat').classList.toggle('danger', v.maxHeat > 0.75);
    // target
    let tgt = '';
    if (this.target) {
      const parts = [this.target.name];
      if (this.approach && this.approach.encounter) parts.push('encounter');
      else if (this.approach && this.approach.dist != null) parts.push(`closest ${fmt.dist(this.approach.dist)}`);
      if (this.window) parts.push(this.window.wait < 120 ? 'window open' : `window ${fmt.duration(this.window.wait)}`);
      tgt = parts.join(' · ');
    }
    $('#row-target').hidden = !tgt;
    set('t-target', tgt);
    // encounter / escape line
    let enc = '';
    const pred = this.prediction;
    if (pred && pred.length > 1) {
      const p0 = pred[0], p1 = pred[1];
      if (p0.end === 'encounter') {
        const pe2 = p1.o.degenerate ? 0 : p1.o.rp - p1.body.radius;
        enc = `${p1.body.name} in ${fmt.duration(p0.tEnd - this.time)} · Pe ${pe2 < 0 ? 'impact' : fmt.dist(pe2)}`;
      } else if (p0.end === 'escape') enc = `Leaves ${b.name} SOI in ${fmt.duration(p0.tEnd - this.time)}`;
    }
    if (!enc && pred && pred[0].end === 'impact' && !v.landed && ground > 200) enc = `Impact in ${fmt.duration(pred[0].tEnd - this.time)}`;
    $('#row-enc').hidden = !enc;
    set('t-enc', enc);

    const warp = WARPS[this.warpIdx];
    set('warp-label', warp >= 1e6 ? `${warp / 1e6}M×` : warp >= 1e4 ? `${warp / 1000}k×` : `${warp}×`);
    $('#warp').classList.toggle('rails', this.warpIdx > PHYS_WARP_MAX);

    const sf = v.stageFuel();
    const frac = sf.cap ? sf.fuel / sf.cap : 0;
    $('#fuel-fill').style.width = `${frac * 100}%`;
    $('#fuel-fill').classList.toggle('low', frac < 0.15);
    set('fuel-label', sf.cap ? `Stage fuel ${fmt.mass(sf.fuel)}` : 'No engines running');

    const next = v.stages[v.stageIdx];
    set('stage-num', v.stageIdx < v.stages.length ? `Stage ${v.stageIdx + 1}/${v.stages.length}` : 'Staging done');
    set('stage-next', next ? describeStage(next, v.byId) : 'Tap parts to use them');
    $('#btn-stage').disabled = !next || this.destroyed;
    $('#btn-recover').hidden = !this.canRecover();
    const h = this.hint();
    $('#hint').hidden = !h;
    set('hint-text', h);
    if (force) { this.updateThrottleDom(); this.syncSas(); }
  },

  // ------------------------------------------------------------------ rendering
  render(ctx, W, H, dpr) {
    if (!this.running) return;
    const v = this.active;
    if (v.parts.length) {
      this.camAbs = this.absPos(v);
      const want = Math.PI / 2 - Math.atan2(v.y, v.x);
      this.viewRot += wrapAngle(want - this.viewRot) * 0.25;
    }
    if (this.mapMode) MapView.render(ctx, W, H, dpr, this);
    else World.render(ctx, W, H, dpr, this);
  },
};

function haptic(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ } }
