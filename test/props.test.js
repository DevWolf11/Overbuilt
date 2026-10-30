// The battlefields' props (js/props.js): solid, deterministic scenery for ground play. The same layout on every load
// and in a second VM (and built a slice at a time or at once); every prop on dry ground, off the pads, the zones' middles,
// the berms, the roads, the runway, apron, pad and helipad and the old test paths; the arena's lines of sight as the
// design has them; a shell stopped by a house, an HE one bursting on it; Aim.sees blocked by a house and by a wood and
// not by a tree knocked over; a tank stopped by a house's wall, and a tree it drives into falling and no longer in its
// way; an AI vehicle driving 120 s through the village never inside a building, and its costs; the sandbox's tank yard.
// Old weapons and craft (combat.js moveShot, vessel.js ground()): a plane's cannon and machine-gun bursts into a house
// stop there, a bomb on it bursts on its roof, a rocket pod salvo bursts on a wall; the Dune Buggy stops against a wall
// and knocks a tree over; a plane flown into the church at 80 m/s breaks up against it; an old car where none stands
// drives exactly as with no props at all. The room (mp.js): what falls on one player's screen falls on another's, the
// same way; forged crush messages (bad ids, a solid prop, NaN, another layout, a flood) change nothing; a player who
// joins late gets the room's set; a respawn in a room keeps the field, a new battle stands it up.
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

