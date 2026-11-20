// The ships update, WP6 (spec §4.4, §4.5, §4.8, §4.12): propulsion, foils, decks and collisions. §drive: outboards (a
// RIB planes), waterjets (they turn and reverse), a jet boat, a hydrofoil flying on her ride control, a ship with wings;
// §contact: two ships colliding, ramming a carrier, a grounding's hull holed and kept, slams, tiny pieces; §decks: a
// helicopter landing on a ship's deck under way, lashed, and lifting off; §cross: an amphibious tank with a hull, a
// flying boat on pontoons. Until the catalogue package (WP5) lands, the parts are test-only defs with §6's field names
// (a stock template is used instead where one exists). §gates: old craft unchanged; costs.
//   node test/ships-drive.test.js
const G = require('./lib/game.js');
const ctx = G.load({ combat: true, flight: true });
const R = (c) => G.run(ctx, c);
const t = G.checks('ships: §drive, §contact, §decks, §cross (WP6)');
const D = 180 / Math.PI, KN = 1.943844;

// ---------------------------------------------------------------- the stand-ins
R(`var fsim = (v, list) => Object.assign(${'(' + G.sim.toString() + ')()'}, { active: v, vessels: list || [v], running: true });
var bad = (v) => ![v.x, v.y, v.z, v.vx, v.vy, v.vz, v.q.w, v.q.x, v.q.y, v.q.z, v.av.x, v.av.y, v.av.z].every(Number.isFinite);
var kn = (v) => v.speed() * ${KN};
var fwd = (v) => { const b = qunrot(v.q, v.vx, v.vy, v.vz); return v.sh ? b.x * v.sh.ax.x + b.y * v.sh.ax.y : b.x; };
var alt = (v) => v.radius() - EARTH.radius;
// a craft from design rows ([type, x, y, rot, { z, att }]), only its control part's piece, launched at a sea spot (east
// of the pad, z, yaw) when it floats, or put there
var build = (rows, kind, place) => { rows = rows.map((r) => Array.isArray(r) ? { type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: r[1] < 0, ...(r[4] || {}) } : { ...r });
  const parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
  const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const v = new Vessel(ps, adj, EARTH); v.kind = kind; v.name = kind; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups(); v.of = parts.length;
  const P = place || { e: EARTH.sites.bay.east, z: 0, yaw: 0 };
  v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), VEHICLE_KINDS[kind].launchRot, P.z || 0, P.yaw || 0);
  if (v.hydro) v.launchedAt = Ship.launch(v, P);
  return v; };
var tpl = (k) => templateRows(TEMPLATES[k]).map((r) => ({ ...r }));
var stageAll = (v) => { while (v.stageIdx < v.stages.length) { for (const id of v.stages[v.stageIdx] || []) { const p = v.byId.get(id); if (p && p.def.thrust) p.active = true; } v.stageIdx++; } };`);
// the physics ticks as flight.js's physicsTick runs them (lashed craft after the rest), Ship.frame as Combat.frame calls
// it (every fourth step)
R(`var tick = (F, secs, each) => { const n = Math.round(secs * 120); for (let i = 0; i < n; i++) { if (each && each(i / 120, i) === false) return i; let lashed = null;
  for (const v of F.vessels.slice()) { if (v.dead) continue; if (v.lash) { (lashed || (lashed = [])).push(v); continue; } if (v.moored && v !== F.active) { Ship.drift(v, 1 / 120, F); continue; } v.physicsStep(1 / 120, F); }
  if (lashed) for (const v of lashed) Ship.lashStep(v, 1 / 120, F);
  F.time += 1 / 120; if (i % 4 === 0) Combat.frame(F, 4 / 120); } return n; };`);
