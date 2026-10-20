'use strict';
// Shared helpers: math, formatting, storage.

const TAU = Math.PI * 2;
const G0 = 9.80665;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// 3D vectors are plain {x, y, z}; quaternions {w, x, y, z} rotate part space into the world.
function v3(x = 0, y = 0, z = 0) { return { x, y, z }; }
function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross3(a, b, o = v3()) { const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; o.x = x; o.y = y; o.z = z; return o; }
function len3(a) { return Math.hypot(a.x, a.y, a.z); }
function norm3(a, o = a) { const l = Math.hypot(a.x, a.y, a.z) || 1; o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; return o; }
function quat(w = 1, x = 0, y = 0, z = 0) { return { w, x, y, z }; }
function qmul(a, b, o = quat()) {
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z, x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  o.w = w; o.x = x; o.y = y; o.z = z; return o;
}
function qnorm(q) { const l = Math.hypot(q.w, q.x, q.y, q.z) || 1; q.w /= l; q.x /= l; q.y /= l; q.z /= l; return q; }
function qconj(q, o = quat()) { o.w = q.w; o.x = -q.x; o.y = -q.y; o.z = -q.z; return o; }
function qaxis(ax, ay, az, ang) { const s = Math.sin(ang / 2), l = Math.hypot(ax, ay, az) || 1; return quat(Math.cos(ang / 2), (ax / l) * s, (ay / l) * s, (az / l) * s); }
// Rotate (x, y, z) by q, or by its inverse.
function qrot(q, x, y, z, o = v3()) {
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  o.x = x + q.w * tx + q.y * tz - q.z * ty; o.y = y + q.w * ty + q.z * tx - q.x * tz; o.z = z + q.w * tz + q.x * ty - q.y * tx;
  return o;
}
function qunrot(q, x, y, z, o = v3()) { return qrot({ w: q.w, x: -q.x, y: -q.y, z: -q.z }, x, y, z, o); }
// Quaternion whose rotation takes the basis (ex, ey, ez) to the world axes' images: columns of a rotation matrix.
function qbasis(ex, ey, ez) {
  const m00 = ex.x, m10 = ex.y, m20 = ex.z, m01 = ey.x, m11 = ey.y, m21 = ey.z, m02 = ez.x, m12 = ez.y, m22 = ez.z, tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = quat(0.25 * s, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s); }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = quat((m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s); }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = quat((m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s); }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = quat((m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s); }
  return qnorm(q);
}
function qslerp(a, b, t, o = quat()) {
  let bw = b.w, bx = b.x, by = b.y, bz = b.z, c = a.w * bw + a.x * bx + a.y * by + a.z * bz;
  if (c < 0) { c = -c; bw = -bw; bx = -bx; by = -by; bz = -bz; }
  let k0 = 1 - t, k1 = t;
  if (c < 0.9995) { const th = Math.acos(c), s = Math.sin(th); k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s; }
  o.w = a.w * k0 + bw * k1; o.x = a.x * k0 + bx * k1; o.y = a.y * k0 + by * k1; o.z = a.z * k0 + bz * k1;
  return qnorm(o);
}
// The surface frame at a point: up = radial, east = up × world z (screen-right at the pad), north = east × up.
function surfaceFrame(x, y, z) {
  const up = norm3(v3(x, y, z));
  let east = cross3(up, v3(0, 0, 1));
  if (len3(east) < 1e-6) east = v3(1, 0, 0);
  norm3(east);
  return { up, east, north: cross3(east, up) };
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixColor(c1, c2, t) {
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return `rgb(${Math.round(lerp(a[0], b[0], t))},${Math.round(lerp(a[1], b[1], t))},${Math.round(lerp(a[2], b[2], t))})`;
}
const _rgbCache = {};
function hexToRgb(h) {
  if (_rgbCache[h]) return _rgbCache[h];
  const n = parseInt(h.slice(1), 16);
  return (_rgbCache[h] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}

const fmt = {
  dist(m) {
    const a = Math.abs(m);
    if (!isFinite(m)) return '—';
    if (a < 10000) return `${Math.round(m).toLocaleString('en-US')} m`;
    if (a < 1e6) return `${(m / 1000).toFixed(1)} km`;
    if (a < 1e10) return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
    return `${(m / 1e9).toFixed(2)} Gm`;
  },
  speed(v) {
    if (!isFinite(v)) return '—';
    return Math.abs(v) < 100 ? `${v.toFixed(1)} m/s` : `${Math.round(v).toLocaleString('en-US')} m/s`;
  },
  clock(s) {
    s = Math.max(0, Math.floor(s));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const p = (n) => String(n).padStart(2, '0');
    return (d ? `${d}d ` : '') + `${p(h)}:${p(m)}:${p(s)}`;
  },
  duration(s) {
    if (!isFinite(s)) return '—';
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  },
  mass(kg) { return `${(kg / 1000).toFixed(kg < 10000 ? 2 : 1)} t`; },
};

const store = {
  get(key, fallback) {
    try {
      let v = localStorage.getItem(key);
      // saves from before the rename used an "orbitforge." prefix
      if (v == null && key.startsWith('rss.')) v = localStorage.getItem('orbitforge.' + key.slice(4));
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; /* storage unavailable or full */ }
  },
};

// Secret silly settings (unlocked by tapping the Options title): all off unless the player turns them on.
const Silly = {
  list: [
    ['ghostCam', 'Crash cam classic', 'The original crash bug: after a crash the camera stays put in space and the planet zooms away.'],
    ['retro2d', 'Retro 2D flight', 'Fly in the original flat 2D view.'],
    ['ogAutopilot', 'Vintage autopilot', 'The first plane autopilot, from before it learned not to porpoise.'],
    ['noodle', 'Noodle wings', 'Wings and tails tear off at a quarter of the load.'],
    ['bouncy', 'Bouncy castle', 'Nothing breaks when it hits the ground. Everything bounces.'],
    ['drunk', 'Wobbly pilot', 'The stick drifts around on its own, in waves.'],
    ['hollywood', 'Hollywood', 'Explosions three times the size, and stage separations explode too.'],
    ['boomy', 'Sonic boom at 90 km/h', 'The vapour cone and the boom think the speed of sound is 25 m/s.'],
  ],
  flags: store.get('rss.silly', {}),
  on(k) { return !!this.flags[k] && !(typeof MP !== 'undefined' && MP.pvp); }, // (none in a battle: they'd be cheats)
  set(k, v) { this.flags[k] = !!v; store.set('rss.silly', this.flags); },
  get unlocked() { return !!store.get('rss.sillyUnlocked', false); },
  unlock() { store.set('rss.sillyUnlocked', true); },
};
// The Mach number the sound-barrier effects use (only effects: missions read v.mach).
function effectMach(v) { return Silly.on('boomy') ? (v.airspeed || 0) / 25 : v.mach || 0; }

// Tiny DOM helpers
const $ = (sel) => document.querySelector(sel);
function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'text') e.textContent = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

const isTouch = matchMedia('(pointer: coarse)').matches;
