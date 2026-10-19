'use strict';
// A vessel is a rigid assembly of parts flying around one body (patched conics), in full 3D.
// Part space is the builder's: +y runs up the stack, x across it, z is depth (out of the blueprint).
// The quaternion q turns part space (about the centre of mass) into the sim's axes; av is the angular
// velocity in sim axes. Positions and velocities are relative to the body's centre.

const DEFAULT_BREAK_SPEED = 9;
const ROUND3D = new Set(['pod', 'probe', 'probeL', 'tank', 'fuselage', 'srb', 'sep', 'nose', 'adapter', 'tailcone', 'engine', 'spike', 'ion', 'shield', 'chute', 'jet', 'cockpit', 'rotor', 'prop']);
const MIN_AIR = 0.03; // kg/m³: air-breathing engines flame out below this
const MAX_SPIN = 6;   // rad/s

// Lift coefficient of a wing at angle of attack a (forward flow): linear up to the stall, then it
// sinks towards a flat plate's.
function liftCoef(a) {
  const x = Math.abs(a), stall = 0.28;
  const cl = x < stall ? 5.5 * x : lerp(5.5 * stall, 1.1 * Math.sin(2 * x), smoothstep(stall, stall + 0.22, x));
  return Math.sign(a) * cl;
}

// Thrust factor of an air-breathing engine for the air density and the airspeed along its axis.
function airThrust(a, rho, vA) {
  if (rho < MIN_AIR) return 0;
  let k = Math.min(1.3, Math.pow(rho / EARTH.rho0, 0.7));
  if (a.kind === 'jet') k *= vA < a.vmax ? 1 + 0.3 * Math.max(0, vA) / a.vmax : Math.max(0, 1.3 * (1 - (vA - a.vmax) / 200));
  else k *= Math.min(1, a.v0 / Math.max(vA, 1)); // props and rotors: constant power above v0
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
    this.com = { x: 0, y: 0 };
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

  recompute(initial) {
    let m = 0, cx = 0, cy = 0;
    for (const p of this.parts) {
      const pm = p.def.mass * 1000 + p.fuel;
      m += pm; cx += pm * p.x; cy += pm * p.y;
    }
    cx /= m; cy /= m;
    if (!initial) {
      // keep parts fixed in space when the centre of mass moves
      const d = qrot(this.q, cx - this.com.x, cy - this.com.y, 0, _t1);
      this.x += d.x; this.y += d.y; this.z += d.z;
    }
    this.mass = m;
    this.com = { x: cx, y: cy };
    // inertia tensor about the centre of mass: parts are boxes, all centred on z = 0 but wheel pairs
    let Ixx = 0, Iyy = 0, Izz = 0, Ixy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, D = 0;
    for (const p of this.parts) {
      const pm = p.def.mass * 1000 + p.fuel, { w, h } = partDims(p), d = partDepth(p);
      const dx = p.x - cx, dy = p.y - cy, dz2 = p.def.wheel ? (p.def.wheel.track || 0) ** 2 / 4 : 0;
      Ixx += pm * ((h * h + d * d) / 12 + dy * dy + dz2);
      Iyy += pm * ((w * w + d * d) / 12 + dx * dx + dz2);
      Izz += pm * ((w * w + h * h) / 12 + dx * dx + dy * dy);
      Ixy -= pm * dx * dy;
      const r = partRect(p);
      minX = Math.min(minX, r.l); maxX = Math.max(maxX, r.r); minY = Math.min(minY, r.b); maxY = Math.max(maxY, r.t);
      D = Math.max(D, d);
    }
    Ixx = Math.max(Ixx, 1); Iyy = Math.max(Iyy, 1); Izz = Math.max(Izz, 1);
    const det = Ixx * Iyy - Ixy * Ixy || 1;
    this.I = { xx: Ixx, yy: Iyy, zz: Izz, xy: Ixy, ixx: Iyy / det, iyy: Ixx / det, ixy: -Ixy / det, izz: 1 / Izz };
    this.inertia = Math.max(Ixx, Iyy, Izz);
    this.bounds = { minX, maxX, minY, maxY };
    this.width = maxX - minX;
    this.depth = D;
  }
  // I·v and I⁻¹·v in part axes
  mulI(v, o = v3()) { const I = this.I, x = I.xx * v.x + I.xy * v.y, y = I.xy * v.x + I.yy * v.y; o.x = x; o.y = y; o.z = I.zz * v.z; return o; }
  mulInvI(v, o = v3()) { const I = this.I, x = I.ixx * v.x + I.ixy * v.y, y = I.ixy * v.x + I.iyy * v.y; o.x = x; o.y = y; o.z = I.izz * v.z; return o; }
  // I⁻¹·v for a vector in sim axes
  invIWorld(v, o = v3()) { qunrot(this.q, v.x, v.y, v.z, o); this.mulInvI(o, o); return qrot(this.q, o.x, o.y, o.z, o); }
  bodyAV(o = v3()) { return qunrot(this.q, this.av.x, this.av.y, this.av.z, o); }

  rebuildGroups() {
    this.groups = fuelGroups(this.parts, this.adj);
    this.byId = new Map(this.parts.map((p) => [p.id, p]));
    let top = null;
    for (const p of this.parts) if (!top || partRect(p).t > partRect(top).t) top = p;
    this.noseAero = !!(top && (top.def.aero || top.def.chute));
    this.wheels = this.parts.filter((p) => p.def.wheel);
    this.fins = this.parts.filter((p) => p.def.fin);
    this.wings = this.parts.filter((p) => p.def.wing);
    this.vtails = this.parts.filter((p) => p.def.shape === 'vtail');
    this.aircraft = this.wings.length > 0;
    this.mainWing = this.wings.reduce((m, p) => (!p.def.wing.control && (!m || p.def.wing.area > m.def.wing.area) ? p : m), null);
    this.rotors = this.parts.filter((p) => p.def.air && p.def.air.kind === 'rotor');
    this.tailRotors = this.parts.filter((p) => p.def.shape === 'tailrotor');
    this.recompute(false);
    this.computeAreas();
    this.computeHull();
  }

  // Projected areas seen along each part axis. Each slice through the craft sums the parts it cuts;
  // wings carry their own drag.
  computeAreas() {
    const D = this.parts.filter((p) => !p.def.wing)
      .map((p) => ({ p, d: partDims(p), z: p.def.wheel ? 0.25 : partDepth(p), round: ROUND3D.has(p.def.shape) }));
    let ax = 0, ay = 0, az = 0;
    for (const s of D) {
      let fx = 0, fy = 0;
      for (const o of D) {
        if (Math.abs(o.p.y - s.p.y) < o.d.h / 2) fy += o.d.w * o.z * (o.round ? 0.785 : 1);
        if (Math.abs(o.p.x - s.p.x) < o.d.w / 2) fx += o.d.h * o.z;
      }
      ax = Math.max(ax, fx); ay = Math.max(ay, fy);
      az += s.d.w * s.d.h * (s.p.def.fin || s.p.def.shape === 'vtail' ? 0.5 : 0.85);
    }
    this.area = v3(Math.max(ax, 0.5), Math.max(ay, 0.5), Math.max(az, 0.5));
    this.areaFront = this.area.y;
  }

  // Points the ground can touch, in part space: the corners of each part's box (a diamond around a round
  // part's ends) and every wheel's centre and radius. Rocket legs and fins stand in fours around the stack:
  // each also gets a copy turned 90° about the stack's axis.
  computeHull() {
    const pts = [], wheels = [], radial = this.kind === 'rocket';
    let reach = 0;
    const add = (p, x, y, z) => {
      pts.push({ p, x, y, z });
      if (radial && (p.def.leg || p.def.fin)) pts.push({ p, x: z, y, z: -x });
      reach = Math.max(reach, Math.hypot(x - this.com.x, y - this.com.y, z), radial ? Math.hypot(x, y - this.com.y) : 0);
    };
    for (const p of this.parts) {
      if (p.def.wheel) {
        const g = wheelGeom(p), tr = (p.def.wheel.track || 0) / 2;
        for (const z of tr ? [-tr, tr] : [0]) wheels.push({ p, x: g.x, y: g.y, z, r: g.r });
        reach = Math.max(reach, Math.hypot(g.x - this.com.x, g.y - this.com.y, tr) + g.r);
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
    this.reach = reach + 0.5;
  }

  // Local (part space) -> position relative to body centre.
  toWorld(lx, ly, lz = 0) {
    const d = qrot(this.q, lx - this.com.x, ly - this.com.y, lz);
    d.x += this.x; d.y += this.y; d.z += this.z;
    return d;
  }
  toLocal(wx, wy, wz = 0) {
    const d = qunrot(this.q, wx - this.x, wy - this.y, wz - this.z);
    d.x += this.com.x; d.y += this.com.y;
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
    const r = this.radius(), ux = this.x / r, uy = this.y / r, uz = this.z / r;
    let low = 0;
    for (const k of this.hull) {
      const o = qrot(this.q, k.x - this.com.x, k.y - this.com.y, k.z, _t1);
      low = Math.min(low, o.x * ux + o.y * uy + o.z * uz);
    }
    for (const k of this.wheelPts) {
      const o = qrot(this.q, k.x - this.com.x, k.y - this.com.y, k.z, _t1);
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
    const fire = (e, f) => {
      const a = partAxis(e), rx = e.x - this.com.x, ry = e.y - this.com.y;
      F.x += a.x * f; F.y += a.y * f; total += f;
      T.z += (rx * a.y - ry * a.x) * f;
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
        let f = e.def.thrust * 1000 * this.throttle;
        if (e.def.air) {
          const a = partAxis(e), k = airThrust(e.def.air, rho, vb.x * a.x + vb.y * a.y);
          if (k <= 0) {
            if (!e.noAir && sim && !this.isDebris) sim.toast(`${e.def.name}: no air to breathe`, 'warn');
            e.noAir = true;
            continue;
          }
          e.noAir = false;
          f *= k;
        }
        if (f <= 0) continue;
        const isp = lerp(e.def.ispVac, e.def.ispSL, pressure);
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
  turnTarget(sim, engF) {
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
    if (this.aircraft) {
      // planes hold their pitch and bank when the pilot lets go and leave the heading to the tail
      const at = this.attitude();
      if (this.holdPitch == null) this.holdPitch = at.pitch;
      if (this.holdBank == null) this.holdBank = Math.abs(at.bank) < 0.06 ? 0 : at.bank;
      if (want.pitch == null) want.pitch = clamp((this.holdPitch - at.pitch) * 1.6, -0.5, 0.5);
      if (want.roll == null) want.roll = clamp(wrapAngle(this.holdBank - at.bank) * 1.6, -0.8, 0.8);
      return toBody(want);
    }
    for (const k in want) if (want[k] == null) want[k] = 0;
    return toBody(want);
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
    this.cmd.x = 0; this.cmd.y = 0; this.cmd.z = 0;
    if (!this.isDebris) {
      const wt = this.turnTarget(sim, eng.total);
      if (wt) {
        const k = 0.35 / Math.max(dt, 1e-3), need = this.mulI(v3((wt.x - wb.x) * k, (wt.y - wb.y) * k, (wt.z - wb.z) * k));
        for (const a of ['x', 'y', 'z']) {
          if (this.surfAuth[a] > 0) this.cmd[a] = clamp(need[a] / Math.max(1, this.surfAuth[a] + A[a]), -1, 1);
          if (A[a] > 0) T[a] += clamp(need[a], -A[a], A[a]);
        }
      }
    }

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
        area = this.width * (this.width * side + L * (1 - side)) * 0.8;
        cdA = cd * area;
      } else {
        const cdF = along > 0.85 ? (this.noseAero ? 0.3 : 0.55) : along < -0.85 ? 0.7 : 0.8, cdO = this.kind === 'car' ? 0.5 : 0.9;
        const sx = this.area.x * Math.abs(hx), sy = this.area.y * Math.abs(hy), sz = this.area.z * Math.abs(hz);
        area = sx + sy + sz;
        cdA = (Math.abs(P.F.x) > 0.5 ? cdF : cdO) * sx + (Math.abs(P.F.y) > 0.5 ? cdF : cdO) * sy + cdO * sz;
      }
      const above = alt - this.groundHeight();
      for (const p of this.parts) {
        if (!p.def.chute || p.deployed <= 0 || p.used) continue;
        // drogue first; the main canopy opens fully close to the ground
        const cap = above < 1500 ? 1 : 0.3;
        if (p.deployed < cap) p.deployed = Math.min(cap, p.deployed + dt * (p.deployed < 0.3 ? 0.5 : 0.35));
        const k = p.deployed;
        const ca = (18 + 520 * k * k) * (p.def.chuteArea || 1);
        cdA += ca;
        // the canopy hauls the top of the stack round to trail behind
        const pull = this.dynP * ca * (p.y + 3 - this.com.y) * 0.08;
        T.x -= hz * pull; T.z -= (-hx + (hy > 0.9 ? 0.3 : 0)) * pull;
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

      // Wings (in two halves, so rolling damps itself and ailerons work) and tail fins: lift and drag at
      // each surface's quarter-chord point, from the air flowing past that point.
      const surf = (p, area, nrm, ch, rz, kd, main) => {
        const rx = p.x + ch.x * p.def.h / 4 - this.com.x, ry = p.y + ch.y * p.def.h / 4 - this.com.y;
        const ux = vb.x + wb.y * rz - wb.z * ry, uy = vb.y + wb.z * rx - wb.x * rz, uz = vb.z + wb.x * ry - wb.y * rx;
        const un = ux * nrm.x + uy * nrm.y + uz * nrm.z, uc = ux * ch.x + uy * ch.y, V = Math.hypot(un, uc);
        if (V < 0.5) return 0;
        const qS = 0.5 * rho * V * V * area;
        // torque per unit of lift coefficient: -qS (r × n)
        const gx = -qS * (ry * nrm.z - rz * nrm.y), gy = -qS * (rz * nrm.x - rx * nrm.z), gz = -qS * (rx * nrm.y - ry * nrm.x);
        let Fn, Fc, defl = 0;
        if (uc > 0) {
          // a moving surface deflects whichever way turns the craft as commanded
          const gl = Math.hypot(gx, gy, gz) || 1;
          defl = kd * clamp((this.cmd.x * gx + this.cmd.y * gy + this.cmd.z * gz) / gl, -1, 1);
          auth.x += Math.abs(gx) * 5.5 * kd; auth.y += Math.abs(gy) * 5.5 * kd; auth.z += Math.abs(gz) * 5.5 * kd;
          const a = Math.atan2(un, uc), ae = a + defl, cl = liftCoef(ae), x = Math.abs(ae);
          const cdw = 0.02 + 0.06 * cl * cl + 1.2 * Math.sin(x) ** 2 * smoothstep(0.28, 0.5, x);
          Fn = qS * (-cl * uc - cdw * un) / V; // lift along (-uc, un)/V, drag against the flow
          Fc = qS * (cl * un - cdw * uc) / V;
          if (main) this.aoa = a;
        } else { // air flowing backwards over the surface: a flat plate
          const sn = un / V;
          Fn = -qS * (1.2 * sn * Math.abs(sn) + 0.02 * sn); Fc = -qS * 0.02 * uc / V;
        }
        const fx = nrm.x * Fn + ch.x * Fc, fy = nrm.y * Fn + ch.y * Fc, fz = nrm.z * Fn;
        Fb.x += fx; Fb.y += fy; Fb.z += fz;
        T.x += ry * fz - rz * fy; T.y += rz * fx - rx * fz; T.z += rx * fy - ry * fx;
        return defl;
      };
      for (const p of this.wings) {
        const wd = p.def.wing, ch = partAxis(p), nrm = v3(ch.y, -ch.x, 0), s = wd.span / 4;
        const kd = wd.control || 0.12; // plain wings carry ailerons
        const d0 = surf(p, wd.area / 2, nrm, ch, s, kd, p === this.mainWing), d1 = surf(p, wd.area / 2, nrm, ch, -s, kd, false);
        p.deflect = (d0 + d1) / 2; p.aileron = (d0 - d1) / 2;
      }
      for (const p of this.vtails) p.deflect = surf(p, p.def.w * p.def.h * 0.7, v3(0, 0, 1), partAxis(p), 0, 0.3, false);
      this.slip = Math.asin(clamp(hz, -1, 1));
    } else for (const p of this.wings) { p.deflect = 0; p.aileron = 0; }
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
    const flux = rho > 0 ? rho * v * v * v : 0;
    let front = -Infinity;
    if (flux > 2e6) {
      const lx = vb.x / v, ly = vb.y / v, lz = Math.abs(vb.z / v);
      for (const p of this.parts) {
        const d = partDims(p);
        p._lead = p.x * lx + p.y * ly + Math.abs((d.w / 2) * lx) + Math.abs((d.h / 2) * ly) + (partDepth(p) / 2) * lz;
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
    const L0 = this.surfaceSpot(), h0 = Terrain.surfaceAt(b, L0.a, L0.z), lim0 = R + h0 + 2 + this.reach * 0.3;
    if (r - this.reach > lim0) return clear();
    const contacts = [], loc = {};
    const probe = (k, rad, wheel) => {
      const o = qrot(this.q, k.x - this.com.x, k.y - this.com.y, k.z);
      const px = this.x + o.x, py = this.y + o.y, pz = this.z + o.z, pr = Math.hypot(px, py, pz);
      if (pr - rad > lim0) return;
      Terrain.locate(b, px, py, pz, loc);
      const pen = R + Terrain.surfaceAt(b, loc.a, loc.z) - (pr - rad);
      if (pen <= 0) return;
      const n = Terrain.normalAt(b, loc.a, loc.z);
      if (rad) { o.x -= n.x * rad; o.y -= n.y * rad; o.z -= n.z * rad; }
      contacts.push({ p: k.p, k, r: o, pen, n, wheel, water: Terrain.waterAt(b, loc.a, loc.z) });
    };
    for (const k of this.hull) probe(k, 0, false);
    for (const k of this.wheelPts) probe(k, k.r, true);
    if (!contacts.length) return clear();

    // crash check
    const broken = new Set(), vp = v3();
    for (const k of contacts) {
      this.pointVel(k.r, vp);
      const lim = (k.p.def.breakSpeed || DEFAULT_BREAK_SPEED) * (k.water ? 1.8 : 1);
      if (-dot3(vp, k.n) > lim) broken.add(k.p);
    }
    if (broken.size) { sim.breakParts(this, [...broken], 'impact'); return; }

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
    for (const k of wheelContacts) {
      // rolling direction and sideways direction of each wheel on the ground
      const front = (k.k.x - this.com.x) * D.F.x + (k.k.y - this.com.y) * D.F.y > 0.3;
      const axle = front ? v3(D.R.x * cs - D.F.x * sn, D.R.y * cs - D.F.y * sn, D.R.z * cs - D.F.z * sn) : D.R;
      const aw = qrot(this.q, axle.x, axle.y, axle.z);
      k.t1 = norm3(cross3(aw, k.n)); k.t2 = cross3(k.n, k.t1);
    }
    const roll = braking ? 0.8 : this.canDrive ? (driving || Math.abs(this.wheelSpeed || 0) > 0.5 ? 0.04 : 0.9) : 0.025;
    for (let iter = 0; iter < 4; iter++) {
      for (const k of contacts) {
        const n = k.n;
        this.pointVel(k.r, vp);
        const vn = dot3(vp, n);
        if (vn >= 0) continue;
        const jn = -vn / effMass(k, n);
        impulse(k, n, jn);
        this.pointVel(k.r, vp);
        if (k.wheel) {
          let vt = dot3(vp, k.t1);
          impulse(k, k.t1, clamp(-vt / effMass(k, k.t1), -roll * jn, roll * jn));
          this.pointVel(k.r, vp);
          const mu = k.water ? 0.15 : 0.8;
          vt = dot3(vp, k.t2);
          impulse(k, k.t2, clamp(-vt / effMass(k, k.t2), -mu * jn, mu * jn));
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
    if (this.splashed) {
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
  // from upright there: part x points east, y up and z north.
  placeOnSurface(body, ang, rot, z0 = 0) {
    this.body = body;
    const lat = z0 / body.radius, cl = Math.cos(lat);
    const F = surfaceFrame(cl * Math.cos(ang), cl * Math.sin(ang), Math.sin(lat));
    this.q = qmul(qbasis(F.east, F.up, F.north), qaxis(0, 0, 1, rot));
    const u = F.up;
    let low = Infinity;
    for (const k of this.hull) low = Math.min(low, dot3(qrot(this.q, k.x - this.com.x, k.y - this.com.y, k.z, _t1), u));
    for (const k of this.wheelPts) low = Math.min(low, dot3(qrot(this.q, k.x - this.com.x, k.y - this.com.y, k.z, _t1), u) - k.r);
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
      const rel = qrot(this.q, v.com.x - this.com.x, v.com.y - this.com.y, 0);
      v.x = this.x + rel.x; v.y = this.y + rel.y; v.z = this.z + rel.z;
      const pv = this.pointVel(rel);
      v.vx = pv.x; v.vy = pv.y; v.vz = pv.z;
      v.q = quat(this.q.w, this.q.x, this.q.y, this.q.z); v.av = v3(this.av.x, this.av.y, this.av.z);
      v.throttle = this.throttle;
      v.kind = this.kind;
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
      throttle: this.throttle, sas: this.sas, isDebris: this.isDebris, name: this.name, kind: this.kind,
      stages: this.stages, stageIdx: this.stageIdx, landed: this.landed,
      parts: this.parts.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, rot: p.rot || 0, flip: p.flip, fuel: p.fuel, active: p.active,
        deployed: p.deployed, used: p.used, fired: p.fired, temp: p.temp, flameout: p.flameout })),
      adj: [...this.adj].map(([k, v]) => [k, [...v]]),
    };
  }

  static restore(d) {
    const parts = d.parts.filter((q) => PARTS[q.type]).map((q) => {
      const p = makePart(q.type, q.x, q.y);
      Object.assign(p, q, { def: PARTS[q.type] });
      return p;
    });
    const ids = new Set(parts.map((p) => p.id));
    const adj = new Map(d.adj.filter(([k]) => ids.has(k)).map(([k, v]) => [k, new Set(v.filter((id) => ids.has(id)))]));
    for (const p of parts) if (!adj.has(p.id)) adj.set(p.id, new Set());
    const v = new Vessel(parts, adj, BODY_BY_ID[d.body] || EARTH);
    Object.assign(v, { throttle: d.throttle, sas: d.sas || 'hold', isDebris: d.isDebris, name: d.name || 'Vessel',
      stages: d.stages || [], stageIdx: d.stageIdx || 0, landed: !!d.landed, kind: d.kind || 'rocket' });
    // flights saved before the third dimension only turned about z
    v.q = d.q ? qnorm(quat(...d.q)) : qaxis(0, 0, 1, d.rot || 0);
    v.av = d.av ? v3(...d.av) : v3(0, 0, d.w || 0);
    v.rebuildGroups();
    // rebuildGroups shifts position for the COM; restore the saved values
    Object.assign(v, { x: d.x, y: d.y, z: d.z || 0, vx: d.vx, vy: d.vy, vz: d.vz || 0 });
    return v;
  }
}
