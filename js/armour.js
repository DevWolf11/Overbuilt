'use strict';
// Armour for ground vehicles (the ground update): shells in flight, where they hit, whether they get through
// (thickness, angle, ricochet, overmatch, skirts, ERA), what happens inside (crew, modules, ammunition, fire),
// knock-outs, repairs, HE against armour, and what old weapons do to it.

// ==== SHELLS (data; the catalogue package owns this region) ====
// SHELLS: every round a ground weapon fires, by key (a gun's weapon.shells name them, the first loaded by default).
// type: a SHELL_TYPES key; label: what the HUD calls it (a type of round, never a designation); cal in mm; v0: muzzle
// speed (m/s); pen: mm of armour it goes through at the muzzle, a kinetic round's falling with speed as (v/v0)^1.43 and
// a shaped charge's (heat) the same at any range (high explosive: 0, it has he instead); k: its drag (slowing by
// k·ρ·v² m/s², as combat.js slows bullets); kg; dmg: the damage along its path once through. he: what its burst goes
// through (mm), blast: its radius (m); burst and r: an explosive-filled AP round's burst inside (damage, radius);
// prox: a proximity fuze's reach (m), armed after arm s, gone after life s; tracer: one round in that many glows.
const SHELLS = {
  ap37: { type: 'ap', label: 'AP', cal: 37, v0: 870, pen: 65, k: 10e-5, kg: 0.7, dmg: 140 },
  he37: { type: 'he', label: 'HE', cal: 37, v0: 780, pen: 0, k: 11e-5, kg: 0.7, dmg: 110, he: 7, blast: 1.5 },
  ap50: { type: 'ap', label: 'AP', cal: 50, v0: 835, pen: 90, k: 10e-5, kg: 2.0, dmg: 180 },
  apcr50: { type: 'apcr', label: 'APCR', cal: 50, v0: 1180, pen: 140, k: 16e-5, kg: 0.9, dmg: 160 },
  he50: { type: 'he', label: 'HE', cal: 50, v0: 700, pen: 0, k: 11e-5, kg: 1.8, dmg: 150, he: 9, blast: 2 },
  ap75: { type: 'ap', label: 'AP', cal: 75, v0: 620, pen: 100, k: 10e-5, kg: 6.8, dmg: 260 },
  he75: { type: 'he', label: 'HE', cal: 75, v0: 600, pen: 0, k: 11e-5, kg: 6.0, dmg: 225, he: 14, blast: 3 },
  ap76: { type: 'ap', label: 'AP', cal: 76, v0: 790, pen: 125, k: 10e-5, kg: 7.0, dmg: 260 },
  apcr76: { type: 'apcr', label: 'APCR', cal: 76, v0: 1000, pen: 190, k: 16e-5, kg: 4.2, dmg: 230 },
  he76: { type: 'he', label: 'HE', cal: 76, v0: 680, pen: 0, k: 11e-5, kg: 6.2, dmg: 230, he: 14, blast: 3 },
  aphe85: { type: 'aphe', label: 'APHE', cal: 85, v0: 800, pen: 145, k: 9e-5, kg: 9.2, dmg: 290, burst: 320, r: 1.6 },
  he85: { type: 'he', label: 'HE', cal: 85, v0: 790, pen: 0, k: 11e-5, kg: 9.5, dmg: 255, he: 15, blast: 3.5 },
  aphe88: { type: 'aphe', label: 'APHE', cal: 88, v0: 780, pen: 165, k: 9e-5, kg: 10, dmg: 300, burst: 340, r: 1.6 },
  apcr88: { type: 'apcr', label: 'APCR', cal: 88, v0: 930, pen: 210, k: 16e-5, kg: 7.3, dmg: 260 },
  he88: { type: 'he', label: 'HE', cal: 88, v0: 820, pen: 0, k: 11e-5, kg: 9, dmg: 265, he: 16, blast: 3.5 },
  apds105: { type: 'apds', label: 'APDS', cal: 105, v0: 1430, pen: 300, k: 4.5e-5, kg: 5.8, dmg: 280 },
  heat105: { type: 'heat', label: 'HEAT', cal: 105, v0: 1170, pen: 400, k: 12e-5, kg: 10.4, dmg: 270 },
  hesh105: { type: 'hesh', label: 'HESH', cal: 105, v0: 730, pen: 120, k: 11e-5, kg: 11, dmg: 300, blast: 4 },
  apfsds120: { type: 'apfsds', label: 'APFSDS', cal: 120, v0: 1650, pen: 560, k: 3.0e-5, kg: 4.6, dmg: 320 },
  heat120: { type: 'heat', label: 'HEAT', cal: 120, v0: 1140, pen: 480, k: 12e-5, kg: 13.5, dmg: 300 },
  he120: { type: 'he', label: 'HE', cal: 120, v0: 900, pen: 0, k: 11e-5, kg: 15, dmg: 360, he: 22, blast: 5 },
  apfsds125: { type: 'apfsds', label: 'APFSDS', cal: 125, v0: 1700, pen: 520, k: 3.0e-5, kg: 4.8, dmg: 320 },
  heat125: { type: 'heat', label: 'HEAT', cal: 125, v0: 905, pen: 450, k: 12e-5, kg: 19, dmg: 300 },
  he125: { type: 'he', label: 'HE', cal: 125, v0: 850, pen: 0, k: 11e-5, kg: 23, dmg: 375, he: 23, blast: 5.5 },
  he152: { type: 'he', label: 'HE', cal: 152, v0: 600, pen: 0, k: 10e-5, kg: 40, dmg: 900, he: 60, blast: 7 },
  aphe152: { type: 'aphe', label: 'APHE', cal: 152, v0: 600, pen: 140, k: 9e-5, kg: 49, dmg: 420, burst: 600, r: 3 },
  heat152: { type: 'heat', label: 'HEAT', cal: 152, v0: 700, pen: 300, k: 12e-5, kg: 27, dmg: 380 },
  ap20: { type: 'ap', label: 'AP', cal: 20, v0: 850, pen: 35, k: 11e-5, kg: 0.12, dmg: 40, tracer: 3 },
  hei20: { type: 'hei', label: 'HEI', cal: 20, v0: 850, pen: 0, k: 13e-5, kg: 0.12, dmg: 20, he: 4, blast: 1.5 },
  ap23: { type: 'ap', label: 'AP', cal: 23, v0: 980, pen: 40, k: 11e-5, kg: 0.19, dmg: 40 },
  heit23: { type: 'hei', label: 'HEI', cal: 23, v0: 970, pen: 0, k: 13e-5, kg: 0.19, dmg: 22, he: 5, blast: 1.8 },
  apds30: { type: 'apds', label: 'APDS', cal: 30, v0: 1100, pen: 65, k: 5e-5, kg: 0.3, dmg: 60 },
  hei30: { type: 'hei', label: 'HEI', cal: 30, v0: 960, pen: 0, k: 13e-5, kg: 0.4, dmg: 30, he: 6, blast: 2 },
  hevt35: { type: 'hevt', label: 'HE-VT', cal: 35, v0: 1175, pen: 0, k: 12e-5, kg: 0.55, dmg: 60, he: 6, blast: 3.5, prox: 4, arm: 0.4, life: 6 },
  apds35: { type: 'apds', label: 'APDS', cal: 35, v0: 1385, pen: 80, k: 4.5e-5, kg: 0.38, dmg: 70 },
  ball8: { type: 'ball', label: 'Ball', cal: 7.6, v0: 850, pen: 10, k: 12e-5, kg: 0.01, dmg: 9 },
  ball13: { type: 'ball', label: 'Ball', cal: 12.7, v0: 890, pen: 22, k: 11e-5, kg: 0.05, dmg: 16 },
};
// How each type meets a plate. ric: the angle from the plate's normal (°) over which ricochet goes from never to
// certain (a shaped charge's fuze fails there instead; past a squash head's, it slips off); norm: how far the round
// turns into the plate (°); L: how far it carries on inside (m); n and cone: the fragments it throws off the plate's
// back (how many, and the cone's half-angle in °). blind: a squash head treats any plate up to this angle as flat.
// fuse: how far past the plate an explosive-filled AP round bursts (m). High explosive bursts where it hits.
const SHELL_TYPES = {
  ap: { ric: [65, 75], norm: 5, L: 3.0, n: 8, cone: 22 },
  aphe: { ric: [63, 73], norm: 5, L: 3.0, n: 4, cone: 18, fuse: 1.2 },
  apcr: { ric: [61, 71], norm: 2, L: 2.0, n: 6, cone: 16 },
  apds: { ric: [70, 80], norm: 2, L: 3.5, n: 10, cone: 16 },
  apfsds: { ric: [73, 83], norm: 2, L: 4.5, n: 12, cone: 14 },
  heat: { ric: [75, 85], norm: 0, L: 1.8, n: 6, cone: 10 },
  hesh: { ric: [60, 70], norm: 0, L: 0, n: 12, cone: 35, blind: 60 },
  he: { ric: [80, 90], norm: 0, L: 0, n: 0, cone: 0 },
  hei: { ric: [80, 90], norm: 0, L: 0, n: 0, cone: 0 },
  hevt: { ric: [80, 90], norm: 0, L: 0, n: 0, cone: 0 },
  ball: { ric: [55, 65], norm: 0, L: 1.0, n: 0, cone: 0 }, // (a bullet through an open top or a thin side: what it meets in its next metre, no fragments)
};
// ==== end of SHELLS ====



