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
    return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
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
    return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  },
  mass(kg) { return `${(kg / 1000).toFixed(kg < 10000 ? 2 : 1)} t`; },
};

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  },
};

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
