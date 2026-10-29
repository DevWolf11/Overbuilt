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
// (rot 3 on a ground vehicle: along +x, the base down), and it pivots on its trunnion, pivot·h up from its breech, in
// its own yaw as in elevation (a pintle, a ball mount: the 3D yaw node and the hit prism turn there too).

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

// ---- the aim step's helpers (Phase 2C). It runs every physics substep, so they work in place on these temporaries.
const AIM_RAD = Math.PI / 180;
const aimQ = { w: 1, x: 0, y: 0, z: 0 }, aimA = v3(), aimB = v3(), aimT = v3(), aimW = v3(), aimS = v3(), aimL = v3(), aimM = v3(), aimD = v3(), aimLoc = {};
// a sim vector into part space (a direction; a point once com is added), in place
function aimToPart(v, o) { const q = v.q; aimQ.w = q.w; aimQ.x = -q.x; aimQ.y = -q.y; aimQ.z = -q.z; return qrot(aimQ, o.x, o.y, o.z, o); }
function aimRotY(o, a) { const cs = Math.cos(a), sn = Math.sin(a), x = o.x; o.x = x * cs - o.z * sn; o.z = x * sn + o.z * cs; return o; }
// a part-space direction turned back through the rings a part rides on (outer first), or out through them
function aimDirBack(g, o) { if (g.parent) aimDirBack(g.parent, o); return aimRotY(o, -(g.ring.aimYaw || 0)); }
function aimDirOut(g, o) { for (; g; g = g.parent) aimRotY(o, g.ring.aimYaw || 0); return o; }
// into an unturned part's own frame (its barrel along +y, up along -x): its rot undone (the old turrets' loop)
function aimUnrot(p, o) { for (let i = 0, k = p.rot & 3; i < k; i++) { const t = o.x; o.x = o.y; o.y = -t; } return o; }
// where a missile's or a radar's target is and how it moves (Combat.refPos's sums, into out): null once it is gone
function aimPos(t, o) {
  if (!t) return null;
  if (t.flare) { if (!(t.t < t.life)) return null; o.x = t.x; o.y = t.y; o.z = t.z; o.vx = t.vx; o.vy = t.vy; o.vz = t.vz; return o; }
  if (t.def) { // a range target: its middle
    if (!t.alive || !t.pos) return null;
    const P = t.pos, u = 1 / (Math.hypot(P.x, P.y, P.z) || 1), k = t.def.h / 2;
    o.x = P.x * (1 + k * u); o.y = P.y * (1 + k * u); o.z = P.z * (1 + k * u);
    o.vx = t.vel ? t.vel.x : 0; o.vy = t.vel ? t.vel.y : 0; o.vz = t.vel ? t.vel.z : 0;
    return o;
  }
  if (t.dead || !t.parts || !t.parts.length) return null;
  o.x = t.x; o.y = t.y; o.z = t.z; o.vx = t.vx; o.vy = t.vy; o.vz = t.vz;
  return o;
}
const aimTp = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, aimTq = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
// the shell a gun has loaded (its SHELLS entry), and its key
const aimKey = (p) => { const sh = p.def.weapon && p.def.weapon.shells; return sh ? (p.shellSel && sh.includes(p.shellSel) ? p.shellSel : sh[0]) : null; };
const aimShell = (p) => { const k = aimKey(p); return k && typeof SHELLS !== 'undefined' && hasOwn(SHELLS, k) ? SHELLS[k] : null; };
// The drop of a shell (SHELLS entry) R m along a line climbing at th, in m across it, and its time there. Drag slows it
// as v0·e^(-kρs) (Armour.moveShell's k·ρ·v²), so the time is (e^a - 1)/(kρv) and the drop g cos th (e^2a - 1 - 2a)/(4(kρv)²),
// a = kρR, with the speed gravity takes off it climbing (g sin th over half the way) off v. Into aimOut.
const aimOut = { drop: 0, t: 0 };
function aimDrop(SH, R, th, rho, g) {
  const kr = Math.max(SH.k * rho, 1e-12), a = kr * R, e1 = Math.expm1(a);
  const ve = Math.max(60, SH.v0 - 0.5 * g * Math.sin(th) * (e1 / (kr * SH.v0)));
  aimOut.t = e1 / (kr * ve);
  aimOut.drop = (g * Math.cos(th) * (Math.expm1(2 * a) - 2 * a)) / (4 * kr * kr * ve * ve);
  return aimOut;
}
// A gun's unit line o (R m to its point, climbing at sin s, cos c, with up u) lifted in the vertical plane for its loaded
// shell's drop at the range (Arcade: the one measured; Realistic: a main gun's at the sight's zero)
function aimLift(p, w, R, s, c, ux, uy, uz, rho, gr, real, zero, o) {
  const SH = aimShell(p);
  if (!SH) return o;
  const Rz = real && w.kind === 'tgun' ? zero : R, d = aimDrop(SH, Rz, Math.asin(s), rho, gr), dl = Math.atan2(d.drop, Rz), cd = Math.cos(dl), sd = Math.sin(dl);
  const lx = o.x, ly = o.y, lz = o.z;
  o.x = lx * cd + ((ux - lx * s) / c) * sd; o.y = ly * cd + ((uy - ly * s) / c) * sd; o.z = lz * cd + ((uz - lz * s) / c) * sd;
  return o;
}
// a shell's time over D m (straight out, no lift)
const aimTof = (SH, D, rho) => { const kr = Math.max(SH.k * rho, 1e-12); return Math.expm1(kr * D) / (kr * SH.v0); };
// sector (0..11, 30° each, 0 dead ahead) of a yaw
const aimSector = (a) => (((Math.round(a / (30 * AIM_RAD)) % 12) + 12) % 12);
// whose side a craft is on: a computer's shots are an enemy's, unless it fights with us (ai.ally)
const aimFoe = (v) => !!v.ai && !v.ai.ally;

