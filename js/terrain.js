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
  const cw = EARTH.causeway, half = (cw.to - cw.from) / 2;
  return lerp(h, 14, 1 - smoothstep(half, half + 300, Math.abs(e - (cw.from + cw.to) / 2)));
}
function trackBlend(e) {
  let b = 150;
  b = lerp(b, 330, 1 - smoothstep(300, 520, Math.abs(e)));
  return lerp(b, 230, 1 - smoothstep(1100, 1250, Math.abs(e - 1700)));
}

// ------------------------------------------------------------------ the real Earth
// Heights and colours baked from Natural Earth and NASA's Blue Marble (tools/bake-earth.py), at the game's
// 1/20 scale. The space centre's runway is filled out into the real islands; elsewhere the 2D profile's
// shorter waves only add hills to high ground.
const EM = {
  state: 'none', promise: null,
  W: 0, H: 0, h: null,                   // heights (bytes, decoded through HLUT)
  CW: 0, CH: 0, rgb: null,               // Blue Marble colour
  FW: 0, FH: 0, night: null, lakeC: null, lakeL: null, urban: null, // city lights, lakes, built-up land
  RW: 0, RH: 0, country: null, sea: null, regions: [], nCountries: 0,
  cities: [], lines: null,
};
const ISLE = { e: 1500, a: 2000, b: 650, h: 44 }; // land under the pad and runway: centre (m east), half-axes, height
const DEG = 180 / Math.PI;

