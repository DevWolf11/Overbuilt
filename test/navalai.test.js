// The ships update, the computer's ships and the Naval Range (spec §9.1, §9.2, §15's AI and Hostile-wave budgets, §20
// S9; WP10). The helm (waypoints, land and shallows at the islands and off Shetland's coast, other ships), range
// keeping, gunnery (the first hit at 4 km by skill: the ranging error the fall of shot walks off), torpedoes in a spread,
// anti-ship missiles (two at once only at the best skill), evasion (combing a torpedo's track, zigzags under fire), the
// retreat, a tank on the shore (S9), a strike aircraft's run, the range's Practice targets and Hostile waves, the gates
// (old play, a room, targets off) and the cost (think, the look's heightAt, a Hostile wave's physics). Seeded.
//   node test/navalai.test.js
const G = require('./lib/game.js');
const ctx = G.load({ combat: true, flight: true });
const R = (c) => G.run(ctx, c);
const t = G.checks('naval AI: the computer\'s ships and the Naval Range');
ctx.__hr = () => Number(process.hrtime.bigint()) / 1e6;
const J = (c) => JSON.parse(R(c));

// ---------------------------------------------------------------- the stand-ins
R(`var fsim = (v, list) => Object.assign(${'(' + G.sim.toString() + ')()'}, { active: v, vessels: list || [v], running: true, warpIdx: 0, destroyed: false, camAbs: null });
var build = (rows, kind, name) => { const parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
  const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const v = new Vessel(ps, adj, EARTH); v.kind = kind; v.name = name || kind; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups(); return v; };
// a ship of the player's (no AI) afloat at place
var ship = (key, place) => { const v = build(templateRows(TEMPLATES[key]).map((r) => ({ ...r })), TEMPLATES[key].kind, TEMPLATES[key].name);
  v.placeOnSurface(EARTH, siteAngle(EARTH, place.e), 0, place.z || 0, place.yaw); Ship.launch(v, place); if (v.aimed.length) Aim.limits(v); return v; };
// the game's step order (flight.js update): two physics steps a frame for everyone near (the computer's ships out to
// SHIP.aiNear), Combat's step with each, Combat.frame (Ship.frame, the AI, the range) each frame; frozen: no physics
var run = (F, secs, each, frozen) => { const n = Math.round(secs * 60); for (let f = 0; f < n; f++) { if (each && each(f / 60, f) === false) return f;
  for (let k = 0; k < 2; k++) { if (!frozen) for (const v of F.vessels.slice()) { if (v.dead || v.wreck || v.kin) continue; if (v.moored && v !== F.active) { Ship.drift(v, 1 / 120, F); continue; } v.physicsStep(1 / 120, F); } Combat.step(1 / 120, F); F.time += 1 / 120; }
  Combat.frame(F, 1 / 60); if (f % 6 === 0) F.vessels = F.vessels.filter((o) => !o.dead); } return n; };
var hpOf = (v) => v.parts.reduce((s, p) => s + (p.hp == null ? Combat.maxHp(p.def) : Math.max(0, p.hp)), 0);
var holeA = (v) => v.parts.reduce((s, p) => s + (p.holes ? p.holes.reduce((q, h) => q + h.a, 0) : 0), 0);
var dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
var ez = (v) => { const L = Terrain.locate(EARTH, v.x, v.y, v.z, {}); return [Math.round(-wrapAngle(L.a - EARTH.padAngle) * EARTH.radius), Math.round(L.z)]; };
var hd = (v) => Ship.heading(v, v.sh) * 180 / Math.PI;
var deepAt = (v) => { const L = Terrain.locate(EARTH, v.x, v.y, v.z, {}); return -Terrain.heightAt(EARTH, L.a, L.z); };
var brgOf = (S, x, y, z) => Math.atan2(x * S.E.x + y * S.E.y + z * S.E.z, x * S.N.x + y * S.N.y + z * S.N.z) * 180 / Math.PI;
var unarm = (v, f) => { for (const p of v.parts) { if (p.def.weapon && (!f || f(p.def.weapon))) p.ammo = 0; if (!f && p.def.store) p.rounds = 0; } }; // (all of it: her magazines too, or her naval guns fill again)
// a buggy parked at the runway: the player's craft where none of the AI's business is (targets off: no range)
var park = () => { const b = build(templateRows(TEMPLATES.buggy), 'car', 'Buggy'); b.placeOnSurface(EARTH, siteAngle(EARTH, 760), 0, 0, 0); return b; };
var fresh = (n) => { Combat.reset({}); Ship.aiReset(null); Ship.seed(100 + n); Ship.aiSeed(200 + n); Armour.seed(300 + n); Ship.setSea('calm'); Settings.data.targets = 'off'; };`);
const deg = (a) => Math.abs((((a + 180) % 360) + 360) % 360 - 180);

// ================================================================ the helm (§9.1)
// 1. Waypoints: a Cyclon on a course of three points 1.2-1.4 km apart, nobody about: she steers through each in turn
// (within 250 m of it), the heading held and the telegraph rung as a player's keys would
{
  const o = J(`(() => { fresh(1); const b = park(), F = fsim(b, [b]);
    const C = [{ e: 8300, z: 700 }, { e: 9200, z: 0 }, { e: 8300, z: -700 }];
    const v = Ship.aiSpawn(F, 'cyclon', { e: 7500, z: 0, yaw: 0 }, { role: 'fight', skill: 0.5, course: C });
    const best = C.map(() => Infinity), seq = []; let last = v.ai.wp;
    run(F, 260, (t, f) => { if (f % 15) return; const P = ez(v); C.forEach((c, k) => { best[k] = Math.min(best[k], Math.hypot(P[0] - c.e, P[1] - c.z)); }); if (v.ai.wp !== last) { seq.push(v.ai.wp); last = v.ai.wp; } });
    return JSON.stringify({ best: best.map(Math.round), seq, kn: +(v.speed() * SHIP.KN).toFixed(1), tel: v.sh.tel, sas: v.sas, man: v.sh.man }); })()`);
  t(`the helm: a Cyclon on a course of three waypoints passes each in turn (closest ${o.best.join(' / ')} m, ≤ 250), at ${o.kn} kn, her heading held (sas ${o.sas}) and the telegraph at ${o.tel}`,
    o.best.every((d) => d <= 250) && o.seq.slice(0, 3).join() === '1,2,0' && o.sas === 'hold' && !o.man && o.tel > 0, o);
}
// 2. Land and shallows (the look: 9 heightAt a second): an Osca sent from the bay at a point on the far side of the
// Faroes' main island never touches the bed, always has her draft and a metre more under her, and gets round the coast
// (east of the bay's headland); one sent straight at Shetland turns off before the shallows (her draft + 3 m)
{
  const o = J(`(() => { fresh(2); const b = park(), F = fsim(b, [b]);
    const v = Ship.aiSpawn(F, 'osca', { e: -2300, z: 0, yaw: 0 }, { role: 'fight', skill: 0.5, course: [{ e: 6000, z: 0 }] });
    let minD = Infinity, bed = 0, avoided = 0, way = 0;
    run(F, 260, (t, f) => { if (f % 15) return; minD = Math.min(minD, deepAt(v)); if (v.landed || v.contactTime > 0) bed++; if (v.ai.avoid) avoided++; if (v.ai.path) way++; });
    const isl = { minD: +minD.toFixed(1), draft: +v.draft.toFixed(2), bed, avoided, way, at: ez(v) };
    fresh(3); const b2 = park(), F2 = fsim(b2, [b2]);
    const w = Ship.aiSpawn(F2, 'osca', { e: 16000, z: 0, yaw: 0 }, { role: 'fight', skill: 0.5, course: [{ e: 19500, z: 0 }] });
    let minE = Infinity, bed2 = 0, east = 0;
    run(F2, 150, (t, f) => { if (f % 15) return; minE = Math.min(minE, deepAt(w)); if (w.landed || w.contactTime > 0) bed2++; east = Math.max(east, ez(w)[0]); });
    return JSON.stringify({ isl, shet: { minD: +minE.toFixed(1), draft: +w.draft.toFixed(2), bed: bed2, east } }); })()`);
  t(`land: an Osca sent across the Faroes' main island goes round it by sea (her way round planned ${o.isl.way} looks of ${Math.round(260 * 4)}; now at ${o.isl.at.join(', ')}), never on the bed, at least ${o.isl.minD} m of water under her (draft ${o.isl.draft} m; ≥ draft + 1)`,
    o.isl.bed === 0 && o.isl.minD >= o.isl.draft + 1 && (o.isl.way > 0 || o.isl.avoided > 0) && o.isl.at[0] > -1000, o.isl);
  t(`...one sent straight at Shetland turns off (east at most ${o.shet.east} m, the shore at about 17,900), never on the bed, ${o.shet.minD} m under her at the least (≥ draft + 3)`,
    o.shet.bed === 0 && o.shet.minD >= o.shet.draft + 3 && o.shet.east < 17900, o.shet);
}
// 3. Other ships: two computer's ships of different sides on reciprocal courses, 3 km apart, steer clear of each other
// (they pass more than 250 m apart; no bump); a wave's column keeps about AI.column m between its ships
{
  const o = J(`(() => { fresh(4); const b = park(), F = fsim(b, [b]);
    const a = Ship.aiSpawn(F, 'cyclon', { e: 8000, z: 0, yaw: 0 }, { role: 'fight', skill: 0.5, team: 0, course: [{ e: 13000, z: 0 }] });
    const c = Ship.aiSpawn(F, 'cyclon', { e: 11000, z: 0, yaw: Math.PI }, { role: 'fight', skill: 0.5, team: 0, course: [{ e: 6000, z: 0 }] });
    unarm(a); unarm(c); a.ai.ally = c.ai.ally = false; a.ai.team = c.ai.team = 0; // (one side: they never fight)
    let near = Infinity;
    run(F, 150, (t, f) => { if (f % 6 === 0) near = Math.min(near, dist(a, c)); });
    fresh(5); const b2 = park(), F2 = fsim(b2, [b2]);
    const lead = Ship.aiSpawn(F2, 'osca', { e: 9000, z: -700, yaw: Math.PI }, { role: 'fight', skill: 0.5, course: [{ e: 3800, z: -700 }] });
    const f1 = Ship.aiSpawn(F2, 'cyclon', { e: 9000, z: 0, yaw: Math.PI }, { role: 'fight', skill: 0.5, lead });
    let gaps = [];
    run(F2, 150, (t, f) => { if (t > 90 && f % 60 === 0) gaps.push(Math.round(dist(lead, f1))); });
    return JSON.stringify({ near: Math.round(near), gaps, st: f1.ai.state }); })()`);
  t(`ships: two on reciprocal courses pass ${o.near} m apart (> 250); a column's second ship keeps ${o.gaps.join(' / ')} m astern of the first (about ${600})`,
    o.near > 250 && o.gaps.every((g) => g > 400 && g < 900) && o.st === 'column', o);
}

