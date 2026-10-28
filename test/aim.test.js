// The ground update's aim and weapons (js/aim.js, Phase 2C, with its combat.js hooks): turrets and guns slewing at their
// rates within their limits, the traverse sweep and the dip by direction, the stabiliser, the ballistic solve against
// real shells, firing along the barrel with its recoil, reloads and where the next round comes from, shell select, held
// automatic fire at any step size, launchers (wire-guided, top attack, the command SAM, a ground-launched missile with no
// lock, rocket rails and their range table, stowed reloads), the proximity fuze, smoke, the tracking radar's lock and its
// warning to another player, and aimed guns firing on the ground. Old craft never reach any of it (ground.test.js proves
// that with counters; rwr.test.js that old turrets still park).
const G = require('./lib/game.js');
const t = G.checks('aim.test.js');
const ctx = G.load({ combat: true });
const R = (code) => G.run(ctx, code);

R(`
Settings.get = (k) => ({ targets: 'off', high: false })[k]; // (no range, no fighters: only what the tests put up)
var RAD = Math.PI / 180, near = (a, b, e) => Math.abs(a - b) <= (e == null ? 1e-6 : e);
// a TK-34-like tank (ground.test.js's): hull, tracks, diesel, ring, cast turret, the 85 mm gun and a coaxial MG
var REAL = [
  { type: 'hullMedium', x: 0, y: 1.1, flip: false, rot: 0 },
  { type: 'trackMed', x: 0, y: 0.5, flip: false, rot: 0, z: -1.35, att: 0 }, { type: 'trackMed', x: 0, y: 0.5, flip: false, rot: 0, z: 1.35, att: 0 },
  { type: 'engDiesel', x: -1.8, y: 1.1, flip: true, rot: 0, att: 0 },
  { type: 'ringM', x: 0, y: 1.85, flip: false, rot: 0, att: 0 }, { type: 'turretCast', x: 0, y: 2.425, flip: false, rot: 0, att: 4 },
  { type: 'gun85', x: 2.622, y: 2.425, flip: false, rot: 3, att: 5 }, { type: 'mgCoax', x: 1.4, y: 2.425, flip: false, rot: 3, z: 0.6, att: 5 }];
var build = (rows, kind) => { const ps = partsFromDesign(rows), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = kind || 'tank'; v.rebuildGroups(); return v; };
// held level (part x east, y up, z north) alt m over the sea at angle ang, still (nothing steps its physics: it floats)
var level = (v, alt, ang) => {
  const a = ang || 0, r = EARTH.radius + (alt == null ? 300 : alt);
  v.x = r * Math.cos(a); v.y = r * Math.sin(a); v.z = 0; v.vx = v.vy = v.vz = 0; v.av = v3();
  const S = surfaceFrame(v.x, v.y, v.z); v.q = qbasis(S.east, S.up, S.north); v.landed = false;
  return v;
};
var ahead = (m, alt) => -m / (EARTH.radius + (alt == null ? 300 : alt)); // (the angle m east)
var simOf = (v) => ({ time: 0, active: v, vessels: v ? [v] : [], toasts: [], toast(m) { this.toasts.push(m); }, firing: false, mgFiring: false, groundAim: true,
  aim: null, zero: 800, warpIdx: 0, running: true, camAbs: { x: 0, y: 0, z: 0 }, breakParts() {}, ripParts() {}, onDestroyed() {} });
var at = (v, x, y, z) => v.toWorld(x, y, z); // (a point given in the vessel's part space)
// the player's crosshair on P: from the gunner's sight, as GHUD.aimUpdate would set it
var aimAt = (F, v, P) => { const o = Aim.sightPoint(v, v3()), dx = P.x - o.x, dy = P.y - o.y, dz = P.z - o.z, d = Math.hypot(dx, dy, dz);
  F.aim = { o, dir: { x: dx / d, y: dy / d, z: dz / d }, P: { x: P.x, y: P.y, z: P.z }, d, src: 'ground', indirect: false }; return F.aim; };
var run = (F, secs, h, each) => { h = h || 1 / 120; for (let i = 0, n = Math.round(secs / h); i < n; i++) { if (each && each(i, h) === false) break; Combat.step(h, F); F.time += h; } };
var partOf = (v, type) => v.parts.find((p) => p.type === type);
var gunOf = (v, type) => partOf(v, type || 'gun85');
var sysOf = (v, type) => Combat.systems(v).find((q) => q.key === (type || 'gun85'));
var ringOf = (v) => v.tg[0].ring;
var dirEl = (v, p) => { const d = Aim.dir(v, p, v3()), r = Math.hypot(v.x, v.y, v.z); return Math.asin((d.x * v.x + d.y * v.y + d.z * v.z) / r); }; // (the barrel above the level)
var flat = (v, m, type) => { const T = Aim.trunnion(v, gunOf(v, type), v3()), S = surfaceFrame(v.x, v.y, v.z); return { x: T.x + S.east.x * m, y: T.y + S.east.y * m, z: T.z + S.east.z * m }; }; // (level with the gun, m ahead)
// an enemy fighter (the range's raider), hot (its engine lit), alt m up at angle ang, still unless moved
var bandit = (alt, ang) => {
  const ps = RAIDER.map(([ty, x, y, rot]) => makePart(ty, x, y, { flip: x < 0, rot: rot || 0 })), b = new Vessel(ps, buildAdjacency(ps), EARTH);
  b.kind = 'plane'; b.rebuildGroups(); level(b, alt, ang); b.ai = { t: 0, down: false };
  for (const p of b.parts) if (p.def.thrust) { p.active = true; p.firing = 1; }
  return b;
};
// direct hits on armour (old rounds and missiles go through Armour.legacyHit): who was hit, where
var hits = [], LH = Armour.legacyHit;
Armour.legacyHit = function (s, v, p, at, F) { hits.push({ s, v, p, at: { x: at.x, y: at.y, z: at.z } }); return LH.call(this, s, v, p, at, F); };
`);

// ---------------------------------------------------------------- rings and guns: rates, limits
R(`var tv = level(build(REAL)), F2 = simOf(tv), g2 = tv.tg[0]; Combat.reset(F2);
var heavy = build([{ type: 'hullMedium', x: 0, y: 1.1, flip: false, rot: 0 }, { type: 'ringS', x: 0, y: 1.85, flip: false, rot: 0, att: 0 }, { type: 'turretBox', x: 0, y: 2.45, flip: false, rot: 0, att: 1 }]).tg[0];`);
t('the ring cap formula: rate = ring.rate × √(cap / turret mass), within 0.35..1 (a heavy box turret on a small ring turns slower)',
  R(`near(g2.rate, 24 * RAD * clamp(Math.sqrt(12 / g2.mass), 0.35, 1)) && near(heavy.rate, 30 * RAD * clamp(Math.sqrt(4 / heavy.mass), 0.35, 1)) && heavy.rate < 30 * RAD * 0.7`),
  R('[g2.mass, g2.rate / RAD, heavy.mass, heavy.rate / RAD]'));