// ---- where the game sits on the real Earth
// The game keeps its pad on its own equator, where orbits and the 2D profile stay simple, and turns the real
// globe to fit: the pad lands on the west coast of the Faroe Islands and the game's east (decreasing angle)
// heads ESE over the islands and out to sea, reaching Shetland 18 km on. Game north (-z) points 29° east of
// real north at the pad. An orbit along the game's equator is inclined 62° to the real one.
const SITE = { lat: 62.16, lon: -7.33, head: 119 }; // degrees; head: the bearing of the game's east at the pad
// real = GM · v, with v the point in the pad's frame: x up at the pad, y the game's east there, z game north
const GM = (() => {
  const f = SITE.lat / DEG, l = SITE.lon / DEG, t = (90 - SITE.head) / DEG;
  const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const Rz = [[Math.cos(l), -Math.sin(l), 0], [Math.sin(l), Math.cos(l), 0], [0, 0, 1]];
  const Ry = [[Math.cos(f), 0, -Math.sin(f)], [0, 1, 0], [Math.sin(f), 0, Math.cos(f)]];
  const Rx = [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
  return Float64Array.from(mul(Rz, mul(Ry, Rx)).flat());
})();
// The real longitude and latitude (radians) of a point given as sim angle and latitude (phi = z / R): the
// result is left in GEO, so the hot paths make no garbage. The last point is remembered (callers often ask twice).
const GEO = { lon: 0, lat: 0, a: NaN, phi: NaN };
function toGeo(a, phi) {
  if (a === GEO.a && phi === GEO.phi) return GEO;
  const d = a - EARTH.padAngle, cp = Math.cos(phi), x = cp * Math.cos(d), y = -cp * Math.sin(d), z = -Math.sin(phi), M = GM;
  GEO.lon = Math.atan2(M[3] * x + M[4] * y + M[5] * z, M[0] * x + M[1] * y + M[2] * z);
  GEO.lat = Math.asin(clamp(M[6] * x + M[7] * y + M[8] * z, -1, 1));
  GEO.a = a; GEO.phi = phi;
  return GEO;
}
// ... and back: real longitude and latitude (radians) to sim angle and latitude
function toSim(lon, lat, o = {}) {
  const cl = Math.cos(lat), X = cl * Math.cos(lon), Y = cl * Math.sin(lon), Z = Math.sin(lat), M = GM;
  const x = M[0] * X + M[3] * Y + M[6] * Z, y = M[1] * X + M[4] * Y + M[7] * Z, z = M[2] * X + M[5] * Y + M[8] * Z;
  o.a = EARTH.padAngle + Math.atan2(-y, x); o.phi = -Math.asin(clamp(z, -1, 1));
  return o;
}
// The Faroes and Shetland (lat0, lat1, lon0, lon1, degrees): treeless, and ringed with sea cliffs where the
// map's coarse coast would only make a gentle beach. cliffW is 1 inside, fading out over 0.2-0.3°.
const CLIFFS = [[61.25, 62.5, -7.9, -6.0], [59.8, 60.95, -1.9, -0.7]];
function cliffW(lon, lat) {
  let w = 0;
  for (const [la0, la1, lo0, lo1] of CLIFFS) {
    if (lat < la0 - 0.2 || lat > la1 + 0.2 || lon < lo0 - 0.3 || lon > lo1 + 0.3) continue;
    w = Math.max(w, Math.min(smoothstep(la0 - 0.2, la0, lat), 1 - smoothstep(la1, la1 + 0.2, lat), smoothstep(lo0 - 0.3, lo0, lon), 1 - smoothstep(lo1, lo1 + 0.3, lon)));
  }
  return w;
}
// Low land jumps up from the sea (about 45° on the map's 240 m cells) and settles back by 80 m. Where the
// causeway comes ashore on Shetland there is a harbour instead (e, z: metres along and across the track).
function cliffs(h, w, e, z) {
  if (w <= 0 || h < -3) return h;
  w *= smoothstep(300, 900, Math.hypot(e - EARTH.causeway.shore, z));
  return h + 26 * w * smoothstep(-3, 5, h) * (1 - smoothstep(25, 80, h));
}
const cliffAt = (a, z) => { const g = toGeo(a, z / EARTH.radius); return cliffW(g.lon * DEG, g.lat * DEG); };
const treelessAt = (a, z) => cliffAt(a, z) > 0.4;
// Real compass bearing (degrees) of a direction given in the sim's local east (-a) and north (-z) at (a, phi).
function bearingAt(a, phi, east, north) {
  const g = toGeo(a, phi), lon = g.lon, lat = g.lat, d = 1e-5;
  const n = toGeo(a, phi - d), dl = wrapAngle(n.lon - lon) * Math.cos(lat), dp = n.lat - lat; // game north, seen on the real map
  const rot = Math.atan2(dl, dp); // game north's real bearing
  toGeo(a, phi);
  return ((((Math.atan2(east, north) + rot) * DEG) % 360) + 360) % 360;
}
const HLUT = new Float32Array(256);
for (let v = 0; v < 256; v++) { const u = v - 128; HLUT[v] = v >= 128 ? 0.5 * u + 0.09 * u * u : -(0.5 + 0.5 * (127 - v) + 0.052 * (127 - v) ** 2); }

// d: { height, color, night, lakes, urban, regions: {data, w, h, step}, places: json, lines: ArrayBuffer }
// (only height and color are required)
function setEarthData(d) {
  const chan = (im, k = 0) => { const n = im.w * im.h, o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = im.data[i * im.step + k]; return o; };
  Object.assign(EM, { W: d.height.w, H: d.height.h, h: chan(d.height), CW: d.color.w, CH: d.color.h });
  EM.rgb = new Uint8Array(EM.CW * EM.CH * 3);
  for (let i = 0, n = EM.CW * EM.CH, s = d.color.step; i < n; i++) { EM.rgb[i * 3] = d.color.data[i * s]; EM.rgb[i * 3 + 1] = d.color.data[i * s + 1]; EM.rgb[i * 3 + 2] = d.color.data[i * s + 2]; }
  const f = d.lakes || d.urban || d.night;
  if (f) { EM.FW = f.w; EM.FH = f.h; }
  if (d.night) EM.night = chan(d.night);
  if (d.urban) EM.urban = chan(d.urban);
  if (d.lakes) {
    EM.lakeC = chan(d.lakes, 0);
    const g = chan(d.lakes, 1), b = chan(d.lakes, 2);
    EM.lakeL = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) EM.lakeL[i] = (g[i] * 256 + b[i]) / 20 - 1000;
  }
  if (d.regions) {
    const r = chan(d.regions, 0), g = chan(d.regions, 1);
    EM.RW = d.regions.w; EM.RH = d.regions.h; EM.sea = chan(d.regions, 2);
    EM.country = new Uint16Array(r.length);
    for (let i = 0; i < r.length; i++) EM.country[i] = r[i] * 256 + g[i];
  }
  if (d.places) { EM.regions = d.places.regions; EM.nCountries = d.places.nCountries; EM.cities = d.places.cities; indexCities(); }
  if (d.lines) indexLines(d.lines);
  EM.state = 'ready';
  cfgs.delete(EARTH); hc.clear(); hwc.clear(); hcBody = null; rawA.fill(NaN);
  EARTH.terrainMax = 1700;
  EARTH.mapped = true;
}
function loadEarth(urls) {
  if (EM.promise) return EM.promise;
  EM.state = 'loading';
  // decode without colour management, so the bytes come back exactly as stored
  const bitmap = (src) => fetch(src).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
    .then((bl) => createImageBitmap(bl, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }));
  const image = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  const pixels = (im) => {
    const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    return { data: g.getImageData(0, 0, im.width, im.height).data, w: im.width, h: im.height, step: 4 };
  };
  const img = (src) => (typeof createImageBitmap === 'function' ? bitmap(src).catch(() => image(src)) : image(src)).then(pixels);
  const opt = (p) => p.catch((e) => { console.warn('Earth map: a layer is missing', e); return null; });
  EM.promise = Promise.all([img(urls.height), img(urls.color), opt(img(urls.night)), opt(img(urls.lakes)), opt(img(urls.urban)), opt(img(urls.regions)),
    opt(fetch(urls.places).then((r) => r.json())), opt(fetch(urls.lines).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }))])
    .then(([height, color, night, lakes, urban, regions, places, lines]) => setEarthData({ height, color, night, lakes, urban, regions, places, lines }))
    .catch((e) => { EM.state = 'failed'; console.warn('Earth map unavailable; using generated terrain', e); });
  return EM.promise;
}
// bilinear sample of a w x h raster (equirectangular) at lon, lat (radians)
function samp(arr, w, h, lon, lat) {
  let x = (lon / TAU + 0.5) * w - 0.5;
  x -= Math.floor(x / w) * w;
  const y = clamp((0.5 - lat / Math.PI) * h - 0.5, 0, h - 1.0001);
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, x1 = ix + 1 === w ? 0 : ix + 1, r0 = iy * w, r1 = r0 + w;
  return (arr[r0 + ix] * (1 - fx) + arr[r0 + x1] * fx) * (1 - fy) + (arr[r1 + ix] * (1 - fx) + arr[r1 + x1] * fx) * fy;
}
function mapH(lon, lat) {
  const W = EM.W, H = EM.H, h = EM.h;
  let x = (lon / TAU + 0.5) * W - 0.5;
  x -= Math.floor(x / W) * W;
  const y = clamp((0.5 - lat / Math.PI) * H - 0.5, 0, H - 1.0001);
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, x1 = ix + 1 === W ? 0 : ix + 1, r0 = iy * W, r1 = r0 + W;
  return (HLUT[h[r0 + ix]] * (1 - fx) + HLUT[h[r0 + x1]] * fx) * (1 - fy) + (HLUT[h[r1 + ix]] * (1 - fx) + HLUT[h[r1 + x1]] * fx) * fy;
}
// Blue Marble colour (sRGB 0..255) at a point given as sim angle and depth.
function earthColor(a, z, out) {
  const W = EM.CW, H = EM.CH, c = EM.rgb, g = toGeo(a, z / EARTH.radius), lat = g.lat;
  let x = (g.lon / TAU + 0.5) * W - 0.5;
  x -= Math.floor(x / W) * W;
  const y = clamp((0.5 - lat / Math.PI) * H - 0.5, 0, H - 1.0001);
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, x1 = ix + 1 === W ? 0 : ix + 1;
  const p00 = (iy * W + ix) * 3, p01 = (iy * W + x1) * 3, p10 = p00 + W * 3, p11 = p01 + W * 3;
  for (let k = 0; k < 3; k++) out[k] = (c[p00 + k] * (1 - fx) + c[p01 + k] * fx) * (1 - fy) + (c[p10 + k] * (1 - fx) + c[p11 + k] * fx) * fy;
  return out;
}
// city lights and built-up land, 0..1, at a sim angle and depth
const sampAt = (arr, a, z) => { const g = toGeo(a, z / EARTH.radius); return samp(arr, EM.FW, EM.FH, g.lon, g.lat) / 255; };
const nightAt = (a, z) => (EM.night ? sampAt(EM.night, a, z) : 0);
const lakeAt = (a, z) => (EM.lakeC ? sampAt(EM.lakeC, a, z) : 0);
const urbanAt = (a, z) => (EM.urban ? sampAt(EM.urban, a, z) : 0);

