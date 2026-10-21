# Overbuilt: developer handbook

A reference for anyone changing the code, human or AI. Start with `CLAUDE.md` at the repo root: the owner, the workflow and the rules that matter most. This handbook is the deep end: how each subsystem works, its data and its invariants, with `file:line` pointers.

The handbook was written against `main` at the merge of #29 (October 2026), by reading the code. Line numbers drift as the code changes, so search for the function name if a line has moved. If the code and this handbook disagree, the code wins: fix the handbook in the same commit.

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

**Files:** `js/parts.js` (catalogue, geometry, connectivity, staging/Δv, persistence helpers, 2D drawing) and `js/builder.js` (`TEMPLATES`, `templateRows`, the `Builder` singleton). Both are plain globals with no modules. Script order matters (`index.html:332-352`):
- `util.js` comes first and provides `clamp`, `TAU`, `G0`, `store`, `el`, `isTouch`.
- `parts.js` loads before `vessel.js`, `parts3d.js`, `render3d.js`, `career.js` and `builder.js`.
- `builder.js` calls `wingAero`/`wingStrength` (vessel.js:32,64), `Career.unlocked` (career.js:47), `Parts3D.wingAt` (guarded with `typeof Parts3D`), `Render3D.*`, `App.*`, `UI.*` and `Sound.*`.

Units are metres, tonnes, kN, seconds and kelvin (parts.js:3). `fuel`/`mass` in defs are tonnes. On instances, `p.fuel` is **kg** (`partFuelKg`, parts.js:434) and `partKg(p)` = dry + fuel + stores in kg (parts.js:436).

### 1. Coordinates

| | x | y | z (depth, `p.z`) |
|---|---|---|---|
| Rocket / heli / car (`launchRot` 0) | horizontal on the blueprint | up | towards the viewer |
| Plane (`launchRot` −π/2) | **down** (gear hangs on +x) | **nose** | **right wing** |

- The 2D blueprint is a side view looking along z from +z. For planes that means you see the right-hand side (parts.js:482-486).
- Part space is what is stored. The builder shows display space = R(`viewRot`)·part: `Builder.viewRot` = `VEHICLE_KINDS[kind].launchRot` (builder.js:318), with `toDisp`/`toPart` at builder.js:319-320. So planes appear nose-right, and arrow-key nudges are converted with `toPart`.
- Cars drive towards +x (`HULLS.cab`, parts.js:1048). Helicopters put the rotor on +y and the tail boom on −x (template `hummingbird`).
- **Rotation:** `p.rot` is 0..3 quarter turns anticlockwise about the part centre (parts.js:451).
  - `partDims` swaps w/h for odd rot (:452). `partPt` maps a local offset to part space (:454). `partAxis` gives the part's own "up", the thrust and flight direction (:462-464).
  - `mirrorRot` gives the turn of a mirror copy (:466). `partRect` returns the side-view box `{l,r,b,t}` (:467).
  - A pusher prop is drawn and modelled with 2 extra quarter turns (`turned`, :1059; parts3d.js `place`, :1230).
- `p.flip` = "this part is on the −x side, draw it facing out" (fins, legs, gear wheel end via `wheelGeom` :517, vtail, rcs). `makePart` defaults it to `x < 0` unless `extra` gives one (parts.js:443); loading (`partsFromDesign`, `Vessel.restore`, `buildGhost`) keeps the saved flip, and `Builder.setPose` resets it to `x < 0` on every move (builder.js:243). It is saved per row, and the 3D model cache is keyed by it.

### 2. The PARTS catalogue (parts.js:39-416)

- `PARTS[key]` is the def. The key is the **type string written into saves**.
- A loop afterwards sets `d.type = key`, defaults `maxTemp` to 2000 and gives solids a default cost (:417-422).
- `tank(name,w,h,tier,desc)` (:34) derives fuel = `w*h*FUEL_PER_M2` (0.55 t/m², :31), mass = fuel/9 and cost.
- Palette order within a category is object key order.

**Categories and kinds**
- `PART_CATEGORIES` (:5) holds the palette tabs; `def.cat` must be one of their ids or the part never shows.
- `VEHICLE_KINDS` (:24) has `rocket|plane|car|heli`, each `{site: pad|runway|helipad, launchRot}`.
- `TIERS` (:425) has 5 career tiers. `def.tier` indexes it and `Career.unlocked(def)` = `sandbox || def.tier <= data.tier`.

| Group | Fields (meaning) |
|---|---|
| Identity / economy | `cat`, `name`, `desc`, `tier` (0-4, required: used in toasts as `TIERS[def.tier].name`), `cost` (required: `designCost` sums it), `crew` (informational only, never read outside parts.js) |
| Geometry | `w`,`h`: unrotated side-view box in m, centred on (x,y). `depth`: explicit thickness across z. `topW` (adapter top width), `botW` (tail-cone tip). `mount`/`bellTop`/`bellBot`: engine block and bell fractions, **required for `shape:'engine'`/`'spike'`**. `shape`: selects the 2D drawing, the 3D recipe and many behaviours. `style`: a variant within a shape (fuselage: cargo/tank/armor/stealth/intake/boom/bay; engine nuclear; jet scram/pulse; prop electric; stores cluster/guided/torpedo/harm/cruise; jetnose stealth). Cosmetic extras: `canopy{at,len,seats,gold}`, `facets`, `blades`, `spinner`, `duct`, `contra`, `calibre`, `barrels`, `body3d` (forces a parts3d BUILD recipe) |
| Mass | `mass` (t dry), `fuel` (t), `maxTemp` (K), `breakSpeed` (impact m/s, vessel.js:934) |
| Command | `control` (rank: `findControlPart` picks the highest), `torque` (reaction wheel, summed at vessel.js:643), `radar` (m), `stealth` (0-1), `armor` (0-1, combat.js) |
| Propulsion | `thrust` kN, `ispSL`/`ispVac` s, `gimbal` rad, `vector`. `plume` is a PLUMES key in parts3d.js:65 or `'none'`. `solid` and `battery` give the part its own fuel group (`fuelGroups` :828). `air{kind:'prop'\|'jet'\|'fan'\|'ram'\|'rotor', v0, vmax, vmin, ab, torque}` marks air-breathing engines, which are excluded from Δv. `pusher`, `fan` |
| Aero | `aero` (cuts drag when leading, vessel.js:223), `sharp` (vessel.js:231). `wing{area, span, flaps, vne, mmax, sweep, taper, stall, mcrit, load, dihedral, slope, wave, swing, planform, oswald, ar, gap, thick, cd0, winglets, control}`: field meanings are in the comment at parts.js:119-128; `control` makes it an elevator. `fin` (rocket fin), `airbrake` (area), `heatShield` |
| Utility | `chute`/`chuteArea`/`brakeChute`, `leg`, `wheel{r, drive, speed, accel, track, brake, retract, bogie, fat, caster}`, `float`, `smoke`, `separator`, `side` (radial separator), `weapon{kind, ammo, each, ...}` (comment at :348-349), `agm`, `bay`, `ecm` |
| Depth / attachment | `twinZ`: the part is a **pair**, one copy at ±z, and twinZ is the default spread. `pod`: hangs from a wing (placement, draw layer, host guessing). **zLocked** is derived, not a field: `zLocked(d)` = `wing \|\| leg \|\| fin` (:489). Such parts always sit at z=0 because wings span both sides and rocket legs/fins stand in fours |

**Adding a part end to end**
1. **Def.** Add an entry to `PARTS` with a unique key, an existing `cat`, `tier`, `cost`, `mass`, `w`, `h`, `shape` and `desc`. Reusing an existing `shape` (plus a `style`) gets drawing and 3D for free.
2. **2D drawing**, for a new shape:
   - Add a case to `partPath0` (outline, :1084). It is used for highlights, heat glow, clipping **and as the 3D silhouette**.
   - Add a case to `drawPart0` (artwork, :1212). Fill the body with the skin-aware helpers (§5). Plain colour literals stay unpainted.
   - If the shape should not take paint, add it to `NO_SKIN` (:880).
   - For engines, check `nozzleOf` (:669). The draw layer comes from `sideLayer` (:1072).
   - The `default:` case draws a hull-gradient rectangle.
3. **3D** (js/parts3d.js):
   - `LATHE` (:48) revolves the outline; `LATHE_KIND` (:50) sets its material.
   - `RECIPE` (:51) maps a shape to a `BUILD[...]` function (:508).
   - Otherwise the outline is extruded (`recipe()`, :835). `PROFILE` (:156) overrides the outline for 3D.
   - `ZMIRROR` (:63) is for models that differ left and right, `SKIN_GEO` (:59) for wings that bake paint into geometry, and `BODY_KINDS` (:58) for solid materials that take skin colour.
   - The outline reaches 3D through a recording fake context (`recorder`, :105). It understands moveTo/lineTo/closePath/bezier/quadratic/arc/ellipse/rect/save/restore/translate/rotate/scale; every other call is a silent no-op.
4. **Behaviour** comes from def fields:
   - vessel.js: wings, wheels, air engines, chutes, airbrake, floats, breakSpeed, heat.
   - combat.js: `weapon`, `armor`, `stealth`, `radar`, `ecm`, `smoke`.
   - flight.js: controls.
   - Builder stats warnings (builder.js:1062-1095) look at `wing`, `wing.control`, `thrust`, `wheel`, `float`, `air.kind==='rotor'`, `shape==='vtail'`.
   - `quickAdd` heuristics (builder.js:946) key on `side`, `leg`, `fin`, shape `rcs`/`girder`, `control`, `chute`, `aero`, `pod`, and surfaces.
5. Optionally add the part to a template and to the README part list.

### 3. Part instances

`makePart(type, x, y, extra)` (parts.js:441) creates `{id, type, def, x, y, z, att, skin, flip, fuel, active:false, deployed:0, temp:AMBIENT_T}`, plus `ammo` and `store` for weapons. `extra` is merged in, then `z` is re-defaulted when it is not finite, and `att`/`skin` when they are undefined. `rot` may be absent; code reads it as `p.rot || 0` or `& 3`.