// test-only parts with §6's field names, under their §6 keys' names with a 'tst' in front (WP5's catalogue replaces them)
R(`var T6 = {
  tstRib: { gv: true, ship: true, family: 'Boats', place: 'keel', cat: 'shHull', name: 'RIB Hull', w: 9, h: 1.6, depth: 3.2, mass: 2.2, shape: 'shull', hull: true, hp: 500, breakSpeed: 5, tier: 1, cost: 1200,
    shull: { cls: 'one', wl: -0.3, st: [[-4.5, .6, -.55, 1.6, 1.45, 1.0], [-1, .65, -.62, 1.6, 1.5, .9], [2, .7, -.45, 1.35, 1.1, .9], [3.8, .75, -.05, .75, .45, 1.0], [4.5, .8, .35, .15, .05, 1]],
      ends: { aft: 'closed', fore: 'closed' }, plane: true, tubes: true, k: 0.12 } },
  tstConsole: { gv: true, ship: true, place: 'deck', cat: 'shSuper', name: 'Helm Console', w: 1.2, h: 1.4, depth: 1.0, mass: 0.3, control: 1, shape: 'tkit', hp: 200, tier: 1, cost: 600,
    mods: [{ k: 'crew', role: 'driver', at: [0.3, 0, -0.2], r: 0.4, hp: 100 }, { k: 'crew', role: 'commander', at: [0.3, 0, 0.2], r: 0.4, hp: 100 }] },
  tstOutboard: { gv: true, ship: true, place: 'stern', cat: 'shDrive', name: 'Outboard Motor', w: 0.8, h: 1.6, depth: 0.6, mass: 0.35, shape: 'tkit', hp: 150, tier: 1, cost: 1200,
    engine: { kw: 165, fuel: 'petrol', spool: 2 }, screw: { D: 0.36, eta: 0.6 }, steer: 30 },
  tstJet: { gv: true, ship: true, place: 'stern', cat: 'shDrive', name: 'Waterjet', w: 3, h: 1.4, depth: 1.4, mass: 4, shape: 'tkit', hp: 600, tier: 1, cost: 2500, jet: { D: 1.4, steer: 30, bucket: 0.5 } },
  tstJetS: { gv: true, ship: true, place: 'stern', cat: 'shDrive', name: 'Small Waterjet', w: 1, h: 0.6, depth: 0.6, mass: 0.4, shape: 'tkit', hp: 200, tier: 1, cost: 900, jet: { D: 0.45, steer: 30, bucket: 0.5 } },
  tstDieselS: { gv: true, ship: true, place: 'inside', cat: 'shDrive', name: 'Small Marine Diesel', w: 1.6, h: 1.0, depth: 0.9, mass: 1.2, shape: 'tkit', inner: true, flush: true, module: 'engine', hp: 300, tier: 1, cost: 800,
    engine: { kw: 300, fuel: 'diesel' } },
  tstTurbine: { gv: true, ship: true, place: 'inside', cat: 'shDrive', name: 'Gas Turbine', w: 8, h: 3, depth: 3, mass: 22, shape: 'tkit', inner: true, flush: true, module: 'engine', hp: 2500, tier: 2, cost: 4000,
    engine: { kw: 20000, fuel: 'turbine', spool: 15 } },
  tstFoilBow: { gv: true, ship: true, place: 'bow', cat: 'shDrive', name: 'Bow Hydrofoil', w: 2, h: 3.6, depth: 6, mass: 4, shape: 'tkit', hp: 500, tier: 2, cost: 3000,
    foil: { kind: 'foil', n: 'y', area: 7, ar: 5, chord: 1.2, inc: 2, y: -1.6, ride: true, max: 8, load: 1500 } },
  tstFoilAft: { gv: true, ship: true, place: 'keel', cat: 'shDrive', name: 'Main Hydrofoil', w: 2.4, h: 3.6, depth: 12, mass: 9, shape: 'tkit', hp: 900, tier: 2, cost: 5000,
    foil: { kind: 'foil', n: 'y', area: 15, ar: 6, chord: 1.6, inc: 2, y: -1.6, ride: true, intake: true, h: 1.6, struts: 2, load: 3500 } },
  tstPad: { gv: true, ship: true, place: 'deck', cat: 'shSuper', name: 'Helicopter Deck', w: 12, h: 0.4, depth: 7, mass: 3, shape: 'tkit', hp: 2500, tier: 1, cost: 1500, deck: { hl: 5.8, hw: 3.4 } },
  tstPontoon: { gv: true, ship: true, family: 'Boats', place: 'keel', cat: 'shHull', name: 'Float', w: 6, h: 0.9, depth: 0.9, mass: 0.25, shape: 'shull', hull: true, hp: 300, breakSpeed: 4, tier: 1, cost: 400,
    shull: { cls: 'one', wl: -0.1, st: [[-3, .45, .15, .15, .12, 1], [-.6, .45, -.3, .42, .4, 1.4], [0, .45, -.42, .45, .44, 1.4], [.05, .45, -.32, .45, .44, 1.4], [2.3, .45, -.3, .43, .42, 1.4], [3, .45, .25, .1, .05, 1]],
      ends: { aft: 'closed', fore: 'closed' }, plane: true, step: 0.03, k: 0.1 } },
  tstWeight: { gv: true, ship: true, place: 'inside', cat: 'shKit', name: 'Test weight (crew, fuel, gear)', w: 1.2, h: 0.4, depth: 1.2, mass: 0.4, shape: 'tkit', inner: true, hp: 300, tier: 1, cost: 1 },
  tstBallast: { gv: true, ship: true, place: 'inside', cat: 'shKit', name: 'Fuel and Ballast (×5)', w: 3, h: 0.8, depth: 2.5, mass: 50, shape: 'tkit', inner: true, flush: true, hp: 2000, tier: 1, cost: 100 },
  tstAmph: { gv: true, ship: true, place: 'keel', cat: 'shHull', name: 'Test amphibious hull', w: 6.4, h: 1.8, depth: 2.4, mass: 1, shape: 'shull', hull: true, hp: 2000, breakSpeed: 6, tier: 1, cost: 1,
    shull: { cls: 'one', wl: 0, st: [[-3.2, .9, -.7, 1.2, 1.2, 6], [-2.6, .9, -.9, 1.2, 1.2, 6], [2.6, .9, -.9, 1.2, 1.2, 6], [3.2, .9, -.3, 1.2, 1.1, 4]], ends: { aft: 'closed', fore: 'closed' }, k: 0.3, cw: 2.5 } },
};
for (const k in T6) if (!PARTS[k]) { PARTS[k] = T6[k]; PARTS[k].type = k; PARTS[k].maxTemp = 2000; }
// the stock key where WP5's catalogue has it, else the test one
var K = (k) => PARTS[k] && !PARTS[k].test ? k : 'tst' + k[0].toUpperCase() + k.slice(1);
var has = (k) => !!PARTS[k];`);

