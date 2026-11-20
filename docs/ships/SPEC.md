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
- New globals stay unique: `grep -n "^const NAME\|^function NAME" js/*.js` for every new one (`NAVAL_STOCK`, `NAVAL_RANGE`,
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
  midsection has 6; the Arley Berk of §7 has 3 + ... = 35 phys rings, the budget's figure.)
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

**Remaining (WP5):** a patrol boat beam-on to Moderate seas rolls 12-13°; real ones roll 5-8°. Fix with data: `bk: true`
on every stock M, L and X hull segment (`bk: 0.05` on X), re-measured by the trial (§17.1). If that is not enough, WP6
(owner of core) may raise `SHIP.bilgeKeel`; never touch `rollZeta` (the box hull's period test pins the bare hull).

### 4.4 Foils: rudders, hydrofoils, skegs — *rudders and fixed foils built*; ride control remains (WP6)
Built (`propel`'s foil loop): every `def.foil` part, copy by copy (`sh.fl`), at water density, never the wing code: lift
slope `FOIL.slope`·2π·ar/(ar+2), stall at 22° falling over 65° to half, induced and stall drag, lift faded in over
`sub`·chord of depth, a rudder in a screw's slipstream (`wash`), strain past `load` and a rip past `brk` 1.5 × it.
`foil.n: 'z'` (a rudder or skeg, turned by `p.rud` about its stock) or `'y'` (a hydrofoil, at fixed incidence `inc`).

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
  her off at about 70 kn on her old plane laws. Gates: vessel.js `planeTarget` and flight.js `planeTick` treat
  `v.sh && v.afloat` as on the ground wherever they read `v.landed` for the ground roll (Aim's take-off steering, hold's
  wings-level on the ground), so the laws don't fight the water; on the water she steers by her air rudder and, slow, by
  the yaw input on any water rudder aboard (built: `Ship.pre`'s other-kinds branch). A touchdown under `SLAM.k` ×
  breakSpeed is a planing run-out; harder, holes. These gates are `v.sh`-only: every old seaplane keeps its floats' rules.
- **A ship with wings** (the owner's rule): their lift is real (aero block, ground effect), `aircraft` is false (no
  `planeTarget`), so she never flies them; two `wingStraight`s on the Cyclon at Flank: lift < 30 % of her weight.
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
| torpTube | Torpedo Tubes | 3.4 × 0.8 × 1.0 | 1.2 | 3,000 | 500 | edge | three lightweight torpedoes: `weapon: { kind: 'torp', ammo: 3, speed: 22, range: 8000, depth: 6, seek: 'active', cone: 30, acquire: 1500, dmg: 4000, blast: 12 }` (§8.5); trained outboard |
| nRadarAir | Air Search Radar | 4 × 1.2 × 1.2 | 2 | 3,000 | 400 | mast | `searchRadar: { range: 18000, rpm: 15, air: true }`: aircraft and missiles above `RADAR.lowAir` 100 m (§8.11) |
| nRadarFC | Fire-Control Radar | 1.2 × 1.2 × 1.2 | 1.2 | 3,000 | 300 | mast | `trackRadar: { range: 14000, cone: 0.5, missiles: true, sea: true }`, `aim` (it trains); guides VLS SAMs at aircraft and anti-ship missiles (S3) and ranges the guns on a ship (auto zero) |
| nRadarSea | Surface Search Radar | 2.4 × 0.6 × 0.6 | 0.8 | 2,000 | 250 | mast | `searchRadar: { range: 14000, rpm: 24, sea: true, low: true }`: ships, and anything under 100 m (sea-skimmers within 10 km, low helicopters) |
| decoy | Decoy Launcher | 1.2 × 1.0 × 1.0 | 0.8 | 1,500 | 200 | edge | `weapon: { kind: 'chaff', ammo: 12, flare: true }`: the countermeasure key fires a rocket pair of chaff (radar seekers) and flares (heat seekers) out to 300 m |

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
