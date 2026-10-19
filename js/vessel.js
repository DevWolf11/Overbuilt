'use strict';
// A vessel is a rigid assembly of parts flying around one body (patched conics).

const DEFAULT_BREAK_SPEED = 9;
const ROUND3D = new Set(['pod', 'probe', 'probeL', 'tank', 'fuselage', 'srb', 'sep', 'nose', 'adapter', 'tailcone', 'engine', 'spike', 'ion', 'shield', 'chute', 'jet', 'cockpit']);
const MIN_AIR = 0.03; // kg/m³: air-breathing engines flame out below this

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
const SAS_MODES = ['hold', 'prograde', 'retrograde', 'radialOut', 'radialIn', 'target'];

class Vessel {
  constructor(parts, adj, body) {
    this.parts = parts;
    this.adj = adj;
    this.body = body;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.rot = 0; this.w = 0;
    this.throttle = 1;
    this.input = 0; // -1..1, positive = turn right (clockwise)
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
    this.ctrlCmd = 0;   // control-surface command, -1..1
    this.surfAuth = 0;  // torque the control surfaces gave at full deflection last step
    this.aoa = null;
    this.lift = 0;
    this.airspeed = 0;
    this.com = { x: 0, y: 0 };
    this.recompute(true);
  }

  get control() { return findControlPart(this.parts); }