// ================================================================ fighting (§9.1)
// 4. Range keeping: an Arley Berk against the player's Cyclon 6 km off (inside her radar's horizon) holds her between gunK × her reach (the lesser of
// her main weapon's and what she sees of her), closing at Full, then broadside at Half
{
  const o = J(`(() => { fresh(6); const me = ship('cyclon', { e: 9000, z: -4000, yaw: 0 }), F = fsim(me, [me]);
    const v = Ship.aiSpawn(F, 'arley', { e: 9000, z: 2000, yaw: Math.PI / 2 }, { role: 'fight', skill: 0.5 }); // (her bow at her)
    unarm(v, (w) => !w.naval); v.ciws = []; v.ai.born = Infinity; // (she only steers: her guns never ready, her missiles and torpedoes out; her reach her 127 mm's)
    const st = [];
    run(F, 160, (t, f) => { if (f % 1200 === 0) st.push([Math.round(t), v.ai.state, v.sh.tel, Math.round(dist(v, me))]); });
    return JSON.stringify({ d: Math.round(dist(v, me)), R: Math.round(v.ai.reach), st, state: v.ai.state, tel: v.sh.tel }); })()`);
  const k0 = 0.5 * o.R, k1 = 0.8 * o.R;
  t(`range keeping: an Arley Berk holds the Cyclon ${o.d} m off, inside ${Math.round(k0)}-${Math.round(k1)} m (gunK × her reach ${o.R} m), ${o.state} at telegraph ${o.tel}`,
    o.d > k0 * 0.9 && o.d < k1 * 1.1 && ['engage', 'close', 'open'].includes(o.state), o.st);
}
// 5. Gunnery: an Arley Berk's 127 mm (her missiles and torpedoes taken off) at an Olivar Perri 4 km off, the ships held
// still, seeded: the salvo whose round first ends on her (inside her box): the first is off by a ranging error of 6 × her
// aim's error (AI.err, worst..best), the fall of shot walks walk × (1 + skill) of each miss off
{
  const o = J(`(() => { const out = {};
    for (const sk of [0, 0.5, 1]) { out[sk] = [];
      for (let n = 1; n <= 5; n++) {
        fresh(10 + n);
        const tg = ship('olivar', { e: 9000, z: -2000, yaw: 0 }), F = fsim(tg, [tg]); tg.parts.forEach((p) => { p.hp = 1e9; });
        const v = Ship.aiSpawn(F, 'arley', { e: 9000, z: 2000, yaw: 0 }, { role: 'fight', skill: sk }); unarm(v, (w) => !w.naval);
        const sal = new Map(); let first = null;
        const B = tg.bounds, c = tg.com, on = (s) => { const q = qunrot(tg.q, s.x - tg.x, s.y - tg.y, s.z - tg.z), x = q.x + c.x, y = q.y + c.y, z = q.z + (c.z || 0); return x > B.minX - 2 && x < B.maxX + 2 && y > B.minY - 2 && y < B.maxY + 2 && z > B.minZ - 2 && z < B.maxZ + 2; };
        run(F, 45, () => { for (const s of Combat.S.shots) if (s.owner === v && s.k === 'shell' && !sal.has(s)) sal.set(s, v.ai.salvoN); for (const [s, k] of sal) if (!Combat.S.shots.includes(s)) { sal.delete(s); if (first == null && on(s)) first = k; } }, true);
        out[sk].push(first == null ? 99 : first);
      } }
    return JSON.stringify(out); })()`);
  const mean = (L) => L.reduce((a, b) => a + b, 0) / L.length;
  t(`gunnery: an Arley Berk's 127 mm on an Olivar 4 km off hits with salvo ${o[0].join(', ')} at the worst skill, ${o[0.5].join(', ')} at 0.5, ${o[1].join(', ')} at the best (each ≤ 6, the best ≤ 3, the best's mean ≤ the worst's)`,
    [0, 0.5, 1].every((k) => o[k].every((n) => n <= 6)) && o[1].every((n) => n <= 3) && mean(o[1]) <= mean(o[0]), o);
}
// 6. Torpedoes: a Vizby with a ship 2.5 km off fires AI.torpN in a spread of ±AI.torpSpread° about the course that meets
// her (her missiles taken off), from the tube on that side, and not again for AI.torpEvery s; none before she has looked
// a moment (AI.react)
{
  const o = J(`(() => { fresh(20); const tg = ship('olivar', { e: 9000, z: -1250, yaw: 0 }), F = fsim(tg, [tg]);
    const v = Ship.aiSpawn(F, 'vizby', { e: 9000, z: 1250, yaw: 0 }, { role: 'fight', skill: 0.5 }); unarm(v, (w) => w.asm);
    const T = [];
    run(F, 30, (t) => { for (const s of Combat.S.shots) if (s.k === 'stor' && s.owner === v && !T.some((q) => q.s === s)) T.push({ s, t }); }, true);
    const S = v.sh, b = T.map((q) => brgOf(S, q.s.gyro.x, q.s.gyro.y, q.s.gyro.z)), c = brgOf(S, tg.x - v.x, tg.y - v.y, tg.z - v.z);
    return JSON.stringify({ n: T.length, t: T.map((q) => +q.t.toFixed(2)), b: b.map((x) => +x.toFixed(1)), c: +c.toFixed(1) }); })()`);
  const spread = o.b.length === 2 ? Math.abs(o.b[0] - o.b[1]) : 0, mid = o.b.length === 2 ? (o.b[0] + o.b[1]) / 2 : 999;
  t(`torpedoes: a Vizby fires ${o.n} at a ship 2.5 km off (at ${o.t.join(', ')} s: after her ${2.75}-s look), on courses ${o.b.join('° and ')}° (${spread.toFixed(1)}° apart, about ${2 * 4}; their middle ${mid.toFixed(1)}° on the ship's ${o.c}°), and no more within ${60} s`,
    o.n === 2 && Math.abs(spread - 8) < 0.6 && deg(mid - o.c) < 3 && o.t[0] >= 2, o);
}
// 7. Anti-ship missiles: an Osca 6 km from an Arley Berk fires one every AI.asmEvery s at skill 0.5, and two a few
// seconds apart every AI.asmEvery s only at the best skill (0.85 and up): her four in two pairs
{
  const o = J(`(() => { const out = {};
    for (const sk of [0.5, 1]) { fresh(30); const tg = ship('arley', { e: 9000, z: -3000, yaw: 0 }), F = fsim(tg, [tg]); unarm(tg); tg.ciws = [];
      const v = Ship.aiSpawn(F, 'osca', { e: 9000, z: 3000, yaw: Math.PI }, { role: 'fight', skill: sk });
      const L = [];
      run(F, 47, (t) => { for (const s of Combat.S.shots) if (s.k === 'missile' && s.owner === v && !L.some((q) => q.s === s)) L.push({ s, t }); }, true);
      out[sk] = L.map((q) => +q.t.toFixed(1)); }
    return JSON.stringify(out); })()`);
  const gaps = (L) => L.slice(1).map((x, i) => +(x - L[i]).toFixed(1));
  t(`anti-ship missiles: an Osca 6 km off fires at ${o[0.5].join(', ')} s at skill 0.5 (one every 20 s) and at ${o[1].join(', ')} s at the best (two, ${gaps(o[1])[0]} s apart, every 20 s)`,
    o[0.5].length === 3 && gaps(o[0.5]).every((g) => Math.abs(g - 20) < 0.6) && o[1].length === 4 && Math.abs(gaps(o[1])[0] - 3) < 0.6 && Math.abs(gaps(o[1])[2] - 3) < 0.6 && Math.abs(o[1][2] - o[1][0] - 20) < 0.6, o);
}
// 8. Evasion: a torpedo running at an Arley Berk from 2.6 km off her beam: she turns to comb its track (her bow or stern
// along it, whichever is the smaller turn) and rings Flank; under fire (a foe's rounds falling round her) she zigzags
// ±AI.zig° about her course every AI.zigT s
{
  const o = J(`(() => { fresh(40); const me = ship('vizby', { e: 9000, z: -2600, yaw: 0 }), F = fsim(me, [me]);
    const v = Ship.aiSpawn(F, 'arley', { e: 8000, z: 0, yaw: 0 }, { role: 'fight', skill: 0.5, course: [{ e: 14000, z: 0 }] }); unarm(v);
    run(F, 6);
    const S = me.sh, b = brgOf(S, v.x - me.x, v.y - me.y, v.z - me.z) * Math.PI / 180, tube = me.parts.find((p) => p.def.weapon && p.def.weapon.kind === 'torp');
    const T = Ship.fireTorp(me, tube, F, { x: S.N.x * Math.cos(b) + S.E.x * Math.sin(b), y: S.N.y * Math.cos(b) + S.E.y * Math.sin(b), z: S.N.z * Math.cos(b) + S.E.z * Math.sin(b) });
    unarm(me); let comb = Infinity, tel = 0, hold = Infinity;
    run(F, 35, (t, f) => { if (f % 30 === 0 && T && !T.dead && T.ph !== 'air') { const tb = brgOf(v.sh, T.vx, T.vy, T.vz), off = (h) => Math.min(Math.abs(((h - tb + 540) % 360) - 180), Math.abs(((h - tb + 360) % 360) - 180));
      if (t > 3) { hold = Math.min(hold, off(v.sh.hold * 180 / Math.PI)); comb = Math.min(comb, off(hd(v))); tel = Math.max(tel, v.sh.tel); } } });
    const combState = v.ai.state;
    fresh(41); const me2 = ship('cyclon', { e: 9000, z: -6000, yaw: 0 }), F2 = fsim(me2, [me2]); unarm(me2); // (the player's, 6 km off in open water)
    const w = Ship.aiSpawn(F2, 'olivar', { e: 9000, z: 0, yaw: 0 }, { role: 'fight', skill: 0.5, course: [{ e: 16000, z: 0 }] }); unarm(w); w.ciws = [];
    run(F2, 5);
    const flips = [], offs = []; let z0 = w.ai.zig;
    run(F2, 70, (t, f) => { if (f % 180 === 0 && t < 65) { const q = w.toWorld(w.com.x, w.com.y + 30, (w.com.z || 0) + 60); Combat.S.shots.push({ k: 'shell', sh: 'he127', b: EARTH, x: q.x, y: q.y, z: q.z, vx: 0, vy: 0, vz: 0, t: 0, life: 90, owner: me2, enemy: false, net: 0, cal: 127, pen: 0, v0: 810, spare: me2, gTop: 0, dud: true }); } // (duds: they fall round her and hurt nothing)
      if (w.ai.zig !== z0) { flips.push(Math.round(t)); z0 = w.ai.zig; } if (f % 30 === 0 && w.ai.under && w.ai.want != null) offs.push(Math.round(((((hd(w) - (w.ai.want * 180 / Math.PI - w.ai.zig * SHIP.AI.zig)) + 540) % 360) - 180))); });
    return JSON.stringify({ comb, hold, tel, combState, flips, under: w.ai.under }); })()`);
  t(`evasion: an Arley Berk orders a heading combing a torpedo's track (${o.hold.toFixed(0)}° off it) and swings to it (${o.comb.toFixed(0)}° off, ≤ 25) at Flank (${o.tel}); under fire an Olivar zigzags, her ±30° turned at ${o.flips.join(', ')} s (every ${20} s)`,
    o.hold <= 10 && o.comb <= 25 && o.tel === 4 && o.flips.length >= 3 && o.flips.slice(1).every((x, i) => Math.abs(x - o.flips[i] - 20) <= 1), o);
}
// 9. Retreat: an Olivar Perri fighting a Cyclon loses two thirds of her crew: she turns away at Flank and lays smoke
{
  const o = J(`(() => { fresh(50); const me = ship('cyclon', { e: 9000, z: -5000, yaw: 0 }), F = fsim(me, [me]); unarm(me);
    const v = Ship.aiSpawn(F, 'olivar', { e: 9000, z: 0, yaw: 0 }, { role: 'fight', skill: 0.5 }); unarm(v); v.ciws = [];
    run(F, 12);
    const s0 = v.ai.state, d0 = dist(v, me);
    let C = Armour.crewOf(v), k = 0; for (const e of C.crew) if (k++ % 3) { if (e.i >= 0) { e.host.mods = e.host.mods || []; e.host.mods[e.i] = 0; } else e.part.broken = true; }
    const sm0 = Combat.S.smoke.filter((c) => c.by === v).length;
    run(F, 40);
    return JSON.stringify({ s0, state: v.ai.state, tel: v.sh.tel, d0: Math.round(d0), d: Math.round(dist(v, me)), smoke: Combat.S.smoke.filter((c) => c.by === v).length - sm0 }); })()`);
  t(`retreat: with two thirds of her crew down an Olivar Perri goes from ${o.s0} to ${o.state} at Flank (${o.tel}), opening the range ${o.d0} → ${o.d} m, her smoke laid astern (${o.smoke} clouds)`,
    o.s0 !== 'retreat' && o.state === 'retreat' && o.tel === 4 && o.d > o.d0 && o.smoke >= 10, o);
}
// 10. The shore (S9): an Arley Berk 3 km off the headland's slipway, where a TK-34 stands at the water's edge: she lays her
// 127 mm on it (HE) and knocks it out
{
  const o = J(`(() => { fresh(60); const tk = build(templateRows(TEMPLATES.tk34), 'tank', 'TK-34'); tk.placeOnSurface(EARTH, siteAngle(EARTH, 3150), 0, 0, 0);
    const F = fsim(tk, [tk]); run(F, 2);
    const v = Ship.aiSpawn(F, 'arley', { e: 6200, z: 0, yaw: Math.PI }, { role: 'fight', skill: 0.6 });
    let ko = null, gk = null, sh = null;
    run(F, 100, (t) => { if (v.ai.gk === 'shore' && !gk) { gk = v.ai.gk; const g = v.parts.find((p) => p.type === 'nGun127'); sh = g.shellNext || g.shellSel || 'he127'; } if (ko == null && (tk.ko || tk.dead)) ko = +t.toFixed(1); });
    return JSON.stringify({ ko, gk, sh, fired: v.ai.fired, d: Math.round(dist(v, tk)) }); })()`);
  t(`the shore (S9): an Arley Berk ${o.d} m off lays her 127 mm on a TK-34 at the slipway's foot (${o.gk}, ${o.sh}) and knocks it out in ${o.ko} s (${o.fired} rounds)`,
    o.gk === 'shore' && o.ko != null && o.ko < 100 && /^he/.test(o.sh), o);
}
// 11. A strike aircraft's run: the Striker comes in at STRIKE.alt m, down to about STRIKE.low m for the last STRIKE.lowR
// m, lets its bombs go where they fall on the ship (about STRIKE.rel m out), they land on her, and it goes away and
// round again (her guns and the close-in gun taken off)
{
  const o = J(`(() => { fresh(70); const me = ship('arley', { e: 9000, z: 0, yaw: 0 }), F = fsim(me, [me]); unarm(me); me.ciws = [];
    const s = Ship.spawnStriker(F), B = []; let altIn = [], lowAt = null, ph = [], hp0 = hpOf(me);
    run(F, 150, (t, f) => {
      for (const q of Combat.S.shots) if (q.k === 'bomb' && q.owner === s && !B.some((b) => b.q === q)) B.push({ q, D: dist(s, me), alt: Math.hypot(s.x, s.y, s.z) - EARTH.radius });
      for (const c of me.sh.comps) { c.W = 0; c.holes.length = 0; } for (const p of me.parts) if (p.holes) p.holes.length = 0; // (her holes patched at once: she stays afloat for its second run)
      const alt = Math.hypot(s.x, s.y, s.z) - EARTH.radius, d = dist(s, me);
      if (f % 30 === 0 && d > 5000 && s.ai.ph === 'in' && !B.length) altIn.push(Math.round(alt)); // (its first run in)
      if (ph[ph.length - 1] !== s.ai.ph) ph.push(s.ai.ph);
    });
    const S = me.sh, land = B.map((b) => { const dx = b.q.x - me.x, dy = b.q.y - me.y, dz = b.q.z - me.z; return Math.round(Math.hypot(dx * S.E.x + dy * S.E.y + dz * S.E.z, dx * S.N.x + dy * S.N.y + dz * S.N.z)); });
    return JSON.stringify({ n: B.length, rel: B.map((b) => Math.round(b.D)), relAlt: B.map((b) => Math.round(b.alt)), land, altIn: [Math.min(...altIn), Math.max(...altIn)], ph, holes: +holeA(me).toFixed(1), dead: !!s.dead }); })()`);
  t(`a strike aircraft: in at ${o.altIn.join('-')} m, one bomb a pass ([WP10 review]: two passes), let go ${o.rel.join(' and ')} m out at ${o.relAlt.join(' and ')} m up (about 800 m, low), landing ${o.land.join(' and ')} m from the ship's middle (≤ 90: on her or close, give or take its error), away and round again between (${o.ph.join(' → ')})`,
    o.n === 2 && o.altIn[0] > 250 && o.altIn[1] < 340 && o.rel.every((d) => d > 450 && d < 1150) && o.relAlt.every((h) => h < 130) && o.land.every((d) => d <= 90) && o.ph.join().startsWith('in,out,in,out') && !o.dead, o);
}

