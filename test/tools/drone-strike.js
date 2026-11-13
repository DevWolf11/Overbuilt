// What a kamikaze drone does to a tank, measured: stock drones flown into stock tanks along the attacks a player flies
// (steep dives onto the turret roof and the engine deck, onto the turret's back, shallow hits on the rear and the side),
// with the aim point jittered ±0.5 m, the dive 45-80° (shallow ones 5-30°) and 20-35 m/s, each run from a seed. Each
// outcome is one of: destroyed (an ammunition detonation), knocked out (too few crew, the hull or turret at 0 hp),
// half (a mobility kill: engine or track; a firepower kill: the gun or the gunner; or any crewman dead), or nothing;
// and for nothing, why (what the fuse met first, and what the round did there). Not run by run.mjs: a tool.
//
//   node test/tools/drone-strike.js                 # every drone against every tank, 60 runs each
//   node test/tools/drone-strike.js 100 bumble tk34 # 100 runs, only these (any drone or tank keys)
//   node test/tools/drone-strike.js --json          # the table as JSON too
//   node test/tools/drone-strike.js 30 --spots tk72 ma1   # one strike at each spot (good: turretTop deck bustle ring side;
//                                                          # rear; poor: glacis turretFront era): KO/at least half
//   node test/tools/drone-strike.js 30 --kill tk72 ma1    # hits to kill: drones one after another, 4 s apart, at good
//                                                          # spots or at poor ones (and the hits that disable something)
//   ... --ai / --lock                                       # the computer's drones, or a player's on its auto lock-on
//                                                          # (dl.lockOn): Drone.autoFlown, armour.js's DRONE_JET_AI
//
// drones: bumble (the Bumble FPV), bumbleF (Bumble Fibre), lancett (the Lancett), frag (a Bumble with a Frag Charge),
// tandem (a Bumble with a Tandem Charge); tanks: tk34, ma1, ma1c, bmk2d (any tank template key works).
const G = require('../lib/game.js');