- **`id`**: from the global counter `_partSeq` (:438). It is unique per page load. Design rows (`rss.design`, the hangar, design codes) use indices instead; flight saves (`rss.flight`) do keep ids, with `att`, `adj` and `stages` by id (and `Flight.restore` moves `_partSeq` past them); peers use their own ids.
- **`att`**: the id of the part this one *hangs on*, or null. It is a structural joint: `buildAdjacency` links it even when the geometry no longer touches (:591).
- **`skin`**: a `SKINS` id or null (null = the part's own look).
- **Runtime fields** set by flight, combat and the builder: `fuel` (kg), `firing`, `spin`, `deflect`, `retracted`, `used`, `fuelFrac`, `ammo`, `store`, `side`, `relN`, and `mirror` (builder only: a direct object reference to the symmetry twin). Parts are cyclic and hold `def`, so **only `designRows` serialises them**.
- Draw code must cope with stand-in parts that lack runtime fields: `renderPartIcon` (:2021) and Parts3D `dummy` (parts3d.js:87).

**Depth helpers (:487-513)**
- `PART_Z_MAX`=20.
- `partDefaultZ` = 0 if zLocked, else `twinZ || 0`.
- `twinMinZ` = half the depth + 0.05 (any closer and the two halves would overlap).
- `cleanZ(z,d)` (:492) returns 0 when zLocked, the default when z is non-finite, `clamp(|z|, twinMinZ, 20)` for pairs, else `clamp(z, ±20)`.
- `partZ(p)` is the signed centre for a single part, or the spread (≥0) for a pair. `partZc` is where the mass sits across (0 for pairs). `partZs` lists each copy's z (`[-z, z]` for pairs). `partBoxes` gives `[l,r,b,t,near,far]` per copy.
- `partDepth` (:472) uses `def.depth`, else `wing.span`, else 0.15 for fin/vtail/tailrotor, 0.4 for wheels, else `w`.

**Legacy twins.** `legacyTwin(p)` (:541) = twin && `att === null` && `|partZ − twinZ| < 5e-4`. It identifies pairs saved before parts had depth or attachment. In the side view those overlap the hull they hang beside and only join "as their pylons show". To make old designs build, connect and fly **exactly as before**, the following special cases exist:
- `partsClash` never reports a clash between a legacy twin and a non-twin (:564).
- `partsTouch` skips the "side by side across z" join for legacy twins (:535).
- `pylonLink` (:575) joins any twin with no att (at any spread) to whatever it touches or mounts on in the 2D side view. This is how twin tails on a jet pipe and floats under a fuselage connect.
- parts3d `pylonsFor`/`oldStruts` (parts3d.js:1185,1117) draw struts the old way.
- combat.js:61 puts a legacy pair's explosion in the middle.
- vessel.js:880 measures a pair's heating offset from its default spread.

### 4. Connectivity, staging and Δv (parts.js)

| Function | Meaning |
|---|---|
| `spanOverlap(a0,a1,b0,b1)` :524 | overlap length (negative = gap) |
| `partsTouch(a,b)` :526 | share a face: flush within 0.02 on one axis, overlapping >0.1 on the other, and overlapping in z by >min(0.1, half-depths). Or overlapping in the side view and flush in z (side by side across; not for legacy twins) |
| `partsTouch2D` :543 | the same, side view only |
| `partsOverlap(a,b,m=.02,mz=m)` :549 | 3D boxes interpenetrate (any copy pair) |
| `isSurface`/`surfaceKind` :560-561 | wing (`def.wing`) or fin (`shape:'vtail'`) |
| `partsMix` :562 | exactly one side is a surface, or one wing and one fin; such pairs may overlap |
| `partsClash` :563 | overlap between two parts that don't mix: illegal placement |
| `partsMounted` :567 / `partsMounted2D` :568 | a surface through a hull (overlap >0.04; across z >0 / ignoring z): this counts as attached |
| `pylonLink` :575 | old twin (no att) joined by side-view touch or mount |
| `buildAdjacency(parts)` :582 | O(n²) pairs `touch \|\| mounted \|\| pylonLink`, plus every valid `att` link. Returns `Map<id, Set<id>>` |
| `componentOf(id, adj, skip)` :650 | flood fill; `skip(id)` blocks traversal |
| `findControlPart` :660 | highest `def.control` (first on ties) |
| `attachedTo(parts, roots)` :642 | transitive att-children (flight.js:243: what breaks off with a part) |
| `cleanAtt(parts)` :628 | null self and missing links; break att cycles by nulling the closing link |
| `computeStages(parts, adj, ctrlId)` :686 | segments = components without separators; BFS from the control segment. Stage 1 lights every *exposed* engine (a non-side separator below an engine, `sp.y < e.y`, blocks it until fired). Then the deepest separators fire, the subtree drops and newly exposed engines light. Chutes form the last stage |
| `estimateDeltaV(..., useSeaLevel)` :765 | replays the stages on copies: `cutSeparator` (:819) keeps the separator with the falling piece; fuel groups burn in parallel; air-breathers are ignored. Returns `{total, perStage, twr}` |
| `describeStage` :754 | the stage list text |
| `sideOrder(parts)` :1073 | draw order back to front: `round(partZ*20)`, then `sideLayer` (leg/fin/wheel 0 < hull 1 < surfaces 2 < pods 3), then index. Picking uses the reverse (`Builder.hitParts`, builder.js:338) |

### 5. Designs, codes, hangar, thumbnails

**Rows.** `designRows(parts)` (:599) produces `{type, x, y (3 dp), flip, rot}`. It adds `z` **only if it differs from `partDefaultZ` by >5e-4**, `att` **as an index into the same list** (only if valid and not self) and `skin` if set. Old designs therefore read back identically.

**Back to parts.** `partsFromDesign(rows)` (:611) works in two passes.
- First, each row either becomes a part or becomes `null` **kept in place** so att indices still match. A row is rejected for an unknown type (checked with `hasOwn(PARTS, ...)`, :488, not `in`, to avoid prototype keys) or for non-finite x/y.
- Kept rows have x and y clamped to ±500, `rot` taken as `(q.rot|0)&3`, z passed through `cleanZ` and the skin through `cleanSkin`.
- Second, att indices are resolved to ids, nulls are filtered out and `cleanAtt` runs.
- Callers include flight.js:32, mp.js:451, renderDesignThumb, paste and loadDesign.

**Templates.** `TEMPLATES` is at builder.js:5-149. Format: `{name, kind, tier, blurb, military?, parts: [[type, x, y, rot?, {z, skin, att}?]], paint?: {type: skin}}`. `templateRows` (:152) converts them to rows with `flip = x<0`. The hangar groups them as rocket / plane / military / car / heli (:1390). mp.js:455 relies on keys `mustang`, `camel` and `skylark`. Most plane templates use legacy twins (no att/z).

**Design codes.** `designCode` (builder.js:1265) produces `"RSS1."` + base64url(UTF-8 JSON `{n, k, p:[[type, x, y, flip0/1, rot]]}`).
- The prefix becomes `"RSS2."` when any row carries extra fields `[z, att, skin]`; trailing nulls are trimmed. Older versions cannot read RSS2.
- `parseCode` (:1278) finds `/RSS[12]\.…/` anywhere in pasted text and keeps at most **20000 rows** (reports `cut`).
- Unknown rows become null in place (reports `dropped`). The name is cut to 40 characters and an unknown kind falls back to rocket.

**localStorage keys.** All go through `store` (util.js:116), which uses JSON, try/catch and a fallback read of the legacy `orbitforge.` prefix.

| Key | Content |
|---|---|
| `rss.design` | current blueprint `{name, kind, parts, savedAs}`, written by `save()` on every committed edit (skipped while `MP.savedCareer`) |
| `rss.hangar` | up to 100 `{name, kind, parts, savedAt}`, newest first, unique by name (`storeDesign` :1217) |
| `rss.clip` | clipboard `{kind, parts}` (survives switching designs) |
| `rss.grid` | grid mode |
| `rss.symmetry` / `rss.symmetryPlane` | symmetry for rocket/car/heli vs planes (`symKey` :1009); default true |
| `rss.statsFolded` | stats panel folded |
| `rss.settings` | holds `build3d` (3D preview), via `Settings` (world.js:6) |

**Save state**
- `markSaved` (:1204) normalises the stored design through `designRows(partsFromDesign(...))`, so a design saved by an older version is not taken for changed.
- `isDirty` and `unsavedWork` compare `snapOf` = JSON of `[kind, parts]`. `baseSnap` is the template as loaded; it is set to null after pasting a code.

**Thumbnails**
- `renderDesignThumb(d, w, h, dpr, rot)` (parts.js:1990) parses with `partsFromDesign`, fits the rotated bounds at 86%, flips y and draws `sideOrder`.
- `renderPartIcon(type, size, dpr, rot, skin)` (:2013) is used by the palette at 56 px, rotated by `viewRot`.

### 6. Skins and paint (parts.js:858-962)

`SKINS` (:863) has 13 entries `{name, base:#rrggbb, paint?:'hull'|'dark'|'metal', accent?:'keep'|null, rough?, metal?}`. `accent` controls livery stripes: `'keep'` leaves them as drawn, `null` hides them, unset uses a tone of `base`. `rough`/`metal` are the 3D finish.

- `NO_SKIN` (:880) lists shapes that cannot be painted: sep, shield, chute, leg, wheel, gear, girder, rotor, tailrotor.
- `skinnable` (:881); `cleanSkin(id, d)` (:882) returns null when invalid or unpaintable.
- `ownSkin(d)` (:884) returns `'stealth'` for `style:'stealth'`. `skinOf(p)` = `p.skin || ownSkin`.
- Paint is **purely cosmetic**: stealth comes from `def.stealth`.

**How 2D painting works**
- `drawPart` (:1078) is the **only** place that sets `PartPaint.skin` (in try/finally) around `drawPart0`.
- Inside `drawPart0`, body fills must use the skin-aware helpers. Each one falls back to the part's own look when there is no skin:
  - `hullGradient`, `darkGradient`, `tintGradient`, `goldGradient`
  - `bodyMetal` (a metal body; `metalGradient` stays bare metal for nozzles and bells)
  - `bodyGrad(ctx, l, r, own)` (custom own fill)
  - `bodyFlat(hex)`, `bodyTone(hex, k)` (a tone of the skin base)
  - `accent(css)` (stripes)
- `skinFill` (:905) picks the painter.
- `PartPaint.flat=true` makes gradients return flat colours. parts3d `paint()` (parts3d.js:853) uses it to bake 2D art into textures cached per type|flip|skin.
- The cargo roundel hides when `accent === null` (:1896).

### 7. The Builder (builder.js:162)

**State**
- `parts`; the selection: `_primary` via the `selected` getter/setter (setting it selects only that part), `sel` (Set) and `multi`.
- `kind`, `name`, `savedAs`, `category`, `cam{x,y,scale}`, `symmetry`, `grid`, `selectMode`, `clip`.
- `history`/`future`: JSON snapshots, at most 60.
- Derived in `changed()`: `adj`, `ctrl`, `attached`, `stages`, `stageOf`, `com`, `cot`, `col`, `statsData`.
- Gesture state: `drag`, `zGesture`, `mpp`.
- `mp`: a battle's budget, limits and allowed kinds.

**The edit pipeline.** Every mutation ends in `changed(fromHistory)` (:247):
1. `cleanAtt`, then `buildAdjacency` (cached in `this.adj`), `findControlPart`, and `attached` = the control part's component.
2. Stages and Δv on the attached subset; mass and COM (z from `partZc`), COT from stage-1 engines, centre of lift and stall speeds (planes).
3. `renderStats`.
4. When `!fromHistory`: push the snapshot, clear `future` and `save()`.

Live previews (the depth slider) call `changed(true)`: no history and no save. `undo`/`redo` (:295) call `loadDesign(snapshot, true)`, which **recreates every part object**, so stale references must be dropped first (undo cancels any drag).

**Kinds**
- `setKind` (:995) and `loadDesign` (:196) switch the default palette tab (rocket→command, plane→cabins, car→ground, heli→airEng) and load that kind's symmetry setting (`kindSymmetry`).
- `renderKind` disables kinds that a battle disallows.

**2D vs 3D.** `in3D()` = `App.preview3D()`, i.e. Settings `build3d` and WebGL ready (main.js:89). `V` or `#btn-3d-build` toggles it. The main loop then calls `Render3D.renderBuilder(Builder)` instead of `Builder.render` (main.js:49).

| | 2D | 3D |
|---|---|---|
| Pointer down | `hitParts` (side-order reversed; pad 0.2 touch / 0.05 mouse) → `grab`, else box (select mode / shift) or pan | `down3D` (:1642): a mouse drags any part, a finger only an already-selected one; otherwise orbit; right/middle button pans |
| Placement | `snap()` near `pointerToPart` | `Render3D.surfaceHit` → `attach()`. Falls back to `snap()` on the plane at the part's depth (`Render3D.designPoint`) for zLocked parts or a miss |
| View | `cam` pan, `zoomAt` (scale 3-90), pinch | orbit, pinch/wheel zoom, `panBy`; `Render3D.editView(true)` freezes the turntable while dragging |

**Placement**
- `snap(type, want, ignore, rot, radius)` (:477):
  - The radius is max(1.4 m, 26 px). Rounding is 0.25 in grid mode, else 0.01.
  - Surfaces, pods and anything dropped on a wing stay exactly where dropped (depth found by `zFit`), hosted by what they mount on (a pod's host must be a surface).
  - Otherwise it tries end-on stacking (top/bottom), sides, corners and along-top positions against each other part. A candidate is rejected on `partsClash`, or for a twin that only meets its host in 2D.
  - Returns `{x, y, z, host, att, attached, ok}`.
- `zFit` (:457) checks the wanted depth first. Pairs and wing-hung parts then search outward (step 0.25 grid / 0.05) up to the wing's half-span.
- `attach(type, rot, hit, others)` (:521) works from the hit normal:
  - end face → stack on it;
  - x-dominant → over or under it (pods go to the `underside` of a wing);
  - z-dominant → on its flank.
  - Coordinates are rounded to 0.01, z under 0.08 snaps to 0 for non-twins, then `cleanZ`.
- `attFor(host, stack)` (:473): a part stacked end-on onto a **centre-line** part gets no att (the stack holds it); everything else hangs on its host.
- `addPart` (:551): checks the career lock, inherits `skinOf(host)` (a wing on a stealth fuselage comes in stealth grey) and creates the symmetry twin hosted on `att.mirror || att`.
- `quickAdd` (:946) is the palette tap.

**The attach system ("what hangs on what")**
- `hosts()` (:376) returns `Map(part → host)`: `att` if set, else `guessHost` (:427) for parts saved before att existed.
  - Pods and twins → the surface they overlap most in 2D (else the hull).
  - A surface → the hull it passes through.
  - Anything else → the side-touching part nearest the centre line.
  - A second pass hangs end-stacked parts on an off-centre hosted part (a radial booster's engine and nose cone).
- `near()` restricts candidates to `this.adj`.
- `kidsOf(roots, H)` (:440) gives transitive children. Children follow their host in `grab`/`moveDragged`, `shift`, `turnGroups`, `removeParts` (which deletes them too, with a toast), `copySel` and `rotateSelected`.
- `holds(h,q)` (:401) = touch, mount, or for a wing `wingHolds`: `Parts3D.wingAt` gives the swept, tapered section at q's depth, and q must sit within `s ≤ 1.05`.
- `letGo` (:671) clears `att` for parts that moved away from an unmoved host that no longer holds them. `dropDrag` (:1737) does the same and re-hosts a moved twin on its host's mirror.
- `zStep(q, dz, roots, H)` (:418): when a part hangs on the left copy of a pair, or a pair hangs on a part at −z, it moves by −dz so it stays on its host.

**Moving and editing**
- `grab` (:1630) takes the selection, their kids and their mirror twins (with the twins' kids) and records `origs`. The host map is computed **once per drag** (`drag.H`).
- `dragTo` (:1682) moves the group via `moveDragged` (:1708). Touch drags from the palette lift the part 44 px above the finger and vibrate when it snaps on.
- `dropDrag`: dropping over the tray deletes; an invalid spot reverts (`cancelDrag`); a single part dropped off the line gets a twin when symmetry is on.
- Rotation: `rotateSelected` (:605) / `rotateSel` (:860). A part with kids goes through `turnGroups` (:632), all or nothing; a non-plane twin turns the opposite way.
- `shift(list, dx, dy, dz)` (:649) does move/nudge/depth with rollback: if the group doesn't fit, or a part would clash with its own mirror, everything reverts. A mirror that cannot follow is unlinked.
- `duplicateSelected` (:587): a part on a wing gets another copy further along it.
- Copy/paste: `copySel` (:807) copies a single part's mirror and every kid too. `paste` (:820) searches up, then sideways, and adds twins when symmetry is on.
- Multi-select: Shift/Ctrl/Meta-click, `#btn-select` mode, box select by part centres (`boxSelect`), Ctrl+A. Tapping an already-selected part picks the one behind it (`drag.behind`).

**Symmetry.** `mirrorOf(q)` (:222) returns null when the part is on the mirror line:
- plane: (x, y, −z, same rot); none for twins, zLocked parts or z≈0;
- rocket: (−x, y, −z, `mirrorRot`), a half-turn about the stack (pairs keep z);
- car/heli: (−x, y, z, `mirrorRot`), front and back.

`linkMirrors` (:229) rebuilds `p.mirror` from poses with a 0.01 tolerance; mirror links are never saved. `mirrorOk` (:541) checks the twin's spot is free.

**Depth (`#pi-depth`).**
- `renderDepth` (:1149) hides the row for no selection, multi-select or zLocked parts. The label `#pi-z-label` reads "Spread" for pairs, else "Depth".
- `#pi-z` range: min `twinMinZ` for pairs or −lim; lim = min(20, ceil(max(4, |z|+1, wing half-spans+1))); step 0.25 (grid) or 0.05.
- `#pi-z-val` shows `zText` (:1160): `±a m`, `centre`, `left/right a m` for planes, or `+/−a m`.
- The slider `input` event calls `setDepth(v, true)` (:698). It restores the `zGesture` snapshot (poses, mirrors, att and H at gesture start) and re-applies `shift`. The `change` event commits one undo step.
- `[`/`]` and `#btn-z-in`/`#btn-z-out` call `nudgeZ` (:686): 0.1 m, 0.25 in grid mode, 1 with Shift. If both of a pair are selected, only the right one moves and its mirror follows.

**Paint (`#pi-paint`).**
- `renderPaint` (:1167) builds the `.skin-sw` radio swatches in `#pi-skins` once (`data-skin=''` = own colours, styled `.own`).
- `paintSel` (:719) applies to the selection plus twins, skinnable parts only.
- **Match** (`M`, `#btn-match`, `matchPaint` :728) takes the skin of `hostOf` (the host, else the biggest skinnable neighbour). The button is disabled when nothing has a host.
- **All** (`#btn-paint-all`, `paintAll` :740) gives the whole craft the selected part's `skinOf`.

**Grid (`#btn-grid`, `G`, `rss.grid`).** `setGrid` (:788) refuses in 3D. `gridOn()` = grid && !3D. It switches:
- snap rounding from 0.01 to 0.25;
- the `zFit` step, nudge/`[ ]` step and slider step to 0.25;
- `rotateSel` pivot rounding;
- the blueprint drawing to minor grid lines (otherwise faint 2 m lines are drawn).

**Keyboard** (handler at :1531). Ignored in modals, text inputs and textareas; a focused range slider keeps its arrow keys.

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

**2D render** (`render`, :1783):
- Parts are drawn in `sideOrder`. Loose parts are at alpha 0.4, single parts at z<−0.05 get a dark wash, locked parts a red wash.
- The selection gets dashed amber boxes; the palette ghost and its twin are drawn semi-transparent.
- Markers: COM yellow, centre of lift blue (planes), COT purple arrow, stage badges.
- Parts stacked at the same (type, x, y, rot) get a `×N` badge (a pair counts as 2). The selected part gets its `zText` label.

**Performance**
- `buildAdjacency` is O(n²). It runs only in `changed()`, never per drag frame.
- Drags reuse `drag.H`; `moveDragged` checks only `groupFits`/`partsClash`.
- `hosts()` is not cached, so compute it once and pass `H` down, as the existing code does.
- render3d rebuilds meshes only when the (count, kind, id/type/flip/skin) snapshot changes (render3d.js:2778); Parts3D caches models and textures by type|flip|skin.
- Code imports are capped at 20000 rows; peer craft at `MP_MAX_PARTS`=600 (mp.js:18).

### 8. Invariants and gotchas

1. **Never change `w`/`h`, `twinZ`, zLocked status or the key of an existing part.** Saves store absolute centres with 0.02 m flush tolerances, omit z at the default spread and identify parts by key. Changing any of these silently detaches, clashes or drops parts in old designs and templates. Add a new part instead.
2. **Keep the legacy-twin rules** (`legacyTwin`, `pylonLink`, the clash exemption, `guessHost`, `oldStruts`). Templates and old saves depend on them, and flight builds physics from the same `buildAdjacency` (flight.js:33).
3. The 5e-4 "at default spread" test is shared by parts.js:541 (`legacyTwin`) and :603 (`designRows`), parts3d.js:1191 and combat.js:61 (spread only, att not checked). Keep them in sync. `pylonLink`, `guessHost` and `oldStruts` treat any twin with no att the old way, at any spread; heating (vessel.js:880) uses the continuous distance from the default spread, with no tolerance.
4. `att` is an **index** in saved rows, an **id** in memory, and a peer **id** in MP spawn rows (`mpSpawnRows`, mp.js:35, with its own sanitising). Unknown rows must stay as null placeholders until links are resolved, and `cleanAtt` must run after loading.
5. Always sanitise through `cleanZ`, `cleanSkin` and `hasOwn(PARTS, ...)`: the same rules are reused by vessel.js:1152 (`Vessel.restore`) and mp.js.
6. After any mutation call `changed()`, or `changed(true)` for a live preview. Call `linkMirrors()` after operations that may break or create twins.
7. `loadDesign` replaces every part object. Never hold part references across undo/redo or load.
8. Draw code goes through `drawPart`, never `drawPart0`, or paint is lost. Use the body helpers for paintable surfaces, honour `PartPaint.flat`, and read position from the `q` passed in by `turned()`.
9. For shapes built by parts3d's lathe or extrude recipes (and the chute and cab), outline changes in `partPath0`/`HULLS` also change the 3D geometry, unless the shape has a parts3d `PROFILE` entry. Other recipes (wings, gear, guns, stores, props...) build from the def and use the 2D art only as a texture.
10. The rocket stage logic assumes +y is up (`sp.y < e.y`). Plane parts must keep +y = nose and +x = down so the gear, canopy (−x side) and stores (+x side) drawings stay right.
11. Builder-only state (`mirror`, `selected`, `_primary`, `zGesture`) is not saved. Symmetry is recomputed from geometry.
12. `save()` is skipped while a battle borrows the builder (`MP.savedCareer`). `Builder.mp` changes the stats warnings and the allowed kinds.

## 2. Simulation and flight

All five files are plain globals, loaded in this order by `index.html:332-352`: util, space, terrain, parts, vessel, … career, …, flight, …, main. Everything is in SI units: metres, seconds, kg, N, kelvin and radians. Part *definitions* use tonnes (`def.mass`, `def.fuel`) and kN (`def.thrust`); the runtime converts them with `*1000`, and `p.fuel` is in kg. `G0 = 9.80665` (`util.js:5`) is used for Isp and g-loads. Gravity uses each body's own `mu = surfaceG·R²`.

### 1. space.js: bodies, orbits, prediction

**Bodies** are built by `makeBody` (`space.js:9`). It derives `mu`, `soi = a·(m/M)^0.4`, `n`, `period`, `orbitSpeed`, `terrainMax` (sum of the profile amplitudes + crater depth + |terrainBase|) and `warpAlt`. `warpAlt` is the floor for rails warp and the "low" rails event: `0.6R` for a star, else `atmoHeight`, else `terrainMax + max(1500, 0.02R)`. Every body is on a circular orbit in the sim **XY plane** (`childRel`/`childRelVel`, `space.js:149-157`). `orbitDir = -1` throughout, i.e. clockwise seen from +z, which is the game's "east" (decreasing angle).

| Body | R | g | orbits at | atmo (height, rho0, scaleH) |
|---|---|---|---|---|
| Sun `:32` | 6.0e6 m | 28 | — | star: parts melt below 0.35R altitude (`vessel.js:628`) |
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

**2D terrain profile** (`:177-213`):
- `terrainRaw(b, ang) = terrainBase + Σ amp·sin(k·ang+ph) - craters`. When `b.mapped`, it delegates to `Terrain.earthRaw`.
- `terrainHeight` applies `flats` using smoothstep blends.
- `airDensity` (`:215`): `rho0·exp(-alt/scaleH)`, faded to 0 between 0.8 and 1.0 of `atmoHeight`.
- `surfaceRadius`, `surfaceNormal` and `waterAt` (2D) are no longer used by the physics, which uses `Terrain.*`. `clearZone` (`:195`) is still used by scenery and dust.

**Kepler** (`:227-367`):
- `orbitPlane` takes the angular momentum and flips it so that `e3.z ≥ 0`. `e1` is the sim x axis projected into the plane. An ecliptic orbit therefore uses the plain x/y axes, and its in-plane `dir` (+1 CCW / -1 CW) carries the direction.
- `orbitOf(s, mu)` (`:247`) returns 2D elements from `elementsFromState` plus `e1/e2/e3` and `incl = acos(e3.z)`.
- `elementsFromState` (`:256`) classifies the orbit by **energy**:
  - It clamps `e` to `1∓1e-9` near parabolic.
  - `degenerate` (radial) when `p < r·1e-7`; then only `a/rp/ra` are filled in.
  - Ellipses get `n` and `period`; hyperbolas get `nuMax`.
- Solvers:
  - `nuFromMean` (`:302`): Newton's method. Ellipses use up to 50 iterations, starting from E=π when e>0.8. Hyperbolas use up to 60, starting from asinh.
  - `stateFromNu` (`:325`) lifts the in-plane state back to 3D.
  - `stateAt(o, dt)` (`:340`), `timeToNu` (`:343`, wraps to the next pass for ellipses) and `nuAtRadius` (`:352`).
  - `gravityStep` (`:360`) is a velocity-Verlet step for degenerate orbits.

**Patched conics**: `predictTrajectory(body, state, t0, maxPatches=4)` (`:372`) returns `[{body, o, t0, tEnd, end, next}]`, where `end ∈ impact|escape|encounter|radial|null`.
- `impact` is only tested when `rp < R + terrainMax·0.5`. It uses the descending crossing of radius R.
- `escape` is tested when `e≥1 || ra>soi`.
- `findEncounter` (`:419`) samples the conic up to min(best, period or 4e6 s). The step is bounded by `0.6·soi/(vmax+orbitSpeed)`, with at most 5000 steps, then 32 bisection steps.
- At a patch change the state is converted with `childRel/childRelVel` on x/y only; z and vz carry over unchanged.

Other helpers:
- `closestApproach` (`:451`): 600 samples.
- `transferWindow(r1, ang1, n1, target, t)` (`:474`) gives the Hohmann phase-angle wait and returns `{wait, transferTime, error}`. **It returns the bare number `Infinity` when the rates match.** The HUD tolerates this only by accident.
- `deltaVChart` (`:491`): the rough Δv map, from low orbit at `R + warpAlt + 5 km`.

### 2. terrain.js: the 3D ground (IIFE `Terrain`, exports at `:660`)

**Coordinates**: a surface point is `(a, z)`. `a` is the sim angle in XY (as in 2D) and `z = latitude·R`, metres across the track. Game **east = decreasing a** and game **north = -z**.

**Real Earth placement** (`:86-118`):
- `SITE = {lat 62.16, lon -7.33, head 119}` puts the pad on the west coast of the Faroes, with the game's east bearing 119°. `GM` is the rotation matrix.
- `toGeo(a, phi)` → `{lon, lat}` in radians. It returns the **shared singleton `GEO`** and remembers the last point, so copy the values before the next call.
- `toSim` is the inverse.
- `bearingAt` (`:140`) converts a sim east/north direction into a real compass bearing (used by the HUD compass).
- `CLIFFS`/`cliffs` add sea cliffs on the Faroes and Shetland. `treelessAt` marks treeless ground.

**Map loading**: `loadEarth(urls)` (`:180`) is called from `App.init` with `EARTH_MAP_FILES` (`main.js:392`). Images are decoded with `createImageBitmap(..., {colorSpaceConversion:'none'})` so the bytes come back exact, with `<img>` as a fallback. `height` and `color` are required; the other layers are optional (`opt`). `EM.state` goes `none → loading → ready|failed`. `setEarthData` (`:152`) unpacks the layers:

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
  - `locate(b, rx, ry, rz)` (`:642`) gives `{a, lat, z, r}`.
  - The HUD's "Over France · Paris" comes from `Flight.whereText` (`flight.js:1257`).

**Height model**:
- `cfgOf(b)` (`:409`) builds the per-body config, using `LOOK` (`:46`) and `DIRS`. It is cached in `cfgs`.
- `grid`/`setCol`/`setRow` (`:438-463`) cache the trig per column and per row, so `natural()` (`:490`) evaluates `Σ amp·sin(k·a+ph + kc·phi)` as products. Each profile octave carries on at its own angle off the track.
- On non-mapped bodies, `natural()` turns the profile's craters into round bowls and adds hashed craters (`craters`, `:471`, kept away from the track), detail noise that fades where the grid is coarse, and fbm continents (`contAt`, `:464`) faded in for `|z|` between `c0=1200` and `c1`.
- Mapped Earth uses the map height instead of the continents, then adds the profile's short octaves as hills (`hillW`), a ragged coast (`coastN`), the pad island (`ISLE`, `island()` `:376`, which only adds land), cliffs and `features`.
- `earthRaw(a)` (`:396`) is the same recipe along the equator. It is the 2D profile when the map is loaded.
- `height(c, G, i, j, cont)` (`:575`):
  - Blends natural ground toward the profile height `G.th` by `builtW`. That is 1 within `trackHalf(e)` (`:58`): 25 m in general, 260 m at the pad, 45 m along the runway, 14 m on the causeway. It fades out over `trackBlend`, and aprons are added.
  - Flattens airfields (`fieldAt`, `:536`).
  - Leaves `crDark` behind as a side result (read with `Terrain.dark()`).

**Physics API** (`:591-658`):
- `heightAt(b, a, z)` returns **exactly `terrainHeight(b, a)`** on the track (`|z| ≤ trackHalf`, or 25 m off Earth). Elsewhere it bilinearly interpolates a **2 m lattice cache** `hc` (key `iz·n + ia`, where n = circumference/2 m). The parallel cache `hwc` holds inland water levels. Both are cleared when the body changes or when there are more than 80000 entries.
- `surfaceAt` (`:627`): returns the carrier deck height (`deckAt`, `:562`, polygon `DECK_PLAN`). Otherwise ocean `h<0` gives 0, inland water above the ground gives the water level, and anything else gives `heightAt`.
- `waterAt` (`waterAt3`, `:635`).
- `normalAt` (`:648`): central differences of `surfaceAt` 1.5 m apart. Normals are **not cached**; they come from the cached heights. Decks are flat.

**Time-sliced patches** live in render3d.js:
- `patchJob` (`render3d.js:926`) is a generator that fills a double-buffered patch with `setCol`/`setRow`/`contAt`/`height`, yielding every 8 rows.
- `updatePatch` (`render3d.js:2527`) runs it for 3–4 ms a frame, plus up to 16 ms as the craft nears the patch edge. It calls `buildPatchNow` when nothing usable is on show.
- `bodyJob` (`render3d.js:645`) paints planet maps a few rows per frame the same way.

### 3. vessel.js: the rigid body

**Part space and frames.** Part space is the builder's: +y runs up the stack, x is across, and z is depth, out of the blueprint (a plane's right wing). `q` rotates part space about the centre of mass into sim axes; `av` is the angular velocity in sim axes; positions are relative to the body centre. Placement is done by `placeOnSurface(body, ang, rot, z0, yaw)` (`:1043`): `q = basis(east, up, north) · yaw(about part y) · rot(about part z)`. `rot` comes from `VEHICLE_KINDS[kind].launchRot` (`parts.js:24`). `surfaceFrame().north` (`util.js`) is **+z**, which is to the *right* of east (game south). That is why `heading()` (`:617`) measures from `-north`.

| kind | launchRot | `PILOT` (F nose, U up; R = F×U) `:99` | stick map [W/S, A/D, Q/E], rate rad/s | `DRIVE` `:106` |
|---|---|---|---|---|
| rocket | 0 (y up, x east) | F +y, U +z, R +x | pitch, yaw, roll; 1.1/1.1/1.5 | F +x, U +y |
| plane | −π/2 (nose +y east, belly +x down) | F +y, U −x, R +z | pitch, roll, yaw; 0.9/1.9/0.45 | F +y, U −x |
| heli | 0 | F +x, U +y, R +z | pitch, roll, yaw; 0.9/1.0/1.4 | F +x, U +y |
| car | 0 | F +x, U +y | pitch, roll, yaw; 0.9/1.2/1.2 | F +x, U +y |

**Depth and mass** (helpers in `parts.js:472-522`):
- `partZ(p)` gives a single part's depth, or how far out each copy of a twin pair (`def.twinZ`) sits.
- `partZs` gives the depth of each copy, ±z for a pair.
- `partZc` is 0 for pairs, so a pair never moves the COM across.
- `massZs` (`vessel.js:17`) also splits an axle wheel (`wheel.track`) into its two wheels.
- Wings, legs and fins are z-locked at 0.

`recompute(initial)` (`:159`):
- Computes mass and `com {x, y, z}`. When not `initial`, it shifts `x/y/z` so the **parts stay fixed in space** as the COM moves; this is called after every burn.
- Builds the **full 3×3 inertia** from box parts, with each copy's z offset (`zz` mean square, `zm` mean), and inverts it by blocks: the x–y block, then the Schur complement `s ≥ 1e-3`. With nothing off the centreline the result is *exactly* the old 2×2 inverse and `1/Izz`.
- Sets `bounds`, `width` (x extent), `depth` (z extent) and **`across = max(width, 2·max(|partZ| + partDepth/2) over non-twin parts)`**. A rocket is round about its stack.
- `mulI`, `mulInvI`, `invIWorld` and `bodyAV` are helpers.

`rebuildGroups()` (`:218`) **must run after any change to parts or adj**. It rebuilds:
- `groups` (from `fuelGroups`) and `byId`.
- The nose `top`, which gives `noseAero` and `noseSharp`.
- `wheels`, `fins` (rocket fins), `wings`, `vtails` (shape `vtail`), `airbrakes`, `hasFlaps`, `hasRetract` and `aircraft = wings.length > 0`.
- `mainWing` (largest non-control wing), `stallAoA`, `clS`, `wingS`/`vne`/`mmax` (the design's weakest limits, for the builder; physics uses each wing's own), `rotors` and `tailRotors`.
- It then calls `recompute(false)`, `computeAreas` and `computeHull`.

`computeAreas` (`:248`) gives the projected areas per axis and the gear drag. `computeHull` (`:275`):
- Hull points are box corners at each copy's depth; a `ROUND3D` shape gets a diamond at each end.
- **Rocket** legs and fins also get a copy turned 90° about the stack.
- Wheel points come from `wheelGeom`, for each `massZs` copy.
- It also computes `wheelbase` along `drive.F` and `reach` (max distance from the COM, plus 0.5).

`kind` must be set **before** `rebuildGroups`, because the hull's radial copies and the wheelbase depend on it.

**Step** `physicsStep(dt, sim)` (`:624`), in part axes:
1. **Gravity.** The star check is `:628`.
2. **Engines.** `applyEngines` (`:360`) works per fuel group.
   - Solids burn their own fuel at full thrust. Liquids use `thrust·throttle` and draw fuel in proportion to what each tank holds, scaled down if the fuel runs short.
   - Isp is `lerp(ispVac, ispSL, rho/1.2)`.
   - Air-breathers use `airThrust` (`:79`; nothing below `MIN_AIR = 0.03`; jet/fan/ram/prop curves). The afterburner lights above 0.9 throttle (more thrust; Isp `/ (1+1.6·abK)`).
   - Thrust lies along `partAxis` (in the x–y plane only). Its torque is `r×F` with `rz = partZc - com.z`, so an engine out on one wing yaws the craft.
   - Gimbal authority is `f·sin(gimbal)·|lever|`. A single prop rolls the craft (`-0.035·f·w/2`); twins and contra-props don't.
   - `spinRotors` (`:437`) winds rpm up and down.
3. **Control** (`:642-662`).
   - Authority `A` is the reaction wheels (`def.torque`) + gimbal + rotor torque. On y it is `0.6·rotorTorque` with a tail rotor, 0.15 without. It is halved on wheels; `righting` adds `14·m·width`.
   - `turnTarget` (`:487`) returns the wanted body rates. Then `need = I·(wt−wb)·0.35/dt`: torque goes in up to `A`, and the control-surface command is `need/(surfAuth+A)`.
   - `cmd` slews at 10/s on aircraft.
4. **Aero** (`:674-833`): `dynP`, `airspeed`, `mach` (`soundSpeed`, `:93`).
   - **Rocket drag** (`:680`, "keep as is"): `cd` is 0.32 (aero nose) or 0.62 nose-first, 0.75 tail-first, 1.0 sideways. `area = across·(across·|along| + L·(1−|along|))·0.8`.
   - **Other kinds**: per-axis areas with `cdF`/`cdO`, the car's `cdO` being 0.5. A plane's cross-flow terms are squared. Wave drag (`waveDrag`, `:76`), gear drag and air brakes are added.
   - Parachutes, then weathervaning: `0.04·area·min(L,6)` plus rocket fins below the COM.
5. **Wings in halves.** The local `surf()` (`:739`) handles one surface. Each half has half the area, sits at `±span/4 − com.z`, and its normal leans by the dihedral. Its centre of lift is a quarter chord ahead, less `back` for sweep.
   - Lift is `liftCoef` (`:24`, linear to the stall, then towards `1.1·sin2α`) plus deflection, flaps (+0.8 CL; stall −0.03), ground effect (`1+0.3·e^(−3h/span)`) and `Combat.liftK`.
   - Drag is `cd0 + kInd·CL²` + post-stall + wave terms. Reversed flow is treated as a flat plate.
   - Deflection is `kd·min(1, 26000/q)` toward the commanded torque. Plain wings carry ailerons, `kd = 0.12`.
   - `wingAero` (`:32`): Helmbold lift slope from aspect ratio and sweep, `kInd = 1/(π·0.8·AR)`, stall 0.3, dihedral 0.06, `load = 14000` (70000 for control surfaces) × `w.load` N/m², `vne` 110, `mmax` 0 (no Mach limit; both 0 for control surfaces). The result is cached per def. `swingAero` (`:50`) sweeps the wing with Mach (writes `p.sweep`).
   - Each `vtail` is one surface, a pair counting as twice the area. Then `slip = asin(hz)`.
   - Planes get extra fuselage+fin yaw damping (`:799`).
6. **Structure.** `rr = |Fn|/(load·area)`; fins use `FIN_LOAD = 45000`, and noodle wings ×0.25.
   - Above 1, `stress` builds at `(rr−1)·2·dt` and decays at 0.12/s.
   - The surface is **ripped** when `rr > 1.8`, or `stress ≥ 1`, or noodle wings are over the limit at all. This is reported through `sim.ripParts` at the end of the step.
   - `strain` is the max `rr`; `nz` is the load through the floor.
   - **Flutter** (owner's request, after PR #23 had made overspeed a warning only): for each wing with a `vne`, `r = max(EAS/vne, M/mmax · smoothstep(0.02, 0.06, ρ·1.2/ρ0))`, with `EAS = √(q/0.6)` (the HUD speed at sea level); the Mach limit fades out between about 15.6 and 21.3 km on Earth, so a space plane coming home keeps its wings and both limits ×0.5 for noodle wings and ×√`liftK` for a damaged wing. Above 1, on a craft with its control part that isn't debris (debris doesn't tear from load either), `stress` builds at `((r−1)·3 + 0.12)·dt` (the same stress as the load uses); it rips at `r > 1.3` or `stress ≥ 1`, with `ripWhy = 'speed'` passed to `ripParts`. `overspeed` is the worst wing's `r`. `overWarn` is the same for the warning but, on the way down (`vSpeed < 0`) in the fade, counts the full Mach limit, so a craft coming home too fast is warned high up; `overMach`, whether Mach set the warning.
   - Limits (`vne` as km/h EAS / `mmax`): biplane 560/0.48, glider 500/0.5, long straight 750/0.66, wing and elliptical 850/0.74, small wing 900/0.74, airliner wings 950/1.02–1.05 (the subsonic wings' Mach limits keep their HUD breaking speed about level from sea level to 12 km), swept 1350/1.7, forward-swept 1400/1.8, swing 1550/2.5, delta 1600/none, tailplanes and strakes 2000/none. Moving surfaces, vertical tails and rocket fins have none. Heating caps the delta at high Mach. `structAlert` shows the speed warning before the g one while a wing flutters, unless the load is past its limit too, and counts no flutter stress towards the g level.
   - `gRating() = wingS/(m·g)` (`:614`).
7. **Heat.** `updateHeat` (`:871`): `flux = ρv³·smoothstep(500, 1400, v)`.
   - Above 2e6, each part's `_lead` is its forward extent along the flow, plus the **twin "across" rule**: a single part adds `partZ·sz`; a pair adds `(partZ − twinZ)·|sz|`. A pair at its catalogue spread therefore counts as on the centreline, so stock designs heat exactly as before.
   - Parts within 0.3 m of the front get full flux (`temp += flux·2.8e-6`); the rest get 0.12. Everything cools at `0.08·(T−290)`.
   - Over `def.maxTemp` (default 2000 K, `parts.js:420`), the part breaks via `sim.breakParts(..., 'heat')` and the step returns early.
   - A heat shield is just a part with `maxTemp 4200` placed on the leading face. Pods have 2400–2600.
8. **Integrate** (`:836`): semi-implicit Euler for velocity then position. Euler's equations in body axes include the gyro term `ω×Iω`, body rates are clamped to `MAX_SPIN = 6` rad/s, and `integrateSpin` (`:862`) does a first-order quaternion update with `qnorm` every step. Then `ground()`, then rips.

**Autopilot** (`turnTarget`):
- A heli without wings: the stick sets a target lean (`±0.42` rad) and levels on release; Q/E yaw.
- Stick input is ignored for rotation while on driving wheels.
- Rovers and cars (`sas==='hold'`, no input) level to `normalAt`, with "righting" when on their side.
- `sas` 'off' gives the stick only. `sasHeading` (`:454`; prograde, retrograde, radialOut, radialIn, target) steers the stack axis (+y) with no roll.
- An open chute gives the stick only.
- Wingless non-heli craft hold zero rate: rocket "hold" is rate damping.
- Aircraft go through **`planeTarget`** (`:554`):
  - `hold` keeps the pitch and bank captured at release.
  - `level`/`heading` hold altitude with an attitude loop (`pitchHold` integrator; `ogAutopilot` silly variant). `heading` turns `hdgHold` with A/D at 0.3 rad/s and banks up to 0.45.
  - Always: a **coordinated rudder** (`yaw = g/V·sin(bank)·cos(pitch) + 2.5·slip`; held rudder is limited to about 12° slip), aileron roll scaled down when slow or slipping, low-speed nose-down below `1.35·Vstall` while climbing, a pitch-rate clamp to `[−3g/V, 8g/V]`, ×0.4 on wheels, and AoA protection at 0.85 of the stall.

**Parachutes** (`:699-723`; deploy gate in `Flight.deployChute`, `flight.js:338`: needs air, below 0.85 atmoHeight, refused if `v>250 && q>12000`):
- A drogue opens to 0.3, and the main to 1 below 1500 m above the ground. `cdA += (18+520k²)·chuteArea`.
- The canopy hauls the top of the craft round to trail behind it, and its rate damping is `1.5·I·ω`.
- It is torn off when `q > 25000` and it is more than half open.
- `brakeChute`: tears at `q > 9500` and collapses when stopped.

**Ground and water** `ground(dt, sim)` (`:905`):
- Broad phase uses `reach`, `terrainMax` and the deck.
- Probes hull points (radius 0) and wheel rims, skipping retracted gear. A point deep under a deck edge counts as hitting the ship's `side`.
- **Crash**: the normal closing speed is compared with `breakSpeed` (default `DEFAULT_BREAK_SPEED = 9`; ×1.8 on water) **×1.6 whenever `Combat` is loaded** (always in game). Between 0.75 and 1.6 of the limit, `Combat.impact` dents the part instead. A prop or rotor touching ground with rpm > 8 shatters. Broken parts go to `sim.breakParts(...,'impact')`; the `bouncy` silly setting skips this.
- **Wheels and floats** get anisotropic friction (`mu1` rolling, `mu2` sideways; casters, brake 0.8, floats glide on water). Front wheels steer: `steer = in·min(0.6|0.5, (6|3)·wheelbase/v²)`. Everything else gets isotropic friction of 0.9 (0.15 on water).
- Solver: 4 sequential-impulse iterations (bounce only when `vn < −2`), then a position push-out of 0.9 × the deepest penetration.
- Drive is a speed controller toward `ctl.v·wheel.speed`. Without power, wheels coast down gently.
- In water without floats, velocity damps by `e^(−0.6dt)`.
- `landed` = contact for more than 0.2 s and speed < 1.5. Resting for 0.5 s zeroes the velocity. Flight skips sleeping non-active vessels.

**Splitting** `splitComponents` (`:1094`): keeps the component holding the control part. Each other component becomes a new `Vessel` with the parent's `q`/`av`, `pointVel` velocity, `kind`, `gearUp` and the remaining stages filtered to its parts; `isDebris = !control`. Stages up to the current `stageIdx` are never touched. `serialize`/`restore` (`:1140`, `:1152`): `restore` turns pre-3D saves (`rot`, `w`) into `q`/`av` and puts back `x..vz` after `rebuildGroups`.

### 4. flight.js: the flight scene (`Flight` object)

**From design to vessel**: `Flight.start(design, opts)` (`:28`). The design is `{name, kind, parts: rows}` from `Builder.serialize` / `designRows`.
1. `partsFromDesign` (`parts.js:611`) → `buildAdjacency` → keep `componentOf(findControlPart)` (a control part is required) → drop `att` links whose host was left behind.
2. `new Vessel` (on `EARTH`), set `kind`, `computeStages`, `rebuildGroups`.
3. `placeOnSurface` at `opts.place` (multiplayer spawn: `e, z, yaw, catapult`) or at `EARTH.sites[K.site]`. A plane on floats with no wheels starts in the bay facing π.
4. A heli starts with throttle 0 (the default is 1).
5. Outside multiplayer: `Career.spend`, then `resetState`, the 2D `scale`, and `save()`.

**Loop** `update(rdt)` (`:484`), called from `App.frame` (`main.js:44`; real dt capped at 0.1 there and 0.05 here):
- `WARPS` (`:4`): indices 0..3 (1–8×) are **physics warp**. There are `ceil(total/PHYS_DT)` substeps with `PHYS_DT = 1/120`, or 1/60 at 4× and up. They step the active vessel and vessels within `NEAR_DIST = 6000` m, or controllable craft that are flying below `warpAlt`.
  - Far vessels advance on rails. Uncontrolled ones that would go "low" are deleted.
- Index > 3 is **rails**: `railsTick` → `railsAdvance` (`:655`). This is chunked Kepler propagation with events `low` (`r < R + warpAlt`), `out` and `in` (40-step bisection), and `gravityStep` for radial orbits.
  - `canRails` (`:173`) refuses when engines are burning, or the craft is in the atmosphere or near the surface.
  - Entering rails zeroes `av`.
  - Warp drops automatically if a frame costs more than 14 ms.
- `physicsTick` (`:606`) does `physicsStep`, `checkSOI` (`:621`; re-bases x/y and vx/vy only), the catapult and arrestor wires, `Combat.step`, and `time += h`. Then come `cleanup` (debris further than 150 km goes), `checkMilestones` and audio warnings. Prediction updates every 0.3 s (0.12 s on the map), Δv every 0.5 s, the HUD every 0.08 s, and an autosave every 10 s.

**Controls**:
- Keys are read by `e.code` in `bindDom` (`:939`):
  - `readControls` (`:563`) fills `v.ctl {v, h, r}` from W/S, A/D, Q/E and the arrows, plus the touch stick (`#joy`, 0.12 dead zone) and the `#rot-left/right` buttons. Shift and Ctrl change throttle at 0.9/s; Z and X go to full and cut.
  - Space stages. 1–6 is rocket SAS; 1–4 for planes is hold/level/heading/off (`PLANE_SAS_KEYS`).
  - M toggles the map and N switches the map view. `,` and `.` change warp. `[` and `]` switch vessel.
  - B brakes, F cycles flaps (0/0.5/1), G toggles gear, C resets the camera.
  - V, Tab and K are weapons and countermeasures, L launches the catapult, R recovers, Esc and P open the menu.
- Pointer: drag orbits the 3D camera (`Render3D.orbitBy`), pinch or the mouse wheel zooms, and a tap calls `tapAt` (`:1119`). In 3D that is `Render3D.pickPart`; in 2D it is `hitTest`. `usePart` toggles an engine, fires a separator or opens a chute.
- **There is no gamepad support.**

**Staging and breakage**:
- `stage()` (`:287`): separators first, then engines (if fuelled), then chutes. A chute-only stage that fails to deploy is kept.
- `fireSeparator` (`:311`): `cutSeparator` keeps the separator with the piece that falls away, then the two pieces get a 2.2 m/s relative push and a little tumble.
- `breakParts` (`:352`): removes the parts, splits the rest and calls `onDestroyed` if control is lost.
- **`ripParts(v, parts, cause)`** (`:239`; cause `'g'`, `'speed'`, `'impact'` or a hit, for the toast): takes along each part's `att` chain unless that chain holds the control part, cuts adjacency, then splits.

**HUD** `updateHUD` (`:1273`):
- Altitude, ground (below 5 km), speed (km/h for non-rockets), Mach, AoA/STALL, compass (`compass` via `bearingAt`), damage, g (`nz/gRating`), the `#flight-alert` from `structAlert` (`:1246`: g at strain > 0.85 for planes, speed for anything with wings: amber at max(`overspeed`, `overWarn`) > 0.9, red at `overspeed` > 1; nothing once the craft is lost). While a wing flutters (`smoothstep(0.97, 1.15, overspeed)`, not paused, not lost) `flutterShake` (world.js) shakes the 2D view and the 3D camera, and the wind sound roars.
- Orbit rows are hidden for low aircraft. Also Ap/Pe with times, Δv (`estimateDeltaV`), heat bar, target/window, encounter/escape/impact, stage fuel and stage text.
- Hints come from `hint`/`vehicleHint`.

**Camera**: `updateCamera` (`:1410`) follows the view vessel's *body-relative* position (`camRel`), so a wreck stays in view (the `ghostCam` silly setting reverts this). `viewQ` slerps to the local surface frame, and `viewRot` is used for 2D.

**2D fallback**: `App.use3D()` (`main.js:81`) is false without WebGL, or with the `retro2d` silly setting. `Flight.render` then calls `World.render` (`world.js:304`), which uses `F.scale`, `viewRot`, `camAbs`, `v.rot` (the planar projection of `q`, `vessel.js:154`) and `com.x/y`. The physics is the same 3D simulation either way.

**Saving**:
- `serialize` (`:126`) writes `{v:2, time, design, launchCost, active, flags, stats, target, scale, vessels}` to `store['rss.flight']`. It skips AI craft, dead craft and uncontrolled debris.
- It saves every 10 s, on Save & exit, and on `visibilitychange`/`pagehide`. Nothing is saved in multiplayer.
- It is cleared on revert, recover, a new launch, or destruction with no other controllable craft left.
- `restore` (`:140`) bumps `_partSeq` past the restored ids.
- Recover (`:396`): landed or splashed on Earth, speed < 1.2. It refunds 90% of `value()`.

**Missions hook**: `checkMilestones` (`:784`) raises flags: `liftoff`, `alt1k`, `space`, `soi:/orbit:/land:<id>` (an orbit needs `rp > R+warpAlt` and `ra < soi`), `sunDive`, `escapeSun`, `takeoff`, `flyHigh`, `runwayLanding`, `supersonic`, `mach2`, `seaplane`, `hover`, `drive1k`. Recover adds `recoveredSpace`, `home:<id>` and `splashdown`. `award` (`:773`) → `Career.onFlag` (not in multiplayer).

### 5. career.js

`MISSIONS` (`career.js:4`) has 41 entries: 13 fixed missions, plus flyby/orbit/landing/return for each body (scaled by its tier; no landing or return on Jupiter), plus `escapeSun` and `sunDive`. Each is matched by `flag`.

`Career.data` (`'rss.career'`) holds `mode` (`null` | `'sandbox'` | `'career'`), `funds` (starts at 50000), `tier`, `done` and `flights`. `sandbox` means `mode !== 'career'`: spending, earning and unlocks are no-ops there. `onFlag` marks missions done in both modes, but pays only in career. `buyTier` uses `TIERS` (`parts.js:425`). A launch costs `designCost` of the kept parts, and revert refunds it.

### 6. Invariants and gotchas

- **Old designs must fly exactly as before.**
  - Pairs at their catalogue spread (`legacyTwin`) count as on the centreline for COM (`partZc`), heating (the twin "across" rule) and `across`.
  - The inertia inverse reduces exactly to the 2D case for symmetric craft.
  - `designRows` writes `z` only when it differs from the default.
  - The rocket drag branch is marked "keep as is".
  - Restored pre-3D saves use `rot`/`w`.
  - Any change to mass, hull or heat must leave stock templates unchanged.
- **Keep in sync with parts.js and the renderers.**
  - `ROUND3D` must list the round shapes.
  - `PILOT`/`DRIVE` frames assume `VEHICLE_KINDS.launchRot`. If you add a kind, add both.
  - Physics writes per-part fields that render3d/parts3d/world.js read: `firing`, `ab`, `rpm`, `spin`, `deflect`, `aileron`, `sweep`, `retracted`, `temp`, `deployed`, `used`, `stress`. It also writes vessel fields: `steer`, `brakeOut`, `heatFlux`, `maxHeat`, `aoa`, `nz`, `strain`, `overspeed`, `overWarn`, `overMach`.
  - A new JS file needs a `<script>` tag in `index.html`, a `sw.js` `SHELL` entry (and a `CACHE` bump) and a README layout line; build-single inlines it by itself. A new Earth asset: see §5.9 #3.
- **Shared mutable return values.**
  - In terrain.js: `Terrain.toGeo` (`GEO`), `Terrain.water` (`EW`), `Terrain.dark()`, `lineQuery` (`LQ`), `fieldAt` (`FQ`).
  - In space.js: `bodyPos`/`bodyVel` caches.
  - In vessel.js: `v.surfaceSpot()` (`_loc`) and the module temporaries `_t1.._t4`.
  - Copy these values before making another call.
- **Body and frame conventions.**
  - East is decreasing `a`. Game north is −z.
  - `surfaceFrame().north` is +z, i.e. game south.
  - Bodies move only in XY, so SOI changes never touch `z`/`vz`.
- **`EARTH.terrainMax` changes** from 352 to 1700 when the map loads. That affects the broad-phase ground check and the prediction's impact check. `cfgOf` caches must be cleared when terrain inputs change (`setEarthData` does this).
- **Numerical stability**: `qnorm` every step, `MAX_SPIN`, the `Ixx..≥1` floor and Schur `s ≥ 1e-3`, `e` clamped away from 1, the degenerate-orbit path, bisection for events, 4-iteration contacts plus a 0.9 push-out, rest sleeping, a finite control-surface slew, stress hysteresis, and `dt` caps of 0.1 / 0.05 / 1/120 s.
- **The `sim` contract**: `physicsStep(dt, sim)` needs `toast`, `breakParts`, `ripParts`, `fireSeparator`, `deployChute`, `target`, `time` and `vessels`. Globals `Silly` and (optionally) `Combat` must exist, guarded by `hasCombat()`.
- **Other Vessel users**: AI fighters are Vessels too (`combat.js:883`, `v.ai`, `sas 'off'`). Multiplayer ghosts (`v.remote`) are never stepped; they only coast. Multiplayer forces warp to 0.
- **Ordering**: set `kind` before `rebuildGroups`. Call `rebuildGroups` after any change to `parts` or `adj`. Never call `recompute(true)` on a placed craft; it would lose the "parts fixed in space" shift.

## 3. Rendering

The flight view is 3D (three.js r159, lazy-loaded). The 2D canvas renderer in `world.js` is only a fallback for devices without WebGL, or when the `retro2d` Silly toggle is on. The hangar defaults to a 2D blueprint and has an optional 3D building view. The map has two modes: a 3D globe (WebGL, with a 2D overlay) and a 2D solar-system map. All of this is plain globals and IIFE modules with no imports. `parts3d.js` loads *before* three.js, so it must not touch `THREE` until `init()` runs.

### 0. Who draws what

| Global | File | Role | Entry points |
|---|---|---|---|
| `Render3D` | render3d.js:7 | three.js renderer, flight scene, hangar studio, globe | `load()` 3136, `renderFlight` 2341, `renderBuilder` 2769, `renderGlobe` 3082, `project` 3159, `pickPart` 3171, `designPoint` 3215, `surfaceHit` 3232 |
| `Parts3D` | parts3d.js:6 | Part → mesh: models, materials, plumes, chutes, pylons | `VesselMesh` 1254, `ghost` 1242, `place` 1227, `tint` 1235, `wingAt` 453 |
| `Settings`, `FX`, `World` | world.js:5/31/266 | Settings, particles, 2D fallback flight view, 3D markers overlay | `World.render` 304, `World.drawOverlay3D` 806 |
| `GlobeView` | globe.js:7 | Globe map state and its 2D overlay | `open` 18, `render` 90 |
| `MapView`, `PATCH_COLORS` | map.js:4/6 | 2D solar-system map (also the home screen backdrop, main.js:191) | `render` 133, `drawSystem` 83 |

- **Frame dispatch** (main.js:43-74):
  - Hangar with 3D on: `Render3D.renderBuilder(Builder)`.
  - Flight in 3D: `Flight.updateCamera()`, then `Render3D.renderFlight(Flight)`, then the 2D overlays on the `#view` canvas (`World.drawOverlay3D`, `Combat.drawHUD`, `MPUI.drawHUD`).
  - Globe map: `GlobeView.render`.
  - Otherwise: `Flight.render` → `World.render` or `MapView.render`.
- **Canvas stacking:** `#view3d` (WebGL) sits under `#view` (2D) (index.html:21-22).
- **`App.use3D()`** (main.js:81) returns false if WebGL is unsupported, three.js failed to load, or the context was lost (`webglcontextlost` sets `api.failed`, render3d.js:475).
- **three.js loading:** `load()` injects `js/vendor/three.min.js` unless `window.THREE` already exists. The single-file build inlines it (tools/build-single.mjs:15).

---

### 1. render3d.js

#### 1.1 Setup (`init`, 458)
- **Renderer:** `antialias`, **`logarithmicDepthBuffer: true`**, ACES filmic tone mapping, sRGB output, PCF soft shadows, `autoClear = false`.
- **Cameras:**
  - `camera`: flight. FOV 50 (`FOV`, 8), near 0.05, far 5e12.
  - `bcam`: hangar.
  - `GL.cam`: globe.
- **Scenes:**
  - `spaceScene` > `spaceWorld`: the far layer.
  - `localScene` > `localWorld`: the near layer, with `FogExp2`.
  - `studio`: the hangar.
  - `GL.scene`: the globe.
- **Init order:** `initEnv`, `initSky`, `initBodies`, `initLocal`, `initTerrain`, `initSpaceCentre`, `initParticles`, `initStudio`, then `Parts3D.init(THREE, renderer)` with `Parts3D.envMap = api.envMap` (492).
- **Shared object store:** scene objects live in the closure object `S` (454). The temporaries `V1 V2 Q1 M1 RAY NDC` are reused everywhere, so never hold onto them across calls.
- **Image-based lighting (IBL):**
  - `initEnv` (497) renders a 64-px cube of a gradient sky with a `CubeCamera`. It serves as `localScene.environment` / `studio.environment` and as `envMap` for part materials.
  - `updateEnv` (512) re-renders it only when a colour/sun key changes, at most every 0.4 s. The hangar passes the key `'studio'`.

#### 1.2 Coordinate frames and the floating origin
- **Sim frame:** planets orbit in the sim XY plane, and z is depth out of that plane. Craft positions are body-relative (`v.x, v.y, v.z`). `bodyPos(b, t)` (space.js:159) gives a body's absolute position.
- **Floating origin = the focus `F.camAbs`.** This is the viewed craft (`F.viewVessel`, or the wreck), not the camera.
  - Every object is placed at `abs − camAbs`, in **sim axes**, inside `spaceWorld` or `localWorld`.
  - Both groups carry `F.viewQ` (render3d.js:2352), the sim→view rotation from `Flight.viewFrame` (flight.js:167). It makes local up = +Y, x = east, z = north at the focus.
  - Always do the subtraction in JS doubles before assigning, never in Float32.
- **Camera placement:** the camera orbits the origin at `dist = (H/2)/F.scale/TANH` (2359), so the 2D zoom `F.scale` (px/m) sets the 3D distance. `toView`/`toSim` (2321-2322) convert between frames.
- **Surface "a0 frames"** (used by terrain patches, scenery sets and the cloud frame):
  - Content is built around the point at angle `a0` on the body's equator.
  - Local coordinates: x = `−r·cosφ·sin(a−a0)` (east), y = `r·cosφ·cos(a−a0) − R` (up), z = `r·sinφ` (φ = z/R).
  - `placeFrame(obj, b, a0, t)` (2557) positions the frame and sets `rotation.z = a0 − π/2`.
  - Surface positions are `(a, z)` = sim angle and along-surface depth, from `Terrain.locate` via `focusSpot` (2525).
  - East is *decreasing* angle: `siteAngle(b, east) = padAngle − east/R` (space.js:101).
  - `latK(z, R)` (2526) is the metres-per-radian shrink away from the equator.
- **Space-centre frame:** `surf(e, h, z)` (1412) maps metres east along the curved ground, height and depth into the `S.sc` group at the pad. `updateSpaceCentre` (2627) places that group.
- **Airfield and carrier frames:** u runs along `yaw` and v to the right; `siteE/siteZ` (1762). `siteMatrix` (1765) stands an object on curved ground at any (e, z); `placeSite` (1774) applies it.
- **Part space:** x and y are the 2D blueprint axes, and z runs across the blueprint (+z faces the 2D viewer; +z is the right wing on planes).
  - Flight: `VesselMesh.group` is offset by `−v.com`, and the root takes `v.q` (2672-2673).
  - Hangar: `S.design` is part space, turned about z by `VEHICLE_KINDS[kind].launchRot` and lifted onto the floor.

#### 1.3 Draw order per flight frame
`renderFlight` (2341) runs these steps in order:
1. `applyQuality`, then `adaptResolution`.
2. Copy `camAbs` and `viewQ`.
3. `followCam` and the orbit camera.
4. `updatePatch`.
5. Clamp the camera above `groundAt` / `shipTop`.
6. Sky uniforms and stars.
7. `updateBodies`.
8. Local lights, fog and in-cloud murk.
9. `updateEnv`.
10. `updateSpaceCentre`, `updateScenery`, `updateClouds`.
11. `syncVessels` (engine light and sheath), `vaporCone`, `updateParticles`, `syncCombat`.
12. Fit the shadow camera to the active craft (`half = max(25, ext·2.5)`).
13. `runJobs(4 | 2.5 ms)`.
14. Render `spaceScene`, then `clearDepth()`, then render `localScene`.

`api.skipDraw` runs every step except the draw calls (for tests).

`renderOrder` values:
- Far layer: sky −10, Milky Way band −9.5, stars −9, cloud deck 1, atmosphere 2, haze dome 50.
- Near layer: ocean/inland water 1, cumulus 3, vapour cone 4, smoke 5, fire 6, tracers 7.
- Hangar CoM/CoL markers: 20/21.

#### 1.4 Sky, Sun, stars, lights
- **Sky dome** (`initSky` 521, `SKY_FS` 249): radius 1000, follows the camera, `depthTest: false`.
  - Zenith/horizon mix, with a horizon dip `uDip` that grows with altitude.
  - Sunset tint by azimuth, glare lobes around the Sun.
- **`S.haze`:** the same shader as a translucent dome (renderOrder 50) that veils planets while you are inside an atmosphere.
- **Sky colours:** `envAt` (2298) and `skyColors` (2314) duplicate the 2D `World.environment` (world.js:279) and its sky mix.
- **Stars:** 3000 points at 1e5 m (a third of them in a band), plus the `BAND_FS` sphere. Alpha = `1 − lum(zenith)·3.2`.
- **Sun:** `SUN_FS` with limb darkening on a procedural `sunTexture` (628), plus an additive glow sprite.
- **Lights:**
  - The far layer has `S.sunS` and `S.ambS`.
  - The near layer has `S.sun` (casts shadows when `Settings.high`), `S.hemi`, and `S.engine`, a point light at the active craft's weighted exhaust (`engineGlow` 2682).
  - The sun direction leans out of the ecliptic by `TILT = 0.26` (11).

#### 1.5 Planets (far layer, `initBodies` 566)
- **Geometry:** one shared `sphereGeo(160, 80)` (144) with **z as the pole**. Each body has its own `MeshStandardMaterial`.
- **Textures** are generator jobs, time-sliced by `runJobs` (745):
  - `bodyJob` (645) paints colour and normal maps (plus a roughness map for oceans and a night-lights emissive map on mapped Earth) from the **same terrain field and `paint()` function** as the near terrain.
  - Sizes: 2048 for mapped Earth, 1024 when R ≥ 50 km, else 512. All are halved on low quality.
  - Earth waits until `Terrain.earthMap.state !== 'loading'`.
  - `finishJob` (749) forces completion once a planet covers more than 40 px.
  - The night-lights emissive is masked to the dark side through an `onBeforeCompile` hook (714).
- **Atmosphere shell:** `ATM_FS`, additive, radius `R + 1.6·atmoHeight`.
- **Cloud deck** (`e.deck`):
  - Earth: an fbm texture from `cloudJob` (725) at 5 km altitude. It fades in only above 8-14 km camera altitude, where cumulus puffs stop.
  - Hazy worlds: the planet map at 0.75·atmoHeight.
- **Re-parenting:** deck and atmosphere move into `localWorld` while their body is current and the patch is active (2503-2509), so they depth-sort with the terrain.
- **Distant bodies:** below about 2 px a body becomes a dot (`S.dots`, `GLOW_FS`), and below 0.6 px its mesh is hidden.

#### 1.6 Terrain streaming
- **Double buffering:** two patch slots, `patch` (on show) and `patchB` (being built) (786-787). Each slot has three meshes:
  - `mesh`: ground, vertex colours plus a 12 m detail map and normal map, and an `aNight` attribute for city glow.
  - `ocean`: the sea-level sphere, RGBA vertex colours with foam.
  - `inland`: lakes and rivers at their own level, mapped Earth only.
- **Grid** (`allocSlot` 877): (2n+1)×(2m+1) vertices, n,m = 96,56 on high and 64,36 on low. Spacing is `sign(u)|u|^2.2·span` (`PW`, 9): dense under the craft, coarse at the horizon.
- **`patchJob`** (926) is a generator that yields every row:
  - Samples continents every 4th vertex (every vertex on mapped Earth) and interpolates.
  - Heights come from `Terrain.height`, the same function the physics uses.
  - Colours come from `paint(tex=false)` (59). On top of that it paints farmland, urban blocks/streets, roads, river banks, far water and airfield grass.
  - Noise octaves fade to their mean once cells outgrow them (anti-aliasing).
  - UVs are offset by `a0, z0 mod TILE` so the detail texture does not swim when the patch is rebuilt.
  - Custom bounding spheres are centred on the middle vertex (1043), which fixes culling at high latitude.
- **`updatePatch`** (2527) decides when to rebuild:
  - `span ≈ horizon + sqrt(2R·hmax) + 1.5·dist`.
  - *Stale* (moved > 1.2 % of span, or span off by ×1.6): start a background `patchJob` with a budget of 3-4 ms, plus up to 16 ms more as the craft nears the edge.
  - *Lost* (other body, moved > 25 %, or span off by ×3): `buildPatchNow` (1116) runs synchronously, at most every 0.12 s; otherwise the patch is hidden.
  - When the job finishes, `swapPatch` (1109) swaps the slots and marks scenery dirty.
- **`meshHeight(b, a, z)`** (1128) bilinearly samples the *rendered* patch (null outside it). `groundAt` (1136) falls back to `h3dAt`. The camera clamp and all scenery seating use these.
- **`fieldGround`** (1099) keeps rendered ground under airfield paving.

#### 1.7 Water
- **Ocean:** `terr.oceanMat` (803): transparent, roughness 0.08, a ripple `normalMap`, `envMapIntensity` 1.2. The colour runs shallow→deep by depth and goes deep for far cells. Surf foam comes from `depth/tan(slope)`.
- **Inland water:** `inland` vertices sit at `Terrain.water.level` where there is water. Elsewhere they are tucked 6 m under the ground with alpha 0. Rivers only appear on fine cells (< 160 m).
- **Water seen from space:** ocean shine comes from the planet roughness map.
- **Note:** the ocean and inland geometries have no `uv` attribute (`mk()`, 892), so the ripple normal map likely has no visible effect. Add UVs before tuning ripples.

#### 1.8 Scenery (`sceneryJob` 1166; two sets in `S.scen`, swapped by `swapScenery` 1342)
- **What it places:**
  - **Trees:** near and far LOD `InstancedMesh`es (far = one low-poly crown beyond 380/260 m). Placement follows the green of the Blue Marble on Earth (`vegOf`/`bioAt`) and skips track, airfields (`keepClear` 1813), treeless isles, and roads/rivers/lakes/towns (`offFeature`).
  - **Real cities:** from `Terrain.citiesNear`, on a 30 m plot grid visited nearest-first (`spiral` 1155). Towers appear only downtown in cities over 600 k people.
  - **Villages:** hashed 1.4 km cells.
  - **Boats.**
  - **Rocks:** on rocky bodies.
  - **City lights:** `Points` with `GLOW_FS`.
- **Seating:** everything sits on `meshHeight`.
- **Capacities:** 7000 per tree mesh / walls / roofs / lights, rocks 5000, boats 200. The loops stop silently at their caps.
- **`updateScenery`** (2565): shown only near the ground, when `dist < 9 km`. The radius is `clamp(3·dist + 600, 800, 2400)`.
  - Background rebuild budget: 2-3 ms, plus up to 30 ms.
  - Synchronous rebuild on another body or when moved > 80 % of the radius (at most every 0.3 s).
- Farmland, roads and urban grey are terrain vertex colours, not geometry.

#### 1.9 Clouds (lit cumulus)
- **Layout:** `cumulusJob` (1358) uses a hashed 750 m grid out to 15 km (9 km on low). Bases are 1.4-3.6 km up, with fewer and bigger puffs far off.
  - **The grid row through the flight plane (q = 0) uses `hash1(i, s)`, the same seeds as the 2D `World.drawClouds`.**
  - The layout also produces flythrough ellipsoids (`vols`).
- **Puffs:** one `InstancedMesh` of camera-facing quads (`CLOUD_MAX` 6000), using `CLOUD_VS/FS` (309/326) and a 2×2 atlas (`cloudAtlas` 343) whose RGB is a baked normal and whose alpha is density. They are lit by the Sun, with darker bases, forward scattering and fog.
- **Sorting:** `sortPuffs` (1389) re-sorts far-to-near every 0.2 s.
- **`updateClouds`** (2589): Earth only, camera altitude < 12 km.
  - Rebuild synchronously beyond 6 km of movement, in the background beyond 1.5 km.
  - Drift is `F.time·2e-6` rad, matching the 2D clouds and the deck.
  - Inside a volume, `S.clouds.inside` thickens the fog to white murk.

#### 1.10 Space centre, landmarks, airfields, carriers
- **`initSpaceCentre`** (1416) builds the pad, lattice tower, VAB and mission control (facade canvases with emissive window maps in `S.nightMats`), dish, water tower, flag, slabs, helipad, runway and causeway strips (`strip`, which follows the curved ground), and the hangar and tower.
  - Glow points (`glowPts`, `S.glowU`) and blinking beacons (`S.blinkU`).
  - Building positions mirror `World.drawSpaceCenter` (world.js:569).
- **`initLandmarks`** (1649) is deferred until the Earth map loads; `S.scKit` is cleared first, so it runs once even if it throws. It builds:
  - `initAirfields` (1859): runway numbered by real bearing, apron side chosen by `fieldLayout` (1840, cached in a WeakMap), hangars, ops, tower, tanks, parked jets (`addJet` 1965), windsock, lights.
  - `initCarriers` (1987): `carrierGeo` (2026) is cached per size: lofted hull, a 2048×512 painted deck, island, turning radar (`S.radars`), numbers.
  - Lighthouse with a night beam, wind turbines (`S.rotors`), tank farm, pier and boat, and the Shetland port town.
- **Data sources:** `EARTH.airfields` and `EARTH.carriers` (space.js:88/94).
- **`depthBias(mat, k)`** (1802) pulls paving towards the camera in the vertex shader, because the log depth buffer ignores `polygonOffset`.
- **`shipTop`** (1820) keeps the camera out of the carriers.

#### 1.11 Vessels, plasma, vapour cone, particles, combat
- **`syncVessels`** (2650): a `Map` from Vessel to `{vm: Parts3D.VesselMesh, root}`.
  - Rockets get `radial: true`.
  - Hidden when farther than 50 km *and* under 1 px.
  - **Disposed the first frame a vessel is not iterated** (dead, or no parts).
- **`sheath`** (2713): reentry plasma when `heatFlux > 3e7`. This duplicates the 2D sheath in `World.drawVessel`.
- **`vaporCone`** (2693): a lathe bell along the velocity vector. It grows with `effectMach` from 0.85 to 1, flashes as the craft crosses Mach 1, and fades out by Mach 1.2. It is scaled by air density/0.5, and `S.vaporK` eases (rising rate 9, falling rate 3).
- **Particles** (`initParticles` 2201, `updateParticles` 2226): `FX.list` from world.js drawn as two instanced quad meshes of 1100 each, smoke (normal blending, fogged) and fire (additive).
  - `'ring'` uses the shader's ring mode.
  - `'fire'` turns to smoke after 45 % of its life.
  - A random depth jitter `p.jz` is added lazily.
- **Combat** (`syncCombat` 2954): tracer `LineSegments` plus head points (700), pooled missile/rocket/bomb models, and target models within 30 km (they become wrecks when destroyed).

#### 1.12 Cameras
- **Flight follow camera:** `fc` (2292).
  - Default offsets by kind come from `CAM0` (2325): beside rockets (looking along part +z, so the side the blueprint faces), behind planes, cars and helis.
  - `followCam` (2326) eases the heading at a rate of 2.2/s.
- **Hangar turntable:** `bc`.
- **Shared controls:** `orbitBy` (3188) clamps pitch to −1.25..1.45. `resetCamera` (3195) returns the short way round. Spectating is just `F.viewVessel`.
- There is no cockpit or free camera.

#### 1.13 Quality and adaptive resolution
- **`adaptResolution`** (2873): when the frame-time EMA exceeds 1/42 s, the pixel ratio scale drops by 0.08, down to 0.55. Below 1/57 s it rises by 0.04. It changes at most every 0.6 s. The base ratio is `min(DPR, 1.75)` on high and 1 on low.
- **`applyQuality`** (2883) reacts to a `Settings.high` flip: shadows, a fresh `allocPatch`, invalidated scenery and clouds, and a resize.

What `Settings.high` (world.js:9) changes:

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

`Render3D.info()` (3123) returns draw stats plus `t`, the rebuild costs from `note`/`timed` (917-924, 2908).

---

### 2. Hangar 3D building view (render3d.js:2727-2867, API 3201-3257)
- **`renderBuilder`** (2769) uses the `studio` scene (gradient background, fog, 5 m-grid floor, hemisphere/key/rim lights).
  - **The `VesselMesh` is rebuilt only when `snap` changes:** part count, kind, and per part `id,type,flip,skin` (2778). It also rebuilds when the parts array itself is replaced (undo, redo, load: `bd.parts !== B.parts`, 2779). Moving, depth changes and turns are cheap, because `place()` runs every `sync`.
  - Parts not attached to the control part get `setOpacity(p, 0.4)`.
- **Tints** (2790-2799) go into the material's emissive channel:

  | State | Colour, k |
  |---|---|
  | Hover | amber, 0.18 |
  | Selection | amber, 0.42 |
  | **Host glow** (`B.drag.host`, the part a drag will attach to) | cyan [0.3, 0.85, 1], 0.3 |
  | Invalid drop (incl. mirror and group) | red, 1.1 |

- **Ghosts:** `syncGhosts` (2749) takes `B.ghosts()` and builds `Parts3D.ghost(p, radial)` rigs: 60 % opacity, no shadows, plus the radial twin.
  - A ghost is rebuilt only when `type,rot,flip,radial,skin` changes; otherwise it is moved with `Parts3D.place`.
  - Tinted blue when `ok`, red otherwise.
- **`builderLayout`** (2732) applies `launchRot`, lifts the lowest point to the floor, and computes size and centre. These are eased, then **frozen during a drag** (`editView(true)`, 3243).
- **Camera:**
  - Auto-spins at 0.25 rad/s until grabbed.
  - In edit mode the yaw is clamped within ±0.8 rad of facing the blueprint.
  - Distance comes from `B.cam.scale` (default 26 px/m).
  - `setViewOffset` centres the craft in `B.viewArea()`.
  - `panBy` (3249) moves the target.
- **Markers:** `builderMarkers` (2845) draws CoM and, for planes, CoL at a fixed ~7 px, with `depthTest: false`.
- **Screen ↔ part-space helpers:**
  - `designToScreen(x, y, z)` (3203): part space → CSS px, or null if behind the camera.
  - `designPoint(cx, cy, z0)` (3215): ray onto the plane z = z0 (S.design only turns about z, so its z is world z) → `{x, y, z, mpp}`. Returns null when edge-on (`|dir.z| < 0.1`) or behind.
  - `surfaceHit(cx, cy, skip)` (3232): `vm.pickHit` → `{part, x, y, z, nx, ny, nz, mpp, side}`, in part space with the normal facing the ray. `side` is ±1 for the copy of a twin pair. Radial copies are ignored. builder.js:1691 feeds it to `Builder.attach` (521).
  - `pickPart` (3171): in the hangar, `vm.pick` (radial copies count). In flight it raycasts vessels, active craft first.

---

### 3. parts3d.js: part → mesh

**Pipeline.** `buildPart(p, builder, radial)` (1065) calls `model(def, flip, skin)` (842).
- `model` picks a builder via `recipe(d)` (835): the `d.body3d` override (unused by any def today), then `'box'` for side separators, then `RECIPE[d.shape]`, then `'lathe'` for shapes in `LATHE`, then `'extrude'` as the default (`smokegen`, `flares` and `fin` end up here).
- `BUILD[recipe](d, flip, skin)` (508) returns a **node**: `{pieces: [[geometry, kind]], subs: [...], anim}`. `node()` (499) merges the pieces per material kind (`merge` 342).
- **The model is cached in `models`** under the key `type + '|f'? + '|s:skin'?`, where the skin is included only for `SKIN_GEO` recipes (wing, biplane).
- `instance()` (1039) turns the node into Meshes and Groups with **per-part materials** (`rig.mats[kind]`), so heat glow, tint and opacity stay per part.

**Shapes.**
- `outline()` (199) records the 2D `partPath0` through a fake canvas, `recorder()` (105). It supports only moveTo, lineTo, bezier, quadratic, arc, ellipse, rect, roundRect (treated as rect), closePath, save/restore and transforms; any other call is a silent no-op.
- `PROFILE` (156) overrides the silhouette for aircraft shapes, so a canopy drawn in 2D never gets revolved into the hull.
- `latheGeo` (231) revolves the outline's horizontal extent per height, with creases (`CREASE` 0.45 rad), caps, holes (nozzles) and steps. It projects the 2D art from the front, inset slightly so the outline stroke does not smear round the sides.
- `extrudeGeo` (321) with `projUV` (308) handles flat parts. The depth is `d.depth || FLAT_DEPTH || min(w, 1)`.
- `d.facets` gives faceted stealth hulls.
- Wings: `wingGeo` (428) lofts NACA sections with `sweep` (390) and bakes vertex colours (body, darker leading edge, tip bands). It handles taper (default 0.45), sweep, dihedral, elliptical planform, winglets, and swing halves. `wingAt` (453) is its analytic twin (used by builder.js:403/410).

**Recipes** (`BUILD`):

| Recipe | What it builds |
|---|---|
| `lathe` 567 | Revolved hulls plus extras: nozzle, nuclear fins, probe antennas/dish, glass cut (`glassnose`, `bubble`), canopies and helmets, intakes, airliner windows, float struts, jet intake/fan/nozzle |
| `gun` | Receiver and barrel, or a spinning multi-barrel |
| `store` | Pylon plus gun/rocket pod, or missiles/bombs/torpedoes as `store` sub-nodes |
| `chute` | Canister plus `lid` |
| `wing`, `biplane`, `vtail` | Airfoil lofts |
| `prop`, `rotor`, `tailRotor` | Blades (`bladeGeo`) on `spin` subs plus a blur `disc` |
| `wheel`, `gear` | `wheelNode` cached by r and W; `wheelPair` adds a cosmetic second wheel at ±track |
| `leg`, `rcs`, `girder`, `airbrake`, `chassis`, `cab`, `rotodome`, `skid`, `ecm`, `turret`, `drone`, `box`, `extrude` | Dedicated models |

**Materials** (`makeMat` 897, `KINDS` 13).
- Textured kinds (`map: true`: hull, metal, gold, shield, sep) take `textureFor(def, flip, skin)` (882). That is a `CanvasTexture` of `drawPart` painted with `PartPaint.flat = true` (no fake shading), 64 px/m clamped to 16..512 (power of two). It is drawn 8× offset as an edge bleed.
- **The texture cache key is `type + '|f'? + '|s:' + cleanSkin`.** Textures are never disposed.
- `vc` = vertex colours. `disc` = shared blur texture (opacity animated). `lamp`/`tail` = `MeshBasicMaterial`. `glass`/`goldglass` are transparent with `userData.glass`.
- `userData.c0` stores the base colour that heat glow returns to.

**Paint (skins) in 3D.** `cleanSkin` (parts.js:882) drops skins on `NO_SKIN` shapes.
- Textured kinds get the skin painted into their texture, and the skin's `rough`/`metal` (else hull finish, so a painted engine is no longer polished metal).
- `BODY_KINDS` (58), the solid body colours, become `S.base`.
- Wings and biplanes bake the skin into their geometry (model per skin). `skinTip` (92) mirrors the 2D `accent()`.
- Fittings, glass, tyres, nozzles, hazard stripes and helmets keep their own colours.
- Pylons use `pylonMat` (1174): the pod's skin, else the material the old pylons borrowed.

**Mirroring, twins and depth** (`place` 1227, which runs **every `sync`**, so part x/y/z/rot changes never need a rebuild):
- `p.flip` builds the left-hand model (`|f` cache key; legs, fins, gear and rcs use `s = flip ? −1 : 1`).
- `ZMIRROR` recipes (63: tailRotor, drone, prop, wheel, gear; plus the `bubble` shape) on a single part at z < −0.01 get `root.scale.z = −1`. A prop on that side therefore turns the other way, as in the physics.
- `def.twinZ` gives two holder groups at `±partZ(p)` (`userData.side` ∓1). The root sits at z = 0, and each holder gets its own plume.
- Rocket legs and fins (`radial`) get `rig.twin`, rotated 90° about the stack. It is flagged `userData.radial` and is for show only (the physics adds the same copies).
- Pusher props turn π; `p.rot` turns in quarter steps.

**Pylons** (`pylonsFor` 1185; rebuilt when `VesselMesh.pylons` (1273) sees a layout signature change from x, y, rot, flip, z, att or skin):
- Parts get struts if they are a twin pod, `d.pod`, an ECM pod, or attached (`p.att`). Floats and skids are excluded (they carry their own struts).
- `attStruts` (1146) runs to the att host, else the nearest part's `partBoxes`. Against a wing it uses `wingStrut` (1163): no strut if the chord runs over the pod.
- `oldStruts` (1117) handles legacy twin pods without `att`.
- Geometries are per rig and disposed in `dropPylons`.

**Plumes and chutes.**
- `makePlume` (999) uses a shared grid geometry shaped *in the vertex shader* (`PLUME_VS` 919: a quadratic Bezier profile `uP0..uP2`, `frustumCulled = false`). It has outer and core layers, a glow sprite, and 4 shock diamonds (kero, solid or spike plumes, or an afterburner), all additive and not tone-mapped.
- Length, spread, the vacuum widening and the colour table `PLUMES` (65) **duplicate `World.drawFlame`** (world.js:737).
- `makeCanopy` (1026) builds a dome (scale.y 0.42) with gores and 12 lines, scaled by `p.deployed`.

**Animations** (`update` 1327). Sub-node roles from `instance()` (1052):

| Role / field | Driven by |
|---|---|
| `spin` (axis per sub), `spinRev` | `p.spin` if numeric, else `fspin += throttle·anim.rate·dt` (`anim.always`: rotodome; `anim.tail`: tail rotor follows the main rotor's `firing`) |
| `disc` opacity | Measured spin rate, `anim.disc = [lo, hi, max]` |
| `droop` | Rotor rate (blades lift as they speed up) |
| `pivot` | `rotation.z = p.deflect` (elevators, airbrake) |
| `swingP` / `swingN` | `p.sweep − swing[0]` |
| `yaw` / `pitch` | `p.aimYaw` / `p.aimEl` (turret) |
| `store` | Visible count from `p.ammo`, alternating sides |
| `lid`, canopy | `p.deployed`, `p.used` |
| Retractable wheels | `root.visible = !p.retracted` |
| Heat glow, `emissive` (1092) | `p.temp > 900` → orange-to-white emissive, paint chars; a firing nozzle glows |

**`VesselMesh` API** (1254): `new VesselMesh(parts, {builder, radial})`.
- Fields: `.group`, `.items` (part → rig), `.list`, `.pickables`, `.exhaust` (nozzle points used by `engineGlow`).
- `sync(v, {dt, time, rho, quality})` adds new parts, prunes vanished ones, rebuilds pylons and re-applies `envMap`. In the builder it is called with `{parts: B.parts}`.
- Other methods: `pickHit(raycaster, skip, radial)`, `pick`, `setTint`, `setOpacity`, `dispose()`.
- Builder mode creates no plumes or canopies.
- Module API (1449): `init`, `textureFor`, `wingAt`, `buildPart`, `VesselMesh`, `ghost`, `place`, `tint`, `freeGhost`.

---

### 4. world.js
- **`Settings`** (5) is persisted in `rss.settings`. `Settings.high` means `quality !== 'low'`. **`hash1`** (12) is shared with the 3D cumulus.
- **`FX`** (31) holds the particle list for both renderers.
  - Kinds: `smoke`, `spark`, `flash`, `ring`, `fire`, `plasma` (2D only; in 3D it takes the default branch).
  - Body-relative `{b, x, y, z, vx...}`. `FX.update` (77) applies drag, plus gravity for `heavy` particles and sparks.
  - Emitters: `puff`, `sparks`, `explosion`, `splash`.
  - The list is capped at `FX.max()` by dropping the oldest particles.
- **3D markers:** `World.drawOverlay3D` (806) projects prograde/retrograde/target glyphs on a sphere around the craft with `Render3D.project` and `metresPerPixelAt`. `markersFor` (826) is shared with the 2D view.
- **2D fallback flight view:** `World.render` (304) draws:
  - sky gradient, stars and sun glare;
  - `drawBody` (396): a disc via `paintBodyDisc` (165) when small, else a 360/720-sample terrain profile with strata, beaches, ocean and the night gradient;
  - `drawScenery` and `drawClouds`;
  - `drawSpaceCenter` / `drawAirfield`;
  - particles;
  - vessels (`drawPart` in `sideOrder`, plus the plasma sheath);
  - night and haze tints;
  - plumes (`drawFlame`, additive);
  - markers.
- `earthDisc` (147) and `paintBodyDisc` are also used by `MapView`.

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
- **`renderGlobe`** (render3d.js:3082): a lit sphere reusing the planet's map.
  - Near the mapped Earth (alt < 0.45R), `tileJob` (3033) paints a sharp hill-shaded `DataTexture` tile with faded edges on a curved 40×40 patch lifted R·1e-4. Its budget is 10 ms per frame, and it rebuilds when the view leaves the tile.
  - Returns false if 3D isn't ready. Without 3D the map is forced to `'system'` (flight.js:1112).
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
- **Caches:** `models`, `textures`, `wheelNode`, carrier geometry per size, `boatGeoCache`, `spirals`, `fxColor`, `LAY`, the `envKey` throttle.
- **Level of detail:** low-poly far trees, planet dots, pixel-size visibility for meshes and vessels, octave fade, averaged field colours far off, continent subsampling.
- **Shadows** only on high, with the shadow camera fitted to the craft.
- **Adaptive pixel ratio.**
- **Telemetry:** `Render3D.info().t`.

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
   - Parts3D `models` and `textures` are shared and must never be disposed per part. `freeRig` (1216) disposes only per-part materials, plume materials and pylons.
   - Combat target models are removed without disposing (a small leak).
7. **Cache keys must cover what geometry depends on.** A model depends only on def, flip and (for wings) skin. If a new per-part property changes the geometry, add it to the `model()`/`textureFor()` keys, to the builder `snap` (2778), to the ghost key (2752) and to the pylon signature (1276).
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

   The wing planform formula lives in `wingGeo`, `wingAt`, `oldStruts.holds` (1125) and builder.js.
9. **The emissive channel is shared** by heat glow (`emissive`) and builder tints (`tint`).
10. **Decorative meshes in a rig** must either be pickable (in `rig.meshes` with `userData.part`) or set `raycast = noop`, like plumes, discs, chute lines and the lighthouse beam.
11. **Quality-dependent buffers** must be reallocated in `applyQuality`. If you raise a placement cap, raise the `InstancedMesh` capacity too.
12. **parts3d.js top level must not reference `THREE`.** Use `need()`.

### 8. Adding a 3D model for a new part
1. **Define the part** in `PARTS` (parts.js:39) with a `shape`, and draw it in `partPath0`/`drawPart0`. The 2D art becomes its texture automatically.
2. **Body of revolution:** add the shape to `LATHE` (and to `LATHE_KIND` if it isn't `hull`). Add a `PROFILE` entry if the 2D path has bits that shouldn't revolve. Add extras in `BUILD.lathe`'s per-shape branch.
3. **Flat part:** nothing to do (`extrude`). Set `def.depth` or `FLAT_DEPTH`.
4. **Bespoke model:** write `BUILD.myRecipe(d, flip, skin)` that returns `node([[geometry, 'kind'], ...], subs, {anim})`.
   - Frame: origin at the part centre, +y = the part's up, x = 2D x, z = across, in metres.
   - Mirror with `s = flip ? −1 : 1`.
   - Build geometry from def, flip and skin only (it is cached).
   - Register it in `RECIPE[shape]`, or set `def.body3d`.
5. **Materials:** use existing `KINDS`, or add one. Add it to `BODY_KINDS` if it is the paintable body colour. If colours are baked into the geometry, add the recipe to `SKIN_GEO` and honour `skin`.
6. **Animation:** use a sub-node `role` (table in §3) and `anim` (`rate`, `disc`, `always`, `tail`). A new role needs a branch in `update()`; unknown roles land on `rig[role]`.
7. **Lopsided left/right model:** add it to `ZMIRROR`.
8. **Automatic features:** `twinZ` gives pairs, `pod` or `att` gives pylons, `thrust` + `plume` gives plumes (add new plume colours to `PLUMES` *and* `World.drawFlame`), `chute` gives a canopy.
9. **Test** in the 3D hangar (`V`): attach, ghost, tint, paint, flip and depth drag. Then test in flight: animation, heat, plume, picking. Then check that the 2D fallback still draws.

## 4. Combat and multiplayer

Files: `js/combat.js` (global `Combat`), `js/net.js` (`Net`), `js/mp.js` (`MP`), `js/mpui.js` (`MPUI`), plus vendored PeerJS 1.5.4 at `js/vendor/peer.min.js`. Load order (index.html:345-351) puts combat.js after globe.js and before builder.js. peer.min.js, net.js, mp.js and mpui.js load after flight.js and before main.js. Each file is a plain script whose top-level `const`s are globals, so they are reachable from the devtools console. If you add a file, also add it to the `SHELL` list in `sw.js` and bump its `CACHE` name.

### Where the game calls in

| Call | From | When |
|---|---|---|
| `Combat.step(h, F)` | flight.js:617 (`physicsTick`) | Every physics substep: firing, projectiles, flares |
| `Combat.frame(F, dt)` | flight.js:515 | Every frame: targets, AI, warnings, locks, smoke |
| `Combat.drawHUD` / `MPUI.drawHUD` | main.js:65-66 | 2D overlay canvas |
| `Combat.reset(F)` | flight.js:94 (`resetState`), mp.js:553 | New flight; module state is a singleton |
| `Combat.impact` | vessel.js:942 | Hard-landing dents |
| `Combat.engineK` / `liftK` | vessel.js:410, vessel.js:758 | Damaged engines and wings |
| `MP.beforeUpdate(dt)` | flight.js:488 | Pose the ghosts before physics |
| `MP.afterUpdate()`, `MP.syncMissiles()` | flight.js:529 | Send snapshots after physics |
| `MP.onLocalDestroyed()` | flight.js:377 (`onDestroyed`) | The local craft is lost |

Remote craft are skipped by physics (flight.js:502). They only coast along their velocity on each substep (flight.js:614).

---

### 1. combat.js

**Mode.** `mode()` (combat.js:27) reads `Settings.get('targets')`, which is `practice`, `hostile` or `off`. It is forced to `'off'` whenever `MP.active` (combat.js:26), so a multiplayer room never has range targets, SAMs or AI fighters. Any new AI or target code must check `mpOn()` too.

#### 1.1 Weapon parts (parts.js:347-405)

`weapon.ammo` counts **both copies** of a twin pair. `each` is the kg released per round: `p.store = ammo*each`, and the mass is recomputed when `each >= 10`.

| Type (line) | Kind | twinZ | Stats |
|---|---|---|---|
| `gun` 350 | gun | – | 600 rds, 16/s, 880 m/s, dmg 9, spread .004 |
| `cannon` 353 | gun | – | 180, 8/s, 1000 m/s, dmg 34, **blast 3** (every shell explodes) |
| `gunPods` 356 | gun | 2.4 | 800, 24/s, 900 m/s, dmg 9 |
| `gatling` 380 | gun | – | 1100, 60/s, 1050 m/s, dmg 24, `barrels: 7` (spins) |
| `turret` 383 | turret | – | 800, 12/s, 900 m/s, dmg 8, range 1100; fires on its own |
| `rocketPods` 359 | rocket | 3.1 | 14 rockets, 6/s ripple, 60 m/s + 700 m/s² for 1.1 s, dmg 110, blast 9 |
| `aam` 362 | missile `seek:'air'` (IR) | 3.6 | range 5 km, cone .35, accel 260, burn 3, vmax 900, 30 g, dmg 400, blast 15, life 18 |
| `radarMissiles` 365 | missile air `radar:true` (SARH) | 2.4 | 15 km, cone .6, burn 5, vmax 1300, 25 g, dmg 450, blast 16, life 30 |
| `agm` 368 | missile `seek:'ground'` | 2.9 | 8 km, burn 4, vmax 700, 18 g, dmg 900, blast 20 |
| `glideBombs` 392 | missile ground `glide`, label GBU | 2.9 | 12 km, no motor, vmax 420, 5 g, dmg 1300, blast 28, life 90 |
| `harm` 398 | missile `seek:'radar'`, label ARM | 2.6 | 22 km, cone .8; locks only `emitter` targets |
| `cruiseMissile` 401 | missile ground, label CRUISE | – | 30 km, accel 45 for 140 s, vmax 270, dmg 2600, blast 40, life 150 |
| `bombs` 371 / `bombL` 374 | bomb | 2.7 / – | 1200 dmg, 30 m blast / 4000 dmg, 55 m blast |
| `bombBay` 386 | bomb, `bay:true`, stealth .5 | – | 4×250 kg released from the belly |
| `clusterBombs` 389 | bomb `cluster:24` | 2.7 | bursts 150 m up into 24 bomblets (dmg 220, blast 10 each) |
| `torpedo` 395 | bomb `torpedo` | 2.6 | dmg 2200, blast 16 |
| `flares` 377 | flare | – | 30 |
| `ecm` 404 | (no `weapon`) `ecm:true` | – | Jammer and missile warner |

Related defs:
- `radar` reach in metres: cockpitJet 12000, cockpitTandem 10000, cockpitStealth 14000, droneCore 6000, radome 16000, rotodome 45000.
- `armor`: fuselageArmor 0.6.
- `stealth`: cockpitStealth and fuselageStealth 0.6, bombBay 0.5.
- Optional air-to-air overrides read by `airframe()`: `drag`, `bleed`, `gimbal`, `track`, `arm`, `irccm`.

#### 1.2 Weapon systems and firing

- **`systems(v)`** (combat.js:157) groups weapon parts by `p.type`, so all guns of one type fire together. Flares and turrets are excluded. The result is cached on `v._ws`, keyed by `parts.length`. `v.wsel` is the selected index, and `cycle()` (combat.js:1149) changes it (Tab).
- **Trigger** (`step` combat.js:420, `playerFrame` combat.js:349):
  - Guns fire while the trigger is held. Each part keeps its own `p.cool`.
  - Rockets ripple one per `1/rate` through `nextStore`.
  - Missiles and bombs release once per trigger press (rising edge, or `F.fireTap`).
- **`zAt(p, side)`** (combat.js:187): a twin copy sits at `side * partZ(p)`; a single part sits at `partZ(p)`. Twin `p.z` is the spread, always ≥ 0 (parts.js:499-508).
- **`muzzle(p, side)`** (combat.js:189) gives the release point in part space:
  - bay: below the belly at `w*0.6`, alternating ±0.6 by ammo parity;
  - stores and pods: offset `w*0.12`;
  - guns: the tip (`h/2`).
- **`nextSide(p)`** (combat.js:200):
  - a single part fires from the side it sits on (`sideOf(partZ)`);
  - twin rockets alternate `-(p.side||1)`;
  - twin missiles and bombs go right on even ammo and left on odd. This must match the store-visibility formula in parts3d.js:1349-1352.
- **`nextStore(sys)`** (combat.js:204) chooses among parts with ammo. It prefers a part whose next side differs from `sys.last`, then the smallest `relN` (the rack that has waited longest). `release()` (combat.js:211) decrements ammo and updates `p.store`.
- **`fireGun`** (combat.js:219):
  - Twin guns alternate `p.side` every round.
  - **Convergence:** a muzzle with `|z| > 0.3` is toed in by `cz = -m.z/600`, so the rounds meet 600 m ahead. That is where the HUD pipper sits (combat.js:1095).
  - Random spread on each axis; rounds live 3 s; a tracer every 3rd round (every round for exploding shells).
  - With `net=true` it fires show rounds: `dmg: 0`, and `s.net` set so they skip hit tests.
- **`fireRocket`** (combat.js:241): starts at `w.speed`, motor from t=0. **`launchMissile`** (combat.js:253): dropped at +4 m/s "down" (a plane's part +x), no motor and no guidance for the first 0.35 s. **`dropBomb`** (combat.js:266): +2 m/s down. In multiplayer, rockets and bombs call `MP.sendShot` and missiles call `MP.sendMissile`.
- **`turretStep`** (combat.js:307):
  - aims at the nearest air candidate within `range`, leading it;
  - slews at 2.5 rad/s;
  - fires once within 0.06 rad;
  - `p.aimYaw`, `p.aimEl` and `p.gunOn` are replicated through `pv`.

#### 1.3 Projectiles (`moveShot` combat.js:464)

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
- A cluster bomb bursts 150 m above the ground after 1 s (`burst` combat.js:556).
- A torpedo hitting water at ≤110 m/s becomes `k:'torp'` (`swim` combat.js:568). It runs at 30 m/s, 1.2 m under the surface, homing on the nearest **range sea target** within 4 km. There are no such targets in multiplayer, so torpedoes cannot hurt players.

Part hit boxes (`boxesOf` combat.js:81):
- every part: its `partRect`;
- across (z): a twin copy is ±`max(w,0.6)/2`, a wheel ±`track/2+0.3`, anything else ±`partDepth/2`;
- one box per entry of `partZs(p)`.

`hitVessel` returns early when the segment's closest approach to the vessel is more than `reach+2` away.

#### 1.4 Missile guidance and how to beat it

**Lock** (combat.js:358-378):
- Candidates come from `candidates(v, seek)` (combat.js:400):
  - for `air`: AI bandits, air drones, and enemy ghosts that are not landed and not cars;
  - for ground seekers: ground targets, plus enemy ghosts that are landed or are cars. The `radar` seeker (ARM) takes emitter targets only, never players.
  - Ghosts flagged `hiddenUntilSnap` are excluded.
- Minimum range: 350 m air, 150 m ground. The candidate must be inside `w.cone`.
- Range comes from `rangeOf` (combat.js:172): radar missiles get `min(range, own radar)`, or 5 km without a radar.
- IR range is further scaled by `clamp(√irSig, 0.2, 1)`.
- SARH needs `radarSees === true`, and holds its lock anywhere the radar sees the target unless `chaffBreaks` (combat.js:387) fires.
- Lock time is 0.9 s for IR and 1.4 s for radar, doubled against a jammer.

**`airframe(w)`** (combat.js:606) defaults, IR / radar:
- drag 1.6e-4 / 1.1e-4
- gimbal 0.6 / 1.1 rad
- track rate 0.7 / 1.0 rad/s
- bleed 0.012, arm 0.6 s, irccm 0, PN gain `nav` 4

**`guideAir`** (combat.js:668) uses proportional navigation. Maximum pull is `turn·g·min(1, q/QREF)` with `QREF = ½·1.225·400²` (combat.js:605). Energy losses are in `moveShot` (combat.js:478-481): steep drag above `vmax`, and bleed ∝ g² scaled by `QREF/q`, so turns cost more in thin air.

The target is dropped (`s.target = null`, missile flies dumb) when:
- the motor has burnt out and speed is below 150 m/s;
- the line of sight leaves the gimbal;
- the line-of-sight rate exceeds `track` for more than 0.25 s while farther than 60 m;
- for SARH: the launcher's radar loses the target for more than 1 s (a notch gets 0.4 s of grace);
- a decoy wins.

**Beating missiles:**
- **Energy:** short burn, then drag and turn bleed.
- **IR signature** (`irSig` combat.js:615): `Σ firing·thrust·(1+1.5·ab)` (props and rotors ×0.5) `/120 + 0.08`. It scales by aspect: tail 1, side 0.35, head-on 0.1, or 0.3 with the afterburner lit.
- **Flares** (`decoyed` combat.js:651): each flare is judged once per missile (`s.cm` WeakSet), within 0.3 rad of the line of sight. `K = 0.3·(1 − t/3)`, and the chance is `min(.85, K/(K+irSig))·(1−irccm)`. Throttling back helps.
- **Chaff** (radar missiles): a cloud within 250 m of the target. Chance 0.6 if the target's radial speed is under 80 m/s (beaming), else 0.15. Chaff can also break a lock (combat.js:387).
- **Notching** (`radarSees` combat.js:634): radar reach is `(radar||5000)·(1−stealth)`, and the target must be within 60° of the launcher's nose. A low target (50 m below the launcher, or under 300 m above the ground) moving at less than 40 m/s radially returns `'notch'`.
- **ECM** (`jams` combat.js:185):
  - radar reach ×0.7 beyond 5 km (minimum 5 km);
  - radar lock time ×2;
  - AA spread 0.012→0.03;
  - local enemy missiles more than 1.2 km away lose their target at 0.35/s (combat.js:442). That only affects SAM and AI missiles, never multiplayer ones;
  - in multiplayer it acts as a heat-seeker warner within 2 km.
- **Stealth** (`stealthOf` combat.js:175): area-weighted `def.stealth` over the hull, minus 0.12 per external store, pod or ECM pod still carrying ammo, clamped to 0..0.75. Paint never counts.

**Warnings** (combat.js:998-1008):
- Solo: any enemy missile targeting you warns, and flares fire automatically under 2.2 km (every 0.6 s).
- Multiplayer: no auto flares, so press `K` (`countermeasures` combat.js:297, limited to one use per 0.6 s). Radar missiles warn; heat seekers are silent unless you carry ECM and they are within 2 km.
- A radar lock on another player calls `MP.sendLock` (combat.js:1015-1016), re-sent every 1 s, and drives their RWR.

**Ground seekers:** `guide()` (combat.js:704) is lead pursuit with `tgo ≤ 12 s`, turn rate `turn·g/v`, and `vmax` as a hard cap.

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
  - Parts with thrust, more than 50 kg of fuel, rocket/missile/bomb ammo, or `control` go through `sim.breakParts` (an explosion). Everything else goes through `sim.ripParts` (torn off as debris; flight.js:239, 352).
  - Fuel over 500 kg adds a blast of radius `4+√(fuel/n)·0.08`, dmg 45.
  - Remaining stores blast at radius `blast·0.6`, dmg `dmg·0.5/count`.
  - **A legacy twin pair** (spread equal to `def.twinZ` within 5e-4) **blasts once**, at the centre (z = 0).
  - **A split twin** (any other spread) **blasts at each copy**, with fuel and store damage divided by the number of blast points. If only one store of a pair is left, it blasts only on the side due to fire next.
  - These secondary blasts carry `by = null`, so they never credit anyone and never reach remote craft.
- **`explode(b, at, blast, dmg, by, sim, quiet)`** (combat.js:127):
  - Falloff `dmg·(1 − d/blast)^1.5`, where d is the distance to the nearest copy of the part minus `max(w,h)/2`.
  - If `by` is the local player's craft: blasts of 8 m or more go out as `MP.sendBoom`, and remote craft in range collect `[part, dmg]` lists, sent as one `MP.sendHits(..., 'blast')` per craft.
  - Range targets are skipped in multiplayer.
- **Crash damage** happens in `Vessel.ground` (vessel.js:905-942):
  - the limit is `breakSpeed` (default 9, vessel.js:9), ×1.8 on water;
  - with combat loaded, a part breaks above 1.6× the limit and dents above 0.75× (`Combat.impact` combat.js:70: `maxHp·(ratio−0.75)·1.6`, at most once per 0.4 s per part);
  - a spinning prop or rotor touching the ground shatters;
  - the silly flag `bouncy` disables dents.
- **Smoke and leaks** (combat.js:1017-1033), for craft within 5 km, ghosts included: smoke below 60% health, fire below 30%, fuel leaks below 50%. `integrity(v)` (combat.js:1168) feeds the HUD.

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
| ship (Frigate) | 3200 | aa, emitter |
| drone | 140 | air, 75 m/s orbits |

- **Layout and spawning:** counts come from `TARGET_LAYOUT` (combat.js:19). Targets spawn when the player is on Earth within 60 km of `at(8000,0,0)` and the terrain map is ready (combat.js:964-968).
- **Placement** (`place` combat.js:811) uses a seeded RNG:
  - land: 45% on Shetland, else the Faroes; height 2–220 m, off the runway and space centre, gentle slope;
  - sea: depth below −12 m;
  - drones orbit a 900–1800 m radius at 500–1400 m.
- Dead targets respawn elsewhere after 60 s.

**Hostile mode:**
- **AA** (`aaFire` combat.js:860): fires 3 s out of every 7 when the player is within `3500·(1−0.6·stealth)`. Tracers at 850 m/s, dmg 6, leading the player.
- **SAM** (`samFire` combat.js:871): fires when the player is within `9000·(1−stealth)` and above 150 m. First launch after 4 s, then every 22 s, one missile in the air per site. The missile is an IR seeker: burn 5, accel 220, vmax 950, 22 g, dmg 300, blast 13, arm 0.4 s.
- **Fighters:**
  - `RAIDER` (combat.js:21) is a Falcon-like jet layout with a cannon and flares.
  - `spawnFighter` (combat.js:883) places one 12–16 km away and 1.5–2.5 km up, flying at 230 m/s.
  - At most 2 alive. Spawning repeats every 45 s (the first after 20 s, from `reset`) and needs the player airborne.
  - **`flyFighter`** (combat.js:913):
    - engages within `16 km·(1−stealth)` using lead pursuit;
    - otherwise orbits `at(9000,0,2500)`;
    - ground avoidance takes priority;
    - bank-to-turn: roll the lift onto the target, then pull;
    - fires its gun when `d < 1100` and the aim is off by less than 0.05 rad;
    - drops flares against missiles within 1.8 km.
  - Losing its control part calls `aiDown`. Fighters are removed when the mode is not hostile or the player leaves the range.
- **Kills:** `S.kills` counts kills where `by === F.active`.

The HUD (`drawHUD` combat.js:1046) draws target brackets, Bandit diamonds, the seeker circle and LOCK, a 600 m gun pipper and LEAD marker, the bombsight (`bombImpact` combat.js:1133), and the MISSILE warning.

---

### 2. net.js: transport

- **Constants:**
  - `NET_VERSION = 2` (net.js:9). Version 2 added part depth, paint and host (`att`) to spawn rows. The host rejects a `hello` with any other `ver` (net.js:110).
  - `NET_MAX_BYTES = 256 KB` (net.js:10): the host drops, without relaying, any client message whose `JSON.stringify` length is larger (net.js:127). The host's own sends and clients' sends are not size-checked.
  - Room codes are 5 characters from `ROOM_CHARS` (net.js:11; no I, O, 0 or 1). `cleanCode` accepts 4–8 characters.
  - `PEER_PREFIX = 'rss-room-'` (net.js:12).
- **Transports** (`N.transport`):
  - `'p2p'`: PeerJS on the public PeerJS cloud. The host registers peer id `rss-room-CODE` and retries with a new code up to 3 times on `unavailable-id`. It reconnects to the signalling server 1.5 s after a disconnect. Connections are `{reliable: true, serialization: 'json'}`.
  - `'local'`: a `BroadcastChannel('rss-room-'+CODE)` carrying envelopes `{to:'H'|cid, from:cid, msg}`. Clients pick a random `cid`.
- **Star topology:**
  - The host is pid 1; clients get pid 2, 3, … from `accept()` (net.js:109).
  - `N.send(msg, to?)` (net.js:48) stamps `msg.f = N.me`. Clients send only to the host. The host's `route()` (net.js:56) forwards to `to`, or to everyone except the sender, and emits locally.
  - **The host overwrites `msg.f` with the real sender's pid** (net.js:128).
  - The host never relays client messages whose type is in `HOST_ONLY` = `{hello, welcome, reject, ping, closed, join, leave, warn, state, result}` (net.js:24). Clients ignore those types unless `f === 1` (net.js:194). `result` is listed but never sent.
- **Handshake:**
  1. Client sends `hello {name, ver}`.
  2. Host replies `welcome {pid, code, names}` or `reject {reason}`: wrong version, room locked (`N.lock`, set during PvP phases), or full.
  3. The host emits a local `join`.
- **Limits:** `maxPlayers` is 5 for sandbox and 6 for PvP (mp.js:85). The client gives up after 15 s; `MP.join` then waits up to 8 s for the first `state`.
- **Pings and clock:**
  - Every 2 s the host sends `ping {ts, rtt}` to each link. The client replies `pong {ts}`, and the host stores `N.pings.set(pid, rtt)`.
  - The client estimates `hostOffset` as the median of the last 7 samples of `ts + rtt/2 − now`.
  - `N.hostNow()` = `performance.now() + hostOffset`. Use it for every shared deadline (`s.ends`, `th`, `battleAt`).
- **Timeouts:**
  - The host drops a link silent for 20 s.
  - A client closes after 25 s without hearing from the host (`watch` net.js:234).
  - `pagehide` calls `N.leave()`. Leaving sends `bye` (client) or `closed` to everyone (host), then destroys the connection after 300 ms.
- **Events:** `N.on(type, fn)` (net.js:31). Each handler runs inside try/catch (net.js:36), so a throwing handler only logs. `join`, `leave` and `warn` are emitted locally only.

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
- The host's `MP.state` is the truth. `push()` (mp.js:243) sends the whole object as `state` and applies it locally. Clients deep-copy it in `applyState` (mp.js:259) and accept it only from `f===1` (mp.js:161).
- State shape:
  - `{mode, phase, ends, endsLen, round, result, settings, players[], feed[], t0, t0At, tod, battleAt, sides, format}`
  - each player: `{pid, name, team, ready, spawn, alive, kills, deaths, dmg, ping, kind, flying}`
- Clients change only their own row through `set {k, v}`, validated per key in `applySet` (mp.js:212). The allowed keys are `ready`, `spawn` (must be in `spawnsFor`), `kind`, `flying`, `team` (lobby only), `name` (≤18 characters) and `dmg` (clamped to 0..20000 per report).
- Only the host changes settings (`setSetting` mp.js:231, lobby only). Switching format re-deals teams: in FFA, `team = pid`.
- While in a room, `pushCareer`/`popCareer` (mp.js:133-152) swap out the player's career and saved blueprint, and `Builder.save` is suppressed (builder.js:195). `setMoney` turns the budget into career funds.

**Modes and phases:**
- `sandbox`: phase `free` for the whole session. Anyone can hurt anyone. Respawn is allowed (`respawn` mp.js:541). Everyone shares a clock: `sandboxTime()` = `t0 + elapsed host time`.
- `pvp` runs these phases, with timers set by `setPhase` (mp.js:320) and advanced from `tick()` (250 ms `setInterval`, so it keeps going in background tabs):
  1. `lobby` → `startMatch` (mp.js:311)
  2. `build` (`settings.build` s)
  3. `test` (60 s, solo flight, only if `settings.test`; with test off, build goes straight to battle)
  4. `polish` (`settings.polish` s, only after a test phase)
  5. `battle` (`settings.limit` s)
  6. `results` → `backToLobby` (mp.js:387)
- When everyone is ready in `build` or `polish`, `ends` is set to 3 s from now; it is restored if someone un-readies (`maybeAllReady` mp.js:332).
- **Win** (`checkWin` mp.js:366): the battle ends 3.5 s after at most one team (in FFA, team = pid) is still alive, unless only one side started (a solo try-out). On time (`finish` mp.js:375), the winner is the side with the most players still flying, then the most kills; otherwise it is a draw.
- `hostile(a, b)` (mp.js:74) decides who can hurt whom: enemies, or teammates with friendly fire on. `enemy(a, b)` (mp.js:79) decides what can be locked and tagged; teammates are never enemies.
- Silly flags are off throughout a PvP room, in every phase (`Silly.on` checks `MP.pvp`, util.js:143); sandbox rooms keep them. Time warp is disabled in every room (flight.js:183, flight.js:490), and the flight menu does not pause (`openMpMenu` flight.js:448).

**Budgets and limits:**
- `budgetFor` = `settings.budget`, ×1.3 at a carrier spawn (mp.js:413).
- `designProblems` (mp.js:431) reports:
  - more than 600 parts (any mode);
  - over budget;
  - a kind other than plane, heli or car;
  - for carriers: not a plane or heli, span over 13 m, length over 16 m, or mass over 12 t.
- `measure` (mp.js:420): span is the extent of `partZs` ± half-depth (twins ±`max(w,.6)/2`); length is the y extent; mass is the sum of `partKg`.
- `battleDesign` (mp.js:449) swaps a failing design for the first stock template (`mustang`, `camel`, `skylark`) that passes.
- These checks run **only on the owner's machine**. Peers never re-check budgets.

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
- `spawnsFor` and `defaultSpawn` (mp.js:396-411): in FFA, the default is the base fewest players picked.
- `placement` (mp.js:556): the slot is the player's index among teammates at the same spawn, sorted by pid.
  - Sandbox: offset 220 m along the runway, or ±35 m steps at the helipad.
  - `airfieldPlacement` (mp.js:926): planes at the threshold, 230 m apart.
  - `carrierPlacement` (mp.js:933): two bow catapults at ±6 m, queue 40 m back; helis on the aft deck. `catapult: {length, speed: 78}` is armed for planes only (flight.js:56); press L to launch.

**Our craft → the others** (`sendSpawn` mp.js:576, `afterUpdate` mp.js:594):
- **Spawn rows** `[id, type, x, y, rot, flip, z, att, skin]`:
  - x, y and z are rounded to 3 decimals; z is `partZ(p)`, which is the positive spread for twins;
  - `att` is the host part's id, or 0;
  - `skin` is the paint id, or 0.
- **Snapshot `s`** at 15 Hz, sent whenever this player is in the shared world: `th` (host ms), `b` (body id), `P`, `V` (0.01 precision), `Q` (w,x,y,z), `W` (body-frame angular velocity), `C` (**centre of mass x, y, z**), `g` (gear up), `l` (landed).
- **`pv`** at 5 Hz, only changed rows plus everything every 2 s: `[id, deflect, firing, ab, retracted, sweep, aimYaw, aimEl, ammo, deployed, used, gunOn]`. Only parts with wing, thrust, weapon, chute or retractable wheels are sent. The receiver's `irSig` depends on `firing` and `ab`.
- **`hp`** every 500 ms when anything changed: `[id, percent]`.
- **`parts`**: the list of remaining ids whenever the part count changes.

**`mpSpawnRows(list)`** (mp.js:36) sanitises an incoming spawn:
- The whole spawn is rejected if `list` is not an array or has more than `MP_MAX_PARTS` rows.
- A row is dropped if its id is not a positive safe integer, is a duplicate, names an unknown `PARTS` type (`hasOwn`), or has non-finite x/y.
- x/y are clamped to ±500 and `rot` masked with `&3`. `flip` becomes 0/1, `z` goes through `cleanZ`, `skin` through `cleanSkin || 0`.
- `att` is kept only if it names an id seen in the same spawn, then `cleanAtt` breaks self-links and loops.
- Only clean rows are stored: `onSpawn` keeps `P.design = {kind, parts}` and never the raw message.

**Ghosts:**
- **`buildGhost`** (mp.js:691) creates parts with `makePart`, then **overwrites `p.id` with the owner's id**, so hits name the owner's parts. It builds a `Vessel` with `buildAdjacency` and sets `v.remote = pid`, `sas = 'off'`, full ammo and `hiddenUntilSnap`.
- **`onSnap`** (mp.js:729):
  - validates the message with `mpNums` (`C` may have 3 or 2 values) and `mpBody`, and requires `|Q| > 0.5`;
  - if no design is known yet, it asks the owner with `want`, at most every 3 s; the owner answers through `resendSpawn`.
- **`poseGhost`** (mp.js:738) dead-reckons to `age = clamp(hostNow − th, 0, 0.75 s)` along `V` and `W`:
  - it snaps on the first snapshot or when more than 60 m off, otherwise eases (`dt·10`, slerp `dt·14`);
  - **`C` is accepted only within `reach + 1` of `com0`**, the centre of mass when the ghost was built. A forged centre of mass would otherwise move the hit boxes away from the craft (`toWorld` subtracts `com`, vessel.js:311).
- A ghost silent for more than 6 s freezes in place (`beforeUpdate` mp.js:762).
- The radar warner (`rwr`) entries expire after 2.5 s.

**Hits and kills:**
- **The shooter is authoritative for hits**, judged against its own copy of the target ghost.
  - A projectile or blast reaching a remote craft calls `MP.sendHit`/`sendHits` (mp.js:830) → `hit {to, list: [[partId, dmg]], k}`, sent to that player only and only if the pair is `hostile`.
  - The shooter counts the damage toward its score: the host adds it directly; clients batch it as `set dmg` about once a second.
- **The victim applies the damage** (`onHit` mp.js:840):
  - requires `m.to === me` and a hostile sender;
  - at most 64 rows, each capped at 5000;
  - looks up part ids in **every** local non-AI vessel, because the part may have broken off into debris;
  - sets `lastHitBy` before applying damage.
- **The victim reports its own death** (`onLocalDestroyed` mp.js:634): `down {by, P}`, where `by` is the last hitter if the hit was within 20 s.
- The host's `recordDown` (mp.js:663) books deaths, kills and the kill feed (`feed`, 12 entries), then runs `checkWin`.
- Booms (`sendBoom`, blast ≥ 8) are for visuals only.

**Missiles and other fire:**
- The shooter flies the real missile with full guidance against the ghost. It announces it with `msl {id, b, P, V, D, tg, radar, glide, agm}`, then streams `mp` at 10 Hz and sends `mx` when it is gone (`syncMissiles` mp.js:885).
- Receivers fly a replica (`netMissile` combat.js:733): dmg 0, eased toward each update over 0.15 s (it jumps if more than 400 m off), and dropped 3 s after the last update. If `tg === me` and the shooter is hostile, the replica targets our craft, which drives our warning.
- Our flares travel as `cm {P, V, chaff}`. On the shooter's machine they enter `S.flares`, where its missile may be decoyed. That is how flares work across the network.
- Guns send only `gun {k: partType, on}`; receivers fire show rounds from the ghost (`netGuns` combat.js:451). Turrets use `gunOn` from `pv`.
- Rockets and bombs send `shot`, and receivers fly a dmg-0 copy (`netShot` combat.js:726). Copies have fixed blast sizes and do not burst into cluster bomblets.

**Leavers:**
- Net `leave` → `onLeave` (mp.js:199): explode and drop the ghost, delete the peer and its RWR entry. On the host it also removes the player row, adds a feed line, runs `checkWin` in battle or `maybeAllReady` in build/polish, and pushes.
- Peers missing from a new `state` are also dropped (mp.js:265).
- If the host leaves, the room closes (`closed`), and `MP.end` (mp.js:117) returns everyone home.

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

**Game messages** (handlers bound in `bind` mp.js:159-186):

| Type | Sender → receivers | Handler |
|---|---|---|
| `state` | host → all | `applyState` |
| `set` | client → host | `applySet` |
| `chat` | → all | `MPUI.chat` |
| `spawn` / `despawn` / `want` | owner ↔ | `onSpawn`, drop ghost, `resendSpawn` |
| `s` / `pv` / `parts` / `hp` | owner → all | `onSnap`, `onPartVis`, `onParts`, `onHp` |
| `down` | victim → all | `onDown` (mp.js:815) |
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
  - Create sandbox / Create battle / Join; only one attempt at a time (`this.connecting` token).
- **Lobby** (`refresh` mpui.js:119):
  - `renderPlayers` (mpui.js:130): team columns with Join buttons and open slots, ping, host tag;
  - `renderSettings` (mpui.js:164): editable by the host in the lobby only — format, money $45k/$75k/$120k, build 2/3/5 min, test flight, carriers, friendly fire (not FFA), time of day, limit 10/15/25 min;
  - `start` (mpui.js:97): asks before starting alone or with uneven teams; refuses if a team is empty.
- **Phase bar** `#mp-bar` (`renderBar` mpui.js:218, `tick` mpui.js:237):
  - phase name, timer from `s.ends − Net.hostNow()`, "urgent" under 15 s;
  - an info line: cost against budget, spawn and ready count while building; teams alive in battle;
  - Ready, Spawn and Score buttons.
- **Spawn map** `#spawn-map` (mpui.js:263-377):
  - `MAP` bounds e −9000..31000, z −9000..21000;
  - `bakeMap` colours the map from Terrain;
  - `pickSpawn` (mpui.js:354) updates `Builder.mp` budget, limits and money.
- **Chat:** lobby log, plus in flight `T`/`Enter` → `#mp-hud-input`. Text is inserted with `createTextNode`. Sends are capped at 140 characters.
- **Kill feed:** `notice` (mpui.js:389) → `#mp-feed`, 5 lines, fading after 5 s.
- **Scoreboard:** hold `` ` `` or press Score (`showScore` mpui.js:414).
- **Results:** a locked modal (`MP.modalLocked`, main.js:20). The host gets "Back to the lobby".
- **In flight** (`drawHUD` mpui.js:462):
  - name tags: gold in the sandbox, blue (filled) for friends, red (outlined) for enemies;
  - `spotted` (mpui.js:512): enemies show within `6 km·(1−0.5·stealth)`, or on our own radar within 60° of the nose;
  - RWR ring with a "RADAR LOCK" label;
  - heading-up 8 km scope (`drawRadar` mpui.js:524), only when the screen is at least 761 px wide.
- **Spectating** after being shot down in battle: `spectate` (mpui.js:454) cycles ghosts, teammates first, with `[`/`]`, or with a tap on touch (flight.js:1133). The camera uses `Flight.viewVessel` (flight.js:1409).
- On the map and globe, enemies are hidden in PvP (`mapColor` mp.js:915).

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
  - the meaning of message fields.
- **Validate everything from peers.** Use `mpNums`, `mpBody`, `vec`, `hasOwn(PARTS, …)`, clamps and slices, and look up ids through Maps. Never put a peer string into `innerHTML` (`UI.modal` renders a string `body` as HTML; toasts and `el({text})` are safe).
  - Keep `mpSpawnRows` in step with `partsFromDesign`, `cleanAtt` and `cleanSkin` (parts.js:611-639, parts.js:882).
  - Known gap: `onDown` reads `m.P` unchecked (mp.js:819). A malformed message throws inside the handler (caught), which skips the ghost drop and `recordDown`.
- **New host-only message types** go in `HOST_ONLY`, and their handler should also check `m.f === 1`.
- **Damage authority:**
  - `Combat.damage` must stay a no-op for `v.remote`.
  - Any new damage source must route remote victims through `explode()`/`MP.sendHits` with a `by` the local player owns. Otherwise it deals nothing, or double-counts.
  - Never renumber parts of a flying craft: hit messages and `pv`/`hp`/`parts` all use the owner's part ids.
- **Centre of mass:** snapshots must carry the centre-of-mass z (`C[2]`), or asymmetric craft get offset hit boxes. Keep the `com0`/reach bound.
- **Store order:** `nextSide` parity must match the store visibility in parts3d.js:1349. `weapon.ammo` counts both copies of a pair, and `destroyPart`'s store-blast logic depends on that.
- **Wall-clock rates:** snapshot and state rates use `performance.now()`. Shared deadlines use `Net.hostNow()`. Simulation time is per-peer, and time warp is forced off.
- **Combat state is a module singleton.** `Combat.reset` must run on every new flight and on `MP.leaveFlight`.
- **AI is off in rooms.** Range targets, SAMs, fighters and auto flares are off in any room via `mpOn()`. Torpedoes and ARMs therefore have nothing to hit in multiplayer.

## 5. App shell, UI, settings, packaging and deployment

Scope: `index.html`, `css/style.css`, `js/main.js`, `js/ui.js`, `js/util.js`, `js/audio.js`, `sw.js`, `manifest.webmanifest`, `tools/build-single.mjs`, `tools/bake-earth.py`, `.github/workflows/pages.yml`, `README.md`, `.gitignore`. The git remote is `DevWolf11/Overbuilt` (renamed from `Cam-Strike`, then `Rocket-Science-Simulator`). A local folder may still be called `Cam-Strike` because the repo used to hold a 5v5 FPS, and that history is still in git (README.md:141, last FPS commit `30e7bc8`). Work goes onto branches and reaches `main` through PRs; merging deploys.

### 1. Page structure, script order, global namespace

**DOM skeleton (index.html):**
- Two full-screen canvases: `#view3d` (WebGL/three.js, :21) sits under `#view` (2D, :22). DOM order sets the stacking; there is no z-index.
  - `#view` draws the whole game in 2D fallback mode and the hangar blueprint.
  - In 3D it is cleared every frame and carries only the HUD overlays.
- Four screen containers, all `class="ui"`: `#home` (:25), `#mp-ui` (:58), `#build-ui` (:116), `#flight-ui` (:201).
- Multiplayer overlays sit at body level (:300-327) so they survive scene switches: `#mp-bar`, `#mp-feed`, `#mp-score`, `#mp-hud-chat`, `#spawn-map`.
- `#toasts` (:329) is the toast host.
- `#modal > #modal-card` (:330) is the one and only dialog.
- Fonts: Chakra Petch and IBM Plex Mono from Google Fonts (:15-17). The viewport meta sets `user-scalable=no, viewport-fit=cover` (:5).

**Load order** (classic synchronous `<script src>` at the end of `<body>`, index.html:332-352). Each file may use only earlier files at load time.

| # | File | Globals it creates (top-level `const`/`function`) |
|---|---|---|
| 1 | util.js | `TAU G0 clamp lerp smoothstep wrapAngle v3 dot3 cross3 len3 norm3 quat qmul qnorm qconj qaxis qrot qunrot qbasis qslerp surfaceFrame mulberry32 mixColor hexToRgb fmt store Silly effectMach $ el isTouch` |
| 2 | space.js | bodies (`SUN`…`EUROPA`, `BODIES`, `BODY_BY_ID`), orbit math, `airDensity`, `deltaVChart` … |
| 3 | terrain.js | `Terrain` (IIFE; its internals are not global) |
| 4 | parts.js | `PARTS TIERS PART_CATEGORIES VEHICLE_KINDS SKINS`, design/drawing helpers |
| 5 | vessel.js | `Vessel SAS_MODES soundSpeed …` |
| 6 | ui.js | `UI ICONS icon` |
| 7 | world.js | **`Settings`** (world.js:5-10), `FX World rgba hash1 …` |
| 8-9 | parts3d.js, render3d.js | `Parts3D`, `Render3D` (IIFEs that touch `THREE` only after `init()`) |
| 10 | audio.js | `Sound` |
| 11 | career.js | `MISSIONS Career money` (calls `Career.load()` at load time, career.js:77) |
| 12-16 | map, globe, combat, builder, flight | `MapView GlobeView Combat Builder TEMPLATES Flight WARPS haptic …` |
| 17 | vendor/peer.min.js | `Peer` (PeerJS 1.5.4) |
| 18-20 | net, mp, mpui | `Net`, `MP` + `MP_*` constants, `MPUI` |
| 21 | main.js | `App EARTH_MAP_FILES`; `DOMContentLoaded → App.init()` (:397); service-worker registration (:399-408) |

**three.js is not in index.html.** `Render3D.load()` injects `<script src="js/vendor/three.min.js">` on demand (render3d.js:3136-3150). If `window.THREE` already exists it skips the injection, and the single-file build relies on that.

**Conventions:**
- Every file starts with `'use strict';` and a header comment.
- Modules are either object-literal singletons (`const App = {…}`) or IIFEs that return an API object.
- Top-level `const`s from all classic scripts share one global lexical scope but are **not** `window` properties (`window.App` is `undefined`). The only real window flag is `window.RSS_NO_SW`.
- Forward references go inside functions, guarded where they can run early:
  - `typeof MP` in `Silly.on` (util.js:143) and `Builder.save` (builder.js:195)
  - `typeof Builder` in `App.resize` (main.js:40)
- Code that runs at load time: `Silly.flags` (util.js:142), `Settings.data` (world.js:6), `Career.load()`, `isTouch` (util.js:165), the audio-unlock listeners (audio.js:113).

**Why plain scripts:** the game must run when `index.html` is opened from disk (README.md:137). From `file://`:
- `type="module"` scripts and `fetch()` of local files are blocked.
- Plain and injected `<script src>` tags still work, so three.js loads.
- Only the Earth map fails. `Terrain.loadEarth` (terrain.js:180-199) catches the error, sets `earthMap.state = 'failed'` and uses generated terrain. `App.afterEarth` (main.js:237-242) waits only while the state is `'loading'`.

### 2. main.js: the `App` shell

**`init()` (main.js:7-31):**
1. Starts the Earth-map download (`Terrain.loadEarth(EARTH_MAP_FILES)`) and sizes the canvas.
2. Prepends an SVG icon to every `[data-icon]` element (:13).
3. `Builder.init`, `Flight.init`, `init3D`, `bindHome`.
4. Dialog dismissal: a tap on the backdrop or Escape closes the dialog (:19-22). The Escape listener runs in the capture phase and stops propagation. Both are blocked while `Flight.ended || MP.modalLocked`.
5. Blocks iOS `gesturestart`.
6. Calls `Flight.save()` on `visibilitychange`→hidden and on `pagehide` (:24-27), because phones kill background tabs without warning.
7. Starts the rAF loop and calls `toHome()`.

**`resize()`** (:33-41): caps DPR at 2 and sets the 2D canvas's backing size. Render3D keeps its own pixel ratio (render3d.js:2882).

**Scenes:** `App.scene ∈ 'home' | 'build' | 'flight' | 'mp'`. `showScene(name)` (:128-136) toggles `hidden` on the four containers and calls `MPUI.renderBar()`. The map is **not** a scene: it is `Flight.mapMode` (`toggleMap`, flight.js:1097; key M). Inside it, `GlobeView` (3D globe, needs WebGL) and `MapView` (flat solar system) swap via `#btn-mapview` or N (flight.js:1108-1119). The pause menu is `Flight.openMenu` (flight.js:430), and in multiplayer `openMpMenu`.

| Transition | Code | Notes |
|---|---|---|
| → home | `toHome()` :161-177 | Saves and stops a flight. If `MP.active` it calls `MP.end()`, which comes back here. With no `Career.mode` yet, it shows the Career/Sandbox picker (`#home-modes`). Fills the Resume button from `rss.flight`. |
| → build | `toBuild()` :195-201 | Leaves the flight (MP: `MP.leaveFlight()`), rebuilds the palette, fits the view |
| build → flight | `launch()` :203-226 | Needs a control part. In a room it calls `MP.launch()`. Checks locked parts and funds, confirms before replacing a saved flight, waits for Earth, clears `rss.flight`, calls `Flight.start(Builder.serialize())`, shows a launch-tip toast if hints are on |
| home → flight | `resumeFlight()` :228-235 | `Flight.restore(saved)`. If that throws it drops the save and goes to build |
| → mp | `showMP()` :138-141 | Called by `MPUI.open()` (mpui.js:9) and by `MP` |

The **home background** (`renderHome`, :184-192) is the 2D solar-system map running at 40 000× time. It sits right of the title on wide screens and above it in portrait.

**Main loop** `frame(t)` (:43-74):
- `dt` is capped at 0.1 s; `Flight.update` caps it again at 0.05.
- build: `Render3D.renderBuilder` if `preview3D()`, else `Builder.render` (2D).
- flight: `Flight.update(dt)`, then one of:
  - the globe (`GlobeView.render`)
  - 3D (`Render3D.renderFlight`, then clear the 2D canvas and draw `World.drawOverlay3D`, `Combat.drawHUD`, `MPUI.drawHUD` on it)
  - `Flight.render` (2D fallback)
- otherwise: `renderHome`.
- Hides `#view3d` when nothing is 3D.
- The body is wrapped in `try/catch` that only `console.error`s, so a bug repeats every frame without stopping the loop.

**3D/2D:**
- `use3D()` (:81-88) is false when WebGL is unsupported, three failed, or `Render3D` isn't ready. In flight the Silly `retro2d` flag also forces it false. The first failure in flight toasts once.
- The hangar is 2D by default. `preview3D()` = `Settings.build3d && use3D()`.
- The `.view3d-toggle` button (`#btn-3d-build`, hidden without WebGL) and V in the builder (builder.js:1547) call `setPreview3D`.
- `sync3D()` (:109-126) updates aria/title, shows `#build-3d-hint`, which fades after 9 s (text differs for touch), and hides the 2D-only Grid button.

**Menus (all `UI.modal`):**

| Menu | Location | Contents |
|---|---|---|
| `showHelp()` | :245-262 | Static `<ol class="howto">` plus `Flight.controlsHelp()` (flight.js:460, also the pause-menu body). Opens automatically once after the first mode pick (`rss.seenHelp`, :157). |
| `showResearch()` | :264-285 | Tiers; the buy button calls `Career.buyTier()` |
| `showMissions()` | :287-301 | Missions grouped by body |
| `showDeltaV()` | :303-321 | Table from `deltaVChart()` |
| `showSettings()` | :323-370 | Settings below |

**Settings.** The `Settings` object lives in **world.js:5-10**: one JSON blob in `rss.settings`. Defaults: `{quality:'high', hints:true, volume:0.8, markers:true, build3d:false, targets:'practice'}`. Read with `Settings.get(k)`; `Settings.high` means `quality !== 'low'`.

| Control (main.js) | Key | Consumers |
|---|---|---|
| Volume range 0-1 step 0.05 (:326) | `volume` | `Sound.applyVolume` (audio.js:35) |
| Graphics select (:328) | `quality` | `Settings.high` throughout render3d/world/flight. Render3D's `applyQuality()` (render3d.js:2883) re-applies it live (shadows, patches, scenery, pixel ratio). |
| Targets select (:336) | `targets` `practice`/`hostile`/`off` | combat.js:27 (forced `off` in multiplayer) |
| Flight hints checkbox (:332) | `hints` | `Flight.hint()` (flight.js:1174), launch tip (main.js:215) |
| Prograde markers checkbox (:334) | `markers` | world.js:788, :808 |
| (3D button / V, not in the dialog) | `build3d` | `App.preview3D` |
| Toggle fullscreen (:341) | none | Fullscreen API; toasts if unavailable |
| Reset career progress (:348) | none | Two taps (`dataset.armed`). Then `Career.reset()` (keeps the mode), clears `rss.flight`, rebuilds the palette, `toHome()` |

**Secret "silly" settings** (`Silly`, util.js:130-149):
- **Unlock:** tap the Options dialog title **7 times** (main.js:357-369). Counting toasts appear from the third tap. The unlock sets `rss.sillyUnlocked=true`, plays `Sound.boom(0.6)` and toasts.
- `.modal-title` is `user-select:none` (style.css:620) so the taps don't select text.
- Once unlocked, Settings always shows the `sillySettings()` box (:372-388): one checkbox per entry plus "All off".
- Flags are stored in `rss.silly` as `{key: bool}`.
- `Silly.on(k)` is always false in a PvP room, in every phase from lobby to results (`MP.pvp`); sandbox rooms keep the flags.
- `Flight.start` toasts the list of active flags (flight.js:102-103).

| Flag | Label | Effect, where |
|---|---|---|
| `ghostCam` | Crash cam classic (the old camera bug) | After a crash the camera freezes in space while the planet flies on (flight.js:1412). The crash dialog waits 5 s instead of 1.6 s (flight.js:388). |
| `retro2d` | Retro 2D flight | `use3D()` is false in flight (main.js:82) |
| `ogAutopilot` | Vintage autopilot | Old porpoising plane autopilot (vessel.js:571) |
| `noodle` | Noodle wings | Wings tear off at ¼ load and half their speed limit (vessel.js:735) |
| `bouncy` | Bouncy castle | No ground breakage, restitution 0.75 (vessel.js:941-944) |
| `drunk` | Wobbly pilot | The stick drifts in waves (flight.js:571) |
| `hollywood` | Hollywood | Explosions ×3 (world.js:55); stage separations explode (flight.js:334) |
| `boomy` | Sonic boom at 90 km/h | `effectMach()` uses speed/25 m/s (util.js:149), for effects only; missions still read `v.mach` |

**Service-worker hook** (main.js:399-408):
- Registers `sw.js` with `updateViaCache:'none'`, **only when `location.protocol === 'https:'`** and `!window.RSS_NO_SW`.
- On `controllerchange`, and only if a controller already existed (an update, not the first install), it reloads the page. If a flight or MP session is active it toasts "A new version is ready…" instead.

`EARTH_MAP_FILES` (:392-395) lists the eight Earth asset URLs as single-quoted literals. The bundler rewrites them (§7).

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
  - Kinds used: `'achievement'` (amber, "Milestone ·" prefix, style.css:274), `'kill'` (red, :733), `'warn'`.
  - `'warn'` has **no own rule**: it picks up the generic `.warn` (style.css:117: amber left border, 12px).
  - `Flight.toast` wraps it (flight.js:171).
- `ICONS` (:50-85): 24×24 stroke SVGs drawn in `currentColor`. `icon(name)` returns `<span class="icon">`. Markup gets icons through `data-icon="name"` (prepended once in `App.init`). Elements created later call `icon()` themselves (e.g. builder.js:1344).

**util.js:**
- Math: `clamp lerp smoothstep wrapAngle`.
- Vectors are plain `{x,y,z}`; quaternions are `{w,x,y,z}` with optional `o` out-params (`qrot`, `qbasis`, `qslerp`…, :16-63). `surfaceFrame` gives up/east/north. `mulberry32` is a seeded RNG. `hexToRgb` is cached.
- `fmt` (:85-114): `dist` (m/km/Gm), `speed`, `clock` (`[Nd ]hh:mm:ss`), `duration`, `mass` (t), all en-US. `money()` lives in career.js:79.
- `store` (:116-128): JSON in localStorage inside try/catch.
  - `get(key, fallback)` also reads the legacy `orbitforge.<rest>` key for `rss.*` keys (from before the rename).
  - `set` returns `false` when storage is full or unavailable; builder.js:1223 checks this.
- `$` (:152) is `document.querySelector` and returns **one element**; there is no `$$`, use `document.querySelectorAll`.
- `el(tag, attrs, ...kids)` (:153-163): `class` sets className, `text` sets textContent, `on*` adds a listener, anything else goes through `setAttribute`. So set `.checked`/`.disabled` as properties after creating the element. Null children are skipped.
- `isTouch = matchMedia('(pointer: coarse)')`, evaluated once at load.

**`Sound` (audio.js):** fully procedural; there are no audio files.
- `unlock()` creates the AudioContext on the first `pointerdown`/`keydown` (:113), because browsers need a gesture.
- Graph: a master gain set to `Settings.volume` (`applyVolume`) is fed by two looping 2 s brown-noise beds (:22-32):
  - engine: lowpass 300 Hz
  - wind: bandpass 700 Hz
  - Flight drives their gain and cutoff each frame through `engine(level, air)` and `wind(k)`.
- One-shots:
  - `burst(dur, freq, vol, type)`: filtered noise with an exponential decay. Wrapped by `ignite separate explode click gun(big) missile hit`.
  - `tone` (sine; seeker growl and lock), `beep` (square; warnings)
  - `boom` (a synthesised N-wave: two cracks 0.13 s apart, then a rumble)
  - `chime` (660/880/1320 Hz triangle arpeggio)
- Every method is a no-op until `ctx` exists.

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
- Building blocks: `.btn` (+`.primary .danger .small .icon-only .toggle[aria-pressed]`), `.panel` (blurred glass), `.round` (touch buttons), `.pill`, `.kind-select/.kind-btn[aria-checked]` (segmented control).
- Layout plumbing:
  - `.ui` is `pointer-events:none` and `.ui > *` gets `auto` (:41-42). Only **direct children** of a screen take input; everything else passes through to the canvas.
  - `[hidden]{display:none !important}` (:36): show elements by removing the attribute, never with CSS.
- z-index: sel-box 5, mp-feed/hud-chat 18, flight-alert/mp-bar 19, toasts 20, mp-score 25, modal 30.
- The file is **append-only by feature**: base sections (:44-382), then "v2 additions" (:383), then per-feature blocks (home, builder, settings, flight, 3D stick, planes, silly :611-620, saved designs, globe, weapons, multiplayer :735). Each block carries its own `@media` overrides, and later rules win. Put new feature CSS in a new section at the end with its own breakpoints.

**Breakpoints:**

| Query | Main effects |
|---|---|
| `max-width:760px`, the phone breakpoint, repeated per section (:326, 510, 549, 582, 641, 664, 712, 732, 881) | Builder `.stats` becomes a wrapping strip across the top (4-column stat grid, stage list hidden). `.part-info` docks above the tray (`bottom: var(--pal-h)+10px`) without its description. `.long` button labels hidden. Telemetry 176 px; time warp moves under the top-right buttons; autopilot grid 3 columns; flight hint moves top-right; the brake button floats beside the autopilot grid (:549-554); home content bottom-aligned; MP bar and feed pushed down, with `body:has(#mp-bar…)` moving stats, hint and feed (:889-892) |
| `max-width:480px` / `420px` / `350px` (:646, 323, 655) | Hangar, 3D and Sym become icon-only; Clear hidden; smaller Launch and buttons |
| `max-height:500px`, phones in landscape (:358, 522, 556, 586, 668) | Compact telemetry; smaller joystick (92 px) and round buttons; the throttle box turns horizontal at the bottom, left of the stage box; slimmer tray (34 px icons, no specs); hint at top centre |
| `max-width:860px` (:874) | MP lobby grid in one column; spawn map stacked |
| `max-width:1000px` (:320); `761-1000px` (:894) | Brand name hidden; MP build bar moved right of the stats panel |
| `pointer:fine` (:731) · `prefers-reduced-motion` (:378) | Smaller FIRE button for a mouse · no toast or fuel-bar animation |

**Touch controls** are always rendered, on desktop too:
- joystick `#joy` (:562, 116/104/92 px), roll ⟲⟳ `.small-round`, Brake
- autopilot `.sas` (6 columns; `.sas.plane` 4)
- vertical throttle `.throttle-track` (role=slider)
- stage box, weapon box (FIRE, CM), catapult
- Canvases and drag controls use `touch-action:none`; buttons use `manipulation`.

**Builder panel on phones:**
- The tray `.items` is `touch-action:pan-x` (:158): a sideways swipe scrolls it, an upward drag picks up a part (builder.js:914).
- `Builder.layout()` (builder.js:1185-1194) writes `--pal-h` (the tray's measured height). It drives `.stats` max-height, `.fit-col`, `.chip-hint` and the docked `.part-info`. It also lifts `.fit-col` above `.part-info` when they overlap.
- The stats panel folds (`.stats.collapsed`, :632). It starts folded when the window is short (`innerHeight<520`, or `<700` with `innerWidth≤760`, builder.js:1600); the choice is stored in `rss.statsFolded`.
- `#build-ui.has-info` hides the 3D hint chip on phones (:665).
- Dragging a part over the tray shows `.palette.drop-remove`, "Drop here to remove" (:634).
- Some rules use `:has()` (:597, :889-892); old browsers ignore them.

### 5. localStorage keys (every key used in js/)

All go through `store` as JSON; there is no other persistence (`BroadcastChannel` in net.js is messaging only).

| Key | Read/written in | Contents |
|---|---|---|
| `rss.settings` | world.js:6-8 | Settings object (§2) |
| `rss.career` | career.js:38, 41 | `{mode: null/'career'/'sandbox', funds, tier, done:{missionId: timestamp}, flights}`. In a match `MP.pushCareer` swaps in a throwaway copy with `save` as a no-op (mp.js:133-150). |
| `rss.design` | builder.js:184, 195; mp.js:135, 144 | Current blueprint `{name, kind, parts, savedAs}`. Not written while a match borrows the builder. |
| `rss.hangar` | builder.js:1200, 1223, 1381 | Up to 100 named designs `{name, kind, parts, savedAt}`, newest first |
| `rss.clip` | builder.js:172, 814 | Copy/paste clipboard `{kind, parts}` |
| `rss.symmetry` / `rss.symmetryPlane` | builder.js:175, 1009-1011, 1585 | Symmetry toggle for non-planes / planes |
| `rss.grid` | builder.js:176, 791 | 2D quarter-metre grid snap |
| `rss.statsFolded` | builder.js:1600-1601 | Stats panel collapsed |
| `rss.flight` | flight.js:115, 138, 381, 406; main.js:168-233, 351 | Saved flight `{v:2, time, design, launchCost, active, flags, stats, target, scale, vessels:[…]}`, or null. Cleared on launch, revert, recovery, total loss and career reset. |
| `rss.seenHelp` | main.js:157 | The first-run help has been shown |
| `rss.silly`, `rss.sillyUnlocked` | util.js:142-146 | Silly flags; secret unlocked |
| `rss.mp.name`, `rss.mp.tr` | mp.js:82; mpui.js:19-44 | MP name (≤18 chars); transport `'p2p'`/`'local'` |

### 6. Offline / PWA

**sw.js** (31 lines):
- `CACHE = 'overbuilt-v18'` (:3).
- `SHELL` (:4-12) lists `./`, index.html, the CSS, the manifest, `icons/icon.svg`, every js file **including `js/vendor/three.min.js`** and peer.min.js, and all 8 `assets/earth-*` files.
- **install** (:13-16): `addAll` with `cache:'reload'` requests (bypassing the HTTP cache), then `skipWaiting()`.
- **activate** (:17-19): deletes every cache whose name isn't `CACHE`, then `clients.claim()`.
- **fetch** (:20-31): **network-first** for every GET. A good same-origin response is copied into `CACHE`. When the network fails it falls back to `caches.match(req, {ignoreSearch:true})`, then to `index.html`, for any request.
- Cross-origin responses (Google Fonts, the PeerJS server) are never cached, so offline play uses system fonts.

**When to bump `CACHE`:** on every change to any cached file (all js, css, html, assets, manifest). Changing sw.js's bytes is the only thing that makes browsers install a new worker. That install pre-caches the whole new set (so offline play is complete), removes the old cache, and fires `controllerchange`, which auto-reloads the page (main.js:403-407).
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
4. Replaces each quoted literal `'assets/earth-*.ext'` (the ones in main.js:392-395) with a `data:` URL (:18-20).
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
- **What's in it** (:63-96): one bold-led bullet per feature area (Earth, 3D world, vehicles, weapons, missiles, damage, structure, parts by category, flight model, builder, physics, solar system, navigation, graphics, saving, settings)
- **Scale** (:98-100)
- **Project layout** (:102-135): one line per file or folder, including `test/`, `docs/HANDBOOK.md` and `CLAUDE.md`
- the file:// note (:137), data credits (:139), the name history and Cam-Strike (:141)
- **Ideas for later** (:143-145)

Convention: **every user-visible feature, control or part change gets documented in README in the same commit.** Recent feature commits all touch README. When you change something:
- edit the matching "What's in it" bullet and the Controls table
- add new files to Project layout
- keep the counts in prose correct ("157 parts", "41 missions", "twenty-five examples")
- keep three places in sync for controls: README, `App.showHelp` (main.js:248-259) and `Flight.controlsHelp` (flight.js:460-484)

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
   - Don't open a dialog over the paused flight menu, or `Flight.paused` never resets.
   - String bodies are innerHTML: build anything containing peer-supplied text (MP names, chat) with `el(…, {text})`.
9. **Escape is swallowed while a modal is open** (capture listener, main.js:22). Game key handlers must also skip input while `UI.modalOpen` or while focus is in an `INPUT`/`TEXTAREA`/`SELECT`, as builder.js:1533 and mpui.js:76 do.
10. **A thrown error inside `frame()` doesn't stop the game**: watch the console, since it repeats every frame.
11. **Silly flags must stay cosmetic or opt-in**: `Silly.on` is false in PvP, and missions must read real values (e.g. `v.mach`, not `effectMach`).
12. **Changing a save format**: `rss.flight` carries `v:2`, and `store.get` also reads `orbitforge.*` keys. Keep restores tolerant: `resumeFlight` drops a save that fails to load. A thrown error in `Career`/`Builder` load code breaks startup.
13. **`isTouch` is fixed at load**, and the touch controls show on desktop too. Test on both a phone in portrait (≤760 px wide) and in landscape (≤500 px tall); the CSS has a separate layout for each.
14. **Deploys are instant and unbuilt**: whatever lands on `main` is live. A stray file in the repo root is public.

## 6. Testing

`test/README.md` covers the suites, baselines and helpers in full. In short:

- `node test/run.mjs` runs the headless suites in about 40 s. They load the game's own scripts into a Node VM: fingerprints of every template, full-precision flight traces, the plane handling table, and checks for the part model, physics, flight, combat and multiplayer.
- `node test/run.mjs --browser` adds the browser suites: the 2D builder, the 3D builder and two-tab multiplayer, in headless Chromium with software WebGL.
- Baselines in `test/baseline/` are the output of `main`. A change that is meant to move them is re-baselined with `--update`, with the reason in the commit. A refactor must leave them identical.
- For a change you can't express as a check, such as visuals, feel or layout, script it with Playwright (`test/lib/browser.mjs` has the server, launch and fresh-profile helpers), take screenshots and look at them. Check the console too, because `App.frame` swallows exceptions.

The physics, combat and multiplayer suites began as the adversarial-review repros of the attach system. Each check there once failed on a real bug.

## 7. Known loose ends

Found while writing this handbook or in earlier reviews, and not fixed yet. All are verified against the code.

| Where | What | Notes |
|---|---|---|
| `manifest.webmanifest` | The description still reads "Build rockets, reach orbit and land on the Moon." | Undersells the game |
| `mp.js:819` (`onDown`) | Reads `m.P` without validating it. A malformed `down` throws inside the handler; it is caught, but the ghost drop and `recordDown` are skipped. | Validate with `mpNums` like the other handlers |
| multiplayer trust | Hit amounts (capped), kill credit (named by the victim), the self-reported damage score, and each player's budget and design checks all rest on trust | By design for a host-relayed P2P game; worth knowing before "anti-cheat" work |
| `space.js:483` (`transferWindow`) | Returns a bare `Infinity`, not an object, when the two orbit rates match | The HUD copes by accident |
| `render3d.js` water | The ocean and inland water geometries have no `uv` attribute, so the ripple normal map probably shows nothing | Add UVs before tuning ripples |
| `render3d.js` `syncCombat` | Target models are removed without disposing their geometry | A small leak |
| scenery caps | Tree, building, rock and boat loops stop silently at their `InstancedMesh` capacity | Raise the capacity with the cap |
| torpedoes, ARMs | Have nothing to hit in multiplayer (no range or sea targets in rooms) | A design gap |
| handling table | In 30 s hands-off ("hold" autopilot, 85 % throttle) most planes sink 170-730 m (`node test/handling.js`) | Probably trim rather than a bug; check before "fixing" |
| input | No gamepad support; no cockpit or free camera | Ideas |

The README's "Ideas for later" lists the owner-facing wishlist: docking and space stations, payload fairings, solar panels and batteries for ion engines, editable staging, boats, more moons around Jupiter, and planet rotation.

