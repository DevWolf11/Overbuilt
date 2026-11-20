# Common brief for every ships work package

You are implementing one work package (WP) of Overbuilt's ships update (repo DevWolf11/Overbuilt).
- Start: in your worktree run `git merge --ff-only ccr-932b9082-m4kox7` (the branch tip at the time you start), or `git checkout -B <your branch> ccr-932b9082-m4kox7` if ff fails. Never push.
- Read CLAUDE.md (its invariants apply in full: old designs byte-identical, no modules, duplicate-global check, sanitise loaded/received data, phone and desktop both matter, battery matters).
- The spec: docs/ships/SPEC.md (rebuilt; docs/ships/SPEC-recovered.md has the original fragments; the code is the truth for what is built). Read §0, §2, §13, §14, §16 (your WP's row and "The Ship API"), and the chapters for your area. The code maps (map-*.md beside it) help you find things. WP0's report on what exists is summarised in the commit message of 95bf553 (`git show --stat 95bf553` and read js/ship.js's header).
- Ownership: edit only the files / named regions your WP owns (spec §16). Other WPs are working in parallel on the rest; if you truly need a change in a file you don't own, make it minimal, mark it `// [WPn] ...` and list it in your report so the lead can merge it.
- Where the spec and the code disagree, the code wins; adapt and report it. Tune numbers by tests, not by hand-waving.
- Tests: `node test/run.mjs` must stay green with every old baseline key identical (prove with `node test/tools/keydiff.mjs 71c3af7 --add <suite>:<key>,...` for any key you deliberately add; a ship template's own keys may move, say so). Add the tests your WP row lists. For anything visual, take Playwright screenshots (test/lib/browser.mjs; headless runs at ~0.08x real time: measure Flight.time) and LOOK at them; check the console for errors (App.frame swallows exceptions).
- Commit in your worktree (one or a few commits). Subject "Ships: <what changed, in player terms>", prose body, ending with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019sDgipUc8ms82QNRTPgYyT
- Don't edit README/CLAUDE.md/HANDBOOK (docs come at the end); do keep the spec's numbers in SHIP.
- Report back: commit ids, worktree path and branch, what you changed per file, deviations from the spec and why, test results with counts, screenshots paths, and what the other WPs / the lead must know (interfaces you rely on or changed).
- Since Phase 0: career mode is REMOVED (no funds, tiers or missions; `Budget` in util.js holds a multiplayer battle's budget; prices show only when `Budget.on`). Add no career content. The sea-crash fix (death.js `SEA`, `seaPose`, `swamp`, vessel.js `waterSlam`) is in: hydro vessels are excluded from it; keep that.
- Baseline proof for the whole branch: `node test/tools/keydiff.mjs 71c3af7 --add <suite>:<key>,...` for the ship templates' own keys (fingerprint, traces, mp-measure); nothing else may move.
- The machine is shared with other packages: timing checks (armour, groundai, props, graphics job slice) may fail under load; re-run them alone before concluding.
- The container can be replaced at any time, and anything not pushed is lost (it happened once: four packages' work and the spec were lost). So work in increments: commit after each working step, keep the lead informed, and finish and report as soon as your package's done-criteria hold rather than polishing past them.