// ================================================================ down, the range (§9.2)
// 12. A computer's ship doomed (WP8's fate: Ship.doom) is booked once (ai.down, her guns stopped); one that loses her
// bridge to a hit (Combat.aiDown with no fate yet) is left to her fate, never made an aircraft's falling hulk
{
  const o = J(`(() => { fresh(80); const me = ship('cyclon', { e: 9000, z: -3000, yaw: 0 }), F = fsim(me, [me]);
    const v = Ship.aiSpawn(F, 'osca', { e: 9000, z: 0, yaw: 0 }, { role: 'fight', skill: 0.5 });
    run(F, 2);
    Combat.aiDown(v, F); const early = { down: !!v.ai.down, hulk: v.hulk, debris: !!v.isDebris };
    v.lastHitBy = me; Ship.doom(v, F, 'sunk', me);
    const n = Ship.aiShips.length;
    run(F, 3);
    return JSON.stringify({ early, down: !!v.ai.down, gone: !!v.ai.gone, fate: v.fate, aimP: v.aimP, fire: !!v.aimFire, n, left: Ship.aiShips.length, toasts: F.toasts }); })()`);
  t(`down: Combat.aiDown on a computer's ship with no fate yet leaves her to it (down ${o.early.down}, hulk ${o.early.hulk}); doomed she is booked once (${o.fate}, her guns stopped) and leaves the AI's list (${o.n} → ${o.left})`,
    !o.early.down && o.early.hulk == null && !o.early.debris && o.down && o.gone && o.fate === 'sunk' && o.aimP == null && !o.fire && o.left === o.n - 1, o);
}
// 13. Practice (Settings → Targets: Practice, the player's Cyclon off the slipway): within a second a moored hulk 2 km
// out and three ships steaming their loops at about their speeds; a ship sunk by the player counts, and is back 60 s
// later at its loop's far point
{
  const o = J(`(() => { fresh(90); Settings.data.targets = 'practice';
    const me = ship('cyclon', { e: 3540, z: 0, yaw: 0 }), F = fsim(me, [me]); F.navalRange = true; // (the range in a test's stand-in for the flight: only when it says so)
    run(F, 2);
    const R0 = Ship.naval, ships = Ship.aiShips.slice(), roles = ships.map((v) => v.ai.key + ':' + v.ai.role), hulk = ships.find((v) => v.ai.role === 'passive');
    const rad = [], kn = {};
    run(F, 100, (t, f) => { if (t > 60 && f % 600 === 0) for (const v of ships) if (v.ai.role === 'loop') { const L = v.ai.loop, P = ez(v); rad.push(+(Math.hypot(P[0] - L.e, P[1] - L.z) / L.r).toFixed(2)); kn[v.ai.key] = +(v.speed() * SHIP.KN).toFixed(1); } });
    const osca = ships.find((v) => v.ai.key === 'osca'); osca.lastHitBy = me; Ship.doom(osca, F, 'sunk', me);
    run(F, 2);
    const kos = Ship.naval.kos, dead = Ship.naval.dead.length;
    run(F, 61);
    const back = Ship.aiShips.filter((v) => v.ai.key === 'osca' && v !== osca), P = back.length ? ez(back[0]) : null, L = EARTH.navalRange.loops[1], M = ez(me);
    return JSON.stringify({ mode: R0 && R0.mode, roles, hulkAt: ez(hulk), moored: !!hulk.moored, rad, kn, kos, dead, back: back.length, far: P ? Math.round(Math.hypot(P[0] - M[0], P[1] - M[1]) - Math.hypot(L.e - M[0], L.z - M[1])) : null, toasts: F.toasts.slice(0, 3) }); })()`);
  t(`Practice: a moored hulk at ${o.hulkAt.join(', ')} (${o.moored}) and three under way (${o.roles.join(', ')})`,
    o.mode === 'practice' && o.roles.join() === 'cyclon:passive,cyclon:loop,osca:loop,olivar:loop' && o.moored && Math.abs(o.hulkAt[0] - 5540) < 100, o.toasts);
  t(`...on their loops (${Math.min(...o.rad)}-${Math.max(...o.rad)} of each loop's radius) at ${Object.entries(o.kn).map(([k, x]) => `${k} ${x}`).join(', ')} kn (12, 18, 15 asked: within 4)`,
    o.rad.every((r) => r > 0.8 && r < 1.2) && Math.abs(o.kn.cyclon - 12) <= 4 && Math.abs(o.kn.osca - 18) <= 4 && Math.abs(o.kn.olivar - 15) <= 4, o);
  t(`...the Osca sunk counts (${o.kos}) and is back 60 s later on her loop's far side (${o.far} m further from the player than its middle)`, o.kos === 1 && o.dead === 1 && o.back === 1 && o.far > 0, o);
}
// 14. Hostile: the first wave 20 s in, from the east (out of sight beyond the horizon: [WP10 review] 6.5-10.5 km east of
// the player, in column), two Cyclons at skill 0.2 coming west at her; sunk, "Wave 1 sunk", the next 30 s later (an Osca
// and a Cyclon, skill 0.3), and from the second wave a strike aircraft; targets set Off: all of it gone
{
  const o = J(`(() => { fresh(100); Settings.data.targets = 'hostile';
    const me = ship('arley', { e: 6000, z: 0, yaw: 0 }), F = fsim(me, [me]); F.navalRange = true; unarm(me); me.ciws = []; me.parts.forEach((p) => { p.hp = 1e9; });
    run(F, 1.5);
    const w0 = Ship.naval.wave;
    run(F, 20);
    const W1 = Ship.naval.left.slice(), w1 = W1.map((v) => v.ai.key + '@' + v.ai.skill.toFixed(1)), at = W1.map(ez), m0 = ez(me);
    const d0 = W1.map((v) => dist(v, me));
    run(F, 20);
    const closing = W1.map((v, i) => Math.round(d0[i] - dist(v, me)));
    for (const v of W1) { v.lastHitBy = me; Ship.doom(v, F, 'sunk', me); }
    run(F, 2);
    const between = Ship.naval.left.length, sunk = F.toasts.filter((x) => /Wave 1 sunk/.test(x)).length;
    run(F, 31);
    const w2 = Ship.naval.left.map((v) => v.ai.key + '@' + v.ai.skill.toFixed(1)), wave = Ship.naval.wave;
    run(F, 45);
    const strikers = Ship.strikers.length, kos = Ship.naval.kos;
    Settings.data.targets = 'off';
    run(F, 1.5);
    const after = { range: !!Ship.naval, ai: Ship.aiShips.length, strikers: F.vessels.filter((v) => v.ai && v.ai.strike && !v.dead).length, on: Ship.aiOn };
    return JSON.stringify({ w0, w1, at, m0, closing, between, sunk, w2, wave, strikers, kos, after }); })()`);
  t(`Hostile: nothing for 20 s (wave ${o.w0}), then ${o.w1.join(', ')} from the east (at ${o.at.map((p) => p.join(',')).join(' and ')}; the player at ${o.m0.join(',')}), coming at her (${o.closing.join(', ')} m nearer in 20 s)`,
    o.w0 === 0 && o.w1.join() === 'cyclon@0.2,cyclon@0.2' && o.at.every((p) => p[0] >= o.m0[0] + 6000 && p[0] <= o.m0[0] + 11200 && Math.abs(p[1] - o.m0[1]) < 3000) && o.closing[0] > 100 && o.closing[1] > 0, o);
  t(`...sunk: "Wave 1 sunk" (${o.sunk}), none left (${o.between}); 30 s later wave ${o.wave}: ${o.w2.join(', ')}; then a strike aircraft (${o.strikers}); ${o.kos} counted`,
    o.sunk === 1 && o.between === 0 && o.wave === 2 && o.w2.join() === 'osca@0.3,cyclon@0.3' && o.strikers >= 1 && o.kos === 2, o);
  t(`...Targets set Off: the range, its ships and its aircraft gone (${JSON.stringify(o.after)})`, !o.after.range && o.after.ai === 0 && o.after.strikers === 0 && !o.after.on, o.after);
}

