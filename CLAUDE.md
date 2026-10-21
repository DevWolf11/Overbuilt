# Overbuilt: working notes for Claude

A free browser game: build any machine from parts, then take it anywhere. It mixes the rocketry of Spaceflight Simulator and Kerbal Space Program, the free-form building of SimplePlanes and the combat of War Thunder. Today you build rockets, planes, cars and helicopters from parts on a 2D blueprint or in 3D; ships, tanks and sci-fi craft are planned, which is why the name is not about any one vehicle. You then fly them in a full 3D world: the real Earth at 1/20 scale with the space centre on the Faroe Islands, plus a small solar system. It has weapons, AI targets and damage, and online multiplayer (sandbox and PvP battles). It is plain JavaScript and three.js, with **no build step and no modules**. It runs from `index.html`, on desktop and phones.

- **Live:** https://devwolf11.github.io/Overbuilt/ (GitHub Pages, deployed from `main` on every push).
- **Repo:** `DevWolf11/Overbuilt`. It was renamed twice (`Cam-Strike` → `Rocket-Science-Simulator` → `Overbuilt`), so local clones and some session settings still use an old name (see Gotchas).
- **Deep reference:** `docs/HANDBOOK.md` covers every subsystem: data model, physics, rendering, combat, multiplayer, app shell, and where things live by `file:line`. Read the chapter for the area you are about to change before changing it.
- **Tests:** `test/README.md`. Run `node test/run.mjs` (about 40 s) before every push, and add `--browser` when you touch the builder, rendering or multiplayer.

## The owner and how to work with them

- **How they ask.** They write short, informal, fast requests, often with typos ("truster", "cust0omized") and several features in one message. Read for intent, deliver every part, and list the assumptions you made at the end of your reply. Ask only when two readings would lead to very different work.
- **Ambitious updates.** They think in "updates": "a plane update", "a military update", "the biggest update yet: multiplayer". They expect the whole thing, polished, tested and documented, not a first slice. Break big work into phases, but ship it complete.
- **Fun beats realism when the two conflict.** "Make them more realistically controllable but keep the unprofessional chaos." There is a secret settings menu of joke options (tap the Options title seven times), including the old camera bug, because "people thought it was funny". Don't sand the personality off.
- **Control comes first.** When a safety system made planes harder to fly (a g-limiter), they asked for the old controls back with only the breakage fixed. Overspeed is a warning, never a hard limit. Prefer warnings over taking control away from the player.
- **They test on a phone in portrait and on a desktop.** They send screenshots of bugs. The phone layout matters as much as the desktop one.
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
   - **Controls:** keep them in sync in three places: README's table, `App.showHelp` (js/main.js) and `Flight.controlsHelp` (js/flight.js).
   - **sw.js:** bump `CACHE` (`overbuilt-vN`) on any change to cached files, and add new files to `SHELL`. Every `SHELL` entry must exist, or the offline install silently fails.
   - **A new js file:** a `<script>` tag in `index.html` in dependency order, a `SHELL` entry, and a README "Project layout" line.
5. **Commits and PRs.**
   - Commit subject: `Area: what changed, in player terms` (e.g. "Plane handling: coordinated turns, no fishtailing, no stall-outs in climbs"), then a prose body.
   - PR bodies: what's in it (by area), what the review fixed, tests run with results, and tables where they help. Tables of before/after numbers have gone down well.

## Architecture in one screen

Plain `<script>` files share one global scope. They load in this order (index.html:332-352):

| File | Owns |
|---|---|
| `util.js` | maths (vectors, quaternions), `fmt`, `store` (localStorage JSON), `$`, `el`, the `Silly` joke flags |
| `space.js` | bodies, Kepler orbits, patched conics, sites (pad, runway, airfields, carriers), the 2D terrain profile |
| `terrain.js` | `Terrain`: the 3D ground (real Earth map or generated), shared by physics and renderer |
| `parts.js` | `PARTS` catalogue (157 parts), geometry, joints (`buildAdjacency`), staging, Δv, design rows, paint (`SKINS`), all 2D part drawing |
| `vessel.js` | `Vessel`: the rigid-body simulation (engines, wings in halves, aero, heat, chutes, wheels, ground and water, splitting, autopilot) |
| `ui.js`, `world.js` | dialogs, toasts and icons; `Settings`, `FX` particles, the 2D fallback flight view |
| `parts3d.js`, `render3d.js` | 3D part models; the three.js renderer for flight, hangar and globe (three.js is lazy-loaded) |
| `audio.js`, `career.js`, `map.js`, `globe.js` | procedural sound; career and missions; solar-system map; globe map |
| `combat.js` | weapons, projectiles, missile guidance and countermeasures, damage, target range, AI fighters |
| `builder.js` | `TEMPLATES` (25 example craft); `Builder`, the build screen (2D and 3D, attach system, symmetry, depth, paint, hangar, codes) |
| `flight.js` | `Flight`: flight loop, time warp and rails, controls, HUD, camera, saving, staging, breakage |
| `net.js`, `mp.js`, `mpui.js` | multiplayer: transport (PeerJS or BroadcastChannel), host relay, sessions and battles, ghosts, hits; the screens |
| `main.js` | `App`: screens, main loop, settings dialog, service worker |

