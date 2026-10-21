# Tests

The game has no build step and no test framework, so these are plain Node scripts. The headless ones load the game's own `js/` files into a Node VM (see `lib/game.js`), with no DOM or WebGL, and drive the real physics, combat and multiplayer code. The browser ones open the game in headless Chromium through Playwright.

```
node test/run.mjs              # the headless suites, about 40 s
node test/run.mjs --browser    # plus the browser suites, a few minutes
node test/run.mjs traces mp    # only suites whose file names contain these words (browser ones too:
                               #   "mp" also runs browser/mp-two-tabs.mjs; "mp.test" is the headless one)
node test/run.mjs -v           # print every suite's output, not only failures
node test/run.mjs traces --update   # rewrite the named suites' baselines (no name: all of them)
node test/traces.js            # any single suite runs on its own too
```

You need Node 18 or newer, plus Playwright and a Chromium: the browser suites need them, and so does the one-off decoding of the Earth map that the headless suites use (see below). If `PLAYWRIGHT=/path/to/playwright/index.mjs` is set, that is used; otherwise a local install, then the global one (`npm root -g`). Set `CHROMIUM=/path/to/chrome` to use a particular browser. The 3D view runs on software WebGL (SwiftShader), so no GPU is needed.

## Suites

| Suite | What it guards | Baseline |
|---|---|---|
| `fingerprint.js` | Every template and the AI raider: which parts join, what flies, stages, Δv, mass, centre of mass, full inertia, hull, reach, wheels | `baseline/fingerprint.json` |
| `traces.js` | 12 s of flight for every template with a fixed script of stick inputs, at full precision. Shows **any** change to the physics. | `baseline/traces.json` |
| `handling.js` | Plane handling table: hands-off drift, banked turn, climb to stall, full back stick. Also checks that no plane departs (loses control). This is the tool for tuning flight controls. With a plane filter or another SAS mode (`node test/handling.js hornet,jumbo off`) it prints the table only. | `baseline/handling.json` |
| `core.test.js` | The part model with depth, attachment and paint: clashes at different depths, legacy twin pairs, design rows round trip, cleaning of bad rows | — |
| `physics.test.js` | Off-centre thrust and its torque, `com.z`, the inertia tensor against a brute-force sum and its inverse, hull, propeller torque on either wing, off-centre chutes, saving and restoring, debris splitting, heating of the windward copy | — |
| `flight.test.js` | A torn-off wing takes what hangs on it; explosions at a part's depth; 2D draw order | — |
| `combat.test.js` | Hits, blasts, muzzles and release order for parts at a depth; then a fingerprint of every stock plane (hit boxes, muzzles, blast damage, gun rounds, flares, turret) | `baseline/combat.json` |
| `flutter.test.js` | Wings and speed: each wing's breaking speed and Mach limit against the table asked for (and a plain wing's HUD breaking speed at every height), the warning before it, flutter tearing a wing off within seconds (at once far past the limit), the Mach limit up high and its fade in thin air (a space plane coming home), noodle wings, torn-off pieces flown on without tearing again, and which warning shows (slow down vs ease off) | — |
| `mp.test.js` | The multiplayer spawn-row sanitiser on forged input; ghosts built from it; owner→ghost round trip; snapshots with `com.z`; the carrier size check; the 600-part cap; `battleDesign` | `baseline/mp-measure.json` |
| `browser/builder2d.mjs` | The 2D builder: depth keys and slider, pods on wings, parts following their host, paint (Match, All, inherited), design codes, old saves, grid mode, rocket boosters | — |
| `browser/builder3d.mjs` | The 3D builder: the pointer finds a wing at depth, a jet dropped under it hangs there with a twin, paint, and the craft flies with depth and paint | — |
| `browser/redraw.mjs` | Redraw on demand: every kind of edit, by hand and from code, shows at once in the 2D and 3D hangar, and the idle hangar draws nothing (with the half-second safety-net redraw turned off, so a missed `Builder.redraw()` fails). On synthetic frame times: the frame cap gives a 90-144 Hz screen 60 frames' work a second; the home backdrop draws 30 times a second, and a paused flight or anything under a dialog 10 | — |
| `browser/mp-two-tabs.mjs` | Two tabs in a local room: the ghost matches the owner's craft exactly, oversized messages are dropped, a forged spawn is rebuilt clean | — |

## Baselines

A baseline is the output of the code on `main`. The suites that have one compare against it and print each difference. When a change is **meant** to alter results (new physics, a new part in a template, retuned handling), check that the differences are the ones you expect and nothing else. Then rewrite the baseline:

```
node test/traces.js --update        # one suite
node test/run.mjs traces --update   # the same through the runner; with no suite named, every baseline
```

Commit the new baseline with the change, and say in the commit why it moved. A refactor that should change nothing must leave every baseline identical. That is the main point of `traces.js`: it shows even a last-digit change in any template's flight.

## How it works

- **`lib/game.js`** runs `util.js`, `space.js`, `terrain.js`, `parts.js` and `vessel.js` (plus `combat.js`, `world.js`/`flight.js` or `mp.js` on request) in one VM context, the way the page does. It stubs `Sound`, `FX` and `Settings` where needed. `combat.js` gets its internals exposed as `Combat._t`.
  - `G.craft()` builds a vessel the way `Flight.start` does (parts, joints, the part tree holding the control part, stages), then places it on its kind's launch site, or 3 km over the sea with `'air'`. Unlike `Flight.start`, it doesn't move float planes to the bay or idle a helicopter's throttle.
  - `G.sim()` is a stand-in for `Flight`.
  - `G.run(ctx, code)` runs code inside the game's scope. Top-level `const`/`class` names aren't properties of the context; use `G.run` to reach them, or add them to the list at the end of `load()`.
  - `ROOT=/other/checkout node test/...` runs a suite against another copy of the game. That is handy for comparing against an older commit (`git worktree add /tmp/old <commit>`).
- **`lib/earth.js`** provides the real Earth map. Node can't decode the PNG and JPEG layers, so the first run decodes them once in Chromium (`lib/dump-earth.mjs`, exactly as the game does) into `test/.cache/earth/` (gitignored, about 28 MB). The cache is redone automatically when the size of any file in `assets/` changes; after a re-bake that keeps the sizes, run `node test/lib/dump-earth.mjs` by hand. So even the headless suites need Playwright, once.
- **`lib/browser.mjs`** provides a static server on a free port, the Chromium launch flags, a fresh game profile (`openGame`) and the same ok/FAIL check list. Screenshots land in `test/.cache/shots/`.
- **`lib/baseline.js`** compares results with a baseline or rewrites it.

## Writing a new check

Put it in the suite it belongs to, or copy a small one such as `core.test.js`. Prefer checks that would fail on a real regression: compare with numbers worked out independently (a brute-force sum, a mirror image, a round trip), not with the code's own output. For whole-game behaviour, extend a fingerprint. Run the suite before and after your change to the game: it should pass before and fail without your fix.
