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
  ring's centroid (§8.5). A bow without a stern sinks by the stern.

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
**Remaining (WP8):** a doomed ship (§8.8) is never moored and is stepped until she is gone or a wreck; a wreck on the bed
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