  recompute(initial) {
    let m = 0, cx = 0, cy = 0;
    for (const p of this.parts) {
      const pm = p.def.mass * 1000 + p.fuel;
      m += pm; cx += pm * p.x; cy += pm * p.y;
    }
    cx /= m; cy /= m;
    if (!initial) {
      // keep parts fixed in space when the centre of mass moves
      const dx = cx - this.com.x, dy = cy - this.com.y;
      const c = Math.cos(this.rot), s = Math.sin(this.rot);
      this.x += c * dx - s * dy; this.y += s * dx + c * dy;
    }
    this.mass = m;
    this.com = { x: cx, y: cy };
    let I = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of this.parts) {
      const pm = p.def.mass * 1000 + p.fuel;
      const dx = p.x - cx, dy = p.y - cy;
      I += pm * ((p.def.w * p.def.w + p.def.h * p.def.h) / 12 + dx * dx + dy * dy);
      const r = partRect(p);
      minX = Math.min(minX, r.l); maxX = Math.max(maxX, r.r); minY = Math.min(minY, r.b); maxY = Math.max(maxY, r.t);
    }
    this.inertia = Math.max(I, 1);
    this.bounds = { minX, maxX, minY, maxY };
    this.width = maxX - minX;
  }

  rebuildGroups() {
    this.groups = fuelGroups(this.parts, this.adj);
    this.byId = new Map(this.parts.map((p) => [p.id, p]));
    let top = null;
    for (const p of this.parts) if (!top || partRect(p).t > partRect(top).t) top = p;
    this.noseAero = !!(top && (top.def.aero || top.def.chute));
    this.wheels = this.parts.filter((p) => p.def.wheel);
    this.fins = this.parts.filter((p) => p.def.fin);
    this.wings = this.parts.filter((p) => p.def.wing);
    this.aircraft = this.wings.length > 0;
    this.mainWing = this.wings.reduce((m, p) => (!p.def.wing.control && (!m || p.def.wing.area > m.def.wing.area) ? p : m), null);
    this.rotors = this.parts.filter((p) => p.def.air && p.def.air.kind === 'rotor');
    this.tailRotors = this.parts.filter((p) => p.def.shape === 'tailrotor');
    this.recompute(false);
    this.computeAreas();
  }

  // Projected areas for vehicles that aren't rockets: nose-first (along local y) and side-on (along x).
  // Each slice through the craft sums the parts it cuts; wings carry their own drag.
  computeAreas() {
    const body = this.parts.filter((p) => !p.def.wing);
    const front = (p) => (p.def.wheel ? 0.25 : p.def.depth ? p.def.w * p.def.depth : ROUND3D.has(p.def.shape) ? 0.785 * p.def.w * p.def.w : p.def.w * 0.3);
    const side = (p) => (p.def.wheel ? p.def.h * 0.8 : p.def.h * (p.def.depth || (ROUND3D.has(p.def.shape) ? p.def.w : 0.3)));
    let aF = 0, aS = 0;
    for (const s of body) {
      let f = 0, g = 0;
      for (const p of body) {
        if (Math.abs(p.y - s.y) < p.def.h / 2) f += front(p);
        if (Math.abs(p.x - s.x) < p.def.w / 2) g += side(p);
      }
      aF = Math.max(aF, f); aS = Math.max(aS, g);
    }
    this.areaFront = Math.max(aF, 0.5);
    this.areaSide = Math.max(aS, 0.5);
  }

  // Local (part space) -> position relative to body centre.
  toWorld(lx, ly) {
    const dx = lx - this.com.x, dy = ly - this.com.y;
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return { x: this.x + c * dx - s * dy, y: this.y + s * dx + c * dy };
  }
  toLocal(wx, wy) {
    const dx = wx - this.x, dy = wy - this.y;
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return { x: c * dx + s * dy + this.com.x, y: -s * dx + c * dy + this.com.y };
  }

  altitude() { return Math.hypot(this.x, this.y) - this.body.radius; }
  speed() { return Math.hypot(this.vx, this.vy); }
  // Height of the craft's lowest corner above the ground below it.
  groundAltitude() {
    const r = Math.hypot(this.x, this.y), ux = this.x / r, uy = this.y / r;
    const c = Math.cos(this.rot), s = Math.sin(this.rot), B = this.bounds;
    let low = Infinity;
    for (const [lx, ly] of [[B.minX, B.minY], [B.maxX, B.minY], [B.minX, B.maxY], [B.maxX, B.maxY]]) {
      const dx = lx - this.com.x, dy = ly - this.com.y;
      low = Math.min(low, (c * dx - s * dy) * ux + (s * dx + c * dy) * uy);
    }
    return r + low - surfaceRadius(this.body, Math.atan2(this.y, this.x));
  }

  hasFuelFor(p) {
    if (p.def.solid) return p.fuel > 0.01;
    const g = this.groups.find((g) => g.engines.includes(p));
    return g && g.tanks.some((t) => t.fuel > 0.01);
  }

  // Thrust and torque produced this step; also burns propellant.
  applyEngines(dt, rho, vA, sim) {
    let F = 0, torque = 0, gimbal = 0, rotorTorque = 0;
    const pressure = clamp(rho / EARTH.rho0, 0, 1);
    let changed = false;
    const fire = (e, f) => {
      F += f;
      torque += (e.x - this.com.x) * f;
      gimbal += f * Math.sin(e.def.gimbal) * Math.abs(this.com.y - (e.y - e.def.h / 2));
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
          const k = airThrust(e.def.air, rho, vA);
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
    return { F, torque, gimbal, rotorTorque };
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

  // Direction the autopilot wants the nose to point (world angle), or null to just hold.
  sasHeading(sim) {
    switch (this.sas) {
      case 'prograde': case 'retrograde': {
        if (this.speed() < 0.5) return null;
        const a = Math.atan2(this.vy, this.vx);
        return this.sas === 'prograde' ? a : a + Math.PI;
      }
      case 'radialOut': return Math.atan2(this.y, this.x);
      case 'radialIn': return Math.atan2(this.y, this.x) + Math.PI;
      case 'target': {
        const t = sim && sim.target;
        if (!t) return null;
        const tp = bodyPos(t, sim.time), bp = bodyPos(this.body, sim.time);
        return Math.atan2(tp.y - bp.y - this.y, tp.x - bp.x - this.x);
      }
      default: return null;
    }
  }

  // Angular velocity the craft should turn at (pilot, rover levelling or autopilot); null leaves it free.
  turnTarget(sim, engF) {
    const driving = this.input !== 0 && this.wheelsDown && this.canDrive;
    if (this.input !== 0) this.holdRot = null;
    if (this.input !== 0 && !driving) return -this.input * 1.1;
    // rovers and cars level themselves to the ground while driving or bouncing over bumps
    const rover = this.wheels.length && !this.aircraft && this.kind !== 'plane' && this.sas === 'hold'
      && (this.wheelsDown || (engF === 0 && this.groundAltitude() < 40));
    if (rover) {
      const n = surfaceNormal(this.body, Math.atan2(this.y, this.x));
      return clamp(wrapAngle(Math.atan2(n.y, n.x) - Math.PI / 2 - this.rot) * 2.5, -1.2, 1.2);
    }
    if (this.sas === 'off') return null;
    const head = this.sasHeading(sim);
    if (head != null) return clamp(wrapAngle(head - Math.PI / 2 - this.rot) * 2.2, -1.1, 1.1);
    if (this.chuteOpen) return null;
    // aircraft hold the attitude they had when the pilot let go: their own stability would otherwise
    // keep turning them towards the airflow
    if (this.aircraft && this.sas === 'hold') {
      const vert = Math.atan2(this.y, this.x) - Math.PI / 2; // measured from the local horizon
      if (this.holdRot == null) this.holdRot = wrapAngle(this.rot - vert);
      return clamp(wrapAngle(this.holdRot + vert - this.rot) * 1.5, -0.6, 0.6);
    }
    return 0;
  }

  physicsStep(dt, sim) {
    const b = this.body;
    const r = Math.hypot(this.x, this.y);
    const alt = r - b.radius;
    if (b.star && alt < b.radius * 0.35) { sim.breakParts(this, [...this.parts], 'heat'); return; }
    const rho = airDensity(b, alt);
    const m0 = this.mass;
    let ax = -b.mu * this.x / (r * r * r);
    let ay = -b.mu * this.y / (r * r * r);

    const fx = -Math.sin(this.rot), fy = Math.cos(this.rot);
    const eng = this.applyEngines(dt, rho, this.vx * fx + this.vy * fy, sim);
    this.spinRotors(dt);
    ax += fx * eng.F / this.mass;
    ay += fy * eng.F / this.mass;
    let torque = eng.torque;

    // Control: reaction wheels, gimbals and rotors steer towards a target angular velocity. Control
    // surfaces get a command too; the wings below turn it into lift this same step.
    let tMax = eng.gimbal + eng.rotorTorque;
    for (const p of this.parts) if (p.def.torque) tMax += p.def.torque;
    if (this.wheelsDown) tMax *= 0.5;
    let need = null;
    if (!this.isDebris) {
      const wTarget = this.turnTarget(sim, eng.F);
      if (wTarget != null) need = (wTarget - this.w) * this.inertia / Math.max(dt, 1e-3) * 0.35;
    }
    this.ctrlCmd = need == null || this.surfAuth <= 0 ? 0 : clamp(need / Math.max(1, this.surfAuth + tMax), -1, 1);
    if (need != null && tMax > 0) torque += clamp(need, -tMax, tMax);

    // Aerodynamics
    const v = Math.hypot(this.vx, this.vy);
    this.chuteOpen = false;
    this.q = 0.5 * rho * v * v;
    this.airspeed = rho > 0 ? v : 0;
    this.lift = 0;
    this.aoa = null;
    let auth = 0;
    if (rho > 0 && v > 0.01) {
      const vxh = this.vx / v, vyh = this.vy / v;
      const along = fx * vxh + fy * vyh; // 1 = nose first
      const cross = fx * vyh - fy * vxh; // sin of the angle from the nose to the velocity
      const side = Math.abs(along);
      const L = this.bounds.maxY - this.bounds.minY;
      let cd, area;
      if (this.kind === 'rocket') { // tuned for ascents and reentries; keep as is
        cd = along > 0.85 ? (this.noseAero ? 0.32 : 0.62) : along < -0.85 ? 0.75 : 1.0;
        area = this.width * (this.width * side + L * (1 - side)) * 0.8;
      } else {
        cd = along > 0.85 ? (this.noseAero ? 0.3 : 0.55) : along < -0.85 ? 0.7 : this.kind === 'car' ? 0.5 : 0.9;
        area = this.areaFront * side + this.areaSide * (1 - side);
      }
      let cdA = cd * area;
      const aboveGround = alt - terrainHeight(b, Math.atan2(this.y, this.x));
      for (const p of this.parts) {
        if (!p.def.chute || p.deployed <= 0 || p.used) continue;
        // drogue first; the main canopy opens fully close to the ground
        const cap = aboveGround < 1500 ? 1 : 0.3;
        if (p.deployed < cap) p.deployed = Math.min(cap, p.deployed + dt * (p.deployed < 0.3 ? 0.5 : 0.35));
        const k = p.deployed;
        const ca = (18 + 520 * k * k) * (p.def.chuteArea || 1);
        cdA += ca;
        const lever = p.y + 3 - this.com.y;
        const pull = this.q * ca;
        torque += -(cross + (along > 0.9 ? 0.3 : 0)) * pull * lever * 0.08;
        torque -= this.w * this.inertia * 1.5;
        this.chuteOpen = true;
        if (this.q > 25000 && k > 0.5) { p.used = true; sim.toast('Parachute torn off: too fast'); }
      }
      const drag = this.q * cdA;
      ax -= vxh * drag / this.mass;
      ay -= vyh * drag / this.mass;
      // stability: the body weathervanes gently, fins below the centre of mass strongly
      let finStab = 0;
      for (const f of this.fins) finStab += f.def.w * f.def.h * 0.8 * (this.com.y - f.y);
      torque += cross * this.q * (area * 0.04 * Math.min(L, 6) * (along > 0 ? 1 : -1) + finStab);

      // Wings: lift and drag at each wing's quarter-chord point, from the air flowing past that point
      if (this.wings.length) {
        const c = Math.cos(this.rot), s = Math.sin(this.rot), upx = this.x / r, upy = this.y / r;
        for (const p of this.wings) {
          const wd = p.def.wing, lx = p.x - this.com.x, ly = p.y + p.def.h / 4 - this.com.y;
          const rx = c * lx - s * ly, ry = s * lx + c * ly;
          const pvx = this.vx - this.w * ry, pvy = this.vy + this.w * rx;
          const ux = c * pvx + s * pvy, uy = -s * pvx + c * pvy; // in part space; +y is forward
          const V = Math.hypot(ux, uy);
          p.deflect = 0;
          if (V < 0.5) continue;
          const qS = 0.5 * rho * V * V * wd.area;
          let Fx, Fy;
          if (uy > 0) {
            // a surface ahead of the centre of mass deflects the other way to give the same turn
            if (wd.control) { p.deflect = this.ctrlCmd * wd.control * (ly >= 0 ? 1 : -1); auth += qS * 5.5 * wd.control * Math.abs(ly); }
            const a = Math.atan2(ux, uy), ae = a + p.deflect, cl = liftCoef(ae), x = Math.abs(ae);
            const cdw = 0.02 + 0.06 * cl * cl + 1.2 * Math.sin(x) ** 2 * smoothstep(0.28, 0.5, x);
            Fx = qS * (-cl * uy - cdw * ux) / V; // lift along (-uy, ux)/V, drag against the flow
            Fy = qS * (cl * ux - cdw * uy) / V;
            if (p === this.mainWing) this.aoa = a;
          } else { // air flowing backwards over the wing: a flat plate
            const sn = ux / V;
            Fx = -qS * (1.2 * sn * Math.abs(sn) + 0.02 * sn); Fy = -qS * 0.02 * uy / V;
          }
          const wx = c * Fx - s * Fy, wy = s * Fx + c * Fy;
          ax += wx / this.mass; ay += wy / this.mass;
          torque += rx * wy - ry * wx;
          this.lift += wx * upx + wy * upy;
        }
      }
    } else for (const p of this.wings) p.deflect = 0;
    this.surfAuth = auth;
    if (this.updateHeat(dt, rho, v, sim)) return;

    this.vx += ax * dt; this.vy += ay * dt;
    this.w += (torque / this.inertia) * dt;
    this.w = clamp(this.w, -6, 6);
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.rot = wrapAngle(this.rot + this.w * dt);

    this.thrust = eng.F;
    this.accel = eng.F / m0;
    this.gForce = Math.hypot(ax + b.mu * this.x / (r * r * r), ay + b.mu * this.y / (r * r * r)) / G0;
    this.ground(dt, sim);
  }

  // Reentry heating: the leading face takes the heat; everything cools by radiation.
  updateHeat(dt, rho, v, sim) {
    const flux = rho > 0 ? rho * v * v * v : 0;
    let front = -Infinity, lvx = 0, lvy = 0;
    if (flux > 2e6) {
      const c = Math.cos(-this.rot), s = Math.sin(-this.rot);
      lvx = (c * this.vx - s * this.vy) / v; lvy = (s * this.vx + c * this.vy) / v;
      for (const p of this.parts) {
        p._lead = p.x * lvx + p.y * lvy + Math.abs((p.def.w / 2) * lvx) + Math.abs((p.def.h / 2) * lvy);
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

  // Ground and water contact with impulses at every part corner (wheels use their rim).
  ground(dt, sim) {
    const b = this.body;
    const r = Math.hypot(this.x, this.y);
    const reach = Math.hypot(this.bounds.maxX - this.bounds.minX, this.bounds.maxY - this.bounds.minY) + 2;
    const ang0 = Math.atan2(this.y, this.x);
    const clear = () => { this.landed = false; this.splashed = false; this.wheelsDown = false; this.contactTime = 0; };
    if (r - reach > b.radius + b.terrainMax + 5) return clear();
    if (r - reach > surfaceRadius(b, ang0) + 2 + reach * 0.1) return clear();

    const contacts = [];
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    for (const p of this.parts) {
      if (p.def.wheel) {
        const g = wheelGeom(p), rad = g.r;
        const dx = g.x - this.com.x, dy = g.y - this.com.y;
        const rx = c * dx - s * dy, ry = s * dx + c * dy;
        const wx = this.x + rx, wy = this.y + ry;
        const ang = Math.atan2(wy, wx);
        const pen = surfaceRadius(b, ang) - (Math.hypot(wx, wy) - rad);
        if (pen > 0) {
          const n = surfaceNormal(b, ang);
          contacts.push({ p, rx: rx - n.x * rad, ry: ry - n.y * rad, pen, n, wheel: true, water: waterAt(b, ang) });
        }
        continue;
      }
      const R = partRect(p);
      for (const [lx, ly] of [[R.l, R.b], [R.r, R.b], [R.l, R.t], [R.r, R.t]]) {
        const dx = lx - this.com.x, dy = ly - this.com.y;
        const rx = c * dx - s * dy, ry = s * dx + c * dy;
        const wx = this.x + rx, wy = this.y + ry;
        const ang = Math.atan2(wy, wx);
        const pen = surfaceRadius(b, ang) - Math.hypot(wx, wy);
        if (pen > 0) contacts.push({ p, rx, ry, pen, n: surfaceNormal(b, ang), water: waterAt(b, ang) });
      }
    }
    if (!contacts.length) return clear();

    // crash check
    const broken = new Set();
    for (const k of contacts) {
      const vpx = this.vx - this.w * k.ry, vpy = this.vy + this.w * k.rx;
      const vn = vpx * k.n.x + vpy * k.n.y;
      const lim = (k.p.def.breakSpeed || DEFAULT_BREAK_SPEED) * (k.water ? 1.8 : 1);
      if (-vn > lim) broken.add(k.p);
    }
    if (broken.size) { sim.breakParts(this, [...broken], 'impact'); return; }

    const wheelContacts = contacts.filter((k) => k.wheel);
    const driveContacts = wheelContacts.filter((k) => k.p.def.wheel.drive);
    this.wheelsDown = wheelContacts.length > 0;
    // aircraft roll freely: their rotate controls pitch instead of driving
    this.canDrive = !this.aircraft && driveContacts.length > 0;
    const driving = this.canDrive && this.input !== 0;
    const braking = this.brake && this.wheelsDown;
    const invM = 1 / this.mass, invI = 1 / this.inertia;
    for (let iter = 0; iter < 4; iter++) {
      for (const k of contacts) {
        const { rx, ry, n } = k;
        const vpx = this.vx - this.w * ry, vpy = this.vy + this.w * rx;
        const vn = vpx * n.x + vpy * n.y;
        if (vn >= 0) continue;
        const rn = rx * n.y - ry * n.x;
        const jn = -vn / (invM + rn * rn * invI);
        this.vx += jn * n.x * invM; this.vy += jn * n.y * invM; this.w += rn * jn * invI;
        const tx = -n.y, ty = n.x;
        const vpx2 = this.vx - this.w * ry, vpy2 = this.vy + this.w * rx;
        const vt = vpx2 * tx + vpy2 * ty;
        const rt = rx * ty - ry * tx;
        const mu = !k.wheel ? (k.water ? 0.15 : 0.9) : braking ? 0.8
          : this.canDrive ? (driving || Math.abs(this.wheelSpeed || 0) > 0.5 ? 0.04 : 0.9) : 0.025;
        const jt = clamp(-vt / (invM + rt * rt * invI), -mu * jn, mu * jn);
        this.vx += jt * tx * invM; this.vy += jt * ty * invM; this.w += rt * jt * invI;
      }
    }
    let maxPen = 0, nx = 0, ny = 0;
    for (const k of contacts) if (k.pen > maxPen) { maxPen = k.pen; nx = k.n.x; ny = k.n.y; }
    if (maxPen > 0) { this.x += nx * maxPen * 0.9; this.y += ny * maxPen * 0.9; }

    // driven wheels: a simple speed controller along the ground (the brake works through friction above)
    if (this.wheelsDown) {
      const n = wheelContacts[0].n;
      const ex = n.y, ey = -n.x; // "east" along the surface (screen right)
      const vt = this.vx * ex + this.vy * ey;
      if (this.canDrive && !braking) {
        let top = Infinity, acc = 0;
        for (const k of driveContacts) { top = Math.min(top, k.p.def.wheel.speed || 12); acc = Math.max(acc, k.p.def.wheel.accel || 2.5); }
        const grip = driveContacts.length / Math.max(1, this.wheels.length);
        // drive towards the commanded speed; with no input, slow down gently instead of locking the wheels
        const accel = driving ? clamp((this.input * top - vt) * 1.5, -acc, acc) * grip : clamp(-vt * 1.2, -2, 2) * grip;
        this.vx += ex * accel * dt; this.vy += ey * accel * dt;
      }
      this.wheelSpeed = vt;
      if (!braking) for (const w of this.wheels) w.spin = ((w.spin || 0) - (vt / wheelGeom(w).r) * dt) % TAU;
    }
    this.splashed = contacts.some((k) => k.water);
    if (this.splashed) { const k = Math.exp(-0.6 * dt); this.vx *= k; this.vy *= k; this.w *= k; }

    this.contactTime += dt;
    const sp = Math.hypot(this.vx, this.vy);
    this.landed = this.contactTime > 0.2 && sp < 1.5;
    if (this.landed && !driving && sp < 0.15 && Math.abs(this.w) < 0.05 && this.thrust < this.mass * 0.2) {
      this.restTime += dt;
      if (this.restTime > 0.5) { this.vx = 0; this.vy = 0; this.w *= 0.5; }
    } else this.restTime = 0;
  }

  // Rest on the surface of `body` at angle `ang`, turned by `rot` from upright there.
  placeOnSurface(body, ang, rot) {
    this.body = body;
    this.rot = wrapAngle(rot + ang - Math.PI / 2);
    const c = Math.cos(this.rot), s = Math.sin(this.rot), ux = Math.cos(ang), uy = Math.sin(ang);
    let low = Infinity;
    const reach = (lx, ly, rad) => {
      const dx = lx - this.com.x, dy = ly - this.com.y;
      low = Math.min(low, (c * dx - s * dy) * ux + (s * dx + c * dy) * uy - rad);
    };
    for (const p of this.parts) {
      if (p.def.wheel) { const g = wheelGeom(p); reach(g.x, g.y, g.r); continue; }
      const R = partRect(p);
      reach(R.l, R.b, 0); reach(R.r, R.b, 0); reach(R.l, R.t, 0); reach(R.r, R.t, 0);
    }
    const r = surfaceRadius(body, ang) - low + 0.02;
    this.x = ux * r; this.y = uy * r;
    this.vx = 0; this.vy = 0; this.w = 0;
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
      const c = Math.cos(this.rot), s = Math.sin(this.rot);
      const dx = v.com.x - this.com.x, dy = v.com.y - this.com.y;
      const rx = c * dx - s * dy, ry = s * dx + c * dy;
      v.x = this.x + rx; v.y = this.y + ry;
      v.vx = this.vx - this.w * ry; v.vy = this.vy + this.w * rx;
      v.rot = this.rot; v.w = this.w;
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
      body: this.body.id, x: this.x, y: this.y, vx: this.vx, vy: this.vy, rot: this.rot, w: this.w,
      throttle: this.throttle, sas: this.sas, isDebris: this.isDebris, name: this.name, kind: this.kind,
      stages: this.stages, stageIdx: this.stageIdx, landed: this.landed,
      parts: this.parts.map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, flip: p.flip, fuel: p.fuel, active: p.active,
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
    Object.assign(v, { x: d.x, y: d.y, vx: d.vx, vy: d.vy, rot: d.rot, w: d.w, throttle: d.throttle, sas: d.sas || 'hold',
      isDebris: d.isDebris, name: d.name || 'Vessel', stages: d.stages || [], stageIdx: d.stageIdx || 0, landed: !!d.landed, kind: d.kind || 'rocket' });
    v.rebuildGroups();
    // rebuildGroups shifts position for the COM; restore the saved values
    Object.assign(v, { x: d.x, y: d.y });
    return v;
  }
}
