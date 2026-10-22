# Overbuilt: developer handbook

A reference for anyone changing the code, human or AI. Start with `CLAUDE.md` at the repo root: the owner, the workflow and the rules that matter most. This handbook is the deep end: how each subsystem works, its data and its invariants, with `file:line` pointers.

The handbook was written against `main` at the merge of #29 (October 2026), by reading the code, and has been brought up to date with each PR since (last: #36, the look-alike jets and the builder by shape). Line numbers drift as the code changes, so search for the function name if a line has moved. If the code and this handbook disagree, the code wins: fix the handbook in the same commit.

## Contents

1. [The part model and the builder](#1-the-part-model-and-the-builder): `parts.js`, `builder.js`
2. [Simulation and flight](#2-simulation-and-flight): `space.js`, `terrain.js`, `vessel.js`, `flight.js`, `career.js`
3. [Rendering](#3-rendering): `render3d.js`, `parts3d.js`, `world.js`, `globe.js`, `map.js`
4. [Combat and multiplayer](#4-combat-and-multiplayer): `combat.js`, `net.js`, `mp.js`, `mpui.js`
5. [App shell, UI, settings, packaging and deployment](#5-app-shell-ui-settings-packaging-and-deployment): `index.html`, `main.js`, `ui.js`, `util.js`, `audio.js`, `css/style.css`, `sw.js`, `tools/`
6. [Testing](#6-testing)
7. [Known loose ends](#7-known-loose-ends)

Section references like "§3" inside a chapter mean that chapter's own subsections.


## 1. The part model and the builder

**Files:** `js/parts.js` (catalogue, geometry, connectivity, staging/Δv, persistence helpers, 2D drawing) and `js/builder.js` (`TEMPLATES`, `templateRows`, the `Builder` singleton). Both are plain globals with no modules. Script order matters (`index.html:333-353`):
- `util.js` comes first and provides `clamp`, `TAU`, `G0`, `store`, `el`, `isTouch`.
- `parts.js` loads before `vessel.js`, `parts3d.js`, `render3d.js`, `career.js` and `builder.js`. Since PR #36 parts3d.js reads parts.js globals when it builds: the outline helpers it used to own (`pathRecorder`, `PART_PROFILE`, `partOutline`, `outlineSpan`, `LATHE_SHAPES`, `PART_RECIPE`, `PART_FLAT_DEPTH`, §4) and the look-alike jets' lofts and camouflage tiles (`us5Lofts`, `ruLofts`, `us4Rows`, `us5CamoTile`, `camoCanvas`, `drawPartTop`).
- `builder.js` calls `wingAero`/`wingStrength` (vessel.js:32,64), `Career.unlocked` (career.js:47), `Parts3D.wingAt` (guarded with `typeof Parts3D`), `Render3D.*`, `App.*`, `UI.*` and `Sound.*`.

Units are metres, tonnes, kN, seconds and kelvin (parts.js:3). `fuel`/`mass` in defs are tonnes. On instances, `p.fuel` is **kg** (`partFuelKg`, parts.js:824) and `partKg(p)` = dry + fuel + stores in kg (parts.js:826).

### 1. Coordinates

| | x | y | z (depth, `p.z`) |
|---|---|---|---|
| Rocket / heli / car (`launchRot` 0) | horizontal on the blueprint | up | towards the viewer |
| Plane (`launchRot` −π/2) | **down** (gear hangs on +x) | **nose** | **right wing** |

- The 2D blueprint is a side view looking along z from +z. For planes that means you see the right-hand side (parts.js:872-876).
- Part space is what is stored. The builder shows display space = R(`viewRot`)·part: `Builder.viewRot` = `VEHICLE_KINDS[kind].launchRot` (builder.js:484), with `toDisp`/`toPart` at builder.js:485-486. So planes appear nose-right, and arrow-key nudges are converted with `toPart`.
- Cars drive towards +x (`HULLS.cab`, parts.js:1683). Helicopters put the rotor on +y and the tail boom on −x (template `hummingbird`).
- **Rotation:** `p.rot` is 0..3 quarter turns anticlockwise about the part centre (parts.js:841).
  - `partDims` swaps w/h for odd rot (:842). `partPt` maps a local offset to part space (:844). `partAxis` gives the part's own "up", the thrust and flight direction (:852-854).
  - `mirrorRot` gives the turn of a mirror copy (:856). `partRect` returns the side-view box `{l,r,b,t}` (:857).
  - A pusher prop is drawn and modelled with 2 extra quarter turns (`turned`, :1694; parts3d.js `place`, :1660).
- `p.flip` = "this part is on the −x side, draw it facing out" (fins, legs, gear wheel end via `wheelGeom` :907, vtail, rcs). `makePart` defaults it to `x < 0` unless `extra` gives one (parts.js:833); loading (`partsFromDesign`, `Vessel.restore`, `buildGhost`) keeps the saved flip, and `Builder.setPose` resets it to `x < 0` on every move (builder.js:405). It is saved per row, and the 3D model cache is keyed by it.

### 2. The PARTS catalogue (parts.js:40-806)

- `PARTS[key]` is the def. The key is the **type string written into saves**.
- There are **254 parts**. README's prose counts them (§5.8). By tab: Command 4, Fuel 9, Engines 9, Coupling 4, Aero 6, Utility 5, Structure 3, Cockpits 20, Fuselage 44, Wings 56, Aero engines 37, Gear 25, Weapons 28, Ground 4 (so 182 aircraft parts in the five aircraft tabs, plus 28 weapons).
  - PR #35 added `chaff`, the Chaff Dispenser (parts.js:382).
  - PR #36 added 96 parts for the ten look-alike jets, in three blocks at the end of `PARTS`, each opening with a comment on its own fields: 19 `us5…` parts for the FS-22 and FS-35 (:422), 49 `ru…` parts for the MyG and Sugoi jets (:487) and 28 `us4…` parts for the FS-4, FS-16 and FS-15 (:688). By tab: 10 cockpits, 25 fuselage, 32 wings, 10 aero engines, 11 gear and 8 weapons.
  - Player-visible text follows the owner's naming rule (CLAUDE.md): part names, descriptions, paint names and weapon labels never carry a real designation (`label: 'RV-77'`, not R-77). Code comments may.
- A loop afterwards sets `d.type = key`, defaults `maxTemp` to 2000 and gives solids a default cost (:807-812).
- `tank(name,w,h,tier,desc)` (:35) derives fuel = `w*h*FUEL_PER_M2` (0.55 t/m², :32), mass = fuel/9 and cost.
- The tray's order within a tab is `partFamilies().order` (builder.js:308): the stock parts in object key order, then each look-alike jet's parts together, the jets in `TEMPLATES` order (§7, the tray).

**Categories and kinds**
- `PART_CATEGORIES` (:5) holds the palette tabs; `def.cat` must be one of their ids or the part never shows.
- `VEHICLE_KINDS` (:25) has `rocket|plane|car|heli`, each `{site: pad|runway|helipad, launchRot, cats}`. `cats` (PR #36) lists the tabs the tray shows for that kind, in order: a rocket gets command, fuel, engine, coupling, aero, utility and structure; a plane cabins, air, wings, airEng, airGear and weapons; a car ground, utility, structure and weapons; a helicopter airEng, cabins, air, airGear, fuel, ground, wings and weapons. The other tabs sit behind More (§7). A new category must go into some kind's `cats`, or it only ever shows under More.
- `TIERS` (:815) has 5 career tiers. `def.tier` indexes it and `Career.unlocked(def)` = `sandbox || def.tier <= data.tier`.

| Group | Fields (meaning) |
|---|---|
| Identity / economy | `cat`, `name`, `desc`, `tier` (0-4, required: used in toasts as `TIERS[def.tier].name`), `cost` (required: `designCost` sums it), `crew` (informational only, never read outside parts.js) |
| Geometry | `w`,`h`: unrotated side-view box in m, centred on (x,y). `depth`: explicit thickness across z. `topW` (adapter top width), `botW` (tail-cone tip). `mount`/`bellTop`/`bellBot`: engine block and bell fractions, **required for `shape:'engine'`/`'spike'`**. `shape`: selects the 2D drawing, the 3D recipe and many behaviours. `style`: a variant within a shape (fuselage: cargo/tank/armor/stealth/intake/boom/bay; engine nuclear; jet scram/pulse; prop electric; stores cluster/guided/torpedo/harm/cruise; jetnose stealth). Cosmetic extras: `canopy{at,len,seats,gold}`, `facets`, `blades`, `spinner`, `duct`, `contra`, `calibre`, `barrels`, `body3d` (forces a parts3d BUILD recipe) |
| Mass | `mass` (t dry), `fuel` (t), `maxTemp` (K), `breakSpeed` (impact m/s, vessel.js:960) |
| Command | `control` (rank: `findControlPart` picks the highest), `torque` (reaction wheel, summed at vessel.js:660), `radar` (m), `stealth` (0-1), `armor` (0-1, combat.js) |
| Propulsion | `thrust` kN, `ispSL`/`ispVac` s, `gimbal` rad, `vector`. `plume` is a PLUMES key in parts3d.js:67 or `'none'`. `solid` and `battery` give the part its own fuel group (`fuelGroups` :1445). `air{kind:'prop'\|'jet'\|'fan'\|'ram'\|'rotor', v0, vmax, vmin, ab, torque}` marks air-breathing engines, which are excluded from Δv. `pusher`, `fan` |
| Aero | `aero` (cuts drag when leading, vessel.js:236), `sharp` (vessel.js:245). `wing{area, span, flaps, vne, mmax, sweep, taper, stall, mcrit, load, dihedral, slope, wave, swing, planform, oswald, ar, gap, thick, cd0, winglets, control}`: field meanings are in the comment at parts.js:120-129; `control` makes it an elevator. `fin` (rocket fin), `airbrake` (area), `heatShield` |
| Utility | `chute`/`chuteArea`/`brakeChute`, `leg`, `wheel{r, drive, speed, accel, track, brake, retract, bogie, fat, caster}`, `float`, `smoke`, `separator`, `side` (radial separator), `weapon{kind, ammo, each, ...}` (comment at :349-350), `agm`, `bay`, `ecm` |
| Depth / attachment | `twinZ`: the part is a **pair**, one copy at ±z, and twinZ is the default spread. `pod`: hangs from a wing (placement, draw layer, host guessing). **zLocked** is derived, not a field: `zLocked(d)` = `wing \|\| leg \|\| fin` (:879). Such parts always sit at z=0 because wings span both sides and rocket legs/fins stand in fours. `flush` (PR #36): set into the bodies around it, so it may overlap them (§4) |

**The look-alike jets' fields (PR #36).** All are opt-in: no part from before #36 has one, which is why old designs draw, build and fly as before.
- **Three lofted-body formats, one per jet family.** Each makes the 2D outline and art from the same cross-sections its 3D model is lofted from, so the side view is the 3D silhouette (2D = 3D):
  - `us5: '<kind>'` (FS-22, FS-35; shape `us5body`, or `jet`, `vtail`, `gun`, `gear`, all with `body3d: 'us5'`; the wings and tailplanes are shape `wing`/`elevator` with `us5: 'wing'`, outlined by `foilPath` and built by the stock wing recipe). The kind picks the lofts in `US5_SHAPES` (:2770; `us5Lofts` :2829 caches them per def) and the art in `US5_ART` (:2993). A loft is `{rings, kind, smooth, open, caps, capKind, skip, sil}` (comment at :2686-2692). `partPath0` hands such a part to `us5Path` (:1723, :2902) before its switch, and `drawPart0` to `us5Draw` (:1860, :2919). The fins add `cant` (rad), `tipC` (tip chord) and `tipLE` (how far the tip's leading edge sits below the root's, m).
  - `ru: '<kind>'` (MyG, Sugoi; shape `ruLoft`, or `jet`/`vtail` with `body3d: 'ruLoft'`/`'ruFin'`). `partPath0` and `drawPart0` switch on `d.ru ? 'ru' : d.shape`, and their `case 'ru'` (:1846, :2521) calls `ruPath` (:3270) or `ruDraw` (:3282), which adds `RU_ART[d.ru]` (:3339). `loft` (the hull) and `glass` (canopies) are lists of `{s: [[y, top, bot, hw, mid, nt, nb], ...], n, nb, z, chine, mat, vec, gold, frames}` (comment at :3193-3200): sections up the part, smoothed by a monotone cubic (`ruMono` :3201), written in the aircraft's frame and moved to the part's by `ruG` (:3222), sampled by `ruSample` (:3227) and cached per def by `ruLofts` (:3244). A hull loft with `vec` is a vectoring nozzle that swivels about its throat, `vec` metres up the part. The extras: `ruFin {rte, tle, tte, cant, all, star}` (a fin's outline as fractions up the chord, its cant, `all`: all-moving, `star`: the red star's size), `ruRadome` (where a nose's radome starts), `ruLines`, `ruBrake`, `ruIntake [y0, y1, 'bot'?]` (a raked intake's dark mouth in 3D), `ruJet {petal, exit}` (an engine's nozzle), `ruLip`/`ruCone` (the MyG-21's shock-cone intake) and `ruBall [x, y, r]` (the IRST ball's glass).
  - shape `us4body` with `body {tubes, noz, plates, seats, frames, probe, colour, deco}` (FS-4, FS-16, FS-15; comment at :3458-3471). A tube is swept through stations `[y, xt, xw, xb, hw, nt, nb]` (top, waist, bottom, half-width, upper and lower superellipse exponents), with `z` copies, `kind` `'hull'` or `'glass'`, `front`/`back` `'cap'`, `'open'` or `'intake'`, a `rake` and `hide`; `us4Rows` (:3502) samples it through `us4Pchip` (:3474). `noz [{x, y0, y1, r0, r1, z}]`: nozzles, the first one the flame's (`nozzleOf` :1291 returns its `x` as well, so the flame leaves off the centre line in 2D and 3D, and each `z` gets its own). `deco`: `['line', x0, y0, x1, y1]`, `['tone', y0, k or colour]` (a radome), `['port', x, y, w, h]`. Drawn by `us4Path` (:3535) and `drawUS4` (:3555).
- **Paint and drag:** `look` (a skin id: the camouflage the part comes in unpainted; read by `ownSkin`, parts3d `skinFor` and `wingGeo`, and `us5Draw`), `fill` (the share of `w × depth` a shaped body fills head-on, for drag: vessel.js `computeAreas`, chapter 2 §3; without it a lofted fuselage counted as a full box and no jet could pass about Mach 1.9).
- **Weapons inside:** `doors` (bay or gun doors that snap open to fire; combat.js, chapter 4 §1.2), `bay` (stores leave from the belly) and `bayRack [[x, y, z], ...]` (where each store leaves the bay, by ammo count: the one the 3D model hides next).
- **Engines:** `vec2d` (a flat nozzle: the gimbal works in pitch only, vessel.js `gimbalZ`), `irK` (how much of the exhaust's heat seekers see: 0.7 for the FS-22's flat nozzle, 0.85 for the FS-35's serrated one), `glowAft`/`glowK` (the engine light: how far behind the nozzles, default 2 m, and how bright, default 1; every jet engine has 7 m and 0.2, render3d `engineGlow`).
- **Sensors:** `irst` (the IRST Ball's 0.3: heat seekers lock that share further away, combat.js `rangeOf`).
- **Surfaces:** `twinMirror` (the left copy of a pair is built as the mirror image in 3D: canted fins, lopsided gear legs, the FS-4's intakes; one flag since the merge, which replaced `pairMirror` and `ruMirror`), `vtail {rte, tle, tte, cant}` (a general outline for shape `vtail`: the root's trailing edge and the tip's leading and trailing edges as fractions up the chord, and a lean in 3D; the defaults `0, 0.4, 0` are the old fin, which `us4.test.js` pins), `wing.root` (metres out from the centre line where each half of a tailplane starts in 3D, leaving the middle open for the engines), `wing.plan [[s, le, te], ...]` (a planform: s out along the half-span, 0..1, the edges in metres from the part's centre; a plan that starts past 0 leaves the middle open), `wing.crank {at, d0, d1, tooth}` (a cranked wing in 3D: inner dihedral `d0`, outer `d1` from span fraction `at`, and a dog-tooth `tooth` of chord at the crank). The physics uses only the plain `wing` fields (`sweep`, `dihedral`); `plan`, `crank` and `root` shape the 3D wing and what `wingAt` answers.

**Adding a part end to end**
1. **Def.** Add an entry to `PARTS` with a unique key, an existing `cat`, `tier`, `cost`, `mass`, `w`, `h`, `shape` and `desc`. Reusing an existing `shape` (plus a `style`) gets drawing and 3D for free.
2. **2D drawing**, for a new shape:
   - Add a case to `partPath0` (outline, :1719). It is used for highlights, heat glow, clipping **and as the 3D silhouette**.
   - Add a case to `drawPart0` (artwork, :1854). Fill the body with the skin-aware helpers (§5). Plain colour literals stay unpainted.
   - If the shape should not take paint, add it to `NO_SKIN` (:1513).
   - For engines, check `nozzleOf` (:1285). The draw layer comes from `sideLayer` (:1707).
   - The `default:` case draws a hull-gradient rectangle.
3. **3D** (js/parts3d.js):
   - `LATHE` (:54) revolves the outline; `LATHE_KIND` (:55) sets its material.
   - `RECIPE` (:56) maps a shape to a `BUILD[...]` function (:627).
   - Otherwise the outline is extruded (`recipe()`, :1220). `PART_PROFILE` (parts.js:1017) overrides the outline for 3D.
   - `ZMIRROR` (:65) is for models that differ left and right, `SKIN_GEO` (:61) for wings that bake paint into geometry, and `BODY_KINDS` (:60) for solid materials that take skin colour.
   - The outline reaches 3D through a recording fake context (`pathRecorder`, parts.js:966). It understands moveTo/lineTo/closePath/bezier/quadratic/arc/ellipse/rect/save/restore/translate/rotate/scale; every other call is a silent no-op.
   - Since PR #36 the recipe tables live in parts.js, because the builder's clash test reads them too (§4): `LATHE` and `RECIPE` are parts.js's `LATHE_SHAPES` (:957) and `PART_RECIPE` (:959), `FLAT_DEPTH` is `PART_FLAT_DEPTH` (:1075), and parts3d's `recorder`, `outline` and `span` are `pathRecorder`, `partOutline` (:1060) and `outlineSpan` (:1067) (parts3d.js:105). Register a new shape there, not in parts3d, so the clash test shapes it the way its model is built. If the model has fittings that stand out of the outline (a canopy, a nozzle lip, a strut), give the part a `CLASH_PAD` entry, or a `CLASH_BOXED` one if they stand far out (§4); `test/browser/builder-shapes.mjs` fails otherwise.
4. **Behaviour** comes from def fields:
   - vessel.js: wings, wheels, air engines, chutes, airbrake, floats, breakSpeed, heat.
   - combat.js: `weapon`, `armor`, `stealth`, `radar`, `ecm`, `smoke`.
   - flight.js: controls.
   - Builder stats warnings (builder.js:1282-1315) look at `wing`, `wing.control`, `thrust`, `wheel`, `float`, `air.kind==='rotor'`, `shape==='vtail'`.
   - `quickAdd` heuristics (builder.js:1166) key on `side`, `leg`, `fin`, shape `rcs`/`girder`, `control`, `chute`, `aero`, `pod`, and surfaces.
5. Optionally add the part to a template and to the README part list.

### 3. Part instances

`makePart(type, x, y, extra)` (parts.js:831) creates `{id, type, def, x, y, z, att, skin, flip, fuel, active:false, deployed:0, temp:AMBIENT_T}`, plus `ammo` and `store` for weapons. `extra` is merged in, then `z` is re-defaulted when it is not finite, and `att`/`skin` when they are undefined. `rot` may be absent; code reads it as `p.rot || 0` or `& 3`.

- **`id`**: from the global counter `_partSeq` (:828). It is unique per page load. Design rows (`rss.design`, the hangar, design codes) use indices instead; flight saves (`rss.flight`) do keep ids, with `att`, `adj` and `stages` by id (and `Flight.restore` moves `_partSeq` past them); peers use their own ids.
- **`att`**: the id of the part this one *hangs on*, or null. It is a structural joint: `buildAdjacency` links it even when the geometry no longer touches (:1207).
- **`skin`**: a `SKINS` id or null (null = the part's own look).
- **Runtime fields** set by flight, combat and the builder: `fuel` (kg), `firing`, `spin`, `deflect` (also a flat nozzle's swing, PR #36), `deployed` (also how far a part's bay or gun doors are open, 0..1), `doorT` (how long they stay open), `retracted`, `used`, `fuelFrac`, `ammo`, `store`, `side`, `relN`, and `mirror` (builder only: a direct object reference to the symmetry twin). Parts are cyclic and hold `def`, so **only `designRows` serialises them**.
- Draw code must cope with stand-in parts that lack runtime fields: `renderPartIcon` (:2680) and Parts3D `dummy` (parts3d.js:89).

**Depth helpers (:877-903)**
- `PART_Z_MAX`=20.
- `partDefaultZ` = 0 if zLocked, else `twinZ || 0`.
- `twinMinZ` = half the depth + 0.05 (any closer and the two halves would overlap).
- `cleanZ(z,d)` (:882) returns 0 when zLocked, the default when z is non-finite, `clamp(|z|, twinMinZ, 20)` for pairs, else `clamp(z, ±20)`.
- `partZ(p)` is the signed centre for a single part, or the spread (≥0) for a pair. `partZc` is where the mass sits across (0 for pairs). `partZs` lists each copy's z (`[-z, z]` for pairs). `partBoxes` gives `[l,r,b,t,near,far]` per copy.
- `partDepth` (:862) uses `def.depth`, else `wing.span`, else 0.15 for fin/vtail/tailrotor, 0.4 for wheels, else `w`.

**Legacy twins.** `legacyTwin(p)` (:931) = twin && `att === null` && `|partZ − twinZ| < 5e-4`. It identifies pairs saved before parts had depth or attachment. In the side view those overlap the hull they hang beside and only join "as their pylons show". To make old designs build, connect and fly **exactly as before**, the following special cases exist:
- `partsClash` never reports a clash between a legacy twin and a non-twin (:1179).
- `partsTouch` skips the "side by side across z" join for legacy twins (:925).
- `pylonLink` (:1191) joins any twin with no att (at any spread) to whatever it touches or mounts on in the 2D side view. This is how twin tails on a jet pipe and floats under a fuselage connect.
- parts3d `pylonsFor`/`oldStruts` (parts3d.js:1615,1546) draw struts the old way.
- combat.js:61 puts a legacy pair's explosion in the middle.
- vessel.js:906 measures a pair's heating offset from its default spread.

### 4. Connectivity, staging and Δv (parts.js)

| Function | Meaning |
|---|---|
| `spanOverlap(a0,a1,b0,b1)` :914 | overlap length (negative = gap) |
| `partsTouch(a,b)` :916 | share a face: flush within 0.02 on one axis, overlapping >0.1 on the other, and overlapping in z by >min(0.1, half-depths). Or overlapping in the side view and flush in z (side by side across; not for legacy twins) |
| `partsTouch2D` :933 | the same, side view only |
| `partsOverlap(a,b,m=.02,mz=m)` :939 | 3D boxes interpenetrate (any copy pair) |
| `isSurface`/`surfaceKind` :950-951 | wing (`def.wing`) or fin (`shape:'vtail'`) |
| `partsMix` :952 | exactly one side is a surface, or one wing and one fin; such pairs may overlap |
| `partsClash` :1178 | illegal placement: two parts that don't mix whose boxes overlap **and whose shapes overlap** (`shapesClash`, by more than 0.02 m). Exactly one `flush` part never clashes (it is set into the body); two flush parts do. Only the builder calls it |
| `clashShape(d, flip)` :1097 | the shape the clash test uses, cached per type and side (`CLASH_SHAPES`): `round` (a lathe recipe: a disc at each height, as wide as its outline, and a round part's 2D path counts too, so a canopy drawn only in 2D still takes room), flat (an extrusion: the outline as deep as its model, `def.depth \|\| PART_FLAT_DEPTH \|\| min(w, 1)`), a loft (`us5`, `ruLoft`, `us4body` bodies: the side outline as deep as the box) or `box` (gear, props, guns, wings, rocket fins, every other recipe and the `CLASH_BOXED` parts). It carries the part's `pad` (`CLASH_PAD`) and the outline's extent tabulated up the part every `CLASH_STEP` (0.01 m) in `S.lo`/`S.hi` (NaN where there is no outline, :1108-1110) |
| `clashSpan(S, ly)` :1117 | the outline's extent across at local height `ly`, `[lo, hi, solid]`, interpolated between the 1 cm rows. Past either end of the outline (its `ys` range) but still inside the box, it is the whole box and `solid`, so a part can't be put into a nozzle or a canopy that the outline stops short of; null in a gap of the outline |
| `clashSection(p, S, k, u)` :1128 | where a shape is across its axis at height `u` (part space), for a part turned `k` quarters (`clashU` :1126 maps a local height): `[v0, v1, solid]`, widened by the `pad` on both sides except on a solid span |
| `sectionsCutAt(a, A, ka, b, B, kb, u)` :1135 | the worst cut at one height over every copy of a twin pair. A solid section counts as a rectangle as deep as `partDepth`; any other keeps its depth (a flat part's model depth, else `partDepth`) grown by `2·pad`, and a round one stays a disc only where it isn't solid |
| `sectionsCut(...)` :1146 | how far two sections cut into each other: two discs, two rectangles, or a disc and a rectangle, each at its own depth |
| `shapesClash(a, b, m)` :1156 | samples every height where either outline turns, plus quarters in between, over the boxes' common span, through `sectionsCutAt`. Two boxes, or parts lying across each other (one turned a quarter), keep the box answer. A negative `m` asks whether two shapes come within `−m` of each other (`Builder.holds`, §7) |
| `partsMounted` :1183 / `partsMounted2D` :1184 | a surface through a hull (overlap >0.04; across z >0 / ignoring z): this counts as attached |
| `pylonLink` :1191 | old twin (no att) joined by side-view touch or mount |
| `buildAdjacency(parts)` :1198 | O(n²) pairs `touch \|\| mounted \|\| pylonLink`, plus every valid `att` link. Returns `Map<id, Set<id>>` |
| `componentOf(id, adj, skip)` :1266 | flood fill; `skip(id)` blocks traversal |
| `findControlPart` :1276 | highest `def.control` (first on ties) |
| `attachedTo(parts, roots)` :1258 | transitive att-children (flight.js:262: what breaks off with a part) |
| `cleanAtt(parts)` :1244 | null self and missing links; break att cycles by nulling the closing link |
| `computeStages(parts, adj, ctrlId)` :1303 | segments = components without separators; BFS from the control segment. Stage 1 lights every *exposed* engine (a non-side separator below an engine, `sp.y < e.y`, blocks it until fired). Then the deepest separators fire, the subtree drops and newly exposed engines light. Chutes form the last stage |
| `estimateDeltaV(..., useSeaLevel)` :1382 | replays the stages on copies: `cutSeparator` (:1436) keeps the separator with the falling piece; fuel groups burn in parallel; air-breathers are ignored. Returns `{total, perStage, twr}` |
| `describeStage` :1371 | the stage list text |
| `sideOrder(parts)` :1708 | draw order back to front: `round(partZ*20)`, then `sideLayer` (leg/fin/wheel 0 < hull 1 < surfaces 2 < pods 3), then index. Picking uses the reverse (`Builder.hitParts`, builder.js:504) |

**Clashes on the 3D shapes (PR #36).** Before, two parts clashed whenever their boxes overlapped, so nothing could sit in the corner of a round hull's box. Now the box overlap is only the first test, and `shapesClash` then compares the shapes height by height, the way parts3d builds them. The outline machinery moved from parts3d.js into parts.js for this, unchanged (§2, adding a part): `pathRecorder` (:966), `PART_PROFILE` (:1017), `partOutline` (:1060), `outlineSpan` (:1067), `LATHE_SHAPES` (:957), `PART_RECIPE` (:959) and `PART_FLAT_DEPTH` (:1075), plus `outlineDummy` (:1078), so the builder and the Node tests read them without three.js. The builder slides a part in against a shape with `Builder.snug` (§7).
- **The shapes hold the whole 3D model** (the builder review). Some fittings stand out of the 2D outline the shape is made from: canopies, intake frames, nozzle lips, gun fairings, the IRST ball. `CLASH_PAD` (:1089) gives those parts a padding in metres, measured from their models (the cockpits 0.09-0.22, the jets' nozzles 0.1-0.12, the FS-16's intake 0.16, the IRST ball 0.13), added round the outline's sections but not to a solid end. `CLASH_BOXED` (:1093) lists the parts whose fittings stand out so far that they keep their plain box: the tandem and stealth canopies, the floats and drop tanks with their struts and pylons, the Hawk and Prometheus rocket engines (the Prometheus with its radiator fins), the FS-22's and FS-35's noses, the FS-35's aft fuselage with its booms, the MyG-21's nose and the FS jets' engines. Past the ends of a lathe or loft outline the box counts as solid (`clashSpan`). `test/browser/builder-shapes.mjs` builds every part's 3D model and checks each vertex lies within 1.5 cm of its clash shape, so a new part with fittings outside its outline fails there: give it a pad or box it.
- **Lookup tables.** Each shaped part's outline extent is worked out once, every `CLASH_STEP` (1 cm) up the part, into `S.lo`/`S.hi`, and `clashSpan` interpolates between rows instead of crossing the outline's polygons at every height asked. That is why dragging a jet's big lofted nose about its own jet costs under a millisecond a move (the browser test allows 8 ms).

It changes **placement only**: `partsClash` has no caller outside builder.js, and joins (`buildAdjacency`), physics, saves and the 3D models are as before (the 3D models byte-identical). `test/shapes.test.js` checks the section arithmetic against points sampled on a grid and the sampled heights against a 2 mm scan of 400 random pairs of real parts.

### 5. Designs, codes, hangar, thumbnails

**Rows.** `designRows(parts)` (:1215) produces `{type, x, y (3 dp), flip, rot}`. It adds `z` **only if it differs from `partDefaultZ` by >5e-4**, `att` **as an index into the same list** (only if valid and not self) and `skin` if set. Old designs therefore read back identically.

**Back to parts.** `partsFromDesign(rows)` (:1227) works in two passes.
- First, each row either becomes a part or becomes `null` **kept in place** so att indices still match. A row is rejected for an unknown type (checked with `hasOwn(PARTS, ...)`, :878, not `in`, to avoid prototype keys) or for non-finite x/y.
- Kept rows have x and y clamped to ±500, `rot` taken as `(q.rot|0)&3`, z passed through `cleanZ` and the skin through `cleanSkin`.
- Second, att indices are resolved to ids, nulls are filtered out and `cleanAtt` runs.
- Callers include flight.js:32, mp.js:466, renderDesignThumb, paste and loadDesign.

**Templates.** `TEMPLATES` is at builder.js:5-291 and holds 35 craft. Format: `{name, kind, tier, blurb, military?, parts: [[type, x, y, rot?, {z, skin, att}?]], paint?: {type: skin}}`. `templateRows` (:294) converts them to rows with `flip = x<0`. The hangar groups them as rocket / plane / military / car / heli (:1614). mp.js:470 relies on keys `mustang`, `camel` and `skylark`. Most of the stock plane templates use legacy twins (no att/z). The Falcon, Striker, Kestrel and Spectre carry a Chaff Dispenser (builder.js:83, 89, 112, 117): on the spine (x = −1.2), 1 m ahead of the flares on the Falcon and Kestrel, except on the Spectre, where it sits flush under the round `jetF` tail at (1.0, 3.0), so the Spectre keeps its stealth and its carrier height.

**The ten look-alike jets** (PR #36; builder.js:149-290) come after the stock craft, by generation, all `military` planes. Unlike the stock planes they use the attach system: rows `[type, x, y, rot, {z, att}]`, `att` being the index of the row the part hangs on (a stack along the centre line needs none). Every part also joins geometrically, no two parts clash, so the builder can edit them (`core.test.js` checks both), and each carries its camouflage in `paint` (the FS-22 and FS-35 wear their parts' own `look`; the FS-35's `paint` only puts its cannon, an FS-22 part, in `lightning`). Prices are on one scale: every jet fits a $120k battle exactly as it comes, the MyG-21 a $45k one and the FS-16 a $75k one, price follows generation, and rivals are matched (FS-15 and Sugoi-27, FS-16 and MyG-29, FS-22 and Sugoi-57). Mass is with full fuel; "wing" is the builder's "strong to" rating (`gRating`, chapter 2 §3) with full fuel.

| Jet (key, line) | Gen | Tier | Price | Mass | Wing | Paint |
|---|---|---|---|---|---|---|
| MyG-21 (`myg21`, :152) | 3rd | 2 | $44,600 | 8.7 t | 8.5 g | `ruFrontline` |
| FS-4 (`fs4`, :160) | 3rd | 3 | $96,900 | 20.5 t | 7.4 g | `us4sea` |
| FS-16 (`fs16`, :183) | 4th | 3 | $74,500 | 12.9 t | 9.0 g | `us4viper` |
| MyG-29 (`myg29`, :204) | 4th | 3 | $88,800 | 14.8 t | 9.0 g | `ruFulcrum` |
| FS-15 (`fs15`, :215) | 4th | 4 | $110,600 | 21.1 t | 9.0 g | `us4eagle` |
| Sugoi-27 (`sugoi27`, :237) | 4th | 3 | $110,300 | 22.9 t | 10.5 g | `ruFlanker` |
| Sugoi-35 (`sugoi35`, :249) | 4.5 | 4 | $118,500 | 23.5 t | 10.3 g | `ruSplinter` |
| FS-22 (`fs22`, :262) | 5th | 4 | $119,300 | 27.8 t | 10.4 g | own look, `raptor` |
| FS-35 (`fs35`, :271) | 5th | 4 | $98,300 | 20.9 t | 9.6 g | own look, `lightning` |
| Sugoi-57 (`sugoi57`, :280) | 5th | 4 | $118,600 | 25.6 t | 9.5 g | `ruPixel` |

Every jet but the MyG-21 carries flares and a Chaff Dispenser (the FS-22's and FS-35's on the spine between the tails, added in play-testing). The MyG-29, Sugoi-27, Sugoi-35 and Sugoi-57 have an IRST Ball.

**Design codes.** `designCode` (builder.js:1489) produces `"RSS1."` + base64url(UTF-8 JSON `{n, k, p:[[type, x, y, flip0/1, rot]]}`).
- The prefix becomes `"RSS2."` when any row carries extra fields `[z, att, skin]`; trailing nulls are trimmed. Older versions cannot read RSS2.
- `parseCode` (:1502) finds `/RSS[12]\.…/` anywhere in pasted text and keeps at most **20000 rows** (reports `cut`).
- Unknown rows become null in place (reports `dropped`). The name is cut to 40 characters and an unknown kind falls back to rocket.

**localStorage keys.** All go through `store` (util.js:116), which uses JSON, try/catch and a fallback read of the legacy `orbitforge.` prefix.

| Key | Content |
|---|---|
| `rss.design` | current blueprint `{name, kind, parts, savedAs}`, written by `save()` on every committed edit (skipped while `MP.savedCareer`) |
| `rss.hangar` | up to 100 `{name, kind, parts, savedAt}`, newest first, unique by name (`storeDesign` :1441) |
| `rss.clip` | clipboard `{kind, parts}` (survives switching designs) |
| `rss.grid` | grid mode |
| `rss.symmetry` / `rss.symmetryPlane` | symmetry for rocket/car/heli vs planes (`symKey` :1229); default true |
| `rss.statsFolded` | stats panel folded |
| `rss.settings` | holds `build3d` (3D preview), via `Settings` (world.js:7) |

**Save state**
- `markSaved` (:1428) normalises the stored design through `designRows(partsFromDesign(...))`, so a design saved by an older version is not taken for changed.
- `isDirty` and `unsavedWork` compare `snapOf` = JSON of `[kind, parts]`. `baseSnap` is the template as loaded; it is set to null after pasting a code.

**Thumbnails**
- `renderDesignThumb(d, w, h, dpr, rot)` (parts.js:2649) parses with `partsFromDesign`, fits the rotated bounds at 86%, flips y and draws `sideOrder`.
- `renderPartIcon(type, size, dpr, rot, skin)` (:2672) is used by the palette at 56 px, rotated by `viewRot`.

### 6. Skins and paint (parts.js:1475-1597)

`SKINS` (:1480) has 26 entries `{name, base:#rrggbb, paint?:'hull'|'dark'|'metal', accent?:'keep'|null, rough?, metal?, camo?, pat?}`. `accent` controls livery stripes: `'keep'` leaves them as drawn, `null` hides them, unset uses a tone of `base`. `rough`/`metal` are the 3D finish. The first 13 are the plain paints; PR #36 added the jets' 13 (:1494-1509), eleven of them camouflage and two plain (`us4gull`, Navy gull grey, and `us4gunship`, gunship grey). All the jets' paints have `accent: null`.

- `NO_SKIN` (:1513) lists shapes that cannot be painted: sep, shield, chute, leg, wheel, gear, girder, rotor, tailrotor.
- `skinnable` (:1514); `cleanSkin(id, d)` (:1515) returns null when invalid or unpaintable.
- `ownSkin(d)` (:1518) returns `d.look` (a jet part that comes in its own camouflage, PR #36), else `'stealth'` for `style:'stealth'`. `skinOf(p)` = `p.skin || ownSkin`, so Match and a new part's inherited paint take a jet part's own camouflage.
- Paint is **purely cosmetic**: stealth comes from `def.stealth`.

**Camouflage (PR #36).** A skin with `camo` is a pattern over its `base`, laid on in metres of part space and repeating on a **16 m tile**, so in the side view the patches run on from one part to the next. Each of the three jet branches built its own camouflage; the merges kept two formats, drawn through one path in 2D and one texture builder in 3D, and turned the third branch's blotch skins into patterned ones:
- **Two-tone** (`camo` a colour string, `pat` 0, 1 or 2: soft blotches, fine quilting, hard splinters): `raptor`, `lightning` and `splinter` (:1495-1497). `us5CamoAt(pat, u, v)` (:2863) is a smooth periodic field; `us5CamoTile` (:2878) paints it into a 256 px canvas per skin (16 px a metre, on screen and in 3D alike).
- **Patterned** (`camo` an object `{k: 'blotch'|'splinter'|'digital', c: [colours over the base], seed, n, r, px}`: patches of each colour, two fewer of each next one for blotches, three for the others, `r` their size, `px` a digital pattern's pixel in metres): the five `ru…` and three `us4…` camouflages (:1499-1507). `camoCanvas(s, ppm)` (:3142) draws seeded patches nine times over so they wrap round the tile, cached per skin and resolution (`CAMO`): 16 px a metre on screen (`CAMO_PX`), 32 in 3D textures, which are painted once.
- `skinFill` (:1539) returns `us5CamoFill` (:2892) or `camoFill` (:3185) for a camouflage: the tile as a repeating `CanvasPattern` whose transform maps pixels to metres from the blueprint's origin, shifted by `PartPaint.camoAt` (:1525) when a part is drawn at the origin for a 3D texture, so its pattern starts where the part really is. Without a page (the Node tests) both return the base colour.
- In 3D the same tiles become repeating textures (chapter 3 §3, materials). The paint swatch in the builder shows a band of each tone (`renderPaint`, builder.js:1395).

**How 2D painting works**
- `drawPart` (:1713) is the place that sets `PartPaint.skin` (in try/finally) around `drawPart0`. Two more do the same since PR #36: `us5Draw` (:2919) puts on an unpainted FS-22/FS-35 part's own `look`, and `drawPartTop` (:3603) paints an `us4body`'s plan view for its 3D texture.
- Inside `drawPart0`, body fills must use the skin-aware helpers. Each one falls back to the part's own look when there is no skin:
  - `hullGradient`, `darkGradient`, `tintGradient`, `goldGradient`
  - `bodyMetal` (a metal body; `metalGradient` stays bare metal for nozzles and bells)
  - `bodyGrad(ctx, l, r, own)` (custom own fill)
  - `bodyFlat(hex)`, `bodyTone(hex, k)` (a tone of the skin base)
  - `accent(css)` (stripes)
- `skinFill` (:1539) picks the painter.
- `PartPaint.flat=true` makes gradients return flat colours. parts3d `paint()` (parts3d.js:1238) uses it to bake 2D art into textures cached per type|flip|skin, and for a camouflaged part also per place (chapter 3 §3).
- The cargo roundel hides when `accent === null` (:2555).

### 7. The Builder (builder.js:318)

**State**
- `parts`; the selection: `_primary` via the `selected` getter/setter (setting it selects only that part), `sel` (Set) and `multi`.
- `kind`, `name`, `savedAs`, `category`, `cam{x,y,scale}`, `symmetry`, `grid`, `selectMode`, `clip`.
- `history`/`future`: JSON snapshots, at most 60.
- Derived in `changed()`: `adj`, `ctrl`, `attached`, `stages`, `stageOf`, `com`, `cot`, `col`, `statsData`.
- Gesture state: `drag`, `zGesture`, `mpp`.
- `mp`: a battle's budget, limits and allowed kinds.

**The edit pipeline.** Every mutation ends in `changed(fromHistory)` (:412):
1. `cleanAtt`, then `buildAdjacency` (cached in `this.adj`), `findControlPart`, and `attached` = the control part's component.
2. Stages and Δv on the attached subset; mass and COM (z from `partZc`), COT from stage-1 engines, centre of lift and stall speeds (planes).
3. `renderStats`.
4. When `!fromHistory`: push the snapshot, clear `future` and `save()`.

Live previews (the depth slider) call `changed(true)`: no history and no save. `undo`/`redo` (:461) call `loadDesign(snapshot, true)`, which **recreates every part object**, so stale references must be dropped first (undo cancels any drag).

**Kinds**
- `setKind` (:1215) and `loadDesign` (:358, only when the kind changes) switch the default palette tab (rocket→command, plane→cabins, car→ground, heli→airEng) and load that kind's symmetry setting (`kindSymmetry`).
- `renderKind` disables kinds that a battle disallows.

**The tray (PR #36).** `buildPalette` (:1085) shows the tabs in the kind's `VEHICLE_KINDS[kind].cats` (§2), then a **More…** tab (`.tab.more`, sticky at the right end of the strip, so it stays in sight on a phone in portrait however the tabs are scrolled) that adds every other tab (`.tab.extra`, dimmed) and turns into **Fewer**; `moreCats` holds the choice, and with More off a tab that isn't the kind's falls back to its first. Any part still goes on any craft. Within a tab the items follow `partFamilies()` (:308): the stock parts in key order, then each look-alike jet's parts together behind a `.tray-group` label with the jet's name, the jets in `TEMPLATES` order. A part belongs to the jet its name gives (`/^(FS|MyG|Sugoi)-\d+/`, "FS-22 Wing"), else to the first template that carries it (the IRST Ball to the MyG-29); worked out once into `PART_FAMILIES` (:307). Part names wrap to two lines at most (`.part-name`, style.css:172), so a long jet part name doesn't make the tray taller. `test/browser/builder-shapes.mjs` checks the tabs per kind, More and Fewer, the jet groups and, on a phone in portrait, that More is in sight.

**2D vs 3D.** `in3D()` = `App.preview3D()`, i.e. Settings `build3d` and WebGL ready (main.js:154). `V` or `#btn-3d-build` toggles it. The main loop then calls `Render3D.renderBuilder(Builder)` instead of `Builder.render` (main.js:66), and draws either one only when its picture is out of date (see **Redraw on demand** below).

| | 2D | 3D |
|---|---|---|
| Pointer down | `hitParts` (side-order reversed; pad 0.2 touch / 0.05 mouse) → `grab`, else box (select mode / shift) or pan | `down3D` (:1868): a mouse drags any part, a finger only an already-selected one; otherwise orbit; right/middle button pans |
| Placement | `snap()` near `pointerToPart` | `Render3D.surfaceHit` → `attach()`. Falls back to `snap()` on the plane at the part's depth (`Render3D.designPoint`) for zLocked parts or a miss |
| View | `cam` pan, `zoomAt` (scale 3-90), pinch | orbit, pinch/wheel zoom, `panBy`; `Render3D.editView(true)` freezes the turntable while dragging |

**Placement**
- `snap(type, want, ignore, rot, radius)` (:663):
  - The radius is max(1.4 m, 26 px). Rounding is 0.25 in grid mode, else 0.01.
  - Surfaces, pods and anything dropped on a wing stay exactly where dropped (depth found by `zFit`), hosted by what they mount on (a pod's host must be a surface).
  - Otherwise it tries end-on stacking (top/bottom), sides, corners and along-top positions against each other part. A candidate is rejected on `partsClash`, or for a twin that only meets its host in 2D.
  - The best candidate beside a part (not stacked on its end, neither of the two a surface, grid off) then slides in along x towards its host until it meets the host's shape (`snugged`, :680; PR #36), so a pod by a nose cone's slim tip or a round hull sits on the surface rather than out at the corner of the box.
  - With no candidate, a `flush` part dropped into a body (an internal gun, a gear leg) hangs on the first non-surface part its box overlaps (:713): before PR #36's review it was accepted but not attached, and was left behind at launch.
  - Returns `{x, y, z, host, att, attached, ok}`.
- `snug(pr, axis, dir, max, others)` (:650; PR #36) slides a part that is free where it is along x or z (`dir` ±1) until it would clash: 5 cm steps, so it never jumps through something into a gap beyond, then five halvings to the centimetre, at most `max` metres. It returns the new pose, or null when it can't go in at all. Its `free` test (:653) is stricter than `partsClash`: no exemption for legacy twin pairs or flush parts, and a 2 mm margin (`partsOverlap(q, o, 0.002, 0.002) && shapesClash(q, o, 0.002)` for parts that don't mix) instead of 2 cm, so a sliding part stops where it first meets any shape, flush against a straight hull, and can't slide into an old pod pair that `partsClash` would let it overlap. Each step tests every other part; the browser test keeps `snap` against a 20-part jet under 25 ms (it measured 1.3 ms).
- `zFit` (:628) checks the wanted depth first. Pairs and wing-hung parts then search outward (step 0.25 grid / 0.05) up to the wing's half-span.
- `attach(type, rot, hit, others)` (:721) works from the hit normal:
  - end face → stack on it;
  - x-dominant → over or under it (pods go to the `underside` of a wing);
  - z-dominant → on its flank.
  - Coordinates are rounded to 0.01, z under 0.08 snaps to 0 for non-twins, then `cleanZ`.
  - Over, under or on the flank of a hull (not a surface), a part that fits then slides in with `snug` (:742): along x by up to the two half-widths, or along z towards the hull (a pair only when its host sits on the centre line, and then inwards, narrowing its spread), keeping the slide only if `cleanZ` leaves its depth alone. A pod dropped on the lower curve of a fuselage in 3D hangs on the curve, not below the box.
- `attFor(host, stack)` (:644): a part stacked end-on onto a **centre-line** part gets no att (the stack holds it); everything else hangs on its host.
- `addPart` (:759): checks the career lock, inherits `skinOf(host)` (a wing on a stealth fuselage comes in stealth grey) and creates the symmetry twin hosted on `att.mirror || att`.
- `quickAdd` (:1166) is the palette tap.

**The attach system ("what hangs on what")**
- `hosts()` (:547) returns `Map(part → host)`: `att` if set, else `guessHost` (:598) for parts saved before att existed.
  - Pods and twins → the surface they overlap most in 2D (else the hull).
  - A surface → the hull it passes through.
  - Anything else → the side-touching part nearest the centre line.
  - A second pass hangs end-stacked parts on an off-centre hosted part (a radial booster's engine and nose cone).
- `near()` restricts candidates to `this.adj`.
- `kidsOf(roots, H)` (:611) gives transitive children. Children follow their host in `grab`/`moveDragged`, `shift`, `turnGroups`, `removeParts` (which deletes them too, with a toast), `copySel` and `rotateSelected`.
- `holds(h,q)` (:572) = touch, mount, or for a wing `wingHolds`: `Parts3D.wingAt` gives the swept, tapered section at q's depth, and q must sit within `s ≤ 1.05`. Since the builder review also, for parts that don't mix and whose boxes overlap, a part within 12 cm of its host's shape (`shapesClash(q, h, -0.12)`): a part slid onto a curved hull doesn't touch its box face, and without this `letGo` would unhook it as soon as it was nudged along the hull or moved out a little.
- `letGo` (:879) clears `att` for parts that moved away from an unmoved host that no longer holds them. `dropDrag` (:1967) does the same and re-hosts a moved twin on its host's mirror.
- `zStep(q, dz, roots, H)` (:589): when a part hangs on the left copy of a pair, or a pair hangs on a part at −z, it moves by −dz so it stays on its host.

**Moving and editing**
- `grab` (:1856) takes the selection, their kids and their mirror twins (with the twins' kids) and records `origs`. The host map is computed **once per drag** (`drag.H`).
- `dragTo` (:1909) moves the group via `moveDragged` (:1936). Touch drags from the palette lift the part 44 px above the finger and vibrate when it snaps on.
- `dropDrag`: dropping over the tray deletes; an invalid spot reverts (`cancelDrag`); a single part dropped off the line gets a twin when symmetry is on.
- Rotation: `rotateSelected` (:813) / `rotateSel` (:1069). A part with kids goes through `turnGroups` (:840), all or nothing; a non-plane twin turns the opposite way.
- `shift(list, dx, dy, dz)` (:857) does move/nudge/depth with rollback: if the group doesn't fit, or a part would clash with its own mirror, everything reverts. A mirror that cannot follow is unlinked.
- `duplicateSelected` (:795): a part on a wing gets another copy further along it.
- Copy/paste: `copySel` (:1016) copies a single part's mirror and every kid too. `paste` (:1029) searches up, then sideways, and adds twins when symmetry is on.
- Multi-select: Shift/Ctrl/Meta-click, `#btn-select` mode, box select by part centres (`boxSelect`), Ctrl+A. Tapping an already-selected part picks the one behind it (`drag.behind`).

**Symmetry.** `mirrorOf(q)` (:384) returns null when the part is on the mirror line:
- plane: (x, y, −z, same rot); none for twins, zLocked parts or z≈0;
- rocket: (−x, y, −z, `mirrorRot`), a half-turn about the stack (pairs keep z);
- car/heli: (−x, y, z, `mirrorRot`), front and back.

`linkMirrors` (:391) rebuilds `p.mirror` from poses with a 0.01 tolerance; mirror links are never saved. `mirrorOk` (:749) checks the twin's spot is free.

**Depth (`#pi-depth`).**
- `renderDepth` (:1370) hides the row for no selection, multi-select or zLocked parts. The label `#pi-z-label` reads "Spread" for pairs, else "Depth".
- `#pi-z` range: min `twinMinZ` for pairs or −lim; lim = min(20, ceil(max(4, |z|+1, wing half-spans+1))); step 0.25 (grid) or 0.05.
- `#pi-z-val` shows `zText` (:1381): `±a m`, `centre`, `left/right a m` for planes, or `+/−a m`.
- The slider `input` event calls `setDepth(v, true)` (:906). It restores the `zGesture` snapshot (poses, mirrors, att and H at gesture start) and re-applies `shift`. The `change` event commits one undo step.
- `[`/`]` and `#btn-z-in`/`#btn-z-out` call `nudgeZ` (:894): 0.1 m, 0.25 in grid mode, 1 with Shift. If both of a pair are selected, only the right one moves and its mirror follows.

**Paint (`#pi-paint`).**
- `renderPaint` (:1388) builds the `.skin-sw` radio swatches in `#pi-skins` once (`data-skin=''` = own colours, styled `.own`). A camouflage's swatch is a diagonal gradient with a band of each of its tones over the base (:1395; PR #36).
- `paintSel` (:927) applies to the selection plus twins, skinnable parts only.
- **Match** (`M`, `#btn-match`, `matchPaint` :936) takes the skin of `hostOf` (the host, else the biggest skinnable neighbour). The button is disabled when nothing has a host.
- **All** (`#btn-paint-all`, `paintAll` :948) gives the whole craft the selected part's `skinOf`.

**Grid (`#btn-grid`, `G`, `rss.grid`).** `setGrid` (:996) refuses in 3D. `gridOn()` = grid && !3D. It switches:
- snap rounding from 0.01 to 0.25;
- the `zFit` step, nudge/`[ ]` step and slider step to 0.25;
- `rotateSel` pivot rounding;
- the blueprint drawing to minor grid lines (otherwise faint 2 m lines are drawn).

**Keyboard** (handler at :1755). Ignored in modals, text inputs and textareas; a focused range slider keeps its arrow keys.

| Keys | Action |
|---|---|
| Ctrl+S / Ctrl+Shift+S | quick save / save as |
| Delete, Backspace | delete selection (+ twins, + kids) |
| Ctrl+A / C / X / V / D | select all / copy / cut / paste / duplicate |
| Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y | undo / redo / redo |
| R, F, V, G, M | rotate, fit view, toggle 3D, grid, match paint |
| `[` `]` | depth −/+ |
| Arrows | nudge in screen directions (0.1 / 0.25 grid / 1 with Shift) |
| Enter | launch (needs a control part) |
| Esc | cancel drag, else clear selection and leave select mode |

**2D render** (`render`, :2013):
- Parts are drawn in `sideOrder`. Loose parts are at alpha 0.4, single parts at z<−0.05 get a dark wash, locked parts a red wash.
- The selection gets dashed amber boxes; the palette ghost and its twin are drawn semi-transparent.
- Markers: COM yellow, centre of lift blue (planes), COT purple arrow, stage badges.
- Parts stacked at the same (type, x, y, rot) get a `×N` badge (a pair counts as 2). The selected part gets its `zText` label.

**Performance**
- `buildAdjacency` is O(n²). It runs only in `changed()`, never per drag frame.
- Drags reuse `drag.H`; `moveDragged` checks only `groupFits`/`partsClash`.
- `hosts()` is not cached, so compute it once and pass `H` down, as the existing code does.
- render3d rebuilds meshes only when the per-part key (kind, then id/type/flip/skin of each part, `bd.key`) changes or the parts array is replaced (render3d.js:2914); Parts3D caches models and textures by type|flip|skin (a camouflaged part's texture also by its place, chapter 3 §3).
- The clash test on shapes costs more than a box test: `clashShape` is cached per type and side with its outline tabulated every centimetre (§4), and `shapesClash` runs only for pairs whose boxes already overlap. `snug` adds up to a few dozen sweeps per placement. A drag of a jet's big nose about its own jet costs under a millisecond a move.
- `viewArea()` (:528) is cached in `Builder.area` while `#build-ui` shows, because the 3D view asks for it every frame it draws. `layout()` (:1407) clears it, and so does a `ResizeObserver` on `#build-top`, `#stats`, `#palette` and `#part-info` (:340-345).
- Code imports are capped at 20000 rows; peer craft at `MP_MAX_PARTS`=600 (mp.js:18).

**Redraw on demand (PR #35).** The hangar is no longer drawn every frame. `App.frame` draws the 2D blueprint, or the 3D view, only when `Builder.dirty` or `App.dirty` is set, after any input, or every `App.heartbeat` (500 ms) as a safety net (main.js:65-80; §5.2); the 3D view also while anything in it moves (chapter 3 §2). `Builder.redraw()` (:411) sets `dirty`. `changed()`, `renderInfo()`, `layout()`, `fitView()`, `zoomAt()`, `setGrid()`, the symmetry button, drags (`dragTo`, `moveDragged`, `endDrag`), a 3D hover that moves the highlight and the `selected` setter (:322) already call it. **Any new code that changes what the blueprint shows without player input must call `Builder.redraw()`**, or the screen keeps the old picture for up to half a second. `test/browser/redraw.mjs` sets `App.heartbeat` to 1e9 so that a missing call fails.

### 8. Invariants and gotchas

1. **Never change `w`/`h`, `twinZ`, zLocked status or the key of an existing part.** Saves store absolute centres with 0.02 m flush tolerances, omit z at the default spread and identify parts by key. Changing any of these silently detaches, clashes or drops parts in old designs and templates. Add a new part instead.
2. **Keep the legacy-twin rules** (`legacyTwin`, `pylonLink`, the clash exemption, `guessHost`, `oldStruts`). Templates and old saves depend on them, and flight builds physics from the same `buildAdjacency` (flight.js:33).
3. The 5e-4 "at default spread" test is shared by parts.js:931 (`legacyTwin`) and :1219 (`designRows`), parts3d.js:1621 and combat.js:61 (spread only, att not checked). Keep them in sync. `pylonLink`, `guessHost` and `oldStruts` treat any twin with no att the old way, at any spread; heating (vessel.js:906) uses the continuous distance from the default spread, with no tolerance.
4. `att` is an **index** in saved rows, an **id** in memory, and a peer **id** in MP spawn rows (`mpSpawnRows`, mp.js:35, with its own sanitising). Unknown rows must stay as null placeholders until links are resolved, and `cleanAtt` must run after loading.
5. Always sanitise through `cleanZ`, `cleanSkin` and `hasOwn(PARTS, ...)`: the same rules are reused by vessel.js:1178 (`Vessel.restore`) and mp.js.
6. After any mutation call `changed()`, or `changed(true)` for a live preview. Call `linkMirrors()` after operations that may break or create twins.
7. `loadDesign` replaces every part object. Never hold part references across undo/redo or load.
8. Draw code goes through `drawPart`, never `drawPart0`, or paint is lost. Use the body helpers for paintable surfaces, honour `PartPaint.flat`, and read position from the `q` passed in by `turned()`.
9. For shapes built by parts3d's lathe or extrude recipes (and the chute and cab), outline changes in `partPath0`/`HULLS` also change the 3D geometry, unless the shape has a `PART_PROFILE` entry (parts.js). Other recipes (wings, gear, guns, stores, props...) build from the def and use the 2D art only as a texture. Since PR #36 the same outlines are the builder's clash shapes (`clashShape`), so an outline change also changes where parts may sit; the look-alike jets' lofts (`us5Lofts`, `ruLofts`, `us4Rows`) are 2D outline, clash shape and 3D model at once.
10. The rocket stage logic assumes +y is up (`sp.y < e.y`). Plane parts must keep +y = nose and +x = down so the gear, canopy (−x side) and stores (+x side) drawings stay right.
11. Builder-only state (`mirror`, `selected`, `_primary`, `zGesture`) is not saved. Symmetry is recomputed from geometry.
12. `save()` is skipped while a battle borrows the builder (`MP.savedCareer`). `Builder.mp` changes the stats warnings and the allowed kinds.
13. **The clash test and `snug` change placement only** (PR #36). `partsClash` is called from builder.js alone; joins, physics, saves, multiplayer and the 3D models don't read it. Old designs therefore load, join and fly exactly as before; the most an old design notices is that a spot the builder used to refuse (a pod in the corner of a round hull's box) is now allowed. Keep it that way: never use `partsClash` or `shapesClash` to decide what joins.
14. **A look-alike jet's fields are opt-in** (`us5`, `ru`, `loft`, `body`, `look`, `fill`, `doors`, `bayRack`, `vec2d`, `irK`, `irst`, `twinMirror`, `vtail`, `wing.plan`/`crank`/`root`, `flush`, `glowAft`/`glowK`): each reader falls back to the old behaviour when the field is absent (`fill || 1`, `glowAft || 2`, the `vtail` defaults `0, 0.4, 0`, and so on), and the baselines prove no stock part moved. A new reader must keep that fallback.

## 2. Simulation and flight

All five files are plain globals, loaded in this order by `index.html:333-353`: util, space, terrain, parts, vessel, … career, …, flight, …, main. Everything is in SI units: metres, seconds, kg, N, kelvin and radians. Part *definitions* use tonnes (`def.mass`, `def.fuel`) and kN (`def.thrust`); the runtime converts them with `*1000`, and `p.fuel` is in kg. `G0 = 9.80665` (`util.js:5`) is used for Isp and g-loads. Gravity uses each body's own `mu = surfaceG·R²`.

### 1. space.js: bodies, orbits, prediction

**Bodies** are built by `makeBody` (`space.js:9`). It derives `mu`, `soi = a·(m/M)^0.4`, `n`, `period`, `orbitSpeed`, `terrainMax` (sum of the profile amplitudes + crater depth + |terrainBase|) and `warpAlt`. `warpAlt` is the floor for rails warp and the "low" rails event: `0.6R` for a star, else `atmoHeight`, else `terrainMax + max(1500, 0.02R)`. Every body is on a circular orbit in the sim **XY plane** (`childRel`/`childRelVel`, `space.js:149-157`). `orbitDir = -1` throughout, i.e. clockwise seen from +z, which is the game's "east" (decreasing angle).

| Body | R | g | orbits at | atmo (height, rho0, scaleH) |
|---|---|---|---|---|
| Sun `:32` | 6.0e6 m | 28 | — | star: parts melt below 0.35R altitude (`vessel.js:645`) |
| Mercury `:38` | 100 km | 3.7 | 0.8e8 | — |
| Venus `:46` | 290 km | 8.9 | 1.4e8 | 55 km, 9, 7500 |
| Earth `:55` | **315 km** | 9.8 | 2.0e8 (~6.5 d) | 30 km, 1.2, 5200; `ocean`, `terrainBase 40`, `padAngle π/2` |
| Moon `:103` | 90 km | 1.62 | 6.2e6 (Earth) | — |
| Mars `:111` | 170 km | 3.7 | 3.0e8 | 20 km, 0.06, 6000 |
| Phobos `:120` | 8 km | 0.06 | 1.2e6 (Mars) | — |
| Jupiter `:128` | 1200 km | 12 | 7.0e8 | 250 km, 2, 30000 |
| Europa `:137` | 80 km | 1.3 | 6.0e6 (Jupiter) | — |

`BODIES`/`BODY_BY_ID` are at `:145`. `bodyPos`/`bodyVel` (`:159`, `:167`) return Sun-centred values and keep a **one-entry cache per body** (`_pt/_p`). The Sun returns the frozen `ZERO`. Never mutate the objects they return.

**Earth sites** (`:69-99`): all positions are given in metres "east" of the pad along the surface, and `siteAngle(b, east) = padAngle - east/R` (`:101`). The sites are `pad 0`, `helipad 160`, `runway 760` (planes and cars start here), `bay -2300` (seaplanes), the `runway` strip 700..2700, and the `causeway` 3300..17200 (ashore at 17850). `flats` are flattened ground: each blends from `height` back to the natural terrain over `blend`, and later entries win. `airfields` (Shetland, Scotland) and `carriers` (west/east/south: deck 18 m, `hl 130`, `hw 18`, `cat 95`) get cached `c`/`s` from `yaw`.

**2D terrain profile** (`:177-217`):
- `terrainRaw(b, ang) = terrainBase + Σ amp·sin(k·ang+ph) - craters`. When `b.mapped`, it delegates to `Terrain.earthRaw`.
- `terrainHeight` (`:184`) applies `flats` using smoothstep blends. It starts from the **last** flat whose half-width holds the point, at that flat's own height, and blends in only the flats after it: on a flat's level ground the blend is exactly 0, so the natural ground under it never counts. `terrainRaw` (on mapped Earth the slow `Terrain.earthRaw`) is therefore never called on the pad, the runway or the causeway. The result is identical to blending every flat over `terrainRaw`.
- `airDensity` (`:219`): `rho0·exp(-alt/scaleH)`, faded to 0 between 0.8 and 1.0 of `atmoHeight`.
- `surfaceRadius`, `surfaceNormal` and `waterAt` (2D) are no longer used by the physics, which uses `Terrain.*`. `clearZone` (`:199`) is still used by scenery and dust.

**Kepler** (`:231-371`):
- `orbitPlane` takes the angular momentum and flips it so that `e3.z ≥ 0`. `e1` is the sim x axis projected into the plane. An ecliptic orbit therefore uses the plain x/y axes, and its in-plane `dir` (+1 CCW / -1 CW) carries the direction.
- `orbitOf(s, mu)` (`:251`) returns 2D elements from `elementsFromState` plus `e1/e2/e3` and `incl = acos(e3.z)`.
- `elementsFromState` (`:260`) classifies the orbit by **energy**:
  - It clamps `e` to `1∓1e-9` near parabolic.
  - `degenerate` (radial) when `p < r·1e-7`; then only `a/rp/ra` are filled in.
  - Ellipses get `n` and `period`; hyperbolas get `nuMax`.
- Solvers:
  - `nuFromMean` (`:306`): Newton's method. Ellipses use up to 50 iterations, starting from E=π when e>0.8. Hyperbolas use up to 60, starting from asinh.
  - `stateFromNu` (`:329`) lifts the in-plane state back to 3D.
  - `stateAt(o, dt)` (`:344`), `timeToNu` (`:347`, wraps to the next pass for ellipses) and `nuAtRadius` (`:356`).
  - `gravityStep` (`:364`) is a velocity-Verlet step for degenerate orbits.

**Patched conics**: `predictTrajectory(body, state, t0, maxPatches=4)` (`:376`) returns `[{body, o, t0, tEnd, end, next}]`, where `end ∈ impact|escape|encounter|radial|null`.
- `impact` is only tested when `rp < R + terrainMax·0.5`. It uses the descending crossing of radius R.
- `escape` is tested when `e≥1 || ra>soi`.
- `findEncounter` (`:423`) samples the conic up to min(best, period or 4e6 s). The step is bounded by `0.6·soi/(vmax+orbitSpeed)`, with at most 5000 steps, then 32 bisection steps.
- At a patch change the state is converted with `childRel/childRelVel` on x/y only; z and vz carry over unchanged.

Other helpers:
- `closestApproach` (`:455`): 600 samples.
- `transferWindow(r1, ang1, n1, target, t)` (`:478`) gives the Hohmann phase-angle wait and returns `{wait, transferTime, error}`. **It returns the bare number `Infinity` when the rates match.** The HUD tolerates this only by accident.
- `deltaVChart` (`:495`): the rough Δv map, from low orbit at `R + warpAlt + 5 km`.

### 2. terrain.js: the 3D ground (IIFE `Terrain`, exports at `:682`)

**Coordinates**: a surface point is `(a, z)`. `a` is the sim angle in XY (as in 2D) and `z = latitude·R`, metres across the track. Game **east = decreasing a** and game **north = -z**.

**Real Earth placement** (`:86-118`):
- `SITE = {lat 62.16, lon -7.33, head 119}` puts the pad on the west coast of the Faroes, with the game's east bearing 119°. `GM` is the rotation matrix.
- `toGeo(a, phi)` → `{lon, lat}` in radians. It returns the **shared singleton `GEO`** and remembers the last point, so copy the values before the next call.
- `toSim` is the inverse.
- `bearingAt` (`:140`) converts a sim east/north direction into a real compass bearing (used by the HUD compass).
- `CLIFFS`/`cliffs` add sea cliffs on the Faroes and Shetland. `treelessAt` marks treeless ground.

**Map loading**: `loadEarth(urls)` (`:180`) is called from `App.init` with `EARTH_MAP_FILES` (`main.js:463`). Images are decoded with `createImageBitmap(..., {colorSpaceConversion:'none'})` so the bytes come back exact, with `<img>` as a fallback. `height` and `color` are required; the other layers are optional (`opt`). `EM.state` goes `none → loading → ready|failed`. `setEarthData` (`:152`) unpacks the layers:

| Layer | Contents |
|---|---|
| `earth-height.png` | height bytes through the non-linear `HLUT` (`:147`): about −903 m to +1515 m |
| `earth-color.jpg` | Blue Marble colour → `EM.rgb` |
| `earth-night.jpg`, `earth-urban.png` | single channels |
| `earth-lakes.png` | R = coverage; G·256+B gives the level as `/20 - 1000` m |
| `earth-regions.png` | R·256+G = country index, B = sea index |
| `earth-places.json` | `regions`, `nCountries`, `cities` (`[name, ?, pop, lon, lat]`) |
| `earth-lines.bin` | rivers and roads in the `'RL02'` delta-coded format, indexed on a 0.2° grid by `indexLines` (`:237`) |

`setEarthData` then clears `cfgs`, `hc` and `hwc`, **sets `EARTH.terrainMax = 1700`** (the profile value is 352) and sets `EARTH.mapped = true`. On failure the console warns and Earth keeps the generated terrain; that is also what happens for `file://`. `App.afterEarth` (`main.js`) makes launch and resume wait while the map is loading.

**Sampling**:
- `samp`/`mapH` (`:202`, `:209`) bilinearly sample the equirectangular rasters. `earthColor` (`:218`); `nightAt`/`urbanAt`/`lakeAt` (`:229-232`).
- `lineQuery(lon, lat)` (`:273`) returns the nearest river and road (shared `LQ`).
- `features(h, lon, lat, fade, cell)` (`:304`):
  - Rivers carve a valley down to `mapH(centreline) - 0.6`.
  - Roads are levelled to the map's smooth height, raised to a deck over rivers.
  - Side results go to the shared `EW` (`Terrain.water`): `level`, `pres`, `road`, `river`, `lake`.
- Location lookup:
  - `regionAt` (`:338`) gives country and sea names.
  - `citiesNear(lon, lat, r°)` (`:354`) uses a 1° grid and returns `[city, dist_m]` sorted by distance.
  - `cityRadius(pop)` (`:372`).
  - `locate(b, rx, ry, rz)` (`:663`) gives `{a, lat, z, r}`.
  - The HUD's "Over France · Paris" comes from `Flight.whereText` (`flight.js:1298`).

**Height model**:
- `cfgOf(b)` (`:419`) builds the per-body config, using `LOOK` (`:46`) and `DIRS`. It is cached in `cfgs`.
- `grid`/`setCol`/`setRow` (`:448-474`) cache the trig per column and per row, so `natural()` (`:501`) evaluates `Σ amp·sin(k·a+ph + kc·phi)` as products. Each profile octave carries on at its own angle off the track.
- On non-mapped bodies, `natural()` turns the profile's craters into round bowls and adds hashed craters (`craters`, `:482`, kept away from the track), detail noise that fades where the grid is coarse, and fbm continents (`contAt`, `:475`) faded in for `|z|` between `c0=1200` and `c1`.
- Mapped Earth uses the map height instead of the continents, then adds the profile's short octaves as hills (`hillW`), a ragged coast (`coastN`), the pad island (`ISLE`, `island()` `:376`, which only adds land), cliffs and `features`.
- `earthRaw(a)` (`:400`) is the same recipe along the equator. It is the 2D profile when the map is loaded. It keeps its last four answers, keyed exactly on `a` (`rawA`/`rawH`, a ring in two Float64Arrays, `:398`), because ground contact asks again at the same angle a few calls later; `setEarthData` clears them (`:176`). The work is in `earthRaw0` (`:406`). (A Map memo was tried: hashing cost about as much as it saved.)
- `setCol(c, G, i, a, dx, lazy)` (`:456`): with `lazy` (only `h3dAt`, `:599`) the column's track height `G.th` is left NaN, and `height()` works it out only where the track's ground blends in (`B > 0`, `:588`).
- `height(c, G, i, j, cont)` (`:586`):
  - Blends natural ground toward the profile height `G.th` by `builtW`. That is 1 within `trackHalf(e)` (`:58`): 25 m in general, 260 m at the pad, 45 m along the runway, 14 m on the causeway. It fades out over `trackBlend`, and aprons are added.
  - Flattens airfields (`fieldAt`, `:547`).
  - Leaves `crDark` behind as a side result (read with `Terrain.dark()`).

**Physics API** (`:603-680`):
- Internals: `onTrack(b, c, a, z)` (`:616`: `|z| ≤ trackHalf`, or 25 m off Earth), `latticeAt` (`:618`, the 2 m lattice) and `inlandOff` (`:628`, its inland water). The four exported lookups are built on them and give the same results as before; each one works out `onTrack` once.
- `heightAt(b, a, z)` (`:642`) returns **exactly `terrainHeight(b, a)`** on the track. Elsewhere it bilinearly interpolates a **2 m lattice cache** `hc` (key `iz·n + ia`, where n = circumference/2 m). The parallel cache `hwc` holds inland water levels. Both are cleared when the body changes or when there are more than 80000 entries.
- `surfaceAt` (`:647`): returns the carrier deck height (`deckAt`, `:573`, polygon `DECK_PLAN`). Otherwise ocean `h<0` gives 0, inland water above the ground gives the water level, and anything else gives `heightAt`. On the track it doesn't ask for inland water, which is always NaN there.
- `waterAt` (`waterAt3`, `:655`), likewise.
- `normalAt` (`:669`): central differences of `surfaceAt` 1.5 m apart. Normals are **not cached**; they come from the cached heights. Decks are flat. `normalAt` and `waterAt` call `deckAt` once.
- **Side results are read at once.** `Terrain.water` (`EW`), `toGeo`'s `GEO` and `lineQuery`'s `LQ` are only ever read right after a `height()`/`lineQuery`/`toGeo` call of the reader's own. The `earthRaw` memo and the lazy `th` rely on that (a memo hit leaves the side results of the last real call); any new reader must keep to it.

**Time-sliced patches** live in render3d.js:
- `patchJob` (`render3d.js:949`) is a generator that fills a double-buffered patch with `setCol`/`setRow`/`contAt`/`height`, yielding every 8 rows.
- `updatePatch` (`render3d.js:2618`) runs it for 3–4 ms a frame, plus up to 16 ms as the craft nears the patch edge. It calls `buildPatchNow` when nothing usable is on show.
- `bodyJob` (`render3d.js:660`) paints planet maps a few rows per frame the same way.

### 3. vessel.js: the rigid body

**Part space and frames.** Part space is the builder's: +y runs up the stack, x is across, and z is depth, out of the blueprint (a plane's right wing). `q` rotates part space about the centre of mass into sim axes; `av` is the angular velocity in sim axes; positions are relative to the body centre. Placement is done by `placeOnSurface(body, ang, rot, z0, yaw)` (`:1069`): `q = basis(east, up, north) · yaw(about part y) · rot(about part z)`. `rot` comes from `VEHICLE_KINDS[kind].launchRot` (`parts.js:25`). `surfaceFrame().north` (`util.js`) is **+z**, which is to the *right* of east (game south). That is why `heading()` (`:634`) measures from `-north`.

| kind | launchRot | `PILOT` (F nose, U up; R = F×U) `:99` | stick map [W/S, A/D, Q/E], rate rad/s | `DRIVE` `:106` |
|---|---|---|---|---|
| rocket | 0 (y up, x east) | F +y, U +z, R +x | pitch, yaw, roll; 1.1/1.1/1.5 | F +x, U +y |
| plane | −π/2 (nose +y east, belly +x down) | F +y, U −x, R +z | pitch, roll, yaw; 0.9/1.9/0.45 | F +y, U −x |
| heli | 0 | F +x, U +y, R +z | pitch, roll, yaw; 0.9/1.0/1.4 | F +x, U +y |
| car | 0 | F +x, U +y | pitch, roll, yaw; 0.9/1.2/1.2 | F +x, U +y |

**Depth and mass** (helpers in `parts.js:862-911`):
- `partZ(p)` gives a single part's depth, or how far out each copy of a twin pair (`def.twinZ`) sits.
- `partZs` gives the depth of each copy, ±z for a pair.
- `partZc` is 0 for pairs, so a pair never moves the COM across.
- `massZs` (`vessel.js:17`) also splits an axle wheel (`wheel.track`) into its two wheels.
- Wings, legs and fins are z-locked at 0.

`recompute(initial)` (`:171`):
- Computes mass and `com {x, y, z}`. When not `initial`, it shifts `x/y/z` so the **parts stay fixed in space** as the COM moves; this is called after every burn.
- Builds the **full 3×3 inertia** from box parts, with each copy's z offset (`zz` mean square, `zm` mean), and inverts it by blocks: the x–y block, then the Schur complement `s ≥ 1e-3`. With nothing off the centreline the result is *exactly* the old 2×2 inverse and `1/Izz`.
- Sets `bounds`, `width` (x extent), `depth` (z extent) and **`across = max(width, 2·max(|partZ| + partDepth/2) over non-twin parts)`**. A rocket is round about its stack.
- What it needs of each part that only the part's type, place, turn and depth decide comes from `partGeo(p, i)` (`:161`): cached by index in `_geo`, keyed on `p`, `def`, `x`, `y`, `z` and `rot`, so a burning engine (recompute every step) no longer redoes `partDims`/`partRect`/`partZs`/`massZs`. Only `partKg` (fuel, stores) is evaluated every time. The arithmetic and its order are unchanged, so the baselines are too.
- `mulI`, `mulInvI`, `invIWorld` and `bodyAV` are helpers.

`rebuildGroups()` (`:231`) **must run after any change to parts or adj**. It rebuilds:
- `groups` (from `fuelGroups`) and `byId`.
- The nose `top`, which gives `noseAero` and `noseSharp`.
- `wheels`, `fins` (rocket fins), `wings`, `vtails` (shape `vtail`), `airbrakes`, `vecs` (flat vectoring nozzles, `def.vec2d`, :242; PR #36), `hasFlaps`, `hasRetract` and `aircraft = wings.length > 0`.
- `mainWing` (largest non-control wing), `stallAoA`, `clS`, `wingS`/`vne`/`mmax` (the design's weakest limits, for the builder; physics uses each wing's own), `rotors` and `tailRotors`.
- It then calls `recompute(false)`, `computeAreas` and `computeHull`.

`computeAreas` (`:263`) gives the projected areas per axis and the gear drag. Seen head-on a part fills its box (`w × depth`), a round (`ROUND3D`) one 0.785 of it, and since PR #36 a shaped body `def.fill` of it (:270): the FS jets' lofted bodies work it out from their sections (0.45 to 0.95; the MyG and Sugoi hulls have none). Without it a lofted fuselage counted as a full box and no jet could pass about Mach 1.9. Parts without `fill` count as before, so the baselines didn't move. `computeHull` (`:290`):
- Hull points are box corners at each copy's depth; a `ROUND3D` shape gets a diamond at each end.
- **Rocket** legs and fins also get a copy turned 90° about the stack.
- Wheel points come from `wheelGeom`, for each `massZs` copy.
- It also computes `wheelbase` along `drive.F` and `reach` (max distance from the COM, plus 0.5).

`kind` must be set **before** `rebuildGroups`, because the hull's radial copies and the wheelbase depend on it.

**Step** `physicsStep(dt, sim)` (`:641`), in part axes:
1. **Gravity.** The star check is `:645`.
2. **Engines.** `applyEngines` (`:375`) works per fuel group.
   - Solids burn their own fuel at full thrust. Liquids use `thrust·throttle` and draw fuel in proportion to what each tank holds, scaled down if the fuel runs short.
   - Isp is `lerp(ispVac, ispSL, rho/1.2)`.
   - Air-breathers use `airThrust` (`:79`; nothing below `MIN_AIR = 0.03`; jet/fan/ram/prop curves). The afterburner lights above 0.9 throttle (more thrust; Isp `/ (1+1.6·abK)`).
   - Thrust lies along `partAxis` (in the x–y plane only). Its torque is `r×F` with `rz = partZc - com.z`, so an engine out on one wing yaws the craft.
   - Gimbal authority is `f·sin(gimbal)·|lever|`. A `vec2d` engine (the FS-22's flat nozzle, PR #36) swivels only in the blueprint plane, so its share goes into a separate `gimbalZ` (:388) that turns the craft about z alone: a plane's pitch. `applyEngines` returns `{F, T, total, gimbal, gimbalZ, rotorTorque}` (:450). A single prop rolls the craft (`-0.035·f·w/2`); twins and contra-props don't.
   - `spinRotors` (`:454`) winds rpm up and down.
3. **Control** (`:659-688`).
   - Authority `A` is the reaction wheels (`def.torque`) + gimbal + rotor torque, and on z also `gimbalZ` (:661). On y it is `0.6·rotorTorque` with a tail rotor, 0.15 without. It is halved on wheels; `righting` adds `14·m·width`.
   - `turnTarget` (`:504`) returns the wanted body rates. Then `need = I·(wt−wb)·0.35/dt`: torque goes in up to `A`, and the control-surface command is `need/(surfAuth+A)`.
   - A flat nozzle shows the pitch it gives: `tz = need.z/A.z` (:675) is the share of the pitch authority in use, and each part in `vecs` eases its `p.deflect` towards `−tz·gimbal`, signed by which side of the centre of mass the nozzle is, at a rate of 14/s, and back to the centre while it doesn't fire (:680-684). It is for the eye only: the 2D art and the 3D `pivot` swing the flaps, and `deflect` already travels in multiplayer part states, so the other players see it. The Russian vectoring engines (Sugoi-35, Sugoi-57) are plain `gimbal` engines (all three axes, as the stock Thrust-Vectoring Jet); their nozzles swing in 3D from the stick command (chapter 3 §3).
   - `cmd` slews at 10/s on aircraft.
4. **Aero** (`:700-859`): `dynP`, `airspeed`, `mach` (`soundSpeed`, `:93`).
   - **Rocket drag** (`:706`, "keep as is"): `cd` is 0.32 (aero nose) or 0.62 nose-first, 0.75 tail-first, 1.0 sideways. `area = across·(across·|along| + L·(1−|along|))·0.8`.
   - **Other kinds**: per-axis areas with `cdF`/`cdO`, the car's `cdO` being 0.5. A plane's cross-flow terms are squared. Wave drag (`waveDrag`, `:76`), gear drag and air brakes are added.
   - Parachutes, then weathervaning: `0.04·area·min(L,6)` plus rocket fins below the COM.
5. **Wings in halves.** The local `surf()` (`:765`) handles one surface. Each half has half the area, sits at `±span/4 − com.z`, and its normal leans by the dihedral. Its centre of lift is a quarter chord ahead, less `back` for sweep.
   - Lift is `liftCoef` (`:24`, linear to the stall, then towards `1.1·sin2α`) plus deflection, flaps (+0.8 CL; stall −0.03), ground effect (`1+0.3·e^(−3h/span)`) and `Combat.liftK`.
   - Drag is `cd0 + kInd·CL²` + post-stall + wave terms. Reversed flow is treated as a flat plate.
   - Deflection is `kd·min(1, 26000/q)` toward the commanded torque. Plain wings carry ailerons, `kd = 0.12`.
   - `wingAero` (`:32`): Helmbold lift slope from aspect ratio and sweep, `kInd = 1/(π·0.8·AR)`, stall 0.3, dihedral 0.06, `load = 14000` (70000 for control surfaces) × `w.load` N/m², `vne` 110, `mmax` 0 (no Mach limit; both 0 for control surfaces). The result is cached per def. `swingAero` (`:50`) sweeps the wing with Mach (writes `p.sweep`).
   - Each `vtail` is one surface, a pair counting as twice the area. Then `slip = asin(hz)`.
   - Planes get extra fuselage+fin yaw damping (`:825`).
6. **Structure.** `rr = |Fn|/(load·area)`; fins use `FIN_LOAD = 45000`, and noodle wings ×0.25.
   - Above 1, `stress` builds at `(rr−1)·2·dt` and decays at 0.12/s.
   - The surface is **ripped** when `rr > 1.8`, or `stress ≥ 1`, or noodle wings are over the limit at all. This is reported through `sim.ripParts` at the end of the step.
   - `strain` is the max `rr`; `nz` is the load through the floor.
   - **Flutter** (owner's request, after PR #23 had made overspeed a warning only): for each wing with a `vne`, `r = max(EAS/vne, M/mmax · smoothstep(0.02, 0.06, ρ·1.2/ρ0))`, with `EAS = √(q/0.6)` (the HUD speed at sea level); the Mach limit fades out between about 15.6 and 21.3 km on Earth, so a space plane coming home keeps its wings and both limits ×0.5 for noodle wings and ×√`liftK` for a damaged wing. Above 1, on a craft with its control part that isn't debris (debris doesn't tear from load either), `stress` builds at `((r−1)·3 + 0.12)·dt` (the same stress as the load uses); it rips at `r > 1.3` or `stress ≥ 1`, with `ripWhy = 'speed'` passed to `ripParts`. `overspeed` is the worst wing's `r`. `overWarn` is the same for the warning but, on the way down (`vSpeed < 0`) in the fade, counts the full Mach limit, so a craft coming home too fast is warned high up; `overMach`, whether Mach set the warning.
   - Limits (`vne` as km/h EAS / `mmax`): biplane 560/0.48, glider 500/0.5, long straight 750/0.66, wing and elliptical 850/0.74, small wing 900/0.74, airliner wings 950/1.02–1.05 (the subsonic wings' Mach limits keep their HUD breaking speed about level from sea level to 12 km), swept 1350/1.7, forward-swept 1400/1.8, swing 1550/2.5, delta 1600/none, tailplanes and strakes 2000/none. The look-alike jets' wings (PR #36): FS-22 1750/2.5, FS-35 1649/2.0, MyG-21 1700/none, MyG-29 1700/2.6, Sugoi-27 (also the Sugoi-35's) 1700/2.8, Sugoi-57 1700/2.6, FS-4 1600/2.6, FS-16 1620/2.4 (its strakes 2000/none), FS-15 1620/2.85. Every jet on full afterburner low down reaches 0.84 to 0.92 of its limit, so it warns and doesn't tear, and the Mach limits sit a little past each jet's top speed up high (`flutter.test.js` holds the table). Moving surfaces, vertical tails and rocket fins have none. Heating caps the delta at high Mach. `structAlert` shows the speed warning before the g one while a wing flutters, unless the load is past its limit too, and counts no flutter stress towards the g level.
   - `gRating() = wingS/(m·g)` (`:631`).
7. **Heat.** `updateHeat` (`:897`): `flux = ρv³·smoothstep(500, 1400, v)`.
   - Above 2e6, each part's `_lead` is its forward extent along the flow, plus the **twin "across" rule**: a single part adds `partZ·sz`; a pair adds `(partZ − twinZ)·|sz|`. A pair at its catalogue spread therefore counts as on the centreline, so stock designs heat exactly as before.
   - Parts within 0.3 m of the front get full flux (`temp += flux·2.8e-6`); the rest get 0.12. Everything cools at `0.08·(T−290)`.
   - Over `def.maxTemp` (default 2000 K, `parts.js:810`), the part breaks via `sim.breakParts(..., 'heat')` and the step returns early.
   - A heat shield is just a part with `maxTemp 4200` placed on the leading face. Pods have 2400–2600.
8. **Integrate** (`:862`): semi-implicit Euler for velocity then position. Euler's equations in body axes include the gyro term `ω×Iω`, body rates are clamped to `MAX_SPIN = 6` rad/s, and `integrateSpin` (`:888`) does a first-order quaternion update with `qnorm` every step. Then `ground()`, then rips.

**Autopilot** (`turnTarget`):
- A heli without wings: the stick sets a target lean (`±0.42` rad) and levels on release; Q/E yaw.
- Stick input is ignored for rotation while on driving wheels.
- Rovers and cars (`sas==='hold'`, no input) level to `normalAt`, with "righting" when on their side.
- `sas` 'off' gives the stick only. `sasHeading` (`:471`; prograde, retrograde, radialOut, radialIn, target) steers the stack axis (+y) with no roll.
- An open chute gives the stick only.
- Wingless non-heli craft hold zero rate: rocket "hold" is rate damping.
- Aircraft go through **`planeTarget`** (`:571`):
  - `hold` keeps the pitch and bank captured at release.
  - `level`/`heading` hold altitude with an attitude loop (`pitchHold` integrator; `ogAutopilot` silly variant). `heading` turns `hdgHold` with A/D at 0.3 rad/s and banks up to 0.45.
  - Always: a **coordinated rudder** (`yaw = g/V·sin(bank)·cos(pitch) + 2.5·slip`; held rudder is limited to about 12° slip), aileron roll scaled down when slow or slipping, low-speed nose-down below `1.35·Vstall` while climbing, a pitch-rate clamp to `[−3g/V, 8g/V]` (:624), ×0.4 on wheels, and AoA protection at 0.85 of the stall.

**The look-alike jets in flight (PR #36).** They are built at the real aircraft's size and lightly loaded weight, with engine thrust in proportion to the stock engines (the Fighter Turbofan stands for a 76 kN class engine), and reach about the real one's top speed: Mach 2 to 2.3 at 10-11 km (the FS-35 about 1.6; the game's atmosphere thins faster, so "up high" is lower than in life), a little past Mach 1 on the deck, the FS-22 Mach 1.7 without the afterburner. Their wings are rated about as strong as the real ones (chapter 1 §5 has each jet's g): MyG-21 8.5 g, FS-4 7.4, the FS-16, MyG-29 and FS-15 9.0, the Sugoi-57 9.5, the FS-35 9.6, the Sugoi-27, Sugoi-35 and FS-22 about 10.4, all with full fuel. Their prices are on one scale with matched rivals: each fits a $120k battle as it comes, the MyG-21 a $45k one ($44,600) and the FS-16 a $75k one ($74,500); the dearest is the FS-22 at $119,300 (chapter 1 §5, chapter 4 §3).
- **Over-g.** With any autopilot mode on, `planeTarget`'s pitch-rate clamp holds the pull to about 8 g, so no jet tears a wing. `sas` `'off'` is the bare stick (`turnTarget` returns the stick itself, :546) with no limit at all, as the owner wants (control comes first). There, a Sugoi-27 or Sugoi-35 pulled fully back at 1,150-1,440 km/h low down used to reach 18-20 g and lose a wing in 0.6 s, before the strain warning could help. The review gave their tailerons less authority (`control` 0.35 → 0.22), the Sugoi-35's nozzles less swing (`gimbal` 0.3 → 0.1) and the wing the FS-22's rating: now the warning comes at 0.3 s and the wing goes at 2.5 s (Sugoi-27) or 1.1 s (Sugoi-35), and half stick breaks neither.
- **Post-stall.** The FS-22's flat nozzles keep pitching it when slow or stalled (measured when they were added: full stick for 0.6 s at 90 m/s gave 14° of pitch, against 2° without them). The Sugoi-35 and Sugoi-57 vector in every axis. With the autopilot off the Flankers can be pulled past the stall into Cobra-like attitudes; every autopilot mode keeps them clean.
- **Handling.** Each jet takes off from the runway, flies hands-off on the autopilot without drift, and turns and climbs without departing in `hold`, `level` and `heading` (`node test/handling.js`, chapter 6). With the autopilot off a jet with its gun off the centre line drifts hands-off: the game has no trim (chapter 7).

**Parachutes** (`:725-749`; deploy gate in `Flight.deployChute`, `flight.js:358`: needs air, below 0.85 atmoHeight, refused if `v>250 && q>12000`):
- A drogue opens to 0.3, and the main to 1 below 1500 m above the ground. `cdA += (18+520k²)·chuteArea`.
- The canopy hauls the top of the craft round to trail behind it, and its rate damping is `1.5·I·ω`.
- It is torn off when `q > 25000` and it is more than half open.
- `brakeChute`: tears at `q > 9500` and collapses when stopped.

**Ground and water** `ground(dt, sim)` (`:931`):
- Broad phase uses `reach`, `terrainMax` and the deck.
- Probes hull points (radius 0) and wheel rims, skipping retracted gear. A point deep under a deck edge counts as hitting the ship's `side`.
- **Crash**: the normal closing speed is compared with `breakSpeed` (default `DEFAULT_BREAK_SPEED = 9`; ×1.8 on water) **×1.6 whenever `Combat` is loaded** (always in game). Between 0.75 and 1.6 of the limit, `Combat.impact` dents the part instead. A prop or rotor touching ground with rpm > 8 shatters. Broken parts go to `sim.breakParts(...,'impact')`; the `bouncy` silly setting skips this.
- **Wheels and floats** get anisotropic friction (`mu1` rolling, `mu2` sideways; casters, brake 0.8, floats glide on water). Front wheels steer: `steer = in·min(0.6|0.5, (6|3)·wheelbase/v²)`. Everything else gets isotropic friction of 0.9 (0.15 on water).
- Solver: 4 sequential-impulse iterations (bounce only when `vn < −2`), then a position push-out of 0.9 × the deepest penetration.
- Drive is a speed controller toward `ctl.v·wheel.speed`. Without power, wheels coast down gently.
- In water without floats, velocity damps by `e^(−0.6dt)`.
- `landed` = contact for more than 0.2 s and speed < 1.5. Resting for 0.5 s zeroes the velocity. Flight skips sleeping non-active vessels.

**Splitting** `splitComponents` (`:1120`): keeps the component holding the control part. Each other component becomes a new `Vessel` with the parent's `q`/`av`, `pointVel` velocity, `kind`, `gearUp` and the remaining stages filtered to its parts; `isDebris = !control`. Stages up to the current `stageIdx` are never touched. `serialize`/`restore` (`:1166`, `:1178`): `restore` turns pre-3D saves (`rot`, `w`) into `q`/`av` and puts back `x..vz` after `rebuildGroups`.

### 4. flight.js: the flight scene (`Flight` object)

**From design to vessel**: `Flight.start(design, opts)` (`:28`). The design is `{name, kind, parts: rows}` from `Builder.serialize` / `designRows`.
1. `partsFromDesign` (`parts.js:1227`) → `buildAdjacency` → keep `componentOf(findControlPart)` (a control part is required) → drop `att` links whose host was left behind.
2. `new Vessel` (on `EARTH`), set `kind`, `computeStages`, `rebuildGroups`.
3. `placeOnSurface` at `opts.place` (multiplayer spawn: `e, z, yaw, catapult`) or at `EARTH.sites[K.site]`. A plane on floats with no wheels starts in the bay facing π.
4. A heli starts with throttle 0 (the default is 1).
5. Outside multiplayer: `Career.spend`, then `resetState`, the 2D `scale`, and `save()`.

**Loop** `update(rdt)` (`:505`), called from `App.frame` (`main.js:59`; real dt capped at 0.1 there and 0.05 here):
- `WARPS` (`:4`): indices 0..3 (1–8×) are **physics warp**. There are `max(1, ceil(total/PHYS_DT − 0.05))` substeps (`:531`) with `PHYS_DT = 1/120`, or 1/60 at 4× and up. Frame times come in a hair over 1/60 s, so the 0.05 lets a step run up to 5% long rather than add a third: a 60 Hz frame makes exactly 2 steps, a 120 Hz frame 1, and physics runs 120 steps a second on either (with `− 1e-6` before PR #35 it was 157 a second at 60 Hz and 195 at 120 Hz; no baseline moved). They step the active vessel and vessels within `NEAR_DIST = 6000` m, or controllable craft that are flying below `warpAlt`.
  - Far vessels advance on rails. Uncontrolled ones that would go "low" are deleted.
- Index > 3 is **rails**: `railsTick` → `railsAdvance` (`:680`). This is chunked Kepler propagation with events `low` (`r < R + warpAlt`), `out` and `in` (40-step bisection), and `gravityStep` for radial orbits.
  - `canRails` (`:192`) refuses when engines are burning, or the craft is in the atmosphere or near the surface.
  - Entering rails zeroes `av`.
  - Warp drops automatically if a frame costs more than 14 ms.
- `physicsTick` (`:631`) does `physicsStep`, `checkSOI` (`:646`; re-bases x/y and vx/vy only), the catapult and arrestor wires, `Combat.step`, and `time += h`. Then come `cleanup` (debris further than 150 km goes), `checkMilestones` and audio warnings. Prediction updates every 0.3 s (0.12 s on the map), Δv every 0.5 s, the HUD every 0.08 s, and an autosave every 10 s. The prediction, Δv and HUD timers don't run while `paused` (`:575-582`); the autosave timer does.
- `Flight.frameN` (`:507`) counts frames. `groundAlt(v)` (`:812`) is a per-frame memo of `v.groundAltitude()`, keyed on the frame and on the craft's position, attitude, `com`, `hull`, `wheelPts`, `gearUp` and body: the HUD, the hints, engine dust, rotor wash and the milestones all ask, and it is worked out once a frame instead of 3 to 12 times. The physics itself still calls `groundAltitude` directly.

**Pause, screen wake lock and sound**:
- `setPaused(on)` (`:138`) is the only way to pause or resume (`openMenu` and its `onClose`, `recover`). Pausing brings `updatePrediction`, `updateDvEstimate` and `updateHUD(true)` up to date once; the HUD is then left alone until the flight carries on.
- `syncAwake()` (`:122`) decides both. It runs from `resetState` (`:101`), `stop` (`:109`), `setPaused`, `onDestroyed` (`:394`, and `:402` when that ends the flight), `switchTo` (`:296`) and a `visibilitychange` listener (`:1010`).
  - The screen wake lock is held while `running && !paused && !ended && !destroyed && !document.hidden`. The browser drops it in the background, so it is asked for again on the way back. It handles the sentinel's `release` event and a request still pending (`lockAsked`).
  - Sound is live (`Sound.setLive`, §5.3) while `running && !paused && !ended`.
  - Multiplayer's own lock for the room (`MP.awake`) is separate and unchanged.

**Controls**:
- Keys are read by `e.code` in `bindDom` (`:978`):
  - `readControls` (`:588`) fills `v.ctl {v, h, r}` from W/S, A/D, Q/E and the arrows, plus the touch stick (`#joy`, 0.12 dead zone) and the `#rot-left/right` buttons. Shift and Ctrl change throttle at 0.9/s; Z and X go to full and cut.
  - Space stages. 1–6 is rocket SAS; 1–4 for planes is hold/level/heading/off (`PLANE_SAS_KEYS`).
  - M toggles the map and N switches the map view. `,` and `.` change warp. `[` and `]` switch vessel.
  - B brakes, F cycles flaps (0/0.5/1), G toggles gear, C resets the camera.
  - V, Tab and K are weapons and countermeasures, L launches the catapult, R recovers, Esc and P open the menu.
- Pointer: drag orbits the 3D camera (`Render3D.orbitBy`), pinch or the mouse wheel zooms, and a tap calls `tapAt` (`:1160`). In 3D that is `Render3D.pickPart`; in 2D it is `hitTest`. `usePart` toggles an engine, fires a separator or opens a chute.
- **There is no gamepad support.**

**Staging and breakage**:
- `stage()` (`:307`): separators first, then engines (if fuelled), then chutes. A chute-only stage that fails to deploy is kept.
- `fireSeparator` (`:331`): `cutSeparator` keeps the separator with the piece that falls away, then the two pieces get a 2.2 m/s relative push and a little tumble.
- `breakParts` (`:372`): removes the parts, splits the rest and calls `onDestroyed` if control is lost.
- **`ripParts(v, parts, cause)`** (`:258`; cause `'g'`, `'speed'`, `'impact'` or a hit, for the toast): takes along each part's `att` chain unless that chain holds the control part, cuts adjacency, then splits.

**HUD** `updateHUD(force)` (`:1314`), every 0.08 s; not while paused, when `setPaused` has brought it up to date once (a paused flight made 12.5 HUD updates a second before PR #35):
- Altitude, ground (below 5 km), speed (km/h for non-rockets), Mach, AoA/STALL, compass (`compass` via `bearingAt`), damage, g (`nz/gRating`), the `#flight-alert` from `structAlert` (`:1287`: g at strain > 0.85 for planes, speed for anything with wings: amber at max(`overspeed`, `overWarn`) > 0.9, red at `overspeed` > 1; nothing once the craft is lost). While a wing flutters (`smoothstep(0.97, 1.15, overspeed)`, not paused, not lost) `flutterShake` (world.js) shakes the 2D view and the 3D camera, and the wind sound roars.
- Orbit rows are hidden for low aircraft. Also Ap/Pe with times, Δv (`estimateDeltaV`), heat bar, target/window, encounter/escape/impact, stage fuel and stage text. The fuel bar moves by `transform: scaleX` (`:1414`), so it costs no layout.
- The weapon box comes from `Combat.status` (chapter 4 §1.2; `:1422-1433`): shown whenever there is one, including for a craft whose only weapons are flares or chaff (`cmOnly`: no FIRE button, `:1425`; before PR #35 such a craft had no box and so no CM button on phones). `#btn-cm` shows while flares or chaff are left (`:1424`). The ammo line reads rounds · `✦` flares `≋` chaff · `◈` stealth · kills (`:1429-1431`); a `cmOnly` craft keeps showing `✦0`/`≋0` once it has used everything.
- Hints come from `hint`/`vehicleHint`. The weapons hint asks `Combat.systems(v).length` (`:1257`), so it doesn't fire for flares or chaff alone.

**Camera**: `updateCamera` (`:1454`) follows the view vessel's *body-relative* position (`camRel`), so a wreck stays in view (the `ghostCam` silly setting reverts this). `viewQ` slerps to the local surface frame, and `viewRot` is used for 2D.

**2D fallback**: `App.use3D()` (`main.js:146`) is false without WebGL, or with the `retro2d` silly setting. `Flight.render` then calls `World.render` (`world.js:317`), which uses `F.scale`, `viewRot`, `camAbs`, `v.rot` (the planar projection of `q`, `vessel.js:154`) and `com.x/y`. The physics is the same 3D simulation either way.

**Saving**:
- `serialize` (`:145`) writes `{v:2, time, design, launchCost, active, flags, stats, target, scale, vessels}` to `store['rss.flight']`. It skips AI craft, dead craft and uncontrolled debris.
- It saves every 10 s, on Save & exit, and on `visibilitychange`/`pagehide`. Nothing is saved in multiplayer.
- It is cleared on revert, recover, a new launch, or destruction with no other controllable craft left.
- `restore` (`:159`) bumps `_partSeq` past the restored ids.
- Recover (`:417`): landed or splashed on Earth, speed < 1.2. It refunds 90% of `value()`.

**Missions hook**: `checkMilestones` (`:823`) raises flags: `liftoff`, `alt1k`, `space`, `soi:/orbit:/land:<id>` (an orbit needs `rp > R+warpAlt` and `ra < soi`), `sunDive`, `escapeSun`, `takeoff`, `flyHigh`, `runwayLanding`, `supersonic`, `mach2`, `seaplane`, `hover`, `drive1k`. Recover adds `recoveredSpace`, `home:<id>` and `splashdown`. `award` (`:798`) → `Career.onFlag` (not in multiplayer).

### 5. career.js

`MISSIONS` (`career.js:4`) has 41 entries: 13 fixed missions, plus flyby/orbit/landing/return for each body (scaled by its tier; no landing or return on Jupiter), plus `escapeSun` and `sunDive`. Each is matched by `flag`.

`Career.data` (`'rss.career'`) holds `mode` (`null` | `'sandbox'` | `'career'`), `funds` (starts at 50000), `tier`, `done` and `flights`. `sandbox` means `mode !== 'career'`: spending, earning and unlocks are no-ops there. `onFlag` marks missions done in both modes, but pays only in career. `buyTier` uses `TIERS` (`parts.js:815`). A launch costs `designCost` of the kept parts, and revert refunds it.

### 6. Invariants and gotchas

- **Old designs must fly exactly as before.**
  - Pairs at their catalogue spread (`legacyTwin`) count as on the centreline for COM (`partZc`), heating (the twin "across" rule) and `across`.
  - The inertia inverse reduces exactly to the 2D case for symmetric craft.
  - `designRows` writes `z` only when it differs from the default.
  - The rocket drag branch is marked "keep as is".
  - Restored pre-3D saves use `rot`/`w`.
  - Any change to mass, hull or heat must leave stock templates unchanged.
  - PR #36's physics fields (`fill`, `vec2d`/`gimbalZ`, `vecs`) do nothing for a part without them: `fill || 1`, `gimbalZ` 0 and an empty `vecs` give exactly the old arithmetic, and every baseline but the jets' own stayed byte-identical.
- **Keep in sync with parts.js and the renderers.**
  - `ROUND3D` must list the round shapes.
  - `PILOT`/`DRIVE` frames assume `VEHICLE_KINDS.launchRot`. If you add a kind, add both.
  - Physics writes per-part fields that render3d/parts3d/world.js read: `firing`, `ab`, `rpm`, `spin`, `deflect` (also a flat nozzle's swing), `aileron`, `sweep`, `retracted`, `temp`, `deployed` (combat also writes it for bay doors), `used`, `stress`. It also writes vessel fields: `steer`, `brakeOut`, `heatFlux`, `maxHeat`, `aoa`, `nz`, `strain`, `overspeed`, `overWarn`, `overMach`, and `cmd`, which parts3d reads to swing the Russian vectoring nozzles.
  - A new JS file needs a `<script>` tag in `index.html`, a `sw.js` `SHELL` entry (and a `CACHE` bump) and a README layout line; build-single inlines it by itself. A new Earth asset: see §5.9 #3.
- **Shared mutable return values.**
  - In terrain.js: `Terrain.toGeo` (`GEO`), `Terrain.water` (`EW`), `Terrain.dark()`, `lineQuery` (`LQ`), `fieldAt` (`FQ`).
  - In space.js: `bodyPos`/`bodyVel` caches.
  - In vessel.js: `v.surfaceSpot()` (`_loc`) and the module temporaries `_t1.._t4`.
  - Copy these values before making another call. Read terrain side results only right after a call of your own (§2, physics API): the `earthRaw` memo depends on it.
- **Caches keyed on part state.** `Vessel.partGeo` keys on each part's `def`, `x`, `y`, `z` and `rot`, and `Flight.groundAlt` on the craft's pose, `com`, `hull`, `wheelPts`, `gearUp` and body. Code that changes something else these depend on, in place, must also change one of the keys (or clear `_geo` / `_gAlt`).
- **Frame-rate independence.** The frame cap (`Settings.fps`, §5.2) only skips frames, and `Flight.update` gets the real time since the last one, so anything done per frame must scale with `dt`. Countermeasure sparks are an example: `cmFX` makes 54 a second at any frame rate (chapter 4 §1.6), where they used to be about one per rendered frame.
- **Body and frame conventions.**
  - East is decreasing `a`. Game north is −z.
  - `surfaceFrame().north` is +z, i.e. game south.
  - Bodies move only in XY, so SOI changes never touch `z`/`vz`.
- **`EARTH.terrainMax` changes** from 352 to 1700 when the map loads. That affects the broad-phase ground check and the prediction's impact check. `cfgOf` caches must be cleared when terrain inputs change (`setEarthData` does this).
- **Numerical stability**: `qnorm` every step, `MAX_SPIN`, the `Ixx..≥1` floor and Schur `s ≥ 1e-3`, `e` clamped away from 1, the degenerate-orbit path, bisection for events, 4-iteration contacts plus a 0.9 push-out, rest sleeping, a finite control-surface slew, stress hysteresis, and `dt` caps of 0.1 / 0.05 / 1/120 s.
- **The `sim` contract**: `physicsStep(dt, sim)` needs `toast`, `breakParts`, `ripParts`, `fireSeparator`, `deployChute`, `target`, `time` and `vessels`. Globals `Silly` and (optionally) `Combat` must exist, guarded by `hasCombat()`.
- **Other Vessel users**: AI fighters are Vessels too (`combat.js:994`, `v.ai`, `sas 'off'`). Multiplayer ghosts (`v.remote`) are never stepped; they only coast. Multiplayer forces warp to 0.
- **Ordering**: set `kind` before `rebuildGroups`. Call `rebuildGroups` after any change to `parts` or `adj`. Never call `recompute(true)` on a placed craft; it would lose the "parts fixed in space" shift.

## 3. Rendering

The flight view is 3D (three.js r159, lazy-loaded). The 2D canvas renderer in `world.js` is only a fallback for devices without WebGL, or when the `retro2d` Silly toggle is on. The hangar defaults to a 2D blueprint and has an optional 3D building view. The map has two modes: a 3D globe (WebGL, with a 2D overlay) and a 2D solar-system map. All of this is plain globals and IIFE modules with no imports. `parts3d.js` loads *before* three.js, so it must not touch `THREE` until `init()` runs.

### 0. Who draws what

| Global | File | Role | Entry points |
|---|---|---|---|
| `Render3D` | render3d.js:7 | three.js renderer, flight scene, hangar studio, globe | `load()` 3296, `renderFlight` 2398, `renderBuilder` 2904, `renderGlobe` 3240, `project` 3320, `pickPart` 3332, `designPoint` 3376, `surfaceHit` 3393 |
| `Parts3D` | parts3d.js:6 | Part → mesh: models, materials, plumes, chutes, pylons | `VesselMesh` 1684, `ghost` 1672, `place` 1657, `tint` 1665, `wingAt` 463 |
| `Settings`, `FX`, `World` | world.js:5/32/277 | Settings, particles, 2D fallback flight view, 3D markers overlay | `World.render` 317, `World.drawOverlay3D` 821 |
| `GlobeView` | globe.js:7 | Globe map state and its 2D overlay | `open` 18, `render` 90 |
| `MapView`, `PATCH_COLORS` | map.js:4/6 | 2D solar-system map (also the home screen backdrop, main.js:258) | `render` 133, `drawSystem` 83 |

- **Frame dispatch** (main.js:52-116). Since PR #35 a frame draws only what can have changed (§5.2 has the rules: the frame cap, stale views, 30 and 10 fps backdrops):
  - Hangar with 3D on: `Render3D.renderBuilder(Builder, dt, force)`, which itself draws nothing when nothing in the view moves (§2).
  - Flight in 3D: `Flight.updateCamera()`, then `Render3D.renderFlight(Flight, dt, calm)`, then the 2D overlays on the `#view` canvas (`World.drawOverlay3D`, `Combat.drawHUD`, `MPUI.drawHUD`). Paused or under a dialog (`calm`), this runs 10 times a second.
  - Globe map: `GlobeView.render`.
  - Otherwise: `Flight.render` → `World.render` or `MapView.render`.
  - `App.clear2D()` (main.js:141) clears the overlay canvas only when something was drawn on it (`App.ink`).
- **Canvas stacking:** `#view3d` (WebGL) sits under `#view` (2D) (index.html:21-22).
- **`App.use3D()`** (main.js:146) returns false if WebGL is unsupported, three.js failed to load, or the context was lost (`webglcontextlost` sets `api.failed`, render3d.js:482).
- **three.js loading:** `load()` injects `js/vendor/three.min.js` unless `window.THREE` already exists. The single-file build inlines it (tools/build-single.mjs:15).

---

### 1. render3d.js

#### 1.1 Setup (`init`, 464)
- **Renderer:** `antialias`, **`logarithmicDepthBuffer: true`**, ACES filmic tone mapping, sRGB output, PCF soft shadows, `autoClear = false`, and `localClippingEnabled = true` (480) for the planets' clipping planes (§1.14).
- **Cameras:**
  - `camera`: flight. FOV 50 (`FOV`, 8), near 0.05, far 5e12.
  - `bcam`: hangar.
  - `GL.cam`: globe.
- **Scenes:**
  - `spaceScene` > `spaceWorld`: the far layer.
  - `localScene` > `localWorld`: the near layer, with `FogExp2`.
  - `studio`: the hangar.
  - `GL.scene`: the globe.
- **Init order:** `initEnv`, `initSky`, `initBodies`, `initLocal`, `initTerrain`, `initSpaceCentre`, `initParticles`, `initStudio`, then `Parts3D.init(THREE, renderer)` with `Parts3D.envMap = api.envMap` (500).
- **Shared object store:** scene objects live in the closure object `S` (460). The temporaries `V1 V2 Q1 M1 M2 RAY NDC FRU PV SPH` (483-484) are reused everywhere, so never hold onto them across calls. Since PR #35 the per-frame paths allocate almost nothing: the env-map colours (`S.envS/envG/envH`, 510), the camera temporaries `CAM_A`/`CAM_B`, the vessel sync options (`SYNC_Q`, 2771), the hangar's tints and layout, and a hazy world's fog colour (`fogOf`) are kept and reused.
- **Image-based lighting (IBL):**
  - `initEnv` (505) renders a 64-px cube of a gradient sky with a `CubeCamera`. It serves as `localScene.environment` / `studio.environment` and as `envMap` for part materials.
  - `updateEnv` (521) re-renders it only when a colour/sun key changes, at most every 0.4 s (the key string is built only once that time is up). The hangar passes the key `'studio'`.

#### 1.2 Coordinate frames and the floating origin
- **Sim frame:** planets orbit in the sim XY plane, and z is depth out of that plane. Craft positions are body-relative (`v.x, v.y, v.z`). `bodyPos(b, t)` (space.js:159) gives a body's absolute position.
- **Floating origin = the focus `F.camAbs`.** This is the viewed craft (`F.viewVessel`, or the wreck), not the camera.
  - Every object is placed at `abs − camAbs`, in **sim axes**, inside `spaceWorld` or `localWorld`.
  - Both groups carry `F.viewQ` (render3d.js:2409), the sim→view rotation from `Flight.viewFrame` (flight.js:186). It makes local up = +Y, x = east, z = north at the focus.
  - Always do the subtraction in JS doubles before assigning, never in Float32.
- **Camera placement:** the camera orbits the origin at `dist = (H/2)/F.scale/TANH` (2416), so the 2D zoom `F.scale` (px/m) sets the 3D distance. `toView`/`toSim` (2377-2378) convert between frames.
- **Surface "a0 frames"** (used by terrain patches, scenery sets and the cloud frame):
  - Content is built around the point at angle `a0` on the body's equator.
  - Local coordinates: x = `−r·cosφ·sin(a−a0)` (east), y = `r·cosφ·cos(a−a0) − R` (up), z = `r·sinφ` (φ = z/R).
  - `placeFrame(obj, b, a0, t)` (2677) positions the frame and sets `rotation.z = a0 − π/2`.
  - Surface positions are `(a, z)` = sim angle and along-surface depth, from `Terrain.locate` via `focusSpot` (2616).
  - East is *decreasing* angle: `siteAngle(b, east) = padAngle − east/R` (space.js:101).
  - `latK(z, R)` (2617) is the metres-per-radian shrink away from the equator.
- **Space-centre frame:** `surf(e, h, z)` (1464) maps metres east along the curved ground, height and depth into the `S.sc` group at the pad. `updateSpaceCentre` (2748) places that group.
- **Airfield and carrier frames:** u runs along `yaw` and v to the right; `siteE/siteZ` (1814). `siteMatrix` (1817) stands an object on curved ground at any (e, z); `placeSite` (1826) applies it.
- **Part space:** x and y are the 2D blueprint axes, and z runs across the blueprint (+z faces the 2D viewer; +z is the right wing on planes).
  - Flight: `VesselMesh.group` is offset by `−v.com`, and the root takes `v.q` (2795-2796).
  - Hangar: `S.design` is part space, turned about z by `VEHICLE_KINDS[kind].launchRot` and lifted onto the floor.

#### 1.3 Draw order per flight frame
`renderFlight(F, dt, calm)` (2398) runs these steps in order:
1. `applyQuality`, then `adaptResolution`, but not on a `calm` frame (2404: paused or under a dialog, drawn 10 times a second, or one that carries several frames' time), which would read as a slow one.
2. Copy `camAbs` and `viewQ`.
3. `followCam` and the orbit camera.
4. `updatePatch`.
5. Clamp the camera above `groundAt` / `shipTop`.
6. Sky uniforms and stars.
7. `updateBodies`: it also works out what the ground hides of our planet (`S.cut`, §1.14) and returns what else of the far layer is in view, from which the haze dome's range is set or the dome hidden (2467-2470, §1.4).
8. Local lights, fog and in-cloud murk.
9. `updateEnv`.
10. `updateSpaceCentre`, `updateScenery`, `updateClouds`.
11. `syncVessels` (engine light and sheath), `vaporCone`, `updateParticles`, `syncCombat`.
12. Fit the shadow camera to the active craft (`half = max(25, ext·2.5)`).
13. `runJobs(4 | 2.5 ms)` (2521).
14. Render `spaceScene`, then `clearDepth()`, then render `localScene`. While the Sun's intensity is 0 (the night side, an eclipse) `renderer.shadowMap.autoUpdate` is false for that pass, so the last shadow map stays instead of being drawn for nothing; it is switched back on afterwards for the hangar's own key light (2527-2529).

`api.skipDraw` runs every step except the draw calls (for tests).

`renderOrder` values:
- Far layer: sky −10, Milky Way band −9.5, stars −9, cloud deck 1, atmosphere 2, haze dome 50.
- Near layer: ocean/inland water 1, cumulus 3, vapour cone 4, smoke 5, fire 6, tracers 7.
- Hangar CoM/CoL markers: 20/21.

#### 1.4 Sky, Sun, stars, lights
- **Sky dome** (`initSky` 531, `SKY_FS` 251): radius 1000, follows the camera, `depthTest: false`.
  - Zenith/horizon mix, with a horizon dip `uDip` that grows with altitude.
  - Sunset tint by azimuth, glare lobes around the Sun.
- **`S.haze`:** the same shader as a translucent dome (renderOrder 50) that veils planets while you are inside an atmosphere. Since PR #35 it is drawn only where it can change the picture (2465-2470). `updateBodies` returns 2 when stars are out or anything of the far layer besides our own planet is in view (a body, the Sun's glow, an atmosphere, a cloud deck or a dot, with an 8 px margin): the whole dome minus the ground cut. It returns 1 when only our planet is: the band between the ground cut and the horizon. Otherwise the dome is hidden, since over plain sky it drew the sky's own colour.
- **Ground cut on the sky:** `SKY_FS` (251) and `BAND_FS` take `uNadir` and `uKeep` (sky, haze) or `uCut` (band) and discard the directions the terrain patch is sure to cover (259, 286; §1.14).
- **Sky colours:** `envAt` (2352) and `skyColors` (2370) duplicate the 2D `World.environment` (world.js:292) and its sky mix.
- **Stars:** 3000 points at 1e5 m (a third of them in a band), plus the `BAND_FS` sphere. Alpha = `1 − lum(zenith)·3.2`.
- **Sun:** `SUN_FS` with limb darkening on a procedural `sunTexture` (643), plus an additive glow sprite.
- **Lights:**
  - The far layer has `S.sunS` and `S.ambS`.
  - The near layer has `S.sun` (casts shadows when `Settings.high`), `S.hemi`, and `S.engine`, a point light at the active craft's weighted exhaust (`engineGlow` 2805). Since PR #36 each `VesselMesh.exhaust` entry carries `aft` (`def.glowAft`, default 2 m) and `glow` (`def.glowK`, default 1): the light sits `aft` metres behind the nozzles (weighted, 2811) and its intensity is `1400·min(Σglow·k, 4)` (2813). Every look-alike engine has 7 m and 0.2, because their fins and tailplanes crowd round the nozzles and glowed gold or white-hot at 2 m; every older engine keeps 2 m and full strength, so old pictures are byte-identical.
  - The sun direction leans out of the ecliptic by `TILT = 0.26` (11).

#### 1.5 Planets (far layer, `initBodies` 579)
- **Geometry:** one shared `sphereGeo(160, 80)` (144) with **z as the pole**. Each body has its own `MeshStandardMaterial`.
- **Textures** are generator jobs, time-sliced by `runJobs` (761):
  - `bodyJob` (660) paints colour and normal maps (plus a roughness map for oceans and a night-lights emissive map on mapped Earth) from the **same terrain field and `paint()` function** as the near terrain.
  - Sizes: 2048 for mapped Earth, 1024 when R ≥ 50 km, else 512. All are halved on low quality.
  - **The queue** (`jobs`, 578; PR #35). Only Earth's map and cloud jobs are queued at `initBodies` (605, 629). Another body's job joins the queue when it is drawn bigger than a dot (over 2 px radius, `updateBodies`, 2558), when the queue runs idle (`runJobs` then takes the next unpainted world, one at a time, 762), or when the map shows it (`renderGlobe` puts it at the front and runs the queue itself, 3246-3247, because the flight view, which usually runs it, isn't drawn while the map is open). So every world is still painted within the first seconds of a flight, Earth first; the total work is the same as before, only the order changed (Mercury and Venus used to go first).
  - Earth waits until `Terrain.earthMap.state !== 'loading'`: its job yields `WAIT` (661) and goes to the back of the queue. (Before, it spun out the whole slice, and `finishJob` on it would loop for ever.)
  - `finishJob` (770) runs a job to the end whether it is queued or not (unless it has to wait). `updateBodies` calls it once a planet covers more than 40 px (2564). That is how Earth's map is still painted in one go on the first flight frame (a known loose end, chapter 7).
  - The night-lights emissive is masked to the dark side through an `onBeforeCompile` hook (729).
- **Atmosphere shell:** `ATM_FS`, additive, radius `R + 1.6·atmoHeight`.
- **Cloud deck** (`e.deck`):
  - Earth: an fbm texture from `cloudJob` (740) at 5 km altitude. It fades in only above 8-14 km camera altitude, where cumulus puffs stop.
  - Hazy worlds: the planet map at 0.75·atmoHeight.
- **Re-parenting:** deck and atmosphere move into `localWorld` while their body is current and the patch is active (2584-2590), so they depth-sort with the terrain.
- **Distant bodies:** below about 2 px a body becomes a dot (`S.dots`, `GLOW_FS`), and below 0.6 px its mesh is hidden.

#### 1.6 Terrain streaming
- **Double buffering:** two patch slots, `patch` (on show) and `patchB` (being built) (806-807). Each slot has three meshes:
  - `mesh`: ground, vertex colours plus a 12 m detail map and normal map, and an `aNight` attribute for city glow.
  - `ocean`: the sea-level sphere, RGBA vertex colours with foam.
  - `inland`: lakes and rivers at their own level, mapped Earth only.
- **Grid** (`allocSlot` 897): (2n+1)×(2m+1) vertices, n,m = 96,56 on high and 64,36 on low. Spacing is `sign(u)|u|^2.2·span` (`PW`, 9): dense under the craft, coarse at the horizon.
- **`patchJob(patch, b, a0, z0, span, camAlt)`** (949) is a generator that yields every row (`camAlt`, the camera's height, sets how far out the sea is culled, §1.7):
  - Samples continents every 4th vertex (every vertex on mapped Earth) and interpolates.
  - Heights come from `Terrain.height`, the same function the physics uses.
  - Colours come from `paint(tex=false)` (59). On top of that it paints farmland, urban blocks/streets, roads, river banks, far water and airfield grass.
  - Noise octaves fade to their mean once cells outgrow them (anti-aliasing).
  - UVs are offset by `a0, z0 mod TILE` so the detail texture does not swim when the patch is rebuilt.
  - Custom bounding spheres are centred on the middle vertex (1066), which fixes culling at high latitude.
  - At the end it records how far below sea level the patch's ground goes, `minH`, and how far its coarse outer cells sag below the curved surface between their corners, `sag` (1128-1131), for `groundCut` (§1.14).
- **`updatePatch`** (2618) decides when to rebuild:
  - `span ≈ horizon + sqrt(2R·hmax) + 1.5·dist`.
  - *Stale* (moved > 1.2 % of span, or span off by ×1.6): start a background `patchJob` with a budget of 3-4 ms, plus up to 16 ms more as the craft nears the edge.
  - *Lost* (other body, moved > 25 %, or span off by ×3): `buildPatchNow` (1168) runs synchronously, at most every 0.12 s; otherwise the patch is hidden.
  - When the job finishes, `swapPatch` (1161) swaps the slots and marks scenery dirty.
- **`meshHeight(b, a, z)`** (1180) bilinearly samples the *rendered* patch (null outside it). `groundAt` (1188) falls back to `h3dAt`. The camera clamp and all scenery seating use these.
- **`fieldGround`** (1151) keeps rendered ground under airfield paving.

#### 1.7 Water
- **Ocean:** `terr.oceanMat` (823): transparent, roughness 0.08, a ripple `normalMap`, `envMapIntensity` 1.2. The colour runs shallow→deep by depth and goes deep for far cells. Surf foam comes from `depth/tan(slope)`.
- **Inland water:** `inland` vertices sit at `Terrain.water.level` where there is water. Elsewhere they are tucked 6 m under the ground with alpha 0. Rivers only appear on fine cells (< 160 m).
- **Water seen from space:** ocean shine comes from the planet roughness map.
- **`cullWater(patch, g)`** (1135; PR #35). The sea sheet runs under the whole patch, and lake and river water sits tucked under the ground where there is none; both used to draw with the terrain's own index. Now each water sheet gets its own copy of the index (`mk(cols, ix)`, 914), cut down at each patch build to the triangles with a corner in sight, in the same order, with `setDrawRange` and an update range:
  - **Sea** (1089-1097): a vertex is hidden (`patch.hide`, 904) when it stands at least `max(1.5 m, distance/200)` above sea level and lies within half the horizon in both grid directions. A triangle is left out when all three corners are hidden. (The margin grows with distance because with the log depth buffer and MSAA an edge sample's depth is worked out at the pixel's centre, so near-level surfaces far off can swap.)
  - **Lakes and rivers** (1112): a vertex tucked under the ground is hidden.
  - Triangles under the ground never passed the depth test, so the picture is the same. Checked byte for byte on 76 views: the only differences it made were a few edge pixels along far hills at 1280×800, specks of sea that used to show through the land.
- **Note:** the ocean and inland geometries have no `uv` attribute (`mk()`, 914), so the ripple normal map does nothing in exact arithmetic (the tangent frame is zero). It was kept anyway: dropping it turns `normalize(N·k)` into `N` in float, which moved up to 116 pixels by 1/255 on sea views. Add UVs before tuning ripples.

#### 1.8 Scenery (`sceneryJob` 1218; two sets in `S.scen`, swapped by `swapScenery` 1394)
- **What it places:**
  - **Trees:** near and far LOD `InstancedMesh`es (far = one low-poly crown beyond 380/260 m). Placement follows the green of the Blue Marble on Earth (`vegOf`/`bioAt`) and skips track, airfields (`keepClear` 1865), treeless isles, and roads/rivers/lakes/towns (`offFeature`).
  - **Real cities:** from `Terrain.citiesNear`, on a 30 m plot grid visited nearest-first (`spiral` 1207). Towers appear only downtown in cities over 600 k people.
  - **Villages:** hashed 1.4 km cells.
  - **Boats.**
  - **Rocks:** on rocky bodies.
  - **City lights:** `Points` with `GLOW_FS`.
- **Seating:** everything sits on `meshHeight`.
- **Capacities:** 7000 per tree mesh / walls / roofs / lights, rocks 5000, boats 200. The loops stop silently at their caps.
- **`updateScenery`** (2685): shown only near the ground, when `dist < 9 km`. The radius is `clamp(3·dist + 600, 800, 2400)`.
  - Background rebuild budget: 2-3 ms, plus up to 30 ms.
  - Synchronous rebuild on another body or when moved > 80 % of the radius (at most every 0.3 s).
- Farmland, roads and urban grey are terrain vertex colours, not geometry.

#### 1.9 Clouds (lit cumulus)
- **Layout:** `cumulusJob` (1410) uses a hashed 750 m grid out to 15 km (9 km on low). Bases are 1.4-3.6 km up, with fewer and bigger puffs far off.
  - **The grid row through the flight plane (q = 0) uses `hash1(i, s)`, the same seeds as the 2D `World.drawClouds`.**
  - The layout also produces flythrough ellipsoids (`vols`).
- **Puffs:** one `InstancedMesh` of camera-facing quads (`CLOUD_MAX` 6000), using `CLOUD_VS/FS` (315/332) and a 2×2 atlas (`cloudAtlas` 349) whose RGB is a baked normal and whose alpha is density. They are lit by the Sun, with darker bases, forward scattering and fog.
- **Sorting:** `sortPuffs` (1441) re-sorts far-to-near at most every 0.2 s, and only once the camera has moved a metre among the clouds since the last sort (`sortP`, 2732). A new cloud list has no `sortP` (1437), so it is always sorted. Parked, paused or hovering, it doesn't run.
- **`updateClouds`** (2709): Earth only, camera altitude < 12 km.
  - Rebuild synchronously beyond 6 km of movement, in the background beyond 1.5 km.
  - Drift is `F.time·2e-6` rad, matching the 2D clouds and the deck.
  - Inside a volume, `S.clouds.inside` thickens the fog to white murk.

#### 1.10 Space centre, landmarks, airfields, carriers
- **`initSpaceCentre`** (1468) builds the pad, lattice tower, VAB and mission control (facade canvases with emissive window maps in `S.nightMats`), dish, water tower, flag, slabs, helipad, runway and causeway strips (`strip`, which follows the curved ground), and the hangar and tower.
  - Glow points (`glowPts`, `S.glowU`) and blinking beacons (`S.blinkU`).
  - Building positions mirror `World.drawSpaceCenter` (world.js:584).
- **`initLandmarks`** (1701) is deferred until the Earth map loads; `S.scKit` is cleared first, so it runs once even if it throws. It builds:
  - `initAirfields` (1911): runway numbered by real bearing, apron side chosen by `fieldLayout` (1892, cached in a WeakMap), hangars, ops, tower, tanks, parked jets (`addJet` 2017), windsock, lights.
  - `initCarriers` (2039): `carrierGeo` (2078) is cached per size: lofted hull, a 2048×512 painted deck, island, turning radar (`S.radars`), numbers.
  - Lighthouse with a night beam, wind turbines (`S.rotors`), tank farm, pier and boat, and the Shetland port town.
- **Data sources:** `EARTH.airfields` and `EARTH.carriers` (space.js:88/94).
- **`depthBias(mat, k)`** (1854) pulls paving towards the camera in the vertex shader, because the log depth buffer ignores `polygonOffset`.
- **`shipTop`** (1872) keeps the camera out of the carriers.

#### 1.11 Vessels, plasma, vapour cone, particles, combat
- **`syncVessels`** (2772): a `Map` from Vessel to `{vm: Parts3D.VesselMesh, root}`.
  - Rockets get `radial: true`.
  - Hidden when farther than 50 km *and* under 1 px.
  - **Disposed the first frame a vessel is not iterated** (dead, or no parts).
- **`sheath`** (2838): reentry plasma when `heatFlux > 3e7`. This duplicates the 2D sheath in `World.drawVessel`.
- **`vaporCone`** (2818): a lathe bell along the velocity vector. It grows with `effectMach` from 0.85 to 1, flashes as the craft crosses Mach 1, and fades out by Mach 1.2. It is scaled by air density/0.5, and `S.vaporK` eases (rising rate 9, falling rate 3).
- **Particles** (`initParticles` 2253, `updateParticles` 2278): `FX.list` from world.js drawn as two instanced quad meshes of 1100 each, smoke (normal blending, fogged) and fire (additive).
  - `'ring'` uses the shader's ring mode.
  - `'fire'` turns to smoke after 45 % of its life.
  - `'glint'` (chaff foil, PR #35) is additive, its alpha × `FX.twinkle(p)` × the night dim (2292), as `FX.draw` does in 2D.
  - A random depth jitter `p.jz` is added lazily.
- **Combat** (`syncCombat` 3112): tracer `LineSegments` plus head points (700), pooled missile/rocket/bomb models, and target models within 30 km (they become wrecks when destroyed). A shot with `big` (the frigate's radar SAM) gets its model at 1.5× (3137).

#### 1.12 Cameras
- **Flight follow camera:** `fc` (2346).
  - Default offsets by kind come from `CAM0` (2381): beside rockets (looking along part +z, so the side the blueprint faces), behind planes, cars and helis.
  - `followCam` (2382) eases the heading at a rate of 2.2/s.
- **Hangar turntable:** `bc`.
- **Shared controls:** `orbitBy` (3349) clamps pitch to −1.25..1.45. `resetCamera` (3356) returns the short way round. Spectating is just `F.viewVessel`.
- There is no cockpit or free camera.

#### 1.13 Quality and adaptive resolution
- **`adaptResolution`** (3030): when the frame-time EMA exceeds 1/42 s, the pixel ratio scale drops by 0.08, down to 0.55. Below 1/57 s it rises by 0.04. It changes at most every 0.6 s. The base ratio is `min(DPR, 1.75)` on high and 1 on low. `calm` frames (paused, under a dialog, or carrying several frames' time) don't feed it.
- **`applyQuality`** (3040) reacts to a `Settings.high` flip: shadows, a fresh `allocPatch`, invalidated scenery and clouds, and a resize.

What `Settings.high` (world.js:10) changes:

| Feature | High | Low |
|---|---|---|
| Patch grid | 193×113 | 129×73 |
| Planet texture divisor | ×1 | ×½ |
| Sun / studio shadows | on | off |
| Tree cell / max / near radius | 22 m / 7000 / 380 m | 34 m / 2400 / 260 m |
| City / village buildings | 5200 / 1600 | 1800 / 600 |
| Cumulus range, puffs per near cloud | 15 km, 14 | 9 km, 8 |
| `FX.max` particles | 900 | 350 |
| Plume shock diamonds | yes | no |

`Render3D.info()` (3283) returns draw stats plus `t`, the rebuild costs from `note`/`timed` (939-946, 3066).

#### 1.14 What the ground hides: groundCut (PR #35)
Low over the ground most of the screen is terrain, yet the planet's sphere, the sky dome, the haze dome and the Milky Way band were all shaded under it. Now none of them is drawn where the terrain patch is sure to cover it:
- **`groundCut(b, x, y, z, r, m)`** (2655), called by `updateBodies` for the planet we're at (2548), result in `S.cut`. A ray from the camera within `bc` of straight down gets deeper than the patch's ground goes anywhere (its lowest point `minH`, plus the `sag` of its coarse outer cells, plus 5 m) while it is still over the patch, so it must meet that ground. That holds only if the patch reaches 1.2 times as far as such a ray can go before it gets that deep, which `patchCovers` (2666) checks on 16 bearings. It returns the cosines of `bc` (`cosC`), of the horizon angle (`cosH`) and of where the ray at `bc` meets sea level (`cosTh`), or null (not low enough, or no patch to trust). `m` is a margin of 3 px.
- **Planet sphere:** each planet material carries a clipping plane (`e.clip`, 601), set to clip nothing when not in use; under the cut it clips the cap the ground hides.
- **Sky, haze and band:** `uNadir` and `uKeep` (sky and haze) or `uCut` (band) make the shaders discard the directions inside the cut (§1.4).
- **Why not simply hide the sphere** once the patch reaches 1.2× the horizon: over deep sea a band just under the horizon is still drawn, because rays there skim the water without reaching the seabed, and the sea is 94 % opaque. The simple rule changed that band by up to 2/411 at sea.
- With `cullWater` (§1.7) and the haze rule (§1.4) this removes about 2 to 4.8 screens' worth of fragment shading a frame (a screen: every pixel shaded once) below 10 km (for example 4.13 → 0.47 on the runway, 4.01 → 1.13 at sea at 150 m), and 18-24 % of the triangles; the draw calls stay the same. The 76 views checked byte for byte were identical apart from the edge pixels noted in §1.7 and two planets drawn 1-2 px across, which now keep their flat colour while their maps wait in the queue (§1.5).

---

### 2. Hangar 3D building view (render3d.js:2852-3024, API 3362-3418)
- **`renderBuilder(B, dt, force)`** (2904) uses the `studio` scene (gradient background, fog, 5 m-grid floor, hemisphere/key/rim lights). It returns true if it drew (PR #35).
  - **It draws only while something moves** (2908): without `force`, a fresh switch to the hangar view, or any of `bv.moving` (the camera, the view offset or the craft's layout still easing, 2978), `bc.auto` (the turntable spinning), `bv.edit`, `B.drag` or `bd.anim` (a rotodome, 2925), it returns false before any GL call and the canvas keeps the last picture. `bv.drawn` (set at 2997) is cleared by `resize` (3052) and by `setVisible` turning the view on (3312). `App.frame` passes `force` when the picture is stale or the player did something in the last second (main.js:76).
  - **The `VesselMesh` is rebuilt only when its key changes:** kind, and per part `id,type,flip,skin` (`bd.key`, 2914-2925). It also rebuilds when the parts array itself is replaced (undo, redo, load: `bd.parts === parts` fails). Moving, depth changes and turns are cheap, because `place()` runs every `sync`. (Before PR #35 the key was a string, `snap`, built every frame.)
  - Parts not attached to the control part get `setOpacity(p, 0.4)`.
- **Tints** (2938-2949; colours `TINT_*`, 2862) go into the material's emissive channel:

  | State | Colour, k |
  |---|---|
  | Hover | amber, 0.18 |
  | Selection | amber, 0.42 |
  | **Host glow** (`B.drag.host`, the part a drag will attach to) | cyan [0.3, 0.85, 1], 0.3 |
  | Invalid drop (incl. mirror and group) | red, 1.1 |

- **Ghosts:** `syncGhosts` (2883) takes `B.ghosts()`, asked for only while a drag is on (2950), and builds `Parts3D.ghost(p, radial)` rigs: 60 % opacity, no shadows, plus the radial twin.
  - A ghost is rebuilt only when `type,rot,flip,radial,skin` changes; otherwise it is moved with `Parts3D.place`.
  - Tinted blue when `ok`, red otherwise.
- **`builderLayout(B, out)`** (2863) applies `launchRot`, lifts the lowest point to the floor, and computes size and centre into a reused object (`LAYOUT`, 2861). These are eased, then **frozen during a drag** (`editView(true)`, 3404, keeps a copy).
- **Camera:**
  - Auto-spins at 0.25 rad/s until grabbed.
  - In edit mode the yaw is clamped within ±0.8 rad of facing the blueprint.
  - Distance comes from `B.cam.scale` (default 26 px/m).
  - `setViewOffset` centres the craft in `B.viewArea()`.
  - `panBy` (3410) moves the target.
- **Markers:** `builderMarkers` (3002) draws CoM and, for planes, CoL at a fixed ~7 px, with `depthTest: false`.
- **Screen ↔ part-space helpers:**
  - `designToScreen(x, y, z)` (3364): part space → CSS px, or null if behind the camera.
  - `designPoint(cx, cy, z0)` (3376): ray onto the plane z = z0 (S.design only turns about z, so its z is world z) → `{x, y, z, mpp}`. Returns null when edge-on (`|dir.z| < 0.1`) or behind.
  - `surfaceHit(cx, cy, skip)` (3393): `vm.pickHit` → `{part, x, y, z, nx, ny, nz, mpp, side}`, in part space with the normal facing the ray. `side` is ±1 for the copy of a twin pair. Radial copies are ignored. builder.js:1919 feeds it to `Builder.attach` (721).
  - `pickPart` (3332): in the hangar, `vm.pick` (radial copies count). In flight it raycasts vessels, active craft first.

---

### 3. parts3d.js: part → mesh

**Pipeline.** `buildPart(p, builder, radial)` (1488) calls `model(def, flip, skin)` (1227).
- `model` picks a builder via `recipe(d)` (1220): the `d.body3d` override (since PR #36 the jets' parts use it: `'us5'`, `'ruLoft'` and `'ruFin'`), then `'box'` for side separators, then `RECIPE[d.shape]` (parts.js `PART_RECIPE`, which maps shapes `ruLoft` and `us4body` to their own recipes), then `'lathe'` for shapes in `LATHE`, then `'extrude'` as the default (`smokegen`, `flares` and `fin` end up here).
- `BUILD[recipe](d, flip, skin)` (627) returns a **node**: `{pieces: [[geometry, kind]], subs: [...], anim}`. `node()` (618) merges the pieces per material kind (`merge` 234).
- **The model is cached in `models`** under the key `type + '|f'? + '|s:skin'?`, where the skin is included only for `SKIN_GEO` recipes (wing, biplane).
- `instance()` (1460) turns the node into Meshes and Groups with **per-part materials** (`rig.mats[kind]`), so heat glow, tint and opacity stay per part.

**Shapes.**
- `outline()` records the 2D `partPath0` through a fake canvas, `recorder()`. It supports only moveTo, lineTo, bezier, quadratic, arc, ellipse, rect, roundRect (treated as rect), closePath, save/restore and transforms; any other call is a silent no-op.
- `PROFILE` overrides the silhouette for aircraft shapes, so a canopy drawn in 2D never gets revolved into the hull.
- Since PR #36 these live in parts.js, unchanged, because the builder's clash test reads them too (chapter 1 §4): `outline`, `recorder`, `span` and `PROFILE` are `partOutline` (parts.js:1060), `pathRecorder` (:966), `outlineSpan` (:1067) and `PART_PROFILE` (:1017), aliased at parts3d.js:105; `LATHE`, `RECIPE` and `FLAT_DEPTH` (54-66) are `LATHE_SHAPES`, `PART_RECIPE` and `PART_FLAT_DEPTH`.
- `latheGeo` (123) revolves the outline's horizontal extent per height, with creases (`CREASE` 0.45 rad), caps, holes (nozzles) and steps. It projects the 2D art from the front, inset slightly so the outline stroke does not smear round the sides.
- `extrudeGeo` (213) with `projUV` (200) handles flat parts. The depth is `d.depth || FLAT_DEPTH || min(w, 1)`.
- `d.facets` gives faceted stealth hulls.
- Wings: `wingGeo` (320) lofts NACA sections with `sweep` (282) and bakes vertex colours (body, darker leading edge, tip bands). It handles taper (default 0.45), sweep, dihedral, elliptical planform, winglets, and swing halves. `wingAt` (463) is its analytic twin (used by builder.js:574/581). PR #36 added, all opt-in:
  - `wing.plan` (328): `planGeo` (378) puts a station at each corner of the plan (`planAt`, 369), tip bands from 86 % of the half-span, tip to tip in one piece, or each half on its own when the plan leaves the middle open (tailerons beside the engines).
  - `wing.crank` (330): each panel is its own loft with its own ends, so the dog-tooth's step is a flat face (it was a twisted zero-width strip, shaded inside out, until play-testing); `crankAt` (480) gives the chord line's height, reach across and dihedral along the panels.
  - `wing.root` (339): the two halves are lofted apart, each starting `root` metres out (a tailplane that shows only outboard of the engines).
  - Camouflage: a wing in a camouflaged skin (or its own `look`) keeps white vertex colours with a darker leading edge, and `camoUV` (391) gives it UVs from the top view, in metres / 16, so the pattern comes from its material (`vcCamo`, below).
  - `wingAt` answers for plans (`s` 9 in an open middle, so nothing hangs there) and cranks alike; `oldStruts.holds` (1554) uses it for plan wings.
- **Lofted bodies** (PR #36), one builder per jet family, each lofting the same sections parts.js draws in 2D:
  - `us5LoftGeo(L, d)` (1039): quads between a loft's rings, faceted across (each face keeps its normal, so the chines stay crisp) and smooth along, or rounded both ways for a `smooth` loft. Body faces that look sideways (`|n.z| ≥ 0.45`) take the 2D art, projected from the side (`hull`); the others the paint, camouflage laid on in metres (`skin`); caps close the ends. `us5SkinUV` (1096) gives painted fittings (doors, nozzle sidewalls) metre UVs on the two axes each face lies along.
  - `loftGeo(lf, d, withUV)` (402): a ring of the section's superellipse (`ruPt`) at each sampled station, a flat face at each end of a run (so a step shows its ring), the upper and lower halves kept apart along a `chine`. UVs project the 2D art from the side, like `latheGeo`'s. `ruIntake` (432) lays a raked intake's dark mouth just outside the hull.
  - `loftTube(T, d, z0, H, I)` (508), per tube and copy: four arcs per section (a side, the top, the other side, the bottom), so the sides take the side art and the top and bottom the plan view from the right half of the part's texture (`paint`, below); a step gets a flat ring, the ends a cap, an open end or an intake mouth (a lip and a dark duct). `mesh0` (487) collects vertices and triangles, `tubeRowAt` (571) interpolates a section for the canopy bows.

**Recipes** (`BUILD`):

| Recipe | What it builds |
|---|---|
| `lathe` 686 | Revolved hulls plus extras: nozzle, nuclear fins, probe antennas/dish, glass cut (`glassnose`, `bubble`), canopies and helmets, intakes, airliner windows, float struts, jet intake/fan/nozzle |
| `gun` | Receiver and barrel, or a spinning multi-barrel |
| `store` | Pylon plus gun/rocket pod, or missiles/bombs/torpedoes as `store` sub-nodes |
| `chute` | Canister plus `lid` |
| `wing`, `biplane`, `vtail` | Airfoil lofts. A wing or biplane in camouflage uses material `vcCamo` instead of `vc` (810, 823). `vtail` (909) follows `def.vtail` (the outline `partPath0` draws) and leans out by its `cant` about the root (a pair's left one mirrored by `twinMirror`) |
| `us4body` 874 | The FS-4/16/15 bodies: every tube through `loftTube` into hull, glass and intake meshes; nozzles with petals, a dark throat (`nozzle`, it glows when lit) and 12 rods each; splitter plates and canopy bows (`us4frame`); pilots; a pitot probe |
| `us5` 990 | The FS-22/35 parts: each `us5Lofts` loft through `us5LoftGeo`, then the part's fittings from `US5_FIT[d.us5]` (1136): pilots, the FS-35's canopy bow and camera window, bays (`us5BellyBay` 1209: a cavity open below, `hinge` doors, `store` missiles in `bayRack` order; the FS-22's side bays swing a door out with the missile on its arm), the flat nozzle (fixed sidewalls, the flaps and exit on a `pivot`), the FS-35's sawtooth nozzle (`tile`), canted fins, the gun's fairing with a `hinge` door, the gear with its doors (`gearDoor`) |
| `ruLoft` 1001 | The MyG/Sugoi hulls and engines: each hull loft through `loftGeo` in its `mat` (default `hull`); a loft with `vec` goes on a `ruMove` sub-node (`move: 'vec'`) pivoting at its throat, with its exit; canopies in glass or gold glass and a pilot under the canopy's highest point; then `RU3D[d.ru]` (445): nozzle throats, intake mouths, the MyG-21's shock-cone ring and pitot boom, the IRST ball |
| `ruFin` 1020 | A Russian fin: an airfoil from the root chord on its inner edge to the tip chord on its outer edge, leaning out by its cant; an all-moving one (`ruFin.all`) turns on a `ruMove` sub-node (`move: 'rudder'`) about a hinge along its span |
| `prop`, `rotor`, `tailRotor` | Blades (`bladeGeo`) on `spin` subs plus a blur `disc` |
| `wheel`, `gear` | `wheelNode` cached by r and W; `wheelPair` adds a cosmetic second wheel at ±track |
| `leg`, `rcs`, `girder`, `airbrake`, `chassis`, `cab`, `rotodome`, `skid`, `ecm`, `turret`, `drone`, `box`, `extrude` | Dedicated models |

**Materials** (`makeMat` 1314, `KINDS` 13).
- Textured kinds (`map: true`: hull, metal, gold, shield, sep) take `textureFor(def, flip, skin, at)` (1284). That is a `CanvasTexture` of `drawPart` painted with `PartPaint.flat = true` (no fake shading), 64 px/m clamped to 16..512 (power of two), by `paint(d, flip, skin, at)` (1238). It is drawn 8× offset as an edge bleed. An `us4body`'s canvas is twice as wide (1240): the side art on the left, its plan view (`drawPartTop`) on the right (1251), which `loftTube` maps onto tops and bottoms.
- **The texture cache key is `type + '|f'? + '|s:' + cleanSkin`**, plus `'|@x,y'` for a camouflaged part (PR #36). Textures are never disposed, except the placed ones below.
- **Camouflage in 3D (PR #36).** A camouflaged part's pattern must run on from its neighbours', as it does in 2D:
  - `camoAt(p, S)` (1299) is where the pattern starts: the part's x, y to the quarter metre, modulo the 16 m tile; null without camouflage, or for a part turned a quarter (its pattern turns with it from its centre, as in 2D).
  - `textureFor` paints a placed texture with `PartPaint.camoAt` set to it, so the 2D pattern lands where the part really is. These go by place; past 64 of them the oldest is disposed and forgotten (`placed`, 1283; one still in use is simply uploaded again).
  - `camoTexture(S)` (1271) makes one repeating texture per skin from the 16 m tile, from `us5CamoTile` (two-tone) or `camoCanvas(S, 32)` (patterned), never disposed. `camoMap(S, at)` (1302) clones it per skin and `at[1]` with the offset moved along (`offset.y = at[1]/16`), for surfaces mapped in metres along the part.
  - `makeMat(kind, d, flip, skin, at)` (1314) takes the part as `at` (`instance` passes `rig.part`; `pylonMat` the pod). The `skin` kind (a us5 body panel or fitting) gets `camoMap` for a camouflage, else the paint's or a grey base colour; `vcCamo` (a camouflaged wing) gets `camoMap` times its white vertex colours. Before this, each part drew its pattern from its own centre, so it broke at every joint and didn't match 2D (an FS-4 tan in 2D was green in 3D).
- New kinds (PR #36; `KINDS` 13): `vcCamo` (20), `us4frame` (46; canopy bows and splitter plates, in `BODY_KINDS`, so it takes the paint), `skin` (49), `store` (50; missiles inside a bay, never painted), `tile` (51; a stealth nozzle's heat tiles) and `gearDoor` (52; gear takes no paint).
- `vc` = vertex colours. `disc` = shared blur texture (opacity animated; created invisible and drawn only while its opacity is above 0, 1315). `lamp`/`tail` = `MeshBasicMaterial`. `glass`/`goldglass` are transparent with `userData.glass`.
- `userData.c0` stores the base colour that heat glow returns to.

**Paint (skins) in 3D.** `cleanSkin` (parts.js:1515) drops skins on `NO_SKIN` shapes. `skinFor(id, d)` (93) is the skin, else a part's own `look` (PR #36), so an unpainted FS-22 part is in its camouflage.
- Textured kinds get the skin painted into their texture, and the skin's `rough`/`metal` (else hull finish, so a painted engine is no longer polished metal).
- `BODY_KINDS` (60), the solid body colours, become `S.base`.
- Wings and biplanes bake the skin into their geometry (model per skin); a camouflage instead comes from the `vcCamo` material, so any jet's wing can wear any camouflage. `skinTip` (94) mirrors the 2D `accent()`.
- Fittings, glass, tyres, nozzles, hazard stripes and helmets keep their own colours.
- Pylons use `pylonMat` (1604): the pod's skin, else the material the old pylons borrowed.

**Mirroring, twins and depth** (`place` 1657, which runs **every `sync`**, so part x/y/z/rot changes never need a rebuild):
- `p.flip` builds the left-hand model (`|f` cache key; legs, fins, gear and rcs use `s = flip ? −1 : 1`).
- `ZMIRROR` recipes (65: tailRotor, drone, prop, wheel, gear, and `us5` since PR #36; plus the `bubble` shape) on a single part at z < −0.01 get `root.scale.z = −1`. A prop on that side therefore turns the other way, as in the physics.
- `def.twinZ` gives two holder groups at `±partZ(p)` (`userData.side` ∓1). The root sits at z = 0, and each holder gets its own plume. With `def.twinMirror` (PR #36) the left holder gets `scale.z = −1` (1497), so a lopsided pair (canted fins, gear legs, the FS-4's intakes) is a true mirror pair; a mirrored all-moving fin turns back the same way (1779).
- Rocket legs and fins (`radial`) get `rig.twin`, rotated 90° about the stack. It is flagged `userData.radial` and is for show only (the physics adds the same copies).
- Pusher props turn π; `p.rot` turns in quarter steps.

**Pylons** (`pylonsFor` 1615; rebuilt when `VesselMesh.pylons` (1703) sees a layout signature change from x, y, rot, flip, z, att or skin):
- Parts get struts if they are a twin pod, `d.pod`, an ECM pod, or attached (`p.att`). Floats and skids are excluded (they carry their own struts).
- `attStruts` (1576) runs to the att host, else the nearest part's `partBoxes`. Against a wing it uses `wingStrut` (1593): no strut if the chord runs over the pod.
- `oldStruts` (1546) handles legacy twin pods without `att`.
- Geometries are per rig and disposed in `dropPylons`.

**Plumes and chutes.**
- `makePlume` (1418) uses a shared grid geometry shaped *in the vertex shader* (`PLUME_VS` 1338: a quadratic Bezier profile `uP0..uP2`, `frustumCulled = false`). It has outer and core layers, a glow sprite, and 4 shock diamonds (kero, solid or spike plumes, or an afterburner), all additive and not tone-mapped.
- Length, spread, the vacuum widening and the colour table `PLUMES` (67) **duplicate `World.drawFlame`** (world.js:752).
- **Several plumes per part** (PR #36): `makePlume(p, root, z)` puts the flame at the nozzle's `x` too (`nozzleOf(d).x`, an `us4body`'s first nozzle) and at `z`; `buildPart` makes one per holder and per entry of `body.noz[0].z` (1503), so the FS-15's and FS-4's twin nozzles each have a flame. `World.drawFlame` (world.js:753) puts the 2D flame at `e.x + nz.x` in the same way.
- **Plumes that follow a moving nozzle** (PR #36, per frame in `update`): a `vec2d` engine's flame swings with its `pivot` by `p.deflect` about the hinge (1805); a Russian vectoring nozzle's flame (the plume in the same holder as a `ruMove` `'vec'` sub-node) takes that sub-node's turn about its throat (1806-1807).
- `makeCanopy` (1447) builds a dome (scale.y 0.42) with gores and 12 lines, scaled by `p.deployed`.

**Animations** (`update` 1758). Sub-node roles from `instance()` (1473):

| Role / field | Driven by |
|---|---|
| `spin` (axis per sub), `spinRev` | `p.spin` if numeric, else `fspin += throttle·anim.rate·dt` (`anim.always`: rotodome; `anim.tail`: tail rotor follows the main rotor's `firing`) |
| `disc` opacity | Measured spin rate, `anim.disc = [lo, hi, max]`; `visible` only while the opacity is above 0 (1774), so a stopped prop or rotor draws no disc |
| `droop` | Rotor rate (blades lift as they speed up) |
| `pivot` | `rotation.z = p.deflect` (elevators, airbrake, and since PR #36 a flat nozzle's flaps) |
| `hinge` (PR #36) | A door: `rotation[axis] = open · clamp(p.deployed, 0, 1)` (1790), the axis and open angle from the sub-node (`userData.hinge`, 1475). The FS-22/35 bays and guns |
| `ruMove` (PR #36) | `move: 'rudder'`: an all-moving fin turns about its own span axis by `p.deflect` (mirrored copies the same way back). `move: 'vec'`: a Russian vectoring nozzle swings with the stick, `rotation = (−cmd.x·k, 0, −(cmd.z + 0.6·side·cmd.y)·k)` with `k = d.gimbal` (exits up for nose up, apart to roll; as far as the engine's gimbal, after the Sugoi-35's showed 2.6 times too far), from `VesselMesh.cmd` (1778-1781). Collected in `instance` (1476) |
| `swingP` / `swingN` | `p.sweep − swing[0]` |
| `yaw` / `pitch` | `p.aimYaw` / `p.aimEl` (turret) |
| `store` | Visible count from `p.ammo`, alternating sides |
| `lid`, canopy | `p.deployed`, `p.used` |
| Retractable wheels | `root.visible = !p.retracted` |
| Heat glow, `emissive` (1521) | `p.temp > 900` → orange-to-white emissive, paint chars; a firing nozzle glows |

**`VesselMesh` API** (1684): `new VesselMesh(parts, {builder, radial})`.
- Fields: `.group`, `.items` (part → rig), `.list`, `.pickables`, `.exhaust` (nozzle points used by `engineGlow`).
- `sync(v, {dt, time, rho, quality})` adds new parts, prunes vanished ones, rebuilds pylons and re-applies `envMap`. In the builder it is called with `{parts: B.parts}`. Since PR #36 it keeps `this.cmd = v.cmd || null` (1741), the vessel's control command (`v.cmd`, −1..1 per axis), for the Russian vectoring nozzles: none in the builder, and zero on a multiplayer ghost, which is never stepped and isn't sent the command (chapter 7).
- `.exhaust` entries are `{x, y, z, k, color, aft, glow}`; `aft` and `glow` come from `def.glowAft`/`glowK` (1830; §1.4).
- Other methods: `pickHit(raycaster, skip, radial)`, `pick`, `setTint`, `setOpacity`, `dispose()`.
- Builder mode creates no plumes or canopies.
- Module API (1888): `init`, `textureFor`, `wingAt`, `buildPart`, `VesselMesh`, `ghost`, `place`, `tint`, `freeGhost`.

---

### 4. world.js
- **`Settings`** (5) is persisted in `rss.settings`. `Settings.high` means `quality !== 'low'`. **`hash1`** (13) is shared with the 3D cumulus.
- **`FX`** (32) holds the particle list for both renderers.
  - Kinds: `smoke`, `spark`, `flash`, `ring`, `fire`, `plasma` (2D only; in 3D it takes the default branch), and `glint` (PR #35: chaff foil).
  - `glint`: additive in both renderers, its alpha × `FX.twinkle(p)` (43) = `0.15 + 0.85·sin⁴(p.tw + p.life·p.tf)` (each strip flashes as it turns in the light, by its own age, so the same at any frame rate) × the night dim. `FX.draw` (96) never culls it by size and draws it at least 0.8 px in radius (103, 125-132).
  - Body-relative `{b, x, y, z, vx...}`. `FX.update` (80) applies drag, plus gravity for `heavy` particles and sparks.
  - Emitters: `puff`, `sparks`, `explosion`, `splash`.
  - The list is capped at `FX.max()` by dropping the oldest particles.
- **3D markers:** `World.drawOverlay3D` (821) projects prograde/retrograde/target glyphs on a sphere around the craft with `Render3D.project` and `metresPerPixelAt`. `markersFor` (841) is shared with the 2D view.
- **Flames in 2D:** `drawFlame(ctx, e, k, rho)` (752) draws a firing engine's plume (`PLUMES` colours, length and spread as parts3d's). Since PR #36 it starts at `e.x + nozzleOf(d).x` (753), so an `us4body` nozzle off the part's centre line, like the FS-4's under its tail boom, flames from the right place; every older engine has no `x` and draws exactly as before.
- **2D fallback flight view:** `World.render` (317) draws:
  - sky gradient, stars and sun glare (`World.stars`, 278, works out each star's alpha, size and colour once; `drawStars`, 394, sets a fill colour only when it changes);
  - `drawBody` (411): a disc via `paintBodyDisc` (176) when small, else a 360/720-sample terrain profile with strata, beaches, ocean and the night gradient;
  - `drawScenery` and `drawClouds`;
  - `drawSpaceCenter` / `drawAirfield`;
  - particles;
  - vessels (`drawPart` in `sideOrder`, plus the plasma sheath);
  - night and haze tints;
  - plumes (`drawFlame`, additive);
  - markers.
- `earthDisc` (158) and `paintBodyDisc` are also used by `MapView`.

### 5. globe.js and map.js
- **`GlobeView`** (globe.js) holds the camera state: `dir`, `up`, `alt`, `follow`, plus the craft `trail`.
  - **`open`** (18) chooses `'system'` when the craft is at a star or above 6R.
  - **`northAt`** (37) gives real north on the mapped Earth.
  - **`update`** (52) records a trail point every 0.4 s or 2 km (thinned past 9000 floats) and eases `dir` while following.
  - **`render`** (90) calls `Render3D.renderGlobe` and then draws on the 2D canvas with `proj()` (100). **`proj()` must match the 3D camera** (FOV 50, looking at the centre, `up`), and it occludes points behind a sphere of radius `R·0.9995`. The overlay has:
    - limb glow and a cached lat/lon grid;
    - the track;
    - orbit patches (`patch3D` 316) or a ground-track great circle with minute ticks;
    - space-centre marker, countries and seas (`regionCentres` 328), cities with label de-overlap;
    - other craft;
    - scale bar and the `#globe-info` strip.
- **`renderGlobe`** (render3d.js:3240): a lit sphere reusing the planet's map. It also runs the planet-map queue itself, with the shown body's job put first (3246-3247; §1.5), because the flight view, which usually runs it, isn't drawn while the map is open.
  - Near the mapped Earth (alt < 0.45R), `tileJob` (3191) paints a sharp hill-shaded `DataTexture` tile with faded edges on a curved 40×40 patch lifted R·1e-4. Its budget is 10 ms per frame, and it rebuilds when the view leaves the tile.
  - Returns false if 3D isn't ready. Without 3D the map is forced to `'system'` (flight.js:1153).
- **`MapView`** (map.js) is a pure 2D canvas: `scale` (px/m), `offset`, `focus`.
  - `fit`/`focusBody`/`zoom` (zoom about the cursor), `pan`, `hit`.
  - `drawSystem` draws orbits, dashed SOI circles, discs and labels.
  - `render` draws prediction patches (`patchPoints` 235, 420 samples), Pe/Ap/encounter/impact/closest-approach labels with nudging, and vessels.
  - Screen y = `H/2 − (y − c.y)·S`.
  - `PATCH_COLORS` is shared with the globe.

---

### 6. Performance techniques
- **Time-sliced generators, each with its own ms budget:**
  - `bodyJob`/`cloudJob` via `runJobs`;
  - `patchJob`, `sceneryJob`, `cumulusJob`, `tileJob`.
  - Results are double-buffered (patch slots, scenery sets) and swapped atomically. A synchronous build happens only when nothing usable is on show, and is rate-limited.
- **Instancing:** trees, rocks, walls, roofs and boats use `InstancedMesh` with preallocated capacity and `.count`. Cloud puffs and particles are instanced quads with custom attributes. Lights are `Points` with a size-attenuated `GLOW` shader.
- **Merging:** static scenery is merged into single vertex-coloured meshes (`Batch` 166). Part models are merged per material kind.
- **Buffer reuse:** `DynamicDrawUsage` buffers are reused. Particles upload only their used range (`addUpdateRange`).
- **Caches:** `models`, `textures` (placed camouflage textures capped at 64), the camouflage tiles (`camoTex`, `camoMaps`; parts.js `CAMO`, `US5_CAMO`), the lofts per def (`us5Lofts`, `ruLofts`, `us4Rows`), `wheelNode`, carrier geometry per size, `boatGeoCache`, `spirals`, `fxColor`, `LAY`, the `envKey` throttle.
- **Level of detail:** low-poly far trees, planet dots, pixel-size visibility for meshes and vessels, octave fade, averaged field colours far off, continent subsampling.
- **Shadows** only on high, with the shadow camera fitted to the craft.
- **Adaptive pixel ratio.**
- **Telemetry:** `Render3D.info().t`.
- **Draw nothing that can't have changed** (PR #35): the idle 3D hangar makes no GL call (§2); a paused flight or one under a dialog is drawn 10 times a second (`calm`); the sky, haze, band and planet aren't shaded where the ground hides them (§1.14); water triangles under the ground are cut from the index (§1.7); the shadow map isn't redrawn while the Sun lights nothing (§1.3); a cloud sort waits for the camera to move (§1.9); a prop disc with no opacity isn't drawn (§3); planet maps nobody has seen yet wait behind Earth's (§1.5).
- **No allocation per frame** on the flight and hangar paths: reused colours, vectors, option objects, tint maps and the layout (§1.1, §2).

### 7. Invariants and gotchas
1. **The log depth buffer is everywhere.**
   - Custom `ShaderMaterial`s must use `smat` and include `LOGV`/`LOGF` + `logdepthbuf_*` chunks (243-246).
   - `polygonOffset` does nothing, so use `depthBias`.
   - Any `onBeforeCompile` hook whose injected code varies needs a `customProgramCacheKey` (as `depthBias` has).
2. **Keep content relative.** Put content in `localWorld`/`spaceWorld` in sim axes relative to `camAbs`, or in an a0/site frame. Never use absolute coordinates.
3. **The two passes do not occlude each other.** Anything that must depth-sort with the terrain goes in `localWorld`.
4. **`paint()` reads module-level side channels** (`BIOL`, `BIOW`, `SHORE`, `FAR`, `CLIFF`) that callers set first (`bioAt`, etc.). Reset `CLIFF` afterwards.
5. **Scenery seats on the rendered patch.** A patch swap must dirty the scenery (`swapPatch`). Anything placed with `meshHeight` is skipped outside the patch.
6. **Disposal rules:**
   - `Batch.add` **disposes the geometry passed in**, so never feed it a cached geometry.
   - Parts3D `models` and `textures` are shared and must never be disposed per part. `freeRig` (1646) disposes only per-part materials, plume materials and pylons. The one exception is `textureFor`'s placed camouflage textures, of which it keeps the latest 64 (§3, materials); the per-skin camouflage textures (`camoTex`, `camoMaps`) are never disposed.
   - Combat target models are removed without disposing (a small leak).
7. **Cache keys must cover what geometry depends on.** A model depends only on def, flip and (for wings) skin. If a new per-part property changes the geometry, add it to the `model()`/`textureFor()` keys, to the builder's rebuild key (`bd.key`, 2914), to the ghost key (2886) and to the pylon signature (parts3d.js:1706). A camouflaged part's texture also depends on where the part is (`camoAt`): `textureFor` keys it by place, but a rig's materials are made once, so a camouflaged part moved in the hangar keeps the pattern it was built with until its rig is rebuilt (type, flip, skin or the parts array change).
8. **2D and 3D must agree.** Change both sides together:

   | 3D | 2D |
   |---|---|
   | `PLUMES` + plume length math | `World.drawFlame` |
   | `envAt` / `skyColors` | `World.environment` / `World.render` |
   | Row-0 cumulus | `World.drawClouds` (hash seeds 21-23, 750 m, drift 2e-6) |
   | `initSpaceCentre` layout | `drawSpaceCenter` |
   | `sheath` | `World.drawVessel` sheath |
   | `skinTip` | `accent()` |
   | Lathe/extrude silhouettes and textures | `partPath0` / `drawPart` |
   | `updateParticles` `'glint'` (chaff foil) | `FX.draw` `'glint'` (both through `FX.twinkle` and the night dim) |
   | Lofted bodies (PR #36): `BUILD.us5`/`us5LoftGeo`, `BUILD.ruLoft`/`loftGeo`, `BUILD.us4body`/`loftTube` | `us5Path`/`us5Draw`, `ruPath`/`ruDraw`, `us4Path`/`drawUS4`: both read the same sections (`us5Lofts`, `ruLofts`, `us4Rows`), so change the data, not one side |
   | Camouflage: `camoTexture` (the 16 m tile, 32 px/m for patterned ones), `camoAt`/`camoMap` offsets, `camoUV` and `us5SkinUV` in metres / 16 | `skinFill` → `us5CamoFill`/`camoFill`, metres from the blueprint's origin |
   | Off-centre and twin nozzles: `makePlume` at `nozzleOf(d).x` and each `body.noz[0].z` | `World.drawFlame` at `e.x + nz.x` |
   | A flat nozzle's `pivot` and its flame | its 2D art (`US5_ART.eng22`) turning the flaps by `p.deflect` |
   | Bay and gun doors: `hinge` sub-nodes | the FS-22/35 2D art's doors from `p.deployed` (the Sugoi-57's bays have neither, chapter 7) |
   | Fin outlines and cant: `vtail` with `def.vtail`, `ruFin`, `US5_FIT.fin` | `partPath0` `vtail` with `def.vtail`, `ruFinPath`, `us5FinPoly` |

   The wing planform formula lives in `wingGeo`, `wingAt`, `oldStruts.holds` (parts3d.js:1555) and builder.js; the `plan` and `crank` variants in `planGeo`/`planAt` and `crankAt`, which `wingAt` and `oldStruts.holds` (1554) share.
9. **The emissive channel is shared** by heat glow (`emissive`) and builder tints (`tint`).
10. **Decorative meshes in a rig** must either be pickable (in `rig.meshes` with `userData.part`) or set `raycast = noop`, like plumes, discs, chute lines and the lighthouse beam.
11. **Quality-dependent buffers** must be reallocated in `applyQuality`. If you raise a placement cap, raise the `InstancedMesh` capacity too.
12. **parts3d.js top level must not reference `THREE`.** Use `need()`. It may read parts.js globals (`LATHE_SHAPES`, `PART_RECIPE`, `PART_FLAT_DEPTH`, `pathRecorder`, `partOutline`, `outlineSpan`, `CAMO_M`, `US5_CAMO_TILE`), since parts.js loads first. Watch for duplicate names inside the IIFE: two function declarations of one name don't throw, the later one silently wins. That is why the merge renamed the FS jets' `loftGeo` to `us5LoftGeo`; it would otherwise have replaced the Russian hulls' builder.
13. **The flight view skips what the ground hides** (§1.14, §1.7, §1.4). New far-layer content (a body, a glow, an atmosphere, a deck) must count in `updateBodies`'s `seen` (2540-2600), or the haze dome may be hidden or cut over it. The ground cut trusts `patch.minH` and `sag`, so anything that lets the rendered ground dip below what `patchJob` records must update them. Water draws only the triangles `cullWater` keeps (`patch.hide`).
14. **The hangar is drawn on demand** (§2; chapter 1 §7). Anything that animates in the 3D hangar must keep `renderBuilder` drawing (`bv.moving`, `bd.anim`), and a change made from code must call `Builder.redraw()`.

### 8. Adding a 3D model for a new part
1. **Define the part** in `PARTS` (parts.js:40) with a `shape`, and draw it in `partPath0`/`drawPart0`. The 2D art becomes its texture automatically.
2. **Body of revolution:** add the shape to `LATHE_SHAPES` in parts.js (parts3d's `LATHE`; and to `LATHE_KIND` if it isn't `hull`). Add a `PART_PROFILE` entry (parts.js) if the 2D path has bits that shouldn't revolve. Add extras in `BUILD.lathe`'s per-shape branch.
3. **Flat part:** nothing to do (`extrude`). Set `def.depth` or `PART_FLAT_DEPTH`.
   - **A lofted body** (a jet's fuselage): use one of the three loft formats (chapter 1 §2) rather than a new recipe; the 2D art, the clash shape and the 3D model then come from the same sections.
4. **Bespoke model:** write `BUILD.myRecipe(d, flip, skin)` that returns `node([[geometry, 'kind'], ...], subs, {anim})`.
   - Frame: origin at the part centre, +y = the part's up, x = 2D x, z = across, in metres.
   - Mirror with `s = flip ? −1 : 1`.
   - Build geometry from def, flip and skin only (it is cached).
   - Register it in `PART_RECIPE[shape]` (parts.js), or set `def.body3d`. The builder's clash test treats any recipe but `lathe`, `extrude` and the lofts as the part's box (chapter 1 §4). A lathe, extrude or loft model whose fittings stand out of the 2D outline needs a `CLASH_PAD` or `CLASH_BOXED` entry (parts.js), or `builder-shapes.mjs` reports it.
5. **Materials:** use existing `KINDS`, or add one. Add it to `BODY_KINDS` if it is the paintable body colour. If colours are baked into the geometry, add the recipe to `SKIN_GEO` and honour `skin`.
6. **Animation:** use a sub-node `role` (table in §3) and `anim` (`rate`, `disc`, `always`, `tail`). A new role needs a branch in `update()`; unknown roles land on `rig[role]`.
7. **Lopsided left/right model:** add it to `ZMIRROR`; for a twin pair whose left copy should be the mirror image, set `def.twinMirror`.
8. **Automatic features:** `twinZ` gives pairs, `pod` or `att` gives pylons, `thrust` + `plume` gives plumes (add new plume colours to `PLUMES` *and* `World.drawFlame`), `chute` gives a canopy.
9. **Test** in the 3D hangar (`V`): attach, ghost, tint, paint, flip and depth drag. Then test in flight: animation, heat, plume, picking. Then check that the 2D fallback still draws.

## 4. Combat and multiplayer

Files: `js/combat.js` (global `Combat`), `js/net.js` (`Net`), `js/mp.js` (`MP`), `js/mpui.js` (`MPUI`), plus vendored PeerJS 1.5.4 at `js/vendor/peer.min.js`. Load order (index.html:346-352) puts combat.js after globe.js and before builder.js. peer.min.js, net.js, mp.js and mpui.js load after flight.js and before main.js. Each file is a plain script whose top-level `const`s are globals, so they are reachable from the devtools console. If you add a file, also add it to the `SHELL` list in `sw.js` and bump its `CACHE` name.

### Where the game calls in

| Call | From | When |
|---|---|---|
| `Combat.step(h, F)` | flight.js:642 (`physicsTick`) | Every physics substep: bay and gun doors (PR #36), firing, projectiles, flares |
| `Combat.frame(F, dt)` | flight.js:538 | Every frame: targets, AI, warnings, locks, smoke, countermeasure particles (`cmFX`) |
| `Combat.drawHUD` / `MPUI.drawHUD` | main.js:101-102 | 2D overlay canvas |
| `Combat.reset(F)` | flight.js:94 (`resetState`), mp.js:568 | New flight; module state is a singleton |
| `Combat.impact` | vessel.js:968 | Hard-landing dents |
| `Combat.engineK` / `liftK` | vessel.js:427, vessel.js:784 | Damaged engines and wings |
| `MP.beforeUpdate(dt)` | flight.js:510 | Pose the ghosts before physics |
| `MP.afterUpdate()`, `MP.syncMissiles()` | flight.js:552 | Send snapshots after physics |
| `MP.onLocalDestroyed()` | flight.js:398 (`onDestroyed`) | The local craft is lost |

Remote craft are skipped by physics (flight.js:524). They only coast along their velocity on each substep (flight.js:639).

---

### 1. combat.js

**Mode.** `mode()` (combat.js:27) reads `Settings.get('targets')`, which is `practice`, `hostile` or `off`. It is forced to `'off'` whenever `MP.active` (combat.js:26), so a multiplayer room never has range targets, SAMs or AI fighters. Any new AI or target code must check `mpOn()` too.

#### 1.1 Weapon parts (parts.js:349-410)

`weapon.ammo` counts **both copies** of a twin pair. `each` is the kg released per round: `p.store = ammo*each`, and the mass is recomputed when `each >= 10`.

| Type (line) | Kind | twinZ | Stats |
|---|---|---|---|
| `gun` 351 | gun | – | 600 rds, 16/s, 880 m/s, dmg 9, spread .004 |
| `cannon` 354 | gun | – | 180, 8/s, 1000 m/s, dmg 34, **blast 3** (every shell explodes) |
| `gunPods` 357 | gun | 2.4 | 800, 24/s, 900 m/s, dmg 9 |
| `gatling` 385 | gun | – | 1100, 60/s, 1050 m/s, dmg 24, `barrels: 7` (spins) |
| `turret` 388 | turret | – | 800, 12/s, 900 m/s, dmg 8, range 1100; fires on its own |
| `rocketPods` 360 | rocket | 3.1 | 14 rockets, 6/s ripple, 60 m/s + 700 m/s² for 1.1 s, dmg 110, blast 9 |
| `aam` 363 | missile `seek:'air'` (IR) | 3.6 | range 5 km, cone .35, accel 260, burn 3, vmax 900, 30 g, dmg 400, blast 15, life 18 |
| `radarMissiles` 366 | missile air `radar:true` (SARH) | 2.4 | 15 km, cone .6, burn 5, vmax 1300, 25 g, dmg 450, blast 16, life 30 |
| `agm` 369 | missile `seek:'ground'` | 2.9 | 8 km, burn 4, vmax 700, 18 g, dmg 900, blast 20 |
| `glideBombs` 397 | missile ground `glide`, label GBU | 2.9 | 12 km, no motor, vmax 420, 5 g, dmg 1300, blast 28, life 90 |
| `harm` 403 | missile `seek:'radar'`, label ARM | 2.6 | 22 km, cone .8; locks only `emitter` targets |
| `cruiseMissile` 406 | missile ground, label CRUISE | – | 30 km, accel 45 for 140 s, vmax 270, dmg 2600, blast 40, life 150 |
| `bombs` 372 / `bombL` 375 | bomb | 2.7 / – | 1200 dmg, 30 m blast / 4000 dmg, 55 m blast |
| `bombBay` 391 | bomb, `bay:true`, stealth .5 | – | 4×250 kg released from the belly |
| `clusterBombs` 394 | bomb `cluster:24` | 2.7 | bursts 150 m up into 24 bomblets (dmg 220, blast 10 each) |
| `torpedo` 400 | bomb `torpedo` | 2.6 | dmg 2200, blast 16 |
| `flares` 378 | flare | – | 30 |
| `chaff` 382 | chaff (Chaff Dispenser, PR #35) | – | 24 bundles of 1 kg (`p.store` 24 kg, lighter by one per bundle); 0.4 × 0.9 m, 30 kg dry. Shape `flares` with `style: 'chaff'`: four foil bundles in 2D (parts.js:2489), the default extrude with that art in 3D. Not selectable with Tab. §1.4 |
| `ecm` 409 | (no `weapon`) `ecm:true` | – | Jammer and missile warner |

The look-alike jets' weapon parts (PR #36). The missiles copy the stock `aam` or `radarMissiles` numbers; what is new is where they leave from and the doors (§1.2).

| Type (line) | Kind | twinZ | Stats |
|---|---|---|---|
| `us5Intake22` 431 (Fuselage tab) | missile air (IR), `bay`, `doors`, `bayRack` | – | the FS-22's middle: 2 heat seekers in side bays, one behind each intake, as `aam` |
| `us5Bay22` 435 | missile air radar, `bay`, `doors`, `bayRack` | – | the FS-22's belly bay: 6 radar missiles, as `radarMissiles` |
| `us5Bay35` 468 | missile air radar, `bay`, `doors`, `bayRack` | – | the FS-35's two belly bays: 4 radar missiles |
| `us5Gun` 454 | gun, `doors` | – | 480 rds, 50/s, 1050 m/s, dmg 14, spread .004; a door over the port opens as it fires; stealth .7 |
| `ruBay57` 626 | missile air radar, label RV-77, `bay`, `doors` | – | the Sugoi-57's bay between the engines: 4 radar missiles |
| `ruBayS57` 630 | missile air (IR), label RV-74, `bay`, `doors` | 2.6 | the Sugoi-57's wing-root bays: 2 heat seekers |
| `ruAAM21` 682 | missile air (IR), label RV-13 | 2.3 | early heat seekers for a small wing: 4 km, cone .3, accel 230, burn 2.5, vmax 800, 24 g, dmg 380, blast 14, life 16 |
| `us4Vulcan` 696 | gun, `flush` | – | 510 rds, 50/s, 1030 m/s, dmg 11, spread .005; set inside a body |
| `us4f4Gun` 732 | gun, `flush`, shape `us4body` | – | the FS-4's chin-gun fairing: 640 rds, otherwise as `us4Vulcan` |

Related defs:
- `radar` reach in metres: cockpitJet 12000, cockpitTandem 10000, cockpitStealth 14000, droneCore 6000, radome 16000, rotodome 45000. The jets' noses (PR #36): MyG-21 8000, FS-4 14000, FS-16 15000, MyG-29 16000, FS-35 16000, FS-15 18000, FS-22 18000, Sugoi-27 20000, Sugoi-35 26000, Sugoi-57 28000.
- `armor`: fuselageArmor 0.6.
- `stealth`: cockpitStealth and fuselageStealth 0.6, bombBay 0.5. The 5th-generation jets' parts (PR #36): the FS-22's 0.7 (its engines 0.6), the FS-35's 0.65 (engine 0.6), the Sugoi-57's hull, bays, booms and fins 0.6.
- `irst` (PR #36): the IRST Ball (`ruIRST`, parts.js:493) 0.3. `irK`: `us5Eng22` 0.7, `us5Eng35` 0.85.
- Optional air-to-air overrides read by `airframe()`: `drag`, `bleed`, `gimbal`, `track`, `arm`, `irccm`.

#### 1.2 Weapon systems and firing

- **`systems(v)`** (combat.js:157) groups weapon parts by `p.type`, so all guns of one type fire together. Flares, chaff and turrets are excluded (they work by themselves). The result is cached on `v._ws`, keyed by `parts.length`. `v.wsel` is the selected index, and `cycle()` (combat.js:1300) changes it (Tab).
- **`status(v)`** (combat.js:1309) is what the weapon box shows: the chosen system's name (`w.label`, else `SHORT` by kind, :1323: GUN, RKT, AAM, RADAR, AGM, BOMB; the radar missile's label was AMRAAM until PR #36's naming rule, and the jets' missiles carry labels of their own, RV-77, RV-74, RV-13), rounds and count, the lock, kills, `flares` and `chaff` left and `stealth`. With no system it returns null, unless the craft carries a turret (`TURRET`, its rounds) or flares or chaff (`FLARES`, `CHAFF` or `CM`, `ammo: null`, `cmOnly: true`, and `fl`/`ch` saying which it has, so an emptied one still shows `✦0`/`≋0`). The HUD side is in chapter 2 §4.
- **Trigger** (`step` combat.js:469, `playerFrame` combat.js:392):
  - Guns fire while the trigger is held. Each part keeps its own `p.cool`.
  - Rockets ripple one per `1/rate` through `nextStore`.
  - Missiles and bombs release once per trigger press (rising edge, or `F.fireTap`).
- **`zAt(p, side)`** (combat.js:190): a twin copy sits at `side * partZ(p)`; a single part sits at `partZ(p)`. Twin `p.z` is the spread, always ≥ 0 (parts.js:889-898).
- **`muzzle(p, side)`** (combat.js:192) gives the release point in part space:
  - a `bayRack` part (PR #36; :194): its own slot, `bayRack[ammo − 1]` (`[x, y, z]` in the part's frame, z added to the copy's), the store the 3D model hides next, so each missile leaves from where it was seen (the FS-22's main bay fires from z 0.78, −0.78, 0.47, −0.47, 0.16 and −0.16 in turn);
  - bay: below the belly at `w*0.6`, alternating ±0.6 by ammo parity;
  - stores and pods: offset `w*0.12`;
  - guns: the tip (`h/2`).
- **`nextSide(p)`** (combat.js:204):
  - a single part fires from the side it sits on (`sideOf(partZ)`);
  - twin rockets alternate `-(p.side||1)`;
  - twin missiles and bombs go right on even ammo and left on odd. This must match the store-visibility formula in parts3d.js:1784-1787.
- **`nextStore(sys)`** (combat.js:208) chooses among parts with ammo. It prefers a part whose next side differs from `sys.last`, then the smallest `relN` (the rack that has waited longest). `release()` (combat.js:229) decrements ammo and updates `p.store`.
- **`fireGun`** (combat.js:238):
  - Twin guns alternate `p.side` every round.
  - **Convergence:** a muzzle with `|z| > 0.3` is toed in by `cz = -m.z/600`, so the rounds meet 600 m ahead. That is where the HUD pipper sits (combat.js:1246).
  - Random spread on each axis; rounds live 3 s; a tracer every 3rd round (every round for exploding shells).
  - With `net=true` it fires show rounds: `dmg: 0`, and `s.net` set so they skip hit tests.
- **Doors** (PR #36; combat.js:215-227), for parts with `def.doors` (the FS-22/35 bays and guns, the Sugoi-57's bays): they snap open to fire and shut again a moment after the last shot.
  - `openDoors(p)` (:219) sets `p.doorT` to `DOOR_HOLD[kind]` (:218: gun 0.35 s, missile 1.4 s, bomb 1.8 s). `release()` calls it for every store, and `fireGun` for our own rounds (:253, not `net` ones).
  - `doorStep(v, h)` (:220) runs from `step` with the physics for our own craft only (`F.active`, not `v.remote`, :471): `p.deployed` opens in 0.2 s while `doorT` lasts and shuts in 0.4 s. The door parts are found once per part count (`v._doors`).
  - `p.deployed` is what the 2D art, the 3D `hinge` doors and `stealthOf` read, and it already travels in multiplayer part states (`pv`), so another player sees the doors open and the stealth drop. A craft you switch away from within the hold keeps its doors open until you come back.
- **`fireRocket`** (combat.js:261): starts at `w.speed`, motor from t=0. **`launchMissile`** (combat.js:273): dropped at +4 m/s "down" (a plane's part +x), no motor and no guidance for the first 0.35 s. **`dropBomb`** (combat.js:286): +2 m/s down. In multiplayer, rockets and bombs call `MP.sendShot` and missiles call `MP.sendMissile`.
- **`turretStep`** (combat.js:350):
  - aims at the nearest air candidate within `range`, leading it;
  - slews at 2.5 rad/s;
  - fires once within 0.06 rad;
  - `p.aimYaw`, `p.aimEl` and `p.gunOn` are replicated through `pv`.

#### 1.3 Projectiles (`moveShot` combat.js:514)

A shot is a plain object with these fields:
- `k`: `bullet`, `rocket`, `missile`, `bomb` or `torp`
- position and velocity, plus `dx/dy/dz` heading
- `t`, `life`, `dmg`, `blast`, `owner`, `enemy`
- `net`: the owning pid, on a replica
- `netId`: missile replicas only

Step order:
1. Gravity and drag (`k·ρ·v` with k = 1.2e-4 for bullets, 3e-5 for bombs, 6e-5 otherwise; air missiles use `s.drag`).
2. Segment-vs-part-box test against every vessel on the same body (`hitVessel` combat.js:105). The owner is skipped for the first 1.5 s. Replicas test nothing.
3. Range targets.
4. An unarmed hit (`t < s.arm`) is a dud that does 10% damage.
5. Missile proximity fuse at `blast*0.45`.
6. Direct hit: `explode()` if the shot has blast, else `damage()`.
7. Ground or sea: explode, or splash.

Other fates:
- A missile that times out self-destructs: `blast*0.4`, dmg 0.
- A cluster bomb bursts 150 m above the ground after 1 s (`burst` combat.js:609).
- A torpedo hitting water at ≤110 m/s becomes `k:'torp'` (`swim` combat.js:621). It runs at 30 m/s, 1.2 m under the surface, homing on the nearest **range sea target** within 4 km. There are no such targets in multiplayer, so torpedoes cannot hurt players.

Part hit boxes (`boxesOf` combat.js:81):
- every part: its `partRect`;
- across (z): a twin copy is ±`max(w,0.6)/2`, a wheel ±`track/2+0.3`, anything else ±`partDepth/2`;
- one box per entry of `partZs(p)`.

`hitVessel` returns early when the segment's closest approach to the vessel is more than `reach+2` away.

#### 1.4 Missile guidance and how to beat it

**Lock** (combat.js:401-421):
- Candidates come from `candidates(v, seek)` (combat.js:449):
  - for `air`: AI bandits, air drones, and enemy ghosts that are not landed and not cars;
  - for ground seekers: ground targets, plus enemy ghosts that are landed or are cars. The `radar` seeker (ARM) takes emitter targets only, never players.
  - Ghosts flagged `hiddenUntilSnap` are excluded.
- Minimum range: 350 m air, 150 m ground. The candidate must be inside `w.cone`.
- Range comes from `rangeOf` (combat.js:174): radar missiles get `min(range, own radar)`, or 5 km without a radar. A heat seeker (`seek: 'air'`, not radar) gets `range·(1 + irstOf(v))` (PR #36): `irstOf` (:173) is the best `def.irst` on the craft, so an IRST Ball (0.3) makes the stock heat seekers lock from 6.5 km instead of 5. Radar and ground missiles are unchanged (`combat.test.js` checks).
- IR range is further scaled by `clamp(√irSig, 0.2, 1)`, so the cold-target and head-on cuts scale with the IRST too.
- SARH needs `radarSees === true`, and holds its lock anywhere the radar sees the target unless `chaffBreaks` (combat.js:436) fires.
- Lock time is 0.9 s for IR and 1.4 s for radar, doubled against a jammer.

**`airframe(w)`** (combat.js:659) defaults, IR / radar:
- drag 1.6e-4 / 1.1e-4
- gimbal 0.6 / 1.1 rad
- track rate 0.7 / 1.0 rad/s
- bleed 0.012, arm 0.6 s, irccm 0, PN gain `nav` 4

**`guideAir`** (combat.js:760) uses proportional navigation. Maximum pull is `turn·g·min(1, q/QREF)` with `QREF = ½·1.225·400²` (combat.js:658). Energy losses are in `moveShot` (combat.js:528-531): steep drag above `vmax`, and bleed ∝ g² scaled by `QREF/q`, so turns cost more in thin air.

The target is dropped (`s.target = null`, missile flies dumb) when:
- the motor has burnt out and speed is below 150 m/s;
- the line of sight leaves the gimbal;
- the line-of-sight rate exceeds `track` for more than 0.25 s while farther than 60 m;
- for SARH: the launcher's radar loses the target for more than 1 s (a notch gets 0.4 s of grace). The launcher's radar is `radarSees` for a craft, or `siteSees` when the launcher is a range target, i.e. the frigate (`s.launcher.def`, combat.js:766);
- a decoy wins.

**Beating missiles:**
- **Energy:** short burn, then drag and turn bleed.
- **IR signature** (`irSig` combat.js:668): `Σ firing·thrust·(1+1.5·ab)` (props and rotors ×0.5, and ×`def.irK` since PR #36, :673: the FS-22's flat nozzles 0.7 and the FS-35's serrated one 0.85 hide some heat) `/120 + 0.08`. It scales by aspect: tail 1, side 0.35, head-on 0.1, or 0.3 with the afterburner lit.
- **Flares** (`decoyed` combat.js:737): each flare is judged once per missile (`s.cm` WeakSet), within 0.3 rad of the line of sight. `K = 0.3·(1 − t/3)`, and the chance is `min(.85, K/(K+irSig))·(1−irccm)`. Throttling back helps.
- **Chaff** (radar missiles). Two kinds of cloud sit in `S.flares` with `chaff: true`, both living 5 s:
  - the **free cloud** that comes with flares (`flares(v, sim, true)`, combat.js:301: by hand when there is no dispenser bundle, or from `autoCM` against a radar missile), and
  - a **dispenser bundle** (`str: 2`, PR #35) from a Chaff Dispenser (`chaff(v, sim, p)`, combat.js:319: from the first dispenser with bundles left (`dispenser`, :318), at 0.5× the craft's velocity plus 6 m/s "down" for a plane, and `release()` takes a bundle and its 1 kg).
  - **Reach and odds** (`chaffR`, `chaffOdds`, combat.js:432-433; `vr` the target's speed along the beam, under 80 m/s = crossing it): the free cloud 250 m, 0.6 crossing, else 0.15; a bundle 400 m, 0.75 crossing, else 0.15. A bundle's edge over the free cloud is its reach, its waiting for the missile and the odds when crossing. (Its odds when not crossing were 0.25 until the review found that mashing `K` made radar missiles almost useless.)
  - **`decoyed`** (combat.js:737) weighs each cloud once per missile (`s.cm`), only within 0.15 rad of the line of sight and within `d + 800` m of the missile. The free cloud keeps its old order: marked as seen first, then it must lie within 250 m of the target, so one dropped early is wasted. A bundle is only marked as seen once every test passes, including the missile being within 4 km of the target (`d ≤ 4000`) and the cloud within 400 m of it: one dropped early waits, while it lasts, until the missile is close.
  - **`chaffBreaks(v, t)`** (combat.js:436): a cloud near a target the player's radar has locked can break the lock (each cloud once), with the same radius and odds. It covers bandits that drop chaff and other players' clouds.
  - Hit rates measured with the real missile code (200 trials a row, with the odds above): a radar missile fired from 8 km at a stock Falcon hits 84 % tail-on, 33.5 % across its path and 83 % head-on when the Falcon drops one bundle at 3 km, and 13 % / 0 % / 30.5 % when it mashes `K` inside 7 km. Against a bandit dropping its free cloud as the AI does: 50 % tail-on, 5.5 % across, 89 % head-on (100 % each before PR #35, when the AI dropped only flares).
- **Notching** (`radarSees` combat.js:687) is now three steps with the same arithmetic as before: `radarReach(R, t, d)` (:696: `R·(1−stealth)`, ×0.7 beyond 5 km against a jammer, at least 5 km), the target within 60° of the launcher's nose, then `clutter(o, t, tp, dx, dy, dz, d)` (:702): a low target (50 m below the radar, or under 300 m above the ground) moving at less than 40 m/s along the beam returns `'notch'`.
- **A ship's radar** (`siteSees(e, t, tp, memo)`, combat.js:713; PR #35) guides the frigate's SAMs: all round, from the mast (`mastOf`, :722: `def.h + 12` m up), out to `radarReach(e.def.radar)`, never through the ground: `clearLine(o, p, d)` (:725) samples the ground or sea every ~150 m (4-120 samples) and needs 4 m of clearance. The answer is kept on the missile for 0.25 s of its own clock (`memo.losAt`/`los`). Then `clutter`, so notching works against it. True, `'notch'` or false. At 1/20 scale the horizon hides a low craft too.
- **ECM** (`jams` combat.js:188):
  - radar reach ×0.7 beyond 5 km (minimum 5 km);
  - radar lock time ×2;
  - AA spread 0.012→0.03;
  - local enemy missiles more than 1.2 km away lose their target at 0.35/s (combat.js:492). That only affects SAM and AI missiles, never multiplayer ones;
  - in multiplayer it acts as a heat-seeker warner within 2 km.
- **Stealth** (`stealthOf` combat.js:177): area-weighted `def.stealth` over the hull, minus 0.12 per external store, pod or ECM pod still carrying ammo, clamped to 0..0.75. Paint never counts. A Chaff Dispenser counts as neither hull nor store (it sits flush in the skin), so a Spectre with one is exactly as stealthy as without. A `doors` part with its doors open (`p.deployed > 0.05`, :183; PR #36) counts as one store hung outside, so an internal bay keeps a jet stealthy until it shoots (as the templates come, one bay open): the FS-22 0.68 shut, 0.56 for a moment after a launch; the FS-35 0.64 and 0.52; the Sugoi-57 0.54 and 0.42 (its bays are hull with `stealth` 0.6). Internal bays without doors (`bombBay`) count as hull, as before.

**Countermeasures** (PR #35):
- **By hand:** `K` or the CM button calls `countermeasures(v, sim)` (combat.js:331), at most once per 0.6 s: the flares if fitted, and a bundle if the craft has a dispenser with bundles left. Flares bring their free cloud only when there is no bundle (`flares(v, sim, !dispenser)`), so a craft with flares and no dispenser (every design from before #35) behaves exactly as before, and once the dispenser is empty the free cloud comes back. True if either went.
- **By themselves:** `autoCM(v, sim, m)` (combat.js:341) drops, against a radar missile (`m.sarh || m.radar`), a dispenser bundle, or without one flares with their free cloud; against a heat seeker, flares alone, as before. AI fighters use it (`flyFighter`, under 1.8 km, every 0.7 s, combat.js:1067) and so does a solo player (below).

**Warnings** (combat.js:1151-1162):
- Solo: any enemy missile targeting you warns, and countermeasures go out by themselves through `autoCM` under 2.2 km (every 0.6 s).
- Multiplayer: no auto countermeasures, so press `K`. Radar missiles warn; heat seekers are silent unless you carry ECM and they are within 2 km.
- `S.warnR` is set while a radar-guided missile is among the warnings (also another player's), and `drawHUD` then writes **RADAR MISSILE** instead of MISSILE (combat.js:1279), so the player knows to drop chaff or notch rather than flare.
- A radar lock on another player calls `MP.sendLock` (combat.js:1166-1167), re-sent every 1 s, and drives their RWR.

**Ground seekers:** `guide()` (combat.js:796) is lead pursuit with `tgo ≤ 12 s`, turn rate `turn·g/v`, and `vmax` as a hard cap.

#### 1.5 Damage

- **`maxHp(def)`** (combat.js:36) = `round((60 + 220·√(mass + fuel·0.25)) · (control ? 1.4 : 1))`. `p.hp` is lazily created.
- **`engineK`**: thrust is ×1 at ≥60% health, falling to 0.3 at 0. **`liftK`**: lift is ×1 at ≥70%, falling to 0.45.
- **`damage(v, p, amt, cause, sim, by)`** (combat.js:42):
  - **does nothing for `v.remote`**: the owner applies damage to its own craft;
  - armour scales damage by `(1 − armor)`;
  - sets `v.lastHitBy` and `v.lastHitAt`;
  - toasts at 60% and 30% for the player;
  - calls `destroyPart` at 0 hp.
- **`destroyPart`** (combat.js:57):
  - Parts with thrust, more than 50 kg of fuel, rocket/missile/bomb ammo, or `control` go through `sim.breakParts` (an explosion). Everything else goes through `sim.ripParts` (torn off as debris; flight.js:258, 372).
  - Fuel over 500 kg adds a blast of radius `4+√(fuel/n)·0.08`, dmg 45.
  - Remaining stores blast at radius `blast·0.6`, dmg `dmg·0.5/count`.
  - **A legacy twin pair** (spread equal to `def.twinZ` within 5e-4) **blasts once**, at the centre (z = 0).
  - **A split twin** (any other spread) **blasts at each copy**, with fuel and store damage divided by the number of blast points. If only one store of a pair is left, it blasts only on the side due to fire next.
  - These secondary blasts carry `by = null`, so they never credit anyone and never reach remote craft.
- **`explode(b, at, blast, dmg, by, sim, quiet)`** (combat.js:127):
  - Falloff `dmg·(1 − d/blast)^1.5`, where d is the distance to the nearest copy of the part minus `max(w,h)/2`.
  - If `by` is the local player's craft: blasts of 8 m or more go out as `MP.sendBoom`, and remote craft in range collect `[part, dmg]` lists, sent as one `MP.sendHits(..., 'blast')` per craft.
  - Range targets are skipped in multiplayer.
- **Crash damage** happens in `Vessel.ground` (vessel.js:931-968):
  - the limit is `breakSpeed` (default 9, vessel.js:9), ×1.8 on water;
  - with combat loaded, a part breaks above 1.6× the limit and dents above 0.75× (`Combat.impact` combat.js:70: `maxHp·(ratio−0.75)·1.6`, at most once per 0.4 s per part);
  - a spinning prop or rotor touching the ground shatters;
  - the silly flag `bouncy` disables dents.
- **Smoke and leaks** (combat.js:1168-1184), for craft within 5 km, ghosts included: smoke below 60% health, fire below 30%, fuel leaks below 50%. `integrity(v)` (combat.js:1324) feeds the HUD.

#### 1.6 Target range, SAMs and AI fighters (single-player only)

**`TARGET_KINDS`** (combat.js:8):

| Kind | hp | Notes |
|---|---|---|
| tank | 600 | |
| truck | 220 | |
| radar | 320 | emitter |
| bunker | 1600 | |
| aa | 380 | aa, emitter |
| sam | 420 | sam, emitter |
| boat | 520 | |
| ship (Frigate) | 3200 | aa, emitter, `rsam`, `radar: 13000` (its own radar guides its SAMs, combat.js:16) |
| drone | 140 | air, 75 m/s orbits |

- **Layout and spawning:** counts come from `TARGET_LAYOUT` (combat.js:19). Targets spawn when the player is on Earth within 60 km of `at(8000,0,0)` and the terrain map is ready (combat.js:1108-1112).
- **Placement** (`place` combat.js:905) uses a seeded RNG:
  - land: 45% on Shetland, else the Faroes; height 2–220 m, off the runway and space centre, gentle slope;
  - sea: depth below −12 m;
  - drones orbit a 900–1800 m radius at 500–1400 m.
- Dead targets respawn elsewhere after 60 s.
- **Static targets** (no `def.speed`: radars, bunkers, AA guns, SAM sites) keep their `pos` and `h` while `e`/`z` still match `posE`/`posZ`, so they don't look up the ground every frame (`syncTarget` combat.js:931, 951).

**Hostile mode:**
- **AA** (`aaFire` combat.js:957): fires 3 s out of every 7 when the player is within `3500·(1−0.6·stealth)`. Tracers at 850 m/s, dmg 6, leading the player.
- **SAM** (`samFire` combat.js:968): fires when the player is within `9000·(1−stealth)` and above 150 m. First launch after 4 s, then every 22 s, one missile in the air per site. The missile is an IR seeker: burn 5, accel 220, vmax 950, 22 g, dmg 300, blast 13, arm 0.4 s. SAM sites stay heat seekers (the README promises flares beat them).
- **Frigate radar SAM** (PR #35; `shipSamFire` combat.js:981, called from `frame` at 1111-1116):
  - Wakes when the player is within `def.radar` (13 km) of the frigate and above 150 m (as for the SAM sites, so a take-off from the runway, which the ship lies off, isn't met by one).
  - First look after 20 s (`t.rsamT`), then it fires only if `siteSees(...) === true` (in reach for the craft's stealth and ECM, in clear view, not notching), else looks again every 1 s. After a launch it waits 13 s, and the ship has at most one missile in the air (one that went dumb counts until it falls).
  - The missile: launched from the mast along the line of sight plus 0.6 × up (it climbs steeply off the deck), `t 0.35`, life 30, burn 6, accel 210, vmax 1100, turn 22, dmg 300, blast 14, `radar: true` with `launcher: ship` (so `guideAir` rides `siteSees` all the way), airframe radar with drag 1e-4 and arm 0.4. `big: true` gives it a thick white trail (5 s puffs, `moveShot` combat.js:534) and a 1.5× model (render3d `syncCombat`).
  - Chaff (both kinds), notching, an island in the way and the ECM pod (which also makes SAMs lose their target now and then) beat it. The toast says "Radar SAM launch! Drop chaff, or fly low across it", or, when the craft has no flares or chaff left, "fly low across it, or put an island between you"; the warning reads RADAR MISSILE.
- **Fighters:**
  - `RAIDER` (combat.js:21) is a Falcon-like jet layout with a cannon and flares.
  - `spawnFighter` (combat.js:994) places one 12–16 km away and 1.5–2.5 km up, flying at 230 m/s.
  - At most 2 alive. Spawning repeats every 45 s (the first after 20 s, from `reset`) and needs the player airborne.
  - **`flyFighter`** (combat.js:1024):
    - engages within `16 km·(1−stealth)` using lead pursuit;
    - otherwise orbits `at(9000,0,2500)`;
    - ground avoidance takes priority;
    - bank-to-turn: roll the lift onto the target, then pull;
    - fires its gun when `d < 1100` and the aim is off by less than 0.05 rad;
    - drops countermeasures against a missile within 1.8 km, every 0.7 s, through `autoCM`: chaff (its Flares part's free cloud) against a radar missile, flares against a heat seeker. So the player's radar missiles now miss a bandit sometimes (§1.4).
  - Losing its control part calls `aiDown`. Fighters are removed when the mode is not hostile or the player leaves the range.
- **Kills:** `S.kills` counts kills where `by === F.active`.

The HUD (`drawHUD` combat.js:1197) draws target brackets, Bandit diamonds, the seeker circle and LOCK, a 600 m gun pipper and LEAD marker, the bombsight (`bombImpact` combat.js:1284), and the MISSILE or RADAR MISSILE warning.

**Countermeasures you can see** (PR #35; `cmFX(F, dt)` combat.js:1076, run from `frame`):
- A flare trails fire at a fixed 54 sparks a second (the old 60 Hz look) whatever the frame rate: an accumulator `f.fxN`, at most 6 a frame, spread back along the frame's path so a slow frame doesn't clump them. Before, it was about one per rendered frame, so a 120 Hz screen made twice as many.
- A chaff cloud bursts once, the first frame it exists (`f.shown`), in `chaffBurst` (:1090): 12 glints and 3 big soft grey puffs growing from 2 m to 14 m for a bundle, 8 and 2 (to 10 m) for the free cloud. The glints are `FX` kind `glint`, flashing for 3-5 s as they turn in the light (`FX.twinkle`). This replaced the faint grey smoke the free cloud trailed, about 18 puffs a second.
- Nothing is made for flares or clouds more than 3 km from `F.camAbs`.
- One `K` press of a Falcon now makes 447 particles at any frame rate (it was 500 at 60 Hz and 1024 at 120 Hz), and a cloud's overdraw-heavy smoke went from 74-178 puffs to 3.

---

### 2. net.js: transport

- **Constants:**
  - `NET_VERSION = 5` (net.js:11). Version 2 added part depth, paint and host (`att`) to spawn rows; version 3 sends big messages in pieces (below); version 4 (PR #35) has the Chaff Dispenser, a part an older peer would drop from spawn rows (so it would see, and shoot at, a different craft), and the chaff strength in `cm`; version 5 (PR #36) has the look-alike jets' 96 parts and 13 paints, which an older peer would drop (`hasOwn(PARTS, …)`) or show in a part's own colours (`cleanSkin`). The host rejects a `hello` with any other `ver` (net.js:171).
  - `NET_MAX_BYTES = 256 KB` (net.js:12): the host drops, without relaying, any client message whose `JSON.stringify` length is larger (net.js:188). The host's own sends and clients' sends are not size-checked.
  - Room codes are 5 characters from `ROOM_CHARS` (net.js:13; no I, O, 0 or 1). `cleanCode` accepts 4–8 characters.
  - `PEER_PREFIX = 'rss-room-'` (net.js:14).
  - **ICE servers** (`N.ice()`, a promise of `{iceServers}` that both Peers and the network test use): `NET_STUN` (Google and Cloudflare STUN), then the relays (TURN) for players with no direct path between them (strict NAT, carrier NAT on mobile data, Wi-Fi isolation, VPNs, school networks that block UDP). PeerJS's own default relays (`eu-0`/`us-0.turn.peerjs.com`) no longer exist, so without a relay such players can't connect at all. Relays come from `NET_TURN`, entries like `{urls: ['turn:host:80', 'turns:host:443?transport=tcp'], username, credential}`, and from `NET_TURN_URL`, a provider's credentials address answering with such a list (Metered: `https://APP.metered.live/api/v1/turn/credentials?apiKey=KEY`). That one is fetched once a session; each entry is checked (`stun:`/`turn:` URLs, string username and credential; at most 12), and a failed or empty fetch (4 s limit) is tried again on the next call while play goes on with STUN alone. The TCP/TLS entry on port 443 is what gets out of a network that blocks UDP. `NET_TURN` holds the game's own account: Metered's Open Relay (`global.relay.metered.ca`, UDP and TCP on 80 and 443, TLS on 443), free with a monthly allowance; one login for every player, so it is public by nature (it only relays game traffic, and Metered's dashboard can replace it). Chromium's WebRTC doesn't send TURN through an explicit HTTP proxy, so a network that only lets traffic out through one (like the test container) still can't reach the relay; one that filters transparently can. `N.host` and `N.join` wait for `N.ice()` before creating their Peer; `N.leave` bumps `joinGen`, so a room still waiting for its relays doesn't open after Back.
  - **`N.probe()`** (about 10 s): opens a throwaway Peer on the matchmaking server, and gathers ICE candidates from an `RTCPeerConnection` with the same servers. It returns `{server, direct, relay, relaySetUp}`: whether the server answered, whether a `srflx` candidate came (a STUN server answered over UDP), the protocols of the `relay` candidates (`relayProtocol`: udp, tcp or tls) and whether any relay is configured. `MPUI.testNetwork` (the **Test this network** button) turns it into three ✓/✗ rows and a verdict in a modal.
  - `NET_PIECE = 4000`: PeerJS's `json` channel refuses a message of 16300 bytes or more (`message-too-big`, nothing sent). `wire(conn)` sends a message whose JSON is longer than 4000 characters as pieces `{t:'~', k, i, n, s}`, and `unwire()` reassembles them per connection (at most `NET_MAX_BYTES` in all, 8 messages open at once; bad pieces are dropped). Every p2p send and receive goes through them; `N._t` exposes them (and `HOST_ONLY`) for the tests. One message is open per connection at a time (pieces never interleave on the ordered channel), so a link holds at most `NET_MAX_BYTES` of pieces; pieces that rebuild a piece are dropped, and the host closes a connection that sends pieces before its `hello`. A `message-too-big` error no longer drops a player or closes the room.
- **Transports** (`N.transport`):
  - `'p2p'`: PeerJS on the public PeerJS cloud. The host registers peer id `rss-room-CODE` and retries with a new code up to 3 times on `unavailable-id`. It reconnects to the signalling server 1.5 s after a disconnect. Connections are `{reliable: true, serialization: 'json'}`.
  - `'local'`: a `BroadcastChannel('rss-room-'+CODE)` carrying envelopes `{to:'H'|cid, from:cid, msg}`. Clients pick a random `cid`.
- **Star topology:**
  - The host is pid 1; clients get pid 2, 3, … from `accept()` (net.js:170).
  - `N.send(msg, to?)` (net.js:107) stamps `msg.f = N.me`. Clients send only to the host. The host's `route()` (net.js:115) forwards to `to`, or to everyone except the sender, and emits locally.
  - **The host overwrites `msg.f` with the real sender's pid** (net.js:189).
  - The host never relays client messages whose type is in `HOST_ONLY` = `{~, hello, welcome, reject, ping, closed, join, leave, warn, state, result}` (net.js:39). `~` (a piece) is there because a player's piece relayed whole would be taken by the others as part of the host's own stream, and so could fake anything from the host. Clients ignore those types unless `f === 1` (net.js:268). `result` is listed but never sent.
- **Handshake:**
  1. Client sends `hello {name, ver}`.
  2. Host replies `welcome {pid, code, names}` or `reject {reason}`: wrong version, room locked (`N.lock`, set during PvP phases), or full.
  3. The host emits a local `join`.
- **Limits:** `maxPlayers` is 5 for sandbox and 6 for PvP (mp.js:85). `MP.join` waits up to 8 s for the first `state` after the welcome.
- **Joining online, by stage** (`N.join`; `status(text)` reports each stage to `#mp-status` through `MP.join` and `MPUI`'s `go`):
  1. The Peer opens on the matchmaking server: 15 s, else "Couldn't reach the matchmaking server".
  2. `peer.connect` sends the OFFER. A wrong code, a destroyed host, or a host whose page hasn't run for over about 100 s (the server dropped its id; it takes it back within a couple of seconds of returning) answers `peer-unavailable` within about a second: "No room with that code right now…", which says the same code works once the host is back. Otherwise the room exists, and the client waits **up to 60 s** for the host's answer (the connection's signalling state reaching `stable`, or ICE leaving `new` through `iceStateChanged`), saying after 8 s that the host's game isn't answering. A phone host's page doesn't run while its screen is off or another app is open, but the server keeps its id for about 100 s and holds the OFFER in its socket, so this is the common case: the join goes through as soon as the host comes back.
  3. ICE: up to 20 s from the host's answer, or until ICE `failed`: "Found the host, but couldn't connect to their device" (no direct path and no relay). ICE can stay `new` for good when there's no usable candidate at all, which is why the answer, not ICE, starts this stage.
  4. The connection opens and `hello` goes out: 15 s for the `welcome` or `reject`.
  Before the welcome, a connection `close` fails the join at once. `N.leave` cancels a join under way (`pendingJoin`), so Back on the connect screen leaves nothing armed; `MPUI`'s `go` ends a session only for the attempt that is still current. While a join is looking for the host, the Join button reads **Cancel**, and Enter with a corrected code starts over.
- **Staying reachable:** `MP.awake` holds a screen Wake Lock while in a room (taken again when the game comes back on screen), and on a touch device the online host's lobby says, first thing in its card, to keep the game on screen while friends join (`MPUI.stayHint`). When the page becomes visible with the Peer disconnected from the server, net.js reconnects at once rather than waiting for the 1.5 s timer.
- **Pings and clock:**
  - Every 2 s the host sends `ping {ts, rtt}` to each link. The client replies `pong {ts}`, and the host stores `N.pings.set(pid, rtt)`.
  - The client estimates `hostOffset` as the median of the last 7 samples of `ts + rtt/2 − now`.
  - `N.hostNow()` = `performance.now() + hostOffset`. Use it for every shared deadline (`s.ends`, `th`, `battleAt`).
- **Timeouts:**
  - The host drops a link silent for 20 s.
  - A client closes after 25 s without hearing from the host (`watch` net.js:340).
  - `pagehide` calls `N.leave()`. Leaving sends `bye` (client) or `closed` to everyone (host), then destroys the connection after 300 ms.
- **Events:** `N.on(type, fn)` (net.js:46). Each handler runs inside try/catch (net.js:51), so a throwing handler only logs. `join`, `leave` and `warn` are emitted locally only.

---

### 3. mp.js: session, match, shared world

**Constants** (mp.js:13-28):
- `MP_FORMATS`: `1v1` (n 2), `2v2` (4), `3v3` (6), `ffa` (6, teams 0).
- `MP_DEFAULTS`: format 1v1, build 180 s, test on, polish 120 s, budget 75000, carriers on, friendly fire off, time of day `day`, limit 900 s.
- `MP_CARRIER`: bonus ×1.3, span 13 m, length 16 m, mass 12000 kg.
- `MP_KINDS_PVP`: plane, heli, car.
- Rates: snapshot 15 Hz, part states (`pv`) 200 ms, health (`hp`) 500 ms.
- `MP_MAX_PARTS = 600`.
- Team names: Faroes / Shetland.

**Session model:**
- The host's `MP.state` is the truth. `push()` (mp.js:258) sends the whole object as `state` and applies it locally. Clients deep-copy it in `applyState` (mp.js:274) and accept it only from `f===1` (mp.js:176).
- State shape:
  - `{mode, phase, ends, endsLen, round, result, settings, players[], feed[], t0, t0At, tod, battleAt, sides, format}`
  - each player: `{pid, name, team, ready, spawn, alive, kills, deaths, dmg, ping, kind, flying}`
- Clients change only their own row through `set {k, v}`, validated per key in `applySet` (mp.js:227). The allowed keys are `ready`, `spawn` (must be in `spawnsFor`), `kind`, `flying`, `team` (lobby only), `name` (≤18 characters) and `dmg` (clamped to 0..20000 per report).
- Only the host changes settings (`setSetting` mp.js:246, lobby only). Switching format re-deals teams: in FFA, `team = pid`.
- While in a room, `pushCareer`/`popCareer` (mp.js:135-154) swap out the player's career and saved blueprint, and `Builder.save` is suppressed (builder.js:357). `setMoney` turns the budget into career funds.

**Modes and phases:**
- `sandbox`: phase `free` for the whole session. Anyone can hurt anyone. Respawn is allowed (`respawn` mp.js:556). Everyone shares a clock: `sandboxTime()` = `t0 + elapsed host time`.
- `pvp` runs these phases, with timers set by `setPhase` (mp.js:335) and advanced from `tick()` (250 ms `setInterval`, so it keeps going in background tabs):
  1. `lobby` → `startMatch` (mp.js:326)
  2. `build` (`settings.build` s)
  3. `test` (60 s, solo flight, only if `settings.test`; with test off, build goes straight to battle)
  4. `polish` (`settings.polish` s, only after a test phase)
  5. `battle` (`settings.limit` s)
  6. `results` → `backToLobby` (mp.js:402)
- When everyone is ready in `build` or `polish`, `ends` is set to 3 s from now; it is restored if someone un-readies (`maybeAllReady` mp.js:347).
- **Win** (`checkWin` mp.js:381): the battle ends 3.5 s after at most one team (in FFA, team = pid) is still alive, unless only one side started (a solo try-out). On time (`finish` mp.js:390), the winner is the side with the most players still flying, then the most kills; otherwise it is a draw.
- `hostile(a, b)` (mp.js:74) decides who can hurt whom: enemies, or teammates with friendly fire on. `enemy(a, b)` (mp.js:79) decides what can be locked and tagged; teammates are never enemies.
- Silly flags are off throughout a PvP room, in every phase (`Silly.on` checks `MP.pvp`, util.js:143); sandbox rooms keep them. Time warp is disabled in every room (flight.js:202, flight.js:512), and the flight menu does not pause (`openMpMenu` flight.js:469).

**Budgets and limits:**
- `budgetFor` = `settings.budget`, ×1.3 at a carrier spawn (mp.js:428).
- `designProblems` (mp.js:446) reports:
  - more than 600 parts (any mode);
  - over budget;
  - a kind other than plane, heli or car;
  - for carriers: not a plane or heli, span over 13 m, length over 16 m, or mass over 12 t.
- `measure` (mp.js:435): span is the extent of `partZs` ± half-depth (twins ±`max(w,.6)/2`); length is the y extent; mass is the sum of `partKg`.
- `battleDesign` (mp.js:464) swaps a failing design for the first stock template (`mustang`, `camel`, `skylark`) that passes.
- These checks run **only on the owner's machine**. Peers never re-check budgets.
- The look-alike jets (PR #36) are priced against the lobby's money choices ($45k / $75k / $120k): every one fits $120k as it comes, the MyG-21 $45k and the FS-16 $75k (chapter 1 §5). Only the MyG-21 meets the carrier limits; the others weigh over 12 t (`mp-measure.json` holds each template's span, length, height and mass).

**Spawns:**
- `MP_SPAWNS` (mp.js:21):
  - `faroes`: team 0, the space-centre runway
  - `shetland`: team 1, airfield
  - `scotland`: FFA only (team −1), airfield
  - `carrierA` (west): team 0
  - `carrierB` (east): team 1
  - `carrierC` (south): FFA only
  - carriers appear only if `settings.carriers`.
- Airfield and carrier data: space.js:88-97.
- `spawnsFor` and `defaultSpawn` (mp.js:411-426): in FFA, the default is the base fewest players picked.
- `placement` (mp.js:571): the slot is the player's index among teammates at the same spawn, sorted by pid.
  - Sandbox: offset 220 m along the runway, or ±35 m steps at the helipad.
  - `airfieldPlacement` (mp.js:941): planes at the threshold, 230 m apart.
  - `carrierPlacement` (mp.js:948): two bow catapults at ±6 m, queue 40 m back; helis on the aft deck. `catapult: {length, speed: 78}` is armed for planes only (flight.js:56); press L to launch.

**Our craft → the others** (`sendSpawn` mp.js:591, `afterUpdate` mp.js:609):
- **Spawn rows** `[id, type, x, y, rot, flip, z, att, skin]`:
  - x, y and z are rounded to 3 decimals; z is `partZ(p)`, which is the positive spread for twins;
  - `att` is the host part's id, or 0;
  - `skin` is the paint id, or 0.
- **Snapshot `s`** at 15 Hz, sent whenever this player is in the shared world: `th` (host ms), `b` (body id), `P`, `V` (0.01 precision), `Q` (w,x,y,z), `W` (body-frame angular velocity), `C` (**centre of mass x, y, z**), `g` (gear up), `l` (landed).
- **`pv`** at 5 Hz, only changed rows plus everything every 2 s: `[id, deflect, firing, ab, retracted, sweep, aimYaw, aimEl, ammo, deployed, used, gunOn]`. Only parts with wing, thrust, weapon, chute or retractable wheels are sent. The receiver's `irSig` depends on `firing` and `ab`. Since PR #36 two existing fields carry more: `deployed` is a bay or gun door's opening (so a ghost's doors move and its `stealthOf` drops while they are open), and `deflect` a flat nozzle's swing. The Russian vectoring nozzles swing from the stick command, which isn't sent, so on a ghost they stay centred (chapter 7).
- **`hp`** every 500 ms when anything changed: `[id, percent]`.
- **`parts`**: the list of remaining ids whenever the part count changes.

**`mpSpawnRows(list)`** (mp.js:36) sanitises an incoming spawn:
- The whole spawn is rejected if `list` is not an array or has more than `MP_MAX_PARTS` rows.
- A row is dropped if its id is not a positive safe integer, is a duplicate, names an unknown `PARTS` type (`hasOwn`), or has non-finite x/y.
- x/y are clamped to ±500 and `rot` masked with `&3`. `flip` becomes 0/1, `z` goes through `cleanZ`, `skin` through `cleanSkin || 0`.
- `att` is kept only if it names an id seen in the same spawn, then `cleanAtt` breaks self-links and loops.
- Only clean rows are stored: `onSpawn` keeps `P.design = {kind, parts}` and never the raw message.

**Ghosts:**
- **`buildGhost`** (mp.js:706) creates parts with `makePart`, then **overwrites `p.id` with the owner's id**, so hits name the owner's parts. It builds a `Vessel` with `buildAdjacency` and sets `v.remote = pid`, `sas = 'off'`, full ammo and `hiddenUntilSnap`.
- **`onSnap`** (mp.js:744):
  - validates the message with `mpNums` (`C` may have 3 or 2 values) and `mpBody`, and requires `|Q| > 0.5`;
  - if no design is known yet, it asks the owner with `want`, at most every 3 s; the owner answers through `resendSpawn`.
- **`poseGhost`** (mp.js:753) dead-reckons to `age = clamp(hostNow − th, 0, 0.75 s)` along `V` and `W`:
  - it snaps on the first snapshot or when more than 60 m off, otherwise eases (`dt·10`, slerp `dt·14`);
  - **`C` is accepted only within `reach + 1` of `com0`**, the centre of mass when the ghost was built. A forged centre of mass would otherwise move the hit boxes away from the craft (`toWorld` subtracts `com`, vessel.js:326).
- A ghost silent for more than 6 s freezes in place (`beforeUpdate` mp.js:777).
- The radar warner (`rwr`) entries expire after 2.5 s.

**Hits and kills:**
- **The shooter is authoritative for hits**, judged against its own copy of the target ghost.
  - A projectile or blast reaching a remote craft calls `MP.sendHit`/`sendHits` (mp.js:845) → `hit {to, list: [[partId, dmg]], k}`, sent to that player only and only if the pair is `hostile`.
  - The shooter counts the damage toward its score: the host adds it directly; clients batch it as `set dmg` about once a second.
- **The victim applies the damage** (`onHit` mp.js:855):
  - requires `m.to === me` and a hostile sender;
  - at most 64 rows, each capped at 5000;
  - looks up part ids in **every** local non-AI vessel, because the part may have broken off into debris;
  - sets `lastHitBy` before applying damage.
- **The victim reports its own death** (`onLocalDestroyed` mp.js:649): `down {by, P}`, where `by` is the last hitter if the hit was within 20 s.
- The host's `recordDown` (mp.js:678) books deaths, kills and the kill feed (`feed`, 12 entries), then runs `checkWin`.
- Booms (`sendBoom`, blast ≥ 8) are for visuals only.

**Missiles and other fire:**
- The shooter flies the real missile with full guidance against the ghost. It announces it with `msl {id, b, P, V, D, tg, radar, glide, agm}`, then streams `mp` at 10 Hz and sends `mx` when it is gone (`syncMissiles` mp.js:900).
- Receivers fly a replica (`netMissile` combat.js:825): dmg 0, eased toward each update over 0.15 s (it jumps if more than 400 m off), and dropped 3 s after the last update. If `tg === me` and the shooter is hostile, the replica targets our craft, which drives our warning.
- Our flares and chaff travel as `cm {P, V, chaff}` (`sendFlares` mp.js:916), one message per flare or cloud; `chaff` is 0 for a flare, 1 for the free cloud that comes with flares, 2 for a dispenser bundle. On the shooter's machine they enter `S.flares` (`Combat.netFlares` combat.js:860, which takes `round(+chaff)` clamped to 0..2, NaN or an object as a flare), where its missile may be decoyed, and a lock may break (`chaffBreaks`). That is how countermeasures work across the network.
- Guns send only `gun {k: partType, on}`; receivers fire show rounds from the ghost (`netGuns` combat.js:501). Turrets use `gunOn` from `pv`.
- Rockets and bombs send `shot`, and receivers fly a dmg-0 copy (`netShot` combat.js:818). Copies have fixed blast sizes and do not burst into cluster bomblets.

**Leavers:**
- Net `leave` → `onLeave` (mp.js:214): explode and drop the ghost, delete the peer and its RWR entry. On the host it also removes the player row, adds a feed line, runs `checkWin` in battle or `maybeAllReady` in build/polish, and pushes.
- Peers missing from a new `state` are also dropped (mp.js:280).
- If the host leaves, the room closes (`closed`), and `MP.end` (mp.js:118) returns everyone home.

**Trust model:** peers are untrusted (mp.js:30). These are protected:
- the sender's identity, stamped by the host;
- host-only messages;
- the 256 KB relay cap;
- validation of every vector, body id, part type and id;
- clamps on damage and roster values;
- the centre-of-mass bound.

These rest on trust:
- hit amounts (cheatable up to the caps);
- kill credit, which the victim names;
- the self-reported damage score;
- each player's own state and budget.

Clients trust the host completely.

**Game messages** (handlers bound in `bind` mp.js:173-201):

| Type | Sender → receivers | Handler |
|---|---|---|
| `state` | host → all | `applyState` |
| `set` | client → host | `applySet` |
| `chat` | → all | `MPUI.chat` |
| `spawn` / `despawn` / `want` | owner ↔ | `onSpawn`, drop ghost, `resendSpawn` |
| `s` / `pv` / `parts` / `hp` | owner → all | `onSnap`, `onPartVis`, `onParts`, `onHp` |
| `down` | victim → all | `onDown` (mp.js:830) |
| `hit` | shooter → victim | `onHit` |
| `boom` | shooter → all | `onBoom` → `Combat.netBoom` |
| `gun` / `shot` / `cm` | owner → all | `P.gun`, `Combat.netShot`, `Combat.netFlares` |
| `msl` / `mp` / `mx` | owner → all | `onMissile`, `netMissileUpdate`, `netMissileEnd` |
| `lock` | locker → target | `MP.rwr` |

---

### 4. mpui.js: screens

- **Connect** (`#mp-connect`; `open` mpui.js:9, `bind` mpui.js:15):
  - name is stored in `rss.mp.name` (18 characters max);
  - transport toggle `#mp-transport` (`data-tr="p2p"` / `"local"`), stored in `rss.mp.tr`;
  - Create sandbox / Create battle / Join; only one attempt at a time (`this.connecting` token);
  - **Test this network** `#mp-test` → `testNetwork` (`Net.probe`): matchmaking server, direct links, relay, and a verdict.
- **Lobby** (`refresh` mpui.js:145):
  - `renderPlayers` (mpui.js:156): team columns with Join buttons and open slots, ping, host tag;
  - `renderSettings` (mpui.js:190): editable by the host in the lobby only — format, money $45k/$75k/$120k, build 2/3/5 min, test flight, carriers, friendly fire (not FFA), time of day, limit 10/15/25 min;
  - `start` (mpui.js:123): asks before starting alone or with uneven teams; refuses if a team is empty.
- **Phase bar** `#mp-bar` (`renderBar` mpui.js:251, `tick` mpui.js:270):
  - phase name, timer from `s.ends − Net.hostNow()`, "urgent" under 15 s;
  - an info line: cost against budget, spawn and ready count while building; teams alive in battle;
  - Ready, Spawn and Score buttons.
- **Spawn map** `#spawn-map` (mpui.js:296-410):
  - `MAP` bounds e −9000..31000, z −9000..21000;
  - `bakeMap` colours the map from Terrain;
  - `pickSpawn` (mpui.js:387) updates `Builder.mp` budget, limits and money.
- **Chat:** lobby log, plus in flight `T`/`Enter` → `#mp-hud-input`. Text is inserted with `createTextNode`. Sends are capped at 140 characters.
- **Kill feed:** `notice` (mpui.js:422) → `#mp-feed`, 5 lines, fading after 5 s.
- **Scoreboard:** hold `` ` `` or press Score (`showScore` mpui.js:447).
- **Results:** a locked modal (`MP.modalLocked`, main.js:20). The host gets "Back to the lobby".
- **In flight** (`drawHUD` mpui.js:495):
  - name tags: gold in the sandbox, blue (filled) for friends, red (outlined) for enemies;
  - `spotted` (mpui.js:545): enemies show within `6 km·(1−0.5·stealth)`, or on our own radar within 60° of the nose;
  - RWR ring with a "RADAR LOCK" label;
  - heading-up 8 km scope (`drawRadar` mpui.js:557), only when the screen is at least 761 px wide.
- **Spectating** after being shot down in battle: `spectate` (mpui.js:487) cycles ghosts, teammates first, with `[`/`]`, or with a tap on touch (flight.js:1174). The camera uses `Flight.viewVessel` (flight.js:1453).
- On the map and globe, enemies are hidden in PvP (`mapColor` mp.js:930).

---

### 5. Testing locally

1. Serve the repo over HTTP; there is no build step: `python3 -m http.server 8080` in the repo root. Open `http://localhost:8080/` in **two windows of the same browser profile**. BroadcastChannel needs the same origin and profile, so a private window cannot join a normal one.
2. Keep both windows visible side by side. A hidden tab throttles requestAnimationFrame, so it stops sending snapshots and its ghost freezes after 6 s.
3. In both windows: Home → Multiplayer, give different names, and choose **This device**. Window A creates a sandbox or battle. Window B types the code shown in `#mp-code` and joins.
4. **Sandbox:** Enter the hangar → Fly.
   **Battle:** the host presses Start, both players pick spawns and press Ready. The phase ends 3 s after everyone is ready. A host alone can "Start anyway"; with a single side, `checkWin` never ends the battle early.
5. Useful console commands:
   - `MP.advance()` on the host skips to the next phase;
   - also handy: `MP.state`, `MP.peers`, `Net.pings`, `Net.bytesIn` / `Net.bytesOut`, `Combat.S`.
6. Test **Online** at least once before shipping a protocol change. PeerJS uses JSON, which turns `NaN`/`Infinity` into `null` and drops `undefined`; BroadcastChannel uses structured clone and does not. Online play needs internet access to the PeerJS cloud.

### 6. Invariants and gotchas

- **Bump `NET_VERSION`** whenever a peer on the old code would build, pose or hit a different craft. That covers:
  - the spawn row layout or meaning;
  - snapshot fields;
  - part geometry or ids in parts.js (`w`, `h`, `twinZ`, `depth`, `partZ`/`partZs`/`partRect`, `cleanZ`);
  - a new part: an older peer drops the unknown type from spawn rows (`hasOwn(PARTS, …)`), so it builds a different craft (version 4, the Chaff Dispenser; version 5, the look-alike jets' parts);
  - a new paint: an older peer's `cleanSkin` turns it into the part's own colours (version 5, the jets' camouflage);
  - the meaning of message fields.
- **Validate everything from peers.** Use `mpNums`, `mpBody`, `vec`, `hasOwn(PARTS, …)`, clamps and slices, and look up ids through Maps. Never put a peer string into `innerHTML` (`UI.modal` renders a string `body` as HTML; toasts and `el({text})` are safe).
  - Keep `mpSpawnRows` in step with `partsFromDesign`, `cleanAtt` and `cleanSkin` (parts.js:1227-1255, parts.js:1515).
  - Known gap: `onDown` reads `m.P` unchecked (mp.js:834). A malformed message throws inside the handler (caught), which skips the ghost drop and `recordDown`.
- **New host-only message types** go in `HOST_ONLY`, and their handler should also check `m.f === 1`.
- **Damage authority:**
  - `Combat.damage` must stay a no-op for `v.remote`.
  - Any new damage source must route remote victims through `explode()`/`MP.sendHits` with a `by` the local player owns. Otherwise it deals nothing, or double-counts.
  - Never renumber parts of a flying craft: hit messages and `pv`/`hp`/`parts` all use the owner's part ids.
- **Centre of mass:** snapshots must carry the centre-of-mass z (`C[2]`), or asymmetric craft get offset hit boxes. Keep the `com0`/reach bound.
- **Store order:** `nextSide` parity must match the store visibility in parts3d.js:1784. `weapon.ammo` counts both copies of a pair, and `destroyPart`'s store-blast logic depends on that.
- **Wall-clock rates:** snapshot and state rates use `performance.now()`. Shared deadlines use `Net.hostNow()`. Simulation time is per-peer, and time warp is forced off.
- **Combat state is a module singleton.** `Combat.reset` must run on every new flight and on `MP.leaveFlight`.
- **AI is off in rooms.** Range targets, SAMs (the frigate's radar SAM too), fighters and auto countermeasures are off in any room via `mpOn()`. Torpedoes and ARMs therefore have nothing to hit in multiplayer.

## 5. App shell, UI, settings, packaging and deployment

Scope: `index.html`, `css/style.css`, `js/main.js`, `js/ui.js`, `js/util.js`, `js/audio.js`, `sw.js`, `manifest.webmanifest`, `tools/build-single.mjs`, `tools/bake-earth.py`, `.github/workflows/pages.yml`, `README.md`, `.gitignore`. The git remote is `DevWolf11/Overbuilt` (renamed from `Cam-Strike`, then `Rocket-Science-Simulator`). A local folder may still be called `Cam-Strike` because the repo used to hold a 5v5 FPS, and that history is still in git (README.md:145, last FPS commit `30e7bc8`). Work goes onto branches and reaches `main` through PRs; merging deploys.

### 1. Page structure, script order, global namespace

**DOM skeleton (index.html):**
- Two full-screen canvases: `#view3d` (WebGL/three.js, :21) sits under `#view` (2D, :22). DOM order sets the stacking; there is no z-index.
  - `#view` draws the whole game in 2D fallback mode and the hangar blueprint.
  - In 3D it carries only the HUD overlays, and is cleared only when something was drawn on it (`App.ink`, `App.clear2D`, main.js:141).
- Four screen containers, all `class="ui"`: `#home` (:25), `#mp-ui` (:58), `#build-ui` (:117), `#flight-ui` (:202).
- Multiplayer overlays sit at body level (:301-328) so they survive scene switches: `#mp-bar`, `#mp-feed`, `#mp-score`, `#mp-hud-chat`, `#spawn-map`.
- `#toasts` (:330) is the toast host.
- `#modal > #modal-card` (:331) is the one and only dialog.
- Fonts: Chakra Petch and IBM Plex Mono from Google Fonts (:15-17). The viewport meta sets `user-scalable=no, viewport-fit=cover` (:5).

**Load order** (classic synchronous `<script src>` at the end of `<body>`, index.html:333-353). Each file may use only earlier files at load time.

| # | File | Globals it creates (top-level `const`/`function`) |
|---|---|---|
| 1 | util.js | `TAU G0 clamp lerp smoothstep wrapAngle v3 dot3 cross3 len3 norm3 quat qmul qnorm qconj qaxis qrot qunrot qbasis qslerp surfaceFrame mulberry32 mixColor hexToRgb fmt store Silly effectMach $ el isTouch` |
| 2 | space.js | bodies (`SUN`…`EUROPA`, `BODIES`, `BODY_BY_ID`), orbit math, `airDensity`, `deltaVChart` … |
| 3 | terrain.js | `Terrain` (IIFE; its internals are not global) |
| 4 | parts.js | `PARTS TIERS PART_CATEGORIES VEHICLE_KINDS SKINS`, design/drawing helpers; since PR #36 also the outline and clash helpers (`pathRecorder PART_PROFILE LATHE_SHAPES PART_RECIPE shapesClash …`) and the jets' `us5…`, `ru…`, `us4…` and `camo…` names |
| 5 | vessel.js | `Vessel SAS_MODES soundSpeed …` |
| 6 | ui.js | `UI ICONS icon` |
| 7 | world.js | **`Settings`** (world.js:5-11), `FX World rgba hash1 …` |
| 8-9 | parts3d.js, render3d.js | `Parts3D`, `Render3D` (IIFEs that touch `THREE` only after `init()`) |
| 10 | audio.js | `Sound` |
| 11 | career.js | `MISSIONS Career money` (calls `Career.load()` at load time, career.js:77) |
| 12-16 | map, globe, combat, builder, flight | `MapView GlobeView Combat Builder TEMPLATES Flight WARPS haptic …` |
| 17 | vendor/peer.min.js | `Peer` (PeerJS 1.5.4) |
| 18-20 | net, mp, mpui | `Net`, `MP` + `MP_*` constants, `MPUI` |
| 21 | main.js | `App EARTH_MAP_FILES`; `DOMContentLoaded → App.init()` (:397); service-worker registration (:399-408) |

**three.js is not in index.html.** `Render3D.load()` injects `<script src="js/vendor/three.min.js">` on demand (render3d.js:3296-3310). If `window.THREE` already exists it skips the injection, and the single-file build relies on that.

**Conventions:**
- Every file starts with `'use strict';` and a header comment.
- Modules are either object-literal singletons (`const App = {…}`) or IIFEs that return an API object.
- Top-level `const`s from all classic scripts share one global lexical scope but are **not** `window` properties (`window.App` is `undefined`). The only real window flag is `window.RSS_NO_SW`.
- Forward references go inside functions, guarded where they can run early:
  - `typeof MP` in `Silly.on` (util.js:143) and `Builder.save` (builder.js:357)
  - `typeof Builder` in `App.resize` (main.js:42)
- Code that runs at load time: `Silly.flags` (util.js:142), `Settings.data` (world.js:7), `Career.load()`, `isTouch` (util.js:165), the audio-unlock listeners (audio.js:151) and `Sound`'s `visibilitychange` listener (audio.js:152).

**Why plain scripts:** the game must run when `index.html` is opened from disk (README.md:141). From `file://`:
- `type="module"` scripts and `fetch()` of local files are blocked.
- Plain and injected `<script src>` tags still work, so three.js loads.
- Only the Earth map fails. `Terrain.loadEarth` (terrain.js:180-199) catches the error, sets `earthMap.state = 'failed'` and uses generated terrain. `App.afterEarth` (main.js:304-309) waits only while the state is `'loading'`.

### 2. main.js: the `App` shell

**`init()` (main.js:7-33):**
1. Starts the Earth-map download (`Terrain.loadEarth(EARTH_MAP_FILES)`) and sizes the canvas.
2. Prepends an SVG icon to every `[data-icon]` element (:13).
3. `Builder.init`, `Flight.init`, `init3D`, `bindHome`.
4. Dialog dismissal: a tap on the backdrop or Escape closes the dialog (:19-22). The Escape listener runs in the capture phase and stops propagation. Both are blocked while `Flight.ended || MP.modalLocked`.
5. Blocks iOS `gesturestart`.
6. Calls `Flight.save()` on `visibilitychange`→hidden and on `pagehide` (:24-27), because phones kill background tabs without warning.
7. `watchInput()` (:28; see **Main loop**).
8. Starts the rAF loop and calls `toHome()`.

**`resize()`** (:35-44): caps DPR at 2 and sets the 2D canvas's backing size. Render3D keeps its own pixel ratio (render3d.js:3039). Resizing wipes the canvas, so it also sets `ink = false` and `dirty` (:43).

**Scenes:** `App.scene ∈ 'home' | 'build' | 'flight' | 'mp'`. `showScene(name)` (:193-203) toggles `hidden` on the four containers, toggles `body.flying` in flight (:199; the HUD panels lose their blur, §4) and calls `MPUI.renderBar()`. The map is **not** a scene: it is `Flight.mapMode` (`toggleMap`, flight.js:1137; key M), which toggles `body.mapping` (flight.js:1141; `resetState` clears it, flight.js:97) so the map keeps the blur. Inside it, `GlobeView` (3D globe, needs WebGL) and `MapView` (flat solar system) swap via `#btn-mapview` or N (flight.js:1149-1160). The pause menu is `Flight.openMenu` (flight.js:451), and in multiplayer `openMpMenu`.

| Transition | Code | Notes |
|---|---|---|
| → home | `toHome()` :228-244 | Saves and stops a flight. If `MP.active` it calls `MP.end()`, which comes back here. With no `Career.mode` yet, it shows the Career/Sandbox picker (`#home-modes`). Fills the Resume button from `rss.flight`. |
| → build | `toBuild()` :262-268 | Leaves the flight (MP: `MP.leaveFlight()`), rebuilds the palette, fits the view |
| build → flight | `launch()` :270-293 | Needs a control part. In a room it calls `MP.launch()`. Checks locked parts and funds, confirms before replacing a saved flight, waits for Earth, clears `rss.flight`, calls `Flight.start(Builder.serialize())`, shows a launch-tip toast if hints are on |
| home → flight | `resumeFlight()` :295-302 | `Flight.restore(saved)`. If that throws it drops the save and goes to build |
| → mp | `showMP()` :205-208 | Called by `MPUI.open()` (mpui.js:9) and by `MP` |

The **home background** (`renderHome`, :251-259) is the 2D solar-system map running at 40 000× time. It sits right of the title on wide screens and above it in portrait.

**Main loop** `frame(t)` (:52-116). Since PR #35 (battery) a frame does only the work that can change what is on screen:
- **Frame cap** (:54-58): `Settings.fps` is 60 or 0 (unlimited); the default is 60 on touch devices (`isTouch`) and 0 on desktop. A frame that comes more than 2 ms before `App.due` is skipped outright, and `due = t + cap − clamp(t − due, 0, cap)` keeps the average at 60 a second: a 120 Hz screen works exactly every other frame, a 90 Hz one two frames in three, and a 60 Hz screen loses none. Physics uses the real time since the last frame worked, so nothing flies differently.
- `dt` is capped at 0.1 s (:59); `Flight.update` caps it again at 0.05.
- **Input:** `watchInput()` (:131-138) adds capture-phase, passive listeners for pointer, wheel, key, touch, `input`, `change` and `click` events that set `App.poked` (a mouse passing over with no button pressed doesn't count; the 3D hangar's hover highlight asks for its own redraw). The next frame turns that into `dirty` and `busyUntil = t + 1 s` (:61). Coming back on screen and a font load (`document.fonts` `loadingdone`, for the blueprint's labels) ask for a redraw too. `App.modals` holds `#modal` and `#spawn-map`: either one open is a dialog (:64).
- **Stale views:** `stale(view, t)` (:119-122) is true when a redraw was asked for (`App.dirty`: `App.redraw()` :125, `resize`, input), when the view (`build2d`, `build3d`, `flight2d`, `flight3d`, `globe`, `home`) is not the one drawn last, or when nothing was drawn for `App.heartbeat` (500 ms, :126), the safety net. `drew(t, gap)` (:124) clears `App.dirty` and `Builder.dirty` and sets `App.next`, when a slow view is next due (averaged the same way as the cap). `App.lag` adds up the time of the frames not drawn and hands it to the next draw as its `dt`.
- **build** (:65-80): the 2D blueprint is drawn only when stale or `Builder.dirty` (chapter 1 §7). The 3D view calls `Render3D.renderBuilder(Builder, lag, force)`, with `force` when stale or within a second of input, and it draws only while something in it moves (chapter 3 §2). Under a dialog it is asked 10 times a second (the turntable keeps turning).
- **flight** (:81-106): `Flight.update(dt)` every frame (the world runs at full rate, also under a multiplayer dialog). Then, at most 10 times a second while `calm` (paused, or a dialog open, :88), otherwise every frame, one of:
  - the globe (`GlobeView.render`)
  - 3D (`Render3D.renderFlight(Flight, d, calm || d !== dt)`, then clear the 2D canvas and draw `World.drawOverlay3D`, `Combat.drawHUD`, `MPUI.drawHUD` on it)
  - `Flight.render` (2D fallback)
- **otherwise**, home and the multiplayer screens (:107-111): `renderHome` 30 times a second, 10 under a dialog.
- `clear2D()` (:141) clears the 2D canvas only if something was drawn on it since the last clear (`App.ink`).
- Hides `#view3d` when nothing is 3D.
- On the perf harness (desktop, per 60 Hz frame) the idle 2D hangar went from 1.12 to 0.05 ms of JS, the still 3D hangar from 72 draw calls to 2.3, the home screen from 621 canvas operations to 311, and (on a phone) a paused flight from 190 draw calls to 38.
- `test/browser/redraw.mjs` checks the redraws, and on synthetic frame times the cap and the 30 and 10 fps rates.
- The body is wrapped in `try/catch` that only `console.error`s, so a bug repeats every frame without stopping the loop.

**3D/2D:**
- `use3D()` (:146-153) is false when WebGL is unsupported, three failed, or `Render3D` isn't ready. In flight the Silly `retro2d` flag also forces it false. The first failure in flight toasts once.
- The hangar is 2D by default. `preview3D()` = `Settings.build3d && use3D()`.
- The `.view3d-toggle` button (`#btn-3d-build`, hidden without WebGL) and V in the builder (builder.js:1771) call `setPreview3D`.
- `sync3D()` (:174-191) updates aria/title, shows `#build-3d-hint`, which fades after 9 s (text differs for touch), and hides the 2D-only Grid button.

**Menus (all `UI.modal`):**

| Menu | Location | Contents |
|---|---|---|
| `showHelp()` | :312-329 | Static `<ol class="howto">` plus `Flight.controlsHelp()` (flight.js:481, also the pause-menu body). Opens automatically once after the first mode pick (`rss.seenHelp`, :224). |
| `showResearch()` | :331-352 | Tiers; the buy button calls `Career.buyTier()` |
| `showMissions()` | :354-368 | Missions grouped by body |
| `showDeltaV()` | :370-388 | Table from `deltaVChart()` |
| `showSettings()` | :390-441 | Settings below |

**Settings.** The `Settings` object lives in **world.js:5-11**: one JSON blob in `rss.settings`. Defaults (world.js:7): `{quality:'high', hints:true, volume:0.8, markers:true, build3d:false, targets:'practice', fps: isTouch ? 60 : 0}`. Read with `Settings.get(k)`; `Settings.high` means `quality !== 'low'`.

| Control (main.js) | Key | Consumers |
|---|---|---|
| Volume range 0-1 step 0.05 (:393) | `volume` | `Sound.applyVolume` (audio.js:62) |
| Graphics select (:395) | `quality` | `Settings.high` throughout render3d/world/flight. Render3D's `applyQuality()` (render3d.js:3040) re-applies it live (shadows, patches, scenery, pixel ratio). |
| Frame rate select (:399-402) | `fps`: 60 ("saves battery, runs cooler") or 0 (unlimited) | the frame cap in `App.frame` (main.js:54) |
| Targets select (:407) | `targets` `practice`/`hostile`/`off` | combat.js:27 (forced `off` in multiplayer) |
| Flight hints checkbox (:403) | `hints` | `Flight.hint()` (flight.js:1215), launch tip (main.js:282) |
| Prograde markers checkbox (:405) | `markers` | world.js:803, :823 |
| (3D button / V, not in the dialog) | `build3d` | `App.preview3D` |
| Toggle fullscreen (:412) | none | Fullscreen API; toasts if unavailable |
| Reset career progress (:419) | none | Two taps (`dataset.armed`). Then `Career.reset()` (keeps the mode), clears `rss.flight`, rebuilds the palette, `toHome()` |

**Secret "silly" settings** (`Silly`, util.js:130-149):
- **Unlock:** tap the Options dialog title **7 times** (main.js:428-440). Counting toasts appear from the third tap. The unlock sets `rss.sillyUnlocked=true`, plays `Sound.boom(0.6)` and toasts.
- `.modal-title` is `user-select:none` (style.css:633) so the taps don't select text.
- Once unlocked, Settings always shows the `sillySettings()` box (:443-459): one checkbox per entry plus "All off".
- Flags are stored in `rss.silly` as `{key: bool}`.
- `Silly.on(k)` is always false in a PvP room, in every phase from lobby to results (`MP.pvp`); sandbox rooms keep the flags.
- `Flight.start` toasts the list of active flags (flight.js:102-103).

| Flag | Label | Effect, where |
|---|---|---|
| `ghostCam` | Crash cam classic (the old camera bug) | After a crash the camera freezes in space while the planet flies on (flight.js:1456). The crash dialog waits 5 s instead of 1.6 s (flight.js:409). |
| `retro2d` | Retro 2D flight | `use3D()` is false in flight (main.js:147) |
| `ogAutopilot` | Vintage autopilot | Old porpoising plane autopilot (vessel.js:588) |
| `noodle` | Noodle wings | Wings tear off at ¼ load and half their speed limit (vessel.js:761) |
| `bouncy` | Bouncy castle | No ground breakage, restitution 0.75 (vessel.js:967-970) |
| `drunk` | Wobbly pilot | The stick drifts in waves (flight.js:596) |
| `hollywood` | Hollywood | Explosions ×3 (world.js:58); stage separations explode (flight.js:354) |
| `boomy` | Sonic boom at 90 km/h | `effectMach()` uses speed/25 m/s (util.js:149), for effects only; missions still read `v.mach` |

**Service-worker hook** (main.js:470-479):
- Registers `sw.js` with `updateViaCache:'none'`, **only when `location.protocol === 'https:'`** and `!window.RSS_NO_SW`.
- On `controllerchange`, and only if a controller already existed (an update, not the first install), it reloads the page. If a flight or MP session is active it toasts "A new version is ready…" instead.

`EARTH_MAP_FILES` (:463-466) lists the eight Earth asset URLs as single-quoted literals. The bundler rewrites them (§7).

### 3. ui.js, util.js, audio.js

**`UI` (ui.js):**
- `UI.modal({title, kicker, body, actions, onClose})` (:5-28):
  - A string `body` goes in via **innerHTML**, so only static or trusted markup; a Node is appended.
  - Actions are `{label, primary, danger, keepOpen, onClick}`. A click runs `closeModal()` first, then `onClick`, so `onClick` may open another modal. `keepOpen` skips the close.
  - Focuses the primary button on non-touch devices.
  - There is **one modal at a time**: a new call replaces the content and silently drops the previous `onClose`.
- `UI.closeModal()` hides the dialog and runs `onClose`. `UI.modalOpen` is a getter.
- `UI.toast(text, kind)` (:36-46):
  - Removes an identical toast, keeps at most 4.
  - Fades at 2.6 s and is removed at 3.1 s; `'achievement'` toasts last 3.8 s / 4.3 s.
  - Kinds used: `'achievement'` (amber, "Milestone ·" prefix, style.css:286), `'kill'` (red, :746), `'warn'`.
  - `'warn'` has **no own rule**: it picks up the generic `.warn` (style.css:117: amber left border, 12px).
  - `Flight.toast` wraps it (flight.js:190).
- `ICONS` (:50-85): 24×24 stroke SVGs drawn in `currentColor`. `icon(name)` returns `<span class="icon">`. Markup gets icons through `data-icon="name"` (prepended once in `App.init`). Elements created later call `icon()` themselves (e.g. builder.js:1568).

**util.js:**
- Math: `clamp lerp smoothstep wrapAngle`.
- Vectors are plain `{x,y,z}`; quaternions are `{w,x,y,z}` with optional `o` out-params (`qrot`, `qbasis`, `qslerp`…, :16-63). `surfaceFrame` gives up/east/north. `mulberry32` is a seeded RNG. `hexToRgb` is cached.
- `fmt` (:85-114): `dist` (m/km/Gm), `speed`, `clock` (`[Nd ]hh:mm:ss`), `duration`, `mass` (t), all en-US. `money()` lives in career.js:79.
- `store` (:116-128): JSON in localStorage inside try/catch.
  - `get(key, fallback)` also reads the legacy `orbitforge.<rest>` key for `rss.*` keys (from before the rename).
  - `set` returns `false` when storage is full or unavailable; builder.js:1447 checks this.
- `$` (:152) is `document.querySelector` and returns **one element**; there is no `$$`, use `document.querySelectorAll`.
- `el(tag, attrs, ...kids)` (:153-163): `class` sets className, `text` sets textContent, `on*` adds a listener, anything else goes through `setAttribute`. So set `.checked`/`.disabled` as properties after creating the element. Null children are skipped.
- `isTouch = matchMedia('(pointer: coarse)')`, evaluated once at load.

**`Sound` (audio.js):** fully procedural; there are no audio files.
- `unlock()` (:8) creates the AudioContext on the first `pointerdown`/`keydown` (:151), because browsers need a gesture. Later gestures call `settle()` instead of always resuming.
- Graph: a master gain set to `Settings.volume` (`applyVolume`) is fed by two looping 2 s brown-noise beds (:24-34):
  - engine: lowpass 300 Hz
  - wind: bandpass 700 Hz
  - Flight drives their gain and cutoff each frame through `engine(level, air)` (:74) and `wind(k)` (:80). Both go through `glide()` (:68), which skips `setTargetAtTime` when the target moved less than 1e-3 (gain) or 0.5 Hz (filter), since they are mostly set to what they already were.
- One-shots:
  - `burst(dur, freq, vol, type)`: filtered noise with an exponential decay. Wrapped by `ignite separate explode click gun(big) missile hit`.
  - `tone` (sine; seeker growl and lock), `beep` (square; warnings)
  - `boom` (a synthesised N-wave: two cracks 0.13 s apart, then a rumble)
  - `chime` (660/880/1320 Hz triangle arpeggio)
- Every method is a no-op until `ctx` exists.
- **Sleep** (PR #35): the context runs only while something needs it, so a phone's audio hardware can sleep.
  - `setLive(on)` (:40): a flight wants the engine and wind loops (`Flight.syncAwake`: running, not paused, not ended).
  - `oneOff(dur)` (:41): every one-off sound (`burst`, `tone`, `beep`, `boom`, `chime`) keeps the context up until 3 s after it ends, so a click in the hangar wakes it and it dozes off again.
  - `settle()` (:42) resumes the context when it is wanted (and the page is visible), else suspends it 1 s later (0.1 s when hidden), once the loops have faded.
  - `onVisibility()` (:57, from a `visibilitychange` listener, :152) fades the master gain out when the page is hidden and back in when it shows. Before PR #35 a flight left in the background kept the engine roaring at whatever level it was at.
  - So it sleeps on the home screen, in the hangar, in the multiplayer screens, while a flight is paused, on the end-of-flight screens and in the background.

### 4. style.css: theming and responsive layout

**Theming:**
- Dark only (`color-scheme: dark`, no light theme). Tokens on `:root` (:3-25):
  - colours: `--space --panel --panel-solid --line --line-strong --text --muted --amber --amber-deep --cyan --danger --good`
  - fonts: `--display` (Chakra Petch), `--mono` (IBM Plex Mono)
  - safe-area insets `--safe-t/b/l/r` and gutters `--gut-l/r = max(12px, inset)`
- Colour roles:
  - amber: primary actions, selected/pressed state, focus ring
  - cyan: encounter path, MP team 0
  - danger red: MP team 1
  - lime `#b9ff78`: active autopilot and pill toggles
- Text style: labels are uppercase and letter-spaced; numbers use `--mono` with `tabular-nums`.
- Canvas colours are set in JS, not through these tokens.
- Building blocks: `.btn` (+`.primary .danger .small .icon-only .toggle[aria-pressed]`), `.panel` (blurred glass, except over the moving flight view: below), `.round` (touch buttons), `.pill`, `.kind-select/.kind-btn[aria-checked]` (segmented control).
- Layout plumbing:
  - `.ui` is `pointer-events:none` and `.ui > *` gets `auto` (:41-42). Only **direct children** of a screen take input; everything else passes through to the canvas.
  - `[hidden]{display:none !important}` (:36): show elements by removing the attribute, never with CSS.
- **No blur over the flight view** (PR #35; :257-264): `body.flying:not(.mapping) :is(.btn, .panel, .round, .stage-box, .sas, .joy, .pill)` drops `backdrop-filter` and makes `--panel` a touch more opaque (0.85 alpha for 0.82). A backdrop blur over a 3D view that changes every frame is worked out again every frame, a big share of a phone's GPU time. Side by side the panels look the same (4-5 levels of 255 darker; 15 % of the view shows through instead of 18 %, so sharp moving edges show a little fainter). Screens that hold still keep the blur: home, hangar, dialogs, and the map (`body.mapping`, whose fine labels the blur hides). `App.showScene` sets `body.flying` and `Flight.toggleMap` `body.mapping` (§2).
- The fuel bar (`.fuel-fill`, :244; flight.js:1414) and the battle timer bar (`.mp-bar-fill`, :843; mpui.js:277) move by `transform: scaleX` with `transform-origin: 0 50%`, not by width, so they cost no layout per frame.
- z-index: sel-box 5, mp-feed/hud-chat 18, flight-alert/mp-bar 19, toasts 20, mp-score 25, modal 30.
- The file is **append-only by feature**: base sections (:44-393), then "v2 additions" (:395), then per-feature blocks (home, builder, settings, flight, 3D stick, planes, silly :624-633, saved designs, globe, weapons, multiplayer :748). Each block carries its own `@media` overrides, and later rules win. Put new feature CSS in a new section at the end with its own breakpoints.

**Breakpoints:**

| Query | Main effects |
|---|---|
| `max-width:760px`, the phone breakpoint, repeated per section (:338, 523, 562, 595, 654, 677, 725, 745, 902) | Builder `.stats` becomes a wrapping strip across the top (4-column stat grid, stage list hidden). `.part-info` docks above the tray (`bottom: var(--pal-h)+10px`) without its description. `.long` button labels hidden. Telemetry 176 px; time warp moves under the top-right buttons; autopilot grid 3 columns; flight hint moves top-right; the brake button floats beside the autopilot grid (:562-567); home content bottom-aligned; MP bar and feed pushed down, with `body:has(#mp-bar…)` moving stats, hint and feed (:910-913) |
| `max-width:480px` / `420px` / `350px` (:659, 335, 668) | Hangar, 3D and Sym become icon-only; Clear hidden; smaller Launch and buttons |
| `max-height:500px`, phones in landscape (:370, 535, 569, 599, 681) | Compact telemetry; smaller joystick (92 px) and round buttons; the throttle box turns horizontal at the bottom, left of the stage box; slimmer tray (34 px icons, no specs); hint at top centre |
| `max-width:860px` (:895) | MP lobby grid in one column; spawn map stacked |
| `max-width:1000px` (:332); `761-1000px` (:915) | Brand name hidden; MP build bar moved right of the stats panel |
| `pointer:fine` (:744) · `prefers-reduced-motion` (:390) | Smaller FIRE button for a mouse · no toast or fuel-bar animation |

**Touch controls** are always rendered, on desktop too:
- joystick `#joy` (:575, 116/104/92 px), roll ⟲⟳ `.small-round`, Brake
- autopilot `.sas` (6 columns; `.sas.plane` 4)
- vertical throttle `.throttle-track` (role=slider)
- stage box, weapon box (FIRE, CM), catapult
- Canvases and drag controls use `touch-action:none`; buttons use `manipulation`.

**Builder panel on phones:**
- The tray `.items` is `touch-action:pan-x` (:160): a sideways swipe scrolls it, an upward drag picks up a part (builder.js:1134).
- The tray's tabs by kind (PR #36, chapter 1 §7): `.tab.extra` (:158) dims another kind's tabs under More, `.tab.more` (:159) sets the More/Fewer tab apart and is `position: sticky; right: 0` with a solid background, so More stays in sight at the end of the tab strip on a phone in portrait, and `.tray-group` (:162) is the vertical label before each look-alike jet's parts. `.part-name` (:172) wraps to two lines at most (`line-clamp: 2`), so a long jet part name doesn't make the tray taller and old designs sit where they did; the phone-landscape rule (:685) keeps one line with an ellipsis.
- `Builder.layout()` (builder.js:1407-1418) writes `--pal-h` (the tray's measured height). It drives `.stats` max-height, `.fit-col`, `.chip-hint` and the docked `.part-info`. It also lifts `.fit-col` above `.part-info` when they overlap.
- The stats panel folds (`.stats.collapsed`, :645). It starts folded when the window is short (`innerHeight<520`, or `<700` with `innerWidth≤760`, builder.js:1825); the choice is stored in `rss.statsFolded`.
- `#build-ui.has-info` hides the 3D hint chip on phones (:678).
- Dragging a part over the tray shows `.palette.drop-remove`, "Drop here to remove" (:647).
- Some rules use `:has()` (:610, :910-913); old browsers ignore them.

### 5. localStorage keys (every key used in js/)

All go through `store` as JSON; there is no other persistence (`BroadcastChannel` in net.js is messaging only).

| Key | Read/written in | Contents |
|---|---|---|
| `rss.settings` | world.js:7-9 | Settings object (§2) |
| `rss.career` | career.js:38, 41 | `{mode: null/'career'/'sandbox', funds, tier, done:{missionId: timestamp}, flights}`. In a match `MP.pushCareer` swaps in a throwaway copy with `save` as a no-op (mp.js:135-152). |
| `rss.design` | builder.js:346, 357; mp.js:137, 146 | Current blueprint `{name, kind, parts, savedAs}`. Not written while a match borrows the builder. |
| `rss.hangar` | builder.js:1424, 1447, 1605 | Up to 100 named designs `{name, kind, parts, savedAt}`, newest first |
| `rss.clip` | builder.js:328, 1023 | Copy/paste clipboard `{kind, parts}` |
| `rss.symmetry` / `rss.symmetryPlane` | builder.js:331, 1229-1231, 1810 | Symmetry toggle for non-planes / planes |
| `rss.grid` | builder.js:332, 1000 | 2D quarter-metre grid snap |
| `rss.statsFolded` | builder.js:1825-1826 | Stats panel collapsed |
| `rss.flight` | flight.js:115, 157, 402, 427; main.js:235-300, 422 | Saved flight `{v:2, time, design, launchCost, active, flags, stats, target, scale, vessels:[…]}`, or null. Cleared on launch, revert, recovery, total loss and career reset. |
| `rss.seenHelp` | main.js:224 | The first-run help has been shown |
| `rss.silly`, `rss.sillyUnlocked` | util.js:142-146 | Silly flags; secret unlocked |
| `rss.mp.name`, `rss.mp.tr` | mp.js:82; mpui.js:19-46 | MP name (≤18 chars); transport `'p2p'`/`'local'` |

### 6. Offline / PWA

**sw.js** (31 lines):
- `CACHE = 'overbuilt-v22'` (:3; v21 was PR #35, v22 is PR #36, the look-alike jets). PR #36 added no files, so `SHELL` is unchanged.
- `SHELL` (:4-12) lists `./`, index.html, the CSS, the manifest, `icons/icon.svg`, every js file **including `js/vendor/three.min.js`** and peer.min.js, and all 8 `assets/earth-*` files.
- **install** (:13-16): `addAll` with `cache:'reload'` requests (bypassing the HTTP cache), then `skipWaiting()`.
- **activate** (:17-19): deletes every cache whose name isn't `CACHE`, then `clients.claim()`.
- **fetch** (:20-31): **network-first** for every GET. A good same-origin response is copied into `CACHE`. When the network fails it falls back to `caches.match(req, {ignoreSearch:true})`, then to `index.html`, for any request.
- Cross-origin responses (Google Fonts, the PeerJS server) are never cached, so offline play uses system fonts.

**When to bump `CACHE`:** on every change to any cached file (all js, css, html, assets, manifest). Changing sw.js's bytes is the only thing that makes browsers install a new worker. That install pre-caches the whole new set (so offline play is complete), removes the old cache, and fires `controllerchange`, which auto-reloads the page (main.js:474-478).
- Online visitors already get fresh files without a bump, because fetching is network-first.
- The history shows `camstrike-v*` → `orbit-forge-v1` → `rocket-science-sim-v2`…`v15` → `overbuilt-v16` (the rename), bumped in feature commits. Any name works, because activate deletes every other cache.
- A new script or asset must also be **added to `SHELL`**, and every `SHELL` entry must exist: one 404 makes `addAll` reject, the install fails, and the update is silently stuck.

**manifest.webmanifest:**
- `name` and `short_name` "Overbuilt"
- `start_url`/`scope` `./`, `display: fullscreen`, `orientation: any`, colours `#05070d`
- icons: `icon.svg` (any), `icon-192.png`, `icon-512.png`. The PNGs are not in `SHELL`; they get cached at runtime.
- The `description` is outdated ("…land on the Moon").

index.html:8-14 also sets `theme-color`, the Apple web-app metas, the SVG favicon and `apple-touch-icon` (192 png).

### 7. Tools and deployment

**`node tools/build-single.mjs [--fragment]`** writes `dist/overbuilt.html` (≈7.9 MB, mostly base64 Earth data) or `…fragment.html` (no doctype/html/head/body wrappers; charset and viewport metas dropped, :25-31). `dist/` is gitignored. It works on index.html as text, with **string replaces that silently do nothing when they don't match**:
1. Inlines `css/style.css` (:13).
2. Inserts `js/vendor/three.min.js` before `parts3d.js` (:15), so `Render3D.load` finds `window.THREE`.
3. Inlines every `<script src="js/….js"></script>` in order, escaping `</script` (:16).
4. Replaces each quoted literal `'assets/earth-*.ext'` (the ones in main.js:463-466) with a `data:` URL (:18-20).
5. Strips the manifest, icon and apple-touch-icon links (:22).
6. Injects `<script>window.RSS_NO_SW = true;</script>` before the inlined util.js. It finds the spot by util.js's exact opening `'use strict';\n// Shared helpers` (:23).

The single file still loads Google Fonts from the network. Its Earth works even from `file://`, because `fetch` of a `data:` URL is allowed.

**`python3 tools/bake-earth.py <source-dir>`** (needs numpy and Pillow) bakes the real Earth into `assets/` (path resolved from the script, :39).
- Inputs (docstring :4-11):
  - AWS Terrain Tiles, terrarium zoom 4 (`tiles4/X_Y.png`)
  - Natural Earth 1:10m GeoJSON (land, lakes, rivers, roads, urban, places, countries, marine)
  - Blue Marble and Black Marble JPGs
- Outputs (:13-25):
  - `earth-height.png` 4096×2048: one byte, non-linear land/sea code (`encode_h` :112-116)
  - `earth-color.jpg`, `earth-night.jpg`, `earth-lakes.png` (R coverage, G·256+B = (h+1000)·20), `earth-urban.png` at 2048×1024
  - `earth-regions.png` 1024×512 (R·256+G country, B sea)
  - `earth-places.json`
  - `earth-lines.bin` ('RL02' polylines, `write_lines` :258-284)
- Decoders that must change together with the encoders: `HLUT` (terrain.js:147-148), the lakes and regions decode (terrain.js:163-173), the `RL02` check (terrain.js:239).

**GitHub Pages** (.github/workflows/pages.yml):
- Runs on push to `main` and on `workflow_dispatch` (:5-8).
- checkout → configure-pages → `upload-pages-artifact` with **`path: .`** (:28-30) → `deploy-pages`.
- There is no build step: the whole checkout is published as-is, `test/` and `docs/` included (dist/ and test/.cache aren't, since they're gitignored).
- Concurrency group `pages`, cancel-in-progress.
- One-time setup: repo Settings → Pages → Source "GitHub Actions" (:4).
- Live URL: **https://devwolf11.github.io/Overbuilt/** (README.md:14). Renaming the repo changes it, and GitHub Pages doesn't redirect the old path; saves survive because localStorage belongs to the origin `devwolf11.github.io`, not the path.

`.gitignore`: `dist/`, `node_modules/`, `.DS_Store`, `test/.cache/`.

### 8. README.md

Sections:
- Title and pitch (:1-10)
- **Play** (:12-16): online URL, local serving, single file
- **Modes** (:18-22)
- **Multiplayer** (:24-35)
- **Controls** table plus a long Builder paragraph (:37-61)
- **What's in it** (:63-100): one bold-led bullet per feature area (Earth, 3D world, vehicles, weapons, missiles, damage, structure, the look-alike jets with their 5th-generation and battle sub-bullets (:81-83), parts by category, flight model, builder, physics, solar system, navigation, graphics, saving, settings, battery)
- **Scale** (:102-104)
- **Project layout** (:106-139): one line per file or folder, including `test/`, `docs/HANDBOOK.md` and `CLAUDE.md`
- the file:// note (:141), data credits (:143), the name history and Cam-Strike (:145)
- **Ideas for later** (:147-149)

Convention: **every user-visible feature, control or part change gets documented in README in the same commit.** Recent feature commits all touch README. When you change something:
- edit the matching "What's in it" bullet and the Controls table
- add new files to Project layout
- keep the counts in prose correct. Since PR #36 they are "254 parts" in "fourteen categories", "182 aircraft parts and 28 weapons (96 of these 210 come from the ten look-alike jets)", "one of 26 paints … thirteen plain ones … the look-alike jets' thirteen, eleven of them camouflage", "41 missions", "thirty-five examples" with "seventeen military aircraft", and the jets' prices "from $44,600 to $119,300"; CLAUDE.md's architecture table repeats the part and template counts (254 parts, 35 templates)
- keep three places in sync for controls: README, `App.showHelp` (main.js:315-326) and `Flight.controlsHelp` (flight.js:481-505)

Known drift:
- The Project layout line for world.js doesn't mention that it holds `Settings`.

### 9. Gotchas

1. **A new top-level name that already exists in another file** is a SyntaxError that kills the whole later script. Check with `grep -n "^const NAME\|^function NAME" js/*.js`.
2. **A new js file** needs four things:
   - a `<script>` tag in index.html, in dependency order
   - an entry in `SHELL`, plus a `CACHE` bump
   - a README Project layout line
   - the path must match `js/[\w/.-]+\.js`, or build-single won't inline it
3. **A new Earth asset** must be added in seven places: `EARTH_MAP_FILES` (single-quoted), `Terrain.loadEarth`, `SHELL`, the build-single file list (:19), bake-earth.py, and the test harness's `FILES` (test/lib/earth.js) and `LAYERS` (test/lib/dump-earth.mjs).
4. **Don't change util.js's first two lines**: build-single uses them to find where to inject `RSS_NO_SW`.
5. **No `import`/`export`, no `type="module"`, and no required `fetch` of local files**: anything except the Earth map must work from `file://`.
6. **Don't use `Settings` (world.js) or `Sound` (audio.js) at load time** in files that load earlier; only call them from functions.
7. **`hidden` beats CSS** (`!important`). And a control nested deeper than a direct child of a `.ui` container needs `pointer-events:auto`.
8. **`UI.modal` replaces any open modal and drops its `onClose`.**
   - Don't open a dialog over the paused flight menu, or the flight never resumes (its `onClose` calls `Flight.setPaused(false)`).
   - String bodies are innerHTML: build anything containing peer-supplied text (MP names, chat) with `el(…, {text})`.
9. **Escape is swallowed while a modal is open** (capture listener, main.js:22). Game key handlers must also skip input while `UI.modalOpen` or while focus is in an `INPUT`/`TEXTAREA`/`SELECT`, as builder.js:1757 and mpui.js:80 do.
10. **A thrown error inside `frame()` doesn't stop the game**: watch the console, since it repeats every frame (every redraw, for a still view).
11. **Silly flags must stay cosmetic or opt-in**: `Silly.on` is false in PvP, and missions must read real values (e.g. `v.mach`, not `effectMach`).
12. **Changing a save format**: `rss.flight` carries `v:2`, and `store.get` also reads `orbitforge.*` keys. Keep restores tolerant: `resumeFlight` drops a save that fails to load. A thrown error in `Career`/`Builder` load code breaks startup.
13. **`isTouch` is fixed at load**, and the touch controls show on desktop too. Test on both a phone in portrait (≤760 px wide) and in landscape (≤500 px tall); the CSS has a separate layout for each.
14. **Deploys are instant and unbuilt**: whatever lands on `main` is live. A stray file in the repo root is public.
15. **A still screen isn't drawn again by itself** (PR #35, §2). `App.frame` redraws the hangar only when its picture is stale (the home backdrop just runs at 30 fps). Code that changes what the hangar shows without player input must call `Builder.redraw()` (or `App.redraw()`); a missing call shows up as a change that appears up to half a second late, and `test/browser/redraw.mjs` (heartbeat off) fails on it.
16. **The frame cap skips frames** (§2): with `fps` 60 a 120 Hz screen works every other frame and `dt` doubles. Nothing may count frames for timing; rate per-frame effects per second (chapter 2 §6).

## 6. Testing

`test/README.md` covers the suites, baselines and helpers in full. In short:

- `node test/run.mjs` runs the headless suites. They load the game's own scripts into a Node VM: fingerprints of every template, full-precision flight traces, the plane handling table, and checks for the part model, physics, flight, combat, multiplayer and flutter, plus since PR #36 `us4.test.js` and `shapes.test.js` (test/run.mjs:13). The suites run side by side; at PR #36 the whole run takes about 47 s (it was about 40 before), the longest being `handling.js` (40 s for its 25 planes), `us4.test.js` and `combat.test.js` (about 20 s each).
- `node test/run.mjs --browser` adds the browser suites: the 2D builder, the 3D builder, the builder by shape (PR #36), redraw on demand and two-tab multiplayer, in headless Chromium with software WebGL.
- **New in PR #36:**
  - **`us4.test.js`**: the FS-4, FS-16 and FS-15. Their lofted bodies are well formed (finite sections in order, top over waist over bottom, inside the part lengthwise) and each has a `fill` between 0.3 and 1; the bodies of each template meet end to end without a step; every part joins; a lofted body alone counts `w × depth × fill` head-on; the stock fin with the default `vtail` fields keeps its old outline; and each jet takes off from the runway (lift-off within 1.5 km, nothing breaks) and settles level at 11 km on full afterburner inside a Mach band (FS-4 1.9-2.25, FS-16 1.9-2.15, FS-15 2.0-2.3), holding its height, short of the speed warning.
  - **`shapes.test.js`**: the clash test on 3D shapes (chapter 1 §4). How far a disc or a rectangle cuts into another against points sampled on a grid; the heights `shapesClash` samples against a 2 mm scan for 400 random pairs of real parts (round, flat, lofted, boxed, turned, pairs); and what a player sees: round tanks corner to corner don't clash and closer in they do, a pod by a nose cone's slim tip doesn't and by its wide base does, boxed gear clash as their boxes do, a part turned a quarter keeps the box rule, both sides of a twin pair count, a canopy drawn only in 2D still takes room.
  - **`browser/builder-shapes.mjs`**: the tray by kind (each kind's tabs, More and Fewer, a rocket engine still reachable on a plane, the wings tab's jet groups in order), sliding onto a nose cone's tip in 2D and onto a fuselage's lower curve in 3D (onto the surface and no further, hung on the right host), `snap` against a 20-part jet under 25 ms, and no page errors. Since the builder review also: a part slid beside an old pod pair (the Jumbo's, legacy twins) stops at the pod's surface; a part slid onto a fuselage's curve stays attached after a nudge along it and a depth change; every part's 3D model lies within 1.5 cm of its clash shape (so `CLASH_PAD` and `CLASH_BOXED` must cover any fitting that stands out of a new part's outline); dragging the Sugoi-27's nose about its own jet costs under 8 ms a move; and on a phone in portrait (390×844) More is in sight for every kind of craft.
  - **`core.test.js`**: the look-alike jets' templates have no clashing parts and every part joined; the Russian lofted hulls stay inside their part's box; wing plans run from root to tip with the leading edge ahead of the trailing edge.
  - **`combat.test.js`**: the IRST Ball makes heat seekers lock 30 % further and leaves radar and attack missiles alone (test/combat.test.js:125-132; `test/lib/game.js` now exposes `rangeOf` on `Combat._t`).
  - **`flutter.test.js`**: the `WANT` table (:13-23) lists the ten new fixed wings' breaking speeds and Mach limits, since it requires every fixed wing to be in it.
  - **`mp.test.js`**: the "legacy template rows" measure check skips templates whose rows carry `{z, att}` (the jets), which aren't legacy rows.
  - The baselines took the ten jets as additions only (every existing entry byte-identical), then were re-recorded for single jets as the review and play-testing changed them (fs4, fs16, fs15; sugoi27, sugoi35; fs22, fs35).
- **`browser/redraw.mjs`** (PR #35) guards on-demand drawing: every kind of edit, by hand and from code, must show at once in the 2D and the 3D hangar, and the idle hangar must draw nothing. It sets `App.heartbeat` to 1e9, so a missing `Builder.redraw()` fails instead of hiding behind the half-second safety net. On synthetic frame times it checks the frame cap (60 frames' work a second on 90-144 Hz screens), the home backdrop at 30 fps and a paused flight, or anything under a dialog, at 10. A test of your own that changes Builder state from code and then reads pixels must go through `changed()`/`renderInfo()` or call `Builder.redraw()` too.
- **`combat.test.js`** has a second check list since PR #35, "combat: countermeasures and the frigate radar SAM" (test/combat.test.js:135-354): the dispenser's ammo and store, the free cloud unchanged for a flares-only craft, an empty dispenser, chaff-only craft, `status()` for flares-only, chaff-only, plain and Falcon craft, the Spectre's stealth, `netFlares` sanitising, `decoyed` and `chaffBreaks` (odds, radii, the 4 km wait), countermeasure particles per second at 60, 120 and 144 fps and none past 3 km, the ship radar (reach, stealth, ECM, notching, an island in the way), a small Monte Carlo of the radar SAM with the real missile code, its launch cadence, and no launch at a craft under 150 m (a take-off). The suite takes 11-20 s depending on the machine (about 2 s before PR #35). `test/lib/game.js` exposes `chaff`, `dispenser`, `autoCM`, `cmFX`, `decoyed`, `chaffBreaks`, `siteSees`, `clearLine`, `makeTarget`, `shipSamFire`, `samFire` and `at` on `Combat._t` for it. `mp.test.js` checks that `cm` carries chaff 2, 1 and 0 and that a dispenser survives `mpSpawnRows`.
- Baselines in `test/baseline/` are the output of `main`. A change that is meant to move them is re-baselined with `--update`, with the reason in the commit. A refactor must leave them identical. PR #35 is an example of both: its physics and rendering changes left every baseline identical (and 67 extra ground, air, bay and causeway scenarios matched to 17 digits), and only the four templates that gained a Chaff Dispenser (falcon, kestrel, striker, spectre) moved in fingerprint, traces, handling, combat and mp-measure.
- For a change you can't express as a check, such as visuals, feel or layout, script it with Playwright (`test/lib/browser.mjs` has the server, launch and fresh-profile helpers), take screenshots and look at them. Check the console too, because `App.frame` swallows exceptions.

The physics, combat and multiplayer suites began as the adversarial-review repros of the attach system. Each check there once failed on a real bug.

## 7. Known loose ends

Found while writing this handbook, in earlier reviews or in play-testing, and not fixed yet. All are verified against the code, except where the notes say a thing was only seen in play.

| Where | What | Notes |
|---|---|---|
| `manifest.webmanifest` | The description still reads "Build rockets, reach orbit and land on the Moon." | Undersells the game |
| `mp.js:834` (`onDown`) | Reads `m.P` without validating it. A malformed `down` throws inside the handler; it is caught, but the ghost drop and `recordDown` are skipped. | Validate with `mpNums` like the other handlers |
| multiplayer trust | Hit amounts (capped), kill credit (named by the victim), the self-reported damage score, and each player's budget and design checks all rest on trust | By design for a host-relayed P2P game; worth knowing before "anti-cheat" work |
| `space.js:487` (`transferWindow`) | Returns a bare `Infinity`, not an object, when the two orbit rates match | The HUD copes by accident |
| `render3d.js` water | The ocean and inland water geometries have no `uv` attribute, so the ripple normal map does nothing in exact arithmetic (zero tangent frame); removing it still moves up to 116 pixels by 1/255 on sea views, through float rounding | Add UVs before tuning ripples |
| `render3d.js:2564` (`finishJob` at 40 px) | Earth's map is painted in one go on the first flight frame: about 2.8 s of main-thread JS on a desktop, several times that on a phone, as one stall | Left as it was in PR #35: painting it a slice at a time would change what the first frames show |
| `css/style.css:257-264` (blur) | The backdrop blur stays on the home screen and in the 3D hangar. The turntable spins by default, so the hangar's blurred panels are blurred again every frame until the player grabs the view | A follow-up could drop the blur there too, as in flight |
| `flight.js:634` (sleep) | Only non-active vessels sleep: a parked active craft is stepped in full (a Falcon on the runway, about 6 ms of physics a second) | Letting it sleep isn't bit-identical (a resting craft is not a fixed point); it probably wouldn't move a baseline, but check |
| `render3d.js` `syncCombat` | Target models are removed without disposing their geometry | A small leak |
| scenery caps | Tree, building, rock and boat loops stop silently at their `InstancedMesh` capacity | Raise the capacity with the cap |
| torpedoes, ARMs | Have nothing to hit in multiplayer (no range or sea targets in rooms) | A design gap |
| handling table | In 30 s hands-off ("hold" autopilot, 85 % throttle) most planes sink 170-730 m (`node test/handling.js`) | Probably trim rather than a bug; check before "fixing" |
| input | No gamepad support; no cockpit or free camera | Ideas |
| Sugoi-57 bays (`ruBay57`, `ruBayS57`, parts.js:626, 630) | They have `doors`, so they cost stealth while open (0.54 → 0.42) like the FS jets' bays, but nothing shows the doors: `RU_ART.bay` draws closed doors and the missiles left, and the `ruLoft` model has no `hinge` doors | Add hinge doors to the 3D model and a `p.deployed` door to the 2D art, as `US5_FIT`/`US5_ART` do |
| FS-4 fin (`us4f4Fin`) | Its camouflage maps differently in 3D from the 2D blueprint, unlike the other parts, which line up since the play-test fixes | Only seen in play-testing; it is a stock-recipe `vtail` textured through `projUV`, so look there first |
| Russian vectoring nozzles on ghosts | The Sugoi-35's and Sugoi-57's nozzles swing from `VesselMesh.cmd`, the stick command, which multiplayer doesn't send, so on another player's screen they stay centred (the FS-22's flat nozzles move, through `deflect` in `pv`) | Cosmetic; sending it would need a `pv` field and a `NET_VERSION` bump |
| hands-off drift, autopilot off | A jet whose gun sits off the centre line (the FS-16, FS-15, FS-22, FS-35, MyG-29 and the three Sugois) rolls into a bank hands-off with the autopilot off, and the game has no trim. Measured for this update (30 s at 3 km, 230 m/s, 85 % throttle): FS-16 5°, FS-22 12°, Sugoi-27 15°, FS-35 21°; none with the gun taken off, and none for the MyG-21 and FS-4, whose guns are on the centre line | Every autopilot mode holds it; trim would be a new control |
| camouflage, 2D speed | A camouflaged jet's blueprint redraw still costs 2-3 times a plain jet's on software raster (13-17 ms on desktop after the play-test fixes, from 22-30), because every body fill is a pattern | Already at 16 px a metre on screen (`CAMO_PX`); cache the blueprint if it matters |
| camouflage, from above | The Russian jets' lofted hulls (`loftGeo`) take their whole texture from the side view, as lathe parts do, so a camouflaged hull seen from straight above shows the side view's top-edge colours as streaks along it | The FS bodies don't: `us5LoftGeo` paints top faces in metres and `loftTube` uses the plan view (`drawPartTop`); either way would do for `loftGeo` |
| camouflage in the 3D hangar | A camouflaged part's material is made once, with its pattern started where the part was (`camoAt`); moved in the 3D hangar it keeps that alignment until its model is rebuilt (a paint, flip or kind change, undo or load). Found while writing this update | Flight builds the models where the parts are, so only the hangar shows it |
| doors on a craft you leave | Doors are stepped for `F.active` only (combat.js:471), so if you switch craft within the hold after a shot (up to 1.8 s), the old one's doors stay open, and its stealth down, until you switch back | Step them for every craft that has them |
| FS-35 | The conventional version only: no lift fan or swivelling nozzle for hovering | A design choice, worth knowing before someone asks for a jump jet |

The README's "Ideas for later" lists the owner-facing wishlist: docking and space stations, payload fairings, solar panels and batteries for ion engines, editable staging, boats, more moons around Jupiter, and planet rotation.

