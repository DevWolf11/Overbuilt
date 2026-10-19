# Rocket Science Simulator

A rocket-building and spaceflight game inspired by *Spaceflight Simulator*, played in 2D or 3D. Snap parts together on a blueprint, launch from the pad, fly into orbit, and explore a small solar system: land on the Moon, drive a rover, parachute onto Mars, dive past the Sun, and bring the crew home through a fiery reentry. You can also build planes that take off from the runway, cars that drive to the mainland, and helicopters.

It runs in any modern browser on desktop and mobile. There is no build step: open `index.html` and play. The 3D view uses three.js, which ships in the repo and only loads when you switch to 3D.

## Play

- **Online:** https://devwolf11.github.io/Rocket-Science-Simulator/ (deployed from `main` by `.github/workflows/pages.yml`). On a phone, use "Add to Home Screen" to install it and play offline.
- **Locally:** double-click `index.html`, or serve the folder (`npx serve .`) to also get the offline/installable PWA.
- **Single file:** `node tools/build-single.mjs` writes `dist/rocket-science-simulator.html`, the whole game in one HTML file you can send to someone.

## Modes

- **Career:** start with $50,000 and basic parts. Every launch costs the price of its parts; recovering a craft on Earth refunds 90%. Complete 39 missions (first hop, orbit, flybys, orbits, landings and returns for every body, a Sun dive, interstellar escape, plus a first takeoff, a runway landing, the sound barrier, a hover and a road trip) to earn funds, and spend them in R&D to unlock five tiers of technology.
- **Sandbox:** every part unlocked and no money involved.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Rotate (drive a car, pitch a plane) | `A` / `D` or `←` / `→` | Hold the ⟲ ⟳ buttons |
| Brake on wheels | Hold `B` | Hold Brake |
| Throttle | `W` / `S` or `Shift` / `Ctrl`; `Z` full, `X` cut | Drag the throttle bar; Max / Cut |
| Next stage | `Space` | STAGE button |
| Autopilot | `1` hold · `2` prograde · `3` retrograde · `4` radial out · `5` radial in · `6` target | Autopilot buttons above the rotate controls |
| Use one part | Click it | Tap it (engines toggle, separators fire, parachutes open) |
| Map view | `M`; click a planet to target it | Map button; tap a planet |
| Switch vessel | `[` / `]`, or click it | Tap it in flight or on the map |
| Time warp | `,` / `.` (click the readout to reset) | ⏪ ⏩ buttons |
| Zoom | Mouse wheel | Pinch |
| 2D / 3D view | `V` | 3D button |
| 3D camera | Drag to look around; `C` or double-click resets it | Drag |
| Pause, save & exit | `Esc` | Menu button |

Builder: pick Rocket, Plane, Car or Helicopter above the stats, drag parts from the tray onto the blueprint (tap a tray part to auto-stack it), drag a part back onto the tray to remove it, `Ctrl+Z` / `Ctrl+Y` to undo and redo, `Ctrl+D` to duplicate, `F` to fit the view, `Enter` to launch. In 3D the blueprint becomes a turntable preview: drag to look around, tap a part to select it. The Hangar saves and loads your own named designs and has eleven examples: seven rockets, the Skylark trainer and Hornet jet, the Dune Buggy and the Dragonfly helicopter.

## What's in it

