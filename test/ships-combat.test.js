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
  t(`the 127 mm's range table is built in ${o.ms} ms (≤ 30: once per shell); its longest shot ${(o.top[1] / 1000).toFixed(1)} km at ${o.top[0].toFixed(0)}° in ${o.top[2].toFixed(0)} s (about 24 km)`, o.ms <= 30 && o.top[1] > 22000 && o.top[1] < 26000 && o.top[0] > 40 && o.top[0] < 52, o);
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
  t(`...at most ${o.rate} simulated rounds a second (≤ 15), ${(o.msF * 1000).toFixed(1)} µs a frame while it fires (≤ 50: its step and its rounds' flight)`, o.rate <= 15 && o.rate >= 10 && o.msF <= 0.05, { rate: o.rate, msF: o.msF, steps: o.steps });
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
t.done();
