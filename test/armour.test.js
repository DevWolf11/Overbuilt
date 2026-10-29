// The ground update's armour (js/armour.js, §6): where shells hit (prisms, round parts, boxes, turned turrets, raised
// barrels), how plates take them (thickness by face, angle, normalisation, overmatch, ricochet windows, penetration
// falling with speed through each shell's own drag), screens (skirts, slats, reactive bricks), what gets through does
// inside (its path, fragments, an APHE burst; the same every time for the same shot), modules (crew, ammunition, fuel,
// engines, fires, repairs, knock-outs, a detonation's turret toss), HE against plates, old weapons against armour,
// multiplayer hit messages from honest, hostile and broken peers, and that old craft see none of it (old explode,
// combat.json). Real parts throughout: a TK-34-like tank and an MA-1-like one (§12), plus a plain test block.
//   node test/armour.test.js
const G = require('./lib/game.js'), path = require('path'), { spawnSync } = require('child_process');
const ctx = G.load({ combat: true, ground: true });
const R = (c) => G.run(ctx, c);
const t = G.checks('armour: hits, plates, shells, modules, multiplayer');
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

R(`var near = (a, b, e = 1e-9) => Math.abs(a - b) <= e, A = Armour._t, D2R = Math.PI / 180;
// a plain block (2 m, 100 mm all round) for clean angles, with one crewman in the middle
PARTS.tstBlock = { type: 'tstBlock', maxTemp: 2000, cat: 'hulls', name: 'Test Block', gv: true, shape: 'thull', w: 2, h: 2, depth: 2, mass: 10, cost: 1000, tier: 0, control: 1, hp: 5000,
  armour: { mm: 100, min: 10, max: 300, edge: [1, 1, 1, 1], z: 1, mat: 'steel' }, mods: [{ k: 'crew', role: 'gunner', at: [0, 0, 0], r: 0.3, hp: 100 }] };
var TK = [ // TK-34-like (§12): hull, two tracks, a diesel, a ring, a cast turret, the 85 mm gun, a coaxial MG
  { type: 'hullMedium', x: 0, y: 1.1, flip: false, rot: 0 },
  { type: 'trackMed', x: 0, y: 0.5, flip: false, rot: 0, z: -1.35, att: 0 }, { type: 'trackMed', x: 0, y: 0.5, flip: false, rot: 0, z: 1.35, att: 0 },
  { type: 'engDiesel', x: -1.8, y: 1.1, flip: true, rot: 0, att: 0 },
  { type: 'ringM', x: 0, y: 1.85, flip: false, rot: 0, att: 0 }, { type: 'turretCast', x: 0, y: 2.425, flip: false, rot: 0, att: 4 },
  { type: 'gun85', x: 2.622, y: 2.425, flip: false, rot: 3, att: 5 }, { type: 'mgCoax', x: 1.4, y: 2.425, flip: false, rot: 3, z: 0.6, att: 5 }];
var MA = [ // MA-1-like: composite hull and wedge turret with its bustle, turbine, 120 mm, skirts
  { type: 'hullMBT', x: 0, y: 1.2, rot: 0 },
  { type: 'trackMBT', x: 0, y: 0.55, rot: 0, z: -1.575, att: 0 }, { type: 'trackMBT', x: 0, y: 0.55, rot: 0, z: 1.575, att: 0 },
  { type: 'engTurbine', x: -2.6, y: 1.2, rot: 0, att: 0 },
  { type: 'ringP', x: 0.2, y: 2.01, rot: 0, att: 0 }, { type: 'turretWedge', x: 0.2, y: 2.545, rot: 0, att: 4 },
  { type: 'gun120', x: 3.85, y: 2.5, rot: 3, att: 5 }, { type: 'mgCoax', x: 2.3, y: 2.5, rot: 3, z: 0.55, att: 5 }, { type: 'mgHeavy', x: -0.6, y: 3.22, rot: 3, z: -0.8, att: 5 },
  { type: 'smokeL', x: 1.2, y: 2.6, rot: 0, z: 1.85, att: 5 }, { type: 'smokeL', x: 1.2, y: 2.6, rot: 0, z: -1.85, att: 5 },
  { type: 'thermal', x: 0.6, y: 3.17, rot: 0, z: 0.9, att: 5 }, { type: 'lrf', x: 0.9, y: 3.12, rot: 0, z: 0.4, att: 5 },
  { type: 'skirts', x: 0.3, y: 0.95, rot: 0, z: 1.95, att: 0 }, { type: 'skirts', x: 0.3, y: 0.95, rot: 0, z: -1.95, att: 0 }];
var vesselOf = (rows, kind = 'tank') => { const ps = partsFromDesign(rows.map((q) => ({ flip: false, ...q }))), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = kind; v.rebuildGroups(); return v; };
// up in the air, level and still, its part axes the sim's
var air = (rows = TK) => { const v = vesselOf(rows); v.x = EARTH.radius + 2500; v.y = 0; v.z = 0; v.vx = v.vy = v.vz = 0; v.q = quat(); v.av = v3(); return v; };
var simOf = (...vs) => ({ time: 100, target: null, toasts: [], broken: [], vessels: [...vs], active: vs[0], running: true, warpIdx: 1, firing: false, destroyed: false, camAbs: { x: 0, y: 0, z: 0 },
  toast(t) { this.toasts.push(t); }, onDestroyed() { this.destroyed = true; },
  ripParts(v, parts) { this.broken.push('rip:' + parts.map((p) => p.type)); for (const p of parts) { for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.get(p.id).clear(); } for (const q of v.splitComponents()) this.vessels.push(q); v.rebuildGroups(); },
  breakParts(v, parts) { this.broken.push('break:' + parts.map((p) => p.type)); for (const p of parts) { v.parts = v.parts.filter((q) => q !== p); for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.delete(p.id); }
    if (!v.parts.length) { v.dead = true; return; } for (const q of v.splitComponents()) this.vessels.push(q); v.rebuildGroups(); } });
var serial = 1000;
// a shell of key sh aimed at part-space point P of v along the sim direction d, starting 'from' metres out
var shellAt = (v, sh, P, d, from = 50, extra) => { const w = v.toWorld(P.x, P.y, P.z || 0), S = SHELLS[sh];
  return Object.assign({ k: 'shell', sh, b: EARTH, x: w.x - d.x * from, y: w.y - d.y * from, z: w.z - d.z * from, vx: d.x * S.v0, vy: d.y * S.v0, vz: d.z * S.v0, t: 1, life: 6, owner: null, enemy: true, net: 0,
    cal: S.cal, pen: S.pen, v0: S.v0, tracer: true, prox: S.prox || 0, ric: false, gTop: Infinity, n: ++serial }, extra || {}); };
// resolve one shell at P along d (the ray from just outside v, as moveShell casts it)
var res = (v, sh, P, d, extra) => { const s = shellAt(v, sh, P, d, 0.05, extra), w = v.toWorld(P.x, P.y, P.z || 0);
  return Armour.resolve(s, v, Armour.hitAll(v, { x: s.x, y: s.y, z: s.z }, { x: w.x + d.x * 25, y: w.y + d.y * 25, z: w.z + d.z * 25 }), {}); };
var fly = (s, F, n = 900) => { for (let i = 0; i < n; i++) if (!Armour.moveShell(s, 1 / 120, F)) return i; return -1; };
var dirAt = (deg) => ({ x: -Math.cos(deg * D2R), y: -Math.sin(deg * D2R), z: 0 }); // (into the +x face, deg from its normal)
var first = (hs) => hs.find((h) => h.t0 >= 0);`);

// ---------------------------------------------------------------- hit geometry
t('a prism: a level shot meets the TK-34\'s upper glacis (edge 2) at 63°, then the engine inside', R(`(() => { const v = air(), hs = Armour.hitAll(v, v.toWorld(10, 1.4, 0), v.toWorld(-10, 1.4, 0));
  const n = hs[0].n, deg = Math.acos(Math.abs(n.x)) / D2R; return hs[0].p.type === 'hullMedium' && hs[0].edge === 2 && near(deg, 63, 0.5) && hs[1].p.type === 'engDiesel'; })()`));
t('a prism: the lower plate (edge 1), the side (z face), the roof (edge 3) and the floor (edge 0)', R(`(() => { const v = air(), e = (a, b) => first(Armour.hitAll(v, v.toWorld(...a), v.toWorld(...b)));
  const lo = e([10, 0.75, 0], [-10, 0.75, 0]), sd = e([0.5, 1.2, 10], [0.5, 1.2, -10]), rf = e([-2.2, 9, 0], [-2.2, 0.9, 0]), fl = e([0, -5, 0], [0, 1.1, 0]);
  return lo.edge === 1 && sd.edge === A.EZ && sd.n.z === 1 && rf.edge === 3 && fl.edge === 0; })()`));
t('a round part: a cast turret\'s wall from the front (u 1, the normal tilted up 25°), from behind (u -1) and its roof', R(`(() => { const v = air(), e = (a, b) => Armour.hitAll(v, v.toWorld(...a), v.toWorld(...b)).find((h) => h.p.type === 'turretCast');
  const f = e([10, 2.05, 0.1], [-10, 2.05, 0.1]), r = e([-10, 2.05, 0.1], [10, 2.05, 0.1]), top = e([0, 9, 0.5], [0, 2, 0.5]);
  return f.edge === A.ESIDE && f.u > 0.98 && near(Math.asin(f.n.y) / D2R, 25, 1e-6) && r.u < -0.98 && top.edge === A.ETOP; })()`));
t('a box: a track is entered on its outer side (z) or its end; an old part on a plated craft by its old box', R(`(() => { const v = air(), e = (a, b) => first(Armour.hitAll(v, v.toWorld(...a), v.toWorld(...b)));
  const sd = e([0, 0.5, 9], [0, 0.5, 0]), end = e([9, 0.5, 1.35], [0, 0.5, 1.35]);
  const w = air([...TK, { type: 'cab', x: -4, y: 1.2, rot: 0, att: 0 }]), c = first(Armour.hitAll(w, w.toWorld(-4, 9, 0), w.toWorld(-4, 0, 0)));
  return sd.p.type === 'trackMed' && sd.edge === A.EZ && end.p.type === 'trackMed' && end.edge === 1 && c.p.type === 'cab' && c.box && c.n.y === 1; })()`));
t('a turned turret: at ψ = 90° a shot from the side meets the turret\'s FRONT (and the gun turned with it)', R(`(() => {
  const v = air(), ring = v.parts[4]; ring.aimYaw = Math.PI / 2; const hs = Armour.hitAll(v, v.toWorld(0, 2.3, 10), v.toWorld(0, 2.3, -10)), tu = hs.find((h) => h.p.type === 'turretCast');
  const w = air(), h0 = Armour.hitAll(w, w.toWorld(0, 2.3, 10), w.toWorld(0, 2.3, -10)).find((h) => h.p.type === 'turretCast');
  return tu.u > 0.99 && hs[0].p.type === 'gun85' && Math.abs(h0.u) < 0.01; })()`));
R(`var bx = (() => { // a raised barrel: a ray across where the barrel's tip is at 20° (and wasn't level)
  const v = air(), gun = v.parts[6]; gun.aimEl = 20 * D2R; const T = Aim.trunnion(v, gun, v3()), M = Aim.muzzle(v, gun, v3());
  const P = { x: T.x + (M.x - T.x) * 0.9, y: T.y + (M.y - T.y) * 0.9, z: T.z + (M.z - T.z) * 0.9 }, a = { x: P.x, y: P.y, z: P.z + 5 }, e = { x: P.x, y: P.y, z: P.z - 5 };
  const up = Armour.hitAll(v, a, e).some((h) => h.p === gun); gun.aimEl = 0; const lvl = Armour.hitAll(v, a, e).some((h) => h.p === gun);
  return [up, lvl, (M.y - T.y) / Math.hypot(M.x - T.x, M.y - T.y)]; })();`);
