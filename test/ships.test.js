// The ships update (spec §17.1). §hydro: the hydro core (ship.js core, WP1): an analytic box hull's draft, metacentric
// height and roll period; the slice ship (the Cyclon) afloat at the bay, at speed, turning, holding her heading, in a
// Rough sea for ten minutes stopped and at full speed, run aground, moored and woken, warped, far away, and broken up.
// §waves: Ship.wave (deterministic, each sea state's significant height, the shallow and lake fades) and the shader's
// uniforms (waveUniforms) against it. §gates: the hooks shut for old designs (traces with and without ship.js). §trials
// (WP5): the stock ships against spec §7's targets (weight, marks, speed, turning, roll beam-on; the RIB planing, the
// hydrofoil hullborne, the flying boat afloat).
// The expected values are worked out from the hulls and the spec, never read back from the code.
//   node test/ships.test.js
const G = require('./lib/game.js');
const ctx = G.load({ combat: true, flight: true });
const R = (c) => G.run(ctx, c);
const t = G.checks('ships: §hydro, §trials, §waves, §gates');
const D = 180 / Math.PI, KN = 1.943844;

// ---------------------------------------------------------------- the stand-ins
// a still sea for the analytic checks (the calm state with no waves), put back after
R(`var SEA0 = JSON.parse(JSON.stringify(SHIP.SEA)), still = (on) => { SHIP.SEA.calm.a = on ? 0 : SEA0.calm.a; Ship.setSea('moderate'); Ship.setSea(on ? 'calm' : 'moderate'); };
var fsim = (v, list) => Object.assign(${'(' + G.sim.toString() + ')()'}, { active: v, vessels: list || [v], running: true });
var bad = (v) => ![v.x, v.y, v.z, v.vx, v.vy, v.vz, v.q.w, v.q.x, v.q.y, v.q.z, v.av.x, v.av.y, v.av.z].every(Number.isFinite);
var kn = (v) => v.speed() * ${KN};
var cyclon = (place) => { const rows = templateRows(TEMPLATES.cyclon).map((r) => ({ ...r })); const parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
  const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const v = new Vessel(ps, adj, EARTH); v.kind = 'ship'; v.name = 'Cyclon'; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups();
  v.placeOnSurface(EARTH, siteAngle(EARTH, place ? place.e : EARTH.sites.bay.east), 0, place ? place.z || 0 : 0, place ? place.yaw || 0 : 0);
  v.launchedAt = Ship.launch(v, place); return v; };`);
// the physics ticks as flight.js's physicsTick runs them (a moored ship drifts, the rest are stepped), Ship.frame as
// Combat.frame calls it (every fourth step here)
R(`var tick = (F, secs, each) => { const n = Math.round(secs * 120); for (let i = 0; i < n; i++) { if (each && each(i / 120, i) === false) return i;
  for (const v of F.vessels.slice()) { if (v.dead) continue; if (v.moored && v !== F.active) { Ship.drift(v, 1 / 120, F); continue; } v.physicsStep(1 / 120, F); }
  F.time += 1 / 120; if (i % 4 === 0) Ship.frame(F, 4 / 120); } return n; };`);

// ================================================================ §hydro
// 1. An analytic box hull (a test part: nb 50 makes the sections rectangles bar a sliver at the chines), 20 × 6 m, 4 m
// deep, and a weight on top of it raising the centre of gravity: draft m/(ρ·L·B), GM = KB + BM − KG with KB = T/2,
// BM = B²/(12·T); the roll period 2π·√(I·(1 + 0.15)/(W·GM)) (the roll's added inertia)
R(`PARTS.tstBox = { name: 'Test box hull', cat: 'shHull', w: 20, h: 4, depth: 6, mass: 150, shape: 'shull', hull: true, tier: 1, cost: 1,
  shull: { cls: 'T', wl: -1.95, st: [[-10, 2, -2, 3, 3, 50], [10, 2, -2, 3, 3, 50]], ends: { aft: 'closed', fore: 'closed' }, k: 0.3 } };
PARTS.tstWeight = { name: 'Test weight', cat: 'shKit', w: 4, h: 1, depth: 2, mass: 30, shape: 'tkit', tier: 1, cost: 1 };
var box = (wy) => { const ps = [makePart('tstBox', 0, 0), makePart('tstWeight', 0, wy)], adj = new Map([[ps[0].id, new Set([ps[1].id])], [ps[1].id, new Set([ps[0].id])]]);
  const v = new Vessel(ps, adj, EARTH); v.kind = 'ship'; v.stages = []; v.rebuildGroups();
  v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites.bay.east), 0, 0, 0); return v; };
still(true);
var bx = box(2.5), bxF = fsim(bx), bxL = Ship.launch(bx);`);
{
  const H = R(`(() => { const r = shullOf(PARTS.tstBox).rings[0]; return { A: r.A, vol: shullOf(PARTS.tstBox).vol }; })()`);
  const m = R('bx.mass'), L = 20, Bm = 6, rho = 1025, g = R('EARTH.mu / Math.hypot(bx.x, bx.y, bx.z) ** 2');
  const T = m / (rho * L * Bm); // (the sliver missing at each chine sits in its lowest 5 cm: under 0.1 % of the area there)
  const KG = R('bx.com.y') + 2, KB = T / 2, BM = (Bm * Bm) / (12 * T), GM = KB + BM - KG;
  R('Ship.forces(bx, 1 / 120, v3(), v3(), bxF)');
  const draft = R('bx.draft'), gm = R('Ship.stab(bx)');
  t(`box hull: a section is the rectangle within 0.2 % (${H.A.toFixed(3)} of 24 m²)`, Math.abs(H.A / 24 - 1) < 0.002, H);
  t(`box hull: floats at m/(ρ·L·B) = ${T.toFixed(3)} m within 1 % (${draft.toFixed(3)} m), level (heel and trim under 0.05°)`,
    Math.abs(draft / T - 1) < 0.01 && Math.abs(R('bx.heel')) * D < 0.05 && Math.abs(R('bx.trim')) * D < 0.05, { draft, T, heel: R('bx.heel') * D, trim: R('bx.trim') * D });
  t(`box hull: GM ${gm.toFixed(3)} m within 3 % of KB + BM − KG = ${GM.toFixed(3)} m`, Math.abs(gm / GM - 1) < 0.03, { gm, GM, KB, BM, KG });
  // the roll period: heeled 5° and let go in still water; the time between up-crossings of the heel
  const Ixx = R('bx.I.xx'), Tr = 2 * Math.PI * Math.sqrt((Ixx * (1 + 0.15)) / (m * g * GM));
  R(`bx.q = qnorm(qmul(bx.q, qaxis(1, 0, 0, 5 / ${D}))); var ups = [], last = 0; tick(bxF, 40, (tt) => { const h = bx.heel; if (last < 0 && h >= 0) ups.push(tt); last = h; });`);
  const ups = R('ups'), per = ups.length > 2 ? (ups[ups.length - 1] - ups[0]) / (ups.length - 1) : NaN;
  t(`box hull: rolls with a period of ${per.toFixed(2)} s, within 15 % of 2π·√(I(1 + 0.15)/(W·GM)) = ${Tr.toFixed(2)} s`, Math.abs(per / Tr - 1) < 0.15, { per, Tr, ups: ups.length });
  // settles: dropped 0.5 m high, heeled 6° and trimmed 3°: in 60 s it lies still at its float (a barge with no bilge keels:
  // its roll dies away at the bare ζ 0.07)
  R(`Ship.launch(bx); var z0 = bx.radius(); bx.x *= (bx.radius() + 0.5) / bx.radius(); bx.y *= (z0 + 0.5) / z0; bx.z *= (z0 + 0.5) / z0;
    bx.q = qnorm(qmul(bx.q, qmul(qaxis(1, 0, 0, 6 / ${D}), qaxis(0, 0, 1, 3 / ${D})))); tick(bxF, 60);`);
  const st = R(`({ dz: bx.radius() - z0, v: bx.speed(), w: len3(bx.av), heel: bx.heel * ${D}, trim: bx.trim * ${D} })`);
  t('box hull: dropped 0.5 m, heeled 6° and trimmed 3°, it settles in 60 s (within 2 cm of its float, heel and trim under 0.5°, drifting under 0.1 m/s)',
    Math.abs(st.dz) < 0.02 && st.v < 0.1 && st.w < 0.01 && Math.abs(st.heel) < 0.5 && Math.abs(st.trim) < 0.3, st);
}

