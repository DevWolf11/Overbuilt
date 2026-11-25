# WP16 research: a critical look at today's ship models, and what they cost

`wp16/` below is `/tmp/claude-0/-home-user-Overbuilt/0587f056-6c41-58cd-9f76-3deee688a95a/scratchpad/wp16/`.
Tree: the frozen export of 727e2d2 (`wp16/tree`). Scripts: `wp16/look/look.mjs` (one Chromium, software WebGL, under
the browser lock), `wp16/look/parts2.mjs` (the parts from `funnel` on), `wp16/look/common.mjs`, `wp16/look/sheet.py`
(contact sheets). Raw numbers: `wp16/look/results.json` (and `wp16/look/bench-phone.json`,
`wp16/look/bench-desktop.json` for the render bench). Every picture is under `wp16/look/shots/`
(names below), taken at deviceScaleFactor 1, quality High unless said, Calm sea, noon, at the render bench's open-sea
spot (e −1344, z 3967, yaw 0.5). At sea the camera is a free eye (`Flight.impactCam`, so the HUD and the drone OSD are
hidden by CSS) placed round the ship in her own frame; the `*-game.png` shots are the game's own camera with the HUD,
as she launches (every stock ship is armed, so she starts in her guns' camera, `Flight.aimCam`).

Shots per ship (`<k>` = zodiak, higgens, cyclon, pegazus, osca, vizby, olivar, arley):
- hangar: `hangar-<k>-bow.png`, `hangar-<k>-stern.png` (three-quarter, panels hidden), `hangar-<k>-zoom.png` (on her bridge);
- sea: `sea-<k>-chase.png` (1.5 × her length from her starboard quarter astern, 18° up), `sea-<k>-chase-low.png` (the
  same on Low), `sea-<k>-bridge.png` (12-40 m on her bridge from the starboard bow), `sea-<k>-weapons.png` (10-30 m on her
  main gun from the port bow), `sea-<k>-aft.png` (her after deck), `sea-<k>-far600.png`, `sea-<k>-far1500.png` (and
  `-crop` round her), `sea-<k>-game.png` (the game's camera, desktop HUD);
- phone 390×844: `phone-<k>-game.png` (the game's camera, touch HUD), `phone-<k>-chase.png`;
- parts: `part-<key>.png` (each of the 59 alone in the hangar), `sheet-shHull.png`, `sheet-shSuper.png`,
  `sheet-shDrive.png`, `sheet-shArms.png`, `sheet-shKit.png`;
- the standard: `hangar-sugoi27-{bow,zoom}.png`, `hangar-fs16-{bow,zoom}.png`, `hangar-ma1-{bow,zoom}.png`,
  `hangar-leapard1-{bow,zoom}.png`, `cmp-sugoi27-chase.png`, `cmp-ma1-chase.png`, `cmp-cyclon-chase.png`, and two
  side-by-side sheets: `beside-ship-jet-tank.png` (hangar zooms: Olivar, Cyclon, Sugoi-27, MA-1) and `beside-chase.png`
  (the Cyclon at sea beside the jet's and the tank's chase on the runway);
- the render bench's own frames: `wp16/look/bench/<scene>-<profile>-<quality>-B.png`.
(The 24 parts up to `mastPole` were shot at 1280×720 by look.mjs; the 35 after it, from `funnel`, at 960×540 by
`wp16/look/parts2.mjs`, the camera settled with big steps: the same three-quarter view, 4 s a part instead of 70.)

## The verdict in one paragraph

The owner is right: they are not detailed, and on ships it shows more than anywhere else, because a ship is big on the
screen for a long time and the camera sits right over her deck. Every hull is a smooth-shaded loft with flat-coloured
bands (paint, boot-top, antifouling, deck) and nothing else: no texture, no seam, no fitting, no marking. Its plan and
sheer are straight lines between 2-5 stations (`shullSec` is linear), so the bows are visibly knuckled polygons, and
the topsides are one flat plane from the waterline point to the deck edge (`shullPoly`: no flare curve, no knuckle, no
sheer, no bulwark). Every superstructure part is a box or a one-outline prism with its 2D drawing pasted on its faces as
a texture of at most 512 px: windows, portholes, doors, ladders, louvres and the helideck's markings are paint, not
shape. The guns are the ground update's tank recipes (an olive tank-style house with a white mantlet block and a rod
barrel), the missile launchers are square boxes on two sticks, the radars a thin bent strip on a pole. The decks are
empty: not one rail, stanchion, bollard, fairlead, cleat, anchor, hawse pipe, life raft, boat, davit, whip antenna,
navigation light, searchlight, hull number, name, draft mark or deck marking on any of the eight (the only markings are
the helideck's circle and the Cyclon's patrol-white skin with its slanted red and blue bow band). Beside the look-alike jets and the Armour in the same game they read a generation older: the Sugoi-27 draws
36,248 triangles in 83 meshes over 22 m (1,650 a metre, panel lines, markings, a glass canopy, gear with hubs) and the
MA-1 Abrahm 8,600 in 23 over 10 m (830 a metre, camouflage, grilles, cupolas, road wheels, track links); the Arley Berk
draws 15,350 in 72 meshes over 163 m (94 a metre) and the Cyclon 7,270 over 32 m (225 a metre).

The cost side is good news, with one catch. A ship today is 3-15 k triangles in frames of 185-222 k (the sea, the
terrain, the sky and the clouds are the frame); on the SwiftShader rig the frame time with the ship shown or hidden is
the same within the rig's noise (±10 %: 1.1-1.5 s a software frame at 1280×720). There is room for 5-10× the
triangles. The catch is **draw calls**: every part is its own set of meshes, one per material, each also drawn into the
shadow map, so a ship adds about 2 GL draws per mesh (the same sea: Zodiak 107 draws, Cyclon 112, Pegazus 154,
Olivar and Arley 216; Low 90 → 144), the materials are not shared between parts (54 material objects for the Arley's
72 meshes), and there is **no level of detail for vessels at all**: at 600 m, where the Arley is 182 px long, she still
costs 176 draws. Detail has to come merged (static pieces of a ship baked into one mesh per material, as wrecks already
are with `VesselMesh.bake`) and with a far LOD, or the phone pays in draw calls, not in pixels.

## The worst ten crudities (in the order the owner would notice them)

1. **Olive army paint on naval guns.** The Gun House (`nHouse127`, `look: 'navyGrey'`) and its ring render in the
   Armour's olive drab (`GV_BASE #646d50`), because a gv part's 2D art ignores `look` (only the look-alike jets' `us5Draw`
   honours it, parts.js:4085) and no stock template paints it. The 30 mm `ringS`/`turretSmall`/`ac30` on the Osca, the
   Cyclon's mantlet and every tank gun used on a ship are olive too. On every armed stock ship the first thing in the
   game's own camera is a green tank turret on a grey ship (`sea-pegazus-weapons`, `sea-vizby-weapons`,
   `sea-olivar-weapons`, `sea-arley-weapons`, `sea-osca-bridge`).
2. **The hull is a slab.** Flat topsides from the waterline to the deck edge, a flat deck with no sheer, no camber, no
   bulwark, a dead-flat transom; the bows are 3-4 straight facets in plan and the stem a vertical knife with a flat
   top (`sea-cyclon-weapons`, `sea-olivar-weapons`, `sea-arley-weapons`, `sheet-shHull`). Real hulls flare forward,
   rise to the bow (sheer), tumble home or knuckle; none of that is there, so a 156 m destroyer reads as a barge.
3. **The default view is a blank wall.** Every armed ship starts in her guns' camera, low and right behind the stern:
   on a phone the Arley's transom fills ~40 % of the screen as a flat grey rectangle (`phone-arley-game`,
   `sea-arley-game`, `sea-vizby-game`). Nothing on it: no name, no stern light, no stern gate, no fairleads.
