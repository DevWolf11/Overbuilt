'use strict';
// Flight scene: simulation loop, time warp, camera, HUD, controls, missions and saving.

const WARPS = [1, 2, 4, 8, 25, 100, 500, 2500, 10000, 50000, 250000, 1000000];
const PHYS_WARP_MAX = 3; // index of the last physics warp (8x)
const PHYS_DT = 1 / 120;
const NEAR_DIST = 6000;  // vessels closer than this to the active one get full physics
const SAS_KEYS = { Digit1: 'hold', Digit2: 'prograde', Digit3: 'retrograde', Digit4: 'radialOut', Digit5: 'radialIn', Digit6: 'target' };
const PLANE_SAS_KEYS = { Digit1: 'hold', Digit2: 'level', Digit3: 'heading', Digit4: 'off' };
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const PLANE_SAS = new Set(['hold', 'level', 'heading', 'off']);
const FLAG_NAMES = { liftoff: 'Liftoff', splashdown: 'Splashdown' };

const Flight = {
  running: false,
  // the ground update's aim mode (ghud.js and the 3F controls keep these): aiming a ground vehicle's guns, the aim
  // camera on, looking round freely (C held), the machine guns firing (Space, the MG button)
  groundAim: false, aimCam: false, freeLook: false, mgFiring: false,

  init(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pointers = new Map();
    this.stick = { v: 0, h: 0, r: 0 }; // touch joystick and roll buttons
    this.scale = 12;
    this.bindDom();
  },

  // ------------------------------------------------------------------ lifecycle
  // opts (multiplayer): { place: { e, z, yaw, catapult }, time, mp: { mode, solo, phase } }; place.air { alt, speed }:
  // start flying, that high over the spot at that speed with the gear up; keep: vessels to keep (other players' wrecks,
  // the Practice Battle's AI), as they are
  start(design, opts) {
    this.design = design;
    this.mp = (opts && opts.mp) || null;
    this.spawnOpts = opts || null;
    const parts = partsFromDesign(design.parts); // (with their depth, paint and what each is attached to)
    const adjAll = buildAdjacency(parts);
    const ctrl = findControlPart(parts);
    const keep = componentOf(ctrl.id, adjAll);
    const ps = parts.filter((p) => keep.has(p.id));
    for (const p of ps) if (p.att != null && !keep.has(p.att)) p.att = null; // its host was left behind
    const adj = new Map();
    for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
    const v = new Vessel(ps, adj, EARTH);
    v.name = design.name || (design.kind === 'tank' ? VEHICLE_KINDS.tank.name : 'Rocket');
    v.kind = VEHICLE_KINDS[design.kind] ? design.kind : 'rocket';
    v.stages = computeStages(ps, adj, ctrl.id);
    v.rebuildGroups();
    // each kind starts at its own site: the pad, the runway or the helipad
    const K = VEHICLE_KINDS[v.kind];
    // a plane on floats and no wheels starts on the water, nose out to sea
    const sea = v.kind === 'plane' && v.parts.some((p) => p.def.float) && !v.wheels.length;
    const P = opts && opts.place && !(sea && opts.place.soft) ? opts.place : null; // a spawn point: an airfield or a carrier's deck
    if (P) v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), K.launchRot, P.z, P.yaw || 0);
    else v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[sea ? 'bay' : K.site].east), K.launchRot, 0, sea ? Math.PI : 0);
    if (P && P.air) { // an air start: raised over the spot, flying along its nose, gear up
      const r = v.radius(), up = +P.air.alt || 0, sp = +P.air.speed || 0, f = v.axis(v.pilot.F.x, v.pilot.F.y, v.pilot.F.z);
      v.x += (v.x / r) * up; v.y += (v.y / r) * up; v.z += (v.z / r) * up;
      v.vx = f.x * sp; v.vy = f.y * sp; v.vz = f.z * sp;
      v.landed = false;
      if (v.hasRetract) { v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true; }
    }
    if (v.kind === 'heli') v.throttle = 0;
    this.launchCost = designCost(ps);
    if (!this.mp) { Career.spend(this.launchCost); Career.data.flights++; Career.save(); }
    const kept = opts && Array.isArray(opts.keep) ? opts.keep.filter((o) => o && o !== v && !o.dead) : [];
    this.resetState([v, ...kept], v, opts && opts.time != null ? opts.time : 0);
    if (P && P.catapult && v.kind === 'plane') this.armCatapult(v, P);
    const h = v.bounds.maxY - v.bounds.minY, w = v.bounds.maxX - v.bounds.minX;
    const tall = v.kind === 'plane' ? w : h, wide = v.kind === 'plane' ? h : w; // planes lie on their side
    this.scale = clamp(Math.min((innerHeight * 0.42) / tall, (innerWidth * 0.5) / wide), 1.5, 40);
    this.updateDvEstimate();
    this.updateHUD(true);
    if (!this.mp) this.save();
    $('#warp').hidden = !!this.mp;
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
    this.driven = 0; this.hoverSince = null; this.lastCheck = time;
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
    this.camAbs = this.absPos(active);
    this.camRel = { b: active.body, x: active.x, y: active.y, z: active.z };
    this.viewQ = this.viewFrame(active.x, active.y, active.z);
    this.viewRot = Math.PI / 2 - Math.atan2(active.y, active.x);
    this.machWas = 0;
    this.firing = false; this.mgFiring = false;
    this.spectate = null; // multiplayer: someone else's craft the camera follows after ours is lost
    this.catapult = null; this.wireCaught = false;
    Combat.reset(this);
    this.running = true;
    MapView.focusVessel();
    $('#btn-map').classList.remove('on'); document.body.classList.remove('mapping');
    $('#map-legend').hidden = true;
    $('#btn-center').hidden = true;
    this.syncSas();
    this.syncAwake();
    const silly = Silly.list.filter(([k]) => Silly.on(k)).map(([, name]) => name);
    if (silly.length) this.toast(`Silly settings on: ${silly.join(', ')}`);
  },

  stop() {
    this.running = false;
    Sound.engine(0, 0); Sound.wind(0);
    this.syncAwake();
  },

  revert() {
    if (this.mp) { MP.respawn(); return; }
    if (GroundAI.battle && GroundAI.revert(this)) return; // (a Practice Battle: back on its pad, the AI kept)
    Career.earn(this.launchCost);
    store.set('rss.flight', null);
    const place = this.design.kind === 'tank' ? GroundMode.soloPlace(this.design.kind) : null; // (Armour starts on its range: back there)
    this.start(this.design, place ? { place } : undefined);
  },

  // What a flight under way holds on to: the screen kept on, and the sound running. Paused or over, both are
  // let go, and the screen too once the craft is lost; out of sight the browser drops the lock (and Sound
  // sleeps), so it's taken again on the way back. (Multiplayer keeps the screen on for the room: MP.awake.)
  syncAwake() {
    Sound.setLive(this.running && !this.paused && !this.ended);
    const want = this.running && !this.paused && !this.ended && !this.destroyed && !document.hidden, L = this.wakeLock;
    if (!want) { if (L) { this.wakeLock = null; L.release().catch(() => {}); } return; }
    if (L || this.lockAsked || !navigator.wakeLock) return;
    try {
      this.lockAsked = true;
      navigator.wakeLock.request('screen').then((l) => {
        this.lockAsked = false; this.wakeLock = l;
        l.addEventListener('release', () => { if (this.wakeLock === l) this.wakeLock = null; });
        this.syncAwake(); // (let go at once if the flight paused or ended meanwhile)
      }).catch(() => { this.lockAsked = false; });
    } catch (e) { this.lockAsked = false; /* not available */ }
  },
  // Pausing (the menu, a recovered craft): the HUD is brought up to date once, then left alone until the flight
  // carries on.
  setPaused(on) {
    this.paused = on;
    if (on) { this.updatePrediction(); this.updateDvEstimate(); this.updateHUD(true); }
    this.syncAwake();
  },

  // ------------------------------------------------------------------ save / resume
  serialize() {
    const keep = this.vessels.filter((v) => (v.control || v === this.active) && !v.dead && !v.ai && !v.wreck && v.parts.length);
    return {
      v: 2, time: this.time, design: this.design, launchCost: this.launchCost,
      active: keep.indexOf(this.active), flags: this.flags, stats: this.stats,
      target: this.target ? this.target.id : null, scale: this.scale,
      vessels: keep.map((v) => v.serialize()),
    };
  },
  save() {
    if (this.mp || !this.running || this.ended || !this.active || !this.active.parts.length) return;
    if (this.destroyed && !this.vessels.some((v) => v.control && !v.dead && v !== this.active)) return;
    store.set('rss.flight', this.serialize());
  },
  restore(d) {
    this.mp = null; this.spawnOpts = null;
    $('#warp').hidden = false;
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
    return { x: b.x + v.x, y: b.y + v.y, z: v.z };
  },
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); },
  // The view's axes at a body-relative point: y up, x east, z north. Returns the sim -> view rotation.
  viewFrame(x, y, z) {
    const F = surfaceFrame(x, y, z);
    return qconj(qbasis(F.east, F.up, F.north));
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
    if (this.mp) { this.warpIdx = 0; this.updateHUD(true); return; } // everyone shares one clock
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
    if (i > PHYS_WARP_MAX && this.warpIdx <= PHYS_WARP_MAX) for (const v of this.vessels) v.av = v3();
    this.warpIdx = i;
    this.updateHUD(true);
  },

  setSas(mode) {
    const v = this.active;
    if (!v) return;
    if (mode === 'target' && !this.target) { this.toast('Pick a target on the map first'); return; }
    v.sas = v.sas === mode && mode !== 'hold' ? 'hold' : mode;
    v.holdPitch = v.holdBank = v.altHold = v.hdgHold = null; // each mode starts from where the craft is now
    if (v.kind === 'plane') this.toast({ hold: 'Autopilot: hold attitude', level: 'Autopilot: level flight, holding altitude', heading: 'Autopilot: holding heading and altitude (A/D turn)', off: 'Autopilot off: you fly it' }[v.sas]);
    this.syncSas();
  },
  // Planes get their own autopilot buttons; everything else gets the rocket set.
  syncSas() {
    const v = this.active, m = v ? v.sas : 'hold', plane = !!v && v.kind === 'plane';
    document.querySelectorAll('[data-sas]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.sas === m));
      b.hidden = plane ? !PLANE_SAS.has(b.dataset.sas) : !!b.dataset.plane;
    });
    $('#sas-bar').classList.toggle('plane', plane);
  },

  // Flaps in three steps; retractable gear up and down.
  cycleFlaps() {
    const v = this.active;
    if (!v || !v.hasFlaps) { this.toast('No flaps on this craft'); return; }
    v.flaps = v.flaps >= 1 ? 0 : v.flaps + 0.5;
    Sound.click();
    this.updateHUD(true);
  },
  toggleGear() {
    const v = this.active;
    if (!v || !v.hasRetract) { this.toast('No retractable gear on this craft'); return; }
    if (!v.gearUp && v.wheelsDown) { this.toast('Can’t raise the gear on the ground'); return; }
    v.gearUp = !v.gearUp;
    for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = v.gearUp;
    Sound.click();
    this.toast(v.gearUp ? 'Gear up' : 'Gear down');
    this.updateHUD(true);
  },
  // Over-stressed wings tear off and tumble away as debris (as do parts shot or knocked off), taking what's
  // attached to them along (the engines and stores on a wing), unless the craft itself hangs off them.
  // cause: 'g' (too much load), 'speed' (flutter, past a wing's speed limit), 'impact', or a hit.
  ripParts(v, parts, cause = 'g') {
    const ctrl = v.control;
    for (const p of parts) {
      const go = new Set([p.id]);
      for (const c of v.parts) if (c.att === p.id) { const br = [c, ...attachedTo(v.parts, [c])]; if (!br.includes(ctrl)) for (const q of br) go.add(q.id); }
      for (const id of go) for (const n of [...(v.adj.get(id) || [])]) if (!go.has(n)) { v.adj.get(id).delete(n); v.adj.get(n) && v.adj.get(n).delete(id); }
      const zs = partZs(p), vel = { x: v.vx, y: v.vy, z: v.vz };
      for (const z of zs) {
        const wp = v.toWorld(p.x, p.y, z);
        FX.sparks(v.body, wp, vel, 14 / zs.length);
        FX.puff(v.body, wp, vel, 8 / zs.length, '#cfd5dc');
      }
    }
    if (v === this.active) {
      const name = parts[0].def.name, at = v.overMach ? `Mach ${v.mach.toFixed(2)}` : `${Math.round(v.speed() * 3.6)} km/h`;
      this.toast(cause === 'g' ? `${name} torn off at ${v.gForce.toFixed(1)} g!` : cause === 'speed' ? `Flutter tore the ${name} off at ${at}!`
        : `${name} ${cause === 'impact' ? 'knocked' : 'shot'} off!`, 'warn');
      Sound.explode(); haptic([60, 40, 80]);
    }
    const pieces = v.splitComponents();
    for (const piece of pieces) { piece.isDebris = !piece.control; this.vessels.push(piece); }
    v.rebuildGroups();
    if (v === this.active && !v.control && ctrl) this.onDestroyed();
  },

  setTarget(b) {
    this.target = b && b !== this.active.body ? b : null;
    if (!this.target && this.active.sas === 'target') { this.active.sas = 'hold'; this.syncSas(); }
    this.toast(this.target ? `Target: ${this.target.name}` : 'Target cleared');
    this.updatePrediction();
    this.updateHUD(true);
  },

  switchTo(v) {
    if (!v || v === this.active || !v.control || v.ai || v.remote) return;
    if (this.mp && this.mp.mode === 'pvp') return; // one craft, one life
    this.active = v;
    this.destroyed = false;
    this.syncAwake();
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
      let dx = piece.x - v.x, dy = piece.y - v.y, dz = piece.z - v.z;
      const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      const mu = (piece.mass * v.mass) / (piece.mass + v.mass);
      const J = 2.2 * mu;
      piece.vx += dx * J / piece.mass; piece.vy += dy * J / piece.mass; piece.vz += dz * J / piece.mass;
      v.vx -= dx * J / v.mass; v.vy -= dy * J / v.mass; v.vz -= dz * J / v.mass;
      const tw = randDir();
      piece.av.x += tw.x * 0.08; piece.av.y += tw.y * 0.08; piece.av.z += tw.z * 0.08;
      this.vessels.push(piece);
    }
    const wp = v.toWorld(sep.x, sep.y, partZc(sep)), vel = { x: v.vx, y: v.vy, z: v.vz };
    FX.puff(v.body, wp, vel, 12, '#e8edf2');
    FX.sparks(v.body, wp, vel, 10);
    Sound.separate();
    if (Silly.on('hollywood')) { FX.explosion(v.body, wp, vel, 1.5, airDensity(v.body, v.altitude()) > 0.01); Sound.explode(); }
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
    const kv = cause === 'heat' ? 0.9 : 0.2;
    for (const p of parts) {
      for (const z of partZs(p)) FX.explosion(v.body, v.toWorld(p.x, p.y, z), { x: v.vx * kv, y: v.vy * kv, z: v.vz * kv }, Math.max(p.def.w, p.def.h), air); // (each of a pair)
      v.parts = v.parts.filter((q) => q !== p);
      for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id);
      v.adj.delete(p.id);
    }
    if (v === this.active || this.dist(this.absPos(v), this.camAbs) < 3000) { Sound.explode(); haptic([40, 30, 60]); }
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
    this.syncAwake();
    $('#flight-alert').hidden = true; // (the HUD stops updating once nothing is left)
    this.warpIdx = 0;
    if (this.catapult) this.catapult.state = 'done';
    if (this.mp && MP.onLocalDestroyed()) { this.updateHUD(true); return; }
    if (GroundAI.battle && GroundAI.onDestroyed(this)) return; // (the Practice Battle: its own respawn, keeping its AI)
    setTimeout(() => {
      if (!this.running || this.ended || !this.destroyed) return;
      const others = this.vessels.filter((x) => x.control && !x.dead && !x.ai && !x.remote && x !== this.active);
      if (!others.length) { this.ended = true; store.set('rss.flight', null); this.syncAwake(); }
      const acts = [
        { label: 'Back to hangar', onClick: () => App.toBuild() },
        { label: 'Revert to launch', primary: !others.length, onClick: () => this.revert() },
      ];
      if (others.length) acts.push({ label: `Switch to ${others[0].name}`, primary: true, onClick: () => this.switchTo(others[0]) });
      UI.modal({ kicker: 'Mission update', title: 'Vessel destroyed', body: this.summaryHTML(), actions: acts });
    }, Silly.on('ghostCam') ? 5000 : 1600); // leave time to enjoy the view
  },

  canRecover() {
    const v = this.active;
    return !this.mp && !GroundAI.battle && v && v.parts.length && (v.landed || v.splashed) && v.body === EARTH && v.speed() < 1.2 && this.time > 3; // (a Practice Battle's vehicles are free: nothing to recover)
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
    this.setPaused(true);
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
    if (this.mp) { this.openMpMenu(); return; }
    this.setPaused(true);
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
      onClose: () => { if (!this.ended) this.setPaused(false); },
    });
  },

  // Multiplayer: the world goes on while the menu is open.
  openMpMenu() {
    const acts = [{ label: 'Leave the room', onClick: () => MPUI.leave() }];
    if (this.mp.mode === 'sandbox') {
      acts.push({ label: 'Back to hangar', onClick: () => { MP.leaveFlight(); App.toBuild(); } });
      acts.push({ label: 'Respawn', onClick: () => MP.respawn() });
    }
    acts.push({ label: 'Resume', primary: true, onClick: () => {} });
    const what = this.mp.solo ? 'Test flight' : this.mp.mode === 'pvp' ? 'Battle' : 'Multiplayer sandbox';
    UI.modal({ kicker: `${what} · ${this.active.name}`, title: 'Menu', body: Flight.controlsHelp(), actions: acts });
  },

  controlsHelp() {
    return `<div class="help-grid">
      <div><kbd>W</kbd><kbd>S</kbd> / <kbd>↑</kbd><kbd>↓</kbd><span>Pitch: nose down / up (a car drives forward / back)</span></div>
      <div><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd><span>Rockets turn left / right; planes and helicopters roll; cars steer</span></div>
      <div><kbd>Q</kbd><kbd>E</kbd><span>Rockets roll; planes and helicopters yaw</span></div>
      <div><kbd>Shift</kbd><kbd>Ctrl</kbd><span>Throttle up / down</span></div>
      <div><kbd>Z</kbd><kbd>X</kbd><span>Full throttle / cut</span></div>
      <div><kbd>Space</kbd><span>Activate next stage</span></div>
      <div><kbd>1</kbd>–<kbd>6</kbd><span>Autopilot: hold, prograde, retrograde, radial out/in, target</span></div>
      <div><kbd>1</kbd>–<kbd>4</kbd><span>Plane autopilot: hold attitude, level (holds altitude), heading, off</span></div>
      <div><kbd>M</kbd><span>Map view (tap a planet to target it)</span></div>
      ${this.mp ? '' : '<div><kbd>,</kbd><kbd>.</kbd><span>Time warp down / up</span></div>'}
      <div><kbd>[</kbd><kbd>]</kbd><span>${this.mp ? 'After you are shot down: watch another player' : 'Switch between your vessels'}</span></div>
      <div><kbd>Wheel</kbd><span>Zoom (pinch on touch)</span></div>
      <div><kbd>B</kbd><span>Hold to brake on wheels (and pop the air brakes)</span></div>
      <div><kbd>F</kbd><kbd>G</kbd><span>Planes: flaps (three steps), retractable gear up / down</span></div>
      <div><kbd>C</kbd><span>Reset the camera (drag to look around)</span></div>
      <div><kbd>V</kbd><kbd>Tab</kbd><span>Fire (hold) / change weapon · <kbd>K</kbd> flares and chaff</span></div>
      ${this.mp ? '<div><kbd>L</kbd><span>Carrier catapult: launch</span></div><div><kbd>T</kbd><kbd>`</kbd><span>Chat · scoreboard (hold)</span></div>' : ''}
      <div><span class="tap">Tap a part</span><span>Toggle an engine, fire a separator, open a parachute</span></div>
    </div>`;
  },

  // ------------------------------------------------------------------ simulation
  update(rdt) {
    if (!this.running) return;
    this.frameN = (this.frameN || 0) + 1;
    const dt = Math.min(rdt, 0.05);
    this.readControls(dt);
    if (this.mp) MP.beforeUpdate(dt); // pose the other players' craft
    if (!this.paused) {
      if (this.mp) this.warpIdx = 0;
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
          if (v.remote || v.kin || v.wreck) continue; // other players' craft: their owners fly them (ground AI moves itself; wrecks stay put)
          if (v === this.active) { near.push(v); continue; }
          const d = this.dist(this.absPos(v), ap);
          if (d < NEAR_DIST || (v.control && !v.landed && v.altitude() < v.body.warpAlt)) near.push(v);
          else if (!v.landed) far.push(v);
        }
        // (frame times come in a hair over 1/60 s, 16.7 or 16.8 ms: a step may run up to 5% long rather than add a third)
        const n = Math.max(1, Math.ceil(total / (warp >= 4 ? PHYS_DT * 2 : PHYS_DT) - 0.05));
        const h = total / n;
        for (let i = 0; i < n; i++) this.physicsTick(h, near);
        for (const v of far) {
          const used = this.railsAdvance(v, total, false, t0);
          if (used < total - 1e-6 && !v.control) v.dead = true; // fell into an atmosphere out of sight
        }
        Combat.frame(this, dt * warp);
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
      if (this.mp) { MP.afterUpdate(); MP.syncMissiles(); }
    }
    const v = this.active;
    if (v && v.parts.length && !this.paused) {
      const maxT = v.parts.reduce((s, p) => s + (p.def.thrust || 0) * 1000, 0);
      const air = clamp(airDensity(v.body, v.altitude()) / 0.6, 0, 1);
      Sound.engine(maxT ? (v.thrust || 0) / maxT : 0, air);
      Sound.wind(clamp((v.dynP || 0) / 30000, 0, 1) + clamp((v.heatFlux || 0) / 2e8, 0, 1) + (this.destroyed ? 0 : 0.5 * smoothstep(0.97, 1.15, v.overspeed || 0))); // (and a fluttering wing's roar)
      this.soundBarrier(v);
      // stall warning horn
      const stall = v.aircraft && v.aoa != null && !v.wheelsDown && v.airspeed > 10 && v.aoa > (v.stallAoA - 0.03 * v.flaps) * 0.9;
      this.stallBeep = stall ? (this.stallBeep || 0) - rdt : 0;
      if (stall && this.stallBeep <= 0) { Sound.beep(880); this.stallBeep = 0.35; }
      // structure: a fast high pip for too many g, a low rattle for too fast, quicker the closer to breaking
      const st = this.structAlert(v);
      this.structBeep = st ? (this.structBeep || 0) - rdt : 0;
      if (st && this.structBeep <= 0) {
        Sound.beep(st.kind === 'g' ? 1320 : 520);
        this.structBeep = st.level > 1 ? 0.12 : 0.3;
        if (st.level > 1) haptic(25);
      }
    } else { Sound.engine(0, 0); Sound.wind(0); }

    if (!this.paused) { // (nothing changes while paused: setPaused brought these up to date)
      this.predTimer -= rdt;
      if (this.predTimer <= 0) { this.predTimer = this.mapMode ? 0.12 : 0.3; this.updatePrediction(); }
      this.dvTimer -= rdt;
      if (this.dvTimer <= 0) { this.dvTimer = 0.5; this.updateDvEstimate(); }
      this.hudTimer -= rdt;
      if (this.hudTimer <= 0) { this.hudTimer = 0.08; this.updateHUD(); }
    }
    this.saveTimer -= rdt;
    if (this.saveTimer <= 0) { this.saveTimer = 10; this.save(); }
  },

  // The stick: W/S (↑/↓), A/D (←/→) and Q/E, plus the touch joystick and roll buttons.
  readControls(dt) {
    const k = this.keys, key = (...c) => c.some((x) => k.has(x)) ? 1 : 0;
    const v = this.active;
    if (!v) return;
    const st = this.stick;
    v.ctl.v = clamp(key('KeyW', 'ArrowUp') - key('KeyS', 'ArrowDown') + st.v, -1, 1);
    v.ctl.h = clamp(key('KeyD', 'ArrowRight') - key('KeyA', 'ArrowLeft') + st.h, -1, 1);
    v.ctl.r = clamp(key('KeyE') - key('KeyQ') + st.r, -1, 1);
    if (Silly.on('drunk')) { // the stick wanders off on its own, in waves
      const t = this.time, w = Math.max(0, Math.sin(t * 0.23)) * 0.6;
      v.ctl.v = clamp(v.ctl.v + w * Math.sin(t * 1.1), -1, 1);
      v.ctl.h = clamp(v.ctl.h + w * Math.sin(t * 0.7 + 2), -1, 1);
      v.ctl.r = clamp(v.ctl.r + w * 0.6 * Math.sin(t * 0.9 + 4), -1, 1);
    }
    const dT = key('ShiftLeft', 'ShiftRight', 'PageUp') - key('ControlLeft', 'ControlRight', 'PageDown');
    if (dT) this.setThrottle(v.throttle + dT * dt * 0.9);
    v.brake = k.has('KeyB') || this.touchBrake;
    this.firing = k.has('KeyV') || !!this.touchFire;
  },

  // Breaking the sound barrier: a boom when the craft first passes Mach 1 in thick enough air.
  soundBarrier(v) {
    const m = effectMach(v), air = airDensity(v.body, v.altitude());
    if (m >= 1 && this.machWas < 1 && air > 0.05 && this.warpIdx <= PHYS_WARP_MAX) {
      Sound.boom(clamp(air / 1.2, 0.3, 1));
      haptic([30, 20, 50]);
      this.boomAt = performance.now();
      // the shock wave: a ring racing outwards and a burst of condensation
      const pos = { x: v.x, y: v.y, z: v.z }, vel = { x: v.vx * 0.9, y: v.vy * 0.9, z: v.vz * 0.9 }, L = Math.max(v.width, v.bounds.maxY - v.bounds.minY, 3);
      FX.add({ kind: 'ring', b: v.body, ...pos, vx: vel.x, vy: vel.y, vz: vel.z, max: 0.7, size: L * 0.6, grow: L * 7, color: '#eef6ff', alpha: 0.9 });
      FX.puff(v.body, pos, vel, 22, '#f4f8ff');
      if (v.mach < 1) { if (!this.flags.fakeBoom) this.toast('Sound barrier broken! Allegedly.'); this.flags.fakeBoom = true; }
      else { if (!this.flags.machOne) this.toast('Sound barrier broken!', 'achievement'); this.flags.machOne = true; }
    }
    if (m < 0.97 || m >= 1) this.machWas = m;
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
    // other players' craft coast between snapshots, so rounds and missiles meet them where they are now
    if (this.mp) for (const v of this.vessels) if (v.remote && !v.wreck) { v.x += v.vx * h; v.y += v.vy * h; v.z += v.vz * h; }
    if (this.catapult) this.catapultStep(h);
    this.arrestStep(h);
    Combat.step(h, this);
    this.time += h;
  },

  checkSOI(v, t) {
    const b = v.body;
    for (const c of b.children) {
      const cp = childRel(c, t);
      const dx = v.x - cp.x, dy = v.y - cp.y;
      if (dx * dx + dy * dy + v.z * v.z < c.soi * c.soi) {
        const cv = childRelVel(c, t);
        v.x = dx; v.y = dy; v.vx -= cv.x; v.vy -= cv.y; v.body = c;
        if (v === this.active) { this.toast(`Entered ${c.name}’s sphere of influence`); this.prediction = null; }
        return true;
      }
    }
    if (b.parent && v.radius() > b.soi) {
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
      if (v === a || v.dead || v.remote || v.kin || v.wreck) continue; // (ground AI and wrecks stay where they are)
      const u = this.railsAdvance(v, used, false, t0);
      if (u < used - 1e-6 && !v.control) v.dead = true;
    }
    this.time = t0 + used;
  },

  // On-rails Kepler propagation with event detection (atmosphere/surface, SOI changes).
  railsAdvance(v, T, isActive, t0) {
    if (v.landed && v.speed() < 0.2) return T;
    v.av = v3();
    let done = 0;
    const put = (s) => { v.x = s.x; v.y = s.y; v.z = s.z; v.vx = s.vx; v.vy = s.vy; v.vz = s.vz; };
    for (let guard = 0; guard < 400 && done < T - 1e-9; guard++) {
      const body = v.body;
      const start = { x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz };
      const o = orbitOf(start, body.mu);
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
        const r = Math.hypot(s.x, s.y, s.z);
        if (r < minR) return 'low';
        if (body.parent && r > body.soi) return 'out';
        for (const c of body.children) {
          if (Math.abs(r - c.orbitRadius) > c.soi) continue;
          const cp = childRel(c, tBase + tt);
          if ((s.x - cp.x) ** 2 + (s.y - cp.y) ** 2 + s.z * s.z < c.soi * c.soi) return 'in';
        }
        return null;
      };
      const speed = Math.hypot(start.vx, start.vy, start.vz);
      let maxChunk = 120;
      for (const c of body.children) maxChunk = Math.min(maxChunk, (c.soi * 0.5) / (speed + c.orbitSpeed + 1));
      let elapsed = 0, hit = null;
      const remaining = T - done;
      while (elapsed < remaining - 1e-9) {
        const r = v.radius();
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
          put(stateFn(hi));
          elapsed = hi; hit = ev;
          break;
        }
        put(s);
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
      if (v === a || v.control || v.remote) return true;
      return this.dist(this.absPos(v), ap) < 150000;
    });
  },

  // ------------------------------------------------------------------ carriers
  // A catapult launch: the craft is held on the deck until LAUNCH, then the shuttle throws it along the
  // catapult track to `speed` (about 3 g) and lets go at the bow.
  armCatapult(v, P) {
    const F0 = surfaceFrame(v.x, v.y, v.z), c = Math.cos(P.yaw || 0), s = -Math.sin(P.yaw || 0);
    const dir = norm3(v3(F0.east.x * c + F0.north.x * s, F0.east.y * c + F0.north.y * s, F0.east.z * c + F0.north.z * s));
    const L = Math.max(30, P.catapult.length), sp = P.catapult.speed;
    this.catapult = { v, state: 'hold', x: v.x, y: v.y, z: v.z, q: quat(v.q.w, v.q.x, v.q.y, v.q.z), dir, length: L, speed: sp, a: (sp * sp) / (2 * L), s: 0, u: 0 };
  },
  launchCatapult() {
    const C = this.catapult;
    if (!C || C.state !== 'hold' || this.destroyed || C.v !== this.active) return;
    if (this.active.throttle < 0.5 || !this.active.parts.some((p) => p.def.thrust && p.active)) { this.toast('Engines on and throttle up first (Space, then Z)'); return; }
    C.state = 'shot';
    Sound.burst(0.5, 300, 0.6, 'lowpass'); haptic([40, 30, 90]);
    this.updateHUD(true);
  },
  catapultStep(h) {
    const C = this.catapult, v = this.active;
    if (C.state === 'done') return;
    if (v !== C.v || v.dead || !v.parts.length || this.destroyed) { C.state = 'done'; this.updateHUD(true); return; }
    if (C.state === 'shot') { C.u = Math.min(C.speed, C.u + C.a * h); C.s = Math.min(C.length, C.s + C.u * h); }
    const d = C.dir;
    v.x = C.x + d.x * C.s; v.y = C.y + d.y * C.s; v.z = C.z + d.z * C.s;
    v.vx = d.x * C.u; v.vy = d.y * C.u; v.vz = d.z * C.u;
    v.q = quat(C.q.w, C.q.x, C.q.y, C.q.z); v.av = v3();
    if (C.state === 'shot' && C.s >= C.length) { C.state = 'done'; v.landed = false; this.toast('Off the catapult: climb!'); this.updateHUD(true); }
  },
  // Landing on a deck: with the throttle back, the arrestor wires catch the plane and stop it in about 100 m.
  arrestStep(h) {
    const v = this.active;
    if (!v || v.kind !== 'plane' || !v.wheelsDown || v.body !== EARTH || (this.catapult && this.catapult.state !== 'done')) { if (v && !v.wheelsDown) this.wireCaught = false; return; }
    const L = v.surfaceSpot(), dk = Terrain.deckAt(v.body, L.a, L.z);
    if (dk !== dk || v.throttle > 0.35) return;
    const sp = Math.hypot(v.vx, v.vy, v.vz);
    if (sp < 2) return;
    const k = Math.max(0, 1 - (26 * h) / sp);
    v.vx *= k; v.vy *= k; v.vz *= k;
    if (!this.wireCaught && sp > 15) { this.wireCaught = true; this.toast('Wire caught!'); Sound.click(); haptic(30); }
  },

  award(flag) {
    if (this.flags[flag]) return;
    this.flags[flag] = true;
    const done = this.mp ? [] : Career.onFlag(flag);
    for (const m of done) {
      this.toast(Career.sandbox ? m.title : `${m.title} · +${money(m.reward)}`, 'achievement');
      Sound.chime();
    }
    if (!done.length && FLAG_NAMES[flag]) this.toast(FLAG_NAMES[flag], 'achievement');
  },

  // A craft's height over the ground below, worked out once a frame: the milestones, engine dust, rotor wash,
  // the HUD and its hints all ask. (Moving or turning the craft, changing its shape or working its gear asks
  // the ground again.)
  groundAlt(v) {
    const m = v._gAlt || (v._gAlt = {}), q = v.q;
    if (m.n !== this.frameN || m.x !== v.x || m.y !== v.y || m.z !== v.z || m.qw !== q.w || m.qx !== q.x || m.qy !== q.y || m.qz !== q.z
      || m.com !== v.com || m.hull !== v.hull || m.wheels !== v.wheelPts || m.gear !== v.gearUp || m.body !== v.body) {
      m.n = this.frameN; m.x = v.x; m.y = v.y; m.z = v.z; m.qw = q.w; m.qx = q.x; m.qy = q.y; m.qz = q.z;
      m.com = v.com; m.hull = v.hull; m.wheels = v.wheelPts; m.gear = v.gearUp; m.body = v.body;
      m.h = v.groundAltitude();
    }
    return m.h;
  },

  checkMilestones() {
    const v = this.active;
    if (!v || !v.parts.length || this.destroyed) return;
    const b = v.body, alt = v.altitude(), sp = v.speed();
    const ap = this.absPos(v), ep = bodyPos(EARTH, this.time);
    this.stats.maxAlt = Math.max(this.stats.maxAlt, Math.hypot(ap.x - ep.x, ap.y - ep.y, ap.z) - EARTH.radius);
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
    // planes, cars and helicopters
    const dtm = Math.max(0, this.time - (this.lastCheck ?? this.time));
    this.lastCheck = this.time;
    if (b === EARTH && v.control) {
      const ga = this.groundAlt(v), vs = v.vSpeed();
      if (v.kind === 'plane') {
        if (!v.wheelsDown && !v.onFloats && ga > 10 && sp > 30) this.award('takeoff');
        if (alt > 8000 && v.lift > 0.3 * v.mass * G0) this.award('flyHigh');
        const east = -wrapAngle(Math.atan2(v.y, v.x) - EARTH.padAngle) * EARTH.radius, north = Math.asin(clamp(v.z / v.radius(), -1, 1)) * EARTH.radius;
        if (this.flags.takeoff && settled && east > EARTH.runway.from && east < EARTH.runway.to && Math.abs(north) < 40) this.award('runwayLanding');
      }
      if (v.mach >= 1 && alt < 15000 && v.parts.some((p) => p.def.air && p.firing > 0)) this.award('supersonic');
      if (v.kind === 'plane' && v.mach >= 2) this.award('mach2');
      if (v.kind === 'plane' && this.flags.takeoff && v.onFloats && v.splashed && settled) this.award('seaplane');
      if (v.kind === 'heli' && ga > 20 && Math.abs(vs) < 2 && sp < 5) {
        if (this.hoverSince == null) this.hoverSince = this.time;
        if (this.time - this.hoverSince >= 10) this.award('hover');
      } else this.hoverSince = null;
      if (isGround(v.kind) && v.wheelsDown && sp > 0.5) {
        this.driven += sp * dtm;
        if (this.driven > 1000) this.award('drive1k');
      }
    }
    if (settled) for (const p of v.parts) if (p.def.chute && p.deployed > 0 && !p.used) p.used = true; // canopy collapses
  },

  updatePrediction() {
    const v = this.active;
    if (!v || !v.parts.length) { this.prediction = null; return; }
    this.prediction = predictTrajectory(v.body, { x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz }, this.time, 4);
    this.approach = this.target ? closestApproach(this.prediction, this.target) : null;
    this.window = null;
    const t = this.target;
    if (t && t.parent && !v.landed) {
      const o = this.prediction[0].o;
      // phase angles only make sense for an orbit close to the planets' plane
      if (t.parent === v.body && !o.degenerate && o.e < 0.5 && o.incl < 0.35 && Math.sign(o.dir) === Math.sign(t.orbitDir)) {
        const r = v.radius();
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
      for (const e of v.parts) {
        if (!e.firing) continue;
        if (e.def.air) { if (e.def.air.kind === 'rotor' && v === this.active) this.rotorWash(v, e, dt); continue; }
        const nz = nozzleOf(e.def), ax = partAxis(e), dir = v.axis(ax.x, ax.y, 0); // dir: the way the engine pushes
        if (rho > 0.01 || e.def.solid) {
          const smoky = e.def.solid ? 2.2 : e.def.plume === 'hydro' || e.def.plume === 'ion' || e.def.plume === 'nuclear' ? 0.35 : 1;
          e._emit = (e._emit || 0) + 22 * e.firing * Math.max(e.def.w, 1) * smoky * Math.min(1, rho * 2 + (e.def.solid ? 0.3 : 0)) * rate * dt;
          const zs = partZs(e); // (from the engine's own depth; a pair takes turns)
          while (e._emit >= 1) {
            e._emit -= 1;
            const np = partPt(e, 0, nz.y - e.def.w * 0.6), wp = v.toWorld(np.x, np.y, zs[(e._puff ^= 1) % zs.length]);
            const sp = 25 + Math.random() * 25, j = randDir(), js = Math.random() * 5;
            FX.add({ kind: 'smoke', b: v.body, x: wp.x, y: wp.y, z: wp.z,
              vx: v.vx - dir.x * sp + j.x * js, vy: v.vy - dir.y * sp + j.y * js, vz: v.vz - dir.z * sp + j.z * js,
              max: 2.2 + Math.random() * 2.6, size: Math.max(e.def.w, 1) * 0.7, grow: Math.max(e.def.w, 1) * 3.4, color: e.def.solid ? '#e9e6e0' : '#d9dde2', alpha: 0.34 });
          }
        }
        // ground interaction: dust or spray kicked up near the surface
        if (v === this.active && Settings.high) {
          const ga = this.groundAlt(v);
          if (ga < 40 && ga > -5 && e.firing > 0.2) {
            e._dust = (e._dust || 0) + 30 * e.firing * (1 - ga / 40) * dt;
            e._dust = this.groundDust(v, e._dust, 8, 18, 3, 1, 0.45);
          }
        }
      }
      // condensation streaks from the wingtips when pulling hard in moist low air
      if (v.aircraft && v.mainWing && v.gForce > 3 && v.airspeed > 70 && rho > 0.3 && Settings.high && !v.wheelsDown) {
        const half = v.mainWing.def.wing.span / 2, k = clamp((v.gForce - 3) / 4, 0, 1);
        for (const s of [-1, 1]) {
          if (Math.random() > 0.35 + 0.6 * k) continue;
          const wp = v.toWorld(v.mainWing.x, v.mainWing.y, partZc(v.mainWing) + s * half * 0.97);
          FX.add({ kind: 'smoke', b: v.body, x: wp.x, y: wp.y, z: wp.z, vx: v.vx * 0.97, vy: v.vy * 0.97, vz: v.vz * 0.97,
            max: 0.5 + 0.6 * k, size: 0.25, grow: 0.9, color: '#f4f8ff', alpha: 0.5 + 0.35 * k });
        }
      }
      // reentry plasma trail
      if (v.heatFlux > 4e7 && Settings.high) {
        const k = clamp((v.heatFlux - 4e7) / 1.5e8, 0, 1);
        if (Math.random() < 0.6 * k + 0.2) {
          const sp = v.speed() || 1;
          FX.add({ kind: 'plasma', b: v.body, x: v.x - (v.vx / sp) * 2, y: v.y - (v.vy / sp) * 2, z: v.z - (v.vz / sp) * 2, vx: v.vx * 0.85, vy: v.vy * 0.85, vz: v.vz * 0.85,
            max: 0.4 + Math.random() * 0.4, size: Math.max(v.width, 1.5) * 0.6, grow: Math.max(v.width, 1.5), color: '#ff9a4a', alpha: 0.5 * k });
        }
      }
      if (v.splashed && !v._splashFx) {
        v._splashFx = true;
        const L = v.surfaceSpot();
        FX.splash(v.body, { x: v.x, y: v.y, z: v.z }, Terrain.normalAt(v.body, L.a, L.z), 30);
      }
      if (!v.splashed) v._splashFx = false;
    }
  },

  // Dust or spray thrown sideways along the ground under a craft; returns the unspent fraction of `count`.
  groundDust(v, count, s0, s1, lift, size, alpha) {
    if (count < 1) return count;
    const b = v.body, L = v.surfaceSpot(), n = Terrain.normalAt(b, L.a, L.z), water = Terrain.waterAt(b, L.a, L.z);
    const base = b.radius + Terrain.surfaceAt(b, L.a, L.z), r = v.radius();
    const px = (v.x / r) * base, py = (v.y / r) * base, pz = (v.z / r) * base;
    const color = water ? '#eaf4ff' : clearZone(b, L.a) && Math.abs(L.z) < 300 ? '#c9ccd1' : b.colors.surface;
    while (count >= 1) {
      count -= 1;
      const d = randDir(), dn = dot3(d, n), l = Math.hypot(d.x - n.x * dn, d.y - n.y * dn, d.z - n.z * dn) || 1, s = s0 + Math.random() * s1;
      const tx = (d.x - n.x * dn) / l, ty = (d.y - n.y * dn) / l, tz = (d.z - n.z * dn) / l;
      FX.add({ kind: 'smoke', b, x: px, y: py, z: pz, vx: v.vx + tx * s + n.x * lift, vy: v.vy + ty * s + n.y * lift, vz: v.vz + tz * s + n.z * lift,
        max: 1.2 + Math.random() * 1.5, size: size, grow: 4.5 * size, color, alpha });
    }
    return count;
  },

  // Downwash from a helicopter rotor near the ground kicks up dust or spray.
  rotorWash(v, e, dt) {
    if (!Settings.high) return;
    const ga = this.groundAlt(v);
    if (ga > 15 || ga < -2 || e.firing < 0.2) return;
    e._dust = (e._dust || 0) + 26 * e.firing * (1 - ga / 15) * dt;
    e._dust = this.groundDust(v, e._dust, 6, 12, 1.5, 0.8, 0.4);
  },

  // ------------------------------------------------------------------ input
  bindDom() {
    const c = this.canvas;
    addEventListener('keydown', (e) => {
      if (App.scene !== 'flight' || UI.modalOpen) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // typing in the chat
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyV') this.fireTap = true;
      const sasKeys = this.active && this.active.kind === 'plane' ? PLANE_SAS_KEYS : SAS_KEYS;
      if (sasKeys[e.code]) { this.setSas(sasKeys[e.code]); return; }
      switch (e.code) {
        case 'Space': this.stage(); break;
        case 'KeyM': this.toggleMap(); break;
        case 'KeyN': if (this.mapMode) this.setMapView(GlobeView.active ? 'system' : 'globe'); break;
        case 'Comma': this.setWarp(this.warpIdx - 1); break;
        case 'Period': this.setWarp(this.warpIdx + 1); break;
        case 'KeyZ': this.setThrottle(1); break;
        case 'KeyX': this.setThrottle(0); break;
        case 'BracketLeft': case 'BracketRight': this.cycleVessel(e.code === 'BracketRight' ? 1 : -1); break;
        case 'Tab': Combat.cycle(this, e.shiftKey ? -1 : 1); this.updateHUD(true); break;
        case 'Escape': case 'KeyP': this.openMenu(); break;
        case 'KeyR': if (this.canRecover()) this.recover(); break;
        case 'KeyC': if (App.use3D()) Render3D.resetCamera(); break;
        case 'KeyF': this.cycleFlaps(); break;
        case 'KeyG': this.toggleGear(); break;
        case 'KeyK': this.countermeasures(); break;
        case 'KeyL': this.launchCatapult(); break;
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); Object.assign(this.stick, { v: 0, h: 0, r: 0 }); this.touchBrake = false; this.touchFire = false; });
    document.addEventListener('visibilitychange', () => { if (this.running) this.syncAwake(); });

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
        if (this.mapMode) this.mapPan(now.cx - this.pinch.cx, now.cy - this.pinch.cy);
        this.pinch = now;
      } else if (this.pointers.size === 1 && this.mapMode) this.mapPan(dx, dy);
      else if (this.pointers.size === 1 && App.use3D()) Render3D.orbitBy(dx, dy);
    });
    c.addEventListener('dblclick', () => { if (App.scene === 'flight' && !this.mapMode && App.use3D()) Render3D.resetCamera(); });
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
      const on = (e) => { e.preventDefault(); btn.setPointerCapture && btn.setPointerCapture(e.pointerId); this.stick.r = val; btn.classList.add('held'); };
      const off = () => { if (this.stick.r === val) this.stick.r = 0; btn.classList.remove('held'); };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('lostpointercapture', off);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold($('#rot-left'), -1);
    hold($('#rot-right'), 1);
    // the flight stick: drag the knob; up is W (nose down, drive forward), right is D
    const joy = $('#joy'), knob = joy.querySelector('.joy-knob');
    let joyId = null;
    const joyMove = (e) => {
      const r = joy.getBoundingClientRect(), R = r.width * 0.36;
      let dx = (e.clientX - (r.left + r.width / 2)) / R, dy = (e.clientY - (r.top + r.height / 2)) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
      const dead = (x) => (Math.abs(x) < 0.12 ? 0 : (x - Math.sign(x) * 0.12) / 0.88);
      this.stick.h = dead(dx); this.stick.v = dead(-dy);
    };
    const joyOff = () => { joyId = null; this.stick.h = 0; this.stick.v = 0; knob.style.transform = ''; joy.classList.remove('held'); };
    joy.addEventListener('pointerdown', (e) => { e.preventDefault(); joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joy.classList.add('held'); joyMove(e); });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) joy.addEventListener(ev, (e) => { if (e.pointerId === joyId) joyOff(); });
    joy.addEventListener('contextmenu', (e) => e.preventDefault());
    const brake = $('#btn-brake');
    const brakeOff = () => { this.touchBrake = false; brake.classList.remove('held'); };
    brake.addEventListener('pointerdown', (e) => { e.preventDefault(); brake.setPointerCapture && brake.setPointerCapture(e.pointerId); this.touchBrake = true; brake.classList.add('held'); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) brake.addEventListener(ev, brakeOff);
    brake.addEventListener('contextmenu', (e) => e.preventDefault());
    // weapons: hold FIRE, tap the chip to change weapon
    const fire = $('#btn-fire');
    const fireOff = () => { this.touchFire = false; fire.classList.remove('held'); };
    fire.addEventListener('pointerdown', (e) => { e.preventDefault(); fire.setPointerCapture && fire.setPointerCapture(e.pointerId); this.touchFire = true; this.fireTap = true; fire.classList.add('held'); haptic(10); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) fire.addEventListener(ev, fireOff);
    fire.addEventListener('contextmenu', (e) => e.preventDefault());
    $('#btn-weapon').addEventListener('click', () => { Combat.cycle(this); this.updateHUD(true); });
    $('#btn-cm').addEventListener('click', () => this.countermeasures());
    $('#btn-catapult').addEventListener('click', () => this.launchCatapult());
    $('#btn-stage').addEventListener('click', () => this.stage());
    $('#btn-flaps').addEventListener('click', () => this.cycleFlaps());
    $('#btn-gear').addEventListener('click', () => this.toggleGear());
    $('#btn-map').addEventListener('click', () => this.toggleMap());
    $('#btn-menu').addEventListener('click', () => this.openMenu());
    $('#btn-recover').addEventListener('click', () => this.recover());
    $('#warp-up').addEventListener('click', () => this.setWarp(this.warpIdx + 1));
    $('#warp-down').addEventListener('click', () => this.setWarp(this.warpIdx - 1));
    $('#warp-label').addEventListener('click', () => this.setWarp(0));
    $('#btn-tmax').addEventListener('click', () => this.setThrottle(1));
    $('#btn-tcut').addEventListener('click', () => this.setThrottle(0));
    $('#btn-center').addEventListener('click', () => { if (GlobeView.active) GlobeView.center(); else { MapView.focusVessel(); MapView.fit(this); MapView.focusVessel(); } });
    $('#btn-mapview').addEventListener('click', () => this.setMapView(GlobeView.active ? 'system' : 'globe'));
    document.querySelectorAll('[data-sas]').forEach((b) => b.addEventListener('click', () => this.setSas(b.dataset.sas)));
    const track = $('#throttle-track');
    const setFromY = (e) => { const r = track.getBoundingClientRect(); this.setThrottle(1 - (e.clientY - r.top) / r.height); };
    track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); setFromY(e); this.dragThrottle = true; });
    track.addEventListener('pointermove', (e) => { if (this.dragThrottle) setFromY(e); });
    track.addEventListener('pointerup', () => { this.dragThrottle = false; });
    track.addEventListener('pointercancel', () => { this.dragThrottle = false; });
  },

  countermeasures() {
    if (this.destroyed || !this.active) return;
    if (Combat.countermeasures(this.active, this)) this.updateHUD(true);
  },

  cycleVessel(dir) {
    if (this.mp && (this.destroyed || this.mp.mode === 'pvp')) return; // (spectating: mpui.js)
    const list = this.vessels.filter((v) => v.control && !v.dead && !v.ai && !v.remote);
    if (list.length < 2) { this.toast('No other vessels to switch to'); return; }
    const i = list.indexOf(this.active);
    this.switchTo(list[(i + dir + list.length) % list.length]);
  },

  pinchInfo() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  },

  zoomBy(f, cx, cy) {
    if (this.mapMode) { if (GlobeView.active) GlobeView.zoom(f); else MapView.zoom(f, cx, cy); } else this.scale = clamp(this.scale * f, 0.00005, 80);
  },

  toggleMap() {
    this.mapMode = !this.mapMode;
    if (this.mapMode) { this.updatePrediction(); MapView.fit(this); GlobeView.open(this); }
    $('#btn-map').classList.toggle('on', this.mapMode);
    document.body.classList.toggle('mapping', this.mapMode); // (the map keeps the HUD's blur: style.css)
    $('#map-legend').hidden = !this.mapMode;
    $('#btn-center').hidden = !this.mapMode;
    this.syncMapView();
  },
  // The map has two views: the globe of the planet you're at (3D) and the whole solar system (flat).
  setMapView(m) {
    GlobeView.setMode(m, this);
    this.syncMapView();
  },
  syncMapView() {
    const globe = this.mapMode && GlobeView.active && App.use3D();
    if (this.mapMode && GlobeView.active && !App.use3D()) GlobeView.mode = 'system'; // the globe needs WebGL
    $('#btn-mapview').hidden = !this.mapMode || !App.use3D();
    $('#btn-mapview').textContent = globe ? 'System' : 'Globe';
    $('#map-legend').classList.toggle('globe', globe);
  },
  mapPan(dx, dy) { if (GlobeView.active) GlobeView.drag(dx, dy); else MapView.pan(dx, dy); },

  tapAt(cx, cy) {
    const v = this.active;
    if (!v || !v.parts.length) return;
    if (this.mapMode) {
      if (GlobeView.active) return;
      const hit = MapView.hit(this, cx, cy);
      if (!hit) return;
      if (hit.vessel) { this.switchTo(hit.vessel); return; }
      const b = hit.body;
      if (b === this.target) { this.setTarget(null); return; }
      MapView.focusBody(b, this);
      if (b !== v.body) this.setTarget(b);
      return;
    }
    if (this.destroyed) { if (this.mp && !this.mp.solo && MP.pvp) MPUI.spectate(1); return; } // (shot down: a tap watches the next player)
    if (App.use3D()) {
      const hit = Render3D.pickPart(cx, cy);
      if (!hit || !hit.part) return;
      if (hit.vessel && hit.vessel !== v) { if (hit.vessel.control) this.switchTo(hit.vessel); return; }
      this.usePart(v, hit.part);
      return;
    }
    const W = innerWidth, H = innerHeight;
    const dx = (cx - W / 2) / this.scale, dy = -(cy - H / 2) / this.scale;
    const c = Math.cos(-this.viewRot), s = Math.sin(-this.viewRot);
    const wx = c * dx - s * dy, wy = s * dx + c * dy;
    const pad = Math.max(0.25, 14 / this.scale);
    for (const ves of [v, ...this.vessels.filter((x) => x !== v)]) {
      const bp = bodyPos(ves.body, this.time);
      const lp = ves.toLocal(this.camAbs.x + wx - bp.x, this.camAbs.y + wy - bp.y, ves.z);
      const p = ves.hitTest(lp.x, lp.y, pad);
      if (!p) continue;
      if (ves !== v) { if (ves.control) this.switchTo(ves); return; }
      this.usePart(v, p);
      return;
    }
  },

  usePart(v, p) {
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

  hint() {
    if (!Settings.get('hints')) return '';
    const v = this.active, b = v.body;
    if (this.destroyed) return '';
    const o = this.prediction && this.prediction[0] && this.prediction[0].o;
    const alt = v.altitude();
    if (v.kind !== 'rocket' && b === EARTH) return this.vehicleHint(v);
    if (b === EARTH) {
      if (v.stageIdx === 0 && v.landed && this.time < 20) return 'Tap STAGE (Space) to light the engines.';
      const lean = Math.PI / 2 - v.attitude().pitch;
      if (!this.flags.space && alt < 2500 && v.thrust > 0) return 'Climb straight up for now.';
      if (!this.flags.space && alt < 22000 && v.thrust > 0 && lean < 0.35) return isTouch ? 'Push the stick right to lean east, toward 45°, and build sideways speed.' : 'Lean east with D toward 45° to build sideways speed.';
      if (o && !o.degenerate && o.ra - EARTH.radius > 34000 && o.rp < EARTH.radius + 30000 && alt < 30000 && v.thrust > 0)
        return 'Apoapsis is above the air. Cut the throttle (X) and coast up.';
      if (o && !o.degenerate && o.e < 1 && o.rp < EARTH.radius + 30000 && alt > 28000 && v.thrust === 0 && !v.landed)
        return 'Coast to apoapsis, press PRO (2) and burn until periapsis passes 30 km.';
      if (o && !o.degenerate && o.e < 1 && o.rp > EARTH.radius + 30000 && !this.flags['soi:moon'] && !this.target)
        return 'In orbit! Open the map (M) and tap the Moon to target it.';
      if (this.target && this.window && this.window.wait > 120) return `Warp ahead: the ${this.target.name} transfer window opens in ${fmt.duration(this.window.wait)}.`;
      if (this.target && this.window && this.window.wait <= 120 && !(this.approach && this.approach.encounter)) return 'Window open: burn prograde until the map shows an encounter.';
      const chute = v.parts.find((p) => p.def.chute && !p.deployed && !p.used);
      if (chute && alt < 9000 && (v.speed() < 250 || (v.dynP || 0) < 12000) && !v.landed && v.vSpeed() < 0) return 'Deploy the parachute now (STAGE).';
      if (this.canRecover()) return 'Safely down. Tap Recover to finish the mission.';
    }
    if (b !== EARTH && !b.star && v.landed && this.flags[`land:${b.id}`]) return `You landed on ${b.name}. Plan your trip home from the map.`;
    if (b !== EARTH && !b.star && o && !o.degenerate && o.e >= 1 && !v.landed) return `Burn retrograde (3) near periapsis to be captured by ${b.name}.`;
    return '';
  },

  vehicleHint(v) {
    const sp = v.speed(), ga = this.groundAlt(v), started = v.parts.some((p) => p.def.thrust && p.active);
    if (this.canRecover() && this.stats.maxSpeed > 8) return 'Safely stopped. Tap Recover to finish, or carry on.';
    if (v.kind === 'plane' && this.catapult && this.catapult.state === 'hold') {
      if (!started) return 'On the catapult: tap STAGE (Space) to start the engine.';
      return v.throttle < 0.9 ? 'Full throttle (Z), then hit LAUNCH (L).' : 'Catapult ready: hit LAUNCH (L).';
    }
    if (v.kind === 'plane') {
      if (!started && v.parts.some((p) => p.def.thrust)) return 'Tap STAGE (Space) to start the engine.';
      if (v.wheelsDown && v.throttle < 0.9 && sp < 20 && !this.flags.takeoff) return 'Full throttle (Z) and roll down the runway.';
      if (v.wheelsDown && !this.flags.takeoff) return sp < 50 ? (isTouch ? 'Keep rolling straight (the stick steers the nose wheel)…' : 'Keep rolling straight (A/D steer the nose wheel)…') : (isTouch ? 'Pull the stick back gently to take off.' : 'Pull up gently with S to take off.');
      if (v.aoa != null && !v.wheelsDown && v.aoa > v.stallAoA * 0.9) return 'Stalling! Push the nose down and add power.';
      if (!v.wheelsDown && v.gearUp === false && v.hasRetract && sp > 90 && ga > 150) return 'Raise the gear (G) to cut drag.';
      if (!v.wheelsDown && ga < 600 && !this.flags.flyHigh) return isTouch ? 'Stick left/right banks to turn, forward/back pitches. The horizon button holds your altitude for you.' : 'Bank with A/D to turn, pitch with W/S. Press 2 for level flight (holds altitude), 3 to hold a heading.';
      if (!v.wheelsDown && ga > 150 && !this.mp && Combat.systems(v).length && Combat.S.kills === 0 && this.time - (this.weaponHintAt ?? (this.weaponHintAt = this.time)) < 40)
        return Settings.get('targets') === 'off' ? (isTouch ? 'Hold FIRE to shoot; tap the weapon chip to change weapon. Turn on targets in Settings.' : 'Hold V to fire, Tab changes weapon. Turn on targets in Settings for something to shoot.')
          : (isTouch ? 'Targets wait around the islands (the brackets). Hold FIRE to shoot; tap the weapon chip to change weapon.' : 'Targets wait around the islands (the brackets). Hold V to fire, Tab changes weapon.');
      if (!v.wheelsDown && v.mach > 0.85 && v.mach < 1 && !this.flags.machOne) return 'Nearly Mach 1. Keep going to break the sound barrier!';
      if (v.wheelsDown && sp > 2) return 'Hold B (Brake) to stop.';
      return '';
    }
    if (v.kind === 'car') {
      if (sp < 1 && !this.flags.drive1k) return isTouch ? 'Push the stick up to drive, sideways to steer; hold Brake to stop. The causeway leads 18 km out across the sea to Shetland.' : 'W/S to drive, A/D to steer, hold B to brake. The causeway leads 18 km out across the sea to Shetland.';
      return '';
    }
    if (v.kind === 'heli') {
      if (!started) return 'Tap STAGE (Space) to start the rotor.';
      if (v.landed && v.throttle < 0.6) return isTouch ? 'Raise the throttle until it lifts off.' : 'Raise the throttle (Shift) until it lifts off.';
      if (!v.landed && !this.flags.hover) return isTouch ? 'The stick tilts it to fly that way; let go and it levels out. ⟲ ⟳ turn. Lower the throttle to come down.' : 'W/A/S/D tilt it to fly that way; let go and it levels out. Q/E turn. Lower the throttle (Ctrl) to come down.';
      return '';
    }
    return '';
  },

  // Where on the real Earth: the country or sea below, and the nearest town (refreshed every second or so).
  // Is a plane's structure at risk? { kind: 'g' or 'speed', level: 1 near the limit, 2 over it (breaking) }.
  // Compass heading (degrees, real north on the real Earth) of the flight path, or of the nose when slow.
  compass(v) {
    const h = v.heading();
    if (v.body !== EARTH || !EARTH.mapped) return (((h * 180) / Math.PI) % 360 + 360) % 360;
    return Terrain.bearingAt(Math.atan2(v.y, v.x), Math.asin(clamp(v.z / v.radius(), -1, 1)), Math.sin(h), Math.cos(h));
  },
  // The speed warning is for anything with wings (a winged rocket's can flutter off on the way up too), and
  // a fluttering wing's comes first unless the load is past its limit too: easing off the stick won't save it.
  structAlert(v) {
    if (!v || v.landed || this.destroyed || !(v.airspeed > 20)) return null;
    const sp = v.overspeed > 1 ? { kind: 'speed', level: 2 } : Math.max(v.overspeed || 0, v.overWarn || 0) > 0.9 ? { kind: 'speed', level: 1 } : null;
    if (v.kind === 'plane' && v.strain > 0.85) {
      const stress = v.overspeed > 1 ? 0 : v.wings.reduce((m, p) => Math.max(m, p.stress || 0), 0); // (stress from flutter is the speed's doing)
      const g = { kind: 'g', level: v.strain > 1 || stress > 0.3 ? 2 : 1 };
      if (!sp || g.level > sp.level || (g.level === sp.level && (sp.level < 2 || v.strain > 1))) return g;
    }
    return sp;
  },

  whereText(v, alt) {
    if (v.body !== EARTH || !EARTH.mapped || alt > 60000) return '';
    if (this.whereAt && performance.now() - this.whereAt < 900) return this.whereTxt;
    const r = Math.hypot(v.x, v.y, v.z), D = Terrain.DEG, g = Terrain.toGeo(Math.atan2(v.y, v.x), Math.asin(v.z / r)), lon = g.lon * D, lat = g.lat * D;
    const reg = Terrain.regionAt(lon, lat), sea = v.splashed || Terrain.earthH(Math.atan2(v.y, v.x), Math.asin(v.z / r) * EARTH.radius) < 0;
    const place = sea ? reg.sea || reg.country : reg.country || reg.sea;
    const near = Terrain.citiesNear(lon, lat, 1.5)[0];
    let txt = place ? (sea ? place : 'Over ' + place) : '';
    if (near) {
      const d = near[1], rc = Terrain.cityRadius(near[0][2]);
      txt += (txt ? ' · ' : '') + (d < rc ? near[0][0] : `${near[0][0]} ${fmt.dist(d)}`);
    }
    this.whereAt = performance.now(); this.whereTxt = txt;
    return txt;
  },

  updateHUD(force) {
    const v = this.active;
    if (!v || !v.parts.length) return;
    const b = v.body;
    const alt = v.altitude();
    const ground = this.groundAlt(v);
    const vs = v.vSpeed();
    const set = (id, txt) => { const e = document.getElementById(id); if (e.textContent !== txt) e.textContent = txt; };
    set('t-body', b.name + (v.splashed ? ' · splashed' : v.landed ? ' · landed' : ''));
    set('t-vessel', v.name);
    const where = this.whereText(v, alt), we = $('#t-where');
    we.hidden = !where;
    if (where) set('t-where', where);
    set('t-alt', fmt.dist(alt));
    $('#row-ground').hidden = !(ground < 5000);
    set('t-ground', fmt.dist(Math.max(0, ground)));
    const rocket = v.kind === 'rocket';
    set('t-speed', rocket ? fmt.speed(v.speed()) : `${Math.round(v.speed() * 3.6).toLocaleString('en-US')} km/h`);
    const mach = v.mach > 0.3 && !v.landed;
    $('#row-mach').hidden = !mach;
    if (mach) { set('t-mach', `M ${v.mach.toFixed(2)}`); $('#row-mach').classList.toggle('sonic', v.mach >= 0.95 && v.mach < 1.15); }
    const aoa = v.kind === 'plane' && v.aoa != null && !v.landed;
    $('#row-aoa').hidden = !aoa;
    const stalling = aoa && !v.wheelsDown && v.aoa > (v.stallAoA - 0.03 * v.flaps) * 0.9;
    if (aoa) set('t-aoa', stalling ? `STALL ${(v.aoa * 180 / Math.PI).toFixed(0)}°` : `${(v.aoa * 180 / Math.PI).toFixed(1)}°`);
    $('#row-aoa').classList.toggle('danger', !!stalling);
    const hdg = !rocket && v.body === EARTH;
    $('#row-hdg').hidden = !hdg;
    if (hdg) { const c = this.compass(v); set('t-hdg', `${String(Math.round(c) % 360).padStart(3, '0')}° ${COMPASS[Math.round(c / 22.5) % 16]}`); }
    const integ = Combat.integrity(v); // the share of the craft's health that's gone
    $('#row-dmg').hidden = integ > 0.995;
    if (integ <= 0.995) { set('t-dmg', `${Math.max(1, Math.round((1 - integ) * 100))}%`); $('#row-dmg').classList.toggle('danger', integ < 0.6); }
    const gload = v.kind === 'plane' && !v.landed && v.airspeed > 20;
    $('#row-g').hidden = !gload;
    const st = this.structAlert(v);
    if (gload) {
      const gr = v.gRating();
      set('t-g', gr ? `${v.nz.toFixed(1)} / ${gr.toFixed(gr < 10 ? 1 : 0)} g` : `${v.gForce.toFixed(1)} g`);
      $('#row-g').classList.toggle('danger', !!(st && st.kind === 'g'));
    }
    // over-g or overspeed: the wings are at risk (near a wing's speed limit, or past it and fluttering apart)
    const al = $('#flight-alert');
    al.hidden = !st;
    if (st) {
      const fast = v.overMach ? `M ${v.mach.toFixed(2)}` : rocket ? fmt.speed(v.speed()) : `${Math.round(v.speed() * 3.6).toLocaleString('en-US')} km/h`;
      set('flight-alert', st.kind === 'g' ? `Over-g · ${v.nz.toFixed(1)} g · ease off` : `Overspeed · ${fast}${st.level > 1 ? ' · slow down' : ''}`);
      al.classList.toggle('critical', st.level > 1);
    }
    // orbital readouts mean little for a car or a plane low in the air
    const orbital = rocket || !b.atmoHeight || alt > b.atmoHeight * 0.7;
    if (this._orbital !== orbital) { this._orbital = orbital; document.querySelectorAll('.orbit-row').forEach((e) => { e.hidden = !orbital; }); }
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
    if (!enc && orbital && pred && pred[0].end === 'impact' && !v.landed && ground > 200) enc = `Impact in ${fmt.duration(pred[0].tEnd - this.time)}`;
    $('#row-enc').hidden = !enc;
    set('t-enc', enc);

    const warp = WARPS[this.warpIdx];
    set('warp-label', warp >= 1e6 ? `${warp / 1e6}M×` : warp >= 1e4 ? `${warp / 1000}k×` : `${warp}×`);
    $('#warp').classList.toggle('rails', this.warpIdx > PHYS_WARP_MAX);

    const sf = v.stageFuel();
    const frac = sf.cap ? sf.fuel / sf.cap : 0;
    $('#fuel-fill').style.transform = `scaleX(${frac})`;
    $('#fuel-fill').classList.toggle('low', frac < 0.15);
    set('fuel-label', sf.cap ? `Stage fuel ${fmt.mass(sf.fuel)}` : 'No engines running');

    const next = v.stages[v.stageIdx];
    set('stage-num', v.stageIdx < v.stages.length ? `Stage ${v.stageIdx + 1}/${v.stages.length}` : 'Staging done');
    set('stage-next', next ? describeStage(next, v.byId) : v.wheels.some((p) => p.def.wheel.drive) && (v.kind === 'car' || v.kind === 'rocket') ? 'Drive with W/S, steer A/D · hold B to brake' : 'Tap parts to use them');
    $('#btn-brake').hidden = !v.wheels.length && !v.airbrakes.length;
    const ws = Combat.status(v);
    $('#weapon-box').hidden = !ws || this.destroyed;
    $('#btn-cm').hidden = !(ws && (ws.flares > 0 || ws.chaff > 0)) || this.destroyed;
    $('#btn-fire').hidden = !!(ws && ws.cmOnly); // (only flares or chaff on board: nothing to fire)
    $('#btn-catapult').hidden = !(this.catapult && this.catapult.state === 'hold' && !this.destroyed);
    if (ws) {
      set('w-name', ws.name + (ws.n > 1 ? ' ▸' : ''));
      const fl = ws.flares || (ws.cmOnly && ws.fl) ? `✦${ws.flares}` : '', ch = ws.chaff || (ws.cmOnly && ws.ch) ? `≋${ws.chaff}` : '';
      const cm = fl && ch ? `${fl} ${ch}` : fl || ch; // flares and chaff left (0 shown when they are all a craft has)
      set('w-ammo', [ws.ammo, cm, ws.stealth > 0.05 ? `◈${Math.round(ws.stealth * 100)}%` : '', ws.kills ? `${ws.kills} ✕` : ''].filter((s) => s !== '' && s != null).join(' · '));
      $('#btn-weapon').classList.toggle('lock', ws.lock);
    }
    $('#btn-flaps').hidden = !v.hasFlaps;
    set('btn-flaps', v.flaps ? `Flaps ${Math.round(v.flaps * 100)}%` : 'Flaps');
    $('#btn-flaps').classList.toggle('on', v.flaps > 0);
    $('#btn-gear').hidden = !v.hasRetract;
    set('btn-gear', v.gearUp ? 'Gear up' : 'Gear down');
    $('#btn-gear').classList.toggle('on', !v.gearUp);
    $('#btn-stage').disabled = !next || this.destroyed;
    $('#btn-recover').hidden = !this.canRecover();
    const h = this.hint();
    $('#hint').hidden = !h;
    set('hint-text', h);
    if (force) { this.updateThrottleDom(); this.syncSas(); }
  },

  // ------------------------------------------------------------------ rendering
  // Follow the active vessel; the view turns so its local "up" points up (both renderers use this).
  // The camera follows the craft's position relative to its body, so after a crash it stays over the
  // wreck instead of being left behind in space while the planet moves on along its orbit.
  // the craft the camera shows: ours, or the player we watch after ours is lost
  get viewVessel() { const s = this.spectate; return s && !s.dead && s.parts.length ? s : this.active; },
  updateCamera() {
    const v = this.viewVessel, c = this.camRel;
    if (this.destroyed && Silly.on('ghostCam')) { // the classic crash bug: the camera stays behind while the planet flies on
      if (!this.ghostAt) this.ghostAt = { ...this.camAbs };
      this.camAbs = this.ghostAt;
      return;
    }
    this.ghostAt = null;
    if (v && v.parts.length && !v.dead) { c.b = v.body; c.x = v.x; c.y = v.y; c.z = v.z; }
    const bp = bodyPos(c.b, this.time);
    this.camAbs = { x: bp.x + c.x, y: bp.y + c.y, z: c.z };
    this.viewQ = qslerp(this.viewQ, this.viewFrame(c.x, c.y, c.z), 0.25, this.viewQ);
    const want = Math.PI / 2 - Math.atan2(c.y, c.x);
    this.viewRot += wrapAngle(want - this.viewRot) * 0.25;
  },

  render(ctx, W, H, dpr) {
    if (!this.running) return;
    this.updateCamera();
    if (this.mapMode) MapView.render(ctx, W, H, dpr, this);
    else World.render(ctx, W, H, dpr, this);
  },
};

function haptic(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ } }
