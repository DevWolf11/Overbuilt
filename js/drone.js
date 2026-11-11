'use strict';
// Drones and counter-drone (the big update). A drone is a craft of kind 'drone' built from its own small parts (the
// Drone kind's four tabs: def.drone) and flown by its own laws (below), never by the helicopter's or a plane's: Level
// (the default: the stick asks for a ground speed, letting go brakes to a hover, the lever asks for a climb rate and
// holds the height over the ground), Acro (the stick sets rates, nothing levels it, the throttle is the pilot's) and the
// winged law (bank to turn, hold the height when let go). Its battery is a fuel part (1 kg = 1 kWh) the engine code
// drains. Tanks carry drones in bays (def.dock) and answer them with counter-drone kit (def.cuas, the Drone Radar's
// searchRadar.low).
//
// Old designs never reach any of it: every hook in the other files opens only for kind 'drone', def.drone, def.cuas,
// def.dock, searchRadar.low, v.carrier, Combat.S.dr, GroundAI.dw or a message's c/tc (test/ground.test.js counts the
// calls into Drone). No top-level DOM or THREE: the file loads headless (test/lib/game.js).
//
// Sections, in order: core (tuning, groups, laws, battery, the builder's numbers, what fits a bay, building one) ·
// HUD · bays · combat · AI · MP. Each later package of the update fills its own section's bodies.

// All tuning in one table (angles in rad, speeds in m/s, times in s).
const DRONE = {
  KA: 6, RMAX: 4,                     // Level: attitude gain (1/s), most body rate (rad/s)
  KV: 0.15,                           // rad of lean per m/s of horizontal speed error
  KZ: 3, HOLD: 1.5, VHOLD: 3,         // climb-rate gain (1/s); height hold gain (1/s) and its rate cap (m/s)
  LOOK: 1.2, GCACHE: 0.1,             // s of look-ahead for the ground under the hold; s between looks
  YAW: 2.0, TURNK: 0.8, BANK: 0.5,    // turn at a hover (rad/s); at speed v: 0.3 + g·tan(TURNK·lean)/v; carving bank cap
  SLIDE: 0.5, BACK: 0.5,              // Q/E slide and full back stick, × the controller's vmax
  LAND: 1.5, LANDH: 3, FLOOR: 1.5,    // m/s descent within LANDH m of the ground with no stick; the hold never under FLOOR m
  ACRO: [4.5, 4.5, 3], RAMP: 2.25, IDLE: 0.08, // Acro rates (pitch, roll, yaw); throttle ramp /s (Acro, winged); air-mode floor
  SPIN: { YAW: 3, SINK: 3, THR: 0.6 }, // a multirotor short of motors (a quad down one, a hex or octo down two): it spins, sinks, throttle capped
  WING: { DIVE: 0.7, CLIMB: 0.4, BANK: 0.8, KA: 3, HOLDK: 0.03, VSK: 0.02, PCAP: 0.2, STALL: 1.25, SBANK: 0.5, ACRO: [2, 3, 0.5], RUD: 0.5 },
  ARM_D: 20, ARM_T: 2, FUSE_V: 4, AHEAD: 0.3, // safe-arm (m from launch, s); ground touch that sets it off (m/s); fuse look-ahead (m)
  LINK: { DT: 0.2, LOS_DT: 0.5, LOS_N: 10, LOS_K: 0.35, STATIC: 0.6, LAG: 0.4, LAGMAX: 0.2, LOST: 0.15, LOST_T: 0.5,
          BACK: 0.35, BACK_T: 0.5, HANDBACK: 5, JAM_IN: 0.35, K: { radio: 1, long: 0.6, sat: 0.25, fibre: 0 }, STATION: 3, HOME_UP: 2 },
  BATT: { WARN: 0.25, CRIT: 0.10, AUTO: 0.05, AUTO_T: 2, AUTO_V: 2 },
  HOME: { ALT: 30, V: 12, SLOW: 15, DESC: 1.5, DOCK_R: 1.5, DOCK_H: 2, DOCK_V: 3, NEAR_R: 3, NEAR_H: 6, CIRCLE: 60, CIRCLE_H: 80 },
  LAUNCH: { V: 3, TILT: 60, HOP: 5, HOP_T: 0.6, SCALE: 400, ZOOM: 800 },
  LAST: 20, LOST_GONE: 60, REST_GONE: 3, EYE: 400, MARKS: 8, BUZZ: 250, MAX_PARTS: 40, IMPACT: 1.5,
};
// the old Drone Core (parts.js) on a drone-kind craft: a GPS controller with a satellite link (its def untouched)
const DRONE_LEGACY = { droneCore: { fc: { kind: 'gps', lean: 0.35, vmax: 14, vz: 4, dive: 0, fs: 'home', radio: 0 }, link: { kind: 'sat', range: 50000, lag: 0.25 } } };

