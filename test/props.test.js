// The battlefields' props (js/props.js): solid, deterministic scenery for ground play. The same layout on every load
// and in a second VM (and built a slice at a time or at once); every prop on dry ground, off the pads, the zones' middles,
// the berms, the roads, the runway, apron, pad and helipad and the old test paths; the arena's lines of sight as the
// design has them; a shell stopped by a house, an HE one bursting on it; Aim.sees blocked by a house and by a wood and
// not by a tree knocked over; a tank stopped by a house's wall, and a tree it drives into falling and no longer in its
// way; an AI vehicle driving 120 s through the village never inside a building, and its costs; the sandbox's tank yard.
//   node test/props.test.js
const G = require('./lib/game.js'), TANKS = require('./lib/tanks.js'), crypto = require('crypto');
const t = G.checks('props.test.js');
const ctx = G.load({ combat: true }), R = (c) => G.run(ctx, c);
R(`Settings.get = (k) => ({ targets: 'off', high: false })[k];`); // (no Tank Range: nothing else on the field)
ctx.__now = () => Number(process.hrtime.bigint()) / 1e6;
const P = ctx.Props, E = ctx.EARTH, T = ctx.Terrain, K = P.K, R0 = E.radius;
const A = (e) => ctx.siteAngle(E, e), gH = (e, z) => T.surfaceAt(E, A(e), z), wet = (e, z) => T.waterAt(E, A(e), z);
const at = (e, z, up) => { const a = A(e), ph = z / R0, r = R0 + gH(e, z) + up; return { x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) }; };
const kindOf = (p) => P.KINDS[p.k];

// ---------------------------------------------------------------- the layout: the same every time
const t0 = ctx.__now();
P.buildAll();
const buildMs = ctx.__now() - t0;
const sum = (Pr) => { const h = crypto.createHash('md5'); for (const m of Pr.areas()) { h.update(m.id); for (const p of m.props) h.update([p.k, p.e, p.z, p.y, p.w, p.d, p.h, p.g, p.gt, p.r2 || 0, p.c1, p.c2].join(',') + ';'); } return h.digest('hex'); };
const one = sum(P), counts = {};
for (const m of P.areas()) counts[m.id] = P.count(m.id);
const tally = (id) => Object.entries(counts[id]).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`     (built in ${buildMs.toFixed(0)} ms: Highland Ridge ${tally('highland')}; the Runway ${tally('runway')}; the island ${tally('isle')})`);
R('Props._S.built = false; Props.buildAll();'); // (again in the same VM, the terrain's caches warm)
const two = sum(P);
const vm2 = G.load(), P2 = vm2.Props;
vm2.performance.now = () => Number(process.hrtime.bigint()) / 1e6;
let slices = 0;
while (!P2.tick(0.5)) slices++; // (a second VM, a slice at a time, as the renderer and the app build it)
t('the same layout on a second load, and in a second VM built half a millisecond at a time', one === two && one === sum(P2) && slices > 50, { one, two, vm2: sum(P2), slices });
const n = (id, k) => (counts[id] && counts[id][k]) || 0;
t('Highland Ridge: a village of houses, barns and ruins round a church, walls, hedges and fences, woods, bushes and rocks',
  n('highland', 'church') === 1 && n('highland', 'house') >= 40 && n('highland', 'ruin') >= 10 && n('highland', 'barn') >= 5 && n('highland', 'wall') >= 150 && n('highland', 'hedge') >= 150
  && n('highland', 'fence') >= 60 && n('highland', 'conifer') + n('highland', 'broadleaf') >= 600 && n('highland', 'bush') >= 300 && n('highland', 'rock') + n('highland', 'boulder') >= 150, counts.highland);