4. **Things that poke through or float.** The Arley's after vertical launcher (x −72.4) sticks out of her transom: its
   plated box's end view (black stripes) shows as a black striped panel on the transom in the default view
   (`sea-arley-game`, `phone-arley-game`). The Vizby's helicopter deck (14 m deep) is wider than her 11 m hull and
   overhangs both sides (`sea-vizby-game`). The machine guns on the Zodiak's and Higgens' consoles hang in the air with a
   visible gap (`sea-zodiak-weapons`, `sea-higgens-weapons`). The bow guns' houses overhang the stem (`sea-*-weapons`).
5. **Seams at every hull joint.** Each segment is its own closed loft; where two meet there is a dotted light line down
   the side and across the deck (`sea-cyclon-weapons`, `sea-osca-weapons`, `hangar-cyclon-stern`), the end caps
   showing through T-junction cracks.
6. **Superstructure is paper.** Boxes with painted windows, portholes, doors and ladders (`hangar-olivar-zoom`,
   `hangar-cyclon-zoom`): no depth to a window, no door frame, no rail on a bridge wing, no visor; the funnel is a
   square box with a painted louvre and a black lid (no taper, no cap, no exhaust pipes, no smoke-stained top); the
   Vizby's stealth superstructure is a vertical-walled shoebox with painted panel lines (the real one's whole look is
   its inward-raked facets; `sea-vizby-bridge`).
