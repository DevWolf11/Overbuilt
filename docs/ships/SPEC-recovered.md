# Ships update spec: RECOVERED FRAGMENTS

The original spec (scratchpad, ~20k words) was lost when the container was replaced. These are the parts recovered verbatim from the session transcript (by original line number), plus the sections the lead appended (§20, §20.1, §21). Missing sections must be re-derived from the code and the decisions here.

# Overbuilt: the ships update, design spec

Base: `main` at 71c3af7 (PR #52). Every `file:line` below was read on that commit. The three maps (`map-physics.md`, `map-combat.md`, `map-builder.md`) are the survey; this is the decision document built on them. Where the two disagree, this one wins, and where code disagrees with both, the code wins: check before you cut.

Reading order for an implementer: §0 (what was decided), §2 (kind and gates), the chapter for your work package, §13 (every hook), §16 (your package: files, interfaces, done-criteria).

---

## 0. The decisions, in one table

| Topic | Decision |
|---|---|
| Kind | `ship` (id), name **Ship**, `site: 'bay'`, `launchRot: 0`, frame as car/tank: **+x bow, +y up, +z starboard**. New `SEA_KINDS = new Set(['ship'])`, `isSea(kind)`. Not in `GROUND_KINDS`, not in `AIR_KINDS`. |
| File | `js/ship.js` after `drone.js`, before `builder.js`: `SHIP` (every tuning number) and `Ship` (the module), in sections: **core** (hydro physics, helm), **waves**, **builder** (hydrostatics, placement, warnings), **damage** (holes, flooding, damage control, fires, fate), **combat** (torpedoes, CIWS, anti-ship missiles, surface contacts), **hud**, **ai**, **mp**. |
| Marker fields | Every new part: `def.ship: true` **and** `def.gv: true` (so turrets, Aim, armour, crew, modules, repairs, X-ray and the zero-call proof all come for free). Floating comes from `def.hull` (hull segments, pontoons) only (not to be confused with `v.hull`, the vessel's contact points). |
| Floating flag | `v.hydro` (rebuildGroups): any part with `def.hull`, or a piece split off a hydro vessel. Without it, the sea is the old solid floor and nothing in ship.js runs. |
| Hull shape | `def.shull`: stations along part x (deck, keel, half-breadths, bilge exponent), sampled once by `shullOf(def)` in parts.js into rings that are the 2D path, the 3D loft, the clash loft, the hit slices and the buoyancy sections. 2D = 3D = what floats = what is hit. |
| Physics | Ring-by-ring buoyancy (exact polygon clip against a wave-sloped water plane), friction + wave-making resistance, lateral hull lift and cross-flow, strip planing lift, foils (rudders, hydrofoils) in their own routine at water density, screws/waterjets from shaft power, flood water as weight at free-surface-shifted centroids, added mass by acceleration scaling. Semi-implicit Euler at the existing 1/120 s step, every damping term exponential-equivalent and clamped. Grounding: the probe meets the sea **bed** for hydro vessels (one copy of the crash/rest rules). |
| Waves | One deterministic function `Ship.wave(e, n, t)`: 4 directional sines, deep-water dispersion, sea state Calm / **Moderate** (default, Hs ≈ 1 m) / Rough, faded in shallow water, zero on lakes. Same constants feed the GPU. |
| Sea drawing | A displaced swell patch (High 128², Low 64² cells) round the camera, only while a hydro vessel is within 2 km of the camera; the ocean is cut under it by a UV hole uniform. Off: pictures and cost exactly as today. Wake as ribbons (no particles), bow spray via `FX.splash`. |
| Units | Ship displays (HUD, builder, tray, death summary) speak **knots**; everything else stays km/h. |
| Death | Flooding, capsize, magazine, or out of action (no bridge). A doomed ship sinks by physics, then is removed 40 m down or when it lies on the bed (5 min wreck there). Pieces sink. |
| Combat | Naval guns 76/127/152 mm (and every ground gun works on a ship), CIWS that shoots missiles, torpedoes that swim and hit real hulls below the waterline, sea-skimming anti-ship missiles, vertical-launch SAMs, decoys. Belt armour as an opt-in hull field. Ships are surface contacts, never air contacts. |
| AI and play | Real-physics AI ships with a helm autopilot; the **Naval Range** off the Faroes (Practice / Hostile, strike aircraft); a **Naval Practice** battle; a multiplayer **Naval Battle** (`settings.game: 'naval'`, GroundMode reused with sea zones). |
| Helicopters on ships | Yes: helipad parts are moving decks (contact + lashing). Landing craft carrying a tank: **no** in this update (troops only); see §19. Crane/davit: no. Depth charges: no (no submarines; said in README). |
| Net | `NET_VERSION` 13 → 14. |
| Old designs | Byte-identical: every hook below is gated on `v.hydro`, `def.ship`/`def.shull`/`def.hull`, kind `ship`, `Combat.S.sea`, `Combat.S.pd`, `Ship.D.length`, `ai.sea`, `MP.naval`, or a message's new field. `Ship` joins `ground.test.js` SYSTEMS. |

---

## 1. What the player sees and feels

**Building.** A seventh button, **Ship**, opens five tabs: Ship hulls, Superstructure, Propulsion, Naval weapons, Ship kit (More shows every other tab: a tank gun, a jet engine, a rotor all go on). The blueprint is the side elevation, bow to the right, as Armour is. Tapping a hull segment adds it end to end (bow forward, stern aft); a blue **waterline** is drawn across the blueprint at the draft and trim the ship will actually float at, and the stats read *"4,620 t · draws 4.1 m · GM 1.3 m · ~29 kn · 2 compartments open"*. Warnings say it plainly: *"Top-heavy: GM −0.4 m, she will capsize"*, *"The stern is open: she will flood"*, *"No screw or waterjet: nothing pushes her"*. A 150 m destroyer fits a 360 px phone. Built in 3D, the hull is a smooth loft: haze grey above a black boot-top, antifouling red below.

**Launching.** A ship starts in the bay west of the island, already floating at her marks, bow out to sea. The water near you now has real swell (gentle by default): a RIB bobs and slaps, a patrol boat pitches, a destroyer barely moves. Speed builds slowly: W/S ring the engine-order telegraph (Stop, Slow, Half, Full, Flank; Slow/Half/Full astern), A/D put the rudder over; let go and she holds the new heading. A planing boat climbs onto the plane with a bow-up hump and then skims; a hydrofoil rises out of the water at 30 knots. Turning heels her outward. A wake spreads behind, spray flies from the bow, funnels smoke.

**Fighting.** With guns aboard, the view is the tank's aim view: the turrets follow the mouse (or your finger), the gun reticle and shell chips are the tank's, but the aim ray reaches 20 km. The horizon is close at 1/20 scale: a ship's masts show at about 7 km and radar sees a little further, so fights happen at 2–7 km. Shells arc, splash, and hit plate by plate. Hits below the waterline make holes; water pours in; she lists toward the flooded side and trims down by the bow or stern, all from physics. Damage control parties patch holes and fight fires; pumps push water out; the HUD's hull diagram fills blue compartment by compartment. Let it go too far and she rolls over or goes down by the head; hit a magazine and she breaks in two, each half sinking on its own. Torpedoes leave a bubbling track; CIWS mounts buzz at incoming missiles; chaff blooms.

**Playing.** Sandbox launches at the bay, the headland slipway, Shetland's harbour, off the carriers and off Caithness. The **Naval Range** (practice targets steaming about east of the islands, or Hostile waves that shoot back and strike aircraft that bomb you) teaches it. The **Naval Practice** battle pits you and two computer ships against three. Online, a **Naval Battle** puts teams on opposite sides of Shetland Sound to fight over three zones at sea, with aircraft joining if the host allows.

**Everything mixes.** A tank gun on a ship aims; a naval 127 mm on a tank fires (and rocks it); a boat hull under a tank makes it float; pontoons make a seaplane that really floats and planes off the water; stubby wings on a ship give real lift (not enough to fly); jet engines on a hull make a jet boat; a helicopter lands on a frigate's deck underway and stays there.

---

## 2. The kind, the flag and the gates

### 2.1 Data (parts.js)
- `PART_CATEGORIES` (parts.js:5-33): insert five tabs **between `drPay` and `radar`** (radar must stay last: radar.test.js:57; ground and drone slices `slice(13,21)` / `slice(21,25)` unchanged):
  `{ id: 'shHull', name: 'Ship hulls' }, { id: 'shSuper', name: 'Superstructure' }, { id: 'shDrive', name: 'Propulsion' }, { id: 'shArms', name: 'Naval weapons' }, { id: 'shKit', name: 'Ship kit' }`. Category count 26 → 31.
- `VEHICLE_KINDS.ship = { id: 'ship', name: 'Ship', site: 'bay', launchRot: 0, cats: ['shHull', 'shSuper', 'shDrive', 'shArms', 'shKit'] }` (after `drone`).
- Beside `GROUND_KINDS`/`AIR_KINDS` (parts.js:47-55):
  ```js
  // The kinds that sail (the ships update): ship.js floats any craft with a hull part; this only says what a craft *is*
  // (surface contact, never an air target; zones at sea; the helm keys and HUD)
  const SEA_KINDS = new Set(['ship']);
  function isSea(kind) { return SEA_KINDS.has(kind); }
  ```
- Check the new globals are unique: `grep -n "^const SEA_KINDS\|^function isSea\|^const SHIP\b\|^const Ship\b\|^function shullOf\|^const NAVAL_STOCK" js/*.js`.

### 2.2 The per-vessel flag (vessel.js)
- Constructor (vessel.js:235-236, with the gv defaults): `this.hydro = false; this.sh = null; this.hF = null; this.hT = null; this.ciws = NO_GEAR;`
- `rebuildGroups` (vessel.js:330):
  - `this.aircraft = this.wings.length > 0 && this.kind !== 'tank' && this.kind !== 'ship';` (vessel.js:356; a ship with wings is never flown by `planeTarget`).
  - after the gv block: `this.ciws = this.gv ? this.parts.filter((p) => p.def.ciws) : NO_GEAR;`
  - after the drone line (vessel.js:367): `this.hydro = this.parts.some((p) => p.def.hull) || !!this.hydroFrom; if (this.hydro) Ship.groups(this); else this.sh = null;` (before `recompute`, which Ship.groups does not need).
- `PILOT.ship = pilotFrame([1, 0, 0], [0, 1, 0], ['pitch', 'roll', 'yaw'], [0.25, 0.25, 0.25])` (vessel.js:137-145; as the tank: only reaction wheels in the air use it).
- `splitComponents` (vessel.js:1710): each new piece gets `nv.hydroFrom = this.hydro` before its `rebuildGroups` (so a turret blown off a ship sinks instead of sitting on a solid sea).
- Old vessels: `hydro` stays false, `sh` null, `ciws` `NO_GEAR`. Add these three to ground.test.js's "old vessels carry the new fields' defaults" (ground.test.js:158).

### 2.3 What `isSea(kind)` decides vs what `v.hydro` decides
- **`v.hydro` (physics, from parts):** buoyancy, hydro forces, bed contact, flooding, holes, sinking, wake, swell drawing, decks. A tank with a hull floats; a ship with no hull sits on the old solid sea (and the builder warns).
- **`isSea(kind)` (what the craft is):** helm controls and HUD, the aim mode gate, target classification (surface, never air), zone capture at sea, the hangar group, knots, the "Sunk" wording, sandbox/battle placement at sea.
- **Weapons and kit** follow parts as they always did (`v.gv`, `v.ciws`, `def.aim`).

---

## 3. Hull geometry: `def.shull` and `shullOf(def)`

### 3.1 Data shape
All lengths in metres in the part's own frame (origin at the part's box centre, x along the part's w toward the bow, y up, z across; depth = beam):
```js
shull: {
  cls: 'M',            // joint class: segments of one class meet section to section ('S', 'M', 'L', 'X'; 'one' for one-piece hulls)
  wl: -0.4,            // y of the design waterline (boot-top, builder marks; the flare split below)
  st: [                // stations, x ascending (stern → bow): [x, yd (deck), yk (keel), bd (half-breadth at deck), bw (half-breadth at wl), nb (bilge exponent)]
    [-4, 2.0, -2.0, 3.5, 3.45, 1.2],
    [ 4, 2.0, -2.0, 3.5, 3.45, 1.2],
  ],
  ends: { aft: 'joint', fore: 'joint' }, // 'joint' (meets the next segment), 'closed' (a transom or stem), 'ramp' (the landing craft's bow)
  plane: true,         // a planing bottom (strip planing lift at full strength, §4.4)
  k: 0.15,             // form factor on friction (boxy hulls 0.3)
  pump: 0.01,          // built-in bilge pump, m³/s
  hp0: 'segment',      // (documentation only)
}
```
The **section** at a station: the deck is flat at `yd` across ±`bd`. Above `wl`, the side runs straight from (`bw`, `wl`) to (`bd`, `yd`) (flare when `bd > bw`, tumblehome when less). Below `wl`, the bilge is the superellipse quadrant `hb(y) = bw · (1 − ((wl − y)/(wl − yk))^nb)^(1/nb)` from (`bw`, `wl`) to (0, `yk`): `nb = 1` is a straight V (deadrise from the chine), 2 an ellipse, 4–8 a flat bottom with round corners. If `yk > wl` at a station (the stem's forefoot rising above the waterline), the section is the straight-sided part above `yk` only. Every section is convex (checked by catalogue.test).

### 3.2 The sampler (parts.js, pure, cached per def)
`shullOf(def)` returns `{ rings, nr, K, phys, x0, x1, wl, vol, comp }`:
- **Rings**: stations interpolated linearly to one ring per `max(0.5, w/24)` m (at least every station). Each ring: `x`, a convex polygon `P` (Float32Array of `[y, z]` pairs, counter-clockwise seen from the bow, `K` points: the keel point, `nk` bilge points per side (High: 5, the same for physics), the waterline point, the deck edge per side; K = 2·(nk+2)+1 = 15), its full area `A`, centroid `(cy, 0)`, half-perimeter below deck.
- **phys**: the subset of rings physics uses: `n = clamp(round(w/4), 3, 8)` rings evenly spaced (the end rings at `x0`, `x1`), each with its trapezoid length `dx`.
- **vol**: the closed volume to the deck (m³), and a fill table `vol(y)` (16 heights from keel to deck) for flood levels.
- Used by (and nothing else redraws a hull another way):
  - `partPath0` (parts.js:2485): `if (d.shull) return shullPath(ctx, d)`: deck line stern→bow, the stem, keel line bow→stern, the transom. This is the 2D outline, so `partOutline`/`clashShape` take it.
  - `drawPart0` (parts.js:2668): `if (d.shull) return shullDraw(ctx, d, …)`: side plating colour (paint), boot-top band at `wl ± bt` (bt = 0.25 m S, 0.4 m M, 0.8 m L/X), antifouling red below, the deck edge, weld seams every 4 m, a hawse pipe on bows; X-ray (builder `bXray`): compartments, bulkheads, belt band.
  - `clashShape` (parts.js:1691): add `'shipHull'` to the loft list (`r === 'us5' || r === 'ruLoft' || r === 'us4body' || r === 'shipHull'`): the side outline across the full beam. Conservative at the bow; the builder-shapes vertex test (model within 1.5 cm of its clash shape) holds because the loft lies inside.
  - `PART_RECIPE.shull = 'shipHull'` (parts.js:1548); `parts3d.js` `BUILD.shipHull` lofts the rings (§12.6).
  - `computeHull` (vessel.js:407): `if (d.shull) { shullPts(p, add); continue; }` (before the gv outline branch): per phys ring, the keel point and both deck edges, and both waterline points on the end rings. Old parts never have `shull`: `fingerprint.json` unchanged.
  - armour.js hit slices (§8.3), ship.js buoyancy (§4.2), builder hydrostatics (§11.3).
- `shullOf` handles the part's `rot` (quarter turns) and `flip` (no flip: gv parts force `flip = false`) through `partPt` when ship.js transforms rings into part space in `Ship.groups`.

### 3.3 Joints, compartments, open ends (Ship.groups)
- Two hull parts **join** when they are adjacent (`v.adj`), share `cls`, and the fore end of one lies within 2 cm of the aft end of the other in x, y (keels level) and z. A joined end is sealed.
- Each hull part is one watertight **compartment**, cut in two at each `bulkhead` part hosted on it (`att` = the hull's id) at the bulkhead's x. One-piece hulls (pontoon, landing craft) are one compartment unless bulkheaded.
- An end that is `'joint'` but unjoined (the builder forgot the stern, or a segment was shot away) is an **open end**: a permanent hole of the end ring's area below the deck, at the end ring's centroid (§8.5). A bow without a stern sinks by the stern.

---

## 4. Physics (ship.js §core)

### 4.1 Where it runs (vessel.js `physicsStep`, vessel.js:1121)
Order inside one step, new lines marked ★:
1. star check; gravity.
2. `if (this.kind === 'drone' …) Drone.pre(…)`.
3. ★ `if (this.hydro) Ship.pre(this, dt, sim);` the helm (telegraph, rudder, autopilot, ride control); sets `v.throttle` for air engines on a ship from the telegraph.
4. `applyEngines`, `spinRotors` (air engines on a ship push exactly as they do anywhere: an airboat works).
5. control: `turnTarget` ★ returns `null` first thing for `this.hydro && this.kind === 'ship'` (vessel.js:638, beside the gear line): the rudder steers, not reaction torques. A hydro plane keeps its laws.
6. aero block unchanged (the hull's air drag, wings' real lift with ground effect over the sea).
7. ★ `if (this.hydro) Ship.forces(this, dt, vb, wb, sim);` writes `this.hF`, `this.hT` (part axes) and `this.sh.fsub` (submerged share of the weight, 0..1).
8. `updateHeat`.
9. integrate (vessel.js:1381-1400):
   - after `this.lift = …` (vessel.js:1384) ★ `if (this.hydro && this.hF) { const H = qrot(this.q, this.hF.x, this.hF.y, this.hF.z, _t3); ax += H.x * im; ay += H.y * im; az += H.z * im; }` so `this.lift` stays aerodynamic (Death's air rule reads it) while `gForce` includes buoyancy.
   - ★ added mass (§4.7): after `ax/ay/az` are final, `if (this.hydro && this.sh.fsub > 0) Ship.addedMass(this, ax, ay, az, gk)` returns the scaled acceleration into `_am`; the velocity update uses it.
   - ★ `if (this.hydro && this.hT) { T.x += …; T.y += …; T.z += …; }` before `gyro`; and the same added-inertia scaling on `dw`.
10. `ground()` with the hydro probe gate (§4.8).
11. rips.

### 4.2 Buoyancy, ring by ring
Per step, per hydro vessel `v`, with `S = v.sh`:
1. **Frame.** Once per step: `Terrain.locate` of the vessel → `(e0, n0)` (e = −wrapAngle(a − padAngle)·R, n = −z, game north), the local up `U`, east `E`, north `N` unit vectors in sim axes, turned into part axes (`qunrot`): `Ub, Eb, Nb`. `h0 = r − R − S.level` (the COM's height above still water; `S.level` is 0 at sea, the lake's surface inland), refreshed with the depth and the wave fade `S.fade` every 0.5 m moved (Gear's cache pattern, gear.js:251-261): `S.depth = S.level − Terrain.heightAt(…)`, `S.fade = Ship.fadeAt(depth)` (§5.2), `S.lake` (waves 0).

[... original lines 141-719 lost ...]

## 14. Invariants and their proofs
- **Old designs byte-identical**: `traces.json`, `fingerprint.json`, `handling.json`, `driving.json` (`buggy sea`, `buggy headland`: the solid sea), `combat.test.js` (the frigate's SAM, the range torpedo), `mp-air.json`, `groundcombat.json`, `death.test.js` A7 and B3 (a burning craft on the sea, hulks afloat) all **unchanged**; the new templates appear in fingerprint/traces as **added keys only**, proven with `node test/tools/keydiff.mjs <base> --add fingerprint:<key>,traces:<key>` for the nine keys.
- **Zero calls** (above). `test/lib/game.js` gains a `ship: false` option (no ship.js, as `drone: false`); `ships.test.js` runs every old template's 12 s trace with and without ship.js and finds them identical (every gate is either a hydro/def test or `typeof Ship` guarded).
- **2D = 3D = clash = hit = buoyancy for hulls**: catalogue.test (sections convex, joints match), builder-shapes (model vs clash), ships.test (`hullRay` against the loft's own triangles at 200 random rays: same entry within 2 cm; buoyancy of a fully sunk hull = `ρ·g·shullOf(def).vol` within 0.5 %).
- **The solid sea for everyone else**: a Seagull, a buggy, an amphibious Pumo and a splashing rocket behave as before (driving, ground.test water section, death.test A7/B3).
- **Wave agreement**: §5.2's packer test and the browser seam check.
- **No magic radar** holds: ships are never air contacts; naval radars are parts.
- **Peers untrusted**: `ho`, `mkill`, `down.sea`, `stor` shots and `settings.sea` cleaned (finite, ranges, our own parts, enemy only); no peer text in `innerHTML`.
- **Props deterministic**: the sea spawns add no props (keep-outs unaffected); spawns.test checks the sea spots' depth instead.

---

## 15. Performance budget (phone first)

Measured on the bench rig (desktop; phone = 4× CPU throttle) before/after; numbers are budgets the PR must meet:
| Item | Budget |
|---|---|
| Old scenes (every existing render-bench scene, graphics.mjs) | identical pictures and within ±2 % frame time (no swell, no hole, no wakes) |
| `Ship.forces` for the Arley Berk (35 phys rings, 4 sines each) | ≤ 0.04 ms desktop / 0.16 ms phone per step |
| A Naval Range Hostile wave (player + 3 AI ships, LOD) | physics ≤ 1.5 % of a desktop core, ≤ 8 % on the phone at 120 Hz |
| Flooding, fires, DC, fate | 10 Hz / 4 Hz, ≤ 0.02 ms per ship per call |
| AI think | 4 Hz, ≤ 0.1 ms per ship; look-ahead 9 `heightAt` a second |
| Swell patch | GPU ≤ +5 % frame time over the flat sea in `sea300` on phone Low; CPU recentre ≤ 2 ms (≤ every 4 s at 30 kn) |
| Wakes | ≤ 6 ribbons, 1 draw call each, ≤ 0.1 ms CPU |
| Spray and smoke | within FX's caps (900 High, 350 Low), ≤ 30 particles/s per ship within 800 m |
| `Aim.limits` for the Arley Berk | ≤ 30 ms once at launch (cached per template for the AI) |
| Hull art | vertex colours, no texture per hull (no 512 px cap problem) |
New bench scenes: `ship1k` (the destroyer at 25 kn, camera 1 km off), `shipnear` (chase cam on the Zodiak at 40 kn, Moderate), `fleet` (Hostile wave 3 from the player's bridge), `seaRough` (camera at 20 m over Rough sea, no ship near: proves the swell is off).

---
## 16. Phases and work packages

One branch for the update (`ships`), one PR at the end (as PR #47 was built), each package in its own worktree off the branch's tip at the start of its phase, merged back by the lead in the order given. **Ownership rule**: a package edits only the files (or the named regions of shared files) listed as its own; anything else goes through the lead or the interface. Shared files are split by named function or `// ==== region ====` markers, which the contract commit (WP0) adds to ship.js, parts.js (data regions per tab) and armour.js.

### Phase 0: the contract (lead, sequential, first)
**WP0 Contract.** Owns everything it touches; lands before anyone forks.
- `js/ship.js` skeleton: header comment (handbook style), the sections (`// ==== core ====`, `waves`, `builder`, `damage`, `combat`, `hud`, `ai`, `mp`), `SHIP` with every number in this spec, and the **whole `Ship` API as stubs** (signatures and return shapes below; no-ops returning defaults), so every later package compiles against it.
- parts.js: `SEA_KINDS`/`isSea`, `VEHICLE_KINDS.ship`, the 5 tabs, `shullOf` + `shullPts` (sampler and points, pure), the def fields documented in a comment, the **slice-1 parts**: `hbBowM`, `hbMidM`, `hbSternM`, `bridgeM`, `dieselM`, `screwM`, `rudderM` (data only; boxes for art until WP2).
- vessel.js: constructor defaults, `PILOT.ship`, rebuildGroups (`aircraft`, `ciws`, `hydro` → `Ship.groups`), computeHull's `shullPts`.
- builder.js: template `cyclon` in its slice form (hull + bridge + 2 diesels + 2 screws + 2 rudders, unarmed; WP5 arms it and re-baselines its own new keys inside the branch: against `main` the final keydiff shows added keys only).
- index.html (script tag after drone.js, the kind button), sw.js (`SHELL` + `js/ship.js`, `CACHE` v41), ui.js `ICONS.ship`, style.css 7-column strip.
- tests: `test/lib/game.js` loads ship.js (line 33) and exports `Ship`, `SHIP`, `SEA_KINDS`, `isSea`, `shullOf` (line 84-86), a `ship: false` option; ground.test SYSTEMS += `'Ship'`, the category count 31, `hydro` default; catalogue count; core.test template order rule rewritten; new keys in fingerprint/traces with keydiff proof.
- Done: `node test/run.mjs` green, every old baseline key identical.

**The Ship API (WP0 stubs; owners in brackets)**
```js
Ship = {
  D: [],                                   // decks (WP6)
  // core [WP1]
  groups(v), pre(v, dt, sim), forces(v, dt, vb, wb, sim), addedMass(v, ax, ay, az, gk, out), floorAt(b, a, z, alt), floorNormal(b, a, z, o),
  overWater(v), launch(v, place), seaPlace(v, e, z, yaw), drift(v, h, F), stab(v), impactSea(v, parts, sim), bump(F),
  // waves [WP1]
  wave(e, n, t, out), seaT(F), setSea(state), sea(), fadeAt(depth), waveUniforms(P0e, P0n, t, out),
  // builder [WP4, WP7]
  stats(parts), hydrostatics(parts), spotOf(type, parts, at), warnings(ps, stats, warn), specs(def), line(def),
  // damage [WP8]
  hullRay(p, A, B, H), hullMm(p, edge, u), hullDist(v, p, at), addHoles(v, holes), floodStep(v, dt, sim), fireStep(v, dt, sim),
  dcStep(v, dt, sim), fateStep(v, dt, sim), doom(v, sim, why, by), magazine(v, sim, part),
  // combat [WP9]
  fireTorp(v, p, F), torpStep(s, h, F), torpHit(s, a, F), ciwsStep(F, dt), shotMissiles(s, a, e, F), surface(v, F), seesSea(a, b), rcs(v),
  // frame [WP1 core loop; others add their calls]
  frame(F, dt),                            // from Combat.frame when S.sea: bump, flood/fire/dc/fate (10/4 Hz), moor checks, AI, range
  fx(v, dt, F),                            // [WP2] spray, smoke
  // hud [WP3, WP12]
  hud(F), help(F), keys(F, e, down),
  // ai [WP10]
  aiDown(v, F), flyStriker(v, F, dt), range(F), practice(opts), battle,
  // mp [WP11]
  snap(v), unsnap(g, m), ghost(g), downSea(v), onDownSea(m), cleanHoles(rows, v),
};
```
Per-vessel state `v.sh` (built by `Ship.groups`, read by all): `{ rings (Float32 arrays, part space), comps: [{ parts, x0, x1, V, W, holes }], thrust: [screws, jets, outboards], foils, rudders, engines, decks, tel, rud, hold, dcPri, ciwsOn, fsub, B, Lwl, Swet, draft, level, depth, fade, moorT, … }`. Saved per part: `p.holes`, `p.water` (its compartment's W), `p.rud`, `p.fire` (GV_SAVE); per vessel: `sh: { tel, dcPri, ciwsOn }` and `sas`.

### Phase 1: hulls that float (the playable slice). Four packages in parallel.
| WP | Owns | Interfaces | Tests | Done when |
|---|---|---|---|---|
| **WP1 Hydro core** | ship.js `core`, `waves`; vessel.js physicsStep/turnTarget/ground/splitComponents hooks; flight.js `update` far list, `stepsNear`, `physicsTick`, `canRails`, `railsAdvance` (not `start`: WP3 adds the `Ship.launch` call there); combat.js `frame`'s `S.sea` and `Ship.frame` lines | Ship core API; `v.sh` layout | `test/ships.test.js` §hydro (box hull draft ±1 %, GM ±3 %, roll period ±15 %, settle, waves, no NaN in Rough 600 s, grounding, moored/warp, far AI not railed, pieces sink); ground.test zero calls | the slice ship floats at her marks, steams at ~30 kn on the slice's power, turns, holds heading, runs aground without exploding |
| **WP2 Sea rendering** | render3d.js (swell, `uSeaHole`, wakes, aim camera reach), parts3d.js `BUILD.shipHull` (+ screws/rudders animation), parts.js `shullPath`/`shullDraw` region and clashShape line, world.js nothing new, ship.js `fx` | `Ship.wave`, `waveUniforms`, `v.sh` (tel, rud), `p.rpm`, `p.rud` | browser `water.mjs` §swell (seam, agreement), `graphics.mjs` old scenes identical, `builder-shapes.mjs` for the slice parts, bench `seaRough`, `shipnear` | waves drawn near a ship agree with her bob; old scenes unchanged; hull looks right in 2D and 3D |
| **WP3 Helm, HUD, launch** | flight.js `start` (name, yaw, sas, the `Ship.launch` call), `groundTick`, `readControls` ship keys, `updateHUD` call, help/shipHelp, death words, knots; controls.js Ships rows/clash/LATE/CTL/keyHints; main.js help, tip, Settings "Sea"; ship.js `hud` (helm panel); style.css ship HUD; space.js `EARTH.spawns` sea entries; mpui.js `Spawns.place` sea branch | `v.sh.tel/rud/hold`, `Ship.pre`'s inputs (`ctl`, `Ship.keys`) | `controls.mjs` ship layouts; `spawns.test` sea spots (depth > draft + 2 m along each ship); `ship-flight.mjs` (launch, telegraph, rudder, HUD, console clean) | launch at the bay and steer with keys and a phone's controls; help lists the keys |
| **WP4 Builder basics** | builder.js kind wiring (§11.1), stats rows, waterline overlay, warnings dispatch; ship.js `builder` (`stats`, `hydro`, `spotOf` for `keel`/`deck`/`inside`/`stern`, `warnings`); index.html stat rows | `shullOf`, `Ship.stats` | `builder-ship.mjs` (strip, tabs, quickAdd chain, fit a 152 m hull at 360×640, stats, warnings), ships.test §builder (stats vs flight draft ±10 %) | you can build the slice ship by tapping, see her waterline and speed, and launch |

Phase 1 done: the slice is fun to drive at the bay on a phone and a desktop; `node test/run.mjs` and the browser suites touched are green; old baselines identical. Lead merges WP1 → WP4 → WP3 → WP2.

### Phase 2: parts and models. Three packages.
| WP | Owns | Tests | Done when |
|---|---|---|---|
| **WP5 Catalogue and non-combat ships** | parts.js data regions `shHull`, `shSuper`, `shDrive`, `shKit` (non-weapon), their 2D art and 3D models (parts3d), paints; templates zodiak, cyclon (unarmed→armed with existing guns), higgens, pegazus (foils), catalyna | catalogue.test (counts, sections convex, joints match), builder-shapes, ships.test trials for these five (speed, turning, planing, foilborne), traces/fingerprint keys added | every non-weapon part exists, looks right, floats or does its job |
| **WP6 Propulsion, foils, decks, collisions** | ship.js `core` additions (outboard, waterjet, turbine spool, foils and ride control, `bump`, carriers' boxes, `impactSea`, decks and lashing, tiny pieces); vessel.js deck contact and solver `dv` line; flight.js `physicsTick` lash line; gear.js hydro gate | ships.test: hydrofoil foilborne at > 30 kn and stable; RIB planes (trim 2–6°, half its hull out); a helicopter lands on the Olivar Perri underway at 15 kn and stays 60 s; two ships colliding bounce and dent; ramming a carrier; amphibious tank with a hull floats and drives up the slipway | — |
| **WP7 Builder complete** | builder.js specs, tray lines, X-ray, hangar group, `shipClass`, `pickKind`; ship.js `spotOf` for every `place`, `warnings` complete | builder-ship.mjs full; ships.test spotOf for every part | every ship part has a sensible tap placement and warning |

### Phase 3: combat. Two packages (merge WP8 first).
| WP | Owns | Tests | Done when |
|---|---|---|---|
| **WP8 Damage, flooding, sinking** | ship.js `damage`; armour.js `recsOf`/`test`, `faceMm`, `resolve` holes, `apply`, `postPen` L, `knockOut` line, `repairStep` line; combat.js `explode` (distance, holes), `damage` path checks; death.js `impact` and `groundTick` lines; flight.js `afterFall` ship wait; parts.js `massPerMm` belt | ships.test §damage: holes from each weapon class (areas), flooding equilibria (1 m² hole 1 m deep in the frigate: lists, survives; 3 compartments: sinks in < 300 s), free-surface capsize, pumps and DC timings, magazine break-in-two, doom reasons, wreck on a shallow bed vs removal in deep water, derelicts; armour.test unchanged; death.test A7/B3 unchanged | ships die by water, fire and magazines, as physics says |
| **WP9 Naval weapons and sensors** | armour.js SHELLS region (naval keys), `moveShell` CIWS line, `legacyHit` `'asm'`; aim.js `shellTable`, `aimLift`/`solve` gate, `stepAll` AI line, `step` autoP, `fire` torp, search/track `sea`; combat.js `isFighter`, `candidates`, `swim` gate, shot loop `'stor'`, `launchMissile`/`guide`/`guideAir` flags, `frame` `S.pd`; radar.js classification; ghud.js 20 km ray, zero, torpedo line; ship.js `combat`; parts.js `shArms` region + `nRadar*`, `decoy`, `torpDecoy`; templates osca, vizby, olivar, arley | ships.test §combat (127 mm table hits at 5 km within one hull length; CIWS kill odds; torpedo homing and hull hit; old air torpedo hits a ship; ASM sea-skims and hits; VLS pitch-over; classification: ship ghosts never air candidates nor air radar contacts; damage targets §8.11; a TK-34 with a 127 mm gun hits at 3 km); combat.test/radar.test unchanged | the four warships fight as §8 says |

### Phase 4: AI, play, multiplayer, polish. Three packages.
| WP | Owns | Tests | Done when |
|---|---|---|---|
| **WP10 AI, range, practice** | ship.js `ai`; combat.js `frame` AI-loop lines, `aiDown` line; groundai.js `aimAt` factored out (no behaviour change: groundcombat.json identical); space.js `EARTH.navalRange`; mpui.js the Naval practice button; career.js awards | `navalai.test.js` (helm reaches waypoints, avoids land at the islands, keeps range, hits a target at 4 km within N salvos by skill, torpedoes, evades), browser `naval-range.mjs`, bench `fleet` | Practice and Hostile ranges and the practice battle play end to end |
| **WP11 Multiplayer** | mp.js, mpui.js lobby/settings/placement/respawn, net.js NET_VERSION, gmode.js (kinds, gap/row, pickNaval), space.js `EARTH.arenas.sound`, ship.js `mp` | `mp.test` naval trace → new `baseline/mp-naval.json` (two ships, a shell exchange with holes, a torpedo, a CIWS kill, a sinking `down`); `mp-air.json` identical; gmode.test naval placement and capture; `net.test` unchanged; browser `naval-battle.mjs` (two tabs) | a 1v1 naval battle plays in two windows |
| **WP12 HUD and feel** | ship.js `hud` (hull diagram, banners, torpedo HUD hooks), ghud.js torpedo drawing (after WP9's mechanics), audio.js, controls.js touch buttons (`hold`, `dc`, `ciws`), style.css | controls.mjs at all sizes, ship-flight.mjs screenshots looked at, redraw.mjs | it reads clearly on a 360×640 phone in portrait |

### Phase 5: docs, review, ship (lead + reviewers)
- **WP13**: README, HANDBOOK §11, CLAUDE.md, ROADMAP, test/README, sw.js final `CACHE`, the history row; then the **adversarial review** (independent reviewers write repro scripts trying to break: old designs, the solid sea, MP hostility checks, NaN in physics, saves round-trip, performance), fix, verify, benches before/after, the PR body with tables.

---

## 17. Test plan

### 17.1 Node suites (added to `test/run.mjs` lists, documented in `test/README.md`)
- **`test/ships.test.js`** (new), sections:
  - *hydro*: an analytic box hull (a test-only def with `nb` 50: rectangular) floats at `m/(ρ·L·B)` ±1 %, GM ±3 % of `B²/(12T) + T/2 − KG`, roll period ±15 %; every stock ship settles in 20 s within §7's marks; no NaN or runaway energy in 600 s of Rough sea stopped and at full speed; grounding at 10 kn on the island's shore stops her, `landed`, no part removed below 1.5× the limit; tiny pieces; moored drift and wake-up; warp with a moored ship; far AI not railed.
  - *trials*: speed, turning, stopping, planing, foilborne (§7 balance targets).
  - *waves*: `Ship.wave` deterministic, Hs per state ±10 % from 10,000 samples, fade 0 in harbours and on lakes; `waveUniforms` agrees with `wave` within 1 mm.
  - *builder*: `Ship.stats` draft/GM/top speed vs flight (±10 %/±0.15 m/±12 %); `spotOf` for every ship part's `place` on an empty, a hulled and a full design; warnings fire for each case in §11.3.
  - *damage* and *combat*: §16 WP8/WP9 lists, seeded.
  - *cross-kind*: TK-34 + 127 mm gun; a tank with a hull floats; Catalyna floats, planes and lifts off at ~70 kn; a ship with two `wingStraight`s at full speed has wing lift < 30 % of her weight; jet engines on an hbBowS/Mid/Stern hull push it (an airboat); a helicopter on a moving deck; a tank turret (ringM + gun75) on the Cyclon aims via `groundAim`.
  - *gates*: every old template with and without ship.js loaded: identical traces; `Combat.S.sea`/`S.pd` never open; `hydro === false`.
- **`test/navalai.test.js`** (new): §16 WP10.
- Extended: `catalogue.test` (counts 441/140, ship part field checks), `core.test` (67 templates, order rule, every ship template joined, editable, priced in tier, floats), `ground.test` (SYSTEMS, categories 31, defaults), `gmode.test` (naval arena, capture by `ship` kind afloat, gap/row placement; `'boat'` still doesn't capture), `spawns.test` (KINDS + ship, sea spots' depths and ship-length clearance), `mp.test` (`mp-naval.json`), `fx.test` (caps with spray), `death.test` (A7/B3 unchanged; a ship's doom path), `armour.test`/`aim.test` (unchanged for old shells; naval shells' tables).
- Baselines: new `baseline/ships.json` (each stock ship's 60 s pose/speed trace: settle 10 s, full ahead 30 s, hard rudder 20 s, Moderate sea, seeded) so later changes are pinned; `mp-naval.json`; fingerprint/traces new keys only.

### 17.2 Browser suites
- `builder-ship.mjs` (WP4/WP7), `ship-flight.mjs` (launch, waves on screen, wake, HUD, aim and fire, sinking screenshot; `App.frame` console clean), `naval-range.mjs` (Practice: sink a target; Hostile: survive a wave for 60 s of `Flight.time`), `naval-battle.mjs` (two tabs, BroadcastChannel), `water.mjs` §swell (seam, old water identical with no ship), `controls.mjs` (ship HUD sizes), `graphics.mjs` (old scenes identical), `builder-shapes.mjs` (new parts; More shows 32 buttons: 31 tabs + Fewer; the phone More list gets `'ship'`), `builder-tank.mjs:286` (7 buttons), `redraw.mjs` (the waterline and turret arcs redraw on change).
- Headless runs at ~0.08× real time: measure `Flight.time`; `Render3D.skipDraw = true` where the picture doesn't matter.

### 17.3 Bench
- `test/bench/render-bench.mjs`: `ship1k`, `shipnear`, `fleet`, `seaRough` (§15), phone and desktop, High and Low, before/after; `test/bench/naval-bench.mjs` (from `ground-bench.mjs`): physics ms per step per ship at 4× throttle, AI think cost.

---

## 18. Chores (in the same commits as the changes)
- **README.md**: "What's in it" gains a **Ships** bullet ("a seventh kind of craft"); the builder line's kind list and the hangar count ("sixty-seven examples": the ship group listed); "441 parts in thirty-one categories" with the five ship tabs' sub-bullets; the Controls table's **Ships** block (from the bindings) and the touch description; Multiplayer: the Naval Battle and the sea state; Modes: the Naval Range and Naval Practice; Project layout: a `js/ship.js` line; "Ideas for later": remove "boats", add "submarines (and depth charges)" and "landing craft that carry a tank"; "no depth charges: there's nothing under the water to hit yet".
- **sw.js**: `CACHE` `overbuilt-v41` (bump again at every later cached change), `SHELL` + `'js/ship.js'` after `'js/drone.js'`.
- **index.html**: the script tag, kind button, stat rows, `#mp-create-naval`.
- **CLAUDE.md**: the architecture table row for `ship.js` (and the parts.js/builder.js counts: 441 parts, 140 gv, 59 ship; 67 templates, 8 ships + a flying boat); the Coordinates note (ships: as cars and Armour); an Invariant "**The ship code is shut for old designs**" naming the gates (§13) and the proofs (§14); console handles (`Ship`, `SHIP`, `v.sh`, `Combat.S.sea`, `Combat.S.pd`, `Ship.D`, `Ship.wave`, `Render3D.info().swell`); the History row; the Gotchas: "the swell patch is the sea only near a ship: anything that changes how the ocean is drawn must keep `uSeaHole` and the swell agreeing".
- **docs/HANDBOOK.md**: a new **§11 Ships** in the format of §8 and §10 (files, where old code calls in, gates, data, physics, waves, damage, builder, AI, MP, invariants, tests), and §1.2 (catalogue), §1.5 (templates and codes), §5.1 (script order), §5.8 (README counts), §6 (tests) updated.
- **docs/ROADMAP.md**: the ships entry (if one exists by then) moved to History; add submarines, a vehicle deck, cranes as future ideas.
- **Duplicate globals** checked (`grep -n "^const NAME\|^function NAME" js/*.js`) for `SEA_KINDS`, `isSea`, `SHIP`, `Ship`, `shullOf`, `shullPts`, `shullPath`, `shullDraw`, `NAVAL_STOCK`.

---

## 19. Design concerns and open risks

**Where the decisions are pushed on (none reversed, three amended):**
1. **Decision 10, the landing craft carrying a tank: no, in this update.** A tank on a moving deck needs Gear-on-deck contact (tracks against a moving vessel) or a lashed second craft with a drive-off and the drone-style second-craft MP messages. Doing it well is a package of its own; done badly it's the feature the owner will break first. The Higgens carries troops (which already capture zones) and lowers its ramp when beached. Recommended as the first follow-up ("vehicle deck": `def.vdeck`, a lashed stock or saved Armour design that drives off down the ramp at a beach, the drone bay's patterns reversed).
2. **Decision 9, the crane/davit: dropped** (no physics need; cosmetic only). **Helipad: kept**, but it is real new physics (moving-deck contact and lashing, §6.2/WP6) with its own tests; if WP6 runs late, ship it with lashing only for helicopters landing at < 3 m/s relative and say so.
3. **Decision 6, flood water as mass: amended to "as weight"** (a force at the free-surface-shifted centroid, not part of `v.mass`). Statics (list, trim, sinking, capsizing) are exact; the only cost is a flooded ship accelerating slightly too easily. It avoids a `recompute` and an inertia rebuild at 10 Hz on every damaged ship.
4. **Decision 7, belt armour: the opt-in field on hull midsections only** (`armour.belt`), read by a new hull face code in `faceMm`. Separate belt plate parts would need hull-conforming geometry and would break 2D = 3D at the bow.
5. **Wings never act as hydrofoils.** A plane's wing dipped in water still only feels air (only `def.foil` parts see water). Physically incomplete under the owner's rule, but routing wings through water would reach into PR #40's plane code. Listed in README's limits.
6. **Ship parts on drones**: the drone builder refuses gv parts (drone.js:415, 434), so no sea drones yet. Left as is (a follow-up "sea drones" would open it).

**Risks:**
- **Physics feel**: the strip planing model and the resistance table are tuned by tests, not derived; porpoising or a too-easy hump are likely first-draft bugs. The trials in ships.test are the guard; tune `SHIP.planeK`, `C_wr`, added mass first.
- **Cost on phones**: AI fleets at full physics are the biggest new CPU cost (LOD and the 12 km step limit are the levers); the swell patch's fragment cost is the biggest GPU risk on Low (fallback: Low draws the swell at 8 m cells, or flat with the ship bobbing alone).
- **Old sea behaviour**: every water rule old craft use is untouched only because the hydro flag is opt-in per vessel. Any "simplification" that changes `surfaceAt`, `waterAt`, the probe for non-hydro vessels or `splashed` breaks `driving.json`/`death.test`. Don't.
- **MP clocks**: the wave phase slews toward the host's clock; on a very slow phone the drawn sea and a ghost's bob can be up to ~0.25 s apart (a few centimetres of disagreement). Acceptable; the physics is each owner's.
- **Big parts**: a 34 m, 800 t hull part is far outside what `Combat.maxHp`, `explode` and `Aim.sweep` were sized for. Every such use is gated on `def.shull` (hp set explicitly, `hullDist`, sweep cost measured in the bench).
- **The 1/20 world**: horizons of ~7 km make long-range gunnery mostly radar- and spotter-driven; the 20 km aim ray is for shells over the horizon at radar contacts. Fun first: if fights feel too close, raise masts (radar height) rather than bending the planet.
- **Carriers**: static carriers stay terrain; ships meet their hull boxes (`Ship.bump`), never the breaking `side` rule. A sailing carrier the planes can land on is out of scope (the deck contact of §6.2 would make it possible later, but the arresting gear and catapults are terrain-bound).
- **Save size**: per-part holes and water are small (holes capped at 16 per part); `rss.flight` stays well under its quota.
- **`TEMPLATES` regex** in test/lib/game.js (`/const TEMPLATES = \{[\s\S]*?\n\};/`): ship templates must stay inside the one literal, no `\n};` inside.
- **`MP_MAX_PARTS` 600**: the Arley Berk is ~70 parts; a player's 300 m battleship of 900 parts needs the cap off, as today.

[original §7, recovered]

   883  20733 /tmp/claude-0/-home-user-Overbuilt/0587f056-6c41-58cd-9f76-3deee688a95a/scratchpad/ships/SPEC.md
1:# Overbuilt: the ships update, design spec
9:## 0. The decisions, in one table
31:## 1. What the player sees and feels
45:## 2. The kind, the flag and the gates
47:### 2.1 Data (parts.js)
60:### 2.2 The per-vessel flag (vessel.js)
70:### 2.3 What `isSea(kind)` decides vs what `v.hydro` decides
77:## 3. Hull geometry: `def.shull` and `shullOf(def)`
79:### 3.1 Data shape
98:### 3.2 The sampler (parts.js, pure, cached per def)
112:### 3.3 Joints, compartments, open ends (Ship.groups)
119:## 4. Physics (ship.js §core)
121:### 4.1 Where it runs (vessel.js `physicsStep`, vessel.js:1121)
138:### 4.2 Buoyancy, ring by ring
155:### 4.3 Hull resistance and lateral force
169:### 4.4 Foils: rudders, hydrofoils, skegs (Ship.foils)
179:### 4.5 Propulsion: power, screws, waterjets, outboards
189:### 4.6 The helm (Ship.pre, kind ship)
196:### 4.7 Added mass and damping
201:### 4.8 Grounding, the bed, carriers, other ships (vessel.js `ground`)
214:### 4.9 Stability numbers
220:### 4.10 Sleeping, rails, warp, far ships
227:### 4.11 Launch (Flight.start)
236:## 5. Waves and the drawn sea (ship.js §waves, render3d.js)
238:### 5.1 The function
253:### 5.2 Rendering agreement (render3d.js)
265:### 5.3 Wake, spray, smoke
273:## 6. The parts (59 new, all `gv: true, ship: true`)
279:### 6.1 Ship hulls (`shHull`, 16)
305:### 6.2 Superstructure (`shSuper`, 10): gv outline prisms (the ground update's `plated` recipe), plating 6–10 mm
321:### 6.3 Propulsion (`shDrive`, 12)
337:### 6.4 Naval weapons (`shArms`, 15)
369:### 6.5 Ship kit (`shKit`, 6)
381:## 7. The stock ships (nine templates: eight ships and a flying boat)
411:


---

## 20. The owner's second standing rule: every kind can fight every kind (added after Phase 0)

The owner, in their words: "every vehicle should be able to combat every type of vehicle, some less effective and some more sure, some almost harmless, keep realism, but every one should have a way to destroy another type of vehicle someway."

Reading (decided): for every attacker kind A and target kind T among the seven (rocket, plane, car, helicopter, drone, Armour `tank`, ship), there is at least one way, with parts A can carry (cross-kind parts included), for A to destroy T: knock it out, shoot it down, sink it. Effectiveness follows realism: a drone's charge against a destroyer is almost harmless (a small hole, a fire), enough of them still sink her; a rifle-calibre MG against a tank only kills crew through open hatches / tracks and optics, an AT weapon does the job; a ship's CIWS or SAM shreds a drone or a plane; a tank's main gun can hit a hovering helicopter or a slow plane low down; a car with an AA gun or MANPADS-style launcher can shoot down aircraft. No "immune" pairs: every damage path must reach every kind of target (shells, bullets, blasts, missiles, torpedoes, rams, charges), and every targeting path that is kind-gated (air vs ground vs sea classification, seekers, locks, AI target lists) must have an answer for every target kind (e.g. an air-to-air missile can't lock a ship, but a radar/IR/TV anti-ship or anti-ground missile can; a torpedo only hits things in the water).

Proof: `test/matrix.test.js` (Phase 3/4): a 7×7 table; for each pair a representative attacker (a stock template, or a stock template plus cross-kind parts) and the target, a seeded scripted engagement (or, where an engagement is impractical headless, the direct damage path: a hit of that weapon on that target's parts) asserting the target can be destroyed within a bound (time or number of hits), and recording the effort (hits/time) so the table shows "sure / takes work / almost harmless". The table goes in the handbook and the PR body. Old kinds' gaps found by the audit (`/home/user/ships-notes/matrix-audit.md`) are fixed with gates that keep every old baseline identical (no old test path changes what it does).


### 20.1 Lead's decisions on the audit (matrix-audit.md)
- Old kinds: no impossible pair today. Do fixes **O1** (drone lock-on accepts landed craft, rockets on the pad, slow low helicopters; still refuses drones), **O3** (a rocket warhead part, `def.warhead`, so a rocket can be flown as a missile; old crashes stay harmless), **O5** (rockets in the `Death.hit` gate for hit markers). All gated so no old baseline moves.
- Ships: **S1** is a must (a drone charge's "55 % of the part's own max hp" must not apply to hull/ship parts: use a fixed reference hp; targets per S2's bands: a Bumble needs ~3-8 hits on a patrol boat, 40-120 on a destroyer). **S2**: add §8.11 damage targets for drones, MGs, bombs and aircraft weapons from the audit's bands. **S3**: naval SAMs DO engage anti-ship missiles (a `missiles` flag on naval tracking radars; realistic). **S4**: a bomb/charge near a hull bursts after a short delay under water (gated on a hydro vessel in play). **S5**: CIWS never uses the low-and-slow notch rule. **S6**: ships in the `Death.hit` gate. **S7**: torpedo tubes on aircraft drop the torpedo into the water (an aerial torpedo); on land they fire nothing (a warning in the builder). **S8**: old turrets DO fire from a ship afloat (cross-kind rule; the "hold fire on the ground/water" rule applies to aircraft only). **S9**: the naval AI engages shore targets in range. **S10**: ship ghosts collide (Ship.bump covers ghosts).
- **WP14 Combat matrix** (Phase 4, after WP8/WP9): `test/matrix.test.js` as the audit designs it (reach, effort with `baseline/matrix.json` and rating bands, hard cases), the old-kind fixes O1/O3/O5, and the 7×7 table for the handbook and PR. Old 36 pairs identical with and without ship.js.


## 21. Career removed (owner's decision during the update)
The owner: "delete career and future career additions, it's a very unused game and extra charge in every update." Career mode (funds, tiers, R&D, missions, refunds, the mode picker) is deleted on this branch. Nothing in the ships update adds career content (no missions, no awards, no tier locks for ship parts). Part costs and `tier`s stay as data: battles' budgets and the hangar's price tiers use them.
Nothing in the ships update adds career content (no missions, no awards, no tier locks for ship parts). Part costs and `tier`s stay as data: battles' budgets and the hangar's price tiers use them.
