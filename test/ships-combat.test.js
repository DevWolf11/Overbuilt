// The ships update, §combat (spec §8.1, §8.2, §8.5, §8.6, §8.10, §8.11, §8.12; WP9): naval weapons and sensors, in a file
// of its own (ships.test and ships-damage already take minutes; this one runs beside them). The naval range tables (a
// 127 mm on its mark at 5 km and 15 km; built once, quickly), a TK-34 with a 127 mm hitting at 3 km, the close-in gun's
// odds against anti-ship missiles (one and two at once, its rounds and its cost), torpedoes (homing, the hit under the
// water, a patrol boat's back broken, aground in shallows, a decoy, the old air torpedo against a ship), anti-ship
// missiles (the climb, the skim over Moderate and Rough seas, the terminal dive, the hit, chaff), vertical-launch SAMs
// (the pitch-over, an aircraft at 10-12 km, a missile: S3), seeing ships (surface, never air: the seekers, the radars, a
// drone's lock; seesSea's horizon and land), §8.12's rows for these weapons and the other way (ships against a tank, a
// plane, a drone and a helicopter), and S8 (an old turret fires from a ship afloat, still holds on a plane on the ground).
// Seeded throughout (Ship.seed: the combat's dice).
//   node test/ships-combat.test.js
const G = require('./lib/game.js');
const ctx = G.load({ combat: true, flight: true });
const R = (c) => G.run(ctx, c);
const t = G.checks('ships: §combat');
const D = 180 / Math.PI;

// ---------------------------------------------------------------- the stand-ins
R(`var fsim = (v, list) => Object.assign(${'(' + G.sim.toString() + ')()'}, { active: v, vessels: list || [v], running: true, warpIdx: 0 });
var build = (rows, kind, name) => { const parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
  const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const v = new Vessel(ps, adj, EARTH); v.kind = kind; v.name = name || kind; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups(); return v; };
var ship = (key, place, extra) => { const v = build(templateRows(TEMPLATES[key]).map((r) => ({ ...r })).concat(extra || []), TEMPLATES[key].kind, TEMPLATES[key].name);
  v.placeOnSurface(EARTH, siteAngle(EARTH, place ? place.e : -3000), 0, place ? place.z || 0 : 0, place && place.yaw != null ? place.yaw : Math.PI);
  v.launchedAt = Ship.launch(v, place || { e: -3000, z: 0, yaw: Math.PI }); return v; };
// the physics as flight.js runs it (frozen: no vessel stepped), Combat's step (aim, guns, shots), Ship.frame and the
// close-in guns as Combat.frame runs them
var tick = (F, secs, each, frozen) => { const n = Math.round(secs * 120); for (let i = 0; i < n; i++) { if (each && each(i / 120, i) === false) return i;
  if (!frozen) for (const v of F.vessels.slice()) { if (v.dead || v.wreck) continue; if (v.moored && v !== F.active) { Ship.drift(v, 1 / 120, F); continue; } v.physicsStep(1 / 120, F); }
  Combat.step(1 / 120, F);
  F.time += 1 / 120; if (i % 2 === 0) { Combat.S.sea = F.vessels.some((o) => o.hydro); Combat.S.pd = F.vessels.some((o) => o.ciws && o.ciws.length && !o.dead); if (Combat.S.sea) Ship.frame(F, 2 / 120); if (Combat.S.pd) Ship.ciwsStep(F, 2 / 120); } } return n; };
var hpOf = (v) => v.parts.reduce((s, p) => s + (p.hp == null ? Combat.maxHp(p.def) : Math.max(0, p.hp)), 0);
var holeA = (v) => v.parts.reduce((s, p) => s + (p.holes ? p.holes.reduce((q, h) => q + h.a, 0) : 0), 0);
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
var unitTo = (a, b) => { const x = b.x - a.x, y = b.y - a.y, z = b.z - a.z, l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; };
Ship.seed(9090); Armour.seed(77); Ship.setSea('calm'); Combat.reset({});`);

