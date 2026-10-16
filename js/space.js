'use strict';
// Celestial bodies, terrain, two-body (Kepler) orbits and patched-conic trajectory prediction.
// Like Spaceflight Simulator, the solar system is shrunk: real surface gravity, small radii,
// so a trip to Mars takes a few in-game days instead of months.

const ZERO = Object.freeze({ x: 0, y: 0 });

function makeBody(o) {
  o.mu = o.surfaceG * o.radius * o.radius;
  o.children = [];
  o.terrain = o.terrain || [];
  o.terrainMax = o.terrain.reduce((s, t) => s + t[1], 0) + (o.craters ? o.craters[1] : 0) + Math.abs(o.terrainBase || 0);
  o.atmoHeight = o.atmoHeight || 0;
  o.rho0 = o.rho0 || 0;
  o.scaleH = o.scaleH || 1;
  o.depth = o.parent ? o.parent.depth + 1 : 0;
  if (o.parent) {
    o.parent.children.push(o);
    o.n = Math.sqrt(o.parent.mu / Math.pow(o.orbitRadius, 3));
    o.soi = o.orbitRadius * Math.pow(o.mu / o.parent.mu, 0.4);
    o.period = TAU / o.n;
    o.orbitSpeed = o.n * o.orbitRadius;
  } else {
    o.soi = Infinity;
    o.orbitSpeed = 0;
  }
  o.warpAlt = o.star ? o.radius * 0.6 : o.atmoHeight ? o.atmoHeight : o.terrainMax + Math.max(1500, o.radius * 0.02);
  return o;
}

const SUN = makeBody({
  id: 'sun', name: 'Sun', radius: 6.0e6, surfaceG: 28, star: true, difficulty: 6,
  colors: { map: '#ffcf5a', ground: '#ffb53d', surface: '#ffe7a0', deep: '#ff9a2a', halo: '255,190,90' },
  blurb: 'A small, fierce star. Get too close and your rocket melts.',
});

const MERCURY = makeBody({
  id: 'mercury', name: 'Mercury', radius: 100000, surfaceG: 3.7, parent: SUN, orbitRadius: 0.8e8, orbitPhase: 1.1, orbitDir: -1,
  colors: { ground: '#6f655c', surface: '#a69888', deep: '#4f4740', map: '#9a8b7e', rock: '#5a5148', halo: '0,0,0' },
  terrain: [[4, 420, 0.4], [11, 260, 2.2], [31, 150, 1.3], [89, 80, 3.9], [241, 30, 0.6], [677, 12, 2.8]],
  craters: [53, 140], rocks: true, difficulty: 3,
  blurb: 'Scorched and cratered, deep inside the Sun’s gravity well.',
});

const VENUS = makeBody({
  id: 'venus', name: 'Venus', radius: 290000, surfaceG: 8.9, parent: SUN, orbitRadius: 1.4e8, orbitPhase: 2.6, orbitDir: -1,
  atmoHeight: 55000, rho0: 9, scaleH: 7500,
  colors: { ground: '#8a6a3e', surface: '#c49a5a', deep: '#6a4f2c', sky: '#c99a4a', horizon: '#f0d39a', map: '#e3c27e', halo: '240,205,140', fog: '214,172,104', rock: '#6d5233' },
  terrain: [[6, 500, 1.9], [19, 260, 0.2], [47, 120, 2.7], [131, 50, 1.4], [397, 18, 3.1]],
  haze: true, rocks: true, difficulty: 2,
  blurb: 'Crushing yellow air. Parachutes work beautifully; getting back up does not.',
});

const EARTH = makeBody({
  id: 'earth', name: 'Earth', radius: 315000, surfaceG: 9.8, parent: SUN, orbitRadius: 2.0e8, orbitPhase: -Math.PI / 2, orbitDir: -1,
  atmoHeight: 30000, rho0: 1.2, scaleH: 5200, ocean: true, terrainBase: 40,
  colors: { ground: '#4a6b3c', surface: '#77a152', deep: '#33502b', sky: '#3f8ad4', horizon: '#a9d4f2', map: '#2f6fb7', land: '#4f8a43',
    halo: '93,159,216', water: '#1d5a93', waterTop: '#5aa0d6', sand: '#d2bf8e' },
  terrain: [[6, 120, 0.3], [17, 80, 1.7], [53, 55, 4.1], [149, 35, 2.2], [411, 16, 5.5], [1103, 6, 0.9]],
  padAngle: Math.PI / 2, padHeight: 40, clouds: true, trees: true, difficulty: 0,
  blurb: 'Home. Oceans, clouds and a launch pad.',
});