// ================================================================ §drive
// 1. A RIB on two outboards (the Zodiak's: a 9 m deep-V hull, a console, 2 × 165 kW): she climbs onto the plane, trims
// bow-up 2-6°, half her hull out of the water, at about 40 kn; the outboards turn her (they turn whole with the helm)
R(`var ribRows = () => TEMPLATES.zodiak ? tpl('zodiak') : [['tstRib', 0, 0], ['tstConsole', -1.5, 1.35, 0, { att: 0 }], ['tstWeight', -3, 0.2, 0, { att: 0 }], ['tstOutboard', -4.9, -0.45, 0, { z: -0.5, att: 0 }], ['tstOutboard', -4.9, -0.45, 0, { z: 0.5, att: 0 }]];
var rib = build(ribRows(), 'ship', { e: -2300, z: 0, yaw: 0 }), ribF = fsim(rib); Ship.setSea('calm');`);
{
  const s0 = R(`({ ok: !!rib.launchedAt && rib.launchedAt.ok, n: rib.parts.length, scr: rib.sh.scr.map((s) => s.kind), rud: rib.sh.rudders.length, mass: rib.mass, draft: (Ship.forces(rib, 1 / 120, v3(), v3(), ribF), rib.draft) })`);
  t(`the RIB (${(s0.mass / 1000).toFixed(1)} t) floats at her marks (${s0.draft.toFixed(2)} m); her outboards are thrusters of their own and steer`, s0.ok && s0.scr.join() === 'outboard,outboard' && s0.rud === 2 && s0.draft > 0.2 && s0.draft < 0.8, s0);
  // (her running trim and immersion: their means over the last 10 s, as the trials' are: at 42 kn in a calm sea's chop she
  // bounces, her bow rising and falling a few degrees a second, so one instant says little)
  R(`rib.sh.tel = 4; var rs = [], rm = { n: 0, trim: 0, wet: 0, fsub: 0 }; tick(ribF, 40, (tt, i) => { if (i % 240 === 0) rs.push(+kn(rib).toFixed(1)); if (tt >= 30) { rm.n++; rm.trim += -rib.trim * ${D}; rm.wet += rib.sh.Vol; rm.fsub += rib.sh.fsub; } });
  var ribA = { kn: kn(rib), trim: rm.trim / rm.n, fsub: rm.fsub / rm.n, wet: rm.wet / rm.n, vol: shullOf(rib.sh.hulls[0].def).vol, B: rib.sh.B };`);
  const a = R('ribA'), rs = R('rs');
  t(`...Flank: she planes at ${a.kn.toFixed(1)} kn (34-46) trimmed ${a.trim.toFixed(1)}° bow-up (2-6°), her immersed volume ${a.wet.toFixed(2)} m³: under half of the ${(a.vol).toFixed(1)} m³ hull and under half her weight's still-water displacement (${(s0.mass / 1025).toFixed(2)} m³)`,
    a.kn > 34 && a.kn < 46 && a.trim > 2 && a.trim < 6 && a.wet < 0.5 * (s0.mass / 1025), { a, rs });
  R(`rib.ctl.h = 1; var rt = []; tick(ribF, 10, (tt, i) => { if (tt > 4 && i % 60 === 0) rt.push(-dot3(rib.av, rib.sh.U)); }); rib.ctl.h = 0;`);
  const r = R('rt.reduce((a, b) => a + b, 0) / rt.length'), rud = R('rib.sh.rudders.map((p) => p.rud)');
  const Dl = (2 * R('rib.speed()')) / r / 9;
  t(`...the outboards turned 30° to starboard turn her to starboard at ${(r * D).toFixed(1)}°/s (a circle ${Dl.toFixed(0)} lengths across at ${R('kn(rib)').toFixed(0)} kn)`, r * D > 3 && rud.every((x) => x > 25), { r: r * D, rud, Dl });
}

// 2. A waterjet boat (a RIB with one waterjet on a small diesel): ahead, she turns with the nozzle; astern, the bucket
// throws her back
R(`var wjRows = () => [['tstRib', 0, 0], ['tstConsole', -0.5, 1.35, 0, { att: 0 }], ['tstDieselS', -2.5, -0.1, 0, { att: 0 }], ['tstJetS', -4.7, -0.45, 0, { att: 0 }]];
var wj = build(wjRows(), 'ship', { e: -2300, z: 400, yaw: 0 }), wjF = fsim(wj);`);
{
  R(`wj.sh.tel = 4; tick(wjF, 30); var wjA = { kn: kn(wj), T: wj.sh.T, kind: wj.sh.scr[0].kind };`);
  const a = R('wjA');
  t(`a waterjet boat on 300 kW makes way: ${a.kn.toFixed(1)} kn at Flank (over 15)`, a.kind === 'jet' && a.kn > 15, a);
  R(`wj.ctl.h = -1; var wt = []; tick(wjF, 10, (tt, i) => { if (tt > 4 && i % 60 === 0) wt.push(-dot3(wj.av, wj.sh.U)); }); wj.ctl.h = 0; var wjR = wt.reduce((a, b) => a + b, 0) / wt.length;`);
  t(`...its nozzle turned to port turns her to port at ${(R('wjR') * D).toFixed(1)}°/s`, R('wjR') * D < -5, R('wjR') * D);
  R(`wj.sh.tel = -3; var wb = []; tick(wjF, 40, (tt, i) => { if (i % 480 === 0) wb.push(+fwd(wj).toFixed(2)); });`);
  const b = R('wb'), back = R('fwd(wj)');
  t(`...astern, the bucket stops her and drives her backwards (${b.join(' → ')} → ${back.toFixed(2)} m/s along her bow)`, back < -0.5, b);
}

