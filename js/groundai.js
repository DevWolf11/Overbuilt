'use strict';
// Computer-driven ground vehicles (the ground update): the Tank Range's targets and the Practice Battle's allies and
// enemies. They are real Vessels built from the stock templates (real parts: the same armour, crews, guns, 3D models
// and hits as anyone's), marked v.ai = { ground: true, team, role, skill, state, ... } and v.kin = true, so no physics
// step moves them: kinStep does, cheaply, along the ground. 30 moves a second (heading and speed, the speed held to
// what the template's power can climb on the slope under it), 10 attitude fits (a plane through three points of ground
// under its hull, front, rear left and rear right, lifted to a fourth under its middle over a crest), and twice a second
// a look 25 m ahead for water and ground too steep to drive: about 44 looks at the ground a second each while it moves,
// none parked. Between moves the pose glides on (each frame), so they move as smoothly as anything else on screen.
// They decide 4 times a second: whom to fight (the nearest enemy they can see, Aim.sees, within 1.5 km), where to go
// (the nearest zone their side doesn't hold, a firing spot behind the nearest berm once they have someone to shoot,
// a few metres on when their gun can't reach from there, round the target's side when three rounds have done it no
// harm, home to their pad below 40% crew or with no weapon working), and when to shoot: stopped, within 1.2 km, after
// a reaction of 0.6-1.2 s, aiming 0.5-1.5 mrad off (their skill; the first round at a new target wider), the gun within
// 0.4° and loaded, its round's path clear of the ground; AP at armour, HE at open tops and soft vehicles. Hit, they may
// pop smoke and back off. They aim through Aim.step (v.aimP) and fire through Aim.stepAll (v.aimFire, v.mgFire). Nothing of
// this runs in a room.
//
// The Tank Range (Highland Ridge, with a ground vehicle within 4 km of it): Practice, targets parked and on patrol that
// never fire (knocked out, one comes back 45 s later somewhere else), and drones with AA aboard; Hostile, waves from the
// south pad that fight, and an attack plane every 3 min with AA aboard; Off, nothing. The Practice Battle: you and two AI
// allies against three AI, the Ground Battle's rules (gmode.js) run here, its objective in GroundAI.battle.obj, and its
// own respawn panel (respawns keep the AI and the wrecks: Flight.start's keep).

