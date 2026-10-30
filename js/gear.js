'use strict';
// Running gear for ground vehicles (the ground update): tracks and armoured wheels, their suspension, traction
// and skid steering, wading, righting, and collisions between vehicles. Vessel.ground hands a vessel with running
// gear (v.gear, set by rebuildGroups) to Gear.ground as its first line; every other vessel keeps vessel.js's own
// contact code, so old designs never reach this file.
//
// One step (Gear.ground): the ground under the centre of mass (one surfaceAt, deckAt and waterAt), one surfaceAt under
// each running-gear contact, a least-squares plane through those heights (the normal every contact uses: no normalAt
// per contact), and only the hull corners within a band over that plane (an upright tank: its four belly corners).
// Each gear contact is a spring and damper along the plane's normal (a bump stop past its travel), then four
// iterations of accumulated impulses: bump stops and rigid hull corners, traction along each belt toward its side's
// belt speed (out of the engine's power budget when it adds energy; braking is free), sideways grip, hull friction.
// Skid steering comes from the two sides' belt speeds alone: a track's sideways grip resists sliding and rolling but
// never the hull's turn about its centre of mass, so a pivot runs at the speed the belts set, a heavy or weak tank
// turns as its traction and power allow, and one dead track swings the hull round it. Nothing allocates per step.

// (Script-scope names for the globals the step leans on, and its helpers as const functions: in a vm context, as the
// tests and the bench load the game, every look-up of a page global goes through the sandbox and costs about as much
// as the arithmetic around it; in a page they cost nothing either way.)
const gMath = Math, gQrot = qrot, gDot = dot3, gCross = cross3, gNorm = norm3, gLen = len3, gClamp = clamp;
const GEAR = {
  zeta: 0.45, zetaBouncy: 0.08,                      // suspension damping ratio (Silly 'bouncy': it boings)
  wade: { mu: 0.12, v: 2 }, swim: { mu: 0.35, v: 3.5 }, wetSide: 0.15, brokenMu: 0.05, // in water (swim: amph); a dead track
  eta: 0.6, vFloor: 1.5, coast: 0.18, park: 0.3, pivotV: 1.5, // transmission; the power budget's lowest speed; engine braking (g); parking brake below (m/s); A/D alone below: on the spot (m/s)
  crrWheel: 0.015, wheelTurn: 0.6, wheelRev: 0.4,    // armoured wheels: rolling resistance, the skid assist's turn (rad/s), reverse share
  band: 0.6, bandK: 0.02, calls: 15,                 // hull corners probed within this height over the plane (+ per metre out), up to 15 calls a step (+ 1: its air)
  ford: 1.4, dry: 5, limp: 0.2,                      // flooding: deeper than this (m); restarts after `dry` s out of it; a fifth after `dry` s in
  // righting: tipped past 70° for 1.5 s, until within 20°; a torque of m·g·B·rightK, at most rightW rad/s
  tipCos: gMath.cos((70 * gMath.PI) / 180), upCos: gMath.cos((20 * gMath.PI) / 180), tipT: 1.5, rightK: 3, rightW: 2,
  ramV: 6, bumpE: 0.15, bumpMu: 0.3, bumpMax: 0.1,   // collisions: dents above (m/s), restitution, friction, the most a step pushes apart (m)
  bumpLag: 0.3, bumpV: 25,                           // another player's: how long its owner's share shows only in our guess (s); the most closing speed it counts (m/s)
};
const _gU = v3(), _gF = v3(), _gUp = v3(), _gE1 = v3(), _gE2 = v3(), _gN = v3(), _gT = v3(), _gD = v3(), _gA = v3(), _gB = v3(), _gR = v3();
const _gW = [0, 0, 0, 0, 0, 0, 0, 0, 0], _gQ = quat(), _gJ = { x: 0, y: 0, z: 0, a: 0, ax: 0, ay: 0, lat: 0, lx: 0, ly: 0, lz: 0 };
const _gGo = [], _gHo = [], _gHc = [], _gHh = [], _gBrk = [], _gDentP = [], _gDentR = []; // (this step's touching gear and hull contacts; parts to break or dent)
const _gVs = [0, 0], _gOff = [0, 0], _gBud = [0, 0], _gFl = [0, 0], _gCnt = [0, 0], _gSat = [false, false], _gSum = [0, 0], _gSus = [0, 0], _gSN = [0, 0];
const _gBoxA = { c: v3(), u: [v3(), v3(), v3()], e: [0, 0, 0] }, _gBoxB = { c: v3(), u: [v3(), v3(), v3()], e: [0, 0, 0] }, _gL = v3(), _gNb = v3();