// 2. The Cyclon (124 t: the slice's 110 t, her guns, mast, damage-control party and 10 t of ballast, WP5), at the bay:
// afloat at her float, level, settled
R(`var cy = cyclon(), cyF = fsim(cy);`);
{
  const L = R('cy.launchedAt'), p = R(`({ heel: cy.heel * ${D}, trim: cy.trim * ${D}, mass: cy.mass, gm: Ship.stab(cy), afloat: cy.afloat, landed: cy.landed })`);
  R('Ship.forces(cy, 1 / 120, v3(), v3(), cyF)');
  const f = R(`({ draft: cy.draft, fsub: cy.sh.fsub, B: cy.sh.B, W: cy.mass * EARTH.mu / Math.hypot(cy.x, cy.y, cy.z) ** 2, heel: cy.heel * ${D}, trim: cy.trim * ${D} })`);
  t(`the Cyclon launches afloat at the bay (where she was put: ${L && L.moved} m out), level (heel ${f.heel.toFixed(2)}°, trim ${f.trim.toFixed(2)}°), her buoyancy her weight, drawing ${f.draft.toFixed(2)} m, GM ${p.gm.toFixed(2)} m`,
    L && L.ok && p.afloat && !p.landed && Math.abs(f.heel) < 1 && Math.abs(f.trim) < 1 && Math.abs(f.B / f.W - 1) < 0.002 && f.draft > 1 && f.draft < 1.7 && p.gm > 1 && Math.abs(p.mass - 124460) < 1, { L, p, f });
  R(`still(false); tick(cyF, 20);`);
  const s = R(`({ v: cy.speed(), heel: cy.heel * ${D}, trim: cy.trim * ${D}, afloat: cy.afloat, alt: cy.radius() - EARTH.radius })`);
  t('...and rides the Moderate swell 20 s at her mooring spot: afloat, under 3° of heel and trim, drifting under 1 m/s', s.afloat && Math.abs(s.heel) < 3 && Math.abs(s.trim) < 3 && s.v < 1, s);
}

// 3. Full ahead (Flank on the telegraph, Ship.pre's interface: sh.tel), calm sea: about 30 knots, the engines spooling
// up over SHIP.SPOOL; the telegraph from W/S (ctl.v: a tap a step, held a step every 0.35 s after 0.5 s)
{
  R(`Ship.setSea('calm'); cy.ctl.v = 1;`);
  const tap = R(`(() => { const o = []; tick(cyF, 1.5, (tt) => { o.push(cy.sh.tel); }); cy.ctl.v = 0; tick(cyF, 0.1); return [o[1], o[30], o[59], o[70], o[100], o[120], o[150], o[179], cy.sh.tel]; })()`); // (o[i]: before step i)
  t('the telegraph: W rings it a step at once, held another after 0.5 s and every 0.35 s after (Stop → Slow → Half → Full → Flank)', tap.join() === '1,1,1,2,2,3,4,4,4', tap);
  R(`cy.ctl.v = -1; tick(cyF, 0.05); cy.ctl.v = 0; tick(cyF, 0.05); cy.ctl.v = -1; tick(cyF, 0.05); cy.ctl.v = 0; var telAfter = cy.sh.tel; Ship.setTel(cy, 4); Ship.setTel(cy, 9);`);
  t('...S two taps back to Half; setTel clamps to Flank', R('telAfter') === 2 && R('cy.sh.tel') === 4);
  R(`var sp = []; tick(cyF, 90, (tt, i) => { if (i % 1200 === 0) sp.push(kn(cy)); });`);
  const sp = R('sp'), top = R('kn(cy)');
  t(`Flank, calm sea: ${sp.map((x) => x.toFixed(1)).join(' → ')} → ${top.toFixed(1)} kn in 90 s (about 30: 28-36 kn), still gaining in the first 20 s`,
    top > 28 && top < 36 && sp[1] > 10 && sp[2] < top, sp);
  const run = R(`({ heel: cy.heel * ${D}, trim: cy.trim * ${D}, fsub: cy.sh.fsub, T: cy.sh.T, hold: cy.sh.hold, hdg: Ship.heading(cy, cy.sh) * ${D}, rpm: cy.sh.scr[0].p.rpm })`);
  t('...running straight on the heading hold (her heading within 1° of the launch heading), level, the screws turning', Math.abs(run.hdg - 90) < 1 && Math.abs(run.heel) < 2 && Math.abs(run.trim) < 3 && run.rpm > 200, run);
}