7. **Weapons are stand-ins.** The naval gun is a tank gun (a white mantlet block and a thin black rod; no gun shield
   shape, no blast bag, no muzzle detail) in an oversized slab house; anti-ship canisters are square planks on two
   sticks (`sea-pegazus-aft`, `sea-osca-aft`); the vertical launcher is a 2×4 grid of light tiles that read as
   skylights (`sea-olivar-bridge`); the decoy launcher is a white box with six black dots (`sea-osca-weapons`).
8. **Radars and masts are bare.** The air and surface search radars are a 0.34 m strip bent on a pole (`radarLayout`'s
   `hh: 0.17` whatever the part's size) where the real thing is a big mesh or a flat array; no yards, no whip antennas,
   no ESM domes, no lights, no flags; the destroyer has none of her four big flat array faces, the Vizby's three radars
   sit loose on a flat roof (`sea-vizby-bridge`). The lattice mast is the one good part.
9. **Empty decks, no markings.** No rails, bollards, anchors, life rafts, boats and davits, ladders, hatches, vents or
   lockers anywhere; no hull number, name, draft marks or deck markings (the helideck's circle and the Cyclon's bow band
   aside), no weathering or
   rust streaks: a 156 m deck reads as one grey plane (`sea-arley-bridge`, `sea-arley-aft`). The jets carry stars and
   panel lines and the tanks camouflage, grilles and bolts; the ships carry nothing.
10. **Blurry flat parts.** The plated texture's plan view is sized by the part's side height (`texSize`: a 16 × 0.4 ×
    14 m helideck gets 512 × 32 px for its plan, 2.3 px a metre across), so the helideck's circle and H smear
    (`hangar-vizby-stern`); a 30 m stealth superstructure gets 17 px a metre along its sides.

Also seen (smaller): the Zodiak has none of a RIB's look (a flat deck over the whole hull, thin tubes low on the side
instead of fat tubes over the gunwale, no seats, no A-frame; `sea-zodiak-bridge`); the Higgens is a closed shoebox (no
open well, no visible ramp, no troops; `sea-higgens-chase`); the splinter camouflage runs across the Osca's deck as
dark bands; the far ships (600 m) look clean, bright and toy-like (no weathering, no shadowed detail, no wake at rest);
red antifouling shows at the waterline at her ends.

## Per ship (one line each, then notes)

| Ship | What reads as crude |
|---|---|
| Zodiak RIB (9.8 m) | a flat-decked grey slab with a polygon bow; the tubes a thin strip low on the side; a box console; the MG floating over it; outboards are two black blobs; no seats, A-frame, grab lines, lights |
| Higgens Landing Craft (13 m) | a closed shoebox: no open well, no troops, no ramp hinge or ramp face; two MGs floating over a box console; flat sides, no rubbing strakes |
| Cyclon Patrol Boat (32 m) | white slab hull with a 3-facet bow and flat transom; box wheelhouse with painted windows; olive-mantled tank turret forward; two bare MGs on the after deck; a white pole mast with no radar or lights; seams at the joints |
| Pegazus Hydrofoil (44 m) | an olive gun house as tall as her wheelhouse overhanging the stem; two "plank" launchers aft; a flat strip radar on a pole; foils hidden under water; slab hull |
| Osca Missile Boat (41 m) | splinter camo bands over a slab hull and deck; two olive tank turrets; two thin plank launchers where the real boat's four big box launchers are its silhouette; the fire-control dish hangs off the wheelhouse roof on a sideways bracket (the tank radar's post) |
| Vizby Stealth Corvette (76 m) | a vertical-walled shoebox superstructure (no facets), painted panel lines; olive gun house; helideck wider than the hull; three loose radar bits on the roof |
| Olivar Perri Frigate (113 m) | boxes in a row with painted portholes; square funnel; VLS as skylight tiles; olive 76 mm house overhanging the stem; empty decks; the lattice masts are fine |
| Arley Berk Destroyer (163 m) | a long flat barge: three low sheds, two square chimneys, a lattice mast; none of the big pyramid superstructure, raked mast, flat array faces or flared bow; olive 127 mm; VLS sticking out of the transom; 60 % bare deck |

Notes:
- **Proportions.** The destroyer's superstructure is far too low and short for her hull (two 5 m deckhouses and a 7 m
  bridge on a 16 m-beam, 11 m-deep hull); the patrol boats' gun houses are too big (the Pegazus' 5 × 3 × 4.4 m house
  towers over her 3 m wheelhouse). Masts are thin and short on everything but the frigate.
