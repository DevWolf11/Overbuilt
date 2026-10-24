'use strict';
// Ground Battle rules (the ground update), pure so the multiplayer host and the solo Practice Battle share them:
// arenas, where vehicles start, zone capture, tickets, deaths and the result. GROUND_STOCK: the stock vehicles a
// player falls back to at each money tier.

const GROUND_STOCK = {};

const GroundMode = {
  arena(id) { return null; },
  pick(mapReady) { return mapReady ? 'highland' : 'runway'; },
  placement(arenaId, team, slot, kind) { return null; },
  // Where a solo launch of this kind starts (App.launch, Flight.revert): Armour on Highland Ridge's north pad when the
  // map is ready and the 3D view is on (the 2D view can't show it there); null for the kind's own launch site.
  soloPlace(kind) { return kind === 'tank' && Terrain.earthMap.state === 'ready' && typeof App !== 'undefined' && App.use3D() ? this.placement('highland', 0, 0, 'tank') : null; },
  init(arena, settings, teamSizes) { return null; },
  tick(obj, dt, units) { return []; },
  death(obj, team, cost, air) { return 0; },
  result(obj, timeUp) { return null; },
  inZone(e, z, zone) { return false; },
  // The objective that is live: a room's (MP.state.obj) or the Practice Battle's, else null (the HUD reads it here).
  obj() { return (typeof MP !== 'undefined' && MP.live && MP.state.obj) || (typeof GroundAI !== 'undefined' && GroundAI.battle && GroundAI.battle.obj) || null; },
};
