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
//   (and the hydro core's: ax, ay the hull's axes; kM, kI the added mass per part axis; scr, fl screws and foils copy by
//   copy; pow the engines' share now (spooling), dem the helm's demand, T the screws' thrust (N, in v.thrust too); tk,
//   tkT, tkN the telegraph key; man the stick on the rudder; gm, Tbar, Vol, Awp, cb; the frame U, E, N / Ub, Eb, Nb)
// Per vessel (hydro): afloat (her buoyancy over 5 % of her weight: not splashed, which stays the old solid sea's), heel
// (+ starboard down), trim (+ bow down), draft; moored and mo (asleep on the swell, flight.js physicsTick drifts her).
// The helm's interface (WP3's keys and touch, the AI): Ship.setTel(v, n) / telStep(v, ±1) or sh.tel; W/S on ctl.v step it
// too (a tap a step, held a step every TEL_REPEAT s after TEL_HOLD s); the rudder is ctl.h × its throw, let go the heading
// hold (sas 'hold'; 'manual' centres it); Ship.heading(v, v.sh) her heading (rad, clockwise from game north).
// Saved per part (GV_SAVE, when the damage package adds them): p.holes, p.water, p.rud, p.fire; per vessel: sh: { tel,
// dcPri, ciwsOn } and sas.

