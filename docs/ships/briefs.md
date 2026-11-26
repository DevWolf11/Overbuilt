# Work-package briefs as sent (for re-launching)

## Ships WP0: the contract commit

You are implementing WP0 ("the contract") of Overbuilt's ships update. Repo: your worktree of DevWolf11/Overbuilt; it should be at branch ccr-932b9082-m4kox7's tip, 71c3af7 (if not, `git merge --ff-only ccr-932b9082-m4kox7`). CLAUDE.md's rules apply in full (old designs byte-identical, no modules, duplicate-global check, sanitising, chores).

The design spec: /home/user/ships-notes/SPEC.md (also code maps map-physics.md, map-combat.md, map-builder.md beside it). Read §0, §2, §3, §6.1 and §6.3 (the slice parts' fields), §7 (cyclon), §13 (hooks), §14, §16 "Phase 0: WP0" and "The Ship API" closely; skim the rest so your stubs fit. Where the spec and the code disagree, the code wins: adapt and note it.

Build exactly WP0:
- js/ship.js: handbook-style header comment, the `// ==== core|waves|builder|damage|combat|hud|ai|mp ====` sections, `SHIP` with every tuning number the spec gives (grouped and commented), and the WHOLE `Ship` API as stubs with the signatures and default return shapes of §16 (no-ops), plus a per-vessel `v.sh` layout comment. `Ship.groups(v)` may build the real `v.sh` skeleton (rings in part space from shullOf, comps per hull part, thrust/foils/rudders lists) since later packages read it; no forces yet.
- parts.js: SEA_KINDS/isSea, VEHICLE_KINDS.ship, the 5 tabs inserted before radar (category count 26 → 31; check every test/slice that depends on tab indices), `shullOf` + `shullPts` (pure, cached per def; the sampler as §3.2 says), def fields documented, the slice-1 parts hbBowM, hbMidM, hbSternM, bridgeM, dieselM, screwM, rudderM as data (with `gv: true, ship: true`, shull on hulls; art may be simple boxes or the shull outline for now: WP2 does real art). Region markers (`// ==== shHull ====` etc.) for later packages.
- vessel.js: constructor defaults (hydro, sh, hF, hT, ciws), PILOT.ship, rebuildGroups (aircraft excludes ship; ciws; hydro → Ship.groups), computeHull's shullPts branch, splitComponents' hydroFrom. Nothing that changes any non-hull vessel.
- builder.js: the `cyclon` template in its slice form (§16 WP0) inside the TEMPLATES literal, ship kind button wiring only as far as needed for the template to load/launch without errors (the full builder is WP4).
- index.html script tag after drone.js + kind button; sw.js SHELL + 'js/ship.js', CACHE 'overbuilt-v41'; ui.js ICONS.ship; style.css 7-column kind strip.
- tests: test/lib/game.js loads ship.js and exports Ship, SHIP, SEA_KINDS, isSea, shullOf (+ a `ship: false` option like `drone: false`); ground.test SYSTEMS += 'Ship', category counts, the new defaults in "old vessels carry the new fields' defaults"; catalogue counts; core.test template-order rule rewritten (ground block, then ships); new template keys in fingerprint/traces only (re-baseline only those suites with --update and PROVE with `node test/tools/keydiff.mjs 71c3af7 --add <suite>:<key>,...` that only the cyclon keys were added and nothing moved). Read test/README.md for how.
- Check duplicates: grep -n "^const NAME\|^function NAME" js/*.js for every new global.

Done-criteria: `node test/run.mjs` all green; keydiff shows only added cyclon keys; ground.test's zero-call contract holds with 'Ship' in SYSTEMS; the game loads in headless Chromium with no console errors (a quick Playwright check: open index.html, open the builder, pick the Ship kind, load the cyclon, launch it: it may sit on the old solid sea for now, that's expected; no exceptions in App.frame — check console and pageerror). Then run the browser suites builder-shapes.mjs and controls.mjs and fix anything you broke.

Commit in your worktree branch with a subject like "Ships: the ship kind, the Ship module's contract and the first hull parts" and a prose body, ending with these two lines exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019sDgipUc8ms82QNRTPgYyT
Do not push. Do not edit CLAUDE.md or README yet (docs come at the end). Report: the commit id, your worktree path and branch, what you changed per file, every spec deviation and why, test results (suite counts), and anything the later packages must know.

## Ships WP1: hydro core physics

Read /home/user/ships-notes/BRIEF-common.md first and follow it. Your package: **WP1 Hydro core** of the ships update (spec §4 physics in full, §5.1 the wave function, §4.8 grounding, §4.10 sleeping/rails/warp, §16 WP1 row).

You own: ship.js `core` and `waves` sections; the vessel.js hooks in physicsStep (Ship.pre, Ship.forces, the hF/hT integration and added mass), turnTarget's ship line, ground()'s hydro probe gate (the probe meets the sea bed for hydro vessels; one copy of the crash/rest rules), splitComponents; flight.js `update`'s far list, `stepsNear`, `physicsTick`, `canRails`, `railsAdvance` (NOT `start`: WP3 adds Ship.launch there; but you implement `Ship.launch(v, place)`/`seaPlace` in ship.js core so a ship is set floating at her marks); combat.js `frame`'s `S.sea` gate and the `Ship.frame` call.

Implement: ring-by-ring buoyancy against the wave-sloped plane, friction + wave-making resistance, lateral hull force, strip planing lift, foils (rudders) in their own routine at water density (never the wing code), screws from shaft power of any def.engine, the helm in Ship.pre (telegraph Stop/Slow/Half/Full/Flank and astern, rudder with return/hold heading; inputs as the spec's §4.6 / §12.3 describe — expose a clean input interface WP3's keys will drive, e.g. v.sh.tel/rud/hold set by Ship.keys or flight controls; until WP3 lands, test through the interface), added mass by acceleration scaling, clamped damping, grounding on the bed, `afloat` state (separate from `splashed`), sleeping/moored ships, warp, far ships, pieces of a hydro vessel sinking, and Ship.wave (4 directional sines, sea states Calm/Moderate/Rough, shallow fade, lakes zero) + waveUniforms agreeing with it within 1 mm.

The slice ship is the `cyclon` template (WP0 placed it; it's light at 57 t vs a 110 t design: you may add ballast/weight via existing parts to its template only if needed for the slice to sit at sensible marks, and you may adjust slice part numbers in parts.js data for the 7 slice parts if physics demands — report each change; WP5 owns the final catalogue). Its fingerprint/traces/mp-measure keys will move with real physics: that's expected (only cyclon's).

Tests: create test/ships.test.js (add it to test/run.mjs's suite list) with §17.1 *hydro* and *waves* sections and the WP1 row: analytic box hull draft ±1 %, GM ±3 %, roll period ±15 %, settles, waves deterministic and Hs per state ±10 %, no NaN/runaway in 600 s of Rough sea stopped and at full speed, grounding at 10 kn stops her without blowing up, moored/warp, far AI not railed, pieces sink; the cyclon reaches about 30 kn, turns, holds heading. ground.test zero calls must still hold; driving.json's `buggy sea` and `buggy headland`, death.test A7/B3 identical (the solid sea for every non-hydro craft). Measure Ship.forces cost (spec §15 budget).

Done when: the slice ship floats at her marks, steams at ~30 kn, turns and heels, holds heading, rides the swell, runs aground without exploding, and every old baseline is identical.

## Ships WP2: the drawn sea and hulls

Read /home/user/ships-notes/BRIEF-common.md first and follow it. Your package: **WP2 Sea rendering** of the ships update (spec §5.2 rendering agreement, §5.3 wake/spray/smoke, §3.2 the 2D/3D hull, §12.6 models, §15 budgets, §16 WP2 row). Read CLAUDE.md's renderer gotchas carefully (log depth buffer chunks, depthBias, floating origin F.camAbs, patchFog/obFog for custom shaders, the sky light, background jobs and jobLate, S.engine flashes, battery).

You own: render3d.js (the swell patch round the camera, shown only while a hydro vessel is within 2 km; the ocean cut under it by a UV-hole uniform; wake ribbons; bow spray via FX; funnel smoke; the aim camera's reach for ships), parts3d.js `BUILD.shipHull` (loft the shullOf rings; vertex colours, no texture: grey above a black boot-top, antifouling red below; + screw spin and rudder deflection animation for the slice parts), parts.js's shullPath/shullDraw region (proper 2D art: plating, boot-top band, antifouling, deck edge, weld seams, hawse pipe) and the clashShape loft line + PART_RECIPE.shull = 'shipHull', and ship.js `fx`. Models for the other slice parts (bridgeM, dieselM, screwM, rudderM) look right in 2D and 3D.

The wave function: `Ship.wave(e, n, t, out)` and `Ship.waveUniforms(...)` are WP1's (being written in parallel). Code against the API in the spec (§5.1-5.2: 4 directional sines, sea states, shallow fade, the same constants on the GPU). Until WP1 lands, implement your shader from the spec's formula and a local test copy of the constants; write a check (browser or node) that the GPU displacement equals Ship.wave's within 1 mm for given uniforms so the lead can run it after merging. Read v.sh fields (tel, rud) and p.rpm/p.rud defensively (may be undefined).

Critical: with no hydro vessel near, every old scene must render byte-identically and cost the same (test/browser/graphics.mjs old scenes identical; water.mjs; render-bench old scenes within ±2 %). Phone Low budget: swell GPU ≤ +5 % over the flat sea (sea300). Add bench scenes `seaRough` (no ship near: proves the swell is off) and `shipnear` (chase on a small hull at speed) to test/bench/render-bench.mjs. builder-shapes.mjs must pass for the slice parts (model within tolerance of its clash shape).

Done when: the swell near a ship looks right and agrees with the wave function, wakes and spray look right, the slice hull looks right in 2D and 3D (screenshots at 1280×720 and 390×844, looked at), and old scenes are unchanged.

## Ships WP3: helm, HUD, launch

Read /home/user/ships-notes/BRIEF-common.md first and follow it. Your package: **WP3 Helm, HUD and launch** of the ships update (spec §4.6 the helm's inputs, §4.11 launch, §12.1-12.4 HUD/camera/keys/touch, the knots rule, §16 WP3 row). Read CLAUDE.md's Controls chore rule carefully (KEY_ACTIONS is the source of truth; Keys.is/Keys.held; words from Keys.k; README table, App.showHelp and Flight.controlsHelp kept in sync — but README is end-of-update docs, so keep App.showHelp and Flight's help in sync now and list the README rows you'd add in your report) and the zoomed-HUD gotcha (Controls.z).

You own: flight.js `start` (ship name, yaw (bow out to sea), sas, calling `Ship.launch(v, place)`), `groundTick` (aim-mode gate widened to sea kinds so turrets aim on ships as on tanks), `readControls` ship keys, the `updateHUD` call to `Ship.hud(F)`, controlsHelp/shipHelp, death words, knots on ship displays; controls.js: a `Ships` group in KEY_ACTIONS (telegraph up/down, rudder port/starboard, hold heading, etc. with sensible defaults W/S/A/D like a car; check clashes), `clash`, `LATE`, `CTL`, keyHints, and the touch controls for a ship on a phone in portrait (telegraph lever + rudder; reuse existing patterns); main.js help, tip, and a Settings "Sea" (sea state: Calm / Moderate / Rough → Ship.setSea); ship.js `hud` section (the helm panel: telegraph order, rudder angle, speed in knots, heading); style.css for the ship HUD; space.js `EARTH.spawns` sea entries (the bay, the headland slipway, Shetland harbour, off the carriers; check depth along a ship's length); mpui.js `Spawns.place` sea branch.

The physics is WP1's (in parallel). Drive it through `v.sh.tel`, `v.sh.rud`, `v.sh.hold` (and `Ship.keys(F, e, down)` if you route keys through ship.js) as the spec says; agree the interface from the spec's §4.6 and implement your side; if WP1 hasn't landed, Ship.pre is a no-op stub and the ship won't move yet: test your inputs by reading v.sh values. `Ship.launch` is WP1's: call it; it's a stub now.

Tests: controls.mjs (the ship HUD at all its sizes 360×640 to 1920×1080, desktop key hints and phone touch), spawns.test (sea spots: depth > draft + 2 m along each ship), a new test/browser/ship-flight.mjs (launch the cyclon at the bay; telegraph and rudder set v.sh; HUD shows; help lists the keys; console clean). Screenshots of the phone portrait and desktop HUD, looked at.

Done when: you can launch at the bay (and the other sea spots) and give helm orders with keys and with a phone's touch controls; the help lists the keys; nothing overlaps on a phone.

## Ships WP4: builder basics

Read /home/user/ships-notes/BRIEF-common.md first and follow it. Your package: **WP4 Builder basics** of the ships update (spec §11.1 kind wiring, §11.2 placement for keel/deck/inside/stern, §11.3 numbers and warnings, §1 "Building", §16 WP4 row). Read CLAUDE.md's "Drawing is on demand" gotcha (Builder.redraw / changed / renderInfo) and the phone-layout notes.

You own: builder.js kind wiring (pickKind, mirrorOf, symKey, turnGroups, zText, defaultRot, the zoom floor so a 152 m hull fits a 360×640 phone (fitView/zoomAt), stats rows and statsData.ship, the blue waterline overlay at the draft and trim she'll float at, warnings dispatch, quickAdd for kind ship calling Ship.spotOf); ship.js `builder` section (`Ship.stats(parts)` pure: displacement, draft, GM, trim, ~top speed from power and hull, compartments; `Ship.hydrostatics`; `Ship.spotOf(type, parts, at)` for keel/deck/inside/stern placement: tapping hull segments adds them end to end, bow forward, stern aft; `Ship.warnings`: top-heavy GM < 0 will capsize, open stern/bow will flood, no screw or waterjet, no bridge, overloaded/sinks, etc.); index.html stat rows. Suppress the generic rocket staging warning ("No engine fires in stage 1") for ships.

Use shullOf (parts.js, WP0) for hydrostatics; the physics' numbers are WP1's (in parallel) — your static numbers must agree with the flight's draft ±10 %, GM ±0.15 m, top speed ±12 % once WP1 lands: write that check in test/ships.test.js §builder guarded so it runs once WP1's physics exists (or put it in a separate test file the lead can enable), and keep your formulas consistent with spec §4.2-4.5 (same water density, same resistance model).

Tests: a new test/browser/builder-ship.mjs (the kind strip with Ship, the Ship tabs, a quickAdd chain building a hull by taps, fit a 152 m hull at 360×640 and at 1280×720, stats and waterline shown, each warning fires), ships.test §builder (pure: stats, spotOf on an empty, a hulled and a full design). redraw.mjs: the waterline redraws on change. Screenshots looked at (phone portrait and desktop, 2D and 3D).

Done when: you can build the slice ship by tapping, see her waterline, displacement, draft, GM and speed, get sensible warnings, and launch.

## Find the background-job slice overrun

Regression hunt in Overbuilt (repo DevWolf11/Overbuilt). In your worktree first `git merge --ff-only ccr-932b9082-m4kox7` (tip fbeeb00). Read CLAUDE.md (especially "Background jobs keep to their slice (render3d runJobs)": a generator must check jobLate() inside its loops; lazy jobs; battery). Never push.

Symptom: test/browser/graphics.mjs's check "...and a 4 ms slice of the queue keeps to its time" (graphics.mjs ~line 142-156: a TK-34 at Highland Ridge's village, paused, then six `Render3D._t.runJobs(4)` slices; must stay under 10 ms) fails on the branch on a quiet machine in 2 of 2 runs (worst 10.0 ms on phone in one run, 10.5 ms on desktop in another; slices like [5.3, 4.2, 5.6, 10.5, 4.6, 4.1]). On main (71c3af7, a checkout is at /tmp/claude-0/-home-user-Overbuilt/0587f056-6c41-58cd-9f76-3deee688a95a/scratchpad/base-71c) it passes with worst 4.2-4.6 ms. So something added on the ships branch (js/ship.js, the swell/wakes/builderWater in render3d.js, parts3d.js shipHull, the sea-crash sinking code in render3d.js/death.js, career removal, WP3/WP4 changes) makes a background job overrun its slice, even in a flight with no ship.

Find it: instrument runJobs (which job, which step, how long) on both commits under the test's exact scenario (run graphics.mjs's section or a small Playwright script reproducing it), identify the job/step that now takes ~6 ms more in one unit, and fix it so it keeps to its slice (jobLate() inside its loop, split the work, or don't queue it at all when no ship is in play: old flights must not pay for ship work). Keep pictures identical (graphics.mjs's other checks, water.mjs). Then run graphics.mjs at least 3 times on your fix (all must pass, report the worst-slice numbers each time) and water.mjs once, plus `node test/run.mjs` (all green; quiet-ish machine). Commit ("Ships: <what>, so background work keeps to its slice again" or similar; prose body; ending with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019sDgipUc8ms82QNRTPgYyT
) and report: the cause (file:function), the fix, the before/after slice numbers, test results.

## Ships WP5: catalogue and ships

Read /home/user/ships-notes/BRIEF-common.md first and follow it. Your package: **WP5 Catalogue and non-combat ships** of the ships update (spec /home/user/ships-notes/SPEC.md: §6.1 hulls, §6.2 superstructure, §6.3 propulsion, §6.5 ship kit (non-weapon parts), §7 stock ships, §12.6 models, §16 WP5 row, §20 the every-kind-can-fight rule as a design constraint).

Phase 1 is merged on the branch: the hydro core (Ship.forces/pre/launch, waves), the drawn swell, wakes and the `shipHull` loft (parts3d BUILD.shipHull, parts.js shullPath/shullDraw), the helm/HUD/launch, the builder basics (Ship.stats/hydrostatics/spotOf/warnings). Read js/ship.js's header and sections, and the slice parts in parts.js's `// ==== shHull ====` region to follow their pattern.

You own: parts.js data regions shHull, shSuper, shDrive, shKit (non-weapon parts only; shArms is WP9's), their 2D art and 3D models (parts3d.js recipes for the new parts; hull segments use BUILD.shipHull), ship paints (SKINS entries: haze grey, navy blue-grey, a camouflage or two, a white patrol scheme); templates zodiak, cyclon (from the slice to its full unarmed-then-lightly-armed-with-EXISTING-guns form per §7, re-baselining only its own keys), higgens (troops only), pegazus (foils: the foil parts' data and art are yours; their physics is WP6's), catalyna (the flying boat, kind plane, old plane parts + hull parts + pontoons: it must float, plane and lift off once WP6 lands; at least float now). Every part's numbers (mass, cost, size, hp) as §6 gives, tuned so the stock ships meet §7's balance targets (speed ±12 %, displacement, draught at her marks — fix the slice issue that the Cyclon floats ~0.35 m high: move `wl`/stations or set masses so she sits at her design marks).

Ship roll: a 32 m patrol boat beam-on to the default Moderate swell rolls 12-13° (Phase 1). Give hulls bilge keels / roll damping as part data (or a `bilgeKeel` kit part) so a stock ship rolls realistically (a patrol boat beam-on in 1 m seas ~5-8°), coordinating any physics change with WP6 (WP6 owns ship.js core; if you need a coefficient read in forces, add it as a def field and mark the one-line ship.js change `// [WP5]`).

Owner rules: names are generic or altered (never real designations/nicknames in player text; comments may name the real ship). No career content. Every part usable on any kind (no kind gates).

Tests: catalogue.test (counts, sections convex, joints match, every ship part's fields), builder-shapes.mjs (models vs clash shapes; the tray), core.test (every ship template joined, editable, priced, floats, no open ends), ships.test trials for these five (speed, turning, planing for the RIB, hullborne Pegazus), ships-builder.test (stats vs flight agree for every stock ship), fingerprint/traces/mp-measure: the new templates as ADDED keys only (keydiff 71c3af7 --add ...). Screenshots of every new part in the tray and every ship in 2D and 3D (phone and desktop), looked at; fix what looks wrong.

Done when: every non-weapon part exists, looks right in 2D and 3D, floats or does its job; the five ships meet their targets; old baselines identical.

## Ships WP6: propulsion, foils, decks

Read /home/user/ships-notes/BRIEF-common.md first and follow it. Your package: **WP6 Propulsion, foils, decks, collisions** of the ships update (spec /home/user/ships-notes/SPEC.md: §4.4 foils and ride control, §4.5 outboards/waterjets/turbines, §4.8 grounding/bed/carriers/other ships, §6.2's helipad and decks (moving-deck contact and lashing), §16 WP6 row, §20 S10: ship ghosts collide).

Phase 1 is merged: js/ship.js core (Ship.groups/pre/forces with screws, rudders as foils, planing, added mass, grounding, mooring), its stubs `impactSea` and `bump`. Read ship.js's core section first.

You own: ship.js `core` additions (outboard motors that steer, waterjets with steering/reversing buckets, gas-turbine spool, hydrofoils with ride control so a hydrofoil flies level on its foils at speed, `Ship.bump` (ship–ship and ship–carrier-hull collisions, ship ghosts in rooms included, with dents/holes hooks left for WP8), the carriers' hull boxes so ships can't pass through the static carriers, `impactSea`, decks and lashing (a helicopter lands on a ship's helipad while she's under way and stays on it, moving with her; it can take off again), tiny floating pieces); vessel.js deck contact and the solver line for it; flight.js physicsTick lash line; gear.js's hydro gate (an Armour vehicle with a hull part floats: its tracks don't drive it in the water, its screws/waterjets do; on land Gear drives it as before; an amphibious tank with a hull floats and climbs out up the slipway). WP5 is building the parts' data in parallel (outboards, waterjets, turbines, foils, helipad, pontoons) in parts.js: agree field names from the spec (§6.3, §6.5) and test with test-only defs until WP5 lands.

Also the Catalyna flying boat (WP5's template: a plane with hull parts and pontoons): it must float, run up on the water, plane and lift off at ~70 kn with its old plane laws (a hydro vessel of kind plane keeps planeTarget/laws: only kind ship gets the helm). And the owner's rule: a ship with stubby wings gets their real lift (< 30 % of her weight at full speed) and stays down; jet engines on a hull push it (an airboat).

Tests (ships.test, add sections): a hydrofoil foilborne above 30 kn and stable for 120 s in Moderate seas; a RIB with outboards planes (trim 2-6°, half its hull out); a waterjet boat turns and reverses; a helicopter lands on a deck at 15 kn underway and stays 60 s, then lifts off; two ships colliding bounce without NaN (and dents hook called); ramming a carrier stops her; an amphibious tank with a hull floats and drives up the slipway; the Catalyna floats, planes and lifts off; jet boat; winged ship stays down. Old craft unchanged (zero calls, keydiff). Measure costs (§15).

Done when those all pass and play right in the browser (a quick Playwright run with screenshots of the hydrofoil foilborne and a helicopter on a deck, looked at).

## Ships WP7: builder complete

Read /home/user/ships-notes/BRIEF-common.md first and follow it. Your package: **WP7 Builder complete** of the ships update (spec /home/user/ships-notes/SPEC.md: §11 the builder in full, §16 WP7 row).

Phase 1 is merged: builder basics (kind wiring, zoom floor, waterline overlay, stats rows, Ship.stats/hydrostatics, Ship.spotOf for hull/deck/inside/stern, Ship.warnings). Read js/ship.js's builder section and the [WP4] parts of builder.js.

You own: builder.js specs and tray lines for ship parts (what each part card says: displacement/power/thrust/foil lift/etc.), X-ray for ships (compartments, bulkheads, the belt band, magazines), the hangar's Ships group (WP0 added a 'Ships' group: complete it, ships sorted by class), `shipClass` (boat / patrol / escort / destroyer by length/displacement), `pickKind` for ship, and in ship.js's builder section `Ship.spotOf` for EVERY `place` the spec defines (super, mast, edge, bow, deck turret rings, helipad aft, funnels, radar masts, VLS cells, torpedo tubes at the deck edge, etc.) and `Ship.warnings` complete (§11.3: e.g. no bridge, guns that can't traverse past the superstructure, a radar mast below the funnel, torpedo tubes facing inboard, a helipad with something on it, foils with no ride control, too few crew for the weapons, overloaded, etc.). WP5 is creating the non-weapon parts' data and WP9 (later) the weapons: write spotOf/warnings against the spec's `place` values and test with test-only defs where a part doesn't exist yet, so they work as parts land.

Tests: builder-ship.mjs full (tap-to-place every place type on a hull, X-ray, hangar group, tray cards on phone and desktop), ships-builder.test (spotOf for every place on an empty, a hulled and a full design; each warning fires and clears). Screenshots (phone portrait and desktop, 2D/3D/X-ray) looked at. redraw.mjs: anything you draw redraws on change.

Done when every ship part type has a sensible tap placement and its warnings, the X-ray shows a ship's insides, and the hangar lists ships by class.


## Ships WP8: damage, flooding, sinking

Read docs/ships/BRIEF-common.md first and follow it. Your package: **WP8 Damage, flooding, sinking** of the ships update (spec docs/ships/SPEC.md: §8.3 where hits land, §8.4 holes, §8.7 flooding/pumps/free surface, §8.8 fires/magazines/damage control, §8.9 hull damage, doom and wrecks, §8.12's table as damage targets for the weapons that exist today, §10.5 saves, §13 hooks, §14 invariants, §16 WP8 row and "The Ship API" damage line, §20 S1/S4/S6).

Phases 1 and 2 are merged on the branch: the hydro core, waves, helm, builder complete, all non-weapon ship parts and the nine stock ships (osca, vizby, olivar, arley are hull-only drafts; WP9 arms them after you). Read js/ship.js's header and sections (the `damage` section is stubs for you), and the Phase 2 notes below.

You own: ship.js `damage` section (hullRay, hullMm, hullDist, addHoles, floodStep, floodForce at forces' marked line, fireStep, dcStep, fateStep, doom, magazine, holedThrough, wetAt, insideHull if not already built); parts.js `shullTris` (new, pure, cached per def) and the belt in `massPerMm`/`armourMassT`; parts3d `shipHullGeo` reading `shullTris` (the picture must not move: builder-shapes.mjs and a before/after pixel diff of a hull); armour.js `recsOf`/`test` (hull records go to `Ship.hullRay`), `faceMm` (edge ≤ −6 → `Ship.hullMm`), `resolve` (S1: `D.ship ? SHIP.DRONE.ref : Combat.maxHp(D)` in both drone-charge lines), `apply` holes, `cookOff` → `Ship.magazine` for hydro vessels, `repairStep`'s ship skip; combat.js `explode` (hullDist, `under`), `damage` (S6: `|| isSea(v.kind)` in the Death.hit gate), `destroyPart` (holed through, first lines), `moveShot` bombs under water (S4, gated on `Combat.S.sea`); death.js `impact` (beside WP6's line), `swamp` (the knocked-out ground vehicle in deep water), the wreck list for sunk ships; flight.js `afterFall`'s ship wait; vessel.js serialize/restore of `p.holes`/`p.water`/fires/fate (§10.5, cleaned on load: finite, in the part's box, `a` in (0, cap], at most `HOLE.max`). Every one of these gated so old play never reaches it (§13/§14): `def.shull`, `v.sh`, `Combat.S.sea`, a knocked-out vehicle in water deeper than it is tall.

Phase 2 notes you need: `Aim.sweep` skips `def.shull` parts (aim.js, one line). Any ship part with `module: 'ammo'` counts as a magazine for the builder's waterline warning. The stock ships carry gunners where `Ship.spotOf` puts them. Heel in flight is measured against the water's mean surface under her (`S.hw`). WP9 (after you) adds naval shells, torpedoes, ASMs, VLS and CIWS and will call your `addHoles`, `holedThrough`, `magazine`, and `Combat.explode` with `under: true`: make those interfaces exactly as §8.4/§8.5/§8.8 describe so WP9 only has to call them.

Tests (ships.test §damage, seeded): hole areas per weapon class (§8.4's numbers); flooding equilibria (a 1 m² hole 1 m deep in the Olivar's midsection: lists, settles, survives with pumps; holes in three compartments: sinks in < 300 s); free-surface capsize; pumps and DC timings; a magazine breaks her in two and both halves sink; each doom reason (capsized, sunk, out of action, magazine, derelict); a wreck on a shallow bed vs removal in deep water; a knocked-out tank in deep water goes under (and on land/shallows, unchanged); §8.12's rows for today's weapons (12.7 mm MG, 30 mm, tank 120 mm APFSDS/HE, 500 lb bomb direct and near miss, air rockets, a Bumble's charge per S1, ramming) within their bands or reported with the measured numbers; saves round-trip with holes, water and fires. Unchanged: armour.test, death.test A7/B3, combat.test, ground.test's zero-call counts (add `Ship` damage calls to its counted systems if not already), every old baseline key (keydiff 71c3af7 with the ship keys --add'ed, as BRIEF-common says). Browser: ship-flight.mjs gains a sinking screenshot (shoot the Cyclon full of holes with a tank or bomb in a scripted scene: she lists, settles, goes under; the console clean), looked at.

Done when: ships die by water, fire and magazines as the physics says, holes are where the shots went, and old play is untouched. Commit in increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP15: the sea's looks

Read docs/ships/BRIEF-common.md first and follow it. Your package: **WP15 The sea's looks** of the ships update (spec docs/ships/SPEC.md: §5 waves and the drawn sea, above all §5.5 (the whole of it is your target list), §15's budget rows for the sea, §16 Phase 4's WP15 row; handbook docs/HANDBOOK.md's render chapter §1.1 (the sky light), §1.7 (the water's depth), §3.1.15-16 (the chunk patches: fog, shadow) and the Gotchas in CLAUDE.md about three's shader chunks, log depth, the sky hook, background jobs and battery). The owner asked for it in their words: "is this update going to further improve the sea looks? They need an upgrade definitely".

You own: render3d.js's ocean material hooks (`waterHook`, `waterEnv`, `WATER_DEEP` and the water shader's ripple, foam and light code), the swell patch's material (`updateSwell`'s), the wakes' material; world.js only if the 2D view's sea must agree (handbook §3.7's table); ship.js `waveUniforms`/`SWELL_FN` read only (the physics' waves are WP1's and fixed: the drawn sea must agree with `Ship.wave` wherever a ship could be). WP8 (ship damage) is running beside you and touches parts3d.js's `shipHullGeo`, armour.js, combat.js, death.js, vessel.js and ship.js's damage section: none of yours. WP12 later owns render3d's hole decals: not yours.

What to build (§5.5, in order of what the player notices): the sea state readable from anywhere (far-sea normals from the same four sines, faded with distance so nothing shimmers; the swell patch's edge invisible; Calm glassy); no visible tiling of the 48 m ripple tile from altitude (a second sample at another scale and angle, slow kilometre-scale variation of roughness and colour: wind patches, slicks); whitecaps by sea state from the wave steepness (none Calm, scattered Moderate, many Rough; drifting, fading over seconds; streaks along the wind in Rough); light through thin crests facing the Sun and darker troughs (cheap subsurface term); ships in the water: a bow wave and foam collar where the hull meets the swell, the wake's foam lasting about a minute and spreading, a propeller wash. Keep the speck fix in `waterEnv` (`WATER_RV`, reflected ray kept 0.02 above the horizon): it was the owner's own bug report.

Rules that bite here: three's chunks are patched against r159's text (`patchChunks`; `Render3D.info().patched` must stay `{ fog: true, shadow: true }`); `onBeforeCompile` replaces whole `#include` lines (edit a copy of a chunk, never text inside one in place); a phone's mediump fragments (`obHaze()` without `GL_FRAGMENT_PRECISION_HIGH`); log depth; no new light; no new shader program in an old scene beyond the ocean's own variants (count them); the ripples drift on real frame time, stand still while paused, frame-rate independent; drawing on demand (`App.stale`); the water's ground-UV sharing (graphics.mjs §8) and OB_HI on High only.

Budget and gates (§5.5, §15): the sea's pictures in old scenes change by design (the only intended change to an old scene's picture in this update); every other pixel of an old scene stays identical (render-bench --same against the branch tip for the scenes with no sea on screen); phone Low within ±3 % of today's frame time in the sea scenes (`sea300`, `sea3k`, `seaRough`, `coast`, and water.mjs's views), High within +10 % over the sea, no change where no sea shows. The machine is shared with WP8: measure before/after alternately, several runs, and report the spread.

Tests: water.mjs (all its checks hold; add checks for the new features where a number can be checked: whitecap coverage rising Calm < Moderate < Rough, the swell patch's edge invisible (pixels across the hole's border within a small tolerance), no shimmer (two frames 1/60 s apart far off differ little), paused still); graphics.mjs (every check holds; re-baseline only the sea's own checks if any pin the sea's picture, saying why); controls/redraw unaffected; screenshots (Calm, Moderate, Rough from 50 m, 500 m and 3 km; dusk and night; a destroyer-sized hull at 25 kn from the chase camera and from her bridge; the Faroes' coast from a plane; phone 390×844 and desktop 1280×720), LOOKED AT critically, before and after side by side, and the bad ones fixed (tiling, shimmer, banding, seams at the swell patch or the shore, specks, foam where there should be none, mismatched colour at the hole).

Done when: from a plane, a deck and a phone, the sea looks like the sea in each state, at today's cost on phone Low, old scenes otherwise untouched. Commit in increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP9: naval weapons and sensors

Read docs/ships/BRIEF-common.md first and follow it. Your package: **WP9 Naval weapons and sensors** of the ships update (spec docs/ships/SPEC.md: §6.4 the 15 `shArms` parts, §6.5's `decoy`/`torpDecoy` behaviour, §8 intro (the gates), §8.1 naval guns and shells, §8.2 aiming at sea and old weapons on ships, §8.5 torpedoes, §8.6 anti-ship missiles and VLS SAMs, §8.10 CIWS, §8.11 seeing ships, §8.12 (the rows for your weapons and "the other way": ships against everything), the §8 correction on `weapon.side`, §11.3's torpedo-tube warning, §13 hooks, §14 invariants, §15's range-table and CIWS budgets, §16's WP9 row and "The Ship API" combat line, §20 S3, S5, S7, S8).

Phases 1-2 and WP8 (damage, flooding, sinking) are merged on the branch: read js/ship.js's header and its `damage` section before you start, and its `combat` section (stubs for you: `fireTorp`, `torpStep`, `torpHit`, `ciwsStep`, `shotMissiles`, `surface`, `seesSea`, `rcs`; new `asmStep`).

You own: parts.js region `shArms` (the 15 parts, their 2D art and data) and the kit's `decoy`/`torpDecoy` behaviour; parts3d's models for them; armour.js the naval `SHELLS` block (`// ==== naval ====` at the end of the table), `moveShell`'s one CIWS line, `ground()`'s big splashes for naval shells; aim.js `rangeTable`/`solve`/`aimLift` (the naval gate: past 3 km for `SH.naval` only), `stepAll`'s AI line (`o.ai && (o.ai.ground || o.ai.sea)`), `trackStep`/`searchStep` (S3 missiles as track targets, `sea` radars), the torpedo `fire` path; combat.js `isFighter` (never a ship), `candidates` (surface contacts: §8.11), `swim` (the old air torpedo homing on ships, gated on `S.sea`), `moveShot` (`stor`, `asm` lines), `launchMissile`/`guide`/`guideAir` flags, `turretStep`/`turretFire` (S8: `&& !v.sh`), `frame`'s `S.pd` and its `ciwsStep` call; radar.js's classification (a ship afloat is never an aircraft radar's contact: no magic radar); drone.js `lockable` (ships yes); ghud.js `GHUD.reach(v)` and the zero ladder (20 km for a sea kind or any craft with a naval gun; 3 km for everything else, unchanged); ship.js `combat`; builder.js the warships armed: `osca`, `pegazus`, `vizby`, `olivar`, `arley` (their own template keys: their fingerprint/traces/mp-measure keys may move, they are new in this update). Multiplayer messages are WP11's (§10.4): naval gun shells ride today's shell messages unchanged; torpedoes, ASMs, VLS and CIWS kills work locally and in solo play, and you list for WP11 every place a room needs a message (sendShot for `stor`, `ho` holes rows, `mkill` for a CIWS kill of a peer's missile). The AI that fights with them is WP10's: give it the calls (fire a salvo at a point, a torpedo at a bearing, an ASM at a contact, CIWS on) and test them directly.

WP8's interfaces you call (as built; read their comments in ship.js):
- `Ship.addHoles(v, [[p, x, y, z, a], …], t)`: part-space points; a 4-element row `[p, x, y, a]` is on the centre line.
- `Combat.explode(b, at, blast, dmg, by, sim, quiet, he, spare, fx, o)`: `o = { under: true }` tamps its holes ×3 (any burst more than 0.5 m under the water tamps by itself); `{ inside: true }` adds `HOLE.heIn·blast²` (an ASM through the plate bursting inside).
- `Ship.holedThrough(v, p, cause, sim)`; `Ship.doom(v, sim, why, by)`; `Ship.insideHull(v, X)`; `Ship.hullDist(v, p, at)`.
- `Ship.magazine(v, sim, part, rounds?)`: VLS and ASM launchers count `ammo × MAG.missile` (20) rounds; a `store` part counts its rounds. **You must call it when a VLS or ASM launcher dies or cooks off**: armour.js `moduleDown` sends only `module: 'ammo'` parts there. A gun's ready rounds cooking off go to `Ship.rack` (WP8), never the magazine rule: keep it that way for the naval gun houses. The builder's waterline warning counts any `module: 'ammo'` part as a magazine: check your deck launchers don't trip it wrongly (§11.3).
- A torpedo under the keel of a class M or smaller hull part breaks her back (§8.5): ship.js's internal `breakAt(v, sim, H, part)` does a magazine's break; export what you need from ship.js (it is yours to edit there).
- WP8 measured §8.12 for today's weapons: most rows are outside their bands (small arms and the ram weaker, HE slower, the Vizby lost early to magazine fires). Don't retune WP8's damage; WP14 balances the matrix. Your rows (naval 127 mm HE/SAP, ASM, torpedo, the other way) are yours to measure and report; anything far off (immune, or one hit where it should take dozens) is a bug to fix.

What to build: the 15 parts (§6.4; on the deck, ring, front, edge and mast places Phase 2's builder already knows: check the tap placement and warnings take them); the naval shells and range tables (a 127 mm reaches about 20 km at 45° in about 60 s; long flights on `moveShell`'s cheap stepping; ready rounds refilled from magazines over 4 × reload); aiming at sea (`GHUD.reach`, the long zero ladder, `nRadarFC` as a laser rangefinder snapping the zero to the surface contact under the crosshair); torpedoes (ship tubes firing outboard by `side`, run depth, straight run, active homing, aground, bubbles; the hit, under the keel breaking her back; S7 tubes on aircraft dropping the torpedo, on land firing nothing with the toast and the builder warning; the old air torpedo against ships with `S.sea`; `torpDecoy`); anti-ship missiles (climb, sea-skim at 8 m over the waves, terminal dive to 3 m at 2 km, chaff at the existing odds, the hit through `{ inside: true }` up to 120 mm of plate, else bursting on the belt); VLS SAMs (out of the cell, pitch over at 60°/s, semi-active on a fire-control radar, S3 missiles as targets with p 0.7); CIWS (any kind of vessel, `S.pd`, the threat with the least time to reach her, never the notch rule (S5), 15 simulated rounds a second carrying 5, `Ship.shotMissiles`); decoys (chaff and flare rockets to 300 m); seeing ships (surface not air everywhere §8.11 lists; `seesSea`'s horizon and land mask built once per map; `rcs`; `Ship.surface` four times a second; eyes 8 km by day, 3 km by night); S8 old turrets firing from a ship afloat; then arm the five warships with what §7 and §6.4 give them, priced in their tier, floating on their marks.

Gates (§13, §14): every old weapon, shell, seeker and radar path behaves exactly as before: every new branch opens only on `SH.naval`, `w.asm`, `w.vls`, `w.kind === 'torp'`, `def.ciws`, `Combat.S.sea` or `Combat.S.pd`. combat.test (its range boats, the old air torpedo), radar.test, aim.test, rwr.test, drones.test and mp.test unchanged, mp-air.json identical; ground.test's zero-call counts hold (add Ship's combat entry points to its counted systems); `Combat.S.pd` never opens for an old template; the old turrets' hold-fire rule unchanged for every craft that isn't a hydro vessel afloat.

Tests: a new `test/ships-combat.test.js` (ships.test is already long; register it in run.mjs), seeded: a 127 mm range table hits at 5 km within one hull length, and at 15 km within a few; a TK-34 carrying a 127 mm gun hits at 3 km; CIWS kill odds against one subsonic ASM 65-95 % over 100 engagements, two at once about half each, ≤ 15 simulated rounds a second a mount and ≤ 0.05 ms a frame; torpedo homing and the hull hit (holes ×3), the back broken under a class M keel, aground in shallows, a decoy pulls one off; the old air torpedo hits a ship and the old range is unchanged; an ASM climbs, skims at 8 m over Moderate and Rough waves, dives at 2 km and hits, chaff decoys it; a VLS SAM pitches over and kills an aircraft at 10-12 km and an ASM; classification (a ship ghost is never an air candidate nor an aircraft radar's contact; an air-to-air missile can't lock a ship; a radar, IR or TV anti-ground missile can; a drone can lock one); `seesSea` (two 20 m masts about 7 km; land in the way); §8.12's rows for your weapons and the other way (a 127 mm HE knocks out a tank on the shore in 1-3 hits; HE-VT brings down a plane in 10-30 rounds within 5 km; CIWS shreds a drone and a helicopter) within their bands or reported with the numbers; the range table ≤ 30 ms once; S8 (an old turret on a ship afloat fires; on a plane on the ground it still holds). catalogue.test and core.test take the new part and template counts. Browser: ship-flight.mjs gains a gunnery scene (the Arley's 127 mm through the gunner's sight at a target 5 km off: splashes, a hit) and a missile scene (an ASM at the Cyclon, the Arley's CIWS shooting one down), on a phone 390×844 and a desktop 1280×720, the console clean, screenshots LOOKED AT; builder-ship.mjs places each new part.

Done when: the four warships fight as §8 says (guns, torpedoes, missiles, SAMs, CIWS, radars over the horizon), every kind can reach a ship and a ship can reach every kind with these parts, and old play is untouched. Commit in increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP10: the computer's ships and the Naval Range

Read docs/ships/BRIEF-common.md first and follow it. Your package: **WP10 AI and the Naval Range** of the ships update (spec docs/ships/SPEC.md: §9.1 the computer's ships, §9.2 the Naval Range, §8.2's AI aiming line, §15's AI and Hostile-wave budgets, §16's WP10 row and "The Ship API" ai line, §20 S9). §9.3 (the Naval Practice battle on the Shetland Sound) is NOT yours: it needs WP11's arena and placement, and comes as a small package after both of you merge. WP11 (multiplayer) is being built beside you: it owns mp.js, mpui.js's lobby, net.js, gmode.js's `capturer`/`placement`/`pickNaval`, space.js `EARTH.arenas.sound` and ship.js `mp`; keep out of them (your gmode.js `NAVAL_STOCK` and space.js `EARTH.navalRange` are separate blocks: put them where a merge won't collide, and say where).

Phases 1-3 are merged: the hydro core, helm, builder, all parts and the nine stock ships (the five warships armed), WP8's damage (holes, flooding, fires, magazines, fate, `Ship.doom` → `v.ai.down` and the `Ship.aiDown` stub) and WP9's weapons and sensors. Read js/ship.js's header and its `damage`, `combat` and `ai` sections. WP9 left you these calls (ship.js, "the AI's calls"): `Ship.salvo(v, P, F)` (every naval gun laid on P, fired when laid and loaded; v.aimP keeps them laying), `Ship.torpAt(v, bearing, F)` (refuses a bearing whose tube faces away), `Ship.asmAt(v, target, F)`, `Ship.samAt(v, target, F)` (needs the fire-control radar to hold it), `Ship.ciwsOn(v, on)`; each refuses with no crew or a doomed ship. AI ships aim through `Aim.stepAll`'s `ai.sea` loop. Combat.frame's bandit loop skips `ai.sea` ships (a [WP9] mark): you run them. WP9's notes: fire two ASMs a few seconds apart (two in one tick fly a metre apart and one CIWS burst kills both). Sensing: `Ship.surface(v, F)` (sea radars, 4 Hz), `Ship.seesSea`, the eyes (`SHIP.EYES`), the fire key's `seenSea` rule (no magic radar: the AI sees only what its radars and lookouts see).

You own: ship.js's `ai` section (`think` at 4 Hz ≤ 0.1 ms a ship, `look` at 1 Hz with 9 `heightAt` a second, the helm through `sh.tel` and a heading order, targets incl. S9 shore targets, range keeping, gunnery with fall-of-shot correction, missiles/torpedoes by §9.1's numbers, evasion, retreat, `aiDown`'s bookkeeping, `flyStriker`, `range`); combat.js `frame`'s AI-loop and `aiDown` lines; groundai.js `aimAt` factored out into a shared helper both AIs call, with NO behaviour change (groundcombat.json and groundai.test identical); space.js `EARTH.navalRange`; gmode.js `NAVAL_STOCK` (data only, for the later practice battle); the range's bar (GroundAI's style). No career awards (§21). Nothing of this runs in a room (as the ground AI).

Gates: every new path opens only for `ai.sea`, the Naval Range's own setting (Targets Practice/Hostile with the player's craft a sea kind or hydro vessel afloat within the range's reach, no room, no battle) or WP9's gates. The old target range (boats, frigate, AA sites round (8000, 0)) stays exactly as it is, alongside; combat.test, groundai.test, groundcombat.json, ground.test's zero-call counts, drones.test (the drone war) and every old baseline unchanged (keydiff as BRIEF-common says).

Tests: `test/navalai.test.js` (seeded: the helm reaches waypoints; avoids land at the islands and keeps `avoid` from shores and ships; keeps range; hits a target at 4 km within N salvos by skill (worst to best); fires torpedoes in a spread; ASMs on her targets two at a time only at the best skill; evades a torpedo (combs its track) and zigzags under fire; retreats; engages a tank on the shore within gun reach (S9); a strike aircraft's run; the cost (think ≤ 0.1 ms a ship, a Hostile wave's physics within §15)); register it in run.mjs. Browser `test/browser/naval-range.mjs` (Practice: sink a target with the Arley's gun; Hostile: survive a wave for 60 s of `Flight.time`; the bar; phone 390×844 and desktop 1280×720 screenshots LOOKED AT; console clean); the bench scene `fleet` (§15) in test/bench/render-bench.mjs.

Done when: the Practice and Hostile Naval Range play end to end against ships that steer, fight, evade and sink as §9 says, and old play is untouched. Commit in increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP11: multiplayer and the Naval Battle

Read docs/ships/BRIEF-common.md first and follow it. Your package: **WP11 Multiplayer** of the ships update (spec docs/ships/SPEC.md: §10 whole (the mode, the Shetland Sound arena, placement and capture, messages, saving rules, old play), §8.5/§8.10's "in a room" lines, §4.8 S10 (ship ghosts collide), §16's WP11 row and "The Ship API" mp/slew lines; CLAUDE.md's multiplayer invariants). The handbook's multiplayer chapter (docs/HANDBOOK.md) before you start.

Phases 1-3 are merged (ships, damage, weapons). WP8 and WP9 left you these (their notes): ghosts get no holes yet (`blastHull` and `roundHit` skip `v.remote`; `ho` rows and `Ship.cleanHoles` are stubs); remote knocked-out wrecks in deep water already go under on every screen; ship torpedoes (shot k `'stor'`, `Ship.fireTorp` → `Combat.S.shots`) need a replica that runs, goes aground and bursts for show; holes from torpedo hits, ASM hits and big splashes on a remote ship go through `Combat.explode` → `Ship.blastHull` and need `ho` rows through `MP.sendHits`; ASMs and VLS SAMs go out through `launchMissile` and a replica needs the `asm`/`vls` flags so `asmStep`/`vlsStep` fly it the same way; a CIWS or SAM kill of a peer's missile sets `m.ciwsKill`/`m.killedBy` on the local copy (ship.js `kill()`): it needs the `mkill` message; torpedo noisemakers are local; chaff and flares already go out through `MP.sendFlares`; new shells and parts mean bumping `NET_VERSION` (13 → 14, with §10.4's comment). WP10 (the computer's ships and the Naval Range) is being built beside you and owns ship.js `ai`, combat.js's AI loop, groundai.js `aimAt`, space.js `EARTH.navalRange` and gmode.js `NAVAL_STOCK`: keep out of them (put your gmode.js and space.js additions where a merge won't collide, and say where). The Naval Practice battle (§9.3) comes after both of you merge: build GroundMode's sea rules so it can run them offline as the ground Practice Battle runs GroundMode.

You own: mp.js (§10.4: snapshots' `sh`/`af`/`st`, ghosts (`Ship.ghost`, `Ship.unsnap`), hits' `ho`, `mkill`, `stor` shots, `down.sea`, settings `game: 'naval'` and `sea`), mpui.js's lobby, settings, `#mp-create-naval` and the naval mode's placement and respawn, net.js `NET_VERSION` 14, gmode.js (`capturer` kinds, `placement` on a `sea` arena, `pickNaval`), space.js `EARTH.arenas.sound` (and the `sea: true` arena rules: no levelled ground, no props, no arena mesh: ghud.js and render3d's `clear`/`map` checks skip it), ship.js's `mp` section and `slew` (the room's sea clock). Every new field cleaned (peers are untrusted; no peer text in innerHTML); rate limits as §10.4 says.

Gates: `mp-air.json` identical; a ground battle (groundcombat.json, mp.test's ground traces) identical; net.test unchanged; gmode.test's old cases unchanged (`'boat'` still doesn't capture); a sandbox room without ships sends byte-for-byte the same messages as before (a second craft's messages carry their extras last, as the drones' did).

Tests: mp.test gains a naval trace → new `test/baseline/mp-naval.json` (two ships, a shell exchange with holes, a torpedo, a CIWS kill of a missile, a sinking `down.sea`), and hostile-peer cases (forged `ho` rows, `mkill` floods and far-off kills, bad `sh`/`st`/`sea`/`game` values: cleaned, nothing thrown); gmode.test naval placement and capture; spawns.test the Sound's starts and zones deeper than the deepest stock draft + 2 m; browser `test/browser/naval-battle.mjs` (two tabs, BroadcastChannel, both visible: a 1v1 naval battle from the lobby to the result, a hit with holes seen on both screens, a sinking seen by both), screenshots LOOKED AT on phone and desktop, console clean.

Done when: a 1v1 naval battle plays in two windows, ships, holes, torpedoes, missiles and sinkings agree on both screens, and old rooms are byte-for-byte as before. Commit in increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP10b: the Naval Practice battle

Read docs/ships/BRIEF-common.md first and follow it. Your package: **WP10b the Naval Practice battle** of the ships update (spec docs/ships/SPEC.md: §9.3 whole; §9.1's computer ships as they fight in it; §16's rows for `Ship.practice` and `#mp-practice-naval`; §15's AI budgets; §20's S-rules hold in it as anywhere). WP12 (the HUD, sound and feel: ship.js `hud`, ghud.js `drawTorps`, render3d's hole decals, audio.js, controls.js's touch buttons, a block of its own in style.css) is being finished beside you and merges after you: keep out of those, and keep your style.css rules in a block of their own.

What is merged and yours to build on:
- **The ground Practice Battle** (groundai.js: `startBattle`, the battle's frame, `end`, `results` with Play again, the respawn panel through `MPUI.rsp`, `practiceVehicle(money)` saying which vehicle you'll drive, the `GroundAI.battle` getter, `B.obj` run by GroundMode offline; mpui.js `practice()`): the model. Follow it, and share what can be shared (the respawn panel, the results modal) rather than copying it.
- **WP11's sea arena:** `EARTH.arenas.sound` (the Shetland Sound: pads West/East 9.4 km apart, out of each other's sight; zones A, B, C at sea; air starts), `GroundMode.placement` on a sea arena (ships 120 m abreast, rows 250 m astern; helicopters and drones 300 m up; planes from the air starts), capture by ships afloat only (the arena's `kinds`, `gd` meaning afloat), `GroundMode.navalStock(budget)`, `GroundMode.obj()` already reading `Ship.battle.obj`, ghud.js's minimap framing the Sound when `Ship.battle.arena === 'sound'`, mpui's naval rendering (the bar, the "Sunk by …" respawn line, the results).
- **WP10's computer ships:** ship.js `ai`: `aiSpawn(F, key, place, { role: 'fight', skill, team, ally, lead, course })`, `aiFrame`, `aiReset`, the helm by sea (`seaWay`, A* round land), columns (`lead`), targets by their own sensors, gunnery, missiles, torpedoes, evasion, retreat, `aiDown` (its "the battle's bookkeeping" hook), friendly fire held (`friendInLine`); `Ship.practice(opts)` is a stub returning false and `battle: null` a plain field (make it a getter, as `GroundAI.battle`); the Naval Range is off while `Ship.battle` is set; `NAVAL_STOCK` in gmode.js.

You own: ship.js `ai`'s battle part (`practice(opts)`, the `battle` getter, the battle's frame: GroundMode's rules 4 times a second, zones, tickets, deaths, respawns, the end; the AI's battle orders: allies in column with you and taking zones, enemies the same against you: the nearest zone their side doesn't hold, then the enemy; a side's ships never strand on the Sound's shores (the A* by sea), never fire through each other); `aiDown`'s battle bookkeeping (a ticket, the kill's credit through `Combat.byMe`, the feed line); respawns (an AI ship back at its side's start after the battle's delay, out of the enemy's sight; the player through the shared respawn panel: the tier's stock ships and their own designs that are ships within the money); the result (tickets or time) and Play again; mpui.js `practiceNaval()` and the **Naval practice** button `#mp-practice-naval` beside Practice (index.html, the `.home-btn` styles; disabled without the Earth map with the reason said, as `#mp-create-naval` is; the tier picker saying which ship you'll take, as the ground one does). No career awards (§21). Nothing of it runs in a room.

Gates: the ground Practice Battle exactly as before (practice-battle.mjs, groundai.test, gmode.test's old cases, groundcombat.json); the Naval Range never runs during the battle and is as WP10 left it after; old arenas' placement and capture unchanged; ground.test's zero-call counts; every old baseline unchanged (keydiff as BRIEF-common says, with WP11's `mp-naval:*` keys).

Tests: `test/navalpractice.test.js` (seeded: the battle starts three a side on the Sound at the pads, out of each other's sight; the stock by tier, and the player's own ship used when it fits the money; allies in column take a zone; enemies take zones and fight; tickets drain; an AI ship sunk comes back at its start; the player's respawn; the result by tickets and by time; Play again; leaving the battle puts everything away (no ships, no bar, `Ship.battle` null); the cost: six ships' physics and AI within §15 with the physics' LOD, measured in the page as WP10 did); register it in run.mjs. Browser `test/browser/naval-practice.mjs` (from the button through a sinking and a respawn to the result, a phone 390×844 and a desktop 1280×720, screenshots LOOKED AT, the console clean); register it.

Done when: a Naval Practice battle plays from the button to the result on a phone and a desktop, and the ground Practice Battle and old play are untouched. Commit in increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP12: the HUD, sound and feel

Read docs/ships/BRIEF-common.md first and follow it. Your package: **WP12 HUD and feel** of the ships update (spec docs/ships/SPEC.md: §12 whole (the HUD's remaining items, the camera, touch, sound), §16's WP12 row and "The Ship API" hud line; CLAUDE.md on the zoomed HUD (`--ui-scale`, `Controls.z`), drawing on demand, battery, the three controls lists, and the render3d rules for decals (read-only of the sim, `depthBias`, `F.camAbs`)).

Phases 1-3 and the sea's looks (WP15) are merged; WP10 (the computer's ships and the Naval Range: ship.js `ai`, combat.js's AI loop, groundai.js `aimAt`, space.js `EARTH.navalRange`, gmode.js `NAVAL_STOCK`, a `#naval-bar` in style.css) and WP11 (multiplayer: mp.js, mpui.js, net.js, gmode.js's sea rules, space.js `EARTH.arenas.sound`, ship.js `mp`, `.home-btn.naval` in style.css) are being finished beside you and merge before you: keep out of their files and sections, keep your style.css rules in a block of their own, and make the torpedo and missile warnings read `Combat.S.shots`/`Combat.S.missiles` as they are, so a computer ship's or a peer's torpedo (k `'stor'`) warns the same as one fired in a test. Known HUD defects to fix: the small hull diagram box's label is clipped to "CREW 13/" on a phone 390×844 and a desktop 1280×720 (seen in WP9's screenshots); WP8 left the `SUNK`/`CAPSIZED`/`OUT OF ACTION` banners, `p.holes`, `p.fire` and `p.water` for you to draw, and ship fire smoke and a sinking's smoke are already FX particles in ship.js.

You own: ship.js's `hud` section (the hull diagram: her side outline, a cell per compartment filling blue with W/V, holes red, fires orange, the DC party white, heel and trim; on a phone a compact strip; a small canvas redrawn at 4 Hz only when its key changes; banners and warnings: flooding, fire, magazine fire, abandon ship, torpedo in the water with bearing and range, missile inbound only from a radar part aboard (no magic radar), target sunk); ghud.js `drawTorps` (our torpedoes' predicted runs, incoming tracks seen within 1.5 km, dashed); render3d's hole decals (dark scorched patches at `p.holes`, read-only of the sim); the chase camera's distance from her reach (a 156 m ship framed whole, a RIB close) and the bridge view in Rough never inside the hull; audio.js's ship sounds (§12.5: only with a ship active or within 1.5 km of the view); controls.js touch buttons `hold`, `dc`, `ciws` (`Controls.CTL` entries, the layout editor, `Controls.fit`); style.css. Keys: no new rows (§12.3); if you add any, the binding table and the three help lists stay in sync.

Gates: old craft's HUD, sounds and camera unchanged (controls.mjs, ground-hud.mjs, rwr-hud.mjs, plane-aim.mjs, redraw.mjs, graphics.mjs hold); drawing on demand (`App.stale`) unaffected; no new shader program in an old scene; no per-frame work without a ship in play.

Tests: controls.mjs at 360×640 … 1920×1080 with the new buttons clear of everything; ship-flight.mjs gains checks and screenshots (the helm and hull diagram on phone and desktop, a sinking ship's diagram filling, banners, torpedo lines, hole decals, the bridge view in Rough sea), LOOKED AT critically as the owner would on a phone in portrait; redraw.mjs; graphics.mjs; the console clean.

Done when: it reads clearly on a 360×640 phone in portrait and a desktop, and old craft are untouched. Commit in increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP14: the combat matrix

Read docs/ships/BRIEF-common.md first and follow it. Your package: **WP14 Combat matrix** of the ships update (spec docs/ships/SPEC.md: §20 whole (the owner's rule: every kind can destroy every kind, with realism in how hard), §20.1's decisions (O1, O3, O5 for old kinds; S1-S10 for ships, already built by WP8/WP9/WP10), §8.12's table and "the other way", §16's WP14 row). The recovered audit summary is in docs/ships/reports-recovered.md (search "matrix").

Everything else is merged: ships, damage, weapons, the computer's ships, multiplayer, HUD, the sea. The earlier packages measured §8.12's rows and left the balance to you: WP8 (today's weapons vs the four ships: small arms and the ram weaker than the bands, HE a little slower), WP9 (naval 127 mm vs Cyclon 9 (band 3-6), Vizby 29 (8-15), Arley about 288 (15-40); torpedo vs Arley 5 (1-2); ASM vs Arley 5 (3-5) with her CIWS held). Measured again on the branch after WP10-WP12 (the numbers to start from): 127 mm vs Cyclon 9 (band 3-6), Vizby 29 (8-15), the Arley still afloat after 80 (15-40); torpedo vs Vizby 2 (1), Arley 4 (1-2); ASM vs Arley 5 (3-5). Read ships-damage.test's and ships-combat.test's band harnesses: reuse them.

You own: `test/matrix.test.js` (three layers: reach (the targeting lists and one delivered round for every attacker-target pair among the seven kinds: rocket, plane, car, helicopter, drone, Armour, ship), effort (seeded hits or time to destroy, rating bands "sure / takes work / almost harmless", lower bounds for the almost-harmless cells, `test/baseline/matrix.json`), hard cases (scripted engagements: a drone's head-on pass at a plane, a tank against a hovering helicopter, a ship's guns at a tank on the shore, …)); the old-kind fixes O1 (drone.js `lockable`: landed craft, rockets on the pad, slow low helicopters; drones still refused), O3 (a rocket warhead part, `def.warhead`, so a rocket can be flown as a missile; old crashes stay harmless), O5 (combat.js's `Death.hit` gate for rockets); balancing the ships' §8.12 rows where they are far off, by tuning SHIP's damage and weapon numbers (not WP8's physics), each change justified by realism and measured; the 7×7 table (markdown) for the handbook and the PR body.


Also yours, found after the brief was written (each pre-existing on the branch; fix at the source, never by loosening a check):
- **An anti-ship missile flies over a low-freeboard ship (major).** ship-flight.mjs's "the Arley's anti-ship missile at a Cyclon 5514 m out ... goes and hits her" fails about 4 runs in 10. Node repro: `node /tmp/claude-0/-home-user-Overbuilt/0587f056-6c41-58cd-9f76-3deee688a95a/scratchpad/asmcyc/run.js <checkout> 24` (an Arley's `asm4` at a Cyclon 5.5 km off, calm sea, `Ship.seed(1000 + 37k)` for 24 k; if the scratchpad is gone, rebuild it from ships-combat.test's stand-ins): 10 of 24 miss, every one with |`s.ao`| ≥ 0.22 (asmStep's aim point along her length, `(crnd() * 2 - 1) * 0.35` of her bounds). The missile passes 6-13 m from her origin and flies on until 40 s. Cause: `SHIP.ASM.termH` is 3 m and a Cyclon's deck fore and aft of her wheelhouse and turret is lower, so a missile aimed there skims over her; it hits only when the aim point lands on the wheelhouse or the 30 mm turret. Expected: a missile locked on a ship hits her wherever along her length it aims (into the side below the deck edge at that point, or a terminal dive that meets the deck), for all nine stock ships including the Zodiak and the Pegazus on her foils. Pin it in the matrix: ASM vs each stock ship, hit rate over seeds ≥ 0.95 with no chaff or CIWS.
- **The close-in gun's kill rate in the page (major, flaky check).** ship-flight.mjs's "an Osca's anti-ship missiles at her from 6 km: her close-in gun ... shoots one down" fails about 1 run in 4: the page's kill chance per missile is about 0.5 against ships-combat.test's 0.7 in node, and after two hits the third missile is never engaged. The combat dice `cs` (ship.js, `Ship.seed`) are seeded from `Math.random` per page load; ciwsStep (ship.js ~4028-4100) fires 5 rounds per simulated shot, 1500 rounds. Find out whether the kill rate depends on the frame rate (the page steps Ship.ciwsStep at the frame's dt, node at 2/120 s): if it does, make it frame-rate independent; then make the browser check deterministic (seed the dice) with the node odds.
- **A decoy dies before the torpedo it lured (minor).** WP9's torpedo decoy lives 60 s, shorter than a lured torpedo's run, so a torpedo can turn back to the ship once the decoy is gone. Check the real towed decoy (it is towed until recovered) and the torpedo's re-acquisition; make the lure hold for the torpedo's whole run if that is the realistic answer.

Gates: every old baseline identical (keydiff), the old 36 pairs give identical numbers with and without ship.js loaded, O1/O3/O5 gated so nothing old moves (only a player's drone Lock reaches O1; O3 only with the new part).

Tests: matrix.test (about 50 s; register it in run.mjs), every pair has a way, the bands hold; the stock ships' rows within §8.12's bands or the measured numbers recorded with the reason.

Done when: every pair has a way, the table's bands hold, and the table is written. Commit in increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP16: rules and paths for every WP16 package

Paths used below. The design: `docs/ships/WP16.md` (its §11 lists the sceptic's critique and how each item was settled, so don't re-open those without new
evidence). The research: `.../scratchpad/wp16/look.md` (today's models looked at and measured), `.../wp16/code.md` (the
pipeline to the line, what may change), `.../wp16/real.md` (the real vessels and kit, colours, game techniques); the
critique `.../wp16/critique.md` and its probes `.../wp16/sceptic/` (camera distances: `probe3.js`; hull cut counts:
`probe4b.js`, `probe4d.js`) and `.../wp16/wp16probe/probe5-single.js` (the near loft's single-line cuts); the "before"
screenshots `.../wp16/look/shots/` and the scripts that took them `.../wp16/look/look.mjs`, `parts2.mjs`;
`.../wp16/count.js` (builds every ship part's model in node with the tree's three). `.../` is
`/tmp/claude-0/-home-user-Overbuilt/0587f056-6c41-58cd-9f76-3deee688a95a/scratchpad` (if the container was replaced
and it is gone, the four notes are in `docs/ships/wp16/`; the screenshots and probe scripts are not, so take the "before"
pictures again with `ship-models.mjs --shots` on a commit before WP16).

Order: **WP16a's first step (a1, the contract) is merged before anything else starts**; then a2 (the pipeline), WP16b,
WP16c and WP16d run in parallel worktrees off the branch tip with a1 in it; the lead merges a2 → b → c → d; then **a3**
(the merge on the final models); then WP16e.

Rules every package keeps (the design's §3.1a, §6.2, §7): pieces are `[geo, kind, cls, flags]` with `cls` ∈ `midOnly`
(only with its `near` twin over the same planes), `mid`, `near`, `fine`; kinds `shipVC`, `shipCamo`, `glass` only; no
`DoubleSide`, `flatShading`, `alphaTest`, `InstancedMesh`, textures or custom shaders on ship parts; nothing proud or
recessed by under 3 cm; fine rods ≥ 4 cm (stanchions 6 cm); strong-contrast cut-in strips ≥ 0.8 m in mid, ≥ 0.3 m in
near, weak ones ≥ 0.3 m, seams as tone steps; `tall` rods (≤ 6 cm, ≤ 6 m, `noPick`) are the only pieces allowed outside
a box; buildings keep their roof at the box top and each side and top face ≥ 85 % covered by mid surface within 0.5 m;
nothing sits lower than the box top where another part may stand; every recipe gated on `d.ship` (old parts
byte-identical); a recipe reads only the ctx fields its style adds to `CTX_USE` (with `Object.assign` in its own region);
deterministic (no `Math.random`); your per-part caps in your block of `ship-models.test.js` sum to the design's §6.3
allocation.

## Ships WP16a: the ship model contract, the drawing pipeline and its integration

Read docs/ships/BRIEF-common.md first and follow it, and this file's section "Ships WP16: rules and paths for every WP16 package" (paths, order, the rules every package keeps). Your package: **WP16a the ship model contract, the drawing pipeline
and its integration** of the ships update's detailed models (the design docs/ships/WP16.md: §0, §2, §3.1a, §3.4, §4.4's
number and name, §5, §6 whole, §7, §8, §9, §10, §11 — read it all once; spec docs/ships/SPEC.md: §12.6 models, §15
performance budget, §16 the ownership rule; handbook docs/HANDBOOK.md's render chapter on the log depth buffer,
`depthBias`, `F.camAbs`, the wreck bake, background jobs and drawing on demand; CLAUDE.md's Gotchas on three's chunks,
programs, shadow-only casters, background jobs, battery and the zoomed HUD). Research: `.../wp16/code.md` §1, §4-§8 (the
pipeline to the line, costs, extension points), `.../wp16/look.md`'s Measurements, `.../wp16/critique.md` items 2, 3, 7-11,
19, 21-23. The owner asked for the whole of WP16 in their words: "the ship models or part models, they are really not
detailed at all, and on ships it should matter, they should be as realistic and as detailed models as there can be, more
than our standard, so please full focus on that once everything else is finished". Your part is what lets the other three
packages pile detail on without a phone paying for it: today the Arley Berk is 15 k triangles in 72 meshes, each drawn
twice on High, 54 materials, no LOD (at 600 m she still costs 176 draws).

You work in three steps.

**a1, the contract** (commit it, report, and stop for the lead to merge it before WP16b, c and d start: they code against
it). parts3d.js: `KINDS` gains `shipVC` (vertex colours, the `shipHull` kind's parameters, so its program) and `shipCamo`
(vertex colours × the camouflage map in metres, `shipHullCamo`'s program); `node()` takes an optional third and fourth
element per piece, the class and flags (absent: exactly today's output); `model(d, flip, skin, ctx)` merges a ship part's
pieces per kind into **one indexed geometry ordered `[midOnly | mid | near | fine]`** with `userData.runs` (and a hull's
label-region tail, `runs.tail`), keys it per skin (its paint is in its vertices) and per the ctx fields its style lists in
`CTX_USE`, and nothing else's key changes; `instance()` sets a ship mesh's `drawRange` for the hangar (`[mid | near |
fine]`), gives it `onBeforeShadow`/`onAfterShadow` that swap in `[midOnly | mid]` (the pattern of render3d's city
stand-ins, :3866; a mesh with no mid run never casts); `fade()` casts only meshes with a mid run (today it resets every
mesh by `rig.small`, parts3d.js:2660), X-ray draws ship meshes' `[mid]` and hides glass and `tall` pieces, `bakeList`
ignores `userData.tierHidden` (never other hiding) — each a branch reached only by ship pieces; `buildPart(p, builder,
radial, ctx)`; a region `// ==== ships: models' contract (WP16a) ====` with `SC` (the design's §3.4, linear), `SG()` (an
indexed, vertex-coloured builder with regions: `box`, `prism` with split normals for facets, `cyl`, `lathe`, `rod`, `quad`,
`add`; vertices shared only within a region), `cutColour(geo, polys, rgb, proj)` (Sutherland-Hodgman cuts of a piece's
own triangles along convex polygons in a per-face projection: `'side+'`, `'side-'`, `'plan'`, `'end'`), `wear(rgb, x, y, z,
k)`, the far default (`far(d, skin, ctx)` from a layout, no model build: the box in the skin's paint, its top band in the
layout's top colour when given), `const CTX_USE = {}`, and the fitting library `FIT` (`railRun`, `hatch`, `door`,
`porthole`, `windowBand`, `ladder`, `vent`, `navLight`, `whip`, `searchlight`, `raft`, `bitts`, `chock`, `cleat`: classed
pieces, deterministic, in the caller's frame, at §3.1-§3.2's sizes and §3.1a's thicknesses); the headers of b's and c's
regions with the stubs `shipDress(vm, parts)` and `superDress(vm, parts)` (so b and c never edit your region); parts.js a
region `// ==== ships: model context [WP16a] ====` with `shipCtx(parts, salt)` (`stealth`, `aegis`, `no` (calls WP16b's
`shipNumber` when it exists, else null), `name`), `shipPartCtx(p, parts, vctx)` (`nb`, `bay`, `egg` as §5 defines them)
and the `PartPaint.ship` field; builder.js's 2D part loop (~:3736) and world.js's 2D vessel draw (:966) set and clear
`PartPaint.ship` for a design with a ship part (two lines each, marked `// [WP16a]`); `VesselMesh` computes the vessel's
and each part's ctx once (a WeakMap per part object: a split's halves inherit it) and calls the dress hooks on a layout
signature as `pylons()` does; `test/ship-models.test.js` (node, with the tree's vendored three as `.../wp16/count.js` does
it; register it in run.mjs): a snapshot of every sim-read number against 727e2d2 (`nvAsmLay(d).mouth` for every k,
`nvVlsLay(d).cells`, `nvCiwsLay(d).gun`, `def.screw.y` against `shOutboardLay`'s hub, `def.foil.y`/`chord` against
`shFoilLay`, `shullTris` of every hull hashed), every non-inner ship part's model inside its box (`tall` pieces exempt and
listed; the Gun House inside its outline prism, the ring inside its lathe outline), the buildings' face coverage (a 0.25 m
raster: each side and top face ≥ 85 % covered by mid surface within 0.5 m, roofs at the box top, recesses ≤ 2.4 m) for
every ctx variant, every role of §3.3's limits present at its pivot, every piece classed and of an allowed kind, runs
ordered and every `midOnly` with a `near` twin over the same planes, no coplanar overlapping triangles in a drawn set
(planes within 1 mm, normals within 1°, overlap > 1 cm²), no relief under 3 cm, two builds hash-identical, and the
per-part caps table (blocks `[WP16b]`, `[WP16c]`, `[WP16d]`, filled with today's counts for now: each package raises its
rows to the design's §6.3 allocation); `test/browser/ship-models.mjs` (register it) with a `--shots <dir>` mode writing
the design's §9 shot list (port `.../wp16/look/look.mjs` and `parts2.mjs`: same camera placements, plus `sea-<k>-30`,
`-200`, `-1500`, phones at DPR 1.75, every shot's tiers in a sidecar line) so every package takes the same pictures. a1
changes no picture: every model still builds as today (your helpers are unused until b, c, d use them), graphics.mjs and
ground-models.mjs identical.

**a2, the pipeline** (beside WP16b, c and d; they are rewriting the part recipes: never touch `shipHullGeo`,
`BUILD.shipHull`, `shipKit`, `shipKit2`, `navalKit`, the `d.ship` branches of `tankGun`/`radarAnt`/`extrude`/`lathe`, b's
or c's regions, or any parts.js art). The **ship layer** of the design's §6.2 for vessels of kind `ship` in flight only
(`VesselMesh(parts, { ship: true, name, salt })` from `syncVessels`; every other kind draws rigs exactly as today): static
pieces of ship parts, `rig.dress` and `superDress` merged per material into a `body` (the runs concatenated by class, the
label-region tails last), `camo` (one per camouflage skin, each part's camouflage offset baked into its UVs), `glass`, ≤ 40
m `fine` chunks, the launchers' `nvCap<k>` lids into one mesh per launcher drawn by `drawRange` from `p.ammo`, ≤ 2 label
patches, and the `far` mesh (hulls decimated from their rings, every part's `far` from its def, old parts as boxes), all
children of `vm.group` in its frame; compact attributes (`Uint8` colours, `Int8` normals, `Uint16` indices where they fit),
CPU arrays released after upload, indices kept; built lazily in jobs of ≤ 3 ms a frame across all ships, at most one
layer's first upload (≤ 1.5 MB) a frame, `far` at first sight, `body` (midOnly and mid) and lids at first T2, near runs,
glass, labels and dressing at first T1, fine at T0; near/fine/glass/labels freed after 30 s at T2 or lower; until a layer
exists its parts' own meshes draw (the same picture); merged meshes' rigs skip `update()`; a lost part's runs collapsed by
indices, not rebuilt; `pick` keeps hidden-because-merged meshes pickable and skips `noPick`; `char` reaches the layers'
materials once; the bake folds only the rigs (≤ 15 ms for an Arley), walking them whatever the tier, and keeps the
layers; ship rigs cast only when their bounding radius is ≥ 1 m (T1, T0) or ≥ 2 m (T2); `dispose` frees it all. The
**tiers** of §6.1: render3d `syncVessels` computes `k` (CSS px per metre at her nearest point, the current `TANH`), `kd` (k
× the renderer's pixel ratio) and her camera in the vessel group's frame onto `SYNC_Q`; `VesselMesh.sync` sets the
`drawRange`s and visibilities with the hysteresis given, Low's thresholds when `Settings.high` is off, T0 by `kd` per fine
chunk, under-water rigs hidden below T1 (launchers' lids stay to T2), rigs hidden at T3, label patches by their own stroke.
**Builds**: at the flight's load (`S.warm`) the models of the player's ship and of every template ship.js can bring into
this flight (read its Range and Practice rosters, never write ship.js) are built; a ship whose models aren't cached draws
a far-only stub (`vm.farOnly`) while its part models build as jobs (a part per slice; the hull's near cut sliced with
`jobLate()`), and you check every reader of `vessels.get(v).vm` (grep) copes with the stub. The hangar's call
(render3d.js:7601) passes `{ ship: true, name: Builder.name }` for a ship and a rename rebuilds the label patches (the name
joins `bd.key`). mp.js one line marked `// [WP16a]`: the spawn message's `name`, sanitised (`[A-Z0-9 -]`, ≤ 14
characters), stored on `P.design` and passed to the ghost's `VesselMesh` (today `vesselOf` names a ghost after its player,
mp.js:1477). `Render3D.info().ships`: per vessel her tier, draws, shadow draws, triangles, layers built and bytes.
Render-bench: build `ship1k` (SPEC §15's: the Arley at 25 kn, Moderate, the camera 1 km off her beam, noon), `shipbig` (the
Arley's chase at 1.5 L, Moderate, noon), `phonechase` (her phone-portrait follow camera, 390 × 844, DPR 1.75) and
`hangarship` (the Arley orbiting in the hangar, phone High) beside `shipnear` and `fleet`, and a `SHIPS` group whose checks
are the §6.5 rows, each row logging every ship's tier; `fleet`'s `base0` measured with every ship hidden in the same run.

Gates: nothing old changes: every edit is a no-op without `d.ship`, `opts.ship` or a ship piece (graphics.mjs every
check, ground-models.mjs (the tanks' draw budgets and bake) unchanged, render-bench `--same` identical on every non-ship
scene and the hangar); no new shader program anywhere (count them: in `fleet` and `shipnear` B ≤ A, nothing compiled at
the first ship seen), no `InstancedMesh`, `flatShading`, `alphaTest`, `DoubleSide`, new texture for ship parts or custom
shader; drawing on demand (`App.stale`) unaffected; the merge never writes the sim (decals, sinking veils and wakes read
the sim as before; water.mjs's `vm.group.visible` toggles still hide the whole ship); no model build, dressing, label or
merge runs synchronously at a ship's first sight in flight.

Tests: `ship-models.test.js` green; `ship-models.mjs`: for each stock ship on a phone (390 × 844, DPR 1.75) and a desktop
(1280 × 720), High and Low, her draws, shadow draws, triangles and bytes at each tier (camera placed for each tier),
reported against §6.3; the merge pixel-equal (one paused frame with the sea's clock held, rendered twice with the merge on
and off: ≤ 0.01 % of pixels differ by more than 2/255); the hysteresis (a camera creeping across each threshold and back
switches once each way); a part shot off (her runs gone, nothing else moves); a wreck baked at T3 and at T1 (one rig mesh,
the layers kept, guns and radars present in both); a tap on a merged part picks it; an old jet and an old tank built
before and after a ship give hash-identical geometry; a far-only stub replaced by the full ship within 2 s on the 4×
profile with no frame over base + 16 ms; the build time from cold at load and the hangar rebuild (§6.5); memory per ship;
graphics.mjs, ground-models.mjs, water.mjs, ship-flight.mjs, deaths.mjs, redraw.mjs unchanged; render-bench before (the
branch tip without a2) and after, alternating, several runs, the spread reported.

Screenshots: `ship-models.mjs --shots` before and after a2 on the same models (they must match), and the tiers coloured
(a debug tint by tier) on a fleet at 30 m, 300 m, 1 km and 3 km, looked at for pops; `.../wp16/look/shots/fleet` frames
from the bench for comparison.

Done when (a2): a1 merged and green; a2's structural checks green (pixel-equal merge, tiers, hysteresis, picking, bake,
part loss, stub, zero new programs, old scenes identical) and the §6.3 table **reported** as measured on today's models
(today's Arley is about 30 draws even merged: 19 material groups, 7 of them per-type textures that can't share a
material, plus ~17 rig meshes; the counts are met in a3).

**a3, integration** (after the lead has merged b, c and d): re-run every a2 check on the final models and make them hold:
the classes and runs from b, c and d's recipes in the merge, `rig.dress` and `superDress`, glass in near, the caps, the
camouflage offsets on a camouflaged ship (paint a test Arley in each camouflage skin: the pattern continuous across parts
when merged and identical to the rigs' picture), the label patches (number and name, a peer's name from its spawn), the
far meshes from each package's layouts. Where a package's code breaks the merge, fix it in place and list each fix in your
report (its owner is done by then). Done when every stock ship meets its §6.3 draws, shadow draws and triangles at every
tier on both profiles and the §6.5 rows hold, measured with the a2 harness, every a2 check green, old scenes identical.
Commit in increments (the container can be replaced) and report as soon as each step's done-criteria hold.

## Ships WP16b: hulls and their dressing

Read docs/ships/BRIEF-common.md first and follow it, and this file's section "Ships WP16: rules and paths for every WP16 package" (paths, order, the rules every package keeps). Your package: **WP16b hulls and their dressing** of the ships
update's detailed models (the design docs/ships/WP16.md: §0, §1, §3.1 (the rows owned by b), §3.1a, §3.2's RIB and
landing-craft fittings, §3.3's hull table, §3.4, §4 whole, §5, §6.3's b allocation, §7, §8's interfaces, §9, §11 items 2,
6, 8, 14-17; spec docs/ships/SPEC.md: §3 hull geometry, §6.1 the hulls, §8.3 "what is hit is what is drawn", §8.4 hole
decals, §12.6). Research: `.../wp16/real.md` §1 (colours, weathering), §2 (each ship: what reads at 1.5 km, 200 m, 30 m),
§3's hull rows; `.../wp16/look.md`'s worst ten #2, #3, #5, #9 and its hull notes; `.../wp16/code.md` §4 "Hulls";
`.../wp16/wp16probe/probe5-single.js` (single-line cut counts). The owner: "the ship models or part models, they are
really not detailed at all, and on ships it should matter, they should be as realistic and as detailed models as there
can be, more than our standard, so please full focus on that once everything else is finished". Today every hull is a
smooth loft with flat bands: no seam, fitting or marking; flat topsides; a light dotted seam at every joint; a blank
transom that fills 40 % of a phone screen in an armed ship's default view.

WP16a's contract (a1) is merged: `SG`, `cutColour`, `wear`, `SC`, the `FIT` library, classes and runs, `shipCtx`,
`shipPartCtx` and `PartPaint.ship`, `CTX_USE` (add your rows with `Object.assign` in your region), the `shipDress` stub in
your region's header (you fill it in). Beside you: WP16a's pipeline (the merge and tiers: `VesselMesh` internals,
render3d), WP16c (superstructure, drive, kit), WP16d (weapons): keep out of their functions; your pieces join the merge
through their classes and `rig.dress`.

You own: parts3d.js `shipHullGeo`, `BUILD.shipHull`, the region `// ==== ships: hull dressing (WP16b) ====` (`shipDress`,
appendages, the label patches' cut (`labelPatch(d, side, text, style)`, called by a2's layer code), the far hull from
decimated rings), the `shull` rows of `CTX_USE`; parts.js the hull art region (`shullDraw`, `shTubeLay`, `shRampLay`,
`shStripe`'s art, new `shHullDress`, `shNumLay`, `shipNumber`, `SH_FONT`); test/browser/builder-shapes.mjs a new section
3f; the `[WP16b]` block of `ship-models.test.js`'s caps. You must not touch: `shullOf`, `shullTris`, `shullPts`,
`shullSec`, `shullPoly`, `def.shull` or any hull field, `clashShape`, ship.js (hits, buoyancy, `holeMarks`), render3d's
decals; WP16a's merge and tiers.

What to build (the design's §4): **two lofts per hull part** over `shullTris`' triangles, never drawn together:
`midOnly`, today's band loft with bent normals on flared topsides and joint caps coloured and normalled like the side
behind them (the joint seams gone); and `near`, the cut loft: **no uniform grid**, cut per face (sides by sign of z, the
deck in plan, the transom in end view) by single-line tone steps at strake edges and frames, the knuckle line, the
boot-top's edges and its ragged top, streak strips ≥ 0.3 m, rust fans, salt, the deck's non-skid fields and margin, the
stealth style's panel grid; coloured per region (plates their own tone ±3 %), the label regions' triangles last in the
index; `shipHullGeo` still calls `shullTris(d)` first (ships-damage #1's regex). `shHullDress(d)`: the per-segment
fitting list from the hull's own rings, ends, class and scale, so every player-built hull gets it. `shipDress(vm,
parts)`: in the vessel frame, culled by every other part's box, rails (stanchions 6 cm, lifelines 4 cm) split where parts
stand, joined across joints, nets along a helideck, the bulwark at the bow, the stealth style (no rails, exposed bitts or
anchors; flush covers as dark regions), shafts and A-brackets to each screw, hung as `rig.dress` on the owning part;
built as a job in flight (a2 calls it), on every rebuild in the hangar. The RIB's collar where today's tube is
(`shTubeLay`: tangent inside the deck edge, inside the box) with rounded and coned ends, seams and loops, her seats and an
arch of `tall` tubes; the landing craft's well walls, ramp hinge and winch; the pontoon's hatch and water rudder; the
flying-boat hull's strakes and step lip as tone steps. `shipNumber(parts, salt)` (a hash of the sorted part types and the
salt: every screen agrees) and the transom name (sanitised: `[A-Z0-9 -]`, two words, ≤ 14 characters; a peer's name is
untrusted text, geometry only); `SH_FONT` (digits and capitals as convex quads) shared with 2D; label patches: the label
region's triangles cut by the glyphs and coloured (port glyphs reading left to right from outside), strokes ≥ 0.3 m for
numbers, 0.15 m for an X name. No draft marks in 3D (2D keeps today's). `shullDraw` drawing the side-visible dressing, the
number and the name from the same functions, culled by `PartPaint.ship.parts` when given; the far hull (every third ring,
bands only). Caps: midOnly ≤ 1.4 k a segment; near loft X ≤ 4.5 k (bow) / 3.5 k, L ≤ 3.8 / 3.0 k, M ≤ 2.2 / 1.8 k, S ≤
1.0 k, one-piece ≤ 1.5 k; a label patch ≤ 0.8 k; dressing on the Arley near ≤ 12 k, fine ≤ 18 k, built ≤ 15 ms desktop;
an X bow's near loft built ≤ 12 ms desktop.

Gates: what is hit is what is drawn: every drawn hull vertex (both lofts and the patches) on a `shullTris` triangle within
1 mm (add the check to the `[WP16b]` block), holes' decals still visible on bare plating (fittings may hide them where a
real fitting would); builder-shapes 3c unchanged and green; new **3f**: on every stock ship and on a cluttered test design
per hull class (every deck place filled), every dressing vertex within its hull's side outline in x-y plus ≤ 1.3 m above
the deck line, |z| ≤ depth/2 + 1.5 cm, transom items ≤ 0.4 m aft of the transom, none inside another part's box, none
within 1 m of the bridge eye (`Ship.eyeOut`'s point), `tall` rods exempt and listed; no coplanar overlay (the swap pair's
twins never drawn together); determinism (dressing hash-identical twice); old craft untouched (graphics.mjs,
ground-models.mjs; an amphibious tank with a hull part draws its tank parts as before).

Tests: ships-damage.test (all, #1 included), ships.test, catalogue.test, `ship-models.test.js` (your block's caps, runs,
coplanarity, relief), builder-shapes.mjs (3c, 3e, your 3f), builder2d.mjs and builder-ship.mjs (the 2D blueprint with
rails, numbers and names: nothing clipped or misplaced), ship-flight.mjs and water.mjs (hulls at sea, sinking, hole
decals) unchanged in what they check; the full node run and keydiff (nothing moves: you change no data).

Screenshots (`ship-models.mjs --shots`, with WP16a's harness): `part-hb*`, `part-ribHull`, `part-lcHull`, `part-pontoon`,
`part-stepHull` and `sheet-shHull`; every ship's `sea-<k>-30`, `-200`, `-1500`, `-weapons`, `-aft`, `-game`, `phone-<k>-game`
and `phone-<k>-chase` (DPR 1.75); the 2D blueprint of every ship; side by side with `.../wp16/look/shots/`
(`sea-arley-weapons`, `sea-cyclon-weapons`, `hangar-cyclon-stern`, `phone-arley-game`, `sea-zodiak-bridge`,
`sea-higgens-chase`). LOOK at them as the owner would on a phone: the bow must flare, the joints must vanish, the transom
must no longer be a blank wall, the number must read in the default views, nothing must crawl as she rolls (watch a few
seconds of `phone-arley-chase` frames), rails must not shimmer at T0.

Done when: the 16 hulls are grade 3 at 30 m (the design's §1 rubric), every stock ship carries her dressing per the
design's §9 checklist rows that are hull items, 3f is green, ships-damage #1 and every hit test hold, your caps met,
nothing old moved. Commit in increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP16c: superstructure, masts, propulsion and kit

Read docs/ships/BRIEF-common.md first and follow it, and this file's section "Ships WP16: rules and paths for every WP16 package" (paths, order, the rules every package keeps). Your package: **WP16c superstructure, masts, propulsion and kit** of
the ships update's detailed models: 28 parts (`shSuper` 10, `shDrive` 12, `shKit` 6) (the design docs/ships/WP16.md: §0,
§1, §3.1's rows owned by c (portholes, windows, doors, roof hatches, superstructure rails, wall weathering), §3.1a, §3.2
(the cosmetic fittings), §3.3's superstructure, propulsion and kit tables, §3.4, §5 (`aegis`, `stealth`, `nb`, `bay`),
§6.3's c allocation, §7 (coverage, parts resting on what is drawn), §8's interfaces, §9, §11 items 1, 3, 4, 5, 12, 18,
20; spec docs/ships/SPEC.md: §6.2, §6.3, §6.5, §12.6). Research: `.../wp16/real.md` §2 and §3's superstructure,
propulsion and kit rows (what each real item's defining shapes are); `.../wp16/look.md`'s worst ten #6, #8, #10 and its
per-part notes; `.../wp16/code.md` §2 (each part's recipe today), §4 "Superstructure, drive, kit". The owner: "the ship
models or part models, they are really not detailed at all, and on ships it should matter, they should be as realistic
and as detailed models as there can be, more than our standard, so please full focus on that once everything else is
finished". Today the deckhouse, funnel, stealth superstructure, hangar and helideck are 12-triangle boxes wearing their 2D
drawings (the helideck's circle a 2.3 px/m smear), the bridge a box with glass, the diesels have the tanks' olive end
faces, all three propellers one four-bladed model scaled.

WP16a's contract (a1) is merged: `SG`, `cutColour`, `wear`, `SC`, the `FIT` library, classes and runs, `far`,
`model(d, flip, skin, ctx)`, `shipPartCtx` (`nb`, `bay`), `CTX_USE` (add your rows with `Object.assign` in your region),
the `superDress` stub in your region's header. Beside you: WP16a's pipeline, WP16b (hulls), WP16d (weapons): keep out of
their functions.

You own: parts3d.js `shipKit`, `shipKit2`, `shipAnim`, the region `// ==== ships: superstructure, drive, kit (WP16c) ====`
(`superDress`), the rows of `CTX_USE` for your styles (`bridgeL`, `house`, `hangar`: aegis, stealth, nb, and `house`: bay;
`bridge`: nb; `lattice`: aegis); parts.js the kit art: `shBridgePts`, `shRudderLay`, `shWindows`, `shKit`, `shKitPlan`,
`shKitEnd`, `shKitPts`, `shOutboardLay`, `shJetLay`, `shFoilLay`, `shLatticeLay` (art fields only), `shKit2`, `shKit2Plan`,
`shKit2End`, a new `shKitLay(d, ctx)` (every window, door, porthole, ladder, vent, raft, boat bay, louvre and yard
position, and the part's `far`, read by 2D and 3D); test/browser/builder-shapes.mjs a new section 3g; the `[WP16c]` block
of `ship-models.test.js`'s caps. You must not touch: any def field (sizes, masses, styles, `control`, `funnel`, `deck`,
`hangar`, `stealth`, `screw`, `foil`, `jet`, `steer`), `def.screw.y` against `shOutboardLay`'s hub and `def.foil.y`/`chord`
against `shFoilLay` (add fields, never move these), the roles and pivots (`shScrew` about x at the hub, the port one
turning back; `shRud` about y at `L.xs`; `shOut` at `cl`; `shJet` at `xn`), ship.js, WP16a's merge.

What to build: every part in the design's §3.3 rows for c, by class (mid, near, fine), its cut-in colours and its far
silhouette, all inside its box (builder-shapes 3e; `tall` rods exempt and listed). **Roofs at the box top** on every
building (masts, radars and close-in guns stand there); walls covering each face per §3.1a (leans and chamfers ≤ 0.5 m,
recesses ≤ 2.4 m, the boat counting); per-part `nb` removes a butted wall's doors, ladders, rafts and coaming end; roof-edge
rails, inclined ladders between levels and roof whips are `superDress`'s, per vessel, culled by every other part's box +
0.3 m (never across a joint, never under something standing on the roof), `tall` rods above the roof. The Wheelhouse with
its reverse-raked recessed windows, visor, doors, porthole discs, sidelights, a searchlight and horn in a free front roof
corner's notch; the Helm Console's windscreen, grab rail, wheel, binnacle, leaning post and a pintle post to its top; the
Bridge's two full-depth decks with enclosed wings, the raked window band, open wing platforms (notches) with searchlights
and a pelorus, raft racks, and with `aegis` the leaning walls and the four octagonal array faces; the Deckhouse with
`bay` (the one nearest amidships) carrying the boat bays (2.2 × 6 × 2.4 m, the RHIB filling the lower half to the face)
and a davit each side, the others rafts and doors instead; louvred vents, roof kit, and with `aegis` lean; the Stealth
Superstructure's facets (a knuckle on the box face, split normals), flush window band, flush recesses and composite panel
grid; the Lattice Mast raked inside its box with platforms, yards (mid), ESM domes (mid), lights, whips, pennant, a top
gearbox block for the antenna standing on it and a sooty top, and with `aegis` a raked tripod; the Pole Mast's yard,
lights, top gearbox, whip and pennant; the Funnel's taper, raked top, uptakes with rims, louvred grilles, whistle, ladder,
black cap and soot, and an explicit far with its black top; the Helicopter Deck's top as a swap pair (midOnly plain,
near marked: no texture, the 2.3 px/m bug gone), the haul-down groove, edge lights, safety nets' frames and strands
(closed thin boxes), brackets under any overhang; the Hangar's recessed roller door and its slats, personnel door,
vents, rafts; the propellers' skewed blades (3, 4 and 5) with a fat hub and rope guard; the rudders' taper, palm and
anode; the outboard's cowl, plate, gearcase, propeller and bracket on `shOut`; the waterjet's bucket arms and intake
grille; the hydrofoils' struts, flaps, pods and fairings, coloured by height like a hull (grey, boot-top, antifouling);
the inner diesels, turbine and kit as tidy hangar and X-ray models in light colours (sRGB luminance ≥ 0.7, so X-ray's
`GV_MOD` multiply still reads; no olive); the Torpedo Decoy's winch, sheave and towed body. The 2D side, plan and end
views redrawn from `shKitLay` so 2D and 3D agree. Caps (the design's §6.3 c allocation; mid / near / fine): the Bridge ≤ 3
/ 5 / 2 k, a Deckhouse ≤ 1.5 / 3 / 1 k, the Lattice Mast ≤ 2 / 2.5 / 1.5 k, a Funnel ≤ 1 / 1 / 0.3 k, the Helicopter Deck ≤
0.5 (with its midOnly top) / 1.5 / 2 k, the Wheelhouse ≤ 1.2 / 2 / 0.8 k, the Hangar ≤ 1.2 / 2 / 0.8 k, the Stealth
Superstructure ≤ 2.5 / 2 / 0.5 k, a screw ≤ 1.8 k, a rudder ≤ 0.6 k, the rest ≤ 2.5 k in all; `superDress` on the Arley
near ≤ 2 k, fine ≤ 8 k; the hangar ≤ 2 meshes per part plus its moving nodes.

Gates: inside its box at rest (3e, unchanged, green); the coverage check (`ship-models.test.js`) green for every building
and ctx variant; new **3g**: on every stock ship and a cluttered design, every part resting on another (its box bottom
within 2 cm of the other's box top) meets that part's drawn top within 2 cm (rays down at its footprint's centre and
corners shrunk 10 %); a helicopter lands on what is drawn (the deck surface to its `deck.hw`); no coplanar overlay
(cut-in colour, recesses, swap pairs); deterministic; nothing old changes (graphics.mjs, ground-models.mjs; `plated`,
`latheGeo`, `roofFit`, `gvKit` for tanks untouched: gate everything on your styles).

Tests: `ship-models.test.js` (your block's caps, roles and pivots, inside the box, coverage, classes and runs, relief),
builder-shapes.mjs 3e and your 3g, catalogue.test, builder-ship.mjs (X-ray of a ship: the inner parts read), ship-drive.mjs
(propellers turn, rudders, outboards and waterjets swing as before), ship-flight.mjs (the bridge view never inside a part,
a helicopter on a deck), the full node run and keydiff (nothing moves).

Screenshots (`ship-models.mjs --shots`): `part-*` for your 28 and `sheet-shSuper`, `sheet-shDrive`, `sheet-shKit`; every
ship's `hangar-<k>-zoom`, `sea-<k>-bridge`, `-30`, `-200`, `phone-<k>-chase` and `phone-<k>-chase-low`; the Vizby's and
the Arley's `-1500`; the 2D blueprints (side, plan, end views) beside the 3D; side by side with `.../wp16/look/shots/`
(`beside-ship-jet-tank`, `hangar-olivar-zoom`, `hangar-cyclon-zoom`, `sea-vizby-bridge`, `sea-arley-chase`, `sheet-shSuper`,
`part-helipad`). LOOK at them beside the Sugoi-27 and the MA-1 in the hangar: the ships' superstructure must read as more
detailed than both; on the Olivar the long block must read as one (no rail fences or doors at the joints); nothing floats.

Done when: every part seen at sea is grade 3 at 30 m (the design's §1 rubric), the inner ones tidy, light and olive-free,
the helideck's markings sharp in every tier that draws them, 3e, 3g and the coverage check green, your caps met, nothing
old moved. Commit in increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP16d: naval weapons and sensors

Read docs/ships/BRIEF-common.md first and follow it, and this file's section "Ships WP16: rules and paths for every WP16 package" (paths, order, the rules every package keeps). Your package: **WP16d naval weapons and sensors** of the ships
update's detailed models: the 15 `shArms` parts (the design docs/ships/WP16.md: §0, §1, §3.1's weathering row for
weapons, §3.1a, §3.3's weapons table, §3.4, §5 (`stealth`, `egg`), §6.2's rig shadow rule, §6.3's d allocation,
§7, §8's interfaces, §9, §11 items 12, 13, 18; spec docs/ships/SPEC.md: §6.4, §8.1, §8.6, §8.10, §12.6). Research:
`.../wp16/real.md` §3's weapons and sensors rows (each real item's defining shapes: the Mk 45 Mod 4 house and plain
barrel, the OTO 76's evacuator and slotted brake, the Bofors 57's jacket, the Phalanx's radome, drum, six barrels and FLIR,
Harpoon canisters with rings on a frame, the Mk 41 module's 2 × 4 hatches and uptake strip, the Mk 32 triple tubes, the
SPS-49 mesh, a slotted waveguide, the SPG-62 dish and yoke, the Mk 92 egg, the Mk 137's tubes at 45° and 60°) and §2's
per-ship notes (the Vizby's hidden launchers, tubes and decoys, the Osca's canisters with rings); `.../wp16/look.md`'s
worst ten #1, #7, #8 and its arms notes; `.../wp16/code.md` §4 "Naval guns", "Naval radars", "Gun House", "Ring". The
owner: "the ship models or part models, they are really not detailed at all, and on ships it should matter, they should
be as realistic and as detailed models as there can be, more than our standard, so please full focus on that once
everything else is finished". Today the first thing an armed ship's camera shows is an olive tank turret on a grey ship
(the Gun House and ring wear the Armour's art: `gvTurret` ignores `look: 'navyGrey'`), the naval guns are the tank gun,
the missile launchers planks on sticks, the launch cells skylights, the search radars a 0.34 m strip whatever their size.

WP16a's contract (a1) is merged: `SG`, `cutColour`, `wear`, `SC`, the `FIT` library, classes and runs, `far`,
`model(d, flip, skin, ctx)`, `shipPartCtx` (`egg`), `CTX_USE` (add your rows with `Object.assign` in your region);
WP16a's pipeline merges your static pieces and draws each launcher's lids as one mesh from its `nvCap<k>` subs (keep
those subs, in order), and each moving node as one mesh whose tier is a draw range. Beside you: WP16a's pipeline, WP16b
(hulls), WP16c (superstructure, drive, kit).

You own: parts3d.js `navalKit`, `navalAnim`, `d.ship` branches at the top of `BUILD.tankGun`, `BUILD.radarAnt`,
`BUILD.extrude` (the Gun House) and `BUILD.lathe` (the ring), the region `// ==== ships: naval weapons (WP16d) ====`, the
`CTX_USE` rows for `nvAsm`, `nvTorp`, `nvDecoy` (stealth) and the naval radars (stealth; the track radar also
egg); parts.js `nvKit`, `nvKitPlan`, `nvKitEnd`, the `nv*Lay` art fields, a `d.ship` branch at the top of `gvTurret` into
a new `nvHouseDraw`, `gunLayout`'s naval branch into a new `nvGunLay(d)`, `radarLayout`'s naval branch into a new
`nvRadarLay(d, ctx)`, the ring's naval 2D colour; the `[WP16d]` block of `ship-models.test.js`'s caps. You must not touch:
any def field (sizes, `weapon`, `aim`, `ciws`, `searchRadar`, `trackRadar`, `look`, styles, the Gun House's `outline`, the
ring's `gvRingPath`); the sim-read layouts `nvAsmLay(d).mouth`, `nvVlsLay(d).cells`, `nvCiwsLay(d).gun` (ship.js reads
them: add fields, never move these); Aim's trunnion (−h/2 + 0.18 h) and muzzle (+h/2); the roles and pivots (`yaw`,
`pitch`, `recoil`, `antenna`, `nvYaw`, `nvPitch`, `nvSpin`, `nvCap<k>`); `gunLayout`, `radarLayout`, `BUILD.tankGun`,
`BUILD.radarAnt`, `plated`, `roofFit`, `gvTurret` for every tank (the ground update's parts must stay byte-identical: gate
on `d.ship`); never `body3d` on the Gun House or the ring (it would turn their clash into a box); armour.js, aim.js, ship.js.

What to build (the design's §3.3 weapons rows, each by class, cut-in colour, far): navy grey everywhere `look` says so, in
2D and 3D; the ring's seal band and drains (3 cm recesses) inside its lathe outline; the Gun House as its own outline prism
with panel tones, recessed (5 cm) access doors, roof hatch, gun port slot and sight window, soot and grime, all inside the
prism (builder-shapes 3c, no padding); the four guns from `nvGunLay` (the 57's ribbed jacket, the 76's evacuator and
slotted brake, the 127's long plain taper, the 152's heavy barrel), each with a rubber blast bag on `pitch` and the barrel
on `recoil`; the close-in gun's pedestal, carriage, white barrel-shaped radome with its bulge and flat face, drum, six
barrels with a clamp, FLIR box; the anti-ship launchers' round ringed canisters on a welded frame with their covers on
`nvCap<k>`, and with `stealth` a low faceted deck box with hatch panels (the Vizby's); the launch cells' flush 2 × 4
hatches on `nvCap0..7`, the uptake strip, rim, hinges and grime (real gaps between lids, no painted warning lines: they'd
be sub-pixel strips); the triple tubes in a triangle on their pedestal, and with `stealth` behind a faceted side housing;
the air radar's open-mesh rectangle **filling its box above a 0.15 m turntable** with its horn feed (the board at mid, the
bars at near and fine; the gearbox is the mast's), the surface radar's slotted bar (the slot row a 3 cm groove), the
fire-control radar as a dish on its yoke, a **white egg radome** on `yaw` with `egg` (the `pitch` node kept, empty), each
with a faceted housing under `stealth` (roles kept, empty where hidden); the decoy launcher's six tubes at 45° and 60°, and
with `stealth` under a faceted flush-hatch box. No relief under 3 cm (no bolt heads or lifting eyes: colour or nothing).
The 2D views from the same layouts. Caps (the design's §6.3 d allocation; mid / near / fine): the Gun House ≤ 1 / 1 / 0 k,
a gun ≤ 0.6 / 0.6 k, the close-in gun ≤ 1.5 / 1.5 / 0.3 k, the air radar ≤ 0.8 / 1.2 / 1.5 k, the surface radar ≤ 0.4 /
0.4 k, the FC radar ≤ 0.6 / 0.6 k, a launcher ≤ 1 / 0.8 / 0.3 k, the cells ≤ 0.4 / 0.4 / 0.2 k, the tubes ≤ 0.5 / 0.5 k,
the ring ≤ 0.3 / 0.1 k, the decoy ≤ 0.3 / 0.3 k; exactly one mesh per moving node (the pipeline's draw budget counts on
it); the parts whose moving node is under 1 m in bounding radius don't cast (the pipeline's rule: design the CIWS drum,
the FC radar and the barrels' spin group knowing it).

Gates: inside its box at rest (3e) or its outline (3c: the Gun House, the ring); the sim-read layouts identical
(`ship-models.test.js` snapshot); no coplanar overlay; deterministic; every old tank gun, ring, turret and radar unchanged
(ground-models.mjs, graphics.mjs, builder-tank.mjs, render-bench's hangar `--same`).

Tests: `ship-models.test.js` (your block), builder-shapes.mjs 3c and 3e, catalogue.test (59 parts, styles, `look`),
ships-combat.test (guns, launchers, cells and the close-in gun fire from where they did), aim.test, armour.test,
ground-models.mjs, ship-flight.mjs (gunnery and missile scenes: the barrels recoil, the close-in gun trains and spins, the
lids go as the cells fire, the egg turns), the full node run and keydiff (nothing moves).

Screenshots (`ship-models.mjs --shots`): `part-*` for your 15 (each ctx variant: plain, `stealth`, `egg`) and
`sheet-shArms`; every armed ship's `sea-<k>-weapons`, `-30`, `-200`, `-game`, `phone-<k>-game` and `phone-<k>-chase`; the
2D blueprints; side by side with `.../wp16/look/shots/` (`sea-arley-weapons`, `sea-pegazus-weapons`, `sea-osca-aft`,
`sea-olivar-bridge`, `sheet-shArms`, `part-nHouse127`, `part-nRadarAir`). LOOK at them: no olive anywhere on a ship part,
each weapon recognisable as its real kind in the default views.

Done when: the 15 parts are grade 3 at 30 m (the design's §1 rubric), no olive on any ship part, the guns, launchers and
radars read as the real kit in the default views, your caps met, every check above green, nothing old moved. Commit in
increments (the container can be replaced) and report as soon as the done-criteria hold.

## Ships WP16e: the stock ships, the budgets met, the proof

Read docs/ships/BRIEF-common.md first and follow it, and this file's section "Ships WP16: rules and paths for every WP16 package" (paths, order, the rules every package keeps). Your package: **WP16e the stock ships, the budgets and the proof**
of the ships update's detailed models (the design docs/ships/WP16.md whole, above all §1, §6.3, §6.5, §7, §7a, §9, §12;
spec docs/ships/SPEC.md: §7 the stock ships and their balance targets, §14 invariants, §15). The owner: "the ship models
or part models, they are really not detailed at all, and on ships it should matter, they should be as realistic and as
detailed models as there can be, more than our standard, so please full focus on that once everything else is
finished". The owner was told the detail is looks only: your template moves are the one exception, each listed so the
lead can tell them.

WP16a (contract, pipeline and the a3 integration), WP16b (hulls), WP16c (superstructure, drive, kit) and WP16d (weapons
and sensors) are merged. Read their reports first, a3's above all: the budgets met or missed, the fixes it made, anything
left for you.

You own: builder.js `TEMPLATES`' ships block (the design's §7a list only: the Arley's gun group to x ≈ 70, her aft
Vertical Launcher to ≈ −49.5, ahead of her flight deck, and her forward Deckhouse from x 28 to 30 (its fore face on the
Bridge's aft face; the funnel at 26 stays on it); the Olivar's gun group to ≈ 52.6; the Vizby's to ≈ 31.5; the Pegazus'
aft until the house's fore corners are inside the deck; the Zodiak's and Higgens' heavy MGs onto the console's post if a
gap over 5 cm remains; `navyGrey` paint for the old weapon parts aboard the Cyclon, Osca, Zodiak and Higgens (the Cyclon's
ring and turret keep `patrolWhite`)), every new position placed by `Ship.spotOf`'s taps where it can be; the re-baselines
of those ships' own keys; the final measurements and pictures. Nothing else: no part added or removed, no mass, price or
def changed; a fault found in another package's code goes back to the lead as a finding (with the repro), not fixed in
your worktree unless the lead says so. If the owner answers the design's §12 questions before you start, follow the
answers (question 2 can drop any move).

What to do: the moves and paints, each one its own small commit naming the keys it moves; ships.test's §7 trials for
each moved ship (displacement, speed, turning, roll, cost in tier) still green; builder-shapes 3e, 3f and 3g green on the
moved ships (nothing floats, nothing clashes); `node test/run.mjs` with every old baseline identical and only the listed
ships' keys moving (keydiff 71c3af7 with the ship keys `--add`ed as BRIEF-common says, and the moved keys listed); then
the proof: `ship-models.mjs` on a phone (390 × 844, DPR 1.75) and a desktop (1280 × 720), High and Low, every stock ship at
every tier against the design's §6.3 table; render-bench before (the branch tip before WP16a) and after on `ship1k`,
`shipbig`, `phonechase`, `hangarship`, `shipnear`, `fleet` (phone Low and High, desktop High; several alternating runs,
the spread reported, every ship's tier logged) against the §6.5 rows, and `--same` on every non-ship scene and the
hangar; graphics.mjs, ground-models.mjs, water.mjs, ship-flight.mjs, ship-drive.mjs, deaths.mjs, naval-range.mjs,
naval-practice.mjs, naval-battle.mjs, builder-ship.mjs, builder-shapes.mjs, controls.mjs, redraw.mjs; the longest frame on
the 4× phone profile while the Naval Practice battle spawns six ships (≤ base + 16 ms), and a peer's unknown design
arriving in a two-window room (the number and the name the same on both screens).

Screenshots: `ship-models.mjs --shots` for every ship and part; for each ship, before (`.../wp16/look/shots/`) and after
sheets side by side at 30 m, 200 m and 1.5 km, the game's own view on a phone in portrait (DPR 1.75) and a desktop, the
phone's chase on High and Low, and the hangar zoom beside the Sugoi-27's and the MA-1's (`beside-ship-jet-tank`); tick the
design's §9 checklist for every ship, item by item, in the named shots, and write down what fails. LOOK at them as the
owner would: on a phone, in portrait, in the first second of a flight.

Done when: every stock ship meets the §6.3 table on both profiles, the §6.5 rows hold, every old baseline and old scene is
identical, the moved ships' trials pass and their keys are listed, the §9 checklists are ticked (or each miss reported
with its shot), and the before/after sheets are in the report for the lead's PR body (a table of triangles, draws and
shadow draws per ship, before and after, has gone down well with the owner). Commit in increments (the container can be
replaced) and report as soon as the done-criteria hold.