// ---- the sweep (pure): how far a turret turns before it meets something, and how far each gun dips in each direction
// A part's shape at the build pose: its boxes [l, r, b, t, near, far], with its outline's polygon (part space, counter-
// clockwise, as the hit prism) or, round, its radius (a lathe: upright about its centre)
function aimShape(p) {
  const d = p.def, S = { p, boxes: partBoxes(p), poly: null, rad: 0 };
  if (d.outline) { S.poly = []; const o = v3(); for (const [fx, fy] of d.outline) { aimPt(p, fx * d.w, fy * d.h, o); S.poly.push(o.x, o.y); } }
  else if ((d.round || d.shape === 'tcast' || d.shape === 'tring') && !(p.rot & 1)) S.rad = d.w / 2;
  return S;
}
// is (x, y, z) within r of the shape
function aimInside(S, x, y, z, r) {
  for (const B of S.boxes) {
    if (x < B[0] - r || x > B[1] + r || y < B[2] - r || y > B[3] + r || z < B[4] - r || z > B[5] + r) continue;
    if (S.rad) { if (Math.hypot(x - S.p.x, z - (B[4] + B[5]) / 2) <= S.rad + r) return true; continue; }
    const P = S.poly;
    if (!P) return true;
    let ok = true;
    for (let i = 0, n = P.length; i < n && ok; i += 2) {
      const x0 = P[i], y0 = P[i + 1], ex = P[(i + 2) % n] - x0, ey = P[(i + 3) % n] - y0;
      if (ex * (y - y0) - ey * (x - x0) < -r * Math.hypot(ex, ey)) ok = false;
    }
    if (ok) return true;
  }
  return false;
}
// a part's footprints across the ring's plane (x, z), with their heights: boxes, or a disc for a round part
function aimFeet(p) {
  const S = aimShape(p);
  return S.boxes.map((B) => ({ cx: S.rad ? p.x : (B[0] + B[1]) / 2, cz: (B[4] + B[5]) / 2, hx: (B[1] - B[0]) / 2, hz: (B[5] - B[4]) / 2, rad: S.rad, b: B[2], t: B[3] }));
}
// do footprint m, turned by (cs, sn) about c, and o overlap (at heights they share; touching doesn't count)
function aimFoot(m, o, c, cs, sn) {
  const ex = 0.01;
  if (m.t <= o.b + ex || o.t <= m.b + ex) return false;
  const x = m.cx - c.x, z = m.cz - c.z, mx = c.x + x * cs - z * sn, mz = c.z + x * sn + z * cs, dx = o.cx - mx, dz = o.cz - mz;
  if (m.rad && o.rad) return Math.hypot(dx, dz) < m.rad + o.rad - ex;
  if (m.rad) return Math.hypot(dx - clamp(dx, -o.hx, o.hx), dz - clamp(dz, -o.hz, o.hz)) < m.rad - ex;
  const lu = dx * cs + dz * sn, lw = -dx * sn + dz * cs; // (o's centre along the turned box's axes)
  if (o.rad) return Math.hypot(lu - clamp(lu, -m.hx, m.hx), lw - clamp(lw, -m.hz, m.hz)) < o.rad - ex;
  const ac = Math.abs(cs), as = Math.abs(sn);
  return Math.abs(dx) < o.hx + m.hx * ac + m.hz * as - ex && Math.abs(dz) < o.hz + m.hx * as + m.hz * ac - ex
    && Math.abs(lu) < m.hx + o.hx * ac + o.hz * as - ex && Math.abs(lw) < m.hz + o.hx * as + o.hz * ac - ex;
}
// How far down (or, over a raised deck, how far up) an aimed part's barrel can go in each of 12 directions without
// meeting anything outside its own turret: a capsule of 10 points (r 0.12 m) along the barrel from its trunnion, each
// point ignoring what it already sits in at the build pose (a mantlet in its turret, a casemate gun in its plate).
// Directions are the ring's turn (own: the part's own traverse: a pintle, a dish, a gun with no turret). Radians.
function aimDep(parts, p, g) {
  const d = p.def, a = d.aim, h = d.h, pv = a.pivot != null ? a.pivot : 0.5, L = h - pv * h, out = new Float32Array(12);
  const el0 = (a.el ? a.el[0] : 0) * AIM_RAD, el1 = (a.el ? a.el[1] : 0) * AIM_RAD;
  const own = !g || (!!a.trav && a.trav[1] - a.trav[0] > 40);
  const arc = a.trav ? [a.trav[0] * AIM_RAD, a.trav[1] * AIM_RAD] : !g && a.casemate ? [-a.casemate[0] * AIM_RAD, a.casemate[0] * AIM_RAD] : [0, 0];
  const obs = parts.filter((q) => q !== p && !q.def.inner && !(g && (q === g.ring || g.ids.has(q.id)))).map(aimShape);
  const T0 = aimPt(p, 0, -h / 2 + pv * h, v3()), P = v3(), N = 10, s = [];
  for (let i = 0; i < N; i++) s.push(L * (0.3 + (0.7 * i) / (N - 1)));
  const at = (psi, yaw, el, k) => {
    const ce = Math.cos(el);
    let gx = -Math.sin(el), gy = ce * Math.cos(yaw);
    for (let i = 0, n = p.rot & 3; i < n; i++) { const t = gx; gx = -gy; gy = t; }
    P.x = T0.x + gx * s[k]; P.y = T0.y + gy * s[k]; P.z = T0.z + ce * Math.sin(yaw) * s[k];
    if (g && psi) aimTurn(g, P, psi);
    return P;
  };
  const home = s.map((_, k) => { const q = at(0, 0, 0, k); return new Set(obs.filter((S) => aimInside(S, q.x, q.y, q.z, 0.12))); });
  const blocked = (psi, yaw, el) => {
    for (let k = 0; k < N; k++) { const q = at(psi, yaw, el, k); for (const S of obs) if (!home[k].has(S) && aimInside(S, q.x, q.y, q.z, 0.12)) return true; }
    return false;
  };
  for (let i = 0; i < 12; i++) {
    let worst = -Infinity;
    for (const off of [-15, 0, 15]) {
      const sg = wrapAngle((i * 30 + off) * AIM_RAD), psi = own ? 0 : sg, yaw = own ? clamp(sg, arc[0], arc[1]) : 0;
      let e = clamp(0, el0, el1);
      if (blocked(psi, yaw, e)) { while (e < el1 - 1e-9 && blocked(psi, yaw, e)) e = Math.min(el1, e + AIM_RAD); } // (lifted over a deck)
      else while (e - AIM_RAD >= el0 - 1e-9 && !blocked(psi, yaw, e - AIM_RAD)) e -= AIM_RAD;
      worst = Math.max(worst, e);
    }
    out[i] = worst;
  }
  return { a: out, own };
}
const aimSweeps = new Map(); // (the sweep's results by the layout's signature)

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
      // what the ring stands on, and what joins that below its top: never turned, whichever way the att links run (a
      // turret built first records the ring as hanging on it, and the hull on the ring)
      const base = new Set(), low = (q) => q !== R && !ids.has(q.id) && partRect(q).t <= top + 0.05;
      stack.push(R);
      while (stack.length) for (const id of adj.get(stack.pop().id) || []) { const q = byId.get(id); if (q && !base.has(id) && low(q)) { base.add(id); stack.push(q); } }
      for (const q of attachedTo(parts.filter((q) => q !== R && !base.has(q.id)), parts.filter((q) => ids.has(q.id)))) ids.add(q.id); // (a breech below the ring's top, a bustle bin)
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

  // ---- limits (Phase 2C)
  // One turret group's sweep (pure: the builder's arcs, a craft's limits). yawLim: how far it turns either way from
  // straight ahead (5° steps) before what turns with it (above the ring's top) meets what doesn't (standing above it: a
  // mast, another turret, a raised deck); null all the way round, and one way it may run on past 180°. dep: its main
  // weapon's lowest elevation in each 30° direction (rad, Float32Array(12), [0] dead ahead); deps: each aimed part's in it
  // by id ({ a, own }). Remembered by the layout.
  sweep(parts, group) {
    const R = group.ring, ids = group.ids, c = group.c, top = c.y;
    const key = R.id + '|' + parts.map((p) => `${p.id}:${p.type}@${p.x},${p.y},${partZ(p)},${p.rot & 3}${ids.has(p.id) ? 'm' : ''}`).join(';');
    let res = aimSweeps.get(key);
    if (res) return res;
    const mem = [], obs = [];
    for (const p of parts) {
      if (p === R || p.def.inner) continue;
      const r = partRect(p);
      if (ids.has(p.id)) { if (r.b >= top - 0.05) mem.push(...aimFeet(p)); }
      else if (r.t > top + 0.05) obs.push(...aimFeet(p));
    }
    const clear = (deg) => { const a = deg * AIM_RAD, cs = Math.cos(a), sn = Math.sin(a); for (const m of mem) for (const o of obs) if (aimFoot(m, o, c, cs, sn)) return false; return true; };
    let yawLim = null;
    if (mem.length && obs.length) {
      let hi = 0, lo = 0, bh = !clear(0), bl = bh;
      for (let d = 5; d < 360 && !bh; d += 5) if (clear(d)) hi = d; else bh = true;
      for (let d = 5; d < 360 - hi && bh && !bl; d += 5) if (clear(-d)) lo = -d; else bl = true;
      if (bh) yawLim = [lo * AIM_RAD, hi * AIM_RAD];
    }
    const deps = new Map();
    for (const p of group.members) if (p.def.aim) deps.set(p.id, aimDep(parts, p, group));
    const W = aimPrimary(group, null);
    res = { yawLim, dep: W && deps.has(W.id) ? deps.get(W.id).a : null, deps };
    if (aimSweeps.size >= 40) aimSweeps.delete(aimSweeps.keys().next().value);
    aimSweeps.set(key, res);
    return res;
  },
  // A craft's limits, worked out at its first aim step and again when its parts change: each group's yawLim and dep,
  // and every aimed part's dip by direction (returned: Map id -> { a, own }). Parts lost (shot off, torn away) only take
  // away what was in the way, so the limits it had still hold: they carry over ring by ring, with no new sweep (5-15 ms
  // a vehicle, a hitch mid-fight otherwise).
  limits(v) {
    if (v._dep && v._limTg === v.tg) return v._dep;
    const old = v._dep && v._limTg && v.tg && v.parts.length < (v._limN || 0) ? v._limTg : null;
    if (old && v.tg.every((g) => old.some((o) => o.ring === g.ring))) {
      for (const g of v.tg) { const o = old.find((x) => x.ring === g.ring); g.yawLim = o.yawLim; g.dep = o.dep; }
      v._limTg = v.tg; v._limN = v.parts.length;
      return v._dep;
    }
    const dep = new Map();
    for (const g of v.tg || []) { const s = this.sweep(v.parts, g); g.yawLim = s.yawLim; g.dep = s.dep; for (const [id, d] of s.deps) dep.set(id, d); } // (outer first: a cupola's own wins)
    for (const p of v.aimed) if (!dep.has(p.id)) dep.set(p.id, aimDep(v.parts, p, null));
    v._limTg = v.tg; v._dep = dep; v._limN = v.parts.length;
    return dep;
  },
  // someone aboard to lay the guns: a gunner, or the commander taking over (old craft always have). A design with no
  // gunner at all has whoever rides in it but the driver do it; one whose gunner is dead waits for someone to take his
  // seat (Armour's role swap).
  manned(v) {
    if (v.ko) return false;
    if (Armour.has(v, 'gunner') || Armour.has(v, 'commander')) return true;
    const C = Armour.crewOf(v), crew = (C && C.crew) || [];
    return !crew.some((e) => e.role === 'gunner' || e.base === 'gunner') && crew.some((e) => e.alive && e.role !== 'driver');
  },
  // Realistic aim (the room's lobby setting, else the solo one): guns are lifted for the sight's zero, not the range
  realistic() {
    const M = typeof MP !== 'undefined' && MP.live && MP.state && MP.state.settings;
    return M ? M.aim === 'realistic' : typeof Settings !== 'undefined' && Settings.get('aimMode') === 'realistic';
  },

  // ---- the aim step (Phase 2C), every physics substep (Combat.step)
  // The player's ground vehicle (in aim mode; elsewhere its guns hold their aim, at the build pose on other craft) and
  // every local ground AI's (at its v.aimP): turrets, guns, launchers and dishes slew to the point; then held fire: the
  // chosen automatic gun on the trigger and the machine guns on their own (Space, the MG button; a computer's aimFire and
  // mgFire), and a computer's main gun and launchers on aimFire whenever they are ready (its target: v.aimT).
  stepAll(F, h) {
    const v = F.active;
    if (aimTopQ.length) aimTopStep(4); // (an arena's highest ground, a few points a step)
    if (v && v.aimed.length && !v.remote && v.parts.length && !F.destroyed) {
      this.step(v, h, F, null);
      this.assist(v, h, F);
      this.hold(v, h, F, !!F.firing, !!F.mgFiring);
    }
    if (Combat.S.gai) for (const o of F.vessels) {
      if (o === v || !o.ai || !o.ai.ground || o.dead || o.remote || !o.aimed.length || !o.parts.length) continue;
      this.step(o, h, F, o.aimP || null);
      this.hold(o, h, F, !!o.aimFire, !!o.mgFire);
      const cur = o.aimFire && Combat.systems(o)[o.wsel];
      if (cur && (cur.w.kind === 'tgun' || cur.w.kind === 'missile' || cur.w.kind === 'rocket')) this.fire(o, cur, h, F, o.aimT || null);
    }
  },
  // held fire: each automatic gun at its own rate (the chosen one on trig, the machine guns on mg)
  hold(v, h, F, trig, mg) {
    const cur = trig ? Combat.systems(v)[v.wsel] : null, ok = v._man !== false && !v.ko;
    for (const p of v.aimed) {
      const w = p.def.weapon;
      if (w && w.kind === 'agun') this.burst(v, p, h, F, ok && ((!!cur && cur.key === p.type) || (mg && (w.cal || 0) < 15)));
    }
  },
  // One craft's aim this substep, at want (a point, or { P }: a computer's), else the player's F.aim.P. Rings slew (outer
  // first) to bring their main weapon round to the point, then each aimed part takes its own elevation (and traverse,
  // within its arc) toward it: guns lifted for their shell's drop at the range (Realistic: at the sight's zero, F.zero),
  // AA guns at the lead point while the tracking radar holds a lock, a rocket launcher for its range table, a tracking
  // dish at its target. Each axis turns at its own rate (a ring's, slower with a heavy turret, halved when damaged, a hand
  // crank's when broken, none when jammed). Stabilised axes are first held where they pointed in the world a step ago;
  // the others ride the hull and catch up only at their rate, so on the move they bounce off target.
  step(v, h, F, want) {
    if (!v.aimed.length || v.dead) return;
    this.tick(v, h, F);
    const man = (v._man = this.manned(v));
    let P = null;
    if (want) P = want.P || want;
    else if (v === F.active && F.groundAim && F.aim && F.aim.P) P = F.aim.P;
    if (!P || !man || v.remote || !Number.isFinite(P.x)) { v._aimN = 0; v.leadOk = false; return; } // (holding: hull-relative, nothing held in the world)
    const dep = this.limits(v), b = v.body, r = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r;
    const rho = airDensity(b, r - b.radius), gr = b.mu / (r * r), real = !want && this.realistic(), zero = clamp(F.zero || 800, 100, 5000);
    const n = (v._aimN || 0) + 1, cur = Combat.systems(v)[v.wsel];
    // a lock: the guns lead the target (else the lead is only the HUD's marker)
    const lead = this.leadAt(v, cur, rho), Pg = v.trk && v.trk.lock && lead ? lead : P;
    // 1. stabilisers: held where they pointed in the world a step ago, the hull's turn and pitch taken out
    for (const g of v.tg) {
      const R = g.ring;
      if (g.stab < 2 || g.jam || R.broken || R._swN !== n - 1) continue; // (a jammed or hand-cranked ring holds nothing)
      aimS.x = R._sw.x; aimS.y = R._sw.y; aimS.z = R._sw.z; aimToPart(v, aimS);
      if (g.parent) aimDirBack(g.parent, aimS);
      R.aimYaw = aimFit(Math.atan2(aimS.z, aimS.x), R.aimYaw || 0, g.yawLim);
    }
    for (const p of v.aimed) {
      const a = p.def.aim;
      if (!(a.stab >= 1) || p._wdN !== n - 1) continue;
      const g = v.tgOf.get(p.id);
      aimS.x = p._wd.x; aimS.y = p._wd.y; aimS.z = p._wd.z; aimToPart(v, aimS);
      if (g) aimDirBack(g, aimS);
      aimUnrot(p, aimS);
      p.aimEl = clamp(Math.atan2(-aimS.x, Math.hypot(aimS.y, aimS.z)), a.el[0] * AIM_RAD, a.el[1] * AIM_RAD);
      if (a.stab >= 2 && (a.trav || (!g && a.casemate))) p.aimYaw = aimArc(p, g, Math.atan2(aimS.z, aimS.y));
    }
    // 2. the rings: each to its main weapon's point, a gun's lifted for its drop (the lift is in the true vertical, so on
    // a rolled hull it leans across the turret: aimed at the unlifted point, the barrel's rise would carry the round aside)
    aimA.x = Pg.x - v.x; aimA.y = Pg.y - v.y; aimA.z = Pg.z - v.z; aimToPart(v, aimA);
    aimA.x += v.com.x; aimA.y += v.com.y; aimA.z += v.com.z || 0;
    for (const g of v.tg) {
      const R = g.ring, W = aimPrimary(g, cur), A = this.ringAim(g, W), ww = W && W.def.weapon;
      if (!(ww && (ww.kind === 'tgun' || ww.kind === 'agun') && this.liftPt(v, W, Pg, ux, uy, uz, rho, gr, real, zero, aimB))) { aimB.x = aimA.x; aimB.y = aimA.y; aimB.z = aimA.z; }
      if (g.parent) aimUnturn(g.parent, aimB);
      const dx = aimB.x - g.c.x, dz = aimB.z - g.c.z, rr = Math.hypot(dx, dz);
      if (rr < 0.3) continue;
      const wnt = Math.atan2(dz, dx) - A.az - (rr > Math.abs(A.e) + 0.3 ? Math.asin(A.e / rr) : 0), psi = R.aimYaw || 0, goal = aimFit(wnt, psi, g.yawLim);
      R._lim = !!g.yawLim && Math.abs(wrapAngle(goal - wnt)) > 0.01;
      let rate = g.rate;
      if (g.jam) rate = 0; else if (R.broken) rate = 2 * AIM_RAD; else if (Combat.hpFrac(R) < 0.5) rate *= 0.5;
      const m = rate * h, d = g.yawLim ? goal - psi : wrapAngle(goal - psi);
      R.aimYaw = g.yawLim ? psi + clamp(d, -m, m) : wrapAngle(psi + clamp(d, -m, m));
    }
    // 3. each aimed part
    for (const p of v.aimed) this.partStep(v, p, h, F, p.def.weapon && (p.def.weapon.kind === 'tgun' || p.def.weapon.kind === 'agun') ? Pg : P, dep, ux, uy, uz, rho, gr, real, zero);
    // 4. remember where the stabilised axes point in the world
    for (const g of v.tg) {
      if (g.stab < 2) continue;
      const R = g.ring, o = R._sw || (R._sw = v3()), a = R.aimYaw || 0;
      o.x = Math.cos(a); o.y = 0; o.z = Math.sin(a); aimDirOut(g.parent, o); qrot(v.q, o.x, o.y, o.z, o); R._swN = n;
    }
    for (const p of v.aimed) if (p.def.aim.stab >= 1) { this.dir(v, p, p._wd || (p._wd = v3())); p._wdN = n; }
    v._aimN = n;
  },
  // one aimed part's elevation and traverse toward Q (the point already led for an AA gun)
  partStep(v, p, h, F, Q, dep, ux, uy, uz, rho, gr, real, zero) {
    const d = p.def, a = d.aim, w = d.weapon, g = v.tgOf.get(p.id);
    if (d.trackRadar && v.trk) { const t = v.trk.lock || v.trk.cand; if (t && aimPos(t, aimTq)) Q = aimTq; } // (a dish looks at its target)
    const T = this.trunnion(v, p, aimT);
    let lx = Q.x - T.x, ly = Q.y - T.y, lz = Q.z - T.z;
    const R = Math.hypot(lx, ly, lz);
    if (R < 0.5) return;
    lx /= R; ly /= R; lz /= R;
    const s = clamp(lx * ux + ly * uy + lz * uz, -1, 1), c = Math.sqrt(1 - s * s);
    aimW.x = lx; aimW.y = ly; aimW.z = lz;
    if (w && (w.kind === 'tgun' || w.kind === 'agun') && c > 1e-4) aimLift(p, w, R, s, c, ux, uy, uz, rho, gr, real, zero, aimW);
    else if (w && w.kind === 'rocket' && c > 1e-4) { // rocket artillery: elevated for the range, from its table
      const S = this.rocketEl(d, R * c, R * s, v.body);
      if (S) {
        const ce = Math.cos(S.el), se = Math.sin(S.el);
        aimW.x = ((lx - ux * s) / c) * ce + ux * se; aimW.y = ((ly - uy * s) / c) * ce + uy * se; aimW.z = ((lz - uz * s) / c) * ce + uz * se;
        if (v === F.active) { const st = v._strike || (v._strike = {}); st.el = S.el; st.t = S.t; st.d = S.d; st.out = S.out; }
      }
    }
    aimToPart(v, aimW);
    if (g) aimDirBack(g, aimW);
    aimUnrot(p, aimW);
    const yW = Math.atan2(aimW.z, aimW.y), eW = Math.atan2(-aimW.x, Math.hypot(aimW.y, aimW.z));
    // its limits: the elevation range (and how far it can dip this way round), its own arc (a pintle, a dish, a gun with
    // no turret: its casemate arc; on a turret, none: the ring aims it)
    const D = dep.get(p.id), dp = D ? D.a[aimSector(D.own || !g ? p.aimYaw || 0 : g.ring.aimYaw || 0)] : -Infinity;
    const eHi = a.el[1] * AIM_RAD, eLo = Math.min(eHi, Math.max(a.el[0] * AIM_RAD, dp)), eGoal = clamp(eW, eLo, eHi);
    const tr = a.trav, cm = !g && a.casemate, ylo = tr ? tr[0] * AIM_RAD : cm ? -cm[0] * AIM_RAD : 0, yhi = tr ? tr[1] * AIM_RAD : cm ? cm[0] * AIM_RAD : 0;
    const full = yhi - ylo >= TAU - 1e-6, yGoal = full ? yW : clamp(yW, ylo, yhi), yr = ((tr && a.travRate) || (cm && cm[1]) || a.elRate || 10) * AIM_RAD * h;
    const el0 = p.aimEl || 0, yaw0 = p.aimYaw || 0, me = (a.elRate || 10) * AIM_RAD * h;
    p.aimEl = el0 + clamp(eGoal - el0, -me, me);
    p.aimYaw = full ? wrapAngle(yaw0 + clamp(wrapAngle(yGoal - yaw0), -yr, yr)) : yaw0 + clamp(yGoal - yaw0, -yr, yr);
    // how far off it still is, and whether a limit (its own, or its ring's) keeps it off
    p._err = Math.hypot(eW - p.aimEl, (full ? wrapAngle(yW - p.aimYaw) : yW - p.aimYaw) * Math.cos(eW));
    p._lim = eW < eLo - 0.005 || eW > eHi + 0.005 || (yhi - ylo < 1e-6 ? !!(g && g.ring._lim) : !full && (yW < ylo - 0.005 || yW > yhi + 0.005));
  },
  // Where gun p's line from its trunnion to Q, lifted for its drop, passes at Q's range: in v's part space, into o (false
  // when Q is at the muzzle). Its ring turns to it, so the lifted line lies in the plane the barrel rises in.
  liftPt(v, p, Q, ux, uy, uz, rho, gr, real, zero, o) {
    const T = this.trunnion(v, p, aimT);
    let lx = Q.x - T.x, ly = Q.y - T.y, lz = Q.z - T.z;
    const R = Math.hypot(lx, ly, lz);
    if (R < 0.5) return false;
    lx /= R; ly /= R; lz /= R;
    const s = clamp(lx * ux + ly * uy + lz * uz, -1, 1), c = Math.sqrt(1 - s * s);
    o.x = lx; o.y = ly; o.z = lz;
    if (c > 1e-4) aimLift(p, p.def.weapon, R, s, c, ux, uy, uz, rho, gr, real, zero, o);
    o.x = T.x + o.x * R - v.x; o.y = T.y + o.y * R - v.y; o.z = T.z + o.z * R - v.z; aimToPart(v, o);
    o.x += v.com.x; o.y += v.com.y; o.z += v.com.z || 0;
    return true;
  },
  // a ring's main weapon, as the ring sees it: its barrel's azimuth at the build pose, and how far its trunnion sits off
  // the line through the ring's centre that way (so the turret turns its gun, not its middle, onto the point)
  ringAim(g, W) {
    if (g._W === W && g._wa) return g._wa;
    let az = 0, e = 0;
    if (W) {
      let gx = 0, gy = 1;
      for (let i = 0, k = W.rot & 3; i < k; i++) { const t = gx; gx = -gy; gy = t; }
      az = gx < -0.5 ? Math.PI : 0;
      const a = W.def.aim, h = W.def.h, pv = a && a.pivot != null ? a.pivot : 0.5, T0 = aimPt(W, 0, -h / 2 + pv * h, v3());
      e = -(T0.x - g.c.x) * Math.sin(az) + (T0.z - g.c.z) * Math.cos(az);
    }
    g._W = W;
    return (g._wa = { az, e });
  },
  // The lead point (into v.leadP, v.leadOk): where a shell from the lead gun meets the aircraft it is on (the tracking
  // radar's lock, else the nearest within 2 km: radarStep), from their motion and its flight time, worked out twice
  leadAt(v, cur, rho) {
    const t = (v.trk && v.trk.lock) || v.leadT, G = t && aimLeadGun(v, cur), SH = G && aimShell(G);
    v.leadOk = false;
    if (!SH || !aimPos(t, aimTp)) return null;
    const T = this.trunnion(v, G, aimM), L = v.leadP || (v.leadP = v3()), rx = aimTp.vx - v.vx, ry = aimTp.vy - v.vy, rz = aimTp.vz - v.vz;
    let tt = aimTof(SH, Math.hypot(aimTp.x - T.x, aimTp.y - T.y, aimTp.z - T.z), rho);
    for (let i = 0; i < 2; i++) tt = aimTof(SH, Math.hypot(aimTp.x + rx * tt - T.x, aimTp.y + ry * tt - T.y, aimTp.z + rz * tt - T.z), rho);
    L.x = aimTp.x + rx * tt; L.y = aimTp.y + ry * tt; L.z = aimTp.z + rz * tt;
    v.leadOk = true;
    return L;
  },
  // Aim assist (touch by default; Settings aimAssist): with the crosshair within 4° of the lead point, the aim eases onto
  // it at 8°/s (it never takes the aim: move off and it lets go). It moves Flight.aimYaw/aimPitch (the local surface frame).
  assist(v, h, F) {
    const on = typeof Settings !== 'undefined' ? Settings.get('aimAssist') : null;
    if (!(on == null ? typeof isTouch !== 'undefined' && isTouch : on) || !F.groundAim || !v.leadOk || !F.aim || !F.aim.o) return;
    if (!Number.isFinite(F.aimYaw) || !Number.isFinite(F.aimPitch)) return;
    const o = F.aim.o, L = v.leadP, r = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r, el = Math.hypot(ux, uy) || 1;
    const ex = uy / el, ey = -ux / el, nx = ey * uz, ny = -ex * uz, nz = ex * uy - ey * ux; // (east = up × z; north = east × up)
    let dx = L.x - o.x, dy = L.y - o.y, dz = L.z - o.z;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const p1 = Math.asin(clamp(dx * ux + dy * uy + dz * uz, -1, 1)), y1 = Math.atan2(-(dx * nx + dy * ny + dz * nz), dx * ex + dy * ey); // (yaw toward the south)
    const dy0 = wrapAngle(y1 - F.aimYaw), dp0 = p1 - F.aimPitch, off = Math.hypot(dy0 * Math.cos(p1), dp0);
    if (off > 4 * AIM_RAD || off < 1e-5) return;
    const k = Math.min(1, (8 * AIM_RAD * h) / off);
    F.aimYaw = wrapAngle(F.aimYaw + dy0 * k); F.aimPitch += dp0 * k;
  },
  // reloads: a main gun's next round; a launcher's empty tubes filled from its stowed rounds, once it has stood still
  // for its reload time
  tick(v, h, F) {
    let still = -1;
    for (const p of v.aimed) {
      const w = p.def.weapon;
      if (!w) continue;
      if (w.kind === 'tgun') {
        if (p.reload > 0 && (p.reload -= h) <= 0) { p.reload = 0; if (p.shellNext) { p.shellSel = p.shellNext; p.shellNext = null; } }
        continue;
      }
      if (!(w.kind === 'missile' || w.kind === 'rocket') || !w.stow) continue;
      if (p.stow == null) p.stow = w.stow;
      if (!(p.ammo < w.ammo) || !(p.stow > 0) || p.broken) continue;
      if (still < 0) still = Math.hypot(v.vx, v.vy, v.vz) < 1 ? 1 : 0;
      if (!(p.reload > 0)) p.reload = p.reloadT = w.reload || 10;
      if (!still || (p.reload -= h) > 0) continue;
      const k = Math.min(w.ammo - p.ammo, p.stow), each = w.each || 0;
      p.ammo += k; p.stow -= k; p.reload = 0; p.store = p.ammo * each;
      if (each >= 10) v.recompute(false);
      if (v === F.active && !v.ai) F.toast(`${p.def.name} reloaded`);
    }
  },

  // ---- ballistics (Phase 2C): shared by the aim, the HUD, the builder and the AI
  // The elevation (rad above the level) that puts a shell (SHELLS key) on a point D m off along the ground and dH up, its
  // time of flight, its drop below the line of sight and its speed there (body: its gravity and air; alt: the gun's height)
  solve(key, D, dH, body = EARTH, alt = 0) {
    const SH = typeof SHELLS !== 'undefined' && hasOwn(SHELLS, key) ? SHELLS[key] : null;
    if (!SH || !(D >= 0) || !Number.isFinite(dH)) return null;
    const R = Math.hypot(D, dH) || 1e-6, th = Math.atan2(dH, D), r0 = body.radius + alt, rho = airDensity(body, alt + dH / 2), o = aimDrop(SH, R, th, rho, body.mu / (r0 * r0));
    return { el: th + Math.atan2(o.drop, R), t: o.t, drop: o.drop, v: SH.v0 * Math.exp(-SH.k * rho * R) };
  },
  // A rocket launcher's range table (built once per part type and body): a rocket flown as moveShot flies it (its motor
  // along the rail, drag, gravity toward the middle of the planet) from 5° to 55° in 2.5° steps, to the level it left:
  // [{ el, d (m along the ground), t (s), fall (its dive at the end, rad) }]
  rangeTable(def, body = EARTH) {
    const w = def.weapon;
    if (!w || w.kind !== 'rocket') return null;
    let B = aimTables.get(def);
    if (!B) aimTables.set(def, (B = new Map()));
    if (B.has(body)) return B.get(body);
    const out = [], R0 = body.radius + 50, h = 1 / 120, tm = w.coast ?? 0, life = w.life || 9; // (the physics' own step)
    for (let e = 5; e <= 55.01; e += 2.5) {
      const c = Math.cos(e * AIM_RAD), s = Math.sin(e * AIM_RAD);
      let x = 0, y = R0, vx = c * (w.speed || 0), vy = s * (w.speed || 0), t = 0;
      while (t < life) {
        const r0 = Math.hypot(x, y), g = body.mu / (r0 * r0);
        t += h;
        if (t > tm && t < tm + (w.burn || 0)) { vx += c * (w.accel || 0) * h; vy += s * (w.accel || 0) * h; }
        const kd = 0.00006 * airDensity(body, r0 - body.radius) * Math.hypot(vx, vy) * h;
        vx -= vx * kd + (x / r0) * g * h; vy -= vy * kd + (y / r0) * g * h;
        const px = x, py = y;
        x += vx * h; y += vy * h;
        const r1 = Math.hypot(x, y);
        if (r1 < R0 && t > 0.5) {
          const f = (r0 - R0) / Math.max(1e-9, r0 - r1), ix = px + (x - px) * f, iy = py + (y - py) * f;
          out.push({ el: e * AIM_RAD, d: R0 * Math.atan2(ix, iy), t: t - h * (1 - f), fall: Math.asin(clamp(-(vx * ix + vy * iy) / (R0 * (Math.hypot(vx, vy) || 1)), -1, 1)) });
          break;
        }
      }
    }
    B.set(body, out);
    return out;
  },
  // the elevation (rad above the level) for a rocket to come down D m off and dH up: the table's rising half, the height
  // counted against its dive; out: beyond its reach (then its longest)
  rocketEl(def, D, dH, body = EARTH, out = aimRk) {
    const T = this.rangeTable(def, body);
    if (!T || !T.length) return null;
    aimRkAt(T, D, out);
    aimRkAt(T, D + dH / Math.tan(Math.max(out.fall, 0.1)), out);
    out.d = D;
    return out;
  },

  // ---- firing (Phase 2C)
  // Fire system sys (a Combat.systems entry): a main gun's loaded round; a launcher's missile (target: its lock); an
  // automatic gun's or rocket rails' share of this substep h (held: call it every substep). The player is told why not
  // (no gunner, broken, empty); reloading says nothing (the HUD's ring shows it).
  fire(v, sys, h, F, target) {
    if (!sys || v.dead || v.ko || !v.parts.length) return false;
    const w = sys.w, me = v === F.active && !v.ai, now = F.time || 0;
    const say = (t) => { if (me && now - (v._sayAt ?? -9) > 1.2) { v._sayAt = now; F.toast(t); } };
    if (!this.manned(v)) { say('No gunner to fire'); return false; }
    if (w.kind === 'tgun') return this.fireMain(v, sys, F, say);
    if (w.kind === 'agun') { let any = false; for (const p of sys.parts) any = this.burst(v, p, h, F, true) || any; return any; }
    const ok = sys.parts.filter((p) => !p.broken && p.ammo > 0);
    if (!ok.length) {
      if (sys.parts.every((p) => p.broken)) say(`${sys.def.name} broken`);
      else if (!sys.parts.some((p) => p.stow > 0 || (p.stow == null && p.def.weapon.stow))) say(`${sys.def.name}: empty`);
      return false;
    }
    if (w.kind === 'rocket') { // (a ripple, at the rails' rate)
      if ((v._rkT = (v._rkT || 0) - h) > 0) return false;
      let p = Combat.nextStore(sys);
      if (!p || p.broken) p = ok[0];
      Combat.fireRocket(v, p, aimFoe(v), F); v._rkT = 1 / (w.rate || 2);
      return true;
    }
    if (w.kind !== 'missile' || now - (v._mslAt ?? -9) < 0.5) return false;
    v._mslAt = now;
    let p = Combat.nextStore(sys);
    if (!p || p.broken) p = ok[0];
    Combat.launchMissile(v, p, target || null, F);
    return true;
  },
  // A main gun: one round, if one is loaded. The next comes from its ready rack, then out of the stores (Armour.crewOf:
  // built-in ammunition first, then racks, then an autoloader's), after its reload: its own, half as long again with
  // no loader alive, or an autoloader's fixed time for 100 mm guns and up.
  fireMain(v, sys, F, say) {
    let p = null, wait = false, any = false;
    for (const q of sys.parts) {
      if (q.broken) continue;
      any = true;
      if (q.ammo > 0 && !(q.reload > 0)) { p = q; break; }
      if (q.ammo > 0) wait = true;
    }
    if (!p) { if (!any) say(`${sys.def.name} broken`); else if (!wait) say(`${sys.def.name}: empty`); return false; }
    if (!this.shoot(v, p, F)) return false;
    p.ammo--;
    if (p.ammo <= 0 && this.draw(v)) p.ammo = 1;
    p.reload = p.reloadT = p.ammo > 0 ? this.reloadOf(v, p) : 0;
    return true;
  },
  reloadOf(v, p) {
    const w = p.def.weapon, al = (w.cal || 0) >= 100 ? aimAutoload(v) : 0;
    return al || (w.reload || 5) * (Armour.has(v, 'loader') ? 1 : 1.5);
  },
  // one round from the stores for a main gun (false: none left)
  draw(v) {
    const C = Armour.crewOf(v), st = C && C.stores;
    if (!st || !st.length) return false;
    for (let k = 0; k < 3; k++) for (const e of st) {
      if (aimStoreRank(e) !== k || !(e.rounds > 0) || !aimStoreOk(e)) continue;
      e.rounds = e.rounds - 1;
      return true;
    }
    return false;
  },
  // An automatic gun on (held) or off: rounds at its own rate (p.cool carries over between substeps), its barrels
  // turning round one a round; p.gunOn tells the other players' screens to fire it for show
  burst(v, p, h, F, on) {
    const d = p.def, w = d.weapon;
    if (!on || p.broken || !(p.ammo > 0)) { p.cool = Math.max(0, (p.cool || 0) - h); p.gunOn = false; return false; }
    p.gunOn = true;
    p.cool = (p.cool || 0) - h;
    let n = 0;
    while (p.cool <= 0 && p.ammo > 0) {
      p.cool += 1 / (w.rate || 5);
      if (d.barrels) p.spin = ((p.spin || 0) + TAU / d.barrels) % TAU;
      if (!this.shoot(v, p, F)) break;
      p.ammo--; n++;
    }
    if (!(p.ammo > 0)) { p.gunOn = false; p.cool = 0; }
    return n > 0;
  },
  // someone else's automatic gun firing (p.gunOn in their part states): rounds for show, along its aim as we see it
  netFire(g, p, h, F, foe) {
    const w = p.def.weapon;
    p.cool = (p.cool || 0) - h;
    while (p.cool <= 0 && p.ammo > 0) { p.cool += 1 / (w.rate || 5); if (!this.shoot(g, p, F, foe ? 2 : 1)) break; p.ammo--; }
  },
  // One round out of an aimed gun: a shell (Armour.moveShell flies it) along the barrel as it points now (turret lag and
  // all), spread by its dispersion (more on the move, less with a stabiliser). A main gun's kicks the hull, flashes,
  // blasts dust off the ground near it, is heard, and goes to the others. net: someone else's gun (1, or 2 an enemy's), for show.
  shoot(v, p, F, net) {
    const d = p.def, w = d.weapon, a = d.aim, key = aimKey(p), SH = key && typeof SHELLS !== 'undefined' && hasOwn(SHELLS, key) ? SHELLS[key] : null;
    if (!SH) return false;
    const m = this.muzzle(v, p, aimM), u = this.dir(v, p, aimD), main = w.kind === 'tgun', spd = Math.hypot(v.vx, v.vy, v.vz);
    const k = (a.disp || 0) * 1e-3 * (a.stab ? 1 + spd / 20 : 1 + spd / 6);
    if (k > 0) { // anywhere in a disc of that radius round the barrel's line
      let ex = -u.y, ey = u.x, ez = 0;
      if (Math.abs(u.z) > 0.9) { ex = 0; ey = -u.z; ez = u.y; }
      const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
      const fx = u.y * ez - u.z * ey, fy = u.z * ex - u.x * ez, fz = u.x * ey - u.y * ex, rr = k * Math.sqrt(Math.random()), t = Math.random() * TAU, c = rr * Math.cos(t), s = rr * Math.sin(t);
      u.x += ex * c + fx * s; u.y += ey * c + fy * s; u.z += ez * c + fz * s;
      const l = Math.hypot(u.x, u.y, u.z); u.x /= l; u.y /= l; u.z /= l;
    }
    p.shots = (p.shots || 0) + 1;
    const sh = { k: 'shell', sh: key, b: v.body, x: m.x, y: m.y, z: m.z, vx: v.vx + u.x * SH.v0, vy: v.vy + u.y * SH.v0, vz: v.vz + u.z * SH.v0, t: 0, life: SH.life || 6,
      owner: v, enemy: net ? net > 1 : aimFoe(v), net: net ? v.remote || 1 : 0, cal: SH.cal, pen: SH.pen || 0, v0: SH.v0, spare: v,
      tracer: main || p.shots % (SH.tracer || 3) === 0, prox: SH.prox || 0, ric: false, gTop: aimGTop(v.body, m) };
    if (!main) sh.cheap = true;
    Combat.S.shots.push(sh);
    p.shotAt = F.time || 0;
    const A = F.active, far = A ? Math.hypot(m.x - A.x, m.y - A.y, m.z - A.z) : 0, fx = far < 3000 && !(F.warpIdx > 1) && !!A && A.body === v.body;
    if (main) {
      if (!net && !v.kin && !v.remote && v.applyImpulse) { this.localTrunnion(v, p, aimT); aimS.x = -u.x; aimS.y = -u.y; aimS.z = -u.z; v.applyImpulse(aimT, aimS, 0.5 * SH.kg * SH.v0); } // (the recoil)
      if (fx) this.flash(v, m, u, SH.cal);
      if (!net && far < 1500) Sound.cannon(SH.cal, v === A ? 0 : far); // (someone else's: armour.js netShell plays it)
      if (!net && typeof MP !== 'undefined' && !v.remote && !v.ai) MP.sendShot(sh);
    } else if (fx && p.shots % 2 === 0) {
      FX.add({ kind: 'flash', b: v.body, x: m.x, y: m.y, z: m.z, vx: v.vx, vy: v.vy, vz: v.vz, max: 0.05, size: 0.3 + SH.cal / 60, grow: 1.2, color: '#ffd27a', alpha: 1 });
      if (v === A && !net && p.shots % 3 === 0) Sound.gun(SH.cal >= 20);
    }
    return true;
  },
  // A main gun's fire: its flash, the muzzle blast's ring, smoke, and dust off the ground under a low muzzle
  flash(v, m, u, cal) {
    const b = v.body, k = clamp(cal / 60, 0.5, 2), at = { b, x: m.x, y: m.y, z: m.z, vx: v.vx, vy: v.vy, vz: v.vz };
    FX.add({ kind: 'flash', ...at, x: m.x + u.x * 0.6 * k, y: m.y + u.y * 0.6 * k, z: m.z + u.z * 0.6 * k, max: 0.09, size: cal / 50, grow: cal / 18, color: '#ffd27a', alpha: 1 });
    FX.add({ kind: 'ring', ...at, max: 0.35, size: 0.3 * k, grow: 2 * k, color: '#e8dcc0', alpha: 0.5 }); // (the blast: 2-4 m, 4.6 m for a 120 mm)
    for (let i = 0; i < 3; i++) {
      const s = 3 + i * 3;
      FX.add({ kind: 'smoke', ...at, x: m.x + u.x * i, y: m.y + u.y * i, z: m.z + u.z * i, vx: v.vx + u.x * s + (Math.random() - 0.5) * 2, vy: v.vy + u.y * s + (Math.random() - 0.5) * 2,
        vz: v.vz + u.z * s + (Math.random() - 0.5) * 2, max: 1.6 + i * 0.5, size: 0.6 * k, grow: 2.5 * k, color: '#cbc6b8', alpha: 0.45 });
    }
    Terrain.locate(b, m.x, m.y, m.z, aimLoc);
    const up = aimLoc.r - b.radius - Terrain.surfaceAt(b, aimLoc.a, aimLoc.z);
    if (up < 3) {
      const f = 1 - up / aimLoc.r, g = { b, x: m.x * f, y: m.y * f, z: m.z * f, vx: v.vx, vy: v.vy, vz: v.vz };
      FX.add({ kind: 'ring', ...g, max: 0.7, size: 1, grow: 3.5 * k, color: '#a89a80', alpha: 0.45 }); // (dust, about 6 m)
      FX.puff(b, g, { x: v.vx, y: v.vy, z: v.vz }, 2, '#9a8f7c');
    }
  },
  // Shell i (the 1-4 keys, the ammo chips) for the chosen gun, else the main gun: the next round is that one, and asked
  // twice within a second the round in the breech comes out and it loads now. An automatic gun swaps belts at once.
  select(v, i, F) {
    const sys = Combat.systems(v), cur = sys[v.wsel], s = cur && cur.def.aim && cur.w.shells ? cur : sys.find((q) => q.w.kind === 'tgun');
    if (!s || !(i >= 0) || i >= s.w.shells.length) return false;
    const key = s.w.shells[i], now = F.time || 0, again = v._selKey === key && now - (v._selAt ?? -9) < 1;
    v._selKey = key; v._selAt = now;
    for (const p of s.parts) {
      const had = aimKey(p);
      if (s.w.kind !== 'tgun') { p.shellSel = key; continue; }
      if (again && had !== key && p.ammo > 0 && !p.broken) { p.shellSel = key; p.shellNext = null; p.reload = p.reloadT = this.reloadOf(v, p); }
      else p.shellNext = had === key ? null : key;
    }
    return true;
  },
  // where the chosen aimed weapon looks (sim, unit): the crosshair in aim mode, else its barrel (a missile's lock cone)
  aimDir(v, out = this._ad, F = typeof Flight !== 'undefined' ? Flight : null) {
    if (F && F.active === v && F.groundAim && F.aim && F.aim.dir) { out.x = F.aim.dir.x; out.y = F.aim.dir.y; out.z = F.aim.dir.z; return out; }
    const cur = Combat.systems(v)[v.wsel], p = cur && cur.def.aim ? cur.parts[0] : aimMain(v);
    return p ? this.dir(v, p, out) : v.axis(1, 0, 0, out);
  },
  _ad: v3(),
  // What the ground HUD shows of the chosen weapon (else the main gun), in one object per craft, refilled: name; shells
  // [{ key, label, n (its 1-4 key) }], sel (loaded) and queued (-1: none); reload 0..1 (1: loaded); ready; readyN (at the
  // gun) and rounds (aboard); err (rad off the point) and limited (a limit holds it off); the tracking radar's lock (and
  // locking 0..1, lockOn: looking); guiding (a wire-guided missile's seconds to go; guidePast: it has passed the aim
  // point, still on its wire); the search scope (blips { a: bearing
  // off the hull's nose toward +z, d, alt, t: when seen }, sweep, scopeR); lead (the lead point); a rocket strike.
  status(v) {
    if (!v || !v.aimed || !v.aimed.length) return null;
    const sys = Combat.systems(v), cur = sys[v.wsel], S = v._ast || (v._ast = { shells: [] });
    let p = null;
    if (cur && cur.def.aim) { for (const q of cur.parts) if (!q.broken && (!p || (q.ammo > 0 && !(q.reload > 0)))) p = q; p = p || cur.parts[0]; } else p = aimMain(v);
    const d = p.def, w = d.weapon, sh = w && w.shells, key = aimKey(p);
    if (S._p !== p) { S._p = p; S.shells = sh ? sh.map((k, i) => ({ key: k, label: (SHELLS[k] && SHELLS[k].label) || k, n: i + 1 })) : []; }
    S.part = p; S.kind = w ? w.kind : d.trackRadar ? 'radar' : null;
    S.name = !w ? d.name : w.kind === 'tgun' || w.kind === 'agun' ? ((w.cal || 0) < 15 ? 'MG' : `${w.cal} mm`) : w.label || d.name;
    S.sel = sh ? sh.indexOf(key) : -1; S.queued = sh && p.shellNext ? sh.indexOf(p.shellNext) : -1;
    const T = w ? (w.kind === 'tgun' ? p.reloadT : w.reload) : 0;
    S.reload = p.reload > 0 && T ? clamp(1 - p.reload / T, 0, 1) : 1;
    S.ready = !!w && !p.broken && p.ammo > 0 && !(w.kind === 'tgun' && p.reload > 0);
    S.readyN = p.ammo || 0;
    let n = 0;
    for (const q of (cur && cur.def.aim ? cur.parts : [p])) n += (q.ammo || 0) + (q.stow != null ? q.stow : (w && w.stow) || 0) * (w && w.kind !== 'tgun' ? 1 : 0);
    if (w && w.kind === 'tgun') { const C = Armour.crewOf(v); for (const e of (C && C.stores) || []) if (aimStoreOk(e)) n += e.rounds || 0; }
    S.rounds = n;
    S.err = p._err || 0; S.limited = !!p._lim;
    const T0 = v.trk;
    S.lock = (T0 && T0.lock) || null; S.lockOn = !!(T0 && T0.on); S.locking = T0 && !T0.lock && T0.cand ? clamp(T0.lockT / 0.8, 0, 1) : 0;
    S.guiding = this.guiding(v, S);
    S.scope = v.scope ? v.scope.blips : null; S.sweep = v.scope ? v.scope.a : 0; S.scopeR = v.scope ? v.scope.range : 0;
    S.lead = v.leadOk ? v.leadP : null;
    S.strike = w && w.kind === 'rocket' && v._strike ? v._strike : null;
    return S;
  },
  // the newest wire-guided missile of v's still on its wire: its seconds to the aim point (0: none; at least 0.1 while
  // on the wire, and out.guidePast once it has flown past the aim point, where seconds to go mean nothing)
  guiding(v, out) {
    let best = null;
    for (const s of Combat.S.shots) if (s.saclos && s.launcher === v && !s.cut && (!best || s.t < best.t)) best = s;
    if (out) out.guidePast = false;
    if (!best) return 0;
    const F = typeof Flight !== 'undefined' ? Flight : null, d = F && F.active === v && F.aim && F.aim.d ? F.aim.d : v.aimP ? Math.hypot(v.aimP.x - v.x, v.aimP.y - v.y, v.aimP.z - v.z) : 0;
    const t = (d - (best.rm || 0)) / (Math.hypot(best.vx, best.vy, best.vz) || 1);
    if (out) out.guidePast = t <= 0;
    return Math.max(0.1, t);
  },
  // The builder's numbers for the main weapon (pure): its name, best penetration at 1 km (mm: kinetic rounds slowed by
  // the air, shaped charges as they are), reload (s), traverse (°/s: its ring's for the turret's weight; its own arc's
  // with no turret; 0 fixed), elevation [lo, hi] (°), the crew aboard and the rounds (ready and stored)
  summary(parts) {
    let W = null;
    for (const p of parts) if (p.def.aim && p.def.weapon && (!W || aimRank(p) > aimRank(W))) W = p;
    if (!W) return null;
    const w = W.def.weapon, a = W.def.aim, rho = EARTH.rho0 || 1.2;
    let pen = w.heat || 0;
    for (const k of w.shells || []) {
      const S = typeof SHELLS !== 'undefined' && SHELLS[k];
      if (S) pen = Math.max(pen, AIM_KIN[S.type] ? S.pen * Math.pow(Math.exp(-S.k * rho * 1000), 1.43) : S.pen || 0);
    }
    const seated = new Set(), racked = new Set();
    for (const p of parts) { if (p.def.seat && p.att != null) seated.add(p.att); if ((p.def.rack || p.def.autoload) && p.att != null) racked.add(p.att); }
    let crew = 0, rounds = 0, loader = false, auto = 0;
    const al = (t) => { if (t) auto = auto ? Math.min(auto, t) : t; };
    for (const p of parts) {
      const d = p.def;
      if (!d.gv && d.control) { crew++; loader = true; } // (an old cockpit or cab: its crew does every job)
      if (d.mods) for (const m of d.mods) {
        if (m.k === 'crew' && !seated.has(p.id)) { crew++; if (m.role === 'loader' || m.also === 'loader') loader = true; }
        if (m.k === 'ammo' && !racked.has(p.id)) { rounds += m.rounds || 0; al(m.autoload); }
      }
      if (d.seat) { crew++; if (d.seat === 'loader') loader = true; }
      if (d.rack) { rounds += d.rack.rounds || 0; al(d.autoload); }
      if (d.weapon && d.weapon.kind === 'tgun') rounds += d.weapon.ammo || 0;
    }
    const reload = w.kind === 'tgun' ? ((w.cal || 0) >= 100 && auto) || (w.reload || 0) * (loader ? 1 : 1.5) : w.kind === 'agun' ? 1 / (w.rate || 1) : w.reload || 0;
    let g = null;
    for (const q of this.groupsOfParts(parts, buildAdjacency(parts))) if (q.ids.has(W.id)) g = q;
    const trav = g ? (g.jam ? 0 : g.rate / AIM_RAD) : a.trav ? a.travRate || 0 : a.casemate ? a.casemate[1] : 0;
    return { gun: W.def.name, pen1k: Math.round(pen), reload: Math.round(reload * 10) / 10, trav: Math.round(trav * 10) / 10, el: a.el ? [a.el[0], a.el[1]] : [0, 0], crew, rounds };
  },

  // ---- radars and locks (Phase 2C): every frame, for each ground vehicle (Combat.frame)
  // A vehicle's radars and guns that matter here (looked up again when its parts change)
  kit(v) {
    if (v._kit && v._kitN === v.parts.length) return v._kit;
    const k = { search: null, track: null, aa: false };
    for (const p of v.parts) {
      const d = p.def;
      if (d.searchRadar && !k.search) k.search = p;
      if (d.trackRadar && !k.track) k.track = p;
      if (d.aim && d.weapon && d.weapon.kind === 'agun') k.aa = true;
    }
    v._kitN = v.parts.length;
    return (v._kit = k);
  },
  radarStep(v, F, dt) {
    if (v === F.active) this._pidV = v;
    const k = this.kit(v);
    if (k.search) this.searchStep(v, k.search, F, dt);
    if (k.track) this.trackStep(v, k.track, F, dt);
    else if (v.trk) { v.trk.lock = v.trk.cand = null; v.trk.on = false; }
    // the lead marker's aircraft without a lock (AA guns aboard): the nearest within 2 km, looked for 5 times a second
    if (!k.aa || (v.trk && v.trk.lock)) v.leadT = null;
    else if ((v._ldT = (v._ldT || 0) - dt) <= 0) {
      v._ldT = 0.2;
      let best = null, bd = 2000;
      for (const c of Combat.candidates(v, 'air', F)) { const d = Math.hypot(c.x - v.x, c.y - v.y, c.z - v.z); if (d < bd) { bd = d; best = c.ref; } }
      v.leadT = best;
    }
  },
  // The search radar: its antenna sweeps round at rpm, and twice a second the aircraft in its reach, in sight (the ground
  // sampled every 150 m) and not lost in the clutter (below 40 m over the ground, under 40 m/s along the beam) light up
  // as blips where the sweep has passed since; a blip not seen again for a turn fades (at most 10, the nearest).
  searchStep(v, p, F, dt) {
    const sr = p.def.searchRadar, S = v.scope || (v.scope = { a: 0, last: 0, acc: 0, blips: [], range: sr.range }), turn = (TAU * (sr.rpm || 60)) / 60;
    if (p.broken || v.ko) { S.blips.length = 0; return; }
    S.a = (S.a + turn * dt) % TAU; S.acc += dt;
    if (S.acc < 0.5) return;
    const arc = turn * S.acc, from = S.last, now = F.time || 0, O = this.trunnion(v, p, aimL);
    S.last = S.a; S.acc = 0;
    const r = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r, f = v.axis(1, 0, 0, aimS), sd = v.axis(0, 0, 1, aimW);
    for (const c of Combat.candidates(v, 'air', F)) {
      const dx = c.x - O.x, dy = c.y - O.y, dz = c.z - O.z, d = Math.hypot(dx, dy, dz);
      if (d > sr.range || d < 30) continue;
      const fu = dx * ux + dy * uy + dz * uz, brg = Math.atan2(dx * sd.x + dy * sd.y + dz * sd.z - fu * (sd.x * ux + sd.y * uy + sd.z * uz), dx * f.x + dy * f.y + dz * f.z - fu * (f.x * ux + f.y * uy + f.z * uz));
      if (arc < TAU && (((brg - from) % TAU) + TAU) % TAU > arc) continue; // (the sweep hasn't passed it)
      const t = c.ref, tp = aimPos(t, aimTp);
      if (!tp || !aimClear(v.body, O, tp, d) || aimNotch(t, tp, O)) continue;
      let B = S.blips.find((q) => q.ref === t);
      if (!B) S.blips.push((B = { ref: t }));
      B.a = brg; B.d = d; B.alt = Math.hypot(tp.x, tp.y, tp.z) - v.body.radius; B.t = now;
    }
    const keep = TAU / turn + 0.6;
    for (let i = S.blips.length; i--;) if (now - S.blips[i].t > keep) S.blips.splice(i, 1);
    if (S.blips.length > 10) { S.blips.sort((x, y) => x.d - y.d); S.blips.length = 10; }
  },
  // The tracking radar, 10 times a second. Looking (L, LOCK: on), it locks the aircraft nearest the crosshair within its
  // cone and reach, seen clearly (not notching, nothing in the way, no smoke on the line), after 0.8 s on it (twice that
  // against a jammer). The lock holds while it is in reach and sight; 0.5 s behind the ground, 1 s notching, or chaff
  // (Combat.chaffBreaks) breaks it, and it looks again.
  trackStep(v, p, F, dt) {
    const tr = p.def.trackRadar, T = v.trk || (v.trk = { on: false, cand: null, lockT: 0, lock: null, notchT: 0, blockT: 0, acc: 0 });
    if (p.broken || v.ko) { T.lock = T.cand = null; T.lockT = 0; return; }
    if ((T.acc += dt) < 0.1) return;
    const st = T.acc, me = v === F.active && !v.ai, O = this.trunnion(v, p, aimL);
    T.acc = 0;
    if (T.lock) {
      const t = T.lock, tp = aimPos(t, aimTp), d = tp ? Math.hypot(tp.x - O.x, tp.y - O.y, tp.z - O.z) : Infinity;
      if (d <= tr.range) {
        T.blockT = aimClear(v.body, O, tp, d) ? 0 : T.blockT + st;
        T.notchT = aimNotch(t, tp, O) ? T.notchT + st : 0;
        if (T.blockT <= 0.5 && T.notchT <= 1 && !Combat.chaffBreaks(v, t)) return;
      }
      T.lock = T.cand = null; T.lockT = 0;
      if (me) F.toast('Radar lock lost', 'warn');
      return;
    }
    if (!T.on) { T.cand = null; T.lockT = 0; return; }
    const ax = this.lockAxis(v, p, F, O, aimS);
    let best = null, ba = tr.cone || 0.5;
    for (const c of Combat.candidates(v, 'air', F)) {
      const dx = c.x - O.x, dy = c.y - O.y, dz = c.z - O.z, d = Math.hypot(dx, dy, dz);
      if (d > tr.range || d < 100) continue;
      const ang = Math.acos(clamp((dx * ax.x + dy * ax.y + dz * ax.z) / d, -1, 1));
      if (ang >= ba) continue;
      const tp = aimPos(c.ref, aimTp);
      if (!tp || !aimClear(v.body, O, tp, d) || aimNotch(c.ref, tp, O) || this.smokeBlocks(O, tp)) continue;
      ba = ang; best = c.ref;
    }
    if (best && best === T.cand) T.lockT += st; else { T.cand = best; T.lockT = 0; }
    if (best && T.lockT >= 0.8 * (Combat.jams(best) ? 2 : 1)) {
      T.lock = best; T.notchT = T.blockT = 0;
      if (me) Sound.tone(1250, 0.12, 0.06);
    }
  },
  // where a tracking radar looks for a lock (sim, unit): the player's crosshair in aim mode, a computer's aim point,
  // else the dish's own way
  lockAxis(v, p, F, O, out) {
    if (v === F.active && F.groundAim && F.aim && F.aim.dir) { out.x = F.aim.dir.x; out.y = F.aim.dir.y; out.z = F.aim.dir.z; return out; }
    if (v.aimP) { out.x = v.aimP.x - O.x; out.y = v.aimP.y - O.y; out.z = v.aimP.z - O.z; const l = Math.hypot(out.x, out.y, out.z) || 1; out.x /= l; out.y /= l; out.z /= l; return out; }
    return this.dir(v, p, out);
  },
  // L (LOCK): start looking for a lock, or let go of one (true: looking)
  lockKey(v) {
    if (!v || !this.kit(v).track) return false;
    const T = v.trk || (v.trk = { on: false, cand: null, lockT: 0, lock: null, notchT: 0, blockT: 0, acc: 0 });
    if (T.on || T.lock) { T.on = false; T.lock = T.cand = null; T.lockT = 0; } else T.on = true;
    return T.on;
  },
  lockTarget(v) { return (v && v.trk && v.trk.lock) || null; },
  // the player's radar lock on another player (their pid, for Combat.frame's lock line: it lights their warner), else 0
  lockPid() {
    const v = this._pidV, t = v && !v.dead && v.trk && v.trk.lock;
    if (!t || !t.remote || (typeof Flight !== 'undefined' && Flight.active !== v)) return 0;
    return t.remote;
  },
  _pidV: null,
  // Does L's tracking radar hold t (at tp) for a semi-active missile s: locked on it, in reach, nothing in the way
  // (looked at every 0.25 s for each missile), not lost in the clutter. True, 'notch' or false.
  radarSees(L, t, tp, s) {
    if (!L || L.dead || L.ko || !L.parts || !tp || tp.alive === false) return false;
    const p = this.kit(L).track;
    if (!p || p.broken || !L.trk || L.trk.lock !== t) return false;
    const O = this.trunnion(L, p, aimL), d = Math.hypot(tp.x - O.x, tp.y - O.y, tp.z - O.z);
    if (d > p.def.trackRadar.range) return false;
    let clear;
    if (s && s.losAt != null && s.t - s.losAt < 0.25) clear = s.los;
    else { clear = aimClear(L.body, O, tp, d); if (s) { s.losAt = s.t; s.los = clear; } }
    return !clear ? false : aimNotch(t, tp, O) ? 'notch' : true;
  },

  // ---- guidance (Phase 2C): Combat's guide hands these missiles over
  // Wire guidance (SACLOS): the missile rides the shooter's line of aim, steering for the point on it 150 m past itself
  // (aimed ahead of where that point is going, so it meets a crossing target), at up to turn·g/v. The wire is cut (it
  // flies on straight) when the shooter or its launcher is knocked out; smoke between them holds its last steering.
  guideSaclos(s, h, spd) {
    const L = s.launcher, p = s.part;
    if (s.cut || !L || L.dead || L.ko || !L.parts.includes(p) || p.broken) { s.cut = true; this.straight(s, spd); return; }
    const O = aimTq, D = aimW;
    this.ray(L, p, s.sim, O, D);
    const mx = s.x - O.x, my = s.y - O.y, mz = s.z - O.z, rm = Math.hypot(mx, my, mz), r = rm + 150;
    s.rm = rm;
    if (Combat.S.smoke.length && this.smokeBlocks(O, s)) { if (s.hx != null) this.turnTo(s, s.hx, s.hy, s.hz, h, spd); return; }
    const wx = O.x + D.x * r, wy = O.y + D.y * r, wz = O.z + D.z * r;
    // where that point is going: the line swinging (from its way a step ago) and the shooter moving
    let vx = L.vx || 0, vy = L.vy || 0, vz = L.vz || 0;
    if (s.rdx != null && h > 0) { vx += ((D.x - s.rdx) / h) * r; vy += ((D.y - s.rdy) / h) * r; vz += ((D.z - s.rdz) / h) * r; }
    s.rdx = D.x; s.rdy = D.y; s.rdz = D.z;
    const tau = Math.hypot(wx - s.x, wy - s.y, wz - s.z) / Math.max(spd, 50);
    let ax = wx + vx * tau - s.x, ay = wy + vy * tau - s.y, az = wz + vz * tau - s.z;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    s.hx = ax; s.hy = ay; s.hz = az;
    this.turnTo(s, ax, ay, az, h, spd);
  },
  // a shooter's line of aim (into O and D, sim): the player's crosshair in aim mode, a computer's at its aim point, else
  // the launcher's own barrel (a helicopter's or a plane's: its nose)
  ray(L, p, F, O, D) {
    if (F && L === F.active && F.groundAim && F.aim && F.aim.o && F.aim.dir) { O.x = F.aim.o.x; O.y = F.aim.o.y; O.z = F.aim.o.z; D.x = F.aim.dir.x; D.y = F.aim.dir.y; D.z = F.aim.dir.z; return; }
    if (L.ai && L.aimP) {
      this.sightPoint(L, O);
      D.x = L.aimP.x - O.x; D.y = L.aimP.y - O.y; D.z = L.aimP.z - O.z;
      const l = Math.hypot(D.x, D.y, D.z) || 1; D.x /= l; D.y /= l; D.z /= l;
      return;
    }
    this.trunnion(L, p, O); this.dir(L, p, D);
  },
  // Top attack (fire and forget, on its IR lock s.tgt): it climbs to loft m over the line from where it set off to the
  // target, and inside 400 m of it along the ground dives onto its roof, aimed ahead of it
  guideTop(s, h, spd) {
    const tp = aimPos(s.tgt, aimTq);
    if (!tp) { s.tgt = null; this.straight(s, spd); return; } // (it flies on, straight)
    const r = Math.hypot(tp.x, tp.y, tp.z) || 1, ux = tp.x / r, uy = tp.y / r, uz = tp.z / r;
    const dx = tp.x - s.x, dy = tp.y - s.y, dz = tp.z - s.z, du = dx * ux + dy * uy + dz * uz, hx = dx - ux * du, hy = dy - uy * du, hz = dz - uz * du, hd = Math.hypot(hx, hy, hz) || 1;
    if (s.h0 == null) { s.h0 = -du; s.d0 = Math.max(hd, 1); }
    let ax, ay, az;
    if (!s.dive && hd > 400) {
      const want = s.h0 * clamp(hd / s.d0, 0, 1) + (s.loft || 150), climb = want + du, look = Math.max(150, spd * 1.5);
      ax = (hx / hd) * look + ux * climb; ay = (hy / hd) * look + uy * climb; az = (hz / hd) * look + uz * climb;
    } else { // (onto its roof: aimed at its top, so even a shallow dive comes in through it)
      s.dive = true;
      const E = aimEye(s.tgt, aimB), tt = Math.hypot(dx, dy, dz) / Math.max(spd, 50);
      ax = E.x - s.x + tp.vx * tt; ay = E.y - s.y + tp.vy * tt; az = E.z - s.z + tp.vz * tt;
    }
    const al = Math.hypot(ax, ay, az) || 1;
    this.turnTo(s, ax / al, ay / al, az / al, h, spd);
  },
  // Command guidance (clos): the launcher's tracking radar holds the target and steers the missile along its beam, for
  // the point 200 m past the missile (ahead of where that point is going), gain 3, at up to turn·g. A lock lost for over
  // a second and it flies on straight (no target: no burst either).
  guideClos(s, h, spd) {
    const L = s.launcher, t = s.target, p = L && L.parts && this.kit(L).track;
    const held = !!t && !!p && !p.broken && !L.dead && !L.ko && !!L.trk && L.trk.lock === t;
    s.lostT = held ? 0 : (s.lostT || 0) + h;
    if (s.lostT > 1 || !p) { s.target = null; this.straight(s, spd); return; }
    const tp = aimPos(t, aimTq);
    if (!tp) { s.target = null; this.straight(s, spd); return; }
    const O = this.trunnion(L, p, aimA);
    let bx = tp.x - O.x, by = tp.y - O.y, bz = tp.z - O.z;
    const D = Math.hypot(bx, by, bz) || 1;
    bx /= D; by /= D; bz /= D;
    const rm = Math.hypot(s.x - O.x, s.y - O.y, s.z - O.z), rr = rm + 200;
    // the beam swinging (the target crossing it, the launcher moving) and the missile running out along it
    const rx = tp.vx - (L.vx || 0), ry = tp.vy - (L.vy || 0), rz = tp.vz - (L.vz || 0), ru = rx * bx + ry * by + rz * bz, ru2 = spd * (s.dx * bx + s.dy * by + s.dz * bz);
    const vx = (L.vx || 0) + ((rx - bx * ru) / D) * rr + bx * ru2, vy = (L.vy || 0) + ((ry - by * ru) / D) * rr + by * ru2, vz = (L.vz || 0) + ((rz - bz * ru) / D) * rr + bz * ru2;
    const wx = O.x + bx * rr, wy = O.y + by * rr, wz = O.z + bz * rr, tau = Math.hypot(wx - s.x, wy - s.y, wz - s.z) / Math.max(spd, 50);
    let ax = wx + vx * tau - s.x, ay = wy + vy * tau - s.y, az = wz + vz * tau - s.z;
    const al = Math.hypot(ax, ay, az) || 1;
    this.turnTo(s, ax / al, ay / al, az / al, h, spd, 3);
  },
  // A ground launcher's missile with nothing to steer for flies on straight, its autopilot holding its heading (so one
  // fired level off a low launcher doesn't sink into the ground)
  straight(s, spd) { s.vx = s.dx * spd; s.vy = s.dy * spd; s.vz = s.dz * spd; },
  // a missile's heading turned toward the unit (wx, wy, wz), by up to turn·g/v over this step (gain: by no more than that
  // share of the angle a second)
  turnTo(s, wx, wy, wz, h, spd, gain) {
    const ang = Math.acos(clamp(wx * s.dx + wy * s.dy + wz * s.dz, -1, 1));
    let m = ((s.turn * 9.81) / Math.max(spd, 50)) * h;
    if (gain) m = Math.min(m, gain * ang * h);
    const k = ang > 1e-6 ? Math.min(1, m / ang) : 1, nx = s.dx + (wx - s.dx) * k, ny = s.dy + (wy - s.dy) * k, nz = s.dz + (wz - s.dz) * k, nl = Math.hypot(nx, ny, nz) || 1;
    s.dx = nx / nl; s.dy = ny / nl; s.dz = nz / nl;
    s.vx = s.dx * spd; s.vy = s.dy * spd; s.vz = s.dz * spd;
  },

  // ---- smoke (Phase 2C)
  // K (SMOKE): every smoke launcher with grenades left throws its salvo; all of them fan out over 80° round the main
  // turret's facing (else the hull's), landing 25-35 m off, where each blooms into a cloud (2 m to 9 m round in 3 s, for
  // 25 s) that hides what's behind it (smokeBlocks). False with none left.
  smoke(v, F) {
    const L = v.parts.filter((p) => p.def.weapon && p.def.weapon.kind === 'smoke' && p.ammo > 0 && !p.broken);
    if (!L.length) return false;
    const n = L.reduce((s, p) => s + (p.def.weapon.salvo || 1), 0), b = v.body, r = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r;
    // the facing, along the ground
    const M = aimMain(v);
    let g = M && v.tgOf && v.tgOf.get(M.id);
    while (g && g.parent) g = g.parent;
    const f = aimS;
    f.x = 1; f.y = 0; f.z = 0;
    if (g) aimRotY(f, g.ring.aimYaw || 0);
    qrot(v.q, f.x, f.y, f.z, f);
    const fu = f.x * ux + f.y * uy + f.z * uz;
    f.x -= ux * fu; f.y -= uy * fu; f.z -= uz * fu;
    const fl = Math.hypot(f.x, f.y, f.z) || 1;
    f.x /= fl; f.y /= fl; f.z /= fl;
    const sx = uy * f.z - uz * f.y, sy = uz * f.x - ux * f.z, sz = ux * f.y - uy * f.x;
    let j = 0;
    for (const p of L) {
      p.ammo--;
      const at = v.toWorld(p.x, p.y, partZ(p));
      for (let i = 0; i < (p.def.weapon.salvo || 1); i++, j++) {
        const a = (n > 1 ? -40 + (80 * j) / (n - 1) : 0) * AIM_RAD + (Math.random() - 0.5) * 0.06, d = 25 + Math.random() * 10, ca = Math.cos(a) * d, sa = Math.sin(a) * d;
        let x = v.x + f.x * ca + sx * sa, y = v.y + f.y * ca + sy * sa, z = v.z + f.z * ca + sz * sa;
        Terrain.locate(b, x, y, z, aimLoc);
        const k = (b.radius + Math.max(b.ocean ? 0 : -Infinity, Terrain.surfaceAt(b, aimLoc.a, aimLoc.z)) + 2) / aimLoc.r;
        x *= k; y *= k; z *= k;
        const c = { b, x: at.x, y: at.y, z: at.z, vx: (x - at.x) / AIM_FLY, vy: (y - at.y) / AIM_FLY, vz: (z - at.z) / AIM_FLY, fly: AIM_FLY, t: 0, r: 0.5, life: 25, fx: 0, by: v };
        Combat.S.smoke.push(c);
        if (typeof MP !== 'undefined') MP.sendSmoke(v, { x: c.x, y: c.y, z: c.z, dx: c.vx, dy: c.vy, dz: c.vz });
      }
    }
    if (v === F.active) Sound.burst(0.25, 700, 0.5, 'bandpass');
    return true;
  },
  // the clouds, with the physics: a grenade flies out, then blooms and thins away; big soft puffs (4 as it blooms, then
  // one a second) only near the camera and at normal speed
  smokeStep(h) {
    const L = Combat.S.smoke, F = typeof Flight !== 'undefined' && Flight.running ? Flight : null, A = F && F.active;
    for (let i = L.length; i--;) {
      const c = L[i];
      if ((c.t += h) > c.life) { L.splice(i, 1); continue; }
      if (c.t < c.fly) { c.x += c.vx * h; c.y += c.vy * h; c.z += c.vz * h; c.r = 0.5; continue; }
      c.r = (2 + 7 * Math.min(1, (c.t - c.fly) / 3)) * Math.min(1, (c.life - c.t) / 3);
      if (!A || A.body !== c.b || F.warpIdx > 1 || (c.fx -= h) > 0 || Math.hypot(c.x - A.x, c.y - A.y, c.z - A.z) > 3000) continue;
      const m = c.n ? 1 : 4, r = Math.hypot(c.x, c.y, c.z) || 1;
      c.n = (c.n || 0) + 1; c.fx = 1;
      for (let k = 0; k < m; k++) FX.add({ kind: 'smoke', b: c.b, x: c.x + (Math.random() - 0.5) * 5, y: c.y + (Math.random() - 0.5) * 5, z: c.z + (Math.random() - 0.5) * 5,
        vx: (c.x / r) * 0.5 + (Math.random() - 0.5), vy: (c.y / r) * 0.5 + (Math.random() - 0.5), vz: (c.z / r) * 0.5 + (Math.random() - 0.5), max: 6, size: 4 + Math.random() * 2, grow: 1.3, color: '#d6d9dc', alpha: 0.75 });
    }
  },
  // someone else's grenade (cm with smoke: P where it set off, D its velocity): the same cloud, if it makes sense
  netSmoke(g, m) {
    const ok = (q) => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite), P = m && m.P, D = m && m.D, L = Combat.S.smoke;
    if (!g || !ok(P) || !ok(D) || L.length >= 80 || Math.hypot(D[0], D[1], D[2]) > 120 || (Number.isFinite(g.x) && Math.hypot(P[0] - g.x, P[1] - g.y, P[2] - g.z) > 400)) return;
    L.push({ b: g.body || EARTH, x: P[0], y: P[1], z: P[2], vx: D[0], vy: D[1], vz: D[2], fly: AIM_FLY, t: 0, r: 0.5, life: 25, fx: 0, by: g });
  },
  // smoke between a and b (points or craft, sim): the segment through any cloud
  smokeBlocks(a, b) {
    const L = Combat.S.smoke;
    if (!L.length || !a || !b) return false;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l2 = dx * dx + dy * dy + dz * dz;
    for (const c of L) {
      if (c.t < c.fly || c.r < 1) continue;
      const t = l2 > 0 ? clamp(((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / l2, 0, 1) : 0, ex = a.x + dx * t - c.x, ey = a.y + dy * t - c.y, ez = a.z + dz * t - c.z;
      if (ex * ex + ey * ey + ez * ez < c.r * c.r) return true;
    }
    return false;
  },

  // ---- line of sight (Phase 2C)
  // Can a see b (craft, range targets or points, sim): from a's top to b's along the ground as drawn (Render3D.drawnGround
  // with the 3D view up, else Terrain.surfaceAt) every 20 m, and wherever the line comes within 3 m of it, the real ground
  // (3 looks, 0.3 m clear); wrecks in the way (0.7 of their reach) and smoke (not with opts.thermal) block it too.
  // Remembered for 0.5 s a pair; no more than 3 pairs looked at afresh a frame (the rest keep their last answer). It
  // decides who is marked and what the AI sees, never what is hit.
  sees(a, b, opts) {
    if (!a || !b) return false;
    const o = opts || {}, F = typeof Flight !== 'undefined' ? Flight : null, now = o.t != null ? o.t : (F && F.time) || 0, th = !!o.thermal;
    let M = null, memo = null;
    if (o.memo !== false && typeof a === 'object' && typeof b === 'object' && (a.parts || a.def) && (b.parts || b.def)) {
      memo = this._sees.get(a);
      if (!memo) this._sees.set(a, (memo = new WeakMap()));
      M = memo.get(b);
      if (M && M.th === th && now - M.t < 0.5 && now >= M.t) return M.r;
      if (this._sbT !== now) { this._sbT = now; this._sbN = 0; }
      if (M && M.th === th && this._sbN >= 3) return M.r;
      this._sbN++;
    }
    const B = a.body || b.body || EARTH, A0 = aimEye(a, aimA), B0 = aimEye(b, aimB);
    let r = aimLos(B, A0, B0) && (th || !this.smokeBlocks(A0, B0));
    if (r && F && F.vessels) { // wrecks in the way
      let k = 0;
      for (const w of F.vessels) {
        if (!w.wreck || w.dead || w === a || w === b || k++ >= 8) continue;
        const dx = B0.x - A0.x, dy = B0.y - A0.y, dz = B0.z - A0.z, l2 = dx * dx + dy * dy + dz * dz || 1, t = clamp(((w.x - A0.x) * dx + (w.y - A0.y) * dy + (w.z - A0.z) * dz) / l2, 0, 1), rr = 0.7 * (w.reach || 4);
        if (Math.hypot(A0.x + dx * t - w.x, A0.y + dy * t - w.y, A0.z + dz * t - w.z) < rr) { r = false; break; }
      }
    }
    if (memo) { if (!M) memo.set(b, (M = {})); M.t = now; M.r = r; M.th = th; }
    return r;
  },
  // what a player's own eyes take to Aim.sees: through smoke with a working thermal sight (looked for again every half
  // second of the sim), else nothing more
  eyes(v) {
    if (!v || !v.parts) return undefined;
    const now = (typeof Flight !== 'undefined' && Flight.time) || 0;
    let T = this._th.get(v);
    if (!T) this._th.set(v, (T = { t: -1, on: false }));
    if (now - T.t >= 0.5 || now < T.t) { T.t = now; T.on = false; for (const p of v.parts) if (p.def.thermal && !p.broken && !(p.hp <= 0)) { T.on = true; break; } }
    return T.on ? this._thO : undefined;
  },
  _sees: new WeakMap(), _sbT: -1, _sbN: 0, _th: new WeakMap(), _thO: { thermal: true },
};

// (Phase 2C) the aim's other helpers
const AIM_FLY = 0.8; // (a smoke grenade's flight, s)
const AIM_KIN = { ap: 1, aphe: 1, apcr: 1, apds: 1, apfsds: 1, ball: 1 }; // (kinetic rounds: slowed, they go through less)
const aimTables = new Map(), aimRk = { el: 0, t: 0, fall: 0, out: false, d: 0 }; // (rocket range tables, by part type and body)
// the range table read at x m (its rising half; beyond its reach, its longest shot: out)
function aimRkAt(T, x, o) {
  let top = 0;
  while (top + 1 < T.length && T[top + 1].d >= T[top].d) top++;
  if (x <= T[0].d) { const f = clamp(x / T[0].d, 0, 1); o.el = T[0].el * f; o.t = T[0].t * f; o.fall = T[0].fall; o.out = false; return o; }
  for (let i = 0; i < top; i++) {
    if (x > T[i + 1].d) continue;
    const f = (x - T[i].d) / (T[i + 1].d - T[i].d);
    o.el = lerp(T[i].el, T[i + 1].el, f); o.t = lerp(T[i].t, T[i + 1].t, f); o.fall = lerp(T[i].fall, T[i + 1].fall, f); o.out = false;
    return o;
  }
  o.el = T[top].el; o.t = T[top].t; o.fall = T[top].fall; o.out = true;
  return o;
}
// an angle as a ring may hold it: within its free arc (the turn of it nearest where it is now; else the arc's nearer
// end), or anywhere round without one
function aimFit(a, cur, lim) {
  if (!lim) return wrapAngle(a);
  let best = null;
  for (let k = -1; k <= 1; k++) { const u = wrapAngle(a) + k * TAU; if (u >= lim[0] && u <= lim[1] && (best === null || Math.abs(u - cur) < Math.abs(best - cur))) best = u; }
  if (best !== null) return best;
  return Math.abs(wrapAngle(a - lim[0])) < Math.abs(wrapAngle(a - lim[1])) ? lim[0] : lim[1];
}
// an aimed part's own yaw kept to its arc (all the way round: wrapped)
function aimArc(p, g, y) {
  const a = p.def.aim, tr = a.trav, cm = !g && a.casemate, lo = tr ? tr[0] * AIM_RAD : cm ? -cm[0] * AIM_RAD : 0, hi = tr ? tr[1] * AIM_RAD : cm ? cm[0] * AIM_RAD : 0;
  return hi - lo >= TAU - 1e-6 ? wrapAngle(y) : clamp(y, lo, hi);
}
// how much a weapon counts as the main one: a main gun by calibre, then automatic guns, missiles, rockets
function aimRank(p) { const w = p.def.weapon; return !w ? 0 : w.kind === 'tgun' ? 3000 + (w.cal || 0) : w.kind === 'agun' ? 2000 + (w.cal || 0) : w.kind === 'missile' ? 1000 : w.kind === 'rocket' ? 500 : 1; }
function aimMain(v) { let best = null; for (const p of v.aimed) if (!best || aimRank(p) > aimRank(best)) best = p; return best; }
// a ring's main weapon: the chosen system's, if it rides this ring; else the biggest weapon on it; else its tracking dish
function aimPrimary(g, cur) {
  if (cur && cur.def.aim) for (const p of cur.parts) if (g.ids.has(p.id)) return p;
  let best = null, dish = null;
  for (const p of g.members) {
    if (!p.def.aim) continue;
    if (p.def.weapon) { if (!best || aimRank(p) > aimRank(best)) best = p; } else if (p.def.trackRadar && !dish) dish = p;
  }
  return best || dish;
}
// the gun whose shell the lead is worked out for: the chosen one, else the biggest automatic gun, else the main gun
function aimLeadGun(v, cur) {
  if (cur && cur.def.aim && (cur.w.kind === 'agun' || cur.w.kind === 'tgun')) return cur.parts[0];
  let best = null, bs = -1;
  for (const p of v.aimed) { const w = p.def.weapon, s = w && (w.kind === 'agun' ? 1000 : w.kind === 'tgun' ? 0 : -1e9) + (w.cal || 0); if (w && s > bs) { bs = s; best = p; } }
  return bs >= 0 ? best : null;
}
// a store of rounds (Armour.crewOf): an autoloader's (its fixed reload), a placed rack, a built-in one; usable while whole
const aimStoreAuto = (e) => e.autoload || (e.part && e.part.def.autoload) || (e.i >= 0 && e.host && e.host.def.mods && e.host.def.mods[e.i] && e.host.def.mods[e.i].autoload) || 0;
const aimStoreRank = (e) => (aimStoreAuto(e) ? 2 : e.part || e.i < 0 ? 1 : 0);
const aimStoreOk = (e) => (e.part ? !e.part.broken && !(e.part.hp <= 0) : !(e.host && e.host.mods && e.host.mods[e.i] != null && e.host.mods[e.i] <= 0));
function aimAutoload(v) {
  const C = Armour.crewOf(v);
  let t = 0;
  for (const e of (C && C.stores) || []) { const s = aimStoreAuto(e); if (s && aimStoreOk(e) && (!t || s < t)) t = s; }
  return t;
}
// how high a shell can fly before it might meet the ground (Armour.moveShell skips the ground test above it): over an
// arena (EARTH.arenas' boxes), 5 m over its highest ground, found on an 80 m grid with room for its berms and what
// the grid steps over; anywhere else no such height. The grid (about 1,250 points) is read a few points a step
// (aimTopStep, from Aim.stepAll) from the first shot on, so no shot waits for it: until it is done, none.
const aimTops = new Map(), aimTopQ = [];
function aimGTop(b, m) {
  const A = b === EARTH && EARTH.arenas;
  if (!A) return Infinity;
  Terrain.locate(b, m.x, m.y, m.z, aimLoc);
  const e = wrapAngle(EARTH.padAngle - aimLoc.a) * b.radius, z = aimLoc.z;
  for (const k in A) {
    const B = A[k].box;
    if (!B || e < B.e0 || e > B.e1 || z < B.z0 || z > B.z1) continue;
    const key = k + (EARTH.mapped ? '+' : '-');
    let T = aimTops.get(key);
    if (!T) { aimTops.set(key, (T = { B, x: B.e0, y: B.z0, top: -Infinity, done: false })); aimTopQ.push(T); }
    return T.done ? T.top + 5 : Infinity;
  }
  return Infinity;
}
// n more points of the grid being read (the first unfinished one)
function aimTopStep(n) {
  const T = aimTopQ[0], B = T.B;
  for (let i = 0; i < n && !T.done; i++) {
    T.top = Math.max(T.top, Terrain.surfaceAt(EARTH, siteAngle(EARTH, T.x), T.y));
    if ((T.y += 80) > B.z1 + 1) { T.y = B.z0; if ((T.x += 80) > B.e1 + 1) { T.done = true; T.top += 8; aimTopQ.shift(); } }
  }
}
// nothing between o and p (d apart) but air: the ground (or the sea) sampled every 150 m, 4 m clear (Combat's clearLine)
function aimClear(b, o, p, d) {
  const n = clamp(Math.ceil(d / 150), 4, 120);
  for (let i = 1; i < n; i++) {
    const k = i / n;
    Terrain.locate(b, o.x + (p.x - o.x) * k, o.y + (p.y - o.y) * k, o.z + (p.z - o.z) * k, aimLoc);
    if (aimLoc.r < b.radius + Math.max(0, Terrain.surfaceAt(b, aimLoc.a, aimLoc.z)) + 4) return false;
  }
  return true;
}
// a ground radar's clutter: an aircraft under 40 m over the ground moving under 40 m/s along the beam from o is lost in it
function aimNotch(t, tp, o) {
  if (!t.parts || !t.groundAltitude) return false; // (a target drone flies high)
  const dx = tp.x - o.x, dy = tp.y - o.y, dz = tp.z - o.z, d = Math.hypot(dx, dy, dz) || 1;
  return Math.abs((tp.vx * dx + tp.vy * dy + tp.vz * dz) / d) < 40 && t.groundAltitude() < 40;
}
// where a craft looks from, or is seen at: its top (a range target's middle; a point itself), sim
function aimEye(o, out) {
  if (o.def && o.pos) { const P = o.pos, u = 1 / (Math.hypot(P.x, P.y, P.z) || 1), k = o.def.h * 0.8; out.x = P.x * (1 + k * u); out.y = P.y * (1 + k * u); out.z = P.z * (1 + k * u); return out; }
  if (!o.parts || !o.com) { out.x = o.x; out.y = o.y; out.z = o.z; return out; }
  out.x = o.com.x; out.y = (o.bounds ? o.bounds.maxY : o.com.y + 1) - 0.15; out.z = o.com.z || 0;
  return aimSim(o, out);
}
// the ground between a and e as drawn (with the 3D view up), checked against the real ground close to it
function aimLos(B, a, e) {
  const dx = e.x - a.x, dy = e.y - a.y, dz = e.z - a.z, n = Math.max(2, Math.ceil(Math.hypot(dx, dy, dz) / 20));
  const R3 = typeof Render3D !== 'undefined' && Render3D.ready && Render3D.drawnGround ? Render3D : null, sea = B.ocean ? 0 : -Infinity;
  const real = (k) => { Terrain.locate(B, a.x + dx * k, a.y + dy * k, a.z + dz * k, aimLoc); return aimLoc.r - B.radius - Math.max(sea, Terrain.surfaceAt(B, aimLoc.a, aimLoc.z)); };
  for (let i = 1; i < n; i++) {
    const k = i / n;
    Terrain.locate(B, a.x + dx * k, a.y + dy * k, a.z + dz * k, aimLoc);
    const cl = aimLoc.r - B.radius - Math.max(sea, R3 ? R3.drawnGround(B, aimLoc.a, aimLoc.z) : Terrain.surfaceAt(B, aimLoc.a, aimLoc.z));
    if (cl < (R3 ? 0 : 0.3)) return false;
    if (cl < 3 && R3) for (const f of [-0.33, 0, 0.33]) if (real(k + f / n) < 0.3) return false;
  }
  return true;
}