function harness(ctx) {
  const RB = (c) => G.run(ctx, c);
  RB(`Math.random = mulberry32(4242);
  var SET = { targets: 'off', droneView: 'fpv', droneStick: 'turn' }, get0 = Settings.get.bind(Settings);
  Settings.get = (k) => (k in SET ? SET[k] : get0(k));
  Flight.running = true;
  var MapView = { focusVessel() {} }; Controls.relayout = () => {}; Controls.keyHints = () => {};
  var App = { use3D: () => !App.flat, flat: false, showScene() {}, afterEarth(f) { f(); }, scene: 'flight' };
  var designOf = (key) => ({ name: TEMPLATES[key].name, kind: TEMPLATES[key].kind, parts: templateRows(TEMPLATES[key]) });
  var NPAD = GroundMode.placement('highland', 0, 0, 'tank');
  var mk = (design, P) => {
    const ps = partsFromDesign(design.parts), adjAll = buildAdjacency(ps), ctrl = findControlPart(ps), keep = componentOf(ctrl.id, adjAll), parts = ps.filter((p) => keep.has(p.id)), adj = new Map();
    for (const p of parts) { if (p.att != null && !keep.has(p.att)) p.att = null; adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id)))); }
    const v = new Vessel(parts, adj, EARTH); v.name = design.name; v.kind = design.kind; v.stages = computeStages(parts, adj, ctrl.id); v.rebuildGroups();
    if (v.docks.length) v.droneChoice = Drone.cleanChoice(design.drone);
    P = P || NPAD; v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), 0, P.z, P.yaw || 0);
    return v; };
  var world = () => { const F = Object.create(Flight);
    Object.assign(F, { time: 0, target: null, log: [], broken: [], vessels: [], active: null, firing: false, mgFiring: false, groundAim: false, warpIdx: 0, mp: null, scale: 12,
      running: true, destroyed: false, camAbs: { x: 0, y: 0, z: 0 }, launchCost: 0, flags: {}, stats: { maxAlt: 0, maxSpeed: 0, maxG: 0 }, design: null, deaths: 0, ends: 0, carrierDown: null, crashedAt: null,
      toast(m) { this.log.push(m); }, award(f) { this.flags[f] = true; }, syncAwake() {}, syncSas() {}, updatePrediction() {}, updateDvEstimate() {}, updateHUD() {}, strip() {}, setSight() {}, unlockPointer() {},
      endAfter() { this.ends++; }, cleanup() { this.vessels = this.vessels.filter((v) => !v.dead && v.parts.length); },
      start(design, opts) { this.design = design; const v = mk(design, opts && opts.place); this.launchCost = designCost(v.parts);
        this.vessels = [v]; this.active = v; this.destroyed = false; this.carrierDown = null; Combat.reset(this); this.running = true; return v; } });
    return F; };
  var go = (F, secs, each) => { for (let f = 0, N = Math.round(secs * 60); f < N; f++) { if (each && each(F, f) === false) return f;
    for (let i = 0; i < 2; i++) { for (const v of F.vessels.slice()) if (!v.remote && !v.wreck && !v.kin && !v.dead && v.parts.length && !(v !== F.active && v.landed && v.restTime > 2)) v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; }
    Combat.frame(F, 1 / 60); F.cleanup(); } return Math.round(secs * 60); };
  var up = (o) => { const r = Math.hypot(o.x, o.y, o.z); return { x: o.x / r, y: o.y / r, z: o.z / r }; };
  var add3 = (a, b, k) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
  var topOf2 = (o, p) => { const R = partRect(p); return o.toWorld((R.l + R.r) / 2, R.t, partZc(p)); };
  var pilot = (rows, name) => { const F = world(), v = F.start({ name: name || 'Strike', kind: 'drone', parts: rows });
    for (const p of v.parts) if (p.def.thrust) p.active = true; v.stageIdx = v.stages.length; v.sas = 'hold'; v.throttle = 0; v.dl = { t: 0, at0: { x: v.x, y: v.y, z: v.z }, t0: 0 };
    return { F, v }; };
  var park = (F, design, e) => { const o = mk(design, { e: NPAD.e + e, z: NPAD.z }); F.vessels.push(o); return o; };
  var fling = (v, P, dir, sp) => { v.x = P.x; v.y = P.y; v.z = P.z; v.vx = dir.x * sp; v.vy = dir.y * sp; v.vz = dir.z * sp; v.av.x = v.av.y = v.av.z = 0;
    v.sas = 'acro'; v.throttle = 0; v.landed = false; v.contactTime = 0; v.restTime = 0; if (v.dl) { v.dl.prev = null; v.dl.sp = 0; } };
  // turn v so its nose (+x) points along d, its +y as near the up U as it can be
  var noseAlong = (v, d, U) => { const k = U.x * d.x + U.y * d.y + U.z * d.z; let y = { x: U.x - d.x * k, y: U.y - d.y * k, z: U.z - d.z * k }; const l = Math.hypot(y.x, y.y, y.z) || 1; y = { x: y.x / l, y: y.y / l, z: y.z / l };
    const z = { x: d.y * y.z - d.z * y.y, y: d.z * y.x - d.x * y.z, z: d.x * y.y - d.y * y.x }, m00 = d.x, m11 = y.y, m22 = z.z, tr = m00 + m11 + m22;
    let q;
    if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; q = { w: 0.25 * S, x: (y.z - z.y) / S, y: (z.x - d.z) / S, z: (d.y - y.x) / S }; }
    else if (m00 > m11 && m00 > m22) { const S = Math.sqrt(1 + m00 - m11 - m22) * 2; q = { w: (y.z - z.y) / S, x: 0.25 * S, y: (y.x + d.y) / S, z: (z.x + d.z) / S }; }
    else if (m11 > m22) { const S = Math.sqrt(1 + m11 - m00 - m22) * 2; q = { w: (z.x - d.z) / S, x: (y.x + d.y) / S, y: 0.25 * S, z: (z.y + y.z) / S }; }
    else { const S = Math.sqrt(1 + m22 - m00 - m11) * 2; q = { w: (d.y - y.x) / S, x: (z.x + d.z) / S, y: (z.y + y.z) / S, z: 0.25 * S }; }
    v.q = q; };
  var arm = (v) => { v.dl.armOK = true; v.dl.t0 = -10; };
  // a drone's rows: a stock drone's, or a Bumble with another warhead
  var droneRows = (k) => { const T = (key) => templateRows(TEMPLATES[key]);
    if (k === 'frag') return T('bumble').map((r) => (r.type === 'drCharge' ? { ...r, type: 'drChargeHE' } : r));
    if (k === 'tandem') return T('bumble').map((r) => (r.type === 'drCharge' ? { ...r, type: 'drChargeT' } : r));
    return T(k); };
  // the state of a tank's crew and modules
  var modsOf = (C) => { const o = { crewDead: 0, crew: 0, gunner: false, engine: false, track: false, breech: false, ring: false, fire: false };
    const Cr = Armour.crewOf(C); o.crew = Cr.crew.length;
    for (const e of Cr.crew) if (!e.alive) { o.crewDead++; if (e.role === 'gunner' || e.base === 'gunner') o.gunner = true; }
    for (const p of C.parts) { const m = p.def.module; if (!p.broken) { if (p.fire > 0) o.fire = true; continue; }
      if (m === 'engine') o.engine = true; else if (m === 'track' || m === 'wheel') o.track = true; else if (m === 'breech' && p.def.weapon && p.def.weapon.kind === 'tgun') o.breech = true; else if (m === 'ring') o.ring = true;
      if (p.fire > 0) o.fire = true; }
    if (C.mfire && C.mfire.length) o.fire = true;
    return o; };
  // Where an attack of this kind aims on tank C, and the way it flies in (az: the side it comes from, 0 ahead; th: down),
  // drawn from R. Good spots: the turret roof (turretTop), the engine deck (deck), the turret's back (bustle: an MA-1's
  // ammunition), the turret ring (ring: where turret and hull meet, from the side or behind), the thin side above the
  // tracks (side); the hull's rear plate (rear). Poor spots: the glacis, the turret's face (turretFront), a reactive brick
  // (era: null on a tank without one).
  var aimFor = (C, kind, R) => {
    const rr = (a, b) => a + (b - a) * R();
    const U = up(C), fw = C.axis(1, 0, 0), rt = C.axis(0, 0, 1), hull = C.parts[0], HR = partRect(hull);
    const tur = C.parts.find((p) => p.def.control && p !== hull && p.def.place === 'ring');
    const jit = (P, a, b) => add3(add3(P, fw, rr(-a, a)), rt, rr(-b, b));
    let T, th, az;
    if (kind === 'turretTop') { T = jit(topOf2(C, tur), 0.5, 0.5); th = rr(45, 80); az = rr(0, 360); }
    else if (kind === 'deck') { const eng = C.parts.find((p) => p.def.module === 'engine'), E = C.toWorld(eng.x, HR.t, partZc(eng)); T = jit(E, 0.5, 0.5); th = rr(45, 80); az = rr(0, 360); }
    else if (kind === 'bustle') { const TR = partRect(tur), P = C.toWorld(TR.l + 0.35, TR.t, partZc(tur)); T = jit(P, 0.3, 0.5); th = rr(25, 50); az = 180 + rr(-60, 60); }
    else if (kind === 'rear') { const P = C.toWorld(HR.l, (HR.b + HR.t) / 2 + 0.15, 0); T = add3(add3(P, rt, rr(-0.5, 0.5)), U, rr(-0.3, 0.3)); th = rr(5, 30); az = 180 + rr(-40, 40); }
    else if (kind === 'side') { const sd = R() < 0.5 ? -1 : 1, P = C.toWorld(rr(-1.5, 1.5), (HR.b + HR.t) / 2 + 0.2, sd * 1.4); T = add3(P, U, rr(-0.3, 0.3)); th = rr(5, 30); az = sd * 90 + rr(-30, 30); }
    else if (kind === 'ring') { // (the ring's edge, just over the hull's roof, from a side or behind: 20-45° down)
      const ring = C.parts.find((p) => p.def.module === 'ring') || tur, RR = partRect(ring), rad = 0.5 * partDepth(ring) * 0.95, b = rr(50, 310) * Math.PI / 180;
      T = C.toWorld((RR.l + RR.r) / 2 + Math.cos(b) * rad, HR.t + 0.12, partZc(ring) + Math.sin(b) * rad); th = rr(20, 45); az = b * 180 / Math.PI + rr(-20, 20); }
    else if (kind === 'glacis') { // (the hull's upper front plate, from ahead, 10-40° down)
      const P = C.toWorld(HR.r - 0.25 * (HR.r - HR.l) * 0.5, HR.t - 0.25, 0); T = add3(add3(P, rt, rr(-0.8, 0.8)), U, rr(-0.15, 0.15)); th = rr(10, 40); az = rr(-35, 35); }
    else if (kind === 'turretFront') { // (the turret's face beside the gun, from ahead, 5-30° down)
      const TR = partRect(tur), P = C.toWorld(TR.r, (TR.b + TR.t) / 2, partZc(tur)); T = add3(add3(P, rt, (R() < 0.5 ? -1 : 1) * rr(0.45, 1.1)), U, rr(-0.2, 0.2)); th = rr(5, 30); az = rr(-35, 35); }
    else if (kind === 'era') { // (a reactive brick, from the way it faces: those on the front from ahead, a roof brick from above)
      const bricks = C.parts.filter((p) => p.def.era && !p.broken);
      if (!bricks.length) return null;
      const e = bricks[Math.floor(R() * bricks.length) % bricks.length], ER = partRect(e), roof = e.att != null && C.parts.find((p) => p.id === e.att) !== hull;
      T = C.toWorld((ER.l + ER.r) / 2, roof ? ER.t : (ER.b + ER.t) / 2, partZc(e)); T = add3(T, rt, rr(-0.2, 0.2));
      if (roof) { th = rr(45, 80); az = rr(0, 360); } else { th = rr(10, 40); az = rr(-30, 30); } }
    else return null;
    return { T, th, az, U, fw, rt };
  };
  // fly drone v (in F) into tank C at A (aimFor's) at sp m/s from 7 m out; what the fuse met, which way the warhead went
  var flyAt = (F, v, C, A, sp) => {
    const { T, th, az, U, fw, rt } = A;
    const a = az * Math.PI / 180, t = th * Math.PI / 180, hx = Math.cos(a), hz = Math.sin(a);
    const from = { x: fw.x * hx + rt.x * hz, y: fw.y * hx + rt.y * hz, z: fw.z * hx + rt.z * hz }; // (the horizontal toward where it comes from)
    const dir = { x: -from.x * Math.cos(t) - U.x * Math.sin(t), y: -from.y * Math.cos(t) - U.y * Math.sin(t), z: -from.z * Math.cos(t) - U.z * Math.sin(t) };
    const P0 = add3(T, dir, -7);
    let met = null, path = null, jetPart = null, shot = null, miss = null;
    const hf = Armour.hitFirst, hv = Combat.hitVessel, lh = Armour.legacyHit, ex = Combat.explode;
    Armour.hitFirst = function (o, a2, e2) { const q = hf.call(this, o, a2, e2); if (q && o === C) met = q.p.type; return q; };
    Combat.hitVessel = function (o, a2, e2) { const q = hv.call(this, o, a2, e2); if (q && o === C) met = q.p ? q.p.type : met; return q; };
    Armour.legacyHit = function (s2, o, p, ...r) { if (!path) { path = 'jet'; jetPart = p.type; } return lh.call(this, s2, o, p, ...r); };
    Combat.explode = function (...r) { if (!path) { path = 'he'; const a2 = r[1]; miss = +Math.hypot(a2.x - T.x, a2.y - T.y, a2.z - T.z).toFixed(1); } return ex.apply(this, r); };
    try {
      arm(v); Armour.fb.shot = null; fling(v, P0, dir, sp);
      if (v.aircraft) noseAlong(v, dir, U); // (a winged drone flies nose first: a quad dives pitched, as it sits)
      go(F, 1.2, () => !v.dead && F.active === v ? undefined : false);
      shot = Armour.fb.shot && { r: Armour.fb.shot.r, what: Armour.fb.shot.what.slice() };
      go(F, 3);
    } finally { Armour.hitFirst = hf; Combat.hitVessel = hv; Armour.legacyHit = lh; Combat.explode = ex; }
    return { met, path, jetPart, shot, miss, boom: !!v.dl.boom };
  };
  var outcome = (C) => { const M = modsOf(C);
    if (C.ko && C.ko.x) return 'destroyed'; if (C.ko) return 'ko';
    if (M.engine || M.track || M.breech || M.gunner || M.crewDead > 0 || M.fire || C.vent) return 'half'; // (a blow-out: its rounds gone)
    return 'nothing'; };
  // One attack: kind (aimFor's), from seed s, by drone dk on tank tk
  // (ai: the drone is the computer's, as GroundAI's drone war flies them; 'lock': a player's on its auto lock-on, dl.lockOn on
  // the tank (Drone.autoFlown either way: the AI's numbers))
  var asAI = (v, ai, C) => { if (ai === 'lock') v.dl.lockOn = { t: C }; else if (ai) v.ai = { drone: true, ground: false, team: 1, ally: false, tgt: null, state: null }; return v; };
  var strike = (dk, tk, kind, s, ai) => {
    const R = mulberry32(s), rr = (a, b) => a + (b - a) * R();
    const { F, v } = pilot(droneRows(dk)); const C = park(F, designOf(tk), 30); asAI(v, ai, C); go(F, 0.8);
    const A = aimFor(C, kind, R);
    if (!A) return null;
    const sp = rr(20, 35), w = flyAt(F, v, C, A, sp), M = modsOf(C);
    return { out: outcome(C), boom: w.boom, met: w.met, path: w.path, jetPart: w.jetPart, shot: w.shot, M, kind, miss: w.miss, th: +A.th.toFixed(0), sp: +sp.toFixed(1), ko: C.ko && C.ko.why };
  };
  // Hits to kill: drones dk fly one after another (gap s apart) into one tank tk, each at a spot drawn from kinds, until
  // it is knocked out or destroyed or max have hit. Returns how many hit (max + 1: it lived), and after each hit whether
  // something new was disabled. (gap 4 s: within the 6 s a crew waits unhurt before it mends anything)
  var campaign = (dk, tk, kinds, s, max, gap, ai) => {
    const R = mulberry32(s), rr = (a, b) => a + (b - a) * R();
    const { F, v } = pilot(droneRows(dk)); const C = park(F, designOf(tk), 30); asAI(v, ai, C); go(F, 0.8);
    const sig = () => { const M = modsOf(C); return [M.engine, M.track, M.breech, M.gunner, M.crewDead, M.fire, !!C.vent, C.parts.filter((p) => p.broken).length].join(); };
    let d = v, hits = 0, dis = 0;
    for (let i = 0; i < max; i++) {
      if (i) { d = Drone.build(droneRows(dk), 'Strike'); d.placeOnSurface(EARTH, siteAngle(EARTH, NPAD.e), 0, NPAD.z); F.vessels.push(d); F.active = d;
        for (const p of d.parts) if (p.def.thrust) p.active = true; d.stageIdx = d.stages.length; d.sas = 'hold'; d.throttle = 0; d.dl = { t: 0, at0: { x: d.x, y: d.y, z: d.z }, t0: 0 }; asAI(d, ai, C); }
      let A = null;
      for (let j = 0; j < 6 && !A; j++) A = aimFor(C, kinds[Math.floor(R() * kinds.length) % kinds.length], R); // (a spot it hasn't, or no longer has: another)
      if (!A) break;
      const before = sig();
      flyAt(F, d, C, A, rr(20, 35)); hits++;
      if (sig() !== before || C.ko) dis++;
      if (C.ko) return { n: hits, dis, why: C.ko.why, x: !!C.ko.x };
      if (gap > 4.2) go(F, gap - 4.2);
    }
    return { n: max + 1, dis, why: null };
  };`);
}