**Coordinates (memorise these).** Part space is the builder's.
- Rockets: y up, x across the blueprint, z depth toward the viewer.
- Planes: **+y = nose, +x = down, +z = right wing**. The 2D blueprint is a side view from +z.
- `p.z` is a part's depth. A *twin* part (`def.twinZ`) is one part drawn as a pair at ±z. Wings, legs and fins are locked at z = 0.
- `p.att` is the part it hangs on: an **id** in memory and in flight saves (`rss.flight`), an **index** in design rows (`rss.design`, the hangar, design codes), and the owner's id in multiplayer spawn rows.
- In the sim, game east is decreasing angle and game north is −z.

## Invariants (break these and something old silently changes)

- **Old designs must load, join, fly, heat, take damage and look exactly as before.**
  - Twin pairs saved before depth existed keep the old rules:
    - `legacyTwin` (parts.js: no `att`, at the default spread within 5e-4) drives `partsClash` and `partsTouch`; `designRows`, parts3d.js and combat.js (a pair at its default spread blasts once, at the centre) use the same 5e-4 test.
    - `pylonLink`, `guessHost` and `oldStruts` treat *any* twin with no `att` the old way, at any spread.
    - Heating (vessel.js) counts a pair's distance from its default spread, so a pair at the default spread heats as if on the centre line.
  - `test/traces.js`, `fingerprint.js` and `combat.test.js` exist to prove you kept this.
- **Never change an existing part's key, `w`/`h`, `twinZ` or z-lock.** Saves store absolute positions and omit default depths. Add a new part instead.
- **Sanitise everything loaded or received:**
  - `partsFromDesign`, `cleanZ`, `cleanSkin`, `cleanAtt`, `hasOwn(PARTS, …)`;
  - `mpSpawnRows` for peers;
  - `Vessel.restore` for saves.
  - Peers are untrusted. Never put peer text into `innerHTML`; `UI.modal` renders a string body as HTML.
- **Multiplayer:**
  - Bump `NET_VERSION` (net.js) when an older peer would build, pose or hit a different craft.
  - Damage to another player's craft goes through `MP.sendHit(s)`; `Combat.damage` is a no-op on `v.remote`.
  - AI, range targets and auto-flares are off in any room.
- **No `import`/`export`, no `type="module"`, and no `fetch` of local files that the game can't do without.** It must run from `file://`; only the Earth map may fail there, and it falls back to generated terrain.
- **Top-level names are global across files.** A duplicate `const` kills every later script. Check with `grep -n "^const NAME\|^function NAME" js/*.js`.
- **2D and 3D must agree.** Plumes, sky colours, clouds in the flight plane, the space-centre layout, the reentry sheath and paint stripes are implemented twice (handbook §3.7 has the table). For shapes built by parts3d's lathe or extrude recipes, the 2D outline (`partPath0`) is also the 3D silhouette unless parts3d has a `PROFILE` for it. Other recipes build from the def and use the 2D art only as a texture.
- **The renderer uses a logarithmic depth buffer:**
  - custom shaders need the log-depth chunks;
  - `polygonOffset` does nothing, so use `depthBias`;
  - put content relative to `F.camAbs` (floating origin).

## Gotchas

- **The repo renames.** Pushes to an old name print "This repository moved" (harmless). GitHub tools and PR subscriptions need the **current** name `DevWolf11/Overbuilt`: with an old name, PR watching reports "the Claude GitHub App isn't installed" even though it is. Fix the remote with `git remote set-url origin https://github.com/DevWolf11/Overbuilt.git`.
- **Old names that stay on purpose.** The `rss.` localStorage keys, the `RSS1.`/`RSS2.` design-code prefix, `RSS_NO_SW` and the `rss-room-` multiplayer prefix date from "Rocket Science Simulator". Renaming them would orphan players' saves and break codes people have shared; the only one players ever see is the start of a design code.
- **`main` is live** the moment it is pushed or merged. Pages publishes the whole checkout, `test/` and `docs/` included.
- **Useful console handles:**
  - `App`, `Builder`, `Flight`, `Render3D.info()`, `Combat.S`
  - `MP.state`, `MP.advance()` (the host skips a battle phase), `Net.pings`
  - `Render3D.skipDraw = true` speeds up headless tests.
- **Test multiplayer locally:** two windows of one browser profile, transport "This device" (BroadcastChannel). Keep both visible, because a hidden tab stops sending.
- **Shared return values.** `Terrain.toGeo`, `Terrain.water`, `bodyPos`/`bodyVel` and render3d temporaries return shared objects; copy them before the next call.
- **`Vessel` call order.** Set `kind` before `rebuildGroups()`, and call `rebuildGroups()` after any change to `parts` or `adj`.
- **Known loose ends:** handbook §7.

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