- **3D view:** a button switches between the classic 2D side view and a full 3D view of the same world: textured planets seen from space, terrain with oceans, beaches, trees and clouds near the ground, the space centre with its runway, helipad and causeway, shadows, engine plumes and smoke. The physics stays the same 2D simulation, so saves, orbits and controls work identically in both views.
- **Vehicles:** rockets launch from the pad, planes take off from the runway, cars drive from it (a causeway road leads 13 km east to the mainland), and helicopters lift off from the helipad. Wings make lift from the airflow and stall at high angles, elevators steer, propellers and jets need air, rotors give lift and steering, car wheels drive, landing gear rolls freely and everything brakes. Aircraft hold their attitude when you let go.
- **56 parts** in nine categories: crew pods and probe cores; tanks in 1, 2 and 3 m widths; nine rocket engines including solid boosters that can't be shut down, an aerospike that keeps its efficiency at every altitude, a nuclear engine and an ion drive; separators; nose cones, fins and heat shields; parachutes, landing legs, rover wheels and RCS; girders and adapters; aircraft parts (cockpit, fuselage, tail cone, wings, elevator, tail fin, propeller, turbojet, main and tail rotors, landing gear); ground parts (driver cab, chassis, car wheels).
- **Builder:** edge snapping, symmetry, automatic staging with per-stage Δv and TWR, centre-of-mass and thrust markers, cost and tech-tier locks in career, undo/redo, named saves.
- **Physics:** rigid bodies with centre of mass and inertia, gimbal and reaction wheels, pressure-dependent Isp, drag and fin stability, reentry heating that burns away the leading part unless a heat shield takes it, parachutes limited by dynamic pressure (drogue first, main canopy near the ground), oceans you can splash down in, rover driving with self-levelling, and per-corner ground contact where hard landings break parts.
- **Solar system:** the Sun, Mercury, Venus, Earth and the Moon, Mars and Phobos, Jupiter and Europa, each with its own gravity, terrain, colours, and atmosphere where it has one. Patched conics with spheres of influence; time warp up to 1,000,000× runs craft on exact Kepler orbits and stops automatically at atmospheres and sphere changes.
- **Navigation:** the map predicts up to four patches ahead, showing apoapsis and periapsis, encounters (with the periapsis you'll get), escapes and impacts. Tap a planet to target it and see the closest approach and when the next transfer window opens. Autopilot modes hold prograde, retrograde, radial or target, and prograde/retrograde markers sit around the craft. A Δv map covers every destination.
- **Graphics:** day and night as Earth circles the Sun, sunsets and sun glare, stars and a faint Milky Way, oceans and beaches, clouds, trees, rocks, a launch site with a tower and buildings, shaded planets with atmospheres, Mars' ice caps and Jupiter's bands, engine plumes per propellant with shock diamonds, smoke, dust kicked off the ground, reentry plasma, heat glow on parts, explosions with flashes and shockwaves.
- **Saving:** designs and flights save automatically (also when a phone backgrounds the page). Resume a flight from the home screen.
- **Settings:** volume, graphics quality (also shadows and scenery in 3D), 3D view, flight hints, markers, fullscreen, career reset.

## Scale

Like Spaceflight Simulator, the solar system is shrunk. Earth has a 315 km radius, real surface gravity (9.8 m/s²) and a 30 km atmosphere; low orbit takes about 2.7 km/s of Δv. The Moon orbits 6,200 km out. Earth circles the Sun at 200,000 km in about 6.5 days, so a trip to Mars takes about four and a half days of game time, a few seconds at full warp.

## Project layout

```
index.html            page shell, home screen and HUD markup
css/style.css         all styling (HUD, builder, home, responsive rules)
js/util.js            maths, formatting, storage helpers
js/space.js           bodies, terrain, Kepler orbits, patched-conic prediction, transfer windows, Δv chart
js/parts.js           part catalogue, tech tiers, attachment rules, staging, Δv, part drawing
js/vessel.js          rigid-body vessel: engines, wings, aero, heating, autopilot, wheels, ground and water contact, splitting
js/world.js           2D flight view: sky and lighting, planets, scenery, the airfield, plumes, particles, markers
js/render3d.js        3D view (three.js, loaded on demand): sky, planets, terrain, space centre, particles, hangar turntable
js/parts3d.js         3D part meshes, plumes and parachutes, kept in sync with the simulation
js/vendor/three.min.js three.js r159 (MIT licence in js/vendor/three.LICENSE)
js/map.js             map view: orbits, trajectories, targets, vessels
js/career.js          career and sandbox modes, funds, missions
js/builder.js         build screen, vehicle kinds, hangar and example vehicles
js/flight.js          flight loop, time warp, HUD, controls, saving, missions
js/ui.js, audio.js    dialogs, toasts, icons and procedural sound
js/main.js            app shell, home screen, menus and the main loop
sw.js, manifest.webmanifest, icons/   offline support and install icons
tools/build-single.mjs bundles everything into dist/rocket-science-simulator.html
.github/workflows/pages.yml  publishes the game to GitHub Pages on every push to main
```

Scripts are plain (non-module) JavaScript so the game also works when opened straight from disk.

This repository used to hold Cam-Strike, a 5v5 FPS. Its full history is still in git: the last version is commit `30e7bc8`.

## Ideas for later

Docking and space stations, payload fairings, solar panels and batteries for ion engines, editable staging, boats, part rotation in the builder, building directly in 3D, more moons around Jupiter, and planet rotation.