// ================================================================ the gates (§13, §14)
// 15. Old play never opens any of it: a Falcon in the air over the range with the targets at Practice and Hostile (no
// ship afloat) never calls into the AI or the range and no ship comes; a ship in a room starts no range, nor one with
// targets Off
{
  const o = J(`(() => { fresh(110); const calls = {};
    for (const k of ['aiFrame', 'aiSpawn', 'rangeStart', 'aiDown', 'flyStriker', 'range']) { const f = Ship[k]; Ship[k] = function (...a) { calls[k] = (calls[k] || 0) + 1; return f.apply(this, a); }; }
    const out = {};
    for (const m of ['practice', 'hostile']) {
      Settings.data.targets = m; Combat.reset({});
      const pl = build(templateRows(TEMPLATES.falcon), 'plane', 'Falcon'); pl.placeOnSurface(EARTH, siteAngle(EARTH, 9000), 0, 0, 0);
      const k = (EARTH.radius + 600) / Math.hypot(pl.x, pl.y, pl.z); pl.x *= k; pl.y *= k; pl.z *= k; pl.landed = false; // (600 m up over the range)
      const F = fsim(pl, [pl]); F.navalRange = true; run(F, 3, null, true);
      out[m] = { sea: Combat.S.sea, on: Ship.aiOn, ships: F.vessels.filter((v) => v.ai && v.ai.sea).length };
    }
    Settings.data.targets = 'practice'; Combat.reset({});
    const me = ship('cyclon', { e: 3540, z: 0, yaw: 0 }), F2 = fsim(me, [me]); F2.navalRange = true;
    this.MP = { active: true, live: false, shared: false, enemy: () => false, enemyGhosts: () => [], sendShot() {}, sendMissile() {}, sendFlares() {}, sendLock() {}, sendGun() {} };
    run(F2, 3);
    const room = { naval: !!Ship.naval, ai: Ship.aiShips.length };
    delete this.MP;
    Settings.data.targets = 'off'; Combat.reset({}); Ship.aiReset(null);
    const me3 = ship('cyclon', { e: 3540, z: 0, yaw: 0 }), F3 = fsim(me3, [me3]); F3.navalRange = true; run(F3, 3);
    const off = { naval: !!Ship.naval, ai: Ship.aiShips.length };
    Settings.data.targets = 'hostile'; Combat.reset({}); Ship.aiReset(null);
    const me4 = ship('cyclon', { e: 3540, z: 0, yaw: 0 }), F4 = fsim(me4, [me4]); run(F4, 3); // (another suite's stand-in for the flight)
    const stand = { naval: !!Ship.naval, ai: Ship.aiShips.length };
    for (const k of Object.keys(calls)) delete calls[k];
    return JSON.stringify({ out, room, off, stand }); })()`);
  t(`gates: a Falcon over the range with targets at Practice and Hostile: no ship afloat, no AI, no ship comes (${JSON.stringify(o.out)})`,
    ['practice', 'hostile'].every((m) => !o.out[m].sea && !o.out[m].on && o.out[m].ships === 0), o);
  t(`...a ship in a room starts no range (${JSON.stringify(o.room)}), nor with targets Off (${JSON.stringify(o.off)}), nor in another suite's stand-in for the flight (${JSON.stringify(o.stand)})`, !o.room.naval && o.room.ai === 0 && !o.off.naval && o.off.ai === 0 && !o.stand.naval && o.stand.ai === 0, o);
}

