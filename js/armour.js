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
  hitFirst(v, a, e) { return Combat.hitVessel(v, a, e); }, // (Phase 1: the old box test)
  moveShell(s, h, F) { return false; },
  netShell(g, m) {},
  coarseH(e, z) { return 0; },
  resolve(s, v, hits, F) { return null; },
  apply(v, res, F, by) {},
  legacyHit(s, v, p, at, F) { return false; }, // (whether the shot flies on)
  blastK(v, p, d, blast, k, he, mods) { return k; },
  // (Phase 1: at 0 hp a module part is ripped off, as any other part; Phase 2B breaks it instead, and it stays)
  moduleDown(v, p, cause, sim) {
    sim.ripParts(v, [p], cause);
    if (v.ai && !v.control && !v.ai.down) Combat.aiDown(v, sim);
  },
  modDamage(v, host, i, dmg, sim, by) {},
  knockOut(v, sim, why) {},
  crewOf(v) { return { crew: [], stores: [] }; },
  has(v, role) { return true; },
  repairStep(v, dt, sim) {},
  // A damaged module part's smoke and fire (Combat.frame, every 0.07 s: n counts the puffs). Phase 1: as every part's.
  partFX(o, p, n) {
    if (p.hp == null) return;
    const f = Combat.hpFrac(p);
    if (f > 0.6) return;
    const zs = partZs(p), wp = o.toWorld(p.x, p.y, zs[n % zs.length]);
    FX.add({ kind: 'smoke', b: o.body, x: wp.x, y: wp.y, z: wp.z, vx: o.vx * 0.85, vy: o.vy * 0.85, vz: o.vz * 0.85, max: 2.5, size: 0.8, grow: 4, color: f < 0.3 ? '#2b2d31' : '#5d6168', alpha: 0.65 });
    if (f < 0.3) FX.add({ kind: 'fire', b: o.body, x: wp.x, y: wp.y, z: wp.z, vx: o.vx * 0.9, vy: o.vy * 0.9, vz: o.vz * 0.9, max: 0.35, size: 0.8, grow: 1.2, color: '#ff9a3c', alpha: 1 });
    if (f < 0.5 && p.fuel > 0) p.fuel = Math.max(0, p.fuel - (0.5 - f) * 40 * 0.07);
  },
  summary(parts) { return null; },
};
// ==== end of Armour ====