const GroundAI = (() => {
  const RAD = Math.PI / 180, GRAV = 9.81;
  const AI = {
    kin: 1 / 30, fit: 0.1, think: 0.25, look: 0.5, ahead: 25, // s: a move, an attitude fit, a decision, a look ahead (m)
    engage: 1200, see: 1500, cover: 120, tol: 0.4 * RAD, tolAuto: 1.2 * RAD, slope: 22 * RAD, // m: shoot within, look for enemies, a firing spot within; on target; too steep
    limit: 1.5, stuck: 3, back: 2.5, retreat: 0.4, react: [1.2, 0.6], err: [1.5, 0.5], lost: 3, // s a gun held at a limit before it moves; s stuck before backing off, and for; crew share to fall back; worst..best skill (s, mrad); s a lost target is still hunted
    sag: 0.45, crr: 0.035, eta: 0.6, acc: 2.5, brake: 5, // the suspension's settle (of its travel), rolling resistance, transmission; m/s² up and down
  };
  const RANGE = { r: 4000, back: 45, gap: 30, plane: 180, first: 12, near: 400 }; // m from the arena's middle; s to come back, between waves, between attack planes, to the first wave; m clear of the player
  const BATTLE = { tickets: 300, limit: 900, respawn: 5, wrecks: 8, wreckT: 90, panel: 1.6 }; // a side's tickets, s; s to respawn; wrecks kept, s; s before the respawn panel
  // The Tank Range's Practice targets on Highland Ridge, ahead of the north pad (the player's spot, 17,750 / 13,800):
  // a TK-34 side-on 600 m out, an MS-4 hull-down behind the berm 760 m out, a ZSY-23 on the hilltop (zone A), and a
  // Pumo and a Leapard 1 patrolling a 1.2 km loop through zone B at 6 and 4 m/s, half a lap apart
  const LAYOUT = [
    { key: 'tk34', e: 17580, z: 14385, yaw: 0, role: 'parked' },
    { key: 'ms4', e: 17750, z: 14560, yaw: Math.PI / 2, role: 'parked' }, // (its hull under the berm's crest from the pad, its turret above)
    { key: 'zsy23', e: 17050, z: 15000, yaw: Math.PI / 2, role: 'parked' },
    { key: 'pumo', role: 'patrol', at: 0, speed: 6 },
    { key: 'leapard1', role: 'patrol', at: 0.5, speed: 4 },
  ];
  const LOOP = { e: 18450, z: 14810, r: 191, n: 16 }; // (its south point is zone B's middle)
  const DRONES = { e: 17750, z: 12400, r: [600, 900], alt: [400, 600] }; // circling 1.5 km north of the pad

  const S = {
    ai: [], wrecks: [], dead: [], units: [], obs: [], range: null, b: null, F: null, chkT: 0, calls: 0, barT: 0, bar: null, barKey: '', warp: false, fresh: 0,
    tpl: new Map(), rnd: Math.random, panelT: null,
  };
  const mpOn = () => typeof MP !== 'undefined' && MP.active;
  const targetsMode = () => (mpOn() ? 'off' : (typeof Settings !== 'undefined' && Settings.get('targets')) || 'practice');
  const mapReady = () => typeof Terrain !== 'undefined' && !!Terrain.earthMap && Terrain.earthMap.state === 'ready' && !!EARTH.mapped;
  const has3D = () => typeof App === 'undefined' || !App.use3D || App.use3D();
  const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
  const say = (F, t, k) => { if (F && F.toast) F.toast(t, k); };
  // the ground under (e, z) and whether it is water: every look the AI takes at it goes through these (S.calls counts them)
  const groundAt = (e, z) => { S.calls++; return Terrain.surfaceAt(EARTH, siteAngle(EARTH, e), z); };
  const wetAt = (e, z) => { S.calls++; return Terrain.waterAt(EARTH, siteAngle(EARTH, e), z); };
  // where a sim point is in the space centre's terms (m along the track, e, and across it, z), into o
  const LOC = {};
  function eOf(x, y, z, o) {
    Terrain.locate(EARTH, x, y, z, LOC);
    o.e = -wrapAngle(LOC.a - EARTH.padAngle) * EARTH.radius; o.z = LOC.z;
    return o;
  }

  // ---------------------------------------------------------------- stock vehicles
  // A stock template made ready once: its rows, price, what the moves need (Gear.stats: top speed, power for its weight,
  // how fast it pivots, how steep it climbs), and, once one of them has aimed, its turret limits, which every later one
  // copies instead of sweeping them again (a sweep is 5-15 ms: a hitch at each respawn otherwise)
  function tplOf(key) {
    let T = S.tpl.get(key);
    if (T || typeof TEMPLATES === 'undefined' || !hasOwn(TEMPLATES, key)) return T || null;
    const t = TEMPLATES[key];
    S.tpl.set(key, (T = { key, t, kind: t.kind, name: t.name, rows: templateRows(t), cost: 0, mv: null, lim: null }));
    return T;
  }
  // a vessel of template T, as Flight.start builds one (the part tree holding the control part), not yet placed
  function build(T) {
    const ps = partsFromDesign(T.rows), adjAll = buildAdjacency(ps), ctrl = findControlPart(ps);
    if (!ctrl) return null;
    const keep = componentOf(ctrl.id, adjAll), parts = ps.filter((p) => keep.has(p.id)), adj = new Map();
    for (const p of parts) { if (p.att != null && !keep.has(p.att)) p.att = null; adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id)))); }
    const v = new Vessel(parts, adj, EARTH);
    v.kind = T.kind; v.name = T.name; v.stages = computeStages(parts, adj, ctrl.id);
    v.rebuildGroups();
    if (!T.mv) {
      T.cost = designCost(parts);
      const st = v.gear.length && typeof Gear !== 'undefined' ? Gear.stats(parts) : null, trav = v.gear.reduce((m, p) => Math.max(m, (p.def.track || p.def.awheel).travel || 0), 0);
      const wheeled = !v.gear.some((p) => p.def.track), kw = st && st.hpt > 0 ? st.hpt * 0.7457 : 30; // (W per kg)
      T.mv = { top: st && st.top > 1 ? st.top / 3.6 : 16, pw: kw, pivot: (st && st.pivot > 1 ? st.pivot : 25) * RAD, climb: Math.min(AI.slope, (st && st.climb > 1 ? st.climb : 25) * RAD), wheeled, trav };
    }
    limitsTo(T, v);
    return v;
  }
  function limitsTo(T, v) {
    if (!v.aimed.length || typeof Aim === 'undefined') return;
    const L = T.lim, tg = v.tg || [];
    if (L && L.n === v.parts.length && L.g.length === tg.length) {
      const dep = new Map();
      for (let i = 0; i < v.parts.length; i++) if (L.deps[i]) dep.set(v.parts[i].id, L.deps[i]);
      for (let i = 0; i < tg.length; i++) { tg[i].yawLim = L.g[i].yawLim; tg[i].dep = L.g[i].dep; }
      v._dep = dep; v._limTg = v.tg; v._limN = v.parts.length;
      return;
    }
    const dep = Aim.limits(v);
    T.lim = { n: v.parts.length, deps: v.parts.map((p) => dep.get(p.id) || null), g: tg.map((g) => ({ yawLim: g.yawLim, dep: g.dep })) };
  }
  // what a vehicle fights with: its main gun (the biggest), else its wire-guided missiles, else its biggest autocannon
  // (20 mm and up), of those it still has rounds for
  const rankOf = (s) => { const w = s.w; return w.kind === 'tgun' ? 3000 + (w.cal || 0) : w.kind === 'missile' && w.seek === 'saclos' ? 2000 : w.kind === 'agun' && (w.cal || 0) >= 20 ? 1000 + (w.cal || 0) : -1; }; // (machine guns only at soft targets: v.mgFire)
  function mainOf(v) {
    const sys = Combat.systems(v);
    let best = -1, bs = -1;
    sys.forEach((s, i) => {
      const w = s.w, aimed = !!s.def.aim && s.parts.some((p) => !p.broken && (p.ammo > 0 || p.stow > 0 || (p.stow == null && w.stow > 0))), sc = aimed ? rankOf(s) : -1;
      if (sc > bs) { bs = sc; best = i; }
    });
    return best;
  }
  // its weapon: the main one (v.wsel), and whether it has to turn its hull to aim it (no turret ring under it)
  function arm(v) {
    const a = v.ai, i = mainOf(v);
    a.sys = i; a.gun = null;
    if (i < 0) return;
    v.wsel = i; a.gun = Combat.systems(v)[i].parts[0];
    a.turretless = !(v.tgOf && v.tgOf.get(a.gun.id));
  }
  // A ground vehicle on the side of team at (e, z), facing yaw: role 'parked' (stays), 'patrol' (round the loop), 'fight',
  // 'guard' (fights where it stands)
  function spawn(F, key, e, z, yaw, team, role, o = {}) {
    const T = tplOf(key);
    if (!T) return null;
    const v = build(T);
    if (!v) return null;
    const sk = o.skill != null ? o.skill : S.rnd();
    v.kin = true; v.sas = 'off'; v.throttle = 0; v.isDebris = false;
    v.ai = { ground: true, team, ally: !!S.b && team === S.b.team, role, skill: sk, state: role === 'fight' ? 'move' : role, key, cost: T.cost, down: false,
      want: 0, yawWant: yaw, thinkT: S.rnd() * AI.think, lookT: S.rnd() * AI.look, tgt: null, seen: false, tD: Infinity, lostAt: -9, reactAt: 0, cover: null, coverFor: null,
      react: AI.react[0] + (AI.react[1] - AI.react[0]) * sk, errK: (AI.err[0] + (AI.err[1] - AI.err[0]) * sk) * 1e-3, errAt: -9, shot: null, P: v3(),
      sys: -1, gun: null, soft: false, clear: true, block: 0, blockDir: S.rnd() < 0.5 ? -1 : 1, revT: 0, progT: 0, progE: e, progZ: z, wp: 0, cruise: o.speed || 0, home: !!o.home, homeWhy: o.home ? 'crew' : null,
      zone: null, spot: null, k: null, wave: o.wave || 0, tof: 0, onN: 0, nShot: 0, ea: 0, eb: 0, tgtU: { e: 0, z: 0 }, turretless: false, thermal: v.parts.some((p) => p.def.thermal), limT: 0, pathT: -9, pathOk: true, pathFor: null, pathBlk: 0, pathN: 0, badB: null, badFor: null };
    arm(v);
    place(v, T, e, z, yaw);
    F.vessels.push(v);
    S.ai.push(v);
    Combat.S.gai = 1;
    return v;
  }
  // set it down at (e, z): its height over the ground at rest from its hull and running gear (placeOnSurface's, less the
  // settle of the suspension under its weight), the ground's plane fitted under it, posed
  function place(v, T, e, z, yaw) {
    v.placeOnSurface(EARTH, siteAngle(EARTH, e), 0, z, yaw);
    const L = Terrain.locate(EARTH, v.x, v.y, v.z, {}), mv = T.mv, b = v.bounds;
    const k = (v.ai.k = { e, z, yaw, s: 0, w: 0, t: 0, acc: 0, fitT: 0, P0: { e, z, h: 0, ge: 0, gz: 0 }, P1: { e, z, h: 0, ge: 0, gz: 0 },
      hoff: L.r - EARTH.radius - Terrain.surfaceAt(EARTH, L.a, L.z) - AI.sag * mv.trav, L: clamp(0.4 * (b.maxX - b.minX), 1.2, 3.5), W: clamp(0.4 * (b.maxZ - b.minZ), 0.8, 1.8),
      r: clamp(0.38 * Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ), 2, 5), top: mv.top, rev: Math.min(4, mv.top * 0.4), pw: mv.pw, pivot: mv.pivot, climb: mv.climb, wheeled: mv.wheeled,
      B: 1, gear: [], av: v3(), n: v3(), idle: 0, rest: false, cx: v.com.x, cy: v.com.y, cz: v.com.z || 0 });
    let z0 = 0, z1 = 0, n0 = 0, n1 = 0;
    const cz = v.com.z || 0;
    for (const p of v.gear) { const side = partZ(p) > cz ? 1 : 0; k.gear.push({ p, side }); if (side) { z1 += partZ(p); n1++; } else { z0 += partZ(p); n0++; } }
    if (n0 && n1) k.B = Math.max(1, z1 / n1 - z0 / n0);
    if (!v.beltV) v.beltV = [0, 0];
    v.susp = [0.4 * mv.trav, 0.4 * mv.trav]; // (each side at its rest: the 3D wheels where they are drawn parked)
    fit(v); Object.assign(k.P0, k.P1);
    pose(v, 0);
    v.av = k.av; v.landed = true; v.contactTime = 1; v.wheelsDown = true; v.splashed = false;
  }

  // ---------------------------------------------------------------- the kinematic move
  // The plane of the ground under the hull (P1; the last one in P0, the pose blending from one to the next over a fit):
  // three looks, under the front and the two rear corners, a little ahead of where it is now, and one under its middle,
  // which lifts the plane where the hull rides over a crest (a berm) rather than through it
  function fit(v) {
    const k = v.ai.k, c = Math.cos(k.yaw), s = -Math.sin(k.yaw), ahead = k.s * AI.fit * 0.5, e = k.e + c * ahead, z = k.z + s * ahead;
    const ax = c * k.L, az = s * k.L, bx = -s * k.W, bz = c * k.W; // (along the hull, across it)
    const h1 = groundAt(e + ax, z + az), h2 = groundAt(e - ax - bx, z - az - bz), h3 = groundAt(e - ax + bx, z - az + bz);
    // the plane through the three: its normal is the cross of two edges
    const ux = -2 * ax - bx, uz = -2 * az - bz, uh = h2 - h1, wx = -2 * ax + bx, wz = -2 * az + bz, wh = h3 - h1;
    const ne = uz * wh - uh * wz, nz = uh * wx - ux * wh, nh = ux * wz - uz * wx;
    const P0 = k.P0, P1 = k.P1;
    P0.e = P1.e; P0.z = P1.z; P0.h = P1.h; P0.ge = P1.ge; P0.gz = P1.gz;
    P1.ge = Math.abs(nh) > 1e-9 ? -ne / nh : 0; P1.gz = Math.abs(nh) > 1e-9 ? -nz / nh : 0;
    P1.e = e; P1.z = z; P1.h = Math.max(h1 - P1.ge * ax - P1.gz * az, groundAt(e, z));
    k.fitT = k.t;
  }
  const planeH = (P, e, z) => P.h + P.ge * (e - P.e) + P.gz * (z - P.z);
  // One move (dt s, AI.kin): speed toward what the brain wants, up to the top speed and to what its power climbs on the
  // slope ahead (a tank of 16 W/kg crawls up 20° at under 3 m/s); a turn at its pivot rate (a wheeled one turns only
  // as it rolls); then along the ground, unless that would put it into another vehicle or a wreck
  function kinStep(v, dt) {
    const a = v.ai, k = a && a.k;
    if (!k || v.dead || v.wreck || a.down) return;
    k.t += dt;
    const c = Math.cos(k.yaw), s = -Math.sin(k.yaw), dir = (k.s || a.want) < 0 ? -1 : 1, P = k.P1;
    const g = (P.ge * c + P.gz * s) * dir, up = Math.max(0, g / Math.sqrt(1 + g * g));
    const vmax = Math.min(k.top, (AI.eta * k.pw) / (GRAV * (up + AI.crr))), want = clamp(a.want || 0, -k.rev, vmax);
    k.s += clamp(want - k.s, -AI.brake * dt, (want > k.s === k.s >= 0 ? AI.acc : AI.brake) * dt);
    if (Math.abs(k.s) < 1e-3 && !want) k.s = 0;
    const dy = wrapAngle((a.yawWant != null ? a.yawWant : k.yaw) - k.yaw), sp = Math.abs(k.s);
    const rate = k.wheeled ? Math.min(0.6, sp / 7) : k.pivot * (1 - 0.4 * Math.min(1, sp / k.top));
    k.w = clamp(dy * 4, -rate, rate);
    k.yaw = wrapAngle(k.yaw + k.w * dt);
    const ne = k.e + k.s * Math.cos(k.yaw) * dt, nz = k.z - k.s * Math.sin(k.yaw) * dt;
    if (blocked(v, k, ne, nz)) k.s = 0;
    else { k.e = ne; k.z = nz; }
    // (standing still, it stops looking at the ground after two fits, and the pose stops too: a parked target costs nothing)
    if (k.s !== 0 || k.w !== 0) k.idle = 0; else k.idle += dt;
    if (k.t - k.fitT >= AI.fit - 1e-9 && k.idle < 2 * AI.fit) fit(v);
    // the belts and wheels, for the 3D model (the outer side runs faster in a turn)
    const bv = v.beltV, half = k.B / 2;
    bv[0] = k.s - k.w * half; bv[1] = k.s + k.w * half;
    for (const q of k.gear) {
      const p = q.p;
      if (p.broken) continue;
      if (p.def.track) p.belt = ((p.belt || 0) + bv[q.side] * dt) % 60;
      else p.spin = ((p.spin || 0) - (bv[q.side] / p.def.awheel.r) * dt) % TAU;
    }
  }
  // would (e, z) put it inside someone (moving closer)? vehicles and wrecks from S.obs, by their circles
  function blocked(v, k, e, z) {
    for (const o of S.obs) {
      if (o.v === v) continue;
      const rr = k.r + o.r, de = e - o.e, dz = z - o.z;
      if (de * de + dz * dz >= rr * rr) continue;
      const pe = k.e - o.e, pz = k.z - o.z;
      if (de * de + dz * dz < pe * pe + pz * pz) return true;
    }
    return false;
  }
  // The pose drawn and hit this frame: the last move carried on for `ahead` s, on the ground's plane (blended from the
  // last fit to this one), the hull square to it, facing its yaw; with its velocity and its turn (no allocation)
  const PU = v3(), PE = v3(), PN = v3(), PF = v3(), PZ = v3();
  function pose(v, ahead) {
    const k = v.ai.k, yaw = k.yaw + k.w * ahead, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const e = k.e + k.s * cy * ahead, z = k.z - k.s * sy * ahead, f = clamp((k.t + ahead - k.fitT) / AI.fit, 0, 1);
    const h = lerp(planeH(k.P0, e, z), planeH(k.P1, e, z), f), ge = lerp(k.P0.ge, k.P1.ge, f), gz = lerp(k.P0.gz, k.P1.gz, f);
    const a = siteAngle(EARTH, e), ph = z / EARTH.radius, ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(ph), sp = Math.sin(ph);
    PU.x = cp * ca; PU.y = cp * sa; PU.z = sp; PE.x = sa; PE.y = -ca; PE.z = 0; PN.x = -ca * sp; PN.y = -sa * sp; PN.z = cp;
    // the ground's normal: up, tipped against its slope east (ge) and north (gz)
    const n = k.n;
    n.x = PU.x - ge * PE.x - gz * PN.x; n.y = PU.y - ge * PE.y - gz * PN.y; n.z = PU.z - ge * PE.z - gz * PN.z;
    const nl = len(n.x, n.y, n.z) || 1; n.x /= nl; n.y /= nl; n.z /= nl;
    // the nose along yaw (east turned toward -north: (cos yaw, -sin yaw) in e, z), square to the normal; the third axis
    PF.x = PE.x * cy - PN.x * sy; PF.y = PE.y * cy - PN.y * sy; PF.z = PE.z * cy - PN.z * sy;
    const fn = PF.x * n.x + PF.y * n.y + PF.z * n.z;
    PF.x -= n.x * fn; PF.y -= n.y * fn; PF.z -= n.z * fn;
    const fl = len(PF.x, PF.y, PF.z) || 1; PF.x /= fl; PF.y /= fl; PF.z /= fl;
    PZ.x = PF.y * n.z - PF.z * n.y; PZ.y = PF.z * n.x - PF.x * n.z; PZ.z = PF.x * n.y - PF.y * n.x;
    basisQ(v.q, PF, n, PZ);
    const r = EARTH.radius + h;
    v.x = PU.x * r + n.x * k.hoff; v.y = PU.y * r + n.y * k.hoff; v.z = PU.z * r + n.z * k.hoff;
    v.vx = PF.x * k.s; v.vy = PF.y * k.s; v.vz = PF.z * k.s;
    k.av.x = n.x * k.w; k.av.y = n.y * k.w; k.av.z = n.z * k.w;
    v.landed = Math.abs(k.s) < 0.3;
  }
  // its centre of mass moved in its parts (a brick or a skirt shot off): the pose follows it, so the parts stay put
  function recentre(v) {
    const k = v.ai.k, dx = v.com.x - k.cx, dy = v.com.y - k.cy, dz = (v.com.z || 0) - k.cz, c = Math.cos(k.yaw), s = Math.sin(k.yaw);
    k.e += dx * c + dz * s; k.z += -dx * s + dz * c; k.hoff += dy;
    k.cx = v.com.x; k.cy = v.com.y; k.cz = v.com.z || 0; k.rest = false;
  }
  // qbasis into q (part x -> a, y -> b, z -> c), without a new quaternion
  function basisQ(q, A, B, C) {
    const m00 = A.x, m10 = A.y, m20 = A.z, m01 = B.x, m11 = B.y, m21 = B.z, m02 = C.x, m12 = C.y, m22 = C.z, tr = m00 + m11 + m22;
    let w, x, y, z;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
    const l = Math.sqrt(w * w + x * x + y * y + z * z) || 1;
    q.w = w / l; q.x = x / l; q.y = y / l; q.z = z / l;
  }

  // ---------------------------------------------------------------- who is where (each frame)
  // S.units: everyone in the fight ({ v, team, e, z, r }: the player on team 0, the live AI); S.obs: what to keep out of
  // (the units and the wrecks)
  const UNITS = [], OBS = [];
  const put = (L, i, v, team, e, z, r) => { const o = L[i] || (L[i] = { v: null, team: 0, e: 0, z: 0, r: 0, d: 0 }); o.v = v; o.team = team; o.e = e; o.z = z; o.r = r; return o; };
  function units(F) {
    S.units = UNITS; S.obs = OBS;
    let nu = 0, no = 0;
    const A = F.active;
    if (A && !F.destroyed && A.parts.length && !A.dead && !A.wreck && A.body === EARTH) {
      eOf(A.x, A.y, A.z, LOC2);
      const r = clamp(0.38 * Math.hypot(A.bounds.maxX - A.bounds.minX, A.bounds.maxZ - A.bounds.minZ), 1.5, 6);
      put(UNITS, nu++, A, S.b ? S.b.team : 0, LOC2.e, LOC2.z, r); put(OBS, no++, A, 0, LOC2.e, LOC2.z, r);
    }
    for (const v of S.ai) if (!v.dead && !v.ai.down) { const k = v.ai.k; put(UNITS, nu++, v, v.ai.team, k.e, k.z, k.r); put(OBS, no++, v, v.ai.team, k.e, k.z, k.r); }
    for (const w of F.vessels) {
      if (!w.wreck || w.dead || !w.parts.length) continue;
      if (w.ai && w.ai.k) put(OBS, no++, w, -1, w.ai.k.e, w.ai.k.z, w.ai.k.r);
      else { eOf(w.x, w.y, w.z, LOC2); put(OBS, no++, w, -1, LOC2.e, LOC2.z, 3.5); }
    }
    UNITS.length = nu; OBS.length = no;
  }
  const LOC2 = { e: 0, z: 0 };

  // ---------------------------------------------------------------- decisions (4 times a second)
  function think(v, F) {
    const a = v.ai, k = a.k;
    if (a.role === 'parked' || a.role === 'idle') { a.want = 0; a.tgt = null; a.state = a.role; return; }
    if (a.role === 'patrol') { patrol(v); a.tgt = null; return; }
    // its weapon: out of rounds or broken, the next one; none left, home. A crew mends a breech: then it takes that gun
    // up again (and leaves for the fight, unless its crew is what sent it home), as it does its main gun once mended
    const g0 = a.gun, sys = Combat.systems(v), cur = g0 ? sys.findIndex((s) => s.parts.includes(g0)) : -1;
    if (cur < 0 || g0.broken || !(g0.ammo > 0 || g0.stow > 0 || g0.reload > 0)) arm(v);
    else { a.sys = v.wsel = cur; const i = mainOf(v); if (i >= 0 && i !== cur && rankOf(sys[i]) > rankOf(sys[cur])) arm(v); }
    if (!a.gun) { if (!a.home) { a.home = true; a.homeWhy = 'gun'; } }
    else if (a.home && a.homeWhy === 'gun') { a.home = false; a.homeWhy = null; }
    if (a.gun && a.gun !== g0 && a.tgt) pickRound(v, F);
    // hit: half the time it pops its smoke (once in 20 s) and backs off behind it for a few seconds
    if (v.hurtAt != null && v.hurtAt !== a.hurt) {
      a.hurt = v.hurtAt;
      if (F.time - (a.smokeAt ?? -99) > 20 && S.rnd() < 0.5 && Aim.smoke(v, F)) { a.smokeAt = F.time; if (a.role === 'fight') { a.revT = 4; a.blockDir = -a.blockDir; } }
    }
    if (a.revT > 0 && a.role === 'fight') { steer(v, F, null, 0); return; } // (backing off: steer's first line)
    target(v, F);
    const C = typeof Armour !== 'undefined' ? Armour.crewOf(v) : null, crew = C && C.crew.length ? C.crew.filter((e) => e.alive).length / C.crew.length : 1;
    if (crew < AI.retreat && a.homeWhy !== 'crew') { a.home = true; a.homeWhy = 'crew'; a.spot = null; }
    let goal = null, speed = k.top * 0.9;
    // falling back (its crew down to under 40%): home to its pad without stopping, and once there it fights from it
    const H = a.home ? homeOf(v) : null, home = !!H && Math.hypot(H.e - k.e, H.z - k.z) < 40;
    if (H && !home && a.role === 'fight') { a.state = 'retreat'; a.cover = a.coverFor = a.flank = null; steer(v, F, H, speed); return; }
    const guard = a.role === 'guard' || home; // (one that fights where it stands: it never drives off)
    if (a.tgt && a.seen && a.tD <= AI.engage) {
      // a firing spot behind cover (the nearest berm, on its far side from the target), then stop and shoot
      if (a.coverFor !== a.tgt) { a.coverFor = a.tgt; a.cover = guard ? null : coverFor(v, a.tgt); a.flank = null; a.flankReq = false; }
      // three rounds and the target no worse for them (they bounce off its front): off round its side, 150 m across the
      // line between them, for a shot at thinner plate (at most 25 s at it)
      if (a.flankReq && !guard) {
        a.flankReq = false;
        const te = a.tgtU.e - k.e, tz = a.tgtU.z - k.z, tl = Math.hypot(te, tz) || 1, sd = (a.flankSide = -(a.flankSide || 1));
        const fe = k.e + (-tz / tl) * 150 * sd + (te / tl) * 60, fz = k.z + (te / tl) * 150 * sd + (tz / tl) * 60;
        if (!wetAt(fe, fz)) { a.flank = { e: fe, z: fz, until: F.time + 25 }; a.cover = null; }
      }
      if (a.flank && (F.time > a.flank.until || Math.hypot(a.flank.e - k.e, a.flank.z - k.z) < 8)) a.flank = null;
      if (a.cover && a.cover.until && F.time > a.cover.until) a.cover = null; // (a few metres on or back: 10 s at most)
      if (a.flank) { goal = a.flank; speed = k.top * 0.8; a.state = 'flank'; }
      else if (a.cover && Math.hypot(a.cover.e - k.e, a.cover.z - k.z) > 4) { goal = a.cover; speed = k.top * 0.6; a.state = 'cover'; }
      else {
        a.state = 'engage'; a.want = 0; a.progT = 0; a.revT = 0;
        flight(v);
        // turn the hull to the target: a gun with no turret must, and a turret's tank shows it its front plate
        const t = a.tgtU, bear = Math.atan2(-(t.z - k.z), t.e - k.e), off = Math.abs(wrapAngle(bear - k.yaw));
        // its gun held off the target by a limit for 1.5 s (the hull pitched on a slope, a turret at the end of its arc,
        // the deck in the way): it turns its hull to the target, and once it faces it, moves 12 m to where its gun
        // reaches (leaving that firing spot for good against this target). A round that would meet the ground well
        // short of the target (aimFrame looks along its path): 10 m on, and the next time, round the target's side
        a.limT = a.gun && a.gun._lim && F.time > a.reactAt ? a.limT + AI.think : 0;
        const fix = a.limT > AI.limit;
        a.yawWant = a.turretless || off > 25 * RAD || fix ? bear : k.yaw;
        if (!guard && ((fix && off < 8 * RAD) || a.pathBlk)) {
          const P = a.pathBlk ? (++a.pathN < 2 ? ahead(v, F, 10) : null) : shiftFor(v, F);
          if (a.pathBlk && !P) a.flankReq = true;
          if (a.cover && a.cover.b) { a.badB = a.cover.b; a.badFor = a.tgt; }
          a.cover = P; a.limT = 0; a.pathBlk = 0;
        } else if (k.wheeled && (a.turretless || fix) && Math.abs(wrapAngle(a.yawWant - k.yaw)) > 6 * RAD) a.want = 3; // (a wheeled one turns only as it rolls: on at a crawl)
        return;
      }
    } else {
      a.cover = null; a.coverFor = null;
      goal = guard ? null : objective(v, F);
      a.state = goal ? 'move' : 'hold';
      if (!guard && a.tgt && !a.seen && F.time - a.lostAt < AI.lost) { goal = a.tgtU; a.state = 'hunt'; } // (after it where it was last seen)
    }
    steer(v, F, goal, speed);
  }
  // A spot 12 m back, ahead or to either side of it (across the line to the target) its gun would reach the target
  // from: its hull's pitch there along that line (the ground under its front and rear) against the gun's elevation
  // limits, the target's height and the round's drop; the best of the four, dry and clear of the others. Back: in reverse.
  const SHIFT = [[-12, 0], [12, 0], [0, 12], [0, -12]], TP = v3();
  function shiftFor(v, F) {
    const a = v.ai, k = a.k, M = a.gun, el = M && M.def.aim && M.def.aim.el, t = a.tgt;
    if (!el || !t) return null;
    const te = a.tgtU.e - k.e, tz = a.tgtU.z - k.z, D0 = Math.hypot(te, tz) || 1, ce = te / D0, cz = tz / D0;
    const T = Aim.trunnion(v, M, TP), gh = Math.hypot(T.x, T.y, T.z) - EARTH.radius - groundAt(k.e, k.z), ht = Math.hypot(t.x, t.y, t.z) - EARTH.radius + 0.5;
    let best = null, bm = -Infinity;
    for (const [f, sd] of SHIFT) {
      const e = k.e + ce * f - cz * sd, z = k.z + cz * f + ce * sd, D = Math.hypot(a.tgtU.e - e, a.tgtU.z - z) || 1;
      if (S.obs.some((o) => o.v !== v && Math.hypot(o.e - e, o.z - z) < o.r + k.r + 1) || wetAt(e, z)) continue;
      const h0 = groundAt(e - ce * k.L, z - cz * k.L), h1 = groundAt(e + ce * k.L, z + cz * k.L);
      const need = Math.atan2(ht - (h0 + h1) / 2 - gh, D) + (GRAV / 2) * a.tof * a.tof / D - Math.atan2(h1 - h0, 2 * k.L), m = Math.min(need - el[0] * RAD, el[1] * RAD - need);
      if (m > bm) { bm = m; best = { e, z, rev: f < 0, until: F.time + 10 }; }
    }
    return best;
  }
  // d m on toward the target (dry), or null
  function ahead(v, F, d) {
    const a = v.ai, k = a.k, te = a.tgtU.e - k.e, tz = a.tgtU.z - k.z, D = Math.hypot(te, tz) || 1, e = k.e + (te / D) * d, z = k.z + (tz / D) * d;
    return wetAt(e, z) ? null : { e, z, until: F.time + 10 };
  }
  // the round's time of flight to the target (for the lead), worked out here, 4 times a second, not each frame
  function flight(v) {
    const a = v.ai, M = a.gun, sh = M && M.def.weapon && M.def.weapon.shells, key = sh ? (M.shellSel && sh.includes(M.shellSel) ? M.shellSel : sh[0]) : null;
    const so = key && a.tgt && typeof Aim !== 'undefined' ? Aim.solve(key, a.tD, 0, EARTH) : null;
    a.tof = so ? so.t : 0;
  }
  // the patrol: round the loop's waypoints at its cruise
  function patrol(v) {
    const a = v.ai, k = a.k, W = loopPt(a.wp);
    if (Math.hypot(W.e - k.e, W.z - k.z) < 12) a.wp = (a.wp + 1) % LOOP.n;
    steer(v, S.F, loopPt(a.wp), a.cruise || 5);
    a.state = 'patrol';
  }
  const LP = { e: 0, z: 0 };
  // one on the loop at waypoint i, facing the next
  function patroller(F, key, i, speed) {
    const n = loopPt((i + 1) % LOOP.n), ne = n.e, nz = n.z, p = loopPt(i), v = spawn(F, key, p.e, p.z, Math.atan2(-(nz - p.z), ne - p.e), 1, 'patrol', { speed });
    if (v) v.ai.wp = (i + 1) % LOOP.n;
    return v;
  }
  function loopPt(i) { const t = (i / LOOP.n) * TAU; LP.e = LOOP.e + Math.sin(t) * LOOP.r; LP.z = LOOP.z + Math.cos(t) * LOOP.r; return LP; }
  // Head for goal (e, z) at about speed: around vehicles and wrecks in the way, away from water and ground too steep
  // 25 m ahead, backing off and turning when stuck for 3 s. Sets a.want (m/s) and a.yawWant.
  function steer(v, F, goal, speed) {
    const a = v.ai, k = a.k;
    if (a.revT > 0) { a.revT -= AI.think; a.want = -Math.min(3, k.rev); a.yawWant = k.yaw + a.blockDir * 0.5; return; }
    if (!goal) { a.want = 0; a.progT = 0; return; }
    const de = goal.e - k.e, dz = goal.z - k.z, d = Math.hypot(de, dz);
    if (d < 3) { a.want = 0; a.progT = 0; return; }
    let yw = Math.atan2(-dz, de), slow = 1;
    // (a few metres back from a firing spot: in reverse, its front kept to the target)
    if (goal.rev && Math.abs(wrapAngle(yw - k.yaw)) > 2) { a.yawWant = wrapAngle(yw + Math.PI); a.want = -Math.min(3, k.rev) * Math.min(1, d / 8); a.progT = 0; return; }
    // others in the way (within 30 m ahead, inside a lane as wide as both of them and a gap): steer round, slow down
    for (const o of S.obs) {
      if (o.v === v) continue;
      const oe = o.e - k.e, oz = o.z - k.z, od = Math.hypot(oe, oz);
      if (od > 30 || od > d + o.r) continue;
      const fw = oe * Math.cos(yw) - oz * Math.sin(yw), lat = oe * Math.sin(yw) + oz * Math.cos(yw), lane = k.r + o.r + 2.5;
      if (fw <= 0 || Math.abs(lat) >= lane) continue;
      yw += (lat > 0 ? 1 : -1) * 0.8 * (1 - Math.abs(lat) / lane);
      slow = Math.min(slow, clamp((fw - k.r - o.r) / 15, 0.15, 1));
    }
    // a look ahead every 0.5 s: water there, or too steep to climb (its own limit, at most 22°): swing off to one side
    // for 2 s (the other side if that side is no better)
    if ((a.lookT -= AI.think) <= 0) {
      a.lookT += AI.look;
      const c = Math.cos(yw), s = -Math.sin(yw), le = k.e + c * AI.ahead, lz = k.z + s * AI.ahead;
      const h0 = planeH(k.P1, k.e, k.z), bad = wetAt(le, lz) || Math.abs(groundAt(le, lz) - h0) > Math.tan(k.climb) * AI.ahead;
      if (bad) { if (a.block > 0) a.blockDir = -a.blockDir; a.block = 2; } else if (a.block > 0) a.block -= AI.look;
    }
    if (a.block > 0) yw = yw + a.blockDir * 60 * RAD;
    const off = Math.abs(wrapAngle(yw - k.yaw));
    a.yawWant = yw;
    a.want = speed * slow * Math.min(1, d / 20) * (off > 1.2 ? (k.wheeled ? 0.35 : 0) : off > 0.5 ? 0.5 : 1); // (a tracked one turns on the spot first)
    // stuck: wanting to go (over 1 m/s) for 3 s, but under 1.5 m on: back off for 2.5 s, turning
    if (a.want <= 1) { a.progT = 0; return; }
    if (a.progT <= 0) { a.progT = AI.stuck; a.progE = k.e; a.progZ = k.z; }
    else if ((a.progT -= AI.think) <= 0 && Math.hypot(k.e - a.progE, k.z - a.progZ) < 1.5) { a.revT = AI.back; a.blockDir = -a.blockDir; a.want = -Math.min(3, k.rev); }
  }
  // Whom to fight: the nearest enemy it sees (Aim.sees; a thermal sight sees through smoke), or one a teammate spotted,
  // within 1.5 km; the one it has stays while it is still seen (and 200 m further). A new one: the reaction time starts,
  // the aim's error is rolled again, and the round picked (AP at armour, HE at soft ones). Sight is costly: a decision
  // takes one fresh look at most (its target first, else the nearest other not looked at for a second); the rest is
  // what it saw lately, or what the one it looks at saw of it (the line is the same both ways: Aim.sees' both)
  const CAND = [];
  function target(v, F) {
    const a = v.ai, k = a.k, th = a.seeO || (a.seeO = { thermal: !!a.thermal, t: 0, both: true });
    th.t = F.time || 0; // (who sees whom is remembered on the sim's clock)
    S.fresh = 1;
    let n = 0;
    for (const u of S.units) {
      if (u.team === a.team || u.v === v) continue;
      const d = Math.hypot(u.e - k.e, u.z - k.z);
      if (d > AI.see + (u.v === a.tgt ? 200 : 0)) continue;
      CAND[n++] = u; u.d = d;
    }
    CAND.length = n;
    if (n > 1) CAND.sort((x, y) => x.d - y.d);
    let best = null;
    const cur = a.tgt && CAND.find((u) => u.v === a.tgt);
    if (cur && sees(v, cur.v, th, F, 0.5)) best = cur;
    else for (let i = 0; i < Math.min(n, 3) && !best; i++) if (CAND[i].v !== a.tgt && sees(v, CAND[i].v, th, F, 1)) best = CAND[i];
    if (best) {
      if (best.v !== a.tgt) { a.tgt = best.v; a.reactAt = F.time + a.react; a.errAt = -9; a.onN = 0; a.nShot = 0; a.limT = 0; a.pathBlk = 0; a.pathN = 0; a.soft = softOf(best.v); pickRound(v, F); }
      a.tgtU.e = best.e; a.tgtU.z = best.z;
      a.seen = true; a.tD = best.d; a.lostAt = F.time;
    } else {
      a.seen = false;
      if (a.tgt && (F.time - a.lostAt > AI.lost || a.tgt.dead || a.tgt.wreck || (a.tgt.ai && a.tgt.ai.down) || (a.tgt === F.active && F.destroyed))) a.tgt = null;
    }
    // no clear shot through a teammate in the way (within 5 m of the line, nearer than the target)
    a.clear = true;
    if (a.tgt && a.seen) for (const u of S.units) {
      if (u.team !== a.team || u.v === v) continue;
      const te = a.tgtU.e - k.e, tz = a.tgtU.z - k.z, tl = Math.hypot(te, tz) || 1, ue = u.e - k.e, uz = u.z - k.z, along = (ue * te + uz * tz) / tl;
      if (along > 0 && along < tl && Math.abs(ue * tz - uz * te) / tl < u.r + 2) { a.clear = false; break; }
    }
  }
  const spotted = (o, a, F) => a.team === (S.b ? S.b.team : 0) && o._gaiSpot > F.time;
  // does v see o: spotted for it, else what it saw within ttl s, else a fresh look if this decision has one left
  function sees(v, o, th, F, ttl) {
    if (spotted(o, v.ai, F)) return true;
    const r = Aim.known(v, o, th.thermal, th.t, ttl);
    if (r != null || !S.fresh) return !!r;
    S.fresh = 0;
    return Aim.sees(v, o, th);
  }
  // soft: something an HE round does more to than a solid one (no armour plate: a car; or an open-topped turret)
  const softOf = (o) => !o.plated || o.parts.some((p) => p.def.style === 'open');
  // the round for the target: the gun's best piercing one at armour, its high explosive at a soft target
  function pickRound(v, F) {
    const a = v.ai, s = a.sys >= 0 && Combat.systems(v)[a.sys];
    if (!s || s.w.kind !== 'tgun' || !s.w.shells || s.w.shells.length < 2) return;
    const L = s.w.shells, sh = (k) => SHELLS[k] || {};
    let want = 0;
    for (let i = 1; i < L.length; i++) {
      if (a.soft ? (sh(L[i]).he || 0) > (sh(L[want]).he || 0) : (sh(L[i]).he ? -1 : sh(L[i]).pen || 0) > (sh(L[want]).he ? -1 : sh(L[want]).pen || 0)) want = i;
    }
    const p = s.parts[0], cur = p.shellNext || (p.shellSel && L.includes(p.shellSel) ? p.shellSel : L[0]);
    if (cur !== L[want]) Aim.select(v, want, F);
  }
  // a firing spot: behind the nearest berm within 120 m that stands between it and the target (7 m off the berm's middle,
  // on its side; within 1.2 km of the target)
  function coverFor(v, t) {
    const k = v.ai.k, A = arenaOf(), u = S.units.find((q) => q.v === t);
    if (!u) return null;
    let best = null, bd = AI.cover;
    for (const b of (A && A.berms) || []) {
      if (b === v.ai.badB && t === v.ai.badFor) continue; // (its gun couldn't reach this target from there)
      const px = -b.s, pz = b.c, side = (b.e - u.e) * px + (b.z - u.z) * pz > 0 ? 1 : -1;
      if (((k.e - b.e) * px + (k.z - b.z) * pz) * side < -2) continue; // (it would have to cross the berm to get there)
      const e = b.e + px * 7 * side, z = b.z + pz * 7 * side, d = Math.hypot(e - k.e, z - k.z);
      if (d < bd && Math.hypot(u.e - e, u.z - z) <= AI.engage) { bd = d; best = { e, z, b }; }
    }
    return best;
  }
  const arenaOf = () => (S.b ? GroundMode.arena(S.b.arena) : GroundMode.arena('highland'));
  // where to go with no one to shoot: the nearest zone its side doesn't hold (shared out among its team), into it; in the
  // range's hostile waves, a zone first, then after the player
  function objective(v, F) {
    const a = v.ai, k = a.k, B = S.b;
    if (!B) {
      const A = arenaOf(), Z = (A && A.zones) || [];
      if (!a.zone && Z.length) { let bz = null, bd = Infinity; for (const zn of Z) { const d = Math.hypot(zn.e - k.e, zn.z - k.z); if (d < bd) { bd = d; bz = zn; } } a.zone = bz; }
      if (a.zone && !a.reached && Math.hypot(a.zone.e - k.e, a.zone.z - k.z) < a.zone.r * 0.6) a.reached = true;
      if (a.zone && !a.reached) return a.zone;
      const p = S.units.find((u) => u.team !== a.team);
      return p ? { e: p.e, z: p.z } : null;
    }
    const Z = B.obj.zones;
    let bz = null, bs = Infinity;
    for (const zn of Z) {
      if (zn.own === a.team && zn.p === (a.team ? 1 : -1)) continue; // (all ours)
      let n = 0;
      for (const o of S.ai) if (o !== v && !o.ai.down && o.ai.team === a.team && o.ai.zone === zn) n++;
      const sc = Math.hypot(zn.e - k.e, zn.z - k.z) + 350 * n;
      if (sc < bs) { bs = sc; bz = zn; }
    }
    if (!bz) { // everything is ours: hold the one nearest the enemy's pad
      const A = GroundMode.arena(B.arena), ep = A && A.pads[1 - a.team];
      for (const zn of Z) { const d = ep ? Math.hypot(zn.e - ep.e, zn.z - ep.z) : 0; if (d < bs) { bs = d; bz = zn; } }
    }
    if (bz !== a.zone) { a.zone = bz; a.spot = null; }
    if (!bz) return null;
    if (!a.spot) { const t = S.rnd() * TAU, r = bz.r * 0.45 * Math.sqrt(S.rnd()); a.spot = { e: bz.e + Math.cos(t) * r, z: bz.z + Math.sin(t) * r }; }
    return a.spot;
  }
  function homeOf(v) {
    const A = arenaOf(), team = v.ai.team, f = A && A.pads && A.pads[team ? 1 : 0];
    return f ? { e: f.e, z: f.z } : null;
  }

  // ---------------------------------------------------------------- aim and fire (each frame)
  // The point it wants its guns on: the target's middle (raised half a metre), led for its motion over the round's
  // flight, off by its error; it fires once it has reacted, stands still, sees the target within 1.2 km with no teammate
  // in the way, and the gun is on (within 0.4°, an automatic gun 1.2°) and ready. Practice targets never fire.
  function aimFrame(v, F) {
    const a = v.ai, t = a.tgt;
    if ((a.role !== 'fight' && a.role !== 'guard') || !t || a.down || v.ko || t.dead || F.time < a.reactAt || (S.b && S.b.over)) { v.aimP = null; v.aimFire = v.mgFire = false; a.onN = 0; return; }
    const P = a.P, k = a.k, M = a.gun, tx = t.x, ty = t.y, tz = t.z, r = len(tx, ty, tz) || 1, ux = tx / r, uy = ty / r, uz = tz / r;
    let dx = tx - v.x, dy = ty - v.y, dz = tz - v.z;
    const D = len(dx, dy, dz) || 1;
    dx /= D; dy /= D; dz /= D;
    // the error: a fresh roll after each shot (and every 4 s), across the line of sight (e1 level, e2 up it); the first
    // round at a new target goes 2.5 times as wide (it is ranging), so a tank caught in the open has a moment to react
    const fired = !!M && M.shotAt != null && M.shotAt !== a.shot;
    if (fired) { // (every third main-gun round at it: is it any worse? if not, it's time to go round its side)
      a.nShot++;
      if (M.def.weapon.kind === 'tgun' && a.nShot % 3 === 1) { const hp = Combat.integrity(t); if (a.nShot > 1 && hp >= a.hp0 - 0.002) a.flankReq = true; a.hp0 = hp; }
    }
    if (M && (fired || F.time - a.errAt > 4)) {
      a.shot = M.shotAt; a.errAt = F.time;
      const m = a.errK * (a.nShot ? 1 : 2.5) * Math.sqrt(S.rnd()), q = S.rnd() * TAU;
      a.ea = Math.cos(q) * m; a.eb = Math.sin(q) * m;
    }
    let e1x = dy * uz - dz * uy, e1y = dz * ux - dx * uz, e1z = dx * uy - dy * ux;
    const el = len(e1x, e1y, e1z) || 1; e1x /= el; e1y /= el; e1z /= el;
    const e2x = e1y * dz - e1z * dy, e2y = e1z * dx - e1x * dz, e2z = e1x * dy - e1y * dx, ka = a.ea * D, kb = a.eb * D, tof = a.tof;
    P.x = tx + ux * 0.5 + (t.vx - v.vx) * tof + e1x * ka + e2x * kb;
    P.y = ty + uy * 0.5 + (t.vy - v.vy) * tof + e1y * ka + e2y * kb;
    P.z = tz + uz * 0.5 + (t.vz - v.vz) * tof + e1z * ka + e2z * kb;
    const was = v.aimP === P;
    v.aimP = P;
    // on target this frame and the last (so an angle left from an earlier aim never fires a round)
    const w = M && M.def.weapon, auto = !!w && w.kind === 'agun', on = was && !!M && !M.broken && M._err != null && M._err < (auto ? AI.tolAuto : AI.tol) && !M._lim;
    a.onN = on ? a.onN + 1 : 0;
    let ready = !!w && M.ammo > 0 && !(w.kind === 'tgun' && M.reload > 0);
    if (w && w.kind === 'missile' && Aim.guiding(v) > 0) ready = false; // (one missile on the wire at a time)
    const go = a.seen && a.tD <= AI.engage && Math.abs(k.s) < 0.6 && a.clear && a.onN >= 2;
    // and the round's path clear of the ground till 10 m short of the target (the muzzle sits lower than the eye that
    // sees over a crest): looked along once a second at most, and only when all else says fire
    if (go && ready && w.kind !== 'missile' && (F.time - a.pathT >= 1 || F.time < a.pathT || a.pathFor !== t)) {
      a.pathT = F.time; a.pathFor = t; a.pathOk = !pathBlocked(v, M, D - 10);
      if (!a.pathOk) a.pathBlk = 1;
    }
    v.aimFire = go && ready && (w.kind === 'missile' || a.pathOk);
    v.mgFire = go && a.soft && a.tD < 600;
  }

  // Where gun M's round, fired now, meets the ground within D m of the muzzle (m along it), else 0: its barrel's line
  // dropping as the round falls, against the physics' ground (what shells hit), every 2 m near the gun, out to every
  // 20 m; every metre where the line runs within a metre of the ground, and every 0.75 m over a berm's top (as shells
  // look: a line grazing a crest crosses it in a couple of metres)
  const PM = v3(), PD = v3(), PL = {}, PEZ = { e: 0, z: 0 }, BS = [0, 0];
  let pP = null, pU = null, pV0 = 800, pUx = 0, pUy = 0, pUz = 0;
  function gapAt(s) {
    const q = 4.905 * (s / pV0) * (s / pV0);
    Terrain.locate(EARTH, pP.x + pU.x * s - pUx * q, pP.y + pU.y * s - pUy * q, pP.z + pU.z * s - pUz * q, PL);
    S.calls++;
    return PL.r - EARTH.radius - Terrain.surfaceAt(EARTH, PL.a, PL.z);
  }
  function pathBlocked(v, M, D) {
    const w = M.def.weapon, L = w.shells, key = L ? (M.shellSel && L.includes(M.shellSel) ? M.shellSel : L[0]) : null;
    pV0 = (key && SHELLS[key] && SHELLS[key].v0) || 800; pP = Aim.muzzle(v, M, PM); pU = Aim.dir(v, M, PD);
    const r0 = Math.hypot(pP.x, pP.y, pP.z) || 1;
    pUx = pP.x / r0; pUy = pP.y / r0; pUz = pP.z / r0;
    eOf(pP.x, pP.y, pP.z, PEZ);
    const e0 = PEZ.e, z0 = PEZ.z;
    eOf(pP.x + pU.x * D, pP.y + pU.y * D, pP.z + pU.z * D, PEZ);
    if (bermOn(e0, z0, PEZ.e, PEZ.z)) for (let s = BS[0] * D; s < BS[1] * D; s += 0.75) if (s > 1 && gapAt(s) < 0) return s;
    for (let s = 2, prev = 0, cp = Infinity; s < D; prev = s, s += clamp(s * 0.25, 2, 20)) {
      const c = gapAt(s);
      if (c < 0) return s;
      if (Math.min(c, cp) < 1) for (let q = prev + 1; q < s; q++) if (gapAt(q) < 0) return q;
      cp = c;
    }
    return 0;
  }
  // the stretch of the line (e0, z0) -> (e1, z1) over the top of one of the arena's berms (within 8 m of its ridge, along
  // its 26 m), as fractions into BS; false over none
  let bT0 = 0, bT1 = 1;
  function slab(p0, p1, m) { const dp = p1 - p0; if (Math.abs(dp) < 1e-9) { if (Math.abs(p0) >= m) bT1 = -1; return; } const ta = (-m - p0) / dp, tb = (m - p0) / dp; bT0 = Math.max(bT0, Math.min(ta, tb)); bT1 = Math.min(bT1, Math.max(ta, tb)); }
  function bermOn(e0, z0, e1, z1) {
    const A = EARTH.mapped && arenaOf(), Lb = A && A.berms, BM = Terrain.BERM;
    if (!Lb || !Lb.length || !BM) return false;
    let lo = 2, hi = -1;
    for (const q of Lb) {
      const de0 = e0 - q.e, dz0 = z0 - q.z, de1 = e1 - q.e, dz1 = z1 - q.z;
      bT0 = 0; bT1 = 1;
      slab(de0 * q.c + dz0 * q.s, de1 * q.c + dz1 * q.s, BM.half);
      slab(-de0 * q.s + dz0 * q.c, -de1 * q.s + dz1 * q.c, 8);
      if (bT0 < bT1) { lo = Math.min(lo, bT0); hi = Math.max(hi, bT1); }
    }
    if (hi < lo) return false;
    BS[0] = lo; BS[1] = hi;
    return true;
  }

  // ---------------------------------------------------------------- knocked out (Combat.aiDown) and back again
  function score(F, v) {
    const R0 = S.range, A = F.active, d = A ? len(A.x - v.x, A.y - v.y, A.z - v.z) : 0;
    if (!R0) return;
    R0.kos++; R0.best = Math.max(R0.best, d);
    if (R0.kos >= 3 && F.award && A && isGround(A.kind)) F.award('tankRange');
  }
  function wreckOf(v, F) {
    if (!v.parts.length || v.dead) return;
    v.wreck = true; v.aimP = null; v.aimFire = v.mgFire = false; v.vx = v.vy = v.vz = 0;
    if (v.av) { v.av.x = v.av.y = v.av.z = 0; }
    S.wrecks.push({ v, t: F.time || 0 });
    while (S.wrecks.length > BATTLE.wrecks) { const w = S.wrecks.shift(); if (w.v !== F.active) w.v.dead = true; }
  }
  // what comes after a knock-out: a range target 45 s later somewhere else; a battle's AI 5 s later on its pad, if its
  // side has tickets
  function after(v, F) {
    const a = v.ai, R0 = S.range, B = S.b;
    if (R0 && R0.mode === 'practice') S.dead.push({ key: a.key, role: a.role, speed: a.cruise, at: (F.time || 0) + RANGE.back, wreck: v, team: a.team });
    else if (R0 && R0.left) { R0.left = R0.left.filter((o) => o !== v); if (!R0.left.length) { R0.waveAt = (F.time || 0) + RANGE.gap; say(F, `Wave ${R0.wave} cleared: the next in ${RANGE.gap} s`, 'info'); } }
    else if (B && !B.over) S.dead.push({ key: a.key, role: 'fight', at: (F.time || 0) + BATTLE.respawn, team: a.team });
  }
  // a free spot on team's pad for one more vehicle (the first of its six where nobody stands within 9 m)
  function padSpot(arena, team, kind) {
    for (let i = 0; i < 6; i++) {
      const P = GroundMode.placement(arena, team, i, kind);
      if (P && !S.obs.some((o) => Math.hypot(o.e - P.e, o.z - P.z) < 9)) return P;
    }
    return GroundMode.placement(arena, team, 0, kind);
  }
  // a fresh spot for a range target somewhere else: dry, gentle, 400 m clear of the player and 60 m of the others
  function rangeSpot(F) {
    const B = EARTH.arenas.highland.box, A = S.units.find((u) => u.v === F.active);
    for (let i = 0; i < 40; i++) {
      const e = 16800 + S.rnd() * 1900, z = 14250 + S.rnd() * 1500;
      if (A && Math.hypot(A.e - e, A.z - z) < RANGE.near) continue;
      if (S.obs.some((o) => Math.hypot(o.e - e, o.z - z) < 60)) continue;
      const h = groundAt(e, z);
      if (wetAt(e, z) || Math.abs(groundAt(e + 8, z) - h) > 1.6 || Math.abs(groundAt(e, z + 8) - h) > 1.6 || e < B.e0 || e > B.e1) continue;
      return { e, z, yaw: S.rnd() * TAU };
    }
    return null;
  }

  // ---------------------------------------------------------------- the Tank Range
  // Its own: a ground vehicle (Armour, or a car with aimed guns) on Earth with the map in, within 4 km of Highland
  // Ridge's middle, solo, targets not off, no Practice Battle on
  function rangeWanted(F) {
    const v = F.active;
    if (!v || S.b || mpOn() || targetsMode() === 'off' || v.body !== EARTH || !mapReady()) return false;
    if (!(v.kind === 'tank' || (v.kind === 'car' && v.aimed && v.aimed.length))) return false;
    eOf(v.x, v.y, v.z, LOC2);
    return Math.hypot(LOC2.e - 17750, LOC2.z - 15000) < RANGE.r;
  }
  // anti-aircraft weapons aboard: an aimed automatic gun of 20 mm and up that climbs past 60°, a SAM, a tracking radar
  const hasAA = (v) => !!v && v.parts.some((p) => {
    const d = p.def, w = d.weapon;
    return !!d.trackRadar || (!!d.aim && !!w && ((w.kind === 'agun' && (w.cal || 0) >= 20 && d.aim.el && d.aim.el[1] >= 60) || (w.kind === 'missile' && (w.seek === 'air' || w.seek === 'clos'))));
  });
  // the drones the range flies for an AA vehicle: range targets (Combat's own kind), circling north of the pad
  function drone(R0, i) {
    const def = TARGET_KINDS.drone, rad = DRONES.r[0] + S.rnd() * (DRONES.r[1] - DRONES.r[0]), ang = (i / 2) * TAU + S.rnd(), alt = DRONES.alt[0] + S.rnd() * (DRONES.alt[1] - DRONES.alt[0]);
    const t = R0.drones[i] || (R0.drones[i] = {});
    Object.assign(t, { kind: 'drone', def, hp: def.hp, alive: true, heading: 0, turnT: 1e9, fireT: 0, burst: 0, firing: false, gai: true, gone: false,
      cx: DRONES.e + (i ? 300 : -300), cz: DRONES.z, rad, ang, alt, dir: i ? -1 : 1, deadAt: undefined, lastHitBy: null });
    t.e = t.cx + Math.cos(ang) * rad; t.z = t.cz + Math.sin(ang) * rad;
    const a = siteAngle(EARTH, t.e), ph = t.z / EARTH.radius, h = Math.max(alt, groundAt(t.e, t.z) + 200), rr = EARTH.radius + h;
    t.pos = { x: rr * Math.cos(ph) * Math.cos(a), y: rr * Math.cos(ph) * Math.sin(a), z: rr * Math.sin(ph) }; t.h = h; t.vel = { x: 0, y: 0, z: 0 };
    if (!Combat.S.targets.includes(t)) Combat.S.targets.push(t);
    return t;
  }
  function rangeStep(F, dt) {
    const R0 = S.range, now = F.time || 0;
    // knocked-out drones (Combat's hitTarget): counted, back 45 s later
    for (let i = 0; i < R0.drones.length; i++) {
      const t = R0.drones[i];
      if (!t.alive && !t.gone) { t.gone = true; t.backAt = now + RANGE.back; if (t.lastHitBy === F.active) score(F, { x: t.pos.x, y: t.pos.y, z: t.pos.z }); }
      else if (t.gone && now >= t.backAt) drone(R0, i);
      else if (t.alive && !Combat.S.targets.includes(t)) Combat.S.targets.push(t); // (the old range came back and dropped them)
    }
    if (R0.mode === 'hostile' && !F.destroyed) {
      if (!R0.left.length && now >= R0.waveAt) wave(F);
      // an attack plane every 3 minutes for an AA vehicle to shoot at (Combat's own fighter: it hunts the player)
      if (R0.aa && now >= R0.planeAt) {
        R0.planeAt = now + RANGE.plane;
        if (!F.vessels.some((o) => o.gaiPlane && !o.dead && o.control)) { const p = Combat.spawnFighter(F); if (p) { p.gaiPlane = true; p.name = 'Attack plane'; say(F, 'Enemy aircraft inbound!', 'warn'); } }
      }
    }
    void dt;
  }
  // a Hostile wave from the south pad: min(2 + n, 5) vehicles that fight, picked from the stock ground vehicles priced
  // within 40% of the player's (the nearest three by price when none is), placed on the pad's spots
  function wave(F) {
    const R0 = S.range, n = Math.min(2 + ++R0.wave, 5), me = F.active ? designCost(F.active.parts) : 30000;
    const pool = Object.keys(TEMPLATES).filter((k) => { const t = TEMPLATES[k]; return t.kind === 'tank' && fighter(k); });
    const cost = (k) => { const T = tplOf(k); if (!T.cost) T.cost = designCost(partsFromDesign(T.rows)); return T.cost; };
    let fit = pool.filter((k) => cost(k) >= me * 0.6 && cost(k) <= me * 1.4);
    if (!fit.length) fit = pool.sort((x, y) => Math.abs(cost(x) - me) - Math.abs(cost(y) - me)).slice(0, 3);
    R0.left = [];
    for (let i = 0; i < n && fit.length; i++) {
      const P = padSpot('highland', 1, 'tank'), v = P && spawn(F, fit[Math.floor(S.rnd() * fit.length)], P.e, P.z, P.yaw, 1, 'fight', { wave: R0.wave });
      if (v) R0.left.push(v);
      units(F);
    }
    say(F, `Wave ${R0.wave}: ${R0.left.length} vehicles from the south pad`, 'warn');
  }
  // a stock vehicle that can fight another on the ground (a main gun, wire-guided missiles or an automatic gun; not
  // rocket artillery or a SAM carrier)
  const fighter = (key) => TEMPLATES[key].parts.some((r) => { const d = PARTS[r[0]], w = d && d.weapon; return !!d && !!d.aim && !!w && (w.kind === 'tgun' || (w.kind === 'missile' && w.seek === 'saclos') || (w.kind === 'agun' && (w.cal || 0) >= 20)); });

  // ---------------------------------------------------------------- the Practice Battle
  // the player's design for a battle with this money: theirs if it's a ground vehicle within it, else the money's first
  // stock vehicle (GROUND_STOCK, as a room's fallback)
  function designFor(money, d) {
    const ok = (x) => {
      if (!x || !Array.isArray(x.parts) || !isGround(x.kind)) return false;
      const ps = partsFromDesign(x.parts), c = findControlPart(ps);
      if (!c) return false;
      const keep = componentOf(c.id, buildAdjacency(ps));
      return designCost(ps.filter((p) => keep.has(p.id))) <= money;
    };
    if (ok(d)) return { design: d, why: null };
    const key = GroundMode.stock(money).find((k) => tplOf(k)) || GROUND_STOCK.fallback, T = tplOf(key);
    return { design: { name: T.name, kind: T.kind, key, parts: T.rows.map((q) => ({ ...q })) }, why: d && isGround(d.kind) ? `Your ${d.name || 'design'} costs more than ${money$(money)}` : 'Practice battles are for Armour and cars' };
  }
  const money$ = (n) => (typeof money === 'function' ? money(n) : '$' + Math.round(n).toLocaleString('en-US'));
  // start (or come back in) the player's vehicle at its pad, keeping the AI and the wrecks; a practice launch is free
  function launch(F, design, place, fresh) {
    const keep = fresh || !F.vessels ? [] : F.vessels.filter((o) => !o.dead && ((o.ai && o.ai.ground) || o.wreck));
    F.start(design, { place, keep, time: fresh ? undefined : F.time }); // (the clock runs on: the battle's timers keep it)
    if (typeof store !== 'undefined') store.set('rss.flight', null); // (Flight.start saved it: a lent vehicle in a battle that can't be saved is never resumed)
    if (typeof Career !== 'undefined' && F.launchCost) { Career.earn(F.launchCost); F.launchCost = 0; }
    Combat.S.gai = 1; // (Combat.reset cleared it)
    S.b.cost = designCost(F.active.parts); S.b.kind = F.active.kind; S.b.design = design;
    F.active.spawnAt = F.time || 0; // (4 s of spawn protection, as in a room)
  }
  function rules(F, dt) {
    const B = S.b, O = B.obj, U = [], A = F.active;
    B.t += dt;
    for (const u of S.units) {
      const v = u.v, me = v === A, k = v.ai && v.ai.k;
      if (me && v.contactTime > 0) B.gdAt = F.time;
      U.push({ team: u.team, e: u.e, z: u.z, kind: v.kind, speed: me ? v.speed() : Math.abs(k.s), gd: me ? (F.time - (B.gdAt ?? -9) < 0.5 ? 1 : 0) : 1, troops: troopsOf(v), v });
    }
    for (const ev of GroundMode.tick(O, dt, U)) {
      const name = ev.zone;
      if (ev.k === 'cap') {
        const mine = ev.team === B.team, byMe = mine && ev.by.some((i) => U[i] && U[i].v === A);
        if (byMe) B.caps++;
        say(F, byMe ? `You took ${name}` : mine ? `Your team took ${name}` : `The enemy took ${name}`, mine ? 'kill' : 'warn');
      } else if (ev.k === 'lost') say(F, ev.team === B.team ? `${name} lost` : `${name} is neutral again`, ev.team === B.team ? 'warn' : 'info');
    }
    const res = GroundMode.result(O, B.t >= BATTLE.limit);
    if (res) end(F, res);
  }
  // living troops aboard (a troop bay, or a hull's built-in troops): a capture half as fast again
  function troopsOf(v) {
    let n = 0;
    for (const p of v.parts) {
      const d = p.def;
      if (d.troops && d.module === 'troops' && !p.broken) n += d.troops;
      if (d.mods) for (let i = 0; i < d.mods.length; i++) if (d.mods[i].k === 'troops' && !(p.mods && p.mods[i] != null && p.mods[i] <= 0)) n += d.mods[i].troops || 0;
    }
    return n;
  }
  function end(F, res) {
    const B = S.b;
    if (B.over) return;
    B.over = res;
    for (const v of S.ai) { v.ai.role = 'idle'; v.aimP = null; v.aimFire = v.mgFire = false; }
    const win = res.winner === B.team, tk = `${B.obj.tk[B.team]} – ${B.obj.tk[1 - B.team]}`, title = res.winner == null ? 'Draw' : win ? 'Victory' : 'Defeat';
    const line = res.why === 'time' ? `Time’s up: ${win ? 'your side holds more tickets' : 'the enemy holds more tickets'} (${tk})` : res.winner == null ? `Both sides out of tickets (${tk})`
      : `${win ? 'The enemy is' : 'Your team is'} out of ${res.why === 'wiped' ? 'vehicles' : 'tickets'} (${tk})`;
    say(F, `${title}! ${line}`, win ? 'achievement' : 'warn');
    B.result = { title, line };
    if (typeof setTimeout === 'function' && typeof UI !== 'undefined') setTimeout(() => { if (S.b === B && F.running) results(F); }, 1500);
  }

  // ---------------------------------------------------------------- the bar and the panels (DOM; only on change)
  function bar(F) {
    if (typeof document === 'undefined' || typeof el !== 'function') return;
    const R0 = S.range, B = S.b;
    if (!R0 && !B) { if (S.bar && !S.bar.root.hidden) { S.bar.root.hidden = true; S.barKey = ''; warp(false); } return; }
    if (!S.bar) {
      const root = el('div', { id: 'gai-bar', class: 'gai-bar panel', 'aria-live': 'polite' }), main = el('div', { class: 'gai-main' }), sub = el('div', { class: 'gai-sub' });
      const btn = el('button', { class: 'btn small primary gai-btn', text: 'Respawn' });
      btn.addEventListener('click', () => { if (S.b && S.F && S.F.destroyed) panel(S.F); });
      root.append(main, sub, btn);
      ($('#flight-ui') || document.body).append(root);
      S.bar = { root, main, sub, btn, zones: [] };
    }
    const E = S.bar, now = F.time || 0;
    let key, main, sub = '', btn = false, zones = null;
    if (B) {
      const O = B.obj, left = Math.max(0, BATTLE.limit - B.t), me = S.units.find((u) => u.v === F.active), inZ = me && O.zones.find((z) => GroundMode.inZone(me.e, me.z, z));
      zones = O.zones.map((z) => (z.own < 0 ? (Math.abs(z.p) > 0.02 ? 'taking' : '') : z.own === B.team ? 'own' : 'foe'));
      main = `${O.tk[B.team]}|${O.tk[1 - B.team]}`;
      sub = B.over ? B.result.title : F.destroyed ? (now < B.respawnAt ? `Knocked out · back in ${Math.ceil(B.respawnAt - now)} s` : 'Knocked out') : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} left` +
        (inZ ? ` · ${inZ.id} ${Math.round(Math.abs(inZ.p) * 100)}%` : '');
      btn = !!F.destroyed && !B.over && !(typeof UI !== 'undefined' && UI.modalOpen);
      key = `b|${main}|${zones.join()}|${sub}|${btn}`;
    } else {
      main = `Range: ${R0.kos} KO${R0.kos === 1 ? '' : 's'}|${R0.best ? `best shot ${fmt.dist(R0.best)}` : ''}`;
      if (R0.mode === 'hostile') sub = R0.left.length ? `Wave ${R0.wave} · ${R0.left.length} left` : R0.wave ? `Next wave in ${Math.max(0, Math.ceil(R0.waveAt - now))} s` : `First wave in ${Math.max(0, Math.ceil(R0.waveAt - now))} s`;
      else if (!R0.best) sub = 'They don’t shoot back';
      key = `r|${main}|${sub}`;
    }
    if (E.root.hidden) E.root.hidden = false;
    warp(true);
    if (key === S.barKey) return;
    S.barKey = key;
    E.main.textContent = '';
    if (B) {
      const [a, b] = main.split('|');
      E.main.append(el('span', { class: 'gai-tk t0', text: a }));
      const zs = el('span', { class: 'gai-zones' });
      B.obj.zones.forEach((z, i) => zs.append(el('b', { class: zones[i], text: z.id })));
      E.main.append(zs, el('span', { class: 'gai-tk t1', text: b }));
    } else { // ("Range: 4 KOs · best shot 1,180 m": on a phone the best shot goes under it)
      const [a, b] = main.split('|');
      E.main.append(el('span', { text: a }));
      if (b) E.main.append(el('span', { class: 'gai-best' }, el('i', { text: ' · ' }), b));
    }
    E.sub.textContent = ''; // (its parts whole: a narrow bar breaks the line between them, never inside one, so the seconds show)
    sub.split(' · ').forEach((q, i) => { if (i) E.sub.append(' · '); E.sub.append(el('span', { text: q })); });
    E.btn.hidden = !btn;
  }
  // the bar takes the time warp's place at the top (as the room's bar does)
  function warp(hide) {
    const w = typeof document !== 'undefined' && $('#warp');
    if (!w) return;
    if (hide) {
      if (!w.hidden) { w.hidden = true; S.warp = true; }
      if (typeof Flight !== 'undefined' && Flight.warpIdx && Flight.setWarp) Flight.setWarp(0); // (no time warp under it: none shows)
    } else if (S.warp) { S.warp = false; if (!(typeof Flight !== 'undefined' && Flight.mp)) w.hidden = false; }
  }
  // The Practice Battle's respawn panel (the room's, MPUI.rsp): back in after 5 s in your vehicle, another of your designs
  // or a stock one within the money; or leave
  function panel(F) {
    const B = S.b;
    if (!B || typeof UI === 'undefined' || typeof MPUI === 'undefined' || typeof document === 'undefined' || !F.destroyed || B.over) return;
    const state = () => {
      if (S.b !== B || !F.destroyed) return null;
      const left = Math.ceil(B.respawnAt - (F.time || 0)), out = !(B.obj.tk[B.team] > 0);
      return { text: out ? 'Your team is out of tickets.' : left > 0 ? `Back in the fight in ${left} s` : 'Pick your vehicle', wait: out || left > 0 };
    };
    const go = (d) => { if (!GroundAI.respawn(F, d)) UI.toast('Not yet: wait for the timer', 'warn'); };
    const main = (R) => {
      const d = B.design;
      R.opt(`Your vehicle (${d.name || VEHICLE_KINDS[d.kind].name})`, money$(designCost(partsFromDesign(d.parts))), () => go(d));
      R.opt('Change vehicle…', 'Another of your designs, or a stock one within the money', () => R.page(pick), true, true);
    };
    const pick = (R) => {
      R.opt('‹ Back', 'Your vehicle', () => R.page(main), true, true);
      for (const c of choices(B.money)) R.opt(c.name, `${money$(c.cost)}${c.saved ? ' · your design' : ''}`, () => go(c.design));
    };
    const by = F.active && F.active.lastHitBy, name = by && by.name ? String(by.name).slice(0, 40) : null;
    MPUI.rsp({ kicker: 'Practice battle', title: name ? `Knocked out by ${by.ai && by.ai.ally ? 'your ally’s ' : 'the enemy '}${name}` : 'Knocked out', state, fill: main,
      actions: [{ label: 'Leave the battle', onClick: () => { if (typeof App !== 'undefined') App.toBuild(); } }, { label: 'Watch', primary: false }] });
  }
  // what the player may come back in: their saved ground designs within the money, then the stock ones
  function choices(cash) {
    const out = [], fits = (d) => designFor(cash, d).why === null;
    for (const d of typeof Builder !== 'undefined' && Builder.designs ? Builder.designs() : []) {
      if (!isGround(d.kind)) continue;
      const des = { name: String(d.name).slice(0, 40), kind: d.kind, parts: d.parts };
      if (fits(des)) out.push({ name: des.name, design: des, cost: designCost(partsFromDesign(d.parts)), saved: true });
    }
    for (const k of Object.keys(TEMPLATES)) {
      const t = TEMPLATES[k];
      if (!isGround(t.kind) || !fighter(k)) continue;
      const T = tplOf(k), des = { name: t.name, kind: t.kind, key: k, parts: T.rows };
      if (fits(des)) out.push({ name: t.name, design: des, cost: designCost(partsFromDesign(T.rows)) });
    }
    return out;
  }
  function results(F) {
    const B = S.b;
    if (!B || !B.result || typeof UI === 'undefined') return;
    const body = el('div', { class: 'rsp' }, el('p', { class: 'rsp-wait', text: B.result.line }),
      el('p', { class: 'muted', text: `You: ${B.kos} knock-out${B.kos === 1 ? '' : 's'}, ${B.caps} zone${B.caps === 1 ? '' : 's'} taken, ${B.lost} lost` }));
    UI.modal({ kicker: 'Practice battle', title: B.result.title, body,
      actions: [{ label: 'Back to hangar', onClick: () => { if (typeof App !== 'undefined') App.toBuild(); } }, { label: 'Play again', primary: true, onClick: () => GroundAI.startBattle(F, { money: B.money }) }] });
  }

  // ---------------------------------------------------------------- the interface
  return {
    // the Practice Battle's state while one is on in this flight, else null: { obj (GroundMode's: tickets, zones), team,
    // arena, money, t, kos, caps, lost, over, ... }
    get battle() { const B = S.b; return B && typeof Flight !== 'undefined' && Flight.running === false ? null : B && Combat.S.gai && !mpOn() ? B : null; },
    get range() { return S.range; },
    get ai() { return S.ai; },
    get calls() { return S.calls; }, set calls(n) { S.calls = n; },
    // anything of ours still out (or the bar still up): Combat.frame keeps calling frame until it has gone
    get shown() { return !!(S.range || S.b || S.ai.length || (S.bar && !S.bar.root.hidden)); },

    // Each frame (Combat.frame): the range started or stopped (once a second), then each AI: a decision 4 times a
    // second, moves at 30 a second, its pose, its aim; knock-outs coming back; the battle's rules 4 times a second; the bar.
    frame(F, dt) {
      if (!F || !F.active) return;
      if (mpOn()) { if (S.range || S.b || S.ai.length) this.reset(F); return; }
      // a flight begun again (a revert, a new launch, a saved one resumed: Combat.reset): what ran went with it
      if ((S.range || S.b || S.ai.length) && !Combat.S.gai) this.reset(F);
      S.F = F;
      if (!(dt > 0)) return;
      if (!S.b && (S.chkT -= dt) <= 0) {
        S.chkT = 1;
        const want = rangeWanted(F);
        if (S.range && (!want || S.range.mode !== targetsMode())) this.reset(F);
        if (!S.range && want) this.startRange(F);
      }
      if (!S.range && !S.b && !S.ai.length) { bar(F); return; }
      units(F);
      for (const v of S.ai) {
        const a = v.ai, k = a.k;
        if (v.dead || a.down) continue;
        if ((a.thinkT -= dt) <= 0) { a.thinkT += AI.think; if (a.thinkT <= 0) a.thinkT = AI.think; think(v, F); }
        k.acc = Math.min(k.acc + dt, 8 * AI.kin);
        while (k.acc >= AI.kin) { k.acc -= AI.kin; this.kinStep(v, AI.kin); }
        if (v.com.x !== k.cx || v.com.y !== k.cy || (v.com.z || 0) !== k.cz) recentre(v);
        if (k.idle < 4 * AI.fit || !k.rest) { pose(v, k.acc); k.rest = k.idle >= 4 * AI.fit; }
        aimFrame(v, F);
      }
      // the knocked out and the long gone
      let gone = 0;
      for (const v of S.ai) if (v.dead || v.ai.down) gone++;
      if (gone) S.ai = S.ai.filter((v) => !v.dead && !v.ai.down);
      const now = F.time || 0;
      for (let i = S.dead.length; i--;) {
        const d = S.dead[i];
        if (now < d.at) continue;
        if (S.b && !(S.b.obj.tk[d.team] > 0)) continue;
        S.dead.splice(i, 1);
        if (S.range) {
          if (d.wreck) { d.wreck.dead = true; S.wrecks = S.wrecks.filter((w) => w.v !== d.wreck); }
          units(F);
          const P = d.role === 'patrol' ? null : rangeSpot(F);
          if (d.role === 'patrol') patroller(F, d.key, Math.floor(S.rnd() * LOOP.n), d.speed); // (back somewhere else on the loop)
          else if (P) spawn(F, d.key, P.e, P.z, P.yaw, d.team, d.role);
          else S.dead.push({ ...d, at: now + 5 });
        } else if (S.b) { units(F); const P = padSpot(S.b.arena, d.team, 'tank'), v = P && spawn(F, d.key, P.e, P.z, P.yaw, d.team, 'fight'); if (v) v.spawnAt = now; }
      }
      gone = 0;
      for (const w of S.wrecks) { if (now - w.t > BATTLE.wreckT && w.v !== F.active && (!S.range || S.range.mode !== 'practice')) w.v.dead = true; if (w.v.dead) gone++; }
      if (gone) S.wrecks = S.wrecks.filter((w) => !w.v.dead);
      if (S.range) rangeStep(F, dt);
      if (S.b) { const B = S.b; B.tickT = (B.tickT || 0) + dt; while (B.tickT >= 0.25) { B.tickT -= 0.25; if (!B.over) rules(F, 0.25); } }
      if ((S.barT -= dt) <= 0) { S.barT = 0.25; bar(F); }
    },
    // one 1/30 s move of a kinematic AI vehicle (exposed for the tests and the bench)
    kinStep(v, dt) { kinStep(v, dt); },
    pose(v, ahead = 0) { pose(v, ahead); },
    // a ground AI knocked out (Combat.aiDown): the hulk stays as a wreck; counted (the range's score, the battle's
    // tickets and the player's knock-outs); and back later
    down(v, F) {
      const a = v && v.ai;
      if (!a || !a.ground || a.gone) return;
      a.gone = true; a.down = true; a.state = 'down';
      const me = !!F && v.lastHitBy === F.active && !!F.active;
      wreckOf(v, F || {});
      if (S.range && me && !a.ally) score(F, v);
      const B = S.b;
      if (B && !B.over) {
        const n = GroundMode.death(B.obj, a.team, a.cost, false), friend = a.team === B.team;
        if (me && !friend) B.kos++;
        say(F, me && friend ? `You knocked out your ally’s ${v.name} (−${n} tickets)` : friend ? `Ally ${v.name} knocked out (−${n} tickets)` : me ? `−${n} enemy tickets` : `Enemy ${v.name} knocked out (−${n} enemy tickets)`, friend ? 'warn' : 'info');
      }
      if (F) after(v, F);
    },
    // everything the range or a battle put out, gone: the AI, its wrecks, the drones, the attack plane; the bar hidden
    reset(F) {
      for (const v of S.ai) v.dead = true;
      for (const w of S.wrecks) if (!F || w.v !== F.active) w.v.dead = true;
      if (S.range) {
        for (const t of S.range.drones) { const i = Combat.S.targets.indexOf(t); if (i >= 0) Combat.S.targets.splice(i, 1); }
        if (F && F.vessels) for (const o of F.vessels) if (o.gaiPlane) o.dead = true;
      }
      if (S.panelT) { clearTimeout(S.panelT); S.panelT = null; }
      S.ai = []; S.wrecks = []; S.dead = []; S.range = null; S.b = null; S.units = []; S.obs = []; S.chkT = 0;
      Combat.S.gai = 0;
      bar(F || {});
    },
    // The Tank Range on: Practice, its five targets (and two drones for an AA vehicle); Hostile, the first wave in 12 s
    startRange(F) {
      if (mpOn() || S.b || !F || !F.vessels) return false;
      const m = targetsMode();
      if (m === 'off' || !GroundMode.arena('highland')) return false;
      S.rnd = typeof mulberry32 === 'function' ? mulberry32(4242 + ((F.time * 10) | 0)) : Math.random;
      const now = F.time || 0, R0 = S.range = { mode: m, kos: 0, best: 0, wave: 0, waveAt: now + RANGE.first, planeAt: now + 60, left: [], drones: [], aa: hasAA(F.active) };
      Combat.S.gai = 1;
      units(F);
      if (m === 'practice') {
        for (const L of LAYOUT) {
          if (L.role === 'patrol') patroller(F, L.key, Math.round(L.at * LOOP.n) % LOOP.n, L.speed);
          else spawn(F, L.key, L.e, L.z, L.yaw, 1, 'parked');
        }
        if (R0.aa) { drone(R0, 0); drone(R0, 1); }
        say(F, R0.aa ? 'Tank Range: five targets ahead and two drones overhead · they never shoot back' : 'Tank Range: five targets ahead · they never shoot back', 'info');
      } else say(F, `Hostile range: the first wave leaves the south pad in ${RANGE.first} s`, 'warn');
      return true;
    },
    // The Practice Battle: the Ground Battle's rules alone on this device. opts: { money: 45000 | 75000 | 120000 }. You and
    // two AI allies on the north pad against three AI on the south one, 300 tickets a side, on Highland Ridge (the
    // Runway without the map or the 3D view); your design if it fits the money, else its first stock vehicle.
    startBattle(F, opts) {
      F = F || (typeof Flight !== 'undefined' ? Flight : null);
      if (!F || !F.start) return false;
      if (mpOn()) { if (typeof UI !== 'undefined') UI.toast('Leave the room first: a practice battle is played alone'); return false; }
      if (typeof App !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'loading') { App.afterEarth(() => this.startBattle(F, opts)); return true; }
      const cash = [45000, 75000, 120000].includes(+(opts && opts.money)) ? +opts.money : 45000;
      const mine = opts && opts.design ? opts.design : typeof Builder !== 'undefined' && Builder.serialize ? Builder.serialize() : null, D = designFor(cash, mine);
      this.reset(F);
      if (typeof App !== 'undefined') { if (App.scene === 'flight' && F.running && !F.mp) F.stop(); store.set('rss.flight', null); App.showScene('flight'); }
      const arena = GroundMode.pick(mapReady() && has3D()); // (in the flight scene, where App.use3D knows the Retro 2D view: the Runway then)
      S.rnd = typeof mulberry32 === 'function' ? mulberry32(777 + ((Date.now() / 1000) | 0)) : Math.random;
      if (opts && opts.seed != null && typeof mulberry32 === 'function') S.rnd = mulberry32(opts.seed);
      S.b = { obj: GroundMode.init(arena, { tickets: BATTLE.tickets, format: '3v3' }, [3, 3]), arena, money: cash, team: 0, t: 0, kos: 0, caps: 0, lost: 0, over: null, result: null,
        design: D.design, cost: 0, kind: D.design.kind, respawnAt: 0, gdAt: -9, tickT: 0 };
      launch(F, D.design, GroundMode.placement(arena, 0, 0, D.design.kind), true);
      if (D.why) say(F, `${D.why}: you drive the ${D.design.name}`, 'warn');
      const stock = GroundMode.stock(cash).filter((k) => tplOf(k) && fighter(k)), at = (i) => stock[i % stock.length];
      units(F);
      for (let i = 1; i <= 2; i++) { const P = GroundMode.placement(arena, 0, i, 'tank'); spawn(F, at(i), P.e, P.z, P.yaw, 0, 'fight'); }
      for (let i = 0; i < 3; i++) { const P = GroundMode.placement(arena, 1, i, 'tank'); spawn(F, at(i), P.e, P.z, P.yaw, 1, 'fight'); }
      units(F);
      say(F, `Practice battle on ${GroundMode.arena(arena).name}: take the zones · ${BATTLE.tickets} tickets a side`, 'info');
      S.barKey = ''; bar(F);
      return true;
    },
    // The player knocked out in a Practice Battle (Flight.onDestroyed): their hulk stays as a wreck, the tickets go, and
    // the respawn panel opens (back in after 5 s, on the pad, the AI and the wrecks kept). True: handled.
    onDestroyed(F) {
      const B = S.b;
      if (!B || !Combat.S.gai || mpOn()) return false;
      const v = F.active;
      if (v && !v.dead && v.parts.length) wreckOf(v, F);
      if (!B.over) {
        B.lost++;
        const n = GroundMode.death(B.obj, B.team, B.cost, B.kind === 'plane' || B.kind === 'heli'), by = v && v.lastHitBy;
        say(F, `${by && by.name ? `Knocked out by ${String(by.name).slice(0, 40)}` : 'Knocked out'} (−${n} tickets)`, 'warn');
      }
      B.respawnAt = (F.time || 0) + BATTLE.respawn;
      if (typeof setTimeout === 'function' && typeof UI !== 'undefined') {
        if (S.panelT) clearTimeout(S.panelT);
        S.panelT = setTimeout(() => { S.panelT = null; if (S.b === B && F.running && F.destroyed) panel(F); }, BATTLE.panel * 1000);
      }
      return true;
    },
    // Back in the battle in design d (the panel's choice): only once the respawn time has come and the side has tickets
    respawn(F, d) {
      const B = S.b;
      if (!B || B.over || !F.destroyed || (F.time || 0) < B.respawnAt - 0.3 || !(B.obj.tk[B.team] > 0)) return false;
      const D = designFor(B.money, d || B.design);
      if (typeof UI !== 'undefined' && UI.modalOpen) UI.closeModal();
      units(F);
      launch(F, D.design, padSpot(B.arena, B.team, D.design.kind));
      say(F, `Back in the fight: ${D.design.name || 'your vehicle'}`, 'info');
      S.barKey = ''; bar(F);
      return true;
    },
    // "Revert to launch" in a Practice Battle (Flight.revert): knocked out, the respawn panel again; over, a new battle;
    // else back to the pad now, which costs your side the vehicle's tickets as a knock-out would. True: handled.
    revert(F) {
      const B = S.b;
      if (!B || !Combat.S.gai || mpOn()) return false;
      if (B.over) { this.startBattle(F, { money: B.money }); return true; }
      if (F.destroyed) { if (typeof UI !== 'undefined') panel(F); else this.respawn(F, B.design); return true; }
      const n = GroundMode.death(B.obj, B.team, B.cost, false);
      B.lost++;
      say(F, `Back to your pad (−${n} tickets)`, 'warn');
      units(F);
      launch(F, B.design, padSpot(B.arena, B.team, B.kind));
      S.barKey = ''; bar(F);
      return true;
    },
    // one more AI vehicle of stock template key at (e, z) facing yaw, on team (0: the player's), as role ('parked',
    // 'patrol' round the range's loop, 'fight'); opts { skill 0..1, speed }. The vessel, or null (no such template; in a room)
    spawn(F, key, e, z, yaw, team, role, opts) { if (mpOn() || !F || !F.vessels) return null; units(F); return spawn(F, key, e, z, yaw || 0, team === 0 ? 0 : 1, role || 'fight', opts || {}); },
    // a teammate's spot (J, a long press on a tag: ghud.js): our side's AI treat it as seen for 10 s
    spot(o, F) { if (o && o.ai && o.ai.ground) o._gaiSpot = ((F && F.time) || 0) + 10; },
  };
})();
