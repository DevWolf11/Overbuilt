// Highland Ridge, the Ground Battle arena in North Scotland, measured on the real Earth map: each pad's and zone's
// ground height, steepest slope over ±70 × 40 m and water; the box's heights, slopes and water; every pair's line of
// sight (eye 2.4 m, target 1.6 m, 5 m steps, 0.3 m margin, over the curved Earth); the share of ground each sees at
// 300-1,200 m; the Scotland airfield's clearance. Once the arena has berms (Terrain.bermAt and EARTH.arenas), each
// berm's ground slope and dryness too, and a check that no berm opens a pad-to-pad or pad-to-zone line of sight.
// Last, drawn minus physics ground: the terrain patch render3d builds round a focus at each pad and zone (its own
// vertex grid, cell-size detail and float32 heights, on high and low), sampled bilinearly as meshHeight does, against
// Terrain.surfaceAt. With the arena's detail fade in (EARTH.arenas) it checks an RMS under 0.6 m out to 600 m on high.
// A Node tool, not in run.mjs (about 5 s):   node test/tools/arena-probe.js
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
function los(g, p, q, eye = 2.4, tgt = 1.6) { // a straight line through 3D space: the Earth's curve is in it
  const o = at(g, p.e, p.z, eye), t = at(g, q.e, q.z, tgt), n = Math.ceil(Math.hypot(t.x - o.x, t.y - o.y, t.z - o.z) / 5);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    T.locate(EARTH, o.x + (t.x - o.x) * k, o.y + (t.y - o.y) * k, o.z + (t.z - o.z) * k, L);
    if (L.r < R + g(E(L.a), L.z) + 0.3) return false;
  }
  return true;
}
const f1 = (x) => x.toFixed(1), pad = (s, n) => String(s).padEnd(n);

console.log(`Highland Ridge on the real Earth map. Detail fade (EARTH.arenas): ${faded ? 'in' : 'not yet'}; berms (Terrain.bermAt): ${bermy ? 'in' : 'not yet'}.`);
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