t('a raised barrel: its box turns about the trunnion (hit at 20°, missed level)', R('bx[0] && !bx[1] && near(bx[2], Math.sin(20 * D2R), 1e-6)'), R('bx'));
t('nested turrets: a cupola ring on a turned turret, each turned, raised barrels too: the fast frames agree with Aim.unpose', R(`(() => {
  const v = air([...TK, { type: 'ringS', x: -0.5, y: 3.0, rot: 0, att: 5 }, { type: 'mgHeavy', x: -0.5, y: 3.9, rot: 0, att: 8 }]); v.q = qaxis(0.2, 1, -0.3, 0.9);
  v.parts[4].aimYaw = 0.7; v.parts[8].aimYaw = -1.9; v.parts[6].aimEl = 0.2; v.parts[9].aimYaw = 0.4; v.parts[9].aimEl = 0.5;
  const nested = v.tg.some((g) => g.parent), recs = A.recsOf(v); let worst = 0;
  for (let i = 0; i < 40; i++) { const P = { x: v.x + Math.sin(i * 7.1) * 4, y: v.y + Math.cos(i * 3.3) * 4, z: v.z + Math.sin(i * 1.7) * 4 };
    for (const r of recs) { const a = A.simOwn(v, r.p, P, v3()), b = A.recOwn(v, r, P, v3()); worst = Math.max(worst, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)); } }
  return nested && worst < 1e-9; })()`));
t('hitFirst: the first part along a segment and where, as hitVessel answers', R(`(() => { const v = air(), a = v.toWorld(10, 1.4, 0), e = v.toWorld(-10, 1.4, 0), q = Armour.hitFirst(v, a, e), hs = Armour.hitAll(v, a, e);
  return q.p === hs[0].p && near(q.t, hs[0].t0) && Armour.hitFirst(v, v.toWorld(10, 9, 0), v.toWorld(-10, 9, 0)) === null; })()`));

// ---------------------------------------------------------------- plates: thickness, angle, normalisation, overmatch, ricochet
R(`var blk = (mm) => { const v = air([{ type: 'tstBlock', x: 0, y: 0, rot: 0 }]); if (mm) v.parts[0].mm = mm; return v; };
var at = (v, sh, deg, extra) => res(v, sh, { x: 1, y: 0.0, z: 0 }, dirAt(deg), extra);
var effWant = (t, deg, norm) => t / Math.cos(Math.max(0, deg - norm) * D2R);`);
t('effective thickness: t / cos(θ - normalisation) for AP (5°) and APFSDS (2°); a level hit, t', R(`(() => {
  const S = (k) => ({ ...SHELLS[k] }), e = (k, d) => A.effOf(100, d, S(k), SHELL_TYPES[S(k).type], 1)[0];
  return near(e('ap75', 0), 100) && near(e('ap75', 40), effWant(100, 40, 5)) && near(e('ap75', 4), 100) && near(e('apfsds120', 60), effWant(100, 60, 2)) && near(e('heat105', 60), 200) && near(e('ap75', 89.5), 600); })()`));
R(`var edge = [];
for (const deg of [0, 20, 40, 55]) for (const [sh, k] of [['ap75', 'ap'], ['apfsds120', 'apfsds'], ['apcr88', 'apcr']]) {
  const want = effWant(100, deg, SHELL_TYPES[k].norm), v = blk();
  const over = at(v, sh, deg, { pen: want * 1.002, v0: SHELLS[sh].v0 }), under = at(v, sh, deg, { pen: want * 0.998, v0: SHELLS[sh].v0 });
  edge.push([deg, sh, over.r, under.r]);
}`);
t('penetration exactly at the effective thickness, at 0-55° (AP, APFSDS, APCR)', R(`edge.every(([, , a, b]) => a === 'pen' && b === 'nopen')`), R('edge.filter(([, , a, b]) => a !== "pen" || b !== "nopen")'));
R(`var ricRate = (sh, deg, n = 400) => { let k = 0; const v = blk(); for (let i = 0; i < n; i++) if (at(v, sh, deg, { pen: 5000 }).r === 'ric') k++; return k / n; };
var rics = [];
for (const [sh, type] of [['ap75', 'ap'], ['aphe85', 'aphe'], ['apfsds120', 'apfsds'], ['heat120', 'heat'], ['ball8', 'ball']]) {
  const T = SHELL_TYPES[type];
  for (const deg of [T.ric[0] - 4, (T.ric[0] + T.ric[1]) / 2 + T.norm, T.ric[1] + T.norm + 3]) rics.push([sh, deg, ricRate(sh, deg), smoothstep(T.ric[0], T.ric[1], Math.max(0, deg - T.norm))]);
}`);
t('ricochet windows by angle: never below, certain above, smoothstep between (seeded per shot, 400 shots)', R(`rics.every(([, , got, want]) => Math.abs(got - want) <= 0.08)`), R('rics.map((r) => r.slice(0, 2).concat(r.slice(2).map((x) => +x.toFixed(2))))'));
t('a ricochet leaves as a new shell: mirrored off the plate, 0.6 of the speed, half the penetration, never bouncing again', R(`(() => {
  const v = blk(); let r = null; for (let i = 0; i < 50 && !r; i++) { const q = at(v, 'ap75', 85, { pen: 300 }); if (q.ric) r = q; }
  const s = r.ric, sp = Math.hypot(s.vx, s.vy, s.vz), d = dirAt(85), want = Math.hypot(d.x, d.y) * SHELLS.ap75.v0;
  return r.r === 'ric' && s.ric && s.vx > 0 && near(sp, 0.6 * SHELLS.ap75.v0, 1e-6) && near(s.pen, 150, 1e-6) && at(v, 'ap75', 85, { ric: true, pen: 300 }).r !== 'ric' && near(want, SHELLS.ap75.v0); })()`));
t('overmatch: a 120 mm dart on a 30 mm plate at 80° takes it at 0.6 of the angle, and never bounces', R(`(() => { const v = blk(30), S = { ...SHELLS.apfsds120 };
  const [e, a, over] = A.effOf(30, 80, S, SHELL_TYPES.apfsds, 1), n = [...Array(60)].filter(() => at(v, 'apfsds120', 80).r === 'ric').length;
  return over && near(a, 78 * 0.6) && near(e, 30 / Math.cos(78 * 0.6 * D2R)) && n === 0; })()`));
t('a shaped charge meets composite\'s own strength (×heat against HEAT only)', R(`(() => { const S = SHELLS; return near(A.effOf(100, 0, S.heat120, SHELL_TYPES.heat, 1.6)[0], 160) && near(A.effOf(100, 0, S.apfsds120, SHELL_TYPES.apfsds, 1.6)[0], 100); })()`));
t('the player\'s dialled plate (p.mm) is the plate hit', R(`(() => { const v = blk(); v.parts[0].mm = 60; return at(v, 'ap75', 0, { pen: 61 }).r === 'pen' && at(v, 'ap75', 0, { pen: 59 }).r === 'nopen'; })()`));

// ---------------------------------------------------------------- shells in flight: penetration over range, with each shell's own drag
// (flown level 20 m over the sea for 500, 1,000 and 2,000 m: pen·(v/v0)^1.43 against the drag law's own answer,
// v = v0·e^(-k·ρ·s), so pen·e^(-1.43·k·ρ·s))
R(`var ranged = [], F0 = simOf(); F0.vessels = [];
for (const key of Object.keys(SHELLS).filter((k) => ({ ap: 1, aphe: 1, apcr: 1, apds: 1, apfsds: 1, ball: 1 })[SHELLS[k].type])) {
  const S = SHELLS[key], r = EARTH.radius + 20, rho = airDensity(EARTH, 20);
  for (const D of [500, 1000, 2000]) {
    const s = { k: 'shell', sh: key, b: EARTH, x: r, y: 0, z: 0, vx: 0, vy: S.v0, vz: 0, t: 0, life: 30, owner: null, net: 0, cal: S.cal, pen: S.pen, v0: S.v0, gTop: 0, n: ++serial };
    let L = 0; while (L < D) { const sp = Math.hypot(s.vx, s.vy, s.vz); if (!Armour.moveShell(s, 1 / 120, F0)) break; L += Math.hypot(s.vx, s.vy, s.vz) / 120; void sp; }
    const got = A.penAt(s, Math.hypot(s.vx, s.vy, s.vz)), want = S.pen * Math.exp(-1.43 * S.k * rho * L);
    ranged.push([key, D, +got.toFixed(1), +want.toFixed(1), Math.abs(got / want - 1)]);
  }
}`);
t(`penetration against range for every kinetic shell (${R('ranged.length / 3')} shells): within 2% of the drag law's`, R('ranged.every((r) => r[4] < 0.02)'), R('ranged.filter((r) => r[4] >= 0.02 || r[0] === "aphe85" || r[0] === "apfsds120")'));
t('the catalogue\'s check: 85 mm APHE has about 124 mm at 1 km near the ground', R(`(() => { const r = ranged.find((q) => q[0] === 'aphe85' && q[1] === 1000); return r[2] > 122 && r[2] < 126; })()`), R(`ranged.find((q) => q[0] === 'aphe85' && q[1] === 1000)`));

// ---------------------------------------------------------------- screens: skirts, slat cages, reactive bricks (HEAT and tandem)
R(`var scr = (extra) => air([{ type: 'tstBlock', x: 0, y: 0, rot: 0 }, ...extra.map((q) => ({ att: 0, ...q }))]);
var down = { x: 0, y: 0, z: -1 }, intoX = { x: -1, y: 0, z: 0 };
var skirt = scr([{ type: 'skirts', x: 0, y: 0, rot: 0, z: 1.43 }]); // (its inner face at 1.40: the jet crosses 0.4 m of air to the block)
var skirtAt = (pen) => res(skirt, 'heat120', { x: 0, y: 0, z: 1.5 }, down, { pen }).r;
var slat = scr([{ type: 'slatCage', x: 0, y: 0, rot: 0, z: 1.5 }]);
var slatRate = (tandem) => { let n = 0; for (let i = 0; i < 400; i++) if (res(slat, 'heat120', { x: 0, y: 0, z: 1.6 }, down, { pen: 2000, tandem }).what.includes('SLAT')) n++; return n / 400; };
var era1 = scr([{ type: 'era', x: 1.2, y: 0, rot: 1 }]), era2 = scr([{ type: 'era', x: 1.2, y: 0, rot: 1 }, { type: 'era', x: 1.6, y: 0, rot: 1 }]);
var eraAt = (v, sh, pen, tandem) => res(v, sh, { x: 2, y: 0, z: 0 }, intoX, { pen, v0: SHELLS[sh].v0, tandem }).r;`);
t('skirts: a shaped charge goes off on them, ×0.7 and 250 mm a metre of air to the plate (threshold 286 mm on 100)', R(`skirtAt(289) === 'pen' && skirtAt(283) === 'nopen' && res(skirt, 'apfsds120', { x: 0, y: 0, z: 1.5 }, down, { pen: 107 }).r === 'pen'`),
  R('[skirtAt(289), skirtAt(283)]'));
t('a slat cage crushes about half the plain shaped charges (and the struck slat takes 10%); never a tandem one', R(`(() => { const a = slatRate(false), b = slatRate(true); return Math.abs(a - 0.5) < 0.08 && b === 0; })()`), R('[slatRate(false), slatRate(true)]'));
t('a reactive brick takes 100 mm off a dart and 400 off a shaped charge, and is blown off (all its hp)', R(`eraAt(era1, 'apfsds120', 205) === 'pen' && eraAt(era1, 'apfsds120', 195) === 'nopen' && eraAt(era1, 'heat120', 505) === 'pen' && eraAt(era1, 'heat120', 495) === 'nopen'
  && res(era1, 'heat120', { x: 2, y: 0, z: 0 }, intoX).rows.some(([p, k]) => p.type === 'era' && k === Combat.maxHp(PARTS.era))`), R(`[eraAt(era1, 'apfsds120', 205), eraAt(era1, 'apfsds120', 195), eraAt(era1, 'heat120', 505), eraAt(era1, 'heat120', 495)]`));
t('a tandem charge: its precursor sets off the first brick; a second one still counts', R(`eraAt(era1, 'heat120', 120, true) === 'pen' && eraAt(era2, 'heat120', 120, true) === 'nopen' && eraAt(era2, 'heat120', 505, true) === 'pen' && eraAt(era2, 'heat120', 505, false) === 'nopen'`),
  R(`[eraAt(era1, 'heat120', 120, true), eraAt(era2, 'heat120', 120, true), eraAt(era2, 'heat120', 505, true), eraAt(era2, 'heat120', 505, false)]`));
R(`var chip = (sh) => { const r = res(era1, sh, { x: 2, y: 0, z: 0 }, intoX); return [r.r, (r.rows.find(([p]) => p.type === 'era') || [0, 0])[1], r.rows.length, r.what.includes('ERA')]; };`);
t('a machine-gun bullet doesn\'t set a brick off: it chips it (its own damage) and stops there; from 20 mm up a round does', R(`(() => { const a = chip('ball8'), b = chip('ball13'), c = chip('ap20');
  return a.join() === 'nopen,9,1,false' && b.join() === 'nopen,16,1,false' && c[1] === Combat.maxHp(PARTS.era) && c[3]; })()`), R(`[chip('ball8'), chip('ball13'), chip('ap20')]`));