// 3. A jet boat (an airboat): a turbojet on a RIB pushes her through the water as it does anything (the telegraph opens
// its throttle)
{
  R(`Ship.setSea('calm'); var jb = build([['tstRib', 0, 0], ['tstConsole', -0.5, 1.35, 0, { att: 0 }], ['jetS', -2.5, 1.1, 3, { att: 0 }], ['tankS', -0.4, 0.0, 0, { att: 2 }]], 'ship', { e: -2300, z: 800, yaw: 0 }), jbF = fsim(jb);
  stageAll(jb); jb.sh.tel = 1; var jbH = 0, jbS = []; tick(jbF, 30, (tt, i) => { if (tt > 10) jbH = Math.max(jbH, Math.abs(jb.heel), Math.abs(jb.trim)); if (i % 240 === 0) jbS.push([+kn(jb).toFixed(0), +(jb.trim * ${D}).toFixed(1), +(jb.heel * ${D}).toFixed(1)]); });`);
  const a = R(`({ kn: kn(jb), thr: jb.throttle, fwd: fwd(jb), afloat: jb.afloat, alt: alt(jb), T: jb.thrust, tilt: jbH * ${D}, run: jbS })`);
  // (at Half and over its 45 kN, over half the 4 t boat's weight, has her leaping and flipping; at Slow, past 50 kn, she
  // chine-walks, rolling 20-40° from side to side: a jet boat's own chaos)
  t(`a jet boat: a Small Turbojet on a RIB, at Slow on the telegraph (a quarter throttle), drives her at ${a.kn.toFixed(1)} kn, afloat, never over (at most ${a.tilt.toFixed(1)}° of heel or trim)`, a.kn > 20 && a.fwd > 0 && a.thr === 0.25 && a.afloat && Math.abs(a.alt) < 3 && a.tilt < 60, a);
}
// 4. A hydrofoil (the Pegazus where WP5 has her; else a stand-in: a 40 m patrol hull, a 20 MW gas turbine, one waterjet,
// a bow foil whose strut steers and a main foil on two struts with the jet's intake in its pod, 200 t): hullborne she
// gathers way; past 17 kn her foils climb, at about 30 kn her hull leaves the water; foilborne in a Moderate sea she flies
// level at her ride height for 120 s, faster than 30 kn; hard over at Half she banks into the turn
R(`var pgRows = () => TEMPLATES.pegazus ? tpl('pegazus') : [['hbSternM', -17, 0], ['hbMidM', -10, 0], ['hbMidM', -2, 0], ['hbMidM', 6, 0], ['hbBowM', 15, 0.3], ['bridgeM', 5, 3.5, 0, { att: 3 }],
  ['tstTurbine', -10, -0.2, 0, { att: 1 }], ['tstFoilBow', 12, -3.8, 0, { att: 4 }], ['tstFoilAft', -6, -3.8, 0, { att: 2 }], ['tstJet', -21.5, -1.4, 0, { att: 0 }], ['tstBallast', -2, -1.2, 0, { att: 2 }]];
Ship.setSea('moderate'); var pg = build(pgRows(), 'ship', { e: -2300, z: -1500, yaw: Math.PI }), pgF = fsim(pg);`);
{
  const s0 = R(`({ ok: !!pg.launchedAt && pg.launchedAt.ok, mass: pg.mass, ride: !!pg.sh.ride, halves: pg.sh.fl.filter((o) => o.ride).length, struts: pg.sh.fl.filter((o) => o.strut).length, jets: pg.sh.scr.filter((s) => s.kind === 'jet').length })`);
  t(`the hydrofoil (${(s0.mass / 1000).toFixed(0)} t) launches afloat; each ride foil flies as two halves on its strut(s), her waterjet drinks through the main foil`, s0.ok && s0.ride && s0.halves === 4 && s0.struts === 2 && s0.jets >= 1, s0);
  R(`pg.sh.tel = 4; var up = null, tk = []; tick(pgF, 60, (tt, i) => { if (up == null && pg.sh.fsub < 0.01) up = kn(pg); if (i % 600 === 0) tk.push([+tt.toFixed(0), +kn(pg).toFixed(1), +pg.sh.fsub.toFixed(2), +pg.sh.ride.c.toFixed(2)]); });`);
  const up = R('up');
  t(`...her hull leaves the water at ${up && up.toFixed(1)} kn (25-40) as her foils lift her`, up > 25 && up < 40, R('tk'));
  R(`var fly = { n: 0, hull: 0, vmin: 1e9, trim: 0, heel: 0, cmin: 1e9, cmax: -1e9, nan: false, hd: [] }; tick(pgF, 120, (tt, i) => { if (bad(pg)) { fly.nan = true; return false; }
    fly.n++; if (pg.sh.fsub > 0.02) fly.hull++; fly.vmin = Math.min(fly.vmin, kn(pg)); fly.trim = Math.max(fly.trim, Math.abs(pg.trim)); fly.heel = Math.max(fly.heel, Math.abs(pg.heel));
    fly.cmin = Math.min(fly.cmin, pg.sh.ride.c); fly.cmax = Math.max(fly.cmax, pg.sh.ride.c); if (i % 1200 === 0) fly.hd.push(Ship.heading(pg, pg.sh) * ${D}); });`);
  const f = R('fly'), dh = Math.max(...f.hd.map((h) => Math.abs(((h - f.hd[0] + 540) % 360) - 180)));
  t(`...foilborne 120 s in a Moderate sea: never under ${f.vmin.toFixed(0)} kn (over 30), her hull in the water ${((100 * f.hull) / f.n).toFixed(1)} % of the time (under 2 %), trim within ${(f.trim * D).toFixed(1)}° and heel ${(f.heel * D).toFixed(1)}° (under 3° and 5°), her keel ${f.cmin.toFixed(2)}-${f.cmax.toFixed(2)} m over the waves, her heading held within ${dh.toFixed(1)}°`,
    !f.nan && f.vmin > 30 && f.hull / f.n < 0.02 && f.trim * D < 3 && f.heel * D < 5 && f.cmin > 0.5 && f.cmax < 3.5 && dh < 3 && R('pg.parts.length') === R('pg.of'), f);
  R(`pg.sh.tel = 2; tick(pgF, 30); var tv = kn(pg); pg.ctl.h = 1; var bank = [], rr = []; tick(pgF, 25, (tt, i) => { if (tt > 8 && i % 60 === 0) { bank.push(pg.heel); rr.push(-dot3(pg.av, pg.sh.U)); } }); pg.ctl.h = 0;`);
  const bank = R('bank.reduce((a, b) => a + b, 0) / bank.length') * D, rr = R('rr.reduce((a, b) => a + b, 0) / rr.length') * D;
  t(`...at Half (${R('tv').toFixed(0)} kn) hard over: she turns to starboard at ${rr.toFixed(1)}°/s banked ${bank.toFixed(1)}° into the turn (her ride control's bank, 8° at full rudder), still foilborne`,
    rr > 1 && bank > 4 && bank < 12 && R('pg.sh.fsub') < 0.05 && R('pg.parts.length') === R('pg.of'), { bank, rr, fsub: R('pg.sh.fsub') });
  // slowed to Slow: she comes down onto her hull, and lifts again rung up
  R(`pg.sh.tel = 0; tick(pgF, 60); var dn = { kn: kn(pg), fsub: pg.sh.fsub, on: pg.sh.ride.on };`);
  const dn = R('dn');
  t(`...stopped, she settles back onto her hull (${dn.kn.toFixed(1)} kn, her hull carrying ${(dn.fsub * 100).toFixed(0)} % of her)`, dn.fsub > 0.8 && dn.kn < 15, dn);
}

