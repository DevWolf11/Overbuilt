# Overbuilt: future updates (the owner's to-do list)

Things the owner wants in later updates, not the current one. Newest at the bottom of each list. When one ships, move it to CLAUDE.md's History table and delete it here.

## Drones
- **Friendly AI drones and waypoints.** Send a drone to a point, or let it patrol and attack on its own, while you drive the tank.

## World and graphics
- **Better clouds.** The cumulus clouds, improved in look (and kept as cheap as now on phones).
- **Terrain collision that matches what you see.** Outside Highland Ridge (which already has its own ground mesh built from the physics' heights), the ground a plane or tank touches doesn't line up exactly with the ground drawn: craft can sink into a drawn hill or hover over a drawn dip. The drawn ground and the physics' ground should be the same surface everywhere.
- **Water with depth.** The sea and lakes are a flat surface today. Give them depth: a sea floor you can see into near the shore, colour that darkens with depth, and things that sink going down through the water instead of vanishing at the surface.

## On file from earlier updates
- **Performance:** drop the logarithmic depth buffer, which stops phone GPUs skipping hidden pixels early (needs another way to keep depth precise from a cockpit to planet scale), and draw smoke at half resolution in heavy battles.
- **Phone HUD nits** (portrait): the engine-fire warning can cover a locked bandit's tag; a far radar contact's tag can be cut off at the left edge; from right behind, your own burning engine looks like a pale orange cloud instead of dark smoke.