// 4. Hard over (A/D: ctl.h), full speed: she turns, heels outward, slows; let go, the hold catches the heading
{
  R(`var turn = { heel: 0, r: [], v: [] }; cy.ctl.h = 1; tick(cyF, 40, (tt, i) => { turn.heel = Math.max(turn.heel, Math.abs(cy.heel)); if (tt > 25 && i % 120 === 0) { turn.r.push(-dot3(cy.av, cy.sh.U)); turn.v.push(cy.speed()); } });`);
  const tr = R('turn'), r = tr.r.reduce((a, b) => a + b, 0) / tr.r.length, V = tr.v.reduce((a, b) => a + b, 0) / tr.v.length, Lwl = R('cy.sh.Lwl');
  const Dt = (2 * V) / Math.abs(r);
  t(`full rudder at full speed: turns to starboard at ${(r * D).toFixed(1)}°/s at ${(V * KN).toFixed(1)} kn, a circle ${Dt.toFixed(0)} m across (${(Dt / Lwl).toFixed(1)} of her ${Lwl.toFixed(1)} m: 3-6), heeling ${(tr.heel * D).toFixed(1)}° at most (under 15°)`,
    r > 0 && Dt / Lwl > 3 && Dt / Lwl < 6 && tr.heel * D < 15, { r: r * D, V, Dt, Lwl, heel: tr.heel * D });
  R(`var outw = []; cy.ctl.h = 1; tick(cyF, 2, (tt, i) => { if (i % 30 === 0) outw.push(cy.heel); });`);
  t('...her heel in the turn is outward (to port, turning to starboard)', R('outw.reduce((a, b) => a + b, 0) / outw.length') < 0, R('outw'));
  R(`cy.ctl.h = 0; var hd = []; tick(cyF, 30, (tt, i) => { if (i % 120 === 0) hd.push(Ship.heading(cy, cy.sh) * ${D}); });`);
  const hd = R('hd'), held = hd.slice(10), sw = Math.max(...held.map((h) => Math.abs(((h - held[0] + 540) % 360) - 180)));
  t(`let go, the heading hold catches her within 10 s and holds it (${held[0].toFixed(1)}°, swinging ${sw.toFixed(2)}° over 20 s)`, sw < 1.5, hd.map((h) => +h.toFixed(1)));
}

// 5. Moderate and Rough seas, ten minutes each stopped and at Flank on the hold: nothing goes wild (every number finite,
// under 25 m/s, under 1.5 rad/s of spin, never past 45° of heel), and she keeps her heading at speed
for (const sea of ['moderate', 'rough']) for (const tel of [0, 4]) {
  R(`Ship.setSea('${sea}'); var rv = cyclon(), rvF = fsim(rv); rv.sh.tel = ${tel}; var wild = { v: 0, w: 0, heel: 0, nan: false, hd: [] };
  tick(rvF, 600, (tt, i) => { if (bad(rv)) { wild.nan = true; return false; } wild.v = Math.max(wild.v, rv.speed()); wild.w = Math.max(wild.w, len3(rv.av)); wild.heel = Math.max(wild.heel, Math.abs(rv.heel)); if (tt > 120 && i % 600 === 0) wild.hd.push(Ship.heading(rv, rv.sh) * ${D}); });`);
  const w = R('wild'), dh = w.hd.length ? Math.max(...w.hd.map((h) => Math.abs(((h - 90 + 540) % 360) - 180))) : 0;
  t(`${sea} sea, ${tel ? 'Flank' : 'stopped'}, 600 s: no NaN, under 25 m/s and 1.5 rad/s, heel at most ${(w.heel * D).toFixed(1)}° (under 45°)${tel ? `, her heading within ${dh.toFixed(1)}° of 090 (under 5°)` : ''}`,
    !w.nan && w.v < 25 && w.w < 1.5 && w.heel * D < 45 && (!tel || dh < 5) && R('!rv.dead && rv.parts.length') === R('TEMPLATES.cyclon.parts.length'), { v: w.v, w: w.w, heel: w.heel * D, dh, nan: w.nan });
}
R(`Ship.setSea('moderate');`);

// 6. Aground: the Cyclon steamed at 10 kn at the island's shore (east of the bay): she stops on the bed, landed, in one
// piece, no NaN; the sea bed is what she meets (her probes the bed, not the sea's surface)
{
  R(`var gr = cyclon({ e: -1100, z: 0, yaw: 0 }), grF = fsim(gr); gr.sh.tel = 1; var gv0 = null, gnan = false, gmax = 0;
  { const f = qrot(gr.q, 1, 0, 0); gr.vx = f.x * 5.14; gr.vy = f.y * 5.14; gr.vz = f.z * 5.14; }
  tick(grF, 160, (tt) => { if (bad(gr)) { gnan = true; return false; } if (tt < 60) { const s = gr.speed(); gr.sh.tel = s < 5.1 ? 2 : 1; } else gr.sh.tel = 0; if (gr.landed && gv0 == null) gv0 = tt; gmax = Math.max(gmax, Math.abs(gr.heel)); });`);
  const g = R(`({ landed: gr.landed, at: gv0, v: gr.speed(), parts: gr.parts.length, broken: grF.broken, nan: gnan, heel: gmax * ${D}, bed: Terrain.heightAt(EARTH, Terrain.locate(EARTH, gr.x, gr.y, gr.z).a, Terrain.locate(EARTH, gr.x, gr.y, gr.z).z), e: -wrapAngle(Terrain.locate(EARTH, gr.x, gr.y, gr.z).a - EARTH.padAngle) * EARTH.radius })`);
  t(`aground at 10 kn on the island's shore (${g.e.toFixed(0)} m east, the bed ${g.bed.toFixed(1)} m): she stops on it (landed at ${g.at && g.at.toFixed(0)} s, ${g.v.toFixed(2)} m/s at the end), every part aboard, nothing broken, no NaN, heel under 20°`,
    g.landed && g.v < 0.5 && g.parts === R('TEMPLATES.cyclon.parts.length') && !g.broken.length && !g.nan && g.heel < 20, g);
}

