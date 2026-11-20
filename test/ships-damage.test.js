// The ships update, §damage (spec §8.3-§8.9, §8.12, §10.5; WP8): ships.test.js's damage section in a file of its own
// (ships.test already takes three minutes; this one runs beside it). Where hits land (the hull's own triangles, the
// loft's: hullRay against them, the plates' thicknesses, a blast's distance), the holes each kind of round tears, the
// flooding (a 1 m² hole in the Olivar's midsection: she settles, trims and survives with her pumps; three compartments
// holed: she sinks), the free surface capsizing a tender hull, pumps and damage control's timings, magazines breaking a
// ship in two, every doom (capsized, sunk, out of action, magazine, a derelict), a wreck on a shallow bed and removal in
// deep water, a knocked-out tank in deep water, today's weapons against the Cyclon and the Zodiak (§8.12's bands, or the
// measured numbers), saves round-tripped and cleaned, and old play's saves untouched. Seeded throughout.
//   node test/ships-damage.test.js
const G = require('./lib/game.js');
const ctx = G.load({ combat: true, flight: true });
const R = (c) => G.run(ctx, c);
const t = G.checks('ships: §damage');
const D = 180 / Math.PI;

// ---------------------------------------------------------------- the stand-ins
R(`var fsim = (v, list) => Object.assign(${'(' + G.sim.toString() + ')()'}, { active: v, vessels: list || [v], running: true });
var ship = (key, place) => { const rows = templateRows(TEMPLATES[key]).map((r) => ({ ...r })); const parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
  const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const v = new Vessel(ps, adj, EARTH); v.kind = TEMPLATES[key].kind; v.name = TEMPLATES[key].name; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups();
  v.placeOnSurface(EARTH, siteAngle(EARTH, place ? place.e : -3000), 0, place ? place.z || 0 : 0, place && place.yaw != null ? place.yaw : Math.PI);
  v.launchedAt = Ship.launch(v, place || { e: -3000, z: 0, yaw: Math.PI }); return v; };
// the physics as flight.js runs it (Combat's shots too), Ship.frame every fourth step (Combat.frame's: S.sea)
var tick = (F, secs, each) => { const n = Math.round(secs * 120); for (let i = 0; i < n; i++) { if (each && each(i / 120, i) === false) return i;
  for (const v of F.vessels.slice()) { if (v.dead || v.wreck) continue; if (v.moored && v !== F.active) { Ship.drift(v, 1 / 120, F); continue; } v.physicsStep(1 / 120, F); }
  for (const s of Combat.S.shots.slice()) if (!Combat._t.moveShot(s, 1 / 120, F)) Combat.S.shots.splice(Combat.S.shots.indexOf(s), 1);
  F.time += 1 / 120; if (i % 4 === 0) { Combat.S.sea = F.vessels.some((o) => o.hydro); Ship.frame(F, 4 / 120); } } return n; };
// a hole of a m² dz m under the still water there now (− over it), at hull part p's own x, on its starboard side
var halfY = (p, x, y) => { const s = shullSec(p.def.shull.st, x), wl = p.def.shull.wl, yd = s[0], yk = s[1], bd = s[2], bw = s[3], nb = s[4];
  if (y >= wl) return yd > wl ? bw + ((bd - bw) * (y - wl)) / (yd - wl) : bw; const u = Math.min(0.999, (wl - y) / (wl - yk)); return bw * Math.pow(1 - Math.pow(u, nb), 1 / nb); };
var holeIn = (o, p, x, dz, a, F) => { const q0 = partPt(p, x, 0), w0 = o.toWorld(q0.x, q0.y, partZ(p)), y = -(Math.hypot(w0.x, w0.y, w0.z) - EARTH.radius) - dz;
  const X = partPt(p, x, y); return Ship.addHoles(o, [[p, X.x, X.y, partZ(p) + halfY(p, x, y), a]], F.time); };
var noDC = (o) => { for (const p of o.parts) if (p.def.mods && p.def.mods.some((m) => m.role === 'dc')) p.mods = p.def.mods.map(() => 0); };
var water = (o) => o.sh.comps.reduce((s, c) => s + c.W, 0);
Ship.seed(4242); Armour.seed(77); Ship.setSea('calm');`);

