// Highland Ridge, the Ground Battle arena in North Scotland, measured on the real Earth map: each pad's and zone's
// ground height, steepest slope over ±70 × 40 m and water; the box's heights, slopes and water; every pair's line of
// sight (eye 2.4 m, target 1.6 m, 5 m steps, 0.3 m margin, over the curved Earth); the share of ground each sees at
// 300-1,200 m; the Scotland airfield's clearance. Once the arena has berms (Terrain.bermAt and EARTH.arenas), each
// berm's ground slope and dryness too, and a check that no berm opens a pad-to-pad or pad-to-zone line of sight.
// Last, drawn minus physics ground: the terrain patch render3d builds round a focus at each pad and zone (its own
// vertex grid, cell-size detail and float32 heights, on high and low), sampled bilinearly as meshHeight does, against
// Terrain.surfaceAt. With the arena's detail fade in (EARTH.arenas) it checks the RMS on high against BUDGET (out to
// 600 m), and that the fade leaves every airfield's strip and blend alone. Then the arena's own ground mesh (render3d's
// quadtree, built near an arena marked clear): on high and low, within 0.1 m RMS and 0.3 m of the physics in the box.
// With js/props.js the lines of sight count the props that block sight too (PROPS=0: the ground alone), and the design's
// pairs are checked: A-C and A-B seen, the pads' hidden.
// A Node tool, not in run.mjs (about 90 s, most of it the mesh check):   node test/tools/arena-probe.js
const G = require('../lib/game.js');
const ctx = G.load(), T = ctx.Terrain, EARTH = ctx.EARTH, R = EARTH.radius, D = 180 / Math.PI;
const A = (e) => ctx.siteAngle(EARTH, e), E = (a) => -ctx.wrapAngle(a - EARTH.padAngle) * R;
const S = (e, z) => T.surfaceAt(EARTH, A(e), z), W = (e, z) => T.waterAt(EARTH, A(e), z);
const faded = !!EARTH.arenas, bermy = faded && typeof T.bermAt === 'function';
let fails = 0;
const verdict = (ok, line) => { console.log((ok ? 'ok   ' : 'FAIL ') + line); if (!ok) fails++; };

// the arena (its positions are fixed: the pads face each other across the three zones)
const PTS = {
  N: { e: 17750, z: 13800, role: 'pad, team 0 (Faroes side)' },
  S: { e: 17750, z: 16200, role: 'pad, team 1 (Shetland side)' },
  A: { e: 17050, z: 15000, role: 'zone "Hilltop"' },
  C: { e: 17750, z: 15000, role: 'zone "Slope"' },
  B: { e: 18450, z: 15000, role: 'zone "East"' },
};
const BOX = { e0: 16400, e1: 19100, z0: 13550, z1: 16450 };
// the berms: the arena's own list once it has one, else the design's table (mirrored pairs about z 15,000, two on the line)
const BERMS0 = [[17350, 14300, 0], [17350, 15700, 0], [18150, 14300, 0], [18150, 15700, 0], [17750, 14550, 0], [17750, 15450, 0],
  [17000, 14780, Math.PI / 6], [17000, 15220, Math.PI / 6], [18500, 14780, -Math.PI / 6], [18500, 15220, -Math.PI / 6], [17420, 15000, Math.PI / 2], [18080, 15000, Math.PI / 2]];

const slope = (g, e, z, d = 4) => Math.atan(Math.hypot((g(e + d, z) - g(e - d, z)) / (2 * d), (g(e, z + d) - g(e, z - d)) / (2 * d))) * D;
const rect = (e, z, he, hz) => { // steepest slope (8 m baselines) and wet points on a 10 m grid
  let mx = 0, wet = 0;
  for (let u = -he; u <= he; u += 10) for (let v = -hz; v <= hz; v += 10) { mx = Math.max(mx, slope(S, e + u, z + v)); if (W(e + u, z + v)) wet++; }
  return { mx, wet };
};
// a point `up` metres over the ground at (e, z), in sim axes (z is latitude × R, as Terrain.locate has it)
const at = (g, e, z, up) => { const a = A(e), ph = z / R, r = R + g(e, z) + up; return { x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) }; };
const L = {};
// (and, once the arena has props (js/props.js), what blocks sight among them: buildings, walls, tree crowns, bushes,
// hedges; PROPS=0 leaves them out)
const props = ctx.Props && process.env.PROPS !== '0' ? ctx.Props : null;
function los(g, p, q, eye = 2.4, tgt = 1.6) { // a straight line through 3D space: the Earth's curve is in it
  const o = at(g, p.e, p.z, eye), t = at(g, q.e, q.z, tgt), n = Math.ceil(Math.hypot(t.x - o.x, t.y - o.y, t.z - o.z) / 5);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    T.locate(EARTH, o.x + (t.x - o.x) * k, o.y + (t.y - o.y) * k, o.z + (t.z - o.z) * k, L);
    if (L.r < R + g(E(L.a), L.z) + 0.3) return false;
  }
  return !props || props.clear(o, t);
}
const f1 = (x) => x.toFixed(1), pad = (s, n) => String(s).padEnd(n);

