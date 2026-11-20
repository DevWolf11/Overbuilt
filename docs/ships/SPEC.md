# Overbuilt: the ships update, design spec (rebuilt)

**Base:** the update's branch `ccr-932b9082-m4kox7` at 126215f. Phase 0 (WP0, the contract) and Phase 1 (WP1 hydro core,
WP2 drawn sea, WP3 helm/HUD/launch, WP4 builder basics) are **built and merged**, as are career's removal (§21) and the
sea-crash fix (death.js `SEA`, `seaPose`, `swamp`; vessel.js `waterSlam`). This document is the spec for the **remaining**
work (Phases 2-5), rebuilt after the original (written against `main` at 71c3af7) was lost with a replaced container.

**How it was rebuilt.** §0-§3 and §14-§21 are the recovered text (`SPEC-recovered.md`), corrected where the merged code
differs (the code wins; each difference is noted in a *Built:* or *Correction:* line). §4 and §5 describe what is built
(read from js/ship.js and render3d.js) and then specify what remains. §6-§13 are re-derived from the decisions, the
`SHIP` table (WP0 put every number of the original spec in it, so js/ship.js:49-150 is the surviving record of §4-§9's
numbers), the reports and the code. **§7 did not survive** (`SPEC-recovered.md` has only its heading; the task's note
that it was recovered is mistaken): it is re-derived here from the reports' summary (nine templates, the destroyer at
about $120k) and the real ships the names point to, with the hull tables of §6.1 checked by running the sampler.

**Where code disagrees with this spec, the code wins:** check before you cut, adapt, and say so in your report. Line
numbers are given as `file:function` (stable) and, where useful, `file:line` at 126215f (they drift).

Reading order for an implementer: §0 (what was decided), §2 (kind and gates), the chapter for your work package, §13
(every hook), §16 (your package: files, interfaces, done-criteria), `BRIEF-common.md`.

---

## 0. The decisions, in one table

