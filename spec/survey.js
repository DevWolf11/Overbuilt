const G = require('/home/user/Overbuilt/test/lib/game.js');
const ctx = G.load({});
const R = (c) => G.run(ctx, c);
R(`
var S = (e, z) => Terrain.surfaceAt(EARTH, siteAngle(EARTH, e), z);
var W = (e, z) => Terrain.waterAt(EARTH, siteAngle(EARTH, e), z);
var slope = (e, z, d) => { d = d || 4; const gx = (S(e + d, z) - S(e - d, z)) / (2 * d), gz = (S(e, z + d) - S(e, z - d)) / (2 * d); return Math.atan(Math.hypot(gx, gz)) * 180 / Math.PI; };
var rect = (e, z, hl, hw) => { let mx = 0, hmin = 1e9, hmax = -1e9, wet = 0; for (let u = -hl; u <= hl; u += 10) for (let v = -hw; v <= hw; v += 10) { const x = e + u, y = z + v; mx = Math.max(mx, slope(x, y)); const h = S(x, y); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); if (W(x, y)) wet++; } return { h: +S(e, z).toFixed(1), maxSlope: +mx.toFixed(1), relief: +(hmax - hmin).toFixed(1), wet }; };
var P = (e, z, up) => { const a = siteAngle(EARTH, e), ph = z / EARTH.radius, r = EARTH.radius + S(e, z) + up; return { x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) }; };
var los = (e1, z1, e2, z2, h1, h2) => { const o = P(e1, z1, h1), p = P(e2, z2, h2), d = Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z), n = Math.ceil(d / 5), L = {}; for (let i = 1; i < n; i++) { const k = i / n; Terrain.locate(EARTH, o.x + (p.x - o.x) * k, o.y + (p.y - o.y) * k, o.z + (p.z - o.z) * k, L); if (L.r < EARTH.radius + Math.max(0, Terrain.surfaceAt(EARTH, L.a, L.z)) + 0.3) return false; } return true; };
var wetIn = (e0, e1, z0, z1) => { let n = 0, t = 0, hmin = 1e9, hmax = -1e9, s5 = 0, s10 = 0; for (let e = e0; e <= e1; e += 50) for (let z = z0; z <= z1; z += 50) { t++; if (W(e, z)) n++; const h = S(e, z); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); const sl = slope(e, z); if (sl < 5) s5++; else if (sl < 10) s10++; } return { wet: n, of: t, hmin: +hmin.toFixed(0), hmax: +hmax.toFixed(0), under5: +(s5 / t).toFixed(2), f5to10: +(s10 / t).toFixed(2) }; };
`);
const pts = JSON.parse(process.argv[2] || '{"N":[17750,13800],"S":[17750,16200],"A":[17050,15000],"C":[17750,15000],"B":[18450,15000]}');
for (const [k, [e, z]] of Object.entries(pts)) console.log(k, e, z, JSON.stringify(R(`rect(${e}, ${z}, ${k.length === 1 && 'NS'.includes(k) ? 70 : 40}, ${k.length === 1 && 'NS'.includes(k) ? 40 : 40})`)));
const names = Object.keys(pts);
for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
  const [a, b] = [pts[names[i]], pts[names[j]]];
  console.log(names[i] + '-' + names[j], Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])), 'm', 'LOS', R(`los(${a[0]},${a[1]},${b[0]},${b[1]},2.4,1.6)`));
}
for (const [k, [e, z]] of Object.entries(pts)) {
  let vis = 0, n = 0;
  for (let a = 0; a < 24; a++) for (const r of [300, 600, 900, 1200]) { const x = e + Math.cos(a / 24 * 6.283) * r, y = z + Math.sin(a / 24 * 6.283) * r; if (R(`W(${x},${y})`)) continue; n++; if (R(`los(${e},${z},${x},${y},2.4,1.6)`)) vis++; }
  console.log(k, 'visible share 300-1200 m', (vis / n).toFixed(2));
}
console.log('box', JSON.stringify(R(`wetIn(16400, 19100, 13550, 16450)`)));
// airfield threshold
const f = { e: 18900, z: 12500, yaw: Math.PI / 3, hl: 1100 };
const c = Math.cos(f.yaw), s = -Math.sin(f.yaw);
console.log('scotland thresholds', [f.e + f.hl * c, f.z + f.hl * s].map(Math.round), [f.e - f.hl * c, f.z - f.hl * s].map(Math.round));
for (const [k, [e, z]] of Object.entries(pts)) { const de = e - f.e, dz = z - f.z, u = de * c + dz * s, v = -de * s + dz * c; console.log(k, 'airfield dist (outside strip)', Math.round(Math.hypot(Math.max(Math.abs(u) - f.hl, 0), Math.max(Math.abs(v) - 30, 0)))); }
