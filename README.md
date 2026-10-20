# Rocket Science Simulator

A rocket-building and spaceflight game inspired by *Spaceflight Simulator*. Snap parts together on a 2D blueprint, then fly in a full 3D world: launch from the pad, reach orbit, and explore a small solar system: land on the Moon, drive a rover, parachute onto Mars, dive past the Sun, and bring the crew home through a fiery reentry. Earth is the real one, shrunk to 1/20 scale, and the space centre sits on an island in the Gulf of Guinea. You can also build planes that bank and turn over the island and break the sound barrier, cars that drive across the causeway to the coast of Gabon, and helicopters.

It runs in any modern browser on desktop and mobile. There is no build step: open `index.html` and play. The 3D world uses three.js, which ships in the repo; on a device without WebGL the game falls back to a flat 2D side view.

## Play

- **Online:** https://devwolf11.github.io/Rocket-Science-Simulator/ (deployed from `main` by `.github/workflows/pages.yml`). On a phone, use "Add to Home Screen" to install it and play offline.
- **Locally:** serve the folder (`npx serve .`), which also gives you the offline/installable PWA. Double-clicking `index.html` works too, but browsers don't let a page opened from disk read the Earth map, so Earth falls back to generated terrain.
- **Single file:** `node tools/build-single.mjs` writes `dist/rocket-science-simulator.html`, the whole game in one HTML file you can send to someone.

## Modes

- **Career:** start with $50,000 and basic parts. Every launch costs the price of its parts; recovering a craft on Earth refunds 90%. Complete 41 missions (first hop, orbit, flybys, orbits, landings and returns for every body, a Sun dive, interstellar escape, plus a first takeoff, a runway landing, the sound barrier, Mach 2, a seaplane round trip, a hover and a road trip) to earn funds, and spend them in R&D to unlock five tiers of technology.
- **Sandbox:** every part unlocked and no money involved.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Pitch (cars: drive forward / back) | `W` / `S` or `↑` / `↓`; `W` is nose down | Push the stick forward / back |
| Rockets: turn · planes and helicopters: roll · cars: steer | `A` / `D` or `←` / `→` | Push the stick left / right |
| Rockets: roll · planes and helicopters: yaw | `Q` / `E` | Hold the ⟲ ⟳ buttons |
| Brake on wheels, air brakes | Hold `B` | Hold Brake |
| Throttle | `Shift` / `Ctrl`; `Z` full, `X` cut | Drag the throttle bar; Max / Cut |
| Next stage | `Space` | STAGE button |
| Autopilot | `1` hold · `2` prograde · `3` retrograde · `4` radial out · `5` radial in · `6` target | Autopilot buttons above the rotate controls |
| Plane autopilot | `1` hold attitude · `2` level (holds altitude-ish) · `3` heading (`A` / `D` turn it) · `4` off | Autopilot buttons |
| Flaps · landing gear | `F` cycles flaps up / takeoff / landing · `G` raises or lowers retractable gear | Flaps and Gear pills |
| Use one part | Click it | Tap it (engines toggle, separators fire, parachutes open) |
| Map view | `M`; click a planet to target it | Map button; tap a planet |
| Switch vessel | `[` / `]`, or click it | Tap it in flight or on the map |
| Time warp | `,` / `.` (click the readout to reset) | ⏪ ⏩ buttons |
| Zoom | Mouse wheel | Pinch |
| Camera | Drag to look around; `C` or double-click resets it | Drag |
| Pause, save & exit | `Esc` | Menu button |

Builder: pick Rocket, Plane, Car or Helicopter above the stats, drag parts from the tray onto the blueprint (tap a tray part to auto-stack it), drag a part back onto the tray to remove it, `R` (or the turn button) to rotate the selected part, or the one you are dragging, a quarter turn, `Ctrl+Z` / `Ctrl+Y` to undo and redo, `Ctrl+D` to duplicate, `F` to fit the view, `Enter` to launch. The 3D button (`V`) turns the blueprint into a turntable preview: drag to look around, tap a part to select it. The Hangar saves and loads your own named designs and has seventeen examples: seven rockets, eight planes (the Skylark trainer, Bushhopper STOL, Barnstormer biplane, Hornet and Viper jets, Jumbo airliner, Albatross glider and Seagull seaplane), the Dune Buggy and the Dragonfly helicopter. In Plane mode a blue marker shows the centre of lift, and the stats warn about tail-heavy designs, badly placed gear, missing fins and weak engines.