const Drone = (() => {
  // ================================================================ core
  const GPS = Object.freeze({ kind: 'gps', lean: 0.45, vmax: 16, vz: 5, dive: 0, fs: 'home', radio: 1000 }); // (no controller part: the GPS defaults)
  const NOSTICK = Object.freeze({ v: 0, h: 0, r: 0, z: 0 });
  const _loc = {}; // (Terrain.locate's out object for the look-ahead)
  const say = (sim, text, kind) => { if (sim && sim.toast) sim.toast(text, kind); };
  const beep = (f) => { if (typeof Sound !== 'undefined' && Sound.beep) Sound.beep(f); };
  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const num = (x) => +x.toFixed(2); // (2.5, 0.84, 3.19: as few figures as it needs)

  // A drone's groups (from Vessel.rebuildGroups, kind 'drone' only): its flight controller (the fastest aboard), links
  // (the controller's own radio, every link part, the old Drone Core's satellite link), cameras (the best: a gimbal
  // first, then the furthest-seeing), battery cells and their full charge (wh0, Wh), lift rotors (mot0: how many it was
  // built with, kept across rebuilds), warheads, and the motors a guard (or their own duct) protects.
  function groups(v) {
    const was = v.dr, links = [], cams = [], cells = [], warheads = [], guards = [];
    let fc = null, fcPart = null, core = null, wh0 = 0;
    for (const p of v.parts) {
      const d = p.def, r = d.drone;
      if (p.type === 'droneCore') { if (!core) core = p; continue; }
      if (!r) continue;
      if (r.fc && (!fc || r.fc.vmax > fc.vmax)) { fc = r.fc; fcPart = p; }
      if (r.link) links.push({ p, L: r.link });
      if (r.cam) cams.push(p);
      if (r.cell) { cells.push(p); wh0 += (d.fuel || 0) * 1e6; }
      if (r.warhead) warheads.push(p);
      if (r.guard && !r.motor) guards.push(p);
    }
    if (!fc && core) { fc = DRONE_LEGACY.droneCore.fc; fcPart = core; }
    if (!fc) fc = GPS;
    if (fcPart && fc.radio > 0) links.unshift({ p: fcPart, L: { kind: 'radio', range: fc.radio } }); // (the controller's own radio)
    if (core) links.push({ p: core, L: DRONE_LEGACY.droneCore.link });
    let cam = null;
    for (const p of cams) { const c = p.def.drone.cam, b = cam && cam.def.drone.cam; if (!cam || (!!c.gimbal !== !!b.gimbal ? c.gimbal : (c.spot || 0) > (b.spot || 0))) cam = p; }
    const rotors = v.rotors.filter((p) => !p.def.wing), guarded = new Set();
    for (const m of rotors) {
      if (m.def.drone && m.def.drone.guard) { guarded.add(m.id); continue; } // (a ducted fan: its own ring)
      const z = partZ(m);
      for (const g of guards) {
        const R = partRect(g), hd = partDepth(g) / 2, gz = partZ(g);
        if (m.x >= R.l && m.x <= R.r && m.y >= R.b && m.y <= R.t && z >= gz - hd && z <= gz + hd) { guarded.add(m.id); break; }
      }
    }
    const lift = rotors.length > 0;
    v.dr = { fc, fcPart, links, cams, cam, cells, wh0, rotors, mot0: was && was.mot0 != null ? was.mot0 : rotors.length, lift, guarded, warheads,
      wing: !!v.aircraft && !lift };
    for (const p of v.parts) { const g = p.def.cuas && p.def.cuas.gun; if (g && p.ammo == null) p.ammo = g.ammo; } // (an anti-drone gun carried by a drone: its rounds)
    return v.dr;
  }

  // The law's state on the drone (v.dl), made on first use: its own clock (dl.t: deterministic under every stand-in for
  // Flight), the height hold, the ground look-ahead's cache, the heading-frame velocities (S), this step's autopilot
  // target (auto), the mode (pilot, hold, home, land, auto), the link (q, lost, snapped), safe-arm (arm, at0, t0, prev),
  // a bay launch's hop, the battery's warnings (bw) and the auto-land at 5 %.
  function state(v) {
    const dl = v.dl;
    if (dl && dl.mode !== undefined) return dl;
    // (made here, or completed: Flight.start and a bay's launch give only the clock and where it took off)
    return (v.dl = Object.assign({ t: 0, hold: null, gT: null, gA: -Infinity, S: null, auto: null, mode: 'pilot', lost: false, q: 1, snapped: false,
      arm: false, at0: { x: v.x, y: v.y, z: v.z }, t0: 0, prev: null, hop: 0, autoLand: false, quietT: 0, bw: 0, beepT: 0, flat: false, wh: null, spin: false }, dl || {}));
  }

  // The drone's velocity in its heading frame (vf ahead along the nose's horizontal, vr to its right, vz up), the
  // horizontal velocity (hx, hy, hz) and the nose's heading (radians from north, east 90°, as Vessel.heading's).
  function hframe(v, o) {
    const r = v.radius() || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r, f = v.axis(1, 0, 0), k = f.x * ux + f.y * uy + f.z * uz;
    let fx = f.x - ux * k, fy = f.y - uy * k, fz = f.z - uz * k;
    const l = Math.hypot(fx, fy, fz);
    if (l < 1e-6) { const g = v.axis(0, 1, 0), k2 = g.x * ux + g.y * uy + g.z * uz; fx = -(g.x - ux * k2); fy = -(g.y - uy * k2); fz = -(g.z - uz * k2); } // (pointing straight up or down: its back's direction)
    const L = Math.hypot(fx, fy, fz) || 1; fx /= L; fy /= L; fz /= L;
    const rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux; // (nose × up: the right)
    const vu = v.vx * ux + v.vy * uy + v.vz * uz, hx = v.vx - ux * vu, hy = v.vy - uy * vu, hz = v.vz - uz * vu;
    // the heading: east = up × world z, north = east × up (util.js surfaceFrame)
    let ex = uy, ey = -ux, ez = 0; const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    if (el < 1e-6) { ex = 1; ey = 0; }
    const nx = ey * uz - ez * uy, ny = ez * ux - ex * uz, nz = ex * uy - ey * ux;
    o = o || {};
    o.vf = hx * fx + hy * fy + hz * fz; o.vr = hx * rx + hy * ry + hz * rz; o.vz = vu; o.hx = hx; o.hy = hy; o.hz = hz;
    o.head = Math.atan2(fx * ex + fy * ey + fz * ez, -(fx * nx + fy * ny + fz * nz));
    return o;
  }
  // The ground the height hold keeps above: the surface here (the sea's over water, a deck's on a deck) or the surface
  // LOOK s ahead along the horizontal velocity, the higher (looked up every GCACHE s of the drone's clock).
  function groundUnder(v, dl, S) {
    const L = v.surfaceSpot(), here = Terrain.surfaceAt(v.body, L.a, L.z);
    if (dl.gT == null || dl.t - dl.gT >= DRONE.GCACHE) {
      dl.gT = dl.t;
      const sp = Math.hypot(S.hx, S.hy, S.hz), k = DRONE.LOOK;
      if (sp > 1) { const A = Terrain.locate(v.body, v.x + S.hx * k, v.y + S.hy * k, v.z + S.hz * k, _loc); dl.gA = Terrain.surfaceAt(v.body, A.a, A.z); } else dl.gA = -Infinity;
    }
    const g = Math.max(here, dl.gA);
    return Number.isFinite(g) ? g : 0;
  }
  // Is the stick (or Q/E) off its centre?
  const sticky = (c) => Math.abs(c.v) > 0.02 || Math.abs(c.h) > 0.02 || Math.abs(c.r) > 0.02;
  // Settings → Drone stick: 'turn' (the default: sideways turns, Q/E slide) or 'tilt' (sideways slides, Q/E turn)
  const tiltLayout = () => typeof Settings !== 'undefined' && Settings.get('droneStick') === 'tilt';
  const zero = (c) => { c.v = 0; c.h = 0; c.r = 0; c.z = 0; };

  // The battery's charge, 0..1 (1 with no cell aboard: nothing to read).
  function charge(v) {
    const dr = v.dr;
    if (!dr || !(dr.wh0 > 0)) return 1;
    let kg = 0;
    for (const p of dr.cells) kg += p.fuel || 0;
    return clamp((kg * 1000) / dr.wh0, 0, 1);
  }
  // The battery's warnings, once each: 25 % (a beep, a toast, the OSD amber), 10 % (a beep every 2 s, a toast, the OSD
  // red; an unattended drone flies home, or lands with no carrier), flat (the motors flame out by themselves:
  // applyEngines). Only the pilot's own drones speak; heard while flown (a stand-in for Flight without an active craft
  // counts as flying it).
  function battery(v, dl, sim) {
    if (v.ai || v.remote) return;
    const q = charge(v), B = DRONE.BATT, flown = !sim || !('active' in sim) || sim.active === v;
    if (q <= B.WARN && dl.bw < 1) { dl.bw = 1; if (flown) { beep(660); say(sim, 'Battery 25%: head back', 'warn'); } }
    if (q <= B.CRIT) {
      if (dl.bw < 2) { dl.bw = 2; dl.beepT = dl.t; if (flown) say(sim, 'Battery 10%: land or bring it home', 'warn'); }
      if (flown && dl.t - dl.beepT >= 2) { dl.beepT = dl.t; beep(880); }
      if (dl.mode === 'hold') dl.mode = v.carrier ? 'home' : 'land'; // (left hovering: it comes back by itself)
    }
    if (!dl.flat && v.dr.wh0 > 0 && q * v.dr.wh0 <= 0.001) { dl.flat = true; if (flown) say(sim, 'Battery flat', 'warn'); }
  }

  // The autopilots' targets in the heading frame ({ vf, vr, vz, yawTo }; vz null: hold the height). Hold: hover where it
  // is. Land: down at LAND m/s near the ground (3 m/s higher up, or AUTO_V for the 5 % auto-land), holding its place.
  // Home: the bays' (a stand-in until then: it holds).
  const holdAuto = (S) => ({ vf: 0, vr: 0, vz: null, yawTo: S.head });
  const landAuto = (S, agl, v0) => ({ vf: 0, vr: 0, vz: agl < DRONE.LANDH ? -DRONE.LAND : -(v0 || 3), yawTo: S.head, land: true });
  function homeAuto(v, dl, S, sim) { return holdAuto(S); } // (the bays' Home steering fills this)

  // Before applyEngines, every physics step (Vessel.physicsStep, kind 'drone', not debris): the overrides (a launch's hop,
  // a lost link's failsafe, Home/Land/unattended, the AI, a spin-out, the 5 % auto-land), then the throttle: the pilot's
  // in Acro and on a winged drone (the lever ramps it), else Level's climb-rate law.
  function pre(v, dt, sim) {
    const dl = state(v);
    dl.t += dt;
    if (v.isDebris || !v.dr) return;
    const dr = v.dr, c = v.ctl, F = dr.fc, alt = v.altitude(), S = (dl.S = hframe(v, dl.S));
    dl.auto = null; dl.spin = false;
    battery(v, dl, sim);
    // 1. overrides (each zeroes the stick, so a key held at a switch never flies the drone off)
    if (dl.hop > 0) { dl.hop -= dt; dl.auto = { vf: 0, vr: 0, vz: 4, yawTo: S.head }; zero(c); }
    else if (dl.lost) {
      zero(c);
      if (F.fs === 'drop') { v.throttle = 0; return; } // (an FPV controller lets it fall)
      dl.auto = homeAuto(v, dl, S, sim);
    } else if (dl.mode === 'home' || dl.mode === 'land' || dl.mode === 'hold') {
      zero(c);
      const agl = alt - groundUnder(v, dl, S);
      dl.auto = dl.mode === 'home' ? homeAuto(v, dl, S, sim) : dl.mode === 'land' ? landAuto(S, agl) : holdAuto(S);
    } else if (v.ai && v.ai.drone) { zero(c); dl.auto = api.aiSteer(v, sim, dt) || holdAuto(S); }
    // a multirotor short of motors spins and sinks (the stick still works: control first)
    const alive = dr.rotors.length;
    dl.spin = dr.lift && dr.mot0 > 0 && dr.mot0 - alive >= (dr.mot0 > 4 ? 2 : 1);
    // 2. Acro, or a winged drone: the throttle is the pilot's (the lever ramps it), kept off idle in the air
    if (v.sas === 'acro' || v.aircraft) {
      const z = c.z || 0;
      if (z) v.throttle = clamp(v.throttle + z * DRONE.RAMP * dt, 0, 1);
      if (!v.landed) v.throttle = Math.max(v.throttle, DRONE.IDLE);
      if (dl.spin) v.throttle = Math.min(v.throttle, DRONE.SPIN.THR);
      return;
    }
    // 3. Level: the climb-rate law (the auto-land at 5 % first: 2 s with no stick and no lever; any input cancels it)
    const z = c.z || 0, stick = sticky(c), agl = alt - groundUnder(v, dl, S);
    if (!v.ai && !v.remote && !dl.auto && charge(v) <= DRONE.BATT.AUTO && dr.wh0 > 0) {
      if (stick || z) { dl.autoLand = false; dl.quietT = 0; }
      else if ((dl.quietT += dt) >= DRONE.BATT.AUTO_T) dl.autoLand = true;
      if (dl.autoLand) dl.auto = landAuto(S, agl, DRONE.BATT.AUTO_V);
    }
    const A = dl.auto, down = dl.hold != null && dl.hold < DRONE.FLOOR; // (down: it set down, and nothing has lifted it since)
    if ((v.landed || down) && ((z <= 0 && !stick && !A) || (v.landed && A && A.land))) { v.throttle = 0; if (v.landed) dl.hold = agl; return; } // (it sits; the props idle)
    if (z || dl.hold == null || (A && A.vz != null) || (stick && down)) dl.hold = Math.max(agl, DRONE.FLOOR); // (the stick on the ground: up to FLOOR, then away)
    let vzT;
    if (A && A.vz != null) vzT = A.vz;
    else if (z > 0) vzT = z * F.vz;
    else if (z < 0) vzT = agl < DRONE.LANDH && !stick ? Math.max(z * F.vz * 0.7, -DRONE.LAND) : z * (0.7 * F.vz + F.dive * Math.max(0, S.vf)); // (an FPV dives steeper the faster it flies)
    else vzT = clamp((dl.hold - agl) * DRONE.HOLD, -DRONE.VHOLD, DRONE.VHOLD);
    if (dl.spin) vzT = Math.min(vzT, -DRONE.SPIN.SINK);
    const U = v.axis(0, 1, 0), r = v.radius() || 1, tilt = (U.x * v.x + U.y * v.y + U.z * v.z) / r, rho = airDensity(v.body, alt);
    let T = 0;
    for (const p of dr.rotors) {
      if (!p.active || p.flameout || !p.def.thrust) continue;
      let f = p.def.thrust * 1000 * airThrust(p.def.air, rho, S.vz * tilt);
      if (p.hp != null && typeof Combat !== 'undefined') f *= Combat.engineK(p);
      T += f;
    }
    v.throttle = T > 0 ? clamp((v.mass * (G0 + (vzT - S.vz) * DRONE.KZ)) / Math.max(0.5, tilt) / T, 0, 1) : 0;
    if (dl.spin) v.throttle = Math.min(v.throttle, DRONE.SPIN.THR);
  }

  // The pilot rates (rad/s: pitch + nose up, roll + right wing down, yaw + nose right) a multirotor turns at
  // (Vessel.turnTarget, kind 'drone' with no wing). Acro: the stick's rates, nothing levels it. Level: the stick (or the
  // autopilot) asks for a ground speed ahead and aside; the drone leans for it (no more than its controller's lean) and
  // turns at the rate the stick asks, carving with a matching bank at speed.
  function turn(v, c, dt) {
    const dl = state(v), F = (v.dr || GPS).fc || GPS, at = v.attitude(), Y = dl.spin ? DRONE.SPIN.YAW : null;
    if (v.sas === 'acro') return { pitch: -c.v * DRONE.ACRO[0], roll: c.h * DRONE.ACRO[1], yaw: Y != null ? Y : c.r * DRONE.ACRO[2] };
    const L = F.lean, S = dl.S || (dl.S = hframe(v)), A = dl.auto, tilt = tiltLayout(), turnIn = tilt ? c.r : c.h, slideIn = tilt ? c.h : c.r;
    const vfT = A ? A.vf : c.v >= 0 ? c.v * F.vmax : c.v * F.vmax * DRONE.BACK;
    const vrT = A ? A.vr : slideIn * F.vmax * DRONE.SLIDE;
    let om = A ? (A.yawTo != null ? clamp(wrapAngle(A.yawTo - S.head) * 1.5, -DRONE.YAW, DRONE.YAW) : 0)
      : turnIn * Math.min(DRONE.YAW, 0.3 + (G0 * Math.tan(DRONE.TURNK * L)) / Math.max(Math.abs(S.vf), 1));
    if (Y != null) om = Y;
    const carve = Y != null ? 0 : clamp(Math.atan((S.vf * om) / G0), -DRONE.BANK, DRONE.BANK);
    const pT = clamp(-(vfT - S.vf) * DRONE.KV, -L, L), bT = clamp((vrT - S.vr) * DRONE.KV + carve, -L, L);
    return { pitch: clamp((pT - at.pitch) * DRONE.KA, -DRONE.RMAX, DRONE.RMAX), roll: clamp(wrapAngle(bT - at.bank) * DRONE.KA, -DRONE.RMAX, DRONE.RMAX), yaw: om };
  }

  // A winged drone's law (Vessel.turnTarget, a drone with a wing): bank to turn and the nose follows round
  // (coordinated), the stick ahead dives it and back climbs it, let go and it holds the height it was let go at; slow
  // (under 1.25 × its stall speed) the nose goes no higher and the bank no further than 29°. Acro: rates. Never the
  // plane's laws (planeTarget: a plane's alone) and never their state (altHold, pitchHold, holdPitch).
  function wingTurn(v, c, dt) {
    const dl = state(v), W = DRONE.WING;
    if (v.sas === 'acro') return { pitch: -c.v * W.ACRO[0], roll: c.h * W.ACRO[1], yaw: c.r * W.ACRO[2] };
    if (dl.auto) c = dl.auto.stick || NOSTICK; // (Home or the AI: a stick of their own)
    const at = v.attitude(), alt = v.altitude(), sp = Math.max(v.speed(), 5);
    if (Math.abs(c.v) > 0.02 || dl.wh == null) dl.wh = alt; // (let go: hold the height it was let go at)
    let pT = Math.abs(c.v) > 0.02 ? -c.v * (c.v > 0 ? W.DIVE : W.CLIMB) : clamp((dl.wh - alt) * W.HOLDK - v.vSpeed() * W.VSK, -W.PCAP, W.PCAP);
    let bT = c.h * W.BANK;
    const vs = Math.sqrt((2 * v.mass * G0) / (Math.max(airDensity(v.body, alt), 0.01) * Math.max(v.clS, 1e-3)));
    if (sp < W.STALL * vs) { pT = Math.min(pT, 0); bT = clamp(bT, -W.SBANK, W.SBANK); }
    const om = (G0 * Math.tan(clamp(at.bank, -1.2, 1.2))) / sp;
    return { pitch: clamp((pT - at.pitch) * W.KA + om * Math.sin(at.bank), -2, 2), roll: clamp(wrapAngle(bT - at.bank) * W.KA, -3, 3), yaw: om * Math.cos(at.bank) + c.r * W.RUD };
  }

  // ---------------------------------------------------------------- the builder's numbers, and what fits a bay
  // A list of parts from parts, design rows ({type, x, y, …}) or template rows ([type, x, y, rot, {z, att}]).
  function partsOf(list) {
    if (!Array.isArray(list)) return [];
    if (!list.length || list[0].def) return list;
    return partsFromDesign(list.map((r) => (Array.isArray(r) ? { type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: r[1] < 0, ...(r[4] || {}) } : r)));
  }
  const hasFC = (parts) => parts.some((p) => (p.def.drone && p.def.drone.fc) || p.type === 'droneCore');
  const isWinged = (parts) => parts.some((p) => p.def.wing && !p.def.wing.control) && !parts.some((p) => p.def.air && p.def.air.kind === 'rotor' && p.def.thrust && !p.def.wing);
  // Across, as MP.measure has it: each copy's depth (a twin pair's own, pylon and all)
  function spanOf(parts) {
    let z0 = Infinity, z1 = -Infinity;
    for (const p of parts) { const half = p.def.twinZ ? Math.max(p.def.w, 0.6) / 2 : partDepth(p) / 2; for (const z of partZs(p)) { z0 = Math.min(z0, z - half); z1 = Math.max(z1, z + half); } }
    return z1 > z0 ? z1 - z0 : 0;
  }
  // The air's drag on a winged drone at v (N): its parts' drag areas, its wings' profile drag, and the induced drag of
  // the main wings carrying its weight.
  function wingDrag(kg, cdA, wings, v) {
    const q = 0.6125 * v * v;
    let D = q * cdA, S = 0, k = 0;
    for (const p of wings) { const W = wingAero(p.def, false); D += q * p.def.wing.area * W.cd0; if (!p.def.wing.control) { S += p.def.wing.area; k = Math.max(k, W.kInd); } }
    if (S > 0) D += (k * (kg * G0) * (kg * G0)) / (q * S);
    return D;
  }
  // stats(parts): what the builder shows (kg with the charge and stores; twr; the battery's Wh; hover power, W; hover
  // and cruise minutes; Level's top speed and Acro's, m/s; the lean it holds; its best link and camera; the bays it fits
  // and why the others refuse it; winged or not; how many parts). A winged drone: its cruise at 0.6 throttle (drag =
  // thrust), and its endurance there.
  function stats(list) {
    const parts = partsOf(list);
    let kg = 0, cdA = 0, T = 0, Tg = 0, Tp = 0, Tpg = 0, wh = 0, fc = null, core = false, link = null, cam = null;
    const wings = [], push = [];
    for (const p of parts) {
      const d = p.def, r = d.drone;
      kg += partKg(p);
      if (d.wing) wings.push(p); else cdA += (d.cda != null ? d.cda : 0.6 * partDims(p).w * partDepth(p)) * partZs(p).length;
      if (d.thrust && d.air && (d.air.kind === 'rotor' || d.air.kind === 'prop')) {
        const f = d.thrust * 1000, gw = (d.ispSL || 3600) / 3600;
        if (d.air.kind === 'rotor' && !d.wing) { T += f; Tg += f / gw; } else { Tp += f; Tpg += f / gw; push.push([f, d.air.v0 || 30]); }
      }
      if (p.type === 'droneCore') core = true;
      if (!r) continue;
      if (r.fc && (!fc || r.fc.vmax > fc.vmax)) fc = r.fc;
      if (r.cell) wh += (d.fuel || 0) * 1e6;
      if (r.link && (!link || r.link.range > link.range)) link = r.link;
      if (r.cam && (!cam || (!!r.cam.gimbal !== !!cam.gimbal ? r.cam.gimbal : (r.cam.spot || 0) > (cam.spot || 0)))) cam = r.cam;
    }
    if (!fc && core) fc = DRONE_LEGACY.droneCore.fc;
    const F = fc || GPS;
    if (fc && fc.radio > 0 && (!link || fc.radio > link.range)) link = { kind: 'radio', range: fc.radio };
    if (core && (!link || DRONE_LEGACY.droneCore.link.range > link.range)) link = DRONE_LEGACY.droneCore.link;
    const W = kg * G0, wing = isWinged(parts), out = { kg, twr: 0, wh, hoverW: 0, hoverMin: 0, cruiseMin: 0, vTop: 0, vAcro: 0, lean: 0, hover: 0, climb: F.vz,
      link: link ? { kind: link.kind, range: link.range } : null, cam, fits: [], why: {}, wing, parts: parts.length, cdA };
    if (wing) {
      out.twr = W > 0 ? (T + Tp) / W : 0;
      if (Tp > 0 && W > 0) {
        const thr = (v) => push.reduce((s, [f, v0]) => s + 0.6 * f * Math.min(1, v0 / Math.max(v, 1)), 0); // (a propeller: full thrust to its v0, then constant power)
        let lo = 1, hi = 200;
        for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (thr(m) > wingDrag(kg, cdA, wings, m)) lo = m; else hi = m; }
        out.vTop = out.vAcro = lo;
        const P = (Tpg / G0) * 1000; // (W at full thrust: each motor's grams of thrust over its grams per watt)
        out.cruiseMin = P > 0 ? (wh * 60) / (0.6 * P) : 0;
      }
    } else if (T > 0 && W > 0) {
      const gw = T / Tg; // (grams per watt, the motors' thrust-weighted harmonic mean)
      out.twr = T / W; out.hover = W / T;
      out.hoverW = (kg * 1000) / gw; out.hoverMin = out.hoverW > 0 ? (wh * 60) / out.hoverW : 0; out.cruiseMin = 0.9 * out.hoverMin;
      const vLean = (th) => Math.sqrt((W * Math.tan(th)) / (0.6125 * Math.max(cdA, 1e-6) * (1 + 1.5 * Math.sin(th) ** 2)));
      const lmax = Math.acos(Math.min(1, 1 / out.twr)), leff = Math.min(F.lean, lmax);
      const theq = (v) => { let th = 0; for (let i = 0; i < 3; i++) th = Math.atan((0.6125 * cdA * (1 + 1.5 * Math.sin(th) ** 2) * v * v) / W); return th; };
      let v = Math.min(F.vmax, vLean(leff));
      for (let i = 0; i < 4; i++) v = Math.min(vLean(leff), F.vmax - theq(v) / DRONE.KV);
      out.vTop = Math.max(0, v); out.vAcro = vLean(lmax); out.lean = leff;
    }
    for (const k in PARTS) { const D = PARTS[k].dock; if (!D) continue; const f = fits(parts, D); if (f.ok) out.fits.push(k); else out.why[k] = f.why; }
    return out;
  }

  // Does a design fit a bay (def.dock)? { ok, why } with the picker's words. A design object ({ kind, parts }) must be a
  // drone; rows or parts are taken as one.
  function fits(x, D) {
    const design = x && !Array.isArray(x) ? x : null, parts = partsOf(design ? design.parts : x);
    if (!D) return { ok: false, why: 'Not a drone bay' };
    if ((design && design.kind !== 'drone') || !parts.length || !hasFC(parts)) return { ok: false, why: 'Not a drone' };
    if (parts.some((p) => p.def.gv || p.def.dock)) return { ok: false, why: 'Armour parts don\'t fly' };
    if (parts.length > DRONE.MAX_PARTS) return { ok: false, why: `Too many parts: ${parts.length} of ${DRONE.MAX_PARTS}` };
    const cost = designCost(parts), kg = parts.reduce((s, p) => s + partKg(p), 0), span = spanOf(parts);
    if (cost > D.budget) return { ok: false, why: `Too dear: ${money(cost)} of ${money(D.budget)}` };
    if (kg > D.kg) return { ok: false, why: `Too heavy: ${num(kg)} of ${num(D.kg)} kg` };
    if (span > D.span + 1e-9) return { ok: false, why: `Too wide: ${num(span)} of ${num(D.span)} m` };
    const wing = isWinged(parts);
    if (D.wing && !wing) return { ok: false, why: 'Takes winged drones only' };
    if (!D.wing && wing) return { ok: false, why: 'Takes multirotors only' };
    return { ok: true, why: null };
  }

  // A bay's chosen drone, from a design, a code or a save (untrusted): { key } for a stock drone, { name, parts } for a
  // saved one (its rows cleaned: at most 40, a controller, no armour part), else null (the bay's stock drone).
  function cleanChoice(d) {
    if (!d || typeof d !== 'object') return null;
    if (d.key != null) return typeof d.key === 'string' && typeof TEMPLATES !== 'undefined' && hasOwn(TEMPLATES, d.key) && TEMPLATES[d.key].kind === 'drone' ? { key: d.key } : null;
    if (!Array.isArray(d.parts) || d.parts.length > DRONE.MAX_PARTS) return null;
    const ps = partsFromDesign(d.parts);
    if (!ps.length || ps.length > DRONE.MAX_PARTS || !hasFC(ps) || ps.some((p) => p.def.gv || p.def.dock)) return null;
    return { name: (typeof d.name === 'string' && d.name.trim() ? d.name : 'Drone').slice(0, 40), parts: designRows(ps) };
  }
  // A choice's design rows (a stock drone's as the builder loads its template).
  function choiceRows(c) {
    if (!c) return null;
    if (c.key) {
      const T = typeof TEMPLATES !== 'undefined' && hasOwn(TEMPLATES, c.key) ? TEMPLATES[c.key] : null;
      if (!T) return null;
      return typeof templateRows === 'function' ? templateRows(T) : T.parts.map((r) => ({ type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: r[1] < 0, ...(r[4] || {}) }));
    }
    return Array.isArray(c.parts) ? c.parts : null;
  }
  // A drone vessel from design rows, as Flight.start builds a craft (the part tree holding its controller), its motors on,
  // flying Level; not yet placed. null with no controller.
  function build(rows, name) {
    const parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts);
    if (!ctrl) return null;
    const keep = componentOf(ctrl.id, adjAll), ps = parts.filter((p) => keep.has(p.id)), adj = new Map();
    for (const p of ps) if (p.att != null && !keep.has(p.att)) p.att = null;
    for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
    const v = new Vessel(ps, adj, EARTH);
    v.kind = 'drone'; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups();
    for (const p of v.parts) if (p.def.thrust) p.active = true;
    v.stageIdx = v.stages.length; v.sas = 'hold'; v.throttle = v.aircraft ? 0.8 : 0;
    v.name = typeof name === 'string' && name ? name.slice(0, 40) : 'Drone';
    return v;
  }

  // ---------------------------------------------------------------- helpers
  const isDrone = (o) => !!o && o.kind === 'drone' && !!o.control && !o.dead && !o.isDebris && !o.landed;
  const fcOf = (v) => (v && v.dr ? v.dr.fc : null);
  function linkOf(v) { // (the link in use, else the furthest-reaching aboard)
    if (!v || !v.dr) return null;
    if (v.dl && v.dl.via) return v.dl.via;
    let best = null;
    for (const l of v.dr.links) if (!best || l.L.range > best.range) best = l.L;
    return best;
  }
  const list = (F) => (F && F.vessels ? F.vessels.filter((o) => o.kind === 'drone' && !o.dead && !o.isDebris) : []);

  // ================================================================ HUD (the FPV on-screen display, marks, alarms, help)
  function drawOSD(ctx, W, H, dpr, F) {}
  function drawMarks(ctx, W, H, dpr, F) {}
  function alarm(F) {}
  function help(F) { return null; }

  // ================================================================ bays (the key, launch, back, Home, Land, docking, a
  // lost drone, LAST FLIGHT, saves)
  function key(F) { return false; }
  function launch(F, C) { return false; }
  function back(F) { return false; }
  function home(F, v) { return false; }
  function land(F, v) { return false; }
  function lost(F, v, why) { return false; }
  function lastFlight(F, C) {}
  function endLastFlight(F) {}
  function forSave(data, F) { return data; }

  // ================================================================ combat (fuses and warheads, the counter-drone kit)
  // (Combat.step, every physics substep while Combat.S.dr: fuses, docking, the anti-drone guns and lasers)
  function step(h, F) {}
  // (Combat.frame, every frame while Combat.S.dr: links, batteries' hand-backs, a carrier's LAST FLIGHT, clean-up, AI
  // launches, the marks, alarms)
  function frame(F, dt) {}
  function detonate(v, F, at, hv, hp, why) { return false; }
  // (Combat.destroyPart's third line: a warhead at 0 hp; false: the part goes the usual way)
  function cookOff(v, p, cause, sim) { return false; }
  function netFire(g, p, h, F) {}
  function threats(o, F) { return []; }
  function marked(viewer, d) { return false; }
  function seeR(v) { return 0; }
  function spotR(v) { return 0; }
  function ownedAir(F, owner) { return []; }

  // ================================================================ AI
  function spawnAI(F, key, at, team, opts) { return null; }
  function aiSteer(v, F, dt) { return null; } // (an AI drone's autopilot target; null: it hovers)

  // ================================================================ MP
  // (mp.js carries a second craft's messages: the craft index c, tc, extras)

  const api = {
    // physics
    groups, pre, turn, wingTurn, stats,
    // bays
    fits, cleanChoice, choiceRows, build,
    // flight
    key, launch, back, home, land, lost, lastFlight, endLastFlight, forSave,
    // combat
    step, frame, detonate, cookOff, netFire, threats, marked, seeR, spotR, ownedAir,
    // AI
    spawnAI, aiSteer,
    // HUD
    drawOSD, drawMarks, alarm, help,
    // helpers
    isDrone, fcOf, linkOf, charge, list, hframe,
  };
  return api;
})();