// ================================================================ the review's (round 1)
// 17. Nothing through a friend (§9.1): a Vizby with the player's Olivar 2.5 km off and an Olivar of her own side 1.2 km out
// on the line between them holds her fire (no round, missile or torpedo of hers meets the friend); the friend moved a
// kilometre and a half aside, she fires
{
  const o = J(`(() => { const out = {};
    for (const aside of [0, 1500]) { fresh(1500); const me = ship('olivar', { e: 9000, z: -2500, yaw: 0 }), F = fsim(me, [me]); unarm(me); me.ciws = []; me.parts.forEach((p) => { p.hp = 1e9; });
      const v = Ship.aiSpawn(F, 'vizby', { e: 9000, z: 0, yaw: 0 }, { role: 'fight', skill: 0.5 }); unarm(v, (w) => w.asm);
      const fr = Ship.aiSpawn(F, 'olivar', { e: 9000 + aside, z: -1200, yaw: 0 }, { role: 'fight', skill: 0.5 }); unarm(fr); fr.ciws = []; fr.ai.born = Infinity; fr.parts.forEach((p) => { p.hp = 1e9; });
      let hits = 0, last = fr.lastHitAt; const mine = new Set();
      run(F, 30, () => { for (const s of Combat.S.shots) if (s.owner === v) mine.add(s); if (fr.lastHitAt !== last) { last = fr.lastHitAt; if (fr.lastHitBy === v) hits++; } }, true);
      out[aside] = { foe: Ship.foe(v, fr), fired: mine.size, hits, holes: fr.parts.reduce((q, p) => q + (p.holes ? p.holes.length : 0), 0) }; }
    return JSON.stringify(out); })()`);
  t(`friends: a Vizby with a ship of her own side on her line of fire holds it (${o[0].fired} shots, ${o[0].hits} hits on the friend, ${o[0].holes} holes); with the friend 1.5 km aside she fires (${o[1500].fired} shots)`,
    !o[0].foe && o[0].hits === 0 && o[0].holes === 0 && o[0].fired === 0 && o[1500].fired > 0, o);
}
// 18. Her SAMs keep their one fire-control channel (her tracking radar guides the SAM in the air): two of the player's
// anti-ship missiles 3 s apart at an Arley Berk (her SAMs alone): she engages one at a time and kills at least one
const o18 = J(`(() => { const out = [];
  for (const seed of [1, 2]) {
    fresh(1400 + seed); const me = ship('osca', { e: 9000, z: -7000, yaw: 0 }), F = fsim(me, [me]); me.parts.forEach((p) => { p.hp = 1e9; });
    const ar = Ship.aiSpawn(F, 'arley', { e: 9000, z: 0, yaw: Math.PI / 2 }, { role: 'fight', skill: 0.9 }); unarm(ar, (w) => !w.vls); ar.ciws = []; ar.ai.born = Infinity; ar.parts.forEach((p) => { p.hp = 1e9; });
    run(F, 6, null, true);
    const M = [];
    for (let i = 0; i < 2; i++) { const m = Ship.asmAt(me, ar, F); if (m) M.push(m); run(F, 3, null, true); }
    const sams = new Set(); let lk = null, sw = 0;
    run(F, 40, () => { for (const s of Combat.S.shots) if (s.owner === ar && s.k === 'missile') sams.add(s); const L = ar.trk && ar.trk.lock; if (L !== lk) { lk = L; sw++; } }, true);
    out.push({ asm: M.length, sams: sams.size, kills: M.filter((m) => m.killedBy === ar).length, switches: sw });
  }
  return JSON.stringify(out); })()`);