t('the Runway: sheds, containers, sandbags, blocks and crates beside the runway, a few trees and rocks', n('runway', 'garage') >= 2 && n('runway', 'container') >= 6 && n('runway', 'sandbags') >= 9 && n('runway', 'block') >= 9, counts.runway);
t('the island: the tank yard (its slab, garages, fuel depot, stores, blocks, the course), a hamlet, a farm, sheep walls, rocks and bushes',
  n('isle', 'slab') === 1 && n('isle', 'garage') === 4 && n('isle', 'fueltank') === 2 && n('isle', 'silo') === 1 && n('isle', 'tyres') === 12 && n('isle', 'house') >= 4 && n('isle', 'wall') >= 100, counts.isle);
const nomap = G.load({ earth: false });
nomap.Props.buildAll();
t('without the Earth map: only the Runway\'s (Highland Ridge and the island need the map)', nomap.Props.areas().map((m) => m.id).join() === 'runway' && nomap.Props.areas()[0].props.length > 60);

// ---------------------------------------------------------------- where they stand, and where they don't
const H = E.arenas.highland, RW = E.arenas.runway, Y = E.groundPads.yard, I = T.ISLE;
const foot = (p) => { const L = [[0, 0], [p.w / 2, p.d / 2], [-p.w / 2, p.d / 2], [p.w / 2, -p.d / 2], [-p.w / 2, -p.d / 2]]; return L.map(([u, v]) => [p.e + u * p.c - v * p.s, p.z + u * p.s + v * p.c]); };
const segD = (e, z, a, b) => { const de = b[0] - a[0], dz = b[1] - a[1], l2 = de * de + dz * dz, k = l2 ? Math.max(0, Math.min(1, ((e - a[0]) * de + (z - a[1]) * dz) / l2)) : 0; return Math.hypot(e - a[0] - de * k, z - a[1] - dz * k); };
const bad = { wet: [], ground: [], pad: [], zone: [], berm: [], road: [], runway: [], centre: [], paths: [], yard: [] };
for (const m of P.areas()) for (const p of m.props) {
  const F = foot(p), r = Math.hypot(p.w, p.d) / 2, tag = `${m.id} ${kindOf(p)} (${p.e.toFixed(0)}, ${p.z.toFixed(0)})`;
  const lift = p.k === K.container && p.g > Math.min(...F.map(([e, z]) => gH(e, z))) + 1; // (a container stacked on another)
  const wide = [K.house, K.barn, K.church, K.ruin, K.shed, K.garage, K.container, K.wall, K.sandbags, K.hedge].includes(p.k); // (as Props.add: these by their corners)
  if (F.slice(0, wide ? 5 : 1).some(([e, z]) => wet(e, z))) bad.wet.push(tag);
  if (!lift && Math.abs(p.g - Math.min(...F.slice(0, wide ? 5 : 1).map(([e, z]) => gH(e, z)))) > 0.02) bad.ground.push(tag); // (its foot on its ground's lowest corner: never floating)
  if (m.id === 'highland') {
    for (const f of H.pads) { const de = p.e - f.e, dz = p.z - f.z, u = Math.abs(de * f.c + dz * f.s), v = Math.abs(-de * f.s + dz * f.c); if (u < f.hl + 30 && v < f.hw + 30) bad.pad.push(tag); }
    for (const zn of H.zones) if (Math.hypot(p.e - zn.e, p.z - zn.z) < 20 + r) bad.zone.push(tag);
    for (const b of H.berms) { const de = p.e - b.e, dz = p.z - b.z, u = Math.abs(de * b.c + dz * b.s), v = Math.abs(-de * b.s + dz * b.c); if (u < 13 + r && v < 12 + r) bad.berm.push(tag); }
    if (P.roadGap(p.e, p.z) < r) bad.road.push(tag);
  }
  if (m.id === 'runway' || m.id === 'isle') {
    if (Math.abs(p.z) < 50 && p.e > 560 && p.e < 2820) bad.runway.push(tag); // (the runway and its shoulders)
    if (p.e > 760 && p.e < 1420 && p.z > -230 && p.z < 0) bad.runway.push(tag + ' (apron)');
    if (Math.hypot(p.e, p.z) < 320) bad.centre.push(tag); // (the pad, the assembly building, the tank farm, the helipad at 160 m)
    if ((p.e > 2650 && Math.abs(p.z) < 40) || (Math.abs(p.z) < 30 && p.e > 0 && p.e < 3000)) bad.paths.push(tag); // (the causeway, the buggy's and the tanks' runs down the runway)
    if (p.k !== K.slab && Math.abs(p.e - Y.e) < Y.hl && Math.abs(p.z - Y.z) < Y.hw && !(p.k === K.block && Math.abs(p.z - Y.z) > Y.hw - 1)) bad.yard.push(tag); // (the yard's spots: only its slab)
  }
}
t('every prop on dry ground, its foot on its ground (the lowest corner: nothing floats)', !bad.wet.length && !bad.ground.length, bad.wet.slice(0, 4).concat(bad.ground.slice(0, 4)));
t('Highland Ridge: none on a pad (or within 30 m), a zone\'s middle, a berm or a road', !bad.pad.length && !bad.zone.length && !bad.berm.length && !bad.road.length, [bad.pad.length, bad.zone.length, bad.berm.length, bad.road.length, ...bad.road.slice(0, 3)]);
t('the space centre: none on the runway, its shoulders or the apron, by the pad, the assembly building or the helipad, on the causeway or the old paths down the runway, or on the yard\'s spots',
  !bad.runway.length && !bad.centre.length && !bad.paths.length && !bad.yard.length, [...bad.runway, ...bad.centre, ...bad.paths, ...bad.yard].slice(0, 6));
