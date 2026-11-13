# Overbuilt: future updates (the owner's to-do list)

Things the owner wants in later updates, not the current one. Newest at the bottom of each list. When one ships, move it to CLAUDE.md's History table and delete it here.

## Drones
- **Auto drones: lock-on attack.** Mark a vehicle (tap it, or a key while it's in the camera) and the drone flies the attack itself: it climbs, closes in and dives onto the roof, leading for the target's motion. The stick takes control back at any moment. A jammed or lost link breaks the lock (not on fibre). Needs a camera part. The AI drones' attack code already does most of it (drone.js `aiSteer`: climb, cruise, terminal dive).
- **Friendly AI drones and waypoints.** Send a drone to a point, or let it patrol and attack on its own, while you drive the tank.

## Planes
- **Wingtip vapour trails in the wrong place.** The trails off the wingtips when you pull a turn are drawn at the wrong spot on wings that sit ahead of or behind the craft's middle: they come off in front of the tip or behind it, not from the tip itself. They should follow the actual tip of each wing whatever its position along the fuselage.
- **Aim's pull-out over the sea.** With Settings → Aim pulls out of dives on (it's off by default), a 30° dive at open sea from 400 m pulls the fast jets out only 6-14 m off the water (the FS-35 6 m, the FS-4 8 m), the light planes 17-25 m. Pull the jets out higher, at least 15 m (test/planes.test.js has the scenario).

## World and graphics
- **Better clouds.** The cumulus clouds, improved in look (and kept as cheap as now on phones).
- **Water with depth.** The sea and lakes are a flat surface today. Give them depth: a sea floor you can see into near the shore, colour that darkens with depth, and things that sink going down through the water instead of vanishing at the surface.

## On file from earlier updates
- **The near ground's GPU cost** (the terrain-collision update, handbook chapter 3 §1.6): with a craft on the ground it costs 10-18% of a frame in the render bench (SwiftShader), mostly its 4 m cells far off seen at a grazing angle; give it coarser cells with the distance from the camera (stitched, or morphed in the vertex shader) so phones pay less.
- **Performance:** drop the logarithmic depth buffer, which stops phone GPUs skipping hidden pixels early (needs another way to keep depth precise from a cockpit to planet scale), and draw smoke at half resolution in heavy battles.
- **Phone HUD nits** (portrait): the engine-fire warning can cover a locked bandit's tag; a far radar contact's tag can be cut off at the left edge; from right behind, your own burning engine looks like a pale orange cloud instead of dark smoke.
