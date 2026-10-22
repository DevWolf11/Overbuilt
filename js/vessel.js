'use strict';
// A vessel is a rigid assembly of parts flying around one body (patched conics), in full 3D.
// Part space is the builder's: +y runs up the stack, x across it, z is depth (out of the blueprint; a plane's
// right wing). Each part sits at its own depth (partZ): a twin pair one each side, so only a single part off
// the centreline moves the centre of mass across (com.z).
// The quaternion q turns part space (about the centre of mass) into the sim's axes; av is the angular
// velocity in sim axes. Positions and velocities are relative to the body's centre.

const DEFAULT_BREAK_SPEED = 9;
const hasCombat = () => typeof Combat !== 'undefined'; // (the physics also runs without weapons, in tests)
const ROUND3D = new Set(['pod', 'probe', 'probeL', 'tank', 'fuselage', 'srb', 'sep', 'nose', 'adapter', 'tailcone', 'engine', 'spike', 'ion', 'shield', 'chute', 'jet', 'cockpit', 'rotor', 'prop',
  'jetnose', 'airnose', 'float', 'droptank']);
const MIN_AIR = 0.03; // kg/m³: air-breathing engines flame out below this
const MAX_SPIN = 6;   // rad/s
// Where a part's mass sits across (z), one entry per copy: each side of a twin pair, or an axle's two wheels
// (track apart, either side of the part's depth).
function massZs(p) {
  const tr = p.def.wheel ? (p.def.wheel.track || 0) / 2 : 0, z = partZ(p);
  return tr ? [z - tr, z + tr] : partZs(p);
}

// Lift coefficient of a wing at angle of attack a (forward flow): linear (slope per radian) up to the
// stall, then it sinks towards a flat plate's.
function liftCoef(a, slope = 5.5, stall = 0.28) {
  const x = Math.abs(a);
  const cl = x < stall ? slope * x : lerp(slope * stall, 1.1 * Math.sin(2 * x), smoothstep(stall, stall + 0.22, x));
  return Math.sign(a) * cl;
}
// The aerodynamics of one wing, worked out once per part type: lift slope from the aspect ratio
// (Helmbold's formula, less for sweep), induced drag, stall angle, where wave drag starts.
const WING_AERO = new Map();
function wingAero(d) {
  let a = WING_AERO.get(d);
  if (a) return a;
  const w = d.wing, AR = w.ar || (w.span * w.span) / w.area, sw = w.swing ? w.swing[0] : w.sweep || 0; // (ar: a biplane's is each wing's own)
  a = {
    AR, slope: w.slope || (TAU * AR * Math.cos(sw)) / (2 + Math.sqrt(4 + AR * AR)), stall: w.stall || 0.3,
    kInd: 1 / (Math.PI * (w.oswald || 0.8) * AR), cd0: w.cd0 || 0.012, mcrit: w.mcrit || 0.78, wave: w.wave != null ? w.wave : 1,
    back: Math.tan(sw) * (w.span / 4), // each half's centre of lift sits this far back along the chord
    dihedral: w.dihedral != null ? w.dihedral : w.control ? 0 : 0.06, load: (w.load || 1) * (w.control ? 70000 : 14000),
    // the speeds it breaks at: past vne (equivalent airspeed, m/s, so it goes faster up high) or past Mach mmax
    // (0: none) the wing flutters and tears off. Moving surfaces have neither.
    vne: w.control ? 0 : w.vne || 110, mmax: w.control ? 0 : w.mmax || 0,
  };
  WING_AERO.set(d, a);
  return a;
}
// A swing wing's aerodynamics for its sweep now: spread below Mach 0.55 (or with the flaps out), fully back
// by Mach 0.92; as it folds its lift moves a little aft. The sweep is kept on the part for the 3D model.
function swingAero(p, M, flaps) {
  const d = p.def, w = d.wing, base = wingAero(d), k = flaps > 0 ? 0 : smoothstep(0.55, 0.92, M), sw = lerp(w.swing[0], w.swing[1], k);
  const a = p._aero || (p._aero = Object.assign({}, base));
  a.slope = (TAU * base.AR * Math.cos(sw)) / (2 + Math.sqrt(4 + base.AR * base.AR));
  a.back = base.back + (Math.sin(sw) - Math.sin(w.swing[0])) * (w.span / 4) * 0.6; // only the outer panels pivot (the glove stays put)
  a.mcrit = lerp(base.mcrit, 0.95, k); a.wave = lerp(base.wave, 0.55, k); a.stall = lerp(base.stall, base.stall + 0.06, k);
  p.sweep = sw;
  return a;
}
// Extra drag coefficient near and past Mach 1 (shock waves), from the Mach number where it starts.
// A plane's structure: the load its main wings carry before they start to give (N; over the weight, the g
// it is good for), the never-exceed speed of the weakest (equivalent airspeed, m/s; 0: no wings) and the
// lowest Mach limit of any of them (0: none).
const FIN_LOAD = 45000; // tail fins (N/m²): as tough as the moving surfaces, so a sideslip doesn't snap them
function wingStrength(parts) {
  let S = 0, vne = 0, mmax = 0;
  for (const p of parts) {
    const d = p.def;
    if (!d.wing || d.wing.control) continue;
    const W = wingAero(d);
    S += W.load * d.wing.area;
    vne = vne ? Math.min(vne, W.vne) : W.vne;
    if (W.mmax) mmax = mmax ? Math.min(mmax, W.mmax) : W.mmax;
  }
  return { S, vne, mmax };
}
function waveDrag(M, mcrit) { return smoothstep(mcrit, mcrit + 0.2, M) * (1 - 0.45 * smoothstep(1.2, 2.3, M)); }

// Thrust factor of an air-breathing engine for the air density and the airspeed along its axis.
function airThrust(a, rho, vA) {
  if (rho < MIN_AIR) return 0;
  let k = Math.min(1.3, Math.pow(rho / EARTH.rho0, 0.7));
  const v = Math.max(0, vA);
  switch (a.kind) {
    case 'jet': k *= vA < a.vmax ? 1 + 0.5 * v / a.vmax : Math.max(0, 1.5 * (1 - (vA - a.vmax) / 200)); break; // ram air helps at speed
    case 'fan': k *= vA < a.vmax ? 1 - 0.45 * v / a.vmax : Math.max(0, 0.55 * (1 - (vA - a.vmax) / 120)); break; // strong at take-off, fades with speed
    case 'ram': k *= smoothstep(a.vmin * 0.8, a.vmin, vA) * (vA < a.vmax ? 0.6 + (0.6 * (vA - a.vmin)) / (a.vmax - a.vmin) : Math.max(0, 1.2 * (1 - (vA - a.vmax) / 300))); break;
    default: k *= Math.min(1, a.v0 / Math.max(vA, 1)); // props and rotors: constant power above v0
  }
  return k;
}
// Speed of sound near the surface, dropping a little with height.
const SOUND_SPEED = { earth: 340, venus: 410, mars: 240, jupiter: 1100 };
function soundSpeed(b, alt) { return (SOUND_SPEED[b.id] || 300) * (1 - 0.13 * smoothstep(0, 11000, alt)); }
const SAS_MODES = ['hold', 'prograde', 'retrograde', 'radialOut', 'radialIn', 'target'];

// Pilot axes per kind, in part space: F is the nose, U the craft's up; right is F × U.
// `map` says what the three stick axes do: [W/S, A/D, Q/E]; `rate` is rad/s at full stick.
function pilotFrame(F, U, map, rate) { return { F: v3(...F), U: v3(...U), R: cross3(v3(...F), v3(...U)), map, rate }; }
const PILOT = {
  rocket: pilotFrame([0, 1, 0], [0, 0, 1], ['pitch', 'yaw', 'roll'], [1.1, 1.1, 1.5]),
  plane: pilotFrame([0, 1, 0], [-1, 0, 0], ['pitch', 'roll', 'yaw'], [0.9, 1.9, 0.45]),
  heli: pilotFrame([1, 0, 0], [0, 1, 0], ['pitch', 'roll', 'yaw'], [0.9, 1.0, 1.4]),
  car: pilotFrame([1, 0, 0], [0, 1, 0], ['pitch', 'roll', 'yaw'], [0.9, 1.2, 1.2]),
};
// How wheeled craft sit on the ground: planes on their belly side (+x), everything else on -y.
const DRIVE = { plane: pilotFrame([0, 1, 0], [-1, 0, 0]), other: pilotFrame([1, 0, 0], [0, 1, 0]) };

const _t1 = v3(), _t2 = v3(), _t3 = v3(), _t4 = v3();

class Vessel {
  constructor(parts, adj, body) {
    this.parts = parts;
    this.adj = adj;
    this.body = body;
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.q = quat(); this.av = v3();
    this.throttle = 1;
    this.ctl = { v: 0, h: 0, r: 0 }; // stick: W/S, A/D, Q/E, each -1..1
    this.sas = 'hold';
    this.landed = false;
    this.splashed = false;
    this.contactTime = 0;
    this.restTime = 0;
    this.isDebris = false;
    this.stages = [];
    this.stageIdx = 0;
    this.name = 'Vessel';
    this.thrust = 0;
    this.maxHeat = 0;
    this.kind = 'rocket';
    this.brake = false;
    this.cmd = v3();      // control-surface command per part axis, -1..1
    this.surfAuth = v3(); // torque the control surfaces gave at full deflection last step
    this.aoa = null;
    this.lift = 0;
    this.airspeed = 0;
    this.mach = 0;
    this.dynP = 0;
    this.steer = 0;
    this.flaps = 0;       // 0..1, planes
    this.gearUp = false;  // retractable gear folded away
    this.brakeOut = 0;    // air brakes, 0..1
    this.rip = [];        // wings overstressed this step
    this.ripWhy = null;   // 'speed' when flutter tore one of them (else the load did)
    this.com = { x: 0, y: 0, z: 0 };
    this._loc = {};
    this.recompute(true);
  }

