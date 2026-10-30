# Overbuilt: working notes for Claude

A free browser game: build any machine from parts, then take it anywhere. It mixes the rocketry of Spaceflight Simulator and Kerbal Space Program, the free-form building of SimplePlanes and the combat of War Thunder. Today you build rockets, planes, cars, helicopters and Armour (tanks, tank destroyers, armoured cars, SPAA, missile carriers, rocket artillery, SAM launchers) from parts on a 2D blueprint or in 3D; ships and sci-fi craft are planned, which is why the name is not about any one vehicle. You then fly or drive them in a full 3D world: the real Earth at 1/20 scale with the space centre on the Faroe Islands, plus a small solar system. It has weapons, AI targets, computer-driven tanks and damage, armour that shells meet plate by plate, and online multiplayer (a sandbox, air battles and ground battles over capture zones on Highland Ridge in North Scotland). It is plain JavaScript and three.js, with **no build step and no modules**. It runs from `index.html`, on desktop and phones.

- **Live:** https://devwolf11.github.io/Overbuilt/ (GitHub Pages, deployed from `main` on every push).
- **Repo:** `DevWolf11/Overbuilt`. It was renamed twice (`Cam-Strike` → `Rocket-Science-Simulator` → `Overbuilt`), so local clones and some session settings still use an old name (see Gotchas).
- **Deep reference:** `docs/HANDBOOK.md` covers every subsystem: data model, physics, rendering, combat, multiplayer, app shell, and where things live by `file:line`. Read the chapter for the area you are about to change before changing it.
- **Tests:** `test/README.md`. Run `node test/run.mjs` (about a minute) before every push, and add `--browser` (about a quarter of an hour more) when you touch the builder, rendering, the HUD or multiplayer.

## The owner and how to work with them