// the Tank Range's targets and the patrol loop keep their ground (groundai.js LAYOUT and LOOP)
{
  let near = 0;
  for (const p of P.areas().find((m) => m.id === 'highland').props) {
    const r = Math.hypot(p.w, p.d) / 2;
    if (Math.abs(Math.hypot(p.e - 18450, p.z - 14810) - 191) < 12 + r || Math.hypot(p.e - 17580, p.z - 14385) < 12 + r || Math.hypot(p.e - 17750, p.z - 14560) < 12 + r) near++;
  }
  t('...nor on the Tank Range\'s parked targets\' spots or the patrol loop through the village', near === 0, near);
}

// ---------------------------------------------------------------- the arena's lines of sight (test/tools/arena-probe.js)
// eye 2.4 m, target 1.6 m: the hilltop sees the slope and the village; no pad sees the other or a zone (props only add cover)
const losClear = (p, q, eye = 2.4, tgt = 1.6) => {
  const o = at(p.e, p.z, eye), d = at(q.e, q.z, tgt), N = Math.ceil(Math.hypot(d.x - o.x, d.y - o.y, d.z - o.z) / 5), L = {};
  for (let i = 1; i < N; i++) { const k = i / N; T.locate(E, o.x + (d.x - o.x) * k, o.y + (d.y - o.y) * k, o.z + (d.z - o.z) * k, L); if (L.r < R0 + gH(-ctx.wrapAngle(L.a - E.padAngle) * R0, L.z) + 0.3) return false; }
  return P.clear(o, d);
};
{
  const Z = {}; for (const zn of H.zones) Z[zn.id] = zn;
  const PTS = { N: { e: 17750, z: 13800 }, S: { e: 17750, z: 16200 }, A: Z.A, C: Z.C, B: Z.B }, seen = [];
  const names = Object.keys(PTS);
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (losClear(PTS[names[i]], PTS[names[j]])) seen.push(names[i] + '-' + names[j]);
  t('the lines of sight as the arena was made: A-C and A-B seen with the props in, every pad\'s hidden', seen.join() === 'A-C,A-B', seen);
}