if (props) props.buildAll();
console.log(`Highland Ridge on the real Earth map. Detail fade (EARTH.arenas): ${faded ? 'in' : 'not yet'}; berms (Terrain.bermAt): ${bermy ? 'in' : 'not yet'}; props (js/props.js): ${props ? props.count('highland') && props.areas().find((m) => m.id === 'highland').props.length + ' of them, as sight blockers' : 'none'}.`);
console.log('\nitem  e       z       ground   max slope ±70×40 m  wet points  role');
for (const [k, p] of Object.entries(PTS)) {
  const r = rect(p.e, p.z, 70, 40);
  console.log(`${pad(k, 5)} ${pad(p.e, 7)} ${pad(p.z, 7)} ${pad(f1(S(p.e, p.z)) + ' m', 8)} ${pad(f1(r.mx) + '°', 19)} ${pad(r.wet, 11)} ${p.role}`);
}
{
  let n = 0, wet = 0, lo = 1e9, hi = -1e9, s5 = 0, s10 = 0, mx = 0;
  for (let e = BOX.e0; e <= BOX.e1; e += 50) for (let z = BOX.z0; z <= BOX.z1; z += 50) {
    n++; if (W(e, z)) wet++;
    const h = S(e, z), s = slope(S, e, z); lo = Math.min(lo, h); hi = Math.max(hi, h); mx = Math.max(mx, s);
    if (s < 5) s5++; else if (s < 10) s10++;
  }
  console.log(`box   e ${BOX.e0}-${BOX.e1}, z ${BOX.z0}-${BOX.z1}: ground ${Math.round(lo)}-${Math.round(hi)} m; ${Math.round(100 * s5 / n)}% under 5°, ${Math.round(100 * s10 / n)}% 5-10°, steepest ${f1(mx)}°; ${wet} of ${n} points (50 m grid) wet`);
}

console.log('\nlines of sight (eye 2.4 m, target 1.6 m)');
const names = Object.keys(PTS);
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  const p = PTS[names[i]], q = PTS[names[j]];
  console.log(`  ${names[i]}-${names[j]}  ${pad(Math.round(Math.hypot(p.e - q.e, p.z - q.z)) + ' m', 8)} ${los(S, p, q) ? 'SEEN' : 'hidden'}`);
}
{ // the arena as it was made: the hilltop sees the slope and the village, no pad sees the other or a zone (props only add cover)
  const seen = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) if (los(S, PTS[names[i]], PTS[names[j]])) seen.push(names[i] + '-' + names[j]);
  verdict(seen.join() === 'A-C,A-B', `lines of sight: ${seen.join(', ')} seen, every other pair hidden${props ? ' (with the props)' : ''}`);
}
console.log('share of dry ground seen at 300-1,200 m (24 bearings × 300, 600, 900, 1,200 m)');
for (const [k, p] of Object.entries(PTS)) {
  let seen = 0, n = 0;
  for (let b = 0; b < 24; b++) for (const r of [300, 600, 900, 1200]) {
    const q = { e: p.e + Math.cos((b / 24) * 2 * Math.PI) * r, z: p.z + Math.sin((b / 24) * 2 * Math.PI) * r };
    if (W(q.e, q.z)) continue;
    n++; if (los(S, p, q)) seen++;
  }
  console.log(`  ${k}  ${(seen / n).toFixed(2)} (${n} points)`);
}
{
  const f = EARTH.airfields.scotland, c = Math.cos(f.yaw), s = -Math.sin(f.yaw);
  console.log(`Scotland airfield (e ${f.e}, z ${f.z}): thresholds at (${Math.round(f.e + f.hl * c)}, ${Math.round(f.z + f.hl * s)}) and (${Math.round(f.e - f.hl * c)}, ${Math.round(f.z - f.hl * s)}); outside the strip by ` +
    names.map((k) => { const de = PTS[k].e - f.e, dz = PTS[k].z - f.z, u = de * c + dz * s, v = -de * s + dz * c; return `${k} ${Math.round(Math.hypot(Math.max(Math.abs(u) - f.hl, 0), Math.max(Math.abs(v) - f.hw, 0)))} m`; }).join(', ') + ` (its blend: ${f.blend} m)`);
}
if (faded && T.arenaW) { // the detail fade keeps off every airfield's ground (its strip and blend, 10 m grid): Wick's south end lies in it
  let n = 0, bad = 0;
  for (const f of Object.values(EARTH.airfields)) for (let e = f.e - f.hl - f.hw - f.blend; e <= f.e + f.hl + f.hw + f.blend; e += 10) for (let z = f.z - f.hl - f.hw - f.blend; z <= f.z + f.hl + f.hw + f.blend; z += 10) {
    const q = T.fieldAt(e, z);
    if (q.w > 0 && !q.f.pad && e > BOX.e0 - 200 && e < BOX.e1 + 200 && z > BOX.z0 - 200 && z < BOX.z1 + 200) { n++; if (T.arenaW(e, z) !== 0) bad++; }
  }
  verdict(!bad, `airfield ground in the box and its fade: ${n} points (10 m grid), ${bad} with detail faded (none may be: the airfields keep their ground)`);
}