// ---------------------------------------------------------------- old weapons and old craft (combat.js moveShot, vessel.js ground())
// craftAt: an old template's craft at sim point `from`, level, its nose (part +y: a plane's) toward `to`, at speed; the
// FX of what bursts and puffs, and each shot's prop, recorded; still: not stepped (a gun platform)
R(`var at3 = (e, z, h) => { const r = EARTH.radius + h, a = siteAngle(EARTH, e), ph = z / EARTH.radius; return { x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) }; };
var gh = (e, z) => Terrain.surfaceAt(EARTH, siteAngle(EARTH, e), z);
var ezh = (q) => { const L = Terrain.locate(EARTH, q.x, q.y, q.z, {}); return { e: -wrapAngle(L.a - EARTH.padAngle) * EARTH.radius, z: L.z, h: L.r - EARTH.radius }; };
var goStill = (F, secs, each) => { for (let f = 0, N = Math.round(secs * 60); f < N; f++) { if (each) each(F); for (let i = 0; i < 2; i++) { for (const v of F.vessels) if (!v.dead && !v.still && v.parts.length) v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; } Combat.frame(F, 1 / 60); } };
var craftAt = (key, from, to, speed) => { const t = TEMPLATES[key], ps = partsFromDesign(templateRows(t)), adj = buildAdjacency(ps), v = new Vessel(ps, adj, EARTH); v.kind = t.kind; v.stages = computeStages(ps, adj, findControlPart(ps).id); v.rebuildGroups();
  const U = norm3(v3(from.x, from.y, from.z)), d = norm3(v3(to.x - from.x, to.y - from.y, to.z - from.z)), k0 = -dot3(U, d), dn = norm3(v3(-U.x - d.x * k0, -U.y - d.y * k0, -U.z - d.z * k0));
  v.q = qbasis(dn, d, cross3(dn, d, v3())); v.x = from.x; v.y = from.y; v.z = from.z; v.vx = d.x * speed; v.vy = d.y * speed; v.vz = d.z * speed; v.av = v3();
  for (const id of v.stages[0] || []) { const p = v.byId.get(id); if (p && p.def.thrust) p.active = true; } v.stageIdx = 1; v.throttle = 1; return v; };
var booms = [], puffs = [], shotAt = []; { const X = FX.explosion; FX.explosion = (b, q, ...r) => { booms.push(ezh(q)); }; FX.puff = (b, q) => { puffs.push(ezh(q)); }; FX.sparks = (b, q) => { puffs.push(ezh(q)); }; }
{ const s = Props.shot; Props.shot = function (a, b) { const t = s.call(this, a, b); if (t >= 0) shotAt.push(Props._S.list[Props.hit.p]); return t; }; }
// where FX happened against prop p: across (out along its front from its middle) and along (its long side)
var rel = (p, L) => L.map((q) => [(q.e - p.e) * -p.s + (q.z - p.z) * p.c, (q.e - p.e) * p.c + (q.z - p.z) * p.s, q.h - p.g]);
var inBox = (p, L, m) => { const H = p.h + p.gt - p.g + (p.r2 || 0); return L.length > 0 && rel(p, L).every(([u, w, h]) => Math.abs(u) <= p.d / 2 + m && Math.abs(w) <= p.w / 2 + m && h > -1 && h < H + m); };
// (parts broken off and ripped away go, as Flight's do: the rest splits into pieces)
var breaks = (F) => Object.assign(F, { ripParts(v, parts, why) { this.broken.push((why || 'rip') + ':' + parts.map((p) => p.type).join(',')); this.breakParts(v, parts, null, true); },
  breakParts(v, parts, cause, quiet) { if (!quiet) this.broken.push(cause + ':' + parts.map((p) => p.type).join(','));
    for (const p of parts) { v.parts = v.parts.filter((q) => q !== p); for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.delete(p.id); }
    if (!v.parts.length) { v.dead = true; return; } v.splitComponents(); v.rebuildGroups(); } });
// (a TK-34 parked 400 m off: ground play, where Highland Ridge's props meet old weapons and craft, as they're shown)
var withTank = (...vs) => { const p = __house, tk = tank(__tk, p.e + 400, p.z, 0); tk.still = true; return breaks(world(...vs, tk)); };`);
R(`var burst = (key, type) => { const p = __house, fe = -p.s, fz = p.c, mid = p.g + (p.h + p.gt - p.g) / 2;
  const from = at3(p.e + fe * 40, p.z + fz * 40, gh(p.e + fe * 40, p.z + fz * 40) + 4), to = at3(p.e, p.z, mid);
  const v = craftAt(key, from, to, 0); v.still = true; const F = withTank(v); Combat.reset(F);
  booms.length = puffs.length = shotAt.length = 0; Math.random = (() => { let s = 3; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const gun = v.parts.find((q) => q.type === type), n0 = gun.ammo;
  goStill(F, 3, (F) => { if (F.time < 1) Combat._t.fireGun(v, gun, 1 / 60, false, F); });
  return { fired: n0 - gun.ammo, stopped: shotAt.filter((q) => q === p).length, others: shotAt.length - shotAt.filter((q) => q === p).length, booms: booms.length, puffs: puffs.length, left: Combat.S.shots.length,
    inHouse: inBox(p, booms.length ? booms : puffs, 0.6), where: rel(p, (booms.length ? booms : puffs).slice(0, 2)) }; };
var cannon = burst('striker', 'cannon'), mg = burst('camel', 'gun');`);
t('a plane\'s cannon burst into a house stops there, every round bursting on it (its wall or its roof), none past it', R(`cannon.fired >= 6 && cannon.stopped === cannon.fired && cannon.booms === cannon.fired && cannon.inHouse && !cannon.left && !cannon.others`), R('cannon'));
t('...and a machine gun\'s rounds stop in it too, with puffs of stone', R(`mg.fired >= 10 && mg.stopped === mg.fired && !mg.booms && mg.puffs > 0 && mg.inHouse && !mg.left && !mg.others`), R('mg'));
R(`var bomb = (() => { const p = __house, H = p.h + p.gt - p.g, from = at3(p.e, p.z, p.g + H + 40), to = at3(p.e + 50 * p.c, p.z - 50 * p.s, p.g + H + 40);
  const v = craftAt('striker', from, to, 0); v.still = true; const F = withTank(v); Combat.reset(F); booms.length = shotAt.length = 0;
  Combat._t.dropBomb(v, v.parts.find((q) => q.def.weapon && q.def.weapon.kind === 'bomb'), F);
  goStill(F, 6);
  return { booms: booms.length, onHouse: shotAt.filter((q) => q === p).length, inHouse: inBox(p, booms, 0.5), where: rel(p, booms), H }; })();`);
