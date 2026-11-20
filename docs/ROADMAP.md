# Overbuilt: future updates (the owner's to-do list)

Things the owner wants in later updates, not the current one. Newest at the bottom of each list. When one ships, move it to CLAUDE.md's History table and delete it here.

## Drones
- **Friendly AI drones and waypoints.** Send a drone to a point, or let it patrol and attack on its own, while you drive the tank.

## Multiplayer
- **Friends.** Add friends, see who's online, invite them to a room or join theirs.

## Weapons
- **Realistic missile rework.** Heat seekers deadlier at short range (hard to shake close in, easy to decoy far out), radar missiles the long-range weapon (they lose to notching and chaff close in); ranges, seekers and countermeasures tuned as real ones behave.

## Sound
- **A sounds update.** Better engines, guns, explosions, wind, water and the HUD's warnings.

## Menus
- **A new main menu screen.**

## World and graphics
- **A detailed home region.** Make the map round the spawns far more detailed: North Scotland, Shetland, the Faroes and the waters between them (higher-resolution terrain and coastlines, real towns, harbours, roads, fields, woods and cliffs, better ground textures and scenery density). Keep the rest of the world at today's quality, so the GPU, download and memory go where players actually spend their time. Battery still matters: the detail must stream in and fade with distance, and phone Low must stay within today's cost.

## Fixes
- **The Faroes' main runway vanishes from some angles.** Seen from a plane in the air, mostly from one side, all or half of the space centre's runway disappears into the grass, as if the ground were drawn over it. Unknown whether other airfields do it. A likely lead (not yet confirmed): the other airfields (`EARTH.airfields`) have a render-only clamp that keeps the coarse distant ground under their paving (render3d `fieldGround`, applied where `Terrain.fieldAt` says a point is on a field), but the space centre's runway is levelled through the track's own blend (terrain.js `builtW`, `apronW`) and isn't in that list, so a coarse terrain cell from the hillside beside it may rise over the strip by more than the paving's `depthBias` (3e-4 of the distance) pulls it forward. Fix with a screenshot sweep round the field from the air at several distances and headings (before and after), and check the other airfields and carriers' neighbours the same way.

## On file from earlier updates
- **Performance:** drop the logarithmic depth buffer, which stops phone GPUs skipping hidden pixels early (needs another way to keep depth precise from a cockpit to planet scale), and draw smoke at half resolution in heavy battles.
