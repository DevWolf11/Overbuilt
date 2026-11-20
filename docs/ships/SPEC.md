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
