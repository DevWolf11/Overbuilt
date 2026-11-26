# WP16 references: the real vessels, their equipment, colours, and how games make detailed ships cheap

Notes for modelling only. Real names appear here because these are notes; player-visible text keeps the altered names
(Arley Berk, Olivar Perri, Vizby, Osca, Pegazus, Cyclon, Higgens, Zodiak).

**Confidence tags.** **[S]** = stated by a cited source (numbered, list at the end). **[K]** = general naval knowledge and
photo memory, not checked against a source in this pass: right in outline, but check the detail against photos
(DVIDS, NavSource, Wikimedia Commons) before a modeller commits to it. **[est]** = my estimate from profile drawings,
±15 %.

Code facts below (template contents, part sizes, triangle counts) come from the frozen tree's `js/builder.js`
(templates :488-620) and `js/parts.js` (59 defs :1398-1631), and from the sibling note `wp16/code.md` (counts).

---

## 1. Colours

| Use | Real standard | sRGB to use | Source / note |
|---|---|---|---|
| Haze grey (USN topsides, vertical surfaces) | Navy Haze Gray No. 27, FS 36270 (26270 semi-gloss) | **#828788** (from the MIL spec's CIELAB L\* 56.0, a\* −1.83, b\* −1.37, converted). Modellers' values: #858A8D, #818789, #858691 | [S2][S3][S4][S5]. SPEC's `navyGrey` #8b939a is ≈ 4 L\* lighter and a touch bluer than the spec: fine as a lit base, but the deck/hull ratio below matters more than the exact value |
| Deck grey (horizontal surfaces, plain decks) | Exterior Deck Gray, FS 26008 | **#464850** (approx.) | [S5][S6]: modellers' rule "26270 vertical, 26008 horizontal" |
| Non-skid (walkways, gun decks, flight deck) | Dark Gray FS 36076 (MIL-PRF-24667 non-skid) | **#4a4c57** (approx.); some carriers use black non-skid FS 37038 | [S5][S6] |
| Boot-top | Black anti-fouling band from the minimum load waterline to 12 in above the maximum load waterline; haze grey is carried down to it | **#2a2a2c** (FS 37038 is listed as #343236; FS 17038 #0b0b0d is too black for a lit PBR surface) | [S7] defines the band; the colours [S5] |
| Underwater body | Copper anti-fouling; US warships are red-brown ("hull red") in photos of docked ships, some navies black | **#7a3b32** wet, **#874840** dry (FS 30109 dull red) | [S5] for FS 30109; colour choice [K] (no source pins the current USN colour; [S7] says only "anti-fouling") |
| Hull numbers, traditional | White numerals with a black drop shadow, on both bows; name on the transom | white #f0ecee, shadow #1e1e20, the shadow offset down and aft about 1/8 of the numeral height | [S8] modellers; "on the starboard bow it reads white over black" |
| Hull numbers, low-visibility | "Replace white with light gray and black with ocean gray" (also draft marks and name) | light grey ≈ #b0aaad (FS 36440), ocean grey #747683 (FS 36173) | [S7] wording, [S5] values. Many Burkes show the low-vis scheme; some kept white [S8] |
| Funnel tops, mast tops | Black above a line, to hide soot and cut electro-optical contrast on later ships | #232325 | [S8] (forum, ties black masts/funnel tops to the low-vis era) [K] |
| Patrol white (Cyclon's stock skin) | — | white with a red band, as SPEC's `patrolWhite` | The real Cyclones were haze grey [K]; white with a racing stripe is a coast-guard look. Keep it (it is the stock skin), but the grey skin should look right on her too |
| Soviet grey (Osa) | Varied by fleet; photos lean grey-green | ≈ #8a948f (grey with a green cast) [est] | [S9] (fleet-dependent, "grey/green side") |
| Swedish navy (Visby) | Not found in sources; a signature-reducing IR paint [S10]. Photos: a mid-to-dark grey, flat, almost no markings | `navyDark` #5d666e is a fair match [K] | |
| Bridge glass | Tinted laminated glass; from outside it reads near-black with the sky reflected | base #1c2529, metalness 0, roughness 0.05, strong Fresnel | [K] |
| RIB tubes | Hypalon/neoprene: military grey or black, SAR orange | grey #4b4f52, black #1d1e20 | [K] |

**Weathering that makes a grey ship read as real [K]:**
1. Rust streaks running *down* from: hawse pipes (the biggest, a brown fan under each anchor), scuppers and drain
   holes along the deck edge (thin vertical streaks every few metres), fairleads and bollard bases, the boot-top line
   (a ragged rust line along the waterline amidships), weld seams on the bow.
2. Exhaust soot on funnel caps and on the aft faces of anything just behind a funnel; brownish on gas-turbine ships.
3. Salt bloom: lighter, chalky patches low on the bow and along the sheer.
4. Dark grime: around gun mounts, hatch edges (VLS lids show as a dark grid), deck fittings, and boot-top scuffing at
   the bow.
5. Paint patches: slightly different greys where panels were touched up (a blotchy hull at 200 m is very "real ship").
All of these are vertex-colour or small-atlas work, never a unique texture per hull (§4).

---

## 2. The eight ships

### 2.1 Arley Berk Destroyer → Arleigh Burke class (DDG-51)

**Which Flight: our template is closest to Flight I (DDG-51-71).** It has no hangar (Flight I and II have a flight deck
but no hangar [S11][S12]), a quad anti-ship launcher (`asm4`; Flight I/II carry two Mk 141 Harpoon quads, Flight IIA
dropped them [S11][S12]) and two ordinary funnels (Flight I's "distinctive stacks"; IIA redesigned them and from DDG-89
buried them in the superstructure [S11][S12]). Two things lean IIA or are our own: one close-in gun, aft (Flight I had
two, fore and aft; DDG-85 on have one, aft [S11]) and a 156 m hull (Flight I 154 m, IIA 155.3 m [S11]). Our Gun House
outline is faceted, which is the 5"/62 Mod 4's flat-panel shield (DDG-81 on [S11][S13]); a Flight I wore the rounded
Mod 2. **Model her as a Flight I with a Mod 4 gun house** (the outline can't change: it is the hit prism).

Template layout differences worth knowing (layout is not WP16's to change: moving parts moves baselines):
- Her aft vertical launcher (`vls8` at x −72.4) sits *behind* the helicopter deck at the very stern. On the real ship
  the aft VLS (61 cells on Flight I, 64 on IIA [S11]) is on the deck *forward* of the flight deck, behind the after
  deckhouse. Her forward one (x 62) is right: aft of the gun, ahead of the bridge [S11].
- The real mast is a **raked tripod** (aluminium, the only non-steel topside part [S11]); ours is `mastLattice`. The
  Lattice Mast is shared with the Olivar Perri, whose masts *are* lattice. See §3 for a look that serves both.
- Her hull is 16 m across (X class) against the real 18 m on the waterline and 20 m at the flare [S11][S14]: L/B 9.75
  against 7.7-8.6. "Unusually broad in relation to length" is a defining trait of the real ship [S15]. The loft can't
  change (physics), so the flare must be *suggested*: a strong knuckle/flare line in the bow's shading, a wide deck
  edge at the bow, and fittings that sit out at the deck edge.

**Real proportions:** L 154 m (WL 142 m), B 20 m max / 18 m WL, draught 6.3 m to the keel [K] and 9.4 m to the sonar
dome [S11][S14], ~8,400 t [S11]. Freeboard rises from ~5 m at the flight deck to ~10 m at the stem [est]. Mast top
≈ 0.27 L above the waterline (≈ 42 m) [est].

**Hull:** sharply raked stem; a very wide, flaring bow ("a wide, flaring bow" [S11][S15]); the bow sonar dome (SQS-53)
under the forefoot [S16], not a bulbous bow; marked sheer forward; a hard line where the flare meets the topside
(knuckle-like; **unconfirmed** by any source found: check photos) [K]; a wide flat transom, immersed at its lower edge,
with a stern flap on IIA [S11]; bilge keels; two shafts on struts with five-bladed controllable-pitch propellers [S17]
and two spade rudders. Angled, not vertical, surfaces topside for radar signature [S11].

**Superstructure blocks:** one big forward deckhouse whose walls lean inward (all four SPY-1D faces on its corners:
two facing forward, two facing aft; IIA raised the aft pair one deck [S11]); the pilot house on top with a raked
window band and bridge wings; the forward funnel at its aft end; a waist with boats; the aft funnel; a smaller after
deckhouse carrying the aft CIWS and two of the three SPG-62 illuminators (one forward over the bridge, two aft [S18],
positions from a forum: check photos); then the aft VLS and the flight deck.

**What reads, in order:**
- *At 1.5 km (silhouette and contrast):* (1) the long low hull with the bow rising and flaring; (2) one massive forward
  block with the raked tripod mast on it, (3) two short, boxy funnels with black tops, (4) the low after deckhouse and
  the long empty flight deck aft; (5) the black boot-top line; (6) the gun's barrel as a short spike on the bow.
- *At 200 m:* (1) the four octagonal SPY array faces (flat, slightly darker grey panels, ~3.7 m across [K], set flush
  and tilted back); (2) the bridge window band; (3) the white shadowed hull number on the bow, under the gun;
  (4) the Mk 45 gun house's flat facets and long barrel; (5) the white CIWS dome(s); (6) the mast's yardarms and the
  surface-search antenna; (7) the RHIBs and their davit/crane amidships; (8) the VLS fields as dark grids of hatches;
  (9) Harpoon canisters aft (two quads, athwartships, between the aft funnel and the aft VLS: location from weak
  sources [S19], check photos); (10) the SPG-62 dishes; (11) the stem anchor in its recess [K]; (12) the white draft
  marks; (13) life-raft canister racks on the superstructure sides.
- *At 30 m:* deck-edge stanchions and three wire lifelines; double bollards and fairleads; the anchor chain and
  windlasses on the forecastle; VLS hatch lids (each cell's lid, the central uptake strip); watertight doors with
  dog handles; ladders; louvred vents on the funnels; weld seams on the hull plating (horizontal strakes, vertical
  butts); the jackstaff and ensign staff; the flight deck's nets, tie-down grid and markings; the boot-top's wear; the
  Mk 32 torpedo tubes behind side doors amidships [K]; SRBOC launchers (§3) on the 01 level.

### 2.2 Olivar Perri Frigate → Oliver Hazard Perry class (FFG-7)

**Real proportions:** L 136 m short hull / 138 m long hull (WL 124 m), B 13.7 m, draught 6.7 m (to the dome), 4,100 t
[S20][S21]. L/B ≈ 9.9: long and slim. **Our template is 108 m × 16 m (L/B 6.75): much stubbier.** As with the Arley,
the loft can't change; the eye reads length from the *superstructure's* proportions, so keep her blocks long and low.

**Hull:** flush deck; "more sharply raked stems" than the Knox class [S21]; no bulbous bow, a hull-mounted SQS-56 sonar
[S21]; marked sheer forward; transom stern (raked on the long-hull ships [S21]); **one** big controllable-pitch screw on
the centre line plus two retractable azimuth thrusters (350 hp each) under the hull [S20]. Our template has one
`screwL` and one `rudderL`: right.

**Superstructure:** one long, **slab-sided, boxy** block running about two thirds of her length: the defining look of the
class [K]. The bridge at its front with the Mk 92 Combined Antenna System, an **egg-shaped radome**, on top [S22]; the
main mast behind it, a tall lattice structure carrying the big SPS-49 air-search antenna (an open-mesh rectangle)
[K][S23]; the single funnel amidships, squat with a sloped cap [K]; the STIR illuminator dish on a tall pedestal
[S22][K]; the 76 mm Mk 75 **amidships on top of the superstructure** [S21] (our template puts it on the bow: its comment
says why); twin side-by-side hangars at the after end [S24], the Phalanx on the hangar roof [S22]; the flight deck over
the stern. Mk 13 single-arm launcher on the forecastle [S21] (our `vls8` pair stands in for it).

**What reads:**
- *1.5 km:* (1) the long slab-sided box of a superstructure over a slim hull; (2) the tall mast with the big
  rectangular SPS-49 on top; (3) the egg radome over the bridge; (4) one stubby funnel; (5) the flat-topped hangar and
  open flight deck aft; (6) the near-empty forecastle with a single launcher arm.
- *200 m:* the Mk 13's single arm on its drum [K]; the bridge windows; hull number; the 76 mm's rounded cupola and
  slim barrel; STIR dish; the CIWS dome on the hangar; boats on davits each side amidships [K]; Mk 32 triple tubes in
  recesses in the superstructure sides [K][S25]; SRBOC.
- *30 m:* as the Burke's list (rails, bollards, doors, vents, ladders), plus the hangar doors' horizontal panel lines
  and the RAST track on the flight deck [S21].

### 2.3 Vizby Stealth Corvette → Visby class (K31-K35)

**Real proportions:** L 72.7 m, B 10.4 m, draught 2.4 m, 640-650 t [S10][S26]; L/B ≈ 7. Ours: 72 m × 11 m. **Close.**

**Hull:** carbon-fibre sandwich [S10][S26]; "angular tumblehome" for signature [S26]: flat, faceted planes, every edge
sharp, no rounded bilge above the water, no visible fittings; a raked, sharp bow; two waterjets (KaMeWa 125SII)
exiting the transom [S26]. The hull's flat side planes and the superstructure's planes are at different, constant
angles, with one long crease (the knuckle) where they meet [K].

**Superstructure:** one long faceted block over most of the hull, walls sloping in at a constant angle, the bridge
windows set flush into its sloped front [K]; no conventional mast: the Sea Giraffe AMB 3D radar and the CEROS 200
fire-control director sit on low faceted housings on the roof [S26][K]; helicopter deck aft, no hangar (it was
planned and removed) [S26]; RBS-15 missiles (two quads) and torpedoes behind hatches, not on deck [S26][K]; the
57 mm Mk3 in a faceted stealth cupola on the bow, its **barrel folds into the turret** [S26].

**What reads:**
- *1.5 km:* (1) a low, wedge-like dark-grey shape with almost no protrusions; (2) the one long sloped block; (3) the
  small roof housings; (4) the gun's faceted lump on the bow. Her whole identity is the *absence* of clutter.
- *200 m:* the facet lines (every plane catches the light differently: flat-shaded normals, no smoothing); the flush
  window band; the hull number in small dark low-vis characters [K]; hatch outlines on the hull sides; helideck
  markings; the waterjet nozzles in the transom.
- *30 m:* panel joints of the composite (a faint grid), flush hatches with recessed handles, the fold-down rails
  (stowed: none), drain slots. **No rails, no bollards on show, no rust** (composite does not rust).
- Template note: her `asm2` launchers stand on the bow deck at z ±3.86 and the three radars on the roof. Modelling the
  canisters on her as open launchers breaks her look; if the model can know (e.g. the `stealthHouse` aboard, or her
  `navyDark` skin), a closed-hatch variant would suit. That is a design call for the parent.

### 2.4 Osca Missile Boat → Osa class (Project 205)

**Real proportions:** L 38.6 m, B 7.64 m, draught 1.73 m, 209 t full (Osa I) [S27][S28]; L/B ≈ 5. Ours: 40 m × 7 m.
**Close.**

**Hull:** steel, high freeboard, continuous deck with **rounded, smooth deck edges** (for washing off fallout) [S27];
fine bow with flare; three shafts, three screws [S27] (ours: three screws, two rudders: right).

**Superstructure:** low and wide, light alloy, amidships [S27]: a bridge with small windows; a lattice/tubular mast on
it with the MR-331 search radar on top (a small radome) [S27][K]; the MR-104 "Drum Tilt" gun fire-control radar on a
**high platform aft**, a drum-shaped housing [S27]. Four P-15 missiles in **big box-shaped launchers** on Osa I
(tubes with stiffening rings on Osa II) [S27][S28], two each side abreast the superstructure and aft, angled up and
forward, the after pair raised to fire over the forward pair [K]. Two unmanned AK-230 twin-30 mm turrets, fore and aft
[S27].

**What reads:**
- *1.5 km:* (1) four huge launcher boxes taking up the after two thirds of the deck: nothing else looks like this;
  (2) low hull, low bridge; (3) the mast; (4) small turrets at each end.
- *200 m:* the boxes' hinged end doors and their support frames; the AK-230's squat turret with two barrels close
  together; the drum fire-control radar on its pedestal; the bridge windows; the hull number (Soviet: white, no
  shadow [K]).
- *30 m:* rounded deck edge with a low rail; vents; the boxes' stiffening ribs; ready lockers.
- Template note: hers are `asm2` canisters (twin), at x 3.5, z ±2.2, amidships. The real look needs **boxes**, not
  slim canisters; the `nvAsm` model could draw a box-hangar variant on hulls of class M with the `navySplinter` skin,
  but the shared part must stay a sensible twin launcher for everyone else. Design call for the parent.

### 2.5 Pegazus Hydrofoil → Pegasus class (PHM-1)

**Real proportions:** L 40.5 m (36.0 WL; 44.7 m with the foils retracted), hull beam 8.6 m, **14.5 m over the aft
foils**, draught 7.1 m foils down, 1.9 m retracted, 2.7 m foilborne; 235-241 t [S29]; L/B ≈ 4.7. Ours: 40 m on the M
hull (7 m beam). **Close.**

**Machinery:** one LM2500 gas turbine (foilborne, its own waterjet) and two MTU diesels (hullborne, two waterjets):
**three waterjets** [S29]. Ours: one waterjet and two rudders.

**Hull:** deep-V with chines and spray strakes, a fine bow [K]; the canard bow foil on a single strut that turns to
steer, the main foil aft on two struts spanning past the hull sides, both retracting up out of the water [K][S30].

**Topside:** the 76 mm Mk 75 on the forecastle [K]; a compact deckhouse amidships with the bridge forward, the Mk 92
egg radome on top of it [S29][S31]; chaff launchers just aft of the fire-control radar atop the deckhouse [S31]; a
short mast aft of the radome with a surface-search radar [S29]; two quad Harpoon launchers aft [S29] (on the after deck
[K]; their exact angle is unconfirmed).

**What reads:**
- *1.5 km:* foilborne, the hull flying clear with two thin struts and a white wake from three points; hullborne, a
  small grey boat with a gun forward and a white egg on the bridge.
- *200 m:* the struts and the foil's span (wider than the hull aft); the 76 mm's cupola; the egg radome; the Harpoon
  canisters aft; hull number.
- *30 m:* the foil flaps, the strut pods (waterjet intake), the strut's hinge at the hull; spray strakes; rails.

### 2.6 Cyclon Patrol Boat → Cyclone class (PC-1)

**Real proportions:** L 54.6 m (179 ft), B 7.6 m, draught 2.3 m, 328 t [S32]; L/B ≈ 7.2. **Ours is 32 m × 7 m (L/B 4.6):
a short Cyclone** (SPEC §7 sets 32 m). Model her fittings at real size; don't stretch them to "fill" the shorter hull.

**Hull and topside:** steel hull, aluminium superstructure [S33]; hard-chine planing-type hull with a flared bow [K];
a long low deckhouse with the bridge forward, a tall enclosed (plated) mast on it [K]; Mk 38 25 mm guns fore and aft
(the aft later a Mk 96 25 mm/40 mm grenade mount) [S32]; .50 cal MGs; a stern launch ramp for a RIB on later boats [K].
Haze grey [K] (our stock skin is the white patrol look).

**What reads:** *1.5 km:* low hull, deckhouse forward of amidships, the tall mast. *200 m:* the bridge windows, the
gun mounts, the RIB aft, hull number. *30 m:* rails, MG mounts with ammunition boxes, vents, fenders.

### 2.7 Higgens Landing Craft → LCVP ("Higgins boat")

**Real proportions:** L 11 m (36 ft 3 in), B 3.3 m (10 ft 10 in), draught 0.9 m aft, 0.66 m forward [S34][S35];
L/B 3.3. Ours: 12 m × 3.4 m. **Close.**

**Hull:** plywood skin on timber framing [S35], steel bow **ramp** that is also the frontal armour [S35]; thin armour
plate on the sides aft [S35]; flat bottom, a tunnel aft for the screw, a skeg [K]. Square box shape: vertical sides,
flat sheer.

**Topside:** an open well with a plank floor; the engine compartment aft; the coxswain's station aft; **two .30 cal MGs
in ring mounts / tubs at the aft corners** (moved aft from the LCP(L)'s forward positions) [S35]; towing bitts [K].

**What reads:** *1.5 km:* a grey brick with a squared front. *200 m:* the ramp's hinge line and its ribbed outer face,
the two gun tubs aft, the coxswain. *30 m:* the ramp's cables and winch, plywood plank lines, cleats, the armour plates'
bolt rows, the hull number on the bow sides (wartime: small white numerals [S8]).

### 2.8 Zodiak RIB → a military RIB (Zodiac Milpro Hurricane-type, 9 m)

**Real proportions:** ~9.1 m × 3.0 m, deep-V GRP hull with an inflatable collar [S36]; removable buoyancy tubes [S36].
Ours: 9 m × 3.2 m. **Close.**

**Look [K]:** the grey/black tube collar (tube Ø ≈ 0.5-0.6 m) wrapping the hull to cones at the stern, with a rubbing
strake and lifelines; a console amidships with a small windscreen; jockey (straddle) seats in a row; an A-frame or
radar arch aft carrying the navigation light, antennas and a small radome; two big outboards (black cowls) on the
transom; spray rails on the bottom.

**What reads:** *1.5 km:* a dark speck with a white wake. *200 m:* the tube collar (darker than the hull), the console,
the arch, two outboards. *30 m:* the tube segments' seams and lifeline patches, the seats, the MG on its post with an
ammo can, grab handles.

---

## 3. The 59 ship parts and the real kit they follow

"Ships" = stock templates that carry it. Shape features are the 2-5 things a model must have to read as the real item.

### Hulls (shHull, 16)
| Key | Ours | Real item it follows | Defining shape features |
|---|---|---|---|
| hbBowS / hbMidS / hbSternS | Small hull segments | An aluminium workboat or launch, 8-20 m [K] | Deep-V bottom with 2-3 **spray rails** a side; a hard chine; a **rubbing strake/fender** at the sheer; a flat transom with a slight rake; a low bulwark or toe rail |
| hbBowM / hbMidM / hbSternM | Patrol hull | Cyclone class: steel/alu planing-type patrol hull [S32][S33] | Hard chine running the length; **flared bow** with a knuckle; spray rails forward; deck-edge rail with stanchions; transom with trim tabs; draft marks |
| hbBowL / hbMidL / hbSternL | Corvette hull | Visby / an offshore patrol ship [S26] | Faceted topsides (flat planes, sharp knuckle line), raked stem, recessed anchor pocket, a wide flat transom with jet openings at the keel; on a plain (non-stealth) skin: bilge keels, rails and fairleads |
| hbBowX / hbMidX / hbSternX | Destroyer hull | Arleigh Burke [S11][S15] | **Wide flaring bow** with strong sheer; sonar dome bulge at the forefoot (under water: optional); stem anchor recess + hawse, chain on deck to windlasses; deck-edge stanchions/lifelines; bilge keels, shaft struts; wide transom; hull number and draft marks |
| ribHull | RIB hull | Zodiac Hurricane 9 m [S36] | Tube collar with **cone ends** past the transom, a rubbing strake on the tube, lifeline loops; deep-V GRP bottom with spray rails; a self-draining deck with jockey seats (or the console part's) |
| lcHull | Landing craft hull | LCVP [S34][S35] | Square box, vertical sides; **steel ramp** with external ribs and a hinge at the bottom, winch cables to the top; plywood plank lines; armour plates aft; tunnel stern and skeg |
| pontoon | Float | A seaplane float (EDO-type) [K] | Long faired float with a V bottom and a **step** behind the middle (built: `step`), a flat deck with a hatch, cleats and strut attachment points, a small water rudder aft |
| stepHull | Flying-boat hull | PBY Catalina [K] | Narrow hull with **flared chines**, the step under the wing, a pointed upswept tail, waist blister openings (the old plane parts provide the rest) |

### Superstructure (shSuper, 10)
| Key | Ours | Real item | Defining shape features |
|---|---|---|---|
| bridgeM | Wheelhouse | A patrol boat's wheelhouse (Cyclone, Osa) [K] | **Reverse-raked** window band (windows lean out at the top) with mullions; a sloped front; roof with a nav-light/horn post and a searchlight; doors at the sides; wipers |
| consoleS | Helm Console | A RIB/landing-craft helm [K] | Box console with a small curved **windscreen** and a grab rail round it, a wheel and throttle levers, a seat or leaning post |
| bridgeL | Bridge | A warship bridge (Burke/Perry) [K] | Two-deck block, the pilot house's **raked window band** of 8-12 panes with frames, **bridge wings** (open platforms each side), signal lights and a pelorus on the wings, the roof platform for directors |
| deckhouseL | Deckhouse | A frigate/destroyer deckhouse (Burke's walls lean in [S11]) [K] | Walls **sloped ~10°** inward (Burke) or vertical (Perry); **watertight doors** with dog handles; vertical ladders; louvred vents; **life-raft canister racks** (white/grey capsules); roof-edge rails |
| stealthHouse | Stealth Superstructure | Visby's superstructure [S26] | Constant-angle **faceted planes** (flat-shaded), flush window band in the sloped front, flush hatches, low faceted housings on the roof, no rails or pipes |
| mastLattice | Lattice Mast | Perry's lattice masts; stands in for Burke's raked tripod [S11][K] | Tapered **truss** (4 legs, X-bracing) with 2-3 **platforms** with rails and **yardarms** with whip antennas and lights; a short pole top. For the Arley a raked tripod reads better: if one model must serve both, rake it slightly aft, use 3 heavy legs plus a lattice of yards (it reads as "modern mast" for both at 200 m) |
| mastPole | Pole Mast | A boat's pole mast [K] | Tapered pole, a **crosstree/yard** with nav lights, whip antennas, a radar bracket on top |
| funnel | Funnel | Burke's Flight I stacks; Perry's squat funnel [S11][K] | Box with **raked top**, black cap, **2-3 exhaust uptakes** protruding with rims, louvred intake grilles on the sides, a ladder |
| helipad | Helicopter Deck | A frigate/destroyer flight deck [S21][K] | Dark non-skid deck; **white landing circle and line-up line** (some yellow); RAST/haul-down track; **deck-edge safety nets** folded out; tie-down grid; edge lights. (Fix the 2.3 px/m plan texture: code.md §0.5) |
| hangar | Helicopter Hangar | Perry's twin hangars (Burke IIA's) [S24] | Box with a big **door on the aft face** (horizontal panel lines or a roller door); CIWS platform on the roof; rails; vents; a slight inward slope on stealthy ships |

### Propulsion (shDrive, 12)
| Key | Ours | Real item | Defining shape features |
|---|---|---|---|
| dieselM / dieselS | Marine diesels | MTU 16V-type high-speed diesels [S26][S29] | (Inner: X-ray only.) A V engine block, two **turbochargers** on top, an exhaust manifold, a gearbox at one end |
| turbine | Gas Turbine | GE LM2500 in its module [S20][S29] | (Inner.) A **cylindrical gas generator** with a bellmouth intake, the power turbine and exhaust collector, inside an enclosure box; a reduction gear |
| screwM / screwS | Propellers | Fixed-pitch 3-5 blade screws [K] | Skewed **blades** (5 on warships, 3-4 on boats) with thin trailing edges, a conical **boss**, the shaft and a **shaft bracket (A-strut)** |
| screwL | Large Propeller | Burke's 5-blade CRP screw [S17] | **5 skewed blades** on a large hub (CRP hubs are fat), rope guard, shaft and A-bracket; today all three screws are one 4-blade model, scaled |
| rudderM / rudderL | Rudders | Spade rudders [K] | A deep **spade blade** with a faired section, the stock entering the hull, a slight taper; twins on the Burke |
| outboard | Outboard Motor | A 300 hp V-type outboard [K] | Tall **cowl** (black), the slim mid-section, the **anti-cavitation plate**, the torpedo-shaped gearcase with a skeg, a 3-4 blade prop; the transom clamp bracket |
| waterjet | Waterjet | KaMeWa waterjet [S26] | Round **nozzle** that swings, the **reversing bucket** over it, the duct into the transom, a grilled intake under the hull |
| foilBow | Bow Hydrofoil | PHM's canard foil [K][S30] | An inverted **T**: a thin streamlined strut that turns, a short span foil with a flap, a pivot fairing at the hull |
| foilAft | Main Hydrofoil | PHM's main foil [S29][K] | A wide **span** (14.5 m on the real one, more than the hull's beam) on **two struts**, flaps along the trailing edge, a pod at each strut foot (the waterjet intake) |

### Weapons and sensors (shArms, 15)
| Key | Ours | Real item | Defining shape features |
|---|---|---|---|
| nRingM | Naval Gun Ring | A gun's trainable base / barbette [K] | A short drum with a **flange** and bolt circle, a training gap, a rubber weather seal at its top |
| nHouse127 | Gun House | Mk 45 Mod 4 (flat-panel) [S13]; OTO 76 and Bofors 57 cupolas [S26][K] | **Flat, faceted panels** (the outline already is), a **blast bag** (rubber boot) at the gun port, an access hatch and a few panel lines, a sight/camera box on top. Shared by 57/76/127/152 |
| nGun57 | 57 mm Naval Gun | Bofors 57 mm Mk3 L/70 [S26] | A long, slim barrel with a cooling jacket and a small muzzle; on the Vizby it **folds into the house** when stowed [S26] |
| nGun76 | 76 mm Rapid Gun | OTO Melara 76/62 (Mk 75) [S20][S29] | A slim 62-calibre barrel with a **bore evacuator** bulge partway along and a **slotted muzzle brake** [K] |
| nGun127 | 127 mm Naval Gun | 5"/62 Mk 45 Mod 4 (7.87 m barrel) [S13] | A long **plain**, tapering barrel (no brake), a thickened root, the blast bag at the port [K] |
| nGun152 | 152 mm Naval Gun | A cruiser's 6-inch (no stock ship carries it) [K] | A heavy barrel with a bore evacuator and a reinforced muzzle; a bigger blast bag |
| ciws | Close-In Gun | Phalanx Mk 15 [S37] | **White barrel-shaped radome** on top (search antenna in its upper bulge, the track antenna in its face [S37]); the **six-barrel** M61 cluster with a muzzle clamp; the **ammunition drum** (1,550 rounds [S37]) under the gun; the elevating carriage; a grey pedestal base; Block 1B's **FLIR box** on the side [S37]. 4.7 m tall [S37] |
| asm2 / asm4 | Anti-ship Missiles | Harpoon Mk 141 quads (missile 4.6 m × 0.34 m [S38]); Osa's P-15 boxes [S27]; Visby's RBS-15 [S26] | Cylindrical **canisters with stiffening rings**, frangible end covers, on a lattice **frame** at a fixed elevation; quads as 2 × 2. (Osa: big boxes with end doors) |
| vls8 | Vertical Launcher | Mk 41 8-cell module: 3.43 × 2.62 m, two rows of four, the gas uptake **between the rows** [S39] | A flush deck panel with **8 square cell hatches** in 2 × 4, the **uptake hatch strip** down the middle, a raised rim and gaskets; deck markings |
| torpTube | Torpedo Tubes | Mk 32 SVTT triple mount (1,010 kg; GRP tubes) [S25] | **Three tubes** stacked in a triangle (two below, one above) [K], end caps with breech rings, on a **trainable** pedestal with a cradle |
| nRadarAir | Air Search Radar | SPS-49 (Perry) [S23]; Sea Giraffe (Visby) [S26] | A large **open-mesh rectangular reflector** with a horn feed on a boom, on a turning pedestal (SPS-49); or a flat array in a radome (Sea Giraffe) |
| nRadarFC | Fire-Control Radar | SPG-62 (Burke) [S18]; Mk 92's STIR and CAS [S22]; MR-104 (Osa) [S27]; CEROS 200 (Visby) [S26] | A **dish** on a yoke with a feed and a rear housing (SPG-62/STIR); or an **egg radome** (Mk 92 CAS); or a drum (MR-104). The dish + yoke reads for most |
| nRadarSea | Surface Search Radar | SPS-67/SPS-55, a boat's open array [K] | A long thin **slotted-waveguide bar** (open array) on a small turning gearbox |
| decoy | Decoy Launcher | Mk 36 SRBOC's Mk 137 launcher [S40] | **Six fixed 130 mm tubes in two rows, one row at 45°, one at 60°** [S40], on a base plate; a ready-service locker nearby |

### Ship kit (shKit, 6)
| Key | Ours | Real item | Defining shape features |
|---|---|---|---|
| bulkhead, pump, ballast, dcLocker, magazine | inside the hull | — | X-ray only: keep them simple; a stiffened plate (bulkhead: vertical stiffeners), a pump with its motor and pipes, tanks, lockers |
| torpDecoy | Torpedo Decoy | SLQ-25 Nixie towed decoy [K] | Seen on the stern: a **cable winch drum** with a fairlead/sheave over the transom, the torpedo-shaped towed body in a cradle |

---

## 4. How good games make detailed ships cheap

### What the studios say (numbers)
- **World of Warships:** "the largest ships rarely exceed 300,000 polygons", "standard destroyers need about 120,000";
  the first hull blockout is ~3,000; **four LODs**, each simpler, switched by distance; PBR with albedo, metalness,
  gloss and normal maps plus a baked AO map and a camouflage mask; **normal maps carry rivets, doors, portholes**;
  a per-nation **library of shared fittings** (hoses, portholes, life buoys, searchlights, radars, guns), "up to a
  thousand or more library objects" per ship [S41]. Four LODs made last, shared libraries, and textures for detail
  "too costly to model" (rivets, welds, flanges, grates) [S42]. LODs everywhere, built with Simplygon [S43].
- **War Thunder** (aircraft spec, the closest published budget): LOD0 50-150k tris for fighters, LOD1 15-23k,
  **LOD2 1,500-2,000, LOD3 up to 150**, and "LOD switching has to be smooth" [S44]. Diffuse, normal and specular
  textures plus damaged-state textures [S44].
- **Mobile ship packs:** whole warships at 4-8k tris with one material each, "to keep draw calls minimal" [S45]. A
  three.js rule of thumb: under ~100 draw calls and ~100k vertices in a scene on modest hardware; one InstancedMesh is
  one draw [S46].

### The techniques, and what fits Overbuilt (no build step, three r159, phones)
1. **LOD tiers by screen size, not distance.** Pick by the ship's projected length in pixels, with 10-15 % hysteresis:
   LOD0 > 400 px, LOD1 120-400, LOD2 30-120, LOD3 < 30 (1080 px tall view, 60° fov: focal ≈ 935 px). For the
   156 m Arley that is LOD0 inside ~365 m, LOD1 to ~1.2 km, LOD2 to ~4.9 km; for the 32 m Cyclon, 75 m / 250 m / 1 km.
   The hangar and the builder always draw LOD0. three.js `LOD` exists but switches by distance [S47]; a size-based
   switch per `VesselMesh` is simpler and matches the WoWS/War Thunder practice of smooth, staged drops [S41][S44].
   - LOD0: everything (rails, fittings, glass, spinning radars).
   - LOD1: no rails, no small fittings (< 0.5 m), glass baked into the colour, static meshes merged per material.
   - LOD2: the silhouette: hull, the blocks, mast, funnels, gun house and barrel, boats as boxes (War Thunder's LOD2
     is ~2k tris for an aircraft [S44]; ~3-6k for a destroyer is plenty).
   - LOD3: a few hundred triangles (hull, two blocks, a mast stick), or the existing wreck-bake path's single mesh.
2. **Budgets that beat our standard and fit a phone** (ours today: Arley 15,350 tris in 72 draws, ~100 tris/m; a
   Sugoi-27 36k at ~1,650/m: code.md §0): Arley LOD0 **60-100k tris** (≈400-650/m: big ships are mostly flat, the
   detail goes into fittings), Olivar 50-80k, Vizby 25-40k (her looks are her facets, not clutter), boats 10-25k.
   **Draws: ≤ 20-25 per ship** by merging every static piece of the same material per vessel (the moving bits: guns,
   radars, screws, rudders stay separate). Only the player's ship and one or two others are ever at LOD0 at once.
3. **Instanced or merged fittings.** WoWS builds ships from a library of shared fittings [S41][S42]. In three.js,
   *merge* static fittings into the vessel's per-material mesh (one draw, no per-instance cost); use `InstancedMesh`
   only for things repeated across many vessels or that move (one draw per type [S46]). Good library pieces, each
   10-60 tris: stanchion, double bollard, fairlead, life-raft canister (+ rack), vent mushroom, louvred vent box,
   watertight door, vertical ladder, searchlight, whip antenna, nav light, RHIB on chocks, davit, SRBOC.
4. **Rails: real geometry close, nothing far.** Alpha-tested rail strips vanish with distance as their alpha mips
   thin out (NVIDIA's "hashed alpha testing" names this problem in shipped games [S48]), need careful mip/alpha fixes
   [S49], and alpha testing is expensive on many mobile GPUs [S50]. So: stanchions + 2-3 thin rods (4-6-sided)
   merged, at LOD0 only; beyond, a darker line along the deck edge in the vertex colours keeps the "railed" read.
   No alpha test anywhere in a ship.
5. **Baked AO and dirt in vertex colours** (no extra texture, simple shader: a standard mobile approach [S51][S50]):
   darken by closeness to the deck and to inside corners, at each part's build, once; the hull already uses vertex
   colours (code.md: `shipHullGeo`). Add rust streaks under hawses/scuppers and soot at funnel tops the same way, or as
   a few decals.
6. **Trim sheet / decal atlas instead of unique textures** [S52][S53]: one shared small atlas (e.g. 1024²) of strips:
   door, louvre, hatch, window frames, VLS hatch grid, plating seams, a numeral set (white with shadow, and the
   low-vis greys), draft marks, flight-deck markings, warning stripes. Parts UV their faces onto strips. Hull numbers
   come from the numeral strip (player-chosen digits, no real names). The 45° bevel normal trick of the "Ultimate Trim"
   [S52] only works on 90° edges and costs a normal map: desktop-High at most.
7. **Normal maps: not on phones.** WoWS relies on them [S41], but each one is a texture sample and memory; for us
   geometry + vertex AO + the existing 2D-art textures carry it. An optional tiling plate-seam detail normal (one
   shared texture, world/triplanar UVs) is a desktop-High extra.
8. **Leave out on mobile:** rails and anything thinner than a pixel at LOD1+; wire antennas and rigging; ladders as
   geometry (texture strips instead); shadows from small parts (`rig.small` already); glass as its own material past
   LOD0; turning radars past LOD1 (freeze them); interior detail entirely.
9. **Flat-shade the stealth ships** (Vizby): hard normals per facet are free and are the whole look.

---

## 5. Sources

- [S1] Navy Haze Gray CIELAB: MIL-E-24763A — https://mil-spec.tpub.com/MIL-E/MIL-E-24763A/MIL-E-24763A00010.htm (via search summary)
- [S2] FS 36270 #858A8D — https://hextoral.com/hex-color/858A8D/federal-std-595c/
- [S3] FS 36270 #818789 — https://www.myperfectcolor.com/paint/68152-us-government-fed-std-595c-36270
- [S4] (as S1, CIELAB L\* 56.0 a\* −1.83 b\* −1.37; converted here to sRGB #828788)
- [S5] FS 595 approximate hex table (36270, 26008, 36076, 37038, 30109, 36173, 36440) — https://www.w3schools.com/colors/colors_fs595.asp
- [S6] Non-skid FS 36076 and the 26270/26008 rule — https://members.boardhost.com/Warship/msg/1762524060.html ; https://itwperformancepolymers.com/media/8712/ms-440g-non-skid-specification.pdf
- [S7] USN paint practice (boot-top, low-vis numbers, stacks) — https://man.fas.org/dod-101/sys/ship/weaps/paint.htm
- [S8] Hull number shading — https://forum.finescale.com/t/hull-number-shading-question/177011 ; https://forum.finescale.com/t/navy-hull-numbers/161578 ; https://www.shipcamouflage.com/ships2_6_42_insignia.htm ; https://www.usni.org/magazines/proceedings/1997/november/haze-gray-and-sunk
- [S9] Soviet ship colours by fleet — https://forum.finescale.com/t/the-color-for-soviet-ships/245387
- [S10] Visby (Saab) — https://www.saab.com/products/visby-class-corvette ; https://www.saab.com/globalassets/products/kockums/saab_visby-class_corvette.pdf
- [S11] Arleigh Burke class — https://en.wikipedia.org/wiki/Arleigh_Burke-class_destroyer
- [S12] Burke flights — https://www.seaforces.org/usnships/ddg/Arleigh-Burke-class.htm ; https://www.surfpac.navy.mil/Warships/By-Class/US-Navy-Destroyer-Ship-Class-DDG/
- [S13] Mk 45 gun (Mod 4 flat-panel turret, barrel lengths) — https://en.wikipedia.org/wiki/5-inch/54-caliber_Mark_45_gun
- [S14] DDG-51 fact file — https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2169871/destroyers-ddg/ ; https://www.surflant.usff.navy.mil/Organization/Operational-Forces/Destroyers/USS-Arleigh-Burke-DDG-51/About-Us/Characteristics
- [S15] "Unusually broad in relation to length" — https://armyrecognition.com/military-products/navy/destroyers-cruisers/arleigh-burke-class
- [S16] SQS-53 bow dome — https://man.fas.org/dod-101/sys/ship/weaps/an-sqs-53.htm
- [S17] Burke Flight I (5-blade CRP screws, steel hull, aluminium funnels) — https://destroyerhistory.org/arleighburkeclass/flighti
- [S18] SPG-62 (three on a Burke) — https://en.wikipedia.org/wiki/AN/SPG-62 ; positions: https://forum.warthunder.com/t/arleigh-burke-class-guided-missile-destroyers-marvelous-shield-of-the-fleet/326394
- [S19] Harpoon/NSM aft on Flight I — https://www.twz.com/sea/navy-destroyer-modified-with-naval-strike-missiles-sailing-in-rimpac-wargames ; https://naval-encyclopedia.com/cold-war/us/arleigh-burke-class-destroyer.php
- [S20] Oliver Hazard Perry class — https://en.wikipedia.org/wiki/Oliver_Hazard_Perry-class_frigate
- [S21] Perry design (raked stems, SQS-56, 76 mm amidships, Mk 13 forward, raked transom, RAST) — https://destroyerhistory.org/coldwar/oliverhazardperryclass/
- [S22] Mk 92 CAS egg radome atop the bridge, STIR, Phalanx atop the hangar — https://magazines.marinelink.com/Magazines/MaritimeReporter/19831015/page/40 ; https://forum.warthunder.com/t/oliver-hazard-perry-class-guided-missile-frigates-the-workhorse-of-cold-war-anti-submarine-warfare/333951
- [S23] SPS-49 on the Perrys — https://man.fas.org/dod-101/sys/ship/ffg-7.htm
- [S24] Perry: two hangars — https://www.naval-technology.com/projects/oliver-hazard/
- [S25] Mk 32 SVTT — https://en.wikipedia.org/wiki/Mark_32_Surface_Vessel_Torpedo_Tubes
- [S26] Visby class — https://en.wikipedia.org/wiki/Visby-class_corvette ; https://www.seaforces.org/marint/Swedish-Navy/Corvette/Visby-class.htm
- [S27] Osa class — https://en.wikipedia.org/wiki/Osa-class_missile_boat
- [S28] Osa specs — https://www.kchf.ru/eng/ship/warfarecorvettes/r370.htm ; https://naval-encyclopedia.com/cold-war/ussr/osa-project-205-class-fac.php
- [S29] Pegasus class (dimensions, three waterjets, sensors) — https://www.navypedia.org/ships/usa/us_cf_pegasus.htm
- [S30] Pegasus class — https://en.wikipedia.org/wiki/Pegasus-class_hydrofoil ; https://foils.org/7101-2/the-u-s-navy-pegasus-class-hydrofoil
- [S31] PHM deckhouse kit (chaff aft of the FC radar atop the deckhouse) — https://forum.warthunder.com/t/pegasus-class-hydrofoils-phm-us-navys-ultimate-combat-hydrofoil/327670
- [S32] Cyclone class — https://en.wikipedia.org/wiki/Cyclone-class_patrol_ship ; https://www.globalsecurity.org/military/systems/ship/pc-1.htm ; https://www.surflant.usff.navy.mil/Organization/Operational-Forces/Patrol-Coastal-Ships/USS-Tempest-PC-2/About-Us
- [S33] USS Cyclone (steel hull, aluminium superstructure) — https://en.wikipedia.org/wiki/USS_Cyclone
- [S34] LCVP — https://en.wikipedia.org/wiki/LCVP_(United_States)
- [S35] LCVP construction, ramp, guns aft — https://www.historyofwar.org/articles/weapons_landing_craft_vehicle_personnel.html ; https://naval-encyclopedia.com/ww2/us/LCVP-Higgins-Boats.php
- [S36] Zodiac Hurricane RIBs — https://zodiacmilpro.com/zodiac-hurricane/ ; https://pdf.nauticexpo.com/pdf/zodiac-milpro-international/h933-sar/25507-40311.html
- [S37] Phalanx CIWS — https://en.wikipedia.org/wiki/Phalanx_CIWS
- [S38] Harpoon — https://en.wikipedia.org/wiki/Harpoon_(missile)
- [S39] Mk 41 VLS — https://en.wikipedia.org/wiki/Mark_41_Vertical_Launching_System
- [S40] Mk 36 SRBOC / Mk 137 — https://en.wikipedia.org/wiki/Mark_36_SRBOC
- [S41] How WoWS ships are made (polygons, LODs, maps, library) — https://www.techinsider.ru/technologies/332102-narisovannyy-flot-kak-delaetsya-igra-world-of-warships/
- [S42] Wargaming's 3D modelling workflow — https://80.lv/articles/wargamings-3d-modeling-workflow
- [S43] The tech behind WoWS — https://80.lv/articles/the-tech-behind-world-of-warships
- [S44] War Thunder CDK model specs — https://wiki.warthunder.com/cdk/232-3d-models-for-aircraft ; https://wiki.warthunder.com/cdk/249-creating-a-3d-tank-model
- [S45] Mobile warship packs — https://assetstore-fallback.unity.com/packages/3d/vehicles/sea/modern-warships-10152 ; https://forums.unrealengine.com/t/visartisan-ultra-low-poly-sci-fi-war-ship-fleet-mobile-ready-pack-20-models/2631236
- [S46] three.js draw calls and instancing — https://discourse.threejs.org/t/bad-performance-when-loading-more-than-3500-meshes-into-the-scene/63960/4 ; https://jvinhit.github.io/blog/threejs-08-performance-and-instancing/
- [S47] three.js LOD — https://threejs.org/docs/#api/en/objects/LOD
- [S48] Hashed alpha testing (alpha-tested geometry vanishing at range) — https://research.nvidia.com/publication/2017-02_hashed-alpha-testing
- [S49] Mipmapping alpha-tested textures — https://lisyarus.github.io/blog/posts/exploring-ways-to-mipmap-alpha-tested-textures.html
- [S50] Unity mobile rendering optimisations (alpha testing costly on mobile GPUs; bake lighting) — https://docs.unity3d.com/2018.4/Documentation/Manual/MobileOptimizationPracticalRenderingOptimizations.html
- [S51] AO baked into vertex colours for low-end/mobile — https://docs.unity3d.com/Packages/com.unity.industry.toolkit@3.2/manual/Actions/Autogenerated/BakeAmbientOcclusion.html
- [S52] The Ultimate Trim (Insomniac, GDC 2015) — https://gdcvault.com/play/1022323/The-Ultimate-Trim-Texturing-Techniques ; https://www.blog.radiator.debacle.us/2017/07/bevels-in-video-games.html
- [S53] Trim sheets explained — https://medium.com/@legacykraft/trim-sheet-detailed-breakdown-bd35c78d16c3 ; https://create.roblox.com/docs/tutorials/curriculums/environmental-art/develop-polished-assets
