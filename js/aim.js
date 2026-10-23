'use strict';
// Aiming for ground vehicles (the ground update): turret groups (the parts that turn with a ring), their poses,
// traverse and depression limits, the aim step, the ballistic solve, firing tank guns, autocannons and aimed
// launchers, radars and locks, ATGM and SAM guidance, smoke, and line of sight between vehicles.

// Turret groups. A turret ring (def.ring, standing upright: rot 0) turns everything above its top that is joined to it
// (and whatever hangs on those, by att) about its own vertical axis through the centre of its top, c: the ring's yaw
// ψ (its p.aimYaw) turns part +x toward +z, Ry(ψ): (x, y, z) -> (x cosψ - z sinψ, y, x sinψ + z cosψ). A ring on top of
// another's group turns with it too (a cupola on a turret: two levels, deeper rings stay fixed). Physics keeps the
// build pose for mass, inertia and the hull; hits, blasts, aim and the 3D model pose the parts.
// An aimed part (def.aim: guns, launchers, a tracking dish) keeps its own yaw and elevation (p.aimYaw, p.aimEl) as the
// old turrets do: unturned, its barrel points along g = (-sin el, cos el cos yaw, cos el sin yaw), turned by its rot
// (rot 3 on a ground vehicle: along +x, the base down), and it pivots on its trunnion, pivot·h up from its breech.

// a part-space point o turned by angle a about group g's axis (in place)
function aimTurn(g, o, a) {
  const c = g.c, cs = Math.cos(a), sn = Math.sin(a), x = o.x - c.x, z = o.z - c.z;
  o.x = c.x + x * cs - z * sn; o.z = c.z + x * sn + z * cs;
}
// back to the build pose: the outer group's turn undone first
function aimUnturn(g, o) { if (g.parent) aimUnturn(g.parent, o); aimTurn(g, o, -(g.ring.aimYaw || 0)); }
// partPt's turn without the allocation: a point relative to the unturned part's centre, in part space (z: its depth)
function aimPt(p, lx, ly, o) {
  switch (p.rot & 3) {
    case 1: o.x = p.x - ly; o.y = p.y + lx; break;
    case 2: o.x = p.x - lx; o.y = p.y - ly; break;
    case 3: o.x = p.x + ly; o.y = p.y - lx; break;
    default: o.x = p.x + lx; o.y = p.y + ly;
  }
  o.z = partZ(p);
  return o;
}
// a part-space point -> the sim (relative to the body's centre), as Vessel.toWorld (in place)
function aimSim(v, o) {
  const c = v.com;
  qrot(v.q, o.x - c.x, o.y - c.y, o.z - (c.z || 0), o);
  o.x += v.x; o.y += v.y; o.z += v.z;
  return o;
}

