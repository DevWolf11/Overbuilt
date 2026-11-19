'use strict';
// Ships (the ships update). A ship is a craft of kind 'ship' built bow-right from hull segments (the Ship kind's five
// tabs: def.ship), as Armour is: +x the bow, +y up, +z starboard. What floats is any craft with a hull part (def.hull,
// whatever its kind: a tank with a boat hull swims, a seaplane on pontoons floats) or a piece split off one: v.hydro
// (Vessel.rebuildGroups). A hydro vessel meets the water ring by ring (each hull part's def.shull, sampled by parts.js's
// shullOf: the same rings are its 2D outline, its 3D loft, its clash shape and where it is hit), is pushed by its screws
// and waterjets, steered by its rudders, floods through holes compartment by compartment, burns, and sinks by physics.
// isSea(kind) (parts.js) only says what a craft *is*: a surface contact (never an air target), the helm keys and HUD,
// knots, zones at sea.
//
// Old designs never reach any of it: every hook in the other files opens only for v.hydro, def.ship / def.shull /
// def.hull, kind 'ship', Combat.S.sea, Combat.S.pd, Ship.D.length, ai.sea, MP.naval or a message's new field
// (test/ground.test.js counts the calls into Ship; spec §13 lists every hook). No top-level DOM or THREE: the file
// loads headless (test/lib/game.js; G.load({ ship: false }) leaves it out, to prove old play is the same without it).
//
// Sections, in order: core (hydro physics, the helm, grounding, mooring) · waves · builder (hydrostatics, placement,
// warnings) · damage (holes, flooding, fires, damage control, fate) · combat (torpedoes, CIWS, anti-ship missiles,
// surface contacts) · hud · ai · mp. Each package of the update fills its own section's bodies; the contract (WP0)
// gives every one of them as a stub with its signature and its default answer, so they all build against it.
//
// Per-vessel state, v.sh (made by Ship.groups from Vessel.rebuildGroups, for hydro vessels only; null otherwise):
//   rings     every physics ring of every hull part, in part space: { p (its part), ci (its compartment's index),
//             R (the shullOf phys ring: P, K, A, cy, girth, yd, yk, bd, bw, nb, dx; in the part's own frame), x, y, z
//             (the ring's keel-line point at its station, part space), ex, ey (the part's own x and y in part space:
//             the hull's fore-aft and up), P (a Float32Array of the K points [x, y, z] in part space), dx, A, cy }
//   comps     the watertight compartments: [{ parts, x0, x1 (part-space x along the hull), V (m³ to the deck), W (water
//             aboard, m³), holes: [{ p, x, y, a (m²), t, fix }] }]
//   hulls     the hull parts; joins: [[aft part, fore part], …] (segments that meet section to section); open: the
//             'joint' ends nothing meets ([{ p, end: 'aft' | 'fore' }]: a permanent hole of the end ring's area)
//   thrust    screws, waterjets and outboards; foils (every def.foil part); rudders (foils of kind 'rudder', and
//             outboards and waterjets that steer); engines (def.engine parts: the shaft-power pool); decks (def.deck)
//   tel       the engine-order telegraph, -3..4 (Stop 0; SHIP.TEL's index − 3); rud: the helm's rudder command (°);
//             hold: the heading the helm holds (rad, null: none); dcPri: 'auto' | 'flood' | 'fire'; ciwsOn
//   fsub      the submerged share of the weight (0..1); B (the buoyancy, N); Lwl, Swet (waterline length, wetted
//             area); draft; level (still water's height: 0 at sea, a lake's surface inland); depth (water under her);
//             fade (the waves' share there); moorT (s still, toward mooring); lodT
// Saved per part (GV_SAVE, when the damage package adds them): p.holes, p.water, p.rud, p.fire; per vessel: sh: { tel,
// dcPri, ciwsOn } and sas.