// 7. Mooring (§4.10): a ship that isn't the player's, afloat at Stop, still 5 s: moored; it bobs on the swell with no
// physics (its pose follows the waves, it stays where it is); a craft passing close under way wakes it
{
  R(`var mo = cyclon({ e: -2300, z: 600, yaw: 0 }), me = cyclon(), moF = fsim(me, [me, mo]); var moAt = null, fc = 0;
  { const f0 = Ship.forces; Ship.forces = function (v, ...a) { if (v === mo) fc++; return f0.call(this, v, ...a); }; var unwrapF = () => { Ship.forces = f0; }; }
  tick(moF, 20, (tt) => { if (mo.moored && moAt == null) moAt = tt; });
  var mp0 = [mo.x, mo.y, mo.z], fc0 = fc, hs = []; tick(moF, 10, (tt, i) => { if (i % 12 === 0) hs.push(mo.radius() - EARTH.radius); });
  var mmoved = Math.hypot(mo.x - mp0[0], mo.y - mp0[1], mo.z - mp0[2]), fcm = fc - fc0;`);
  const hs = R('hs'), span = Math.max(...hs) - Math.min(...hs);
  t(`a ship left at Stop moors after ${R('moAt') && R('moAt').toFixed(1)} s still (5 s + settling), then bobs ${span.toFixed(2)} m on the swell with no physics steps (${R('fcm')} in 10 s), never leaving her spot`,
    R('moAt') != null && R('moAt') < 20 && R('mo.moored') && R('fcm') === 0 && span > 0.05 && span < 2 && R('mmoved') < 2.5, { at: R('moAt'), span, fc: R('fcm'), moved: R('mmoved') });
  R(`me.sh.tel = 0; me.x = mo.x; me.y = mo.y; me.z = mo.z; { const u = qrot(mo.q, 0, 0, 1); me.x += u.x * 150; me.y += u.y * 150; me.z += u.z * 150; const f = qrot(mo.q, 1, 0, 0); me.vx = f.x * 4; me.vy = f.y * 4; me.vz = f.z * 4; }
  Ship.frame(moF, 1 / 30); var woke = !mo.moored; tick(moF, 1); unwrapF();`);
  t('...a craft 150 m off at 4 m/s wakes her, and she is stepped again', R('woke') && R('fc - fc0 - fcm') > 0, R('[woke, fc]'));
  R(`me.vx = me.vy = me.vz = 0; mo.sh.tel = 2; Ship.frame(moF, 1 / 30); var moT = mo.moored;`);
  t('...and a ship under way (her telegraph off Stop) never moors', R('moT') === false);
}

// 8. Time warp (flight.js canRails, railsAdvance): the player's ship afloat, still, at Stop may warp past 8× (moored
// for it, her place kept); under way or at Flank she may not; any ship afloat waits where it is on rails, never dropped
{
  R(`var wp = cyclon(), wpF = fsim(wp); tick(wpF, 3); wp.vx = wp.vy = wp.vz = 0; wp.av = v3(); var c1 = Flight.canRails.call(wpF);
  var wp0 = [wp.x, wp.y, wp.z], used = Flight.railsAdvance.call(wpF, wp, 3600, true, 0), wmoved = Math.hypot(wp.x - wp0[0], wp.y - wp0[1], wp.z - wp0[2]);
  wp.sh.tel = 4; tick(wpF, 0.1); var c2 = Flight.canRails.call(wpF), awakeAfter = !wp.moored;`);
  t('warp: her ship afloat, still at Stop may warp (moored for it), an hour on rails leaves her where she was', R('c1') === true && R('used') === 3600 && R('wmoved') < 1e-6, R('[c1, used, wmoved]'));
  t('...rung up, she is stepped again (awake) and may not warp past 8× (her engines)', R('awakeAfter') && R('c2') === 'engines', R('[awakeAfter, c2]'));
  R(`var fa = cyclon({ e: -2300, z: 1200, yaw: 0 }); tick(fsim(fa), 1); fa.vx += 2; var fa0 = [fa.x, fa.y, fa.z]; var fu = Flight.railsAdvance.call(wpF, fa, 600, false, 0); var famoved = Math.hypot(fa.x - fa0[0], fa.y - fa0[1], fa.z - fa0[2]);`);
  t('...a ship afloat and drifting is never put on an orbit (on rails it waits where it is, not dropped as a craft falling into the air)', R('fu') === 600 && R('famoved') < 1e-6 && !R('fa.dead'), R('[fu, famoved]'));
}

