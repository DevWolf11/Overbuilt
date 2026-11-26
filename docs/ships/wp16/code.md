# WP16 code map: how a ship is modelled and drawn today (frozen tree 727e2d2)

Tree: `/tmp/claude-0/-home-user-Overbuilt/0587f056-6c41-58cd-9f76-3deee688a95a/scratchpad/wp16/tree`. Every `file:line` below is
in that tree. Triangle counts were built in node from the tree's own `parts3d.js` with its vendored three r159
(`wp16/count.js`, results `wp16/counts.json` and `wp16/count.out`).

## 0. Headline findings

1. **Nothing in the sim reads a 3D mesh.** Physics, hits, buoyancy, placement and decals all read pure functions and
   def fields in parts.js (`shullOf`, `shullTris`, outlines, the `*Lay` layouts). A change inside parts3d.js alone
   cannot move a baseline, with one exception: `ships-damage.test.js` checks that `shipHullGeo` calls `shullTris(d)`
   in its first 900 characters.
2. **The ships are thin.** The Arley Berk (156 m) draws **15,350 triangles in 72 meshes**. A Sugoi-27 (22 m) draws
   36,248 in 83, an FS-16 21,706 in 58 and a TK-34 9,016 in 17. That is about 100 triangles a metre on the destroyer
   against 1,300-1,650 on the tank and the jets.
3. **The superstructure is boxes with pictures on them.** Deckhouse, Stealth Superstructure, Funnel, Hangar and
   Helicopter Deck are **12 triangles each**, and the Bridge and Wheelhouse are 22. All their detail is the 2D art
   painted onto a prism (`plated`). The Gun House is a 20-triangle prism wearing the *tank turret's* 2D art
   (`gvTurret` has no naval branch), and the naval guns use the tank gun recipe unchanged.
4. **The 2D hull is richer than the 3D one.** `shullDraw` (parts.js:6669) draws plate seams, welded frames every 4 m,
   a rubbing strake, the deck edge, a hawse pipe and anchor, draft marks and the transom edge. The 3D loft
   (`shipHullGeo`) has only vertex-colour bands: the paint with a height gradient, the boot-top, the antifouling, the
   deck grey and the patrol stripe. It has no texture, fittings, rails, bulwarks or bilge keels.
5. **A bug you can see:** the Helicopter Deck's top is painted at **about 2.3 px/m across**. Its texture's plan view
   gets H = pow2(0.4 m × 64) = 32 px for 14 m of deck, so the landing circle and the H are a smear in 3D.
6. **Craft have no LOD, no instancing, no normal maps and no atlas.** Every vessel within 50 km (or bigger than 1 px)
   is drawn with all its meshes. Models don't depend on Settings.high. Every part instance gets its own materials.
   The craft machinery that could be reused is the wreck bake (one mesh per vessel), the per-vessel pylon pass, the
   sub-node roles and the props' instanced distance LOD.

## 1. The pipeline, to the line

