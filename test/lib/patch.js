// render3d's terrain patch, rebuilt in Node for the tools (no GPU): patchJob's vertex grid round a focus at ground level
// (its rows and columns, cell-size detail, float32 heights, every airfield's paving kept under: fieldGround and
// fieldLayout), read as meshHeight reads it (bilinear) or as its triangles draw it (tri). The arena probe and the ground
// probe measure the ground drawn against the physics' with it.
//
//   const P = require('./patch.js').patchAt(ctx, e0, z0, high);   // P.drawn(e, z), P.tri(e, z), P.span, P.cell(r)
function lib(ctx) {
  if (ctx.__patchLib) return ctx.__patchLib;
  const T = ctx.Terrain, EARTH = ctx.EARTH, R = EARTH.radius, A = (e) => ctx.siteAngle(EARTH, e);
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
    const camAlt = T.surfaceAt(EARTH, a0, z0) + up, span = Math.min(R * 1.2, Math.sqrt(2 * R * camAlt + camAlt * camAlt) + Math.sqrt(2 * R * Math.max(c.hmax, 50)) + dist * 1.5);
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
    const cellAt = (e, z) => {
      const s = ctx.wrapAngle(A(e) - a0) * R * kl, t = z - z0, i = bs(sx, s), j = bs(sz, t);
      return { i, j, tx: (s - sx[i]) / (sx[i + 1] - sx[i]), tz: (t - sz[j]) / (sz[j + 1] - sz[j]) };
    };
    // meshHeight's reading (bilinear)
    const drawn = (e, z) => { const { i, j, tx, tz } = cellAt(e, z); return ctx.lerp(ctx.lerp(vert(i, j), vert(i + 1, j), tx), ctx.lerp(vert(i, j + 1), vert(i + 1, j + 1), tx), tz); };
    // what its triangles draw (the index splits each cell from its +a corner to its +z one)
    const tri = (e, z) => {
      const { i, j, tx, tz } = cellAt(e, z), h00 = vert(i, j), h10 = vert(i + 1, j), h01 = vert(i, j + 1), h11 = vert(i + 1, j + 1);
      return tx + tz <= 1 ? h00 + (h10 - h00) * tx + (h01 - h00) * tz : h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
    };
    return { span, drawn, tri, cell: (r) => cellOf(sx, bs(sx, r)) };
  }
  return (ctx.__patchLib = { patchAt, fieldGround, fieldLayout });
}
module.exports = { patchAt: (ctx, ...a) => lib(ctx).patchAt(...a), lib };
