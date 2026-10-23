'use strict';
// Running gear for ground vehicles (the ground update): tracks and armoured wheels, their suspension, traction
// and skid steering, wading, righting, and collisions between vehicles. Vessel.ground hands a vessel with running
// gear (v.gear, set by rebuildGroups) to Gear.ground as its first line; every other vessel keeps vessel.js's own
// contact code, so old designs never reach this file.

const Gear = {
  calls: 0, // terrain calls made by the last Gear.ground (a test counter)

  // ---- contact points (Phase 1)
  points(p, wheels) {},

  // ---- contacts, suspension, drive (Phase 2A)
  ground(v, dt, sim) { return null; },
  bump(v, sim) {},

  // ---- builder stats (Phase 2A; pure)
  stats(parts) { return null; },
};