### parts3d.js (the models)
| What | Where | Notes |
|---|---|---|
| Material kinds | `KINDS` :21-81 | ship kinds :74-81: `shipHull` (vertexColors), `shipHullCamo` (vertexColors + camo map), `antifoul`, `shipGrey` (= `SH_HAZE`, a BODY_KIND: takes the paint), `ribTube` |
| `LATHE_KIND` | :83 | `tring: 'plate'` (the naval ring) |
| `BODY_KINDS` | :88 | includes `shipGrey`, `armour` (paint goes to these) |
| `SKIN_GEO` | :89 | `wing`, `biplane`, `shipHull`: the paint is baked into the geometry, so the model is cached per skin |
| `texSize` | :116 | 64 px/m (`PX_PER_M` :9), pow2 clamped 16..512 per axis (drones ×8) |
| geometry helpers | `geo` :136, `latheGeo` :151, `projUV` :228, `extrudeGeo` :241, `merge` :262, `orient/rod/beam/box/cone` :290-298, `quad` :302, `sweep` :310 (NACA/ellipse loft), `loftGeo` :430, `mesh0` :540 (vertex/triangle builder with wanted-normal winding), `node` :671 (merges the pieces per material kind into one mesh each) |
| `plated(d, o)` | :707-731 | outline prism (def.outline or the box, or `o.pts`), hard edges, each face UV'd into one quarter of the part texture (side top-left, plan top-right, front bottom-left, back bottom-right) |
| `roofFit` / `exhaust` / `gvTex` | :731 / :747 / :755 | the tanks' roof fittings (GV_ROOF), exhausts, belt and wheel textures |
| **`shipHullGeo(d, S)`** | :782-847 | starts from `shullTris(d)` (:788, the hit triangles, as ships-damage requires). Normals are summed from the raw face normals, so creases come from shullTris' split vertices. Each triangle is clipped (Sutherland-Hodgman `cut` :797) at the boot-top's edges `wl ± shullBand/2`, so the bands are sharp. Deck faces (code −6) are deck grey ×0.8. The topsides get a 0.9→1.04 gradient to the deck edge and the bottom 0.82→1. `shStripe` (patrol white's slanted bands) is cut along `x − k·y` (`fcut` :817). The output is **non-indexed** (3 vertices a triangle). Without camouflage the UVs are 0; with it, metres (`x/T`, `(y+|z|)/T`, `CAMO_M`) |
| `prismY` | :849 | convex x-z outline extruded in y (rudder blades, foil struts) |
| **`shipKit(d)`** | :879-910 | `bridge` (Wheelhouse: `plated` with `shBridgePts` + 3 glass quads), `screw` (4 `bladeGeo` blades + boss lathe in vertex colours on a `shScrew` sub; the shaft fixed), `rudder` (FOIL section `prismY` blade + stock on a `shRud` sub). Otherwise it goes to shipKit2 |
| **`shipKit2(d)`** | :914-975 | `bridgeL` (prism + glass band + front glass), `console` (prism + windscreen + torus wheel), `shStealth`/`funnel` (**prism only**, :932), `lattice` (4 legs, braces, platform, rail rods), `pole` (cone + yard + lamp), `outboard` (capsule cowl, leg, plate, gearcase, 3 box blades on `shOut`), `waterjet` (duct + nozzle + bucket on `shJet`), `foil`/`foilAft` (FOIL struts and span, pods). **Fallthrough** :974: `plated(d)` box for `house`, `helipad`, `hangar`, `tdecoy` and the inner kit |
| **`navalKit(d)`** | :981-1033 | `nvCiws` (pedestal, `nvYaw` mount and white lathe dome, `nvPitch` cradle, `nvSpin` 6 barrels), `nvAsm` (box canisters at 15°, legs, a `nvCap<k>` cover each), `nvVls` (plated body, dark pits, `nvCap0..7` lids), `nvTorp` (3 tubes, bands, post, plate), `nvDecoy` (block, base, mouths) |
| `navalAnim` / `shipAnim` | :1036 / :1044 | nvYaw ← `p.aimYaw`, nvPitch ← `p.aimEl`, nvSpin while `p.gunOn`, caps ← `p.ammo`; shScrew ← `p.rpm` (the port one turns the other way), shRud/shOut/shJet ← `p.rud`, shRamp ← `p.ramp` (eased 2 s) |
| `BUILD` | :1053 | `lathe` :1112 (nRingM), `extrude` :1175 (nHouse127: `d.outline` → `plated` + `roofFit`), `tankGun` :1541 (the 4 naval guns), `radarAnt` :1605 (the 3 naval radars), `kit` :1629 (routes `SH_KIT` :1653 and `NV_KIT` :1654), **`shipHull` :1658-1673** (the loft, the RIB's tubes as TubeGeometry 48×10 + end spheres, the landing craft's `shRamp` plate and ribs) |
| `recipe` / `model` | :2050 / :2057 | `d.body3d` first (:2051), then `PART_RECIPE[shape]`. The cache key is `type + flip + skin`, with the skin only for SKIN_GEO. gv parts never flip |
| `paint` / `textureFor` | :2069 / :2117 | the 2D `drawPart` drawn flat, 8 offset copies for edge bleed. Plated parts (`gvPlanned`) get a 2W×2H canvas with `drawPartViews`. Cached per type, skin and camo placement, never disposed (placed camo past 64 is) |
| `makeMat` | :2148 | a new `MeshStandardMaterial` per (part, kind). The skin goes to BODY_KINDS and painted maps |
| `instance` | :2295 | one `Mesh` per node piece. `castShadow = !rig.small`. Sub roles: `spin`, `store`, `hinge`, `dock`, `ruMove`, … and **any other role lands on `rig[role]`** (:2311) |
| `buildPart` | :2324 | `inner` parts are not built outside the builder (:2335) |
| `gvRig` | :2579 | `rig.small = w·h·depth < 0.45 m³ && !ring` → no shadow; inner hidden in flight |
| `gvAnim` | :2628 | ship hooks :2647-2648; search antenna turns in flight :2649 |
| `xrayRig`, `modsMesh` | :2664, :2677 | X-ray: armour 0.3 see-through, inner parts in `GV_MOD` colours, crew balls |
| Wreck bake | `BAKE` :2717, `bakeList` :2861 (includes `rig.pylons`), `bakeGeometry` :2910 | one mesh, one shared charred material, vertex colour = material × vertex colour × texture mean (GPU mip readback `bakeAsk`/`bakePoll`) |
| `VesselMesh` | :3008. `pylons(parts)` :3027 (layout signature → `pylonsFor`), `add` :3039, `prune` :3052, `bakeReady` :3067, `bake` :3082 (wrecks only), `sync` :3111, `update` :3140 (`rig.yaw.rotation.x = aimYaw`, `pitch.rotation.z = aimEl`, recoil, stores) | |

### parts.js (data, 2D art and the shared numbers)
| What | Where |
|---|---|
| The 59 defs | hulls :1398-1478, superstructure :1481-1517, drive :1518-1554, arms :1565-1615, kit :1618-1631 |
| `BOX_OUTLINE`, `partDepth` | :1663, :1728 |
| `LATHE_SHAPES` / `PART_RECIPE` | :1823 / :1827 (`shull: 'shipHull'`, `tkit: 'kit'`, `tgun: 'tankGun'`, `tradar: 'radarAnt'`; `tring` lathe; `tturret` → extrude) |
| `CLASH_PAD`, `CLASH_BOXED`, `clashShape` | :1962, :1966, :1970 (`r = d.body3d \|\| …`; lathe → round, extrude → flat outline × depth, `shipHull` → **loft: side outline**; every other recipe → **box**) |
| Ship paints | `SKINS` :2546-2549 (navyGrey, navyDark, navySplinter = camo, patrolWhite = `band`) |
| partPath0 / drawPart0 dispatch | `case 'shull'` :2926 / :3677; gv shapes :2920 / :3671 |
| `gvPts` :4791, `GV_ROOF` :5040, `gvTurret` :4984 (**no naval branch**: the Gun House wears tank turret art), `gvRingPath` :5113, `gunLayout` :5303 (naval style = the tank-gun branch: round mantlet, plain barrel, muzzle ring), `radarLayout` :5493, `gvKitPath` :5538 (tkit outline = the box), `gvKit` :5553 (→ `shKit` :5558 / `nvKit` :5559), `gvPath` :5733, `gvDraw` :5750, `gvPlanned` :5766, `drawPartViews` :5853 |
| Hull sampling | `SHULL_NK` 5 bilge points, `SHULL_K` 15 corners a ring :6472; `shullSec` / `shullPoly` / `shullArea` / `shullRing`; **`shullOf`** :6522 (rings every max(0.5, w/24) m and at every station; phys rings; vol; fill); `shullPts` :6555; **`shullTris`** :6573 (crease split at 40°, deck codes −6/−7/−8/−9, slabs, caps) |
| Hull art | `shullPath` :6628, colours `SH_*` :6637, `shullBand` :6640, `shullStem`, `shStripe` :6652, `shTubeLay` :6658, `shRampLay` :6663, **`shullDraw`** :6669 |
| Kit art and layouts | `SH_KIT2`/`SH_KIT` :6756/:6758, `shBridgePts` :6760, `shRudderLay` :6767, `shWindows`, `shKit` :6780, `shKitPlan`, `shKitEnd`, **`shKitPts`** :6871, `shOutboardLay` :6881, `shJetLay` :6888, `shFoilLay` :6894, `shLatticeLay` :6900, `shKit2` :6903, `shKit2Plan` :7035, `shKit2End` :7058 |
| Naval art and layouts | `NV_KIT` :7074, `nvCiwsLay` :7078, `nvAsmLay` :7089, `nvVlsLay` :7101, `nvTorpLay` :7111, `nvDecoyLay` :7120, `nvKit` :7128, `nvKitPlan` :7206, `nvKitEnd` :7217 |

### render3d.js (drawing)
| What | Where |
|---|---|
| `syncVessels` | :6245. A `VesselMesh` per vessel on first sight (:6255). **Visibility** :6264: `d < 50 km` or more than 1 px. No LOD. `SYNC_Q` :6244 carries `quality` (only the shock diamonds read it). Reseat of far ground vehicles :6268; sinking :6269; bake after `BAKE_S` 6 s, one a frame (:6281-6284) |
| Hangar | :7586-7610. The whole `VesselMesh` is rebuilt whenever a part is added, removed, flipped or repainted (models cached, materials and meshes new) |
| Decals | `initDecals` :5213 (one InstancedMesh, `DECAL_N` 48, depthWrite false, renderOrder −1), `syncDecals` :7343, `blobOf` :7365, **`holesOf`** :7416 (from `Ship.holeMarks`, placed on the *analytic* section 3 cm out along the normal, `decalOn` :7441) |
| Sinking | `sinkVeil` :7081, `sinkSlots` :7143, `markStencil` :7156 (walks **every** mesh of the vessel's root) |
| Swell, wakes, waterline foam | :6558 onward (`updateSwell` :6783). They read `v.sh` phys rings, never the model |
| Shadows | `S.sun.castShadow = Settings.high` :1484 / :7779. On Low craft cast nothing and get only the contact blob |
| `depthBias(m, k)` | :4740 (render3d-local; the log depth buffer ignores polygonOffset) |
| `info()` | :8062 (`renderer.info.render` calls/triangles, programs) |
| `pickPart` | :8414 (taps only: raycasts `vm.pickables`) |

### What the sim reads (ship.js and the others)
`Ship.groups` :227 and joins :246 (shullOf rings), `Ship.model` :1443, `spotOf` (placement, deck at `yd`), `hullRay`
:2419 and `hullDist` :2478 (shullTris), launch points :3885-3886 (**`nvAsmLay(d).mouth(i)`, `nvVlsLay(d).cells`**),
`fxShape` :4479 (bow and stern rings, funnel parts), `hullGeo` :4638 (HUD diagram, shullOf), `holeMarks` :4995 (analytic
`secAt`/`secHalf` + 3 cm), `muzzleOf` :4084 and the CIWS reach :4101 (**`nvCiwsLay(d).gun`**), `eyeOut` :5118 (bridge
camera kept out of every **part box** and the hull's own section), `wreckOf` :3466. vessel.js:464 `shullPts` (ground
contact). armour.js: `recsOf` :170 (`sh: !!d.shull`), `geo` :226 (`d.outline || BOX_OUTLINE`), `prism` :238, `cyl` :262,
`test` :314-323, blast distance :1133. aim.js `muzzle` :274: the trunnion at `-h/2 + aim.pivot·h`, the muzzle at the
box top (+h/2).

## 2. The 59 ship parts as modelled today

Tris and meshes are per part (one mesh per material kind). Detail: 0 = a prism or box with its 2D art as a texture;
1 = a few primitives; 2 = a built model you can recognise; 3 = the jets' standard (lofted, fitted, crewed). "in"
means `inner`: never built in flight, only seen in the hangar.

| Key | Name | Tab | shape / style → recipe | Tris | Meshes | Kinds | Roles | Detail |
|---|---|---|---|---|---|---|---|---|
| hbBowS | Small Bow | shHull | shull → shipHull | 628 | 1 | shipHull | | 1 |
| hbMidS | Small Midsection | shHull | shull → shipHull | 494 | 1 | shipHull | | 1 |
| hbSternS | Small Stern | shHull | shull → shipHull | 402 | 1 | shipHull | | 1 |
| hbBowM | Patrol Bow | shHull | shull → shipHull | 1030 | 1 | shipHull | | 1 |
| hbMidM | Patrol Midsection | shHull | shull → shipHull | 862 | 1 | shipHull | | 1 |
| hbSternM | Patrol Stern | shHull | shull → shipHull | 678 | 1 | shipHull | | 1 |
| hbBowL | Corvette Bow | shHull | shull → shipHull | 1310 | 1 | shipHull | | 1 |
| hbMidL | Corvette Midsection | shHull | shull → shipHull | 1230 | 1 | shipHull | | 1 |
| hbSternL | Corvette Stern | shHull | shull → shipHull | 1238 | 1 | shipHull | | 1 |
| hbBowX | Destroyer Bow | shHull | shull → shipHull | 1300 | 1 | shipHull | | 1 |
| hbMidX | Destroyer Midsection | shHull | shull → shipHull | 1238 | 1 | shipHull | | 1 |
| hbSternX | Destroyer Stern | shHull | shull → shipHull | 1284 | 1 | shipHull | | 1 |
| ribHull | RIB Hull | shHull | shull → shipHull (+tubes) | 2996 | 2 | shipHull, ribTube | | 2 |
| lcHull | Landing Craft Hull | shHull | shull → shipHull (+ramp) | 1300 | 2 | shipHull, shipGrey | shRamp | 1 |
| pontoon | Float | shHull | shull → shipHull | 656 | 1 | shipHull | | 1 |
| stepHull | Flying-boat Hull | shHull | shull → shipHull | 1168 | 1 | shipHull | | 1 |
| bridgeM | Wheelhouse | shSuper | tkit/bridge → kit→shipKit | 22 | 2 | plate, glass | | 1 |
| consoleS | Helm Console | shSuper | tkit/console → shipKit2 | 234 | 3 | plate, glass, ink | | 1 |
| bridgeL | Bridge | shSuper | tkit/bridgeL → shipKit2 | 22 | 2 | plate, glass | | 1 |
| deckhouseL | Deckhouse | shSuper | tkit/house → plated box | 12 | 1 | plate | | 0 |
| stealthHouse | Stealth Superstructure | shSuper | tkit/shStealth → plated prism | 12 | 1 | plate | | 0 |
| mastLattice | Lattice Mast | shSuper | tkit/lattice → shipKit2 | 1228 | 2 | shipGrey, steelDark | | 2 |
| mastPole | Pole Mast | shSuper | tkit/pole → shipKit2 | 260 | 2 | shipGrey, white | | 1 |
| funnel | Funnel | shSuper | tkit/funnel → plated prism | 12 | 1 | plate | | 0 |
| helipad | Helicopter Deck | shSuper | tkit/helipad → plated box | 12 | 1 | plate | | 0 (top at 2.3 px/m) |
| hangar | Helicopter Hangar | shSuper | tkit/hangar → plated box | 12 | 1 | plate | | 0 |
| dieselM | Large Marine Diesel | shDrive | tkit/engine → plated box (tank engine art) | 12 | 1 | plate | | 0 in |
| screwM | Propeller | shDrive | tkit/screw → shipKit | 536 | 2 | steel, vcMetal | shScrew | 2 |
| rudderM | Rudder | shDrive | tkit/rudder → shipKit | 144 | 2 | antifoul, steelDark | shRud | 1 |
| dieselS | Small Marine Diesel | shDrive | tkit/engine → plated box | 12 | 1 | plate | | 0 in |
| turbine | Gas Turbine | shDrive | tkit/engine → plated box | 12 | 1 | plate | | 0 in |
| outboard | Outboard Motor | shDrive | tkit/outboard → shipKit2 | 1112 | 6 | steelDark, ink, steel | shOut | 2 |
| screwS | Small Propeller | shDrive | tkit/screw → shipKit | 536 | 2 | steel, vcMetal | shScrew | 2 |
| screwL | Large Propeller | shDrive | tkit/screw → shipKit | 536 | 2 | steel, vcMetal | shScrew | 2 |
| waterjet | Waterjet | shDrive | tkit/waterjet → shipKit2 | 184 | 3 | steelDark, steel | shJet | 1 |
| rudderL | Large Rudder | shDrive | tkit/rudder → shipKit | 144 | 2 | antifoul, steelDark | shRud | 1 |
| foilBow | Bow Hydrofoil | shDrive | tkit/foil → shipKit2 | 192 | 2 | shipGrey, antifoul | | 1 |
| foilAft | Main Hydrofoil | shDrive | tkit/foilAft → shipKit2 | 1104 | 3 | shipGrey, antifoul, steelDark | | 2 |
| nRingM | Naval Gun Ring | shArms | tring → lathe | 264 | 1 | plate | | 1 |
| nHouse127 | Gun House | shArms | tturret/naval (outline) → extrude→plated | 20 | 1 | plate | | 0 (tank turret art) |
| nGun57 | 57 mm Naval Gun | shArms | tgun/naval → tankGun | 324 | 2 | armour, gunmetal | yaw, pitch, recoil | 1 |
| nGun76 | 76 mm Rapid Gun | shArms | tgun/naval → tankGun | 324 | 2 | armour, gunmetal | yaw, pitch, recoil | 1 |
| nGun127 | 127 mm Naval Gun | shArms | tgun/naval → tankGun | 324 | 2 | armour, gunmetal | yaw, pitch, recoil | 1 |
| nGun152 | 152 mm Naval Gun | shArms | tgun/naval → tankGun | 324 | 2 | armour, gunmetal | yaw, pitch, recoil | 1 |
| ciws | Close-In Gun | shArms | tkit/nvCiws → navalKit | 804 | 5 | shipGrey, white, steelDark, gunmetal | nvYaw, nvPitch, nvSpin | 2 |
| asm2 | Twin Anti-ship Missiles | shArms | tkit/nvAsm → navalKit | 108 | 4 | steelDark, shipGrey, white | nvCap0-1 | 1 |
| asm4 | Quad Anti-ship Missiles | shArms | tkit/nvAsm → navalKit | 156 | 6 | steelDark, shipGrey, white | nvCap0-3 | 1 |
| vls8 | Vertical Launcher | shArms | tkit/nvVls → navalKit | 204 | 10 | plate, ink, shipGrey | nvCap0-7 | 1 |
| torpTube | Torpedo Tubes | shArms | tkit/nvTorp → navalKit | 836 | 2 | shipGrey, steelDark | | 2 |
| nRadarAir | Air Search Radar | shArms | tradar/search → radarAnt | 460 | 2 | steelDark, dish | antenna | 1 |
| nRadarFC | Fire-Control Radar | shArms | tradar/track → radarAnt | 692 | 2 | steelDark, dish | yaw, pitch | 2 |
| nRadarSea | Surface Search Radar | shArms | tradar/search → radarAnt | 460 | 2 | steelDark, dish | antenna | 1 |
| decoy | Decoy Launcher | shArms | tkit/nvDecoy → navalKit | 360 | 3 | shipGrey, steelDark, ink | | 1 |
| bulkhead | Watertight Bulkhead | shKit | tkit/bulkhead → plated box | 12 | 1 | plate | | 0 in |
| pump | Salvage Pump | shKit | tkit/pump → plated box | 12 | 1 | plate | | 0 in |
| ballast | Fuel and Ballast | shKit | tkit/ballast → plated box | 12 | 1 | plate | | 0 in |
| dcLocker | Damage Control Party | shKit | tkit/locker → plated box | 12 | 1 | plate | | 0 in |
| magazine | Shell Magazine | shKit | tkit/magazine → plated box | 12 | 1 | plate | | 0 in |
| torpDecoy | Torpedo Decoy | shKit | tkit/tdecoy → plated box | 12 | 1 | plate | | 0 (visible on the stern) |

Notes: all three propellers are the same 4-bladed model, scaled. The radars are the ground update's SPAA ones: a curved
panel on a pole, or a dish and feed. The naval guns are a tank gun (round mantlet, plain barrel, muzzle ring) poking
out of a 20-triangle faceted box. The hulls' resolution is the hit shape's: 15 corners a ring (5 bilge points a side,
the chine, the deck edge), a ring every max(0.5, w/24) m (1 m on X segments), and a flat deck.

### Texture resolution of the plated (texture-only) parts (64 px/m, 512 px cap per view)
| Part | Side (px/m along × up) | Plan (along × across) | Ends (across × up) |
|---|---|---|---|
| bridgeM 5×3×5 | 102 × 85 | 102 × 51 | 102 × 85 |
| bridgeL 10×7×12 | 51 × 73 | 51 × 43 | 43 × 73 |
| deckhouseL 14×5×12 | 37 × 102 | 37 × 43 | 43 × 102 |
| stealthHouse 30×6×10 | **17** × 85 | **17** × 51 | 51 × 85 |
| funnel 5×6×4 | 102 × 85 | 102 × 128 | 128 × 85 |
| hangar 12×6×10 | 43 × 85 | 43 × 51 | 51 × 85 |
| helipad 16×0.4×14 | 32 × 80 | 32 × **2.3** | 37 × 80 |
| nHouse127 5×3×4.4 | 102 × 85 | 102 × 58 | 116 × 85 |

## 3. The stock ships against our standard (flight: inner parts not built)

| Template | Parts (drawn) | Tris | Meshes = draws (×2 with shadows on High) | Hull parts: tris | Other drawn parts: tris |
|---|---|---|---|---|---|
| Arley Berk Destroyer | 43 (30) | 15,350 | 72 | 6: 7,536 | 24: 7,814 |
| Olivar Perri Frigate | 39 (29) | 14,950 | 72 | 4: 5,060 | 25: 9,890 |
| Vizby Stealth Corvette | 28 (20) | 10,228 | 40 | 4: 5,008 | 16: 5,220 |
| Osca Missile Boat | 31 (22) | 10,048 | 43 | 5: 4,294 | 17: 5,754 |
| Pegazus Hydrofoil | 27 (21) | 9,040 | 43 | 5: 4,294 | 16: 4,746 |
| Cyclon Patrol Boat | 20 (15) | 7,150 | 25 | 4: 3,432 | 11: 3,718 (old turret and MGs too) |
| Zodiak RIB | 6 (5) | 6,066 | 19 | 1: 2,996 | 4: 3,070 |
| Higgens Landing Craft | 11 (6) | 3,438 | 13 | 1: 1,300 | 5: 2,138 |
| Catalyna Flying Boat (plane) | 12 | 12,496 | 27 | 3: 2,480 | 9: 10,016 |
| *Sugoi-27* | 22 (21) | 36,248 | 83 | | |
| *FS-16* | 18 (17) | 21,706 | 58 | | |
| *Falcon* | 16 (15) | 18,024 | 58 | | |
| *FS-22* | 16 (15) | 10,736 | 87 | | |
| *TK-34* | 9 (8) | 9,016 | 17 (ground-models budget 30) | | |
| *MA-1 Abrahm* | 15 (14) | 8,600 | 23 | | |

The hangar also builds the inner parts (12 triangles each). Triangles are cheap here. Draws and per-part materials are
the cost: a ship already draws as many meshes as a jet.

## 4. What couples a ship model to the rest (what may change, what must stay)

**Nothing reads a mesh.** The renderer reads the sim (decals, wakes, sinking) and never writes it. The sim reads only
parts.js functions and def fields. The couplings that exist all go through shared parts.js code:

### Hulls (`def.shull`, 16 parts)
- `shullOf` is the hull's rings and `shullTris` its triangles. Together they are the 2D outline (`shullPath`), the
  clash shape (the side outline lofted across the beam), buoyancy and phys rings (ship.js), ground contact
  (`shullPts`), the hit triangles (`hullRay`, `hullDist`, the faces' armour codes), the HUD diagram, the bridge eye,
  spray and wakes. SPEC §8.3 promises **"what is hit is what is drawn, exactly"**.
- **Must stay:** `def.shull` (stations, wl, cls, ends, k, …), w/h/depth, `SHULL_NK`, the ring spacing, and `shullOf`
  and `shullTris` themselves (physics, hits, mp-naval.json and the ships suites). The loft's *surface* must remain the
  shullTris surface. ships-damage.test #1 needs the `shullTris(d)` call within 900 characters of
  `function shipHullGeo(d, S) {`.
- **Free to change:** the loft's colouring (vertex colours: more bands, panels, weathering, deck colours), its UVs,
  whether it has a texture (a deck texture would mean a `map` + vertexColors program, the one camouflage already
  uses), and **dressing** added as extra pieces or subs. Dressing includes rails, bulwarks, bollards, fairleads,
  anchors, hawse pipes, strakes, bilge keels, a stern's skeg, deck fittings, lifelines and hull numbers.
- Dressing limits:
  - builder-shapes 3c checks every hull vertex lies inside its clash shape within 1.5 cm: x within the side outline
    at that height, |z| ≤ depth/2. Vertices outside the part's **box** are skipped silently. Most hulls' decks sit at
    the box top (`yd = h/2`), so anything on deck (rails, a mast step) is outside the box. The test won't catch it,
    but the builder's clash, picking and the bridge camera (`eyeOut` keeps the eye out of part boxes) won't know it.
  - **Hole decals** sit 3 cm outside the analytic section (`holesOf`, `holeMarks`). Dressing proud of the plating by
    more than about 2 cm hides them. Decals on deck sit at `yd` + 3 cm: a deck covering thicker than that hides them.
  - Strakes and bilge keels below the waterline show through the water's depth shading (WP15) and the sinking veil
    (`markStencil` walks every mesh: fine).
- A smoother or finer *visible* hull (more bilge points, finer rings) moves the hit shape away from the picture by the
  bilge chord's sagitta (cm to dm on an X hull). The honest way is to refine `shullTris` (a separate, finer hit and
  render mesh with the physics rings untouched). That changes hits: an owner-level decision that moves the ships
  suites. Recommend not.

### Superstructure, drive, kit and naval weapons
- **tkit (37 parts, every `cat` but shHull, the guns, the ring, the house and the radars):** the clash is the **box**
  (`PART_RECIPE.tkit = 'kit'` is not round, flat or loft) and so is the hit (`armour.js geo`: `d.outline ||
  BOX_OUTLINE`, and no ship kit has an outline). **The 3D model is free inside its box.** builder-shapes 3e: every
  non-inner ship part's model at rest lies within 1.5 cm of its box and has at least one mesh. The bridge camera
  stays out of the boxes, so a model filling the box is fine.
- **Sim-read layouts that must not move:** `nvAsmLay(d).mouth(i)` (where an ASM leaves, ship.js:3885),
  `nvVlsLay(d).cells` (where a SAM leaves, :3886), `nvCiwsLay(d).gun` (the CIWS muzzle and reach, :4084, :4101).
  `def.screw.y` (the outboard's propeller height) must keep matching `shOutboardLay`'s hub; `def.foil.y` and `chord`
  must keep matching `shFoilLay`. Everything else in the `*Lay`/`shKitPts` functions is art (2D and 3D). Add new
  fields rather than move these.
- **Animation contract:** keep the role names and pivots. `shScrew` turns about x at the hub (port turns back),
  `shRud` about y at `L.xs`, `shOut` at `cl`, `shJet` at `xn`, `shRamp` hinged at the fore end's foot. `nvYaw` turns
  about y at `yb`, `nvPitch` about z at the gun, `nvSpin` about x. `nvCap<k>` covers or lids are hidden by count
  (`p.ammo`). `antenna` turns about y in flight only. `yaw`/`pitch`/`recoil` on guns and the FC radar:
  `rig.yaw.rotation.x = aimYaw`, `pitch.rotation.z = aimEl`, `recoil.position.y = −kick`.
- **Naval guns (tgun, 4):** the clash and hit are the box (posed by aim in armour.js `ownR`). Aim's muzzle is the box
  top (+h/2) along +y from the trunnion at `−h/2 + aim.pivot·h` (pivot 0.18), aim.js:274. A new model must keep the
  trunnion there, the barrel reaching +h/2, and the yaw/pitch/recoil nodes. **`gunLayout` and `BUILD.tankGun` are
  shared with every tank gun:** gate a naval model on `d.ship` (or `d.style === 'naval'`) or give the guns a
  `d.body3d`. body3d is safe here because their clash is already a box.
- **Naval radars (tradar, 3):** `radarLayout`/`BUILD.radarAnt` are shared with the ground update's radars. Gate on
  `d.ship`. The search antenna turns in flight (`searchRadar.rpm`) and may sweep past the box depth, as the Drone
  Radar's does (3d exempts it; 3e checks only at rest).
- **Gun House (`nHouse127`, tturret with `outline`):** CLAUDE.md's rule applies in full. Its outline *is* the 2D art,
  the clash (extrude: outline × depth), the 3D prism and the hit prism (armour `geo`). Never change the outline, w/h,
  depth or mm. Detail must stay inside the prism (3c: within 1.5 cm, no `CLASH_PAD` entry). A `body3d` would turn
  its clash into a box: don't.
- **Ring (`nRingM`, tring lathe):** its outline (`gvRingPath`, shared with tank rings) is the round clash and the
  `cyl` hit (`d.round`). Add fittings inside it; don't change the shared path.
- **Inner kit (8 parts):** never built in flight. They are plated boxes, visible only in the hangar and X-ray (in
  `GV_MOD` colours). Low value.
- **Paint:** `look: 'navyGrey'` on every shArms part (catalogue.test). BODY_KINDS (`shipGrey`, `armour`) take
  `S.base`. Painted maps redraw the 2D art in the skin. Hulls bake the skin into vertex colours (SKIN_GEO, model per
  skin). `patrolWhite.band` is cut into the bow. `navySplinter` is a camo map in metres. A new paintable kind must go
  into BODY_KINDS.
- **catalogue.test** pins 59 parts, their keys, shapes and styles (every style in `SH_KIT`/`NV_KIT`, `'engine'`, or
  shape tring/tturret/tgun/tradar), `look`, inner/flush/place, and the weapon fields. New styles must join `SH_KIT2`
  or `NV_KIT`.
- **2D and 3D must agree:** this holds by convention, through the shared layouts. The texture *is* the 2D art for
  plated faces. If the 3D grows fittings the 2D lacks, the 2D should gain them from the same layout (the side views
  are the builder's blueprint and the 2D fallback flight view).

### Old designs
Everything ship-specific in parts3d is reached only through `d.shull`, `SH_KIT`/`NV_KIT` styles or `d.ship`.
`plated`, `latheGeo`, `tankGun`, `radarAnt`, `gunLayout`, `radarLayout`, `merge`, `node`, `makeMat` and `KINDS` are
shared with tanks and planes. Don't change them; add ship-gated branches or new helpers. Tests that guard this:
ground-models.mjs (tank draw budgets TK-34 17, MA-1 23 against 30, bake, texture leaks) and graphics.mjs (old scenes
byte-identical, no shader built at the first explosion, program counts).

## 5. Costs today

- **Draws:** one mesh per (part, material kind), plus a shadow draw each on High (`rig.small` < 0.45 m³ casts none).
  An Arley draws 72 (144 with shadows). The `fleet` bench (Arley + Vizby + Osca) draws about 155 (+ shadows). A naval
  battle draws every ship within 50 km in full.
- **Materials:** a `MeshStandardMaterial` per (part, kind), from `instance` :2297. That is about 55 on an Arley, each
  with its own uniforms (needed for per-part heat glow, tint, char, X-ray fade and opacity). **Programs:** the ship
  kinds reuse existing variants (colour only, map, vertexColors, vertexColors + map for camo, glass's custom key,
  basic), so a ship adds no program. A new kind with new defines (normalMap, roughnessMap, aoMap) would compile new
  programs: they must be warmed while loading (`S.warm`) or the first ship stutters.
- **Textures:** a canvas per plated type and skin (2W×2H, up to 1024², never disposed), plus camo clones. No atlas,
  no normal maps on any craft. Normal maps exist only on terrain (`det.nrm`), ocean ripples (`rip.nrm`) and planets.
- **Hangar:** the whole VesselMesh is rebuilt on any add, remove, flip or repaint (render3d:7598). Models are cached
  per def; materials and meshes are recreated. A per-vessel dressing pass reruns then too.
- **Wreck bake:** a shallow-water sunk ship is a wreck (`wreckOf`) and bakes 6 s later in **one frame**
  (`bakeGeometry`). A TK-34 takes 3-20 ms. A detailed destroyer at 10× the triangles could stall a phone frame by
  100 ms or more. Budget it, or slice the bake.
- **Shadows:** Low has none. The shadow map is 2048. Thin detail (rails, lattices, wires) aliases in it: give fine
  detail `castShadow = false` per mesh (today the flag is per rig).
- **CPU per frame:** `VesselMesh.update` per rig (`place`, anim). More sub-nodes mean more matrix updates. Merge
  static detail into the part's existing pieces (node() already merges per kind).

## 6. Machinery that exists to reuse

1. **Sub-node roles** (`instance` :2295): any `{ role: 'x', pos, pieces, subs }` lands on `rig.x` (a Group). That is
   the cheapest per-part LOD switch: put the fine detail on a `role: 'fine'` sub and toggle its `.visible`. Today one
   name holds one group, so several need a list (as `stores`, `hinges` and `ruMove` are). Visibility is honoured by
   the bake, picking (`shown`), builder-shapes (invisible ancestors skipped) and the decals.
2. **Per-vessel pass:** `VesselMesh.pylons(parts)` :3027. It takes a layout signature from x, y, z, rot, flip, att and
   skin, calls `pylonsFor` per rig (:2452), builds in the vessel's group frame onto `rig.pylons`, frees it in
   `dropPylons`/`freeRig` and bakes it (`bakeList` :2875). That is the template for context-dependent hull dressing:
   rails broken where superstructure meets the deck edge, a sheer line across joints, fittings avoiding parts.
3. **Wreck bake** (`bakeGeometry` :2910, `bakeMat` :2719, `unbake`): a whole vessel as one mesh with per-vertex
   colour and texture means, still pickable per part (`bakedRun`). Generalised (not charred, not wreck-gated, sliced
   over frames), it is a **far-ship impostor**: one draw per ship past a few hundred metres.
4. **Props' distance LOD** (render3d `PROP_LOD` :4031, `propLod` :4140): instanced near and far shapes by radius,
   Settings.high-dependent radii and a move threshold. It is the pattern for distance rules, though craft aren't
   instanced.
5. **Vertex-colour band clipping** in `shipHullGeo` (`cut`, `fcut`): sharp painted bands at any plane with no texture
   or extra draw. Use it for waterline stripes, deck walkways, bow numbers' blocks and a dark weathering band.
6. **Shared layouts** (`sh*Lay`, `nv*Lay`, `shKitPts`, `shTubeLay`, `shRampLay`, `shStripe`): one function feeds the
   2D art, the 3D and (some) the sim. New detail should get its numbers from a new or extended layout, so 2D can match.
7. **Builders:** `mesh0` (indexed, normals by wanted direction), `sweep` (aerofoil or ellipse lofts), `loftGeo`
   (superellipse sections), `prismY`, `latheGeo`, `bladeGeo` (screws), `extrudeGeo`, `merge`, plus three's
   Tube, Lathe, Capsule and Torus geometries.
8. **Glass:** the `glass` kind (one program, Fresnel hook) for bridge windows.

## 7. Extension points (where WP16 code would go)

- **Automatic hull dressing, per def** (fittings that depend only on the segment): `BUILD.shipHull` (parts3d:1658),
  after `shipHullGeo`, as more `[geo, kind]` pieces and subs, the way tubes and the ramp are done. Take numbers from a
  new parts.js layout `shHullDress(d)`, beside `shTubeLay` :6658, so `shullDraw` (:6669) can draw the same fittings
  in 2D. Inputs: `shullOf(d).rings` (x, yd, yk, bd, bw per ring), `d.shull.ends` (closed bow: stem, hawse pipe and
  anchor; closed stern: transom fittings; joint ends: open, so railings run on), `shullBand(d)` (scale by class),
  `d.shull.bk` (bilge keels to draw), `d.shull.step`, `d.armour.belt`. Cached per def and skin by `model()`.
- **Hull paint detail:** inside `shipHullGeo`'s band loop (:833-841). Add bands through `cut`/`fcut` (boot-top
  edges, a deck edge band, darker plating rows). Plate seams, weld frames and draft marks as vertex colour need
  finer triangles, so prefer a small hull texture in metres (the camo path already gives metre UVs) or thin geometry.
- **Context-dependent dressing, per vessel:** a `VesselMesh.shipDress(parts)` next to `pylons()` (:3027), called
  from the constructor (:3022) and `sync` (:3129), gated on any `d.shull`. Store it on the hull's rig
  (`rig.dress`) so `prune`/`freeRig` free it with the part, and walk it in `bakeList` (:2875) as pylons are.
- **Per-part detail generators:**
  - superstructure and kit: `shipKit2` branches (:914-975). The fallthrough at :974 (house, helipad, hangar,
    tdecoy) is where the 0-detail parts live; give each style its own branch.
  - naval kit: `navalKit` (:981).
  - naval guns: a `d.ship` branch at the top of `BUILD.tankGun` (:1541) or `body3d: 'navalGun'` on the four defs.
  - radars: the same in `BUILD.radarAnt` (:1605).
  - the gun house: a `d.ship` branch in `BUILD.extrude` (:1175) that keeps `plated(d)` as the shell and adds
    fittings inside the prism.
- **Texture resolution for ship parts:** `texSize` (:116) has a per-def factor already (`d.drone ? 8 : 1`). A ship
  factor or cap (and a plan-view height that isn't `pow2(h·64)`: the helipad) goes there and in `paint` (:2069). Mind
  that `latheGeo`/`loftGeo`/`projUV` insets read `texSize`. That is harmless for ship-only defs.
- **Quality split (Low and High models):** today `model()` keys on type, flip and skin only. Either add the quality
  to the key and rebuild VesselMeshes on a quality change (render3d `applyQuality` :7775), or build both and toggle
  `role: 'fine'` subs from `VesselMesh.sync` using `o.quality` (already passed in `SYNC_Q`).
- **Distance LOD:** render3d `syncVessels` computes each vessel's camera distance `d` (:6263) before
  `e.vm.sync(v, q)` (:6290). Put `q.dist` (and a pixel size from `ext / d`) on `SYNC_Q` and let `VesselMesh.sync`
  switch fine subs, or swap to a baked impostor (generalised `bake`) past a threshold.
- **Shadow control per mesh:** `instance` (:2301) sets `castShadow = !rig.small` per rig. A piece-level flag
  (e.g. kind-based, or a `noShadow` on the node) is needed for rails and wires.
- **New materials:** `KINDS` (:21). For example deck non-skid, rubber fenders, canvas covers, brass, safety
  yellow and red, rust streaks via vertex colours. A paintable one goes into `BODY_KINDS` (:88). Plain-colour kinds
  share a program. A new texture type or define needs warming.
- **Tests to extend:** builder-shapes 3e (fine subs must lie inside the box), 3c (hull dressing inside the clash; add
  a check that above-deck dressing stays within a stated margin, since 3c skips out-of-box vertices),
  ground-models-style draw budgets per stock ship (none exist for ships), render-bench `shipnear`/`fleet` before and
  after (SPEC §15 has no model budget yet), graphics.mjs old scenes byte-identical, ships-damage #1 regex.

## 8. Gotchas found

- The helipad's top texture is 2.3 px/m across (§2). The stealth superstructure's side is 17 px/m along.
- The Gun House wears the tank turret's 2D art (`gvTurret`, no naval branch) and has no roof fittings
  (`GV_ROOF` has no entry for it).
- `torpDecoy` is not inner: it sits on the stern as a bare 12-triangle textured box.
- Above-deck hull dressing is outside the hull part's box. builder-shapes 3c skips those vertices, so a bad rail
  passes the test.
- Hole decals assume the plating is the analytic section + 3 cm.
- `shipHullGeo` is non-indexed (3 vertices a triangle). Keep new hull geometry indexed where possible.
- Every plated texture is never disposed (cache). More ship styles × 4 ship paints add canvases. At 2048² a
  1024×1024 canvas is 4 MB of GPU each; mind phone memory.
- The bake is one frame per wreck. A heavier ship makes a heavier hitch.
- `body3d` changes `clashShape` too (parts.js:1974): safe for box-clash parts (tgun, tradar, tkit), wrong for
  nHouse127 and nRingM.
- Changing `gunLayout`/`radarLayout`/`plated`/`roofFit` changes every tank. Gate on `d.ship`.