const KINDS = { turretTop: 0.35, deck: 0.25, bustle: 0.15, rear: 0.15, side: 0.10 };
// the spots the hits-to-kill runs aim at: good (the roofs over the turret and the engine, the turret's back and its ring,
// the thin side above the tracks) and poor (the glacis, the turret's face, a reactive brick)
const GOOD = ['turretTop', 'deck', 'bustle', 'ring', 'side'], POOR = ['glacis', 'turretFront', 'era'], SPOTS = [...GOOD, 'rear', ...POOR];
function plan(n, seed0) {
  const out = [], ks = Object.keys(KINDS);
  let i = 0;
  for (const k of ks) { const m = Math.round(n * KINDS[k]); for (let j = 0; j < m; j++) out.push([k, seed0 + 7919 * (i++) + 1]); }
  return out;
}
function run(ctx, dk, tk, n, ai) {
  const rows = [];
  for (const [kind, s] of plan(n, 1000)) { ctx.__a = [dk, tk, kind, s, ai || false]; rows.push(JSON.parse(G.run(ctx, 'JSON.stringify(strike(...__a))'))); }
  return rows;
}
// n single strikes at one spot (null: the tank has no such spot)
function spot(ctx, dk, tk, kind, n, ai) {
  const rows = [];
  for (let i = 0; i < n; i++) { ctx.__a = [dk, tk, kind, 3000 + 7919 * i + 1, ai || false]; const r = JSON.parse(G.run(ctx, 'JSON.stringify(strike(...__a))')); if (!r) return null; rows.push(r); }
  return rows;
}
// n runs of hits to kill on one tank, each drone at a spot drawn from kinds; max hits each
function kills(ctx, dk, tk, kinds, n, max, ai) {
  const rows = [];
  for (let i = 0; i < n; i++) { ctx.__a = [dk, tk, kinds, 9000 + 104729 * i + 1, max || 8, 4.2, ai || false]; rows.push(JSON.parse(G.run(ctx, 'JSON.stringify(campaign(...__a))'))); }
  return rows;
}
function killTable(rows, max) {
  const n = rows.length, k = (m) => Math.round((100 * rows.filter((r) => r.n <= m).length) / n), hits = rows.reduce((a, r) => a + Math.min(r.n, max || 8), 0);
  const ns = rows.map((r) => r.n).sort((a, b) => a - b);
  return { n, k1: k(1), k2: k(2), k3: k(3), k4: k(4), med: ns[Math.floor(n / 2)], mean: +(rows.reduce((a, r) => a + r.n, 0) / n).toFixed(1), dis: Math.round((100 * rows.reduce((a, r) => a + r.dis, 0)) / hits) };
}
function table(rows) {
  const n = rows.length, c = (f) => rows.filter(f).length, pc = (k) => Math.round((100 * k) / n);
  const det = c((r) => r.out === 'destroyed'), ko = c((r) => r.out === 'ko'), half = c((r) => r.out === 'half'), none = c((r) => r.out === 'nothing');
  const why = {};
  for (const r of rows) if (r.out === 'nothing') { const k = `${r.boom ? '' : 'NO BOOM '}${r.met || 'ground'}>${r.path || '-'}${r.shot ? ':' + r.shot.r : ''}`; why[k] = (why[k] || 0) + 1; }
  const byKind = {};
  for (const k of [...new Set(rows.map((r) => r.kind))]) { const R = rows.filter((r) => r.kind === k); if (R.length) byKind[k] = `${Math.round((100 * R.filter((r) => r.out === 'destroyed' || r.out === 'ko').length) / R.length)}/${Math.round((100 * R.filter((r) => r.out !== 'nothing').length) / R.length)}`; }
  return { n, det: pc(det), ko: pc(ko), kod: pc(det + ko), half: pc(half), atLeastHalf: pc(det + ko + half), none: pc(none), byKind, why };
}
module.exports = { harness, run, spot, kills, killTable, table, plan, KINDS, GOOD, POOR, SPOTS };

