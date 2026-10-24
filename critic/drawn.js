// Drawn (patch, bilinear between power-law vertices) vs physics ground in the arena, as render3d builds it at ground level.
// The patch vertices are exact height() samples at their own cell size (so the 40 m / 160 m detail drops out where
// cells are coarse), approximated here with Terrain.heightAt at vertices for the faded case and a cell-aware h3d otherwise.
const G = require('/home/user/Overbuilt/test/lib/game.js');
const ctx = G.load({});
const R = (c) => G.run(ctx, c);
R(`
var span = 37000, PW = 2.2, n = 96;
var sx = []; for (let i = -n; i <= n; i++) { const u = i / n; sx.push(Math.sign(u) * Math.pow(Math.abs(u), PW) * span); }
var cellOf = (i) => Math.max(Math.abs(sx[Math.min(i + 1, sx.length - 1)] - sx[i]), Math.abs(sx[i] - sx[Math.max(i - 1, 0)]));
var c = Terrain.cfgOf(EARTH);
// a vertex height as the patch computes it: height() with this vertex's cell size (the LOD drops fine detail)
var Gv = Terrain.grid(1, 1, c.k.length);
var vh = (e, z, cell) => { Terrain.setCol(c, Gv, 0, siteAngle(EARTH, e), cell); Terrain.setRow(c, Gv, 0, z, cell); return Terrain.height(c, Gv, 0, 0, Terrain.contAt(c, siteAngle(EARTH, e), z / EARTH.radius)); };
var phys = (e, z) => Terrain.surfaceAt(EARTH, siteAngle(EARTH, e), z);
var bs = (a, v) => { let lo = 0, hi = a.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= v) lo = m; else hi = m - 1; } return lo; };
var drawn = (e0, z0, e, z) => { const s = e - e0, t = z - z0, i = bs(sx, s), j = bs(sx, t), tx = (s - sx[i]) / (sx[i + 1] - sx[i]), tz = (t - sx[j]) / (sx[j + 1] - sx[j]);
  const ce = Math.max(cellOf(i), cellOf(j)), h = (a, b) => vh(e0 + sx[a], z0 + sx[b], Math.max(cellOf(a), cellOf(b)));
  return (1 - tz) * ((1 - tx) * h(i, j) + tx * h(i + 1, j)) + tz * ((1 - tx) * h(i, j + 1) + tx * h(i + 1, j + 1)); };
`);
const focus = [[17750, 13800], [17750, 15000]];
for (const [e0, z0] of focus) for (const r of [30, 100, 300, 600, 1000, 1400]) {
  const d = R(`(() => { const out = []; for (let k = 0; k < 24; k++) { const a = k / 24 * 6.2832, e = ${e0} + Math.cos(a) * ${r}, z = ${z0} + Math.sin(a) * ${r}; out.push(drawn(${e0}, ${z0}, e, z) - phys(e, z)); } return out; })()`);
  const rms = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length), mx = Math.max(...d.map(Math.abs));
  console.log(`focus ${e0},${z0} r ${r} m: drawn-physics rms ${rms.toFixed(2)} max ${mx.toFixed(2)}`);
}