// ---- drawn minus physics: render3d's patchJob, allocSlot, meshHeight, groundAt and fieldGround, rebuilt
const c = T.cfgOf(EARTH), LAY = new Map();
const siteE = (f, u, v) => f.e + u * f.c - v * f.s, siteZ = (f, u, v) => f.z + u * f.s + v * f.c;
function fieldLayout(f) { // render3d's: the airfield's apron and taxiways, on its flatter side
  let Lf = LAY.get(f);
  if (Lf) return Lf;
  const hAt = (u, v) => T.heightAt(EARTH, A(siteE(f, u, v)), siteZ(f, u, v));
  let sg = 1, best = Infinity;
  for (const s of [1, -1]) {
    let cost = 0;
    for (let u = -220; u <= 120; u += 40) for (let v = 60; v <= 200; v += 35) { const h = hAt(u, s * v); cost += Math.abs(h - f.h) + (h < 2 ? 60 : 0); }
    if (cost < best) { best = cost; sg = s; }
  }
  const uA0 = -215, uA1 = 95, vA0 = 70, vA1 = 150, taxis = [uA0 + 24, uA1 - 24], out = (a, b) => (sg > 0 ? [a, b] : [-b, -a]);
  LAY.set(f, (Lf = { pads: [[uA0, uA1, ...out(vA0, vA1)], ...taxis.map((uc) => [uc - 10, uc + 10, ...out(22.5, vA0)])] }));
  return Lf;
}
function fieldGround(q, e, z, cell, h) {
  if (q.f.pad) return h; // (a ground pad: level, no runway to keep clear)
  const f = q.f, de = e - f.e, dz = z - f.z, u = de * f.c + dz * f.s, v = -de * f.s + dz * f.c, reach = cell * 1.5 + 2;
  if (Math.hypot(Math.max(Math.abs(u) - f.hl, 0), Math.max(Math.abs(v) - 22.5, 0)) < reach) h = Math.min(h, f.h);
  for (const [u0, u1, v0, v1] of fieldLayout(f).pads) {
    if (Math.hypot(Math.max(u0 - u, 0, u - u1), Math.max(v0 - v, 0, v - v1)) < reach) return h - (1 - q.w) * (1.2 * ctx.smoothstep(12, 24, cell) + 4 * ctx.smoothstep(48, 96, cell));
  }
  return h;
}
const bs = (a, v) => { let lo = 0, hi = a.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= v) lo = m; else hi = m - 1; } return lo; };
const cellOf = (a, i) => (a[Math.min(i + 1, a.length - 1)] - a[Math.max(i - 1, 0)]) / 2;
// The patch on show round a focus at ground level: the camera `up` m over the ground and `dist` m from the craft
// (updatePatch's span); its vertex heights worked out only where a sample needs them.
function patchAt(e0, z0, high, up = 3, dist = 12) {
  const n = high ? 96 : 64, m = high ? 56 : 36, nc = 2 * n + 1, nr = 2 * m + 1, PW = 2.2, a0 = A(e0), kl = Math.max(0.2, Math.cos(z0 / R));
  const camAlt = S(e0, z0) + up, span = Math.min(R * 1.2, Math.sqrt(2 * R * camAlt + camAlt * camAlt) + Math.sqrt(2 * R * Math.max(c.hmax, 50)) + dist * 1.5);
  const sx = new Float64Array(nc), sz = new Float64Array(nr), Gp = T.grid(nc, nr, c.k.length), hs = new Map(), FQP = { w: 0, h: 0, f: null };
  for (let i = 0; i < nc; i++) { const u = (i - n) / n; sx[i] = Math.sign(u) * Math.pow(Math.abs(u), PW) * span; }
  for (let j = 0; j < nr; j++) { const u = (j - m) / m; sz[j] = Math.sign(u) * Math.pow(Math.abs(u), PW) * span; }
  for (let i = 0; i < nc; i++) T.setCol(c, Gp, i, a0 + sx[i] / (R * kl), cellOf(sx, i));
  for (let j = 0; j < nr; j++) T.setRow(c, Gp, j, z0 + sz[j], cellOf(sz, j));
  const vert = (i, j) => { // a vertex as patchJob makes it: continent (float32, every vertex on the map), height, airfield
    const k = j * nc + i;
    let h = hs.get(k);
    if (h === undefined) {
      h = Math.fround(T.height(c, Gp, i, j, Math.fround(T.contAt(c, Gp.ang[i], Gp.phi[j])), true));
      if (T.fieldAt(Gp.ea[i], Gp.z[j], FQP).w > 0) h = Math.fround(fieldGround(FQP, Gp.ea[i], Gp.z[j], Math.max(Gp.dx[i], Gp.dz[j]), h));
      hs.set(k, h);
    }
    return h;
  };
  const drawn = (e, z) => { // meshHeight (+ the berms' own mesh), then groundAt's sea level
    const s = ctx.wrapAngle(A(e) - a0) * R * kl, t = z - z0, i = bs(sx, s), j = bs(sz, t), tx = (s - sx[i]) / (sx[i + 1] - sx[i]), tz = (t - sz[j]) / (sz[j + 1] - sz[j]);
    const hm = ctx.lerp(ctx.lerp(vert(i, j), vert(i + 1, j), tx), ctx.lerp(vert(i, j + 1), vert(i + 1, j + 1), tx), tz);
    return Math.max(hm, 0) + (bermy ? T.bermAt(e, z) : 0);
  };
  return { span, drawn, cell: (r) => cellOf(sx, bs(sx, r)) };
}
const RADII = [30, 100, 300, 600, 1000];
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
      if (faded && high && r <= 600 && !(rms < 0.6)) verdict(false, `${k} high: drawn ground off by ${rms.toFixed(2)} m RMS at ${r} m (budget 0.6 m)`);
    }
    console.log(`  ${k} (span ${(P.span / 1000).toFixed(1)} km)`.padEnd(26) + cols.join(''));
  }
}
if (faded) verdict(!fails, fails ? `arena probe: ${fails} problems` : 'arena probe: berms dry and level, no line of sight opened, drawn ground within 0.6 m RMS out to 600 m on high');
if (fails) process.exitCode = 1;
