# Rocket Science Simulator

A 2D rocket-building and spaceflight game inspired by *Spaceflight Simulator*. Snap parts together on a blueprint, launch from the pad, fly into orbit, and explore a small solar system: land on the Moon, drive a rover, parachute onto Mars, dive past the Sun, and bring the crew home through a fiery reentry.

It runs in any modern browser on desktop and mobile. There is no build step and no dependencies: open `index.html` and play.

## Play

- **Online:** https://devwolf11.github.io/Rocket-Science-Simulator/ (deployed from `main` by `.github/workflows/pages.yml`). On a phone, use "Add to Home Screen" to install it and play offline.
- **Locally:** double-click `index.html`, or serve the folder (`npx serve .`) to also get the offline/installable PWA.
- **Single file:** `node tools/build-single.mjs` writes `dist/rocket-science-simulator.html`, the whole game in one HTML file you can send to someone.

## Modes

- **Career:** start with $50,000 and basic parts. Every launch costs the price of its parts; recovering a craft on Earth refunds 90%. Complete 33 missions (first hop, orbit, flybys, orbits, landings and returns for every body, a Sun dive, interstellar escape) to earn funds, and spend them in R&D to unlock five tiers of technology.
- **Sandbox:** every part unlocked and no money involved.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Rotate (drive on wheels) | `A` / `D` or `←` / `→` | Hold the ⟲ ⟳ buttons |
| Throttle | `W` / `S` or `Shift` / `Ctrl`; `Z` full, `X` cut | Drag the throttle bar; Max / Cut |
| Next stage | `Space` | STAGE button |
| Autopilot | `1` hold · `2` prograde · `3` retrograde · `4` radial out · `5` radial in · `6` target | Autopilot buttons above the rotate controls |
| Use one part | Click it | Tap it (engines toggle, separators fire, parachutes open) |
| Map view | `M`; click a planet to target it | Map button; tap a planet |
| Switch vessel | `[` / `]`, or click it | Tap it in flight or on the map |
| Time warp | `,` / `.` (click the readout to reset) | ⏪ ⏩ buttons |
| Zoom | Mouse wheel | Pinch |
| Pause, save & exit | `Esc` | Menu button |

Builder: drag parts from the tray onto the blueprint (tap a tray part to auto-stack it), drag a part back onto the tray to remove it, `Ctrl+Z` / `Ctrl+Y` to undo and redo, `Ctrl+D` to duplicate, `F` to fit the view, `Enter` to launch. The Hangar saves and loads your own named rockets and has seven example rockets.

## What's in it

- **40 parts** in seven categories: crew pods and probe cores; tanks in 1, 2 and 3 m widths; nine engines including solid boosters that can't be shut down, an aerospike that keeps its efficiency at every altitude, a nuclear engine and an ion drive; separators; nose cones, fins and heat shields; parachutes, landing legs, rover wheels and RCS; girders and adapters.
- **Builder:** edge snapping, symmetry, automatic staging with per-stage Δv and TWR, centre-of-mass and thrust markers, cost and tech-tier locks in career, undo/redo, named saves.
- **Physics:** rigid bodies with centre of mass and inertia, gimbal and reaction wheels, pressure-dependent Isp, drag and fin stability, reentry heating that burns away the leading part unless a heat shield takes it, parachutes limited by dynamic pressure (drogue first, main canopy near the ground), oceans you can splash down in, rover driving with self-levelling, and per-corner ground contact where hard landings break parts.
- **Solar system:** the Sun, Mercury, Venus, Earth and the Moon, Mars and Phobos, Jupiter and Europa, each with its own gravity, terrain, colours, and atmosphere where it has one. Patched conics with spheres of influence; time warp up to 1,000,000× runs craft on exact Kepler orbits and stops automatically at atmospheres and sphere changes.
- **Navigation:** the map predicts up to four patches ahead, showing apoapsis and periapsis, encounters (with the periapsis you'll get), escapes and impacts. Tap a planet to target it and see the closest approach and when the next transfer window opens. Autopilot modes hold prograde, retrograde, radial or target, and prograde/retrograde markers sit around the craft. A Δv map covers every destination.
- **Graphics:** day and night as Earth circles the Sun, sunsets and sun glare, stars and a faint Milky Way, oceans and beaches, clouds, trees, rocks, a launch site with a tower and buildings, shaded planets with atmospheres, Mars' ice caps and Jupiter's bands, engine plumes per propellant with shock diamonds, smoke, dust kicked off the ground, reentry plasma, heat glow on parts, explosions with flashes and shockwaves.
- **Saving:** designs and flights save automatically (also when a phone backgrounds the page). Resume a flight from the home screen.
- **Settings:** volume, graphics quality, flight hints, markers, fullscreen, career reset.

## Scale

Like Spaceflight Simulator, the solar system is shrunk. Earth has a 315 km radius, real surface gravity (9.8 m/s²) and a 30 km atmosphere; low orbit takes about 2.7 km/s of Δv. The Moon orbits 6,200 km out. Earth circles the Sun at 200,000 km in about 6.5 days, so a trip to Mars takes about four and a half days of game time, a few seconds at full warp.

## Project layout

```
index.html            page shell, home screen and HUD markup
css/style.css         all styling (HUD, builder, home, responsive rules)
js/util.js            maths, formatting, storage helpers
js/space.js           bodies, terrain, Kepler orbits, patched-conic prediction, transfer windows, Δv chart
js/parts.js           part catalogue, tech tiers, attachment rules, staging, Δv, part drawing
js/vessel.js          rigid-body vessel: engines, aero, heating, autopilot, ground and water contact, splitting
js/world.js           flight-view rendering: sky and lighting, planets, scenery, plumes, particles, markers
js/map.js             map view: orbits, trajectories, targets, vessels
js/career.js          career and sandbox modes, funds, missions
js/builder.js         build screen, hangar and example rockets
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

Docking and space stations, payload fairings, solar panels and batteries for ion engines, editable staging, more moons around Jupiter, and planet rotation.
