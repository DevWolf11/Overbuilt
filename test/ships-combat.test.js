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
t.done();