// ---------------------------------------------------------------- shells
const HL = P.areas().find((m) => m.id === 'highland').props;
const own = (p) => P.hit && P._S.list[P.hit.p] === p; // (what Props.segment met last is prop p)
// a house in the village whose front (local +z) has nothing else in front of it for 60 m (at 1.6 m over its floor)
const front = (p, d, up) => { const fe = -p.s, fz = p.c, r = R0 + p.g + up, a = A(p.e + fe * d), ph = (p.z + fz * d) / R0; return { x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) }; };
const mid = (p, up) => front(p, 0, up);
const gun = (p, d) => { const fe = -p.s, fz = p.c, e = p.e + fe * d, z = p.z + fz * d; return { e, z, h: d ? gH(e, z) + 2.5 : p.g + (p.h + p.gt - p.g) / 2 }; }; // (the muzzle 2.5 m over its own ground; the wall's middle)
const sim3 = (q) => { const r = R0 + q.h, a = A(q.e), ph = q.z / R0; return { x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) }; };
const house = HL.filter((p) => p.k === K.house && p.w > 8 && p.d > 6.5).sort((a, b) => Math.hypot(a.e - 18450, a.z - 15000) - Math.hypot(b.e - 18450, b.z - 15000))
  .find((p) => { const o = gun(p, 40), c = gun(p, 0); if (o.h < c.h - 1 || o.h > c.h + 3) return false; // (the street about as high as its walls' middle)
    if (P.segment(sim3(o), sim3(c), P.F.SHELL | P.F.SIGHT | P.F.SOLID | P.F.CRUSH) < 0 || !own(p)) return false;
    return P.segment(front(p, 16, 0.6), mid(p, 0.6), P.F.SOLID | P.F.CRUSH) >= 0 && own(p); });
ctx.__house = house; ctx.__gun = gun;
R(`var simOf = () => ({ time: 0, target: null, toasts: [], broken: [], vessels: [], active: null, firing: false, mgFiring: false, groundAim: false, aim: null, zero: 800, warpIdx: 0,
  running: true, destroyed: false, camAbs: { x: 0, y: 0, z: 0 }, toast(m) { this.toasts.push(m); }, ripParts() {}, breakParts() {} });
var pt = (e, z, up) => { const a = siteAngle(EARTH, e), ph = z / EARTH.radius, r = EARTH.radius + Terrain.surfaceAt(EARTH, a, z) + up; return { x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) }; };
var ezOf = (q) => { const L = Terrain.locate(EARTH, q.x, q.y, q.z, {}); return { e: -wrapAngle(L.a - EARTH.padAngle) * EARTH.radius, z: L.z }; };
// a shell from 40 m in front of the house (its front faces local +z), 2.5 m over the street, at its wall's middle
var level = (q) => { const r = EARTH.radius + q.h, a = siteAngle(EARTH, q.e), ph = q.z / EARTH.radius; return { x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) }; };
var fireAt = (sh) => { const p = __house, F = simOf(), S = SHELLS[sh], o = level(__gun(p, 40)), c = level(__gun(p, 0));
  const dx = c.x - o.x, dy = c.y - o.y, dz = c.z - o.z, l = Math.hypot(dx, dy, dz);
  const s = { k: 'shell', sh, b: EARTH, x: o.x, y: o.y, z: o.z, vx: dx / l * S.v0, vy: dy / l * S.v0, vz: dz / l * S.v0, t: 0, life: 6, owner: null, cal: S.cal, pen: S.pen, v0: S.v0 };
  const out = { puff: null, boom: null, end: null, steps: 0 }, PU = FX.puff, EX = Combat.explode;
  FX.puff = (b, q) => { out.puff = ezOf(q); }; Combat.explode = (b, q) => { out.boom = ezOf(q); };
  try { while (out.steps < 400 && Armour.moveShell(s, 1 / 120, F)) out.steps++; } finally { FX.puff = PU; Combat.explode = EX; }
  out.end = ezOf(s); const q = out.puff || out.boom || out.end, de = q.e - p.e, dz2 = q.z - p.z;
  out.across = -de * p.s + dz2 * p.c; // (how far in front of its middle it stopped: half its depth, at the wall)
  return out; };
var apHit = fireAt('aphe85'), heHit = fireAt('he85');`);
t('a shell fired at a house stops at its wall (a puff of stone, nothing through)', !!house && R(`!!apHit.puff && !apHit.boom && Math.abs(apHit.across - __house.d / 2) < 0.8`), house ? R('[apHit, __house.d / 2]') : 'no house');
t('...an HE one bursts on it', !!house && R(`!!heHit.boom && !heHit.puff && Math.abs(heHit.across - __house.d / 2) < 0.8`), house ? R('heHit') : '');