// ---- rivers and roads: polylines (degrees) in a 0.2° grid of segments
const LG = 0.2, LNX = 1800, LNY = 900;
const RIVER_W = [160, 110, 75, 50, 32], ROAD_W = [14, 11, 9, 7];
function indexLines(buf) {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'RL02') throw new Error('bad lines file');
  const count = dv.getUint32(4, true), X = [], Y = [], seg = [], kinds = [];
  let o = 8;
  for (let l = 0; l < count; l++) {
    const kind = dv.getUint8(o), cls = dv.getUint8(o + 1), n = dv.getUint16(o + 2, true);
    let x = dv.getInt32(o + 4, true), y = dv.getInt32(o + 8, true);
    o += 12;
    X.push(x / 1000); Y.push(y / 1000);
    for (let i = 1; i < n; i++) {
      const s = dv.getInt8(o);
      if (s === -128) { x += dv.getInt16(o + 1, true); y += dv.getInt16(o + 3, true); o += 5; } else { x += s; y += dv.getInt8(o + 1); o += 2; }
      seg.push(X.length - 1); kinds.push(kind * 8 + cls);
      X.push(x / 1000); Y.push(y / 1000);
    }
  }
  const L = { X: Float32Array.from(X), Y: Float32Array.from(Y), seg: Int32Array.from(seg), kind: Uint8Array.from(kinds) };
  // cells each segment's box touches, padded by the widest river's reach (~0.06°)
  const cells = (s, fn) => {
    const p = L.seg[s], m = 0.06;
    const x0 = Math.min(L.X[p], L.X[p + 1]) - m, x1 = Math.max(L.X[p], L.X[p + 1]) + m, y0 = Math.min(L.Y[p], L.Y[p + 1]) - m, y1 = Math.max(L.Y[p], L.Y[p + 1]) + m;
    const i0 = Math.floor((x0 + 180) / LG), i1 = Math.floor((x1 + 180) / LG), j0 = Math.max(0, Math.floor((90 - y1) / LG)), j1 = Math.min(LNY - 1, Math.floor((90 - y0) / LG));
    if (i1 - i0 > 40) return; // a jump across the date line
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * LNX + ((i % LNX) + LNX) % LNX);
  };
  const off = new Uint32Array(LNX * LNY + 1);
  for (let s = 0; s < L.seg.length; s++) cells(s, (c) => off[c + 1]++);
  for (let c = 0; c < LNX * LNY; c++) off[c + 1] += off[c];
  const fill = off.slice(0, LNX * LNY), ent = new Int32Array(off[LNX * LNY]);
  for (let s = 0; s < L.seg.length; s++) cells(s, (c) => { ent[fill[c]++] = s; });
  L.off = off; L.ent = ent;
  EM.lines = L;
}
// Nearest river and road to a point (degrees): distances in game metres, widths, the nearest points.
const LQ = { rd: Infinity, rw: 0, rx: 0, ry: 0, wd: Infinity, ww: 0, wx: 0, wy: 0 };
function lineQuery(lon, lat) {
  LQ.rd = LQ.wd = Infinity;
  const L = EM.lines;
  if (!L) return LQ;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  const i = Math.floor((lon + 180) / LG) % LNX, j = clamp(Math.floor((90 - lat) / LG), 0, LNY - 1), c = j * LNX + i;
  const km = EARTH.radius / DEG, kx = km * Math.max(0.05, Math.cos(lat / DEG)), X = L.X, Y = L.Y;
  let er = Infinity, ew = Infinity;
  const reach = 320; // nothing further than this matters (the widest river's valley)
  for (let q = L.off[c], e = L.off[c + 1]; q < e; q++) {
    const s = L.ent[q], p = L.seg[s];
    const ax = (X[p] - lon) * kx, bx = (X[p + 1] - lon) * kx;
    if ((ax > reach && bx > reach) || (ax < -reach && bx < -reach)) continue;
    const ay = (Y[p] - lat) * km, by = (Y[p + 1] - lat) * km;
    if ((ay > reach && by > reach) || (ay < -reach && by < -reach)) continue;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy, t = L2 > 0 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0, px = ax + t * dx, py = ay + t * dy, d = Math.hypot(px, py);
    const kc = L.kind[s];
    if (kc < 8) { // a river: the one whose bank is nearest wins
      const w = RIVER_W[kc], edge = d - w / 2;
      if (edge < er) { er = edge; LQ.rd = d; LQ.rw = w; LQ.rx = lon + px / kx; LQ.ry = lat + py / km; }
    } else {
      const w = ROAD_W[kc - 8], edge = d - w / 2;
      if (edge < ew) { ew = edge; LQ.wd = d; LQ.ww = w; LQ.wx = lon + px / kx; LQ.wy = lat + py / km; }
    }
  }
  return LQ;
}
// Rivers carve their valleys and roads cut a level way through the hills. EW keeps what was found here:
// the inland water surface (lakes and rivers) and how much road or river is under the point.
const EW = { level: 0, pres: 0, road: 0, river: 0, urban: 0, lake: 0 }; // lake: the water here is a lake's (one flat level)
function features(h, lon, lat, fade, cell = 0) { // lon, lat in degrees; fade 0..1 (coarse cells skip rivers and roads); cell: vertex spacing (m)
  EW.pres = EW.road = EW.river = EW.lake = 0;
  if (EM.lakeC) {
    const lc = samp(EM.lakeC, EM.FW, EM.FH, lon / DEG, lat / DEG);
    if (lc > 8) { EW.pres = EW.lake = smoothstep(80, 150, lc); EW.level = samp(EM.lakeL, EM.FW, EM.FH, lon / DEG, lat / DEG); }
  }
  if (fade <= 0 || !EM.lines) return h;
  const q = lineQuery(lon, lat);
  let level = -1e9;
  if (q.rd < q.rw / 2 + 220) {
    const hw = q.rw / 2;
    level = mapH(q.rx / DEG, q.ry / DEG) - 0.6; // the water surface: the map's height on the river's centre line
    const target = q.rd < hw ? level - (1.5 + q.rw * 0.03) * (1 - (q.rd / hw) ** 2) : level + 0.8 + (q.rd - hw) * 0.22;
    const k = (1 - smoothstep(hw + 20, hw + 220, q.rd)) * fade;
    h = Math.min(h, h + (target - h) * k);
    const pres = (1 - smoothstep(hw - 3, hw + 4, q.rd)) * fade;
    if (pres > EW.pres) { EW.pres = pres; EW.level = level; EW.lake = 0; }
    EW.river = (1 - smoothstep(hw, hw + 14, q.rd)) * fade;
  }
  if (q.wd < q.ww / 2 + 70) {
    const hw = q.ww / 2, inRiver = q.rd < Infinity ? 1 - smoothstep(q.rw / 2, q.rw / 2 + 30, q.rd) : 0;
    let rh = Math.max(mapH(lon / DEG, lat / DEG) + 0.3, 0.8); // the map's own (smooth) height here: no steps where roads meet
    if (inRiver > 0) rh = Math.max(rh, level + 4); // a raised deck where the road crosses a river
    // over the river only the roadway itself is filled, so a road along the bank leaves the river alone
    const k = lerp(1 - smoothstep(hw + 2, hw + 70, q.wd), 1 - smoothstep(hw + 0.5, hw + 4, q.wd), inRiver);
    h = lerp(h, rh, k * fade);
    // painted as coverage: on a cell wider than the road, a faint band one cell wide rather than a cell-wide smear
    const cw = Math.max(hw, cell * 0.5);
    EW.road = (1 - smoothstep(cw - 0.5, cw + 1.5, q.wd)) * Math.min(1, (hw + 1) / cw) * fade;
  }
  return h;
}