// ---------------------------------------------------------------- after penetration: path, fragments, APHE burst
PARTS_BLOCK2 = R(`PARTS.tstBlock2 = { ...PARTS.tstBlock, type: 'tstBlock2', name: 'Test Block 2', mods: [{ k: 'crew', role: 'gunner', at: [0, 0, 0], r: 0.3, hp: 100 }, { k: 'crew', role: 'loader', at: [-0.1, 0, 0.4], r: 0.2, hp: 100 }] }; 1`);
t('the same shot on the same vessel does the same thing (rows, modules, fragments), another shot differently', R(`(() => { const v = air(MA), j = (n) => { const r = res(v, 'apfsds120', { x: 2.4, y: 1.5 }, intoX, { n });
  return JSON.stringify([r.r, r.rows.map(([p, k]) => [v.parts.indexOf(p), +k.toFixed(6)]), r.mods.map(([p, i, k]) => [v.parts.indexOf(p), i, +k.toFixed(6)])]); };
  return j(77) === j(77) && j(78) === j(78) && j(77) !== j(78); })()`));
R(`var fuelled = air([{ type: 'tstBlock', x: 0, y: 0, rot: 0 }, { type: 'fuelCell', x: 0.55, y: 0, rot: 0, att: 0 }]), bare = air([{ type: 'tstBlock', x: 0, y: 0, rot: 0 }]);
var hcrew = (v) => { let k = 0; for (let i = 0; i < 40; i++) { const r = res(v, 'hesh105', { x: 1, y: 0, z: 0 }, intoX); k += r.mods.filter(([h, j]) => h.def.mods[j].k === 'crew').reduce((s, q) => s + q[2], 0); } return k; };`);
t('fragments: a squash head throws them off the inside of the plate; a fuel cell in their way stops them all', R(`hcrew(bare) > 0 && hcrew(fuelled) === 0`), R('[hcrew(bare), hcrew(fuelled)]'));
// (3I's balance: the 85 mm's burst is 320 in 1.6 m, so a frontal hit doesn't set off every rack: SHELLS' own numbers here)
t('the APHE burst: 1.2 m past the plate, burst·(1 - d/r)^1.2 to a module in reach (here 0.6 m off it: 182)', R(`(() => { const v = air([{ type: 'tstBlock2', x: 0, y: 0, rot: 0 }]), r = res(v, 'aphe85', { x: 1, y: 0, z: 0 }, intoX, { pen: 145, v0: SHELLS.aphe85.v0 });
  const S = SHELLS.aphe85, k1 = (r.mods.find(([, i]) => i === 1) || [0, 0, 0])[2]; return r.r === 'pen' && near(k1, S.burst * Math.pow(1 - 0.6 / S.r, 1.2), 1e-6) && r.mods.find(([, i]) => i === 0)[2] > S.burst; })()`),
  R(`(() => { const v = air([{ type: 'tstBlock2', x: 0, y: 0, rot: 0 }]), r = res(v, 'aphe85', { x: 1, y: 0, z: 0 }, intoX); return r.mods.map((q) => [q[1], q[2]]); })()`));
// (the path alone: an old 20 mm cannon round, 30 mm and no fragments, through a 20 mm plate: 3× its damage along 1.5 m)
R(`var lres = (v, LG, P, d) => { const w = v.toWorld(P.x, P.y, P.z || 0), s = { legacy: LG, vx: d.x * 900, vy: d.y * 900, vz: d.z * 900, n: ++serial, pen: LG.pen, v0: 900, ric: false, t: 9 };
  return Armour.resolve(s, v, Armour.hitAll(v, { x: w.x - d.x * 0.05, y: w.y - d.y * 0.05, z: w.z - d.z * 0.05 }, { x: w.x + d.x * 25, y: w.y + d.y * 25, z: w.z + d.z * 25 }), {}); };
var gun20 = { type: 'ball', pen: 30, cal: 20, dmg: 15 }, pathOf = (rows, pen) => { const v = air(rows); v.parts[0].mm = 20; return lres(v, { ...gun20, pen }, { x: 1, y: 0.2, z: 0 }, intoX); };
var withEng = [{ type: 'tstBlock', x: 0, y: 0, rot: 0 }, { type: 'engDiesel', x: -0.1, y: 0, rot: 0, att: 0 }];`);
t('the path: what it crosses takes dmg·(1 - 0.5·s/L); an engine takes 30 mm out of what is left, and with too little it stops there', R(`(() => {
  const a = pathOf(withEng, 30), b = pathOf(withEng, 70), c = pathOf([withEng[0]], 30), crew = (r) => (r.mods.find(([, i]) => i === 0) || [0, 0, 0])[2], eng = (r) => r.rows.find(([p]) => p.type === 'engDiesel')[1];
  const sc = 1 - Math.sqrt(0.09 - 0.04);
  return a.r === 'pen' && near(eng(a), 45 * (1 - 0.5 * 0.3 / 1.5), 1e-6) && crew(a) === 0 && crew(b) > 0 && near(crew(c), 45 * (1 - 0.5 * sc / 1.5), 1e-6); })()`),
  R(`[pathOf(withEng, 30), pathOf(withEng, 70), pathOf([withEng[0]], 30)].map((r) => [r.r, r.rows.map(([p, k]) => [p.type, k]), r.mods.map((q) => [q[1], q[2]])])`));
t('structure: a penetration costs the plate 10% of the shell\'s damage, a bounce 2%, a non-penetration 3%', R(`(() => { const v = blk(), k = (r) => r.rows.find(([p]) => p === v.parts[0])[1];
  return near(k(at(v, 'ap75', 0, { pen: 200 })), 26) && near(k(at(v, 'ap75', 0, { pen: 50 })), 7.8) && near(k(at(v, 'ap75', 85, { pen: 200 })), 5.2); })()`));
t('unarmoured parts (an old plane) take the whole damage; a kinetic round goes on through, an HE one bursts there', R(`(() => {
  const ps = TEMPLATES.falcon.parts.map(([type, x, y, rot, o]) => makePart(type, x, y, Object.assign({ flip: x < 0, rot: rot || 0 }, o || {}, { att: null })));
  const v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'plane'; v.rebuildGroups(); v.x = EARTH.radius + 3000; v.q = quat();
  const c = ps.find((p) => p.def.control), d = { x: 0, y: -1, z: 0 }, k = res(v, 'ap20', { x: c.x, y: c.y + 0.1 }, d), h = res(v, 'hei20', { x: c.x, y: c.y + 0.1 }, d);
  return !v.plated && k.r === 'hit' && k.rows.every(([, x]) => x === 40) && k.rows.length >= 1 && (k.go || k.pen <= 0) && h.burst && !h.rows.length; })()`));
// an open-top turret: rounds dropped straight down through its open roof onto the gunner's middle
R(`var OT = [{ type: 'hullMedium', x: 0, y: 1.1, rot: 0 }, { type: 'trackMed', x: 0, y: 0.5, rot: 0, z: -1.35, att: 0 }, { type: 'trackMed', x: 0, y: 0.5, rot: 0, z: 1.35, att: 0 },
  { type: 'engDiesel', x: -1.8, y: 1.1, rot: 0, att: 0 }, { type: 'ringM', x: 0, y: 1.85, rot: 0, att: 0 }, { type: 'turretOpen', x: 0, y: 2.375, rot: 0, att: 4 }];
var dropOn = (sh) => { const v = air(OT), tu = v.parts[5], i = tu.def.mods.findIndex((m) => m.role === 'gunner'), M = tu.def.mods[i];
  const P = { x: tu.x + M.at[0] * tu.def.w, y: tu.y + M.at[1] * tu.def.h, z: partZ(tu) + M.at[2] * partDepth(tu) }, r = res(v, sh, { x: P.x, y: P.y + 2, z: P.z }, { x: 0, y: -1, z: 0 });
  const s = tu.y + tu.def.h / 2 - (P.y + M.r); // (from the open roof to the gunner, straight down)
  const top = Armour.hitAll(v, v.toWorld(P.x, P.y + 2, P.z), v.toWorld(P.x, P.y - 3, P.z)).find((h) => h.p === tu);
  return { r: r.r, k: r.mods.filter(([h, j]) => h === tu && j === i).reduce((a, q) => a + q[2], 0), s, mods: r.mods.length, roof: A.faceMm(tu, top.edge, top.u) }; };`);
t('a machine-gun bullet through an open roof hits what it meets in the next metre (its own damage along the way, no fragments)', R(`(() => { const a = dropOn('ball8'), b = dropOn('ball13');
  return a.roof === 0 && a.r === 'pen' && b.r === 'pen' && near(a.k, 9 * (1 - 0.5 * a.s / 1.0), 1e-9) && near(b.k, 16 * (1 - 0.5 * b.s / 1.0), 1e-9) && a.s > 0 && a.s < 1; })()`), R(`[dropOn('ball8'), dropOn('ball13')]`));
t('no fragments through an open face (there is no plate): a 20 mm AP round down through the open roof hurts the gunner by its path alone; a squash head not at all', R(`(() => { const a = dropOn('ap20'), h = dropOn('hesh105');
  return a.r === 'pen' && near(a.k, 40 * (1 - 0.5 * a.s / 3.0), 1e-9) && h.k === 0 && h.mods === 0; })()`), R(`[dropOn('ap20'), dropOn('hesh105')]`));
// an 85 mm APHE round through the TK-34's side, past its two fuel tanks: it bursts 1.2 m in, both within its reach (1.6 m)
R(`var apheFuel = () => { const v = air(), hull = v.parts[0], D = hull.def, d = { x: 0, y: 0, z: -1 }, r = res(v, 'aphe85', { x: 0.34, y: 1.1, z: 1.1 }, d, { pen: 300 });
  const B = { x: r.at.x + d.x * 1.2, y: r.at.y + d.y * 1.2, z: r.at.z + d.z * 1.2 };
  return D.mods.map((M, i) => { if (M.k !== 'fuel') return null; const w = v.toWorld(hull.x + M.at[0] * D.w, hull.y + M.at[1] * D.h, M.at[2] * partDepth(hull)), dist = Math.hypot(w.x - B.x, w.y - B.y, w.z - B.z) - M.r;
    return [i, +dist.toFixed(3), SHELLS.aphe85.burst * Math.pow(1 - dist / SHELLS.aphe85.r, 1.2), (r.mods.find(([h, j]) => h === hull && j === i) || [0, 0, 0])[2]]; }).filter(Boolean); };`);
t('an APHE burst reaches fuel too: both hull tanks within its reach take burst·(1 - d/r)^1.2 (and may burn)', R(`(() => { const f = apheFuel(); return f.length === 2 && f.every(([, dist, want, got]) => dist < SHELLS.aphe85.r && got >= want - 1e-9 && want > 50); })()`), R('apheFuel()'));

// ---------------------------------------------------------------- modules: crew, knock-out, seats changing hands, ammunition, fires, repairs
R(`var crewOfV = (v) => Armour.crewOf(v).crew.map((e) => e.role + (e.alive ? '' : 'x')).join();
var killMod = (v, F, host, i) => Armour.modDamage(v, host, i, 1000, F, null);`);
t('the crew: a hull\'s and a cast turret\'s built-in crew (driver, radio; gunner, commander, loader) and their stores', R(`(() => { const v = air(), C = Armour.crewOf(v);
  return crewOfV(v) === 'driver,radio,gunner,commander,loader' && C.stores.map((s) => s.host.type + ':' + s.rounds).join() === 'hullMedium:20,turretCast:16' && Armour.has(v, 'gunner') && !Armour.has(v, 'pilot'); })()`));
t('placed seats and racks take over from a host\'s built-in crew and ammunition (fuel and troops stay)', R(`(() => {
  const v = air([...TK, { type: 'seatDriver', x: 1.5, y: 1.0, rot: 0, att: 0 }, { type: 'ammoRack', x: -0.5, y: 0.8, rot: 0, att: 0 }]), C = Armour.crewOf(v);
  return crewOfV(v) === 'gunner,commander,loader,driver' && C.stores.map((s) => s.host.type + (s.part ? '/' + s.part.type : '') + ':' + s.rounds).join() === 'turretCast:16,hullMedium/ammoRack:20'
    && Armour.summary(v.parts).crew === 4 && Armour.summary(v.parts).rounds === 36; })()`));