// ---------------------------------------------------------------- sight
R(`var tank = (rows, e, z, yaw) => { const ps = partsFromDesign(rows), adj = buildAdjacency(ps), v = new Vessel(ps, adj, EARTH); v.kind = 'tank'; v.stages = computeStages(ps, adj, ps[0].id); v.rebuildGroups();
  v.placeOnSurface(EARTH, siteAngle(EARTH, e), 0, z, yaw || 0); return v; };
var seesAcross = (e0, z0, e1, z1) => { const a = tank(__tk, e0, z0, 0), b = tank(__tk, e1, z1, 0); return Aim.sees(a, b, { memo: false }); };`);
ctx.__tk = TANKS.tk34;
{ const p = house, fe = -p.s, fz = p.c; ctx.__s = [p.e + fe * 14, p.z + fz * 14, p.e - fe * 16, p.z - fz * 16]; }
t('Aim.sees: a tank in front of a house can\'t see one behind it', !!house && R(`!seesAcross(__s[0], __s[1], __s[2], __s[3])`), R('__s'));
// a wood (the west flank's): a line through it that only its trees' crowns block, 2.5 m up
const trees = HL.filter((p) => p.k === K.conifer || p.k === K.broadleaf), isTree = (q) => q && (q.k === K.conifer || q.k === K.broadleaf);
let woodLine = null;
for (let dz = -60; dz <= 60 && !woodLine; dz += 10) {
  const a = at(16420, 14260 + dz, 2.5), b = at(16840, 14260 + dz, 2.5);
  if (P.segment(a, b, P.F.SIGHT) >= 0 && isTree(P._S.list[P.hit.p])) woodLine = [16420, 14260 + dz, 16840, 14260 + dz];
}
ctx.__w = woodLine;
t('...nor one across a wood (its trees\' crowns)', !!woodLine && R(`!seesAcross(__w[0], __w[1], __w[2], __w[3])`), woodLine);
const lone = trees.find((p) => p.h > 8 && HL.every((q) => q === p || Math.hypot(q.e - p.e, q.z - p.z) > 45));
ctx.__lone = lone;
R(`var loneLine = () => { const p = __lone, a = pt(p.e - 60, p.z, p.h * 0.62), b = pt(p.e + 60, p.z, p.h * 0.62); return Props.clear(a, b); };
var loneBefore = loneLine(); (() => { const p = __lone; p.down = 1; p.fe = 1; p.fz = 0; p.t0 = 0; Props._S.fallen.push(p); Props._S.crushed++; })();
var loneAfter = loneLine(); Props.reset(); var loneBack = loneLine();`);
t('...a lone tree\'s crown blocks the line through it; knocked over it doesn\'t; stood up again it does', !!lone && R(`loneBefore === false && loneAfter === true && loneBack === false`), lone ? R('[loneBefore, loneAfter, loneBack]') : 'no lone tree');