R(`aimAt(F2, tv, at(tv, 0, 2.4, 800)); var r0 = ringOf(tv).aimYaw || 0; run(F2, 1 / 120); var r1 = ringOf(tv).aimYaw; run(F2, 5); var r5 = ringOf(tv).aimYaw;`);
t('a ring turns at its rate a step at a time, and brings the turret round to a point 90° off (3.75 s at 24°/s)',
  R(`near(r1 - r0, g2.rate / 120, 1e-9) && near(r5, Math.PI / 2, 0.5 * RAD)`), R('[(r1 - r0) / RAD, g2.rate / 120 / RAD, r5 / RAD]'));
R(`var ringR = ringOf(tv); ringR.aimYaw = 0; ringR.hp = Combat.maxHp(ringR.def) * 0.4; run(F2, 1 / 120); var rHalf = ringR.aimYaw; ringR.aimYaw = 0; ringR.broken = true; run(F2, 1 / 120); var rCrank = ringR.aimYaw;
ringR.broken = false; ringR.hp = null; ringR.aimYaw = 0;`);
t('a damaged ring (under half its health) turns at half its rate; a broken one at a hand crank\'s 2°/s',
  R(`near(rHalf, g2.rate / 240, 1e-9) && near(rCrank, 2 * RAD / 120, 1e-9)`), R('[rHalf / RAD * 120, rCrank / RAD * 120]'));
R(`var gp = gunOf(tv); aimAt(F2, tv, at(tv, 2.6 + 100 * Math.cos(60 * RAD), 2.4 + 100 * Math.sin(60 * RAD), 0)); run(F2, 6);`);
t('a gun climbs to its top limit (85 mm: +22°) and no further, and says the limit holds it',
  R(`near(gp.aimEl, 22 * RAD, 1e-9) && gp._lim && near(dirEl(tv, gp), 22 * RAD, 1e-6)`), R('[gp.aimEl / RAD, gp._lim, dirEl(tv, gp) / RAD]'));
R(`var P1 = flat(tv, 1000); aimAt(F2, tv, P1); run(F2, 6); var lift1 = dirEl(tv, gp), want1 = Aim.solve('aphe85', 1000, 0, EARTH, Math.hypot(P1.x, P1.y, P1.z) - EARTH.radius).el;
Settings.get = (k) => ({ targets: 'off', high: false, aimMode: 'realistic' })[k]; F2.zero = 400; run(F2, 3); var real4 = dirEl(tv, gp), want4 = Aim.solve('aphe85', 400, 0, EARTH, 300).el;
Settings.get = (k) => ({ targets: 'off', high: false })[k];`);
t('Arcade aim: the gun is raised for its shell\'s drop at the range measured (85 mm APHE at 1 km)',
  R(`near(lift1, want1, 0.01 * RAD) && want1 > 0.1 * RAD`), R('[lift1 / RAD, want1 / RAD]'));
t('Realistic aim: raised for the sight\'s zero instead (400 m), whatever the range',
  R(`near(real4, want4, 0.02 * RAD) && real4 < lift1 - 0.05 * RAD`), R('[real4 / RAD, want4 / RAD]'));
R(`var cv = level(build([{ type: 'hullCasemate', x: 0, y: 1.2, flip: false, rot: 0 }, { type: 'gun76L', x: 4.3, y: 1.6, flip: false, rot: 3, att: 0 }])), cg = gunOf(cv, 'gun76L'), CF = simOf(cv);
Combat.reset(CF); aimAt(CF, cv, at(cv, 1000 * Math.cos(30 * RAD), 1.6, 1000 * Math.sin(30 * RAD))); run(CF, 1); var cy1 = cg.aimYaw; run(CF, 4);`);
t('a gun with no turret traverses in its own casemate arc (76 mm: ±12° at 6°/s) and stops at its edge',
  R(`!cv.tg.length && near(cy1, 6 * RAD, 1e-6) && near(cg.aimYaw, 12 * RAD, 1e-9) && cg._lim`), R('[cv.tg.length, cy1 / RAD, cg.aimYaw / RAD, cg._lim]'));
R(`var JAM = REAL.concat([{ type: 'radarSearch', x: -1.9, y: 2.35, flip: false, rot: 0, att: 0 }]), jv = level(build(JAM)), JF = simOf(jv);
Combat.reset(JF); aimAt(JF, jv, at(jv, 0, 2.4, 800)); run(JF, 3);`);
t('a jammed ring (its turret against a mast standing on the hull) never turns',
  R(`!!jv.tg[0].jam && (jv.tg[0].ring.aimYaw || 0) === 0`), R('[jv.tg[0].jam, jv.tg[0].ring.aimYaw]'));

// ---------------------------------------------------------------- the sweep
R(`var MAST = REAL.concat([{ type: 'radarSearch', x: -3.0, y: 2.35, flip: false, rot: 0, att: 0 }]), mps = partsFromDesign(MAST), mtg = Aim.groupsOfParts(mps, buildAdjacency(mps)), msw = Aim.sweep(mps, mtg[0]);
var fps = partsFromDesign(REAL), fsw = Aim.sweep(fps, Aim.groupsOfParts(fps, buildAdjacency(fps))[0]);
var mv = level(build(MAST)), MF = simOf(mv); Combat.reset(MF); aimAt(MF, mv, at(mv, -800, 2.4, 30)); run(MF, 10);`);
t('the sweep: a mast behind the turret stops the gun\'s barrel short of it either way round (about ±160°); with none, all the way round',
  R(`!fsw.yawLim && !!msw.yawLim && !mtg[0].jam && msw.yawLim[1] >= 150 * RAD && msw.yawLim[1] <= 170 * RAD && msw.yawLim[0] <= -150 * RAD && msw.yawLim[0] >= -170 * RAD`),
  R('[fsw.yawLim, msw.yawLim && msw.yawLim.map((a) => a / RAD), mtg[0].jam]'));