// 5. A ship with stubby wings (the owner's rule): two Large Wings on the Cyclon at Flank lift under 30 % of her weight;
// she stays on the water (a wing's lift is real: a ship never flies them)
{
  R(`Ship.setSea('calm'); var wg = build([...tpl('cyclon'), ['wingL', -4, 2.4, 3, { att: 1 }], ['wingL', 4, 2.4, 3, { att: 2 }]], 'ship', { e: -2300, z: 1200, yaw: Math.PI }), wgF = fsim(wg);
  wg.sh.tel = 4; var wl = { lift: 0, alt: 0, afloat: true }; tick(wgF, 90, (tt) => { if (tt > 30) { wl.lift = Math.max(wl.lift, wg.lift); wl.alt = Math.max(wl.alt, alt(wg)); wl.afloat = wl.afloat && wg.afloat; } });`);
  const w = R(`({ ...wl, W: wg.mass * EARTH.mu / Math.hypot(wg.x, wg.y, wg.z) ** 2, kn: kn(wg), wings: wg.wings.length, air: wg.aircraft })`);
  t(`a ship with two Large Wings at ${w.kn.toFixed(0)} kn: their lift at most ${((100 * w.lift) / w.W).toFixed(1)} % of her weight (under 30 %), afloat all the way, never flying`, w.wings === 2 && !w.air && w.lift / w.W < 0.3 && w.afloat && w.alt < 3, w);
}

// ================================================================ §contact
// 6. Two ships collide: a Cyclon at 6 m/s rams another broadside on: they bounce (no NaN, no deep overlap after), the
// rammed one is pushed away, each side's touching hull part is hurt and holed (Ship.addHoles: the damage package's hook)
{
  R(`Ship.setSea('calm'); var HO = []; { const f0 = Ship.addHoles; Ship.addHoles = function (v, h) { HO.push([v.name, h.length, h[0] && h[0][0].type, h[0] && +h[0][3].toFixed(3)]); return f0.apply(this, arguments); }; }
  var ca = build(tpl('cyclon'), 'ship', { e: -2400, z: -400, yaw: 0 }), cb = build(tpl('cyclon'), 'ship', { e: -2340, z: -400, yaw: Math.PI / 2 }), cF = fsim(ca, [ca, cb]); ca.name = 'A'; cb.name = 'B';
  { const f = qrot(ca.q, 1, 0, 0); ca.vx = f.x * 6; ca.vy = f.y * 6; ca.vz = f.z * 6; }
  var hp0 = (v) => v.parts.filter((p) => p.def.shull).reduce((s, p) => s + (p.hp == null ? p.def.hp : p.hp), 0), ha = hp0(ca), hb = hp0(cb), col = { nan: false, deep: 0, t: null, vb: 0 };
  var ins = (A, B) => { let m = 0; for (const g of B.sh.rings) for (const i of [6, 7, 8, 9]) { const W = B.toWorld(g.P[3 * i], g.P[3 * i + 1], g.P[3 * i + 2]), L = A.toLocal(W.x, W.y, W.z), h = Ship.insideHull(A, L); if (h) m = Math.max(m, h.pen); } return m; };
  tick(cF, 20, (tt, i) => { if (bad(ca) || bad(cb)) { col.nan = true; return false; } if (i % 4 === 1) { const d = Math.max(ins(ca, cb), ins(cb, ca)); col.deep = Math.max(col.deep, d); if (d > 0 && col.t == null) col.t = tt; } col.vb = Math.max(col.vb, cb.speed()); });`);
  const c = R(`({ ...col, end: Math.max(ins(ca, cb), ins(cb, ca)), va: fwd(ca), dA: ha - hp0(ca), dB: hb - hp0(cb), parts: [ca.parts.length, cb.parts.length], HO, broken: cF.broken })`);
  t(`two ships collide (6 m/s, broadside on at ${c.t && c.t.toFixed(1)} s): no NaN, they bounce apart (the rammer's way along her bow ${c.va.toFixed(2)} m/s after, the rammed one pushed to ${c.vb.toFixed(2)} m/s), at most ${c.deep.toFixed(2)} m into each other and clear at the end`,
    !c.nan && c.t != null && c.va < 3 && c.vb > 1 && c.deep < 1.5 && c.end < 0.05, c);
  t(`...each side's touching hull part hurt (${c.dA.toFixed(0)} and ${c.dB.toFixed(0)} hp) and holed (the hook called: ${c.HO.length} times), nothing torn off`, c.dA > 100 && c.dB > 100 && c.HO.some((h) => h[0] === 'A') && c.HO.some((h) => h[0] === 'B') && c.parts.join() === '11,11', c);
}

// 7. Ramming a carrier: a Cyclon at 4 m/s into Carrier West's side stops against it (the carrier's hull a box from its
// deck to 9 m under the sea: immovable), and never passes into it
{
  R(`var cv = build(tpl('cyclon'), 'ship', { e: -7000, z: 2500 + 18 + 30, yaw: Math.PI / 2 }), cvF = fsim(cv); var C0 = EARTH.carriers.west;
  { const f = qrot(cv.q, 1, 0, 0); cv.vx = f.x * 4; cv.vy = f.y * 4; cv.vz = f.z * 4; }
  var zOf = (v) => Terrain.locate(EARTH, v.x, v.y, v.z).z, rm = { zmin: 1e9, nan: false, hit: null };
  tick(cvF, 25, (tt) => { if (bad(cv)) { rm.nan = true; return false; } const z = zOf(cv); rm.zmin = Math.min(rm.zmin, z); if (rm.hit == null && fwd(cv) < 2) rm.hit = tt; });`);
  const r = R(`({ ...rm, v: fwd(cv), side: C0.z + C0.hw, bow: cv.sh.x1 - cv.com.x, parts: cv.parts.length })`);
  t(`ramming a carrier at 4 m/s: she stops against its side (her way ${r.v.toFixed(2)} m/s after), her bow never past it (her centre ${(r.zmin - r.side).toFixed(1)} m off its side, her bow ${r.bow.toFixed(1)} m ahead of it), no NaN`,
    !r.nan && r.hit != null && r.v < 0.5 && r.zmin - r.side > r.bow - 1.2 && r.parts === 11, r);
}