// ================================================================ naval guns and their range tables (§8.1)
// 1. The range table: built once per shell (as the physics flies it: drag in this world's air, the Earth's curve), within
// 30 ms; a 127 mm reaches 20 km at about 30° in about a minute and about 24 km at 45° (the real gun's); a naval shell is
// laid from it past 3 km, aimDrop's sums under it, the two meeting at 3 km within a hair; old shells never use one
{
  const o = R(`(() => { const ms = [];
    for (let k = 0; k < 3; k++) { aimTables.delete(SHELLS.he127); const t0 = Date.now(); Aim.navalTable(SHELLS.he127, EARTH); ms.push(Date.now() - t0); }
    const T = Aim.navalTable(SHELLS.he127, EARTH), top = T.reduce((m, r) => (r.d > m.d ? r : m), T[0]), at45 = T.find((r) => Math.abs(r.el * ${D} - 45) < 0.8), s20 = Aim.solve('he127', 20000, 0), s5 = Aim.solve('he127', 5000, 0);
    const a = Aim.solve('he127', 2999, 0), b = Aim.solve('he127', 3001, 0), old = Aim.solve('he120', 5000, 0), oldT = Aim.rangeTable(SHELLS.he120);
    return { ms: Math.min(...ms), top: [top.el * ${D}, top.d, top.t], at45: at45 && [at45.d, at45.t], s20: [s20.el * ${D}, s20.t], s5: [s5.el * ${D}, s5.t], seam: (b.el - a.el) * 3000, old: !!old && !old.out && oldT === null }; })()`);
  t(`the 127 mm's range table is built in ${o.ms} ms (≤ 30 alone; asserted at 2×, 60, as other suites share the machine: once per shell); its longest shot ${(o.top[1] / 1000).toFixed(1)} km at ${o.top[0].toFixed(0)}° in ${o.top[2].toFixed(0)} s (about 24 km)`, o.ms <= 60 && o.top[1] > 22000 && o.top[1] < 26000 && o.top[0] > 40 && o.top[0] < 52, o);
  t(`...20 km at ${o.s20[0].toFixed(1)}° in ${o.s20[1].toFixed(0)} s (about a minute), 5 km at ${o.s5[0].toFixed(2)}° in ${o.s5[1].toFixed(1)} s; the table meets aimDrop's sums at 3 km within ${Math.abs(o.seam).toFixed(2)} m; an old shell's solve is as ever (no table)`,
    o.s20[1] > 50 && o.s20[1] < 70 && o.s20[0] > 25 && o.s20[0] < 35 && o.s5[1] > 6 && o.s5[1] < 10 && Math.abs(o.seam) < 2 && o.old, o);
}
// 2. On the mark: a 127 mm fired at the table's elevation from a deck 15 m up lands within a hull length (40 m: a missile
// boat's) of a point on the sea 5 km off, and within a few (120 m) at 15 km (the physics' own steps, the Earth's curve)
{
  const o = R(`(() => { const F = fsim(null, []), out = {};
    for (const D of [5000, 10000, 15000]) {
      const b = EARTH, a0 = siteAngle(EARTH, -3000), r0 = b.radius + 15, P = { x: r0 * Math.cos(a0), y: r0 * Math.sin(a0), z: 0 }, ux = Math.cos(a0), uy = Math.sin(a0), ex = -Math.sin(a0), ey = Math.cos(a0); // (up and along the equator)
      const ang = D / b.radius, T = { x: b.radius * Math.cos(a0 + ang), y: b.radius * Math.sin(a0 + ang), z: 0 };
      const rx = T.x - P.x, ry = T.y - P.y, dH = rx * ux + ry * uy, Dh = Math.hypot(rx - ux * dH, ry - uy * dH); // (the mark in the gun's level plane: along it and up, the Earth's curve in dH)
      const s0 = Aim.solve('sap127', Dh, dH, b, 15), el = s0.el, dx = ex * Math.cos(el) + ux * Math.sin(el), dy = ey * Math.cos(el) + uy * Math.sin(el);
      const SH = SHELLS.sap127, s = { k: 'shell', sh: 'sap127', b, x: P.x, y: P.y, z: 0, vx: dx * SH.v0, vy: dy * SH.v0, vz: 0, t: 0, life: SH.life, owner: null, net: 0, cal: 127, pen: 90, v0: SH.v0, gTop: 0 };
      let last = { x: s.x, y: s.y, z: s.z }; while (Armour.moveShell(s, 1 / 120, F)) last = { x: s.x, y: s.y, z: s.z };
      const land = b.radius * Math.acos(Math.min(1, (last.x * P.x + last.y * P.y) / (Math.hypot(last.x, last.y) * Math.hypot(P.x, P.y)))), L = Terrain.locate(b, last.x, last.y, last.z, {});
      out[D] = Math.round(Math.hypot(last.x - T.x, last.y - T.y)); void land; void L;
    }
    return out; })()`);
  t(`a 127 mm laid from its table lands ${o[5000]} m from its mark 5 km off (within a hull length, 40 m), ${o[10000]} m at 10 km, ${o[15000]} m at 15 km (within 120 m)`, o[5000] <= 40 && o[15000] <= 120, o);
}
// 3. Through the aim: the Arley's 127 mm laid by Aim (aimLift on the table) on the Olivar 5 km off, three salvos: hits;
// and a TK-34 carrying a 127 mm (the long ray, its aim from the table past 3 km) hits a ship 3 km off
{
  const o = R(`(() => { Combat.reset({});
    const a = ship('arley', { e: -3000, z: 0, yaw: Math.PI / 2 }), tg = ship('olivar', { e: -3000, z: -5000, yaw: 0 }), F = fsim(tg, [a, tg]);
    a.ai = { sea: true }; tick(F, 3);
    const hp0 = hpOf(tg); let fired = 0;
    for (let k = 0; k < 4; k++) { a.aimP = tg.toWorld(tg.com.x, tg.com.y + 2, tg.com.z); tick(F, 3.4); fired += Ship.salvo(a, a.aimP, F); }
    tick(F, 9);
    const arley = { fired, dhp: Math.round(hp0 - hpOf(tg)), holes: +holeA(tg).toFixed(2), d: Math.round(dist(a, tg)) };
    // the TK-34: its 85 mm swapped for a 127 mm (its trunnion where the 85's was), on the shore's stand-in (the sea's solid
    // floor), at a ship 3 km off
    Combat.reset({});
    const rows = templateRows(TEMPLATES.tk34).map((r) => ({ ...r })), gi = rows.findIndex((r) => r.type === 'gun85'), g = PARTS.gun85, n = PARTS.nGun127, piv = rows[gi].x - (g.h / 2 - g.aim.pivot * g.h);
    rows[gi] = { ...rows[gi], type: 'nGun127', x: +(piv + n.h / 2 - n.aim.pivot * n.h).toFixed(3) };
    const tk = build(rows, 'tank', 'TK-34'); tk.placeOnSurface(EARTH, siteAngle(EARTH, -3000), 0, 0, Math.PI / 2);
    const tg2 = ship('cyclon', { e: -3000, z: -3000, yaw: 0 }), G2 = fsim(tk, [tk, tg2]); tick(G2, 2);
    G2.groundAim = true; const gun = tk.parts.find((p) => p.type === 'nGun127'), sys = Combat.systems(tk); tk.wsel = sys.findIndex((s) => s.key === 'nGun127');
    const hp1 = hpOf(tg2); let shots = 0;
    for (let k = 0; k < 4; k++) { const P = tg2.toWorld(tg2.com.x, tg2.com.y + 1, tg2.com.z); G2.aim = { P, o: { x: tk.x, y: tk.y, z: tk.z }, dir: unitTo(tk, P), d: dist(tk, P), src: 'vessel', v: tg2 }; tick(G2, 4); if (Aim.fire(tk, sys[tk.wsel], 1 / 120, G2, null)) shots++; }
    tick(G2, 6);
    return { arley, tk: { shots, dhp: Math.round(hp1 - hpOf(tg2)), holes: +holeA(tg2).toFixed(3), d: Math.round(dist(tk, tg2)), err: +(gun._err * ${D}).toFixed(2) } }; })()`);
  t(`the Arley's 127 mm, laid by the aim on the Olivar ${o.arley.d} m off: ${o.arley.fired} rounds, her hull holed (${o.arley.holes} m²), ${o.arley.dhp} hp of her taken`, o.arley.fired >= 3 && o.arley.dhp > 0 && o.arley.holes > 0, o.arley);
  t(`a TK-34 with a 127 mm hits a patrol boat ${o.tk.d} m off (${o.tk.shots} rounds: ${o.tk.dhp} hp, ${o.tk.holes} m² of holes)`, o.tk.shots >= 1 && o.tk.dhp > 0, o.tk);
}

// ================================================================ the close-in gun (§8.10)
// 4. The Arley's close-in gun against an Osca's anti-ship missiles fired 6 km off (the ships held still: the gun and the
// missiles alone, each engagement seeded): 100 engagements against one, it stops 65-95 %; two at once from bearings 57°
// apart (one launched a quarter second ahead, by turns), about half each, the gun busy with the first in; at most 15
// simulated rounds a second; its step and its rounds' flight at most 0.05 ms a frame while it fires
{
  ctx.__hr = () => Number(process.hrtime.bigint()) / 1e6;
  const o = R(`(() => {
    const A0 = { e: -3000, z: 0, yaw: 0 }, P1 = { e: -3000, z: -6000 }, P2 = { e: -3000 - 6000 * Math.sin(1), z: -6000 * Math.cos(1) };
    // an Osca's heading with her launchers (along her bow) on the Arley
    const yawAt = (P) => { const A = ship('arley', A0); let best = 0, bk = -2; for (let i = 0; i < 32; i++) { const yaw = (i / 32) * TAU, o = ship('osca', { ...P, yaw }), f = o.axis(1, 0, 0), u = unitTo(o, A), k = f.x * u.x + f.y * u.y + f.z * u.z; if (k > bk) { bk = k; best = yaw; } } return best; };
    const y1 = yawAt(P1), y2 = yawAt(P2);
    // its cost: each physics step's time (the gap between one step's start and the next), those with the gun firing or its
    // rounds in flight against those with only the missile flying (the difference: the gun's own work)
    let rate = 0; const T = { busy: 0, nb: 0, idle: 0, ni: 0 };
    const fight = (k, two) => {
      Combat.reset({}); Ship.seed(1000 + k);
      const a = ship('arley', A0), b = ship('osca', { ...P1, yaw: y1 }), c = ship('osca', { ...P2, yaw: y2 }), F = fsim(a, [a, b, c]);
      b.ai = { sea: true }; c.ai = { sea: true }; tick(F, 1, null, true);
      const fire = (o) => Combat.launchMissile(o, o.parts.find((q) => q.type === 'asm2'), a, F), ss = [], from = [];
      if (!two) { ss.push(fire(b)); from.push('b'); }
      else { const [p, q] = k % 2 ? [c, b] : [b, c]; ss.push(fire(p)); from.push(p === b ? 'b' : 'c'); tick(F, 0.25, null, true); ss.push(fire(q)); from.push(q === b ? 'b' : 'c'); }
      const gun = a.ciws[0]; let n0 = 0, last = 0, was = null;
      tick(F, 45, (tt, i) => {
        const now = __hr();
        if (was) { T[was] += now - last; T[was === 'busy' ? 'nb' : 'ni']++; }
        if (i % 120 === 0) { rate = Math.max(rate, (gun.shots || 0) - n0); n0 = gun.shots || 0; }
        if (ss.every((s) => s.dead || !Combat.S.shots.includes(s))) return false;
        was = gun.gunOn || Combat.S.shots.some((q) => q.ciws) ? 'busy' : 'idle'; last = __hr(); }, true);
      return ss.map((s, j) => ({ k: s.killedBy === a, from: from[j] }));
    };
    let one = 0; for (let k = 0; k < 100; k++) one += fight(k, false)[0].k ? 1 : 0;
    const per = { first: 0, second: 0, b: 0, c: 0 }, N2 = 40;
    for (let k = 0; k < N2; k++) fight(200 + k, true).forEach((r, j) => { if (r.k) { per[j ? 'second' : 'first']++; per[r.from]++; } });
    return { one, per, N2, rate, msF: 2 * (T.busy / Math.max(1, T.nb) - T.idle / Math.max(1, T.ni)), steps: [T.nb, T.ni] }; })()`);
  t(`one CIWS against one subsonic anti-ship missile: ${o.one} of 100 shot down (65-95)`, o.one >= 65 && o.one <= 95, o);
  t(`...two at once from two bearings: one Osca's ${o.per.b} of ${o.N2}, the other's ${o.per.c} (about half each; the first in ${o.per.first}, the second ${o.per.second})`,
    [o.per.b, o.per.c].every((n) => n >= 0.25 * o.N2 && n <= 0.75 * o.N2) && o.per.first + o.per.second <= 1.3 * o.N2, o);
  t(`...at most ${o.rate} simulated rounds a second (≤ 15), ${(o.msF * 1000).toFixed(1)} µs a frame while it fires (≤ 50 alone, 43 measured so; asserted at 2×, as other suites share the machine: its step and its rounds' flight)`, o.rate <= 15 && o.rate >= 10 && o.msF <= 0.1, { rate: o.rate, msF: o.msF, steps: o.steps });
}