t(`SAMs: two missiles in at an Arley Berk, her one fire-control channel on one at a time: ${o18.map((r) => `${r.sams} SAMs, ${r.kills} of ${r.asm} killed, ${r.switches} locks`).join('; ')} (at least one killed, no lock taken off a SAM in the air: ≤ 4 locks)`,
  o18.every((r) => r.asm === 2 && r.kills >= 1 && r.switches <= 4), o18);
// 19. Practice targets never fire: the loops' and the hulk's close-in guns off. A hulk put out of action comes back only
// where nothing lies (her wreck still afloat: elsewhere, 700 m off), and never on the player's ship parked on its spot
{
  const o = J(`(() => { fresh(1200); Settings.data.targets = 'practice';
    const me = ship('cyclon', { e: 3540, z: 0, yaw: 0 }), F = fsim(me, [me]); F.navalRange = true;
    run(F, 2);
    const ciws = Ship.aiShips.map((v) => v.sh.ciwsOn);
    const h = Ship.aiShips.find((v) => v.ai.role === 'passive'); h.lastHitBy = me; Ship.doom(h, F, 'action', me);
    run(F, 62);
    const h2 = Ship.aiShips.find((v) => v.ai.role === 'passive' && v !== h), d1 = h2 ? Math.round(dist(h, h2)) : null, oldUp = Math.round(Math.hypot(h.x, h.y, h.z) - EARTH.radius);
    // (the player parked on the hulk's spot, the hulk sunk again: the next comes elsewhere)
    fresh(1201); Settings.data.targets = 'practice';
    const H = EARTH.navalRange.hulk, me2 = ship('cyclon', { e: H.e + 20, z: H.z, yaw: 0 }), F2 = fsim(me2, [me2]); F2.navalRange = true;
    run(F2, 2);
    const g = Ship.aiShips.find((v) => v.ai.role === 'passive');
    return JSON.stringify({ ciws, d1, oldUp, d2: g ? Math.round(dist(g, me2)) : null }); })()`);
  t(`Practice: none of its targets' close-in guns is on (${o.ciws.join(', ')}); the hulk back 60 s later ${o.d1} m from the old one still afloat (${o.oldUp} m) (≥ 200), and ${o.d2} m from the player's ship parked on its spot (≥ 200)`,
    o.ciws.every((c) => !c) && o.d1 != null && o.d1 >= 200 && o.d2 != null && o.d2 >= 200, o);
}
// 20. Where a Hostile wave comes in: out of sight (no ship of it sees her, nor she it, by the horizon), 6.5-10.5 km off, from
// the east where the sea allows (dead east from the slipway; Shetland in the way at e 14,000: from its south-east), with a
// way by sea to her; the toast names where from and how far. From the slipway, at e 14,000, off Shetland's harbour, east
// of Shetland and in the bay west of the Faroes' main island
{
  const o = J(`(() => { const out = [];
    for (const [id, e, z] of [['slipway', 3540, 0], ['e14k', 14000, 0], ['shetland', 17420, 150], ['eastShet', 23600, 0], ['bay', -2300, 0]]) {
      fresh(600); Settings.data.targets = 'hostile';
      const me = ship('cyclon', { e, z, yaw: 0 }), F = fsim(me, [me]); F.navalRange = true; unarm(me); me.parts.forEach((p) => { p.hp = 1e9; });
      run(F, 21.5);
      const W = Ship.naval ? Ship.naval.left : [], m = ez(me), L = W[0], P = L ? ez(L) : null;
      const sees = W.some((v) => Ship._ai.seaSeen(v, F).includes(me)), way = L && Ship._ai.navOn() ? Ship._ai.navPath({ e: P[0], z: P[1] }, { e: m[0], z: m[1] }) : null;
      out.push({ id, n: W.length, d: L ? Math.round(dist(L, me)) : null, east: P ? P[0] - m[0] : null, brg: P ? Math.round(Math.atan2(P[0] - m[0], -(P[1] - m[1])) * 180 / Math.PI) : null, sees, way: !!way, toast: F.toasts.filter((q) => /^Wave 1/.test(q))[0] || '' });
    }
    return JSON.stringify(out); })()`);
  for (const r of o) t(`a wave's coming in (${r.id}): ${r.n} ships ${r.d} m off at ${r.brg}° (east ${r.east} m), out of sight (${!r.sees}), a way by sea to her (${r.way}): "${r.toast}"`,
    r.n === 2 && r.d >= 6400 && r.d <= 10600 && !r.sees && r.way && (r.id === 'eastShet' || r.id === 'shetland' ? true : r.east > 0) && (r.id === 'slipway' ? Math.abs(r.brg - 90) <= 25 : true) && /from the (north|south|east|west|north-east|north-west|south-east|south-west), [\d,]+ m off/.test(r.toast), r);
}
// 21. Round the island: the player's Cyclon in the bay west of the Faroes' main island, Hostile: wave 1 comes round the
// island by sea (never on the bed), at Flank, and sees her within 6 minutes
{
  const o = J(`(() => { fresh(610); Settings.data.targets = 'hostile';
    const me = ship('cyclon', { e: -2300, z: 0, yaw: 0 }), F = fsim(me, [me]); F.navalRange = true; unarm(me); me.parts.forEach((p) => { p.hp = 1e9; });
    run(F, 21.5);
    const W = Ship.naval.left.slice(), d0 = Math.round(dist(W[0], me)); let bed = 0, seen = null, minD = Infinity;
    run(F, 360, (t, f) => { if (f % 30) return; for (const v of W) { if (v.landed || v.contactTime > 0) bed++; minD = Math.min(minD, deepAt(v)); } if (seen == null && W.some((v) => v.ai.seen && v.ai.tgt === me)) seen = Math.round(t); if (seen != null) return false; });
    return JSON.stringify({ d0, seen, bed, minD: +minD.toFixed(1), d: W.map((v) => Math.round(dist(v, me))), st: W.map((v) => v.ai.state) }); })()`);
  t(`round the island: from the bay, wave 1 comes in ${o.d0} m off and round the Faroes' main island by sea (never on the bed: ${o.bed}; ${o.minD} m under her at least), sighting her ${o.seen} s later (≤ 360; now ${o.d.join(', ')} m off, ${o.st.join(', ')})`,
    o.bed === 0 && o.seen != null && o.seen <= 360, o);
}
// 22. A retreat to open water: an Olivar Perri fighting a Cyclon to the east with the Faroes' main island at her back
// loses two thirds of her crew: she retreats at Flank round the island's end, never on the bed, and isn't left stuck
{
  const o = J(`(() => { fresh(620); const me = ship('cyclon', { e: 10500, z: 400, yaw: Math.PI }), F = fsim(me, [me]); unarm(me); me.parts.forEach((p) => { p.hp = 1e9; });
    const v = Ship.aiSpawn(F, 'olivar', { e: 6000, z: 400, yaw: 0 }, { role: 'fight', skill: 0.5 }); unarm(v); v.ciws = [];
    run(F, 8);
    const C = Armour.crewOf(v); let k = 0; for (const e of C.crew) if (k++ % 3) { if (e.i >= 0) { e.host.mods = e.host.mods || []; e.host.mods[e.i] = 0; } else e.part.broken = true; }
    let bed = 0, minD = Infinity, slow = 0; const kn = [];
    run(F, 360, (t, f) => { if (f % 30) return; if (v.landed || v.contactTime > 0) bed++; minD = Math.min(minD, deepAt(v)); if (t > 60 && v.speed() < 2) slow++; if (f % 1800 === 0) kn.push(+(v.speed() * SHIP.KN).toFixed(1)); });
    return JSON.stringify({ state: v.ai.state, bed, slow, minD: +minD.toFixed(1), at: ez(v), kn }); })()`);
  t(`a retreat to open water: an Olivar Perri with the Faroes' main island at her back retreats (${o.state}) to ${o.at.join(', ')}, never on the bed (${o.bed}), ${o.minD} m under her at least, never stopped (${o.slow} slow looks; ${o.kn.join(', ')} kn)`,
    o.state === 'retreat' && o.bed === 0 && o.slow === 0 && o.minD > 8, o);
}
// 23. The old target range's two bandits are its own: the Naval Range's strike aircraft don't take their places
// (old-1); a 30 mm at a ship fires only within 0.8 of its reach, and in bursts (its 300 rounds last the fight)
{
  const o = J(`(() => { fresh(630); Settings.data.targets = 'hostile';
    const me = ship('arley', { e: 6000, z: 0, yaw: 0 }), F = fsim(me, [me]); unarm(me); me.ciws = []; me.parts.forEach((p) => { p.hp = 1e9; }); // (no Naval Range: the old range alone, with two strike aircraft up)
    Ship.spawnStriker(F); Ship.spawnStriker(F);
    let old = 0; const seen = new Set();
    run(F, 60, () => { for (const q of F.vessels) if (Combat.isFighter(q) && !q.ai.strike && !q.dead) seen.add(q); });
    const strikers = F.vessels.filter((q) => q.ai && q.ai.strike && !q.dead).length;
    const out = { bandits: seen.size, strikers };
    for (const D of [2300, 1700]) {
      fresh(640); const tg = ship('cyclon', { e: 9000, z: -D / 2, yaw: 0 }), G = fsim(tg, [tg]); unarm(tg); tg.parts.forEach((p) => { p.hp = 1e9; });
      const v = Ship.aiSpawn(G, 'cyclon', { e: 9000, z: D / 2, yaw: Math.PI }, { role: 'fight', skill: 0.2 });
      const g = v.parts.find((p) => p.type === 'ac30'), a0 = g.ammo; let on = 0, n = 0;
      run(G, 60, (t, f) => { if (f % 15 === 0) { n++; if (v.aimFire) on++; } }, true);
      out[D] = { used: a0 - g.ammo, duty: +(on / n).toFixed(2) };
    }
    return JSON.stringify(out); })()`);
  t(`the old range keeps its own bandits with two strike aircraft up (${o.bandits} of its own came; ${o.strikers} strike aircraft)`, o.bandits >= 1 && o.strikers === 2, o);
  t(`bursts: a Cyclon's 30 mm at a ship 2.3 km off holds its fire (${o[2300].used} rounds in 60 s); at 1.7 km it fires in bursts (${o[1700].used} rounds, the trigger down ${Math.round(o[1700].duty * 100)} % of the time: ≤ 50 %)`,
    o[2300].used === 0 && o[1700].used > 0 && o[1700].duty <= 0.5 && o[1700].used < 300, o);
}
// 24. The end screen's tally (Flight.summaryHTML): the Naval Range's ships sunk and best shot; the range's memory of the sunk
// let go (R.mine: only what is still in the flight)
{
  const o = J(`(() => { fresh(650); Settings.data.targets = 'hostile';
    const me = ship('arley', { e: 6000, z: 0, yaw: 0 }), F = fsim(me, [me]); F.navalRange = true; unarm(me); me.ciws = []; me.parts.forEach((p) => { p.hp = 1e9; });
    run(F, 22);
    const W = Ship.naval.left.slice(); for (const v of W) { v.lastHitBy = me; Ship.doom(v, F, 'sunk', me); }
    run(F, 2); const mine0 = Ship.naval.mine.size;
    for (const v of W) v.dead = true; // (gone under: the flight lets them go)
    run(F, 2);
    const mine1 = Ship.naval.mine.size, live = F.vessels.filter((v) => Ship.naval.mine.has(v)).length;
    Ship.naval.best = 6200; Flight.active = me; Flight.time = 600; Flight.driven = 5000; Flight.stats = { maxSpeed: 15 }; Flight.fresh = {};
    const html = Flight.summaryHTML('', true), plain = (() => { Flight.active = park(); return Flight.summaryHTML('', true); })();
    return JSON.stringify({ mine0, mine1, live, row: (html.match(/Ships sunk<\\/dt><dd>[^<]*/) || [''])[0], other: /Ships sunk/.test(plain) }); })()`);
  t(`the end screen: "${o.row.replace(/<[^>]+>/g, ' ')}" (none for another craft: ${!o.other}); the range lets the sunk go (${o.mine0} → ${o.mine1}, ${o.live} still in the flight)`,
    /Ships sunk.*2 · best shot/.test(o.row) && !o.other && o.mine1 === o.live && o.mine1 < o.mine0, o);
}
// 25. A wave never comes in on the last one's wrecks: waves 1 and 2 put out of action where they appear (their hulks
// afloat for a minute before they are scuttled), wave 3 comes in clear of them (≥ 200 m from each) and 20 s on neither
// of its ships has come to grief
{
  const o = J(`(() => { fresh(660); Settings.data.targets = 'hostile';
    const me = ship('arley', { e: 6000, z: 0, yaw: 0 }), F = fsim(me, [me]); F.navalRange = true; unarm(me); me.ciws = []; me.parts.forEach((p) => { p.hp = 1e9; });
    const old = []; let guard = 0;
    while ((!Ship.naval || Ship.naval.wave < 3) && guard++ < 400) { run(F, 1); if (Ship.naval) for (const v of Ship.naval.left.slice()) if (v.ai.wave < 3) { old.push(v); v.lastHitBy = me; Ship.doom(v, F, 'action', me); } }
    const W = Ship.naval.left.slice(), afloat = old.filter((v) => !v.dead && Math.hypot(v.x, v.y, v.z) - EARTH.radius > -20);
    const near = Math.round(Math.min(...W.flatMap((w) => afloat.map((v) => dist(v, w)))));
    run(F, 20);
    return JSON.stringify({ wave: W.map((v) => v.ai.wave), afloat: afloat.length, near, fates: W.map((v) => v.fate || null) }); })()`);
  t(`a new wave clear of the last one's wrecks: wave 3 comes in ${o.near} m from the nearest of ${o.afloat} still afloat (≥ 200), and 20 s on its ships are whole (${o.fates.join(', ')})`,
    o.wave.every((w) => w === 3) && o.afloat > 0 && o.near >= 200 && o.fates.every((f) => f === null), o);
}