const Aim = {
  _d: v3(), // (a temporary)

  // ---- turret groups and poses (Phase 1; pure, out parameters, no allocation)
  // The turret groups of a design or a craft, outer first: { ring, c (its top's centre), ids, members, mass (t), rate
  // (rad/s: slower when the turret outweighs the ring's rating), stab, parent (the group it rides on), jam ([member id,
  // other id]: a member also joined to something that doesn't turn, so it can't), yawLim, dep (the sweep's limits) }.
  // The same answer from the same rows: the builder, a craft, a ghost and the renderer agree.
  groupsOfParts(parts, adj) {
    const byId = new Map(parts.map((p) => [p.id, p])), out = [];
    const rings = parts.filter((p) => p.def.ring && !(p.rot & 3)).sort((a, b) => partRect(a).t - partRect(b).t); // (lower first: a ring's parent before it)
    for (const R of rings) {
      const top = partRect(R).t, above = (q) => q !== R && partRect(q).b >= top - 0.05, ids = new Set(), stack = [R];
      while (stack.length) for (const id of adj.get(stack.pop().id) || []) { const q = byId.get(id); if (q && !ids.has(id) && above(q)) { ids.add(id); stack.push(q); } }
      for (const q of attachedTo(parts, parts.filter((q) => ids.has(q.id)))) ids.add(q.id); // (a breech below the ring's top, a bustle bin)
      ids.delete(R.id);
      // the innermost group so far that turns this ring: its parent (and a ring two deep doesn't turn)
      let parent = null;
      for (const g of out) if (g.ids.has(R.id) && (!parent || g.parent)) parent = g;
      if (parent && parent.parent) continue;
      const members = parts.filter((q) => ids.has(q.id));
      let jam = null, mass = 0;
      for (const q of members) {
        mass += partKg(q) / 1000;
        if (!jam) for (const id of adj.get(q.id) || []) if (id !== R.id && !ids.has(id) && byId.has(id)) { jam = [q.id, id]; break; }
      }
      const ring = R.def.ring;
      out.push({ ring: R, c: { x: R.x, y: top, z: partZ(R) }, ids, members, mass, rate: ((ring.rate || 0) * Math.PI / 180) * clamp(Math.sqrt((ring.cap || 0) / Math.max(mass, 1e-6)), 0.35, 1),
        stab: ring.stab || 0, parent, jam, yawLim: null, dep: null });
    }
    return out.sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
  },
  // A craft's (rebuildGroups, ground-update craft only): v.tg its groups, v.tgOf each turning part's innermost group,
  // v.aimed its aimed parts, v.bodyBox the part-space box of what doesn't turn ({minX, maxX, minY, maxY, minZ, maxZ}).
  groups(v) {
    const tg = this.groupsOfParts(v.parts, v.adj), of = new Map();
    for (const g of tg) for (const id of g.ids) of.set(id, g); // (outer first: the innermost wins)
    v.tg = tg; v.tgOf = of;
    v.aimed = v.parts.filter((p) => p.def.aim);
    let B = null;
    for (const p of v.parts) {
      if (of.has(p.id)) continue;
      for (const [l, r, b, t, n, f] of partBoxes(p)) { // (an old twin pair on board: both sides)
        if (!B) B = { minX: l, maxX: r, minY: b, maxY: t, minZ: n, maxZ: f };
        else { B.minX = Math.min(B.minX, l); B.maxX = Math.max(B.maxX, r); B.minY = Math.min(B.minY, b); B.maxY = Math.max(B.maxY, t); B.minZ = Math.min(B.minZ, n); B.maxZ = Math.max(B.maxZ, f); }
      }
    }
    v.bodyBox = B;
    v.crewCache = null;
  },
  // A part-space point P of part p, at the build pose -> where it is now, with the rings it rides on turned (and back).
  // Not a gun's own elevation: dir, muzzle and trunnion add that.
  pose(v, p, P, out) {
    out.x = P.x; out.y = P.y; out.z = P.z;
    for (let g = v.tgOf && v.tgOf.get(p.id); g; g = g.parent) aimTurn(g, out, g.ring.aimYaw || 0);
    return out;
  },
  unpose(v, p, P, out) {
    out.x = P.x; out.y = P.y; out.z = P.z;
    const g = v.tgOf && v.tgOf.get(p.id);
    if (g) aimUnturn(g, out);
    return out;
  },
  // An aimed part's barrel direction in part space, posed (a ring's own yaw is its group's, not a barrel's)
  localDir(v, p, out) {
    const el = p.def.ring ? 0 : p.aimEl || 0, yw = p.def.ring ? 0 : p.aimYaw || 0, ce = Math.cos(el);
    let gx = -Math.sin(el), gy = ce * Math.cos(yw);
    for (let i = 0, k = p.rot & 3; i < k; i++) { const t = gx; gx = -gy; gy = t; }
    out.x = gx; out.y = gy; out.z = ce * Math.sin(yw);
    for (let g = v.tgOf && v.tgOf.get(p.id); g; g = g.parent) {
      const a = g.ring.aimYaw || 0, cs = Math.cos(a), sn = Math.sin(a), x = out.x;
      out.x = x * cs - out.z * sn; out.z = x * sn + out.z * cs;
    }
    return out;
  },
  // ...and in the sim's axes
  dir(v, p, out) { this.localDir(v, p, out); return qrot(v.q, out.x, out.y, out.z, out); },
  // the trunnion (the barrel's pivot), posed, in part space (a part without def.aim pivots on its middle)
  localTrunnion(v, p, out) {
    const h = p.def.h, a = p.def.aim, pv = a && a.pivot != null ? a.pivot : 0.5;
    aimPt(p, 0, -h / 2 + pv * h, out);
    return this.pose(v, p, out, out);
  },
  // the trunnion and the barrel's tip (T + g·(h - pivot·h)) where they are now, in the sim (relative to the body's centre)
  trunnion(v, p, out) { return aimSim(v, this.localTrunnion(v, p, out)); },
  muzzle(v, p, out) {
    const h = p.def.h, a = p.def.aim, pv = a && a.pivot != null ? a.pivot : 0.5, g = this.localDir(v, p, this._d);
    this.localTrunnion(v, p, out);
    const k = h - pv * h;
    out.x += g.x * k; out.y += g.y * k; out.z += g.z * k;
    return aimSim(v, out);
  },
  // Where the gunner's sight sits: on the primary gun's turret roof, 0.35 m above its trunnion and 0.3 m toward +z,
  // turning with its turret (the primary: the biggest calibre aimed weapon, else the first aimed part; none: above
  // the middle of the craft's top), in the sim.
  sightPoint(v, out) {
    let best = null;
    for (const p of v.aimed) { const c = (p.def.weapon && p.def.weapon.cal) || 0; if (!best || c > ((best.def.weapon && best.def.weapon.cal) || 0)) best = p; }
    if (!best) { out.x = v.com.x; out.y = v.bounds.maxY + 0.35; out.z = v.com.z || 0; return aimSim(v, out); }
    const h = best.def.h, a = best.def.aim, pv = a.pivot != null ? a.pivot : 0.5;
    aimPt(best, 0, -h / 2 + pv * h, out);
    out.y += 0.35; out.z += 0.3;
    return aimSim(v, this.pose(v, best, out, out));
  },

  // ---- limits, aim step, ballistics, firing (Phase 2C)
  sweep(parts, group) { return { yawLim: null, dep: null }; },
  limits(v) {},
  stepAll(F, h) {},
  step(v, h, F, want) {},
  solve(shellKey, D, dH, body) { return null; },
  rangeTable(def, body) { return null; },
  fire(v, sys, h, F) { return false; },
  netFire(g, p, h, F, foe) {},
  aimDir(v, out) { return out; },
  status(v) { return null; },

  // ---- radars, locks, guidance (Phase 2C)
  radarStep(v, F, dt) {},
  lockPid() { return 0; },
  radarSees(L, t, tp, s) { return false; },
  guideSaclos(s, h, spd) {},
  guideTop(s, h, spd) {},
  guideClos(s, h, spd) {},

  // ---- smoke and sight lines (Phase 2C)
  smoke(v, F) {},
  smokeStep(h) {},
  netSmoke(g, m) {},
  smokeBlocks(a, b) { return false; },
  sees(a, b, opts) { return true; },
  summary(parts) { return null; },
};