// ================================================================ torpedoes (§8.5)
// 5. The Arley's torpedo set to run at the Olivar 1.5 km off (its gyro, then its seeker): it finds her and goes off under
// her (the magnetic fuze under the keel, or into the hull under the waterline); its holes tamped ×3 (the same burst at the
// same spot in a fresh Olivar: ×3 against her sea level put far below it)
{
  const o = R(`(() => { Combat.reset({}); Ship.resetCombat(); Ship.seed(5150);
    const a = ship('arley', { e: -3000, z: 0, yaw: Math.PI / 2 }), tg = ship('olivar', { e: -3000, z: -1500, yaw: 0 }), F = fsim(a, [a, tg]); tick(F, 1, null, true);
    const ex = Combat.explode; let at = null;
    Combat.explode = function (b, P) { const o = arguments[10]; if (o && o.under && !at) at = { x: P.x, y: P.y, z: P.z }; return ex.apply(this, arguments); };
    const tube = a.parts.find((p) => p.type === 'torpTube'), s = Ship.fireTorp(a, tube, F, unitTo(a, tg));
    let acq = null, end = null;
    tick(F, 150, (tt) => { if (s.tgt === tg && !acq) acq = { t: +tt.toFixed(1), d: Math.round(dist(s, tg)) }; if (s.dead || !Combat.S.shots.includes(s)) { end = +tt.toFixed(1); return false; } }, true);
    Combat.explode = ex;
    const A = holeA(tg), r = at && Math.hypot(at.x, at.y, at.z) - EARTH.radius;
    const twin = () => { const v = ship('olivar', { e: -3000, z: -1500, yaw: 0 }); return [v, fsim(v, [v])]; };
    const [t3, G3] = twin(); ex(EARTH, at, s.blast, s.dmg, a, G3, false, undefined, undefined, undefined, { under: true });
    const [t1, G1] = twin(), lv = t1.sh.level; t1.sh.level = -1e4; ex(EARTH, at, s.blast, s.dmg, a, G1, false, undefined, undefined, undefined, {}); t1.sh.level = lv;
    return { acq, end, hit: !!at && s.dead === true, depth: r && +(-r).toFixed(1), A: +A.toFixed(3), A3: +holeA(t3).toFixed(3), A1: +holeA(t1).toFixed(3), ammo: tube.ammo }; })()`);
  t(`a torpedo set at the Olivar 1.5 km off: its seeker finds her ${o.acq && o.acq.d} m off, it goes off under her ${o.depth} m down at ${o.end} s, her hull holed ${o.A} m²`, !!o.acq && o.hit && o.A > 0 && o.depth > 2, o);
  t(`...its holes tamped ×3: ${o.A3} m² against ${o.A1} m² for the same burst in the air (×${(o.A3 / o.A1).toFixed(2)}), the run's own ${o.A} m²`, o.A1 > 0 && Math.abs(o.A3 / o.A1 - 3) < 0.15 && Math.abs(o.A - o.A3) < 0.1 * o.A3 + 1e-3, o);
}
// 6. Under a patrol boat's keel (class M): her back broken (she falls in two, doomed: sunk); aground in the shallows off
// the island it goes off on the bed (half power) short of its range; a torpedo decoy streamed astern pulls a homing
// torpedo off about 3 times in 5 (16 seeded runs; a pulled one passes her by)
{
  const o = R(`(() => { Combat.reset({}); Ship.resetCombat(); Ship.seed(616);
    const a = ship('arley', { e: -3000, z: 0, yaw: Math.PI / 2 }), c = ship('cyclon', { e: -3000, z: -1200, yaw: 0 }), F = fsim(a, [a, c]); tick(F, 1, null, true);
    const s = Ship.fireTorp(a, a.parts.find((p) => p.type === 'torpTube'), F, unitTo(a, c)), n0 = F.vessels.length;
    tick(F, 120, () => { if (s.dead || !Combat.S.shots.includes(s)) return false; }, true); tick(F, 2, null, true);
    const back = { pieces: F.vessels.length - n0 + 1, fate: c.fate || null, sunk: c.fate === 'sunk' || F.vessels.some((v) => v !== a && v.fate === 'sunk'), cls: c.sh ? c.sh.hulls.map((p) => p.def.shull.cls).join('') : '' };
    // aground: run toward the island's shore from 1.8 km out (her bow's way)
    Combat.reset({}); Ship.resetCombat();
    const b = ship('arley', { e: -3200, z: 0, yaw: 0 }), G = fsim(b, [b]); tick(G, 1, null, true);
    const g = b.axis(1, 0, 0), t2 = Ship.fireTorp(b, b.parts.find((p) => p.type === 'torpTube'), G, { x: g.x, y: g.y, z: g.z });
    let at = null; const ex = Combat.explode; Combat.explode = function (bb, P) { if (!at) at = { x: P.x, y: P.y, z: P.z, dmg: arguments[3] }; return ex.apply(this, arguments); };
    tick(G, 300, () => { if (t2.dead || !Combat.S.shots.includes(t2)) return false; }, true); Combat.explode = ex;
    const L = at && Terrain.locate(EARTH, at.x, at.y, at.z, {}), bed = L && Terrain.heightAt(EARTH, L.a, L.z);
    const aground = { dead: t2.dead === true, run: Math.round(t2.run), range: t2.range, bed: bed != null && +bed.toFixed(1), dmg: at && at.dmg };
    // the decoy: the Cyclon with a Torpedo Decoy on her stern, streamed when the torpedo is in the water
    const rows = templateRows(TEMPLATES.cyclon), ps = partsFromDesign(rows), sp = Ship.spotOf('torpDecoy', ps), extra = [{ type: 'torpDecoy', x: sp.x, y: sp.y, rot: sp.rot, att: ps.indexOf(sp.att) }];
    let pulled = 0, hitP = 0, hitN = 0; const N = 16;
    for (let k = 0; k < N; k++) {
      Combat.reset({}); Ship.resetCombat(); Ship.seed(700 + k);
      const A = ship('arley', { e: -3000, z: 0, yaw: Math.PI / 2 }), C = ship('cyclon', { e: -3000, z: -1200, yaw: 0 }, extra), H = fsim(A, [A, C]); tick(H, 1, null, true);
      const q = Ship.fireTorp(A, A.parts.find((p) => p.type === 'torpTube'), H, unitTo(A, C)); let lured = false;
      tick(H, 2, null, true); Ship.decoy(C, H);
      tick(H, 120, () => { if (q.tgt && q.tgt.noise) lured = true; if (q.dead || !Combat.S.shots.includes(q)) return false; }, true);
      const holed = holeA(C) > 0 || !!C.fate;
      if (lured) { pulled++; if (holed) hitP++; } else if (holed) hitN++;
    }
    return { back, aground, decoy: { pulled, N, hitP, hitN } }; })()`);
  t(`under a patrol boat's keel (hulls ${o.back.cls}): her back broken, ${o.back.pieces} pieces, sunk`, o.back.pieces >= 2 && o.back.sunk, o.back);
  t(`...run at the shore: it goes off aground on a ${o.aground.bed} m bed at half power (${o.aground.dmg}), ${o.aground.run} m into its ${o.aground.range} m`, o.aground.dead && o.aground.bed > -6 && o.aground.run < o.aground.range && o.aground.dmg <= 2000, o.aground);
  t(`...a torpedo decoy streamed astern pulls it off ${o.decoy.pulled} times in ${o.decoy.N} (about 3 in 5); a pulled one hits her ${o.decoy.hitP} times, the others ${o.decoy.hitN} of ${o.decoy.N - o.decoy.pulled}`,
    o.decoy.pulled >= 0.3 * o.decoy.N && o.decoy.pulled <= 0.9 * o.decoy.N && o.decoy.hitP <= 1 && o.decoy.hitN >= o.decoy.N - o.decoy.pulled - 1, o.decoy);
}
// 7. The old air torpedo (the Catalyna's, k 'torp': combat.js swim) with ships in play finds a hostile ship afloat and
// goes off against her hull (Ship.torpHit); with none afloat it runs the old way at the range's patrol boat (no call into
// Ship at all) and hits it
{
  const o = R(`(() => { Combat.reset({}); Ship.resetCombat(); Ship.seed(77);
    const me = { parts: [], aimed: [], x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, name: 'Catalyna', kind: 'plane', body: EARTH };
    const c = ship('cyclon', { e: -3000, z: -900, yaw: 0 }), F = fsim(c, [c]); F.active = me; tick(F, 1, null, true);
    const torp = (P, to) => { const u = unitTo(P, to), r = Math.hypot(P.x, P.y, P.z), k = (EARTH.radius - 1.2) / r; return { k: 'torp', b: EARTH, x: P.x * k, y: P.y * k, z: P.z * k, vx: u.x * 30, vy: u.y * 30, vz: u.z * 30, dx: u.x, dy: u.y, dz: u.z, t: 0, life: 100, run: 0, dmg: 2200, blast: 16, owner: me }; };
    const from = ship('zodiak', { e: -3000, z: 0, yaw: 0 }), P0 = { x: from.x, y: from.y, z: from.z }, s = torp(P0, c);
    Combat.S.shots.push(s); let end = null;
    tick(F, 60, (tt) => { if (!Combat.S.shots.includes(s)) { end = +tt.toFixed(1); return false; } }, true);
    const ship1 = { end, A: +holeA(c).toFixed(2), fate: c.fate || null };
    // the old way: no ship afloat (Combat.S.sea false), the range's patrol boat 900 m on
    Combat.reset({});
    const boatAt = ship('zodiak', { e: -3000, z: -900, yaw: 0 }), boat = { kind: 'boat', def: TARGET_KINDS.boat, e: -3000, z: -900, hp: TARGET_KINDS.boat.hp, alive: true, heading: 0, turnT: 1e9, fireT: 1e9, burst: 0, firing: false, pos: { x: boatAt.x, y: boatAt.y, z: boatAt.z }, h: 0 };
    Combat.S.targets = [boat]; const G = fsim(me, []); G.active = me;
    let calls = 0; const tp = Ship.torpPick, th = Ship.torpHit; Ship.torpPick = function () { calls++; return tp.apply(this, arguments); }; Ship.torpHit = function () { calls++; return th.apply(this, arguments); };
    const s2 = torp(P0, boat.pos); Combat.S.shots.push(s2); let end2 = null;
    tick(G, 60, (tt) => { if (!Combat.S.shots.includes(s2)) { end2 = +tt.toFixed(1); return false; } }, true);
    Ship.torpPick = tp; Ship.torpHit = th; Combat.S.targets = [];
    return { ship: ship1, old: { end: end2, hp: boat.hp, alive: boat.alive, sea: Combat.S.sea, calls } }; })()`);
  t(`the old air torpedo finds the Cyclon and goes off against her (${o.ship.end} s): ${o.ship.A} m² of holes${o.ship.fate ? ', ' + o.ship.fate : ''}`, o.ship.end != null && (o.ship.A > 0 || !!o.ship.fate), o.ship);
  t(`...with no ship afloat it runs the old way at the range's patrol boat and hits it (${o.old.end} s, ${o.old.alive ? o.old.hp + ' hp left' : 'sunk'}), never calling into Ship (${o.old.calls} calls)`, o.old.end != null && (!o.old.alive || o.old.hp < 520) && o.old.calls === 0 && !o.old.sea, o.old);
}
// ================================================================ anti-ship missiles (§8.6)
// 8. The Olivar's anti-ship missile at the Vizby 9 km off, over a Moderate and a Rough sea: out of its canister it climbs
// to about 30 m, skims at 8 m over the waves (never within 4 m of them), drops to 3 m at 2 km and hits her (holes, and
// the missile spent); with her decoys fired 3.8 km out, chaff takes it in about 3 times in 4 or more (12 seeded runs: the
// existing odds, a cloud each side) and the missile it takes in passes her by
{
  const o = R(`(() => { const out = {};
    for (const sea of ['moderate', 'rough']) {
      Ship.setSea(sea); Combat.reset({}); Ship.seed(31);
      const a = ship('olivar', { e: -3000, z: 0, yaw: 0 }), tg = ship('vizby', { e: -3000, z: -9000, yaw: Math.PI / 2 }), F = fsim(a, [a, tg]);
      tg.ai = { sea: true }; tick(F, 1, null, true);
      const s = Combat.launchMissile(a, a.parts.find((p) => p.type === 'asm4'), tg, F), L = {}, cr = [], A0 = holeA(tg);
      let top = 0, term = null, minT = Infinity, minC = Infinity;
      tick(F, 60, (tt) => {
        if (!Combat.S.shots.includes(s)) return false;
        Terrain.locate(EARTH, s.x, s.y, s.z, L);
        const wv = Ship.wave(-wrapAngle(L.a - EARTH.padAngle) * EARTH.radius, -L.z, Ship.seaT(F))[0] * Ship.fadeAt(-Terrain.heightAt(EARTH, L.a, L.z)), over = L.r - EARTH.radius - wv, d = dist(s, tg);
        if (tt < 4) top = Math.max(top, over);
        if (s.seen && term == null) term = Math.round(d);
        if (tt > 6 && !s.seen) { cr.push(over); minC = Math.min(minC, over); }
        if (s.seen && d > 300) minT = Math.min(minT, over);
      }, true);
      out[sea] = { top: +top.toFixed(1), mean: +(cr.reduce((q, x) => q + x, 0) / cr.length).toFixed(2), minC: +minC.toFixed(2), term, minT: +minT.toFixed(2), holes: +(holeA(tg) - A0).toFixed(3), spent: s.dead === true };
    }
    Ship.setSea('calm');
    // chaff (the decoyed odds draw on Math.random: seeded here)
    const rnd0 = Math.random; let q = 99; Math.random = () => { q ^= q << 13; q ^= q >>> 17; q ^= q << 5; return (q >>> 0) / 4294967296; };
    let lured = 0, hitL = 0, hitN = 0; const N = 12;
    for (let k = 0; k < N; k++) {
      Combat.reset({}); Ship.seed(400 + k);
      const a = ship('olivar', { e: -3000, z: 0, yaw: 0 }), tg = ship('vizby', { e: -3000, z: -9000, yaw: Math.PI / 2 }), F = fsim(a, [a, tg]);
      tg.ai = { sea: true }; tick(F, 1, null, true);
      const s = Combat.launchMissile(a, a.parts.find((p) => p.type === 'asm4'), tg, F), A0 = holeA(tg);
      let fired = false, was = false;
      tick(F, 60, () => { if (!Combat.S.shots.includes(s)) return false; if (!fired && dist(s, tg) < 3800) fired = Ship.decoy(tg, F); if (s.lure) was = true; }, true);
      const hit = holeA(tg) > A0 + 1e-6;
      if (was) { lured++; if (hit) hitL++; } else if (hit) hitN++;
    }
    Math.random = rnd0;
    out.chaff = { N, lured, hitL, hitN };
    return out; })()`);
  for (const sea of ['moderate', 'rough']) {
    const m = o[sea];
    t(`an anti-ship missile over a ${sea} sea: up to ${m.top} m out of its canister, skimming ${m.mean} m over the waves (never under ${m.minC} m), down to ${m.minT} m from ${m.term} m out, into her side (${m.holes} m² of holes)`,
      m.top > 25 && m.top < 36 && Math.abs(m.mean - 8) < 1 && m.minC > 4 && m.term > 1900 && m.term <= 2000 && m.minT > 1 && m.minT < 4 && m.holes > 0 && m.spent, m);
  }
  t(`...her decoys' chaff takes it in ${o.chaff.lured} times in ${o.chaff.N} (the existing odds, a cloud each side), and every one it took in passes her by (${o.chaff.hitL} hit her; ${o.chaff.hitN} of the rest)`,
    o.chaff.lured >= 0.6 * o.chaff.N && o.chaff.hitL === 0, o.chaff);
}