t('a bomb dropped on a house bursts on it (over its walls, not on the ground inside them)', R(`bomb.booms === 1 && bomb.onHouse === 1 && bomb.inHouse && bomb.where[0][2] > bomb.H - 0.5`), R('bomb'));
// a stone wall on Highland Ridge with flat ground and nothing else for 30 m in front of it
const wall = HL.filter((p) => p.k === K.wall && p.w > 7).find((p) => {
  const fe = -p.s, fz = p.c, H = p.h + p.gt - p.g;
  for (let d = 2; d <= 32; d += 2) if (Math.abs(gH(p.e + fe * d, p.z + fz * d) - p.g) > 0.4) return false;
  const a = at(p.e + fe * 30, p.z + fz * 30, 0.6), q = P.segment(a, front(p, 0, H / 2), P.F.SHELL | P.F.SIGHT | P.F.SOLID | P.F.CRUSH);
  return q >= 0 && own(p) && HL.every((o) => o === p || Math.hypot(o.e - (p.e + fe * 16), o.z - (p.z + fz * 16)) > 16);
});
ctx.__wall = wall;
R(`var salvo = (() => { const p = __wall; if (!p) return null; const fe = -p.s, fz = p.c, from = at3(p.e + fe * 30, p.z + fz * 30, p.g + 1.7), to = at3(p.e, p.z, p.g + 1.7);
  const v = craftAt('striker', from, to, 0); v.still = true; const F = withTank(v); Combat.reset(F); booms.length = shotAt.length = 0;
  const pod = v.parts.find((q) => q.def.weapon && q.def.weapon.kind === 'rocket'), n0 = pod.ammo;
  goStill(F, 3, (F) => { if (F.time < 0.7 && Math.round(F.time * 60) % 10 === 0) Combat._t.fireRocket(v, pod, false, F); });
  return { fired: n0 - pod.ammo, booms: booms.length, onWall: shotAt.filter((q) => q === p).length, others: shotAt.length - shotAt.filter((q) => q === p).length, inWall: inBox(p, booms, 0.5), left: Combat.S.shots.length }; })();`);
t('an old rocket pod salvo at a stone wall bursts on it, every rocket, none over or through it', !!wall && R(`salvo.fired >= 4 && salvo.booms === salvo.fired && salvo.onWall === salvo.fired && !salvo.others && salvo.inWall && !salvo.left`), wall ? R('salvo') : 'no wall');
// the Dune Buggy on the space centre's island: at a wall, flat out (nothing else for 34 m in front of it), and into a tree
const IS = P.areas().find((m) => m.id === 'isle').props, flat = (e, z, r) => { const g = gH(e, z); return [[r, 0], [-r, 0], [0, r], [0, -r]].every(([a, b]) => Math.abs(gH(e + a, z + b) - g) <= 0.6); };
const iwall = IS.filter((p) => p.k === K.wall && p.w > 7).find((p) => {
  const fe = -p.s, fz = p.c;
  for (let d = 0; d <= 34; d += 2) if (Math.abs(gH(p.e + fe * d, p.z + fz * d) - p.g) > 0.6 || wet(p.e + fe * d, p.z + fz * d)) return false;
  return IS.every((q) => q === p || Math.hypot(q.e - (p.e + fe * 17), q.z - (p.z + fz * 17)) > 19);
});
const itree = IS.filter((p) => p.k === K.conifer || p.k === K.broadleaf).find((p) => flat(p.e, p.z, 10) && flat(p.e - 12, p.z, 10) && !wet(p.e - 20, p.z)
  && IS.every((q) => q === p || !(q.e > p.e - 24 && q.e < p.e + 14 && Math.abs(q.z - p.z) < 6 + Math.hypot(q.w, q.d) / 2)));