// All tuning in one table (lengths m, speeds m/s, angles ° unless said, times s, areas m², volumes m³, power kW).
const SHIP = {
  // ---- water and the hull's forces (§4.2-4.3)
  RHO: 1025, NU: 1.19e-6,            // sea water's density (kg/m³) and kinematic viscosity (m²/s)
  latLin: 2.0, cross: 0.9,           // lateral force: linear lift C_lin = latLin·π·T̄/L_wl (each step from the last T̄, L_wl), cross-flow drag C_x
  //   (latLin 2, the spec's 1: Clarke's (1 + 0.4·C_B·B/T) for a beamy hull, tuned by the Cyclon's turning trial)
  LAT_T: 0.5,
  planeK: 0.6, dispK: 0.2,           // strip planing lift on plane: true hulls, and on the rest (planeK 0.6, the spec's 1.3: at 1.3 the 110 t
  //   Cyclon planed at 1° of trim and 43 kn on 4 MW, half again Savitsky's lift; tuned by her speed trial: 33 kn)
  heaveCd: 1.0, planeFade: 0.15,     // heave drag; the vertical terms fade in over the first planeFade m of immersion
  heaveLin: 0.4,                     // and linear heave damping (the waves a heaving hull makes), heaveLin·ρ·√(g·T̄) per m² of waterplane
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
  rollZV: 0.15,                      // + this × her Froude number (to 1.5): the lift a hull under way meets rolling (Ikeda's lift damping)
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
  SPOOL: 8,                          // s a diesel takes from idle to full load (an engine's own def.engine.spool: a gas turbine's 15)
  TEL_HOLD: 0.5, TEL_REPEAT: 0.35,   // a held W/S steps again after TEL_HOLD s, then every TEL_REPEAT s
  SCREW: { k0: 0.75, va: 1.1, vmin: 0.5, sub: 0.5, rpm: 600, app: 0.012 }, // static thrust k0·(2ρA·P²)^(1/3); advance speed va·u (past 1: the thrust deduction of a fast hull with no wake to gain from); surfaces over sub·D; rpm = rpm/D·√|demand|; its shaft and brackets' drag area app·D²
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
  // Each ring also carries what the hydro step reads every step: its base point bx, by, bz (the part's own y = 0, z = 0
  // at the ring's station, part space), tau (the keel's slope there in the part's own frame, rad, + rising toward the
  // bow: her trim comes in through the flow), cb2 (cos² of its deadrise), cpl (its planing lift coefficient), kf (its
  // hull's form factor) and depth (keel to deck). v.sh gains the hull's axes (ax along it, ay up it, part space), the
  // added mass's coefficients on the part axes (kM, kI), the screws and foils copy by copy (scr, fl), the propulsion's
  // and the helm's state, the frame and the water under her, and the last step's per-ring results.
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
    let big = null; // (the longest hull part: its axes are the hull's)
    for (const p of hulls) {
      const H = shullOf(p.def), o = partPt(p, 0, 0), ax = partPt(p, 1, 0), ay = partPt(p, 0, 1), z0 = partZ(p);
      const ex = { x: ax.x - o.x, y: ax.y - o.y, z: 0 }, ey = { x: ay.x - o.x, y: ay.y - o.y, z: 0 }, ci = comps.length;
      const at = (lx, ly, lz, out, k) => { const q = partPt(p, lx, ly); out[k] = q.x; out[k + 1] = q.y; out[k + 2] = z0 + lz; };
      const S = p.def.shull;
      for (const R of H.phys) {
        const P = new Float32Array(R.K * 3);
        for (let i = 0; i < R.K; i++) at(R.x, R.P[2 * i], R.P[2 * i + 1], P, 3 * i);
        const c = partPt(p, R.x, R.yk), b = partPt(p, R.x, 0);
        const k0 = shullSec(S.st, R.x - 0.25)[1], k1 = shullSec(S.st, R.x + 0.25)[1];
        const beta = R.yk < S.wl ? Math.atan((S.wl - R.yk) / Math.max(R.bw, 0.05)) / Math.max(1, R.nb) : 0;
        rings.push({ p, ci, R, x: c.x, y: c.y, z: z0, ex, ey, P, dx: R.dx, A: R.A, cy: R.cy, bx: b.x, by: b.y, bz: z0,
          tau: Math.atan((k1 - k0) / 0.5), cb2: Math.cos(beta) ** 2, cpl: S.plane ? SHIP.planeK : SHIP.dispK, kf: S.k || 0.15, depth: Math.max(0.05, R.yd - R.yk) });
      }
      if (!big || p.def.w > big.def.w) big = p;
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
    // the hull's axes in part space (a ship's: x along, y up; pontoons turned along a seaplane's nose: +y along, −x up),
    // and the added mass's coefficients on the part axes they fall on
    let ax = { x: 1, y: 0, z: 0 }, ay = { x: 0, y: 1, z: 0 };
    if (big) { const o = partPt(big, 0, 0), a = partPt(big, 1, 0), u = partPt(big, 0, 1); ax = { x: a.x - o.x, y: a.y - o.y, z: 0 }; ay = { x: u.x - o.x, y: u.y - o.y, z: 0 }; }
    const M = SHIP.ADD_M, I = SHIP.ADD_I, alongX = Math.abs(ax.x) >= Math.abs(ax.y);
    const kM = alongX ? { x: M.x, y: M.y, z: M.z } : { x: M.y, y: M.x, z: M.z }, kI = alongX ? { x: I.x, y: I.y, z: I.z } : { x: I.y, y: I.x, z: I.z };
    // screws and foils copy by copy (a twin pair's two), each with its own axes in part space
    const axes = (p) => { const o = partPt(p, 0, 0), a = partPt(p, 1, 0), u = partPt(p, 0, 1); return { o, ex: { x: a.x - o.x, y: a.y - o.y, z: 0 }, ey: { x: u.x - o.x, y: u.y - o.y, z: 0 } }; };
    const scr = [], fl = [];
    for (const p of thrust) if (p.def.screw) { const U = axes(p), yh = p.def.screw.y ? partPt(p, 0, p.def.screw.y) : U.o; for (const z of partZs(p)) scr.push({ p, x: yh.x, y: yh.y, z, ex: U.ex, D: p.def.screw.D, eta: p.def.screw.eta || 0.6, T: 0 }); } // [WP5] (screw.y: the propeller's height in its part, an outboard's at the foot of its leg)
    for (const p of foils) { const U = axes(p); for (const z of partZs(p)) fl.push({ p, x: U.o.x, y: U.o.y, z, ex: U.ex, ey: U.ey, f: p.def.foil, F: 0 }); }
    const n = rings.length;
    v.sh = {
      rings, comps, hulls, joins, open, thrust, foils, rudders, engines, decks,
      tel: was ? was.tel : 0, rud: was ? was.rud : 0, hold: was ? was.hold : null, dcPri: was ? was.dcPri : 'auto', ciwsOn: was ? was.ciwsOn : true,
      fsub: was ? was.fsub : 0, B: was ? was.B : 0, Lwl: was ? was.Lwl : 0, Swet: was ? was.Swet : 0, draft: was ? was.draft : 0,
      level: was ? was.level : 0, depth: was ? was.depth : Infinity, fade: was ? was.fade : 0, moorT: 0, lodT: 0,
      // (the hull's axes and added mass; the screws and foils; pow: the share of the shaft power the engines give now, dem:
      // what the helm asks, T: the screws' thrust (N); tk, tkT, tkN: the telegraph key held, for how long, the next step's
      // time; man: the stick has the rudder; lake; wx, wy, wz: where the water was last looked at; gm: her metacentric
      // height now; Tbar: mean draft; the frame (U, E, N sim axes; Ub, Eb, Nb part axes; e0, n0 her east and north);
      // per ring: immersed area, local centroid, waterline chord, wetted girth, keel depth)
      ax, ay, kM, kI, scr, fl, pow: was ? was.pow : 0, dem: was ? was.dem : 0, T: 0, lake: was ? was.lake : false,
      tk: 0, tkT: 0, tkN: 0, man: false, gm: was ? was.gm : 1, gmT: 0, Tbar: was ? was.Tbar : 0, Vol: 0, Awp: 0, cb: v3(),
      wx: NaN, wy: 0, wz: 0, U: v3(), E: v3(), N: v3(), Ub: v3(), Eb: v3(), Nb: v3(), e0: 0, n0: 0,
      ra: new Float64Array(n), rly: new Float64Array(n), rlz: new Float64Array(n), rb: new Float64Array(n), rg: new Float64Array(n), rk: new Float64Array(n),
    };
    if (v.afloat === undefined) { v.afloat = false; v.moored = false; v.heel = 0; v.trim = 0; v.draft = 0; }
    return v.sh;
  }

  // ---- the frame and the water under her
  const _L = {}, WV = [0, 0, 0], ZUP = { x: 0, y: 0, z: 1 };
  // the local up, east and game north (sim axes) at her centre of mass, the same in part axes, and her east and north (m)
  function frameOf(v, S) {
    const r = Math.hypot(v.x, v.y, v.z) || 1, U = S.U, E = S.E, N = S.N;
    U.x = v.x / r; U.y = v.y / r; U.z = v.z / r;
    cross3(U, ZUP, E); if (len3(E) < 1e-9) { E.x = 1; E.y = 0; E.z = 0; } norm3(E);
    cross3(U, E, N); // (game north is the sim's −north: up × east)
    qunrot(v.q, U.x, U.y, U.z, S.Ub); qunrot(v.q, E.x, E.y, E.z, S.Eb); qunrot(v.q, N.x, N.y, N.z, S.Nb);
    const b = v.body;
    Terrain.locate(b, v.x, v.y, v.z, _L);
    S.e0 = b.padAngle != null ? -wrapAngle(_L.a - b.padAngle) * b.radius : _L.a * b.radius; S.n0 = -_L.z;
    return r;
  }
  // The still water's level under her (0 at sea, a lake's surface inland; −Infinity: no water on this body), the depth
  // and the waves' share there, looked at again every REFRESH m she moves (Gear's cache)
  function waterOf(v, S) {
    const dx = v.x - S.wx, dy = v.y - S.wy, dz = v.z - S.wz;
    if (dx * dx + dy * dy + dz * dz < SHIP.REFRESH * SHIP.REFRESH) return;
    S.wx = v.x; S.wy = v.y; S.wz = v.z;
    const b = v.body;
    Terrain.locate(b, v.x, v.y, v.z, _L);
    const h = Terrain.heightAt(b, _L.a, _L.z);
    if (b.ocean && h < 0) { S.level = 0; S.depth = -h; S.lake = false; }
    else {
      const w = b.mapped ? Terrain.inlandAt(b, _L.a, _L.z) : NaN;
      if (w === w && w > h) { S.level = w; S.depth = w - h; S.lake = true; }
      else if (b.ocean) { S.level = 0; S.depth = -h; S.lake = false; } // (over land: the sea's level, so nothing up here floats)
      else { S.level = -Infinity; S.depth = 0; S.lake = false; }
    }
    S.fade = S.lake ? 0 : fadeAt(S.depth);
  }

  // ---- the helm (Ship.pre)
  // The engine-order telegraph, −3 (full astern) … 0 (stop) … 4 (flank). setTel rings n; telStep moves it by d's sign
  // (WP3's keys and touch lever, the AI); Ship.pre also steps it from W/S (ctl.v) for kind ship.
  function setTel(v, n) { const S = v && v.sh; if (!S || !Number.isFinite(n)) return S ? S.tel : 0; S.tel = clamp(Math.round(n), -3, 4); return S.tel; }
  function telStep(v, d) { const S = v && v.sh; return S ? setTel(v, S.tel + Math.sign(d || 0)) : 0; }
  // her heading (rad, clockwise from game north: the hull's axis), and its rate (rad/s, + turning to starboard)
  const _hd = v3();
  function heading(v, S) { const F = qrot(v.q, S.ax.x, S.ax.y, S.ax.z, _hd); return Math.atan2(dot3(F, S.E), dot3(F, S.N)); }
  function yawRate(v, S) { return -dot3(v.av, S.U); }
  function rudMax(S) {
    let m = 0;
    for (const p of S.rudders) m = Math.max(m, p.def.foil ? p.def.foil.max || 35 : p.def.steer || (p.def.jet && p.def.jet.steer) || 30);
    return m || 35;
  }
  // The helm and the engines' demand, before applyEngines (vessel.js physicsStep, v.hydro). Kind ship: the telegraph
  // (sh.tel, stepped by W/S: ctl.v) and the rudder (ctl.h × its throw; let go with sas 'hold', the default, she holds the
  // heading she had, led by her yaw rate; sas 'manual': the rudder centres). v.throttle for air engines on a ship. Other
  // kinds with marine parts: a car's or tank's drive (ctl.v) and steering (ctl.h), else the throttle and the yaw (ctl.r).
  function pre(v, dt, sim) {
    const S = v.sh;
    if (!S) return;
    if (v.moored) { v.moored = false; v.mo = null; } // (stepped: awake)
    frameOf(v, S);
    const c = v.ctl || {}, H = SHIP.HOLD;
    let dem, rin = null;
    if (v.kind === 'ship') {
      const k = c.v > 0.5 ? 1 : c.v < -0.5 ? -1 : 0;
      if (k !== S.tk) { S.tk = k; S.tkT = 0; S.tkN = SHIP.TEL_HOLD; if (k) telStep(v, k); }
      else if (k) { S.tkT += dt; if (S.tkT >= S.tkN) { S.tkN += SHIP.TEL_REPEAT; telStep(v, k); } }
      S.tel = clamp(Math.round(Number.isFinite(S.tel) ? S.tel : 0), -3, 4);
      dem = SHIP.TEL[S.tel + 3];
      const h = Number.isFinite(c.h) ? c.h : 0, max = rudMax(S);
      if (Math.abs(h) >= H.dead) { S.rud = clamp(h, -1, 1) * max; S.hold = null; S.man = true; }
      else if (v.sas !== 'manual') {
        const psi = heading(v, S), r = yawRate(v, S);
        if (S.hold == null || !Number.isFinite(S.hold)) S.hold = wrapAngle(psi + (S.man ? r * H.lead : 0));
        const vb = qunrot(v.q, v.vx, v.vy, v.vz, _hd), V = Math.max(Math.abs(vb.x * S.ax.x + vb.y * S.ax.y), H.vmin), L = Math.max(S.Lwl || 0, 2);
        const cmd = -(H.kp * wrapAngle(psi - S.hold) + H.kd * (L / V) * r);
        S.rud = clamp((cmd * 180) / Math.PI, -max, max); S.man = false;
      } else { S.rud = 0; S.hold = null; S.man = false; }
      v.throttle = Math.max(0, dem); // (air engines on a ship: an airboat)
    } else if (isGround(v.kind)) { dem = clamp(c.v || 0, -1, 1); rin = clamp(c.h || 0, -1, 1); }
    else { dem = clamp(v.throttle || 0, 0, 1); rin = clamp(c.r || 0, -1, 1); }
    if (rin != null) { S.rud = rin * rudMax(S); S.hold = null; }
    S.dem = dem;
    // the engines' power follows the demand over the slowest one's spool (s from idle to full: a diesel's load
    // acceptance, SHIP.SPOOL, a gas turbine's own)
    let sp = 0;
    for (const p of S.engines) sp = Math.max(sp, p.def.engine.spool || SHIP.SPOOL);
    S.pow = sp > 0 ? S.pow + clamp(dem - S.pow, -dt / sp, dt / sp) : dem;
    // each rudder follows the helm at rudRate, within its own throw
    const rr = SHIP.rudRate * dt;
    for (const p of S.rudders) {
      const m = p.def.foil ? p.def.foil.max || 35 : p.def.steer || (p.def.jet && p.def.jet.steer) || 30, now = Number.isFinite(p.rud) ? p.rud : 0;
      p.rud = now + clamp(clamp(S.rud, -m, m) - now, -rr, rr);
    }
  }
  // the shaft power the working engines give (W): a damaged one less (Combat.engineK, as Gear's), none with no one at the helm
  function shaftPower(v, S) {
    let P = 0;
    const cb = typeof Combat !== 'undefined';
    for (const p of S.engines) if (!p.broken && v.byId.has(p.id)) P += p.def.engine.kw * 1000 * (cb && p.hp != null ? Combat.engineK(p) : 1);
    if (P > 0 && v.gv && typeof Armour !== 'undefined' && !Armour.has(v, 'driver')) P = 0;
    return P;
  }

  // ---- the water's forces (Ship.forces)
  const CLIP = new Float64Array(64);
  const _u = v3(), _f = v3(), _t = v3(), _w = v3(), _c = v3(), _n = v3(), _ir = v3(), EZ = Object.freeze({ x: 0, y: 0, z: 1 });
  // add the force f (part axes) at the part-space point X to hF and hT (about the centre of mass)
  function push(v, X, f) {
    const c = v.com, hF = v.hF, hT = v.hT, rx = X.x - c.x, ry = X.y - c.y, rz = X.z - (c.z || 0);
    hF.x += f.x; hF.y += f.y; hF.z += f.z;
    hT.x += ry * f.z - rz * f.y; hT.y += rz * f.x - rx * f.z; hT.z += rx * f.y - ry * f.x;
  }
  // the velocity through the water of a part-space point (part axes; the water at rest)
  function pointU(v, vb, wb, X, o) {
    const c = v.com, rx = X.x - c.x, ry = X.y - c.y, rz = X.z - (c.z || 0);
    o.x = vb.x + wb.y * rz - wb.z * ry; o.y = vb.y + wb.z * rx - wb.x * rz; o.z = vb.z + wb.x * ry - wb.y * rx;
    return o;
  }
  // the effective mass at X along the unit dir (part axes): what an impulse there along dir meets (ground()'s effMass)
  function effMass(v, X, dir) {
    const c = v.com, rx = X.x - c.x, ry = X.y - c.y, rz = X.z - (c.z || 0);
    _t.x = ry * dir.z - rz * dir.y; _t.y = rz * dir.x - rx * dir.z; _t.z = rx * dir.y - ry * dir.x;
    v.mulInvI(_t, _ir);
    return 1 / (1 / v.mass + _t.x * _ir.x + _t.y * _ir.y + _t.z * _ir.z);
  }
  // a damping force, held to at most CLAMP of the momentum it opposes a step (m: the effective mass, its share)
  function capF(F, u, m, dt) { const lim = (SHIP.CLAMP * m * Math.abs(u)) / dt; return F > lim ? lim : F < -lim ? -lim : F; }
  // how deep a part-space point lies under the water's surface (m, + under), the waves there included
  function depthOf(v, S, X, h0, t) {
    const c = v.com, ox = X.x - c.x, oy = X.y - c.y, oz = X.z - (c.z || 0), Ub = S.Ub;
    let eta = 0;
    if (S.fade > 0) eta = wave(S.e0 + ox * S.Eb.x + oy * S.Eb.y + oz * S.Eb.z, S.n0 + ox * S.Nb.x + oy * S.Nb.y + oz * S.Nb.z, t, WV)[0] * S.fade;
    return -(h0 + Ub.x * ox + Ub.y * oy + Ub.z * oz - eta);
  }
  // [WP5] a hull's wave-making factor (§4.12: shull.cw, a blunt bow's; the biggest aboard, 1 for every other hull)
  function cwOf(hulls) { let k = 1; for (const p of hulls) if (p.def.shull.cw > k) k = p.def.shull.cw; return k; }
  // the wave-making and residual resistance's coefficient at the Froude number Fn (SHIP.CWR, flat past its last)
  function cwr(Fn) {
    const X = SHIP.CWR_FN, Y = SHIP.CWR;
    if (Fn >= X[X.length - 1]) return Y[Y.length - 1];
    for (let i = 1; i < X.length; i++) if (Fn <= X[i]) return Y[i - 1] + ((Y[i] - Y[i - 1]) * (Fn - X[i - 1])) / (X[i] - X[i - 1]);
    return 0;
  }
  // Buoyancy, ring by ring (§4.2): each ring's polygon clipped by the water's plane at it (the wave's height and slope
  // there, × fade), ρ·g·area·dx up along the local vertical at the immersed part's centroid. Fills the per-ring results
  // and S's sums (B, Vol, Awp, Swet, Lwl, Tbar, cb), returns B (N). still: no waves (the launch's float).
  function buoy(v, S, h0, t, gl, still) {
    const rho = SHIP.RHO, com = v.com, cz = com.z || 0, Ub = S.Ub, Eb = S.Eb, Nb = S.Nb, rings = S.rings, n = rings.length, fade = still ? 0 : S.fade;
    let B = 0, Awp = 0, Vol = 0, Swet = 0, kmax = 0, lo = Infinity, hi = -Infinity, Mx = 0, My = 0, Mz = 0;
    for (let i = 0; i < n; i++) {
      const g = rings[i], ox = g.bx - com.x, oy = g.by - com.y, oz = g.bz - cz;
      let eta = 0, Gx = 0, Gy = 0, Gz = 0;
      if (fade > 0) {
        wave(S.e0 + ox * Eb.x + oy * Eb.y + oz * Eb.z, S.n0 + ox * Nb.x + oy * Nb.y + oz * Nb.z, t, WV);
        eta = WV[0] * fade; const ge = WV[1] * fade, gn = WV[2] * fade;
        Gx = ge * Eb.x + gn * Nb.x; Gy = ge * Eb.y + gn * Nb.y; Gz = ge * Eb.z + gn * Nb.z;
      }
      // a point's height over the water (−: under): d(y, z) = d0 + dy·y + dz·z over the ring's own [y, z]
      const d0 = h0 + Ub.x * ox + Ub.y * oy + Ub.z * oz - eta, Wx = Ub.x - Gx, Wy = Ub.y - Gy, Wz = Ub.z - Gz;
      const dy = Wx * g.ey.x + Wy * g.ey.y, dz = Wz, P = g.R.P, K = g.R.K;
      let dmin = Infinity, dmax = -Infinity;
      for (let j = 0; j < K; j++) { const d = d0 + dy * P[2 * j] + dz * P[2 * j + 1]; if (d < dmin) dmin = d; if (d > dmax) dmax = d; }
      S.ra[i] = 0; S.rb[i] = 0; S.rg[i] = 0; S.rk[i] = 0;
      if (dmin >= 0) continue; // (clear of the water)
      let a, ly, lz, chord = 0, girth = 0;
      if (dmax < 0) { a = g.A; ly = g.cy; lz = 0; girth = 2 * g.R.girth + 2 * g.R.bd; } // (all of it under)
      else { // one Sutherland-Hodgman pass, keeping the girth of the hull's own edges under the water
        let m2 = 0;
        for (let j = 0; j < K; j++) {
          const k = j + 1 < K ? j + 1 : 0, ay = P[2 * j], az = P[2 * j + 1], by = P[2 * k], bz = P[2 * k + 1];
          const da = d0 + dy * ay + dz * az, db = d0 + dy * by + dz * bz, ia = da < 0, ib = db < 0;
          if (ia) { CLIP[m2++] = ay; CLIP[m2++] = az; }
          if (ia !== ib) {
            const s = da / (da - db), qy = ay + (by - ay) * s, qz = az + (bz - az) * s;
            CLIP[m2++] = qy; CLIP[m2++] = qz;
            girth += ia ? Math.hypot(qy - ay, qz - az) : Math.hypot(by - qy, bz - qz);
          } else if (ia) girth += Math.hypot(by - ay, bz - az);
        }
        const np = m2 / 2, W2 = Math.hypot(dy, dz) || 1;
        let A2 = 0, sy = 0, sz = 0, cmin = Infinity, cmax = -Infinity;
        for (let j = 0; j < np; j++) {
          const k = j + 1 < np ? j + 1 : 0, y0 = CLIP[2 * j], z0 = CLIP[2 * j + 1], y1 = CLIP[2 * k], z1 = CLIP[2 * k + 1], cr = y0 * z1 - y1 * z0;
          A2 += cr; sy += (y0 + y1) * cr; sz += (z0 + z1) * cr;
          if (d0 + dy * y0 + dz * z0 > -1e-6) { const s = (-dz * y0 + dy * z0) / W2; if (s < cmin) cmin = s; if (s > cmax) cmax = s; } // (on the waterline)
        }
        if (A2 <= 2e-9) continue;
        a = A2 / 2; ly = sy / (3 * A2); lz = sz / (3 * A2);
        if (cmax > cmin) chord = cmax - cmin;
      }
      const k = -dmin, Fb = rho * gl * a * g.dx;
      S.ra[i] = a; S.rly[i] = ly; S.rlz[i] = lz; S.rb[i] = chord; S.rg[i] = girth; S.rk[i] = k;
      _c.x = g.bx + g.ey.x * ly; _c.y = g.by + g.ey.y * ly; _c.z = g.bz + lz;
      { const wn = Math.hypot(Wx, Wy, Wz) || 1; _f.x = (Wx / wn) * Fb; _f.y = (Wy / wn) * Fb; _f.z = (Wz / wn) * Fb; } // [WP5] along the wave surface's normal (the pressure gradient: Froude-Krylov), not the plain vertical: a small boat then lies with the wave slope instead of rolling past it (beam-on in Moderate: 13.6° → 8° significant)
      push(v, _c, _f);
      B += Fb; Mx += Fb * _c.x; My += Fb * _c.y; Mz += Fb * _c.z;
      Awp += chord * g.dx; Vol += a * g.dx; Swet += girth * g.dx;
      if (k > kmax) kmax = k;
      if (chord > 0) { const s = _c.x * S.ax.x + _c.y * S.ax.y; if (s - g.dx / 2 < lo) lo = s - g.dx / 2; if (s + g.dx / 2 > hi) hi = s + g.dx / 2; }
    }
    S.B = B; S.Swet = Swet; S.Vol = Vol; S.Awp = Awp; S.kmax = kmax;
    if (hi > lo) S.Lwl = hi - lo; else if (!(B > 0)) S.Lwl = 0;
    if (Awp > 0.01) S.Tbar = Vol / Awp;
    if (B > 0) { S.cb.x = Mx / B; S.cb.y = My / B; S.cb.z = Mz / B; }
    return B;
  }
  // The water's force and torque on the hull this step, into v.hF and v.hT (part axes), and v.sh.fsub: buoyancy ring by
  // ring, resistance, lateral and planing forces, roll damping, foils, thrust. vb, wb: her velocity and spin in part axes
  // (the water is at rest: orbital velocities are left out). LOD: a hydro vessel not the active one, over SHIP.LOD m from
  // it, works them out every other step and holds them between (their damping held to half as much a step).
  function forces(v, dt, vb, wb, sim) {
    const S = v.sh;
    if (!S) return;
    const A = sim && sim.active, far = A && A !== v && A.body === v.body && (A.x - v.x) ** 2 + (A.y - v.y) ** 2 + (A.z - v.z) ** 2 > SHIP.LOD * SHIP.LOD;
    if (far && v.hF && (S.lodT = S.lodT ? 0 : 1) === 0) return; // (the step between: last step's forces again)
    const hF = v.hF || (v.hF = v3()), hT = v.hT || (v.hT = v3());
    hF.x = hF.y = hF.z = 0; hT.x = hT.y = hT.z = 0;
    S.T = 0;
    waterOf(v, S);
    const r = frameOf(v, S), b = v.body;
    if (!(S.level > -Infinity)) { S.fsub = 0; S.B = 0; v.afloat = false; return; }
    const gl = b.mu / (r * r), W = v.mass * gl, h0 = r - b.radius - S.level, t = seaT(sim), lod = far ? 0.5 : 1;
    const B = buoy(v, S, h0, t, gl, false), Ub = S.Ub;
    S.fsub = clamp(B / Math.max(W, 1), 0, 1);
    v.afloat = B > 0.05 * W;
    v.draft = S.kmax;
    const upA = Ub.x * S.ay.x + Ub.y * S.ay.y;
    v.heel = Math.atan2(-Ub.z, upA); v.trim = Math.atan2(-(Ub.x * S.ax.x + Ub.y * S.ax.y), upA); // (+: starboard down, bow down)
    // her metacentric height now: the buoyancy's righting moment (all of hT so far) over W·sin(heel), every STAB_T s
    S.gmT += dt;
    if (S.gmT >= SHIP.STAB_T && Math.abs(v.heel) > (SHIP.STAB_HEEL * Math.PI) / 180 && v.afloat) {
      S.gmT = 0;
      const gm = -(hT.x * S.ax.x + hT.y * S.ax.y) / (W * Math.sin(v.heel));
      if (Number.isFinite(gm)) S.gm = clamp(gm, -20, 50);
    }
    // (the flood water's weight: WP8's floodStep keeps comps[].W, and its force joins here)
    if (!S.rings.length) { sink(v, S, dt, vb, wb, h0, t); return; }
    if (B > 0) hull(v, S, dt, vb, wb, gl, W, lod);
    propel(v, S, dt, vb, wb, h0, t, B > 0);
  }
  // §4.3: the hull moving through the water: lateral lift and cross-flow drag (at the immersed section's middle: a turn
  // heels her outward), strip planing lift and heave damping on the bottom, friction (ITTC-57) on the wetted girth and the
  // wave-making resistance shared by immersed volume, all at each ring's immersed centroid; then roll damping (§4.7)
  function hull(v, S, dt, vb, wb, gl, W, lod) {
    const rings = S.rings, n = rings.length, rho = SHIP.RHO, q = 0.5 * rho, ax = S.ax, Vol = Math.max(S.Vol, 1e-6), Ub = S.Ub;
    const Vx = vb.x * ax.x + vb.y * ax.y + vb.z * ax.z, Lwl = Math.max(S.Lwl, 0.5), V = Math.abs(Vx);
    const Re = (V * Lwl) / SHIP.NU, Cf = Re < SHIP.CF_RE ? SHIP.CF_LOW : 0.075 / Math.pow(Math.log10(Re) - 2, 2);
    const Rw = S.B * cwr(V / Math.sqrt(gl * Lwl)) * (S.cw || (S.cw = cwOf(S.hulls))), Tb = Math.max(S.Tbar || 0.1, 0.1); // [WP5] (× a blunt hull's shull.cw, §4.12: the landing craft's ramp bow)
    const Clin = (SHIP.latLin * Math.PI * Tb) / Lwl, heaveL = SHIP.heaveLin * rho * Math.sqrt(gl * Tb), cap = dt / lod;
    for (let i = 0; i < n; i++) {
      const a = S.ra[i];
      if (a <= 0) continue;
      const g = rings[i], dx = g.dx, share = (a * dx) / Vol, ex = g.ex, ey = g.ey;
      _c.x = g.bx + ey.x * S.rly[i]; _c.y = g.by + ey.y * S.rly[i]; _c.z = g.bz + S.rlz[i];
      pointU(v, vb, wb, _c, _u);
      // (the bottom's normal in the vertical plane through her keel line: square to the hull's axis, so a trim tilts
      // the planing lift back (its drag) while a heel doesn't turn it into a push sideways)
      const ue = Ub.x * ex.x + Ub.y * ex.y + Ub.z * ex.z, nx = Ub.x - ue * ex.x, ny = Ub.y - ue * ex.y, nz = Ub.z - ue * ex.z, nl = Math.hypot(nx, ny, nz) || 1;
      _n.x = nx / nl; _n.y = ny / nl; _n.z = nz / nl;
      const ua = _u.x * ex.x + _u.y * ex.y, uy = _u.x * _n.x + _u.y * _n.y + _u.z * _n.z, uz = _u.z;
      const k = S.rk[i], Tr = Math.min(k, g.depth), b = S.rb[i], fin = Math.min(1, k / SHIP.planeFade);
      const Fl = capF(-q * (Clin * Math.abs(ua) * uz + SHIP.cross * Math.abs(uz) * uz) * Tr * dx, uz, effMass(v, _c, EZ) * share, cap);
      const Vn = ua * Math.sin(g.tau) - uy;
      const Fd = capF((-q * SHIP.heaveCd * Math.abs(uy) * uy - heaveL * uy) * b * dx * fin, uy, effMass(v, _c, _n) * share, cap);
      const Fv = q * g.cpl * Math.max(0, Vn) * Math.abs(ua) * b * dx * g.cb2 * fin + Fd;
      const Fa = capF(-Math.sign(ua) * q * ua * ua * S.rg[i] * dx * Cf * (1 + g.kf) - Math.sign(Vx) * Rw * share, ua, effMass(v, _c, ex) * share, cap);
      _f.x = ex.x * Fa + _n.x * Fv; _f.y = ex.y * Fa + _n.y * Fv; _f.z = Fl + _n.z * Fv;
      push(v, _c, _f);
    }
    // roll damping about the hull's axis, in its exponential form (it never overshoots)
    const I = v.I, Iaa = Math.max(1, ax.x * ax.x * I.xx + 2 * ax.x * ax.y * I.xy + ax.y * ax.y * I.yy), p = wb.x * ax.x + wb.y * ax.y;
    const om = Math.sqrt(Math.max(W * S.gm, 1) / (Iaa * (1 + SHIP.ADD_I.x))), z = SHIP.rollZeta + rollBk(S) + SHIP.rollZV * Math.min(V / Math.sqrt(gl * Lwl), 1.5);
    const M = ((-Iaa * p * (1 - Math.exp(-2 * z * om * dt))) / dt) * S.fsub;
    v.hT.x += ax.x * M; v.hT.y += ax.y * M;
  }
  function rollBk(S) { let k = 0; for (const p of S.hulls) if (p.def.shull.bk) k = Math.max(k, p.def.shull.bk === true ? SHIP.bilgeKeel : +p.def.shull.bk || 0); return k; }
  // §4.4-4.5: screws from the shaft power, and the foils (rudders, skegs, fixed hydrofoils) at water density: never the
  // wings' code (water is ~850× denser than air: its deflection caps, load ratings, flutter and strain would all break)
  function propel(v, S, dt, vb, wb, h0, t, wet) {
    const rho = SHIP.RHO, q = 0.5 * rho, SC = SHIP.SCREW, dem = S.pow;
    let live = 0;
    for (const s of S.scr) if (!s.p.broken && v.byId.has(s.p.id)) live++;
    const each = live ? (shaftPower(v, S) * Math.abs(dem)) / live : 0, dir = dem >= 0 ? 1 : -1;
    let Tsum = 0;
    for (const s of S.scr) {
      const p = s.p;
      s.T = 0;
      if (p.broken || !v.byId.has(p.id)) { p.rpm = 0; continue; }
      p.rpm = (dir * SC.rpm * Math.sqrt(Math.abs(dem))) / s.D; // (+ ahead, − astern: the art spins it)
      _c.x = s.x; _c.y = s.y; _c.z = s.z;
      const sub = smoothstep(0, SC.sub * s.D, depthOf(v, S, _c, h0, t)); // (out of the water it races and pushes nothing)
      if (sub <= 0) continue;
      pointU(v, vb, wb, _c, _u);
      { // its shaft and brackets' drag, turning or not
        const U = Math.hypot(_u.x, _u.y, _u.z), k = q * SC.app * s.D * s.D * U * sub;
        _f.x = -k * _u.x; _f.y = -k * _u.y; _f.z = -k * _u.z;
        push(v, _c, _f);
      }
      if (!(each > 0)) continue;
      const T0 = SC.k0 * Math.cbrt(2 * rho * ((Math.PI * s.D * s.D) / 4) * each * each), Va = SC.va * dir * (_u.x * s.ex.x + _u.y * s.ex.y);
      const T = Math.min(T0, (s.eta * each) / Math.max(Va, SC.vmin)) * sub * (dir < 0 ? SHIP.ASTERN : 1);
      s.T = dir * T; Tsum += T;
      _f.x = s.ex.x * s.T; _f.y = s.ex.y * s.T; _f.z = 0;
      push(v, _c, _f);
    }
    S.T = Tsum;
    if (!wet) return;
    const FO = SHIP.FOIL, as = (FO.stall * Math.PI) / 180, post = (FO.post * Math.PI) / 180;
    for (const o of S.fl) {
      const p = o.p, f = o.f;
      o.F = 0;
      if (p.broken || !v.byId.has(p.id)) continue;
      _c.x = o.x; _c.y = o.y; _c.z = o.z;
      const s = smoothstep(0, FO.sub * (f.chord || 1), depthOf(v, S, _c, h0, t)); // (a foil that surfaces loses its lift)
      if (s <= 0) continue;
      pointU(v, vb, wb, _c, _u);
      // a rudder in the slipstream of a screw just ahead of it (pushing ahead): it steers her at low speed
      if (f.kind === 'rudder') for (const sc of S.scr) {
        if (!(sc.T > 0)) continue;
        const ddx = sc.x - o.x, ddy = sc.y - o.y, along = ddx * sc.ex.x + ddy * sc.ex.y, up = -ddx * sc.ex.y + ddy * sc.ex.x;
        if (along > 0 && along < FO.washL * sc.D && Math.abs(sc.z - o.z) < FO.washZ * sc.D && Math.abs(up) < FO.washY * sc.D) {
          const w = Math.sqrt((FO.wash * 2 * sc.T) / (rho * Math.PI * sc.D * sc.D * 0.25));
          _u.x += sc.ex.x * w; _u.y += sc.ex.y * w;
          break;
        }
      }
      // its normal and chord: its own z (a rudder, a skeg) turned about its stock (own y) by p.rud (+: the trailing edge
      // to starboard, her stern pushed to port: a turn to starboard), or its own y (a hydrofoil) pitched up by inc
      let cx, cy, cz, nx, ny, nz;
      if (f.n === 'y') {
        const inc = ((f.inc || 0) * Math.PI) / 180, ci = Math.cos(inc), si = Math.sin(inc);
        cx = o.ex.x * ci + o.ey.x * si; cy = o.ex.y * ci + o.ey.y * si; cz = 0;
        nx = o.ey.x * ci - o.ex.x * si; ny = o.ey.y * ci - o.ex.y * si; nz = 0;
      } else {
        const th = ((f.kind === 'rudder' ? p.rud || 0 : 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
        nx = o.ey.y * sn; ny = -o.ey.x * sn; nz = cs; // (ez·cos + (ey × ez)·sin)
        cx = o.ex.x * cs; cy = o.ex.y * cs; cz = (o.ey.x * o.ex.y - o.ey.y * o.ex.x) * sn; // (ex·cos + (ey × ex)·sin)
      }
      const U2 = _u.x * _u.x + _u.y * _u.y + _u.z * _u.z;
      if (U2 < 1e-6) continue;
      const Um = Math.sqrt(U2), hx = _u.x / Um, hy = _u.y / Um, hz = _u.z / Um;
      const uc = _u.x * cx + _u.y * cy + _u.z * cz, un = _u.x * nx + _u.y * ny + _u.z * nz;
      // the angle of attack (+: it pushes along its normal); going astern the flow meets it from behind, weaker
      const al = Math.atan2(-un, uc), aa = Math.abs(al), back = aa > Math.PI / 2, ae = back ? Math.PI - aa : aa, ar = f.ar || 2;
      const slope = (FO.slope * 2 * Math.PI * ar) / (ar + 2), stalled = ae > as;
      const CL = Math.sign(al) * (back ? 0.7 : 1) * (stalled ? slope * as * Math.max(FO.postMin, 1 - (ae - as) / post) : slope * ae);
      const CD = FO.cd0 + (CL * CL) / (FO.e * Math.PI * ar) + (stalled ? FO.stallCd * Math.sin(al) ** 2 : 0);
      const qs = q * U2 * (f.area || 1) * s, dn = nx * hx + ny * hy + nz * hz;
      let lx = nx - dn * hx, ly = ny - dn * hy, lz = nz - dn * hz;
      const ll = Math.hypot(lx, ly, lz) || 1;
      lx /= ll; ly /= ll; lz /= ll;
      _f.x = qs * (CL * lx - CD * hx); _f.y = qs * (CL * ly - CD * hy); _f.z = qs * (CL * lz - CD * hz);
      o.F = Math.hypot(_f.x, _f.y, _f.z);
      push(v, _c, _f);
      // past its load a foil strains; past FOIL.brk × it, it breaks off (queued as a wing's rip is)
      if (f.load) {
        const k = o.F / (f.load * 1000);
        p.strain = k;
        if (k > FO.brk && Array.isArray(v.rip) && !v.rip.includes(p)) v.rip.push(p);
      }
    }
  }
  // A hydro vessel with no hull left (a turret, a mast, a bridge blown off a ship): nothing holds it up; it sinks on its
  // drag (a turret at about 5 m/s), its tumbling damped, and lies on the bed
  function sink(v, S, dt, vb, wb, h0, t) {
    const dep = depthOf(v, S, v.com, h0, t), k = smoothstep(-v.reach * 0.5, v.reach * 0.5, dep);
    S.fsub = 0; v.afloat = false; v.draft = 0;
    if (k <= 0) return;
    const A = Math.max(v.area.x, v.area.y, v.area.z, 0.25), U = Math.hypot(vb.x, vb.y, vb.z);
    if (U > 1e-6) {
      const F = Math.min(0.5 * SHIP.RHO * A * U * U * k, (SHIP.CLAMP * v.mass * U) / dt);
      v.hF.x -= (vb.x / U) * F; v.hF.y -= (vb.y / U) * F; v.hF.z -= (vb.z / U) * F;
    }
    const d = (1 - Math.exp(-2 * k * dt)) / dt, Iw = v.mulI(wb, _w);
    v.hT.x -= Iw.x * d; v.hT.y -= Iw.y * d; v.hT.z -= Iw.z * d;
  }
  // The step's acceleration with the water's added mass (§4.7): divided on each part axis by 1 + k·fsub, so a ship feels
  // heavy and heaves smoothly; at rest (no net force) and out of the water (fsub 0) unchanged. (The spin's: vessel.js,
  // with sh.kI.)
  const _am = v3();
  function addedMass(v, ax, ay, az, gk, out) {
    out = out || v3();
    const S = v.sh, f = S ? S.fsub : 0;
    if (!(f > 0)) { out.x = ax; out.y = ay; out.z = az; return out; }
    const a = qunrot(v.q, ax, ay, az, _am), k = S.kM;
    a.x /= 1 + k.x * f; a.y /= 1 + k.y * f; a.z /= 1 + k.z * f;
    return qrot(v.q, a.x, a.y, a.z, out);
  }
  // What a hydro vessel's probes meet (vessel.js ground): a carrier's deck when the point is no lower than DECK_BAND under
  // it (alt: the point's height; none: the deck), else the ground, and under water the sea bed
  function floorAt(b, a, z, alt) {
    const dk = Terrain.deckAt(b, a, z);
    if (dk === dk && !(alt < dk - SHIP.DECK_BAND)) return dk;
    return Terrain.heightAt(b, a, z);
  }
  // the floor's outward normal there (sim axes, a new vector unless o): Terrain.normalAt's sums on the bed
  function floorNormal(b, a, z, o) {
    o = o || v3();
    const R = b.radius, lat = z / R, cl = Math.max(0.05, Math.cos(lat)), sl = Math.sin(lat), ca = Math.cos(a), sa = Math.sin(a), d = 1.5;
    const dk = Terrain.deckAt(b, a, z);
    if (dk === dk) { o.x = cl * ca; o.y = cl * sa; o.z = sl; return norm3(o); } // (a deck is flat to its edge)
    const da = d / (R * cl), H = Terrain.heightAt;
    const se = (H(b, a - da, z) - H(b, a + da, z)) / (2 * d), sn = (H(b, a, z + d) - H(b, a, z - d)) / (2 * d);
    o.x = cl * ca - se * sa + sn * ca * sl; o.y = cl * sa + se * ca + sn * sa * sl; o.z = sl - sn * cl;
    return norm3(o);
  }
  // is she over water (the sea, a lake)?
  function overWater(v) {
    if (!v || !v.body) return false;
    Terrain.locate(v.body, v.x, v.y, v.z, _L);
    return !!Terrain.waterAt(v.body, _L.a, _L.z);
  }

  // ---- launch: afloat at her marks
  // her net upward force (N) and her moments in pitch (about part z) and roll (about the hull's axis), in still water
  const _sF = v3(), _sT = v3();
  function stillLoads(v, S) {
    const hF = v.hF, hT = v.hT;
    v.hF = _sF; v.hT = _sT; _sF.x = _sF.y = _sF.z = 0; _sT.x = _sT.y = _sT.z = 0;
    const r = frameOf(v, S), gl = v.body.mu / (r * r);
    buoy(v, S, r - v.body.radius - S.level, 0, gl, true);
    v.hF = hF; v.hT = hT;
    return [dot3(_sF, S.Ub) - v.mass * gl, _sT.z, _sT.x * S.ax.x + _sT.y * S.ax.y];
  }
  // her pose with its centre of mass h along U from P0 and the level attitude q0 turned by trim th (+ bow up, about
  // part z) and heel ph (+ starboard down, about the hull's axis)
  function poseAt(v, P0, q0, U, h, th, ph) {
    const ax = v.sh.ax;
    v.q = qnorm(qmul(q0, qmul(qaxis(0, 0, 1, th), qaxis(ax.x, ax.y, ax.z, ph))));
    v.x = P0.x + U.x * h; v.y = P0.y + U.y * h; v.z = P0.z + U.z * h;
  }
  // Her float in still water where she is, heading kept (Newton's method on heave, trim and heel over the very rings the
  // physics floats her on): her pose, at rest. false: she can't float (no hull, too heavy, no water)
  function settle(v) {
    const S = v.sh;
    if (!S || !S.rings.length) return false;
    S.wx = NaN; waterOf(v, S);
    if (!(S.level > -Infinity)) return false;
    const r0 = Math.hypot(v.x, v.y, v.z), U = { x: v.x / r0, y: v.y / r0, z: v.z / r0 };
    // the level attitude with her heading: the hull's axis horizontal (ax -> Fh, ay -> U, ax × ay -> Fh × U)
    const Fw = qrot(v.q, S.ax.x, S.ax.y, S.ax.z), fu = dot3(Fw, U), Fh = norm3({ x: Fw.x - U.x * fu, y: Fw.y - U.y * fu, z: Fw.z - U.z * fu });
    const q0 = qmul(qbasis(Fh, U, cross3(Fh, U)), qconj(qbasis(S.ax, S.ay, cross3(S.ax, S.ay))));
    const R = v.body.radius + S.level, P0 = { x: U.x * R, y: U.y * R, z: U.z * R };
    const f = (h, th, ph) => { poseAt(v, P0, q0, U, h, th, ph); return stillLoads(v, S); };
    let lo = -v.reach - 2, hi = v.reach + 2;
    if (f(lo, 0, 0)[0] < 0) return false; // (all under and still too heavy)
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (f(mid, 0, 0)[0] > 0) lo = mid; else hi = mid; }
    const X = [(lo + hi) / 2, 0, 0], W = v.mass * 9.8, L = Math.max(1, v.reach), dX = [0.005, 0.001, 0.001], lim = [0.5, 0.05, 0.05];
    for (let it = 0; it < 30; it++) {
      const F0 = f(X[0], X[1], X[2]);
      if (Math.abs(F0[0]) < 1e-6 * W && Math.abs(F0[1]) < 1e-6 * W * L && Math.abs(F0[2]) < 1e-6 * W * L) break;
      const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let k = 0; k < 3; k++) {
        const Y = X.slice(); Y[k] += dX[k];
        const F1 = f(Y[0], Y[1], Y[2]);
        for (let i = 0; i < 3; i++) J[i][k] = (F1[i] - F0[i]) / dX[k];
      }
      const d = solve3(J, [-F0[0], -F0[1], -F0[2]]);
      if (!d) break;
      for (let k = 0; k < 3; k++) X[k] += clamp(d[k], -lim[k], lim[k]);
      X[1] = clamp(X[1], -0.6, 0.6); X[2] = clamp(X[2], -1.2, 1.2);
    }
    poseAt(v, P0, q0, U, X[0], X[1], X[2]);
    v.vx = v.vy = v.vz = 0; v.av = v3();
    S.wx = NaN; waterOf(v, S); frameOf(v, S);
    return true;
  }
  function solve3(A, b) {
    const M = A.map((r, i) => [r[0], r[1], r[2], b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (!(Math.abs(M[p][c]) > 1e-12)) return null;
      const tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      for (let r = 0; r < 3; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j < 4; j++) M[r][j] -= k * M[c][j]; }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }
  // the least clearance (m) between her keel and the bed along her hull as she lies (Infinity: no hull)
  function keelClear(v) {
    const S = v.sh, b = v.body, c = v.com, cz = c.z || 0;
    let low = Infinity;
    for (const g of S.rings) {
      const o = qrot(v.q, g.x - c.x, g.y - c.y, g.z - cz), px = v.x + o.x, py = v.y + o.y, pz = v.z + o.z;
      Terrain.locate(b, px, py, pz, _L);
      low = Math.min(low, Math.hypot(px, py, pz) - b.radius - Terrain.heightAt(b, _L.a, _L.z));
    }
    return low;
  }
  // A launch spot (e, z, yaw as placeOnSurface takes them: the nose along (cos yaw, −sin yaw) in (e, z)) moved out ahead
  // to water deep enough (the keel LAUNCH.shallow m over the bed all along her), LAUNCH.step m at a time up to LAUNCH.max.
  // Leaves her afloat there. { e, z, yaw, ok, moved }
  function seaPlace(v, e, z, yaw) {
    const L = SHIP.LAUNCH, b = v.body, rot = (VEHICLE_KINDS[v.kind] || {}).launchRot || 0;
    for (let s = 0; s <= L.max; s += L.step) {
      const E = e + Math.cos(yaw) * s, Z = z - Math.sin(yaw) * s;
      v.placeOnSurface(b, siteAngle(b, E), rot, Z, yaw);
      if (!settle(v)) continue;
      if (keelClear(v) >= L.shallow) return { e: E, z: Z, yaw, ok: true, moved: s };
    }
    v.placeOnSurface(b, siteAngle(b, e), rot, z, yaw);
    return { e, z, yaw, ok: false, moved: 0 };
  }
  // Set her afloat at her marks at the launch spot (Flight.start, after placeOnSurface, for a hydro vessel over water):
  // the draft, trim and heel her weight gives, heading kept, at rest; moved out to sea when it is too shallow there.
  // place: { e, z, yaw } (Flight.start's spot; none: where and as placeOnSurface left her). false: she couldn't float.
  function launch(v, place) {
    const S = v && v.sh;
    if (!S || !S.rings.length) return false;
    const b = v.body;
    let e, z, yaw;
    if (place && Number.isFinite(place.e)) { e = place.e; z = Number.isFinite(place.z) ? place.z : 0; yaw = Number.isFinite(place.yaw) ? place.yaw : 0; }
    else {
      frameOf(v, S);
      Terrain.locate(b, v.x, v.y, v.z, _L);
      e = -wrapAngle(_L.a - b.padAngle) * b.radius; z = _L.z;
      const F = qrot(v.q, S.ax.x, S.ax.y, S.ax.z), fe = dot3(F, S.E), fn = dot3(F, S.N);
      yaw = Math.atan2(fn, fe); // (the nose along (cos, −sin) in (e, z), and z is game south: −sin yaw = −fn)
    }
    const P = seaPlace(v, e, z, yaw);
    if (!P.ok && !settle(v)) return false;
    v.landed = false; v.splashed = false; v.afloat = true; v.moored = false; v.mo = null;
    v.contactTime = 0; v.restTime = 0;
    S.tel = 0; S.pow = 0; S.dem = 0; S.hold = null; S.man = false; S.rud = 0; S.tk = 0;
    for (const p of S.rudders) p.rud = 0;
    if (v.kind === 'ship') v.sas = 'hold';
    S.gm = stabProbe(v);
    const r = Math.hypot(v.x, v.y, v.z), gl = b.mu / (r * r);
    S.B = v.mass * gl; S.fsub = 1; S.Lwl = S.Lwl || v.reach;
    return P;
  }
  // her metacentric height in still water, from a 2° heel (the buoyancy's righting moment over W·sin 2°)
  function stabProbe(v) {
    const S = v.sh, q = v.q, ph = (2 * Math.PI) / 180;
    v.q = qnorm(qmul(q, qaxis(S.ax.x, S.ax.y, S.ax.z, ph)));
    const L = stillLoads(v, S), r = Math.hypot(v.x, v.y, v.z), W = v.mass * (v.body.mu / (r * r));
    v.q = q; frameOf(v, S);
    const gm = -L[2] / (W * Math.sin(ph));
    return Number.isFinite(gm) ? gm : 1;
  }
  function stab(v) { return v && v.sh ? v.sh.gm : null; } // her metacentric height now (m)

  // ---- mooring (§4.10): a ship afloat, still and left alone sleeps on the swell: no physics, its pose bobs on the waves
  function moor(v, F) {
    const S = v && v.sh;
    if (!S || v.moored) return;
    frameOf(v, S); waterOf(v, S);
    v.vx = v.vy = v.vz = 0; v.av = v3();
    const t = seaT(F), w = bob(v, S, t);
    v.moored = true;
    v.mo = { q0: quat(v.q.w, v.q.x, v.q.y, v.q.z), r0: Math.hypot(v.x, v.y, v.z), U: { x: S.U.x, y: S.U.y, z: S.U.z }, w0: w, A: w, B: w, ta: t, tb: t, hp: hpSum(v), n: v.parts.length, W: waterSum(S) };
    S.moorT = 0;
  }
  function hpSum(v) { let s = 0; for (const p of v.parts) s += p.hp == null ? 1e6 : p.hp; return s; }
  function waterSum(S) { let s = 0; for (const c of S.comps) s += (c.W || 0) + c.holes.length; return s; }
  // the waves' heave, pitch and roll on a moored hull (the surface averaged over her length and beam: a long ship barely moves)
  function bob(v, S, t) {
    if (!(S.fade > 0)) return { h: 0, p: 0, r: 0 };
    const L = Math.max(S.Lwl || v.reach, 1), Bm = Math.max(v.depth || 2, 1), ax = S.ax;
    const at = (s, l) => wave(S.e0 + ax.x * s * S.Eb.x + ax.y * s * S.Eb.y + l * S.Eb.z, S.n0 + ax.x * s * S.Nb.x + ax.y * s * S.Nb.y + l * S.Nb.z, t, WV)[0] * S.fade;
    const f = at(L / 2, 0), a = at(-L / 2, 0), c = at(0, 0), pt = at(0, -Bm / 2), sb = at(0, Bm / 2);
    return { h: (f + a + 2 * c + pt + sb) / 6, p: Math.atan((f - a) / L), r: Math.atan((pt - sb) / Bm) };
  }
  // a moored ship's pose this tick (flight.js physicsTick): its pose when moored, moved as the waves have moved since,
  // looked at MOOR.hz times a second and eased between
  function drift(v, h, F) {
    const S = v.sh, M = v.mo;
    if (!S || !M) { v.moored = false; return; }
    const t = seaT(F) + h, dl = 1 / SHIP.MOOR.hz;
    if (t >= M.tb) { M.A = M.B; M.ta = M.tb; M.tb = Math.max(t, M.tb + dl); M.B = bob(v, S, M.tb); }
    const k = M.tb > M.ta ? clamp((t - M.ta) / (M.tb - M.ta), 0, 1) : 1;
    const dh = lerp(M.A.h, M.B.h, k) - M.w0.h, dp = lerp(M.A.p, M.B.p, k) - M.w0.p, dr = lerp(M.A.r, M.B.r, k) - M.w0.r, r = M.r0 + dh, U = M.U;
    v.x = U.x * r; v.y = U.y * r; v.z = U.z * r;
    const F0 = qrot(M.q0, S.ax.x, S.ax.y, S.ax.z), Lt = qrot(M.q0, 0, 0, 1);
    v.q = qnorm(qmul(qaxis(F0.x, F0.y, F0.z, dr), qmul(qaxis(Lt.x, Lt.y, Lt.z, dp), M.q0)));
    v.vx = v.vy = v.vz = 0;
  }
  // wake a moored ship
  function unmoor(v) { if (v && v.moored) { v.moored = false; v.mo = null; if (v.sh) v.sh.moorT = 0; } }
  // once a frame (Ship.frame): who moors (afloat, not the player's, telegraph at Stop, no thrust, still for MOOR.t s) and
  // who wakes (the player's craft, the telegraph, a hit, a part lost, water or holes changing, a craft close by under way)
  function moorCheck(F, dt) {
    const M = SHIP.MOOR;
    for (const v of F.vessels) {
      const S = v.sh;
      if (!v.hydro || !S || v.remote || v.dead || !v.parts.length) continue;
      if (v.moored) {
        const o = v.mo;
        let wake = v === F.active || !o || S.tel !== 0 || hpSum(v) !== o.hp || v.parts.length !== o.n || waterSum(S) !== o.W || (v.kind !== 'ship' && v.thrust > 0);
        if (!wake) for (const u of F.vessels) {
          if (u === v || u.dead || u.moored || !u.speed) continue;
          if ((u.x - v.x) ** 2 + (u.y - v.y) ** 2 + (u.z - v.z) ** 2 < M.wake * M.wake && u.speed() > M.wakeV) { wake = true; break; }
        }
        if (wake) unmoor(v);
        continue;
      }
      if (v === F.active || !v.afloat || v.landed || S.tel !== 0 || S.T > 0 || (v.thrust || 0) > 0 || v.speed() > M.v) { S.moorT = 0; continue; }
      S.moorT += dt;
      if (S.moorT >= M.t) moor(v, F);
    }
  }

  // a grounding's broken parts (Death.impact): hull parts holed and kept; the rest go on breaking. Default: all of them [WP6]
  function impactSea(v, parts, sim) { return parts; }
  function bump(F) {} // ship against ship, carrier hulls and gear vessels (once a physics tick) [WP6]

  // ==== waves ====
  // The sea: one deterministic function of (east, north, time) (m, m, s: the game's east and north, Ship.seaT's clock),
  // four directional sines (SHIP.WAVES × the sea state's amplitude and period factors) with deep-water dispersion (k =
  // ω²/g), faded in shallow water by the caller (fadeAt: none in harbours, on lakes, inland). wave() returns [η, ∂η/∂e,
  // ∂η/∂n] in a shared array: copy it.
  const W3 = [0, 0, 0], GW = 9.8, NW = SHIP.WAVES.length, TAU2 = 2 * Math.PI;
  const WA = new Float64Array(NW), WK = new Float64Array(NW), WO = new Float64Array(NW), WDE = new Float64Array(NW), WDN = new Float64Array(NW), WP = new Float64Array(NW);
  function waveSetup() {
    const s = SHIP.SEA[S.sea] || SHIP.SEA.moderate;
    for (let i = 0; i < NW; i++) {
      const [a, T, th, ph] = SHIP.WAVES[i], om = TAU2 / (T * s.t), dir = ((SHIP.swellDir + th) * Math.PI) / 180;
      WA[i] = a * s.a; WO[i] = om; WK[i] = (om * om) / GW; WDE[i] = Math.sin(dir); WDN[i] = Math.cos(dir); WP[i] = ph;
    }
  }
  function wave(e, n, t, out) {
    out = out || W3;
    let h = 0, ge = 0, gn = 0;
    for (let i = 0; i < NW; i++) {
      const k = WK[i], ph = k * (WDE[i] * e + WDN[i] * n) - WO[i] * t + WP[i], a = WA[i], c = a * k * Math.cos(ph);
      h += a * Math.sin(ph); ge += c * WDE[i]; gn += c * WDN[i];
    }
    out[0] = h; out[1] = ge; out[2] = gn;
    return out;
  }
  function seaT(F) { return (F && Number.isFinite(F.time) ? F.time : 0) + S.seaOff; } // the sea's clock
  function setSea(state) { if (SHIP.SEAS.includes(state) && state !== S.sea) { S.sea = state; waveSetup(); } return S.sea; }
  function sea() { return S.sea; }
  function fadeAt(depth) { return depth > 0 ? smoothstep(SHIP.FADE[0], SHIP.FADE[1], depth) : 0; } // the waves' share in water this deep (0..1)
  // The shader's uniforms for a swell patch whose origin is at (P0e, P0n), at time t: per component [d.e, d.n, k, a, ω,
  // φ'], φ' = k·(d·P0) − ω·t + φ folded into [0, 2π) in double precision, so the shader's η = Σ a·sin(k·(d·local) + φ')
  // (local = the point's (e, n) less P0) never meets float32's big numbers far from the pad. [WP1; WP2 draws with it]
  function waveUniforms(P0e, P0n, t, out) {
    out = out || new Float32Array(NW * 6);
    for (let i = 0; i < NW; i++) {
      let ph = (WK[i] * (WDE[i] * P0e + WDN[i] * P0n) - WO[i] * t + WP[i]) % TAU2;
      if (ph < 0) ph += TAU2;
      out[6 * i] = WDE[i]; out[6 * i + 1] = WDN[i]; out[6 * i + 2] = WK[i]; out[6 * i + 3] = WA[i]; out[6 * i + 4] = WO[i]; out[6 * i + 5] = ph;
    }
    return out;
  }
  waveSetup();

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
  // foils' area in the water (rudders, hydrofoils: their profile drag, §4.4's cd0, straight ahead). (cwr: the core's own)
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
    return Rf + Math.max(0, W - lift) * cwr(V / Math.sqrt(g * L)) * cwOf(M.hulls) + 0.5 * rho * V * V * fA * SHIP.FOIL.cd0; // [WP5] (cwOf: as the flight's)
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
      const D = (d.screw || d.jet).D, o = partPt(p, 0, (d.screw && d.screw.y) || 0), e = partPt(p, 1, (d.screw && d.screw.y) || 0), copies = partZs(p); // [WP5] (screw.y: as the flight's)
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
  function frame(F, dt) {
    moorCheck(F, dt); // (who moors on the swell, who wakes)
    bump(F); // [WP6]
  }
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
    for (const p of sh.hulls) if (p.def.shull.ends && p.def.shull.ends.fore === 'ramp') p.ramp = !!v.landed && V < 1.5; // [WP5] (a landing craft's ramp drops in the art when she is beached and stopped)
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
  // [WP3, WP12] The helm panel (WP3): under the flight data, in the telemetry panel itself, so it sits wherever that does
  // (top left on a desktop and a phone alike, and zoomed with the HUD: nothing new to fit round the thumbs). Three lines:
  // the telegraph's eight rungs (astern on the left, Stop, ahead to Flank on the right) with the rung one lit and its
  // order; the rudder bar (±HUD.RUD°: the commanded angle a hollow mark, the rudders' own angle the fill) and its angle;
  // and the helm's mode, HOLD and the heading it holds, or HAND (hand steering). Speed in knots and the heading are the
  // flight data's own rows (Flight.updateHUD). Built once, on the first ship; each piece written only when it changes
  // (a key of what it shows), from Flight.updateHUD's tick (12 a second) and at once when the telegraph is rung.
  // The helm's state it reads (ship.js core's, Flight's inputs): sh.tel (-3..4), sh.rud (the commanded rudder, ° to
  // starboard), each rudder part's p.rud (its angle now, °; none yet: the command), v.sas ('hold' | 'manual') and sh.hold
  // (the heading held, rad clockwise from game north as Ship.heading; null: none caught yet).
  const HUD = { el: null, key: '', RUD: 35 };
  function hudEl() {
    if (HUD.el || typeof document === 'undefined') return HUD.el;
    const tel = document.querySelector('#flight-ui .telemetry');
    if (!tel) return null;
    const box = document.createElement('div');
    box.id = 'ship-helm'; box.className = 'ship-helm'; box.hidden = true;
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Helm');
    box.innerHTML = '<div class="sh-tel"><span class="sh-rungs" aria-hidden="true">' + '<i></i>'.repeat(8) + '</span></div>'
      + '<div class="sh-line"><b class="sh-order" role="status">Stop</b><span class="sh-mode"></span></div>'
      + '<div class="sh-rud"><span class="sh-bar" aria-hidden="true"><i class="sh-fill"></i><i class="sh-cmd"></i></span><span class="sh-ang">0°</span></div>';
    tel.append(box);
    HUD.el = box; HUD.rungs = [...box.querySelectorAll('.sh-rungs i')]; HUD.order = box.querySelector('.sh-order'); HUD.mode = box.querySelector('.sh-mode');
    HUD.fill = box.querySelector('.sh-fill'); HUD.cmd = box.querySelector('.sh-cmd'); HUD.ang = box.querySelector('.sh-ang');
    return box;
  }
  // a heading (rad clockwise from game north, Ship.heading's) as the compass reads it (Flight.compass's rule: real north on
  // the real Earth: its game east and north shares, sin and cos)
  function bearing(v, h) {
    if (v.body !== EARTH || !EARTH.mapped) return ((((h * 180) / Math.PI) % 360) + 360) % 360;
    return Terrain.bearingAt(Math.atan2(v.y, v.x), Math.asin(clamp(v.z / v.radius(), -1, 1)), Math.sin(h), Math.cos(h));
  }
  function hud(F) {
    const v = F && F.active, sh = v && isSea(v.kind) && !F.destroyed && !v.dead ? v.sh : null, E = hudEl();
    if (!E) return;
    if (!sh) { if (!E.hidden) E.hidden = true; HUD.key = ''; return; }
    const tel = clamp(Math.round(sh.tel) || 0, -3, 4), R = HUD.RUD;
    let act = 0, n = 0;
    for (const p of sh.rudders) if (Number.isFinite(p.rud) && !p.broken) { act += p.rud; n++; }
    const cmd = Number.isFinite(sh.rud) ? clamp(sh.rud, -R, R) : 0, now = n ? clamp(act / n, -R, R) : cmd;
    const hand = v.sas === 'manual', hold = !hand && Number.isFinite(sh.hold) ? String(Math.round(bearing(v, sh.hold)) % 360).padStart(3, '0') : '';
    const key = `${tel}|${Math.round(cmd)}|${Math.round(now)}|${hand}|${hold}|${sh.rudders.length}`;
    if (E.hidden) E.hidden = false;
    if (key === HUD.key) return;
    HUD.key = key;
    HUD.rungs.forEach((r, i) => { const c = i === tel + 3 ? 'on' + (tel < 0 ? ' astern' : '') : i === 3 ? 'stop' : ''; if (r.className !== c) r.className = c; });
    HUD.order.textContent = Flight.telWord ? Flight.telWord(tel) : SHIP.TEL_NAMES[tel + 3];
    HUD.order.classList.toggle('astern', tel < 0);
    HUD.mode.textContent = hand ? 'HAND' : hold ? `HOLD ${hold}°` : 'HOLD';
    HUD.mode.classList.toggle('on', !hand);
    // (the bar: its middle is amidships; the fill runs from there to the rudders' angle, the mark is the command)
    const pc = (a) => 50 + (a / R) * 50;
    HUD.fill.style.left = `${Math.min(50, pc(now)).toFixed(1)}%`; HUD.fill.style.width = `${Math.abs(pc(now) - 50).toFixed(1)}%`;
    HUD.cmd.style.left = `${pc(cmd).toFixed(1)}%`;
    const a = Math.round(now);
    HUD.ang.textContent = !sh.rudders.length ? 'no rudder' : a === 0 ? '0°' : `${Math.abs(a)}° ${a > 0 ? 'stbd' : 'port'}`;
  }
  // the ship's controls, from the bindings (Flight.shipHelp's list: README's Ships block and the manual's)
  function help(F) { return F && typeof F.shipHelp === 'function' ? F.shipHelp() : ''; }
  // a key for the ship (true: taken): Flight.shipKey's (flank, stop, the heading hold, CIWS, damage control, the bridge view)
  function keys(F, e, down) { return !!(down && F && typeof F.shipKey === 'function' && F.shipKey(e)); }

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
    setTel, telStep, settle, moor, unmoor, heading,
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
