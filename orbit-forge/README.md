# Orbit Forge

A 2D rocket-building and spaceflight game inspired by *Spaceflight Simulator*. Snap parts together on a blueprint, launch from the pad, fly a gravity turn into orbit, transfer to the Moon, land, and come home under a parachute.

It runs in any modern browser on desktop and mobile. There is no build step and no dependencies: open `index.html` and play.

## Play

- **Locally:** double-click `index.html`, or serve the folder (`npx serve .`) to also get the offline/installable PWA.
- **Single file:** `node tools/build-single.mjs` writes `dist/orbit-forge.html`, the whole game in one HTML file you can send to someone.
- **GitHub Pages:** push this folder as the repository root, then enable Pages (Settings → Pages → Deploy from branch → `main` / root). The game will be at `https://<you>.github.io/<repo>/`.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Rotate | `A` / `D` or `←` / `→` | Hold the ⟲ ⟳ buttons |
| Throttle | `W` / `S` or `Shift` / `Ctrl`; `Z` full, `X` cut | Drag the throttle bar; Max / Cut |
| Next stage | `Space` | STAGE button |
| Use one part | Click it | Tap it (engines toggle, separators fire, parachutes open) |
| Map view | `M` | Map button |
| Time warp | `,` / `.` | ⏪ ⏩ buttons |
| Zoom | Mouse wheel | Pinch |
| Pause | `Esc` | Menu button |

In the builder, drag parts from the tray onto the blueprint (tap a tray part to auto-stack it), drag a part back onto the tray to remove it, and press `Enter` or **Launch** to fly.

## What's in it

- **Builder:** 16 parts across command pods, tanks, four engines, separators, nose cones, parachutes and landing legs. Edge snapping, symmetry mode for side boosters, live mass, thrust, TWR and Δv per stage, and an automatic staging order (shown as numbered badges). The design autosaves.
- **Physics:** rigid-body rockets with centre-of-mass and moment-of-inertia tracking, engine gimbal and reaction wheels, Isp that varies with air pressure, exponential atmosphere with drag, reentry glow, parachutes with a drogue phase, and per-corner ground contact. Parts break if they hit the ground too hard.
- **Orbits:** patched conics. Earth and the Moon each have a sphere of influence. Out of the atmosphere, time warp up to 50,000× runs the craft "on rails" with exact Kepler propagation. Warp drops back automatically when you hit the atmosphere or change sphere of influence.
- **Map view:** predicted trajectory with apoapsis and periapsis, Moon encounters (with the periapsis you'll get), escapes and impact points.
- **Milestones:** liftoff, space, orbit, lunar encounter, lunar orbit, Moon landing, and returning home.
- **Sound:** procedural engine rumble, separation thunks and explosions (Web Audio, no files).

## Scale

Like Spaceflight Simulator, the solar system is shrunk: Earth has a 315 km radius with real surface gravity (9.8 m/s²) and a 30 km atmosphere. Low orbit takes about 1.7 km/s of orbital speed and about 2.5 km/s of Δv. The Moon (90 km radius, 1.62 m/s²) orbits 6,200 km out.

## Project layout

```
index.html            page shell and HUD markup
css/style.css         all styling (HUD, builder, responsive rules)
js/util.js            maths, formatting, storage helpers
js/space.js           bodies, terrain, Kepler orbits, trajectory prediction
js/parts.js           part catalogue, attachment rules, staging, Δv, part drawing
js/vessel.js          rigid-body vessel: forces, fuel, ground contact, splitting
js/builder.js         build screen and rocket templates
js/flight.js          flight screen: simulation loop, time warp, camera, map, HUD
js/ui.js, audio.js    dialogs/toasts and procedural sound
js/main.js            app shell and main loop
sw.js, manifest.webmanifest, icons/   offline support and install icons
tools/build-single.mjs bundles everything into dist/orbit-forge.html
```

Scripts are plain (non-module) JavaScript so the game also works when opened straight from disk.

## Ideas for later

Mars and a heliocentric layer, docking, fairings and fins with aerodynamic stability, solar panels and batteries, a career mode with funds and part unlocks, saving flights mid-mission, and custom staging edits in the builder.
