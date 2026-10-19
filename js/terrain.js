'use strict';
// The 3D ground: the 2D terrain profile grown into a full surface, shared by the renderer and the physics.
// A point on a body is (a, z): a is the angle around the body in the sim's XY plane (as in 2D), z = latitude * R.

const Terrain = (() => {
const C = (hex) => hexToRgb(hex);
function hashI(x, y, s) {
  let h = Math.imul(s ^ 0x5bd1e995, 0x85ebca6b);
  h = Math.imul(h ^ x, 0xcc9e2d51); h = (h << 15) | (h >>> 17);
  h = Math.imul(h ^ y, 0x1b873593); h = (h << 13) | (h >>> 19);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// value noise in [0, 1]; px (py) > 0 makes it periodic in x (y): seamless around a planet, or tileable
function vnoise2(x, y, px, s, py = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  let x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
  if (px) { x0 = ((x0 % px) + px) % px; x1 = (x0 + 1) % px; }
  if (py) { y0 = ((y0 % py) + py) % py; y1 = (y0 + 1) % py; }
  const a = hashI(x0, y0, s), b = hashI(x1, y0, s), c = hashI(x0, y1, s), d = hashI(x1, y1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function vnoise3(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const s0 = s + Math.imul(iz, 0x27d4eb2f), s1 = s + Math.imul(iz + 1, 0x27d4eb2f);
  const a = lerp(lerp(hashI(ix, iy, s0), hashI(ix + 1, iy, s0), fx), lerp(hashI(ix, iy + 1, s0), hashI(ix + 1, iy + 1, s0), fx), fy);
  const b = lerp(lerp(hashI(ix, iy, s1), hashI(ix + 1, iy, s1), fx), lerp(hashI(ix, iy + 1, s1), hashI(ix + 1, iy + 1, s1), fx), fy);
  return a + (b - a) * fz;
}
function fbm3(x, y, z, oct, s) {
  let v = 0, a = 0.5;
  for (let i = 0; i < oct; i++) { v += a * (vnoise3(x, y, z, s + i * 131) * 2 - 1); x *= 2.03; y *= 2.03; z *= 2.03; a *= 0.5; }
  return v;
}

// ------------------------------------------------------------------ terrain: the 2D profile grown into 3D
// Along the track (where craft drive and land, |z| <= trackHalf) the ground is exactly terrainHeight. Away
// from it, each octave of the 1D profile carries on at its own angle, the profile's craters become round
// bowls, and noise adds continents, more craters and detail. Short wavelengths fade out where the grid is
// too coarse to hold them, so rebuilding the grid never makes the far terrain pop.
const DIRS = [0.62, -0.85, 1.4, -0.42, 1.05, -1.7, 0.3, -1.2];
const LOOK = {
  mercury: { kind: 'rock', cont: 280, det: [6, 2], cr: [[1 / 10, 0.5, 0.2], [1600, 0.45, 0.28], [300, 0.35, 0.34]], relief: 5 },
  venus: { kind: 'venus', cont: 320, det: [5, 1.5], relief: 3 },
  earth: { kind: 'earth', cont: 420, bias: -90, det: [4, 1.2], relief: 3 },
  moon: { kind: 'rock', cont: 320, det: [6, 2], cr: [[1 / 10, 0.45, 0.2], [1600, 0.42, 0.28], [300, 0.32, 0.34]], relief: 5 },
  mars: { kind: 'mars', cont: 520, det: [7, 2], cr: [[1 / 14, 0.3, 0.18], [2000, 0.25, 0.25], [400, 0.2, 0.3]], relief: 4 },
  phobos: { kind: 'rock', cont: 120, det: [4, 1.5], cr: [[1 / 5, 0.5, 0.22], [400, 0.45, 0.3], [90, 0.35, 0.34]], relief: 4 },
  jupiter: { kind: 'jupiter', cont: 30, det: [2, 0], relief: 1 },
  europa: { kind: 'europa', cont: 80, det: [3, 1], cr: [[900, 0.08, 0.2]], relief: 3 },
};
// Earth: built-up ground around the space centre, runway and causeway (metres east of the pad, z)
const APRONS = [{ e0: 820, e1: 1330, z0: -165, z1: -18, bl: 170 }];
function trackHalf(e) {
  let h = 25;
  h = lerp(h, 260, 1 - smoothstep(300, 520, Math.abs(e)));
  h = lerp(h, 45, 1 - smoothstep(1100, 1250, Math.abs(e - 1700)));
  return lerp(h, 14, 1 - smoothstep(4700, 5000, Math.abs(e - 8000)));
}
function trackBlend(e) {
  let b = 150;
  b = lerp(b, 330, 1 - smoothstep(300, 520, Math.abs(e)));
  return lerp(b, 230, 1 - smoothstep(1100, 1250, Math.abs(e - 1700)));
}

const cfgs = new Map();
function cfgOf(b) {
  let c = cfgs.get(b);
  if (c) return c;
  const L = LOOK[b.id] || {}, R = b.radius, circ = TAU * R;
  const per = (cell) => { const n = Math.max(4, Math.round(circ / cell)); return [circ / n, n]; };
  let seed = 7;
  for (const ch of b.id) seed = Math.imul(seed ^ ch.charCodeAt(0), 0x01000193);
  c = {
    b, R, kind: L.kind || 'rock', seed, base: b.terrainBase || 0, k: [], amp: [], ph: [], kc: [],
    ck: b.craters ? b.craters[0] : 0, cd: b.craters ? b.craters[1] : 0,
    cont: L.cont || 0, bias: L.bias || 0, cf: 7, c0: 1200, c1: Math.max(8000, R * 0.08),
    det: L.det ? [[...per(160), L.det[0]], [...per(40), L.det[1]]].filter((d) => d[2] > 0) : [],
    cr: (L.cr || []).map(([cell, p, df]) => [...per(cell < 1 ? cell * R : cell), p, df]),
    relief: L.relief || 3,
    pal: {
      ground: C(b.colors.ground || '#777777'), surface: C(b.colors.surface || '#999999'), deep: C(b.colors.deep || '#555555'),
      rock: C(b.colors.rock || b.colors.deep || '#666666'), map: C(b.colors.map || '#888888'),
    },
  };
  b.terrain.forEach(([k, amp, ph], i) => { c.k.push(k); c.amp.push(amp); c.ph.push(ph); c.kc.push(k * DIRS[i % DIRS.length]); });
  c.hmax = b.terrainMax + c.cont * 0.6 + 50;
  c.G1 = grid(1, 1, c.k.length);
  cfgs.set(b, c);
  return c;
}

// Column (angle) and row (depth) caches: the expensive trigonometry is done once per column or row.
function grid(nc, nr, no) {
  const F = (n) => new Float64Array(Math.max(1, n));
  return {
    nc, nr, ang: F(nc), al: F(nc), th: F(nc), half: F(nc), bl: F(nc), ea: F(nc), ch: F(nc), dx: F(nc), cs: F(nc * no), cc: F(nc * no),
    z: F(nr), phi: F(nr), dz: F(nr), rs: F(nr * no), rc: F(nr * no),
  };
}
function setCol(c, G, i, a, dx) {
  const no = c.k.length, R = c.R;
  G.ang[i] = a; G.dx[i] = dx;
  let al = (a % TAU) * R;
  if (al < 0) al += TAU * R;
  G.al[i] = al;
  G.th[i] = terrainHeight(c.b, a);
  for (let o = 0; o < no; o++) { const q = c.k[o] * a + c.ph[o]; G.cs[i * no + o] = Math.sin(q); G.cc[i * no + o] = Math.cos(q); }
  if (c.ck) { const u = c.ck * a + 0.7 - Math.PI / 2; G.ch[i] = u - Math.PI * Math.round(u / Math.PI); }
  if (c.b === EARTH) {
    const e = -wrapAngle(a - EARTH.padAngle) * R;
    G.ea[i] = e; G.half[i] = trackHalf(e); G.bl[i] = trackBlend(e);
  } else { G.ea[i] = 1e9; G.half[i] = 25; G.bl[i] = 150; }
}
function setRow(c, G, j, z, dz) {
  const no = c.k.length, phi = z / c.R;
  G.z[j] = z; G.phi[j] = phi; G.dz[j] = dz;
  for (let o = 0; o < no; o++) { const q = c.kc[o] * phi; G.rs[j * no + o] = Math.sin(q); G.rc[j * no + o] = Math.cos(q); }
}
function contAt(c, a, phi) {
  if (!c.cont) return 0;
  const cp = Math.cos(phi), f = c.cf;
  return c.cont * fbm3(cp * Math.cos(a) * f + 11.3, cp * Math.sin(a) * f - 4.1, Math.sin(phi) * f + 2.7, 4, c.seed) + c.bias;
}
let crDark = 0; // side result of the last height evaluation: how deep inside a crater (for colour)
function craters(c, al, z, cell) {
  let h = 0;
  for (const [cs, n, p, df] of c.cr) {
    const fx = al / cs, fz = z / cs, ix = Math.floor(fx) % n, iz = Math.floor(fz);
    if (hashI(ix, iz, c.seed + 11) > p) continue;
    const rad = 0.08 + 0.16 * hashI(ix, iz, c.seed + 12), cz = iz + 0.25 + 0.5 * hashI(ix, iz, c.seed + 13);
    if (Math.abs(cz) < rad + 300 / cs) continue; // keep the track clear
    const w = 1 - smoothstep(0.5, 1.2, cell / (rad * cs));
    if (w <= 0) continue;
    const dx = fx - Math.floor(fx) - 0.25 - 0.5 * hashI(ix, iz, c.seed + 14), dz = fz - cz, r2 = (dx * dx + dz * dz) / (rad * rad);
    if (r2 >= 1) continue;
    const r = Math.sqrt(r2), q = 1 - r2;
    let v = -q * q;
    if (r > 0.72) { const s = Math.sin((Math.PI * (r - 0.72)) / 0.28); v += 0.25 * s * s; }
    h += df * rad * cs * v * w;
    crDark = Math.max(crDark, w * (r < 0.85 ? 0.75 * q : -0.5 * v));
  }
  return h;
}
function natural(c, G, i, j, cont) {
  const no = c.k.length, z = G.z[j], az = Math.abs(z), cell = Math.max(G.dx[i], G.dz[j]);
  let h = c.base;
  for (let o = 0, ci = i * no, rj = j * no; o < no; o++) h += c.amp[o] * (G.cs[ci + o] * G.rc[rj + o] + G.cc[ci + o] * G.rs[rj + o]);
  crDark = 0;
  if (c.ck) {
    const kp = c.ck * G.phi[j], d2 = G.ch[i] * G.ch[i] + kp * kp;
    if (d2 < 2.4674) { const q = Math.cos(Math.sqrt(d2)), q3 = q * q * q; h -= c.cd * q3 * q3; crDark = q3 * 0.6; }
  }
  if (c.cr.length && az > 100) h += craters(c, G.al[i], z, cell);
  const wd = smoothstep(30, 400, az);
  if (wd > 0) for (const [cs, n, amp] of c.det) {
    const wb = 1 - smoothstep(0.3 * cs, 0.6 * cs, cell);
    if (wb > 0) h += amp * wd * wb * (vnoise2(G.al[i] / cs, z / cs, n, c.seed) * 2 - 1);
  }
  return h + cont * smoothstep(c.c0, c.c1, az);
}
function apronW(e, z) {
  let B = 0;
  for (const a of APRONS) {
    const dx = Math.max(a.e0 - e, 0, e - a.e1), dz = Math.max(a.z0 - z, 0, z - a.z1);
    B = Math.max(B, 1 - smoothstep(0, a.bl, Math.hypot(dx, dz)));
  }
  return B;
}
function builtW(c, G, i, j) {
  const z = G.z[j];
  let B = 1 - smoothstep(G.half[i], G.half[i] + G.bl[i], Math.abs(z));
  if (c.b === EARTH && B < 1 && G.ea[i] > 0 && G.ea[i] < 2000) B = Math.max(B, apronW(G.ea[i], z));
  return B;
}
function height(c, G, i, j, cont) {
  const B = builtW(c, G, i, j);
  if (B >= 1) { crDark = 0; return G.th[i]; }
  const hn = natural(c, G, i, j, cont);
  return B > 0 ? lerp(hn, G.th[i], B) : hn;
}
// Exact 3D terrain at one point (slow path: camera clamp away from the patch).
function h3dAt(c, a, z) {
  setCol(c, c.G1, 0, a, 0); setRow(c, c.G1, 0, z, 0);
  return height(c, c.G1, 0, 0, contAt(c, a, z / c.R));
}
// ------------------------------------------------------------------ physics API
// Heights are cached on a 2 m lattice and interpolated; on the track (where craft drive, land and launch)
// the ground is exactly the 2D profile, so the pad, runway and road keep their crisp edges.
const GS = 2, hc = new Map();
let hcBody = null;
function cell(c, n, ia, iz) {
  ia = ((ia % n) + n) % n;
  const k = iz * n + ia;
  let h = hc.get(k);
  if (h === undefined) { h = h3dAt(c, (ia * TAU) / n, iz * GS); hc.set(k, h); }
  return h;
}
function heightAt(b, a, z) {
  const c = cfgOf(b), R = c.R;
  const half = b === EARTH ? trackHalf(-wrapAngle(a - EARTH.padAngle) * R) : 25;
  if (Math.abs(z) <= half) return terrainHeight(b, a);
  if (hcBody !== b || hc.size > 80000) { hc.clear(); hcBody = b; }
  const n = Math.max(8, Math.round((TAU * R) / GS));
  let fa = ((a % TAU) / TAU) * n;
  if (fa < 0) fa += n;
  const fz = z / GS, ia = Math.floor(fa), iz = Math.floor(fz), tx = fa - ia, tz = fz - iz;
  const h0 = lerp(cell(c, n, ia, iz), cell(c, n, ia + 1, iz), tx), h1 = lerp(cell(c, n, ia, iz + 1), cell(c, n, ia + 1, iz + 1), tx);
  return lerp(h0, h1, tz);
}
function surfaceAt(b, a, z) { const h = heightAt(b, a, z); return b.ocean && h < 0 ? 0 : h; }
function waterAt3(b, a, z) { return !!b.ocean && heightAt(b, a, z) < 0; }
// Where a body-relative point sits: angle, depth along the surface, distance from the centre.
function locate(b, rx, ry, rz, o = {}) {
  const r = Math.hypot(rx, ry, rz) || 1;
  o.a = Math.atan2(ry, rx); o.lat = Math.asin(clamp(rz / r, -1, 1)); o.z = o.lat * b.radius; o.r = r;
  return o;
}
// Outward ground normal (sim axes) at (a, z), from the slopes east and north.
function normalAt(b, a, z, o = v3()) {
  const R = b.radius, lat = z / R, cl = Math.max(0.05, Math.cos(lat)), sl = Math.sin(lat), ca = Math.cos(a), sa = Math.sin(a), d = 1.5;
  const da = d / (R * cl);
  const se = (surfaceAt(b, a - da, z) - surfaceAt(b, a + da, z)) / (2 * d); // east is towards decreasing a
  const sn = (surfaceAt(b, a, z + d) - surfaceAt(b, a, z - d)) / (2 * d);
  o.x = cl * ca - se * sa + sn * ca * sl;
  o.y = cl * sa + se * ca + sn * sa * sl;
  o.z = sl - sn * cl;
  return norm3(o);
}

return {
  hashI, vnoise2, vnoise3, fbm3, cfgOf, grid, setCol, setRow, contAt, height, h3dAt, trackHalf, trackBlend, apronW,
  dark: () => crDark, heightAt, surfaceAt, waterAt: waterAt3, locate, normalAt,
};
})();
