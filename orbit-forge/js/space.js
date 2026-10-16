'use strict';
// Celestial bodies, terrain and two-body (Kepler) orbit math.
// Scale follows the "small solar system" idea: real surface gravity, much smaller radii.

function makeBody(o) {
  o.mu = o.surfaceG * o.radius * o.radius;
  if (o.parent) {
    o.n = Math.sqrt(o.parent.mu / Math.pow(o.orbitRadius, 3)); // rad/s
    o.soi = o.orbitRadius * Math.pow(o.mu / o.parent.mu, 0.4);
    o.period = TAU / o.n;
  } else {
    o.soi = Infinity;
  }
  o.terrainMax = o.terrain.reduce((s, t) => s + t[1], 0);
  return o;
}

const EARTH = makeBody({
  id: 'earth', name: 'Earth', radius: 315000, surfaceG: 9.8,
  atmoHeight: 30000, rho0: 1.2, scaleH: 5200,
  warpAlt: 30000,
  colors: { ground: '#3d5f3a', surface: '#6f9a4f', deep: '#2a3f2a', sky: '#5d9fd8', map: '#2f6fb7', halo: '93,159,216' },
  terrain: [[6, 120, 0.3], [17, 80, 1.7], [53, 55, 4.1], [149, 35, 2.2], [411, 16, 5.5], [1103, 6, 0.9]],
  padAngle: Math.PI / 2,
});

const MOON = makeBody({
  id: 'moon', name: 'Moon', radius: 90000, surfaceG: 1.62,
  atmoHeight: 0, rho0: 0, scaleH: 1,
  parent: EARTH, orbitRadius: 6.2e6, orbitPhase: 2.4, orbitDir: -1,
  colors: { ground: '#6e6f73', surface: '#a3a4a8', deep: '#4b4c50', sky: '#000000', map: '#9a9ba0', halo: '0,0,0' },
  terrain: [[5, 520, 0.8], [13, 300, 2.9], [37, 180, 1.1], [97, 110, 4.4], [263, 45, 0.2], [701, 18, 3.3]],
});
MOON.warpAlt = MOON.terrainMax + 2500;

const BODIES = [EARTH, MOON];

function bodyPos(b, t) {
  if (!b.parent) return { x: 0, y: 0 };
  const a = b.orbitPhase + b.orbitDir * b.n * t;
  return { x: b.orbitRadius * Math.cos(a), y: b.orbitRadius * Math.sin(a) };
}
function bodyVel(b, t) {
  if (!b.parent) return { x: 0, y: 0 };
  const a = b.orbitPhase + b.orbitDir * b.n * t;
  const s = b.orbitDir * b.n * b.orbitRadius;
  return { x: -s * Math.sin(a), y: s * Math.cos(a) };
}

function terrainHeight(b, ang) {
  let h = 0;
  for (const [k, amp, ph] of b.terrain) h += amp * Math.sin(k * ang + ph);
  if (b.id === 'moon') {
    // craters: sharpen the troughs a little
    h -= 90 * Math.pow(Math.abs(Math.sin(41 * ang + 0.7)), 6);
  }
  if (b.padAngle != null) {
    const d = Math.abs(wrapAngle(ang - b.padAngle));
    h *= smoothstep(0.0007, 0.005, d);
  }
  return h;
}
function surfaceRadius(b, ang) { return b.radius + terrainHeight(b, ang); }
function surfaceNormal(b, ang) {
  // outward normal accounting for slope
  const e = 2e-6;
  const dh = (terrainHeight(b, ang + e) - terrainHeight(b, ang - e)) / (2 * e); // m per rad
  const r = b.radius;
  const cx = Math.cos(ang), cy = Math.sin(ang);
  // tangent (counterclockwise) = (-sin, cos); slope along it = dh/(r)
  let nx = cx + (dh / r) * cy, ny = cy - (dh / r) * cx;
  const l = Math.hypot(nx, ny);
  return { x: nx / l, y: ny / l };
}

function airDensity(b, alt) {
  if (!b.atmoHeight || alt >= b.atmoHeight) return 0;
  const fade = 1 - smoothstep(b.atmoHeight * 0.8, b.atmoHeight, alt);
  return b.rho0 * Math.exp(-Math.max(alt, 0) / b.scaleH) * fade;
}