## What's in it

- **The real Earth:** continents, coastlines, mountains and colours from Natural Earth and NASA's Blue Marble, on the 3D globe, the ground you fly over and the map. The space centre has an island of its own in the Gulf of Guinea, at 7°E on the equator, with a lighthouse, wind turbines, a tank farm and a seaplane pier; the causeway runs 13 km east to a port town on the coast of Gabon. Villages dot the land and fishing boats and freighters the sea.
- **A 3D world:** craft move and turn in all three dimensions: orbits can be inclined, planes bank and turn anywhere over the island, cars drive off across the countryside. You see textured planets from space, terrain with oceans, beaches, trees and clouds near the ground, the space centre with its runway, helipad and causeway, shadows, engine plumes and smoke. The camera follows behind planes, cars and helicopters and beside rockets. Building stays on a 2D blueprint.
- **Vehicles:** rockets launch from the pad, planes take off from the runway, cars drive from it (a causeway road leads 13 km east to the mainland), and helicopters lift off from the helipad. Wings make lift from the airflow and stall at high angles; ailerons roll, elevators pitch and the tail fin's rudder yaws and keeps a plane pointing into the wind, so banked turns are coordinated. Propellers and jets need air, rotors give lift and the stick tilts a helicopter (it levels itself when you let go), car wheels drive and the front ones steer, landing gear rolls freely and everything brakes. Planes hold their pitch and bank when you let go, or the autopilot can level them out or hold a heading.
- **The sound barrier:** past Mach 1 in thick air a vapour cone wraps the craft, a shock ring bursts outwards and a sonic boom cracks; the HUD shows the Mach number.
- **98 parts** in twelve categories: crew pods and probe cores; tanks in 1, 2 and 3 m widths; nine rocket engines including solid boosters that can't be shut down, an aerospike that keeps its efficiency at every altitude, a nuclear engine and an ion drive; separators; nose cones, fins and heat shields; parachutes, landing legs, rover wheels and RCS; girders and adapters; ground parts (driver cab, chassis, car wheels); and 54 aircraft parts:
  - **Fuselage:** four cockpits (bush, standard, fighter nose, airliner nose), a radome, five fuselage sections, an adapter and four tail cones.
  - **Wings:** short, standard and long wings (with flaps and fuel), swept, delta and glider wings, stabilisers, two elevators, a canard, four tail fins including a twin-tail pair, and air brakes.
  - **Aero engines:** small, standard and four-blade propellers, a turboprop, a pusher prop, twin wing-mounted props, small and standard turbojets, an afterburning jet, jet pods, a turbofan, fan pods, a ramjet that only lights at speed, JATO bottles and helicopter rotors.
  - **Gear:** small, standard and heavy gear, retractable gear, a tail wheel, floats, drop tanks and a brake chute.