// 8. Groundings and slams hole a hull and keep it (Ship.impactSea, Death.impact's first line for a hydro vessel): a hull
// part past its crash limit takes 40 % of its hp and a hole of 0.02 m² for each m/s over; past twice its limit it goes;
// what isn't hull breaks as ever. A RIB dropped flat from 6 m slams: holed, not shattered
{
  R(`var gi = build(tpl('cyclon'), 'ship', { e: -2300, z: 1600, yaw: 0 }), giF = fsim(gi), HO2 = []; { const f0 = Ship.addHoles; Ship.addHoles = function (v, h) { HO2.push(h[0][3]); return f0.apply(this, arguments); }; }
  var bow = gi.parts.find((p) => p.type === 'hbBowM'), br = gi.parts.find((p) => p.type === 'bridgeM');
  gi._bedHit = new Map([[bow, { r: 1.3, s: 15.6, lim: 12, x: 14, y: -1 }]]); var out1 = Ship.impactSea(gi, [bow, br], giF), bowHp = bow.hp;
  gi._bedHit = new Map([[bow, { r: 2.4, s: 28.8, lim: 12, x: 14, y: -1 }]]); var out2 = Ship.impactSea(gi, [bow], giF);`);
  const g = R(`({ out1: out1.map((p) => p.type), hp: bowHp, max: bow.def.hp, holes: HO2.slice(), out2: out2.map((p) => p.type) })`);
  t(`a grounding past the bow's limit: it is kept, takes ${(100 - (100 * g.hp) / g.max).toFixed(0)} % of its hp and a ${g.holes[0] && g.holes[0].toFixed(3)} m² hole; the wheelhouse breaks as ever; past twice its limit the bow goes`,
    g.out1.join() === 'bridgeM' && Math.abs(g.hp / g.max - 0.6) < 0.01 && Math.abs(g.holes[0] - 0.072) < 1e-6 && g.out2.join() === 'hbBowM', g);
  R(`var dr = build(ribRows(), 'ship', { e: -2300, z: 2000, yaw: 0 }), drF = fsim(dr); { const r = dr.radius(), k = (r + 6) / r; dr.x *= k; dr.y *= k; dr.z *= k; } HO2.length = 0;
  var drHull = dr.parts.find((p) => p.def.shull); tick(drF, 6);`);
  const d = R(`({ holes: HO2.slice(), hp: drHull.hp, max: drHull.def.hp, n: dr.parts.length, of: dr.of, afloat: dr.afloat, broken: drF.broken })`);
  t(`...a RIB dropped flat from 6 m slams into the sea: her hull holed (${d.holes.length}) and hurt (${d.hp && d.hp.toFixed(0)} of ${d.max} hp), kept, afloat`, d.holes.length >= 1 && d.hp < d.max && d.n === d.of && d.afloat, d);
}

// 9. Tiny pieces: a piece of a ship with no hull and under 200 kg floats as a box (a crate of 100 kg on 0.6 m³); after
// SEA.float s adrift with nobody in it, it is junk and sinks; a heavy one sinks at once (§hydro 10 has the wheelhouse)
{
  R(`PARTS.tstCrate = { name: 'Test crate', cat: 'shKit', w: 1, h: 0.6, depth: 1, mass: 0.1, shape: 'tkit', tier: 1, cost: 1, type: 'tstCrate', maxTemp: 2000 };
  var crP = [makePart('tstCrate', 0, 0)], cr = new Vessel(crP, new Map([[crP[0].id, new Set()]]), EARTH); cr.kind = 'ship'; cr.stages = []; cr.hydroFrom = true; cr.rebuildGroups();
  cr.placeOnSurface(EARTH, siteAngle(EARTH, -2300), 0, 2400, 0); var crF = fsim(cr), ct = { a10: 0, af: false }; tick(crF, 10); ct.a10 = alt(cr); ct.af = cr.afloat; tick(crF, 30); ct.a40 = alt(cr); ct.sc = !!cr.sh.scuttle; ct.n = !!(cr.hydro && cr.sh && !cr.sh.rings.length);`);
  const c = R('ct');
  t(`a tiny piece (a 100 kg crate, no hull) floats as a box (${c.a10.toFixed(2)} m at 10 s, afloat); left adrift it is junk after 15 s and sinks (${c.a40.toFixed(1)} m at 40 s)`, c.n && c.af && Math.abs(c.a10) < 0.5 && c.sc && c.a40 < -3, c);
}

