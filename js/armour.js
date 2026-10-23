'use strict';
// Armour for ground vehicles (the ground update): shells in flight, where they hit, whether they get through
// (thickness, angle, ricochet, overmatch, skirts, ERA), what happens inside (crew, modules, ammunition, fire),
// knock-outs, repairs, HE against armour, and what old weapons do to it.

// ==== SHELLS (data; the catalogue package owns this region) ====
// SHELLS: every round a ground weapon fires, by key. SHELL_TYPES: how each type behaves on armour.
const SHELLS = {};
const SHELL_TYPES = {};
// ==== end of SHELLS ====


// ==== Armour (the systems; Phase 1 stubs, Phase 2B fills) ====
const Armour = {
  hitAll(v, a, e, out) { return out || []; },
  hitFirst(v, a, e) { return null; },
  moveShell(s, h, F) { return false; },
  netShell(g, m) {},
  coarseH(e, z) { return 0; },
  resolve(s, v, hits, F) { return null; },
  apply(v, res, F, by) {},
  legacyHit(s, v, p, at, F) {},
  blastK(v, p, d, blast, k, he, mods) { return k; },
  moduleDown(v, p, cause, sim) {},
  modDamage(v, host, i, dmg, sim, by) {},
  knockOut(v, sim, why) {},
  crewOf(v) { return { crew: [], stores: [] }; },
  has(v, role) { return true; },
  repairStep(v, dt, sim) {},
  partFX(o, p, n) {},
  summary(parts) { return null; },
};
// ==== end of Armour ====
