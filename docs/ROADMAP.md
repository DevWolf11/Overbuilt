# Overbuilt: future updates (the owner's to-do list)

Things the owner wants in later updates, not the current one. Newest at the bottom of each list. When one ships, move it to CLAUDE.md's History table and delete it here.

## Drones
- **Friendly AI drones and waypoints.** Send a drone to a point, or let it patrol and attack on its own, while you drive the tank.

## World and graphics
- **Better clouds.** The cumulus clouds, improved in look (and kept as cheap as now on phones).
- **Water with depth.** The sea and lakes are a flat surface today. Give them depth: a sea floor you can see into near the shore, colour that darkens with depth, and things that sink going down through the water instead of vanishing at the surface.

## On file from earlier updates
- **The near ground's GPU cost** (the terrain-collision update, handbook chapter 3 §1.6): with a craft on the ground it costs 10-18% of a frame in the render bench (SwiftShader), mostly its 4 m cells far off seen at a grazing angle; give it coarser cells with the distance from the camera (stitched, or morphed in the vertex shader) so phones pay less.
- **Performance:** drop the logarithmic depth buffer, which stops phone GPUs skipping hidden pixels early (needs another way to keep depth precise from a cockpit to planet scale), and draw smoke at half resolution in heavy battles.
- **Phone HUD nits** (portrait): the engine-fire warning can cover a locked bandit's tag; a far radar contact's tag can be cut off at the left edge; from right behind, your own burning engine looks like a pale orange cloud instead of dark smoke.