if (bermy) {
  const H = EARTH.arenas.highland, list = (H && Array.isArray(H.berms) && H.berms.length ? H.berms : BERMS0).map((b) => (Array.isArray(b) ? { e: b[0], z: b[1], yaw: b[2] } : b));
  const bare = (e, z) => S(e, z) - T.bermAt(e, z); // the ground without its berms
  console.log(`\nberms (${list === BERMS0 ? "the design's table" :'EARTH.arenas.highland.berms'}) on their 26 × 14 m footprint: crest over the ground; the slope of the bare ground`
    + ' (a plane fitted through it: at most 8°) and its steepest 8 m stretch; water');
  for (const b of list) {
    const c = Math.cos(b.yaw || 0), s = -Math.sin(b.yaw || 0); // along the berm (u) is (c, s) in (e, z); across (v) is (-s, c)
    let su = 0, sv = 0, uu = 0, vv = 0, mx = 0, wet = 0;
    for (const u of [-13, -6.5, 0, 6.5, 13]) for (const v of [-7, 0, 7]) {
      const e = b.e + c * u - s * v, z = b.z + s * u + c * v, g = bare(e, z);
      su += u * g; sv += v * g; uu += u * u; vv += v * v; mx = Math.max(mx, slope(bare, e, z)); if (W(e, z)) wet++;
    }
    const fit = Math.atan(Math.hypot(su / uu, sv / vv)) * D;
    verdict(fit <= 8 && !wet, `berm at (${b.e}, ${b.z}) yaw ${f1((b.yaw || 0) * D)}°: crest ${T.bermAt(b.e, b.z).toFixed(2)} m, ground ${f1(fit)}° (steepest ${f1(mx)}°), ${wet ? `${wet} of 15 points wet` : 'dry'}`);
  }
  for (const i of ['N', 'S']) for (const j of names) {
    if (j === i || (i === 'S' && j === 'N')) continue;
    const before = los(bare, PTS[i], PTS[j]), after = los(S, PTS[i], PTS[j]);
    verdict(before || !after, `${i}-${j}: ${before ? 'seen' : 'hidden'} without the berms, ${after ? 'seen' : 'hidden'} with them`);
  }
}