t('knock-out: with five aboard it takes four dead (fewer than two left); then no part is in control and the craft is lost', R(`(() => {
  const v = air(), F = simOf(v), h = v.parts[0], tu = v.parts[5], seq = [];
  for (const [host, i] of [[tu, 0], [tu, 1], [h, 1], [h, 0]]) { killMod(v, F, host, i); seq.push(!!v.ko); }
  return seq.join() === 'false,false,false,true' && v.ko.why === 'crew' && v.control === null && F.destroyed && v.parts.length === TK.length && F.toasts.includes('Knocked out!')
    && !Armour.has(v, 'driver') && !Armour.has(v, 'gunner'); })()`), R(`(() => { const v = air(), F = simOf(v); killMod(v, F, v.parts[5], 0); return F.toasts; })()`));
t('a one-man crew is knocked out when he dies; old cabs keep their old rule (no crew count)', R(`(() => { const v = air([{ type: 'tstBlock', x: 0, y: 0, rot: 0 }]), F = simOf(v); killMod(v, F, v.parts[0], 0);
  const w = air([{ type: 'cab', x: 0, y: 0, rot: 0 }, { type: 'mgHeavy', x: 0, y: 1.2, rot: 3, att: 0 }]); return !!v.ko && v.control === null && Armour.has(w, 'gunner') && Armour.has(w, 'driver'); })()`));
R(`var sw = air(), swF = simOf(sw); killMod(sw, swF, sw.parts[5], 0); var sw0 = [Armour.has(sw, 'gunner'), Armour.has(sw, 'loader')];
for (let i = 0; i < 39; i++) { swF.time += 0.1; Armour.repairStep(sw, 0.1, swF); } var sw1 = [Armour.has(sw, 'gunner'), Armour.has(sw, 'loader')];
for (let i = 0; i < 3; i++) { swF.time += 0.1; Armour.repairStep(sw, 0.1, swF); } var sw2 = [Armour.has(sw, 'gunner'), Armour.has(sw, 'loader'), crewOfV(sw)];`);
t('a dead gunner\'s seat: after 4 s the loader takes the gun (and no one loads)', R(`sw0.join() === 'false,true' && sw1.join() === 'false,true' && sw2[0] && !sw2[1] && sw2[2] === 'driver,radio,gunnerx,commander,gunner' && swF.toasts.includes('Loader takes the gun')`), R('[sw0, sw1, sw2, swF.toasts]'));
t('...and a dead driver\'s: the loader first, else the radio operator, takes the wheel', R(`(() => { const run = (pre) => { const v = air(), F = simOf(v); if (pre) killMod(v, F, v.parts[5], 2); killMod(v, F, v.parts[0], 0);
  for (let i = 0; i < 45; i++) { F.time += 0.1; Armour.repairStep(v, 0.1, F); } return Armour.has(v, 'driver') && F.toasts[F.toasts.length - 1]; };
  return run(false) === 'Loader takes the wheel' && run(true) === 'Radio operator takes the wheel'; })()`));
// detonation odds: clamp((0.5 + 0.4·rounds/capacity)·cook, 0, 0.95), +0.2 against HEAT, APHE and HE
R(`var odds = (rows, host, i, rounds, hot, n = 400) => { let k = 0; for (let j = 0; j < n; j++) { Armour.seed(9000 + j); const v = air(rows), F = simOf(v), H = v.parts[host], st = Armour.crewOf(v).stores.find((s) => s.host === H && s.i === i);
  st.rounds = rounds; Armour.modDamage(v, H, i, 1000, F, null, hot); if (v.ko && v.ko.x) k++; } return k / n; };
var rackOdds = (rows, n = 400) => { let k = 0; for (let j = 0; j < n; j++) { Armour.seed(5000 + j); const v = air(rows), F = simOf(v), p = v.parts.find((q) => q.def.rack); Combat.damage(v, p, 1e4, 'shot', F); if (v.ko && v.ko.x) k++; } return k / n; };
var oddsGot = [odds(TK, 0, 2, 20, false), odds(TK, 0, 2, 4, false), odds(TK, 0, 2, 20, true), rackOdds([...TK, { type: 'wetRack', x: -0.5, y: 0.8, rot: 0, att: 0 }])];`);
t('ammunition cooks off by its odds: a full rack 0.9, a nearly empty one 0.58, a full one against HE 0.95, a wet rack 0.27', R(`[0.9, 0.58, 0.95, 0.27].every((w, i) => Math.abs(oddsGot[i] - w) < 0.07)`), R('oddsGot'));
t('...an empty store never does', R(`odds(TK, 0, 2, 0, true, 50) === 0`));
R(`var tossV = null, tossF = null;
for (let j = 0; j < 200 && !(tossV && tossV.ko && tossV.ko.x); j++) { tossV = air(); tossF = simOf(tossV); Armour.seed(j); killMod(tossV, tossF, tossV.parts[0], 2); }
var piece = tossF.vessels.find((q) => q !== tossV && q.parts.some((p) => p.type === 'turretCast')), up = norm3(v3(tossV.x, tossV.y, tossV.z));`);
t('a detonation throws the turret: cut from the ring, +9 m/s up and tumbling 1-3 rad/s; the hulk keeps hull, tracks, engine and ring', R(`(() => {
  const w = Math.hypot(piece.av.x, piece.av.y, piece.av.z), vu = piece.vx * up.x + piece.vy * up.y + piece.vz * up.z;
  return tossV.ko.x && tossV.ko.why === 'ammo' && piece.parts.map((p) => p.type).sort().join() === 'gun85,mgCoax,turretCast' && near(vu, 9, 1e-6) && w >= 1 && w <= 3
    && tossV.parts.map((p) => p.type).sort().join() === 'engDiesel,hullMedium,ringM,trackMed,trackMed' && piece.isDebris && tossF.destroyed && tossF.toasts.includes('Ammo detonation!'); })()`),
  R(`[tossV.ko, piece && piece.parts.map((p) => p.type), piece && [piece.vx, piece.vy, piece.vz, piece.av], tossV.parts.map((p) => p.type)]`));
// (a machine-gun cupola on its own ring on the rear deck, built before the main turret: the same deck, the same top)
R(`var CUP = [{ type: 'hullMedium', x: 0, y: 1.1, rot: 0 }, { type: 'trackMed', x: 0, y: 0.5, rot: 0, z: -1.35, att: 0 }, { type: 'trackMed', x: 0, y: 0.5, rot: 0, z: 1.35, att: 0 },
  { type: 'engDiesel', x: -1.8, y: 1.1, rot: 0, att: 0 }, { type: 'ringS', x: -2.0, y: 1.85, rot: 0, att: 0 }, { type: 'mgHeavy', x: -2.0, y: 2.75, rot: 3, att: 4 },
  { type: 'ringM', x: 0.2, y: 1.85, rot: 0, att: 0 }, { type: 'turretCast', x: 0.2, y: 2.425, rot: 0, att: 6 }, { type: 'gun85', x: 2.822, y: 2.425, rot: 3, att: 7 }];
var tossOf = (host) => { for (let j = 0; j < 200; j++) { const v = air(CUP), F = simOf(v), H = v.parts.find((p) => p.type === host), i = H.def.mods.findIndex((m) => m.k === 'ammo');
  Armour.seed(j); Armour.modDamage(v, H, i, 1000, F, null, true); if (v.ko && v.ko.x) return [F.vessels.filter((q) => q.tossed).map((q) => q.parts.map((p) => p.type).sort().join()).join('|'), v.parts.map((p) => p.type).sort().join(), v.tg.length]; }
  return null; };`);
t('a detonation throws the turret whose store went up, not a cupola built before it; with the ammunition in the hull, the heaviest turret', R(`(() => { const a = tossOf('turretCast'), b = tossOf('hullMedium');
  return a && b && a[0] === 'gun85,turretCast' && b[0] === 'gun85,turretCast' && a[1].includes('mgHeavy') && b[1].includes('mgHeavy') && a[1].includes('ringM'); })()`), R(`[tossOf('turretCast'), tossOf('hullMedium')]`));
t('a bustle with blow-out panels vents instead: no knock-out, its rounds gone, the crew alive', R(`(() => { let vented = 0, ko = 0;
  for (let j = 0; j < 40; j++) { Armour.seed(j); const v = air(MA), F = simOf(v), tu = v.parts[5], st = Armour.crewOf(v).stores.find((s) => s.host === tu);
    killMod(v, F, tu, 3); if (v.vent) vented++; if (v.ko) ko++; if (st.rounds !== 0) return false; }
  return vented > 30 && ko === 0; })()`));
R(`var rp = air(), rpF = simOf(rp), trk = rp.parts[1]; Combat.damage(rp, trk, 1e4, 'shot', rpF, null);
var rpLog = [trk.broken, rp.parts.includes(trk)]; rp.vx = 5;
for (let i = 0; i < 200; i++) { rpF.time += 0.1; Armour.repairStep(rp, 0.1, rpF); } rpLog.push(trk.broken, rp.repair && rp.repair.name, rp.repair && rp.repair.on);
rp.vx = 0; for (let i = 0; i < 85; i++) { rpF.time += 0.1; Armour.repairStep(rp, 0.1, rpF); } rpLog.push(trk.broken);
for (let i = 0; i < 10; i++) { rpF.time += 0.1; Armour.repairStep(rp, 0.1, rpF); } rpLog.push(trk.broken, trk.hp / Combat.maxHp(trk.def), rpF.toasts.slice(-1)[0]);`);
t('repairs: a broken track stays (broken, not ripped off), waits while moving, mends in 8 s once stopped, to 60%', R(`(() => { const [b0, inP, b1, name, on, b2, b3, f, toast] = rpLog;
  return b0 && inP && b1 && name === 'Left track' && on === false && b2 && !b3 && near(f, 0.6) && toast === 'Left track repaired'; })()`), R('rpLog'));
t('...not within 6 s of a hit', R(`(() => { const v = air(), F = simOf(v), tr = v.parts[2]; Combat.damage(v, tr, 1e4, 'shot', F, null);
  for (let i = 0; i < 50; i++) { F.time += 0.1; Armour.repairStep(v, 0.1, F); } const early = v.repair && v.repair.on;
  for (let i = 0; i < 20; i++) { F.time += 0.1; Armour.repairStep(v, 0.1, F); }
  return early === false && v.repair.on === true && v.repair.name === 'Right track'; })()`));
R(`var fireV = null, fireF = null;
for (let j = 0; j < 100 && !(fireV && fireV.parts[1].fire > 0); j++) { Armour.seed(j); fireV = air([{ type: 'tstBlock', x: 0, y: 0, rot: 0 }, { type: 'engDiesel', x: 0.4, y: 0, rot: 0, att: 0 }]); fireF = simOf(fireV); Combat.damage(fireV, fireV.parts[1], 1e4, 'shot', fireF); }
var eng = fireV.parts[1]; fireV.vx = 3;
for (let i = 0; i < 20; i++) { fireF.time += 0.1; Armour.repairStep(fireV, 0.1, fireF); }
var fireLog = [eng.broken, +eng.fire.toFixed(3), +(100 - fireV.parts[0].mods[0]).toFixed(3)]; fireV.vx = 0;
for (let i = 0; i < 45; i++) { fireF.time += 0.1; Armour.repairStep(fireV, 0.1, fireF); } fireLog.push(eng.fire, fireF.toasts.includes('Fire!'), fireF.toasts.includes('Fire out'));`);
t('an engine fire: 25 s of it, the crew within 2.5 m losing 3 hp/s; out after 4 s stopped', R(`fireLog[0] && near(fireLog[1], 23, 1e-9) && near(fireLog[2], 6, 1e-6) && fireLog[3] === 0 && fireLog[4] && fireLog[5]`), R('fireLog'));
t('a broken module is idempotent: no more damage, no second toast; a dead crewman can\'t be hurt again', R(`(() => { const v = air([...TK, { type: 'seatLoader', x: 0.4, y: 2.3, rot: 0, att: 5 }]), F = simOf(v), tr = v.parts[1], seat = v.parts.find((p) => p.def.seat);
  Combat.damage(v, tr, 1e4, 'shot', F); const n = F.toasts.length; Combat.damage(v, tr, 1e4, 'shot', F); Armour.moduleDown(v, tr, 'shot', F);
  Combat.damage(v, seat, 1e4, 'shot', F); const hp = seat.hp; Combat.damage(v, seat, 50, 'shot', F);
  return tr.broken && tr.hp === 0 && F.toasts.length === n + 1 && seat.broken && seat.hp === hp && F.toasts.includes('Loader knocked out'); })()`), R(`(() => { const v = air([...TK, { type: 'seatLoader', x: 0.4, y: 2.3, rot: 0, att: 5 }]), F = simOf(v), tr = v.parts[1]; Combat.damage(v, tr, 1e4, 'shot', F); Combat.damage(v, tr, 1e4, 'shot', F); return F.toasts; })()`));