t('...and a turret aimed past the mast stops at its limit, the ring saying so',
  R(`!!mv.tg[0].yawLim && Math.abs(ringOf(mv).aimYaw) <= mv.tg[0].yawLim[1] + 1e-9 && Math.abs(ringOf(mv).aimYaw) > 150 * RAD && ringOf(mv)._lim`),
  R('[ringOf(mv).aimYaw / RAD, ringOf(mv)._lim]'));
R(`var DECK = REAL.concat([{ type: 'smokeL', x: -2.3, y: 2.0, flip: false, rot: 0, att: 0 }]), dps = partsFromDesign(DECK), dsw = Aim.sweep(dps, Aim.groupsOfParts(dps, buildAdjacency(dps))[0]);`);
t('the dip by direction: the 85 mm goes its full 5° down ahead and abeam, but only about 2° over a box on the deck behind',
  R(`near(dsw.dep[0], -5 * RAD, 1e-6) && near(dsw.dep[3], -5 * RAD, 1e-6) && dsw.dep[6] > -3.5 * RAD && dsw.dep[6] < -0.5 * RAD`),
  R('Array.from(dsw.dep).map((a) => Math.round(a / RAD * 10) / 10)'));

// ---------------------------------------------------------------- the stabiliser
R(`var STAB = REAL.map((q) => q.type === 'gun85' ? Object.assign({}, q, { type: 'gun75', x: 1.922 }) : q);
var pitchRun = (rows, type) => {
  const v = level(build(rows)), F = simOf(v), g = gunOf(v, type), q0 = { w: v.q.w, x: v.q.x, y: v.q.y, z: v.q.z };
  Combat.reset(F); aimAt(F, v, flat(v, 1500, type)); run(F, 4);
  const e0 = dirEl(v, g); let e2 = 0, n = 0;
  run(F, 6, 1 / 120, (i, h) => { // (the hull pitching ±4° every 1.5 s: up to 17°/s)
    if (i > 240) { const e = dirEl(v, g) - e0; e2 += e * e; n++; } // (where the last step left it, before this step's pitch)
    v.q = qmul(q0, qaxis(0, 0, 1, 4 * RAD * Math.sin((TAU * (i + 1) * h) / 1.5)));
  });
  return Math.sqrt(e2 / n);
};
var rmsU = pitchRun(REAL, 'gun85'), rmsS = pitchRun(STAB, 'gun75');`);
t('the stabiliser: an unstabilised gun (6°/s) bounces off target as the hull pitches; a stabilised one holds it',
  R(`rmsU > 1 * RAD && rmsS < 0.1 * RAD`), R('[rmsU / RAD, rmsS / RAD]'));

// ---------------------------------------------------------------- ballistics
R(`var shotMiss = (key, D, alt) => {
  const SH = SHELLS[key], r = EARTH.radius + alt, O = { x: r, y: 0, z: 0 }, S = surfaceFrame(r, 0, 0), sol = Aim.solve(key, D, 0, EARTH, alt), ce = Math.cos(sol.el), se = Math.sin(sol.el);
  const T = { x: O.x + S.east.x * D, y: O.y + S.east.y * D, z: O.z + S.east.z * D }, F = simOf(null);
  Combat.reset(F);
  const s = { k: 'shell', sh: key, b: EARTH, x: O.x, y: O.y, z: O.z, vx: (S.east.x * ce + S.up.x * se) * SH.v0, vy: (S.east.y * ce + S.up.y * se) * SH.v0, vz: (S.east.z * ce + S.up.z * se) * SH.v0,
    t: 0, life: 10, owner: null, enemy: false, net: 0, cal: SH.cal, pen: SH.pen || 0, v0: SH.v0, spare: null, tracer: false, prox: 0, ric: false, gTop: Infinity };
  Combat.S.shots.push(s);
  let best = Infinity, px = s.x, py = s.y, pz = s.z;
  for (let i = 0; i < 1200 && Combat.S.shots.includes(s); i++) {
    Combat.step(1 / 120, F); F.time += 1 / 120;
    best = Math.min(best, Combat.segPoint(px, py, pz, s.x, s.y, s.z, T.x, T.y, T.z)[1]); px = s.x; py = s.y; pz = s.z;
    if ((s.x - O.x) * S.east.x + (s.y - O.y) * S.east.y + (s.z - O.z) * S.east.z > D + 50) break;
  }
  return best;
};
var miss = {}, worst = 0;
for (const k of ['apfsds120', 'apds105', 'aphe85', 'ap75', 'he75', 'he152', 'heat125', 'hei30', 'ball13']) for (const D of [500, 1000, 2000]) { const m = shotMiss(k, D, 300); miss[k + '@' + D] = Math.round(m * 100) / 100; worst = Math.max(worst, m); }`);
t('the ballistic solve against real shells: within 1 m at 500, 1,000 and 2,000 m, every kind', R('worst < 1'), R('miss'));
R(`var e2e = (D) => {
  const v = level(build(REAL)), F = simOf(v), P = flat(v, D);
  Combat.reset(F); aimAt(F, v, P); run(F, 5);
  const mr = Math.random; Math.random = () => 0; // (no dispersion)
  const ok = Aim.fire(v, sysOf(v), 1 / 120, F); Math.random = mr;
  const s = Combat.S.shots.find((q) => q.k === 'shell' && q.owner === v);
  let best = Infinity, px = s ? s.x : 0, py = s ? s.y : 0, pz = s ? s.z : 0;
  for (let i = 0; s && i < 1200 && Combat.S.shots.includes(s); i++) { Combat.step(1 / 120, F); F.time += 1 / 120; best = Math.min(best, Combat.segPoint(px, py, pz, s.x, s.y, s.z, P.x, P.y, P.z)[1]); px = s.x; py = s.y; pz = s.z; }
  return [ok, Math.round(best * 100) / 100];
};
var e1 = e2e(1000), e2 = e2e(2000);`);
t('aimed and fired by the tank itself (turret, lift, along the barrel): within 1 m of the point at 1 and 2 km',
  R(`e1[0] && e2[0] && e1[1] < 1 && e2[1] < 1`), R('[e1, e2]'));
R(`var mvv = level(build(REAL)), mg = gunOf(mvv); ringOf(mvv).aimYaw = 0.7; mg.aimEl = 0.15;
var ex = (() => { const c = mvv.tg[0].c, psi = 0.7, el = 0.15, h = mg.def.h, T0 = { x: mg.x - h / 2 + 0.18 * h, y: mg.y, z: partZ(mg) }, x = T0.x - c.x, z = T0.z - c.z;
  const T = { x: c.x + x * Math.cos(psi) - z * Math.sin(psi), y: T0.y, z: c.z + x * Math.sin(psi) + z * Math.cos(psi) }, d = { x: Math.cos(el) * Math.cos(psi), y: Math.sin(el), z: Math.cos(el) * Math.sin(psi) }, L = h - 0.18 * h;
  return { m: mvv.toWorld(T.x + d.x * L, T.y + d.y * L, T.z + d.z * L), d: mvv.axis(d.x, d.y, d.z) }; })(), am = Aim.muzzle(mvv, mg, v3()), ad = Aim.dir(mvv, mg, v3());`);
