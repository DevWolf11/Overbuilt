'use strict';
// A vessel is a rigid assembly of parts flying around one body (patched conics).

const DEFAULT_BREAK_SPEED = 9;
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
  groundAltitude() {
    const r = Math.hypot(this.x, this.y);
    return r - surfaceRadius(this.body, Math.atan2(this.y, this.x)) - (this.com.y - this.bounds.minY);
  }

  hasFuelFor(p) {
    if (p.def.solid) return p.fuel > 0.01;
    const g = this.groups.find((g) => g.engines.includes(p));
    return g && g.tanks.some((t) => t.fuel > 0.01);
  }

  // Thrust and torque produced this step; also burns propellant.
  applyEngines(dt, rho) {
    let F = 0, torque = 0, gimbal = 0;
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
        const f = e.def.thrust * 1000 * this.throttle;
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
        e.firing = (f * scale) / (e.def.thrust * 1000);
      }
      changed = true;
    }
    if (changed) this.recompute(false);
    return { F, torque, gimbal };
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

  physicsStep(dt, sim) {
    const b = this.body;
    const r = Math.hypot(this.x, this.y);
    const alt = r - b.radius;
    if (b.star && alt < b.radius * 0.35) { sim.breakParts(this, [...this.parts], 'heat'); return; }
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
    this.chuteOpen = false;
    this.q = 0.5 * rho * v * v;
    if (rho > 0 && v > 0.01) {
      const vxh = this.vx / v, vyh = this.vy / v;
      const along = fx * vxh + fy * vyh; // 1 = nose first
      const cross = fx * vyh - fy * vxh; // sin of the angle from the nose to the velocity
      const cd = along > 0.85 ? (this.noseAero ? 0.32 : 0.62) : along < -0.85 ? 0.75 : 1.0;
      const side = Math.abs(along);
      const L = this.bounds.maxY - this.bounds.minY;
      const area = this.width * (this.width * side + L * (1 - side)) * 0.8;
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
    }
    if (this.updateHeat(dt, rho, v, sim)) return;

    // Control: reaction wheels + gimbal steer towards a target angular velocity.
    let wheel = 0;
    for (const p of this.parts) if (p.def.torque) wheel += p.def.torque;
    let tMax = wheel + eng.gimbal;
    if (this.wheelsDown) tMax *= 0.5;
    if (tMax > 0 && !this.isDebris) {
      let wTarget = null;
      const driving = this.wheelsDown && this.input !== 0;
      // rovers level themselves to the ground while driving or bouncing over bumps
      const rover = this.wheels.length && this.sas === 'hold' && (this.wheelsDown || (eng.F === 0 && this.groundAltitude() < 40));
      if (this.input !== 0 && !driving) wTarget = -this.input * 1.1;
      else if (rover) {
        const n = surfaceNormal(b, Math.atan2(this.y, this.x));
        wTarget = clamp(wrapAngle(Math.atan2(n.y, n.x) - Math.PI / 2 - this.rot) * 2.5, -1.2, 1.2);
      } else if (this.sas !== 'off') {
        const head = this.sasHeading(sim);
        if (head != null) wTarget = clamp(wrapAngle(head - Math.PI / 2 - this.rot) * 2.2, -1.1, 1.1);
        else if (!this.chuteOpen) wTarget = 0;
      }
      if (wTarget != null) {
        const need = (wTarget - this.w) * this.inertia / Math.max(dt, 1e-3) * 0.35;
        torque += clamp(need, -tMax, tMax);
      }
    }

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
        const rad = Math.min(p.def.w, p.def.h) * 0.45;
        const dx = p.x - this.com.x, dy = p.y - p.def.h * 0.05 - this.com.y;
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
    this.wheelsDown = wheelContacts.length > 0;
    const driving = this.wheelsDown && this.input !== 0;
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
        const mu = k.wheel ? (driving || Math.abs(this.wheelSpeed || 0) > 0.5 ? 0.04 : 0.9) : k.water ? 0.15 : 0.9;
        const jt = clamp(-vt / (invM + rt * rt * invI), -mu * jn, mu * jn);
        this.vx += jt * tx * invM; this.vy += jt * ty * invM; this.w += rt * jt * invI;
      }
    }
    let maxPen = 0, nx = 0, ny = 0;
    for (const k of contacts) if (k.pen > maxPen) { maxPen = k.pen; nx = k.n.x; ny = k.n.y; }
    if (maxPen > 0) { this.x += nx * maxPen * 0.9; this.y += ny * maxPen * 0.9; }

    // rover drive: a simple speed controller along the ground
    if (this.wheelsDown) {
      const n = wheelContacts[0].n;
      const ex = n.y, ey = -n.x; // "east" along the surface (screen right)
      const vt = this.vx * ex + this.vy * ey;
      const grip = wheelContacts.length / Math.max(1, this.wheels.length);
      // drive towards the commanded speed; with no input, brake gently instead of locking the wheels
      const accel = driving ? clamp((this.input * 12 - vt) * 1.5, -2.5, 2.5) * grip : clamp(-vt * 1.2, -2, 2) * grip;
      this.vx += ex * accel * dt; this.vy += ey * accel * dt;
      this.wheelSpeed = vt;
      for (const w of this.wheels) w.spin = (w.spin || 0) - (vt / (Math.min(w.def.w, w.def.h) * 0.45)) * dt;
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
      throttle: this.throttle, sas: this.sas, isDebris: this.isDebris, name: this.name,
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
      isDebris: d.isDebris, name: d.name || 'Vessel', stages: d.stages || [], stageIdx: d.stageIdx || 0, landed: !!d.landed });
    v.rebuildGroups();
    // rebuildGroups shifts position for the COM; restore the saved values
    Object.assign(v, { x: d.x, y: d.y });
    return v;
  }
}