t('a ground vehicle\'s hull at 0 hp: knocked out, the hulk staying (no explosion, nothing ripped off)', R(`(() => { const v = air(), F = simOf(v); Combat.damage(v, v.parts[0], 1e6, 'shot', F);
  return v.ko && v.ko.why === 'hull' && v.parts.length === TK.length && !F.broken.length && F.destroyed; })()`));
t('spawn protection: for 4 s after a battle spawn, no damage (parts or modules)', R(`(() => { const v = air(), F = simOf(v); v.spawnAt = F.time - 1;
  Combat.damage(v, v.parts[0], 500, 'shot', F); Armour.modDamage(v, v.parts[0], 0, 500, F); const safe = v.parts[0].hp == null && !v.parts[0].mods;
  F.time += 3.5; Combat.damage(v, v.parts[0], 500, 'shot', F); Armour.modDamage(v, v.parts[0], 0, 50, F); return safe && v.parts[0].hp === 600 && v.parts[0].mods[0] === 50; })()`));

// ---------------------------------------------------------------- HE against plates (explode: blastK)
R(`var openT = (type) => air([{ type: 'hullMedium', x: 0, y: 1.1, rot: 0 }, { type: 'ringM', x: 0, y: 1.85, rot: 0, att: 0 }, { type, x: 0, y: 1.95 + PARTS[type].h / 2, rot: 0, att: 1 }]);
var heAbove = (type) => { const v = openT(type), F = simOf(v), tu = v.parts[2]; Combat.explode(EARTH, v.toWorld(0, 1.95 + tu.def.h + 0.6, 0), SHELLS.he75.blast, SHELLS.he75.dmg, null, F, true, SHELLS.he75.he);
  return [tu.mods ? tu.mods.map(Math.round) : null, tu.hp == null ? null : Math.round(tu.hp)]; };`);
t('HE above an open-top turret gets at its crew; above a box turret\'s 40 mm roof it only scratches the shell', R(`(() => { const o = heAbove('turretOpen'), b = heAbove('turretBox');
  return o[0] && o[0].every((x) => x < 100) && !b[0] && b[1] > 1100 - 0.2 * 225; })()`), R(`[heAbove('turretOpen'), heAbove('turretBox')]`));
t('blastK: tracks and guns all of it from 20 mm of blast up (else 0.3); inside parts only through an overmatched host; old parts all of it', R(`(() => { const v = air(), at = v.toWorld(0, 0.5, 3), tr = v.parts[2], eng = v.parts[3], m = [];
  const tk = Armour.blastK(v, tr, 0.5, 3, 100, 14 / Math.pow(1 - 0.5 / 3, 1.5) * 1.5, m, at), tk2 = Armour.blastK(v, tr, 0.5, 3, 100, 10, m, at), ek = Armour.blastK(v, eng, 1, 3, 100, 14, m, at), ek2 = Armour.blastK(v, eng, 1, 3, 100, 900, m, at);
  const w = air([...TK, { type: 'cab', x: -4, y: 1.2, rot: 0, att: 0 }]), cab = w.parts[w.parts.length - 1];
  return tk === 100 && near(tk2, 30) && ek === null && ek2 === 50 && Armour.blastK(w, cab, 1, 3, 100, 1, m, at) === 100; })()`));
t('a blast\'s distance to a turret part is from where it is turned to', R(`(() => { const v = air(), F = simOf(v), at = v.toWorld(0, 2.4, 4.2);
  Combat.explode(EARTH, at, 2.5, 100, null, F, true); const gun = v.parts[6], a = gun.hp;
  const w = air(), G = simOf(w); w.parts[4].aimYaw = Math.PI / 2; Combat.explode(EARTH, w.toWorld(0, 2.4, 4.2), 2.5, 100, null, G, true); return a == null && w.parts[6].hp != null; })()`));
// one 120 mm HE shell on the front of an MA-1 wearing 16 reactive bricks (8 on the hull front, 8 on the turret's):
// what it strips (bricks, skirts) goes in one ripParts call, so one split, one toast and one bang (warm, the median of 9)
ctx.process = process;
R(`var bricked = () => { const kit = []; for (let i = 0; i < 8; i++) kit.push({ type: 'era', x: 3.0, y: 1.0 + i * 0.1, rot: 1, z: -1.2 + i * 0.34, att: 0 }, { type: 'era', x: 1.6, y: 2.5, rot: 1, z: -1.4 + i * 0.4, att: 5 });
  return air(__tanks.ma1.concat(kit)); };
var heBricks = () => { const out = [];
  for (let k = 0; k < 11; k++) { const v = bricked(), F = simOf(v); F.vessels = [v]; F.active = null; const n0 = v.parts.filter((p) => p.def.cat === 'kit').length, at = v.toWorld(3.3, 1.4, 0), S = SHELLS.he120;
    const s = { k: 'shell', sh: 'he120', b: EARTH, x: at.x + 30, y: at.y, z: at.z, vx: -S.v0, vy: 0, vz: 0, t: 1, life: 6, owner: null, enemy: true, net: 0, cal: 120, pen: 0, v0: S.v0, prox: 0, ric: false, gTop: Infinity, n: 77 + k };
    const t0 = process.hrtime.bigint(); fly(s, F, 10); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (k >= 2) out.push({ ms, torn: n0 - v.parts.filter((p) => p.def.cat === 'kit').length, calls: F.broken.length }); }
  out.sort((a, b) => a.ms - b.ms); return out; };`);
ctx.__tanks = require('./lib/tanks.js');
const heB = R('heBricks()');
console.log(`     timing: one HE shell stripping an MA-1 of its bricks and skirts, ${heB[4].ms.toFixed(2)} ms (median of 9; ${heB.map((q) => q.ms.toFixed(2)).join(', ')})`);
t('one HE shell on an MA-1 wearing 16 reactive bricks: all it strips (bricks and skirts) goes in one ripParts call, within 5 ms', heB.every((q) => q.calls === 1 && q.torn >= 16) && heB[4].ms <= 5, heB);

// ---------------------------------------------------------------- old weapons against armour (§6.5): the legacy table
R(`var Tt = Combat._t;
var oldShot = (v, k, dmg, extra) => { const w = v.toWorld(1, 0, 0); return Object.assign({ k, b: EARTH, x: w.x + 30, y: w.y, z: w.z, vx: -900, vy: 0, vz: 0, dx: -1, dy: 0, dz: 0, t: 1, life: 9, dmg, blast: 0, owner: null, enemy: true, net: 0,
  burn: 0, accel: 0, seek: k === 'missile' ? 'ground' : undefined, target: null }, extra || {}); };
// what an old round does to the 100 mm block dialled to mm: the block's hp lost, and whether the crewman inside was hurt
var oldHit = (k, dmg, mm, extra) => { const v = blk(mm), F = simOf(v); F.vessels = [v]; const s = oldShot(v, k, dmg, extra); for (let i = 0; i < 20 && Tt.moveShot(s, 1 / 120, F); i++);
  return [+(5000 - (v.parts[0].hp ?? 5000)).toFixed(4), !!(v.parts[0].mods && v.parts[0].mods[0] < 100)]; };`);
t('old bullets by their damage: rifle calibre (≤9) 10 mm, 20 mm cannon (10-19) 30, 30 mm (≥20) 55; through, 10% of it to the plate, else 5%', R(`(() => {
  const r = [oldHit('bullet', 8, 9), oldHit('bullet', 8, 11), oldHit('bullet', 15, 29), oldHit('bullet', 15, 31), oldHit('bullet', 25, 54), oldHit('bullet', 25, 56)];
  return near(r[0][0], 0.8) && near(r[1][0], 0.4) && near(r[2][0], 1.5) && near(r[3][0], 0.75) && near(r[4][0], 2.5) && near(r[5][0], 1.25) && r[0][1] && r[2][1] && r[4][1]; })()`),
  R(`[oldHit('bullet', 8, 9), oldHit('bullet', 8, 11), oldHit('bullet', 15, 29), oldHit('bullet', 15, 31), oldHit('bullet', 25, 54), oldHit('bullet', 25, 56)]`));
// (short of a plate by under a fifth, a round has a 30% chance of two fragments inside (§6.3), by the shot's seed: so
// these say through or not by what the plate takes, 10% or 5% of the damage, not by whether anyone inside was hurt)
t('old rockets: a 120 mm shaped charge, then their blast', R(`(() => { const a = oldHit('rocket', 300, 115, { blast: 3 }), b = oldHit('rocket', 300, 125, { blast: 3 });
  return a[1] && near(a[0], 30 + 45, 1e-6) && near(b[0], 15 + 45, 1e-6); })()`), R(`[oldHit('rocket', 300, 115, { blast: 3 }), oldHit('rocket', 300, 125, { blast: 3 })]`));
t('old anti-ground missiles: 700 mm (a cruise missile, 2,000 damage and up: 900)', R(`(() => { const a = oldHit('missile', 600, 690), b = oldHit('missile', 600, 710), c = oldHit('missile', 2000, 890), d = oldHit('missile', 2000, 910);
  return a[1] && near(a[0], 60, 1e-6) && near(b[0], 30, 1e-6) && c[1] && near(c[0], 200, 1e-6) && near(d[0], 100, 1e-6); })()`), R(`[oldHit('missile', 600, 690), oldHit('missile', 600, 710), oldHit('missile', 2000, 890), oldHit('missile', 2000, 910)]`));
t('bombs and air-to-air missiles: the blast alone (3 mm a metre of it: a 10 m bomb overmatches 25 mm, not 100; a 6 m missile 15 mm, not 25)', R(`(() => { const a = oldHit('bomb', 500, 100, { blast: 10 }), b = oldHit('bomb', 500, 25, { blast: 10 }), c = oldHit('missile', 300, 15, { blast: 6, seek: 'air' }), d = oldHit('missile', 300, 25, { blast: 6, seek: 'air' });
  return !a[1] && near(a[0], 75) && b[1] && near(b[0], 500) && c[1] && !d[1] && near(d[0], 45); })()`), R(`[oldHit('bomb', 500, 100, { blast: 10 }), oldHit('bomb', 500, 25, { blast: 10 }), oldHit('missile', 300, 15, { blast: 6, seek: 'air' }), oldHit('missile', 300, 25, { blast: 6, seek: 'air' })]`));
t('the ground update\'s HE rockets (s.he) on a direct hit: their blast decides, no shaped charge (a 100 mm block takes 15%, the man inside nothing)', R(`(() => { const r = oldHit('rocket', 600, 100, { blast: 10, he: 25 }); return near(r[0], 90, 1e-6) && !r[1]; })()`), R(`oldHit('rocket', 600, 100, { blast: 10, he: 25 })`));
t('...and rocket rails fire them so (their he, else 3 mm a metre of blast)', R(`(() => { PARTS.tstRails = { ...PARTS.mlrsLight, type: 'tstRails', weapon: { ...PARTS.mlrsLight.weapon, he: undefined } };
  const fire = (type) => { const L = air([{ type: 'hullWheeled', x: 0, y: 1.2, rot: 0 }, { type, x: 0.3, y: 3.0, rot: 3, att: 0 }]), F = simOf(L); F.active = null; return Combat.fireRocket(L, L.parts[1], false, F); };
  const a = fire('mlrsLight'), b = fire('tstRails'); delete PARTS.tstRails; return a.he === 25 && b.he === 3 * PARTS.mlrsLight.weapon.blast; })()`));