if (require.main === module) {
  const args = process.argv.slice(2), flag = (f) => args.includes(f), json = flag('--json'), ai = flag('--ai') ? true : flag('--lock') ? 'lock' : false, rest = args.filter((a) => !a.startsWith('--'));
  const n = +rest.find((a) => /^\d+$/.test(a)) || 60;
  const DR = ['bumble', 'bumbleF', 'lancett', 'frag', 'tandem'], TK = ['tk34', 'ma1', 'ma1c', 'bmk2d'], MODERN = ['tk72', 'ma1', 'ma1c', 'leapard1', 'tk34'];
  const ds = rest.filter((a) => DR.includes(a)), ts = rest.filter((a) => !DR.includes(a) && !/^\d+$/.test(a));
  const ctx = G.load({ combat: true, ground: true, props: true, flight: true });
  harness(ctx);
  const all = {}, pct = (x) => (x == null ? '   -' : String(x).padStart(3) + '%');
  if (flag('--spots')) { // per spot: knocked out or destroyed / at least half-disabled, one strike on a fresh tank
    console.log(`${ai === 'lock' ? 'lock-on ' : ai ? 'AI ' : ''}drone    tank      ${SPOTS.map((k) => k.padEnd(11)).join(' ')}  good KO/half  poor KO/half`);
    for (const d of ds.length ? ds : ['bumble']) for (const tk of ts.length ? ts : MODERN) {
      const cells = [], G0 = [], P0 = [];
      for (const k of SPOTS) { const r = spot(ctx, d, tk, k, n, ai); if (!r) { cells.push('-'.padEnd(11)); continue; } const T = table(r); all[`${d}:${tk}:${k}`] = T; cells.push(`${T.kod}/${T.atLeastHalf}`.padEnd(11)); (GOOD.includes(k) ? G0 : POOR.includes(k) ? P0 : []).push(...r); }
      const g = table(G0), p = table(P0);
      console.log(`${d.padEnd(8)} ${tk.padEnd(9)} ${cells.join(' ')}  ${String(g.kod).padStart(3)}/${String(g.atLeastHalf).padStart(3)}      ${String(p.kod).padStart(3)}/${String(p.atLeastHalf).padStart(3)}`);
    }
  } else if (flag('--kill')) { // hits to kill: drones one after another at good spots, or at poor ones
    console.log(`${ai === 'lock' ? 'lock-on ' : ai ? 'AI ' : ''}drone    tank      spots  n   kill≤1 ≤2   ≤3   ≤4  median mean  hits that disable something`);
    for (const d of ds.length ? ds : ['bumble']) for (const tk of ts.length ? ts : MODERN) for (const [nm, kinds] of [['good', GOOD], ['poor', POOR]]) {
      const T = killTable(kills(ctx, d, tk, kinds, n, 8, ai), 8); all[`${d}:${tk}:${nm}`] = T;
      console.log(`${d.padEnd(8)} ${tk.padEnd(9)} ${nm.padEnd(5)} ${String(T.n).padStart(3)} ${pct(T.k1)} ${pct(T.k2)} ${pct(T.k3)} ${pct(T.k4)}  ${String(T.med > 8 ? '>8' : T.med).padStart(4)} ${String(T.mean).padStart(5)}  ${pct(T.dis)}`);
    }
  } else {
    console.log(`${ai === 'lock' ? 'lock-on ' : ai ? 'AI ' : ''}drone    tank    n   det  KO  det+KO half >=half none  KO/any by attack (turretTop deck bustle rear side)`);
    for (const d of ds.length ? ds : DR) for (const tk of ts.length ? ts : TK) {
      const T = table(run(ctx, d, tk, n, ai));
      all[`${d}:${tk}`] = T;
      console.log(`${d.padEnd(8)} ${tk.padEnd(6)} ${String(T.n).padStart(3)} ${String(T.det).padStart(4)}% ${String(T.ko).padStart(3)}% ${String(T.kod).padStart(5)}% ${String(T.half).padStart(4)}% ${String(T.atLeastHalf).padStart(5)}% ${String(T.none).padStart(4)}%  ${Object.values(T.byKind).join(' ')}`);
      const w = Object.entries(T.why).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, x]) => `${k} ×${x}`).join(', ');
      if (w) console.log(`    nothing: ${w}`);
    }
  }
  if (json) console.log(JSON.stringify(all));
}