- **Colours.** Haze grey `#8b939a` is right-ish but too clean and light at a distance (the far ships read near white);
  the deck `#5e6266 × 0.8` is fine; the boot-top is a thin black band (fine); glass `#1b3446` reads dark blue (fine).
  The olive pieces are the wrong colour outright (above).
- **Faceting.** The bilge is five points a side, smooth-shaded, which reads acceptably below the waterline; above it
  the one flat plane and the linear stations give the knuckled look. The hull has 24 rings a segment (`w/24` spacing),
  so the knuckles are the stations, not the ring count.
- **Z-fighting / poke-through.** The joint seams; the after VLS through the Arley's transom; the helideck's flat slab
  on the deck (no fight seen, it is raised 0.4 m); the deckhouses butted end to end with visible seams on the Olivar.
- **Low quality.** Identical models; no shadows, so the boxes look even flatter (`sea-pegazus-chase-low`).

## Per part

Contact sheets: `sheet-shHull.png` (16), `sheet-shSuper.png` (10), `sheet-shDrive.png` (12), `sheet-shArms.png` (15),
`sheet-shKit.png` (6); each part alone, three-quarter from the bow, quality High. Detail grade: 0 = a box or one-outline
prism with its 2D art pasted on; 1 = a few primitives; 2 = a recognisable built model; 3 = the jets' standard (lofted,
fitted, marked). "inner" parts are never built at sea (only the hangar shows them).

**Hulls (shHull, 16; grade 1).** Every hull piece is the same recipe: a smooth-shaded loft, flat paint, a thin black
boot-top and (on M/L/X) a red antifouling strip, nothing else.
- `hbBowS/M/L/X` (bows): the plan is 3-4 straight facets (linear stations), the stem a vertical knife with a flat
  top; the topside is one plane from the chine to the deck edge, so no flare, no knuckle, no sheer rising to the bow, no
  bulwark or breakwater, no anchor, hawse pipe, bullnose, fairlead or jack staff. The destroyer bow (`hbBowX`) is the
  same shape as the patrol bow stretched; no bulbous bow, no sonar dome.
- `hbMidS/M/L/X` (midsections): a rectangular box above the boot-top (the bilge only shows under water); no rubbing
  strake, no deck-edge gutter or rail, no side doors, no plating seams, no hull number. Big midsections fill the
  hangar's default framing (the part is wider than the view: `part-hbMidL`, `part-hbMidX`).
- `hbSternS/M/L/X` (sterns): a dead-flat vertical transom and a flat deck to the edge; no stern gate, no transom flap,
  no ensign staff, no stern light, no fairleads or bitts, no name.
- `ribHull`: a flat-decked hull with a thin strip of tube low on its side (`shTubeLay`); a RIB's look is fat tubes over
  the gunwale, a deep-V hull, seats/jockey pods and an A-frame: none of it.
- `lcHull`: a closed box with a hinged plate for a ramp; no open well, no side walls with a walkway, no ramp hinge,
  winch or bow-door detail.
- `pontoon`: a slim boat-shaped float: fine for a float plane. `stepHull`: a flying-boat hull with no visible step or
  spray strakes.

**Superstructure (shSuper, 10).**
- `bridgeM` (1), `bridgeL` (1): a box with a raked front, glass quads on the window band (they read well: dark blue with
  frames), but portholes, doors and a ladder are painted; no bridge wings, no visor or sunshades, no wipers, no rails on
  the roof, no searchlights or navigation lights, no signal lamps.
- `consoleS` (1): a small box with a windscreen and a torus wheel; fine at RIB scale, but no seat, grab rail or T-top.
- `deckhouseL` (0): a box with painted portholes, doors, ladder and a roof hatch; at 37 px/m along it is soft when close.
- `stealthHouse` (0): a vertical-walled prism of the side outline with painted panel lines and two black window slots;
  the whole point of the real stealth superstructure is its inward-raked faceted walls.
- `funnel` (0): a square box with a black lid and four painted louvre lines; no taper, no cap, no exhaust uptakes, no
  soot, no ladder.
- `helipad` (0): a flat slab with the landing circle and H painted on a 2.3 px/m plan texture: the circle is a blurred,
  jagged ring (`super3.png` / `part-helipad`); deck-edge lights painted on the side; no safety net, no tie-down grid.
- `hangar` (0): a box with painted shutter lines and portholes; no shutter frame, no hangar door recess.
- `mastLattice` (2): the best part: real rods, a platform and a rail. Lacks yards, whip antennas, ESM domes, lights.
- `mastPole` (1): a tapered pole with a short yard and a light; reads as a flagpole.