// 9. Far ships (flight.js stepsNear and update's far list): an AI ship is stepped out to SHIP.aiNear (12 km); any other
// ship afloat out of range is neither stepped nor railed (it waits)
{
  R(`var nearOf = (o, d) => Flight.stepsNear.call({ active: cy }, o, d); var ai = cyclon({ e: -2300, z: -2400, yaw: 0 }); ai.ai = { sea: true }; ai.control = ai.control;`);
  // (a hull with nobody aboard: the Cyclon's hull cut loose from her wheelhouse)
  R(`var hk = cyclon({ e: -2300, z: -3600, yaw: 0 }); for (const whk of hk.parts.filter((p) => p.type === 'bridgeM' || p.type === 'ringS')) for (const n of [...hk.adj.get(whk.id)]) if (hk.byId.get(n).def.hull) { hk.adj.get(whk.id).delete(n); hk.adj.get(n).delete(whk.id); } // (the wheelhouse and the gun's ring off the hull: nobody aboard)
  var hkP = hk.splitComponents().find((o) => o.parts.some((p) => p.def.hull));`);
  const near = R('[nearOf(ai, 9000), nearOf(ai, 11900), !!hkP && !hkP.control && hkP.hydro, nearOf(hkP, 9000)]');
  t('far ships: an AI ship 9 and 11.9 km off is stepped (any ship with a crew afloat is, by the old rule for craft under way); a derelict hull 9 km off is not', near.join() === 'true,true,true,false', near);
  // the far list: update()'s partition, run on its own
  const src = require('fs').readFileSync(require('path').join(G.ROOT, 'js', 'flight.js'), 'utf8');
  t('...and update()\'s far list (rails) takes no ship afloat: "!v.landed && !v.hydro"', /else if \(!v\.landed && !v\.hydro\) far\.push\(v\);/.test(src));
}

// 10. Pieces of a hydro vessel: the wheelhouse torn off sinks to the bed (it has no hull), the hull floats on
{
  // (cut loose by hand and split, as Flight.ripParts does: the craft keeps its control part, the wheelhouse; the hull is a piece)
  R(`var sh2 = cyclon({ e: -2300, z: -900, yaw: 0 }), F2 = fsim(sh2); var wh = sh2.parts.find((p) => p.type === 'bridgeM');
  for (const n of [...sh2.adj.get(wh.id)]) if (sh2.byId.get(n).def.hull) { sh2.adj.get(wh.id).delete(n); sh2.adj.get(n).delete(wh.id); } // (off the hull: its mast stays on it)
  var out = sh2.splitComponents(); F2.vessels = [sh2, ...out]; var hullP = F2.vessels.find((o) => o.parts.some((p) => p.def.hull)), whP = F2.vessels.find((o) => o.parts.includes(wh));
  var bed = Terrain.heightAt(EARTH, Terrain.locate(EARTH, whP.x, whP.y, whP.z).a, Terrain.locate(EARTH, whP.x, whP.y, whP.z).z), pnan = false, sinkV = 0;
  tick(F2, 60, (tt) => { for (const o of F2.vessels) if (bad(o)) pnan = true; if (tt > 3 && tt < 6) sinkV = Math.max(sinkV, whP.speed()); });`);
  const pc = R(`({ n: F2.vessels.length, hydro: F2.vessels.map((o) => o.hydro), whAlt: whP.radius() - EARTH.radius, bed, whLanded: whP.landed, hullAfloat: hullP.afloat, hullAlt: hullP.radius() - EARTH.radius, nan: pnan, sinkV })`);
  t(`pieces: the wheelhouse loose from the hull sinks (at ${pc.sinkV.toFixed(1)} m/s through the water) to the bed ${pc.bed.toFixed(0)} m down and lies there; the hull floats on; both hydro, no NaN`,
    pc.n === 2 && pc.hydro.every(Boolean) && pc.whLanded && pc.whAlt < pc.bed + 6 && pc.hullAfloat && Math.abs(pc.hullAlt) < 3 && !pc.nan && pc.sinkV > 1 && pc.sinkV < 12, pc);
}

// 11. The solid sea for everyone else: the probe gate shuts on any craft without a hull (a Seagull on its floats, a
// buggy driven into the sea): the old surface, the old water rules (pinned too by driving.json and death.test A7/B3)
{
  ctx.__sg = G.craft(ctx, R('templateRows(TEMPLATES.seagull)'), 'plane');
  R(`var sg = __sg, sgF = fsim(sg); sg.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites.bay.east), VEHICLE_KINDS.plane.launchRot, 0, Math.PI); for (let i = 0; i < 240; i++) sg.physicsStep(1 / 120, sgF);`);
  t('a Seagull at the bay: not hydro, no ship groups, sits on the old solid sea, splashed on its floats', R('!sg.hydro && sg.sh === null && sg.hF === null && sg.splashed && sg.onFloats && sg.afloat === undefined'), R('[sg.hydro, sg.splashed, sg.onFloats]'));
}