// ---- drawn minus physics: render3d's patchJob, allocSlot, meshHeight, groundAt and fieldGround, rebuilt (test/lib/patch.js)
// The patch on show round a focus at ground level, read as meshHeight reads it, with the berms' own mesh and the sea
function patchAt(e0, z0, high) {
  const P = require('../lib/patch.js').patchAt(ctx, e0, z0, high);
  return { span: P.span, cell: P.cell, drawn: (e, z) => Math.max(P.drawn(e, z), 0) + (bermy ? T.bermAt(e, z) : 0) };
}
const RADII = [30, 100, 300, 600, 1000];
// The RMS allowed on high with the fade in, by distance: what render3d's 96 × 56 patch gives (its rows, along z, are
// coarser than its columns), with a margin; without the fade every focus is over it somewhere. (The design's 0.6 m out
// to 600 m was measured on a 96 × 96 patch; even that gives N 1.1 m at 600 m, toward Wick, where the fade keeps off.)
const BUDGET = { 30: 0.15, 100: 0.3, 300: 1.0, 600: 1.6 };
console.log(`\ndrawn minus physics ground, RMS / max (m) on 24 bearings at each distance from a focus${faded ? '' : ' (no detail fade yet: printed only)'}`);
for (const high of [true, false]) {
  console.log(`  ${high ? 'high (patch 96 × 56)' : 'low (patch 64 × 36)'}`.padEnd(26) + RADII.map((r) => `${r} m`.padStart(13)).join(''));
  for (const [k, p] of Object.entries(PTS)) {
    const P = patchAt(p.e, p.z, high), cols = [];
    for (const r of RADII) {
      let s2 = 0, mx = 0;
      for (let b = 0; b < 24; b++) {
        const e = p.e + Math.cos((b / 24) * 2 * Math.PI) * r, z = p.z + Math.sin((b / 24) * 2 * Math.PI) * r, d = P.drawn(e, z) - S(e, z);
        s2 += d * d; mx = Math.max(mx, Math.abs(d));
      }
      const rms = Math.sqrt(s2 / 24);
      cols.push(`${rms.toFixed(2)} / ${mx.toFixed(1)}`.padStart(13));
      if (faded && high && BUDGET[r] && !(rms < BUDGET[r])) verdict(false, `${k} high: drawn ground off by ${rms.toFixed(2)} m RMS at ${r} m (budget ${BUDGET[r]} m)`);
    }
    console.log(`  ${k} (span ${(P.span / 1000).toFixed(1)} km)`.padEnd(26) + cols.join(''));
  }
}
// ---- the arena's own ground mesh (render3d's quadtree, built near an arena marked clear) against the physics, in the box
let meshed = false;
{
  const fs = require('fs'), path = require('path'), vm = require('vm'), cr = G.load({ flight: true }); // (render3d.js reads Settings)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/render3d.js'), 'utf8') + '\nthis.Render3D = Render3D;', cr, { filename: 'render3d.js' });
  const R3 = cr.Render3D, H = cr.EARTH.arenas && cr.EARTH.arenas.highland;
  if (R3 && typeof R3.arenaGeo === 'function' && H && H.clear) {
    meshed = true;
    const Sr = (e, z) => cr.Terrain.surfaceAt(cr.EARTH, cr.siteAngle(cr.EARTH, e), z), B = H.box;
    console.log('\nthe arena ground mesh minus physics ground in the box (3.1 × 2.9 m grid): RMS < 0.1 m and max < 0.3 m everywhere');
    for (const high of [true, false]) {
      const t0 = Date.now(), g = R3.arenaGeo('highland', high), ms = Date.now() - t0;
      let s2 = 0, mx = 0, n = 0, off = 0, worst = '';
      for (let e = B.e0 + 0.3; e <= B.e1; e += 3.1) for (let z = B.z0 + 0.2; z <= B.z1; z += 2.9) {
        const h = R3.arenaGeoAt(g, cr.siteAngle(cr.EARTH, e), z);
        if (h == null) { off++; continue; }
        const d = h - Sr(e, z); s2 += d * d; n++;
        if (Math.abs(d) > mx) { mx = Math.abs(d); worst = `(${e.toFixed(0)}, ${z.toFixed(0)})`; }
      }
      const rms = Math.sqrt(s2 / Math.max(n, 1));
      verdict(rms < 0.1 && mx < 0.3 && !off, `${high ? 'high' : 'low '}: ${g.n} vertices, ${g.tri.length / 3} triangles (${ms} ms in Node): RMS ${rms.toFixed(3)} m, max ${mx.toFixed(3)} m at ${worst}${off ? `, ${off} points off the mesh` : ''}`);
    }
  }
}
if (faded) verdict(!fails, fails ? `arena probe: ${fails} problems` : `arena probe: berms dry and level, no line of sight opened, airfields untouched, drawn ground within budget on high (${Object.entries(BUDGET).map(([r, b]) => `${b} m at ${r} m`).join(', ')})${meshed ? ', the arena mesh within 0.1 m RMS and 0.3 m of the physics in the box' : ''}`);
if (fails) process.exitCode = 1;
