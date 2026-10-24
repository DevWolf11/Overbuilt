// Scratch data for the spec: part masses and costs, template sums. Not game code.
const P = {
  // hulls
  hullLight: { m: 4.0, c: 3000 }, hullMedium: { m: 11, c: 6500 }, hullHeavy: { m: 24, c: 10000 }, hullMBT: { m: 24, c: 17000 },
  hullIFV: { m: 10, c: 6000 }, hullWheeled: { m: 7, c: 4500 }, hullCasemate: { m: 22, c: 11000 },
  // turrets
  ringS: { m: 0.3, c: 1500 }, ringM: { m: 0.6, c: 2500 }, ringL: { m: 1.0, c: 3500 }, ringP: { m: 0.9, c: 6000 },
  turretSmall: { m: 1.4, c: 2500 }, turretCast: { m: 6.5, c: 6000 }, turretBox: { m: 11, c: 7000 }, turretWedge: { m: 16, c: 15000 },
  turretAuto: { m: 9, c: 13000 }, turretOpen: { m: 2.5, c: 2500 }, turretAA: { m: 6, c: 6000 },
  // drive (one track per side)
  trackLight: { m: 1.3, c: 1300 }, trackMed: { m: 3.0, c: 2000 }, trackHeavy: { m: 5.5, c: 2800 }, trackMBT: { m: 5.0, c: 3500 },
  wheelArm: { m: 0.45, c: 750 }, wheelArmS: { m: 0.25, c: 500 },
  engPetrol: { m: 0.9, c: 2000, kw: 260 }, engDiesel: { m: 1.6, c: 3500, kw: 450 }, engDieselL: { m: 2.6, c: 5500, kw: 750 }, engTurbine: { m: 1.5, c: 9000, kw: 1100 },
  // guns
  gun37: { m: 0.4, c: 2500 }, gun50: { m: 0.7, c: 3500 }, gun75: { m: 1.0, c: 4500 }, gun76L: { m: 1.3, c: 6000 }, gun85: { m: 1.6, c: 6500 },
  gun88: { m: 1.8, c: 8000 }, gun105: { m: 2.4, c: 10000 }, gun120: { m: 3.2, c: 15000 }, gun125: { m: 3.0, c: 14000 }, gun152: { m: 4.5, c: 9000 },
  ac20: { m: 0.1, c: 3000 }, ac30: { m: 0.18, c: 5000 }, ac35: { m: 0.5, c: 6000 }, aa23q: { m: 0.9, c: 8000 }, mgCoax: { m: 0.02, c: 800 }, mgHeavy: { m: 0.06, c: 1500 },
  // launchers
  atgmWire: { m: 0.05, c: 4000 }, atgmTube: { m: 0.25, c: 9000 }, atgmTop: { m: 0.12, c: 15000 }, samIR: { m: 0.4, c: 9000 }, samCmd: { m: 0.8, c: 16000 },
  samLong: { m: 5, c: 32000 }, mlrsLight: { m: 0.6, c: 6000 }, mlrsPod: { m: 2.2, c: 14000 },
  // crew and ammunition
  seatDriver: { m: 0.1, c: 400 }, seatGunner: { m: 0.1, c: 400 }, seatCommander: { m: 0.1, c: 400 }, seatLoader: { m: 0.1, c: 400 },
  ammoRack: { m: 0.3, c: 500 }, ammoRackL: { m: 0.5, c: 800 }, wetRack: { m: 0.4, c: 900 }, autoloader: { m: 1.2, c: 5000 }, troopBay: { m: 0.8, c: 2000 }, fuelCell: { m: 0.4, c: 400 },
  // kit
  radarSearch: { m: 0.3, c: 6000 }, radarTrack: { m: 0.25, c: 6000 }, thermal: { m: 0.05, c: 4000 }, lrf: { m: 0.02, c: 1500 }, smokeL: { m: 0.05, c: 800 },
  era: { m: 0.25, c: 400 }, skirts: { m: 0.2, c: 450 }, plateApp: { m: 0.7, c: 600 }, slatCage: { m: 0.15, c: 700 },
  // old parts used by the technical
  chassis: { m: 0.25, c: 800 }, cab: { m: 0.7, c: 2500 }, carWheel: { m: 0.08, c: 600 },
};
const T = {
  tk34: ['TK-34', 'WWII medium tank', { hullMedium: 1, trackMed: 2, engDiesel: 1, ringM: 1, turretCast: 1, gun85: 1, mgCoax: 2 }],
  ms4: ['MS-4 Shermin', 'WWII medium tank', { hullMedium: 1, trackMed: 2, engPetrol: 1, ringM: 1, turretCast: 1, gun75: 1, mgCoax: 1, mgHeavy: 1 }],
  tygr: ['Tygr I', 'WWII heavy tank', { hullHeavy: 1, trackHeavy: 2, engDiesel: 1, ringL: 1, turretBox: 1, gun88: 1, mgCoax: 1, smokeL: 2 }],
  pumo: ['Pumo 8×8', 'armoured car', { hullWheeled: 1, wheelArmS: 8, engPetrol: 1, ringS: 1, turretSmall: 1, gun50: 1, mgCoax: 1 }],
  stuq3: ['StuQ III', 'casemate tank destroyer', { hullCasemate: 1, trackMed: 2, engPetrol: 1, gun76L: 1, skirts: 2 }],
  ms18: ['MS-18 Hellion', 'open-top tank destroyer', { hullLight: 1, trackLight: 2, engPetrol: 1, ringM: 1, turretOpen: 1, gun76L: 1, mgHeavy: 1 }],
  leapard1: ['Leapard 1', 'Cold War MBT', { hullMedium: 1, trackMBT: 2, engDieselL: 1, ringP: 1, turretCast: 1, gun105: 1, mgCoax: 1, smokeL: 2 }],
  tk72: ['TK-72', 'Cold War MBT, autoloader', { hullMBT: 1, trackMBT: 2, engDieselL: 1, ringP: 1, turretAuto: 1, gun125: 1, mgCoax: 1, mgHeavy: 1, era: 8, smokeL: 2 }],
  ma1: ['MA-1 Abrahm', 'modern MBT', { hullMBT: 1, trackMBT: 2, engTurbine: 1, ringP: 1, turretWedge: 1, gun120: 1, mgCoax: 1, mgHeavy: 1, smokeL: 2, thermal: 1, lrf: 1, skirts: 2 }],
  zsy23: ['ZSY-23 Shilko', 'radar SPAA', { hullLight: 1, trackLight: 2, engPetrol: 1, ringM: 1, turretAA: 1, aa23q: 1, radarTrack: 1 }],
  gepardo: ['Gepardo', 'radar SPAA', { hullMedium: 1, trackMBT: 2, engDieselL: 1, ringP: 1, turretAA: 1, ac35: 2, radarSearch: 1, radarTrack: 1, smokeL: 2 }],
  bmk2: ['BMK-2', 'infantry fighting vehicle', { hullIFV: 1, trackLight: 2, engDiesel: 1, ringS: 1, turretSmall: 1, ac30: 1, atgmTube: 1, mgCoax: 1, smokeL: 2 }],
  brdk2: ['BRDK-2 Gadfly', 'ATGM carrier', { hullWheeled: 1, wheelArm: 4, engPetrol: 1, ringS: 1, atgmWire: 3 }],
  bk21: ['BK-21 Grod', 'rocket artillery', { hullWheeled: 1, wheelArm: 6, engPetrol: 1, ringM: 1, mlrsLight: 1 }],
  ok8: ['OK-8 Hive', 'radar SAM launcher', { hullWheeled: 1, wheelArm: 6, engDiesel: 1, ringP: 1, turretAA: 1, samCmd: 2, radarSearch: 1, radarTrack: 1 }],
  technical: ['Desert Technical', 'armed car (kind car)', { chassis: 1, cab: 1, carWheel: 2, mgHeavy: 1 }],
};
const out = [];
for (const [k, [name, cls, parts]] of Object.entries(T)) {
  let m = 0, c = 0, kw = 0, n = 0;
  for (const [t, q] of Object.entries(parts)) { if (!P[t]) throw new Error(t); m += P[t].m * q; c += P[t].c * q; kw += (P[t].kw || 0) * q; n += q; }
  out.push({ k, name, cls, parts: n, t: +m.toFixed(1), cost: c, kw, hpt: kw ? +(kw * 1.341 / m).toFixed(1) : null });
}
console.table(out);
console.log('part count', Object.keys(P).length - 3);