ctx.__iwall = iwall; ctx.__itree = itree;
R(`var buggy = (e, z, yaw) => { const ps = partsFromDesign(templateRows(TEMPLATES.buggy)), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'car'; v.stages = computeStages(ps, buildAdjacency(ps), findControlPart(ps).id); v.rebuildGroups(); v.placeOnSurface(EARTH, siteAngle(EARTH, e), 0, z, yaw); return v; };
var bwall = (() => { const p = __iwall; if (!p) return null; const fe = -p.s, fz = p.c, v = buggy(p.e + fe * 30, p.z + fz * 30, Math.atan2(fz, -fe)), F = breaks(world(v)); Combat.reset(F);
  let least = Infinity, top = 0; go(F, 10, () => { v.ctl.v = 1; const q = ezOf(v); least = Math.min(least, (q.e - p.e) * fe + (q.z - p.z) * fz); top = Math.max(top, v.speed()); });
  return { least, half: p.d / 2, top, speed: v.speed(), parts: v.parts.length, broken: F.broken.join(';'), upright: dot3(v.axis(0, 1, 0), norm3(v3(v.x, v.y, v.z))), play: Props.play }; })();
var btree = (() => { const p = __itree; if (!p) return null; const v = buggy(p.e - 18, p.z, 0), F = breaks(world(v)); Combat.reset(F); const n0 = Props.crushed;
  go(F, 6, () => { v.ctl.v = 1; }); const q = ezOf(v);
  return { down: !!p.down, fe: p.fe, passed: q.e - p.e, n: Props.crushed - n0, broken: F.broken.join(';') }; })();
Props.reset();`);
t('the Dune Buggy driven flat out at a wall on the island stops against it, upright and whole (Highland Ridge closed to it: no ground play)', !!iwall && R(`bwall.least > bwall.half + 1 && bwall.least < bwall.half + 3 && bwall.top > 8 && bwall.speed < 0.5 && !bwall.broken && bwall.upright > 0.95 && !bwall.play`), iwall ? R('bwall') : 'no wall');
t('...and a tree it drives into falls over along its way, and it drives on past', !!itree && R(`btree.down && btree.fe > 0.9 && btree.passed > 10 && btree.n >= 1 && !btree.broken`), itree ? R('btree') : 'no tree');
// the Striker flown at the church's front wall at 80 m/s, 9 m up, 100 m out
const church = HL.find((p) => p.k === K.church);
ctx.__ch = church;
R(`var churchRun = (() => { const p = __ch, from = at3(p.e, p.z + 100, p.g + 9), to = at3(p.e, p.z, p.g + 9), v = craftAt('striker', from, to, 80);
  v.gearUp = true; for (const w of v.wheels) if (w.def.wheel.retract) w.retracted = true;
  const F = withTank(v); Combat.reset(F); let least = Infinity, first = null;
  goStill(F, 3, (F) => { for (const o of F.vessels) if (!o.still && o.parts.length) least = Math.min(least, ezh(o).z - p.z); if (F.broken.length && !first) { const q = ezh(v); first = { z: q.z - p.z, h: q.h - gh(q.e, q.z), why: F.broken[0] }; } });
  return { first, least, half: p.d / 2, broken: F.broken.length, parts: v.parts.length, reach: v.reach }; })();`);
t('a plane flown into the church at 80 m/s breaks up against its wall (in the air, not on the ground), nothing of it through', R(`!!churchRun.first && churchRun.first.why.startsWith('impact:') && churchRun.first.z < churchRun.half + 12 && churchRun.first.z > churchRun.half && churchRun.first.h > 2 && churchRun.least > 0 && churchRun.broken >= 2`), R('churchRun'));
// an old car where no prop stands (the buggy on the runway: away, round a corner, back, braked), here with every prop
// built and in a game with none: the same to the last digit
{
  const bare = G.load({ combat: true }), drive = `(() => { const ps = partsFromDesign(templateRows(TEMPLATES.buggy)), adj = buildAdjacency(ps), v = new Vessel(ps, adj, EARTH); v.kind = 'car'; v.stages = computeStages(ps, adj, findControlPart(ps).id); v.rebuildGroups();
    const K = VEHICLE_KINDS.car; v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[K.site].east), K.launchRot);
    const F = { time: 0, target: null, toasts: [], broken: [], vessels: [v], active: v, running: true, warpIdx: 0, camAbs: { x: 0, y: 0, z: 0 }, toast() {}, ripParts() {}, breakParts() {} }; Combat.reset(F);
    for (let f = 0; f < 14 * 60; f++) { const tt = f / 60; v.ctl.v = tt < 6 ? 1 : tt < 9 ? 0 : tt < 11 ? -1 : 0; v.ctl.h = tt > 4 && tt < 6 ? 1 : 0; v.brake = tt > 11;
      for (let i = 0; i < 2; i++) { v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; } Combat.frame(F, 1 / 60); }
    return JSON.stringify([v.x, v.y, v.z, v.vx, v.vy, v.vz, v.q, v.av, v.parts.length]); })()`;
  G.run(bare, `Settings.get = (k) => ({ targets: 'off', high: false })[k];`);
  const a = R(drive), b = G.run(bare, drive);
  t('an old car where no prop stands drives exactly as in a game with no props at all (the buggy on the runway, 14 s)', a === b && bare.Props._S.cols.length === 0 && P._S.cols.length > 5000, a === b ? '' : [a, b]);
}

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