// ---------------------------------------------------------------------------
// Kepler orbits (2D). dir = +1 counterclockwise, -1 clockwise.

function elementsFromState(rx, ry, vx, vy, mu) {
  const r = Math.hypot(rx, ry);
  const v2 = vx * vx + vy * vy;
  const h = rx * vy - ry * vx;
  const rv = rx * vx + ry * vy;
  const k = v2 - mu / r;
  const ex = (k * rx - rv * vx) / mu;
  const ey = (k * ry - rv * vy) / mu;
  let e = Math.hypot(ex, ey);
  const energy = v2 / 2 - mu / r;
  const p = h * h / mu;
  const o = { mu, h, e, p, dir: h >= 0 ? 1 : -1, r0: r, energy };
  o.degenerate = p < r * 1e-7;
  if (o.degenerate) { o.a = -mu / (2 * energy); o.rp = 0; o.ra = energy < 0 ? 2 * o.a : Infinity; return o; }
  if (Math.abs(e - 1) < 1e-7) e = o.e = 1 + 1e-7; // avoid parabolic singularity
  o.w = e > 1e-9 ? Math.atan2(ey, ex) : Math.atan2(ry, rx);
  o.nu0 = wrapAngle(o.dir * (Math.atan2(ry, rx) - o.w));
  o.a = p / (1 - e * e);
  o.rp = p / (1 + e);
  o.ra = e < 1 ? p / (1 - e) : Infinity;
  if (e < 1) {
    o.n = Math.sqrt(mu / (o.a * o.a * o.a));
    o.period = TAU / o.n;
  } else {
    o.n = Math.sqrt(mu / Math.pow(-o.a, 3));
    o.period = Infinity;
    o.nuMax = Math.acos(-1 / e);
  }
  o.M0 = meanFromNu(o, o.nu0);
  return o;
}

function meanFromNu(o, nu) {
  const e = o.e;
  if (e < 1) {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu / 2));
    return E - e * Math.sin(E);
  }
  let x = Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2);
  x = clamp(x, -0.999999999, 0.999999999);
  const F = 2 * Math.atanh(x);
  return e * Math.sinh(F) - F;
}

function nuFromMean(o, M) {
  const e = o.e;
  if (e < 1) {
    M = wrapAngle(M);
    let E = e > 0.8 ? Math.PI * Math.sign(M || 1) : M;
    for (let i = 0; i < 50; i++) {
      const f = E - e * Math.sin(E) - M;
      const d = f / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) < 1e-12) break;
    }
    return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
  }
  let F = Math.asinh(M / e);
  for (let i = 0; i < 60; i++) {
    const f = e * Math.sinh(F) - F - M;
    const d = f / (e * Math.cosh(F) - 1);
    F -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(F / 2));
}

function stateFromNu(o, nu) {
  const e = o.e, p = o.p;
  const r = p / (1 + e * Math.cos(nu));
  const phi = o.w + o.dir * nu;
  const c = Math.cos(phi), s = Math.sin(phi);
  const sq = Math.sqrt(o.mu / p);
  const vr = sq * e * Math.sin(nu);
  const vt = sq * (1 + e * Math.cos(nu)) * o.dir;
  return { x: r * c, y: r * s, vx: vr * c - vt * s, vy: vr * s + vt * c, nu, r };
}

function stateAt(o, dt) {
  return stateFromNu(o, nuFromMean(o, o.M0 + o.n * dt));
}

// Time from epoch until the orbit reaches true anomaly nu (next occurrence, >= 0).
function timeToNu(o, nu) {
  let dM = meanFromNu(o, nu) - o.M0;
  if (o.e < 1) { dM = ((dM % TAU) + TAU) % TAU; }
  return dM / o.n;
}

function radiusAtNu(o, nu) { return o.p / (1 + o.e * Math.cos(nu)); }

// True anomaly (outbound, positive) where the orbit crosses radius R; null if never.
function nuAtRadius(o, R) {
  const c = (o.p / R - 1) / o.e;
  if (c < -1 || c > 1 || o.e < 1e-9) return null;
  return Math.acos(c);
}

