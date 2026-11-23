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
// Saved per part (vessel.js SEA_SAVE, cleaned by seaLoad): p.holes, p.water (p.wc each compartment's), p.rud, p.fire (p.fireAt
// a hull's); per vessel: sh: { tel, dcPri, ciwsOn }, sas, fate and hydroFrom.

// All tuning in one table (lengths m, speeds m/s, angles ° unless said, times s, areas m², volumes m³, power kW).
const SHIP = {
  // ---- water and the hull's forces (§4.2-4.3)
  RHO: 1025, NU: 1.19e-6,            // sea water's density (kg/m³) and kinematic viscosity (m²/s)
  latLin: 2.0, cross: 0.9,           // lateral force: linear lift C_lin = latLin·π·T̄/L_wl (each step from the last T̄, L_wl), cross-flow drag C_x
  //   (latLin 2, the spec's 1: Clarke's (1 + 0.4·C_B·B/T) for a beamy hull, tuned by the Cyclon's turning trial)
  LAT_T: 0.5,
  planeK: 0.6, dispK: 0.2,           // strip planing lift on plane: true hulls, and on the rest (planeK 0.6, the spec's 1.3: at 1.3 the 110 t
  //   Cyclon planed at 1° of trim and 43 kn on 4 MW, half again Savitsky's lift; tuned by her speed trial: 33 kn)
  planeCP: 1,                        // the planing lift along her waterline, (n + 1)·(1 − ξ)^n from its fore end (ξ 0) to its aft end (ξ 1): its
  //   centre of pressure 2/3 of the wetted length ahead of the transom, inside Savitsky's 0.55-0.75 at planing speeds (a
  //   strip's even share put it halfway: the RIB ran nearly flat, her bow resting on the water, 2.3° in a calm sea, now 2.9°;
  //   at 2, 0.75, she turned half as fast again: her lateral plane all aft)
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
  FOIL: { slope: 0.9, stall: 22, post: 65, postMin: 0.5, cd0: 0.012, e: 0.8, stallCd: 1.2, sub: 0.8, wash: 0.8, washL: 3, washZ: 0.6, washY: 1, brk: 1.5,
          sig: 0.5, cav: 0.13, p0: 101325, pv: 1700 },
  //   (slope × 2π·ar/(ar + 2); stall angle; past it C_L falls over `post`° to postMin of its peak; C_D = cd0 + C_L²/(e·π·ar)
  //   + stallCd·sin²α stalled; lift fades in over sub × chord of depth; a rudder within washL·D behind a screw (|Δz| <
  //   washZ·D, |Δy| < washY·D) feels wash × its slipstream; a foil past brk × its load breaks; a hydrofoil cavitates
  //   under the cavitation number sig (p0 the air's pressure, pv the water's vapour pressure, Pa): + cav·(sig/σ − 1))
  rudRate: 12,                       // °/s a rudder turns
  RIDE: { h: 0.8, kh: 4, kv: 2, lim: 6, kphi: 60, kp: 20, v: 9, kt: 30, bank: 8, rate: 20, vRef: 25, steer: 0.25 }, // hydrofoil ride control [WP6]: the keel's target
  //   clearance over the waves (m; a foil's own foil.h first), °/m of it, °·s/m of her rise rate, ±° at most, ° per rad of heel
  //   and °·s per rad of roll rate;
  //   foilborne past v m/s; ° per unit of trim (bow over stern ÷ length); ° of bank into a turn at full rudder; °/s a foil turns;
  //   the gains × (vRef/V)² past vRef m/s (48 kn: a degree lifts as much again at 68 kn); foilborne, steer of each
  //   rudder's, strut's and jet's throw (she turns by banking)
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
  SLAM: { k: 1.8, floor: 0.3, hole: 0.01 }, // a hull ring meeting the water faster than k × its part's breakSpeed: a slam (holes, never a shattered hull) [WP6]; [WP8] its hp taken never below `floor` of the hull's, and a hull there takes no more; a slam's hole a crack of `hole` m² at most (the sea alone never sinks her)
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
  FLOOD: { cd: 0.6, hz: 10, downT: 2, downA: 0.05, fsMax: 0.45, leak: 1, sinkCd: 1, under: 0.95, wMin: 0.05 }, // orifice coefficient; steps a second; downflooding after downT s (downA m² per m of deck edge under); free-surface shift cap (× beam); [WP8] a holed-through part's joints and bulkheads leak through `leak` m²; a hull all but under (under of her volume) with water aboard sinks against a drag sinkCd on her plan area; under wMin m³ in a compartment (her pumps keeping up with a few small holes) its level is its lowest point, never solved
  FIRE: { hz: 4, odds0: 0.15, odds1: 0.35, blast: 9, hp: 4, spread: 0.02, dc: 20, crew: 5, crewR: 3, spreadR: 6, cal: 20 }, // fire odds odds0 + odds1·(blast/9); hp/s; spread a second; s to fight one; [WP8] crew within crewR m burn crew hp/s; it spreads to parts within spreadR m; a round under cal mm with no burst (small arms) lights none
  MAG: { near: 6, t: 30, r0: 8, rk: 1 / 20, hole: 6, brk: 100, missile: 20, dmg: 1500, dmgK: 5, rack: { r0: 2, rk: 0.1, dmg: 150, dmgK: 10 } }, // a fire within `near` m (or in it) for t s, [WP8] unfought (§8.8's 5 s: no party could ever reach one); the blast's size r0 + rounds·rk m; holes in the neighbours; [WP8] brk rounds or more break her in two; a missile counts as `missile` rounds; the blast's damage dmg + rounds·dmgK; a gun's ready rounds (`rack`) going up on its mount: a blast of r0 + rounds·rk m, dmg + rounds·dmgK, no magazine's holes
  DC: { patch: 0.02, minT: 15, full: 0.7, repair: 2, walk: 2, party: 4, bridge: 0.5, flood: 0.2 }, // a party patches 0.02 m²/s (at least minT s a hole), not past full of its compartment; repairs × REPAIR_T; [WP8] walks walk m/s along her; party crew a locker; none aboard: the bridge crew at `bridge` the rate; 'auto' patches first past `flood` of a compartment full
  DRONE: { ref: 2000 },              // [WP8] (S1) a drone's charge wears a ship part's plate as one of ref hp (a patrol boat's midsection), never by the part's own hp
  FATE: { hz: 4, capsize: 60, capsizeT: 4, reserve: 0.97, deckUnder: 1, scuttleT: 60, scuttleA: 1, under: 3, bedT: 10, wreckDepth: 40, gone: 40, derelictT: 120, derelictA: 0.5, wait: 15, helmT: 6, sinkT: 2 },
  //   (capsized: heel past capsize° for capsizeT s; foundering: weight + water past reserve × the intact hull's buoyancy, or
  //   the highest deck deckUnder m under; out of action: scuttled after scuttleT s, a scuttleA m² hole a compartment; sunk
  //   when the top is `under` m under or bedT s on the bed; a wreck stays on a bed shallower than wreckDepth, else gone
  //   `gone` m down; a derelict holed after derelictT s; the end screen waits up to `wait` s; [WP8] no one at the helm for
  //   helmT s (a dead helmsman's seat is taken in 4: armour.js) is out of action)
  // ---- combat (§8.9-8.11)
  CIWS: { cone: 30, disp: 0.002, burst: 1, on: 1, kill: 2.5, p: 0.35, err: 0.018, errD: 600, errV: 250, errMin: 0.1, leak: 300, assess: 1 }, // a missile heading within cone° of her; 2 mrad; 1 s bursts within on°; a round within kill m kills with p;
  //   [WP9] its fire control's error (rad, each round's own, × the range over errD m past it: the radar's track of a
  //   weaving sea-skimmer, the lead's guess; tuned so one gun stops a subsonic ASM 4 times in 5, two at once about half
  //   each; against an aircraft or a drone × its speed over errV m/s, at least errMin: a hovering one tracked steadily),
  //   inside leak m of her it is too late (what is left of a missile carries on into her: no kill there), and a kill is
  //   checked for assess s before it turns to the next
  TORP: { turn: 6, aground: 4, bubbles: 0.2, depthOff: 0 }, // °/s homing turn; runs aground where the bed is shallower; s between bubble puffs
  ASM: { term: 2000, termH: 3, skim: 8, climb: 30 }, // an anti-ship missile climbs to climb m, sea-skims at skim m over the waves until term m out, then goes in at termH m [WP9: skim, climb]
  VLS: { t: 0.8, rate: 60 },         // a vertical launch pitches over for t s at rate °/s
  RADAR: { lowAir: 100, rcsL: 150, rcsExp: 0.35, rcsMin: 0.4 }, // aircraft under lowAir m are surface contacts; reach × clamp((L_wl/rcsL)^rcsExp, rcsMin, 1)
  EYES: { day: 8000, night: 3000 },  // m within the horizon
  LOS: { step: 200, land: 3000, cell: 500 }, // a look over water samples the ground every step m within land m of land (a mask per cell m)
  AIM: { ray: 20000, zero: [100, 20000] }, // a ship's aim ray and her guns' zero
  // ---- the AI (§9.1)
  AI: { think: 4, look: 1, gunK: [0.5, 0.8], missile: [8000, 12000], ahead: [1, 2, 3], aheadMin: 300, aheadT: 25, fan: [30, 60],
        avoid: 500, err: [0.003, 0.001], walk: 0.3, torpR: 3000, torpN: 2, torpSpread: 4, torpEvery: 60, asm: [3000, 12000], asmEvery: 20,
        zig: 30, zigT: 20, retreat: 0.5, column: 600, losT: 0.5, react: [4, 1.5] }, // ([WP10] react: s after she first sees a ship before her missiles and torpedoes go, worst..best)
  NRANGE: { back: 60, gap: 30, first: 20, far: 6000, // [WP10] the Naval Range (EARTH.navalRange): a Practice ship back `back` s after it goes down; `gap` s between Hostile waves, the first `first` s in; on within r + far m of its middle
    waves: [['cyclon', 'cyclon'], ['osca', 'cyclon'], ['vizby', 'osca'], ['olivar', 'vizby'], ['arley', 'olivar', 'vizby', 'osca']] }, // (each wave's ships; the fifth's from then on, one more each wave to four)
  STRIKE: { alt: 300, low: 60, lowR: 3000, rel: 800, every: 180, max: 2, v: 210 }, // strike aircraft: run in at alt m, low for the last lowR m, release at rel m; one every `every` s, at most max; [WP10] its run at v m/s (the bombs' fall from low at v carries them about rel m)
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
      if (d.foil) { foils.push(p); if (d.foil.kind === 'rudder' || (d.foil.ride && d.foil.max)) rudders.push(p); } // ([WP6] a ride foil with a throw: its strut steers)
      if (d.steer || (d.jet && d.jet.steer)) rudders.push(p); // (an outboard turns whole, a waterjet's nozzle turns)
      if (d.engine) engines.push(p);
      if (d.deck) decks.push(p);
    }
    let big = null; // (the longest hull part: its axes are the hull's)
    for (const p of hulls) {
      const H = shullOf(p.def), o = partPt(p, 0, 0), ax = partPt(p, 1, 0), ay = partPt(p, 0, 1), z0 = partZ(p);
      const ex = { x: ax.x - o.x, y: ax.y - o.y, z: 0 }, ey = { x: ay.x - o.x, y: ay.y - o.y, z: 0 }, ci0 = comps.length, cuts = compsOf(v, p, comps); // [WP8] (its compartments: a bulkhead cuts one in two)
      const ciOf = (x) => { let k = 0; while (k < cuts.length && x > cuts[k]) k++; return ci0 + k; };
      const at = (lx, ly, lz, out, k) => { const q = partPt(p, lx, ly); out[k] = q.x; out[k + 1] = q.y; out[k + 2] = z0 + lz; };
      const S = p.def.shull;
      for (const R of H.phys) {
        const P = new Float32Array(R.K * 3), ci = ciOf(R.x);
        for (let i = 0; i < R.K; i++) at(R.x, R.P[2 * i], R.P[2 * i + 1], P, 3 * i);
        const c = partPt(p, R.x, R.yk), b = partPt(p, R.x, 0);
        const k0 = shullSec(S.st, R.x - 0.25)[1], k1 = shullSec(S.st, R.x + 0.25)[1];
        const beta = R.yk < S.wl ? Math.atan((S.wl - R.yk) / Math.max(R.bw, 0.05)) / Math.max(1, R.nb) : 0;
        rings.push({ p, ci, R, x: c.x, y: c.y, z: z0, ex, ey, P, dx: R.dx, A: R.A, cy: R.cy, bx: b.x, by: b.y, bz: z0,
          tau: Math.atan((k1 - k0) / 0.5), cb2: Math.cos(beta) ** 2, cpl: S.plane ? SHIP.planeK : SHIP.dispK, kf: S.k || 0.15, depth: Math.max(0.05, R.yd - R.yk) });
      }
      if (!big || p.def.w > big.def.w) big = p;
      for (let i = ci0; i < comps.length; i++) { const c = comps[i], a = partPt(p, c.lo, 0), b = partPt(p, c.hi, 0); c.x0 = Math.min(a.x, b.x); c.x1 = Math.max(a.x, b.x); }
    }
    carryWater(was, comps); // [WP8] (the water aboard carried over the rebuild, or a saved part's)
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
    // [WP6] each thruster's kind: a screw on the engines' shared shaft power, an outboard (a screw with its own engine:
    // it turns with the helm) or a waterjet (its nozzle turns, its bucket reverses it); an outboard's propeller sits at its
    // screw.y (own frame: none, at its foot, under the keel line), a hydrofoil at its foil.y (the foil, not the strut's
    // middle). A ride foil (foil.ride) is two halves, port and starboard (its copies' z ± depth/4, area/2 each), so the
    // ride control can roll her as well as lift her: each half carries its commanded incidence inc and its def's inc0.
    const scr = [], fl = [], at = (p, ly) => { const U = axes(p), q = ly ? partPt(p, 0, ly) : U.o; return { U, x: q.x, y: q.y }; };
    for (const p of thrust) {
      const d = p.def, kind = d.jet ? 'jet' : d.engine ? 'outboard' : 'screw', D = (d.jet || d.screw).D;
      const Q = at(p, d.screw && Number.isFinite(d.screw.y) ? d.screw.y : kind === 'outboard' ? -d.h / 2 + D / 2 : 0);
      for (const z of partZs(p)) scr.push({ p, kind, own: !!d.engine, x: Q.x, y: Q.y, z, ex: Q.U.ex, ey: Q.U.ey, D, eta: d.screw ? d.screw.eta || 0.6 : 0, T: 0 });
    }
    for (const p of foils) {
      const f = p.def.foil, Q = at(p, Number.isFinite(f.y) ? f.y : 0);
      for (const z of partZs(p)) {
        if (!f.ride) { fl.push({ p, x: Q.x, y: Q.y, z, ex: Q.U.ex, ey: Q.U.ey, f, F: 0 }); continue; }
        const dz = partDepth(p) / 4, inc0 = f.inc || 0, was0 = was && was.fl.find((o) => o.p === p && o.z === z - dz), was1 = was && was.fl.find((o) => o.p === p && o.z === z + dz);
        fl.push({ p, x: Q.x, y: Q.y, z: z - dz, ex: Q.U.ex, ey: Q.U.ey, f, F: 0, ride: true, area: (f.area || 1) / 2, inc0, inc: was0 ? was0.inc : inc0, side: -1 });
        fl.push({ p, x: Q.x, y: Q.y, z: z + dz, ex: Q.U.ex, ey: Q.U.ey, f, F: 0, ride: true, area: (f.area || 1) / 2, inc0, inc: was1 ? was1.inc : inc0, side: 1 });
        // and its struts (foil.struts of them, 1 unless said; chord foil.strutC or 0.6 of the foil's), from the foil up to the
        // part's top: skegs that hold her straight when her hull is out of the water (strut: their length)
        fl.push({ p, x: Q.x, y: Q.y, z, ex: Q.U.ex, ey: Q.U.ey, f, F: 0, strut: Math.max(0.1, p.def.h / 2 - (Number.isFinite(f.y) ? f.y : 0)), ch: f.strutC || 0.6 * (f.chord || 1), ns: f.struts || 1, steer: !!f.max });
      }
    }
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
      // [WP6] rk0: last step's keel depths (a slam: a ring entering the water fast); slam: the hull parts slammed this
      // step, [p, ratio, x, y] for Ship.frame; ride: the ride control's state (null: no ride foil aboard); x0, x1: her
      // ends along her axis (part space: Ship.bump's end test)
      rk0: new Float64Array(n), slam: [], ride: rideOf(rings, fl, ax, ay), intake: fl.some((o) => o.f.intake) ? fl.filter((o) => o.f.intake) : null, x0: Infinity, x1: -Infinity,
    };
    holesOf(v.sh); hullVol(v.sh); // [WP8] (each compartment's holes; her intact volume and plan area)
    if (was) { for (const k of ['fT', 'kT', 'capT', 'helmT', 'derT', 'bedT', 'sinkT', 'ctl0', 'derelict', 'scuttled', 'dfT', 'dc', 'deckMin']) if (was[k] != null) v.sh[k] = was[k]; if (was.dfT && was.dfT.length !== 2 * n) v.sh.dfT = null; }
    const bb = (v.sh.bb = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }); // (her hull's box in part space: Ship.bump's first look)
    for (const g of rings) for (let i = 0; i < g.R.K; i++) {
      const X = g.P[3 * i], Y = g.P[3 * i + 1], Z = g.P[3 * i + 2], s = X * ax.x + Y * ax.y;
      if (s < v.sh.x0) v.sh.x0 = s; if (s > v.sh.x1) v.sh.x1 = s;
      if (X < bb.x0) bb.x0 = X; if (X > bb.x1) bb.x1 = X; if (Y < bb.y0) bb.y0 = Y; if (Y > bb.y1) bb.y1 = Y; if (Z < bb.z0) bb.z0 = Z; if (Z > bb.z1) bb.z1 = Z;
    }
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
  // ---- ride control (§4.4) [WP6]: a hydrofoil's ride foils (foil.ride, two halves each) flown by a controller, any kind
  // (a part's behaviour, not the kind's). Below RIDE.v every half holds all the lift it has (inc0 + lim: she climbs onto
  // her foils as she gathers way); past it each half's incidence holds the keel h* over the waves (the highest foil.h
  // aboard, RIDE.h without one), led by her rise rate, trims her level (− ahead of the centre of mass, + behind) and
  // rolls her upright, or into a turn by RIDE.bank at full rudder; each half's incidence moves at most RIDE.rate °/s.
  // (iF, iA: the foremost and aftmost rings; kF, kA: how far their keel points stand over her deepest keel, along her
  // up: a stem's forefoot rises, so its clearance is read less that, as if her keel ran level at its deepest)
  function rideOf(rings, fl, ax, ay) {
    if (!fl.some((o) => o.ride)) return null;
    let iF = -1, iA = -1, sF = -Infinity, sA = Infinity, h = 0, k0 = Infinity;
    rings.forEach((g, i) => { const s = g.x * ax.x + g.y * ax.y; if (s > sF) { sF = s; iF = i; } if (s < sA) { sA = s; iA = i; } k0 = Math.min(k0, g.x * ay.x + g.y * ay.y); });
    for (const o of fl) if (o.ride) h = Math.max(h, Number.isFinite(o.f.h) ? o.f.h : SHIP.RIDE.h);
    const kOf = (i) => (i < 0 ? 0 : rings[i].x * ay.x + rings[i].y * ay.y - k0);
    return { iF, iA, L: Math.max(sF - sA, 1), h, kF: kOf(iF), kA: kOf(iA), c: 0, cF: 0, cA: 0, on: false };
  }
  const _rk = v3(), _rF = v3();
  function rideStep(v, S, dt, sim) {
    const R = S.ride, RD = SHIP.RIDE;
    if (R.iF < 0) return;
    waterOf(v, S);
    if (!(S.level > -Infinity)) return;
    const r = Math.hypot(v.x, v.y, v.z), h0 = r - v.body.radius - S.level, t = seaT(sim), ax = S.ax, com = v.com, cz = com.z || 0;
    const gF = S.rings[R.iF], gA = S.rings[R.iA];
    _rk.x = gF.x; _rk.y = gF.y; _rk.z = gF.z; const cF = -depthOf(v, S, _rk, h0, t) - R.kF;
    _rk.x = gA.x; _rk.y = gA.y; _rk.z = gA.z; const cA = -depthOf(v, S, _rk, h0, t) - R.kA;
    const c = (cF + cA) / 2, cd = v.vx * S.U.x + v.vy * S.U.y + v.vz * S.U.z, eps = (cF - cA) / R.L;
    const vb = qunrot(v.q, v.vx, v.vy, v.vz, _rk), V = vb.x * ax.x + vb.y * ax.y, sc = com.x * ax.x + com.y * ax.y;
    const lim = RD.lim, phiS = (clamp(S.rud / rudMax(S), -1, 1) * RD.bank * Math.PI) / 180, phi = v.heel || 0, k = RD.rate * dt;
    const F = qrot(v.q, ax.x, ax.y, 0, _rF), pr = v.av.x * F.x + v.av.y * F.y + v.av.z * F.z; // (her roll rate, + rolling to starboard)
    R.c = c; R.cF = cF; R.cA = cA; R.on = V >= RD.v;
    for (const o of S.fl) {
      if (!o.ride) continue;
      let want = o.inc0 + lim;
      if (R.on) { // (scheduled by the dynamic pressure past vRef: at twice it a degree lifts four times as much)
        const ahead = o.x * ax.x + o.y * ax.y > sc ? 1 : -1, g = clamp((RD.vRef / Math.max(V, 1)) ** 2, 0.2, 1);
        want = g * (o.inc0 + clamp(RD.kh * (R.h - c) - RD.kv * cd - ahead * RD.kt * eps, -lim, lim) + clamp((RD.kphi * (phi - phiS) + RD.kp * pr) * o.side, -lim, lim));
      }
      o.inc += clamp(want - o.inc, -k, k);
    }
  }
  // how deep the deepest intake foil aboard runs (m; −Infinity: none in the water) [WP6]
  function intakeDepth(v, S, h0, t) {
    let d = -Infinity;
    for (const o of S.intake) { if (o.p.broken || !v.byId.has(o.p.id)) continue; _rk.x = o.x; _rk.y = o.y; _rk.z = o.z; d = Math.max(d, depthOf(v, S, _rk, h0, t)); }
    return d;
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
    const fb = S.ride && S.ride.on ? SHIP.RIDE.steer : 1; // ([WP6] foilborne: a share of the throw, her banked turn does the rest)
    for (const p of S.rudders) {
      const m = (p.def.foil ? p.def.foil.max || 35 : p.def.steer || (p.def.jet && p.def.jet.steer) || 30) * fb, now = Number.isFinite(p.rud) ? p.rud : 0;
      p.rud = now + clamp(clamp(S.rud, -m, m) - now, -rr, rr);
    }
    if (S.ride) rideStep(v, S, dt, sim); // [WP6]
  }
  // the shaft power the working engines give (W): a damaged one less (Combat.engineK, as Gear's), none with no one at the helm
  // (an engine that is its own thruster's, an outboard's, isn't in the pool: [WP6] ownPower)
  function shaftPower(v, S) {
    let P = 0;
    const cb = typeof Combat !== 'undefined';
    for (const p of S.engines) if (!p.broken && v.byId.has(p.id) && !p.def.screw && !p.def.jet && !(S.wet && S.wet.has(p))) P += p.def.engine.kw * 1000 * (cb && p.hp != null ? Combat.engineK(p) : 1); // ([WP8] an engine under her flood water gives nothing: wetAt)
    if (P > 0 && v.gv && typeof Armour !== 'undefined' && !Armour.has(v, 'driver')) P = 0;
    return P;
  }
  // an outboard's own engine's power (W), as the pool's rules have it [WP6]
  function ownPower(v, p) {
    let P = p.def.engine.kw * 1000 * (typeof Combat !== 'undefined' && p.hp != null ? Combat.engineK(p) : 1);
    if (v.gv && typeof Armour !== 'undefined' && !Armour.has(v, 'driver')) P = 0;
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
    let B = 0, Awp = 0, Vol = 0, Swet = 0, kmax = 0, lo = Infinity, hi = -Infinity, Mx = 0, My = 0, Mz = 0, Ny = 0, Nz = 0;
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
      { const wn = Math.hypot(Wx, Wy, Wz) || 1; _f.x = (Wx / wn) * Fb; _f.y = (Wy / wn) * Fb; _f.z = (Wz / wn) * Fb; Ny += _f.x * S.ay.x + _f.y * S.ay.y; Nz += _f.z; } // [WP5] along the wave surface's normal (the pressure gradient: Froude-Krylov), not the plain vertical: a small boat then lies with the wave slope instead of rolling past it (beam-on in Moderate: 13.6° → 8° significant)
      push(v, _c, _f);
      B += Fb; Mx += Fb * _c.x; My += Fb * _c.y; Mz += Fb * _c.z;
      Awp += chord * g.dx; Vol += a * g.dx; Swet += girth * g.dx;
      if (k > kmax) kmax = k;
      if (chord > 0) { const s = _c.x * S.ax.x + _c.y * S.ax.y; if (s - g.dx / 2 < lo) lo = s - g.dx / 2; if (s + g.dx / 2 > hi) hi = s + g.dx / 2; }
    }
    S.B = B; S.Swet = Swet; S.Vol = Vol; S.Awp = Awp; S.kmax = kmax;
    S.hw = B > 0 ? Math.atan2(-Nz, Ny) : 0; // (her heel against the water's surface under her, the buoyancy's mean normal: in still water her heel)
    if (hi > lo) { S.Lwl = hi - lo; S.wlF = hi; } else if (!(B > 0)) S.Lwl = 0;
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
    S.rk0.set(S.rk); // [WP6] (last step's keel depths: a ring meeting the water)
    const B = buoy(v, S, h0, t, gl, false), Ub = S.Ub;
    S.fsub = clamp(B / Math.max(W, 1), 0, 1);
    v.afloat = B > 0.05 * W;
    v.draft = S.kmax;
    const upA = Ub.x * S.ay.x + Ub.y * S.ay.y;
    v.heel = Math.atan2(-Ub.z, upA); v.trim = Math.atan2(-(Ub.x * S.ax.x + Ub.y * S.ax.y), upA); // (+: starboard down, bow down)
    // her metacentric height now: the buoyancy's righting moment (all of hT so far) over B·sin(heel), every STAB_T s
    S.gmT += dt;
    // (heeled against the water under her, not the vertical: the buoyancy pushes along the waves' normal, so a small boat
    // lying with a wave's slope has nothing to right; against the vertical her GM read a fifth of itself in a calm sea)
    if (S.gmT >= SHIP.STAB_T && Math.abs(S.hw) > (SHIP.STAB_HEEL * Math.PI) / 180 && v.afloat) {
      S.gmT = 0;
      const gm = -(hT.x * S.ax.x + hT.y * S.ax.y) / (B * Math.sin(S.hw));
      if (Number.isFinite(gm)) S.gm = clamp(gm, -20, 50);
    }
    // (the flood water's weight: WP8's floodStep keeps comps[].W, and its force joins here)
    floodForce(v, S, gl, vb, dt); // [WP8]
    if (!S.rings.length) { if (v.mass < SHIP.TINY && !S.scuttle) tiny(v, S, dt, vb, wb, h0, t, gl, W); else sink(v, S, dt, vb, wb, h0, t); return; } // [WP6] (a tiny piece floats as a box)
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
    const Rw = S.B * cwr(V / Math.sqrt(gl * Lwl)) * (S.cw || (S.cw = cwOf(S.hulls))), Tb = Math.max(S.Tbar || 0.1, 0.1); // (× a blunt hull's shull.cw, §4.12: the landing craft's ramp bow; once, as the builder's resistance() has it)
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
      // ([WP6] the quadratic heave drag only for a bottom pressed into the water: one drawn away from it (rising, or a bow
      // trimmed down at speed: its bottom running away from the flow) separates, and the water doesn't suck it down)
      const Fd = capF((-q * SHIP.heaveCd * (uy < 0 ? -uy * uy : 0) - heaveL * uy) * b * dx * fin, uy, effMass(v, _c, _n) * share, cap);
      const wpl = planeW((S.wlF - (_c.x * ax.x + _c.y * ax.y)) / Lwl); // (the planing lift's share here: SHIP.planeCP)
      const Fv = q * g.cpl * Math.max(0, Vn) * Math.abs(ua) * b * dx * g.cb2 * fin * wpl + Fd;
      const Fa = capF(-Math.sign(ua) * q * ua * ua * S.rg[i] * dx * Cf * (1 + g.kf) - Math.sign(Vx) * Rw * share, ua, effMass(v, _c, ex) * share, cap);
      // [WP6] a slam: the ring was clear of the water last step and meets it now faster than SLAM.k × its part's limit
      if (S.rk0[i] === 0 && uy < 0) { const lim = SHIP.SLAM.k * (g.p.def.breakSpeed || DEFAULT_BREAK_SPEED); if (-uy > lim && !S.slam.some((o) => o[0] === g.p)) S.slam.push([g.p, -uy / lim, _c.x, _c.y, -uy]); }
      _f.x = ex.x * Fa + _n.x * Fv; _f.y = ex.y * Fa + _n.y * Fv; _f.z = Fl + _n.z * Fv;
      push(v, _c, _f);
    }
    // roll damping about the hull's axis, in its exponential form (it never overshoots)
    const I = v.I, Iaa = Math.max(1, ax.x * ax.x * I.xx + 2 * ax.x * ax.y * I.xy + ax.y * ax.y * I.yy), p = wb.x * ax.x + wb.y * ax.y;
    const om = Math.sqrt(Math.max(W * S.gm, 1) / (Iaa * (1 + SHIP.ADD_I.x))), z = SHIP.rollZeta + rollBk(S) + SHIP.rollZV * Math.min(V / Math.sqrt(gl * Lwl), 1.5);
    // (× the share of her weight the water carries: [WP6] its dynamic lift too, so a boat on the plane keeps her roll damping)
    const wet = Math.max(S.fsub, clamp((v.hF.x * Ub.x + v.hF.y * Ub.y + v.hF.z * Ub.z) / Math.max(W, 1), 0, 1));
    const M = ((-Iaa * p * (1 - Math.exp(-2 * z * om * dt))) / dt) * wet;
    v.hT.x += ax.x * M; v.hT.y += ax.y * M;
  }
  // A hydrofoil's (and its strut's) cavitation: past its inception (the cavitation number σ = (p_atm + ρ·g·depth − p_v)/q
  // under FOIL.sig) the water boils off its back and its drag climbs, FOIL.cav·(sig/σ − 1): steeply, so a subcavitating
  // foil tops out about 50 kn whatever the power (a real hydrofoil's limit; without it the Pegazus' 20 MW flew her at 83)
  function cavCd(U2, dep) {
    const FO = SHIP.FOIL, sg = (FO.p0 + SHIP.RHO * G0 * Math.max(0, dep) - FO.pv) / (0.5 * SHIP.RHO * Math.max(U2, 1e-6));
    return sg < FO.sig ? FO.cav * (FO.sig / sg - 1) : 0;
  }
  // the planing lift's weight at ξ along the waterline (0 its fore end, 1 its aft end): (n + 1)·(1 − ξ)^n, 1 on average
  function planeW(xi) { const n = SHIP.planeCP; return n > 0 && xi === xi ? (n + 1) * (1 - clamp(xi, 0, 1)) ** n : 1; } // (no waterline yet, all of her under: an even share)
  function rollBk(S) { let k = 0; for (const p of S.hulls) if (p.def.shull.bk) k = Math.max(k, p.def.shull.bk === true ? SHIP.bilgeKeel : +p.def.shull.bk || 0); return k; }
  // §4.4-4.5: screws from the shaft power, and the foils (rudders, skegs, fixed hydrofoils) at water density: never the
  // wings' code (water is ~850× denser than air: its deflection caps, load ratings, flutter and strain would all break)
  function propel(v, S, dt, vb, wb, h0, t, wet) {
    const rho = SHIP.RHO, q = 0.5 * rho, SC = SHIP.SCREW, J = SHIP.JET, dem = S.pow;
    let live = 0, intake = NaN;
    for (const s of S.scr) if (!s.own && !s.p.broken && v.byId.has(s.p.id)) live++;
    const each = live ? (shaftPower(v, S) * Math.abs(dem)) / live : 0, dir = dem >= 0 ? 1 : -1;
    let Tsum = 0;
    for (const s of S.scr) {
      const p = s.p, jet = s.kind === 'jet';
      s.T = 0;
      if (p.broken || !v.byId.has(p.id)) { p.rpm = 0; continue; }
      p.rpm = (dir * SC.rpm * Math.sqrt(Math.abs(dem))) / s.D; // (+ ahead, − astern: the art spins it)
      _c.x = s.x; _c.y = s.y; _c.z = s.z;
      let sub = smoothstep(0, SC.sub * s.D, depthOf(v, S, _c, h0, t)); // (out of the water it races and pushes nothing)
      if (jet && S.intake) { if (intake !== intake) intake = intakeDepth(v, S, h0, t); sub = Math.max(sub, smoothstep(0, SC.sub * s.D, intake)); } // [WP6] (foilborne a waterjet drinks through the main foil's pod)
      if (sub <= 0) continue;
      pointU(v, vb, wb, _c, _u);
      if (!jet) { // its shaft and brackets' drag, turning or not
        const U = Math.hypot(_u.x, _u.y, _u.z), k = q * SC.app * s.D * s.D * U * sub;
        _f.x = -k * _u.x; _f.y = -k * _u.y; _f.z = -k * _u.z;
        push(v, _c, _f);
      }
      if (s.kind === 'screw') {
        if (!(each > 0)) continue;
        const T0 = SC.k0 * Math.cbrt(2 * rho * ((Math.PI * s.D * s.D) / 4) * each * each), Va = SC.va * dir * (_u.x * s.ex.x + _u.y * s.ex.y);
        const T = Math.min(T0, (s.eta * each) / Math.max(Va, SC.vmin)) * sub * (dir < 0 ? p.def.screw.astern || SHIP.ASTERN : 1);
        s.T = dir * T; Tsum += T;
        _f.x = s.ex.x * s.T; _f.y = s.ex.y * s.T; _f.z = 0;
        push(v, _c, _f);
        continue;
      }
      // [WP6] an outboard (its own engine; it turns whole with the helm) or a waterjet (the pool's power, or its own
      // engine's; its nozzle turns, and astern its bucket throws the jet forward: −bucket of the thrust, no ASTERN)
      const P = s.own ? ownPower(v, p) * Math.abs(dem) : each;
      if (!(P > 0)) continue;
      const T0 = SC.k0 * Math.cbrt(2 * rho * ((Math.PI * s.D * s.D) / 4) * P * P), ua = _u.x * s.ex.x + _u.y * s.ex.y;
      let T;
      if (jet) { const V = Math.abs(ua); T = Math.min(J.t0 * T0, ((J.eta0 + J.eta1 * smoothstep(J.v0, J.v1, V)) * P) / Math.max(V, SC.vmin)) * sub * (dir < 0 ? p.def.jet.bucket || J.bucket : 1); }
      else T = Math.min(T0, (s.eta * P) / Math.max(SC.va * dir * ua, SC.vmin)) * sub * (dir < 0 ? p.def.screw.astern || SHIP.ASTERN : 1);
      // the thrust turned about the part's own y by p.rud (+: her stern pushed to port, a turn to starboard: as a rudder's chord)
      const th = ((p.rud || 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
      s.T = dir * T; Tsum += T;
      _f.x = s.ex.x * cs * s.T; _f.y = s.ex.y * cs * s.T; _f.z = (s.ey.x * s.ex.y - s.ey.y * s.ex.x) * sn * s.T;
      push(v, _c, _f);
    }
    S.T = Tsum;
    if (!wet && !S.ride) return; // ([WP6] a hydrofoil flies with her hull clear of the water: her foils still in it)
    const FO = SHIP.FOIL, as = (FO.stall * Math.PI) / 180, post = (FO.post * Math.PI) / 180;
    for (const o of S.fl) {
      const p = o.p, f = o.f;
      o.F = 0;
      if (p.broken || !v.byId.has(p.id)) continue;
      _c.x = o.x; _c.y = o.y; _c.z = o.z;
      let s, area = o.ride ? o.area : f.area || 1, ar = f.ar || 2, dep;
      if (o.strut) { // [WP6] a hydrofoil's strut: a skeg as deep as it is in the water, its force halfway up that
        const imm = clamp(depthOf(v, S, _c, h0, t), 0, o.strut);
        if (imm < 0.05) continue;
        area = o.ch * imm * o.ns; ar = Math.max(0.5, imm / o.ch); s = 1; dep = imm * 0.5;
        _c.x += o.ey.x * imm * 0.5; _c.y += o.ey.y * imm * 0.5;
      } else { dep = depthOf(v, S, _c, h0, t); s = smoothstep(0, FO.sub * (f.chord || 1), dep); } // (a foil that surfaces loses its lift)
      if (s <= 0) continue;
      pointU(v, vb, wb, _c, _u);
      // a rudder in the slipstream of a screw just ahead of it (pushing ahead): it steers her at low speed
      if (f.kind === 'rudder') for (const sc of S.scr) {
        if (!(sc.T > 0) || sc.kind === 'jet') continue; // (a waterjet makes no slipstream for a rudder)
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
      if (f.n === 'y' && !o.strut) {
        const inc = ((o.ride ? o.inc : f.inc || 0) * Math.PI) / 180, ci = Math.cos(inc), si = Math.sin(inc);
        cx = o.ex.x * ci + o.ey.x * si; cy = o.ex.y * ci + o.ey.y * si; cz = 0;
        nx = o.ey.x * ci - o.ex.x * si; ny = o.ey.y * ci - o.ex.y * si; nz = 0;
      } else {
        // (a steering strut ahead of her centre of mass turns the other way: a bow rudder's trailing edge to port turns her to starboard)
        const fore = o.steer && (o.x - v.com.x) * S.ax.x + (o.y - v.com.y) * S.ax.y > 0 ? -1 : 1;
        const th = (((f.kind === 'rudder' && !o.strut) || o.steer ? fore * (p.rud || 0) : 0) * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
        nx = o.ey.y * sn; ny = -o.ey.x * sn; nz = cs; // (ez·cos + (ey × ez)·sin)
        cx = o.ex.x * cs; cy = o.ex.y * cs; cz = (o.ey.x * o.ex.y - o.ey.y * o.ex.x) * sn; // (ex·cos + (ey × ex)·sin)
      }
      const U2 = _u.x * _u.x + _u.y * _u.y + _u.z * _u.z;
      if (U2 < 1e-6) continue;
      const Um = Math.sqrt(U2), hx = _u.x / Um, hy = _u.y / Um, hz = _u.z / Um;
      const uc = _u.x * cx + _u.y * cy + _u.z * cz, un = _u.x * nx + _u.y * ny + _u.z * nz;
      // the angle of attack (+: it pushes along its normal); going astern the flow meets it from behind, weaker
      const al = Math.atan2(-un, uc), aa = Math.abs(al), back = aa > Math.PI / 2, ae = back ? Math.PI - aa : aa;
      const slope = (FO.slope * 2 * Math.PI * ar) / (ar + 2), stalled = ae > as;
      const CL = Math.sign(al) * (back ? 0.7 : 1) * (stalled ? slope * as * Math.max(FO.postMin, 1 - (ae - as) / post) : slope * ae);
      const CD = FO.cd0 + (CL * CL) / (FO.e * Math.PI * ar) + (stalled ? FO.stallCd * Math.sin(al) ** 2 : 0) + (f.kind === 'foil' ? cavCd(U2, dep) : 0);
      const qs = q * U2 * area * s, dn = nx * hx + ny * hy + nz * hz;
      let lx = nx - dn * hx, ly = ny - dn * hy, lz = nz - dn * hz;
      const ll = Math.hypot(lx, ly, lz) || 1;
      lx /= ll; ly /= ll; lz /= ll;
      _f.x = qs * (CL * lx - CD * hx); _f.y = qs * (CL * ly - CD * hy); _f.z = qs * (CL * lz - CD * hz);
      o.F = Math.hypot(_f.x, _f.y, _f.z);
      push(v, _c, _f);
      // past its load a foil strains; past FOIL.brk × it, it breaks off (queued as a wing's rip is)
      if (f.load && !o.strut) {
        const k = (o.ride ? 2 * o.F : o.F) / (f.load * 1000); // (a ride foil's half carries half its load)
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
  // [WP6] A tiny hull-less piece (under TINY kg: a mast, a gun shield, a raft of junk) floats as a box: its parts' boxes ×
  // TINY_FILL of water held up by its submerged share (from its centre's depth over its box's height), its motion and spin
  // through the water damped e^(−TINY_DAMP·dt). Lighter than that much water, it floats; until it is junk (Ship.frame
  // scuttles it after SEA.float s adrift: sh.scuttle) and sinks as the heavy ones do.
  function tiny(v, S, dt, vb, wb, h0, t, gl, W) {
    if (!(S.box > 0)) { let V = 0; for (const p of v.parts) { const d = partDims(p); V += d.w * d.h * partDepth(p) * partZs(p).length; } S.box = Math.max(V, 1e-3); }
    const hh = Math.cbrt(S.box) / 2, dep = depthOf(v, S, v.com, h0, t), k = clamp((dep + hh) / (2 * hh), 0, 1);
    const B = SHIP.RHO * gl * S.box * SHIP.TINY_FILL * k;
    S.B = B; S.fsub = clamp(B / Math.max(W, 1e-6), 0, 1); v.afloat = B > 0.05 * W; v.draft = Math.max(0, dep + hh);
    if (k <= 0) return;
    const Ub = S.Ub, hF = v.hF, hT = v.hT, d = ((1 - Math.exp(-SHIP.TINY_DAMP * dt)) / dt) * k, Iw = v.mulI(wb, _w);
    hF.x += Ub.x * B - v.mass * vb.x * d; hF.y += Ub.y * B - v.mass * vb.y * d; hF.z += Ub.z * B - v.mass * vb.z * d;
    hT.x -= Iw.x * d; hT.y -= Iw.y * d; hT.z -= Iw.z * d;
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
      if (v === F.active || !v.afloat || v.landed || S.tel !== 0 || S.T > 0 || (v.thrust || 0) > 0 || v.speed() > M.v || v.fate) { S.moorT = 0; continue; } // ([WP8] a doomed ship goes down: never moored)
      S.moorT += dt;
      if (S.moorT >= M.t) moor(v, F);
    }
  }

  // ---- hulls meeting things: groundings, slams, other ships, carriers (§4.8) [WP6]
  // a hull part's hp (its def's, as Combat.maxHp has it)
  function hpOf(p) { return p.def.hp || (typeof Combat !== 'undefined' && Combat.maxHp ? Combat.maxHp(p.def) : 1000); }
  // a hull part holed and kept by a grounding or a slam: IMPACT.hp of its hp, and a hole of IMPACT.hole m² for each m/s
  // over its limit where it struck (addHoles: the damage package's; a no-op until it lands). h: { s, lim, x, y } or none
  function holeHull(v, p, h, sim, slam) {
    let k = SHIP.IMPACT.hp * hpOf(p);
    if (slam) { k = Math.min(k, (p.hp ?? hpOf(p)) - SHIP.SLAM.floor * hpOf(p)); if (!(k > 0)) return; } // ([WP8] the sea alone never sinks her: a slam's hp stop at SLAM.floor of the hull's, and a hull there takes no more)
    if (typeof Combat !== 'undefined' && sim && sim.vessels) Combat.damage(v, p, k, 'crash', sim);
    if (h && h.s > h.lim && v.parts.includes(p)) Ship.addHoles(v, [[p, h.x, h.y, slam ? Math.min(SHIP.SLAM.hole, SHIP.IMPACT.hole * (h.s - h.lim)) : SHIP.IMPACT.hole * (h.s - h.lim)]]); // ([WP8] a slam's a crack: SLAM.hole at most)
  }
  // A crash's broken parts (Death.impact's first line, for v.sh): its hull parts are holed and kept unless the contact
  // was past IMPACT.remove × their limit (vessel.js ground() and Gear.ground keep, for a hydro vessel, each broken part's
  // worst contact: v._bedHit, part -> { r: speed ÷ limit, s, lim, x, y }); the rest (masts, guns, rotors) break as ever
  function impactSea(v, parts, sim) {
    if (!v || !v.sh || !Array.isArray(parts)) return parts;
    const H = v._bedHit, out = [];
    for (const p of parts) {
      const h = H && H.get(p);
      if (!p.def.shull || (h && h.r > SHIP.IMPACT.remove)) out.push(p);
      else holeHull(v, p, h, sim);
    }
    if (H) H.clear();
    return out;
  }
  // a hydro vessel's slams this step (forces queues them on sh.slam): holed and kept, or past IMPACT.remove torn off
  function slams(F, v) {
    const L = v.sh.slam, rip = [];
    for (const [p, r, x, y, s] of L) {
      if (!v.parts.includes(p)) continue;
      if (r > SHIP.IMPACT.remove) rip.push(p);
      else holeHull(v, p, { s, lim: s / r, x, y }, F, true);
    }
    L.length = 0;
    if (rip.length && F.breakParts && !v.dead) F.breakParts(v, rip, 'slam');
  }

  // a section's [yd, yk, bd, bw, nb] at x into o (shullSec's, without its arrays)
  const SEC = [0, 0, 0, 0, 0];
  function secAt(st, x, o) {
    let a = st[0], b = st[0], k = 0;
    if (x > st[0][0]) {
      b = st[st.length - 1];
      for (let i = 1; i < st.length; i++) if (x <= st[i][0]) { a = st[i - 1]; b = st[i]; k = b[0] > a[0] ? (x - a[0]) / (b[0] - a[0]) : 0; break; }
      if (x > b[0]) a = b;
    }
    for (let j = 0; j < 5; j++) o[j] = a[j + 1] + (b[j + 1] - a[j + 1]) * k;
    return o;
  }
  // Where a part-space point X lies against her hull: null outside; else IH = { p (the hull part), pen (m), n (part
  // space, out of her: the way out that is nearest: through her side, her deck, her bottom or past her ends) }. Each
  // hull part's own section at X's station (the same superellipse and topsides shullOf samples), X in its own frame.
  const IH = { p: null, pen: 0, n: v3() };
  function insideHull(v, X) {
    const S = v && v.sh, B = S && S.bb;
    if (!S || !B || X.x < B.x0 || X.x > B.x1 || X.y < B.y0 || X.y > B.y1 || X.z < B.z0 || X.z > B.z1) return null;
    let best = null;
    for (const p of S.hulls) {
      const d = p.def, sh = d.shull, H = shullOf(d), dx = X.x - p.x, dy = X.y - p.y;
      let lx, ly;
      switch (p.rot & 3) { case 1: lx = dy; ly = -dx; break; case 2: lx = -dx; ly = -dy; break; case 3: lx = -dy; ly = dx; break; default: lx = dx; ly = dy; }
      if (lx < H.x0 || lx > H.x1) continue;
      secAt(sh.st, lx, SEC);
      const yd = SEC[0], yk = SEC[1], bd = SEC[2], bw = SEC[3], nb = SEC[4], wl = sh.wl;
      if (ly <= yk || ly >= yd) continue;
      let half;
      if (yk < wl && ly < wl) { const u = (wl - ly) / (wl - yk); half = bw * Math.pow(Math.max(0, 1 - Math.pow(u, nb)), 1 / nb); }
      else if (yk < wl) half = yd > wl ? bw + ((bd - bw) * (ly - wl)) / (yd - wl) : bw;
      else { const b0 = yd > wl ? bw + ((bd - bw) * (yk - wl)) / (yd - wl) : bw; half = b0 + ((bd - b0) * (ly - yk)) / Math.max(yd - yk, 1e-6); }
      for (const z0 of partZs(p)) {
        const lz = X.z - z0, side = half - Math.abs(lz);
        if (side <= 0) continue;
        const s = X.x * S.ax.x + X.y * S.ax.y, fore = S.x1 - s, aft = s - S.x0, up = yd - ly, down = ly - yk;
        let pen = side, k = 0;
        if (up < pen) { pen = up; k = 1; }
        if (down < pen) { pen = down; k = 2; }
        if (fore < pen) { pen = fore; k = 3; }
        if (aft < pen) { pen = aft; k = 4; }
        if (best && pen <= best.pen) continue;
        best = IH; IH.p = p; IH.pen = pen;
        const n = IH.n;
        if (k === 0) { n.x = 0; n.y = 0; n.z = lz < 0 ? -1 : 1; }
        else if (k === 3 || k === 4) { const g = k === 3 ? 1 : -1; n.x = S.ax.x * g; n.y = S.ax.y * g; n.z = 0; }
        else { const g = k === 1 ? 1 : -1, u = partPt(p, 0, 1); n.x = (u.x - p.x) * g; n.y = (u.y - p.y) * g; n.z = 0; }
      }
    }
    return best;
  }

  // Ship.bump (Ship.frame, once a frame): every pair of hydro vessels within reach of each other (ghosts in a room too:
  // S10), each hydro vessel against the other craft (their hull points) and the carriers (boxes from the deck down to
  // CARRIER_DEPTH under the sea). The deepest point of either inside the other's hull is the contact: a closing impulse
  // (restitution BUMP.e), the two pushed apart (BUMP.push of it each; all of it to ours against a ghost or a carrier: a
  // ghost is never moved or hurt here, its owner runs this on their screen), and past BUMP.v closing each side's touching
  // part takes BUMP.dmg·μ·s²/1000 hp and its hull a hole of BUMP.hole·s² m² (μ the reduced mass at the contact, kg).
  const BV = [], BC = { P: v3(), n: v3(), pen: 0, pa: null, pb: null, xa: 0, ya: 0, xb: 0, yb: 0 }, _bX = v3(), _bW = v3(), _bS = v3(), _bI = v3(), _bO = v3(), _bQ = quat(), _bQ2 = quat();
  function bump(F) {
    const list = F && F.vessels;
    if (!list) return;
    BV.length = 0;
    for (const v of list) if (v.sh && !v.dead && !v.lash && v.parts.length && v.body) BV.push(v);
    for (let i = 0; i < BV.length; i++) {
      const A = BV[i];
      for (let j = i + 1; j < BV.length; j++) { const B = BV[j]; if (!(A.remote && B.remote) && near(A, B)) pairHit(A, B, F); }
      if (A.remote) continue;
      for (const o of list) if (!o.sh && !o.dead && !o.lash && o.parts.length && o.body === A.body && o.hull && o.hull.length && near(A, o)) pairHit(A, o, F);
      if (A.body === EARTH && EARTH.carriers) carriers(A, F);
    }
  }
  function near(A, B) { const r = A.reach + B.reach; return A.body === B.body && (A.x - B.x) ** 2 + (A.y - B.y) ** 2 + (A.z - B.z) ** 2 < r * r; }
  // the world point (sim, absolute) of part-space (x, y, z) on v, into o; and back
  function worldOf(v, x, y, z, o) { const c = v.com; qrot(v.q, x - c.x, y - c.y, z - (c.z || 0), o); o.x += v.x; o.y += v.y; o.z += v.z; return o; }
  function localOf(v, P, o) { const c = v.com; qunrot(v.q, P.x - v.x, P.y - v.y, P.z - v.z, o); o.x += c.x; o.y += c.y; o.z += c.z || 0; return o; }
  // each test point of v (part space) to fn(x, y, z, part): a hydro vessel's rings' waterline points and deck edges, any
  // other craft's hull points
  const RP = [6, 7, SHULL_K - 7, SHULL_K - 6]; // (a ring's port waterline point and deck edge, then the starboard deck edge and waterline point)
  function eachPt(v, fn) {
    if (v.sh) { for (const g of v.sh.rings) for (const i of RP) fn(g.P[3 * i], g.P[3 * i + 1], g.P[3 * i + 2], g.p); }
    else for (const k of v.hull) fn(k.x, k.y, k.z, k.p);
  }
  // the deepest point of B inside A (and of A inside B, if B floats): BC (n from A into B), or null
  function contactOf(A, B) {
    let best = 0;
    const one = (S, T, flip) => {
      // (T's part space into S's: one relative turn, q = S⁻¹·T, and an offset, for every point)
      const q = qmul(qconj(S.q, _bQ), T.q, _bQ2), sc = S.com, tc = T.com;
      qunrot(S.q, T.x - S.x, T.y - S.y, T.z - S.z, _bO);
      eachPt(T, (x, y, z, part) => {
      qrot(q, x - tc.x, y - tc.y, z - (tc.z || 0), _bX); _bX.x += _bO.x + sc.x; _bX.y += _bO.y + sc.y; _bX.z += _bO.z + (sc.z || 0);
      const h = insideHull(S, _bX);
      if (!h || h.pen <= best) return;
      worldOf(S, _bX.x, _bX.y, _bX.z, _bW);
      best = h.pen; BC.pen = h.pen; BC.P.x = _bW.x; BC.P.y = _bW.y; BC.P.z = _bW.z;
      qrot(S.q, h.n.x, h.n.y, h.n.z, BC.n);
      if (flip) { BC.n.x = -BC.n.x; BC.n.y = -BC.n.y; BC.n.z = -BC.n.z; BC.pa = part; BC.pb = h.p; BC.xa = x; BC.ya = y; BC.xb = _bX.x; BC.yb = _bX.y; }
      else { BC.pa = h.p; BC.pb = part; BC.xa = _bX.x; BC.ya = _bX.y; BC.xb = x; BC.yb = y; }
      });
    };
    one(A, B, false);
    if (B.sh) one(B, A, true);
    return best > 0 ? BC : null;
  }
  function pairHit(A, B, F) { const C = contactOf(A, B); if (C) resolve(A, B, C, F); }
  // 1/(effective mass) of v at world offset r along unit n (sim axes)
  function effInv(v, r, n) { cross3(r, n, _bS); v.invIWorld(_bS, _bI); cross3(_bI, r, _bS); return 1 / v.mass + dot3(_bS, n); }
  // the contact C between A and B (B null: a carrier, immovable): impulse, push-out, damage
  function resolve(A, B, C, F) {
    const n = C.n, P = C.P, fixA = !!A.remote, fixB = !B || !!B.remote;
    if (fixA && fixB) return;
    const rA = v3(P.x - A.x, P.y - A.y, P.z - A.z), vA = A.pointVel(rA, v3()), kA = effInv(A, rA, n);
    let vn = -dot3(vA, n), kB = 0, rB = null;
    if (B) { rB = v3(P.x - B.x, P.y - B.y, P.z - B.z); const vB = B.pointVel(rB, v3()); vn += dot3(vB, n); kB = effInv(B, rB, n); }
    const ka = fixA ? 0 : kA, kb = fixB ? 0 : kB;
    if (vn < 0) { // closing: an impulse j along n on B, −j on A, once a pair a frame
      const j = (-(1 + SHIP.BUMP.e) * vn) / (ka + kb);
      if (!fixA) push3(A, rA, n, -j);
      if (!fixB) push3(B, rB, n, j);
    }
    // apart: half the penetration each, or all of it to the one that moves
    const sa = fixA ? 0 : fixB ? 1 : SHIP.BUMP.push, sb = fixB ? 0 : fixA ? 1 : SHIP.BUMP.push;
    if (sa) { A.x -= n.x * C.pen * sa; A.y -= n.y * C.pen * sa; A.z -= n.z * C.pen * sa; }
    if (sb) { B.x += n.x * C.pen * sb; B.y += n.y * C.pen * sb; B.z += n.z * C.pen * sb; }
    if (A.moored) unmoor(A);
    if (B && B.moored) unmoor(B);
    const s = -vn;
    if (!(s > SHIP.BUMP.v) || typeof Combat === 'undefined' || !F.vessels) return;
    const mu = 1 / (kA + kB), dmg = (SHIP.BUMP.dmg * mu * s * s) / 1000, hole = SHIP.BUMP.hole * s * s;
    if (!fixB && C.pb) { if (C.pb.def.shull && B.sh) Ship.addHoles(B, [[C.pb, C.xb, C.yb, hole]]); Combat.damage(B, C.pb, dmg, 'crash', F, A); }
    if (!fixA && C.pa) { if (C.pa.def.shull) Ship.addHoles(A, [[C.pa, C.xa, C.ya, hole]]); Combat.damage(A, C.pa, dmg, 'crash', F, B || undefined); }
  }
  function push3(v, r, n, j) {
    const im = j / v.mass;
    v.vx += n.x * im; v.vy += n.y * im; v.vz += n.z * im;
    cross3(r, n, _bS); v.invIWorld(_bS, _bI);
    v.av.x += _bI.x * j; v.av.y += _bI.y * j; v.av.z += _bI.z * j;
  }
  // a hydro vessel against the carriers' hulls: boxes ±hl × ±hw along each one's yaw, from its deck down to CARRIER_DEPTH
  // under the sea; her rings' points tested in the carrier's (east, south, up) from her own frame at her centre
  function carriers(A, F) {
    const S = A.sh, C = EARTH.carriers;
    if (!(S.U.x || S.U.y || S.U.z)) frameOf(A, S);
    let best = 0, bC = null;
    const R = EARTH.radius, h0 = Math.hypot(A.x, A.y, A.z) - R, ze = -S.n0;
    for (const k in C) {
      const d = C[k], de0 = S.e0 - d.e, dz0 = ze - d.z, m = d.hl + A.reach + 10;
      if (Math.abs(de0) > m || Math.abs(dz0) > m) continue;
      eachPt(A, (x, y, z) => {
        worldOf(A, x, y, z, _bW);
        const ox = _bW.x - A.x, oy = _bW.y - A.y, oz = _bW.z - A.z;
        const de = de0 + ox * S.E.x + oy * S.E.y + oz * S.E.z, dz = dz0 - (ox * S.N.x + oy * S.N.y + oz * S.N.z), h = h0 + ox * S.U.x + oy * S.U.y + oz * S.U.z;
        if (h > d.deck || h < -SHIP.CARRIER_DEPTH) return;
        const u = de * d.c + dz * d.s, w = -de * d.s + dz * d.c, pu = d.hl - Math.abs(u), pw = d.hw - Math.abs(w);
        if (pu <= 0 || pw <= 0) return;
        const pen = Math.min(pu, pw);
        if (pen <= best) return;
        best = pen; bC = BC;
        // the carrier's outward normal at the point, (e, z) -> sim: e along E, z (game south) along −N
        let ne, nz;
        if (pu < pw) { const g = u < 0 ? -1 : 1; ne = d.c * g; nz = d.s * g; } else { const g = w < 0 ? -1 : 1; ne = -d.s * g; nz = d.c * g; }
        BC.n.x = -(ne * S.E.x - nz * S.N.x); BC.n.y = -(ne * S.E.y - nz * S.N.y); BC.n.z = -(ne * S.E.z - nz * S.N.z); // (from her into the carrier)
        BC.pen = pen; BC.P.x = _bW.x; BC.P.y = _bW.y; BC.P.z = _bW.z;
        const L = localOf(A, _bW, _bX), hh = insideHull(A, L);
        BC.pa = hh ? hh.p : null; BC.xa = L.x; BC.ya = L.y; BC.pb = null;
      });
    }
    if (bC) { if (!bC.pa) bC.pa = S.hulls[0] || null; resolve(A, null, bC, F); }
  }

  // ---- decks and lashing (§4.8) [WP6]
  // Ship.D: every landable moving deck (def.deck: { hl, hw }) aboard a live hydro vessel, ghosts' too, refilled by
  // Ship.frame: { v, p, hl, hw, top (its top face's y, its own frame), x, y, z (its middle, part space), ex, ey (its own
  // axes in part space) }. vessel.js ground() asks deckContacts for every probe point of another craft within a deck's
  // rectangle and within DECK_BAND under its top: the deck pushes it up along its own up, and the solver takes the
  // contact's velocity relative to the deck (deckRel), so a craft on a deck rides with her. Crash limits: a carrier deck's.
  const DECKS = [];
  function decksOf(F) {
    DECKS.length = 0;
    for (const v of F.vessels) {
      const S = v.sh;
      if (!S || v.dead || !S.decks.length) continue;
      if (!S.dk) S.dk = S.decks.flatMap((p) => { const o = partPt(p, 0, 0), a = partPt(p, 1, 0), u = partPt(p, 0, 1), d = p.def.deck;
        return partZs(p).map((z) => ({ v, p, hl: d.hl || p.def.w / 2, hw: d.hw || partDepth(p) / 2, top: p.def.h / 2, x: o.x, y: o.y, z, ex: { x: a.x - o.x, y: a.y - o.y }, ey: { x: u.x - o.x, y: u.y - o.y } })); });
      for (const D of S.dk) if (!D.p.broken && v.byId.has(D.p.id)) DECKS.push(D);
    }
  }
  const _dU = v3(), _dO = v3(), _dL = v3(), _dV = v3();
  // the world up of a deck (sim axes), into o
  function deckUp(D, o) { return qrot(D.v.q, D.ey.x, D.ey.y, 0, o); }
  // the highest deck top near v (m over the body's radius; −Infinity: none): vessel.js ground()'s reach for its probes
  function deckTop(v) {
    let h = -Infinity;
    for (const D of DECKS) {
      const s = D.v;
      if (s === v || s.dead || s.body !== v.body || !near(s, v)) continue;
      worldOf(s, D.x + D.ey.x * D.top, D.y + D.ey.y * D.top, D.z, _dO);
      h = Math.max(h, Math.hypot(_dO.x, _dO.y, _dO.z) - v.body.radius);
    }
    return h;
  }
  // a deck's point velocity at the world point P (sim, absolute), into o
  function deckVel(D, P, o) { const s = D.v; return s.pointVel(v3(P.x - s.x, P.y - s.y, P.z - s.z), o || v3()); }
  // vessel.js ground() (one call, when Ship.D.length): the probe points of v on a deck, as contacts
  function deckContacts(v, contacts) {
    const q = v.q, c = v.com, cz = c.z || 0;
    for (const D of DECKS) {
      const s = D.v;
      if (s === v || s.dead || s.body !== v.body || !near(s, v)) continue;
      const up = deckUp(D, _dU);
      const probe = (k, rad) => {
        const o = qrot(q, k.x - c.x, k.y - c.y, k.z - cz, v3());
        if (rad) { o.x -= up.x * rad; o.y -= up.y * rad; o.z -= up.z * rad; }
        _dO.x = v.x + o.x; _dO.y = v.y + o.y; _dO.z = v.z + o.z;
        localOf(s, _dO, _dL);
        const ex = _dL.x - D.x, ey = _dL.y - D.y, lx = ex * D.ex.x + ey * D.ex.y, ly = ex * D.ey.x + ey * D.ey.y, lz = _dL.z - D.z;
        if (Math.abs(lx) > D.hl || Math.abs(lz) > D.hw) return;
        const pen = D.top - ly;
        if (pen <= 0 || pen > SHIP.DECK_BAND) return;
        // (a wheel on a deck is chocked: it holds as a skid does, 0.9 of grip, so a craft set down on a deck rolling about
        // the swell stays where it was put)
        contacts.push({ p: k.p, k, r: o, pen, n: v3(up.x, up.y, up.z), wheel: false, side: false, float: !!k.p.def.float, water: false, deck: D, P: v3(_dO.x, _dO.y, _dO.z) });
        v._deckHit = D;
      };
      for (const k of v.hull) probe(k, 0);
      for (const k of v.wheelPts) if (!(k.retract && v.gearUp)) probe(k, k.r);
    }
  }
  // a deck contact's velocity made relative to the deck (the solver's: after pointVel)
  function deckRel(k, vp) { deckVel(k.deck, k.P, _dV); vp.x -= _dV.x; vp.y -= _dV.y; vp.z -= _dV.z; return vp; }
  // Lashing: a craft (not a hydro one) on a deck, its speed relative to it under LASH.v for LASH.t s with its lift (its
  // wings' and its engines' and rotors' push) under LASH.lift of its weight, is lashed there: v.lash = { s: the ship, p:
  // the deck part, D, q: its attitude in her part axes, X: its centre in her part space, thr: its throttle then }. Not
  // stepped (flight.js physicsTick calls lashStep instead): it rides her. Let go when its throttle opens past LASH.lift
  // (and past what it was lashed at), the deck tilts past LASH.tilt, the deck part breaks or she is gone.
  function lashCheck(F, dt) {
    for (const v of F.vessels) {
      const D = v._deckHit;
      if (D) v._deckHit = null;
      if (v.lash) continue;
      if (!D || v.sh || v.dead || v.remote || !v.parts.length) { if (v._lashT) v._lashT = 0; continue; }
      const r = Math.hypot(v.x, v.y, v.z), W = (v.mass * v.body.mu) / (r * r), L = Math.max(0, v.lift || 0) + (v.thrust || 0);
      deckVel(D, v, _dV);
      const rel = Math.hypot(v.vx - _dV.x, v.vy - _dV.y, v.vz - _dV.z);
      if (rel < SHIP.LASH.v && L < SHIP.LASH.lift * W && tiltOk(D)) { v._lashT = (v._lashT || 0) + dt; if (v._lashT >= SHIP.LASH.t) lash(v, D); }
      else v._lashT = 0;
    }
  }
  function tiltOk(D) { const s = D.v, up = deckUp(D, _dU), r = Math.hypot(s.x, s.y, s.z) || 1; return (up.x * s.x + up.y * s.y + up.z * s.z) / r > Math.cos((SHIP.LASH.tilt * Math.PI) / 180); }
  function lash(v, D) {
    const s = D.v;
    v.lash = { s, p: D.p, D, q: qmul(qconj(s.q), v.q), X: localOf(s, v, v3()), thr: v.throttle || 0 };
    v._lashT = 0; v.landed = true;
  }
  function unlash(v) { if (v) { v.lash = null; v._lashT = 0; } }
  // flight.js physicsTick, for a lashed craft (instead of its physics step): her pose × its own, her velocity at its
  // centre; or let go (and stepped) when it lifts, the deck tilts or breaks or she is gone
  function lashStep(v, h, F) {
    const L = v.lash, s = L && L.s;
    const go = !s || s.dead || !s.parts.length || !s.byId.has(L.p.id) || L.p.broken || (F && F.vessels && !F.vessels.includes(s))
      || (v.throttle || 0) > Math.max(SHIP.LASH.lift, L.thr + 0.1) || !tiltOk(L.D);
    if (go) { unlash(v); v.physicsStep(h, F); return false; }
    v.q = qnorm(qmul(s.q, L.q));
    worldOf(s, L.X.x, L.X.y, L.X.z, _dO);
    v.x = _dO.x; v.y = _dO.y; v.z = _dO.z;
    deckVel(L.D, v, _dV);
    v.vx = _dV.x; v.vy = _dV.y; v.vz = _dV.z;
    v.av.x = s.av.x; v.av.y = s.av.y; v.av.z = s.av.z;
    v.landed = true; v.splashed = false; v.contactTime += h; v.restTime += h;
    return true;
  }
  // tiny pieces adrift with nobody in them: junk after SEA.float s (death.js's), scuttled (their buoyancy off: they sink)
  function junk(F, dt) {
    const T = typeof SEA !== 'undefined' && SEA.float ? SEA.float : 15;
    for (const v of F.vessels) {
      const S = v.sh;
      if (!S || S.rings.length || S.scuttle || v.control || v.remote || v.dead) continue;
      if (v.afloat && v.speed() < 1) { S.junkT = (S.junkT || 0) + dt; if (S.junkT >= T) S.scuttle = true; } else S.junkT = 0;
    }
  }

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
  // [WP5] a planing hull's wetted area shrinks as the water lifts her: friction × (1 − lift/W)^⅓ (her running trim isn't
  // worked out here, so a planing boat's top speed came out 20 % under the flight's: the RIB's 37 kn against 45)
  // Lf: the weight her hydrofoils carry (N; hullborne, climbing onto them): the hull carries the rest
  function resistance(M, H, V, fA = 0, Lf = 0) {
    if (!(V > 0) || !(H.Lwl > 0)) return 0;
    const rho = SHIP.RHO, g = gSea(), L = H.Lwl, Re = (V * L) / SHIP.NU;
    const Cf = Re < SHIP.CF_RE ? SHIP.CF_LOW : 0.075 / Math.pow(Math.log10(Re) - 2, 2), Rf = 0.5 * rho * V * V * H.SwetK * Cf;
    let lift = 0;
    H.rings.forEach((o, i) => {
      const r = M.rings[i], tau = r.tau - H.trim;
      if (o.b > 0 && tau > 0) lift += 0.5 * rho * (r.plane ? SHIP.planeK : SHIP.dispK) * V * Math.sin(tau) * V * o.b * r.dx * Math.cos(r.beta) ** 2 * Math.min(1, o.k / SHIP.planeFade);
    });
    const W = H.mass * g;
    lift += Lf;
    return Rf * Math.pow(clamp(1 - lift / W, 0.3, 1), 1 / 3) + Math.max(0, W - lift) * cwr(V / Math.sqrt(g * L)) * cwOf(M.hulls) + 0.5 * rho * V * V * fA * SHIP.FOIL.cd0; // [WP5] (cwOf: as the flight's)
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
  // Her hydrofoils (foil kind 'foil') as the flight flies them (§4.4): each copy's area, aspect ratio, full incidence
  // (inc0 + RIDE.lim, under the stall), its depth in the still water and foilborne (her deepest keel the ride height h*
  // over the water: the highest foil.h aboard), and its struts. null: none aboard
  function foilsOf(parts, M, H) {
    const F = parts.filter((p) => p.def.foil && p.def.foil.kind === 'foil');
    if (!F.length) return null;
    let h = 0, ride = false;
    for (const p of F) if (p.def.foil.ride) { ride = true; h = Math.max(h, Number.isFinite(p.def.foil.h) ? p.def.foil.h : SHIP.RIDE.h); }
    const FO = SHIP.FOIL, n = H.up, list = F.map((p) => {
      const f = p.def.foil, ly = Number.isFinite(f.y) ? f.y : 0, X = partPt(p, 0, ly), ar = f.ar || 2, k = partZs(p).length;
      const inc = Math.min(FO.stall, (f.inc || 0) + (f.ride ? SHIP.RIDE.lim : 0)), slope = (FO.slope * 2 * Math.PI * ar) / (ar + 2);
      const still = Math.max(0, ...partZs(p).map((z) => -(n.x * X.x + n.y * X.y + n.z * z - H.c)));
      return { A: (f.area || 1) * k, ar, cl: (slope * inc * Math.PI) / 180, still, up: M.keel - h - X.y, strut: Math.max(0.1, p.def.h / 2 - ly), ch: f.strutC || 0.6 * (f.chord || 1), ns: (f.struts || 1) * k };
    });
    return { list, ride, A: list.reduce((a, o) => a + o.A, 0) };
  }
  // the hydrofoils' drag at V m/s, each lifting cl (its own, or the share that holds her up), at depth dep (m) and its
  // struts to it: profile, induced (as the flight's foil loop) and cavitation
  function foilDrag(Fo, V, cl, foilborne) {
    const FO = SHIP.FOIL, q = 0.5 * SHIP.RHO * V * V;
    let D = 0;
    for (const o of Fo.list) {
      const c = cl == null ? o.cl : cl, dep = foilborne ? o.up : o.still;
      D += q * o.A * (FO.cd0 + (c * c) / (FO.e * Math.PI * o.ar) + cavCd(V * V, dep));
      if (foilborne) { const imm = clamp(dep, 0, o.strut); D += q * o.ch * imm * o.ns * (FO.cd0 + cavCd(V * V, imm / 2)); }
    }
    return D;
  }
  // the water's drag on her at V m/s: the hull's (resistance), or a hydrofoil's: her ride foils fly her clear of the water
  // past RIDE.v when at full incidence they can lift her (the foils' and struts' drag then, at the lift that holds her up);
  // below that they lift what they can at full incidence and the hull carries the rest (spec §4.4; the flight's ride control)
  function dragAt(M, H, V, fA, Fo) {
    if (!Fo) return resistance(M, H, V, fA);
    const W = H.mass * gSea(), q = 0.5 * SHIP.RHO * V * V, Lmax = Fo.list.reduce((a, o) => a + q * o.A * o.cl, 0);
    if (Fo.ride && V >= SHIP.RIDE.v && Lmax >= W) return foilDrag(Fo, V, W / (q * Fo.A), true);
    return resistance(M, H, V, fA, Math.min(W, Lmax)) + foilDrag(Fo, V, null, false);
  }
  function topSpeed(M, H, Pr, fA, Fo) {
    const BD = B0(), f = (V) => thrustAt(Pr, V) - dragAt(M, H, V, fA, Fo);
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
    const fA = parts.reduce((a, p) => a + (p.def.foil && p.def.foil.kind !== 'foil' ? p.def.foil.area * wet(p) : 0), 0); // (rudders and skegs: the hydrofoils are dragAt's)
    st.top = H.hull && !H.sinks ? topSpeed(M, H, Pr, fA, foilsOf(parts, M, H)) : 0;
    const Ar = rud.reduce((s, p) => s + p.def.foil.area * partZs(p).length, 0) + BD.steerA * steer.length, T = BD.turn;
    st.turn = Ar > 0 && H.Lwl > 0 && !H.sinks ? T[0] * H.Lwl * (T[1] + (T[2] * H.Lwl * H.T) / (Ar * T[3])) : 0;
    return st;
  }

  // ---- placement: where a tapped part goes on a ship (§11.2): a pose { def, type, x, y, z, rot, host, att } (att: the
  // part it hangs on; shift: { parts, dx, dy } to move first, a midsection going in behind the bow), { why } for a toast,
  // or null (the builder's own rules: the ground update's tankSpot for a gun house's guns and roof kit, then the usual
  // tap). at: the view's middle in part space { x, y }, and sym (symmetry on: pairs go off the centre line, the builder
  // adds the twin). Every pose is clear of every part (partsClash). Parts are told apart by their fields, not their
  // keys (§6's), so a part another package adds lands by what it is. [WP4: keel, deck, inside, stern screws and rudders;
  // WP7: every place]
  // What a ship part is, for placement and the warnings: the superstructure (what stands on the deck as a building:
  // bridges, deckhouses, the hangar, a helm console; not funnels, masts or guns), a radar, a magazine, a damage control
  // party, a gun ring (a naval ring on the deck, or a tank's turret ring put on a ship)
  const isHouse = (d) => !!d.ship && !d.shull && !d.funnel && (d.place === 'super' || (d.place === 'deck' && !!d.control));
  const isRadar = (d) => !!(d.searchRadar || d.trackRadar || d.radarSet);
  const isMag = (d) => !!d.ship && (!!d.store || d.module === 'ammo');
  const isDC = (d) => !!(d.mods && d.mods.some((m) => m.k === 'crew' && m.role === 'dc'));
  const isPump = (d) => !!d.pump && !d.shull;
  const isRing = (d) => !!d.ring && (d.place === 'deck' || d.place === 'roof');
  function roleOf(d, type) {
    const w = d.weapon || {}, f = d.foil;
    if (d.shull) { const en = d.shull.ends || {}; return en.aft === 'joint' || en.fore === 'joint' ? 'segment' : 'onePiece'; }
    if (isRing(d)) return 'gunRing';
    if (d.deck) return 'pad';
    if (w.vls) return 'vls';
    if (d.ciws) return 'ciws';
    if (w.asm) return 'asm';
    if (d.decoy && d.decoy.torp) return 'torpDecoy';
    if (f && f.kind === 'foil') return d.place === 'bow' ? 'foilBow' : 'foilKeel';
    if (d.jet) return 'jet';
    if (d.steer && (d.screw || d.engine)) return 'outboard';
    if (d.bulkhead) return 'bulkhead';
    if (d.place === 'inside') return isMag(d) ? 'magazine' : isPump(d) ? 'pump' : isDC(d) ? 'dc' : d.ballast || type === 'ballast' ? 'ballast' : 'inside';
    if (d.place === 'mast') return isRadar(d) ? 'radar' : 'mast';
    if (d.funnel) return 'funnel';
    if (d.hangar) return 'hangar';
    if (d.place === 'deck' && d.control && !d.shull && d.w <= 2) return 'console';
    if (d.place === 'super') return d.control ? 'bridge' : 'house';
    return d.place || null;
  }
  function spotOf(type, parts, at) {
    const def = hasOwn(PARTS, type) ? PARTS[type] : null;
    if (!def || !Array.isArray(parts)) return null;
    at = at || {};
    const BD = B0(), rot = Number.isInteger(at.rot) ? at.rot & 3 : def.aim && !def.trackRadar ? 3 : 0, { w, h } = partDims({ def, rot }), dep = partDepth({ def }); // ([WP9] a tracking dish stands upright: rot 0, as on a tank)
    const pose = (x, y, z, host) => ({ def, type, x: +x.toFixed(3), y: +y.toFixed(3), z: cleanZ(+z.toFixed(3), def), rot, host, att: host });
    const free = (q, skip) => !!q && !parts.some((o) => !(skip && skip.has(o)) && partsClash(q, o));
    const hulls = parts.filter((p) => p.def.shull && (p.rot & 3) === 0);
    const room = { why: `No room for the ${def.name} there: drag it into place instead.` }, first = { why: `Put a hull down first (Ship hulls): the ${def.name} goes on it.` };
    // the hull's extent along x, the deck's and the keel's height there (the segments that span x), the deck's half-breadth
    const span = (p) => { const H = shullOf(p.def); return [p.x + H.x0, p.x + H.x1]; };
    const over = (x) => hulls.filter((p) => { const [a, b] = span(p); return x >= a - 1e-6 && x <= b + 1e-6; });
    const deckAt = (x) => over(x).reduce((m, p) => Math.max(m, p.y + shullSec(p.def.shull.st, x - p.x)[0]), -Infinity);
    const keelAt = (x) => over(x).reduce((m, p) => Math.min(m, p.y + shullSec(p.def.shull.st, x - p.x)[1]), Infinity);
    const beamAt = (x) => over(x).reduce((m, p) => Math.max(m, shullSec(p.def.shull.st, x - p.x)[2] + Math.abs(partZ(p))), -Infinity);
    const samples = (x0, x1) => { const n = Math.max(1, Math.ceil((x1 - x0) / 0.25)), o = []; for (let i = 0; i <= n; i++) o.push(x0 + ((x1 - x0) * i) / n); return o; };
    const near = (xt, lo, hi) => { // (lo..hi every BD.step m, the nearest xt first)
      const s = BD.step, o = [];
      if (hi < lo - 1e-9) return o;
      const c = clamp(xt, lo, hi);
      o.push(c);
      for (let k = 1; c - k * s >= lo - 1e-9 || c + k * s <= hi + 1e-9; k++) { if (c + k * s <= hi + 1e-9) o.push(c + k * s); if (c - k * s >= lo - 1e-9) o.push(c - k * s); }
      return o;
    };
    const down = (hi, lo) => { const o = []; for (let x = hi; x >= lo - 1e-9; x -= BD.step) o.push(x); return o; }; // (from hi aft to lo)
    const up = (lo, hi) => { const o = []; for (let x = lo; x <= hi + 1e-9; x += BD.step) o.push(x); return o; }; // (from lo forward to hi)
    const scan = (xs, zs, make) => { for (const x of xs) for (const z of zs) { const q = make(x, z); if (free(q)) return q; } return null; };
    const pairs = (z) => (Math.abs(z) < 0.005 ? [0] : at.sym ? [z] : [z, -z]); // (a pair with symmetry on: the builder adds the twin)
    let X0 = Infinity, X1 = -Infinity;
    for (const p of hulls) { const [a, b] = span(p); X0 = Math.min(X0, a); X1 = Math.max(X1, b); }
    const L = X1 - X0, mid = (X0 + X1) / 2;
    const xt = Number.isFinite(at.x) && at.x >= X0 && at.x <= X1 ? at.x : mid;
    const role = roleOf(def, type);
    // the superstructure's extent along her (SX0..SX1), and its parts
    const houses = parts.filter((p) => isHouse(p.def));
    let SX0 = Infinity, SX1 = -Infinity;
    for (const p of houses) { const R = partRect(p); SX0 = Math.min(SX0, R.l); SX1 = Math.max(SX1, R.r); }
    const sup = houses.length > 0;
    // on the deck at x, z across: its bottom on the deck's highest point under it, over the deck along all its length (no
    // more than a quarter of its width past the deck edge either side: nothing wide at a narrow bow)
    const deckPose = (x, z = 0) => {
      let top = -Infinity;
      for (const s of samples(x - w / 2, x + w / 2)) { const d = deckAt(s); if (!Number.isFinite(d) || !(Math.abs(z) + dep / 2 <= beamAt(s) + 0.25 * dep + 1e-6)) return null; top = Math.max(top, d); }
      return pose(x, top + h / 2, z, over(x)[0]);
    };
    // on a part's roof (a house, a mast), its middle over the roof, x along it, z across it
    const roofPose = (H, x, z) => {
      const R = partRect(H), hz = partZ(H);
      if (Math.abs(z - hz) + dep / 2 > partDepth(H) / 2 + 0.25 * dep + 1e-6) return null;
      return pose(x, R.t + h / 2, z, H);
    };
    const roofScan = (H, x0, zs) => { const R = partRect(H), xs = R.r - R.l >= w ? near(x0, R.l + w / 2, R.r - w / 2) : [H.x]; return scan(xs, zs, (x, z) => roofPose(H, x, z)); };
    // the superstructure under the view's middle, then the rest nearest it: their roofs (the deck full there)
    const onSuper = (x0 = xt) => {
      for (const H of [...houses].sort((a, b) => Math.abs(a.x - x0) - Math.abs(b.x - x0))) { const q = roofScan(H, x0, [partZ(H)]); if (q) return q; }
      return null;
    };
    const onDeck = (x0 = xt, zs = [0]) => scan(near(x0, X0 + w / 2, X1 - w / 2), zs, deckPose);

    // ---- hulls
    // a one-piece hull (a RIB's, a float) beside the hulls there: off the centre line by both half-beams and 0.5 m, its
    // keel level with theirs and its middle beside theirs (a catamaran; a pair of floats with symmetry on)
    if (role === 'onePiece' && parts.some((p) => p.def.shull)) {
      if (!hulls.length) return room;
      const H1 = shullOf(def), k1 = Math.min(...H1.rings.map((r) => r.yk)), b1 = Math.max(...H1.rings.map((r) => r.bd));
      const F = [...hulls].sort((a, b) => Math.abs(partZ(a)) - Math.abs(partZ(b)))[0], H0 = shullOf(F.def), k0 = F.y + Math.min(...H0.rings.map((r) => r.yk)), b0 = Math.max(...H0.rings.map((r) => r.bd));
      const x = F.x + (H0.x0 + H0.x1) / 2 - (H1.x0 + H1.x1) / 2, y = k0 - k1, zo = Math.abs(partZ(F)) + b0 + b1 + 0.5;
      for (const z of at.sym ? [zo] : [zo, -zo]) { const q = pose(x, y, z, F); if (free(q)) return q; }
      return room;
    }
    // keel: hull segments end to end, bow forward, stern aft, their keels level
    if (def.shull) {
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

    // ---- the ground update's places on a ship: a gun house (or a tank turret) on the free ring nearest the view's middle;
    // a gun with no gun house aboard on a bare ring, its trunnion over the ring's middle; roof kit with no turret aboard
    // on the superstructure's roof. With a house or turret aboard, its guns and roof kit go as on a tank (null: tankSpot).
    const turret = parts.some((p) => p.def.place === 'ring'), ground = def.place === 'ring' || def.place === 'front' || def.place === 'top' || def.place === 'flank';
    if (ground && !hulls.length) return null;
    if (def.place === 'ring') {
      const rings = parts.filter((p) => p.def.ring && !(p.rot & 3) && !parts.some((o) => o.att === p.id)).sort((a, b) => Math.abs(a.x - xt) - Math.abs(b.x - xt)); // (bare rings: a gun on one is its own mount)
      for (const g of rings) { const q = pose(g.x, partRect(g).t + h / 2, partZ(g), g); if (free(q)) return q; }
      return rings.length ? room : { why: `Put a gun ring on the deck first (Naval weapons, or a turret ring): the ${def.name} turns on it.` };
    }
    if ((def.place === 'front' || def.place === 'top' || def.place === 'flank') && !turret) {
      const piv = def.aim && def.aim.pivot != null ? def.aim.pivot : 0.5, off = rot === 3 ? def.h / 2 - piv * def.h : 0;
      const bare = parts.filter((p) => p.def.ring && !(p.rot & 3) && !parts.some((o) => o.att === p.id)).sort((a, b) => Math.abs(a.x - xt) - Math.abs(b.x - xt));
      if (def.place === 'front' || def.aim) for (const g of bare) { const q = pose(g.x + off, partRect(g).t + h / 2, partZ(g), g); if (free(q)) return q; }
      if (def.place === 'front' && bare.length) return room;
      if (def.place === 'front') return { why: `Put a gun ring on the deck first (Naval weapons, or a turret ring): the ${def.name} goes on it.` };
      const q = onSuper(xt + off) || onDeck(xt + off);
      return q || room;
    }
    if (def.place === 'front' || def.place === 'top' || def.place === 'flank') return null; // (a gun house aboard: tankSpot)

    const onHull = ['deck', 'super', 'mast', 'inside', 'stern', 'bow', 'edge', 'keel'].includes(def.place) || role === 'gunRing' || role === 'torpDecoy';
    if (!onHull) return null;
    if (!hulls.length) return first;

    // ---- the deck
    // a gun ring: the foremost clear spot on the centre line ahead of the superstructure, then the aftmost behind it
    // (rings far enough apart for the gun houses on them: 1.6 m between them)
    if (role === 'gunRing') return scan([...down(X1 - w / 2, sup ? SX1 + w / 2 : X0 + w / 2), ...(sup ? up(X0 + w / 2, SX0 - w / 2) : [])], [0],
      (x, z) => (parts.some((o) => o.def.ring && Math.abs(o.x - x) < (w + o.def.w) / 2 + 1.6) ? null : deckPose(x, z))) || room;
    // the helicopter deck: the aftmost clear stretch of deck
    if (role === 'pad') return scan(up(X0 + w / 2, X1 - w / 2), [0], deckPose) || room;
    // vertical launch cells, flush in the deck (their top at the deck line, inside the hull), ahead of the superstructure,
    // then aft of it; a launcher that isn't set into the deck stands on it there
    if (role === 'vls') {
      const xs = [...down(X1 - w / 2, sup ? SX1 + w / 2 : X0 + w / 2), ...(sup ? up(X0 + w / 2, SX0 - w / 2) : [])];
      if (def.flush || def.inner) {
        const q = scan(xs, [0], (x) => {
          const H = over(x)[0], d = deckAt(x);
          if (!H || !Number.isFinite(d)) return null;
          const S = H.def.shull, y0 = d - h - H.y, zm = dep / 2 + BD.inM;
          for (const s of samples(x - w / 2, x + w / 2)) {
            const G = over(s)[0];
            if (G !== H) return null;
            const P = shullPoly(shullSec(S.st, s - H.x), S.wl);
            if (!(halfAt(P, y0) >= zm - 1e-9) || !(halfAt(P, y0 + h - 1e-6) >= zm - 1e-9)) return null;
          }
          return pose(x, d - h / 2, 0, H);
        });
        if (q) return q;
      }
      return scan(xs, [0], deckPose) || room;
    }
    // the close-in gun: on the centre line on top of the aftmost superstructure, else on the deck aft
    if (role === 'ciws') {
      for (const H of [...houses].sort((a, b) => partRect(a).l - partRect(b).l)) { const q = roofScan(H, H.x, [partZ(H)]); if (q) return q; }
      return scan(up(X0 + w / 2, X1 - w / 2), [0], deckPose) || room;
    }
    // anti-ship missiles: aft of the superstructure, a pair at the deck's edges with symmetry on (else on the centre line)
    if (role === 'asm') {
      const xs = sup ? [...down(SX0 - w / 2, X0 + w / 2), ...up(SX1 + w / 2, X1 - w / 2)] : near(mid - 0.15 * L, X0 + w / 2, X1 - w / 2);
      return scan(xs, [0], (x) => { const b = Math.min(...samples(x - w / 2, x + w / 2).map(beamAt)); if (!(b > 0)) return null; const z = at.sym ? Math.max(0, b - dep / 2) : 0; return deckPose(x, z); }) || room;
    }
    // a torpedo decoy streams from the stern: on the stern's deck
    if (role === 'torpDecoy') return scan(up(X0 + w / 2, X1 - w / 2), [0, ...pairs(Math.max(0, beamAt(X0 + w / 2) - dep / 2 - 0.1))], deckPose) || room;
    // a helm console: amidships, a little aft of the middle
    if (role === 'console') return onDeck(mid - 0.12 * L) || room;
    // the rest on the deck: under the view's middle (or amidships), on the centre line, along it till clear
    if (def.place === 'deck') return onDeck() || room;

    // ---- superstructure
    if (def.place === 'super') {
      if (role === 'bridge') { // a bridge: its front 30-40 % of her length from the bow
        const a = X1 - 0.4 * L - w / 2, b = X1 - 0.3 * L - w / 2;
        return scan(near((a + b) / 2, Math.max(a, X0 + w / 2), Math.min(b, X1 - w / 2)), [0], deckPose) || onDeck((a + b) / 2) || onSuper() || room;
      }
      if (role === 'house' && sup) return scan(down(SX0 - w / 2, X0 + w / 2), [0], deckPose) || onDeck() || onSuper() || room; // (just behind the last superstructure)
      if (role === 'funnel') { // on a deckhouse's roof (the one under the view's middle first), else on deck amidships
        const hs = [...houses].sort((a, b) => (a.def.control ? 1 : 0) - (b.def.control ? 1 : 0) || Math.abs(a.x - xt) - Math.abs(b.x - xt));
        for (const H of hs) { const q = roofScan(H, H.x, [partZ(H)]); if (q) return q; }
        return onDeck(mid) || room;
      }
      if (role === 'hangar') { // just ahead of the helicopter deck
        const pad = parts.filter((p) => p.def.deck).sort((a, b) => a.x - b.x)[0];
        if (pad) { const q = scan(up(partRect(pad).r + w / 2, X1 - w / 2), [0], deckPose); if (q) return q; }
      }
      return onDeck() || onSuper() || room;
    }
    // ---- masts and radars: a mast on top of the highest superstructure, on the centre line; a radar on the highest free
    // mast top, else on the highest superstructure's roof
    if (def.place === 'mast') {
      const high = [...houses].sort((a, b) => partRect(b).t - partRect(a).t);
      if (role === 'radar') {
        const masts = parts.filter((p) => p.def.place === 'mast' && !isRadar(p.def)).sort((a, b) => partRect(b).t - partRect(a).t);
        for (const M of masts) { const q = pose(M.x, partRect(M).t + h / 2, partZ(M), M); if (free(q)) return q; }
      }
      for (const H of high) { const q = roofScan(H, H.x, [partZ(H)]); if (q) return q; }
      return onDeck() || room;
    }

    // ---- inside a hull: in the segment under the view's middle (else the nearest), as low as it goes, the nearest the
    // middle at that height; a pair off the centre line with symmetry on (the centre line if no pair fits), else on it.
    // A magazine under the nearest gun ring, a pump in the largest compartment, a damage control party amidships, ballast
    // the lowest anywhere; a bulkhead across the middle of the compartment under the view's middle.
    if (role === 'bulkhead') {
      const gap = (p) => { const [a, b] = span(p); return xt < a ? a - xt : xt > b ? xt - b : 0; };
      const H = [...hulls].sort((a, b) => gap(a) - gap(b))[0], [a, b] = span(H);
      const cuts = [a, ...parts.filter((p) => p.def.bulkhead && p.att === H.id).map((p) => p.x).sort((u, v) => u - v), b];
      const c = clamp(xt, a, b);
      let i = 0;
      while (i < cuts.length - 2 && c > cuts[i + 1]) i++;
      const xm = (cuts[i] + cuts[i + 1]) / 2, S = H.def.shull;
      const at2 = (x) => { const s = shullSec(S.st, x - H.x); return pose(x, H.y + (s[0] + s[1]) / 2, partZ(H), H); };
      return scan(near(xm, Math.max(cuts[i] + w, a + w / 2), Math.min(cuts[i + 1] - w, b - w / 2)), [0], at2) || room;
    }
    if (def.place === 'inside') {
      const m = BD.inM, gap = (p, x) => { const [a, b] = span(p); return x < a ? a - x : x > b ? x - b : 0; };
      let x0 = xt, lowest = role === 'ballast';
      if (role === 'magazine') { const g = parts.filter((p) => p.def.ring).sort((a, b) => Math.abs(a.x - xt) - Math.abs(b.x - xt))[0]; if (g) x0 = g.x; }
      if (role === 'dc') x0 = mid;
      let order = [...hulls].sort((a, b) => gap(a, x0) - gap(b, x0) || Math.abs(a.x - x0) - Math.abs(b.x - x0));
      if (role === 'pump') { order = [...hulls].sort((a, b) => shullOf(b.def).vol - shullOf(a.def).vol); x0 = (span(order[0])[0] + span(order[0])[1]) / 2; }
      const all = [];
      for (const H of order) {
        const S = H.def.shull, Hs = shullOf(H.def), lim = Hs.rings.reduce((s, r) => Math.max(s, r.bd), 0), zz = [], cands = [];
        for (let z = dep / 2 + 0.01; z + dep / 2 + m <= lim + 1e-9; z += BD.step) zz.push(z);
        const zs = at.sym ? [...zz.map((z) => [z, 0]), [0, 1]] : [[0, 0], ...zz.flatMap((z) => [[z, 1], [-z, 1]])];
        const secsAt = (x) => samples(x - w / 2, x + w / 2).map((s) => shullPoly(shullSec(S.st, s - H.x), S.wl));
        for (const x of near(x0, H.x + Hs.x0 + w / 2 + m, H.x + Hs.x1 - w / 2 - m)) {
          const secs = secsAt(x);
          for (const [z, tier] of zs) {
            const y0 = lowIn(secs, Math.abs(z) + dep / 2 + m, h, m);
            if (y0 != null) cands.push({ H, x, z: z + partZ(H), y0, secs, s: tier * 1000 + (lowest ? H.y + y0 : y0) + 0.08 * Math.abs(x - x0) + 0.01 * Math.abs(z) });
          }
        }
        if (lowest) { all.push(...cands); continue; }
        cands.sort((a, b) => a.s - b.s);
        for (const c of cands) { const q = pose(c.x, H.y + c.y0 + h / 2, c.z, H); if (free(q)) return q; }
        for (const c of cands) for (let dy = 0.1; dy < 8; dy += 0.1) { // (stacked on what is there already)
          if (!fitsIn(c.secs, c.y0 + dy, h, Math.abs(c.z - partZ(H)) + dep / 2 + m, m)) break;
          const q = pose(c.x, H.y + c.y0 + dy + h / 2, c.z, H);
          if (free(q)) return q;
        }
      }
      all.sort((a, b) => a.s - b.s);
      for (const c of all) { const q = pose(c.x, c.H.y + c.y0 + h / 2, c.z, c.H); if (free(q)) return q; }
      return room;
    }

    // ---- under her: a hydrofoil under the forefoot (the bow's foremost fifth of her length) or under the hull 10 % of her
    // length aft of her centre of gravity, its top at the keel there
    if (role === 'foilBow' || role === 'foilKeel') {
      const cg = model(parts).cg.x, xf = role === 'foilBow' ? X1 - 0.1 * L : cg - 0.1 * L, lo = role === 'foilBow' ? Math.max(X0 + w / 2, X1 - 0.2 * L) : X0 + w / 2;
      return scan(near(xf, lo, X1 - w / 2), [0], (x) => { let k = Infinity; for (const s of samples(x - w / 2, x + w / 2)) k = Math.min(k, keelAt(s)); return Number.isFinite(k) ? pose(x, k - 0.01 - h / 2, 0, over(x)[0]) : null; }) || room;
    }

    // ---- the stern: screws under the aftmost segment's keel a little ahead of the transom (a pair with symmetry on); a
    // rudder just behind a screw that has none, else under the transom; an outboard on the transom's aft face, its
    // propeller under the keel line (a pair 0.5 m either side with symmetry on); a waterjet in the transom at the keel line
    // (one on the centre line, a pair at a quarter of the beam out)
    const A = hulls.reduce((m, p) => (!m || span(p)[0] < span(m)[0] ? p : m), null), xa = span(A)[0], hb = shullOf(A.def).rings.reduce((s, r) => Math.max(s, r.bd), 0);
    const under = (x) => { let k = Infinity; for (const s of samples(Math.max(xa, x - w / 2), Math.min(X1, Math.max(xa, x + w / 2)))) k = Math.min(k, keelAt(s)); return k; };
    if (role === 'outboard') {
      const k = keelAt(xa + 0.01), x = xa - w / 2 - 0.02, y = k - 0.25 + h / 2;
      return scan([x], at.sym ? [0.5, 0] : [0, 0.5, -0.5], (x, z) => pose(x, y, z + partZ(A), A)) || room;
    }
    if (role === 'jet') {
      const k = keelAt(xa + 0.01), x = xa + w / 2 - 0.4, zs = at.sym ? [hb / 2, 0] : [0, hb / 2, -hb / 2];
      return scan([x], zs, (x, z) => pose(x, k + h / 2 + 0.01, z + partZ(A), A)) || scan([xa + w / 2], zs, (x, z) => pose(x, under(x) - 0.01 - h / 2, z + partZ(A), A)) || room;
    }
    if (def.place === 'stern' && ((def.screw && !def.steer) || (def.foil && def.foil.kind === 'rudder'))) {
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

    // ---- the deck edge: torpedo tubes and decoy launchers at the deck's edge, facing outboard, aft of the superstructure
    // (then ahead of it), a pair with symmetry on
    if (def.place === 'edge') {
      const xs = sup ? [...down(SX0 - w / 2, X0 + w / 2), ...up(SX1 + w / 2, X1 - w / 2)] : near(mid - 0.15 * L, X0 + w / 2, X1 - w / 2);
      return scan(xs, at.sym ? [1] : [1, -1], (x, s) => { const b = Math.min(...samples(x - w / 2, x + w / 2).map(beamAt)); return b > dep / 2 ? deckPose(x, s * (b - dep / 2)) : null; }) || room;
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
  // rolls, lists or trims, nothing pushes or steers her, a screw or rudder out of the water; then her kit's (kitWarnings).
  // (No bridge is the builder's first line, as every kind's control part; loose parts, the budget and the rest come
  // after, everyone's.) extra: what the builder knows and a pure function can't, { arcs: [{ x, deg }] } each gun
  // turret's traverse (Aim.sweep's, degrees; 360 all round).
  function warnings(ps, st, warn, extra) {
    const BD = B0(), t = (kg) => { const v = kg / 1000; return v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'); };
    if (!st || !st.hull) { warn.push('No hull: she can\'t float. Start with hull segments (Ship hulls): a bow, a midsection and a stern.'); kitWarnings(ps, st, warn, extra); return; }
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
    kitWarnings(ps, st, warn, extra);
  }
  // A hydrofoil's lift at V m/s with its incidence and the ride control's whole range (inc + RIDE.lim, under the stall):
  // newtons, both copies of a pair
  function foilLift(p, V) {
    const f = p.def.foil, F = SHIP.FOIL, ar = f.ar || 5, a = (Math.min(F.stall, (f.inc || 0) + SHIP.RIDE.lim) * Math.PI) / 180;
    return 0.5 * SHIP.RHO * V * V * (f.area || 0) * F.slope * ((2 * Math.PI * ar) / (ar + 2)) * a * partZs(p).length;
  }
  const NUM = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  // her crew's gunners (as the builder's crewOf counts crew: a hull's or a house's own crew until a seat is put in it)
  function gunnersOf(ps) {
    const seated = new Set();
    for (const p of ps) if (p.def.seat && p.att != null) seated.add(p.att);
    let n = 0;
    for (const p of ps) {
      const d = p.def, k = partZs(p).length;
      if (d.mods && !seated.has(p.id)) for (const m of d.mods) if (m.k === 'crew' && (m.role === 'gunner' || m.also === 'gunner')) n += k;
      if (d.seat === 'gunner') n += k;
    }
    return n;
  }
  // her weapon stations: each gun house or turret (whatever it holds), and each weapon not in one (a launcher, a tube, a
  // gun on a bare ring); not what fires by itself (the close-in gun, counter-drone kit) or countermeasures
  function stationsOf(ps) {
    const by = new Map(ps.map((p) => [p.id, p])), inHouse = (p) => { for (let q = by.get(p.att), i = 0; q && i < 50; q = by.get(q.att), i++) if (q.def.place === 'ring') return true; return false; };
    let n = 0;
    const arms = (d) => !!d.weapon && !d.ciws && !d.cuas && d.weapon.kind !== 'chaff' && d.weapon.kind !== 'smoke';
    for (const p of ps) {
      const d = p.def, k = partZs(p).length;
      if (d.place === 'ring') { if (attachedTo(ps, [p]).some((q) => arms(q.def))) n += k; }
      else if (arms(d) && !inHouse(p)) n += k;
    }
    return n;
  }
  // The kit's warnings (any design with ship parts aboard: the builder asks for every kind that carries one). Red first
  // (she won't work): torpedo tubes with no water under them, vertical launch cells with no fire-control radar, something
  // on the helicopter deck, hydrofoils that can't lift her, a bulkhead outside every hull. Then amber (a hint): a gun
  // whose arcs the superstructure blocks, more weapon stations than gunners, a radar below a funnel, anti-ship missiles
  // with no surface radar, a magazine above the waterline, a big ship with no pumps or damage control.
  function kitWarnings(ps, st, warn, extra) {
    const has = (f) => ps.some((p) => f(p.def)), all = (f) => ps.filter((p) => f(p.def));
    const hulls = all((d) => d.shull), afloat = !!(st && st.hull && !st.sinks);
    // ---- red
    if (has((d) => d.weapon && d.weapon.kind === 'torp') && !has((d) => d.hull) && !has((d) => d.wing)) warn.push('Torpedo tubes need water under them: put them on a ship (or a plane, to drop them).');
    if (has((d) => d.weapon && d.weapon.vls) && !has((d) => d.trackRadar)) warn.push('The vertical launcher\'s missiles need a Fire-Control Radar aboard.');
    for (const pad of all((d) => d.deck)) {
      const R = partRect(pad), hz = partZ(pad), hd = partDepth(pad) / 2;
      const on = ps.some((q) => q !== pad && pad.att !== q.id && !q.def.shull && (() => {
        const Q = partRect(q), qd = partDepth(q) / 2;
        return spanOverlap(Q.l, Q.r, R.l, R.r) > 0.02 && Q.t > R.t + 0.02 && Q.b < R.t + 4 && partZs(q).some((z) => spanOverlap(z - qd, z + qd, hz - hd, hz + hd) > 0.02);
      })());
      if (on) { warn.push('Something stands on the helicopter deck: a helicopter can\'t land there. Clear it.'); break; }
    }
    const foils = all((d) => d.foil && d.foil.kind === 'foil');
    if (foils.length) {
      const m = st && st.mass > 0 ? st.mass : ps.reduce((s, p) => s + partKg(p), 0), L = foils.reduce((s, p) => s + foilLift(p, 40 / SHIP.KN), 0);
      if (L < m * gSea()) warn.push(`Her foils can't lift her: they hold ${Math.round(L / gSea() / 1000).toLocaleString('en-US')} t at 40 kn and she weighs ${Math.round(m / 1000).toLocaleString('en-US')} t. She'll never fly on them: bigger foils, or a lighter ship.`);
    }
    for (const b of all((d) => d.bulkhead)) {
      const z = partZ(b), inHull = hulls.some((H) => {
        if (H.rot & 3) return false;
        const S = H.def.shull, Hs = shullOf(H.def);
        if (b.x < H.x + Hs.x0 || b.x > H.x + Hs.x1) return false;
        const P = shullPoly(shullSec(S.st, b.x - H.x), S.wl);
        return halfAt(P, b.y - H.y) >= Math.abs(z - partZ(H)) - 1e-6;
      });
      if (!inHull) { warn.push('A bulkhead only works inside a hull segment: move it into the hull.'); break; }
    }
    // ---- amber
    const x0 = st && st.hull ? st.x0 : 0, x1 = st && st.hull ? st.x1 : 0, mid = (x0 + x1) / 2;
    for (const a of (extra && extra.arcs) || []) {
      if (!(a.deg < 90)) continue;
      warn.push(`The ${a.x >= mid ? 'forward' : 'after'} gun can only fire over ${Math.round(a.deg)}°: raise it or move the superstructure.`);
      break;
    }
    const n = st ? stationsOf(ps) : 0, g = st ? gunnersOf(ps) : 0; // (a ship's crew: other kinds fire as they always have)
    if (n > g) warn.push(g ? `${n} weapon stations, ${g} gunner${g === 1 ? '' : 's'}: only ${NUM[g] || g} fire${g === 1 ? 's' : ''} at once. A bigger bridge or gun houses bring more.` : `${n} weapon station${n === 1 ? '' : 's'} and no gunner: nothing fires. A bridge or a gun house brings gunners.`);
    const funnels = all((d) => d.funnel);
    if (funnels.length && all(isRadar).some((r) => funnels.some((f) => Math.hypot(r.x - f.x, partZ(r) - partZ(f)) <= 10 && partRect(r).t < partRect(f).t))) warn.push('The radar sits below the funnel: smoke blinds it aft. Raise it on a mast.');
    if (has((d) => d.weapon && d.weapon.asm) && !has((d) => d.searchRadar && d.searchRadar.sea)) warn.push('Anti-ship missiles need a target: a Surface Search Radar finds one past your eyes.');
    // (wholly above it: a magazine reaching under the waterline is as low as a patrol boat's 1.3 m draught takes one, and
    // it floods first; its middle over the water warned on every small hull with nowhere lower to put it)
    if (afloat && st.plane && all((d) => isMag(d) && !d.weapon).some((p) => partRect(p).b > st.plane.a + st.plane.bx * p.x + st.plane.bz * partZ(p))) warn.push('A magazine above the waterline goes up more easily: put it low in the hull.'); // ([WP9] a deck launcher's missiles are magazines too (module 'ammo'), but on deck is where they go)
    if (st && st.mass > 500e3 && !has(isPump) && !has(isDC)) warn.push('No pumps or damage control: one hole could be the end of her. Add a Salvage Pump or a Damage Control Party.');
  }

  // ---- cards and tray lines (§11.4): a ship part's card lines (Ship.specs) and its tray line (Ship.line), speeds in knots.
  // [] / null: the builder's own (the ground update's lines)
  const kmTxt = (m) => `${+(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
  const tTxt = (t) => (t < 10 ? `${+t.toFixed(1)}` : Math.round(t).toLocaleString('en-US'));
  const kwTxt = (kw) => (kw >= 1000 ? `${+(kw / 1000).toFixed(1)} MW` : `${Math.round(kw)} kW`);
  // a propeller's (or waterjet's) push at V m/s on P watts, as thrustAt reckons it, full ahead and fully under (N)
  function pushOf(d, P, V) { return thrustAt({ air: 0, list: [{ D: (d.screw || d.jet).D, jet: !!d.jet, eta: d.screw ? d.screw.eta || 0.6 : 0, P, sub: 1, dir: 1, n: 1 }] }, V); }
  // the power a screw of this size is meant for: 2 MW on the patrol boat's 2.2 m propeller, as the disc's area
  const refKw = (d) => (d.jet ? 2500 * (d.jet.D / 1.4) ** 2 : 2000 * (d.screw.D / 2.2) ** 2);
  // how far a gun's best shell carries (its muzzle speed and drag as armour.js flies it: v' = −k·ρ·v², the best angle
  // up to the gun's elevation), at most a ship's aim ray (m); 0 without a shell to fly
  function gunReach(d) {
    const w = d.weapon, S = typeof SHELLS !== 'undefined' && w.shells ? w.shells.map((k) => SHELLS[k]).filter((s) => s && s.v0 > 0) : [];
    if (!S.length) return 0;
    const s = S.reduce((a, b) => (b.v0 > a.v0 ? b : a)), rho = 1.2, g = 9.8, el = Math.min(45, (d.aim && d.aim.el && d.aim.el[1]) || 45), dt = 0.05;
    let best = 0;
    for (let a = 5; a <= el + 1e-9; a += 5) {
      let vx = s.v0 * Math.cos((a * Math.PI) / 180), vy = s.v0 * Math.sin((a * Math.PI) / 180), x = 0, y = 0;
      for (let i = 0; i < 4000 && y >= 0; i++) { const v = Math.hypot(vx, vy), k = s.k * rho * v; vx -= k * vx * dt; vy -= (k * vy + g) * dt; x += vx * dt; y += vy * dt; }
      best = Math.max(best, x);
    }
    return Math.min(best, SHIP.AIM.ray);
  }
  function specs(def) {
    const d = def, w = d.weapon || {}, out = [], crew = (d.mods || []).filter((m) => m.k === 'crew').length;
    if (!d) return out;
    if (d.shull) {
      const H = shullOf(d), S = d.shull, draw = H.wl - Math.min(...H.rings.map((r) => r.yk)), len = +(H.x1 - H.x0).toFixed(1), one = S.ends && S.ends.aft !== 'joint' && S.ends.fore !== 'joint';
      out.push(`Floats up to ${tTxt((H.vol * SHIP.RHO) / 1000)} t of ship`, `draws ${draw.toFixed(1)} m at her marks`, one ? `a one-piece hull, ${len} m` : `one watertight compartment, ${len} m`);
      const A = d.armour;
      if (A) out.push(`${A.plate || A.mm} mm ${A.mat === 'alu' ? 'aluminium' : A.mat === 'grp' ? 'glass fibre' : 'steel'}${A.belt ? ' · a belt to dial' : ''}`);
      if (S.plane) out.push('a planing bottom');
      if (S.bk) out.push('bilge keels');
      return out;
    }
    if (d.engine && (d.steer || d.screw)) { out.push(`${kwTxt(d.engine.kw)} outboard`, 'its own propeller', `steers ${d.steer || SHIP.OUTBOARD_STEER}°`); return out; }
    if (d.engine) { out.push(`${d.engine.kw.toLocaleString('en-US')} kW`, `${d.engine.fuel || 'diesel'}`, `full power in ${d.engine.spool || SHIP.SPOOL} s`, 'turns every propeller and waterjet aboard'); return out; }
    if (d.screw) { const P = refKw(d); out.push(`about ${Math.round(pushOf(d, P * 1000, 15 / SHIP.KN) / 10000) * 10} kN at 15 kn on ${kwTxt(P)}`, `${d.screw.D} m`, d.screw.astern ? 'full power astern too' : 'astern at 70%'); return out; }
    if (d.jet) { const P = refKw(d); out.push(`about ${Math.round(pushOf(d, P * 1000, 30 / SHIP.KN) / 10000) * 10} kN at 30 kn on ${kwTxt(P)}`, `steers ${d.jet.steer || 30}°`, 'reverses with its bucket'); return out; }
    if (d.foil && d.foil.kind === 'rudder') { out.push(`turns ${d.foil.max || 35}°`, `${d.foil.area} m²`); return out; }
    if (d.foil) { out.push(`lifts ${tTxt(foilLift({ def: d, x: 0, y: 0 }, 40 / SHIP.KN) / gSea() / 1000)} t at 40 kn`, `${d.foil.area} m²`, ...(d.foil.ride ? ['ride control'] : [])); return out; }
    if (d.ciws) { out.push(`${kmTxt(d.ciws.range)}`, 'fires by itself', ...(d.ciws.missiles ? ['shoots missiles'] : [])); return out; }
    if (w.vls) { out.push(`${w.ammo} SAMs`, kmTxt(w.range), ...(w.missiles ? ['shoots missiles too'] : [])); return out; }
    if (w.asm) { out.push(`${w.ammo} anti-ship missile${w.ammo === 1 ? '' : 's'}`, kmTxt(w.range), `skims at ${w.skim || 8} m`); return out; }
    if (w.kind === 'torp') { out.push(`${w.ammo} torpedoes`, kmTxt(w.range), `${Math.round(w.speed * SHIP.KN)} kn`, w.seek ? 'homing' : 'straight runners'); return out; }
    if (w.kind === 'chaff') { out.push(`${w.ammo} rockets of chaff${w.flare ? ' and flares' : ''}`); return out; }
    if (d.decoy && d.decoy.torp) { out.push(`${d.decoy.ammo} noisemakers`, 'draws homing torpedoes'); return out; }
    if (w.kind === 'tgun' && d.ship) { const r = gunReach(d); out.push(`${w.cal} mm`, `${Math.round(60 / w.reload)} a minute`, ...(r ? [`reaches ${kmTxt(r)}`] : []), `${w.ammo} ready`); return out; }
    if (d.searchRadar || d.trackRadar) {
      const R = d.searchRadar || d.trackRadar;
      if (d.trackRadar) out.push(`tracks ${kmTxt(R.range)}`, ...(R.missiles ? ['guides SAMs'] : []), ...(R.sea ? ['ranges the guns'] : []));
      else out.push(R.sea || R.low ? `sees ships ${kmTxt(R.range)} (the horizon permitting)` : `sees aircraft ${kmTxt(R.range)}`);
      return out;
    }
    if (d.deck) { out.push('a helicopter lands and is lashed', `${d.w} × ${d.depth || d.w} m`); return out; }
    if (d.hangar) { out.push('repairs and rearms a helicopter on the deck'); return out; }
    if (d.funnel) { out.push('her smoke', 'broken: the engines lose 15%'); return out; }
    if (d.bulkhead) { out.push('splits a compartment in two'); return out; }
    if (isPump(d)) { out.push(`pumps ${d.pump} m³/s`); return out; }
    if (isMag(d) && d.store) { out.push(`${d.store.rounds} rounds for the naval guns`); return out; }
    if (isDC(d)) { out.push(`${d.mods.filter((m) => m.role === 'dc').length} damage control crew`, 'patch holes, fight fires'); return out; }
    if (d.ballast || d.type === 'ballast') { out.push(`${d.mass} t, low down`); return out; }
    if (d.place === 'mast') { out.push(`a perch for radars ${tTxt(d.h)} m up`); return out; }
    if (d.ship && (d.control || isHouse(d))) {
      if (d.control) out.push('the helm');
      if (crew) out.push(`crew ${crew}`);
      if (d.stealth) out.push(`radars see her ${Math.round(d.stealth * 100)}% less far`);
      return out;
    }
    return out;
  }
  // (short: a tray item's line fits on one line, so the tray keeps its height)
  function line(def) {
    const d = def, w = (d && d.weapon) || {};
    if (!d || !d.ship) return null;
    if (d.shull) { const H = shullOf(d); return `draws ${(H.wl - Math.min(...H.rings.map((r) => r.yk))).toFixed(1)} m`; }
    if (d.engine) return `${d.engine.kw.toLocaleString('en-US')} kW`;
    if (d.screw) return `~${Math.round(pushOf(d, refKw(d) * 1000, 15 / SHIP.KN) / 10000) * 10} kN`;
    if (d.jet) return `steers ${d.jet.steer || 30}°`;
    if (d.foil && d.foil.kind === 'rudder') return `${d.foil.max || 35}° · ${d.foil.area} m²`;
    if (d.foil) return `lifts ${tTxt(foilLift({ def: d, x: 0, y: 0 }, 40 / SHIP.KN) / gSea() / 1000)} t`;
    if (d.ciws) return kmTxt(d.ciws.range);
    if (w.vls) return `${w.ammo} SAMs`;
    if (w.asm) return `${w.ammo} × ${kmTxt(w.range)}`;
    if (w.kind === 'torp') return `${w.ammo} · ${kmTxt(w.range)}`;
    if (w.kind === 'chaff') return `${w.ammo} decoys`;
    if (d.decoy && d.decoy.torp) return `${d.decoy.ammo} decoys`;
    if (w.kind === 'tgun') return `${Math.round(60 / w.reload)}/min`;
    if (d.searchRadar || d.trackRadar) return `${kmTxt((d.searchRadar || d.trackRadar).range)}`;
    if (d.deck) return 'helicopters';
    if (d.hangar) return 'repairs';
    if (d.funnel) return 'smoke';
    if (d.bulkhead) return 'watertight';
    if (isPump(d)) return `${d.pump} m³/s`;
    if (isMag(d) && d.store) return `${d.store.rounds} rounds`;
    if (d.ballast || d.type === 'ballast') return `${d.mass} t`;
    if (isDC(d)) return `${d.mods.filter((m) => m.role === 'dc').length} crew`;
    if (d.place === 'mast') return `${tTxt(d.h)} m`;
    if (d.control) { const c = (d.mods || []).filter((m) => m.k === 'crew').length; return c ? `crew ${c}` : 'helm'; }
    return null;
  }

  // ---- X-ray (§11.4): a ship's insides for the blueprint (builder drawShipXray), part space. comps: each watertight
  // compartment { H (its hull part), x0, x1, n (numbered from the bow) }, bulkheads { x, H }, belts { H, x0, x1, y0, y1 }
  // (the side band), marks { p, kind: 'mag' | 'engine' | 'pump' | 'dc' } (what is inside, by colour)
  function xray(parts) {
    const out = { comps: [], bulkheads: [], belts: [], marks: [] };
    const hulls = parts.filter((p) => p.def.shull && (p.rot & 3) === 0);
    for (const H of hulls) {
      const Hs = shullOf(H.def), a = H.x + Hs.x0, b = H.x + Hs.x1, cuts = parts.filter((p) => p.def.bulkhead && p.att === H.id && p.x > a && p.x < b).map((p) => p.x).sort((u, v) => u - v);
      const xs = [a, ...cuts, b];
      for (let i = 0; i + 1 < xs.length; i++) out.comps.push({ H, x0: xs[i], x1: xs[i + 1] });
      for (const x of cuts) out.bulkheads.push({ x, H });
      const A = H.def.armour, belt = A && A.belt && (Array.isArray(A.belt) ? A.belt : A.belt.y);
      if (belt && belt.length === 2) out.belts.push({ H, x0: a, x1: b, y0: H.y + belt[0], y1: H.y + belt[1] });
    }
    out.comps.sort((p, q) => q.x1 - p.x1).forEach((c, i) => { c.n = i + 1; });
    for (const p of parts) {
      const d = p.def;
      if (isMag(d)) out.marks.push({ p, kind: 'mag' });
      else if (d.engine && d.ship) out.marks.push({ p, kind: 'engine' });
      else if (isPump(d)) out.marks.push({ p, kind: 'pump' });
      else if (isDC(d)) out.marks.push({ p, kind: 'dc' });
    }
    return out;
  }

  // ==== damage ====
  // [WP8] Holes, flooding, fires, damage control and fate (spec §8.3-§8.9). Everything here runs only for a hull part
  // (def.shull), a hydro vessel (v.sh) or what they call it with: armour.js (a shell meeting a hull: hullRay, hullMm; the
  // holes a round tears: addHoles; a magazine: magazine), combat.js (a blast: hullDist, blastHull; a hull at 0 hp:
  // holedThrough; a bomb into the sea beside a ship bursts under water) and Ship.frame (floodStep at FLOOD.hz, fireStep,
  // dcStep and fateStep at FATE.hz, the sunk ships' wrecks). Old play never reaches any of it.
  // Per hull part (saved: vessel.js): p.holes [{ x, y, z (part space), a (m²), t (made at), fix (0..1 patched) }], at
  // most HOLE.max (a new one past that merges into the nearest), each at most HOLE.cap; p.water, the water in it (m³, its
  // compartments' sum); p.broken a hull holed through (kept: never blown off); p.fire a part burning (1, worked down to 0
  // by damage control). Per compartment (sh.comps[i], Ship.groups): p (its hull part), lo, hi (its stretch of the part's
  // own x: a bulkhead cuts one), R (its rings, every max(0.5, w/24) m and at its ends, with their trapezoid weights w),
  // V (m³ to the deck), W (water), holes (those in its stretch), lev/fs/fc (its flood level, free surface and the cached
  // water's centroid). Per vessel: sh.dc (the damage-control parties), sh.wet (parts under her flood water: an engine
  // there gives nothing), sh.fT/sh.kT (the steps' clocks), sh.capT, sh.helmT, sh.derT, sh.bedT (the fate's), sh.ctl0
  // (she had someone at a helm); v.fate ('sunk' | 'capsized' | 'magazine' | 'action'), v.doomed (when), v.doomBy, v.sunk
  // (gone under: a wreck on a shallow bed, else gone 40 m down), v.wreckAt.
  const FATES = new Set(['sunk', 'capsized', 'magazine', 'action']);
  // (Math's, held here: the flooding runs ten times a second for every compartment and hole aboard)
  const msin = Math.sin, msqrt = Math.sqrt, mabs = Math.abs, mmax = Math.max, mmin = Math.min, mhypot = Math.hypot, PI = Math.PI, mclamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  let rs = ((Math.random() * 4294967296) | 0) || 7; // (the damage's own dice: fires and their spread; Ship.seed for tests)
  const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; };
  function seed(n) { rs = (n | 0) || 7; let h = Math.imul(rs, 0x9e3779b1); h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; cs = h || 7; } // ([WP9] and the combat's dice: cs, well mixed so neighbouring seeds draw apart)
  const clockOf = (sim) => (sim && Number.isFinite(sim.time) ? sim.time : typeof Flight !== 'undefined' && Number.isFinite(Flight.time) ? Flight.time : 0);
  const hpFracOf = (p) => (typeof Combat !== 'undefined' && Combat.hpFrac ? Combat.hpFrac(p) : 1);
  const whole = (v, p) => !!p && v.byId.has(p.id) && !p.broken && (p.hp == null || p.hp > 0);

  // ---- frames: part space <-> a hull part's own frame (x along it, y up it, z across, from its box's centre)
  function ownPt(p, X, o) {
    const dx = X.x - p.x, dy = X.y - p.y;
    switch (p.rot & 3) { case 1: o.x = dy; o.y = -dx; break; case 2: o.x = -dx; o.y = -dy; break; case 3: o.x = -dy; o.y = dx; break; default: o.x = dx; o.y = dy; }
    o.z = X.z - partZ(p);
    return o;
  }
  function partOf(p, x, y, z, o) { const q = partPt(p, x, y); o.x = q.x; o.y = q.y; o.z = partZ(p) + z; return o; }
  // the section's half-breadth at height y (its own frame) at a station's [yd, yk, bd, bw, nb] (insideHull's)
  function secHalf(sec, wl, y) {
    const yd = sec[0], yk = sec[1], bd = sec[2], bw = sec[3], nb = sec[4];
    if (y <= yk || y >= yd) return -1;
    if (yk < wl && y < wl) { const u = (wl - y) / (wl - yk); return bw * Math.pow(Math.max(0, 1 - Math.pow(u, nb)), 1 / nb); }
    if (yk < wl) return yd > wl ? bw + ((bd - bw) * (y - wl)) / (yd - wl) : bw;
    const b0 = yd > wl ? bw + ((bd - bw) * (yk - wl)) / (yd - wl) : bw;
    return b0 + ((bd - b0) * (y - yk)) / Math.max(yd - yk, 1e-6);
  }
  const SEC2 = [0, 0, 0, 0, 0];
  function insideOwn(d, x, y, z) {
    const H = shullOf(d);
    if (x < H.x0 || x > H.x1) return false;
    secAt(d.shull.st, x, SEC2);
    const h = secHalf(SEC2, d.shull.wl, y);
    return h > 0 && Math.abs(z) < h;
  }

  // ---- where hits land (§8.3)
  // The segment A -> B (the part's own frame: armour.js test()'s, after ownR) against the hull's own triangles (parts.js
  // shullTris: what the loft draws), H filled as armour.js's prism fills it: t0, t1 (the line going in and coming out,
  // fractions of A -> B; t0 < 0: A was inside), edge, edge1 (the face codes: −6 deck, −7 side, −8 bottom, −9 an open joint),
  // n, n1 (their outward normals, own frame), u, u1 (the entry's and exit's own y: the belt), box false. Only the slabs
  // (between neighbouring rings) the line's x crosses inside the part's box are looked at: a broadside shot 1-2 of them.
  const XT = [], XF = [];
  function hullRay(p, A, B, H) {
    const d = p.def;
    if (!d.shull) return false;
    const T = shullTris(d), dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
    let lo = -Infinity, hi = Infinity;
    const ax = [A.x, A.y, A.z], dd = [dx, dy, dz], half = [d.w / 2 + 0.02, d.h / 2 + 0.02, partDepth(p) / 2 + 0.02];
    for (let k = 0; k < 3; k++) { // (the line's stretch inside the part's box)
      if (dd[k] * dd[k] < 1e-18) { if (Math.abs(ax[k]) > half[k]) return false; continue; }
      let a = (-half[k] - ax[k]) / dd[k], b = (half[k] - ax[k]) / dd[k];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > lo) lo = a;
      if (b < hi) hi = b;
      if (lo > hi) return false;
    }
    const xa = A.x + dx * lo, xb = A.x + dx * hi, x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), xs = T.xs, n = T.n;
    let m = 0;
    const tri = (f0, f1) => { for (let f = f0; f < f1; f++) { const t = triT(T, f, A, dx, dy, dz); if (t === t) { XT[m] = t; XF[m] = f; m++; } } };
    for (let i = 0; i + 1 < n; i++) if (xs[i + 1] >= x0 - 1e-6 && xs[i] <= x1 + 1e-6) tri(T.slab[2 * i], T.slab[2 * i + 1]);
    if (x0 <= xs[0] + 1e-6) tri(T.cap[0][0], T.cap[0][1]);
    if (x1 >= xs[n - 1] - 1e-6) tri(T.cap[1][0], T.cap[1][1]);
    let fi = -1, fo = -1, t0 = Infinity, t1 = Infinity;
    for (let i = 0; i < m; i++) { const f = XF[i]; if (dx * T.un[3 * f] + dy * T.un[3 * f + 1] + dz * T.un[3 * f + 2] < 0 && XT[i] < t0) { t0 = XT[i]; fi = f; } }
    if (fi < 0) return false;
    for (let i = 0; i < m; i++) { const f = XF[i]; if (XT[i] > t0 && dx * T.un[3 * f] + dy * T.un[3 * f + 1] + dz * T.un[3 * f + 2] > 0 && XT[i] < t1) { t1 = XT[i]; fo = f; } }
    if (fo < 0) { t1 = hi; fo = fi; } // (a graze along an edge: out where it leaves the box)
    if (t1 < 0 || t0 > 1) return false;
    H.t0 = t0; H.t1 = t1; H.edge = T.code[fi]; H.edge1 = T.code[fo];
    H.n.x = T.un[3 * fi]; H.n.y = T.un[3 * fi + 1]; H.n.z = T.un[3 * fi + 2];
    H.n1.x = T.un[3 * fo]; H.n1.y = T.un[3 * fo + 1]; H.n1.z = T.un[3 * fo + 2];
    H.u = A.y + dy * t0; H.u1 = A.y + dy * t1; H.box = false;
    return true;
  }
  // where the line A + t·(dx, dy, dz) meets triangle f (Möller-Trumbore, its edges a hair wide so neighbours leave no
  // gap): t, or NaN
  function triT(T, f, A, dx, dy, dz) {
    const P = T.pos, a = 3 * T.tri[3 * f], b = 3 * T.tri[3 * f + 1], c = 3 * T.tri[3 * f + 2];
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (det * det < 1e-24) return NaN;
    const inv = 1 / det, tx = A.x - P[a], ty = A.y - P[a + 1], tz = A.z - P[a + 2], u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-7 || u > 1 + 1e-7) return NaN;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, w = (dx * qx + dy * qy + dz * qz) * inv;
    if (w < -1e-7 || u + w > 1 + 1e-7) return NaN;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  }
  // A hull face's plate (mm; armour.js faceMm for edge ≤ −6): the deck its own (else the plating), a side the plating or,
  // within a belt's band (armour.belt: [y0, y1] or { y: [y0, y1] }, its own frame), the part's dialled mm; the bottom the
  // plating; an open joint nothing; glass fibre nothing (rounds go through it: holes)
  function hullMm(p, edge, u) {
    const A = p.def.armour;
    if (!A || A.mat === 'grp' || edge === -9) return 0;
    const plate = A.plate ?? A.mm ?? 0;
    if (edge === -6) return A.deck ?? plate;
    if (edge === -7) { const b = A.belt && (Array.isArray(A.belt) ? A.belt : A.belt.y); if (b && u >= b[0] && u <= b[1]) return p.mm ?? A.mm ?? plate; }
    return plate;
  }
  // A blast's distance to a hull part (m: to its nearest triangle, 0 inside), at the sim point `at`; the nearest point
  // (part space) left in HC. A 150 m hull's centre less its half-length would put it touching any burst within 75 m.
  const HC = v3(), _hq = v3(), _ho = v3(), CP = [0, 0, 0];
  function hullDist(v, p, at) {
    if (!v || !p || !p.def.shull || !at) return Infinity;
    localOf(v, at, _hq);
    const o = ownPt(p, _hq, _ho), d = ownDist(p.def, o.x, o.y, o.z);
    partOf(p, CP[0], CP[1], CP[2], HC);
    return d;
  }
  // The plate a blast at the sim point `at` meets on hull part p (armour.js thinnest for a hull, blastK: what it must beat
  // to reach her and what is inside): the face nearest it, its deck's, its side's (the belt within its band), its
  // bottom's (hullMm); 0 with the burst inside her
  function hullPlate(v, p, at) {
    if (!v || !p || !p.def.shull || !at) return 0;
    localOf(v, at, _hq);
    const o = ownPt(p, _hq, _ho), d = ownDist(p.def, o.x, o.y, o.z);
    return d > 0 && CF >= 0 ? hullMm(p, shullTris(p.def).code[CF], CP[1]) : 0;
  }
  // (own frame) the distance from (x, y, z) to the hull, its nearest point in CP and its triangle in CF; 0 inside (CP
  // the point itself, CF −1)
  let CF = -1;
  function ownDist(d, x, y, z) {
    CF = -1;
    if (insideOwn(d, x, y, z)) { CP[0] = x; CP[1] = y; CP[2] = z; return 0; }
    const T = shullTris(d), xs = T.xs, n = T.n;
    let best = Infinity;
    const test = (f0, f1) => { for (let f = f0; f < f1; f++) { const q = triDist2(T, f, x, y, z); if (q < best) { best = q; CF = f; CP[0] = TD[0]; CP[1] = TD[1]; CP[2] = TD[2]; } } };
    let i0 = 0;
    while (i0 + 2 < n && xs[i0 + 1] < x) i0++;
    for (let i = i0; i + 1 < n; i++) { const g = Math.max(0, xs[i] - x); if (g * g > best) break; test(T.slab[2 * i], T.slab[2 * i + 1]); }
    for (let i = i0 - 1; i >= 0; i--) { const g = Math.max(0, x - xs[i + 1]); if (g * g > best) break; test(T.slab[2 * i], T.slab[2 * i + 1]); }
    if ((x - xs[0]) ** 2 <= best || x < xs[0]) test(T.cap[0][0], T.cap[0][1]);
    if ((xs[n - 1] - x) ** 2 <= best || x > xs[n - 1]) test(T.cap[1][0], T.cap[1][1]);
    return Math.sqrt(best);
  }
  // the squared distance from (x, y, z) to triangle f, its nearest point in TD (Ericson's regions)
  const TD = [0, 0, 0];
  function triDist2(T, f, x, y, z) {
    const P = T.pos, ia = 3 * T.tri[3 * f], ib = 3 * T.tri[3 * f + 1], ic = 3 * T.tri[3 * f + 2];
    const ax = P[ia], ay = P[ia + 1], az = P[ia + 2], bx = P[ib], by = P[ib + 1], bz = P[ib + 2], cx = P[ic], cy = P[ic + 1], cz = P[ic + 2];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az, apx = x - ax, apy = y - ay, apz = z - az;
    const out = (qx, qy, qz) => { TD[0] = qx; TD[1] = qy; TD[2] = qz; return (x - qx) ** 2 + (y - qy) ** 2 + (z - qz) ** 2; };
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) return out(ax, ay, az);
    const bpx = x - bx, bpy = y - by, bpz = z - bz, d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return out(bx, by, bz);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); return out(ax + abx * t, ay + aby * t, az + abz * t); }
    const cpx = x - cx, cpy = y - cy, cpz = z - cz, d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return out(cx, cy, cz);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); return out(ax + acx * t, ay + acy * t, az + acz * t); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / (d4 - d3 + (d5 - d6)); return out(bx + (cx - bx) * t, by + (cy - by) * t, bz + (cz - bz) * t); }
    const k = 1 / (va + vb + vc), v1 = vb * k, w1 = vc * k;
    return out(ax + abx * v1 + acx * w1, ay + aby * v1 + acy * w1, az + abz * v1 + acz * w1);
  }

  // ---- holes (§8.4)
  // Holes torn in hull parts: rows [p, x, y, z, a] (part space, m²), or [p, x, y, a] (a grounding's, a slam's, a ram's:
  // on her centre line). Each one kept on its part (clamped into its box, at most HOLE.cap), past HOLE.max merged into the
  // nearest (their areas added, its patch shared out); a moored ship woken. t: when (the flight's clock). The number taken.
  function addHoles(v, rows, t) {
    const S = v && v.sh;
    if (!S || !Array.isArray(rows) || v.remote) return 0;
    const HO = SHIP.HOLE, now = Number.isFinite(t) ? t : clockOf(null);
    let n = 0;
    for (const r of rows) {
      if (!Array.isArray(r) || r.length < 4) continue;
      const p = r[0], five = r.length >= 5;
      if (!p || !p.def || !p.def.shull || !v.byId.has(p.id)) continue;
      const x = +r[1], y = +r[2], z = five ? +r[3] : partZ(p), a = +(five ? r[4] : r[3]);
      if (!(a > 0) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(a)) continue;
      const q = boxed(p, x, y, z), L = Array.isArray(p.holes) ? p.holes : (p.holes = []);
      if (L.length >= HO.max) {
        let j = null, jd = Infinity;
        for (const h of L) { const dd = (h.x - q.x) ** 2 + (h.y - q.y) ** 2 + (h.z - q.z) ** 2; if (dd < jd) { jd = dd; j = h; } }
        const A = Math.min(HO.cap, j.a + a);
        j.fix = (j.fix * j.a) / A; j.a = A; j.t = now;
      } else L.push({ x: q.x, y: q.y, z: q.z, a: Math.min(a, HO.cap), t: now, fix: 0 });
      n++;
    }
    if (n) { holesOf(S); unmoor(v); }
    return n;
  }
  // a point clamped into a part's box (part space)
  function boxed(p, x, y, z) {
    const D = partDims(p), zc = partZ(p), hd = partDepth(p) / 2;
    return { x: clamp(x, p.x - D.w / 2, p.x + D.w / 2), y: clamp(y, p.y - D.h / 2, p.y + D.h / 2), z: clamp(z, zc - hd, zc + hd) };
  }
  // each compartment's holes: its hull part's within its stretch of the part (a hole's own x)
  function holesOf(S) {
    for (const c of S.comps) c.holes = [];
    for (const p of S.hulls) {
      if (!Array.isArray(p.holes) || !p.holes.length) continue;
      const cs = S.comps.filter((c) => c.p === p);
      for (const h of p.holes) { const lx = ownPt(p, h, _ho).x; (cs.find((c) => lx <= c.hi + 1e-6) || cs[cs.length - 1]).holes.push(h); }
    }
  }
  // A round through a hull's plate (armour.js resolve: the way in, and out through her far side): HOLE.kin·π·(cal/2000)²,
  // glass fibre shattering to at least HOLE.grp
  function roundHole(p, cal) { const k = SHIP.HOLE.kin * Math.PI * ((cal || 7.6) / 2000) ** 2; return p.def.armour && p.def.armour.mat === 'grp' ? Math.max(k, SHIP.HOLE.grp) : k; }
  // A blast at `at` d m from hull part p (combat.js explode, for a hull part within its blast): the hole it tears at the
  // hull's nearest point, HOLE.he·blast²·(1 − d/blast), ×HOLE.tamp when it bursts more than tampD under the water (or
  // o.under: a torpedo's), + HOLE.heIn·blast² when it burst inside (o.inside: high explosive through the plate); and a
  // burst inside lights a fire. o.noHoles: none (a magazine makes its own).
  function blastHull(v, p, d, at, blast, by, sim, o) {
    const S = v && v.sh;
    if (!S || v.remote || !(blast > 0) || !(d < blast) || (o && o.noHoles)) return;
    const HO = SHIP.HOLE, r = Math.hypot(at.x, at.y, at.z), b = v.body;
    const deep = (S.level > -Infinity ? S.level : 0) - (r - b.radius), under = !!(o && o.under) || (b.ocean && deep > HO.tampD);
    hullDist(v, p, at);
    const inside = !!(o && o.inside) && d <= 0.05;
    const a = HO.he * blast * blast * (1 - Math.max(0, d) / blast) * (under ? HO.tamp : 1) + (inside ? HO.heIn * blast * blast : 0);
    if (a > 1e-5) addHoles(v, [[p, HC.x, HC.y, HC.z, a]], clockOf(sim));
    if (inside || d <= 0) { // (a burst inside the hull: a fire, in what is nearest it inside, else the hull)
      localOf(v, at, _hq);
      let q = p, qd = Infinity;
      for (const c of v.parts) if (c.def.inner && c.att === p.id && whole(v, c)) { const dd = Math.hypot(c.x - _hq.x, c.y - _hq.y, partZ(c) - _hq.z); if (dd < qd && dd < blast) { qd = dd; q = c; } }
      ignite(v, q, SHIP.FIRE.odds0 + SHIP.FIRE.odds1 * (blast / SHIP.FIRE.blast), by, sim, _hq);
    }
  }
  // A penetrating round's result on a hydro vessel (armour.js apply, R from resolve): its holes (R.ho), and a fire where
  // it went into an engine, a magazine or fuel (odds by its burst's size; a bullet's none)
  function roundHit(v, R, SH, by, sim) {
    const S = v && v.sh;
    if (!S || v.remote || !R) return;
    if (R.ho && R.ho.length) addHoles(v, R.ho, clockOf(sim));
    if (R.r !== 'pen') return;
    const blast = SH && (SH.blast || 0), odds = SHIP.FIRE.odds0 + SHIP.FIRE.odds1 * (blast / SHIP.FIRE.blast);
    if (!(blast > 0) && !(SH && SH.he > 0) && !((SH && SH.cal) >= SHIP.FIRE.cal)) return; // ([WP8] a bullet (no burst, under FIRE.cal mm) lights nothing: small arms are all but harmless to a warship, §8.12)
    for (const [p] of R.rows) if (p.def.engine || p.def.module === 'engine' || p.def.module === 'ammo' || p.def.module === 'fuel') { ignite(v, p, odds, by, sim); return; }
    for (const [h, i] of R.mods) { const k = h.def.mods[i].k; if (k === 'ammo' || k === 'fuel') { ignite(v, h, odds, by, sim, h.def.shull && R.at ? localOf(v, R.at, _hq) : null); return; } }
  }
  // A hull part at 0 hp (combat.js destroyPart's first line for a hull part aboard a hydro vessel): holed through, never
  // blown off: kept, broken, a HOLE.cap hole at its waterline amidships, its joints and bulkheads open (FLOOD.leak)
  function holedThrough(v, p, cause, sim) {
    const S = v && v.sh;
    if (!S || !p || !p.def.shull || !v.byId.has(p.id)) return false;
    p.hp = Math.min(p.hp ?? 0, 0);
    if (p.broken) return true;
    p.broken = true;
    const H = shullOf(p.def), X = partOf(p, (H.x0 + H.x1) / 2, H.wl, 0, v3());
    addHoles(v, [[p, X.x, X.y, X.z, SHIP.HOLE.cap]], clockOf(sim));
    if (v === (sim && sim.active) && !v.ai && sim.toast && !sim.destroyed) sim.toast(`${p.def.name} holed through!`, 'warn');
    void cause;
    return true;
  }

  // ---- compartments (Ship.groups: §3.3) and the water in them (§4.2's flood weight, §8.7)
  // A compartment's rings: its stretch lo..hi of the hull's own x in even steps of at most 3 m (at least two rings, at
  // most nine: a flood level is found by clipping them several times a second), with their trapezoid weights; its volume
  // to the deck and its whole centroid (own frame). Cached per def and stretch.
  const CR = new Map();
  function compRings(def, lo, hi) {
    let M = CR.get(def);
    if (!M) CR.set(def, (M = new Map()));
    const key = lo.toFixed(3) + ':' + hi.toFixed(3);
    let L = M.get(key);
    if (L) return L;
    const H = shullOf(def), m = clamp(Math.ceil((hi - lo) / 3), 1, 8), xs = [];
    for (let i = 0; i <= m; i++) xs.push(lo + ((hi - lo) * i) / m);
    const R = xs.map((x, i) => {
      const r = H.rings.find((q) => Math.abs(q.x - x) < 1e-9) || shullRing(def.shull, x);
      return { x, P: r.P, A: r.A, cy: r.cy, bd: r.bd, w: ((i + 1 < xs.length ? xs[i + 1] : x) - (i > 0 ? xs[i - 1] : x)) / 2 };
    });
    let V = 0, mx = 0, my = 0, B = 0;
    for (const r of R) { V += r.A * r.w; mx += r.A * r.w * r.x; my += r.A * r.w * r.cy; B = Math.max(B, 2 * r.bd); }
    L = { R, V, cx: V > 0 ? mx / V : (lo + hi) / 2, cy: V > 0 ? my / V : 0, beam: B || 1, len: hi - lo };
    M.set(key, L);
    return L;
  }
  // Ship.groups' compartments for hull part p (ci: the index of the first): its bulkheads (bulkhead parts hung on it, inside
  // its length) cut it; each stretch a compartment. Its rings each get the compartment their station lies in.
  function compsOf(v, p, out) {
    const H = shullOf(p.def), cuts = [];
    for (const q of v.parts) if (q.def.bulkhead && q.att === p.id && !q.broken) { const lx = ownPt(p, q, _ho).x; if (lx > H.x0 + 0.05 && lx < H.x1 - 0.05) cuts.push(lx); }
    cuts.sort((a, b) => a - b);
    for (let i = cuts.length - 1; i > 0; i--) if (cuts[i] - cuts[i - 1] < 0.3) cuts.splice(i, 1); // (bulkheads at one station, side by side: one cut, never a compartment with no room in it)
    const xs = [H.x0, ...cuts, H.x1], o = partPt(p, 0, 0), a = partPt(p, 1, 0), u = partPt(p, 0, 1);
    for (let i = 0; i + 1 < xs.length; i++) {
      const C = compRings(p.def, xs[i], xs[i + 1]);
      out.push({ parts: [p], p, lo: xs[i], hi: xs[i + 1], k: i, n: xs.length - 1, R: C.R, V: C.V, cx: C.cx, cy: C.cy, beam: C.beam, len: C.len,
        ox: o.x, oy: o.y, oz: partZ(p), ex: { x: a.x - o.x, y: a.y - o.y }, ey: { x: u.x - o.x, y: u.y - o.y }, W: 0, holes: [], lev: -Infinity, fs: 0, fc: null });
    }
    return cuts;
  }
  // the water carried into a rebuilt hull (the hull parts' compartments as they were, or a saved part's p.water): each
  // part's water shared among its compartments as they were (a saved part's: each compartment's own, p.wc), else by
  // their volume
  function carryWater(was, comps) {
    const by = new Map();
    if (was) for (const c of was.comps) { const e = by.get(c.p.id) || { W: 0, list: [] }; e.W += c.W || 0; e.list.push(c); by.set(c.p.id, e); }
    const parts = new Map();
    for (const c of comps) { const L = parts.get(c.p) || []; L.push(c); parts.set(c.p, L); }
    for (const [p, L] of parts) {
      const e = by.get(p.id), W = e ? e.W : Number.isFinite(p.water) ? p.water : 0;
      if (e && e.list.length === L.length) L.forEach((c, i) => { c.W = clamp(e.list[i].W || 0, 0, c.V); });
      else if (!e && Array.isArray(p.wc) && p.wc.length === L.length) L.forEach((c, i) => { c.W = clamp(+p.wc[i] || 0, 0, c.V); }); // ([WP8] a saved flight: each compartment's water where it was, never across a bulkhead)
      else { const V = L.reduce((s, c) => s + c.V, 0) || 1; for (const c of L) c.W = clamp((W * c.V) / V, 0, c.V); }
    }
    partWater(comps, parts.keys());
  }
  // each hull part's water (p.water: the HUD's, a save's) and, a part cut by bulkheads, each of its compartments' in
  // order (p.wc: a reload puts it back where it was)
  function partWater(comps, hulls) {
    for (const p of hulls) {
      let w = 0, n = 0;
      for (const c of comps) if (c.p === p) { w += c.W; n++; }
      p.water = w;
      if (n > 1) { const a = Array.isArray(p.wc) && p.wc.length === n ? p.wc : (p.wc = new Array(n)); let i = 0; for (const c of comps) if (c.p === p) a[i++] = c.W; }
      else if (p.wc) delete p.wc;
    }
  }
  // her flood heights: a point's height along U over her centre of mass is K.b + K.x·x + K.y·y + K.z·z (compartment c's
  // own frame); for the frame now (S.Ub)
  const KQ = { b: 0, x: 0, y: 0, z: 0 };
  function kOf(v, S, c, K) {
    const com = v.com, Ub = S.Ub;
    K.b = (c.ox - com.x) * Ub.x + (c.oy - com.y) * Ub.y + (c.oz - (com.z || 0)) * Ub.z;
    K.x = c.ex.x * Ub.x + c.ex.y * Ub.y; K.y = c.ey.x * Ub.x + c.ey.y * Ub.y; K.z = Ub.z;
    return K;
  }
  // The water under the level L in compartment c (K its heights): its volume, its centroid (own frame) and its free
  // surface's area, into CL
  const CL = { V: 0, x: 0, y: 0, z: 0, A: 0 }, CB = new Float64Array(64);
  function clipComp(c, K, L) {
    let V = 0, mx = 0, my = 0, mz = 0, Aw = 0;
    for (const r of c.R) {
      const P = r.P, n = P.length / 2, d0 = K.b + K.x * r.x - L;
      let m = 0, cs = 0, c0y = 0, c0z = 0, c1y = 0, c1z = 0, all = true;
      for (let j = 0; j < n; j++) {
        const k = j + 1 < n ? j + 1 : 0, ay = P[2 * j], az = P[2 * j + 1], by = P[2 * k], bz = P[2 * k + 1];
        const da = d0 + K.y * ay + K.z * az, db = d0 + K.y * by + K.z * bz, ia = da < 0, ib = db < 0;
        if (!ia) all = false;
        if (ia) { CB[m++] = ay; CB[m++] = az; }
        if (ia !== ib) {
          const s = da / (da - db), qy = ay + (by - ay) * s, qz = az + (bz - az) * s;
          CB[m++] = qy; CB[m++] = qz;
          if (cs++ === 0) { c0y = qy; c0z = qz; } else { c1y = qy; c1z = qz; }
        }
      }
      if (all) { V += r.A * r.w; mx += r.A * r.w * r.x; my += r.A * r.w * r.cy; continue; }
      const np = m / 2;
      if (np < 3) continue;
      let A2 = 0, sy = 0, sz = 0;
      for (let j = 0; j < np; j++) {
        const k = j + 1 < np ? j + 1 : 0, y0 = CB[2 * j], z0 = CB[2 * j + 1], y1 = CB[2 * k], z1 = CB[2 * k + 1], cr = y0 * z1 - y1 * z0;
        A2 += cr; sy += (y0 + y1) * cr; sz += (z0 + z1) * cr;
      }
      if (!(A2 > 1e-9)) continue;
      const a = A2 / 2;
      V += a * r.w; mx += a * r.w * r.x; my += (sy / 6) * r.w; mz += (sz / 6) * r.w;
      if (cs >= 2) Aw += mhypot(c1y - c0y, c1z - c0z) * r.w;
    }
    CL.V = V; CL.A = Aw;
    if (V > 1e-9) { CL.x = mx / V; CL.y = my / V; CL.z = mz / V; } else { CL.x = c.cx; CL.y = c.cy; CL.z = 0; }
    return CL;
  }
  // the span of compartment c's heights (its lowest and highest corner), into SP2
  const SP2 = [0, 0];
  function spanOf(c, K) {
    let lo = Infinity, hi = -Infinity;
    for (const r of c.R) { const P = r.P, d0 = K.b + K.x * r.x; for (let j = 0; j < P.length; j += 2) { const d = d0 + K.y * P[j] + K.z * P[j + 1]; if (d < lo) lo = d; if (d > hi) hi = d; } }
    SP2[0] = lo; SP2[1] = hi;
    return SP2;
  }
  // The flood level of compartment c (the height, K's, whose water under it is c.W: Newton from the last one, kept
  // inside the span's bracket, to a thousandth of the water or of the room left, whichever is less), its free surface
  // (c.fs) and the water's centroid in part space (c.fx, fy, fz); none aboard: −Infinity. Cached while W and her up (Ub)
  // move less than 1 % and 0.5°; [WP8] with her up held, a little more or less water moves the level by itself over the
  // last free surface: up to a tenth of the water or of the room left at the last solve, and a tenth of the way from its
  // level to the span's nearer end (a V keel's free surface grows as it fills, a full one's shrinks: solved again past
  // that). The solve's own water (the clip's, fc.W) is the start, so a solve short of c.W is made good by the next step.
  // [WP8] Under FLOOD.wMin m³ (a bucketful: her pumps keeping up with a few small holes, the water coming and going each
  // step) the level is the compartment's lowest point and its free surface none: no solve (a centimetre's error at most,
  // and no weight to speak of).
  const COS05 = Math.cos((0.5 * PI) / 180);
  function levelOf(v, S, c) {
    if (!(c.W > 1e-6)) { c.lev = -Infinity; c.fs = 0; return c.lev; }
    const K = kOf(v, S, c, KQ), Ub = S.Ub, f = c.fc;
    if (c.W < SHIP.FLOOD.wMin) { const lo = spanOf(c, K)[0]; c.lev = lo; c.fs = 0; setFc(c, K, lo, c.cx, c.cy, 0, Ub, 0, 0, 0); return lo; }
    if (f && Ub.x * f.ux + Ub.y * f.uy + Ub.z * f.uz > COS05) {
      const dW = c.W - f.W, room = f.W < c.V - f.W ? f.W : c.V - f.W, adW = mabs(dW);
      if (adW <= 0.01 * mmax(room, 1e-4)) { c.lev = f.L - (f.k - (K.b + K.x * c.cx)); return c.lev; } // (the plane moves with her centre of mass: its height over the compartment's centre kept)
      if (f.A > 1e-3 && adW <= 0.1 * room && adW <= 0.1 * f.A * f.d && c.W < c.V - 1e-6) { c.lev = f.L - (f.k - (K.b + K.x * c.cx)) + dW / f.A; return c.lev; } // ([WP8] a little more or less water: the level moves by it over the free surface)
    }
    const sp = spanOf(c, K);
    let lo = sp[0], hi = sp[1];
    const s0 = lo, s1 = hi;
    if (c.W >= c.V - 1e-6) { c.lev = hi; c.fs = 0; setFc(c, K, hi, c.cx, c.cy, 0, Ub); return hi; }
    let L = f && Number.isFinite(c.lev) ? mclamp(c.lev, lo, hi) : lo + (hi - lo) * (c.W / c.V), q = null;
    const tol = 1e-3 * (c.W < c.V - c.W ? c.W : c.V - c.W) + 1e-6;
    for (let it = 0; it < 12; it++) {
      q = clipComp(c, K, L);
      const e = c.W - q.V;
      if (mabs(e) <= tol) break;
      if (e > 0) lo = L; else hi = L;
      let nL = q.A > 1e-6 ? L + e / q.A : (lo + hi) / 2;
      if (!(nL > lo && nL < hi)) nL = (lo + hi) / 2;
      L = nL;
      q = null;
    }
    if (!q) q = clipComp(c, K, L);
    c.lev = L; c.fs = q.A;
    setFc(c, K, L, q.x, q.y, mclamp(q.z, -SHIP.FLOOD.fsMax * c.beam, SHIP.FLOOD.fsMax * c.beam), Ub, q.A, q.V, mmin(L - s0, s1 - L));
    return L;
  }
  function setFc(c, K, L, x, y, z, Ub, A, W, d) {
    const f = c.fc || (c.fc = { W: 0, ux: 0, uy: 0, uz: 0, L: 0, k: 0, x: 0, y: 0, z: 0, A: 0, d: 0 });
    f.W = W != null ? W : c.W; f.ux = Ub.x; f.uy = Ub.y; f.uz = Ub.z; f.L = L; f.k = K.b + K.x * c.cx; f.A = A || 0; f.d = d > 0 ? d : 0;
    f.x = c.ox + c.ex.x * x + c.ey.x * y; f.y = c.oy + c.ex.y * x + c.ey.y * y; f.z = c.oz + z;
  }
  // The flood water's weight (Ship.forces' marked line, every step): ρ·g·W straight down at each compartment's water's
  // centroid (the free surface's: level in the world, so the water runs to the low side as she heels), into hF/hT. Not
  // part of her mass (§19.3: water as weight). And a hull all but under with water aboard sinks against a drag on her plan.
  const _ff = v3(), _fX = v3();
  function floodForce(v, S, gl, vb, dt) {
    let W = 0;
    for (const c of S.comps) {
      if (!(c.W > 1e-6)) continue;
      levelOf(v, S, c);
      const f = c.fc, F = SHIP.RHO * gl * mmin(c.W, c.V);
      _ff.x = -S.Ub.x * F; _ff.y = -S.Ub.y * F; _ff.z = -S.Ub.z * F;
      _fX.x = f.x; _fX.y = f.y; _fX.z = f.z;
      push(v, _fX, _ff);
      W += c.W;
    }
    if (!(W > 0) || !(S.Vol > SHIP.FLOOD.under * (S.vtot || Infinity))) return;
    const u = vb.x * S.Ub.x + vb.y * S.Ub.y + vb.z * S.Ub.z, D = capF(-0.5 * SHIP.RHO * SHIP.FLOOD.sinkCd * (S.plan || 1) * u * mabs(u), u, v.mass, dt);
    _ff.x = S.Ub.x * D; _ff.y = S.Ub.y * D; _ff.z = S.Ub.z * D;
    push(v, v.com, _ff);
  }
  // her intact hull's volume (the physics rings') and plan area: what her buoyancy can be at most, and what a sinking
  // hull pushes down through
  function hullVol(S) {
    let V = 0, A = 0;
    for (const g of S.rings) { V += g.A * g.dx; A += 2 * g.R.bd * g.dx; }
    S.vtot = V; S.plan = A;
  }

  // ---- flooding (§8.7): FLOOD.hz times a second from Ship.frame
  // Water through each hole (and each open end, downflooded deck edge, broken boundary) by its head: Q = cd·a·√(2g·Δ),
  // Δ the water outside over the hole (the sea and its wave there) less the water inside over it, either way; never past
  // level in a step (the free surface's area × Δ); pumps on the fullest compartment while an engine runs. W in [0, V].
  const _hX = v3(), DW = [];
  function floodStep(v, dt, sim) {
    const S = v && v.sh;
    if (!S || !S.comps.length || v.remote || v.dead || v.wreck || !(dt > 0)) return;
    waterOf(v, S);
    if (!(S.level > -Infinity)) return;
    let busy = S.open.length > 0;
    for (const c of S.comps) if (c.W > 1e-6 || c.holes.length) { busy = true; break; }
    const r = frameOf(v, S), gl = v.body.mu / (r * r), h0 = r - v.body.radius - S.level, t = seaT(sim), FL = SHIP.FLOOD;
    // (downflooding: a deck edge under the water for FLOOD.downT s)
    const n = S.rings.length, deck = deckScan(v, S, h0, t, dt);
    if (!busy && !deck) { S.wet = null; S.flow = 0; return; }
    const comps = S.comps;
    DW.length = comps.length;
    for (let i = 0; i < comps.length; i++) { DW[i] = 0; levelOf(v, S, comps[i]); }
    FS.v = v; FS.S = S; FS.h0 = h0; FS.t = t; FS.g2 = 2 * gl; FS.dt = dt; FS.cd = FL.cd;
    const hOf = flHeight, sea = flowSea, g2 = FS.g2;
    for (let i = 0; i < comps.length; i++) { const L = comps[i].holes; for (let j = 0; j < L.length; j++) { const h = L[j], f = h.fix > 0 ? (h.fix < 1 ? h.fix : 1) : 0; sea(i, h.a * (1 - 0.9 * f), h, msqrt(h.a / PI)); } }
    // the open ends: the end ring's section under the water outside (or under the water inside, going out), at its keel
    for (const o of S.open) {
      const cs = comps.filter((c) => c.p === o.p), i = comps.indexOf(o.end === 'aft' ? cs[0] : cs[cs.length - 1]);
      if (i < 0) continue;
      const H = shullOf(o.p.def), R = o.end === 'aft' ? H.rings[0] : H.rings[H.nr - 1];
      partOf(o.p, R.x, R.yk, 0, _hX);
      const out = depthOf(v, S, _hX, h0, t), inn = comps[i].lev - hOf(_hX), head = mmax(out, inn, 0);
      if (!(head > 0)) continue;
      const a = shullArea(R.P, R.yk + mmin(head, R.yd - R.yk)).A; // (its area under the higher water)
      partOf(o.p, R.x, R.yk + mmin(head, R.yd - R.yk) / 3, 0, _hX); // (its centroid, near enough: a third up)
      sea(i, a, _hX);
    }
    // downflooding: each stretch of deck edge under the water past downT lets in downA per m of it
    if (deck) for (let k = 0; k < n; k++) {
      const g = S.rings[k];
      for (let s = 0; s < 2; s++) {
        if (S.dfT[2 * k + s] < FL.downT) continue;
        const j = s ? SHULL_K - 7 : 7;
        _hX.x = g.P[3 * j]; _hX.y = g.P[3 * j + 1]; _hX.z = g.P[3 * j + 2];
        sea(g.ci, FL.downA * g.dx, _hX);
      }
    }
    // broken boundaries: a hull holed through leaks to its joined neighbours and across its bulkheads
    const pair = (i, j, X) => {
      if (i < 0 || j < 0 || i === j) return;
      const A = comps[i], B = comps[j], hX = hOf(X), a = mmax(0, A.lev - hX), b = mmax(0, B.lev - hX), D = a - b;
      if (mabs(D) < 1e-5) return;
      let q = FL.cd * FL.leak * msqrt(g2 * mabs(D)) * dt;
      q = mmin(q, mabs(D) * mmax(mmin(A.fs || 1e9, B.fs || 1e9), 0.25 * mmin(A.len, B.len) * mmin(A.beam, B.beam)) / 2);
      if (D > 0) { q = mmin(q, A.W); DW[i] -= q; DW[j] += q; } else { q = mmin(q, B.W); DW[j] -= q; DW[i] += q; }
    };
    for (const [a, b] of S.joins) {
      if (!a.broken && !b.broken) continue;
      const ca = comps.filter((c) => c.p === a), cb = comps.filter((c) => c.p === b), H = shullOf(a.def), R = H.rings[H.nr - 1];
      pair(comps.indexOf(ca[ca.length - 1]), comps.indexOf(cb[0]), partOf(a, R.x, R.yk, 0, _hX));
    }
    for (let i = 0; i + 1 < comps.length; i++) {
      const A = comps[i], B = comps[i + 1];
      if (A.p !== B.p || !A.p.broken) continue;
      const sec = secAt(A.p.def.shull.st, A.hi, SEC2);
      pair(i, i + 1, partOf(A.p, A.hi, sec[1], 0, _hX));
    }
    // pumps: every hull's own and each whole pump (by its health) on the fullest compartment, while an engine runs (a
    // whole one above her flood water)
    let cap = 0, run = false;
    for (const p of S.engines) if (whole(v, p) && !(S.wet && S.wet.has(p))) { run = true; break; } // (an engine under her flood water gives nothing: §4.8)
    if (run) {
      for (const p of S.hulls) if (whole(v, p)) cap += p.def.shull.pump || 0;
      for (const e of machinesOf(v, S)) if (e.p.def.pump && whole(v, e.p)) cap += e.p.def.pump * hpFracOf(e.p);
    }
    let worst = -1, ws = 0;
    for (let i = 0; i < comps.length; i++) { const c = comps[i], f = (c.W + DW[i]) / c.V; if (c.W + DW[i] > 1e-6 && f > ws) { ws = f; worst = i; } }
    if (worst >= 0 && cap > 0) DW[worst] -= cap * dt;
    let moved = false, flow = 0;
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i], W = c.W + DW[i] < 1e-6 ? 0 : mclamp(c.W + DW[i], 0, c.V);
      if (W !== c.W) { flow += mabs(W - c.W); c.W = W; moved = true; }
    }
    S.flow = flow / dt; // (m³/s moved this step: Ship.busy)
    if (moved) partWater(comps, S.hulls);
    wetOf(v, S);
  }
  // (floodStep's) the flow between the sea and compartment i through a (m², at the part-space point X: a round hole r m
  // across its middle, or a point), by the water over each strip of it outside and inside (a hole astride the waterline
  // lets in what laps over its lower half), never past level in a step (the free surface's area × the head at its foot):
  // into DW[i]. FS: the step's ship, her height over the still water h0, the sea's clock t, 2g, dt
  const FS = { v: null, S: null, h0: 0, t: 0, g2: 0, dt: 0, cd: 0 };
  function flHeight(X) { const v = FS.v, U = FS.S.Ub, c = v.com; return (X.x - c.x) * U.x + (X.y - c.y) * U.y + (X.z - (c.z || 0)) * U.z; }
  function flowSea(i, a, X, r) {
    if (!(a > 0)) return;
    const v = FS.v, S = FS.S, c = S.comps[i], cd = FS.cd, g2 = FS.g2, hX = flHeight(X), lo = seaOver(v, S, X, hX), li = c.lev - hX;
    r = r > 0.05 ? r : 0;
    if (lo <= -r && li <= -r) return;
    if (r && (lo >= r || lo <= -r) && (li >= r || li <= -r)) r = 0; // (neither level crosses it: its middle's head is all of it's)
    let q = 0;
    if (!r) { const D = (lo > 0 ? lo : 0) - (li > 0 ? li : 0); q = D >= 0 ? cd * a * msqrt(g2 * D) : -cd * a * msqrt(-g2 * D); }
    else {
      for (let k = 0; k < 6; k++) { // (six strips up the hole, each its own head)
        const z = -r + ((k + 0.5) * r) / 3, w = 2 * msqrt(r * r - z * z) * (r / 3), D = (lo > z ? lo - z : 0) - (li > z ? li - z : 0);
        q += D >= 0 ? cd * w * msqrt(g2 * D) : -cd * w * msqrt(-g2 * D);
      }
      q *= a / (PI * r * r);
    }
    const ho = lo + r > 0 ? lo + r : 0, hi = li + r > 0 ? li + r : 0, fa = 0.25 * c.len * c.beam, cap = (ho > hi ? ho - hi : hi - ho) * (c.fs > fa ? c.fs : fa), dq = q * FS.dt;
    DW[i] += dq > cap ? cap : dq < -cap ? -cap : dq;
  }
  // how deep a part-space point X is under the sea outside her (+ under: its wave there), hX its height over her centre of
  // mass along her up (depthOf's, the wave's height alone)
  function seaOver(v, S, X, hX) {
    let eta = 0;
    if (S.fade > 0) {
      const c = v.com, ox = X.x - c.x, oy = X.y - c.y, oz = X.z - (c.z || 0), e = S.e0 + ox * S.Eb.x + oy * S.Eb.y + oz * S.Eb.z, n = S.n0 + ox * S.Nb.x + oy * S.Nb.y + oz * S.Nb.z, t = FS.t;
      for (let i = 0; i < NW; i++) eta += WA[i] * msin(WK[i] * (WDE[i] * e + WDN[i] * n) - WO[i] * t + WP[i]);
      eta *= S.fade;
    }
    return -(FS.h0 + hX - eta);
  }
  // Her deck edges against the sea (FLOOD.hz, floodStep): how long each has been under (S.dfT: downflooding past
  // FLOOD.downT; a ship's only), and how deep her highest deck edge is (S.deckMin, + under: the fate's "every deck under"). A deck edge
  // higher over the still water than the highest wave can reach skips the waves. true: some edge is past downT.
  function deckScan(v, S, h0, t, dt) {
    const n = S.rings.length, U = S.Ub, c = v.com, cz = c.z || 0, open = v.kind === 'ship'; // (a ship's deck has its hatches and vents; a float's, an amphibious tank's hull under its hull, are sealed)
    let wm = 0;
    for (let i = 0; i < NW; i++) wm += mabs(WA[i]);
    wm = wm * (S.fade || 0) + 0.01;
    if (!S.dfT || S.dfT.length !== 2 * n) S.dfT = new Float32Array(2 * n);
    let past = false, top = Infinity;
    for (let i = 0; i < n; i++) {
      const g = S.rings[i];
      for (let s = 0; s < 2; s++) {
        const j = s ? SHULL_K - 7 : 7, x = g.P[3 * j], y = g.P[3 * j + 1], z = g.P[3 * j + 2], still = -(h0 + (x - c.x) * U.x + (y - c.y) * U.y + (z - cz) * U.z);
        let dep = still;
        if (still > -wm) { _hX.x = x; _hX.y = y; _hX.z = z; dep = depthOf(v, S, _hX, h0, t); }
        if (dep < top) top = dep;
        S.dfT[2 * i + s] = dep > 0 && open ? S.dfT[2 * i + s] + dt : 0;
        if (S.dfT[2 * i + s] >= SHIP.FLOOD.downT) past = true;
      }
    }
    S.deckMin = top;
    return past;
  }
  // the engines (and pumps) under her flood water now (Ship.shaftPower leaves them out: §4.8's engine flooding, through
  // its compartment): Ship.wetAt
  function wetOf(v, S) {
    let any = false;
    for (const c of S.comps) if (c.W > 1e-6) { any = true; break; }
    if (!any) { S.wet = null; return; }
    const set = S.wet || (S.wet = new Set());
    set.clear();
    for (const e of machinesOf(v, S)) {
      const c = e.c, p = e.p;
      if (!c || !(c.W > 1e-6)) continue;
      const h = (p.x - v.com.x) * S.Ub.x + (p.y - v.com.y) * S.Ub.y + (e.z - (v.com.z || 0)) * S.Ub.z;
      if (h < c.lev) set.add(p);
    }
  }
  // her engines and pumps (not a hull's own), each with its compartment and depth: worked out once a rebuild (Ship.groups)
  function machinesOf(v, S) {
    if (S.mach && S.machN === v.parts.length) return S.mach;
    const L = [];
    for (const p of v.parts) if ((p.def.engine || p.def.pump) && !p.def.shull) { const z = partZ(p); L.push({ p, z, c: compAt(v, S, p, z) }); }
    S.mach = L; S.machN = v.parts.length;
    return L;
  }
  // the compartment a part-space point lies in (its hull part by its host, else by insideHull), or null
  function compAt(v, S, p, z) {
    let H = p.att != null ? v.byId.get(p.att) : null;
    if (!H || !H.def.shull) { _hX.x = p.x; _hX.y = p.y; _hX.z = z; const h = insideHull(v, _hX); H = h ? h.p : null; }
    if (!H) return null;
    const lx = ownPt(H, p, _ho).x;
    let last = null;
    for (const c of S.comps) if (c.p === H) { last = c; if (lx <= c.hi + 1e-6) return c; }
    return last;
  }
  function wetAt(v, p) { return !!(v && v.sh && v.sh.wet && v.sh.wet.has(p)); }
  // Is damage being done or fought aboard her (flight.js canRails: no rails warp then, as with her engines running; the
  // rails never step her flooding, fires or damage control)? A fire burning, water moving in or out of her, or her
  // damage control at a job (a hole to patch, a part to mend)
  function busy(v) {
    const S = v && v.sh;
    if (!S || v.dead) return false;
    for (const p of v.parts) if (p.fire > 0) return true;
    if (S.flow > 1e-3) return true;
    if (S.dc) for (const e of S.dc) if (e.job) return true;
    return false;
  }

  // ---- fires (§8.8): FIRE.hz times a second
  // A part lit (p.fire = 1) with the odds given (the damage's dice); a part under her flood water or the sea doesn't catch
  function ignite(v, p, odds, by, sim, at) {
    if (!v || !v.sh || !p || !whole(v, p) || p.fire > 0 || !(rnd() < odds)) return false;
    p.fire = 1; p.fireBy = by || null;
    if (p.def.shull) p.fireAt = at && Number.isFinite(at.x) && Number.isFinite(at.y) && Number.isFinite(at.z) ? boxed(p, at.x, at.y, at.z) : null; // (a hull burns where it was lit: at (part space), else its middle)
    if (v === (sim && sim.active) && !v.ai && sim.toast && !sim.destroyed) sim.toast(`Fire in the ${p.def.name}!`, 'warn');
    return true;
  }
  // Is the fire in part p drowned? Inside her hull (a hull part's own, or a part within its plating) only by the flood
  // water in its compartment over it, the sea outside the plating never (a dry engine room burns, down there too); a part
  // outside her hull (on deck, the superstructure) by the sea over it; any once she has gone under. k: p's place in the
  // layout (layoutOf: which hull it is inside, if any)
  const _fw = v3();
  function drowned(v, S, p, k, L) {
    if (v.sunk != null) return true;
    if (k >= 0 && !p.def.shull) { _fw.x = L.x[k]; _fw.y = L.y[k]; _fw.z = L.z[k]; } else fireSpot(p, _fw);
    const H = p.def.shull ? p : k >= 0 ? L.in[k] : insideHull(v, _fw) ? IH.p : null;
    if (!H) { if (!FW.ok) { const r = frameOf(v, S); FW.h0 = r - v.body.radius - S.level; FW.t = seaT(FW.sim); FW.ok = true; } return depthOf(v, S, _fw, FW.h0, FW.t) > 0.3; }
    const lx = ownPt(H, _fw, _ho).x;
    let c = null;
    for (const q of S.comps) if (q.p === H) { c = q; if (lx <= q.hi + 1e-6) break; }
    if (!c || !(c.W > 1e-6)) return false;
    levelOf(v, S, c);
    return (_fw.x - v.com.x) * S.Ub.x + (_fw.y - v.com.y) * S.Ub.y + (_fw.z - (v.com.z || 0)) * S.Ub.z < c.lev;
  }
  const FW = { ok: false, h0: 0, t: 0, sim: null }; // (fireStep's: her height over the water, looked at once a step if a fire outside her hull asks)
  function fireStep(v, dt, sim) {
    const S = v && v.sh;
    if (!S || v.remote || v.dead || v.wreck || !(dt > 0)) return;
    let n = 0;
    for (const p of v.parts) if (p.fire > 0) { n++; break; }
    if (!n) return;
    const F = SHIP.FIRE, M = SHIP.MAG, list = FIRES, mags = MAGN, fought = FOUGHT, thr = S.threat || (S.threat = new Set());
    list.length = 0; fought.clear(); thr.clear();
    if (S.dc) for (const e of S.dc) if (e.at && e.job && e.job.kind === 'fire') fought.add(e.job.o); // (the fires a party is at work on: [WP8] they keep a magazine beside them cool)
    for (const p of v.parts) if (p.fire > 0) list.push(p); // (the fires burning as the step starts: one lit by them burns from the next)
    const P = layoutOf(v, S), C = v.gv && typeof Armour !== 'undefined' ? crewAt(v, S) : null; // (where her parts and crew are)
    FW.ok = false; FW.sim = sim;
    const cr2 = F.crewR * F.crewR, reach = mmax(F.spreadR, M.near);
    mags.clear();
    let drawn = 0;
    for (const p of list) {
      if (!v.byId.has(p.id)) { p.fire = 0; continue; }
      if (p.fire > 1) p.fire = 1; // (armour.js lights an engine with seconds of fire: a ship's burns until it is fought)
      const k0 = P.p.indexOf(p);
      if (drowned(v, S, p, k0, P) || (p.hp != null && p.hp <= 0 && !p.def.shull)) { p.fire = 0; continue; } // (drowned, or burnt out)
      if (typeof Combat !== 'undefined') Combat.damage(v, p, F.hp * dt, 'fire', sim, p.fireBy || undefined);
      if (!v.byId.has(p.id)) { p.fire = 0; continue; }
      if (p.def.shull && p.broken) { p.fire = 0; continue; } // (a hull burnt through: nothing left to burn)
      const f = k0 >= 0 && !p.def.shull ? ((_fs.x = P.x[k0]), (_fs.y = P.y[k0]), (_fs.z = P.z[k0]), _fs) : fireSpot(p, _fs), fx = f.x, fy = f.y, fz = f.z; // (where it burns: a hull's fire where it was lit, not anywhere along her)
      // the crew within FIRE.crewR m
      if (C) for (let k = 0; k < C.n; k++) {
        const e = C.list[k], ex = C.x[k] - fx, ey = C.y[k] - fy, ez = C.z[k] - fz;
        if (!e.alive || ex * ex + ey * ey + ez * ez > cr2) continue;
        if (e.i >= 0) Armour.modDamage(v, e.host, e.i, F.crew * dt, sim, p.fireBy || undefined);
        else if (typeof Combat !== 'undefined') Combat.damage(v, e.part, F.crew * dt, 'fire', sim, p.fireBy || undefined);
      }
      // it spreads (a hull it spreads to burns from where it came in), and a magazine near it (or burning itself) for
      // MAG.t s while nobody fights it goes up (one clock a magazine, however many fires are near it; held while a party is
      // at work on every one of them, started again once none is near)
      if (p.def.module === 'ammo') heat(mags, thr, p, p, fought);
      for (let k = 0; k < P.n; k++) {
        const q = P.p[k], qx = P.x[k] - fx, qy = P.y[k] - fy, qz = P.z[k] - fz, r = reach + P.hw[k];
        if (q === p || qx * qx + qy * qy + qz * qz >= r * r || !whole(v, q)) continue; // (out of reach of its box, a hull's: of it too)
        const dd = q.def.shull ? boxDistOwn(q, P, k, fx, fy, fz) : msqrt(qx * qx + qy * qy + qz * qz) - P.hw[k];
        if (!(q.fire > 0) && dd < F.spreadR && rnd() < F.spread * dt) { q.fire = 1; q.fireBy = p.fireBy; if (q.def.shull) q.fireAt = boxed(q, fx, fy, fz); }
        if (q.def.module === 'ammo' && dd < M.near) heat(mags, thr, q, p, fought);
      }
      // black smoke from it (the view's ship and those near: FX's caps): a hull's from her deck over the fire. [WP8] Three
      // of her fires at most, a puff every other step each, rising off her (the black preset's lift): a burning boat stays
      // in sight (seven or more fires once her crew abandon her hid a patrol boat in the gunner's sight). FX's own dice,
      // never the simulation's.
      if (drawn < 3 && typeof FX !== 'undefined' && FX.smoke && v.body) {
        drawn++;
        let w;
        if (p.def.shull) { const lx = ownPt(p, f, _ho).x, sec = secAt(p.def.shull.st, lx, SEC2); w = partOf(p, lx, sec[0], fz - partZ(p), _fd); w = v.toWorld(w.x, w.y, w.z); }
        else w = v.toWorld(p.x, p.y + p.def.h / 2, partZ(p));
        const up = Math.hypot(w.x, w.y, w.z) || 1;
        if (FX.rnd() < 0.5) { _fv.x = v.vx * 0.9 + (w.x / up) * 3; _fv.y = v.vy * 0.9 + (w.y / up) * 3; _fv.z = v.vz * 0.9 + (w.z / up) * 3; FX.smoke(v.body, w, _fv, 'black', 0.9); }
        if (FX.rnd() < 0.6) FX.add({ kind: 'fire', b: v.body, x: w.x, y: w.y, z: w.z, vx: v.vx * 0.9, vy: v.vy * 0.9, vz: v.vz * 0.9, max: 0.4, size: 1.1, grow: 1.4, color: '#ff8a30', alpha: 1 });
      }
    }
    for (const q of v.parts) if (q.magT && !mags.has(q)) q.magT = 0; // (no fire near it now: its clock starts again)
    for (const [q, hot] of mags) if (hot) { q.magT = (q.magT || 0) + dt; if (q.magT >= M.t && whole(v, q)) magazine(v, sim, q); }
    mags.clear();
  }
  // (fireStep's) magazine q has fire p near it (or in it): p threatens a magazine (damage control fights it first), and
  // q's clock runs unless a party is at work on p (and on every other fire near q)
  function heat(mags, thr, q, p, fought) {
    thr.add(p);
    if (!fought.has(p)) mags.set(q, true);
    else if (!mags.has(q)) mags.set(q, false);
  }
  // where part p burns (part space): a hull's fire where it was lit or came in (p.fireAt; else its middle), a part's
  // its middle
  const MAGN = new Map(), FOUGHT = new Set(), FIRES = [], _fs = v3(), _fd = v3(), _fv = v3();
  function fireSpot(p, o) {
    const a = p.def.shull && p.fireAt;
    if (a && Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z)) { o.x = a.x; o.y = a.y; o.z = a.z; }
    else { o.x = p.x; o.y = p.y; o.z = partZ(p); }
    return o;
  }
  // her parts' middles (part space) and each one's reach from it (a hull's half diagonal, else its half size): what a
  // fire looks at, worked out again when her parts change
  function layoutOf(v, S) {
    const L = S.lay;
    if (L && L.of === v.parts && L.n === v.parts.length) return L;
    const n = v.parts.length, o = { of: v.parts, n, p: v.parts.slice(), x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), hw: new Float64Array(n), hd: new Float64Array(n), in: new Array(n) };
    for (let k = 0; k < n; k++) {
      const q = v.parts[k], d = q.def;
      o.x[k] = q.x; o.y[k] = q.y; o.z[k] = partZ(q); o.hd[k] = partDepth(q) / 2; o.hw[k] = d.shull ? mhypot(d.w, d.h, partDepth(q)) / 2 : mmax(d.w, d.h) / 2;
      _fw.x = q.x; _fw.y = q.y; _fw.z = o.z[k]; o.in[k] = d.shull ? q : insideHull(v, _fw) ? IH.p : null; // (the hull it is inside)
    }
    return (S.lay = o);
  }
  // where her crew are now (part space), for the fires: { list, n, x, y, z }
  function crewAt(v, S) {
    const list = Armour.crewOf(v).crew, L = S.crw;
    if (L && L.list === list && L.n === list.length && L.of === v.parts) return L;
    const n = list.length, o = { list, n, of: v.parts, x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n) };
    for (let k = 0; k < n; k++) {
      const e = list[k], h = e.host, q = e.i >= 0 ? h.def.mods[e.i].at : null;
      o.x[k] = q ? h.x + q[0] * h.def.w : e.part.x; o.y[k] = q ? h.y + q[1] * h.def.h : e.part.y; o.z[k] = q ? partZ(h) + q[2] * partDepth(h) : partZ(e.part);
    }
    return (S.crw = o);
  }
  // the distance (m) from a part-space point to hull part q's box (0 inside it): near enough for a fire's reach
  function boxDistOwn(q, L, k, x, y, z) {
    const d = q.def, dx = x - L.x[k], dy = y - L.y[k], r = q.rot & 3, ox = r === 1 ? dy : r === 2 ? -dx : r === 3 ? -dy : dx, oy = r === 1 ? -dx : r === 2 ? -dy : r === 3 ? dx : dy; // (ownPt's turn)
    const ax = mabs(ox) - d.w / 2, ay = mabs(oy) - d.h / 2, az = mabs(z - L.z[k]) - L.hd[k];
    return msqrt((ax > 0 ? ax * ax : 0) + (ay > 0 ? ay * ay : 0) + (az > 0 ? az * az : 0));
  }

  // ---- magazines (§8.8)
  // How many rounds a magazine part holds now: a shell magazine's store, a missile launcher's missiles (MAG.missile
  // rounds each), a tank's rack
  function roundsOf(p) {
    const d = p.def;
    if (d.store && Number.isFinite(d.store.rounds)) return Number.isFinite(p.rounds) ? p.rounds : d.store.rounds;
    if (d.weapon && d.weapon.kind === 'missile') return (Number.isFinite(p.ammo) ? p.ammo : d.weapon.ammo || 0) * SHIP.MAG.missile;
    if (d.rack) return Number.isFinite(p.rounds) ? p.rounds : d.rack.rounds || 0;
    return 0;
  }
  // A magazine aboard a hydro vessel goes up (armour.js moduleDown / cookOff for her ammunition; a fire beside it for
  // MAG.t s): a blast of MAG.r0 + rounds·MAG.rk m there, a MAG.hole hole low in every compartment within it, and with
  // MAG.brk rounds or more the hull part it is in is gone: she breaks in two (each piece an open end) and every piece is
  // doomed 'magazine'. rounds: how many went up (none: the part's). true: handled.
  const _mg = v3();
  function magazine(v, sim, part, rounds) {
    const S = v && v.sh;
    if (!S || !part || v.remote || v.dead) return false;
    if (part.magUp) return true;
    part.magUp = true; part.fire = 0;
    const n = Number.isFinite(rounds) ? rounds : roundsOf(part), M = SHIP.MAG;
    if (part.def.store) part.rounds = 0;
    if (!(n > 0)) { if (sim && v === sim.active && sim.toast && !v.ai) sim.toast(`${part.def.name} destroyed`, 'warn'); return true; }
    const R = M.r0 + n * M.rk, b = v.body, c = partOf(part, 0, 0, 0, _mg), P = v.toWorld(c.x, c.y, c.z), by = part.fireBy || v.lastHitBy || undefined;
    // the hull it is in or on (its host, else the hull round it)
    let H = part.att != null ? v.byId.get(part.att) : null;
    if (!H || !H.def.shull) { const h = insideHull(v, c); H = h ? h.p : S.hulls.reduce((m, q) => (!m || Math.hypot(q.x - c.x, q.y - c.y) < Math.hypot(m.x - c.x, m.y - c.y) ? q : m), null); }
    const brk = n >= M.brk && H;
    if (brk) doom(v, sim, 'magazine', by === v ? undefined : by);
    // a hole in every compartment within its reach, where the blast meets it: its plating nearest the magazine
    const rows = [];
    for (const k of S.comps) { const d = plateNear(k, c, _pn); if (d <= R) rows.push([k.p, _pn.x, _pn.y, _pn.z, M.hole]); }
    addHoles(v, rows, clockOf(sim));
    if (typeof Combat !== 'undefined' && sim && sim.vessels) Combat.explode(b, P, R, M.dmg + n * M.dmgK, by, sim, false, undefined, undefined, undefined, { noHoles: true });
    if (typeof Death !== 'undefined' && Death.deathFX) Death.deathFX(v, sim, 'ammo', clamp(R / 4, 3, 9), P);
    if (sim && v === sim.active && sim.toast && !v.ai && !brk) sim.toast(`${part.def.name} went up!`, 'warn');
    if (brk && v.byId.has(H.id) && !v.dead) breakAt(v, sim, H, part);
    return true;
  }
  // The plating of compartment k nearest the part-space point X (its sides, deck and bottom within its stretch of its
  // hull part, not an open joint's end): the point into o (part space), the distance (m)
  const _pn = v3(), PN = [0, 0, 0];
  function plateNear(k, X, o) {
    const p = k.p, T = shullTris(p.def), xs = T.xs, n = T.n, q = ownPt(p, X, _ho), x = q.x, y = q.y, z = q.z;
    let best = Infinity;
    const test = (f0, f1) => { for (let f = f0; f < f1; f++) { if (T.code[f] === -9) continue; const d = triDist2(T, f, x, y, z); if (d < best) { best = d; PN[0] = TD[0]; PN[1] = TD[1]; PN[2] = TD[2]; } } };
    for (let i = 0; i + 1 < n; i++) if (xs[i + 1] >= k.lo - 1e-6 && xs[i] <= k.hi + 1e-6) test(T.slab[2 * i], T.slab[2 * i + 1]);
    if (k.k === 0) test(T.cap[0][0], T.cap[0][1]);
    if (k.k === k.n - 1) test(T.cap[1][0], T.cap[1][1]);
    if (best === Infinity) { partOf(p, (k.lo + k.hi) / 2, 0, 0, o); return Math.hypot(o.x - X.x, o.y - X.y, o.z - X.z); }
    partOf(p, clamp(PN[0], k.lo, k.hi), PN[1], PN[2], o);
    return Math.sqrt(best);
  }
  // A gun's ready rounds going up on its mount aboard a ship (armour.js cookOff, a built-in store: never a magazine's
  // rule): a blast at the store (sim point P) of MAG.rack's size, the mount and what is near it wrecked, a hole where it
  // meets the hull (the deck under it: Combat.explode's blastHull); no keel holes, never her back broken. true: handled
  function rack(v, sim, host, P, rounds) {
    if (!v || !v.sh || v.remote || v.dead || !P) return false;
    const K = SHIP.MAG.rack, n = Number.isFinite(rounds) && rounds > 0 ? rounds : 0, by = v.lastHitBy && v.lastHitBy !== v ? v.lastHitBy : undefined;
    if (n > 0 && typeof Combat !== 'undefined' && sim && sim.vessels) Combat.explode(v.body, P, K.r0 + n * K.rk, K.dmg + n * K.dmgK, by, sim, false);
    if (n > 0 && typeof Death !== 'undefined' && Death.deathFX) Death.deathFX(v, sim, 'ammo', clamp((K.r0 + n * K.rk) / 3, 1, 4), P);
    if (sim && v === sim.active && sim.toast && !v.ai && !sim.destroyed) sim.toast(`${host && host.def ? host.def.name : 'Mount'}: ready rounds went up`, 'warn');
    return true;
  }
  // She breaks where hull part H was: it is gone (and the magazine with it), the rest falls into pieces (each a hydro
  // vessel, each with an open end), every one of them doomed 'magazine', the pieces into the flight
  function breakAt(v, sim, H, part, why = 'magazine') { // ([WP9] why: a torpedo under her keel breaks her back 'sunk')
    const gone = [H];
    if (part && part !== H && v.byId.has(part.id)) gone.push(part);
    for (const p of gone) {
      v.parts = v.parts.filter((q) => q !== p);
      for (const nb of v.adj.get(p.id) || []) v.adj.get(nb) && v.adj.get(nb).delete(p.id);
      v.adj.delete(p.id);
      if (typeof FX !== 'undefined' && FX.explosion && v.body) FX.explosion(v.body, v.toWorld(p.x, p.y, partZ(p)), { x: v.vx * 0.2, y: v.vy * 0.2, z: v.vz * 0.2 }, Math.max(p.def.w, p.def.h) * 0.6, false);
    }
    if (!v.parts.length) { v.dead = true; return; }
    const pieces = v.splitComponents();
    v.rebuildGroups();
    for (const q of pieces) {
      q.isDebris = !q.control;
      if (sim && Array.isArray(sim.vessels)) sim.vessels.push(q);
      if (q.sh) { q.fate = why; q.doomed = clockOf(sim); q.doomBy = v.doomBy || null; }
    }
    if (v.sh && !v.fate) doom(v, sim, why);
  }

  // ---- damage control (§8.8): FATE.hz times a second
  // Each Damage Control Party (a dcLocker: four 'dc' crew, its strength the living ones' share) walks DC.walk m/s along
  // her to a job and does it: patches a hole (DC.patch m²/s, at least DC.minT s; never in a compartment past DC.full),
  // puts out a fire (FIRE.dc s), mends a broken engine, gun, ring or radar (DC.repair × armour.js's REPAIR_T). A ship with
  // no locker has one party of her bridge crew at DC.bridge the rate. Jobs by sh.dcPri: 'auto' flooding first when a
  // compartment is past DC.flood full, else fires, else repairs, else the holes left; 'flood', 'fire' first. [WP8] A fire
  // beside a magazine (fireStep's S.threat) comes first in 'auto' and 'fire' (a party at work on it keeps the magazine
  // cool: MAG.t runs only while nobody fights it), and of the fires the nearest. A doomed ship's crew abandon her, as does
  // a derelict's (nobody at a helm).
  function partyList(v, S) {
    const key = v.parts.length;
    if (S.dc && S.dcN === key) return S.dc;
    const was = S.dc || [], out = [];
    for (const p of v.parts) if (p.def.mods && p.def.mods.some((m) => m.role === 'dc')) out.push(was.find((e) => e.host === p) || { host: p, s: Number.isFinite(p.dcS) ? p.dcS : alongOf(S, p), job: null, prog: 0 }); // ([WP8] p.dcS: where a saved flight left the party)
    if (!out.length) { const c = v.control || v.parts.find((p) => p.def.control); if (c) out.push(was.find((e) => e.host === c) || { host: c, s: Number.isFinite(c.dcS) ? c.dcS : alongOf(S, c), job: null, prog: 0, bridge: true }); }
    S.dc = out; S.dcN = key;
    return out;
  }
  const alongOf = (S, X) => X.x * S.ax.x + X.y * S.ax.y;
  function strengthOf(v, e) {
    if (!v.byId.has(e.host.id) || e.host.broken) return 0;
    if (!v.gv || typeof Armour === 'undefined') return e.bridge ? SHIP.DC.bridge : 1;
    let n = 0, all = 0;
    for (const c of Armour.crewOf(v).crew) { if (c.host !== e.host) continue; all++; if (c.alive && (e.bridge || c.base === 'dc')) n++; }
    return e.bridge ? (n ? SHIP.DC.bridge : 0) : n / SHIP.DC.party;
  }
  function dcStep(v, dt, sim) {
    const S = v && v.sh;
    if (!S || v.remote || v.dead || v.wreck || !(dt > 0)) return;
    if (v.fate || !v.control) { if (S.dc) for (const e of S.dc) e.at = false; return; } // (a doomed ship's crew, or a derelict's, abandon her)
    const D = SHIP.DC, list = partyList(v, S), taken = new Set();
    for (const e of list) {
      const k = strengthOf(v, e);
      e.at = false; // (at work on its job this step: fireStep's fought fires)
      if (!(k > 0)) { e.job = null; continue; }
      if (e.job && !jobOk(v, S, e.job)) e.job = null;
      const hot = !!e.job && e.job.kind === 'fire' && !!S.threat && S.threat.has(e.job.o); // ([WP8] a fire beside a magazine: never left for another job)
      if (!e.job || (!hot && ((S.dcPri === 'auto' && e.job.kind !== 'flood' && floodJob(v, S, taken)) || ((S.dcPri === 'auto' || S.dcPri === 'fire') && threatJob(v, S, taken, e))))) { e.job = pickJob(v, S, taken, e); e.prog = 0; }
      if (!e.job) continue;
      taken.add(e.job.o);
      const s = jobS(S, e.job), ds = s - e.s;
      if (Math.abs(ds) > 1) { e.s += Math.sign(ds) * Math.min(Math.abs(ds), D.walk * dt); e.host.dcS = e.s; continue; } // (where the party is: a save keeps it)
      e.at = true;
      const j = e.job;
      if (j.kind === 'hole' || j.kind === 'flood') {
        const h = j.o, T = Math.max(D.minT, h.a / D.patch);
        h.fix = Math.min(1, (h.fix || 0) + (k * dt) / T);
        if (h.fix >= 1) e.job = null;
      } else if (j.kind === 'fire') {
        j.o.fire = Math.max(0, j.o.fire - (k * dt) / SHIP.FIRE.dc);
        if (!(j.o.fire > 0)) { e.job = null; if (v === sim.active && sim.toast && !v.ai) sim.toast(`Fire in the ${j.o.def.name} out`, 'info'); }
      } else if (j.kind === 'repair') {
        e.prog += k * dt;
        if (e.prog >= j.T) {
          const p = j.o;
          p.broken = false; p.hp = Math.max(p.hp ?? 0, 0.6 * (typeof Combat !== 'undefined' ? Combat.maxHp(p.def) : p.def.hp || 100)); p.fire = 0;
          if (v === sim.active && sim.toast && !v.ai) sim.toast(`${p.def.name} repaired`, 'info');
          e.job = null;
        }
      }
    }
  }
  const REP = { engine: 15, breech: 12, ring: 12, radar: 12, sight: 10, launcher: 12 }; // (armour.js's REPAIR_T: what a party mends, and its seconds)
  function repT(m) { return (typeof Armour !== 'undefined' && Armour.REPAIR_T && Armour.REPAIR_T[m]) || REP[m] || 0; }
  function jobOk(v, S, j) {
    const o = j.o;
    if (j.kind === 'hole' || j.kind === 'flood') { const c = S.comps.find((q) => q.holes.includes(o)); return !!c && (o.fix || 0) < 1 && c.W / c.V <= SHIP.DC.full; }
    if (j.kind === 'fire') return o.fire > 0 && v.byId.has(o.id);
    return v.byId.has(o.id) && (o.broken || hpFracOf(o) < 0.5);
  }
  const _js = v3(), jobS = (S, j) => alongOf(S, j.kind === 'fire' ? fireSpot(j.o, _js) : j.o); // (a hole's place, a fire's (a hull's where it burns), or a part's)
  // the worst hole to patch in a compartment past DC.flood full (and under DC.full), not taken
  function floodJob(v, S, taken) {
    let best = null, bf = SHIP.DC.flood;
    for (const c of S.comps) {
      const f = c.W / c.V;
      if (f <= bf || f > SHIP.DC.full) continue;
      const h = c.holes.filter((q) => (q.fix || 0) < 1 && !taken.has(q)).sort((a, b) => b.a * (1 - (b.fix || 0)) - a.a * (1 - (a.fix || 0)))[0];
      if (h) { best = { kind: 'flood', o: h }; bf = f; }
    }
    return best;
  }
  function holeJob(S, taken) { // (any hole left, the deepest first: lowest in her own up)
    let best = null, by = Infinity;
    for (const c of S.comps) {
      if (c.W / c.V > SHIP.DC.full) continue;
      for (const h of c.holes) { if ((h.fix || 0) >= 1 || taken.has(h)) continue; const y = h.x * S.ay.x + h.y * S.ay.y; if (y < by) { by = y; best = { kind: 'hole', o: h }; } }
    }
    return best;
  }
  // ([WP8] a fire beside a magazine first, then the nearest to the party e: along her length)
  function fireJob(v, S, taken, e) {
    let best = null, bd = Infinity;
    for (const p of v.parts) {
      if (!(p.fire > 0) || taken.has(p)) continue;
      const d = (S.threat && S.threat.has(p) ? 0 : 1e6) + (e ? mabs(alongOf(S, fireSpot(p, _js)) - e.s) : 0);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { kind: 'fire', o: best } : null;
  }
  function threatJob(v, S, taken, e) { if (!S.threat || !S.threat.size) return null; const j = fireJob(v, S, taken, e); return j && S.threat.has(j.o) ? j : null; }
  function repairJob(v, taken) {
    for (const p of v.parts) {
      const m = p.def.module, T = m ? repT(m) : 0;
      if (!T || taken.has(p) || !(p.broken || hpFracOf(p) < 0.5)) continue;
      return { kind: 'repair', o: p, T: T * SHIP.DC.repair };
    }
    return null;
  }
  function pickJob(v, S, taken, e) {
    const pri = S.dcPri;
    if (pri === 'fire') return fireJob(v, S, taken, e) || floodJob(v, S, taken) || holeJob(S, taken) || repairJob(v, taken);
    if (pri === 'flood') return floodJob(v, S, taken) || holeJob(S, taken) || fireJob(v, S, taken, e) || repairJob(v, taken);
    return threatJob(v, S, taken, e) || floodJob(v, S, taken) || fireJob(v, S, taken, e) || repairJob(v, taken) || holeJob(S, taken);
  }

  // ---- fate (§8.9): FATE.hz times a second, for every hydro vessel of ours with a hull
  // Capsized (her heel past FATE.capsize for capsizeT s), sunk (her weight and water past reserve × her intact hull's whole
  // buoyancy, or every deck deckUnder m under), out of action (knocked out, no one at a helm for helmT s, after she had
  // someone): doom. A derelict (afloat, no one at a helm, not the player's, for derelictT s) is holed derelictA a
  // compartment. A doomed ship capsized or out of action is scuttled after scuttleT s (scuttleA at every compartment's
  // keel); a doomed one under (her top `under` m down, or bedT s on the bed) is sunk: on a bed shallower than wreckDepth
  // a wreck (frozen, five minutes: Ship.frame's list), else gone once her top is `gone` m down.
  const _tp = v3();
  function topDepth(v, S, h0, t) { // (how far under the water her highest point is: + under)
    const B = v.bounds, c = v.com, cz = c.z || 0;
    let hi = -Infinity;
    for (let k = 0; k < 8; k++) {
      const x = (k & 1 ? B.maxX : B.minX) - c.x, y = (k & 2 ? B.maxY : B.minY) - c.y, z = (k & 4 ? B.maxZ || 0 : B.minZ || 0) - cz;
      hi = Math.max(hi, x * S.Ub.x + y * S.Ub.y + z * S.Ub.z);
    }
    return -(h0 + hi);
  }
  function fateStep(v, dt, sim) {
    const S = v && v.sh;
    if (!S || v.remote || v.dead || v.wreck || !S.rings.length || !(dt > 0) || v.hulk != null) return;
    const FA = SHIP.FATE, r = frameOf(v, S), gl = v.body.mu / (r * r);
    waterOf(v, S);
    if (!(S.level > -Infinity)) return;
    const h0 = r - v.body.radius - S.level, t = seaT(sim), air = isAirKind(v.kind);
    if (!v.fate) {
      if (air && !v.afloat) { S.capT = 0; return; } // (a flying boat in the air is the air rule's)
      if (isGround(v.kind) && !v.afloat) { S.capT = S.sinkT = S.helmT = 0; return; } // ([WP8] an amphibious tank ashore is a tank: armour.js's knock-out, death.js's wreck)
      // capsized
      S.capT = Math.abs(v.heel || 0) > (FA.capsize * Math.PI) / 180 && v.afloat ? (S.capT || 0) + dt : 0;
      if (S.capT >= FA.capsizeT) { doom(v, sim, 'capsized'); return; }
      // foundering
      if (S.vtot == null) hullVol(S);
      let W = 0;
      for (const c of S.comps) W += c.W;
      const deck = Number.isFinite(S.deckMin) ? S.deckMin : -Infinity; // (floodStep's deckScan, ten times a second)
      S.sinkT = (v.mass + SHIP.RHO * W) > FA.reserve * SHIP.RHO * S.vtot || deck > FA.deckUnder ? (S.sinkT || 0) + dt : 0; // (held a moment: a sea breaking over her isn't foundering)
      if (S.sinkT >= FA.sinkT) { doom(v, sim, 'sunk'); return; }
      // out of action: knocked out, or nobody at the helm for helmT s (after she had someone)
      const helm = !!v.control && (typeof Armour === 'undefined' || Armour.has(v, 'driver'));
      if (helm) { S.ctl0 = true; S.helmT = 0; } else S.helmT = (S.helmT || 0) + dt;
      if ((v.ko || (S.ctl0 && S.helmT >= FA.helmT)) && !air) { doom(v, sim, 'action'); return; }
      // a derelict
      if (!v.control && !S.derelict && v.afloat && v !== sim.active && !air) {
        S.derT = (S.derT || 0) + dt;
        if (S.derT >= FA.derelictT) { S.derelict = true; keelHoles(v, S, FA.derelictA, sim); }
      } else if (v.control) S.derT = 0;
      return;
    }
    // doomed: the crew scuttle a capsized ship or one out of action, the smoke of her going, and under: sunk
    const age = clockOf(sim) - (v.doomed ?? clockOf(sim));
    if (v.fate !== 'sunk' && age >= FA.scuttleT && !S.scuttled) { S.scuttled = true; keelHoles(v, S, FA.scuttleA, sim); } // (capsized, out of action, or a half of her: she goes down)
    const top = topDepth(v, S, h0, t);
    S.bedT = v.landed || v.contactTime > 0 ? (S.bedT || 0) + dt : 0;
    if (!v.sunk && (top > FA.under || S.bedT >= FA.bedT)) {
      v.sunk = clockOf(sim);
      if (v === sim.active && sim.toast && !v.ai && !sim.destroyed) sim.toast(v.fate === 'sunk' ? 'She has gone down' : 'She sinks', 'warn');
      else if ((v.fate === 'action' || v.fate === 'capsized') && v.doomBy && typeof Combat !== 'undefined' && Combat.byMe && Combat.byMe(v.doomBy, sim) && typeof Death !== 'undefined' && Death.feedback) Death.feedback('SUNK', sim); // (one we put out of action or capsized: SUNK as she goes down)
    }
    if (v.sunk != null) { // (on the bed: a wreck there, a shallow bed's; gone FATE.gone m down before she reaches one)
      if (S.bedT >= FA.bedT || (S.depth < FA.wreckDepth && S.bedT > 0)) { wreckOf(v, sim); return; }
      if (top > FA.gone) { v.dead = true; return; }
    }
    if (top < 0 && typeof FX !== 'undefined' && FX.smoke && v.body && FX.rnd() < 0.25) { // (the smoke of her going, while any of her is above water: [WP8] one puff a second from over her top, its size by her length (a patrol boat's a third of a destroyer's), rising off her so the player sees her list, settle and go; FX's dice)
      const w = v.toWorld(v.com.x, v.bounds.maxY + 1, v.com.z || 0), up = Math.hypot(w.x, w.y, w.z) || 1;
      _fv.x = v.vx + (w.x / up) * 3; _fv.y = v.vy + (w.y / up) * 3; _fv.z = v.vz + (w.z / up) * 3;
      FX.smoke(v.body, w, _fv, 'column', clamp((v.bounds.maxX - v.bounds.minX) / 150, 0.25, 1));
    }
  }
  // A hydro piece with no hull (a turret, a turbine, a bridge: a broken ship's, or one blown off her), FATE.hz times a
  // second: it sinks to the bed and, resting there (or ashore) for bedT s, is a wreck (the wreck list: five minutes, then
  // it sinks away); one that has gone through the bed (a turbine has nothing to stand on) is gone. Every piece of a ship
  // goes in the end.
  function debrisStep(v, dt, sim) {
    const S = v.sh;
    if (!S || S.rings.length || v.remote || v.dead || v.wreck || v.hulk != null || !(dt > 0)) return;
    waterOf(v, S);
    if (!(S.level > -Infinity)) return;
    const alt = frameOf(v, S) - v.body.radius;
    if (alt < S.level - S.depth - (v.reach || 1) - 2) { v.dead = true; return; }
    S.bedT = (v.landed || v.contactTime > 0) && v.speed() < 1 ? (S.bedT || 0) + dt : 0;
    if (S.bedT >= SHIP.FATE.bedT) wreckOf(v, sim);
  }
  // holes of a m² at the keel of every compartment (scuttling, a derelict's end)
  function keelHoles(v, S, a, sim) {
    const rows = [];
    for (const c of S.comps) { const x = (c.lo + c.hi) / 2, sec = secAt(c.p.def.shull.st, x, SEC2), X = partOf(c.p, x, sec[1], 0, v3()); rows.push([c.p, X.x, X.y, X.z, a]); }
    addHoles(v, rows, clockOf(sim));
  }
  // A ship doomed: v.fate (flight.js SHIP_FATES says it), when, and whose kill (by, else her last hitter: Combat.byMe
  // decides the player's); out of action from now (v.ko: no helm, no guns, no engines), never moored; our kill's banner and
  // toast, the player's end (afterFall waits for her to go), an AI ship stops fighting. false: already doomed.
  const BANNER = { sunk: 'SUNK', magazine: 'SUNK', capsized: 'CAPSIZED', action: 'OUT OF ACTION' }; // (Death's banner for a ship we doomed)
  function doom(v, sim, why, by) {
    if (!v || !v.sh || v.fate || v.dead) return false;
    const now = clockOf(sim), word = typeof SHIP_FATES !== 'undefined' && SHIP_FATES[why] ? SHIP_FATES[why] : why;
    v.fate = FATES.has(why) ? why : 'sunk'; v.doomed = now; v.doomBy = by || (v.lastHitBy !== v ? v.lastHitBy : null) || null;
    unmoor(v);
    if (!v.ko) { v.ko = { why: 'ship', x: why === 'magazine', t: now }; for (const p of v.parts) if (p.def.control) p.ko = true; }
    v.throttle = 0;
    if (sim) {
      const mine = v !== sim.active && v.doomBy && v.doomBy !== v && typeof Combat !== 'undefined' && Combat.byMe && Combat.byMe(v.doomBy, sim);
      if (mine) {
        if (typeof Death !== 'undefined' && Death.feedback) Death.feedback(BANNER[v.fate] || 'SUNK', sim); // (her fate's word: SUNK once she goes down, fateStep)
        if (typeof Armour !== 'undefined') Armour.fb.ko = { text: `${word}!`, t: now };
        if (sim.toast) sim.toast(`Enemy ${v.name || 'ship'}: ${word.toLowerCase()}!`, 'kill');
      }
      if (v === sim.active && !v.ai) { if (sim.toast && !sim.destroyed) sim.toast(`${word}!`, 'warn'); if (sim.onDestroyed) sim.onDestroyed(); }
    }
    if (v.ai && !v.ai.down) { v.ai.down = true; v.aiFire = false; aiDown(v, sim); }
    return true;
  }
  // A sunk ship on a bed shallower than FATE.wreckDepth: a wreck (frozen where she lies: never stepped), her fires out
  function wreckOf(v, sim) {
    if (v.wreck) return;
    v.wreck = true; v.wreckAt = clockOf(sim); v.vx = v.vy = v.vz = 0; v.av = v3(0, 0, 0); v.moored = false;
    for (const p of v.parts) p.fire = 0;
  }
  // The sunk ships' wrecks (Ship.frame, FATE.hz): five minutes each (DEATH.wreckLife), the last DEATH.sink s sinking away
  // (v.sink: the renderer lowers them), at most DEATH.wrecks standing (the oldest sink first)
  function wrecks(F) {
    const D = typeof DEATH !== 'undefined' ? DEATH : { wreckLife: 300, sink: 6, wrecks: 8 }, now = clockOf(F), up = [];
    for (const v of F.vessels) {
      if (!v.sh || !v.wreck || v.dead || v.remote || v.wreckAt == null) continue;
      if (v.sinkAt == null && now - v.wreckAt >= D.wreckLife - D.sink) v.sinkAt = now;
      if (v.sinkAt == null) up.push(v);
      else { v.sink = clamp((now - v.sinkAt) / D.sink, 0, 1); if (v.sink >= 1 || now < v.sinkAt) v.dead = true; }
    }
    if (up.length > D.wrecks) { up.sort((a, b) => a.wreckAt - b.wreckAt); for (let i = 0; i < up.length - D.wrecks; i++) up[i].sinkAt = now; }
  }
  // the steps, from Ship.frame: flooding at FLOOD.hz, fires, damage control and fate at FATE.hz, for each of our hydro
  // vessels with a hull (a moored one's water still flows: it wakes her)
  const WRK = { t: 0 }; // (the wrecks' clock)
  function damageFrame(F, dt) {
    if (!(dt > 0)) return;
    const fh = 1 / SHIP.FLOOD.hz, kh = 1 / SHIP.FATE.hz;
    WRK.t = Math.min(WRK.t + dt, 1);
    const tick = WRK.t >= kh;
    if (tick) WRK.t -= kh;
    for (const v of F.vessels.slice()) {
      const S = v.sh;
      if (!S || v.remote || v.dead || v.wreck) continue;
      if (!S.rings.length) { S.kT = Math.min((S.kT || 0) + dt, 1); while (S.kT >= kh) { S.kT -= kh; debrisStep(v, kh, F); if (v.dead || v.wreck) break; } continue; } // (a piece with no hull)
      S.fT = Math.min((S.fT || 0) + dt, 1);
      while (S.fT >= fh) { S.fT -= fh; floodStep(v, fh, F); }
      S.kT = Math.min((S.kT || 0) + dt, 1);
      while (S.kT >= kh) { S.kT -= kh; fireStep(v, kh, F); dcStep(v, kh, F); fateStep(v, kh, F); if (v.dead || v.wreck) break; }
    }
    if (tick) wrecks(F);
  }

  // ==== combat ====
  // [WP9] Naval weapons and sensors (spec §8.1, §8.2, §8.5, §8.6, §8.10, §8.11). Everything here runs only for the ships
  // update's weapons and kit (weapon.kind 'torp', w.asm, w.vls, w.naval, def.ciws, def.decoy, the sea radars) or what
  // the other files call it with behind those gates and Combat.S.sea / Combat.S.pd (old play never reaches it):
  // - torpedoes: shots { k: 'stor' } in Combat.S.shots, stepped by torpStep (combat.js moveShot); fireTorp from a tube
  //   (outboard by its side; dropped from an aircraft; nothing on land), torpHit for them and the old air torpedo;
  // - anti-ship missiles: Combat's missiles with s.asm, flown by asmStep (climb, skim, terminal dive), asmHit through the
  //   hull's plate; asmTarget picks one; vertical-launch SAMs (s.vls) out of the cell and over (vlsStep), then Combat's
  //   semi-active guidance on the fire-control radar's lock; samKill: a SAM's burst against a missile (S3);
  // - the close-in gun: ciwsStep (Combat.frame, when Combat.S.pd) aims and fires simulated rounds; shotMissiles (one line
  //   in armour.js moveShell) kills the missiles they pass;
  // - decoys: decoy (the countermeasure key): chaff and flare rockets 300 m out, torpedo noisemakers astern;
  // - seeing ships: seesSea (the horizon, land in the way, smoke), rcs (her radar size), surface (a sea radar's contacts,
  //   4 Hz), foe (whose side a craft is on);
  // - the naval guns' magazines: refill (aim.js tick, w.naval);
  // - calls for the AI (WP10): salvo, torpAt, asmAt, samAt, ciwsOn.
  // In a room (WP11): a torpedo is a shot ('stor'); its hits (and an ASM's, a CIWS kill of a peer's missile: m.ciwsKill)
  // are the owner's to send; here they work locally and in solo play.
  let cs = ((Math.random() * 4294967296) | 0) || 11; // (the combat's own dice: Ship.seed sets them too)
  const crnd = () => { cs ^= cs << 13; cs ^= cs >>> 17; cs ^= cs << 5; return (cs >>> 0) / 4294967296; };
  const DEG = Math.PI / 180;
  const _ca = v3(), _cb = v3(), _cc = v3(), _cd = v3(), _ce = v3(), _cf = v3(), _cg = v3();
  // ---- whose side a craft is on: a's foe o? (the player's side against a computer's that isn't an ally or its team-mate,
  // another player's that is an enemy (MP.enemy), or a stand-in with no AI at all; a computer's against the player's and
  // other teams'; never itself, its carrier or drone, wreckage or a ship already going down)
  function teamOf(o) {
    if (!o.ai || o.ai.ally) return 'p';
    const B = typeof GroundAI !== 'undefined' && GroundAI.battle;
    return o.ai.team != null ? (B && o.ai.team === B.team ? 'p' : 't' + o.ai.team) : 'ai';
  }
  function foe(a, o) {
    if (!a || !o || a === o || o.dead || o.isDebris || o.fate || o.hulk != null || a.carrier === o || o.carrier === a) return false;
    if (o.remote) return !a.ai && typeof MP !== 'undefined' && typeof Net !== 'undefined' && !!MP.enemy && MP.enemy(Net.me, o.remote);
    if (a.remote) return false;
    if (!a.ai && !o.ai) return true; // (a stand-in target: two local craft, neither the computer's)
    return teamOf(a) !== teamOf(o);
  }
  // is it night where v is (the Sun under her horizon: render3d envAt's line): eyes see EYES.night m, not EYES.day
  function night(v, F) {
    if (!v || !v.body || typeof bodyPos !== 'function') return false;
    const bp = bodyPos(v.body, (F && F.time) || 0), l = Math.hypot(bp.x, bp.y) || 1, r = Math.hypot(v.x, v.y, v.z) || 1;
    return (v.x * -bp.x + v.y * -bp.y) / (l * r) < -0.06;
  }
  // a shot hostile to v (a missile v's close-in gun or SAMs may engage): a craft's (its owner a foe), else an enemy one
  const shotFoe = (v, m) => (m.owner === v ? false : m.owner && m.owner.parts ? foe(v, m.owner) : !!m.enemy && !(v.ai && !v.ai.ally));
  // ---- the water at a sim point: the still water's level (0 at sea, a lake's surface; −Infinity none), the bed, depth,
  // the point's height over the sphere (alt) and its body angle and depth (a, z: Terrain.locate's)
  const WT = { level: 0, bed: 0, depth: 0, alt: 0, a: 0, z: 0, lake: false }, _wl = {};
  function waterPt(b, P, o = WT) {
    Terrain.locate(b, P.x, P.y, P.z, _wl);
    const h = Terrain.heightAt(b, _wl.a, _wl.z);
    o.a = _wl.a; o.z = _wl.z; o.alt = _wl.r - b.radius; o.bed = h; o.lake = false;
    if (b.ocean && h < 0) o.level = 0;
    else { const w = b.mapped ? Terrain.inlandAt(b, _wl.a, _wl.z) : NaN; if (w === w && w > h) { o.level = w; o.lake = true; } else o.level = -Infinity; }
    o.depth = o.level > -Infinity ? o.level - h : 0;
    return o;
  }
  // the waves' height at a point WT describes (Earth's open sea; none on a lake or another body)
  function waveAt(b, W, F) { if (b !== EARTH || W.lake || !(W.level > -Infinity)) return 0; return wave(-wrapAngle(W.a - EARTH.padAngle) * b.radius, -W.z, seaT(F))[0] * fadeAt(W.depth); }
  // a big column of white water (a naval shell's splash, a torpedo's burst: armour.js ground, torpHit), size m across
  function column(b, P, size) {
    if (typeof FX === 'undefined') return;
    const r = Math.hypot(P.x, P.y, P.z) || 1, u = { x: P.x / r, y: P.y / r, z: P.z / r }, k = clamp(size, 0.5, 6), n = Math.max(4, Math.round(FX.nq ? FX.nq(6 + 3 * k) : 6 + 3 * k));
    for (let i = 0; i < n; i++) {
      const d = FX.dir(), up = (6 + 10 * k) * (0.6 + 0.4 * FX.rnd()), s = 1.5 * k * FX.rnd();
      FX.add({ kind: 'smoke', b, x: P.x, y: P.y, z: P.z, vx: u.x * up + d.x * s, vy: u.y * up + d.y * s, vz: u.z * up + d.z * s, max: 1.4 + 0.8 * FX.rnd() + 0.25 * k, size: 0.6 * k, grow: 1.8 * k, color: '#eef6fb', alpha: 0.85, heavy: true });
    }
    FX.splash(b, P, u, Math.round(4 + 2 * k));
  }

  // ---- torpedoes (§8.5)
  // A tube fires outboard by its side (weapon.side: + or − z by where it stands; on the centre line, ahead), level; v's
  // way ahead in part space: a ship's +x, a plane's +y (its pilot frame)
  function sideDir(v, p, out) {
    const z = partZ(p);
    if (p.def.weapon && p.def.weapon.side && Math.abs(z) > 0.05) { out.x = 0; out.y = 0; out.z = Math.sign(z); return out; }
    const Fd = v.pilot && v.pilot.F ? v.pilot.F : { x: 1, y: 0, z: 0 };
    out.x = Fd.x; out.y = Fd.y; out.z = Fd.z || 0;
    return out;
  }
  const flying = (v) => (!v.hydro || isAirKind(v.kind)) && !v.landed && !(v.contactTime > 0) && !v.afloat; // (a craft in the air: not on the ground, the water or afloat; [WP9 review] a flying boat in the air too, §8.11, never a ship on her foils)
  // A torpedo out of tube p (Combat's weapon list, Aim's fire): it leaves outboard (a ship's tubes eject it at 15 m/s to
  // fall into the sea), or drops from an aircraft (S7); on land, or more than 3 m over the water from a craft that is
  // neither afloat nor flying, nothing (a toast). gyro: the heading it turns to after its straight run (sim, unit; an
  // AI's bearing), else it holds the tube's. The shot, or null.
  const TQ = { level: 0, bed: 0, depth: 0, alt: 0, a: 0, z: 0, lake: false };
  function fireTorp(v, p, F, gyro) {
    if (!v || !p || v.dead || v.remote || v.ko || !v.parts.includes(p) || p.broken || !(p.ammo > 0) || !p.def.weapon) return null;
    const w = p.def.weapon, b = v.body, me = !!F && v === F.active && !v.ai, say = (t) => { if (me && F.toast) F.toast(t, 'warn'); };
    const d = sideDir(v, p, _ca), out = Math.abs(d.z) > 0.5 ? (partDepth(p) / 2) * d.z : 0, m = v.toWorld(p.x, p.y, partZ(p) + out), dir = v.axis(d.x, d.y, d.z);
    const W = waterPt(b, m, TQ), air = flying(v);
    if (!(W.level > -Infinity) || W.depth < SHIP.TORP.aground) { say('Torpedo tubes need water under them'); return null; }
    if (!air && !v.hydro && W.alt - W.level > 3) { say('Torpedo tubes need water under them'); return null; }
    const ej = air ? 0 : 15, r = Math.hypot(m.x, m.y, m.z) || 1;
    const s = { k: 'stor', b, x: m.x, y: m.y, z: m.z, vx: v.vx + dir.x * ej, vy: v.vy + dir.y * ej, vz: v.vz + dir.z * ej, dx: dir.x, dy: dir.y, dz: dir.z,
      t: 0, run: 0, ph: 'air', owner: v, spd: w.speed || 22, depth: w.depth || 6, dep: 0, range: w.range || 8000, cone: (w.cone || 30) * DEG, acquire: w.acquire || 1500,
      dmg: w.dmg || 4000, blast: w.blast || 12, seek: w.seek || 'active', drop: air, gyro: gyro || null, tgt: null, look: 0, bub: 0, ship: !!v.hydro, life: 600, part: p };
    if (typeof Combat !== 'undefined') { Combat.release(v, p); Combat.S.shots.push(s); }
    if (typeof FX !== 'undefined' && F && F.active && Math.hypot(m.x - F.active.x, m.y - F.active.y, m.z - F.active.z) < 3000) FX.puff(b, m, { x: v.vx + dir.x * 4, y: v.vy + dir.y * 4, z: v.vz + dir.z * 4 }, 4, '#dfe3e6');
    if (me && typeof Sound !== 'undefined' && Sound.separate) Sound.separate();
    void r;
    return s;
  }
  // a torpedo's step (Combat.moveShot for k 'stor'): true while it runs, false when it is gone. In the air it falls (a
  // drop breaks up entering faster than 70 m/s along its path or steeper than 45°); in the water it runs at its depth (in
  // 3 s), straight for a second, then (seek 'active') looks for a ship in its cone ahead within `acquire` m, its noise
  // decoys first, and homes at TORP.turn °/s, deep enough to pass a metre and a half under her keel; it dies after
  // `range` m, or bursts at half power where the bed is shallower than TORP.aground; bubbles every TORP.bubbles s.
  const TW = { level: 0, bed: 0, depth: 0, alt: 0, a: 0, z: 0, lake: false }, _tA = v3();
  function torpStep(s, h, F) {
    if (s.dead) return false;
    const b = s.b, T = SHIP.TORP;
    s.t += h;
    if (s.t > s.life) return false;
    if (s.ph === 'air') { // falling
      const r0 = Math.hypot(s.x, s.y, s.z), g = b.mu / (r0 * r0), sp0 = Math.hypot(s.vx, s.vy, s.vz), kd = 0.00003 * airDensity(b, r0 - b.radius) * sp0 * h;
      s.vx -= s.vx * kd + (s.x / r0) * g * h; s.vy -= s.vy * kd + (s.y / r0) * g * h; s.vz -= s.vz * kd + (s.z / r0) * g * h;
      s.x += s.vx * h; s.y += s.vy * h; s.z += s.vz * h;
      const W = waterPt(b, s, TW);
      if (!(W.level > -Infinity)) { if (W.alt < W.bed) { if (typeof FX !== 'undefined') FX.puff(b, s, { x: 0, y: 0, z: 0 }, 3, '#9a8f7c'); return false; } return true; } // (over land: down on it, a dud)
      if (W.alt > W.level) return true;
      // into the water: a drop too fast or too steep breaks up
      const r = Math.hypot(s.x, s.y, s.z), ux = s.x / r, uy = s.y / r, uz = s.z / r, sp = Math.hypot(s.vx, s.vy, s.vz) || 1, vn = s.vx * ux + s.vy * uy + s.vz * uz;
      if (typeof FX !== 'undefined') FX.splash(b, s, { x: ux, y: uy, z: uz }, 6);
      if (s.drop && (sp > 70 || -vn / sp > Math.sin(45 * DEG))) { if (F && s.owner === F.active && F.toast) F.toast('Torpedo broke up: drop it slower and flatter', 'warn'); return false; }
      let hx = s.vx - ux * vn, hy = s.vy - uy * vn, hz = s.vz - uz * vn, hl = Math.hypot(hx, hy, hz);
      if (hl < 1) { const k = s.dx * ux + s.dy * uy + s.dz * uz; hx = s.dx - ux * k; hy = s.dy - uy * k; hz = s.dz - uz * k; hl = Math.hypot(hx, hy, hz) || 1; }
      s.dx = hx / hl; s.dy = hy / hl; s.dz = hz / hl; s.ph = 'run'; s.dep = 0; s.run = 0; s.t0 = s.t;
      const k = (b.radius + W.level) / r; s.x *= k; s.y *= k; s.z *= k;
      return true;
    }
    // running
    const r = Math.hypot(s.x, s.y, s.z), ux = s.x / r, uy = s.y / r, uz = s.z / r, spd = s.spd;
    s.run += spd * h;
    if (s.run > s.range) return false; // (its fuel spent: it sinks)
    const run1 = s.t - (s.t0 || 0) > 1;
    if (run1 && s.seek === 'active') {
      if (s.tgt && !aliveTgt(s.tgt)) s.tgt = null;
      if ((s.look -= h) <= 0) {
        s.look = 0.25;
        if (!s.tgt || !s.tgt.noise) { const n = noiseFor(s, F); if (n) s.tgt = n; }
        if (!s.tgt) s.tgt = acquire(s, F);
      }
    }
    // steer: at its target (led a little), else its gyro's heading, else straight
    let wx = 0, wy = 0, wz = 0, want = s.depth;
    if (run1 && s.tgt) {
      const t = s.tgt, tt = Math.hypot(t.x - s.x, t.y - s.y, t.z - s.z) / spd, lead = t.noise ? 0 : Math.min(tt, 30);
      // ([WP9 review] a ship's hull at a point of its own along her length, within the middle 70 %: torpedo after torpedo
      // into one compartment had a destroyer shrug off twenty)
      let ox = t.x, oy = t.y, oz = t.z;
      if (t.sh && t.bounds && t.toWorld) {
        if (s.ao == null || s.aoT !== t) { s.aoT = t; s.ao = (crnd() * 2 - 1) * 0.35; }
        const B = t.bounds, c = t.com || { x: 0, y: 0, z: 0 }, Q = t.toWorld((B.minX + B.maxX) / 2 + s.ao * (B.maxX - B.minX), c.y, 0);
        ox = Q.x; oy = Q.y; oz = Q.z;
      }
      wx = ox + (t.vx || 0) * lead - s.x; wy = oy + (t.vy || 0) * lead - s.y; wz = oz + (t.vz || 0) * lead - s.z;
      if (!t.noise) want = Math.min(s.depth, Math.max(2, (t.draft || 2) + 1.5));
    } else if (run1 && s.gyro) { wx = s.gyro.x; wy = s.gyro.y; wz = s.gyro.z; }
    const k0 = wx * ux + wy * uy + wz * uz; wx -= ux * k0; wy -= uy * k0; wz -= uz * k0;
    let dx = s.dx, dy = s.dy, dz = s.dz;
    const kd = dx * ux + dy * uy + dz * uz; dx -= ux * kd; dy -= uy * kd; dz -= uz * kd;
    let dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    const wl = Math.hypot(wx, wy, wz);
    if (wl > 1e-6) { // (turn toward it at TORP.turn °/s: about the local up)
      wx /= wl; wy /= wl; wz /= wl;
      const c = clamp(dx * wx + dy * wy + dz * wz, -1, 1), sg = Math.sign((dy * wz - dz * wy) * ux + (dz * wx - dx * wz) * uy + (dx * wy - dy * wx) * uz) || 1, a = Math.min(Math.acos(c), T.turn * DEG * h) * sg;
      const ca = Math.cos(a), sa = Math.sin(a), qx = uy * dz - uz * dy, qy = uz * dx - ux * dz, qz = ux * dy - uy * dx; // (up × heading: its left)
      dx = dx * ca + qx * sa; dy = dy * ca + qy * sa; dz = dz * ca + qz * sa;
      dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    }
    s.dx = dx; s.dy = dy; s.dz = dz;
    s.dep += clamp(want - s.dep, -(s.depth / 3) * h, (s.depth / 3) * h); // (to its depth in 3 s)
    _tA.x = s.x; _tA.y = s.y; _tA.z = s.z;
    s.x += dx * spd * h; s.y += dy * spd * h; s.z += dz * spd * h;
    const W = waterPt(b, s, TW), lev = W.level > -Infinity ? W.level : 0, rr = Math.hypot(s.x, s.y, s.z) || 1, kr = (b.radius + lev - s.dep) / rr;
    s.x *= kr; s.y *= kr; s.z *= kr;
    s.vx = dx * spd; s.vy = dy * spd; s.vz = dz * spd;
    if (torpHit(s, _tA, F)) return false;
    if (s.tgt && s.tgt.noise && Math.hypot(s.tgt.x - s.x, s.tgt.y - s.y, s.tgt.z - s.z) < 8) { burst(s, s, 0.5, F); return false; } // (on the noisemaker: it goes off there)
    if (!(W.level > -Infinity) || W.bed > lev - T.aground) { burst(s, s, 0.5, F); return false; } // (aground)
    if ((s.bub -= h) <= 0 && typeof FX !== 'undefined' && F && F.active && !(F.warpIdx > 1) && Math.hypot(s.x - F.active.x, s.y - F.active.y, s.z - F.active.z) < 3000) {
      s.bub = T.bubbles;
      const k = (b.radius + lev + 0.2) / rr;
      FX.add({ kind: 'smoke', b, x: s.x * k, y: s.y * k, z: s.z * k, vx: ux * 0.6, vy: uy * 0.6, vz: uz * 0.6, max: 2.2, size: 0.35, grow: 1.2, color: '#eef6fb', alpha: 0.55 });
    }
    return true;
  }
  const aliveTgt = (t) => (t.noise ? t.t < t.life : !t.dead && !t.fate && t.parts && t.parts.length > 0 && (!!t.remote || !!t.afloat));
  // the ship a torpedo's seeker finds: hydro vessels afloat (and other players' ships), foes of its owner, in its cone
  // ahead within its acquire range: the nearest
  function acquire(s, F) {
    let best = null, bd = s.acquire;
    for (const o of F.vessels) {
      if (o.dead || o.body !== s.b || !(o.sh ? o.afloat : o.remote && isSea(o.kind)) || !foe(s.owner, o)) continue;
      const dx = o.x - s.x, dy = o.y - s.y, dz = o.z - s.z, d = Math.hypot(dx, dy, dz);
      if (d > bd || (dx * s.dx + dy * s.dy + dz * s.dz) / (d || 1) < Math.cos(s.cone)) continue;
      bd = d; best = o;
    }
    return best;
  }
  // (the old air torpedo with ships in play, combat.js swim) the nearest hostile hydro vessel afloat within d m
  function torpPick(s, d, F) {
    let best = null, bd = d;
    for (const o of F.vessels) {
      if (o.dead || o.body !== s.b || !o.sh || !o.afloat || !foe(s.owner, o)) continue;
      const e = Math.hypot(o.x - s.x, o.y - s.y, o.z - s.z);
      if (e < bd) { bd = e; best = o; }
    }
    return best;
  }
  // A torpedo's step from a (sim) to it, under the water, against every hydro vessel's hull (not its own ship's for 5 s):
  // into her hull under the waterline, or passing within 3 m under her keel (its magnetic fuze). It bursts there
  // (Combat.explode, under: its holes tamped ×3); under the keel of a hull part of class M or smaller it breaks her back
  // (the part gone, she falls in two: breakAt, doomed 'sunk'). true: it hit. (Also the old air torpedo's, combat.js swim.)
  const _th = v3(), _to = v3(), SEC3 = [0, 0, 0, 0, 0];
  function torpHit(s, a, F) {
    const b = s.b;
    for (const o of F.vessels) {
      if (!o.sh || o.dead || o.wreck || o.body !== b || !o.sh.hulls.length || o === s.owner) continue; // ([WP9 review] never its owner: §8.5)
      const rr = (o.reach || 10) + 6;
      if ((o.x - s.x) ** 2 + (o.y - s.y) ** 2 + (o.z - s.z) ** 2 > rr * rr) continue;
      for (const f of [0.5, 1]) {
        _th.x = a.x + (s.x - a.x) * f; _th.y = a.y + (s.y - a.y) * f; _th.z = a.z + (s.z - a.z) * f;
        const X = localOf(o, _th, _to);
        for (const p of o.sh.hulls) {
          if (p.broken && p.def.shull.cls === 'one') continue;
          const q = ownPt(p, X, _cg), H = shullOf(p.def);
          if (q.x < H.x0 || q.x > H.x1) continue;
          const sec = secAt(p.def.shull.st, q.x, SEC3), yk = sec[1], wl = p.def.shull.wl, foot = Math.max(sec[3], 0.6);
          let keel = false;
          for (const z0 of partZs(p)) {
            const lz = X.z - z0;
            if (insideOwn(p.def, q.x, q.y, lz) && q.y < wl) { boom(s, o, p, _th, false, F); return true; }
            if (q.y <= yk && q.y >= yk - 3 && Math.abs(lz) <= foot) keel = true;
          }
          if (keel) { boom(s, o, p, _th, true, F); return true; }
        }
      }
    }
    return false;
  }
  function boom(s, o, p, P, keel, F) {
    const b = s.b, by = s.owner && s.owner.parts ? s.owner : undefined, at = { x: P.x, y: P.y, z: P.z };
    if (typeof Combat !== 'undefined') Combat.explode(b, at, s.blast || 12, s.dmg || 4000, by, F, false, undefined, undefined, undefined, { under: true });
    const r = Math.hypot(at.x, at.y, at.z) || 1, k = (b.radius + Math.max(0, waterPt(b, at, TW).level > -Infinity ? TW.level : 0)) / r;
    column(b, { x: at.x * k, y: at.y * k, z: at.z * k }, 5);
    if (keel && ['S', 'M', 'one'].includes(p.def.shull.cls) && o.byId.has(p.id) && !o.dead && !o.remote) { // (her back broken: she falls in two)
      if (by && by !== o) { o.lastHitBy = by; o.lastHitAt = clockOf(F); }
      holedThrough(o, p, 'torpedo', F);
      doom(o, F, 'sunk', by);
      if (o.byId.has(p.id) && !o.dead) breakAt(o, F, p, null, 'sunk');
    }
    s.dead = true;
  }
  // a torpedo going off where it is (aground, on a noisemaker): a burst at k of its power, under the water
  function burst(s, P, k, F) {
    const at = { x: P.x, y: P.y, z: P.z }, by = s.owner && s.owner.parts ? s.owner : undefined;
    if (typeof Combat !== 'undefined') Combat.explode(s.b, at, (s.blast || 12) * k, (s.dmg || 4000) * k, by, F, false, undefined, undefined, undefined, { under: true });
    const r = Math.hypot(at.x, at.y, at.z) || 1, kk = (s.b.radius + (TW.level > -Infinity ? TW.level : 0)) / r;
    column(s.b, { x: at.x * kk, y: at.y * kk, z: at.z * kk }, 3 * k);
    s.dead = true;
  }
  // ---- torpedo decoys (the kit's torpDecoy): noisemakers streamed TORP_DECOY.m astern on a cable for its life; each
  // homing torpedo within TORP_DECOY.r of one weighs it once and goes for it with its p
  const NOISE = [], TORP_DECOY = { m: 150, r: 1500, near: 3000, dep: 5 };
  function noiseFor(s, F) {
    for (const n of NOISE) {
      if (n.t >= n.life || n.F !== F || n.b !== s.b || (s.heard && s.heard.has(n)) || foe(s.owner, n.owner) === false) continue; // (this flight's only)
      if (Math.hypot(n.x - s.x, n.y - s.y, n.z - s.z) > TORP_DECOY.r) continue;
      (s.heard || (s.heard = new Set())).add(n);
      if (crnd() < n.p) return n;
    }
    return null;
  }
  function noiseStep(F, dt) {
    for (let i = NOISE.length - 1; i >= 0; i--) {
      const n = NOISE[i], v = n.owner;
      n.t += dt;
      if (n.t >= n.life || !v || v.dead || n.F !== F) { NOISE.splice(i, 1); continue; } // (spent, its ship gone, or another flight's)
      // (towed astern: TORP_DECOY.m behind her stern, TORP_DECOY.dep down)
      const st = v.toWorld(n.px, n.py, n.pz), back = v.axis(-n.fx, -n.fy, 0), r = Math.hypot(st.x, st.y, st.z) || 1, k = TORP_DECOY.m;
      n.x = st.x + back.x * k; n.y = st.y + back.y * k; n.z = st.z + back.z * k;
      const rr = Math.hypot(n.x, n.y, n.z) || 1, kr = (v.body.radius - TORP_DECOY.dep) / rr;
      n.x *= kr; n.y *= kr; n.z *= kr; n.vx = v.vx; n.vy = v.vy; n.vz = v.vz;
      void r;
    }
  }
  // ---- decoys (the countermeasure key, combat.js countermeasures): every Decoy Launcher with rockets fires a pair, a chaff
  // cloud (a dispenser's bundle: radar seekers weigh it once the missile is within 4 km) and flares, bursting 300 m out
  // over its side; every Torpedo Decoy, with a torpedo in the water within 3 km, streams a noisemaker. true: something went.
  function decoy(v, F) {
    if (!v || v.dead || v.remote || !v.parts.length) return false;
    let any = false;
    for (const p of v.parts) {
      const w = p.def.weapon;
      if (!w || w.kind !== 'chaff' || !w.side || p.broken || !(p.ammo > 0)) continue;
      const d = sideDir(v, p, _ca), r = Math.hypot(v.x, v.y, v.z) || 1, out = v.axis(d.x, d.y, d.z), m = v.toWorld(p.x, p.y + p.def.h / 2, partZ(p));
      const sp = 190, c = Math.cos(25 * DEG), sn = Math.sin(25 * DEG), ux = v.x / r, uy = v.y / r, uz = v.z / r; // (out over its side, 25° up: the local up; [WP9 review] 190 m/s against the flares' drag: about 300 m out)
      for (const kind of ['chaff', 'flare']) {
        const k = kind === 'flare' ? 1.1 : 1, vx = (out.x * c + ux * sn) * k, vy = (out.y * c + uy * sn) * k, vz = (out.z * c + uz * sn) * k;
        const f = { b: v.body, x: m.x, y: m.y, z: m.z, vx: v.vx + vx * sp, vy: v.vy + vy * sp, vz: v.vz + vz * sp, t: 0, life: kind === 'chaff' ? 12 : 5 };
        if (kind === 'chaff') { f.chaff = true; f.str = 2; } else f.flare = true;
        if (typeof Combat !== 'undefined') { Combat.S.flares.push(f); if (typeof MP !== 'undefined' && MP.sendFlares) MP.sendFlares(v, f); }
      }
      if (typeof Combat !== 'undefined') Combat.release(v, p); else p.ammo--;
      if (typeof FX !== 'undefined') FX.puff(v.body, m, { x: v.vx + out.x * 20, y: v.vy + out.y * 20, z: v.vz + out.z * 20 }, 3, '#d9dde0');
      any = true;
    }
    // torpedo noisemakers, with one in the water within 3 km
    let torp = false;
    if (typeof Combat !== 'undefined') for (const s of Combat.S.shots) if ((s.k === 'stor' || s.k === 'torp') && s.ph !== 'air' && Math.hypot(s.x - v.x, s.y - v.y, s.z - v.z) < TORP_DECOY.near && s.owner !== v) { torp = true; break; }
    if (torp) for (const p of v.parts) {
      const D = p.def.decoy;
      if (!D || !D.torp || p.broken) continue;
      if (p.dAmmo == null) p.dAmmo = D.ammo;
      if (!(p.dAmmo > 0)) continue;
      p.dAmmo--;
      const Fd = v.pilot && v.pilot.F ? v.pilot.F : { x: 1, y: 0, z: 0 };
      NOISE.push({ noise: true, owner: v, F, b: v.body, px: p.x, py: p.y, pz: partZ(p), fx: Fd.x, fy: Fd.y, x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz, t: 0, life: D.life || 60, p: D.p ?? 0.6 });
      any = true;
    }
    if (any && F && v === F.active && !v.ai && F.toast) F.toast(torp ? 'Decoys away: chaff, flares and a torpedo noisemaker' : 'Decoys away', 'info');
    if (any) noiseStep(F, 0);
    return any;
  }

  // ---- anti-ship missiles and vertical-launch SAMs (§8.6)
  // The ship under the crosshair, or the nearest in a 60° arc ahead of v (what an anti-ship missile is fired at): a foe's
  // hydro vessel afloat (another player's ship), or the range's boats and frigate; null: none (it flies straight on and
  // its seeker looks ahead)
  function seaTargets(v, F, out) {
    out.length = 0;
    for (const o of F.vessels) if (o.body === v.body && !o.dead && (o.sh ? o.afloat : o.remote && (isSea(o.kind) || o.afloat)) && foe(v, o)) out.push(o);
    if (typeof Combat !== 'undefined' && !(typeof MP !== 'undefined' && MP.active)) for (const e of Combat.S.targets) if (e.alive && e.def.sea) out.push(e);
    return out;
  }
  const ST = [];
  const posOf = (t, o) => { if (t.def && t.pos) { const c = Combat.targetCentre(t); o.x = c.x; o.y = c.y; o.z = c.z; o.vx = t.vel ? t.vel.x : 0; o.vy = t.vel ? t.vel.y : 0; o.vz = t.vel ? t.vel.z : 0; return o; } o.x = t.x; o.y = t.y; o.z = t.z; o.vx = t.vx || 0; o.vy = t.vy || 0; o.vz = t.vz || 0; return o; };
  const TPO = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  // ([WP9 review] the ships v can see to fire at: its sea radars' contacts (Ship.surface) and those in sight of its top
  // (EYES, over the horizon: seesSea); no magic radar)
  const SEEN = [];
  function seenSea(v, F, out) {
    out.length = 0;
    const R = surface(v, F), L = seaTargets(v, F, []), eye = topOf(v, SE), ex = eye.x, ey = eye.y, ez = eye.z, eh = eye.h, eyes = SHIP.EYES[night(v, F) ? 'night' : 'day'];
    for (const t of L) {
      let ok = R.some((c) => c.ref === t && c.k === 'sea');
      if (!ok) { const T = topOf(t, ST2), P = t.def ? T : t; ok = Math.hypot(P.x - ex, P.y - ey, P.z - ez) < eyes && seesSea({ x: ex, y: ey, z: ez }, T, eh, T.h); }
      if (ok) out.push(t);
    }
    return out;
  }
  function asmTarget(v, F) {
    if (!v || !F) return null;
    const A = F.groundAim && v === F.active ? F.aim : null, L = seenSea(v, F, SEEN);
    if (A && A.v && L.includes(A.v)) return A.v;
    let best = null, bk = -2;
    if (A && A.dir) for (const t of L) { // (within 3° of the crosshair)
      const P = posOf(t, TPO), dx = P.x - A.o.x, dy = P.y - A.o.y, dz = P.z - A.o.z, d = Math.hypot(dx, dy, dz) || 1, k = (dx * A.dir.x + dy * A.dir.y + dz * A.dir.z) / d;
      if (k > Math.cos(3 * DEG) && k > bk && d < 18000) { bk = k; best = t; }
    }
    if (best) return best;
    const Fd = v.pilot && v.pilot.F ? v.pilot.F : { x: 1, y: 0, z: 0 }, f = v.axis(Fd.x, Fd.y, Fd.z || 0);
    let bd = 18000;
    for (const t of L) {
      const P = posOf(t, TPO), dx = P.x - v.x, dy = P.y - v.y, dz = P.z - v.z, d = Math.hypot(dx, dy, dz) || 1;
      if ((dx * f.x + dy * f.y + dz * f.z) / d > Math.cos(30 * DEG) && d < bd) { bd = d; best = t; }
    }
    return best;
  }
  // A launcher's missile set going (combat.js launchMissile, for w.asm or w.vls; s already Combat's): an anti-ship
  // missile out of its canister (the part's +x, 15° up: ASM canisters stand on deck at rot 0, angled over the bow) at 40
  // m/s, its motor holding `speed`; a SAM straight up out of its cell (the part's +y) at 30 m/s, guided semi-actively on
  // the fire-control radar's lock (s.gr: Aim.radarSees) once it has pitched over (vlsStep)
  function armShot(s, v, p, w, F) {
    const k = p.rot & 3, c = Math.cos(15 * DEG), sn = Math.sin(15 * DEG), i = Math.max(0, (p.ammo || 1) - 1); // (the canister or cell it leaves: the last loaded)
    let lx, ly, mx, my, mz = 0;
    if (w.asm) { lx = c; ly = sn; const M = typeof nvAsmLay === 'function' ? nvAsmLay(p.def).mouth(i) : { x: p.def.w / 2, y: 0, z: 0 }; mx = M.x; my = M.y; mz = M.z; }
    else { lx = 0; ly = 1; const C = typeof nvVlsLay === 'function' ? nvVlsLay(p.def).cells[(p.def.weapon.ammo || 8) - 1 - i] : null; mx = C ? C.x : 0; my = p.def.h / 2; mz = C ? C.z : 0; }
    const R = (x, y) => { for (let j = 0; j < k; j++) { const t = x; x = -y; y = t; } return [x, y]; }, [dx, dy] = R(lx, ly), [ox, oy] = R(mx, my);
    const m = v.toWorld(p.x + ox, p.y + oy, partZ(p) + mz), dir = v.axis(dx, dy, 0), e = w.asm ? 40 : 30;
    s.x = m.x + dir.x * 0.5; s.y = m.y + dir.y * 0.5; s.z = m.z + dir.z * 0.5;
    s.vx = v.vx + dir.x * e; s.vy = v.vy + dir.y * e; s.vz = v.vz + dir.z * e; s.dx = dir.x; s.dy = dir.y; s.dz = dir.z;
    s.spare = v; s.part = p; s.sim = F; s.enemy = !!v.ai && !v.ai.ally; s.gvp = true;
    if (w.asm) {
      s.asm = true; s.accel = 0; s.burn = s.life = w.life || 75; s.spd = w.speed || 260; s.coast = 0; s.gt = 0.4; s.he = w.he; s.cm = new WeakSet(); s.ph = 0; s.big = true;
      s.range = w.range || 18000; s.run = 0;
    } else {
      s.vls = true; s.coast = 0; s.gt = 0; s.gr = true; s.prox = w.prox || 8; s.big = true; s.pitch = 0;
    }
  }
  // An anti-ship missile's flight (Combat.moveShot, ahead of its hit tests): out of the canister it climbs to 30 m, then
  // skims ASM.skim m over the waves (the sea under it, Ship.wave × the fade) at its speed (the motor burns all the way),
  // steering in the horizontal plane by lead pursuit (Combat's guide, at turn g); ASM.term m from its target the seeker
  // goes active and it drops to ASM.termH m. With no target it flies on and its seeker looks 30° either side within
  // 10 km for a ship; taken in by chaff (asmLured) it flies at the cloud until it is past it, then looks again. Its
  // velocity is set here; Combat's drag and gravity act on it for the step.
  const AW = { level: 0, bed: 0, depth: 0, alt: 0, a: 0, z: 0, lake: false };
  function asmStep(s, h, F) {
    const b = s.b, A = SHIP.ASM, r = Math.hypot(s.x, s.y, s.z), ux = s.x / r, uy = s.y / r, uz = s.z / r;
    s.run = (s.run || 0) + (s.spd || 260) * h;
    if ((s.wT = (s.wT || 0) - h) <= 0) { s.wT = 0.25; waterPt(b, s, AW); s.lev = AW.level > -Infinity ? AW.level : 0; s.wh = waveAt(b, AW, F); } // (the sea under it: four looks a second)
    const over = r - b.radius - (s.lev || 0) - (s.wh || 0);
    if (s.target && (s.target.dead || s.target.alive === false || (s.target.fate && !s.target.remote))) s.target = null;
    if (s.lure) { // (taken in by chaff: at the cloud until it is past it, then its seeker looks ahead again)
      const f = s.lure, dx = f.x - s.x, dy = f.y - s.y, dz = f.z - s.z, d = Math.hypot(dx, dy, dz) || 1;
      if (d < 60 || (dx * s.dx + dy * s.dy + dz * s.dz) / d < 0) { s.lure = null; s.lookT = 0; }
    }
    if (!s.target && !s.lure && s.t > 2 && (s.lookT = (s.lookT || 0) - h) <= 0) { // (its seeker, on its own: a ship ahead)
      s.lookT = 0.5;
      let bd = 10000;
      for (const t of seaTargets(s.owner && s.owner.parts ? s.owner : { ai: { ally: !s.enemy } }, F, ST)) {
        const P = posOf(t, TPO), dx = P.x - s.x, dy = P.y - s.y, dz = P.z - s.z, d = Math.hypot(dx, dy, dz) || 1;
        if ((dx * s.dx + dy * s.dy + dz * s.dz) / d > Math.cos(30 * DEG) && d < bd) { bd = d; s.target = t; }
      }
    }
    // the horizontal: lead pursuit
    let hx = s.dx - ux * (s.dx * ux + s.dy * uy + s.dz * uz), hy = s.dy - uy * (s.dx * ux + s.dy * uy + s.dz * uz), hz = s.dz - uz * (s.dx * ux + s.dy * uy + s.dz * uz), d = Infinity;
    let hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
    const aim = s.target || s.lure;
    if (aim && s.t > 1) {
      const P = posOf(aim, TPO), spd = s.spd || 260;
      if (aim.sh && aim.bounds && aim.toWorld) { // ([WP9 review] a ship at a point of her own along her length (the middle 70 %), as a torpedo: every missile at her middle merged into one capped hole)
        if (s.ao == null || s.aoT !== aim) { s.aoT = aim; s.ao = (crnd() * 2 - 1) * 0.35; }
        const B = aim.bounds, c = aim.com || { x: 0, y: 0, z: 0 }, Q = aim.toWorld((B.minX + B.maxX) / 2 + s.ao * (B.maxX - B.minX), c.y, 0);
        P.x = Q.x; P.y = Q.y; P.z = Q.z;
      }
      d = Math.hypot(P.x - s.x, P.y - s.y, P.z - s.z);
      const tgo = Math.min(d / spd, 30);
      let wx = P.x + P.vx * tgo - s.x, wy = P.y + P.vy * tgo - s.y, wz = P.z + P.vz * tgo - s.z;
      const k = wx * ux + wy * uy + wz * uz; wx -= ux * k; wy -= uy * k; wz -= uz * k;
      const wl = Math.hypot(wx, wy, wz);
      if (wl > 1) {
        wx /= wl; wy /= wl; wz /= wl;
        const c = clamp(hx * wx + hy * wy + hz * wz, -1, 1), sg = Math.sign((hy * wz - hz * wy) * ux + (hz * wx - hx * wz) * uy + (hx * wy - hy * wx) * uz) || 1;
        const a = Math.min(Math.acos(c), ((s.turn || 6) * 9.81 / Math.max(spd, 50)) * h) * sg, ca = Math.cos(a), sa = Math.sin(a);
        const qx = uy * hz - uz * hy, qy = uz * hx - ux * hz, qz = ux * hy - uy * hx;
        hx = hx * ca + qx * sa; hy = hy * ca + qy * sa; hz = hz * ca + qz * sa;
        hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
      }
      if (d < A.term) s.seen = true; // (its own radar on: terminal)
    }
    // the vertical: up out of the canister to 30 m, then down to the skim height, the terminal height inside ASM.term
    if (s.ph === 0 && (over >= A.climb || s.t > 4)) s.ph = 1;
    const want = s.ph === 0 ? A.climb : s.seen ? A.termH : A.skim;
    const spd = Math.min(s.spd || 260, 40 + (s.spd || 260) * Math.min(1, s.t / 1.5)); // (its booster: to full speed in 1.5 s)
    const vz = s.ph === 0 ? Math.max(12, Math.min(spd * 0.45, (A.climb - over) * 2 + 8)) : clamp((want - over) * 2.2, -0.2 * spd, 0.25 * spd);
    const vh = Math.sqrt(Math.max(0, spd * spd - vz * vz));
    s.vx = hx * vh + ux * vz; s.vy = hy * vh + uy * vz; s.vz = hz * vh + uz * vz;
    s.dx = s.vx / spd; s.dy = s.vy / spd; s.dz = s.vz / spd;
    if (s.run > (s.range || 18000) + 500) s.life = Math.min(s.life, s.t); // (out of fuel past its range: down it goes)
    return d;
  }
  // an anti-ship missile chaff took in (combat.js moveShot: decoyed, at the existing odds, took its target away): it
  // flies at the cloud that did it (the nearest it weighed to the ship it was after) until it is past it
  function asmLured(s, ship, F) {
    const P = posOf(ship, TPO);
    let best = null, bd = Infinity;
    if (typeof Combat !== 'undefined') for (const f of Combat.S.flares) {
      if (!f.chaff || !s.cm || !s.cm.has(f)) continue;
      const d = Math.hypot(f.x - P.x, f.y - P.y, f.z - P.z);
      if (d < bd) { bd = d; best = f; }
    }
    s.lure = best; s.target = null; s.lookT = 0;
    void F;
  }
  // An anti-ship missile into vessel o's part p at `at` (combat.js moveShot's hit, for s.asm): through a hull's plate up to
  // its he mm (120: a destroyer's 12 mm side, never a thick belt) it bursts inside, 1.5 m in (Combat.explode, inside:
  // HOLE.heIn·blast² more hole, a fire); against thicker plate, or anything but a hull, it bursts where it hit. false: spent
  const _ah = [], _aA = v3(), _aE = v3(), _aI = v3();
  function asmHit(s, o, p, at, F) {
    const b = s.b, by = s.owner && s.owner.parts ? s.owner : undefined, sp = Math.hypot(s.vx, s.vy, s.vz) || 1, ux = s.vx / sp, uy = s.vy / sp, uz = s.vz / sp;
    let inside = false, P = at;
    if (p && p.def.shull && o.sh && typeof Armour !== 'undefined') {
      _aA.x = at.x - ux * 0.5; _aA.y = at.y - uy * 0.5; _aA.z = at.z - uz * 0.5; _aE.x = at.x + ux * 3; _aE.y = at.y + uy * 3; _aE.z = at.z + uz * 3;
      const H = Armour.hitAll(o, _aA, _aE, _ah).find((q) => q.p === p);
      const mm = H ? hullMm(p, H.edge, H.u) : Infinity;
      if (mm <= (s.he || 0)) {
        for (const k of [1.5, 0.8, 0.3]) { _aI.x = at.x + ux * k; _aI.y = at.y + uy * k; _aI.z = at.z + uz * k; if (insideHull(o, localOf(o, _aI, _cf))) { inside = true; P = { x: _aI.x, y: _aI.y, z: _aI.z }; break; } }
      }
    }
    if (typeof Combat !== 'undefined') Combat.explode(b, { x: P.x, y: P.y, z: P.z }, s.blast || 12, s.dmg || 3000, by, F, false, s.he, undefined, undefined, inside ? { inside: true } : undefined);
    if (typeof Death !== 'undefined' && Death.deathFX) Death.deathFX(o, F, 'ammo', 4, { x: P.x, y: P.y, z: P.z });
    s.dead = true;
    return false;
  }
  // A vertical-launch SAM's first seconds (combat.js moveShot, s.vls): straight up out of its cell for VLS.t s, then over
  // toward its target at VLS.rate °/s until it points within 10° of it; true while it steers itself (then Combat's
  // semi-active guidance has it). With no target it pitches over along the cell's way and flies on.
  function vlsStep(s, h, F) {
    if (s.pitch > 1) return false;
    if (s.t < SHIP.VLS.t) { s.vx = s.dx * Math.hypot(s.vx, s.vy, s.vz); s.vy = s.dy * Math.hypot(s.vx, s.vy, s.vz); s.vz = s.dz * Math.hypot(s.vx, s.vy, s.vz); return true; }
    const t = s.target, P = t ? (t.k === 'missile' ? t : posOf(t, TPO)) : null;
    if (!P) { s.pitch = 2; return false; }
    let wx = P.x - s.x, wy = P.y - s.y, wz = P.z - s.z;
    const wl = Math.hypot(wx, wy, wz) || 1; wx /= wl; wy /= wl; wz /= wl;
    const c = clamp(s.dx * wx + s.dy * wy + s.dz * wz, -1, 1), ang = Math.acos(c);
    if (ang < 10 * DEG) { s.pitch = 2; return false; }
    const m = Math.min(1, (SHIP.VLS.rate * DEG * h) / ang), spd = Math.hypot(s.vx, s.vy, s.vz);
    let nx = s.dx + (wx - s.dx) * m, ny = s.dy + (wy - s.dy) * m, nz = s.dz + (wz - s.dz) * m;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    s.dx = nx; s.dy = ny; s.dz = nz; s.vx = nx * spd; s.vy = ny * spd; s.vz = nz * spd;
    s.pitch = 1;
    return true;
  }
  // (S3) a SAM's proximity burst beside the missile it was guided at (combat.js moveShot): the missile is killed with
  // p 0.7. true: killed.
  const SAM_P = 0.7;
  function samKill(s, m, F) {
    if (!m || m.k !== 'missile' || m.dead) return false;
    if (crnd() >= SAM_P) return false;
    kill(m, s.owner, F);
    return true;
  }
  function kill(m, by, F) {
    m.dead = true; m.killedBy = by || null;
    if (m.netId != null || m.net) m.ciwsKill = true; // ([WP11] a copy of another player's missile: its owner must hear it (mkill))
    if (typeof FX !== 'undefined') FX.explosion(m.b, { x: m.x, y: m.y, z: m.z }, { x: m.vx * 0.3, y: m.vy * 0.3, z: m.vz * 0.3 }, 1.6, true);
  }

  // ---- the close-in gun (§8.10)
  // Ship.ciwsStep (Combat.frame, while Combat.S.pd: any live craft with a CIWS aboard), for each whole mount of each craft
  // (a ship's while sh.ciwsOn, on unless switched off; a craft with no helm always): its target ten times a second,
  // the threat with the least time to reach her (hostile missiles closing within CIWS.cone of her, aircraft, drones;
  // within range and its arcs; never the low-and-slow notch: a hovering helicopter, a slow drone, a sea-skimmer are all
  // seen), the mount slewing to the lead point at `slew` °/s, and within CIWS.on° of it 1 s bursts: a simulated round
  // every 1/15 s carrying 5 (k 'shell', sh 'ciws20', ciws 5), CIWS.disp rad of dispersion, every third a tracer. `ammo`
  // rounds, `reload` s to fill again. The mount's own frame: its +x ahead (on deck at rot 0), +y up.
  const CIWS_DT = 1 / 15, CIWS_N = 5, CIWS_V = 1100, _cw = v3(), _cu = v3(), _cl = v3(), CT = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  function ciwsStep(F, dt) {
    if (!(dt > 0) || !F || !F.vessels) return;
    for (const v of F.vessels) {
      if (!v.ciws || !v.ciws.length || v.dead || v.remote || v.ko || v.wreck || v.fate || !v.parts.length) continue;
      const on = !v.sh || !isSea(v.kind) ? true : v.sh.ciwsOn !== false; // (the player's switch, the computer's Ship.ciwsOn)
      for (const p of v.ciws) {
        if (!on || !v.parts.includes(p) || p.broken || (p.hp != null && p.hp <= 0)) { p.gunOn = false; continue; }
        mount(v, p, F, dt);
      }
    }
  }
  function mount(v, p, F, dt) {
    const C = p.def.ciws, K = SHIP.CIWS;
    if (p.ammo == null) p.ammo = C.ammo;
    if (!(p.ammo > 0)) { p.gunOn = false; p.cR = (p.cR || 0) + dt; if (p.cR >= C.reload) { p.ammo = C.ammo; p.cR = 0; } return; }
    // its target, ten times a second (after a kill, CIWS.assess s checking it first)
    const t0 = p.tgt;
    if (t0 && !(t0.k === 'missile' ? !t0.dead : !t0.dead && t0.parts && t0.parts.length)) { p.tgt = null; p.cA = K.assess; p.bT = 0; }
    if (p.cA > 0) { p.cA -= dt; p.gunOn = false; p.cF = 0; return; }
    if ((p.cT = (p.cT || 0) - dt) <= 0) { p.cT = 0.1; p.tgt = threat(v, p, F); }
    // the lead point (sim): the target ahead by the rounds' time (their drag), raised for their drop; into the mount's frame
    let wantY = 0, wantE = 0, on = false;
    const M = muzzleOf(v, p, _cw);
    if (p.tgt) {
      const T = p.tgt, rho = airDensity(v.body, Math.hypot(M.x, M.y, M.z) - v.body.radius), kr = Math.max(SHELLS.ciws20.k * rho, 1e-9);
      let tt = 0;
      for (let i = 0; i < 3; i++) { const D = Math.hypot(T.x + (T.vx - v.vx) * tt - M.x, T.y + (T.vy - v.vy) * tt - M.y, T.z + (T.vz - v.vz) * tt - M.z); tt = Math.expm1(kr * D) / (kr * CIWS_V); }
      const r = Math.hypot(M.x, M.y, M.z) || 1, g = v.body.mu / (r * r), dropK = 0.5 * g * tt * tt;
      _cl.x = T.x + (T.vx - v.vx) * tt - M.x + (M.x / r) * dropK; _cl.y = T.y + (T.vy - v.vy) * tt - M.y + (M.y / r) * dropK; _cl.z = T.z + (T.vz - v.vz) * tt - M.z + (M.z / r) * dropK;
      qunrot(v.q, _cl.x, _cl.y, _cl.z, _cu); unrotPart(p, _cu);
      const rel = Math.hypot(T.vx - v.vx, T.vy - v.vy, T.vz - v.vz);
      p.eK = K.err * Math.max(1, Math.hypot(_cl.x, _cl.y, _cl.z) / K.errD) * (T.k === 'missile' ? 1 : clamp(rel / K.errV, K.errMin, 1)); // (its fire control's error there, each round's own: it grows with the range past errD m, its track firming up as the threat closes; an aircraft's or a drone's track the steadier the slower it goes)
      wantY = Math.atan2(_cu.z, _cu.x); wantE = Math.atan2(_cu.y, Math.hypot(_cu.x, _cu.z));
      wantY = clamp(wantY, C.yaw[0] * DEG, C.yaw[1] * DEG); wantE = clamp(wantE, C.el[0] * DEG, C.el[1] * DEG);
    }
    const m = C.slew * DEG * dt, y0 = p.aimYaw || 0, e0 = p.aimEl || 0;
    p.aimYaw = y0 + clamp(wantY - y0, -m, m); p.aimEl = e0 + clamp(wantE - e0, -m, m);
    if (p.tgt) on = Math.hypot(wantY - p.aimYaw, wantE - p.aimEl) < K.on * DEG;
    if (on) p.bT = K.burst; else if (p.bT > 0) p.bT -= dt; // (a burst runs its second out)
    p.gunOn = on || p.bT > 0;
    if (!p.gunOn) { p.cF = 0; return; }
    p.cF = (p.cF || 0) + dt;
    while (p.cF >= CIWS_DT && p.ammo > 0) { p.cF -= CIWS_DT; round(v, p, F, M); }
  }
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, crnd()))) * Math.cos(TAU * crnd()); // (a normal deviate: the combat's dice)
  // the mount's muzzle (sim): its top, a little ahead along its barrels
  function muzzleOf(v, p, o) { const G = typeof nvCiwsLay === 'function' ? nvCiwsLay(p.def).gun : { y: 0 }, q = partPt(p, 0, G.y), w = v.toWorld(q.x, q.y, partZ(p)); o.x = w.x; o.y = w.y; o.z = w.z; return o; } // (its barrels' trunnion line, over the turning axis)
  // a part-space direction into a rot-k part's own frame (and back)
  function unrotPart(p, o) { for (let i = 0, k = p.rot & 3; i < k; i++) { const t = o.x; o.x = o.y; o.y = -t; } return o; }
  function rotPart(p, o) { for (let i = 0, k = p.rot & 3; i < k; i++) { const t = o.x; o.x = -o.y; o.y = t; } return o; }
  function round(v, p, F, M) {
    const ce = Math.cos(p.aimEl || 0), d = _cd;
    d.x = ce * Math.cos(p.aimYaw || 0); d.y = Math.sin(p.aimEl || 0); d.z = ce * Math.sin(p.aimYaw || 0);
    rotPart(p, d); qrot(v.q, d.x, d.y, d.z, d);
    // dispersion: within CIWS.disp of the line (a disc, the combat's dice)
    let ex = -d.y, ey = d.x, ez = 0;
    if (Math.abs(d.z) > 0.9) { ex = 0; ey = -d.z; ez = d.y; }
    const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
    const fx = d.y * ez - d.z * ey, fy = d.z * ex - d.x * ez, fz = d.x * ey - d.y * ex, rr = SHIP.CIWS.disp * Math.sqrt(crnd()), a = crnd() * TAU, c = rr * Math.cos(a) + gauss() * (p.eK || 0), s = rr * Math.sin(a) + gauss() * (p.eK || 0); // (its spread, and its fire control's error)
    d.x += ex * c + fx * s; d.y += ey * c + fy * s; d.z += ez * c + fz * s;
    const l = Math.hypot(d.x, d.y, d.z); d.x /= l; d.y /= l; d.z /= l;
    p.shots = (p.shots || 0) + 1; p.ammo = Math.max(0, p.ammo - CIWS_N); p.shotAt = F.time || 0;
    const SH = SHELLS.ciws20;
    const out = typeof nvCiwsLay === 'function' ? (() => { const G = nvCiwsLay(p.def).gun; return G.x + G.L; })() : 1.2;
    Combat.S.shots.push({ k: 'shell', sh: 'ciws20', b: v.body, x: M.x + d.x * out, y: M.y + d.y * out, z: M.z + d.z * out, vx: v.vx + d.x * CIWS_V, vy: v.vy + d.y * CIWS_V, vz: v.vz + d.z * CIWS_V,
      t: 0, life: Math.min(SH.life, (p.def.ciws.range + 400) / CIWS_V), owner: v, enemy: !!v.ai && !v.ai.ally, net: 0, cal: SH.cal, pen: SH.pen, v0: CIWS_V, spare: v, tracer: p.shots % 3 === 0, prox: 0, ric: false, cheap: true, ciws: CIWS_N }); // (gone a little past its reach)
    if (typeof FX !== 'undefined' && p.shots % 2 === 0 && F.active && Math.hypot(M.x - F.active.x, M.y - F.active.y, M.z - F.active.z) < 3000) FX.add({ kind: 'flash', b: v.body, x: M.x + d.x * (out + 0.2), y: M.y + d.y * (out + 0.2), z: M.z + d.z * (out + 0.2), vx: v.vx, vy: v.vy, vz: v.vz, max: 0.05, size: 0.5, grow: 1.4, color: '#ffd27a', alpha: 1, nolight: true });
  }
  // the threat with the least time to reach v, in mount p's reach and arcs (sim position and velocity into the result)
  function threat(v, p, F) {
    const C = p.def.ciws, K = SHIP.CIWS, R = C.range, M = muzzleOf(v, p, _cw);
    let best = null, bt = Infinity;
    const arcs = (x, y, z) => { _cu.x = x - M.x; _cu.y = y - M.y; _cu.z = z - M.z; qunrot(v.q, _cu.x, _cu.y, _cu.z, _cu); unrotPart(p, _cu); const yw = Math.atan2(_cu.z, _cu.x) / DEG, e = Math.atan2(_cu.y, Math.hypot(_cu.x, _cu.z)) / DEG; return yw >= C.yaw[0] && yw <= C.yaw[1] && e >= C.el[0] && e <= C.el[1]; };
    const time = (x, y, z, vx, vy, vz) => { const dx = v.x - x, dy = v.y - y, dz = v.z - z, d = Math.hypot(dx, dy, dz) || 1, cl = ((vx - v.vx) * dx + (vy - v.vy) * dy + (vz - v.vz) * dz) / d; return d / Math.max(cl, 20); };
    if (C.missiles && typeof Combat !== 'undefined') for (const m of Combat.S.shots) {
      if (m.k !== 'missile' || m.dead || !shotFoe(v, m)) continue;
      const dx = v.x - m.x, dy = v.y - m.y, dz = v.z - m.z, d = Math.hypot(dx, dy, dz) || 1;
      if (d > R + (v.reach || 10)) continue;
      const sp = Math.hypot(m.vx - v.vx, m.vy - v.vy, m.vz - v.vz) || 1;
      if (((m.vx - v.vx) * dx + (m.vy - v.vy) * dy + (m.vz - v.vz) * dz) / (sp * d) < Math.cos(K.cone * DEG)) continue; // (closing on her, within CIWS.cone)
      if (!arcs(m.x, m.y, m.z)) continue;
      const t = time(m.x, m.y, m.z, m.vx, m.vy, m.vz);
      if (t < bt) { bt = t; best = m; }
    }
    if (C.air || C.drones) for (const o of F.vessels) {
      if (o === v || o.dead || o.wreck || !o.parts.length || o.body !== v.body || (o.sh && o.afloat) || !foe(v, o)) continue;
      const drone = o.kind === 'drone';
      if (drone ? !C.drones : !C.air || !(isAirKind(o.kind) || flying(o))) continue;
      if (o.landed || o.contactTime > 0) continue; // (an aircraft or a drone on the ground or a deck)
      const d = Math.hypot(o.x - M.x, o.y - M.y, o.z - M.z);
      if (d > R || !arcs(o.x, o.y, o.z)) continue;
      const t = time(o.x, o.y, o.z, o.vx, o.vy, o.vz) + 0.5; // (a missile first, when both close as fast)
      if (t < bt) { bt = t; best = o; }
    }
    return best;
  }
  // A CIWS round's step a -> e (armour.js moveShell, for s.ciws): the missiles in its way; the highest ground in the land
  // mask's cell under it its gTop (moveShell looks at the ground only below it); over a cell all sea, into the flat sea
  // there it ends with a splash where it crosses the surface (the waves left out: no look at the ground at all). true: spent.
  const _cr = {};
  function ciwsRound(s, a, e, F) {
    if (shotMissiles(s, a, e, F)) return true;
    const B = s.b;
    Terrain.locate(B, e.x, e.y, e.z, _cr);
    const top = cellTop(B, _cr.a, _cr.z), h1 = _cr.r - B.radius;
    s.gTop = Math.max(0, top);
    if (!(top < 0) || h1 > 0 || !B.ocean) return false;
    const h0 = Math.hypot(a.x, a.y, a.z) - B.radius, f = h0 > h1 ? clamp(h0 / (h0 - h1), 0, 1) : 1;
    if (typeof FX !== 'undefined' && Math.random() < 0.35 && F && F.active && Math.hypot(e.x - F.active.x, e.y - F.active.y, e.z - F.active.z) < 3000) {
      const at = { x: a.x + (e.x - a.x) * f, y: a.y + (e.y - a.y) * f, z: a.z + (e.z - a.z) * f }, r = Math.hypot(at.x, at.y, at.z) || 1;
      FX.splash(B, at, { x: at.x / r, y: at.y / r, z: at.z / r }, 1.5); // (armour.js ground()'s for a cheap round)
    }
    return true;
  }
  // A CIWS round's segment a -> e against the missiles hostile to its mount's craft: a missile within CIWS.kill m of it
  // (each missile's own step taken into account) is killed with p 1 − (1 − CIWS.p)^n (n the rounds it stands for: 0.88).
  // true: one killed (the round is spent).
  const _sq = v3();
  function shotMissiles(s, a, e, F) {
    if (typeof Combat === 'undefined') return false;
    const v = s.owner, K = SHIP.CIWS, n = s.ciws || 1, ex = e.x - a.x, ey = e.y - a.y, ez = e.z - a.z, L2 = ex * ex + ey * ey + ez * ez, h = 1 / 120;
    for (const m of Combat.S.shots) {
      if (m.k !== 'missile' || m.dead || (v && !shotFoe(v, m))) continue;
      const cx = (a.x + e.x) / 2 - m.x, cy = (a.y + e.y) / 2 - m.y, cz = (a.z + e.z) / 2 - m.z, reach = Math.sqrt(L2) / 2 + Math.hypot(m.vx, m.vy, m.vz) * h + K.kill;
      if (cx * cx + cy * cy + cz * cz > reach * reach) continue;
      if (segSeg(a, ex, ey, ez, m.x - m.vx * h, m.y - m.vy * h, m.z - m.vz * h, m.vx * h, m.vy * h, m.vz * h) > K.kill * K.kill) continue;
      m.ciwsNear = (m.ciwsNear || 0) + 1; // (rounds that passed close enough: the tests count them)
      if (v && (m.x - v.x) ** 2 + (m.y - v.y) ** 2 + (m.z - v.z) ** 2 < K.leak * K.leak) continue; // (too late: what is left of it carries on into her)
      if (crnd() < 1 - Math.pow(1 - K.p, n)) { kill(m, v, F); return true; }
    }
    return false;
  }
  // the squared distance between the segments a + s·d1 and b + t·d2 (s, t in 0..1)
  function segSeg(a, d1x, d1y, d1z, bx, by, bz, d2x, d2y, d2z) {
    const rx = a.x - bx, ry = a.y - by, rz = a.z - bz, A = d1x * d1x + d1y * d1y + d1z * d1z, E = d2x * d2x + d2y * d2y + d2z * d2z, f = d2x * rx + d2y * ry + d2z * rz;
    let s, t;
    if (A < 1e-12 && E < 1e-12) { s = t = 0; }
    else if (A < 1e-12) { s = 0; t = clamp(f / E, 0, 1); }
    else {
      const c = d1x * rx + d1y * ry + d1z * rz;
      if (E < 1e-12) { t = 0; s = clamp(-c / A, 0, 1); }
      else {
        const B = d1x * d2x + d1y * d2y + d1z * d2z, den = A * E - B * B;
        s = den > 1e-12 ? clamp((B * f - c * E) / den, 0, 1) : 0;
        t = (B * s + f) / E;
        if (t < 0) { t = 0; s = clamp(-c / A, 0, 1); } else if (t > 1) { t = 1; s = clamp((B - c) / A, 0, 1); }
      }
    }
    const qx = rx + d1x * s - d2x * t, qy = ry + d1y * s - d2y * t, qz = rz + d1z * s - d2z * t;
    return qx * qx + qy * qy + qz * qz;
  }

  // ---- seeing ships (§8.11)
  // A clear look over water from a to b (sim points; ha, hb their heights over the water, else over the sphere): within
  // the horizon √(2R·ha) + √(2R·hb) (R the body's radius), no land in the way (sampled every LOS.step m where a cell of the
  // per-map land mask (LOS.cell m, built as it is first asked) holds land), no smoke (Aim.smokeBlocks)
  const LMASK = new Map(), _ll = {};
  function seesSea(a, b, ha, hb) {
    const B = (a && a.body) || (b && b.body) || EARTH, R = B.radius;
    if (!a || !b) return false;
    if (!Number.isFinite(ha)) ha = Math.hypot(a.x, a.y, a.z) - R;
    if (!Number.isFinite(hb)) hb = Math.hypot(b.x, b.y, b.z) - R;
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (d > Math.sqrt(2 * R * Math.max(0.5, ha)) + Math.sqrt(2 * R * Math.max(0.5, hb))) return false;
    if (!landClear(B, a, b, d)) return false;
    if (typeof Combat !== 'undefined' && Combat.S.smoke.length && typeof Aim !== 'undefined' && Aim.smokeBlocks(a, b)) return false;
    return true;
  }
  function landClear(B, a, b, d) {
    const L = SHIP.LOS, n = Math.max(1, Math.ceil(d / L.step)), R = B.radius;
    const ra = Math.hypot(a.x, a.y, a.z), rb = Math.hypot(b.x, b.y, b.z);
    for (let i = 1; i < n; i++) {
      const k = i / n, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
      Terrain.locate(B, x, y, z, _ll);
      if (!(cellTop(B, _ll.a, _ll.z) > 0)) continue; // (all sea there)
      const g = Terrain.heightAt(B, _ll.a, _ll.z), line = _ll.r - R;
      if (g > line + 1) return false;
    }
    void ra; void rb;
    return true;
  }
  // ([WP9 review] a naval shell's gTop, armour.js moveShell: over a cell all sea, the sea's level (0); over land, the
  // highest ground the mask found in its cell and SEA_TOP_M m more (the mask samples a cell every LOS.cell/3 m))
  const _stl = {}, SEA_TOP_M = 50;
  // (s, dt: also where it will be dt s on, at its velocity)
  function seaTop(B, P, s, dt) {
    if (!B || !B.ocean || typeof Terrain === 'undefined') return Infinity;
    Terrain.locate(B, P.x, P.y, P.z, _stl);
    let top = cellTop(B, _stl.a, _stl.z);
    if (s && dt > 0) { Terrain.locate(B, P.x + s.vx * dt, P.y + s.vy * dt, P.z + s.vz * dt, _stl); top = Math.max(top, cellTop(B, _stl.a, _stl.z)); }
    return top < 0 ? 0 : top + SEA_TOP_M;
  }
  // the highest ground in a LOS.cell m cell round (a, z) (−Infinity: none; the mask, built a cell at a time)
  function cellTop(B, a, z) {
    const c = SHIP.LOS.cell, R = B.radius, ia = Math.floor((a * R) / c), iz = Math.floor(z / c), key = (B.id || 'b') + ':' + ia + ':' + iz;
    let h = LMASK.get(key);
    if (h === undefined) {
      if (LMASK.size > 60000) LMASK.clear();
      h = -Infinity;
      for (let i = 0; i <= 3; i++) for (let j = 0; j <= 3; j++) h = Math.max(h, Terrain.heightAt(B, ((ia + i / 3) * c) / R, (iz + j / 3) * c));
      LMASK.set(key, h);
    }
    return h;
  }
  // Her radar size (× a radar's reach on her): clamp((L_wl / RADAR.rcsL)^rcsExp, rcsMin, 1) × (1 − her stealth) (a
  // destroyer the whole reach, a RIB 0.4, the Vizby × 0.6: only her stealthiest part's counts)
  function rcs(v) {
    if (!v || !v.parts) return 1;
    if (v._rcs && v._rcsN === v.parts.length) return v._rcs;
    const R = SHIP.RADAR, L = v.sh && v.sh.Lwl > 0 ? v.sh.Lwl : 2 * (v.reach || 5);
    let st = 0;
    for (const p of v.parts) if (p.def.ship && p.def.stealth > st) st = p.def.stealth;
    v._rcsN = v.parts.length;
    return (v._rcs = clamp(Math.pow(L / R.rcsL, R.rcsExp), R.rcsMin, 1) * (1 - st));
  }
  // where a craft is seen from or looks from: its highest point (sim) and its height over the water
  const EYE = { x: 0, y: 0, z: 0, h: 0 };
  function topOf(o, out = EYE) {
    if (o.def && o.pos) { const c = Combat.targetCentre(o); out.x = c.x; out.y = c.y; out.z = c.z; out.h = o.def.h; return out; }
    if (o.k === 'missile') { out.x = o.x; out.y = o.y; out.z = o.z; out.h = Math.max(0.5, Math.hypot(o.x, o.y, o.z) - o.b.radius); return out; }
    const c = o.com || { x: 0, y: 0, z: 0 }, top = o.bounds ? o.bounds.maxY : c.y + 2;
    const w = o.toWorld ? o.toWorld(c.x, top, c.z || 0) : o;
    out.x = w.x; out.y = w.y; out.z = w.z; out.h = Math.max(0.5, Math.hypot(w.x, w.y, w.z) - o.body.radius - (o.sh && o.sh.level > -Infinity ? o.sh.level : 0));
    return out;
  }
  // a radar part's eye: its top (sim) and height over the water
  function eyeOf(v, p, out) {
    const w = v.toWorld(p.x, p.y + p.def.h / 2, partZ(p));
    out.x = w.x; out.y = w.y; out.z = w.z; out.h = Math.max(0.5, Math.hypot(w.x, w.y, w.z) - v.body.radius - (v.sh && v.sh.level > -Infinity ? v.sh.level : 0));
    return out;
  }
  // Ship.surface: what v's sea radars see, four times a second: ships (hydro vessels afloat, other players' ships, the
  // range's boats) within a whole radar's reach × their radar size and over its horizon (seesSea); with lowAir, anything
  // under RADAR.lowAir m within 10 km (sea-skimming missiles, low helicopters and planes). [{ ref, x, y, z, d, k: 'sea' |
  // 'low' }], nearest first; the same array until the next look
  const SE = { x: 0, y: 0, z: 0, h: 0 }, ST2 = { x: 0, y: 0, z: 0, h: 0 };
  function surface(v, F) {
    if (!v || !v.parts || !F) return NONE;
    const now = clockOf(F), C = v._surf || (v._surf = { t: -9, n: -1, list: [] });
    if (now - C.t < 0.25 && now >= C.t && C.n === v.parts.length) return C.list;
    C.t = now; C.n = v.parts.length;
    const out = C.list;
    out.length = 0;
    const radars = v.parts.filter((p) => p.def.searchRadar && p.def.searchRadar.sea && !p.broken && !(p.hp != null && p.hp <= 0));
    if (!radars.length || v.ko || v.dead) return out;
    let top = radars[0];
    for (const p of radars) if (p.y + p.def.h / 2 > top.y + top.def.h / 2) top = p;
    const E = eyeOf(v, top, SE), R = top.def.searchRadar, seen = new Set();
    const add = (ref, P, d, k) => { if (seen.has(ref)) return; seen.add(ref); out.push({ ref, x: P.x, y: P.y, z: P.z, d, k }); };
    for (const t of seaTargets(v, F, ST)) {
      const T = topOf(t, ST2), P = t.def ? T : t, d = Math.hypot(P.x - E.x, P.y - E.y, P.z - E.z);
      if (d > R.range * (t.def ? 1 : rcs(t)) || !seesSea(E, T, E.h, T.h)) continue;
      add(t, P, d, 'sea');
    }
    if (R.lowAir) {
      const lo = SHIP.RADAR.lowAir, far = 10000;
      for (const o of F.vessels) {
        if (o === v || o.dead || o.body !== v.body || !o.parts.length || o.kind === 'drone' || (o.sh && o.afloat) || !(isAirKind(o.kind) || flying(o)) || o.landed || !foe(v, o)) continue;
        const T = topOf(o, ST2), d = Math.hypot(o.x - E.x, o.y - E.y, o.z - E.z);
        if (d > far || T.h > lo || !seesSea(E, T, E.h, T.h)) continue;
        add(o, o, d, 'low');
      }
      if (typeof Combat !== 'undefined') for (const m of Combat.S.shots) {
        if (m.k !== 'missile' || m.dead || !shotFoe(v, m)) continue;
        const T = topOf(m, ST2), d = Math.hypot(m.x - E.x, m.y - E.y, m.z - E.z);
        if (d > far || T.h > lo || !seesSea(E, T, E.h, T.h)) continue;
        add(m, m, d, 'low');
      }
    }
    out.sort((p, q) => p.d - q.d);
    return out;
  }
  // An air search radar's contacts (aim.js searchStep, searchRadar.air): aircraft and missiles over RADAR.lowAir m, and
  // lower ones once over its horizon (a sea-skimmer at 8 m inside about 4 km), within reach: [{ ref, x, y, z }]
  const AIRL = [];
  function airContacts(v, p, F) {
    AIRL.length = 0;
    const E = eyeOf(v, p, SE), R = p.def.searchRadar.range;
    for (const o of F.vessels) {
      if (o === v || o.dead || o.body !== v.body || !o.parts.length || o.kind === 'drone' || (o.sh && o.afloat) || !(isAirKind(o.kind) || flying(o)) || o.landed || o.contactTime > 0 || !foe(v, o)) continue;
      const T = topOf(o, ST2), d = Math.hypot(o.x - E.x, o.y - E.y, o.z - E.z);
      if (d > R * rcsAir(o) || !seesSea(E, T, E.h, T.h)) continue;
      AIRL.push({ x: o.x, y: o.y, z: o.z, ref: o });
    }
    if (typeof Combat !== 'undefined') {
      for (const e of Combat.S.targets) if (e.alive && e.def.air) { const c = Combat.targetCentre(e), d = Math.hypot(c.x - E.x, c.y - E.y, c.z - E.z); if (d < R) AIRL.push({ ...c, ref: e }); }
      for (const m of Combat.S.shots) {
        if (m.k !== 'missile' || m.dead || !shotFoe(v, m)) continue;
        const T = topOf(m, ST2), d = Math.hypot(m.x - E.x, m.y - E.y, m.z - E.z);
        if (d > R || !seesSea(E, T, E.h, T.h)) continue;
        AIRL.push({ x: m.x, y: m.y, z: m.z, ref: m });
      }
    }
    return AIRL;
  }
  // the craft in the air (and drones) hostile to v within R m of her (a ship's old turrets afloat, combat.js turretStep)
  const AF = [];
  function airFoes(v, F, R) {
    AF.length = 0;
    for (const o of F.vessels) {
      if (o === v || o.dead || o.body !== v.body || !o.parts.length || (o.sh && o.afloat) || !(isAirKind(o.kind) || flying(o)) || o.landed || o.contactTime > 0 || !foe(v, o)) continue;
      if ((o.x - v.x) ** 2 + (o.y - v.y) ** 2 + (o.z - v.z) ** 2 < R * R) AF.push(o);
    }
    return AF;
  }
  const rcsAir = (o) => (typeof Combat !== 'undefined' && Combat.stealthOf ? 1 - (o._stl ?? (o._stl = Combat.stealthOf(o))) : 1);
  // what a fire-control radar may lock (aim.js trackStep, trackRadar.missiles / .sea): hostile missiles closing on her
  // within its reach and over its horizon (S3), and with sea, ships (as surface)
  const TRKL = [];
  function trackContacts(v, p, F, base) {
    TRKL.length = 0;
    for (const c of base) TRKL.push(c);
    const tr = p.def.trackRadar, E = eyeOf(v, p, SE);
    if (tr.missiles && typeof Combat !== 'undefined') for (const m of Combat.S.shots) {
      if (m.k !== 'missile' || m.dead || !shotFoe(v, m)) continue;
      const dx = v.x - m.x, dy = v.y - m.y, dz = v.z - m.z, d = Math.hypot(dx, dy, dz) || 1;
      if (d > tr.range || (m.vx - v.vx) * dx + (m.vy - v.vy) * dy + (m.vz - v.vz) * dz <= 0) continue; // (closing)
      const T = topOf(m, ST2);
      if (!seesSea(E, T, E.h, T.h)) continue;
      TRKL.push({ x: m.x, y: m.y, z: m.z, ref: m, sea: true });
    }
    if (tr.sea) for (const t of seaTargets(v, F, ST)) {
      const T = topOf(t, ST2), P = t.def ? T : t, d = Math.hypot(P.x - E.x, P.y - E.y, P.z - E.z);
      if (d > tr.range * (t.def ? 1 : rcs(t)) || !seesSea(E, T, E.h, T.h)) continue;
      TRKL.push({ x: P.x, y: P.y, z: P.z, ref: t, sea: true });
    }
    return TRKL;
  }
  // can v's fire-control radar p still hold t (a missile or a ship: over its horizon), for aim.js trackStep and radarSees
  function holds(v, p, t) {
    const E = eyeOf(v, p, SE), T = topOf(t, ST2);
    return seesSea(E, T, E.h, T.h);
  }
  // the surface contact (radar or eyes) a ship's guns are on (ghud.js: the rangefinder, the crosshair past the horizon):
  // the nearest within `deg`° of the ray o + dir (sim), within reach; null: none
  function contactOn(v, F, o, dir, deg, reach) {
    let best = null, bk = Math.cos(deg * DEG);
    const L = surface(v, F), eye = topOf(v, SE), eyes = SHIP.EYES[night(v, F) ? 'night' : 'day'];
    const look = (ref, P) => { const dx = P.x - o.x, dy = P.y - o.y, dz = P.z - o.z, d = Math.hypot(dx, dy, dz) || 1, k = (dx * dir.x + dy * dir.y + dz * dir.z) / d; if (k > bk && d < reach) { bk = k; best = ref; } };
    for (const c of L) if (c.k === 'sea') look(c.ref, c);
    for (const t of seaTargets(v, F, ST)) { // (and those in sight)
      const T = topOf(t, ST2), P = t.def ? T : t, d = Math.hypot(P.x - eye.x, P.y - eye.y, P.z - eye.z);
      if (d < eyes && seesSea(eye, T, eye.h, T.h)) look(t, P);
    }
    return best;
  }

  // ---- the naval guns' magazines (§8.1): an empty naval gun (w.naval: its `ammo` its ready rounds) with a whole Shell
  // Magazine aboard refills its ready rounds from the magazines' pool (store.rounds, each round any calibre) over 4 ×
  // its reload (aim.js tick). Without one, its ready rounds are all.
  function refill(v, p, h, F) {
    const w = p.def.weapon;
    if (!w || p.broken || p.ammo > 0) { p.refT = 0; return false; }
    let pool = 0;
    for (const q of v.parts) if (q.def.store && q.def.store.rounds > 0 && !q.broken && !q.magUp) pool += Number.isFinite(q.rounds) ? q.rounds : q.def.store.rounds;
    if (!(pool > 0)) { p.refT = 0; return false; }
    p.refT = (p.refT || 0) + h;
    if (p.refT < 4 * (w.reload || 3)) return false;
    p.refT = 0;
    let need = w.ammo;
    for (const q of v.parts) {
      if (!(need > 0)) break;
      if (!q.def.store || !(q.def.store.rounds > 0) || q.broken || q.magUp) continue;
      const have = Number.isFinite(q.rounds) ? q.rounds : q.def.store.rounds, k = Math.min(have, need);
      q.rounds = have - k; need -= k;
    }
    p.ammo = w.ammo - need; p.store = p.ammo * (w.each || 0); p.reload = 0;
    if (F && v === F.active && !v.ai && F.toast) F.toast(`${p.def.name}: ${p.ammo} rounds up from the magazine`);
    return true;
  }

  // ---- the AI's calls (WP10's ships fight with these)
  // every naval gun laid on P (sim) and fired if laid within 0.5° and loaded; the guns keep laying on it (v.aimP). The
  // number fired.
  // ([WP9 review] each call refuses as the player's fire key does: no crew to fire, or doomed)
  const aiCan = (v) => !!v && !v.dead && !v.ko && !v.fate && (typeof Aim === 'undefined' || Aim.manned(v));
  function salvo(v, P, F) {
    if (!P || !aiCan(v) || typeof Aim === 'undefined') return 0;
    v.aimP = { x: P.x, y: P.y, z: P.z };
    let n = 0;
    const sys = Combat.systems(v);
    for (const s of sys) if (s.w.kind === 'tgun' && s.w.naval) for (const p of s.parts) {
      if (p.broken || !(p.ammo > 0) || p.reload > 0 || !(p._err < 0.5 * DEG)) continue;
      if (Aim.shoot(v, p, F)) { p.ammo--; p.reload = p.reloadT = p.ammo > 0 ? Aim.reloadOf(v, p) : 0; n++; }
    }
    return n;
  }
  // a torpedo from the tube on the side facing `bearing` (rad, clockwise from game north as Ship.heading), set to run
  // there after its straight run (its gyro). The shot, or null.
  function torpAt(v, bearing, F) {
    if (!v || !v.sh || !aiCan(v)) return null;
    const S = v.sh, r = frameOf(v, S), gx = S.N.x * Math.cos(bearing) + S.E.x * Math.sin(bearing), gy = S.N.y * Math.cos(bearing) + S.E.y * Math.sin(bearing), gz = S.N.z * Math.cos(bearing) + S.E.z * Math.sin(bearing);
    void r;
    let best = null, bk = -2;
    for (const p of v.parts) {
      const w = p.def.weapon;
      if (!w || w.kind !== 'torp' || p.broken || !(p.ammo > 0)) continue;
      const d = sideDir(v, p, _ca), D = v.axis(d.x, d.y, d.z), k = D.x * gx + D.y * gy + D.z * gz;
      if (k > bk) { bk = k; best = p; }
    }
    return best && bk > -0.1 ? fireTorp(v, best, F, { x: gx, y: gy, z: gz }) : null; // ([WP9 review] none from a tube facing away (ahead and astern still): its run would cross her)
  }
  // an anti-ship missile at target t (a vessel or a range target) from the launcher with missiles left. The shot or null.
  function asmAt(v, t, F) {
    if (!aiCan(v) || typeof Combat === 'undefined') return null;
    const p = v.parts.find((q) => q.def.weapon && q.def.weapon.asm && !q.broken && q.ammo > 0);
    return p ? Combat.launchMissile(v, p, t || null, F) : null;
  }
  // a vertical-launch SAM at t (an aircraft or a missile): the fire-control radar's lock put on it if it sees it. The
  // shot or null.
  function samAt(v, t, F) {
    if (!t || !aiCan(v) || typeof Combat === 'undefined' || typeof Aim === 'undefined') return null;
    const fc = Aim.kit(v).track, p = v.parts.find((q) => q.def.weapon && q.def.weapon.vls && !q.broken && q.ammo > 0);
    if (!fc || fc.broken || !p) return null;
    const T = v.trk || (v.trk = { on: false, cand: null, lockT: 0, lock: null, notchT: 0, blockT: 0, acc: 0 });
    if (T.lock !== t) { if (!holds(v, fc, t)) return null; T.lock = t; T.on = true; T.notchT = T.blockT = 0; }
    return Combat.launchMissile(v, p, t, F);
  }
  function ciwsOn(v, on) { if (v && v.sh) v.sh.ciwsOn = on !== false; return !!(v && v.sh && v.sh.ciwsOn); }
  function resetCombat() { NOISE.length = 0; } // (the tests')

  // ---- the frame (Combat.frame, when Combat.S.sea): collisions, flooding, fires, damage control, fate, mooring, the AI,
  // the Naval Range [WP1's loop; the others add their calls]
  function frame(F, dt) {
    moorCheck(F, dt); // (who moors on the swell, who wakes)
    decksOf(F); // [WP6] (the moving decks: Ship.D)
    bump(F); // [WP6]
    lashCheck(F, dt); // [WP6]
    for (const v of F.vessels) if (v.sh && v.sh.slam.length) slams(F, v); // [WP6]
    junk(F, dt); // [WP6]
    damageFrame(F, dt); // [WP8] (flooding, fires, damage control, fate, the sunk ships' wrecks)
    if (NOISE.length) noiseStep(F, dt); // [WP9] (torpedo noisemakers towed astern)
    aiFrame(F, dt); // [WP10] (the computer's ships, the Naval Range and its strike aircraft)
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
  // [WP10] The computer's ships (spec §9.1) and the Naval Range (§9.2). A computer's ship is a real Vessel from a stock
  // template (the same parts, hulls, flooding and hits as anyone's) on the real physics, marked v.ai = { sea: true, role,
  // skill, ... } (ai.sea: the gate everything here opens on; Combat.frame's bandit loop skips her, Aim.stepAll's AI loop
  // lays her guns at v.aimP). flight.js steps her out to SHIP.aiNear. Each frame (aiFrame, from Ship.frame): her guns' aim
  // point (GroundAI.aimAt's lead and error, and the fall of shot's correction); four times a second (think, ≤ 0.1 ms) what
  // she sees, the helm (sh.hold, a heading, and sh.tel, the telegraph: the player's own interface) and what she fires;
  // once a second (look) nine looks at the depth ahead and on a fan either side, turning her off land and shallows.
  // Roles: 'passive' (a moored hulk: Stop, never fires), 'loop' (steams round a loop at a speed, never fires), 'fight'
  // (finds, closes, keeps her range, fights, evades, retreats). She sees only what her radars and lookouts see (seenSea,
  // airSeen: no magic radar), fights with WP9's calls (salvo, torpAt, asmAt, samAt, ciwsOn, decoy), and is doomed by WP8's
  // fate (aiDown then books her). The Naval Range: Ship.frame's rangeFrame looks once a second whether it is wanted
  // (EARTH.navalRange), runs Practice's targets and Hostile's waves and strike aircraft (flyStriker), and its bar. Nothing
  // of this runs in a room (as the ground AI).
  const AIS = { ships: [], strikers: [], R: null, tpl: new Map(), rnd: Math.random, chkT: 0, bar: null, barKey: '', barT: 0, warp: false };
  const AIC = SHIP.AI, STR = SHIP.STRIKE, REACT = AIC.react, RANGE = SHIP.NRANGE;
  const mpLive = () => typeof MP !== 'undefined' && !!MP.active;
  const sk = (A, s) => A[0] + (A[1] - A[0]) * clamp(s, 0, 1); // (a [worst, best] pair at skill s)
  const _ap = v3(), _aq = v3(), _ar = v3();
  const LOC = { a: 0, z: 0, r: 0 };
  // (e, z) of a sim point (metres east of the pad along the track, and across it: EARTH.spawns' terms)
  function ezOf(P, o) { Terrain.locate(EARTH, P.x, P.y, P.z, LOC); o.e = -wrapAngle(LOC.a - EARTH.padAngle) * EARTH.radius; o.z = LOC.z; return o; }
  // a sim point at (e, z), h m over the sea's level
  function simAt(e, z, h, o = v3()) {
    const a = siteAngle(EARTH, e), ph = z / EARTH.radius, r = EARTH.radius + h, c = Math.cos(ph);
    o.x = r * c * Math.cos(a); o.y = r * c * Math.sin(a); o.z = r * Math.sin(ph);
    return o;
  }
  // the bearing (rad, clockwise from game north: Ship.heading's) from v to the sim point P, on her own frame
  function bearingTo(v, S, P) {
    const dx = P.x - v.x, dy = P.y - v.y, dz = P.z - v.z;
    return Math.atan2(dx * S.E.x + dy * S.E.y + dz * S.E.z, dx * S.N.x + dy * S.N.y + dz * S.N.z);
  }
  // the point d m from v along bearing b (her tangent plane), into o
  function along(v, S, b, d, o) { const c = Math.cos(b) * d, s = Math.sin(b) * d; o.x = v.x + S.N.x * c + S.E.x * s; o.y = v.y + S.N.y * c + S.E.y * s; o.z = v.z + S.N.z * c + S.E.z * s; return o; }
  const hdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  // ---- the stock ships, made ready once: rows, price and (once one has aimed) the turrets' limits, which every later one
  // copies instead of sweeping again (GroundAI's tplOf / limitsTo: an Arley Berk's sweep is a hitch at each spawn otherwise)
  function aiTpl(key) {
    let T = AIS.tpl.get(key);
    if (T || typeof TEMPLATES === 'undefined' || !hasOwn(TEMPLATES, key) || typeof templateRows !== 'function') return T || null;
    const t = TEMPLATES[key];
    AIS.tpl.set(key, (T = { key, t, kind: t.kind, name: t.name, rows: templateRows(t), cost: 0, lim: null }));
    return T;
  }
  function aiBuild(T) {
    const ps = partsFromDesign(T.rows), adjAll = buildAdjacency(ps), ctrl = findControlPart(ps);
    if (!ctrl) return null;
    const keep = componentOf(ctrl.id, adjAll), parts = ps.filter((p) => keep.has(p.id)), adj = new Map();
    for (const p of parts) { if (p.att != null && !keep.has(p.att)) p.att = null; adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id)))); }
    const v = new Vessel(parts, adj, EARTH);
    v.kind = T.kind; v.name = T.name; v.stages = computeStages(parts, adj, ctrl.id);
    v.rebuildGroups();
    if (!T.cost) T.cost = designCost(parts);
    if (v.aimed.length && typeof Aim !== 'undefined') {
      const L = T.lim, tg = v.tg || [];
      if (L && L.n === v.parts.length && L.g.length === tg.length) {
        const dep = new Map();
        for (let i = 0; i < v.parts.length; i++) if (L.deps[i]) dep.set(v.parts[i].id, L.deps[i]);
        for (let i = 0; i < tg.length; i++) { tg[i].yawLim = L.g[i].yawLim; tg[i].dep = L.g[i].dep; }
        v._dep = dep; v._limTg = v.tg; v._limN = v.parts.length;
      } else {
        const dep = Aim.limits(v);
        T.lim = { n: v.parts.length, deps: v.parts.map((p) => dep.get(p.id) || null), g: tg.map((g) => ({ yawLim: g.yawLim, dep: g.dep })) };
      }
    }
    return v;
  }
  // A computer's ship of stock template key at place { e, z, yaw } (EARTH.spawns' sea terms: the bow along (cos yaw,
  // −sin yaw) in (e, z)), afloat at her marks (launch: moved out to sea if it is too shallow there). o: { role ('fight' |
  // 'loop' | 'passive'), skill (0 worst .. 1 best), team (as the ground AI's; none: the range's), ally, loop ({ e, z, r,
  // kn, dir }), wave, slot (her place in a column), lead (the ship she follows) }. The vessel, or null (no such template,
  // no hull, in a room)
  function aiSpawn(F, key, place, o = {}) {
    if (!F || !F.vessels || mpLive() || !place) return null;
    const T = aiTpl(key);
    if (!T) return null;
    const v = aiBuild(T);
    if (!v || !v.sh || !v.sh.rings.length) return null;
    const yaw = Number.isFinite(place.yaw) ? place.yaw : 0;
    v.placeOnSurface(EARTH, siteAngle(EARTH, place.e), (VEHICLE_KINDS[v.kind] || {}).launchRot || 0, place.z || 0, yaw);
    if (!launch(v, { e: place.e, z: place.z || 0, yaw })) return null;
    const s = clamp(o.skill != null ? +o.skill : AIS.rnd(), 0, 1), now = clockOf(F);
    v.sas = 'hold'; v.throttle = 0; v.isDebris = false;
    if (v.ctl) { v.ctl.v = v.ctl.h = v.ctl.r = 0; }
    v.ai = { sea: true, key, role: o.role || 'fight', skill: s, team: o.team, ally: !!o.ally, cost: T.cost, down: false, gone: false, state: 'idle',
      thinkT: AIS.rnd() * (1 / AIC.think), lookT: AIS.rnd() / AIC.look, born: now,
      tgt: null, tAt: -9, tSeen: -9, seenAt: 0, lookN: 0, airs: null, tLast: null, air: null, shore: null, shoreAt: -9, shoreD: Infinity, gt: null, gk: null, D: 0, seeR: 0, reach: 0, seeFor: null, seeAt: -9,
      gtAt: -9, P: v3(), ea: 0, eb: 0, errAt: -9, errK: sk(AIC.err, s), corr: v3(), corrFor: null, fo: [], tof: 0, salvoN: 0, fired: 0,
      asmAt: -Infinity, asm2: null, torpAt: -Infinity, samAt: -Infinity, sams: [], decoyAt: -Infinity, hitAt: v.lastHitAt ?? null, fireAt: -Infinity, zig: AIS.rnd() < 0.5 ? -1 : 1, zigAt: now,
      torp: null, retreat: false, smokeAt: -9, avoid: null, want: null, telAt: -9, loop: o.loop || null, wp: 0, wave: o.wave || 0, slot: o.slot || 0, lead: o.lead || null, course: o.course || null };
    if (v.ai.loop) { const L = v.ai.loop; v.ai.wp = Number.isFinite(L.wp) ? L.wp : 0; }
    ciwsOn(v, true);
    F.vessels.push(v);
    AIS.ships.push(v);
    return v;
  }

  // ---- what she sees (think): ships (seenSea: her sea radars and lookouts), aircraft (airSeen), ground vehicles ashore
  // within her guns' reach that her lookouts see (S9), torpedoes running at her side and missiles homing on it
  const SEEA = [], SHR = [], _eye = { x: 0, y: 0, z: 0, h: 0 }, _ot = { x: 0, y: 0, z: 0, h: 0 };
  // (night or day where the computer's ships are: looked at once a second of the sim's clock, for all of them)
  const NIGHT = { t: -1, v: false };
  function eyesOf(v, F) { const s = Math.floor(clockOf(F)); if (s !== NIGHT.t) { NIGHT.t = s; NIGHT.v = night(v, F); } return SHIP.EYES[NIGHT.v ? 'night' : 'day']; }
  // the ships she sees to fight: her sea radars' contacts (Ship.surface) and those in her lookouts' sight (seenSea's rule,
  // with the day's eyes looked up once a second); not the old range's boats (the player's targets)
  function seaSeen(v, F, out) {
    out.length = 0;
    const L = surface(v, F), eyes = eyesOf(v, F);
    let E = null;
    for (const t of seaTargets(v, F, ST)) {
      if (t.def) continue;
      let ok = false;
      for (const c of L) if (c.ref === t && c.k === 'sea') { ok = true; break; }
      if (!ok) { if (!E) E = topOf(v, _eye); const T = topOf(t, _ot); ok = Math.hypot(T.x - E.x, T.y - E.y, T.z - E.z) < eyes && seesSea({ x: E.x, y: E.y, z: E.z }, T, E.h, T.h); }
      if (ok) out.push(t);
    }
    return out;
  }
  // the hostile aircraft she sees: her air search radars' contacts (airContacts), her sea radar's low ones (surface's
  // 'low'), and those her lookouts see (EYES, over her horizon). [{ ref, d }], nearest first
  function airSeen(v, F, out) {
    out.length = 0;
    const seen = new Set(), add = (o) => { if (!o || seen.has(o) || !o.parts || o.dead) return; seen.add(o); out.push({ ref: o, d: hdist(o, v) }); };
    for (const p of v.parts) if (p.def.searchRadar && p.def.searchRadar.air && !p.broken && !(p.hp != null && p.hp <= 0)) for (const c of airContacts(v, p, F)) if (c.ref && c.ref.parts) add(c.ref);
    for (const c of surface(v, F)) if (c.k === 'low' && c.ref && c.ref.parts) add(c.ref);
    const E = topOf(v, _eye), ex = E.x, ey = E.y, ez = E.z, eh = E.h, eyes = eyesOf(v, F);
    for (const o of F.vessels) {
      if (o === v || o.dead || o.body !== v.body || !o.parts.length || seen.has(o) || (o.sh && o.afloat) || !(isAirKind(o.kind) || flying(o)) || o.landed || o.contactTime > 0 || !foe(v, o)) continue;
      if ((o.x - ex) ** 2 + (o.y - ey) ** 2 + (o.z - ez) ** 2 > eyes * eyes) continue;
      const T = topOf(o, _ot);
      if (seesSea({ x: ex, y: ey, z: ez }, T, eh, T.h)) add(o);
    }
    out.sort((p, q) => p.d - q.d);
    return out;
  }
  // the hostile ground vehicles ashore (or in the shallows, not afloat) within R m that her lookouts see (S9)
  function shoreSeen(v, F, R, out) {
    out.length = 0;
    const E = topOf(v, _eye), ex = E.x, ey = E.y, ez = E.z, eh = E.h, eyes = Math.min(R, eyesOf(v, F));
    for (const o of F.vessels) {
      if (o === v || o.dead || o.wreck || o.ko || o.body !== v.body || !o.parts.length || !isGround(o.kind) || (o.sh && o.afloat) || !foe(v, o)) continue;
      const d = hdist(o, v);
      if (d > eyes) continue;
      const T = topOf(o, _ot);
      if (seesSea({ x: ex, y: ey, z: ez }, T, eh, T.h)) out.push({ ref: o, d });
    }
    out.sort((p, q) => p.d - q.d);
    return out;
  }
  // how far she would see target t: her sea radars' reach on it (× its radar size), else her lookouts', within the
  // horizon between her highest point and its
  function seeRange(v, t, F) {
    let R = eyesOf(v, F);
    for (const p of v.parts) if (p.def.searchRadar && p.def.searchRadar.sea && !p.broken && !(p.hp != null && p.hp <= 0)) R = Math.max(R, p.def.searchRadar.range * (t.def ? 1 : rcs(t)));
    const E = topOf(v, _eye), T = topOf(t, _ot), B = v.body.radius;
    return Math.min(R, Math.sqrt(2 * B * Math.max(0.5, E.h)) + Math.sqrt(2 * B * Math.max(0.5, T.h)));
  }

  // ---- her weapons: what each reaches, the naval guns' rounds
  // [{ sys, w, naval, key (HE), reach, aa }] for her aimed guns, the biggest first (built once a part count)
  function gunsOf(v) {
    const a = v.ai;
    if (a._gN === v.parts.length && a._g) return a._g;
    const out = [];
    for (const s of Combat.systems(v)) {
      const w = s.w;
      if (!s.def.aim || !(w.kind === 'tgun' || w.kind === 'agun')) continue;
      let reach = 3000, aa = 0;
      if (w.naval) { const SH = SHELLS[w.shells[0]], T = SH && Aim.navalTable(SH, EARTH); reach = T ? 0.8 * T.reduce((m, r) => Math.max(m, r.d), 0) : 3000; aa = w.shells.some((k) => SHELLS[k] && SHELLS[k].prox) ? 6000 : 3000; }
      else if (w.kind === 'agun') { reach = (w.cal || 0) >= 20 ? 2500 : 1500; aa = s.def.aim.el && s.def.aim.el[1] >= 60 ? reach : 0; }
      out.push({ sys: s, w, naval: !!w.naval, reach, aa, cal: w.cal || 0 });
    }
    out.sort((p, q) => q.cal - p.cal);
    a._g = out; a._gN = v.parts.length;
    return out;
  }
  // a gun of hers with rounds: ready at the gun, or (a naval gun) in her magazines to refill it (refill)
  const pool = (v) => { let n = 0; for (const q of v.parts) if (q.def.store && q.def.store.rounds > 0 && !q.broken && !q.magUp) n += Number.isFinite(q.rounds) ? q.rounds : q.def.store.rounds; return n; };
  const live = (v, g) => g.sys.parts.some((p) => !p.broken && (p.ammo > 0 || (g.naval && pool(v) > 0)));
  const has = (v, f) => v.parts.some((p) => p.def.weapon && f(p.def.weapon) && !p.broken && p.ammo > 0);
  // the round a naval gun loads next for a kind of target: HE-VT at aircraft, semi-armour-piercing at a big ship's
  // plate (one over 60 m), HE at the rest and at the shore
  function loadFor(v, gk, t) {
    for (const g of gunsOf(v)) {
      if (!g.naval) continue;
      const L = g.w.shells, of = (f) => L.find((k) => hasOwn(SHELLS, k) && f(SHELLS[k])), he = of((q) => q.he && !q.prox);
      const want = (gk === 'air' && of((q) => q.prox)) || (gk === 'sea' && t && t.sh && (t.sh.Lwl || 0) > 60 && of((q) => q.pen > 0 && !q.prox)) || he;
      if (!want) continue;
      for (const p of g.sys.parts) { const cur = p.shellSel && L.includes(p.shellSel) ? p.shellSel : L[0]; p.shellNext = cur === want ? null : want; }
    }
  }

  // ---- the helm: the heading she holds (sh.hold) and the telegraph (sh.tel), as a player's keys set them
  function order(v, hdg, tel, F) {
    const S = v.sh, a = v.ai;
    S.hold = wrapAngle(hdg); S.man = false;
    if (v.ctl) { v.ctl.h = 0; v.ctl.v = 0; }
    if (v.sas === 'manual') v.sas = 'hold';
    const t = clamp(Math.round(tel), -3, 4);
    if (t !== S.tel) { S.tel = t; a.telAt = clockOf(F); }
  }
  // the telegraph that gives her about `want` m/s: rung up or down a step at a time, no more than every 6 s, by the
  // speed she makes (a hull's speed isn't a rung's share of her top speed)
  function telFor(v, want, F) {
    const a = v.ai, S = v.sh, now = clockOf(F), V = v.speed();
    let t = S.tel > 0 ? S.tel : 2;
    if (now - a.telAt >= 6) { if (V < want - 0.5 && t < 4) t++; else if (V > want + 0.5 && t > 1) t--; }
    return t;
  }

  // ---- land and shallows (look: AI.look a second, 9 heightAt): along the heading she wants at AI.ahead × D (D: AIC.aheadMin
  // or a third of AIC.aheadT s at her speed), and on a fan either side (±fan[0]° at 2D and 3D, ±fan[1]° at 2D). Water
  // shallower than her draft + 3 m (or land) on the way ahead: she turns to the clearest fan direction (the side she
  // turned to last first), and slows; nothing clear: away from the worse side, Slow
  const LK = v3();
  function look(v, F) {
    const a = v.ai, S = v.sh, b = v.body;
    if (a.want == null || !S) return;
    const V = v.speed(), D = Math.max(AIC.aheadMin, (V * AIC.aheadT) / 3), need = (v.draft || S.draft || 3) + 3, f0 = AIC.fan[0] * DEG, f1 = AIC.fan[1] * DEG, w = a.want;
    const deep = (off, k) => { along(v, S, w + off, k * D, LK); Terrain.locate(b, LK.x, LK.y, LK.z, LOC); return -Terrain.heightAt(b, LOC.a, LOC.z) >= need; };
    const A = AIC.ahead, ok1 = deep(0, A[0]), ok2 = deep(0, A[1]), ok3 = deep(0, A[2]);
    const pR = deep(f0, 2), pR3 = deep(f0, 3), pL = deep(-f0, 2), pL3 = deep(-f0, 3), qR = deep(f1, 2), qL = deep(-f1, 2);
    if (ok1 && ok2 && ok3) { a.avoid = null; return; }
    const side = a.avoid ? Math.sign(a.avoid.off) : 0, R = [[f0, pR && pR3], [f1, qR]], L = [[-f0, pL && pL3], [-f1, qL]];
    const sides = side < 0 ? [L, R] : side > 0 ? [R, L] : (pR + pR3 + qR >= pL + pL3 + qL ? [R, L] : [L, R]);
    let off = null;
    for (const k of [0, 1]) for (const s of sides) if (off == null && s[k][1]) off = s[k][0];
    if (off == null) off = (pR + pR3 + qR >= pL + pL3 + qL ? 1 : -1) * 120 * DEG;
    a.avoid = { off, slow: !ok1 || Math.abs(off) > f1, until: clockOf(F) + 2.5 / AIC.look };
  }

  // ---- thinking (AIC.think a second)
  const TH = [];
  function think(v, F) {
    const a = v.ai, S = v.sh, now = clockOf(F);
    if (!S || v.ko || v.fate || a.down) return;
    if (a.role === 'passive') { order(v, heading(v, S), 0, F); a.want = null; return; }
    if (a.role === 'loop') { loopHelm(v, F); return; }
    sense(v, F, now);
    helm(v, F, now);
    weapons(v, F, now);
  }
  // round her loop's waypoints (16 to a lap) at its speed, the next one when within a quarter of the loop's radius
  const LOOPN = 16;
  function loopPt(L, i, o) { const t = (i / LOOPN) * TAU * (L.dir || 1); return simAt(L.e + Math.sin(t) * L.r, L.z + Math.cos(t) * L.r, 0, o); }
  function loopHelm(v, F) {
    const a = v.ai, S = v.sh, L = a.loop;
    if (!L) return;
    let W = loopPt(L, a.wp, _ap);
    if (hdist(W, v) < Math.max(60, 0.25 * L.r)) { a.wp = (a.wp + 1) % LOOPN; W = loopPt(L, a.wp, _ap); }
    let hdg = bearingTo(v, S, W);
    a.want = hdg; a.state = 'loop';
    hdg = avoidShips(v, F, hdg, 400);
    const A = a.avoid && clockOf(F) < a.avoid.until ? a.avoid : null;
    order(v, A ? hdg + A.off : hdg, A && A.slow ? 1 : telFor(v, (L.kn || 12) / SHIP.KN, F), F);
  }
  // (her picture of the sea and of the air, each looked at afresh twice a second, on alternate thinks: a look over the
  // sea's horizon costs tens of µs a contact; in between, what she saw is kept and only its range worked out again)
  function sense(v, F, now) {
    const a = v.ai, seaNow = (a.lookN = (a.lookN || 0) + 1) % 2 === 1 || !a.seenAt || now < a.seenAt;
    // ships: the one she has while she sees it (or saw it within 10 s), else the nearest she sees
    let best = null, bd = Infinity;
    if (seaNow) {
      a.seenAt = now;
      const L = seaSeen(v, F, SEEA);
      for (const t of L) { const d = hdist(t, v); if (t === a.tgt) { best = t; bd = d; break; } if (d < bd) { bd = d; best = t; } }
    } else if (a.seen && a.tgt && !a.tgt.dead && !a.tgt.fate) { best = a.tgt; bd = hdist(best, v); }
    if (best) { if (best !== a.tgt) newTarget(v, best, now); a.tgt = best; a.tSeen = now; a.D = bd; a.tLast = { x: best.x, y: best.y, z: best.z }; }
    else if (a.tgt && (now - a.tSeen > 10 || a.tgt.dead || a.tgt.fate || (a.tgt.def && !a.tgt.alive))) { const T = a.tgt; a.tgt = null; if (T.dead || T.fate) a.tLast = null; } // (lost: she hunts where she saw it last, helm's)
    a.seen = !!best;
    if (a.tgt && a.seen && (best !== a.seeFor || now - a.seeAt >= 2 || now < a.seeAt)) { a.seeFor = best; a.seeAt = now; a.seeR = seeRange(v, a.tgt, F); a.reach = reachOf(v, a); }
    // aircraft (only with one about: a foe in the air within 20 km) and the shore (once a second, with a foe's ground
    // vehicle within her guns' reach)
    let air = false, ground = false;
    const G = gunsOf(v), gr = G.reduce((m, g) => Math.max(m, live(v, g) ? g.reach : 0), 0), shoreNow = now - a.shoreAt >= 1 || now < a.shoreAt;
    for (const o of F.vessels) {
      if (o === v || o.dead || !o.parts.length || o.body !== v.body || (o.sh && o.afloat)) continue;
      const d2 = (o.x - v.x) ** 2 + (o.y - v.y) ** 2 + (o.z - v.z) ** 2;
      if (!air && d2 < 4e8 && (isAirKind(o.kind) || flying(o)) && !o.landed && foe(v, o)) air = true;
      else if (shoreNow && !ground && d2 < gr * gr && isGround(o.kind) && !o.wreck && foe(v, o)) ground = true;
      if (air && (ground || !shoreNow)) break;
    }
    if (!air) { a.airs = []; a.air = null; a.airD = Infinity; }
    else if (!seaNow || !a.airs) { a.airs = airSeen(v, F, []); a.air = a.airs.length ? a.airs[0].ref : null; a.airD = a.airs.length ? a.airs[0].d : Infinity; }
    else { a.airs = a.airs.filter((c) => !c.ref.dead && !(c.ref.ai && c.ref.ai.down)); for (const c of a.airs) c.d = hdist(c.ref, v); a.air = a.airs.length ? a.airs[0].ref : null; a.airD = a.airs.length ? a.airs[0].d : Infinity; }
    if (shoreNow) {
      a.shoreAt = now;
      const Sh = ground ? shoreSeen(v, F, gr, SHR) : ((SHR.length = 0), SHR);
      a.shore = Sh.length ? Sh[0].ref : null; a.shoreD = Sh.length ? Sh[0].d : Infinity;
    } else if (a.shore) { if (a.shore.dead || a.shore.wreck || a.shore.ko) a.shore = null; else a.shoreD = hdist(a.shore, v); }
    // threats: a torpedo in the water within 3 km closing on her (the nearest), missiles homing on her or her side
    a.torp = null; a.msl = TH; TH.length = 0;
    let td = 3000;
    for (const s of Combat.S.shots) {
      if (s.dead) continue;
      if ((s.k === 'stor' || (s.k === 'bomb' && s.torpedo)) && s.ph !== 'air' && s.owner !== v && (s.owner ? foe(v, s.owner) : true)) {
        const d = hdist(s, v), cl = (s.vx - v.vx) * (v.x - s.x) + (s.vy - v.vy) * (v.y - s.y) + (s.vz - v.vz) * (v.z - s.z);
        if (d < td && cl > 0) { td = d; a.torp = s; }
      } else if (s.k === 'missile' && shotFoe(v, s) && (s.target === v || (s.target && s.target.parts && !foe(v, s.target)) || (!s.target && s.asm))) {
        const d = hdist(s, v);
        if (d < 8000) TH.push(s);
      } else if (s.k === 'shell' || s.k === 'bullet') { // (rounds of a foe's falling round her: under fire)
        if (s.owner && s.owner !== v && foe(v, s.owner) && (s.x - v.x) ** 2 + (s.y - v.y) ** 2 + (s.z - v.z) ** 2 < 1e4 + (v.reach || 0) ** 2) a.fireAt = now;
      }
    }
    if (v.lastHitAt != null && v.lastHitAt !== a.hitAt) { a.hitAt = v.lastHitAt; if (v.lastHitBy && v.lastHitBy !== v) a.fireAt = now; }
    a.under = now - a.fireAt < 10;
    // retreat: under retreat of her reserve buoyancy (her intact hull's buoyancy over her weight) left, or of her crew
    if (!a.retreat) {
      const S = v.sh;
      if (S.vtot == null) hullVol(S);
      let W = 0;
      for (const c of S.comps) W += c.W || 0;
      const res0 = SHIP.RHO * S.vtot - v.mass, res = res0 - SHIP.RHO * W, C = typeof Armour !== 'undefined' && Armour.crewOf ? Armour.crewOf(v) : null;
      const crew = C && C.crew && C.crew.length ? C.crew.filter((e) => e.alive).length / C.crew.length : 1;
      if ((res0 > 0 && res / res0 < AIC.retreat) || crew < AIC.retreat) { a.retreat = true; a.state = 'retreat'; }
    }
  }
  // a new target: the guns range on it again (the first salvo off by a ranging error of 6 × her aim's error along the
  // line, then the fall of shot walks it in), the error rolled again
  function newTarget(v, t, now) {
    const a = v.ai, D = hdist(t.def ? Combat.targetCentre(t) : t, v), r = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r;
    let lx = t.x - v.x, ly = t.y - v.y, lz = t.z - v.z;
    const k = lx * ux + ly * uy + lz * uz; lx -= ux * k; ly -= uy * k; lz -= uz * k;
    const ll = Math.hypot(lx, ly, lz) || 1, m = 6 * a.errK * D * (AIS.rnd() < 0.5 ? -1 : 1) * (0.6 + 0.4 * AIS.rnd()), q = (AIS.rnd() - 0.5) * 2 * a.errK * D;
    a.corr.x = (lx / ll) * m + ((ly * uz - lz * uy) / ll) * q; a.corr.y = (ly / ll) * m + ((lz * ux - lx * uz) / ll) * q; a.corr.z = (lz / ll) * m + ((lx * uy - ly * ux) / ll) * q;
    a.corrFor = t; a.fo.length = 0; a.errAt = -9; a.salvoN = 0; a.tAt = now;
  }
  // her main weapon's reach on a ship (the anti-ship missiles' range at her skill while she has some; else her biggest
  // working gun's), within what she sees of it
  function reachOf(v, a) {
    let R = 0;
    if (has(v, (w) => w.asm)) R = sk(AIC.asm, a.skill);
    else for (const g of gunsOf(v)) if (live(v, g)) { R = g.reach; break; }
    if (!R && has(v, (w) => w.kind === 'torp')) R = AIC.torpR;
    return Math.min(R || 2000, a.seeR || R || 2000);
  }
  // the heading she steers off for ships ahead of her within r m (and 20 s of their closing speed more: not her column's):
  // away from one off her bow, to starboard from one dead ahead (the rule of the road: they pass port to port), harder
  // the nearer it is
  function avoidShips(v, F, hdg, r) {
    const a = v.ai;
    let off = 0;
    for (const o of F.vessels) {
      if (o === v || o.dead || o.wreck || !o.hydro || !o.parts.length || o === a.lead || (o.ai && o.ai.lead === v) || (o.sh && !o.afloat)) continue;
      const dx = o.x - v.x, dy = o.y - v.y, dz = o.z - v.z, d = Math.hypot(dx, dy, dz) || 1, cl = Math.max(0, -((o.vx - v.vx) * dx + (o.vy - v.vy) * dy + (o.vz - v.vz) * dz) / d);
      const R = r + (o.reach || 0) + (v.reach || 0) + 20 * cl;
      if (d > R) continue;
      const rel = wrapAngle(bearingTo(v, v.sh, o) - hdg);
      if (Math.abs(rel) > 80 * DEG) continue;
      off += (Math.abs(rel) < 12 * DEG ? 1 : rel > 0 ? -1 : 1) * 60 * DEG * clamp(1.4 - d / R, 0.3, 1);
    }
    return hdg + clamp(off, -90 * DEG, 90 * DEG);
  }
  function helm(v, F, now) {
    const a = v.ai, S = v.sh, psi = heading(v, S);
    let hdg = psi, tel = 3;
    const T = a.tgt;
    if (a.torp) { // (a torpedo seen running at her: comb its track, bow or stern on to it, whichever is the smaller turn, Flank)
      const s = a.torp, tb = Math.atan2(s.vx * S.E.x + s.vy * S.E.y + s.vz * S.E.z, s.vx * S.N.x + s.vy * S.N.y + s.vz * S.N.z), b0 = wrapAngle(tb + Math.PI);
      hdg = Math.abs(wrapAngle(tb - psi)) < Math.abs(wrapAngle(b0 - psi)) ? tb : b0; tel = 4; a.state = 'comb';
    } else if (a.retreat) { // (away from the fight at Flank, her smoke laid astern)
      const from = T ? (T.def ? Combat.targetCentre(T) : T) : a.tLast;
      hdg = from ? wrapAngle(bearingTo(v, S, from) + Math.PI) : psi; tel = 4; a.state = 'retreat';
      if (now - a.smokeAt >= 1 && Combat.S.smoke.length < 60) { a.smokeAt = now; smokeAstern(v); }
    } else if (T && a.seen) { // (her range: between gunK × her reach, closing at Full, opening at Full, broadside at Half)
      const P = T.def ? Combat.targetCentre(T) : T, b = bearingTo(v, S, P), d = a.D, R = a.reach;
      if (d > AIC.gunK[1] * R) { hdg = b; tel = 3; a.state = 'close'; }
      else if (d < AIC.gunK[0] * R) { hdg = b + Math.PI; tel = 3; a.state = 'open'; }
      else { const p = wrapAngle(b + 80 * DEG), q = wrapAngle(b - 80 * DEG); hdg = Math.abs(wrapAngle(p - psi)) < Math.abs(wrapAngle(q - psi)) ? p : q; tel = 2; a.state = 'engage'; }
    } else if (a.tLast && now - a.tSeen < 120 && hdist(a.tLast, v) > 400) { hdg = bearingTo(v, S, a.tLast); tel = 3; a.state = 'hunt'; } // (where she saw it last, for two minutes, until she is there)
    else if (a.lead && !a.lead.dead && !a.lead.fate && a.lead.ai && !a.lead.ai.down) { // (in column: AIC.column m astern of the one ahead)
      const L = a.lead, LS = L.sh, Fw = qrot(L.q, LS.ax.x, LS.ax.y, LS.ax.z, _aq), k = AIC.column;
      _ar.x = L.x - Fw.x * k; _ar.y = L.y - Fw.y * k; _ar.z = L.z - Fw.z * k;
      const d = hdist(_ar, v), ahead = (_ar.x - v.x) * Fw.x + (_ar.y - v.y) * Fw.y + (_ar.z - v.z) * Fw.z;
      hdg = d > 150 ? bearingTo(v, S, _ar) : heading(L, LS); tel = ahead > 100 ? 4 : ahead < -100 ? 1 : clamp(L.sh.tel, 1, 3); a.state = 'column';
    } else if (a.course) { // (the wave's course, waypoint by waypoint, then round again; at Half while her column falls behind)
      const C = a.course, W = simAt(C[a.wp % C.length].e, C[a.wp % C.length].z, 0, _ap);
      if (hdist(W, v) < Math.max(200, 2 * (v.reach || 0))) a.wp = (a.wp + 1) % C.length; // (within 200 m, or her own length: the next)
      hdg = bearingTo(v, S, simAt(C[a.wp % C.length].e, C[a.wp % C.length].z, 0, _ap)); tel = 3; a.state = 'transit';
      for (const o of AIS.ships) if (o.ai && o.ai.lead === v && !o.dead && !o.ai.down && hdist(o, v) > 1.3 * AIC.column) { tel = 2; break; }
    } else { tel = 1; a.state = 'idle'; }
    // under fire: zigzag ±zig° about the course every zigT s (not while combing a torpedo's track)
    if (a.under && a.state !== 'comb') {
      if (now - a.zigAt >= AIC.zigT) { a.zigAt = now; a.zig = -a.zig; }
      hdg += a.zig * AIC.zig * DEG;
    }
    a.want = wrapAngle(hdg);
    hdg = avoidShips(v, F, hdg, a.state === 'column' ? AIC.column / 2 : AIC.avoid);
    const A = a.avoid && now < a.avoid.until ? a.avoid : null;
    if (A) { hdg = a.want + A.off; if (A.slow) tel = Math.min(tel, a.state === 'comb' ? 4 : 1); }
    order(v, hdg, tel, F);
  }
  // a smoke screen: a cloud at her stern (Aim's smoke clouds: they hide her from eyes and seekers that look through smoke)
  function smokeAstern(v) {
    const S = v.sh, x0 = S.x0 != null && Number.isFinite(S.x0) ? S.x0 : -(v.reach || 10), at = v.toWorld(S.ax.x * x0, S.ax.y * x0 + 2, 0), r = Math.hypot(at.x, at.y, at.z) || 1, k = (v.body.radius + 3) / r;
    Combat.S.smoke.push({ b: v.body, x: at.x * k, y: at.y * k, z: at.z * k, vx: 0, vy: 0, vz: 0, fly: 0.05, t: 0, r: 0.5, life: 30, fx: 0, by: v });
  }

  // ---- what she fires (think)
  function weapons(v, F, now) {
    const a = v.ai, T = a.tgt, G = gunsOf(v);
    if (!Aim.manned(v)) { a.gt = null; v.aimFire = v.mgFire = false; return; }
    // the guns' target: an aircraft within their anti-aircraft reach first (it is the threat), else her ship within the
    // guns' reach, else a ground vehicle on the shore within it (S9)
    const aaR = G.reduce((m, g) => Math.max(m, live(v, g) ? g.aa : 0), 0), gR = G.reduce((m, g) => Math.max(m, live(v, g) ? g.reach : 0), 0);
    let gt = null, gk = null;
    if (a.air && a.airD < aaR) { gt = a.air; gk = 'air'; }
    else if (T && a.seen && a.D < gR) { gt = T; gk = 'sea'; }
    else if (a.shore && a.shoreD < gR) { gt = a.shore; gk = 'shore'; }
    if (gt !== a.gt || gk !== a.gk) {
      a.gt = gt; a.gk = gk; a.gtAt = now;
      if (gt) loadFor(v, gk, gt);
      if (gk === 'shore' && gt !== a.corrFor) { a.corr.x = a.corr.y = a.corr.z = 0; a.corrFor = gt; a.fo.length = 0; } // (the fall of shot walks her rounds onto a vehicle ashore too)
    }
    fallOfShot(v, F);
    if (gt) {
      const D = hdist(gt.def ? Combat.targetCentre(gt) : gt, v), main = G.find((g) => live(v, g) && (gk === 'air' ? g.aa >= D : g.reach >= D)) || null;
      // the time of flight (the lead): the main gun's round at this range and height
      const key = main && main.w.shells ? (main.sys.parts[0].shellSel && main.w.shells.includes(main.sys.parts[0].shellSel) ? main.sys.parts[0].shellSel : main.w.shells[0]) : null;
      const dH = Math.hypot(gt.x, gt.y, gt.z) - Math.hypot(v.x, v.y, v.z), so = key ? Aim.solve(key, Math.sqrt(Math.max(1, D * D - dH * dH)), dH, EARTH, 8) : null;
      a.tof = so ? so.t : 0;
      aimStep(v, F); // (the point for this salvo: the target and its lead as they are now)
      const ready = now >= a.born + 2 && now - a.gtAt >= 1; // (her guns laid after a moment: not on the frame she appears, nor still on the last target)
      // the naval guns: a salvo whenever they are laid and loaded; the automatic guns on the trigger (v.aimFire with their
      // system chosen), the machine guns too within 1.5 km
      let n = 0;
      if (ready) n = salvo(v, a.P, F);
      if (n > 0) { a.salvoN++; a.fired += n; track(v, F, n); a.errAt = -9; }
      const ag = G.find((g) => !g.naval && live(v, g) && (gk === 'air' ? g.aa >= D : g.reach >= D));
      if (ag) { const i = Combat.systems(v).indexOf(ag.sys); if (i >= 0) v.wsel = i; }
      const laid = !!ag && ag.sys.parts.some((p) => !p.broken && p._err != null && p._err < 1.5 * DEG);
      v.aimFire = !!ag && laid && ready;
      v.mgFire = gk !== 'air' && D < 1500 && ready;
    } else { v.aimFire = v.mgFire = false; a.tof = 0; }
    // SAMs: at aircraft within AI.missile m at her skill, and at missiles homing on her or her side within 6 km, one in
    // the air at each, one launch every 2 s
    if (has(v, (w) => w.vls) && now - a.samAt >= 2) {
      a.sams = a.sams.filter((s) => !s.dead && Combat.S.shots.includes(s));
      const busy = (t) => a.sams.some((s) => s.target === t);
      let t = null;
      for (const m of a.msl) if (!busy(m) && hdist(m, v) < 6000) { t = m; break; }
      if (!t) { const mr = sk(AIC.missile, a.skill); for (const c of a.airs || []) if (c.d < mr && !busy(c.ref) && c.ref.kind !== 'drone') { t = c.ref; break; } }
      if (t) { const s = samAt(v, t, F); if (s) { a.sams.push(s); a.samAt = now; } }
    }
    // decoys: a missile homing on her within 8 km, or a torpedo running at her (every 5 s while one is)
    if ((a.msl.some((m) => m.target === v) || a.torp) && now - a.decoyAt >= 5) { a.decoyAt = now; decoy(v, F); }
    if (!T || !a.seen || a.retreat || now - a.tAt < sk(REACT, a.skill)) return; // (her missiles and torpedoes once she has looked at it a moment)
    // anti-ship missiles: within AI.asm m at her skill, every asmEvery s; two, a few seconds apart, at the best skill
    if (a.asm2 != null && now >= a.asm2) { a.asm2 = null; asmAt(v, T, F); }
    if (a.D <= sk(AIC.asm, a.skill) && a.D > 1200 && now - a.asmAt >= AIC.asmEvery && has(v, (w) => w.asm)) {
      if (asmAt(v, T, F)) { a.asmAt = now; if (a.skill >= 0.85) a.asm2 = now + 3; }
    }
    // torpedoes: within torpR, every torpEvery s, torpN in a spread of ±torpSpread° about her intercept course
    if (a.D <= AIC.torpR && now - a.torpAt >= AIC.torpEvery && has(v, (w) => w.kind === 'torp')) {
      const b = torpCourse(v, T), n = AIC.torpN;
      let fired = 0;
      for (let i = 0; i < n; i++) if (torpAt(v, b + (n > 1 ? (-1 + (2 * i) / (n - 1)) : 0) * AIC.torpSpread * DEG, F)) fired++;
      if (fired) a.torpAt = now; else a.torpAt = now - AIC.torpEvery + 5; // (no tube faced it: again in 5 s)
    }
  }
  // the course (bearing) a torpedo at its speed meets target t on, at its velocity now
  function torpCourse(v, t) {
    const S = v.sh, P = t.def ? Combat.targetCentre(t) : t, V = t.def ? t.vel || ZV : t, spd = 22;
    const rx = P.x - v.x, ry = P.y - v.y, rz = P.z - v.z, vx = V.vx ?? V.x ?? 0, vy = V.vy ?? V.y ?? 0, vz = V.vz ?? V.z ?? 0;
    const A = vx * vx + vy * vy + vz * vz - spd * spd, B = 2 * (rx * vx + ry * vy + rz * vz), C = rx * rx + ry * ry + rz * rz, disc = B * B - 4 * A * C;
    let tt = Math.sqrt(C) / spd;
    if (Math.abs(A) > 1e-6 && disc >= 0) { const t1 = (-B - Math.sqrt(disc)) / (2 * A), t2 = (-B + Math.sqrt(disc)) / (2 * A), m = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity); if (Number.isFinite(m)) tt = m; }
    _aq.x = P.x + vx * tt; _aq.y = P.y + vy * tt; _aq.z = P.z + vz * tt;
    return bearingTo(v, S, _aq);
  }
  const ZV = Object.freeze({ x: 0, y: 0, z: 0 });
  // The fall of shot: the rounds of each salvo watched until they land (their step stops: a shell's clock no longer
  // moves), their splash against where the target is then (along the sea), and walk × that miss taken off the aim (walk
  // at the worst skill, twice it at the best); only for the ship she fires at while she sees it, or a vehicle ashore
  function track(v, F, n) {
    const a = v.ai, L = Combat.S.shots;
    for (let i = L.length - 1, k = 0; i >= 0 && k < n; i--) { const s = L[i]; if (s.k === 'shell' && s.owner === v && !s.cheap && s.t === 0) { a.fo.push({ s, t: 0, n: a.salvoN }); k++; } }
    if (a.fo.length > 24) a.fo.splice(0, a.fo.length - 24);
  }
  function fallOfShot(v, F) {
    const a = v.ai, t = a.gt;
    if (!a.fo.length) return;
    let sx = 0, sy = 0, sz = 0, n = 0;
    const B = t && t.bounds, c = t && t.com;
    for (let i = a.fo.length - 1; i >= 0; i--) {
      const f = a.fo[i];
      if (f.s.t !== f.t || f.s.t === 0) { f.t = f.s.t; if (!(f.s.t > 90)) continue; }
      a.fo.splice(i, 1);
      if (!t || !(a.gk === 'sea' ? a.seen : a.gk === 'shore') || t !== a.corrFor) continue;
      n++;
      // (one that ended on her, inside her box and 2 m more: a hit, no miss to walk off)
      if (B && c && t.q) { const q = qunrot(t.q, f.s.x - t.x, f.s.y - t.y, f.s.z - t.z, _aq), x = q.x + c.x, y = q.y + c.y, z = q.z + (c.z || 0); if (x > B.minX - 2 && x < B.maxX + 2 && y > B.minY - 2 && y < B.maxY + 2 && z > (B.minZ || 0) - 2 && z < (B.maxZ || 0) + 2) { sx += t.x; sy += t.y; sz += t.z; continue; } }
      sx += f.s.x; sy += f.s.y; sz += f.s.z;
    }
    if (!n) return;
    const P = t, r = Math.hypot(P.x, P.y, P.z) || 1, ux = P.x / r, uy = P.y / r, uz = P.z / r;
    let mx = sx / n - P.x, my = sy / n - P.y, mz = sz / n - P.z;
    const k = mx * ux + my * uy + mz * uz; mx -= ux * k; my -= uy * k; mz -= uz * k; // (along the sea)
    const g = Math.min(0.9, AIC.walk * (1 + a.skill)), C = a.corr;
    C.x -= g * mx; C.y -= g * my; C.z -= g * mz;
    const cl = Math.hypot(C.x, C.y, C.z), lim = 0.25 * (a.D || 1000);
    if (cl > lim) { C.x *= lim / cl; C.y *= lim / cl; C.z *= lim / cl; }
  }
  // Each frame: her guns' point on the target (GroundAI.aimAt: led over the round's flight, off by her error across the
  // line of sight, a fresh roll after each salvo and every 4 s), the fall of shot's correction on a ship
  function aimStep(v, F) {
    const a = v.ai, t = a.gt;
    if (!t || a.down || v.ko || v.fate || t.dead || (t.def && !t.alive)) { if (v.aimP === a.P) v.aimP = null; v.aimFire = v.mgFire = false; return; }
    const now = clockOf(F);
    if (now - a.errAt > 4) {
      a.errAt = now;
      const m = a.errK * (a.gk === 'air' ? 3 : 1) * Math.sqrt(AIS.rnd()), q = AIS.rnd() * TAU;
      a.ea = Math.cos(q) * m; a.eb = Math.sin(q) * m;
    }
    const tt = t.def ? Combat.targetCentre(t) : t, up = a.gk === 'air' ? 0 : a.gk === 'sea' && !t.def ? 1.5 : 0.5; // (a ship's side over her waterline; a vehicle's middle as the ground AI's)
    if (typeof GroundAI !== 'undefined' && GroundAI.aimAt) GroundAI.aimAt(v, t.def ? { x: tt.x, y: tt.y, z: tt.z, vx: t.vel ? t.vel.x : 0, vy: t.vel ? t.vel.y : 0, vz: t.vel ? t.vel.z : 0 } : t, a.P, a.ea, a.eb, a.tof, up);
    else { a.P.x = tt.x; a.P.y = tt.y; a.P.z = tt.z; }
    if ((a.gk === 'sea' || a.gk === 'shore') && a.corrFor === t) { a.P.x += a.corr.x; a.P.y += a.corr.y; a.P.z += a.corr.z; }
    v.aimP = a.P;
  }

  // ---- each frame (Ship.frame; and from Combat.frame while the range's bar or ships are still up with no ship afloat)
  function aiFrame(F, dt) {
    if (!F || !F.vessels) return;
    if (mpLive()) { if (AIS.R || AIS.ships.length || AIS.strikers.length) aiReset(F); bar(F); return; }
    if (AIS.R && F.active && AIS.R.me !== (F.active.carrier || F.active)) aiReset(F); // (a flight begun again, or another craft taken: the range starts afresh)
    rangeFrame(F, dt);
    if (!(dt > 0)) return;
    let gone = 0;
    for (const v of AIS.ships) {
      const a = v.ai;
      if (v.dead || !a || a.down) { gone++; continue; }
      if ((a.thinkT -= dt) <= 0) {
        a.thinkT += 1 / AIC.think; if (a.thinkT <= 0) a.thinkT = 1 / AIC.think;
        if (!F.vessels.includes(v)) { v.dead = true; gone++; continue; } // (a flight begun again: she went with the last one)
        think(v, F);
      }
      if ((a.lookT -= dt) <= 0) { a.lookT += 1 / AIC.look; if (a.lookT <= 0) a.lookT = 1 / AIC.look; look(v, F); }
      aimStep(v, F);
    }
    if (gone) AIS.ships = AIS.ships.filter((v) => !v.dead && v.ai && !v.ai.down);
    for (const v of AIS.strikers) if (!v.dead && v.ai && !v.ai.down) flyStriker(v, F, dt);
    if (AIS.strikers.length && AIS.strikers.some((v) => v.dead)) AIS.strikers = AIS.strikers.filter((v) => !v.dead);
  }
  // A computer's ship doomed (Ship.doom; her kill's banner and toast are doom's) or left with no one in charge (Combat.aiDown
  // on a hit that took her bridge: fateStep dooms her once no one has the helm for FATE.helmT s): booked once, her guns
  // stopped; on the range, our kill counted (and how far off), a Practice target back AIS.back s later at its loop's far
  // point, a Hostile wave's ship struck off it
  function aiDown(v, F) {
    const a = v && v.ai;
    if (!a || !a.sea || a.gone) return;
    if (!v.fate) return; // (not doomed yet: fate decides)
    a.gone = true; a.down = true; a.state = 'down'; v.aimP = null; v.aimFire = v.mgFire = false; a.gt = null;
    const R = AIS.R, now = clockOf(F), by = v.doomBy || v.lastHitBy, me = !!F && typeof Combat !== 'undefined' && Combat.byMe && Combat.byMe(by, F) && !a.ally;
    if (!R || !R.mine.has(v)) return;
    if (me) { R.kos++; const A = F.active; if (A) R.best = Math.max(R.best, hdist(A, v)); }
    if (R.mode === 'practice') R.dead.push({ key: a.key, role: a.role, loop: a.loop, at: now + RANGE.back });
    else if (R.left.includes(v)) {
      R.left = R.left.filter((o) => o !== v);
      if (!R.left.length) { R.waveAt = now + RANGE.gap; say(F, `Wave ${R.wave} sunk: the next in ${RANGE.gap} s`, 'info'); }
    }
  }
  const say = (F, t, k) => { if (F && F.toast) F.toast(t, k); };

  // ---- the Naval Range (§9.2)
  const NR = () => EARTH.navalRange;
  const targetsMode = () => (mpLive() ? 'off' : (typeof Settings !== 'undefined' && Settings.get('targets')) || 'practice');
  const mapReady = () => typeof Terrain !== 'undefined' && !!Terrain.earthMap && Terrain.earthMap.state === 'ready' && !!EARTH.mapped;
  const NZ = { e: 0, z: 0 };
  // wanted: the player's craft a sea kind, or any craft afloat, on Earth with the map in, within r + RANGE.far m of the
  // range's middle; targets on; no room, no battle; in the game's own flight (a test's stand-in for it only when it says
  // so: F.navalRange, so no other suite meets the range's ships). Its mode, or null
  function rangeWanted(F) {
    const N = NR(), me = F && F.active && (F.active.carrier || F.active), m = targetsMode();
    if (!F || !(F.navalRange || (typeof Flight !== 'undefined' && F === Flight))) return null;
    if (!N || !me || m === 'off' || mpLive() || Ship.battle || (typeof GroundAI !== 'undefined' && GroundAI.battle) || me.body !== EARTH || !mapReady()) return null;
    if (!isSea(me.kind) && !(me.hydro && me.afloat)) return null;
    ezOf(me, NZ);
    return Math.hypot(NZ.e - N.e, NZ.z - N.z) < N.r + RANGE.far ? m : null;
  }
  function rangeFrame(F, dt) {
    if ((AIS.chkT -= dt) <= 0) {
      AIS.chkT = 1;
      const want = rangeWanted(F), R = AIS.R, me = F.active && (F.active.carrier || F.active);
      if (R && (want !== R.mode || R.me !== me)) aiReset(F);
      if (!AIS.R && want) rangeStart(F, want);
    }
    const R = AIS.R;
    if (R && dt > 0) {
      const now = clockOf(F);
      for (let i = R.dead.length; i--;) {
        const d = R.dead[i];
        if (now < d.at) continue;
        R.dead.splice(i, 1);
        if (d.role === 'loop' && d.loop) { const L = d.loop, k = farPt(F, L); const v = aiSpawn(F, d.key, { e: L.e + Math.sin(k.t) * L.r, z: L.z + Math.cos(k.t) * L.r, yaw: k.yaw }, { role: 'loop', loop: { ...L, wp: (k.i + 1) % LOOPN } }); if (v) R.mine.add(v); }
        else if (d.role === 'passive') hulk(F, R);
      }
      if (R.mode === 'hostile' && !F.destroyed) {
        if (!R.left.length && now >= R.waveAt) nextWave(F, R);
        R.strikers = R.strikers.filter((o) => !o.dead && o.ai && !o.ai.down && o.control);
        if (R.wave >= 2 && now >= R.strikeAt) {
          R.strikeAt = now + STR.every;
          if (R.strikers.length < STR.max) { const s = spawnStriker(F); if (s) { R.strikers.push(s); say(F, 'Strike aircraft inbound!', 'warn'); } }
        }
      }
    }
    if ((AIS.barT -= dt) <= 0) { AIS.barT = 0.25; bar(F); }
  }
  // the point of loop L farthest from the player's craft: { t (its angle), i (its waypoint), yaw (the course along the loop there) }
  function farPt(F, L) {
    const me = F.active, P = me ? ezOf(me, { e: 0, z: 0 }) : { e: L.e, z: L.z };
    let bi = 0, bd = -1;
    for (let i = 0; i < LOOPN; i++) { const t = (i / LOOPN) * TAU * (L.dir || 1), d = Math.hypot(L.e + Math.sin(t) * L.r - P.e, L.z + Math.cos(t) * L.r - P.z); if (d > bd) { bd = d; bi = i; } }
    const t = (bi / LOOPN) * TAU * (L.dir || 1), n = ((bi + 1) / LOOPN) * TAU * (L.dir || 1), de = Math.sin(n) - Math.sin(t), dz = Math.cos(n) - Math.cos(t);
    return { t, i: bi, yaw: Math.atan2(-dz, de) };
  }
  function hulk(F, R) {
    const N = NR(), H = N.hulk, v = H && aiSpawn(F, H.key, { e: H.e, z: H.z, yaw: H.yaw }, { role: 'passive', skill: 0 });
    if (v) { R.mine.add(v); v.name = `${v.name} (hulk)`; }
    return v;
  }
  // The Naval Range on: Practice, the hulk and the three loops' ships; Hostile, the first wave in RANGE.first s
  function rangeStart(F, mode) {
    if (mpLive() || !F || !F.vessels) return false;
    const N = NR(), now = clockOf(F);
    AIS.rnd = typeof mulberry32 === 'function' ? mulberry32(5150 + ((now * 10) | 0)) : Math.random;
    const R = (AIS.R = { mode, me: F.active.carrier || F.active, kos: 0, best: 0, wave: 0, waveAt: now + RANGE.first, strikeAt: Infinity, left: [], dead: [], strikers: [], mine: new Set() });
    if (mode === 'practice') {
      hulk(F, R);
      for (const L of N.loops) {
        const k = farPt(F, L), v = aiSpawn(F, L.key, { e: L.e + Math.sin(k.t) * L.r, z: L.z + Math.cos(k.t) * L.r, yaw: k.yaw }, { role: 'loop', loop: { ...L, wp: (k.i + 1) % LOOPN } });
        if (v) R.mine.add(v);
      }
      say(F, 'Naval Range: a hulk 2 km ahead and three ships under way · they never shoot back', 'info');
    } else say(F, `Hostile naval range: the first ships come from the east in ${RANGE.first} s`, 'warn');
    AIS.barKey = ''; bar(F);
    return true;
  }
  // A Hostile wave from the east: wave n's ships (RANGE.waves; from the fifth, the Arley Berk and the Olivar Perri and one
  // more each wave to four), skill 0.1 + 0.1 n (to 0.9), line abreast at N.hostile (or 10 km east of the player, if she is
  // further west than that: they never take a quarter of an hour to come), heading west, the first leading and the rest
  // in column astern of the one before; their course to where the player was when they set out (the range's call), then
  // round the range
  function nextWave(F, R) {
    const N = NR(), H = N.hostile, n = ++R.wave, W = RANGE.waves, base = W[Math.min(n, W.length) - 1], cnt = n < 5 ? base.length : Math.min(4, 2 + (n - 5));
    const me = F.active && (F.active.carrier || F.active), P = me ? ezOf(me, { e: N.e, z: 0 }) : { e: N.e, z: 0 }, e0 = clamp(P.e + 10000, N.e, H.e);
    const keys = base.slice(0, cnt), s = Math.min(0.9, 0.1 + 0.1 * n), course = [{ e: P.e, z: P.z }, { e: N.e, z: 0 }, { e: N.e - 4000, z: 2500 }, { e: N.e + 4000, z: -2500 }];
    R.left = [];
    let lead = null;
    keys.forEach((key, i) => {
      const z = H.z + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * H.gap;
      const v = aiSpawn(F, key, { e: e0, z, yaw: H.yaw }, { role: 'fight', skill: s, wave: n, slot: i, lead, course });
      if (v) { R.left.push(v); R.mine.add(v); lead = v; }
    });
    if (R.wave === 2 && !Number.isFinite(R.strikeAt)) R.strikeAt = clockOf(F) + 40;
    say(F, `Wave ${n}: ${R.left.length} ship${R.left.length === 1 ? '' : 's'} from the east`, 'warn');
  }
  // everything the range put out, gone (its ships, wrecks and all, and its strike aircraft); the bar hidden
  function aiReset(F) {
    const R = AIS.R;
    for (const v of AIS.ships) if (!R || R.mine.has(v)) v.dead = true;
    if (R) { for (const v of R.mine) if (!(F && v === F.active)) v.dead = true; for (const v of R.strikers) v.dead = true; }
    for (const v of AIS.strikers) v.dead = true;
    AIS.ships = AIS.ships.filter((v) => !v.dead); AIS.strikers = []; AIS.R = null; AIS.chkT = 0;
    bar(F || {});
  }

  // ---- strike aircraft (from wave 2: one every STRIKE.every s, STRIKE.max at once): the stock Striker, flown in from the
  // east at STRIKE.alt m, down to STRIKE.low m for the last STRIKE.lowR m, its bombs let go where they will fall on the
  // ship (about STRIKE.rel m out at its speed), away and round again; out of bombs, a strafing run with its cannon and
  // rockets. A bandit to everyone else (Combat.isFighter: shot at, locked, marked as one), flown here (ai.strike)
  function spawnStriker(F) {
    const T = aiTpl('striker'), me = F.active;
    if (!T || !me) return null;
    const ps = partsFromDesign(T.rows), adjAll = buildAdjacency(ps), ctrl = findControlPart(ps);
    if (!ctrl) return null;
    const keep = componentOf(ctrl.id, adjAll), parts = ps.filter((p) => keep.has(p.id)), adj = new Map();
    for (const p of parts) { if (p.att != null && !keep.has(p.att)) p.att = null; adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id)))); }
    const v = new Vessel(parts, adj, EARTH);
    v.kind = 'plane'; v.name = 'Strike aircraft'; v.sas = 'off'; v.throttle = 0.95; v.gearUp = true;
    v.stages = computeStages(parts, adj, ctrl.id);
    for (const p of v.parts) { if (p.def.thrust) p.active = true; if (p.def.wheel && p.def.wheel.retract) p.retracted = true; }
    v.rebuildGroups();
    // 11-13 km east of the player (the waves' way), STRIKE.alt m up, flying at them
    const P = ezOf(me, { e: 0, z: 0 }), d = 11000 + 2000 * AIS.rnd(), ang = (AIS.rnd() - 0.5) * 0.8, e = P.e + Math.cos(ang) * d, z = P.z + Math.sin(ang) * d;
    simAt(e, z, STR.alt, v);
    const U = norm3(v3(v.x, v.y, v.z));
    const tgt = simAt(P.e, P.z, STR.alt, v3()), f = v3(tgt.x - v.x, tgt.y - v.y, tgt.z - v.z), k = dot3(f, U); f.x -= U.x * k; f.y -= U.y * k; f.z -= U.z * k; norm3(f);
    const nx = v3(-U.x, -U.y, -U.z);
    v.q = qbasis(nx, f, cross3(nx, f));
    v.av = v3();
    v.vx = f.x * 200; v.vy = f.y * 200; v.vz = f.z * 200;
    v.ai = { t: 0, down: false, strike: true, ph: 'in', relAt: -9, runs: 0 };
    F.vessels.push(v);
    AIS.strikers.push(v);
    return v;
  }
  // Its pilot (flyFighter's stick: the lift rolled onto where it wants to go, then a pull), each frame
  const _sw = v3(), _su = v3(), _sf = v3(), _sb = v3(), _sr = v3();
  function flyStriker(v, F, dt) {
    const ai = v.ai;
    if (!ai || ai.down) { v.aiFire = false; return; }
    if (!v.control) { v.aiFire = false; if (typeof Combat !== 'undefined') Combat.aiDown(v, F); return; }
    ai.t += dt;
    const now = clockOf(F), r = Math.hypot(v.x, v.y, v.z) || 1, U = _su, fwd = v.axis(0, 1, 0, _sf), bodyUp = v.axis(-1, 0, 0, _sb), right = v.axis(0, 0, 1, _sr);
    U.x = v.x / r; U.y = v.y / r; U.z = v.z / r;
    const alt = r - v.body.radius, vs = v.vx * U.x + v.vy * U.y + v.vz * U.z, hx = v.vx - U.x * vs, hy = v.vy - U.y * vs, hz = v.vz - U.z * vs, Vh = Math.hypot(hx, hy, hz) || 1;
    // its target: the player's ship (or the nearest hostile ship afloat); none: home east
    let T = F.active && !F.destroyed && F.active.sh && F.active.afloat && foe(v, F.active) ? F.active : null;
    if (!T) { let bd = 20000; for (const o of F.vessels) if (o.sh && o.afloat && !o.dead && !o.fate && foe(v, o)) { const d = hdist(o, v); if (d < bd) { bd = d; T = o; } } }
    let want = _sw, altWant = STR.alt;
    if (!T) { const P = ezOf(v, { e: 0, z: 0 }), H = simAt(P.e + 5000, P.z, STR.alt, _ap); want.x = H.x - v.x; want.y = H.y - v.y; want.z = H.z - v.z; ai.ph = 'out'; }
    else {
      const tx = T.x - v.x, ty = T.y - v.y, tz = T.z - v.z, up0 = tx * U.x + ty * U.y + tz * U.z, gx = tx - U.x * up0, gy = ty - U.y * up0, gz = tz - U.z * up0, gd = Math.hypot(gx, gy, gz) || 1;
      const bombs = v.parts.filter((p) => p.def.weapon && p.def.weapon.kind === 'bomb' && p.ammo > 0 && !p.broken);
      if (ai.ph === 'out') { // (away, climbing, then round again from 4 km)
        altWant = STR.alt; want.x = -gx; want.y = -gy; want.z = -gz;
        if (gd > 4000 && now - ai.relAt > 6) { ai.ph = 'in'; ai.runs++; }
      } else {
        // the bombs' fall from here (its sink and the rack's 2 m/s push in it; no drag: a short drop) and where they would
        // land, against where the ship will be then
        const h = Math.max(1, alt - (T.sh && T.sh.level > -Infinity ? T.sh.level : 0)), vd = Math.max(0, 2 - vs), tf = (Math.sqrt(vd * vd + 2 * 9.81 * h) - vd) / 9.81, TVx = T.vx * tf, TVy = T.vy * tf, TVz = T.vz * tf;
        const px = gx + TVx - hx * tf, py = gy + TVy - hy * tf, pz = gz + TVz - hz * tf; // (the target then, from where the bombs would land)
        const sAlong = (px * hx + py * hy + pz * hz) / Vh, sLat = Math.hypot(px - (hx / Vh) * sAlong, py - (hy / Vh) * sAlong, pz - (hz / Vh) * sAlong);
        altWant = gd > STR.lowR ? STR.alt : STR.low;
        want.x = gx + TVx; want.y = gy + TVy; want.z = gz + TVz; // (at where the ship will be)
        if (bombs.length) {
          if (gd < STR.lowR * 1.2 && sAlong <= 15 && sAlong > -80 && sLat < 60 && alt < STR.low * 2.5) { // (they fall on her: both let go)
            for (const p of bombs) dropBombs(v, p, F);
            ai.relAt = now; ai.ph = 'out'; ai.relD = gd;
          } else if (sAlong < -80 && gd < STR.lowR) { ai.ph = 'out'; ai.relAt = now; } // (overshot: round again)
        } else { // (strafing: the cannon on her within 1.2 km, the rockets within 1.8 km, nose on; pull off at 500 m)
          altWant = gd > STR.lowR ? STR.alt : 120;
          const aim = norm3(v3(tx + T.vx * (gd / 1000), ty + T.vy * (gd / 1000), tz + T.vz * (gd / 1000))), on = dot3(aim, fwd) > Math.cos(2.5 * DEG);
          if (gd < STR.lowR) { want.x = aim.x * gd; want.y = aim.y * gd; want.z = aim.z * gd; altWant = null; }
          v.aiFire = on && gd < 1200;
          if (on && gd < 1800 && now - (ai.rkAt ?? -9) > 0.2) { const sys = Combat.systems(v).find((s) => s.w.kind === 'rocket'); const p = sys && Combat.nextStore(sys); if (p) { Combat.fireRocket(v, p, true, F); ai.rkAt = now; } }
          if (gd < 500) { ai.ph = 'out'; ai.relAt = now; v.aiFire = false; }
        }
      }
    }
    // level its way (a way more than 70° off its own: a level turn toward it, 80° ahead of where it flies now, so it
    // banks round rather than looping), then climb or dive for the height it wants (at most 12°), and never under 25 m
    const wl = Math.hypot(want.x, want.y, want.z) || 1;
    if (altWant != null) {
      const k0 = want.x * U.x + want.y * U.y + want.z * U.z;
      want.x = (want.x - U.x * k0) / wl; want.y = (want.y - U.y * k0) / wl; want.z = (want.z - U.z * k0) / wl; norm3(want);
      const ux = hx / Vh, uy = hy / Vh, uz = hz / Vh, c0 = want.x * ux + want.y * uy + want.z * uz;
      if (c0 < 0.34) {
        const sd = (uy * want.z - uz * want.y) * U.x + (uz * want.x - ux * want.z) * U.y + (ux * want.y - uy * want.x) * U.z >= 0 ? 1 : -1, ca = Math.cos(80 * DEG), sa = Math.sin(80 * DEG) * sd;
        const px = U.y * uz - U.z * uy, py = U.z * ux - U.x * uz, pz = U.x * uy - U.y * ux; // (U × its way: 90° to its left)
        want.x = ux * ca + px * sa; want.y = uy * ca + py * sa; want.z = uz * ca + pz * sa;
      }
      const gam = clamp((altWant - alt) * 0.006 - vs * 0.02, -0.21, 0.21), c = Math.cos(gam), s = Math.sin(gam);
      want.x = want.x * c + U.x * s; want.y = want.y * c + U.y * s; want.z = want.z * c + U.z * s;
    } else { want.x /= wl; want.y /= wl; want.z /= wl; }
    if (alt < 25 || (alt < 90 && vs < -alt / 3)) { const k = clamp((60 - alt) / 40, 0.3, 1); want.x = fwd.x + U.x * k * 2; want.y = fwd.y + U.y * k * 2; want.z = fwd.z + U.z * k * 2; norm3(want); v.aiFire = false; }
    if (ai.ph === 'out' || !T) v.aiFire = false;
    // the stick (flyFighter's law, finer on its run: a bank for 1° off, the rudder for the rest)
    const wu = dot3(want, bodyUp), wr = dot3(want, right), wf = dot3(want, fwd), off = Math.acos(clamp(wf, -1, 1));
    const bankErr = off > 0.018 ? Math.atan2(wr, Math.max(wu, -0.3)) : Math.asin(clamp(dot3(right, U), -1, 1)) * 0.5;
    v.ctl.h = clamp(bankErr * 2.2 - dot3(v.av, fwd) * 0.6, -1, 1);
    const pullK = Math.abs(bankErr) < 0.9 ? 1 : 0.3, strainEase = v.strain > 0.75 ? 0.4 : 1;
    v.ctl.v = clamp(-Math.atan2(wu, Math.max(wf, 0.05)) * 3 * pullK * strainEase, -1, 0.35);
    const gMax = 0.8 * (v.gRating() || 8), nz = v.nz || 0;
    ai.pullMax = clamp((ai.pullMax ?? 1) + (nz > gMax ? -1.5 : 0.3) * Math.abs(gMax - nz) * dt, 0.1, 1);
    v.ctl.v = Math.max(v.ctl.v, -ai.pullMax);
    v.ctl.r = clamp(-wr * 3, -0.5, 0.5);
    const V = v.speed();
    v.throttle = v.overspeed > 0.85 ? (v.overspeed > 0.95 ? 0 : 0.5) : clamp(0.6 + (STR.v - V) * 0.02, 0.15, 1); // (its run at STRIKE.v m/s)
    // flares or chaff against a missile on its tail
    if ((ai.flareT = (ai.flareT || 0) - dt) <= 0 && typeof Combat !== 'undefined') for (const m of Combat.S.shots) if (m.k === 'missile' && m.target === v && hdist(m, v) < 1800) { if (Combat.countermeasures(v, F)) ai.flareT = 0.7; break; }
  }
  // a pair of bombs off one rack (its two sides) or one
  function dropBombs(v, p, F) {
    for (let i = 0; i < 2 && p.ammo > 0; i++) if (typeof Combat !== 'undefined' && Combat.dropBomb) Combat.dropBomb(v, p, F);
  }

  // ---- the bar (GroundAI's style: the time warp's place at the top): "Naval Range: 2 sunk · best shot 6.2 km" over
  // "Hostile · wave 3 · 2 ships left"
  function bar(F) {
    if (typeof document === 'undefined' || typeof el !== 'function') return;
    const R = AIS.R;
    if (!R) { if (AIS.bar && !AIS.bar.root.hidden) { AIS.bar.root.hidden = true; AIS.barKey = ''; warp(false); } return; }
    if (!AIS.bar) {
      const root = el('div', { id: 'naval-bar', class: 'gai-bar panel', 'aria-live': 'polite' }), main = el('div', { class: 'gai-main' }), sub = el('div', { class: 'gai-sub' });
      root.append(main, sub);
      ($('#flight-ui') || document.body).append(root);
      AIS.bar = { root, main, sub };
    }
    const E = AIS.bar, now = clockOf(F), N = R.left.length;
    const main = `Naval Range: ${R.kos} sunk|${R.best ? `best shot ${fmt.dist(R.best)}` : ''}`;
    let sub;
    if (R.mode === 'hostile') sub = 'Hostile · ' + (N ? `wave ${R.wave} · ${N} ship${N === 1 ? '' : 's'} left` : `${R.wave ? 'next' : 'first'} wave in ${Math.max(0, Math.ceil(R.waveAt - now))} s`) + (R.strikers.length ? ' · aircraft inbound' : '');
    else sub = 'Practice · they don’t shoot back';
    const key = `${main}|${sub}`;
    if (E.root.hidden) E.root.hidden = false;
    warp(true);
    if (key === AIS.barKey) return;
    AIS.barKey = key;
    const [a, b] = main.split('|');
    E.main.textContent = '';
    E.main.append(el('span', { text: a }));
    if (b) E.main.append(el('span', { class: 'gai-best' }, el('i', { text: ' · ' }), b));
    E.sub.textContent = '';
    sub.split(' · ').forEach((q, i) => { if (i) E.sub.append(' · '); E.sub.append(el('span', { text: q })); });
  }
  // the bar takes the time warp's place (as the Tank Range's does)
  function warp(hide) {
    const w = typeof document !== 'undefined' && typeof $ === 'function' && $('#warp');
    if (!w) return;
    if (hide) {
      if (!w.hidden) { w.hidden = true; AIS.warp = true; }
      if (typeof Flight !== 'undefined' && Flight.warpIdx && Flight.setWarp) Flight.setWarp(0);
    } else if (AIS.warp) { AIS.warp = false; if (!(typeof Flight !== 'undefined' && Flight.mp)) w.hidden = false; }
  }
  function practice(opts) { return false; } // the Naval Practice battle (§9.3): a later package's, after the multiplayer package's sea arena

  // ==== mp ====
  // [WP11]
  function snap(v) { return null; } // a ship's snapshot field (sh: [tel, rudder°])
  function unsnap(g, m) {}
  function ghost(g) {} // a remote ship ghost: its decks into Ship.D
  function downSea(v) { return null; } // a ship's down message's sea field
  function onDownSea(m) {}
  function cleanHoles(rows, v) { return []; } // a peer's hit.ho rows, cleaned (our own hull parts, finite, capped)

  return {
    D: DECKS, // every landable moving deck: { v, p, hl, hw, top, x, y, z, ex, ey } [WP6]
    S,
    // core
    groups, pre, forces, addedMass, floorAt, floorNormal, overWater, launch, seaPlace, drift, stab, impactSea, bump,
    insideHull, deckContacts, deckRel, deckVel, deckTop, lashStep, unlash, // [WP6]
    setTel, telStep, settle, moor, unmoor, heading,
    // waves
    wave, seaT, setSea, sea, fadeAt, waveUniforms,
    // builder
    stats, hydrostatics, spotOf, warnings, kitWarnings, specs, line, xray,
    // damage
    hullRay, hullMm, hullDist, addHoles, floodStep, fireStep, dcStep, fateStep, doom, magazine,
    holedThrough, wetAt, floodForce, blastHull, roundHit, roundHole, ignite, levelOf, seed, hullPlate, rack, busy, // [WP8]
    // combat
    fireTorp, torpStep, torpHit, ciwsStep, ciwsRound, seaTop, shotMissiles, surface, seesSea, rcs,
    asmStep, asmLured, asmHit, asmTarget, armShot, vlsStep, samKill, torpPick, decoy, refill, foe, column, airContacts, airFoes, trackContacts, holds, contactOn, night, // [WP9]
    salvo, torpAt, asmAt, samAt, ciwsOn, resetCombat, // [WP9] (the AI's calls: WP10)
    // frame
    frame, fx,
    // hud
    hud, help, keys,
    // ai
    aiDown, flyStriker, range: rangeFrame, practice, battle: null,
    aiSpawn, aiFrame, aiReset, rangeStart, spawnStriker, // [WP10] (a computer's ship; the AI's frame, from Combat.frame with no ship afloat; the range)
    aiSeed(n) { AIS.rnd = typeof mulberry32 === 'function' ? mulberry32(n) : Math.random; }, // (the AI's dice: the tests')
    get aiOn() { return !!(AIS.R || AIS.ships.length || AIS.strikers.length || (AIS.bar && !AIS.bar.root.hidden)); }, // (anything of the AI's still out, or its bar up)
    get naval() { return AIS.R; }, get aiShips() { return AIS.ships; }, get strikers() { return AIS.strikers; }, // (the Naval Range's state, the computer's ships, the strike aircraft)
    _ai: { seaSeen: (v, F) => seaSeen(v, F, []), airSeen: (v, F) => airSeen(v, F, []), shoreSeen: (v, F, R) => shoreSeen(v, F, R, []), think, look, sense: (v, F) => sense(v, F, clockOf(F)), weapons: (v, F) => weapons(v, F, clockOf(F)), gunsOf, reachOf, seeRange, torpCourse, simAt, ezOf, bearingTo }, // (the tests')
    // mp
    snap, unsnap, ghost, downSea, onDownSea, cleanHoles,
  };
})();
