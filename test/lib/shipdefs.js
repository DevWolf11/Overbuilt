// Test-only ship parts (the ships update, WP7): the spec's §6 parts that other packages (WP5 the catalogue, WP9 the naval
// weapons) haven't put in PARTS yet, each with the spec's key, size and the fields placement and the warnings read (place,
// ring, deck, weapon.vls/asm/kind, ciws, foil, jet, steer, engine, screw, bulkhead, pump, store, mods' dc crew, funnel,
// hangar, searchRadar/trackRadar, control, stealth). Plain script text, run in the game's scope (node: G.run; a page:
// page.evaluate): a key already in PARTS is left as it is, so the tests run on the real parts as they land. Each added
// def is marked test: true. Art: the generic kit box (tkit 'engine' style) unless a built style fits.
(() => {
  const add = (k, base, o) => {
    if (PARTS[k]) return;
    const d = { ...(base ? PARTS[base] : {}), gv: true, ship: true, family: 'Naval', tier: 1, cost: 1000, hp: 500, desc: 'A test part (the ships update).', ...o, test: true };
    d.type = k;
    d.maxTemp = d.maxTemp || 2000; // (as parts.js sets every part's at load)
    PARTS[k] = d;
  };
  const kit = (o) => ({ shape: 'tkit', style: 'engine', ...o });
  const st = (w) => ({ cls: 'X', ends: { aft: 'joint', fore: 'joint' }, k: 0.2, pump: 0.08, bk: 0.05, ...w });
  // ---- hulls (§6.1): the X class (a destroyer's) and the one-piece RIB hull and float
  add('hbBowX', 'hbBowM', { family: 'Destroyers', name: 'Destroyer Bow', w: 34, h: 13, depth: 16, mass: 1050, hp: 22000,
    shull: st({ wl: -1.0, st: [[-17, 5.0, -6.0, 8.0, 7.8, 2.4], [-6, 5.3, -6.0, 7.7, 7.1, 2.1], [5, 5.8, -5.6, 6.0, 4.6, 1.7], [12, 6.2, -4.0, 3.6, 1.8, 1.4], [17, 6.5, -0.5, 0.3, 0.05, 1]], ends: { aft: 'joint', fore: 'closed' } }),
    armour: { mm: 12, plate: 12, deck: 10, mat: 'steel' } });
  add('hbMidX', 'hbMidM', { family: 'Destroyers', name: 'Destroyer Midsection', w: 24, h: 11, depth: 16, mass: 1300, hp: 20000,
    shull: st({ wl: -0.5, st: [[-12, 5.5, -5.5, 8.0, 7.8, 2.4], [12, 5.5, -5.5, 8.0, 7.8, 2.4]] }),
    armour: { mm: 12, plate: 12, deck: 10, mat: 'steel', belt: { y: [-2.0, 2.0] }, dial: [12, 150] } });
  add('hbSternX', 'hbSternM', { family: 'Destroyers', name: 'Destroyer Stern', w: 26, h: 11, depth: 16, mass: 850, hp: 17000,
    shull: st({ wl: -0.5, st: [[-13, 5.5, -3.0, 7.0, 6.6, 3.2], [-4, 5.5, -4.9, 7.9, 7.6, 2.6], [13, 5.5, -5.5, 8.0, 7.8, 2.4]], ends: { aft: 'closed', fore: 'joint' } }),
    armour: { mm: 12, plate: 12, deck: 10, mat: 'steel' } });
  add('ribHull', 'hbMidM', { family: 'Boats', name: 'RIB Hull', w: 9, h: 1.6, depth: 3.2, mass: 2.2, hp: 500,
    shull: { cls: 'one', wl: -0.3, st: [[-4.5, 0.6, -0.55, 1.6, 1.45, 1.0], [-1, 0.65, -0.62, 1.6, 1.5, 0.9], [2, 0.7, -0.45, 1.35, 1.1, 0.9], [3.8, 0.75, -0.05, 0.75, 0.45, 1.0], [4.5, 0.8, 0.35, 0.15, 0.05, 1]],
      ends: { aft: 'closed', fore: 'closed' }, plane: true, tubes: true, k: 0.12 }, armour: { mm: 4, plate: 4, mat: 'grp' } });
  add('pontoon', 'hbMidM', { family: 'Boats', name: 'Float', w: 6, h: 0.9, depth: 0.9, mass: 0.25, hp: 300,
    shull: { cls: 'one', wl: -0.1, st: [[-3, 0.45, 0.15, 0.15, 0.12, 1], [-0.6, 0.45, -0.3, 0.42, 0.4, 1.4], [0, 0.45, -0.42, 0.45, 0.44, 1.4], [0.05, 0.45, -0.32, 0.45, 0.44, 1.4], [2.3, 0.45, -0.3, 0.43, 0.42, 1.4], [3, 0.45, 0.25, 0.1, 0.05, 1]],
      ends: { aft: 'closed', fore: 'closed' }, plane: true, step: 0.03, k: 0.1 }, armour: { mm: 2, plate: 2, mat: 'alu' } });
  // ---- superstructure (§6.2)
  const crew = (...roles) => roles.map((role, i) => ({ k: 'crew', role, at: [0, 0, (i % 2 ? 0.2 : -0.2)], r: 0.45, hp: 100 }));
  add('consoleS', null, kit({ cat: 'shSuper', place: 'deck', name: 'Helm Console', w: 1.2, h: 1.4, depth: 1.0, mass: 0.3, control: 1, mods: crew('driver', 'commander') }));
  add('bridgeL', null, kit({ cat: 'shSuper', place: 'super', name: 'Bridge', w: 10, h: 7, depth: 12, mass: 120, control: 1, armour: { mm: 10, mat: 'steel' }, mods: crew('driver', 'commander', 'gunner', 'radio', 'gunner', 'gunner') }));
  add('deckhouseL', null, kit({ cat: 'shSuper', place: 'super', name: 'Deckhouse', w: 14, h: 5, depth: 12, mass: 90, armour: { mm: 8, mat: 'steel' } }));
  add('stealthHouse', null, kit({ cat: 'shSuper', place: 'super', name: 'Stealth Superstructure', w: 30, h: 6, depth: 10, mass: 70, control: 1, stealth: 0.4, mods: crew('driver', 'commander', 'gunner', 'radio') }));
  add('mastLattice', null, kit({ cat: 'shSuper', place: 'mast', name: 'Lattice Mast', w: 3, h: 14, depth: 3, mass: 8 }));
  add('mastPole', null, kit({ cat: 'shSuper', place: 'mast', name: 'Pole Mast', w: 0.6, h: 6, depth: 0.6, mass: 0.6 }));
  add('funnel', null, kit({ cat: 'shSuper', place: 'super', name: 'Funnel', w: 5, h: 6, depth: 4, mass: 12, funnel: true }));
  add('helipad', null, kit({ cat: 'shSuper', place: 'deck', name: 'Helicopter Deck', w: 16, h: 0.4, depth: 14, mass: 25, deck: { hl: 7.5, hw: 6.5 } }));
  add('hangar', null, kit({ cat: 'shSuper', place: 'super', name: 'Helicopter Hangar', w: 12, h: 6, depth: 10, mass: 60, hangar: true }));
  // ---- propulsion (§6.3)
  const inner = { inner: true, flush: true };
  add('dieselS', null, kit({ cat: 'shDrive', place: 'inside', name: 'Small Marine Diesel', w: 1.6, h: 1.0, depth: 0.9, mass: 1.2, module: 'engine', engine: { kw: 300, fuel: 'diesel' }, ...inner }));
  add('turbine', null, kit({ cat: 'shDrive', place: 'inside', name: 'Gas Turbine', w: 8, h: 3, depth: 3, mass: 22, module: 'engine', engine: { kw: 20000, fuel: 'turbine', spool: 15 }, ...inner }));
  add('outboard', null, kit({ cat: 'shDrive', place: 'stern', name: 'Outboard Motor', w: 0.8, h: 1.6, depth: 0.6, mass: 0.35, engine: { kw: 165, fuel: 'petrol', spool: 2 }, screw: { D: 0.36, eta: 0.6 }, steer: 30 }));
  add('screwS', 'screwM', { name: 'Small Propeller', w: 0.3, h: 0.8, depth: 0.8, mass: 0.2, screw: { D: 0.8, eta: 0.58 } });
  add('screwL', 'screwM', { name: 'Large Propeller', w: 1.2, h: 4.5, depth: 4.5, mass: 18, screw: { D: 4.5, eta: 0.68, astern: 0.9 } });
  add('waterjet', null, kit({ cat: 'shDrive', place: 'stern', name: 'Waterjet', w: 3, h: 1.4, depth: 1.4, mass: 4, jet: { D: 1.4, steer: 30, bucket: 0.5 }, ...inner }));
  add('rudderL', 'rudderM', { name: 'Large Rudder', w: 4, h: 5, depth: 0.5, mass: 12, foil: { kind: 'rudder', area: 14, ar: 1.5, n: 'z', max: 35, chord: 4, load: 3000 } });
  add('foilBow', null, kit({ cat: 'shDrive', place: 'bow', name: 'Bow Hydrofoil', w: 2, h: 3.6, depth: 6, mass: 4, foil: { kind: 'foil', n: 'y', area: 7, ar: 5, chord: 1.2, inc: 2, y: -1.6, ride: true, load: 1500 } }));
  add('foilAft', null, kit({ cat: 'shDrive', place: 'keel', name: 'Main Hydrofoil', w: 2.4, h: 3.6, depth: 12, mass: 9, foil: { kind: 'foil', n: 'y', area: 15, ar: 6, chord: 1.6, inc: 2, y: -1.6, ride: true, intake: true, h: 1.6, load: 3500 } }));
  // ---- naval weapons (§6.4): a ring, a gun house and a gun as the ground update's (copies of its own parts' art)
  add('nRingM', 'ringS', { cat: 'shArms', place: 'deck', name: 'Naval Gun Ring', w: 3.4, h: 0.3, depth: 3.4, mass: 3, ring: { rate: 30, cap: 60, stab: 1 } });
  add('nHouse127', 'turretBox', { cat: 'shArms', place: 'ring', name: 'Gun House', w: 5, h: 3, depth: 4.4, mass: 6, control: 1, mods: crew('gunner', 'loader') });
  add('nGun76', 'gun76L', { cat: 'shArms', place: 'front', name: '76 mm Rapid Gun', w: 0.6, h: 5.2, depth: 0.8, mass: 4.5, weapon: { ...PARTS.gun76L.weapon, kind: 'tgun', cal: 76, reload: 0.75, ammo: 80 } });
  add('ciws', null, kit({ cat: 'shArms', place: 'deck', name: 'Close-In Gun', w: 2.2, h: 4.2, depth: 2.2, mass: 6, ciws: { range: 1500, rate: 75, ammo: 1500, reload: 30, yaw: [-150, 150], el: [-25, 85], slew: 115, missiles: true, air: true, drones: true } }));
  add('asm4', null, kit({ cat: 'shArms', place: 'deck', name: 'Quad Anti-ship Missiles', w: 6, h: 2.4, depth: 4.6, mass: 8, weapon: { kind: 'missile', asm: true, ammo: 4, range: 18000, speed: 260, seek: 'sea', dmg: 3000, blast: 12, he: 120, arm: 1 } }));
  add('vls8', null, kit({ cat: 'shArms', place: 'deck', name: 'Vertical Launcher', w: 3.2, h: 2.4, depth: 3.2, mass: 14, weapon: { kind: 'missile', vls: true, ammo: 8, seek: 'radar', range: 12000, speed: 900, boost: 2, dmg: 900, blast: 8, prox: 8, missiles: true }, ...inner }));
  add('torpTube', null, kit({ cat: 'shArms', place: 'edge', name: 'Torpedo Tubes', w: 3.4, h: 0.8, depth: 1.0, mass: 1.2, side: true, weapon: { kind: 'torp', ammo: 3, speed: 22, range: 8000, depth: 6, seek: 'active', cone: 30, acquire: 1500, dmg: 4000, blast: 12 } }));
  add('nRadarAir', null, kit({ cat: 'shArms', place: 'mast', name: 'Air Search Radar', w: 4, h: 1.2, depth: 1.2, mass: 2, searchRadar: { range: 18000, rpm: 15, air: true } }));
  add('nRadarFC', null, kit({ cat: 'shArms', place: 'mast', name: 'Fire-Control Radar', w: 1.2, h: 1.2, depth: 1.2, mass: 1.2, trackRadar: { range: 14000, cone: 0.5, missiles: true, sea: true } }));
  add('nRadarSea', null, kit({ cat: 'shArms', place: 'mast', name: 'Surface Search Radar', w: 2.4, h: 0.6, depth: 0.6, mass: 0.8, searchRadar: { range: 14000, rpm: 24, sea: true, low: true } }));
  add('decoy', null, kit({ cat: 'shArms', place: 'edge', name: 'Decoy Launcher', w: 1.2, h: 1.0, depth: 1.0, mass: 0.8, side: true, weapon: { kind: 'chaff', ammo: 12, flare: true, side: true } }));
  // ---- ship kit (§6.5)
  add('bulkhead', null, kit({ cat: 'shKit', place: 'inside', name: 'Watertight Bulkhead', w: 0.3, h: 2, depth: 2, mass: 1.5, bulkhead: true, ...inner }));
  add('pump', null, kit({ cat: 'shKit', place: 'inside', name: 'Salvage Pump', w: 1.2, h: 1.0, depth: 1.0, mass: 1, pump: 0.15, module: 'engine', ...inner }));
  add('ballast', null, kit({ cat: 'shKit', place: 'inside', name: 'Fuel and Ballast', w: 3, h: 0.8, depth: 2.5, mass: 10, ...inner }));
  add('dcLocker', null, kit({ cat: 'shKit', place: 'inside', name: 'Damage Control Party', w: 2, h: 2, depth: 2, mass: 1.5, mods: crew('dc', 'dc', 'dc', 'dc'), ...inner }));
  add('magazine', null, kit({ cat: 'shKit', place: 'inside', name: 'Shell Magazine', w: 4, h: 2.5, depth: 4, mass: 12, module: 'ammo', store: { rounds: 400 }, ...inner }));
  add('torpDecoy', null, kit({ cat: 'shKit', place: 'stern', name: 'Torpedo Decoy', w: 1.5, h: 0.6, depth: 0.6, mass: 0.4, decoy: { torp: true, ammo: 4, life: 60, p: 0.6 } }));
  if (typeof PART_FAMILIES !== 'undefined') PART_FAMILIES = null; // (the tray's order, worked out again with them in)
})();