// a tandem missile (the Twin ATGM Launcher's: 650 mm, tandem) flown into a TK-34's turret face 20 m off, the face bare
// or with a reactive brick or a smoke launcher on it: parts without armour of their own, so not 'armour' to the old hook
R(`var atgm = (kit) => { const v = air([...TK, ...(kit ? [{ type: kit, x: 1.33, y: 2.5, rot: kit === 'era' ? 1 : 0, z: 0.75, att: 5 }] : [])]), F = simOf(v); F.vessels = [v]; F.active = null;
  const k = kit ? v.parts[v.parts.length - 1] : null, w = v.toWorld(k ? k.x : 1.0, k ? k.y : 2.5, 0.75);
  const s = { k: 'missile', b: EARTH, x: w.x + 20, y: w.y, z: w.z, vx: -250, vy: 0, vz: 0, dx: -1, dy: 0, dz: 0, t: 0.2, gt: 99, coast: 0, life: 24, burn: 0, accel: 0,
    seek: 'saclos', saclos: true, pen: 650, tandem: true, dmg: 700, blast: 3, owner: null, target: null };
  let n = 0; while (n < 30 && Tt.moveShot(s, 1 / 120, F)) n++;
  return [Armour.crewOf(v).crew.filter((e) => e.host === v.parts[5] && !e.alive).map((e) => e.role).join(), k ? !v.parts.includes(k) : null, n]; };`);
t('a tandem missile on a turret face behind a reactive brick or a smoke launcher: the resolver still has it, and the jet kills the turret crew as on bare armour', R(`(() => {
  const a = atgm(null), b = atgm('era'), c = atgm('smokeL'); return a[0] === 'gunner,commander' && b[0] === a[0] && c[0] === a[0] && b[1] === true && a[2] < 30; })()`), R(`[atgm(null), atgm('era'), atgm('smokeL')]`));

// ---------------------------------------------------------------- shells in flight: the world around them
t('a shell flies past its own vessel for 1.5 s (fired from inside the hull), then hits it like any other', R(`(() => { const v = air(), F = simOf(v); F.vessels = [v];
  const s = shellAt(v, 'ap75', { x: 0, y: 1.1 }, { x: 0, y: 0, z: -1 }, 0.5, { owner: v, t: 0 }), n = fly(s, F, 5);
  const s2 = shellAt(v, 'ap75', { x: 0.5, y: 1.2, z: 1.2 }, { x: 0, y: 0, z: -1 }, 30, { owner: v, t: 1.6 }), n2 = fly(s2, F); return n === -1 && n2 > 0 && v.parts[0].hp != null; })()`));
t('a wreck stops a shell with sparks and takes nothing; a copy of someone else\'s shell hurts nothing either', R(`(() => { const v = air(), F = simOf(v); F.vessels = [v]; v.wreck = true;
  const n = fly(shellAt(v, 'apfsds120', { x: 2.4, y: 1.4 }, { x: -1, y: 0, z: 0 }, 200), F); v.wreck = false;
  const m = fly(shellAt(v, 'apfsds120', { x: 2.4, y: 1.4 }, { x: -1, y: 0, z: 0 }, 200, { net: 9 }), F);
  return n > 0 && m > 0 && v.parts.every((p) => p.hp == null && !p.mods); })()`));
t('...nor from old weapons: an old 30 mm cannon round (and its blast) sparks off it, an old bomb leaves it be, legacyHit does nothing', R(`(() => { const v = air(), F = simOf(v); F.vessels = [v]; F.active = null; v.wreck = true;
  const w = v.toWorld(0, 1.2, 1.1 + 20), s = { k: 'bullet', b: EARTH, x: w.x, y: w.y, z: w.z, vx: 0, vy: 0, vz: -1000, dx: 0, dy: 0, dz: -1, t: 0.3, life: 3, dmg: 34, blast: 3, owner: null };
  let n = 0; while (n < 20 && Tt.moveShot(s, 1 / 120, F)) n++;
  Combat.explode(EARTH, v.toWorld(0, 4, 0), 12, 600, null, F, false); Armour.legacyHit({ ...s, k: 'missile', seek: 'ground', pen: 700, dmg: 600 }, v, v.parts[0], v.toWorld(0, 1.2, 1.1), F);
  return n < 20 && v.parts.every((p) => p.hp == null && !p.mods) && !F.broken.length; })()`));
// (level, through the cast turret's right side where the gunner and the commander sit, under the coaxial MG and
// beside the gun: the muzzle 0.3 m inside the turret's wall, or 10 m out on the same line)
R(`var pbLine = (v) => { const tu = v.parts[5], z = partZ(tu) + 0.25 * partDepth(tu); return { tu, x0: tu.x + Math.sqrt((tu.def.w / 2) ** 2 - z * z), y: tu.y - 0.12, z }; };
var pointBlank = (back) => { const v = air(), F = simOf(v), L = pbLine(v), w = v.toWorld(L.x0 + back, L.y, L.z), S = SHELLS.apfsds120; F.vessels = [v]; F.active = null;
  fly({ k: 'shell', sh: 'apfsds120', b: EARTH, x: w.x, y: w.y, z: w.z, vx: -S.v0, vy: 0, vz: 0, t: 0, life: 6, owner: null, enemy: true, net: 0, cal: 120, pen: S.pen, v0: S.v0, prox: 0, ric: false, gTop: Infinity, n: 4321 }, F, 30);
  return [L.tu.hp ?? null, L.tu.mods ? L.tu.mods[0] : null, L.tu.mods ? L.tu.mods[1] : null]; }; // (the plate's share, the gunner, the commander: the fragments' dice differ by vessel)`);
t('point blank: a shell from a muzzle pushed 0.3 m into a turret hits that turret by its face, as the same shot from 10 m off does (gunner and commander)', R(`(() => {
  const out = pointBlank(10), inside = pointBlank(-0.3), v = air(), L = pbLine(v), first = Armour.hitAll(v, v.toWorld(L.x0 + 10, L.y, L.z), v.toWorld(L.x0 - 10, L.y, L.z))[0];
  return first.p.type === 'turretCast' && inside.join() === out.join() && out[0] === 900 - 32 && out[1] === 0 && out[2] === 0; })()`), R(`[pointBlank(10), pointBlank(-0.3)]`));
t('through an old plane a dart flies on (each part the whole damage), and doesn\'t come back for it', R(`(() => {
  const ps = TEMPLATES.falcon.parts.map(([type, x, y, rot, o]) => makePart(type, x, y, Object.assign({ flip: x < 0, rot: rot || 0 }, o || {}, { att: null })));
  const v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'plane'; v.rebuildGroups(); v.x = EARTH.radius + 3000; v.q = quat(); const F = simOf(v); F.vessels = [v];
  const c = ps.find((p) => p.def.control), s = shellAt(v, 'apfsds120', { x: c.x, y: c.y }, { x: 0, y: -1, z: 0 }, 100), n = fly(s, F, 60), hit = v.parts.filter((p) => p.hp != null);
  return n === -1 && s.skip === v && hit.length + F.broken.length >= 2; })()`));
R(`var plane = () => { const ps = RAIDER.map(([type, x, y, rot]) => makePart(type, x, y, { flip: x < 0, rot: rot || 0 })), v = new Vessel(ps, buildAdjacency(ps), EARTH);
  v.kind = 'plane'; v.rebuildGroups(); v.x = EARTH.radius + 3000; v.y = 0; v.z = 0; v.q = quat(); v.ai = { t: 0, down: false }; v.landed = false; return v; };
var vt = (miss) => { const p = plane(), F = simOf(p); F.vessels = [p]; F.active = null; const c = p.toWorld(p.com.x, p.com.y, p.com.z || 0), S = SHELLS.hevt35;
  const s = { k: 'shell', sh: 'hevt35', b: EARTH, x: c.x + miss, y: c.y - 600, z: c.z + 20, vx: 0, vy: S.v0, vz: 0, t: 0, life: 6, owner: null, enemy: false, net: 0, cal: 35, pen: 0, v0: S.v0, prox: S.prox, gTop: 0, n: ++serial };
  s.vz = -20 / 600 * S.v0; let n = fly(s, F, 400); return [n, p.parts.some((q) => q.hp != null)]; };`);
t('the proximity fuze: an HE-VT round passing 3 m from an aircraft bursts; at 8 m it flies on', R(`(() => { const a = vt(3), b = vt(8); return a[0] > 0 && a[1] && !b[1]; })()`), R('[vt(3), vt(8)]'));
t('...and at the end of its time it bursts by itself', R(`(() => { const F = simOf(); F.vessels = []; let boom = 0; const ex = Combat.explode; Combat.explode = (...a) => { boom++; };
  const s = { k: 'shell', sh: 'hevt35', b: EARTH, x: EARTH.radius + 3000, y: 0, z: 0, vx: 0, vy: 1175, vz: 0, t: 0, life: 6, owner: null, net: 0, cal: 35, pen: 0, v0: 1175, prox: 4, gTop: 0 };
  const n = fly(s, F, 900); Combat.explode = ex; return boom === 1 && n > 700 && n < 730; })()`));
R(`var callsIn = (fn) => { let n = 0; const sa = Terrain.surfaceAt; Terrain.surfaceAt = function (...a) { n++; return sa.apply(this, a); }; try { fn(); } finally { Terrain.surfaceAt = sa; } return n; };`);
t('high over gTop (the arena\'s highest ground) a shell never looks at the ground; under it, every other step', R(`(() => { const F = simOf(); F.vessels = [];
  const mk = (gTop) => ({ k: 'shell', sh: 'ap75', b: EARTH, x: EARTH.radius + 800, y: 0, z: 0, vx: 0, vy: 620, vz: 0, t: 0, life: 6, owner: null, net: 0, cal: 75, pen: 100, v0: 620, gTop });
  const a = callsIn(() => fly(mk(300), F, 120)), b = callsIn(() => fly(mk(Infinity), F, 120)); return a === 0 && b >= 60 && b <= 70; })()`), R(`(() => { const F = simOf(); F.vessels = []; const mk = (gTop) => ({ k: 'shell', sh: 'ap75', b: EARTH, x: EARTH.radius + 800, y: 0, z: 0, vx: 0, vy: 620, vz: 0, t: 0, life: 6, owner: null, net: 0, cal: 75, pen: 100, v0: 620, gTop }); return [callsIn(() => fly(mk(300), F, 120)), callsIn(() => fly(mk(Infinity), F, 120))]; })()`));
// level shots at a berm on Highland Ridge (2.4 m high, σ 3.5 m): from 300 m, every one hits it, even the fast ones
R(`var bermShots = (sh, dh) => { const B = EARTH.arenas.highland.berms[2], F = simOf(); F.vessels = []; const out = []; // (from the south: the ground there lies 2.5 m under its crest)
  for (const de of [-4, 0, 4]) {
    const e = B.e + de, base = Terrain.surfaceAt(EARTH, siteAngle(EARTH, e), B.z) - Terrain.bermAt(e, B.z), crest = base + Terrain.bermAt(e, B.z), h = crest + dh;
    const P = Tt.at(e, B.z - 300, h), Q = Tt.at(e, B.z - 299, h), l = Math.hypot(Q.x - P.x, Q.y - P.y, Q.z - P.z), S = SHELLS[sh];
    const s = { k: 'shell', sh, b: EARTH, x: P.x, y: P.y, z: P.z, vx: (Q.x - P.x) / l * S.v0, vy: (Q.y - P.y) / l * S.v0, vz: (Q.z - P.z) / l * S.v0, t: 0, life: 6, owner: null, net: 0, cal: S.cal, pen: S.pen, v0: S.v0, gTop: Infinity, n: ++serial };
    let hitAt = null; const pf = FX.puff; FX.puff = (b, at) => { hitAt = at; }; fly(s, F, 120); FX.puff = pf;
    const L = hitAt ? Terrain.locate(EARTH, hitAt.x, hitAt.y, hitAt.z, {}) : null; out.push(L ? +(L.z - B.z).toFixed(1) : null);
  }
  return out; };`);
t('a berm stops level shots at its crest (0.5 and 1 m under the top) from 300 m: a 1,650 m/s dart and an 800 m/s shell (on it, or its foot)', R(`(() => { const all = [bermShots('apfsds120', -0.5), bermShots('apfsds120', -1), bermShots('aphe85', -0.5)];
  return all.every((r) => r.every((z) => z !== null && Math.abs(z) < 14)); })()`), R(`[bermShots('apfsds120', -0.5), bermShots('apfsds120', -1), bermShots('aphe85', -0.5)]`));
t('...and shots that only clip its top (0.1 and 0.2 m under the crest: a hull-down turret\'s base) stop there too, not hundreds of metres behind',
  R(`(() => { const all = [bermShots('apfsds120', -0.1), bermShots('apfsds120', -0.2), bermShots('aphe85', -0.1), bermShots('aphe85', -0.2), bermShots('ap75', -0.1)];
  return all.every((r) => r.every((z) => z !== null && Math.abs(z) < 14)); })()`), R(`[bermShots('apfsds120', -0.1), bermShots('apfsds120', -0.2), bermShots('aphe85', -0.1), bermShots('aphe85', -0.2), bermShots('ap75', -0.1)]`));