// 26. The time warp (the review's play-1 and play-4): the range holds it at 1× only while a Hostile wave's ship is within
// 4 km of her or has her in its weapons' reach (or a strike aircraft is within 12 km). Practice never holds it; a wave
// just come in off the slipway (out of sight, beyond its 30 mm's reach) leaves it to her, also once it has seen her; it
// is held once the wave closes inside 4 km
{
  const o = J(`(() => { fresh(670); Settings.data.targets = 'practice';
    const me = ship('cyclon', { e: 3540, z: 0, yaw: 0 }), F = fsim(me, [me]); F.navalRange = true; unarm(me); me.parts.forEach((p) => { p.hp = 1e9; });
    run(F, 5); const practice = { on: !!Ship.naval, held: Ship._ai.enemyNear(F) };
    fresh(671); Settings.data.targets = 'hostile';
    const m2 = ship('cyclon', { e: 3540, z: 0, yaw: 0 }), G = fsim(m2, [m2]); G.navalRange = true; unarm(m2); m2.parts.forEach((p) => { p.hp = 1e9; });
    run(G, 21.5); const W = Ship.naval.left.slice(), d0 = Math.round(dist(W[0], m2)), at0 = Ship._ai.enemyNear(G);
    let seenAt = null, seenHeld = false, heldAt = null, heldD = null;
    run(G, 400, (t, f) => { if (f % 15) return; const held = Ship._ai.enemyNear(G);
      if (seenAt == null && W.some((v) => v.ai.seen && v.ai.tgt === m2)) { seenAt = +t.toFixed(1); seenHeld = held; }
      if (held) { heldAt = +t.toFixed(1); heldD = Math.round(Math.min(...W.map((v) => dist(v, m2)))); return false; } });
    return JSON.stringify({ practice, d0, at0, seenAt, seenHeld, heldAt, heldD }); })()`);
  t(`the time warp: Practice never holds it (${JSON.stringify(o.practice)}); Hostile, wave 1 in ${o.d0} m off leaves it (${!o.at0}), seeing her ${o.seenAt} s later still leaves it (${!o.seenHeld}), and it is held ${o.heldAt} s in, the nearest ${o.heldD} m off (≤ 4,000)`,
    o.practice.on && !o.practice.held && !o.at0 && o.seenAt != null && !o.seenHeld && o.heldAt > o.seenAt && o.heldD <= 4000 && o.heldD > 3000, o);
}