| Topic | Decision |
|---|---|
| Kind | `ship` (id), name **Ship**, `site: 'bay'`, `launchRot: 0`, frame as car/tank: **+x bow, +y up, +z starboard**. `SEA_KINDS = new Set(['ship'])`, `isSea(kind)`. Not in `GROUND_KINDS`, not in `AIR_KINDS`. *Built* (parts.js:56, :67). |
| File | `js/ship.js` after `drone.js`, before `builder.js`: `SHIP` (every tuning number) and `Ship` (the module), in sections: **core** (hydro physics, helm, grounding, mooring), **waves**, **builder** (hydrostatics, placement, warnings), **damage** (holes, flooding, damage control, fires, fate), **combat** (torpedoes, CIWS, anti-ship missiles, surface contacts), **hud**, **ai**, **mp**. *Built* (skeleton, core, waves, builder basics, hud's helm panel; the rest stubs). |
| Marker fields | Every new part: `def.ship: true` **and** `def.gv: true` (turrets, Aim, armour, crew, modules, repairs, X-ray and the zero-call proof come for free). Floating comes from `def.hull` (hull segments, pontoons, one-piece hulls) only (not `v.hull`, the vessel's contact points). *Built.* |
| Floating flag | `v.hydro` (rebuildGroups): any part with `def.hull`, or a piece split off a hydro vessel (`v.hydroFrom`). Without it the sea is the old solid floor and nothing in ship.js runs. `v.sh` is built only when ship.js is loaded (`typeof Ship` guard): every hook tests `this.sh`, so `G.load({ ship: false })` is old play exactly. *Built* (vessel.js:382-383). *Correction:* `hydroFrom` is set only when the parent floated (old pieces gain no property), on the remaining main vessel too. |
| Hull shape | `def.shull`: stations along part x (deck, keel, half-breadths, bilge exponent), sampled once by `shullOf(def)` (parts.js) into rings that are the 2D path, the 3D loft, the clash loft, the hit slices and the buoyancy sections. 2D = 3D = what floats = what is hit. *Built* except the hit slices (WP8: `Ship.hullRay`). |
| Physics | Ring-by-ring buoyancy (exact polygon clip against a wave-sloped water plane), ITTC-57 friction + wave-making table, lateral hull lift and cross-flow, strip planing lift, heave damping, roll damping (Froude-growing), foils (rudders, skegs, fixed hydrofoils) in their own routine at water density, screws from shaft power, added mass by acceleration scaling. Semi-implicit Euler at the existing 1/120 s step, every damping term clamped. Grounding: the probe meets the sea **bed** for hydro vessels (one copy of the crash/rest rules). *Built* (§4). Remaining: ride control, outboards, waterjets, turbines' spool use, flood water's weight, bumps, decks and lashing, tiny pieces (§4.4-§4.8, §4.12). |
| Waves | One deterministic function `Ship.wave(e, n, t, out)`: 4 directional sines (`SHIP.WAVES`), deep-water dispersion, sea state Calm / **Moderate** (default, Hs ≈ 1 m) / Rough, faded in shallow water (`SHIP.FADE` 3-25 m), zero on lakes. Same constants feed the GPU (`Ship.waveUniforms`). *Built*: Hs 0.31 / 1.03 / 2.58 m; GPU within 0.001 mm. |
| Sea drawing | A displaced swell patch round the camera (High 128² cells at 4 m, Low 64² at 6 m), only while a hydro vessel is within `SWELL.near` 2 km of the camera and the camera under 1.5 km; the ocean cut under it by `uSeaHole`. Off: pictures and cost exactly as before. Wakes as ribbons (one mesh, one draw), bow spray and funnel smoke as `FX` particles (`Ship.fx`). *Built.* |
| Units | Ship displays (HUD, builder, tray, end screen) speak **knots** (`SHIP.KN`); everything else stays km/h. *Built* for HUD and builder; tray cards are WP7's. |
| Death | Flooding (foundering), capsize (> 60° for 4 s), magazine (she breaks in two), or out of action (no one at the helm, or no bridge). A doomed ship sinks by physics, then is removed `FATE.gone` 40 m down, or stays a wreck on a bed shallower than `FATE.wreckDepth` 40 m (five minutes, as every wreck). Pieces sink. `SHIP_FATES` words are *built* (flight.js:14); the rest is WP8. |
| Combat | Naval guns 76/127/152 mm (and every ground gun works on a ship), CIWS that shoots missiles (and aircraft, drones), torpedoes that swim and hit real hulls below the waterline, sea-skimming anti-ship missiles, vertical-launch SAMs that also engage anti-ship missiles (S3), decoys. Belt armour as an opt-in hull field. Ships are surface contacts, never air contacts. Every kind can fight every kind (§20). |
| AI and play | Real-physics AI ships with a helm autopilot; the **Naval Range** east of the Faroes (Practice / Hostile, strike aircraft); a **Naval Practice** battle; a multiplayer **Naval Battle** (`settings.game: 'naval'`, GroundMode reused with sea zones, the **Shetland Sound** arena). |
| Helicopters on ships | Yes: helipad parts are moving decks (contact + lashing). Landing craft carrying a tank: **no** in this update (troops only; §19). Crane/davit: no. Depth charges: no (no submarines; said in README). |
| Net | `NET_VERSION` 13 → 14 (WP11). |
| Old designs | Byte-identical: every hook is gated on `v.hydro`/`v.sh`, `def.ship`/`def.shull`/`def.hull`, kind `ship`, `Combat.S.sea`, `Combat.S.pd`, `Ship.D.length`, `ai.sea`, `MP.naval`, or a message's new field. `Ship` is in ground.test.js's SYSTEMS. *Built* for Phases 0-1. |
| Career | **Removed** on this branch (§21). Nothing in the update adds career content: WP10's "career.js awards" is dropped; prices show only when `Budget.on` (a battle's money). |

---

## 1. What the player sees and feels

**Building.** A seventh button, **Ship**, opens five tabs: Ship hulls, Superstructure, Propulsion, Naval weapons, Ship kit
(More shows every other tab: a tank gun, a jet engine, a rotor all go on). The blueprint is the side elevation, bow to the
right, as Armour is. Tapping a hull segment adds it end to end (bow forward, stern aft); a blue **waterline** is drawn
across the blueprint at the draft and trim the ship will actually float at, and the stats read *"4,620 t · draws 4.1 m ·
GM 1.3 m · ~29 kn · 2 compartments open"*. Warnings say it plainly: *"Top-heavy: GM −0.4 m, she will capsize"*, *"The stern
is open: she will flood"*, *"No screw or waterjet: nothing pushes her"*. A 150 m destroyer fits a 360 px phone. Built in
3D, the hull is a smooth loft: haze grey above a black boot-top, antifouling red below. *(Built for the slice: WP4.)*

**Launching.** A ship starts in the bay west of the island, already floating at her marks, bow out to sea. The water near
you has real swell (gentle by default): a RIB bobs and slaps, a patrol boat pitches, a destroyer barely moves. Speed
builds slowly: W/S ring the engine-order telegraph (Stop, Slow, Half, Full, Flank; Slow/Half/Full astern), A/D put the
rudder over; let go and she holds the new heading. A planing boat climbs onto the plane with a bow-up hump and then
skims; a hydrofoil rises out of the water at 30 knots. Turning heels her outward. A wake spreads behind, spray flies from
the bow, funnels smoke. *(Built for the slice, bar the RIB, the hydrofoil and the funnels' parts.)*

**Fighting.** With guns aboard, the view is the tank's aim view: the turrets follow the mouse (or your finger), the gun
reticle and shell chips are the tank's, but the aim ray reaches 20 km. The horizon is close at 1/20 scale: a ship's masts
show at about 7 km and radar sees a little further, so fights happen at 2-7 km. Shells arc, splash, and hit plate by
plate. Hits below the waterline make holes; water pours in; she lists toward the flooded side and trims down by the bow
or stern, all from physics. Damage control parties patch holes and fight fires; pumps push water out; the HUD's hull
diagram fills blue compartment by compartment. Let it go too far and she rolls over or goes down by the head; hit a
magazine and she breaks in two, each half sinking on its own. Torpedoes leave a bubbling track; CIWS mounts buzz at
incoming missiles; chaff blooms.

**Playing.** Sandbox launches at the bay, off the headland slipway, off Shetland's harbour, off the three carriers and off
Caithness *(built: `EARTH.spawns`)*. The **Naval Range** (practice targets steaming about east of the islands, or Hostile
waves that shoot back and strike aircraft that bomb you) teaches it. The **Naval Practice** battle pits you and two
computer ships against three. Online, a **Naval Battle** puts teams at opposite ends of Shetland Sound to fight over three
zones at sea, with aircraft joining if the host allows.

**Everything mixes.** A tank gun on a ship aims; a naval 127 mm on a tank fires (and rocks it); a boat hull under a tank
makes it float; pontoons make a seaplane that really floats and planes off the water; stubby wings on a ship give real
lift (not enough to fly); jet engines on a hull make a jet boat; a helicopter lands on a frigate's deck underway and stays
there.

---

## 2. The kind, the flag and the gates

### 2.1 Data (parts.js) — *built*
- `PART_CATEGORIES`: five tabs between `drPay` and `radar` (radar stays last: radar.test.js; ground and drone slices
  unchanged; ships at `slice(25, 30)`): `shHull` Ship hulls, `shSuper` Superstructure, `shDrive` Propulsion, `shArms`
  Naval weapons, `shKit` Ship kit. 31 categories.
- `VEHICLE_KINDS.ship = { id: 'ship', name: 'Ship', site: 'bay', launchRot: 0, cats: ['shHull', 'shSuper', 'shDrive', 'shArms', 'shKit'] }`.
- `SEA_KINDS`, `isSea` beside `GROUND_KINDS`/`AIR_KINDS`.
- The def fields are documented in the comment above `// ==== shHull ====` (parts.js:1371-1390); region markers
  `// ==== shHull|shSuper|shDrive|shArms|shKit ====` close PARTS. Packages add parts inside their region only.
- New globals stay unique: `grep -n "^const NAME\|^function NAME" js/*.js` for every new one (`NAVAL_STOCK`, `shullTris`,
  `SHIP_FATES` exists in flight.js).

### 2.2 The per-vessel flag (vessel.js) — *built*
- Constructor (vessel.js:247): `this.hydro = false; this.sh = null; this.hF = null; this.hT = null; this.ciws = NO_GEAR;`
- `rebuildGroups`: `aircraft` excludes `'ship'`; `ciws = gv ? parts.filter((p) => p.def.ciws) : NO_GEAR`; then
  `this.hydro = parts.some((p) => p.def.hull) || !!this.hydroFrom; if (this.hydro && typeof Ship !== 'undefined') Ship.groups(this); else this.sh = null;`
- `PILOT.ship` as the tank's (reaction wheels in the air only).
- `splitComponents`: `if (this.hydro) v.hydroFrom = true` on each piece and on what remains.
- Old vessels: `hydro` false, `sh` null, `ciws` `NO_GEAR`, no `hydroFrom` key (ground.test.js checks all four).
- **Remaining (WP8, WP11):** saving and restoring. `Vessel.serialize`/`restore` (and `gvLoad`) gain per part `holes`,
  `water`, `rud`, `fire` (in `GV_SAVE`) and per vessel `sh: { tel, dcPri, ciwsOn }`, `fate`, `hydroFrom` (a hull-less
  piece of a ship reloads still sinking). `GV_ROLES` gains `'dc'` (the damage-control party, §6.5). Restore cleans all of
  it (§10.5's rules).

### 2.3 What `isSea(kind)` decides vs what `v.hydro` decides
- **`v.hydro` (physics, from parts):** buoyancy, hydro forces, bed contact, flooding, holes, sinking, wake, swell drawing,
  decks. A tank with a hull floats; a ship with no hull sits on the old solid sea (and the builder warns).
- **`isSea(kind)` (what the craft is):** helm controls and HUD, the aim mode gate (built: flight.js `groundTick`), target
  classification (surface, never air), zone capture at sea, the hangar group, knots, the "Sunk" wording, sandbox/battle
  placement at sea.
- **Weapons and kit** follow parts as they always did (`v.gv`, `v.ciws`, `def.aim`).
- A hydro vessel that is not kind ship (a tank with a hull, a seaplane on pontoons, the Catalyna) keeps its own laws:
  `Ship.pre` turns a ground kind's drive (`ctl.v`) into the screws' demand and `ctl.h` into the rudders, and any other
  kind's throttle into the demand and its yaw (`ctl.r`) into the rudders (*built*, ship.js `pre`).

---

## 3. Hull geometry: `def.shull` and `shullOf(def)` — *built*

### 3.1 Data shape
All lengths in metres in the part's own frame (origin at the part's box centre, x along the part's w toward the bow, y up,
z across; depth = beam):
```js
shull: {
  cls: 'M',            // joint class: segments of one class meet section to section ('S', 'M', 'L', 'X'; 'one' for one-piece hulls)
  wl: -0.4,            // y of the design waterline (boot-top, builder marks)
  st: [                // stations, x ascending (stern → bow): [x, yd (deck), yk (keel), bd (half-breadth at deck), bw (half-breadth at wl), nb (bilge exponent)]
    [-4, 2.0, -2.0, 3.5, 3.45, 1.2],
    [ 4, 2.0, -2.0, 3.5, 3.45, 1.2],
  ],
  ends: { aft: 'joint', fore: 'joint' }, // 'joint' (meets the next segment), 'closed' (a transom or stem), 'ramp' (the landing craft's bow)
  plane: true,         // a planing bottom (strip planing lift at SHIP.planeK; others at SHIP.dispK)
  k: 0.15,             // form factor on friction (boxy hulls 0.3)
  pump: 0.01,          // built-in bilge pump, m³/s
  bk: true,            // bilge keels: + SHIP.bilgeKeel on the roll damping ratio (a number: its own) [read by ship.js rollBk: built]
  tubes: true,         // (art only) a RIB's buoyancy tubes along the deck edge
  step: 0.6,           // (art only) a planing step's x (flying-boat hulls, floats)
}
```
The **section** at a station: the deck is flat at `yd` across ±`bd`. Above `wl`, the side runs straight from (`bw`, `wl`)
to (`bd`, `yd`) (flare when `bd > bw`, tumblehome when less). Below `wl`, the bilge is the superellipse quadrant from
(`bw`, `wl`) to (0, `yk`): `nb = 1` is a straight V (deadrise from the chine), 2 an ellipse, 4-8 a flat bottom with round
corners. If `yk > wl` at a station (the stem's forefoot rising above the waterline), the section is a flat bottom at `yk`
as wide as the topsides there. Every section is convex (catalogue.test).

*Built differences:* the bilge points follow the superellipse parameter θ (not even steps in y); a planing step is two
stations 5 cm apart (the sampler interpolates linearly, so the keel jumps there).

### 3.2 The sampler (parts.js, pure, cached per def)
`shullOf(def)` returns `{ rings, nr, K, phys, x0, x1, wl, vol, fill, comp, st }`:
- **rings**: one per `max(0.5, w/24)` m and one at every station; each `{ x, P, K, A, cy, girth, yd, yk, bd, bw, nb }`,
  `P` a Float32Array of `K = 2·(SHULL_NK + 2) + 1 = 15` `[y, z]` pairs: the keel point, `SHULL_NK` 5 bilge points, the
  waterline point and the deck edge up the **port** side (−z), then the same down the starboard side (counter-clockwise
  seen from the bow; area positive).
- **phys**: `clamp(round(w/4), 3, 8)` rings evenly from `x0` to `x1`, each with `dx` (its trapezoid share). (A 24 m X
  midsection has 6; the Arley Berk of §7 has 39 phys rings: §6.1.)
- **vol**: the closed volume to the deck; **fill**: `{ y, v }`, the volume under each of `SHULL_FILL` 16 heights from the
  lowest keel to the highest deck (WP8's flood levels); **comp** `{ x0, x1, V }`.
- Users (nothing else redraws a hull another way): `partPath0`/`drawPart0` (`case 'shull'`: `shullPath`, `shullDraw`),
  `clashShape` (`'shipHull'` in the loft list: parts.js:1768), `PART_RECIPE.shull = 'shipHull'` (parts3d `BUILD.shipHull`,
  `shipHullGeo`), `Vessel.computeHull` (`shullPts`: per phys ring the keel point and both deck edges, the waterline points
  on the end rings), ship.js (`Ship.groups`, `model` for the builder), and — WP8 — armour.js's hit test through
  `Ship.hullRay` (§8.3).

### 3.3 Joints, compartments, open ends (Ship.groups) — *built, bar bulkheads*
- Two hull parts **join** when they are adjacent (`v.adj`), share `cls`, and the fore end of one lies within 2 cm of the
  aft end of the other in x, y (keels level) and z. A joined end is sealed. (`Ship.groups`: `joins`; the builder's
  `hullEnds` uses the same 2 cm test.)
- Each hull part is one watertight **compartment** (`sh.comps[i] = { parts, x0, x1, V, W, holes }`). **Remaining (WP8):**
  a `bulkhead` part hosted on a hull (`att` = the hull's id) cuts its compartment in two at the bulkhead's x: `Ship.groups`
  splits the comp into `{ x0, xb }` and `{ xb, x1 }` with `V` from the rings' areas integrated on each side, and every
  ring gets the `ci` of the side its x lies on. One-piece hulls are one compartment unless bulkheaded.
- An end that is `'joint'` but unjoined (the builder forgot the stern, or a segment was shot away) is an **open end**
  (`sh.open: [{ p, end }]`, *built*): WP8 turns it into a permanent hole of the end ring's area below the deck, at the end
  ring's centroid (§8.4). A bow without a stern sinks by the stern.

---

## 4. Physics (ship.js §core)

### 4.1 Where it runs — *built*
`Vessel.physicsStep` (vessel.js), new lines gated on `this.sh` (null for every non-hydro craft and without ship.js):
1. star check; gravity; `Drone.pre` for drones.
2. `if (this.sh) Ship.pre(this, dt, sim)` (vessel.js:1152): the helm (telegraph, rudder, heading hold), the engines'
   demand and spool, each rudder's angle; `v.throttle` for air engines on a ship (an airboat). Wakes a moored ship.
3. `applyEngines`, `spinRotors` (air engines on a hull push exactly as anywhere).
4. control: `turnTarget` returns `null` for `this.sh && kind === 'ship'` (vessel.js:657): rudders steer, not reaction
   torques. A hydro plane, helicopter or tank keeps its own laws.
5. aero block unchanged (the hull's air drag; wings' real lift with ground effect over the sea).
6. `if (this.sh) Ship.forces(this, dt, vb, wb, sim)` (vessel.js:1400): writes `v.hF`, `v.hT` (part axes) and `sh.fsub`.
7. `updateHeat`.
8. integrate: after `this.lift` (aerodynamic only: Death's air rule reads it) the water's force joins the acceleration;
   `Ship.addedMass` scales it per part axis by `1 + kM·fsub`; `hT` joins the torque before `gyro`, and `dw` is divided
   per axis by `1 + kI·fsub` (the water's added inertia).
9. `ground()`: for hydro vessels `surf = Ship.floorAt`, normals `Ship.floorNormal`; contacts carry `bed` (crash limit
   × `SHIP.BED_CRASH` 1.5, friction `BED_MU` 0.4) and never `side` or `water`.
10. rips (a foil past `FOIL.brk` × its load is queued on `v.rip` as a wing's rip is).

### 4.2 Buoyancy, ring by ring — *built* (ship.js `buoy`)
Once a step, `frameOf` gives the local up/east/north (sim and part axes) and her east and north (`S.e0`, `S.n0`); `waterOf`
(every `REFRESH` 0.5 m moved) the still water's level (0 at sea, a lake's surface inland, `−Infinity` off any water), the
depth and the wave fade (`fadeAt`, 0 on lakes). For each phys ring: the water plane at the ring (its wave height and slope
× fade) gives each polygon point's signed height; the polygon is clipped once (Sutherland-Hodgman), its immersed area `a`,
centroid, waterline chord and wetted girth found; `ρ·g·a·dx` pushes up along the local vertical at the centroid. Sums:
`B`, `Vol`, `Awp`, `Swet`, `Lwl`, `Tbar`, `cb`; `fsub = clamp(B/W, 0, 1)`; `v.afloat = B > 0.05·W` (never `splashed`,
which stays the old solid sea's); `v.draft`, `v.heel` (+ starboard down), `v.trim` (+ bow down); `sh.gm` from the
righting moment every `STAB_T` 0.5 s past `STAB_HEEL` 1° of heel. A hydro vessel with no rings left (a turret, a bridge)
sinks on its drag (`sink`). Measured: an analytic box hull's draft 1.4635 vs 1.4634 m, GM 0.367 vs 0.365 m, roll period
7.60 vs 7.60 s.

**Remaining (WP8): the flood water's weight.** At the marked line in `forces` (`// (the flood water's weight …)`): for
each compartment with `W > 0`, a force `ρ·g·W` straight down (the local −U) at the water's centroid in part space, found
from the compartment's own rings clipped by the *flood plane* (level in the world, so it shifts as she heels: the free
surface) at the height whose clipped volume is `W` (a start from `shullOf(def).fill`, then at most 4 bisection clips),
its lateral shift capped at `FLOOD.fsMax` 0.45 × the beam. Added to `hF`/`hT` with `push`; not to `v.mass` (§19.3: water
as weight). A full compartment (`W ≥ V`): the force is `ρ·g·V` at the compartment's centroid; its rings still displace,
so the net is the steel's weight: she settles. Cached per compartment while `W` and the heel move less than 1 % / 0.5°.

### 4.3 Hull resistance and lateral force — *built* (ship.js `hull`)
At each immersed ring's centroid: lateral lift `C_lin = latLin·π·T̄/L_wl` (`latLin` 2) and cross-flow drag (`cross` 0.9)
on its immersed depth (a turn heels her outward); strip planing lift `cpl·max(0, V_n)·|u_a|·b·dx·cos²β` (`planeK` 0.6 on
`plane: true` hulls, `dispK` 0.2 else) with heave drag (`heaveCd` 1.0) and linear heave damping (`heaveLin` 0.4·ρ·√(g·T̄)
per m² of waterplane), both along the keel line's vertical plane; ITTC-57 friction on the wetted girth × `(1 + k)`; the
wave-making resistance `R_w = B·C_wr(Fn)` (`CWR` table) shared by immersed volume. Every quadratic term is clamped to
`CLAMP` 0.8 of the momentum it opposes a step (`capF`, `effMass`). Roll damping: exponential, ratio `rollZeta` 0.07 +
bilge keels (`def.shull.bk`: `bilgeKeel` 0.03 or its own number) + `rollZV` 0.15 × Fn (to 1.5). LOD: a hydro vessel over
`LOD` 1.5 km from the active craft works out its forces every other step (held between, damping halved). Measured: the
Cyclon (110 t, 4 MW) 25 kn at 10 s, 33.2 kn top in calm water; hard over at 19.7 kn, 9.4°/s, a circle 4.1 lengths across,
heel 9.8° outward; 7.3 µs a step for 12 rings (≈ 21 µs scaled to 35: the budget is 40).

**Phase 2 fixes (the WP5/WP6 finish):** `shull.cw` multiplies `R_w` once (the whole hull's, as the builder's
`resistance()`; it was applied per ring too after the merge: 6.25×). The planing lift is weighted along the waterline,
`(n + 1)·(1 − ξ)^n` from its fore end (`SHIP.planeCP` 1: its centre of pressure 2/3 of the wetted length ahead of the
transom, inside Savitsky's 0.55-0.75; the builder keeps an even share). `sh.gm` (Ship.stab) is the buoyancy's righting
moment over `B·sin φ_w`, φ_w her heel against the water's surface under her (the buoyancy's mean normal), measured past
`STAB_HEEL` of it: against the vertical a small boat lying with a wave's slope read a fifth of her GM. Open: a planing
hull skids through its turns (the Zodiak about 30 lengths hard over at full speed, against §7's 2-4, itself 3-6 g at
40 kn): real deep-V hulls bank into a turn; the model heels them outward.

**Remaining (WP5):** a patrol boat beam-on to Moderate seas rolls 12-13°; real ones roll 5-8°. Fix with data: `bk: true`
on every stock M, L and X hull segment (`bk: 0.05` on X), re-measured by the trial (§17.1). If that is not enough, WP6
(owner of core) may raise `SHIP.bilgeKeel`; never touch `rollZeta` (the box hull's period test pins the bare hull).

### 4.4 Foils: rudders, hydrofoils, skegs — *rudders and fixed foils built*; ride control remains (WP6)
Built (`propel`'s foil loop): every `def.foil` part, copy by copy (`sh.fl`), at water density, never the wing code: lift
slope `FOIL.slope`·2π·ar/(ar+2), stall at 22° falling over 65° to half, induced and stall drag, lift faded in over
`sub`·chord of depth, a rudder in a screw's slipstream (`wash`), strain past `load` and a rip past `brk` 1.5 × it.
`foil.n: 'z'` (a rudder or skeg, turned by `p.rud` about its stock) or `'y'` (a hydrofoil, at fixed incidence `inc`).
Phase 2: a hydrofoil (`foil.kind: 'foil'`) and its struts cavitate: past the cavitation number's inception (σ = (p_atm +
ρ·g·depth − p_v)/q under `FOIL.sig` 0.5) their drag gains `FOIL.cav`·(sig/σ − 1) (`cav` 0.13): a subcavitating foil's
limit, so the Pegazus tops out at 48.6 kn on 20 MW (83 kn without it). The builder's top speed flies her too: below
take-off her foils lift what they can at full incidence and the hull the rest; past `RIDE.v`, once they can lift her,
the foils' and struts' drag at her ride height (`foilsOf`, `foilDrag`, `dragAt`): 47.7 kn.

**Remaining: ride control (WP6).** A foil with `foil.ride: true` (foilBow, foilAft: §6.3) is flown by a controller in
`Ship.pre` (any kind: a part's behaviour, not the kind's):
- *Halves.* `Ship.groups` makes two `sh.fl` entries for each ride foil (its copies split at `z ± depth/4`, `area/2`
  each), so the controller can roll her. A ride foil's entries carry `inc` (the commanded incidence, °) and `inc0` (its
  def's `inc`); the foil loop reads the entry's `inc` before the def's.
- *Measure* (every step, before `forces`): the keel's clearance over the waves at the foremost and aftmost phys rings,
  `cF`, `cA` (`−depthOf` of each ring's keel point), `c = (cF + cA)/2`, its rate `ċ` (her velocity along `S.U`), the trim
  error `ε = (cF − cA)/L` (L the rings' span), the heel `φ = v.heel`.
- *Target* `h* = max over ride foils of (foil.h ?? RIDE.h)` (foilAft's `h` 1.6 for the Pegazus: her keel 1.6 m over the
  waves on 3.2 m struts). Foilborne only past `RIDE.v` 9 m/s (17 kn): below it every ride foil holds `inc0 + RIDE.lim`
  (all the lift there is: she climbs onto her foils as speed builds).
- *Command* per entry: `inc = inc0 + clamp(RIDE.kh·(h* − c) − RIDE.kv·ċ ∓ RIDE.kt·ε, −lim, +lim) + RIDE.kphi·(φ − φ*)·sign(z)`
  (°; `∓`: − for a foil ahead of the centre of mass, + behind; `sign(z)`: a starboard half takes more lift as she heels to
  starboard), with a bank into a turn `φ* = −(sh.rud/rudMax)·RIDE.bank`. Each entry's incidence moves at most
  `RIDE.rate` °/s. `RIDE` today: `{ h: 0.8, kh: 4, kv: 2, lim: 6, kphi: 15 }`; add `v: 9, kt: 30, bank: 8, rate: 20`.
- *Intakes.* A foil with `foil.intake: true` (foilAft) lends its depth to the waterjets: a waterjet's submergence is the
  greater of its own and that of the deepest intake foil aboard (§4.5), so the Pegazus' jets keep drinking foilborne.
- *Lost foils.* A ride foil broken or shot off: its entries go (`groups` rebuilds); with none left the hull comes down.
- Old foils (no `ride`) behave exactly as built; the Cyclon's rudders are untouched.

### 4.5 Propulsion — *screws and spool built*; outboards, waterjets remain (WP6)
Built (`propel`): the working engines' shaft power (`shaftPower`: `def.engine.kw` × `Combat.engineK(p)` for a damaged
one; none with no `driver` aboard a gv vessel) shared equally by the live screws; per screw static thrust
`k0·(2ρA·P²)^(1/3)`, capped by `η·P/max(va·u, vmin)`, astern × `ASTERN` 0.7; `p.rpm` signed; out of the water it races
and pushes nothing (`smoothstep` over 0.5 D); its shaft's drag. The engines' share `S.pow` follows the demand over the
slowest engine's spool (`SHIP.SPOOL` 8 s, or `def.engine.spool`: a turbine's 15).

Remaining (WP6), each a branch in `propel`'s thrust loop, with `Ship.groups` putting outboards and jets in `sh.scr`
(`kind: 'screw' | 'outboard' | 'jet'`):
- **Outboards** (`def.screw` + `def.engine` + `def.steer` on one part: §6.3 `outboard`): its own engine's power, not the
  pool's (`shaftPower` skips engines that are also screws; the pool's share counts only screws and jets without one: as
  the builder's `propulsion` already does). Its thrust turns about the part's own y by `p.rud` (it is in `sh.rudders`,
  built). Tilted out of the water it races. Its own spool 2 s (`def.engine.spool`).
- **Waterjets** (`def.jet: { D, steer, bucket }`): the builder's `thrustAt` formula (built) in flight too:
  `T = min(JET.t0·T0, (eta0 + eta1·smoothstep(v0, v1, V))·P/max(V, vmin))`; the nozzle turns the thrust by `p.rud` (its
  `jet.steer` 30° at most); astern the bucket reverses it: `−JET.bucket`·T (no `ASTERN` factor). Submergence: the greater
  of its intake's (the part's point, over 0.5 D) and the deepest `foil.intake` part's (§4.4). A jet makes no slipstream
  for a rudder. `p.rpm` spins its impeller in the art.
- **Turbines:** nothing new in the physics (spool is built). **Mixed plants** spool at the slowest engine (README limit).
- The builder's `thrustAt` and the flight's must stay one formula: `ships-builder.test.js` compares top speeds (±12 %).

### 4.6 The helm (`Ship.pre`, kind ship) — *built*
The telegraph `sh.tel` −3…4 (`SHIP.TEL` demands −0.75 … 1.0, `TEL_NAMES`), stepped by `Ship.setTel`/`telStep`, by
Flight's `shipKey`/`helmKeys` (W/S, the throttle keys; Z flank, X stop) and the touch lever; Ship.pre's own stepping from
`ctl.v` is for a craft driven that way (readControls keeps `ctl.v` 0 for a ship, so steps never double). The rudder:
`ctl.h` × the rudders' throw (`rudMax`: a foil's `max` 35°, an outboard's or jet's `steer`); let go with `sas 'hold'`
(the default) she holds the heading she had, led by her yaw rate (`HOLD`: lead 1.5 s, kp 2, kd 2.5·L/V); `sas 'manual'`
centres it. Each rudder follows at `rudRate` 12 °/s. `Ship.heading(v, sh)`: rad clockwise from game north.
**Remaining (WP10):** the AI drives the same interface: `sh.tel` and a heading order `sh.hold` (with `ctl.h` 0 and
`man = false`), never keys (§9.1).

### 4.7 Added mass and damping — *built*
`ADD_M { x 0.05, y 0.8, z 0.6 }`, `ADD_I { x 0.15, y 0.6, z 0.8 }` per part axis (turned onto a seaplane's pontoons'
axes in `groups`), × `fsub`.

### 4.8 Grounding, carriers, other ships, decks
**Built:** the bed (above). A ship aground at 10 kn on the island's shore stops, `landed`, 11/11 parts, nothing broken.

**Remaining (WP6):**
- **`Ship.impactSea(v, parts, sim)`** (death.js `impact` calls it first for `v.sh`, before its air/ground rules; the
  stub returns `parts`): of the parts the crash rule broke, hull parts (`def.shull`) are taken out of the list unless the
  contact's speed was past `IMPACT.remove` 2× their limit; each kept one takes `IMPACT.hp` 0.4 × its max hp
  (`Combat.damage`, cause `'crash'`) and a hole of `IMPACT.hole` 0.02 m² per m/s over its limit at the contact point
  (`Ship.addHoles`: WP8; a no-op until then). Returns the rest (masts, guns: they break as ever). The contact speed per
  part: vessel.js `ground()` keeps, for hydro vessels only, a `Map` part → worst speed/limit beside `broken` (`v._bedHit`).
- **Slams.** A hull ring entering the water faster than `SLAM.k` 1.8 × its part's `breakSpeed` (the old water's ×1.8)
  along the local vertical queues the part on `sh.slam` → `Death.impact` → `impactSea` (holes, never a shattered hull).
  `SHIP.SLAM = { k: 1.8 }`. Found in `forces`: a ring's `rk` going from 0 to > 0 with `uy < −lim`.
- **`Ship.bump(F)`** (from `Ship.frame`, once a frame: the call is built): every pair of hydro vessels (ghosts included:
  S10), each hydro vessel against non-hydro vessels and the static carriers, within the sum of their `reach`:
  - *Narrow phase:* `insideHull(S, X)`: a part-space point X against ship S's hull: S's phys rings either side of X's x
    (kept sorted by x in `groups`), their polygons' half-breadth at X's y interpolated; inside when `|z − zc| < half` and
    `yk < y < yd`: penetration `half − |z − zc|` along ±z, or past her ends the distance to the end ring along ±x. Points
    tested: the other ship's phys rings' waterline points and deck edges (4 a ring), a non-hydro vessel's `hull` points.
  - *Response:* relative velocity along the normal `vn`; if closing, an impulse `j = −(1 + BUMP.e)·vn / (1/m_A + 1/m_B)`
    (effective masses at the contact, `effMass`), at most once a pair a frame; push-out `BUMP.push` 0.5 of the penetration
    each (all of it to ours when the other is a ghost or a carrier). A ghost (`v.remote`) is never moved or damaged here:
    its owner runs the same rule on their screen (no message).
  - *Damage* past `BUMP.v` 2.5 m/s closing: each side's touching hull part takes `BUMP.dmg`·μ·s²/1000 hp (μ the reduced
    mass, kg; cause `'crash'`, by the other vessel) and a hole of `BUMP.hole`·s² m² at the contact (`addHoles`). A 110 t
    Cyclon into a moored destroyer at 10 m/s: ≈ 5,500 hp to her bow (2,200 hp: it breaks, `impactSea` holes it).
  - *Carriers:* `EARTH.carriers` as boxes from the deck (`deck` m) down to `CARRIER_DEPTH` 9 m under the sea, `±hl` ×
    `±hw` along `yaw`; immovable; a ship's ring points against the box (the nearest face's normal). Ramming one stops her;
    nothing passes under a carrier's deck (`floorAt` returns a deck only within `DECK_BAND` 1.5 m of it).
  - Cost: pairs within reach only; ≤ 0.05 ms a frame with two ships touching.
- **Decks and lashing** (helipads: `def.deck: { hl, hw }`):
  - `Ship.D` (built, empty) is refilled by `Ship.frame` when the vessel list or a part list changes: `{ v, p, hl, hw, top }`
    per deck part of a live hydro vessel (top: its top face's y in part space; ghosts' decks too: §10).
  - *Contact* (vessel.js `ground()` and gear.js `Gear.ground`, one call each, gated on `Ship.D.length`):
    `Ship.deckContacts(v, contacts, loc)` adds, for each deck not on `v`, every probe point within the deck's rectangle and
    within `DECK_BAND` under its top: `{ p, k, r, pen, n: the deck's up (world), deck: D }`. In the solver the contact's
    velocity is taken relative to the deck's point velocity: one line `if (k.deck) Ship.deckRel(k, vp)` after
    `this.pointVel(k.r, vp)` (in vessel.js and in gear.js's copy). Crash limits as a carrier deck's. No reaction on the ship.
  - *Lashing:* a craft on a deck whose speed relative to it stays under `LASH.v` 0.3 m/s for `LASH.t` 1 s, with lift (its
    rotors' or wings') under `LASH.lift` 0.3 of its weight, is lashed: `v.lash = { s: ship, p: deck part, q, X }` (its pose
    in the ship's part space). flight.js `physicsTick`: `if (v.lash) { Ship.lashStep(v, h, this); continue; }`: not
    stepped; its pose the ship's pose × that, its velocity the deck point's, `landed = true`, `restTime` counting. Unlashed
    when its lift passes `LASH.lift` × its weight (collective up, throttle open), when the deck tilts past `LASH.tilt` 25°,
    when the deck part breaks or the ship is doomed (it falls with the deck's velocity), or on `Flight.start`/respawn.
  - A moored ship with a lashed craft: `drift` moves her and `lashStep` follows. Saved as the deck part's id on the craft
    (`rss.flight`), restored only when that part is aboard a hydro vessel in the save.
- **Gear's hydro gate** (gear.js `Gear.ground`: amphibious Armour with a hull): for `v.sh`, the probes' heights are
  `Ship.floorAt` (the bed) and normals `Ship.floorNormal`; `M.water` false (no wading or swim drag, no `GEAR.swim` speed
  cap: the water's forces are ship.js's); the drive force acts only through contacts on the bed (none afloat: her screws or
  waterjets drive her through `Ship.pre`'s ground-kind branch, built); the engine-flooding rule (`C.eng.length && !C.amph`)
  skips `v.sh` (WP8 floods her engine through its compartment instead: `Ship.wetAt(v, p)`). Up the slipway the tracks meet
  the shoaling bed, buoyancy falls away, traction returns. Gear's copies of vessel.js's rules stay in step (CLAUDE.md).

### 4.9 Stability numbers — *built*
`Ship.stab(v)`: `sh.gm` (from the righting moment in flight; `stabProbe`'s 2° heel at launch). The builder's GM is
`Ship.hydrostatics` (§11).

### 4.10 Sleeping, rails, warp, far ships — *built*
Mooring (`MOOR`: still 5 s under 0.5 m/s at Stop, not the player's: no physics, the pose bobs on the waves at 10 Hz;
woken by the player, the telegraph, a hit, a part lost, water or holes changing, a craft within 200 m faster than 2 m/s);
`canRails` moors the player's still ship for warp; a far hydro vessel is never railed (it waits); AI hydro vessels are
stepped out to `aiNear` 12 km; `railsAdvance` leaves afloat or landed hydro vessels where they are.
**Remaining (WP8):** a doomed ship (§8.9) is never moored and is stepped until she is gone or a wreck; a wreck on the bed
is `kin` (frozen), like every ground wreck.

### 4.11 Launch — *built*
`Flight.start` calls `Ship.launch(v, P)` for a hydro vessel started on water (not an air start): `seaPlace` moves the spot
out to sea in 50 m steps (up to 1 km) until the keel clears the bed by 2 m all along her; `settle` floats her at her marks
(Newton on heave, trim and heel over the very rings), at rest, telegraph Stop, `sas 'hold'` for kind ship. Spawn spots:
`EARTH.spawns` ships' entries (the bay, off the slipway, off Shetland harbour, off each carrier, off Caithness),
`Spawns.place`'s sea branch (a room's next ships abreast 120 m apart). **Remaining:** battle placement at sea (WP11, §10.3)
and the Naval Range's spots (WP10, §9.2).

### 4.12 Remaining odds and ends (WP6)
- **Tiny pieces.** A hydro piece with no hull part and under `TINY` 200 kg floats as a box: buoyancy `ρ·g·V_sub`, `V_sub`
  the submerged share of its bounds box × `TINY_FILL` 0.6 (lighter than 0.6 of its box's water: it floats), velocity and
  spin damped `e^(−TINY_DAMP·dt)`. Heavier hull-less pieces sink (`sink`, built). A floating piece with nobody in it is
  junk: after `SEA.float` s at rest (death.js `junkLife`) it is scuttled (`sh.scuttle = true`: its buoyancy off) and sinks
  by physics; death.js's `seaTick`/`seaAt` keep excluding hydro vessels (built).
- **The Catalyna's take-off** (a hydro vessel of kind plane): her planing hull carries her onto the step and her wings lift
  her off at about 85 kn on her old plane laws, flaps down (Phase 2 fix: "about 70 kn" needs a lighter wing loading than
  her 55 m² Long Straight Wing gives 12 t: it stalls at 88 kn clean, 72 kn with full flaps, and the hold law rotates her
  gently on the water; measured 83 kn, then 184 kn level at full power, the real PBY's 170). Gates: vessel.js `planeTarget` and flight.js `planeTick` treat
  `v.sh && v.afloat` as on the ground wherever they read `v.landed` for the ground roll (Aim's take-off steering, hold's
  wings-level on the ground), so the laws don't fight the water; on the water she steers by her air rudder and, slow, by
  the yaw input on any water rudder aboard (built: `Ship.pre`'s other-kinds branch). A touchdown under `SLAM.k` ×
  breakSpeed is a planing run-out; harder, holes. These gates are `v.sh`-only: every old seaplane keeps its floats' rules.
- **A ship with wings** (the owner's rule): their lift is real (aero block, ground effect), `aircraft` is false (no
  `planeTarget`), so she never flies them; two `wingL`s (Large Wing) on the Cyclon at Flank: lift < 30 % of her weight.
- **A jet boat:** air engines on a hull push through `applyEngines`; `v.throttle` comes from the telegraph (built).
- **`shull.cw`** (new, WP5/WP6): a blunt hull's wave-making factor, × `C_wr` in both `hull()` and the builder's
  `resistance()` (one formula: the two must agree). Default 1; the landing craft's `lcHull` 2.5 (a bluff ramp bow: without
  it a 13 t box on 300 kW makes 18 kn instead of the real 12).

---

## 5. Waves and the drawn sea (ship.js §waves, render3d.js)

### 5.1 The function — *built*
`Ship.wave(e, n, t, out)` → `[η, ∂η/∂e, ∂η/∂n]` (a shared array: copy it): four directional sines `SHIP.WAVES`
(`[a, T, θ, φ]`: 0.28 m 5.5 s 0°, 0.18 m 4.4 s 25°, 0.12 m 6.6 s −20°, 0.07 m 3.3 s 50°, at Moderate), running toward
`swellDir` 250° (from the WSW), deep-water dispersion `k = ω²/g`, each state's factors `SEA` (calm a 0.3 t 0.75; moderate
1 1; rough 2.5 1.36). `Ship.seaT(F)` the sea's clock (`F.time + S.seaOff`); `setSea(state)` (Settings → Sea, main.js;
built), `sea()`; `fadeAt(depth)` (smoothstep 3-25 m); `waveUniforms(P0e, P0n, t, out)` (per component `[dE, dN, k, a, ω,
φ′]`, φ′ folded in double precision). Measured Hs 0.31 / 1.03 / 2.58 m; the uniforms agree with `wave` to 0.001 mm.

### 5.2 Rendering agreement — *built*
render3d.js `updateSwell` (the ships update's region, "the sea near a ship"): a grid round the camera (High 128 at 4 m, Low
64 at 6 m), shown while a hydro vessel is within `SWELL.near` 2 km and the camera under 1.5 km; recentred when the camera
strays an eighth of it (the new grid filled behind the one on show, `SWL_SLICE` ms a frame); vertices lifted by `SWELL_FN`
(the same sines); each vertex's share the depth fade × an edge fade (flat at its border, where it meets the ocean); the
patch's own ocean colours, water attribute and UVs carried over; the ocean cut away under it (`uSeaHole`). With no ship
near: hidden, never built, the hole `(1, 1, 0, 0)`, nothing called (old scenes identical). Wakes: one ribbon mesh for the
nearest `WAKE.n` 6 hydro vessels within 1.5 km making way, Kelvin arms, one draw.

### 5.3 Wake, spray, smoke — *built* (`Ship.fx`, from `Flight.emitParticles`)
Bow spray (pairs from the stem, more as the bow slams, at the chines on the plane), funnel smoke from `def.funnel` parts
(or `style: 'funnel'`: grey for diesels, faint for turbines, more with the telegraph), a burst of white water at the stern
when the telegraph is rung; within `SPRAY.near` 800 m of the view's craft; FX's caps.

### 5.4 Remaining
- **WP11:** in a room the sea state is the host's (`settings.sea`: `'calm' | 'moderate' | 'rough'`, cleaned with
  `SHIP.SEAS.includes`) and the sea clock slews toward the host's: each snapshot from the host carries `st` (its `Ship.seaT`
  then); a peer moves `S.seaOff` by at most `SLEW` 0.05 s a second toward `st − (F.time + latency/2)`. A peer's own
  Settings → Sea is ignored in a room and restored after.
- **WP9:** big shells' splashes: armour.js `ground()`'s water splash scales with calibre for naval shells
  (`FX.splash(b, at, n, SH.cal >= 57 ? SH.cal / 25 : 3)`: a 127 mm round throws a 5× column), gated on `SH.naval`.
  Torpedo tracks: a bubbling line of `smoke` particles (white, `heavy`) every `TORP.bubbles` 0.2 s behind a ship
  torpedo within 1.5 km of the camera; the old air torpedo keeps its own.
- **WP8:** a ship going down is drawn by her own geometry under the water (the swell patch and the water's depth shading
  cover her); a hull below `SINK_MAX` 16 m keeps drawing (render3d's sinking veil `WATER.sinks` is for the old plunge only:
  a hydro vessel never enters it). Check in `ship-flight.mjs` (a screenshot of a sinking destroyer, looked at).
- **WP12:** the bridge view in a Rough sea (built `setBridge`): its horizon's roll is the ship's own; no smoothing beyond
  the camera's (a check in ship-flight.mjs that the view never shows the inside of the hull).

### 5.5 The sea's looks (WP15: added at the owner's request during the update)
The owner: "is this update going to further improve the sea looks? They need an upgrade definitely". The sea is now where
a whole kind of craft lives, so its looks are part of this update, as their own package. What exists (PR #52 and §5.2-5.3):
drifting ripples (one normal map, a second set on High) at about 1 m/s, the water's depth (Beer absorption over the seabed,
turquoise shallows), shore foam and a line at the waterline, Fresnel and a sky mirror at a glance, a Sun path that widens
far off; real waves only in the swell patch round a ship; Kelvin wakes, spray and funnel smoke. What it lacks, judged from
a plane's cockpit at 50 m-3 km, from a deck and from the chase camera:
- **The sea state from anywhere.** Beyond the swell patch the sea is the same flat ripples whatever Settings → Sea says.
  The far sea takes wave-scale normals from the same four sines (`SWELL_FN`'s slopes, with the waves the pixel can't hold
  faded out by distance so nothing shimmers), so a Rough sea reads as rough from 3 km up, the swell patch's edge can't be
  seen, and the drawn sea agrees with the physics' wherever a ship could be. Calm stays glassy.
- **No tiling.** The 48 m ripple tile repeats visibly from altitude: a second sample at a larger scale and another angle,
  and a slow variation in roughness and colour over kilometres (wind patches, slicks), as the ground's far variation does.
- **Whitecaps.** Foam on the crests by sea state (none in Calm, scattered in Moderate, many in Rough) from the wave
  function's steepness, broken up by the ripple noise, drifting with the wind, fading over a few seconds as real
  whitecaps do; streaks along the wind in Rough.
- **Light in the waves.** A blue-green glow through the thin crests facing the Sun (a cheap subsurface term from the wave
  slope and the Sun's direction), the troughs darker, so the swell has shape in the low Sun the Faroes mostly have.
- **Ships in the water.** A bow wave and a foam collar where the hull meets the swell (the swell patch knows the hull's
  waterline), the wake's foam lasting longer and spreading (about a minute) behind a ship making way, a propeller wash.
- **Gates and budget.** Old scenes' pictures of the sea change by design (the only intended change to an old scene's
  picture in this update: graphics.mjs's water checks re-baselined with screenshots looked at); everything else in an old
  scene stays identical. Phone Low within ±3 % of today's frame time in the bench's sea scenes (`sea300`, `seaRough`,
  the water scenes of water.mjs), High within +10 % over the sea and no change where no sea is on screen; no new program
  in an old scene beyond the ocean's own variants (the program count checked); the drift on real frame time (paused:
  still), frame-rate independent; the near ground, the arena's ground and the sinking veils (water.mjs) unchanged.
- **Done already (the lead, from the owner's screenshot):** the black-green specks in the middle distance, worst in clear
  shallows: a ripple tilted away from the eye reflected the ray below the horizon into the env cube's ground colour. The
  water's `getIBLRadiance` keeps the reflected ray at least 0.02 above the horizon (`waterEnv`, `WATER_RV`). Keep it.
- **Tests.** water.mjs's checks hold; new screenshots (Calm, Moderate, Rough from 50 m, 500 m and 3 km; dusk and night;
  a destroyer at 25 kn from the chase camera and her bridge; the Faroes' coast from a plane) on phone and desktop, looked
  at; the bench before/after on phone Low and desktop High.

---

## 6. The parts (59 new, all `gv: true, ship: true`; 389 → 441)

Seven are built (the slice: hbBowM, hbMidM, hbSternM, bridgeM, dieselM, screwM, rudderM) and stay exactly as they are
(keys, `w`/`h`, depth, stations and masses never change: CLAUDE.md). The other 52 are below. Every one is `gv: true,
ship: true`, has `family` (its tray group: **Boats** for S, M and one-piece hulls and small-boat kit, **Escorts** for L,
**Destroyers** for X, **Naval** for the rest), `place` (where a tray tap puts it: §11.2), `cat` (its tab), `tier`, `cost`
(prices show only when `Budget.on`), `hp` (explicit: `Combat.maxHp`'s formula is for aircraft parts) and a `desc` in
plain player words with its numbers. **Names are generic or altered, never real designations** (comments may name the real
thing). 2D art: hulls `shullDraw` (built: plating, boot-top, antifouling; add the RIB's tubes, the landing craft's ramp,
floats' and the flying-boat hull's step from `shull.tubes`/`ends.ramp`/`shull.step`); the rest `gvKit` styles or `plated`
outline prisms (the ground update's recipes: 2D = 3D = clash = hit). 3D: hulls `BUILD.shipHull` (built), the rest
parts3d recipes by style. Masses in tonnes, lengths in metres, power kW, costs $.

**Where they go** (`place`, read by `Ship.spotOf`, §11.2): `keel` hull segments end to end; `deck` on the deck line;
`super` on the deck or on top of other superstructure; `mast` on top of superstructure (a radar on a mast); `inside`
inside a hull, low; `stern` under or on the transom; `bow` under the forefoot; `edge` at the deck edge facing outboard;
the ground update's `ring` (a gun house on a ring) and `front` (a gun on a house's front) as they are.

### 6.1 Ship hulls (`shHull`, 16: 3 built)

**The classes.** Segments of one class meet section to section (the joint section below, keels level, bottoms level: a bow
box sits higher by its `dy` because its stem rises). Design waterline `wl` and draft in a midsection's frame.

| Class | For | Beam | Depth (keel → deck) | Joint section `[yd, yk, bd, bw, nb]` | `wl` (draft) | Bow / mid / stern length | Plating | `bk` | `pump` | `k` | breakSpeed |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S | boats 8-20 m | 3.0 | 1.8 | `[0.9, −0.9, 1.5, 1.45, 1.1]` | −0.3 (0.6) | 5 / 4 / 3 | alu 4 mm | — | 0.005 | 0.12 | 5 |
| M (*built*) | patrol and missile boats 30-50 m | 7.0 | 4.0 | `[2.0, −2.0, 3.5, 3.45, 1.2]` | −0.4 (1.6) | 10 / 8 / 6 | alu 6 mm | true | 0.01 | 0.15 | 6 |
| L | corvettes 60-110 m | 11.0 | 6.0 | `[3.0, −3.0, 5.5, 5.35, 1.6]` | −1.2 (1.8) | 22 / 16 / 18 | steel 8 mm | true | 0.03 | 0.18 | 7 |
| X | frigates and destroyers 100-200 m | 16.0 | 11.0 | `[5.5, −5.5, 8.0, 7.8, 2.4]` | −0.5 (5.0) | 34 / 24 / 26 | steel 12 mm, deck 10 | 0.05 | 0.08 | 0.2 | 8 |

Checked by running the sampler and `Ship.stats` on these tables (a scratch probe; WP5 turns it into catalogue/ships
tests): at the §7 displacements the stock ships draw S boat 12 t 0.65 m; Cyclon 116 t 1.43 m; Osca 210 t 1.70 m; Vizby
650 t 1.71 m; Olivar (2 mids, 108 m) 5,000 t 5.12 m; Arley (4 mids, 156 m) 8,000 t 5.12 m: all within ±0.3 m of their
marks. The Arley Berk has 8 + 4×6 + 7 = **39 phys rings** (the §15 budget's "35" was the original's estimate): 7.3 µs per
12 rings → ≈ 24 µs a step, inside the 40 µs budget.

**Segments** (`ends`: bow `{ aft: 'joint', fore: 'closed' }`, mid `joint/joint`, stern `closed/joint`; stations
`[x, yd, yk, bd, bw, nb]` in the part's own frame; `plane: true` on S and M; masses take in structure, machinery spaces,
fuel, stores and fitting-out, so a ship built from them with her kit sits near her marks):

| Key | Name | w × h × depth | dy | t | $ | hp | tier | `wl` | Stations |
|---|---|---|---|---|---|---|---|---|---|
| hbBowS | Small Bow | 5 × 2.1 × 3.0 | 0.15 | 2.0 | 600 | 600 | 1 | −0.45 | `[-2.5, .75, -1.05, 1.5, 1.45, 1.1], [-1, .82, -1.05, 1.4, 1.3, 1.0], [.5, .9, -.9, 1.1, .9, 1.0], [1.75, .97, -.5, .6, .35, 1.0], [2.5, 1.05, .1, .07, .02, 1]` |
| hbMidS | Small Midsection | 4 × 1.8 × 3.0 | 0 | 1.8 | 500 | 550 | 1 | −0.3 | `[-2, .9, -.9, 1.5, 1.45, 1.1], [2, …same]` |
| hbSternS | Small Stern | 3 × 1.8 × 3.0 | 0 | 1.4 | 400 | 450 | 1 | −0.3 | `[-1.5, .9, -.75, 1.4, 1.35, 1.5], [1.5, .9, -.9, 1.5, 1.45, 1.1]` |
| hbBowM | Patrol Bow (*built*) | 10 × 4.6 × 7 | 0.3 | 24 | 2,000 | 2,200 | 1 | −0.7 | (built) |
| hbMidM | Patrol Midsection (*built*) | 8 × 4.0 × 7 | 0 | 22 | 1,600 | 2,000 | 1 | −0.4 | (built) |
| hbSternM | Patrol Stern (*built*) | 6 × 4.0 × 7 | 0 | 15 | 1,200 | 1,500 | 1 | −0.4 | (built) |
| hbBowL | Corvette Bow | 22 × 7.2 × 11 | 0.6 | 130 | 4,000 | 7,000 | 2 | −1.8 | `[-11, 2.4, -3.6, 5.5, 5.35, 1.6], [-4, 2.6, -3.6, 5.3, 5.0, 1.5], [3, 2.85, -3.4, 4.3, 3.6, 1.3], [8, 3.2, -2.4, 2.4, 1.4, 1.1], [11, 3.6, -.6, .2, .05, 1]` |
| hbMidL | Corvette Midsection | 16 × 6 × 11 | 0 | 115 | 3,000 | 6,000 | 2 | −1.2 | `[-8, 3, -3, 5.5, 5.35, 1.6], [8, …same]` |
| hbSternL | Corvette Stern | 18 × 6 × 11 | 0 | 115 | 3,500 | 5,500 | 2 | −1.2 | `[-9, 3, -1.6, 5.2, 5.0, 3.0], [-3, 3, -2.8, 5.45, 5.3, 1.8], [9, 3, -3, 5.5, 5.35, 1.6]` (a flat run aft for waterjets) |
| hbBowX | Destroyer Bow | 34 × 13 × 16 | 0.5 | 1,050 | 6,000 | 22,000 | 3 | −1.0 | `[-17, 5.0, -6.0, 8.0, 7.8, 2.4], [-6, 5.3, -6.0, 7.7, 7.1, 2.1], [5, 5.8, -5.6, 6.0, 4.6, 1.7], [12, 6.2, -4.0, 3.6, 1.8, 1.4], [17, 6.5, -.5, .3, .05, 1]` (flared) |
| hbMidX | Destroyer Midsection | 24 × 11 × 16 | 0 | 1,300 | 3,000 | 20,000 | 3 | −0.5 | `[-12, 5.5, -5.5, 8.0, 7.8, 2.4], [12, …same]`; `armour.belt` (below) |
| hbSternX | Destroyer Stern | 26 × 11 × 16 | 0 | 850 | 4,000 | 17,000 | 3 | −0.5 | `[-13, 5.5, -3.0, 7.0, 6.6, 3.2], [-4, 5.5, -4.9, 7.9, 7.6, 2.6], [13, 5.5, -5.5, 8.0, 7.8, 2.4]` |

**One-piece hulls** (`cls: 'one'`; they join nothing; `ends` both `'closed'` unless said):

| Key | Name | w × h × depth | t | $ | hp | `wl` | Stations and fields | For |
|---|---|---|---|---|---|---|---|---|
| ribHull | RIB Hull | 9 × 1.6 × 3.2 | 2.2 | 1,200 | 500 | −0.3 | `[-4.5, .6, -.55, 1.6, 1.45, 1.0], [-1, .65, -.62, 1.6, 1.5, .9], [2, .7, -.45, 1.35, 1.1, .9], [3.8, .75, -.05, .75, .45, 1.0], [4.5, .8, .35, .15, .05, 1]`; `plane`, `tubes`, `k` 0.12, mat `grp`, breakSpeed 5 | the Zodiak; a deep-V glass-fibre hull with buoyancy tubes |
| lcHull | Landing Craft Hull | 12 × 2.8 × 3.4 | 6 | 2,500 | 2,500 | −0.7 | `[-6, 1.4, -1.2, 1.7, 1.7, 6], [-5, 1.4, -1.4, 1.7, 1.7, 6], [4.5, 1.4, -1.4, 1.7, 1.7, 6], [6, 1.4, -.6, 1.7, 1.7, 6]`; `ends.fore: 'ramp'`, `k` 0.3, `cw` 2.5, steel 6 mm | the Higgens; a flat box with a bow ramp that drops when she is beached (§6.5 note) |
| pontoon | Float | 6 × 0.9 × 0.9 | 0.25 | 400 | 300 | −0.1 | `[-3, .45, .15, .15, .12, 1], [-.6, .45, -.3, .42, .4, 1.4], [0, .45, -.42, .45, .44, 1.4], [.05, .45, -.32, .45, .44, 1.4], [2.3, .45, -.3, .43, .42, 1.4], [3, .45, .25, .1, .05, 1]`; `plane`, `step` 0.03, `k` 0.1, alu 2 mm, breakSpeed 4 | seaplanes (in pairs with symmetry), wingtip floats; floats 3 t |
| stepHull | Flying-boat Hull | 18 × 3.2 × 3.0 | 3.5 | 3,000 | 1,500 | −0.8 | `[-9, 1.0, .6, .3, .2, 1], [-5, 1.3, -.5, 1.1, .9, 1.2], [-1, 1.5, -1.3, 1.5, 1.45, 1.3], [-.95, 1.5, -1.05, 1.5, 1.45, 1.3], [5, 1.6, -1.1, 1.5, 1.45, 1.3], [8, 1.6, -.4, .9, .6, 1.2], [9, 1.6, .4, .2, .05, 1]`; `plane`, `step` −0.97, `k` 0.12, alu 3 mm, breakSpeed 5 | the Catalyna; a stepped planing hull for a flying boat (turned along a plane's nose, rot 1: its +x to the plane's +y, its +y to −x) |

**Hull armour** (`def.armour` on a hull; read by `Ship.hullMm`, §8.3): `{ mm, plate, deck, mat, belt }`. `plate`: the side and
bottom plating (mm); `deck`: the deck's (default `plate`); `mat`: `'steel'`, `'alu'` (0.34 of steel's weight per mm in
`massPerMm`), `'grp'` (glass fibre: no armour; a bullet through it makes a `HOLE.grp` 0.002 m² hole). **`belt`** (opt-in,
X midsections only in stock: `belt: { y: [-2.0, 2.0] }` in the part's frame, i.e. 1.5 m below to 2.5 m above her
waterline): the side band's thickness is the part's dialled `mm` (5 mm steps, `armour.dial: [12, 150]`; default 12 =
the plate); `massPerMm` for a belted hull: `7.85e-3 × 2 × w × (y1 − y0)` t per mm (both sides; `armourMassT` adds it), so
a 100 mm belt on a 24 m midsection weighs +33 t. Design rows carry the dial in their armour column as every gv part's
(`cleanMm`; RSS3 codes). Old parts never have `shull`, so nothing old moves.

### 6.2 Superstructure (`shSuper`, 10: 1 built)
`plated` outline prisms (the ground update's recipe; 2D = 3D = clash = hit), plating 6-12 mm steel unless said.

| Key | Name | w × h × depth | t | $ | hp | place | Fields and what it does |
|---|---|---|---|---|---|---|---|
| bridgeM | Wheelhouse (*built*) | 5 × 3 × 5 | 6 | 2,500 | 1,200 | deck | `control: 1`; crew driver, commander, gunner, radio |
| consoleS | Helm Console | 1.2 × 1.4 × 1.0 | 0.3 | 600 | 200 | deck | `control: 1`; crew driver, commander standing at it (exposed: any hit near them reaches them); for RIBs and small boats |
| bridgeL | Bridge | 10 × 7 × 12 | 120 | 4,000 | 6,000 | super | `control: 1`; two decks (pilot house over the operations room), raked windows; crew driver, commander, gunner, radio, 2 more `gunner`s (one per extra weapon station: §8.2 crew rule); steel 10 mm |
| deckhouseL | Deckhouse | 14 × 5 × 12 | 90 | 2,000 | 5,000 | super | a block of superstructure (quarters, stores): a base for masts, guns and funnels, a target that keeps hits off the hull; steel 8 mm |
| stealthHouse | Stealth Superstructure | 30 × 6 × 10 | 70 | 6,000 | 6,000 | super | faceted composite (`mat: 'composite'`); `control: 1`; crew driver, commander, gunner, radio; `stealth: 0.4` (a radar's reach on her × 0.6: §8.11; only the largest `stealth` aboard counts) |
| mastLattice | Lattice Mast | 3 × 14 × 3 | 8 | 800 | 900 | mast | a perch: radars on it see from its height (the horizon, §8.11); its top is a `mast` place |
| mastPole | Pole Mast | 0.6 × 6 × 0.6 | 0.6 | 200 | 200 | mast | a small boat's mast (radar, lights) |
| funnel | Funnel | 5 × 6 × 4 | 12 | 600 | 1,500 | super | `funnel: true`: smoke (built `Ship.fx`); broken, it smokes black and the engines give `0.85` of their power (the uptakes wrecked) |
| helipad | Helicopter Deck | 16 × 0.4 × 14 | 25 | 1,500 | 2,500 | deck | `deck: { hl: 7.5, hw: 6.5 }` (a moving deck: §4.8); a landing circle and lights in the art; must be clear above (§11.3 warning) |
| hangar | Helicopter Hangar | 12 × 6 × 10 | 60 | 1,500 | 3,500 | super | `hangar: true`: a helicopter lashed on a helipad of the same ship within 20 m of its door (its −x face) is repaired (`Armour.repairStep` rates) and rearmed (stores refilled) over 60 s; nothing else |

### 6.3 Propulsion (`shDrive`, 12: 3 built)

| Key | Name | w × h × depth | t | $ | hp | place | Fields and what it does |
|---|---|---|---|---|---|---|---|
| dieselS | Small Marine Diesel | 1.6 × 1.0 × 0.9 | 1.2 | 800 | 300 | inside | `engine: { kw: 300, fuel: 'diesel' }`, `inner`, `flush`, `module: 'engine'` |
| dieselM | Large Marine Diesel (*built*) | 3.5 × 2.2 × 1.8 | 7 | 2,500 | 600 | inside | `engine: { kw: 2000, fuel: 'diesel' }` |
| turbine | Gas Turbine | 8 × 3 × 3 | 22 | 4,000 | 2,500 | inside | `engine: { kw: 20000, fuel: 'turbine', spool: 15 }`, `module: 'engine'`; with a gearbox |
| outboard | Outboard Motor | 0.8 × 1.6 × 0.6 | 0.35 | 1,200 | 150 | stern | `engine: { kw: 165, fuel: 'petrol', spool: 2 }`, `screw: { D: 0.36, eta: 0.6 }`, `steer: 30`: its own engine and propeller, turns with the helm (§4.5); clamps on a transom, its propeller under the keel line |
| screwS | Small Propeller | 0.3 × 0.8 × 0.8 | 0.2 | 300 | 120 | stern | `screw: { D: 0.8, eta: 0.58 }` |
| screwM | Propeller (*built*) | 0.6 × 2.2 × 2.2 | 2.5 | 900 | 300 | stern | `screw: { D: 2.2, eta: 0.62 }` |
| screwL | Large Propeller | 1.2 × 4.5 × 4.5 | 18 | 2,500 | 1,200 | stern | `screw: { D: 4.5, eta: 0.68 }` (controllable pitch: full power astern too, `astern: 0.9`, read instead of `ASTERN`) |
| waterjet | Waterjet | 3 × 1.4 × 1.4 | 4 | 2,500 | 600 | stern | `jet: { D: 1.4, steer: 30, bucket: 0.5 }`: in the transom at the keel line; steers itself, reverses with its bucket (§4.5) |
| rudderM | Rudder (*built*) | 1.4 × 1.8 × 0.15 | 1 | 500 | 300 | stern | `foil: { kind: 'rudder', area: 0.8, ar: 1.3, n: 'z', max: 35, chord: 1.4, load: 300 }` |
| rudderL | Large Rudder | 4 × 5 × 0.5 | 12 | 1,500 | 1,500 | stern | `foil: { kind: 'rudder', area: 14, ar: 1.5, n: 'z', max: 35, chord: 4, load: 3000 }` |
| foilBow | Bow Hydrofoil | 2 × 3.6 × 6 | 4 | 3,000 | 500 | bow | `foil: { kind: 'foil', n: 'y', area: 7, ar: 5, chord: 1.2, inc: 2, y: -1.6, ride: true, load: 1500 }`: an inverted-T foil on a strut under the forefoot (`y`: the foil's own height in the part's frame: its point is there, not the part's middle) |
| foilAft | Main Hydrofoil | 2.4 × 3.6 × 12 | 9 | 5,000 | 900 | keel | `foil: { kind: 'foil', n: 'y', area: 15, ar: 6, chord: 1.6, inc: 2, y: -1.6, ride: true, intake: true, h: 1.6, load: 3500 }`: two struts and a span under her, aft of amidships; its pod is the waterjets' intake foilborne |

Foil sizing (the Pegazus, 200 t): all lift at take-off speed 15.4 m/s (30 kn) with `inc0 + lim` 8°: C_L ≈ 0.58 (ar 5-6) ×
q 121.5 kPa × 22 m² = 1.55 MN, under her 1.96 MN weight: she lifts at about 34 kn; at 48 kn cruise C_L ≈ 0.23 (≈ 3° of
incidence): inside the controller's ±6°. WP6 tunes `inc` and the take-off speed by the trial.

### 6.4 Naval weapons (`shArms`, 15)
Guns are the ground update's pattern: a ring (`tring`), a house on it (`place: 'ring'`, `control: 1`), the gun on the house's
front (`place: 'front'`, `aim`, `weapon: { kind: 'tgun' }`): so Aim, Arcade/Realistic, the gunner's sight, reloads, ammo
and crews all work unchanged. Naval shells are new `SHELLS` keys (§8.1).

| Key | Name | w × h × depth | t | $ | hp | place | Fields and what it does |
|---|---|---|---|---|---|---|---|
| nRingM | Naval Gun Ring | 3.4 × 0.3 × 3.4 | 3 | 1,200 | 1,500 | deck | `ring: { rate: 30, cap: 60, stab: 1 }`, `module: 'ring'`; on the centre line of a deck |
| nHouse127 | Gun House | 5 × 3 × 4.4 | 6 | 2,500 | 3,000 | ring | `control: 1`, faceted splinter shield (steel 12 mm), crew gunner, loader; mounts any naval gun |
| nGun57 | 57 mm Naval Gun | 0.5 × 4.6 × 0.7 | 3 | 3,500 | 600 | front | `weapon: { kind: 'tgun', cal: 57, reload: 0.27, ammo: 120, shells: ['he57n', 'hevt57n'], each: 4 }`, `aim: { el: [-10, 77], elRate: 40, pivot: 0.18, disp: 0.2 }` (220 a minute) |
| nGun76 | 76 mm Rapid Gun | 0.6 × 5.2 × 0.8 | 4.5 | 4,000 | 900 | front | `weapon: { kind: 'tgun', cal: 76, reload: 0.75, ammo: 80, shells: ['he76n', 'hevt76n'], each: 6 }`, `aim: { el: [-15, 85], elRate: 35, pivot: 0.18, disp: 0.25 }` (80 a minute) |
| nGun127 | 127 mm Naval Gun | 0.8 × 7.2 × 1.0 | 18 | 5,000 | 1,500 | front | `weapon: { kind: 'tgun', cal: 127, reload: 3, ammo: 20, shells: ['he127', 'sap127', 'hevt127'], each: 25 }`, `aim: { el: [-15, 65], elRate: 20, pivot: 0.18, disp: 0.3 }` (20 a minute; 20 ready, more from magazines: §8.1) |
| nGun152 | 152 mm Naval Gun | 1.0 × 8.5 × 1.2 | 30 | 6,000 | 2,000 | front | `weapon: { kind: 'tgun', cal: 152, reload: 6, ammo: 12, shells: ['he152n', 'sap152'], each: 45 }`, `aim: { el: [-10, 45], elRate: 12, pivot: 0.18, disp: 0.3 }` |
| ciws | Close-In Gun | 2.2 × 4.2 × 2.2 | 6 | 5,000 | 800 | deck | a self-contained mount (a dome over a six-barrel 20 mm): `ciws: { range: 1500, rate: 75, ammo: 1500, reload: 30, yaw: [-150, 150], el: [-25, 85], slew: 115, missiles: true, air: true, drones: true }`; fires by itself (§8.10); `module: 'breech'` |
| asm2 | Twin Anti-ship Missiles | 6 × 1.8 × 2.6 | 4 | 5,000 | 600 | deck | two canisters angled 15° up: `weapon: { kind: 'missile', asm: true, ammo: 2, range: 18000, speed: 260, seek: 'sea', dmg: 3000, blast: 12, he: 120, arm: 1 }` (§8.6); each canister a magazine (`MAG`) |
| asm4 | Quad Anti-ship Missiles | 6 × 2.4 × 4.6 | 8 | 9,000 | 900 | deck | the same, four |
| vls8 | Vertical Launcher | 3.2 × 2.4 × 3.2 | 14 | 9,000 | 1,500 | deck | eight cells flush in the deck (`inner`, its hatches on top): `weapon: { kind: 'missile', vls: true, ammo: 8, seek: 'radar', range: 12000, speed: 900, boost: 2, dmg: 900, blast: 8, prox: 8, missiles: true }`: SAMs that climb out and pitch over (`VLS`), guided by a fire-control radar aboard (§8.6); each cell a magazine |
| torpTube | Torpedo Tubes | 3.4 × 0.8 × 1.0 | 1.2 | 3,000 | 500 | edge | three lightweight torpedoes: `weapon: { kind: 'torp', ammo: 3, speed: 22, range: 8000, depth: 6, seek: 'active', cone: 30, acquire: 1500, dmg: 4000, blast: 12 }` (§8.5); `side: true`: fires outboard by its side (§8 correction) |
| nRadarAir | Air Search Radar | 4 × 1.2 × 1.2 | 2 | 3,000 | 400 | mast | `searchRadar: { range: 18000, rpm: 15, air: true }`: aircraft and missiles above `RADAR.lowAir` 100 m (§8.11) |
| nRadarFC | Fire-Control Radar | 1.2 × 1.2 × 1.2 | 1.2 | 3,000 | 300 | mast | `trackRadar: { range: 14000, cone: 0.5, missiles: true, sea: true }`, `aim` (it trains); guides VLS SAMs at aircraft and anti-ship missiles (S3) and ranges the guns on a ship (auto zero) |
| nRadarSea | Surface Search Radar | 2.4 × 0.6 × 0.6 | 0.8 | 2,000 | 250 | mast | `searchRadar: { range: 14000, rpm: 24, sea: true, low: true }`: ships, and anything under 100 m (sea-skimmers within 10 km, low helicopters) |
| decoy | Decoy Launcher | 1.2 × 1.0 × 1.0 | 0.8 | 1,500 | 200 | edge | `weapon: { kind: 'chaff', ammo: 12, flare: true, side: true }`: the countermeasure key fires a rocket pair of chaff (radar seekers) and flares (heat seekers) out to 300 m |

### 6.5 Ship kit (`shKit`, 6)

| Key | Name | w × h × depth | t | $ | hp | place | Fields and what it does |
|---|---|---|---|---|---|---|---|
| bulkhead | Watertight Bulkhead | 0.3 × 2 × 2 | 1.5 | 400 | 800 | inside | `bulkhead: true`: splits its host hull's compartment at its x (§3.3); drawn as its host's section there (2D) and a plate filling the section (3D); its own clash box is its nominal size |
| pump | Salvage Pump | 1.2 × 1.0 × 1.0 | 1 | 800 | 300 | inside | `pump: 0.15` m³/s, `module: 'engine'` (at 0 hp it stops): pumps the worst flooded compartment (§8.7) |
| ballast | Fuel and Ballast | 3 × 0.8 × 2.5 | 10 | 100 | 2,000 | inside | weight, low down: trims her and lowers her centre of gravity; inert |
| dcLocker | Damage Control Party | 2 × 2 × 2 | 1.5 | 1,500 | 300 | inside | crew `dc` × 4 (mods: `{ k: 'crew', role: 'dc' }`; `GV_ROLES` gains `'dc'`): a party that patches holes, fights fires and mends parts under way (§8.8) |
| magazine | Shell Magazine | 4 × 2.5 × 4 | 12 | 1,500 | 1,200 | inside | `module: 'ammo'`, `store: { rounds: 400 }`: feeds every naval gun aboard (§8.1); it can go up (§8.8) |
| torpDecoy | Torpedo Decoy | 1.5 × 0.6 × 0.6 | 0.4 | 1,000 | 150 | stern | `decoy: { torp: true, ammo: 4, life: 60, p: 0.6 }`: the countermeasure key, with a torpedo in the water within 3 km, streams a noisemaker astern; each homing torpedo within 1.5 km of it goes for it with p 0.6 (once) |

The existing `troopBay` (Crew & ammo) goes inside the landing craft: troops aboard a ship capture sea zones half as fast
again, as on land (gmode.js `TROOPS`). The landing craft's ramp (`ends.fore: 'ramp'`): the art drops it when she is
stopped with her bow on the bed (`v.landed` and her foremost ring aground), a picture only (no tank deck: §19).

---

## 7. The stock ships (nine templates: eight ships and a flying boat) — *re-derived*

The original §7 was lost (only its heading survived). These are rebuilt from the reports' summary (Zodiak RIB, Cyclon,
Higgens, Osca, Pegazus, Vizby, Olivar Perri, Arley Berk, the Catalyna flying boat; the destroyer about $120k) and the real
ships the altered names point to (comments only). Templates go in the ships block after `cyclon` (inside the one
`TEMPLATES` literal: test/lib/game.js reads it with a regex), each `kind: 'ship'` except the Catalyna (`kind: 'plane'`,
`group: 'ship'`: the hangar files her under Ships; `Builder` hangar grouping reads `t.group` first). 59 → 67 templates.
Every one: joined (one craft), no open ends, clash-free, priced within its battle tier, floats within ±0.3 m of her marks
(core.test `SHIPS`), placed by the builder's own taps where possible (`Ship.spotOf`, as the Cyclon's diesels were).

**Balance targets** (`ships.test.js` §trials, seeded, Calm for speed, Moderate for seakeeping): displacement ±10 %, top
speed ±12 %, turning circle (lengths across at full speed, hard over) in the band, roll beam-on in Moderate under the
limit, cost ±10 % (and within the tier). Paint: `SKINS` gain `navyGrey` (haze grey, `#8b939a`), `navyDark` (dark
blue-grey, `#5d666e`), `navySplinter` (a two-tone splinter camouflage), `patrolWhite` (white with a red band); hulls bake
them into their vertex colours (built `SKIN_GEO`).

| Key | Name (real, comments only) | Kind / class | L (m) | Disp. | Speed | Turn (L) | Roll ≤ | Cost | Battle tier |
|---|---|---|---|---|---|---|---|---|---|
| zodiak | Zodiak RIB (a 9 m RIB) | boat | 9 | 3.6 t | 40 kn | 2-4 | 15° | $6k | 45k |
| cyclon | Cyclon Patrol Boat (*Cyclone* class) *built, slice* | patrol | 32 | 116 t | 33 kn | 3-5 | 8° | $28k | 45k |
| higgens | Higgens Landing Craft (LCVP) | boat | 12 | 13 t | 12 kn | 2-4 | 10° | $12k | 45k |
| osca | Osca Missile Boat (*Osa*) | patrol | 40 | 210 t | 38 kn | 3-5 | 8° | $50k | 75k |
| pegazus | Pegazus Hydrofoil (*Pegasus*) | patrol | 40 | 200 t | 48 kn foilborne, 12 hullborne | 4-7 | 5° foilborne | $58k | 75k |
| vizby | Vizby Stealth Corvette (*Visby*) | escort | 72 | 650 t | 35 kn | 3-5 | 7° | $75k | 75k |
| olivar | Olivar Perri Frigate (*Oliver Hazard Perry*) | destroyer | 108 | 5,000 t | 29 kn | 4-6 | 5° | $103k | 120k |
| arley | Arley Berk Destroyer (*Arleigh Burke*) | destroyer | 156 | 8,000 t | 30 kn | 4-6 | 4° | $120k | 120k |
| catalyna | Catalyna Flying Boat (*PBY Catalina*) | plane (hull) | 18 | 12 t | lifts off ~85 kn (flaps), 185 kn top (§4.12) | — | — | $25k | 45k |

**What each carries** (parts by key; positions are WP5's, by taps where the builder can place them). Phase 2 finish: each
ship carries a gunner for every weapon station (§11.3): a `seatGunner` inside the hull where a tap puts it, one on the
Cyclon (her after MGs), one on the Zodiak, two on the Higgens (a console's crew are the coxswain and the captain). The
Higgens' troop bays stand forward in the well (trim 0.8° by the stern). Measured afloat: the Zodiak runs at 2.9° bow-up
in a calm sea (2/3 Savitsky's planing centre of pressure, §4.3), the Higgens 12.4 kn, the Pegazus 48.6 kn foilborne;
the hull-only drafts (builder ≈ flight): Osca 37 kn, Vizby 27 kn (spec 35: under), Olivar 25 kn (spec 29: under), Arley
30 kn.

- **zodiak** — `ribHull`; `consoleS` amidships; `outboard` ×2 on the transom (330 kW: she planes in 6 s, trims 3-6°);
  `mgHeavy` on the console's top (a gunner standing); paint `navyDark`. The fast, fragile scout: any gun shreds her, and
  she carries nothing that hurts a ship except, in the cross-kind spirit, a drone bay or a torpedo the player adds.
- **cyclon** (the slice, finished: re-baseline only her own keys) — the built hull, wheelhouse, diesels, screws and
  rudders; `ringS` + `ac30` on the foredeck (her 25 mm Bushmaster becomes the existing 30 mm), `ringS` + `mgHeavy` ×2 aft
  quarters; `mastPole` on the wheelhouse with `nRadarSea`; `dcLocker`; `bk` on her hulls (§4.3); paint `patrolWhite`.
  Existing guns only (as WP5's brief says), so she shows the cross-kind rule from the first slice.
- **higgens** — `lcHull`; `consoleS` aft; `dieselS` inside aft; `screwS`, `rudderM` under the stern; `troopBay` ×2
  inside (12 troops: she captures zones fast); `mgHeavy` ×2 on the console; paint `navyGrey`. She drops her ramp when
  beached (art).
- **osca** — M hull (stern, 3 mids, bow), `bridgeM`, `dieselM` ×3, `screwM` ×3, `rudderM` ×2; `asm2` ×2 aft, angled out
  each side (4 missiles); `ringS` + `ac30` fore and aft; `mastPole` + `nRadarSea` + `nRadarFC`; `decoy`; `magazine`;
  paint `navySplinter`.
- **pegazus** — M hull (stern, 3 mids, bow), `foilBow`, `foilAft`, `bridgeM`, `turbine` ×1 and `dieselS` ×2 (hullborne),
  `waterjet` ×1, `rudderM` ×2 (hullborne steering; foilborne she banks on her foils); `nRingM` + `nHouse127` + `nGun76`
  forward; `asm4` ×2 aft (8 missiles); `mastPole` + `nRadarSea` + `nRadarFC`; `decoy`; `magazine`; `ballast` ×1; paint
  `navyGrey`. Hullborne at 12 kn on her diesels' share; past 17 kn the foils fly her up; foilborne at 48 kn.
- **vizby** — L hull (stern, 2 mids, bow), `stealthHouse`, `turbine`, `dieselM` ×2, `waterjet` ×2; `nRingM` + `nHouse127`
  + `nGun57` forward; `asm4` ×2 inside the superstructure's aft end (on deck, hidden by the house: her stealth); `torpTube`
  ×2; `nRadarAir`, `nRadarSea`, `nRadarFC` on the house's top (no mast: stealth); `decoy` ×2; `helipad` aft; `magazine`;
  `dcLocker`; paint `navyDark`. Her `stealth` 0.4 shortens every radar's reach on her (§8.11).
- **olivar** — X hull (stern, 2 mids, bow), `bridgeL`, `deckhouseL` ×2, `mastLattice` ×2, `funnel`, `hangar` + `helipad`
  aft, `turbine` ×2, `screwL` ×1, `rudderL` ×1; `nRingM` + `nHouse127` + `nGun76` amidships on the deckhouse; `ciws` aft
  on the hangar; `vls8` ×2 forward (her single-arm launcher becomes cells); `asm4` ×1; `torpTube` ×2; `nRadarAir`,
  `nRadarSea`, `nRadarFC` ×2; `decoy` ×2; `magazine`; `dcLocker` ×2; `pump`; `bulkhead` ×2; paint `navyGrey`. A
  helicopter (the stock `dragonfly`) can land on her deck and is lashed (§4.8).
- **arley** — X hull (stern, 4 mids, bow), `bridgeL`, `deckhouseL` ×2, `mastLattice`, `funnel` ×2, `helipad` aft,
  `turbine` ×4, `screwL` ×2, `rudderL` ×2; `nRingM` + `nHouse127` + `nGun127` forward; `vls8` ×2 (one forward, one aft);
  `asm4` ×1 aft; `ciws` ×1; `torpTube` ×1; `nRadarAir`, `nRadarSea`, `nRadarFC` ×2; `decoy` ×2; `magazine` ×2;
  `dcLocker` ×1; `pump` ×2; `bulkhead` ×4; belt 12 mm (stock: none dialled); paint `navyGrey`. About $120k: the biggest
  thing in a 120k battle.
- **catalyna** — `stepHull` along her nose (rot 1); existing plane parts: a cockpit, a high straight wing on a pylon
  (a `wingStraightL` pair: Long Straight Wing), two `pontoon`s at the wingtips (z ± 0.42 of the span), two existing
  `propL` radial engines on the wing, a tail; an old air `torpedo` under the wing and two MGs (`gun` parts); paint `navyGrey`.
  On her old plane laws (§4.12): floats, runs up on the step, lifts off at about 85 kn with her flaps down; torpedo-bombs a ship (S7's
  aerial torpedo is the `torpTube` on an aircraft; hers is the old air torpedo, which with ships in play homes on them:
  §8.5).

**Hangar classes** (`shipClass(t)`: builder.js, WP7, from the template's hulls): boat (under 25 m), patrol (25-60 m),
escort (60-120 m and under 3,000 t), destroyer (the rest); the Ships group lists them by class, then cost; the
Catalyna last.

---

## 8. Combat, damage and sinking (ship.js §damage and §combat; WP8, WP9)

Everything here is gated: a hull part (`def.shull`), a hydro vessel (`v.sh`), a ship-update weapon (`w.asm`, `w.vls`,
`w.kind === 'torp'`, `def.ciws`, `SH.naval`), `Combat.S.sea` (a hydro vessel in play) or `Combat.S.pd` (a CIWS aboard
anything). Old play reaches none of it (§13, §14).

### 8.1 Naval guns and shells (WP9)
New `SHELLS` keys in armour.js (a `// ==== naval ====` block at the end of the table), each with `naval: true` and its own
`life` (s; `moveShell` and `Aim.shoot` already read `SH.life`). Drag coefficients `k` are low (streamlined, heavy shells):
a 127 mm round reaches about 20 km at 45° and spends about 60 s getting there.

| Key | Type / label | cal | v0 | k | kg | pen | dmg | he | blast | other | life |
|---|---|---|---|---|---|---|---|---|---|---|---|
| he57n | he HE | 57 | 1035 | 3.5e-5 | 2.4 | 0 | 150 | 9 | 2.5 | | 25 |
| hevt57n | hevt HE-VT | 57 | 1035 | 3.5e-5 | 2.4 | 0 | 110 | 8 | 5 | prox 6, arm 0.4 | 25 |
| he76n | he HE | 76 | 920 | 2.4e-5 | 6.3 | 0 | 260 | 16 | 3.5 | | 30 |
| hevt76n | hevt HE-VT | 76 | 920 | 2.4e-5 | 6.3 | 0 | 200 | 14 | 6 | prox 8, arm 0.6 | 30 |
| he127 | he HE | 127 | 810 | 1.4e-5 | 31 | 0 | 700 | 40 | 7 | | 60 |
| sap127 | aphe SAP | 127 | 810 | 1.4e-5 | 31 | 90 | 500 | — | — | burst 500, r 2.5 | 60 |
| hevt127 | hevt HE-VT | 127 | 810 | 1.4e-5 | 31 | 0 | 500 | 35 | 12 | prox 15, arm 1.0 | 60 |
| he152n | he HE | 152 | 850 | 1.1e-5 | 45 | 0 | 1000 | 60 | 9 | | 70 |
| sap152 | aphe SAP | 152 | 850 | 1.1e-5 | 45 | 130 | 700 | — | — | burst 800, r 3 | 70 |
| ciws20 | ap AP (CIWS) | 20 | 1100 | 6e-5 | 0.1 | 30 | 30 | — | — | tracer 5, `ciws` | 2 |

- **Range tables.** `Aim.rangeTable(def, body)` integrates to `SH.life` s for naval shells (on the body: at 1/20 scale the
  Earth's curvature drops a point 20 km off by 635 m, which the integration has for free); `Aim.solve` and `aimLift` use the
  table past 3 km for `SH.naval` shells (gated: every old shell's path is the old one; aim.test unchanged). Cached per def
  (§15: ≤ 30 ms once).
- **Long flights** run on `moveShell`'s cheap stepping beyond 1 km from any vessel (built `s.cheap`, `CHEAP_H`).
- **Ready rounds and magazines.** A naval gun's `ammo` is its ready rounds; with a whole `magazine` part aboard, an empty
  naval gun refills its ready rounds from the magazines' pool (`store.rounds`, each round any naval calibre) over
  `4 × reload` s. Without one, the ready rounds are all.
- **Splashes:** big columns (§5.4). **Recoil:** gv's gun kick, scaled by `kg × v0` (a 127 mm on a tank rocks it hard).

### 8.2 Aiming at sea; old weapons on ships (WP9)
- The aim mode (the tank's) is on for ships (*built*: flight.js `groundTick`). The camera's reach for a ship is built
  (render3d `aimDist`).
- **The 20 km ray.** ghud.js `aimUpdate`'s ray length (`best = 3000`) and the sight's zero ladder (`F.zero` 200-3000) become
  `GHUD.reach(v)`: `SHIP.AIM.ray` 20,000 m and a zero of `SHIP.AIM.zero` [100, 20000] (100 m steps to 3 km, 500 m beyond)
  for a sea kind or any craft carrying a naval gun (a TK-34 with a 127 mm gets the long ray); 3,000 for everything else
  (old play unchanged). Auto-ranging: a whole `nRadarFC` aboard is a laser rangefinder (`lrf(v)`), and the zero snaps to
  the surface contact under the crosshair.
- **Old turrets fire from a ship afloat (S8).** combat.js `turretStep`/`turretFire`'s "hold fire on the ground or water"
  (PR #37) stays for every old craft; a hydro vessel afloat is the exception (`&& !v.sh`): the rule is for aircraft sat on
  the ground or the water, never a ship.
- **Crews:** a gun house's gunner works its gun (existing crew rules); the Bridge's two extra gunners man a ship's other
  weapon stations (missile launchers, torpedo tubes) so a ship that loses her bridge loses them too.
- **AI aiming:** `Aim.stepAll`'s loop gains AI ships: `o.ai && (o.ai.ground || o.ai.sea)` (gated on `ai.sea`, §9).
- **Torpedo tubes and launchers** fire from the weapon list (`Combat.systems`) with the fire key while aiming; ASM and
  VLS launchers aim at the surface or air contact under the crosshair (§8.6).

### 8.3 Where hits land on a hull (WP8)
- `Ship.hullRay(p, A, B, H)`: the segment A → B (the part's own frame) against the hull's own triangles: a pure
  `shullTris(def)` (new, parts.js, cached per def) builds them from `shullOf(def).rings` (each pair of neighbouring rings:
  `K` quads of two triangles, the deck strip between the deck edges, the end caps: transom, stem, or nothing at an open
  joint) with a face code per triangle: **−6 deck** (the strip between the deck edges), **−7 side** (from the deck edge
  down to the lowest bilge point whose outward normal is more across than down), **−8 bottom** (the rest), **−9 open**
  (an unjoined joint end: no plate). parts3d's `shipHullGeo` builds its positions from the same `shullTris` (WP8 changes
  it to read them; the picture must not move: `builder-shapes.mjs`), so what is hit is what is drawn, exactly.
- Culling: only the slabs whose x span meets the segment's (a broadside shot: 1-2 slabs, ~60 triangle tests).
- Fills `H` as `prism` does: `t0`, `t1` (entry and exit along A → B), `edge` and `edge1` (the face codes), `n`, `n1`
  (outward normals), `u` (the entry's y in the part's frame: the belt test), `box = false`.
- armour.js: `recsOf` adds `sh: !!d.shull`; `test()` sends `r.sh` records to `Ship.hullRay(p, PA, PB, H)` after `ownR`
  (instead of `prism`); `faceMm(p, edge, u)` sends `edge <= -6` to `Ship.hullMm(p, edge, u)`: deck `A.deck ?? A.plate`;
  side: `p.mm ?? A.mm` inside `A.belt.y`, else `A.plate`; bottom `A.plate`; open 0; `mat: 'grp'` 0 (no armour: holes).
- After penetrating, a round goes on inside (`postPen`): the hull's insides are its `inner` parts (engines, magazines,
  pumps, crews) as a tank's; a kinetic round that misses them leaves through the far side (a second hole).
- Blasts: combat.js `explode`'s distance for a hull part is `Ship.hullDist(v, p, at)` (to its nearest triangle, 0
  inside) instead of `centre − max(w, h)/2` (which would put a 150 m hull "touching" any burst within 75 m): gated on
  `p.def.shull`.

### 8.4 Holes (WP8)
`p.holes = [{ x, y, z, a, t, fix }]` per hull part (part frame; `a` m²; `fix` 0..1 patched), at most `HOLE.max` 16 (a new
one past that merges into the nearest: areas add, `HOLE.cap` 20 m² a hole). Made by `Ship.addHoles(v, [[p, x, y, z, a], …])`
from: Armour's `apply` for hull parts (from the resolve result `R`: entry and exit points), `explode`'s hull path, the
torpedo and ASM hits, `impactSea`, `bump`, the magazine. Areas:
- a round through the plate (each side it goes through): `HOLE.kin`·π·(cal/2000)² (127 mm: 0.019 m²; 20 mm: 0.0005);
- high explosive bursting inside: + `HOLE.heIn`·blast² (127 mm HE: 0.20 m²; an ASM: 0.58);
- high explosive on or near the hull: `HOLE.he`·blast²·(1 − d/blast), × `HOLE.tamp` 3 when the burst is more than
  `tampD` 0.5 m under the water (127 mm HE on the plate: 0.98 m²; at the waterline under: 2.9);
- a bullet through glass fibre: `HOLE.grp` 0.002;
- **a drone's charge (S1):** its plate-wear share uses a fixed reference, never the part's own max hp: in armour.js
  `resolve`, `Combat.maxHp(D)` becomes `(D.ship ? SHIP.DRONE.ref : Combat.maxHp(D))` in both `dj.host` and `dj.np` lines
  (`SHIP.DRONE = { ref: 2000 }`: a patrol boat's midsection), plus a hole of `he·blast²` with the charge's own blast.
  Target bands (S2, §8.12): a Bumble needs 3-8 hits to sink a patrol boat, 40-120 a destroyer;
- **bombs under water (S4):** with `Combat.S.sea` and a hydro vessel within the bomb's blast + 20 m of where it meets the
  water, a bomb hitting the sea doesn't burst at the surface: it sinks on at 10 m/s for 0.5 s and bursts there (tamped:
  ×3 holes, the near miss that springs plates). combat.js `moveShot`'s bomb branch, gated so the old ranges never see it;
- open ends: permanent, the end ring's area below the deck (§3.3);
- a hull part at 0 hp: "holed through" (§8.9): `HOLE.cap` 20 m² at its waterline amidships.
Holes show as dark scorched decals on the hull (render3d's decals, WP12) and in the X-ray. Saved (`p.holes`), cleaned on
load (finite, in the part's box, `a` in (0, cap], at most `max`).

### 8.5 Torpedoes (WP9)
- **Ship torpedoes** (`weapon.kind: 'torp'`): `Ship.fireTorp(v, p, F)` (from Aim's `fire` / `Combat`'s weapon fire for
  that kind) puts a shot `{ k: 'stor', … }` in `Combat.S.shots`; combat.js `moveShot`: `if (s.k === 'stor') return
  Ship.torpStep(s, h, F)`. It leaves the tube along the tube's +y (trained outboard), runs `depth` 6 m down (reached in
  3 s), at `speed` 22 m/s, straight for 1 s; then, `seek: 'active'`, it looks ahead within `cone` 30° and `acquire`
  1,500 m for a hydro vessel afloat that isn't its owner's or an ally's, and homes at `TORP.turn` 6 °/s; it dies after
  `range` 8,000 m, or runs aground where the bed is shallower than `TORP.aground` 4 m (a burst at half power). Bubbles
  every `TORP.bubbles` s (§5.4).
- **The hit:** `Ship.torpHit`: its step's segment, under the water, against each hydro vessel's hull under the local
  waterline (`insideHull` at its points): an explosion at the hull (`Combat.explode` with `under: true`: holes ×3), blast
  12, dmg 4,000. Under the keel of a hull part of class M or smaller (within 3 m under its keel line), it breaks her back:
  the part is holed through and the vessel split there (as a magazine's break, §8.8).
- **On an aircraft (S7):** a `torpTube` on a craft in the air drops its torpedo: it falls as a bomb until it meets the
  water; entering faster than 70 m/s along its path or steeper than 45°, it breaks (a splash, a dud); otherwise it runs
  from there as above. **On land** (no water under the tube, or the tube more than 3 m above it on a craft that isn't
  airborne) it fires nothing (a toast: "Torpedo tubes need water under them"; the builder warns, §11.3).
- **The old air torpedo** (the `torpedo` part: `swim`): with `Combat.S.sea` it also homes on hostile hydro vessels afloat
  within 4,000 m (as it homes on the range's boats) and hits them through `Ship.torpHit(s, a, F)` (true: it hit). combat.js
  `swim`: target choice and the hit line gated on `S.sea`; the old range (no hydro vessel) is unchanged (combat.test).
- **Decoys:** `torpDecoy` (§6.5).
- **In a room:** a `stor` shot is sent as other shots are (`MP.sendShot`); a peer flies a copy for show; only the owner's
  copy hits, through `MP.sendHits` with `ho` holes rows (§10.4).

### 8.6 Anti-ship missiles and vertical-launch SAMs (WP9)
- **Anti-ship missiles** (`w.asm`): launched (Combat `launchMissile`) at the surface contact under the crosshair (or, if
  none, the nearest surface contact in a 60° arc ahead of the launcher: fire and forget). Its own flight
  (`Ship.asmStep(s, h, F)`, called first in `moveShot`'s missile branch for `s.asm`; Combat's hit tests stay): out of the
  canister it climbs to 30 m, then cruises at `ASM.skim` 8 m (new) over the waves (`Ship.wave` at its point × fade) at
  `speed` 260 m/s (the motor burns all the way; `range` 18 km: 70 s); lead pursuit in the horizontal plane (Combat's
  `guide`); at `ASM.term` 2,000 m from the target its radar seeker goes active and it drops to `ASM.termH` 3 m. Chaff
  decoys it at the existing `decoyed` odds (a radar seeker). It hits the hull: `he` 120 penetrates plating up to 120 mm and
  bursts inside (blast 12, dmg 3,000: holes 0.58 m² inside plus the burst's damage to what is in there), or bursts on a
  thicker belt.
- **Vertical-launch SAMs** (`w.vls`): out of the cell straight up (the cell's +y), climbing `VLS.t` 0.8 s, then pitching
  over at `VLS.rate` 60 °/s toward the target, then the ground update's radar SAM guidance (semi-active: a whole
  `nRadarFC` aboard tracking the target, `Aim.trackStep`), `prox` 8 m. **S3:** `trackRadar.missiles` lets `Aim.trackStep`
  lock an incoming missile (`Combat.S.shots` k `'missile'`, hostile, closing) as its target; the SAM's proximity burst
  kills a missile with p 0.7. The player locks with the existing radar-lock key; the AI fires at aircraft within 10 km and
  at missiles within 6 km homing on her or a ship of her side.
- Seen by radars: both are missiles to a sea radar (`low`) and to CIWS; an ASM skimming at 8 m is seen by an air radar
  only inside 4 km (the radar horizon over the waves: `seesSea` with the missile's height).

### 8.7 Flooding, pumps and the free surface (WP8)
`Ship.floodStep(v, dt, sim)`, `FLOOD.hz` 10 times a second from `Ship.frame` for every hydro vessel that isn't a ghost:
- **Inside level** of each compartment: the height of its flood plane (level in the world) whose clipped volume of its
  own rings is `W` (§4.2's routine: the same numbers that push her down).
- **Each hole** (and open end): its point in the world, the water outside there (the sea's level + the wave × fade), the
  level inside; through it flows `Q = FLOOD.cd·a·(1 − fix·0.9)·√(2g·Δ)` from the higher side to the lower, `Δ` measured
  above the hole (water inside above a hole above the sea runs out of it).
- **Downflooding:** a stretch of deck edge under the water for `downT` 2 s lets in water through `downA` 0.05 m² per m of
  it into the compartment under (hatches and vents: a ship settling past her deck goes quickly).
- **Broken boundaries:** a hull part holed through (0 hp) opens its joints: water flows between it and its joined
  neighbours through `FLOOD.leak` 1 m² (new) by their levels.
- **Pumps:** each hull part's `shull.pump` and each whole `pump` part's `0.15 × health` m³/s, all working the compartment
  damage control chooses (the fullest by share, unless `sh.dcPri` says fires), only while some engine still runs.
- `W` clamped to [0, V]; `p.water` keeps it on the hull part for saves. ≤ 0.02 ms a ship a call (§15).
- What she does about it is physics alone (§4.2): she lists to the flooded side, trims by the flooded end, settles.
  Target: a 1 m² hole 1 m under the waterline in the Olivar's midsection: she lists and settles and survives with her
  pumps; holes in three compartments: she sinks in under 300 s.

### 8.8 Fires, magazines and damage control (WP8)
- **Fires** (`FIRE`, `Ship.fireStep` at `FIRE.hz` 4): a burst inside a hull (HE, an ASM, a SAP round's burst) or a
  penetrating round into an engine, a magazine or fuel lights `p.fire` with odds `odds0 + odds1·(blast/9)`; a burning part
  loses `FIRE.hp` 4 hp/s and burns crews within 3 m (5 hp/s); each second a fire spreads to each part within 6 m with odds
  `spread` 0.02; black smoke rises from it (FX). Armour's own fire rule (out after 4 s stopped) doesn't apply to a hydro
  vessel's parts (`repairStep` skips `v.sh`'s fires: ship.js owns them).
- **Damage control** (`Ship.dcStep`, `DC`): each `dcLocker` is a party of four (`dc` crew; its strength the living
  members); a ship with none has one party of her bridge crew at half rate. A party walks to its job at 2 m/s along her
  length and, by `sh.dcPri` ('auto': flooding when a compartment is over a fifth full, else fires, else repairs; 'flood';
  'fire'): patches a hole at `DC.patch` 0.02 m²/s (at least `DC.minT` 15 s a hole; a patched hole still lets in a tenth),
  never in a compartment past `DC.full` 0.7 full; puts a fire out in `FIRE.dc` 20 s; mends broken parts at `DC.repair` ×
  Armour's `REPAIR_T` (under way: armour.js `repairStep`'s "stopped" rule is skipped for `v.sh`, whose repairs are
  ship.js's).
- **Magazines** (`Ship.magazine(v, sim, part)`, from armour.js `cookOff` for a hydro vessel's ammo modules: `magazine`
  parts, VLS cells, ASM canisters; and from a fire within `MAG.near` 6 m of one for `MAG.t` 5 s): a blast of
  `MAG.r0 + rounds·MAG.rk` m (a full magazine: 28 m) at it, holes of `MAG.hole` 6 m² in every compartment within it, and
  when its rounds are at least `MAG.brk` 100 (new; a magazine 400, a VLS module 8 × 20 = 160; an ASM canister 20 each:
  never) the hull part it sits in or on is destroyed: removed, `splitComponents` makes two hydro pieces, each with an open
  end, both doomed `'magazine'`: she breaks in two and each half sinks on its own.

### 8.9 Hull damage, doom and wrecks (WP8)
- **A hull part at 0 hp** is holed through, never blown off: combat.js `destroyPart`'s first lines (beside the inner-radar
  rule): `if (p.def.shull && v.sh) { Ship.holedThrough(v, p, cause, sim); return; }`: `broken` kept, a 20 m² hole at its
  waterline amidships, its joints opened (`leak`). Only a magazine (§8.8), a back-breaking torpedo (§8.5) or a grounding
  past `IMPACT.remove` (§4.8) removes one.
- **Fate** (`Ship.fateStep`, `FATE.hz` 4, the player's ship and every AI ship): **capsized** — `|heel|` past
  `FATE.capsize` 60° for `capsizeT` 4 s; **sunk (foundering)** — her weight and water past `reserve` 0.97 of the intact
  hull's whole buoyancy, or her highest deck `deckUnder` 1 m under; **out of action** — no `driver` left alive aboard
  (`Armour.has(v, 'driver')`) or no control part whole; **magazine** (§8.8). `Ship.doom(v, sim, why, by)`: `v.fate = why`
  (flight.js `SHIP_FATES` words, built), `v.doomed = sim.time`, credit to `by` (`v.lastHitBy`: `Combat.byMe` decides the
  player's kill), the kill toast and the banner (Death's HUD); an AI ship stops fighting; the player's end screen goes
  through `Flight.afterFall` and waits until she is sunk or `FATE.wait` 15 s. A capsized or out-of-action ship is scuttled
  (`scuttleA` 1 m² at the keel of every compartment after `scuttleT` 60 s) so she goes down within a few minutes.
- **Sunk** (her top `under` 3 m under, or `bedT` 10 s on the bed): on a bed shallower than `wreckDepth` 40 m she is a
  wreck (`v.wreck`, frozen `kin`, death.js's wreck list: five minutes, eight standing, shared in rooms by `down.w`); deeper,
  removed once her highest point is `gone` 40 m down (the renderer draws her going down).
- **Derelicts:** a hydro vessel afloat with nobody at a control part for `derelictT` 120 s (a piece, an abandoned ship)
  is holed `derelictA` 0.5 m² a compartment and sinks.
- **A ground vehicle knocked out in deep water** (the case the sea fix left): death.js `swamp` returns early for `o.ko`;
  now a knocked-out non-hydro ground vehicle whose wreck stands in water deeper than it is tall goes under after
  `SEA.swamp` s like any other (`goUnder(o, F, w, 'wreck')`), and its wreck record leaves the wreck list (every screen
  runs the same rule from the shared wreck's place and the terrain: no message). A hydro ground vehicle (a tank with a
  hull) knocked out is doomed `'action'` and sinks by physics (never a wreck frozen on the water). Gated on water deeper
  than the vehicle: every old test path (wrecks on land, `death.test` A7/B3) is unchanged; ground.test checks.
- **Hit ticks (S6):** combat.js `damage`'s `Death.hit` gate gains `|| isSea(v.kind)`.

### 8.10 CIWS (WP9)
`Ship.ciwsStep(F, dt)` from `Combat.frame` while `Combat.S.pd` (new: any live vessel with `v.ciws.length`, set beside
`S.sea`), for each vessel with CIWS parts (any kind: a tank with one defends itself; the player's only while
`sh.ciwsOn`, or always for a non-ship craft with no helm), each whole `ciws` part:
- **Targets:** the threat with the least time to reach her among hostile missiles (`Combat.S.shots` k `'missile'`, closing,
  heading within `CIWS.cone` 30° of her), aircraft (`air`), drones (`drones`), within `range` 1,500 m and in the mount's
  arcs. **Never the low-and-slow notch rule (S5):** a hovering helicopter, a slow drone and a sea-skimmer are all seen.
- **Firing:** the mount slews at `slew` 115 °/s within `yaw`/`el`; within `CIWS.on` 1° of the lead point it fires `burst`
  1 s bursts: a simulated round every 1/15 s carrying `n` 5 (`k: 'shell'`, `sh: 'ciws20'`, `ciws: 5`), dispersion
  `CIWS.disp` 2 mrad, every third drawn as a streak tracer. armour.js `moveShell` (one line, gated on `s.ciws`):
  `if (s.ciws && Ship.shotMissiles(s, a, e, F)) return false;`: a missile within `CIWS.kill` 2.5 m of the round's segment
  is killed with p `1 − (1 − CIWS.p)^n` (0.88); aircraft and drones are hit by the round as by any shell. `ammo` 1,500,
  `reload` 30 s when empty.
- Expected: one CIWS against one subsonic ASM kills it 65-95 % of the time (ships.test, 100 seeded engagements); two at
  once, about half each.
- In a room, a CIWS kill of another player's missile is an `mkill` to its owner (§10.4).

### 8.11 Seeing ships (WP9)
- **Surface, never air.** A hydro vessel afloat (`v.sh && v.afloat`) and a ghost of a sea kind (or a ghost carrying the
  `afloat` flag of its snapshot, §10.4) is a surface contact: combat.js `candidates` (out of the air list; in the ground
  list, for `seek: 'ground'`, `'sea'`, IR, TV and anti-radar missiles: a ship's radar is an emitter), radar.js (the
  aircraft radar's contact lists: `!isSea(g.kind) && !(g.sh && g.afloat)`; **no magic radar:** an aircraft's radar part
  never sees a ship: eyes and the missiles' own seekers do), drone.js `lockable` (ships yes), aim.js search and track
  (sea radars: `searchRadar.sea`, `trackRadar.sea`), the ground AI's targets (a ship in reach is a target: S9's mirror).
  A flying boat in the air is an aircraft; on the water, a surface contact.
- **The horizon:** `Ship.seesSea(a, b)`: within `√(2R·ha) + √(2R·hb)` (R the body's radius; ha the eye's height over the
  water: a radar part's top, the bridge's; hb the target's highest point), and no land in the way (sampled every
  `LOS.step` 200 m within `LOS.land` 3 km of land: a per-`LOS.cell` 500 m land mask built once per map), and no smoke
  (`Aim.smokeBlocks`). Two 20 m masts: about 7 km.
- **Radar reach:** `Ship.rcs(v)` = `clamp((L_wl / RADAR.rcsL)^rcsExp, rcsMin, 1) × (1 − stealth)` (a destroyer the full
  reach, a RIB 0.4, the Vizby × 0.6).
- **`Ship.surface(v, F)`:** v's sea radars' contacts (hydro vessels and sea-kind ghosts within radar range × rcs and
  `seesSea`; with `low`, anything under `RADAR.lowAir` 100 m within 10 km: sea-skimmers, helicopters), four times a second;
  GHUD's radar scope and minimap show them (built for the ground radars).
- **Eyes:** `EYES.day` 8 km (`night` 3 km) within the horizon: spotting (GHUD's, and `seen`/`spot` in rooms) takes ships.

### 8.12 Weapons against ships, ships against everything (§20; WP8, WP9, WP14)
The owner's rule (§20): every kind can destroy every kind. The damage targets (S2) the tests hold (`ships.test` §combat
seeded; `matrix.test` reach and effort), as hits to sink or put out of action, seeded, Moderate sea:

| Weapon (carried by) | Zodiak (RIB) | Cyclon (patrol) | Vizby (corvette) | Arley (destroyer) |
|---|---|---|---|---|
| 12.7 mm MG (car, heli, ship) | 30-80 rounds | out of action 200-600 (bridge crew); never sinks her (pumps keep up) | almost harmless | almost harmless |
| 30 mm cannon (IFV, ship) | 5-15 | out of action 40-120, sunk 300+ | 400+ | almost harmless |
| tank 120 mm APFSDS | 1-2 | sunk 20-60 | 80+ | out of action 20-40 (bridge, guns), sunk 300+ |
| tank 120 mm HE | 1 | 4-10 | 15-30 | 40-100 |
| naval 127 mm HE/SAP | 1 | 3-6 | 8-15 | 15-40 |
| anti-ship missile | 1 | 1 | 1-2 | 3-5 |
| torpedo (ship's or the old air one) | 1 | 1 | 1 | 1-2 |
| 500 lb bomb: direct / 5 m near miss | 1 / 1 | 1 / 1-2 | 2 / 3-4 | 3-5 / 6-10 |
| air rockets | 1 | 6-15 | 20-40 | 60+ |
| drone charge (a Bumble, S1) | 1 | 3-8 | 15-35 | 40-120 |
| ramming at 15 kn by a Cyclon | 1 | 2-3 | holes only | holes only |

And the other way (ships against everything): a naval 127 mm HE knocks out a tank on the shore in 1-3 hits (S9: the AI
engages shore targets in gun range); `hevt` proximity rounds bring down a plane in 10-30 rounds within 5 km; CIWS shreds
drones, helicopters and missiles; VLS SAMs reach aircraft at 12 km; a gun hits a rocket on its pad. Folded decisions:
**S1** (fixed reference for drone charges), **S2** (this table), **S3** (SAMs shoot missiles), **S4** (bombs under
water), **S5** (CIWS never notches), **S6** (hit ticks), **S7** (aerial torpedoes; none on land), **S8** (old turrets
fire afloat), **S9** (the naval AI engages shore targets), **S10** (ship ghosts collide: §4.8). The old-kind fixes
**O1**, **O3**, **O5** are WP14's (§16).

**Correction to §6.4 (aimed parts and the z axis).** A part's rotation is a quarter turn in the blueprint's plane, so no
part can point its own +y across the ship (±z). Torpedo tubes and decoy launchers therefore fire *outboard by their
place*: `weapon.side: true` launches along +z or −z by the sign of the part's own z (on the centre line: forward), level
for tubes, 45° up for decoys. ASM canisters fire along +y at rot 3 (forward), 15° up.

---

## 9. AI, the Naval Range and the Naval Practice battle (ship.js §ai; WP10)

### 9.1 The computer's ships
Real Vessels from the stock templates (the same parts, hulls, flooding and hits as anyone's) on the real physics (never
`kin`, unlike the ground AI), marked `v.ai = { sea: true, team, role, skill, state, tgt, … }` and `ai.sea` (the gate).
They are stepped out to `SHIP.aiNear` 12 km (built `stepsNear`) with the physics' LOD (built).
- **The helm** is the player's interface (§4.6): `sh.tel` and a heading order (`sh.hold`, `man = false`, `ctl.h` 0).
- **Thinking** (`AI.think` 4 a second, ≤ 0.1 ms a ship): its target, where to go, what to fire.
- **Land and shallows** (`AI.look` 1 a second): probes `AI.ahead` [1, 2, 3] × max(`aheadMin` 300 m, V·`aheadT` 25 s / 3)
  along her heading and on a fan at ±`fan` [30, 60]° (9 `heightAt` a second): any probe in water shallower than her draft
  + 3 m (or land) turns her to the clearest fan direction; she keeps `avoid` 500 m from shores and from other ships not in
  her column (`column` 600 m between ships of a side steaming together).
- **Targets:** hostile hydro vessels afloat and sea-kind ghosts she sees (`Ship.surface`, eyes, `seesSea`), hostile
  aircraft within her AA reach, and **shore targets (S9)**: hostile ground vehicles within her guns' reach that she sees.
- **Range keeping:** she holds the target between `gunK` [0.5, 0.8] × the lesser of her main gun's reach and what she can
  see, closing at Full, turning to open her arcs (broadside for a ship with guns fore and aft) at Half.
- **Gunnery:** aims through Aim as the ground AI does (`v.aimP`, `v.aimFire`; `Aim.stepAll`'s AI loop takes `ai.sea`): the
  lead from the target's velocity and the range table's time of flight, an error of `err` [0.003, 0.001] rad by skill
  (worst to best), and after each salvo `walk` 0.3 of the observed miss corrected (fall of shot: the splash against the
  target), so a skilled ship straddles in two or three salvos. WP10 factors `GroundAI.aimAt(v, target, F)` out of
  groundai.js into a shared helper with **no behaviour change** (groundcombat.json identical) and both AIs call it.
- **Missiles and torpedoes:** SAMs at aircraft within `missile` [8000, 12000] m by skill and at missiles within 6 km homing
  on her or her side; ASMs at ships within `asm` [3000, 12000] m, every `asmEvery` 20 s (two at once at the best skill);
  torpedoes within `torpR` 3,000 m, `torpN` 2 in a spread of ±`torpSpread` 4°, every `torpEvery` 60 s.
- **Evasion:** under fire (hit, or a splash within 100 m in the last 10 s) she zigzags ±`zig` 30° every `zigT` 20 s; a
  torpedo seen within 3 km: she turns to comb its track and rings Flank; a missile homing: decoys, CIWS (always on).
- **Retreat** under `retreat` 0.5 of her reserve buoyancy or of her crew: away at Flank, smoke.
- `Ship.aiDown(v, F)`: an AI ship doomed: the kill's credit, banner and toast, the range's or the battle's bookkeeping.
- Nothing of this runs in a room (as the ground AI).

### 9.2 The Naval Range
`EARTH.navalRange = { e: 9000, z: 0, r: 9000, spot: 'slipway' }` (space.js): the sea east of the islands (40-250 m deep,
probed). It is on with Settings → Targets at Practice or Hostile (the Tank Range's and the target range's setting), the
player's craft a sea kind (or any hydro vessel afloat) within `r` + 6 km of its middle, no room, no battle; `Ship.range(F)`
from `Ship.frame` (its checks once a second). The old range targets round (8000, 0) (boats, the frigate, the AA sites)
stay as they are, alongside.
- **Practice:** targets that never fire: a moored hulk (an unmanned `cyclon`, `passive`) 2 km out from the slipway; a
  `cyclon` and an `osca` steaming a 3 km loop at 12 and 18 kn; an `olivar` steaming a 6 km loop at 15 kn further east.
  One sunk or out of action comes back 60 s later at its loop's far point.
- **Hostile:** waves from the east (from e 16,000, heading west), 30 s apart: wave 1 two `cyclon`s (skill 0.2); 2 an
  `osca` and a `cyclon`; 3 a `vizby` and an `osca`; 4 an `olivar` and a `vizby`; 5 and on an `arley` and an `olivar`,
  one more ship each wave to four, skill rising 0.1 a wave to 0.9. From wave 2, a strike aircraft every `STRIKE.every`
  180 s, `max` 2 at once: the stock `striker` flown by `Ship.flyStriker(v, F, dt)`: in at `alt` 300 m, down to `low` 60 m
  for the last `lowR` 3 km, its bombs released `rel` 800 m out (it leads the ship), away and round again; shot down, the
  next comes in its time.
- **The bar** (GroundAI's style): "Naval Range · Hostile · wave 3 · 2 ships left".

### 9.3 The Naval Practice battle
`Ship.practice(opts)`: you and two computer ships against three on the **Shetland Sound** arena (§10.2), the Naval
Battle's rules (GroundMode run here, its objective in `Ship.battle.obj`), the respawn panel shared with the Practice
Battle's (mpui.js). The money tier picks the ships from `NAVAL_STOCK` (gmode.js, beside `GROUND_STOCK`):
`{ 45000: ['cyclon', 'osca', 'zodiak'], 75000: ['vizby', 'pegazus', 'osca'], 120000: ['arley', 'olivar', 'vizby'], fallback: 'cyclon' }`.
Allies steam in column with you and take zones; enemies the same. mpui.js: a **Naval practice** button beside Practice
(`#mp-practice-naval`), disabled without the Earth map (the Sound needs it).

---

## 10. Multiplayer and the Naval Battle (mp.js, mpui.js, net.js, gmode.js; WP11)

### 10.1 The mode
`settings.game: 'naval'` (`MP_SET_OK.game` gains `'naval'`); `MP.naval` (new getter: `pvp && settings.game ===
'naval'`); `MP.ground` stays false in a naval battle (Highland Ridge's props and the gv gates it opens stay shut).
Settings as a ground battle's: format 1v1/2v2/3v3 (no ffa), budget [45k, 75k, 120k], tickets, respawn, limit, `air`
(aircraft may join: planes, helicopters, drones). New: `settings.sea` (`'calm' | 'moderate' | 'rough'`, default
`'moderate'`; also in sandbox rooms). `#mp-create-naval` (index.html) beside the other create buttons; the lobby's
mode line; without the Earth map a naval battle can't be made (the button says why).

### 10.2 The Shetland Sound arena (space.js `EARTH.arenas.sound`)
The water between Shetland (north, z under 2,000) and the north of Scotland (south, z over 7,500), 15-35 m deep
(probed at 500 m; the wave fade is full past 25 m):
```js
sound: { name: 'Shetland Sound', sea: true, map: true, kinds: ['ship'], box: { e0: 15500, e1: 24000, z0: 2500, z1: 7000 },
  pads: [{ name: 'West', e: 16200, z: 4600, yaw: 0, hl: 150, hw: 400 }, { name: 'East', e: 23300, z: 4600, yaw: Math.PI, hl: 150, hw: 400 }],
  zones: [{ id: 'A', name: 'West Narrows', e: 18200, z: 3800, r: 350 }, { id: 'B', name: 'East Narrows', e: 21400, z: 3800, r: 350 },
    { id: 'C', name: 'Mid-Sound', e: 19800, z: 5000, r: 350, rDuel: 450 }],
  air: [{ e: 15000, z: 4600, yaw: 0, air: { alt: 1000, speed: 140 } }, { e: 24800, z: 4600, yaw: Math.PI, air: { alt: 1000, speed: 140 } }],
  berms: [] },
```
Teams start 7 km apart (out of each other's sight: the horizon), at either end. `sea: true` arenas level no ground, build
no props and no arena mesh (`clear`, `map` checks in ghud.js and render3d skip `sea`); spawns.test checks every zone and
start is deeper than the deepest stock draft + 2 m.

### 10.3 Placement and capture (gmode.js)
- `GroundMode.placement(arenaId, team, slot, kind)`: on a `sea` arena, kind `'ship'`: abreast across the pad at 120 m
  (`abreast(k) × 120` along the pad's across axis), a second row 250 m astern for slots past 6; `{ e, z, yaw }` and
  Flight.start's `Ship.launch` floats her (built). Aircraft from `air` (built rule); helicopters and drones in the air 300 m
  over their side's start.
- **Capture:** `capturer(u, GK)` takes the arena's `kinds` when it has them (the Sound: `['ship']`, afloat), else the
  ground kinds as now; `CAP_SPEED` 30 m/s stays. gmode.test: `'boat'` still doesn't capture; a ship does in the Sound.
- `GroundMode.pickNaval(mapReady)` → `'sound'` | null. Tickets, deaths (a ship's cost), the result: GroundMode's own.

### 10.4 Messages (`NET_VERSION` 13 → 14: an older peer would turn a ship into a plane)
Every new field is cleaned; peers are untrusted; no peer text in `innerHTML`.
- **Spawn rows:** no new column (kind `'ship'`, the ship parts, their armour column: `cleanMm`).
- **Snapshots:** a ship's `sh: [tel, rud]` (`Ship.snap`: the ghost's screws and rudders) and `af: 1` when afloat (the
  classification, §8.11); the host's snapshots carry `st` (its sea clock, §5.4). Cleaned: tel an integer −3…4, rud finite
  within ±40, st finite.
- **Ghosts:** a ship ghost is a Vessel from its spawn rows, so `v.hydro` and `v.sh` (its hull for `bump` and `hullRay`,
  its decks in `Ship.D`: a helicopter can land on a teammate's ship); it never runs the hydro physics (`Ship.forces` skips
  `v.remote`); `Ship.ghost(g)`, `Ship.unsnap(g, m)`.
- **Hits:** `hit` gains `ho: [[partIndex, x, y, z, a], …]`, the holes our shots made in the target's hull parts (part
  frame); `Ship.cleanHoles(rows, v)` on the owner's side: our own hull parts only, finite, inside the part's box + 1 m,
  `a` in (0, 20], at most 16 rows a message. The owner applies damage and holes; flooding, fires and fate are the owner's.
- **`mkill` `{ pid, id }`:** our CIWS or SAM killed peer `pid`'s missile `id`. The owner ends it (`netMissileEnd`) only if
  one of the sender's vessels is within 3 km of where the missile was; at most 10 a second from a peer.
- **Shots:** `shot` with k `'stor'` (a ship torpedo: its place, heading, depth, seek): cleaned as other shots; peers swim a
  copy for show that never hits.
- **`down.sea` `{ why, at }`** (`Ship.downSea`, `Ship.onDownSea`): why one of `SHIP_FATES`' keys, at her pose; the owner
  keeps sending snapshots of a sinking ship until she is gone or 60 s, so peers see her go down; a shallow wreck joins
  `wrecks` (built for ground wrecks).
- **Settings:** `game: 'naval'`, `sea` through `MP_SET_OK`.
- The NET_VERSION comment gains: "14: the ships update: ships (kind `ship`), their parts and paints (an older peer would
  drop them or make a plane of them), holes on hits (`ho`), missiles killed by point defence (`mkill`), ship torpedoes
  (`stor`), a ship's fate (`down.sea`), naval battles (`game: 'naval'`, the Sound) and the room's sea (`sea`, `st`)".

### 10.5 Saving and loading (WP8 with WP11's cleaning rules)
`Vessel.serialize`/`restore` (and `gvLoad`): per part `holes`, `water`, `rud`, `fire`; per vessel `sh: { tel, dcPri,
ciwsOn }`, `fate`, `hydroFrom`, a lashed craft's deck part id. Restore cleans: `tel` integer −3…4, `dcPri` one of three,
`ciwsOn` boolean, holes as `cleanHoles`, `water` finite in [0, V], `fate` one of the four or none.

### 10.6 Old play
`mp-air.json` identical; a ground battle (`groundcombat.json`, mp.test's ground traces) identical; `net.test` unchanged; a
new `baseline/mp-naval.json` (two ships, a shell exchange with holes, a torpedo, a CIWS kill, a sinking `down`).

---

## 11. The builder (builder.js, ship.js §builder; WP4 built the basics, WP7 completes)

### 11.1 Built (WP4, WP0)
The kind (`KIND_TAB.ship`, `pickKind`, `setKind`), symmetry across (`mirrorOf`, `symKey` `rss.symmetryShip`), turning
(`turnGroups`), `zText`, guns at rot 3 (`defaultRot`), the zoom floor 1.2 px/m (`zoomMin`: a 152 m hull fits 360 px),
`keepInView`, the stat rows (displacement, draught, stability, top speed in knots: `renderShipStats`), `shipLine`
(freeboard, compartments, power, turning), the warnings' dispatch (`Ship.warnings` first, no rocket staging words), the
blue waterline in 2D (`drawWaterline`) and 3D, tap placement for `keel`, `deck`, `inside`, and `stern` screws and rudders
(`Ship.spotOf`), the hangar's Ships group, `PART_ERAS` Boats/Escorts/Destroyers/Naval.

### 11.2 Placement for every place (WP7: `Ship.spotOf`, ship.js §builder)
Pure, on an empty, a hulled and a full design (ships-builder.test); `at` the view's middle; `sym` pairs off the centre
line. Returns a pose, `{ why }` or null, as built.
- **keel** (built) and **one-piece hulls:** on an empty design at the origin; beside another one-piece hull with symmetry
  on: a pair off the centre line at ±(the first hull's half-beam + its own + 0.5 m) (a catamaran, pontoons).
- **deck** (built) refined by part: `helipad` the aftmost clear stretch of deck; `nRingM` the foremost clear spot on the
  centre line ahead of the superstructure (then the aftmost behind it); `vls8` ahead of the superstructure then aft,
  flush (its top at the deck line); `ciws` on the centre line on top of the aftmost superstructure, else the deck aft;
  `asm2`/`asm4` aft of the superstructure, a pair at ±(beam/2 − its depth/2) with symmetry; `consoleS` amidships aft of
  the middle; `torpDecoy` the stern's deck.
- **super:** `bridgeL`, `stealthHouse` with their front 30-40 % of her length from the bow; `deckhouseL` just behind the
  last superstructure; `funnel` on top of a deckhouse, else on deck amidships; `hangar` just ahead of a helipad. When the
  deck is full there, on top of the superstructure below the view's middle (its top face).
- **mast:** a mast on top of the highest superstructure, on the centre line; a radar on the highest free mast top, else
  on the highest superstructure top.
- **inside** (built) refined: `magazine` low, under the nearest gun ring; `pump` in the largest compartment; `dcLocker`
  amidships; `ballast` lowest; `bulkhead` at the middle x of the compartment under the view's middle (spanning its
  section); `troopBay` as any inside part.
- **stern** (built) plus `outboard` on the transom's aft face (its propeller under the keel line; a pair at ±0.5 m with
  symmetry), `waterjet` in the transom at the keel line (one on the centre line, a pair at ±beam/4).
- **bow:** `foilBow` under the forefoot, at the bow's foremost fifth, its top at the keel there.
- **keel** for `foilAft`: under the hull 10 % of her length aft of the centre of gravity, its top at the keel there.
- **edge:** `torpTube`, `decoy` at the deck edge (z at ±(half-beam − its depth/2)), aft of the superstructure, a pair
  with symmetry (they fire outboard by their side: §8 correction).
- **ring**, **front**, **top** (the ground update's): their own rules, unchanged.

### 11.3 Warnings (WP7 completes `Ship.warnings`)
Built: no hull, sinks, overloaded, open ends, top-heavy/low GM, list, trim, no screw, no engine, dry screw, no rudder, dry
rudder. Added (red: she won't work; amber: a hint):
- red: torpedo tubes on a design with no hull and no wings: "Torpedo tubes need water under them: put them on a ship (or a
  plane, to drop them)".
- red: a `vls8` with no `nRadarFC`: "The vertical launcher's missiles need a Fire-Control Radar aboard".
- red: something on the helicopter deck (any part's box within 4 m over it): "Something stands on the helicopter deck".
- red: hydrofoils that can't lift her (their lift at 40 kn at `inc0 + RIDE.lim` under her weight): "Her foils can't lift
  her: she'll never fly on them".
- red: a bulkhead outside every hull: "A bulkhead only works inside a hull segment".
- amber: a gun whose swept arcs (`Aim.limits`) are blocked over more than 270° by superstructure: "The forward gun can only
  fire over 80°: raise it or move the superstructure".
- amber: more weapon stations (gun houses, launchers, tubes) than gunners aboard: "4 weapon stations, 2 gunners: only two
  fire at once".
- amber: a radar lower than a funnel's top within 10 m: "The radar sits below the funnel: smoke blinds it aft".
- amber: an ASM launcher with no `nRadarSea`: "Anti-ship missiles need a target: a Surface Search Radar finds one past your
  eyes".
- amber: a magazine above the waterline: "A magazine above the waterline goes up more easily" (Phase 2: wholly above it,
  its bottom over the water: a 2.5 m magazine can't sit lower than half under in a patrol boat drawing 1.3 m).
- amber: over 500 t with no pump and no damage control party: "No pumps or damage control: one hole could sink her".

### 11.4 Cards, tray lines, X-ray, hangar (WP7)
- `Ship.specs(def)` (the part card's lines) and `Ship.line(def)` (the tray's one line), speeds in knots: a hull segment
  "Floats up to 868 t of ship · draws 1.6 m at her marks · one watertight compartment, 8 m"; an engine "2,000 kW";
  a screw "about 120 kN at 15 kn on 2 MW"; a waterjet; a rudder "turns 35° · 0.8 m²"; a foil "lifts 160 t at 40 kn"; a
  gun "127 mm · 20 a minute · reaches 20 km"; an ASM "18 km · skims at 8 m"; a VLS "8 SAMs · 12 km · shoots missiles too";
  the CIWS "1.5 km · fires by itself"; radars "sees ships 14 km (the horizon permitting)"; the helipad "a helicopter lands
  and is lashed". `builder.js` asks `Ship.specs`/`Ship.line` first for `def.ship` parts.
- **X-ray** (`bXray`, 2D) for ships: compartments as bands between their x0 and x1 (bulkheads as lines), the belt band, the
  magazines (red), engines, pumps, DC parties and crews.
- **Hangar:** the Ships group sorted by `shipClass` (§7) then cost; a template's `group` field files the Catalyna there.

---

## 12. HUD, camera, keys, touch, sound and models
(Numbered as the original's §12.1-12.6, which the briefs cite.)

### 12.1 The HUD
**Built (WP3):** the helm panel (`Ship.hud`: the telegraph's eight rungs and its order, HOLD with the heading held or HAND,
the rudder bar with the command and the rudders' own angle) inside the telemetry box; speed in knots and the heading in
the flight data; the aim mode's ground HUD for ships (`body.ship` over `body.ground`); the end screen's words
(`SHIP_FATES`) and distance sailed.
**Remaining (WP12):**
- **The hull diagram** (`Ship.hud`'s second panel): her side outline, a cell per compartment filling blue with `W/V`,
  holes as red dots, fires orange, the DC party white, heel and trim in degrees; under the helm panel on a desktop; on a
  phone a compact strip of cells in the same box. A small canvas redrawn at 4 Hz, only when its key changes.
- **Banners and warnings** (Death's banner and merged toasts): "FLOODING · compartment 3", "FIRE aft", "Magazine fire!",
  "Abandon ship" (her fate), "Torpedo in the water · 120° · 1.4 km", "Missile inbound" (a ship with a sea or air radar
  aboard hears incoming missiles as an Advanced RWR would: the warning's source is her radar part, so no magic radar),
  "Target sunk".
- **Torpedo lines** (ghud.js `drawTorps`, after WP9's mechanics): our torpedoes' predicted runs, and incoming torpedo
  tracks seen within 1.5 km as dashed lines.
- **Hole decals** (render3d's decals): dark scorched patches where `p.holes` are, read-only of the sim (CLAUDE.md).

### 12.2 The camera
**Built:** the aim camera's reach for a ship (render3d `aimDist`: by her length), the bridge view (Ships: H, `setBridge`:
the eye over her wheelhouse, rolling with her). **Remaining (WP12):** the chase distance from her reach (a 156 m ship
framed whole, a RIB close), checked at both ends of the fleet; the bridge view in Rough sea never shows the inside of the
hull.

### 12.3 Keys
**Built (WP3):** `KEY_ACTIONS` rows: `fwd`/`back` ring the telegraph a step (held: on), `left`/`right` the rudder,
`thrFull`/`thrCut` flank and stop, `sHold` 5, `sCiws` 6, `sDc` 7, `sView` H (the Ships group, the `ship` context, live
beside `ground` while she aims: the shell keys 1-4, `fire`, `weapon`, `sight`, `lock`, `spot`, `tacMap`, `cm`);
`Flight.shipKey`, `helmKeys`, `shipHelp`, `App.showHelp`. **Remaining:** none new; WP13 writes README's Ships block from
the bindings (CLAUDE.md's three places in sync).

### 12.4 Touch
**Built (WP3):** the throttle box as the telegraph lever (eight detents, Stop three-sevenths up, FLANK and STOP buttons),
the floating stick as the rudder, controls.mjs's ship layouts. **Remaining (WP12):** three buttons in the ship layer,
`hold`, `dc`, `ciws` (`Controls.CTL` entries, in the layout editor, `Controls.fit` keeps them clear), checked by
controls.mjs at 360×640 … 1920×1080; the desktop's key hints from the bindings (`Keys.k`).

### 12.5 Sound (WP12)
audio.js, procedural, only with a ship active or within 1.5 km of the view: the diesels' throb by the telegraph, a
turbine's whine with its spool, the bow wave's hiss with speed, the telegraph's bell on a step, the CIWS's buzz, a
torpedo's launch, hull hits (a deep clang), flooding (a gurgle in the bridge view), a magazine (the big explosion).

### 12.6 Models (parts3d.js)
**Built (WP2):** `BUILD.shipHull` (`shipHullGeo`: the rings lofted, vertex colours by band: the paint above, a black
boot-top at `wl ± bt` (0.25 m S, 0.4 M, 0.8 L/X), antifouling red below; `SKIN_GEO` bakes a paint into them), the screw's
spinning rig (`rig.shScrew`, by `p.rpm`), the rudder's (`rig.shRud`, by `p.rud`), the wheelhouse's prism with glass.
**Remaining:** WP5 the other parts' models by style (`plated` prisms for superstructure; lathe/extrude recipes for masts,
funnels, the gun house, the CIWS dome, canisters, radars that turn (`rig` by `sh`'s radar sweep), foils on struts,
outboards that turn with `p.rud`, waterjets' nozzles); the RIB's tubes, the landing craft's ramp (dropped when beached),
the floats' and flying-boat hull's step in `shipHullGeo` from `shull.tubes`/`ends.ramp`/`shull.step`. WP8 has
`shipHullGeo` read its positions from `shullTris` (§8.3) without moving the picture. builder-shapes.mjs: every model
within its clash shape.

---

## 13. Every hook and gate (file:function) — ✓ built, otherwise the package that adds it

| File:function | Hook | Gate | Status |
|---|---|---|---|
| parts.js PART_CATEGORIES, VEHICLE_KINDS, SEA_KINDS/isSea | the kind, tabs | data | ✓ WP0 |
| parts.js shullOf/shullPts/shullPath/shullDraw, partPath0/drawPart0 `case 'shull'`, PART_RECIPE.shull, clashShape loft | hull geometry | `def.shull` | ✓ WP0/WP2 |
| parts.js `shullTris` (new) | hit triangles, shared with parts3d | `def.shull` | WP8 |
| parts.js massPerMm/armourMassT | the belt's mass | `armour.belt` | WP8 |
| vessel.js constructor, rebuildGroups (`aircraft`, `ciws`, `hydro` → Ship.groups) | the flag | parts | ✓ WP0 |
| vessel.js computeHull | `shullPts` | `def.shull` | ✓ WP0 |
| vessel.js physicsStep | Ship.pre, Ship.forces, hF/hT, added mass and inertia | `this.sh` | ✓ WP1 |
| vessel.js turnTarget | null for a ship | `this.sh && kind ship` | ✓ WP1 |
| vessel.js ground | Ship.floorAt/floorNormal, `bed` | `this.sh` | ✓ WP1 |
| vessel.js ground | `_bedHit` per part; `Ship.deckContacts`; `Ship.deckRel` | `this.sh`; `Ship.D.length`; `k.deck` | WP6 |
| vessel.js splitComponents | `hydroFrom` | `this.hydro` | ✓ WP0 |
| vessel.js serialize/restore, gvLoad | holes, water, rud, fire, sh, fate, hydroFrom, lash | fields present | WP8 |
| vessel.js planeTarget | afloat as on the ground | `v.sh && v.afloat` | WP6 |
| gear.js Gear.ground | the bed, no wading, drive only on the bed, no engine flooding; deck contacts | `v.sh`; `Ship.D.length` | WP6 |
| flight.js start | Ship.launch | `v.hydro` over water | ✓ WP3 |
| flight.js canRails, update far list, stepsNear, physicsTick (moored), railsAdvance | mooring, far ships | `v.sh`/`v.hydro`/`v.moored` | ✓ WP1 |
| flight.js physicsTick | `Ship.lashStep` | `v.lash` | WP6 |
| flight.js planeTick | afloat as on the ground | `v.sh && v.afloat` | WP6 |
| flight.js groundTick, readControls, shipKey, helmKeys, setBridge, updateHUD, shipHelp, death words, knots | helm and HUD | `isSea(kind)` | ✓ WP3 |
| flight.js afterFall | waits for a ship to sink (≤ 15 s) | `v.fate` | WP8 |
| flight.js emitParticles | Ship.fx | `v.hydro` | ✓ WP2 |
| combat.js frame | `S.sea`, Ship.frame | any hydro vessel | ✓ WP1 |
| combat.js frame | `S.pd`, Ship.ciwsStep | any `v.ciws.length` | WP9 |
| combat.js reset | `S.sea`, `S.pd` false | — | ✓ / WP9 |
| combat.js damage | Death.hit for sea kinds (S6) | `isSea(v.kind)` | WP8 |
| combat.js destroyPart | holed through | `p.def.shull && v.sh` | WP8 |
| combat.js explode | `Ship.hullDist`; `under` holes | `p.def.shull` | WP8 |
| combat.js moveShot | `'stor'` → Ship.torpStep; `s.asm` → Ship.asmStep; bombs under water (S4) | the shot's kind/flag; `S.sea` | WP9, WP8 |
| combat.js swim | old torpedo homes on and hits ships | `S.sea` | WP9 |
| combat.js candidates | ships out of the air list, into the ground list | `isSea`/`v.sh && afloat` | WP9 |
| combat.js turretStep/turretFire | old turrets fire afloat (S8) | `v.sh` | WP9 |
| combat.js launchMissile, guide, guideAir | ASM, VLS flags | `w.asm`, `w.vls` | WP9 |
| combat.js aiDown | AI ships | `v.ai.sea` | WP10 |
| armour.js SHELLS | naval shells, ciws20 | new keys | WP9 |
| armour.js recsOf/test, faceMm | Ship.hullRay, Ship.hullMm | `d.shull`; `edge <= -6` | WP8 |
| armour.js resolve | drone charge's reference hp (S1) | `D.ship` | WP8 |
| armour.js apply | holes | hull parts | WP8 |
| armour.js moveShell | Ship.shotMissiles | `s.ciws` | WP9 |
| armour.js ground | big splashes | `SH.naval` | WP9 |
| armour.js cookOff | Ship.magazine | `v.sh` | WP8 |
| armour.js repairStep | ship fires and repairs are ship.js's | `v.sh` | WP8 |
| aim.js rangeTable/solve, aimLift | the long table | `SH.naval` | WP9 |
| aim.js stepAll | AI ships aim | `ai.sea` | WP9/WP10 |
| aim.js trackStep/searchStep | missiles (S3), sea contacts | `trackRadar.missiles`, `.sea` | WP9 |
| radar.js contact lists, sees | ships never air contacts | `isSea`, `v.sh && afloat` | WP9 |
| drone.js lockable | ships lockable (and O1) | kind | WP9, WP14 |
| death.js impact | Ship.impactSea first | `v.sh` | WP6 |
| death.js seaAt, seaTick, swamp | hydro excluded | `v.hydro` | ✓ sea fix |
| death.js swamp | a knocked-out wreck in deep water goes under | `o.ko`, water deeper than it | WP8 |
| death.js wreck list | sunk ships on a shallow bed | `v.fate` | WP8 |
| ghud.js aimUpdate, zero | 20 km ray, `GHUD.reach(v)` | sea kind or naval gun | WP9 |
| ghud.js drawTorps | torpedo lines | torpedoes in the water | WP12 |
| render3d.js swell, wakes, uSeaHole, aimDist | the drawn sea | a hydro vessel near | ✓ WP2 |
| render3d.js decals | holes on hulls | `p.holes` | WP12 |
| parts3d.js BUILD.shipHull, screw/rudder rigs | hull loft | `def.shull` | ✓ WP2 (WP8: from `shullTris`) |
| builder.js kind wiring, stats, waterline, warnings, quickAdd | the builder | kind ship | ✓ WP4 |
| builder.js specs/tray, X-ray, hangar classes, `t.group` | | kind ship / `def.ship` | WP7 |
| gmode.js capturer, placement, pickNaval, NAVAL_STOCK | the naval battle | `arena.kinds`, `arena.sea` | WP11 |
| mp.js MP.naval, MP_SET_OK, snap/unsnap, hit `ho`, `mkill`, `stor`, `down.sea`, `settings.sea`, `st` | the room | `MP.naval`, the new fields | WP11 |
| net.js NET_VERSION 14 | — | — | WP11 |
| mpui.js Spawns.place sea branch | sandbox spots | `sp.sea` | ✓ WP3 |
| mpui.js lobby, naval practice button, respawn | | `MP.naval`, the button | WP10/WP11 |
| space.js EARTH.spawns sea entries | | kind ship | ✓ WP3 |
| space.js EARTH.navalRange, EARTH.arenas.sound | | | WP10, WP11 |
| main.js Settings → Sea | Ship.setSea | — | ✓ WP3 |
| controls.js KEY_ACTIONS Ships, contexts, CTL | | `ship` context | ✓ WP3; WP12 (touch buttons) |
| audio.js | ship sounds | a ship active or near | WP12 |
| test/ground.test.js SYSTEMS | Ship counted | — | ✓ WP0 |

---

## 14. Invariants and their proofs
- **Old designs byte-identical**: `traces.json`, `fingerprint.json`, `handling.json`, `driving.json` (`buggy sea`, `buggy
  headland`: the solid sea), `combat.test.js` (the frigate's SAM, the range torpedo), `mp-air.json`, `groundcombat.json`,
  `death.test.js` A7 and B3 (a burning craft on the sea, hulks afloat) all **unchanged**; the new templates appear in
  fingerprint/traces/mp-measure as **added keys only**, proven with `node test/tools/keydiff.mjs 71c3af7 --add
  fingerprint:<key>,traces:<key>,mp-measure:<key>` for the eight new keys, and `--allow` for `cyclon`'s own keys (they move
  as she is finished). *Corrections:* mp-measure.json carries every template, so it gains the keys too (WP0); combat.test's
  `groundFinger` leaves out kind `'ship'` (groundcombat.json is the ground vehicles' fingerprint; the naval one is
  `baseline/ships.json`, §17).
- **Zero calls** (§13). `test/lib/game.js` has a `ship: false` option (built); `ships.test.js` §gates runs old templates'
  12 s traces with and without ship.js and finds them identical, and ground.test counts no calls into `Ship` and no
  `Combat.S.sea`/`S.pd`/`Ship.D.length` opening (built; WP9 adds `S.pd` to the counter's list if it isn't).
- **2D = 3D = clash = hit = buoyancy for hulls**: catalogue.test (sections convex and inside the box, joints match within
  1 cm), builder-shapes (model vs clash), ships.test (`hullRay` against the loft's own triangles at 200 random rays: the
  same entry within 2 cm, true by construction through `shullTris`; the buoyancy of a fully sunk hull = `ρ·g·shullOf(def).vol`
  within 0.5 %).
- **The solid sea for everyone else**: a Seagull, a buggy, an amphibious Pumo and a splashing rocket behave as before
  (driving, ground.test's water section, death.test A7/B3, ships.test §hydro 11: built).
- **Wave agreement**: `waveUniforms` vs `wave` within 1 mm (built), water.mjs's swell seam check (built).
- **No magic radar** holds: ships are never air contacts; an aircraft's radar part never sees a ship; naval radars are
  parts; a ship's missile warning comes from her radar parts.
- **Peers untrusted**: `ho`, `mkill`, `stor` shots, `down.sea`, `sh`/`af`/`st` in snapshots, `settings.sea` and
  `game: 'naval'` cleaned (finite, ranges, our own parts, enemy only, rates); no peer text in `innerHTML`.
- **Props deterministic**: the sea spots and the Sound add no props (keep-outs unaffected); spawns.test checks the sea
  spots' depth instead (built for the sandbox spots; WP11 adds the Sound's starts and zones).
- **What 0 hp does** (CLAUDE.md's damage-model invariant): a hull part at 0 hp is holed through, never blown up (§8.9);
  every old part's 0 hp is as before.

---

## 15. Performance budget (phone first)

Measured on the bench rig (desktop; phone = 4× CPU throttle) before/after; budgets the PR must meet:
| Item | Budget | Today |
|---|---|---|
| Old scenes (every existing render-bench scene, graphics.mjs) | identical pictures and within ±2 % frame time (no swell, no hole, no wakes) | built: held (graphics.mjs; the background-job slice fixed on the branch) |
| `Ship.forces` for the Arley Berk (39 phys rings, 4 sines each) | ≤ 0.04 ms desktop / 0.16 ms phone a step | 7.3 µs for the Cyclon's 12 rings → ≈ 24 µs |
| A Naval Range Hostile wave (player + 3 AI ships, LOD) | physics ≤ 1.5 % of a desktop core, ≤ 8 % on the phone at 120 Hz | WP10 |
| Flooding, fires, DC, fate | 10 Hz / 4 Hz, ≤ 0.02 ms a ship a call | WP8 |
| AI think | 4 Hz, ≤ 0.1 ms a ship; look-ahead 9 `heightAt` a second | WP10 |
| Swell patch | GPU ≤ +5 % frame time over the flat sea in `sea300` on phone Low; CPU recentre ≤ 2 ms (≤ every 4 s at 30 kn) | built (refilled behind the one on show) |
| Wakes | ≤ 6 ribbons, one draw, ≤ 0.1 ms CPU | built |
| Spray and smoke | within FX's caps (900 High, 350 Low), ≤ 30 particles/s a ship within 800 m | built |
| `Aim.limits` / range tables for the Arley Berk | ≤ 30 ms once at launch (cached per template for the AI) | WP9 |
| `Ship.bump` | ≤ 0.05 ms a frame with two ships touching; nothing without pairs in reach | WP6 |
| CIWS | ≤ 15 simulated rounds a second a mount; ≤ 0.05 ms a frame a mount | WP9 |
| Hull art | vertex colours, no texture per hull | built |
| The sea's looks (§5.5) | phone Low within ±3 % in the sea scenes, High ≤ +10 % over the sea, nothing where no sea shows | WP15 |
New bench scenes: `ship1k` (the destroyer at 25 kn, camera 1 km off), `shipnear` (built: chase cam on a small hull at
speed), `fleet` (Hostile wave 3 from the player's bridge), `seaRough` (built: camera at 20 m over Rough sea, no ship near:
proves the swell is off).

---

## 16. Phases and work packages

One branch for the update (`ccr-932b9082-m4kox7`), one PR at the end (as PR #47 was built); each package in its own
worktree off the branch's tip at the start of its phase, merged back by the lead in the order given. **Ownership rule**:
a package edits only the files (or the named regions of shared files) listed as its own; anything else goes through the
lead or is marked `// [WPn]` and reported. Shared files are split by named function or by the `// ==== region ====`
markers (ship.js sections, parts.js's ship tabs, armour.js's naval block). Every package reads `BRIEF-common.md` first.

### Phase 0: the contract — ✓ done (WP0, 95bf553)
ship.js skeleton with `SHIP` and the whole API as stubs; the kind, tabs, `shullOf`/`shullPts`, the seven slice parts;
vessel.js's flag; the `cyclon` slice; shell files (`CACHE` v41, now v42 on the branch); tests (ground.test SYSTEMS, the
category count 31, catalogue, core.test's order rule, ship: false).

### Phase 1: hulls that float — ✓ done
WP1 hydro core (fd56f26), WP2 drawn sea and hulls (5e93c3e, 25271b0), WP3 helm/HUD/launch (c63e93f, b17cefd), WP4 builder
basics (31364f0, 8356ebc, 30cada0); then career removed (ea446cd), the sea-crash fix (3da4a41, 7748548), milestones
(dec4f39). Tests: `test/ships.test.js` (§hydro, §waves, §gates), `test/ships-builder.test.js`, browser `ship-flight.mjs`,
`builder-ship.mjs`. The slice is fun to drive at the bay on a phone and a desktop; old baselines identical.

### The Ship API (current: built, stubs, and what this spec adds)
```js
Ship = {
  D: [], S, battle: null,
  // core — built: groups, pre, forces, addedMass, floorAt, floorNormal, overWater, launch, seaPlace, drift, stab, setTel,
  //   telStep, settle, moor, unmoor, heading. Stubs → WP6: impactSea(v, parts, sim), bump(F).
  //   New (WP6): deckContacts(v, contacts, loc), deckRel(k, vp), deckVel(D, at, out), lashStep(v, h, F), insideHull(v, X).
  // waves — built: wave, seaT, setSea, sea, fadeAt, waveUniforms. New (WP11): slew(st, F).
  // builder — built: stats, hydrostatics, spotOf (keel/deck/inside/stern), warnings (basics). Stubs → WP7: specs(def),
  //   line(def); spotOf and warnings completed.
  // damage — stubs → WP8: hullRay(p, A, B, H), hullMm(p, edge, u), hullDist(v, p, at), addHoles(v, holes), floodStep,
  //   fireStep, dcStep, fateStep, doom(v, sim, why, by), magazine(v, sim, part). New: holedThrough(v, p, cause, sim),
  //   wetAt(v, p), floodForce(v, S) (the flood water's weight, called at forces' marked line).
  // combat — stubs → WP9: fireTorp, torpStep, torpHit, ciwsStep, shotMissiles, surface, seesSea, rcs. New: asmStep(s, h, F).
  // frame — built: frame(F, dt) (moorCheck, bump); fx(v, dt, F). WP8/WP9/WP10 add their calls to frame in that order:
  //   bump → flood (10 Hz) → fire, dc, fate (4 Hz) → ciws (when S.pd: called from Combat.frame instead) → ai → range.
  // hud — built: hud (helm panel), help, keys. WP12: the hull diagram, banners.
  // ai — stubs → WP10: aiDown, flyStriker, range, practice.
  // mp — stubs → WP11: snap, unsnap, ghost, downSea, onDownSea, cleanHoles.
};
```

### Phase 2: parts, propulsion, the builder. Three packages in parallel; merge WP5 → WP6 → WP7.
| WP | Owns | Interfaces | Tests | Done when |
|---|---|---|---|---|
| **WP5 Catalogue and non-combat ships** | parts.js regions `shHull`, `shSuper`, `shDrive`, `shKit` (the parts of §6.1, §6.2, §6.3, §6.5 except weapons; the 7 built ones untouched), their 2D art (`shullDraw` gains tubes/ramp/step; gvKit styles and `plated` outlines) and 3D models (parts3d recipes; hulls by `BUILD.shipHull`), `SKINS` ship paints, `shull.bk`/`cw` data; builder.js `TEMPLATES` ships block: `zodiak`, `cyclon` (finished, existing guns only), `higgens`, `pegazus` (unarmed of naval weapons until WP9: its gun and ASM slots filled by WP9), `catalyna` (`group: 'ship'`) and the hull-only drafts of `osca`, `vizby`, `olivar`, `arley` (hull, superstructure, propulsion; WP9 arms them) | §6 numbers; `shullOf`; `Ship.stats` | catalogue.test (441 parts after WP9; this WP's counts; sections convex and in the box; joints within 1 cm per class; every ship part's fields), builder-shapes.mjs (models vs clash; More shows 32), core.test (67 templates after WP9; every ship joined, editable, priced in tier, floats within ±0.3 m of her marks, no open ends), ships.test §trials for zodiak, cyclon, higgens, pegazus hullborne, catalyna floats; ships-builder.test (stats vs flight for every stock ship); keydiff (added keys; `--allow` cyclon) | every non-weapon part exists, looks right in 2D and 3D, floats or does its job; the five ships meet §7's targets; screenshots looked at |
| **WP6 Propulsion, foils, decks, collisions** | ship.js `core` additions (§4.4 ride control and halves, §4.5 outboards and waterjets, §4.8 `impactSea`, slams, `bump` with carriers and ghosts, decks and lashing, §4.12 tiny pieces, the Catalyna's gates, `shull.cw` in `hull()`); vessel.js `ground()` (`_bedHit`, deck contacts, `deckRel`), `planeTarget`'s afloat gate; flight.js `physicsTick` lash line, `planeTick`'s afloat gate; gear.js `Gear.ground`'s hydro gate and deck contacts; death.js `impact`'s first line; ship.js builder's `resistance()` `cw` (one line, with WP7's agreement) | §4; WP5's field names (`jet`, `steer`, `foil.ride/intake/h/y`, `deck`); test-only defs until WP5 lands | ships.test: a hydrofoil foilborne above 30 kn and stable 120 s in Moderate; the Zodiak planes (trim 2-6°, half her hull out); a waterjet boat turns and reverses; a helicopter (`dragonfly`) lands on a deck at 15 kn underway, stays 60 s lashed, lifts off; two ships collide and bounce without NaN (holes hook called); ramming a carrier stops her; an amphibious tank with a hull floats and climbs the slipway; the Catalyna floats, planes and lifts off; a jet boat; a winged ship stays down (lift < 30 %); old craft unchanged (zero calls, keydiff); costs (§15) | those pass and play right in the browser (screenshots: a hydrofoil foilborne, a helicopter on a deck) |
| **WP7 Builder complete** | builder.js: `Ship.specs`/`line` use on cards and the tray, X-ray for ships, the hangar's classes (`shipClass`) and `t.group`; ship.js §builder: `spotOf` for every place (§11.2), `warnings` complete (§11.3), `specs`, `line` | `place` values of §6; test-only defs where a part isn't in yet | builder-ship.mjs full (tap-to-place every place on a hull, X-ray, hangar group, cards on phone and desktop); ships-builder.test (spotOf for every place on an empty, a hulled and a full design; each warning fires and clears); redraw.mjs | every ship part has a sensible tap placement and its warnings; the X-ray shows a ship's insides; the hangar lists ships by class |

### Phase 3: combat. Two packages; merge WP8 first.
| WP | Owns | Tests | Done when |
|---|---|---|---|
| **WP8 Damage, flooding, sinking** | ship.js `damage` (§8.3 hullRay/hullMm/hullDist, §8.4 holes, §8.7 flooding and `floodForce` at forces' marked line, §8.8 fires/DC/magazine, §8.9 holed through, fate, doom, wrecks); parts.js `shullTris`, `massPerMm`/`armourMassT` belt; parts3d `shipHullGeo` reads `shullTris` (the picture unchanged); armour.js `recsOf`/`test`, `faceMm`, `resolve` (S1), `apply` holes, `cookOff` → magazine, `repairStep` ship skip; combat.js `explode` (hullDist, `under`), `damage` (S6), `destroyPart` (holed through), `moveShot` bombs under water (S4); death.js `impact` (with WP6's line), `swamp` (the knocked-out wreck in deep water), wreck list for sunk ships; flight.js `afterFall` ship wait; vessel.js serialize/restore (§10.5) | ships.test §damage: hole areas per weapon class; flooding equilibria (a 1 m² hole 1 m deep in the Olivar: lists, survives with pumps; three compartments: sinks in < 300 s); free-surface capsize; pumps and DC timings; a magazine breaks her in two; each doom reason; a wreck on a shallow bed vs removal in deep water; derelicts; a knocked-out tank in deep water goes under; armour.test unchanged; death.test A7/B3 unchanged; saves round-trip | ships die by water, fire and magazines, as physics says |
| **WP9 Naval weapons and sensors** | parts.js region `shArms` (§6.4) and the kit's `decoy`/`torpDecoy` behaviour; armour.js naval `SHELLS` block, `moveShell`'s CIWS line, `ground()` splashes; aim.js `rangeTable`/`solve`/`aimLift` naval gate, `stepAll` AI line, `trackStep`/`searchStep` (S3, sea), the torpedo `fire` path; combat.js `isFighter` (never a ship), `candidates`, `swim`, `moveShot` (`stor`, `asm`), `launchMissile`/`guide`/`guideAir` flags, `turretStep` (S8), `frame`'s `S.pd` and `ciwsStep`; radar.js classification; drone.js `lockable` (ships); ghud.js `GHUD.reach`, zero ladder; ship.js `combat`; the warships armed: `osca`, `pegazus`, `vizby`, `olivar`, `arley` (their own keys) | ships.test §combat: a 127 mm range table hits at 5 km within one hull length; CIWS kill odds (§8.10); torpedo homing and hull hit; the old air torpedo hits a ship; an ASM sea-skims and hits; VLS pitch-over; a SAM kills an ASM; classification (ship ghosts never air candidates nor air radar contacts); §8.12's damage targets; a TK-34 with a 127 mm gun hits at 3 km; combat.test, radar.test, aim.test unchanged | the four warships fight as §8 says |

### Phase 4: AI, play, multiplayer, polish, the matrix, the sea. Five packages; merge WP10 → WP11 → WP12 → WP15 → WP14.
(WP15 owns nothing the combat packages touch, so it may start beside Phase 3 once Phase 2 is merged.)
| WP | Owns | Tests | Done when |
|---|---|---|---|
| **WP10 AI, range, practice** | ship.js `ai` (§9); combat.js `frame`'s AI-loop and `aiDown` lines; groundai.js `aimAt` factored out (no behaviour change: groundcombat.json identical); space.js `EARTH.navalRange`; gmode.js `NAVAL_STOCK`; mpui.js the Naval practice button and its panel. (No career awards: §21.) | `test/navalai.test.js` (the helm reaches waypoints, avoids land at the islands, keeps range, hits a target at 4 km within N salvos by skill, torpedoes, evades, engages a tank on the shore); browser `naval-range.mjs` (Practice: sink a target; Hostile: survive a wave 60 s of `Flight.time`); bench `fleet` | Practice and Hostile ranges and the practice battle play end to end |
| **WP11 Multiplayer** | mp.js (§10.4), mpui.js lobby, settings, placement and respawn for naval, net.js `NET_VERSION` 14, gmode.js (`capturer` kinds, `placement` sea, `pickNaval`), space.js `EARTH.arenas.sound`, ship.js `mp` and `slew` | mp.test naval trace → new `baseline/mp-naval.json`; `mp-air.json` identical; gmode.test naval placement and capture (`'boat'` still doesn't); spawns.test the Sound's starts and zones deep enough; net.test unchanged; browser `naval-battle.mjs` (two tabs, BroadcastChannel) | a 1v1 naval battle plays in two windows |
| **WP12 HUD and feel** | ship.js `hud` (the hull diagram, banners, missile warnings from radar parts), ghud.js `drawTorps`, render3d decals for holes, audio.js, controls.js touch buttons (`hold`, `dc`, `ciws`), style.css | controls.mjs at all sizes, ship-flight.mjs (screenshots: helm, hull diagram, a sinking ship, the bridge view in Rough sea) looked at, redraw.mjs | it reads clearly on a 360×640 phone in portrait |
| **WP15 The sea's looks** (§5.5) | render3d.js: the ocean material's hooks (`waterHook` and the water shader's ripple, foam and light code), the swell patch's material (`updateSwell`'s), the wakes' material; world.js only if the 2D view's sea must agree (§3.7's table); ship.js `waveUniforms` (read only) | water.mjs; graphics.mjs (the sea's checks re-baselined, every other check identical); the bench's sea scenes before/after; screenshots per §5.5, looked at | from a plane, a deck and a phone, the sea looks like the sea in each state, at today's cost on phone Low |
| **WP14 Combat matrix** | `test/matrix.test.js` (§20: reach, effort with `baseline/matrix.json` and rating bands, hard cases), the old-kind fixes O1 (drone.js `lockable`), O3 (`def.warhead` rocket part), O5 (combat.js `Death.hit` for rockets), the 7×7 table for the handbook and PR | matrix.test (≈ 50 s); the old 36 pairs identical with and without ship.js; every old baseline identical | every pair has a way; the table's bands hold |

### Phase 5: docs, review, ship (lead + reviewers)
**WP13**: README, HANDBOOK §11 (Ships), CLAUDE.md, ROADMAP, test/README, sw.js final `CACHE`, the history row (§18); then
the **adversarial review** (independent reviewers write repro scripts trying to break: old designs, the solid sea, MP
hostility checks, NaN in physics, saves round-trip, performance), fix, verify, benches before/after, the PR body with
tables (the matrix, the stock ships' trials, the budgets).

---

## 17. Test plan

### 17.1 Node suites (in `test/run.mjs`'s lists, documented in `test/README.md`)
- **`test/ships.test.js`** (*built*: §hydro, §waves, §gates), sections to add:
  - *hydro* (built; add): every stock ship settles in 20 s within §7's marks (±0.3 m); tiny pieces float or sink by their
    density; a doomed ship never moors.
  - *trials* (WP5, WP6): speed, turning, stopping, roll beam-on, planing (Zodiak), foilborne (Pegazus), take-off (Catalyna)
    against §7's targets; a new `baseline/ships.json` (each stock ship's 60 s pose/speed trace: settle 10 s, Flank 30 s,
    hard rudder 20 s, Moderate sea, seeded) so later changes are pinned.
  - *waves* (built).
  - *damage* and *combat*: §16 WP8/WP9 lists, seeded.
  - *cross-kind*: TK-34 + 127 mm gun; a tank with a hull floats; the Catalyna floats, planes and lifts off at about 85 kn (flaps down);
    the Cyclon with two `wingL`s at Flank has wing lift under 30 % of her weight; air engines on an S hull push it (an
    airboat); a helicopter on a moving deck; a tank turret (ringM + gun75) on the Cyclon aims through the aim mode.
  - *gates* (built): every old template with and without ship.js: identical traces; `Combat.S.sea`/`S.pd` never open;
    `hydro === false`.
- **`test/ships-builder.test.js`** (*built*; WP7 extends): spotOf for every place; every warning fires and clears; stats
  vs flight for every stock ship (draught ±10 %, GM ±0.15 m, top speed ±12 %).
- **`test/navalai.test.js`** (new, WP10), **`test/matrix.test.js`** (new, WP14).
- Extended: `catalogue.test` (441 parts, 140 gv: 81 ground + 59 ship; ship field checks), `core.test` (67 templates; the
  order rule: the ground block, then the ships block, which may hold a flying boat: kind plane with a hull part), `ground.test`
  (SYSTEMS, categories 31, defaults: built), `gmode.test` (the Sound, capture by an afloat ship, placement; `'boat'` still
  doesn't capture), `spawns.test` (built for the sandbox's sea spots; the Sound's starts and zones), `mp.test`
  (`mp-naval.json`), `fx.test` (caps with spray and CIWS tracers), `death.test` (A7/B3 unchanged; a ship's doom; the
  knocked-out tank in deep water), `armour.test`/`aim.test` (unchanged for old shells; naval shells' tables).
- Baselines: `baseline/ships.json`, `baseline/mp-naval.json`, `baseline/matrix.json` (new); fingerprint, traces and
  mp-measure: new keys only.

### 17.2 Browser suites
`builder-ship.mjs` (built; WP7 extends), `ship-flight.mjs` (built; WP8/WP9/WP12 extend: aim and fire, a sinking
screenshot, the hull diagram; `App.frame` console clean), `naval-range.mjs` (WP10), `naval-battle.mjs` (WP11: two tabs,
BroadcastChannel), `water.mjs` (built §swell), `controls.mjs` (ship HUD sizes, built; WP12 the touch buttons),
`graphics.mjs` (old scenes identical), `builder-shapes.mjs` (new parts; More shows 32 buttons: 31 tabs + Fewer; built),
`builder-tank.mjs` (7 kind buttons; built), `redraw.mjs` (the waterline, the X-ray and turret arcs redraw on change).
Headless runs at about 0.08× real time: measure `Flight.time`; `Render3D.skipDraw = true` where the picture doesn't matter.

### 17.3 Bench
`test/bench/render-bench.mjs`: `ship1k`, `shipnear` (built), `fleet`, `seaRough` (built), phone and desktop, High and Low,
before/after; `test/bench/naval-bench.mjs` (from `ground-bench.mjs`): physics ms a step a ship at 4× throttle, AI think cost.

---

## 18. Chores (in the same commits as the changes; the docs at the end, WP13)
- **README.md**: "What's in it" gains a **Ships** bullet ("a seventh kind of craft"); the builder line's kind list and the
  hangar count ("sixty-seven examples": the ship group listed); "441 parts in thirty-one categories" with the five ship
  tabs' sub-bullets; the Controls table's **Ships** block (from the bindings) and the touch description; Multiplayer: the
  Naval Battle and the sea state; Modes: the Naval Range and Naval Practice; Project layout: a `js/ship.js` line; "Ideas
  for later": remove "boats", add "submarines (and depth charges)" and "landing craft that carry a tank"; limits: "no
  depth charges: there's nothing under the water to hit yet", "wings never act as hydrofoils", "a ship's mixed engines
  spool at the slowest one's rate".
- **sw.js**: `CACHE` bumped at every cached change (v42 on the branch now), `SHELL` has `'js/ship.js'` (built).
- **index.html**: the script tag and kind button (built), stat rows (built), `#mp-create-naval`, `#mp-practice-naval`.
- **CLAUDE.md**: the architecture row for `ship.js` (and the parts.js/builder.js counts: 441 parts, 140 gv, 59 ship; 67
  templates, eight ships and a flying boat); the Coordinates note (ships: as cars and Armour); an Invariant "**The ship code
  is shut for old designs**" naming the gates (§13) and the proofs (§14); console handles (`Ship`, `SHIP`, `v.sh`,
  `Combat.S.sea`, `Combat.S.pd`, `Ship.D`, `Ship.wave`, `Render3D.info().swell`); the History row; the Gotchas: "the swell
  patch is the sea only near a ship: anything that changes how the ocean is drawn must keep `uSeaHole` and the swell
  agreeing"; "a hull's hits are its drawn triangles (`shullTris`): change the loft and the hits move with it".
- **docs/HANDBOOK.md**: a new **§11 Ships** in the format of §8 and §10 (files, where old code calls in, gates, data,
  physics, waves, damage, builder, AI, MP, invariants, tests), and §1.2 (catalogue), §1.5 (templates and codes), §5.1
  (script order), §5.8 (README counts), §6 (tests) updated. `docs/ships/` is folded into it and removed.
- **docs/ROADMAP.md**: the ships entry (if any) moved to History; add submarines, a vehicle deck, cranes, sea drones.
- **Duplicate globals** checked (`grep -n "^const NAME\|^function NAME" js/*.js`) for every new one: `NAVAL_STOCK`,
  `shullTris`, and any ship.js top-level name.

---

## 19. Design concerns and open risks

**Where the decisions are pushed on (none reversed, three amended):**
1. **Decision 10, the landing craft carrying a tank: no, in this update.** A tank on a moving deck needs Gear-on-deck
   contact (tracks against a moving vessel) or a lashed second craft with a drive-off and the drone-style second-craft MP
   messages. Doing it well is a package of its own; done badly it's the feature the owner will break first. The Higgens
   carries troops (which already capture zones) and lowers her ramp when beached. Recommended as the first follow-up
   ("vehicle deck": `def.vdeck`, a lashed stock or saved Armour design that drives off down the ramp at a beach, the drone
   bay's patterns reversed). *Now that WP6 builds deck contacts and lashing for helicopters, the follow-up is smaller.*
2. **Decision 9, the crane/davit: dropped** (no physics need; cosmetic only). **Helipad: kept**, real new physics
   (moving-deck contact and lashing, §4.8, WP6) with its own tests; if WP6 runs late, ship it with lashing only for
   helicopters landing at < 3 m/s relative and say so.
3. **Decision 6, flood water as mass: amended to "as weight"** (a force at the free-surface-shifted centroid, not part of
   `v.mass`). Statics (list, trim, sinking, capsizing) are exact; a flooded ship only accelerates slightly too easily. It
   avoids a `recompute` and an inertia rebuild at 10 Hz on every damaged ship.
4. **Decision 7, belt armour: the opt-in field on hull midsections only** (`armour.belt`), read by the hull face codes
   in `faceMm`. Separate belt plate parts would need hull-conforming geometry and would break 2D = 3D at the bow.
5. **Wings never act as hydrofoils.** A plane's wing dipped in water still only feels air (only `def.foil` parts see water).
   Physically incomplete under the owner's rule, but routing wings through water would reach into PR #40's plane code.
   Listed in README's limits.
6. **Ship parts on drones**: the drone builder refuses gv parts (drone.js), so no sea drones yet. Left as is (a follow-up
   "sea drones" would open it).

**Risks:**
- **Physics feel**: the strip planing model and the resistance table are tuned by tests (WP1 tuned `planeK` 0.6, `latLin`
  2, `SCREW.va` 1.1); the foils' ride control is next. The trials are the guard; tune `RIDE`, `planeK`, `C_wr`, added mass
  first.
- **Cost on phones**: AI fleets at full physics are the biggest new CPU cost (LOD and the 12 km step limit are the levers);
  the swell patch's fragment cost on Low is held by its 6 m cells.
- **Old sea behaviour**: every water rule old craft use is untouched only because the hydro flag is opt-in per vessel. Any
  "simplification" that changes `surfaceAt`, `waterAt`, the probe for non-hydro vessels, `splashed` or the sea fix's
  `SEA` rules breaks `driving.json`/`death.test`. Don't.
- **MP clocks**: the wave phase slews toward the host's clock; on a very slow phone the drawn sea and a ghost's bob can be up
  to ~0.25 s apart (centimetres). Acceptable; the physics is each owner's.
- **Big parts**: a 24 m, 1,300 t hull part is far outside what `Combat.maxHp`, `explode` and `Aim.sweep` were sized for.
  Every such use is gated on `def.shull` (hp set explicitly, `hullDist`, the sweep's cost measured in the bench).
- **The 1/20 world**: horizons of ~7 km make long-range gunnery mostly radar- and spotter-driven; the 20 km ray is for
  shells over the horizon at radar contacts. Fun first: if fights feel too close, raise masts (radar height) rather than
  bending the planet.
- **Carriers**: static carriers stay terrain; ships meet their hull boxes (`Ship.bump`), never the breaking `side` rule. A
  sailing carrier the planes can land on is out of scope (deck contact would make it possible later; the arresting gear
  and catapults are terrain-bound).
- **Save size**: per-part holes and water are small (holes capped at 16 a part); `rss.flight` stays well under its quota.
- **`TEMPLATES` regex** in test/lib/game.js (`/const TEMPLATES = \{[\s\S]*?\n\};/`): ship templates stay inside the one
  literal, with no `\n};` inside.
- **`MP_MAX_PARTS` 600**: the Arley Berk is ~70 parts; a player's 300 m battleship of 900 parts needs the cap off, as now.
- **Olivar's length** (new, from the hull classes): one X class can't make both a 4,100 t, 136 m frigate and an 8,300 t
  destroyer sit at their marks; the Olivar is 108 m (two midsections) at 5,000 t (§7). If the owner wants her longer,
  the fix is a narrower frigate class, not lighter segments.

---

## 20. The owner's second standing rule: every kind can fight every kind (added after Phase 0)

The owner, in their words: "every vehicle should be able to combat every type of vehicle, some less effective and some
more sure, some almost harmless, keep realism, but every one should have a way to destroy another type of vehicle
someway."

Reading (decided): for every attacker kind A and target kind T among the seven (rocket, plane, car, helicopter, drone,
Armour `tank`, ship), there is at least one way, with parts A can carry (cross-kind parts included), for A to destroy T:
knock it out, shoot it down, sink it. Effectiveness follows realism: a drone's charge against a destroyer is almost
harmless (a small hole, a fire), enough of them still sink her; a rifle-calibre MG against a tank only kills crew through
open hatches / tracks and optics, an AT weapon does the job; a ship's CIWS or SAM shreds a drone or a plane; a tank's main
gun can hit a hovering helicopter or a slow plane low down; a car with an AA gun or MANPADS-style launcher can shoot down
aircraft. No "immune" pairs: every damage path must reach every kind of target (shells, bullets, blasts, missiles,
torpedoes, rams, charges), and every targeting path that is kind-gated (air vs ground vs sea classification, seekers,
locks, AI target lists) must have an answer for every target kind (e.g. an air-to-air missile can't lock a ship, but a
radar/IR/TV anti-ship or anti-ground missile can; a torpedo only hits things in the water).

Proof: `test/matrix.test.js` (WP14): a 7×7 table; for each pair a representative attacker (a stock template, or a stock
template plus cross-kind parts) and the target, a seeded scripted engagement (or, where an engagement is impractical
headless, the direct damage path: a hit of that weapon on that target's parts) asserting the target can be destroyed
within a bound (time or number of hits), and recording the effort (hits/time) so the table shows "sure / takes work /
almost harmless". The table goes in the handbook and the PR body. Old kinds' gaps found by the audit (its summary:
`reports-recovered.md`; the full file `matrix-audit.md` was lost with the container) are fixed with gates that keep every
old baseline identical (no old test path changes what it does).

### 20.1 Lead's decisions on the audit
- Old kinds: no impossible pair today. Do fixes **O1** (drone lock-on accepts landed craft, rockets on the pad, slow low
  helicopters; still refuses drones), **O3** (a rocket warhead part, `def.warhead`, so a rocket can be flown as a missile;
  old crashes stay harmless), **O5** (rockets in the `Death.hit` gate for hit markers). All gated so no old baseline moves.
- Ships: **S1** is a must (a drone charge's "55 % of the part's own max hp" must not apply to hull/ship parts: a fixed
  reference hp, `SHIP.DRONE.ref`; targets per S2's bands: a Bumble needs ~3-8 hits on a patrol boat, 40-120 on a
  destroyer). **S2**: §8.12's damage targets for drones, MGs, bombs and aircraft weapons. **S3**: naval SAMs DO engage
  anti-ship missiles (`trackRadar.missiles`). **S4**: a bomb/charge near a hull bursts after a short delay under water
  (gated on a hydro vessel in play). **S5**: CIWS never uses the low-and-slow notch rule. **S6**: ships in the `Death.hit`
  gate. **S7**: torpedo tubes on aircraft drop the torpedo into the water (an aerial torpedo); on land they fire nothing
  (a builder warning). **S8**: old turrets DO fire from a ship afloat (the "hold fire on the ground/water" rule applies to
  aircraft only). **S9**: the naval AI engages shore targets in range. **S10**: ship ghosts collide (`Ship.bump` covers
  ghosts). Where each lands: §8 (S1-S8), §9.1 (S9), §4.8 (S10).
- **WP14 Combat matrix** (Phase 4, after WP8/WP9): `test/matrix.test.js` as the audit designed it (reach, effort with
  `baseline/matrix.json` and rating bands, hard cases), the old-kind fixes O1/O3/O5, and the 7×7 table for the handbook
  and PR. The old 36 pairs identical with and without ship.js.

---

## 21. Career removed (owner's decision during the update) — *done* (ea446cd)
The owner: "delete career and future career additions, it's a very unused game and extra charge in every update." Career
mode (funds, tiers, R&D, missions, refunds, the mode picker) is deleted on this branch. Nothing in the ships update adds
career content (no missions, no awards, no tier locks for ship parts). Part costs and `tier`s stay as data: battles'
budgets (`Budget`, util.js) and the hangar's price tiers use them; prices show only when `Budget.on`.