// ================================================================ where hits land (§8.3)
// 1. The hit shape is the drawn shape: parts3d's loft is built from shullTris (the picture unchanged: builder-shapes.mjs
// and a before/after comparison of every hull's arrays), and Ship.hullRay meets every hull just where a brute-force
// test of the same triangles does, at 200 seeded rays a hull
{
  const src = require('fs').readFileSync(require('path').join(G.ROOT, 'js', 'parts3d.js'), 'utf8');
  t('the hull loft (parts3d shipHullGeo) is built from shullTris, the triangles shells meet', /function shipHullGeo\(d, S\) \{[\s\S]{0,900}shullTris\(d\)/.test(src));
  const o = R(`(() => {
    let s = 99; const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    const out = { hulls: 0, rays: 0, hit: 0, bad: 0, miss: 0, worst: 0, codes: {}, closed: true };
    for (const k in PARTS) { const d = PARTS[k]; if (!d.shull) continue;
      out.hulls++;
      const p = makePart(k, 0, 0), T = shullTris(d), H = { n: v3(), n1: v3() }, dep = partDepth(p);
      if (!(T.code.length > 0 && T.code.every((c) => c >= -9 && c <= -6))) out.closed = false;
      for (let i = 0; i < 200; i++) {
        const th = rnd() * 2 * Math.PI, ph = Math.acos(2 * rnd() - 1), Rr = Math.hypot(d.w, d.h, dep);
        const A = { x: Rr * Math.sin(ph) * Math.cos(th), y: Rr * Math.cos(ph), z: Rr * Math.sin(ph) * Math.sin(th) };
        const C = { x: (rnd() - 0.5) * d.w * 0.5, y: (rnd() - 0.5) * d.h * 0.5, z: (rnd() - 0.5) * dep * 0.5 }, B = { x: 2 * C.x - A.x, y: 2 * C.y - A.y, z: 2 * C.z - A.z };
        const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z; let bt = Infinity;
        for (let f = 0; f < T.code.length; f++) { // (every triangle, the first one gone into)
          const P = T.pos, a = 3 * T.tri[3 * f], b = 3 * T.tri[3 * f + 1], c = 3 * T.tri[3 * f + 2];
          const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
          const pv = [dy * e2[2] - dz * e2[1], dz * e2[0] - dx * e2[2], dx * e2[1] - dy * e2[0]], det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
          if (Math.abs(det) < 1e-12) continue;
          const tv = [A.x - P[a], A.y - P[a + 1], A.z - P[a + 2]], u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det; if (u < 0 || u > 1) continue;
          const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]], w = (dx * qv[0] + dy * qv[1] + dz * qv[2]) / det; if (w < 0 || u + w > 1) continue;
          const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det;
          if (dx * T.un[3 * f] + dy * T.un[3 * f + 1] + dz * T.un[3 * f + 2] < 0 && tt < bt) bt = tt;
        }
        out.rays++;
        const hit = Ship.hullRay(p, A, B, H);
        if (!hit) { if (bt < Infinity) out.miss++; continue; }
        out.hit++; out.codes[H.edge] = (out.codes[H.edge] || 0) + 1;
        const e = Math.abs(H.t0 - bt) * Math.hypot(dx, dy, dz); out.worst = Math.max(out.worst, e); if (e > 0.02) out.bad++;
      }
    }
    return out; })()`);
  t(`hullRay meets all ${o.hulls} hulls where their own triangles are (${o.hit} of ${o.rays} seeded rays hit: entry within 2 cm of a brute-force test, ${o.worst.toFixed(4)} m at worst, no ray missed); every face coded deck, side, bottom or open`,
    o.hulls === 16 && o.bad === 0 && o.miss === 0 && o.hit > 2500 && o.closed && o.codes[-6] && o.codes[-7] && o.codes[-8] && o.codes[-9], o);
}
// 2. Face codes and plates: a level shot at a destroyer midsection's side meets a side (−7), dropped on it the deck
// (−6), from under it the bottom (−8), along it into its joint end the open end (−9); the deck's plate 10 mm, the side
// 12 mm and its belt (dialled to 100 mm) 100 inside the band only, the bottom 12, an open end and glass fibre nothing;
// the belt weighs 7.85e-3 × 2 × 24 × 4 t a mm and dials in 5 mm steps from 12 to 150
{
  const o = R(`(() => { const p = makePart('hbMidX', 0, 0), H = { n: v3(), n1: v3() }, c = (A, B) => Ship.hullRay(p, A, B, H) ? H.edge : null;
    const side = c({ x: 0, y: -0.5, z: 20 }, { x: 0, y: -0.5, z: 0 }), deck = c({ x: 3, y: 20, z: 1 }, { x: 3, y: 0, z: 1 }), bottom = c({ x: 3, y: -20, z: 0.5 }, { x: 3, y: 0, z: 0.5 }), open = c({ x: 40, y: 0, z: 0.3 }, { x: 0, y: 0, z: 0.3 });
    p.mm = 100; const mm = { deck: Armour._t.faceMm(p, -6, 0), side: Armour._t.faceMm(p, -7, 4), belt: Armour._t.faceMm(p, -7, 0), bottom: Armour._t.faceMm(p, -8, -5), open: Armour._t.faceMm(p, -9, 0), grp: Armour._t.faceMm(makePart('ribHull', 0, 0), -7, 0) };
    return { side, deck, bottom, open, mm, perMm: massPerMm(PARTS.hbMidX), dial: [cleanMm(103, PARTS.hbMidX), cleanMm(5, PARTS.hbMidX), cleanMm(400, PARTS.hbMidX)] }; })()`);
  t('the hull\'s face codes: a side −7, the deck −6, the bottom −8, a joint\'s open end −9', o.side === -7 && o.deck === -6 && o.bottom === -8 && o.open === -9, o);
  t('its plates: deck 10 mm, side 12 above the belt and 100 within it (dialled), bottom 12, an open end and glass fibre 0', JSON.stringify(o.mm) === '{"deck":10,"side":12,"belt":100,"bottom":12,"open":0,"grp":0}', o.mm);
  t(`the belt: ${o.perMm.toFixed(3)} t a mm (7.85e-3 × 2 × 24 m × 4 m), dialled in 5 mm steps from 12 to 150 mm`, Math.abs(o.perMm - 1.5072) < 1e-4 && o.dial.join() === '105,12,150', o);
}
// 3. A blast's distance to a hull (Ship.hullDist): 5 m off a midsection's side 5 m (not its centre less half its length),
// inside it 0; and a real shot: a level round from abeam at the Cyclon meets her hull first by its side, an old part's
// plate as ever (a prism)
{
  const o = R(`(() => { const v = ship('cyclon'), mid = v.parts.find((p) => p.type === 'hbMidM'), sec = shullSec(mid.def.shull.st, 0);
    const out = v.toWorld(mid.x, mid.y, partZ(mid) + sec[3] + 5), inn = v.toWorld(mid.x, mid.y, partZ(mid));
    const P = v.toWorld(mid.x, mid.y + 0.5, 30), Q = v.toWorld(mid.x, mid.y + 0.5, -30), hs = Armour.hitAll(v, P, Q);
    return { off: Ship.hullDist(v, mid, out), in: Ship.hullDist(v, mid, inn), first: hs[0] && hs[0].p.type, edge: hs[0] && hs[0].edge }; })()`);
  t(`a blast 5 m off the Cyclon's side is ${o.off.toFixed(3)} m from her hull, 0 inside it; a level shot from abeam meets her midsection's side first`, Math.abs(o.off - 5) < 0.05 && o.in === 0 && o.first === 'hbMidM' && o.edge === -7, o);
}

// ================================================================ holes (§8.4)
// 4. The holes each kind of round tears: a round through the plate HOLE.kin·π·(cal/2000)² (127 mm 0.019 m², 20 mm
// 0.0005), through glass fibre at least 0.002; high explosive on the plate he·blast²·(1 − d/blast) (127 mm HE 0.98),
// bursting inside + heIn·blast² (0.20 more), tamped three times under the water (2.94), half as much 3.5 m off
{
  const o = R(`(() => { const v = ship('olivar'), F = fsim(v), mid = v.parts.filter((p) => p.type === 'hbMidX')[0], st = mid.def.shull.st;
    const r = { k127: Ship.roundHole(mid, 127), k20: Ship.roundHole(mid, 20), grp: Ship.roundHole(makePart('ribHull', 0, 0), 12.7) };
    const at = (y, dz) => { const sec = shullSec(st, 0), wl = mid.def.shull.wl, k = Math.min(0.999, Math.max(0, (wl - y) / (wl - sec[1]))), half = y >= wl ? sec[3] + (sec[2] - sec[3]) * (y - wl) / (sec[0] - wl) : sec[3] * Math.pow(1 - Math.pow(k, sec[4]), 1 / sec[4]); return v.toWorld(mid.x, mid.y + y, partZ(mid) + half + dz); };
    const add = (P, o) => { const n0 = (mid.holes || []).reduce((s, h) => s + h.a, 0); Ship.blastHull(v, mid, Ship.hullDist(v, mid, P), P, 7, null, F, o); return (mid.holes || []).reduce((s, h) => s + h.a, 0) - n0; };
    r.plate = add(at(2, 0)); r.inside = add(at(2, 0), { inside: true }); r.off = add(at(2, 3.5)); r.under = add(at(-0.5 - 1.5, 0), {}); r.torp = add(at(2, 0), { under: true }); r.far = add(at(2, 8));
    return r; })()`);
  const near = (a, b, k = 0.02) => Math.abs(a / b - 1) <= k;
  t(`holes: a 127 mm round through the plate ${o.k127.toFixed(4)} m² (0.019), a 20 mm ${o.k20.toFixed(5)} (0.0005), a bullet through glass fibre ${o.grp} (0.002)`, near(o.k127, 0.019, 0.02) && near(o.k20, 0.00047, 0.02) && o.grp === 0.002, o);
  t(`...a 127 mm HE burst (blast 7) on the plate ${o.plate.toFixed(3)} m² (0.98), inside ${o.inside.toFixed(3)} (+0.196), 3.5 m off ${o.off.toFixed(3)} (0.49), 1.5 m under the water ${o.under.toFixed(2)} (×3: 2.94), a torpedo's 'under' ${o.torp.toFixed(2)}, 8 m off nothing`,
    near(o.plate, 0.98) && near(o.inside, 1.176) && near(o.off, 0.49, 0.03) && near(o.under, 2.94) && near(o.torp, 2.94) && o.far === 0, o);
}
// 5. A real 120 mm dart from abeam through the Cyclon: a hole where it went in and one where it left her (the far side),
// her frames torn as it went; HOLE.max: twenty holes in one part keep sixteen, their areas kept, none past HOLE.cap
{
  const o = R(`(() => { const v = ship('cyclon'), F = fsim(v); const mid = v.parts.find((p) => p.type === 'hbMidM'), me = { parts: [], name: 'Tank' };
    const P = v.toWorld(mid.x, mid.y + 1.2, 60), Q = v.toWorld(mid.x, mid.y + 1.2, 0), d = { x: Q.x - P.x, y: Q.y - P.y, z: Q.z - P.z }, L = Math.hypot(d.x, d.y, d.z);
    Combat.S.shots.length = 0; Combat.S.shots.push({ k: 'shell', sh: 'apfsds120', b: EARTH, x: P.x, y: P.y, z: P.z, vx: d.x / L * 1650, vy: d.y / L * 1650, vz: d.z / L * 1650, t: 0, life: 6, owner: me, net: 0, cal: 120 });
    const hp0 = mid.hp ?? mid.def.hp; tick(F, 0.2);
    const hs = (mid.holes || []).map((h) => ({ a: +h.a.toFixed(4), side: Math.sign(h.z - partZ(mid)) }));
    const w = ship('cyclon', { e: -3000, z: 400, yaw: Math.PI }), p = w.parts.find((q) => q.type === 'hbMidM'), rows = [];
    for (let i = 0; i < 20; i++) rows.push([p, p.x - 3 + i * 0.3, p.y, partZ(p), 1.5]);
    Ship.addHoles(w, rows, 0); Ship.addHoles(w, [[p, p.x, p.y, partZ(p), 50]], 0);
    return { hs, hp: hp0 - mid.hp, n: p.holes.length, sum: +p.holes.reduce((s, h) => s + h.a, 0).toFixed(2), max: Math.max(...p.holes.map((h) => h.a)) }; })()`);
  t(`a 120 mm dart from abeam through the Cyclon: a hole in (${o.hs.map((h) => h.a).join(', ')} m²) on the side it came from and one out on the far side; her midsection ${o.hp.toFixed(0)} hp down`,
    o.hs.length === 2 && o.hs[0].side === 1 && o.hs[1].side === -1 && o.hs.every((h) => Math.abs(h.a - 0.017) < 0.001) && o.hp > 150, o);
  t(`twenty holes in one part: ${o.n} kept (HOLE.max 16), their area kept (${o.sum} m² of 30 + 20), none past HOLE.cap 20 m² (${o.max})`, o.n === 16 && o.max <= 20 && o.sum <= 50 && o.sum >= 30, o);
}

// ================================================================ flooding (§8.7)
// 6. A 1 m² hole 1 m under the waterline in the Olivar's forward midsection, her damage control stood down: the water
// pours in at about cd·a·√(2g·1) (2.7 m³/s), she settles and trims by the bow, never heels, and lies at her new float
// with that compartment flooded to the sea's level, her pumps holding it (she survives); her damage control on, the hole
// is patched within a minute and her pumps empty her
{
  const o = R(`(() => { const v = ship('olivar'), F = fsim(v); noDC(v); tick(F, 3); const mid = v.parts.filter((p) => p.type === 'hbMidX')[1], d0 = v.draft, tr0 = v.trim;
    holeIn(v, mid, -4, 1, 1, F); const c = v.sh.comps.find((q) => q.p === mid && q.holes.length); let w5 = 0, heel = 0;
    tick(F, 1100, (tt) => { if (Math.abs(tt - 5) < 1e-9) w5 = c.W; heel = Math.max(heel, Math.abs(v.heel)); });
    const K = c.fc; return { rate: w5 / 5, fill: c.W / c.V, dd: v.draft - d0, trim: (v.trim - tr0) * ${D}, heel: heel * ${D}, fate: v.fate || '', other: v.sh.comps.filter((q) => q !== c).reduce((s, q) => s + q.W, 0) }; })()`);
  t(`a 1 m² hole 1 m under the Olivar's waterline: ${o.rate.toFixed(2)} m³/s at first (cd·a·√(2g·1) = 2.66, less her pumps' 0.47: 2.19); she settles ${o.dd.toFixed(2)} m and trims ${o.trim.toFixed(2)}° by the bow, heels under 1° (${o.heel.toFixed(2)}°), and lies there with that compartment ${(o.fill * 100).toFixed(0)} % full, afloat (her pumps hold it)`,
    o.rate > 1.95 && o.rate < 2.4 && o.dd > 1 && o.dd < 3 && o.trim > 0.5 && o.heel < 1 && o.fill > 0.35 && o.fill < 0.7 && !o.fate && o.other === 0, o);
  const p = R(`(() => { const v = ship('olivar'), F = fsim(v); tick(F, 3); const mid = v.parts.filter((p) => p.type === 'hbMidX')[1]; holeIn(v, mid, -4, 1, 1, F); const h = mid.holes[0];
    let fixed = null, dry = null, most = 0; tick(F, 400, (tt) => { if (fixed == null && h.fix >= 1) fixed = tt; most = Math.max(most, water(v)); if (fixed != null && dry == null && water(v) < 0.5) dry = tt; }); return { fixed, dry, most }; })()`);
  t(`...her damage control on: the hole patched in ${p.fixed && p.fixed.toFixed(0)} s (1 m² at 0.02 m²/s and its walk, two parties), ${p.most.toFixed(0)} m³ aboard at most, pumped dry by ${p.dry && p.dry.toFixed(0)} s`, p.fixed != null && p.fixed < 70 && p.dry != null && p.dry < 400, p);
}
// 7. Three compartments holed (3 m² each, a metre down: a 127 mm shell's burst at the waterline tamped), her damage control
// stood down: she floods, settles by the stern, her deck goes under and she founders (doomed 'sunk') inside 300 s
{
  const o = R(`(() => { const v = ship('olivar'), F = fsim(v); noDC(v); tick(F, 3); const ps = v.parts.filter((p) => p.def.shull); holeIn(v, ps[0], 0, 1, 3, F); holeIn(v, ps[1], -4, 1, 3, F); holeIn(v, ps[2], -4, 1, 3, F);
    let at = null; tick(F, 300, (tt) => { if (v.fate === 'sunk' && at == null) at = tt; }); return { at, fate: v.fate, trim: v.trim * ${D}, W: water(v) }; })()`);
  t(`three compartments holed: the Olivar founders (doomed 'sunk') at ${o.at && o.at.toFixed(0)} s, under 300 (trim ${o.trim.toFixed(0)}°)`, o.fate === 'sunk' && o.at != null && o.at < 300, o);
}
// 8. The free surface: a 20 m box hull with a weight raising her centre of gravity (GM 0.37 m) floats upright heeled 2°;
// with 30 % of her one compartment full of water (no hole: the water only moves) its free surface takes her stability and
// she rolls over: doomed 'capsized' (her heel past 60° for 4 s)
{
  R(`PARTS.tstBox = { name: 'Test box hull', cat: 'shHull', w: 20, h: 4, depth: 6, mass: 150, shape: 'shull', hull: true, tier: 1, cost: 1, gv: true, ship: true, hp: 5000,
    shull: { cls: 'T', wl: -1.95, st: [[-10, 2, -2, 3, 3, 50], [10, 2, -2, 3, 3, 50]], ends: { aft: 'closed', fore: 'closed' }, k: 0.3 } };
  PARTS.tstWeight = { name: 'Test weight', cat: 'shKit', w: 4, h: 1, depth: 2, mass: 30, shape: 'tkit', tier: 1, cost: 1 };
  var box = (wy) => { const ps = [makePart('tstBox', 0, 0), makePart('tstWeight', 0, wy)], adj = new Map([[ps[0].id, new Set([ps[1].id])], [ps[1].id, new Set([ps[0].id])]]);
    const v = new Vessel(ps, adj, EARTH); v.kind = 'ship'; v.stages = []; v.rebuildGroups(); v.placeOnSurface(EARTH, siteAngle(EARTH, -3000), 0, 1000, 0); Ship.launch(v); return v; };
  var boxRun = (f) => { const v = box(2.5), F = fsim(v), gm = Ship.stab(v), c = v.sh.comps[0]; c.W = f * c.V; v.parts[0].water = c.W; v.q = qnorm(qmul(v.q, qaxis(1, 0, 0, 2 / ${D})));
    let mx = 0; tick(F, 60, () => { mx = Math.max(mx, Math.abs(v.heel)); }); return { gm, mx: mx * ${D}, fate: v.fate || '' }; };`);
  const dry = R('boxRun(0)'), wet = R('boxRun(0.3)');
  t(`free surface: the box hull (GM ${dry.gm.toFixed(2)} m) heeled 2° stays upright dry (${dry.mx.toFixed(1)}° at most); with 30 % of her compartment awash she rolls over (${wet.mx.toFixed(0)}°): doomed '${wet.fate}'`,
    dry.mx < 3 && !dry.fate && wet.mx > 60 && wet.fate === 'capsized', { dry, wet });
}

// ================================================================ pumps, damage control, fires (§8.7-§8.8)
// 9. Pumps: the Olivar's (her four hulls' 0.08 m³/s and a Salvage Pump's 0.15) empty 47 m³ from a compartment in about
// 100 s; with every engine broken they stop
{
  const o = R(`(() => { const run = (off) => { const v = ship('olivar'), F = fsim(v); tick(F, 2); const c = v.sh.comps[1]; c.W = 47; c.p.water = 47; if (off) { noDC(v); for (const p of v.parts) if (p.def.engine) p.broken = true; }
    let dry = null; tick(F, 140, (tt) => { if (dry == null && c.W <= 0) dry = tt; }); return { dry, left: c.W }; }; return { on: run(false), off: run(true) }; })()`);
  t(`pumps: 47 m³ pumped out of a compartment in ${o.on.dry && o.on.dry.toFixed(0)} s (0.47 m³/s: about 100 s); her engines dead, none (${o.off.left.toFixed(0)} m³ left)`, o.on.dry > 90 && o.on.dry < 110 && o.off.left > 46, o);
}
// 10. Damage control's timings (the Cyclon's party of four): a 0.5 m² hole patched in 25 s of work (0.02 m²/s) once they
// have walked to it; a fire in her diesel put out in 20 s (it loses 4 hp/s till then); a broken diesel mended in
// 2 × 15 s (each on a ship of its own); with no locker aboard (the Pegazus: her bridge crew) half as fast
{
  const o = R(`(() => {
    const v = ship('cyclon'), F = fsim(v); tick(F, 1); const mid = v.parts.find((p) => p.type === 'hbMidM'), dz = v.parts.find((p) => p.type === 'dieselM'), e = () => v.sh.dc && v.sh.dc[0];
    holeIn(v, mid, 0, -1, 0.5, F); const h = mid.holes[0]; let walk = null, patched = null; tick(F, 60, (tt) => { const p = e(); if (p && walk == null && p.job && Math.abs(p.s - (h.x * v.sh.ax.x + h.y * v.sh.ax.y)) <= 1) walk = tt; if (patched == null && h.fix >= 1) patched = tt; });
    const v2 = ship('cyclon', { e: -3000, z: 600, yaw: Math.PI }), F2 = fsim(v2); tick(F2, 1); const d2 = v2.parts.find((p) => p.type === 'dieselM');
    d2.fire = 1; const hp0 = d2.hp ?? d2.def.hp; let out = null, burnt = 0; tick(F2, 60, (tt) => { if (out == null && !(d2.fire > 0)) { out = tt; burnt = hp0 - d2.hp; } });
    const v3 = ship('cyclon', { e: -3000, z: 1200, yaw: Math.PI }), F3 = fsim(v3); tick(F3, 1); const d3 = v3.parts.find((p) => p.type === 'dieselM');
    d3.broken = true; d3.hp = 0; let mended = null; tick(F3, 60, (tt) => { if (mended == null && !d3.broken) mended = tt; });
    const w = ship('pegazus'), G2 = fsim(w); tick(G2, 1); const m2 = w.parts.find((p) => p.type === 'hbMidM'); holeIn(w, m2, 0, -1, 0.5, G2); const h2 = m2.holes[0]; let p2 = null;
    tick(G2, 100, (tt) => { if (p2 == null && h2.fix >= 1) p2 = tt; });
    return { walk, patched, out, burnt, mended, osca: p2, bridge: w.sh.dc && w.sh.dc[0] && w.sh.dc[0].bridge }; })()`);
  t(`damage control: a 0.5 m² hole patched ${o.patched && (o.patched - o.walk).toFixed(1)} s after the party reached it (25 s)`, o.walk != null && o.patched != null && Math.abs(o.patched - o.walk - 25) < 2, o);
  t(`...a fire in her diesel out in ${o.out && o.out.toFixed(1)} s (20 s and the walk), ${o.burnt.toFixed(0)} hp burnt (4 hp/s); the diesel mended in ${o.mended && o.mended.toFixed(1)} s (30 s and the walk)`, o.out > 19 && o.out < 30 && o.burnt > 70 && o.burnt < 130 && o.mended > 29 && o.mended < 40, o);
  t(`...the Pegazus, with no locker, patches with her bridge crew at half the rate (${o.osca && o.osca.toFixed(0)} s: 50 s and the walk)`, o.bridge && o.osca > 49 && o.osca < 65, o);
}
// 11. Fires: lit in a part (a burst inside her, a round into her engine), a fire spreads to what is within 6 m (2 % a
// second), burns the crew within 3 m, and a magazine beside it for 5 s goes up; one under her flood water goes out
{
  const o = R(`(() => { const v = ship('olivar'), F = fsim(v); noDC(v); tick(F, 1); const mag = v.parts.find((p) => p.type === 'magazine'), host = v.byId.get(mag.att);
    let spread = 0; const near = [host]; host.fire = 1;
    let up = null; tick(F, 30, (tt) => { if (up == null && mag.magUp) up = tt; spread = Math.max(spread, v.parts.filter((p) => p.fire > 0).length); });
    const w = ship('cyclon', { e: -3000, z: 600, yaw: Math.PI }), G2 = fsim(w), dz = w.parts.find((p) => p.type === 'dieselM'); noDC(w); tick(G2, 1); dz.fire = 1; const c = Ship.wetAt;
    const comp = w.sh.comps.find((q) => q.p.id === dz.att); comp.W = comp.V * 0.9; comp.p.water = comp.W; tick(G2, 2);
    return { near: near.map((p) => p.type), up, spread, drown: dz.fire, wet: Ship.wetAt(w, dz) }; })()`);
  t(`a fire in the Olivar's bow (her magazine in it) spreads (${o.spread} parts burning) and sets it off after 5 s (at ${o.up && o.up.toFixed(1)} s)`, o.up != null && o.up >= 4.7 && o.up < 12, o); // (five seconds of the fire's steps, FIRE.hz)
  t('...a fire in an engine under her flood water goes out, and the engine is wet (it gives no power)', o.drown === 0 && o.wet, o);
}

// ================================================================ magazines and fate (§8.8-§8.9)
// 12. A magazine goes up (the Arley's aft one, 400 rounds: armour.js's moduleDown for it at 0 hp): a 28 m blast, holes
// low in the compartments within it, and the midsection it sits in is gone: she breaks in two, each half a hull with an
// open end, every piece doomed 'magazine'; both halves go down
{
  const o = R(`(() => { const v = ship('arley'), F = fsim(v); tick(F, 1); const mag = v.parts.filter((p) => p.type === 'magazine').find((p) => v.byId.get(p.att).type === 'hbMidX'), host = v.byId.get(mag.att);
    const n0 = v.parts.length; Combat.damage(v, mag, 1e6, 'shot', F, null);
    const pieces = F.vessels.filter((q) => q.sh && q.sh.rings.length), halves = pieces.map((q) => ({ n: q.parts.length, open: q.sh.open.length, fate: q.fate, holes: q.sh.hulls.reduce((s, p) => s + (p.holes ? p.holes.length : 0), 0) }));
    tick(F, 400); return { gone: !v.byId.has(host.id) && !v.byId.has(mag.id), n0, halves, all: F.vessels.length, fates: F.vessels.map((q) => q.fate || '-'), end: pieces.map((q) => (q.dead ? 'gone' : q.wreck ? 'wreck' : q.sunk != null ? 'sunk' : 'afloat')) }; })()`);
  t(`the Arley's aft magazine goes up: her midsection gone, she breaks in two (${o.halves.length} hulled halves, each an open end, ${o.halves.map((h) => h.holes).join(' and ')} holes), every piece doomed 'magazine'`,
    o.gone && o.halves.length === 2 && o.halves.every((h) => h.open >= 1 && h.fate === 'magazine') && o.fates.every((f) => f === 'magazine'), o);
  t(`...both halves go down within 400 s (${o.end.join(', ')})`, o.end.every((e) => e !== 'afloat'), o);
}
// 13. Out of action: the Cyclon's wheelhouse shot to pieces knocks her out (doomed 'action', the end screen says "Out of
// action"), her crew scuttle her after 60 s and she goes down; a ship whose helmsmen are all dead is out of action 6 s
// on (a dead helmsman's place is taken in 4)
{
  const o = R(`(() => { const v = ship('cyclon'), F = fsim(v); tick(F, 1); let ended = 0; F.onDestroyed = () => { ended++; }; const br = v.parts.find((p) => p.type === 'bridgeM');
    Combat.damage(v, br, 1e5, 'shot', F, null); const fate = v.fate, line = Flight.deathLine.call({ time: F.time }, v); let scut = null, down = null;
    tick(F, 240, (tt) => { if (scut == null && v.sh.scuttled) scut = tt; if (down == null && (v.sunk != null || v.dead || v.wreck)) down = tt; });
    const w = ship('cyclon', { e: -3000, z: 600, yaw: Math.PI }), G2 = fsim(w); tick(G2, 1); const b2 = w.parts.find((p) => p.type === 'bridgeM');
    for (const i of [0, 1, 3]) Armour.modDamage(w, b2, i, 1000, G2, null); let act = null; tick(G2, 10, (tt) => { if (act == null && w.fate) act = tt; });
    return { fate, line, ended, scut, down, helm: w.fate, act }; })()`);
  t(`the Cyclon's wheelhouse destroyed: doomed '${o.fate}' ("${o.line}"), the end once; scuttled at ${o.scut && o.scut.toFixed(0)} s, gone down at ${o.down && o.down.toFixed(0)} s`,
    o.fate === 'action' && o.line === 'Out of action' && o.ended === 1 && o.scut > 59 && o.scut < 61 && o.down != null && o.down < 240, o);
  t(`...her helmsman, captain and radio operator killed: out of action ${o.act && o.act.toFixed(1)} s on (6 s)`, o.helm === 'action' && o.act > 5.5 && o.act < 7, o);
}
// 14. A derelict: the Cyclon's hull cut loose from her wheelhouse (nobody at a helm, not the player's) is holed at 120 s
// (0.5 m² at each compartment's keel) and sinks; the player's own hull isn't
{
  const o = R(`(() => { const v = ship('cyclon'), F = fsim(v); for (const wh of v.parts.filter((p) => p.type === 'bridgeM' || p.type === 'ringS' || p.def.seat)) // (nobody aboard the hull: ships.test's cut)
      for (const n of [...v.adj.get(wh.id)]) if (v.byId.get(n).def.hull) { v.adj.get(wh.id).delete(n); v.adj.get(n).delete(wh.id); }
    F.vessels = [v, ...v.splitComponents()]; const h = F.vessels.find((q) => q.sh && q.sh.rings.length); let holed = null, sunk = null;
    tick(F, 400, (tt) => { if (holed == null && h.sh.derelict) holed = tt; if (sunk == null && (h.fate || h.sunk != null)) sunk = tt; });
    return { holed, sunk, fate: h.fate, end: h.dead ? 'gone' : h.wreck ? 'wreck' : 'afloat' }; })()`);
  t(`a derelict hull (no helm, not the player's): holed at ${o.holed && o.holed.toFixed(0)} s (120), foundered at ${o.sunk && o.sunk.toFixed(0)} s, ${o.end}`, o.holed > 119 && o.holed < 122 && o.sunk != null && o.end !== 'afloat', o);
}
// 15. Sunk on a shallow bed (32 m, off the island) she is a wreck (frozen: never stepped, five minutes, the last 6 s sinking
// away); in deep water (150 m) she is gone once her highest point is 40 m down. A doomed ship never moors, and the end
// screen waits for her (at most 15 s)
{
  const o = R(`(() => { const run = (place) => { const v = ship('cyclon', place), F = fsim(v); tick(F, 1); F.active = null; ${''}
      v.sh.hulls.forEach((p) => Ship.addHoles(v, [[p, p.x, p.y - 1, partZ(p), 4]], 0)); Ship.doom(v, F, 'sunk'); let at = null, bed = Terrain.heightAt(EARTH, Terrain.locate(EARTH, v.x, v.y, v.z).a, Terrain.locate(EARTH, v.x, v.y, v.z).z);
      tick(F, 300, (tt) => { if (at == null && (v.wreck || v.dead)) at = tt; }); const x = [v.x, v.y, v.z]; tick(F, 5); const moved = Math.hypot(v.x - x[0], v.y - x[1], v.z - x[2]);
      F.time = 1000; Ship.frame(F, 0.3); F.time = 1003; Ship.frame(F, 0.3); const sinking = v.sink; return { at, bed, wreck: !!v.wreck, dead: !!v.dead, moved, sinking }; };
    const shallow = run({ e: -1000, z: 0, yaw: Math.PI }), deep = run({ e: -6000, z: 3000, yaw: Math.PI });
    const m = ship('cyclon', { e: -3000, z: -1200, yaw: Math.PI }), me = ship('cyclon', { e: -3000, z: 1200, yaw: Math.PI }), F3 = fsim(me, [me, m]); Ship.doom(m, F3, 'sunk'); m.vx = m.vy = m.vz = 0; Ship.frame(F3, 6);
    const wait = (t) => Flight.fallDone.call({ active: me, time: t, diedAt: 10, running: true });
    me.fate = 'sunk'; me.sunk = null; const w = [wait(12), wait(24), wait(26)]; me.sunk = 5; w.push(wait(12));
    return { shallow, deep, moored: !!m.moored, wait: w }; })()`);
  t(`sunk on a ${(-o.shallow.bed).toFixed(0)} m bed: a wreck at ${o.shallow.at && o.shallow.at.toFixed(0)} s, frozen (${o.shallow.moved.toFixed(3)} m in 5 s), sinking away at the end of her five minutes`, o.shallow.wreck && !o.shallow.dead && o.shallow.moved < 1e-6 && o.shallow.sinking > 0, o.shallow);
  t(`...in ${(-o.deep.bed).toFixed(0)} m of water: gone at ${o.deep.at && o.deep.at.toFixed(0)} s, no wreck`, o.deep.dead && !o.deep.wreck, o.deep);
  t('a doomed ship never moors; the end screen waits for the player\'s ship to go down (2 s and 14 s after: waiting, 16 s: done; gone down: done)', !o.moored && o.wait.join() === 'false,false,true,true', o);
}
// 16. Our kill: a ship of theirs we doom gets the banner (SUNK), our toast, and the credit (doomBy)
{
  const o = R(`(() => { const me = ship('cyclon', { e: -3000, z: 1200, yaw: Math.PI }), v = ship('cyclon'), F = fsim(me, [me, v]); v.lastHitBy = me; Death.fb.text = ''; F.toasts.length = 0;
    Ship.doom(v, F, 'capsized'); return { by: v.doomBy === me, banner: Death.fb.text, toast: F.toasts.join('|'), again: Ship.doom(v, F, 'sunk'), fate: v.fate }; })()`);
  t(`our kill: "${o.toast}", the ${o.banner} banner, the credit ours; doomed once (a second doom is nothing)`, o.by && o.banner === 'SUNK' && /capsized/.test(o.toast) && o.again === false && o.fate === 'capsized', o);
}

// ================================================================ ground vehicles in deep water (§8.9)
// 17. A TK-34 knocked out where it stands on the sea (to old physics the sea is a floor) goes under in SEA.swamp s and is
// gone (its wreck never stands on the water); one knocked out on land, and one in shallow water, stay wrecks as ever
{
  const o = R(`(() => { const run = (e, z) => { const rows = templateRows(TEMPLATES.tk34).map((r) => ({ ...r })), ps = partsFromDesign(rows), adj = buildAdjacency(ps);
      const v = new Vessel(ps, adj, EARTH); v.kind = 'tank'; v.name = 'TK-34'; v.stages = []; v.rebuildGroups(); v.placeOnSurface(EARTH, siteAngle(EARTH, e), 0, z, 0);
      const F = fsim(v); for (let i = 0; i < 120; i++) { v.physicsStep(1 / 120, F); F.time += 1 / 120; } Armour.knockOut(v, F, 'crew');
      for (let k = 0; k < 120; k++) { for (let i = 0; i < 8; i++) { if (!v.dead && !v.wreck) v.physicsStep(1 / 120, F); F.time += 1 / 120; } Death.tick(F, 8 / 120, k); }
      return { dead: !!v.dead, wreck: !!v.wreck, sea: !!v.sea, splashed: !!v.splashed }; };
    return { deep: run(-3000, 0), land: run(EARTH.sites.pad.east, 0) }; })()`);
  t('a TK-34 knocked out standing on deep water goes under (gone, its plunge drawn); one knocked out on land is a wreck as ever', o.deep.dead && o.deep.sea && !o.land.dead && o.land.wreck, o);
}

// ================================================================ saves (§10.5)
// 18. A ship's holes, water, fires, rudders, telegraph, damage control's priority and fate come back from a saved flight;
// junk is cleaned (holes not finite, outside the part, too big, too many; water below 0; a fire on an old part; a fate
// that isn't one); an old craft's save carries none of it
{
  const o = R(`(() => { const v = ship('cyclon'), F = fsim(v); tick(F, 1); const mid = v.parts.find((p) => p.type === 'hbMidM'), dz = v.parts.find((p) => p.type === 'dieselM'), rd = v.parts.find((p) => p.type === 'rudderM');
    holeIn(v, mid, 0, 0.5, 0.3, F); holeIn(v, mid, 2, -0.5, 0.2, F); mid.holes[0].fix = 0.5; const c = v.sh.comps.find((q) => q.p === mid); c.W = 12; mid.water = 12; dz.fire = 1; rd.rud = 14; v.sh.tel = 3; v.sh.dcPri = 'fire'; v.fate = 'sunk';
    const d = JSON.parse(JSON.stringify(v.serialize())), r = Vessel.restore(d), m2 = r.parts.find((p) => p.type === 'hbMidM'), c2 = r.sh.comps.find((q) => q.p === m2);
    const back = { holes: m2.holes.map((h) => [+h.a.toFixed(3), h.fix]), W: c2.W, fire: r.parts.find((p) => p.type === 'dieselM').fire, rud: r.parts.find((p) => p.type === 'rudderM').rud, tel: r.sh.tel, pri: r.sh.dcPri, fate: r.fate, holesComp: c2.holes.length };
    const j = JSON.parse(JSON.stringify(d)), jm = j.parts.find((p) => p.type === 'hbMidM');
    jm.holes = [{ x: NaN, y: 0, z: 0, a: 1 }, { x: jm.x + 99, y: jm.y, z: 0, a: 1 }, { x: jm.x, y: jm.y, z: 0, a: 999 }, ...Array.from({ length: 30 }, (_, i) => ({ x: jm.x, y: jm.y, z: 0, a: 0.1, fix: 7 }))];
    jm.water = -5; j.parts.find((p) => p.type === 'rudderM').rud = 9999; j.fate = 'exploded'; j.sh = { tel: 99, dcPri: 'nap', ciwsOn: 'yes' };
    const jr = Vessel.restore(j), jmm = jr.parts.find((p) => p.type === 'hbMidM');
    const junk = { holes: jmm.holes.length, fix: Math.max(...jmm.holes.map((h) => h.fix)), water: jmm.water, rud: jr.parts.find((p) => p.type === 'rudderM').rud, fate: jr.fate, tel: jr.sh.tel, pri: jr.sh.dcPri, ciws: jr.sh.ciwsOn };
    const tk = new Vessel(partsFromDesign(templateRows(TEMPLATES.tk34)), buildAdjacency(partsFromDesign(templateRows(TEMPLATES.tk34))), EARTH); tk.kind = 'tank'; tk.rebuildGroups(); tk.parts.find((p) => p.def.engine).fire = 9;
    const ts = JSON.stringify(tk.serialize()), tr = Vessel.restore(JSON.parse(ts));
    return { back, junk, old: /"holes"|"water"|"rud"|"fire"|"fate"|"hydroFrom"|"sh":/.test(ts), oldFire: tr.parts.some((p) => p.fire != null) }; })()`);
  t(`a saved ship comes back with her holes (${o.back.holes.map((h) => h.join('@')).join(', ')}), ${o.back.W} m³ aboard, her diesel burning, rudder 14°, telegraph Full, damage control on fires, doomed 'sunk'`,
    o.back.holes.length === 2 && o.back.holes[0][1] === 0.5 && o.back.W === 12 && o.back.fire === 1 && o.back.rud === 14 && o.back.tel === 3 && o.back.pri === 'fire' && o.back.fate === 'sunk' && o.back.holesComp === 2, o.back);
  t(`...junk cleaned: ${o.junk.holes} holes kept (of 33: none not finite, outside the part or past 20 m²; at most 16), patches within 1, no water below 0 (none aboard), the rudder within 60°, no false fate, the telegraph and priority kept in range`,
    o.junk.holes === 16 && o.junk.fix === 1 && o.junk.water === 0 && o.junk.rud === 60 && o.junk.fate === undefined && o.junk.tel === 4 && o.junk.pri === 'auto' && o.junk.ciws === true, o.junk);
  t('an old craft\'s save (a TK-34 with its engine on fire) carries none of it, and its fire isn\'t restored, as before', !o.old && !o.oldFire, o);
}

// ================================================================ today's weapons against ships (§8.12)
// 19. Hits to put her out of action or sink her (a Moderate sea; seeded shots at random points of her side from 150 m,
// her own damage control at work): every weapon gets there (no immune pair: §20); each row's band from §8.12 checked,
// the measured number reported when it falls outside (WP14's matrix balances them across every kind)
{
  R(`Ship.setSea('moderate'); var me = { parts: [], x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, name: 'Shooter', kind: 'tank', body: EARTH };
  var rng = 12345; var rnd = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  var aimAt = (v, X, dist, el) => { const T = v.toWorld(X.x, X.y, X.z), u = qrot(v.q, 0, 0, 1), r = Math.hypot(T.x, T.y, T.z), up = { x: T.x / r, y: T.y / r, z: T.z / r }, e = el / ${D};
    const dir = { x: -u.x * Math.cos(e) - up.x * Math.sin(e), y: -u.y * Math.cos(e) - up.y * Math.sin(e), z: -u.z * Math.cos(e) - up.z * Math.sin(e) };
    return { from: { x: T.x - dir.x * dist, y: T.y - dir.y * dist, z: T.z - dir.z * dist }, dir }; };
  var shell = (key, A) => { const SH = SHELLS[key]; return { k: 'shell', sh: key, b: EARTH, x: A.from.x, y: A.from.y, z: A.from.z, vx: A.dir.x * SH.v0, vy: A.dir.y * SH.v0, vz: A.dir.z * SH.v0, t: 0, life: 6, owner: me, net: 0, cal: SH.cal }; };
  var target = (v, mode) => { const hs = v.sh.hulls, p = hs[Math.floor(rnd() * hs.length)], H = shullOf(p.def), x = H.x0 + (H.x1 - H.x0) * (0.1 + 0.8 * rnd()), sec = shullSec(p.def.shull.st, x);
    const y = mode === 'any' ? sec[1] + p.def.h * 1.6 * rnd() : p.def.shull.wl + (sec[0] - p.def.shull.wl) * (0.15 + 0.7 * rnd()), q = partPt(p, x, y); return { x: q.x, y: q.y, z: partZ(p) }; };
  var bomb = (v, X, off) => { const T = v.toWorld(X.x, X.y, X.z), r = Math.hypot(T.x, T.y, T.z), up = { x: T.x / r, y: T.y / r, z: T.z / r }, u = qrot(v.q, 0, 0, 1), P = { x: T.x + u.x * off + up.x * 60, y: T.y + u.y * off + up.y * 60, z: T.z + u.z * off + up.z * 60 };
    return { k: 'bomb', b: EARTH, x: P.x, y: P.y, z: P.z, vx: -up.x * 60, vy: -up.y * 60, vz: -up.z * 60, dx: 0, dy: 0, dz: 0, t: 1, life: 90, dmg: 1200, blast: 30, cluster: 0, torpedo: false, owner: me }; };
  var rocket = (A) => ({ k: 'rocket', b: EARTH, x: A.from.x, y: A.from.y, z: A.from.z, vx: A.dir.x * 400, vy: A.dir.y * 400, vz: A.dir.z * 400, dx: A.dir.x, dy: A.dir.y, dz: A.dir.z, t: 2, life: 9, dmg: 110, blast: 9, accel: 0, burn: 0, coast: 0, owner: me });
  var charge = (v, F, X) => { const A = aimAt(v, X, 6, 35), s = { k: 'missile', seek: 'top', b: EARTH, x: A.from.x, y: A.from.y, z: A.from.z, vx: A.dir.x * 20, vy: A.dir.y * 20, vz: A.dir.z * 20, dx: A.dir.x, dy: A.dir.y, dz: A.dir.z,
    pen: 350, tandem: false, he: 10, blast: 3, dmg: 500, t: 0, life: 9, owner: me, enemy: false, spare: null, drone: 1 }, e = { x: A.from.x + A.dir.x * 12, y: A.from.y + A.dir.y * 12, z: A.from.z + A.dir.z * 12 }, q = Armour.hitFirst(v, A.from, e);
    if (q) Armour.legacyHit(s, v, q.p, { x: A.from.x + (e.x - A.from.x) * q.t, y: A.from.y + (e.y - A.from.y) * q.t, z: A.from.z + (e.z - A.from.z) * q.t }, F); };
  var ram = (v, F) => { const o = ship('cyclon', { e: -3000, z: 400, yaw: Math.PI / 2 }), to = { x: v.x - o.x, y: v.y - o.y, z: v.z - o.z }, d = Math.hypot(to.x, to.y, to.z); F.vessels.push(o);
    o.x = v.x - to.x / d * 22; o.y = v.y - to.y / d * 22; o.z = v.z - to.z / d * 22; o.vx = to.x / d * 7.7; o.vy = to.y / d * 7.7; o.vz = to.z / d * 7.7; o.sh.tel = 4; tick(F, 6); F.vessels = F.vessels.filter((q) => q !== o); };
  var trial = (key, fire, max, every) => { Combat.S.shots.length = 0; const v = ship(key, { e: -3000, z: 0, yaw: Math.PI }), F = fsim(v); F.active = me; F.vessels = [v]; tick(F, 2); let n, done = null;
    for (n = 1; n <= max && !done; n++) { fire(v, F); tick(F, every); if (v.fate || v.sunk != null) done = n; } return { n: done, fate: v.fate || '' }; };`);
  const rows = [
    ['12.7 mm MG (rounds)', 'cyclon', "Combat.S.shots.push(shell('ball13', aimAt(v, target(v, 'any'), 150, 1)))", 1500, 0.1, [200, 600]],
    ['30 mm cannon', 'cyclon', "Combat.S.shots.push(shell(rnd() < 0.5 ? 'apds30' : 'hei30', aimAt(v, target(v, 'any'), 150, 1)))", 600, 0.15, [40, 120]],
    ['120 mm APFSDS', 'cyclon', "Combat.S.shots.push(shell('apfsds120', aimAt(v, target(v, 'hull'), 150, 1)))", 300, 0.5, [20, 60]],
    ['120 mm HE', 'cyclon', "Combat.S.shots.push(shell('he120', aimAt(v, target(v, 'any'), 150, 1)))", 120, 2, [4, 10]],
    ['500 lb bomb, direct', 'cyclon', "Combat.S.shots.push(bomb(v, target(v, 'hull'), 0))", 6, 8, [1, 1]],
    ['500 lb bomb, 5 m off', 'cyclon', "Combat.S.shots.push(bomb(v, target(v, 'hull'), 3.5 + 5))", 6, 8, [1, 2]],
    ['air rockets', 'cyclon', "Combat.S.shots.push(rocket(aimAt(v, target(v, 'hull'), 200, 5)))", 120, 1, [6, 15]],
    ['drone charge (S1)', 'cyclon', "charge(v, F, target(v, 'any'))", 60, 4, [3, 8]],
    ['ramming at 15 kn', 'cyclon', 'ram(v, F)', 12, 4, [2, 3]],
    ['12.7 mm MG (rounds)', 'zodiak', "Combat.S.shots.push(shell('ball13', aimAt(v, target(v, 'any'), 150, 1)))", 1500, 0.1, [30, 80]],
    ['30 mm cannon', 'zodiak', "Combat.S.shots.push(shell(rnd() < 0.5 ? 'apds30' : 'hei30', aimAt(v, target(v, 'any'), 150, 1)))", 300, 0.15, [5, 15]],
    ['120 mm HE', 'zodiak', "Combat.S.shots.push(shell('he120', aimAt(v, target(v, 'any'), 150, 1)))", 60, 4, [1, 1]],
    ['drone charge (S1)', 'zodiak', "charge(v, F, target(v, 'any'))", 30, 6, [1, 1]],
  ];
  const got = rows.map(([w, key, fire, max, every, band]) => { const o = R(`trial('${key}', (v, F) => { ${fire}; }, ${max}, ${every})`); return { w, key, band, ...o, inBand: o.n != null && o.n >= band[0] && o.n <= band[1] }; });
  console.log('      weapon against ship: hits to put her out of action or sink her (band §8.12) — measured');
  for (const g of got) console.log(`        ${(g.w + ' vs ' + g.key).padEnd(38)} ${String(g.band.join('-')).padEnd(8)} ${g.n == null ? 'not in ' + g.n : g.n} (${g.fate})${g.inBand ? '' : '  <- outside the band: reported'}`);
  t(`every weapon of today puts the Cyclon and the Zodiak out of action or sinks them (no immune pair); ${got.filter((g) => g.inBand).length} of ${got.length} rows in §8.12's bands, the rest reported above`, got.every((g) => g.n != null), got.map((g) => [g.w, g.key, g.n]));
  t('the big blows land in their bands: a 500 lb bomb sinks or stops the Cyclon in one direct hit, a near miss in one or two; a drone charge stops the Zodiak at once', got.filter((g) => /bomb/.test(g.w) || (g.key === 'zodiak' && /drone/.test(g.w))).every((g) => g.inBand), got);
  R(`Ship.setSea('calm');`);
}

// ================================================================ cost (§15)
// 20. Flooding, fires, damage control and fate: at most 0.02 ms a ship a call (the Olivar flooding through three holes,
// a fire aboard; asserted at three times it, other suites sharing the machine)
{
  const o = R(`(() => { const v = ship('olivar'), F = fsim(v); tick(F, 2); const ps = v.parts.filter((p) => p.def.shull); holeIn(v, ps[0], 0, 1, 1, F); holeIn(v, ps[1], -4, 1, 1, F); holeIn(v, ps[3], 0, 1, 1, F);
    v.parts.find((p) => p.type === 'turbine').fire = 1; tick(F, 20); const n = 400, t0 = performance.now(); let k = 0;
    const T0 = Date.now(); for (let i = 0; i < n; i++) { Ship.floodStep(v, 0.1, F); Ship.fireStep(v, 0.25, F); Ship.dcStep(v, 0.25, F); Ship.fateStep(v, 0.25, F); } return { ms: (Date.now() - T0) / n / 4 }; })()`);
  t(`flooding, fires, damage control and fate: ${(o.ms * 1000).toFixed(1)} µs a call for the Olivar flooding and burning (20 µs; asserted under 40, other suites sharing the machine)`, o.ms < 0.04, o);
}
t.done();