- **How they ask.** They write short, informal, fast requests, often with typos ("truster", "cust0omized") and several features in one message. Read for intent, deliver every part, and list the assumptions you made at the end of your reply. Ask only when two readings would lead to very different work.
- **Ambitious updates.** They think in "updates": "a plane update", "a military update", "the biggest update yet: multiplayer". They expect the whole thing, polished, tested and documented, not a first slice. Break big work into phases, but ship it complete.
- **Fun beats realism when the two conflict.** "Make them more realistically controllable but keep the unprofessional chaos." There is a secret settings menu of joke options (tap the Options title seven times), including the old camera bug, because "people thought it was funny". Don't sand the personality off.
- **Control comes first.** When a safety system made planes harder to fly (a g-limiter), they asked for the old controls back with only the breakage fixed. Overspeed was a warning only until they asked for wings to break at speed again, at much higher limits (PR #32): it warns from 90% of the limit and tears a wing within seconds past it (at once past 1.3×). Prefer warnings over taking control away from the player.
- **They test on a phone in portrait and on a desktop.** They send screenshots of bugs. The phone layout matters as much as the desktop one.
- **Real aircraft get altered names.** Their rule: "as close as real ones but keep the names something different" (Sugoi for Sukhoi, MyG for MiG, FS-16 for F-16). Shapes and performance follow the real jet; player-visible text (part and paint names, blurbs, descriptions, HUD labels) never uses a real designation or nickname (no AL-31F, R-77, Raptor, Flanker). Comments in code may.
- **Things they notice:** stutters and FPS, visual bugs (floating parts, wrong colours), handling (drift, loss of control), and anything that makes old designs behave differently.
- **Merging:** they merge PRs themselves and say "merged" or "done". Never merge. After a merge, start follow-up work fresh from `main` on a new PR.
- **Replies:** detailed, with opinions and some personality, in plain language about what the player will see and feel. No filler.

## Workflow

1. **Understand first.** Read the handbook chapter and the code you'll touch. On large features, earlier sessions did best with this loop: map the affected code → implement → **adversarial review** (independent reviewers write repro scripts that try to break the change; a sceptic re-runs each one) → fix → verify. The attach system's review found 22 real bugs this way.
2. **Keep old saves and designs working exactly as before.** This is the rule most easily broken; see Invariants.
3. **Test.** Run `node test/run.mjs`; it should be identical to the baselines unless the change is meant to move them.
   - If it is: inspect the diff and re-baseline with `node test/run.mjs <suite> --update` (without a suite name it rewrites every baseline), saying why in the commit.
   - Add checks for new behaviour (`test/README.md` explains how).
   - For anything visual, take Playwright screenshots (software WebGL works headless; see `test/lib/browser.mjs`) and look at them.
   - Check the console for errors: `App.frame` swallows exceptions, so a broken feature can fail silently every frame.
4. **Do the chores in the same commit as the change:**
   - **README.md:** every user-visible feature, control or part change. Keep the counts in its prose right.
   - **Controls:** keep them in sync in three places: README's table (with its "Armour and armed cars" block), `App.showHelp` (js/main.js) and `Flight.controlsHelp` (js/flight.js, with `groundHelp` and `driveHelp` for ground vehicles).
   - **sw.js:** bump `CACHE` (`overbuilt-vN`) on any change to cached files, and add new files to `SHELL`. Every `SHELL` entry must exist, or the offline install silently fails.
   - **A new js file:** a `<script>` tag in `index.html` in dependency order, a `SHELL` entry, and a README "Project layout" line.
5. **Commits and PRs.**
   - Commit subject: `Area: what changed, in player terms` (e.g. "Plane handling: coordinated turns, no fishtailing, no stall-outs in climbs"), then a prose body.
   - PR bodies: what's in it (by area), what the review fixed, tests run with results, and tables where they help. Tables of before/after numbers have gone down well.

## Architecture in one screen

Plain `<script>` files share one global scope. They load in this order (index.html:374-401):

| File | Owns |
|---|---|
| `util.js` | maths (vectors, quaternions), `fmt`, `store` (localStorage JSON), `$`, `el`, the `Silly` joke flags |
| `space.js` | bodies, Kepler orbits, patched conics, sites (pad, runway, airfields, carriers), the 2D terrain profile |
| `terrain.js` | `Terrain`: the 3D ground (real Earth map or generated), shared by physics and renderer |
| `props.js` | `Props`: the battlefields' solid scenery (Highland Ridge's village, farms, woods, walls and roads, the Runway's sheds and sandbags, the island's tank yard and hamlet), laid out from fixed seeds a slice at a time; colliders in a hash grid that shells, sight lines, vehicles and the AI meet; crushing; the pieces render3d draws |
| `parts.js` | `PARTS` catalogue (328 parts, 71 of them the ground update's `def.gv` ones; `def.retired` ones load but leave the tray), the vehicle kinds (`VEHICLE_KINDS`, `GROUND_KINDS`), geometry, joints (`buildAdjacency`), staging, Δv, design rows, armour thickness (`cleanMm`, `massPerMm`), paint (`SKINS`), all 2D part drawing (the armour's too: `gvDraw`, X-ray, the armour view) |
| `vessel.js` | `Vessel`: the rigid-body simulation (engines, wings in halves, aero, heat, chutes, wheels, ground and water, splitting, autopilot); hands vessels with running gear to `Gear` |
| `gear.js` | `Gear`: running gear for ground vehicles (tracks and armoured wheels, suspension, skid steering, wading, righting), collisions between vehicles, and the builder's driving numbers |
| `aim.js` | `Aim`: turret groups and poses, traverse and depression limits, the aim step, ballistics, firing tank guns, autocannons and launchers, radars and locks, ATGM and SAM guidance, smoke, line of sight |
| `armour.js` | `SHELLS`, `Armour`: shells in flight, hit geometry, penetration, ricochets, screens and reactive bricks, crew and modules, cook-offs, fires, knock-outs, repairs, HE and old weapons against plate |
| `ui.js`, `world.js` | dialogs, toasts and icons; `Settings`, `FX` particles, the 2D fallback flight view |
| `parts3d.js`, `render3d.js` | 3D part models; the three.js renderer for flight, hangar and globe (three.js is lazy-loaded) |
| `audio.js`, `career.js`, `map.js`, `globe.js` | procedural sound; career and missions; solar-system map; globe map |
| `combat.js` | weapons, projectiles, missile guidance and countermeasures, damage, target range, AI fighters |
| `gmode.js` | `GroundMode`, `GROUND_STOCK`: the Ground Battle's rules, pure (arenas, spawn slots, zone capture, tickets, deaths, the result), shared by a room's host and the Practice Battle |
| `groundai.js` | `GroundAI`: computer-driven ground vehicles, the Tank Range and the Practice Battle |
| `builder.js` | `TEMPLATES` (51 example craft, 15 of them Armour); `Builder`, the build screen (2D and 3D, attach system, symmetry, depth, paint, hangar, codes) |
| `flight.js` | `Flight`: flight loop, time warp and rails, controls, HUD, camera, saving, staging, breakage |
| `net.js`, `mp.js`, `mpui.js` | multiplayer: transport (PeerJS or BroadcastChannel), host relay, sessions, air and ground battles, ghosts, hits, wrecks, spotting; the screens and the Respawn panel |
| `ghud.js` | `GHUD`: the ground-combat HUD (the aim ray, crosshair and gun reticle, hit results, damage diagram, radar scope, minimap, tactical map, spotting by hand, touch controls) |
| `main.js` | `App`: screens, main loop, settings dialog, service worker |

