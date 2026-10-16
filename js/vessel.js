'use strict';
// A vessel is a rigid assembly of parts flying around one body (patched conics).

const DEFAULT_BREAK_SPEED = 9;

class Vessel {
  constructor(parts, adj, body) {
    this.parts = parts;
    this.adj = adj;
    this.body = body;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.rot = 0; this.w = 0;
    this.throttle = 1;
    this.input = 0; // -1..1, positive = turn right (clockwise)
    this.landed = false;
    this.contactTime = 0;
    this.restTime = 0;
    this.isDebris = false;
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
    // drag shape: is there an aerodynamic part on top?
    let top = null;
    for (const p of this.parts) if (!top || partRect(p).t > partRect(top).t) top = p;
    this.noseAero = !!(top && (top.def.aero || top.def.chute));
    this.recompute(false);
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

  // Thrust currently available from engine p (0 if dry).
  engineThrust(p, group) {
    if (!p.active || p.flameout) return 0;
    return p.def.thrust * 1000 * this.throttle;
  }

  hasFuelFor(p) {
    const g = this.groups.find((g) => g.engines.includes(p));
    return g && g.tanks.some((t) => t.fuel > 0.01);
  }

  // Total thrust and torque produced this step; also burns fuel.
  applyEngines(dt, rho) {
    let F = 0, torque = 0, gimbal = 0;
    const p0 = this.body.rho0 || 1;
    const pressure = clamp(rho / p0, 0, 1);
    let changed = false;
    for (const g of this.groups) {
      let fuel = 0;
      for (const t of g.tanks) fuel += t.fuel;
      let demand = 0;
      const firing = [];
      for (const e of g.engines) {
        if (!e.active) continue;
        if (fuel <= 0.01) { if (!e.flameout) { e.flameout = true; changed = true; } continue; }
        e.flameout = false;
        const f = e.def.thrust * 1000 * this.throttle;
        if (f <= 0) continue;
        const isp = lerp(e.def.ispVac, e.def.ispSL, pressure);
        demand += (f / (isp * G0)) * dt;
        firing.push([e, f]);
      }
      if (!firing.length) continue;
      let scale = 1;
      if (demand > fuel) scale = fuel / demand;
      for (const t of g.tanks) t.fuel = Math.max(0, t.fuel - demand * scale * (t.fuel / fuel));
      for (const [e, f] of firing) {
        const ff = f * scale;
        F += ff;
        torque += (e.x - this.com.x) * ff;
        gimbal += ff * Math.sin(e.def.gimbal) * Math.abs(this.com.y - (e.y - e.def.h / 2));
        e.firing = ff / (e.def.thrust * 1000);
      }
      changed = true;
    }
    for (const g of this.groups) for (const e of g.engines) if (!e.active || e.flameout) e.firing = 0;
    if (changed) this.recompute(false);
    return { F, torque, gimbal };
  }

  physicsStep(dt, sim) {
    const b = this.body;
    const r = Math.hypot(this.x, this.y);
    const alt = r - b.radius;
    const rho = airDensity(b, alt);
    const m0 = this.mass;
    let ax = -b.mu * this.x / (r * r * r);
    let ay = -b.mu * this.y / (r * r * r);

    const eng = this.applyEngines(dt, rho);
    const fx = -Math.sin(this.rot), fy = Math.cos(this.rot);
    ax += fx * eng.F / this.mass;
    ay += fy * eng.F / this.mass;
    let torque = eng.torque;

    // Aerodynamics
    const v = Math.hypot(this.vx, this.vy);
    this.heat = 0;
    this.chuteOpen = false;
    if (rho > 0 && v > 0.01) {
      const vxh = this.vx / v, vyh = this.vy / v;
      const along = fx * vxh + fy * vyh; // 1 = nose first
      let cd = along > 0.85 ? (this.noseAero ? 0.32 : 0.62) : along < -0.85 ? 0.75 : 1.0;
      const side = Math.abs(along);
      const L = this.bounds.maxY - this.bounds.minY;
      const area = this.width * (this.width * side + L * (1 - side)) * 0.8;
      let cdA = cd * area;
      let chuteTorque = 0;
      for (const p of this.parts) {
        if (p.def.chute && p.deployed > 0 && !p.used) {
          // drogue first; the main canopy opens fully close to the ground
          const aboveGround = alt - terrainHeight(b, Math.atan2(this.y, this.x));
          const cap = aboveGround < 1500 ? 1 : 0.3;
          p.deployed = p.deployed < cap ? Math.min(cap, p.deployed + dt * (p.deployed < 0.3 ? 0.5 : 0.35)) : p.deployed;
          const k = p.deployed;
          const ca = 18 + 520 * k * k;
          cdA += ca;
          // canopy pulls its attachment point downwind, turning the craft upright
          const lever = (p.y + 3 - this.com.y);
          const pull = 0.5 * rho * v * v * ca;
          const cross = fx * vyh - fy * vxh; // sin of angle from forward to velocity
          chuteTorque += -(cross + (along > 0.9 ? 0.3 : 0)) * pull * lever * 0.08;
          chuteTorque -= this.w * this.inertia * 1.5;
          this.chuteOpen = true;
          if (v > 330 && k > 0.5) { p.used = true; sim.toast('Parachute torn off: too fast'); }
        }
      }
      const drag = 0.5 * rho * v * v * cdA;
      ax -= vxh * drag / this.mass;
      ay -= vyh * drag / this.mass;
      torque += chuteTorque;
      // aerodynamic stability: tail-heavy rockets weathervane slowly
      const cross = fx * vyh - fy * vxh;
      torque += cross * 0.5 * rho * v * v * area * 0.04 * (along > 0 ? 1 : -1) * Math.min(L, 6);
      this.heat = rho * v * v * v;
    }

    // Control: reaction wheels + gimbal steer towards a target angular velocity.
    let wheel = 0;
    for (const p of this.parts) if (p.def.torque) wheel += p.def.torque;
    const tMax = wheel + eng.gimbal;
    if (tMax > 0 && !this.isDebris && (!this.chuteOpen || this.input !== 0)) {
      const wTarget = -this.input * 1.1;
      const need = (wTarget - this.w) * this.inertia / Math.max(dt, 1e-3) * 0.35;
      torque += clamp(need, -tMax, tMax);
    }

    this.vx += ax * dt; this.vy += ay * dt;
    this.w += (torque / this.inertia) * dt;
    this.w = clamp(this.w, -6, 6);
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.rot = wrapAngle(this.rot + this.w * dt);

    this.thrust = eng.F;
    this.accel = eng.F / m0;
    this.ground(dt, sim);
  }

  // Ground contact with impulses at every part corner.
  ground(dt, sim) {
    const b = this.body;
    const r = Math.hypot(this.x, this.y);
    const reach = Math.hypot(this.bounds.maxX - this.bounds.minX, this.bounds.maxY - this.bounds.minY) + 2;
    const ang0 = Math.atan2(this.y, this.x);
    if (r - reach > b.radius + b.terrainMax + 5) { this.landed = false; this.contactTime = 0; return; }
    if (r - reach > surfaceRadius(b, ang0) + 2 + reach * 0.1) { this.landed = false; this.contactTime = 0; return; }

    const contacts = [];
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    for (const p of this.parts) {
      const R = partRect(p);
      const corners = [[R.l, R.b], [R.r, R.b], [R.l, R.t], [R.r, R.t]];
      for (const [lx, ly] of corners) {
        const dx = lx - this.com.x, dy = ly - this.com.y;
        const rx = c * dx - s * dy, ry = s * dx + c * dy;
        const wx = this.x + rx, wy = this.y + ry;
        const ang = Math.atan2(wy, wx);
        const pen = surfaceRadius(b, ang) - Math.hypot(wx, wy);
        if (pen > 0) contacts.push({ p, rx, ry, pen, n: surfaceNormal(b, ang) });
      }
    }
    if (!contacts.length) { this.landed = false; this.contactTime = 0; return; }

    // crash check
    const broken = new Set();
    for (const k of contacts) {
      const vpx = this.vx - this.w * k.ry, vpy = this.vy + this.w * k.rx;
      const vn = vpx * k.n.x + vpy * k.n.y;
      const lim = k.p.def.breakSpeed || DEFAULT_BREAK_SPEED;
      if (-vn > lim) broken.add(k.p);
    }
    if (broken.size) {
      sim.breakParts(this, [...broken]);
      return;
    }

    const invM = 1 / this.mass, invI = 1 / this.inertia;
    let maxPen = 0, nx = 0, ny = 0;
    for (let iter = 0; iter < 4; iter++) {
      for (const k of contacts) {
        if (broken.has(k.p)) continue;
        const { rx, ry, n } = k;
        const vpx = this.vx - this.w * ry, vpy = this.vy + this.w * rx;
        const vn = vpx * n.x + vpy * n.y;
        if (vn < 0) {
          const rn = rx * n.y - ry * n.x;
          const jn = -vn * 1.0 / (invM + rn * rn * invI);
          this.vx += jn * n.x * invM; this.vy += jn * n.y * invM; this.w += rn * jn * invI;
          const tx = -n.y, ty = n.x;
          const vpx2 = this.vx - this.w * ry, vpy2 = this.vy + this.w * rx;
          const vt = vpx2 * tx + vpy2 * ty;
          const rt = rx * ty - ry * tx;
          let jt = -vt / (invM + rt * rt * invI);
          const mu = 0.9;
          jt = clamp(jt, -mu * jn, mu * jn);
          this.vx += jt * tx * invM; this.vy += jt * ty * invM; this.w += rt * jt * invI;
        }
      }
    }
    for (const k of contacts) if (!broken.has(k.p) && k.pen > maxPen) { maxPen = k.pen; nx = k.n.x; ny = k.n.y; }
    if (maxPen > 0) { this.x += nx * maxPen * 0.9; this.y += ny * maxPen * 0.9; }

    this.contactTime += dt;
    const sp = Math.hypot(this.vx, this.vy);
    this.landed = this.contactTime > 0.2 && sp < 1.5;
    if (this.landed && sp < 0.15 && Math.abs(this.w) < 0.05 && this.thrust < this.mass * 0.2) {
      this.restTime += dt;
      if (this.restTime > 0.5) { this.vx = 0; this.vy = 0; this.w *= 0.5; }
    } else this.restTime = 0;
  }

  // Engines/separators/chutes that respond to a tap.
  activatePart(p, sim) {
    if (!this.byId.has(p.id)) return false;
    if (p.def.thrust) {
      p.active = !p.active;
      if (p.active && !this.hasFuelFor(p)) { sim.toast(`${p.def.name}: no fuel`); p.active = false; }
      return true;
    }
    if (p.def.separator) { sim.fireSeparator(this, p); return true; }
    if (p.def.chute) return sim.deployChute(this, p);
    return false;
  }

  hitTest(lx, ly) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const r = partRect(this.parts[i]);
      const pad = 0.25;
      if (lx >= r.l - pad && lx <= r.r + pad && ly >= r.b - pad && ly <= r.t + pad) return this.parts[i];
    }
    return null;
  }

  totalFuel() { let f = 0; for (const p of this.parts) f += p.fuel; return f; }

  stageFuel() {
    // fuel available to active engines
    let fuel = 0, cap = 0;
    for (const g of this.groups) {
      if (!g.engines.some((e) => e.active)) continue;
      for (const t of g.tanks) { fuel += t.fuel; cap += t.def.fuel * 1000; }
    }
    return { fuel, cap };
  }

  // Split off every part not connected to the control part (or the largest piece).
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
    const out = [];
    for (const pp of pieces) {
      const adj = new Map();
      for (const p of pp) adj.set(p.id, new Set([...this.adj.get(p.id)].filter((id) => pp.some((q) => q.id === id))));
      const v = new Vessel(pp, adj, this.body);
      // place it where those parts were
      const oldCom = this.com;
      const c = Math.cos(this.rot), s = Math.sin(this.rot);
      const dx = v.com.x - oldCom.x, dy = v.com.y - oldCom.y;
      const rx = c * dx - s * dy, ry = s * dx + c * dy;
      v.x = this.x + rx; v.y = this.y + ry;
      v.vx = this.vx - this.w * ry; v.vy = this.vy + this.w * rx;
      v.rot = this.rot; v.w = this.w;
      v.throttle = this.throttle;
      v.isDebris = !v.control;
      v.rebuildGroups();
      out.push(v);
    }
    for (const id of [...this.adj.keys()]) if (!this.parts.some((p) => p.id === id)) this.adj.delete(id);
    for (const set of this.adj.values()) for (const id of [...set]) if (!this.adj.has(id)) set.delete(id);
    this.rebuildGroups();
    return out;
  }
}
