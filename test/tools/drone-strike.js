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
  // One attack: kind (turretTop, deck, bustle, rear, side), from seed s, by drone dk on tank tk
  var strike = (dk, tk, kind, s) => {
    const R = mulberry32(s), rr = (a, b) => a + (b - a) * R();
    const { F, v } = pilot(droneRows(dk)); const C = park(F, designOf(tk), 30); go(F, 0.8);
    const U = up(C), fw = C.axis(1, 0, 0), rt = C.axis(0, 0, 1), hull = C.parts[0], HR = partRect(hull);
    const tur = C.parts.find((p) => p.def.control && p !== hull && p.def.place === 'ring');
    const jit = (P, a, b) => add3(add3(P, fw, rr(-a, a)), rt, rr(-b, b));
    let T, th, az;
    if (kind === 'turretTop') { T = jit(topOf2(C, tur), 0.5, 0.5); th = rr(45, 80); az = rr(0, 360); }
    else if (kind === 'deck') { const eng = C.parts.find((p) => p.def.module === 'engine'), E = C.toWorld(eng.x, HR.t, partZc(eng)); T = jit(E, 0.5, 0.5); th = rr(45, 80); az = rr(0, 360); }
    else if (kind === 'bustle') { const TR = partRect(tur), P = C.toWorld(TR.l + 0.35, TR.t, partZc(tur)); T = jit(P, 0.3, 0.5); th = rr(25, 50); az = 180 + rr(-60, 60); }
    else if (kind === 'rear') { const P = C.toWorld(HR.l, (HR.b + HR.t) / 2 + 0.15, 0); T = add3(add3(P, rt, rr(-0.5, 0.5)), U, rr(-0.3, 0.3)); th = rr(5, 30); az = 180 + rr(-40, 40); }
    else { const sd = R() < 0.5 ? -1 : 1, P = C.toWorld(rr(-1.5, 1.5), (HR.b + HR.t) / 2 + 0.2, sd * 1.4); T = add3(P, U, rr(-0.3, 0.3)); th = rr(5, 30); az = sd * 90 + rr(-30, 30); }
    // the way it flies: from the side az (0: from ahead), down th
    const a = az * Math.PI / 180, t = th * Math.PI / 180, hx = Math.cos(a), hz = Math.sin(a);
    const from = { x: fw.x * hx + rt.x * hz, y: fw.y * hx + rt.y * hz, z: fw.z * hx + rt.z * hz }; // (the horizontal toward where it comes from)
    const dir = { x: -from.x * Math.cos(t) - U.x * Math.sin(t), y: -from.y * Math.cos(t) - U.y * Math.sin(t), z: -from.z * Math.cos(t) - U.z * Math.sin(t) };
    const sp = rr(20, 35), P0 = add3(T, dir, -7);
    // what the fuse met, and which way the warhead went
    let met = null, path = null, jetPart = null;
    const hf = Armour.hitFirst, hv = Combat.hitVessel, lh = Armour.legacyHit, ex = Combat.explode;
    Armour.hitFirst = function (o, a2, e2) { const q = hf.call(this, o, a2, e2); if (q && o === C) met = q.p.type; return q; };
    Combat.hitVessel = function (o, a2, e2) { const q = hv.call(this, o, a2, e2); if (q && o === C) met = q.p ? q.p.type : met; return q; };
    Armour.legacyHit = function (s2, o, p, ...r) { if (!path) { path = 'jet'; jetPart = p.type; } return lh.call(this, s2, o, p, ...r); };
    Combat.explode = function (...r) { if (!path) { path = 'he'; const a2 = r[1]; miss = +Math.hypot(a2.x - T.x, a2.y - T.y, a2.z - T.z).toFixed(1); } return ex.apply(this, r); };
    let shot = null, miss = null;
    try {
      arm(v); Armour.fb.shot = null; fling(v, P0, dir, sp);
      if (v.aircraft) noseAlong(v, dir, U); // (a winged drone flies nose first: a quad dives pitched, as it sits)
      go(F, 1.2, () => !v.dead && F.active === v ? undefined : false);
      shot = Armour.fb.shot && { r: Armour.fb.shot.r, what: Armour.fb.shot.what.slice() };
      go(F, 3);
    } finally { Armour.hitFirst = hf; Combat.hitVessel = hv; Armour.legacyHit = lh; Combat.explode = ex; }
    const M = modsOf(C), boom = !!v.dl.boom;
    let out = 'nothing';
    if (C.ko && C.ko.x) out = 'destroyed'; else if (C.ko) out = 'ko';
    else if (M.engine || M.track || M.breech || M.gunner || M.crewDead > 0 || M.fire || C.vent) out = 'half'; // (a blow-out: its rounds gone)
    return { out, boom, met, path, jetPart, shot, M, kind, miss, th: +th.toFixed(0), sp: +sp.toFixed(1), ko: C.ko && C.ko.why };
  };`);
}

const KINDS = { turretTop: 0.35, deck: 0.25, bustle: 0.15, rear: 0.15, side: 0.10 };
function plan(n, seed0) {
  const out = [], ks = Object.keys(KINDS);
  let i = 0;
  for (const k of ks) { const m = Math.round(n * KINDS[k]); for (let j = 0; j < m; j++) out.push([k, seed0 + 7919 * (i++) + 1]); }
  return out;
}
function run(ctx, dk, tk, n) {
  const rows = [];
  for (const [kind, s] of plan(n, 1000)) { ctx.__a = [dk, tk, kind, s]; rows.push(JSON.parse(G.run(ctx, 'JSON.stringify(strike(...__a))'))); }
  return rows;
}
function table(rows) {
  const n = rows.length, c = (f) => rows.filter(f).length, pc = (k) => Math.round((100 * k) / n);
  const det = c((r) => r.out === 'destroyed'), ko = c((r) => r.out === 'ko'), half = c((r) => r.out === 'half'), none = c((r) => r.out === 'nothing');
  const why = {};
  for (const r of rows) if (r.out === 'nothing') { const k = `${r.boom ? '' : 'NO BOOM '}${r.met || 'ground'}>${r.path || '-'}${r.shot ? ':' + r.shot.r : ''}`; why[k] = (why[k] || 0) + 1; }
  const byKind = {};
  for (const k of Object.keys(KINDS)) { const R = rows.filter((r) => r.kind === k); if (R.length) byKind[k] = `${Math.round((100 * R.filter((r) => r.out === 'destroyed' || r.out === 'ko').length) / R.length)}/${Math.round((100 * R.filter((r) => r.out !== 'nothing').length) / R.length)}`; }
  return { n, det: pc(det), ko: pc(ko), kod: pc(det + ko), half: pc(half), atLeastHalf: pc(det + ko + half), none: pc(none), byKind, why };
}
module.exports = { harness, run, table, plan, KINDS };

if (require.main === module) {
  const args = process.argv.slice(2), json = args.includes('--json'), rest = args.filter((a) => a !== '--json');
  const n = +rest.find((a) => /^\d+$/.test(a)) || 60;
  const DR = ['bumble', 'bumbleF', 'lancett', 'frag', 'tandem'], TK = ['tk34', 'ma1', 'ma1c', 'bmk2d'];
  const ds = rest.filter((a) => DR.includes(a)), ts = rest.filter((a) => !DR.includes(a) && !/^\d+$/.test(a));
  const ctx = G.load({ combat: true, ground: true, props: true, flight: true });
  harness(ctx);
  const all = {};
  console.log('drone    tank    n   det  KO  det+KO half >=half none  KO/any by attack (turretTop deck bustle rear side)');
  for (const d of ds.length ? ds : DR) for (const tk of ts.length ? ts : TK) {
    const T = table(run(ctx, d, tk, n));
    all[`${d}:${tk}`] = T;
    console.log(`${d.padEnd(8)} ${tk.padEnd(6)} ${String(T.n).padStart(3)} ${String(T.det).padStart(4)}% ${String(T.ko).padStart(3)}% ${String(T.kod).padStart(5)}% ${String(T.half).padStart(4)}% ${String(T.atLeastHalf).padStart(5)}% ${String(T.none).padStart(4)}%  ${Object.values(T.byKind).join(' ')}`);
    const w = Object.entries(T.why).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, x]) => `${k} ×${x}`).join(', ');
    if (w) console.log(`    nothing: ${w}`);
  }
  if (json) console.log(JSON.stringify(all));
}