// A contact slot: one per gear point, old wheel and hull corner, made once per hull (gearCache) and reused every step.
const gearSlot = (k, kind) => {
  return { k, p: k.p, kind, side: k.side || 0, d: null, track: false, steer: false, trav: 0, kS: 0, cS: 0, muD: 0.9, sideD: 0.6, crr: 0,
    o: v3(), on: false, probed: false, gap: 0, pen: 0, isSide: false, rx: 0, ry: 0, rz: 0,
    t1: v3(), t2: v3(), an: v3(), bn: v3(), en: 0, at: v3(), bt: v3(), et: 0, al: v3(), bl: v3(), el: 0, af: v3(), bf: v3(), ef: 0, q: 0,
    Js: 0, lb: 0, JN: 0, JT: 0, JL: 0, jn: 0, vs: 0, vt: 0, bud: 0, muT: 0, muL: 0, sat: false, lx: 0, ly: 0, lz: 0, hd: 0,
    qb: null, qx: 0, qy: 0, qz: 0, qn: 0, gh: 0, ga: 0, gz: 0 };
};
// What Gear.ground keeps of a vessel's hull between steps, made again when its hull changes (rebuildGroups): the
// slots, the track spacing B, the engines, and the lowest engine part's height over the ground (for flooding); and
// what its mass decides, redone when that changes (a booster burning, a part shot off): the spring rates
// (k = m·g / (N·sag), the sag 0.4 of the travel) and the hull corners' offsets from the centre of mass.
const gearCache = (v) => {
  let C = v._gear;
  if (C && C.wp === v.wheelPts && C.hull === v.hull) { if (C.mass !== v.mass) gearMass(C, v); return C; }
  const last = C ? C.lastGear : 0, com = v.com, D = v.drive;
  C = v._gear = { wp: v.wheelPts, hull: v.hull, mass: 0, g: [], w: [], h: [], eng: [], gp: [], B: 1, L: 1, amph: false, steers: false, engLow: Infinity, lastGear: last,
    m: { qb: null, qx: 0, qy: 0, qz: 0, qn: 0, gh: 0, ga: 0, gz: 0, dk: NaN, water: false } };
  for (const k of v.wheelPts) if (k.gear) C.g.push(gearSlot(k, 0)); else C.w.push(gearSlot(k, 2));
  for (const k of v.hull) C.h.push(gearSlot(k, 1));
  const zs = [0, 0], zn = [0, 0], ax = [0, 0], an = [0, 0];
  let groundY = Infinity;
  for (const s of C.g) {
    const def = s.p.def, d = def.track || def.awheel, k = s.k;
    s.d = d; s.track = !!def.track; s.trav = d.travel || 0;
    s.muD = d.mu ?? 0.9; s.sideD = d.side ?? 0.6; s.crr = d.crr ?? (s.track ? 0.035 : GEAR.crrWheel);
    s.steer = !s.track && (k.x - com.x) * D.F.x + (k.y - com.y) * D.F.y > 0.3; // (armoured wheels ahead of the centre of mass steer)
    if (s.side) { const i = s.side > 0 ? 1 : 0; zs[i] += k.z; zn[i]++; }
    if (!s.track) { const x = (k.x - com.x) * D.F.x + (k.y - com.y) * D.F.y, i = s.steer ? 0 : 1; ax[i] += x; an[i]++; }
    if (s.steer) C.steers = true;
    groundY = gMath.min(groundY, k.y - d.r);
  }
  if (zn[0] && zn[1]) C.B = gMath.max(1, zs[1] / zn[1] - zs[0] / zn[0]);
  if (an[0] && an[1]) C.L = gMath.max(1, ax[0] / an[0] - ax[1] / an[1]); // (armoured wheels: from the steered axles to the rest)
  for (const p of v.gear) { const s = C.g.find((q) => q.p === p); C.gp.push({ p, i: s && s.side > 0 ? 1 : 0, s }); }
  for (const p of v.parts) {
    if (p.def.amph) C.amph = true;
    if (p.def.engine) { C.eng.push(p); C.engLow = gMath.min(C.engLow, partRect(p).b - groundY); }
  }
  if (!v.beltV) v.beltV = [0, 0];
  if (!v.susp) v.susp = [0, 0];
  gearMass(C, v);
  return C;
};
const gearMass = (C, v) => {
  const m = v.mass, com = v.com, cz = com.z || 0, N = gMath.max(1, C.g.length);
  C.mass = m;
  for (const s of C.g) { s.kS = (m * G0) / (N * gMath.max(0.02, 0.4 * s.trav)); s.cS = 2 * gMath.sqrt((s.kS * m) / N); }
  for (const s of C.h) { const k = s.k; s.lx = k.x - com.x; s.ly = k.y - com.y; s.lz = k.z - cz; s.hd = gMath.sqrt(s.lx * s.lx + s.lz * s.lz); } // (how far out across the floor)
};
// The world inverse inertia, I⁻¹ turned by the attitude (R·I⁻¹·Rᵀ, row-major into W): once a step, not per impulse.
const gearInvI = (v, W) => {
  const q = v.q, I = v.I, x = q.x, y = q.y, z = q.z, w = q.w;
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
  const m00 = r00 * I.ixx + r01 * I.ixy + r02 * I.ixz, m01 = r00 * I.ixy + r01 * I.iyy + r02 * I.iyz, m02 = r00 * I.ixz + r01 * I.iyz + r02 * I.izz;
  const m10 = r10 * I.ixx + r11 * I.ixy + r12 * I.ixz, m11 = r10 * I.ixy + r11 * I.iyy + r12 * I.iyz, m12 = r10 * I.ixz + r11 * I.iyz + r12 * I.izz;
  const m20 = r20 * I.ixx + r21 * I.ixy + r22 * I.ixz, m21 = r20 * I.ixy + r21 * I.iyy + r22 * I.iyz, m22 = r20 * I.ixz + r21 * I.iyz + r22 * I.izz;
  W[0] = m00 * r00 + m01 * r01 + m02 * r02; W[1] = m00 * r10 + m01 * r11 + m02 * r12; W[2] = m00 * r20 + m01 * r21 + m02 * r22;
  W[3] = m10 * r00 + m11 * r01 + m12 * r02; W[4] = m10 * r10 + m11 * r11 + m12 * r12; W[5] = m10 * r20 + m11 * r21 + m12 * r22;
  W[6] = m20 * r00 + m21 * r01 + m22 * r02; W[7] = m20 * r10 + m21 * r11 + m22 * r12; W[8] = m20 * r20 + m21 * r21 + m22 * r22;
};
// A contact's row along direction d: a = r × d (less its part about m when m is given: no turn about m), b = I⁻¹·a,
// and the effective mass's inverse. Velocity along a row: v·d + ω·a; an impulse j: v += d·j/m, ω += b·j.
const gearRow = (s, d, a, b, W, invM, m) => {
  a.x = s.ry * d.z - s.rz * d.y; a.y = s.rz * d.x - s.rx * d.z; a.z = s.rx * d.y - s.ry * d.x;
  if (m) { const k = a.x * m.x + a.y * m.y + a.z * m.z; a.x -= m.x * k; a.y -= m.y * k; a.z -= m.z * k; }
  b.x = W[0] * a.x + W[1] * a.y + W[2] * a.z; b.y = W[3] * a.x + W[4] * a.y + W[5] * a.z; b.z = W[6] * a.x + W[7] * a.y + W[8] * a.z;
  return invM + a.x * b.x + a.y * b.y + a.z * b.z;
};
const gearVel = (v, d, a) => { const w = v.av; return v.vx * d.x + v.vy * d.y + v.vz * d.z + w.x * a.x + w.y * a.y + w.z * a.z; };
const gearPush = (v, d, b, j, invM) => {
  const k = j * invM, w = v.av;
  v.vx += d.x * k; v.vy += d.y * k; v.vz += d.z * k; w.x += b.x * j; w.y += b.y * j; w.z += b.z * j;
};
// p added to the first n entries of list (once); the new count
const gearOnce = (list, n, p) => { for (let i = 0; i < n; i++) if (list[i] === p) return n; list[n] = p; return n + 1; };
// Off the ground (or far above it): as vessel.js's clear(), and the running gear's own state at rest
const gearClear = (v) => {
  v.landed = false; v.splashed = false; v.wheelsDown = false; v.contactTime = 0;
  v.canDrive = false; v.drivePower = 0; v.righting = false; v._tipT = 0;
  if (v._gear) v._gear.lastGear = 0;
  if (v.susp) { v.susp[0] = 0; v.susp[1] = 0; }
};
// How far a vessel's box (its body box: what doesn't turn; an old craft's bounds) reaches from its centre of mass
const gearBoxR = (v) => {
  const bb = v.bodyBox || v.bounds, com = v.com;
  if (!bb) return 0;
  const cx = (bb.minX + bb.maxX) / 2 - com.x, cy = (bb.minY + bb.maxY) / 2 - com.y, cz = (bb.minZ + bb.maxZ) / 2 - (com.z || 0);
  const ex = bb.maxX - bb.minX, ey = bb.maxY - bb.minY, ez = bb.maxZ - bb.minZ;
  return gMath.sqrt(cx * cx + cy * cy + cz * cz) + gMath.sqrt(ex * ex + ey * ey + ez * ez) / 2;
};
// That box in the sim: centre, axes, half sizes (into B)
const gearBox = (v, B) => {
  const bb = v.bodyBox || v.bounds, com = v.com, q = v.q;
  if (!bb) return null;
  gQrot(q, (bb.minX + bb.maxX) / 2 - com.x, (bb.minY + bb.maxY) / 2 - com.y, (bb.minZ + bb.maxZ) / 2 - (com.z || 0), B.c);
  B.c.x += v.x; B.c.y += v.y; B.c.z += v.z;
  gQrot(q, 1, 0, 0, B.u[0]); gQrot(q, 0, 1, 0, B.u[1]); gQrot(q, 0, 0, 1, B.u[2]);
  B.e[0] = (bb.maxX - bb.minX) / 2; B.e[1] = (bb.maxY - bb.minY) / 2; B.e[2] = (bb.maxZ - bb.minZ) / 2;
  return B;
};
// One separating axis L (unnormalised) of two boxes: how far they overlap along it (negative: apart), or null when it's
// degenerate (two parallel edges). T: B's centre to A's.
const gearAxis = (A, B, T, L) => {
  const l = gMath.hypot(L.x, L.y, L.z);
  if (l < 1e-6) return null;
  L.x /= l; L.y /= l; L.z /= l;
  let ra = 0, rb = 0;
  for (let i = 0; i < 3; i++) { ra += A.e[i] * gMath.abs(gDot(A.u[i], L)); rb += B.e[i] * gMath.abs(gDot(B.u[i], L)); }
  return ra + rb - gMath.abs(gDot(T, L));
};
// The separating-axis test of two boxes (15 axes): the least overlap and its axis (into n, pointing from B to A), or 0
// when they're apart.
const gearSat = (A, B, n) => {
  const T = _gR; T.x = A.c.x - B.c.x; T.y = A.c.y - B.c.y; T.z = A.c.z - B.c.z;
  let best = Infinity;
  for (let k = 0; k < 15; k++) {
    const L = _gL;
    if (k < 3) { L.x = A.u[k].x; L.y = A.u[k].y; L.z = A.u[k].z; }
    else if (k < 6) { L.x = B.u[k - 3].x; L.y = B.u[k - 3].y; L.z = B.u[k - 3].z; }
    else gCross(A.u[((k - 6) / 3) | 0], B.u[(k - 6) % 3], L);
    let o = gearAxis(A, B, T, L);
    if (o === null) continue;
    if (o <= 0) return 0;
    if (k >= 6) o += 0.01; // (an edge axis only when it's clearly the shallowest: steadier pushes off faces)
    if (o < best) { best = o; const s = gDot(T, L) < 0 ? -1 : 1; n.x = L.x * s; n.y = L.y * s; n.z = L.z * s; }
  }
  return best;
};
// The props a vehicle with running gear meets (props.js): buildings, walls, boulders, sandbags, crates, containers and
// blocks are immovable (we take the whole push, as off a wreck), each a box against the body box (gearSat); restitution
// and friction as for vehicles, and ramming one faster than 6 m/s dents the part that met it. (Trees, hedges, fences,
// bushes and bales fall over instead: Props.crushStep.)
const gearProps = (v, sim) => {
  const rv = gearBoxR(v), L = Props.solidNear(v.x, v.y, v.z, rv + 1);
  if (!L.length) return;
  let A = gearBox(v, _gBoxA);
  if (!A) return;
  for (let n = 0; n < L.length; n++) {
    const B = L[n], nb = _gNb, depth = gearSat(A, B, nb);
    if (!(depth > 0)) continue;
    const push = gMath.min(depth, GEAR.bumpMax);
    v.x += nb.x * push; v.y += nb.y * push; v.z += nb.z * push;
    let ra = 0, rb = 0;
    for (let i = 0; i < 3; i++) { ra += A.e[i] * gMath.abs(gDot(A.u[i], nb)); rb += B.e[i] * gMath.abs(gDot(B.u[i], nb)); }
    const cx = (A.c.x - nb.x * ra + B.c.x + nb.x * rb) / 2, cy = (A.c.y - nb.y * ra + B.c.y + nb.y * rb) / 2, cz = (A.c.z - nb.z * ra + B.c.z + nb.z * rb) / 2;
    A = gearBox(v, _gBoxA); // (moved: its box again for the next)
    const a = v.av, rvx = cx - v.x, rvy = cy - v.y, rvz = cz - v.z;
    const ux = v.vx + a.y * rvz - a.z * rvy, uy = v.vy + a.z * rvx - a.x * rvz, uz = v.vz + a.x * rvy - a.y * rvx, vn = ux * nb.x + uy * nb.y + uz * nb.z;
    if (vn >= 0) continue;
    const k = 1 / v.mass, j = (-(1 + GEAR.bumpE) * vn) / k, Pv = gearLocal(v, cx, cy, cz, _gA);
    v.applyImpulse(Pv, nb, j);
    const tx = ux - nb.x * vn, ty = uy - nb.y * vn, tz = uz - nb.z * vn, vt = gMath.hypot(tx, ty, tz);
    if (vt > 1e-6) { const jt = gMath.min(GEAR.bumpMu * j, vt / k), d = _gR; d.x = -tx / vt; d.y = -ty / vt; d.z = -tz / vt; v.applyImpulse(Pv, d, jt); }
    if (-vn > GEAR.ramV && typeof Combat !== 'undefined' && sim && sim.vessels) {
      const p = gearNearest(v, Pv);
      if (p) Combat.impact(v, p, 0.75 + (-vn - GEAR.ramV) / (4 * (p.def.breakSpeed || DEFAULT_BREAK_SPEED)), sim);
      if (v.dead || !v.parts.length) return;
    }
  }
};
// A sim point in a vessel's part space (out)
const gearLocal = (v, x, y, z, out) => {
  const q = v.q; _gQ.w = q.w; _gQ.x = -q.x; _gQ.y = -q.y; _gQ.z = -q.z;
  gQrot(_gQ, x - v.x, y - v.y, z - v.z, out);
  out.x += v.com.x; out.y += v.com.y; out.z += v.com.z || 0;
  return out;
};
// The part of v nearest a part-space point (for a ram's dent; its box, not its centre): not one inside the hull
const gearNearest = (v, P) => {
  let best = null, bd = Infinity;
  for (const p of v.parts) {
    if (p.def.inner) continue;
    const r = partRect(p), z = partZ(p), hd = partDepth(p) / 2;
    const dx = gMath.max(r.l - P.x, 0, P.x - r.r), dy = gMath.max(r.b - P.y, 0, P.y - r.t), dz = gMath.max(z - hd - P.z, 0, P.z - z - hd), d = dx * dx + dy * dy + dz * dz;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
};

const Gear = {
  calls: 0, // terrain calls made by the last Gear.ground (a test counter: surfaceAt, deckAt, waterAt, heightAt; a normalAt counts 4)

  // ---- contact points (Phase 1)
  // A track's n contact points along its belt (its road wheels), or an armoured wheel's one at its centre, pushed onto
  // the vessel's wheel points (computeHull) so placing on the ground, reach and wheelbase count them. r takes in the
  // suspension's sag at rest (0.4 of its travel), so a vehicle standing still shows its belt on the ground. side: +1
  // right of the centre of mass across (+z), -1 left (cz: its depth).
  points(p, wheels, cz = 0) {
    const d = p.def, z = partZ(p), side = gMath.sign(z - cz);
    if (d.awheel) {
      const c = partPt(p, 0, 0);
      wheels.push({ p, x: c.x, y: c.y, z, r: d.awheel.r + 0.4 * (d.awheel.travel || 0), gear: 1, side, i: 0 });
      return;
    }
    const t = d.track, n = gMath.max(1, t.n | 0), r = t.r + 0.4 * (t.travel || 0);
    for (let i = 0; i < n; i++) {
      const c = partPt(p, n > 1 ? (i / (n - 1) - 0.5) * 0.8 * d.w : 0, -d.h / 2 + t.r);
      wheels.push({ p, x: c.x, y: c.y, z, r, gear: 1, side, i });
    }
  },

  // ---- contacts, suspension, drive (Phase 2A)
  // The crash, dent, bouncy, contactTime, landed and restTime rules are vessel.js's ground() line for line (each copy
  // names the other); the rest is the running gear's own.
  ground(v, dt, sim) {
    const b = v.body, R = b.radius, r = v.radius(), h = dt;
    this.calls = 0;
    if (r - v.reach > R + b.terrainMax + 5) return gearClear(v);
    // the spot under the centre of mass (its height, a deck, water), read again once it has moved half a metre (or 8
    // times a second): it only culls, and says whether it's wading
    const C = gearCache(v), M = C.m, mx = v.x - M.qx, my = v.y - M.qy, mz = v.z - M.qz;
    if (!(M.qn > 0 && M.qb === b && mx * mx + my * my + mz * mz < 0.25)) {
      const L0 = v.surfaceSpot();
      M.ga = L0.a; M.gz = L0.z; M.qb = b; M.qx = v.x; M.qy = v.y; M.qz = v.z; M.qn = 15;
      M.dk = Terrain.deckAt(b, L0.a, L0.z, v.reach + 2); M.gh = Terrain.surfaceAt(b, L0.a, L0.z); // (part of it may be over a carrier's deck)
      M.water = Terrain.waterAt(b, L0.a, L0.z); // (water is the spot's: one call)
      this.calls = 3;
    } else M.qn--;
    const La = M.ga, Lz = M.gz, dk = M.dk, sh = M.gh, water = M.water;
    const h0 = gMath.max(sh, dk === dk ? dk : -Infinity), lim0 = R + h0 + 2 + v.reach * 0.3;
    if (r - v.reach > lim0) { gearClear(v); return this.bump(v, sim); }

    // the frame: up at the centre of mass, the hull's nose and roof, and two level axes for the plane fit; and where
    // the centre of mass is on the surface (angle, depth) with how both change across the craft, so a probe's spot is a
    // dot product away (Terrain.locate's, to well under a millimetre over a vehicle's few metres)
    const q = v.q, com = v.com, cz = com.z || 0, D = v.drive, U = _gU, E1 = _gE1, E2 = _gE2, nG = _gN, J = _gJ;
    U.x = v.x / r; U.y = v.y / r; U.z = v.z / r;
    const rxy2 = v.x * v.x + v.y * v.y || 1e-9, lat = gMath.asin(gClamp(U.z, -1, 1)), kl = 1 / (r * gMath.max(1e-6, gMath.cos(lat)));
    J.x = v.x; J.y = v.y; J.z = v.z; J.a = gMath.atan2(v.y, v.x); J.ax = -v.y / rxy2; J.ay = v.x / rxy2;
    J.lat = lat; J.lx = -U.z * U.x * kl; J.ly = -U.z * U.y * kl; J.lz = (1 - U.z * U.z) * kl;
    const Fh = gQrot(q, D.F.x, D.F.y, D.F.z, _gF), Uh = gQrot(q, D.U.x, D.U.y, D.U.z, _gUp);
    let k = gDot(Fh, U);
    E1.x = Fh.x - U.x * k; E1.y = Fh.y - U.y * k; E1.z = Fh.z - U.z * k;
    if (gLen(E1) < 0.2) { k = gDot(Uh, U); E1.x = Uh.x - U.x * k; E1.y = Uh.y - U.y * k; E1.z = Uh.z - U.z * k; } // (standing on its nose or tail)
    gNorm(E1); gCross(U, E1, E2);

    // 1-2. one surfaceAt under each gear contact, and a least-squares plane through those ground heights (in the level
    // axes about the centre of mass: height pa + pb·u + pc·w along U)
    let n = 0, su = 0, sw = 0, ss = 0, suu = 0, sww = 0, suw = 0, sus = 0, sws = 0;
    for (const s of C.g) {
      const kk = s.k, o = gQrot(q, kk.x - com.x, kk.y - com.y, kk.z - cz, s.o);
      s.on = false; s.probed = false;
      const px = v.x + o.x, py = v.y + o.y, pz = v.z + o.z, pr = gMath.sqrt(px * px + py * py + pz * pz);
      if (pr - kk.r > lim0) continue;
      const gh = this.ht(s, b, px, py, pz), f = (R + gh) / pr;
      s.probed = true; s.gap = pr - kk.r - R - gh;
      const gx = px * f - v.x, gy = py * f - v.y, gz = pz * f - v.z, u = gx * E1.x + gy * E1.y + gz * E1.z, w = gx * E2.x + gy * E2.y + gz * E2.z, hh = gx * U.x + gy * U.y + gz * U.z;
      n++; su += u; sw += w; ss += hh; suu += u * u; sww += w * w; suw += u * w; sus += u * hh; sws += w * hh;
    }
    let fit = false, pa = 0, pb = 0, pc = 0;
    if (n >= 3) {
      const mu = su / n, mw = sw / n, ms = ss / n, cuu = suu / n - mu * mu, cww = sww / n - mw * mw, cuw = suw / n - mu * mw, cus = sus / n - mu * ms, cws = sws / n - mw * ms;
      const det = cuu * cww - cuw * cuw, tr = cuu + cww, lmin = (tr - gMath.sqrt(gMath.max(0, tr * tr - 4 * det))) / 2;
      if (lmin > 0.04) { pb = (cus * cww - cws * cuw) / det; pc = (cws * cuu - cus * cuw) / det; pa = ms - pb * mu - pc * mw; fit = true; } // (spread both ways: not one track's line)
    }
    if (fit) { nG.x = U.x - pb * E1.x - pc * E2.x; nG.y = U.y - pb * E1.y - pc * E2.y; nG.z = U.z - pb * E1.z - pc * E2.z; gNorm(nG); }
    else { // no plane (one track down, on its side or roof): the ground's own normal under the centre of mass
      Terrain.normalAt(b, La, Lz, nG); this.calls += 4;
      const cu = gDot(nG, U) || 1;
      pa = R + h0 - r; pb = -gDot(nG, E1) / cu; pc = -gDot(nG, E2) / cu;
    }
    const cosU = gDot(nG, U);
    let nG0 = 0; // gear contacts touching
    for (const s of C.g) if (s.probed) { s.pen = -s.gap * cosU; if (s.pen > 0) { s.on = true; _gGo[nG0++] = s; } }

    // 3-4. hull corners: with the gear down last step, only those within a band over the plane (an upright tank's belly;
    // a crest under it scrapes); otherwise every one near the ground, so a rollover is caught. Old Car Wheels: rigid.
    const band = fit && C.lastGear > 0;
    let nH = 0, wheelOn = 0, nc = 0;
    if (band) { // (in part space: the plane's normal turned back into the hull, so a corner well clear costs one dot product)
      _gQ.w = q.w; _gQ.x = -q.x; _gQ.y = -q.y; _gQ.z = -q.z;
      const nP = gQrot(_gQ, nG.x, nG.y, nG.z, _gD), h0p = pa * cosU;
      for (const s of C.h) {
        s.on = false;
        const hp = s.lx * nP.x + s.ly * nP.y + s.lz * nP.z - h0p;
        if (hp > GEAR.band + GEAR.bandK * s.hd) continue;
        gQrot(q, s.lx, s.ly, s.lz, s.o);
        _gHc[nc] = s; _gHh[nc++] = hp;
      }
    } else for (const s of C.h) {
      const o = gQrot(q, s.lx, s.ly, s.lz, s.o), px = v.x + o.x, py = v.y + o.y, pz = v.z + o.z;
      s.on = false;
      if (gMath.sqrt(px * px + py * py + pz * pz) <= lim0 && this.corner(v, s, b, R)) _gHo[nH++] = s;
    }
    if (band) { // (the lowest first, as many as keep an upright step within its terrain calls: skirts and plates low on
      // the hull add corners of their own)
      const cap = gMath.max(4, GEAR.calls - 3 - n); // (the spot's three kept for, whether read this step or not)
      for (let i = 0; i < nc && i < cap; i++) {
        let m = i;
        for (let j = i + 1; j < nc; j++) if (_gHh[j] < _gHh[m]) m = j;
        if (m !== i) { const t = _gHc[i], th = _gHh[i]; _gHc[i] = _gHc[m]; _gHh[i] = _gHh[m]; _gHc[m] = t; _gHh[m] = th; }
        if (this.corner(v, _gHc[i], b, R)) _gHo[nH++] = _gHc[i];
      }
    }
    for (const s of C.w) {
      const kk = s.k;
      s.on = false;
      if (kk.retract && v.gearUp) continue;
      const o = gQrot(q, kk.x - com.x, kk.y - com.y, kk.z - cz, s.o), px = v.x + o.x, py = v.y + o.y, pz = v.z + o.z, pr = gMath.sqrt(px * px + py * py + pz * pz);
      if (pr - kk.r > lim0) continue;
      const pen = (R + this.ht(s, b, px, py, pz) - (pr - kk.r)) * cosU;
      if (pen <= 0) continue;
      s.on = true; s.pen = pen; s.isSide = false; s.rx = o.x - nG.x * kk.r; s.ry = o.y - nG.y * kk.r; s.rz = o.z - nG.z * kk.r;
      _gHo[nH++] = s; wheelOn++;
    }
    C.lastGear = nG0;
    if (!nG0 && !nH) { gearClear(v); return this.bump(v, sim); }
    // a gear contact acts at the ground under its road wheel
    for (let i = 0; i < nG0; i++) { const s = _gGo[i], o = s.o, e = s.k.r - s.pen; s.rx = o.x - nG.x * e; s.ry = o.y - nG.y * e; s.rz = o.z - nG.z * e; }

    // 5. crash check, as vessel.js's ground(): far past a part's limit it breaks at once; a bit past it (or near it),
    // it's dented. Every contact here pushes along the plane's normal.
    const combat = typeof Combat !== 'undefined', bouncy = Silly.on('bouncy'), av = v.av;
    let nB = 0, nD = 0, sideHit = false;
    for (let i = 0; i < nG0 + nH; i++) {
      const s = i < nG0 ? _gGo[i] : _gHo[i - nG0], p = s.p;
      const vn = (v.vx + av.y * s.rz - av.z * s.ry) * nG.x + (v.vy + av.z * s.rx - av.x * s.rz) * nG.y + (v.vz + av.x * s.ry - av.y * s.rx) * nG.z;
      const lim = (p.def.breakSpeed || DEFAULT_BREAK_SPEED) * (water ? 1.8 : 1), sp = -vn;
      if (s.isSide) sideHit = true;
      if (s.isSide || sp > lim * (combat ? 1.6 : 1)) nB = gearOnce(_gBrk, nB, p);
      else if (combat && sp > lim * 0.75) {
        let j = 0; while (j < nD && _gDentP[j] !== p) j++;
        if (j === nD) { _gDentP[nD] = p; _gDentR[nD++] = sp / lim; } else _gDentR[j] = gMath.max(_gDentR[j], sp / lim);
      }
      // a spinning propeller or rotor that touches the ground shatters
      const air = p.def.air;
      if (air && (air.kind === 'prop' || air.kind === 'rotor') && (p.rpm || 0) > 8 && !water) nB = gearOnce(_gBrk, nB, p);
    }
    if (nB && (!bouncy || sideHit)) { const list = _gBrk.slice(0, nB); _gBrk.length = 0; sim.breakParts(v, list, 'impact'); return; }
    if (nD && sim.vessels && !bouncy) for (let j = 0; j < nD; j++) Combat.impact(v, _gDentP[j], _gDentR[j], sim);
    if (v.dead || !v.parts.length || v._gear !== C || C.wp !== v.wheelPts) return; // (a dent that cost a part changed the craft: next step)
    const bounce = bouncy ? 0.75 : 0;

    // the engine, the running gear that still works, and what the stick asks of them
    let P = 0;
    for (const p of C.eng) if (!p.broken) P += p.def.engine.kw * 1000 * (combat && p.hp != null ? Combat.engineK(p) : 1); // (a damaged engine gives less)
    if (typeof Armour !== 'undefined' && !Armour.has(v, 'driver')) P = 0;
    if (v.flooded) P *= v._floodT > GEAR.dry ? GEAR.limp : 0;
    let vmax = Infinity, load = 0, rev = 1, turn = Infinity, live = 0;
    for (const p of v.gear) {
      if (p.broken) continue;
      const g = p.def.track || p.def.awheel;
      live++; vmax = gMath.min(vmax, g.vmax || 12); load += g.load || 0;
      rev = gMath.min(rev, g.rev ?? (p.def.track ? 0.35 : GEAR.wheelRev));
      if (p.def.track) turn = gMath.min(turn, g.turn ?? 0.6);
    }
    if (turn === Infinity) turn = 0;
    const mt = v.mass / 1000, wet = water ? (C.amph ? GEAR.swim : GEAR.wade) : null;
    let Vmax = live ? vmax * gClamp(load / mt, 0.5, 1) : 0;
    if (wet) Vmax = gMath.min(Vmax, wet.v);
    const Vrev = Vmax * rev, canDrive = nG0 > 0 && live > 0 && P > 0, ctl = v.ctl;
    const cv = canDrive ? ctl.v : 0, ch = canDrive ? ctl.h : 0, input = cv !== 0 || ch !== 0, vn0 = v.vx * nG.x + v.vy * nG.y + v.vz * nG.z;
    const gx0 = v.vx - nG.x * vn0, gy0 = v.vy - nG.y * vn0, gz0 = v.vz - nG.z * vn0;
    const vg = gMath.sqrt(gx0 * gx0 + gy0 * gy0 + gz0 * gz0); // (along the ground: a landing's bounce doesn't count)
    const mode = v.brake || (!input && vg < GEAR.park) ? 0 : !input ? 1 : 2; // 0 braking (a parking brake below 0.3 m/s), 1 coasting, 2 driving
    // forward along the ground, the belt speeds: D turns right (the left belt faster), A/D alone counter-rotate the
    // belts (a neutral turn); reversing steers like a car's tail; wider turns at speed, slower ones on a weak engine
    const tc = _gT; k = gDot(Fh, nG); tc.x = Fh.x - nG.x * k; tc.y = Fh.y - nG.y * k; tc.z = Fh.z - nG.z * k; gNorm(tc);
    const vF = v.vx * tc.x + v.vy * tc.y + v.vz * tc.z;
    // (A/D alone while moving: the belts' mean follows the hull's own speed, slowing as coasting would, so it turns as
    // it rolls to a stop rather than braking first and pivoting after. Tracks nearly still hold it at 0: a neutral turn
    // on the spot that the brakes hold on a slope, where following its own speed gravity would roll it back and the
    // reversing rule flip the turn. Wheels have no pivot: their skid assist drives them round a circle, with A/D alone;
    // it fades out as the stick goes up (P4 play-test: with the throttle on as well it held an 8×8 to 6 km/h).)
    const roll = turn > 0 && gMath.abs(vF) < GEAR.pivotV ? 0 : gMath.max(0, gMath.abs(vF) - GEAR.coast * G0 * h) * gMath.sign(vF);
    const base = cv > 0 ? cv * Vmax : cv < 0 ? cv * Vrev : gClamp(roll, -Vrev, Vmax), str = ch * (base < -0.1 ? -1 : 1);
    const pk = gMath.min(1, gMath.sqrt(P / 1000 / mt / 12)), slow = 1 - 0.55 * gMath.min(1, gMath.abs(vF) / gMath.max(Vmax, 0.1));
    const yawCap = 1.15 * turn * pk, om = str * turn * pk * slow, omW = gMath.abs(vF) < 3 ? 0.3 * str * GEAR.wheelTurn * pk * slow * (1 - gMath.abs(cv)) : 0, half = C.B / 2;
    // (armoured wheels ahead steer as a car's do, less the faster it goes: a turn of about 0.45 g, within their grip)
    const delta = ch * gMath.min(0.5, (0.45 * G0 * C.L) / gMath.max(1, vF * vF)), cs = gMath.cos(delta), sn = gMath.sin(delta);

    // the rows of every touching contact, once a step (the world inverse inertia, then r × d and I⁻¹(r × d))
    const W = _gW, invM = 1 / v.mass;
    gearInvI(v, W);
    _gVs[0] = _gVs[1] = 0; _gOff[0] = _gOff[1] = 0; _gCnt[0] = _gCnt[1] = 0; _gSat[0] = _gSat[1] = false;
    for (let i = 0; i < nG0; i++) {
      const s = _gGo[i], t1 = s.t1, t2 = s.t2, si = s.side > 0 ? 1 : 0;
      if (s.steer) { // the rolling direction turned by the steering, toward the right (t × n) for D
        const rx = tc.y * nG.z - tc.z * nG.y, ry = tc.z * nG.x - tc.x * nG.z, rz = tc.x * nG.y - tc.y * nG.x;
        t1.x = tc.x * cs + rx * sn; t1.y = tc.y * cs + ry * sn; t1.z = tc.z * cs + rz * sn;
      } else { t1.x = tc.x; t1.y = tc.y; t1.z = tc.z; }
      gCross(nG, t1, t2);
      s.en = gearRow(s, nG, s.an, s.bn, W, invM);
      s.et = gearRow(s, t1, s.at, s.bt, W, invM);
      s.el = gearRow(s, t2, s.al, s.bl, W, invM, s.track ? nG : null); // (a track's grip: not about the plane's normal...)
      if (s.track) { s.ef = gearRow(s, t2, s.af, s.bf, W, invM); s.q = s.af.x * nG.x + s.af.y * nG.y + s.af.z * nG.z; } // (...below its pivot rate: the full row past it)
      const broken = s.p.broken;
      s.muT = broken ? GEAR.brokenMu : wet ? wet.mu : s.muD; s.muL = wet ? GEAR.wetSide : s.sideD;
      s.Js = 0; s.lb = 0; s.JT = 0; s.JL = 0; s.sat = false; s.vs = 0;
      if (!broken) { _gVs[si] += gearVel(v, t1, s.at); _gOff[si] += s.side * (s.track ? om : omW); _gCnt[si]++; } // (each side's speed: its working gear's)
    }
    for (let i = 0; i < nH; i++) {
      const s = _gHo[i];
      s.en = gearRow(s, nG, s.an, s.bn, W, invM);
      if (s.kind === 2) { s.t1.x = tc.x; s.t1.y = tc.y; s.t1.z = tc.z; gCross(nG, s.t1, s.t2); s.et = gearRow(s, s.t1, s.at, s.bt, W, invM); s.el = gearRow(s, s.t2, s.al, s.bl, W, invM); }
    }
    // suspension: each contact's spring and damper, once, along the plane's normal (pen past the travel: a bump stop)
    const zeta = bouncy ? GEAR.zetaBouncy : GEAR.zeta;
    _gSum[0] = _gSum[1] = 0;
    for (let i = 0; i < nG0; i++) { const s = _gGo[i]; s.Js = gMath.max(0, s.kS * gMath.min(s.pen, s.trav) - zeta * s.cS * gearVel(v, nG, s.an)) * h; _gSum[s.side > 0 ? 1 : 0] += s.Js; }
    for (let i = 0; i < nG0; i++) { const s = _gGo[i]; gearPush(v, nG, s.bn, s.Js, invM); s.JN = s.Js; }
    // the belt speeds: the sides' difference is held as the transmission holds it, so while the engine can't yet reach
    // the speed asked (pulling away, climbing) the turn still happens: the outer side drives, the inner one is held back.
    // Their mean goes there as fast as the power lets it; slowing down, at once (braking is free).
    if (mode === 2) {
      // (one side dead: the live side's speed less its share of the turn, or the mean would hold it back as it turns)
      const cur = _gCnt[0] && _gCnt[1] ? (_gVs[0] / _gCnt[0] + _gVs[1] / _gCnt[1]) / 2 : _gCnt[0] || _gCnt[1] ? (_gVs[0] + _gVs[1] + (_gOff[0] + _gOff[1]) * half) / (_gCnt[0] + _gCnt[1]) : vF;
      const gain = (h * GEAR.eta * P) / gMath.max(gMath.abs(cur), GEAR.vFloor) / v.mass; // (what the engine can add this step)
      const c = base * cur >= 0 && gMath.abs(base) > gMath.abs(cur) ? cur + gClamp(base - cur, -gain, gain) : base;
      // (an armoured wheel rolls at its own speed round the turn the hull is making, as an open differential lets it)
      const wy0 = av.x * nG.x + av.y * nG.y + av.z * nG.z;
      for (let i = 0; i < nG0; i++) {
        const s = _gGo[i];
        if (s.p.broken) { s.vs = 0; continue; } // (a dead track or wheel doesn't run: its side drags, and the hull swings round it)
        if (s.track) { s.vs = c - s.side * om * half; continue; }
        const t1 = s.t1, turn1 = (nG.y * s.rz - nG.z * s.ry) * t1.x + (nG.z * s.rx - nG.x * s.rz) * t1.y + (nG.x * s.ry - nG.y * s.rx) * t1.z; // ((n × r)·t)
        s.vs = c - s.side * omW * half + wy0 * turn1;
      }
    }
    // each side's power budget this step: half the engine through the transmission, as an impulse at the side's speed,
    // shared among its contacts by the load they carry; coasting, the engine brakes at 0.18 g (on a slope, as well as
    // holding it there), shared the same way
    for (let i = 0; i < 2; i++) {
      const vs = _gCnt[i] ? gMath.abs(_gVs[i] / _gCnt[i]) : 0;
      _gFl[i] = gMath.max(vs, GEAR.vFloor); _gBud[i] = (h * 0.5 * GEAR.eta * P) / _gFl[i] / (_gSum[i] || 1);
    }
    const coastK = ((GEAR.coast + gMath.sqrt(gMath.max(0, 1 - cosU * cosU))) * v.mass * G0 * h) / (_gSum[0] + _gSum[1] || 1);
    let used = 0;
    for (let i = 0; i < nG0; i++) { const s = _gGo[i]; s.bud = mode === 2 ? _gBud[s.side > 0 ? 1 : 0] * s.Js : mode === 1 ? coastK * s.Js : 0; }

    const vx0 = v.vx, vy0 = v.vy, vz0 = v.vz;
    for (let it = 0; it < 4; it++) {
      let most = 0; // (the largest impulse this iteration: once they're all tiny, the rest would change nothing)
      // 1. rigid normals: hull corners and old wheels (as vessel.js's), bump stops (accumulated)
      for (let i = 0; i < nH; i++) {
        const s = _gHo[i], vn = gearVel(v, nG, s.an);
        if (vn >= 0) { s.jn = 0; continue; }
        s.jn = (-vn * (vn < -2 ? 1 + bounce : 1)) / s.en;
        gearPush(v, nG, s.bn, s.jn, invM); if (s.jn > most) most = s.jn;
      }
      for (let i = 0; i < nG0; i++) {
        const s = _gGo[i];
        if (s.pen <= s.trav) continue;
        const lb = gMath.max(0, s.lb - gearVel(v, nG, s.an) / s.en);
        gearPush(v, nG, s.bn, lb - s.lb, invM); most = gMath.max(most, gMath.abs(lb - s.lb)); s.lb = lb; s.JN = s.Js + lb;
      }
      // 2. traction along each belt: toward its belt speed within its grip; an impulse that adds energy comes out of its
      // side's power budget (braking is free), and coasting brakes no harder than the engine does
      for (let i = 0; i < nG0; i++) {
        const s = _gGo[i], vt = gearVel(v, s.t1, s.at), cap = s.muT * s.JN;
        let J = gClamp(s.JT + (s.vs - vt) / s.et, -cap, cap);
        s.sat = J === cap || J === -cap;
        let dJ = J - s.JT;
        if (mode === 2 && dJ * (vt + (dJ * s.et) / 2) > 0) { // (it adds energy: driving; one that takes it away brakes)
          if (gMath.abs(dJ) > s.bud) { dJ = gMath.sign(dJ) * s.bud; s.sat = false; }
          s.bud -= gMath.abs(dJ); used += gMath.abs(dJ) * _gFl[s.side > 0 ? 1 : 0];
        } else if (mode === 1 && gMath.abs(s.JT + dJ) > s.bud) { dJ = gMath.sign(s.JT + dJ) * s.bud - s.JT; s.sat = false; }
        if (dJ) { s.JT += dJ; gearPush(v, s.t1, s.bt, dJ, invM); most = gMath.max(most, gMath.abs(dJ)); }
      }
      // 3. sideways grip (0.15 in water). A track's resists its sliding and rolling but not the hull's turn, up to the
      // pivot rate its tracks and engine give (skid steering); a turn faster than that (a dead track swinging it, a
      // shove) it scrubs off. An armoured wheel's resists all of it, as a car's tyre does.
      const wy = av.x * nG.x + av.y * nG.y + av.z * nG.z, free = gMath.abs(wy) <= yawCap;
      for (let i = 0; i < nG0; i++) {
        const s = _gGo[i], cap = s.muL * s.JN, full = s.track && !free;
        const slip = full ? gearVel(v, s.t2, s.af) - gMath.sign(wy) * yawCap * s.q : gearVel(v, s.t2, s.al);
        const J = gClamp(s.JL - slip / (full ? s.ef : s.el), -cap, cap);
        if (J !== s.JL) { gearPush(v, s.t2, full ? s.bf : s.bl, J - s.JL, invM); most = gMath.max(most, gMath.abs(J - s.JL)); s.JL = J; }
      }
      // 4. friction at the hull corners as vessel.js's (0.9, 0.15 on water); old Car Wheels roll free
      for (let i = 0; i < nH; i++) {
        const s = _gHo[i], jn = s.jn;
        if (!(jn > 0)) continue;
        if (s.kind === 2) {
          const m1 = v.brake ? 0.8 : 0.025, m2 = water ? 0.15 : 0.8;
          const j1 = gClamp(-gearVel(v, s.t1, s.at) / s.et, -m1 * jn, m1 * jn), j2 = gClamp(-gearVel(v, s.t2, s.al) / s.el, -m2 * jn, m2 * jn);
          gearPush(v, s.t1, s.bt, j1, invM); gearPush(v, s.t2, s.bl, j2, invM); most = gMath.max(most, gMath.abs(j1), gMath.abs(j2));
          continue;
        }
        const wx = v.vx + av.y * s.rz - av.z * s.ry, wy = v.vy + av.z * s.rx - av.x * s.rz, wz = v.vz + av.x * s.ry - av.y * s.rx, vnn = wx * nG.x + wy * nG.y + wz * nG.z;
        const d = _gD; d.x = wx - nG.x * vnn; d.y = wy - nG.y * vnn; d.z = wz - nG.z * vnn;
        const vt = gLen(d);
        if (vt < 1e-6) continue;
        d.x /= vt; d.y /= vt; d.z /= vt;
        const em = gearRow(s, d, _gA, _gB, W, invM), j = gMath.max(-vt / em, -(water ? 0.15 : 0.9) * jn);
        gearPush(v, d, _gB, j, invM); most = gMath.max(most, -j);
      }
      if (most * invM < 1e-6) break;
    }
    // braking or parked, the grip also takes back the step gravity moved it along the ground (the step integrated its
    // position before the contacts acted), so a parked tank doesn't creep down a slope
    if (mode === 0) {
      const dx = v.vx - vx0, dy = v.vy - vy0, dz = v.vz - vz0, dn = dx * nG.x + dy * nG.y + dz * nG.z;
      v.x += (dx - nG.x * dn) * h; v.y += (dy - nG.y * dn) * h; v.z += (dz - nG.z * dn) * h;
    }
    // push out of the ground: the deepest hull corner, or the deepest bump stop past its travel
    let maxPen = 0;
    for (let i = 0; i < nH; i++) if (_gHo[i].pen > maxPen) maxPen = _gHo[i].pen;
    for (let i = 0; i < nG0; i++) { const e = _gGo[i].pen - _gGo[i].trav; if (e > maxPen) maxPen = e; }
    if (maxPen > 0) { v.x += nG.x * maxPen * 0.9; v.y += nG.y * maxPen * 0.9; v.z += nG.z * maxPen * 0.9; }
    // rolling resistance against the centre of mass's speed along the ground, never reversing it: crr·m·g at top speed,
    // less when slower (track losses grow with speed), so a weak tank still gets going. (The water drags instead.)
    if (nG0 && !water) {
      let crr = 0;
      for (let i = 0; i < nG0; i++) crr += _gGo[i].crr;
      const vn = v.vx * nG.x + v.vy * nG.y + v.vz * nG.z, hx = v.vx - nG.x * vn, hy = v.vy - nG.y * vn, hz = v.vz - nG.z * vn, vh = gMath.sqrt(hx * hx + hy * hy + hz * hz);
      if (vh > 1e-9) { const f = gMath.min(vh, (crr / nG0) * gMath.min(1, vh / gMath.max(Vmax, 1)) * G0 * h) / vh; v.vx -= hx * f; v.vy -= hy * f; v.vz -= hz * f; }
    }
    // ploughing through water (vessel.js's damping)
    if (water) { const e = gMath.exp(-0.6 * dt); v.vx *= e; v.vy *= e; v.vz *= e; av.x *= e; av.y *= e; av.z *= e; }

    // what the renderer, the HUD and the sound read: each side's belt speed (a belt slipping at full grip shows its own
    // speed), its mean compression, the belts' and wheels' travel, the power in use
    _gSus[0] = _gSus[1] = 0; _gSN[0] = _gSN[1] = 0; _gVs[0] = _gVs[1] = 0; _gCnt[0] = _gCnt[1] = 0;
    for (const s of C.g) { const si = s.side > 0 ? 1 : 0; _gSN[si]++; if (s.on) _gSus[si] += gMath.min(s.pen, s.trav); }
    for (let i = 0; i < nG0; i++) {
      const s = _gGo[i], si = s.side > 0 ? 1 : 0;
      s.vt = gearVel(v, s.t1, s.at); _gVs[si] += s.vt; _gCnt[si]++;
      if (mode === 2 && s.sat && !s.p.broken && gMath.abs(s.vs - s.vt) > 0.5) _gSat[si] = true;
    }
    const bv = v.beltV;
    for (let i = 0; i < 2; i++) {
      v.susp[i] = _gSN[i] ? _gSus[i] / _gSN[i] : 0;
      const tgt = mode === 2 ? base - (i ? 1 : -1) * om * half : 0;
      bv[i] = _gCnt[i] ? (_gSat[i] ? tgt : _gVs[i] / _gCnt[i]) : bv[i] + (tgt - bv[i]) * gMath.min(1, 3 * h);
    }
    for (const g of C.gp) {
      const p = g.p;
      if (p.broken) continue; // (a broken track or wheel stays where it stopped)
      if (p.def.track) p.belt = ((p.belt || 0) + bv[g.i] * h) % 60;
      else p.spin = ((p.spin || 0) - ((g.s && g.s.on ? g.s.vt : bv[g.i]) / p.def.awheel.r) * h) % TAU;
    }
    v.drivePower = used / (h * GEAR.eta);
    v.canDrive = canDrive;
    v.wheelsDown = nG0 > 0 || wheelOn > 0;
    v.wheelSpeed = _gCnt[0] && _gCnt[1] ? (bv[0] + bv[1]) / 2 : vF;
    v.steer = C.steers ? delta : 0;
    v.splashed = water;
    v.onFloats = false;

    // landing and rest, as vessel.js's, but at rest only the speed along the ground stops: the springs carry the weight
    // (zeroing all of it each step would let gravity sink the hull onto its bump stops)
    v.contactTime += dt;
    const sp = v.speed();
    v.landed = v.contactTime > 0.2 && sp < 1.5;
    if (v.landed && mode !== 2 && sp < 0.15 && gLen(v.av) < 0.05 && v.thrust < v.mass * 0.2) {
      v.restTime += dt;
      if (v.restTime > 0.5) { const vn = v.vx * nG.x + v.vy * nG.y + v.vz * nG.z; v.vx = nG.x * vn; v.vy = nG.y * vn; v.vz = nG.z * vn; v.av.x *= 0.5; v.av.y *= 0.5; v.av.z *= 0.5; }
    } else v.restTime = 0;

    // flooding: water deeper than the ford over the lowest engine part (an amphibious hull floats). The engine stops,
    // coughs back at a fifth of its power after 5 s so the crew can crawl out, and runs again 5 s out of the water.
    if (C.eng.length && !C.amph) {
      let deep = false;
      if (water) { const depth = sh - Terrain.heightAt(b, La, Lz); this.calls++; deep = depth > GEAR.ford && depth > C.engLow; }
      if (deep) {
        if (!v.flooded) { v.flooded = true; v._floodT = 0; if (v === sim.active) sim.toast('Engine flooded!', 'warn'); }
        else v._floodT += dt;
        v._dryT = 0;
      } else if (v.flooded) {
        v._floodT += dt;
        if (!water) v._dryT = (v._dryT || 0) + dt;
        if (v._dryT >= GEAR.dry) { v.flooded = false; v._dryT = 0; if (v === sim.active) sim.toast('Engine restarted'); }
      }
    }

    // righting: on its side or roof (the hull's up over 70° from the ground's) for 1.5 s, nearly still: a torque of
    // 3·m·g·B rolls it back until it's within 20° of upright, never faster than 2 rad/s (only when it's stuck)
    const ud = gDot(Uh, nG);
    if (v.righting) { v._rightT += dt; if (ud > GEAR.upCos || v._rightT > 6) { v.righting = false; v._tipT = 0; } } // (it may roll faster than 3 m/s on its way back; wedged, it tries again)
    else { v._tipT = ud < GEAR.tipCos && sp < 3 ? (v._tipT || 0) + dt : 0; if (v._tipT > GEAR.tipT) { v.righting = true; v._rightT = 0; } }
    if (v.righting) {
      const a = gCross(Uh, nG, _gA);
      if (gLen(a) < 0.05) { a.x = Fh.x; a.y = Fh.y; a.z = Fh.z; } // (upside down: roll it over sideways)
      gNorm(a);
      const tq = GEAR.rightK * v.mass * G0 * C.B * h, B = _gB;
      B.x = (W[0] * a.x + W[1] * a.y + W[2] * a.z) * tq; B.y = (W[3] * a.x + W[4] * a.y + W[5] * a.z) * tq; B.z = (W[6] * a.x + W[7] * a.y + W[8] * a.z) * tq;
      const room = GEAR.rightW - gDot(av, a), gain = gDot(B, a);
      if (room > 0 && gain > 0) { const f = gMath.min(1, room / gain); av.x += B.x * f; av.y += B.y * f; av.z += B.z * f; }
    }
    this.bump(v, sim);
  },

  // The ground's height under a probe at a sim point: one surfaceAt, or its last height again while the probe has moved
  // less than 2 mm since (a parked vehicle's; re-read once a second, so a map that loads under it is seen)
  ht(s, b, px, py, pz) {
    const dx = px - s.qx, dy = py - s.qy, dz = pz - s.qz;
    if (s.qn > 0 && s.qb === b && dx * dx + dy * dy + dz * dz < 4e-6) { s.qn--; return s.gh; }
    const J = _gJ, ex = px - J.x, ey = py - J.y, ez = pz - J.z;
    s.qb = b; s.qx = px; s.qy = py; s.qz = pz; s.qn = 120;
    s.ga = J.a + J.ax * ex + J.ay * ey; s.gz = (J.lat + J.lx * ex + J.ly * ey + J.lz * ez) * b.radius;
    this.calls++;
    return (s.gh = Terrain.surfaceAt(b, s.ga, s.gz));
  },
  // One hull corner (its offset s.o already turned): true when it's in the ground
  corner(v, s, b, R) {
    const o = s.o, px = v.x + o.x, py = v.y + o.y, pz = v.z + o.z, pr = gMath.sqrt(px * px + py * py + pz * pz);
    const pen = R + this.ht(s, b, px, py, pz) - pr;
    if (pen <= 0) return false;
    // deep under a deck's edge: that's the ship's side, not the deck (a crash, not a lift onto it)
    let side = false;
    if (pen > 4) { const d = Terrain.deckAt(b, s.ga, s.gz); this.calls++; side = d === d; }
    s.on = true; s.pen = pen; s.isSide = side; s.rx = o.x; s.ry = o.y; s.rz = o.z;
    return true;
  },

  // ---- collisions between vehicles (Phase 2A)
  // A local vessel with running gear against every other vessel near it: body boxes (what doesn't turn; an old craft's
  // bounds), spheres first, then the separating-axis test. Ground AI moving itself and wrecks don't move: we take the
  // whole push. Another local vessel (a second tank, an old car, debris) shares it by mass and takes the equal and
  // opposite impulse, so a tank shoves a buggy; old vessels never start a bump, so two of them still pass through each
  // other. Another player's vehicle shares it by mass too, but its owner resolves their own share on their screen: we
  // take only ours, and guess theirs until its snapshots show it (bumpLag), so two players ramming end as two local
  // tanks do. Its closing speed counts up to bumpV (a peer's numbers are untrusted), and another player's aircraft
  // (which never bumps on its owner's screen) passes through. Ramming faster than 6 m/s dents the parts that met (local
  // damage only).
  bump(v, sim) {
    if (typeof Props !== 'undefined' && v.parts.length) gearProps(v, sim);
    const list = sim && sim.vessels;
    if (!list || list.length < 2 || !v.parts.length) return;
    const rv = gearBoxR(v);
    let A = null, fresh = false;
    for (const o of list) {
      if (o === v || o.dead || !o.parts || !o.parts.length || o.body !== v.body || (o.remote && !o.wreck && !isGround(o.kind))) continue;
      const dx = o.x - v.x, dy = o.y - v.y, dz = o.z - v.z, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 2500) continue; // (50 m: nothing a vehicle's box reaches)
      const rr = rv + gearBoxR(o);
      if (d2 > rr * rr) continue;
      if (!fresh && !(A = gearBox(v, _gBoxA))) return;
      fresh = true;
      const B = gearBox(o, _gBoxB);
      if (!B) continue;
      const nb = _gNb, depth = gearSat(A, B, nb);
      if (!(depth > 0)) continue;
      const fixed = !!(o.kin || o.wreck), ghost = !fixed && !!o.remote, mv = v.mass, mo = o.mass || 1, wv = fixed ? 1 : mo / (mv + mo), push = gMath.min(depth, GEAR.bumpMax);
      v.x += nb.x * push * wv; v.y += nb.y * push * wv; v.z += nb.z * push * wv;
      fresh = false; // (moved: its box again for the next one)
      if (!fixed && !ghost) { const wo = 1 - wv; o.x -= nb.x * push * wo; o.y -= nb.y * push * wo; o.z -= nb.z * push * wo; o.restTime = 0; }
      // where they meet: between the two boxes' faces along the axis, on the line of their centres
      let ra = 0, rb = 0;
      for (let i = 0; i < 3; i++) { ra += A.e[i] * gMath.abs(gDot(A.u[i], nb)); rb += B.e[i] * gMath.abs(gDot(B.u[i], nb)); }
      const cx = (A.c.x - nb.x * ra + B.c.x + nb.x * rb) / 2, cy = (A.c.y - nb.y * ra + B.c.y + nb.y * rb) / 2, cz = (A.c.z - nb.z * ra + B.c.z + nb.z * rb) / 2;
      const a = v.av, rvx = cx - v.x, rvy = cy - v.y, rvz = cz - v.z;
      let ux = v.vx + a.y * rvz - a.z * rvy, uy = v.vy + a.z * rvx - a.x * rvz, uz = v.vz + a.x * rvy - a.y * rvx;
      if (!o.wreck && o.av) { // (a wreck stays put; a ghost coasts, ground AI moves itself)
        const w = o.av, rox = cx - o.x, roy = cy - o.y, roz = cz - o.z;
        ux -= (o.vx || 0) + w.y * roz - w.z * roy; uy -= (o.vy || 0) + w.z * rox - w.x * roz; uz -= (o.vz || 0) + w.x * roy - w.y * rox;
      }
      const G = ghost ? o._bump || (o._bump = { x: 0, y: 0, z: 0, t: 0 }) : null;
      if (G) { // (its owner's share of the bumps we've had, fading as its snapshots catch up)
        const now = sim.time || 0, f = gMath.exp(-gMath.max(0, now - G.t) / GEAR.bumpLag);
        G.x *= f; G.y *= f; G.z *= f; G.t = now; ux -= G.x; uy -= G.y; uz -= G.z;
      }
      const vn0 = ux * nb.x + uy * nb.y + uz * nb.z;
      if (vn0 >= 0) continue;
      const vn = ghost ? gMath.max(vn0, -GEAR.bumpV) : vn0;
      const k = 1 / mv + (fixed ? 0 : 1 / mo), j = (-(1 + GEAR.bumpE) * vn) / k;
      const Pv = gearLocal(v, cx, cy, cz, _gA);
      v.applyImpulse(Pv, nb, j);
      if (G) { G.x -= (nb.x * j) / mo; G.y -= (nb.y * j) / mo; G.z -= (nb.z * j) / mo; }
      let Po = null;
      if (!fixed && !ghost) { Po = gearLocal(o, cx, cy, cz, _gB); _gD.x = -nb.x; _gD.y = -nb.y; _gD.z = -nb.z; o.applyImpulse(Po, _gD, j); }
      // friction across the axis, against the sliding
      const tx = ux - nb.x * vn0, ty = uy - nb.y * vn0, tz = uz - nb.z * vn0, vt = gMath.hypot(tx, ty, tz);
      if (vt > 1e-6) {
        const jt = gMath.min(GEAR.bumpMu * j, vt / k), d = _gR; d.x = -tx / vt; d.y = -ty / vt; d.z = -tz / vt;
        v.applyImpulse(Pv, d, jt);
        if (G) { G.x -= (d.x * jt) / mo; G.y -= (d.y * jt) / mo; G.z -= (d.z * jt) / mo; }
        if (Po) { d.x = -d.x; d.y = -d.y; d.z = -d.z; o.applyImpulse(Po, d, jt); }
      }
      // ramming: the parts that met take a dent (never sent: each owner dents its own)
      if (-vn > GEAR.ramV && typeof Combat !== 'undefined' && sim.vessels) {
        const dent = (w, P) => { const p = gearNearest(w, P); if (p) Combat.impact(w, p, 0.75 + (-vn - GEAR.ramV) / (4 * (p.def.breakSpeed || DEFAULT_BREAK_SPEED)), sim); };
        dent(v, Pv);
        if (Po && !o.remote) dent(o, Po);
        if (v.dead || !v.parts.length) return;
      }
    }
  },

  // ---- builder stats (Phase 2A; pure)
  // What a design of parts will do, from the same rules as Gear.ground: mass (t), engine kW and hp per tonne, top and
  // reverse speed (km/h; top0 without an overload), the pivot rate (°/s; 0 with no tracks), the steepest slope it climbs
  // at 2 m/s (°, by power or grip), the sideways pull it tips at (g: half the track spacing over the centre of mass's
  // height above the ground, less its springs' lean), the tonnes over its running gear's rating (overload) and that
  // rating (loadT); B, the track spacing. Null for a design with nothing of the ground update in it.
  stats(parts) {
    if (!parts || !parts.some((p) => p.def && p.def.gv)) return null;
    let kg = 0, cx = 0, cy = 0, cz = 0, kw = 0;
    for (const p of parts) { const m = partKg(p); kg += m; cx += m * p.x; cy += m * p.y; cz += m * partZc(p); if (p.def.engine) kw += p.def.engine.kw || 0; }
    if (!(kg > 0)) return null;
    cx /= kg; cy /= kg; cz /= kg;
    const mt = kg / 1000, pts = [];
    let vmax = Infinity, load = 0, rev = 1, turn = Infinity, mu = Infinity, crr = 0, sag = 0, nc = 0;
    for (const p of parts) {
      const d = p.def, g = d.track || d.awheel;
      if (!g) continue;
      Gear.points(p, pts, cz);
      vmax = gMath.min(vmax, g.vmax || 12); load += g.load || 0; mu = gMath.min(mu, g.mu ?? 0.9);
      rev = gMath.min(rev, g.rev ?? (d.track ? 0.35 : GEAR.wheelRev));
      if (d.track) turn = gMath.min(turn, g.turn ?? 0.6);
      crr += g.crr ?? (d.track ? 0.035 : GEAR.crrWheel); sag += 0.4 * (g.travel || 0); nc++;
    }
    const out = { mass: mt, kw, hpt: (kw * 1.341) / mt, top: 0, top0: 0, rev: 0, pivot: 0, climb: 0, tip: 0, overload: gMath.max(0, mt - load), loadT: load, B: 0 };
    if (!nc) return out;
    crr /= nc; sag /= nc;
    const zs = [0, 0], zn = [0, 0];
    let groundY = Infinity;
    for (const k of pts) {
      if (k.side) { const i = k.side > 0 ? 1 : 0; zs[i] += k.z; zn[i]++; }
      const d = k.p.def.track || k.p.def.awheel;
      groundY = gMath.min(groundY, k.y - d.r);
    }
    const B = zn[0] && zn[1] ? zs[1] / zn[1] - zs[0] / zn[0] : 0, hc = cy - groundY, Pe = GEAR.eta * kw * 1000;
    const vr = vmax * gClamp(load / mt, 0.5, 1), vPow = gMath.sqrt((Pe * vr) / (crr * kg * G0)); // (on the flat, against rolling resistance alone: crr·m·g·v/vmax)
    out.B = B;
    out.tip = B > 0 && hc > 0 ? gMath.max(0, B / 2 / hc - (2 * sag) / B) : 0; // (less the lean its springs give it as the load moves over)
    if (!kw) return out;
    out.top0 = gMath.min(vmax, gMath.sqrt((Pe * vmax) / (crr * kg * G0))) * 3.6;
    out.top = gMath.min(vr, vPow) * 3.6;
    out.rev = gMath.min(vr * rev, vPow) * 3.6;
    out.pivot = turn === Infinity ? 0 : ((turn * gMath.min(1, gMath.sqrt(kw / mt / 12))) * 180) / gMath.PI;
    out.climb = (gMath.min(gMath.atan(mu), gMath.asin(gClamp(Pe / (2 * kg * G0) - crr * gMath.min(1, 2 / gMath.max(vr, 1)), 0, 1))) * 180) / gMath.PI;
    return out;
  },
};
