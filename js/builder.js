'use strict';
// Build screen: drag parts from the tray onto a blueprint grid.

const TEMPLATES = {
  hopper: {
    name: 'Hopper', kind: 'rocket', tier: 0, blurb: 'A suborbital hop. Fly up, separate, open the parachute.',
    parts: [['hawk', 0, 1], ['tankM', 0, 3], ['separator', 0, 4.25], ['pod', 0, 5.5], ['chute', 0, 6.75]],
  },
  pathfinder: {
    name: 'Pathfinder', kind: 'rocket', tier: 0, blurb: 'Two Hawk stages and basic parts. Enough to reach Earth orbit.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankL', 0, 8], ['separator', 0, 10.25], ['hawk', 0, 11.5], ['tankM', 0, 13.5],
      ['pod', 0, 15.5], ['chute', 0, 16.75], ['fin', 1.375, 2.75], ['fin', -1.375, 2.75]],
  },
  orbiter: {
    name: 'Orbiter', kind: 'rocket', tier: 1, blurb: 'Efficient vacuum upper stage. Orbit with fuel to spare.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankL', 0, 8], ['separator', 0, 10.25], ['valiant', 0, 11.25],
      ['tankM', 0, 13], ['pod', 0, 15], ['chute', 0, 16.25], ['fin', 1.375, 2.75], ['fin', -1.375, 2.75]],
  },
  probe: {
    name: 'Moon Probe', kind: 'rocket', tier: 1, blurb: 'A light probe on a two-stage booster. Land it gently on the Moon.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankM', 0, 7], ['separator', 0, 8.25], ['valiant', 0, 9.25],
      ['tankM', 0, 11], ['separator', 0, 12.25], ['kolibri', 0, 13], ['tankThin', 0, 14.5], ['probe', 0, 16],
      ['leg', 0.75, 14], ['leg', -0.75, 14]],
  },
  lunar: {
    name: 'Lunar Lander', kind: 'rocket', tier: 1, blurb: 'Boosters, a transfer stage, a lander and a shielded capsule. Moon and back.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankL', 0, 8], ['separator', 0, 10.25], ['valiant', 0, 11.25],
      ['tankL', 0, 14], ['separator', 0, 16.25], ['valiant', 0, 17.25], ['tankM', 0, 19], ['separator', 0, 20.25],
      ['heatShield', 0, 20.75], ['pod', 0, 22], ['chute', 0, 23.25],
      ['leg', 1.25, 17.5], ['leg', -1.25, 17.5],
      ['sideSep', 1.25, 5], ['tankL', 2.5, 4], ['hawk', 2.5, 1], ['nose', 2.5, 6.75],
      ['sideSep', -1.25, 5], ['tankL', -2.5, 4], ['hawk', -2.5, 1], ['nose', -2.5, 6.75]],
  },
  rover: {
    name: 'Lunar Rover', kind: 'rocket', tier: 3, blurb: 'A rover that flies itself to the Moon, lands on its wheels and drives.',
    parts: [['titan', 0, 1.5], ['tankWideL', 0, 6], ['tankWideL', 0, 12], ['separatorL', 0, 15.25], ['valiant', 0, 16.25], ['tankL', 0, 19],
      ['separatorL', 0, 21.25], ['kolibri', 0.5, 22], ['kolibri', -0.5, 22], ['wheel', 1.75, 22], ['wheel', -1.75, 22],
      ['tankWide', 0, 24], ['probeL', 0, 25.875]],
  },
  ares: {
    name: 'Ares Mars Lander', kind: 'rocket', tier: 3, blurb: 'Titan and Thunder boosters, a nuclear transfer stage and a shielded Mars lander.',
    parts: [['titan', 0, 1.5], ['tankWideL', 0, 6], ['tankWideL', 0, 12], ['adapterL', 0, 15.5], ['separator', 0, 16.25],
      ['prometheus', 0, 18], ['tankXL', 0, 22.5], ['separator', 0, 25.75], ['heatShield', 0, 26.25], ['separator', 0, 26.75],
      ['spire', 0, 27.75], ['tankM', 0, 29.5], ['probeL', 0, 30.875], ['chuteL', 0, 31.5],
      ['leg', 1.25, 28.5], ['leg', -1.25, 28.5],
      ['sideSep', 1.75, 5], ['thunder', 2.75, 4], ['noseS', 2.75, 8.5],
      ['sideSep', -1.75, 5], ['thunder', -2.75, 4], ['noseS', -2.75, 8.5]],
  },
  // Planes are built nose-right: the stack runs along +y and the landing gear sits on the +x side.
  // Wings and tail surfaces go through the fuselage; pods and drop tanks hang from a wing.
  skylark: {
    name: 'Skylark', kind: 'plane', tier: 0, blurb: 'A forgiving high-wing trainer. Full throttle, then pull back gently at about 130 km/h.',
    parts: [['tailcone', 0, 1.25], ['fuselageS', 0, 3.5], ['cockpit', 0, 5.75], ['propeller', 0, 7.45],
      ['wing', -0.85, 3.6], ['elevator', -0.6, 0.75], ['vtail', -1.6, 1.0], ['gear', 1.7, 3.6], ['gear', 1.7, 6.3]],
  },
  bushhopper: {
    name: 'Bushhopper', kind: 'plane', tier: 0, blurb: 'A light taildragger: slow, gentle and short on the runway. Raise the tail, then lift off.',
    parts: [['tailconeS', 0, 1.25], ['fuselageSlim', 0, 4.5], ['cockpitS', 0, 7.5], ['propS', 0, 8.85],
      ['wing', -0.6, 4.2], ['elevator', -0.3, 0.75], ['vtailS', -1.2, 0.75], ['gearS', 1.25, 5.9], ['tailWheel', 1.05, 0.3]],
  },
  barnstormer: {
    name: 'Barnstormer', kind: 'plane', tier: 1, blurb: 'A biplane with a big radial engine. Torquey, draggy and loads of fun to throw around.',
    parts: [['tailcone', 0, 1.25], ['fuselageS', 0, 3.5], ['cockpit', 0, 5.75], ['propL', 0, 7.65],
      ['wing', -1.2, 3.7], ['wing', 0.95, 3.5], ['elevator', -0.6, 0.75], ['vtail', -1.6, 1.1], ['gearS', 1.5, 5.6], ['tailWheel', 1.3, 0.3]],
  },
  hornet: {
    name: 'Hornet', kind: 'plane', tier: 2, blurb: 'A turbojet fighter with swept wings. Fast enough to break the sound barrier.',
    parts: [['jet', 0, 1.5], ['fuselage', 0, 5], ['cockpitJet', 0, 9.1], ['wingSwept', 0.2, 5.3], ['elevator', 0.25, 1.2],
      ['vtail', -1.45, 1.6], ['gearR', 1.7, 4.4], ['gearR', 1.5, 8.6], ['airbrake', -1.125, 5.6]],
  },
  viper: {
    name: 'Viper', kind: 'plane', tier: 3, blurb: 'Delta-wing interceptor with an afterburner (full throttle) and canards. Mach 2, if you dare.',
    parts: [['jetAB', 0, 2], ['fuselage', 0, 6], ['fuselageS', 0, 9], ['cockpitJet', 0, 12.1], ['wingDelta', 0.4, 5.8],
      ['canard', 0, 10.4], ['vtailTwin', -1.55, 2.2], ['gearR', 1.7, 5.2], ['gearR', 1.5, 11.3]],
  },
  falcon: {
    name: 'Falcon', kind: 'plane', tier: 3, military: true, blurb: 'Air-superiority fighter: cannon, heat seekers and radar missiles, a fighter turbofan with afterburner. Hold V to fire, Tab to change weapon.',
    parts: [['jetF', 0, 2.2], ['fuselage', 0, 6], ['fuselageS', 0, 9], ['cockpitJet', 0, 12.1], ['wingDelta', 0.4, 5.8],
      ['canard', 0, 10.4], ['vtailTwin', -1.55, 2.2], ['gearR', 1.7, 5.2], ['gearR', 1.5, 11.3],
      ['cannon', -1.25, 8.6], ['aam', 0.75, 4.6], ['radarMissiles', 0.75, 8.1], ['flares', -1.2, 4.3]],
  },
  striker: {
    name: 'Striker', kind: 'plane', tier: 2, military: true, blurb: 'Ground-attack jet with a cannon, rocket pods and bombs. The bombsight shows where the bombs will fall.',
    parts: [['jet', 0, 1.5], ['fuselage', 0, 5], ['cockpitJet', 0, 9.1], ['wingSwept', 0.2, 5.3], ['elevator', 0.25, 1.2],
      ['vtail', -1.45, 1.6], ['gearR', 1.7, 4.4], ['gearR', 1.5, 8.6], ['airbrake', -1.125, 5.6],
      ['cannon', -1.25, 7.6], ['rocketPods', 0.75, 4.3], ['bombs', 0.75, 6.6]],
  },
  bomber: {
    name: 'Stratobomber', kind: 'plane', tier: 3, military: true, blurb: 'A heavy jet bomber: a 1-tonne bomb under the belly, a pair of 250 kg bombs under the wings, and a turret on top that guards it by itself.',
    parts: [['tailconeW', 0, 2.25], ['fuselageW', 0, 7.5], ['fuselageW', 0, 13.5], ['cockpitAir', 0, 18.2],
      ['wingL', 0.9, 11.6], ['fanPods', 1.8, 12.4], ['elevatorL', -0.9, 1.6], ['vtailL', -2.4, 1.9],
      ['gearL', 2.5, 9.6], ['gear', 2.2, 17.2], ['bombL', 2.05, 6], ['bombs', 1.4, 9.2], ['turret', -2, 13.5]],
  },
  mustang: {
    name: 'Mustang', kind: 'plane', tier: 1, military: true, blurb: 'A WWII-style fighter: a V12 behind a pointed spinner, an elliptical wing, a gun on the cowling and pods on the wings. A taildragger: raise the tail, then lift off.',
    parts: [['tailcone', 0, 1.25], ['fuselage', 0, 4.5], ['cockpitWarbird', 0, 7.8], ['propV12', 0, 9.9],
      ['wingElliptical', 0.6, 5.0], ['elevator', -0.6, 0.75], ['vtail', -1.6, 1.0], ['gearR', 1.7, 6.3], ['tailWheel', 1.3, 0.3],
      ['gunPods', 0.95, 5.1]],
  },
  camel: {
    name: 'Camel', kind: 'plane', tier: 0, military: true, blurb: 'A WWI-style biplane with a gun firing through the propeller. Slow, light and astonishingly nimble: it loops in its own length.',
    parts: [['tailcone', 0, 1.25], ['cockpitWarbird', 0, 3.8], ['fuselageS', 0, 6.1], ['propeller', 0, 7.55],
      ['wingBiplane', -0.3, 4.6], ['elevator', -0.6, 0.75], ['vtail', -1.6, 1.1], ['gearS', 1.5, 5.6], ['tailWheel', 1.3, 0.3], ['gun', -1.175, 6.35]],
  },
  kestrel: {
    name: 'Kestrel', kind: 'plane', tier: 3, military: true, blurb: 'A swing-wing interceptor: the wings spread for take-off and landing and fold back by themselves as it speeds up. Tandem cockpit, cannon and radar missiles.',
    parts: [['jetF', 0, 2.2], ['fuselageIntake', 0, 5.75], ['fuselage', 0, 9.5], ['cockpitTandem', 0, 14.1], ['wingSwing', 0.2, 7.5],
      ['elevator', 0.25, 1.2], ['vtailTwin', -1.55, 2.2], ['gearR', 1.7, 6.2], ['gearR', 1.55, 12.8],
      ['cannon', -1.25, 9.5], ['radarMissiles', 0.45, 7.6], ['flares', -1.2, 5.3]],
  },
  spectre: {
    name: 'Spectre', kind: 'plane', tier: 4, military: true, blurb: 'A stealth striker: faceted nose and body, a V-tail and four bombs in an internal bay. Hostile radars and fighters spot it far later (watch ◈ on the weapon box).',
    parts: [['jetF', 0, 2.2], ['bombBay', 0, 6], ['fuselageStealth', 0, 10.5], ['cockpitStealth', 0, 15.3], ['wingDelta', 0.4, 9.6],
      ['vtailV', -0.3, 1.5], ['gearR', 1.7, 6.4], ['gearR', 1.7, 13.6]],
  },
  jumbo: {
    name: 'Jumbo', kind: 'plane', tier: 2, blurb: 'A wide-body airliner on two turbofans. Long take-off roll: use half flaps (F) and rotate gently.',
    parts: [['tailconeW', 0, 2.25], ['fuselageW', 0, 7.5], ['fuselageW', 0, 13.5], ['cockpitAir', 0, 18.2],
      ['wingL', 0.9, 11.6], ['fanPods', 1.8, 12.4], ['elevatorL', -0.9, 1.6], ['vtailL', -2.4, 1.9],
      ['gearL', 2.5, 9.6], ['gear', 2.2, 17.2]],
  },
  albatross: {
    name: 'Albatross', kind: 'plane', tier: 0, blurb: 'A glider with a JATO rocket to get it up. Once the rocket burns out, ride the long slow glide home.',
    parts: [['tailconeS', 0, 1.25], ['fuselageSlim', 0, 4.5], ['cockpitS', 0, 7.5], ['wingGlider', -0.5, 4.4],
      ['elevator', -0.3, 0.75], ['vtailS', -1.2, 0.75], ['jato', 1.05, 4.1], ['gearS', 1.25, 6.6], ['tailWheel', 1.05, 0.3]],
  },
  seagull: {
    name: 'Seagull', kind: 'plane', tier: 1, blurb: 'A floatplane. It starts on the water in the bay west of the island: full throttle and lift off the waves.',
    parts: [['tailcone', 0, 1.25], ['fuselageS', 0, 3.5], ['cockpit', 0, 5.75], ['propeller', 0, 7.45],
      ['wing', -0.85, 3.6], ['elevator', -0.6, 0.75], ['vtail', -1.6, 1.0], ['floats', 1.5, 4.3]],
  },
  buggy: {
    name: 'Dune Buggy', kind: 'car', tier: 0, blurb: 'Drive with W/S, steer with A/D. The causeway leads across the sea to Shetland.',
    parts: [['chassis', 0, 1.25], ['cab', -0.4, 2.25], ['carWheel', 1.4, 0.4], ['carWheel', -1.4, 0.4]],
  },
  dragonfly: {
    name: 'Dragonfly', kind: 'heli', tier: 1, blurb: 'A light helicopter. Raise the throttle until it lifts, then tilt to fly.',
    parts: [['cab', 0, 1.75], ['tankS', 0, 3], ['rotor', -0.7, 4.1], ['chassis', -3.2, 2.05], ['tailRotor', -4.6, 1],
      ['carWheel', 0.9, 0.4], ['carWheel', -0.9, 0.4]],
  },
  hummingbird: {
    name: 'Hummingbird', kind: 'heli', tier: 1, blurb: 'A bubble-canopy helicopter on skids, with a slim tail boom. Lift gently: skids slide rather than roll.',
    parts: [['cockpitHeli', 0, 1.7], ['tankS', 0, 3.4], ['rotor', -0.4, 4.5], ['tailBoom', -3.7, 1.2, 1], ['tailRotor', -5.6, 2.35], ['skids', 0, -0.1, 3]],
  },
};