**Drive (shDrive, 12).**
- `screwS/M/L` (2): one bronze 4-blade model scaled: flat paddle blades, no skew, no rake, no cupping, no fillet;
  readable in the hangar, hidden at sea.
- `rudderM/L` (1): a flat red slab with a stock; no streamlined section visible, no horn.
- `outboard` (2): a capsule cowl on a box leg: fine for the size, but no colour or brand-free decals, no tiller.
- `waterjet` (1): a cylinder with a half-cylinder bucket; fine (mostly under water).
- `foilBow` (1), `foilAft` (2): a flat red plank on grey struts; the struts take the hull grey and the foil antifouling
  red, so on a raised hydrofoil the foils read as red planks; no strut fairing or pod.
- `dieselM`, `dieselS`, `turbine` (0, inner): boxes with the tank engine art on one face and **olive end faces**
  (the Armour's art); hangar only.

**Arms (shArms, 15).**
- `nHouse127` (0): a six-sided olive slab painted with the tank turret's art (`look: 'navyGrey'` ignored by gv art);
  a real naval gun house is a smooth, raked, faceted shield with a blast-bag opening, access doors and a sight hood.
- `nGun57/76/127/152` (1): one tank-gun model scaled: a white rectangular mantlet block, a black breech, a plain
  black rod barrel with a muzzle ring. No barrel taper, no blast bag, no muzzle brake on the 57, no cooling jacket.
- `nRingM` (1): the ground update's turret ring with painted bolts; olive.
- `ciws` (2): a lathe dome on a box mount on a cylinder: the right idea, but the gun is a short black stub (no six-barrel
  cluster visible at a distance), and the dome is white while the mount is grey; no ammunition drum or radar bulge.
- `asm2`, `asm4` (1): flat rectangular planks on two thin sticks and a base plate; the real canisters are round
  (or square-section boxes with end caps and ribs) on a substantial cradle; the canisters' end caps are white plates.
- `vls8` (1): a dark box with eight pale lids on top: from above, the lids read as skylights; no hatch hinges, no
  uptake vents, no deck flush mounting (it stands proud).
- `torpTube` (2): three tubes with bands on a post: reasonable.
- `nRadarAir`, `nRadarSea` (1): a pole and a 0.34 m-tall curved strip (fixed height) whatever the part's size: the real
  thing is a big open-mesh or slotted array; at sea it vanishes.
- `nRadarFC` (2): a dish on a post with a feed: the right idea, small.
- `decoy` (1): a white box with six black dots; real launchers are angled tube clusters.

**Kit (shKit, 6; grade 0).** `bulkhead`, `pump`, `ballast`, `dcLocker`, `magazine` (inner) and `torpDecoy` are boxes
with their 2D art on one face; only `torpDecoy` is seen at sea (a small box on the stern). These are fine as hangar
symbols; they need no more than tidy faces.

Totals across the 59: 42 are grade 0-1 and seen at sea (all 16 hulls; 9 of the 10 superstructure parts; the gun house,
the four guns, the ring, both ASM launchers, the VLS, two of the three radars and the decoy; both rudders, the bow foil
and the waterjet; the torpedo decoy); 9 are grade 2 (lattice mast, three screws, outboard, main foil, CIWS, torpedo
tubes, fire-control radar); 8 are inner boxes seen only in the hangar; none reaches grade 3.

## Beside the standard: a jet and a tank

Sheets: `beside-ship-jet-tank.png` (hangar zooms at the same framing: Olivar's bridge and funnel, the Cyclon's
wheelhouse, the Sugoi-27's flank, the MA-1's turret) and `beside-chase.png` (the Cyclon at sea beside the jet and the
tank in their chase on the runway).

- **The Sugoi-27** (`hangar-sugoi27-zoom`): a lofted body with smooth curvature, engraved panel lines, a two-tone
  camouflage, red stars on the fins, a glass canopy with a highlight, intake lips, gear with tyres and hubs, missiles on
  rails. Even in the chase on the runway every class of detail reads (`cmp-sugoi27-chase`).
- **The MA-1 Abrahm** (`hangar-ma1-zoom`): still prisms, but every prism carries something: a three-colour camouflage,
  rivet rows on the skirts, engine grilles, cupolas with vision blocks, a smoke-launcher cluster, a loader's MG, a gun
  with a fume extractor and thermal sleeve bands, road wheels and track links. The shadows on it read as shape.
- **A ship** in the same hangar (`hangar-olivar-zoom`, `hangar-cyclon-zoom`): flat faces with painted portholes, doors
  and ladders; the one 3D thing is the glass. The funnel's black lid and painted louvres are the whole funnel. At sea
  the Cyclon (`beside-chase`, top-left) is a white slab with a box and a pole; the jet and tank beside it read as
  models, she reads as a placeholder. By triangles per metre: jet 1,650, tank 830, Cyclon 225, Arley 94.
- **Where ships are already at the standard**: the lattice mast (rods, platform, rail) and the bridge glass. The sea
  around them (the swell, wake and spray of WP15) is now better than the ships on it.

## Measurements

At sea, desktop 1280×720 at pixel ratio 1, Calm, noon, the chase camera (1.5 × her length). "Ship" columns are her own
`Render3D.meshOf(v)` (visible meshes, triangles, meshes casting shadows, distinct material objects, textured
materials); "frame" columns are one whole frame's GL draws and triangles counted at the WebGL calls (every pass:
shadow, main, water veils) and three's program count; ms is the median of 14 SwiftShader frames with a one-pixel read
(the GPU's work done), the ship shown / hidden (`vm.group.visible`); far: her length in pixels and the frame's draws at
600 m, her length at 1.5 km; phone: 390×844 (pixel ratio 1) at the same chase, High.

| Craft | L m | parts | ship meshes | ship tris | tris/m | casting | mats | tex | frame draws | frame tris | programs | Low draws | Low tris | ms High shown/hidden | ms Low shown/hidden | 600 m: px, draws | 1.5 km px | phone draws, tris |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Zodiak | 10 | 6 | 19 | 6,066 | 619 | 17 | 13 | 1 | 107 | 199,944 | 43 | 90 | 125,938 | 1324 / 1329 | 1214 / 1180 | 11, 67 | 4 | 79, 191,578 |
| Higgens | 13 | 11 | 13 | 3,438 | 264 | 5 | 13 | 1 | 89 | 193,396 | 70 | 85 | 123,330 | 1413 / 1460 | 1091 / 1097 | 15, 49 | 6 | 61, 185,030 |
| Cyclon | 32 | 20 | 25 | 7,270 | 225 | 15 | 25 | 3 | 112 | 201,816 | 70 | 97 | 127,152 | 1537 / 1426 | 1105 / 1119 | 36, 72 | 14 | 83, 192,790 |
| Pegazus | 44 | 27 | 43 | 9,040 | 204 | 39 | 40 | 3 | 154 | 207,270 | 71 | 114 | 129,424 | 1369 / 1367 | 1128 / 1101 | 50, 114 | 20 | 125, 198,106 |
| Osca | 41 | 31 | 43 | 10,048 | 243 | 35 | 41 | 8 | 150 | 208,172 | 73 | 114 | 130,432 | 1311 / 1346 | 1088 / 1061 | 46, 110 | 19 | 121, 199,018 |
| Vizby | 76 | 28 | 40 | 10,228 | 135 | 40 | 36 | 4 | 152 | 210,180 | 72 | 112 | 130,901 | 1323 / 1289 | 1157 / 1017 | 84, 112 | 34 | 120, 200,538 |
| Olivar | 113 | 39 | 72 | 14,950 | 132 | 72 | 54 | 10 | 216 | 219,900 | 73 | 144 | 135,735 | 1402 / 1378 | 1218 / 1165 | 127, 176 | 51 | 187, 210,854 |
| Arley | 163 | 43 | 72 | 15,350 | 94 | 72 | 54 | 10 | 216 | 221,859 | 73 | 144 | 136,126 | 1465 / 1339 | 1180 / 1038 | 183, 176 | 73 | 188, 213,134 |
| Sugoi-27 (jet, runway) | 22 | 22 | 83 (95 built) | 36,248 | 1,655 | 83 | 44 | 14 | 233 | 234,520 | 42 | 147 | 151,274 | 1228 / 1092 | 1003 / 1018 | | | |
| MA-1 Abrahm (tank, runway) | 10 | 15 | 23 | 8,600 | 831 | 14 | 21 | 11 | 104 | 176,992 | 63 | 87 | 123,446 | 1168 / 1073 | 1029 / 999 | | | |

What it says:
- **Triangles are not the problem.** The sea and terrain are ~185-200 k of every frame; the biggest ship adds 15 k. The
  jet the owner already likes adds 36 k. A ship at 5-10× today's triangles (75-150 k for the Arley close up) would
  still be under the jet's density per metre and inside what the frame already carries, *if* far ships drop to a
  cheap LOD.
- **Draw calls are.** Frame draws track ship meshes at about 2 per mesh (shadow + main: a line through the eight ships
  gives ~68 draws for the sea and sky alone plus 2.06 a visible mesh). The Arley's 72 meshes take the frame from ~68 to
  216 draws; a naive detailed ship (hundreds of small meshes: rails, bollards, rafts...) would put a phone
  over its draw budget. Static detail must be merged per ship (one mesh per material: paint, deck, glass, dark metal,
  rubber), like `VesselMesh.bake` does for wrecks, while moving pieces (guns, radars, screws, rudders, ramp, caps) keep
  their rigs.
- **No vessel LOD.** At 600 m (Arley 183 px) the frame still pays 176 draws for her; at 1.5 km (73 px) the same. A far
  LOD (her hull and superstructure as one merged, lower mesh; masts as lines) is what lets near detail be rich.
- **Materials per part.** Each part rig makes its own materials (tint, opacity, X-ray, char per part), so 54 material
  objects for 72 meshes; programs stay at 70-73 (shared), so this is uniform-upload cost, not compiles.
- **Frame time.** On SwiftShader the ship's own cost is inside the noise (shown vs hidden differs by −3 % to +14 %,
  either sign); the frame is the sea's fill. This rig cannot show a ship's GPU cost below ~10 %; the draw-call count
  and the phone profile of the render bench are the measures to hold (below).