t('muzzle and barrel after the turret turns (ψ 0.7) and the gun rises (el 0.15): T + g·(h − pivot·h), turned about the ring',
  R(`Math.hypot(am.x - ex.m.x, am.y - ex.m.y, am.z - ex.m.z) < 1e-6 && Math.hypot(ad.x - ex.d.x, ad.y - ex.d.y, ad.z - ex.d.z) < 1e-12`),
  R('[Math.hypot(am.x - ex.m.x, am.y - ex.m.y, am.z - ex.m.z), Math.hypot(ad.x - ex.d.x, ad.y - ex.d.y, ad.z - ex.d.z)]'));
R(`var rt = Aim.rangeTable(PARTS.mlrsLight), rmax = Math.max.apply(null, rt.map((q) => q.d));
var MLRS = [{ type: 'hullWheeled', x: 0, y: 1.2, flip: false, rot: 0 }, { type: 'mlrsLight', x: 0, y: 2.45, flip: false, rot: 3, att: 0 }];
var rocketAt = (D) => {
  const v = level(build(MLRS), 50), F = simOf(v), p = partOf(v, 'mlrsLight'), S0 = Aim.rocketEl(PARTS.mlrsLight, D, 0), el = S0.el;
  Combat.reset(F); p.aimEl = el;
  const mr = Math.random; Math.random = () => 0.5; Combat.fireRocket(v, p, false, F); Math.random = mr; // (no spread)
  const s = Combat.S.shots[Combat.S.shots.length - 1], O = { x: s.x, y: s.y, z: s.z }, R0 = Math.hypot(s.x, s.y, s.z);
  let px = s.x, py = s.y, pz = s.z, pr = R0, d = null;
  for (let i = 0; i < 120 * 60 && Combat.S.shots.includes(s); i++) {
    Combat.step(1 / 120, F); F.time += 1 / 120;
    const r = Math.hypot(s.x, s.y, s.z);
    if (r < R0 && pr >= R0 && s.t > 0.5) { const f = (pr - R0) / (pr - r), ix = px + (s.x - px) * f, iy = py + (s.y - py) * f, iz = pz + (s.z - pz) * f; d = R0 * Math.acos(clamp((ix * O.x + iy * O.y + iz * O.z) / (R0 * R0), -1, 1)); break; }
    px = s.x; py = s.y; pz = s.z; pr = r;
  }
  return { D, d: d && Math.round(d), el: Math.round(el / RAD * 10) / 10, life: s.life, he: s.he, spare: s.spare === v };
};
var rk1 = rocketAt(3000), rk2 = rocketAt(Math.round(rmax * 0.6));`);
t('rocket artillery: its range table rises to a longest shot of kilometres; laid by it, the rails put a rocket within 3% of the range',
  R(`rt.length >= 15 && rmax > 3500 && [rk1, rk2].every((q) => q.d && Math.abs(q.d - q.D) / q.D < 0.03)`), R('[rt.length, Math.round(rmax), rk1, rk2]'));
t('...its rockets fly their own life (60 s), carry their blast\'s penetration and spare their launcher at the muzzle',
  R(`rk1.life === 60 && rk1.he === 25 && rk1.spare`), R('rk1'));

// ---------------------------------------------------------------- firing, reloads, ammunition, shells
R(`var rv = level(build(REAL)), RF = simOf(rv), rg = gunOf(rv), rt = partOf(rv, 'turretCast'), LDR = PARTS.turretCast.mods.findIndex((m) => m.role === 'loader');
Combat.reset(RF); var f1 = Aim.fire(rv, sysOf(rv), 1 / 120, RF), re1 = rg.reload, f2 = Aim.fire(rv, sysOf(rv), 1 / 120, RF);
run(RF, 6.9); var f3 = Aim.fire(rv, sysOf(rv), 1 / 120, RF); run(RF, 0.2); var f4 = Aim.fire(rv, sysOf(rv), 1 / 120, RF), ready5 = rg.ammo;
var rl = Aim.reloadOf(rv, rg); (rt.mods || (rt.mods = []))[LDR] = 0; // (armour.js's crew: the turret's loader killed)
var rn = Aim.reloadOf(rv, rg), rn120 = Aim.reloadOf(rv, { def: PARTS.gun120 }), dead = !Armour.has(rv, 'loader');
// an autoloader carousel in the turret (it takes over the turret's own rounds), its loader dead too
var av0 = level(build(REAL.concat([{ type: 'autoloader', x: -0.3, y: 2.2, flip: false, rot: 0, att: 5 }]))); (partOf(av0, 'turretCast').mods = [])[LDR] = 0;
var ra85 = Aim.reloadOf(av0, gunOf(av0)), ra120 = Aim.reloadOf(av0, { def: PARTS.gun120 });`);
t('a main gun fires one round, then reloads (85 mm: 7 s): asked again sooner it waits, saying nothing',
  R(`f1 && near(re1, 7) && !f2 && !f3 && f4 && ready5 === 4 && !RF.toasts.some((m) => /empty/.test(m))`), R('[f1, re1, f2, f3, f4, ready5, RF.toasts]'));
t('reload: half as long again with no loader alive; an autoloader\'s fixed 7 s for 100 mm guns and up (not for smaller ones)',
  R(`dead && near(rl, 7) && near(rn, 10.5) && near(rn120, 9) && near(ra85, 10.5) && near(ra120, 7)`), R('[dead, rl, rn, rn120, ra85, ra120]'));
