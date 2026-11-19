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
  // ---- the builder (§11.3) [WP4]: the still-water float, top speed, tap placement and the warnings
  BUILD: { tol: 2e-4, iters: 8, dA: 0.003, dGM: 0.02, gmLow: 0.3, heel: 2, trim: 1, free: 0.25, capsize: 60,
           vMax: 40, vStep: 0.25, turn: [4.5, 0.25, 1.2, 10], steerA: 1.5, inM: 0.03, step: 0.25, pair: 0.4, wash: 0.05, dry: 0.5 },
  //   (the float found to tol m of CB under CG in at most iters Newton steps, dA rad apart for the slopes; GM from ±dGM rad of
  //   heel; warnings: GM under gmLow m, a list past heel°, a trim past trim°, the deck within free m of the water, capsized past
  //   capsize°; top speed searched to vMax m/s in vStep steps; turning ≈ turn[0]·L·(turn[1] + turn[2]·A_lat/(A_rudder·turn[3]))
  //   with steerA m² of rudder for each steering thruster; tap placement: inM m inside the skin, candidates every step m, a
  //   pair of screws pair × the hull's half-beam apart, a rudder wash m behind its screw; a screw or rudder under dry of its
  //   depth in water is out of it)
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
  // The still-water float of a design (§11.3), worked out the way the sea floats her: her weight and centre of gravity as
  // Vessel.recompute has them (partKg at each part's middle; a pair's mass on the centre line), and her hull as the very
  // physics rings ship.js floats her on (each hull part's shullOf phys rings, turned into part space as Ship.groups turns
  // them), each clipped by a flat sea (one Sutherland-Hodgman pass on the ring's own polygon) and weighted by its trapezoid
  // share dx. The sea is the plane n·X = c in part space, n the world's up seen from the hull: n = normalize(−tan θ, 1,
  // −tan φ), θ the trim (bow down +), φ the heel (starboard down +); a point is under water where n·X − c < 0, that much
  // deep. For each (θ, φ) the level c floats her weight (regula falsi on the displaced volume, which only grows with c);
  // Newton on (θ, φ) puts the centre of buoyancy under the centre of gravity. GM is the righting arm's slope there (±dGM of
  // heel), so it is the physics' own stability, rings and all, not a formula's.
  const B0 = () => SHIP.BUILD;
  const gSea = () => (typeof EARTH !== 'undefined' && EARTH.surfaceG) || G0;
  const STATS0 = Object.freeze({ hull: false, mass: 0, disp: 0, draft: 0, freeboard: 0, trim: 0, heel: 0, GM: 0, KB: 0, BM: 0, KG: 0, top: 0, turn: 0, comps: 0, open: 0, sinks: false, thrust: false, rudder: false });
  // a design's mass, centre of gravity and hull rings, in part space
  function model(parts) {
    let m = 0, cx = 0, cy = 0, cz = 0;
    for (const p of parts) { const k = partKg(p); m += k; cx += k * p.x; cy += k * p.y; cz += k * partZc(p); }
    const M = { mass: m, cg: m > 0 ? { x: cx / m, y: cy / m, z: cz / m } : { x: 0, y: 0, z: 0 }, rings: [], hulls: [], vol: 0, keel: Infinity, x0: Infinity, x1: -Infinity, hb: 0 };
    const DE = SHULL_NK + 2; // (a ring's deck edges: points DE (port) and K − DE (starboard))
    for (const p of parts) {
      const d = p.def;
      if (!d.shull) continue;
      M.hulls.push(p);
      const H = shullOf(d), S = d.shull, z0 = partZ(p), o = partPt(p, 0, 0), ay = partPt(p, 0, 1), ax = partPt(p, 1, 0);
      const eyx = ay.x - o.x, eyy = ay.y - o.y, exx = ax.x - o.x, exy = ax.y - o.y;
      for (const R of H.phys) {
        const K = R.K, X = new Float64Array(3 * K), c = partPt(p, R.x, 0);
        let per = 0;
        for (let i = 0; i < K; i++) {
          const ly = R.P[2 * i], lz = R.P[2 * i + 1];
          X[3 * i] = c.x + ly * eyx; X[3 * i + 1] = c.y + ly * eyy; X[3 * i + 2] = z0 + lz;
          const j = (i + 1) % K; per += Math.hypot(R.P[2 * j] - ly, R.P[2 * j + 1] - lz);
          M.keel = Math.min(M.keel, X[3 * i + 1]); M.x0 = Math.min(M.x0, X[3 * i]); M.x1 = Math.max(M.x1, X[3 * i]);
        }
        // the keel's slope along the hull here (bow up +: a planing bottom meets the water at it), and the deadrise
        const h = 0.25, xa = Math.max(H.x0, R.x - h), xb = Math.min(H.x1, R.x + h), s = xb > xa ? (shullSec(S.st, xb)[1] - shullSec(S.st, xa)[1]) / (xb - xa) : 0;
        const kx = exx + s * eyx, ky = exy + s * eyy;
        M.rings.push({ p, X, L: R.P, K, dx: R.dx, A: R.A, per, cx: c.x, cy: c.y, z0, eyx, eyy, fy: R.cy, de: DE,
          k: S.k || 0, plane: !!S.plane, tau: Math.abs(kx) > 1e-6 ? Math.atan(ky / kx) : 0,
          beta: R.yk < H.wl ? Math.atan((H.wl - R.yk) / (Math.max(R.bw, 0.01) * Math.max(1, R.nb))) : 0 });
        M.vol += R.A * R.dx;
        M.hb = Math.max(M.hb, R.bd);
      }
    }
    return M;
  }
  // one ring under the sea n·X = c: its immersed area a, the area's centroid (part space), the waterline chord b, the
  // wetted girth g (the polygon's edges under water), the depth of its deepest point k and its deck edges' height
  const DS = new Float64Array(64), PS = new Float64Array(140), CUT = new Float64Array(4);
  function clipRing(r, n, c, o) {
    const K = r.K, X = r.X, L = r.L;
    let dmin = Infinity, dmax = -Infinity;
    for (let i = 0; i < K; i++) { const d = n.x * X[3 * i] + n.y * X[3 * i + 1] + n.z * X[3 * i + 2] - c; DS[i] = d; if (d < dmin) dmin = d; if (d > dmax) dmax = d; }
    o.k = Math.max(0, -dmin); o.deck = Math.min(DS[r.de], DS[K - r.de]);
    o.a = 0; o.b = 0; o.g = 0; o.x = r.cx + r.fy * r.eyx; o.y = r.cy + r.fy * r.eyy; o.z = r.z0;
    if (dmin >= 0) return o;
    if (dmax <= 0) { o.a = r.A; o.g = r.per; return o; }
    let m = 0, nc = 0, g = 0;
    for (let i = 0; i < K; i++) {
      const j = (i + 1) % K, di = DS[i], dj = DS[j], ii = di < 0, ij = dj < 0;
      const ay = L[2 * i], az = L[2 * i + 1], by = L[2 * j], bz = L[2 * j + 1], e = Math.hypot(by - ay, bz - az);
      if (ii) { PS[m++] = ay; PS[m++] = az; }
      if (ii && ij) g += e;
      else if (ii !== ij) {
        const t = di / (di - dj), qy = ay + (by - ay) * t, qz = az + (bz - az) * t;
        PS[m++] = qy; PS[m++] = qz;
        if (nc < 2) { CUT[2 * nc] = qy; CUT[2 * nc + 1] = qz; nc++; }
        g += ii ? e * t : e * (1 - t);
      }
    }
    let A = 0, my = 0, mz = 0;
    for (let i = 0, q = m / 2; i < q; i++) {
      const j = (i + 1) % q, y0 = PS[2 * i], z0 = PS[2 * i + 1], y1 = PS[2 * j], z1 = PS[2 * j + 1], cr = y0 * z1 - y1 * z0;
      A += cr / 2; my += ((y0 + y1) * cr) / 6; mz += ((z0 + z1) * cr) / 6;
    }
    if (!(Math.abs(A) > 1e-12)) return o;
    const ly = my / A, lz = mz / A;
    o.a = Math.abs(A); o.g = g; o.b = nc === 2 ? Math.hypot(CUT[2] - CUT[0], CUT[3] - CUT[1]) : 0;
    o.x = r.cx + ly * r.eyx; o.y = r.cy + ly * r.eyy; o.z = r.z0 + lz;
    return o;
  }
  // the whole hull under the sea n·X = c: the displaced volume and its centroid (CB); keep: the rings' own answers too
  const RO = { a: 0, b: 0, g: 0, k: 0, deck: 0, x: 0, y: 0, z: 0 };
  function immerse(M, n, c, keep) {
    let V = 0, bx = 0, by = 0, bz = 0;
    const out = keep ? [] : null;
    for (const r of M.rings) {
      const o = clipRing(r, n, c, keep ? {} : RO), v = o.a * r.dx;
      V += v; bx += v * o.x; by += v * o.y; bz += v * o.z;
      if (keep) out.push(o);
    }
    return { V, x: V > 0 ? bx / V : 0, y: V > 0 ? by / V : 0, z: V > 0 ? bz / V : 0, rings: out };
  }
  const upOf = (th, ph) => { const x = -Math.tan(th), z = -Math.tan(ph), l = Math.hypot(x, 1, z); return { x: x / l, y: 1 / l, z: z / l }; };
  // the level c at which the sea under n holds volume Vt (regula falsi, Illinois; from a bracket round hint when there is
  // one, the last float's level), or the top of the hull if it can't
  function levelFor(M, n, Vt, hint) {
    let lo = Infinity, hi = -Infinity;
    for (const r of M.rings) for (let i = 0; i < r.K; i++) { const d = n.x * r.X[3 * i] + n.y * r.X[3 * i + 1] + n.z * r.X[3 * i + 2]; if (d < lo) lo = d; if (d > hi) hi = d; }
    if (!(hi > lo)) return lo;
    const V = (c) => immerse(M, n, c).V - Vt;
    let fa = -Vt, fb = V(hi), a = lo, b = hi, side = 0;
    if (fb <= 0) return hi;
    if (Number.isFinite(hint) && hint > lo && hint < hi) { // (narrow the bracket round the hint first: a few looks, not the whole hull's)
      for (let s = 0.02 * (hi - lo); ; s *= 4) {
        const a1 = Math.max(lo, hint - s), b1 = Math.min(hi, hint + s), fa1 = a1 > lo ? V(a1) : -Vt, fb1 = b1 < hi ? V(b1) : fb;
        if (fa1 <= 0 && fb1 >= 0) { a = a1; fa = fa1; b = b1; fb = fb1; break; }
        if (a1 <= lo && b1 >= hi) break;
      }
      if (fa === 0) return a;
    }
    for (let it = 0; it < 60; it++) {
      const c = (a * fb - b * fa) / (fb - fa), f = V(c);
      if (Math.abs(f) <= Vt * 1e-7 || b - a < 1e-6) return c;
      if (f * fb > 0) { b = c; fb = f; if (side === -1) fa /= 2; side = -1; }
      else { a = c; fa = f; if (side === 1) fb /= 2; side = 1; }
    }
    return (a + b) / 2;
  }
  // CB − CG along the sea's two horizontals at (θ, φ): fore-aft (+: CB ahead) and across (+: CB to starboard)
  function resid(M, th, ph, Vt, hint) {
    const n = upOf(th, ph), c = levelFor(M, n, Vt, hint), B = immerse(M, n, c), G = M.cg;
    const dx = B.x - G.x, dy = B.y - G.y, dz = B.z - G.z;
    const e1 = [1 - n.x * n.x, -n.x * n.y, -n.x * n.z], e2 = [-n.z * n.x, -n.z * n.y, 1 - n.z * n.z];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    return { n, c, f1: (dx * e1[0] + dy * e1[1] + dz * e1[2]) / l1, f2: (dx * e2[0] + dy * e2[1] + dz * e2[2]) / l2 };
  }
  // The still-water float: { hull, mass (kg), cg, vol (m³ displaced), cap (kg the closed hull floats), sinks, up (the
  // world's up in part axes at rest), c (n·X − c is a point's height above the sea), plane: the waterline in part space,
  // y = a + bx·x + bz·z, wl (its height at the centre of gravity); trim, heel (rad: bow down +, starboard down +), draft
  // (m: the deepest hull point), freeboard (the lowest deck edge above the water), GM, GML, KB, KG, BM (m; K the lowest
  // hull point), cb, rings (each phys ring's immersion: a, b, g, k, deck), Lwl, Swet, SwetK (Σ girth·dx·(1 + k)), T (the
  // mean draught), x0, x1, hb (the hull's length and half-beam), keel, capsize (no float within BUILD.capsize° of heel) }.
  // Flight.start's launch puts her on the sea this way (Ship.launch).
  function hydrostatics(parts, M = model(parts)) {
    const BD = B0(), rho = SHIP.RHO;
    const H = { hull: M.rings.length > 0, mass: M.mass, cg: M.cg, vol: 0, cap: M.vol * rho, sinks: false, up: { x: 0, y: 1, z: 0 }, c: 0,
      plane: { a: 0, bx: 0, bz: 0 }, wl: 0, trim: 0, heel: 0, draft: 0, freeboard: 0, GM: 0, GML: 0, KB: 0, KG: 0, BM: 0, cb: { ...M.cg },
      rings: [], Lwl: 0, Swet: 0, SwetK: 0, T: 0, x0: M.x0, x1: M.x1, hb: M.hb, keel: M.keel, capsize: false };
    if (!H.hull || !(M.mass > 0)) return H;
    const Vt = M.mass / rho;
    let th = 0, ph = 0, R = null;
    if (Vt >= M.vol) H.sinks = true;
    else {
      R = resid(M, th, ph, Vt);
      for (let it = 0; it < BD.iters && Math.max(Math.abs(R.f1), Math.abs(R.f2)) > BD.tol; it++) {
        const h = BD.dA, A = resid(M, th + h, ph, Vt, R.c), B = resid(M, th, ph + h, Vt, R.c);
        const j11 = (A.f1 - R.f1) / h, j12 = (B.f1 - R.f1) / h, j21 = (A.f2 - R.f2) / h, j22 = (B.f2 - R.f2) / h, det = j11 * j22 - j12 * j21;
        let dt, dp;
        if (Math.abs(det) > 1e-9) { dt = -(j22 * R.f1 - j12 * R.f2) / det; dp = -(-j21 * R.f1 + j11 * R.f2) / det; }
        else { dt = j11 ? -R.f1 / j11 : 0; dp = j22 ? -R.f2 / j22 : 0; }
        th = clamp(th + clamp(dt, -0.1, 0.1), -0.6, 0.6); ph = clamp(ph + clamp(dp, -0.25, 0.25), -1.3, 1.3);
        R = resid(M, th, ph, Vt, R.c);
      }
      if (Math.abs(ph) * (180 / Math.PI) > BD.capsize) H.capsize = true;
    }
    const n = R ? R.n : upOf(0, 0), c = R ? R.c : levelFor(M, n, Infinity), I = immerse(M, n, c, true);
    H.up = n; H.c = c; H.trim = th; H.heel = ph; H.vol = I.V; H.cb = { x: I.x, y: I.y, z: I.z }; H.rings = I.rings;
    H.plane = { a: c / n.y, bx: -n.x / n.y, bz: -n.z / n.y }; H.wl = H.plane.a + H.plane.bx * M.cg.x + H.plane.bz * M.cg.z;
    let lo = Infinity, hi = -Infinity, kk = 0, nk = 0;
    H.freeboard = Infinity;
    I.rings.forEach((o, i) => {
      const r = M.rings[i];
      H.draft = Math.max(H.draft, o.k); H.freeboard = Math.min(H.freeboard, o.deck);
      H.Swet += o.g * r.dx; H.SwetK += o.g * r.dx * (1 + r.k);
      if (o.b > 0) { lo = Math.min(lo, r.cx); hi = Math.max(hi, r.cx); }
      if (o.a > 0) { kk += o.k; nk++; }
    });
    H.Lwl = hi > lo ? hi - lo : 0; H.T = nk ? kk / nk : 0;
    if (!Number.isFinite(H.freeboard)) H.freeboard = 0;
    if (R) { // the righting arms' slopes either side of the float: GM (heel), GML (trim)
      const d = BD.dGM, P = resid(M, th, ph + d, Vt, c), Q = resid(M, th, ph - d, Vt, c), U = resid(M, th + d, ph, Vt, c), W = resid(M, th - d, ph, Vt, c);
      H.GM = (P.f2 - Q.f2) / (2 * Math.sin(d)); H.GML = (U.f1 - W.f1) / (2 * Math.sin(d));
    }
    H.KB = H.cb.y - M.keel; H.KG = M.cg.y - M.keel; H.BM = H.GM - H.KB + H.KG;
    return H;
  }
  // The water's resistance at V m/s (§4.3: ITTC-57 friction on the wetted hull with its form factors, and wave-making on
  // the weight the water still carries once the strip planing lift has taken its share), at the still-water float; fA: the
  // foils' area in the water (rudders, hydrofoils: their profile drag, §4.4's cd0, straight ahead)
  function cwr(Fn) {
    const X = SHIP.CWR_FN, Y = SHIP.CWR;
    if (Fn >= X[X.length - 1]) return Y[Y.length - 1];
    for (let i = 1; i < X.length; i++) if (Fn <= X[i]) return Y[i - 1] + ((Y[i] - Y[i - 1]) * (Fn - X[i - 1])) / (X[i] - X[i - 1]);
    return 0;
  }
  function resistance(M, H, V, fA = 0) {
    if (!(V > 0) || !(H.Lwl > 0)) return 0;
    const rho = SHIP.RHO, g = gSea(), L = H.Lwl, Re = (V * L) / SHIP.NU;
    const Cf = Re < SHIP.CF_RE ? SHIP.CF_LOW : 0.075 / Math.pow(Math.log10(Re) - 2, 2), Rf = 0.5 * rho * V * V * H.SwetK * Cf;
    let lift = 0;
    H.rings.forEach((o, i) => {
      const r = M.rings[i], tau = r.tau - H.trim;
      if (o.b > 0 && tau > 0) lift += 0.5 * rho * (r.plane ? SHIP.planeK : SHIP.dispK) * V * Math.sin(tau) * V * o.b * r.dx * Math.cos(r.beta) ** 2 * Math.min(1, o.k / SHIP.planeFade);
    });
    const W = H.mass * g;
    return Rf + Math.max(0, W - lift) * cwr(V / Math.sqrt(g * L)) + 0.5 * rho * V * V * fA * SHIP.FOIL.cd0;
  }
  // what pushes her (§4.5): the engines' shaft power shared by the screws and waterjets (an outboard turns its own), each
  // as deep in the still water as it sits, along its own +x; air engines as ever. thrustAt: the push at V m/s, full ahead
  function propulsion(parts, H) {
    const n = H.up, c = H.c, out = { kw: 0, list: [], air: 0, need: 0 };
    for (const p of parts) if (p.def.engine && !p.def.screw && !p.def.jet) out.kw += p.def.engine.kw;
    const shared = parts.filter((p) => (p.def.screw || p.def.jet) && !p.def.engine);
    for (const p of parts) {
      const d = p.def;
      if (d.thrust && !(d.air && d.air.kind === 'rotor')) out.air += d.thrust * 1000 * partAxis(p).x;
      if (!d.screw && !d.jet) continue;
      const D = (d.screw || d.jet).D, o = partPt(p, 0, 0), e = partPt(p, 1, 0), copies = partZs(p);
      let sub = 0;
      for (const z of copies) sub += smoothstep(0, SHIP.SCREW.sub * D, -(n.x * o.x + n.y * o.y + n.z * z - c));
      const P = (d.engine ? d.engine.kw * 1000 : shared.length ? (out.kw * 1000) / shared.length : 0) * copies.length;
      out.list.push({ p, D, jet: !!d.jet, eta: d.screw ? d.screw.eta || 0.6 : 0, P, sub: sub / copies.length, dir: e.x - o.x, n: copies.length });
      if (!d.engine) out.need++;
    }
    return out;
  }
  function thrustAt(Pr, V) {
    let T = Pr.air;
    for (const t of Pr.list) {
      if (!(t.P > 0) || !(t.sub > 0)) continue;
      const P = t.P / t.n, A = (Math.PI * t.D * t.D) / 4, T0 = SHIP.SCREW.k0 * Math.cbrt(2 * SHIP.RHO * A * P * P), J = SHIP.JET;
      const one = t.jet ? Math.min(J.t0 * T0, ((J.eta0 + J.eta1 * smoothstep(J.v0, J.v1, V)) * P) / Math.max(V, SHIP.SCREW.vmin))
        : Math.min(T0, (t.eta * P) / Math.max(SHIP.SCREW.va * V, SHIP.SCREW.vmin));
      T += one * t.n * t.sub * t.dir;
    }
    return T;
  }
  // the speed she reaches from rest at full power: the first at which the push no longer beats the water (m/s)
  function topSpeed(M, H, Pr, fA) {
    const BD = B0(), f = (V) => thrustAt(Pr, V) - resistance(M, H, V, fA);
    if (!(f(BD.vStep) > 0)) return 0;
    let a = BD.vStep, b = 0;
    for (let V = 2 * BD.vStep; V <= BD.vMax + 1e-9; V += BD.vStep) { if (f(V) <= 0) { b = V; break; } a = V; }
    if (!b) return BD.vMax;
    for (let i = 0; i < 14; i++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
    return (a + b) / 2;
  }
  // the hull segments' ends: which meet another of their class section to section (as Ship.groups joins them, within 2
  // cm in x, y and z: segments that meet touch, so they are adjacent too), each end's kind, fore and aft in part space
  const CLS = ['S', 'M', 'L', 'X'];
  function hullEnds(parts) {
    const E = [];
    for (const p of parts) {
      if (!p.def.shull) continue;
      const H = shullOf(p.def), a = H.rings[0], f = H.rings[H.nr - 1], A = partPt(p, a.x, a.yk), F = partPt(p, f.x, f.yk), en = p.def.shull.ends || {};
      const rev = A.x > F.x; // (a segment turned end for end: its fore end is aft)
      E.push({ p, cls: p.def.shull.cls, z: partZ(p), aft: rev ? F : A, fore: rev ? A : F, aftT: (rev ? en.fore : en.aft) || 'closed', foreT: (rev ? en.aft : en.fore) || 'closed', aftJ: null, foreJ: null });
    }
    const meet = (u, v) => Math.abs(u.x - v.x) <= 0.02 && Math.abs(u.y - v.y) <= 0.02;
    for (const a of E) for (const b of E) if (a !== b && a.cls === b.cls && Math.abs(a.z - b.z) <= 0.02 && meet(a.fore, b.aft)) { a.foreJ = b; b.aftJ = a; }
    return E;
  }
  // The builder's numbers (statsData.ship): the float (above, with trim and heel in degrees here), displacement (t), top
  // speed (m/s), the turning circle (m, ~), compartments, the open ends ({ p, end, at: 'bow' | 'stern' | 'gap' }), what
  // pushes and steers her (thrust, noEngine, rudder, kw) and what is out of the water (dryScrews, dryRudders)
  function stats(parts) {
    const M = model(parts), H = hydrostatics(parts, M), BD = B0(), st = { ...STATS0, ...H };
    st.mass = M.mass; st.disp = M.mass / 1000;
    st.trim = (H.trim * 180) / Math.PI; st.heel = (H.heel * 180) / Math.PI;
    const E = hullEnds(parts), open = [];
    for (const e of E) {
      if (e.aftT === 'joint' && !e.aftJ) open.push({ p: e.p, end: 'aft' });
      if (e.foreT === 'joint' && !e.foreJ) open.push({ p: e.p, end: 'fore' });
    }
    const fore = E.reduce((m, e) => (!m || e.fore.x > m.fore.x ? e : m), null), aft = E.reduce((m, e) => (!m || e.aft.x < m.aft.x ? e : m), null);
    for (const o of open) o.at = o.end === 'fore' && o.p === fore.p ? 'bow' : o.end === 'aft' && o.p === aft.p ? 'stern' : 'gap';
    st.openEnds = open; st.open = open.length;
    st.comps = E.length + parts.filter((p) => p.def.bulkhead && p.att != null && E.some((e) => e.p.id === p.att)).length;
    const Pr = propulsion(parts, H);
    st.kw = Pr.kw;
    st.thrust = Pr.list.length > 0 || Pr.air > 0;
    st.noEngine = Pr.need > 0 && !(Pr.kw > 0);
    st.dryScrews = H.hull && !H.sinks ? Pr.list.filter((t) => t.sub < BD.dry).map((t) => t.p) : [];
    const steer = parts.filter((p) => p.def.steer || (p.def.jet && p.def.jet.steer)), rud = parts.filter((p) => p.def.foil && p.def.foil.kind === 'rudder');
    st.rudder = rud.length + steer.length > 0;
    st.dryRudders = H.hull && !H.sinks ? rud.filter((p) => { const o = partPt(p, 0, 0), h = partDims(p).h; return partZs(p).every((z) => -(H.up.x * o.x + H.up.y * o.y + H.up.z * z - H.c) < (BD.dry * h) / 2); }) : [];
    const wet = (p) => partZs(p).filter((z) => { const o = partPt(p, 0, 0); return H.up.x * o.x + H.up.y * o.y + H.up.z * z - H.c < 0; }).length;
    const fA = parts.reduce((a, p) => a + (p.def.foil ? p.def.foil.area * wet(p) : 0), 0);
    st.top = H.hull && !H.sinks ? topSpeed(M, H, Pr, fA) : 0;
    const Ar = rud.reduce((s, p) => s + p.def.foil.area * partZs(p).length, 0) + BD.steerA * steer.length, T = BD.turn;
    st.turn = Ar > 0 && H.Lwl > 0 && !H.sinks ? T[0] * H.Lwl * (T[1] + (T[2] * H.Lwl * H.T) / (Ar * T[3])) : 0;
    return st;
  }

  // ---- placement: where a tapped part goes on a ship (§11.2): a pose { def, type, x, y, z, rot, host, att } (att: the
  // part it hangs on; shift: { parts, dx, dy } to move first, a midsection going in behind the bow), { why } for a toast,
  // or null (the builder's own rules). at: the view's middle in part space { x, y }, and sym (symmetry on: pairs go off
  // the centre line, the builder adds the twin). [WP4: keel, deck, inside, stern (screws, rudders); WP7 the rest]
  function spotOf(type, parts, at) {
    const def = hasOwn(PARTS, type) ? PARTS[type] : null;
    if (!def || !Array.isArray(parts)) return null;
    at = at || {};
    const BD = B0(), rot = Number.isInteger(at.rot) ? at.rot & 3 : def.aim ? 3 : 0, { w, h } = partDims({ def, rot }), dep = partDepth({ def });
    const pose = (x, y, z, host) => ({ def, type, x: +x.toFixed(3), y: +y.toFixed(3), z: cleanZ(+z.toFixed(3), def), rot, host, att: host });
    const free = (q, skip) => !parts.some((o) => !(skip && skip.has(o)) && partsClash(q, o));
    const hulls = parts.filter((p) => p.def.shull && (p.rot & 3) === 0);
    const room = { why: `No room for the ${def.name} there: drag it into place instead.` }, first = { why: `Put a hull down first (Ship hulls): the ${def.name} goes on it.` };
    // the hull's extent along x, the deck's and the keel's height there (the segments that span x)
    const span = (p) => { const H = shullOf(p.def); return [p.x + H.x0, p.x + H.x1]; };
    const over = (x) => hulls.filter((p) => { const [a, b] = span(p); return x >= a - 1e-6 && x <= b + 1e-6; });
    const deckAt = (x) => over(x).reduce((m, p) => Math.max(m, p.y + shullSec(p.def.shull.st, x - p.x)[0]), -Infinity);
    const keelAt = (x) => over(x).reduce((m, p) => Math.min(m, p.y + shullSec(p.def.shull.st, x - p.x)[1]), Infinity);
    const samples = (x0, x1) => { const n = Math.max(1, Math.ceil((x1 - x0) / 0.25)), o = []; for (let i = 0; i <= n; i++) o.push(x0 + ((x1 - x0) * i) / n); return o; };
    const near = (xt, lo, hi) => { // (lo..hi every BD.step m, the nearest xt first)
      const s = BD.step, o = [];
      if (hi < lo - 1e-9) return o;
      const c = clamp(xt, lo, hi);
      o.push(c);
      for (let k = 1; c - k * s >= lo - 1e-9 || c + k * s <= hi + 1e-9; k++) { if (c + k * s <= hi + 1e-9) o.push(c + k * s); if (c - k * s >= lo - 1e-9) o.push(c - k * s); }
      return o;
    };
    let X0 = Infinity, X1 = -Infinity;
    for (const p of hulls) { const [a, b] = span(p); X0 = Math.min(X0, a); X1 = Math.max(X1, b); }
    const xt = Number.isFinite(at.x) && at.x >= X0 && at.x <= X1 ? at.x : (X0 + X1) / 2;

    // keel: hull segments end to end, bow forward, stern aft, their keels level
    if (def.shull && def.place === 'keel') {
      const H = shullOf(def), ra = H.rings[0], rf = H.rings[H.nr - 1], en = def.shull.ends || {}, jA = en.aft === 'joint', jF = en.fore === 'joint';
      if (!parts.some((p) => p.def.shull)) return free(pose(0, 0, 0, null)) ? pose(0, 0, 0, null) : room;
      const E = hullEnds(hulls);
      if (!E.length || (!jA && !jF)) return null; // (a one-piece hull beside another one: the builder's rules)
      const F = E.reduce((m, e) => (!m || e.fore.x > m.fore.x ? e : m), null), A = E.reduce((m, e) => (!m || e.aft.x < m.aft.x ? e : m), null);
      const size = (e) => ({ why: `That ${def.name} is for a ${CLS.indexOf(def.shull.cls) > CLS.indexOf(e.cls) ? 'bigger' : 'smaller'} hull than this one.` });
      const atFore = (e) => pose(e.fore.x - ra.x, e.fore.y - ra.yk, e.z, e.p); // (its aft section on e's fore one)
      const atAft = (e) => pose(e.aft.x - rf.x, e.aft.y - rf.yk, e.z, e.p);
      const ends = [];
      if (jA && !jF) { // a bow: on the foremost segment's open front
        if (F.foreT !== 'joint') return { why: 'She has a bow already: add midsections behind it, or take it off first.' };
        if (F.cls !== def.shull.cls) return size(F);
        ends.push(atFore(F));
      } else if (jF && !jA) { // a stern: on the aftmost one's open back
        if (A.aftT !== 'joint') return { why: 'She has a stern already: add midsections ahead of it, or take it off first.' };
        if (A.cls !== def.shull.cls) return size(A);
        ends.push(atAft(A));
      } else { // a midsection: on an open front, else an open back, else in behind the bow (the bow and what is on it go forward)
        const opens = [...(F.foreT === 'joint' && !F.foreJ ? [['f', F]] : []), ...(A.aftT === 'joint' && !A.aftJ ? [['a', A]] : []),
          ...E.filter((e) => e !== F && e.foreT === 'joint' && !e.foreJ).map((e) => ['f', e]), ...E.filter((e) => e !== A && e.aftT === 'joint' && !e.aftJ).map((e) => ['a', e])];
        const fit = opens.filter(([, e]) => e.cls === def.shull.cls);
        if (!fit.length && opens.length) return size(opens[0][1]);
        for (const [s, e] of fit) ends.push(s === 'f' ? atFore(e) : atAft(e));
        if (!fit.length) {
          const bow = F.foreT !== 'joint' && F.aftJ ? F : null;
          if (!bow) return room;
          if (bow.cls !== def.shull.cls) return size(bow);
          const q = atFore(bow.aftJ), dx = q.x + rf.x - bow.aft.x, dy = q.y + rf.yk - bow.aft.y, moved = new Set([bow.p, ...attachedTo(parts, [bow.p])]);
          return free(q, moved) ? { ...q, shift: { parts: [bow.p], dx: +dx.toFixed(3), dy: +dy.toFixed(3) } } : room;
        }
      }
      for (const q of ends) if (free(q)) return q;
      return room;
    }
    // deck: on the deck line of the hull under the view's middle (or amidships), on the centre line; along it till clear
    if (def.place === 'deck') {
      if (!hulls.length) return first;
      for (const x of near(xt, X0 + w / 2, X1 - w / 2)) {
        let top = -Infinity;
        for (const s of samples(x - w / 2, x + w / 2)) { const d = deckAt(s); if (!Number.isFinite(d)) { top = NaN; break; } top = Math.max(top, d); }
        if (!Number.isFinite(top)) continue;
        const q = pose(x, top + h / 2, 0, over(x)[0]);
        if (free(q)) return q;
      }
      return room;
    }
    // inside: in the hull segment under the view's middle (else the nearest), as low as it goes, the nearest the middle at
    // that height; a pair off the centre line with symmetry on (the centre line if no pair fits), else on it
    if (def.place === 'inside') {
      if (!hulls.length) return first;
      const m = BD.inM, gap = (p) => { const [a, b] = span(p); return xt < a ? a - xt : xt > b ? xt - b : 0; };
      const order = [...hulls].sort((a, b) => gap(a) - gap(b) || Math.abs(a.x - xt) - Math.abs(b.x - xt));
      for (const H of order) {
        const S = H.def.shull, Hs = shullOf(H.def), lim = Hs.rings.reduce((s, r) => Math.max(s, r.bd), 0), pairs = [], cands = [];
        for (let z = dep / 2 + 0.01; z + dep / 2 + m <= lim + 1e-9; z += BD.step) pairs.push(z);
        const zs = at.sym ? [...pairs.map((z) => [z, 0]), [0, 1]] : [[0, 0], ...pairs.flatMap((z) => [[z, 1], [-z, 1]])];
        const secsAt = (x) => samples(x - w / 2, x + w / 2).map((s) => shullPoly(shullSec(S.st, s - H.x), S.wl));
        for (const x of near(xt, H.x + Hs.x0 + w / 2 + m, H.x + Hs.x1 - w / 2 - m)) {
          const secs = secsAt(x);
          for (const [z, tier] of zs) {
            const y0 = lowIn(secs, Math.abs(z) + dep / 2 + m, h, m);
            if (y0 != null) cands.push({ x, z, y0, secs, s: tier * 1000 + y0 + 0.08 * Math.abs(x - xt) + 0.01 * Math.abs(z) });
          }
        }
        cands.sort((a, b) => a.s - b.s);
        for (const c of cands) { const q = pose(c.x, H.y + c.y0 + h / 2, c.z, H); if (free(q)) return q; }
        for (const c of cands) for (let dy = 0.1; dy < 8; dy += 0.1) { // (stacked on what is there already)
          if (!fitsIn(c.secs, c.y0 + dy, h, Math.abs(c.z) + dep / 2 + m, m)) break;
          const q = pose(c.x, H.y + c.y0 + dy + h / 2, c.z, H);
          if (free(q)) return q;
        }
      }
      return room;
    }
    // stern: a screw under the aftmost segment's keel a little ahead of the transom (a pair with symmetry on); a rudder
    // just behind a screw that has none, else under the transom
    if (def.place === 'stern' && ((def.screw && !def.steer) || (def.foil && def.foil.kind === 'rudder'))) {
      if (!hulls.length) return first;
      const A = hulls.reduce((m, p) => (!m || span(p)[0] < span(m)[0] ? p : m), null), xa = span(A)[0], hb = shullOf(A.def).rings.reduce((s, r) => Math.max(s, r.bd), 0);
      const under = (x) => { let k = Infinity; for (const s of samples(Math.max(xa, x - w / 2), Math.min(X1, Math.max(xa, x + w / 2)))) k = Math.min(k, keelAt(s)); return k; };
      if (def.screw) {
        const D = def.screw.D, k = BD.pair * hb, k2 = k + D + 0.2, x = xa + Math.max(0.7 * D, w / 2), zs = at.sym ? [k, 0, k2] : [0, k, -k, k2, -k2];
        for (const z of zs) { if (Math.abs(z) + dep / 2 > hb + 0.2) continue; const q = pose(x, under(x) - 0.01 - h / 2, z, A); if (free(q)) return q; } // (within the beam)
        return room;
      }
      const screws = parts.filter((p) => p.def.screw && !p.def.steer).sort((a, b) => (at.sym ? partZ(b) - partZ(a) : Math.abs(partZ(a)) - Math.abs(partZ(b))));
      for (const s of screws) {
        const sz = partZ(s), x = partRect(s).l - BD.wash - w / 2;
        if (parts.some((r) => r.def.foil && r.def.foil.kind === 'rudder' && Math.abs(partZ(r) - sz) < 0.3 && r.x < s.x && r.x > s.x - 4)) continue;
        const q = pose(x, under(x) - 0.01 - h / 2, sz, A);
        if (free(q)) return q;
      }
      for (const z of at.sym ? [BD.pair * hb, 0] : [0]) { const x = xa + w / 2 - 0.25, q = pose(x, under(x) - 0.01 - h / 2, z, A); if (free(q)) return q; }
      return room;
    }
    return null;
  }
  // Inside a hull section (a ring polygon: convex, the same either side; its starboard half runs from the keel up to the
  // deck edge): its half-breadth at y (NaN under the keel or over the deck), the lowest y a box h tall reaching zm across
  // fits at in every one of secs m clear of the skin (null: nowhere), and whether one fits at y0
  const chainOf = (P) => { const K = P.length / 2, c = [0]; for (let i = 1; i <= SHULL_NK + 2; i++) c.push(K - i); return c; };
  function halfAt(P, y) {
    const ch = chainOf(P);
    if (y < P[0] - 1e-9) return NaN;
    for (let i = 1; i < ch.length; i++) {
      const a = ch[i - 1], b = ch[i], ya = P[2 * a], yb = P[2 * b];
      if (y <= yb + 1e-9) return yb > ya ? P[2 * a + 1] + ((P[2 * b + 1] - P[2 * a + 1]) * (y - ya)) / (yb - ya) : Math.max(P[2 * a + 1], P[2 * b + 1]);
    }
    return NaN;
  }
  function fitsIn(secs, y0, h, zm, m) {
    for (const P of secs) {
      const yd = P[2 * chainOf(P)[SHULL_NK + 2]];
      if (y0 + h > yd - m + 1e-9 || !(halfAt(P, y0) >= zm - 1e-9) || !(halfAt(P, y0 + h) >= zm - 1e-9)) return false;
    }
    return true;
  }
  function lowIn(secs, zm, h, m) {
    let y0 = -Infinity;
    for (const P of secs) { // (the half-breadth grows from the keel: the first height it reaches zm)
      const ch = chainOf(P);
      let y = null;
      for (let i = 1; i < ch.length && y == null; i++) {
        const a = ch[i - 1], b = ch[i], za = P[2 * a + 1], zb = P[2 * b + 1];
        if (zb >= zm) y = zb > za && za < zm ? P[2 * a] + ((P[2 * b] - P[2 * a]) * (zm - za)) / (zb - za) : P[2 * a];
      }
      if (y == null) return null;
      y0 = Math.max(y0, y + m);
    }
    return fitsIn(secs, y0, h, zm, m) ? y0 : null;
  }
  // The ship's warnings (renderStats, kind ship), plainly: no hull, she sinks or is overloaded, open ends, she capsizes or
  // rolls, lists or trims, nothing pushes or steers her, a screw or rudder out of the water. (No bridge is the builder's
  // first line, as every kind's control part; loose parts, the budget and the rest come after, everyone's.)
  function warnings(ps, st, warn) {
    const BD = B0(), t = (kg) => { const v = kg / 1000; return v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'); };
    if (!st || !st.hull) { warn.push('No hull: she can\'t float. Start with hull segments (Ship hulls): a bow, a midsection and a stern.'); return; }
    if (st.sinks) warn.push(`Too heavy for her hull: ${t(st.mass)} t on a hull that floats ${t(st.cap)} t. She'll sink: lighten her or lengthen the hull.`);
    else if (st.freeboard < BD.free) warn.push(`Overloaded: her deck is only ${Math.max(0, st.freeboard).toFixed(1)} m above the water. Lighten her or lengthen the hull.`);
    const open = (w) => (st.openEnds || []).some((o) => o.at === w);
    if (open('stern')) warn.push('The stern is open: she will flood. Close it with a stern.');
    if (open('bow')) warn.push('The bow is open: she will flood. Close it with a bow.');
    if (open('gap')) warn.push('There\'s a gap between hull segments (or two that don\'t match): she will flood there.');
    if (!st.sinks) {
      if (st.capsize || st.GM < 0) warn.push(`Top-heavy: GM ${st.GM < 0 ? '−' : ''}${Math.abs(st.GM).toFixed(1)} m, she will capsize. Put weight low (engines, ballast) or widen the hull.`);
      else if (st.GM < BD.gmLow) warn.push(`GM under ${BD.gmLow} m: she'll roll heavily. Put weight lower.`);
      if (!st.capsize && Math.abs(st.heel) > BD.heel) warn.push(`She lists ${Math.round(Math.abs(st.heel))}° to ${st.heel > 0 ? 'starboard' : 'port'}: move weight across.`);
      if (Math.abs(st.trim) > BD.trim) warn.push(`Down by the ${st.trim > 0 ? 'bow' : 'stern'} ${Math.abs(st.trim).toFixed(1)}°: move weight ${st.trim > 0 ? 'aft' : 'forward'}.`);
    }
    if (!st.thrust) warn.push('No screw or waterjet: nothing pushes her. Hang propellers under the stern (Propulsion).');
    else if (st.noEngine) warn.push('No engine turns her propellers: put a marine diesel inside the hull.');
    if (st.dryScrews && st.dryScrews.length) warn.push('A propeller is out of the water: hang it lower, under the stern.');
    if (!st.rudder) warn.push('No rudder: she can\'t steer. Hang one just behind a propeller.');
    else if (st.dryRudders && st.dryRudders.length) warn.push('A rudder is out of the water: it can\'t steer her. Hang it lower.');
  }
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
  function fx(v, dt, F) {} // spray and funnel smoke [WP2]

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
