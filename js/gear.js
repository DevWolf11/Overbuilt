'use strict';
// Running gear for ground vehicles (the ground update): tracks and armoured wheels, their suspension, traction
// and skid steering, wading, righting, and collisions between vehicles. Vessel.ground hands a vessel with running
// gear (v.gear, set by rebuildGroups) to Gear.ground as its first line; every other vessel keeps vessel.js's own
// contact code, so old designs never reach this file.

const Gear = {
  calls: 0, // terrain calls made by the last Gear.ground (a test counter)

  // ---- contact points (Phase 1)
  // A track's n contact points along its belt (its road wheels), or an armoured wheel's one at its centre, pushed onto
  // the vessel's wheel points (computeHull) so placing on the ground, reach and wheelbase count them. r takes in the
  // suspension's sag at rest (0.4 of its travel), so a vehicle standing still shows its belt on the ground. side: +1
  // right of the centre of mass across (+z), -1 left (cz: its depth).
  points(p, wheels, cz = 0) {
    const d = p.def, z = partZ(p), side = Math.sign(z - cz);
    if (d.awheel) {
      const c = partPt(p, 0, 0);
      wheels.push({ p, x: c.x, y: c.y, z, r: d.awheel.r + 0.4 * (d.awheel.travel || 0), gear: 1, side, i: 0 });
      return;
    }
    const t = d.track, n = Math.max(1, t.n | 0), r = t.r + 0.4 * (t.travel || 0);
    for (let i = 0; i < n; i++) {
      const c = partPt(p, n > 1 ? (i / (n - 1) - 0.5) * 0.8 * d.w : 0, -d.h / 2 + t.r);
      wheels.push({ p, x: c.x, y: c.y, z, r, gear: 1, side, i });
    }
  },

  // ---- contacts, suspension, drive (Phase 2A)
  // Phase 1 stand-in, so a tank can be placed, stepped and driven a little: vessel.js's rigid contact arithmetic on
  // the hull corners and the gear points (rigid, no suspension), each side's belt driven toward its own speed (skid
  // steering), old Car Wheels rolling free. Phase 2A replaces it with §4.
  ground(v, dt, sim) {
    const b = v.body, R = b.radius, r = v.radius();
    const clear = () => { v.landed = false; v.splashed = false; v.wheelsDown = false; v.contactTime = 0; };
    if (r - v.reach > R + b.terrainMax + 5) return clear();
    const L0 = v.surfaceSpot(), dk = Terrain.deckAt(b, L0.a, L0.z, v.reach + 2);
    const h0 = Math.max(Terrain.surfaceAt(b, L0.a, L0.z), dk === dk ? dk : -Infinity), lim0 = R + h0 + 2 + v.reach * 0.3;
    if (r - v.reach > lim0) return clear();
    const contacts = [], loc = {}, cz = v.com.z || 0;
    const probe = (k, rad, wheel) => {
      const o = qrot(v.q, k.x - v.com.x, k.y - v.com.y, k.z - cz);
      const px = v.x + o.x, py = v.y + o.y, pz = v.z + o.z, pr = Math.hypot(px, py, pz);
      if (pr - rad > lim0) return;
      Terrain.locate(b, px, py, pz, loc);
      const pen = R + Terrain.surfaceAt(b, loc.a, loc.z) - (pr - rad);
      if (pen <= 0) return;
      const n = Terrain.normalAt(b, loc.a, loc.z);
      if (rad) { o.x -= n.x * rad; o.y -= n.y * rad; o.z -= n.z * rad; }
      contacts.push({ p: k.p, k, r: o, pen, n, wheel, gear: !!k.gear, water: Terrain.waterAt(b, loc.a, loc.z) });
    };
    for (const k of v.hull) probe(k, 0, false);
    for (const k of v.wheelPts) if (!(k.retract && v.gearUp)) probe(k, k.r, true);
    if (!contacts.length) return clear();

    // crash check, as vessel.js's
    const broken = new Set(), dents = new Map(), vp = v3(), combat = typeof Combat !== 'undefined';
    for (const k of contacts) {
      v.pointVel(k.r, vp);
      const lim = (k.p.def.breakSpeed || DEFAULT_BREAK_SPEED) * (k.water ? 1.8 : 1), s = -dot3(vp, k.n);
      if (s > lim * (combat ? 1.6 : 1)) broken.add(k.p);
      else if (combat && s > lim * 0.75) dents.set(k.p, Math.max(dents.get(k.p) || 0, s / lim));
    }
    if (broken.size && !Silly.on('bouncy')) { sim.breakParts(v, [...broken], 'impact'); return; }
    if (dents.size && sim.vessels && !Silly.on('bouncy')) for (const [p, ratio] of dents) Combat.impact(v, p, ratio, sim);
    if (v.dead || !v.parts.length) return;

    const gearC = contacts.filter((k) => k.gear), D = v.drive, ctl = v.ctl;
    v.wheelsDown = contacts.some((k) => k.wheel);
    const engine = v.parts.some((p) => p.def.engine && !p.broken);
    v.canDrive = gearC.length > 0 && engine && Armour.has(v, 'driver');
    const fwdW = qrot(v.q, D.F.x, D.F.y, D.F.z), aw = qrot(v.q, D.R.x, D.R.y, D.R.z);
    let vmax = Infinity, zl = Infinity, zh = -Infinity;
    for (const k of gearC) { const g = k.p.def.track || k.p.def.awheel; vmax = Math.min(vmax, g.vmax || 12); zl = Math.min(zl, k.k.z); zh = Math.max(zh, k.k.z); }
    const Bw = Math.max(1, zh - zl), go = v.canDrive && !v.brake && (ctl.v !== 0 || ctl.h !== 0);
    const base = !go ? 0 : ctl.v >= 0 ? ctl.v * vmax : ctl.v * vmax * 0.4, w = go ? ctl.h * 0.6 * (base < -0.1 ? -1 : 1) : 0;
    v.steer = 0;
    for (const k of contacts) {
      if (!k.wheel) continue;
      k.t1 = norm3(cross3(k.n, aw)); k.t2 = cross3(k.n, k.t1); // (t1: forward along the ground)
      k.mu1 = k.gear ? 0.9 : v.brake ? 0.8 : 0.025; k.mu2 = k.water ? 0.15 : 0.8; // (old Car Wheels roll free)
      k.vs = k.gear ? base - k.k.side * w * Bw / 2 : 0;
    }
    const invM = 1 / v.mass, ir = v3(), t = v3(), rn = v3();
    const impulse = (k, dir, j) => {
      v.vx += dir.x * j * invM; v.vy += dir.y * j * invM; v.vz += dir.z * j * invM;
      cross3(k.r, dir, rn); v.invIWorld(rn, ir);
      v.av.x += ir.x * j; v.av.y += ir.y * j; v.av.z += ir.z * j;
    };
    const effMass = (k, dir) => { cross3(k.r, dir, rn); v.invIWorld(rn, ir); cross3(ir, k.r, t); return invM + dot3(t, dir); };
    for (let iter = 0; iter < 4; iter++) {
      for (const k of contacts) {
        const n = k.n;
        v.pointVel(k.r, vp);
        const vn = dot3(vp, n);
        if (vn >= 0) continue;
        const jn = -vn / effMass(k, n);
        impulse(k, n, jn);
        v.pointVel(k.r, vp);
        if (k.t1) {
          let vt = dot3(vp, k.t1);
          impulse(k, k.t1, clamp((k.vs - vt) / effMass(k, k.t1), -k.mu1 * jn, k.mu1 * jn));
          v.pointVel(k.r, vp);
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
    if (pn) { v.x += pn.x * maxPen * 0.9; v.y += pn.y * maxPen * 0.9; v.z += pn.z * maxPen * 0.9; }
    v.wheelSpeed = v.vx * fwdW.x + v.vy * fwdW.y + v.vz * fwdW.z;
    v.splashed = contacts.some((k) => k.water);
    v.onFloats = false;
    if (v.splashed) { const k = Math.exp(-0.6 * dt); v.vx *= k; v.vy *= k; v.vz *= k; v.av.x *= k; v.av.y *= k; v.av.z *= k; }
    v.contactTime += dt;
    const sp = v.speed();
    v.landed = v.contactTime > 0.2 && sp < 1.5;
    if (v.landed && !go && sp < 0.15 && len3(v.av) < 0.05 && v.thrust < v.mass * 0.2) {
      v.restTime += dt;
      if (v.restTime > 0.5) { v.vx = 0; v.vy = 0; v.vz = 0; v.av.x *= 0.5; v.av.y *= 0.5; v.av.z *= 0.5; }
    } else v.restTime = 0;
    this.bump(v, sim);
  },
  bump(v, sim) {},

  // ---- builder stats (Phase 2A; pure)
  stats(parts) { return null; },
};