// the real stores (Armour.crewOf): the hull's own rounds, a rack in the turret (instead of the turret's own) and an
// autoloader on the ring, two rounds each
R(`var dv = level(build(REAL.concat([{ type: 'ammoRack', x: -0.6, y: 2.3, flip: false, rot: 0, att: 5 }, { type: 'autoloader', x: 0, y: 1.6, flip: false, rot: 0, att: 4 }]))), DF = simOf(dv), dg = gunOf(dv);
var DS = Armour.crewOf(dv).stores, A1 = DS.find((e) => e.i >= 0), A2 = DS.find((e) => e.part && e.part.type === 'ammoRack'), A3 = DS.find((e) => e.part && e.part.type === 'autoloader');
var nStores = DS.length; A1.rounds = A2.rounds = A3.rounds = 2; Combat.reset(DF);
var order = [];
for (let i = 0; i < 7; i++) { const b = [A1.rounds, A2.rounds, A3.rounds], ok = Aim.draw(dv); order.push(!ok ? '-' : A1.rounds < b[0] ? 'mod' : A2.rounds < b[1] ? 'rack' : A3.rounds < b[2] ? 'auto' : '?'); }
A1.rounds = 1; dg.ammo = 1; dg.reload = 0; var fd = Aim.fire(dv, sysOf(dv), 1 / 120, DF), fdAmmo = dg.ammo, fdA1 = A1.rounds, fdRe = dg.reload;
dg.ammo = 0; dg.reload = 0; A1.rounds = A2.rounds = A3.rounds = 0; DF.toasts.length = 0; DF.time += 9; var fe = Aim.fire(dv, sysOf(dv), 1 / 120, DF);`);
t('the next round comes from built-in ammunition first, then racks, then the autoloader',
  R(`nStores === 3 && order.join() === 'mod,mod,rack,rack,auto,auto,-'`), R('[nStores, order]'));
t('a gun out of ready rounds reloads one from the stores (it is reloading, not empty); with none anywhere it says empty',
  R(`fd && fdAmmo === 1 && fdA1 === 0 && fdRe > 0 && !fe && DF.toasts.some((m) => /empty/.test(m))`), R('[fd, fdAmmo, fdA1, fdRe, fe, DF.toasts]'));
R(`var sv = level(build(REAL)), SF = simOf(sv), sg = gunOf(sv); Combat.reset(SF); SF.time = 10;
Aim.select(sv, 1, SF); var st1 = Aim.status(sv), q1 = [st1.sel, st1.queued];
Aim.fire(sv, sysOf(sv), 1 / 120, SF); var k1 = Combat.S.shots[Combat.S.shots.length - 1].sh;
run(SF, 7.1); var k2sel = sg.shellSel; Aim.fire(sv, sysOf(sv), 1 / 120, SF); var k2 = Combat.S.shots[Combat.S.shots.length - 1].sh;
run(SF, 7.1); SF.time += 5; Aim.select(sv, 0, SF); var once = [sg.shellSel, sg.shellNext]; SF.time += 0.5; Aim.select(sv, 0, SF); var dbl = [sg.shellSel, sg.shellNext, sg.reload];`);
t('shell select: 2 queues HE for the next reload, and the round already loaded goes first',
  R(`q1[0] === 0 && q1[1] === 1 && k1 === 'aphe85' && k2sel === 'he85' && k2 === 'he85'`), R('[q1, k1, k2sel, k2]'));
t('...the same key twice within a second takes the round out and loads that one now',
  R(`once[0] === 'he85' && once[1] === 'aphe85' && dbl[0] === 'aphe85' && dbl[1] == null && near(dbl[2], 7, 1e-9)`), R('[once, dbl]'));
R(`var mgCount = (h) => { const v = level(build(REAL)), F = simOf(v), p = gunOf(v, 'mgCoax'), a0 = p.ammo; Combat.reset(F); F.groundAim = false; F.mgFiring = true; run(F, 2.04, h); return a0 - p.ammo; }; // (2.04 s: off a round's boundary, where rounding would pick 24 or 25)
var mg120 = mgCount(1 / 120), mg60 = mgCount(1 / 60), mg30 = mgCount(1 / 30);`);
t('machine guns fire on their own key at their own rate, whatever the step (the first at once, then 12 a second: 25 in 2.04 s)',
  R(`mg120 === 25 && mg60 === 25 && mg30 === 25`), R('[mg120, mg60, mg30]'));
R(`var kv = level(build(REAL)), KF = simOf(kv); Combat.reset(KF); var kd = Aim.dir(kv, gunOf(kv), v3()); Aim.fire(kv, sysOf(kv), 1 / 120, KF);
var kick = { x: kv.vx, y: kv.vy, z: kv.vz }, kwant = (0.5 * SHELLS.aphe85.kg * SHELLS.aphe85.v0) / kv.mass, kshot = gunOf(kv).shotAt;`);
t('the recoil: the hull is pushed back along the barrel by half the shell\'s momentum, and rocks; the gun knows when it fired',
  R(`near(Math.hypot(kick.x, kick.y, kick.z), kwant, kwant * 1e-6) && (kick.x * kd.x + kick.y * kd.y + kick.z * kd.z) < -0.99 * kwant && Math.hypot(kv.av.x, kv.av.y, kv.av.z) > 0 && kshot === 0`),
  R('[Math.hypot(kick.x, kick.y, kick.z), kwant]'));
R(`var lv = build(REAL); lv.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites.runway.east), 0); lv.contactTime = 1; lv.landed = true;
var LF = simOf(lv); LF.groundAim = false; Combat.reset(LF); lv.wsel = Combat.systems(lv).findIndex((q) => q.key === 'gun85');
LF.firing = true; Combat._t.playerFrame(LF, 1 / 30); var landedShell = Combat.S.shots.some((s) => s.k === 'shell' && s.owner === lv && s.sh === 'aphe85');
LF.firing = false; Combat._t.playerFrame(LF, 1 / 30); LF.mgFiring = true; run(LF, 0.5); var landedMG = 2000 - gunOf(lv, 'mgCoax').ammo;`);
t('aimed guns fire on the ground (old turrets hold their fire there): the main gun on the trigger, the MG on its key',
  R(`lv.landed && landedShell && landedMG >= 5`), R('[landedShell, landedMG]'));
R(`var st = Aim.status(level(build(REAL))), sm = Aim.summary(partsFromDesign(REAL));`);
t('the HUD\'s status: the main gun, its two shells (APHE loaded), ready, its reload done, 6 ready at the gun',
  R(`st.name === '85 mm' && st.shells.map((q) => q.label).join() === 'APHE,HE' && st.sel === 0 && st.queued === -1 && st.ready && st.reload === 1 && st.readyN === 6`),
  R('[st.name, st.shells, st.sel, st.queued, st.ready, st.reload, st.readyN]'));
t('the builder\'s summary: 85 mm Gun, 124 mm at 1 km, 7 s, 24°/s, -5°/+22°, 5 crew, 42 rounds',
  R(`sm.gun === '85 mm Gun' && Math.abs(sm.pen1k - 124) <= 1 && sm.reload === 7 && sm.trav === 24 && sm.el.join() === '-5,22' && sm.crew === 5 && sm.rounds === 42`), R('sm'));