**Coordinates (memorise these).** Part space is the builder's.
- Rockets: y up, x across the blueprint, z depth toward the viewer.
- Planes: **+y = nose, +x = down, +z = right wing**. The 2D blueprint is a side view from +z.
- Cars and Armour (kind `tank`): +x forward, +y up, +z to the right. Aimed parts (guns, launchers) fire along their own +y, so on a ground vehicle they go on at rot 3, and a gun pivots on its trunnion (`aim.pivot` up from its breech) in yaw and elevation.
- `p.z` is a part's depth. A *twin* part (`def.twinZ`) is one part drawn as a pair at ±z. Wings, legs and fins are locked at z = 0.
- `p.att` is the part it hangs on: an **id** in memory and in flight saves (`rss.flight`), an **index** in design rows (`rss.design`, the hangar, design codes), and the owner's id in multiplayer spawn rows.
- In the sim, game east is decreasing angle and game north is −z.

## Invariants (break these and something old silently changes)

- **Old designs must load, join, fly, heat, take damage and look exactly as before.**
  - Twin pairs saved before depth existed keep the old rules:
    - `legacyTwin` (parts.js: no `att`, at the default spread within 5e-4) drives `partsClash` and `partsTouch`; `designRows`, parts3d.js and combat.js (a pair at its default spread blasts once, at the centre) use the same 5e-4 test.
    - `pylonLink`, `guessHost` and `oldStruts` treat *any* twin with no `att` the old way, at any spread.
    - Heating (vessel.js) counts a pair's distance from its default spread, so a pair at the default spread heats as if on the centre line.
  - `test/traces.js`, `fingerprint.js`, `combat.test.js` and `driving.js` exist to prove you kept this.