t('...and shots 3 m over the crest fly on past it', R(`bermShots('apfsds120', 3).every((z) => z === null || z > 20)`), R(`bermShots('apfsds120', 3)`));
t('the coarse ground (16 m, its own cache) for cheap rounds: never more than 3 m under the real ground on Highland Ridge', R(`(() => { const B = EARTH.arenas.highland.box; let worst = -Infinity;
  for (let i = 0; i < 400; i++) { const e = B.e0 + ((i * 7919) % 1000) / 1000 * (B.e1 - B.e0), z = B.z0 + ((i * 104729) % 997) / 997 * (B.z1 - B.z0), a = siteAngle(EARTH, e);
    worst = Math.max(worst, Terrain.surfaceAt(EARTH, a, z) - Armour.coarseH(a, z)); }
  return worst < 3; })()`));

// ---------------------------------------------------------------- someone else's shells (shot k 'shell')
t('a peer\'s shell: an unknown round, junk numbers or an absurd speed are dropped; a good one flies as a copy', R(`(() => { const g = air(); g.remote = 9; const n0 = Combat.S.shots.length;
  Combat.netShot(g, { k: 'shell', sh: 'nope', b: 'earth', P: [g.x, 0, 0], V: [0, 900, 0] }); Combat.netShot(g, { k: 'shell', sh: '__proto__', b: 'earth', P: [g.x, 0, 0], V: [0, 900, 0] });
  Combat.netShot(g, { k: 'shell', sh: 'ap75', b: 'earth', P: [NaN, 0, 0], V: [0, 900, 0] }); Combat.netShot(g, { k: 'shell', sh: 'ap75', b: 'earth', P: [g.x, 0, 0], V: [0, 1e6, 0] });
  Combat.netShot(g, { k: 'shell', sh: 'ap75', b: 'earth', P: [g.x, 0, 0], V: [0, 600, 0, 4] }); const n1 = Combat.S.shots.length;
  Combat.netShot(g, { k: 'shell', sh: 'gun85' === 'x' ? '' : 'aphe85', b: 'earth', P: [g.x, 0, 0], V: [0, 800, 0] }); const s = Combat.S.shots[Combat.S.shots.length - 1];
  return n1 === n0 && Combat.S.shots.length === n0 + 1 && s.k === 'shell' && s.net === 9 && s.owner === g && g.parts[6].shotAt != null; })()`));
t('...it stops on our vessel with sparks: its owner says what it did', R(`(() => { const v = air(), F = simOf(v); F.vessels = [v]; const g = air(); g.remote = 9; g.x += 400; Combat.S.shots = [];
  const w = v.toWorld(2.4, 1.4, 0); Combat.netShot(g, { k: 'shell', sh: 'apfsds120', b: 'earth', P: [w.x + 300, w.y, w.z], V: [-1650, 0, 0] }); const s = Combat.S.shots[0];
  const n = fly(s, F); return n > 0 && v.parts.every((p) => p.hp == null && !p.mods); })()`));

// ---------------------------------------------------------------- the shooter's hit feedback (§6.8): what the shot did, its burst included
R(`var me = air([{ type: 'hullLight', x: 0, y: 1.0, rot: 0 }]); me.x += 500;
var heFb = (rows, P, d) => { const v = air(rows), F = simOf(me, v); Armour.fb.shot = null; fly(shellAt(v, 'he85', P, d, 30, { owner: me, enemy: false }), F, 20);
  return { fb: Armour.fb.shot, dead: Armour.crewOf(v).crew.filter((e) => !e.alive).length, broken: v.parts.filter((p) => p.broken).map((p) => p.type) }; };
var fbOT = heFb(OT, { x: 0, y: 2.8, z: 0 }, { x: 0, y: -1, z: 0 }), fbTK = heFb(TK, { x: 1.2, y: 2.6, z: 0 }, { x: -Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 });`);
t('an HE round into an open-top turret: "a way in, 2 crew" (the burst killed them both)', R(`fbOT.dead === 2 && fbOT.fb.r === 'pen' && fbOT.fb.crew === 2 && fbOT.fb.what.includes('CREW')`), R('fbOT'));
t('...on a TK-34\'s turret front: "a hit, gun" (the burst broke the coaxial MG; no one hurt)', R(`fbTK.broken.includes('mgCoax') && fbTK.dead === 0 && fbTK.fb.r === 'hit' && fbTK.fb.what.includes('GUN') && fbTK.fb.crew === 0`), R('fbTK'));

// ---------------------------------------------------------------- the builder's numbers, and smoke from modules
// (3I's balance: the medium hull's lower plate is 61 mm, 101 against a level shot, under a 55 mm glacis worth 121)
t('summary: the TK-34\'s front is its weakest forward plate (the 53° lower one, 101 mm), side 40, cast turret front 99, crew 5, 36 rounds', R(`JSON.stringify(Armour.summary(air().parts)) === JSON.stringify({ front: 101, side: 40, turretFront: 99, crew: 5, rounds: 36 })`), R('Armour.summary(air().parts)'));
t('summary: the MA-1\'s composite (upper glacis 335 against a level shot), wedge face; nothing for an old craft', R(`(() => { const s = Armour.summary(air(MA).parts); return Math.abs(s.front - 335) <= 1 && s.turretFront > 500 && s.crew === 4 && Armour.summary(partsFromDesign(templateRows(TEMPLATES.falcon))) === null; })()`), R('Armour.summary(air(MA).parts)'));
t('smoke and fire: only what burns does (a burning engine), a broken module a thin wisp, a knocked-out hulk from its first module', R(`(() => { const v = air(), out = [], fa = FX.add; FX.add = (o) => out.push(o.kind + ':' + o.color);
  const eng = v.parts[3], tr = v.parts[1]; Armour.partFX(v, eng, 1); const a = out.length; eng.fire = 5; Armour.partFX(v, eng, 1); const b = out.length; tr.broken = true; Armour.partFX(v, tr, 3); const c = out.length; Armour.partFX(v, tr, 4); const d = out.length;
  v.ko = { why: 'crew', x: false, t: 0 }; tr.broken = false; Armour.partFX(v, tr, 2); const e = out.length; FX.add = fa;
  return a === 0 && b === 2 && c === 3 && d === 3 && e === 4; })()`));

// ---------------------------------------------------------------- old craft: explode as before
R(`// explode's loop as it was before the ground update (for a vessel with no armour: v.plated false)
var oldExplode = (v, at, blast, dmg, sim) => { for (const p of v.parts.slice()) { if (!v.parts.includes(p)) continue; let d = Infinity;
  for (const z of partZs(p)) { const w = v.toWorld(p.x, p.y, z); d = Math.min(d, Math.hypot(w.x - at.x, w.y - at.y, w.z - at.z)); }
  d -= Math.max(p.def.w, p.def.h) / 2; if (d >= blast) continue; Combat.damage(v, p, dmg * Math.pow(1 - Math.max(0, d) / blast, 1.5), 'blast', sim, null); } };
var oldCraft = (key) => { const ps = TEMPLATES[key].parts.map(([type, x, y, rot, o]) => makePart(type, x, y, Object.assign({ flip: x < 0, rot: rot || 0 }, o || {}, { att: null })));
  TEMPLATES[key].parts.forEach((r, i) => { const a = r[4] && r[4].att; if (Number.isInteger(a) && a !== i && ps[a]) ps[i].att = ps[a].id; });
  const v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = TEMPLATES[key].kind || 'plane'; v.rebuildGroups(); v.x = EARTH.radius + 3000; v.q = qaxis(0.3, 1, 0.2, 0.7); return v; };`);
t('explode with no new arguments on old craft: hp for hp what the old loop gives (every plane and car template, six blasts each)', R(`(() => { let n = 0;
  for (const key of Object.keys(TEMPLATES).filter((k) => ['plane', 'car', 'heli'].includes(TEMPLATES[k].kind))) {
    const a = oldCraft(key), b = oldCraft(key), Fa = simOf(a), Fb = simOf(b);
    for (const [x, y, z] of [[0, 6, 3], [1.5, 5, -4], [0, 2, 0], [-1, 10, 6], [2, 8, -2.5], [1, 12, 2.8]]) { Combat.explode(EARTH, a.toWorld(x, y, z), 6, 100, null, Fa, true); oldExplode(b, b.toWorld(x, y, z), 6, 100, Fb); }
    if (a.plated || JSON.stringify(a.parts.map((p) => p.hp)) !== JSON.stringify(b.parts.map((p) => p.hp)) || a.parts.length !== b.parts.length) return key;
    n++;
  }
  return n > 20; })()`));
