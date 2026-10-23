'use strict';
// Armour for ground vehicles (the ground update): shells in flight, where they hit, whether they get through
// (thickness, angle, ricochet, overmatch, skirts, ERA), what happens inside (crew, modules, ammunition, fire),
// knock-outs, repairs, HE against armour, and what old weapons do to it.

// ==== SHELLS (data; the catalogue package owns this region) ====
// SHELLS: every round a ground weapon fires, by key (a gun's weapon.shells name them, the first loaded by default).
// type: a SHELL_TYPES key; label: what the HUD calls it (a type of round, never a designation); cal in mm; v0: muzzle
// speed (m/s); pen: mm of armour it goes through at the muzzle, a kinetic round's falling with speed as (v/v0)^1.43 and
// a shaped charge's (heat) the same at any range (high explosive: 0, it has he instead); k: its drag (slowing by
// k·ρ·v² m/s², as combat.js slows bullets); kg; dmg: the damage along its path once through. he: what its burst goes
// through (mm), blast: its radius (m); burst and r: an explosive-filled AP round's burst inside (damage, radius);
// prox: a proximity fuze's reach (m), armed after arm s, gone after life s; tracer: one round in that many glows.
const SHELLS = {
  ap37: { type: 'ap', label: 'AP', cal: 37, v0: 870, pen: 65, k: 10e-5, kg: 0.7, dmg: 140 },
  he37: { type: 'he', label: 'HE', cal: 37, v0: 780, pen: 0, k: 11e-5, kg: 0.7, dmg: 110, he: 7, blast: 1.5 },
  ap50: { type: 'ap', label: 'AP', cal: 50, v0: 835, pen: 90, k: 10e-5, kg: 2.0, dmg: 180 },
  apcr50: { type: 'apcr', label: 'APCR', cal: 50, v0: 1180, pen: 140, k: 16e-5, kg: 0.9, dmg: 160 },
  he50: { type: 'he', label: 'HE', cal: 50, v0: 700, pen: 0, k: 11e-5, kg: 1.8, dmg: 150, he: 9, blast: 2 },
  ap75: { type: 'ap', label: 'AP', cal: 75, v0: 620, pen: 100, k: 10e-5, kg: 6.8, dmg: 260 },
  he75: { type: 'he', label: 'HE', cal: 75, v0: 600, pen: 0, k: 11e-5, kg: 6.0, dmg: 225, he: 14, blast: 3 },
  ap76: { type: 'ap', label: 'AP', cal: 76, v0: 790, pen: 125, k: 10e-5, kg: 7.0, dmg: 260 },
  apcr76: { type: 'apcr', label: 'APCR', cal: 76, v0: 1000, pen: 190, k: 16e-5, kg: 4.2, dmg: 230 },
  he76: { type: 'he', label: 'HE', cal: 76, v0: 680, pen: 0, k: 11e-5, kg: 6.2, dmg: 230, he: 14, blast: 3 },
  aphe85: { type: 'aphe', label: 'APHE', cal: 85, v0: 800, pen: 145, k: 9e-5, kg: 9.2, dmg: 290, burst: 380, r: 2 },
  he85: { type: 'he', label: 'HE', cal: 85, v0: 790, pen: 0, k: 11e-5, kg: 9.5, dmg: 255, he: 15, blast: 3.5 },
  aphe88: { type: 'aphe', label: 'APHE', cal: 88, v0: 780, pen: 165, k: 9e-5, kg: 10, dmg: 300, burst: 380, r: 2 },
  apcr88: { type: 'apcr', label: 'APCR', cal: 88, v0: 930, pen: 210, k: 16e-5, kg: 7.3, dmg: 260 },
  he88: { type: 'he', label: 'HE', cal: 88, v0: 820, pen: 0, k: 11e-5, kg: 9, dmg: 265, he: 16, blast: 3.5 },
  apds105: { type: 'apds', label: 'APDS', cal: 105, v0: 1430, pen: 300, k: 4.5e-5, kg: 5.8, dmg: 280 },
  heat105: { type: 'heat', label: 'HEAT', cal: 105, v0: 1170, pen: 400, k: 12e-5, kg: 10.4, dmg: 270 },
  hesh105: { type: 'hesh', label: 'HESH', cal: 105, v0: 730, pen: 120, k: 11e-5, kg: 11, dmg: 300, blast: 4 },
  apfsds120: { type: 'apfsds', label: 'APFSDS', cal: 120, v0: 1650, pen: 560, k: 3.0e-5, kg: 4.6, dmg: 320 },
  heat120: { type: 'heat', label: 'HEAT', cal: 120, v0: 1140, pen: 480, k: 12e-5, kg: 13.5, dmg: 300 },
  he120: { type: 'he', label: 'HE', cal: 120, v0: 900, pen: 0, k: 11e-5, kg: 15, dmg: 360, he: 22, blast: 5 },
  apfsds125: { type: 'apfsds', label: 'APFSDS', cal: 125, v0: 1700, pen: 520, k: 3.0e-5, kg: 4.8, dmg: 320 },
  heat125: { type: 'heat', label: 'HEAT', cal: 125, v0: 905, pen: 450, k: 12e-5, kg: 19, dmg: 300 },
  he125: { type: 'he', label: 'HE', cal: 125, v0: 850, pen: 0, k: 11e-5, kg: 23, dmg: 375, he: 23, blast: 5.5 },
  he152: { type: 'he', label: 'HE', cal: 152, v0: 600, pen: 0, k: 10e-5, kg: 40, dmg: 900, he: 60, blast: 7 },
  aphe152: { type: 'aphe', label: 'APHE', cal: 152, v0: 600, pen: 140, k: 9e-5, kg: 49, dmg: 420, burst: 600, r: 3 },
  heat152: { type: 'heat', label: 'HEAT', cal: 152, v0: 700, pen: 300, k: 12e-5, kg: 27, dmg: 380 },
  ap20: { type: 'ap', label: 'AP', cal: 20, v0: 850, pen: 35, k: 11e-5, kg: 0.12, dmg: 40, tracer: 3 },
  hei20: { type: 'hei', label: 'HEI', cal: 20, v0: 850, pen: 0, k: 13e-5, kg: 0.12, dmg: 20, he: 4, blast: 1.5 },
  ap23: { type: 'ap', label: 'AP', cal: 23, v0: 980, pen: 40, k: 11e-5, kg: 0.19, dmg: 40 },
  heit23: { type: 'hei', label: 'HEI', cal: 23, v0: 970, pen: 0, k: 13e-5, kg: 0.19, dmg: 22, he: 5, blast: 1.8 },
  apds30: { type: 'apds', label: 'APDS', cal: 30, v0: 1100, pen: 65, k: 5e-5, kg: 0.3, dmg: 60 },
  hei30: { type: 'hei', label: 'HEI', cal: 30, v0: 960, pen: 0, k: 13e-5, kg: 0.4, dmg: 30, he: 6, blast: 2 },
  hevt35: { type: 'hevt', label: 'HE-VT', cal: 35, v0: 1175, pen: 0, k: 12e-5, kg: 0.55, dmg: 60, he: 6, blast: 3.5, prox: 4, arm: 0.4, life: 6 },
  apds35: { type: 'apds', label: 'APDS', cal: 35, v0: 1385, pen: 80, k: 4.5e-5, kg: 0.38, dmg: 70 },
  ball8: { type: 'ball', label: 'Ball', cal: 7.6, v0: 850, pen: 10, k: 12e-5, kg: 0.01, dmg: 9 },
  ball13: { type: 'ball', label: 'Ball', cal: 12.7, v0: 890, pen: 22, k: 11e-5, kg: 0.05, dmg: 16 },
};
// How each type meets a plate. ric: the angle from the plate's normal (°) over which ricochet goes from never to
// certain (a shaped charge's fuze fails there instead; past a squash head's, it slips off); norm: how far the round
// turns into the plate (°); L: how far it carries on inside (m); n and cone: the fragments it throws off the plate's
// back (how many, and the cone's half-angle in °). blind: a squash head treats any plate up to this angle as flat.
// fuse: how far past the plate an explosive-filled AP round bursts (m). High explosive bursts where it hits.
const SHELL_TYPES = {
  ap: { ric: [65, 75], norm: 5, L: 3.0, n: 8, cone: 22 },
  aphe: { ric: [63, 73], norm: 5, L: 3.0, n: 4, cone: 18, fuse: 1.2 },
  apcr: { ric: [61, 71], norm: 2, L: 2.0, n: 6, cone: 16 },
  apds: { ric: [70, 80], norm: 2, L: 3.5, n: 10, cone: 16 },
  apfsds: { ric: [73, 83], norm: 2, L: 4.5, n: 12, cone: 14 },
  heat: { ric: [75, 85], norm: 0, L: 1.8, n: 6, cone: 10 },
  hesh: { ric: [60, 70], norm: 0, L: 0, n: 12, cone: 35, blind: 60 },
  he: { ric: [80, 90], norm: 0, L: 0, n: 0, cone: 0 },
  hei: { ric: [80, 90], norm: 0, L: 0, n: 0, cone: 0 },
  hevt: { ric: [80, 90], norm: 0, L: 0, n: 0, cone: 0 },
  ball: { ric: [55, 65], norm: 0, L: 0, n: 0, cone: 0 },
};
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
