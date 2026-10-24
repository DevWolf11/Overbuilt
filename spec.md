# The Ground Update: final spec

The owner asked: "New big update: Ground update, Tanks, Cars, SpAAs, tank destroyers, infantry vehicles, missile launchers, player sams, all customizable, you make your own vehicle, new game mode on multi-player, new UI, vehicle aim, vehicle movements, base it in war thunder ground combat, but adapted to our game."

**Where this spec comes from.**
- **Base:** the winning design, "phone" (phone first, battery first).
- **Grafts:** the judges' grafts from the other three designs (safe, wt, build).
- **Fixes:** every flaw the judges found in the base, checked against the code at `cc0e666`.
- **Open questions:** each one is decided here, and the assumptions are listed in §15.

**Labels used throughout.**
- **Fixed** marks a judge's finding resolved here, with the code fact that proves it.
- **Graft** marks an idea taken from another design.

**Arena measurements.** The arena numbers are measured on the real Earth map with `test/lib/game.js`. The scripts are in `scratchpad/ground/spec/survey.js` and `catalogue.js`.

## How the base design changed (judges' findings, all verified)

| # | Finding | Fix in this spec | Proof in the code |
|---|---|---|---|
| 1 | The Gear hook came after the hull probes, so the probe savings were lost | Hook is the first line of `Vessel.ground` | `vessel.js:931`. The probes run at `:939-954` and the crash check at `:956-969`. |
| 2 | A second weapon-axis convention (+x) | Every new gun and launcher fires along local +y, the same as `partAxis` (`parts.js:864`). `Builder.defaultRot` puts aimed parts at rot 3 on ground kinds. | `combat.js:249, 268, 280, 294, 196-204` all assume +y |
| 3 | `.kind-select` is a shared class | Only `#kind-select` is widened, to 5 columns, by id | `style.css:544`. The class is also used by `mpui.js:201` (lobby segments) and `index.html:76` (`#mp-transport`). |
| 4 | `def.mount` already exists | The quick-add hint is renamed `def.place` | `mount` is a number on 7 rocket engines (`parts.js:64-74, 310`), read at `parts.js:1777, 1787, 1968, 2003` and `parts3d.js:715, 718` |
| 5 | `def.crew` already exists | Crew roles live in `def.seat` (placed seats) and `def.mods[].role`. `def.crew` is never read by new code. | `crew:` is on 23 old defs |
| 6 | `def.smoke` already exists | Smoke launchers are `weapon.kind: 'smoke'` with `weapon.salvo` | `smoke: true` is on the Smoke Generator (`parts.js:346`) |
| 7 | A one-part track spanning both sides gives one hp pool, a solid belly box and legacy-twin rules | One track part per side, placed in pairs by symmetry, each with its own hp. **No new part is a `twinZ` pair.** | `legacyTwin` (`parts.js:941`), `boxesOf` twin depth (`combat.js:83`), the centre blast (`combat.js:62`) |
| 8 | AI marked as `v.kin` slipped past the vessel filters | Ground AI is `v.ai = { ground: true, … }` | The exclusions at `flight.js:146, 292, 401, 1122` and `mp.js:862` then apply. Every `combat.js` reader of `.ai` is guarded (§11). |
| 9 | The Tank Range sat on the old range's Faroes area | The Tank Range is on Highland Ridge (the battle arena) | Old range `place()`: e −2500..4000, \|z\| < 4000 (`combat.js:902-920`) |
| 10 | Spotting line of sight used the drawn mesh only | A coarse march on `Render3D.meshHeight`, confirmed with physics `Terrain.surfaceAt` within 3 m of a crest | Drawn cells are 100-150 m at 1 km (`render3d.js:897-898`) |
| 11 | Highland Ridge was asymmetric (the south pad saw zone A) | Re-surveyed: no pad sees the other pad or any zone. The N pad is 679 m outside the Scotland strip. (critic: once the invisible detail is faded, C1, the hilltop A sees B and C; the pads stay hidden.) | §10.2 table |
| 12 | Blasts hurt their own shooter | `explode(…, he, spare)`: shells and new launchers spare their own vessel for the first 0.6 s of flight | `combat.js:128-154`. The 1.5 s owner skip is for direct hits only (`:552`). |
| 13 | Ground-launched missiles nose-dived | `s.coast ?? 0.35` plus a launch `boost` on new launchers | `combat.js:280-281, 529-530` |
| 14 | A new hit row format and a `raw` damage flag | Structure damage stays plain `[partId, dmg]` rows. Damage to built-in modules rides in an optional `m` array on the same `hit` message. `Combat.damage` is unchanged, because new parts never set `def.armor`. | `combat.js:47`, `mp.js:858-875` |
| 15 | Least customisation of the four | Graft from build: per-part armour thickness. Graft from wt and build: placeable crew seats and ammo racks that replace a host's built-in modules. Graft from build: X-ray, arcs, armour view and Test turret. | §2, §3 |
| 16 | Names too close to real ones | '9KM-33 Ossa' becomes 'OK-8 Hive'. 'Malyutko' becomes 'BRDK-2 Gadfly'. All names are reviewed in §12. | — |
| 17 | The minimap redrew at 4 Hz even when idle | It redraws only when its signature (pixel-rounded positions, owners, progress) changes, at most 4 Hz | §9 |
| 18 | Auto-repair ran while driving | Repairs are still automatic (no button), but they run only while the vehicle is nearly stopped | §6.6 |
| 19 | Out of bounds knocked you out | A warning only | §10.3 |
| 20 | A wing part stopped a tank driving | `aircraft = wings.length > 0 && kind !== 'tank'` | `vessel.js:245, 975` |
| 21 | `rwr.test.js` had to be narrowed | No ground template sets `military: true`. They are filed by kind (`tank`) under "Ground forces". | `rwr.test.js:136-145`, `builder.js:1615-1619` |

## Feasibility review (critic)

Every touch point below was opened at `cc0e666`; the measurements are in `scratchpad/ground/critic/` (`drawn.js`) and a re-run of `spec/survey.js` against a copy of the code with the change in row C1. Each fix is written into the section named, marked **(critic)**.