// Gravity-only numerical step (for degenerate, radial trajectories).
function gravityStep(s, mu, dt) {
  // velocity Verlet
  let r = Math.hypot(s.x, s.y), k = -mu / (r * r * r);
  s.vx += 0.5 * dt * k * s.x; s.vy += 0.5 * dt * k * s.y;
  s.x += dt * s.vx; s.y += dt * s.vy;
  r = Math.hypot(s.x, s.y); k = -mu / (r * r * r);
  s.vx += 0.5 * dt * k * s.x; s.vy += 0.5 * dt * k * s.y;
}

// ---------------------------------------------------------------------------
// Trajectory prediction with patched conics (Earth <-> Moon).
// Returns a list of patches: { body, o, t0, tEnd, end, originT, start:{...} }

function predictTrajectory(body, st, t0, maxPatches = 3) {
  const patches = [];
  let b = body, s = { x: st.x, y: st.y, vx: st.vx, vy: st.vy }, t = t0;
  for (let k = 0; k < maxPatches; k++) {
    const o = elementsFromState(s.x, s.y, s.vx, s.vy, b.mu);
    const patch = { body: b, o, t0: t, tEnd: Infinity, end: null };
    patches.push(patch);
    if (o.degenerate) { patch.end = 'radial'; break; }

    let best = Infinity, kind = null;
    // impact with surface
    if (o.rp < b.radius + b.terrainMax * 0.5) {
      const nuI = nuAtRadius(o, b.radius);
      if (nuI != null) {
        const dt = timeToNu(o, -nuI); // descending crossing
        if (dt >= 0 && dt < best) { best = dt; kind = 'impact'; }
      }
    }
    // leaving sphere of influence
    if (b.parent && (o.e >= 1 || o.ra > b.soi)) {
      const nuE = nuAtRadius(o, b.soi);
      if (nuE != null) {
        const dt = timeToNu(o, nuE);
        if (dt < best) { best = dt; kind = 'escape'; }
      }
    }
    // encountering a moon
    if (!b.parent) {
      const horizon = Math.min(best, o.e < 1 ? o.period : 6e5);
      const enc = findEncounter(o, t, horizon);
      if (enc != null && enc < best) { best = enc; kind = 'encounter'; }
    }
    patch.tEnd = t + best;
    patch.end = kind;
    if (kind === 'encounter') {
      const sv = stateAt(o, best);
      const mp = bodyPos(MOON, t + best), mv = bodyVel(MOON, t + best);
      s = { x: sv.x - mp.x, y: sv.y - mp.y, vx: sv.vx - mv.x, vy: sv.vy - mv.y };
      b = MOON; t = t + best;
    } else if (kind === 'escape') {
      const sv = stateAt(o, best);
      const pp = bodyPos(b, t + best), pv = bodyVel(b, t + best);
      s = { x: sv.x + pp.x, y: sv.y + pp.y, vx: sv.vx + pv.x, vy: sv.vy + pv.y };
      b = b.parent; t = t + best;
    } else break;
  }
  return patches;
}

function findEncounter(o, t0, horizon) {
  if (!isFinite(horizon) || horizon <= 0) return null;
  // quick reject: orbit never reaches the moon's distance band
  const lo = MOON.orbitRadius - MOON.soi, hi = MOON.orbitRadius + MOON.soi;
  if (o.ra < lo || o.rp > hi) return null;
  const steps = 500;
  const dt = horizon / steps;
  let prev = 0;
  for (let i = 1; i <= steps; i++) {
    const tt = i * dt;
    const s = stateAt(o, tt);
    if (s.r < lo) { prev = tt; continue; }
    const m = bodyPos(MOON, t0 + tt);
    if (Math.hypot(s.x - m.x, s.y - m.y) < MOON.soi) {
      let a = prev, b = tt;
      for (let j = 0; j < 30; j++) {
        const mid = (a + b) / 2;
        const sm = stateAt(o, mid), mm = bodyPos(MOON, t0 + mid);
        if (Math.hypot(sm.x - mm.x, sm.y - mm.y) < MOON.soi) b = mid; else a = mid;
      }
      return b;
    }
    prev = tt;
  }
  return null;
}