const cb = spawnSync(process.execPath, [path.join(__dirname, 'combat.test.js')], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
t('combat.json: the combat fingerprint of every stock plane is byte-identical (combat.test.js)', cb.status === 0 && /combat: identical to the baseline/.test(cb.stdout), (cb.stdout.match(/^.*baseline.*$/m) || [''])[0]);

// ---------------------------------------------------------------- multiplayer: hits on ghosts out, and on us in (§6.7)
const N = G.load({ mp: true, combat: true, ground: true, earth: false });
const M = (c) => G.run(N, c);
M(`var TK = ${JSON.stringify(R('TK'))}, OT = ${JSON.stringify(R('OT'))};
var mk = (rows) => { const ps = partsFromDesign(rows.map((q) => ({ flip: false, ...q }))), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'tank'; v.rebuildGroups(); v.x = EARTH.radius + 2500; v.q = quat(); return v; };
MP.active = true; MP.state = { mode: 'sandbox', phase: 'fly', players: [{ pid: 1, name: 'Me', team: 0 }, { pid: 9, name: 'Them', team: 1 }], settings: {} };
Object.assign(Flight, { running: true, mp: { mode: 'sandbox' }, time: 50, destroyed: false, toast() {}, onDestroyed() { this.destroyed = true; } });
var me = mk(TK), ghost = mk(TK); ghost.remote = 9; ghost.x += 300; Flight.active = me; Flight.vessels = [me, ghost]; MP.peers.set(9, { ghost, gun: {}, design: null });
var sent = () => Net.out.splice(0).map(([m]) => m);`);
t('an old hit message is unchanged: { t, to, list, k } and nothing more', M(`(() => { Net.out = []; MP.sendHits(ghost, [[ghost.parts[0], 12.34], [ghost.parts[1], 0.01]], 'shot'); MP.sendHit(ghost, ghost.parts[2], 5, 'blast');
  const [a, b] = sent(); return JSON.stringify(a) === JSON.stringify({ t: 'hit', to: 9, list: [[ghost.parts[0].id, 12.3]], k: 'shot' }) && JSON.stringify(b) === JSON.stringify({ t: 'hit', to: 9, list: [[ghost.parts[2].id, 5]], k: 'blast' }); })()`));
t('a shell on a ghost: one message with its kind, module rows, where it came from and whether it was hot; module rows alone still go', M(`(() => { Net.out = [];
  MP.sendHits(ghost, [[ghost.parts[0], 26]], 'pen', [[ghost.parts[0], 2, 300.04], [ghost.parts[5], 0, 120]], [0.6, 0.8, 0], true); MP.sendHits(ghost, [], 'pen', [[ghost.parts[5], 1, 50]]);
  const [a, b] = sent(); return a.k === 'pen' && JSON.stringify(a.m) === JSON.stringify([[ghost.parts[0].id, 2, 300], [ghost.parts[5].id, 0, 120]]) && a.d.join() === '0.6,0.8,0' && a.h === 1 && b && b.list.length === 0 && b.m.length === 1; })()`));
t('...at most 32 module rows; and a wreck takes no hits at all (old rounds\' sendHit too)', M(`(() => { Net.out = []; MP.sendHits(ghost, [], 'pen', Array.from({ length: 40 }, () => [ghost.parts[0], 0, 1]));
  const n = sent()[0].m.length; ghost.wreck = true; MP.sendHits(ghost, [[ghost.parts[0], 50]], 'pen', [[ghost.parts[0], 0, 9]]); MP.sendHit(ghost, ghost.parts[0], 50, 'shot'); ghost.wreck = false; return n === 32 && sent().length === 0; })()`));
M(`var hullId = me.parts[0].id, tuId = me.parts[5].id, trId = me.parts[1].id;
var fresh = () => { me = mk(TK); Flight.active = me; Flight.vessels = [me, ghost]; Flight.destroyed = false; hullId = me.parts[0].id; tuId = me.parts[5].id; trId = me.parts[1].id; Armour.fb.hurt.length = 0; };
var hitUs = (m) => MP.onHit(Object.assign({ t: 'hit', f: 9, to: 1, list: [], k: 'pen' }, m));`);
t('module rows on us: each applied through modDamage (the driver hit, the gunner killed)', M(`(() => { fresh(); hitUs({ m: [[hullId, 0, 40], [tuId, 0, 150]] }); const h = me.parts[0].mods, t = me.parts[5].mods;
  return h[0] === 60 && t[0] === 0 && !Armour.has(me, 'gunner') && me.lastHitBy === ghost; })()`));
t('...hostile and broken rows are refused: unknown ids, indexes out of range or not whole, NaN, Infinity, junk; 1e9 is clamped to 2,000', M(`(() => { fresh();
  hitUs({ m: [[999999, 0, 50], [hullId, 9, 50], [hullId, -1, 50], [hullId, 0.5, 50], [hullId, '0', 50], [hullId, 0, NaN], [hullId, 0, Infinity], [hullId, 0, -5], [trId, 0, 50], null, 'x', [hullId], {}, [hullId, 1, 1e9]] });
  const h = me.parts[0].mods; hitUs({ m: 'junk' }); hitUs({ m: { 0: [hullId, 0, 5] } });
  return h && h[0] === 100 && h[1] === 0 && h.slice(2).every((x, i) => x === PARTS.hullMedium.mods[i + 2].hp) && !me.parts[1].mods; })()`), M('[me.parts[0].mods, me.parts[1].mods]'));
t('...only the first 32 rows; none from a friend in a team battle', M(`(() => { fresh(); hitUs({ m: Array.from({ length: 40 }, () => [hullId, 0, 2]) }); const a = me.parts[0].mods[0];
  fresh(); MP.state.mode = 'pvp'; MP.state.players[1].team = 0; hitUs({ m: [[hullId, 0, 50]], list: [[hullId, 50]] }); const b = me.parts[0].mods; MP.state.mode = 'sandbox'; MP.state.players[1].team = 1;
  return a === 36 && !b && me.parts[0].hp == null; })()`));
t('...the hit arc points back along d (normalised) when it is sane, else at the shooter', M(`(() => { fresh(); hitUs({ list: [[hullId, 5]], d: [0, 3, 4] }); const a = Armour.fb.hurt.slice(-1)[0].d;
  fresh(); hitUs({ list: [[hullId, 5]], d: [NaN, 0, 1] }); const b = Armour.fb.hurt.slice(-1)[0].d; fresh(); hitUs({ list: [[hullId, 5]], d: [0, 50, 0] }); const c = Armour.fb.hurt.slice(-1)[0].d;
  const g = Math.hypot(ghost.x - me.x, ghost.y - me.y, ghost.z - me.z);
  return Math.abs(a.y - 0.6) < 1e-9 && Math.abs(a.z - 0.8) < 1e-9 && Math.abs(b.x - (ghost.x - me.x) / g) < 1e-9 && Math.abs(c.x - 1) < 1e-9; })()`));
t('...list rows go through Combat.damage as ever (a track killed by them breaks, stays)', M(`(() => { fresh(); hitUs({ list: [[trId, 1e4]], k: 'shot' }); return me.parts[1].broken && me.parts.includes(me.parts[1]); })()`));
t('a shell fired by us at the ghost resolves here and goes to its owner as hits (pen, the rows, the module rows)', M(`(() => { fresh(); Net.out = []; Combat.S.shots = [];
  const w = ghost.toWorld(0.5, 1.2, 1.2), S = SHELLS.aphe85, s = { k: 'shell', sh: 'aphe85', b: EARTH, x: w.x, y: w.y, z: w.z + 100, vx: 0, vy: 0, vz: -S.v0, t: 1, life: 6, owner: me, enemy: false, net: 0, cal: 85, pen: S.pen, v0: S.v0, gTop: Infinity, n: 4242 };
  for (let i = 0; i < 60 && Armour.moveShell(s, 1 / 120, Flight); i++); const msgs = sent().filter((m) => m.t === 'hit');
  return msgs.length >= 1 && msgs[0].to === 9 && msgs[0].k === 'pen' && msgs[0].list.length >= 1 && msgs[0].m && msgs[0].m.length >= 1 && msgs[0].d && Math.abs(msgs[0].d[2] - 1) < 1e-3 && ghost.parts.every((p) => p.hp == null); })()`));
t('...an HE round into a ghost\'s open-top turret: our feedback counts the two crew its burst kills there (from full health, once each), and the owner gets the module rows', M(`(() => {
  fresh(); Net.out = []; Combat.S.shots = []; Armour.fb.shot = null; const g = mk(OT); g.remote = 9; g.x = ghost.x; Flight.vessels = [me, g]; MP.peers.get(9).ghost = g;
  const w = g.toWorld(0, 2.8, 0), S = SHELLS.he85, s = { k: 'shell', sh: 'he85', b: EARTH, x: w.x, y: w.y + 30, z: w.z, vx: 0, vy: -S.v0, vz: 0, t: 1, life: 6, owner: me, enemy: false, net: 0, cal: 85, pen: 0, v0: S.v0, gTop: Infinity, n: 4243 };
  for (let i = 0; i < 20 && Armour.moveShell(s, 1 / 120, Flight); i++); const f = Armour.fb.shot, msgs = sent().filter((m) => m.t === 'hit'); MP.peers.get(9).ghost = ghost; Flight.vessels = [me, ghost];
  return f && f.r === 'pen' && f.crew === 2 && msgs.some((m) => m.k === 'blast' && m.m && m.m.length >= 2) && g.parts.every((p) => p.hp == null && !p.mods); })()`));

// ---------------------------------------------------------------- what it costs (§14)
R(`var rays = [], ma = air(MA), mark = (k) => { const t0 = process.hrtime.bigint(); k(); return Number(process.hrtime.bigint() - t0) / 1e3; };`);
ctx.process = process;
// 1,000 random hits on the MA-1 (half APFSDS, half APHE): resolve alone; and each penetration again on a fresh MA-1,
// resolved and applied (the damage, the modules, the crew, fires, what it strips), split by what followed: nothing
// lasting (plain), a knock-out, a detonation (with the turret thrown), kit torn off. The last three end a tank's fight
// or strip it once; plain penetrations are the ones a fight is made of.
const timing = R(`(() => {
  const us = (t0) => Number(process.hrtime.bigint() - t0) / 1e3;
  const once = () => {
    let seed = 12345; const rr = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const pens = [], all = [], by = { plain: [], ko: [], det: [], rip: [] }; let hits = 0;
    for (let i = 0; i < 1000; i++) {
      const az = rr() * TAU, el = (rr() - 0.3) * 0.8, d = { x: -Math.cos(az) * Math.cos(el), y: -Math.sin(el), z: -Math.sin(az) * Math.cos(el) }, P = { x: (rr() - 0.5) * 6, y: 0.6 + rr() * 2.4, z: (rr() - 0.5) * 3 };
      const sh = i % 2 ? 'apfsds120' : 'aphe85', w = ma.toWorld(P.x, P.y, P.z), s = shellAt(ma, sh, P, d, 15), e = { x: w.x + d.x * 15, y: w.y + d.y * 15, z: w.z + d.z * 15 };
      const t0 = process.hrtime.bigint(), R0 = Armour.resolve(s, ma, Armour.hitAll(ma, { x: s.x, y: s.y, z: s.z }, e), {}), t = us(t0);
      hits++; if (R0.r !== 'pen') continue;
      pens.push(t);
      const v = air(MA), F = simOf(me, v), n0 = v.parts.length, s2 = shellAt(v, sh, P, d, 15, { owner: me, enemy: false, n: s.n }), w2 = v.toWorld(P.x, P.y, P.z), e2 = { x: w2.x + d.x * 15, y: w2.y + d.y * 15, z: w2.z + d.z * 15 };
      Armour.resolve(shellAt(v, sh, P, d, 15, { n: s.n }), v, Armour.hitAll(v, { x: s2.x, y: s2.y, z: s2.z }, e2), F); // (its hit records and crew list, built once in a tank's life)
      const t1 = process.hrtime.bigint(), R1 = Armour.resolve(s2, v, Armour.hitAll(v, { x: s2.x, y: s2.y, z: s2.z }, e2), F);
      Armour.apply(v, R1, F, me, s2); const t2 = us(t1);
      all.push(t2); (v.ko && v.ko.x ? by.det : v.ko ? by.ko : F.vessels.length > 2 || v.parts.length !== n0 ? by.rip : by.plain).push(t2);
    }
    const st = (a) => { a.sort((x, y) => x - y); return { n: a.length, mean: a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0, p90: a.length ? a[Math.floor(a.length * 0.9)] : 0 }; };
    return { hits, resolve: st(pens), plain: st(by.plain), all: st(all), ko: st(by.ko), det: st(by.det), rip: st(by.rip) };
  };
  once(); return once(); // (the second time round: warm)
})()`);
const f1 = (q) => `${q.mean.toFixed(1)} µs mean (90%: ${q.p90.toFixed(1)} µs)`;
console.log(`     timing: ${timing.resolve.n} penetrations of 1,000 random hits on the MA-1; resolve alone ${f1(timing.resolve)}`);
console.log(`     timing: resolved and applied: ${timing.plain.n} plain ${f1(timing.plain)}; every penetration ${f1(timing.all)}`);
console.log(`     timing: once in a tank's fight: ${timing.ko.n} knock-outs ${timing.ko.mean.toFixed(0)} µs, ${timing.det.n} detonations ${timing.det.mean.toFixed(0)} µs, ${timing.rip.n} with kit torn off ${timing.rip.mean.toFixed(0)} µs (means)`);
t('a penetration and all that follows (resolve and apply) costs at most 100 µs (mean, Node); resolve alone too', timing.resolve.n > 50 && timing.plain.n > 50 && timing.resolve.mean <= 100 && timing.plain.mean <= 100, timing);
t('...and what happens once in a tank\'s fight (a knock-out, a detonation and its thrown turret, kit torn off) at most 2 ms', [timing.ko, timing.det, timing.rip].every((q) => !q.n || q.mean <= 2000), timing);
const life = R(`(() => { // main-gun shells over Highland Ridge: 1.5 km out, down onto the ground; and an autocannon's stream of 18 a second for 10 s
  const F = simOf(); F.vessels = []; const B = EARTH.arenas.highland;
  const shoot = (sh, e, z, h, el, ze) => { const P = Tt.at(e, z, Terrain.surfaceAt(EARTH, siteAngle(EARTH, e), z) + h), Q = Tt.at(e, z + 100 * Math.cos(ze), Terrain.surfaceAt(EARTH, siteAngle(EARTH, e), z) + h + 100 * Math.tan(el)), S = SHELLS[sh];
    const l = Math.hypot(Q.x - P.x, Q.y - P.y, Q.z - P.z); return { k: 'shell', sh, b: EARTH, x: P.x, y: P.y, z: P.z, vx: (Q.x - P.x) / l * S.v0, vy: (Q.y - P.y) / l * S.v0, vz: (Q.z - P.z) / l * S.v0, t: 0, life: 6, owner: null, net: 0, cal: S.cal, pen: S.pen, v0: S.v0, gTop: Infinity, cheap: S.cal < 40, n: ++serial }; };
  const run = (list) => { const t0 = process.hrtime.bigint(); for (const s of list) fly(s, F, 900); return Number(process.hrtime.bigint() - t0) / 1e6; };
  const mains = () => Array.from({ length: 100 }, (_, i) => shoot(i % 2 ? 'apfsds120' : 'aphe85', 17200 + i * 8, 14100, 2.5, -0.012, 0));
  const stream = () => Array.from({ length: 180 }, (_, i) => shoot('hei30', 17600 + (i % 18) * 3, 14200, 2.5, 0.02 + (i % 7) * 0.004, 0));
  run(mains()); run(stream()); // (warm the ground's caches)
  return { main: run(mains()) / 100, ac: run(stream()) / 180 }; })()`);
console.log(`     timing: a main-gun shell over its life ${life.main.toFixed(3)} ms, an autocannon round ${life.ac.toFixed(3)} ms (Node)`);
t('a main-gun shell over its life ≤ 3 ms; an autocannon round ≤ 0.3 ms (the coarse ground, the altitude skip)', life.main <= 3 && life.ac <= 0.3, life);

t.done();