const Builder = {
  // The selection: `selected` is the part the panel describes; `sel` holds every selected part (several when
  // shift-clicking, box-selecting or pasting). Setting `selected` selects just that part.
  get selected() { return this._primary || null; },
  set selected(p) { this._primary = p || null; this.sel = new Set(p ? [p] : []); },
  get multi() { return this.sel.size > 1; },
  init(canvas) {
    this.canvas = canvas;
    this.parts = [];
    this.selected = null;
    this.clip = store.get('rss.clip', null); // copied parts, kept between designs
    this.cam = { x: 0, y: 8, scale: 26 };
    this.pointers = new Map();
    this.symmetry = store.get('rss.symmetry', true);
    this.category = 'command';
    this.name = 'Rocket';
    this.savedAs = null; // which hangar design the blueprint is, if any
    this.kind = 'rocket';
    this.history = [];
    this.future = [];
    this.bindDom();
    const saved = store.get('rss.design', null);
    if (saved && saved.parts && saved.parts.length) {
      this.loadDesign(saved);
      const entry = saved.savedAs && this.designs().find((x) => x.name === saved.savedAs);
      if (entry) this.markSaved(entry);
    } else this.loadTemplate('hopper');
    this.buildPalette();
  },

  // ---------------------------------------------------------------- design io
  serialize() {
    return { name: this.name, kind: this.kind, parts: this.parts.map((p) => ({ type: p.type, x: +p.x.toFixed(3), y: +p.y.toFixed(3), flip: p.flip, rot: p.rot || 0 })) };
  },
  save() { if (typeof MP !== 'undefined' && MP.savedCareer) return; store.set('rss.design', { ...this.serialize(), savedAs: this.savedAs || null }); }, // (not while a match borrows the builder)
  loadDesign(d, keepHistory) {
    this.parts = d.parts.filter((q) => PARTS[q.type]).map((q) => makePart(q.type, q.x, q.y, { flip: !!q.flip, rot: (q.rot || 0) & 3 }));
    if (d.name) this.name = d.name;
    const kind = VEHICLE_KINDS[d.kind] ? d.kind : 'rocket';
    this.kindSymmetry(kind);
    const turned = kind !== this.kind;
    this.kind = kind;
    if (turned) this.category = { rocket: 'command', plane: 'cabins', car: 'ground', heli: 'airEng' }[kind] || this.category;
    this.renderKind();
    this.linkMirrors();
    this.selected = null;
    if (!keepHistory) { this.history = []; this.future = []; }
    this.changed(!!keepHistory);
    if (!keepHistory) this.baseSnap = this.snapOf(this.serialize());
    this.renderInfo();
    if (turned && $('#palette-items').childElementCount) this.buildPalette();
    if (!keepHistory || turned) this.fitView();
  },
  loadTemplate(key) {
    const t = TEMPLATES[key];
    this.savedAs = null;
    this.loadDesign({ name: t.name, kind: t.kind, parts: t.parts.map(([type, x, y, rot]) => ({ type, x, y, flip: x < 0, rot: rot || 0 })) });
  },
  linkMirrors() {
    for (const p of this.parts) p.mirror = null;
    for (const p of this.parts) {
      if (p.mirror || Math.abs(p.x) < 0.01) continue;
      const m = this.parts.find((q) => q !== p && !q.mirror && q.type === p.type && Math.abs(q.x + p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01 && (q.rot || 0) === mirrorRot(p.rot));
      if (m) { p.mirror = m; m.mirror = p; }
    }
  },

  changed(fromHistory) {
    this.adj = buildAdjacency(this.parts);
    this.ctrl = findControlPart(this.parts);
    this.attached = this.ctrl ? componentOf(this.ctrl.id, this.adj) : new Set();
    const ps = this.parts.filter((p) => this.attached.has(p.id));
    const adj = new Map();
    for (const p of ps) adj.set(p.id, new Set([...this.adj.get(p.id)].filter((id) => this.attached.has(id))));
    this.stages = this.ctrl ? computeStages(ps, adj, this.ctrl.id) : [];
    this.stageOf = new Map();
    this.stages.forEach((st, i) => st.forEach((id) => this.stageOf.set(id, i + 1)));
    const dv = this.ctrl ? estimateDeltaV(ps, adj, this.ctrl.id, this.stages, false) : { total: 0, perStage: [], twr: [] };
    let mass = 0, thrust = 0, tx = 0, ty = 0, cx = 0, cy = 0;
    for (const p of ps) { const m = partKg(p); mass += m; cx += m * p.x; cy += m * p.y; }
    const first = new Set(this.stages[0] || []);
    for (const p of ps) if (first.has(p.id) && p.def.thrust) { const n = partPt(p, 0, -p.def.h / 2); thrust += p.def.thrust * 1000; tx += p.def.thrust * n.x; ty += p.def.thrust * n.y; }
    this.com = mass ? { x: cx / mass, y: cy / mass } : null;
    this.cot = thrust ? { x: (tx * 1000) / thrust, y: (ty * 1000) / thrust } : null;
    // planes: centre of lift (every horizontal surface, weighted by how much lift it makes per degree)
    // and the speed the wings stall at, clean and with full flaps, at sea level
    let la = 0, lx = 0, ly = 0, clS = 0, clF = 0, wingArea = 0;
    for (const p of ps) if (p.def.wing) {
      const W = wingAero(p.def), wd = p.def.wing, k = wd.area * W.slope, c = partPt(p, 0, p.def.h / 4 - W.back);
      la += k; lx += k * c.x; ly += k * c.y;
      if (!wd.control) { clS += k * W.stall; clF += wd.flaps ? k * (W.stall - 0.03) + 0.8 * wd.area : k * W.stall; wingArea += wd.area; }
    }
    this.col = la ? { x: lx / la, y: ly / la } : null;
    const vStall = (cl) => (cl > 0 ? Math.sqrt((2 * mass * G0) / (1.225 * cl)) : 0);
    const locked = this.parts.filter((p) => !Career.unlocked(p.def));
    this.statsData = {
      mass, thrust, twr: thrust / (mass * EARTH.surfaceG || 1), dv: dv.total, perStage: dv.perStage, stageTwr: dv.twr,
      loose: this.parts.length - ps.length, cost: designCost(ps), locked, fuel: ps.reduce((f, p) => f + p.fuel, 0),
      air: { stall: vStall(clS), stallFlaps: vStall(clF), wingArea, length: this.length(ps), ...(() => { const w = wingStrength(ps); return { g: mass ? w.S / (mass * G0) : 0, vne: w.vne }; })() },
    };
    this.renderStats();
    if (!fromHistory) {
      const snap = JSON.stringify(this.serialize());
      if (this.history[this.history.length - 1] !== snap) {
        this.history.push(snap);
        if (this.history.length > 60) this.history.shift();
        this.future = [];
      }
      this.save();
    }
    this.renderSaveState();
    this.syncUndo();
  },
  undo() {
    if (this.drag) this.cancelDrag(); // the drag holds parts that are about to be replaced
    if (this.history.length < 2) return;
    this.future.push(this.history.pop());
    this.loadDesign(JSON.parse(this.history[this.history.length - 1]), true);
    this.save();
  },
  redo() {
    if (this.drag) this.cancelDrag();
    if (!this.future.length) return;
    const s = this.future.pop();
    this.history.push(s);
    this.loadDesign(JSON.parse(s), true);
    this.save();
  },
  syncUndo() {
    $('#btn-undo').disabled = this.history.length < 2;
    $('#btn-redo').disabled = !this.future.length;
  },

  // ---------------------------------------------------------------- geometry
  // The blueprint shows a design the way it will sit at launch (planes nose-right), so the camera works
  // in display space and parts in part space: display = R(viewRot) · part.
  get viewRot() { return VEHICLE_KINDS[this.kind].launchRot; },
  toDisp(x, y) { const c = Math.cos(this.viewRot), s = Math.sin(this.viewRot); return { x: c * x - s * y, y: s * x + c * y }; },
  toPart(x, y) { const c = Math.cos(this.viewRot), s = Math.sin(this.viewRot); return { x: c * x + s * y, y: -s * x + c * y }; },
  screenToDisp(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    return { x: this.cam.x + (sx - r.left - r.width / 2) / this.cam.scale, y: this.cam.y - (sy - r.top - r.height / 2) / this.cam.scale };
  },
  screenToWorld(sx, sy) { const d = this.screenToDisp(sx, sy); return this.toPart(d.x, d.y); },
  in3D() { return App.preview3D(); },
  // The blueprint point under the pointer (part space) and the metres per pixel there, in either view;
  // null when the 3D view sees the blueprint edge-on.
  pointerToPart(sx, sy) {
    if (this.in3D()) return Render3D.designPoint(sx, sy);
    const w = this.screenToWorld(sx, sy);
    return { x: w.x, y: w.y, mpp: 1 / this.cam.scale };
  },
  // The part under a blueprint point: the one drawn on top (pods, then wings and tail surfaces, then the
  // hull, then legs, fins and wheels), so a wing through the fuselage can be picked where they cross.
  hitPart(w) {
    const pad = isTouch ? 0.2 : 0.05, layer = (d) => (d.pod ? 3 : isSurface(d) ? 2 : d.leg || d.fin || d.wheel ? 0 : 1);
    let best = null;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i], r = partRect(p);
      if (w.x >= r.l - pad && w.x <= r.r + pad && w.y >= r.b - pad && w.y <= r.t + pad && (!best || layer(p.def) > layer(best.def))) best = p;
    }
    return best;
  },
  fitView() {
    if (this.in3D()) Render3D.resetCamera(true);
    if (!this.parts.length) { this.cam = { x: 0, y: 6, scale: 26 }; return; }
    let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity;
    for (const p of this.parts) {
      const R = partRect(p);
      for (const [x, y] of [[R.l, R.b], [R.r, R.b], [R.l, R.t], [R.r, R.t]]) {
        const d = this.toDisp(x, y);
        l = Math.min(l, d.x); r = Math.max(r, d.x); b = Math.min(b, d.y); t = Math.max(t, d.y);
      }
    }
    const area = this.viewArea();
    const scale = Math.min(area.w / (r - l + 6), area.h / (t - b + 4));
    this.cam.scale = clamp(scale, 5, 60);
    this.cam.x = (l + r) / 2 - (area.cx - innerWidth / 2) / this.cam.scale;
    this.cam.y = (b + t) / 2 + (area.cy - innerHeight / 2) / this.cam.scale;
  },
  viewArea() {
    const top = $('#build-top').getBoundingClientRect().bottom + (innerWidth <= 760 ? $('#stats').getBoundingClientRect().height + 8 : 0);
    let bottom = $('#palette').getBoundingClientRect().top;
    const info = $('#part-info');
    if (innerWidth <= 760 && !info.hidden) bottom = Math.min(bottom, info.getBoundingClientRect().top); // phones: above the part panel
    bottom = Math.max(bottom, top + 80);
    let left = 0;
    if (innerWidth > 760) left = $('#stats').getBoundingClientRect().right;
    return { w: innerWidth - left, h: bottom - top, cx: (left + innerWidth) / 2, cy: (top + bottom) / 2 };
  },

  // Find a good spot for a part of `type`, turned by `rot` quarter turns, near the desired centre.
  // radius: how far from `want` an attachment may be (default: ~26 px on screen, at least 1.4 m).
  snap(type, want, ignore, rot = 0, radius) {
    const def = PARTS[type];
    const { w, h } = partDims({ def, rot });
    const others = this.parts.filter((p) => !ignore.includes(p));
    const probe = (x, y) => ({ def, type, x, y, rot });
    const free = (x, y) => !others.some((o) => partsClash(probe(x, y), o));
    if (radius == null) radius = Math.max(1.4, 26 * (this.mpp || 1 / this.cam.scale));
    let best = null, bestD = radius;
    const consider = (x, y) => {
      const d = Math.hypot(x - want.x, y - want.y);
      if (d < bestD && free(x, y)) { best = { x, y }; bestD = d; }
    };
    const g = (v) => Math.round(v * 4) / 4;
    // wings and tail surfaces sit right where they are dropped, through the part they mount on; pods and
    // drop tanks hang from a wing the same way
    if (isSurface(def) || def.pod) {
      const gx = g(want.x), gy = g(want.y), pr = probe(gx, gy);
      if (free(gx, gy) && others.some((o) => partsMounted(pr, o) && (!def.pod || isSurface(o.def)))) return { x: gx, y: gy, attached: true, ok: true };
    }
    for (const o of others) {
      const R = partRect(o);
      consider(o.x, R.t + h / 2);
      consider(o.x, R.b - h / 2);
      const yy = clamp(g(want.y), R.b - h / 2 + 0.25, R.t + h / 2 - 0.25);
      consider(R.r + w / 2, yy); consider(R.l - w / 2, yy);
      consider(R.r + w / 2, R.t - h / 2); consider(R.l - w / 2, R.t - h / 2);
      consider(R.r + w / 2, R.b + h / 2); consider(R.l - w / 2, R.b + h / 2);
      // on top of or under `o`, wherever along it the pointer is, as long as the two still overlap
      if (Math.abs(g(want.x) - o.x) < (w + R.r - R.l) / 2 - 0.1) { consider(g(want.x), R.t + h / 2); consider(g(want.x), R.b - h / 2); }
    }
    if (best) return { ...best, attached: true, ok: true };
    const gx = g(want.x), gy = g(want.y);
    return { x: gx, y: gy, attached: false, ok: free(gx, gy) };
  },

  mirrorOk(type, x, y, ignore, rot = 0) {
    if (Math.abs(x) < 0.01) return false;
    const probe = { def: PARTS[type], type, x: -x, y, rot: mirrorRot(rot) };
    const self = { def: PARTS[type], type, x, y, rot };
    if (partsClash(probe, self)) return false;
    return !this.parts.some((o) => !ignore.includes(o) && partsClash(probe, o));
  },

  addPart(type, x, y, rot = 0) {
    if (!Career.unlocked(PARTS[type])) { UI.toast(`${PARTS[type].name} unlocks with ${TIERS[PARTS[type].tier].name}`); return; }
    const p = makePart(type, x, y, { flip: x < 0, rot });
    this.parts.push(p);
    if (this.symmetry && this.mirrorOk(type, x, y, [], rot)) {
      const m = makePart(type, -x, y, { flip: -x < 0, rot: mirrorRot(rot) });
      this.parts.push(m);
      p.mirror = m; m.mirror = p;
    }
    this.selected = p;
    this.changed();
    this.renderInfo();
    Sound.click();
  },

  deleteSelected() {
    const p = this.selected;
    if (!p) return;
    if (this.drag && this.drag.part) this.cancelDrag();
    this.parts = this.parts.filter((q) => q !== p && q !== p.mirror);
    this.selected = null;
    this.changed();
    this.renderInfo();
  },

  duplicateSelected() {
    if (this.multi) { this.paste({ parts: [...this.sel].map((q) => ({ type: q.type, x: q.x, y: q.y, rot: q.rot || 0 })) }); return; }
    const p = this.selected;
    if (!p) return;
    const s = this.snap(p.type, { x: p.x, y: partRect(p).t + partDims(p).h / 2 }, [], p.rot || 0);
    if (!s.ok) { UI.toast('No room to duplicate it there'); return; }
    this.addPart(p.type, s.x, s.y, p.rot || 0);
  },

  // Turn the selected part (and its mirror twin) a quarter turn; while dragging from the palette, turn the
  // part being placed. If it no longer fits where it is, it moves to the nearest free spot.
  rotateSelected() {
    const d = this.drag;
    if (d && d.fromPalette) { d.rot = ((d.rot || 0) + 1) & 3; if (d.last) this.dragTo(d.last.x, d.last.y); Sound.click(); return; }
    const p = this.selected;
    if (!p) { UI.toast('Select a part to rotate it (R)'); return; }
    const k = ((p.rot || 0) + 1) & 3, m = p.mirror, ignore = [p, m].filter(Boolean);
    const s = this.snap(p.type, { x: p.x, y: p.y }, ignore, k);
    if (!s.ok) { UI.toast('No room to turn it here'); return; }
    p.rot = k; p.x = s.x; p.y = s.y; p.flip = p.x < 0;
    if (m) {
      if (this.mirrorOk(p.type, p.x, p.y, ignore, k)) { m.rot = mirrorRot(k); m.x = -p.x; m.y = p.y; m.flip = m.x < 0; }
      else { p.mirror = null; m.mirror = null; }
    }
    Sound.click();
    this.changed();
    this.renderInfo();
  },

  // Arrow keys: move the selected part (and its twin) by a step in screen directions, if there is room.
  nudge(dx, dy) {
    const p = this.selected, m = p.mirror, d = this.toPart(dx, dy), x = p.x + d.x, y = p.y + d.y, rot = p.rot || 0;
    const probe = { def: p.def, type: p.type, x, y, rot }, ignore = [p, m].filter(Boolean);
    if (this.parts.some((o) => !ignore.includes(o) && partsClash(probe, o))) { UI.toast('No room to move it there'); return; }
    const twin = m && this.mirrorOk(p.type, x, y, ignore, rot);
    p.x = +x.toFixed(3); p.y = +y.toFixed(3); p.flip = p.x < 0;
    if (twin) { m.x = -p.x; m.y = p.y; m.flip = m.x < 0; } else if (m) { p.mirror = null; m.mirror = null; }
    this.changed();
    this.renderInfo();
  },

  // ---------------------------------------------------------------- several parts at once
  // Add or remove a part from the selection (shift-click, or a tap in Select mode).
  toggleSel(p) {
    if (!p) return;
    const s = new Set(this.sel);
    if (s.has(p)) s.delete(p); else s.add(p);
    this._primary = s.has(p) ? p : [...s].pop() || null;
    this.sel = s;
    this.renderInfo();
  },
  selectAll() { this.setSel(this.parts); },
  setSel(list) {
    const arr = [...new Set(list)];
    this._primary = arr[arr.length - 1] || null;
    this.sel = new Set(arr);
    this.renderInfo();
  },
  // Where a part's centre is on screen (CSS pixels), in either view; null if it can't be seen.
  partScreen(p) {
    if (this.in3D()) return Render3D.designToScreen(p.x, p.y);
    const r = this.canvas.getBoundingClientRect(), d = this.toDisp(p.x, p.y);
    return { x: r.left + r.width / 2 + (d.x - this.cam.x) * this.cam.scale, y: r.top + r.height / 2 - (d.y - this.cam.y) * this.cam.scale };
  },
  // A box dragged across the blueprint: everything whose centre falls inside joins the selection.
  boxSelect(x0, y0, x1, y1, add) {
    const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
    const hit = this.parts.filter((p) => { const s = this.partScreen(p); return s && s.x >= l && s.x <= r && s.y >= t && s.y <= b; });
    this.setSel(add ? [...this.sel, ...hit] : hit);
    if (hit.length) Sound.click();
  },
  showBox(b) {
    const el = $('#sel-box');
    if (!b) { el.hidden = true; return; }
    el.hidden = false;
    Object.assign(el.style, { left: `${Math.min(b.sx, b.x)}px`, top: `${Math.min(b.sy, b.y)}px`, width: `${Math.abs(b.x - b.sx)}px`, height: `${Math.abs(b.y - b.sy)}px` });
  },
  setSelectMode(on) {
    this.selectMode = !!on;
    const b = $('#btn-select');
    b.setAttribute('aria-pressed', String(this.selectMode));
    if (on) UI.toast(isTouch ? 'Select mode: tap parts to pick several, or drag a box round them' : 'Select mode: click parts to pick several, or drag a box round them');
  },
  // Does a set of parts (already where they would go) clear everything else?
  groupFits(group, also = []) {
    const skip = new Set([...group, ...also]);
    return !group.some((p) => this.parts.some((o) => !skip.has(o) && partsClash(p, o)));
  },
  // Twins of selected parts that aren't selected themselves follow mirrored (if they fit); then every
  // mirrored pair is found again, so a group moved off the centre line simply loses its symmetry.
  followTwins(group, dx, dy, origs) {
    const inG = new Set(group);
    for (const p of group) {
      const m = p.mirror;
      if (!m || inG.has(m)) continue;
      const o = origs.get(m);
      const nx = -p.x, ny = p.y;
      m.x = nx; m.y = ny;
      if (this.parts.some((q) => q !== m && q !== p && partsClash(m, q))) { m.x = o.x; m.y = o.y; } // no room: it stays
    }
  },
  copySel(cut) {
    const list = [...this.sel];
    if (!list.length) { UI.toast('Select parts to copy them'); return; }
    // a single part brings its mirror twin along, as the single-part buttons do
    const parts = list.length === 1 && list[0].mirror ? [list[0], list[0].mirror] : list;
    this.clip = { kind: this.kind, parts: parts.map((p) => ({ type: p.type, x: p.x, y: p.y, rot: p.rot || 0 })) };
    store.set('rss.clip', this.clip);
    $('#btn-paste').hidden = false;
    if (cut) { this.deleteSel(); UI.toast(`Cut ${parts.length} part${parts.length > 1 ? 's' : ''}`); } else UI.toast(`Copied ${parts.length} part${parts.length > 1 ? 's' : ''} · Ctrl+V or Paste to place`);
  },
  // Paste the copied parts at the nearest free spot above (or beside) where they came from, selected so
  // they can be dragged into place.
  paste(clip = this.clip) {
    if (!clip || !clip.parts || !clip.parts.length) { UI.toast('Nothing copied yet'); return; }
    const src = clip.parts.filter((q) => PARTS[q.type] && Career.unlocked(PARTS[q.type]));
    if (!src.length) { UI.toast('Those parts aren’t unlocked yet'); return; }
    let b = -Infinity, t = Infinity;
    for (const q of src) { const r = partRect({ def: PARTS[q.type], x: q.x, y: q.y, rot: q.rot }); b = Math.max(b, r.t); t = Math.min(t, r.b); }
    const h = b - t, made = src.map((q) => makePart(q.type, q.x, q.y, { flip: q.x < 0, rot: q.rot & 3 }));
    const place = (dx, dy) => { made.forEach((p, i) => { p.x = +(src[i].x + dx).toFixed(3); p.y = +(src[i].y + dy).toFixed(3); p.flip = p.x < 0; }); return this.groupFits(made); };
    let ok = false;
    for (let k = 0; k < 120 && !ok; k++) { // up first, then out to the sides, a quarter metre at a time
      const ring = Math.floor(k / 3), side = k % 3, dy = h + 0.25 + ring * 0.5, dx = side === 0 ? 0 : (side === 1 ? 1 : -1) * (ring + 1) * 0.75;
      ok = place(dx, side === 0 ? dy : (ring + 1) * 0.5);
    }
    if (!ok) { UI.toast('No room to paste here'); return; }
    this.parts.push(...made);
    if (this.symmetry) for (const p of made) { // with symmetry on, one-sided parts get their twin
      if (Math.abs(p.x) < 0.01 || made.some((q) => q !== p && q.type === p.type && Math.abs(q.x + p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01)) continue;
      if (this.mirrorOk(p.type, p.x, p.y, [], p.rot)) { const m = makePart(p.type, -p.x, p.y, { flip: -p.x < 0, rot: mirrorRot(p.rot) }); this.parts.push(m); made.push(m); }
    }
    this.linkMirrors();
    this.setSel(made);
    this.changed();
    const r = this.canvas.getBoundingClientRect();
    if (made.some((q) => { const c = this.partScreen(q); return !c || c.x < r.left || c.x > r.right || c.y < r.top || c.y > r.bottom; })) this.fitView(); // keep them in sight
    Sound.click();
    UI.toast(`Pasted ${made.length} part${made.length > 1 ? 's' : ''}: drag any of them to move them together`);
  },
  deleteSel() {
    if (!this.multi) { this.deleteSelected(); return; }
    if (this.drag && this.drag.part) this.cancelDrag();
    const gone = new Set();
    for (const p of this.sel) { gone.add(p); if (p.mirror) gone.add(p.mirror); }
    this.parts = this.parts.filter((q) => !gone.has(q));
    this.selected = null;
    this.linkMirrors();
    this.changed();
    this.renderInfo();
  },
  // A quarter turn of the whole selection about its middle.
  rotateSel() {
    if (!this.multi) { this.rotateSelected(); return; }
    const g = [...this.sel], old = g.map((p) => ({ x: p.x, y: p.y, rot: p.rot || 0 }));
    const cx = Math.round((g.reduce((s, p) => s + p.x, 0) / g.length) * 4) / 4, cy = Math.round((g.reduce((s, p) => s + p.y, 0) / g.length) * 4) / 4;
    for (const p of g) { const dx = p.x - cx, dy = p.y - cy; p.x = +(cx - dy).toFixed(3); p.y = +(cy + dx).toFixed(3); p.rot = ((p.rot || 0) + 1) & 3; p.flip = p.x < 0; }
    if (!this.groupFits(g)) { g.forEach((p, i) => { p.x = old[i].x; p.y = old[i].y; p.rot = old[i].rot; p.flip = p.x < 0; }); UI.toast('No room to turn them here'); return; }
    this.linkMirrors();
    Sound.click();
    this.changed();
  },
  nudgeSel(dx, dy) {
    if (!this.multi) { this.nudge(dx, dy); return; }
    const g = [...this.sel], d = this.toPart(dx, dy);
    for (const p of g) { p.x = +(p.x + d.x).toFixed(3); p.y = +(p.y + d.y).toFixed(3); }
    if (!this.groupFits(g)) { for (const p of g) { p.x = +(p.x - d.x).toFixed(3); p.y = +(p.y - d.y).toFixed(3); } UI.toast('No room to move them there'); return; }
    for (const p of g) p.flip = p.x < 0;
    this.linkMirrors();
    this.changed();
  },

  // ---------------------------------------------------------------- palette & panels
  buildPalette() {
    const tabs = $('#palette-tabs');
    tabs.innerHTML = '';
    for (const c of PART_CATEGORIES) {
      const b = el('button', { class: 'tab', role: 'tab', 'aria-selected': String(c.id === this.category), text: c.name });
      b.addEventListener('click', () => { this.category = c.id; this.buildPalette(); });
      tabs.append(b);
    }
    const items = $('#palette-items');
    items.innerHTML = '';
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const type in PARTS) {
      const def = PARTS[type];
      if (def.cat !== this.category) continue;
      const locked = !Career.unlocked(def);
      const item = el('button', { class: 'part-item' + (locked ? ' locked' : ''), title: def.desc || def.name });
      item.append(renderPartIcon(type, 56, dpr, this.viewRot)); // drawn the way the blueprint shows it
      item.append(el('span', { class: 'part-name', text: def.name }));
      item.append(el('span', { class: 'part-spec', text: locked ? `Tier ${def.tier}` : this.specLine(def) }));
      if (!Career.sandbox && !locked) item.append(el('span', { class: 'part-cost', text: money(def.cost) }));
      if (locked) item.append(el('span', { class: 'lock', text: 'Locked' }));
      this.bindPaletteItem(item, type, locked);
      items.append(item);
    }
    this.layout();
  },

  specLine(def) {
    if (def.wing) return `${def.wing.area} m² · ${def.wing.span} m span`;
    if (def.thrust) return `${def.thrust} kN · ${def.ispVac}s`;
    if (def.fuel) return `${def.fuel} t fuel`;
    return `${def.mass} t`;
  },

  bindPaletteItem(item, type, locked) {
    let start = null;
    item.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId, drag: false }; });
    item.addEventListener('pointermove', (e) => {
      if (!start || start.id !== e.pointerId || locked) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.drag && ((dy < -8 && Math.abs(dy) > Math.abs(dx) * 0.8) || (!isTouch && Math.hypot(dx, dy) > 6))) {
        start.drag = true;
        item.setPointerCapture(e.pointerId);
        this.drag = { type, fromPalette: true, offset: { x: 0, y: 0 }, rot: 0 };
        this.selected = null; this.renderInfo();
        if (this.in3D()) Render3D.editView(true);
      }
      if (start.drag) this.dragTo(e.clientX, e.clientY);
    });
    const end = (e) => {
      if (!start || start.id !== e.pointerId) return;
      const wasDrag = start.drag;
      start = null;
      if (e.type === 'pointercancel') { this.cancelDrag(); return; }
      if (locked) { this.showLocked(type); return; }
      if (wasDrag) this.dropDrag(e.clientY);
      else { this.cancelDrag(); this.quickAdd(type); }
    };
    item.addEventListener('pointerup', end);
    item.addEventListener('pointercancel', end);
  },

  showLocked(type) {
    const d = PARTS[type];
    UI.modal({
      kicker: `Tier ${d.tier} · ${TIERS[d.tier].name}`, title: d.name,
      body: `<p>${d.desc}</p><p class="muted">Unlock it in Research &amp; Development.</p>`,
      actions: [{ label: 'Close' }, { label: 'Open R&D', primary: true, onClick: () => App.showResearch() }],
    });
  },

  // Tap on a palette item: attach it somewhere sensible.
  quickAdd(type) {
    const area = this.viewArea();
    const centre = this.pointerToPart(area.cx, area.cy) || this.com || { x: 0, y: 0 };
    const def = PARTS[type];
    let spot = null;
    const ok = (t) => {
      const probe = { def, type, x: t.x, y: t.y };
      return !this.parts.some((o) => partsClash(probe, o)) && (!(isSurface(def) || def.pod) || this.parts.some((o) => partsMounted(probe, o)));
    };
    if (this.parts.length && (isSurface(def) || def.pod)) {
      // planes: a main wing goes through the fuselage just behind the centre of mass, tail surfaces through
      // the rearmost hull part, a canard through the front one, pods under a wing
      const g = (v) => Math.round(v * 4) / 4, hull = this.parts.filter((p) => !isSurface(p.def) && !p.def.pod && !p.def.wheel);
      const com = this.com || { x: 0, y: 0 }, tries = [];
      const rear = hull.reduce((m, p) => (!m || partRect(p).b < partRect(m).b ? p : m), null);
      const front = hull.reduce((m, p) => (!m || partRect(p).t > partRect(m).t ? p : m), null);
      const at = (y) => hull.find((p) => partRect(p).b <= y && partRect(p).t >= y) || rear;
      if (def.pod) for (const wg of this.parts.filter((p) => p.def.wing && !p.def.wing.control)) tries.push({ x: g(wg.x + def.w * 0.35), y: wg.y });
      else if (def.shape === 'vtail' && rear) for (const dy of [0, 0.5, 1]) tries.push({ x: g(partRect(rear).l - def.w / 2 + 0.25), y: g(rear.y + dy) });
      else if (def.wing && def.wing.control && type === 'canard' && front) tries.push({ x: front.x, y: g(front.y) });
      else if ((def.wing && def.wing.control) || type === 'stabilizer') { if (rear) for (const dy of [0, -0.5, 0.5]) tries.push({ x: rear.x, y: g(rear.y + dy) }); }
      else if (def.wing) for (const dy of [0, -0.5, 0.5, -1, 1]) { const y = g(com.y - def.h / 4 - 0.2 + dy), h = at(y); if (h) tries.push({ x: h.x, y }); }
      spot = tries.find(ok) || null;
    } else if (this.parts.length) {
      const centred = this.parts.filter((p) => Math.abs(p.x) < 0.01);
      const sorted = centred.sort((a, b) => partRect(b).t - partRect(a).t);
      const topP = sorted[0], botP = sorted[sorted.length - 1];
      const tries = [];
      const top = topP && { x: 0, y: partRect(topP).t + def.h / 2 };
      const bottom = botP && { x: 0, y: partRect(botP).b - def.h / 2 };
      if (def.side || def.leg || def.fin || def.shape === 'rcs' || def.shape === 'girder') {
        for (const p of centred) tries.push({ x: p.def.w / 2 + def.w / 2, y: def.fin ? partRect(p).b + def.h / 2 : p.y });
      } else if (def.control || def.chute || def.aero) tries.push(top, bottom);
      else tries.push(bottom, top);
      for (const t of tries.filter(Boolean)) if (ok(t)) { spot = t; break; }
    }
    if (!spot) { const s = this.snap(type, centre, []); spot = s.ok ? s : null; }
    // else the free attachment nearest the middle of the view, wherever it is on the craft
    if (!spot && this.parts.length) { const s = this.snap(type, centre, [], 0, Infinity); spot = s.ok && s.attached ? s : null; }
    if (!spot) { UI.toast('No room there. Drag the part into place instead.'); return; }
    this.addPart(type, spot.x, spot.y);
  },

  setKind(kind) {
    if (!VEHICLE_KINDS[kind] || kind === this.kind) return;
    if (this.kindSymmetry(kind)) UI.toast('Symmetry off: planes are drawn from the side');
    this.kind = kind;
    this.category = { rocket: 'command', plane: 'cabins', car: 'ground', heli: 'airEng' }[kind] || this.category;
    this.buildPalette();
    this.renderKind();
    this.changed();
    this.fitView();
    Sound.click();
  },
  // Planes are drawn from the side, where mirroring top and bottom makes no sense: symmetry goes off for
  // them and comes back as the player left it for everything else. True if it was just switched off.
  kindSymmetry(kind) {
    const want = kind === 'plane' ? false : store.get('rss.symmetry', true);
    if (want === this.symmetry) return false;
    this.symmetry = want;
    $('#btn-sym').setAttribute('aria-pressed', String(want));
    return !want;
  },
  renderKind() {
    document.querySelectorAll('[data-kind]').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.kind === this.kind));
      b.disabled = !!this.mp && !this.mp.kinds.includes(b.dataset.kind); // battles: planes, helicopters and cars
    });
  },
  // The launch button: Launch, or in a multiplayer room Fly (sandbox) and Ready (battle).
  renderLaunch() {
    const b = $('#btn-launch'), live = typeof MP !== 'undefined' && MP.live, ready = live && MP.pvp && MP.me && MP.me.ready;
    const t = !live ? 'Launch' : MP.pvp ? (ready ? 'Ready ✓' : 'Ready') : 'Fly';
    if (b.textContent !== t) b.textContent = t;
    b.classList.toggle('on', !!ready);
  },

  // Nose-to-tail length of a design (along part y).
  length(ps) {
    let lo = Infinity, hi = -Infinity;
    for (const p of ps) { const r = partRect(p); lo = Math.min(lo, r.b); hi = Math.max(hi, r.t); }
    return hi > lo ? hi - lo : 0;
  },

  renderStats() {
    const s = this.statsData;
    const set = (id, t) => { $(id).textContent = t; };
    set('#s-name', this.name);
    set('#s-mass', fmt.mass(s.mass));
    set('#s-thrust', `${Math.round(s.thrust / 1000).toLocaleString('en-US')} kN`);
    const kind = this.kind, rocket = kind === 'rocket';
    set('#s-twr', s.thrust ? s.twr.toFixed(2) : '—');
    set('#s-twr-label', rocket ? 'TWR' : 'T/W');
    $('#s-twr-row').hidden = kind === 'car';
    set('#s-dv-label', rocket ? 'Δv vac' : 'Fuel');
    set('#s-dv', rocket ? `${Math.round(s.dv).toLocaleString('en-US')} m/s` : fmt.mass(s.fuel));
    set('#s-stages', String(this.stages.length));
    $('#s-twr').className = s.thrust && s.twr < 1 && (rocket || kind === 'heli') ? 'bad' : '';
    $('#career-row').hidden = Career.sandbox;
    if (!Career.sandbox) {
      set('#s-cost', money(s.cost));
      set('#s-funds', money(Career.data.funds));
      $('#s-cost').className = s.cost > Career.data.funds ? 'bad' : '';
      $('#career-row').querySelectorAll('.cr-label')[1].textContent = this.mp ? 'Budget' : 'Funds';
      const btns = $('#career-row .cr-btns'); if (btns) btns.hidden = !!this.mp; // (no research or missions in a battle)
    }
    const warn = [], ps = this.parts.filter((p) => this.attached.has(p.id)), has = (f) => ps.some(f);
    if (!this.ctrl) warn.push(kind === 'car' ? 'Add a Driver Cab (or any command part) to drive.' : 'Add a command part (pod, probe, cockpit or cab) to fly.');
    else if (kind === 'plane') {
      const com = this.com, col = this.col, L = Math.max(4, s.air.length);
      if (!has((p) => p.def.wing && !p.def.wing.control)) warn.push('Add a wing to fly: drop it through the fuselage near the yellow centre of mass.');
      if (!has((p) => p.def.thrust)) warn.push('Add an engine: a propeller or a jet.');
      if (!has((p) => p.def.wheel) && !has((p) => p.def.float)) warn.push('Add landing gear under the fuselage to roll down the runway (or floats to start on the water).');
      else if (has((p) => p.def.wheel) && com) {
        const ahead = ps.some((p) => p.def.wheel && p.y > com.y), behind = ps.some((p) => p.def.wheel && p.y < com.y);
        if (!ahead || !behind) warn.push('Put landing gear both ahead of and behind the centre of mass, or it will tip onto its nose or tail.');
      }
      if (!has((p) => p.def.wing && p.def.wing.control)) warn.push('An elevator at the tail makes it much easier to steer.');
      if (!has((p) => p.def.shape === 'vtail' || (p.def.wing && p.def.wing.dihedral > 0.3))) warn.push('Add a tail fin, or it will yaw and spin.');
      if (com && col) {
        const m = (com.y - col.y) / L; // how far the lift sits behind the weight, in plane lengths
        if (m < -0.01) warn.push('The centre of lift (blue) is ahead of the centre of mass: it will flip over. Move the wing back or the weight forward.');
        else if (m > 0.22) warn.push('Very nose-heavy: the centre of lift is far behind the centre of mass, so it may not lift its nose. Move the wing forward.');
      }
      if (s.thrust && s.twr < 0.2) warn.push('Underpowered: it will struggle to take off.');
    } else if (kind === 'car') {
      if (!has((p) => p.def.wheel && p.def.wheel.drive)) warn.push('Add car wheels under the chassis to drive.');
    } else if (kind === 'heli') {
      if (!has((p) => p.def.air && p.def.air.kind === 'rotor')) warn.push('Add a main rotor on top.');
      else if (s.twr < 1) warn.push('Too heavy to lift off: the rotor needs T/W above 1.');
    } else if (!s.thrust) warn.push('No engine fires in stage 1.');
    else if (s.twr < 1) warn.push('Too heavy to lift off: TWR below 1.');
    if (s.loose) warn.push(`${s.loose} part${s.loose > 1 ? 's' : ''} not attached. They stay behind.`);
    if (this.mp) warn.push(...MP.designProblems(s, ps, kind)); // the battle's budget, and the carrier's size limits
    else if (s.locked.length) warn.push(`Uses ${s.locked.length} locked part${s.locked.length > 1 ? 's' : ''}. Unlock them in R&D.`);
    else if (!Career.sandbox && s.cost > Career.data.funds) warn.push(`Costs ${money(s.cost - Career.data.funds)} more than you have.`);
    $('#s-warn').textContent = warn.join(' ');
    $('#s-warn').hidden = !warn.length;
    const a = s.air, airLine = kind === 'plane' && a.stall > 0;
    $('#s-air').hidden = !airLine;
    if (airLine) {
      $('#s-air').textContent = `Stalls at ${Math.round(a.stall * 3.6)} km/h (${Math.round(a.stallFlaps * 3.6)} with flaps) · lifts off near ${Math.round(a.stallFlaps * 1.2 * 3.6)} km/h · wing ${Math.round(a.wingArea)} m²`
        + ` · strong to ${a.g.toFixed(a.g < 10 ? 1 : 0)} g · never exceed ${Math.round(a.vne * 3.6)} km/h${a.vne < 300 ? '' : ' (more up high)'}`;
    }
    const list = $('#s-stage-list');
    list.innerHTML = '';
    const byId = new Map(this.parts.map((p) => [p.id, p]));
    this.stages.forEach((st, i) => {
      const dv = s.perStage[i] || 0, twr = s.stageTwr[i] || 0;
      list.append(el('li', null,
        el('span', { class: 'stage-badge', text: String(i + 1) }),
        el('span', { class: 'stage-desc', text: describeStage(st, byId) }),
        el('span', { class: 'stage-dv', text: dv > 0.5 ? `${Math.round(dv)} m/s${twr ? ` · ${twr.toFixed(1)}` : ''}` : '' })));
    });
    $('#btn-launch').disabled = !this.ctrl;
    this.renderLaunch();
  },

  renderInfo() {
    const p = this.selected;
    const box = $('#part-info');
    $('#build-ui').classList.toggle('has-info', !!p); // phones: the 3D hint gives way to it
    if (!p) { box.hidden = true; this.layout(); return; }
    box.hidden = false;
    if (this.multi) {
      const g = [...this.sel], mass = g.reduce((s, q) => s + q.def.mass, 0), cost = g.reduce((s, q) => s + (q.def.cost || 0), 0);
      $('#pi-name').textContent = `${g.length} parts selected`;
      $('#pi-specs').textContent = `${mass.toFixed(2)} t` + (Career.sandbox ? '' : ` · ${money(cost)}`);
      $('#pi-desc').textContent = isTouch ? 'Drag any of them to move them together. Copy to paste them again (here or in another design).'
        : 'Drag any of them to move them together · Ctrl+C / Ctrl+V copy and paste (also into another design) · R turns them · Delete removes them.';
      this.layout();
      return;
    }
    const d = p.def;
    $('#pi-name').textContent = d.name + (p.mirror ? ' ×2' : '');
    $('#pi-desc').textContent = d.desc || '';
    const specs = [`${d.mass} t`];
    if (d.fuel) specs.push(`${d.fuel} t ${d.solid ? 'solid fuel' : 'fuel'}`);
    if (d.thrust) specs.push(`${d.thrust} kN`, `Isp ${d.ispSL}–${d.ispVac} s`);
    if (d.torque) specs.push(`${d.torque / 1000} kN·m`);
    if (d.heatShield || d.maxTemp !== 2000) specs.push(`max ${d.maxTemp} K`);
    if (!Career.sandbox) specs.push(money(d.cost));
    $('#pi-specs').textContent = specs.join(' · ');
    this.layout();
  },

  // Panels and buttons sit above the tray, whatever its height (it changes with the screen and the font),
  // and on phones the Fit button stays clear of the part panel.
  layout() {
    const ui = $('#build-ui');
    if (!ui || ui.hidden) return;
    ui.style.setProperty('--pal-h', `${Math.round(innerHeight - $('#palette').getBoundingClientRect().top)}px`);
    const fit = $('.fit-col'), info = $('#part-info');
    fit.style.bottom = '';
    if (info.hidden) return;
    const i = info.getBoundingClientRect(), f = fit.getBoundingClientRect();
    if (f.bottom > i.top - 6 && f.top < i.bottom && f.right > i.left && f.left < i.right) fit.style.bottom = `${Math.round(innerHeight - i.top + 8)}px`;
  },

  // ---------------------------------------------------------------- modals
  // ---------------------------------------------------------------- saved designs
  // The hangar keeps up to 100 designs in this browser. The blueprint remembers which one it is (savedAs),
  // so Save overwrites it in place and the button shows when there are changes that aren't saved yet.
  designs() { return store.get('rss.hangar', []).filter((x) => x && x.name && Array.isArray(x.parts)); },
  snapOf(d) { return JSON.stringify([d.kind || 'rocket', d.parts]); },
  markSaved(d) { this.savedAs = d.name; this.savedSnap = this.snapOf(d); this.save(); this.renderSaveState(); },
  isDirty() { return !this.savedAs || this.snapOf(this.serialize()) !== this.savedSnap; },
  // work that would be lost by loading something else: changes since the last save, or since a template was loaded
  unsavedWork() { return this.parts.length > 0 && (this.savedAs ? this.isDirty() : this.snapOf(this.serialize()) !== this.baseSnap); },
  renderSaveState() {
    const b = $('#btn-save');
    if (!b) return;
    const dirty = this.isDirty();
    b.classList.toggle('unsaved', !!this.savedAs && dirty);
    b.classList.toggle('saved', !dirty);
    b.querySelector('.save-text').textContent = dirty ? 'Save' : 'Saved';
    b.title = !this.savedAs ? 'Save this design to the hangar (Ctrl+S)' : dirty ? `Save the changes to “${this.savedAs}” (Ctrl+S)` : `“${this.savedAs}” is saved in the hangar`;
  },
  storeDesign(name) {
    name = (name || '').trim().slice(0, 40) || (VEHICLE_KINDS[this.kind] ? VEHICLE_KINDS[this.kind].name : 'Rocket');
    this.name = name;
    const d = { ...this.serialize(), name, savedAt: Date.now() };
    const list = this.designs().filter((x) => x.name !== name);
    list.unshift(d);
    if (!store.set('rss.hangar', list.slice(0, 100))) { UI.toast('Could not save: this browser is not letting the game store anything', 'warn'); return false; }
    this.markSaved(d);
    this.renderStats();
    UI.toast(list.length > 100 ? `Saved “${name}” (the oldest design made room)` : `Saved “${name}”`);
    return true;
  },
  // Save button: straight into the design it already is, otherwise ask for a name.
  quickSave() {
    if (!this.parts.length) { UI.toast('Nothing to save yet: add some parts first'); return; }
    if (this.savedAs && this.designs().some((x) => x.name === this.savedAs)) { if (this.isDirty()) this.storeDesign(this.savedAs); else UI.toast(`“${this.savedAs}” is already saved`); return; }
    this.saveAs();
  },
  // A name box that warns before it replaces a different design with the same name.
  nameField(onSubmit) {
    const input = el('input', { type: 'text', maxlength: '40', value: this.name, 'aria-label': 'Design name', autocomplete: 'off', spellcheck: 'false' });
    const note = el('p', { class: 'hangar-note' });
    const check = () => {
      const n = input.value.trim();
      const clash = n && n !== this.savedAs && this.designs().some((x) => x.name === n);
      note.textContent = clash ? `You already have a design called “${n}”. Saving replaces it.` : '';
      note.hidden = !clash;
      return clash;
    };
    input.addEventListener('input', check);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } });
    check();
    return { input, note, check };
  },
  saveAs(after) {
    if (!this.parts.length) { UI.toast('Nothing to save yet: add some parts first'); return; }
    const wrap = el('div', { class: 'hangar' });
    const done = () => { if (this.storeDesign(f.input.value)) { UI.closeModal(); if (after) after(); } };
    const f = this.nameField(done);
    wrap.append(el('div', { class: 'hangar-save' }, f.input), f.note,
      el('p', { class: 'hangar-hint', text: 'Saved designs live in the Hangar, ready to load again or to copy as a code and share.' }));
    UI.modal({ kicker: 'Hangar', title: 'Save design', body: wrap, actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, keepOpen: true, onClick: done }] });
    f.input.focus(); f.input.select();
  },

  // Designs travel as a short text code: "RSS1." + base64url of compact JSON.
  designCode(d) {
    const j = JSON.stringify({ n: d.name, k: d.kind || 'rocket', p: d.parts.map((q) => [q.type, q.x, q.y, q.flip ? 1 : 0, q.rot || 0]) });
    const bin = String.fromCharCode(...new TextEncoder().encode(j));
    return 'RSS1.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  parseCode(text) {
    const m = /RSS1\.([A-Za-z0-9_-]+)/.exec(text || '');
    if (!m) return null;
    try {
      const b = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
      const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (ch) => ch.charCodeAt(0))));
      const parts = (o.p || []).filter((q) => Array.isArray(q) && PARTS[q[0]] && isFinite(q[1]) && isFinite(q[2]))
        .map(([type, x, y, flip, rot]) => ({ type, x: +x, y: +y, flip: !!flip, rot: (rot | 0) & 3 }));
      if (!parts.length) return null;
      return { name: String(o.n || 'Imported').slice(0, 40), kind: VEHICLE_KINDS[o.k] ? o.k : 'rocket', parts, dropped: (o.p || []).length - parts.length };
    } catch (e) { return null; }
  },
  copyCode(d) {
    const code = this.designCode(d);
    const fallback = () => {
      const ta = el('textarea', { class: 'code-box', readonly: '', rows: '4', 'aria-label': 'Design code' });
      ta.value = code;
      UI.modal({ kicker: 'Hangar', title: `Code for “${d.name}”`, body: el('div', null, el('p', { class: 'hangar-hint', text: 'Copy this code. Paste it into “Paste a code” in any copy of the game to get the design back.' }), ta), actions: [{ label: 'Done', primary: true }] });
      ta.focus(); ta.select();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(() => UI.toast(`Copied the code for “${d.name}”`), fallback);
    else fallback();
  },
  pasteCode() {
    const ta = el('textarea', { class: 'code-box', rows: '4', placeholder: 'RSS1.…', 'aria-label': 'Design code', spellcheck: 'false' });
    const note = el('p', { class: 'hangar-note', hidden: '' });
    const go = (keep) => {
      const d = this.parseCode(ta.value);
      if (!d) { note.textContent = 'That is not a design code. Codes start with RSS1.'; note.hidden = false; return; }
      UI.closeModal();
      this.savedAs = null;
      this.loadDesign(d);
      this.baseSnap = null; // pasted in: counts as unsaved work until it is saved
      if (keep) { // never quietly replace one of your own designs that happens to share the name
        const taken = new Set(this.designs().map((x) => x.name));
        let n = d.name, i = 2;
        while (taken.has(n)) n = `${d.name.slice(0, 35)} (${i++})`;
        this.storeDesign(n);
      }
      if (d.dropped) UI.toast(`${d.dropped} part${d.dropped > 1 ? 's' : ''} from a newer version were left out`, 'warn');
      else if (!keep) UI.toast(`Loaded “${d.name}”`);
    };
    UI.modal({
      kicker: 'Hangar', title: 'Paste a design code',
      body: el('div', null, el('p', { class: 'hangar-hint', text: 'Paste a code someone copied from their hangar.' }), ta, note),
      actions: [{ label: 'Cancel' }, { label: 'Load', keepOpen: true, onClick: () => go(false) }, { label: 'Load and save', primary: true, keepOpen: true, onClick: () => go(true) }],
    });
    ta.focus();
  },

  openHangar() {
    const wrap = el('div', { class: 'hangar' });
    const saves = this.designs();
    const save = () => { if (this.storeDesign(f.input.value)) UI.closeModal(); };
    const f = this.nameField(save);
    f.input.id = 'hangar-name';
    const saveBtn = el('button', { class: 'btn primary small', text: 'Save' });
    saveBtn.addEventListener('click', save);
    wrap.append(el('div', { class: 'hangar-save' }, f.input, saveBtn), f.note);
    const tools = el('div', { class: 'hangar-tools' });
    const paste = el('button', { class: 'btn small', text: 'Paste a code' });
    paste.prepend(icon('copy'));
    paste.addEventListener('click', () => this.pasteCode());
    // (phones have no room for a Clear button on the top bar)
    const clear = el('button', { class: 'btn small danger', text: 'Clear the blueprint' });
    clear.prepend(icon('trash'));
    clear.addEventListener('click', () => { UI.closeModal(); this.confirmClear(); });
    tools.append(paste, clear);
    wrap.append(tools);
    wrap.append(el('h3', { class: 'summary-h', text: saves.length ? `Your designs · ${saves.length}` : 'Your designs' }));
    if (!saves.length) wrap.append(el('p', { class: 'hangar-hint', text: 'Nothing saved yet. Name the blueprint above and press Save, or use the Save button next to its name.' }));
    else {
      const list = el('div', { class: 'design-list' });
      const dpr = Math.min(devicePixelRatio || 1, 2);
      for (const s of saves) {
        const known = s.parts.filter((q) => PARTS[q.type]);
        const kind = VEHICLE_KINDS[s.kind] ? VEHICLE_KINDS[s.kind].name : 'Rocket';
        const when = s.savedAt ? new Date(s.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
        const current = s.name === this.savedAs;
        const main = el('button', { class: 'design-main', title: `Load “${s.name}”` },
          renderDesignThumb(s, 64, 64, dpr, (VEHICLE_KINDS[s.kind] || VEHICLE_KINDS.rocket).launchRot),
          el('span', { class: 'design-text' },
            el('span', { class: 'template-name', text: s.name }),
            el('span', { class: 'template-blurb', text: `${kind} · ${known.length} parts${Career.sandbox ? '' : ' · ' + money(designCost(known))}${when ? ' · ' + when : ''}${current ? ' · on the blueprint' : ''}` })));
        const code = el('button', { class: 'btn icon-only small', 'aria-label': `Copy a code for ${s.name}`, title: 'Copy as a code to share' });
        code.append(icon('copy'));
        const del = el('button', { class: 'btn icon-only small danger', 'aria-label': `Delete ${s.name}`, title: 'Delete' });
        del.append(icon('trash'));
        const row = el('div', { class: 'design' + (current ? ' current' : '') }, main, code, del);
        main.addEventListener('click', () => {
          const go = () => { UI.closeModal(); this.loadDesign(s); this.markSaved(s); UI.toast(`Loaded “${s.name}”`); };
          if (s.name !== this.savedAs && this.unsavedWork()) this.confirmLeave(go);
          else go();
        });
        code.addEventListener('click', () => this.copyCode(s));
        // two taps to delete: the first one asks
        del.addEventListener('click', () => {
          if (!del.classList.contains('armed')) { del.classList.add('armed'); del.textContent = 'Delete?'; setTimeout(() => { if (del.isConnected && del.classList.contains('armed')) { del.classList.remove('armed'); del.textContent = ''; del.append(icon('trash')); } }, 2500); return; }
          store.set('rss.hangar', this.designs().filter((x) => x.name !== s.name));
          if (s.name === this.savedAs) { this.savedAs = null; this.save(); this.renderSaveState(); }
          row.remove();
          UI.toast(`Deleted “${s.name}”`);
        });
        list.append(row);
      }
      wrap.append(list);
    }
    const groups = { rocket: 'Example rockets', plane: 'Planes', military: 'Military aircraft', car: 'Cars', heli: 'Helicopters' };
    for (const kind in groups) {
      const keys = Object.keys(TEMPLATES).filter((k) => (TEMPLATES[k].military ? 'military' : TEMPLATES[k].kind || 'rocket') === kind);
      if (!keys.length) continue;
      wrap.append(el('h3', { class: 'summary-h', text: groups[kind] }));
      const tl = el('div', { class: 'template-list' });
      for (const key of keys) {
        const t = TEMPLATES[key];
        const locked = !Career.sandbox && t.tier > Career.data.tier;
        const b = el('button', { class: 'template' + (locked ? ' locked' : '') },
          el('span', { class: 'template-name', text: t.name + (locked ? ` · Tier ${t.tier}` : '') }),
          el('span', { class: 'template-blurb', text: t.blurb }));
        b.addEventListener('click', () => {
          const go = () => { UI.closeModal(); this.loadTemplate(key); };
          if (this.unsavedWork()) this.confirmLeave(go); else go();
        });
        tl.append(b);
      }
      wrap.append(tl);
    }
    UI.modal({ kicker: 'Hangar', title: 'Vehicles', body: wrap, actions: [{ label: 'Close' }] });
    $('#modal-card').scrollTop = 0; // focusing Close would otherwise open the list scrolled to the bottom
    if (!isTouch) f.input.focus({ preventScroll: true });
  },
  // Loading over a saved design with unsaved changes: offer to keep them first.
  confirmLeave(go) {
    UI.modal({
      title: this.savedAs ? `Save the changes to “${this.savedAs}”?` : 'Save this design first?', body: 'Loading another design replaces the blueprint.',
      actions: [{ label: 'Cancel' }, { label: 'Discard', danger: true, onClick: go }, { label: 'Save first', primary: true, onClick: () => { if (!this.savedAs) this.saveAs(go); else if (this.storeDesign(this.savedAs)) go(); } }],
    });
  },

  // ---------------------------------------------------------------- input
  bindDom() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (App.scene !== 'build') return;
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (this.pointers.size === 2) {
        if (this.drag && !this.drag.fromPalette) this.cancelDrag();
        this.pan = null;
        this.pinch = this.pinchInfo();
        this.orbit = null;
        return;
      }
      if (this.in3D()) { this.down3D(e); return; }
      const w = this.screenToWorld(e.clientX, e.clientY);
      const hit = this.hitPart(w), add = e.shiftKey || e.ctrlKey || e.metaKey, pick = add || this.selectMode;
      if (hit && e.button === 0 && pick && (add || !this.sel.has(hit))) this.toggleSel(hit); // pick several
      else if (hit && e.button !== 2 && e.button !== 1) this.grab(hit, w, e.pointerId);
      else if (pick && e.button === 0) this.box = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, add };
      else {
        this.pan = { pointerId: e.pointerId };
        this.panMoved = false;
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (App.scene !== 'build') return;
      const p = this.pointers.get(e.pointerId);
      if (!p) { if (e.pointerType === 'mouse') this.hover(e.clientX, e.clientY); return; }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 2 && this.pinch) {
        const now = this.pinchInfo();
        if (this.in3D()) { // pinch zooms, two fingers moving together slide the view
          this.cam.scale = clamp(this.cam.scale * (now.d / this.pinch.d), 3, 90);
          Render3D.panBy(now.cx - this.pinch.cx, now.cy - this.pinch.cy);
        } else {
          this.zoomAt(now.d / this.pinch.d, now.cx, now.cy);
          this.cam.x -= (now.cx - this.pinch.cx) / this.cam.scale;
          this.cam.y += (now.cy - this.pinch.cy) / this.cam.scale;
        }
        this.pinch = now;
        return;
      }
      if (this.orbit && this.orbit.pointerId === e.pointerId) {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 6) this.orbit.moved = true;
        if (this.orbit.moved) Render3D.orbitBy(dx, dy);
        return;
      }
      if (this.pan3d && this.pan3d.pointerId === e.pointerId) { Render3D.panBy(dx, dy); return; }
      if (this.box && this.box.pointerId === e.pointerId) { this.box.x = e.clientX; this.box.y = e.clientY; this.showBox(this.box); return; }
      if (this.drag && !this.drag.fromPalette && this.drag.pointerId === e.pointerId) {
        if (!this.drag.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6) return;
        if (!this.drag.moved && this.in3D()) Render3D.editView(true);
        this.drag.moved = true;
        this.dragTo(e.clientX, e.clientY);
      } else if (this.pan && this.pan.pointerId === e.pointerId) {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 4) this.panMoved = true;
        this.cam.x -= dx / this.cam.scale;
        this.cam.y += dy / this.cam.scale;
      }
    });
    const up = (e) => {
      if (App.scene !== 'build') return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pan3d && this.pan3d.pointerId === e.pointerId) { this.pan3d = null; return; }
      if (this.box && this.box.pointerId === e.pointerId) {
        const b = this.box;
        this.box = null; this.showBox(null);
        if (e.type === 'pointercancel') return;
        if (Math.hypot(b.x - b.sx, b.y - b.sy) > 6) this.boxSelect(b.sx, b.sy, b.x, b.y, b.add);
        else if (!b.add) { this.selected = null; this.renderInfo(); } // a tap on empty blueprint clears it
        return;
      }
      if (this.orbit && this.orbit.pointerId === e.pointerId) {
        // a tap selects the part under it (or clears the selection)
        if (!this.orbit.moved && e.type !== 'pointercancel') { this.selected = this.orbit.part || null; this.renderInfo(); }
        this.orbit = null;
        return;
      }
      if (this.drag && !this.drag.fromPalette && this.drag.pointerId === e.pointerId) {
        if (e.type === 'pointercancel') this.cancelDrag();
        else if (this.drag.moved) this.dropDrag(e.clientY);
        else { const d = this.drag; this.endDrag(); if (this.selectMode && d.group) this.toggleSel(d.part); } // Select mode: a tap drops it from the group
      }
      if (this.pan && this.pan.pointerId === e.pointerId) {
        if (!this.panMoved && e.type !== 'pointercancel') { this.selected = null; this.renderInfo(); }
        this.pan = null;
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.hover3d = null; });
    c.addEventListener('wheel', (e) => {
      if (App.scene !== 'build') return;
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      if (this.in3D()) this.cam.scale = clamp(this.cam.scale * f, 3, 90);
      else this.zoomAt(f, e.clientX, e.clientY);
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('keydown', (e) => {
      if (App.scene !== 'build' || UI.modalOpen || e.target.tagName === 'INPUT') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyS') { e.preventDefault(); if (e.shiftKey) this.saveAs(); else this.quickSave(); return; }
      if ((e.code === 'Delete' || e.code === 'Backspace') && this.selected) { e.preventDefault(); this.deleteSel(); }
      else if (mod && e.code === 'KeyA') { e.preventDefault(); this.selectAll(); }
      else if (mod && e.code === 'KeyC') { e.preventDefault(); this.copySel(); }
      else if (mod && e.code === 'KeyX') { e.preventDefault(); this.copySel(true); }
      else if (mod && e.code === 'KeyV') { e.preventDefault(); this.paste(); }
      else if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
      else if (mod && e.code === 'KeyY') { e.preventDefault(); this.redo(); }
      else if (mod && e.code === 'KeyD') { e.preventDefault(); this.duplicateSelected(); }
      else if (e.code === 'Enter' && this.ctrl) App.launch();
      else if (e.code === 'KeyF') this.fitView();
      else if (e.code === 'KeyR' && !mod) this.rotateSel();
      else if (e.code === 'KeyV') App.setPreview3D(!Settings.get('build3d'));
      else if (e.code === 'Escape') { if (this.drag) this.cancelDrag(); else { this.selected = null; this.renderInfo(); if (this.selectMode) this.setSelectMode(false); } }
      else if (this.selected && !this.drag && e.code.startsWith('Arrow')) {
        e.preventDefault();
        const k = e.shiftKey ? 1 : 0.25, dir = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, k], ArrowDown: [0, -k] }[e.code];
        if (dir) this.nudgeSel(dir[0], dir[1]);
      }
    });

    $('#btn-launch').addEventListener('click', () => App.launch());
    $('#btn-delete').addEventListener('click', () => this.deleteSel());
    $('#btn-dup').addEventListener('click', () => this.duplicateSelected());
    $('#btn-copy').addEventListener('click', () => this.copySel());
    $('#btn-rotate').addEventListener('click', () => this.rotateSel());
    $('#btn-select').addEventListener('click', () => this.setSelectMode(!this.selectMode));
    $('#btn-paste').addEventListener('click', () => this.paste());
    $('#btn-paste').hidden = !this.clip;
    $('#btn-fit').addEventListener('click', () => this.fitView());
    $('#btn-undo').addEventListener('click', () => this.undo());
    $('#btn-redo').addEventListener('click', () => this.redo());
    const sym = $('#btn-sym');
    sym.setAttribute('aria-pressed', String(this.symmetry));
    sym.addEventListener('click', () => {
      this.symmetry = !this.symmetry;
      if (this.kind !== 'plane') store.set('rss.symmetry', this.symmetry); // planes keep their own (off) default
      sym.setAttribute('aria-pressed', String(this.symmetry));
      UI.toast(this.symmetry ? 'Symmetry on: parts are mirrored across the centre line' : 'Symmetry off');
    });
    $('#btn-clear').addEventListener('click', () => this.confirmClear());
    $('#btn-save').addEventListener('click', () => this.quickSave());
    $('#s-name').addEventListener('click', () => this.saveAs()); // tap the name to rename or save a copy
    // the stats panel folds down to its name and numbers (on by default on short phone screens)
    const stats = $('#stats'), tog = $('#btn-stats');
    const fold = (on) => {
      stats.classList.toggle('collapsed', on);
      this.layout();
      tog.setAttribute('aria-expanded', String(!on));
      tog.setAttribute('aria-label', on ? 'Show more' : 'Show less'); tog.title = tog.getAttribute('aria-label');
    };
    fold(store.get('rss.statsFolded', innerHeight < 520 || (innerHeight < 700 && innerWidth <= 760)));
    tog.addEventListener('click', () => { const on = !stats.classList.contains('collapsed'); fold(on); store.set('rss.statsFolded', on); });
    $('#btn-templates').addEventListener('click', () => this.openHangar());
    document.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => this.setKind(b.dataset.kind)));
    $('#btn-rd').addEventListener('click', () => App.showResearch());
    $('#btn-missions').addEventListener('click', () => App.showMissions());
  },

  confirmClear() {
    UI.modal({
      title: 'Clear the blueprint?', body: 'Every part on the blueprint will be removed. You can undo this.',
      actions: [{ label: 'Cancel' }, { label: 'Clear', danger: true, primary: true, onClick: () => { this.parts = []; this.selected = null; this.savedAs = null; this.changed(); this.renderInfo(); } }],
    });
  },

  pinchInfo() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  },
  zoomAt(f, sx, sy) {
    const before = this.screenToDisp(sx, sy);
    this.cam.scale = clamp(this.cam.scale * f, 3, 90);
    const after = this.screenToDisp(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
  },

  // Start moving a part from where the pointer took hold of it (w: that point in part space).
  grab(part, w, pointerId) {
    this.drag = { part, type: part.type, offset: { x: w.x - part.x, y: w.y - part.y }, orig: { x: part.x, y: part.y }, moved: false, pointerId };
    if (this.multi && this.sel.has(part)) { // the whole selection moves with it
      const group = [...this.sel], origs = new Map();
      for (const p of group) for (const q of [p, p.mirror]) if (q) origs.set(q, { x: q.x, y: q.y });
      Object.assign(this.drag, { group, origs });
      this._primary = part;
      this.renderInfo();
      return;
    }
    if (part.mirror) this.drag.mirrorOrig = { x: part.mirror.x, y: part.mirror.y };
    this.selected = part;
    this.renderInfo();
  },
  // 3D: a mouse drags any part; a finger drags the part already selected (tap it first), so a finger on
  // the craft can still turn the view. Anything else orbits; the right or middle button slides the view.
  down3D(e) {
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) { this.pan3d = { pointerId: e.pointerId }; return; }
    const hit = Render3D.pickPart(e.clientX, e.clientY), part = hit && hit.part;
    const add = e.shiftKey || e.ctrlKey || e.metaKey, pick = add || this.selectMode;
    if (pick && part && (add || !this.sel.has(part))) { this.toggleSel(part); return; }
    if (pick && !part) { this.box = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, add }; return; }
    const sel = this.selected, mine = part && (this.sel.has(part) || (sel && part === sel.mirror));
    if (part && (e.pointerType === 'mouse' || mine)) {
      // hold it where the pointer took it; if the blueprint is side-on just now (the view turns to face it
      // once the part moves), the part comes to the pointer instead
      const at = this.pointerToPart(e.clientX, e.clientY), r = partRect(part);
      const near = at && at.x > r.l - 1 && at.x < r.r + 1 && at.y > r.b - 1 && at.y < r.t + 1;
      this.grab(part, near ? at : part, e.pointerId);
      return;
    }
    this.orbit = { pointerId: e.pointerId, moved: false, part };
  },
  // Mouse hover: show which part a click would take.
  hover(cx, cy) {
    const c = this.canvas;
    if (this.in3D()) {
      const hit = Render3D.pickPart(cx, cy);
      this.hover3d = hit && hit.part ? hit.part : null;
      c.style.cursor = this.hover3d ? 'grab' : 'default';
    } else c.style.cursor = this.hitPart(this.screenToWorld(cx, cy)) ? 'grab' : 'default';
  },
  // What the 3D view draws as the part being placed: the part and, with symmetry, its mirror twin.
  ghosts() {
    const d = this.drag;
    if (!d || !d.fromPalette || !d.ghost) return [];
    const g = d.ghost, rot = d.rot || 0, list = [{ type: d.type, x: g.x, y: g.y, rot, flip: g.x < 0, ok: g.ok }];
    if (g.ok && this.symmetry && this.mirrorOk(d.type, g.x, g.y, [], rot)) list.push({ type: d.type, x: -g.x, y: g.y, rot: mirrorRot(rot), flip: -g.x < 0, ok: true });
    return list;
  },
  markers3d() { return !this.drag; },

  dragTo(cx, cy) {
    const d = this.drag;
    d.last = { x: cx, y: cy };
    const lift = d.fromPalette && isTouch ? 44 : 0; // keep a part from the tray visible above the finger
    const w = this.pointerToPart(cx, cy - lift);
    if (!w) return; // the 3D view sees the blueprint edge-on: keep the last spot
    this.mpp = w.mpp;
    const want = { x: w.x - d.offset.x, y: w.y - d.offset.y };
    const pal = $('#palette'), overPalette = cy > pal.getBoundingClientRect().top;
    pal.classList.toggle('drop-remove', !d.fromPalette);
    pal.classList.toggle('drop-hot', overPalette);
    if (d.group) { // the grabbed part snaps; the rest keep their places around it
      const s = this.snap(d.type, want, [...d.origs.keys()], d.part.rot || 0), dx = s.x - d.orig.x, dy = s.y - d.orig.y;
      for (const [q, o] of d.origs) { q.x = o.x; q.y = o.y; }
      for (const q of d.group) { const o = d.origs.get(q); q.x = +(o.x + dx).toFixed(3); q.y = +(o.y + dy).toFixed(3); }
      this.followTwins(d.group, dx, dy, d.origs);
      const outside = [...d.origs.keys()].filter((q) => !d.group.includes(q));
      d.ghost = { ...s, ok: this.groupFits(d.group, outside) };
      return;
    }
    const ignore = d.part ? [d.part, d.part.mirror].filter(Boolean) : [];
    const rot = d.part ? d.part.rot || 0 : d.rot || 0;
    const s = this.snap(d.type, want, ignore, rot);
    if (isTouch && s.attached && s.ok && !(d.ghost && d.ghost.attached && d.ghost.ok) && navigator.vibrate) navigator.vibrate(8); // a tick as it snaps on
    d.ghost = s;
    if (d.part) {
      d.part.x = s.x; d.part.y = s.y;
      if (d.part.mirror && this.mirrorOk(d.type, s.x, s.y, ignore, rot)) { d.part.mirror.x = -s.x; d.part.mirror.y = s.y; }
    }
  },

  // The drag is over: let the 3D view move again and the tray stop offering to take the part back.
  endDrag() {
    this.drag = null;
    this.mpp = null;
    if (Render3D.ready) Render3D.editView(false);
    const pal = $('#palette');
    pal.classList.remove('drop-remove', 'drop-hot');
  },

  dropDrag(clientY) {
    const d = this.drag;
    this.endDrag();
    if (!d || !d.ghost) return;
    const overPalette = clientY > $('#palette').getBoundingClientRect().top;
    if (d.fromPalette) {
      if (overPalette || !d.ghost.ok) return;
      this.addPart(d.type, d.ghost.x, d.ghost.y, d.rot || 0);
      return;
    }
    const p = d.part;
    if (!this.parts.includes(p)) return; // gone while it was being dragged
    if (d.group) {
      if (overPalette) { this.deleteSel(); return; }
      if (!d.ghost.ok) { this.cancelDrag(d); this.changed(); return; }
      for (const q of d.origs.keys()) q.flip = q.x < 0;
      this.linkMirrors();
      this.changed();
      this.renderInfo();
      return;
    }
    if (overPalette) { this.selected = p; this.deleteSelected(); return; }
    if (!d.ghost.ok) { this.cancelDrag(d); this.changed(); return; }
    p.flip = p.x < 0;
    if (p.mirror) {
      const m = p.mirror;
      if (this.mirrorOk(p.type, p.x, p.y, [p, m], p.rot || 0)) { m.x = -p.x; m.y = p.y; m.flip = m.x < 0; }
      else { if (d.mirrorOrig) { m.x = d.mirrorOrig.x; m.y = d.mirrorOrig.y; } p.mirror = null; m.mirror = null; }
    } else if (this.symmetry && this.mirrorOk(p.type, p.x, p.y, [p], p.rot || 0)) {
      const m = makePart(p.type, -p.x, p.y, { flip: -p.x < 0, rot: mirrorRot(p.rot) });
      this.parts.push(m); p.mirror = m; m.mirror = p;
    }
    this.changed();
    this.renderInfo();
  },

  cancelDrag(dd) {
    const d = dd || this.drag;
    if (d && d.origs) for (const [q, o] of d.origs) { q.x = o.x; q.y = o.y; }
    else if (d && d.part) {
      d.part.x = d.orig.x; d.part.y = d.orig.y;
      if (d.part.mirror && d.mirrorOrig) { d.part.mirror.x = d.mirrorOrig.x; d.part.mirror.y = d.mirrorOrig.y; }
    }
    this.endDrag();
  },

  // ---------------------------------------------------------------- render
  render(ctx, W, H, dpr) {
    const S = this.cam.scale * dpr;
    const Wd = W * dpr, Hd = H * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, Hd);
    g.addColorStop(0, '#0b1c33'); g.addColorStop(1, '#071222');
    ctx.fillStyle = g; ctx.fillRect(0, 0, Wd, Hd);
    const X = (x) => Wd / 2 + (x - this.cam.x) * S, Y = (y) => Hd / 2 - (y - this.cam.y) * S;
    const x0 = this.cam.x - Wd / 2 / S, x1 = this.cam.x + Wd / 2 / S;
    const y0 = this.cam.y - Hd / 2 / S, y1 = this.cam.y + Hd / 2 / S;
    const minor = this.cam.scale > 14 ? 0.5 : 1;
    ctx.lineWidth = 1;
    for (const [stepv, col] of [[minor, 'rgba(120,170,230,0.07)'], [2, 'rgba(120,170,230,0.14)']]) {
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let x = Math.floor(x0 / stepv) * stepv; x <= x1; x += stepv) { const sx = Math.round(X(x)) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, Hd); }
      for (let y = Math.floor(y0 / stepv) * stepv; y <= y1; y += stepv) { const sy = Math.round(Y(y)) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(Wd, sy); }
      ctx.stroke();
    }
    // ruler on the left edge, in metres
    ctx.fillStyle = 'rgba(150,185,230,0.45)';
    ctx.font = `500 ${9 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'left';
    const rot = this.viewRot;
    if (!rot) for (let y = Math.ceil(y0 / 2) * 2; y <= y1; y += 2) if (this.cam.scale > 8) ctx.fillText(`${y} m`, 4 * dpr, Y(y) - 3 * dpr);
    // the symmetry axis is the part-space centre line, wherever the view turns it
    ctx.strokeStyle = this.symmetry ? 'rgba(255,181,71,0.35)' : 'rgba(120,170,230,0.25)';
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    const ax = this.toDisp(0, 1), far = (Wd + Hd) / S;
    ctx.beginPath(); ctx.moveTo(X(-ax.x * far), Y(-ax.y * far)); ctx.lineTo(X(ax.x * far), Y(ax.y * far)); ctx.stroke();
    ctx.setLineDash([]);
    const XY = (x, y) => { const d = this.toDisp(x, y); return [X(d.x), Y(d.y)]; };

    ctx.setTransform(S, 0, 0, -S, Wd / 2 - this.cam.x * S, Hd / 2 + this.cam.y * S);
    ctx.rotate(rot);
    const lw = 1.2 / this.cam.scale;
    const drawList = (filter) => {
      for (const p of this.parts) {
        if (!filter(p)) continue;
        const loose = !this.attached.has(p.id);
        ctx.globalAlpha = loose ? 0.4 : 1;
        drawPart(ctx, p, lw);
        if (!Career.unlocked(p.def)) {
          ctx.globalAlpha = 0.45; partPath(ctx, p); ctx.fillStyle = '#ff5d5d'; ctx.fill(); ctx.globalAlpha = 1;
        }
      }
    };
    // wings and tail surfaces pass through the hull: draw them (and the pods hanging off them) on top
    const over = (p) => isSurface(p.def) || p.def.pod;
    drawList((p) => (p.def.leg || p.def.fin || p.def.wheel) && !over(p));
    drawList((p) => !p.def.leg && !p.def.fin && !p.def.wheel && !over(p));
    drawList((p) => isSurface(p.def));
    drawList((p) => p.def.pod);
    ctx.globalAlpha = 1;
    if (this.selected) {
      for (const p of this.multi ? this.sel : [this.selected, this.selected.mirror]) {
        if (!p) continue;
        const r = partRect(p);
        ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2 / this.cam.scale;
        ctx.setLineDash([0.25, 0.15]);
        ctx.strokeRect(r.l - 0.08, r.b - 0.08, r.r - r.l + 0.16, r.t - r.b + 0.16);
        ctx.setLineDash([]);
      }
    }
    const d = this.drag;
    if (d && d.fromPalette && d.ghost) {
      const gp = { def: PARTS[d.type], type: d.type, x: d.ghost.x, y: d.ghost.y, flip: d.ghost.x < 0, deployed: 0, rot: d.rot || 0 };
      ctx.globalAlpha = 0.75;
      drawPart(ctx, gp, lw);
      if (this.symmetry && this.mirrorOk(d.type, gp.x, gp.y, [], gp.rot)) { ctx.globalAlpha = 0.35; drawPart(ctx, { ...gp, x: -gp.x, flip: !gp.flip, rot: mirrorRot(gp.rot) }, lw); }
      ctx.globalAlpha = 1;
    }
    if (d && d.group && d.ghost && !d.ghost.ok) {
      ctx.fillStyle = 'rgba(255,93,93,0.35)';
      for (const q of d.group) { const r = partRect(q); ctx.fillRect(r.l, r.b, r.r - r.l, r.t - r.b); }
    } else if (d && d.ghost && !d.ghost.ok) {
      const r = partRect({ def: PARTS[d.type], x: d.ghost.x, y: d.ghost.y, rot: d.part ? d.part.rot || 0 : d.rot || 0 });
      ctx.fillStyle = 'rgba(255,93,93,0.35)';
      ctx.fillRect(r.l, r.b, r.r - r.l, r.t - r.b);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // centre of mass and thrust markers
    if (this.com) {
      const [cx, cy] = XY(this.com.x, this.com.y), r = 9 * dpr;
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#14181f';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, Math.PI, Math.PI * 1.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#14181f'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    }
    if (this.col && this.kind === 'plane') { // centre of lift: a blue disc with a wing through it
      const [cx, cy] = XY(this.col.x, this.col.y), r = 8 * dpr;
      ctx.fillStyle = '#4aa8ff'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#0b2440'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - r * 1.6, cy); ctx.lineTo(cx + r * 1.6, cy); ctx.strokeStyle = '#4aa8ff'; ctx.lineWidth = 2.5 * dpr; ctx.stroke();
    }
    if (this.cot) {
      const [cx, cy] = XY(this.cot.x, this.cot.y);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-rot); ctx.translate(0, 14 * dpr); // an arrow along the thrust
      ctx.fillStyle = '#c38cff';
      ctx.beginPath(); ctx.moveTo(0, -10 * dpr); ctx.lineTo(7 * dpr, 6 * dpr); ctx.lineTo(0, 2 * dpr); ctx.lineTo(-7 * dpr, 6 * dpr); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // stage badges
    ctx.font = `600 ${10 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of this.parts) {
      const st = this.stageOf.get(p.id);
      if (!st) continue;
      const r = partRect(p);
      const [ex, ey] = XY(p.x < -0.01 ? r.l : r.r, p.y), [px, py] = XY(p.x, p.y), k = 10 * dpr / (Math.hypot(ex - px, ey - py) || 1);
      const sx = ex + (ex - px) * k, sy = ey + (ey - py) * k;
      ctx.fillStyle = 'rgba(5,9,18,0.85)';
      ctx.beginPath(); ctx.arc(sx, sy, 8 * dpr, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1 * dpr; ctx.stroke();
      ctx.fillStyle = '#ffb547';
      ctx.fillText(String(st), sx, sy + 0.5 * dpr);
    }
    ctx.textBaseline = 'alphabetic';
  },
};