const MOON = makeBody({
  id: 'moon', name: 'Moon', radius: 90000, surfaceG: 1.62, parent: EARTH, orbitRadius: 6.2e6, orbitPhase: 2.4, orbitDir: -1,
  colors: { ground: '#6e6f73', surface: '#a8a9ad', deep: '#4b4c50', map: '#9a9ba0', rock: '#5c5d61', halo: '0,0,0' },
  terrain: [[5, 520, 0.8], [13, 300, 2.9], [37, 180, 1.1], [97, 110, 4.4], [263, 45, 0.2], [701, 18, 3.3]],
  craters: [41, 90], rocks: true, difficulty: 1,
  blurb: 'Earth’s grey companion. The classic first landing.',
});

const MARS = makeBody({
  id: 'mars', name: 'Mars', radius: 170000, surfaceG: 3.7, parent: SUN, orbitRadius: 3.0e8, orbitPhase: -0.4, orbitDir: -1,
  atmoHeight: 20000, rho0: 0.06, scaleH: 6000,
  colors: { ground: '#8c4a2c', surface: '#c56f43', deep: '#6b3420', sky: '#c99a78', horizon: '#e7c3a0', map: '#c1623a', halo: '220,150,110', rock: '#6e3822' },
  terrain: [[5, 900, 0.5], [11, 500, 2.3], [29, 250, 1.2], [83, 120, 3.6], [227, 50, 0.8], [613, 15, 2.1]],
  craters: [67, 60], rocks: true, caps: true, difficulty: 2,
  blurb: 'Thin air: parachutes slow you, but not enough. Bring engines and legs.',
});

const PHOBOS = makeBody({
  id: 'phobos', name: 'Phobos', radius: 8000, surfaceG: 0.06, parent: MARS, orbitRadius: 1.2e6, orbitPhase: 0.5, orbitDir: -1,
  colors: { ground: '#5b5048', surface: '#857669', deep: '#3f3832', map: '#7a6c60', rock: '#4a413a', halo: '0,0,0' },
  terrain: [[3, 380, 0.2], [7, 200, 1.6], [19, 80, 2.9], [53, 25, 0.7]],
  craters: [11, 120], rocks: true, difficulty: 3,
  blurb: 'A lumpy moonlet with almost no gravity. Land gently or bounce off.',
});

const JUPITER = makeBody({
  id: 'jupiter', name: 'Jupiter', radius: 1.2e6, surfaceG: 12, parent: SUN, orbitRadius: 7.0e8, orbitPhase: 0.9, orbitDir: -1,
  atmoHeight: 250000, rho0: 2, scaleH: 30000,
  colors: { ground: '#7a5a3a', surface: '#b98b5e', deep: '#5a4029', sky: '#c49565', horizon: '#e8c79a', map: '#d2a46f', halo: '230,190,140', fog: '190,140,90' },
  terrain: [[13, 60, 0.4], [41, 25, 1.9]],
  bands: true, haze: true, difficulty: 4,
  blurb: 'A gas giant. Fly by for the view; landing is a one-way trip.',
});

const EUROPA = makeBody({
  id: 'europa', name: 'Europa', radius: 80000, surfaceG: 1.3, parent: JUPITER, orbitRadius: 6.0e6, orbitPhase: 1.7, orbitDir: -1,
  colors: { ground: '#9fb3bf', surface: '#e3eef3', deep: '#7c8f9a', map: '#d8e4ea', rock: '#8ea2ad', halo: '0,0,0' },
  terrain: [[5, 150, 1.0], [17, 60, 2.4], [61, 20, 0.3], [233, 6, 1.7]],
  rocks: true, difficulty: 5,
  blurb: 'An icy moon of Jupiter. The far frontier.',
});

const BODIES = [SUN, MERCURY, VENUS, EARTH, MOON, MARS, PHOBOS, JUPITER, EUROPA];
const BODY_BY_ID = Object.fromEntries(BODIES.map((b) => [b.id, b]));