- **Flight model:** wings and tail fins mount straight through the fuselage, and pods, floats and drop tanks hang off them in mirrored pairs (engine pods fixed to the fuselage instead get pylons). Each wing gets its own lift slope from its aspect ratio and sweep, induced drag, a stall angle, dihedral that rolls you level, ground effect and transonic wave drag; flaps add lift and drag, control surfaces stiffen at high speed, and pulling too many g tears wings and tails off. Jets gain thrust with ram air and afterburners kick in above 90% throttle, turbofans lose thrust as they speed up, single props twist the plane, props break if they strike the ground, retracted gear stops dragging and seaplanes take off from the bay.
- **Builder:** edge snapping, quarter-turn part rotation, symmetry (mirrored parts turn the other way), automatic staging with per-stage Δv and TWR, centre-of-mass and thrust markers, cost and tech-tier locks in career, undo/redo, named saves.
- **Physics:** 3D rigid bodies with a full inertia tensor and quaternion attitude, gimbal and reaction wheels, pressure-dependent Isp, drag and fin stability, wings simulated in halves so rolling damps itself, reentry heating that burns away the leading part unless a heat shield takes it, parachutes limited by dynamic pressure (drogue first, main canopy near the ground), oceans you can splash down in, rover driving with steering, self-levelling and a hand back onto the wheels if it tips over, and per-corner ground contact on the 3D terrain where hard landings break parts. A rocket's legs and fins stand in fours around the stack.
- **Solar system:** the Sun, Mercury, Venus, Earth and the Moon, Mars and Phobos, Jupiter and Europa, each with its own gravity, terrain, colours, and atmosphere where it has one. Patched conics with spheres of influence; time warp up to 1,000,000× runs craft on exact Kepler orbits and stops automatically at atmospheres and sphere changes.
- **Navigation:** the map predicts up to four patches ahead, showing apoapsis and periapsis, encounters (with the periapsis you'll get), escapes and impacts. Tap a planet to target it and see the closest approach and when the next transfer window opens. Autopilot modes hold prograde, retrograde, radial or target, and prograde/retrograde markers sit around the craft. A Δv map covers every destination.
- **Graphics:** day and night as Earth circles the Sun, sunsets and sun glare, stars and a faint Milky Way, oceans with surf and beaches, clouds, trees, rocks, villages with lit windows at night, a launch site with a tower and buildings, shaded planets with atmospheres, Mars' ice caps and Jupiter's bands, engine plumes per propellant with shock diamonds, smoke, dust kicked off the ground, reentry plasma, heat glow on parts, explosions with flashes and shockwaves.
- **Saving:** designs and flights save automatically (also when a phone backgrounds the page). Resume a flight from the home screen.
- **Settings:** volume, graphics quality (shadows, scenery, effects), flight hints, markers, fullscreen, career reset. The 3D view lowers its resolution on its own when frames run long and raises it again when there is time to spare.

## Scale

Like Spaceflight Simulator, the solar system is shrunk. Earth has a 315 km radius, real surface gravity (9.8 m/s²) and a 30 km atmosphere; low orbit takes about 2.7 km/s of Δv. The Moon orbits 6,200 km out. Earth circles the Sun at 200,000 km in about 6.5 days, so a trip to Mars takes about four and a half days of game time, a few seconds at full warp.

## Project layout

```
index.html            page shell, home screen and HUD markup
css/style.css         all styling (HUD, builder, home, responsive rules)
js/util.js            maths, formatting, storage helpers
js/space.js           bodies, the 2D terrain profile, Kepler orbits (in any plane), patched-conic prediction, transfer windows, Δv chart
js/terrain.js         the 3D ground (the real Earth map, or the profile grown into 3D), shared by the physics (cached heights and normals) and the renderer
js/parts.js           part catalogue, tech tiers, attachment rules, staging, Δv, part drawing
js/vessel.js          3D rigid-body vessel: engines, wings and control surfaces, aero, heating, autopilot, wheels, ground and water contact, splitting
js/world.js           particles, 3D markers, and the 2D fallback flight view (sky, planets, scenery, plumes)
js/render3d.js        the 3D flight view (three.js): sky, planets, terrain, space centre, particles, vapour cone, hangar turntable
js/parts3d.js         3D part meshes, plumes and parachutes, kept in sync with the simulation
js/vendor/three.min.js three.js r159 (MIT licence in js/vendor/three.LICENSE)
js/map.js             map view: orbits, trajectories, targets, vessels
js/career.js          career and sandbox modes, funds, missions
js/builder.js         build screen, vehicle kinds, hangar and example vehicles
js/flight.js          flight loop, time warp, HUD, controls, saving, missions
js/ui.js, audio.js    dialogs, toasts, icons and procedural sound
js/main.js            app shell, home screen, menus and the main loop
sw.js, manifest.webmanifest, icons/   offline support and install icons
assets/earth-*.png/jpg the real Earth's heights and colours, baked by tools/bake-earth.py
tools/build-single.mjs bundles everything into dist/rocket-science-simulator.html
.github/workflows/pages.yml  publishes the game to GitHub Pages on every push to main
```

Scripts are plain (non-module) JavaScript so the game also works when opened straight from disk.

The Earth map is baked from public-domain data: [Natural Earth](https://www.naturalearthdata.com/) 1:50m land for the coastlines, NASA's land elevation and Blue Marble imagery for relief and colour. `python3 tools/bake-earth.py <folder>` rebuilds `assets/` from them; the script lists where to get each file.

This repository used to hold Cam-Strike, a 5v5 FPS. Its full history is still in git: the last version is commit `30e7bc8`.

## Ideas for later

Docking and space stations, payload fairings, solar panels and batteries for ion engines, editable staging, boats, building directly in 3D, more moons around Jupiter, and planet rotation.