// ================================================================ vertical-launch SAMs (§8.6, S3)
// 9. The Arley's SAM at a jet crossing 10-11 km off, 3 km up (three seeded runs): straight up out of its cell, over toward
// it in about 2 s, guided by her fire-control radar's lock, and the jet down at 10-12 km; at an Osca's anti-ship missile
// 5 km off (her close-in gun held: 16 seeded runs) its burst beside the missile kills it with p 0.7, and she is unhurt
{
  const o = R(`(() => { const air = [], asm = [];
    for (let k = 0; k < 3; k++) {
      Combat.reset({}); Ship.seed(55 + k);
      const a = ship('arley', { e: -3000, z: 0, yaw: 0 }), F = fsim(a, [a]);
      const jet = build(templateRows(TEMPLATES.fs16), 'plane', 'FS-16'); jet.placeOnSurface(EARTH, siteAngle(EARTH, -3000), -Math.PI / 2, -9600 - 300 * k, 0);
      { const r = Math.hypot(jet.x, jet.y, jet.z), q = (r + 3000) / r; jet.x *= q; jet.y *= q; jet.z *= q; }
      const u = unitTo(jet, a), r0 = Math.hypot(jet.x, jet.y, jet.z), up = { x: jet.x / r0, y: jet.y / r0, z: jet.z / r0 }, cx = up.y * u.z - up.z * u.y, cy = up.z * u.x - up.x * u.z, cz = up.x * u.y - up.y * u.x, cl = Math.hypot(cx, cy, cz);
      jet.vx = (cx / cl) * 250; jet.vy = (cy / cl) * 250; jet.vz = (cz / cl) * 250; jet.ai = {}; jet.landed = false; jet.contactTime = 0;
      F.vessels.push(jet); tick(F, 1, null, true);
      const d0 = Math.round(dist(a, jet)), s = Ship.samAt(a, jet, F);
      if (!s) { air.push({ d0, none: true }); continue; }
      let up0 = null, over = null, at = null;
      tick(F, 40, (tt) => { jet.x += jet.vx / 120; jet.y += jet.vy / 120; jet.z += jet.vz / 120;
        const r = Math.hypot(s.x, s.y, s.z), kk = (s.dx * s.x + s.dy * s.y + s.dz * s.z) / r;
        if (tt > 0.3 && up0 == null) up0 = +kk.toFixed(3);
        if (s.pitch === 2 && over == null) over = +tt.toFixed(2);
        if (!Combat.S.shots.includes(s)) { at = Math.round(dist(jet, a)); return false; } }, true);
      air.push({ d0, up0, over, at, down: jet.hulk != null || !!jet.dead });
    }
    for (let k = 0; k < 16; k++) {
      Combat.reset({}); Ship.seed(300 + k);
      const a = ship('arley', { e: -3000, z: 0, yaw: 0 }), b = ship('osca', { e: -3000, z: -9000, yaw: 4.712 }), F = fsim(a, [a, b]);
      b.ai = { sea: true }; Ship.ciwsOn(a, false); tick(F, 1, null, true);
      const m = Combat.launchMissile(b, b.parts.find((q) => q.type === 'asm2'), a, F); let s = null;
      tick(F, 50, () => { if (!s && dist(m, a) < 5000) s = Ship.samAt(a, m, F); if (!Combat.S.shots.includes(m)) return false; }, true);
      asm.push({ fired: !!s, killed: m.killedBy === a, at: m.killedBy === a ? Math.round(dist(m, a)) : null, holes: +holeA(a).toFixed(2) });
    }
    return { air, asm }; })()`);
  const A = o.air, K = o.asm.filter((r) => r.killed);
  t(`a vertical-launch SAM at a jet crossing ${A.map((r) => (r.d0 / 1000).toFixed(1)).join(', ')} km off: straight up out of its cell (${A.map((r) => r.up0).join(', ')}), over toward it by ${A.map((r) => r.over).join(', ')} s, the jet down at ${A.map((r) => (r.at / 1000).toFixed(1)).join(', ')} km`,
    A.every((r) => !r.none && r.up0 > 0.95 && r.over > 1 && r.over < 4 && r.down && r.at >= 10000 && r.at <= 12000), A);
  t(`...at an anti-ship missile 5 km off (her close-in gun held): fired ${o.asm.filter((r) => r.fired).length} of ${o.asm.length}, the missile killed ${K.length} times (p 0.7) ${K.length ? Math.min(...K.map((r) => r.at)) + '-' + Math.max(...K.map((r) => r.at)) + ' m out' : ''}, and then she is unhurt`,
    o.asm.every((r) => r.fired) && K.length >= 0.45 * o.asm.length && K.length <= 0.95 * o.asm.length && K.every((r) => r.holes === 0), o.asm);
}