// All tuning in one table (lengths m, speeds m/s, angles ° unless said, times s, areas m², volumes m³, power kW).
const SHIP = {
  // ---- water and the hull's forces (§4.2-4.3)
  RHO: 1025, NU: 1.19e-6,            // sea water's density (kg/m³) and kinematic viscosity (m²/s)
  latLin: 1.0, cross: 0.9,           // lateral force: linear lift C_lin = latLin·π·T̄/L_wl (refreshed every LAT_T s), cross-flow drag C_x
  LAT_T: 0.5,
  planeK: 1.3, dispK: 0.2,           // strip planing lift on plane: true hulls, and on the rest
  heaveCd: 1.0, planeFade: 0.15,     // heave drag; the vertical terms fade in over the first planeFade m of immersion
  CF_RE: 1e5, CF_LOW: 0.0083,        // ITTC-57 friction C_f = 0.075/(log10 Re − 2)², and its value under Re 1e5
  // wave-making and residual resistance R_w = B·C_wr(Fn), piecewise linear (flat past the last Froude number)
  CWR_FN: [0, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.80, 1.2, 2.0],
  CWR: [0, 0.0003, 0.0008, 0.002, 0.005, 0.010, 0.019, 0.032, 0.048, 0.062, 0.075, 0.070, 0.055, 0.040],
  CLAMP: 0.8,                        // a quadratic term's impulse a step: at most this share of the momentum it opposes
  TINY: 200, TINY_FILL: 0.6, TINY_DAMP: 2, // pieces under TINY kg float as boxes (their bounds × TINY_FILL), damped e^(−TINY_DAMP·dt)
  REFRESH: 0.5,                      // m moved between looks at the water's depth, level and the waves' fade (Gear's cache)
  // ---- added mass and damping (§4.7): a step's acceleration ÷ (1 + k·fsub), per part axis
  ADD_M: { x: 0.05, y: 0.8, z: 0.6 }, ADD_I: { x: 0.15, y: 0.6, z: 0.8 }, // (rotations: x roll, y yaw, z pitch)
  rollZeta: 0.07, bilgeKeel: 0.03,   // roll damping ratio (+ def.shull.bk on hulls with bilge keels)
  STAB_T: 0.5, STAB_HEEL: 1,         // GM_now from the last STAB_T s's righting slope, past STAB_HEEL° of heel
  // ---- foils: rudders, hydrofoils, skegs (§4.4)
  FOIL: { slope: 0.9, stall: 22, post: 65, postMin: 0.5, cd0: 0.012, e: 0.8, stallCd: 1.2, sub: 0.8, wash: 0.8, washL: 3, washZ: 0.6, washY: 1, brk: 1.5 },
  //   (slope × 2π·ar/(ar + 2); stall angle; past it C_L falls over `post`° to postMin of its peak; C_D = cd0 + C_L²/(e·π·ar)
  //   + stallCd·sin²α stalled; lift fades in over sub × chord of depth; a rudder within washL·D behind a screw (|Δz| <
  //   washZ·D, |Δy| < washY·D) feels wash × its slipstream; a foil past brk × its load breaks)
  rudRate: 12,                       // °/s a rudder turns
  RIDE: { h: 0.8, kh: 4, kv: 2, lim: 6, kphi: 15 }, // hydrofoil ride control: target clearance (m), °/m, °·s/m, ±° trim, ° per rad of heel
  // ---- propulsion (§4.5)
  TEL: [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.8, 1.0], // the telegraph's demand, Full Astern … Flank (tel −3 … 4)
  TEL_NAMES: ['Full astern', 'Half astern', 'Slow astern', 'Stop', 'Slow', 'Half', 'Full', 'Flank'],
  ASTERN: 0.7,                       // thrust efficiency going astern
  TEL_HOLD: 0.5, TEL_REPEAT: 0.35,   // a held W/S steps again after TEL_HOLD s, then every TEL_REPEAT s
  SCREW: { k0: 0.75, va: 0.9, vmin: 0.5, sub: 0.5, rpm: 600 }, // static thrust k0·(2ρA·P²)^(1/3); advance speed va·u; surfaces over sub·D; rpm = rpm/D·√|demand|
  JET: { t0: 0.6, eta0: 0.35, eta1: 0.35, v0: 5, v1: 18, bucket: 0.5 }, // a waterjet: t0 of a screw's static thrust; η = eta0 + eta1·smoothstep(v0, v1, V); astern bucket
  OUTBOARD_STEER: 30,
  // ---- the helm (§4.6)
  HOLD: { lead: 1.5, kp: 2.0, kd: 2.5, vmin: 2, dead: 0.05 }, // heading hold: ψ* = ψ + r·lead on release; rud = −(kp·Δψ + kd·(L_wl/max(V, vmin))·r)
  // ---- grounding, carriers, other ships (§4.8)
  BED_CRASH: 1.5, BED_MU: 0.4,       // a sea-bed contact's crash limit × and friction
  IMPACT: { hp: 0.4, hole: 0.02, remove: 2 }, // a grounding past a hull's limit: 40 % of its hp, a hole of 0.02 m² per m/s over, removed past 2×
  DECK_BAND: 1.5, CARRIER_DEPTH: 9,  // a deck (carrier or ship) is met from DECK_BAND m under it; a carrier's hull box reaches CARRIER_DEPTH m under the sea
  BUMP: { e: 0.1, push: 0.5, v: 2.5, dmg: 0.5, hole: 0.002 }, // ship on ship: restitution, push-out share, damage from v m/s (0.5·μ·s²/1000 hp), holes 0.002·s² m²
  LASH: { v: 0.3, t: 1, lift: 0.3, tilt: 25 }, // a craft on a moving deck is lashed under v m/s for t s with no lift; let go past lift or tilt°
  // ---- mooring, warp, far ships (§4.10)
  MOOR: { t: 5, v: 0.5, wake: 200, wakeV: 2, hz: 10 }, // still for t s under v m/s: moored (drifts on the waves at hz); woken by a craft within wake m faster than wakeV
  aiNear: 12000,                     // m: AI ships are stepped this far from the player
  LOD: 1500,                         // m from the camera: every other ring, forces every other step
  // ---- launch (§4.11)
  LAUNCH: { shallow: 2, step: 50, max: 1000 }, // a spot with the keel within `shallow` m of the bed moves out to sea in `step` m steps, up to `max`
  // ---- units
  KN: 1.943844,                      // knots per m/s (ship displays speak knots)
  // ---- damage (§8.4-8.8)
  HOLE: { kin: 1.5, heIn: 0.004, he: 0.02, tamp: 3, tampD: 0.5, cap: 20, grp: 0.002, max: 16 },
  //   (a round through the plate: kin·π·(cal/2000)²; HE bursting inside: + heIn·blast²; HE on or near the hull: he·blast²·(1 −
  //   d/blast), × tamp under water (deeper than tampD); at most cap m² a hole; a bullet through glass fibre grp m²; max
  //   holes kept per part)
  FLOOD: { cd: 0.6, hz: 10, downT: 2, downA: 0.05, fsMax: 0.45 }, // orifice coefficient; steps a second; downflooding after downT s (downA m² per m of deck edge under); free-surface shift cap (× beam)
  FIRE: { hz: 4, odds0: 0.15, odds1: 0.35, blast: 9, hp: 4, spread: 0.02, dc: 20 }, // fire odds odds0 + odds1·(blast/9); hp/s; spread a second; s to fight one
  MAG: { near: 6, t: 5, r0: 8, rk: 1 / 20, hole: 6 }, // a fire within `near` m for t s; the blast's size r0 + rounds·rk m; holes in the neighbours
  DC: { patch: 0.02, minT: 15, full: 0.7, repair: 2 }, // a party patches 0.02 m²/s (at least minT s a hole), not past full of its compartment; repairs × REPAIR_T
  FATE: { hz: 4, capsize: 60, capsizeT: 4, reserve: 0.97, deckUnder: 1, scuttleT: 60, scuttleA: 1, under: 3, bedT: 10, wreckDepth: 40, gone: 40, derelictT: 120, derelictA: 0.5, wait: 15 },
  //   (capsized: heel past capsize° for capsizeT s; foundering: weight + water past reserve × the intact hull's buoyancy, or
  //   the highest deck deckUnder m under; out of action: scuttled after scuttleT s, a scuttleA m² hole a compartment; sunk
  //   when the top is `under` m under or bedT s on the bed; a wreck stays on a bed shallower than wreckDepth, else gone
  //   `gone` m down; a derelict holed after derelictT s; the end screen waits up to `wait` s)
  // ---- combat (§8.9-8.11)
  CIWS: { cone: 30, disp: 0.002, burst: 1, on: 1, kill: 2.5, p: 0.35 }, // a missile heading within cone° of her; 2 mrad; 1 s bursts within on°; a round within kill m kills with p
  TORP: { turn: 6, aground: 4, bubbles: 0.2, depthOff: 0 }, // °/s homing turn; runs aground where the bed is shallower; s between bubble puffs
  ASM: { term: 2000, termH: 3 },     // an anti-ship missile sea-skims until term m out, then goes in at termH m
  VLS: { t: 0.8, rate: 60 },         // a vertical launch pitches over for t s at rate °/s
  RADAR: { lowAir: 100, rcsL: 150, rcsExp: 0.35, rcsMin: 0.4 }, // aircraft under lowAir m are surface contacts; reach × clamp((L_wl/rcsL)^rcsExp, rcsMin, 1)
  EYES: { day: 8000, night: 3000 },  // m within the horizon
  LOS: { step: 200, land: 3000, cell: 500 }, // a look over water samples the ground every step m within land m of land (a mask per cell m)
  AIM: { ray: 20000, zero: [100, 20000] }, // a ship's aim ray and her guns' zero
  // ---- the AI (§9.1)
  AI: { think: 4, look: 1, gunK: [0.5, 0.8], missile: [8000, 12000], ahead: [1, 2, 3], aheadMin: 300, aheadT: 25, fan: [30, 60],
        avoid: 500, err: [0.003, 0.001], walk: 0.3, torpR: 3000, torpN: 2, torpSpread: 4, torpEvery: 60, asm: [3000, 12000], asmEvery: 20,
        zig: 30, zigT: 20, retreat: 0.5, column: 600, losT: 0.5 },
  STRIKE: { alt: 300, low: 60, lowR: 3000, rel: 800, every: 180, max: 2 }, // strike aircraft: run in at alt m, low for the last lowR m, release at rel m; one every `every` s, at most max
  // ---- waves (§5.1): at Moderate, [amplitude m, period s, direction ° from the swell's heading, phase rad]
  SEA: { calm: { a: 0.3, t: 0.75 }, moderate: { a: 1.0, t: 1.0 }, rough: { a: 2.5, t: 1.36 } }, // amplitude and period factors
  WAVES: [[0.28, 5.5, 0, 0.0], [0.18, 4.4, 25, 1.7], [0.12, 6.6, -20, 4.1], [0.07, 3.3, 50, 2.6]],
  swellDir: 250,                     // the swell runs toward this bearing (° from game north, clockwise): from the WSW
  FADE: [3, 25],                     // no swell in water shallower than 3 m, all of it past 25 m
  SLEW: 0.05,                        // s/s the sea clock slews toward the host's in a room
  // ---- drawing (§5.2-5.3)
  SWELL: { high: [128, 4], low: [64, 6], near: 2000, alt: 1500, grid: 33, recentre: 1 / 8, edge: [0.7, 0.95] }, // cells and their size; shown with a hydro vessel within near m and the camera under alt m
  WAKE: { n: 6, pts: 48, dt: 0.25, grow: 0.15, life: 12, kelvin: 19.5, kelvinT: 6, near: 1500, vmin: 1 },
  SPRAY: { v0: 3, k: 0.6, max: 8, near: 800 },
};
SHIP.SEAS = Object.keys(SHIP.SEA); // ('calm', 'moderate', 'rough')