- **Textures.** 1-10 per ship (plated parts' 2D art, ≤ 512 px a side, shared per type and paint); no hull texture.

**Render bench** (`test/bench/render-bench.mjs` on this tree alone, under the browser lock, 4 rounds of 2 frames;
`ship1k` from spec §15 was never built, so the ship scenes are `shipnear` (the Cyclon at 40 kn, Moderate, chase from
astern: swell, wake and spray on) and `fleet` (the Arley's foredeck, Hostile wave 3 at 1-1.4 km, the sim stepped), with
`sea300` (a plane 300 m over the same open sea, no ship) as the sea without a ship. Raw: `wp16/look/bench-phone.json`,
`wp16/look/bench-desktop.json`, `wp16/look/bench.log`; the frames: `wp16/look/bench/`. The phone profile is 390×844 at
pixel ratio 2 with a 4× CPU slowdown for the CPU column; gpu ms is SwiftShader's wall time for a finished frame (the
GPU's work, on this shared 4-core machine), cpu ms the frame's JS with nothing drawn.

| Scene | Profile | Quality | gpu ms (median; spread) | cpu ms | canvas draws / verts | shadow draws / verts | programs |
|---|---|---|---|---|---|---|---|
| sea300 (no ship) | phone | Low | 289 (260-334) | 0.40 | 74 / 375 k | 0 | 31 |
| shipnear (Cyclon) | phone | Low | 340 (314-448) | 0.86 | 68 / 358 k | 0 | 33 |
| fleet (Arley + 2 AI) | phone | Low | 249 (237-265) | 6.91 | 76 / 367 k | 0 | 29 |
| sea300 | phone | High | 856 (826-951) | 0.31 | 74 / 509 k | 42 / 40 k | 36 |
| shipnear | phone | High | 1018 (969-1092) | 1.02 | 69 / 563 k | 15 / 16 k | 38 |
| fleet | phone | High | 940 (919-994) | 7.11 | 76 / 572 k | 72 / 46 k | 34 |
| sea300 | desktop | High | 1361 (1321-1380) | 0.53 | 119 / 548 k | 42 / 40 k | 40 |
| shipnear | desktop | High | 1601 (1535-1761) | 0.35 | 99 / 589 k | 15 / 16 k | 42 |
| fleet | desktop | High | 1083 (1033-1343) | 1.66 | 138 / 620 k | 72 / 46 k | 38 |

What it says: the ship scenes cost what the sea costs; `shipnear` is +18-19 % over `sea300` on the phone, but that is
the swell, the wake and the spray at 40 kn in Moderate sea plus a near camera filling the screen with water, not the
Cyclon's 25 meshes (the whole `shipnear` frame draws fewer calls than `sea300`'s). `fleet` is cheaper on the GPU than the open sea
most likely because the Arley's flat hull covers a third of the screen with cheap opaque pixels in place of
water; its CPU (6.9-7.1 ms at 4×
slowdown) is the three ships' simulation and the AI, not their models. The shadow pass in `fleet` (72 draws) is the
ships' meshes, each drawn again; that is the pass a detailed ship would multiply. Nothing here sets a GPU limit on
ship detail; draw calls and the shadow pass do (above).

## Where each model comes from (code map) and what binds a fix

| Parts | Recipe (parts3d.js) | What it is |
|---|---|---|
| 16 hulls (`shape: 'shull'`) | `BUILD.shipHull` → `shipHullGeo` (782) from `shullTris` (parts.js 6573) | the loft of `shullOf` rings (24 a segment, 15 corners a ring; stations linear, `shullSec` 6475; the topside one straight edge, `shullPoly`), vertex colours by band (paint, boot-top, antifouling, deck), no UVs but camo; RIB tubes (`shTubeLay`), the landing craft's ramp (`rig.shRamp`) as subs |
| bridgeM, bridgeL, consoleS | `shipKit` / `shipKit2` (879, 914) | `plated()` prism of `shBridgePts`/`shKitPts` with the 2D art as its texture, glass quads on the window bands; console: a torus wheel |
| deckhouseL, hangar, helipad, the inside kit (diesels, turbine, bulkhead, pump, ballast, dcLocker, magazine, torpDecoy) | `shipKit2` fallback / `kit` → `plated(d)` (707) | boxes with the 2D side/plan/end views painted on (`shKit2`, `shKit2Plan`, `shKit2End`, parts.js 6866-7066) |
| stealthHouse, funnel | `plated(d, { pts: shKitPts })` | a side-outline prism (vertical walls), art painted |
| mastLattice, mastPole | `shipKit2` lattice/pole | rods, a platform and a rail (the best part); a tapered cylinder, a yard, a light |
| screwS/M/L, rudderM/L, outboard, waterjet, foilBow/Aft | `shipKit` / `shipKit2` | lathe boss + `bladeGeo` blades (bronze), NACA prism blades, capsule cowl + box leg + box blades, cylinders + half-cylinder bucket, foil prisms on struts |
| nRingM | lathe (`tring`, `LATHE_KIND` plate) | the ground update's turret ring |
| nHouse127 | `extrude` → `plated(d)` of its 6-point `outline` (parts.js 1569) | a faceted slab, painted with the Armour's art (olive) |
| nGun57/76/127/152 | `tankGun` (1541, `gunLayout` 5303) | a tank gun: mantlet extrude, breech box, lathe barrel |
| ciws | `navalKit` nvCiws (981) | cylinder base, box mount, lathe dome, six rods |
| asm2/asm4 | `navalKit` nvAsm | square box canisters on box legs, white cap plates |
| vls8 | `navalKit` nvVls | a plated box with 8 thin lids |
| torpTube, decoy | `navalKit` nvTorp / nvDecoy | three cylinders with bands on a post; a box with cylinder mouths |
| nRadarAir, nRadarSea | `radarAnt` search (1605, `radarLayout` 5493) | a pole and a 0.34 m-tall curved strip (fixed height `hh: 0.17`) |
| nRadarFC | `radarAnt` track | a dish on a post with a feed |

What binds any fix (the invariants a detail pass must keep):
- **Looks only** (the owner's assumption): no mass, `w`/`h`/depth, stations, hit shape or handling changes. The hull's
  drawn vertices *are* `shullTris` (WP8: hits are found on the drawn loft, `Ship.hullRay`), so a smoother drawn hull
  must stay within a few cm of `shullTris` or the holes and decals land off the drawn skin; detail on the hull (rails,
  bulwarks, anchors, markings) goes on as separate non-hit geometry or as a texture/decal.
- **Inside the part's box**: `test/browser/builder-shapes.mjs` (3e) checks every ship part's model lies inside its box
  and every hull is its loft. Rails, antennas, whips and yards that stand proud of a part's box need the test widened or
  the box (never `w`/`h`: CLAUDE.md) left alone and the detail kept inside.
- **2D = 3D**: plated parts take their 2D art as texture; a modelled window or door must agree with the 2D drawing
  (or the 2D art follows).
- **Moving rigs**: `shScrew`, `shRud`, `shOut`, `shJet`, `shRamp`, `nvYaw`/`nvPitch`/`nvSpin`, `nvCap*`, the radars'
  `antenna`, the guns' `yaw`/`pitch`/`recoil`: detail must ride the right node.
- **Old designs and the jets/tanks**: ship-only recipes (`d.ship`) so no old part's model changes (graphics.mjs and the
  hangar bench scene pin old pictures byte for byte).
- **Paint**: skins bake into hull vertex colours (`SKIN_GEO`) and plated textures; a new detail must take the part's
  paint (and camouflage) or stay a fitting colour.
- **Wrecks, holes, X-ray, char**: `bakeList`/`char`/`xrayRig` walk every rig mesh; hole decals and the damage diagram
  read the hull loft.