// 12. Ship.forces' cost (spec §15: 35 rings ≤ 0.04 ms a step on a desktop): the Cyclon's 12 rings at speed in a Moderate
// sea, timed in a plain script (the test VM's globals cost several times a page's)
{
  const fs = require('fs'), path = require('path'), src = (f) => fs.readFileSync(path.join(G.ROOT, 'js', f), 'utf8'), b = src('builder.js');
  const code = [src('util.js').replace(/const \$ =[\s\S]*$/, ''), src('space.js'), src('terrain.js'), src('parts.js'), src('vessel.js'), src('gear.js'), src('aim.js'), src('armour.js'), src('drone.js'), src('ship.js'),
    b.match(/const TEMPLATES = \{[\s\S]*?\n\};/)[0], b.match(/function templateRows\(t\) \{[\s\S]*?\n\}/)[0], `
    const rows = templateRows(TEMPLATES.cyclon).map((r) => ({ ...r })), parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
    const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
    const v = new Vessel(ps, adj, EARTH); v.kind = 'ship'; v.stages = []; v.rebuildGroups(); v.placeOnSurface(EARTH, siteAngle(EARTH, -2300), 0, 0, Math.PI); Ship.launch(v);
    const F = { time: 0, active: v, vessels: [v], toast() {}, ripParts() {}, breakParts() {} };
    v.sh.tel = 4; for (let i = 0; i < 2400; i++) { v.physicsStep(1 / 120, F); F.time += 1 / 120; }
    const vb = qunrot(v.q, v.vx, v.vy, v.vz), wb = v.bodyAV(), n = 40000;
    for (let i = 0; i < n / 4; i++) Ship.forces(v, 1 / 120, vb, wb, F);
    const t0 = process.hrtime.bigint(); for (let i = 0; i < n; i++) Ship.forces(v, 1 / 120, vb, wb, F);
    console.log(JSON.stringify({ us: Number(process.hrtime.bigint() - t0) / 1e3 / n, rings: v.sh.rings.length, kn: v.speed() * 1.943844 }));`].join('\n;\n');
  const out = JSON.parse(require('child_process').execFileSync(process.execPath, ['-'], { input: code, encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').pop());
  const per35 = (out.us / out.rings) * 35;
  t(`Ship.forces costs ${out.us.toFixed(1)} µs a step for the Cyclon's ${out.rings} rings at ${out.kn.toFixed(0)} kn (${per35.toFixed(1)} µs scaled to 35 rings: the budget 40 µs on a desktop; this check allows twice it for a slow machine)`, per35 < 80, out);
}

// ================================================================ §trials (WP5: the stock ships against spec §7's targets)
// Each stock ship launched off the bay heading west, out to sea. Calm sea: her displacement (±10 %), her draught at her
// marks (her longest hull's waterline over its keel, ±0.3 m), Flank for 100 s (her speed over the last 20 s, ±12 %), hard
// over for 40 s (the turning circle in her band of lengths, from her yaw rate and speed past 25 s). Moderate sea, beam-on
// both ways (launched heading 340° and 160°, across the swell running to 250°), stopped, 90 s after 30 s to settle: her roll's
// significant amplitude (2 × its rms) under her limit. The Zodiak's turning waits for outboards that steer (WP6), the
// Pegazus' hullborne run for waterjets that push (WP6): each says so and is skipped until then.
R(`var stock = (key, yaw, sea) => { Ship.setSea(sea || 'calm'); const T = TEMPLATES[key], rows = templateRows(T).map((r) => ({ ...r })), parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
  const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const v = new Vessel(ps, adj, EARTH); v.kind = T.kind; v.name = T.name; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups(); v.of = parts.length;
  v.placeOnSurface(EARTH, siteAngle(EARTH, -2300), 0, 0, yaw); v.launchedAt = Ship.launch(v, { e: -2300, z: 0, yaw }); return v; };
  var marks = (v) => { const H = v.parts.filter((p) => p.def.shull).sort((a, b) => b.def.w - a.def.w)[0], S = shullOf(H.def); return S.wl - Math.min(...S.rings.map((r) => r.yk)); };
  var trial = (key, o) => { still(true); const v = stock(key, Math.PI), F = fsim(v), out = { n: v.parts.length, of: v.of, mass: v.mass / 1000, marks: marks(v) }; let nan = false;
    tick(F, 10, () => { if (bad(v)) nan = true; }); out.draft = v.draft; out.afloat = v.afloat;
    if (o.before) o.before(v);
    v.sh.tel = 4; v.sas = 'hold'; let sum = 0, n = 0, trim = 0;
    tick(F, 100, (tt) => { if (bad(v)) { nan = true; return false; } if (tt > 80) { sum += kn(v); trim += v.trim; n++; } });
    out.kn = sum / n; out.runTrim = (trim / n) * ${D}; out.fsub = v.sh.fsub;
    if (o.turn) { const r = [], V = []; let heel = 0; v.ctl.h = 1; tick(F, 40, (tt, i) => { if (bad(v)) { nan = true; return false; } heel = Math.max(heel, Math.abs(v.heel)); if (tt > 25 && i % 60 === 0) { r.push(-dot3(v.av, v.sh.U)); V.push(v.speed()); } }); v.ctl.h = 0;
      const rr = r.reduce((a, b) => a + b, 0) / r.length, vv = V.reduce((a, b) => a + b, 0) / V.length; out.turnL = (2 * vv) / Math.abs(rr) / v.sh.Lwl; out.turnKn = vv * ${KN}; out.turnHeel = heel * ${D}; }
    if (o.roll) { out.roll = []; for (const yaw of [1.92, -1.22]) { still(false); const w = stock(key, yaw, 'moderate'), W = fsim(w); let ss = 0, m = 0, mx = 0;
      tick(W, 120, (tt) => { if (bad(w)) { nan = true; return false; } if (tt > 30) { ss += w.heel * w.heel; m++; mx = Math.max(mx, Math.abs(w.heel)); } }); out.roll.push({ hdg: Math.round(Ship.heading(w, w.sh) * ${D}), sig: 2 * Math.sqrt(ss / m) * ${D}, max: mx * ${D} }); } }
    out.nan = nan; still(false); return out; };`);
const TRIALS = { // spec §7: displacement (t), speed (kn), turning circle (lengths), roll limit (°)
  zodiak: { t: 3.6, kn: 40, turn: null, roll: 15 }, cyclon: { t: 116, kn: 33, turn: [3, 5], roll: 8 }, higgens: { t: 13, kn: 12, turn: [0.7, 4], roll: 10 },
};
for (const [key, W] of Object.entries(TRIALS)) {
  const o = R(`trial('${key}', { turn: ${!!W.turn}, roll: true })`), f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
  const sig = Math.max(...o.roll.map((q) => q.sig));
  t(`${key}: ${f(o.mass, 2)} t (spec ${W.t} t ±10 %), afloat drawing ${f(o.draft, 2)} m at her ${f(o.marks, 2)} m marks (±0.3), Flank ${f(o.kn)} kn (spec ${W.kn} ±12 %), all ${o.of} parts aboard, no NaN`,
    o.n === o.of && Math.abs(o.mass / W.t - 1) <= 0.1 && o.afloat && Math.abs(o.draft - o.marks) <= 0.3 && Math.abs(o.kn / W.kn - 1) <= 0.12 && !o.nan, o);
  if (W.turn) t(`...hard over at full speed: a circle ${f(o.turnL)} lengths across at ${f(o.turnKn)} kn (${W.turn.join('-')}), heeling ${f(o.turnHeel)}° (under 20°)`, o.turnL >= W.turn[0] && o.turnL <= W.turn[1] && o.turnHeel < 20, o);
  else console.log(`     (skip) ${key}: turning waits for outboards that steer with the helm (WP6)`);
  t(`...launched beam-on in a Moderate sea and left stopped (no way on: the swell turns a small boat where it likes): her roll ${o.roll.map((q) => `${f(q.sig)}° (max ${f(q.max)}°), heading ${q.hdg}° at the end`).join('; ')}: under ${W.roll}° significant`, sig <= W.roll, o.roll);
  if (key === 'zodiak') t(`...she planes: at Flank the water carries ${f((1 - o.fsub) * 100, 0)} % of her weight on her bottom's lift (over half), trimmed ${f(-o.runTrim)}° bow up (0-6°)`, o.fsub < 0.5 && -o.runTrim > -0.5 && -o.runTrim < 6, o);
}
// the Pegazus hullborne: afloat at her marks with her foils in the water (WP6 flies her on them); her turbine shut down,
// her diesels push her waterjet at about 12 knots (once waterjets push: WP6)
{
  const o = R(`(() => { still(true); const v = stock('pegazus', Math.PI), F = fsim(v); tick(F, 20); const foils = v.parts.filter((p) => p.def.foil && p.def.foil.kind === 'foil');
    const r = { draft: v.draft, marks: marks(v), afloat: v.afloat, heel: v.heel * ${D}, trim: v.trim * ${D}, wet: foils.map((p) => { const q = v.toWorld(p.x, p.y + p.def.foil.y, 0); return Math.hypot(q.x, q.y, q.z) - EARTH.radius; }), jets: !!v.sh.scr.some((s) => s.p.def.jet) };
    if (r.jets) { for (const p of v.parts) if (p.type === 'turbine') p.broken = true; v.sh.tel = 4; let s = 0, n = 0; tick(F, 120, (tt) => { if (tt > 100) { s += kn(v); n++; } }); r.kn = s / n; }
    still(false); return r; })()`);
  t(`pegazus: afloat hullborne at her marks (drawing ${o.draft.toFixed(2)} m, marks ${o.marks.toFixed(2)} m), level, both hydrofoils deep in the water (${o.wet.map((w) => w.toFixed(1)).join(', ')} m)`,
    o.afloat && Math.abs(o.draft - o.marks) <= 0.3 && Math.abs(o.heel) < 1 && Math.abs(o.trim) < 1 && o.wet.length === 2 && o.wet.every((w) => w < -2), o);
  if (o.jets) t(`...hullborne on her diesels alone (the turbine shut down): ${o.kn.toFixed(1)} kn (about 12: ±12 %)`, Math.abs(o.kn / 12 - 1) <= 0.12, o);
  else console.log('     (skip) pegazus: the hullborne run waits for waterjets that push (WP6)');
}
// the Catalyna, a flying boat (kind plane): started as Flight.start starts a plane with a hull, on the water off the bay
// (a Seagull's spot), she floats on her hull at its marks, level on her wingtip floats, through 30 s of a Moderate sea
{
  const o = R(`(() => { Ship.setSea('moderate'); const T = TEMPLATES.catalyna, ps = partsFromDesign(templateRows(T)), adj = buildAdjacency(ps), v = new Vessel(ps, adj, EARTH); v.kind = 'plane'; v.stages = computeStages(ps, adj, findControlPart(ps).id); v.rebuildGroups();
    v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites.bay.east), VEHICLE_KINDS.plane.launchRot, 0, Math.PI); const L = Ship.launch(v), F = fsim(v); let nan = false, heel = 0, low = Infinity;
    const r0 = { hydro: v.hydro, marks: marks(v), mass: v.mass / 1000, L: !!(L && L.ok) }; let dr = 0, fs = 0, n = 0;
    tick(F, 30, (tt) => { if (bad(v)) nan = true; heel = Math.max(heel, Math.abs(v.heel)); if (tt > 20) { dr += v.draft; fs += v.sh.fsub; n++; } });
    return { ...r0, nan, heel: heel * ${D}, draft: dr / n, fsub: fs / n, afloat: v.afloat, parts: v.parts.length, of: ps.length, splashed: v.splashed }; })()`);
  t(`catalyna: a flying boat (kind plane) launched afloat off the bay on her hull, ${o.mass.toFixed(1)} t (spec 12 t ±10 %), drawing ${o.draft.toFixed(2)} m at her ${o.marks.toFixed(2)} m marks (±0.3)`, o.hydro && o.L && Math.abs(o.mass / 12 - 1) <= 0.1 && Math.abs(o.draft - o.marks) <= 0.3, o);
  t(`...30 s of a Moderate sea: still afloat (the water carrying ${(o.fsub * 100).toFixed(0)} % of her weight over the last 10 s), all her parts aboard, heeling at most ${o.heel.toFixed(1)}° (under 10°: her wingtip floats), no NaN`, o.afloat && o.parts === o.of && o.heel < 10 && !o.nan && o.fsub > 0.9, o);
}

// ================================================================ §waves
{
  const W = (e, n, tt) => R(`Ship.wave(${e}, ${n}, ${tt}).slice()`);
  R(`Ship.setSea('moderate');`);
  const a = W(1234.5, -876.25, 333.3), b = W(1234.5, -876.25, 333.3), c = G.run(G.load({ combat: true }), `Ship.wave(1234.5, -876.25, 333.3).slice()`);
  t('Ship.wave is deterministic: the same (e, n, t) the same answer, in another game too', a.join() === b.join() && a.join() === c.join(), [a, c]);
  // the slopes are the height's own derivatives
  const h = 0.01, e1 = W(1234.5 + h, -876.25, 333.3)[0], e0 = W(1234.5 - h, -876.25, 333.3)[0], n1 = W(1234.5, -876.25 + h, 333.3)[0], n0 = W(1234.5, -876.25 - h, 333.3)[0];
  t('...its slopes are its height\'s derivatives east and north', Math.abs((e1 - e0) / (2 * h) - a[1]) < 1e-5 && Math.abs((n1 - n0) / (2 * h) - a[2]) < 1e-5, [a, (e1 - e0) / (2 * h), (n1 - n0) / (2 * h)]);
  for (const [sea, Hs] of [['calm', 0.3], ['moderate', 1.0], ['rough', 2.5]]) {
    const s = R(`(() => { Ship.setSea('${sea}'); let s = 1, sum = 0, sq = 0; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647, n = 10000;
      for (let i = 0; i < n; i++) { const h = Ship.wave(rnd() * 20000 - 10000, rnd() * 20000 - 10000, rnd() * 3600)[0]; sum += h; sq += h * h; } return { hs: 4 * Math.sqrt(sq / n - (sum / n) ** 2) }; })()`);
    t(`${sea}: significant height ${s.hs.toFixed(2)} m from 10,000 samples, within 10 % of ${Hs} m`, Math.abs(s.hs / Hs - 1) < 0.1, s);
  }
  R(`Ship.setSea('moderate');`);
  t('the swell fades in shallow water: none under 3 m, all of it past 25 m', R('Ship.fadeAt(2) === 0 && Ship.fadeAt(0) === 0 && Ship.fadeAt(-5) === 0 && Ship.fadeAt(25) === 1 && Ship.fadeAt(60) === 1 && Ship.fadeAt(14) > 0.3 && Ship.fadeAt(14) < 0.7'));
  // a ship on a lake (Terrain made to report one under her for the test): its level, and no waves
  R(`var lk = cyclon({ e: -2300, z: 0, yaw: 0 }), hA = Terrain.heightAt, iA = Terrain.inlandAt; Terrain.heightAt = () => 30; Terrain.inlandAt = () => 50;
  lk.sh.wx = NaN; Ship.forces(lk, 1 / 120, v3(), v3(), fsim(lk)); var lake = { level: lk.sh.level, lake: lk.sh.lake, fade: lk.sh.fade, depth: lk.sh.depth };
  Terrain.heightAt = hA; Terrain.inlandAt = iA;`);
  t('on a lake: still water at its surface, no waves (fade 0)', R('lake.level === 50 && lake.lake === true && lake.fade === 0 && lake.depth === 20'), R('lake'));
  // the shader's uniforms (spec §5.2): the CPU folds the patch's origin and the time into each phase in double precision;
  // the shader's float32 sums from them agree with Ship.wave within 1 mm across a 512 m patch far from the pad
  const bad2 = R(`(() => { const f = Math.fround, P0e = 18234.5, P0n = -7351.25, tt = 86400 * 3 + 0.37, U = Ship.waveUniforms(P0e, P0n, tt); let worst = 0, s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 50; i++) {
      const le = f(rnd() * 512 - 256), ln = f(rnd() * 512 - 256);
      let h = 0; for (let k = 0; k < U.length / 6; k++) { const ph = f(f(U[6 * k + 2] * f(f(U[6 * k] * le) + f(U[6 * k + 1] * ln))) + U[6 * k + 5]); h = f(h + f(U[6 * k + 3] * f(Math.sin(ph)))); }
      worst = Math.max(worst, Math.abs(h - Ship.wave(P0e + le, P0n + ln, tt)[0]));
    } return worst; })()`);
  t(`waveUniforms: the shader's float32 sum agrees with Ship.wave within 1 mm at 50 points of a patch 18 km out, three days in (worst ${(bad2 * 1000).toFixed(3)} mm)`, bad2 < 0.001, bad2);
}

// ================================================================ §gates
// every hook is shut for old designs: a handful of old templates' 12 s traces (a seaplane on the bay's water, a buggy
// into the sea, a rocket, a tank) are the same with ship.js loaded and without it; and with it no call into Ship
{
  const run = (c) => G.run(c, `(() => { const out = [];
    for (const [k, at] of [['seagull', 'bay'], ['buggy', 'sea'], ['skylark', 'site'], ['tk34', 'site'], ['hornet', 'site']]) {
      if (!TEMPLATES[k]) continue;
      const rows = templateRows(TEMPLATES[k]).map((r) => ({ ...r })), parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
      const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
      const v = new Vessel(ps, adj, EARTH); v.kind = TEMPLATES[k].kind || 'rocket'; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups();
      const K = VEHICLE_KINDS[v.kind]; v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[at === 'site' ? K.site : 'bay'].east), K.launchRot, 0, at === 'bay' ? Math.PI : 0);
      for (const id of v.stages[v.stageIdx] || []) { const p = v.byId.get(id); if (p && p.def.thrust) p.active = true; } v.stageIdx++; v.throttle = 0.9;
      const F = { time: 0, toasts: [], broken: [], vessels: [v], active: v, running: true, camAbs: { x: 0, y: 0, z: 0 }, toast() {}, ripParts() {}, breakParts() {} };
      for (let i = 0; i < 12 * 120; i++) { const tt = i / 120; v.ctl.v = at === 'sea' || k === 'tk34' ? 1 : tt > 2 && tt < 4 ? -0.6 : 0; v.ctl.h = tt > 4 && tt < 5 ? 1 : 0; v.physicsStep(1 / 120, F); F.time += 1 / 120; if (i % 4 === 0) Combat.frame(F, 1 / 30); }
      out.push([k, v.x, v.y, v.z, v.vx, v.vy, v.vz, v.q.w, v.q.x, v.landed, v.splashed, !!Combat.S.sea]);
    } return JSON.stringify(out); })()`);
  const withShip = G.load({ combat: true, ground: true }), without = G.load({ combat: true, ground: true, ship: false });
  G.run(withShip, `var CALLS = 0; for (const k of Object.keys(Ship)) if (typeof Ship[k] === 'function') { const f = Ship[k]; Ship[k] = function (...a) { CALLS++; return f.apply(this, a); }; }`);
  const a = run(withShip), b = run(without);
  t('old craft on the sea and land (a Seagull at the bay, a buggy into the sea, a rocket, a tank, a jet): 12 s the same with ship.js and without, no call into Ship, Combat.S.sea shut', a === b && G.run(withShip, 'CALLS') === 0 && !a.includes('true]'), [a.slice(0, 200), G.run(withShip, 'CALLS')]);
}

R('still(false)');
t.done();