| # | Problem found in the code | Fix (section) |
|---|---|---|
| C1 | **What you see is not what you hit.** At ground level the drawn terrain patch (span ≈ 37 km, `PW` 2.2, `render3d.js:9, 2621`) has cells of 16 m at 20 m, 46 m at 200 m and 118 m at 1 km (179 m on low). `natural()` drops Earth's 40 m and 160 m detail layers (1.2 and 4 m high) from coarse cells (`terrain.js:517-520`) while physics keeps them, so drawn minus physics is 1.3–1.8 m RMS (max 4 m) at 600–1000 m in the arena (`drawn.js`). Most of the measured "cover" was that invisible detail: shells would burst on bumps nobody can see. The 2.4 m berms (σ 3.5 m) can't be drawn by any cell beyond about 10 m. | Fade the detail layers inside the arena box, so physics and the patch agree (0.02–0.1 m within 100 m, 0.1–0.5 m at 300–600 m, measured); berms drawn as their own earthworks mesh; aim through drawn positions; the arena table re-surveyed (§10.2, §13, §8.2) |
| C2 | Shells against parts with no `def.armour` (every old aircraft, AI fighters, the technical's cab) are undefined: `t = (p.mm ?? armour.mm) × edge[i]` has no armour. SPAA shells could not kill planes. | The unarmoured rule (§6.3) |
| C3 | `R` is Recover (`flight.js:1000`): "the R key sets the zero" would end a solo flight. | `Y` sets the zero (§8.4, §8.5) |
| C4 | Hook 24 fires `tgun`/`agun` from `playerFrame`, which runs once per rendered frame (`combat.js:397`, called from `frame`): autocannons at 5–55 rounds/s would depend on the frame rate. | Held fire (agun, MG) per physics substep in `Aim.stepAll`; only the main gun's trigger edge in `playerFrame` (§5.4, hooks 24-25) |
| C5 | `Combat.drawHUD` draws a gun or rocket pipper 600 m along the hull's nose for any `gun`/`rocket` system (`combat.js:1251-1267`): an MLRS (`rocket`) would get a false reticle; a `tgun` on a plane has no `w.speed`. | Skipped in aim mode; elsewhere it uses the first shell's v0 (§9.1, hook 39) |
| C6 | `s.coast = 0` contradicts "motor from 0.05 s, guidance from 0.2 s"; `guideAir` has a third 0.35 (`combat.js:776`). | `s.coast` (motor) and `s.gt` (guidance), both 0.35 by default (§7.4, hook 29) |
| C7 | `MP.host(mode, transport)` (`mp.js:82`): `MP.host('pvp', { game: 'ground' })` passes the settings as the transport. | `MP.host(mode, transport, settings)` (§10.1) |
| C8 | `battleDesign` returning `{ key, design }` breaks `startFlight` and `mp.test.js:111-115` (`MP.battleDesign() === MP.myDesign`). | It still returns the design, with `key` added on a stock fallback (§10.5) |
| C9 | `GROUND_STOCK` in builder.js is never loaded headless: `test/lib/game.js` extracts only `TEMPLATES` and `templateRows` by regex, so the mp.test fallback would throw. | `GROUND_STOCK` lives in gmode.js (§10.5, §16.1) |
| C10 | An aircraft picked at respawn fails `designProblems` (kinds `['tank','car']`) and is swapped for a ground vehicle; a carrier `spawnId` left from an air game gives ×1.3 money and carrier limits (`mp.js:427-433`). | Aircraft kinds allowed at respawn with air support; ground spawns are the two pads (§10.5) |
| C11 | Ticket cost from a client's `set cost` is self-reported, and §10.3 says it rides with the spawn. | The host prices the spawn rows it relays (`designCost` with `mm`); `set cost` dropped (§10.3, §10.4) |
| C12 | Other players' wrecks vanish on a respawner's screen: `resetState` replaces `F.vessels` and `beforeUpdate` re-adds only `P.ghost` (`mp.js:777-788`). | `beforeUpdate` re-adds `MP.wrecks` (§10.6) |
| C13 | `Flight.revert` calls `this.start(this.design)` with no placement (`flight.js:116`), and `restore` clears `spawnOpts`: a Tank Range revert lands on the runway, and a Practice Battle revert wipes the AI. | `GroundMode.soloPlace(kind)` and a `GroundAI.onDestroyed()` hook (§11.1, hooks 42, 69) |
| C14 | Nothing calls `GroundAI.frame`, `Armour.repairStep` (fires, role swaps, repairs) or `Aim.radarStep`. | Dispatch lines in `Combat.frame` (hook 38) |
| C15 | `#btn-brake` is hidden without `def.wheel` parts (`flight.js:1421`), so tracked vehicles lose Brake; `#btn-cm` shows only for flares or chaff, and `Combat.status` returns null for a smoke-only vehicle (`combat.js:1438-1447`). | §9.3, hooks 40, 46 |
| C16 | `Gear.ground` doesn't say which fields it keeps (`wheelsDown` feeds drive1k and the stall horn, `splashed` feeds Recover) or what happens to old Car Wheels on a gear vessel: unprobed, they would fall through. | §4.2 |
| C17 | "An upright tank with 0.45 m of clearance probes no hull corners" is false with a 0.6 m band: its four belly corners are probed (13 calls a step, still within 16). "Turret corners culled" must not mean dropped, or an upturned tank sinks to its hull. | §4.2, §5.1, §14 |
| C18 | The Applique Plate (1.5×1.0×0.06) is thin in z: 90° turns stay in the blueprint plane, so it can only ever be a side plate, never a front one. | Thin in h (rot 1 = a front or rear plate) (§3.5) |
| C19 | The damaged-part loop (`combat.js:1175-1189`) sets anything under 30% on fire: every broken track, breech and dead crew seat would burn, at about 14 particles/s each, and nothing caps wreck smoke. | `Armour.partFX` dispatch (hook 70) |
| C20 | Phone portrait: `.hint` sits top-right at 104 px (140 in a room, ≤ 200 px wide, `style.css:525, 912`), where the minimap goes. `#btn-brake` is absolute and outside `.left-controls`' rect, so a rect test misses it. | §9.5 |
| C21 | Five 6-letter kind labels in a 212 px content box, and the landscape rule lays out icon plus label in a row (`style.css:570`): about 63 px × 5. | §2.1 |
| C22 | Aim pitch clamped to +1.35 rad, but AA guns elevate to +85° (1.48 rad). | §8.2 |
| C23 | Ground tests every 2nd substep at the end point only: a 1,650 m/s shell moves 27 m per test, so it skips crests and berms. | §6.1 |
| C24 | The 2D fallback draws craft at (x, y) only (`world.js:691-699`): at z ≈ 15 km a vehicle is drawn about 357 m under the ground line. | §8.1, §11.1 |
| C25 | Missiles replicate with `agm: w.seek === 'ground'` (`mp.js:892`): a SACLOS or top-attack ATGM arrives as a heat seeker with `tg` set, lighting the victim's RWR, against §7.5. | §7.5 |
| C26 | Merge order: 2E's stats and tests read `Gear.stats`, `Armour.summary`, `Aim.sweep` and 2D's clash outlines (stubs until then); 3H runs `GroundMode`'s rules (3G). `world.js` (Settings defaults) and the Settings dialog had no owner. | §16.4 |
| C27 | Easing received aim (`onPartVis`) for every part changes how old turrets look on other screens. | Only `def.gv` parts ease (§5.5) |
| C28 | Interface gaps: `Flight.mgFiring`/`aimCam`/`freeLook`, `GroundMode.obj()`/`soloPlace()`, `MP.sendShot` `sh`, `MP.sendSmoke`, `Sound.cannon` (2B calls it before 2C lands), Combat exports `targetCentre`, `hitTarget`, `aiDown`, `jams`, `radarOf`, `boomFX`, `Terrain.bermAt`, `Render3D.drawnGround`, `Armour.partFX`, `NO_GEAR`. Vessels need the new fields before `rebuildGroups`. | §16.2, §16.3 |
| C29 | Smaller ones: "five taps" is six parts; ammo chips show per-type counts from a shared pool; there is no `dust` FX kind (`groundDust` emits `smoke`, with 6 terrain lookups a call); collisions with local vessels that have no gear are unspecified; aimed weapons on planes and helicopters have no firing path; `body.ground` tied to aim mode leaves an unarmed tank with the rocket autopilot; spawn protection misses module damage; `hit.d` and `down.P` unchecked; hook 30 must sit above the blast line; `CLASH_BOXED` is keyed by part type. | In place, marked (critic) |

---

## 1. Summary and the player's experience

### What ships

**The Armour kind, built from parts.**
- A new vehicle kind, **Armour** (`kind: 'tank'`), with 71 new parts in seven new tray tabs:
  - **Hulls**
  - **Turrets** (rings and turret shells)
  - **Drive** (tracks, armoured wheels, engines)
  - **Guns**
  - **Launchers**
  - **Crew & ammo**
  - **Kit** (radars, sights, smoke, reactive bricks, skirts, plates, slat cage)
- From these the player builds tanks, armoured cars, SPAA, tank destroyers, infantry fighting vehicles, ATGM carriers, rocket artillery and SAM launchers, all custom.
- **Customisation:**
  - Every armour part has a thickness the player dials in mm. Mass, cost and speed follow it.
  - Hulls and turrets come with crew and ammunition built in. Placed crew seats and ammo racks replace them, so the player decides where the crew sits and where the ammunition is.
- **Stock vehicles:** sixteen, under altered names. Fifteen are Armour; one is the Desert Technical, an armed Car.
- **Cars:** the Car kind can carry the new aimed guns. Old cars behave exactly as before.

**Movement.**
- One track part per side, with skid steering and pivot turns. Armoured wheels steer by the front axle.
- Engines are rated in kW, so acceleration and hill climbing follow power-to-weight.
- Traction is limited by grip.
- Soft sprung suspension: the hull squats under power, dips when braking and rocks back when the gun fires.
- Wading and amphibious hulls. A helping hand rights the vehicle after a rollover.
- Collisions between vehicles and with wrecks.

**Aiming.**
- A War Thunder-style third-person camera, free of the hull: the crosshair is the aim.
- Turrets traverse at a rate set by the ring and the turret's weight. Guns elevate within their limits.
- Casemate guns get a small arc of their own. Stabilisers are optional.
- A zoomed gunner sight.
- Arcade aim (drop compensated) by default; Realistic aim as an option.

**Armour and damage.**
- Thickness in mm per face. The real slope of each face gives the effective thickness, because the 2D outline is the 3D model and is the hit shape.
- Ricochets, overmatch, and penetration that depends on velocity.
- HEAT, defeated by spaced armour, slat cages and reactive bricks.
- Behind the armour: crew and modules.
  - Crew are knocked out, and others take over their role.
  - Ammunition cooks off and throws the turret.
  - Tracks, engines and breeches break and repair themselves while the vehicle is stopped.
  - Engines catch fire.

**SPAA, SAMs and missiles.**
- A search radar with a scope. A tracking radar that locks, computes lead and lights the target's RWR.
- Proximity-fuzed AA shells.
- IR SAMs, command-guided SAMs and SARH SAMs, launched from the ground with a proper boost.
- Wire-guided (SACLOS) and top-attack ATGMs.
- Rocket artillery, direct or by a tap on the tactical map.

**Multiplayer: Ground Battle.**
- Played on Highland Ridge, rolling ground in North Scotland measured from the real map.
- Three capture zones and tickets.
- Respawns: free, or a War Thunder-style lineup of three.
- Optional air support: planes start in the air.
- Spotting that respects line of sight and is shared with the team.
- Wrecks stay on every screen as cover.
- A Runway arena when the Earth map isn't there (`file://`).

**Single player.**
- The **Tank Range** on Highland Ridge: targets that move, and in Hostile mode shoot back.
- A **Practice Battle** against AI, from the multiplayer menu: the whole Ground Battle alone, on a phone.

**The ground HUD.**
- A crosshair and a separate gun reticle. A reload ring on FIRE.
- An ammo stack, a rangefinder, and hit results ("Ricochet!", "Penetration · 2 crew").
- A damage diagram with crew pips that also shows where the turret points.
- A minimap with zones, a tactical map, and the SPAA radar scope.

### On a phone, in portrait

**Building.** You tap **Armour**, and the tray opens on Hulls. Six taps make a working tank, because each part has a `place` hint (critic: six parts, so six taps):
1. **Sloped Medium Hull.**
2. **Medium Track.** It lands beside the hull, and symmetry adds the other side.
3. **Tank Diesel.** It settles inside the hull's rear.
4. **Turret Ring**, then **Cast Turret**.
5. **85 mm Gun.** It locks into the turret's front, breech inside, already pointing forward.

The stats read "27 t · 22 hp/t · 50 km/h · front 99 mm". Below them: "85 mm APHE 124 mm at 1 km · reload 7 s · turret 24°/s · gun −5°/+22° · crew 5 · pivots 40°/s · tips at 0.7 g".

**Customising.** Tap the hull and an **Armour** stepper shows "Glacis 45 mm at 63° → 99 mm". Push it to 60 mm: the tank gains 3.2 t and loses a little acceleration. Tap the **X-ray** toggle: the hull turns glassy and shows the driver, the radio operator, the ammo and the fuel cells inside. Drop a Wet Ammo Rack inside the hull, and the hull's built-in ammo ghost icon disappears, because now you decide where the shells live.

**Driving and aiming.** Launch.
- The camera sits behind and above the tank with the crosshair in the middle.
- The left thumb drives with the stick: up drives, sideways skid-steers, sideways alone pivots.
- The right thumb rests on **FIRE**, a big red button bottom-right with a ring that fills as the gun reloads.
- Dragging that same thumb across FIRE, or anywhere on the view, swings the camera. The turret follows at its own pace, and a small circle shows where the gun points as it catches up.
- "740 m" reads under the crosshair. The gun elevates for that range by itself (Arcade aim).

**Sight and shells.** Tap the binoculars for the gunner sight (3×, pinch to 6×). Tap a chip in the ammo stack above FIRE (APHE · HE) to choose the next round.

**Hits.**
- Your shots: "Did not penetrate" in grey, "Hit · tracks" in amber, "Penetration · 2 crew" in red.
- When you're hit, a red arc on the screen edge points at the shooter. The damage diagram lights the broken track, or a crew pip goes dark.
- Stop, and "Repairing: left track 8 s" counts down.

### On desktop

**Mouse.** Click the view and the mouse is captured.
- The mouse aims, and left click fires.
- Hold the right button for the sight, or toggle it with Shift.
- The wheel zooms.

**Keys.**
- 1–4: shells.
- Space: machine guns.
- K: smoke.
- L: radar lock.
- J: spot an enemy for the team.
- M: tactical map.
- Hold C: free look. Tap C: aim straight ahead.

**Esc.** The first Esc releases the mouse and opens the menu.

### In a Ground Battle

**The field.**
- Teams spawn on two flattened pads 2.4 km apart that can't see each other.
- Three zones lie between them: a hilltop (A), a slope (C) and the east ground (B).
- Holding more zones than the enemy bleeds their tickets. Every knock-out costs your team tickets, more for an expensive vehicle.

**Spotting.** An enemy's red tag shows only while you or a teammate can see it.

**Respawning.** When you're knocked out, the respawn panel offers:
- your vehicle;
- any saved design that fits the budget;
- with air support on, a plane once you've scored. Planes start in the air 3 km behind your pad, and the enemy's Gepardo is waiting for them.

---

## 2. Vehicle kinds and the builder

### 2.1 Decision: a new kind `tank`, shown as "Armour"

| Option | Cost | Why not / why |
|---|---|---|
| Extend `car` (safe) | about 6 touch points | Car symmetry is front/back (`builder.js:387-391`), so a forward gun gets a rear twin (critic). Cars get the rocket autopilot bar and keys 1-6 (`flight.js:229-235, 987`). The Hostile quirk applies: moving cars draw AA fire and fighters (critic, `combat.js:1121, 1145`). Changing any of these changes how the Dune Buggy edits or plays. |
| **New kind `tank` (chosen)** | about 40 one-line branches | Its own symmetry, tabs, stats, HUD, keys, camera, hangar group and AI gates, with zero change to the `car` paths. `traces.buggy` cannot move. |

**Behaviour comes from parts, not from the kind.**
- Tracks, armour, rings and aimed guns work on any ground kind. A `car` with a Heavy MG Mount aims and fires (the Desert Technical).
- Car symmetry, tabs and driving stay as they are.
- Engines power only the new running gear. Old Car Wheels keep the old speed controller, and roll free on a vehicle that has new running gear.

**New helpers in parts.js.** `GROUND_KINDS = new Set(['car', 'tank'])` and `isGround(kind)`.

**The kind entry.**
```js
VEHICLE_KINDS.tank = { id: 'tank', name: 'Armour', site: 'runway', launchRot: 0,
  cats: ['hulls', 'turrets', 'drive', 'guns', 'launchers', 'crew', 'kit'] };
```

**Launch site.**
- `site: 'runway'` keeps `G.craft` (`test/lib/game.js:86`) and every fallback working.
- A solo Armour launch is placed on Highland Ridge's north pad by `opts.place` (§11) when the map is ready.

**Touch points.** Every place the code branches on the kind:

| Touch point | Today | For `tank` |
|---|---|---|
| `parts.js:25-30` VEHICLE_KINDS | four kinds | add `tank` (above) |
| `vessel.js:99-106` PILOT | `car` frame | `PILOT.tank = pilotFrame([1,0,0],[0,1,0],['pitch','roll','yaw'],[0.25,0.25,0.25])`. DRIVE.other applies. Gear vessels never let the stick turn the hull (§4.6). |
| `vessel.js:245` `aircraft` | `wings.length > 0` | `&& this.kind !== 'tank'` |
| `vessel.js:534-545` rover levelling | wheeled, wingless | not reached: `turnTarget` returns null for gear vessels (§4.6) |
| `vessel.js:711` drag `cdO` | `car` → 0.5 | `isGround(this.kind)` (identical for car) |
| `flight.js:39, 42` | default name 'Rocket'; unknown kind → rocket | `tank` is known; default name from `VEHICLE_KINDS[kind].name` |
| `flight.js:229-235` syncSas | the rocket set | hidden while `body.ground` |
| `flight.js:1421` Brake button (critic) | hidden unless `v.wheels` or air brakes | also shown for `v.gear.length` (tracks and armoured wheels are not `def.wheel`) |
| `flight.js:857-860` drive1k | `car` only | `isGround(kind)` |
| `flight.js:987` number keys | autopilot | `GROUND_KEYS` (shells) while `Flight.groundAim` |
| `flight.js:1220-1273, 1420`; `main.js:281` | car hints, launch tip | Armour hint, tip and stage text, touch-aware |
| `flight.js:1330-1346` HUD rows | | ground rows (§9) |
| `builder.js:362, 1516` | unknown kind → rocket | known |
| `builder.js:366, 1220` default tab | the map, written twice | one `KIND_TAB` const with `tank: 'hulls'` |
| `builder.js:387` mirrorOf, `:822` mirror sign | plane mirrors z | `kind === 'plane' \|\| kind === 'tank'` |
| `builder.js:1230-1233, 1813` symmetry | `rss.symmetry` | `rss.symmetryTank` (default on); title "Symmetry: parts get a twin on the other side" |
| `builder.js:1269-1306` stats and warnings | | ground block (§2.5) |
| `builder.js:1386` depth label | left/right for planes | the same for tank |
| `builder.js:1443, 1584-1588` | 'Rocket' if unknown | 'Armour'; thumbnail at rot 0 |
| `builder.js:1615-1619` hangar groups | `military` → Military aircraft | `groups.tank = 'Ground forces'` after Cars. Key: `t.kind === 'tank' ? 'tank' : t.military ? 'military' : t.kind`. |
| `combat.js:459, 462` seekers | `kind === 'car'` | `isGround(g.kind)` (identical for car) |
| `combat.js:1121-1146` hostile gates | `!landed && alt > 40` | kind `tank` counts as flying only when airborne for more than 1 s and more than 15 m above the ground (§11.4). Cars unchanged. |
| `mp.js:16, 452, 520, 524` kinds | `MP_KINDS_PVP` | `MP.kindsFor(settings)`: air games return `MP_KINDS_PVP` unchanged; ground games return `['tank', 'car']` |
| `mp.js:539, 701, 717` | unknown → plane | known |
| `mp.js:571-586` placement | null for unknown kinds | `tank` and armed cars go to arena pads (§10.3) |
| `render3d.js:2381` CAM0 | | `tank: [0, 0.18]` (used outside aim mode) |
| `index.html:133-138`, `ui.js:80`, css | four buttons, `repeat(4,1fr)` | a fifth "Armour" button (`data-icon="tank"`, a new hull-turret-barrel icon). Appended CSS `#kind-select { grid-template-columns: repeat(5, 1fr); }` **by id**. `.kind-select` stays 4 columns. |

On a 390 px portrait screen the strip spans the panel (`style.css:563`), so the five buttons are about 72 px each, and "ARMOUR" in 10 px caps fits.

**(critic) Desktop and landscape.** The desktop panel is 236 px wide with 12 px padding (`style.css:91-92`), so five columns are about 40 px: "ROCKET" and "ARMOUR" at 10 px with 0.08em spacing are about 43 px. The landscape rule (`style.css:570`) puts icon and label in a row, about 63 px a button. The appended CSS therefore also sets `#kind-select .kind-btn { font-size: 9px; letter-spacing: 0.04em; }` and, under `max-height: 500px`, `#kind-select .kind-btn { flex-direction: column; }`. `builder-tank.mjs` asserts `scrollWidth <= clientWidth` for every kind button at the four sizes.

### 2.2 Tray tabs

`PART_CATEGORIES` gains seven entries, appended after `ground` (14 → 21):

| id | Tab | Holds |
|---|---|---|
| `hulls` | Hulls | hulls, casemate, troop hull |
| `turrets` | Turrets | rings, turret shells |
| `drive` | Drive | tracks, armoured wheels, engines |
| `guns` | Guns | tank guns, autocannons, AA guns, MGs |
| `launchers` | Launchers | ATGM, SAM and rocket launchers |
| `crew` | Crew & ammo | seats, racks, autoloader, troop bay, fuel cell |
| `kit` | Kit | radars, sights, smoke, ERA, skirts, plates, slat cage |

**Tab counts.**
- Armour shows 7 tabs plus More.
- More shows 22 (21 categories plus Fewer). `builder-shapes.mjs:20-41` moves from 15 to 22, and `tank` joins its portrait "More in sight" loop (`:160`).

**Era groups.** `partFamilies` (`builder.js:309-317`) reads a new opt-in `def.family` ('WWII', 'Cold War', 'Modern', 'AA'), so long tabs show era groups behind `.tray-group` labels. The jet regexes are unchanged.

### 2.3 Symmetry, orientation, flip and quick-add

**Symmetry.** Armour uses the plane branch: z mirror; null for `twinZ`, z-locked parts or z ≈ 0. Tracks, wheels, skirts, smoke launchers, side plates and twin AA guns come in left/right pairs.

**Orientation.**
- Every new part has the old conventions: weapons fire along local +y, and the base is on local +x.
- `Builder.defaultRot(def, kind)` returns 3 for any def with `def.aim` on a ground kind (barrel forward, base down). It returns 0 for everything else, and for every old part (as today).
- It is used by tray drags, quick-add and the 3D ghost.
- Rings must be rot 0 (axis up). A ring at another rot is warned about and does not turn.

**Flip.**
- **Fixed:** the builder sets `flip = x < 0` in many places (`builder.js:406, 765, 769, 1050`; `templateRows` `:296`).
- New shapes and recipes never read `p.flip`: not in `partPath0`/`drawPart0`, not in `clashShape(d, flip)` and not in `Parts3D` `model(d, flip, skin)`. For `def.gv`, Parts3D passes `flip = false`, so there is no duplicate cache entry.
- A hull's glacis never faces backwards.

**`quickAddTank(type)`.** A branch at the top of `quickAdd` (`builder.js:1167`), only for kind `tank`. It reads `def.place`:

| `place` | Parts | Where |
|---|---|---|
| `hull` | hulls | on an empty blueprint, centred at y = clearance + h/2 (clearance 0.45 m). Else behind the rearmost hull, as a second hull section. |
| `side` | tracks, armoured wheels | beside the largest hull at z = ±(hullDepth/2 + depth/2), bottom at y 0. Wheels spread along the hull at 1.6 m spacing, after the existing ones. `att` is the hull. Symmetry adds the twin. |
| `inside` | engines (rear first), seats, racks, cells, autoloader, troop bay | inside the best host, scanned at 0.1 m for the first free spot within the host's outline. Engines go in hulls at the rear; loader and gunner in a turret; driver in the front of a hull. `att` is the host; the part is `flush` and `inner`. |
| `roof` | rings | centred on the hull roof, 0.3 m ahead of the middle |
| `ring` | turret shells | centred on the top ring |
| `front` | guns, launchers on a turret | in the turret's front face at mid-height, breech `pivot·h` inside, rot 3. With no turret, in the hull's front face (a casemate gun). |
| `top` | radars, sights, MG mounts | turret roof (rear for radars, front for sights), else the hull roof |
| `flank` | smoke launchers, AA guns, launchers on AA turrets | the turret's sides at z = ±(depth/2 + part depth/2) |
| `face` | ERA, applique plates | the face nearest the view's centre |
| `skirt` | skirts, slat cage | over the tracks' outer faces |

With no hull yet, quick-add falls back to the generic snap.

**Turret groups (who turns with a ring).** These are worked out by `Aim.groupsOfParts(parts, adj)`, which is pure and shared by the builder, Vessel, combat and the renderer (§5.1).

### 2.4 Builder tools (graft from build)

All of these are builder-only, go through `Builder.redraw()` (the `redraw.mjs` contract), and cost nothing in flight.

| Tool | Where | What |
|---|---|---|
| **X-ray** | Top-bar toggle, shown when the design has a part with `def.mods` or `def.inner`. Key X in the builder (critic: only without Ctrl/Cmd; Ctrl+X is cut, `builder.js:1764`). `rss.xray`, default on for Armour. | **2D:** hulls and turrets draw as outline plus a 25% fill. Inner parts and built-in `mods` draw on top on `sideLayer` 4 as rounded boxes with an icon (helmet, shell, piston, droplet, troops). A built-in module replaced by placed parts (§3.3) draws as a dashed ghost. **3D:** armour materials at opacity 0.3 with `depthWrite: false`; inner parts as coloured translucent boxes (`VesselMesh.setXray(on)`). |
| **Armour control** | `#part-info`, for parts with `def.armour` | Label, −/+ steppers (5 mm), and a slider from `armour.min` to `armour.max`. A line gives effective thickness per face: "Glacis 45 mm at 63° → 99 mm · lower 45 mm · sides 40 mm". It applies to every selected part, and mirror twins follow. Every change goes through `changed()` and history. |
| **Armour view** | 2D toggle beside X-ray | Outline edges drawn 3 px thick, coloured by effective KE thickness against a level shot from the front (front faces), the side (z faces, as fill) or above (roofs). Red under 30 mm, yellow 100, green 250, blue over 450. |
| **Arcs** | Automatic when a ring, gun or launcher is selected | **2D:** the selected gun's elevation fan at its trunnion (depression to elevation), plus a dotted line for the per-sector depression limit (§5.3). **3D:** a flat traverse fan of 3 m radius on the ring's top: green where free, red where blocked. It is built once per `changed()`; about 6 canvas ops; no animation. |
| **Test turret** | 3D, ring selected | Sweeps the turret once through its arc in 3 s (`bd.anim` stays true for 3 s, `render3d.js:2925`) and flashes any part it would hit |

### 2.5 Stats panel and warnings

**What `changed()` computes.** `statsData.ground = Gear.stats(parts)` merged with `Armour.summary(parts)` and `Aim.summary(parts)`. All three are pure. It is computed in `changed()` only for kind `tank`, or for a car with `gv` parts.

**Rows for kind `tank`.**
- `renderStats` hides the Thrust, T/W, Δv and Stages rows.
- The 4-column grid shows **Mass**, **Power** (hp/t = kW × 1.341 / t), **Top speed** (km/h), and **Front** (effective hull front mm against a level shot).
- A new `#s-ground` line (the twin of `#s-air`, `builder.js:1319-1324`) reads, for example: "85 mm APHE 124 mm at 1 km · reload 7.0 s · turret 24°/s · gun −5°/+22° · crew 5 · pivots 40°/s · climbs 28° · tips at 0.71 g · 42 rounds".

**Warnings.** They go in `#s-warn` (`builder.js:1308-1312`). They are all warnings. Only "no control part" disables Launch, as today, and every crewed hull or turret is a control part.

| Condition | Text |
|---|---|
| no hull or crewed turret | "Add a hull: it holds the crew." *(Launch disabled: no control part)* |
| no track or armoured wheel | "Add tracks or armoured wheels beside the hull." |
| tracks on one side only | "Tracks on one side only: it will drive in circles." |
| no engine | "Add an engine inside the hull: without one it won't move." |
| hp/t < 10 | "Underpowered: 8 hp/t, it will crawl uphill." |
| mass > Σ running-gear load | "Tracks rated for 60 t carry 71 t: top speed drops from 43 to 36 km/h." |
| no driver role in the crew | "No driver: it can't move until someone takes the seat." |
| a main gun but no gunner | "No gunner: the main gun can't fire until someone takes the seat." |
| no loader, no autoloader | "No loader: reloads take 50% longer." |
| a main gun but no ammunition | "The 120 mm gun has only its 5 ready rounds: add an Ammo Rack." |
| ring not at rot 0 | "Turret rings work flat on the roof: parts on the ring turn with it." |
| ring jammed (§5.1) | "The Turret Ring can't turn: the Radar Mast touches both the turret and the hull." |
| turret too heavy for its ring | "This turret is heavy for its ring: it turns at 11°/s." |
| traverse limited (sweep) | "The turret stops at ±130°: beyond that the gun hits the Engine Deck." |
| depression limited | "The gun only dips −2° over the engine deck (−10° forward)." |
| aimed gun vertical (rot 0/2) | "The 85 mm Gun points up: turn it with R so it points forward." |
| inner part outside armour | "The Ammo Rack sits outside the hull: one hit can set it off." |
| tip threshold < 0.6 g | "Top-heavy: it may tip over on side slopes (tips at 0.48 g)." |
| radar SAM without Tracking Radar | "The Radar SAM Launcher needs a Tracking Radar on board." |
| old Car Wheel on a gear vessel | "Car Wheels don't drive with tracks or armoured wheels: they roll free." |
| no weapon | "No gun: it can drive and capture, but not fight." *(information)* |
| **car** with a wing part (new, all car designs) | "A wing part (Spoiler) stops a car driving." *(text only; behaviour unchanged, `vessel.js:975`)* |

The generic warnings stay: lopsided weight, loose parts, `MP.designProblems`, locked parts and funds.

**specLine and renderInfo.**
- `specLine` (`builder.js:1122`) gains: "45 mm · 99 front" for armour, "450 kW" for engines, "85 mm · 7.0 s" for guns, "8 km" for radars.
- `renderInfo` shows shells (type, pen at 500/1000 m) for guns.

### 2.6 Hangar

- A new group, "Ground forces", after Cars, for kind `tank` templates. Its intro line: "Open one, turn on X-ray, and see how it's built."
- No stock ground template sets `military: true`. The Desert Technical (kind car) files under Cars.
- Saved Armour designs are labelled "Armour", with thumbnails at launchRot 0 (2D side view, `parts.js:2704-2724`).

---

## 3. The part catalogue

### 3.1 New def fields (the contract)

All are opt-in. Readers fall back to today's behaviour when a field is absent. No existing def gains any of them.

| Field | Shape | Meaning | Read by |
|---|---|---|---|
| `gv` | `true` | Marks every ground-update part. `v.gv` is true when any part has it. | vessel.js gates, combat gates, builder, parts3d |
| `place` | string (§2.3) | quick-add hint (replaces phone's `mount`) | builder.js |
| `family` | string | tray era group | builder.js |
| `outline` | `[[fx, fy], …]` | Convex, counter-clockwise; fractions of w and h about the part centre, unrotated and unflipped. It is the 2D outline (`partPath0`), the clash shape ('flat' extrude across `depth`), the 3D extrude silhouette and the **hit prism**, so 2D = 3D = hits. | parts.js, parts3d, armour.js, vessel.js (hull corners) |
| `round` | `{ slope }` | A lathe part (cast turrets, rings) is hit as an upright cylinder, radius w/2, from b to t. Its side normal is radial, tilted up by `slope` (degrees from vertical). | armour.js |
| `armour` | `{ mm, min, max, edge: [k…], z: k, mat: 'steel'\|'composite', heat: k, open: [edge…], round: {f, s, r, t} }` | Nominal thickness mm (the value the player dials; `p.mm` overrides it). An edge's thickness is `mm × edge[i]` (one entry per outline edge i → i+1; for a box `[bottom, front, top, rear]`). Both ±z faces use `mm × z`. `heat` multiplies against HEAT (composite 1.4-1.6). `open` lists missing plates (an open roof). `round` holds factors by bearing for round parts. (P1 review) `slab: true`: one solid sheet thin in h (the Applique Plate): it weighs w × depth per mm (`massPerMm`), though each face is hit at its full `mm × edge[i]`. | armour.js, builder |
| `spaced` | `true` | Skirts: HEAT fuzes here and loses 30% plus 250 mm per metre of gap to the next plate | armour.js |
| `slat` | `0..1` | chance that a non-tandem HEAT round or missile duds here | armour.js |
| `era` | `{ ke, ce }` | One-shot reactive block: −ke mm against kinetic, −ce against HEAT (tandem ignores it) | armour.js |
| `hp` | number | structure hit points; `maxHp(d)` becomes `d.hp \|\| <old formula>` | combat.js:37 |
| `mods` | `[{ k, role?, at: [fx, fy, fz], r, hp, rounds?, cook?, blowout?, autoload?, troops? }]` | Built-in modules, as spheres at fractions of w/h/depth from the part centre. `k`: 'crew' (with `role`: driver, gunner, commander, loader, radio), 'ammo', 'fuel', 'troops'. | armour.js |
| `module` | 'track'\|'wheel'\|'engine'\|'breech'\|'ring'\|'radar'\|'sight'\|'launcher'\|'crew'\|'ammo'\|'fuel'\|'troops' | At 0 hp the part is **broken, not removed** (`Armour.moduleDown`) | combat.js destroyPart hook |
| `inner` | `true` | Sits inside a hull or turret. With `flush`. No hull probes, hidden in flight, shielded from blasts unless its host is overmatched. | vessel.js, parts3d, armour.js |
| `seat` | 'driver'\|'gunner'\|'commander'\|'loader' | A placed crew member; with `control: 1` and `module: 'crew'` | armour.js |
| `rack` | `{ rounds, cook }` | A placed ammunition store (cook-off odds factor) | armour.js, aim.js |
| `autoload` | seconds | Fixed reload for guns ≥ 100 mm; no loader needed | aim.js |
| `troops` | count | Capture ×1.5 while alive | gmode.js |
| `amph` | `true` | Swims | gear.js |
| `track` | `{ r, n, travel, vmax, rev, turn, mu, side, crr, load }` | One side's running gear: road-wheel radius r, n contact points, suspension travel (m), top speed (m/s), reverse share, pivot rate (rad/s), traction mu, lateral mu, rolling resistance, rated load (t) | gear.js |
| `awheel` | `{ r, travel, vmax, mu, side, load }` | One armoured wheel | gear.js |
| `engine` | `{ kw, fuel: 'petrol'\|'diesel'\|'turbine' }` | Ground engine (fire odds by fuel) | gear.js, armour.js |
| `ring` | `{ rate (°/s), cap (t), stab: 0\|2 }` | Turret ring: it and its group turn about its +y axis | aim.js |
| `aim` | `{ el: [lo, hi], elRate, trav: [lo, hi], travRate, pivot, disp, stab: 0\|1\|2, casemate: [arc, rate] }` | Aimed part. Degrees and °/s; `pivot` is the trunnion as a fraction of h from the breech; `disp` is in mrad. `casemate` is its own arc when not in a ring group. | aim.js |
| `weapon.kind` | 'tgun' \| 'agun' \| 'smoke' | `tgun`: a main gun (single shots, reload, shells). `agun`: an aimed automatic gun. `smoke`: dischargers. Launchers stay `'missile'`/`'rocket'` with `def.aim`. | aim.js; old code ignores unknown kinds (`combat.js:478-481, 512-514`) |
| `weapon.shells` | `[keys]` | SHELLS keys, the first is the default | aim.js, armour.js |
| `weapon.cal`, `weapon.reload`, `weapon.stow` | | calibre mm; reload s; extra rounds reloaded into the ready rack. (critic) "ready N" in the §3.5 gun table **is `weapon.ammo`**, so `makePart`, the `pv` ammo column and `status` keep working unchanged. | aim.js |
| `weapon.seek` new values | 'saclos' \| 'top' \| 'clos' | wire-guided, top-attack, command to line of sight | aim.js guidance |
| `weapon.boost`, `weapon.coast` | m/s, s | launch speed along the tube; guidance/motor delay (`s.coast ?? 0.35`) | combat.js launchMissile |
| `weapon.heat`, `weapon.tandem`, `weapon.he` | mm, bool, mm | warhead penetration (HEAT), tandem, HE splash penetration | armour.js |
| `weapon.salvo` | count | smoke grenades per launcher per press | aim.js |
| `searchRadar` | `{ range, rpm }` | all-round search scope; an emitter | aim.js, combat candidates |
| `trackRadar` | `{ range, cone }` | lock, lead, RWR warning; with `aim` (the dish) | aim.js |
| `thermal`, `lrf` | `true` | thermal marks; laser range | aim.js, ghud.js |

**Fields deliberately avoided.** Never use `mount`, `crew`, `smoke`, `armor` or `radar` as new field names. `def.radar` is read by `radarOf` (`combat.js:172`) and `MPUI.spotted`; new radars use `searchRadar` and `trackRadar`, so old range and spotting maths stay the same.

**Save-path helpers in parts.js (Phase 1).**
- `cleanMm(v, def)` → `def.armour ? clamp(round(v/5)·5, min, max) : undefined`.
- `armourMassT(def, mm) = def.mass + massPerMm(def) × (mm − def.armour.mm)`.
- `massPerMm(def) = 7.85e-3 × ρ × (Σ edgeLength_i·depth·edge[i] + 2·outlineArea·z)` in t/mm, with ρ 1 (steel) or 0.45 (composite).
- `armourCostDelta(def, mm) = round((armourMassT − def.mass) × (steel $400 / composite $900 per t))`.

### 3.2 Per-part armour in saves (graft from build; the `skin` precedent)

Rows become `{type, x, y, flip, rot, z?, att?, skin?, mm?}`. `mm` is written only when it differs from `def.armour.mm` by more than 0.5 mm.

| Path | Change |
|---|---|
| `designRows` / `partsFromDesign` (`parts.js:1226-1267`) | write `mm`; read through `cleanMm` |
| `templateRows` (`builder.js:294`) | `{mm}` in a row's extras |
| `designCode` / `parseCode` (`builder.js:1490-1518`) | `RSS3.` only when some row has mm (rows `[type,x,y,flip,rot,z,att,skin,mm]`). Old designs keep producing identical RSS1/RSS2 codes. Old versions reject RSS3 cleanly. |
| `mpSpawnRows` (`mp.js:36-50`) | index 9, through `cleanMm` |
| `sendSpawn` (`mp.js:591`), `buildGhost` (`mp.js:706`) | send / apply `p.mm` |
| `Vessel.serialize` / `restore` (`vessel.js:1166-1200`) | `mm` for `gv` parts only, through `cleanMm` |
| `partKg` (`parts.js:836`) | `(p.mm == null ? p.def.mass : armourMassT(p.def, p.mm)) * 1000 + …` (identical arithmetic for old parts) |
| `designCost` (`parts.js:1293`) | `+ (p.mm != null ? armourCostDelta(def, p.mm) : 0)` (x + 0 === x) |
| builder copy/paste, mirror twins, history | copy `mm` with `skin` |

A round-trip test (rows → code → spawn rows → restore) proves masses agree on every path (§16).

### 3.3 Built-in modules and placed modules (graft from wt and build)

**Built-in modules.** Hulls and turrets carry `mods` (crew, ammo, fuel, troops), so six taps (critic: six parts) still make a working tank.

**The replacement rule.** It works **per host**:
- If any placed part with `def.seat` has `att === host.id`, the host's built-in **crew** mods are inactive.
- If any placed `def.rack` or `def.autoload` part has `att === host.id`, its built-in **ammo** mods are inactive.

Fuel and troops mods always stay. X-ray shows inactive built-in mods as dashed ghosts.

**`Armour.crewOf(v)`.** Cached per `rebuildGroups`, it lists the vessel's active crew: `[{ host, i (mod index, or -1 for a seat part), role, part }]`, plus its ammo stores `[{ host, i, rounds, cook, blowout }]`.

### 3.4 Shapes and how they are drawn

All drawing goes through the skin-aware helpers (`bodyGrad`, `bodyFlat`, `hullGradient`). Recipes are registered in `PART_RECIPE` (`parts.js:969`), never in parts3d. No new shape reads `p.flip`.

| Shape | 2D (`partPath0` / `drawPart0`) | 3D recipe | Clash and hit |
|---|---|---|---|
| `thull` | `outline` polygon. Art by `style`: welded plates, rivets (WWII), composite blocks (modern), hatches, tow hooks, engine-deck grille, lights. | default extrude of the outline at `depth` (`parts3d.js:768-771`), kind 'mil' (takes paint) | flat (extrude) = outline prism |
| `tturret` | outline (wedge, box, bustle); mantlet seat, hatches, vision blocks | extrude | outline prism |
| `tcast` | dome half-profile | lathe about +y (round in plan) | round (`LATHE_SHAPES`, `ROUND3D`); hit: `round` cylinder |
| `tring` | thin band with a bolt ring | lathe (short cylinder) | round |
| `ttrack` | belt loop (sprocket ahead, idler behind, 5-8 road wheels, return rollers, fender); links shifted by `p.belt` | `BUILD.trackUnit`: belt (extruded rounded loop, kind 'track', texture cloned per rig and scrolled), merged road wheels (`tyre` + `steelDark`), fender ('mil'), sprocket and idler on `spin` subs. About 4 meshes. | box |
| `twheel` | chunky tread, armoured hub; spokes by `p.spin` | `BUILD.awheel`: one wheel on a `spin` node | box (depth = def.depth) |
| `tgun` | barrel (muzzle brake or bore evacuator by `style`), mantlet block; drawn at build pose | `BUILD.tankGun`: box mantlet; `yaw` node at the trunnion `[0, −h/2 + pivot·h, 0]` (rotation.x = aimYaw; (P1 review) an aimed part's own traverse turns about its trunnion, as `Aim.muzzle` does, not about the part's centre as the old turrets' yaw node does); `pitch` node at the yaw node's origin (rotation.z = aimEl) holding a lathe barrel on a `recoil` sub-node | box: any recipe of its own is a box to `clashShape` (`parts.js:1112-1116`). (critic) `CLASH_BOXED` and `CLASH_PAD` are keyed by **part type**, not shape: list keys there only for extrude or lathe parts whose model stands outside the outline. |
| `tlaunch` | tubes or rails with round ends (`style` atgm, sam, mlrs) | `BUILD.launcher`: tubes on `yaw`/`pitch`, both at the trunnion as for `tankGun`; each round a `store` sub-node (`parts3d.js:1805-1809`) | box |
| `tradar` | dish or bar antenna on a mast | `BUILD.radarAnt`: mast plus a `spin` antenna (search, flight only), or a dish on `yaw`/`pitch` at the trunnion (track) | box + `CLASH_PAD` |
| `tkit` | engine block, rack, cell, seat, bricks, skirt, plate, slats (`style`) | box or extrude; inner parts hidden in flight | box (`flush`) |

**Paint.**
- `NO_SKIN` gains `ttrack` and `twheel`.
- Four paints join `SKINS` in the existing camo formats, `accent: null` (26 → 30): **Steppe Green** (solid), **Ambush Three-Tone** (blotch), **Woodland Three-Tone** (blotch), **Winter Whitewash** (splinter over white).

### 3.5 The new parts

Notes on the table:
- Mass is in tonnes at the default armour. Hull depth is the width between the tracks.
- "Armour" gives nominal mm (min–max) and, in brackets, the effective front against a level shot.
- Every part carries `gv: true` and a `family`, which the table leaves out.
- Totals: **71 parts**, so PARTS goes 257 → 328 (327 in the tray).

**Hulls (`hulls`).** All have `shape: 'thull'`, `control: 1`, `place: 'hull'`, `module` none (structure), and an `outline` with edges ordered bottom, lower front, upper front, top, rear.

| key | Player name | w×h×depth (m) | t | $ | tier | Armour | mods | Other |
|---|---|---|---|---|---|---|---|---|
| hullLight | Light Hull | 4.4×1.1×1.8 | 4.0 | 3,000 | 0 | 25 (10–60), glacis 57° (46); sides 15 | driver, radio, ammo 10, fuel | hp 900 |
| hullMedium | Sloped Medium Hull | 5.6×1.3×2.2 | 11 | 6,500 | 1 | 45 (15–120), glacis 63° (99); sides 40 | driver, radio, ammo 20, fuel ×2 | hp 1,100 |
| hullHeavy | Heavy Box Hull | 6.0×1.6×2.6 | 24 | 10,000 | 2 | 100 (40–200), front 10° (102); sides 80 | driver, radio, ammo 30, ammo 20 | hp 1,400 |
| hullMBT | Main Battle Hull | 7.2×1.4×2.5 | 24 | 17,000 | 3 | composite 350 (150–600, ×1.6 vs HEAT): lower plate 280 @58° (528), upper glacis 157 @62° (335, the weak spot); sides 70 | driver, ammo 16, fuel | hp 1,500 |
| hullIFV | Troop Hull | 6.4×1.7×2.4 | 10 | 6,000 | 1 | 30 (10–60), glacis 60° (60); sides 20 | driver, troops 6 (hp 400), fuel | amph; hp 1,000 |
| hullWheeled | Wheeled Hull | 6.2×1.5×2.5 | 7 | 4,500 | 1 | 20 (8–40), boat bow 60° (40); sides 12 | driver, commander, fuel | amph; hp 900 |
| hullCasemate | Casemate Hull | 6.0×2.0×2.5 | 22 | 11,000 | 2 | 80 (30–150), front 55° (139); sides 48 | driver, gunner, loader, commander, ammo 30, ammo 20 | a gun in its front face uses its casemate arc; hp 1,500 |

**Turrets (`turrets`).** Rings are `tring`, rot 0, `place: 'roof'`, `module: 'ring'`. Shells are `place: 'ring'` and `control: 1`.

| key | Player name | Size (m) | t | $ | tier | Behaviour |
|---|---|---|---|---|---|---|
| ringS | Small Turret Ring | ⌀1.4 × 0.2 | 0.3 | 1,500 | 0 | ring {rate 30°/s, cap 4 t}; sides 30 mm; hp 300 |
| ringM | Turret Ring | ⌀2.0 × 0.2 | 0.6 | 2,500 | 0 | rate 24, cap 12; hp 350 |
| ringL | Heavy Turret Ring | ⌀2.4 × 0.22 | 1.0 | 3,500 | 2 | rate 18, cap 25; hp 400 |
| ringP | Powered Ring | ⌀2.2 × 0.22 | 0.9 | 6,000 | 3 | rate 40, cap 20, **stab 2** (traverse stabilised); hp 400 |
| turretSmall | Small Turret | 1.8×0.75×1.6 | 1.4 | 2,500 | 0 | 30 mm (8–80), front 25° (33); mods gunner (also commands); hp 600 |
| turretCast | Cast Turret | ⌀2.6 × 0.95 (`tcast`) | 6.5 | 6,000 | 1 | round 90 mm (20–160): front ×1, sides ×0.65, rear ×0.55, roof ×0.22, slope 25° (99); mods gunner, commander, loader, ammo 16; hp 900 |
| turretBox | Box Turret | 2.9×1.0×2.4 | 11 | 7,000 | 2 | 100 mm (40–200), near-vertical front (102); sides 80; mods gunner, commander, loader, ammo 12; hp 1,100 |
| turretWedge | Wedge Turret | 3.8×0.85×3.2 | 16 | 15,000 | 3 | composite 500 mm (200–800, ×1.5 vs HEAT); cheeks 80; bustle ammo 34 with `blowout`; mods gunner, commander, loader; hp 1,300 |
| turretAuto | Autoloader Turret | ⌀3.0 × 0.8 (`tcast`) | 9 | 13,000 | 3 | round composite 420 mm (150–600, ×1.4 vs HEAT): front ×1, sides ×0.5, rear ×0.25, roof ×0.07; mods gunner, commander, carousel ammo 22 (`autoload` 7.0 s; cooks off below 40 hp); hp 1,200 |
| turretOpen | Open-Top Turret | 2.4×0.85×2.2 | 2.5 | 2,500 | 1 | 25 mm (10–60), `open: [top]`; mods gunner, loader; hp 600 |
| turretAA | AA Turret | 2.6×1.2×2.4 | 6 | 6,000 | 2 | 30 mm (10–60); sides 20; mods gunner, commander; guns on its flanks, radars on its roof; hp 900 |

**Drive (`drive`).** Tracks are `ttrack`, `place: 'side'`, `module: 'track'`, `breakSpeed: 18`. Wheels are `twheel`, `place: 'side'`, `module: 'wheel'`. Engines are `tkit`, `inner`, `flush`, `place: 'inside'`, `module: 'engine'`.

| key | Player name | w×h×depth | t | $ | tier | Behaviour |
|---|---|---|---|---|---|---|
| trackLight | Light Track | 4.0×0.9×0.4 | 1.3 | 1,300 | 0 | track {r .30, n 3, travel .22, vmax 15, rev .4, turn .9, mu .9, side .6, crr .035, load 18}; 15 mm; hp 450 |
| trackMed | Medium Track | 5.6×1.0×0.5 | 3.0 | 2,000 | 1 | r .32, n 3, travel .25, vmax 14, rev .35, turn .7, load 35; 20 mm; hp 550 |
| trackHeavy | Heavy Track | 6.2×1.1×0.7 | 5.5 | 2,800 | 2 | r .38, n 3, travel .25, vmax 12, rev .3, turn .55, load 60; 25 mm; hp 650 |
| trackMBT | Modern Track | 6.8×1.1×0.65 | 5.0 | 3,500 | 3 | r .35, n 3, travel .35, vmax 19, rev .4, turn .6, load 70; 25 mm; hp 650 |
| wheelArm | Armoured Wheel | 1.3×1.3×0.45 | 0.45 | 750 | 1 | awheel {r .6, travel .3, vmax 26, mu .75, side .75, load 6}; hp 300 |
| wheelArmS | Light Armoured Wheel | 1.1×1.1×0.4 | 0.25 | 500 | 0 | r .5, travel .26, vmax 30, load 3.5; hp 220 |
| engPetrol | Petrol Engine | 1.4×0.8×1.4 | 0.9 | 2,000 | 0 | engine {kw 260, petrol}; fire 35% when hit; hp 300 |
| engDiesel | Tank Diesel | 1.6×0.9×1.6 | 1.6 | 3,500 | 1 | kw 450, diesel; fire 12%; hp 350 |
| engDieselL | Heavy Diesel | 1.8×1.0×1.8 | 2.6 | 5,500 | 2 | kw 750, diesel; hp 400 |
| engTurbine | Turbine Engine | 1.6×0.9×1.4 | 1.5 | 9,000 | 3 | kw 1,100, turbine; fire 20%; hot exhaust: IR locks reach 25% further; hp 350 |

**Guns (`guns`).** All have `shape: 'tgun'`, `flush`, `place: 'front'` (`mgHeavy`: `top`), `module: 'breech'`, `aim.pivot` 0.18, and barrels along +y (h = length).

| key | Player name | w×h×depth | t | $ | tier | Weapon | Aim (el, rate) |
|---|---|---|---|---|---|---|---|
| gun37 | 37 mm Light Gun | 0.35×2.2×0.5 | 0.4 | 2,500 | 0 | tgun cal 37, reload 2.5, ready 12, [ap37, he37], each 1.5 | −10/+25 @12; disp .3; casemate ±20° @15 |
| gun50 | 50 mm Gun | 0.4×2.9×0.6 | 0.7 | 3,500 | 1 | 50, 4.0, 10, [ap50, apcr50, he50], 4 | −10/+20 @10 |
| gun75 | 75 mm Tank Gun | 0.45×3.2×0.8 | 1.0 | 4,500 | 1 | 75, 6.0, 8, [ap75, he75], 9 | −10/+25 @6; **stab 1**; casemate ±12° @6 |
| gun76L | 76 mm Long Gun | 0.5×4.2×0.8 | 1.3 | 6,000 | 1 | 76, 6.5, 8, [ap76, apcr76, he76], 10 | −10/+20 @6 |
| gun85 | 85 mm Gun | 0.55×4.6×0.9 | 1.6 | 6,500 | 1 | 85, 7.0, 6, [aphe85, he85], 16 | −5/+22 @6 |
| gun88 | 88 mm Long Gun | 0.6×5.2×1.0 | 1.8 | 8,000 | 2 | 88, 7.5, 6, [aphe88, apcr88, he88], 20 | −8/+15 @5 |
| gun105 | 105 mm Rifled Gun | 0.6×6.0×1.0 | 2.4 | 10,000 | 2 | 105, 6.5, 5, [apds105, heat105, hesh105], 22 | −10/+20 @8 |
| gun120 | 120 mm Smoothbore | 0.65×6.4×1.1 | 3.2 | 15,000 | 3 | 120, 6.0, 5, [apfsds120, heat120, he120], 22 | −9/+20 @10; **stab 1** |
| gun125 | 125 mm Smoothbore | 0.65×6.2×1.1 | 3.0 | 14,000 | 3 | 125, 7.0, 5, [apfsds125, heat125, he125], 25 | −6/+14 @10; **stab 1** |
| gun152 | 152 mm Howitzer | 0.8×5.0×1.2 | 4.5 | 9,000 | 2 | 152, 15, 4, [he152, aphe152, heat152], 45 | −5/+20 @4 |
| ac20 | 20 mm Autocannon | 0.25×2.0×0.35 | 0.1 | 3,000 | 1 | agun cal 20, rate 7, ammo 400, [ap20, hei20] | −10/+80 @40; disp 1.5; stab 1 |
| ac30 | 30 mm Autocannon | 0.3×2.6×0.4 | 0.18 | 5,000 | 2 | 30, rate 5.5, 300, [apds30, hei30] | −10/+60 @35; stab 2 |
| ac35 | 35 mm AA Gun | 0.35×3.2×0.5 | 0.5 | 6,000 | 3 | 35, rate 9.5, 320, [hevt35, apds35] | −5/+85 @60; stab 2 |
| aa23q | Quad 23 mm AA Gun | 0.9×2.0×1.0 | 0.9 | 8,000 | 2 | 23, rate 55 (4 barrels), 2,000, [heit23, ap23] | −4/+85 @60 |
| mgCoax | Coaxial MG | 0.12×1.0×0.2 | 0.02 | 800 | 0 | agun 7.6, rate 12, 2,000, [ball8] | −10/+20 @30; own arc ±3° |
| mgHeavy | Heavy MG Mount | 0.5×1.6×0.5 | 0.06 | 1,500 | 0 | agun 12.7, rate 9, 500, [ball13] | own pintle: trav ±180 @90, el −10/+70 @90 |

**Launchers (`launchers`).** All have `shape: 'tlaunch'`, `place: 'front'` or `flank`, `module: 'launcher'`, and `weapon.coast: 0`. Missiles fire `hot`: the motor runs from 0.05 s and guidance from 0.2 s.

| key | Player name | w×h×depth | t | $ | tier | Weapon | Aim |
|---|---|---|---|---|---|---|---|
| atgmWire | Wire-Guided Missile Rail | 0.4×1.2×0.4 | 0.05 | 4,000 | 1 | missile seek 'saclos', ammo 1, stow 2, reload 20, boost 60, accel 160, burn 1.2, vmax 150, turn 10, range 3,000, heat 400, dmg 600, blast 3, life 24, label 'ATGM' | −5/+20 @20 |
| atgmTube | Twin ATGM Launcher | 0.9×1.4×0.8 | 0.25 | 9,000 | 2 | saclos, ammo 2, stow 4, reload 10, vmax 300, range 3,750, heat 650 **tandem**, dmg 700 | −5/+20 @25 |
| atgmTop | Top-Attack Launcher | 0.5×1.2×0.5 | 0.12 | 15,000 | 3 | seek 'top' (IR lock on a ground vehicle within 3° of the crosshair, 1.5 s, 2,500 m), ammo 2, stow 2, reload 12, loft 150, vmax 220, heat 750 tandem, dmg 750 | −5/+30 @25 |
| samIR | IR SAM Rack | 1.0×1.6×1.0 | 0.4 | 9,000 | 2 | seek air (IR), ammo 4, stow 4, reload 15, boost 60, range 5,000, cone .3, accel 300, burn 2, vmax 600, turn 22, dmg 260, blast 6, label 'SAM' | −5/+80 @40 |
| samCmd | Radar SAM Launcher | 1.2×2.4×1.2 | 0.8 | 16,000 | 3 | seek 'clos' (needs a Tracking Radar), ammo 2, stow 4, reload 10, range 8,000, accel 400, burn 2.5, vmax 720, turn 30, dmg 300, blast 9, label 'SAM-R' | 0/+85 @40 |
| samLong | Long-Range SAM Launcher | 2.0×3.6×1.8 | 5.0 | 32,000 | 4 | seek air, radar (SARH on the Tracking Radar), ammo 4, range 15,000, accel 250, burn 6, vmax 1,100, turn 25, dmg 450, blast 17, life 30 | +5/+75 @20 |
| mlrsLight | Rocket Rails | 1.0×3.6×1.4 | 0.6 | 6,000 | 1 | rocket ammo 16, stow 16, reload 45, rate 4, speed 50, accel 300, burn 1.4, dmg 600, blast 10, he 25, spread .015, each 40 | 0/+55 @15 |
| mlrsPod | Rocket Artillery Pod | 2.0×4.0×1.8 | 2.2 | 14,000 | 3 | rocket ammo 6, stow 6, reload 60, rate 1.5, speed 60, accel 420, burn 2.2, dmg 1,400, blast 18, he 45, each 150 (about 8 km) | 0/+55 @12 |

**Crew & ammo (`crew`).** All have `shape: 'tkit'`, `inner`, `flush`, `place: 'inside'`, and are drawn in 3D only in X-ray.

| key | Player name | w×h×depth | t | $ | tier | Behaviour |
|---|---|---|---|---|---|---|
| seatDriver | Driver's Seat | 0.8×0.9×0.7 | 0.1 | 400 | 0 | seat 'driver', control 1, module crew, hp 100 |
| seatGunner | Gunner's Seat | 0.8×0.9×0.7 | 0.1 | 400 | 0 | seat 'gunner' |
| seatCommander | Commander's Seat | 0.8×1.0×0.7 | 0.1 | 400 | 0 | seat 'commander' (spotting +25%, rangefinding) |
| seatLoader | Loader's Seat | 0.8×0.9×0.7 | 0.1 | 400 | 0 | seat 'loader' |
| ammoRack | Ammo Rack | 0.8×0.6×1.2 | 0.3 | 500 | 0 | rack {rounds 20, cook 1}, module ammo, hp 70 |
| ammoRackL | Large Ammo Rack | 1.2×0.8×1.6 | 0.5 | 800 | 1 | rack {rounds 40, cook 1}, hp 90 |
| wetRack | Wet Ammo Rack | 0.8×0.6×1.2 | 0.4 | 900 | 1 | rack {rounds 14, cook 0.3}, hp 90 |
| autoloader | Autoloader Carousel | 1.6×0.5×1.6 | 1.2 | 5,000 | 3 | rack {rounds 22, cook 1.4}, autoload 7.0 (guns ≥ 100 mm), hp 120 |
| troopBay | Troop Bay | 2.0×1.1×1.6 | 0.8 | 2,000 | 1 | troops 6, module troops, hp 400 |
| fuelCell | Fuel Cell | 0.8×0.8×1.2 | 0.4 | 400 | 0 | module fuel, hp 150: fragments that reach it stop there; 30% chance of fire when destroyed |

**Kit (`kit`).**

| key | Player name | w×h×depth | t | $ | tier | Behaviour |
|---|---|---|---|---|---|---|
| radarSearch | Search Radar | 1.2×1.2×0.4 | 0.3 | 6,000 | 2 | `tradar`, searchRadar {range 10,000, rpm 60}, module radar hp 150, `place: 'top'` |
| radarTrack | Tracking Radar | 0.9×0.9×0.9 | 0.25 | 6,000 | 2 | trackRadar {range 8,000, cone 0.5 rad}; aim (dish) el −5/+85 @60, trav ±180 @90; hp 150 |
| thermal | Thermal Sight | 0.5×0.4×0.5 | 0.05 | 4,000 | 3 | thermal; module sight hp 80 |
| lrf | Laser Rangefinder | 0.4×0.3×0.3 | 0.02 | 1,500 | 2 | lrf; module sight hp 60 |
| smokeL | Smoke Launchers | 0.5×0.5×0.4 | 0.05 | 800 | 0 | weapon {kind 'smoke', ammo 2, salvo 3}, `place: 'flank'` |
| era | Reactive Bricks | 0.8×0.4×1.0 | 0.25 | 400 | 3 | era {ke 100, ce 400}; gone after its first hit; hp 40; `place: 'face'` (critic: rot 0 on a roof, rot 1 on a front; `quickAddTank` picks the rot from the face) |
| skirts | Side Skirt | 4.5×0.8×0.06 | 0.2 | 450 | 1 | armour 6 mm, spaced; hp 150; `place: 'skirt'` |
| plateApp | Applique Plate | 1.5×0.06×1.0 | 0.4 | 600 | 1 | armour 30 mm (10–80), adds to the plate behind; hp 200. (P1 review) Its edges are [1, 1, 1, 1] with `armour.slab` (one sheet: massPerMm = w × depth), so it is 30 mm whichever way round it lies: R gives rot 1, and a thin box looks the same both ways. (critic) Thin in h, not in depth: 90° turns stay in the blueprint plane (`partDims`, `parts.js:852`), so a part thin in z could only ever be a side plate. At rot 0 it lies on a roof; at rot 1 or 3 it stands on a front or rear face, which is what players want. Sides are covered by skirts, slats and ERA. |
| slatCage | Slat Cage | 2.0×1.0×0.1 | 0.15 | 700 | 2 | slat 0.5, armour 2; hp 120 (thin in z: sides only, like skirts) |

**Career.** Basic parts (Light Hull, rings, Small and Cast Turret, Light Track, Petrol Engine, 37 mm gun, MGs, seats, racks, smoke) are tier 0, so a fresh career can build an armed light tank. `TIERS` names stay as they are.

### 3.6 Shells (`SHELLS`, js/armour.js)

Notes on the table:
- `k` is the drag constant (deceleration = k·ρ·v², the same form as `combat.js:545`).
- Kinetic penetration at impact is `pen·(v/v0)^1.43`. HEAT, HESH and HE don't change with range.
- `dmg` is the damage along the post-penetration path.
- Player-visible labels are generic ammunition types (AP, APHE, APCR, APDS, APFSDS, HEAT, HESH, HE, HE-VT, HEI), not designations.

| Key | Type | Cal | v0 | Pen | k (×1e-5) | kg | dmg | Extra |
|---|---|---|---|---|---|---|---|---|
| ap37 | ap | 37 | 870 | 65 | 10 | 0.7 | 140 | |
| he37 | he | 37 | 780 | – | 11 | 0.7 | 110 | he 7, blast 1.5 |
| ap50 | ap | 50 | 835 | 90 | 10 | 2.0 | 180 | |
| apcr50 | apcr | 50 | 1180 | 140 | 16 | 0.9 | 160 | |
| he50 | he | 50 | 700 | – | 11 | 1.8 | 150 | he 9, blast 2 |
| ap75 | ap | 75 | 620 | 100 | 10 | 6.8 | 260 | |
| he75 | he | 75 | 600 | – | 11 | 6.0 | 225 | he 14, blast 3 |
| ap76 | ap | 76 | 790 | 125 | 10 | 7.0 | 260 | |
| apcr76 | apcr | 76 | 1000 | 190 | 16 | 4.2 | 230 | |
| he76 | he | 76 | 680 | – | 11 | 6.2 | 230 | he 14, blast 3 |
| aphe85 | aphe | 85 | 800 | 145 | 9 | 9.2 | 290 | burst 1.2 m in: r 2 m, 380 |
| he85 | he | 85 | 790 | – | 11 | 9.5 | 255 | he 15, blast 3.5 |
| aphe88 | aphe | 88 | 780 | 165 | 9 | 10 | 300 | burst r 2 m, 380 |
| apcr88 | apcr | 88 | 930 | 210 | 16 | 7.3 | 260 | |
| he88 | he | 88 | 820 | – | 11 | 9 | 265 | he 16, blast 3.5 |
| apds105 | apds | 105 | 1430 | 300 | 4.5 | 5.8 | 280 | |
| heat105 | heat | 105 | 1170 | 400 | 12 | 10.4 | 270 | |
| hesh105 | hesh | 105 | 730 | 120 | 11 | 11 | 300 | angle-blind to 60°; spalls from the inner face; blast 4 |
| apfsds120 | apfsds | 120 | 1650 | 560 | 3.0 | 4.6 | 320 | |
| heat120 | heat | 120 | 1140 | 480 | 12 | 13.5 | 300 | |
| he120 | he | 120 | 900 | – | 11 | 15 | 360 | he 22, blast 5 |
| apfsds125 | apfsds | 125 | 1700 | 520 | 3.0 | 4.8 | 320 | |
| heat125 | heat | 125 | 905 | 450 | 12 | 19 | 300 | |
| he125 | he | 125 | 850 | – | 11 | 23 | 375 | he 23, blast 5.5 |
| he152 | he | 152 | 600 | – | 10 | 40 | 900 | he 60, blast 7 |
| aphe152 | aphe | 152 | 600 | 140 | 9 | 49 | 420 | burst r 3 m, 600 |
| heat152 | heat | 152 | 700 | 300 | 12 | 27 | 380 | |
| ap20 | ap | 20 | 850 | 35 | 11 | 0.12 | 40 | tracer every 3rd |
| hei20 | hei | 20 | 850 | – | 13 | 0.12 | 20 | he 4, blast 1.5 |
| ap23 | ap | 23 | 980 | 40 | 11 | 0.19 | 40 | |
| heit23 | hei | 23 | 970 | – | 13 | 0.19 | 22 | he 5, blast 1.8 |
| apds30 | apds | 30 | 1100 | 65 | 5 | 0.3 | 60 | |
| hei30 | hei | 30 | 960 | – | 13 | 0.4 | 30 | he 6, blast 2 |
| hevt35 | hevt | 35 | 1175 | – | 12 | 0.55 | 60 | prox 4 m (armed after 0.4 s), blast 3.5, he 6; self-destructs at 6 s |
| apds35 | apds | 35 | 1385 | 80 | 4.5 | 0.38 | 70 | |
| ball8 | ball | 7.6 | 850 | 10 | 12 | 0.01 | 9 | |
| ball13 | ball | 12.7 | 890 | 22 | 11 | 0.05 | 16 | |

**Per-type constants (`SHELL_TYPES`).**

| Type | Ricochet window | Normalisation | Path length L | Spall n | Spall cone |
|---|---|---|---|---|---|
| ap | 65–75° | 5° | 3.0 m | 8 | 22° |
| aphe | 63–73° | 5° | 3.0 m | 4 | 18° |
| apcr | 61–71° | 2° | 2.0 m | 6 | 16° |
| apds | 70–80° | 2° | 3.5 m | 10 | 16° |
| apfsds | 73–83° | 2° | 4.5 m | 12 | 14° |
| heat | 75–85° (the fuze fails) | 0° | 1.8 m (jet) | 6 | 10° |
| hesh | ≤ 60° | angle-blind | – | 12 | 35° |
| ball | 55–65° | 0° | – | 0 | – |

**Checking the numbers against the catalogue.**
- TK-34 (85 mm APHE) has 124 mm at 1 km: it goes through a Tygr's 102 mm front.
- MS-4 (75 mm AP) has 84 mm at 1 km (95 at 300 m): it bounces off the TK-34's 99 mm glacis at any real range and has to flank (sides 40 mm).
- MA-1 120 APFSDS has 517 mm at 1.5 km: it goes through a TK-72's upper glacis (335 LOS) but not its lower plate (528).
- 105 APDS has 277 mm at 1 km: it can't go through an MA-1's turret front.
- MGs only go through open tops, armoured cars' sides and roofs.
- (P1 review, for 3I) Measured against the delivered defs, two of these don't hold. The lower front plates are weak spots: hullMedium's is 45 mm at 53° = 74.8 mm effective, so the 75 mm AP (94.9 / 83.9 / 76.9 mm at 300 / 1,000 / 1,500 m) goes through the TK-34 from the front at every range to 1.5 km; hullCasemate's lower front is 85 mm against its 139 mm glacis. And the 12.7 mm MG (21.6 mm at 100 m) goes through the sides of the Light Hull (15 mm), Troop Hull (20) and the Small, Open and AA turrets (20), and, at steep angles, most roofs (all but the Heavy Box Hull's). Weak lower plates are War Thunder's way and may stay; 3I either thickens them (hullMedium edge[1] ×1.35 gives about 101 mm) or rewrites these two lines.

---

## 4. Movement physics

Old wheels keep their exact arithmetic. Everything below runs only for vessels with new running gear, `v.gear.length > 0`; `v.gear` is a frozen empty array (`NO_GEAR`) on every old design.

### 4.1 Hooks (fixed: the hook is first)

```js
// vessel.js:931, the first line of ground():
if (this.gear.length) return Gear.ground(this, dt, sim);
// vessel.js:504, the first line of turnTarget():
if (this.gear.length) return null;            // Gear rights the hull itself (§4.6)
```

`Gear.ground` is a separate function in `js/gear.js`. It copies only the crash and dent rules, the `bouncy` flag, and the `contactTime`/`landed`/`restTime` semantics, line for line. `landed` keeps its meaning (touching **and** slower than 1.5 m/s, `vessel.js:1060`). Ground classification never reads `landed` (§11.4).

### 4.2 Contact points and the probe budget

**`computeHull` (`vessel.js:290-323`).** Gated branches, only for `def.gv`:
- **Tracks:** `Gear.points(p, wheels)` pushes `n` contact points per track, `{ p, x, y, z, r: track.r + 0.4·travel, gear: 1, side, i }`.
  - Points sit at x = p.x + (i/(n−1) − ½)·0.8·w, y = −h/2 + track.r and z = partZ(p).
  - `side = sign(partZ(p) − com.z)` (+1 is the right, +z).
  - The radius includes the static sag (0.4·travel), so at rest the drawn belt meets the ground.
- **Armoured wheels:** one point at the wheel centre with r = awheel.r + 0.4·travel.
- **Inner parts:** no corners.
- **Parts with an `outline`:** corners are the outline vertices × the two z faces (a sloped glacis no longer touches the ground at an empty box corner).

Gear points go into `wheelPts`, so `placeOnSurface` (`vessel.js:1069-1081`), `reach` and `wheelbase` include them unchanged.

**(critic) Turret parts keep their corners** in `v.hull` at the build pose. The plane-band cull (step 4) drops them while the tank is upright, so they cost nothing, but an upturned tank lands on its turret roof instead of sinking to its hull.

**(critic) Old Car Wheels on a gear vessel** stay in `wheelPts` without `gear: 1`. `Gear.ground` probes them like gear points (one locate and one `surfaceAt` each) as rigid, free-rolling contacts (rolling mu 0.025, sideways 0.8, no drive), so they carry weight and never fall through.

**(critic) What `Gear.ground` keeps up to date**, because other code reads it: `contactTime`, `landed`, `restTime`, `splashed`, `onFloats` (false), `wheelsDown` (any gear contact: drive1k, the stall horn at `flight.js:562`, `flight.js:924`), `canDrive` (gear down, a driver, an engine), `wheelSpeed` (the mean belt speed) and `steer` (armoured wheels).

**`Gear.ground`, step by step.**
1. **Broad phase** as today: `r − reach > R + terrainMax + 5` gives `clear()`. `L0 = surfaceSpot()`; `h0` (with deck) and `lim0` as today. One `waterAt` at L0.
2. **Gear probes.** For each gear point, using shared preallocated vectors (`qrot(…, out)`): one `Terrain.locate` (shared `loc`) and one `surfaceAt`. **No `normalAt` per contact.**
3. **One plane fit.** A least-squares plane through the gear points' ground heights, in the hull's horizontal axes, gives the normal `nG` that every gear contact uses.
   - If both sides have no contact, or the points are collinear (one track down), the fallback is `normalAt(L0)` (4 calls).
   - The fit replaces 4 `surfaceAt` per contact today (`vessel.js:946`).
4. **Hull corners culled against the plane.**
   - A corner is probed only if its height above the plane (a dot product) is under `0.6 m + 0.02·horizontal distance from the COM`.
   - (critic: corrected) An upright tank with 0.45 m of ground clearance probes only its **four belly corners** (the bottom edge's two outline vertices × two z faces); its other 20-odd hull, turret and gun corners are culled. On a crest the belly's front corners scrape. Keep the 0.6 m band: a narrower one would miss a crest under the belly that the gear-point plane can't see.
   - With no gear contact on the last step (airborne, or on its roof), hull corners use the old `lim0` cull, so rollovers are still caught.
5. **Crash check.** As today, for both gear and hull contacts:
   - closing speed above 1.6 × `breakSpeed` breaks the part (`sim.breakParts`);
   - between 0.75 and 1.6 dents it (`Combat.impact`, once per 0.4 s).

Tracks have `breakSpeed` 18.

**Budget.** For an upright tank with 2 tracks × 3 points, a step costs 6 locate + 6 surfaceAt + 1 surfaceAt (L0) + 1 deckAt + 1 waterAt, plus (critic) 4 locate + 4 surfaceAt for the belly corners: 13 counted terrain calls, about 70 µs in Node on desktop. `test/ground.test.js` counts calls with a counting wrapper (on `Terrain.surfaceAt`, `heightAt`, `waterAt` and `deckAt`) and asserts **at most 16 terrain calls per step** for every stock vehicle upright on the arena pad, and at most 24 on its 10° slopes. The count is deterministic, so it can't flake the way a timer would.

### 4.3 Suspension (graft from phone, judged correct)

**Per gear contact i** (N = the vessel's gear point count, s0 = 0.4·travel):

```
k   = m·g / (N·s0)                      c = 2ζ·√(k·m/N),  ζ = 0.45 (Silly 'bouncy': 0.08)
Js  = max(0, k·min(pen, travel) − c·vn)·h     applied once along nG before the iterations;  JN_i = Js
pen > travel: the excess is a bump stop, resolved by the rigid normal impulse inside the iterations (it adds to JN_i)
```

Natural frequency √(g/s0)/2π is about 1.6 Hz on medium tracks. ωh is about 0.08 at h = 1/120 (0.17 at 1/60, 4× warp, solo only), stable. A part shot off (a mass change) recomputes k from `rebuildGroups`.

### 4.4 Traction, power and skid steering (accumulated impulses on gear contacts only)

Each gear contact has a rolling direction `t1` (the hull's forward axis projected on nG) and a sideways direction `t2 = nG × t1`. Gear contacts **accumulate** their impulses, so results don't depend on which iteration settles a contact. Old contacts keep the per-iteration clamp, `vessel.js:1006-1029`.

**Belt targets per side** (s = ±1):
```
P      = Σ engines kw·1000·engineK(p)·(p.broken ? 0 : 1) · (v.flooded ? 0 : 1) · (Armour.has(v,'driver') ? 1 : 0)   (W)
Vmax   = min(track.vmax) over live running gear · clamp(Σload / m_t, 0.5, 1);   Vrev = Vmax·rev
base   = ctl.v ≥ 0 ? ctl.v·Vmax : ctl.v·Vrev
str    = ctl.h · (base < −0.1 ? −1 : 1)                 (reversing steers like a car's tail: War Thunder's default)
turnMax= track.turn · min(1, √((P/1000)/m_t / 12))      (a weak engine pivots slowly)
ω      = str · turnMax · (1 − 0.55·min(1, |vt|/Vmax))   (wider turns at speed)
v_s    = base − s·ω·B/2                                  (B = distance between the two tracks' contact lines)
```
D turns right: the left belt runs faster. The stick sideways alone gives base 0 and counter-rotating belts, a **neutral turn**.

**Solver.** Four iterations per step, in this order:
1. Rigid normal impulses for hull contacts and bump stops (adding to `JN_i`).
2. **Traction along t1:** `Δ = (v_s − vt_i)/effMass`. The new total is clamped to ±mu·JN_i.
   - **Driving** impulses (Δ toward the belt target and adding kinetic energy) come out of the side's budget, `B_s = h·0.5·0.6·P / max(|v_s|, 1.5)` (transmission η 0.6).
   - **Braking** impulses cost no power and are limited by grip only.
3. **Lateral along t2:** the total is clamped to ±track.side·JN_i (0.15 in water).
4. Hull-corner friction as today (isotropic 0.9, 0.15 on water).

Then:
- **Push-out:** 0.9 × max(hull pen, gear pen − travel), along that contact's normal.
- **Brakes and coasting:**
  - B held, or no input below 0.3 m/s: target 0 at full mu (a parking brake that holds on slopes).
  - No input and moving: target 0 with the per-step traction total capped at 0.18·m·g·h (engine braking, about 1.8 m/s²).
- **Rolling resistance** `crr·m·g` against the horizontal velocity at the COM while gear touches, never reversing it.
- **Armoured wheels:**
  - Axles more than 0.3 m ahead of the COM steer `t1` by `δ = ctl.h·min(0.5, 5·wheelbase/max(1, vF²))`.
  - Below 3 m/s a skid assist adds ±0.3·ω·B/2 to the side targets (tight circles, no true pivot).
  - Every wheel is driven from the same engine budget.
- **A broken track or wheel** gives that side no traction (mu 0.05): the tank swings round the dead side, and the player can still pivot on the good one.

**What it gives** (targets for `ground.test.js`, ±25%):

| Vehicle | t | kW | hp/t | Top km/h | 0–30 km/h | Pivot | Climbs at 2 m/s |
|---|---|---|---|---|---|---|---|
| TK-34 | 27.3 | 450 | 22.1 | 50 | 3.8 s | 40°/s target (≥ 24 measured) | 28° |
| MS-4 Shermin | 26.1 | 260 | 13.4 | 50 | 6.3 s | 37°/s | 16° |
| Tygr I | 50.5 | 450 | 11.9 | 43 | 7.1 s | 27°/s | 14° |
| MA-1 Abrahm | 56.3 | 1,100 | 26.2 | 68 | 3.2 s | 34°/s | 34° |
| Pumo 8×8 (wheels) | 12.3 | 260 | 28.3 | 108 | 3.0 s | no pivot | 36° (grip, mu 0.75) |

Grip caps slopes near atan(0.9) ≈ 42°. Below about 10 hp/t power stalls first. A heavier tank is slower, which was the critic's worst problem with today's controller.

### 4.5 Water

Water is a property of the L0 spot (one `waterAt` per step).
- **Gear contacts in water:** traction mu 0.12 and Vmax 2 m/s: wading. A hull with `amph` gets mu 0.35 and Vmax 3.5 m/s: swimming.
- **The existing water damping** (`vessel.js:1051-1056` semantics) still applies.
- **Flooding:** deeper than 1.4 m above the lowest engine part, without `amph`, sets `v.flooded`. It gives "Engine flooded!" and P = 0; the engine restarts 5 s after leaving the water.
- **Nothing sinks:** the sea stays solid, as today, which is cheap and consistent.
- **Old cars** still drive on the sea, unchanged.

### 4.6 Attitude, rollover, righting

**Free in the air.** `turnTarget` returns null for gear vessels. The stick never rotates a hull, and tank hulls have no reaction-wheel authority (`torque` 0), so a tank off a ridge flies ballistic. That is fun.

**Righting, inside `Gear.ground`.**
- **When:** the hull's up has been more than 70° from nG (or the up radial in the air) for 1.5 s, speed is under 3 m/s, and the vessel is within 3 m of the ground.
- **How:** a torque of `3·m·g·B` about `u × n` is applied as `av += I⁻¹·τ·h` until the hull is within 20° of upright.
- **Hint:** "Righting…".
- It acts only when the player is stuck (control first).

**Tipping.** A tall SPAA tips on side slopes past its static threshold (half the track distance over the COM height). The builder warns about it.

### 4.7 Collisions between vehicles (graft: every judge wanted them)

`Gear.bump(v, sim)` is called at the end of `Gear.ground`, for local gear vessels only.

| Step | Detail |
|---|---|
| **Shapes** | Each vessel's body box is the bounding box of its parts outside turret groups, cached in `rebuildGroups` (`v.bodyBox`). Ghosts and wrecks get theirs from their parts. |
| **Test** | Spheres first (`reach_a + reach_b`), then an OBB–OBB separating-axis test with 15 axes, about 1 µs per pair, against every other vessel in `sim.vessels`: local AI, ghosts (`v.remote`), wrecks (`v.wreck`), debris with parts. |
| **Response** | Push our vessel out along the minimum axis, and apply an impulse that removes the approach speed (restitution 0.15, friction 0.3). Ghosts, kinematic AI and wrecks are immovable. Each owner resolves its own vehicle, so a push shows on both screens. Two local gear vessels split the push by mass. (critic) A local vessel **without** gear (an old car, a parked plane, debris) takes the equal and opposite impulse through `applyImpulse`, split by mass, so a tank can shove a buggy; such vessels never start a bump themselves, so two old vessels still pass through each other exactly as before. |
| **Ramming** | A closing speed above 6 m/s dents the front part through `Combat.impact` (local damage only, never sent) |
| **Old cars** | Still pass through things, as before |

### 4.8 What physics writes for the renderer, the HUD and sound

- `p.belt` (metres travelled, per track part) and `p.spin` (per armoured wheel), from the side's contact speed.
- `v.beltV = [vLeft, vRight]`, `v.susp` (mean compression per side, for the visual belt offset), `v.drivePower` (W used, for engine sound), `v.flooded` and `v.righting`.

Ghosts and kinematic AI get belt and spin worked out in `VesselMesh.update` from their velocity and yaw rate (`v_fwd ∓ ω·B/2`), with no protocol cost.

---

## 5. Aiming and the turret model

### 5.1 Turret groups: who turns with a ring

`Aim.groupsOfParts(parts, adj)` is pure and deterministic from rows, so it gives the same answer in the builder, a Vessel, a ghost and the renderer.

```
for each ring R (def.ring, rot 0; others: warned, never turn):
  top = partRect(R).t;  c = (R.x, top, partZ(R))
  seeds   = adj(R) with partRect(q).b ≥ top − 0.05
  members = BFS from seeds over adj, entering only parts with partRect(q).b ≥ top − 0.05, never R
          ∪ attachedTo(parts, members)            (anything whose att chain leads to a member: a breech below the ring's top, a bustle bin)
  jam     = the first member adjacent to a non-member other than R  → [memberId, otherId]; a jammed ring never turns (builder warning names both)
  nested  = a ring inside another group: its own group with parent = that group (two levels at most; deeper rings are fixed)
group = { ring: R, c, ids: Set, members: [parts], mass (t), rate (rad/s), stab, parent, jam, yawLim: null | [lo, hi], dep: Float32Array(12) | null }
rate  = ring.rate·π/180 · clamp(√(ring.cap / mass), 0.35, 1)
```

`Vessel.rebuildGroups` calls `Aim.groups(v)` (for `v.gv` only). It sets:
- `v.tg`: the groups, outer first;
- `v.tgOf`: a Map of part id → innermost group;
- `v.aimed`: the parts with `def.aim`;
- `v.crewCache`, cleared.

**Physics keeps the build pose** for mass, inertia and the hull. A turned turret moves the COM by a few cm, a second-order error (physics map). Turret corners stay in `v.hull` at the build pose and the plane-band cull skips them while upright (critic: not dropped, see §4.2). `partGeo`, hull and area caches are never touched per step.

### 5.2 Pose transforms (aim.js, pure, out parameters, no allocation)

**Ring yaw.** `Ry(ψ): (x, y, z) → (x·cosψ − z·sinψ, y, x·sinψ + z·cosψ)`. It turns +x toward +z (to the right). A ring's `p.aimYaw` is ψ.
- A member point: `P' = c + Ry(ψ)(P − c)`, composed innermost first through parents.
- In three.js: `qψ = setFromAxisAngle(Y, −ψ)`.

**Guns.** They keep `p.aimYaw` and `p.aimEl` with the existing turret conventions (`combat.js:362-367, 383`; `parts3d.js:1804`):
- unturned local barrel direction `g = (−sin el, cos el·cos yaw, cos el·sin yaw)`, turned by `rot` (rot 3 on a ground vehicle: local +y forward, local +x down);
- trunnion `T = partPt(p, 0, −h/2 + pivot·h)` at `partZ(p)`.
- (P1 review) **The pivot of both own angles is T.** A part's own yaw (`aim.trav`: a pintle MG ±180°, a tracking dish, a casemate gun) turns it about the vertical through T, as its elevation does: T stays put and the muzzle swings one barrel length (h − pivot·h) round it. The 3D yaw node (§3.4) and the hit prism (§5.5) use the same point.

**API:**
- `Aim.pose(v, p, P, out)` and `Aim.unpose(v, p, P, out)`;
- `Aim.dir(v, p, out)` (barrel direction in sim axes);
- `Aim.muzzle(v, p, out)` (barrel tip, `T + g·(h − pivot·h)`, in sim);
- `Aim.trunnion(v, p, out)`;
- `Aim.sightPoint(v, out)` (the primary gun's turret roof, 0.35 m above the trunnion, 0.3 m toward +z, through the group).

### 5.3 Limits and the sweep (graft from build)

`Aim.sweep(parts, group)` is pure. It runs in the builder in `changed()`, debounced 150 ms for kind tank, and at launch through `Aim.limits(v)`, lazily, cached by the group signature.

- **Traverse.** For ψ = 0..355° in 5° steps, rotate the members' boxes and prisms about the ring and SAT-test them against non-member parts other than the ring's base. The free interval containing 0 becomes `yawLim` (null means a full circle).
- **Depression.** For each main gun in the group, in 12 sectors of 30°, step the elevation down from 0 to `aim.el[0]` in 1° steps. The barrel is a capsule (10 points, r 0.12 m) tested against the hull's prisms. The lowest clear angle goes into `dep[sector]`.
- **Cost:** a few ms, once. Old designs never call it.
- (critic) The debounced result lands outside any player input, so when it changes the arcs or the warnings it calls `renderStats()` and `Builder.redraw()` (the on-demand drawing contract, `redraw.mjs`). Otherwise the idle hangar would show stale arcs until the 500 ms heartbeat.

### 5.4 The aim step (per physics substep, frame-rate independent)

`Aim.stepAll(F, h)` is called from `Combat.step` (§16 hook 25). It runs for `F.active` when `F.groundAim`, and for each local AI ground vessel (`v.ai.ground`), using `v.aimP`.

1. **Wanted point.** `A` = `F.aim.P` (§8.2) for the player, or the AI's target point.
   - **Arcade aim:** the selected shell's ballistic lift for the measured range is added in the vertical plane.
   - **Realistic aim** (§8.5): the lift for the sight's zero range instead.
   - **Locked SPAA:** the lead point (§7.2) replaces A.
2. **Rings, outer first.**
   - The direction from c to A goes into the group's parent frame (`v.toLocal`, then the inverse parent rotations).
   - Project it on the ring plane. `ψwant = atan2(d.z, d.x) − az(W)`, where W is the **primary weapon**: the selected system's part if it is in this group, else the largest-calibre aimed weapon in it, else the tracking dish. `az(W)` is its build-pose barrel azimuth (0 for a forward gun).
   - Clamp to `yawLim`. Slew at `rate` (×0.5 with the ring module below 50% hp, 2°/s when broken: the hand crank; 0 when jammed).
   - **Two-plane stabiliser** (`ring.stab` 2): before slewing, ψ is corrected for the hull's yaw change since the last step, so it is world-stable.
3. **Aimed parts.** From the posed trunnion to A, into the part's unturned frame: inverse groups, then the inverse rot k steps (the `turretStep` loop, `combat.js:366`). Then `yaw = atan2(lz, ly)` and `el = atan2(−lx, hypot(ly, lz))`.
   - Clamp yaw to the part's own arc: `aim.trav` if set; `aim.casemate` when the part is in no group; ±0 for a main gun on a ring, ±3° for a coax.
   - Clamp el to `[max(aim.el[0], dep[sector(ψ)]), aim.el[1]]`.
   - Slew at `elRate` and `travRate`.
4. **Stabiliser** (graft from phone; it emerges from the rate limits).
   - Stabilised axes (`aim.stab ≥ 1` for elevation) first re-express last step's world direction in the new hull frame, so hull pitch doesn't move them.
   - Unstabilised axes keep their hull-relative angle and catch up only at `elRate` (4–10°/s). The hull pitches at 10–20°/s over bumps, so an unstabilised gun bounces off target on the move. That is War Thunder's lesson.
   - Cost: two `qrot` per aimed part per step.
5. **Firing.** It happens along the **actual** barrel, so turret lag is visible. Dispersion is `aim.disp` mrad × (stab ? 1 + speed/20 : 1 + speed/6).
   - (critic) **Where each trigger is read, for frame-rate independence.** `playerFrame` runs once per rendered frame (`combat.js:397`, from `frame`). Only the main gun's single shot belongs there: on the trigger edge (`edge`, `F.fireTap`), placed **before** the "empty" toast (`combat.js:428`), because zero ready rounds with rounds in the racks means "reloading", not "empty". Held fire (the selected `agun`, and the MGs on Space or the MG button through `F.mgFiring`) runs here in `Aim.stepAll`, every substep with its own `p.cool`, as `fireGun` does (`combat.js:243-246`).
   - (critic) `playerFrame`'s lock block skips launchers with `seek` 'saclos' or 'clos' (no lock tone; 'clos' uses the tracking radar's lock).
   - (critic) **Aimed weapons on other kinds** (planes, helicopters, rockets: aim mode is off) fire along their build pose, aim held at 0, through the same `Aim.fire`. A 37 mm gun on a plane works as a fixed cannon, and a helicopter's SACLOS missile follows its nose ray. No part is dead weight on any craft.

### 5.5 How the aim reaches combat, the renderer and the network

- **Hits:** `Armour.hitAll` transforms the segment once per group (inverse Ry) and once per turned or elevated aimed part (its inverse own yaw, then inverse elevation, both about its trunnion, §5.2), then tests each part in its build frame. A turned turret is hit where it is, and a raised barrel's box rises.
- **Blasts:** `explode` measures group members' distances through `Aim.pose`.
- **Renderer:** after `place(rig)` (`parts3d.js:1678-1685`), for rigs whose part is in `v.tgOf`: `root.position = c + Ry(ψ)(pos − c)` and `root.quaternion.premultiply(qψ)`, innermost first, with preallocated temporaries. Guns use their `yaw`/`pitch` nodes as today.
- **Multiplayer:**
  - The `pv` filter (`mp.js:629`) adds `|| d.ring || d.trackRadar`. Ring ψ rides in the existing `aimYaw` column (index 6), and gun angles already do. The row layout is unchanged.
  - `onPartVis` writes the received angles as targets (`p.aimYawT`, `p.aimElT`). `MP.beforeUpdate` eases `p.aimYaw += wrap(T − p.aimYaw)·(1 − e^(−12·dt))`. The renderer and the shooter's hit tests both use the eased values, so remote turrets don't step at 5 Hz.
  - (critic) Only for `p.def.gv` parts. Old turrets (`turret`, `turretL`) keep today's direct write, so they look and fire their show rounds (`netGuns`) on other screens exactly as before.
  - (critic) When `onParts` removes parts from a plated ghost, it calls `Aim.groups(g)`, so a lost ring stops turning what remains.

### 5.6 Ballistic solve (shared by aim, HUD, builder and AI)

`moveShot`'s drag gives v(x) = v0·e^(−kρx).

```
t(D) = (e^(kρD) − 1)/(kρ·v0);   drop = ½·g·t²;   el = atan2(ΔH + drop, D)        (Aim.solve(shellKey, D, ΔH, body) → {el, t, drop, v})
```

- **Accuracy:** good to under 0.5 m at 2 km for every shell. `aim.test.js` asserts it by firing real shells.
- **Rockets:** a range table per launcher type, built once on first use by stepping a rocket through `moveShot`'s arithmetic at 2.5° steps from 5° to 55° (23 paths, about 15 ms once), then interpolated (`Aim.rangeTable(def, body)`).

---

## 6. Ballistics, armour and damage

### 6.1 Shells in flight

**The shot object.** Shells are `S.shots` entries:
```js
{ k: 'shell', sh: 'apfsds120', b, x, y, z, vx, vy, vz, t: 0, life: 6, owner, enemy, net, cal, pen, v0,
  spare: owner, tracer, prox, ric: false, gTop }
```
Machine-gun and autocannon rounds are shells too (`ball8`, `hei20`, …), marked `cheap: true`.

**Stepping.** `moveShot` gets one first line, `if (s.k === 'shell') return Armour.moveShell(s, h, F);`, so the old branches are byte-identical. `moveShell` applies:
- **Gravity and drag:** `b.mu/r²`, and `v −= v·k·ρ·|v|·h`.
- **Vessels:** tested with `Armour.hitAll` against every non-dead vessel except the owner for 1.5 s, as today. A wreck stops the shell with sparks and no damage. A `net` replica tests nothing.
- **Range targets:** spheres (`segPoint`), unchanged.
- **Proximity fuze (`hevt`):** after 0.4 s, air candidates within 50 m are gathered once per substep, and `segPoint` < `prox` triggers `explode`.
- **Ground test, cheaply** (graft from wt; and from phone, the coarse cache):
  - Skip it while the shell is above `s.gTop`. `gTop` is set at fire time to the arena's measured `hmax + 5 m` when the muzzle is in an arena box, else +∞.
  - Otherwise test every 2nd substep (a two-step segment). On a hit, bisect with 3 `surfaceAt` calls for the impact point.
  - (critic) **Near the ground, sample the segment, not just its end.** A 1,650 m/s shell moves 27 m per two-step segment, longer than a berm (σ 3.5 m) or a sharp crest, so an end-point test lets it pass through. When either end is within 6 m of the ground (both heights come from the test anyway), add samples every 5 m along the segment (3–5 `surfaceAt`, cached lattice, about 20 µs). Higher than that, the end-point test is exact enough. `ground.test.js` fires level shots 1 m over a berm crest from 300 m and asserts every one hits it.
  - `cheap` rounds use `Armour.coarseH(e, z)`, a 16 m lattice in its own 20k-entry Map, and do exact tests only within 3 m of the coarse ground. This keeps autocannon streams from thrashing the 80k-entry lattice cache (`terrain.js:603-627`).
  - Old shots keep their test unchanged.
- **Ground impact:** HE bursts through `explode(…, he, spare)`; other shells puff dust or splash.

### 6.2 Hit geometry

`Armour.hitAll(v, a, e, out)` returns every part the segment crosses, sorted by entry: `[{ p, t0, t1, n: {x, y, z} (part-local entry normal), edge }]`, in a reused array.
- **Prisms:** Cyrus–Beck (Liang–Barsky) clip against the outline's edge half-planes plus the two z slabs. It gives the entering edge or ±z.
- **Round parts:** an upright cylinder plus the top and bottom caps. The side normal is radial, tilted by `round.slope`.
- **Other parts:** `segBoxN`, a copy of `segBox` that also returns the entry axis and sign.
- **Built-in mods:** segment-versus-sphere tests on the host's mods, in the host frame.

`Armour.hitFirst(v, a, e)` returns only the first. Legacy shots against plated vessels use it (§16 hook 28). `hitVessel`, `segBox` and `boxesOf` stay untouched, because the combat fingerprint calls them.

### 6.3 The resolver: `Armour.resolve(s, v, hits, F)`

**Per entry, in order:**

| Step | Rule |
|---|---|
| Face thickness | `t = (p.mm ?? armour.mm) × edge[i]` (z faces: × `armour.z`; round parts: × factor by bearing; open faces: 0) |
| Angle | `θ = acos(\|d·n\|)` using the world normal (rings and gun elevation applied). Normalised: `θ' = max(0, θ − norm)`. |
| Overmatch | `cal ≥ 3·t`: θ' ×0.6 and no ricochet |
| Effective | `eff = min(t / cos θ', 6t)`; × `armour.heat` against HEAT |
| Ricochet | probability `smoothstep(lo, hi, θ')`. The round leaves along `d − 2(d·n)n`, jittered 4°, at 0.6× speed and 0.5× pen, as a new shell with `ric: true` (a ricochet never ricochets again). The struck part takes 0.02·dmg. HEAT that ricochets fails to fuze. |
| ERA | −`era.ke` (kinetic) or −`era.ce` (HEAT; tandem ignores the first block); the brick is ripped off |
| Skirts (`spaced`) | HEAT fuzes here: pen ×0.7 − 250 mm per metre of gap to the next plate |
| Slat | a non-tandem HEAT round or missile duds with probability `slat` (10% damage) |
| Applique plates | subtract their `eff` |
| The first structural part (hull, turret, mantlet, track, gun) | `pen ≥ eff` gives a **penetration**. `0.8·eff ≤ pen < eff` gives "no penetration" with a 30% chance of 2 inner fragments. Less gives "no penetration". |
| HESH | angle-blind to 60°: `eff = t`. It defeats plates up to 120 mm and spalls 12 fragments from the inner face (needs no residual). |
| (critic) **Unarmoured parts** (no `def.armour`: every old part, and every part of an old craft) | The table above needs a thickness these parts don't have. They count as 0 mm and take the shell's full `dmg`, as a bullet does today: `Combat.damage` locally (so `def.armor` on the Armoured Fuselage still applies, once), or a `[part, dmg]` row in `MP.sendHits(…, 'shot')` for a ghost. A kinetic round carries on through with pen −10 mm, and an HE, HEI or HE-VT round bursts there through `explode(…, he)`. On an unplated vessel (`!v.plated`: aircraft, AI fighters, old cars) that is all that runs: no post-penetration step. This is how SPAA shells kill planes (the 35 mm HE-VT does about the same per hit as today's 30 mm cannon), and a tank gun shreds the technical's cab. |

**After penetration** (`Armour.postPen`, deterministic per hit: an RNG seeded from the shot serial and the vessel's control part id):
- **Path:** from the entry point along d, length L by type. It damages every built-in mod sphere and inner part it crosses for `dmg·(1 − 0.5·s/L)`, and loses 30 mm at an engine and 10 at a rack. It exits through the far face if the residual beats it (over-penetration).
- **Spall:** `n × clamp(residual/40 + 0.5, 0.5, 1.5)` rays in the cone, each 2.5 m. Each hits the first module or inner part for 45 ± 15. A fuel cell stops it.
- **APHE:** at 1.2 m past the plate, a burst of radius r with `burst·(1 − d/r)^1.2` to every module in range.
- **Structure:** the entry part takes 10% of dmg; a non-penetration 3%.
- **Cost:** ≤ 60 sphere and ≤ 20 prism tests per penetration, about 30–60 µs. Penetrations happen a few times a minute.

`resolve` returns `{ r: 'ric' | 'nopen' | 'pen' | 'hit', rows: [[part, dmg]], mods: [[part, modIdx, dmg]], at, what: ['CREW', 'ENGINE', …], crew: n, ric: shot | null }`.

### 6.4 HE against armour (the `explode` hook)

`explode(b, at, blast, dmg, by, sim, quiet, he, spare)`. Old calls pass neither of the two new arguments.
- **`spare`:** that vessel is skipped. Shells and new launchers pass their owner while `s.t < 0.6`.
- **Unplated vessels** (`v.gv` false) take today's loop unchanged.
- **Plated vessels** (`Armour.blastK(v, p, d, blast, k, he0, out)`):
  - `he(d) = he0·(1 − d/blast)^1.5`, where `he0 = he ?? 3·blast` (legacy blasts: a 250 kg bomb gets 90 mm at 0 m).
  - **Armour parts:** overmatched when `he(d) ≥` the part's thinnest face toward the blast (roof, side, or open). Then structure takes k, and its built-in mods within the blast take 0.5·k. Otherwise structure takes 0.15·k.
  - **Inner parts:** they take 0.5·k only if their host is overmatched, else nothing.
  - **Tracks, wheels, guns, radars, launchers:** full falloff when `he(d) ≥ 20 mm`, else 0.3·k. HE strips tracks, barrels, radars and skirts, as in War Thunder.
- **Open-top turrets** are overmatched by anything from above, so a near miss kills the crew of an open SPAA.
- (critic) **Parts without `def.armour`** on a plated vessel (the technical's cab and chassis) count as 0 mm: always overmatched, so they take today's k.

### 6.5 Old weapons against the new armour (combined arms, no change against old targets)

`Armour.legacyHit(s, v, p, at, F)` runs when an old shot's direct hit lands on a part with `def.armour`. The penetration is worked out from fields the old shot already has (no field is added to old shots):

| Old shot | Pen (mm) |
|---|---|
| `bullet`, dmg ≤ 9 (MGs, gun pods, turrets) | 10 |
| `bullet`, dmg 10–19 (20 mm rotary and chin guns) | 30 |
| `bullet`, dmg ≥ 20 (30 mm cannon and gatling) | 55 |
| `rocket` (rocket pods) | HEAT 120, then the blast |
| `missile`, seek 'ground', not glide | HEAT 700 (dmg ≥ 2000: 900, cruise missile) |
| bombs, glide bombs, air missiles | through `explode` (he = 3·blast) |

Through the resolver a penetration does the shot's dmg ×3 along a 1.5 m path; otherwise 5%. So aircraft kill tanks from above or behind with 30 mm guns, rockets, AGMs and bombs: War Thunder close air support from parts that already exist.

### 6.6 Modules, crew, knock-out and repair

**`destroyPart` hook.** `if (p.def.module) return Armour.moduleDown(v, p, cause, sim);` is the first line (old defs have no `module`).

**Breaking.** `moduleDown` sets `p.broken = true` and `p.hp = 0`, and the part stays. It is idempotent.

**(critic) Smoke and fire from modules.** The existing loop (`combat.js:1175-1189`) sets every part under 30% on fire, at about 14 particles a second. Through it, a broken track, a broken breech or a dead crew seat inside the hull would burn. Its first line for `p.def.module` parts dispatches to `Armour.partFX(o, p, n)` (hook 70; old parts never reach it), which:
- burns only engines and fuel cells while `p.fire > 0`, and ammo stores while cooking off;
- gives other broken modules a thin grey smoke at a third of the rate;
- for wrecks, emits only from the 3 nearest (§10.6).

The `"${name} damaged"` and `"on fire!"` toasts in `Combat.damage` (`combat.js:51-53`) skip `def.gv` parts, because Armour's module toasts ("Left track broken") replace them.

**Module damage** to built-in mods goes through `Armour.modDamage(v, host, i, dmg, sim, by)` (hp kept in `host.mods[i]`, created lazily).

| Module | When damaged | When destroyed | Repair (stopped) |
|---|---|---|---|
| crew (mod or seat) | — | dead. **Role swap:** after 4 s a surviving crew member takes a missing driver's or gunner's seat, in the order loader, radio, commander ("Loader takes the gun"). | none |
| engine | power ×0.4 below 50% | P = 0. Fire odds by fuel (petrol 35%, diesel 12%, turbine 20%). Fire: engine −6 hp/s; crew within 2.5 m in that host −3 hp/s. | 15 s back to 60%; a fire goes out after 25 s, or after 4 s stopped |
| track / wheel | — | that side has no traction (mu 0.05) | 8 s / 6 s |
| breech (gun) | — | can't fire | 12 s |
| ring | traverse ×0.5 | traverse 2°/s (hand crank) | 12 s |
| radar, sight, launcher | — | off | 12 s / 10 s / 12 s |
| ammo (mod or rack) | rounds lost | **detonation** with probability `clamp((0.5 + 0.4·rounds/capacity)·cook, 0, 0.95)` (+0.2 vs HEAT, APHE or HE). `blowout`: vents, no knock-out, rounds gone. | none |
| fuel | — | 30% fire (8 s, 15 hp/s to crew in the host) | — |
| troops | capture bonus lost | — | — |

**Repairs** run automatically (no button: control first) only while speed < 1 m/s for 1 s, with no damage taken for 6 s and living crew. One module at a time, worst first. HUD: "Stop to repair: Left track" while moving, then "Repairing: Left track 6 s".

**Knock-out** (`Armour.knockOut(v, sim, why)`). It happens when:
- living crew < min(2, total crew), or
- an ammo detonation, or
- no control part left (the old rule).

What follows:
1. Every control-bearing part gets `p.ko = true`, so `findControlPart` (`parts.js:1287`, `&& !p.ko`) returns null.
2. For the active vessel, `sim.onDestroyed()` runs (`flight.js:391`), and so does `MP.onLocalDestroyed` in a room.
3. AI vessels go through `aiDown`.
4. **Detonation:** `explode(blast 6 + rounds/10, dmg 1500)`, plus the **turret toss**. The outermost group's base adjacency is cut, `splitComponents` runs, and the turret piece gets +9 m/s up and a 1–3 rad/s tumble (×2 with Silly `hollywood`).
5. The hulk stays (wrecks: §10.6).

**Spawn protection.** For 4 s after spawning, the owner ignores damage. It is a battle-only rule: `Combat.damage` checks `v.spawnAt`, which is set only on battle spawns. (critic) `Armour.modDamage` checks it too: `m` rows bypass `Combat.damage`, so without that check a crew could die while protected. `MP.startFlight` sets `Flight.active.spawnAt = Flight.time` after `Flight.start`.

**Ammunition flow.**
- A main gun fires its ready rounds (`p.ammo`). The next round comes from the active stores in part order: built-in ammo mods first, then racks, then the autoloader. "Racks empty first" makes firing your ammo down a real safety choice.
- Reload is `weapon.reload`, ×1.5 with no living loader, or `autoload` fixed.
- `weapon.stow` refills launcher tubes after `reload` s while stopped.
- Shell types share the gun's pool. 1–4 picks the next round; pressing the same key twice within 1 s unloads and reloads with it now. (critic) So the ammo chips (§8.6) show the type ("APHE", "HE") and the weapon chip shows the shared count once ("85 mm · 42").

### 6.7 Multiplayer damage without counting armour twice

**The shooter decides.** It resolves everything against the ghost: defs are local, the turret pose comes from eased `pv`, and the ghost's module hp is assumed full.

**What it sends.** One message per shot:
```js
{ t: 'hit', to, list: [[partId, dmg], …≤64], k: 'pen'|'np'|'shot'|'blast', m: [[partId, modIdx, dmg], …≤32], d: [dx, dy, dz] }
```
- `MP.sendHits(ghost, list, k, mods, dir)` gains two optional arguments. Old calls send identical messages.
- **The receiver's `onHit`** (`mp.js:858-875`) applies `list` through `Combat.damage` exactly as today. New parts have no `def.armor`, so `(1 − armor)` is a no-op, and an old fuselageArmor caught in a list keeps its reduction once. Then it applies `m` rows through `Armour.modDamage`:
  - the part id must be in its vessel;
  - `modIdx` must be an integer below `def.mods.length`;
  - dmg must be finite, clamped to 0..2000.
- (critic) `d` is used only for the edge arc, and only if it is 3 finite numbers with a length between 0.1 and 10 (then normalised). Otherwise the shooter's bearing is used.
- (critic) `sendHits` today returns when no `list` row is over 0.05 (`mp.js:850`). It now sends when `list` or `mods` has a row, so a hit that only reaches built-in modules isn't dropped.
- **Wrecks:** `sendHits` refuses wreck ghosts. (critic) Old shots reach it through `MP.sendHit` (`mp.js:845`), which calls `sendHits`, so the one check covers both.
- **The victim decides** knock-out, cook-off, fires and role swaps from its own state, so randomness lives on one side only. It reports `down` (§10).

### 6.8 Hit feedback

**Shooter.** At once, from its own resolution, on the canvas 48 px above the crosshair for 1.4 s:
- Ricochet! (yellow)
- Did not penetrate (grey)
- Hit · tracks / engine / gun (amber)
- Penetration · 2 crew (red)

Four ticks flash on the crosshair in the same colour. "Knocked out!" arrives with `down` ("Ammo detonation!" when `down.x`).

**Victim.**
- A red edge arc toward `d` (or the shooter's bearing) for 2 s.
- The damage diagram updates.
- Toasts: "Gunner knocked out", "Left track broken", "Fire!".
- Haptics: 35 ms on being penetrated, 12 ms on a bounce. iOS has none, so the visuals carry it.

---

## 7. SPAA, radars, player SAMs, ATGMs, rocket artillery and smoke

### 7.1 Search radar

**What it sees.**
- **Who:** air candidates (`candidates(v, 'air')`: AI bandits, drones, enemy aircraft ghosts) within `searchRadar.range`.
- **Line of sight:** the existing `clearLine` (`combat.js:730-737`). Its 4 m margin and 150 m sampling suit air targets, and it stays unchanged for the frigate.
- **Clutter:** a target below 40 m above the ground and slower than 40 m/s along the beam is lost (the notch rule in `radarSees`).
- **Rate:** 2 Hz, at most 10 targets.

**The scope.** A round display (§9) with a sweep line. Blips refresh as the sweep passes and fade over one turn.

**As an emitter.** A vehicle carrying a search or tracking radar that isn't broken is a candidate for **radar** seekers. `candidates(…, 'radar')` adds such enemy ghosts and local AI, so an anti-radar missile can kill a careless Gepardo (combined arms).

### 7.2 Tracking radar, lead and aim assist

**Locking.** L (or LOCK on touch, shown only with a tracking radar) locks the air candidate nearest the crosshair within `cone` and 8 km, after 0.8 s (×2 against an ECM jammer).
- **Holding:** the lock holds while the target stays in line of sight and range and isn't notched.
- **Breaking:** chaff can break it (`chaffBreaks`, `combat.js:442`), and so can 1 s notched or 0.5 s blocked.
- **The dish** follows the target through its own yaw and pitch.

**Warning the target.** While locked, `Aim.lockPid()` returns the target's pid. `Combat.frame`'s lock line (`combat.js:1171-1173`) becomes `lk = (S.lock && S.lock.remote && S.lockR ? S.lock.remote : 0) || (v.aimed && v.aimed.length ? Aim.lockPid() : 0)`. The existing `MP.sendLock` lights the pilot's RWR, and the advanced RWR points at the SPAA, with no protocol change.

**Lead.**
- **With a lock:** the AA guns' wanted point is the intercept, `T + V·t(D)` iterated twice, with t from §5.6. The HUD draws a lead diamond.
- **Without a tracking radar:** the existing LEAD marker logic (`combat.js:1264-1267`) runs for the nearest air target within 2 km, using the aimed gun's shell speed.

**Aim assist.** Default on for touch, off for mouse; a Settings toggle. When the crosshair is within 4° of the lead point, the aim eases onto it at 8°/s. It never forces the aim.

### 7.3 Proximity-fuzed AA

`hevt` shells (§6.1) burst through `explode` beside aircraft. Against ghosts the damage goes through `sendHits 'blast'`.

### 7.4 Ground-launched missiles

**Launch.** `launchMissile` (`combat.js:277-289`) gains, for parts with `def.aim`:
- direction `Aim.dir(v, p)` and position `Aim.muzzle(v, p)`;
- `vx += dir·w.boost`;
- (critic: one consistent pair of fields) `s.coast = 0.05` (motor start) and `s.gt = 0.2` (guidance start) for every aimed launcher; the def's `weapon.coast: 0` only marks it as a hot launch.

`moveShot`'s missile timing uses `const tm = s.coast ?? 0.35, tg = s.gt ?? 0.35` in place of the 0.35 literals: the motor window `tm … tm + burn` (`combat.js:529`), guidance from `tg` (`:530`), and (critic) `guideAir`'s "too slow to steer" test `s.t > tm + s.burn` (`:776`), the third 0.35 the spec had missed. Old missiles get 0.35 everywhere and behave identically. **Fixed:** the critic's runway nose-dive.

**IR SAM.** The existing `guideAir`: PN, gimbal, decoys; flares work. The lock cone axis is `Aim.aimDir(v)` for aimed launchers (`playerFrame`, `combat.js:409`): `fwd = cur.def.aim ? Aim.aimDir(v) : noseDir(v)`.

**Command SAM (`seek 'clos'`).** `Aim.guideClos`. Each step the missile steers toward the point on the launcher-to-target radar line 200 m beyond its own range, gain 3, limited by `turn·g`. A broken lock for more than 1 s means it flies straight. `msl` messages carry `radar: true`, so RWRs and MSL markers treat it as a radar SAM.

**SARH (samLong).** `guideAir` with `radar: true`. The SARH check becomes `s.gr ? Aim.radarSees(s.launcher, t, tp, s) : <old>` (`combat.js:770`), which asks whether the vehicle's tracking radar holds `t` all round, with clutter.

**Replication.** All go out through `MP.sendMissile` (`mp.js:887-916`), so targets see replicas and their RWRs work. (critic) `sendMissile` writes `agm: w.seek === 'ground'` (`mp.js:892`). It becomes `agm` for any ground seeker ('ground', 'saclos', 'top'), with `tg: 0` for 'saclos' and 'top'. Otherwise an ATGM arrives as a heat seeker aimed at its victim and lights the victim's RWR, against §7.5's rule.

### 7.5 ATGMs

**SACLOS (`seek 'saclos'`).** `guide()` gets a first line, `if (s.saclos) return Aim.guideSaclos(s, h, spd)`.
- The missile steers toward the shooter's current aim ray, at the point `o + dir·(|M − o| + 150 m)`.
  - The player's ray is `F.aim`; the AI's is its own aim. (critic) Outside aim mode (a helicopter's or plane's launcher, §5.4), it is the launching craft's nose ray.
  - It turns at up to `turn·g/v`.
- **Wire cut:** if the shooter is knocked out or the launcher is broken, it flies straight.
- **Smoke:** if smoke lies on the shooter-to-missile line, it holds its last steering.
- **HUD:** "GUIDING 4.2 s".

**Top attack (`seek 'top'`).** `if (s.top) return Aim.guideTop(s, h, spd)`.
- **Lock:** an IR lock on a ground vehicle within 3° of the crosshair, after 1.5 s. Candidates are enemy ground ghosts and local AI ground vehicles; wrecks are cold.
- **Flight:** it climbs to 150 m above the line, then dives inside 400 m horizontally onto the roof face.

**Warning.** Targets get no lock warning (no laser warner). The existing red MSL markers (in sight, under 4 km) show every hostile replica.

### 7.6 Rocket artillery

- **Direct fire:** with the crosshair on ground within the range table, the launcher elevates for that range. FIRE ripples at the def's `rate`, with spread `weapon.spread`.
- **Indirect fire:** in the tactical map (§9), tap a point with an MLRS selected. It becomes `F.aim.P` with `indirect: true`, and the HUD says "Strike: 4.2 km · 19 s".
- Rockets use the existing `k: 'rocket'` path and `sendShot`, carrying `s.he`. (critic) `moveShot`'s `explode` calls for rockets and missiles (`combat.js:524, 573, 577, 584, 602`) pass `s.he` and `s.t < 0.6 ? s.spare : undefined`. Both are undefined on old shots, so the calls are identical; without them an MLRS ripple bursting short would hurt its own launcher (hook 27).

### 7.7 Smoke

**Firing.** K or SMOKE fires one salvo:
- every `smoke` part throws `salvo` grenades;
- they spread across an 80° arc centred on the primary turret's facing (else the hull's), landing 25–35 m out.

**Clouds.** Each cloud is an `S.smoke` entry, `{ x, y, z, b, r: 2 → 9 m over 3 s, life 25 }`.
- `S.smoke` is a **new list**, cleared in `Combat.reset` and stepped without gravity.
- `S.flares`, which `decoyed` reads and which applies gravity (`combat.js:501-502`), is untouched.

**What smoke blocks** (segment versus sphere):
- spotting (§10.6);
- AI target acquisition;
- SACLOS updates;
- IR lock acquisition (SAM and top-attack);
- the tracking radar's first lock.

A thermal sight still marks enemies through it.

**Visuals.** 4 large FX smoke particles per cloud (size 10–14 m, life 6 s), re-emitted once a second, so about 36 live particles for a full salvo. That is within the 350 FX budget on low, and 2D and 3D both draw FX.

**Replication.** `cm { smoke: 1, P, D }`; `netFlares` builds the same clouds.

### 7.8 Combined arms

| Threat | Counter |
|---|---|
| Plane with AGMs, bombs, rockets, 30 mm | SPAA with radar lead and HE-VT; IR, command and SARH SAMs. AAMs can't lock moving ground vehicles (`isGround` rule). |
| SPAA radar lock | RWR warns; chaff; notch low; anti-radar missiles home on the radar |
| Helicopter with missiles | proximity AA, IR SAM (flares), autocannons |
| Tank | tank guns, ATGMs, top attack, rocket artillery, bombs, aircraft cannon from above |
| ATGM in flight | smoke breaks SACLOS; kill the shooter (wire cut) |

---

## 8. Controls and camera

### 8.1 Aim mode

`Flight.groundAim` is set in `Flight.update` when all of these hold:
- `App.use3D()`;
- not mapping and not destroyed;
- `isGround(v.kind)`;
- `v.aimed.length > 0`.

It toggles `body.ground` (§9). In the 2D view (no WebGL, or `retro2d`), driving works, guns hold their last aim, and one toast says "Ground combat needs the 3D view". Every other craft is exactly as today.

**(critic) Two flags, not one.**
- `body.ground` (the HUD layout of §9.4) is on for **any** ground vehicle with new running gear or new parts: `isGround(kind) && (v.gear.length || v.gv)`. An unarmed Armour design then doesn't get the rocket autopilot bar, the throttle and the roll buttons.
- `Flight.groundAim` (the aim camera, `GROUND_KEYS`, firing) additionally needs `v.aimed.length > 0` and the 3D view.

**(critic) The 2D fallback is a side cut at z = 0** (`world.js:691-699`): a vehicle at z ≈ 15 km is drawn about 357 m under the ground line, so nothing is visible on Highland Ridge. Without 3D, a solo Armour launch goes to the runway (§11.1). A ground battle shows "Ground battles need the 3D view" on a 2D-only client.

### 8.2 The aim camera (render3d.js:2412-2435, one guarded branch)

**Aim state.** `Flight.aimYaw` and `Flight.aimPitch` are in the **local surface frame**, so turning the hull never swings the aim:
- `dir = east·cos p·cos y + south·cos p·sin y + up·sin p` (`surfaceFrame`, `util.js:57-63`);
- pitch is clamped to −0.35..+1.35 rad, or (critic) up to the highest `aim.el[1]` on board, capped at 1.5 rad, so an SPAA with +85° guns (1.48 rad) can aim nearly straight up;
- at launch the aim starts along the hull's heading.

**The camera, when `F.aimCam`:**
- `followCam` is skipped.
- `pivot = ring top centre (else hull top) + up·1.4 m`.
- `dist = clamp((H/2)/F.scale/TANH, 7, 30)` (the existing zoom relation).
- `camera = pivot − dir·dist + up·1.0`, kept 2 m above the ground (the existing clamp); then `camera.lookAt(camera + dir)`.
- The crosshair is the screen centre; the vehicle sits below it. In portrait the tall view leaves sky above and room for the thumbs below.

**`Render3D.aimRay(out)`** returns `{o, d}` in body-relative sim coordinates (`camAbs − bodyPos + toSim(camera.position)`).

**The aim point.** `GHUD.aimUpdate(F)` runs at 20 Hz (every 50 ms of wall time):
1. Sphere test along the ray against vessels and wrecks within 3 km, then `Armour.hitFirst` on the first candidate.
   - (critic) Against vessels **as drawn**: a reseated vessel (§13) is tested with the ray shifted by its −Δ. P is then the physics hit point, so the crosshair on the drawn hull and the shell on the physics hull agree.
2. Ground march at 25 m steps against `Render3D.drawnGround` (critic: `meshHeight` plus `Terrain.bermAt`, the ground the player sees; about 0.3 µs a sample, 120 samples).
3. Six bisection steps with `Terrain.surfaceAt`.

The result is `F.aim = { o, dir, P, d, src: 'vessel' | 'ground' | 'none', indirect: false }`; with no hit, P is 1,500 m out. Between updates, P = o + dir·d along the new ray, so the crosshair never lags. Cost: about 0.2 ms per update. Headless tests set `F.aim` directly.

### 8.3 Gunner sight and the TANH refactor (graft from build: the simplest refactor)

**The camera.**
- It sits at `Aim.sightPoint(v)` and looks along `dir`, not along the barrel; the gun reticle shows the barrel.
- `fov = 50/zoom`. Zoom is 3 or 6 on touch (6 is the cap there, because far terrain cells are coarse) and 3/6/8 on desktop, from the wheel or a pinch.
- The vessel's own mesh is hidden while sighting. Near plane 0.05 (log depth is fine).

**TANH.** `render3d.js:8` becomes `let FOV = 50, TANH = …`, with `setFov(deg)` updating `camera.fov`, `TANH` and `updateProjectionMatrix()`. Every use (`:2416, 2517, 2537, 2791, 2966, 3014, 3262, 3330, 3388, 3401, 3413`) reads the identifier, so `project()`, `metresPerPixelAt`, glow sizes, planet pixel size and pixel culling stay right with no call-site edits.
- `Render3D.setSight(on, zoom)` calls `setFov(on ? 50/zoom : 50)`.
- The sight closes (back to 50°) on map, on stop and on destruction, so the hangar and globe (`globe.js:78, 96` keep their own 50°) never see another FOV.

**`body.sighting`** hides the telemetry, the damage diagram and `#hint`, and adds one static CSS vignette (no blur).

### 8.4 Desktop

`GROUND_KEYS` are gated like `PLANE_SAS_KEYS` (`flight.js:986-987`), only while `Flight.groundAim`.

| Action | Keys and mouse | Today (unchanged elsewhere) |
|---|---|---|
| Drive / reverse | W / S (↑ / ↓) | same |
| Turn (skid steer; reverse turns like a car's tail) | A / D (← / →) | same |
| Brake | hold B | same |
| Aim | mouse. Click the view to capture it. Without capture, drag. | — |
| Traverse aim (keyboard) | Q / E at 60°/s (`ctl.r` is unused on gear vessels) | roll/yaw |
| Fire selected weapon | left click (captured) or hold V | V |
| Machine guns | hold Space | Stage (the Stage button still works) |
| Gunner sight | hold right mouse, or Shift toggles (only when the vehicle has no thrust parts; else Shift stays throttle) | throttle |
| Zoom (sight or camera) | wheel | zoom |
| Shell (twice: reload now) | 1–4 | autopilot |
| Weapon system | Tab / Shift+Tab | same |
| Smoke (and flares/chaff) | K | countermeasures |
| Radar lock | L | catapult (planes only) |
| Spot the enemy under the crosshair | J | — |
| Tactical map / artillery target | M | map |
| Free look (turret holds) / aim straight ahead | hold C / tap C (< 0.25 s) | camera reset |
| Set the sight's zero (Realistic, with a rangefinder) (critic) | Y | — (R stays Recover: `flight.js:1000` would end a solo flight) |
| Menu | Esc (releases the mouse and opens the menu) / P | menu |

**Pointer lock.**
- **Starting it:** the first primary-button `pointerdown` on `#view` in aim mode calls `requestPointerLock()`. That click doesn't fire.
- **While locked:**
  - `movementX/Y` aim at 0.0022 rad/px (÷ zoom in the sight; × the Settings sensitivity);
  - `tapAt` is **skipped**, so a fire click never toggles a part at a stale clientX/Y (flight map risk);
  - left button sets `Flight.mouseFire`, which is OR'd into `firing`; the right button holds the sight.
  - (critic) A second button pressed while one is held arrives as a `pointermove` with a new `e.buttons`, not as a `pointerdown` (chorded buttons, one mouse pointer). Read `e.buttons` (bit 1 left, bit 2 right) in both `pointerdown` and `pointermove`, and clear both on `pointerup` and `lostpointercapture`.
  - (critic) Under pointer lock `clientX/Y` stop changing, so the existing `pointermove` deltas (`flight.js:1028`) are zero. Aim reads `e.movementX/Y` instead.
  - (critic) The game releases the lock itself (`document.exitPointerLock()`) whenever a modal opens or the map shows, and marks that release as its own, so it doesn't reopen the menu.
- **Esc:** a `pointerlockchange` to unlocked that the game didn't cause opens the menu (`openMenu`), so one Esc gives both.
- **Other changes:** canvas `pointerdown` gains an `e.button` filter only in aim mode, so the right-drag orbit is unchanged elsewhere. Window blur also clears `mouseFire` and the sight hold.
- **iOS** has no pointer lock; drag aiming always works.

### 8.5 Arcade and Realistic aim (graft from wt)

| | Arcade (default) | Realistic (lobby `aim`, Settings `aimMode` solo) |
|---|---|---|
| Elevation | the lift for the measured aim range (`F.aim.d`) | the lift for the sight's zero range `F.zero` (default 800 m; wheel or pinch on the range ladder in 100 m steps, 200–3,000) |
| Range readout | measured range | "Sight 800 m". With a Laser Rangefinder part, "Range 1,240 m" is exact, and a tap on RANGE or the Y key (critic: not R, which is Recover) sets the zero. With a living commander, a ±4% reading after 3 s. |
| Sight | crosshair | stadia marks for the loaded shell (100 m ticks from the range table) |

### 8.6 Touch (phone first)

- **Drive:** the existing stick (`#joy`). Up drives; sideways turns, or pivots at a standstill. Released, the vehicle coasts, then holds on its parking brake. The Brake button stays.
- **Aim:** a one-finger drag anywhere on the view. In aim mode the existing orbit path (`flight.js:1036`) calls `Flight.aimBy(dx, dy)` at 0.006 rad/px ÷ zoom. **And sliding on FIRE:** FIRE's `pointermove` (with pointer capture) passes movement to `Flight.aimBy` while held, so one thumb aims and fires (graft from phone).
- **Pinch** zooms the camera, or the sight.
- **Buttons:**
  - **SIGHT** (binoculars) toggles the sight.
  - **Ammo stack:** 2–4 chips ("APHE", "HE"; critic: the types share one pool, so the count shows once, on the weapon chip, §6.6). Tap picks the next round; a long press (500 ms) unloads and reloads with it now.
  - **MG** appears with a machine gun while the main gun is selected; hold to fire.
  - The existing CM button is relabelled **SMOKE** for ground vehicles. (critic) `#btn-cm` shows today only when flares or chaff are left (`flight.js:1424`), and `Combat.status` returns null for a vehicle whose only weapons are smoke launchers (they leave `systems()` through hook 22). So `status` gains `smoke` (rounds left), counted in its no-system branch, and the button's test becomes `flares || chaff || smoke`.
  - **LOCK** appears only with a tracking radar.
  - The **weapon chip** cycles systems when there are two or more besides the MG.
- **Spotting:** a long press (600 ms) on an enemy tag spots it for the team.
- **Taps on the view** do not use parts in aim mode; they are aims. A tap on another of your own vessels still switches to it.
- **Haptics:** 10 ms on FIRE (exists), 20 ms on a main-gun shot, 35 ms on being penetrated, 8 ms when a reload finishes.

### 8.7 The three control lists, in the same commit

- **README Controls table** (`README.md:39-58`): a block "Armour and armed cars" with the rows above. "cars: steer" becomes "cars and Armour: steer (tracks turn on the spot)".
- **`App.showHelp`** (`main.js:312-330`): a new item, "Armour (tanks, SPAA, launchers)".
- **`Flight.controlsHelp`** (`flight.js:481-501`): the ground list when `groundAim`. It is also the pause and multiplayer menu body.
- **Also:**
  - the launch tip (`main.js:281`): "Drive with W/S, turn with A/D, aim with the mouse";
  - touch-aware vehicle hints (`flight.js:1243-1275`): "Left thumb drives. Drag the view, or slide on FIRE, to aim.";
  - the stage-next text (`flight.js:1420`);
  - the multiplayer help line (`flight.js:499`).

---

## 9. The ground-combat HUD

### 9.1 Canvas, every frame

`GHUD.draw(ctx, W, H, dpr, F)` lives in `js/ghud.js`. It is called from `main.js:101` after `Combat.drawHUD`, only when `Flight.groundAim`, on the 3D path.

| Element | What | ~ops/frame |
|---|---|---|
| Crosshair | centre; 4 short ticks and a dot | 6 |
| Gun reticle | circle where the selected gun's shell lands at the aim range, from `Aim.dir` and the drop, projected. Green when converged within 0.3°, red X outside the limits. | 4 |
| Reload ring | arc around the gun reticle, and around FIRE's measured rect | 6 |
| Rangefinder | "740 m" under the crosshair (Realistic: §8.5) | 2 |
| Hit banner and marker | §6.8, while live | 4 |
| Damage edge arcs | while live | 3 |
| Lead diamond, lock box, GUIDING, strike ring | SPAA, SAMs, ATGMs, MLRS | 6 |
| Zone badges | letter in a circle, owner colour, progress arc, distance; on screen only | 3 × 8 |
| Enemy spotting diamonds | MPUI.drawHUD, made ground-aware (§10.6) | 5 × 5 |
| Damage diagram | blitted from a cached offscreen canvas (below) | 1 |
| Sight overlay | stadia and zoom, in the sight only | 10 |

That is under about 100 ops a frame, against 133 for a paused flight's overlay before PR #35.

**(critic) The old pipper and LEAD marker.** `Combat.drawHUD` draws them for any `gun` or `rocket` system, 600 m along the hull's nose (`combat.js:1251-1267`). An MLRS is a `rocket` system, so it would get a false reticle, and a `tgun` has no `w.speed`. The block is skipped while `Flight.groundAim`, because GHUD draws the gun reticle and its own lead diamond with the shell's solve (§5.6). On other kinds (a 37 mm gun on a plane, §5.4), an aimed weapon's pipper uses its first shell's v0 in place of `w.speed` (hook 39).

**Damage diagram** (graft from wt; it replaces phone's separate turret indicator):
- A **top view** of the vehicle from the parts' x/z rectangles.
- The turret is drawn turned by ψ, with a thin camera wedge.
- Crew pips: dark when dead. Module icons in amber (damaged), red (broken) or flickering (fire). Repair timers.
- It is rendered to an offscreen canvas (120×72 CSS px × dpr) only when its state signature changes (module states, ψ rounded to 2°, aim yaw rounded to 5°), then blitted.

### 9.2 Own canvases, a few times a second

**Minimap** (`#gmap`, a direct child of `#flight-ui`, 112 px, DPR-scaled backing store).
- **Contents:** the arena boundary, zones with owners, teammates, spotted enemies (red, fading 3 s after last seen), our heading cone, strike marks; for SPAA, radar blips and the sweep.
- **Redraws:** at most 4 Hz, **and only when its content signature changed** (fixed). Under about 150 ops per redraw.
- **Outside battles:** in sandbox and solo it shows vessels within 1.5 km.

**Tactical map.** M, or a tap on the minimap, opens a full-screen overlay canvas, drawn only while it is open.
- **Terrain:** a hillshade of the arena baked once per session from `Terrain.heightAt` on a 40 m grid (about 65×75 samples). It is baked in idle chunks of 500 samples a frame on first open, about 0.2 s of CPU in total on desktop and 0.7 s on a phone, spread out.
- **Taps:** with an MLRS selected a tap sets a strike; otherwise it sends a team ping (`seen` with a point, at most once a second).

### 9.3 DOM (updateHUD, every 0.08 s, `set()` only on change)

- **Ammo chips:** text and `aria-pressed`.
- **SIGHT, MG, SMOKE, LOCK:** the `hidden` attribute.
- **The MP bar** gains a ground info line, "▲A ■B ▼C · 512 – 498 · 12:34", with spans coloured by owner and created once.
- **"Capturing B 45%":** a slim bar under the MP bar, moved by `transform: scaleX`.
- **Telemetry for ground vehicles:** Speed with gear ("34 km/h ▲", ▼ in reverse), Heading and Crew (n/N). `body.ground` hides Altitude, Ground, Vertical, Mach, AoA, G and the orbit rows.
- (critic) **Brake and SMOKE visibility:** `#btn-brake` also shows for `v.gear.length`; `#btn-cm` (SMOKE) also shows for `ws.smoke > 0` (§8.6).
- (critic) **The room's 8 km radar scope** (`MPUI.drawRadar`, ≥ 761 px) is skipped in ground games: the minimap replaces it, with ground spotting rules. Otherwise it would show every enemy within 6 km, hills or not.
- **Blur:** every new class (`.ammo-chip`, `.gmap`, `.round.sight`, `.ammo-stack`) joins the no-blur list (`style.css:257-264`).

### 9.4 Hidden for ground vehicles (`body.ground`)

- the throttle box (unless the vehicle has thrust parts);
- the autopilot bar;
- the roll buttons;
- the flaps and gear pills;
- the catapult;
- the stage box (unless stages remain: then a compact 48 px Stage pill).

Today's heavy right column disappears, and that is where the new ground controls go.

### 9.5 Layouts: who measures what

`GHUD.place(W, H)` measures `.telemetry`, `.left-controls`, `#weapon-box`, `#mp-bar`, `.flight-top-right` and the RWR box (`S.rwrBox`) once a second, as `rwrPlace` does (`combat.js:1389-1411`). It places the canvas elements by trying candidate spots in order. The DOM controls are pure CSS in a new section at the end of `style.css`, with its own `max-width: 760px` and `max-height: 500px` blocks.

| | Portrait 390×844 | Portrait 375×667 | Landscape 844×390 | Desktop 1280×720 |
|---|---|---|---|---|
| Drive stick | bottom-left, 104 px (existing) | 96 | 92 | 116 |
| FIRE + reload ring | 84 px, right 18, bottom 26 | 76, right 14, bottom 18 | 72, right 16, bottom 14 | 58 (`pointer: fine`), right 24, bottom 24 |
| SIGHT | 56, right 114, bottom 40 | 52, right 100, bottom 30 | 48, left of FIRE | 48, left of FIRE |
| MG | 52, right 114, bottom 108 | 48, right 100, bottom 90 | above SIGHT | above SIGHT |
| Ammo stack | vertical above FIRE, 56×40 at bottom 124/170/216 | 52×36 at 108/150/192 | horizontal row left of SIGHT, 50×34 | vertical with key hints "1 APHE" |
| SMOKE / LOCK | 46 at right 180, bottom 40 / 108 | 42 at right 160, bottom 30 / 86 | above FIRE | above FIRE |
| Weapon chip | above the ammo stack | above the ammo stack | left of the chips | above the stack |
| Telemetry | compact 150×58, top-left | compact 140×54 | 150×40 | existing panel, compact rows |
| Damage diagram | under telemetry (10, 76), 120×72 | 104×62 | right of telemetry | under telemetry |
| Minimap | top-right under the MP bar, 112 px | 96 | top-right under buttons, 96 | 160 |
| Radar scope (SPAA) | `rwrPlace`-style slot under telemetry, R 40 | R 36 | right of telemetry, R 40 | R 46 |
| Crosshair | centre (195, 422) | (187, 333) | (422, 195) | centre |

The right thumb rests on FIRE (about x 330, y 760 in portrait). SIGHT, MG and the chips sit within a 120 px arc of it, and the left thumb has the stick alone. `test/browser/ground-hud.mjs` asserts no overlaps between these, `.telemetry`, `.left-controls`, `#mp-bar` and the RWR on all four sizes plus the in-room case, the way `rwr-hud.mjs` does.

**(critic) Two more things the minimap and the test must clear.**
- **`#hint`.** In portrait it sits top-right at 104 px (140 px in a room), up to 200 px wide (`style.css:525, 912`), exactly where the minimap goes. Under `body.ground` in portrait, `.hint` moves below the minimap: `top: var(--gmap-b)`, a custom property that `GHUD.place` writes when the minimap's bottom changes (rarely, so no per-frame DOM write). Landscape (top centre) and desktop (bottom centre) don't collide.
- **The rects the test reads.** Add `.flight-top-right`, `#hint`, `#mp-feed` (the kill feed) and **`#btn-brake`**. In portrait the Brake button is absolutely positioned above the stick (`left: 146px; bottom: calc(100% + 18px)`, `style.css:564-567`), outside `.left-controls`' bounding rect. At 375×667 it sits about 2 px from the LOCK slot in the table above, so the test decides the final numbers.

---

## 10. Multiplayer: Ground Battle

### 10.1 Mode and settings

The ground game lives **inside `state.mode = 'pvp'`** as `settings.game = 'ground'`. That keeps every `mode === 'pvp'` guard (Silly off, room lock, one craft at a time) and avoids touching 30-odd checks (`mp.md`).

**(critic) Creating it.** `MP.host(mode, transport)` takes the transport second (`mp.js:82`). So the new button calls `MP.host('pvp', transport, { game: 'ground' })`, with a third, optional `settings` argument merged over `MP_DEFAULTS`. Old calls are unchanged.

**New defaults.** `MP_DEFAULTS` gains `game: 'air', tickets: 600, respawn: 'free', air: false, aim: 'arcade', arena: 'highland'`. An air battle is therefore byte-identical: every existing branch checks `game === 'air'` first. `setSetting` (`mp.js:246-256`) now validates every key against an allow-list (today it stores values unchecked).

**The lobby** (`renderSettings`, `mpui.js:190-230`) gains a first segment, **Game: Air · Ground**. For Ground it shows:

| Setting | Values |
|---|---|
| Format | 1v1 · 2v2 · 3v3 (FFA hidden) |
| Money (per vehicle) | $45k (WWII) · $75k (Cold War) · $120k (Modern) |
| Tickets | 400 · 600 · 900 |
| Respawns | Free · Lineup of 3 |
| Air support | Off · On |
| Aim | Arcade · Realistic |
| Build time, Test drive, Time of day, Time limit (10/15/25), Friendly fire | as today |

**Arena.**
- Shown, not chosen: **Highland Ridge** when the host's `Terrain.earthMap.state === 'ready'`, else **Runway** ("The real map didn't load: the battle is on the runway").
- A client whose own map state differs gets a toast: "Your map didn't load: the hills you see differ from the others'".
- Carriers are hidden.

**Creating a battle.** The connect screen gains **Create ground battle** (`#mp-create-ground` → `MP.host('pvp', transport, { game: 'ground' })`; critic: the transport is the second argument).

### 10.2 The arena: Highland Ridge (measured; fixed)

**Data.** `EARTH.arenas.highland` (space.js, beside `EARTH.airfields`) holds the positions below, re-measured with `scratchpad/ground/spec/survey.js`. Line of sight is checked with eye 2.4 m, target 1.6 m, 5 m steps, 0.3 m margin and curvature.

**(critic) What you see is what you hit: the detail is faded in the arena.** The physics ground carries Earth's 40 m and 160 m detail layers (1.2 m and 4 m high). The drawn patch drops them wherever its cells are coarser than 0.6 × their size (`terrain.js:517-520`), and at ground level its cells are 16 m at 20 m, 46 m at 200 m and 118 m at 1 km (span ≈ 37 km, `PW` 2.2; 179 m at 1 km on low). The first survey's "cover" was mostly those invisible metre-high swells. In a tank fight that would mean shells bursting on bumps nobody can see, and enemies vanishing behind open ground.
- **The change:** in `natural()`, `det *= 1 − arenaW(e, z)`, where `arenaW` is 1 inside an arena box and fades to 0 over 200 m (`c.mapped`, Earth only). It is a P1 terrain change (hook 49) and touches nothing outside the box, so no baseline moves.
- **Drawn minus physics,** measured by `scratchpad/ground/critic/drawn.js`, which rebuilds the patch's vertex grid around a focus and compares its bilinear ground with `surfaceAt`:

| From the focus | Today: RMS / max | Detail faded: RMS / max |
|---|---|---|
| 30 m | 0.32–0.35 / 0.7 m | 0.01–0.02 / 0.04 m |
| 100 m | 0.50–0.55 / 1.0 m | 0.02–0.10 / 0.34 m |
| 300 m | 0.50–0.86 / 3.1 m | 0.11–0.49 / 2.1 m |
| 600 m | 1.25–1.61 / 4.1 m | 0.45–0.51 / 1.7 m |
| 1,000 m | 1.68–1.76 / 4.0 m | 0.37–1.31 / 3.4 m |

What is left at range is the bilinear error of the smooth map relief. The reseat (§13) covers it for vehicles, and the berms are drawn by a mesh of their own (§13), since no patch cell can show a 10 m-wide ridge.
- (P1 review) **The table above was measured on a 96 × 96 patch; render3d builds 96 × 56 on high** (`allocSlot`: rows along z coarser). Measured on the real patch by `test/tools/arena-probe.js`, with the fade and the airfield exception below, RMS on high at 30 / 100 / 300 / 600 m: N 0.00 / 0.19 / 0.41 / 1.25, S 0.01 / 0.18 / 0.87 / 0.56, A 0.07 / 0.13 / 0.64 / 1.49, C 0.01 / 0.16 / 0.67 / 1.00, B 0.00 / 0.11 / 0.22 / 0.34 m (without the fade: 1.2–2.5 m at 300–600 m). The probe asserts these with a margin (0.15 / 0.3 / 1.0 / 1.6 m), not 0.6 m: 0.6 m out to 600 m would need rows as fine as columns: a 96 × 96 patch, by the probe's method, gives S 0.50, A 0.49, C 0.26 and B 0.27 at 600 m, and N 1.10 even then (toward Wick, where the fade keeps off the airfield). Decided: the patch stays 96 × 56 (the old picture and its cost unchanged); a square patch inside `clear` arenas is a 3F option, with these numbers, if the reseat isn't enough.
- (P1 review) **Never on an airfield's ground.** Wick's south end (18,350, 13,453) and its 300 m blend reach into the box and its fade. `arenaW` is multiplied by `smoothstep(blend + 3, blend + 203, d)` for each airfield, d the distance from its strip (3 m: the physics lattice's 2 m cells), so the fade is 0 over every strip and blend and comes back over the next 200 m. The ground there is bit for bit as before (`catalogue.test.js`: the whole Scotland strip and blend against 2e9884a, and `arenaW` 0 wherever an airfield's `fieldAt` weight is above 0).
- **The table below is the re-survey with the detail faded** (the pads not yet flattened). The positions are unchanged. The pads still can't see each other or any zone. The hilltop A now overlooks B and C, as a hill should: holding A matters, the War Thunder way. Cover rises from 0.24–0.41 to 0.34–0.50, and the berms add hull-down spots on top of that.

| Item | e (m) | z (m) | Ground | Max slope (±70×40 m) | Role |
|---|---|---|---|---|---|
| N pad (team 0, Faroes) | 17,750 | 13,800 | 25.1 m (23 before the fade) | 2.2° | spawn, yaw −π/2 (faces game south, +z); flattened 160×70 m |
| S pad (team 1, Shetland) | 17,750 | 16,200 | 51.3 m | 2.2° | spawn, yaw +π/2 (faces north); flattened 160×70 m |
| Zone A "Hilltop" | 17,050 | 15,000 | 85.8 m | 4.8° | r 55 |
| Zone C "Slope" | 17,750 | 15,000 | 53.6 m | 6.7° | r 55; the single zone in 1v1 (r 70) |
| Zone B "East" | 18,450 | 15,000 | 56.7 m | 2.8° | r 55 |
| Box (soft border) | 16,400–19,100 | 13,550–16,450 | 15–117 m | 68% under 5°, 27% 5–10° | no water; out of bounds is a warning only |
| Air start, team 0 | 17,750 | 10,800 | — | — | 1,000 m above ground, heading game south, 140 m/s |
| Air start, team 1 | 17,750 | 19,200 | — | — | 1,000 m up, heading north |

**Distances.** N–S is 2,400 m. Each pad is 1,389 m from A and from B, and 1,200 m from C.

**Lines of sight** (re-surveyed, detail faded). False: N↔S, N↔A, N↔C, N↔B, S↔A, S↔C, S↔B, C↔B. **True: A↔C and A↔B** (the hilltop overlooks both). Before the fade all ten were false. **Fixed:** phone's south pad saw zone A.

**Cover.** The share of ground visible at 300–1,200 m is N 0.49, S 0.50, A 0.34, C 0.36, B 0.39 (before the fade: 0.31, 0.41, 0.27, 0.33, 0.24).

**Airfield clearance.** **Fixed** (and see the P1 review note above: the box and fade do overlap Wick's blend, which keeps its ground): the Scotland airfield (`space.js:90`, e 18,900 z 12,500, yaw π/3, half-length 1,100) has its south threshold at (18,350, 13,453). The N pad is 679 m outside the strip, beyond its 300 m blend, and the box starts at z 13,550.

**Pads.**
- `EARTH.groundPads` uses the airfield format `{ e, z, yaw, hl, hw, blend, h, pad: true, c, s }`; `h` is the measured centre height.
- `fieldAt` (`terrain.js:547-559`) loops over them after the airfields, flattening only.
- `render3d` `fieldGround` returns `h` unchanged for `q.f.pad` (no runway paint), and `keepClear` keeps scenery off them.
- No baseline, range target or site is within 10 km (range targets: Faroes and Shetland; traces: pad and runway).

**Berms** (graft from wt), for hull-down play.
- **Number and pairing:** 12 Gaussian ridges, in mirrored pairs about z = 15,000 plus two on the mirror line.
- **Shape:** height 2.4 m, σ 3.5 m across, length 26 m (tapering over the last 6 m), along the given yaw.
- **Where the term goes:** in `height()` after the airfield lerp, only when `c.mapped && c.b === EARTH` and inside the arena box (a bounding-box early-out, so nothing elsewhere pays). Physics and line of sight share it.
- (critic) **Drawing them.** The terrain patch leaves the berm term out: render3d's patch job passes a new sixth argument, `height(c, G, i, j, cont, true)` (`render3d.js:980`). An argument, not a module flag, because the patch job is a generator that interleaves with physics lattice calls. The berms are drawn instead as one merged "earthworks" mesh (all 12, about 1.5k vertices, one draw call), with vertex height = `meshHeight + Terrain.bermAt(e, z)` and the rim tucked 5 cm under the ground. It is rebuilt when the patch swaps (about every 440 m of travel) and placed relative to `F.camAbs` in `localWorld`. `Terrain.bermAt(e, z)` is exported for this, for `Render3D.drawnGround` and for the reseat.
- (critic) **Scenery.** `keepClear` (`render3d.js:1865`) also returns true inside an arena box marked `clear: true` (Highland Ridge only, so the Runway arena keeps the town by the runway exactly as today). So no tree, rock or building is drawn on the battlefield. They are visual only, so behind one an enemy would be hidden from the eye but not from a shell. The cover that is drawn is the cover that counts.

| Pair | e | z (and its mirror) | yaw |
|---|---|---|---|
| 1 | 17,350 | 14,300 / 15,700 | 0 (across the pad-to-A line) |
| 2 | 18,150 | 14,300 / 15,700 | 0 |
| 3 | 17,750 | 14,550 / 15,450 | 0 |
| 4 | 17,000 | 14,780 / 15,220 | π/6 |
| 5 | 18,500 | 14,780 / 15,220 | −π/6 |
| 6 (on the line) | 17,420 and 18,080 | 15,000 | π/2 (cover between zones) |

**The arena probe.** `test/tools/arena-probe.js` (committed) recomputes this table: heights, slopes, water, every pair's line of sight, cover shares, and the berms' slope and dryness. It asserts that berms change no pad-to-pad or pad-to-zone line of sight to "seen". If the probe finds a berm on a slope over 8° or in water, the implementer moves it by up to 60 m along its line and records the new numbers here. (critic) It also prints the drawn-minus-physics table above (the `drawn.js` method), on high and low, and asserts an RMS under 0.6 m out to 600 m on high with the detail faded (low is printed, not asserted: its coarser grid was not measured). (P1 review: its budget is per distance, measured on the real 96 × 56 patch, above; it also checks that the fade is 0 over the airfields.)

**The fallback Runway arena** (`EARTH.arenas.runway`, no map needed):
- pads at e 760 (team 0, facing east) and e 2,640 (team 1, facing west), z 0;
- zones at e 1,250, 1,700 and 2,150, z 0, r 45;
- no air starts beyond the runway's ends; no berms.

### 10.3 Phases and rules (host-authoritative; pure rules in gmode.js)

**Flow.** Unchanged: lobby → build → [test drive, solo on your team's pad] → battle → results.

**Starting.** `setPhase('battle')` sets `s.obj = GroundMode.init(arena, settings, teamSizes)`, which gives `{ arena, tk: [T, T], zones: [{ id, e, z, r, own: −1|0|1, p: −1..1 }] }`.

**The host tick** (`mp.js:355-370`, every 250 ms; dt from `Net.hostNow`, clamped to 1 s):
- **Units:** each flying player's last snapshot (`P.snap`, under 2 s old) plus the host's own `Flight.active`, located with `Terrain.locate` into (e, z).
- **Who may capture:** kind in `GROUND_KINDS`, speed under 30 m/s, and the snapshot's new `gd` (ground contact in the last 0.5 s).
- **Rate:** 1/20 per second for one vehicle, ×1.5 for two, ×1.8 for three or more, ×1.5 more if any capturer reports living troops (§10.4). Both teams inside: frozen. Progress runs −1..1, so a neutral zone takes 20 s and an enemy zone 40 s alone. An empty zone doesn't decay.
- **Bleed:** a team loses `max(0, enemyZones − ownZones)` tickets a second.
- **Feed:** "Shetland took B".

**Deaths.** `recordDown` (`mp.js:678-688`), in a ground game:
- **Tickets:** the victim's team loses `30 + round(cost/2500)` (graft from build: an expensive vehicle costs more), ×1.5 for an aircraft. (critic) The host works out the cost itself: `designCost(mpSpawnRows(spawn))`, `mm` included, when it relays that player's `spawn` (`onSpawn`, `mp.js:696`), and keeps it in `MP.battleCost[pid]`. A client never reports its own price, so `set cost` is gone (§10.4).
- **Alive:** players stay `alive` while their team has tickets (Free) or while they have unused slots (Lineup).
- **Respawn:** `respawnAt = hostNow + 5,000 ms`.
- **Score:** the killer gets +3 score and +1 sortie point.
- **Captures:** +2 score each, +1 sortie point.

**Winning.**
- A team at 0 tickets loses (`finish(winner, 'tickets')`).
- A team with nobody alive and nobody flying loses (`'wiped'`).
- On time, the team with more tickets wins; equal tickets is a draw.
- `checkWin`'s last-team-flying rule stays for air games only (`if (st.game === 'ground') return this.checkGround()`).

**Out of bounds.** A warning only: "Out of the battle area: the zones are behind you", repeated every 5 s while outside.

### 10.4 Messages

| t | Direction | Content | Checks |
|---|---|---|---|
| `obj` | host → all (HOST_ONLY, `net.js:39`) at 2 Hz and on change | `{ tk: [a, b], z: [[own, round(p·100)], …] }` | `m.f === 1`; arrays of finite numbers, clamped; zone count matches |
| `seen` | client → host (`Net.send(m, 1)`) at 1 Hz | `{ ids: [pid…] ≤ 6, man: 0\|1, pt?: [e, z] }` (pt: a map ping) | pids exist and are enemies of the sender; at most 2/s |
| `spot` | host → the sender's teammates (HOST_ONLY) | `{ ids, by, pt? }` | `m.f === 1` |
| `shot` k 'shell' | owner → all | `{ k: 'shell', sh, P, V, b }` | `sh` an own key of SHELLS; vec checks as `netShot` |
| `cm` smoke | owner → all | `{ smoke: 1, P, D }` | vec |
| `hit` | shooter → victim | §6.7 (`k` 'pen' / 'np', optional `m`, `d`) | as today, plus the `m` row checks and (critic) `d`: 3 finite numbers, length 0.1–10 |
| `down` | owner → all | existing, plus `w: 1` (leave a wreck), `x: 1` (detonation, turret toss), `why` ('crew'\|'ammo'\|'parts') | booleans, short enum. (critic) Also `mpNums(m.P, 3)`: `onDown` reads `m.P[0..2]` unchecked today (`mp.js:834`), and the handler is being edited anyway. |
| `set slot` | client → host (`applySet`) | lineup slot 0–2 to spawn next | integer, unused (Lineup), `hostNow ≥ respawnAt − 300`, team tickets > 0 |
| `set troops` | client → host | 0–12 living troops on board | integer |
| ~~`set cost`~~ (critic: removed) | — | the host prices each spawn itself (§10.3) | — |
| `s` (snapshot) | as today, plus `gd: 0\|1` | ground contact within 0.5 s | 0/1 |

**Player rows** gain `caps, score, sorties, respawnAt, slots (bitmask used), troops, cost`, reset in `startMatch` (`mp.js:330`). Clients edit only `slot`, `troops` and `kind` through `applySet` (critic: `cost` is the host's, from the spawn rows). `push()` is used only for rare changes (capture done, ticket milestones every 10%, respawn deadlines, the end), so peers don't rebuild the lobby DOM at 2 Hz (`mpui.js:153`).

### 10.5 Respawns, lineup and combined arms

`onLocalDestroyed`, in a ground game:
1. Sends `down` with `w: 1`.
2. After 5 s, opens the **Respawn** panel, a DOM modal built with `el()` (no peer text in `innerHTML`): "Knocked out by NAME · respawn in 3 s". Big touch-friendly buttons:
   - **Free:** "Your vehicle (TK-34)"; "Change vehicle…" (saved hangar designs of kind tank or car that pass `designProblems`, plus stock ground templates within the budget); with air support on and `sorties > 0`, "Aircraft…" (saved planes and helis and stock aircraft within budget, 60 s after the last sortie ended).
   - **Lineup of 3:** the unused slots. In the build phase the MP bar shows three chips: slot 1 is the design you build; slots 2–3 are picked from saved or stock designs, each checked by `designProblems`. Each slot spawns once (a War Thunder lineup). Aircraft slots need a sortie point.
   - **Spectate.**

**Spawning.** `startFlight(false)` again: it despawns, rebuilds, re-sends the spawn and stays in step with `battleAt`. `respawn()` (`mp.js:556-560`) is allowed when `game === 'ground'` and the host's row says the player can spawn. The one-craft guards in Flight stay.

**(critic) What the respawn path must change in mp.js.**
- **The design.** `startFlight` uses `this.myDesign` when `Builder.mp` is null, as it is after the first spawn (`mp.js:534-537`). The panel's "Change vehicle…", "Aircraft…" and lineup choices set `MP.myDesign` before `startFlight(false)`.
- **The kinds.** `designProblems` refuses any kind outside `MP_KINDS_PVP` (`mp.js:452`), and `kindsFor` returns `['tank', 'car']` for the builder. So an aircraft picked at respawn would fail and be swapped for a stock ground vehicle. In ground games, `designProblems` accepts `kindsFor(settings)` plus `'plane'` and `'heli'` when `settings.air` is on. The builder's kind buttons stay `['tank', 'car']`, so only the respawn panel offers aircraft.
- **The spawn.** `spawnsFor`, `defaultSpawn`, `budgetFor` and `limitsFor` (`mp.js:411-433`) read `MP_SPAWNS`. A `spawnId` left over from an air game (a carrier) would give ×1.3 money and the carrier's limits ("Only planes and helicopters fly from a carrier") to a tank. In ground games `spawnsFor` returns one pseudo-spawn per team, `{ id: 'pad0' | 'pad1', kind: 'pad', team }`. `applySet('spawn')`, `budgetFor` (no bonus) and `limitsFor` (none) then work unchanged, and the spawn map is skipped (the arena is shown in the lobby instead).
- **The placement.** `placement()` dispatches `kind === 'pad'` spawns to `GroundMode.placement`.
- **Respawn too early.** A spawn that arrives before `respawnAt − 300` is still relayed (`Net` relays before MP sees it), but the host doesn't count that player as a unit for capture until `respawnAt`.

**Placement.** `GroundMode.placement(arena, team, slot, kind)`:
- tanks and cars abreast on their team's pad, 22 m apart, facing the zones;
- helicopters 60 m beside the pad;
- planes at the air start, through `opts.place.air = { alt, speed }`. `Flight.start` raises the craft by `alt` above the ground, gives it `speed` along its nose and puts the gear up, after `placeOnSurface`.

**Build phase.** `Builder.mp.kinds = ['tank', 'car']`. Aircraft are picked at respawn, so the builder only ever edits ground designs: simpler on a phone.

**`battleDesign`'s ground fallback** reads `GROUND_STOCK` (critic: in **gmode.js**, not builder.js; `test/lib/game.js` lifts only `TEMPLATES` and `templateRows` out of builder.js by regex, so a const beside them never loads headless and mp.test would throw):
- $45k: `['tk34', 'ms4', 'pumo']`
- $75k: `['tk72', 'leapard1', 'tk34']`
- $120k: `['ma1', 'tk72', 'leapard1']`
- final fallback: `'technical'`, a ground vehicle, never a plane.

(critic) It still **returns the design**, as today: `startFlight` uses it directly, and `mp.test.js:111-115` checks `MP.battleDesign() === MP.myDesign` and looks a fallback up by `bd.name.toLowerCase()`. A stock fallback design gains a `key` field (the template key). The new ground checks look templates up by `bd.key`, and the air checks stay byte for byte as they are.

### 10.6 Ghosts, spotting and wrecks

| What | How | Cost |
|---|---|---|
| Turret yaw | rings join `pv`; eased on the receiver (§5.5) | +1 row per tank at ≤ 5 Hz |
| Gun elevation and own yaw | existing `pv` aimYaw/aimEl | — |
| Track scroll, wheel spin | derived on the receiver from ghost V and W | none |
| Suspension pose | not sent (build pose) | — |
| Main-gun shells | `shot k 'shell'`; `netShot` (`combat.js:823`) gains a first branch, `if (m.k === 'shell') return Armour.netShell(g, m)`: a dmg-0 tracer replica with the right drag that tests vessels for visuals only, plus the ghost gun's flash and recoil | 1 message per shot |
| Autocannons, MGs | `p.gunOn` in `pv`. `netGuns` (`combat.js:506-518`) gains `else if (w.kind === 'agun' && p.gunOn) Aim.netFire(g, p, h, F, foe)`: show rounds along the ghost's aim. | — |
| Ground contact | snapshot `gd` | 4 bytes |

**Wrecks** (every screen, including the owner's own hulk after respawn).
- **Ghost wrecks:** on `down` with `w: 1`, the receiver keeps the ghost in `F.vessels` with `v.wreck = true` and moves it from `P.ghost` to `MP.wrecks`. Its velocity and spin are zeroed, because `flight.js:639` otherwise coasts remote vessels.
- **The owner's own hulk:** `startFlight` passes `opts.keep = [the old vessel, as a wreck]` to `Flight.start`, which keeps it through `resetState`.
- (critic) **Other players' wrecks after our own respawn.** `startFlight` runs `dropAllGhosts` and `resetState` replaces `F.vessels`, while `beforeUpdate` re-adds only `P.ghost` (`mp.js:777-788`). So every wreck would vanish from the respawner's screen. `beforeUpdate` also re-adds each live entry of `MP.wrecks` (same `includes` test), `dropAllGhosts` leaves `MP.wrecks` alone, and `leaveFlight` and `backToLobby` clear it.
- **Behaviour:** wrecks are never stepped (`physicsTick` skips `v.wreck`), never saved, can't be switched to, are solid for shells (sparks, no damage, no hits sent) and for collisions (§4.7), and smoke or burn from their damaged parts.
- **Limits:** capped at 8 (oldest first); smoke only from the 3 nearest; removed after 90 s.
- **Detonation:** `x: 1` plays the turret toss locally on receivers.

**Spotting** (`MPUI.spotted`, `mpui.js:529-539`, ground-aware in ground games). An enemy is tagged when one of these holds:
1. within 250 m;
2. `Aim.sees(myEye, ghost)` within 1.5 km (+25% with a living commander), or 3 km for ground looking at air;
3. a teammate's `spot` named it in the last 3 s;
4. a manual spot (J or long press) within 15 s;
5. it fired a main gun within 2.5 km in the last 3 s (the muzzle flash, graft from safe).

Aircraft spotting aircraft keep today's 6 km rule.

**`Aim.sees(a, b)`** (fixed):
- **Coarse march:** on `Render3D.drawnGround` (critic: the mesh plus the berms, what the player sees) every 20 m, with eye heights from the vessels' bounds and curvature.
- (critic) **Wrecks block it too:** a segment against sphere test with each wreck (radius 0.7 × reach; at most 8 wrecks), so a tank parked behind a burning hulk isn't tagged through it.
- **Confirmation:** wherever the line passes within 3 m of the mesh, `Terrain.surfaceAt` samples (2–5 per crest) with a 0.3 m margin.
- **Memo:** 0.5 s per pair; at most 3 pairs re-checked a frame.
- **Smoke** blocks it; **thermal** sees through.
- **Headless:** `surfaceAt` only.

It decides tags, never hits.

**Every client** sends `seen` with the enemies it sees at 1 Hz. The host relays `spot` to that client's teammates (graft from wt).

### 10.7 Text, scoreboard and results

- **Kind-neutral wording:** "shot down!" becomes "knocked out!" for ground kinds (`mp.js:839`). "Last team flying wins" becomes "Hold the zones: 600 tickets each" for ground (`mp.js:551`). The 'Pilot' column becomes 'Player' everywhere (`mp.js:82`, `mpui.js:195, 456`).
- **Scoreboard for ground:** Player · Team · Kills · Caps · Lost · Score · Ping.
- **Results kicker:** "Shetland win on tickets (212 – 0) · Highland Ridge".

### 10.8 NET_VERSION 7

Its reason, added to the comment (`net.js:11`): "the ground update: the Armour kind and its parts and paints, armour thickness in spawn rows, shells (`shot` k 'shell'), module hits (`hit` m), turret rings in part states, `gd` in snapshots, ground battles (`obj`, `seen`/`spot`, respawns, wrecks on `down`), ground-launched missiles with a boost".

**Sandbox.** Armour and armed cars spawn on Highland Ridge pads, alternating sides, when the client's map is ready, else in the runway slots. Everything else is unchanged, and air battles are untouched.

---

## 11. Single player

### 11.1 Where Armour starts

`App.launch` (`main.js:270-293`) passes `opts.place = GroundMode.placement('highland', 0, 0, 'tank')` for kind `tank` when the map is ready. Otherwise the Armour starts on the runway, with a toast. Cars, the technical included, start on the runway as today.

**(critic) Revert, resume and the 2D view.**
- `Flight.revert` calls `this.start(this.design)` with no options (`flight.js:116`), and `Flight.restore` clears `spawnOpts`, so "Revert to launch" would put a Tank Range tank on the runway.
- One pure helper, `GroundMode.soloPlace(kind)`, decides the place: the N pad for kind `tank` when the map is ready **and** `App.use3D()`, otherwise null (the runway; §8.1, the 2D view can't show z ≈ 15 km).
- `App.launch` and `Flight.revert` both call it (hook 42). Revert passes `{ place }` when it isn't null.

### 11.1b The Practice Battle's own respawn (critic)

`Flight.onDestroyed` (`flight.js:391`) offers "Revert to launch", which rebuilds `F.vessels` and so would wipe the AI. Its first line becomes `if (GroundAI.battle && GroundAI.onDestroyed(this)) return;`, beside the existing `MP.onLocalDestroyed` line (hook 69; `GroundAI.battle` is null for every old flight). `GroundAI.onDestroyed` then:
- shows the same Respawn panel as §10.5;
- restarts the player with `Flight.start(design, { place, keep: [...AI vessels, wrecks] })`;
- sets `Combat.S.gai` again, because `Combat.reset` clears it.

### 11.2 Tank Range (fixed: on Highland Ridge, away from the old range)

`GroundAI` runs the range when all of these hold:
- the active craft is kind `tank`, or a car with aimed weapons;
- it is on Earth with the map ready, within 4 km of the arena centre;
- it is not in a room (`!mpOn()`);
- the `targets` setting isn't 'off'.

| Mode | What |
|---|---|
| Practice (default) | 2 parked AI vehicles (TK-34 side-on at 600 m; MS-4 hull-down at 900 m, near pair 3); 2 patrolling at 4–6 m/s on a 1.2 km loop through zone B (Pumo, Leapard 1); a ZSY-23 parked on hill A. With AA weapons aboard: 2 drones (`makeTarget('drone')`) circling 1.5 km north at 400–600 m. None fire. Knocked-out targets come back 45 s later elsewhere. HUD: "Range: 4 KOs · best shot 1,180 m". |
| Hostile | Waves from the S pad: wave n has min(2 + n, 5) AI vehicles, picked from stock templates within ±40% of the player's design cost; they go for the zones, stop and shoot. With AA weapons aboard, an AI attack plane (a `RAIDER` fighter, `spawnFighter`) every 3 min, so an SPAA has something to shoot. 30 s between waves. |
| Off | an empty range |

**Career.** A new mission, "Tank Range: knock out 3 targets with a ground vehicle", pays $25,000. `drive1k` counts `isGround(kind)`.

### 11.3 Practice Battle (from the multiplayer menu)

A **Practice battle (vs AI)** button runs the Ground Battle rules locally (`GroundMode` is pure):
- you and 2 AI allies against 3 AI enemies;
- tickets 300, the money tier you choose;
- on Highland Ridge (or the Runway arena without the map).

It runs outside any room. While it runs, `Combat.frame` doesn't spawn the old range (`GroundAI.battle` set), and the old range's fighters stay off. This is how the owner can play the whole mode alone on a phone.

(critic) **Where the HUD reads the objective.** The objective lives in `MP.state.obj` in a room and in `GroundAI.battle.obj` in practice. GHUD, the MP bar line and the minimap read it only through `GroundMode.obj()`, which returns whichever is live, or null. **Who owns the button:** 3G adds it to the connect screen (`index.html` mp screens) and calls `GroundAI.startBattle` (a P1 stub until 3H lands).

### 11.4 The AI (kinematic and cheap; real Vessels)

**What they are.** AI vehicles are real Vessels built like `spawnFighter` (`combat.js:996`): `makePart`, `buildAdjacency`, kind `tank`, `rebuildGroups`. They have real parts, so the same armour, modules, renderer and hit model apply.

**Marking.** `v.ai = { ground: true, team, role, skill, state, … }` and `v.kin = true`. The existing exclusions then apply: `flight.js:146` (not saved), `:292` (no switching to it), `:401`, `:1122`, `mp.js:862`.

**Movement.**
- `Flight.update`'s near/far loop and `physicsTick` skip `v.kin`, so they never take a physics step.
- `GroundAI.kinStep` moves them instead:
  - **30 Hz movement:** heading and speed along the surface; height from one `surfaceAt` at the centre; speed limited by the template's power-to-weight on the local slope.
  - **10 Hz attitude:** a plane fit through 3 samples (front, rear-left, rear-right) sets `q`.
  - It avoids other vehicles (circle test) and wrecks.

**Decisions** (4 Hz):
- Pick a target by distance, team and `Aim.sees` (memoised 0.5 s).
- Move to the nearest zone not held, or to a firing spot behind cover (the nearest berm).
- Stop to shoot within 1.2 km.
- Aim through `Aim.step` with the AI's want, a skill error of 0.5–1.5 mrad, and a 0.6–1.2 s reaction. Fire when the gun is within 0.4° and loaded: AP against plated targets, HE against open tops.
- Retreat below 40% crew. Avoid slopes over 22° and water (sample 25 m ahead every 0.5 s). Reverse and turn when stuck for 3 s.

**Cost.** About 60 surface queries a second per AI, so a six-AI battle costs under 5% of a phone core.

**Smoke** blocks their sight.

**Guards on every existing `.ai` reader** (each is a no-op today):

| Site | Guard |
|---|---|
| `combat.js:68` destroyPart → aiDown | aiDown's text: `v.ai.ground ? 'Enemy TK-34 knocked out!' : 'Bandit shot down!'`; `GroundAI.down(v)` for respawn |
| `combat.js:457` air candidates | `&& !o.ai.ground` |
| `combat.js:490` AI fixed guns | ground AI never sets `aiFire` (it fires through Aim) |
| `combat.js:1143` fighter cap | `&& !o.ai.ground` |
| `combat.js:1148-1151` fighter loop | `if (o.ai.ground) continue;` (GroundAI owns their lifetime; practice mode no longer kills them) |
| `combat.js:1194` clearTargets | kills ground AI too (fine: GroundAI restarts them on the next frame when wanted) |
| `combat.js:1232` Bandit diamonds | `\|\| o.ai.ground` skip (they get ground brackets from GHUD spotting) |
| `combat.js:462` ground candidates | add local `o.ai && o.ai.ground && o.control && !o.dead` |

### 11.5 Hostile mode, decided explicitly

- **Kind `tank`:** counts as "flying" for AA guns, SAM sites, the frigate and fighter spawns only when airborne for more than 1 s **and** more than 15 m above the ground (`flyingFor(v)`). Those defences are anti-air; the ground AI is the threat instead.
- **Kind `car`:** keeps today's behaviour exactly, including the quirk that moving cars draw AA fire (the critic measured it; nothing pins it). It is documented in the handbook's loose ends as deliberate, under the old-designs rule.

---

## 12. Stock templates

The rules for all sixteen:
- **Kinds and filing:** fifteen are kind `tank` (hangar "Ground forces"); the Desert Technical is kind `car` (hangar "Cars"). None sets `military: true`.
- **Rows:** built with `att` rows like the jets. The implementer fixes exact coordinates under the core test: no clash, fully joined, a control part, ring not jammed, drives at least 10 km/h on the runway.
- **Price** is the sum of the part costs in §3.5 (`scratchpad/ground/spec/catalogue.js`). Each template fits the money tier shown.
- **Names** are altered in the owner's style ("as close as real ones but keep the names something different"). The real vehicle appears only in code comments.

| key | Name | Class | Parts | t | hp/t | $ | Fits |
|---|---|---|---|---|---|---|---|
| tk34 | TK-34 | WWII medium tank | hullMedium, 2 trackMed, engDiesel, ringM, turretCast, gun85, 2 mgCoax (coax, bow) | 27.3 | 22.1 | 30,600 | $45k |
| ms4 | MS-4 Shermin | WWII medium tank | hullMedium, 2 trackMed, engPetrol, ringM, turretCast, gun75 (stab 1), mgCoax, mgHeavy | 26.1 | 13.4 | 27,800 | $45k |
| tygr | Tygr I | WWII heavy tank | hullHeavy, 2 trackHeavy, engDiesel, ringL, turretBox, gun88, mgCoax, 2 smokeL | 50.5 | 11.9 | 40,000 | $45k |
| pumo | Pumo 8×8 | armoured car | hullWheeled, 8 wheelArmS, engPetrol, ringS, turretSmall, gun50, mgCoax | 12.3 | 28.3 | 18,800 | $45k |
| stuq3 | StuQ III | casemate tank destroyer | hullCasemate, 2 trackMed, engPetrol, gun76L (casemate ±12°), 2 skirts | 30.6 | 11.4 | 23,900 | $45k |
| ms18 | MS-18 Hellion | open-top tank destroyer | hullLight, 2 trackLight, engPetrol, ringM, turretOpen, gun76L, mgHeavy | 12.0 | 29.2 | 20,100 | $45k |
| leapard1 | Leapard 1 | Cold War MBT | hullMedium, 2 trackMBT, engDieselL, ringP, turretCast, gun105, mgCoax, 2 smokeL | 33.5 | 30.0 | 43,400 | $45k |
| tk72 | TK-72 | Cold War MBT, autoloader | hullMBT, 2 trackMBT, engDieselL, ringP, turretAuto, gun125, mgCoax, mgHeavy, 8 era, 2 smokeL | 51.7 | 19.5 | 69,600 | $75k |
| ma1 | MA-1 Abrahm | modern MBT | hullMBT, 2 trackMBT, engTurbine, ringP, turretWedge (blow-out bustle), gun120, mgCoax, mgHeavy, 2 smokeL, thermal, lrf, 2 skirts | 56.3 | 26.2 | 79,300 | $120k |
| zsy23 | ZSY-23 Shilko | radar SPAA | hullLight, 2 trackLight, engPetrol, ringM, turretAA, aa23q, radarTrack | 15.3 | 22.9 | 30,100 | $45k |
| gepardo | Gepardo | radar SPAA | hullMedium, 2 trackMBT, engDieselL, ringP, turretAA, 2 ac35, radarSearch, radarTrack, 2 smokeL | 32.1 | 31.3 | 56,600 | $75k |
| bmk2 | BMK-2 | infantry fighting vehicle | hullIFV (troops 6), 2 trackLight, engDiesel, ringS, turretSmall, ac30, atgmTube, mgCoax, 2 smokeL | 16.5 | 36.7 | 32,500 | $45k |
| brdk2 | BRDK-2 Gadfly | ATGM carrier | hullWheeled, 4 wheelArm, engPetrol, ringS, 3 atgmWire | 10.2 | 34.4 | 23,000 | $45k |
| bk21 | BK-21 Grod | rocket artillery | hullWheeled, 6 wheelArm, engPetrol, ringM, mlrsLight | 11.8 | 29.5 | 19,500 | $45k |
| ok8 | OK-8 Hive | radar SAM launcher | hullWheeled, 6 wheelArm, engDiesel, ringP, turretAA, 2 samCmd, radarSearch, radarTrack | 20.4 | 29.7 | 68,500 | $75k |
| technical | Desert Technical | armed car (kind `car`) | chassis, cab, 2 carWheel, mgHeavy (old car driving, new aimed gun) | 1.3 | — | 6,000 | $45k |

**In code comments only** (never player-visible): T-34-85, M4 Sherman, Tiger I, Sd.Kfz. 234/2, StuG III, M18, Leopard 1, T-72B, M1A1, ZSU-23-4, Gepard, BMP-2, BRDM-2 ATGM, BM-21, 9K33 Osa.

**Every class requested is there:**
- tanks across three eras;
- an armoured car and a technical;
- SPAA ×2;
- casemate and turreted tank destroyers;
- an IFV;
- an ATGM carrier;
- rocket artillery;
- a SAM launcher.

The IR SAM rack, the top-attack launcher, the long-range SAM and the 152 mm howitzer are left for players to fit.

**Paint.** Each template uses the new camos: TK-34 Steppe Green; Tygr, Pumo and StuQ Ambush Three-Tone; MA-1, Gepardo and Leapard Woodland Three-Tone; TK-72 Winter Whitewash.

**Blurbs** each teach one mechanism, for example:
- Tygr: "Slow and thick-skinned: angle its hull and few guns will hurt it. Flank it."
- BMK-2: "Six troops in the back capture zones half as fast again. Don't let it take a hit."
- StuQ: "No turret: the hull turns to aim. Ambush from cover."

**Template count:** 35 → 51 (7 rocket, 25 plane, 2 car, 2 heli, 15 Armour).

---

## 13. Rendering and effects

**Models.**
- **Hulls and box or wedge turrets:** extrudes of their outline, the same polygon as the hit prism. The 2D art becomes the texture.
- **Cast and autoloader turrets:** lathes (round in plan).
- **Tracks:** `BUILD.trackUnit`, about 4 meshes per track part.
  - The belt texture is cloned per rig (the `camoMap` precedent, `parts3d.js:1322-1331`; the image is shared, so it uploads once).
  - `offset.x = p.belt / 0.15 mod 1`, disposed in `freeRig`.
  - The belt sub-node shifts by `v.susp` per side (2 transforms; no per-wheel nodes).
- **Guns:** a lathe barrel on a `recoil` role. The new role in `instance()` (`parts3d.js:1494-1498`) slides the barrel back 0.25–0.4 m over 0.08 s and eases it home over 0.6 s from `p.shotAt`.
- **Radars:** the search antenna spins only in flight (`mode === 'flight'`), so the idle hangar still draws nothing (`redraw.mjs`).
- **Inner parts:** hidden in flight (`rig.root.visible = !(d.inner && mode === 'flight')`), shown in X-ray.

**Group transforms and ghost easing:** §5.5.

**Draw calls per vehicle** (fixed: phone's measured stand-in tank was 94; the FS-16 is 58):

| Part | Meshes |
|---|---|
| hull | 2–3 |
| 2 tracks | 8 |
| inner parts | 0 in flight |
| ring | 1 |
| turret | 2–3 |
| gun | 2 |
| MG | 1 |
| smoke | 1 |
| radars | 2 |
| **typical tank** | **20–26 (budget ≤ 30)** |

Small parts (MGs, smoke cups, bricks, sights) set `castShadow = false`. A 6-vehicle scene is ≤ 160 calls on low and ≤ 300 on high.

**Effects.**
- **Main-gun fire:** FX `flash` (size cal/50), `ring` (muzzle blast, 2–4 m), 3 `smoke` puffs, and a ground dust ring when the muzzle is within 3 m of the ground. The hull rocks through `v.applyImpulse(trunnion, −dir, 0.5·kg·v0)` and the suspension (new kinds only).
- **Sound:**
  - `Sound.cannon(cal, dist)` (audio.js) is a one-shot: a lowpass noise burst plus a 60 Hz thump.
  - Other players' and AI main guns play within 1.5 km, attenuated by distance. Today other players' fire is silent, and War Thunder players hunt by sound.
  - The engine loop takes `level = 0.3 + 0.7·v.drivePower/P` for gear vessels (`flight.js:555-558`), so a tank is no longer silent. It reuses the existing loop, so no new audio node runs.
- **Driving dust:** `Flight.groundDust` from each track at speeds over 4 m/s, at a rate proportional to speed, for vessels within 300 m of the camera, high quality only (a third of that on low); not on the paved runway or causeway. (critic) Each `groundDust` call costs 6 terrain lookups (`surfaceSpot`, `normalAt`, `waterAt`, `surfaceAt`, `flight.js:952-956`), so it runs at most 10 times a second per vehicle, accumulating the count as the engine dust does (`e._dust`), never every frame per track.
- **Shell tracers:** `syncCombat` (`render3d.js:3112-3135`) routes `k: 'shell'` explicitly to the tracer line buffer, brighter with a longer head; an unknown kind can't reach `CB.kinds` and throw inside `App.frame`. ATGMs and SAMs reuse the missile pool scaled by `s.small`; MLRS rockets reuse `rocket`.
- **Wrecks:** each rig's own materials go to colour ×0.35, envMap intensity 0.2 (charred). Fire and smoke come from the existing damaged-part loop, through `Armour.partFX` (critic: module-aware, §6.6), capped to the 3 nearest wrecks. The turret toss (§6.6).
- **Capture rings:** a 48-segment line loop per zone seated on `meshHeight`. One draw each, in the owner's colour, with `depthBias` (log depth), placed relative to `F.camAbs` in `localWorld`.
- **(critic) Earthworks:** the 12 berms as one merged mesh (§10.2), one draw call, rebuilt on a patch swap.
- **Far vehicles:** remote, AI and wreck ground vehicles beyond 150 m are visually reseated by `drawnGround − physics height` under their COM (critic: `Render3D.drawnGround(b, a, z) = meshHeight + Terrain.bermAt`, so a tank on a drawn berm sits on it), eased over 0.3 s so a patch swap doesn't pop, clamped to ±3 m (visual only). That hides vehicles floating or sinking on coarse far cells (`render3d.js:1180-1193`). With the detail faded in the arena (§10.2) the offset is under 0.5 m RMS out to 600 m. The aim ray tests vessels where they are drawn (§8.2).
- **2D (fallback and blueprint):** tracks show links (shifted by `p.belt`); turrets and guns show the build pose. The particle kinds used (ring, smoke, flash) already exist in both `updateParticles` and `FX.draw`, so 2D and 3D agree. (critic) There is no `dust` kind: `groundDust` emits `smoke` particles in a dust colour (`flight.js:952`), so dust needs no new branch in either renderer.

---

## 14. Performance budget and how it is measured

| Budget | Target | Measured by |
|---|---|---|
| Tracked tank, physics step (driving, arena) | ≤ 80 µs in Node on desktop; ≤ 16 terrain calls a step (13 expected upright: §4.2) | `ground.test.js` counts calls (asserted); µs logged |
| Parked tank | ≤ 40 µs; (critic) the 4 belly corners only, the same probes as driving (the active craft never sleeps) | same |
| (critic) Drawn vs physics ground in the arena | RMS < 0.6 m out to 600 m on high (low reported) | `test/tools/arena-probe.js` (the `drawn.js` method) |
| (critic) Shell over a berm | every level shot 1 m over a crest from 300 m hits it | `ground.test.js` |
| AI vehicle (kinematic) | ≤ 15 µs per 1/30 s move; ≤ 60 surfaceAt/s | `groundai.test.js` counts calls (asserted) |
| Main-gun shell over its life | ≤ 3 ms in Node | bench: 100 shells at 1.5 km over the arena |
| Autocannon or MG round over its life | ≤ 0.3 ms (coarse cache, altitude skip) | bench: an 18/s stream for 10 s |
| Penetration plus post-pen | ≤ 100 µs a hit | `armour.test.js` timing log (1,000 random hits on the MA-1) |
| Vehicle collisions | ≤ 5 µs a step with 12 vessels | bench |
| Aim ray (20 Hz) | ≤ 0.4 ms an update | browser bench |
| Spotting LOS | ≤ 10 checks/s, ≤ 0.15 ms each | browser bench |
| HUD canvas | ≤ 120 ops a frame; minimap ≤ 150 ops a redraw, only on change | the PR #35 2D-call counter (instrument.js) |
| DOM | no per-frame writes; updateHUD at 12.5 Hz through `set()` | MutationObserver count |
| Draw calls | own tank ≤ 30; 6-vehicle battle ≤ 300 high / ≤ 160 low | `Render3D.info().calls` |
| Idle hangar / paused flight | 0 GL calls / 10 fps, unchanged | `redraw.mjs` |
| Network, per player | +1 pv row per ring at ≤ 5 Hz; `obj` 2 Hz ≈ 60 B; 1 `shot` per main-gun shot; `seen` 1 Hz | `Net` byte counters in `ground-battle.mjs`. Graft: the gate before ever raising rooms past 3v3. |

**Method** (the PR #35 recipe):
- The scratchpad harness (`perf/measure/harness.mjs`, `instrument.js`, `cpu-impl/bench-browser.mjs`) is repointed at a base checkout and the working tree.
- It runs on desktop and phone profiles (CDP CPU ×4) for:
  - an idle hangar with the MA-1;
  - the MA-1 parked and driving on the arena;
  - a Practice Battle with 5 AI;
  - a two-tab ground battle.
- Before/after tables go in the PR. Old scenes (buggy, FS-16, idle hangar) must match PR #35's numbers.
- A trimmed `test/bench/ground-bench.mjs` (µs/step per stock vehicle, calls per step, the draw calls of one tank) is committed. It is not in `run.mjs`'s default list, so the headless run stays near 45 s.

---

## 15. Risks, decisions, assumptions, what is left out

### 15.1 Risks and their mitigations

| Risk | Mitigation |
|---|---|
| Old designs drift | Every new path is gated on `def.gv`, new def fields or kind `tank` (§16 hook table). Counter-stub tests prove old templates make **zero** calls into gear.js, aim.js, armour.js, gmode.js, groundai.js or ghud.js. Fingerprint, traces, mp-measure, combat, handling and the new `driving.json` show **additions only**, checked key by key, as PR #36 did. |
| The forked `Gear.ground` drifts from `Vessel.ground` | It shares only the crash, dent and landed rules. Each copy has a comment naming the other, and `ground.test.js` checks a crash and a dent on both paths. |
| Spring stiffness against step size | Verified at h = 1/120 and 1/60 in the driving baseline. ζ is clamped. k is recomputed when mass changes. |
| Skid steering jitters at a standstill on slopes | The parking mu holds with accumulated impulses. `ground.test.js` parks every stock vehicle on 15° for 10 s (drift < 0.1 m). |
| Probe cull misses a rock under the belly | The 0.6 m band plus the full fallback when gear loses contact. A test drives every stock vehicle over the arena's steepest patch and a berm. |
| (critic) What is drawn differs from what is hit (the patch's coarse far cells drop the detail physics keeps) | The detail is faded inside the arena box, berms are drawn as earthworks, vehicles are reseated and the aim ray tests vessels where they are drawn (§10.2, §13, §8.2). The probe asserts the error budget. Outside arenas (sandbox driving anywhere else) the old mismatch remains and is written into handbook §7 as a loose end. |
| Turret pose differs between shooter and victim | Hits stay shooter-authoritative on eased angles; accepted as cosmetic, the trade the game already makes for positions |
| Phone CPU | Probe plan, kinematic AI, shell altitude skip and coarse cache, memoised LOS, the minimap only on change. The 3v3 cap stays. |
| The hidden phone host's tick is throttled | The tick integrates host time clamped to 1 s. `MP.awake` keeps the screen on. The lobby already warns when a phone host looks away (PR #33-34). |
| The lattice cache clears at 80k entries in long battles | Vehicle probes and main-gun shells only; fast rounds use the coarse cache |
| The save format gains `mm` | The `skin` precedent across 8 paths, plus a round-trip test (rows → RSS3 code → spawn rows → restore → mass) |
| Real names slip into the game | A review checklist item: parts, shells, templates, paints, blurbs, HUD and toasts |
| Count churn | README, handbook, CLAUDE.md, builder-shapes and the R&D lists move together (§16, Phase 4) |

### 15.2 Every open question, decided

| Question (raised by) | Decision |
|---|---|
| A new kind or `car`? (all) | A new kind `tank`, "Armour"; behaviour from parts; cars keep everything |
| Should moving cars stop drawing AA fire in solo Hostile? (phone, wt, safe) | No. Cars keep today's quirk (documented). Armour is exempt (§11.5). |
| Arena edge: knock out or warn? (phone, wt, build) | A warning only (the owner's preference) |
| SPAA aim assist on touch? (phone, safe) | On by default for touch, off for mouse, a Settings toggle |
| Team size (all) | 3v3 maximum. Bandwidth is measured and reported, as the gate for later. |
| Respawn model (all) | Tickets with **free respawns** by default (Your vehicle, Change vehicle, aircraft when earned). A lobby option **Lineup of 3** gives War Thunder's each-slot-once model. |
| Look-alike bodies per stock tank (phone) | Not in this update. The stock vehicles use catalogue parts; bespoke lofted bodies can follow, as the jets did. |
| Auto-repair and auto-righting: buttons? (phone, wt) | Both automatic: repairs while stopped, righting when stuck. No new buttons. |
| Lock assist default (safe) | Same as aim assist |
| Turret toss chance (safe) | Always, on every ammo detonation (Silly `hollywood` throws it twice as hard) |
| Old aircraft guns' penetration (safe, wt) | The legacy table (§6.5): CAS works without touching old weapons |
| Lineup size (wt) | 3, in the Lineup option |
| Default aim (wt) | Arcade; Realistic is a lobby option and a solo setting |
| Name list (wt) | The §12 names. 'Ossa' and 'Malyutko' were replaced. |
| Wick Moor sandbox spawn for every car? (safe) | Only Armour and armed cars spawn at the arena; unarmed cars at the runway |
| Tanks in air battles? (build) | No: air games keep `MP_KINDS_PVP` exactly |
| Should old cars get left/right symmetry? (build) | No (an editing change for old designs) |
| Infantry on foot? (all) | No. Troops are a capture bonus and a spall sponge. |
| Ground battles without the Earth map (terrain, build) | The Runway arena |
| The 2D fallback for ground combat | Driving only, with a toast |

### 15.3 Assumptions

- "Cars" means armoured cars plus an armed civilian car (the technical). Old cars are unchanged.
- "Player SAMs" means SAM launchers players build and drive.
- "Infantry vehicles" means IFVs whose troops capture faster and soak fragments; no dismounts.
- "Missile launchers" means ATGM carriers, rocket artillery and SAM launchers.
- "New UI" means the Armour builder (tabs, stats, X-ray, armour control, arcs), the ground HUD and touch layout, the lobby's Game segment, the respawn panel, the minimap and tactical map.
- Air support is an option, off by default.
- Money tiers stay $45k/$75k/$120k, read as WWII, Cold War and Modern.

### 15.4 Deliberately left out

- Infantry on foot.
- Physical trees and buildings: they depend on the quality setting and would desync players. Cover is terrain, berms, wrecks and smoke.
- Collisions for old cars.
- Drowning.
- Crew skills.
- An ammo loadout screen (shell types share the gun's pool).
- Kill cams.
- Mines.
- A thermal post-effect (thermal marks targets instead).
- Laser warning receivers and hard-kill APS.
- Ships.
- Joining a battle in progress.
- Rooms above 3v3.
- Ricochets that ricochet twice.
- Plan-view armour angling inside a part (cheek wedges are separate plate parts).

---

## 16. Implementation plan

### 16.1 New files

All plain globals with no DOM at load time; checked unused with `grep -n "^const NAME\|^function NAME" js/*.js`. Each gets an `index.html` `<script>` in this order, a `sw.js` SHELL entry (`CACHE = 'overbuilt-v24'`) and a README "Project layout" line.

| File | Global(s) | Loads after | Owns |
|---|---|---|---|
| `js/gear.js` | `Gear` | vessel.js | running-gear contacts, suspension, drive, skid steer, water, righting, collisions, stats |
| `js/aim.js` | `Aim` | gear.js | turret groups, poses, sweep and limits, aim step, ballistic solve, firing (tgun, agun, launcher overrides), radars, lock, guidance (saclos, top, clos, radarSees), smoke, LOS (`sees`) |
| `js/armour.js` | `SHELLS`, `SHELL_TYPES`, `Armour` | aim.js | shell flight, hit geometry, resolver, post-pen, modules, crew, knock-out, repair, HE and legacy armour, net shells, summaries |
| `js/gmode.js` | `GroundMode`, `GROUND_STOCK` (critic: here, not in builder.js, so it loads headless with `mp`) | combat.js | arenas, placement, capture and ticket rules (pure), the stock fallback list, `soloPlace`, `obj()` |
| `js/groundai.js` | `GroundAI` | gmode.js | Tank Range, Practice Battle, AI brain, kinematic movement |
| `js/ghud.js` | `GHUD` | mpui.js (before main.js) | aim ray update, ground canvas HUD, damage diagram, minimap, tactical map, layout, touch bindings |

`test/lib/game.js` loads `gear.js`, `aim.js` and `armour.js` after `vessel.js` (each guarded by file existence, so ROOT runs against old checkouts still work). It loads `gmode.js` with `combat` or `mp`, and `groundai.js` with a new `ground: true` option. The copy list (`:66`) gains `SHELLS`, `GROUND_KINDS`, `GROUND_STOCK`, `Gear`, `Aim`, `Armour` and `GroundMode`. (critic) Its `Sound` stub is a Proxy whose every key is a no-op (`game.js:30`), so `Sound.cannon` needs nothing there; in the page it needs the P1 stub (hook 64).

### 16.2 Interfaces (frozen in Phase 1; stubs first, then filled)

```js
// ---- parts.js (Phase 1, implemented)
GROUND_KINDS: Set; isGround(kind) -> bool
cleanMm(v, def) -> number | undefined;  armourMassT(def, mm) -> t;  armourCostDelta(def, mm) -> $;  massPerMm(def) -> t/mm
// ---- gear.js
Gear.points(p, wheels)                        // Phase 1 (implemented): pushes gear contact points (shape §4.2)
Gear.ground(v, dt, sim)                       // Phase 2A
Gear.bump(v, sim)                             // Phase 2A
Gear.stats(parts) -> { mass, kw, hpt, top, rev, pivot, climb, tip, overload, loadT }   // pure, builder; Phase 2A
Gear.calls                                    // terrain calls in the last Gear.ground (test counter)
// ---- aim.js
Aim.groupsOfParts(parts, adj) -> [group]      // Phase 1 (implemented): group shape §5.1
Aim.groups(v)                                 // Phase 1: sets v.tg, v.tgOf, v.aimed, v.bodyBox; clears v.crewCache
Aim.pose(v, p, P, out); Aim.unpose(v, p, P, out); Aim.dir(v, p, out); Aim.muzzle(v, p, out); Aim.trunnion(v, p, out); Aim.sightPoint(v, out)  // Phase 1
Aim.sweep(parts, group) -> { yawLim, dep }; Aim.limits(v)                       // Phase 2C
Aim.stepAll(F, h); Aim.step(v, h, F, want /* null: F.aim; {P}: AI */)          // Phase 2C
Aim.solve(shellKey, D, dH, body) -> { el, t, drop, v }; Aim.rangeTable(def, body) // Phase 2C
Aim.fire(v, sys, h, F)  // tgun/agun/launchers for the trigger; Aim.netFire(g, p, h, F, foe)
Aim.aimDir(v, out); Aim.status(v) -> { shells:[{key,label,n}], sel, queued, reload (0..1), ready, lock, guiding, scope:[blips], lead }
Aim.radarStep(v, F, dt); Aim.lockPid() -> pid|0; Aim.radarSees(L, t, tp, s) -> true|false|'notch'
Aim.guideSaclos(s, h, spd); Aim.guideTop(s, h, spd); Aim.guideClos(s, h, spd)
Aim.smoke(v, F); Aim.smokeStep(h); Aim.netSmoke(g, m); Aim.smokeBlocks(a, b) -> bool
Aim.sees(a, b, opts) -> bool; Aim.summary(parts) -> { gun, pen1k, reload, trav, el, crew, rounds }
// ---- armour.js
SHELLS: { key: { type, cal, v0, pen, k, kg, dmg, he?, blast?, prox?, burst?, r? } };  SHELL_TYPES: { type: { ric:[lo,hi], norm, L, n, cone } }  // Phase 1 (data)
Armour.hitAll(v, a, e, out) -> [{ p, t0, t1, n, edge }]; Armour.hitFirst(v, a, e) -> { p, t } | null       // Phase 2B
Armour.moveShell(s, h, F) -> keep; Armour.netShell(g, m); Armour.coarseH(e, z)                             // 2B
Armour.resolve(s, v, hits, F) -> { r, rows, mods, at, what, crew, ric }; Armour.apply(v, res, F, by)      // 2B
Armour.legacyHit(s, v, p, at, F); Armour.blastK(v, p, d, blast, k, he, mods) -> k | null                    // 2B
Armour.moduleDown(v, p, cause, sim); Armour.modDamage(v, host, i, dmg, sim, by); Armour.knockOut(v, sim, why) // 2B (Phase 1 stubs: moduleDown → rip like today)
Armour.crewOf(v) -> { crew:[{host,i,role,alive}], stores:[{host,i,rounds,cook,blowout}] }; Armour.has(v, role) -> bool   // 2B (stub: true)
Armour.repairStep(v, dt, sim); Armour.summary(parts) -> { front, side, turretFront, crew, rounds }
// ---- gmode.js (pure)
GroundMode.arena(id); GroundMode.pick(mapReady) -> 'highland'|'runway'; GroundMode.placement(arenaId, team, slot, kind) -> { e, z, yaw, air? }
GroundMode.init(arena, settings, teamSizes) -> obj; GroundMode.tick(obj, dt, units /* [{team,e,z,kind,speed,gd,troops}] */) -> [events]
GroundMode.death(obj, team, cost, air) -> ticketsLost; GroundMode.result(obj, timeUp) -> { winner, why } | null; GroundMode.inZone(e, z, zone)
// ---- groundai.js
GroundAI.frame(F, dt); GroundAI.kinStep(v, dt); GroundAI.down(v, F); GroundAI.reset(F); GroundAI.startRange(F); GroundAI.startBattle(F, opts); GroundAI.battle /* state | null */
// ---- ghud.js
GHUD.draw(ctx, W, H, dpr, F); GHUD.place(W, H); GHUD.aimUpdate(F); GHUD.sync(F) /* DOM, from updateHUD */; GHUD.bind(); GHUD.tactical(open)
// ---- render3d.js
Render3D.aimRay(out) -> { o, d }; Render3D.setSight(on, zoom); setFov(deg) (internal); F.aimCam read
// ---- vessel.js
Vessel.prototype.applyImpulse(rPart /* part-space point */, dirSim, j)   // the closure at vessel.js:988-992, lifted; Phase 1
// ---- flight.js
Flight.groundAim, Flight.aimYaw, Flight.aimPitch, Flight.aim (shape §8.2), Flight.sight, Flight.zoom, Flight.zero, Flight.mouseFire, Flight.aimBy(dx, dy)
Flight.start(design, { place: { e, z, yaw, air?: { alt, speed } }, keep: [wrecks] })
// ---- mp.js
MP.kindsFor(settings) -> kinds; MP.sendHits(ghost, list, kind, mods?, dir?); MP.wrecks; MP.battleCost
// ---- (critic) missing from the frozen interfaces; added in Phase 1 as stubs or one-liners
Flight.mgFiring /* Space, MG button */; Flight.aimCam /* the aim camera is on */; Flight.freeLook /* C held */
GroundMode.soloPlace(kind) -> place | null;  GroundMode.obj() -> MP.state.obj | GroundAI.battle.obj | null;  GROUND_STOCK
GroundAI.onDestroyed(F) -> bool   // the Practice Battle's respawn (hook 69)
MP.host(mode, transport, settings?); MP.sendShot(s) /* + sh for k 'shell' */; MP.sendSmoke(v, cloud) /* cm { smoke: 1, P, D } */
Combat exports (hook 41) + targetCentre, hitTarget, aiDown, jams, radarOf, boomFX   // moveShell, knockOut, radar lock and netShell need them
Sound.cannon(cal, dist)            // P1: a no-op stub in audio.js (2B's netShell calls it before 2C lands); 2C: the sound
Terrain.bermAt(e, z) -> m;  Terrain.height(c, G, i, j, cont, noBerm)   // P1
Render3D.drawnGround(b, a, z) -> m // meshHeight + bermAt; 3F (P1 stub: meshHeight)
Armour.partFX(o, p, n)             // module-aware smoke and fire (hook 70); 2B (P1 stub: today's loop body)
NO_GEAR                            // parts.js: Object.freeze([])
```

**(critic) Vessel construction.** The constructor sets `this.gv = false; this.gear = this.aimed = NO_GEAR; this.tg = this.tgOf = null; this.plated = false;` before `recompute(true)`. `ground()`, `turnTarget()`, combat and the renderer then never read `undefined.length`, even on a vessel used before `rebuildGroups()`. Every path calls it today (`flight.js:44`, `mp.js:720`, `combat.js:1005`, `vessel.js:1155, 1196`), but that is a convention, not a guarantee.

**Vessel fields set by these.**
- `v.gv`, `v.gear`, `v.tg`, `v.tgOf`, `v.aimed`, `v.plated` (= `v.gv`), `v.bodyBox`, `v.crewCache`;
- `v.beltV`, `v.susp`, `v.drivePower`, `v.flooded`, `v.righting`, `v.ko`, `v.wreck`, `v.kin`, `v.spawnAt`.

**Part fields.**
- `p.aimYaw`, `p.aimEl`, `p.aimYawT`, `p.aimElT`, `p.mm`, `p.mods` (hp array), `p.broken`, `p.ko`;
- `p.belt`, `p.spin`, `p.shotAt`, `p.reload`, `p.shellSel`, `p.shellNext`, `p.stow`, `p.used` (ERA), `p.fire` (seconds left).

`serialize` and `restore` carry, for `gv` parts only: `aimYaw, aimEl, mm, mods, broken, ko, stow, shellSel`. All are sanitised (finite, clamped, `cleanMm`, booleans).

### 16.3 The hook table: every change to an existing function

The **owner** column names the work package that writes the line. Phase 1 writes every hook that dispatches to a stub, so the parallel packages own disjoint functions.

| # | File:line | Change | Guard (false for every old design) | Owner |
|---|---|---|---|---|
| 1 | vessel.js:231 rebuildGroups (and, critic, the constructor at :111: the same fields' defaults before `recompute(true)`) | `this.gv = parts.some(p=>p.def.gv); this.gear = this.gv ? parts.filter(p=>p.def.track\|\|p.def.awheel) : NO_GEAR; this.plated = this.gv; if (this.gv) Aim.groups(this); else { this.aimed = NO_GEAR; this.tg = this.tgOf = null; }` | `gv` | P1 |
| 2 | vessel.js:245 | `aircraft = wings.length > 0 && kind !== 'tank'` | kind tank | P1 |
| 3 | vessel.js:290-316 computeHull | gated branches (track/awheel → `Gear.points`; inner → none; outline → outline corners) | `def.gv` | P1 |
| 4 | vessel.js:504 turnTarget | `if (this.gear.length) return null;` | gear empty | P1 |
| 5 | vessel.js:711 | `cdO = isGround(this.kind) ? 0.5 : 0.9` | identical for car | P1 |
| 6 | vessel.js:931 ground | `if (this.gear.length) return Gear.ground(this, dt, sim);` | gear empty | P1 |
| 7 | vessel.js new | `applyImpulse` method | unused by old code | P1 |
| 8 | vessel.js:1166/1178 | serialize/restore `gv` fields | `def.gv` | P1 |
| 9 | vessel.js:11 ROUND3D | add `tcast`, `tring` | new shapes | P1 |
| 10 | parts.js:5-30 | 7 categories, `VEHICLE_KINDS.tank`, `GROUND_KINDS`, `isGround` | new | P1 |
| 11 | parts.js PARTS | the 71 defs (behaviour complete; placeholder recipe 'box' and default 2D rect until 2D) | new keys | P1 |
| 12 | parts.js:836 partKg | mm branch | `p.mm` | P1 |
| 13 | parts.js:1226-1267 | rows `mm`, `cleanMm` | `mm` | P1 |
| 14 | parts.js:1287 findControlPart | `&& !p.ko` | ko never set | P1 |
| 15 | parts.js:1293 designCost | `+ (p.mm != null ? armourCostDelta : 0)` | `mm` | P1 |
| 16 | parts.js:1491 SKINS | +4 paints | new keys | P1 |
| 17 | parts.js drawing | partPath0/drawPart0 cases, PART_RECIPE real recipes, LATHE_SHAPES, CLASH_PAD/BOXED, NO_SKIN, sideLayer 4, X-ray 2D | new shapes | 2D |
| 18 | combat.js:37 maxHp | `d.hp \|\|` | no old `hp` | P1 |
| 19 | combat.js:43 damage | `if (p.broken && p.def.module === 'crew') return;` and spawn protection `if (v.spawnAt && sim.time - v.spawnAt < 4) return;` | new fields | 2B |
| 20 | combat.js:58 destroyPart | `if (p.def.module) return Armour.moduleDown(v, p, cause, sim);` | `module` | P1 |
| 21 | combat.js:128 explode | signature `(…, quiet, he, spare)`; `if (v === spare) continue;`; plated: `Aim.pose` distance and `Armour.blastK`; `MP.sendHits(v, hits, 'blast', mods)` | `v.gv`, args undefined | P1 (signature, spare) / 2B (body) |
| 22 | combat.js:158 systems | exclude `w.kind === 'smoke'` | new kind | P1 |
| 23 | combat.js:265 fireRocket / :277 launchMissile | `def.aim` overrides (dir, muzzle, boost, coast, hot, he, saclos/top/clos/gr flags) | `def.aim` | 2C |
| 24 | combat.js:397 playerFrame | `fwd = cur.def.aim ? Aim.aimDir(v) : noseDir(v)`; smoke skip for IR candidates when `S.smoke.length`; (critic) the **tgun trigger edge** → `Aim.fire`, placed before the "empty" toast (`:428`); the lock block skipped for `seek` 'saclos'/'clos'. Held agun fire is **not** here (frame rate): see row 25. | `def.aim`, new kinds | 2C |
| 25 | combat.js:474 step | after the turret loop: `if ((v && v.aimed && v.aimed.length) \|\| S.gai) Aim.stepAll(F, h);` and `if (S.smoke.length) Aim.smokeStep(h);`. (critic) `Aim.stepAll` also fires held weapons per substep: the selected `agun` while `F.firing`, and MGs while `F.mgFiring`. | `aimed` empty, no smoke | P1 (line) / 2C (body) |
| 26 | combat.js:454 candidates | `isGround(g.kind)` (two places), local ground AI, radar emitter ghosts | identical for car | 2C |
| 27 | combat.js:519 moveShot | first line `if (s.k === 'shell') return Armour.moveShell(s, h, F);`. (critic) Its `explode` calls (`:524, 573, 577, 584, 602`) gain `, s.he, s.t < 0.6 ? s.spare : undefined` (both undefined on old shots: identical calls). | new kind | P1 |
| 28 | combat.js:551 | `const q = o.plated ? Armour.hitFirst(o, a, e) : hitVessel(o, a, e);` | `plated` | P1 |
| 29 | combat.js:529-530, (critic) 776 | `const tm = s.coast ?? 0.35, tg = s.gt ?? 0.35` for the motor window, the guidance start and `guideAir`'s "too slow to steer" test (§7.4) | undefined on old shots | P1 |
| 30 | combat.js:575-581 | `if (hit.def.armour) return Armour.legacyHit(s, hv, hit, at, F);` (critic: the **first** line of the direct-hit branch, above `if (s.blast) explode(…)` at `:577`, since the legacy table handles the blast; `legacyHit` handles a remote `hv` through `sendHits`) | `def.armour` | P1 |
| 31 | combat.js:765 guideAir | `s.gr ? Aim.radarSees(…) : <old>` | `s.gr` | 2C |
| 32 | combat.js:801 guide | `if (s.saclos) return Aim.guideSaclos(…); if (s.top) return Aim.guideTop(…); if (s.clos) return Aim.guideClos(…);` | new flags | 2C |
| 33 | combat.js:506 netGuns | `agun` branch | new kind | 2C |
| 34 | combat.js:823 netShot | `if (m.k === 'shell') return Armour.netShell(g, m);` | new k | P1 |
| 35 | combat.js:865 netFlares | `if (m.smoke) return Aim.netSmoke(g, m);` | new field | P1 |
| 36 | combat.js:335 countermeasures | `if (v.gv && hasSmoke) Aim.smoke(v, sim);` first | `gv` | 2C |
| 37 | combat.js:1196 reset | `S.smoke = []; S.gai = 0;` | — | P1 |
| 38 | combat.js:1107 frame | `flyingFor(v)` for kind tank; fighter guards (§11.4); `if (!GroundAI.battle)` around spawnAll; lock line `\|\| Aim.lockPid()` (gated). (critic) Three dispatch lines that nothing else would run: `GroundAI.frame(F, dt)` (it returns at once unless the range or a battle is live); and, for the active vessel and each local AI vehicle with `v.gv`, `Armour.repairStep(v, dt, F)` (repairs, fires, role-swap timers) and `Aim.radarStep(v, F, dt)`. | tank, `ai.ground`, `v.gv` | P1 (lock line, the three dispatch lines) / 3H (rest) |
| 39 | combat.js:890 aiDown, :1232 drawHUD | ground AI text and skip. (critic) And the gun and rocket pipper and LEAD block (`:1251-1267`) skipped while `F.groundAim`; elsewhere an aimed weapon uses its first shell's v0 in place of `w.speed` (§9.1). | `ai.ground`; `groundAim`, `def.aim` | 3H (AI); P1 (pipper guard) |
| 40 | combat.js:1438 status | ground fields for tgun/agun (name from shell label, reload, ammo, n). (critic) Also `smoke` (rounds left), counted in the no-system branch, so a smoke-only vehicle still gets its SMOKE button. | new kinds | 2C |
| 41 | combat.js:1459 return | exports `candidates, refPos, clutter, irSig, chaffBreaks, segPoint, boxesOf, hitVessel, launchMissile, fireRocket, release, nextStore`, (critic) plus `targetCentre, hitTarget, aiDown, jams, radarOf, boomFX`, which `moveShell`, `knockOut`, the radar lock and `netShell` call (the `'  return {\n    S, step,'` anchor kept, `test/lib/game.js:40`) | — | P1 |
| 42 | flight.js:28-64 start; (critic) :112-117 revert | `P.air` (lift, speed, gear up), `opts.keep`. (critic) `revert` passes `{ place: GroundMode.soloPlace(this.design.kind) }` when that isn't null (§11.1). | new opts; null for old kinds | P1 |
| 43 | flight.js:66 resetState | keep wrecks | — | P1 |
| 44 | flight.js:520-528, 631-640 | skip `v.kin \|\| v.wreck` in stepping; no coasting for wrecks | new flags | P1 |
| 45 | flight.js:857 drive1k | `isGround` | identical for car | P1 |
| 46 | flight.js:588 readControls, 980-1112 input, 1314-1446 HUD, 1243-1275 hints, 481-501 help, 555-558 sound, 892-975 dust | aim mode (§8, §9, §13); (critic) `KeyY` for the zero, not `KeyR`; `e.buttons` and `movementX/Y` under pointer lock; Brake shown for `v.gear.length` and SMOKE for `ws.smoke` (`:1421, 1424`); `body.ground` and `groundAim` as two flags (§8.1) | `groundAim`, `gear` | 3F |
| 47 | render3d.js:8, 2381, 2412-2435, 3112-3135, 2772-2804 | TANH let + setFov, CAM0.tank, aim camera, sight, shell route, reseat, capture rings; (critic) `drawnGround`, the earthworks mesh, `keepClear` inside arena boxes marked `clear` (`:1865`) | `F.aimCam`, new k, ground kinds | 3F (CAM0, the `drawnGround` stub: P1) |
| 48 | render3d.js:1151 fieldGround; (critic) :980 patch heights | `if (q.f.pad) return h;`; the patch calls `height(c, G, i, j, cn[k], true)`, so berms are left to the earthworks mesh | pads only; berms only exist in the arena | P1 |
| 49 | terrain.js:547 fieldAt; :586 height; (critic) :517-524 natural | pads loop; berms in the arena box, skipped when `noBerm`; (critic) `det *= 1 − arenaW(e, z)` (the detail faded inside arena boxes, §10.2); `bermAt` exported | new data; `arenaW` is 0 outside the arena boxes | P1 |
| 50 | space.js:88-99 | `EARTH.arenas`, `EARTH.groundPads` | new data | P1 |
| 51 | parts3d.js instance/update/place/freeRig/model | recipes, group transforms, belt, recoil, wreck tint, inner hide, ghost belt, `setXray`, flip-free model key for gv | new recipes, `v.tgOf` | 2D |
| 52 | builder.js:362-376, 1214-1245, 385-391, 1615-1619, 1490-1518 | KIND_TAB, setKind, mirrorOf, symKey, renderKind, hangar group, RSS3 codes | tank, `mm` | P1 |
| 53 | builder.js:294 templateRows | `{mm}` extras | new | P1 |
| 54 | builder.js rest (quickAdd, stats, warnings, tools, specLine, families) | §2 | tank / gv | 2E |
| 55 | builder.js TEMPLATES | §12 (critic: `GROUND_STOCK` moved to gmode.js, owned by 3G with the keys fixed in §10.5) | new keys | 3I |
| 56 | mp.js:36-50, 591, 706, 629; (critic) 887-916 | spawn rows mm, buildGhost mm, pv filter; (critic) `sendShot` adds `sh` for `k === 'shell'` (`:913`); new `sendSmoke` (`cm { smoke: 1, P, D }`); `sendMissile`'s `agm` for every ground seeker and `tg: 0` for 'saclos'/'top' (`:892`) | new | P1 |
| 57 | mp.js:845-875 sendHits/onHit | `mods`, `dir`, `m` rows; refuse wrecks | new args | 2B |
| 58 | mp.js (settings, kindsFor, spawns, tick, recordDown, checkWin, onLocalDestroyed, respawn, placement, battleDesign, onDown, onPartVis easing, beforeUpdate easing, new handlers) | §10. (critic) Also: `host(mode, transport, settings)`; `designProblems` takes the aircraft kinds at respawn; the pad pseudo-spawns; host-side spawn pricing; `battleDesign` still returns the design (adding `key`); `beforeUpdate` re-adds `MP.wrecks`; easing only for `def.gv` parts; `onParts` → `Aim.groups(g)` for plated ghosts; `onDown` checks `m.P`; `MPUI.drawRadar` off in ground games | `settings.game === 'ground'`; `def.gv` | 3G |
| 59 | mpui.js:190-230, 251-292, 296-410, 454-483, 495-590 | lobby, bar, spawn map, scoreboard, results, spotted, respawn panel | ground game | 3G |
| 60 | net.js:11, 39 | NET_VERSION 7; HOST_ONLY += obj, spot | — | 3G |
| 61 | main.js:101; 270-293; 312-330; 281; (critic) the Settings dialog | GHUD.draw (P1, gated); launch placement through `GroundMode.soloPlace` (3H); showHelp and tip (3F); (critic) Settings rows for aim assist, solo `aimMode` and mouse sensitivity (3F) | `groundAim`, tank | P1/3H/3F |
| 62 | index.html:133-138 + ui.js:80 + css | kind button, icon, `#kind-select` 5 cols; script tags | — | P1 |
| 63 | index.html #flight-ui / builder panel / mp screens; css sections | per package | — | 3F / 2E / 3G |
| 64 | audio.js | `Sound.cannon(cal, dist)` | new | P1 (critic: a no-op stub, because 2B's `netShell` and 3H's AI call it) / 2C (the sound) |
| 65 | career.js | Tank Range mission | new | 3H |
| 66 | sw.js | CACHE v24, 6 SHELL entries | — | P1 |
| 67 (critic) | world.js `Settings` defaults | `aimAssist` (on for touch), `aimMode` ('arcade'), `aimSens` (1) | new keys | 3F |
| 68 (critic) | combat.js:43-55 damage toasts | the "damaged" and "on fire!" toasts skip `def.gv` parts (Armour's module toasts replace them) | `def.gv` | 2B |
| 69 (critic) | flight.js:391 onDestroyed | first line `if (GroundAI.battle && GroundAI.onDestroyed(this)) return;` (§11.1b) | `GroundAI.battle` null | P1 |
| 70 (critic) | combat.js:1181 the damaged-part loop | `if (p.def.module) { Armour.partFX(o, p, S.smokeN); continue; }` before the hp test; wrecks other than the 3 nearest skipped | `def.module` | P1 (line; the stub keeps today's body) / 2B (`partFX`) |

### 16.4 Phases and work packages

#### Phase 0: safety nets (one agent, before any engine change)

**WP0. Owns:** `test/driving.js`, `test/baseline/driving.json`, `test/tools/arena-probe.js`, `test/bench/ground-bench.mjs`, and the `run.mjs` NODE list entry for `driving.js`.

**Delivers.**
- **`driving.js`:** full-precision traces (17 digits, the `cpu-impl/equiv.js` style) of:
  - the Dune Buggy: forward 10 s, cornering at 10/20/30 m/s, braking, reverse, the causeway, a 10° Shetland slope;
  - the Dragonfly and the Lunar Rover rolling;
  - taxi and take-off rolls for falcon, mustang and fs16.

  This closes the gaps tests.md found (no forward-drive trace, no plane ground-roll baseline).
- **The arena probe:** prints the §10.2 table. (critic) It also prints the drawn-minus-physics table (the `scratchpad/ground/critic/drawn.js` method: the patch's own vertex grid, span ≈ 37 km, `PW` 2.2, n 96 high and 64 low, with each vertex's cell-size level of detail), before and after the detail fade. That way Phase 1 lands the fade with measured numbers.
- **The bench:** µs/step and terrain calls per step. It runs on the buggy today; later phases extend it.

**Exit.** All 12 suites plus `driving` pass twice, identically.

#### Phase 1: foundation and contracts (one agent, serial)

**WP1. Owns:** every row marked P1 in §16.3, and the first version of the six new files with the §16.2 interfaces.

| Implemented fully | Stubbed |
|---|---|
| `Gear.points` | `Gear.ground` falls back to a minimal rigid contact (the old arithmetic on the gear points) so templates can be placed and stepped |
| `Aim.groupsOfParts`, `Aim.groups`, and `pose`/`unpose`/`dir`/`muzzle`/`trunnion`/`sightPoint` | the rest of `Aim` returns no-ops |
| `SHELLS`, `SHELL_TYPES` | `Armour.moduleDown` rips the part as today; `hitFirst` falls back to `hitVessel`; `has` returns true; the rest returns no-ops |
| the parts.js save helpers | `GroundMode`, `GroundAI` and `GHUD` return no-ops |

Also: the 71 defs with complete behaviour fields; categories; kind; paints; the save path (`mm`, RSS3, spawn rows); arena data, pads and berms; the kind button; `#kind-select`; KIND_TAB; mirrorOf; hangar group; script tags; `sw.js`; `test/lib/game.js` (loader, copy list, Combat._t names: `candidates, refPos, guide, guideAir, moveShot, netShot, netFlares, countermeasures, segPoint`).

(critic) Also the stubs and one-liners the parallel packages call across each other (§16.2's added block): `Sound.cannon`, `Render3D.drawnGround` (= `meshHeight`), `Armour.partFX` (today's loop body), `GroundAI.onDestroyed` (false), `GroundMode.obj`/`soloPlace`, `MP.sendSmoke`, and the `sh` field in `sendShot`. Plus the detail fade, `bermAt` and the patch's `noBerm` argument.

(critic) **WP1 is the biggest serial step**, about 50 hook rows plus 71 defs. If it runs long, it splits into two agents on disjoint regions:
- **P1-core:** vessel.js, combat.js, flight.js, mp.js, render3d.js, builder.js rows, index.html, CSS, sw.js, the test loader and the stubs.
- **P1-data:** the PARTS block, SKINS, space.js arena data, terrain.js pads, berms and the fade, and the probe re-run.

They share parts.js only in separate regions (P1-core takes `partKg`, `findControlPart`, `designCost`, the rows and `PART_CATEGORIES`/`VEHICLE_KINDS`). The contract tests run after both.

**Tests.**
- All existing suites pass, and every baseline is identical, except `builder-shapes.mjs` (More 22, tank 8 tabs: counts updated). (critic) `shapes.test.js` draws its 400 random pairs from all of `PARTS` with a fixed seed (`shapes.test.js:45-48`), so its pairs and printed counts change. It is a check list, not a baseline: it must pass, and it now tests the new outlines too.
- New `test/ground.test.js` §contract:
  - counter-stub proof that every old template (traces script, combat fingerprint ops, a buggy drive) makes **zero** calls into Gear, Aim, Armour, GroundMode, GroundAI and GHUD (each function wrapped with a counter);
  - `isGround`;
  - `cleanMm` and mass/cost deltas (old rows unchanged);
  - the rows ↔ RSS3 code ↔ spawn rows ↔ serialize/restore round trip with masses equal;
  - `groupsOfParts` on hand-built rings (seeds, att chains, jam, nesting, rot ≠ 0 ignored);
  - `pose`/`unpose` round trips;
  - pads flat to ±0.05 m;
  - berms present only inside the box and only with the map;
  - `fieldAt` unchanged at every existing airfield and site;
  - (critic) `heightAt`/`surfaceAt` byte-identical at 2,000 seeded points outside the arena boxes and their 200 m fade (the detail fade and the berms touch nothing else);
  - (critic) a `Vessel` built without `rebuildGroups` steps without throwing (the constructor defaults);
  - all 71 defs valid (cat in categories, tier ≤ 4, cost, mass > 0, outline convex and counter-clockwise, `armour.edge` length = outline edges, no new def has twinZ/mount/crew/smoke/armor/radar);
  - every new shell key used by a weapon exists.

#### Phase 2: core systems (five packages in parallel; disjoint files and functions)

| WP | Owns | Delivers | Consumes | Tests |
|---|---|---|---|---|
| **2A Movement** | `js/gear.js` (all but `points`); `ground.test.js` §physics; `driving.json` additions for parts-built test vehicles | §4 entire: probes, plane fit, cull, crash/dent, suspension, accumulated traction, power budget, skid steer, armoured-wheel steering, water and flooding, righting, collisions, belt/spin/susp/drivePower, `Gear.stats` | def fields; `v.gear`; `Combat.engineK`; `Armour.has(v, 'driver')` (stub true until 2B) | Call count ≤ 16 per step on the pad and ≤ 24 on slopes. Table §4.4 ±25% (0–30 km/h, top speed, pivot, climb). Parked on 15° for 10 s, drift < 0.1 m. h = 1/120 vs 1/60 speed within 2%. Broken-track yaw. Wading and amph speeds. Flooding. Righting within 5 s. Tip threshold of a top-heavy rig. Collisions: no tunnelling at 15 m/s, wreck immovable, mass split. Crash and dent on both paths. **driving.json old entries byte-identical.** |
| **2B Armour & damage** | `js/armour.js` (all but data); combat.js `damage` body, `explode` body (armour branch); mp.js `sendHits`, `onHit` | §6 entire, the legacy table, wrecks refused by hits, spawn protection | `Aim.pose`/`unpose` (P1); `v.tg`; `Combat.explode`/`damage`/`hpFrac` | `test/armour.test.js`: eff thickness and ricochet windows by angle (seeded); normalisation; overmatch; pen vs range for every kinetic shell within 2%; HEAT vs skirts, slat and ERA (tandem); prism, round and box entry faces; turned-turret hits (a side ray hits the turret front at ψ = 90°); raised barrel box; post-pen determinism; spall stops at a fuel cell; APHE burst; crew KO threshold; role swap; detonation odds and blowout; turret toss; repair only while stopped; engine fire; HE overmatch vs an open top; legacy weapons table; `m` rows round trip with hostile and garbage peers (bad id, index, NaN, Infinity, 1e9); `combat.json` byte-identical; `explode` with no new args byte-identical on old craft. Timing log (≤ 100 µs a penetration). |
| **2C Aim & weapons** | `js/aim.js` (all but P1 core); combat.js `playerFrame`, `candidates`, `fireRocket`, `launchMissile`, `guide`, `guideAir`, `netGuns`, `countermeasures`, `status`; audio.js `Sound.cannon` | §5.3–5.6, §7 entire, tgun/agun firing with reload, racks, stow, shell select, recoil impulse, dispersion, smoke, radar and lock, guidance, `sees` | `Armour.crewOf`/`has` (stubs until 2B); `SHELLS`; `v.applyImpulse` | `test/aim.test.js`: slew rates and limits; ring cap formula; jam never turns; sweep limits on a hand-built mast case; depression per sector; stabiliser (an unstabilised gun lags a pitching hull, a stabilised one doesn't); the ballistic solve vs real shells < 1 m at 500/1000/2000 m; muzzle and dir after ψ and el; reload with and without a loader or autoloader; rack draw order; SACLOS follows a moving ray and hits a crossing target at 2 km; top attack hits the roof face; command SAM loses lock on notch and chaff; the ground-launched missile no longer dives (the critic's measurement repeated); prox fuze within 4 m; smoke blocks `sees`, SACLOS and IR lock; the radar lock pid feeds `Combat.frame`'s lock line (mp stub); old turrets still park (`rwr.test.js:108-134` unchanged); new aimed guns fire while landed. |
| **2D Models & art** | parts.js drawing sections (partPath0/drawPart0 cases, HULLS, PART_PROFILE if needed, PART_RECIPE, LATHE_SHAPES, CLASH_PAD/BOXED, NO_SKIN, sideLayer, X-ray 2D draw); `js/parts3d.js` | §3.4, §13 models, group transforms, belt scroll, recoil, wreck tint, inner hide, ghost belt and spin, `VesselMesh.setXray`, flip-free model keys | `v.tgOf`, `p.aimYaw`/`aimEl`, `p.belt`, `p.spin`, `v.susp`, `p.shotAt`, `v.wreck` | `builder-shapes.mjs`: every new model within 1.5 cm of its clash shape. Screenshots of every new part in 2D and 3D (hangar) at 390×844 and 1280×720, inspected. Draw calls of each template ≤ 30. Belt clone disposed in `freeRig` (no leak over 50 spawn/despawn cycles). |
| **2E Builder** | builder.js (everything except P1 rows and TEMPLATES); index.html builder panel additions; css "Builder: ground" section | §2.3–2.5: `defaultRot`, `quickAddTank`, stats, warnings, X-ray, armour control, armour view, arcs, Test turret, specLine, renderInfo, families | `Gear.stats`, `Armour.summary`, `Aim.summary`, `Aim.groupsOfParts`, `Aim.sweep` (stubs until 2A/2B/2C), `VesselMesh.setXray` (2D) | `test/browser/builder-tank.mjs` (390×844): a six-tap tank (hull, track, engine, ring, turret, gun) is joined and clash-free and launches; (critic) every kind button fits (`scrollWidth ≤ clientWidth`) at the four sizes; the debounced `Aim.sweep` result redraws once when it lands (`redraw.mjs` contract); an Applique Plate at rot 1 sits flush on a hull front; z symmetry pairs; stats and warnings text; the armour stepper changes mass and cost and survives save, code and reload; X-ray, armour view and arcs redraw; `redraw.mjs` extended (each tool redraws once; idle hangar 0 GL calls); More in sight for tank. |

**Conflict rules.**
- combat.js functions are split as listed: 2B (damage, explode, the damage toasts, `partFX` behind its dispatch line), 2C (the rest), P1 (dispatch lines).
- parts.js after P1: 2D owns the drawing sections; the PARTS block is frozen. Balance changes go to 3I via the def table.
- CSS is append-only, one section per package.
- index.html is split by region: the builder panel (2E), `#flight-ui` (3F), mp screens (3G).
- (critic) **Merge order, Phase 2:** 2B → 2C (both in combat.js); 2A and 2D in any order; **2E last**. Its stats, warnings and tests read real `Gear.stats`, `Armour.summary` and `Aim.sweep`, and 2D's outlines change the clash shapes its six-tap tank is placed against: with stubs or box placeholders, its tests could pass and then break on merge. 2E rebases onto all four and re-runs `builder-tank.mjs` and `redraw.mjs`.
- (critic) Test-only stubs never cross a package boundary in the merged tree: every stub a package relied on is replaced by its owner before that package's tests are trusted.

#### Phase 3: game layer (four packages in parallel)

| WP | Owns | Delivers | Consumes | Tests |
|---|---|---|---|---|
| **3F Controls, camera, HUD** | `js/ghud.js`; render3d.js (camera, sight, TANH/setFov, aimRay, shell route, reseat, capture rings); flight.js input, HUD, hints, help, sound, dust; index.html `#flight-ui`; css "Flight: ground"; main.js showHelp and tip; README controls | §8, §9, §13 effects | `Aim.status`, `Armour.crewOf`, `F.aim`, `MP.state.obj`, `S.smoke` | `test/browser/ground-hud.mjs` on 390×844, 375×667, 844×390, 1280×720 and an in-room case: no overlaps with telemetry, left controls, `#mp-bar` or the RWR, (critic) nor with `.flight-top-right`, `#hint`, `#mp-feed` and `#btn-brake` (absolute, outside `.left-controls`' rect); an Armour design without guns still hides the autopilot bar (`body.ground`); Brake shows on a tracked tank; SMOKE shows with smoke launchers alone; `KeyR` doesn't zero the sight; a click while pointer-locked never toggles a part; FIRE-drag turns the turret; a view drag aims; the sight changes FOV and back while World and MSL markers keep their screen positions (`metresPerPixelAt` consistent); the reload ring draws; pointer-lock fallback without lock; Esc opens the menu once; console clean (`App.frame` swallows exceptions). `rwr-hud.mjs` still passes. HUD ops counted (≤ 120). |
| **3G Ground Battle** | `js/gmode.js` (with `GROUND_STOCK`, critic); mp.js (§16.3 row 58); mpui.js; net.js; index.html mp screens (including, critic, the **Practice battle** button, calling `GroundAI.startBattle`); css "MP: ground" | §10 entire | `GroundMode` (own), the template keys (3I), `Flight.start` opts (P1), `Armour`/`Aim` net helpers | `test/gmode.test.js`: capture rates, contest, bleed, deaths by cost, time and wipe results, Runway arena, placement slots on pads. `mp.test.js` additions: settings validation (forged values rejected); `kindsFor`; `obj`/`spot` refused from non-hosts; `seen` from a non-enemy ignored; `shot` k 'shell' with an unknown `sh` dropped; spawn rows with mm; pv rows for rings; `battleDesign` ground fallback by `bd.key` (critic: the existing `bd.name` checks at `mp.test.js:111-115` unchanged and passing); an aircraft design accepted at respawn with air support and refused without it; a carrier `spawnId` left from an air game gives no bonus and no carrier limits in a ground game; ticket loss priced by the host from the spawn rows (a forged `set cost` is ignored); other players' wrecks survive our own respawn; `MP.host(mode, transport, settings)`; the air battle path byte-identical (a full air-game state trace before/after). `test/browser/ground-battle.mjs`: two tabs, local transport, create ground battle → build → `MP.advance()` to battle; both spawn on their pads; a scripted shell from A penetrates B (list and m arrive; B's crew damage applies); B knocked out leaves a wreck on A's screen; tickets drop by cost; B respawns; A captures C; finish on tickets; results; byte counters logged. |
| **3H Single player & AI** | `js/groundai.js`; combat.js `frame` (rest of row 38), `aiDown`, `drawHUD` skip; main.js `App.launch` placement; career.js mission | §11 entire | `Aim.step`, `Aim.sees`, `Armour`, `GroundMode`, `TEMPLATES` | `test/groundai.test.js`: AI never fires in Practice; engages within 1.2 km with LOS and not without; smoke blocks it; stays on terrain and out of water over 120 s; ≤ 60 surfaceAt/s per AI (counted); a hostile wave fights to a KO in a headless 120 s sim; respawn timers; none exist in a room; the old range and fighters unchanged for planes (`combat.json`). Hostile gates: a driving TK-34 draws no AA, SAM or fighter; a driving buggy still does (today's quirk pinned now). |
| **3I Templates & balance** | builder.js `TEMPLATES` (16 entries after the jets), template paints (critic: `GROUND_STOCK` is 3G's, in gmode.js) | §12 | everything | `core.test.js`: every ground template fully joined, clash-free, ring not jammed, within its tier money, drives ≥ 10 km/h on the runway. Re-baseline fingerprint, traces and mp-measure: **additions only** (every existing key byte-identical, checked by a script that diffs keys). A new `groundcombat.json` fingerprint in combat.test.js: body boxes, muzzles at ψ 0 and 90°, shell launch vectors, `hitAll` outcomes of 24 fixed rays per template, `m` rows of a fixed shot. |

**Conflict rules.** main.js functions split: 3F (showHelp, tip, and the Settings dialog rows), 3H (`App.launch`), P1 (the overlay line). flight.js belongs to 3F only (3H uses the P1 stepping, `revert` and `onDestroyed` hooks). mp.js belongs to 3G only (2B finished `sendHits`/`onHit` in Phase 2). (critic) world.js (the `Settings` defaults, row 67) belongs to 3F.

(critic) **Merge order, Phase 3:** 3I first, because 3G's fallback, 3H's AI and their tests load the stock templates. Then 3G before 3F (the HUD reads `GroundMode.obj()`) and **3G before 3H**: the Practice Battle runs `GroundMode`'s rules, and its tests are only meaningful against the real ones.

#### Phase 4: integration, adversarial review, measurement, docs (serial, then a review swarm)

1. **Merge and run.** `node test/run.mjs --browser`. Screenshots: HUD on all four sizes, the builder on a phone, a battle.
2. **Performance:** §14 scenes with the repointed harness; before/after tables.
3. **Adversarial review** (the loop that found the attach system's 22 bugs). Independent reviewers write repro scripts that try to break:
   - old saves and designs: traces, `driving.json`, a car with an old turret, a plane with turretL on the ground, old design codes;
   - gating: counter stubs on every old template, Hostile cars;
   - armour edge cases: grazing shots, θ near 90°, a shell spawning inside a hull, nested and jammed rings, a turned ghost turret;
   - peers: forged `obj`, `slot`, `seen`, `m` rows, `shot k 'shell'`, pv rows for a non-ring part, NaN everywhere;
   - battery: a long autocannon stream over hills, 5 AI;
   - phone layouts;
   - (critic) what you see is what you hit: shots at targets beside a berm and over a crest at 300, 800 and 1,400 m in the gunner sight, comparing the drawn impact with where the shell actually landed (screenshots); SPAA shells against an old plane; the R, Y and Esc keys under pointer lock; a Practice Battle revert keeping its AI.

   A sceptic re-runs each repro. Then fix and verify.
4. **Chores, in the same commit series:**
   - **README:**
     - What's in it: Ground update, Ground Battle, Tank Range.
     - Counts: 328 parts in twenty-one categories, 327 in the tray; 51 examples; 30 paints; missions +1.
     - "Battles are for planes, helicopters and cars" becomes the two games. The turret-on-cars line. The Controls table block. Project layout lines for the 6 files.
   - **The three control lists** (README, `showHelp`, `controlsHelp`), plus the tip and hints.
   - **Handbook:**
     - §2 running gear, suspension, collisions, kinematic AI.
     - §3 group transforms, belt scroll, aim camera, TANH/setFov, capture rings; the §3.7 table gains tracks, turrets and smoke in 2D and 3D.
     - §4 armour, shells, modules, SPAA, SAMs, ATGMs, smoke, the legacy table.
     - §5 Ground Battle, `obj`, `seen`/`spot`, `m` rows, shell shots, wrecks.
     - §6 "New in PR #38" for every suite.
     - §7 loose ends: the car AA quirk, no scenery cover, wading only, far terrain coarse in the sight; (critic) outside the arenas the drawn ground still drops the 40 m and 160 m detail that physics keeps (driving a tank elsewhere in sandbox can show it floating or sunk by a metre or two); the 2D fallback can't show off-track ground battles.
     - §5.8 citations fixed (showHelp `main.js:312-330`, controlsHelp `flight.js:481-501`).
   - **CLAUDE.md:** architecture-table rows for the 6 files; counts (328 parts, 51 templates); history row #38: "Ground update: the Armour kind, tracks and skid steering with suspension, turrets that follow your aim, mm armour with crew and modules, SPAA, SAMs, ATGMs and rocket artillery, Ground Battle on Highland Ridge, the Tank Range and a Practice Battle, the phone-first ground HUD".
   - **sw.js:** `overbuilt-v24` plus 6 SHELL entries (each must exist).
   - **net.js:** NET_VERSION 7 with its reason.
   - **test/README.md:** rows for `driving`, `ground.test`, `armour.test`, `aim.test`, `gmode.test`, `groundai.test`, `builder-tank`, `ground-hud` and `ground-battle`.
5. **The PR** (never merged by us), with:
   - what's in it, by area;
   - what the review fixed;
   - tests run, with results;
   - tables: per-template top speed, hp/t, armour and price; before/after performance; the arena line-of-sight table.

### 16.5 Order and parallelism at a glance

```
Phase 0  WP0 ─────────────► (driving.json, arena probe, bench)
Phase 1  WP1 ─────────────► (hooks, defs, save path, arena data, stubs, contract tests)
Phase 2  2A ─┐ 2B ─┐ 2C ─┐ 2D ─┐ 2E ─┐    (disjoint files/functions; stubs let each test alone)
Phase 3  3F ─┐ 3G ─┐ 3H ─┐ 3I ─┐          (3I can start on rows after 2A+2D; prices are fixed now)
Phase 4  integrate → review swarm → fix → measure → docs → PR
```

**Merge order.**
- Within Phase 2: 2B before 2C, because both touch combat.js in disjoint functions; 2C rebases. 2A and 2D in any order. (critic) **2E last**, after 2A, 2B, 2C and 2D: its stats and its six-tap test need the real `Gear.stats`, `Armour.summary`, `Aim.sweep` and the real clash outlines.
- Within Phase 3: (critic) 3I first (the stock templates the others' tests load); then 3G before 3F, because the HUD reads `GroundMode.obj()`; and 3G before 3H, because the Practice Battle runs `GroundMode`'s rules.
- After each merge, the full headless run must show only the documented additions.