// ==== Armour (the systems) ====
// A shell flies in moveShell. Where it meets a vessel, hitAll finds every part along its way, each by its own shape (an
// outline extruded across its depth, a round part as an upright cylinder, an old part as its box) with the turrets
// turned and the barrels raised as they are; resolve works out what that shell does there (each plate by its face and
// angle, ricochets, overmatch, skirts, slats, reactive bricks, the way in, and what it wrecks inside: crew, engine,
// ammunition, fuel), without touching anything; apply hands the result to Combat.damage, or to the vessel's owner over
// the network. The rest is what modules do when they break (broken, not gone), the crew (roles, who takes over a seat,
// when too few are left: knocked out), ammunition that cooks off, fires, repairs while stopped, HE against plates
// (blastK) and old weapons against armour (legacyHit). Rows: [part, dmg]; mods: [host part, module index, dmg].
const Armour = (() => {
  const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z), RAD = Math.PI / 180;
  const KIN = { ap: 1, aphe: 1, apcr: 1, apds: 1, apfsds: 1, ball: 1 }, BURST = { he: 1, hei: 1, hevt: 1 };
  const EZ = -1, ESIDE = -2, ETOP = -3, EBOT = -4, EBOX = -5; // (faces that aren't outline edges: the sides across, a round part's wall and caps, an old part's box)
  const FIRE_ODDS = { petrol: 0.35, diesel: 0.12, turbine: 0.2 };
  const REPAIR_T = { track: 8, wheel: 6, breech: 12, ring: 12, radar: 12, sight: 10, launcher: 12, engine: 15 };
  const WHAT = { track: 'TRACK', wheel: 'WHEEL', engine: 'ENGINE', breech: 'GUN', ring: 'RING', radar: 'RADAR', sight: 'SIGHT', launcher: 'LAUNCHER', crew: 'CREW', ammo: 'AMMO', fuel: 'FUEL', troops: 'TROOPS' };
  const ROLE = { driver: 'Driver', gunner: 'Gunner', commander: 'Commander', loader: 'Loader', radio: 'Radio operator' };
  const SWAP = ['loader', 'radio', 'commander']; // (who takes a dead driver's or gunner's seat, in this order)
  const fb = { shot: null, hurt: [], ko: null }; // what the HUD shows: the shooter's result, where hits came from, knock-outs
  // random numbers that come out the same for the same shot on the same vessel (the shooter's), and the victim's own
  // (xorshift32: rs the shooter's, vs the victim's)
  let rs = 1, vs = ((Math.random() * 4294967296) | 0) || 7;
  const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };
  const vrnd = () => { vs ^= vs << 13; vs ^= vs >>> 17; vs ^= vs << 5; return (vs >>> 0) / 4294967296; };
  const mix = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return (n ^ (n >>> 16)) || 1; };
  let serial = 0;
  const ours = (o) => !!o && !!o.parts && !o.remote && !o.ai; // (as combat.js's)
  const mpOn = () => typeof MP !== 'undefined';
  const simTime = (F) => (F && F.time) || 0;
  const LA = v3(), LB = v3(), PA = v3(), PB = v3(), T1 = v3(), NW = v3(), N1 = v3(), GA = [], GB = [], GG = [];
  let gn = 0;

  // ---------------------------------------------------------------- frames
  // sim (body-relative) -> part space, as Vessel.toLocal but into o
  function inPart(v, P, o) {
    const q = v.q, c = v.com, x = P.x - v.x, y = P.y - v.y, z = P.z - v.z;
    const tx = 2 * (q.z * y - q.y * z), ty = 2 * (q.x * z - q.z * x), tz = 2 * (q.y * x - q.x * y);
    o.x = x + q.w * tx - q.y * tz + q.z * ty + c.x; o.y = y + q.w * ty - q.z * tx + q.x * tz + c.y; o.z = z + q.w * tz - q.x * ty + q.y * tx + (c.z || 0);
    return o;
  }
  function outPart(v, P, o) { qrot(v.q, P.x - v.com.x, P.y - v.com.y, P.z - (v.com.z || 0), o); o.x += v.x; o.y += v.y; o.z += v.z; return o; }
  // an aimed part (a gun, a launcher, a tracking dish: not a ring, whose yaw is its group's) raised or swung off its build pose
  const aimedOff = (p) => !!p.def.aim && !p.def.ring && !!(p.aimEl || p.aimYaw);
  const pivotY = (p) => -p.def.h / 2 + (p.def.aim.pivot ?? 0.5) * p.def.h;
  // part space at the build pose -> p's own frame (in place): about its centre, its quarter turns undone and an aimed
  // part's own yaw and elevation undone about its trunnion (Aim's pose: the barrel along +y is Rx(yaw)·Rz(el))
  function own(p, o, zc = partZ(p)) {
    let x = o.x - p.x, y = o.y - p.y;
    for (let k = p.rot & 3; k > 0; k--) { const t = x; x = y; y = -t; }
    let z = o.z - zc;
    if (aimedOff(p)) {
      const ty = pivotY(p), cy = Math.cos(p.aimYaw || 0), sy = Math.sin(p.aimYaw || 0), ce = Math.cos(p.aimEl || 0), se = Math.sin(p.aimEl || 0);
      y -= ty;
      const y1 = y * cy + z * sy; z = -y * sy + z * cy;
      const x2 = x * ce + y1 * se; y = -x * se + y1 * ce + ty; x = x2;
    }
    o.x = x; o.y = y; o.z = z;
    return o;
  }
  // a direction in p's own frame (a face's normal) -> the sim's axes, with its aim, turns and turret groups as they are
  function ownOut(v, p, n, o) {
    let x = n.x, y = n.y, z = n.z;
    if (aimedOff(p)) {
      const cy = Math.cos(p.aimYaw || 0), sy = Math.sin(p.aimYaw || 0), ce = Math.cos(p.aimEl || 0), se = Math.sin(p.aimEl || 0);
      const x1 = x * ce - y * se, y1 = x * se + y * ce;
      x = x1; y = y1 * cy - z * sy; z = y1 * sy + z * cy;
    }
    for (let k = p.rot & 3; k > 0; k--) { const t = x; x = -y; y = t; }
    return groupOut(v, p, x, y, z, o);
  }
  function groupOut(v, p, x, y, z, o) {
    for (let g = v.tgOf && v.tgOf.get(p.id); g; g = g.parent) {
      const a = g.ring.aimYaw || 0;
      if (a) { const c = Math.cos(a), s = Math.sin(a), t = x; x = t * c - z * s; z = t * s + z * c; }
    }
    return qrot(v.q, x, y, z, o);
  }
  // a sim point -> p's own frame
  function simOwn(v, p, P, o) { inPart(v, P, o); if (v.tgOf && v.tgOf.has(p.id)) Aim.unpose(v, p, o, o); return p.def.gv ? own(p, o) : o; }
  // A vessel's parts as hit geometry, looked up once per parts list (v._arm): each part's def, depth, shape, turret
  // group, trunnion and whether the way in and fragments can meet it (cand) as a part (part) or by its modules.
  function recsOf(v) {
    const A = v._arm;
    if (A && A.parts === v.parts && A.n === v.parts.length && A.tg === v.tgOf) return A.list;
    const list = v.parts.map((p) => {
      const d = p.def, gv = !!d.gv, part = gv && !!(d.inner || d.module === 'breech' || d.module === 'ring');
      return { p, d, gv, zc: partZ(p), G: gv ? geo(d) : null, round: !!d.round, aim: !!d.aim && !d.ring, ty: d.aim ? -d.h / 2 + (d.aim.pivot ?? 0.5) * d.h : 0,
        rot: p.rot & 3, g: (v.tgOf && v.tgOf.get(p.id)) || null, part, cand: part || (gv && !!d.mods) };
    });
    v._arm = { parts: v.parts, n: v.parts.length, tg: v.tgOf, list };
    return list;
  }
  // a sim point -> a record's part's own frame (as simOwn), and a sim direction (rotation only); the turns' sines and
  // cosines kept while the angles stay
  function recOwn(v, r, P, o) { inPart(v, P, o); if (r.g) unturn(r.g, o, true); return r.gv ? ownR(r, o, true) : o; }
  function recDir(r, o) { if (r.g) unturn(r.g, o, false); return r.gv ? ownR(r, o, false) : o; }
  const YAW = new WeakMap();
  function unturn(g, o, point) { // (as aimUnturn: the outer group's turn undone first)
    if (g.parent) unturn(g.parent, o, point);
    const a = g.ring.aimYaw || 0;
    let Y = YAW.get(g);
    if (!Y) YAW.set(g, (Y = { a: NaN, c: 1, s: 0 }));
    if (Y.a !== a) { Y.a = a; Y.c = Math.cos(a); Y.s = Math.sin(a); }
    const cx = point ? g.c.x : 0, cz = point ? g.c.z : 0, x = o.x - cx, z = o.z - cz;
    o.x = cx + x * Y.c + z * Y.s; o.z = cz - x * Y.s + z * Y.c;
  }
  function ownR(r, o, point) {
    const p = r.p;
    let x = point ? o.x - p.x : o.x, y = point ? o.y - p.y : o.y, z = point ? o.z - r.zc : o.z;
    for (let k = r.rot; k > 0; k--) { const t = x; x = y; y = -t; }
    if (r.aim && (p.aimEl || p.aimYaw)) {
      if (r.ae !== p.aimEl || r.ay !== p.aimYaw) { r.ae = p.aimEl; r.ay = p.aimYaw; r.ce = Math.cos(p.aimEl || 0); r.se = Math.sin(p.aimEl || 0); r.cy = Math.cos(p.aimYaw || 0); r.sy = Math.sin(p.aimYaw || 0); }
      const ty = point ? r.ty : 0;
      y -= ty;
      const y1 = y * r.cy + z * r.sy; z = -y * r.sy + z * r.cy;
      const x2 = x * r.ce + y1 * r.se; y = -x * r.se + y1 * r.ce + ty; x = x2;
    }
    o.x = x; o.y = y; o.z = z;
    return o;
  }

  // ---------------------------------------------------------------- hit geometry
  // the segment a -> e, in part space (LA, LB) and in each turret group's build pose (GA, GB: unposed once per group)
  function ray(v, a, e) { inPart(v, a, LA); inPart(v, e, LB); gn = 0; }
  function rayOf(v, g) {
    if (!g) return -1;
    for (let i = 0; i < gn; i++) if (GG[i] === g) return i;
    if (!GA[gn]) { GA[gn] = v3(); GB[gn] = v3(); }
    const a = GA[gn], b = GB[gn];
    a.x = LA.x; a.y = LA.y; a.z = LA.z; b.x = LB.x; b.y = LB.y; b.z = LB.z;
    unturn(g, a, true); unturn(g, b, true); GG[gn] = g;
    return gn++;
  }
  const rec = () => ({ p: null, t0: 0, t1: 0, n: v3(), edge: 0, n1: v3(), edge1: 0, u: 0, u1: 0, box: false });
  // A part's shape in its own frame, worked out once per def: its outline's edge planes in metres (outward normal nx,
  // ny, and c = n·(a point on it)), half its depth, its bounding radius; a round one's radius, half-height and slope.
  const GEO = new Map();
  function geo(d) {
    let G = GEO.get(d);
    if (G) return G;
    const o = d.outline || BOX_OUTLINE, m = o.length, w = d.w, h = d.h, nx = [], ny = [], c = [];
    for (let i = 0; i < m; i++) { const P = o[i], Q = o[(i + 1) % m]; nx[i] = (Q[1] - P[1]) * h; ny[i] = (P[0] - Q[0]) * w; c[i] = nx[i] * P[0] * w + ny[i] * P[1] * h; }
    const dp = partDepth({ def: d });
    G = { m, nx, ny, c, hd: dp / 2, R: 0.5 * Math.hypot(w, h, dp) + 0.05, r: w / 2, hh: h / 2, sl: ((d.round && d.round.slope) || 0) * RAD };
    GEO.set(d, G);
    return G;
  }
  // A prism: the outline (counter-clockwise, fractions of w and h) across the part's depth. Cyrus-Beck: the entering
  // face is the plane that set t0 (an outline edge, or a side across), the far face the one that set t1.
  function prism(p, A, B, H) {
    const G = geo(p.def), m = G.m, NX = G.nx, NY = G.ny, C = G.c, hd = G.hd;
    const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
    let t0 = -Infinity, t1 = Infinity, e0 = EZ, e1 = EZ, n0x = 0, n0y = 0, n0z = 0, n1x = 0, n1y = 0, n1z = 0;
    if (dz * dz < 1e-18) { if (A.z < -hd || A.z > hd) return false; }
    else if (dz > 0) { t0 = (-hd - A.z) / dz; t1 = (hd - A.z) / dz; n0z = -1; n1z = 1; }
    else { t0 = (hd - A.z) / dz; t1 = (-hd - A.z) / dz; n0z = 1; n1z = -1; }
    for (let i = 0; i < m; i++) {
      const nx = NX[i], ny = NY[i], num = C[i] - nx * A.x - ny * A.y, den = nx * dx + ny * dy;
      if (den * den < 1e-24) { if (num < 0) return false; continue; }
      const t = num / den;
      if (den < 0) { if (t > t0) { t0 = t; e0 = i; n0x = nx; n0y = ny; n0z = 0; } }
      else if (t < t1) { t1 = t; e1 = i; n1x = nx; n1y = ny; n1z = 0; }
      if (t0 > t1) return false;
    }
    if (t1 < 0 || t0 > 1) return false;
    let l = Math.hypot(n0x, n0y, n0z) || 1;
    H.t0 = t0; H.t1 = t1; H.edge = e0; H.n.x = n0x / l; H.n.y = n0y / l; H.n.z = n0z / l;
    l = Math.hypot(n1x, n1y, n1z) || 1;
    H.edge1 = e1; H.n1.x = n1x / l; H.n1.y = n1y / l; H.n1.z = n1z / l; H.box = false;
    return true;
  }
  // A round part: an upright cylinder (radius w/2, height h) with its caps. Its wall's normal is radial, tilted up by
  // round.slope (a cast turret's sides lean in); u: the cosine of the bearing from its front (+x), for the thickness.
  function cyl(p, A, B, H) {
    const G = geo(p.def), r = G.r, hh = G.hh, dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
    let t0 = -Infinity, t1 = Infinity, e0 = ESIDE, e1 = ESIDE;
    const a = dx * dx + dz * dz, bq = A.x * dx + A.z * dz, c = A.x * A.x + A.z * A.z - r * r;
    if (a < 1e-18) { if (c > 0) return false; }
    else { const D = bq * bq - a * c; if (D < 0) return false; const sq = Math.sqrt(D); t0 = (-bq - sq) / a; t1 = (-bq + sq) / a; }
    if (dy * dy < 1e-18) { if (A.y < -hh || A.y > hh) return false; }
    else {
      let ta = (-hh - A.y) / dy, tb = (hh - A.y) / dy, ea = EBOT, eb = ETOP;
      if (dy < 0) { const t = ta; ta = tb; tb = t; ea = ETOP; eb = EBOT; }
      if (ta > t0) { t0 = ta; e0 = ea; }
      if (tb < t1) { t1 = tb; e1 = eb; }
    }
    if (t0 > t1 || t1 < 0 || t0 > 1) return false;
    const sl = G.sl;
    H.t0 = t0; H.t1 = t1; H.edge = e0; H.edge1 = e1; H.u = cylFace(A, dx, dz, t0, e0, H.n, sl); H.u1 = cylFace(A, dx, dz, t1, e1, H.n1, sl); H.box = false;
    return true;
  }
  // a round part's face normal where the ray meets it (n), and the cosine of its bearing from the front
  function cylFace(A, dx, dz, t, e, n, sl) {
    if (e !== ESIDE) { n.x = 0; n.y = e === ETOP ? 1 : -1; n.z = 0; return 1; }
    const x = A.x + dx * t, z = A.z + dz * t, l = Math.hypot(x, z) || 1, cs = Math.cos(sl);
    n.x = (cs * x) / l; n.y = Math.sin(sl); n.z = (cs * z) / l;
    return x / l;
  }
  // An old part (no def.gv: a technical's cab, an old turret) on a plated vessel: the boxes combat.js hits it by, in
  // part space (segBox, with the entry face's axis kept)
  function oldBoxes(p, A, B, H) {
    const d = p.def, odd = p.rot & 1, w = odd ? d.h : d.w, h = odd ? d.w : d.h, hz = d.twinZ ? Math.max(d.w, 0.6) / 2 : d.wheel ? (d.wheel.track || 0) / 2 + 0.3 : partDepth(p) / 2;
    const z = partZ(p), zs = d.twinZ ? 2 : 1;
    let got = false;
    for (let c = 0; c < zs; c++) {
      const zc = d.twinZ ? (c ? z : -z) : z, lo = [p.x - w / 2, p.y - h / 2, zc - hz], hi = [p.x + w / 2, p.y + h / 2, zc + hz];
      let t0 = -Infinity, t1 = Infinity, ax = 0, sg = 0, bx = 0, bs = 0, miss = false;
      for (let i = 0; i < 3 && !miss; i++) {
        const a0 = i === 0 ? A.x : i === 1 ? A.y : A.z, dd = (i === 0 ? B.x : i === 1 ? B.y : B.z) - a0;
        if (dd * dd < 1e-18) { if (a0 < lo[i] || a0 > hi[i]) miss = true; continue; }
        let ta = (lo[i] - a0) / dd, tb = (hi[i] - a0) / dd, sa = -1, sb = 1;
        if (ta > tb) { const t = ta; ta = tb; tb = t; sa = 1; sb = -1; }
        if (ta > t0) { t0 = ta; ax = i; sg = sa; }
        if (tb < t1) { t1 = tb; bx = i; bs = sb; }
        if (t0 > t1) miss = true;
      }
      if (miss || t1 < 0 || t0 > 1 || (got && t0 >= H.t0)) continue;
      got = true;
      H.t0 = t0; H.t1 = t1; H.edge = H.edge1 = EBOX; H.box = true;
      H.n.x = ax === 0 ? sg : 0; H.n.y = ax === 1 ? sg : 0; H.n.z = ax === 2 ? sg : 0;
      H.n1.x = bx === 0 ? bs : 0; H.n1.y = bx === 1 ? bs : 0; H.n1.z = bx === 2 ? bs : 0;
    }
    return got;
  }
  // the prepared ray against one part
  function test(v, r, H) {
    const p = r.p, k = rayOf(v, r.g), A = k < 0 ? LA : GA[k], B = k < 0 ? LB : GB[k];
    if (!r.gv) return oldBoxes(p, A, B, H);
    // (first its bounding sphere, at the build pose: about its centre, or a raised barrel's about its trunnion)
    let cx = p.x, cy = p.y, R = r.G.R;
    if (r.aim && (p.aimEl || p.aimYaw)) { const ty = r.ty, k3 = r.rot; cx += k3 === 1 ? -ty : k3 === 3 ? ty : 0; cy += k3 === 0 ? ty : k3 === 2 ? -ty : 0; R += Math.abs(ty); }
    if (segD2(A, B, cx, cy, r.zc) > R * R) return false;
    PA.x = A.x; PA.y = A.y; PA.z = A.z; PB.x = B.x; PB.y = B.y; PB.z = B.z;
    ownR(r, PA, true); ownR(r, PB, true);
    return r.round ? cyl(p, PA, PB, H) : prism(p, PA, PB, H);
  }
  // the squared distance from (x, y, z) to the segment A -> B
  function segD2(A, B, x, y, z) {
    const ex = B.x - A.x, ey = B.y - A.y, ez = B.z - A.z, l2 = ex * ex + ey * ey + ez * ez;
    const t = l2 > 0 ? clamp(((x - A.x) * ex + (y - A.y) * ey + (z - A.z) * ez) / l2, 0, 1) : 0, qx = A.x + ex * t - x, qy = A.y + ey * t - y, qz = A.z + ez * t - z;
    return qx * qx + qy * qy + qz * qz;
  }
  // Every part the segment a -> e (sim, body-relative) crosses, sorted by where it goes in: [{ p, t0, t1, n (its own
  // frame's entering normal), edge, n1, edge1 (the far face) }], in out (its entries are out's own, reused); out.a, out.e
  // and out.L keep the segment. A hit with t0 < 0 is one the segment starts inside.
  function hitAll(v, a, e, out) {
    out = out || [];
    const pool = out._pool || (out._pool = []);
    out.length = 0;
    out.a = out.a || v3(); out.e = out.e || v3();
    out.a.x = a.x; out.a.y = a.y; out.a.z = a.z; out.e.x = e.x; out.e.y = e.y; out.e.z = e.z;
    const ex = e.x - a.x, ey = e.y - a.y, ez = e.z - a.z, l2 = ex * ex + ey * ey + ez * ez;
    out.L = Math.sqrt(l2);
    if (!(l2 > 1e-12) || !v.parts.length) return out;
    const t = clamp(((v.x - a.x) * ex + (v.y - a.y) * ey + (v.z - a.z) * ez) / l2, 0, 1);
    if (len(a.x + ex * t - v.x, a.y + ey * t - v.y, a.z + ez * t - v.z) > (v.reach || 10) + 3) return out; // (as hitVessel, a little wider for a turned turret)
    ray(v, a, e);
    for (const r of recsOf(v)) {
      const H = pool[out.length] || (pool[out.length] = rec());
      if (test(v, r, H)) { H.p = r.p; out.push(H); }
    }
    for (let i = 1; i < out.length; i++) { const H = out[i]; let j = i - 1; while (j >= 0 && out[j].t0 > H.t0) { out[j + 1] = out[j]; j--; } out[j + 1] = H; }
    return out;
  }
  const FIRST = [];
  // The first part along a -> e and where ({ p, t }, as hitVessel; old weapons against a plated vessel use it)
  function hitFirst(v, a, e) {
    const hs = hitAll(v, a, e, FIRST);
    let best = null, bt = 2;
    for (const H of hs) { const t = Math.max(0, H.t0); if (t < bt) { bt = t; best = H.p; } }
    return best ? { p: best, t: bt } : null;
  }

  // ---------------------------------------------------------------- plates
  // A plate's thickness where hit H went in (mm; 0: an open face, as an open roof): the nominal mm (the player's p.mm)
  // times the face's share (an outline edge's, the sides', a round part's by bearing or its roof's)
  function faceMm(p, edge, u) {
    const A = p.def.armour;
    if (!A) return 0;
    const mm = p.mm ?? A.mm;
    if (edge >= 0) return A.open && A.open.includes(edge) ? 0 : mm * (A.edge ? A.edge[edge] ?? 1 : 1);
    if (edge === EZ) return mm * (A.z ?? 1);
    const R = A.round;
    if (!R) return mm;
    if (edge === ESIDE) { const c2 = u * u; return mm * ((u >= 0 ? R.f ?? 1 : R.r ?? 1) * c2 + (R.s ?? 1) * (1 - c2)); }
    return mm * (R.t ?? 1);
  }
  // a kinetic round's penetration now: pen·(v/v0)^1.43 (its own pen and v0, else its shell's)
  const penAt = (s, spd) => { const S = s.legacy || SHELLS[s.sh] || {}; return (s.pen ?? S.pen ?? 0) * Math.pow(spd / (s.v0 || S.v0 || spd || 1), 1.43); };
  // [effective thickness, the angle it is taken at (°), overmatched]: t/cos θ' (at most 6t), θ' the angle less the round's
  // normalisation (and ×0.6 when its calibre is three times the plate's); a shaped charge meets composite's own strength
  function effOf(t, th, SH, T, heatK) {
    const kin = !!KIN[SH.type], over = kin && t > 0 && SH.cal >= 3 * t;
    let a = kin ? Math.max(0, th - (T.norm || 0)) : th;
    if (SH.type === 'hesh' && th <= (T.blind || 0)) a = 0;
    if (over) a *= 0.6;
    const e = t <= 0 ? 0 : Math.min(t / Math.max(Math.cos(a * RAD), 1e-6), 6 * t) * (SH.type === 'heat' ? heatK || 1 : 1);
    EFF[0] = e; EFF[1] = a; EFF[2] = over;
    return EFF;
  }
  const EFF = [0, 0, false];

  // ---------------------------------------------------------------- crew and stores (§3.3)
  // Who is aboard and where the rounds are, per host part: its built-in crew and ammunition modules, unless a placed
  // seat (for crew) or rack (for ammunition) hangs on it, which take over from them. Fuel and troops always stay.
  function crewList(parts) {
    const byId = new Map(parts.map((p) => [p.id, p])), seated = new Set(), racked = new Set();
    for (const p of parts) { if (p.def.seat && p.att != null) seated.add(p.att); if ((p.def.rack || p.def.autoload) && p.att != null) racked.add(p.att); }
    const C = { crew: [], stores: [], off: new Map(), old: [], n: parts.length, anchor: null };
    for (const p of parts) {
      const d = p.def;
      if (!d.gv && d.control) C.old.push(p); // (an old cab or cockpit: its crew does every job)
      if (d.module && !C.anchor) C.anchor = p;
      if (d.mods) {
        const off = [];
        d.mods.forEach((m, i) => {
          off[i] = (m.k === 'crew' && seated.has(p.id)) || (m.k === 'ammo' && racked.has(p.id));
          if (off[i]) return;
          if (m.k === 'crew') C.crew.push({ host: p, i, part: null, role: (p.roles && p.roles[i]) || m.role, base: m.role, also: m.also, alive: true });
          else if (m.k === 'ammo') C.stores.push(store(p, i, null, m.rounds || 0, m.cook ?? 1, !!m.blowout, m.autoload || 0));
        });
        if (off.some(Boolean)) C.off.set(p.id, off);
      }
      if (d.seat) C.crew.push({ host: byId.get(p.att) || p, i: -1, part: p, role: p.role || d.seat, base: d.seat, also: null, alive: true });
      if (d.rack) C.stores.push(store(byId.get(p.att) || p, -1, p, d.rack.rounds || 0, d.rack.cook ?? 1, false, d.autoload || 0));
    }
    return C;
  }
  // a store's rounds live on its part (a rack's p.rounds; a built-in store's in its host's p.mrounds[i]), so they
  // outlast the list
  function store(host, i, part, cap, cook, blowout, autoload) {
    return { host, i, part, cap, cook, blowout, autoload,
      get rounds() { const r = i >= 0 ? host.mrounds && host.mrounds[i] : part.rounds; return r == null ? cap : r; },
      set rounds(n) { const r = Math.max(0, Math.round(+n || 0)); if (i >= 0) (host.mrounds || (host.mrounds = []))[i] = r; else part.rounds = r; } };
  }
  const modHp = (host, i) => (host.mods && host.mods[i] != null ? host.mods[i] : host.def.mods[i].hp || 100);
  const partHp = (p) => (p.hp == null ? Combat.maxHp(p.def) : p.hp);
  function crewOf(v) {
    let C = v.crewCache;
    if (!C || C.n !== v.parts.length) C = v.crewCache = crewList(v.parts);
    for (const e of C.crew) e.alive = e.i >= 0 ? modHp(e.host, e.i) > 0 : !e.part.broken;
    return C;
  }
  const offOf = (v, host) => crewOf(v).off.get(host.id);
  // Is someone aboard doing this job (driver, gunner, commander, loader)? Old craft, and any vessel with an old cab or
  // cockpit, always have; a knocked-out one never.
  function has(v, role) {
    if (!v || !v.gv || !v.parts) return true;
    if (v.ko) return false;
    const C = crewOf(v);
    if (C.old.some((p) => !p.ko)) return true;
    for (const e of C.crew) if (e.alive && (e.role === role || e.also === role)) return true;
    return false;
  }

  // ---------------------------------------------------------------- what a shell does (§6.3)
  const CAND = [], EV = [];
  const at3 = (hs, t) => ({ x: hs.a.x + (hs.e.x - hs.a.x) * t, y: hs.a.y + (hs.e.y - hs.a.y) * t, z: hs.a.z + (hs.e.z - hs.a.z) * t });
  function add(rows, p, k) { if (!(k > 0)) return; for (const r of rows) if (r[0] === p) { r[1] += k; return; } rows.push([p, k]); }
  function addMod(mods, h, i, k) { if (!(k > 0)) return; for (const r of mods) if (r[0] === h && r[1] === i) { r[2] += k; return; } mods.push([h, i, k]); }
  function what(R, w) { if (w && !R.what.includes(w)) R.what.push(w); }
  const whatOf = (d) => (d.module ? WHAT[d.module] : d.inner && d.engine ? 'ENGINE' : null);
  // s: the shell (or legacyHit's stand-in for an old round), v: the vessel, hits: hitAll's from just outside v along the
  // shell's way. Returns { r: 'ric' | 'nopen' | 'pen' | 'hit' | 'miss', rows, mods, at, what, crew, ric (the bounced
  // round, a new shell), burst ({ at, blast, dmg, he }: high explosive goes off there), go (it flies on: through an old
  // craft), pen (what it has left), k (the hit message's kind), hot (HEAT, APHE or HE: ammunition it reaches cooks off
  // more easily) }. Nothing happens to v yet: apply does it.
  function resolve(s, v, hits, F) {
    const SH = s.legacy || SHELLS[s.sh], T = SHELL_TYPES[SH.type] || SHELL_TYPES.ap, ty = SH.type, kin = !!KIN[ty], heat = ty === 'heat', hesh = ty === 'hesh';
    const boom = !!BURST[ty] || hesh, dmg = SH.dmg || 0, plated = v.plated;
    const R = { r: 'miss', rows: [], mods: [], at: null, what: [], crew: 0, ric: null, burst: null, go: false, pen: 0, k: 'shot', hot: heat || ty === 'aphe' || !!BURST[ty] };
    if (s.n == null) s.n = ++serial;
    rs = mix(Math.imul((s.n | 0) + 1, 2654435761) ^ Math.imul(((v.parts[0] && v.parts[0].id) | 0) + 7, 40503));
    const spd = len(s.vx, s.vy, s.vz) || 1, dx = s.vx / spd, dy = s.vy / spd, dz = s.vz / spd;
    let pen = kin ? penAt(s, spd) : s.pen ?? SH.pen ?? 0, jet = null, tandem = !!(s.tandem || SH.tandem), plate = null;
    const used = [];
    for (const h of hits) {
      if (h.t0 < -1e-6) continue; // (the ray starts just outside the vessel: one it starts in it is already past)
      const p = h.p, D = p.def, A = D.armour;
      if (used.includes(p)) continue;
      const at = at3(hits, Math.max(0, h.t0));
      if (!R.at) R.at = at;
      if (heat && jet) { pen -= 250 * len(at.x - jet.x, at.y - jet.y, at.z - jet.z); jet = at; if (pen <= 0) { R.r = R.r === 'miss' ? 'nopen' : R.r; R.k = 'np'; break; } } // (a jet weakens 250 mm a metre in the open)
      if (!plated || (!A && !D.era)) { // unarmoured (0 mm): the shell's whole damage, as a bullet's today
        if (boom) { R.burst = { at, blast: SH.blast || 1, dmg: hesh ? dmg * 0.5 : dmg, he: SH.he }; R.r = 'hit'; what(R, whatOf(D)); break; }
        add(R.rows, p, dmg); R.r = 'hit'; what(R, whatOf(D));
        if (heat) { if (!plated) break; jet = at3(hits, h.t1); continue; } // (it goes off on whatever it touches first; the jet goes on from its far side)
        pen -= 10;
        if (pen <= 0) break;
        continue;
      }
      if (D.era) { // a reactive brick: it blows off what meets it (a tandem charge's first one is set off by its precursor)
        used.push(p);
        if (boom) { R.burst = { at, blast: SH.blast || 1, dmg, he: SH.he }; R.r = 'hit'; break; }
        if (!heat && (SH.cal || 0) < 20 && pen < 30) { add(R.rows, p, dmg); R.r = 'nopen'; R.k = 'np'; break; } // (a machine-gun bullet doesn't set it off: it chips it, and stops)
        if (heat && tandem) tandem = false; else pen -= heat ? D.era.ce || 0 : D.era.ke || 0;
        add(R.rows, p, Combat.maxHp(D)); what(R, 'ERA');
        if (heat) jet = at3(hits, h.t1);
        if (pen <= 0) { R.r = 'nopen'; R.k = 'np'; break; }
        continue;
      }
      const t = faceMm(p, h.edge, h.u), n = h.box ? groupOut(v, p, h.n.x, h.n.y, h.n.z, NW) : ownOut(v, p, h.n, NW);
      const th = Math.acos(clamp(Math.abs(dx * n.x + dy * n.y + dz * n.z), 0, 1)) / RAD, E = effOf(t, th, SH, T, A.heat), eff = E[0], thn = E[1], over = E[2];
      if (D.slat || D.spaced || A.slab) { // screens: a slat cage, skirts, an applique plate
        if (boom) { R.burst = { at, blast: SH.blast || 1, dmg, he: SH.he }; R.r = 'hit'; break; }
        if (heat && !jet) {
          if (D.slat && !tandem && rnd() < D.slat) { add(R.rows, p, 0.1 * dmg); R.r = 'nopen'; R.k = 'np'; what(R, 'SLAT'); break; } // (crushed before it goes off)
          jet = at;
          if (D.spaced) pen *= 0.7;
          add(R.rows, p, 0.1 * dmg);
        } else add(R.rows, p, 0.03 * dmg);
        if (!D.spaced || !heat) pen -= eff;
        if (pen <= 0) { R.r = 'nopen'; R.k = 'np'; break; }
        if (heat) jet = at3(hits, h.t1);
        continue;
      }
      if (D.track || D.awheel) { // running gear, outside the hull: it takes the hit, and what gets through goes on in
        if (boom) { R.burst = { at, blast: SH.blast || 1, dmg, he: SH.he }; R.r = 'hit'; what(R, whatOf(D)); break; }
        what(R, whatOf(D));
        if (pen >= eff) { add(R.rows, p, 0.5 * dmg); pen -= eff; R.r = 'hit'; if (heat) jet = at3(hits, h.t1); continue; }
        add(R.rows, p, (heat ? 0.3 : 0.15) * dmg); R.r = 'hit'; R.k = 'np';
        break;
      }
      // a plate of the hull or a turret: here it gets through, or it doesn't
      plate = h;
      if (t > 0 && !over && !s.ric && !(heat && jet) && rnd() < smoothstep(T.ric[0], T.ric[1], thn)) {
        add(R.rows, p, 0.02 * dmg); R.r = 'ric'; R.k = 'np';
        if (!s.legacy) R.ric = bounce(s, at, n, dx, dy, dz, spd, pen, !kin);
        break;
      }
      if (boom && !hesh) { R.burst = { at, blast: SH.blast || 1, dmg, he: SH.he }; R.r = (SH.he || 0) >= t ? 'pen' : 'nopen'; R.k = R.r === 'pen' ? 'pen' : 'np'; break; } // (the blast decides: blastK)
      if (heat && !jet) jet = at;
      const sx = (h.t1 - Math.max(0, h.t0)) * hits.L; // (how far through it the far face is)
      if (hesh) { // a squash head: angle-blind to 60°, it knocks fragments off the inside of plates up to its 120 mm
        R.burst = { at, blast: SH.blast || 1, dmg: dmg * 0.3, he: undefined };
        if (eff <= pen) { R.r = 'pen'; R.k = 'pen'; add(R.rows, p, 0.1 * dmg); postPen(v, h, at, dx, dy, dz, 0, SH, T, R, sx, true); }
        else { R.r = 'nopen'; R.k = 'np'; add(R.rows, p, 0.03 * dmg); }
        break;
      }
      if (pen >= eff) { R.r = 'pen'; R.k = 'pen'; add(R.rows, p, 0.1 * dmg); postPen(v, h, at, dx, dy, dz, pen - eff, SH, T, R, sx, false, s.legacy); }
      else {
        R.r = 'nopen'; R.k = 'np'; add(R.rows, p, (s.legacy ? 0.05 : 0.03) * dmg);
        if (pen >= 0.8 * eff && rnd() < 0.3) { cands(v, at, 3); spall(v, at, dx, dy, dz, 2, T.cone || 20, R); } // (a near thing: two fragments off the inside)
      }
      break;
    }
    R.pen = pen;
    R.go = kin && !plate && R.r === 'hit' && pen > 0 && !R.burst;
    if (R.r === 'miss') R.go = true; // (it found nothing after all: on it flies)
    R.crew = crewHit(v, R);
    if (R.crew) what(R, 'CREW');
    return R;
  }
  // a ricochet: off along the mirror of its path (jittered 4°), at 0.6 of its speed and half its penetration; it never
  // bounces again. A shaped charge or squash head that glances off doesn't go off (dud: it only flies on for show).
  function bounce(s, at, n, dx, dy, dz, spd, pen, dud) {
    const dn = dx * n.x + dy * n.y + dz * n.z, j = 0.07;
    let rx = dx - 2 * dn * n.x + (rnd() - 0.5) * j, ry = dy - 2 * dn * n.y + (rnd() - 0.5) * j, rz = dz - 2 * dn * n.z + (rnd() - 0.5) * j;
    const l = len(rx, ry, rz) || 1, sp = 0.6 * spd;
    rx /= l; ry /= l; rz /= l;
    return { k: 'shell', sh: s.sh, b: s.b, x: at.x + n.x * 0.05, y: at.y + n.y * 0.05, z: at.z + n.z * 0.05, vx: rx * sp, vy: ry * sp, vz: rz * sp, t: s.t, life: s.life,
      owner: s.owner, enemy: s.enemy, net: 0, cal: s.cal, pen: 0.5 * pen, v0: sp, spare: s.spare, tracer: s.tracer, prox: 0, ric: true, gTop: s.gTop, cheap: s.cheap, dud, n: ++serial };
  }
  // how many crew this result kills (the shooter assumes a ghost's crew unhurt: its owner decides)
  function crewHit(v, R) {
    let n = 0;
    for (const [h, i, k] of R.mods) if (h.def.mods[i].k === 'crew' && k >= (v.remote ? h.def.mods[i].hp || 100 : modHp(h, i)) && (v.remote || modHp(h, i) > 0)) n++;
    for (const [p, k] of R.rows) if (p.def.seat && !p.broken && k >= (v.remote ? Combat.maxHp(p.def) : partHp(p))) n++;
    return n;
  }

  // ---- after penetration (§6.3): the round's way in, its fragments, an APHE shell's burst
  // The parts and built-in modules near the entry point O that the way in and the fragments can meet: inner parts, guns'
  // breeches and turret rings, and every host's modules, each with its own frame (local = o + M·(sim - O)).
  let candN = 0;
  const QX = v3(), QY = v3(), QZ = v3(), QD = [QX, QY, QZ];
  function cands(v, O, reach) {
    candN = 0;
    const q = v.q;
    for (let k = 0; k < 3; k++) qrot({ w: q.w, x: -q.x, y: -q.y, z: -q.z }, k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0, QD[k]); // (the sim's axes in part space)
    for (const r of recsOf(v)) {
      if (!r.cand) continue;
      const p = r.p, d = r.d, f = CAND[candN] || (CAND[candN] = { p: null, o: v3(), m: [0, 0, 0, 0, 0, 0, 0, 0, 0], off: null, part: false, R: 0, mc: [] });
      recOwn(v, r, O, f.o);
      const R = r.G.R;
      if (len(f.o.x, f.o.y, f.o.z) > reach + R) continue;
      for (let k = 0; k < 3; k++) {
        T1.x = QD[k].x; T1.y = QD[k].y; T1.z = QD[k].z;
        recDir(r, T1);
        f.m[k] = T1.x; f.m[3 + k] = T1.y; f.m[6 + k] = T1.z;
      }
      f.p = p; f.part = r.part; f.R = R; f.off = d.mods ? offOf(v, p) : null;
      // (where it is from O, in the sim, and the cone of directions its bounding sphere fills: rays outside it miss)
      const m = f.m, ox = f.o.x, oy = f.o.y, oz = f.o.z, dl = len(ox, oy, oz) || 1;
      f.cx = -(m[0] * ox + m[3] * oy + m[6] * oz) / dl; f.cy = -(m[1] * ox + m[4] * oy + m[7] * oz) / dl; f.cz = -(m[2] * ox + m[5] * oy + m[8] * oz) / dl;
      f.d = dl; f.cl = dl > R ? Math.sqrt(1 - (R / dl) * (R / dl)) : -2;
      if (d.mods) { const dp = partDepth(p); d.mods.forEach((M, i) => { f.mc[3 * i] = M.at[0] * d.w; f.mc[3 * i + 1] = M.at[1] * d.h; f.mc[3 * i + 2] = M.at[2] * dp; }); }
      candN++;
    }
  }
  // the segment from O along the sim direction (dx, dy, dz) for l metres, in candidate f's frame (PA -> PB)
  function segIn(f, dx, dy, dz, l) {
    const m = f.m;
    PA.x = f.o.x; PA.y = f.o.y; PA.z = f.o.z;
    PB.x = PA.x + (m[0] * dx + m[1] * dy + m[2] * dz) * l; PB.y = PA.y + (m[3] * dx + m[4] * dy + m[5] * dz) * l; PB.z = PA.z + (m[6] * dx + m[7] * dy + m[8] * dz) * l;
  }
  const HQ = rec();
  // fn(event) for each candidate part (i -1) and module the segment PA -> PB meets, with where (fraction): into EV
  function meet(f, out) {
    const p = f.p, d = p.def;
    if (f.part && segD2(PA, PB, 0, 0, 0) <= f.R * f.R && (d.round ? cyl(p, PA, PB, HQ) : prism(p, PA, PB, HQ))) out.push(ev(f, -1, Math.max(0, HQ.t0)));
    const M = d.mods;
    if (!M) return;
    const dx = PB.x - PA.x, dy = PB.y - PA.y, dz = PB.z - PA.z, l2 = dx * dx + dy * dy + dz * dz, mc = f.mc;
    for (let i = 0; i < M.length; i++) {
      if (f.off && f.off[i]) continue;
      const r = M[i].r, fx = PA.x - mc[3 * i], fy = PA.y - mc[3 * i + 1], fz = PA.z - mc[3 * i + 2], b = fx * dx + fy * dy + fz * dz, c = fx * fx + fy * fy + fz * fz - r * r;
      const D = b * b - l2 * c;
      if (D < 0 || l2 <= 0) continue;
      const sq = Math.sqrt(D), t0 = (-b - sq) / l2, t1 = (-b + sq) / l2;
      if (t1 < 0 || t0 > 1) continue;
      out.push(ev(f, i, Math.max(0, t0)));
    }
  }
  let evN = 0;
  const EVP = [];
  function ev(f, i, t) { const e = EVP[evN] || (EVP[evN] = { f: null, i: 0, t: 0 }); evN++; e.f = f; e.i = i; e.t = t; return e; }
  function hitIt(R, e, k) {
    if (e.i < 0) add(R.rows, e.f.p, k); else addMod(R.mods, e.f.p, e.i, k);
    what(R, e.i < 0 ? whatOf(e.f.p.def) : WHAT[e.f.p.def.mods[e.i].k]);
  }
  function postPen(v, h, at, dx, dy, dz, res, SH, T, R, sx, hesh, legacy) {
    const L = hesh ? 0 : legacy ? 1.5 : T.L || 0, dmgP = legacy ? 3 * SH.dmg : SH.dmg, res0 = res;
    cands(v, at, Math.max(L, 2.5) + 0.5);
    // the way in: everything it crosses takes dmg·(1 - 0.5·s/L); an engine takes 30 mm out of it, ammunition 10. It
    // leaves through the far face of what it went into only if what it has left beats that face.
    let stop = L;
    if (L > 0) {
      if (sx < L) {
        const n = ownOut(v, h.p, h.n1, N1), c = Math.abs(dx * n.x + dy * n.y + dz * n.z), fe = effOf(faceMm(h.p, h.edge1, h.u1), Math.acos(clamp(c, 0, 1)) / RAD, SH, T, h.p.def.armour && h.p.def.armour.heat)[0];
        if (res < fe) stop = sx;
      }
      evN = 0; EV.length = 0;
      for (let j = 0; j < candN; j++) { segIn(CAND[j], dx, dy, dz, L); meet(CAND[j], EV); }
      EV.sort((a, b) => a.t - b.t);
      for (const e of EV) {
        const s = e.t * L;
        if (s > stop) break;
        hitIt(R, e, dmgP * (1 - (0.5 * s) / L));
        const d = e.f.p.def, k = e.i < 0 ? (d.engine ? 'engine' : d.rack ? 'ammo' : null) : d.mods[e.i].k;
        res -= k === 'engine' ? 30 : k === 'ammo' ? 10 : 0;
        if (res <= 0) { stop = s; break; }
      }
    }
    // fragments off the inside of the plate, in a cone along its path: n × clamp(left/40 + 0.5, 0.5, 1.5); none through an
    // open face (an open roof: no plate there to throw them)
    const nf = faceMm(h.p, h.edge, h.u) <= 0 ? 0 : hesh ? T.n : Math.round((T.n || 0) * clamp(res0 / 40 + 0.5, 0.5, 1.5));
    spall(v, at, dx, dy, dz, nf, T.cone || 20, R);
    // an APHE shell bursts 1.2 m in (or where it stopped), every module in reach taking burst·(1 - d/r)^1.2 (a fuel cell
    // in between shields what lies behind it)
    if (T.fuse && SH.burst) {
      const f0 = Math.min(T.fuse, stop || T.fuse);
      burstIn(v, at.x + dx * f0, at.y + dy * f0, at.z + dz * f0, SH.burst, SH.r || 2, R, at);
    }
  }
  const SP = [];
  function spall(v, at, dx, dy, dz, n, cone, R) {
    if (!(n > 0) || !candN) return;
    let ux = -dy, uy = dx, uz = 0;
    if (Math.abs(dz) > 0.9) { ux = 0; uy = -dz; uz = dy; }
    let l = len(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    const wx = dy * uz - dz * uy, wy = dz * ux - dx * uz, wz = dx * uy - dy * ux, cc = Math.cos(cone * RAD);
    for (let j = 0; j < n; j++) {
      const ca = 1 - rnd() * (1 - cc), sa = Math.sqrt(Math.max(0, 1 - ca * ca)), ph = rnd() * TAU, cp = Math.cos(ph) * sa, spp = Math.sin(ph) * sa;
      const rx = dx * ca + ux * cp + wx * spp, ry = dy * ca + uy * cp + wy * spp, rz = dz * ca + uz * cp + wz * spp;
      evN = 0; SP.length = 0;
      for (let k = 0; k < candN; k++) {
        const f = CAND[k];
        if (f.d - f.R > 2.5 || rx * f.cx + ry * f.cy + rz * f.cz < f.cl) continue;
        segIn(f, rx, ry, rz, 2.5); meet(f, SP);
      }
      let best = null;
      for (const e of SP) if (!best || e.t < best.t) best = e;
      const k = 45 + (rnd() * 2 - 1) * 15;
      if (best) hitIt(R, best, k); // (the first thing it meets takes it: a fuel cell stops it there)
    }
  }
  function burstIn(v, cx, cy, cz, burst, r, R, O) {
    const qx = cx - O.x, qy = cy - O.y, qz = cz - O.z;
    for (let j = 0; j < candN; j++) {
      const f = CAND[j], p = f.p, d = p.def, m = f.m;
      const lx = f.o.x + m[0] * qx + m[1] * qy + m[2] * qz, ly = f.o.y + m[3] * qx + m[4] * qy + m[5] * qz, lz = f.o.z + m[6] * qx + m[7] * qy + m[8] * qz;
      const hit = (dist, i, tx, ty, tz) => {
        if (dist >= r || shielded(v, j, i, lx, ly, lz, tx, ty, tz)) return;
        const k = burst * Math.pow(1 - Math.max(0, dist) / r, 1.2);
        if (i < 0) add(R.rows, p, k); else addMod(R.mods, p, i, k);
        what(R, i < 0 ? whatOf(d) : WHAT[d.mods[i].k]);
      };
      if (f.part) hit(len(lx, ly, lz) - 0.5 * Math.min(d.w, d.h), -1, 0, 0, 0); // (fuel too: a fuel cell takes the burst, and still shields what lies behind it)
      if (d.mods) for (let i = 0; i < d.mods.length; i++) {
        if (f.off && f.off[i]) continue;
        const M = d.mods[i], tx = M.at[0] * d.w, ty = M.at[1] * d.h, tz = M.at[2] * partDepth(p);
        hit(len(lx - tx, ly - ty, lz - tz) - M.r, i, tx, ty, tz);
      }
    }
  }
  // is there a fuel cell (a placed one) between the burst (local to candidate j) and its target there?
  function shielded(v, j, ti, lx, ly, lz, tx, ty, tz) {
    const f = CAND[j], m = f.m;
    // the target back in the sim: O + Mᵀ·(local - o)
    const ax = tx - f.o.x, ay = ty - f.o.y, az = tz - f.o.z, bx = lx - f.o.x, by = ly - f.o.y, bz = lz - f.o.z;
    const sx = m[0] * ax + m[3] * ay + m[6] * az, sy = m[1] * ax + m[4] * ay + m[7] * az, sz = m[2] * ax + m[5] * ay + m[8] * az; // (target - O, sim)
    const ux = m[0] * bx + m[3] * by + m[6] * bz, uy = m[1] * bx + m[4] * by + m[7] * bz, uz = m[2] * bx + m[5] * by + m[8] * bz; // (burst - O, sim)
    for (let k = 0; k < candN; k++) {
      const g = CAND[k];
      if (k === j && ti < 0 || g.p.def.module !== 'fuel') continue;
      const n = g.m;
      PA.x = g.o.x + n[0] * ux + n[1] * uy + n[2] * uz; PA.y = g.o.y + n[3] * ux + n[4] * uy + n[5] * uz; PA.z = g.o.z + n[6] * ux + n[7] * uy + n[8] * uz;
      PB.x = g.o.x + n[0] * sx + n[1] * sy + n[2] * sz; PB.y = g.o.y + n[3] * sx + n[4] * sy + n[5] * sz; PB.z = g.o.z + n[6] * sx + n[7] * sy + n[8] * sz;
      if (prism(g.p, PA, PB, HQ) && HQ.t0 > 0) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- applying it
  // The result of resolve on v, by `by`: our own vessels take it here (modules first, then the parts), someone else's
  // craft goes to its owner as one hit message (with the module rows, and where it came from); then the burst, the
  // ricochet, and what the HUD shows (the burst's work included). The kit it strips goes in one piece (Combat.holdRips).
  function apply(v, R, F, by, s) {
    Combat.holdRips();
    try { applyIn(v, R, F, by, s); } finally { Combat.flushRips(); }
  }
  function applyIn(v, R, F, by, s) {
    const b = v.body, me = !!by && by === F.active;
    if (R.at) FX.sparks(b, R.at, { x: v.vx, y: v.vy, z: v.vz }, R.r === 'ric' ? 8 : R.r === 'pen' ? 10 : 4);
    if (R.r === 'pen' && R.at) FX.puff(b, R.at, { x: v.vx, y: v.vy, z: v.vz }, 3, '#8b8f96');
    const sp = s ? len(s.vx, s.vy, s.vz) || 1 : 1, back = s ? { x: -s.vx / sp, y: -s.vy / sp, z: -s.vz / sp } : null;
    if (v.remote) { if (mpOn() && ours(by) && (R.rows.length || R.mods.length)) MP.sendHits(v, R.rows, R.k, R.mods, back && [back.x, back.y, back.z], R.hot); }
    else if (R.rows.length || R.mods.length) {
      Armour.hot = R.hot;
      for (const [h, i, k] of R.mods) modDamage(v, h, i, k, F, by);
      for (const [p, k] of R.rows) Combat.damage(v, p, k, 'shot', F, by);
      Armour.hot = false;
      if (v === F.active && back) hurt(v, back, R.r === 'pen' ? 'pen' : 'np', F);
      if (v === F.active) Sound.hit();
    }
    const T = me && R.burst ? (TAL.crew = 0, TAL.what.length = 0, TAL) : null;
    if (R.burst) {
      const B = R.burst;
      tal = T; talV = v; talR = R;
      try { Combat.explode(b, B.at, B.blast, B.dmg, by, F, B.quiet ?? !!(s && s.cheap), B.he, s && s.t < 0.6 ? s.spare : undefined); } finally { tal = talV = talR = null; }
    }
    if (R.ric) Combat.S.shots.push(R.ric);
    if (me && R.r !== 'miss') {
      // (what the HUD says: the burst's dead count as a way in, what it broke as a hit)
      let r = R.r, crew = R.crew;
      const w = R.what.slice();
      if (T) { for (const x of T.what) if (!w.includes(x)) w.push(x); crew += T.crew; if (T.crew) { if (!w.includes('CREW')) w.push('CREW'); r = 'pen'; } else if (T.what.length && r === 'nopen') r = 'hit'; }
      fb.shot = { r, what: w, crew, t: simTime(F) };
    }
  }
  // What a burst does, told to the shooter's feedback (§6.8) as it goes off: while apply's burst runs (tal, on the
  // vessel hit), explode hands each plated part and module it is about to hurt there to tally and tallyMods: what it
  // breaks goes into what, the crew it kills into crew, judged as crewHit judges a shell's own rows (a ghost's from full
  // health, less what the shell's own rows already took)
  const TAL = { crew: 0, what: [] };
  let tal = null, talV = null, talR = null;
  function tally(v, p, k) {
    if (!tal || v !== talV) return;
    const d = p.def;
    if (!d.module || p.broken || !(k >= (v.remote ? Combat.maxHp(d) : partHp(p)))) return;
    if (v.remote && talR.rows.some((r) => r[0] === p && r[1] >= Combat.maxHp(d))) return;
    if (d.module === 'crew') tal.crew++; else what(tal, WHAT[d.module]);
  }
  function tallyMods(v, mods) {
    if (!tal || v !== talV) return;
    for (const [h, i, k] of mods) {
      const M = h.def.mods[i], off = offOf(v, h), hp = v.remote ? M.hp || 100 : modHp(h, i);
      if ((off && off[i]) || !(hp > 0) || !(k >= hp)) continue;
      if (v.remote && talR.mods.some((r) => r[0] === h && r[1] === i && r[2] >= hp)) continue;
      if (M.k === 'crew') tal.crew++; else what(tal, WHAT[M.k]);
    }
  }
  // we (the active vessel) were hit from direction d (sim, toward the shooter): the edge arc, and a buzz
  function hurt(v, d, k, F) {
    const t = simTime(F);
    while (fb.hurt.length && (fb.hurt.length > 3 || t - fb.hurt[0].t > 2)) fb.hurt.shift();
    fb.hurt.push({ d: { x: d.x, y: d.y, z: d.z }, t });
    if (typeof haptic === 'function') haptic(k === 'pen' ? 35 : 12);
  }

  // ---------------------------------------------------------------- shells in flight (§6.1)
  const HV = [], HR = [], LOC = {}, TC = v3();
  // Machine-gun and autocannon rounds (s.cheap) fly in steps of at least 1/60 s: a 1/120 s physics substep is held
  // (s.ha) and the next one carries both, so a stream costs half (§14's round budget). The ground test of a step is
  // over that step, so it still looks every 20 m or so; the renderer draws a round ahead by the time it holds.
  const CHEAP_H = 1 / 60;
  function moveShell(s, h, F) {
    const SH = SHELLS[s.sh];
    if (!SH) return false;
    if (s.n == null) s.n = ++serial;
    if (s.cheap && h < CHEAP_H - 1e-9) { const a = (s.ha || 0) + h; if (a < CHEAP_H - 1e-9) { s.ha = a; return true; } h = a; s.ha = 0; }
    const b = s.b, r0 = len(s.x, s.y, s.z), g = b.mu / (r0 * r0);
    s.t += h;
    if (s.t > (s.life ?? SH.life ?? 6)) { if (SH.prox && !s.net && !s.dud) Combat.explode(b, s, SH.blast || 1, SH.dmg, s.owner, F, true, SH.he); return false; } // (HE-VT bursts at the end of its time)
    // gravity, and drag: k·ρ·v² (each shell its own k; airDensity's own sum below its fade, a call saved a step)
    const alt = r0 - b.radius, rho = b.atmoHeight && alt < 0.8 * b.atmoHeight ? b.rho0 * Math.exp(-Math.max(alt, 0) / b.scaleH) : airDensity(b, alt);
    const spd0 = len(s.vx, s.vy, s.vz), kd = SH.k * rho * spd0 * h;
    s.vx -= s.vx * kd + (s.x / r0) * g * h; s.vy -= s.vy * kd + (s.y / r0) * g * h; s.vz -= s.vz * kd + (s.z / r0) * g * h;
    const ax = s.x, ay = s.y, az = s.z, ex = ax + s.vx * h, ey = ay + s.vy * h, ez = az + s.vz * h;
    TA.x = ax; TA.y = ay; TA.z = az; TE.x = ex; TE.y = ey; TE.z = ez;
    // vessels (not its own for 1.5 s, nor one it already went through). On its first step from the muzzle, a part it
    // starts inside (point blank: a muzzle pushed into the turret in front of it; barrels aren't in the collision
    // boxes) counts as met where the line goes into it (t0 < 0), so that plate is hit by its face. (Later, a shell
    // inside a part is one going on through what it already hit: the pieces of an old craft, say.)
    let hv = null, ht = 2;
    const muzzle = s.t <= h + 1e-9, mx = (ax + ex) / 2, my = (ay + ey) / 2, mz = (az + ez) / 2, hL = len(ex - ax, ey - ay, ez - az) / 2 + 4;
    for (const o of F.vessels) {
      if (o.dead || o.body !== b || (o === s.owner && s.t < 1.5) || o === s.skip || !o.parts.length) continue;
      const rr = (o.reach || 10) + hL, dx = o.x - mx, dy = o.y - my, dz = o.z - mz;
      if (dx * dx + dy * dy + dz * dz > rr * rr) continue; // (nowhere near it: hitAll would say so, at more cost)
      for (const H of hitAll(o, TA, TE, HV)) if (H.t0 < 1 && (H.t0 >= -1e-9 || (muzzle && H.t1 > 1e-9))) { if (H.t0 < ht) { ht = H.t0; hv = o; } break; }
    }
    // the range's targets (spheres)
    let tt = 2, tg = null;
    if (!s.net && !s.dud) for (const e of Combat.S.targets) {
      if (!e.alive || e === s.owner) continue;
      const u = 1 / (len(e.pos.x, e.pos.y, e.pos.z) || 1), k = e.def.h / 2;
      TC.x = e.pos.x * (1 + k * u); TC.y = e.pos.y * (1 + k * u); TC.z = e.pos.z * (1 + k * u);
      const f = closest(TA, TE, TC);
      if (CL < e.def.r && f < tt) { tt = f; tg = e; }
    }
    const spare = s.t < 0.6 ? s.spare : undefined;
    // the proximity fuze (HE-VT): bursts passing within prox of an aircraft
    if (SH.prox && !s.net && !s.dud && s.t >= (SH.arm || 0.4) && !hv && !tg) {
      for (const c of airNear(s, F)) {
        if (len(c.x - ax, c.y - ay, c.z - az) > 50 + spd0 * h) continue;
        TC.x = c.x; TC.y = c.y; TC.z = c.z;
        const f = closest(TA, TE, TC);
        if (CL < (s.prox || SH.prox)) { Combat.explode(b, lerpTo(f), SH.blast || 1, SH.dmg, s.owner, F, true, SH.he, spare); return false; }
      }
    }
    if (hv || tg) {
      // (behind a crest or a berm: the ground there first)
      const gt = groundT(s, b, s.gk ? s.g0 : TA, TE, false);
      const lim = hv && ht <= tt ? ht : tt;
      if (gt >= 0 && gt <= (s.gk ? 0.5 + lim / 2 : lim)) return ground(s, b, gtAt, F, SH, spare);
    }
    if (hv && ht <= tt) {
      const at = lerpTo(ht);
      if (s.net || s.dud || hv.wreck) { FX.sparks(b, at, { x: hv.vx, y: hv.vy, z: hv.vz }, s.cheap ? 2 : 6); return false; } // (a copy shows only; a wreck is solid, nothing more)
      // its whole way through, from just outside: one ray of twice the vessel's reach
      const k = 1 / (spd0 || 1), R1 = 2 * (hv.reach || 10) + 1;
      TA.x = at.x - s.vx * k * 0.05; TA.y = at.y - s.vy * k * 0.05; TA.z = at.z - s.vz * k * 0.05;
      TE.x = at.x + s.vx * k * R1; TE.y = at.y + s.vy * k * R1; TE.z = at.z + s.vz * k * R1;
      const R = resolve(s, hv, hitAll(hv, TA, TE, HR), F);
      apply(hv, R, F, s.owner, s);
      if (!R.go) return false;
      const sp = len(s.vx, s.vy, s.vz) || 1; // (through an old craft: on it flies, with what it has left)
      if (R.r !== 'miss') { s.pen = R.pen; s.v0 = sp; }
      s.skip = hv; s.x = ex; s.y = ey; s.z = ez; s.gk = 0; s.gcc = undefined;
      return true;
    }
    if (tg) {
      const at = lerpTo(tt);
      if (BURST[SH.type] || SH.type === 'hesh') Combat.explode(b, at, SH.blast || 1, SH.dmg, s.owner, F, !!s.cheap, SH.he, spare);
      else { Combat.hitTarget(tg, SH.dmg, s.owner, F); FX.sparks(b, at, { x: 0, y: 0, z: 0 }, 3); }
      return false;
    }
    // the ground: skipped above gTop (the arena's highest ground); else tested every 2nd step, over both steps (a
    // cheap round's every step, already two substeps long)
    if (len(ex, ey, ez) - b.radius > (s.gTop ?? Infinity)) { s.gk = 0; s.gc = s.gcc = undefined; }
    else if (!s.gk && !s.cheap) { s.gk = 1; s.g0 = s.g0 || v3(); s.g0.x = ax; s.g0.y = ay; s.g0.z = az; }
    else {
      const gt = groundT(s, b, s.gk ? s.g0 : TA, TE, !!s.cheap);
      s.gk = 0;
      if (gt >= 0) return ground(s, b, gtAt, F, SH, spare);
    }
    s.x = ex; s.y = ey; s.z = ez;
    return true;
  }
  const TA = v3(), TE = v3(), gtAt = v3();
  const lerpTo = (t) => ({ x: TA.x + (TE.x - TA.x) * t, y: TA.y + (TE.y - TA.y) * t, z: TA.z + (TE.z - TA.z) * t });
  let CL = 0;
  function closest(a, e, c) { // the fraction of a -> e nearest c (and CL: how near)
    const dx = e.x - a.x, dy = e.y - a.y, dz = e.z - a.z, l2 = dx * dx + dy * dy + dz * dz;
    const t = l2 > 0 ? clamp(((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / l2, 0, 1) : 0;
    CL = len(a.x + dx * t - c.x, a.y + dy * t - c.y, a.z + dz * t - c.z);
    return t;
  }
  // aircraft a proximity fuze can see: gathered once a step for each shooter
  // (an enemy's shells: the player's craft, flying; ours: what our missiles would lock on to)
  let airAt = NaN, airBy = null, airList = [];
  function airNear(s, F) {
    if (airAt !== F.time || airBy !== s.owner) {
      airAt = F.time; airBy = s.owner;
      const a = F.active;
      airList = s.enemy ? (a && a !== s.owner && !a.dead && !a.landed && a.parts.length ? [a] : []) : Combat.candidates(s.owner, 'air', F);
    }
    return airList;
  }
  // How high a point is over the ground (or the sea): exact, or (cheap rounds) over the highest corner of a 16 m lattice
  function clearOf(b, x, y, z, coarse) {
    Terrain.locate(b, x, y, z, LOC);
    return clearLoc(b, coarse);
  }
  function clearLoc(b, coarse) { // (the same, at the point LOC holds)
    const gh = coarse ? coarseH(LOC.a, LOC.z, b) : b.ocean ? Math.max(0, Terrain.surfaceAt(b, LOC.a, LOC.z)) : Terrain.surfaceAt(b, LOC.a, LOC.z);
    return LOC.r - b.radius - gh;
  }
  // Where the segment P0 -> P1 first goes under the ground (fraction, the point in gtAt), or -1. Its end is tested; near
  // the ground (either end within 6 m) every 5 m along it too, so a fast shell doesn't skip through a berm or a crest, and
  // every 0.75 m over a berm's top (a line through its top 10 cm crosses it in about 2 m); a hit is bisected three times.
  // Cheap rounds look at the coarse lattice first (P0's from the test before, s.gcc, whose P1 it was), test exactly
  // only within 3 m of it, and there every 10 m (a round skimming a crest's top by a few centimetres may graze through
  // it; over a berm, every 0.75 m all the same).
  function groundT(s, b, P0, P1, cheap) {
    if (cheap) {
      const c0 = s.gcc ?? clearOf(b, P0.x, P0.y, P0.z, true), c1 = clearOf(b, P1.x, P1.y, P1.z, true);
      s.gcc = c1;
      if (c0 > 3 && c1 > 3) { s.gc = undefined; return -1; }
    }
    const c1 = cheap ? clearLoc(b, false) : clearOf(b, P1.x, P1.y, P1.z, false), a1 = LOC.a, z1 = LOC.z, c0 = s.gc != null ? s.gc : clearOf(b, P0.x, P0.y, P0.z, false);
    s.gc = c1;
    let lo = 0, hi = -1;
    if (Math.min(c0, c1) < 6) {
      const L = len(P1.x - P0.x, P1.y - P0.y, P1.z - P0.z), n = Math.min(8, Math.floor(L / (cheap ? 10 : 5))), on = bermSpan(b, P0, P1, a1, z1, L), d = 0.75 / Math.max(L, 0.75);
      for (let i = 1, prev = 0; i <= n + 1 && hi < 0; prev = i++ / (n + 1)) {
        const f = i / (n + 1);
        if (on && f > BSP[0] && prev < BSP[1]) for (let g = Math.max(prev, BSP[0]) + d, e = Math.min(f, BSP[1]); g < e && hi < 0; g += d) { if (underAt(b, P0, P1, g)) hi = g; else lo = g; }
        if (hi < 0 && i <= n) { if (underAt(b, P0, P1, f)) hi = f; else lo = f; }
      }
    }
    if (hi < 0 && c1 < 0) hi = 1;
    if (hi < 0) return -1;
    for (let i = 0; i < 3; i++) { const f = (lo + hi) / 2; if (clearOf(b, P0.x + (P1.x - P0.x) * f, P0.y + (P1.y - P0.y) * f, P0.z + (P1.z - P0.z) * f, false) < 0) hi = f; else lo = f; }
    gtAt.x = P0.x + (P1.x - P0.x) * hi; gtAt.y = P0.y + (P1.y - P0.y) * hi; gtAt.z = P0.z + (P1.z - P0.z) * hi;
    return hi;
  }
  const underAt = (b, P0, P1, f) => clearOf(b, P0.x + (P1.x - P0.x) * f, P0.y + (P1.y - P0.y) * f, P0.z + (P1.z - P0.z) * f, false) < 0;
  // The stretch of P0 -> P1 over the crest of an arena's berm (within 8 m of its ridge line, along its 26 m), as fractions
  // into BSP; false when it passes none
  const BSP = [0, 0], BLOC = {};
  let bsT0 = 0, bsT1 = 1;
  function slab(p0, p1, m) { // (keeps bsT0..bsT1 to where |p0 + (p1 - p0) t| < m)
    const dp = p1 - p0;
    if (Math.abs(dp) < 1e-9) { if (Math.abs(p0) >= m) bsT1 = -1; return; }
    const ta = (-m - p0) / dp, tb = (m - p0) / dp;
    bsT0 = Math.max(bsT0, Math.min(ta, tb)); bsT1 = Math.min(bsT1, Math.max(ta, tb));
  }
  // (a1, z1: P1 located, as Terrain.locate puts it; L: the segment's length)
  let bsA = null, bsAll = [];
  function bermSpan(b, P0, P1, a1, z1, L) {
    const A = b === EARTH && b.mapped && b.arenas, BM = Terrain.BERM;
    if (!A || !BM) return false;
    const e1 = -wrapAngle(a1 - b.padAngle) * b.radius;
    // (P0 is within the segment's length of P1, a little more in e and z: with P1 that far from every berm, so is P0)
    if (A !== bsA) { bsA = A; bsAll = []; for (const k in A) for (const q of A[k].berms || []) bsAll.push(q); }
    const m = 27 + 1.1 * L;
    let near = false;
    for (const q of bsAll) if (Math.abs(e1 - q.e) < m && Math.abs(z1 - q.z) < m) { near = true; break; }
    if (!near) return false;
    Terrain.locate(b, P0.x, P0.y, P0.z, BLOC);
    const e0 = -wrapAngle(BLOC.a - b.padAngle) * b.radius, z0 = BLOC.z;
    let lo = 2, hi = -1;
    for (const k in A) {
      const a = A[k], B = a.box, L = a.berms;
      if (!L || !L.length || !B || Math.max(e0, e1) < B.e0 - 30 || Math.min(e0, e1) > B.e1 + 30 || Math.max(z0, z1) < B.z0 - 30 || Math.min(z0, z1) > B.z1 + 30) continue;
      for (const q of L) {
        const de0 = e0 - q.e, dz0 = z0 - q.z, de1 = e1 - q.e, dz1 = z1 - q.z;
        if (Math.min(de0, de1) > 25 || Math.max(de0, de1) < -25 || Math.min(dz0, dz1) > 25 || Math.max(dz0, dz1) < -25) continue;
        bsT0 = 0; bsT1 = 1;
        slab(de0 * q.c + dz0 * q.s, de1 * q.c + dz1 * q.s, BM.half);
        slab(-de0 * q.s + dz0 * q.c, -de1 * q.s + dz1 * q.c, 8);
        if (bsT0 < bsT1) { lo = Math.min(lo, bsT0); hi = Math.max(hi, bsT1); }
      }
    }
    if (hi < lo) return false;
    BSP[0] = lo; BSP[1] = hi;
    return true;
  }
  // into the ground: high explosive bursts (a copy only shows it), anything else puffs dust or splashes
  function ground(s, b, P, F, SH, spare) {
    const at = { x: P.x, y: P.y, z: P.z };
    if ((BURST[SH.type] || SH.type === 'hesh') && !s.dud) {
      if (s.net) Combat.boomFX(b, at, SH.blast || 1, true, F);
      else Combat.explode(b, at, SH.blast || 1, SH.dmg, s.owner, F, !!s.cheap, SH.he, spare);
      return false;
    }
    if (s.cheap && Math.random() > 0.35) return false;
    Terrain.locate(b, at.x, at.y, at.z, LOC);
    const r = LOC.r || 1, n = { x: at.x / r, y: at.y / r, z: at.z / r }, k = s.cheap ? 1 : 3;
    if (b.ocean && Terrain.waterAt(b, LOC.a, LOC.z)) FX.splash(b, at, n, s.cheap ? 1.5 : 3);
    else if (!s.cheap && (SH.cal || 0) >= 37) kick(b, at, n, SH.cal);
    else FX.puff(b, at, { x: n.x * 3, y: n.y * 3, z: n.z * 3 }, k, '#9a8f7c');
    return false;
  }
  // (P4 play-test) a gun's round into the ground (37 mm and up): a dirt kick a gunner sees at a kilometre and corrects by
  // (it was three faint specks of dust): a column of dust and a spray of clods, sized by the calibre. Eight particles.
  function kick(b, at, n, cal) {
    const k = clamp(cal / 85, 0.6, 1.6);
    for (let i = 0; i < 8; i++) {
      const ph = Math.random() * 2 * Math.PI, cz = Math.random() * 2 - 1, sz = Math.sqrt(1 - cz * cz), d = { x: sz * Math.cos(ph), y: sz * Math.sin(ph), z: cz }, clod = i >= 5, up = (clod ? 10 + Math.random() * 6 : 3 + Math.random() * 6) * k, s = (clod ? 5 : 2) * Math.random() * k;
      FX.add({ kind: 'smoke', b, x: at.x, y: at.y, z: at.z, vx: n.x * up + d.x * s, vy: n.y * up + d.y * s, vz: n.z * up + d.z * s, heavy: clod,
        max: clod ? 1.1 + Math.random() * 0.4 : 1.6 + Math.random() * 0.8, size: (clod ? 0.45 : 1.0) * k, grow: (clod ? 0.4 : 3.2) * k, color: clod ? '#4d3f30' : '#a8916c', alpha: clod ? 0.95 : 0.8 });
    }
  }
  // The ground on a 16 m lattice, its highest corner around (a, z) (body angle and depth, as Terrain.surfaceAt): its own
  // cache of 20k nodes, so streams of cheap rounds don't churn the physics' fine one
  const CH = new Map();
  let chBody = null, chN = 0;
  function coarseH(a, z, b = EARTH) {
    if (chBody !== b || CH.size > 20000) { CH.clear(); chBody = b; chN = Math.max(8, Math.round((TAU * b.radius) / 16)); }
    let fa = ((a % TAU) / TAU) * chN;
    if (fa < 0) fa += chN;
    const ia = Math.floor(fa), iz = Math.floor(z / 16);
    return Math.max(node(b, ia, iz), node(b, ia + 1, iz), node(b, ia, iz + 1), node(b, ia + 1, iz + 1));
  }
  function node(b, ia, iz) {
    ia = ((ia % chN) + chN) % chN;
    const key = iz * chN + ia;
    let h = CH.get(key);
    if (h === undefined) { h = Terrain.surfaceAt(b, (ia * TAU) / chN, iz * 16); if (b.ocean) h = Math.max(0, h); CH.set(key, h); }
    return h;
  }
  // Someone else's shell (shot k 'shell'): a copy that flies with its own drag for show (dmg 0; it stops on what it
  // meets with sparks: its owner says what it did), and the ghost's gun flashes and kicks.
  function netShell(g, m) {
    const S = Combat.S;
    if (!g || !m || typeof m.sh !== 'string' || !hasOwn(SHELLS, m.sh) || S.shots.length > 2000) return;
    const P = m.P, V = m.V, ok = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
    if (!ok(P) || !ok(V) || len(V[0], V[1], V[2]) > 3000) return;
    const SH = SHELLS[m.sh], b = (typeof BODY_BY_ID !== 'undefined' && typeof m.b === 'string' && hasOwn(BODY_BY_ID, m.b) && BODY_BY_ID[m.b]) || EARTH;
    const foe = typeof Net !== 'undefined' && mpOn() && MP.enemy ? !!MP.enemy(Net.me, g.remote) : false;
    S.shots.push({ k: 'shell', sh: m.sh, b, x: P[0], y: P[1], z: P[2], vx: V[0], vy: V[1], vz: V[2], t: 0, life: SH.life || 6, owner: g, enemy: foe, net: g.remote || 1,
      cal: SH.cal, pen: 0, v0: SH.v0, spare: g, tracer: true, prox: 0, ric: false, gTop: Infinity, cheap: SH.cal < 40 });
    const F = typeof Flight !== 'undefined' ? Flight : null;
    let gun = null;
    if (g.parts) for (const p of g.parts) if (p.def.weapon && p.def.weapon.cal === SH.cal && p.def.aim) { gun = p; break; }
    if (gun) gun.shotAt = simTime(F);
    FX.add({ kind: 'flash', b, x: P[0], y: P[1], z: P[2], vx: g.vx || 0, vy: g.vy || 0, vz: g.vz || 0, max: 0.08, size: 0.6 + SH.cal / 100, grow: 2, color: '#ffd27a', alpha: 1 });
    const me = F && F.active;
    Sound.cannon(SH.cal, me ? len(P[0] - me.x, P[1] - me.y, P[2] - me.z) : 1000);
  }

  // ---------------------------------------------------------------- HE against plates (§6.4) and old weapons (§6.5)
  // The damage a blast does to part p of a plated vessel, d from it (k: today's falloff; he: the blast's penetration at
  // its heart, else 3 mm a metre of blast): a plate the blast's penetration there overmatches (its thinnest face toward
  // it) takes all of k, and its modules in reach half; else 0.15·k. Inside parts only through an overmatched host;
  // running gear, guns, radars and launchers all of it from 20 mm up (HE strips them), else 0.3·k; parts with no armour
  // (an old cab) all of it. null: nothing. mods collects [host, i, dmg]; at is the blast (sim).
  const blastTmp = v3();
  function blastK(v, p, d, blast, k, he, mods, at) {
    const D = p.def, he0 = he ?? 3 * blast, hd = he0 * Math.pow(1 - Math.max(0, d) / blast, 1.5);
    if (D.inner) {
      const host = v.byId && p.att != null ? v.byId.get(p.att) : null;
      if (!host || !host.def.armour || !at) return 0.5 * k;
      const dh = hostDist(v, host, at, blast);
      return he0 * Math.pow(1 - Math.max(0, dh) / blast, 1.5) >= thinnest(v, host, at) ? 0.5 * k : null;
    }
    if (D.gv && (D.track || D.awheel || D.weapon || D.searchRadar || D.trackRadar || D.module === 'sight' || D.module === 'breech' || D.module === 'launcher' || D.module === 'radar')) return hd >= 20 ? k : 0.3 * k;
    if (!D.armour) return k;
    if (!at || hd < thinnest(v, p, at)) return 0.15 * k;
    if (mods && D.mods) {
      const off = offOf(v, p);
      simOwn(v, p, at, blastTmp);
      for (let i = 0; i < D.mods.length; i++) {
        const M = D.mods[i];
        if ((off && off[i]) || len(blastTmp.x - M.at[0] * D.w, blastTmp.y - M.at[1] * D.h, blastTmp.z - M.at[2] * partDepth(p)) - M.r >= blast) continue;
        addMod(mods, p, i, 0.5 * k);
      }
    }
    return k;
  }
  function hostDist(v, p, at, blast) {
    Aim.pose(v, p, { x: p.x, y: p.y, z: partZ(p) }, blastTmp);
    outPart(v, blastTmp, blastTmp);
    return len(blastTmp.x - at.x, blastTmp.y - at.y, blastTmp.z - at.z) - Math.max(p.def.w, p.def.h) / 2;
  }
  // the thinnest face of p that looks toward the point (sim; one on a face, or just under it, faces it): 0 for an open
  // one, or with the point deep inside
  function thinnest(v, p, at) {
    const D = p.def, L = simOwn(v, p, at, blastTmp), w = D.w, h = D.h, hd = partDepth(p) / 2, m0 = 0.1;
    let t = Infinity;
    if (D.round) {
      const r = Math.hypot(L.x, L.z);
      if (r > w / 2 - m0) t = Math.min(t, faceMm(p, ESIDE, L.x / (r || 1)));
      if (L.y > h / 2 - m0 || L.y < -h / 2 + m0) t = Math.min(t, faceMm(p, ETOP, 0));
    } else {
      const o = D.outline || BOX_OUTLINE, m = o.length;
      for (let i = 0; i < m; i++) {
        const P = o[i], Q = o[i + 1 === m ? 0 : i + 1], nx = (Q[1] - P[1]) * h, ny = (P[0] - Q[0]) * w;
        if (nx * (L.x - P[0] * w) + ny * (L.y - P[1] * h) > -m0 * Math.hypot(nx, ny)) t = Math.min(t, faceMm(p, i, 0));
      }
      if (Math.abs(L.z) > hd - m0) t = Math.min(t, faceMm(p, EZ, 0));
    }
    return t === Infinity ? 0 : t;
  }
  // An old weapon's direct hit on a plated vessel's new part (armour, or a gun, brick or sight with none): its
  // penetration from what the round already is (no new fields). Bullets by their damage (rifle calibre 10 mm, 20 mm
  // cannon 30, 30 mm 55), the old rocket pods a 120 mm shaped charge and then their blast, anti-ground missiles 700 (a
  // cruise missile's 900); bombs, glide bombs, air-to-air missiles and the ground update's HE rockets (s.he) the blast
  // alone. A penetration does the round's damage ×3 along a 1.5 m path, otherwise 5%. Returns false: the round is spent
  // (on a wreck, with sparks and nothing more).
  const LG = { type: 'ball', pen: 0, cal: 0, dmg: 0, tandem: false }, LS = { legacy: LG, vx: 0, vy: 0, vz: 0, n: 0, pen: 0, v0: 0, ric: false, tandem: false, t: 9 };
  function legacyHit(s, v, p, at, F) {
    if (v.wreck) { FX.sparks(v.body, at, { x: v.vx, y: v.vy, z: v.vz }, 3); return false; }
    const b = s.b, spare = s.t < 0.6 ? s.spare : undefined, gm = s.k === 'missile' && !s.glide && !s.air && (s.seek === 'ground' || s.saclos || s.top || s.seek === 'saclos' || s.seek === 'top');
    if ((s.k !== 'bullet' && s.k !== 'rocket' && !gm) || (s.k === 'rocket' && s.he != null)) { Combat.explode(b, at, s.blast || 1, s.dmg || 0, s.owner, F, false, s.he, spare); return false; }
    if (s.k === 'bullet') { const d = s.dmg || 0; LG.type = d >= 20 ? 'ap' : 'ball'; LG.pen = d <= 9 ? 10 : d < 20 ? 30 : 55; LG.cal = d <= 9 ? 7.6 : d < 20 ? 20 : 30; }
    else { LG.type = 'heat'; LG.pen = s.pen || (s.k === 'rocket' ? 120 : (s.dmg || 0) >= 2000 ? 900 : 700); LG.cal = 70; }
    LG.dmg = s.dmg || 0; LG.tandem = !!s.tandem;
    const spd = len(s.vx, s.vy, s.vz) || 1;
    LS.vx = s.vx; LS.vy = s.vy; LS.vz = s.vz; LS.n = s.n == null ? (s.n = ++serial) : s.n; LS.pen = LG.pen; LS.v0 = spd; LS.tandem = LG.tandem;
    const k = 1 / spd, R1 = 2 * (v.reach || 10) + 1;
    TA.x = at.x - s.vx * k * 0.05; TA.y = at.y - s.vy * k * 0.05; TA.z = at.z - s.vz * k * 0.05;
    TE.x = at.x + s.vx * k * R1; TE.y = at.y + s.vy * k * R1; TE.z = at.z + s.vz * k * R1;
    const R = resolve(LS, v, hitAll(v, TA, TE, HR), F);
    if (s.blast) R.burst = { at, blast: s.blast, dmg: s.dmg, he: s.he, quiet: s.k === 'bullet' }; // (then its blast: apply's burst, so the HUD hears what it did)
    apply(v, R, F, s.owner, s);
    return false;
  }

  // ---------------------------------------------------------------- modules (§6.6)
  const sideName = (v, p) => (partZ(p) < (v.com.z || 0) ? 'Left' : 'Right');
  function label(v, p) {
    const m = p.def.module;
    return m === 'track' ? `${sideName(v, p)} track` : m === 'wheel' ? `${sideName(v, p)} wheel` : m === 'breech' ? (p.def.weapon && p.def.weapon.kind === 'tgun' ? 'Main gun' : p.def.name) : m === 'ring' ? 'Turret ring' : p.def.name;
  }
  const say = (v, sim, text, k = 'warn') => { if (v === sim.active && !v.ai && !v.ko && sim.toast) sim.toast(text, k); }; // (once knocked out, nothing more)
  // A module part at 0 hp: broken, not removed (once). Tracks and wheels lose their grip, an engine its power (and may
  // catch fire), a breech can't fire, a ring turns by hand; a crew seat's man is dead; a rack may go up; a fuel cell
  // may burn. A ground vehicle's hull or turret (its control parts) at 0 hp knocks it out, the hulk staying.
  function moduleDown(v, p, cause, sim) {
    p.hp = 0;
    if (p.broken) return;
    p.broken = true;
    const m = p.def.module;
    if (!m) { if (p.def.control) knockOut(v, sim, 'hull'); return; }
    if (m === 'crew') { say(v, sim, `${ROLE[p.role || p.def.seat] || 'Crewman'} knocked out`); crewDied(v, p.role || p.def.seat, sim); return; }
    if (m === 'ammo') { const C = crewOf(v), st = C.stores.find((e) => e.part === p); if (st) cookOff(v, st, sim, p); return; }
    if (m === 'engine') {
      say(v, sim, 'Engine destroyed');
      if (vrnd() < (FIRE_ODDS[p.def.engine && p.def.engine.fuel] ?? 0.2)) { p.fire = 25; say(v, sim, 'Fire!'); }
      return;
    }
    if (m === 'fuel') { if (vrnd() < 0.3) { p.fire = 8; say(v, sim, 'Fire!'); } return; }
    if (m === 'troops') { say(v, sim, 'Troops lost'); return; }
    say(v, sim, `${label(v, p)} ${m === 'track' || m === 'wheel' ? 'broken' : 'destroyed'}`);
    void cause;
  }
  // A built-in module's damage (hp kept in host.mods[i], from its full hp the first time). The owner's to apply: the
  // shooter only says (m rows). hot: the round was a shaped charge, APHE or HE (ammunition cooks off more easily).
  function modDamage(v, host, i, dmg, sim, by, hot) {
    if (!(dmg > 0) || v.dead || v.remote || !v.parts.includes(host)) return;
    const M = host.def.mods && host.def.mods[i];
    if (!M || !Number.isInteger(i)) return;
    if (v.spawnAt != null && simTime(sim) - v.spawnAt < 4) return; // (spawn protection)
    const off = offOf(v, host);
    if (off && off[i]) return;
    const hp = modHp(host, i);
    if (hp <= 0) return;
    if (by) { v.lastHitBy = by; v.lastHitAt = simTime(sim); }
    v.hurtAt = simTime(sim);
    const mods = host.mods || (host.mods = host.def.mods.map((q) => q.hp || 100)), left = Math.max(0, hp - dmg);
    mods[i] = left;
    if (M.k === 'ammo') { const st = crewOf(v).stores.find((e) => e.host === host && e.i === i); if (st && left > 0) st.rounds = st.rounds - Math.ceil(st.rounds * Math.min(1, dmg / (M.hp || 70)) * 0.5); } // (some rounds lost)
    if (left > 0) return;
    if (M.k === 'crew') { const e = crewOf(v).crew.find((q) => q.host === host && q.i === i); say(v, sim, `${ROLE[e ? e.role : M.role] || 'Crewman'} knocked out`); crewDied(v, e ? e.role : M.role, sim); }
    else if (M.k === 'ammo') { const st = crewOf(v).stores.find((e) => e.host === host && e.i === i); if (st) cookOff(v, st, sim, null, hot || Armour.hot); }
    else if (M.k === 'fuel') { if (vrnd() < 0.3) { (v.mfire || (v.mfire = [])).push({ host, i, t: 8 }); say(v, sim, 'Fire!'); } }
    else if (M.k === 'troops') say(v, sim, 'Troops lost');
  }
  // a crew member gone: is anyone left to fight it (fewer than two of the crew, or none of a one-man crew: knocked
  // out), and who takes a dead driver's or gunner's seat after 4 s
  function crewDied(v, role, sim) {
    const C = crewOf(v), live = C.crew.filter((e) => e.alive).length;
    if (C.crew.length && live < Math.min(2, C.crew.length) && !C.old.length) { knockOut(v, sim, 'crew'); return; }
    if ((role === 'driver' || role === 'gunner') && !has(v, role)) (v.swaps || (v.swaps = [])).push({ role, t: 4 });
  }
  // A store destroyed: does it go up? clamp((0.5 + 0.4·rounds/capacity)·cook, 0, 0.95), +0.2 against HEAT, APHE or HE.
  // A bustle with blow-out panels vents instead: the rounds are gone, the crew lives.
  function cookOff(v, st, sim, part, hot) {
    const r = st.rounds, cap = st.cap || 1, odds = clamp((0.5 + (0.4 * r) / cap) * (st.cook ?? 1) + (hot || Armour.hot ? 0.2 : 0), 0, 0.95);
    st.rounds = 0;
    if (!(r > 0) || vrnd() >= odds) { say(v, sim, 'Ammo rack destroyed'); return; }
    if (st.blowout) { v.vent = { host: st.host, i: st.i, t: simTime(sim) }; say(v, sim, 'Ammo blow-out: the crew is safe'); return; }
    knockOut(v, sim, 'ammo', { st, rounds: r + totalRounds(v) });
  }
  const totalRounds = (v) => crewOf(v).stores.reduce((s, e) => s + e.rounds, 0);
  // where a host's built-in module is now (sim)
  function modAt(v, host, i, o) {
    const M = host.def.mods[i];
    aimPt(host, M.at[0] * host.def.w, M.at[1] * host.def.h, o);
    o.z += M.at[2] * partDepth(host);
    Aim.pose(v, host, o, o);
    return outPart(v, o, o);
  }
  // Knocked out (too few crew, an ammunition detonation, the hull gone): no control part is left in charge (p.ko),
  // the craft is lost for whoever drives it (sim.onDestroyed; the AI's aiDown), the hulk stays. A detonation blows out
  // everything near (not the hulk itself) and throws the turret: the outer turret's group cut from its base, +9 m/s up
  // and tumbling (twice that in Hollywood). v.ko: { why, x (detonated), t }.
  function knockOut(v, sim, why, det) {
    if (v.ko) return;
    const now = simTime(sim);
    v.ko = { why, x: !!det, t: now };
    for (const p of v.parts) if (p.def.control) p.ko = true;
    if (shooterOf(v) === sim.active) fb.ko = { text: det ? 'Ammo detonation!' : 'Knocked out!', t: now };
    if (v === sim.active && sim.toast) sim.toast(det ? 'Ammo detonation!' : 'Knocked out!', 'warn');
    if (det) {
      const P = det.st.part ? outPart(v, Aim.pose(v, det.st.part, { x: det.st.part.x, y: det.st.part.y, z: partZ(det.st.part) }, v3()), v3()) : modAt(v, det.st.host, det.st.i, v3());
      if (sim.vessels) Combat.explode(v.body, P, 6 + det.rounds / 10, 1500, v, sim, false, undefined, v);
      toss(v, sim, det.st);
    }
    if (v === sim.active && sim.onDestroyed) sim.onDestroyed();
    if (v.ai && !v.ai.down) Combat.aiDown(v, sim);
  }
  const shooterOf = (v) => (v.lastHitBy && v.lastHitBy !== v ? v.lastHitBy : null);
  // The turret a detonation throws: the outermost group holding the store that went up (st: a rack, or a host's built-in
  // store), else (ammunition in the hull) the heaviest turret riding on nothing else
  function tossGroup(v, st) {
    const of = v.tgOf, tg = v.tg || [];
    let g = st && of ? of.get((st.part || st.host).id) : null;
    while (g && g.parent) g = g.parent;
    if (!g) for (const q of tg) if (!q.parent && (!g || q.mass > g.mass)) g = q;
    return g || null;
  }
  function toss(v, sim, st) {
    const g = tossGroup(v, st);
    if (!g) return [];
    for (const id of g.ids) for (const n of [...(v.adj.get(id) || [])]) if (!g.ids.has(n)) { v.adj.get(id).delete(n); if (v.adj.get(n)) v.adj.get(n).delete(id); }
    const i0 = v.parts.findIndex((p) => !g.ids.has(p.id)); // (the hulk keeps what isn't the turret)
    if (i0 > 0) { const t = v.parts[0]; v.parts[0] = v.parts[i0]; v.parts[i0] = t; }
    const pieces = v.splitComponents(), k = Silly.on('hollywood') ? 2 : 1, r = len(v.x, v.y, v.z) || 1;
    for (const q of pieces) {
      q.isDebris = true;
      if (q.parts.some((p) => g.ids.has(p.id))) {
        q.vx += (v.x / r) * 9 * k; q.vy += (v.y / r) * 9 * k; q.vz += (v.z / r) * 9 * k;
        const ax = vrnd() - 0.5, ay = vrnd() - 0.5, az = vrnd() - 0.5, l = len(ax, ay, az) || 1, w = (1 + 2 * vrnd()) * k;
        q.av = v3(q.av.x + (ax / l) * w, q.av.y + (ay / l) * w, q.av.z + (az / l) * w);
        q.tossed = true;
      }
      if (sim.vessels) sim.vessels.push(q);
    }
    return pieces;
  }

  // ---------------------------------------------------------------- fires, crews changing seats, repairs (per frame)
  // crew within reach (m) of part p, in the same host
  function crewNear(v, p, reach, fn) {
    const host = p.att != null && v.byId ? v.byId.get(p.att) : null;
    if (!host) return;
    for (const e of crewOf(v).crew) {
      if (!e.alive || e.host !== host) continue;
      const q = e.i >= 0 ? host.def.mods[e.i].at : null, x = q ? host.x + q[0] * host.def.w : e.part.x, y = q ? host.y + q[1] * host.def.h : e.part.y, z = q ? partZ(host) + q[2] * partDepth(host) : partZ(e.part);
      if (len(x - p.x, y - p.y, z - partZ(p)) <= reach) fn(e);
    }
  }
  function burnCrew(v, e, k, sim) {
    if (e.i >= 0) {
      const mods = e.host.mods || (e.host.mods = e.host.def.mods.map((q) => q.hp || 100)), hp = modHp(e.host, e.i);
      mods[e.i] = Math.max(0, hp - k);
      if (hp > 0 && mods[e.i] <= 0) { e.alive = false; say(v, sim, `${ROLE[e.role] || 'Crewman'} knocked out`); crewDied(v, e.role, sim); }
    } else { const p = e.part; p.hp = partHp(p) - k; if (p.hp <= 0) moduleDown(v, p, 'fire', sim); }
  }
  // Every frame for our own ground vehicles (and the ground AI's): fires burn (an engine 6 hp/s, the crew beside it
  // 3 hp/s; a fuel fire 15 hp/s to the crew in its host) until they burn out or the vehicle has stood still 4 s; a dead
  // driver's or gunner's seat is taken after 4 s; and stopped (under 1 m/s for 1 s), unhurt for 6 s and with a crew,
  // the worst broken module is repaired, one at a time (v.repair: { p, name, t, T, on }).
  function repairStep(v, dt, sim) {
    if (!v || v.dead || v.remote || !v.gv || !(dt > 0)) return;
    const now = simTime(sim), still = v.speed() < 1;
    v.stillT = still ? (v.stillT || 0) + dt : 0;
    for (const p of v.parts) {
      if (!(p.fire > 0)) continue;
      p.fire = v.stillT >= 4 ? 0 : Math.max(0, p.fire - dt);
      if (!p.fire) { if (!v.ko) say(v, sim, 'Fire out', 'info'); continue; }
      const fuel = p.def.module === 'fuel';
      if (!fuel) p.hp = Math.max(0, partHp(p) - 6 * dt);
      if (!v.ko) crewNear(v, p, fuel ? Infinity : 2.5, (e) => burnCrew(v, e, (fuel ? 15 : 3) * dt, sim));
    }
    if (v.mfire) for (const f of v.mfire) {
      f.t = v.stillT >= 4 ? 0 : f.t - dt;
      if (f.t > 0 && !v.ko) for (const e of crewOf(v).crew) if (e.alive && e.host === f.host) burnCrew(v, e, 15 * dt, sim);
    }
    if (v.mfire) v.mfire = v.mfire.filter((f) => f.t > 0);
    if (v.ko) { v.repair = null; return; }
    if (v.swaps && v.swaps.length) {
      const q = v.swaps[0];
      q.t -= dt;
      if (q.t <= 0) {
        v.swaps.shift();
        const C = crewOf(v);
        if (!has(v, q.role)) for (const r of SWAP) {
          const e = C.crew.find((x) => x.alive && x.role === r);
          if (!e) continue;
          e.role = q.role;
          if (e.i >= 0) (e.host.roles || (e.host.roles = []))[e.i] = q.role; else e.part.role = q.role;
          say(v, sim, `${ROLE[r]} takes the ${q.role === 'gunner' ? 'gun' : 'wheel'}`, 'info');
          break;
        }
      }
    }
    // repairs: the worst first
    let need = null, nf = 2;
    for (const p of v.parts) {
      const m = p.def.module;
      if (!m || !REPAIR_T[m] || !p.def.gv) continue;
      const f = p.broken ? -1 : (m === 'engine' || m === 'ring') ? Combat.hpFrac(p) : 1;
      if (f < 0.5 && f < nf) { nf = f; need = p; }
    }
    if (!need) { v.repair = null; return; }
    let r = v.repair;
    if (!r || r.p !== need) r = v.repair = { p: need, name: label(v, need), t: REPAIR_T[need.def.module], T: REPAIR_T[need.def.module], on: false };
    const C = crewOf(v);
    r.on = v.stillT >= 1 && now - (v.hurtAt ?? -1e9) >= 6 && (C.old.length > 0 || C.crew.some((e) => e.alive));
    if (!r.on) return;
    r.t -= dt;
    if (r.t > 0) return;
    need.broken = false;
    need.hp = Math.max(need.hp ?? 0, 0.6 * Combat.maxHp(need.def));
    if (need.def.module === 'engine') need.fire = 0;
    say(v, sim, `${r.name} repaired`, 'info');
    v.repair = null;
  }

  // ---------------------------------------------------------------- smoke and fire from modules (Combat.frame, every 0.07 s)
  const FXP = v3();
  function puffAt(o, P, f, n) {
    FX.add({ kind: 'smoke', b: o.body, x: P.x, y: P.y, z: P.z, vx: o.vx * 0.85, vy: o.vy * 0.85, vz: o.vz * 0.85, max: f ? 3 : 2.2, size: f ? 1 : 0.6, grow: f ? 5 : 3, color: f ? '#2b2d31' : '#8a8e95', alpha: f ? 0.7 : 0.45 });
    if (f) FX.add({ kind: 'fire', b: o.body, x: P.x, y: P.y, z: P.z, vx: o.vx * 0.9, vy: o.vy * 0.9, vz: o.vz * 0.9, max: 0.35, size: 0.9, grow: 1.2, color: '#ff9a3c', alpha: 1 });
    void n;
  }
  // Only what really burns does: engines and fuel cells while on fire, built-in fuel fires and vented ammunition (from
  // the first module part), and a knocked-out hulk smokes; other broken modules give a thin grey wisp at a third the rate.
  function partFX(o, p, n) {
    const first = crewOf(o).anchor === p, now = typeof Flight !== 'undefined' ? Flight.time || 0 : 0;
    if (first) {
      if (o.ko && (n % (o.ko.x ? 1 : 2) === 0)) { Aim.pose(o, p, { x: p.x, y: p.y, z: partZ(p) }, FXP); outPart(o, FXP, FXP); puffAt(o, FXP, o.ko.x && now - o.ko.t < 40, n); }
      if (o.mfire) for (const f of o.mfire) puffAt(o, modAt(o, f.host, f.i, FXP), true, n);
      if (o.vent && now - o.vent.t < 6) { modAt(o, o.vent.host, o.vent.i, FXP); FX.add({ kind: 'fire', b: o.body, x: FXP.x, y: FXP.y, z: FXP.z, vx: o.vx + (o.x / (len(o.x, o.y, o.z) || 1)) * 12, vy: o.vy + (o.y / (len(o.x, o.y, o.z) || 1)) * 12, vz: o.vz + (o.z / (len(o.x, o.y, o.z) || 1)) * 12, max: 0.6, size: 1.2, grow: 2, color: '#ffb347', alpha: 1 }); }
    }
    const burning = p.fire > 0;
    if (!burning && !(p.broken && n % 3 === 0)) return;
    Aim.pose(o, p, { x: p.x, y: p.y, z: partZ(p) }, FXP);
    outPart(o, FXP, FXP);
    puffAt(o, FXP, burning, n);
  }

  // ---------------------------------------------------------------- the builder's numbers (pure)
  // Effective armour against a level shot (mm, no normalisation): the hull's front (its weakest forward plate), its side,
  // the turret's front; how many crew and rounds aboard. null for a design without armour.
  function frontOf(p) {
    const D = p.def, A = D.armour;
    if (!A) return 0;
    if (D.round) return Math.round(Math.min(faceMm(p, ESIDE, 1) / Math.cos(((D.round.slope || 0) * RAD)), 6 * faceMm(p, ESIDE, 1)));
    const o = D.outline || BOX_OUTLINE, m = o.length;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      const P = o[i], Q = o[i + 1 === m ? 0 : i + 1], nx = (Q[1] - P[1]) * D.h, ny = (P[0] - Q[0]) * D.w, l = Math.hypot(nx, ny) || 1, c = nx / l, t = faceMm(p, i, 0);
      if (c > 0.05) best = Math.min(best, Math.min(t / c, 6 * t));
    }
    return best === Infinity ? 0 : Math.round(best);
  }
  function summary(parts) {
    if (!parts || !parts.length || !parts.some((p) => p.def && (p.def.armour || p.def.mods))) return null;
    const big = (f) => parts.filter((p) => p.def && f(p.def)).reduce((m, p) => (!m || p.def.w * p.def.h > m.def.w * m.def.h ? p : m), null);
    const hull = big((d) => d.shape === 'thull') || big((d) => d.gv && d.control && d.armour && !d.round), tur = big((d) => d.control && d.armour && (d.shape === 'tturret' || d.shape === 'tcast') && d !== (hull && hull.def));
    const C = crewList(parts);
    return { front: hull ? frontOf(hull) : 0, side: hull ? Math.round(faceMm(hull, EZ, 0)) : 0, turretFront: tur ? frontOf(tur) : 0,
      crew: C.crew.length, rounds: C.stores.reduce((s, e) => s + e.cap, 0) };
  }

  return {
    fb, hot: false,
    hitAll, hitFirst, moveShell, netShell, coarseH, resolve, apply, legacyHit, blastK, moduleDown, modDamage, knockOut, crewOf, has, repairStep, partFX, summary,
    hurt, toss, tally, tallyMods,
    seed(n) { vs = mix(n | 0); }, // (the victim's dice: tests)
    _t: { faceMm, effOf, penAt, own, ownOut, crewList, thinnest, frontOf, simOwn, recOwn, recsOf, EZ, ESIDE, ETOP, EBOT }, // (for the tests)
  };
})();
// ==== end of Armour ====