  get control() { return findControlPart(this.parts); }
  get pilot() { return PILOT[this.kind] || PILOT.rocket; }
  get drive() { return this.kind === 'plane' ? DRIVE.plane : DRIVE.other; }
  // The planar view of the attitude (2D fallback): the stack axis's angle in the XY plane, and spin about z.
  get rot() { const n = qrot(this.q, 0, 1, 0, _t4); return Math.atan2(-n.x, n.y); }
  set rot(a) { this.q = qaxis(0, 0, 1, a); }
  get w() { return this.av.z; }
  set w(v) { this.av = v3(0, 0, v); }

  // What recompute needs of a part that only its type, place, turn and depth decide (not its fuel or stores),
  // kept from step to step: a burning engine has recompute run every step. Redone when the part moves.
  partGeo(p, i) {
    const G = this._geo || (this._geo = []);
    let g = G[i];
    if (g && g.p === p && g.def === p.def && g.x === p.x && g.y === p.y && g.z === p.z && g.rot === p.rot) return g;
    const { w, h } = partDims(p), d = partDepth(p), r = partRect(p), Z = partZ(p);
    g = G[i] = { p, def: p.def, x: p.x, y: p.y, z: p.z, rot: p.rot, zc: partZc(p), zs: massZs(p), copies: partZs(p), d,
      kx: (h * h + d * d) / 12, ky: (w * w + d * d) / 12, kz: (w * w + h * h) / 12, l: r.l, r: r.r, b: r.b, t: r.t,
      off: !p.def.twinZ && Z !== 0, across: Math.abs(Z) + d / 2 }; // (off the centre line, and how far out across it reaches)
    return g;
  }
  recompute(initial) {
    const parts = this.parts, n = parts.length;
    if (this._geo && this._geo.length > n) this._geo.length = n;
    let m = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      const p = parts[i], pm = partKg(p);
      m += pm; cx += pm * p.x; cy += pm * p.y; cz += pm * this.partGeo(p, i).zc;
    }
    cx /= m; cy /= m; cz /= m;
    if (!initial) {
      // keep parts fixed in space when the centre of mass moves
      const d = qrot(this.q, cx - this.com.x, cy - this.com.y, cz - (this.com.z || 0), _t1);
      this.x += d.x; this.y += d.y; this.z += d.z;
    }
    this.mass = m;
    this.com = { x: cx, y: cy, z: cz };
    // inertia tensor about the centre of mass: parts are boxes, their mass shared between their copies across
    // (zz: the copies' mean square offset from the centre of mass across, zm: their mean offset)
    let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, Ixz = 0, Iyz = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = parts[i], g = this._geo[i], pm = partKg(p), d = g.d, zs = g.zs, dx = p.x - cx, dy = p.y - cy;
      let zz = 0, zm = 0;
      for (const z of zs) { zz += (z - cz) * (z - cz); zm += z - cz; }
      zz /= zs.length; zm /= zs.length;
      for (const z of g.copies) { minZ = Math.min(minZ, z - d / 2); maxZ = Math.max(maxZ, z + d / 2); } // (its partBoxes)
      Ixx += pm * (g.kx + dy * dy + zz);
      Iyy += pm * (g.ky + dx * dx + zz);
      Izz += pm * (g.kz + dx * dx + dy * dy);
      Ixy -= pm * dx * dy; Ixz -= pm * dx * zm; Iyz -= pm * dy * zm;
      minX = Math.min(minX, g.l); maxX = Math.max(maxX, g.r); minY = Math.min(minY, g.b); maxY = Math.max(maxY, g.t);
    }
    Ixx = Math.max(Ixx, 1); Iyy = Math.max(Iyy, 1); Izz = Math.max(Izz, 1);
    // the inverse by blocks: the x-y block's own, then z through its Schur complement s (so with nothing off
    // the centreline, xz = yz = 0, it is exactly the x-y block's inverse and 1/Izz)
    const det = Ixx * Iyy - Ixy * Ixy || 1, axx = Iyy / det, ayy = Ixx / det, axy = -Ixy / det;
    const ux = axx * Ixz + axy * Iyz, uy = axy * Ixz + ayy * Iyz, s = Math.max(Izz - (Ixz * ux + Iyz * uy), 1e-3);
    this.I = { xx: Ixx, yy: Iyy, zz: Izz, xy: Ixy, xz: Ixz, yz: Iyz,
      ixx: axx + (ux * ux) / s, iyy: ayy + (uy * uy) / s, ixy: axy + (ux * uy) / s, izz: 1 / s, ixz: -ux / s, iyz: -uy / s };
    this.inertia = Math.max(Ixx, Iyy, Izz);
    this.bounds = { minX, maxX, minY, maxY, minZ, maxZ };
    this.width = maxX - minX;
    // a rocket is round about its stack: parts out across the blueprint widen it as much as ones beside it
    let r = 0;
    for (let i = 0; i < n; i++) if (this._geo[i].off) r = Math.max(r, this._geo[i].across);
    this.across = Math.max(this.width, 2 * r);
    this.depth = maxZ - minZ;
  }
  // I·v and I⁻¹·v in part axes (o may be v)
  mulI(v, o = v3()) {
    const I = this.I, x = I.xx * v.x + I.xy * v.y + I.xz * v.z, y = I.xy * v.x + I.yy * v.y + I.yz * v.z, z = I.xz * v.x + I.yz * v.y + I.zz * v.z;
    o.x = x; o.y = y; o.z = z; return o;
  }
  mulInvI(v, o = v3()) {
    const I = this.I, x = I.ixx * v.x + I.ixy * v.y + I.ixz * v.z, y = I.ixy * v.x + I.iyy * v.y + I.iyz * v.z, z = I.ixz * v.x + I.iyz * v.y + I.izz * v.z;
    o.x = x; o.y = y; o.z = z; return o;
  }
  // I⁻¹·v for a vector in sim axes
  invIWorld(v, o = v3()) { qunrot(this.q, v.x, v.y, v.z, o); this.mulInvI(o, o); return qrot(this.q, o.x, o.y, o.z, o); }
  bodyAV(o = v3()) { return qunrot(this.q, this.av.x, this.av.y, this.av.z, o); }

  rebuildGroups() {
    this.groups = fuelGroups(this.parts, this.adj);
    this.byId = new Map(this.parts.map((p) => [p.id, p]));
    let top = null; // the nose: the part furthest up the centreline (not a pod or a store out on a wing)
    for (const p of this.parts) if (partZs(p).length === 1 && Math.abs(partZc(p)) < partDepth(p) / 2 && (!top || partRect(p).t > partRect(top).t)) top = p;
    this.noseAero = !!(top && (top.def.aero || top.def.chute));
    this.wheels = this.parts.filter((p) => p.def.wheel);
    this.fins = this.parts.filter((p) => p.def.fin);
    this.wings = this.parts.filter((p) => p.def.wing);
    this.vtails = this.parts.filter((p) => p.def.shape === 'vtail');
    this.airbrakes = this.parts.filter((p) => p.def.airbrake);
    this.hasFlaps = this.wings.some((p) => p.def.wing.flaps);
    this.hasRetract = this.wheels.some((p) => p.def.wheel.retract);
    this.noseSharp = !!(top && top.def.sharp);
    this.aircraft = this.wings.length > 0;
    this.mainWing = this.wings.reduce((m, p) => (!p.def.wing.control && (!m || p.def.wing.area > m.def.wing.area) ? p : m), null);
    this.stallAoA = this.mainWing ? wingAero(this.mainWing.def).stall : 0.3;
    this.clS = 0; // area x lift coefficient at the stall, all the (non-control) wings together
    for (const p of this.wings) if (!p.def.wing.control) { const W = wingAero(p.def); this.clS += p.def.wing.area * W.slope * W.stall; }
    const ws = wingStrength(this.parts);
    this.wingS = ws.S; this.vne = ws.vne; this.mmax = ws.mmax;
    this.rotors = this.parts.filter((p) => p.def.air && p.def.air.kind === 'rotor');
    this.tailRotors = this.parts.filter((p) => p.def.shape === 'tailrotor');
    this.recompute(false);
    this.computeAreas();
    this.computeHull();
  }

  // Projected areas seen along each part axis. Each slice through the craft sums the parts it cuts;
  // wings carry their own drag.
  computeAreas() {
    const D = this.parts.filter((p) => !p.def.wing && !p.def.wheel)
      .map((p) => ({ p, d: partDims(p), dep: p.def.wheel ? 0.25 : partDepth(p), round: ROUND3D.has(p.def.shape) }));
    let ax = 0, ay = 0, az = 0;
    for (const s of D) {
      let fx = 0, fy = 0;
      for (const o of D) {
        if (Math.abs(o.p.y - s.p.y) < o.d.h / 2) fy += o.d.w * o.dep * (o.round ? 0.785 : 1);
        if (Math.abs(o.p.x - s.p.x) < o.d.w / 2) fx += o.d.h * o.dep;
      }
      ax = Math.max(ax, fx); ay = Math.max(ay, fy);
      az += s.d.w * s.d.h * (s.p.def.fin || s.p.def.shape === 'vtail' ? 0.5 : 0.85);
    }
    this.area = v3(Math.max(ax, 0.5), Math.max(ay, 0.5), Math.max(az, 0.5));
    this.areaFront = this.area.y;
    // landing gear hanging in the wind (folded retractable gear doesn't count)
    this.gearDrag = 0; this.gearDragFixed = 0;
    for (const p of this.wheels) {
      const r = wheelGeom(p).r, k = 0.5 * r * massZs(p).length;
      this.gearDrag += k; if (!p.def.wheel.retract) this.gearDragFixed += k;
    }
  }

  // Points the ground can touch, in part space: the corners of each part's box (a diamond around a round
  // part's ends) and every wheel's centre and radius, at the depth of each copy of the part (both sides of a
  // pair, both wheels of an axle). Rocket legs and fins stand in fours around the stack: each also gets a copy
  // turned 90° about the stack's axis.
  computeHull() {
    const pts = [], wheels = [], radial = this.kind === 'rocket';
    const add = (p, x, y, z) => {
      for (const o of partZs(p)) {
        const zz = z + o;
        pts.push({ p, x, y, z: zz });
        if (radial && (p.def.leg || p.def.fin)) pts.push({ p, x: zz, y, z: -x });
      }
    };
    for (const p of this.parts) {
      if (p.def.wheel) {
        const g = wheelGeom(p);
        for (const z of massZs(p)) wheels.push({ p, x: g.x, y: g.y, z, r: g.r, retract: !!p.def.wheel.retract });
        continue;
      }
      const ax = partAxis(p), px = ax.y, py = -ax.x, hl = p.def.h / 2, hw = p.def.w / 2, hd = partDepth(p) / 2;
      const round = ROUND3D.has(p.def.shape);
      for (const s of [-1, 1]) {
        const ex = p.x + ax.x * s * hl, ey = p.y + ax.y * s * hl;
        if (round) { add(p, ex + px * hw, ey + py * hw, 0); add(p, ex - px * hw, ey - py * hw, 0); add(p, ex, ey, hw); add(p, ex, ey, -hw); }
        else for (const a of [-1, 1]) for (const c of [-1, 1]) add(p, ex + px * hw * a, ey + py * hw * a, hd * c);
      }
    }
    this.hull = pts;
    this.wheelPts = wheels;
    const D = this.drive, along = wheels.map((k) => k.x * D.F.x + k.y * D.F.y);
    this.wheelbase = wheels.length ? Math.max(1, Math.max(...along) - Math.min(...along)) : 1;
    // how far the craft reaches from its centre of mass
    const c = this.com, cz = c.z || 0;
    let reach = 0;
    for (const k of pts) reach = Math.max(reach, Math.hypot(k.x - c.x, k.y - c.y, k.z - cz));
    for (const k of wheels) reach = Math.max(reach, Math.hypot(k.x - c.x, k.y - c.y, k.z - cz) + k.r);
    this.reach = reach + 0.5;
  }

  // Local (part space) -> position relative to body centre.
  toWorld(lx, ly, lz = 0) {
    const d = qrot(this.q, lx - this.com.x, ly - this.com.y, lz - (this.com.z || 0));
    d.x += this.x; d.y += this.y; d.z += this.z;
    return d;
  }
  toLocal(wx, wy, wz = 0) {
    const d = qunrot(this.q, wx - this.x, wy - this.y, wz - this.z);
    d.x += this.com.x; d.y += this.com.y; d.z += this.com.z || 0;
    return d;
  }
  // A part-space direction in sim axes.
  axis(x, y, z, o = v3()) { return qrot(this.q, x, y, z, o); }
  // Velocity of a point given as an offset from the centre of mass (sim axes).
  pointVel(r, o = v3()) {
    const a = this.av;
    o.x = this.vx + a.y * r.z - a.z * r.y; o.y = this.vy + a.z * r.x - a.x * r.z; o.z = this.vz + a.x * r.y - a.y * r.x;
    return o;
  }

  radius() { return Math.hypot(this.x, this.y, this.z); }
  altitude() { return this.radius() - this.body.radius; }
  speed() { return Math.hypot(this.vx, this.vy, this.vz); }
  // Vertical speed (positive = climbing).
  vSpeed() { const r = this.radius() || 1; return (this.x * this.vx + this.y * this.vy + this.z * this.vz) / r; }
  surfaceSpot() { return Terrain.locate(this.body, this.x, this.y, this.z, this._loc); }
  groundHeight() { const L = this.surfaceSpot(); return Terrain.surfaceAt(this.body, L.a, L.z); }
  // Height of the craft's lowest point above the ground below it.
  groundAltitude() {
    const r = this.radius(), ux = this.x / r, uy = this.y / r, uz = this.z / r, cz = this.com.z || 0;
    let low = 0;
    for (const k of this.hull) {
      const o = qrot(this.q, k.x - this.com.x, k.y - this.com.y, k.z - cz, _t1);
      low = Math.min(low, o.x * ux + o.y * uy + o.z * uz);
    }
    for (const k of this.wheelPts) {
      if (k.retract && this.gearUp) continue;
      const o = qrot(this.q, k.x - this.com.x, k.y - this.com.y, k.z - cz, _t1);
      low = Math.min(low, o.x * ux + o.y * uy + o.z * uz - k.r);
    }
    return r + low - this.body.radius - this.groundHeight();
  }

  hasFuelFor(p) {
    if (p.def.solid) return p.fuel > 0.01;
    const g = this.groups.find((g) => g.engines.includes(p));
    return g && g.tanks.some((t) => t.fuel > 0.01);
  }

  // Thrust (part axes) and its torque this step; also burns propellant. vb is the velocity in part axes.
  applyEngines(dt, rho, vb, sim) {
    const F = v3(), T = v3();
    let gimbal = 0, rotorTorque = 0, total = 0;
    const pressure = clamp(rho / EARTH.rho0, 0, 1);
    let changed = false;
    // thrust along the part's axis (in the blueprint plane) from where it sits, r × F: an engine out on one
    // wing also yaws the nose away from it
    const fire = (e, f) => {
      const a = partAxis(e), rx = e.x - this.com.x, ry = e.y - this.com.y, rz = partZc(e) - (this.com.z || 0);
      F.x += a.x * f; F.y += a.y * f; total += f;
      T.x -= rz * a.y * f; T.y += rz * a.x * f; T.z += (rx * a.y - ry * a.x) * f;
      const n = partPt(e, 0, -e.def.h / 2);
      gimbal += f * Math.sin(e.def.gimbal || 0) * Math.abs((this.com.x - n.x) * a.x + (this.com.y - n.y) * a.y);
    };
    for (const g of this.groups) {
      if (g.solid) {
        const e = g.engines[0];
        e.firing = 0;
        if (!e.active) continue;
        if (e.fuel <= 0.01) { e.flameout = true; continue; }
        const f = e.def.thrust * 1000;
        const isp = lerp(e.def.ispVac, e.def.ispSL, pressure);
        const use = (f / (isp * G0)) * dt;
        const k = Math.min(1, e.fuel / use);
        e.fuel = Math.max(0, e.fuel - use * k);
        fire(e, f * k);
        e.firing = k;
        changed = true;
        continue;
      }
      let fuel = 0;
      for (const t of g.tanks) fuel += t.fuel;
      let demand = 0;
      const firing = [];
      for (const e of g.engines) {
        e.firing = 0;
        if (!e.active) continue;
        if (fuel <= 0.01) { e.flameout = true; continue; }
        e.flameout = false;
        let f = e.def.thrust * 1000 * this.throttle, abK = 0;
        e.ab = 0;
        if (e.def.air) {
          const a = partAxis(e), k = airThrust(e.def.air, rho, vb.x * a.x + vb.y * a.y);
          if (k <= 0) {
            if (!e.noAir && sim && !this.isDebris) sim.toast(rho >= MIN_AIR && e.def.air.kind === 'ram' ? `${e.def.name}: too slow to light (needs ${Math.round(e.def.air.vmin * 3.6)} km/h)` : `${e.def.name}: no air to breathe`, 'warn');
            e.noAir = true;
            continue;
          }
          e.noAir = false;
          f *= k;
          if (e.hp != null && hasCombat()) f *= Combat.engineK(e); // a damaged engine gives less
          // the afterburner lights above 90% throttle
          if (e.def.air.ab && this.throttle > 0.9) { abK = (this.throttle - 0.9) / 0.1; f *= 1 + (e.def.air.ab - 1) * abK; e.ab = abK; }
        }
        if (f <= 0) continue;
        const isp = lerp(e.def.ispVac, e.def.ispSL, pressure) / (1 + 1.6 * abK);
        demand += (f / (isp * G0)) * dt;
        firing.push([e, f]);
      }
      if (!firing.length) continue;
      const scale = demand > fuel ? fuel / demand : 1;
      for (const t of g.tanks) t.fuel = Math.max(0, t.fuel - demand * scale * (t.fuel / fuel));
      for (const [e, f] of firing) {
        fire(e, f * scale);
        e.firing = Math.min(1, (f * scale) / (e.def.thrust * 1000));
        if (e.def.air && e.def.air.torque) rotorTorque += e.def.air.torque * Math.min(1, e.firing * 1.5);
        // a single propeller twists the plane the other way (a twin pair turns in opposite directions, and so
        // does one on the left wing, so a mirrored pair cancels out)
        if (e.def.air && e.def.air.kind === 'prop' && !e.def.twinZ && !e.def.contra) { const a = partAxis(e), tq = -0.035 * f * scale * (e.def.w / 2) * (partZ(e) < -0.01 ? -1 : 1); T.x += a.x * tq; T.y += a.y * tq; }
      }
      changed = true;
    }
    if (changed) this.recompute(false);
    return { F, T, total, gimbal, rotorTorque };
  }

  // Props, rotors and tail rotors wind up and down; wheels spin from their ground speed in ground().
  spinRotors(dt) {
    let main = 0;
    for (const p of this.parts) {
      const a = p.def.air;
      if (!a || a.kind === 'jet') continue;
      const want = (p.firing || 0) * (a.kind === 'rotor' ? 28 : 45);
      p.rpm = (p.rpm || 0) + (want - (p.rpm || 0)) * Math.min(1, dt * 1.2);
      p.spin = ((p.spin || 0) + p.rpm * dt) % TAU;
      if (a.kind === 'rotor') main = Math.max(main, p.rpm / 28);
    }
    for (const p of this.tailRotors) {
      p.firing = main;
      p.spin = ((p.spin || 0) + main * 120 * dt) % TAU;
    }
  }

  // Direction (sim axes) the autopilot wants the stack's axis to point, or null to just hold.
  sasHeading(sim) {
    const r = this.radius();
    switch (this.sas) {
      case 'prograde': case 'retrograde': {
        const s = this.speed();
        if (s < 0.5) return null;
        const k = this.sas === 'prograde' ? 1 / s : -1 / s;
        return v3(this.vx * k, this.vy * k, this.vz * k);
      }
      case 'radialOut': return v3(this.x / r, this.y / r, this.z / r);
      case 'radialIn': return v3(-this.x / r, -this.y / r, -this.z / r);
      case 'target': {
        const t = sim && sim.target;
        if (!t) return null;
        const tp = bodyPos(t, sim.time), bp = bodyPos(this.body, sim.time);
        return norm3(v3(tp.x - bp.x - this.x, tp.y - bp.y - this.y, -this.z));
      }
      default: return null;
    }
  }

  // Pitch above the horizon and bank of the pilot frame (radians; bank > 0 = right wing down).
  attitude() {
    const P = this.pilot, r = this.radius(), ux = this.x / r, uy = this.y / r, uz = this.z / r;
    const F = qrot(this.q, P.F.x, P.F.y, P.F.z, _t1), U = qrot(this.q, P.U.x, P.U.y, P.U.z, _t2), R = qrot(this.q, P.R.x, P.R.y, P.R.z, _t3);
    return {
      pitch: Math.asin(clamp(F.x * ux + F.y * uy + F.z * uz, -1, 1)),
      bank: Math.atan2(-(R.x * ux + R.y * uy + R.z * uz), U.x * ux + U.y * uy + U.z * uz),
    };
  }

  // Angular velocity (part axes) the craft should turn at: pilot, autopilot, attitude hold or rover
  // levelling. null leaves it free.
  turnTarget(sim, engF, dt = 1 / 120) {
    const P = this.pilot, c = this.ctl, wb = this.bodyAV();
    const onWheels = this.wheelsDown && this.canDrive;
    // pilot-frame rates: pitch (+ nose up), roll (+ right wing down), yaw (+ nose right); null = no input
    const want = { pitch: null, roll: null, yaw: null };
    const heli = this.kind === 'heli' && !this.aircraft;
    if (heli) {
      // helicopters: the stick sets how far the craft leans (and returns it level when let go); Q/E turn
      const at = this.attitude();
      want.pitch = clamp((-c.v * 0.42 - at.pitch) * 1.8, -0.9, 0.9);
      want.roll = clamp(wrapAngle(c.h * 0.42 - at.bank) * 1.8, -0.9, 0.9);
      want.yaw = c.r * P.rate[2];
    } else if (!onWheels) {
      const ins = [-c.v, c.h, c.r];
      for (let i = 0; i < 3; i++) if (ins[i]) want[P.map[i]] = ins[i] * P.rate[i];
    }
    const cur = { pitch: dot3(wb, P.R), roll: dot3(wb, P.F), yaw: -dot3(wb, P.U) };
    const anyInput = heli ? !!(c.v || c.h || c.r) : want.pitch != null || want.roll != null || want.yaw != null;
    const toBody = (w) => {
      const o = v3();
      for (const [k, ax, s] of [['pitch', P.R, 1], ['roll', P.F, 1], ['yaw', P.U, -1]]) {
        const val = (w[k] == null ? cur[k] : w[k]) * s;
        o.x += ax.x * val; o.y += ax.y * val; o.z += ax.z * val;
      }
      return o;
    };
    if (want.pitch != null) this.holdPitch = null;
    if (want.roll != null) this.holdBank = null;

    // rovers and cars level themselves to the ground while driving or bouncing over bumps
    const rover = this.wheels.length && !this.aircraft && this.kind !== 'plane' && this.kind !== 'heli' && this.sas === 'hold' && !anyInput
      && (this.wheelsDown || (engF === 0 && this.groundAltitude() < 40));
    this.righting = false;
    if (rover) {
      const L = this.surfaceSpot(), n = Terrain.normalAt(this.body, L.a, L.z), D = this.drive;
      const u = qrot(this.q, D.U.x, D.U.y, D.U.z), ax = cross3(u, n), k = this.wheelsDown ? 1.2 : 2.5;
      // a craft on its side or roof, nearly stopped, gets a hand back onto its wheels
      this.righting = dot3(u, n) < 0.5 && this.speed() < 4 && this.groundAltitude() < 3;
      const w = qunrot(this.q, ax.x * k, ax.y * k, ax.z * k);
      const keep = dot3(wb, D.U) - dot3(w, D.U); // leave the heading to the wheels
      return v3(clamp(w.x + D.U.x * keep, -1.2, 1.2), clamp(w.y + D.U.y * keep, -1.2, 1.2), clamp(w.z + D.U.z * keep, -1.2, 1.2));
    }
    if (this.sas === 'off') return anyInput ? toBody(want) : null;
    const head = this.sasHeading(sim);
    if (head && !heli) {
      const n = qrot(this.q, 0, 1, 0, _t1), ax = cross3(n, head, v3()), s = len3(ax), ang = Math.atan2(s, dot3(n, head));
      const k = s > 1e-9 ? Math.min(ang * 2.2, 1.1) / s : 0;
      const w = qunrot(this.q, ax.x * k, ax.y * k, ax.z * k);
      w.y = 0; // no roll
      if (!anyInput) return w;
      const pw = { pitch: dot3(w, P.R), roll: dot3(w, P.F), yaw: -dot3(w, P.U) };
      for (const k2 in want) if (want[k2] == null) want[k2] = pw[k2];
      return toBody(want);
    }
    if (this.chuteOpen) return anyInput ? toBody(want) : null;
    if (heli) return toBody(want);
    if (this.aircraft) return toBody(this.planeTarget(want, c, dt));
    for (const k in want) if (want[k] == null) want[k] = 0;
    return toBody(want);
  }

  // The plane autopilot, on top of the pilot's stick. The rudder keeps every turn coordinated (Q/E still yaw).
  //   hold: keep the pitch and bank the pilot lets go at.
  //   level: wings level and hold the altitude (pitch with the stick, let go to hold the new height).
  //   heading: hold the altitude and a compass heading; A/D turn the heading instead of rolling.
  // In every mode it won't pull much past 8 g (or push past -3 g) and lowers the nose before the wing
  // stalls. 'off' (handled before this) is the bare stick: no help at all.
  planeTarget(want, c, dt) {
    const at = this.attitude(), V = Math.max(this.speed(), 20), mode = this.sas;
    // the ailerons roll it more gently when slow, and while the plane is already sliding sideways: a roll
    // faster than the rudder can follow (adverse yaw) skids it out of control
    if (want.roll != null) want.roll *= clamp(V / 110, 0.5, 1) * clamp(1 - (Math.abs(this.slip || 0) - 0.12) / 0.2, 0.25, 1);
    if (mode === 'level' || mode === 'heading') {
      const alt = this.altitude(), vs = this.vSpeed();
      if (want.pitch != null || this.altHold == null) { this.altHold = alt; this.pitchHold = at.pitch; }
      if (want.pitch == null) {
        // an attitude loop: the pitch to hold creeps until the climb angle matches what the altitude
        // error asks for, and leads by the error itself, so heavy planes don't porpoise
        const vsW = clamp((this.altHold - alt) * 0.2, -12, 12);
        const err = Math.asin(clamp(vsW / V, -0.5, 0.5)) - Math.asin(clamp(vs / V, -1, 1));
        this.pitchHold = clamp(this.pitchHold + err * 0.6 * dt, -0.35, 0.45);
        const turn = Math.max(0, 1 / Math.max(0.3, Math.cos(at.bank)) - 1) * 0.06; // a banked turn needs the nose a touch higher
        want.pitch = clamp((this.pitchHold + err * 0.5 + turn - at.pitch) * 1.5, -0.3, 0.3);
        // the vintage version only glanced at the climb rate now and then, and overreacted every time
        if (Silly.on('ogAutopilot')) {
          this.ogT = (this.ogT || 0) - dt;
          if (this.ogT <= 0) { this.ogT = 0.8; this.ogCmd = clamp((vsW - vs) * 0.1, -0.15, 0.15); }
          want.pitch = this.ogCmd;
        }
      }
      if (mode === 'heading') {
        const hdg = this.heading();
        if (this.hdgHold == null) this.hdgHold = hdg;
        if (c.h) this.hdgHold = wrapAngle(this.hdgHold + c.h * 0.3 * dt);
        const bankW = clamp(wrapAngle(this.hdgHold - hdg) * 1.5, -0.45, 0.45);
        want.roll = clamp(wrapAngle(bankW - at.bank) * 1.6, -0.7, 0.7);
      } else if (want.roll == null) want.roll = clamp(wrapAngle(-at.bank) * 1.6, -0.8, 0.8);
    } else {
      if (this.holdPitch == null) this.holdPitch = at.pitch;
      if (this.holdBank == null) this.holdBank = Math.abs(at.bank) < 0.06 ? 0 : at.bank;
      if (want.pitch == null) want.pitch = clamp((this.holdPitch - at.pitch) * 1.6, -0.5, 0.5);
      if (want.roll == null) want.roll = clamp(wrapAngle(this.holdBank - at.bank) * 1.6, -0.8, 0.8);
    }
    // the rudder: the tail follows the flight path round a banked turn (the rate the turn swings it at)
    // and any sideslip is flown out, so the plane neither skids sideways nor fishtails. Held rudder (Q/E)
    // still yaws the plane, but it won't let the sideslip grow past about 12°.
    const slip = this.slip || 0;
    if (!this.wheelsDown && this.airspeed > 25) {
      if (want.yaw == null) want.yaw = clamp((G0 / V) * Math.sin(at.bank) * Math.cos(at.pitch) + 2.5 * slip, -1.2, 1.2);
      else want.yaw += 3 * Math.sign(slip) * Math.max(0, Math.abs(slip) - 0.2);
    }
    // running out of speed nose-high (a steep climb, a loop held too long): the nose comes down before the
    // plane stalls and tumbles; diving is always allowed
    if (want.pitch != null && !this.wheelsDown && this.clS > 0 && at.pitch > 0.15) {
      const rho = airDensity(this.body, this.altitude()), vs = Math.sqrt((2 * this.mass * G0) / (Math.max(rho, 0.01) * this.clS));
      const low = 1 - V / (1.35 * vs);
      if (low > 0) want.pitch = Math.min(want.pitch, -low * 3 * Math.min(1, at.pitch / 0.5));
    }
    if (want.pitch != null) {
      if (this.wheelsDown) want.pitch *= 0.4; // rotate gently on the runway
      want.pitch = clamp(want.pitch, (-3 * G0) / V, (8 * G0) / V);
      const a = this.aoa, st = this.stallAoA - 0.03 * this.flaps;
      if (a != null && a > st * 0.85 && !this.wheelsDown) want.pitch = Math.min(want.pitch, -2 * (a - st * 0.85));
    }
    return want;
  }
  // How many g the main wings carry at this weight before they start to give (0: no wings).
  gRating() { return this.wingS ? this.wingS / (this.mass * G0) : 0; }
  // Heading of the flight path (radians; east is 90°, turning right adds), or of the nose when slow.
  // The surface frame's "north" (+z at the pad) lies to the right of east, so this counts from -north.
  heading() {
    const F = surfaceFrame(this.x, this.y, this.z);
    let e = this.vx * F.east.x + this.vy * F.east.y + this.vz * F.east.z, n = this.vx * F.north.x + this.vy * F.north.y + this.vz * F.north.z;
    if (Math.hypot(e, n) < 5) { const f = qrot(this.q, this.pilot.F.x, this.pilot.F.y, this.pilot.F.z, _t1); e = dot3(f, F.east); n = dot3(f, F.north); }
    return Math.atan2(e, -n);
  }

  physicsStep(dt, sim) {
    const b = this.body;
    const r = this.radius();
    const alt = r - b.radius;
    if (b.star && alt < b.radius * 0.35) { sim.breakParts(this, [...this.parts], 'heat'); return; }
    const rho = airDensity(b, alt);
    const m0 = this.mass;
    const gk = -b.mu / (r * r * r);
    let ax = gk * this.x, ay = gk * this.y, az = gk * this.z;
    const vb = qunrot(this.q, this.vx, this.vy, this.vz, v3()); // velocity in part axes
    const wb = this.bodyAV(v3());

    const eng = this.applyEngines(dt, rho, vb, sim);
    this.spinRotors(dt);
    const T = eng.T, Fb = v3(eng.F.x, eng.F.y, eng.F.z); // torque and force, part axes

    // Control: reaction wheels, gimbals and rotors steer towards a target angular velocity. Control
    // surfaces get a command too; the wings below turn it into lift this same step.
    let rw = 0;
    for (const p of this.parts) if (p.def.torque) rw += p.def.torque;
    const A = v3(rw + eng.gimbal + eng.rotorTorque, rw + (this.tailRotors.length ? 0.6 : 0.15) * eng.rotorTorque, rw + eng.gimbal + eng.rotorTorque);
    if (this.wheelsDown) { A.x *= 0.5; A.y *= 0.5; A.z *= 0.5; }
    if (this.righting) { const g = this.mass * 14 * Math.max(1, this.width); A.x += g; A.y += g; A.z += g; }
    const want = this.cmdW || (this.cmdW = v3());
    want.x = 0; want.y = 0; want.z = 0;
    if (!this.isDebris) {
      const wt = this.turnTarget(sim, eng.total, dt);
      if (wt) {
        const k = 0.35 / Math.max(dt, 1e-3), need = this.mulI(v3((wt.x - wb.x) * k, (wt.y - wb.y) * k, (wt.z - wb.z) * k));
        for (const a of ['x', 'y', 'z']) {
          if (this.surfAuth[a] > 0) want[a] = clamp(need[a] / Math.max(1, this.surfAuth[a] + A[a]), -1, 1);
          if (A[a] > 0) T[a] += clamp(need[a], -A[a], A[a]);
        }
      }
    }
    // control surfaces swing at a finite rate (full throw in about a tenth of a second), so they don't flap
    // from stop to stop between steps
    const mv = this.aircraft ? dt * 10 : 2;
    for (const a of ['x', 'y', 'z']) this.cmd[a] += clamp(want[a] - this.cmd[a], -mv, mv);

    // Aerodynamics, in part axes
    const v = Math.hypot(vb.x, vb.y, vb.z);
    this.chuteOpen = false;
    this.dynP = 0.5 * rho * v * v;
    this.airspeed = rho > 0 ? v : 0;
    this.mach = rho > 0 ? v / soundSpeed(b, alt) : 0;
    this.aoa = null;
    this.slip = 0;
    const auth = this.surfAuth;
    auth.x = 0; auth.y = 0; auth.z = 0;
    if (rho > 0 && v > 0.01) {
      const hx = vb.x / v, hy = vb.y / v, hz = vb.z / v, P = this.pilot;
      const along = hx * P.F.x + hy * P.F.y; // 1 = nose first
      const side = Math.abs(along);
      const L = this.bounds.maxY - this.bounds.minY;
      let cdA, area;
      if (this.kind === 'rocket') { // tuned for ascents and reentries; keep as is
        const cd = along > 0.85 ? (this.noseAero ? 0.32 : 0.62) : along < -0.85 ? 0.75 : 1.0;
        area = this.across * (this.across * side + L * (1 - side)) * 0.8;
        cdA = cd * area;
      } else {
        const cdF = along > 0.85 ? (this.noseAero ? 0.3 : 0.55) : along < -0.85 ? 0.7 : 0.8, cdO = this.kind === 'car' ? 0.5 : 0.9;
        // flow along an axis sees that axis's area; on a slender plane, cross-flow drag grows with the square of the angle
        const sq = this.kind === 'plane', ax = Math.abs(hx), ay = Math.abs(hy), az = Math.abs(hz);
        const ex = Math.abs(P.F.x) > 0.5 || !sq ? ax : ax * ax, ey = Math.abs(P.F.y) > 0.5 || !sq ? ay : ay * ay;
        const sx = this.area.x * ex, sy = this.area.y * ey, sz = this.area.z * (sq ? az * az : az);
        area = sx + sy + sz;
        cdA = (Math.abs(P.F.x) > 0.5 ? cdF : cdO) * sx + (Math.abs(P.F.y) > 0.5 ? cdF : cdO) * sy + cdO * sz;
        // shock waves near Mach 1 (a pointed nose eases them), dangling landing gear, air brakes
        cdA *= 1 + (this.noseSharp ? 0.4 : 1) * waveDrag(this.mach, 0.85);
        cdA += this.gearUp ? this.gearDragFixed : this.gearDrag;
        this.brakeOut += ((this.brake ? 1 : 0) - this.brakeOut) * Math.min(1, dt * 5);
        for (const p of this.airbrakes) { cdA += p.def.airbrake * this.brakeOut; p.deflect = this.brakeOut * 1.1; }
      }
      const above = alt - this.groundHeight();
      for (const p of this.parts) {
        if (!p.def.chute || p.deployed <= 0 || p.used) continue;
        if (p.def.brakeChute) { // a drag chute: just drag, opens at once, collapses when the craft stops
          if (p.deployed < 1) p.deployed = Math.min(1, p.deployed + dt * 2);
          cdA += (18 + 520 * p.deployed * p.deployed) * p.def.chuteArea;
          this.chuteOpen = true;
          if (this.dynP > 9500) { p.used = true; sim.toast('Brake chute torn off: too fast'); }
          else if (this.landed && v < 3) p.used = true;
          continue;
        }
        // drogue first; the main canopy opens fully close to the ground
        const cap = above < 1500 ? 1 : 0.3;
        if (p.deployed < cap) p.deployed = Math.min(cap, p.deployed + dt * (p.deployed < 0.3 ? 0.5 : 0.35));
        const k = p.deployed;
        const ca = (18 + 520 * k * k) * (p.def.chuteArea || 1);
        cdA += ca;
        // the canopy hauls the top of the stack round to trail behind (and one off the centreline twists it too)
        const pull = this.dynP * ca * (p.y + 3 - this.com.y) * 0.08, twist = this.dynP * ca * (partZc(p) - (this.com.z || 0)) * 0.08;
        T.x -= hz * pull; T.z -= (-hx + (hy > 0.9 ? 0.3 : 0)) * pull;
        T.x += hy * twist; T.y -= hx * twist;
        const damp = this.mulI(wb);
        T.x -= damp.x * 1.5; T.y -= damp.y * 1.5; T.z -= damp.z * 1.5;
        this.chuteOpen = true;
        if (this.dynP > 25000 && k > 0.5) { p.used = true; sim.toast('Parachute torn off: too fast'); }
      }
      const drag = this.dynP * cdA;
      Fb.x -= hx * drag; Fb.y -= hy * drag; Fb.z -= hz * drag;
      // weathervaning: the body turns gently into the flow, fins below the centre of mass strongly
      let finStab = 0;
      for (const f of this.fins) finStab += f.def.w * f.def.h * 0.8 * (this.com.y - f.y);
      const vane = this.dynP * (area * 0.04 * Math.min(L, 6) * (along > 0 ? 1 : -1) + finStab);
      T.x += P.F.y * hz * vane; T.y -= P.F.x * hz * vane; T.z += (P.F.x * hy - P.F.y * hx) * vane; // (nose × flow)

      // Wings (in two halves, so rolling damps itself, ailerons work and one half can stall before the
      // other) and tail fins: lift and drag at each surface's centre of lift, from the air flowing past it.
      // W: the wing's aerodynamics (null for a fin); ge: ground effect, more lift within a span of the ground.
      const M = this.mach, rip = this.rip, noodle = Silly.on('noodle'), cz = this.com.z || 0;
      let strain = 0; // the most loaded surface's load over its limit
      for (const p of this.wings) if (p.stress) p.stress = Math.max(0, p.stress - 0.12 * dt);
      for (const p of this.vtails) if (p.stress) p.stress = Math.max(0, p.stress - 0.12 * dt);
      const surf = (p, area, nrm, ch, rz, kd, main, W, ge) => {
        const back = W ? W.back : 0;
        const rx = p.x + ch.x * (p.def.h / 4 - back) - this.com.x, ry = p.y + ch.y * (p.def.h / 4 - back) - this.com.y;
        const ux = vb.x + wb.y * rz - wb.z * ry, uy = vb.y + wb.z * rx - wb.x * rz, uz = vb.z + wb.x * ry - wb.y * rx;
        const un = ux * nrm.x + uy * nrm.y + uz * nrm.z, uc = ux * ch.x + uy * ch.y, V = Math.hypot(un, uc);
        if (V < 0.5) return 0;
        const qS = 0.5 * rho * V * V * area, slope = W ? W.slope : 3.5;
        // torque per unit of lift coefficient: -qS (r × n)
        const gx = -qS * (ry * nrm.z - rz * nrm.y), gy = -qS * (rz * nrm.x - rx * nrm.z), gz = -qS * (rx * nrm.y - ry * nrm.x);
        let Fn, Fc, defl = 0;
        if (uc > 0) {
          // a moving surface deflects whichever way turns the craft as commanded; at high speed the air
          // pushes it back, so it can't swing as far
          const gl = Math.hypot(gx, gy, gz) || 1, kq = kd * Math.min(1, 26000 / Math.max(1, qS / area));
          defl = kq * clamp((this.cmd.x * gx + this.cmd.y * gy + this.cmd.z * gz) / gl, -1, 1);
          auth.x += Math.abs(gx) * slope * kq; auth.y += Math.abs(gy) * slope * kq; auth.z += Math.abs(gz) * slope * kq;
          const flap = W && p.def.wing.flaps ? this.flaps : 0, stall = (W ? W.stall : 0.45) - 0.03 * flap; // (a stubby fin stalls late)
          // flaps add lift (and drag) at any angle, and make the wing stall a little sooner
          const a = Math.atan2(un, uc), ae = a + defl, x = Math.abs(ae);
          const cl = (liftCoef(ae, slope, stall) + 0.8 * flap * (1 - 0.5 * smoothstep(stall, stall + 0.22, x))) * ge * (p.hp != null && hasCombat() ? Combat.liftK(p) : 1); // a shot-up wing lifts less
          const cdw = (W ? W.cd0 : 0.012) + (W ? W.kInd : 0.1) * cl * cl + 1.2 * Math.sin(x) ** 2 * smoothstep(stall, stall + 0.22, x)
            + 0.06 * flap + (W ? 0.03 * W.wave : 0.03) * waveDrag(M, W ? W.mcrit : 0.85);
          Fn = qS * (-cl * uc - cdw * un) / V; // lift along (-uc, un)/V, drag against the flow
          Fc = qS * (cl * un - cdw * uc) / V;
          if (main) this.aoa = a;
        } else { // air flowing backwards over the surface: a flat plate
          const sn = un / V;
          Fn = -qS * (1.2 * sn * Math.abs(sn) + 0.02 * sn); Fc = -qS * 0.02 * uc / V;
        }
        // pull too hard and the structure gives way. A moment over its load is survivable (stress builds up,
        // and fades again below it); far over (or noodle wings over at all) is not.
        const rr = Math.abs(Fn) / ((W ? W.load : FIN_LOAD) * area * (noodle ? 0.25 : 1));
        if (rr > strain) strain = rr;
        if (rr > 1) {
          p.stress = (p.stress || 0) + (rr - 1) * 2 * dt;
          if ((rr > 1.8 || noodle || p.stress >= 1) && !rip.includes(p) && !this.isDebris) rip.push(p); // (a torn-off piece tumbling on doesn't tear again)
        }
        const fx = nrm.x * Fn + ch.x * Fc, fy = nrm.y * Fn + ch.y * Fc, fz = nrm.z * Fn;
        Fb.x += fx; Fb.y += fy; Fb.z += fz;
        T.x += ry * fz - rz * fy; T.y += rz * fx - rx * fz; T.z += rx * fy - ry * fx;
        return defl;
      };
      for (const p of this.wings) {
        const wd = p.def.wing, W = wd.swing ? swingAero(p, M, this.flaps) : wingAero(p.def), ch = partAxis(p), s = wd.span / 4;
        const kd = wd.control || 0.12; // plain wings carry ailerons
        const ge = 1 + 0.3 * Math.exp((-3 * Math.max(0, above)) / wd.span);
        // dihedral: each half's lift leans in towards the middle, so a sideslip rolls the plane level
        const cg = Math.cos(W.dihedral), sg = Math.sin(W.dihedral);
        const d0 = surf(p, wd.area / 2, v3(ch.y * cg, -ch.x * cg, sg), ch, s - cz, kd, p === this.mainWing, W, ge);
        const d1 = surf(p, wd.area / 2, v3(ch.y * cg, -ch.x * cg, -sg), ch, -s - cz, kd, false, W, ge);
        p.deflect = (d0 + d1) / 2; p.aileron = (d0 - d1) / 2;
      }
      // a fin works from where it stands; a twin pair as one fin of twice the area on the centreline
      for (const p of this.vtails) {
        const ar = p.def.w * p.def.h * 0.7 * partZs(p).length;
        p.deflect = surf(p, ar, v3(0, 0, 1), partAxis(p), partZc(p) - cz, 0.4, false, null, 1);
      }
      this.slip = Math.asin(clamp(hz, -1, 1));
      // the fuselage and fin together resist yawing more than the fin alone works out to here: this damps
      // the nose's swing back and forth after a sideslip (the fishtail)
      if (this.kind === 'plane' && this.vtails.length) {
        let c = 0;
        for (const p of this.vtails) { const arm = p.y - this.com.y; c += p.def.w * p.def.h * partZs(p).length * arm * arm; }
        const wu = wb.x * P.U.x + wb.y * P.U.y + wb.z * P.U.z, k = 0.5 * rho * v * 3.5 * c * 4 * wu;
        T.x -= P.U.x * k; T.y -= P.U.y * k; T.z -= P.U.z * k;
      }
      this.strain = strain;
      this.nz = (Fb.x * P.U.x + Fb.y * P.U.y + Fb.z * P.U.z) / (this.mass * G0); // load factor through the floor
      // too fast: past its own limit (equivalent airspeed, or a Mach number where it has one) a wing flutters.
      // Stress builds, the quicker the further over, and it tears off; far over (1.3 times), at once. Noodle
      // wings give at half the speed, a shot-up wing a little sooner. The Mach limit fades out in thin air (on
      // Earth from about 21 down to 15 km), so it can't shake a wing apart high up. Only a craft someone flies.
      // overspeed is the worst wing's speed over its limit (past 1 it flutters). overWarn is the same for the
      // warning (from 0.9), which also counts the full Mach limit in thin air on the way down, so a craft
      // coming home too fast hears about it before the air thickens; overMach, the warning is about Mach.
      const eas = Math.sqrt(this.dynP / 0.6), thin = smoothstep(0.02, 0.06, (rho * 1.2) / b.rho0), live = !!this.control && !this.isDebris; // (eas: sqrt(2q / 1.2), the HUD speed at sea level; thin: by the air's share of its sea-level density)
      const sink = thin < 1 && this.vSpeed() < 0;
      let over = 0, warn = 0, overM = false;
      for (const p of this.wings) {
        const W = wingAero(p.def);
        if (!W.vne) continue;
        const k = (noodle ? 0.5 : 1) * (p.hp != null && hasCombat() ? Math.sqrt(Combat.liftK(p)) : 1);
        const re = eas / (W.vne * k), m = W.mmax ? M / (W.mmax * k) : 0, rm = m * thin, r = Math.max(re, rm), w = Math.max(re, sink ? m : rm);
        if (r > over) over = r;
        if (w > warn) { warn = w; overM = w > re; }
        if (r > 1 && live) {
          p.stress = (p.stress || 0) + ((r - 1) * 3 + 0.12) * dt;
          if ((r > 1.3 || p.stress >= 1) && !rip.includes(p)) { rip.push(p); this.ripWhy = 'speed'; }
        }
      }
      this.overspeed = over; this.overWarn = warn; this.overMach = overM;
    } else {
      for (const p of this.wings) { p.deflect = 0; p.aileron = 0; }
      this.strain = 0; this.overspeed = 0; this.overWarn = 0; this.overMach = false; this.nz = 0;
    }
    if (this.updateHeat(dt, rho, v, vb, sim)) return;

    // integrate: forces into sim axes, then Euler's equations for the spin
    const Fw = qrot(this.q, Fb.x, Fb.y, Fb.z, _t1), im = 1 / this.mass;
    ax += Fw.x * im; ay += Fw.y * im; az += Fw.z * im;
    const Fa = qrot(this.q, Fb.x - eng.F.x, Fb.y - eng.F.y, Fb.z - eng.F.z, _t2);
    this.lift = (Fa.x * this.x + Fa.y * this.y + Fa.z * this.z) / r; // aerodynamic force, upwards
    this.vx += ax * dt; this.vy += ay * dt; this.vz += az * dt;
    const Iw = this.mulI(wb, _t2), gyro = cross3(wb, Iw, _t3);
    const dw = this.mulInvI(v3(T.x - gyro.x, T.y - gyro.y, T.z - gyro.z));
    wb.x += dw.x * dt; wb.y += dw.y * dt; wb.z += dw.z * dt;
    const sp = len3(wb);
    if (sp > MAX_SPIN) { wb.x *= MAX_SPIN / sp; wb.y *= MAX_SPIN / sp; wb.z *= MAX_SPIN / sp; }
    qrot(this.q, wb.x, wb.y, wb.z, this.av);
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.integrateSpin(dt);

    this.thrust = eng.total;
    this.accel = eng.total / m0;
    this.gForce = Math.hypot(ax - gk * this.x, ay - gk * this.y, az - gk * this.z) / G0;
    this.ground(dt, sim);
    if (this.rip.length) {
      const r = this.rip.filter((p) => this.byId.has(p.id)), why = this.ripWhy || 'g';
      this.rip = []; this.ripWhy = null;
      if (r.length && sim.ripParts) sim.ripParts(this, r, why);
    }
  }

  integrateSpin(dt) {
    const a = this.av, q = this.q, h = 0.5 * dt;
    const w = q.w - h * (a.x * q.x + a.y * q.y + a.z * q.z), x = q.x + h * (a.x * q.w + a.y * q.z - a.z * q.y);
    const y = q.y + h * (a.y * q.w + a.z * q.x - a.x * q.z), z = q.z + h * (a.z * q.w + a.x * q.y - a.y * q.x);
    q.w = w; q.x = x; q.y = y; q.z = z;
    qnorm(q);
  }

  // Reentry heating: the leading face takes the heat; everything cools by radiation.
  updateHeat(dt, rho, v, vb, sim) {
    // compression heating only matters well above the speed of sound (jets don't glow; reentries do)
    const flux = rho > 0 ? rho * v * v * v * smoothstep(500, 1400, v) : 0;
    let front = -Infinity;
    if (flux > 2e6) {
      const lx = vb.x / v, ly = vb.y / v, sz = vb.z / v, lz = Math.abs(sz);
      for (const p of this.parts) {
        const d = partDims(p);
        // where it sits across: a part off the centre line, or a pair moved out from its usual spread
        const across = p.def.twinZ ? (partZ(p) - p.def.twinZ) * Math.abs(sz) : partZ(p) * sz;
        p._lead = p.x * lx + p.y * ly + Math.abs((d.w / 2) * lx) + Math.abs((d.h / 2) * ly) + (partDepth(p) / 2) * lz + across;
        if (p._lead > front) front = p._lead;
      }
    }
    let burned = null, worst = 0;
    for (const p of this.parts) {
      const T = p.temp || AMBIENT_T;
      const exposure = flux > 2e6 ? (p._lead >= front - 0.3 ? 1 : 0.12) : 0;
      p.temp = T + (flux * 2.8e-6 * exposure - (T - AMBIENT_T) * 0.08) * dt;
      const k = (p.temp - AMBIENT_T) / (p.def.maxTemp - AMBIENT_T);
      if (k > worst) worst = k;
      if (p.temp > p.def.maxTemp) (burned || (burned = [])).push(p);
    }
    this.maxHeat = worst;
    this.heatFlux = flux;
    if (burned) {
      sim.toast(`${burned[0].def.name} overheated`, 'warn');
      sim.breakParts(this, burned, 'heat');
      return true;
    }
    return false;
  }

  // Ground and water contact with impulses at the hull's corners and the wheels' rims.
  ground(dt, sim) {
    const b = this.body, R = b.radius, r = this.radius();
    const clear = () => { this.landed = false; this.splashed = false; this.wheelsDown = false; this.contactTime = 0; };
    if (r - this.reach > R + b.terrainMax + 5) return clear();
    const L0 = this.surfaceSpot(), dk = Terrain.deckAt(b, L0.a, L0.z, this.reach + 2); // part of the craft may be over a carrier's deck
    const h0 = Math.max(Terrain.surfaceAt(b, L0.a, L0.z), dk === dk ? dk : -Infinity), lim0 = R + h0 + 2 + this.reach * 0.3;
    if (r - this.reach > lim0) return clear();
    const contacts = [], loc = {}, cz = this.com.z || 0;
    const probe = (k, rad, wheel) => {
      const o = qrot(this.q, k.x - this.com.x, k.y - this.com.y, k.z - cz);
      const px = this.x + o.x, py = this.y + o.y, pz = this.z + o.z, pr = Math.hypot(px, py, pz);
      if (pr - rad > lim0) return;
      Terrain.locate(b, px, py, pz, loc);
      const pen = R + Terrain.surfaceAt(b, loc.a, loc.z) - (pr - rad);
      if (pen <= 0) return;
      const n = Terrain.normalAt(b, loc.a, loc.z);
      if (rad) { o.x -= n.x * rad; o.y -= n.y * rad; o.z -= n.z * rad; }
      // deep under a deck's edge: that's the ship's side, not the deck (a crash, not a lift onto it)
      const side = pen > 4 && Terrain.deckAt(b, loc.a, loc.z) === Terrain.deckAt(b, loc.a, loc.z);
      contacts.push({ p: k.p, k, r: o, pen, n, wheel, side, float: !!k.p.def.float, water: Terrain.waterAt(b, loc.a, loc.z) });
    };
    for (const k of this.hull) probe(k, 0, false);
    for (const k of this.wheelPts) if (!(k.retract && this.gearUp)) probe(k, k.r, true);
    if (!contacts.length) return clear();

    // crash check: far past a part's limit it breaks at once; a bit past it (or near it), it's dented
    const broken = new Set(), dents = new Map(), vp = v3();
    for (const k of contacts) {
      this.pointVel(k.r, vp);
      const lim = (k.p.def.breakSpeed || DEFAULT_BREAK_SPEED) * (k.water ? 1.8 : 1), s = -dot3(vp, k.n);
      if (k.side || s > lim * (hasCombat() ? 1.6 : 1)) broken.add(k.p);
      else if (hasCombat() && s > lim * 0.75) dents.set(k.p, Math.max(dents.get(k.p) || 0, s / lim));
      // a spinning propeller or rotor that touches the ground shatters
      const air = k.p.def.air;
      if (air && (air.kind === 'prop' || air.kind === 'rotor') && (k.p.rpm || 0) > 8 && !k.water) broken.add(k.p);
    }
    if (broken.size && (!Silly.on('bouncy') || contacts.some((k) => k.side))) { sim.breakParts(this, [...broken], 'impact'); return; }
    if (dents.size && sim.vessels && !Silly.on('bouncy')) for (const [p, ratio] of dents) Combat.impact(this, p, ratio, sim);
    if (this.dead || !this.parts.length) return;
    const bounce = Silly.on('bouncy') ? 0.75 : 0;

    const wheelContacts = contacts.filter((k) => k.wheel);
    const driveContacts = wheelContacts.filter((k) => k.p.def.wheel.drive);
    this.wheelsDown = wheelContacts.length > 0;
    // aircraft roll freely: their stick flies them instead of driving
    this.canDrive = !this.aircraft && driveContacts.length > 0;
    const D = this.drive, ctl = this.ctl;
    const throttle = this.canDrive ? ctl.v : 0;
    const driving = this.canDrive && throttle !== 0;
    const braking = this.brake && this.wheelsDown;
    // steering: the front wheels turn, less the faster the craft goes
    const fwdW = qrot(this.q, D.F.x, D.F.y, D.F.z), vF = this.vx * fwdW.x + this.vy * fwdW.y + this.vz * fwdW.z;
    const steerIn = clamp(this.kind === 'plane' ? ctl.h + ctl.r : ctl.h, -1, 1);
    // keep the sideways pull within what the tyres hold, so the craft slides rather than flips
    this.steer = steerIn * Math.min(this.kind === 'plane' ? 0.5 : 0.6, (this.kind === 'plane' ? 3 : 6) * this.wheelbase / Math.max(1, vF * vF));
    const cs = Math.cos(this.steer), sn = Math.sin(this.steer);
    const invM = 1 / this.mass, ir = v3(), t = v3(), rn = v3();
    const impulse = (k, dir, j) => {
      this.vx += dir.x * j * invM; this.vy += dir.y * j * invM; this.vz += dir.z * j * invM;
      cross3(k.r, dir, rn); this.invIWorld(rn, ir);
      this.av.x += ir.x * j; this.av.y += ir.y * j; this.av.z += ir.z * j;
    };
    const effMass = (k, dir) => { cross3(k.r, dir, rn); this.invIWorld(rn, ir); cross3(ir, k.r, t); return invM + dot3(t, dir); };
    const roll = braking ? 0.8 : this.canDrive ? (driving || Math.abs(this.wheelSpeed || 0) > 0.5 ? 0.04 : 0.9) : 0.025;
    for (const k of contacts) {
      if (!k.wheel && !k.float) continue;
      // rolling (or sliding) direction and sideways direction of each wheel or float on the ground
      const front = k.wheel && (k.k.x - this.com.x) * D.F.x + (k.k.y - this.com.y) * D.F.y > 0.3;
      const axle = front ? v3(D.R.x * cs - D.F.x * sn, D.R.y * cs - D.F.y * sn, D.R.z * cs - D.F.z * sn) : D.R;
      const aw = qrot(this.q, axle.x, axle.y, axle.z);
      k.t1 = norm3(cross3(aw, k.n)); k.t2 = cross3(k.n, k.t1);
      // floats glide on water and drag on land; a tail wheel swivels, so it barely resists sideways
      if (k.float) { k.mu1 = k.water ? 0.035 : 0.45; k.mu2 = k.water ? 0.4 : 0.8; }
      else { k.mu1 = k.p.def.wheel.caster && !braking ? 0.02 : roll; k.mu2 = k.water ? 0.15 : k.p.def.wheel.caster ? 0.25 : 0.8; }
    }
    for (let iter = 0; iter < 4; iter++) {
      for (const k of contacts) {
        const n = k.n;
        this.pointVel(k.r, vp);
        const vn = dot3(vp, n);
        if (vn >= 0) continue;
        const jn = -vn * (vn < -2 ? 1 + bounce : 1) / effMass(k, n);
        impulse(k, n, jn);
        this.pointVel(k.r, vp);
        if (k.t1) {
          let vt = dot3(vp, k.t1);
          impulse(k, k.t1, clamp(-vt / effMass(k, k.t1), -k.mu1 * jn, k.mu1 * jn));
          this.pointVel(k.r, vp);
          vt = dot3(vp, k.t2);
          impulse(k, k.t2, clamp(-vt / effMass(k, k.t2), -k.mu2 * jn, k.mu2 * jn));
        } else {
          const vnn = dot3(vp, n);
          t.x = vp.x - n.x * vnn; t.y = vp.y - n.y * vnn; t.z = vp.z - n.z * vnn;
          const vt = len3(t);
          if (vt < 1e-6) continue;
          const dir = v3(t.x / vt, t.y / vt, t.z / vt), mu = k.water ? 0.15 : 0.9;
          impulse(k, dir, Math.max(-vt / effMass(k, dir), -mu * jn));
        }
      }
    }
    let maxPen = 0, pn = null;
    for (const k of contacts) if (k.pen > maxPen) { maxPen = k.pen; pn = k.n; }
    if (pn) { this.x += pn.x * maxPen * 0.9; this.y += pn.y * maxPen * 0.9; this.z += pn.z * maxPen * 0.9; }

    // driven wheels: a simple speed controller along the ground (the brake works through friction above)
    if (this.wheelsDown) {
      const n = wheelContacts[0].n, fn = dot3(fwdW, n);
      const f = norm3(v3(fwdW.x - n.x * fn, fwdW.y - n.y * fn, fwdW.z - n.z * fn));
      const vt = this.vx * f.x + this.vy * f.y + this.vz * f.z;
      if (this.canDrive && !braking) {
        let top = Infinity, acc = 0;
        for (const k of driveContacts) { top = Math.min(top, k.p.def.wheel.speed || 12); acc = Math.max(acc, k.p.def.wheel.accel || 2.5); }
        const grip = Math.min(1, driveContacts.length / Math.max(1, this.wheelPts.length));
        // drive towards the commanded speed; with no input, slow down gently instead of locking the wheels
        const accel = driving ? clamp((throttle * top - vt) * 1.5, -acc, acc) * grip : clamp(-vt * 1.2, -2, 2) * grip;
        this.vx += f.x * accel * dt; this.vy += f.y * accel * dt; this.vz += f.z * accel * dt;
      }
      this.wheelSpeed = vt;
      if (!braking) for (const w of this.wheels) w.spin = ((w.spin || 0) - (vt / wheelGeom(w).r) * dt) % TAU;
    }
    this.splashed = contacts.some((k) => k.water);
    this.onFloats = contacts.some((k) => k.float);
    if (contacts.some((k) => k.water && !k.float)) { // ploughing through water (floats skim over it)
      const k = Math.exp(-0.6 * dt);
      this.vx *= k; this.vy *= k; this.vz *= k; this.av.x *= k; this.av.y *= k; this.av.z *= k;
    }

    this.contactTime += dt;
    const sp = this.speed();
    this.landed = this.contactTime > 0.2 && sp < 1.5;
    if (this.landed && !driving && sp < 0.15 && len3(this.av) < 0.05 && this.thrust < this.mass * 0.2) {
      this.restTime += dt;
      if (this.restTime > 0.5) { this.vx = 0; this.vy = 0; this.vz = 0; this.av.x *= 0.5; this.av.y *= 0.5; this.av.z *= 0.5; }
    } else this.restTime = 0;
  }

  // Rest on the surface of `body` at angle `ang` and depth z0, turned by `rot` (about the depth axis)
  // from upright there (part x east, y up, z north), then by `yaw` about the vertical.
  placeOnSurface(body, ang, rot, z0 = 0, yaw = 0) {
    this.body = body;
    const lat = z0 / body.radius, cl = Math.cos(lat);
    const F = surfaceFrame(cl * Math.cos(ang), cl * Math.sin(ang), Math.sin(lat));
    this.q = qmul(qbasis(F.east, F.up, F.north), qmul(qaxis(0, 1, 0, yaw), qaxis(0, 0, 1, rot)));
    const u = F.up, cz = this.com.z || 0;
    let low = Infinity;
    for (const k of this.hull) low = Math.min(low, dot3(qrot(this.q, k.x - this.com.x, k.y - this.com.y, k.z - cz, _t1), u));
    for (const k of this.wheelPts) low = Math.min(low, dot3(qrot(this.q, k.x - this.com.x, k.y - this.com.y, k.z - cz, _t1), u) - k.r);
    const r = body.radius + Terrain.surfaceAt(body, ang, z0) - low + 0.02;
    this.x = u.x * r; this.y = u.y * r; this.z = u.z * r;
    this.vx = 0; this.vy = 0; this.vz = 0; this.av = v3();
    this.landed = true;
  }

  // Engines/separators/chutes that respond to a tap.
  activatePart(p, sim) {
    if (!this.byId.has(p.id)) return false;
    if (p.def.thrust) {
      if (p.def.solid && p.active) { sim.toast('Solid boosters can’t be shut down'); return false; }
      p.active = !p.active;
      if (p.active && !this.hasFuelFor(p)) { sim.toast(`${p.def.name}: no fuel`); p.active = false; }
      return true;
    }
    if (p.def.separator) { sim.fireSeparator(this, p); return true; }
    if (p.def.chute) return sim.deployChute(this, p);
    return false;
  }

  hitTest(lx, ly, pad = 0.25) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const r = partRect(this.parts[i]);
      if (lx >= r.l - pad && lx <= r.r + pad && ly >= r.b - pad && ly <= r.t + pad) return this.parts[i];
    }
    return null;
  }

  totalFuel() { let f = 0; for (const p of this.parts) f += p.fuel; return f; }

  stageFuel() {
    let fuel = 0, cap = 0;
    for (const g of this.groups) {
      if (!g.engines.some((e) => e.active)) continue;
      for (const t of g.tanks) { fuel += t.fuel; cap += t.def.fuel * 1000; }
    }
    return { fuel, cap };
  }

  value() { return designCost(this.parts); }

  // Split off every part not connected to the control part (or the first part).
  splitComponents() {
    const ctrl = this.control || this.parts[0];
    if (!ctrl) return [];
    const keep = componentOf(ctrl.id, this.adj);
    const rest = this.parts.filter((p) => !keep.has(p.id));
    if (!rest.length) return [];
    const pieces = [];
    const left = new Set(rest.map((p) => p.id));
    while (left.size) {
      const start = left.values().next().value;
      const comp = componentOf(start, this.adj);
      const pp = rest.filter((p) => comp.has(p.id));
      for (const p of pp) left.delete(p.id);
      pieces.push(pp);
    }
    this.parts = this.parts.filter((p) => keep.has(p.id));
    // stages after the one being fired now; the current stage is never touched so the index stays valid
    const remaining = this.stages.slice(this.stageIdx + 1);
    const out = [];
    for (const pp of pieces) {
      const ids = new Set(pp.map((p) => p.id));
      const adj = new Map();
      for (const p of pp) adj.set(p.id, new Set([...this.adj.get(p.id)].filter((id) => ids.has(id))));
      const v = new Vessel(pp, adj, this.body);
      const rel = qrot(this.q, v.com.x - this.com.x, v.com.y - this.com.y, (v.com.z || 0) - (this.com.z || 0));
      v.x = this.x + rel.x; v.y = this.y + rel.y; v.z = this.z + rel.z;
      const pv = this.pointVel(rel);
      v.vx = pv.x; v.vy = pv.y; v.vz = pv.z;
      v.q = quat(this.q.w, this.q.x, this.q.y, this.q.z); v.av = v3(this.av.x, this.av.y, this.av.z);
      v.throttle = this.throttle;
      v.kind = this.kind;
      v.gearUp = this.gearUp;
      v.isDebris = !v.control;
      v.name = v.control ? `${this.name} (${v.control.def.name})` : 'Debris';
      v.stages = remaining.map((st) => st.filter((id) => ids.has(id))).filter((st) => st.length);
      v.rebuildGroups();
      out.push(v);
    }
    for (const id of [...this.adj.keys()]) if (!this.parts.some((p) => p.id === id)) this.adj.delete(id);
    for (const set of this.adj.values()) for (const id of [...set]) if (!this.adj.has(id)) set.delete(id);
    const mine = new Set(this.parts.map((p) => p.id));
    this.stages = [...this.stages.slice(0, this.stageIdx + 1), ...remaining.map((st) => st.filter((id) => mine.has(id))).filter((st) => st.length)];
    this.rebuildGroups();
    return out;
  }

  serialize() {
    return {
      body: this.body.id, x: this.x, y: this.y, z: this.z, vx: this.vx, vy: this.vy, vz: this.vz,
      q: [this.q.w, this.q.x, this.q.y, this.q.z], av: [this.av.x, this.av.y, this.av.z],
      throttle: this.throttle, sas: this.sas, isDebris: this.isDebris, name: this.name, kind: this.kind, flaps: this.flaps, gearUp: this.gearUp,
      stages: this.stages, stageIdx: this.stageIdx, landed: this.landed,
      parts: this.parts.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, z: p.z, att: p.att, skin: p.skin, rot: p.rot || 0, flip: p.flip, fuel: p.fuel, active: p.active,
        deployed: p.deployed, used: p.used, fired: p.fired, temp: p.temp, flameout: p.flameout, hp: p.hp, ammo: p.ammo, store: p.store })),
      adj: [...this.adj].map(([k, v]) => [k, [...v]]),
    };
  }

  static restore(d) {
    // (ids are kept, so att still names the host; one that went with another piece, or none, is dropped)
    const parts = d.parts.filter((q) => q && hasOwn(PARTS, q.type)).map((q) => {
      const def = PARTS[q.type], p = makePart(q.type, q.x, q.y);
      Object.assign(p, q, { def, z: cleanZ(q.z, def), skin: cleanSkin(q.skin, def) });
      return p;
    });
    cleanAtt(parts);
    const ids = new Set(parts.map((p) => p.id));
    const adj = new Map(d.adj.filter(([k]) => ids.has(k)).map(([k, v]) => [k, new Set(v.filter((id) => ids.has(id)))]));
    for (const p of parts) if (!adj.has(p.id)) adj.set(p.id, new Set());
    const v = new Vessel(parts, adj, BODY_BY_ID[d.body] || EARTH);
    Object.assign(v, { throttle: d.throttle, sas: d.sas || 'hold', isDebris: d.isDebris, name: d.name || 'Vessel',
      stages: d.stages || [], stageIdx: d.stageIdx || 0, landed: !!d.landed, kind: d.kind || 'rocket', flaps: d.flaps || 0, gearUp: !!d.gearUp });
    // flights saved before the third dimension only turned about z
    v.q = d.q ? qnorm(quat(...d.q)) : qaxis(0, 0, 1, d.rot || 0);
    v.av = d.av ? v3(...d.av) : v3(0, 0, d.w || 0);
    for (const p of parts) if (p.def.wheel && p.def.wheel.retract) p.retracted = v.gearUp;
    v.rebuildGroups();
    // rebuildGroups shifts position for the COM; restore the saved values
    Object.assign(v, { x: d.x, y: d.y, z: d.z || 0, vx: d.vx, vy: d.vy, vz: d.vz || 0 });
    return v;
  }
}