// ================================================================ §decks
// 10. A helicopter lands on a ship's deck under way: a Cyclon with a helicopter deck aft steams at about 15 kn in a
// Moderate sea; the Dragonfly, set down on the deck from just over it at her speed, rests there, is lashed within 2 s,
// rides her 60 s (its place on the deck kept), then lifts off at full throttle
{
  R(`Ship.setSea('moderate'); var dk = build([...tpl('cyclon'), ['tstPad', -10, 2.2, 0, { att: 1 }]], 'ship', { e: -2300, z: -2600, yaw: Math.PI }), dkF = fsim(dk); dk.sh.tel = 1; tick(dkF, 60); var dkV = kn(dk);
  var hl = build(tpl('dragonfly'), 'heli', { e: -2300, z: -2600, yaw: Math.PI }), hc = alt(hl);
  Combat.frame(dkF, 1 / 30); var pad = dk.parts.find((p) => p.type === 'tstPad'), P = dk.toWorld(pad.x, pad.y + pad.def.h / 2, 0), U = norm3(v3(P.x, P.y, P.z));
  hl.x = P.x + U.x * (hc + 0.4); hl.y = P.y + U.y * (hc + 0.4); hl.z = P.z + U.z * (hc + 0.4); { const dv = dk.pointVel(v3(hl.x - dk.x, hl.y - dk.y, hl.z - dk.z)); hl.vx = dv.x; hl.vy = dv.y; hl.vz = dv.z; } hl.av = v3(dk.av.x, dk.av.y, dk.av.z);
  stageAll(hl); hl.throttle = 0; dkF.vessels.push(hl); dkF.active = hl; var lashAt = null, X0 = null, hd = { nan: false, drift: 0, broken: null };
  tick(dkF, 5, (tt) => { if (hl.lash && lashAt == null) { lashAt = tt; } });
  X0 = dk.toLocal(hl.x, hl.y, hl.z); tick(dkF, 60, (tt) => { if (bad(hl) || bad(dk)) { hd.nan = true; return false; } const X = dk.toLocal(hl.x, hl.y, hl.z); hd.drift = Math.max(hd.drift, Math.hypot(X.x - X0.x, X.y - X0.y, X.z - X0.z)); if (!hl.lash && hd.off == null) hd.off = tt; });`);
  const h = R(`({ ...hd, kn: dkV, lashAt, lashed: !!hl.lash, parts: hl.parts.length, of: hl.of, broken: dkF.broken.slice(), X0 })`);
  t(`a helicopter set down on a helicopter deck at ${h.kn.toFixed(1)} kn (12-20) in a Moderate sea: lashed after ${h.lashAt && h.lashAt.toFixed(1)} s, rides her 60 s still lashed, its place on the deck kept within ${h.drift.toFixed(3)} m, unbroken`,
    h.kn > 12 && h.kn < 20 && h.lashAt != null && h.lashAt < 3 && h.lashed && h.off == null && h.drift < 0.05 && !h.nan && h.parts === h.of, h);
  R(`hl.throttle = 1; var lo = { t: null, h: 0 }; tick(dkF, 20, (tt) => { const X = dk.toLocal(hl.x, hl.y, hl.z); lo.h = X.y - X0.y; if (lo.t == null && !hl.lash) lo.t = tt; });`);
  const l = R(`({ ...lo, lashed: !!hl.lash, parts: hl.parts.length, alt: alt(hl) })`);
  t(`...full throttle: let go at once (${l.t != null ? l.t.toFixed(2) : '-'} s) and lifts off (${l.h.toFixed(1)} m over the deck after 20 s)`, l.t != null && l.t < 0.1 && !l.lashed && l.h > 10, l);
}

// ================================================================ §cross
// 11. An amphibious tank with a hull: a BMK-2 with a boat hull between its tracks and a small waterjet, off the headland
// slipway: it floats (its tracks touch nothing), its jet drives it to the shore (its driver holding it on the slipway's
// line: the jet's nozzle steers it), and up the slipway its tracks meet the bed and it drives out of the water
{
  R(`Ship.setSea('calm'); var am = build([...tpl('bmk2'), ['tstAmph', 0, 1.35, 0, { att: 0 }], ['tstJetS', -3.6, 0.9, 0, { att: 11 }]], 'tank', { e: 3420, z: 0, yaw: Math.PI }), amF = fsim(am);
  var amA = { launched: am.launchedAt, hydro: am.hydro, gear: am.gear.length, afloat: false, alt: 0, mass: am.mass };
  tick(amF, 10); amA.afloat = am.afloat; amA.alt = alt(am); amA.wheels = am.wheelsDown;
  // (driven as a driver would: full ahead, steering to hold west, the slipway's line)
  am.ctl.v = 1; var amT = { land: null, e: [], nan: false }; tick(amF, 150, (tt, i) => { if (bad(am)) { amT.nan = true; return false; } am.ctl.h = clamp(-3 * wrapAngle(Ship.heading(am, am.sh) + Math.PI / 2), -1, 1); if (i % 1200 === 0) amT.e.push([+tt.toFixed(0), +(-wrapAngle(Terrain.locate(EARTH, am.x, am.y, am.z).a - EARTH.padAngle) * EARTH.radius).toFixed(0), +alt(am).toFixed(1), am.afloat, am.wheelsDown]); if (amT.land == null && am.wheelsDown && !am.afloat) amT.land = tt; });
  amT.end = { e: -wrapAngle(Terrain.locate(EARTH, am.x, am.y, am.z).a - EARTH.padAngle) * EARTH.radius, alt: alt(am), afloat: am.afloat, wheels: am.wheelsDown, parts: am.parts.length, of: am.of, flooded: !!am.flooded };`);
  const a = R('amA'), e = R('amT');
  t(`an amphibious tank with a hull (${(a.mass / 1000).toFixed(1)} t) floats off the slipway: afloat, its tracks on nothing (${a.alt.toFixed(2)} m)`, a.launched && a.launched.ok && a.hydro && a.gear === 2 && a.afloat && !a.wheels, a);
  t(`...its waterjet drives it ashore and up the slipway on its tracks (out of the water at ${e.land && e.land.toFixed(0)} s, ${e.end.alt.toFixed(1)} m up at the end, ${e.end.e.toFixed(0)} m east), its engine not flooded`,
    !e.nan && e.land != null && !e.end.afloat && e.end.wheels && e.end.alt > 1 && e.end.e < R('EARTH.roadEnd') && !e.end.flooded && e.end.parts === e.end.of, e);
}