// ---------------------------------------------------------------- vehicles
R(`var world = (...vs) => Object.assign(simOf(), { vessels: vs, active: vs[0] });
var go = (F, secs, each) => { for (let f = 0, N = Math.round(secs * 60); f < N; f++) { if (each) each(F); for (let i = 0; i < 2; i++) { for (const v of F.vessels) if (!v.dead && !v.wreck && !v.kin && v.parts.length) v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; } Combat.frame(F, 1 / 60); } };
// a TK-34 16 m in front of the house (on the street), facing it, flat out for 8 s: how near its middle came (across: in front of the house's)
var ram = (() => { const p = __house, fe = -p.s, fz = p.c, yaw = Math.atan2(fz, -fe); const v = tank(__tk, p.e + fe * 16, p.z + fz * 16, yaw), F = world(v); Combat.reset(F);
  let least = Infinity; go(F, 8, () => { v.ctl.v = 1; const q = ezOf(v); least = Math.min(least, -(q.e - p.e) * p.s + (q.z - p.z) * p.c); });
  return { least, half: p.d / 2, speed: v.speed(), parts: v.parts.length }; })();`);
t('a tank driven flat out at a house stops at its wall (its middle never nearer the house\'s than half the house and 1.5 m)', R(`ram.least > ram.half + 1.5 && ram.speed < 2`), R('ram'));
// a tree on fairly flat ground with nothing else within 26 m: a TK-34 drives into it and through
const tr = trees.filter((p) => p.h > 7).find((p) => { const e = p.e, z = p.z; if (Math.abs(gH(e + 20, z) - gH(e - 20, z)) > 3 || Math.abs(gH(e, z + 6) - gH(e, z - 6)) > 2) return false; return HL.every((q) => q === p || q.k === K.rock || Math.hypot(q.e - e, q.z - z) > 26); });
ctx.__tree = tr;
R(`var crush = (() => { const p = __tree; if (!p) return null; const v = tank(__tk, p.e - 20, p.z, 0), F = world(v); Combat.reset(F); const f0 = Props.fallen.length;
  go(F, 8, () => { v.ctl.v = 1; });
  const q = ezOf(v); return { down: !!p.down, passed: q.e > p.e + 5, f0, fe: p.fe, n: Props.fallen.length - f0 }; })();`);
t('...a tree it drives into falls over (away from it, along its way) and no longer stands in its way: it drives on past', !!tr && R(`crush.down && crush.passed && crush.fe > 0.7 && crush.n >= 1`), tr ? R('crush') : 'no tree');
R(`Props.reset();
// a ghost (another player's tank, as its snapshots move it) into the tree: it falls on our screen too
var ghostCrush = (() => { const p = __tree, v = tank(__tk, p.e - 6, p.z, 0), F = world(tank(__tk, p.e - 400, p.z, 0), v); v.remote = 7;
  Combat.reset(F); const a = v.axis(1, 0, 0); for (let i = 0; i < 40 && !p.down; i++) { v.x += a.x * 0.2; v.y += a.y * 0.2; v.z += a.z * 0.2; v.vx = a.x * 6; v.vy = a.y * 6; v.vz = a.z * 6; F.time += 1 / 15; Props.crushStep(F); }
  return !!p.down; })();
Props.reset();`);
t('...and a ghost driving into it knocks it over on our screen too', !!tr && R('ghostCrush'));
t('a new flight stands what was knocked over back up (Combat.reset), a respawn in a battle keeps it down', !!tr && R(`(() => { const p = __tree; p.down = 1; Props._S.fallen.push(p); Props._S.crushed++;
  const F = simOf(); F.spawnOpts = { keep: [{}] }; Combat.reset(F); const kept = !!p.down; F.spawnOpts = null; Combat.reset(F); return kept && !p.down; })()`));