// Position/velocity of a body relative to its parent.
function childRel(c, t) {
  const a = c.orbitPhase + c.orbitDir * c.n * t;
  return { x: c.orbitRadius * Math.cos(a), y: c.orbitRadius * Math.sin(a) };
}
function childRelVel(c, t) {
  const a = c.orbitPhase + c.orbitDir * c.n * t;
  const s = c.orbitDir * c.orbitSpeed;
  return { x: -s * Math.sin(a), y: s * Math.cos(a) };
}
// Absolute (Sun-centred) position and velocity, cached per body for the latest time asked.
function bodyPos(b, t) {
  if (!b.parent) return ZERO;
  if (b._pt === t) return b._p;
  const pp = bodyPos(b.parent, t), r = childRel(b, t);
  b._p = { x: pp.x + r.x, y: pp.y + r.y };
  b._pt = t;
  return b._p;
}
function bodyVel(b, t) {
  if (!b.parent) return ZERO;
  if (b._vt === t) return b._v;
  const pv = bodyVel(b.parent, t), r = childRelVel(b, t);
  b._v = { x: pv.x + r.x, y: pv.y + r.y };
  b._vt = t;
  return b._v;
}

function terrainHeight(b, ang) {
  let h = b.terrainBase || 0;
  for (const [k, amp, ph] of b.terrain) h += amp * Math.sin(k * ang + ph);
  if (b.craters) h -= b.craters[1] * Math.pow(Math.abs(Math.sin(b.craters[0] * ang + 0.7)), 6);
  if (b.padAngle != null) {
    const d = Math.abs(wrapAngle(ang - b.padAngle));
    h = lerp(b.padHeight, h, smoothstep(0.0007, 0.005, d));
  }
  return h;
}
function surfaceRadius(b, ang) {
  const h = terrainHeight(b, ang);
  return b.radius + (b.ocean && h < 0 ? 0 : h);
}
function waterAt(b, ang) { return !!b.ocean && terrainHeight(b, ang) < 0; }
function surfaceNormal(b, ang) {
  const e = 2e-6;
  const dr = (surfaceRadius(b, ang + e) - surfaceRadius(b, ang - e)) / (2 * e); // metres per radian
  const r = b.radius;
  const cx = Math.cos(ang), cy = Math.sin(ang);
  const nx = cx + (dr / r) * cy, ny = cy - (dr / r) * cx;
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
  // classify by energy: a near-radial ellipse also has e close to 1
  if (energy < 0 && e > 1 - 1e-9) e = o.e = 1 - 1e-9;
  else if (energy >= 0 && e < 1 + 1e-9) e = o.e = 1 + 1e-9;
  o.w = e > 1e-9 ? Math.atan2(ey, ex) : Math.atan2(ry, rx);
  o.nu0 = wrapAngle(o.dir * (Math.atan2(ry, rx) - o.w));
  o.a = Math.abs(energy) > 1e-9 ? -mu / (2 * energy) : p / (1 - e * e);
  o.rp = e < 1 ? o.a * (1 - e) : p / (1 + e);
  o.ra = e < 1 ? o.a * (1 + e) : Infinity;
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

function stateAt(o, dt) { return stateFromNu(o, nuFromMean(o, o.M0 + o.n * dt)); }

// Time from epoch until the orbit reaches true anomaly nu (next occurrence for ellipses).
function timeToNu(o, nu) {
  let dM = meanFromNu(o, nu) - o.M0;
  if (o.e < 1) dM = ((dM % TAU) + TAU) % TAU;
  return dM / o.n;
}

function radiusAtNu(o, nu) { return o.p / (1 + o.e * Math.cos(nu)); }

// True anomaly (outbound, positive) where the orbit crosses radius R; null if never.
function nuAtRadius(o, R) {
  if (o.e < 1e-9) return null;
  const c = (o.p / R - 1) / o.e;
  if (c < -1 || c > 1) return null;
  return Math.acos(c);
}

// Gravity-only velocity-Verlet step (for degenerate, straight-up trajectories).
function gravityStep(s, mu, dt) {
  let r = Math.hypot(s.x, s.y), k = -mu / (r * r * r);
  s.vx += 0.5 * dt * k * s.x; s.vy += 0.5 * dt * k * s.y;
  s.x += dt * s.vx; s.y += dt * s.vy;
  r = Math.hypot(s.x, s.y); k = -mu / (r * r * r);
  s.vx += 0.5 * dt * k * s.x; s.vy += 0.5 * dt * k * s.y;
}

// ---------------------------------------------------------------------------
// Patched-conic prediction. Returns patches: { body, o, t0, tEnd, end, next }

function predictTrajectory(body, st, t0, maxPatches = 4) {
  const patches = [];
  let b = body, s = { x: st.x, y: st.y, vx: st.vx, vy: st.vy }, t = t0;
  for (let k = 0; k < maxPatches; k++) {
    const o = elementsFromState(s.x, s.y, s.vx, s.vy, b.mu);
    const patch = { body: b, o, t0: t, tEnd: Infinity, end: null };
    patches.push(patch);
    if (o.degenerate) { patch.end = 'radial'; break; }

    let best = Infinity, kind = null, next = null;
    if (o.rp < b.radius + b.terrainMax * 0.5) {
      const nuI = nuAtRadius(o, b.radius);
      if (nuI != null) {
        const dt = timeToNu(o, -nuI); // descending crossing
        if (dt >= 0 && dt < best) { best = dt; kind = 'impact'; }
      }
    }
    if (b.parent && (o.e >= 1 || o.ra > b.soi)) {
      const nuE = nuAtRadius(o, b.soi);
      if (nuE != null) {
        const dt = timeToNu(o, nuE);
        if (dt >= 0 && dt < best) { best = dt; kind = 'escape'; }
      }
    }
    if (b.children.length) {
      const horizon = Math.min(best, o.e < 1 ? o.period : 4e6);
      const enc = findEncounter(o, b, t, horizon);
      if (enc && enc.t < best) { best = enc.t; kind = 'encounter'; next = enc.body; }
    }
    patch.tEnd = t + best;
    patch.end = kind;
    patch.next = next;
    if (kind === 'encounter') {
      const sv = stateAt(o, best);
      const cp = childRel(next, t + best), cv = childRelVel(next, t + best);
      s = { x: sv.x - cp.x, y: sv.y - cp.y, vx: sv.vx - cv.x, vy: sv.vy - cv.y };
      b = next; t += best;
    } else if (kind === 'escape') {
      const sv = stateAt(o, best);
      const bp = childRel(b, t + best), bv = childRelVel(b, t + best);
      s = { x: sv.x + bp.x, y: sv.y + bp.y, vx: sv.vx + bv.x, vy: sv.vy + bv.y };
      b = b.parent; t += best;
    } else break;
  }
  return patches;
}

function findEncounter(o, parent, t0, horizon) {
  if (!isFinite(horizon) || horizon <= 0) return null;
  const kids = parent.children.filter((c) => o.ra >= c.orbitRadius - c.soi && o.rp <= c.orbitRadius + c.soi);
  if (!kids.length) return null;
  const vmax = Math.sqrt(parent.mu * Math.max(0, 2 / Math.max(o.rp, 1) - 1 / o.a));
  let dt = horizon / 300;
  for (const c of kids) dt = Math.min(dt, (c.soi * 0.6) / (vmax + c.orbitSpeed));
  const steps = Math.min(5000, Math.ceil(horizon / dt));
  dt = horizon / steps;
  let prev = 0;
  for (let i = 1; i <= steps; i++) {
    const tt = i * dt;
    const s = stateAt(o, tt);
    for (const c of kids) {
      if (Math.abs(s.r - c.orbitRadius) > c.soi) continue;
      const cp = childRel(c, t0 + tt);
      if ((s.x - cp.x) ** 2 + (s.y - cp.y) ** 2 < c.soi * c.soi) {
        let a = prev, b = tt;
        for (let j = 0; j < 32; j++) {
          const mid = (a + b) / 2;
          const sm = stateAt(o, mid), mm = childRel(c, t0 + mid);
          if ((sm.x - mm.x) ** 2 + (sm.y - mm.y) ** 2 < c.soi * c.soi) b = mid; else a = mid;
        }
        return { t: b, body: c };
      }
    }
    prev = tt;
  }
  return null;
}

// Closest approach to a target body along the predicted path (when it is not an encounter).
function closestApproach(patches, target) {
  if (!patches || !target || !target.parent) return null;
  if (patches.some((p) => p.body === target)) return { encounter: true };
  const patch = patches.find((p) => p.body === target.parent && !p.o.degenerate);
  if (!patch) return null;
  const o = patch.o;
  const span = Math.min(patch.tEnd - patch.t0, o.e < 1 ? o.period : 4e6);
  if (!isFinite(span) || span <= 0) return null;
  const N = 600;
  let best = Infinity, bt = 0;
  for (let i = 0; i <= N; i++) {
    const tt = (span * i) / N;
    const s = stateAt(o, tt), c = childRel(target, patch.t0 + tt);
    const d = Math.hypot(s.x - c.x, s.y - c.y);
    if (d < best) { best = d; bt = tt; }
  }
  const s = stateAt(o, bt), c = childRel(target, patch.t0 + bt);
  const origin = bodyPos(target.parent, patch.t0 + bt);
  return { dist: best, t: patch.t0 + bt, pos: { x: origin.x + s.x, y: origin.y + s.y }, tpos: { x: origin.x + c.x, y: origin.y + c.y } };
}

// Hohmann transfer window from a circular orbit of radius r1 (angle ang1, angular rate n1 > 0,
// same direction as the target) to `target`. Returns seconds until the window opens.
function transferWindow(r1, ang1, n1, target, t) {
  const r2 = target.orbitRadius, mu = target.parent.mu;
  const at = (r1 + r2) / 2;
  const T = Math.PI * Math.sqrt(at * at * at / mu);
  const dir = target.orbitDir;
  const lead = wrapAngle(Math.PI - target.n * T); // how far ahead the target must be
  const tp = childRel(target, t);
  const ahead = wrapAngle((Math.atan2(tp.y, tp.x) - ang1) * dir);
  const rel = target.n - n1; // rate of change of `ahead`
  if (Math.abs(rel) < 1e-12) return Infinity;
  let dt = wrapAngle(lead - ahead) / rel;
  const syn = TAU / Math.abs(rel);
  while (dt < 0) dt += syn;
  return { wait: dt, transferTime: T, error: wrapAngle(lead - ahead) };
}

// Rough Δv reference for every body, measured from a low parking orbit around Earth.
function deltaVChart() {
  const lowOrbit = (b) => b.radius + b.warpAlt + 5000;
  const ascent = (b) => {
    const v = Math.sqrt(b.mu / lowOrbit(b));
    return b.atmoHeight ? v * 1.35 + 450 * Math.pow(b.rho0, 0.35) : v * 1.15;
  };
  const transfer = (from, to) => {
    // Hohmann between two bodies orbiting the same parent; Δv as burns from/to low orbits
    const mu = from.parent.mu, r1 = from.orbitRadius, r2 = to.orbitRadius;
    const at = (r1 + r2) / 2;
    const vinf1 = Math.abs(Math.sqrt(mu * (2 / r1 - 1 / at)) - Math.sqrt(mu / r1));
    const vinf2 = Math.abs(Math.sqrt(mu / r2) - Math.sqrt(mu * (2 / r2 - 1 / at)));
    const burn = (b, vinf) => { const r = lowOrbit(b); return Math.sqrt(vinf * vinf + 2 * b.mu / r) - Math.sqrt(b.mu / r); };
    return { depart: burn(from, vinf1), arrive: burn(to, vinf2), time: Math.PI * Math.sqrt(at * at * at / mu) };
  };
  const leoToMoon = (moon) => {
    const p = moon.parent, r1 = lowOrbit(p), r2 = moon.orbitRadius, at = (r1 + r2) / 2;
    const dv1 = Math.sqrt(p.mu * (2 / r1 - 1 / at)) - Math.sqrt(p.mu / r1);
    const vinf = Math.abs(Math.sqrt(p.mu / r2) - Math.sqrt(p.mu * (2 / r2 - 1 / at)));
    const r = lowOrbit(moon);
    return { depart: dv1, arrive: Math.sqrt(vinf * vinf + 2 * moon.mu / r) - Math.sqrt(moon.mu / r), time: Math.PI * Math.sqrt(at * at * at / p.mu) };
  };
  const rows = [];
  for (const b of BODIES) {
    if (b === SUN) continue;
    let travel = 0, time = 0, arrive = 0;
    if (b === EARTH) { travel = 0; }
    else if (b.parent === EARTH) { const x = leoToMoon(b); travel = x.depart; arrive = x.arrive; time = x.time; }
    else if (b.parent === SUN) { const x = transfer(EARTH, b); travel = x.depart; arrive = x.arrive; time = x.time; }
    else {
      const x = transfer(EARTH, b.parent), y = leoToMoon(b);
      travel = x.depart + 0; arrive = x.arrive + y.depart + y.arrive; time = x.time + y.time;
    }
    rows.push({ body: b, ascent: ascent(b), travel, arrive, time, landable: !b.star && b !== JUPITER });
  }
  return rows;
}