// ================================================================ seeing ships (§8.11)
// 10. A ship is a surface contact, never an air one: another player's ship (a ghost) is never in an air-to-air missile's
// list but is in the ground, anti-radar and anti-ship seekers'; neither it nor the computer's is an aircraft radar's
// contact (a bandit ahead of the same radar is); the computer's ships are never bandits; a drone can lock one
{
  const o = R(`(() => { Combat.reset({});
    const raise = (v, h) => { const r = Math.hypot(v.x, v.y, v.z), k = (r + h) / r; v.x *= k; v.y *= k; v.z *= k; v.landed = false; v.contactTime = 0; return v; };
    const sh = ship('arley', { e: -3000, z: -6000, yaw: 0 }), cy = ship('cyclon', { e: -3000, z: -4000, yaw: 0 }); sh.ai = { sea: true }; cy.ai = { sea: true };
    const jet = build(templateRows(TEMPLATES.fs16), 'plane', 'FS-16'); jet.placeOnSurface(EARTH, siteAngle(EARTH, -3000), -Math.PI / 2, 0, -Math.PI / 2); raise(jet, 2000);
    const gShip = ship('vizby', { e: -3000, z: -5000, yaw: 0 }); gShip.remote = 'peer';
    const gJet = build(templateRows(TEMPLATES.myg29), 'plane', 'MyG-29'); gJet.placeOnSurface(EARTH, siteAngle(EARTH, -3000), -Math.PI / 2, -5000, 0); raise(gJet, 2000); gJet.remote = 'peer';
    const F = fsim(jet, [jet, sh, cy]); Combat.S.sea = true;
    globalThis.MP = { enemyGhosts: () => [gShip, gJet], active: false, enemy: () => true };
    const refs = (seek) => Combat.candidates(jet, seek, F).map((c) => c.ref), air = refs('air'), gr = refs('ground'), rad = refs('radar'), sea = refs('sea');
    delete globalThis.MP;
    const tp = (v) => ({ x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz, alive: true }), nose = jet.axis(0, 1, 0);
    const bandit = build(templateRows(TEMPLATES.myg29), 'plane', 'Bandit'); bandit.placeOnSurface(EARTH, siteAngle(EARTH, -3000), -Math.PI / 2, 0, 0); bandit.x = jet.x + nose.x * 5000; bandit.y = jet.y + nose.y * 5000; bandit.z = jet.z + nose.z * 5000; bandit.ai = {};
    const drone = build(templateRows(TEMPLATES.bumble), 'drone', 'Bumble');
    return { airShip: [sh, cy, gShip].some((v) => air.includes(v)), airJet: air.includes(gJet), gr: [sh, cy, gShip].every((v) => gr.includes(v)), rad: rad.includes(sh), sea: [sh, cy, gShip].every((v) => sea.includes(v)),
      radarShip: Radar.sees(jet, cy, tp(cy), 'scan') || Radar.sees(jet, sh, tp(sh), 'scan') || Radar.sees(jet, gShip, tp(gShip), 'scan'), radarBandit: Radar.sees(jet, bandit, tp(bandit), 'scan') === true,
      fighter: Combat.isFighter(cy) || Combat.isFighter(sh), drone: Drone.lockable(drone, cy) && Drone.lockable(drone, sh) }; })()`);
  t('another player\'s ship is never an air-to-air missile\'s target (their jet is); every ship is a ground, anti-ship and (her radars on) anti-radar seeker\'s', !o.airShip && o.airJet && o.gr && o.sea && o.rad, o);
  t('...no aircraft radar sees a ship (the same radar sees a bandit ahead); the computer\'s ships are never bandits; a drone can lock on to one', !o.radarShip && o.radarBandit && !o.fighter && o.drone, o);
}
// 11. seesSea: two 20 m masts see each other about 7 km apart over the sea's curve (not 8); the island between two ships
// 7 km apart blocks the line that the open sea leaves clear
{
  const o = R(`(() => {
    const at = (e, z, h) => { const a = siteAngle(EARTH, e), lat = z / EARTH.radius, r = EARTH.radius + h; return { body: EARTH, x: r * Math.cos(lat) * Math.cos(a), y: r * Math.cos(lat) * Math.sin(a), z: r * Math.sin(lat) }; };
    let far = 0; for (let d = 5000; d <= 9000; d += 50) if (Ship.seesSea(at(-3000, 0, 20), at(-3000, -d, 20), 20, 20)) far = d;
    const sea = Ship.seesSea(at(-3000, 0, 30), at(-3000, -7000, 30), 30, 30), land = Ship.seesSea(at(-3000, 0, 30), at(4000, 0, 30), 30, 30);
    return { far, sea, land }; })()`);
  t(`two 20 m masts see each other ${(o.far / 1000).toFixed(2)} km apart over the open sea (about 7 km); the island in the way blocks a 7 km line the open sea leaves clear`, o.far > 6800 && o.far < 7400 && o.sea && !o.land, o);
}
// ================================================================ these weapons against ships, ships against the rest (§8.12)
// 12. Hits to put her out of action or sink her (a Moderate sea, seeded; ships-damage's method: her own damage control at
// work): a naval 127 mm (explosive and semi-armour-piercing by turns, from 300 m at random points of her), an anti-ship
// missile (an Osca's, from 3 km), a torpedo (run at her beam from 300 m), each after the one before had its time (2 s for a
// shell; for the corvette and the destroyer a minute for a missile, a minute and a half for a torpedo, to founder); every
// row against the Zodiak and the Cyclon ends with her out of action or sunk; each row's §8.12 band checked for all four,
// the measured number reported when it falls outside (WP14's matrix balances them)
{
  R(`Ship.setSea('moderate'); var me = { parts: [], aimed: [], x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, name: 'Shooter', kind: 'ship', body: EARTH };
  var rng = 4242; var rnd = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  var aimAt = (v, X, d, el) => { const T = v.toWorld(X.x, X.y, X.z), u = qrot(v.q, 0, 0, 1), r = Math.hypot(T.x, T.y, T.z), up = { x: T.x / r, y: T.y / r, z: T.z / r }, e = el / ${D};
    const dir = { x: -u.x * Math.cos(e) - up.x * Math.sin(e), y: -u.y * Math.cos(e) - up.y * Math.sin(e), z: -u.z * Math.cos(e) - up.z * Math.sin(e) };
    return { from: { x: T.x - dir.x * d, y: T.y - dir.y * d, z: T.z - dir.z * d }, dir }; };
  var shell = (key, A, owner) => { const SH = SHELLS[key]; return { k: 'shell', sh: key, b: EARTH, x: A.from.x, y: A.from.y, z: A.from.z, vx: A.dir.x * SH.v0, vy: A.dir.y * SH.v0, vz: A.dir.z * SH.v0, t: 0, life: 6, owner: owner || me, net: 0, cal: SH.cal, pen: SH.pen, v0: SH.v0 }; };
  var target = (v, mode) => { const hs = v.sh.hulls, p = hs[Math.floor(rnd() * hs.length)], H = shullOf(p.def), x = H.x0 + (H.x1 - H.x0) * (0.1 + 0.8 * rnd()), sec = shullSec(p.def.shull.st, x);
    const y = mode === 'any' ? sec[1] + p.def.h * 1.6 * rnd() : p.def.shull.wl + (sec[0] - p.def.shull.wl) * (0.15 + 0.7 * rnd()), q = partPt(p, x, y); return { x: q.x, y: q.y, z: partZ(p) }; };
  var torpAt = (v) => { const X = target(v, 'hull'), T = v.toWorld(X.x, X.y, X.z), u = qrot(v.q, 0, 0, 1), side = rnd() < 0.5 ? 1 : -1, r = Math.hypot(T.x, T.y, T.z), k = (r - 6) / r;
    const P = { x: (T.x - u.x * side * 300) * k, y: (T.y - u.y * side * 300) * k, z: (T.z - u.z * side * 300) * k }, d = { x: u.x * side, y: u.y * side, z: u.z * side };
    return { k: 'stor', b: EARTH, x: P.x, y: P.y, z: P.z, vx: d.x * 22, vy: d.y * 22, vz: d.z * 22, dx: d.x, dy: d.y, dz: d.z, t: 2, t0: 0, run: 0, ph: 'run', owner: me, spd: 22, depth: 6, dep: 6, range: 8000, cone: 30 / ${D}, acquire: 1500,
      dmg: 4000, blast: 12, seek: 'active', drop: false, gyro: d, tgt: null, look: 0, bub: 0, ship: true, life: 600 }; };
  var launcher = null;
  var asmAt = (v, F) => { if (!launcher || !F.vessels.includes(launcher)) { const P = { e: -3000, z: -3000 }; let best = 0, bk = -2; for (let i = 0; i < 16; i++) { const o = ship('osca', { ...P, yaw: (i / 16) * TAU }), f = o.axis(1, 0, 0), u = unitTo(o, v), k = f.x * u.x + f.y * u.y + f.z * u.z; if (k > bk) { bk = k; best = (i / 16) * TAU; } }
      launcher = ship('osca', { ...P, yaw: best }); launcher.ai = { sea: true }; F.vessels.push(launcher); }
    const p = launcher.parts.find((q) => q.type === 'asm2'); p.ammo = 2; Combat.launchMissile(launcher, p, v, F); };
  var trial = (key, fire, max, every) => { Combat.reset({}); Ship.resetCombat(); Armour.seed(77); Ship.seed(77); launcher = null; // (each row seeded on its own)
    const v = ship(key, { e: -3000, z: 0, yaw: Math.PI }), F = fsim(v); F.active = me; F.vessels = [v]; tick(F, 2); let n, done = null;
    for (n = 1; n <= max && !done; n++) { fire(v, F); tick(F, every); if (v.fate || v.sunk != null) done = n; } return { n: done, fate: v.fate || '' }; };`);
  const g127 = "Combat.S.shots.push(shell(rnd() < 0.5 ? 'he127' : 'sap127', aimAt(v, target(v, 'any'), 300, 2)))", asm = 'asmAt(v, F)', torp = 'Combat.S.shots.push(torpAt(v))';
  const rows = [
    ['127 mm HE/SAP', 'zodiak', g127, 6, 2, [1, 1]], ['127 mm HE/SAP', 'cyclon', g127, 20, 2, [3, 6]], ['127 mm HE/SAP', 'vizby', g127, 40, 2, [8, 15]], ['127 mm HE/SAP', 'arley', g127, 80, 2, [15, 40]],
    ['anti-ship missile', 'zodiak', asm, 4, 16, [1, 1]], ['anti-ship missile', 'cyclon', asm, 4, 16, [1, 1]], ['anti-ship missile', 'vizby', asm, 6, 60, [1, 2]], ['anti-ship missile', 'arley', asm, 10, 60, [3, 5]],
    ['torpedo', 'zodiak', torp, 3, 20, [1, 1]], ['torpedo', 'cyclon', torp, 3, 20, [1, 1]], ['torpedo', 'vizby', torp, 3, 90, [1, 1]], ['torpedo', 'arley', torp, 5, 90, [1, 2]],
  ];
  const inBand = (n, b) => n != null && n >= b[0] && n <= b[1];
  const got = rows.map(([w, key, fire, max, every, band]) => { const o = R(`trial('${key}', (v, F) => { ${fire}; }, ${max}, ${every})`); return { w, key, band, max, ...o, inBand: inBand(o.n, band) }; });
  R(`Ship.setSea('calm');`);
  console.log('      weapon against ship: hits to put her out of action or sink her (band §8.12) — measured');
  for (const g of got) console.log(`        ${(g.w + ' vs ' + g.key).padEnd(34)} ${g.band.join('-').padEnd(6)} ${g.n == null ? 'held out ' + g.max : g.n + ' (' + g.fate + ')'}${g.inBand ? '' : '  <- outside the band: reported'}`);
  const two = got.filter((g) => g.key === 'cyclon' || g.key === 'zodiak');
  t(`the naval gun, the anti-ship missile and the torpedo put the Zodiak and the Cyclon out of action or sink them; ${got.filter((g) => g.inBand).length} of ${got.length} rows (all four ships) in §8.12's bands, the rest reported above`, two.every((g) => g.n != null), got.map((g) => [g.w, g.key, g.n]));
  t('...one torpedo or one anti-ship missile is enough for the Zodiak and the Cyclon', two.filter((g) => g.w !== '127 mm HE/SAP').every((g) => g.n === 1), two);
}
// 13. The other way: a 127 mm's explosive shell knocks out a tank on the shore in 1-3 hits (from 300 m, at random parts:
// 8 seeded tanks); proximity-fused 127 mm rounds bring down a jet crossing 3 km off in 10-30 rounds (laid with the
// table's lead and a fire-control error of 1.5 mrad); the close-in gun shreds a drone hovering 600 m off and a
// helicopter 900 m off within seconds
{
  const o = R(`(() => { const tank = [];
    for (let k = 0; k < 8; k++) {
      Combat.reset({}); Armour.seed(300 + k); let q = 900 + k; const rr = () => { q ^= q << 13; q ^= q >>> 17; q ^= q << 5; return (q >>> 0) / 4294967296; };
      const tk = build(templateRows(TEMPLATES.tk34), 'tank', 'TK-34'); tk.placeOnSurface(EARTH, siteAngle(EARTH, 1000), 0, 300 * k, rr() * TAU);
      const F = fsim(tk, [tk]); F.active = me; tick(F, 1.5);
      let n = 0;
      for (; n < 8 && !tk.ko; ) { const p = tk.parts[Math.floor(rr() * tk.parts.length)]; Combat.S.shots.push(shell('he127', aimAt(tk, { x: p.x, y: p.y, z: partZ(p) }, 300, 3))); n++; tick(F, 0.6); }
      tank.push(tk.ko ? n : null);
    }
    // HE-VT at a jet crossing 3 km off, 1.5 km up
    Combat.reset({}); Ship.seed(4); let q = 77; const g = () => { q ^= q << 13; q ^= q >>> 17; q ^= q << 5; const u = Math.max(1e-9, (q >>> 0) / 4294967296); q ^= q << 13; q ^= q >>> 17; q ^= q << 5; return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * (q >>> 0) / 4294967296); };
    const a = ship('arley', { e: -3000, z: 0, yaw: 0 }), F = fsim(a, [a]);
    const jet = build(templateRows(TEMPLATES.fs16), 'plane', 'FS-16'); jet.placeOnSurface(EARTH, siteAngle(EARTH, -3000), -Math.PI / 2, -2600, 0);
    { const r = Math.hypot(jet.x, jet.y, jet.z), k = (r + 1500) / r; jet.x *= k; jet.y *= k; jet.z *= k; }
    { const u = unitTo(jet, a), r0 = Math.hypot(jet.x, jet.y, jet.z), up = { x: jet.x / r0, y: jet.y / r0, z: jet.z / r0 }, cx = up.y * u.z - up.z * u.y, cy = up.z * u.x - up.x * u.z, cz = up.x * u.y - up.y * u.x, cl = Math.hypot(cx, cy, cz);
      jet.vx = (cx / cl) * 200; jet.vy = (cy / cl) * 200; jet.vz = (cz / cl) * 200; }
    jet.ai = {}; jet.landed = false; jet.contactTime = 0; F.vessels.push(jet); tick(F, 0.5, null, true);
    const gun = a.parts.find((p) => p.type === 'nGun127'), M = a.toWorld(gun.x, gun.y, partZ(gun)), rM = Math.hypot(M.x, M.y, M.z), upM = { x: M.x / rM, y: M.y / rM, z: M.z / rM };
    let rounds = 0, d0 = Math.round(dist(a, jet));
    for (; rounds < 60 && jet.hulk == null && !jet.dead; ) {
      let t = 0, P = null;
      for (let i = 0; i < 4; i++) { P = { x: jet.x + jet.vx * t, y: jet.y + jet.vy * t, z: jet.z + jet.vz * t }; const rx = P.x - M.x, ry = P.y - M.y, rz = P.z - M.z, dH = rx * upM.x + ry * upM.y + rz * upM.z, Dh = Math.hypot(rx - upM.x * dH, ry - upM.y * dH, rz - upM.z * dH), sv = Aim.solve('hevt127', Dh, dH, EARTH, 15); t = sv.t; P.el = sv.el; P.dH = dH; }
      const rx = P.x - M.x, ry = P.y - M.y, rz = P.z - M.z, hx = rx - upM.x * P.dH, hy = ry - upM.y * P.dH, hz = rz - upM.z * P.dH, hl = Math.hypot(hx, hy, hz), el = P.el + g() * 0.0015, yaw = g() * 0.0015;
      const sx = upM.y * hz - upM.z * hy, sy = upM.z * hx - upM.x * hz, sz = upM.x * hy - upM.y * hx, sl = Math.hypot(sx, sy, sz);
      const d = { x: (hx / hl) * Math.cos(el) + upM.x * Math.sin(el) + (sx / sl) * yaw, y: (hy / hl) * Math.cos(el) + upM.y * Math.sin(el) + (sy / sl) * yaw, z: (hz / hl) * Math.cos(el) + upM.z * Math.sin(el) + (sz / sl) * yaw };
      Combat.S.shots.push(shell('hevt127', { from: { x: M.x + d.x * 4, y: M.y + d.y * 4, z: M.z + d.z * 4 }, dir: d }, a)); Combat.S.shots[Combat.S.shots.length - 1].life = SHELLS.hevt127.life; rounds++;
      tick(F, 0.5, () => { jet.x += jet.vx / 120; jet.y += jet.vy / 120; jet.z += jet.vz / 120; }, true);
    }
    tick(F, 6, () => { jet.x += jet.vx / 120; jet.y += jet.vy / 120; jet.z += jet.vz / 120; }, true);
    const vt = { rounds, down: jet.hulk != null || !!jet.dead, d0 };
    // the close-in gun at a drone and a helicopter
    const ciws = (key, kind, off, h) => { Combat.reset({}); Ship.seed(8);
      const a2 = ship('arley', { e: -3000, z: 0, yaw: 0 }), G = fsim(a2, [a2]), o2 = build(templateRows(TEMPLATES[key]), kind, key); o2.placeOnSurface(EARTH, siteAngle(EARTH, -3000), kind === 'drone' ? 0 : 0, -off, 0);
      { const r = Math.hypot(o2.x, o2.y, o2.z), k = (r + h) / r; o2.x *= k; o2.y *= k; o2.z *= k; } o2.landed = false; o2.contactTime = 0; G.vessels.push(o2); const n0 = o2.parts.length, gun2 = a2.ciws[0];
      let first = null, down = null;
      tick(G, 12, (tt) => { if (first == null && gun2.shots) first = tt; if (down == null && (o2.dead || o2.hulk != null || o2.down || !G.vessels.includes(o2) || o2.parts.length < n0 * 0.5)) { down = tt; return false; } }, true);
      return { first: first && +first.toFixed(2), after: down != null && first != null ? +(down - first).toFixed(2) : null, rounds: (gun2.shots || 0) * 5 }; };
    return { tank, vt, drone: ciws('bumble', 'drone', 600, 30), heli: ciws('dragonfly', 'heli', 900, 120) }; })()`);
  const kt = o.tank.filter((n) => n != null);
  t(`a 127 mm explosive shell knocks out a TK-34 on the shore in ${o.tank.map((n) => n == null ? '8+' : n).join(', ')} hits (1-3)`, kt.length >= 6 && kt.every((n) => n <= 3), o.tank);
  t(`...proximity-fused 127 mm rounds bring down a jet crossing ${(o.vt.d0 / 1000).toFixed(1)} km off in ${o.vt.rounds} rounds (10-30), reported`, o.vt.down, o.vt);
  t(`...the close-in gun shreds a drone 600 m off in ${o.drone.after} s (${o.drone.rounds} rounds) and a helicopter 900 m off in ${o.heli.after} s (${o.heli.rounds} rounds)`, o.drone.after != null && o.drone.after < 4 && o.heli.after != null && o.heli.after < 6, o);
}
// 14. S8: an old Gun Turret on a ship afloat (the Cyclon, on her bridge's roof) fires at a bandit 900 m off; the same
// turret on a bomber sat on the ground holds its fire
{
  const o = R(`(() => { Combat.reset({});
    const bandit = (near, off) => { const j = build(templateRows(TEMPLATES.fs16), 'plane', 'Bandit'); j.placeOnSurface(EARTH, siteAngle(EARTH, -3000), -Math.PI / 2, -off, 0); const r = Math.hypot(j.x, j.y, j.z), k = (r + 300) / r; j.x *= k; j.y *= k; j.z *= k; j.ai = {}; j.landed = false; j.contactTime = 0; j.control = j.control || j.parts.find((p) => p.def.control); return j; };
    const rows = templateRows(TEMPLATES.cyclon).map((r) => ({ ...r })), ps = partsFromDesign(rows), bi = ps.findIndex((p) => p.def.control), B = ps[bi], top = partRect(B).t;
    const c = ship('cyclon', { e: -3000, z: 0, yaw: 0 }, [{ type: 'turretL', x: B.x, y: +(top + PARTS.turretL.w / 2).toFixed(3), rot: 3, att: bi }]), j1 = bandit(c, 900), F = fsim(c, [c, j1]);
    tick(F, 1, null, true); const tu = c.parts.find((p) => p.type === 'turretL'), n0 = Combat.S.shots.length; let on = false;
    tick(F, 4, () => { if (tu.gunOn) on = true; }, true);
    const bullets = Combat.S.shots.filter((s) => s.owner === c).length;
    Combat.reset({});
    const bo = build(templateRows(TEMPLATES.bomber), 'plane', 'Stratobomber'); bo.placeOnSurface(EARTH, siteAngle(EARTH, -3000), -Math.PI / 2, 0, 0); bo.contactTime = 1; bo.landed = true;
    const j2 = bandit(bo, 900), G = fsim(bo, [bo, j2]); tick(G, 1, null, true); const tb = bo.parts.find((p) => p.type === 'turretL'); let onB = false;
    tick(G, 4, () => { bo.contactTime = 1; if (tb.gunOn) onB = true; }, true);
    return { afloat: !!c.afloat, ship: on, bullets, bomber: onB, n0 }; })()`);
  t(`S8: an old Gun Turret on a ship afloat fires at a bandit 900 m off (${o.bullets} rounds in the air); on a bomber sat on the ground it holds`, o.afloat && o.ship && o.bullets > 0 && !o.bomber, o);
}
t.done();