- **The ground update's code is shut for old designs.** Every hook opens only for a part with `def.gv`, a vessel with `v.gv` or running gear (`v.gear.length`), the `tank` kind, a live ground AI (`Combat.S.gai`) or a ground battle (`MP.ground`). `test/ground.test.js` counts calls into `Gear`, `Aim`, `Armour`, `GroundMode` and `GroundAI` for the old templates: they must stay at zero. `Gear.ground` copies vessel.js's crash, dent, landing and rest rules line for line: change both. An air battle's state is pinned step by step by `test/baseline/mp-air.json`.
- **A ground part's outline is its art, its clash shape, its 3D prism and its hit prism at once**, and its edge order is what `armour.edge` indexes: an outline change moves every plate's angle and every stock vehicle's balance. Never change a ground part's key, `w`/`h`, outline or default `mm` either.
- **Never change an existing part's key, `w`/`h`, `twinZ` or z-lock.** Saves store absolute positions and omit default depths. Add a new part instead.
- **Sanitise everything loaded or received:**
  - `partsFromDesign`, `cleanZ`, `cleanSkin`, `cleanAtt`, `hasOwn(PARTS, …)`;
  - `mpSpawnRows` for peers (and `cleanMm` for armour thickness, their tenth column);
  - `Vessel.restore` for saves (`gvLoad` for the ground parts' fields).
  - Peers are untrusted. Never put peer text into `innerHTML`; `UI.modal` renders a string body as HTML.
- **Multiplayer:**
  - Bump `NET_VERSION` (net.js) when an older peer would build, pose or hit a different craft.
  - Damage to another player's craft goes through `MP.sendHit(s)`; `Combat.damage` is a no-op on `v.remote`.
  - AI, range targets and auto-flares are off in any room.
- **Props are deterministic and solid** (props.js, handbook §8.14). Each map's layout comes from its seed and the physics' ground alone, never the quality setting or the camera, and what is drawn is what shells, sight lines and vehicles meet. Old weapons' shots and old vessels never reach Props (`ground.test.js` counts its calls); keep-outs hold the runway, causeway, pads, zones' middles and the AI's spots clear. A layout change changes what an older peer would hit: bump `NET_VERSION`.
- **No `import`/`export`, no `type="module"`, and no `fetch` of local files that the game can't do without.** It must run from `file://`; only the Earth map may fail there, and it falls back to generated terrain.
- **Top-level names are global across files.** A duplicate `const` kills every later script. Check with `grep -n "^const NAME\|^function NAME" js/*.js`.
- **2D and 3D must agree.** Plumes, sky colours, clouds in the flight plane, the space-centre layout, the reentry sheath and paint stripes are implemented twice (handbook §3.7 has the table). For shapes built by parts3d's lathe or extrude recipes, the 2D outline (`partPath0`) is also the 3D silhouette unless parts3d has a `PROFILE` for it. Other recipes build from the def and use the 2D art only as a texture.
- **The renderer uses a logarithmic depth buffer:**
  - custom shaders need the log-depth chunks;
  - `polygonOffset` does nothing, so use `depthBias`;
  - put content relative to `F.camAbs` (floating origin).

## Gotchas

- **The repo renames.** Pushes to an old name print "This repository moved" (harmless). GitHub tools and PR subscriptions need the **current** name `DevWolf11/Overbuilt`: with an old name, PR watching reports "the Claude GitHub App isn't installed" even though it is. Fix the remote with `git remote set-url origin https://github.com/DevWolf11/Overbuilt.git`.
- **Old names that stay on purpose.** The `rss.` localStorage keys, the `RSS1.`/`RSS2.`/`RSS3.` design-code prefixes (RSS3 only for a design with armour thickness dialled), `RSS_NO_SW` and the `rss-room-` multiplayer prefix date from "Rocket Science Simulator". Renaming them would orphan players' saves and break codes people have shared; the only one players ever see is the start of a design code.
- **`main` is live** the moment it is pushed or merged. Pages publishes the whole checkout, `test/` and `docs/` included.
- **Useful console handles:**
  - `App`, `Builder`, `Flight`, `Render3D.info()`, `Combat.S`
  - `MP.state`, `MP.advance()` (the host skips a battle phase), `Net.pings`
  - `Gear`, `Aim`, `Armour`, `GroundMode.obj()`, `GroundAI.battle`/`.range`/`.ai`, `GHUD._S`, `Render3D.drawnGround(b, a, z)`
  - `Render3D.skipDraw = true` speeds up headless tests.
- **Headless Chromium runs the sim at about 0.08× real time** (software WebGL). A browser test must measure `Flight.time`, never the wall clock, or set `Render3D.skipDraw = true` when the picture doesn't matter.
- **What you see is what you hit, inside Highland Ridge only.** The arena's own ground mesh is built from the physics' heights; anything that changes the arena's ground (berms, pads, the detail fade) must pass `node test/tools/arena-probe.js`. The mesh is built only in ground play, so an old plane flying past pays nothing.
- **Test multiplayer locally:** two windows of one browser profile, transport "This device" (BroadcastChannel). Keep both visible, because a hidden tab stops sending.
- **Shared return values.** `Terrain.toGeo`, `Terrain.water`, `bodyPos`/`bodyVel` and render3d temporaries return shared objects; copy them before the next call.
- **`Vessel` call order.** Set `kind` before `rebuildGroups()`, and call `rebuildGroups()` after any change to `parts` or `adj`.
- **Drawing is on demand (PR #35).** `App.frame` only redraws a still view when it is stale (`App.stale`/`App.drew`, a 500 ms safety heartbeat). Code that changes what the hangar shows without player input must call `Builder.redraw()` (or go through `changed()`/`renderInfo()`); `test/browser/redraw.mjs` guards this. Physics must stay frame-rate independent: the 60 fps cap (`Settings.fps`) only skips frames.
- **Battery matters to the owner** (phones and tablets heat up). Don't add work that doesn't change what the player sees; measure CPU and GPU before and after (headless Chromium with the CDP profiler and WebGL call counts), and keep pictures byte-identical where possible.
- **Known loose ends:** handbook §7. The ground update has its own chapter: handbook §8.

## History (what has been built, PR by PR)

PRs #1-#10 were Cam-Strike, a 5v5 bomb-defusal FPS that the repo used to hold (its last commit is `30e7bc8`). Then:

| PR | What |
|---|---|
| #11-#13 | Orbit Forge, a 2D rocket game, renamed to Rocket Science Simulator; solar system, career, 40 parts, reentry heating |
| #14-#16 | 3D: groundwork, cars/planes/helis, then full 3D flight (depth, banking, part rotation, sound barrier); service worker loads new versions at once |
| #17 | Plane overhaul: wings through the fuselage, 54 aircraft parts, new flight model and autopilot |
| #18-#19 | Secret silly settings (the classic crash camera); the real Earth map, rivers, lakes, roads, cities, night lights; pylons for fuselage pods |
| #20 | Build in 3D on touch and mouse; builder fixes; phone layout |
| #21-#23 | Structural limits as warnings, stutter-free terrain streaming, lit cumulus, hangar saves, space centre on the Faroes, 3D globe map. Then, **at the owner's request**, the old pitch controls back (no g-limiter) and overspeed as a warning only |
| #24 | Military update: weapons, AI targets and fighters, damage, multi-select and copy/paste |
| #25 | Aircraft parts update: 46 new parts, five new designs |
| #26 | Multiplayer: rooms, sandbox, PvP battles, airfields and carriers, beatable missiles (energy, seekers, flares, chaff, notching, RWR), spectating |
| #27 | Plane handling: coordinated turns, no fishtailing, no stall-outs in climbs (fixed drift and loss of control) |
| #28-#29 | Attach system: free depth for every part; parts hang on wings and fuselages (several engines per wing, extra rockets anywhere); the grid became an optional 2D mode; paint per part, matchable to the body; all of it in 3D and in multiplayer |
| #30 | This test suite (`test/`) and the handbook (`docs/HANDBOOK.md`); the game renamed to **Overbuilt**, because it had outgrown rockets |
| #31 | A new icon for Overbuilt |
| #32 | Wings flutter apart past their own speed limits (equivalent airspeed, and Mach for subsonic wings), after a warning; the view shakes; AI fighters throttle back |
| #33-#34 | Online joining that survives a phone host looking away and says which step failed; big messages in pieces; a relay (TURN) account for school networks and a Test this network button |
| #35 | Battery: redraw only what changes (still screens, menus, pause), a 60 fps cap on touch devices, the same 3D picture with far less hidden pixel work, cheaper ground contact, sound and screen sleep when paused. Chaff Dispenser part, frigate radar SAM |
| #36 | Look-alike jets: ten fighters across four generations under altered names (MyG-21, FS-4, FS-16, MyG-29, FS-15, Sugoi-27, Sugoi-35, FS-22, FS-35, Sugoi-57), 96 parts with bodies lofted from cross-sections (2D = 3D), 13 paints (11 camouflage), internal missile bays with doors, flat and swivelling vectoring nozzles, an IRST ball; one price scale (all fit a $120k battle). The builder: part tabs by kind of craft (More for the rest), each jet's parts grouped, clashes on the 3D shapes (round, extruded, lofted) with parts sliding in onto curved hulls |
| #37 | Missile warnings as parts: a Basic RWR (a missile is coming) and an Advanced RWR (a threat scope, the missile's kind, time to impact and what to do); without one, no warning and no automatic countermeasures, only red MSL markers over missiles in sight (4 km). Heat seekers heard in multiplayer too. Turrets hold their fire on the ground or water; a manned Gun Turret replaces the small one in the tray. Stock military planes carry RWRs within their budgets; FS-22/FS-35 flares seated on the skin |
| #38 | Ground update: an Armour kind built from 71 parts in seven tabs (hulls, turrets, drive, guns, launchers, crew and ammo, kit), with armour dialled in 5 mm steps and placed crew seats and racks; sprung tracks with skid steering, wading and collisions; aim-where-you-look turrets and a gunner's sight (Arcade and Realistic aim); 37 kinds of round that bounce, overmatch or go through, crews and modules that break, cook off and get mended; SPAA, radar and IR SAMs, wire-guided and top-attack missiles, rocket artillery, smoke; Highland Ridge with its own ground mesh; the Tank Range, a Practice Battle against computer tanks and the Ground Battle mode (zones, tickets, respawns, wrecks, spotting); fifteen stock vehicles and the Desert Technical; `NET_VERSION` 7 |