// ---------------------------------------------------------------- the room: what falls on one screen falls on all
// Four players' games (mp.js with Net's stand-in: what each sends lands in Net.out), every prop built in each: the host
// (1), two players (2, 3) and one about to join (4). Player 2's buggy (as its own screen moves it) knocks the island's
// tree over; its message reaches player 3 (as the host passes it on) and the host, and the host's set reaches player 4.
{
  const room = (me, host) => { const c = G.load({ mp: true, props: true });
    G.run(c, `Net.me = ${me}; Net.isHost = ${host}; Net.active = true; var MPUI = new Proxy({}, { get: () => () => {} });
      MP.active = true; MP.state = { mode: 'sandbox', phase: 'free', round: 0, players: [1, 2, 3, 4].map((pid) => ({ pid, name: 'P' + pid, team: 0 })), settings: {}, feed: [] };
      MP.seenEpoch = MP.crushEpoch(); MP.crushRate = new Map(); Props.sync(true); Net.out = [];
      var treeAt = (n) => Props.areas().find((m) => m.id === 'isle').props[n];
      var hl = Props.areas().find((m) => m.id === 'highland').props;`);
    return c; };
  const [H, A, B, C] = [room(1, true), room(2, false), room(3, false), room(4, false)];
  const n = itree ? itree.n : -1;
  [H, A, B, C].forEach((c) => (c.__n = n));
  const sent = G.run(A, `(() => { const p = treeAt(__n), ps = partsFromDesign(templateRows(TEMPLATES.buggy)), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'car'; v.rebuildGroups();
    v.placeOnSurface(EARTH, siteAngle(EARTH, p.e - 1.6), 0, p.z, 0); const a = v.axis(1, 0, 0); v.vx = a.x * 8; v.vy = a.y * 8; v.vz = a.z * 8;
    Props.crushStep({ time: 1, vessels: [v] }); MP.sendCrush(); return { down: !!p.down, fe: p.fe, fz: p.fz, out: Net.out.map(([m, to]) => [m, to ?? null]) }; })()`);
  const msg = sent.out.length === 1 ? sent.out[0][0] : null, deliver = (c, m, f) => G.run(c, `(() => { MP.onCrush(Object.assign(${JSON.stringify(m)}, { f: ${f} })); return Props.crushed; })()`);
  const got = msg && (deliver(B, msg, 2), deliver(H, msg, 2), G.run(B, `(() => { const p = treeAt(__n); return { down: !!p.down, fe: p.fe, fz: p.fz, t0: p.t0 }; })()`));
  t('player 2\'s buggy knocks a tree over: one small message (its map, its layout\'s signature, its place, the way it fell in whole degrees)', !!itree && sent.down && !!msg && msg.t === 'crush' && msg.r === 0 && msg.m === 2 && msg.ids.length === 1 && msg.ids[0] === n && Number.isInteger(msg.d[0]) && sent.out[0][1] === null, sent);
  t('...on player 3\'s screen (the host passing it on) the same tree falls the same way (within a degree)', !!got && got.down && Math.hypot(got.fe - sent.fe, got.fz - sent.fz) < 0.02 && G.run(B, 'Props.crushed') === 1 && G.run(B, 'Props.queued') === 0, got);
  // the host's set, to player 4 as it joins: the tree already down there (no fall to watch)
  const late = G.run(H, `(() => { Net.out = []; MP.sendFallen(4); return Net.out.map(([m, to]) => [m, to]); })()`);
  const lateGot = late.length === 1 && late[0][1] === 4 && late[0][0].t === 'fallen' && (G.run(C, `MP.onFallen(Object.assign(${JSON.stringify(late[0][0])}, { f: 1 }))`), G.run(C, `(() => { const p = treeAt(__n); return { down: !!p.down, fe: p.fe, t0: p.t0, n: Props.crushed }; })()`));
  t('a player who joins later gets the room\'s set from the host, and sees the tree already down', !!lateGot && lateGot.down && lateGot.t0 < -1e6 && lateGot.n === 1 && Math.abs(lateGot.fe - sent.fe) < 0.02, { late, lateGot });
  t('...the set comes only from the host (a player\'s "fallen" is not believed), and only when there is one', G.run(C, `(() => { Props.reset(); MP.onFallen(Object.assign(${JSON.stringify(late[0] ? late[0][0] : {})}, { f: 2 })); return Props.crushed; })()`) === 0
    && G.run(H, `(() => { Props.reset(); Net.out = []; MP.sendFallen(4); return Net.out.length; })()`) === 0);
  // forged messages to player 3: nothing falls, nothing throws
  const forged = G.run(B, `(() => { const g = Props.areas().find((m) => m.id === 'isle').sig, n = __n, wallI = Props.areas().find((m) => m.id === 'isle').props.findIndex((p) => p.k === Props.K.wall), houseI = hl.findIndex((p) => p.k === Props.K.house);
    const ok = { t: 'crush', r: 0, m: 2, g, ids: [n], d: [90] }, c0 = Props.crushed, bad = [];
    const L = [{ ids: [n + 0.5] }, { ids: ['' + n] }, { ids: [-1] }, { ids: [70000] }, { ids: [NaN] }, { ids: [] }, { ids: null }, { ids: [Props.areas().find((m) => m.id === 'isle').props.length + 3] },
      { m: 3 }, { m: -1 }, { m: '2' }, { m: null }, { g: g + 1 }, { g: 'x' }, { g: -5 }, { d: [NaN] }, { d: [360] }, { d: [-1] }, { d: [1.5] }, { d: [Infinity] }, { d: [] },
      { ids: [n, n], d: [0] }, { ids: Array.from({ length: 33 }, () => n), d: Array.from({ length: 33 }, () => 0) },
      { ids: [wallI] }, { m: 0, g: Props.areas().find((m) => m.id === 'highland').sig, ids: [houseI] }, { r: 99 }, { f: 'x' }, { f: Net.me }, { t: 'crush', r: 0 }];
    for (const o of L) { try { MP.onCrush(Object.assign({}, ok, { f: 2 }, o)); } catch (e) { bad.push(String(e)); } }
    return { fell: Props.crushed - c0, bad, wall: !!Props.areas().find((m) => m.id === 'isle').props[wallI].down, house: !!hl[houseI].down, tree: !!Props.areas().find((m) => m.id === 'isle').props[n].down }; })()`);
  t('forged crush messages (fractions, strings, negatives, past the layout, NaN, Infinity, another map or layout, mismatched or too many, a wall or a house, another epoch, a bad sender) change nothing and throw nothing', forged.fell === 0 && !forged.bad.length && !forged.wall && !forged.house, forged);
  // a flood: 100 messages of a tree each from one player in the same instant: 64 believed (64 a second), the rest not
  const flood = G.run(B, `(() => { const g = Props.areas().find((m) => m.id === 'highland').sig, T = hl.map((p, i) => [p, i]).filter(([p]) => p.k === Props.K.conifer && !p.down).slice(0, 100), c0 = Props.crushed;
    for (const [, i] of T) MP.onCrush({ t: 'crush', f: 4, r: 0, m: 0, g, ids: [i], d: [0] });
    const other = hl.findIndex((p, i) => p.k === Props.K.broadleaf && !p.down); MP.onCrush({ t: 'crush', f: 2, r: 0, m: 0, g, ids: [other], d: [0] });
    return { n: T.length, fell: Props.crushed - c0, other: !!hl[other].down }; })()`);
  t('...a flood from one player: 64 props a second believed, the rest dropped (another player\'s still heard)', flood.n === 100 && flood.fell === 65 && flood.other, flood);
  // a new battle (the room's epoch moves on) stands everything up, and a message from before it isn't believed after
  const epoch = G.run(B, `(() => { MP.onPhase = () => {}; const before = Props.crushed, s = JSON.parse(JSON.stringify(MP.state)); s.mode = 'pvp'; s.phase = 'battle'; s.round = 1; MP.applyState(s);
    const after = Props.crushed; MP.onCrush({ t: 'crush', f: 2, r: 0, m: 2, g: Props.areas().find((m) => m.id === 'isle').sig, ids: [__n], d: [0] });
    return { before, after, late: Props.crushed, epoch: MP.crushEpoch() }; })()`);
  t('a new battle stands every prop up again (and a crush from before it is not believed after)', epoch.before > 60 && epoch.after === 0 && epoch.late === 0 && epoch.epoch === 6, epoch);
}
// in a room a new flight (a respawn, or a sandbox flight) keeps what is down: the room's set rules (combat.js reset)
R(`var MP = { active: true }; var roomKeep = (() => { const p = __tree; p.down = 1; Props._S.fallen.push(p); Props._S.crushed++; Combat.reset(simOf()); const kept = !!p.down; MP = undefined; Combat.reset(simOf()); return kept && !p.down; })();`);
t('in a room a new flight keeps the props that are down (Combat.reset); out of it, they stand up again', !!tr && R('roomKeep'));
t.done();