// 12. The Catalyna (or a stand-in: the Seagull on two hull floats instead of its old ones): she floats on the water at
// the bay, runs up on her floats, planes and lifts off on her old plane laws (hold; the stick eased back on the step, as a
// pilot does, and let go once she is off)
{
  R(`Ship.setSea('calm'); var cat = build(TEMPLATES.catalyna ? tpl('catalyna') : [...tpl('seagull').filter((r) => r.type !== 'floats'), { type: 'tstPontoon', x: 1.5, y: 4.3, rot: 1, flip: false, z: -1.6, att: 1 }, { type: 'tstPontoon', x: 1.5, y: 4.3, rot: 1, flip: false, z: 1.6, att: 1 }], 'plane', { e: EARTH.sites.bay.east, z: 0, yaw: Math.PI }), catF = fsim(cat);
  var c0 = { launched: cat.launchedAt, hydro: cat.hydro, kind: cat.kind, mass: cat.mass }; tick(catF, 5); c0.afloat = cat.afloat; c0.alt = alt(cat); c0.draft = cat.draft;
  stageAll(cat); cat.throttle = 1; cat.sas = 'hold'; var ct = { plane: null, off: null, vmax: 0, nan: false };
  tick(catF, 60, (tt) => { if (bad(cat)) { ct.nan = true; return false; } const V = cat.speed(); cat.ctl.v = cat.afloat && V > 15 ? -0.3 : 0; if (ct.plane == null && cat.sh.fsub < 0.5 && V > 5) ct.plane = V * ${KN}; if (ct.off == null && !cat.afloat) ct.off = V * ${KN}; });
  ct.alt = alt(cat); ct.parts = cat.parts.length; ct.of = cat.of; ct.broken = catF.broken;`);
  const c = R('c0'), k = R('ct');
  t(`the Catalyna (${R('!!TEMPLATES.catalyna') ? 'her template' : 'a Seagull on two hull floats'}, ${(c.mass / 1000).toFixed(1)} t) floats at the bay (${c.alt.toFixed(2)} m, drawing ${c.draft.toFixed(2)} m), a plane with a hull`, c.launched && c.launched.ok && c.hydro && c.kind === 'plane' && c.afloat, c);
  t(`...full throttle: she gets onto the step (her hull carrying under half of her at ${k.plane && k.plane.toFixed(0)} kn) and leaves the water at ${k.off && k.off.toFixed(0)} kn (her wings carrying her: 30-80), climbing (${k.alt.toFixed(0)} m at 60 s), unbroken`,
    !k.nan && k.plane != null && k.off > 30 && k.off < 80 && k.alt > 20 && k.parts === k.of, k);
}

// ================================================================ §cost (spec §15)
// Ship.bump with two ships touching (budget 0.05 ms a frame), and Ship.forces for the hydrofoil foilborne (her rings, four
// foil halves, two struts and the ride control's step: Ship.pre), timed in the test's VM (slower than a page: its globals)
{
  const time = (code, n) => { R(`var __f = () => { ${code} };`); R(`for (let i = 0; i < ${Math.ceil(n / 10)}; i++) __f();`); const t0 = process.hrtime.bigint(); R(`for (let i = 0; i < ${n}; i++) __f();`); return Number(process.hrtime.bigint() - t0) / 1e3 / n; };
  R(`Ship.setSea('calm'); var ba = build(tpl('cyclon'), 'ship', { e: -2400, z: -3200, yaw: 0 }), bb = build(tpl('cyclon'), 'ship', { e: -2380, z: -3200 + 6.5, yaw: 0 }), bF = fsim(ba, [ba, bb]); var bx0 = [bb.x, bb.y, bb.z];
  var touch = Ship.insideHull(ba, bb.toLocal(...(() => { const g = ba.sh.rings[3], W = ba.toWorld(g.P[3 * 9], g.P[3 * 9 + 1], g.P[3 * 9 + 2]); return [W.x, W.y, W.z]; })()));`);
  R(`var vbF = qunrot(pg.q, pg.vx, pg.vy, pg.vz), wbF = pg.bodyAV(); pg.sh.tel = 4; tick(pgF, 40);`);
  const fu = time('Ship.pre(pg, 1 / 120, pgF); Ship.forces(pg, 1 / 120, qunrot(pg.q, pg.vx, pg.vy, pg.vz), pg.bodyAV(), pgF);', 5000), cy = R(`build(tpl('cyclon'), 'ship', { e: -2300, z: 3000, yaw: 0 })`);
  R(`var cyT = build(tpl('cyclon'), 'ship', { e: -2300, z: 3000, yaw: 0 }), cyF = fsim(cyT); cyT.sh.tel = 4; tick(cyF, 20);`);
  const fc = time('Ship.pre(cyT, 1 / 120, cyF); Ship.forces(cyT, 1 / 120, qunrot(cyT.q, cyT.vx, cyT.vy, cyT.vz), cyT.bodyAV(), cyF);', 5000);
  const us = time('bb.x = bx0[0]; bb.y = bx0[1]; bb.z = bx0[2]; Ship.bump(bF);', 2000);
  const none = time(`Ship.bump({ vessels: [ba] });`, 20000);
  // (against the Cyclon's own water step in the same run, so a busy machine moves both: the budget's 50 µs is about six of
  // her 8 µs steps in a page; in the VM alone, 33 µs against her 67)
  t(`Ship.bump with two ships alongside, touching: ${us.toFixed(1)} µs a frame in the VM, ${(us / fc).toFixed(2)} of the Cyclon's water step (under 2: the budget, 50 µs in a page, is six); with one ship alone ${none.toFixed(2)} µs`, us < 2 * fc && none < 0.3 * fc, { us, none, fc });
  t(`the hydrofoil's water step foilborne (${R('pg.sh.rings.length')} rings, ${R('pg.sh.fl.length')} foils and struts, the ride control): ${fu.toFixed(1)} µs, the Cyclon's ${fc.toFixed(1)} µs (in the VM; within 3× of each other)`, fu < 3 * fc + 20, { fu, fc, cy: !!cy });
}

R(`Ship.setSea('moderate');`);
t.done();