// ---- places: countries and seas, cities
function regionAt(lon, lat) { // degrees -> { country, sea } names (or null)
  if (!EM.country) return { country: null, sea: null };
  const x = Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * EM.RW), y = clamp(Math.floor((90 - lat) / 180 * EM.RH), 0, EM.RH - 1), i = y * EM.RW + Math.min(x, EM.RW - 1);
  const c = EM.country[i], s = EM.sea[i];
  return { country: c ? EM.regions[c - 1] : null, sea: s ? EM.regions[EM.nCountries + s - 1] : null };
}
let cityGrid = null; // 1° cells -> city indices
function indexCities() {
  cityGrid = new Map();
  EM.cities.forEach((c, i) => {
    const k = Math.floor(c[3] + 180) * 1000 + Math.floor(c[4] + 90);
    if (!cityGrid.has(k)) cityGrid.set(k, []);
    cityGrid.get(k).push(i);
  });
}
// Cities within r degrees of a point (degrees), nearest first, as [city, distance in game metres].
function citiesNear(lon, lat, r) {
  const out = [];
  if (!cityGrid) return out;
  const km = EARTH.radius / DEG, kx = km * Math.max(0.05, Math.cos(lat / DEG)), n = Math.ceil(r) + 1;
  for (let i = Math.floor(lon + 180) - n; i <= Math.floor(lon + 180) + n; i++) for (let j = Math.floor(lat + 90) - n; j <= Math.floor(lat + 90) + n; j++) {
    const list = cityGrid.get((((i % 360) + 360) % 360) * 1000 + j);
    if (!list) continue;
    for (const ci of list) {
      const c = EM.cities[ci];
      let dl = c[3] - lon;
      dl -= Math.round(dl / 360) * 360;
      const d = Math.hypot(dl * kx, (c[4] - lat) * km);
      if (d <= r * km) out.push([c, d]);
    }
  }
  return out.sort((a, b) => a[1] - b[1]);
}
// A city's built-up radius in game metres (the real city shrunk with the planet, buildings full size).
const cityRadius = (pop) => clamp(22 * Math.sqrt(pop / 1000), 90, 4200);
// map height at a point given as sim angle and depth
const earthH = (a, z) => { const g = toGeo(a, z / EARTH.radius); return mapH(g.lon, g.lat); };
// The island rises out of the real sea, with low hills and a ragged shore. hs: the profile's short waves.
function island(c, e, z, al, real, hs) {
  const dn = (e - ISLE.e) / ISLE.a, zn = z / ISLE.b;
  let d = Math.hypot(dn, zn);
  if (d > 1.25) return real;
  const n = c.coast[0];
  d += 0.09 * (vnoise2(al / n[0], z / n[0], n[1], c.seed + 31) * 2 - 1);
  const w = 1 - smoothstep(0.72, 1.0, d);
  // only ever adds land: the real islands' hills stand where they are
  return w > 0 ? Math.max(real, lerp(real, ISLE.h + 0.35 * hs * (1 - smoothstep(0.3, 0.8, d)), w)) : real;
}
// the profile's shorter octaves make hills, more of them on high ground
const hillW = (M) => 0.6 * smoothstep(4, 80, M) * (1 + M / 700);
// coasts get a ragged edge finer than the map (3D noise on the sphere: no grid lines, no seam)
function coastN(c, al, z, M) {
  const k = 1 - smoothstep(12, 40, Math.abs(M));
  if (k <= 0) return 0;
  const R = c.R, a = al / R, ph = z / R, cp = Math.cos(ph), x = R * cp * Math.cos(a), y = R * cp * Math.sin(a), w = R * Math.sin(ph);
  return 6 * k * ((vnoise3(x / 700, y / 700, w / 700, c.seed + 21) * 2 - 1) * 0.7 + (vnoise3(x / 230, y / 230, w / 230, c.seed + 22) * 2 - 1) * 0.3);
}
// Earth along the equator (the 2D profile's job when there is no map). It depends on nothing but a (until the
// map comes in), and ground contact asks again at the same angle a few calls later (under a point, then its
// slope north and south, then whether it's water), so the last four answers are kept.
const rawA = new Float64Array(4).fill(NaN), rawH = new Float64Array(4);
let rawI = 0;
function earthRaw(a) {
  for (let i = 0; i < 4; i++) if (rawA[i] === a) return rawH[i];
  const h = earthRaw0(a);
  rawA[rawI] = a; rawH[rawI] = h; rawI = (rawI + 1) & 3;
  return h;
}
function earthRaw0(a) {
  const c = cfgOf(EARTH), R = c.R, e = -wrapAngle(a - EARTH.padAngle) * R;
  let Ps = 0;
  for (let o = c.short; o < c.k.length; o++) Ps += c.amp[o] * Math.sin(c.k[o] * a + c.ph[o]);
  const g = toGeo(a, 0), lon = g.lon, lat = g.lat, M = mapH(lon, lat);
  let al = (a % TAU) * R;
  if (al < 0) al += TAU * R;
  const lake = EM.lakeC ? 1 - smoothstep(10, 100, samp(EM.lakeC, EM.FW, EM.FH, lon, lat)) : 1;
  const hm = island(c, e, 0, al, M + hillW(M) * Ps * lake + coastN(c, al, 0, M), Ps);
  return features(cliffs(hm, cliffW(lon * DEG, lat * DEG), e, 0), lon * DEG, lat * DEG, 1);
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
  c.mapped = b === EARTH && EM.state === 'ready';
  c.short = 2; c.coast = [per(300)];
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
// lazy: leave the track's own height (th) to height(), which works it out only where the track's ground shows
function setCol(c, G, i, a, dx, lazy) {
  const no = c.k.length, R = c.R;
  G.ang[i] = a; G.dx[i] = dx;
  let al = (a % TAU) * R;
  if (al < 0) al += TAU * R;
  G.al[i] = al;
  G.th[i] = lazy ? NaN : terrainHeight(c.b, a);
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
  if (c.mapped) { const g = toGeo(a, phi); return mapH(g.lon, g.lat); }
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
  let h = c.base, hs = 0;
  for (let o = 0, ci = i * no, rj = j * no; o < no; o++) {
    const t = c.amp[o] * (G.cs[ci + o] * G.rc[rj + o] + G.cc[ci + o] * G.rs[rj + o]);
    h += t;
    if (o >= c.short) hs += t;
  }
  crDark = 0;
  if (c.ck) {
    const kp = c.ck * G.phi[j], d2 = G.ch[i] * G.ch[i] + kp * kp;
    if (d2 < 2.4674) { const q = Math.cos(Math.sqrt(d2)), q3 = q * q * q; h -= c.cd * q3 * q3; crDark = q3 * 0.6; }
  }
  if (c.cr.length && az > 100) h += craters(c, G.al[i], z, cell);
  const wd = smoothstep(30, 400, az);
  let det = 0;
  if (wd > 0) for (const [cs, n, amp] of c.det) {
    const wb = 1 - smoothstep(0.3 * cs, 0.6 * cs, cell);
    if (wb > 0) det += amp * wd * wb * (vnoise2(G.al[i] / cs, z / cs, n, c.seed) * 2 - 1);
  }
  if (c.mapped) { // cont is the map's height here; no hills on lake beds
    const g = toGeo(G.ang[i], G.phi[j]), lon = g.lon, lat = g.lat;
    const lake = EM.lakeC ? 1 - smoothstep(10, 100, samp(EM.lakeC, EM.FW, EM.FH, lon, lat)) : 1;
    const aw = arenaW(G.ea[i], z);
    if (aw > 0) det *= 1 - aw; // (a battle arena: no detail finer than the drawn ground shows)
    let hm = island(c, G.ea[i], z, G.al[i], cont + hillW(cont) * hs * lake + coastN(c, G.al[i], z, cont), hs) + det;
    hm = cliffs(hm, cliffW(lon * DEG, lat * DEG), G.ea[i], z);
    return features(hm, lon * DEG, lat * DEG, 1 - smoothstep(150, 400, cell), cell);
  }
  return h + det + cont * smoothstep(c.c0, c.c1, az);
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
// Airfields off the track (EARTH.airfields): how much a point is on one (1 on the strip, fading over its
// blend) and the height it is flattened to. Strip frame: u along the runway, v across.
// The Ground Battle pads (EARTH.groundPads, f.pad) are levelled the same way, on the real map only (their heights are its).
const FQ = { w: 0, h: 0, f: null };
function fieldAt(e, z, o = FQ) {
  o.w = 0; o.f = null;
  const F = EARTH.airfields, P = EARTH.mapped && EARTH.groundPads;
  if (!F) return o;
  for (const k in F) fieldIn(F[k], e, z, o);
  if (P) for (const k in P) fieldIn(P[k], e, z, o);
  return o;
}
function fieldIn(f, e, z, o) {
  const de = e - f.e, dz = z - f.z;
  if (Math.abs(de) > f.hl + f.blend + f.hw || Math.abs(dz) > f.hl + f.blend + f.hw) return;
  const u = de * f.c + dz * f.s, v = -de * f.s + dz * f.c;
  const w = 1 - smoothstep(0, f.blend, Math.hypot(Math.max(Math.abs(u) - f.hl, 0), Math.max(Math.abs(v) - f.hw, 0)));
  if (w > o.w) { o.w = w; o.h = f.h; o.f = f; }
}
// The Ground Battle arenas (EARTH.arenas, space.js) whose ground is made for the fight (clear), on the real map:
// arenaW is how far a point is inside one, 1 in its box fading to 0 over 200 m round it. There the ground's fine detail
// (Earth's 40 m and 160 m waves, which the drawn ground drops where its cells are coarse) fades out, so the ground seen
// across the battlefield is the ground shells hit and tanks drive on. Never on an airfield's ground, though: the fade
// is 0 over its strip and blend and 3 m past it (the physics lattice's 2 m cells), coming back over the next 200 m
// (Wick's south end and blend reach into Highland Ridge's box).
const ARENA_FADE = 200;
function arenaW(e, z) {
  const A = EARTH.arenas;
  let w = 0;
  if (A) for (const k in A) {
    const a = A[k], B = a.box;
    if (!a.clear || !B || e < B.e0 - ARENA_FADE || e > B.e1 + ARENA_FADE || z < B.z0 - ARENA_FADE || z > B.z1 + ARENA_FADE) continue;
    w = Math.max(w, 1 - smoothstep(0, ARENA_FADE, Math.hypot(Math.max(B.e0 - e, 0, e - B.e1), Math.max(B.z0 - z, 0, z - B.z1))));
  }
  const F = EARTH.airfields;
  if (w > 0 && F) for (const k in F) {
    const f = F[k], de = e - f.e, dz = z - f.z, r = f.hl + f.hw + f.blend + 3 + ARENA_FADE;
    if (Math.abs(de) > r || Math.abs(dz) > r) continue;
    const u = de * f.c + dz * f.s, v = -de * f.s + dz * f.c;
    w *= smoothstep(f.blend + 3, f.blend + 3 + ARENA_FADE, Math.hypot(Math.max(Math.abs(u) - f.hl, 0), Math.max(Math.abs(v) - f.hw, 0)));
  }
  return w;
}
// An arena's earth berms (EARTH.arenas[k].berms; the real map only), the height they add at (e, z): each is a bank
// 2.4 m high, Gaussian across (σ 3.5 m, ending 12 m out) and 26 m long, tapering over its last 6 m, along its yaw.
// Physics and line of sight have them through height(); the terrain patch leaves them out (noBerm) for a mesh of
// their own, since no patch cell is fine enough to show a bank 10 m wide.
const BERM = { h: 2.4, s: 3.5, half: 13, taper: 6, v: 12 }, BERM_E = Math.exp(-(BERM.v * BERM.v) / (2 * BERM.s * BERM.s));
function bermAt(e, z) {
  const A = EARTH.mapped && EARTH.arenas;
  let h = 0;
  if (A) for (const k in A) {
    const a = A[k], B = a.box, L = a.berms;
    if (!L || !L.length || !B || e < B.e0 || e > B.e1 || z < B.z0 || z > B.z1) continue;
    for (const b of L) {
      const de = e - b.e, dz = z - b.z;
      if (de > 25 || de < -25 || dz > 25 || dz < -25) continue;
      const u = Math.abs(de * b.c + dz * b.s), v = -de * b.s + dz * b.c;
      if (u >= BERM.half || Math.abs(v) >= BERM.v) continue;
      h += BERM.h * ((Math.exp(-(v * v) / (2 * BERM.s * BERM.s)) - BERM_E) / (1 - BERM_E)) * (1 - smoothstep(BERM.half - BERM.taper, BERM.half, u));
    }
  }
  return h;
}
// The flight deck of a carrier at (e, z), or NaN: decks stand above the sea (physics only; Render3D draws the ship).
// Its outline (metres along u, across v to starboard, for a 260 x 36 m deck) takes in the angled deck's overhang
// to port and the island's sponson to starboard, as drawn. `m` widens it by that many metres (for "a deck near?").
const DECK_PLAN = [[-131, -18], [-50, -18], [-20, -22], [52, -27.5], [74, -18], [131, -18], [133.5, -15], [133.5, 15], [131, 18], [20, 18], [16, 29.5],
  [-82, 29.5], [-86, 18], [-131, 18], [-133, 15], [-133, -15]];
function inDeckPlan(x, y) {
  let ins = false;
  for (let i = 0, j = DECK_PLAN.length - 1; i < DECK_PLAN.length; j = i++) {
    const [xi, yi] = DECK_PLAN[i], [xj, yj] = DECK_PLAN[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function deckAt(b, a, z, m = 0) {
  const C = EARTH.carriers;
  if (b !== EARTH || !C) return NaN;
  const e = -wrapAngle(a - EARTH.padAngle) * b.radius;
  for (const k in C) {
    const d = C[k], de = e - d.e, dz = z - d.z;
    if (Math.abs(de) > d.hl + 40 + m || Math.abs(dz) > d.hl + 40 + m) continue;
    const u = de * d.c + dz * d.s, v = -de * d.s + dz * d.c, kx = d.hl / 130, kz = d.hw / 18;
    if (m > 0) { if (Math.abs(u) <= 134 * kx + m && v >= -28 * kz - m && v <= 30 * kz + m) return d.deck; continue; }
    if (inDeckPlan(u / kx, v / kz)) return d.deck;
  }
  return NaN;
}
// noBerm: leave out the arenas' berms (the terrain patch: they have a mesh of their own)
function height(c, G, i, j, cont, noBerm) {
  const B = builtW(c, G, i, j);
  if (B > 0 && G.th[i] !== G.th[i]) G.th[i] = terrainHeight(c.b, G.ang[i]); // (a lazy column's: see setCol)
  EW.pres = EW.road = EW.river = EW.lake = 0;
  if (B >= 1) { crDark = 0; return G.th[i]; }
  let hn = natural(c, G, i, j, cont);
  if (c.b === EARTH && fieldAt(G.ea[i], G.z[j]).w > 0) { // an airfield: level ground, no rivers or roads across it
    hn = lerp(hn, FQ.h, FQ.w);
    if (FQ.w > 0.5) { EW.pres = EW.road = EW.river = EW.lake = 0; crDark = 0; }
  }
  if (c.mapped && !noBerm) { const bh = bermAt(G.ea[i], G.z[j]); if (bh > 0) hn += bh; }
  return B > 0 ? lerp(hn, G.th[i], B) : hn;
}
// Exact 3D terrain at one point (slow path: camera clamp away from the patch).
function h3dAt(c, a, z) {
  setCol(c, c.G1, 0, a, 0, true); setRow(c, c.G1, 0, z, 0);
  return height(c, c.G1, 0, 0, contAt(c, a, z / c.R));
}
// ------------------------------------------------------------------ physics API
// Heights are cached on a 2 m lattice and interpolated; on the track (where craft drive, land and launch)
// the ground is exactly the 2D profile, so the pad, runway and road keep their crisp edges.
const GS = 2, hc = new Map(), hwc = new Map(); // heights, and inland water surfaces (NaN: none)
let hcBody = null;
function cell(c, n, ia, iz) {
  ia = ((ia % n) + n) % n;
  const k = iz * n + ia;
  let h = hc.get(k);
  if (h === undefined) { h = h3dAt(c, (ia * TAU) / n, iz * GS); hc.set(k, h); hwc.set(k, EW.pres > 0.5 ? EW.level : NaN); }
  return h;
}
// On the track (|z| within its half-width here) the ground is the 2D profile, and no lakes or rivers lie.
const onTrack = (b, c, a, z) => Math.abs(z) <= (b === EARTH ? trackHalf(-wrapAngle(a - EARTH.padAngle) * c.R) : 25);
// Off the track: the ground on the lattice, and its inland water (lakes, rivers: the surface, or NaN; the map only)
function latticeAt(b, c, a, z) {
  const R = c.R;
  if (hcBody !== b || hc.size > 80000) { hc.clear(); hwc.clear(); hcBody = b; }
  const n = Math.max(8, Math.round((TAU * R) / GS));
  let fa = ((a % TAU) / TAU) * n;
  if (fa < 0) fa += n;
  const fz = z / GS, ia = Math.floor(fa), iz = Math.floor(fz), tx = fa - ia, tz = fz - iz;
  const h0 = lerp(cell(c, n, ia, iz), cell(c, n, ia + 1, iz), tx), h1 = lerp(cell(c, n, ia, iz + 1), cell(c, n, ia + 1, iz + 1), tx);
  return lerp(h0, h1, tz);
}
function inlandOff(c, a, z) {
  const n = Math.max(8, Math.round((TAU * c.R) / GS));
  let fa = ((a % TAU) / TAU) * n;
  if (fa < 0) fa += n;
  const ia = Math.round(fa), iz = Math.round(z / GS);
  cell(c, n, ia, iz);
  return hwc.get(iz * n + (((ia % n) + n) % n));
}
// Inland water at a point: its surface, or NaN. Earth with the map only.
function inlandAt(b, a, z) {
  if (!b.mapped) return NaN;
  const c = cfgOf(b);
  return onTrack(b, c, a, z) ? NaN : inlandOff(c, a, z);
}
function heightAt(b, a, z) {
  const c = cfgOf(b);
  return onTrack(b, c, a, z) ? terrainHeight(b, a) : latticeAt(b, c, a, z);
}
// What a craft stands on: a deck, the sea's surface, a lake's or river's, or the ground.
function surfaceAt(b, a, z) {
  const dk = deckAt(b, a, z);
  if (dk === dk) return dk;
  const c = cfgOf(b), on = onTrack(b, c, a, z), h = on ? terrainHeight(b, a) : latticeAt(b, c, a, z);
  if (b.ocean && h < 0) return 0;
  if (b.mapped && !on) { const w = inlandOff(c, a, z); if (w > h) return w; }
  return h;
}
function waterAt3(b, a, z) {
  const dk = deckAt(b, a, z);
  if (dk === dk) return false;
  const c = cfgOf(b), on = onTrack(b, c, a, z), h = on ? terrainHeight(b, a) : latticeAt(b, c, a, z);
  if (b.ocean && h < 0) return true;
  return b.mapped && !on && inlandOff(c, a, z) > h;
}
// Where a body-relative point sits: angle, depth along the surface, distance from the centre.
function locate(b, rx, ry, rz, o = {}) {
  const r = Math.hypot(rx, ry, rz) || 1;
  o.a = Math.atan2(ry, rx); o.lat = Math.asin(clamp(rz / r, -1, 1)); o.z = o.lat * b.radius; o.r = r;
  return o;
}
// Outward ground normal (sim axes) at (a, z), from the slopes east and north.
function normalAt(b, a, z, o = v3()) {
  const R = b.radius, lat = z / R, cl = Math.max(0.05, Math.cos(lat)), sl = Math.sin(lat), ca = Math.cos(a), sa = Math.sin(a), d = 1.5;
  const dk = deckAt(b, a, z);
  if (dk === dk) { o.x = cl * ca; o.y = cl * sa; o.z = sl; return norm3(o); } // a deck is flat to its edge
  const da = d / (R * cl);
  const se = (surfaceAt(b, a - da, z) - surfaceAt(b, a + da, z)) / (2 * d); // east is towards decreasing a
  const sn = (surfaceAt(b, a, z + d) - surfaceAt(b, a, z - d)) / (2 * d);
  o.x = cl * ca - se * sa + sn * ca * sl;
  o.y = cl * sa + se * ca + sn * sa * sl;
  o.z = sl - sn * cl;
  return norm3(o);
}

return {
  loadEarth, earthRaw, earthColor, earthH, mapH, earthMap: EM, setEarthData, nightAt, urbanAt, lakeAt, lineQuery, features,
  water: EW, inlandAt, regionAt, citiesNear, cityRadius, DEG, SITE, ISLE, toGeo, toSim, bearingAt, treelessAt, cliffAt,
  hashI, vnoise2, vnoise3, fbm3, cfgOf, grid, setCol, setRow, contAt, height, h3dAt, trackHalf, trackBlend, apronW,
  dark: () => crDark, heightAt, surfaceAt, waterAt: waterAt3, locate, normalAt, fieldAt, deckAt, arenaW, bermAt, BERM,
};
})();