t('the weapon box (Combat.status) names an aimed gun by calibre and round, with every round aboard and its reload',
  R(`(() => { const v = level(build(REAL)), s = Combat.status(v); return s.name === '85 mm APHE' && Number.isFinite(s.ammo) && s.ammo >= 6 && s.reload === 1 && s.ready; })()`),
  R('Combat.status(level(build(REAL)))'));
R(`var WIRE = [{ type: 'hullLight', x: 0, y: 1.0, flip: false, rot: 0 }, { type: 'atgmWire', x: 0, y: 1.75, flip: false, rot: 3, att: 0 }];
var wv = level(build(WIRE)), WF = simOf(wv), wp = partOf(wv, 'atgmWire'); WF.groundAim = false; Combat.reset(WF);
var w1 = Aim.fire(wv, Combat.systems(wv)[0], 1 / 120, WF), wa1 = wp.ammo; wv.vx = 5; run(WF, 25); var wa2 = wp.ammo; wv.vx = 0; run(WF, 20.1); var wa3 = [wp.ammo, wp.stow];`);
t('a launcher reloads from its stowed rounds only while standing still, after its reload time (20 s)',
  R(`w1 && wa1 === 0 && wa2 === 0 && wa3[0] === 1 && wa3[1] === 1`), R('[w1, wa1, wa2, wa3]'));

// ---------------------------------------------------------------- launchers and guidance
R(`var ATGM = [{ type: 'hullLight', x: 0, y: 1.0, flip: false, rot: 0 }, { type: 'atgmTube', x: 0, y: 2.0, flip: false, rot: 3, att: 0 }];
var sacl = (cross) => {
  const v = level(build(ATGM)), tg = level(build(REAL), 300, ahead(2000)), F = simOf(v); F.vessels = [v, tg]; tg.vz = cross; Combat.reset(F); hits.length = 0;
  const track = () => aimAt(F, v, { x: tg.x, y: tg.y, z: tg.z });
  track(); run(F, 2, 1 / 120, () => { track(); });
  const ok = Aim.fire(v, Combat.systems(v)[0], 1 / 120, F), s = Combat.S.shots[Combat.S.shots.length - 1];
  let last = null;
  run(F, 15, 1 / 120, (i, h) => { tg.z += tg.vz * h; track(); if (!Combat.S.shots.includes(s)) return false; last = { x: s.x, y: s.y, z: s.z }; });
  const H = hits.find((q) => q.s === s), gone = !Combat.S.shots.includes(s), miss = last ? Math.hypot(last.x - tg.x, last.y - tg.y, last.z - tg.z) : null;
  return { ok, saclos: !!s.saclos, hit: (!!H && H.v === tg) || (gone && miss < 8), part: H && H.p.type, miss: miss && Math.round(miss * 10) / 10, t: Math.round(s.t * 10) / 10 };
};
var sc = sacl(8);`);
t('wire guidance: the missile rides the line of aim and hits a target crossing at 8 m/s 2 km off',
  R(`sc.ok && sc.saclos && sc.hit`), R('sc'));
R(`var TOP = [{ type: 'hullLight', x: 0, y: 1.0, flip: false, rot: 0 }, { type: 'atgmTop', x: 0, y: 1.8, flip: false, rot: 3, att: 0 }];
var topRun = () => {
  const v = level(build(TOP)), tg = level(build(REAL), 300, ahead(1500)), F = simOf(v); F.vessels = [v, tg]; Combat.reset(F); hits.length = 0;
  aimAt(F, v, { x: tg.x, y: tg.y, z: tg.z }); run(F, 2);
  Combat.launchMissile(v, partOf(v, 'atgmTop'), tg, F);
  const s = Combat.S.shots[Combat.S.shots.length - 1], up0 = Math.hypot(tg.x, tg.y, tg.z);
  let last = null, top = 0;
  for (let i = 0; i < 120 * 20 && Combat.S.shots.includes(s); i++) { last = { dx: s.dx, dy: s.dy, dz: s.dz }; top = Math.max(top, Math.hypot(s.x, s.y, s.z) - up0); Combat.step(1 / 120, F); F.time += 1 / 120; }
  const H = hits.find((q) => q.s === s), loc = H && tg.toLocal(H.at.x, H.at.y, H.at.z), r = H && partRect(H.p);
  return { quiet: s.target === null && !!s.top, hit: !!H && H.v === tg, roof: !!H && Math.abs(loc.y - r.t) < 0.08, part: H && H.p.type,
    dive: last && Math.round(Math.asin(-(last.dx * tg.x + last.dy * tg.y + last.dz * tg.z) / up0) / RAD), top: Math.round(top) };
};
var tr = topRun();`);
t('top attack: it climbs well over the line, then comes down onto the target\'s roof (and no warning goes to it: no target set)',
  R(`tr.quiet && tr.hit && tr.roof && tr.top > 100 && tr.dive > 10`), R('tr'));
R(`var SAMV = [{ type: 'hullWheeled', x: 0, y: 1.2, flip: false, rot: 0 }, { type: 'samCmd', x: 0.5, y: 2.55, flip: false, rot: 3, att: 0 }, { type: 'radarTrack', x: -1.5, y: 2.4, flip: false, rot: 0, att: 0 }];
var closRun = (breakBy) => {
  const v = level(build(SAMV), 200), b = bandit(700, ahead(3000, 200)), F = simOf(v), S = surfaceFrame(v.x, v.y, v.z); F.vessels = [v, b]; Combat.reset(F);
  b.vx = -S.east.x * 200; b.vy = -S.east.y * 200; b.vz = -S.east.z * 200; // (coming straight in)
  const fly = (h) => { b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h; aimAt(F, v, { x: b.x, y: b.y, z: b.z }); };
  const go = (secs) => run(F, secs, 1 / 120, (i, h) => { fly(h); if (i % 4 === 0) Aim.radarStep(v, F, 4 / 120); });
  fly(0); Aim.lockKey(v); go(1.5);
  const locked = Aim.lockTarget(v) === b;
  Combat.launchMissile(v, partOf(v, 'samCmd'), Aim.lockTarget(v), F);
  const s = Combat.S.shots[Combat.S.shots.length - 1]; go(1);
  const guided = !!s.clos && s.target === b;
  const mr = Math.random; Math.random = () => 0;
  if (breakBy === 'notch') { const r = EARTH.radius + 30, k = r / Math.hypot(b.x, b.y, b.z); b.x *= k; b.y *= k; b.z *= k; b.vx = S.north.x * 200; b.vy = S.north.y * 200; b.vz = S.north.z * 200; }
  else Combat.S.flares.push({ b: EARTH, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, t: 0, life: 5, chaff: true });
  let lostAt = null, dumbAt = null;
  run(F, 3, 1 / 120, (i, h) => { // (once lost, it stops looking: no new lock to pick the missile up again)
    fly(h); if (i % 4 === 0) Aim.radarStep(v, F, 4 / 120);
    if (lostAt == null && !Aim.lockTarget(v)) { lostAt = i * h; v.trk.on = false; }
    if (dumbAt == null && s.target === null) dumbAt = i * h;
  });
  Math.random = mr;
  return { locked, guided, lostAt: lostAt == null ? null : Math.round(lostAt * 100) / 100, dumbAt: dumbAt == null ? null : Math.round(dumbAt * 100) / 100 };
};
var cn = closRun('notch'), cc = closRun('chaff');`);
t('the command SAM rides its tracking radar\'s lock; dropping low across the beam (notching) breaks the lock after a second, and the missile flies on dumb a second later',
  R(`cn.locked && cn.guided && cn.lostAt >= 0.9 && cn.lostAt <= 1.4 && cn.dumbAt != null && cn.dumbAt - cn.lostAt >= 0.9 && cn.dumbAt - cn.lostAt <= 1.3`), R('cn'));
