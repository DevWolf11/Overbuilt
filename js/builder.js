'use strict';
// Build screen: drag parts from the tray onto the craft. They attach to whatever they're dropped on (a wing,
// the fuselage, another part), at any depth across it; in 2D a grid can be switched on to snap to.

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
  // Wings and tail surfaces go through the fuselage; pods and drop tanks hang from a wing. A part may
  // carry [type, x, y, rot, {z, skin, att}] (att: the index of the part it is attached to); paint gives
  // parts of a type a skin.
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
    paint: { wingDelta: 'stealth', vtailV: 'stealth', jetF: 'stealth' },
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
      ['elevator', -0.3, 0.75], ['vtail', -1.45, 0.95], ['jato', 1.05, 4.1], ['gearS', 1.25, 6.6], ['tailWheel', 1.05, 0.3]],
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

// A template's parts as design rows.
function templateRows(t) {
  return t.parts.map(([type, x, y, rot, o = {}]) => {
    const q = { type, x, y, flip: x < 0, rot: rot || 0 }, skin = o.skin || (t.paint && t.paint[type]);
    if (o.z != null) q.z = o.z;
    if (o.att != null) q.att = o.att;
    if (skin) q.skin = skin;
    return q;
  });
}

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
    this.grid = store.get('rss.grid', false); // 2D only: snap to a quarter-metre grid
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
  serialize() { return { name: this.name, kind: this.kind, parts: designRows(this.parts) }; },
  save() { if (typeof MP !== 'undefined' && MP.savedCareer) return; store.set('rss.design', { ...this.serialize(), savedAs: this.savedAs || null }); }, // (not while a match borrows the builder)
  loadDesign(d, keepHistory) {
    this.parts = partsFromDesign(d.parts);
    if (d.name) this.name = String(d.name).slice(0, 40);
    const kind = hasOwn(VEHICLE_KINDS, d.kind) ? d.kind : 'rocket';
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
    this.loadDesign({ name: t.name, kind: t.kind, parts: templateRows(t) });
  },
  // Symmetry. Planes mirror left and right (across the blueprint), rockets turn half round the stack, cars
  // and helicopters mirror front and back. The pose of the mirror copy of a part, or null when it sits on
  // the mirror line (or is a pair or a wing already).
  mirrorOf(q) {
    const def = PARTS[q.type], rot = q.rot || 0, z = partZ({ def, z: q.z });
    if (this.kind === 'plane') return def.twinZ || zLocked(def) || Math.abs(z) < 0.01 ? null : { x: q.x, y: q.y, z: -z, rot };
    const zz = this.kind === 'rocket' && !def.twinZ ? -z : z;
    if (Math.abs(q.x) < 0.01 && Math.abs(zz - z) < 0.01) return null;
    return { x: -q.x, y: q.y, z: zz, rot: mirrorRot(rot) };
  },
  linkMirrors() {
    for (const p of this.parts) p.mirror = null;
    for (const p of this.parts) {
      const m = !p.mirror && this.mirrorOf(p);
      if (!m) continue;
      const q = this.parts.find((o) => o !== p && !o.mirror && o.type === p.type && Math.abs(o.x - m.x) < 0.01 && Math.abs(o.y - m.y) < 0.01 && Math.abs(partZ(o) - m.z) < 0.01 && (o.rot || 0) === m.rot);
      if (q) { p.mirror = q; q.mirror = p; }
    }
  },
  // A part moved or turned to a pose (and the side it is drawn facing).
  setPose(p, s) {
    p.x = +s.x.toFixed(3); p.y = +s.y.toFixed(3);
    if (s.z != null) p.z = cleanZ(+s.z.toFixed(3), p.def);
    if (s.rot != null) p.rot = s.rot & 3;
    p.flip = p.x < 0;
  },
  pose(p) { return { x: p.x, y: p.y, z: p.z, rot: p.rot || 0 }; },

  changed(fromHistory) {
    if (!fromHistory) this.zGesture = null; // (a slider drag ends with the edit it makes)
    cleanAtt(this.parts); // (nothing attached to a part that has gone)
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
    let mass = 0, thrust = 0, tx = 0, ty = 0, tz = 0, cx = 0, cy = 0, cz = 0;
    for (const p of ps) { const m = partKg(p); mass += m; cx += m * p.x; cy += m * p.y; cz += m * partZc(p); }
    const first = new Set(this.stages[0] || []);
    for (const p of ps) if (first.has(p.id) && p.def.thrust) { const n = partPt(p, 0, -p.def.h / 2); thrust += p.def.thrust * 1000; tx += p.def.thrust * n.x; ty += p.def.thrust * n.y; tz += p.def.thrust * partZc(p); }
    this.com = mass ? { x: cx / mass, y: cy / mass, z: cz / mass } : null;
    this.cot = thrust ? { x: (tx * 1000) / thrust, y: (ty * 1000) / thrust, z: (tz * 1000) / thrust } : null;
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
      air: { stall: vStall(clS), stallFlaps: vStall(clF), wingArea, length: this.length(ps), ...(() => { const w = wingStrength(ps); return { g: mass ? w.S / (mass * G0) : 0, vne: w.vne, mmax: w.mmax }; })() },
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
  // The blueprint point under the pointer (part space) and the metres per pixel there, in either view; in
  // 3D on the plane across the blueprint at depth z0. Null when the 3D view sees that plane edge-on.
  pointerToPart(sx, sy, z0 = 0) {
    if (this.in3D()) return Render3D.designPoint(sx, sy, z0);
    const w = this.screenToWorld(sx, sy);
    return { x: w.x, y: w.y, mpp: 1 / this.cam.scale };
  },
  gridOn() { return !!this.grid && !this.in3D(); },
  // The parts under a blueprint point, the one drawn on top first (the near side, then pods, wings and
  // tail surfaces, the hull, then legs, fins and wheels), so a wing through the fuselage can be picked where
  // they cross; parts at different depths behind one another follow.
  hitParts(w) {
    const pad = isTouch ? 0.2 : 0.05;
    return sideOrder(this.parts).reverse().filter((p) => { const r = partRect(p); return w.x >= r.l - pad && w.x <= r.r + pad && w.y >= r.b - pad && w.y <= r.t + pad; });
  },
  hitPart(w) { return this.hitParts(w)[0] || null; },
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

  // ---------------------------------------------------------------- what hangs on what
  // A part's host is what it is attached to (att). One placed before parts were attached (no att) hangs on
  // what the side view joins it to: a pod or twin part on the wing (or body) it's mounted on, a wing or tail
  // through the body, a part fixed to the side of one nearer the centre line. A part stacked on another's
  // end hangs on nothing: the stack holds it.
  hosts() {
    const byId = new Map(this.parts.map((p) => [p.id, p])), m = new Map(), eps = 0.02;
    for (const p of this.parts) { const h = p.att != null ? byId.get(p.att) : this.guessHost(p, byId); if (h && h !== p) m.set(p, h); }
    // and a part stacked on the end of an off-centre part that hangs on something (a radial booster's
    // engine and nose cone) hangs on that part
    const off = this.parts.filter((p) => !m.has(p) && p.att == null && !this.onLine(p));
    for (let more = off.length > 0; more;) {
      more = false;
      for (const p of off) {
        if (m.has(p)) continue;
        const R = partRect(p), h = this.near(p, byId).find((q) => m.has(q) && !this.onLine(q) && partsTouch(p, q) && (() => { const S = partRect(q); return Math.abs(R.t - S.b) < eps || Math.abs(S.t - R.b) < eps; })());
        if (h) { m.set(p, h); more = true; }
      }
    }
    return m;
  },
  // The parts joined to p (all of them, if the joints haven't been worked out for these parts yet).
  near(p, byId) {
    const n = this.adj && this.adj.get(p.id);
    return n ? [...n].map((id) => byId.get(id)).filter(Boolean) : this.parts.filter((q) => q !== p);
  },
  // On the craft's centre line (a pair never is: one copy each side).
  onLine(q) { return !q.def.twinZ && Math.abs(q.x) < 0.01 && Math.abs(partZc(q)) < 0.01; },
  // Does h still hold q: touching it, mounted through it, or for a wing, hanging on (or sitting on) its real
  // section out at q's depth, swept back, tapered and lifted as the 3D wing is.
  holds(h, q) { return partsTouch(q, h) || partsMounted(q, h) || (!!h.def.wing && this.wingHolds(h, q)); },
  wingHolds(w, q) {
    const A = typeof Parts3D !== 'undefined' && Parts3D.wingAt;
    if (!A || (w.rot || 0) !== 0 || w.def.shape === 'biplane') return partsMounted2D(q, w);
    const R = partRect(q), sec = A(w.def, partZ(q)), wx = w.x + sec.x, t = sec.t + 0.07;
    return sec.s <= 1.05 && spanOverlap(R.b, R.t, w.y + sec.te, w.y + sec.le) > 0.04 && R.l <= wx + t && R.r >= wx - t;
  },
  // Where the underside of a wing is, out at depth z (a biplane: its lower wing).
  underside(w, z) {
    const d = w.def, wd = d.wing || {}, A = typeof Parts3D !== 'undefined' && Parts3D.wingAt;
    if (d.shape === 'biplane') return w.x + (wd.gap || 0) / 2 + (wd.thick || 0.2) / 2 - Math.abs(z) * Math.sin(wd.dihedral || 0);
    if (A && d.wing && (w.rot || 0) === 0) { const sec = A(d, z); return w.x + sec.x + sec.t; }
    return partRect(w).r;
  },
  // How far a part goes across when the parts it hangs on (roots) move across by dz: one hanging on the
  // left copy of a pair, or a pair hanging under a part on the left, goes the other way, so it stays put
  // on what it hangs on.
  zStep(q, dz, roots, H) {
    if (!dz) return 0;
    let r = null;
    for (let h = q, n = 0; h && !r && n < 999; h = H.get(h), n++) if (roots.includes(h)) r = h;
    if (!r || r === q) return dz;
    if (r.def.twinZ && !q.def.twinZ) return partZ(q) < 0 ? -dz : dz;
    if (!r.def.twinZ && q.def.twinZ) return partZ(r) < 0 ? -dz : dz;
    return dz;
  },
  guessHost(p, byId = new Map(this.parts.map((q) => [q.id, q]))) {
    const d = p.def, R = partRect(p), others = this.near(p, byId), off = (q) => Math.abs(q.x) + Math.abs(partZc(q));
    const area = (q) => { const S = partRect(q); return Math.max(0, spanOverlap(R.l, R.r, S.l, S.r)) * Math.max(0, spanOverlap(R.b, R.t, S.b, S.t)); };
    const most = (list) => list.sort((a, b) => area(b) - area(a))[0] || null;
    if (d.pod || d.twinZ) return most(others.filter((q) => isSurface(q.def) && !q.def.twinZ && partsMounted2D(p, q))) || most(others.filter((q) => !q.def.twinZ && (partsTouch2D(p, q) || partsMounted2D(p, q))));
    if (isSurface(d)) return most(others.filter((q) => !isSurface(q.def) && !q.def.pod && partsMounted(p, q)));
    const eps = 0.02, side = others.filter((q) => {
      const S = partRect(q);
      return off(q) < off(p) - 0.01 && partsTouch(p, q) && !(Math.abs(R.t - S.b) < eps || Math.abs(S.t - R.b) < eps);
    });
    return side.sort((a, b) => off(a) - off(b))[0] || null;
  },
  // Everything hanging on these parts, and on what hangs on them, and so on (not the parts themselves).
  kidsOf(roots, H = this.hosts()) {
    const kids = new Map();
    for (const [p, h] of H) { if (!kids.has(h)) kids.set(h, []); kids.get(h).push(p); }
    const seen = new Set(roots), out = [], stack = [...roots];
    while (stack.length) for (const k of kids.get(stack.pop()) || []) if (!seen.has(k)) { seen.add(k); out.push(k); stack.push(k); }
    return out;
  },

  // ---------------------------------------------------------------- placing parts
  // Where a part can go: {x, y, z, host, att, attached, ok}. host is the part it is put against and att the
  // one it hangs on (none when it just stacks on the craft's centre line). 2D: snap() near a blueprint
  // point, against the edges of the parts there, or hanging where it was dropped when it mounts on
  // something (a wing through the fuselage, an engine or a pod on a wing); in grid mode on a quarter-metre
  // grid. 3D: attach() onto the surface under the pointer, wherever it is.

  // The depth a part can go at (x, y): `want` if that's free, else, for a pair or anything hanging on a
  // wing, the nearest free spot along the wing; null when there's none.
  zFit(type, x, y, rot, want, others) {
    const def = PARTS[type], free = (z) => { const pr = { def, type, x, y, z, rot }; return !others.some((o) => partsClash(pr, o)); };
    if (zLocked(def)) return free(0) ? 0 : null;
    const z0 = +cleanZ(want, def).toFixed(3), pr = { def, type, x, y, z: z0, rot };
    const wing = others.find((o) => o.def.wing && (partsMounted2D(pr, o) || this.wingHolds(o, pr)));
    const lim = wing ? wing.def.wing.span / 2 : Math.max(8, Math.abs(z0)); // (along a wing: no further than its tip)
    if (Math.abs(z0) <= lim && free(z0)) return z0;
    if (!wing && !def.twinZ) return null;
    const step = this.gridOn() ? 0.25 : 0.05, lo = def.twinZ ? twinMinZ(def) : -lim;
    for (let k = 1; k * step <= 2 * lim; k++) for (const s of [1, -1]) {
      const z = +(z0 + s * k * step).toFixed(3);
      if (z >= lo && Math.abs(z) <= lim && free(z)) return z;
    }
    return null;
  },
  // What a part put against host hangs on: the host, unless it just stacks on the centre line.
  attFor(host, stack) { return host && !(stack && this.onLine(host)) ? host : null; },

  // 2D: a good spot for a part of `type` turned by `rot` near want {x, y, z?} (z: the depth it would
  // like; default its own). radius: how far an attachment may be (default ~26 px, at least 1.4 m).
  snap(type, want, ignore, rot = 0, radius) {
    const def = PARTS[type], { w, h } = partDims({ def, rot }), others = this.parts.filter((p) => !ignore.includes(p));
    const z0 = want.z != null ? want.z : partDefaultZ(def);
    const g = this.gridOn() ? (v) => Math.round(v * 4) / 4 : (v) => Math.round(v * 100) / 100;
    if (radius == null) radius = Math.max(1.4, 26 * (this.mpp || 1 / this.cam.scale));
    // against o it goes at o's depth (the near one of a pair); a pair keeps its own spread
    const zAt = (o) => (zLocked(def) ? 0 : def.twinZ ? (o.def.twinZ ? partZ(o) : z0) : partZ(o));
    let best = null, bestD = radius;
    const consider = (x, y, o, stack) => {
      const d = Math.hypot(x - want.x, y - want.y);
      if (d >= bestD) return;
      const pr = { def, type, x, y, z: zAt(o), rot };
      if (others.some((q) => partsClash(pr, q))) return;
      if (def.twinZ && !o.def.twinZ && !partsTouch(pr, o) && !partsMounted(pr, o)) return; // (a pair out to the sides doesn't hang on what it only meets in the side view)
      best = { x, y, z: pr.z, host: o, stack }; bestD = d;
    };
    const gx = g(want.x), gy = g(want.y), flat = { def, type, x: gx, y: gy, z: z0, rot };
    // wings and tail surfaces sit right where they are dropped, through the part they mount on; pods,
    // engines and anything else dropped on a wing hang off it there, at the first free spot along it
    const onWing = !isSurface(def) && !def.control && !def.separator && others.some((o) => o.def.wing && (partsMounted2D(flat, o) || this.wingHolds(o, flat)));
    if (isSurface(def) || def.pod || onWing) {
      const z = this.zFit(type, gx, gy, rot, z0, others), pr = { ...flat, z };
      const host = z != null && others.find((o) => (o.def.wing && !isSurface(def) ? this.wingHolds(o, pr) : partsMounted(pr, o)) && (!def.pod || isSurface(o.def)));
      if (host) return { x: gx, y: gy, z, host, att: host, attached: true, ok: true };
    }
    for (const o of others) {
      const R = partRect(o);
      consider(o.x, R.t + h / 2, o, true);
      consider(o.x, R.b - h / 2, o, true);
      const yy = clamp(g(want.y), R.b - h / 2 + 0.25, R.t + h / 2 - 0.25);
      consider(R.r + w / 2, yy, o); consider(R.l - w / 2, yy, o);
      consider(R.r + w / 2, R.t - h / 2, o); consider(R.l - w / 2, R.t - h / 2, o);
      consider(R.r + w / 2, R.b + h / 2, o); consider(R.l - w / 2, R.b + h / 2, o);
      // on top of or under `o`, wherever along it the pointer is, as long as the two still overlap
      if (Math.abs(g(want.x) - o.x) < (w + R.r - R.l) / 2 - 0.1) { consider(g(want.x), R.t + h / 2, o, true); consider(g(want.x), R.b - h / 2, o, true); }
    }
    if (best) return { x: best.x, y: best.y, z: best.z, host: best.host, att: this.attFor(best.host, best.stack), attached: true, ok: true };
    const z = this.zFit(type, gx, gy, rot, z0, others);
    return { x: gx, y: gy, z: z == null ? cleanZ(z0, def) : z, host: null, att: null, attached: false, ok: z != null };
  },

  // 3D: put a part against the surface under the pointer (hit from Render3D.surfaceHit, in part space):
  // under or over a wing where the pointer is, on a fuselage's flank or back, or stacked on a part's end.
  // Wings, legs and fins go by the blueprint plane as before (null).
  attach(type, rot, hit, others) {
    const def = PARTS[type], host = hit.part;
    if (zLocked(def) || !host) return null;
    const { w, h } = partDims({ def, rot }), hd = partDepth({ def }) / 2, R = partRect(host), surf = isSurface(host.def), hhd = partDepth(host) / 2;
    const hz = host.def.twinZ ? (hit.z < 0 ? -1 : 1) * partZ(host) : partZ(host); // the copy of a pair that was hit
    const ax = Math.abs(hit.nx), ay = Math.abs(hit.ny), az = Math.abs(hit.nz), q = (v) => Math.round(v * 100) / 100;
    let x = hit.x, y = hit.y, z = hit.z, stack = false;
    if (ay >= ax && ay >= az && !surf) { x = host.x; z = hz; y = hit.ny > 0 ? R.t + h / 2 : R.b - h / 2; stack = true; } // its end: stack on it
    else if (ax >= az) { // under or over it (pods and stores always hang underneath, off their pylons)
      if (surf && def.pod && hit.nx < 0) x = this.underside(host, hit.z) + w / 2;
      else x = surf ? hit.x + Math.sign(hit.nx) * w / 2 : hit.nx > 0 ? R.r + w / 2 : R.l - w / 2;
    }
    else z = surf ? hit.z + Math.sign(hit.nz) * hd : hz + Math.sign(hit.nz) * (hhd + hd); // on its flank
    x = q(x); y = q(y); z = q(z);
    if (!def.twinZ && Math.abs(z) < 0.08) z = 0; // onto the centre line
    z = cleanZ(z, def);
    const pr = { def, type, x, y, z, rot }, ok = !others.some((o) => partsClash(pr, o));
    return { x, y, z, host, att: this.attFor(host, stack), attached: true, ok };
  },

  mirrorOk(type, x, y, ignore, rot = 0, z) {
    const def = PARTS[type], self = { def, type, x, y, z, rot }, m = this.mirrorOf(self);
    if (!m) return false;
    const probe = { def, type, ...m };
    if (partsClash(probe, self)) return false;
    return !this.parts.some((o) => !ignore.includes(o) && partsClash(probe, o));
  },

  // ex: {z, att (the part it hangs on), host (the part it was put against), skin}. A new part takes the
  // paint of what it is put on (a wing on a stealth fuselage comes in stealth grey).
  addPart(type, x, y, rot = 0, ex = {}) {
    const def = PARTS[type];
    if (!Career.unlocked(def)) { UI.toast(`${def.name} unlocks with ${TIERS[def.tier].name}`); return; }
    const att = ex.att || null, host = ex.host || att;
    const skin = ex.skin !== undefined ? cleanSkin(ex.skin, def) : host ? cleanSkin(skinOf(host), def) : null;
    const p = makePart(type, x, y, { flip: x < 0, rot, z: cleanZ(ex.z, def), att: att ? att.id : null, skin });
    this.parts.push(p);
    if (this.symmetry && this.mirrorOk(type, x, y, [], rot, p.z)) {
      const s = this.mirrorOf(p), mh = att && (att.mirror || att);
      const m = makePart(type, s.x, s.y, { flip: s.x < 0, rot: s.rot, z: s.z, att: mh ? mh.id : null, skin });
      this.parts.push(m);
      p.mirror = m; m.mirror = p;
    }
    this.selected = p;
    this.changed();
    this.renderInfo();
    Sound.click();
  },

  // Parts go with everything attached to them.
  removeParts(list) {
    const kids = this.kidsOf(list), gone = new Set([...list, ...kids]);
    this.parts = this.parts.filter((q) => !gone.has(q));
    this.selected = null;
    this.linkMirrors();
    this.changed();
    this.renderInfo();
    if (kids.length) UI.toast(`Removed ${gone.size} parts, with what was attached to ${list.length > 1 ? 'them' : 'it'} (Undo brings them back)`);
  },
  deleteSelected() {
    const p = this.selected;
    if (!p) return;
    if (this.drag && this.drag.part) this.cancelDrag();
    this.removeParts([p, p.mirror].filter(Boolean));
  },

  duplicateSelected() {
    if (this.multi) { this.paste({ parts: designRows([...this.sel]) }); return; }
    const p = this.selected;
    if (!p) return;
    // a part out on a wing: another one further along it
    const host = this.hosts().get(p);
    if (host && host.def.wing && !isSurface(p.def) && !zLocked(p.def)) {
      const z = this.zFit(p.type, p.x, p.y, p.rot || 0, partZ(p) + partDepth(p) + 0.2, this.parts);
      if (z != null) { this.addPart(p.type, p.x, p.y, p.rot || 0, { z, att: host, skin: p.skin }); return; }
    }
    const s = this.snap(p.type, { x: p.x, y: partRect(p).t + partDims(p).h / 2, z: p.z }, [], p.rot || 0);
    if (!s.ok) { UI.toast('No room to duplicate it there'); return; }
    this.addPart(p.type, s.x, s.y, p.rot || 0, { z: s.z, att: s.att, host: s.host, skin: p.skin });
  },

  // Turn the selected part (and its mirror twin) a quarter turn; while dragging from the palette, turn the
  // part being placed. If it no longer fits where it is, it moves to the nearest free spot. A part with
  // others attached turns with them, about its middle.
  rotateSelected() {
    const d = this.drag;
    if (d && d.fromPalette) { d.rot = ((d.rot || 0) + 1) & 3; if (d.last) this.dragTo(d.last.x, d.last.y); Sound.click(); return; }
    const p = this.selected;
    if (!p) { UI.toast('Select a part to rotate it (R)'); return; }
    const m = p.mirror;
    const H = this.hosts();
    if (this.kidsOf([p, m].filter(Boolean), H).length) { // with what hangs on it (and its twin, turned the mirrored way)
      this.turnGroups(m ? [[p, 1], [m, this.kind === 'plane' ? 1 : -1]] : [[p, 1]], H);
      return;
    }
    const k = ((p.rot || 0) + 1) & 3, ignore = [p, m].filter(Boolean);
    const s = this.snap(p.type, { x: p.x, y: p.y, z: p.z }, ignore, k);
    if (!s.ok) { UI.toast('No room to turn it here'); return; }
    this.setPose(p, { ...s, rot: k });
    if (m) {
      if (this.mirrorOk(p.type, p.x, p.y, ignore, k, p.z)) this.setPose(m, this.mirrorOf(p));
      else { p.mirror = null; m.mirror = null; }
    }
    Sound.click();
    this.changed();
    this.renderInfo();
  },
  // A quarter turn of parts (and everything attached to them) about a point.
  turnGroup(list, cx, cy) { return this.turnGroups([[list, 1, cx, cy]]); },
  // Several such turns at once, each [parts or a part, dir (1 anticlockwise, -1 clockwise), about x, y
  // (default: the part's middle)], all or none.
  turnGroups(specs, H = this.hosts()) {
    const sets = specs.map(([r, dir, cx, cy]) => { const list = Array.isArray(r) ? r : [r]; return { g: [...new Set([...list, ...this.kidsOf(list, H)])], dir, cx: cx ?? list[0].x, cy: cy ?? list[0].y }; });
    const g = [...new Set(sets.flatMap((t) => t.g))], old = g.map((p) => this.pose(p));
    for (const t of sets) for (const p of t.g) {
      const dx = p.x - t.cx, dy = p.y - t.cy;
      this.setPose(p, t.dir > 0 ? { x: t.cx - dy, y: t.cy + dx, rot: (p.rot || 0) + 1 } : { x: t.cx + dy, y: t.cy - dx, rot: (p.rot || 0) + 3 });
    }
    if (!this.groupFits(g)) { g.forEach((p, i) => this.setPose(p, old[i])); UI.toast('No room to turn them here'); return false; }
    this.linkMirrors();
    Sound.click();
    this.changed();
    this.renderInfo();
    return true;
  },

  // Move parts (with everything attached to them) by a step, across the blueprint too (dz); their mirror
  // twins follow mirrored where they fit, else they stay and stop being twins. False if there's no room.
  shift(list, dx, dy, dz = 0, H = this.hosts()) {
    const g = [...new Set([...list, ...this.kidsOf(list, H)])], inG = new Set(g), old = new Map(g.map((p) => [p, this.pose(p)]));
    const tk = new Map(list.map((p) => [p, p.mirror && !inG.has(p.mirror) ? this.kidsOf([p.mirror], H).filter((q) => !inG.has(q)) : []])); // (found before anything moves)
    for (const p of g) this.setPose(p, { x: p.x + dx, y: p.y + dy, z: p.z + this.zStep(p, dz, list, H) });
    if (!this.groupFits(g) || list.some((p) => p.mirror && inG.has(p.mirror) && partsClash(p, p.mirror))) { for (const [p, o] of old) this.setPose(p, o); return false; }
    const moved = new Set(g);
    for (const p of list) {
      const m = p.mirror;
      if (!m || inG.has(m)) continue;
      const pose = this.mirrorOf(p), kids = tk.get(p), mo = this.pose(m), ko = kids.map((q) => this.pose(q));
      if (pose) {
        this.setPose(m, pose);
        kids.forEach((q, i) => this.setPose(q, { x: ko[i].x + m.x - mo.x, y: ko[i].y + m.y - mo.y, z: ko[i].z + this.zStep(q, m.z - mo.z, [m], H) }));
        if (this.groupFits([m, ...kids])) { moved.add(m); kids.forEach((q) => moved.add(q)); continue; }
        this.setPose(m, mo); kids.forEach((q, i) => this.setPose(q, ko[i]));
      }
      p.mirror = null; m.mirror = null;
    }
    this.letGo(moved);
    return true;
  },
  // Parts that moved away from what they hang on (which stayed) no longer hang on it.
  letGo(moved) {
    const byId = new Map(this.parts.map((q) => [q.id, q]));
    for (const q of moved) { const h = byId.get(q.att); if (h && !moved.has(h) && !this.holds(h, q)) q.att = null; }
  },
  // Arrow keys: move the selected part (and its twin) by a step in screen directions, if there is room.
  nudge(dx, dy) {
    const d = this.toPart(dx, dy);
    if (!this.shift([this.selected], d.x, d.y)) { UI.toast('No room to move it there'); return; }
    this.changed();
    this.renderInfo();
  },

  // ---------------------------------------------------------------- depth and paint
  // Move the selected parts in or out across the blueprint ([ and ], or the depth slider). Wings span both
  // sides and rocket legs and fins stand all round, so they stay put.
  nudgeZ(dz) {
    let list = [...this.sel].filter((p) => !zLocked(p.def));
    if (!list.length) { UI.toast(this.selected ? `${this.selected.def.name} spans the craft: it stays on the centre line` : 'Select a part to move it in or out ([ ])'); return; }
    list = list.filter((p) => !(p.mirror && list.includes(p.mirror) && partZ(p) < 0)); // (both of a pair: the left one follows the right)
    if (!this.shift(list, 0, 0, dz)) { UI.toast('No room there'); return; }
    this.linkMirrors();
    this.changed();
    this.renderInfo();
  },
  // live: while the slider moves (no undo step until it is let go). A slider drag starts again from where
  // the parts were when it began each time, so the twin and what hangs on things are judged at the
  // depth it ends at, not on the way.
  setDepth(z, live) {
    const p = this.selected;
    if (!p || zLocked(p.def)) return;
    let G = this.zGesture;
    if (!G || G.part !== p) G = this.zGesture = { part: p, z0: partZ(p), was: this.parts.map((q) => [q, this.pose(q), q.mirror, q.att]), H: this.hosts() };
    for (const [q, o, m, a] of G.was) { this.setPose(q, o); q.mirror = m; q.att = a; }
    const dz = cleanZ(z, p.def) - G.z0;
    if (Math.abs(dz) > 1e-4 && !this.shift([p], 0, 0, dz, G.H) && !live) UI.toast('No room there');
    this.linkMirrors();
    this.changed(!!live);
    this.renderDepth(live);
  },
  withTwins(list) { return [...new Set([...list, ...list.map((p) => p.mirror).filter(Boolean)])]; },
  // What a part takes its paint from when matching: the part it hangs on, else the biggest part it's fixed to.
  hostOf(p, H = this.hosts()) {
    const byId = new Map(this.parts.map((q) => [q.id, q])), h = H.get(p);
    if (h) return h;
    const ns = [...((this.adj && this.adj.get(p.id)) || [])].map((id) => byId.get(id)).filter((q) => q && skinnable(q.def));
    return ns.sort((a, b) => b.def.w * b.def.h - a.def.w * a.def.h)[0] || null;
  },
  // Paint the selected parts and their twins (null: their own look).
  paintSel(skin) {
    const list = this.withTwins([...this.sel]).filter((p) => skinnable(p.def));
    if (!list.length) { UI.toast('Wheels, struts, chutes and shields keep their colours'); return; }
    for (const p of list) p.skin = cleanSkin(skin, p.def);
    Sound.click();
    this.changed();
    this.renderInfo();
  },
  // Match: each selected part takes the paint of what it hangs on.
  matchPaint() {
    const list = this.withTwins([...this.sel]).filter((p) => skinnable(p.def));
    const H = this.hosts();
    let n = 0;
    for (const p of list) { const h = this.hostOf(p, H); if (h) { p.skin = cleanSkin(skinOf(h), p.def); n++; } }
    if (!n) { UI.toast(this.selected ? 'It isn’t attached to anything to match' : 'Select a part to match its paint (M)'); return; }
    Sound.click();
    this.changed();
    this.renderInfo();
    UI.toast(`Matched ${n} part${n > 1 ? 's' : ''} to what ${n > 1 ? 'they hang' : 'it hangs'} on`);
  },
  // The whole craft in the paint of the selected part.
  paintAll() {
    const p = this.selected;
    if (!p) return;
    const skin = skinOf(p);
    for (const q of this.parts) if (skinnable(q.def)) q.skin = cleanSkin(skin, q.def);
    Sound.click();
    this.changed();
    this.renderInfo();
    UI.toast(skin ? `The whole craft in ${SKINS[skin].name.toLowerCase()}` : 'Every part back in its own colours');
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
    if (this.in3D()) return Render3D.designToScreen(p.x, p.y, partZc(p));
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
  // The 2D grid: parts snap to a quarter-metre grid. (In 3D they always attach right where they're dropped.)
  setGrid(on) {
    if (this.in3D()) { UI.toast('The grid is for the 2D blueprint: in 3D parts attach right where you drop them'); return; }
    this.grid = !!on;
    store.set('rss.grid', this.grid);
    $('#btn-grid').setAttribute('aria-pressed', String(this.grid));
    UI.toast(this.grid ? 'Grid on: parts snap to a quarter-metre grid' : 'Grid off: parts attach right where you drop them');
    this.renderDepth();
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
  copySel(cut) {
    const list = [...this.sel];
    if (!list.length) { UI.toast('Select parts to copy them'); return; }
    // a single part brings its mirror twin along, as the single-part buttons do, and everything attached to
    // the copied parts comes too
    const base = list.length === 1 && list[0].mirror ? [list[0], list[0].mirror] : list, parts = [...base, ...this.kidsOf(base)];
    this.clip = { kind: this.kind, parts: designRows(parts) };
    store.set('rss.clip', this.clip);
    $('#btn-paste').hidden = false;
    if (cut) { this.removeParts(base); UI.toast(`Cut ${parts.length} part${parts.length > 1 ? 's' : ''}`); } else UI.toast(`Copied ${parts.length} part${parts.length > 1 ? 's' : ''} · Ctrl+V or Paste to place`);
  },
  // Paste the copied parts at the nearest free spot above (or beside) where they came from, selected so
  // they can be dragged into place. Parts keep their depth, paint and what they hang on among themselves.
  paste(clip = this.clip) {
    if (!clip || !clip.parts || !clip.parts.length) { UI.toast('Nothing copied yet'); return; }
    const all = partsFromDesign(clip.parts), made = cleanAtt(all.filter((p) => Career.unlocked(p.def)));
    if (!made.length) { UI.toast(all.length ? 'Those parts aren’t unlocked yet' : 'Nothing copied yet'); return; }
    let b = -Infinity, t = Infinity;
    for (const p of made) { const r = partRect(p); b = Math.max(b, r.t); t = Math.min(t, r.b); }
    const h = b - t, src = made.map((p) => ({ x: p.x, y: p.y }));
    const place = (dx, dy) => { made.forEach((p, i) => this.setPose(p, { x: src[i].x + dx, y: src[i].y + dy })); return this.groupFits(made); };
    let ok = false;
    for (let k = 0; k < 120 && !ok; k++) { // up first, then out to the sides, a quarter metre at a time
      const ring = Math.floor(k / 3), side = k % 3, dy = h + 0.25 + ring * 0.5, dx = side === 0 ? 0 : (side === 1 ? 1 : -1) * (ring + 1) * 0.75;
      ok = place(dx, side === 0 ? dy : (ring + 1) * 0.5);
    }
    if (!ok) { UI.toast('No room to paste here'); return; }
    this.parts.push(...made);
    this.linkMirrors();
    if (this.symmetry) { // with symmetry on, one-sided parts get their twin, on the twin of what they hang on
      const twins = [];
      for (const p of [...made]) {
        if (p.mirror || !this.mirrorOk(p.type, p.x, p.y, [], p.rot, p.z)) continue;
        const s = this.mirrorOf(p), m = makePart(p.type, s.x, s.y, { flip: s.x < 0, rot: s.rot, z: s.z, skin: p.skin });
        this.parts.push(m); made.push(m); twins.push(m); p.mirror = m; m.mirror = p;
      }
      const byId = new Map(this.parts.map((q) => [q.id, q]));
      for (const m of twins) { const h = byId.get(m.mirror.att); m.att = h ? (h.mirror || h).id : null; }
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
    this.removeParts(this.withTwins([...this.sel]));
  },
  // A quarter turn of the whole selection about its middle.
  rotateSel() {
    if (!this.multi) { this.rotateSelected(); return; }
    const g = [...this.sel], k = this.gridOn() ? 4 : 100;
    this.turnGroup(g, Math.round((g.reduce((s, p) => s + p.x, 0) / g.length) * k) / k, Math.round((g.reduce((s, p) => s + p.y, 0) / g.length) * k) / k);
  },
  nudgeSel(dx, dy) {
    if (!this.multi) { this.nudge(dx, dy); return; }
    const d = this.toPart(dx, dy);
    if (!this.shift([...this.sel], d.x, d.y)) { UI.toast('No room to move them there'); return; }
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
    // a spot that fits, with the part it hangs on (a wing for pods), at the first free depth there
    const fit = (t) => {
      const z = this.zFit(type, t.x, t.y, 0, t.z, this.parts);
      if (z == null) return null;
      const probe = { def, type, x: t.x, y: t.y, z };
      const host = this.parts.find((o) => partsMounted(probe, o) && (!def.pod || isSurface(o.def)));
      if ((isSurface(def) || def.pod) && !host) return null;
      return { x: t.x, y: t.y, z, host: host || t.host || null, att: host || t.att || null };
    };
    if (this.parts.length && (isSurface(def) || def.pod)) {
      // planes: a main wing goes through the fuselage just behind the centre of mass, tail surfaces through
      // the rearmost hull part, a canard through the front one, pods under a wing (one more pair further
      // out along it each time)
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
      for (const t of tries) if ((spot = fit(t))) break;
    } else if (this.parts.length) {
      const centred = this.parts.filter((p) => Math.abs(p.x) < 0.01 && Math.abs(partZc(p)) < 0.01);
      const sorted = centred.sort((a, b) => partRect(b).t - partRect(a).t);
      const topP = sorted[0], botP = sorted[sorted.length - 1];
      const tries = [];
      const top = topP && { x: 0, y: partRect(topP).t + def.h / 2, host: topP };
      const bottom = botP && { x: 0, y: partRect(botP).b - def.h / 2, host: botP };
      if (def.side || def.leg || def.fin || def.shape === 'rcs' || def.shape === 'girder') {
        for (const p of centred) tries.push({ x: p.def.w / 2 + def.w / 2, y: def.fin ? partRect(p).b + def.h / 2 : p.y, host: p, att: p });
      } else if (def.control || def.chute || def.aero) tries.push(top, bottom);
      else tries.push(bottom, top);
      for (const t of tries.filter(Boolean)) if ((spot = fit({ ...t, z: 0 }))) break;
    }
    if (!spot) { const s = this.snap(type, centre, []); spot = s.ok ? s : null; }
    // else the free attachment nearest the middle of the view, wherever it is on the craft
    if (!spot && this.parts.length) { const s = this.snap(type, centre, [], 0, Infinity); spot = s.ok && s.attached ? s : null; }
    if (!spot) { UI.toast('No room there. Drag the part into place instead.'); return; }
    this.addPart(type, spot.x, spot.y, 0, { z: spot.z, att: spot.att, host: spot.host });
  },

  setKind(kind) {
    if (!VEHICLE_KINDS[kind] || kind === this.kind) return;
    this.kindSymmetry(kind);
    this.kind = kind;
    this.category = { rocket: 'command', plane: 'cabins', car: 'ground', heli: 'airEng' }[kind] || this.category;
    this.linkMirrors();
    this.buildPalette();
    this.renderKind();
    this.changed();
    this.fitView();
    Sound.click();
  },
  // Planes mirror left and right and keep their own symmetry setting (on unless switched off); the others
  // share one. True if it just changed.
  symKey(kind) { return kind === 'plane' ? 'rss.symmetryPlane' : 'rss.symmetry'; },
  kindSymmetry(kind) {
    const want = store.get(this.symKey(kind), true), b = $('#btn-sym');
    b.title = kind === 'plane' ? 'Symmetry: parts out on one wing get a twin on the other' : kind === 'rocket' ? 'Symmetry: parts get a twin on the other side of the stack' : 'Symmetry: parts get a twin front and back';
    if (want === this.symmetry) return false;
    this.symmetry = want;
    b.setAttribute('aria-pressed', String(want));
    return true;
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
    // lopsided: engines or weight off to one side, or something hanging past a wing tip
    if (this.ctrl && this.cot && Math.abs(this.cot.z) > 0.3) warn.push(`The engines push ${Math.abs(this.cot.z).toFixed(1)} m off the centre line, so it will swing to one side. Turn on symmetry or balance them.`);
    if (this.ctrl && this.com && Math.abs(this.com.z) > 0.15) warn.push('More weight on one side than the other: it will lean that way.');
    const onPs = new Map(ps.map((p) => [p.id, p]));
    if (ps.some((p) => { const h = onPs.get(p.att); return h && h.def.wing && !isSurface(p.def) && Math.abs(partZ(p)) - partDepth(p) / 2 > h.def.wing.span / 2; })) warn.push('Something hangs past a wing tip.');
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
        + ` · strong to ${a.g.toFixed(a.g < 10 ? 1 : 0)} g · wings break above ${Math.round(a.vne * 3.6)} km/h${a.mmax ? ` or Mach ${a.mmax}` : ' (more up high)'}`;
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
    this.renderDepth();
    this.renderPaint();
    if (this.multi) {
      const g = [...this.sel], mass = g.reduce((s, q) => s + q.def.mass, 0), cost = g.reduce((s, q) => s + (q.def.cost || 0), 0);
      $('#pi-name').textContent = `${g.length} parts selected`;
      $('#pi-specs').textContent = `${mass.toFixed(2)} t` + (Career.sandbox ? '' : ` · ${money(cost)}`);
      $('#pi-desc').textContent = isTouch ? 'Drag any of them to move them together. Copy to paste them again (here or in another design).'
        : 'Drag any of them to move them together · Ctrl+C / Ctrl+V copy and paste (also into another design) · R turns them · [ ] move them in and out · Delete removes them.';
      this.layout();
      return;
    }
    const d = p.def;
    $('#pi-name').textContent = d.name + (p.mirror || d.twinZ ? ' ×2' : '');
    $('#pi-desc').textContent = d.desc || '';
    const specs = [`${d.mass} t`];
    if (d.fuel) specs.push(`${d.fuel} t ${d.solid ? 'solid fuel' : 'fuel'}`);
    if (d.thrust) specs.push(`${d.thrust} kN`, `Isp ${d.ispSL}–${d.ispVac} s`);
    if (d.torque) specs.push(`${d.torque / 1000} kN·m`);
    if (d.wing && !d.wing.control) { const W = wingAero(d); specs.push(`breaks above ${Math.round(W.vne * 3.6)} km/h${W.mmax ? ` or Mach ${W.mmax}` : ''}`); }
    if (d.heatShield || d.maxTemp !== 2000) specs.push(`max ${d.maxTemp} K`);
    if (!Career.sandbox) specs.push(money(d.cost));
    $('#pi-specs').textContent = specs.join(' · ');
    this.layout();
  },
  // The depth row: where the part sits across the blueprint (a pair: how far out each one is).
  renderDepth(live) {
    const p = this.selected, row = $('#pi-depth');
    if (!p || this.multi || zLocked(p.def)) { row.hidden = true; return; }
    row.hidden = false;
    const d = p.def, z = partZ(p), wings = this.parts.filter((q) => q.def.wing).map((q) => q.def.wing.span / 2 + 1);
    const lim = Math.min(PART_Z_MAX, Math.ceil(Math.max(4, Math.abs(z) + 1, ...wings))), input = $('#pi-z');
    $('#pi-z-label').textContent = d.twinZ ? 'Spread' : 'Depth';
    if (!live) { input.min = d.twinZ ? +twinMinZ(d).toFixed(2) : -lim; input.max = lim; input.step = this.gridOn() ? 0.25 : 0.05; input.value = z; }
    $('#pi-z-val').textContent = this.zText(p);
  },
  // Where a part sits across, in words: out each side for a pair, else which side of the centre line.
  zText(p) {
    const z = partZ(p), a = Math.abs(z).toFixed(2);
    if (p.def.twinZ) return `±${a} m`;
    if (Math.abs(z) < 0.005) return 'centre';
    return this.kind === 'plane' ? `${z > 0 ? 'right' : 'left'} ${a} m` : `${z > 0 ? '+' : '−'}${a} m`;
  },
  // The paint row: a swatch per skin (and the part's own look), lit for the paint the selection wears.
  renderPaint() {
    const row = $('#pi-paint'), list = this.withTwins([...this.sel]).filter((q) => skinnable(q.def));
    if (!list.length) { row.hidden = true; return; }
    row.hidden = false;
    const box = $('#pi-skins');
    if (!box.childElementCount) for (const id of ['', ...SKIN_IDS]) {
      const sk = SKINS[id], b = el('button', { class: 'skin-sw' + (id ? '' : ' own'), role: 'radio', 'data-skin': id, title: sk ? sk.name : 'Its own colours', 'aria-label': sk ? sk.name : 'Its own colours' });
      if (sk) b.style.background = sk.base;
      box.append(b);
    }
    const cur = new Set(list.map((q) => q.skin || ''));
    for (const b of box.children) b.setAttribute('aria-checked', String(cur.size === 1 && cur.has(b.dataset.skin)));
    const H = this.hosts();
    $('#btn-match').disabled = !list.some((q) => this.hostOf(q, H));
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
  // (the saved design read back the way the blueprint writes it, so one saved by an older version isn't
  // taken for changed)
  markSaved(d) { this.savedAs = d.name; this.savedSnap = this.snapOf({ kind: d.kind, parts: designRows(partsFromDesign(d.parts)) }); this.save(); this.renderSaveState(); },
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

  // Designs travel as a short text code: "RSS1." + base64url of compact JSON, rows [type, x, y, flip, rot];
  // "RSS2." when parts also carry [..., z, att, skin] (depth, what they hang on, paint), which older
  // versions can't read.
  designCode(d) {
    let ext = false;
    const rows = d.parts.map((q) => {
      const r = [q.type, q.x, q.y, q.flip ? 1 : 0, q.rot || 0], more = [q.z ?? null, q.att ?? null, q.skin ?? null];
      while (more.length && more[more.length - 1] == null) more.pop();
      if (more.length) { ext = true; r.push(...more); }
      return r;
    });
    const bytes = new TextEncoder().encode(JSON.stringify({ n: d.name, k: d.kind || 'rocket', p: rows }));
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return (ext ? 'RSS2.' : 'RSS1.') + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  parseCode(text) {
    const m = /RSS[12]\.([A-Za-z0-9_-]+)/.exec(text || '');
    if (!m) return null;
    try {
      const b = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
      const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (ch) => ch.charCodeAt(0))));
      const raw = Array.isArray(o.p) ? o.p.slice(0, 20000) : [];
      // (rows stay in place, unknown ones as null, so the att indices still point right)
      const parts = raw.map((q) => (Array.isArray(q) && typeof q[0] === 'string' && hasOwn(PARTS, q[0]) && isFinite(q[1]) && isFinite(q[2])
        ? { type: q[0], x: +q[1], y: +q[2], flip: !!q[3], rot: (q[4] | 0) & 3, z: q[5] == null ? undefined : +q[5], att: Number.isInteger(q[6]) ? q[6] : undefined, skin: typeof q[7] === 'string' ? q[7] : undefined }
        : null));
      const n = parts.filter(Boolean).length;
      if (!n) return null;
      return { name: String(o.n || 'Imported').slice(0, 40), kind: hasOwn(VEHICLE_KINDS, o.k) ? o.k : 'rocket', parts, dropped: raw.length - n, cut: (Array.isArray(o.p) ? o.p.length : 0) - raw.length };
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
      if (!d) { note.textContent = 'That is not a design code. Codes start with RSS1. or RSS2.'; note.hidden = false; return; }
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
      if (d.cut) UI.toast(`That design is too big: ${d.cut} parts past the 20,000th were left out`, 'warn');
      else if (d.dropped) UI.toast(`${d.dropped} part${d.dropped > 1 ? 's' : ''} from a newer version were left out`, 'warn');
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
        const known = s.parts.filter((q) => q && hasOwn(PARTS, q.type));
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
      const w = this.screenToWorld(e.clientX, e.clientY), hits = this.hitParts(w), add = e.shiftKey || e.ctrlKey || e.metaKey, pick = add || this.selectMode;
      // parts at different depths behind one another: the selected one keeps hold, and a tap on it picks the one behind
      const i = !this.multi ? hits.indexOf(this.selected) : -1, hit = i >= 0 ? hits[i] : hits[0] || null;
      if (hit && e.button === 0 && pick && (add || !this.sel.has(hit))) this.toggleSel(hit); // pick several
      else if (hit && e.button !== 2 && e.button !== 1) { this.grab(hit, w, e.pointerId); if (i >= 0 && hits.length > 1) this.drag.behind = hits[(i + 1) % hits.length]; }
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
        else { // a tap: in Select mode it drops the part from the group; on a part already selected, it picks the one behind
          const d = this.drag;
          this.endDrag();
          if (this.selectMode && d.list.length > 1) this.toggleSel(d.part);
          else if (d.behind) { this.selected = d.behind; this.renderInfo(); }
        }
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
      const t = e.target, slider = t.tagName === 'INPUT' && t.type === 'range'; // (a focused slider keeps its arrow keys, not the rest)
      if (App.scene !== 'build' || UI.modalOpen || (t.tagName === 'INPUT' && !slider) || t.tagName === 'TEXTAREA' || (slider && e.code.startsWith('Arrow'))) return;
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
      else if (e.code === 'KeyG' && !mod) this.setGrid(!this.grid);
      else if (e.code === 'KeyM' && !mod) this.matchPaint();
      else if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !this.drag) { e.preventDefault(); const k = e.shiftKey ? 1 : this.gridOn() ? 0.25 : 0.1; this.nudgeZ(e.code === 'BracketLeft' ? -k : k); }
      else if (e.code === 'Escape') { if (this.drag) this.cancelDrag(); else { this.selected = null; this.renderInfo(); if (this.selectMode) this.setSelectMode(false); } }
      else if (this.selected && !this.drag && e.code.startsWith('Arrow')) {
        e.preventDefault();
        const k = e.shiftKey ? 1 : this.gridOn() ? 0.25 : 0.1, dir = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, k], ArrowDown: [0, -k] }[e.code];
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
    $('#btn-grid').setAttribute('aria-pressed', String(!!this.grid));
    $('#btn-grid').addEventListener('click', () => this.setGrid(!this.grid));
    // depth: the slider moves the part live and counts as one step to undo when it's let go
    const zIn = $('#pi-z'), zStep = (k) => this.nudgeZ(k * (this.gridOn() ? 0.25 : 0.1));
    zIn.addEventListener('input', () => this.setDepth(+zIn.value, true));
    zIn.addEventListener('change', () => { this.setDepth(+zIn.value, true); this.changed(); this.renderInfo(); });
    $('#btn-z-in').addEventListener('click', () => zStep(-1));
    $('#btn-z-out').addEventListener('click', () => zStep(1));
    $('#pi-skins').addEventListener('click', (e) => { const b = e.target.closest('.skin-sw'); if (b) this.paintSel(b.dataset.skin || null); });
    $('#btn-match').addEventListener('click', () => this.matchPaint());
    $('#btn-paint-all').addEventListener('click', () => this.paintAll());
    $('#btn-undo').addEventListener('click', () => this.undo());
    $('#btn-redo').addEventListener('click', () => this.redo());
    const sym = $('#btn-sym');
    sym.setAttribute('aria-pressed', String(this.symmetry));
    sym.addEventListener('click', () => {
      this.symmetry = !this.symmetry;
      store.set(this.symKey(this.kind), this.symmetry);
      sym.setAttribute('aria-pressed', String(this.symmetry));
      UI.toast(!this.symmetry ? 'Symmetry off' : this.kind === 'plane' ? 'Symmetry on: whatever goes out on one wing gets a twin on the other' : 'Symmetry on: parts are mirrored across the centre line');
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

  // Start moving a part from where the pointer took hold of it (w: that point in part space). It takes
  // along the rest of the selection (if it's in it) and everything attached to them; the mirror twins of
  // the parts taken follow mirrored, with whatever is attached to them.
  grab(part, w, pointerId) {
    const list = this.multi && this.sel.has(part) ? [...this.sel] : [part], H = this.hosts();
    const group = [...new Set([...list, ...this.kidsOf(list, H)])], inG = new Set(group);
    const twins = [...new Set(list.map((p) => p.mirror).filter((m) => m && !inG.has(m)))];
    const twinKids = new Map(twins.map((m) => [m, this.kidsOf([m], H).filter((q) => !inG.has(q))]));
    const origs = new Map([...group, ...twins, ...[...twinKids.values()].flat()].map((q) => [q, this.pose(q)]));
    this.drag = { part, type: part.type, offset: { x: w.x - part.x, y: w.y - part.y }, orig: this.pose(part), moved: false, pointerId, list, group, twins, twinKids, origs, H };
    if (list.length > 1) this._primary = part; else this.selected = part;
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
      const at = this.pointerToPart(e.clientX, e.clientY, partZc(part)), r = partRect(part);
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
  // What the 3D view draws as the part being placed: the part and, with symmetry, its mirror twin, in the
  // paint it will take from what it goes on.
  ghosts() {
    const d = this.drag;
    if (!d || !d.fromPalette || !d.ghost) return [];
    const g = d.ghost, rot = d.rot || 0, def = PARTS[d.type], skin = g.host ? cleanSkin(skinOf(g.host), def) : null;
    const list = [{ type: d.type, x: g.x, y: g.y, z: g.z, rot, flip: g.x < 0, skin, ok: g.ok }];
    if (g.ok && this.symmetry && this.mirrorOk(d.type, g.x, g.y, [], rot, g.z)) { const m = this.mirrorOf({ type: d.type, ...g, rot }); list.push({ type: d.type, ...m, flip: m.x < 0, skin, ok: true }); }
    return list;
  },
  markers3d() { return !this.drag; },

  // The pointer moved while dragging: find the spot (in 3D on the surface under it, else on the blueprint)
  // and move the part there, with everything that goes with it.
  dragTo(cx, cy) {
    const d = this.drag;
    d.last = { x: cx, y: cy };
    const lift = d.fromPalette && isTouch ? 44 : 0; // keep a part from the tray visible above the finger
    const pal = $('#palette'), overPalette = cy > pal.getBoundingClientRect().top;
    pal.classList.toggle('drop-remove', !d.fromPalette);
    pal.classList.toggle('drop-hot', overPalette);
    const rot = d.part ? d.part.rot || 0 : d.rot || 0, moving = d.origs ? [...d.origs.keys()] : [];
    let s = null;
    if (this.in3D() && Render3D.surfaceHit) {
      const hit = Render3D.surfaceHit(cx, cy - lift, new Set(moving));
      if (hit && hit.part) { this.mpp = hit.mpp; s = this.attach(d.type, rot, hit, this.parts.filter((p) => !d.origs || !d.origs.has(p))); }
    }
    if (!s) {
      const z0 = d.part ? d.orig.z : undefined, w = this.pointerToPart(cx, cy - lift, d.part ? partZc(d.part) : 0);
      if (!w) return; // the 3D view sees the blueprint edge-on: keep the last spot
      this.mpp = w.mpp;
      s = this.snap(d.type, { x: w.x - d.offset.x, y: w.y - d.offset.y, z: z0 }, moving, rot);
    }
    if (isTouch && s.attached && s.ok && !(d.ghost && d.ghost.attached && d.ghost.ok) && navigator.vibrate) navigator.vibrate(8); // a tick as it snaps on
    d.ghost = s;
    d.host = s.host || null;
    if (d.part) this.moveDragged(s);
  },
  // Put the dragged part at spot s, the rest of what it takes along by the same step, and the mirror
  // twins where they mirror it (or back where they were, if they don't fit there).
  moveDragged(s) {
    const d = this.drag, o = d.orig, dx = s.x - o.x, dy = s.y - o.y, dz = s.z - o.z;
    for (const [q, p] of d.origs) this.setPose(q, p);
    for (const q of d.group) { const p = d.origs.get(q); this.setPose(q, { x: p.x + dx, y: p.y + dy, z: p.z + this.zStep(q, dz, d.list, d.H) }); }
    this.setPose(d.part, s);
    const outside = this.parts.filter((q) => !d.origs.has(q)), moving = new Set(d.group);
    d.twinMoved = new Set();
    for (const m of d.twins) {
      const p = m.mirror, pose = p && this.mirrorOf(p);
      if (!pose) continue;
      const mo = d.origs.get(m), kids = d.twinKids.get(m) || [];
      this.setPose(m, pose);
      for (const k of kids) { const ko = d.origs.get(k); this.setPose(k, { x: ko.x + m.x - mo.x, y: ko.y + m.y - mo.y, z: ko.z + this.zStep(k, m.z - mo.z, [m], d.H) }); }
      const fits = ![m, ...kids].some((q) => outside.some((r) => partsClash(q, r)) || d.group.some((r) => partsClash(r, q)));
      if (fits) { d.twinMoved.add(m); moving.add(m); kids.forEach((k) => moving.add(k)); } else { this.setPose(m, mo); for (const k of kids) this.setPose(k, d.origs.get(k)); }
    }
    // the group has to clear everything that stays, twins left where they were included
    d.ghost = { ...s, ok: s.ok && this.groupFits(d.group, [...moving]) };
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
    const overPalette = clientY > $('#palette').getBoundingClientRect().top, s = d.ghost;
    if (d.fromPalette) {
      if (overPalette || !s.ok) return;
      this.addPart(d.type, s.x, s.y, d.rot || 0, { z: s.z, att: s.att, host: s.host });
      return;
    }
    const p = d.part;
    if (!this.parts.includes(p)) return; // gone while it was being dragged
    if (overPalette) { if (d.list.length > 1) this.deleteSel(); else { this.selected = p; this.deleteSelected(); } return; }
    if (!s.ok) { this.cancelDrag(d); this.changed(); return; }
    // the part hangs on what it was dropped against; the others it took along keep theirs while they still
    // touch them, and a twin hangs on the twin of its host
    const byId = new Map(this.parts.map((q) => [q.id, q])), inG = new Set(d.group);
    p.att = s.att ? s.att.id : null;
    for (const q of d.group) {
      const h = q !== p && byId.get(q.att);
      if (h && !inG.has(h) && !this.holds(h, q)) q.att = null;
    }
    for (const m of d.twins) {
      const q = m.mirror;
      if (!q) continue;
      if (!d.twinMoved || !d.twinMoved.has(m)) { q.mirror = null; m.mirror = null; continue; } // it stayed where it was
      const h = byId.get(q.att);
      m.att = h ? (h.mirror || h).id : null;
    }
    // a single part (with nothing on it) dropped off the centre line gets a twin, with symmetry on
    if (d.list.length === 1 && !p.mirror && d.group.length === 1 && this.symmetry && this.mirrorOk(p.type, p.x, p.y, [p], p.rot || 0, p.z)) {
      const t = this.mirrorOf(p), h = byId.get(p.att), m = makePart(p.type, t.x, t.y, { flip: t.x < 0, rot: t.rot, z: t.z, att: h ? (h.mirror || h).id : null, skin: p.skin });
      this.parts.push(m); p.mirror = m; m.mirror = p;
    }
    this.linkMirrors();
    this.changed();
    this.renderInfo();
  },

  cancelDrag(dd) {
    const d = dd || this.drag;
    if (d && d.origs) for (const [q, o] of d.origs) this.setPose(q, o);
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
    // the grid: in grid mode every half metre (and quarter, close up), else only faint 2 m lines for scale
    const grid = this.gridOn(), minor = this.cam.scale > 40 ? 0.25 : this.cam.scale > 14 ? 0.5 : 1;
    ctx.lineWidth = 1;
    for (const [stepv, col] of grid ? [[minor, 'rgba(120,170,230,0.08)'], [2, 'rgba(120,170,230,0.16)']] : [[2, 'rgba(120,170,230,0.06)']]) {
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
    // back to front (the view looks from +z): parts on the far side are drawn first and fade into the
    // blueprint; wings and pods go over the hull they pass through
    for (const p of sideOrder(this.parts)) {
      const loose = !this.attached.has(p.id), z = partZ(p);
      ctx.globalAlpha = loose ? 0.4 : 1;
      drawPart(ctx, p, lw);
      if (z < -0.05 && !p.def.twinZ) { partPath(ctx, p); ctx.fillStyle = `rgba(7,18,34,${Math.min(0.5, 0.15 + 0.04 * -z).toFixed(3)})`; ctx.fill(); }
      if (!Career.unlocked(p.def)) {
        ctx.globalAlpha = 0.45; partPath(ctx, p); ctx.fillStyle = '#ff5d5d'; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
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
      const [g0, g1] = this.ghosts().length ? this.ghosts() : [{ ...d.ghost, rot: d.rot || 0, flip: d.ghost.x < 0 }];
      const gp = { def: PARTS[d.type], type: d.type, deployed: 0, ...g0 };
      ctx.globalAlpha = 0.75;
      drawPart(ctx, gp, lw);
      // the twin, where it shows in the side view (a left/right twin hides right behind the part)
      if (g1 && (Math.abs(g1.x - gp.x) > 0.01 || Math.abs(g1.y - gp.y) > 0.01)) { ctx.globalAlpha = 0.35; drawPart(ctx, { ...gp, ...g1 }, lw); }
      ctx.globalAlpha = 1;
    }
    if (d && d.part && d.ghost && !d.ghost.ok) {
      ctx.fillStyle = 'rgba(255,93,93,0.35)';
      for (const q of d.group) { const r = partRect(q); ctx.fillRect(r.l, r.b, r.r - r.l, r.t - r.b); }
    } else if (d && d.ghost && !d.ghost.ok) {
      const r = partRect({ def: PARTS[d.type], x: d.ghost.x, y: d.ghost.y, rot: d.rot || 0 });
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
    // the side view can't show depth: copies of a part behind one another get a count, and the selected
    // part says where it sits across
    const stacks = new Map();
    for (const p of this.parts) {
      const k = `${p.type}|${p.x.toFixed(2)}|${p.y.toFixed(2)}|${p.rot || 0}`;
      stacks.set(k, { p, n: (stacks.has(k) ? stacks.get(k).n : 0) + (p.def.twinZ ? 2 : 1) });
    }
    ctx.font = `600 ${9.5 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    for (const { p, n } of stacks.values()) {
      if (n < 3 && !(n === 2 && !p.def.twinZ)) continue;
      const r = partRect(p), [ex, ey] = XY(r.l, r.t), [fx, fy] = XY(r.r, r.b), bx = Math.max(ex, fx) - 2 * dpr, by = Math.min(ey, fy) + 2 * dpr;
      ctx.fillStyle = 'rgba(5,9,18,0.85)'; ctx.fillRect(bx - 22 * dpr, by, 22 * dpr, 13 * dpr);
      ctx.fillStyle = '#9fd1ff'; ctx.fillText(`×${n}`, bx - 11 * dpr, by + 7 * dpr);
    }
    const sp = this.selected;
    if (sp && !this.multi && !zLocked(sp.def) && !d) {
      const r = partRect(sp), [ex, ey] = XY(r.l, r.b), [fx, fy] = XY(r.r, r.t), t = this.zText(sp);
      ctx.textAlign = 'left';
      const w = ctx.measureText(t).width + 10 * dpr, bx = Math.min(ex, fx), by = Math.max(ey, fy) + 6 * dpr;
      ctx.fillStyle = 'rgba(5,9,18,0.85)'; ctx.fillRect(bx, by, w, 15 * dpr);
      ctx.fillStyle = '#ffb547'; ctx.fillText(t, bx + 5 * dpr, by + 8 * dpr);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
  },
};
