'use strict';
// Ground Battle rules (the ground update), pure so the multiplayer host and the solo Practice Battle share them:
// arenas, where vehicles start, zone capture, tickets, deaths and the result. GROUND_STOCK: the stock vehicles a
// player falls back to at each money tier.

const GROUND_STOCK = {};

const GroundMode = {
  arena(id) { return null; },
  pick(mapReady) { return mapReady ? 'highland' : 'runway'; },
  placement(arenaId, team, slot, kind) { return null; },
  soloPlace(kind) { return null; },
  init(arena, settings, teamSizes) { return null; },
  tick(obj, dt, units) { return []; },
  death(obj, team, cost, air) { return 0; },
  result(obj, timeUp) { return null; },
  inZone(e, z, zone) { return false; },
  obj() { return null; },
};