t('...and chaff by the target breaks the lock at once, the missile going dumb a second later',
  R(`cc.locked && cc.guided && cc.lostAt != null && cc.lostAt <= 0.15 && cc.dumbAt != null && cc.dumbAt - cc.lostAt >= 0.9 && cc.dumbAt - cc.lostAt <= 1.3`), R('cc'));
R(`var SAMIR = [{ type: 'hullLight', x: 0, y: 1.0, flip: false, rot: 0 }, { type: 'samIR', x: 0, y: 2.05, flip: false, rot: 3, att: 0 }];
var noDive = () => {
  const v = build(SAMIR); v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites.runway.east), 0);
  const F = simOf(v), p = partOf(v, 'samIR'), L = {}; F.groundAim = false; Combat.reset(F);
  Combat.launchMissile(v, p, null, F);
  const s = Combat.S.shots[Combat.S.shots.length - 1], clear = () => { Terrain.locate(EARTH, s.x, s.y, s.z, L); return L.r - EARTH.radius - Terrain.surfaceAt(EARTH, L.a, L.z); }, c0 = clear();
  let low = Infinity;
  for (let i = 0; i < 180 && Combat.S.shots.includes(s); i++) { Combat.step(1 / 120, F); F.time += 1 / 120; low = Math.min(low, clear()); }
  return { c0: Math.round(c0 * 100) / 100, low: Math.round(low * 100) / 100, alive: Combat.S.shots.includes(s), hot: s.coast === 0.05 && s.gt === 0.2, speed: Math.round(Math.hypot(s.vx, s.vy, s.vz)) };
};
var nd = noDive();`);
t('a missile fired level off a ground vehicle with no lock no longer dives into the runway: boosted out, a hot motor, then straight (1.5 s on, within 1 m of its launch height)',
  R(`nd.hot && nd.alive && nd.c0 > 1 && nd.low > nd.c0 - 1`), R('nd'));
R(`var AAG = [{ type: 'hullLight', x: 0, y: 1.0, flip: false, rot: 0 }, { type: 'ac35', x: 0, y: 1.725, flip: false, rot: 3, att: 0 }];
var av = level(build(AAG)), AF = simOf(av); Combat.reset(AF); Aim.fire(av, Combat.systems(av)[0], 1 / 120, AF); var vt = Combat.S.shots.find((s) => s.k === 'shell' && s.owner === av);`);
t('AA shells carry their proximity fuze (35 mm HE-VT: 4 m), as cheap rounds', R(`!!vt && vt.sh === 'hevt35' && vt.prox === 4 && vt.cheap`), R('vt && [vt.sh, vt.prox, vt.cheap]'));
{ // (armour.js flies them: the fuze itself)
  R(`var booms = [], EX = Combat.explode; Combat.explode = function (b, at) { booms.push({ x: at.x, y: at.y, z: at.z }); return EX.apply(this, arguments); };
  var proxRun = (off) => {
    const v = level(build(AAG)), F = simOf(v), SH = SHELLS.hevt35, D = 700, P = { x: v.x, y: v.y, z: v.z }, Sf = surfaceFrame(v.x, v.y, v.z);
    P.x += Sf.east.x * D; P.y += Sf.east.y * D; P.z += Sf.east.z * D;
    const b = bandit(300 + off, ahead(D)); F.vessels = [v, b]; Combat.reset(F); booms.length = 0;
    const sol = Aim.solve('hevt35', D, 0, EARTH, 300), ce = Math.cos(sol.el), se = Math.sin(sol.el);
    Combat.S.shots.push({ k: 'shell', sh: 'hevt35', b: EARTH, x: v.x, y: v.y, z: v.z, vx: (Sf.east.x * ce + Sf.up.x * se) * SH.v0, vy: (Sf.east.y * ce + Sf.up.y * se) * SH.v0, vz: (Sf.east.z * ce + Sf.up.z * se) * SH.v0,
      t: 0, life: 6, owner: v, enemy: false, net: 0, cal: 35, pen: 0, v0: SH.v0, spare: v, tracer: true, prox: 4, ric: false, gTop: Infinity, cheap: true });
    run(F, 1.5);
    return booms.some((q) => Math.hypot(q.x - b.x, q.y - b.y, q.z - b.z) < 4.5);
  };
  var px3 = proxRun(3.5), px6 = proxRun(7); Combat.explode = EX;`);
  t('the proximity fuze bursts an HE-VT shell passing 3.5 m from an aircraft, not one passing 7 m off', R('px3 && !px6'), R('[px3, px6]'));
}

