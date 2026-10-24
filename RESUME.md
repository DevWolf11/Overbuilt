# Ground update: where it stands (paused 2026-10-24)

## State
- PR #38 (branch `ccr-932b9082-m4kox7`, marked "in progress, don't merge"), head **8b96309**, pushed.
- **Done and merged:** skeleton; Phase 0 (driving traces, arena probe, bench); Phase 1 (hooks, 71 parts, 37 shells, 4 paints, save path with mm and RSS3 codes, turret groups, Highland Ridge pads/berms/fade), reviewed with 7 fixes; Phase 2 (2A movement, 2B armour, 2C aim and weapons, 2D models and art, 2E builder), merged with seam fixes. `node test/run.mjs --browser`: all 30 suites pass, every old baseline identical (driving gained 6 tank entries, additions only).
- **Interrupted:** the Phase 2 adversarial review. The armour lens finished with 11 findings (in `p2-reports.txt`, section "review: armour"); the physics and weapons lenses were running and are lost; visual and old-designs never started. No Phase 2 fixer has run.

## Files in this notes branch (they lived in the session scratchpad)
- `spec.md`: the design (16 sections; "(P1 review)" notes override the text around them).
- `p1-summary.txt`, `p1-reports.txt`: what Phases 0/1 delivered and their deviations.
- `p2-reports.txt` / `p2-reports.json`: the five Phase 2 package reports, the merge report (open issues for Phase 3/4) and the armour review's findings.
- `wf-phase2.js`: the Phase 2 workflow (its Review and Fix stages are what's left to run).
- `wf-phase3.js`: the Phase 3 workflow, drafted, not run. Step A: 3I templates and balance + 3G0 GroundMode rules; step B: 3F controls/camera/HUD (with the arena ground mesh decision), 3G Ground Battle, 3H single player and AI; then merge, 5-lens review, fix. Args: `{ base, state }`.
- `map/*.md`: the code maps from the first survey (a little stale).
- `spec/`, `critic/`: measurement scripts the spec cites.

## To resume
1. Restore these notes where the scripts expect them:
   `S=<scratchpad>/ground; mkdir -p $S && git -C /home/user/Overbuilt fetch origin ground-notes && git -C /home/user/Overbuilt archive origin/ground-notes | tar -x -C $S`
   (the scripts hard-code the old scratchpad path `/tmp/claude-0/-home-user-Overbuilt/0587f056-6c41-58cd-9f76-3deee688a95a/scratchpad/ground`: update `SCR` in them if the new session's scratchpad differs).
2. Finish Phase 2's review: run the Review and Fix stages of `wf-phase2.js` (lenses physics, armour, weapons, visual, old-designs) against 8b96309, feeding the armour lens's 11 saved findings straight to its fixer instead of re-reviewing.
3. Phase 3: `wf-phase3.js` with `base` = the reviewed Phase 2 head and `state` = the Phase 2 deviations and open issues (from `p2-reports.txt`, plus `p1-summary.txt`).
4. Phase 4: integration run, performance before/after (the PR #35 method), the final review, docs (README counts and controls, the three control lists, handbook chapters, CLAUDE.md rows and history, test/README rows), NET_VERSION 7 (3G), sw.js CACHE bump, the PR description with tables, and drop "in progress" from the title.

## Usage note
The parallel workflows (5 worktree agents plus reviewers) used up the session's usage limit twice. Consider fewer agents at a time on Wednesday (for example the Phase 3 step-B packages one or two at a time), and smaller review fan-outs.

## Decisions taken (keep unless the owner says otherwise)
- Arena ground mesh on Highland Ridge (a ~20 m grid from the physics heights, replacing the earthworks mesh and the in-arena reseat), so what you see is what you hit (in the 3F brief).
- Balance (3I brief): lower front plates stay a weak spot but a 75 mm AP shouldn't pass a TK-34's front beyond about 500 m; 12.7 mm MGs go through armoured cars, open tops and light sides up close, never medium tank sides; engine/track data adjusted only if a stock vehicle badly misses its role. Phase 2 also flagged: one 85 mm APHE through a Tygr's front at 300 m always cooks off its ammo (lethal; worth tuning), and the MA-1's 22 cm slot under the turret overhang.
- Open from Phase 2's merge: Aim.limits' first-aim hitch (11-36 ms; move to launch), the aim step's 27-42 µs per substep (bench it in the browser), fires/ko not saved in flights, nothing sets v.wreck for solo targets yet (3H), the flight HUD still shows the rocket bar for tanks (3F).