// ================================================================ the cost (§15)
// 16. Think (4 a second): ≤ 0.1 ms a ship (an Arley Berk fighting an Olivar 6 km off; asserted at 2×, as other suites
// share the machine); the look: exactly 9 heightAt
{
  const o = J(`(() => { fresh(120); const me = ship('olivar', { e: 9000, z: -3000, yaw: 0 }), F = fsim(me, [me]);
    const v = Ship.aiSpawn(F, 'arley', { e: 9000, z: 3000, yaw: Math.PI }, { role: 'fight', skill: 0.5 });
    run(F, 3, null, true);
    for (let i = 0; i < 400; i++) { F.time += 0.25; Ship._ai.think(v, F); Combat.S.shots.length = 0; }
    const TT = []; for (let i = 0; i < 800; i++) { F.time += 0.25; Combat.S.shots.length = 0; const t0 = __hr(); Ship._ai.think(v, F); TT.push(__hr() - t0); } // (no physics: what she fires is cleared, as flown away)
    TT.sort((x, y) => x - y); const think = TT.slice(0, 720).reduce((q, x) => q + x, 0) / 720; // (the slowest tenth left out: a garbage collection lands on whichever think runs then)
    const h = Terrain.heightAt; let n = 0; Terrain.heightAt = function (...a) { n++; return h.apply(this, a); };
    for (let i = 0; i < 10; i++) Ship._ai.look(v, F); Terrain.heightAt = h;
    return JSON.stringify({ think: +think.toFixed(4), looks: n / 10, state: v.ai.state }); })()`);
  t(`cost: a think ${(o.think * 1000).toFixed(0)} µs (≤ 100; asserted at 2×: the machine is shared), a look ${o.looks} heightAt (9)`, o.think <= 0.2 && o.looks === 9, o);
}
// 16b. A Hostile wave's physics (§15: the player and three computer's ships with the LOD, ≤ 1.5 % of a desktop core: 15 ms
// a second of the sim): the player's Arley Berk at Half and a Vizby, an Osca and an Olivar 4.5 km off, timed in a plain
// script as the page runs it (the test VM's globals cost several times a page's: ships.test 12), in CPU time (a loaded
// machine's waiting left out), the best of three runs of 10 s of the sim; asserted at 2× (a slow, shared machine), as
// ships.test's Ship.forces check is. The player's Arley alone the same way. And the LOD: an Olivar 4.5 km off against one
// 800 m off, each step timed in the same loop (the slowest tenth left out); the far ships' speeds under it as under the
// every-other-step LOD (SHIP.LOD_AI 2: what a computer's ship had before), within 2 %
{
  const fs = require('fs'), path = require('path'), src = (f) => fs.readFileSync(path.join(G.ROOT, 'js', f), 'utf8'), b = src('builder.js');
  const code = [src('util.js').replace(/const \$ =[\s\S]*$/, ''), src('space.js'), src('terrain.js'), `Terrain.setEarthData(require(${JSON.stringify(path.join(G.ROOT, 'test/lib/earth.js'))}).layers());`,
    src('parts.js'), src('vessel.js'), src('gear.js'), src('aim.js'), src('armour.js'), src('drone.js'), src('ship.js'),
    b.match(/const TEMPLATES = \{[\s\S]*?\n\};/)[0], b.match(/function templateRows\(t\) \{[\s\S]*?\n\}/)[0], `
    const mk = (key, e, z, yaw, ai) => { const rows = templateRows(TEMPLATES[key]).map((r) => ({ ...r })), parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
      const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
      const v = new Vessel(ps, adj, EARTH); v.kind = 'ship'; v.name = key; v.stages = []; v.rebuildGroups(); v.placeOnSurface(EARTH, siteAngle(EARTH, e), 0, z, yaw); Ship.launch(v, { e, z, yaw }); v.sh.tel = 2; if (ai) v.ai = { sea: true }; return v; };
    const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
    const pl = mk('arley', 9000, 0, 0), ships = ['vizby', 'osca', 'olivar'].map((k, i) => mk(k, 13500, -1500 + i * 1500, Math.PI, true)), near = mk('olivar', 9000, 800, 0, true);
    const L = [pl, ...ships], F = { time: 0, active: pl, vessels: L, toast() {}, ripParts() {}, breakParts() {} };
    const hr = () => Number(process.hrtime.bigint()) / 1e6;
    const step = (list, secs, per) => { for (let i = 0; i < secs * 120; i++) { for (const o of list) { const a = per ? hr() : 0; o.physicsStep(1 / 120, F); if (per) { if (!per.has(o)) per.set(o, []); per.get(o).push(hr() - a); } } F.time += 1 / 120; } };
    step(L, 5);
    const reps = []; for (let r = 0; r < 3; r++) { const a = cpu(); step(L, 10); reps.push((cpu() - a) / 10); }
    const kn = L.map((o) => +(o.speed() * 1.943844).toFixed(2));
    const alone = []; F.vessels = [pl]; for (let r = 0; r < 3; r++) { const a = cpu(); step([pl], 5); alone.push((cpu() - a) / 5); }
    // (ms a second of the sim from each step's time, the slowest tenth left out: a garbage collection lands on whoever steps then)
    F.vessels = [pl, ships[2], near]; const per = new Map(); step(F.vessels, 3); step(F.vessels, 10, per);
    const ms = (o) => { const q = per.get(o).slice().sort((x, y) => x - y), k = Math.floor(q.length * 0.9); return (q.slice(0, k).reduce((s, x) => s + x, 0) / k) * 120; };
    // (the same three under the every-other-step LOD, from the same start: their speeds 35 s on)
    SHIP.LOD_AI = 2; const old = ['vizby', 'osca', 'olivar'].map((k, i) => mk(k, 13500, -1500 + i * 1500, Math.PI, true)), pl2 = mk('arley', 9000, 0, 0);
    F.active = pl2; F.vessels = [pl2, ...old]; F.time = 0; step(F.vessels, 35);
    console.log(JSON.stringify({ wave: +Math.min(...reps).toFixed(1), reps: reps.map((x) => +x.toFixed(1)), alone: +Math.min(...alone).toFixed(1), far: +ms(ships[2]).toFixed(1), near: +ms(near).toFixed(1), kn, kn2: [pl2, ...old].map((o) => +(o.speed() * 1.943844).toFixed(2)) }));`].join('\n;\n');
  const o = JSON.parse(require('child_process').execFileSync(process.execPath, ['-'], { input: code, encoding: 'utf8', maxBuffer: 1 << 24 }).trim().split('\n').pop());
  t(`...a Hostile wave's physics: ${o.wave} ms a second of the sim (${(o.wave / 10).toFixed(2)} % of this core; runs ${o.reps.join(', ')}) for the player's Arley (alone ${o.alone}) and three computer's ships 4.5 km off (§15: 15 ms, 1.5 % of a desktop core; asserted at 2×); an Olivar 4.5 km off ${o.far} ms, 800 m off ${o.near} (the LOD: ≤ 0.85×); the far ships at ${o.kn.slice(1).join(', ')} kn, ${o.kn2.slice(1).join(', ')} under the old LOD (within 2 %)`,
    o.wave <= 30 && o.far <= 0.85 * o.near && o.kn.every((k, i) => Math.abs(k - o.kn2[i]) <= 0.02 * o.kn2[i] + 0.05), o);
}
t.done();