// ---------------------------------------------------------------- smoke
R(`var sa = level(build(REAL)), sb = level(build(REAL), 300, ahead(800)); Combat.reset({});
var see0 = Aim.sees(sa, sb, { memo: false });
var mid = (a, b, up) => { const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, z = (a.z + b.z) / 2, r = Math.hypot(x, y, z); return { x: x + (x / r) * up, y: y + (y / r) * up, z: z + (z / r) * up }; };
var cloud = (P) => Combat.S.smoke.push({ b: EARTH, x: P.x, y: P.y, z: P.z, vx: 0, vy: 0, vz: 0, fly: 0.8, t: 5, r: 9, life: 25, fx: 0 });
cloud(mid(sa, sb, 1.5)); var see1 = Aim.sees(sa, sb, { memo: false }), see2 = Aim.sees(sa, sb, { memo: false, thermal: true }); Combat.reset({});`);
t('smoke hides one vehicle from another (Aim.sees), and a thermal sight still sees through it', R(`see0 && !see1 && see2`), R('[see0, see1, see2]'));
R(`var holdRun = (smoke) => {
  const v = level(build(ATGM)), F = simOf(v), S = surfaceFrame(v.x, v.y, v.z); Combat.reset(F);
  const far = (deg) => { const a = deg * RAD; return { x: v.x + (S.east.x * Math.cos(a) + S.north.x * Math.sin(a)) * 2000, y: v.y + (S.east.y * Math.cos(a) + S.north.y * Math.sin(a)) * 2000, z: v.z + (S.east.z * Math.cos(a) + S.north.z * Math.sin(a)) * 2000 }; };
  aimAt(F, v, far(0)); run(F, 1);
  Aim.fire(v, Combat.systems(v)[0], 1 / 120, F); const s = Combat.S.shots[Combat.S.shots.length - 1];
  run(F, 2);
  if (smoke) { const o = F.aim.o, d = F.aim.dir; cloud({ x: o.x + d.x * 150, y: o.y + d.y * 150, z: o.z + d.z * 150 }); }
  aimAt(F, v, far(5)); run(F, 2);
  return s.dx * S.north.x + s.dy * S.north.y + s.dz * S.north.z; // (how far it has turned to follow the line north)
};
var hold0 = holdRun(false), hold1 = holdRun(true);`);
t('smoke between the shooter and its wire-guided missile: it holds its last steering instead of following the line',
  R(`hold0 > Math.sin(2 * RAD) && Math.abs(hold1) < Math.sin(0.5 * RAD)`), R('[hold0, hold1]'));
R(`var irLock = (smoke) => {
  const v = level(build(SAMIR)), b = bandit(800, ahead(2000)), F = simOf(v); F.vessels = [v, b]; Combat.reset(F); v.wsel = 0;
  aimAt(F, v, { x: b.x, y: b.y, z: b.z });
  if (smoke) cloud(mid(v, b, 0));
  for (let i = 0; i < 60; i++) { Combat._t.playerFrame(F, 1 / 30); F.time += 1 / 30; }
  return Combat.S.lock === b;
};
var ir0 = irLock(false), ir1 = irLock(true);`);
t('an IR SAM locks on to a hot aircraft near the crosshair; smoke on the line hides it from the seeker', R(`ir0 && !ir1`), R('[ir0, ir1]'));
R(`var smv = build(REAL.concat([{ type: 'smokeL', x: 0.6, y: 2.6, flip: false, rot: 0, z: 1.55, att: 5 }]));
smv.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites.runway.east), 0); var SMF = simOf(smv); Combat.reset(SMF);
var smOk = Combat.countermeasures(smv, SMF), smN = Combat.S.smoke.length, smLeft = partOf(smv, 'smokeL').ammo; run(SMF, 4); var smR = Math.max.apply(null, Combat.S.smoke.map((c) => c.r)), smD = Combat.S.smoke.map((c) => Math.round(Math.hypot(c.x - smv.x, c.y - smv.y, c.z - smv.z)));
var smStatus = Combat.status(smv);`);
t('K (SMOKE) on a ground vehicle throws its launchers\' salvo: 3 grenades blooming 25-35 m out into clouds 9 m round',
  R(`smOk && smN === 3 && smLeft === 1 && near(smR, 9, 0.01) && smD.every((d) => d >= 22 && d <= 38) && smStatus.smoke === 1`), R('[smOk, smN, smLeft, smR, smD, smStatus.smoke]'));

// ---------------------------------------------------------------- the tracking radar's lock and the other player's warner
R(`var pidRun = () => {
  const v = level(build(SAMV), 200), b = bandit(900, ahead(3000, 200)), F = simOf(v), sent = []; Combat.reset(F);
  b.remote = 7;
  globalThis.MP = { enemyGhosts: () => [b], sendLock: (pid, on) => sent.push(pid + ':' + on), sendShot() {}, sendSmoke() {}, sendMissile() {}, sendFlares() {}, enemy: () => true,
    active: false, live: false, shared: false, peers: new Map(), rwr: null };
  Aim.lockKey(v); aimAt(F, v, { x: b.x, y: b.y, z: b.z });
  for (let i = 0; i < 60; i++) { Combat.frame(F, 1 / 30); F.time += 1 / 30; }
  const locked = Aim.lockPid(), ghost = Aim.lockTarget(v) === b;
  Aim.lockKey(v); for (let i = 0; i < 3; i++) { Combat.frame(F, 1 / 30); F.time += 1 / 30; }
  delete globalThis.MP;
  return { locked, ghost, sent: sent.join(' ') };
};
var pr = pidRun();`);
t('a tracking radar\'s lock on another player goes out through Combat.frame\'s lock line (lighting their warner), and so does letting go',
  R(`pr.ghost && pr.locked === 7 && /(^| )7:true/.test(pr.sent) && / ?0:false$/.test(pr.sent)`), R('pr'));

// ---------------------------------------------------------------- limits after a part is lost
R(`var lostRun = () => {
  const v = build(MAST), dep0 = Aim.limits(v), lim0 = v.tg[0].yawLim && [...v.tg[0].yawLim], SW = Aim.sweep; let sweeps = 0;
  Aim.sweep = function () { sweeps++; return SW.apply(this, arguments); };
  try {
    const mg = partOf(v, 'mgCoax'); v.parts = v.parts.filter((p) => p !== mg); for (const n of v.adj.get(mg.id) || []) v.adj.get(n) && v.adj.get(n).delete(mg.id); v.adj.delete(mg.id); v.rebuildGroups();
    const dep1 = Aim.limits(v), fresh = build(MAST), before = sweeps; Aim.limits(fresh);
    return { sweeps: before, dep: dep1 === dep0, lim: JSON.stringify(v.tg[0].yawLim && [...v.tg[0].yawLim]) === JSON.stringify(lim0), newTg: v._limTg === v.tg, freshSweeps: sweeps - before, n: v._limN === v.parts.length };
  } finally { Aim.sweep = SW; }
};
var lr = lostRun();`);
t('a part shot off: the turret\'s limits carry over (what is left can only turn as far or further) with no new sweep, a 5-15 ms hitch mid-fight; a new craft still sweeps',
  R(`lr.sweeps === 0 && lr.dep && lr.lim && lr.newTg && lr.n && lr.freshSweeps > 0`), R('lr'));

t.done();