const Ship = (() => {
  const NONE = Object.freeze([]);
  const S = { sea: 'moderate', seaOff: 0 }; // (the sea state and the sea clock's offset from the flight's: §waves)

  // ==== core ====
  // A hydro vessel's groups (from Vessel.rebuildGroups, v.hydro only): its hull rings in part space, its compartments,
  // which hull segments meet and which ends lie open, its screws, foils, rudders, engines and decks. The helm's state
  // (telegraph, rudder, heading hold, damage control's priority, point defence) carries over a rebuild, as do the water
  // in a compartment whose hull part is still aboard.
  function groups(v) {
    const was = v.sh, hulls = [], rings = [], comps = [], thrust = [], foils = [], rudders = [], engines = [], decks = [];
    for (const p of v.parts) {
      const d = p.def;
      if (d.shull) hulls.push(p);
      if (d.screw || d.jet) thrust.push(p);
      if (d.foil) { foils.push(p); if (d.foil.kind === 'rudder') rudders.push(p); }
      if (d.steer || (d.jet && d.jet.steer)) rudders.push(p); // (an outboard turns whole, a waterjet's nozzle turns)
      if (d.engine) engines.push(p);
      if (d.deck) decks.push(p);
    }
    const old = new Map(was ? was.comps.map((c) => [c.parts[0].id, c]) : []);
    for (const p of hulls) {
      const H = shullOf(p.def), o = partPt(p, 0, 0), ax = partPt(p, 1, 0), ay = partPt(p, 0, 1), z0 = partZ(p);
      const ex = { x: ax.x - o.x, y: ax.y - o.y, z: 0 }, ey = { x: ay.x - o.x, y: ay.y - o.y, z: 0 }, ci = comps.length;
      const at = (lx, ly, lz, out, k) => { const q = partPt(p, lx, ly); out[k] = q.x; out[k + 1] = q.y; out[k + 2] = z0 + lz; };
      for (const R of H.phys) {
        const P = new Float32Array(R.K * 3);
        for (let i = 0; i < R.K; i++) at(R.x, R.P[2 * i], R.P[2 * i + 1], P, 3 * i);
        const c = partPt(p, R.x, R.yk);
        rings.push({ p, ci, R, x: c.x, y: c.y, z: z0, ex, ey, P, dx: R.dx, A: R.A, cy: R.cy });
      }
      const a = partPt(p, H.x0, 0), b = partPt(p, H.x1, 0), prev = old.get(p.id);
      comps.push({ parts: [p], x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), V: H.vol, W: prev ? prev.W : Number.isFinite(p.water) ? p.water : 0, holes: prev ? prev.holes : [] });
    }
    // segments that meet: adjacent, of one class, the fore end of one within 2 cm of the aft end of the other (keels level)
    const joins = [], end = (p, fore) => { const H = shullOf(p.def), R = fore ? H.rings[H.nr - 1] : H.rings[0], q = partPt(p, R.x, R.yk); return { x: q.x, y: q.y, z: partZ(p) }; };
    const met = new Set();
    for (const a of hulls) for (const b of hulls) {
      if (a === b || a.def.shull.cls !== b.def.shull.cls || !(v.adj.get(a.id) && v.adj.get(a.id).has(b.id))) continue;
      const f = end(a, true), t = end(b, false);
      if (Math.abs(f.x - t.x) <= 0.02 && Math.abs(f.y - t.y) <= 0.02 && Math.abs(f.z - t.z) <= 0.02) { joins.push([a, b]); met.add(a.id + 'f'); met.add(b.id + 'a'); }
    }
    const open = [];
    for (const p of hulls) {
      const E = p.def.shull.ends || {};
      if (E.aft === 'joint' && !met.has(p.id + 'a')) open.push({ p, end: 'aft' });
      if (E.fore === 'joint' && !met.has(p.id + 'f')) open.push({ p, end: 'fore' });
    }
    v.sh = {
      rings, comps, hulls, joins, open, thrust, foils, rudders, engines, decks,
      tel: was ? was.tel : 0, rud: was ? was.rud : 0, hold: was ? was.hold : null, dcPri: was ? was.dcPri : 'auto', ciwsOn: was ? was.ciwsOn : true,
      fsub: was ? was.fsub : 0, B: was ? was.B : 0, Lwl: was ? was.Lwl : 0, Swet: was ? was.Swet : 0, draft: was ? was.draft : 0,
      level: was ? was.level : 0, depth: was ? was.depth : Infinity, fade: was ? was.fade : 0, moorT: 0, lodT: 0,
    };
    return v.sh;
  }
  // The helm and the engines' demand, before applyEngines (vessel.js physicsStep, v.hydro): the telegraph and rudder
  // from the kind's inputs, the heading hold, ride control; v.throttle for air engines on a ship. [WP1]
  function pre(v, dt, sim) {}
  // The water's force and torque on the hull this step, into v.hF and v.hT (part axes), and v.sh.fsub: buoyancy ring by
  // ring, resistance, lateral and planing forces, foils, thrust, flood water's weight. vb, wb: the water-relative velocity
  // and spin in part axes. [WP1]
  function forces(v, dt, vb, wb, sim) {}
  // the step's acceleration with the added mass (§4.7), into out (default: unchanged) [WP1]
  function addedMass(v, ax, ay, az, gk, out) { out = out || v3(); out.x = ax; out.y = ay; out.z = az; return out; }
  // What a hydro vessel's probes meet (vessel.js ground): a carrier's deck, else the ground and the sea bed. Default: the
  // old surface (Terrain's), so the gate changes nothing until the core fills it. [WP1]
  function floorAt(b, a, z, alt) { return Terrain.surfaceAt(b, a, z); }
  function floorNormal(b, a, z, o) { return Terrain.normalAt(b, a, z, o); }
  function overWater(v) { return false; } // is she over water deep enough to float? [WP1]
  function launch(v, place) { return false; } // set her afloat at her marks at the launch spot (Flight.start) [WP1]
  function seaPlace(v, e, z, yaw) { return { e, z, yaw }; } // a launch spot moved out to deep enough water [WP1]
  function drift(v, h, F) {} // a moored ship's pose on the waves, no physics (flight.js physicsTick) [WP1]
  function stab(v) { return null; } // her metacentric height now (m), null: unknown [WP1]
  // a grounding's broken parts (Death.impact): hull parts holed and kept; the rest go on breaking. Default: all of them [WP1]
  function impactSea(v, parts, sim) { return parts; }
  function bump(F) {} // ship against ship, carrier hulls and gear vessels (once a physics tick) [WP6]

  // ==== waves ====
  // The sea: one deterministic function of (east, north, time), four directional sines (SHIP.WAVES × the sea state), faded
  // in shallow water. Every caller copies the shared out array. [WP1]
  const W3 = [0, 0, 0];
  function wave(e, n, t, out) { out = out || W3; out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  function seaT(F) { return (F && Number.isFinite(F.time) ? F.time : 0) + S.seaOff; } // the sea's clock
  function setSea(state) { if (SHIP.SEAS.includes(state)) S.sea = state; return S.sea; }
  function sea() { return S.sea; }
  function fadeAt(depth) { return 0; } // the waves' share in water this deep (0..1) [WP1]
  // the shader's uniforms for a patch at (P0e, P0n), time t: per component vec4(dir, k, amplitude) and vec2(ω, phase) [WP1, WP2]
  function waveUniforms(P0e, P0n, t, out) { return out || new Float32Array(SHIP.WAVES.length * 6); }

  // ==== builder ====
  // (pure: no DOM, so the tests run them headless) [WP4, WP7]
  const STATS0 = Object.freeze({ hull: false, mass: 0, disp: 0, draft: 0, freeboard: 0, trim: 0, heel: 0, GM: 0, KB: 0, BM: 0, KG: 0, top: 0, turn: 0, comps: 0, open: 0, sinks: false, thrust: false, rudder: false });
  function stats(parts) { return { ...STATS0 }; } // displacement, draught, freeboard, GM, top speed (m/s), turning, compartments
  function hydrostatics(parts) { return { mass: 0, cg: { x: 0, y: 0, z: 0 }, vol: 0, draft: 0, trim: 0, heel: 0, wl: 0, GM: 0 }; } // the still-water float
  function spotOf(type, parts, at) { return null; } // where a tapped part goes on a ship ({ x, y, z, rot, att } | { why } | null: today's rules)
  function warnings(ps, st, warn) {} // pushes the ship's warnings onto warn
  function specs(def) { return []; } // a ship part's card lines
  function line(def) { return null; } // a ship part's tray line (null: the gv one)

  // ==== damage ====
  // [WP8]
  function hullRay(p, A, B, H) { return false; } // where the segment A -> B (the part's own frame) meets a hull part (H: as armour.js's prism)
  function hullMm(p, edge, u) { return 0; } // a hull face's thickness (edge: the hull face codes -6 deck, -7 side, -8 bottom, -9 open)
  function hullDist(v, p, at) { return Infinity; } // a blast's distance to a hull part (0 inside)
  function addHoles(v, holes) {} // [[p, x, y, a], …] from a hit
  function floodStep(v, dt, sim) {}
  function fireStep(v, dt, sim) {}
  function dcStep(v, dt, sim) {}
  function fateStep(v, dt, sim) {}
  function doom(v, sim, why, by) {} // why: 'sunk' | 'capsized' | 'magazine' | 'action'
  function magazine(v, sim, part) { return false; } // a magazine going up aboard a hydro vessel (true: handled)

  // ==== combat ====
  // [WP9]
  function fireTorp(v, p, F) { return false; }
  function torpStep(s, h, F) { return false; } // a torpedo shot's step (true: it is gone)
  function torpHit(s, a, F) { return false; } // the old air torpedo against hydro vessels (true: it hit)
  function ciwsStep(F, dt) {}
  function shotMissiles(s, a, e, F) { return false; } // a CIWS round's segment against missiles (true: one killed)
  function surface(v, F) { return NONE; } // the surface contacts v's sea radars may see
  function seesSea(a, b) { return true; } // a clear look over water from a to b (the horizon, land in the way)
  function rcs(v) { return 1; } // her radar size (× a radar's reach)

  // ---- the frame (Combat.frame, when Combat.S.sea): collisions, flooding, fires, damage control, fate, mooring, the AI,
  // the Naval Range [WP1's loop; the others add their calls]
  function frame(F, dt) {}
  // Spray, funnel smoke and the screws' wash (Flight.emitParticles, for a hydro vessel; render3d draws the swell and the
  // wakes) [WP2]. Bow spray: white spray thrown out both sides of the stem where it meets the water, SPRAY.k a second for
  // each m/s over SPRAY.v0 (at most SPRAY.max), half again and more as the bow slams down into a sea, none with the bow out
  // of the water (a boat on the plane throws hers further aft, at her chines: from the forward third of her waterline);
  // funnel smoke from funnel parts (grey for diesels, faint for turbines, more as the engines are pushed); a burst of white
  // water at the stern when the telegraph is rung. Within SPRAY.near of the view's craft, half on Low; FX's own caps.
  const FXW = { v: null }, FXP = { x: 0, y: 0, z: 0 };
  function fxShape(v) {
    const sh = v.sh;
    if (sh._fx && sh._fx.n === v.parts.length) return sh._fx;
    const Fd = v.pilot && v.pilot.F ? v.pilot.F : { x: 1, y: 0, z: 0 };
    let bow = null, bf = -Infinity, stern = null, sf = Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of sh.hulls) {
      const H = shullOf(p.def), d = p.def, x = H.x1 - 0.12 * (H.x1 - H.x0), q = partPt(p, x, H.wl), f = q.x * Fd.x + q.y * Fd.y;
      if (f > bf) { bf = f; bow = { x: q.x, y: q.y, z: partZ(p), p }; }
      const s = partPt(p, H.x0, H.wl), g = s.x * Fd.x + s.y * Fd.y;
      if (g < sf) { sf = g; stern = { x: s.x, y: s.y, z: partZ(p) }; }
      for (const R of H.rings) { z0 = Math.min(z0, partZ(p) - R.bw); z1 = Math.max(z1, partZ(p) + R.bw); }
    }
    const funnels = v.parts.filter((p) => p.def.funnel || p.def.style === 'funnel'), eng = sh.engines[0];
    return (sh._fx = { n: v.parts.length, bow, stern, beam: Number.isFinite(z1 - z0) ? z1 - z0 : 2, funnels, fuel: eng && eng.def.engine ? eng.def.engine.fuel : 'diesel', tel: sh.tel, spray: 0, smoke: 0 });
  }
  function fx(v, dt, F) {
    const sh = v.sh;
    if (!sh || !sh.hulls || !sh.hulls.length || !(dt > 0) || typeof FX === 'undefined' || v.dead || !v.body || !v.body.radius) return;
    const f = F && (F.viewVessel || F.active);
    if (!f || f.body !== v.body || Math.hypot(v.x - f.x, v.y - f.y, v.z - f.z) > SHIP.SPRAY.near) return;
    const X = fxShape(v), b = v.body, R = b.radius, r0 = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r0, uy = v.y / r0, uz = v.z / r0, q = FX.q();
    const V = v.speed(), wet = sh.fsub > 0.02 || v.splashed, k = clamp(X.beam / 7, 0.3, 3); // (k: spray to her size)
    // the screws' wash when the telegraph is rung
    if (X.tel !== sh.tel) {
      X.tel = sh.tel;
      if (wet) for (const p of sh.thrust) {
        const w = v.toWorld(p.x, p.y, partZ(p)), r = Math.hypot(w.x, w.y, w.z) || 1, s = (R + (sh.level || 0)) / r;
        FXP.x = w.x * s; FXP.y = w.y * s; FXP.z = w.z * s;
        FX.puff(b, FXP, { x: v.vx, y: v.vy, z: v.vz }, Math.ceil(6 * q), '#f2f7fb');
      }
    }
    // bow spray
    if (wet && X.bow && V > SHIP.SPRAY.v0) {
      const B = X.bow, w = v.toWorld(B.x, B.y, B.z), rw = Math.hypot(w.x, w.y, w.z) || 1, lift = rw - R - (sh.level || 0);
      let eta = 0;
      if (b === EARTH) { const L = Terrain.locate(b, w.x, w.y, w.z, FXW), o = wave(-wrapAngle(L.a - EARTH.padAngle) * R, -L.z, seaT(F)); eta = o[0] * (sh.fade == null ? 1 : sh.fade); }
      if (Math.abs(lift - eta) < 1.5 * k) {
        const av = v.av || { x: 0, y: 0, z: 0 }, dx = w.x - v.x, dy = w.y - v.y, dz = w.z - v.z;
        const uyv = (v.vx + av.y * dz - av.z * dy) * ux + (v.vy + av.z * dx - av.x * dz) * uy + (v.vz + av.x * dy - av.y * dx) * uz; // (the bow's speed up and down)
        const slam = clamp(-uyv * 0.5, 0, 2), rate = Math.min(15, clamp((V - SHIP.SPRAY.v0) * SHIP.SPRAY.k, 0, SHIP.SPRAY.max) * (0.6 + slam)) * q; // (a pair each: at most 30 a second)
        X.spray += rate * dt;
        const side = v.axis(0, 0, 1), fw = v.axis(v.pilot.F.x, v.pilot.F.y, v.pilot.F.z);
        while (X.spray >= 1) {
          X.spray -= 1;
          for (const sg of [-1, 1]) {
          const s = (2 + Math.random() * 4) * Math.min(1.5, V / 12), up = 2 + Math.random() * 3 + slam * 2;
          const hw = X.beam * 0.18;
          FX.add({ kind: 'smoke', b, x: w.x + side.x * sg * hw, y: w.y + side.y * sg * hw, z: w.z + side.z * sg * hw,
            vx: v.vx * 0.7 + side.x * sg * s + ux * up - fw.x * 1.5, vy: v.vy * 0.7 + side.y * sg * s + uy * up - fw.y * 1.5, vz: v.vz * 0.7 + side.z * sg * s + uz * up - fw.z * 1.5,
            max: 0.8 + Math.random() * 0.7, size: 0.4 * k, grow: 2 * k, color: '#eef5fb', alpha: 0.5, heavy: true });
          }
        }
      } else X.spray = 0;
    }
    // funnel smoke
    if (X.funnels.length) {
      const dem = Math.abs(SHIP.TEL[clamp((sh.tel | 0) + 3, 0, SHIP.TEL.length - 1)] || 0), turb = X.fuel === 'turbine';
      X.smoke += (2 + 6 * dem) * q * X.funnels.length * dt;
      while (X.smoke >= 1) {
        X.smoke -= 1;
        const p = X.funnels[(X.fi = ((X.fi || 0) + 1) % X.funnels.length)], t = partPt(p, 0, p.def.h / 2), w = v.toWorld(t.x, t.y, partZ(p)), up = 3 + 4 * dem, j = 0.6;
        FX.add({ kind: 'smoke', b, x: w.x, y: w.y, z: w.z, vx: v.vx * 0.9 + ux * up + (Math.random() - 0.5) * j, vy: v.vy * 0.9 + uy * up + (Math.random() - 0.5) * j, vz: v.vz * 0.9 + uz * up + (Math.random() - 0.5) * j,
          max: 2.5 + Math.random() * 2, size: Math.max(0.6, p.def.w * 0.5), grow: Math.max(2, p.def.w * 2.2), color: turb ? '#b9bdc2' : '#55595e', alpha: turb ? 0.14 : 0.32 + 0.2 * dem });
      }
    }
  }

  // ==== hud ====
  // [WP3, WP12]
  function hud(F) {}
  function help(F) { return ''; } // the ship's controls, from the bindings
  function keys(F, e, down) { return false; } // a key for the ship (true: taken)

  // ==== ai ====
  // [WP10]
  function aiDown(v, F) {}
  function flyStriker(v, F, dt) {}
  function range(F) {} // the Naval Range
  function practice(opts) {} // the Naval Practice battle

  // ==== mp ====
  // [WP11]
  function snap(v) { return null; } // a ship's snapshot field (sh: [tel, rudder°])
  function unsnap(g, m) {}
  function ghost(g) {} // a remote ship ghost: its decks into Ship.D
  function downSea(v) { return null; } // a ship's down message's sea field
  function onDownSea(m) {}
  function cleanHoles(rows, v) { return []; } // a peer's hit.ho rows, cleaned (our own hull parts, finite, capped)

  return {
    D: [], // every landable moving deck: { v, p, hl, hw, top } [WP6]
    S,
    // core
    groups, pre, forces, addedMass, floorAt, floorNormal, overWater, launch, seaPlace, drift, stab, impactSea, bump,
    // waves
    wave, seaT, setSea, sea, fadeAt, waveUniforms,
    // builder
    stats, hydrostatics, spotOf, warnings, specs, line,
    // damage
    hullRay, hullMm, hullDist, addHoles, floodStep, fireStep, dcStep, fateStep, doom, magazine,
    // combat
    fireTorp, torpStep, torpHit, ciwsStep, shotMissiles, surface, seesSea, rcs,
    // frame
    frame, fx,
    // hud
    hud, help, keys,
    // ai
    aiDown, flyStriker, range, practice, battle: null,
    // mp
    snap, unsnap, ghost, downSea, onDownSea, cleanHoles,
  };
})();
