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
  JET_V: 4, JET_R: 3,                 // a warhead's jet along the way it flies from this speed (m/s; slower along its nose); how far ahead it still meets a plate (m)
  LINK: { DT: 0.2, LOS_DT: 0.5, LOS_N: 10, LOS_K: 0.35, STATIC: 0.6, LAG: 0.4, LAGMAX: 0.2, LOST: 0.15, LOST_T: 0.5,
          BACK: 0.35, BACK_T: 0.5, HANDBACK: 5, JAM_IN: 0.005, LOSE: 0.25, HOLD: 2.5, K: { radio: 1, long: 0.6, sat: 0.25, fibre: 0 }, STATION: 3, HOME_UP: 2 },
          // (the drones' balance) a jammer cuts a link's quality from its reach R down to JAM_IN·R (smoothstep), so it is lost
          // about LOSE·R out (JAM_IN was 0.35: lost about half way in); a lost link holds the last stick HOLD s before the
          // failsafe acts
  BATT: { WARN: 0.25, CRIT: 0.10, AUTO: 0.05, AUTO_T: 2, AUTO_V: 2, LEAK: 0.1 }, // (LEAK: a cell under half its hp loses this share of its full charge a second per (0.5 − hp fraction): 1 %/s at 40 % hp, 4 %/s at 10 %)
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
    o.fx = fx; o.fy = fy; o.fz = fz; o.rx = rx; o.ry = ry; o.rz = rz; // (the frame's own axes: the bays' Home steers in it)
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
  // Home: the bays' steering (homeSteer: to its dock, or where it took off; a winged drone circles its carrier).
  // Unattended (hold): a multirotor hovers, a winged drone circles where it was left (the bays' circleSteer).
  const holdAuto = (S) => ({ vf: 0, vr: 0, vz: null, yawTo: S.head });
  const landAuto = (S, agl, v0) => ({ vf: 0, vr: 0, vz: agl < DRONE.LANDH ? -DRONE.LAND : -(v0 || 3), yawTo: S.head, land: true });
  function homeAuto(v, dl, S, sim) { return homeSteer(v, dl, S, sim); }

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
    if (!dl.lost) { const H = dl.held || (dl.held = { v: 0, h: 0, r: 0, z: 0 }); H.v = c.v || 0; H.h = c.h || 0; H.r = c.r || 0; H.z = c.z || 0; } // (the stick as the link last carried it)
    const hold = dl.lost && !(dl.lostT >= DRONE.LINK.HOLD) && (v.ai ? !!v.ai.drone : dl.mode === 'pilot' && !!dl.held); // (a lost link, its failsafe not yet acting)
    // 1. overrides (each zeroes the stick, so a key held at a switch never flies the drone off)
    if (dl.hop > 0) { // (a bay's hop: up off the deck to LAUNCH.HOP m over it, quick, then held there)
      dl.hop -= dt; zero(c);
      dl.auto = { vf: 0, vr: 0, vz: dl.hopAlt != null ? clamp((dl.hopAlt - alt) * 4, -DRONE.VHOLD, F.vz + 2) : 4, yawTo: S.head, hop: true };
    }
    else if (hold && !v.ai) { c.v = dl.held.v; c.h = dl.held.h; c.r = dl.held.r; c.z = dl.held.z; } // (the drones' balance: its receiver holds the last stick for LINK.HOLD s, so a drone already diving at a tank can finish its dive; the AI's flies on as it was)
    else if (dl.lost && !hold) {
      zero(c);
      if (F.fs === 'drop') { v.throttle = 0; return; } // (an FPV controller lets it fall)
      dl.auto = homeAuto(v, dl, S, sim);
    } else if (dl.mode === 'home' || dl.mode === 'land' || dl.mode === 'hold') {
      zero(c);
      const agl = alt - groundUnder(v, dl, S);
      dl.auto = dl.mode === 'home' ? homeAuto(v, dl, S, sim) : dl.mode === 'land' ? landAuto(S, agl) : dr.wing ? circleSteer(v, dl, S) : holdAuto(S);
    } else if (v.ai && v.ai.drone) { zero(c); dl.auto = api.aiSteer(v, sim, dt) || holdAuto(S); }
    // a multirotor short of motors spins and sinks (the stick still works: control first)
    const alive = dr.rotors.length;
    dl.spin = dr.lift && dr.mot0 > 0 && dr.mot0 - alive >= (dr.mot0 > 4 ? 2 : 1);
    // 2. Acro, or a winged drone: the throttle is the pilot's (the lever ramps it), kept off idle in the air. An autopilot
    // (Home, Land, the unattended hold, a lost link's failsafe, a hop) flies a multirotor by the Level law whatever
    // mode the pilot left it in (spec §12.5: hover autopilots use the Level law).
    if ((v.sas === 'acro' && !dl.auto) || v.aircraft) {
      if (!v.aircraft) dl.hold = null; // (an autopilot taking over holds the height it finds, not Level's last)
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
    if (A && A.hop && dl.hopAlt != null) dl.hold = Math.max(dl.hold, dl.hopAlt - (alt - agl)); // (after the hop: held at the hop's height)
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
    if (v.sas === 'acro' && !dl.auto) return { pitch: -c.v * DRONE.ACRO[0], roll: c.h * DRONE.ACRO[1], yaw: Y != null ? Y : c.r * DRONE.ACRO[2] };
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
    if (v.sas === 'acro' && !dl.auto) return { pitch: -c.v * W.ACRO[0], roll: c.h * W.ACRO[1], yaw: c.r * W.ACRO[2] }; // (an autopilot flies its own law)
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
    const free = freeBays();
    for (const k in PARTS) { const D = PARTS[k].dock; if (!D) continue; const f = fits(parts, D, free); if (f.ok) out.fits.push(k); else out.why[k] = f.why; }
    return out;
  }

  // (the drones' balance) The way a drone's camera looks, in the sim (render3d's fpvEye, without the eye): a gimbal
  // along the heading, level, turned by Flight.gim; an FPV camera along the frame tilted up by its tilt (70° down at a
  // drop with a bomb selected); with no camera, the frame's +x. The Mini Missiles' seeker looks the same way (Combat's
  // lock), so what is near the middle of the picture is what it locks.
  const CAMT = { x: 0, y: 0, z: 0 };
  function camDir(v, F, out) {
    out = out || { x: 0, y: 0, z: 0 };
    const cp = v && v.dr && v.dr.cam, c = cp && cp.def.drone.cam;
    if (!c) return v.axis(1, 0, 0, out);
    if (c.gimbal) {
      const r = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r, f = v.axis(1, 0, 0, CAMT), k = f.x * ux + f.y * uy + f.z * uz;
      let fx = f.x - ux * k, fy = f.y - uy * k, fz = f.z - uz * k;
      if (Math.hypot(fx, fy, fz) < 1e-6) { fx = -uy; fy = ux; fz = 0; }
      const L = Math.hypot(fx, fy, fz) || 1; fx /= L; fy /= L; fz /= L;
      const rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux;
      const G = (F && F.gim) || { yaw: 0, pitch: 0 }, cy = Math.cos(G.yaw || 0), sy = Math.sin(G.yaw || 0), cpi = Math.cos(G.pitch || 0), spi = Math.sin(G.pitch || 0);
      const hx = fx * cy + rx * sy, hy = fy * cy + ry * sy, hz = fz * cy + rz * sy;
      out.x = hx * cpi + ux * spi; out.y = hy * cpi + uy * spi; out.z = hz * cpi + uz * spi;
      return out;
    }
    const sys = typeof Combat !== 'undefined' ? Combat.systems(v)[v.wsel] : null, t = sys && sys.w.kind === 'bomb' ? -1.2217 : c.tilt || 0;
    return v.axis(Math.cos(t), Math.sin(t), 0, out);
  }
  // (the drones' balance) Is a bay's price cap off? In sandbox play (Career.sandbox) and in a sandbox room a bay takes a
  // drone of any price; career, battles and the rooms' battles keep the cap (F: a flight, for its room's mode)
  function freeBays(F) {
    if (typeof MP !== 'undefined' && MP.live && MP.state) return MP.state.mode === 'sandbox';
    if (F && F.mp) return F.mp.mode === 'sandbox';
    return typeof Career !== 'undefined' && !!Career.sandbox;
  }
  // Does a design fit a bay (def.dock)? { ok, why } with the picker's words. A design object ({ kind, parts }) must be a
  // drone; rows or parts are taken as one. free: no price cap (freeBays): its weight, width, parts and kind still count.
  function fits(x, D, free) {
    const design = x && !Array.isArray(x) ? x : null, parts = partsOf(design ? design.parts : x);
    if (!D) return { ok: false, why: 'Not a drone bay' };
    if ((design && design.kind !== 'drone') || !parts.length || !hasFC(parts)) return { ok: false, why: 'Not a drone' };
    if (parts.some((p) => p.def.gv || p.def.dock)) return { ok: false, why: 'Armour parts don\'t fly' };
    if (parts.length > DRONE.MAX_PARTS) return { ok: false, why: `Too many parts: ${parts.length} of ${DRONE.MAX_PARTS}` };
    const cost = designCost(parts), kg = parts.reduce((s, p) => s + partKg(p), 0), span = spanOf(parts);
    if (cost > D.budget && !free) return { ok: false, why: `Too dear: ${money(cost)} of ${money(D.budget)}` };
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
  // The camera's field of view: an FPV camera's own (100°), no wider than FPV_FOV; a gimbal's by its zoom (1×, 4×, 12×:
  // 60°, 15°, 5°). Spec I19: FPV at 100° only if it costs no more than 1.10× the chase view's GPU time, else 90°. The bench
  // (render-bench.mjs fpv, fpvfast, fpvchase: a Bumble 20 m over a TK-34 in Highland Ridge's village, after the haze)
  // measured 100° at 0.79-0.93× the chase view's gpuMs (phone and desktop, Low and High): it stays 100°.
  const FPV_FOV = 100, GIMBAL_FOV = [60, 15, 5];
  function fov(v, F) {
    const c = v && v.dr && v.dr.cam ? v.dr.cam.def.drone.cam : null;
    if (!c) return 50;
    if (c.gimbal) return GIMBAL_FOV[(F && F.gim && F.gim.zoom) || 0] || c.fov || 60;
    return Math.min(c.fov || FPV_FOV, FPV_FOV);
  }
  // What the HUD shares with the other sections: jamN (the enemy drones our jammers hold now: the combat section's), hitAt
  // (the carrier last hit, F.time: the bays' alarm), pulse (a static cut's start, F.time: a launch), and the ZOOM pill's
  // place this frame (tap targets are registered per drawn frame).
  const hud = { jamN: 0, hitAt: -1e9, pulse: -1e9, zoomBox: null };
  const OSDF = '700 13px "Chakra Petch", ui-monospace, monospace', BIGF = '700 22px "Chakra Petch", ui-monospace, monospace';
  const WHITE = '#ffffff', AMBER = '#ffb547', RED = '#ff5d5d', GREY = '#a7b0ba', EDGE = 'rgba(8, 11, 16, 0.7)';
  const two = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
  const clock = (s) => `${Math.floor(Math.max(0, s) / 60)}:${two(Math.max(0, s) % 60)}`;
  const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

  // Drones left in a vehicle's bays (a bay never launched from holds its full count).
  function left(v) {
    let n = 0;
    for (const p of v.docks || NO_GEAR) n += p.docked == null ? p.def.dock.n : Math.max(0, p.docked | 0);
    return n;
  }
  // The battery: its charge (q, 0..1) and the words ("78% · 6:12": minutes left at the last second's average draw).
  function batt(v, F) {
    const q = charge(v), dr = v.dr, wh = q * (dr ? dr.wh0 : 0), t = F && Number.isFinite(F.time) ? F.time : 0;
    const B = v._bh || (v._bh = { t, wh, P: 0 });
    if (t - B.t >= 1 || t < B.t) { const P = t > B.t ? ((B.wh - wh) * 3600) / (t - B.t) : 0; B.P = B.P ? B.P * 0.5 + P * 0.5 : P; B.t = t; B.wh = wh; }
    const min = B.P > 0.5 ? (wh / B.P) * 60 : null;
    return { q, text: `${Math.round(q * 100)}%${min != null && Number.isFinite(min) ? ` · ${clock(min * 60)}` : ''}` };
  }
  // How far the drone is from its station (where its link comes from): its carrier, else where it took off.
  function stationDist(v) {
    if (v.dl && Number.isFinite(v.dl.dist)) return v.dl.dist; // (the link's own, once the bays' link check runs)
    const C = v.carrier, at = C && !C.dead ? C : v.dl && v.dl.at0;
    return at ? Math.hypot(v.x - at.x, v.y - at.y, v.z - at.z) : 0;
  }
  // The link in words for the chase view's row ("92%", "WEAK", "LOST", "Fibre 3.1/5.0 km", "JAMMED"), and for the OSD
  // (bars, the reach, JAM, LAG, FIBRE); bad: shown red.
  function linkState(v) {
    const dl = v.dl || {}, q = dl.q == null ? 1 : dl.q, L = linkOf(v), d = stationDist(v);
    const fibre = !!L && L.kind === 'fibre', jam = !!dl.jam, lost = !!dl.lost || !!dl.snapped;
    const text = dl.snapped ? 'Fibre cut' : lost ? 'LOST' : jam ? 'JAMMED' : fibre ? `Fibre ${(d / 1000).toFixed(1)}/${(L.range / 1000).toFixed(1)} km` : q < 0.4 ? 'WEAK' : `${Math.round(q * 100)}%`;
    const bars = '▂▄▆█'.slice(0, lost ? 0 : clamp(Math.ceil(q * 4), 1, 4)).padEnd(4, '·');
    const osd = `LINK ${bars} ${lost ? (dl.snapped ? 'CUT' : 'LOST') : fibre ? `FIBRE ${(d / 1000).toFixed(1)}/${(L.range / 1000).toFixed(1)} km` : `${Math.round(q * 100)}% ${km(d)}`}${jam ? ' JAM' : ''}${L && L.kind === 'sat' ? ' LAG' : ''}`;
    return { q, text, osd, bad: lost || jam || q < 0.4, jam };
  }
  // The enemy drones our jammers hold (the combat section counts them: hud.jamN), for the JAM chip
  function jamN(F) { return hud.jamN | 0; }
  // A Level multirotor's climb lever in words, on two short lines (the throttle box's column keeps its width): ▲ climbing
  // at (m/s), ▼ descending at, else the height it holds over the ground
  function leverText(v) {
    const z = (v.ctl && v.ctl.z) || 0, vs = v.vSpeed(), dl = v.dl || {};
    if (v.landed && z <= 0) return 'LANDED';
    if (z > 0.02) return `▲ m/s\n${Math.abs(vs).toFixed(1)}`;
    if (z < -0.02) return `▼ m/s\n${Math.abs(vs).toFixed(1)}`;
    return `HOLD\n${Math.round(dl.hold != null ? dl.hold : 0)} m`;
  }
  // The flight's first hint (the chase view's #hint; FPV hides it): how a drone flies, for its first 15 s alone
  function help(F) {
    const v = F && F.active;
    if (!v || v.kind !== 'drone' || F.time > 15 || F.mp) return '';
    const k = (id) => Keys.k(id), T = typeof Controls !== 'undefined' && Controls.touch;
    if (v.aircraft) return T ? 'The stick banks and dives it; let go and it flies straight and level. The throttle box is its speed.' : `${k('left')}/${k('right')} bank it, ${k('fwd')} dives; let go and it flies level. ${k('thrUp')}/${k('thrDown')}: throttle.`;
    if (v.sas === 'acro') return T ? 'Acro: the stick turns it, nothing levels it; the throttle box is the throttle.' : `Acro: the keys turn it, nothing levels it; ${k('thrUp')}/${k('thrDown')} throttle. ${k('dLevel')}: back to Level.`;
    const tilt = typeof Settings !== 'undefined' && Settings.get('droneStick') === 'tilt'; // (the Tilt layout: A/D slide, Q/E turn; UX-P4-5)
    return T ? 'Drag the throttle box up to climb. The stick flies it; let go and it stops and hovers.' : `Hold ${k('thrUp')} to climb. ${k('fwd')}/${k('back')} fly it, ${tilt ? `${k('left')}/${k('right')} slide, ${k('rollL')}/${k('rollR')} turn` : `${k('left')}/${k('right')} turn`}; let go and it stops and hovers. ${k('dView')}: the view.`;
  }
  // The impact view (the combat section calls it when the active drone's warhead goes off): the camera hangs 12 m back
  // along the way it flew and 4 m up, looking at the blast, for IMPACT s; the HUD's controls fade (body.impactcam)
  function impactView(F, v, at) {
    if (!F || !v) return;
    const sp = v.speed() || 1, r = v.radius() || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r;
    F.impactCam = { at: { x: v.x - (v.vx / sp) * 12 + ux * 4, y: v.y - (v.vy / sp) * 12 + uy * 4, z: v.z - (v.vz / sp) * 12 + uz * 4 },
      look: { x: at ? at.x : v.x, y: at ? at.y : v.y, z: at ? at.z : v.z }, until: F.time + DRONE.IMPACT, t0: F.time };
    if (typeof document !== 'undefined' && document.body) document.body.classList.add('impactcam');
  }

  // ---------------------------------------------------------------- the OSD
  // White 13 px bold mono with a dark edge. Where its blocks go is looked up once a second from the panels on show (the
  // buttons top right, the time warp, the JAM chip, the warning's scope and lines, the mode pad, the weapon box, the
  // throttle box, the stick, the alert line, the key hints): the status block left under the top's panels (and under a
  // warning receiver's or radar's scope when there is one), the mode in the middle on the same line, the flight line over
  // the mode pad and the weapon box. The words are drawn into small cached canvases ten times a second when they change;
  // each frame draws those, the cross and the horizon (≤ 40 canvas calls). Static only while the link is weak, at a
  // launch's cut or a loss.
  const O = { at: -1e9, W: 0, H: 0, P: null, blocks: {}, noise: null, pat: null, patCtx: null, lostAt: null, wasLost: false, calls: 0 };
  function rectOf(q) {
    const e = typeof q === 'string' ? document.querySelector(q) : q;
    if (!e || e.hidden) return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null;
  }
  const meets = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  // the first place for a w × h block at x (left edge), from y down (dir 1) or up (dir −1), clear of every blocker
  function clearAt(x, y, w, h, B, dir, H) {
    for (let i = 0; i < 12; i++) {
      const a = { l: x, t: y, r: x + w, b: y + h }, hit = B.filter((b) => meets(a, b));
      if (!hit.length) return y;
      y = dir > 0 ? Math.max(...hit.map((b) => b.b)) + 6 : Math.min(...hit.map((b) => b.t)) - 6 - h;
      if (y < 0 || y + h > H) break;
    }
    return y;
  }
  // the first place for a w × h block centred on cx at y, else slid sideways (no further than 12 px from the edges) to clear
  // what it meets; null when neither does
  function clearX(cx, y, w, h, B, W) {
    let x = Math.round(cx - w / 2);
    for (let i = 0; i < 4; i++) {
      const a = { l: x, t: y, r: x + w, b: y + h }, hit = B.filter((b) => meets(a, b));
      if (!hit.length) return x;
      const b = hit[0], left = b.l - 6 - w, right = b.r + 6;
      x = Math.abs(left - x) <= Math.abs(right - x) && left >= 12 ? left : right + w <= W - 12 ? right : left;
      if (x < 12 || x + w > W - 12) return null;
    }
    return null;
  }
  // the spot nearest x0 (a left edge; 20 px steps either way) for a w × h block found by clearAt from y (dir 1 down, −1
  // up) that is on the screen, clear of every blocker and passes ok(box); null when none is
  function spotNear(x0, y, w, h, B, dir, W, H, ok) {
    for (let i = 0, n = 2 * Math.ceil(W / 20); i <= n; i++) {
      const x = Math.round(x0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 20);
      if (x < 12 || x + w > W - 12) continue;
      const yy = clearAt(x, y, w, h, B, dir, H), a = { l: x, t: yy, r: x + w, b: yy + h };
      if (yy >= 0 && yy + h <= H && !B.some((b) => meets(a, b)) && (!ok || ok(a))) return { x, y: yy };
    }
    return null;
  }
  const onClear = (a, B, W, H) => a.l >= 0 && a.t >= 0 && a.r <= W && a.b <= H && !B.some((b) => meets(a, b));
  function placeOSD(W, H, F) {
    const now = performance.now(), rb = Combat.S.rwrBox, v = F.active;
    const level = Settings.get('droneView') === 'fpvLevel' && !!(v && v.dr && !(v.dr.cam && v.dr.cam.def.drone.cam.gimbal));
    const rk = `${rb ? `${rb.x}|${rb.y}|${rb.R}|${rb.ty}|${rb.lines || 1}` : ''}|${O.fw}|${O.sw}|${O.mw}|${level}`;
    if (O.P && now - O.at < 1000 && O.W === W && O.H === H && O.rk === rk) return O.P;
    O.at = now; O.W = W; O.H = H; O.rk = rk;
    const touch = typeof Controls !== 'undefined' && Controls.touch, tr = rectOf('#flight-ui .flight-top-right'), warp = rectOf('#warp'), jam = rectOf('#jam-chip');
    const top = [tr, warp, jam, rectOf('#mp-bar'), rectOf('#gai-bar'), rectOf('#flight-alert')].filter(Boolean);
    if (rb) {
      top.push({ l: rb.x - rb.R, r: rb.x + rb.R, t: rb.y - rb.R, b: rb.y + rb.R + (rb.lines === 2 ? 28 : 14) });
      if (rb.ty != null && Combat.S.rwr > 1) top.push({ l: W / 2 - 150, r: W / 2 + 150, t: rb.ty - 22, b: rb.ty + 44 }); // (the warning's lines)
    }
    const bottom = ['#sas-bar', '#weapon-box', '#flight-ui .throttle-box', '#flight-ui .left-controls', '#key-hints', '#hint', '#flight-ui .roll-btns', '#joy-zone'].map(rectOf).filter(Boolean);
    const all = top.concat(bottom), y0 = touch && tr ? tr.b + 8 : 10;
    const sw = O.sw || 160, sh = 3 * 17 + 4, mw = O.mw || 100, mh = 2 * 17 + 4;
    const sy = clearAt(12, y0, sw, sh, all, 1, H), sBox = { l: 12, t: sy, r: 12 + sw, b: sy + sh };
    // the cross in the middle stays clear of every block (P4-OF-5, UX-P4-3)
    const cross = { l: W / 2 - 18, r: W / 2 + 18, t: H / 2 - 18, b: H / 2 + 18 }, above = (a) => a.b <= cross.t;
    // the mode: in the middle under the top's panels, else the nearest spot aside still above the cross
    const mB = all.concat([sBox]);
    let mx = Math.round(W / 2 - mw / 2), my = clearAt(mx, y0, mw, mh, mB, 1, H);
    if (!onClear({ l: mx, t: my, r: mx + mw, b: my + mh }, mB.concat([cross]), W, H)) { const q = spotNear(mx, y0, mw, mh, mB, 1, W, H, above); if (q) { mx = q.x; my = q.y; } }
    const mBox = { l: mx, t: my, r: mx + mw, b: my + mh };
    // the level view's bank arc (its ticks reach ±70 px and 52 px down from its top): under the mode, above the cross
    const aw = 140, ah = 52, ax = Math.round(W / 2 - aw / 2), aB = mB.concat([mBox]);
    let ay = clearAt(ax, y0, aw, ah, aB, 1, H), arx = ax;
    if (ay + ah > cross.t - 4 || ay < 0) { // (no room in the middle: the nearest spot aside still above the cross; else under the
      // cross; else just over it, whatever is there: the alert line is one of aB, review P5-COMBO-3)
      const q = spotNear(ax, y0, aw, ah, aB, 1, W, H, (a) => a.b <= cross.t - 4), yb = clearAt(ax, cross.b + 6, aw, ah, aB, 1, H);
      if (q) { arx = q.x; ay = q.y; } else if (onClear({ l: ax, t: yb, r: ax + aw, b: yb + ah }, aB, W, H)) ay = yb;
      else ay = Math.max(0, cross.t - 4 - ah);
    }
    const aBox = { l: arx, t: ay, r: arx + aw, b: ay + ah };
    // the flight line: centred over the pad and the weapon box; else up from there (not above the top's panels); else slid
    // aside; else under the cross; else the nearest spot up; never off the screen
    const fB = all.concat([sBox, mBox, cross], level ? [aBox] : []);
    const sas = rectOf('#sas-bar'), wb = rectOf('#weapon-box'), fy0 = Math.min(sas ? sas.t : H, wb ? wb.t : H) - 12 - 17, fw = O.fw || 200, fc = Math.round(W / 2 - fw / 2);
    const box = (x, y) => ({ l: x, t: y, r: x + fw, b: y + 17 });
    let fx = fc, fy = fy0;
    if (!onClear(box(fx, fy), fB, W, H)) {
      const up = clearAt(fc, fy0, fw, 17, fB, -1, H), sx = clearX(W / 2, fy0, fw, 17, fB, W);
      let q = up >= y0 && onClear(box(fc, up), fB, W, H) ? { x: fc, y: up } : sx != null && onClear(box(sx, fy0), fB, W, H) ? { x: sx, y: fy0 } : null;
      q = q || spotNear(fc, cross.b + 6, fw, 17, fB, 1, W, H) || spotNear(fc, fy0, fw, 17, fB, -1, W, H);
      if (q) { fx = q.x; fy = q.y; } else fy = clamp(fy0, 0, H - 17);
    }
    const zw = 84, zh = 30, zx = W - 12 - zw, zy = clearAt(zx, fy - zh - 10, zw, zh, all, -1, H);
    O.P = { s: { x: 12, y: sy, w: sw, h: sh }, m: { x: mx, y: my, w: mw, h: mh }, f: { x: fx, y: fy, w: fw, h: 17 }, z: { x: zx, y: zy, w: zw, h: zh }, a: level ? { x: arx, y: ay, w: aw, h: ah } : null, c: cross };
    return O.P;
  }
  // The OSD's blocks on the screen now (the status, the mode, the flight line, the bank arc and the centre cross, as
  // { left, top, right, bottom }) for what else is drawn over a drone's view (the hit banners: death.js drawHits, review
  // P5-COMBO-2); null while no OSD is drawn
  function osdBoxes(W, H, F) {
    const v = F && F.active, P = O.P;
    if (!P || !v || v.kind !== 'drone' || !F.fpv || F.destroyed || F.mapMode || F.impactCam || O.W !== W || O.H !== H) return null;
    const r = (p) => ({ left: p.x, top: p.y, right: p.x + p.w, bottom: p.y + p.h }), out = [r(P.s), r(P.m), r(P.f), { left: P.c.l, top: P.c.t, right: P.c.r, bottom: P.c.b }];
    if (P.a) out.push(r(P.a));
    return out;
  }
  // a block of lines ([text, colour]) drawn into its own small canvas, again only when its words change
  function block(id, lines, w, align, dpr) {
    const key = lines.map((l) => l[0] + l[1]).join('|') + dpr + w;
    let B = O.blocks[id];
    if (B && B.key === key) return B.c;
    if (!B) B = O.blocks[id] = { c: document.createElement('canvas'), key: '' };
    B.key = key;
    const c = B.c, h = lines.length * 17 + 4;
    if (c.width !== Math.ceil(w * dpr) || c.height !== Math.ceil(h * dpr)) { c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr); }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.font = OSDF; g.textAlign = align; g.textBaseline = 'top'; g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = EDGE;
    const x = align === 'center' ? w / 2 : align === 'right' ? w - 2 : 2;
    lines.forEach(([t, col], i) => { if (!t) return; g.strokeText(t, x, 2 + i * 17); g.fillStyle = col; g.fillText(t, x, 2 + i * 17); });
    return c;
  }
  // the status block's, the mode's and the flight line's words (10 Hz)
  function words(v, F) {
    const dl = v.dl || {}, B = batt(v, F), L = linkState(v), blink = Math.floor(F.time * 2.5) % 2 === 0;
    const st = [[`BAT ${B.text}`, B.q <= DRONE.BATT.CRIT ? (blink ? RED : 'rgba(255,93,93,0.35)') : B.q <= DRONE.BATT.WARN ? AMBER : WHITE], [L.osd, L.bad ? RED : WHITE]];
    const C = v.carrier;
    if (C) {
      const hp = C.dead ? 0 : Math.round((typeof Combat !== 'undefined' ? Combat.integrity(C) : 1) * 100), d = Math.hypot(v.x - C.x, v.y - C.y, v.z - C.z);
      st.push([`TANK ${C.dead || C.ko || C.wreck ? 'KO' : `${hp}%`} · ${km(d)}`, F.time - hud.hitAt < 3 || F.carrierDown ? RED : WHITE]); // (knocked out: its LAST FLIGHT)
    }
    const last = F.carrierDown && Number.isFinite(dl.lastEnd) ? `LAST FLIGHT ${clock(Math.ceil(dl.lastEnd - F.time))}` : null; // (rounded up, as the alert line's seconds: UX-P4-6)
    const mode = dl.lost ? 'LINK LOST' : last || (dl.mode === 'home' ? 'HOME' : dl.mode === 'land' || dl.autoLand ? 'LAND' : v.sas === 'acro' ? 'ACRO' : 'LEVEL');
    const m = [[mode, dl.lost || last ? RED : WHITE]];
    if (v.dr && v.dr.warheads.length) m.push(dl.arm ? ['ARMED', RED] : ['SAFE', GREY]);
    const agl = Math.max(0, v.altitude() - v.groundHeight()), vs = v.vSpeed();
    const fl = [[`ALT ${Math.round(agl)} m · ${Math.round(v.speed() * 3.6)} km/h · ${vs >= 0 ? '▲' : '▼'}${Math.abs(vs).toFixed(1)}`, WHITE]];
    // (the flight line as wide as its words, in 20 px steps: placed again when it grows past its place)
    const g = O.mg || (O.mg = document.createElement('canvas').getContext('2d'));
    g.font = OSDF;
    const wide = (L) => Math.ceil((Math.max(...L.map((l) => g.measureText(l[0]).width)) + 10) / 20) * 20;
    const fw = wide(fl), sw = wide(st), mw = wide(m);
    if (fw > (O.fw || 0)) O.fw = fw;
    if (sw > (O.sw || 0)) O.sw = sw;
    if (mw > (O.mw || 0)) O.mw = mw;
    return { st, m, fl };
  }
  // the noise: one 128 × 128 canvas, made once, drawn as a pattern at a new offset each frame
  function noisePat(ctx) {
    if (!O.noise) {
      const c = O.noise = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d'), img = g.createImageData(128, 128), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const n = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = n; d[i + 3] = 255; }
      g.putImageData(img, 0, 0);
    }
    if (O.patCtx !== ctx) { O.pat = ctx.createPattern(O.noise, 'repeat'); O.patCtx = ctx; }
    return O.pat;
  }
  // how much static: the link's (q under 0.6), a launch's cut (0.35 s), a loss (1.2 s); NO SIGNAL at q 0
  function staticK(v, F) {
    const dl = v.dl || {}, q = dl.q == null ? 1 : dl.q, t = F.time;
    if (dl.lost && !O.wasLost) O.lostAt = t;
    O.wasLost = !!dl.lost;
    const pulse = Math.max(F.dronePulse != null ? F.dronePulse : -1e9, hud.pulse);
    let a = q < 0.6 ? (0.9 * (0.6 - q)) / 0.6 : 0;
    if (t - pulse >= 0 && t - pulse < 0.35) a = Math.max(a, 0.9 * (1 - (t - pulse) / 0.35));
    if (O.lostAt != null && t - O.lostAt >= 0 && t - O.lostAt < 1.2) a = Math.max(a, 0.9 * (1 - (t - O.lostAt) / 1.2));
    return { a, none: q <= 0 || !!dl.snapped };
  }
  function drawOSD(ctx, W, H, dpr, F) {
    O.calls = 0;
    if (F.impactCam) { // (the impact view: IMPACT and the shot's result, large in the middle; then gone)
      if (!(F.time < F.impactCam.until)) { if (F.clearImpact) F.clearImpact(); return; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sh = typeof Armour !== 'undefined' && Armour.fb.shot && Armour.fb.shot.t >= F.impactCam.t0 - 0.5 ? Armour.fb.shot : null;
      const R = sh && typeof GHUD !== 'undefined' && GHUD.resultText ? GHUD.resultText(sh) : null;
      ctx.drawImage(block('imp', [['IMPACT', WHITE], [R ? R[0].toUpperCase() : '', R ? R[1] : WHITE]], 360, 'center', dpr), W / 2 - 180, H * 0.32);
      return;
    }
    const v = F.active;
    hud.zoomBox = null;
    if (!v || v.kind !== 'drone' || !F.fpv || F.destroyed || F.mapMode) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const P = placeOSD(W, H, F), cx = W / 2, cy = H / 2;
    // the static first (under the words)
    const S0 = staticK(v, F);
    if (S0.a > 0.01) {
      const ox = Math.floor(Math.random() * 128), oy = Math.floor(Math.random() * 128);
      ctx.globalAlpha = S0.a; ctx.fillStyle = noisePat(ctx);
      ctx.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr); ctx.fillRect(-ox, -oy, W, H); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) ctx.fillRect(0, Math.random() * H, W, 2 + Math.random() * 6);
      ctx.globalAlpha = 1;
      if (S0.none) ctx.drawImage(block('nosig', [['NO SIGNAL', WHITE]], 160, 'center', dpr), cx - 80, cy - 40);
      O.calls += 6;
    }
    // the cross and the horizon, every frame: one path, a dark edge under a white line
    const A = Render3D.fpvCam && Render3D.fpvCam(), r = v.radius() || 1, nx = v.x / r, ny = v.y / r, nz = v.z / r;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12);
    const level = Settings.get('droneView') === 'fpvLevel' && !(v.dr.cam && v.dr.cam.def.drone.cam.gimbal);
    if (A) {
      const D = A.D, U = A.U, Rx = D.y * U.z - D.z * U.y, Ry = D.z * U.x - D.x * U.z, Rz = D.x * U.y - D.y * U.x; // (the camera's right)
      const el = Math.asin(clamp(D.x * nx + D.y * ny + D.z * nz, -1, 1)), sx = Rx * nx + Ry * ny + Rz * nz, sy = U.x * nx + U.y * ny + U.z * nz, h = Math.hypot(sx, sy);
      if (h > 0.05 && Math.abs(el) < 1.4) {
        const f = H / 2 / Math.tan((fov(v, F) * Math.PI) / 360), a = -f * Math.tan(el), ex = sx / h, ey = sy / h, hx = cx + a * ex, hy = cy - a * ey, L = W * 0.4;
        ctx.moveTo(hx - ey * L, hy - ex * L); ctx.lineTo(hx + ey * L, hy + ex * L);
      }
    }
    if (level) { // (the horizon held level: the drone's bank as a tick on an arc at the top)
      const b = clamp(v.attitude().bank, -1.2, 1.2), R0 = 70, ay = P.a ? P.a.y + R0 + 4 : P.m.y + P.m.h + R0 + 12, ax = P.a ? P.a.x + P.a.w / 2 : cx; // (its spot from placeOSD: clear of the words and the cross)
      ctx.moveTo(ax + R0 * Math.sin(-0.8), ay - R0 * Math.cos(-0.8)); ctx.arc(ax, ay, R0, -Math.PI / 2 - 0.8, -Math.PI / 2 + 0.8);
      ctx.moveTo(ax + (R0 - 8) * Math.sin(b), ay - (R0 - 8) * Math.cos(b)); ctx.lineTo(ax + (R0 + 4) * Math.sin(b), ay - (R0 + 4) * Math.cos(b));
    }
    ctx.lineCap = 'round'; ctx.strokeStyle = EDGE; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5; ctx.stroke();
    O.calls += 13;
    // thermal: vehicles within the camera's reach as bright boxes, through smoke (a gimbal's)
    const cam = v.dr.cam && v.dr.cam.def.drone.cam; // (a camera shot off: the drone flies on, no thermal: FEEL-1)
    if (cam && cam.gimbal && F.gim && F.gim.thermal) {
      const bp = bodyPos(v.body, F.time), spot = cam.spot || 3000, list = [];
      for (const o of F.vessels) {
        if (o === v || o.dead || o.isDebris || !o.parts.length || o.kind === 'drone' || !(isGround(o.kind) || o.gv || (o.gear && o.gear.length))) continue;
        const d = Math.hypot(o.x - v.x, o.y - v.y, o.z - v.z);
        if (d < spot) list.push([d, o]);
      }
      list.sort((a, b) => a[0] - b[0]);
      ctx.beginPath();
      for (const [d, o] of list.slice(0, 8)) {
        const p = Render3D.project(bp.x + o.x, bp.y + o.y, o.z);
        if (p.behind) continue;
        const s = clamp((Math.max(o.bounds.maxX - o.bounds.minX, 3) * (H / 2)) / Math.tan((fov(v, F) * Math.PI) / 360) / Math.max(d, 1) / 2, 6, 120);
        ctx.rect(p.x - s, p.y - s * 0.6, 2 * s, 1.2 * s);
      }
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff6c8'; ctx.stroke();
      O.calls += 4 + Math.min(8, list.length);
    }
    // the words: cached, redrawn ten times a second when they change
    if (!O.w || F.time - O.wt >= 0.1 || F.time < O.wt) { O.w = words(v, F); O.wt = F.time; }
    ctx.drawImage(block('st', O.w.st, P.s.w, 'left', dpr), P.s.x, P.s.y);
    ctx.drawImage(block('m', O.w.m, P.m.w, 'center', dpr), P.m.x, P.m.y);
    ctx.drawImage(block('fl', O.w.fl, P.f.w, 'center', dpr), P.f.x, P.f.y);
    O.last = P; // (where the blocks went this frame: the tests read it)
    O.calls += 3;
    // the ZOOM pill (a gimbal, touch): tap steps the zoom, hold for thermal
    if (cam && cam.gimbal && Controls.touch) {
      const z = P.z, g = F.gim || { zoom: 0 }, t = `ZOOM ×${[1, 4, 12][g.zoom] || 1}${g.thermal ? ' · TH' : ''}`;
      ctx.drawImage(pill(t, z.w, z.h, dpr), z.x, z.y);
      hud.zoomBox = z;
      O.calls += 1;
    }
  }
  function pill(t, w, h, dpr) {
    const key = t + dpr;
    let B = O.blocks.pill;
    if (B && B.key === key) return B.c;
    if (!B) B = O.blocks.pill = { c: document.createElement('canvas'), key: '' };
    B.key = key;
    const c = B.c; c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = 'rgba(8, 13, 24, 0.6)'; g.strokeStyle = 'rgba(255, 255, 255, 0.7)'; g.lineWidth = 1;
    g.beginPath(); g.roundRect ? g.roundRect(0.5, 0.5, w - 1, h - 1, h / 2) : g.rect(0.5, 0.5, w - 1, h - 1); g.fill(); g.stroke();
    g.font = '700 12px "Chakra Petch", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = WHITE; g.fillText(t, w / 2, h / 2 + 1);
    return c;
  }
  // A tap on the view in FPV (flight.js): the ZOOM pill's (a tap steps the zoom round, a press over 0.5 s is thermal);
  // true when it was on the pill
  function tap(F, x, y, held) {
    const z = hud.zoomBox;
    if (!z || x < z.x || x > z.x + z.w || y < z.y || y > z.y + z.h || !F.gimbalOn || !F.gimbalOn()) return false;
    if (held >= 500) F.gimbalThermal();
    else F.gimbalZoom(F.gim.zoom >= 2 ? -2 : 1);
    if (typeof haptic === 'function') haptic(10);
    return true;
  }
  // The carrier hit while its drone flies (Combat.damage's one line, a parked carrier; a room's hit message): the screen's
  // edge flashes red (#sight-vig.alarm, 0.6 s), a buzz, two low beeps, and for 3 s the alert line (alertText) and the
  // OSD's TANK line in red. Once every half second at most.
  function alarm(F) {
    if (!F) return;
    const t = Number.isFinite(F.time) ? F.time : 0;
    if (t >= hud.hitAt && t - hud.hitAt < 0.5) return;
    hud.hitAt = t;
    const later = typeof setTimeout === 'function';
    if (typeof document !== 'undefined' && document.getElementById) {
      const e = document.getElementById('sight-vig');
      if (e) { e.classList.add('alarm'); if (later) { clearTimeout(hud.vigT); hud.vigT = setTimeout(() => e.classList.remove('alarm'), 600); } }
    }
    if (typeof haptic === 'function') haptic([80, 40, 80]);
    beep(520); if (later) setTimeout(() => beep(520), 160);
    if (F.updateHUD) F.updateHUD(true);
  }
  // What the alert line (#flight-alert) says first while a drone from a bay is flown (Flight.updateHUD, plan I6): the
  // LAST FLIGHT's count, else the tank hit (3 s); null: the other warnings have it
  function alertText(F) {
    const A = F && F.active;
    if (!A || !A.carrier || F.destroyed) return null;
    const t = F.time || 0;
    if (F.carrierDown && A.dl && Number.isFinite(A.dl.lastEnd)) return `Your tank is knocked out! Last flight: ${Math.max(0, Math.ceil(A.dl.lastEnd - t))} s`;
    if (t >= hud.hitAt && t - hud.hitAt < 3) return `YOUR TANK IS HIT · ${typeof Controls !== 'undefined' && Controls.touch ? 'tap Tank' : `${keyName('drone')}: back`}`;
    return null;
  }

  // ================================================================ bays (the key, launch, back, Home, Land, docking, a
  // lost drone, LAST FLIGHT, saves)
  // A tank's bays (def.dock: a Drone Rack, a Drone Hangar, Launch Tubes) carry drones it launches and flies (U), parked
  // meanwhile with its crew still at work. A drone from a bay is a vessel of its own in F.vessels (v.carrier: its tank,
  // v.bay: its dock part; C.drone: the one it has up); it docks again (Home, or U over the bay), is lost (shot down, its
  // battery flat: control goes back to the tank at once), or flies a LAST FLIGHT of 20 s when the tank is knocked out
  // under it. A bay drone is never saved: a save puts it back in its bay.
  const DOCK_ORDER = ['dockRack', 'dockHangar', 'dockTubes'];
  const keyName = (id) => (typeof Keys !== 'undefined' && Keys.k ? Keys.k(id) : id);
  const left1 = (p) => (p.docked == null ? p.def.dock.n : Math.max(0, p.docked | 0)); // (drones left in one bay)
  const upAt = (o) => { const r = o.radius() || 1; return { x: o.x / r, y: o.y / r, z: o.z / r }; };
  const live = (d) => !!d && !d.dead && d.hulk == null && !d.isDebris && !!d.control && d.parts.length > 0; // (a drone still flying for someone)
  // the middle of a bay's top face, in the sim's axes
  function dockTop(C, p) { const R = partRect(p); return C.toWorld((R.l + R.r) / 2, R.t, partZc(p)); }
  // is a tank there to fly from: on the flight's list, not knocked out, not a wreck, with its controls
  const carrierUp = (C, F) => !!C && !C.dead && !C.ko && !C.wreck && !!C.control && C.parts.length > 0 && (!F || !F.vessels || F.vessels.includes(C));
  // who brought a drone down: the credited killer, else the last hitter within 20 s
  const whoDid = (d, F) => d.doomBy || (d.lastHitBy && d.lastHitBy !== d && (F.time || 0) - (d.lastHitAt ?? -99) < 20 ? d.lastHitBy : null);
  const mpDrop = (F, d, how, by) => { if (F && F.mp && typeof MP !== 'undefined' && typeof MP.dropExtra === 'function') MP.dropExtra(d, how, by); };
  // a drone's view's natural scale (Flight's, else the same sums)
  const scaleOf = (F, v) => (F && F.naturalScale ? F.naturalScale(v) : DRONE.LAUNCH.SCALE);
  // Is the drone over its bay: within R m of the bay's top across, its lowest point at most H m over it (and not more than
  // half a metre under), and slower than V m/s against the tank?
  function overBay(v, R, H, V) {
    const C = v.carrier, bay = v.bay;
    if (!C || !bay || !C.parts.includes(bay)) return false;
    const T = dockTop(C, bay), U = upAt(C), dx = v.x - T.x, dy = v.y - T.y, dz = v.z - T.z, k = dx * U.x + dy * U.y + dz * U.z;
    const across = Math.hypot(dx - U.x * k, dy - U.y * k, dz - U.z * k), over = k - (v.com.y - v.bounds.minY);
    if (across > R || over > H || over < -0.5) return false;
    const pv = C.pointVel({ x: T.x - C.x, y: T.y - C.y, z: T.z - C.z });
    return Math.hypot(v.vx - pv.x, v.vy - pv.y, v.vz - pv.z) < V;
  }

  // The drone key (U) and the DRONE button: launch from a tank with a bay; from it, take its drone again (Level, homing
  // stopped; not while its link is lost); from the drone, dock when over its bay, else back to the tank (it holds); in a
  // LAST FLIGHT, end it. true when something happened.
  function key(F) {
    const A = F && F.active;
    if (!A || F.destroyed) return false;
    if (A.carrier) {
      if (F.carrierDown) return endLastFlight(F);
      const H = DRONE.HOME;
      if (overBay(A, H.NEAR_R, H.NEAR_H, DRONE.HOME.DOCK_V)) { dock(F, A); return true; }
      return back(F);
    }
    if (A.docks && A.docks.length) {
      const d = A.drone;
      if (live(d) && F.vessels.includes(d)) return take(F, d);
      return launch(F, A);
    }
    say(F, 'No drone bay aboard');
    return false;
  }
  // Take a bay's drone again, by U or a tap on it (Flight.switchTo hands a tap here): Level, homing stopped; not while its
  // link is lost (spec §12.1)
  function take(F, d) {
    const dl = state(d);
    if (dl.lost) { say(F, 'No link to the drone', 'warn'); return false; }
    if (dl.mode === 'home' || dl.mode === 'land') d.sas = 'hold'; // (homing stops: Level takes over)
    dl.mode = 'pilot'; dl.autoLand = false;
    F.switchTo(d, true, true);
    say(F, `${d.name} · ${keyName('drone')}: back to the tank`);
    return true;
  }

  // The bay's drone (spec §12.2): the tank's chosen design when it fits that bay, else the bay's stock drone (said once
  // per tank). { rows, name } or null (no design to launch).
  function pickDesign(F, C, bay) {
    const D = bay.def.dock, c = C.droneChoice, rows = c ? choiceRows(c) : null;
    const T = typeof TEMPLATES !== 'undefined' && D.stock && hasOwn(TEMPLATES, D.stock) && TEMPLATES[D.stock].kind === 'drone' ? TEMPLATES[D.stock] : null;
    const name = c ? (c.key ? (T && c.key === D.stock ? T.name : typeof TEMPLATES !== 'undefined' && hasOwn(TEMPLATES, c.key) ? TEMPLATES[c.key].name : 'Drone') : c.name) : null;
    if (rows && fits({ kind: 'drone', parts: rows }, D, freeBays(F)).ok) return { rows, name: name || 'Drone' };
    if (!T) return null;
    if (rows && C._fitSaid !== bay.type) { C._fitSaid = bay.type; say(F, `The ${name} doesn't fit a ${bay.def.name}: launching a ${T.name}`, 'warn'); }
    return { rows: choiceRows({ key: D.stock }), name: T.name };
  }

  // Launch the first bay's drone with one left (rack, hangar, tubes in that order) and fly it (spec §12.2). Refused, with
  // the reason, when the tank is knocked out, tilted past 60°, in the water, moving faster than 3 m/s, every bay empty or
  // broken, in the 2D view, or (in a room) while a drone of ours is already up.
  function launch(F, C) {
    if (!F || !C || F.destroyed || C.dead || F.carrierDown) return false;
    const no = (t) => { say(F, t, 'warn'); return false; };
    if (C.ko || C.wreck) return no('Knocked out: no launch');
    if (!C.docks || !C.docks.length) return no('No drone bay aboard');
    const U = upAt(C), A = C.axis(0, 1, 0);
    if (A.x * U.x + A.y * U.y + A.z * U.z < Math.cos((DRONE.LAUNCH.TILT * Math.PI) / 180)) return no('Level out to launch');
    if (C.splashed) return no('Not in the water');
    const bays = C.docks.slice().sort((a, b) => DOCK_ORDER.indexOf(a.type) - DOCK_ORDER.indexOf(b.type)), bay = bays.find((p) => !p.broken && left1(p) > 0);
    if (!bay) return no(bays.some((p) => p.broken && left1(p) > 0) ? 'The rack is broken: wait for the crew' : 'The rack is empty');
    if (C.speed() > DRONE.LAUNCH.V) return no('Stop to launch');
    if (typeof App !== 'undefined' && App.use3D && !App.use3D()) return no('Drones need the 3D view');
    if (F.mp && typeof MP !== 'undefined' && MP.extra && [...MP.extra.values()].some((E) => E && E.v && !E.v.dead)) return no('One drone at a time in a room');
    const D = bay.def.dock, pick = pickDesign(F, C, bay), v = pick && build(pick.rows, pick.name);
    if (!v) return no(`No drone for the ${bay.def.name}`);
    // pose: the tank's (the drone's +x along the tank's forward), its lowest point 0.4 m over the bay's top, moving as
    // the tank moves there; out of a tube pitched up by the tube's angle and thrown out at its speed, throttle up
    v.q = quat(C.q.w, C.q.x, C.q.y, C.q.z);
    if (D.launch === 'tube') v.q = qnorm(qmul(v.q, qaxis(0, 0, 1, ((D.el || 0) * Math.PI) / 180)));
    const T = dockTop(C, bay), Up = C.axis(0, 1, 0), off = v.com.y - v.bounds.minY + 0.4;
    v.x = T.x + Up.x * off; v.y = T.y + Up.y * off; v.z = T.z + Up.z * off;
    const pv = C.pointVel({ x: v.x - C.x, y: v.y - C.y, z: v.z - C.z });
    v.vx = pv.x; v.vy = pv.y; v.vz = pv.z; v.av = v3(); v.landed = false;
    const dl = (v.dl = { t: 0, at0: { x: v.x, y: v.y, z: v.z }, t0: 0 });
    if (D.launch === 'tube') { const f = v.axis(1, 0, 0), s0 = D.v0 || 28; v.vx += f.x * s0; v.vy += f.y * s0; v.vz += f.z * s0; v.throttle = 0.8; }
    else { dl.hop = DRONE.LAUNCH.HOP_T; dl.hopAlt = v.altitude() - 0.4 + DRONE.LAUNCH.HOP; } // (its lowest point HOP m over the bay)
    state(v);
    // the links between them; the bay one drone lighter, its lid up 1.5 s
    v.carrier = C; v.bay = bay; C.drone = v;
    bay.docked = left1(bay) - 1; bay.deployed = 1; bay._lidAt = F.time || 0;
    // the tank parks (switchTo) and the drone is flown, in the view last picked for drones
    C._scale = F.scale;
    F.vessels.push(v);
    F.switchTo(v, true, true);
    F.scale = clamp(scaleOf(F, v), 1.5, DRONE.LAUNCH.SCALE);
    F.dronePulse = F.time; hud.pulse = F.time || 0; // (a static cut, 0.35 s)
    if (typeof Sound !== 'undefined' && Sound.separate) Sound.separate();
    if (typeof haptic === 'function') haptic(20);
    say(F, `Drone up: ${keyName('drone')} back to the tank · ${keyName('dView')} view`);
    if (F.mp && typeof MP !== 'undefined' && typeof MP.sendExtra === 'function') MP.sendExtra(v);
    return true;
  }
  // From a bay's drone back to its tank (U, the pad's Tank button): the drone holds where it is (switchTo leaves it so)
  function back(F) {
    const d = F && F.active, C = d && d.carrier;
    if (!C) return false;
    if (F.carrierDown) return endLastFlight(F);
    if (!carrierUp(C, F)) return false;
    F.switchTo(C, true, true);
    say(F, `Back in the ${C.name} · ${keyName('drone')}: the drone`);
    return true;
  }
  // Home (3): back to its bay and dock (a solo drone: back where it took off, and land); a winged drone circles over its
  // tank (or its start) instead. Land (4): straight down where it is (not a winged drone). Both until the pilot takes it
  // again (Level or Acro: Flight.droneSas).
  function home(F, v) {
    if (!v || v.kind !== 'drone') return false;
    const dl = state(v);
    dl.mode = 'home'; dl.homeH = null; dl.homeUp = false; dl.wh = null; dl.autoLand = false;
    say(F, v.dr && v.dr.wing ? `Home: circling over ${v.carrier ? `the ${v.carrier.name}` : 'where it took off'}` : v.carrier ? `Home: back to the ${v.carrier.name}'s bay` : 'Home: back to where it took off');
    return true;
  }
  function land(F, v) {
    if (!v || v.kind !== 'drone') return false;
    if (v.dr && v.dr.wing) { say(F, 'A winged drone can\'t land: dive it on something, or fly it home to circle', 'warn'); return false; }
    const dl = state(v);
    dl.mode = 'land'; dl.autoLand = false;
    say(F, 'Landing');
    return true;
  }
  // Where Home goes: the top of its bay (moving with its tank), or where a solo drone took off. null: nowhere (its tank
  // gone).
  function homeTarget(v, dl) {
    const C = v.carrier;
    if (C) {
      if (C.dead && !C.parts.length) return null;
      const bay = v.bay && C.parts.includes(v.bay) ? v.bay : null, P = bay ? dockTop(C, bay) : { x: C.x, y: C.y, z: C.z };
      return { x: P.x, y: P.y, z: P.z, vx: C.vx, vy: C.vy, vz: C.vz, dock: !!bay, C };
    }
    const a = dl.at0 || { x: v.x, y: v.y, z: v.z };
    return { x: a.x, y: a.y, z: a.z, vx: 0, vy: 0, vz: 0, dock: false, C: null };
  }
  // Home's steering (spec §12.5), for pre: 1. climb where it is to max(its height, HOME.ALT 30 m) over the ground; 2. fly
  // to the target at min(12 m/s, half the way), facing it, holding that height (within HOME.SLOW 15 m, slowing in, already
  // letting down to NEAR_H 6 m over it); 3. within 3 m across, down over it (quicker high up, 1.5 m/s for the last
  // metres), moving as its tank moves, until it docks (frame) or, solo, lands.
  function homeSteer(v, dl, S, sim) {
    const T = homeTarget(v, dl);
    if (v.dr && v.dr.wing) return circleSteer(v, dl, S, T, DRONE.HOME.CIRCLE_H);
    if (!T) return holdAuto(S);
    const H = DRONE.HOME, F0 = (v.dr && v.dr.fc) || GPS, r = v.radius() || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r;
    let dx = T.x - v.x, dy = T.y - v.y, dz = T.z - v.z;
    const k = dx * ux + dy * uy + dz * uz; // (the target's height over the drone)
    dx -= ux * k; dy -= uy * k; dz -= uz * k;
    const dh = Math.hypot(dx, dy, dz), df = dx * S.fx + dy * S.fy + dz * S.fz, dr = dx * S.rx + dy * S.ry + dz * S.rz;
    const tvf = T.vx * S.fx + T.vy * S.fy + T.vz * S.fz, tvr = T.vx * S.rx + T.vy * S.ry + T.vz * S.rz;
    const agl = v.altitude() - groundUnder(v, dl, S), toward = S.head + Math.atan2(dr, df);
    if (dl.homeH == null) { dl.homeH = Math.max(agl, H.ALT); dl.homeUp = false; }
    if (dh > H.NEAR_R && !dl.homeUp) { // 1. up first
      if (agl < dl.homeH - 2) return { vf: tvf, vr: tvr, vz: clamp((dl.homeH - agl) * DRONE.HOLD + 1, 1, F0.vz), yawTo: toward };
      dl.homeUp = true;
    }
    const sp = Math.min(H.V, dh * 0.5, F0.vmax), vf = dh > 1e-3 ? (df / dh) * sp + tvf : tvf, vr = dh > 1e-3 ? (dr / dh) * sp + tvr : tvr;
    const over = -k - (v.com.y - v.bounds.minY); // (its lowest point's height over the target)
    if (dh > H.SLOW) return { vf, vr, vz: clamp((dl.homeH - agl) * DRONE.HOLD, -DRONE.VHOLD, DRONE.VHOLD), yawTo: dh > 5 ? toward : S.head }; // 2. there
    if (dh > H.NEAR_R) return { vf, vr, vz: -clamp((over - H.NEAR_H) * 0.4, 0, F0.vz), yawTo: dh > 5 ? toward : S.head }; // (slowing in, already letting down to NEAR_H over it)
    return { vf, vr, vz: -clamp((over - H.DOCK_H) * 0.4, H.DESC, F0.vz), yawTo: S.head, land: !T.dock }; // 3. down over it
  }
  // A winged drone's circle (left, HOME.CIRCLE 60 m across the middle): round T (its tank or its start: Home, at hAgl m
  // over the ground), or round where it was left (unattended, at the height it was left at). The stick it would take.
  function circleSteer(v, dl, S, T, hAgl) {
    if (!T) { if (!dl.holdAt) dl.holdAt = { x: v.x, y: v.y, z: v.z, alt: v.altitude() }; T = dl.holdAt; }
    const r = v.radius() || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r, W = DRONE.WING, R = DRONE.HOME.CIRCLE;
    let dx = T.x - v.x, dy = T.y - v.y, dz = T.z - v.z;
    const k = dx * ux + dy * uy + dz * uz; dx -= ux * k; dy -= uy * k; dz -= uz * k;
    const dc = Math.hypot(dx, dy, dz), rb = Math.atan2(dx * S.rx + dy * S.ry + dz * S.rz, dx * S.fx + dy * S.fy + dz * S.fz); // (where the middle is, from the nose)
    const e = wrapAngle(rb - (-Math.PI / 2 + clamp((dc - R) / R, -1, 1) * 0.6)), sp = Math.max(v.speed(), 5);
    const bank = clamp(-Math.atan((sp * sp) / (G0 * R)) + e * 1.5, -W.BANK, W.BANK);
    const want = hAgl != null ? groundUnder(v, dl, S) + hAgl : T.alt != null ? T.alt : v.altitude(), sv = clamp(-(want - v.altitude()) * 0.05, -1, 1);
    return { vf: 0, vr: 0, vz: null, yawTo: null, stick: { v: Math.abs(sv) > 0.03 ? sv : 0, h: bank / W.BANK, r: 0 } };
  }

  // Dock: the drone goes back in its bay (fresh battery and payload: one more aboard), with a puff; flown, control goes
  // back to the tank
  function dock(F, v) {
    const C = v.carrier, bay = v.bay;
    if (!C || !bay) return false;
    const was = F.active === v;
    v.dead = true;
    const i = F.vessels.indexOf(v);
    if (i >= 0) F.vessels.splice(i, 1);
    bay.docked = Math.min(bay.def.dock.n, left1(bay) + 1);
    if (C.drone === v) C.drone = null;
    FX.puff(v.body, { x: v.x, y: v.y, z: v.z }, { x: v.vx, y: v.vy, z: v.vz }, 6, '#cfd5dc');
    if (typeof Sound !== 'undefined' && Sound.separate) Sound.separate();
    mpDrop(F, v, 'despawn');
    if (was) { F.switchTo(C, true, true); if (F.setFpv) F.setFpv(false, true); }
    say(F, `${v.name} docked · ×${left(C)}`);
    return true;
  }

  // The flown drone from a bay is lost (Flight.onDestroyed's first line: shot down, its warhead gone off, crashed; frame:
  // its battery flat): control goes back to its tank in the same frame, with no end screen and nothing booked (a room
  // hears down {c}). Its hulk falls and crashes as any (death.js); its bay doesn't get it back. In a LAST FLIGHT it ends
  // that instead. true: handled (the caller does nothing more).
  function lost(F, d, why) {
    const C = d && d.carrier;
    if (!F || !C || F.active !== d) return false;
    if (F.carrierDown || !carrierUp(C, F)) { if (!F.carrierDown) lastFlight(F, C); return endLastFlight(F); }
    mpDrop(F, d, 'down', whoDid(d, F));
    if (C.drone === d) C.drone = null;
    F.crashedAt = null; // (the drone's crash was not the tank's)
    F.switchTo(C, true, true);
    if (F.setFpv) F.setFpv(false, true);
    if (C._scale != null) F.scale = C._scale;
    if (!(d.dl && d.dl.impact)) say(F, why === 'battery' ? `Battery flat: back in the ${C.name}` : `Drone lost: back in the ${C.name}`, 'warn');
    return true;
  }
  // The tank knocked out under its flown drone (frame's poll): its death is told now (a room: MP.announceDown, credit and
  // tickets at once; a Practice Battle: booked quietly), its end screen waits for the drone's LAST FLIGHT of 20 s
  function lastFlight(F, C) {
    const A = F && F.active;
    if (!A || A.carrier !== C || F.carrierDown) return;
    F.carrierDown = C;
    state(A).lastEnd = (F.time || 0) + DRONE.LAST;
    if (F.mp) { if (typeof MP !== 'undefined' && typeof MP.announceDown === 'function') MP.announceDown(C); }
    else if (typeof GroundAI !== 'undefined' && GroundAI.battle) GroundAI.onDestroyed(F, C, true);
    if (typeof haptic === 'function') haptic([80, 50, 140]);
    if (F.updateHUD) F.updateHUD(true);
  }
  // The LAST FLIGHT ends (its 20 s out, the drone lost or gone off, or U): the drone, if it still flies, is gone for the
  // room; the view goes back to the tank, and its death runs today's way (Flight.onDestroyed: the strip, then the end
  // screen; a room's or a Practice Battle's only their timers and panel: the death was told at the start)
  function endLastFlight(F) {
    const C = F && F.carrierDown;
    if (!C) return false;
    const d = F.active && F.active.carrier === C ? F.active : C.drone;
    if (d) mpDrop(F, d, 'down', whoDid(d, F)); // (shot down, gone off or still flying: the room hears it once, MP.dropExtra)
    if (C.drone === d) C.drone = null;
    if (F.active !== C) F.switchTo(C, true, true);
    if (F.active !== C) { // (a tank with no controls left, which switchTo refuses: the same hand-over by hand, its death all the same; P4-BAY-2)
      const a = F.active;
      if (a && a.ctl) { a.ctl.v = a.ctl.h = a.ctl.r = 0; if (a.kind === 'drone') a.ctl.z = 0; }
      if (a && a.carrier && a.dl && a.dl.mode !== 'home' && a.dl.mode !== 'land') { a.dl.mode = 'hold'; a.dl.holdAt = null; }
      F.active = C;
      if (typeof Controls !== 'undefined' && Controls.relayout) Controls.relayout(); // (the air and ground HUDs swap)
    }
    if (F.setFpv) F.setFpv(false, true);
    if (C._scale != null) F.scale = C._scale;
    F.destroyed = false;
    if (F.onDestroyed) F.onDestroyed();
    return true;
  }
  // A save with a drone up (Flight.serialize): each tank with its drone in the air is saved with that drone back in its
  // bay (the serialised rows only; the live parts are left alone). keep: the vessels saved, in data.vessels' order.
  function forSave(data, F, keep) {
    if (!data || !Array.isArray(data.vessels) || !Array.isArray(keep)) return data;
    keep.forEach((C, i) => {
      const d = C && C.drone, row = data.vessels[i];
      if (C && C.docks && row && Array.isArray(row.parts)) for (const p of C.docks) { const r = row.parts.find((q) => q && q.id === p.id); if (r && r.deployed) r.deployed = 0; } // (a bay's lid saved shut: a launch's 1.5 s open is never restored; P4-BAY-4)
      if (!live(d) || !d.bay || !row || !Array.isArray(row.parts)) return;
      const r = row.parts.find((q) => q && q.id === d.bay.id), n = d.bay.def.dock.n;
      if (r) r.docked = Math.min(n, (r.docked == null ? n : r.docked) + 1);
    });
    return data;
  }

  // ---------------------------------------------------------------- the link (spec §7)
  // Where a drone's link comes from: a bay drone's tank, 3 m over it (in a LAST FLIGHT, its wreck: the flown drone keeps
  // it); a solo drone's take-off spot, 2 m up; an AI drone's Nest, else its spawn. null: none (its tank gone or knocked
  // out while nobody flies it).
  function station(v, F) {
    const C = v.carrier, L = DRONE.LINK;
    let o = null, k = L.HOME_UP;
    if (C) {
      const lf = !!F && F.carrierDown === C && F.active === v;
      if (!lf && !carrierUp(C, F)) return null;
      o = C; k = L.STATION;
    } else if (v.ai && v.ai.drone && v.ai.nest && !v.ai.nest.dead) { o = v.ai.nest; k = L.STATION; }
    else o = state(v).at0;
    const r = Math.hypot(o.x, o.y, o.z) || 1;
    return { x: o.x + (o.x / r) * k, y: o.y + (o.y / r) * k, z: o.z + (o.z / r) * k };
  }
  // the ground between the station and the drone (LOS_N points along the way, any under the surface + 1 m): ×LOS_K;
  // looked at every LOS_DT s
  function losK(v, dl, P, t) {
    const L = DRONE.LINK;
    if (dl.losAt != null && t >= dl.losAt && t - dl.losAt < L.LOS_DT) return dl.losK;
    dl.losAt = t;
    let k = 1;
    for (let i = 1; i <= L.LOS_N; i++) {
      const f = i / (L.LOS_N + 1), x = P.x + (v.x - P.x) * f, y = P.y + (v.y - P.y) * f, z = P.z + (v.z - P.z) * f, A = Terrain.locate(v.body, x, y, z, _loc);
      if (Math.hypot(x, y, z) - v.body.radius < Terrain.surfaceAt(v.body, A.a, A.z) + 1) { k = L.LOS_K; break; }
    }
    return (dl.losK = k);
  }
  // Is drone d hostile to o, the owner of a piece of counter-drone kit (spec §13.1)? The player's side (the player, allied
  // AI) against AI drones not allied and, in a room, enemy players' drones; the enemy AI against the player's drones and
  // allied AI drones. Nothing against its own side or its own carrier's; a ghost's kit is its owner's to work.
  function foe(o, d) {
    if (!o || !d || o === d || o.remote || d.carrier === o) return false;
    if (!o.ai || o.ai.ally) return d.remote ? typeof MP !== 'undefined' && typeof Net !== 'undefined' && !!MP.enemy && MP.enemy(Net.me, d.remote) : !!(d.ai && d.ai.drone && !d.ai.ally);
    return !d.remote && (!d.ai || !!(d.ai.drone && d.ai.ally));
  }
  // ...and a jammer on someone else's craft in a room (a ghost) jams our drones when that player is an enemy
  const jamFoe = (o, d) => (o.remote ? !d.remote && !d.ai && typeof MP !== 'undefined' && typeof Net !== 'undefined' && !!MP.enemy && MP.enemy(Net.me, o.remote) : foe(o, d));
  // The jammers at work this tick: { o, R (radio m), at (sim position) } (not broken; the craft not dead, a wreck or knocked
  // out; a ghost's while its hp holds)
  function jammers(F) {
    const J = [];
    for (const o of F.vessels) {
      if (!o.cuas || !o.cuas.length || o.dead || o.wreck || o.ko) continue;
      for (const p of o.cuas) {
        const c = p.def.cuas;
        if (!c.jam || p.broken || (o.remote && p.hp != null && !(p.hp > 0))) continue;
        J.push({ o, R: c.jam, at: o.toWorld(p.x, p.y, partZc(p)) });
      }
    }
    return J;
  }
  // The link's quality now (dl.q, 0..1: the best link's range × line of sight × jamming), the link in use (dl.via), how far
  // the station is (dl.dist) and whether a jammer has it (dl.jam). A fibre spool replaces the controller's own radio (a
  // fibre drone is silent and can't be jammed); past its length it snaps for good.
  function quality(v, F, P, J) {
    const dl = state(v), K = DRONE.LINK.K, JI = DRONE.LINK.JAM_IN, t = F.time || 0;
    const d = P ? Math.hypot(v.x - P.x, v.y - P.y, v.z - P.z) : Infinity, links = v.dr.links, fibre = links.some((l) => l.L.kind === 'fibre');
    dl.dist = P ? d : NaN;
    let best = -1, via = null, jam = false, jamBy = null;
    for (const l of links) {
      const L = l.L;
      if (fibre && l.p === v.dr.fcPart && !(l.p.def.drone && l.p.def.drone.link)) continue; // (the controller's own radio: not on a fibre drone)
      if (l.p.broken || !v.parts.includes(l.p)) continue;
      let q = 0, jq = false, jo = null, jk = 1;
      if (P) {
        if (L.kind === 'fibre') {
          if (d > L.range && !dl.snapped) { dl.snapped = true; if (!v.ai) say(F, `Fibre ran out at ${(L.range / 1000).toFixed(1)} km`, 'warn'); }
          q = dl.snapped ? 0 : 1;
        } else if (L.kind === 'sat') q = d <= L.range ? 1 : 0;
        else q = (1 - smoothstep(0.8 * L.range, L.range, d)) * losK(v, dl, P, t);
        const kj = K[L.kind] || 0;
        if (q > 0 && kj > 0) for (const j of J) {
          const Rj = j.R * kj, dj = Math.hypot(v.x - j.at.x, v.y - j.at.y, v.z - j.at.z);
          if (dj >= Rj || !jamFoe(j.o, v)) continue;
          const k = smoothstep(JI * Rj, Rj, dj);
          q *= k; jq = true;
          if (k < jk) { jk = k; jo = j.o; } // (the jammer that cuts it most)
        }
      }
      if (q > best) { best = q; via = L; jam = jq; jamBy = jo; }
    }
    if (!via) { dl.q = 1; dl.via = null; dl.jam = false; dl.jamBy = null; return; } // (no link aboard at all: nothing to lose)
    dl.q = Math.max(0, best); dl.via = via; dl.jam = jam; dl.jamBy = jamBy;
  }
  // One link tick (every LINK.DT s): the quality, then LOST once under LOST for LOST_T s (the stick does nothing, the
  // last one held for LINK.HOLD s, then the controller's failsafe flies it: pre), back once over BACK for BACK_T s (in Level), and a flown bay drone handed back
  // to its tank after HANDBACK s lost (it carries on by itself: an FPV falls, a GPS drone flies home)
  function linkTick(v, F, dt, J) {
    const dl = state(v), L = DRONE.LINK;
    quality(v, F, station(v, F), J);
    const q = dl.q, flown = v === F.active;
    if (!dl.lost) {
      dl.lowT = q < L.LOST ? (dl.lowT || 0) + dt : 0;
      if (dl.lowT >= L.LOST_T - 1e-6) {
        dl.lost = true; dl.lostT = 0; dl.hiT = 0; dl.homeH = null; dl.homeUp = false; dl.ring = null; dl.fsOn = false;
        if (v.dr.fc.fs === 'home' && dl.mode !== 'land' && dl.mode !== 'pilot') dl.mode = 'home'; // (a GPS controller flies it home, and goes on home when the link is back; flown by hand, once its hold is over: below)
        if (flown) say(F, v.dr.fc.fs === 'home' ? 'Link lost: flying home' : 'Link lost', 'warn');
        // a range's practice drone brought down by a jammer (it falls): the jammer's kill, as the kit's gun's is (P4-AI-5)
        if (v.ai && v.ai.passive && !v.ai.down && v.dr.fc.fs === 'drop' && dl.jam && dl.jamBy && typeof Combat !== 'undefined' && Combat.aiDown) {
          v.lastHitBy = dl.jamBy; v.lastHitAt = F.time || 0; v.kitAt = F.time || 0; Combat.aiDown(v, F);
        }
      }
      return;
    }
    dl.lostT = (dl.lostT || 0) + dt;
    if (!dl.fsOn && dl.lostT >= L.HOLD - 1e-6) { dl.fsOn = true; if (v.dr.fc.fs === 'home' && dl.mode === 'pilot') dl.mode = 'home'; } // (the hold is over: the failsafe acts)
    dl.hiT = q > L.BACK && !(dl.via && dl.via.kind === 'fibre' && dl.snapped) ? (dl.hiT || 0) + dt : 0;
    if (dl.hiT >= L.BACK_T - 1e-6) {
      dl.lost = false; dl.lowT = 0; dl.lostT = 0;
      if (flown && dl.mode === 'home') say(F, `Link back: flying home · ${keyName('dLevel')} to take it`); // (Level or Acro takes it: Flight.droneSas)
      else if (flown) { v.sas = 'hold'; dl.mode = 'pilot'; dl.hold = null; dl.wh = null; say(F, 'Link back'); if (F.syncSas) F.syncSas(); }
      return;
    }
    if (flown && v.carrier && !F.carrierDown && dl.lostT >= L.HANDBACK - 1e-6 && carrierUp(v.carrier, F)) {
      const C = v.carrier;
      if (dl.mode !== 'home' && dl.mode !== 'land') dl.mode = 'hold'; // (a GPS drone flies on home: linkTick set it)
      F.switchTo(C, true, true);
      if (F.setFpv) F.setFpv(false, true);
      if (C._scale != null) F.scale = C._scale;
      say(F, `Lost the drone's link: back in the ${C.name}`, 'warn');
    }
  }
  // The flown drone's inputs over a weak link (Flight.readControls): late by up to LAGMAX s as q falls under LAG (a ring of
  // the stick, 8 entries 50 ms apart), and by a satellite link's own lag always
  function lagged(v, c, F) {
    const dl = v.dl;
    if (!dl) return;
    const L = DRONE.LINK, q = dl.q == null ? 1 : dl.q;
    let lag = q < L.LAG ? Math.min(L.LAGMAX, ((L.LAG - q) / 0.25) * 0.2) : 0;
    if (dl.via && dl.via.lag) lag += dl.via.lag;
    if (!(lag > 0) || dl.lost) { dl.ring = null; return; }
    const t = F.time || 0, R = dl.ring || (dl.ring = { buf: [], at: -1e9 });
    if (t - R.at >= 0.05 || t < R.at) { R.buf.push({ t, v: c.v, h: c.h, r: c.r, z: c.z || 0 }); R.at = t; if (R.buf.length > 8) R.buf.shift(); }
    let e = R.buf[0];
    for (let i = R.buf.length - 1; i >= 0; i--) if (t - R.buf[i].t >= lag - 1e-9) { e = R.buf[i]; break; }
    c.v = e.v; c.h = e.h; c.r = e.r; c.z = e.z;
  }

  // ---------------------------------------------------------------- the bays' frame (Drone.frame calls it)
  // The links (every LINK.DT s: each owned or AI drone, never a ghost; the JAM chip's count), the flown drone's battery
  // gone flat (lost), a tank knocked out under its flown drone (LAST FLIGHT) and the end of one, docking (Home or Land
  // over the bay, a GPS drone's failsafe), drones nobody has (lost 60 s, or landed 3 s: gone with a puff), a drone of ours
  // lost while nobody flew it, and the bays' lids. Live drones only: a hulk (v.hulk set, down or crippled) is death.js's
  // alone (plan I13).
  function bayFrame(F, dt) {
    const A = F.active, t = F.time || 0;
    hud.linkAcc = (hud.linkAcc || 0) + dt;
    const tick = hud.linkAcc >= DRONE.LINK.DT - 1e-9, tdt = hud.linkAcc;
    let J = null;
    if (tick) {
      hud.linkAcc = 0;
      J = jammers(F);
      // the JAM chip: enemy drones inside a radio jammer's reach on the flown craft or its tank
      const own = A && A.carrier ? [A, A.carrier] : [A];
      let n = 0;
      if (J.length) for (const d of F.vessels) {
        if (!isDrone(d)) continue;
        if (J.some((j) => own.includes(j.o) && foe(j.o, d) && Math.hypot(d.x - j.at.x, d.y - j.at.y, d.z - j.at.z) < j.R)) n++;
      }
      hud.jamN = n;
    }
    for (let i = F.vessels.length; i--;) {
      const v = F.vessels[i];
      if (!v || v.kind !== 'drone' || v.remote || v.dead || v.isDebris || v.hulk != null || !v.dr || !v.control) continue;
      const dl = state(v);
      if (tick) linkTick(v, F, tdt, J);
      if (v === A && v.carrier && dl.flat && !F.carrierDown) { lost(F, v, 'battery'); continue; }
      if (v.ai) continue; // (an AI drone's own end is the AI section's)
      // docking: homing or landing over its bay, or a GPS drone's failsafe bringing it home
      if (v.carrier && v.bay && carrierUp(v.carrier, F) && (dl.mode === 'home' || dl.mode === 'land' || (dl.lost && v.dr.fc.fs === 'home')) && overBay(v, DRONE.HOME.DOCK_R, DRONE.HOME.DOCK_H, DRONE.HOME.DOCK_V)) { dock(F, v); continue; }
      // nobody's: lost 60 s, or lost or ownerless and landed 3 s
      if (v === A) continue;
      const owned = !v.carrier || (v.carrier.drone === v && carrierUp(v.carrier, F));
      dl.restT = v.landed ? (dl.restT || 0) + dt : 0;
      if ((dl.lost || !owned) && (dl.restT >= DRONE.REST_GONE || (dl.lost && dl.lostT >= DRONE.LOST_GONE))) gone(F, v);
    }
    // a drone of ours lost while nobody flew it (shot down, crashed, its battery flat): its tank's to know
    for (const C of F.vessels) {
      const d = C.drone;
      if (!d || d === F.active) continue;
      const down = d.dead || d.down || d.hulk != null || !d.control || !d.parts.length, flat = !down && d.dl && d.dl.flat;
      if (!down && !flat) continue;
      C.drone = null;
      if (down) mpDrop(F, d, 'down', whoDid(d, F)); // (dead in one go too: a crash, every part broken; P4-BAY-3)
      if (C === A || (A && A.carrier === C)) say(F, `The ${d.name} was ${d.down || d.hulk != null ? 'shot down' : flat ? 'lost: its battery went flat' : 'lost'}`, 'warn');
    }
    // a drone of ours in the room that no tank watches any more (its battery went flat, so its tank let it go) and that
    // then comes down: the room hears it (MP.dropExtra once; P4-MP-1)
    if (F.mp && typeof MP !== 'undefined' && MP.extra && MP.extra.size) for (const E of [...MP.extra.values()]) {
      const d = E && E.v;
      if (d && d !== F.active && (d.dead || d.down || d.hulk != null || !d.control || !d.parts.length)) mpDrop(F, d, 'down', whoDid(d, F));
    }
    // the LAST FLIGHT: the poll, and its end
    const C = A && A.carrier;
    if (C && !F.carrierDown && !F.destroyed && !carrierUp(C, F)) lastFlight(F, C);
    if (F.carrierDown && A && A.carrier === F.carrierDown && A.dl && t >= A.dl.lastEnd) endLastFlight(F);
    // the bays' lids, shut 1.5 s after a launch
    for (const o of F.vessels) if (o.docks && o.docks.length) for (const p of o.docks) if (p._lidAt != null && (t - p._lidAt >= 1.5 || t < p._lidAt)) { p.deployed = 0; p._lidAt = null; }
  }
  // a drone nobody has any more: gone with a puff (a room hears it down)
  function gone(F, v) {
    v.dead = true;
    if (v.carrier && v.carrier.drone === v) v.carrier.drone = null;
    FX.puff(v.body, { x: v.x, y: v.y, z: v.z }, { x: v.vx, y: v.vy, z: v.vz }, 6, '#cfd5dc');
    mpDrop(F, v, 'down', null);
  }

  // ================================================================ combat (fuses and warheads, the counter-drone kit)
  // A drone's warhead arms 2 s after its start and 20 m out (never while it homes, lands or hops off its bay) and goes off
  // on whatever it meets fast (a vessel, a prop, the ground over 4 m/s; never its own tank), or on FIRE once armed; shot
  // to 0 hp it cooks off (high explosive only, no jet). The counter-drone kit on a tank: jammers (the link's, bays
  // section), a detector and the Drone Radar (they mark drones and cue the guns), the anti-drone gun (an auto-turret
  // firing airburst rounds, on the ground too), the laser (a dwell: the drone's controller burnt out) and the roof cage
  // (the armour's slat rule). Nothing here runs for an old design: Combat.S.dr opens it (spec §13.6).
  const CB = { now: 0, thrT: NaN, thr: new Map(), marks: [], markT: -1e9, seen: new Set(), buzz: 0, beamT: -1e9 };
  const beams = []; // (render3d's streak mesh draws these, ≤ 8: { b, a, e, col, w }; a laser's beam, ours or a ghost's)
  const BEAM_COL = [1, 0.25, 0.3], ORANGE = '#ffb547';
  const LSRC = {}, LTMP = {}, V0 = { x: 0, y: 0, z: 0 };
  const camDist = (F, o) => (F && typeof F.dist === 'function' && typeof F.absPos === 'function' && F.camAbs ? F.dist(F.absPos(o), F.camAbs) : 0);
  // a part's own deterministic stream (its spread: no Math.random in the sim, so the tests' runs repeat)
  function prand(p) { let s = p._rs || (p._rs = ((p.id | 0) * 2654435761 + 0x9e3779b9) >>> 0 || 1); s ^= s << 13; s ^= s >>> 17; s ^= s << 5; p._rs = s >>> 0; return (s >>> 0) / 4294967296; }

  // ---------------------------------------------------------------- safe-arm and the contact fuse (spec §9)
  // the first live warhead aboard (null: none left)
  const headOf = (v) => (v.dr ? v.dr.warheads.find((p) => v.parts.includes(p) && !(p.hp != null && p.hp <= 0)) || null : null);
  const headAt = (v, p) => v.toWorld(p.x, p.y, partZc(p));
  // Armed once 20 m from where it started and 2 s on (its own clock), and never while it homes, lands or hops off its bay
  // (it re-arms when that ends): a click and ARMED on the OSD for the pilot
  function armTick(v, dl, F) {
    if (!dl.armOK) {
      const a = dl.at0 || v, far = Math.hypot(v.x - a.x, v.y - a.y, v.z - a.z) >= DRONE.ARM_D;
      if (far && dl.t - (dl.t0 || 0) >= DRONE.ARM_T) dl.armOK = true;
    }
    const busy = dl.mode === 'home' || dl.mode === 'land' || dl.hop > 0 || !!dl.dock || !!(v.ai && v.ai.passive); // (an AI drone that is only a practice target never arms)
    const arm = !!dl.armOK && !busy;
    if (arm && !dl.arm) { dl.armedAt = F.time || 0; if (v === F.active && !v.ai && typeof Sound !== 'undefined' && Sound.click) Sound.click(); }
    dl.arm = arm;
  }
  // under the ground or the sea at the sim point P?
  function under(b, P) {
    const L = Terrain.locate(b, P.x, P.y, P.z, _loc), g = Terrain.surfaceAt(b, L.a, L.z);
    return L.r < b.radius + (b.ocean ? Math.max(0, g) : g);
  }
  // Every physics substep for a drone with a warhead (not a ghost, not debris): its arming, and the fuse along the way the
  // warhead went this step and 0.3 m on (the first of a vessel, a prop, the ground or the sea at over 4 m/s)
  function fuse(v, h, F) {
    const dl = state(v), p = headOf(v);
    if (!p) return;
    armTick(v, dl, F);
    const now = headAt(v, p), sp = v.speed(), was = dl.prev;
    dl.prev = now;
    const fast = Math.max(sp, dl.sp || 0) > DRONE.FUSE_V;
    dl.sp = sp;
    if (!dl.arm || !was || v.isDebris || !v.control) return;
    if (Math.hypot(now.x - was.x, now.y - was.y, now.z - was.z) > (sp + 10) * h * 3 + 1) return; // (moved, not flown: a launch, a restore, a teleport; the fuse looks from here)
    const C = v.carrier; // (never on its own tank, nor on anything about it: what it flies through there, or the ground by it)
    if (C && !C.dead && Math.hypot(now.x - C.x, now.y - C.y, now.z - C.z) < (C.reach || 5) + (v.reach || 0) + 1) return;
    // (0.3 m on, and the drone's own reach: the vehicles' bump stops a drone where its frame meets a hull, before its
    // warhead does, so it looks as far ahead as its frame reaches, and a step more)
    const k = sp > 1e-3 ? (DRONE.AHEAD + (v.reach || 0)) / sp + h : 0, a = was, e = { x: now.x + v.vx * k, y: now.y + v.vy * k, z: now.z + v.vz * k };
    // a vessel (not itself, not its tank, not a wreck, not a picture of someone else's falling hulk)
    let best = null, bt = 2, bo = null;
    for (const o of F.vessels) {
      if (o === v || o === v.carrier || o.dead || o.wreck || o.foreign || o.body !== v.body || (o.isDebris && o.kind === 'drone') || !o.parts || !o.parts.length) continue;
      if (Math.hypot(o.x - v.x, o.y - v.y, o.z - v.z) > (o.reach || 10) + sp * h + 1 + DRONE.AHEAD) continue;
      const q = o.plated ? Armour.hitFirst(o, a, e) : Combat.hitVessel(o, a, e);
      if (q && q.t < bt) { bt = q.t; best = q.p; bo = o; }
    }
    // a prop (Highland Ridge's in ground play)
    let pt = -1;
    if (typeof Props !== 'undefined' && Props.play && v.body === EARTH) pt = Props.shell(a, e);
    if (pt >= 0 && (!best || pt < bt)) { detonate(v, F, lerp(a, e, pt), null, null, 'contact'); return; }
    if (best) { detonate(v, F, lerp(a, e, bt), bo, best, 'contact'); return; }
    // the ground or the sea, fast (slower it has landed: an FPV can sit in ambush and take off again)
    if (fast && (under(v.body, e) || (v.contactTime > 0 && v.contactTime <= h * 1.5))) detonate(v, F, now, null, null, 'contact');
  }
  const lerp = (a, e, t) => ({ x: a.x + (e.x - a.x) * t, y: a.y + (e.y - a.y) * t, z: a.z + (e.z - a.z) * t });

  // The drone's warhead goes off at `at` (null: where the warhead is), having met hv's part hp (null: anything else).
  // A shaped charge on a plated vessel's new part is HEAT along the dive, then its burst (Armour.legacyHit); everything
  // else (frag, an old craft, the ground, a prop, mid-air) is a blast (Combat.explode). Then a flash, and the drone is
  // gone (its active pilot gets the impact view; a drone from a bay hands back to its tank). why: 'contact', 'fire' (FIRE,
  // armed only: an airburst where it is) or 'cook'. true: it went off.
  function detonate(v, F, at, hv, hp, why) {
    if (!v || v.dead || !v.dr || v.remote || v.foreign) return false;
    const dl = state(v), p = headOf(v);
    if (!p) return false;
    if (why === 'fire' && !dl.arm) { say(F, `Not armed yet: fly ${DRONE.ARM_D} m clear`, 'warn'); return false; }
    if (dl.boom) return false;
    dl.boom = true;
    const w = p.def.drone.warhead, b = v.body, sp = v.speed(), ax = partAxis(p), nose = v.axis(ax.x, ax.y, 0);
    let P = at || headAt(v, p);
    // (the jet along the way it flew, from 4 m/s: a slow dive's jet still goes down into the roof, not along a nose
    // pitched forward; slower still, along its nose. The jet always points somewhere)
    const k = sp >= DRONE.JET_V ? Math.max(15, sp) / sp : 0, vel = k ? { x: v.vx * k, y: v.vy * k, z: v.vz * k } : { x: nose.x * 15, y: nose.y * 15, z: nose.z * 15 };
    const vl = Math.hypot(vel.x, vel.y, vel.z) || 1, dir = { x: vel.x / vl, y: vel.y / vl, z: vel.z / vl };
    const s = { k: 'missile', seek: 'top', b, x: P.x, y: P.y, z: P.z, vx: vel.x, vy: vel.y, vz: vel.z, dx: dir.x, dy: dir.y, dz: dir.z,
      pen: w.pen, tandem: !!w.tandem, he: w.he, blast: w.blast, dmg: w.dmg, t: 0, life: 9, owner: v, enemy: !!v.ai && !v.ai.ally, spare: v, drone: 1 }; // (t 0, spare: its own blast leaves the drone itself to the end; drone: armour.js's drone jet)
    p.ammo = 0;
    // (a shaped charge set off by what wasn't a plated vehicle's new part (the ground beside one, its bump, a frame
    // touching first): the jet still meets the plates within JET_R m ahead of it)
    if (w.pen > 0 && !(hv && hv.plated && hp && hp.def.gv && !hv.wreck)) { const q = jetMeets(v, F, P, dir); if (q) { hv = q.o; hp = q.p; P = q.at; s.x = P.x; s.y = P.y; s.z = P.z; } }
    if (w.pen > 0 && hv && hv.plated && hp && hp.def.gv && !hv.wreck) Armour.legacyHit(s, hv, hp, P, F); // (never with pen 0: legacyHit's HEAT default is 700 mm)
    else Combat.explode(b, P, w.blast, w.dmg, v, F, false, w.he, v);
    const air = airDensity(b, Math.hypot(P.x, P.y, P.z) - b.radius) > 0.01;
    FX.explosion(b, P, { x: v.vx * 0.2, y: v.vy * 0.2, z: v.vz * 0.2 }, w.blast * 0.7, air);
    if (v === F.active && !v.ai) { impactView(F, v, P); dl.impact = true; }
    shatter(v, F, false);
    void why;
    return true;
  }
  // the first plated vehicle's new part within JET_R m of P along dir (not the drone's own tank, not a wreck): { o, p, at }
  function jetMeets(v, F, P, dir) {
    const r = DRONE.JET_R, a = { x: P.x - dir.x * 0.3, y: P.y - dir.y * 0.3, z: P.z - dir.z * 0.3 }, e = { x: P.x + dir.x * r, y: P.y + dir.y * r, z: P.z + dir.z * r };
    let best = null, bt = 2;
    for (const o of F.vessels || []) {
      if (o === v || o === v.carrier || !o.plated || o.dead || o.wreck || o.foreign || o.body !== v.body || !o.parts.length) continue;
      if (Math.hypot(o.x - P.x, o.y - P.y, o.z - P.z) > (o.reach || 10) + r + 1) continue;
      const q = Armour.hitFirst(o, a, e);
      if (q && q.t < bt && q.p.def.gv) { bt = q.t; best = { o, p: q.p, at: lerp(a, e, q.t) }; }
    }
    return best;
  }
  // The drone is gone (its warhead went off or cooked off): no parts left, dead. The flown one ends its flight (a drone
  // from a bay hands back to its tank: Flight.onDestroyed's first line); an unflown one of ours is told to the room; an AI
  // one is shot down (its kill its last hitter's). One flash only (detonate's or explode's), not one per part: a
  // breakParts of every part would draw ten explosions for a drone a hand across.
  function shatter(v, F, shot) {
    v.parts = [];
    if (v.adj && v.adj.clear) v.adj.clear();
    v.dead = true; v.throttle = 0; v.thrust = 0;
    if (v.carrier && v.carrier.drone === v && v !== F.active) v.carrier.drone = null;
    if (v.ai && v.ai.drone && !v.ai.down && typeof Combat !== 'undefined' && Combat.aiDown) {
      if (!shot) v.lastHitBy = v.doomBy = null; // (its own warhead went off, on its target or where it fell: nobody shot it down, whoever scratched it once; P4-CTR-3)
      Combat.aiDown(v, F);
    }
    if (v === F.active) { if (!v.carrier) F.crashedAt = F.time || 0; if (F.onDestroyed) F.onDestroyed(); }
    else if (!v.ai) mpDrop(F, v, 'down', whoDid(v, F));
  }
  // (Combat.destroyPart's third line) A payload shot to 0 hp (a warhead, a grenade dropper or bomb rack with rounds
  // left, mini missiles on their rail) cooks off, and the drone goes with everything else aboard (die). true: handled.
  function cookOff(v, p, cause, sim) {
    if (!v || v.remote || v.foreign || v.dead) return false;
    const dl = state(v);
    if (dl.boom) { if (p.def.drone.warhead) { p.hp = 0; return true; } return false; } // (its own detonation's blast: shatter has it)
    if (!payload(p)) return false; // (an empty rack: an ordinary part)
    void cause;
    return die(v, sim, 'cook', p);
  }
  // A payload: a live warhead, or a dropper, rack or rail with rounds left
  function payload(p) {
    const d = p.def;
    if (!d.drone) return false;
    if (d.drone.warhead) return p.ammo !== 0;
    return !!d.weapon && (d.weapon.kind === 'bomb' || d.weapon.kind === 'missile') && p.ammo > 0;
  }
  // (the drones' balance) A drone dies with its payloads aboard (shot down, its controller burnt out, every rotor gone,
  // a payload shot, a crash of any kind: Death's air check, crash and impact, destroyPart's cook-off): each one goes
  // off at once where it is, as high explosive only (no jet: only the fuse's contact makes one), 0.6 of its damage and
  // all its rounds', credited to whoever brought the drone down (its killer within 20 s, else the drone: its owner's),
  // and the drone is gone. Never a clean landing (nothing breaks), a dock or a drone gone after its lost timer; a crash
  // by its own tank keeps the safe-arm rule (it never blows up its own tank). first: the payload hit first, first.
  // true: it went up (the drone is dead).
  function die(v, sim, why, first) {
    if (!v || v.kind !== 'drone' || v.remote || v.foreign || v.dead || !v.parts.length || !sim) return false;
    const L = v.parts.filter((p) => p !== first && payload(p));
    if (first && v.parts.includes(first)) L.unshift(first);
    if (!L.length) return false;
    const C = v.carrier;
    if (why === 'crash' && C && !C.dead && Math.hypot(v.x - C.x, v.y - C.y, v.z - C.z) < (C.reach || 5) + (v.reach || 0) + 1) return false; // (by its own tank: safe)
    const dl = state(v);
    if (dl.boom) return false;
    dl.boom = true;
    const t = sim.time || 0, hit = v.lastHitBy && v.lastHitBy !== v && t - (v.lastHitAt ?? -99) < 20 ? v.lastHitBy : null, by = (v.doomBy && v.doomBy !== v ? v.doomBy : null) || hit;
    if (by) v.lastHitBy = by;
    const b = v.body, air = airDensity(b, v.altitude()) > 0.01;
    let big = 0, P = null;
    for (const p of L) {
      const d = p.def, w = d.drone.warhead || d.weapon, n = d.drone.warhead ? 1 : Math.max(1, p.ammo | 0), at = headAt(v, p);
      p.ammo = 0;
      if (d.drone.warhead) p.hp = 0;
      Combat.explode(b, at, w.blast || 1, (w.dmg || 0) * 0.6 * n, by || v, sim, true, w.he, v);
      if ((w.blast || 1) > big) { big = w.blast || 1; P = at; }
    }
    if (P && why !== 'cook') FX.explosion(b, P, { x: v.vx * 0.2, y: v.vy * 0.2, z: v.vz * 0.2 }, big * 0.7, air); // (a cook-off from a hit flashes as ever)
    if (P && !v.ai && typeof MP !== 'undefined' && MP.shared) MP.sendBoom(b, P, Math.max(big, 3)); // (the room sees it go up: Combat.explode sends only blasts of 8 m and more)
    if (!v.ai && v !== sim.active && Combat.byMe(by, sim) && typeof Death !== 'undefined') Death.feedback('SHOT DOWN', sim);
    shatter(v, sim, !!by);
    return true;
  }

  // ---------------------------------------------------------------- who is hostile, and who sees it (spec §13.1-13.2)
  // The drones hostile to o's kit, live (flying, not down, not landed), this physics step's list
  function threats(o, F) {
    const t = F && F.time;
    if (CB.thrT !== t) { CB.thrT = t; CB.thr.clear(); }
    let L = CB.thr.get(o);
    if (L) return L;
    L = [];
    if (o && !o.remote && F && F.vessels) for (const d of F.vessels) if (isDrone(d) && foe(o, d)) L.push(d);
    CB.thr.set(o, L);
    return L;
  }
  // Does a drone give itself away to a detector: its link a radio (not a fibre), or a generator aboard (loud)?
  const loud = (d) => d.parts.some((p) => p.def.drone && p.def.drone.loud);
  function emits(d) {
    if (loud(d)) return true;
    if (d.dl && d.dl.via) return d.dl.via.kind !== 'fibre';
    return !d.parts.some((p) => p.def.drone && p.def.drone.link && p.def.drone.link.kind === 'fibre');
  }
  // A vessel's drone sensors (the detectors, the Drone Radars), remembered until its parts change
  function sensors(o) {
    if (!o || !o.gv) return null;
    const n = o.parts.length;
    if (o._cds && o._cds.n === n) return o._cds;
    const det = [], rad = [];
    for (const p of o.parts) { if (p.def.cuas && p.def.cuas.detect) det.push(p); if (p.def.searchRadar && p.def.searchRadar.low) rad.push(p); }
    return (o._cds = { n, det, rad });
  }
  const working = (o) => !!o && !o.dead && !o.ko && !o.wreck && o.parts.length > 0;
  // Nothing but air between a and b (4 points along it, each over the ground or the sea by 0.3 m)
  function clearSky(b, a, e) {
    for (let i = 1; i <= 4; i++) {
      const f = i / 5, x = a.x + (e.x - a.x) * f, y = a.y + (e.y - a.y) * f, z = a.z + (e.z - a.z) * f, L = Terrain.locate(b, x, y, z, _loc), g = Terrain.surfaceAt(b, L.a, L.z);
      if (L.r < b.radius + (b.ocean ? Math.max(0, g) : g) + 0.3) return false;
    }
    return true;
  }
  // where a vessel looks from: its top (a drone: its middle)
  function eyeOf(o, out) {
    if (o.kind === 'drone' || !o.com || !o.bounds) { out.x = o.x; out.y = o.y; out.z = o.z; return out; }
    const c = o.com, q = qrot(o.q, 0, o.bounds.maxY - 0.15 - c.y, 0, out);
    out.x = o.x + q.x; out.y = o.y + q.y; out.z = o.z + q.z;
    return out;
  }
  // the line from viewer o to drone d, looked at four times a second (per pair)
  function sightOf(o, d) {
    const M = o._sight || (o._sight = new Map()), c = M.get(d), t = CB.now;
    if (c && t >= c.t && t - c.t < 0.25) return c.ok;
    const ok = clearSky(o.body, eyeOf(o, LSRC), d);
    if (M.size > 32) M.clear();
    M.set(d, { t, ok });
    return ok;
  }
  // How well viewer sees drone d (0: not at all): 1 by eye (400 m, a clear line), 2 a working detector (2 km, 4 km for a
  // loud one; drones that emit; no line needed), 3 a working Drone Radar (4 km, a clear line: every drone, low and slow
  // too). The sensors that count: the viewer's own and, for a drone from a bay, its tank's (the crew calls them out).
  function marked(viewer, d) {
    if (!viewer || !d || d.kind !== 'drone' || d.dead || d.body !== viewer.body) return 0;
    const dist = Math.hypot(d.x - viewer.x, d.y - viewer.y, d.z - viewer.z);
    let lvl = 0;
    for (const o of viewer.carrier && working(viewer.carrier) ? [viewer, viewer.carrier] : [viewer]) {
      const S = working(o) && sensors(o);
      if (!S) continue;
      const r = o === viewer ? dist : Math.hypot(d.x - o.x, d.y - o.y, d.z - o.z);
      for (const p of S.rad) if (!p.broken && r <= p.def.searchRadar.range && sightOf(o, d)) return 3;
      if (lvl < 2) for (const p of S.det) if (!p.broken && r <= p.def.cuas.detect * (loud(d) ? 2 : 1) && emits(d)) { lvl = 2; break; }
    }
    if (!lvl && dist <= DRONE.EYE && sightOf(viewer, d)) lvl = 1;
    return lvl;
  }
  // A ground vehicle's (or a drone flown from it) sight and spotting reach for drones: a Drone Radar's, else a detector's,
  // else the eye's
  function seeR(v) {
    const S = sensors(v && v.carrier ? v.carrier : v);
    if (S && S.rad.some((p) => !p.broken)) return Math.max(...S.rad.map((p) => p.def.searchRadar.range));
    if (S && S.det.some((p) => !p.broken)) return Math.max(...S.det.map((p) => p.def.cuas.detect));
    return DRONE.EYE;
  }
  // what a drone's camera spots on the ground (the best camera's reach; none without one)
  const spotR = (v) => (v && v.dr && v.dr.cam ? v.dr.cam.def.drone.cam.spot || 0 : 0);
  // The player's live drones nobody flies now (an enemy proximity shell bursts by them too: armour.js airNear)
  function ownedAir(F, owner) {
    const out = [];
    if (F && F.vessels) for (const d of F.vessels) if (d !== F.active && d !== owner && isDrone(d) && !d.ai && !d.remote) out.push(d);
    return out;
  }

  // ---------------------------------------------------------------- the anti-drone gun and laser (spec §13.3)
  // Their turning heads: yaw about the part's +y from its +x towards +z, elevation up from level, the barrel along
  // (cos el cos yaw, sin el, cos el sin yaw) in the part's own frame (parts3d rws/laserT), then the part's rotation and
  // the turret rings it rides, then the vessel's attitude.
  function headLay(p) {
    const d = p.def, L = drLayout(d), c = d.cuas;
    if (c.gun) return { x: L.rws.xc, y: L.rws.yb + L.rws.T, len: L.rws.barrel.x1 };
    return { x: 0, y: L.las.yb + L.las.T, len: L.las.lens.x1 };
  }
  // the head's pivot, in the sim
  function pivotOf(o, p, out) {
    const H = p._hl || (p._hl = headLay(p));
    aimPt(p, H.x, H.y, out);
    for (let g = o.tgOf && o.tgOf.get(p.id); g; g = g.parent) aimTurn(g, out, g.ring.aimYaw || 0);
    const w = o.toWorld(out.x, out.y, out.z);
    out.x = w.x; out.y = w.y; out.z = w.z;
    return out;
  }
  // part-frame direction (yaw, el) → the sim's
  function dirOf(o, p, yaw, el, out) {
    const ce = Math.cos(el);
    let x = ce * Math.cos(yaw), y = Math.sin(el), z = ce * Math.sin(yaw);
    for (let i = 0, k = p.rot & 3; i < k; i++) { const t = x; x = -y; y = t; }
    for (let g = o.tgOf && o.tgOf.get(p.id); g; g = g.parent) { const a = g.ring.aimYaw || 0, cs = Math.cos(a), sn = Math.sin(a), x0 = x; x = x0 * cs - z * sn; z = x0 * sn + z * cs; }
    return qrot(o.q, x, y, z, out);
  }
  // the sim's direction (dx, dy, dz) → the part's yaw and elevation
  const RING = [];
  function anglesOf(o, p, dx, dy, dz, out) {
    const A = o.toLocal(o.x, o.y, o.z), B = o.toLocal(o.x + dx, o.y + dy, o.z + dz);
    let x = B.x - A.x, y = B.y - A.y, z = B.z - A.z;
    RING.length = 0;
    for (let g = o.tgOf && o.tgOf.get(p.id); g; g = g.parent) RING.push(g);
    for (let i = RING.length - 1; i >= 0; i--) { const a = -(RING[i].ring.aimYaw || 0), cs = Math.cos(a), sn = Math.sin(a), x0 = x; x = x0 * cs - z * sn; z = x0 * sn + z * cs; }
    for (let i = 0, k = p.rot & 3; i < k; i++) { const t = x; x = y; y = -t; }
    out.yaw = Math.atan2(z, x); out.el = Math.atan2(y, Math.hypot(x, z));
    return out;
  }
  const smoky = (a, b) => typeof Combat !== 'undefined' && Combat.S.smoke.length > 0 && typeof Aim !== 'undefined' && Aim.smokeBlocks(a, b);
  // can a head at P see drone d: a clear line (cached 4 Hz per head and target) and no smoke between
  function headSees(p, P, d) {
    const M = p._los || (p._los = new Map()), c = M.get(d), t = CB.now;
    let ok;
    if (c && t >= c.t && t - c.t < 0.25) ok = c.ok;
    else { ok = clearSky(d.body, P, d); if (M.size > 16) M.clear(); M.set(d, { t, ok }); }
    return ok && !smoky(P, d);
  }
  const ANG = { yaw: 0, el: 0 }, PIV = {}, DIR = {};
  // turn the head toward (yaw, el) at its rates, within its elevation; the errors left before the turn
  function slew(p, want, yr, er, el, h) {
    const dy = wrapAngle(want.yaw - (p.aimYaw || 0)), wantE = clamp(want.el, el[0] * RADI, el[1] * RADI), de = wantE - (p.aimEl || 0);
    p.aimYaw = wrapAngle((p.aimYaw || 0) + clamp(dy, -yr * h, yr * h));
    p.aimEl = (p.aimEl || 0) + clamp(de, -er * h, er * h);
    return Math.max(Math.abs(dy), Math.abs(de));
  }
  const RADI = Math.PI / 180;
  // The gun's target (every 0.1 s): the nearest hostile drone within 600 m it sees, or within 1.1 km when a sensor marks
  // it (the cue), over its lowest elevation
  function gunPick(o, p, g, P) {
    let best = null, bd = Infinity;
    for (const d of threats(o, CB.F)) {
      const r = Math.hypot(d.x - P.x, d.y - P.y, d.z - P.z);
      if (r >= bd || r > g.cued || (r > g.range && marked(o, d) < 2)) continue;
      anglesOf(o, p, d.x - P.x, d.y - P.y, d.z - P.z, ANG);
      if (ANG.el < g.el[0] * RADI - 0.02 || ANG.el > g.el[1] * RADI + 0.02 || !headSees(p, P, d)) continue;
      bd = r; best = d;
    }
    return best;
  }
  // The anti-drone gun (an auto-turret, written like Combat's turretStep but its own: the old turret is untouched and
  // still parks on the ground): it picks, leads (the time of flight on the relative velocity, twice), turns and fires
  // 10 airburst rounds a second when on, on the ground too. Its rounds are ordinary tracers; each bursts 3 m from its
  // target (Combat's moveShot: explode's light 'ab' effect).
  function gunStep(o, p, h, F) {
    const g = p.def.cuas.gun;
    if (p.broken || o.ko) { p.gunOn = false; p.tgt = null; return; }
    if ((p._pick = (p._pick || 0) - h) <= 0) { p._pick = 0.1; const n = gunPick(o, p, g, pivotOf(o, p, PIV)); if (n !== p.tgt) { p.tgt = n; p.acq = (g.acq || 0) * (0.5 + prand(p)); } p.cue = !!n && marked(o, n) >= 2; if (p.cue) p.acq = Math.min(p.acq, (g.acq || 0) * 0.5); } // (a new target: acq s to settle on it first; half that, and a steadier track, while a sensor cues it)
    const t = p.tgt && isDrone(p.tgt) ? p.tgt : null;
    if (!t) { p.tgt = null; p.gunOn = false; slew(p, { yaw: p.aimYaw || 0, el: 0 }, g.yaw, g.elr, g.el, h); return; }
    p.acq = Math.max(0, (p.acq || 0) - h);
    const P = pivotOf(o, p, PIV), rx = t.vx - o.vx, ry = t.vy - o.vy, rz = t.vz - o.vz;
    // the time of flight on the relative velocity, twice, with the round's drag (Combat's moveShot: 1.2e-4·ρ·v² slowing
    // it) and its drop (held up by ½·g·t²: at 1 km a round falls 5 m)
    const cd = 0.00012 * airDensity(o.body, o.altitude()), r0 = Math.hypot(P.x, P.y, P.z) || 1, ux = P.x / r0, uy = P.y / r0, uz = P.z / r0;
    const tofOf = (d) => (cd > 1e-9 ? Math.expm1(cd * d) / (cd * g.speed) : d / g.speed);
    let ax = t.x - P.x, ay = t.y - P.y, az = t.z - P.z, tof = tofOf(Math.hypot(ax, ay, az));
    for (let i = 0; i < 2; i++) { const dr = 0.5 * G0 * tof * tof; ax = t.x + rx * tof - P.x + ux * dr; ay = t.y + ry * tof - P.y + uy * dr; az = t.z + rz * tof - P.z + uz * dr; tof = tofOf(Math.hypot(ax, ay, az)); }
    // (its tracker's error: a fresh offset up to jit rad each way every 0.5 s, from the part's own stream; the full jit
    // on a drone flying 30 m/s or more, less on a slower one, down to 0.15 of it on one hovering: a fast drone's lead is
    // hard to judge. A sensor's cue steadies it: cueJ)
    if ((p._jT = (p._jT || 0) - h) <= 0) { const j = (g.jit || 0) * (p.cue ? g.cueJ ?? 1 : 1) * clamp(Math.hypot(rx, ry, rz) / 30, 0.15, 1); p._jT = 0.5; p._jy = (prand(p) * 2 - 1) * j; p._je = (prand(p) * 2 - 1) * j; }
    const want = anglesOf(o, p, ax, ay, az, ANG);
    want.yaw += p._jy || 0; want.el += p._je || 0;
    const err = slew(p, want, g.yaw, g.elr, g.el, h);
    p.gunOn = err <= 0.04 && p.ammo > 0 && !(p.acq > 0);
    if (!p.gunOn) return;
    p.cool = (p.cool || 0) - h;
    if (p.cool > 0) return;
    p.cool = Math.max(p.cool, -h) + 1 / g.rate;
    t.kitAt = F.time || 0; // (the automatic kit at it: a drone it brings down is no range knock-out of the player's; P4-AI-4)
    gunRound(o, p, g, F, t, 0);
  }
  // one round along the head's aim (net: a ghost's, for show: no damage, its owner says what it hit)
  function gunRound(o, p, g, F, t, net) {
    const D = dirOf(o, p, p.aimYaw || 0, p.aimEl || 0, DIR), P = pivotOf(o, p, PIV), H = p._hl, sp = g.spread;
    const dx = D.x + (prand(p) - 0.5) * sp, dy = D.y + (prand(p) - 0.5) * sp, dz = D.z + (prand(p) - 0.5) * sp, m = H.len + 0.6;
    const s = { k: 'bullet', b: o.body, x: P.x + D.x * m, y: P.y + D.y * m, z: P.z + D.z * m, vx: o.vx + dx * g.speed, vy: o.vy + dy * g.speed, vz: o.vz + dz * g.speed,
      t: 0, life: 2, dmg: net ? 0 : g.dmg, blast: 0, owner: o, enemy: !!o.ai && !o.ai.ally, tracer: true, net: net || 0 };
    if (!net) { s.ab = g.ab; s.abR = g.abR; s.abD = g.abD; s.tgt = t; }
    Combat.S.shots.push(s);
    p.ammo = Math.max(0, (p.ammo || 0) - 1);
    p.shots = (p.shots || 0) + 1;
    if (p.shots % 3 === 0 && typeof Sound !== 'undefined' && camDist(F, o) < 1500) Sound.gun(false);
  }
  // The laser's target: the hostile drone closing on the vessel fastest (the least time to reach it) within 1 km, or
  // 1.5 km when a sensor marks it, in sight with no smoke; it keeps the one it burns while that one stays fair
  function laserFair(o, p, L, P, d) {
    if (!isDrone(d) || !foe(o, d)) return false;
    const r = Math.hypot(d.x - P.x, d.y - P.y, d.z - P.z);
    if (r > L.cued || (r > L.range && marked(o, d) < 2)) return false;
    anglesOf(o, p, d.x - P.x, d.y - P.y, d.z - P.z, ANG);
    return ANG.el >= L.el[0] * RADI - 0.02 && ANG.el <= L.el[1] * RADI + 0.02 && headSees(p, P, d);
  }
  function laserPick(o, p, L, P) {
    if (p.tgt && laserFair(o, p, L, P, p.tgt)) return p.tgt;
    let best = null, bt = Infinity;
    for (const d of threats(o, CB.F)) {
      if (!laserFair(o, p, L, P, d)) continue;
      const dx = d.x - o.x, dy = d.y - o.y, dz = d.z - o.z, r = Math.hypot(dx, dy, dz) || 1, cl = -((d.vx - o.vx) * dx + (d.vy - o.vy) * dy + (d.vz - o.vz) * dz) / r;
      const tt = r / Math.max(cl, 0.1);
      if (tt < bt) { bt = tt; best = d; }
    }
    return best;
  }
  // The anti-drone laser: turns at 1.5 rad/s onto its target, and on it (within 0.01 rad) dwells: the drone's controller
  // burns out after 0.8 s up close, 3 s at 1.5 km (kill: 0.8 + 2.2·(d/1.5 km)²). The beam is on while it dwells: 8 s of
  // it, then off until cooled to 0.3 (5 s from full). In a room a ghost drone's owner takes the hit (MP.sendHit).
  function laserStep(o, p, h, F) {
    const L = p.def.cuas.laser;
    if (p.broken || o.ko) { p.gunOn = false; p.tgt = null; p.dwell = 0; laserHeat(p, L, h, false); return; }
    const P = pivotOf(o, p, PIV);
    if ((p._pick = (p._pick || 0) - h) <= 0) { p._pick = 0.1; const t = laserPick(o, p, L, P); if (t !== p.tgt) { p.tgt = t; p.dwell = 0; p.acq = (L.acq || 0) * (0.5 + prand(p)); } } // (a new target: 0.5-1.5 × acq s to find and settle on it first)
    const t = p.tgt && isDrone(p.tgt) ? p.tgt : null;
    if (!t) { p.tgt = null; p.gunOn = false; p.dwell = 0; laserHeat(p, L, h, false); slew(p, { yaw: p.aimYaw || 0, el: 0 }, L.yaw, L.elr, L.el, h); return; }
    const err = slew(p, anglesOf(o, p, t.x - P.x, t.y - P.y, t.z - P.z, ANG), L.yaw, L.elr, L.el, h);
    p.acq = Math.max(0, (p.acq || 0) - h);
    const on = err <= 0.01 && !p.hot && !(p.acq > 0);
    p.gunOn = on;
    laserHeat(p, L, h, on);
    if (p.hot) p.dwell = 0; // (out of beam time: what it had burnt cools off with it)
    if (!on) return;
    const r = Math.hypot(t.x - P.x, t.y - P.y, t.z - P.z);
    t.kitAt = F.time || 0; // (as the gun's: P4-AI-4)
    beamOf(o, p, F, t, r);
    p.dwell = (p.dwell || 0) + h;
    if (p.dwell < L.kill[0] + L.kill[1] * (r / L.cued) ** 2) return;
    p.dwell = 0; p.tgt = null; p._pick = 0;
    const part = (t.dr && t.dr.fcPart && t.parts.includes(t.dr.fcPart) ? t.dr.fcPart : null) || t.parts[0];
    if (!part) return;
    if (t.remote) { if (typeof MP !== 'undefined' && MP.sendHit) MP.sendHit(t, part, Combat.maxHp(part.def) * 2, 'shot'); }
    else Combat.damage(t, part, 1e6, 'laser', F, o);
  }
  function laserHeat(p, L, h, on) {
    p.heat = clamp((p.heat || 0) + (on ? h / L.on : -h / L.cool), 0, 1);
    if (p.heat >= 1) p.hot = true;
    else if (p.hot && p.heat <= 0) p.hot = false; // (it cools all the way before it burns again)
  }
  // a laser's beam this frame, from its lens to r m along its aim (render3d draws Drone.beams), and a flare where it ends
  // every 0.1 s (a flash that lights nothing)
  function beamOf(o, p, F, t, r) {
    const D = dirOf(o, p, p.aimYaw || 0, p.aimEl || 0, DIR), P = pivotOf(o, p, PIV), k = p._hl.len;
    const B = p._beam || (p._beam = { b: null, a: {}, e: {}, col: BEAM_COL, w: 0.06, t: 0 });
    B.b = o.body; B.a.x = P.x + D.x * k; B.a.y = P.y + D.y * k; B.a.z = P.z + D.z * k;
    if (t) { B.e.x = t.x; B.e.y = t.y; B.e.z = t.z; } else { B.e.x = P.x + D.x * r; B.e.y = P.y + D.y * r; B.e.z = P.z + D.z * r; }
    B.t = F.time || 0; B.o = o;
    const T = F.time || 0;
    if (!(T - (p._flareT ?? -1e9) < 0.1) || T < p._flareT) {
      p._flareT = T;
      FX.add({ kind: 'flash', b: o.body, x: B.e.x, y: B.e.y, z: B.e.z, vx: 0, vy: 0, vz: 0, max: 0.12, size: 0.5, grow: 0.8, color: '#ff8a8a', alpha: 1, nolight: true });
    }
  }
  // A ghost's kit (Combat's netGuns, its pv's gunOn): its gun fires tracers along its aim for show; its laser shows its
  // beam 1.5 km along its aim. Hits are only ever its owner's to say.
  function netFire(g, p, h, F) {
    const c = p.def.cuas;
    if (c.gun && p.ammo > 0) {
      p._hl = p._hl || headLay(p);
      p.cool = (p.cool || 0) - h;
      if (p.cool > 0) return;
      p.cool = Math.max(p.cool, -h) + 1 / c.gun.rate;
      gunRound(g, p, c.gun, F, null, g.remote || 1);
    } else if (c.laser) { p._hl = p._hl || headLay(p); beamOf(g, p, F, null, 1500); }
  }

  // ---------------------------------------------------------------- the frame: beams, marks, the buzz
  // Drone.beams for render3d: the lasers burning this frame (a beam not renewed for 0.1 s is gone)
  function beamFrame(F) {
    beams.length = 0;
    const t = F.time || 0;
    for (const o of F.vessels) {
      if (!o.cuas || !o.cuas.length || o.dead) continue;
      for (const p of o.cuas) {
        const B = p._beam;
        if (B && p.gunOn && p.def.cuas.laser && t - B.t <= 0.1 && t >= B.t && beams.length < 8) beams.push(B);
      }
    }
    // its whine, near the camera (within 600 m)
    let near = Infinity;
    for (const B of beams) near = Math.min(near, camDist(F, B.o));
    const lvl = near < 600 ? 0.03 * (1 - near / 600) : 0;
    if (typeof Sound !== 'undefined' && typeof Sound.laser === 'function' && (lvl > 0 || CB.las > 0)) Sound.laser(lvl);
    CB.las = lvl;
  }
  // The marks (4 times a second, for the flown craft): its hostile drones it sees, nearest first, at most MARKS; a chirp
  // for a drone a sensor picks up that it didn't hold before; the buzz of the nearest within BUZZ m
  function markFrame(F) {
    const A = F.active;
    let near = Infinity;
    if (A && !F.destroyed) for (const d of threats(A, F)) near = Math.min(near, Math.hypot(d.x - A.x, d.y - A.y, d.z - A.z));
    const lvl = near < DRONE.BUZZ ? 0.05 * (1 - near / DRONE.BUZZ) : 0;
    if (typeof Sound !== 'undefined' && typeof Sound.buzz === 'function' && (lvl > 0 || CB.buzz > 0)) Sound.buzz(lvl);
    CB.buzz = lvl;
    const t = F.time || 0;
    if (t - CB.markT < 0.25 && t >= CB.markT) return;
    CB.markT = t;
    const M = CB.marks;
    M.length = 0;
    if (!A || F.destroyed) { CB.seen.clear(); return; }
    for (const d of threats(A, F)) {
      const k = marked(A, d);
      if (!k) continue;
      const dist = Math.hypot(d.x - A.x, d.y - A.y, d.z - A.z), cl = -((d.vx - A.vx) * (d.x - A.x) + (d.vy - A.vy) * (d.y - A.y) + (d.vz - A.vz) * (d.z - A.z)) / (dist || 1);
      M.push({ d, k, dist, cl });
    }
    M.sort((a, b) => a.dist - b.dist);
    if (M.length > DRONE.MARKS) M.length = DRONE.MARKS;
    let fresh = false;
    const now = new Set();
    for (const m of M) if (m.k >= 2) { now.add(m.d); if (!CB.seen.has(m.d)) fresh = true; }
    CB.seen = now;
    if (fresh && typeof Sound !== 'undefined' && typeof Sound.chirp === 'function') Sound.chirp();
  }
  // (Combat.step, every physics substep while Combat.S.dr) the fuses of drones with warheads; the anti-drone guns and
  // lasers of every vessel that has them (not a ghost's: its owner works them; not dead, a wreck or knocked out)
  function step(h, F) {
    if (!F || !F.vessels || !(h > 0)) return;
    CB.now = F.time || 0; CB.F = F;
    const vs = F.vessels;
    for (let i = 0, n = vs.length; i < n; i++) {
      const v = vs[i];
      if (!v || v.dead || v.remote || v.foreign) continue;
      if (v.kind === 'drone') { if (v.dr && v.dr.warheads.length && v.parts.length) fuse(v, h, F); continue; }
      if (!v.cuas || !v.cuas.length || v.wreck || v.ko) continue;
      for (const p of v.cuas) { const c = p.def.cuas; if (c.gun) gunStep(v, p, h, F); else if (c.laser) laserStep(v, p, h, F); }
    }
  }
  // (Combat.frame, every frame while Combat.S.dr) the bays' and links' frame, then the beams and the marks
  function frame(F, dt) {
    if (!F || !F.vessels || !(dt >= 0)) return;
    CB.now = F.time || 0; CB.F = F;
    bayFrame(F, dt); // (the bays' and the links': above)
    aiFrame(F, dt); // (the AI's drones: the AI section)
    beamFrame(F);
    markFrame(F);
  }
  // The marks on the HUD (main.js, after Combat.drawHUD, while Combat.S.dr): a grey ◇ for a drone seen by eye; an orange
  // ◇ and its range for one a detector hears (an arrow on the screen's edge when it is off it), and its closing speed
  // when a Drone Radar holds it. At most MARKS, nearest first.
  const PRJ = { x: 0, y: 0, behind: false };
  function drawMarks(ctx, W, H, dpr, F) {
    const M = CB.marks, A = F && F.active;
    if (!M.length || !A || F.destroyed || typeof Render3D === 'undefined' || !Render3D.ready) return;
    const bp = bodyPos(A.body, F.time);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1.5; ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center';
    for (const m of M) {
      const d = m.d;
      if (d.dead) continue;
      const s = Render3D.projectTo(bp.x + d.x, bp.y + d.y, d.z, PRJ), col = m.k >= 2 ? ORANGE : GREY;
      const off = s.behind || s.x < 8 || s.x > W - 8 || s.y < 8 || s.y > H - 8;
      ctx.strokeStyle = col; ctx.fillStyle = col;
      if (off) {
        if (m.k < 2) continue;
        let ex = s.x - W / 2, ey = s.y - H / 2;
        if (s.behind) { ex = -ex; ey = -ey; }
        const a = Math.atan2(ey, ex), k = Math.min((W / 2 - 22) / Math.max(Math.abs(Math.cos(a)), 1e-3), (H / 2 - 22) / Math.max(Math.abs(Math.sin(a)), 1e-3));
        const x = W / 2 + Math.cos(a) * k, y = H / 2 + Math.sin(a) * k;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); ctx.lineTo(x + Math.cos(a + 2.5) * 7, y + Math.sin(a + 2.5) * 7); ctx.lineTo(x + Math.cos(a - 2.5) * 7, y + Math.sin(a - 2.5) * 7); ctx.closePath(); ctx.fill();
        ctx.fillText(km(m.dist), clamp(x - Math.cos(a) * 16, 24, W - 24), clamp(y - Math.sin(a) * 16 + 4, 12, H - 6));
        continue;
      }
      const r = m.k >= 2 ? 7 : 5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x + r, s.y); ctx.lineTo(s.x, s.y + r); ctx.lineTo(s.x - r, s.y); ctx.closePath(); ctx.stroke();
      if (m.k >= 2) ctx.fillText(m.k >= 3 ? `${km(m.dist)} ${m.cl >= 0 ? '▼' : '▲'}${Math.round(Math.abs(m.cl))}` : km(m.dist), s.x, s.y + r + 13);
    }
  }

  // ================================================================ AI (spec §15.1)
  // The computer's drones (the Tank Range and the Practice Battle; never in a room): a stock drone flown by its own
  // controller's Level law, the AI steering through pre's autopilot target (dl.auto). It climbs to 30 m over the ground,
  // cruises at 20 m/s toward the nearest enemy within 1.5 km (where it will be in 2 s), and 200 m out dives at 0.9 of its
  // top speed on the enemy's roof (1.5 m over its middle, led for its motion): the contact fuse does the rest. With no
  // enemy near it heads for the zone nearest the enemy's pad. A passive drone (the range's practice targets) circles
  // 60 m round its spot 50 m up at 10 m/s and never arms. Jammed, its controller's failsafe has it (an FPV drops); under
  // 15 % charge it dives on the nearest enemy, wherever it is. It decides 4 times a second on its own clock (dl.t), so
  // the same seed flies the same way. Shot down it is Combat.aiDown's ("Enemy drone down!") and death.js's hulk; landed
  // 3 s or lost 60 s it goes (aiFrame).
  const AIK = { THINK: 0.25, ALT: 30, CRUISE: 20, LEAD: 2, SEE: 1500, TERM: 200, LEAVE: 300, TOP: 1.5, K: 0.9, LOW: 0.15, ORBIT: { V: 10, R: 40, H: 50 }, UP: 3 };
  // a spot on the space centre's map (e m along the track, z across it) h m over the ground, in the sim's axes
  function siteSpot(e, z, h) {
    const a = siteAngle(EARTH, e), ph = z / EARTH.radius, r = EARTH.radius + Terrain.surfaceAt(EARTH, a, z) + (h || 0);
    return { x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) };
  }
  const myTeam = () => (typeof GroundAI !== 'undefined' && GroundAI.battle ? GroundAI.battle.team : 0);
  // One more AI drone of stock template key (a drone template) for team, at site spot at = { e, z, h (m up), yaw }; or,
  // with opts.nest (an AI vehicle with a drone bay), the first bay's own drone launched off its deck as the player's are
  // (key null: the bay's stock drone; the bay one lighter). opts: { passive, at: the circle's middle { e, z }, nest }.
  // The vessel (in F.vessels), or null (no such drone, the rack empty).
  function spawnAI(F, key, at, team, opts) {
    if (!F || !F.vessels) return null;
    const o = opts || {}, N = o.nest || null, t = team === 0 ? 0 : 1;
    let bay = null;
    if (N) {
      if (N.dead || N.ko || N.wreck || !N.docks || !N.docks.length) return null;
      bay = N.docks.slice().sort((a, b) => DOCK_ORDER.indexOf(a.type) - DOCK_ORDER.indexOf(b.type)).find((p) => !p.broken && left1(p) > 0) || null;
      if (!bay) return null;
      if (key == null) key = bay.def.dock.stock;
    }
    if (typeof TEMPLATES === 'undefined' || typeof key !== 'string' || !hasOwn(TEMPLATES, key) || TEMPLATES[key].kind !== 'drone') return null;
    const ally = t === myTeam(), v = build(choiceRows({ key }), ally ? 'Allied drone' : 'Enemy drone');
    if (!v || !v.dr) return null;
    v.ai = { drone: true, ground: false, team: t, ally, tgt: null, state: o.passive ? 'passive' : 'climb', passive: !!o.passive, nest: N, key,
      at: o.at || (at ? { e: at.e, z: at.z } : null), thinkAt: -Infinity, goal: null, fuel0: v.dr.cells.map((p) => p.fuel),
      see: o.see > 0 ? o.see : AIK.SEE, cruise: o.cruise > 0 ? o.cruise : AIK.CRUISE }; // (see, cruise: the range's attack drone sees its target from where it starts and comes at full speed)
    if (N) { // off its deck, as a bay's launch (launch): its pose, 0.4 m over the bay's top, moving with it, then the hop
      v.q = quat(N.q.w, N.q.x, N.q.y, N.q.z);
      const T = dockTop(N, bay), Up = N.axis(0, 1, 0), off = v.com.y - v.bounds.minY + 0.4;
      v.x = T.x + Up.x * off; v.y = T.y + Up.y * off; v.z = T.z + Up.z * off;
      const pv = N.pointVel({ x: v.x - N.x, y: v.y - N.y, z: v.z - N.z });
      v.vx = pv.x; v.vy = pv.y; v.vz = pv.z; v.av = v3(); v.landed = false;
      v.dl = { t: 0, at0: { x: v.x, y: v.y, z: v.z }, t0: 0, hop: DRONE.LAUNCH.HOP_T, hopAlt: v.altitude() - 0.4 + DRONE.LAUNCH.HOP };
      bay.docked = left1(bay) - 1; bay.deployed = 1; bay._lidAt = F.time || 0;
    } else {
      if (!at) return null;
      v.placeOnSurface(EARTH, siteAngle(EARTH, at.e), 0, at.z, at.yaw || 0);
      const r = v.radius() || 1, h = at.h || 0;
      v.x += (v.x / r) * h; v.y += (v.y / r) * h; v.z += (v.z / r) * h;
      v.landed = h <= 0;
      v.dl = { t: 0, at0: { x: v.x, y: v.y, z: v.z }, t0: 0 };
    }
    state(v);
    F.vessels.push(v);
    return v;
  }
  // a world vector's parts in the heading frame S: f ahead, r right (its horizontal part), up, and its horizontal length h
  const FL = { f: 0, r: 0, up: 0, h: 0 };
  function flat(v, S, dx, dy, dz) {
    const rr = v.radius() || 1, ux = v.x / rr, uy = v.y / rr, uz = v.z / rr, k = dx * ux + dy * uy + dz * uz, hx = dx - ux * k, hy = dy - uy * k, hz = dz - uz * k;
    FL.f = hx * S.fx + hy * S.fy + hz * S.fz; FL.r = hx * S.rx + hy * S.ry + hz * S.rz; FL.up = k; FL.h = Math.hypot(hx, hy, hz);
    return FL;
  }
  // is u (a GroundAI unit) an enemy of AI drone v still in the fight?
  const foeUnit = (v, u) => !!u && !!u.v && u.v !== v && u.team !== v.ai.team && !u.v.dead && !u.v.wreck && !u.v.ko && u.v.hulk == null && !(u.v.ai && u.v.ai.down) && u.v.parts.length > 0;
  // The decision, 4 times a second: whom to go for (the nearest enemy within SEE; any distance on a low battery), and the
  // state (climb, cruise, terminal; passive stays passive)
  function aiThink(v, F, agl) {
    const a = v.ai, U = typeof GroundAI !== 'undefined' && GroundAI.units ? GroundAI.units : [];
    if (a.passive) return;
    const low = charge(v) < AIK.LOW;
    let best = null, bd = low ? Infinity : a.see || AIK.SEE;
    if (a.tgt && !U.some((u) => u.v === a.tgt && foeUnit(v, u))) a.tgt = null; // (gone, knocked out or a wreck)
    for (const u of U) {
      if (!foeUnit(v, u)) continue;
      const d = Math.hypot(u.v.x - v.x, u.v.y - v.y, u.v.z - v.z) - (u.v === a.tgt ? 200 : 0); // (it keeps its target unless another is 200 m nearer)
      if (d < bd) { bd = d; best = u.v; }
    }
    a.tgt = best;
    if (!best) { a.goal = a.goal || zoneGoal(v); if (a.state === 'terminal') a.state = 'cruise'; }
    if (a.state === 'climb' && agl >= AIK.ALT - AIK.UP) a.state = 'cruise';
    if (best) {
      const S = state(v).S || hframe(v), h = flat(v, S, best.x - v.x, best.y - v.y, best.z - v.z).h;
      if (low || h < AIK.TERM) a.state = 'terminal';
      else if (a.state === 'terminal' && h > AIK.LEAVE) a.state = 'cruise';
    }
  }
  // with nobody to go for: over the zone nearest the enemy's pad (the battle's zones, else Highland Ridge's), 30 m up
  function zoneGoal(v) {
    if (typeof GroundMode === 'undefined') return null;
    const B = typeof GroundAI !== 'undefined' ? GroundAI.battle : null, A = GroundMode.arena(B ? B.arena : 'highland'), Z = B ? B.obj.zones : A && A.zones;
    const pad = A && A.pads && A.pads[v.ai.team ? 0 : 1];
    if (!Z || !Z.length || !pad) return null;
    let bz = null, bd = Infinity;
    for (const zn of Z) { const d = Math.hypot(zn.e - pad.e, zn.z - pad.z); if (d < bd) { bd = d; bz = zn; } }
    return siteSpot(bz.e, bz.z, 0);
  }
  // An AI drone's autopilot target this step ({ vf, vr, vz, yawTo }), for pre; null: it hovers (as one does that spawnAI
  // didn't make: no state, no orders)
  function aiSteer(v, F, dt) {
    const a = v.ai;
    if (!a || !v.dr || !a.state) return null;
    const dl = state(v), S = dl.S || (dl.S = hframe(v)), fc = v.dr.fc || GPS, agl = v.altitude() - groundUnder(v, dl, S);
    if (!(dl.t - a.thinkAt < AIK.THINK) || dl.t < a.thinkAt) { a.thinkAt = dl.t; aiThink(v, F, agl); }
    const hold = (h) => clamp((h - agl) * DRONE.HOLD, -DRONE.VHOLD, fc.vz);
    // passive: round its spot, ORBIT.R m out, at ORBIT.V m/s, ORBIT.H m up
    if (a.passive) {
      const O = AIK.ORBIT, c = a.at ? (a.atS || (a.atS = siteSpot(a.at.e, a.at.z, 0))) : dl.at0, L = flat(v, S, v.x - c.x, v.y - c.y, v.z - c.z);
      const d = L.h || 1e-3, rf = L.f / d, rr = L.r / d, pull = clamp((O.R - d) * 0.3, -O.V, O.V); // (out from the middle: rf, rr; its way round is square to that)
      const vf = -rr * O.V + rf * pull, vr = rf * O.V + rr * pull;
      return { vf, vr, vz: hold(O.H), yawTo: S.head + Math.atan2(vr, vf) };
    }
    if (v.dr.wing) { // (a winged drone circles over what it goes for, 60 m up: the stock AI flies quads)
      const T = a.tgt || a.goal;
      return circleSteer(v, dl, S, T ? { x: T.x, y: T.y, z: T.z } : null, AIK.ALT * 2);
    }
    if (a.state === 'climb') return { vf: 0, vr: 0, vz: clamp((AIK.ALT - agl) * DRONE.HOLD + 1, 1, fc.vz), yawTo: S.head };
    const t = a.tgt;
    if (t && a.state === 'terminal') { // the dive: on its roof, led for its motion over the time it takes to get there
      const r = Math.hypot(t.x, t.y, t.z) || 1, sp = AIK.K * fc.vmax;
      let tgo = Math.hypot(t.x - v.x, t.y - v.y, t.z - v.z) / sp;
      const P = { x: t.x + (t.x / r) * AIK.TOP, y: t.y + (t.y / r) * AIK.TOP, z: t.z + (t.z / r) * AIK.TOP };
      for (let i = 0; i < 2; i++) { // (where it will be: twice round, the time to it from where it will be)
        const qx = P.x + (t.vx || 0) * tgo - v.x, qy = P.y + (t.vy || 0) * tgo - v.y, qz = P.z + (t.vz || 0) * tgo - v.z;
        tgo = Math.hypot(qx, qy, qz) / sp;
      }
      const L = flat(v, S, P.x + (t.vx || 0) * tgo - v.x, P.y + (t.vy || 0) * tgo - v.y, P.z + (t.vz || 0) * tgo - v.z), D = Math.hypot(L.h, L.up) || 1e-3;
      return { vf: (L.f / D) * sp, vr: (L.r / D) * sp, vz: (L.up / D) * sp, yawTo: L.h > 2 ? S.head + Math.atan2(L.r, L.f) : S.head };
    }
    // cruise: toward where the target will be in LEAD s (or the zone), CRUISE m/s at most, ALT m up, nose toward it
    const G = t ? { x: t.x + (t.vx || 0) * AIK.LEAD, y: t.y + (t.vy || 0) * AIK.LEAD, z: t.z + (t.vz || 0) * AIK.LEAD } : a.goal;
    if (!G) return { vf: 0, vr: 0, vz: hold(AIK.ALT), yawTo: S.head };
    const L = flat(v, S, G.x - v.x, G.y - v.y, G.z - v.z), d = L.h || 1e-3, sp = Math.min(fc.vmax, a.cruise || AIK.CRUISE, d * 0.5);
    return { vf: (L.f / d) * sp, vr: (L.r / d) * sp, vz: hold(AIK.ALT), yawTo: d > 5 ? S.head + Math.atan2(L.r, L.f) : S.head };
  }
  // (Drone.frame, after the bays') The AI drones' upkeep: a passive one's battery kept full (a practice target: it flies
  // till it is shot down); one landed 3 s, or lost 60 s, goes with a puff. A hulk is death.js's alone (plan I13).
  function aiFrame(F, dt) {
    for (let i = F.vessels.length; i--;) {
      const v = F.vessels[i];
      if (!v || !v.ai || !v.ai.drone || v.remote || v.dead || v.hulk != null || !v.dr) continue;
      const dl = state(v), a = v.ai;
      if (a.passive && a.fuel0) v.dr.cells.forEach((p, k) => { if (a.fuel0[k] != null) p.fuel = a.fuel0[k]; });
      dl.restT = v.landed ? (dl.restT || 0) + dt : 0;
      if (dl.restT >= DRONE.REST_GONE || (dl.lost && dl.lostT >= DRONE.LOST_GONE)) gone(F, v);
    }
  }

  // ================================================================ MP
  // (mp.js carries a second craft's messages: the craft index c, tc, extras)

  const api = {
    // physics
    groups, pre, turn, wingTurn, stats,
    // bays
    fits, freeBays, cleanChoice, choiceRows, build,
    // flight
    key, take, launch, back, home, land, lost, lastFlight, endLastFlight, forSave, dock, lagged, station, foe, alertText,
    // combat
    step, frame, detonate, cookOff, die, payload, netFire, threats, marked, seeR, spotR, ownedAir, beams, emits,
    // AI
    spawnAI, aiSteer,
    // HUD
    drawOSD, osdBoxes, drawMarks, alarm, help, fov, left, batt, linkState, jamN, leverText, impactView, tap, hud, _osd: O,
    // helpers
    isDrone, fcOf, linkOf, charge, list, hframe, camDir,
  };
  return api;
})();