// ---------------------------------------------------------------- the ground AI in the village
// Two AI vehicles (a TK-34 and a Pumo) sent for 120 s to free spots between the houses within 160 m of zone B, a new
// one every 9 s: never inside a building, a wall or a rock, always on the move, and a move's cost
{
  let s = 4242; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296, WP = [];
  while (WP.length < 30) { const e = 18450 + (rnd() - 0.5) * 320, z = 15000 + (rnd() - 0.5) * 320; if (P.freeAt(e, z, 6) && !wet(e, z)) WP.push([e, z]); }
  ctx.__WP = WP;
}
R(`var Fv = world(tank(__tk, 17750, 13800, -Math.PI / 2)); Fv.active.kin = true; Combat.reset(Fv); Combat.S.gai = 1;
var ais = [GroundAI.spawn(Fv, 'tk34', 18300, 15035, 0, 1, 'fight', { skill: 0.5 }), GroundAI.spawn(Fv, 'pumo', 18610, 15033, Math.PI, 1, 'fight', { skill: 0.5 })];
var inside = [], worstPen = 0, kinT = 0, kinN = 0, moved = ais.map(() => 0), last = ais.map((v) => ({ e: v.ai.k.e, z: v.ai.k.z })), legs = 0;
var KS = GroundAI.kinStep;
GroundAI.kinStep = function (v, dt) { const t0 = __now(); KS.call(this, v, dt); kinT += __now() - t0; kinN++; };
go(Fv, 120, (F) => { ais.forEach((v, i) => { const a = v.ai, k = a.k, w = __WP[(Math.floor(F.time / 9) * 2 + i) % __WP.length];
    if (!a.zone || a.zone.e !== w[0]) { a.zone = { e: w[0], z: w[1], r: 12 }; a.reached = false; legs++; }
    const pen = Props.pen2D(k.e, k.z, 1.0); if (pen > 0.05) inside.push([a.key, k.e.toFixed(1), k.z.toFixed(1), pen.toFixed(2)]); worstPen = Math.max(worstPen, pen);
    moved[i] += Math.hypot(k.e - last[i].e, k.z - last[i].z); last[i].e = k.e; last[i].z = k.z; }); });
GroundAI.kinStep = KS;
var kinUs = kinT / kinN * 1000;
GroundAI.reset(Fv);`);
t('an AI vehicle driving 120 s between the village\'s houses (to a new free spot every 9 s) is never inside a building, a wall or a rock, and keeps moving',
  R(`inside.length === 0 && moved.every((m) => m > 250)`), R('({ inside: inside.slice(0, 5), worstPen, moved, legs })'));
t('...a move with the props in costs well under 40 µs (Node)', R('kinUs < 40'), R('kinUs'));

// ---------------------------------------------------------------- the sandbox's tank yard
{
  const spots = Array.from({ length: 8 }, (_, k) => P.yardPlace(k)), lvl = spots.map((q) => Math.abs(gH(q.e, q.z) - Y.h));
  const clear = spots.every((q) => P.freeAt(q.e, q.z, 6)), ahead = spots.every((q) => P.lane(q.e, q.z, 1, 0, 60, 2.5) === Infinity);
  t('the tank yard: eight spots side by side on its levelled pad, facing east, each clear of the props, with 60 m of open ground ahead',
    spots.every((q) => q.yaw === 0 && Math.abs(q.e - Y.e) < Y.hl && Math.abs(q.z - Y.z) < Y.hw) && Math.max(...lvl) < 0.05 && clear && ahead && new Set(spots.map((q) => q.e + ',' + q.z)).size === 8, { spots, lvl, clear, ahead });
}
{
  const mp = G.load({ mp: true });
  G.run(mp, `MP.state = { players: [{ pid: 1 }, { pid: 2 }, { pid: 3 }], settings: {} }; MP.mapReady = () => true;`);
  const pl = G.run(mp, `[1, 2, 3].map((me) => { Net.me = me; const a = MP.placement(null, 'tank'), b = MP.placement(null, 'plane'); return [a && a.e, a && a.z, a && a.yaw, b]; })`);
  const want = [0, 1, 2].map((k) => P.yardPlace(k));
  t('a multiplayer sandbox starts Armour at the tank yard, side by side (planes where they were)', pl.every((q, k) => q[0] === want[k].e && q[1] === want[k].z && q[2] === 0) && pl[0][3] === null && pl[1][3] && pl[1][3].e === E.sites.runway.east + 220, pl);
}
t.done();
