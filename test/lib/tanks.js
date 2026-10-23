// Five ground vehicles built from the catalogue's own parts, as design rows ({type, x, y, flip, rot, z, att}; att is an
// index into the same list), for the tests: the parts lists of spec §12 for the TK-34, the MS-4 Shermin, the Tygr I, the
// MA-1 Abrahm and the Pumo 8×8, every part joined to the hull (by att) and none clashing. Nose toward +x, tracks or
// wheels beside the hull at ±z, the engine inside at the back, the main gun at rot 3 in the turret's front with its
// trunnion at the turret face.
//   const T = require('./lib/tanks.js');  G.craft(ctx, T.tk34, 'tank')
const row = (type, x, y, o = {}) => ({ type, x, y, flip: false, rot: 0, ...o });

// TK-34 (after the T-34-85): sloped medium hull, medium tracks, the diesel, a cast turret with the 85 mm gun, a coaxial
// MG and a bow MG in the glacis. 27.3 t, 450 kW.
const tk34 = [
  row('hullMedium', 0, 1.1),
  row('trackMed', 0, 0.5, { z: -1.35, att: 0 }), row('trackMed', 0, 0.5, { z: 1.35, att: 0 }),
  row('engDiesel', -1.8, 1.1, { att: 0 }),
  row('ringM', 0, 1.85, { att: 0 }), row('turretCast', 0, 2.425, { att: 4 }),
  row('gun85', 2.622, 2.425, { rot: 3, att: 5 }), row('mgCoax', 1.4, 2.425, { rot: 3, z: 0.6, att: 5 }),
  row('mgCoax', 2.03, 1.35, { rot: 3, z: 0.55, att: 0 }), // (the bow MG)
];
// MS-4 Shermin (after the M4 Sherman): the same hull and tracks with a petrol engine, the 75 mm gun, a coaxial MG and a
// heavy MG on the turret roof. 26.1 t, 260 kW.
const ms4 = [
  row('hullMedium', 0, 1.1),
  row('trackMed', 0, 0.5, { z: -1.35, att: 0 }), row('trackMed', 0, 0.5, { z: 1.35, att: 0 }),
  row('engPetrol', -1.8, 1.1, { att: 0 }),
  row('ringM', 0, 1.85, { att: 0 }), row('turretCast', 0, 2.425, { att: 4 }),
  row('gun75', 2.174, 2.425, { rot: 3, att: 5 }), row('mgCoax', 1.4, 2.425, { rot: 3, z: 0.6, att: 5 }),
  row('mgHeavy', -0.3, 3.15, { rot: 3, z: -0.6, att: 5 }),
];
// Tygr I (after the Tiger I): the heavy box hull on heavy tracks, the diesel, a box turret on the heavy ring with the
// 88 mm gun, a coaxial MG and smoke launchers on its flanks. 50.5 t, 450 kW.
const tygr = [
  row('hullHeavy', 0, 1.25),
  row('trackHeavy', 0, 0.55, { z: -1.65, att: 0 }), row('trackHeavy', 0, 0.55, { z: 1.65, att: 0 }),
  row('engDiesel', -2.0, 1.25, { att: 0 }),
  row('ringL', 0, 2.16, { att: 0 }), row('turretBox', 0, 2.77, { att: 4 }),
  row('gun88', 3.014, 2.77, { rot: 3, att: 5 }), row('mgCoax', 1.5, 2.77, { rot: 3, z: 0.7, att: 5 }),
  row('smokeL', 0.6, 2.9, { z: -1.4, att: 5 }), row('smokeL', 0.6, 2.9, { z: 1.4, att: 5 }),
];
// MA-1 Abrahm (after the M1A1): the composite hull on modern tracks with side skirts, the turbine, the wedge turret on a
// powered ring with the 120 mm gun, a coaxial and a heavy MG, smoke launchers, a thermal sight and a laser rangefinder.
// 56.3 t, 1,100 kW.
const ma1 = [
  row('hullMBT', 0, 1.15),
  row('trackMBT', 0, 0.55, { z: -1.575, att: 0 }), row('trackMBT', 0, 0.55, { z: 1.575, att: 0 }),
  row('engTurbine', -2.4, 1.15, { att: 0 }),
  row('ringP', -0.3, 1.96, { att: 0 }), row('turretWedge', -0.3, 2.495, { att: 4 }),
  row('gun120', 3.548, 2.45, { rot: 3, att: 5 }), row('mgCoax', 1.7, 2.45, { rot: 3, z: 0.75, att: 5 }),
  row('mgHeavy', -1.0, 3.17, { rot: 3, z: 0.8, att: 5 }),
  row('smokeL', 0.6, 2.6, { z: -1.8, att: 5 }), row('smokeL', 0.6, 2.6, { z: 1.8, att: 5 }),
  row('thermal', -0.6, 3.12, { z: -0.8, att: 5 }), row('lrf', -0.4, 3.07, { z: -0.3, att: 5 }),
  row('skirts', 0.5, 0.85, { z: -1.93, att: 1 }), row('skirts', 0.5, 0.85, { z: 1.93, att: 2 }),
];
// Pumo 8×8 (after the Sd.Kfz. 234/2): the wheeled hull on eight light armoured wheels, the petrol engine, a small turret
// on the small ring with the 50 mm gun and a coaxial MG. 12.3 t, 260 kW.
const pumo = [
  row('hullWheeled', 0, 1.3),
  ...[-2.25, -0.75, 0.75, 2.25].flatMap((x) => [row('wheelArmS', x, 0.5, { z: -1.45, att: 0 }), row('wheelArmS', x, 0.5, { z: 1.45, att: 0 })]),
  row('engPetrol', -2.0, 1.3, { att: 0 }),
  row('ringS', 0, 2.15, { att: 0 }), row('turretSmall', 0, 2.625, { att: 10 }),
  row('gun50', 1.728, 2.55, { rot: 3, att: 11 }), row('mgCoax', 1.2, 2.55, { rot: 3, z: 0.4, att: 11 }),
];
module.exports = { tk34, ms4, tygr, ma1, pumo };
