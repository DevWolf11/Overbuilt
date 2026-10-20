'use strict';
// Part catalogue, attachment rules, staging, Δv and part drawing.
// Units: metres, tonnes, kN, seconds, kelvin.

const PART_CATEGORIES = [
  { id: 'command', name: 'Command' },
  { id: 'fuel', name: 'Fuel' },
  { id: 'engine', name: 'Engines' },
  { id: 'coupling', name: 'Coupling' },
  { id: 'aero', name: 'Aero' },
  { id: 'utility', name: 'Utility' },
  { id: 'structure', name: 'Structure' },
  { id: 'cabins', name: 'Cockpits' },
  { id: 'air', name: 'Fuselage' },
  { id: 'wings', name: 'Wings' },
  { id: 'airEng', name: 'Aero engines' },
  { id: 'airGear', name: 'Gear' },
  { id: 'weapons', name: 'Weapons' },
  { id: 'ground', name: 'Ground' },
];

// Vehicle kinds decide where a design launches and how the builder shows it. launchRot is the
// craft's rotation at launch: planes are built and launched nose-right (local +y points east).
const VEHICLE_KINDS = {
  rocket: { id: 'rocket', name: 'Rocket', site: 'pad', launchRot: 0 },
  plane: { id: 'plane', name: 'Plane', site: 'runway', launchRot: -Math.PI / 2 },
  car: { id: 'car', name: 'Car', site: 'runway', launchRot: 0 },
  heli: { id: 'heli', name: 'Helicopter', site: 'helipad', launchRot: 0 },
};

const FUEL_PER_M2 = 0.55; // tonnes of propellant per m² of tank side area
const AMBIENT_T = 290;

function tank(name, w, h, tier, desc) {
  const fuel = +(w * h * FUEL_PER_M2).toFixed(2);
  return { cat: 'fuel', name, w, h, fuel, mass: +(fuel / 9).toFixed(3), shape: 'tank', tier, cost: Math.round(200 + fuel * 600), desc };
}

const PARTS = {
  // ---- command
  pod: { cat: 'command', name: 'Command Pod', w: 2, h: 2, mass: 1.2, control: 3, torque: 25000, shape: 'pod', aero: true, breakSpeed: 12, maxTemp: 2600,
    tier: 0, cost: 6000, crew: 2, desc: 'Two-seat capsule with a reaction wheel and a built-in heat shield.' },
  podSmall: { cat: 'command', name: 'Mini Pod', w: 1, h: 1.25, mass: 0.55, control: 2, torque: 7000, shape: 'pod', aero: true, breakSpeed: 11, maxTemp: 2400,
    tier: 1, cost: 3500, crew: 1, desc: 'A single-seat capsule for slim landers.' },
  probe: { cat: 'command', name: 'Probe Core', w: 1, h: 1, mass: 0.25, control: 1, torque: 6000, shape: 'probe',
    tier: 0, cost: 3000, desc: 'Light uncrewed controller. Weak reaction wheel.' },
  probeL: { cat: 'command', name: 'Probe Core L', w: 2, h: 0.75, mass: 0.45, control: 1, torque: 14000, shape: 'probeL',
    tier: 1, cost: 5000, desc: 'Flat probe core that fits standard 2 m stacks.' },

  // ---- fuel
  tankS: tank('Fuel Tank S', 2, 1, 0, 'Short tank for fine-tuning a stage.'),
  tankM: tank('Fuel Tank M', 2, 2, 0, 'Standard tank.'),
  tankL: tank('Fuel Tank L', 2, 4, 0, 'Long tank for core stages.'),
  tankXL: tank('Fuel Tank XL', 2, 6, 1, 'Extra-long tank. Heavy, but saves separators.'),
  tankThinS: tank('Slim Tank S', 1, 1, 1, 'Tiny tank for probes and landers.'),
  tankThin: tank('Slim Tank', 1, 2, 1, 'Narrow tank for landers and boosters.'),
  tankThinL: tank('Slim Tank L', 1, 4, 1, 'Long narrow tank for side boosters.'),
  tankWide: tank('Wide Tank', 3, 3, 2, 'Heavy tank sized for the Titan.'),
  tankWideL: tank('Wide Tank L', 3, 6, 2, 'The biggest tank. Fill it, then add more engines.'),

  // ---- engines
  hawk: { cat: 'engine', name: 'Hawk', w: 2, h: 2, mass: 1.4, thrust: 200, ispSL: 250, ispVac: 290, gimbal: 0.07, shape: 'engine', plume: 'kero',
    mount: 0.34, bellTop: 0.36, bellBot: 0.86, tier: 0, cost: 8000, maxTemp: 2300, desc: 'Reliable first-stage engine. Strong at sea level.' },
  titan: { cat: 'engine', name: 'Titan', w: 3, h: 3, mass: 3.6, thrust: 520, ispSL: 260, ispVac: 300, gimbal: 0.06, shape: 'engine', plume: 'kero',
    mount: 0.3, bellTop: 0.34, bellBot: 0.9, tier: 2, cost: 20000, maxTemp: 2300, desc: 'Heavy lifter for big rockets.' },
  valiant: { cat: 'engine', name: 'Valiant', w: 2, h: 1.5, mass: 0.55, thrust: 50, ispSL: 190, ispVac: 345, gimbal: 0.08, shape: 'engine', plume: 'hydro',
    mount: 0.28, bellTop: 0.3, bellBot: 1.0, tier: 1, cost: 6000, maxTemp: 2300, desc: 'Vacuum engine. Weak in the air, very efficient in space.' },
  kolibri: { cat: 'engine', name: 'Kolibri', w: 1, h: 1, mass: 0.12, thrust: 12, ispSL: 230, ispVac: 315, gimbal: 0.1, shape: 'engine', plume: 'hydro',
    mount: 0.35, bellTop: 0.4, bellBot: 0.9, tier: 1, cost: 1500, maxTemp: 2300, desc: 'Tiny engine for landers and probes.' },
  spire: { cat: 'engine', name: 'Spire Aerospike', w: 2, h: 1.5, mass: 1.2, thrust: 130, ispSL: 300, ispVac: 325, gimbal: 0.05, shape: 'spike', plume: 'spike',
    mount: 0.3, tier: 2, cost: 15000, maxTemp: 2300, desc: 'Keeps its efficiency at every altitude. Great for single-stage landers.' },
  prometheus: { cat: 'engine', name: 'Prometheus', w: 2, h: 3, mass: 3.0, thrust: 70, ispSL: 280, ispVac: 850, gimbal: 0.04, shape: 'engine', style: 'nuclear', plume: 'nuclear',
    mount: 0.48, bellTop: 0.3, bellBot: 0.8, tier: 3, cost: 30000, maxTemp: 2500, desc: 'Nuclear thermal engine. Heavy, gentle, and astonishingly efficient.' },
  whisper: { cat: 'engine', name: 'Whisper Ion', w: 1, h: 0.75, mass: 0.25, thrust: 6, ispSL: 120, ispVac: 3000, gimbal: 0.12, shape: 'ion', plume: 'ion',
    tier: 4, cost: 20000, maxTemp: 1800, desc: 'Ion drive. Feeble push, enormous range. Use physics warp for long burns.' },
  spark: { cat: 'engine', name: 'Spark SRB', w: 1, h: 4, mass: 0.35, thrust: 140, ispSL: 200, ispVac: 225, gimbal: 0, shape: 'srb', plume: 'solid', solid: true,
    fuel: 2.0, tier: 0, cost: 2500, maxTemp: 2100, desc: 'Solid rocket booster. Cheap and punchy, but once lit it burns to the end.' },
  thunder: { cat: 'engine', name: 'Thunder SRB', w: 1.5, h: 8, mass: 0.9, thrust: 420, ispSL: 210, ispVac: 235, gimbal: 0, shape: 'srb', plume: 'solid', solid: true,
    fuel: 6.5, tier: 2, cost: 7000, maxTemp: 2100, desc: 'Heavy solid booster for big launches. Cannot be throttled or shut down.' },

  // ---- coupling
  separator: { cat: 'coupling', name: 'Separator', w: 2, h: 0.5, mass: 0.08, separator: true, shape: 'sep', tier: 0, cost: 400,
    desc: 'Splits the rocket in two. Stays attached to the part that falls away.' },
  separatorS: { cat: 'coupling', name: 'Separator S', w: 1, h: 0.5, mass: 0.04, separator: true, shape: 'sep', tier: 1, cost: 250,
    desc: 'Separator for 1 m stacks.' },
  separatorL: { cat: 'coupling', name: 'Separator L', w: 3, h: 0.5, mass: 0.14, separator: true, shape: 'sep', tier: 2, cost: 600,
    desc: 'Separator for 3 m stacks.' },
  sideSep: { cat: 'coupling', name: 'Side Separator', w: 0.5, h: 2, mass: 0.06, separator: true, side: true, shape: 'sep', tier: 1, cost: 350,
    desc: 'Attach boosters to the side of a stage.' },

  // ---- aero
  nose: { cat: 'aero', name: 'Nose Cone', w: 2, h: 1.5, mass: 0.08, aero: true, shape: 'nose', tier: 0, cost: 300, desc: 'Cuts drag when it leads the way.' },
  noseS: { cat: 'aero', name: 'Nose Cone S', w: 1, h: 1, mass: 0.04, aero: true, shape: 'nose', tier: 0, cost: 150, desc: 'Small cone for boosters and probes.' },
  noseL: { cat: 'aero', name: 'Nose Cone L', w: 3, h: 2, mass: 0.15, aero: true, shape: 'nose', tier: 2, cost: 500, desc: 'Cone for heavy 3 m rockets.' },
  fin: { cat: 'aero', name: 'Fin', w: 0.75, h: 1.5, mass: 0.05, fin: true, shape: 'fin', tier: 0, cost: 250,
    desc: 'Mount low on the sides to keep the rocket pointing where it flies.' },
  heatShield: { cat: 'aero', name: 'Heat Shield', w: 2, h: 0.5, mass: 0.3, heatShield: true, shape: 'shield', maxTemp: 4200, breakSpeed: 12, tier: 1, cost: 1500,
    desc: 'Lead with it on reentry. Fast returns from the Moon or planets need one.' },
  heatShieldL: { cat: 'aero', name: 'Heat Shield L', w: 3, h: 0.5, mass: 0.45, heatShield: true, shape: 'shield', maxTemp: 4200, breakSpeed: 12, tier: 2, cost: 2200,
    desc: 'Heat shield for 3 m craft.' },

  // ---- utility
  chute: { cat: 'utility', name: 'Parachute', w: 1, h: 0.5, mass: 0.1, chute: true, chuteArea: 1, shape: 'chute', maxTemp: 1700, tier: 0, cost: 800,
    desc: 'Opens below 250 m/s in Earth\u2019s air (faster in thin air). A drogue first, the main canopy near the ground.' },
  chuteL: { cat: 'utility', name: 'Heavy Parachute', w: 2, h: 0.5, mass: 0.25, chute: true, chuteArea: 2.6, shape: 'chute', maxTemp: 1700, tier: 2, cost: 1600,
    desc: 'Big canopy for heavy landers.' },
  leg: { cat: 'utility', name: 'Landing Leg', w: 0.5, h: 3, mass: 0.08, leg: true, breakSpeed: 16, shape: 'leg', tier: 1, cost: 600,
    desc: 'Mount on a side. Absorbs harder touchdowns.' },
  wheel: { cat: 'utility', name: 'Rover Wheel', w: 1, h: 1, mass: 0.1, wheel: { r: 0.45, drive: true, speed: 12, accel: 2.5, track: 2 }, breakSpeed: 14, shape: 'wheel', tier: 3, cost: 1200,
    desc: 'Mount under a chassis. On the ground, W/S drive and A/D steer.' },
  rcs: { cat: 'utility', name: 'RCS Block', w: 0.5, h: 0.75, mass: 0.05, torque: 9000, shape: 'rcs', tier: 2, cost: 1200,
    desc: 'Side-mounted thrusters. Extra turning power for big rockets.' },

  // ---- structure
  girder: { cat: 'structure', name: 'Girder', w: 0.5, h: 4, mass: 0.12, shape: 'girder', tier: 1, cost: 300, desc: 'Light lattice beam for building outward.' },
  adapter: { cat: 'structure', name: 'Adapter 2–1', w: 2, h: 1, topW: 1, mass: 0.08, shape: 'adapter', tier: 1, cost: 300, desc: 'Narrows a 2 m stack to 1 m.' },
  adapterL: { cat: 'structure', name: 'Adapter 3–2', w: 3, h: 1, topW: 2, mass: 0.12, shape: 'adapter', tier: 2, cost: 400, desc: 'Narrows a 3 m stack to 2 m.' },

  // ---- aircraft. Planes are built nose-right: the stack runs along local +y (the nose) and the
  // landing gear hangs on the local +x side, which is down once the plane sits on the runway.
  // The blueprint is a side view, so a wing part is the wing's cross-section: `span` is how far it
  // reaches across (shown in 3D), `area` its lifting area. Wings and tail surfaces may pass through
  // the fuselage they are mounted on; twin parts (twinZ) are a pair, one on each side.
  // Wing fields: sweep (rad), taper (tip chord lost, 0..1), stall (rad), mcrit (Mach where wave drag
  // starts), load (strength, 1 = about 9 g for a light plane), dihedral (rad), flaps.

  // fuselage
  cockpitS: { cat: 'cabins', name: 'Bush Cockpit', w: 1.5, h: 2, mass: 0.45, control: 3, torque: 1500, crew: 1, shape: 'cockpit', aero: true, breakSpeed: 11,
    tier: 0, cost: 2500, desc: 'Small cockpit for light planes and gliders.' },
  cockpit: { cat: 'cabins', name: 'Cockpit', w: 2, h: 2.5, mass: 0.9, control: 3, torque: 2500, crew: 1, shape: 'cockpit', aero: true, breakSpeed: 12,
    tier: 0, cost: 4500, desc: 'Streamlined plane nose with a bubble canopy on top.' },
  cockpitJet: { cat: 'cabins', name: 'Fighter Nose', w: 1.6, h: 4.2, mass: 0.8, control: 3, torque: 2500, crew: 1, radar: 12000, shape: 'jetnose', aero: true, sharp: true,
    breakSpeed: 12, maxTemp: 2400, tier: 2, cost: 7000, desc: 'Long pointed nose with a bubble canopy. Slips through the sound barrier with less drag.' },
  cockpitAir: { cat: 'cabins', name: 'Airliner Nose', w: 3, h: 3.4, mass: 1.4, control: 3, torque: 4000, crew: 2, shape: 'airnose', aero: true, breakSpeed: 12,
    tier: 1, cost: 6500, desc: 'Flight deck for a wide fuselage.' },
  cockpitTandem: { cat: 'cabins', name: 'Tandem Cockpit', w: 1.7, h: 5.2, mass: 1.0, control: 3, torque: 2800, crew: 2, radar: 10000, shape: 'jetnose',
    canopy: { at: 0.36, len: 0.3, seats: 2 }, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 2, cost: 8000,
    desc: 'Two seats in a row under one long canopy, like a jet trainer. Pointed for speed.' },
  cockpitStealth: { cat: 'cabins', name: 'Stealth Nose', w: 2, h: 4.6, mass: 0.9, control: 3, torque: 2600, crew: 1, radar: 14000, stealth: 0.6, shape: 'jetnose',
    style: 'stealth', facets: 6, canopy: { at: 0.32, len: 0.2, gold: true }, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 4, cost: 14000,
    desc: 'Faceted nose with a gold-tinted canopy. Radar glances off it: build the whole plane stealthy and enemy radars, SAMs and fighters find you much later.' },
  cockpitBomber: { cat: 'cabins', name: 'Glazed Bomber Nose', w: 3, h: 3.6, mass: 1.3, control: 3, torque: 4000, crew: 3, shape: 'glassnose', aero: true, breakSpeed: 12,
    tier: 1, cost: 6000, desc: 'A greenhouse nose for the bomb aimer, with the flight deck behind. Fits a wide fuselage.' },
  cockpitWarbird: { cat: 'cabins', name: 'Warbird Cockpit', w: 2, h: 2.6, mass: 0.7, control: 3, torque: 2200, crew: 1, shape: 'cabin', breakSpeed: 12,
    tier: 1, cost: 4000, desc: 'A fuselage section with a bubble canopy. Put the engine and propeller in front of it, like a WWII fighter.' },
  cockpitHeli: { cat: 'cabins', name: 'Helicopter Bubble', w: 2.4, h: 2.4, mass: 0.5, control: 3, torque: 5000, crew: 2, shape: 'bubble', aero: true, breakSpeed: 10,
    tier: 1, cost: 3500, desc: 'An all-glass cabin with a view all round. Main rotor on top, a tail boom behind and skids underneath.' },
  droneCore: { cat: 'cabins', name: 'Drone Core', w: 1.2, h: 1.4, mass: 0.15, control: 2, torque: 1200, crew: 0, radar: 6000, shape: 'dronecore', depth: 1.2, breakSpeed: 12,
    tier: 2, cost: 3000, desc: 'Remote-control brain with a satellite link: no pilot, no canopy, light and cheap. Put it in a fuselage stack.' },
  radome: { cat: 'air', name: 'Radome', w: 2, h: 2.2, mass: 0.1, shape: 'nose', aero: true, sharp: true, tier: 1, cost: 600, radar: 16000,
    desc: 'Pointed nose cone for a fuselage. Lower drag, especially near Mach 1.' },
  fuselageS: { cat: 'air', name: 'Short Fuselage', w: 2, h: 2, fuel: 1, mass: 0.18, shape: 'fuselage', tier: 0, cost: 1000,
    desc: 'Short plane body with a fuel tank.' },
  fuselage: { cat: 'air', name: 'Fuselage', w: 2, h: 4, fuel: 2, mass: 0.35, shape: 'fuselage', tier: 0, cost: 1800,
    desc: 'Plane body with passenger windows and a fuel tank in its belly.' },
  fuselageL: { cat: 'air', name: 'Long Fuselage', w: 2, h: 8, fuel: 4, mass: 0.7, shape: 'fuselage', tier: 1, cost: 3200,
    desc: 'Long passenger cabin with lots of fuel.' },
  fuselageSlim: { cat: 'air', name: 'Slim Fuselage', w: 1.5, h: 4, fuel: 1.2, mass: 0.22, shape: 'fuselage', tier: 0, cost: 1300,
    desc: 'Narrow body for light planes and gliders.' },
  fuselageW: { cat: 'air', name: 'Wide Fuselage', w: 3, h: 6, fuel: 7, mass: 1.1, shape: 'fuselage', tier: 1, cost: 4500,
    desc: 'Wide-body airliner cabin.' },
  fuselageAd: { cat: 'air', name: 'Fuselage Adapter', w: 3, h: 1.5, topW: 2, mass: 0.12, shape: 'adapter', tier: 1, cost: 500,
    desc: 'Narrows a 3 m fuselage to 2 m towards the nose. Rotate it to narrow towards the tail.' },
  tailconeS: { cat: 'air', name: 'Slim Tail Cone', w: 1.5, h: 2.5, botW: 0.5, mass: 0.1, shape: 'tailcone', aero: true, tier: 0, cost: 300,
    desc: 'Tail cone for a slim fuselage.' },
  tailcone: { cat: 'air', name: 'Tail Cone', w: 2, h: 2.5, botW: 0.7, mass: 0.15, shape: 'tailcone', aero: true, tier: 0, cost: 400,
    desc: 'Tapers the back of a fuselage up towards the tail.' },
  tailconeL: { cat: 'air', name: 'Long Tail Cone', w: 2, h: 4, botW: 0.6, mass: 0.22, shape: 'tailcone', aero: true, tier: 1, cost: 600,
    desc: 'Longer tail: the tail surfaces get more leverage.' },
  tailconeW: { cat: 'air', name: 'Wide Tail Cone', w: 3, h: 4.5, botW: 0.9, mass: 0.35, shape: 'tailcone', aero: true, tier: 1, cost: 800,
    desc: 'Tail cone for a wide fuselage.' },
  fuselageCargo: { cat: 'air', name: 'Cargo Fuselage', w: 3, h: 7, fuel: 3, mass: 1.5, shape: 'fuselage', style: 'cargo', tier: 1, cost: 4000,
    desc: 'Big-bellied freighter hull with a loading ramp at the back. Fits the other 3 m parts.' },
  fuselageTank: { cat: 'air', name: 'Tank Fuselage', w: 2, h: 4, fuel: 3.2, mass: 0.4, shape: 'fuselage', style: 'tank', tier: 0, cost: 1600,
    desc: 'No windows, just fuel: half as much again as a plain fuselage.' },
  fuselageArmor: { cat: 'air', name: 'Armoured Fuselage', w: 2, h: 4, fuel: 1.5, mass: 1.4, armor: 0.6, shape: 'fuselage', style: 'armor', breakSpeed: 16, tier: 2, cost: 5000,
    desc: 'A titanium tub: shrugs off 60% of gunfire and blast damage, and takes hard landings well. Heavy.' },
  fuselageStealth: { cat: 'air', name: 'Stealth Fuselage', w: 2, h: 5, fuel: 2.5, mass: 0.5, stealth: 0.6, facets: 6, shape: 'fuselage', style: 'stealth', tier: 4, cost: 9000,
    desc: 'Faceted, radar-absorbing body. The more of the plane is stealthy, the later enemies find you; bombs and missiles hung outside spoil it.' },
  fuselageIntake: { cat: 'air', name: 'Intake Fuselage', w: 2, h: 3.5, fuel: 1.6, mass: 0.4, shape: 'fuselage', style: 'intake', tier: 2, cost: 2500,
    desc: 'A fuselage with an air intake on each cheek: the classic jet look. Put it ahead of the jet engine.' },
  tailBoom: { cat: 'air', name: 'Tail Boom', w: 0.7, h: 5, mass: 0.12, shape: 'fuselage', style: 'boom', tier: 0, cost: 500,
    desc: 'A slim tube to carry a tail: for helicopters (tail rotor at the end) and twin-boom planes.' },
  fuselageAdS: { cat: 'air', name: 'Slim Adapter', w: 2, h: 1, topW: 1.5, mass: 0.06, shape: 'adapter', tier: 0, cost: 300,
    desc: 'Narrows a 2 m fuselage to a slim 1.5 m one. Rotate it to narrow the other way.' },
  rotodome: { cat: 'air', name: 'Radar Rotodome', w: 1.7, h: 5, mass: 0.9, radar: 45000, shape: 'rotodome', tier: 3, cost: 12000,
    desc: 'Spinning early-warning radar on a pylon. Mount it on top of the fuselage: radar missiles reach their full range and the HUD shows targets three times further away.' },

  // wings and tails
  wingS: { cat: 'wings', name: 'Small Wing', w: 0.35, h: 1.75, mass: 0.15, shape: 'wing', wing: { area: 7, span: 5, flaps: true, vne: 120 }, breakSpeed: 14, tier: 0, cost: 700,
    desc: 'Short wing with ailerons and flaps, for small planes or a canard.' },
  wing: { cat: 'wings', name: 'Wing', w: 0.5, h: 3, mass: 0.4, shape: 'wing', wing: { area: 30, span: 13, flaps: true, vne: 125 }, breakSpeed: 14, tier: 0, cost: 1500,
    desc: 'Main wing with ailerons and flaps (one part is the whole span). Put it through the fuselage near the centre of mass, high, low or in the middle. It stalls if the nose is pulled too high.' },
  wingL: { cat: 'wings', name: 'Large Wing', w: 0.8, h: 5, mass: 1.6, fuel: 3, shape: 'wing', wing: { area: 75, span: 28, flaps: true, sweep: 0.42, taper: 0.62, mcrit: 0.82, load: 1.1, vne: 200 },
    breakSpeed: 14, tier: 1, cost: 4500, desc: 'Long, gently swept airliner wing with flaps and fuel tanks inside.' },
  wingSwept: { cat: 'wings', name: 'Swept Wing', w: 0.45, h: 4, mass: 0.6, shape: 'wing', wing: { area: 32, span: 11, sweep: 0.6, taper: 0.55, mcrit: 0.9, load: 1.4, flaps: true, vne: 390 },
    breakSpeed: 14, tier: 2, cost: 3500, desc: 'Swept back for fast jets: less drag near Mach 1, but it needs more speed to lift.' },
  wingDelta: { cat: 'wings', name: 'Delta Wing', w: 0.5, h: 7, mass: 1.1, fuel: 1.5, shape: 'wing',
    wing: { area: 48, span: 9.5, sweep: 1, taper: 0.92, slope: 2.6, stall: 0.55, mcrit: 0.95, wave: 0.5, load: 1.8, dihedral: 0, vne: 520 },
    breakSpeed: 14, tier: 2, cost: 5000, desc: 'Big triangle for supersonic fighters. Hard to stall, little wave drag, but sluggish at low speed.' },
  wingGlider: { cat: 'wings', name: 'Glider Wing', w: 0.25, h: 1.4, mass: 0.25, shape: 'wing', wing: { area: 21, span: 19, taper: 0.5, load: 0.6, dihedral: 0.09, vne: 72 },
    breakSpeed: 12, tier: 0, cost: 1800, desc: 'Very long, thin wing: hardly any drag, so it glides for miles. Fragile at high speed.' },
  stabilizer: { cat: 'wings', name: 'Tailplane', w: 0.3, h: 1.8, mass: 0.12, shape: 'wing', wing: { area: 6, span: 6, vne: 600 }, breakSpeed: 14, tier: 0, cost: 500,
    desc: 'Fixed horizontal tail: keeps the nose steady. Pair it with an elevator to pitch.' },
  elevator: { cat: 'wings', name: 'Elevator', w: 0.3, h: 1.5, mass: 0.12, shape: 'elevator', wing: { area: 5, span: 5, control: 0.35 }, breakSpeed: 14, tier: 0, cost: 900,
    desc: 'Moving tail surface. The stick (W/S) and the autopilot pitch the plane with it, and it helps roll too. Put it far behind the centre of mass.' },
  elevatorL: { cat: 'wings', name: 'Large Elevator', w: 0.35, h: 2.2, mass: 0.25, shape: 'elevator', wing: { area: 11, span: 9, control: 0.35 }, breakSpeed: 14, tier: 1, cost: 1500,
    desc: 'All-moving tail for big planes.' },
  canard: { cat: 'wings', name: 'Canard', w: 0.25, h: 1.2, mass: 0.08, shape: 'elevator', wing: { area: 3, span: 4, control: 0.3 }, breakSpeed: 14, tier: 1, cost: 900,
    desc: 'Small moving foreplane near the nose. Twitchy and fun.' },
  vtailS: { cat: 'wings', name: 'Small Tail Fin', w: 1.1, h: 1.5, mass: 0.05, shape: 'vtail', tier: 0, cost: 250,
    desc: 'Tail fin with a rudder for light planes.' },
  vtail: { cat: 'wings', name: 'Vertical Tail', w: 1.6, h: 2.2, mass: 0.1, shape: 'vtail', tier: 0, cost: 400,
    desc: 'Tail fin with a rudder (Q/E). Keeps a plane pointing into the wind. Mount it on top of the tail.' },
  vtailL: { cat: 'wings', name: 'Large Tail Fin', w: 2.4, h: 3.4, mass: 0.25, shape: 'vtail', tier: 1, cost: 800,
    desc: 'Big fin for airliners.' },
  vtailTwin: { cat: 'wings', name: 'Twin Tail Fins', w: 1.6, h: 2.2, mass: 0.2, shape: 'vtail', twinZ: 1.4, tier: 2, cost: 900,
    desc: 'A pair of fins, one each side, like a fighter jet.' },
  airbrake: { cat: 'wings', name: 'Air Brake', w: 0.25, h: 1.4, mass: 0.06, shape: 'airbrake', airbrake: 3.5, tier: 1, cost: 700,
    desc: 'Panel on top of the fuselage. Hold B in the air to pop it up and slow down.' },
  wingSwing: { cat: 'wings', name: 'Swing Wing', w: 0.45, h: 3.4, mass: 1.0, shape: 'wing',
    wing: { area: 38, span: 13, swing: [0.25, 1.05], taper: 0.5, mcrit: 0.8, load: 1.5, flaps: true, vne: 420 }, breakSpeed: 14, tier: 3, cost: 8000,
    desc: 'Variable sweep: spread wide for slow flight and landing, folding back by itself as you go faster. The best of both, at a price.' },
  wingForward: { cat: 'wings', name: 'Forward-Swept Wing', w: 0.45, h: 3.6, mass: 0.75, shape: 'wing',
    wing: { area: 30, span: 11, sweep: -0.5, taper: 0.5, stall: 0.38, mcrit: 0.88, load: 1.6, flaps: true, vne: 400 }, breakSpeed: 14, tier: 3, cost: 7000,
    desc: 'Swept forwards: the tips keep flying after the root stalls, so it stays controllable at crazy angles. Its lift sits well ahead of the part: mount it further back.' },
  wingElliptical: { cat: 'wings', name: 'Elliptical Wing', w: 0.4, h: 2.8, mass: 0.45, shape: 'wing',
    wing: { area: 27, span: 11.8, planform: 'ellipse', oswald: 0.97, flaps: true, load: 1.3, vne: 190, dihedral: 0.07 }, breakSpeed: 14, tier: 1, cost: 3000,
    desc: 'The famous curved wing of a WWII fighter: the least drag for its lift, and a lovely shape.' },
  wingBiplane: { cat: 'wings', name: 'Biplane Wings', w: 2.2, h: 1.7, mass: 0.6, shape: 'biplane',
    wing: { area: 40, span: 10, ar: 5, gap: 1.7, thick: 0.22, stall: 0.32, oswald: 0.62, cd0: 0.03, load: 2.2, vne: 85, dihedral: 0.05 }, breakSpeed: 14, tier: 0, cost: 2200,
    desc: 'Two wings braced with struts and wires: lots of lift and very strong, but draggy. Slow and stately, or loopy and aerobatic.' },
  wingStraightL: { cat: 'wings', name: 'Long Straight Wing', w: 0.6, h: 3.4, mass: 0.9, fuel: 1.5, shape: 'wing',
    wing: { area: 55, span: 30, taper: 0.4, flaps: true, load: 1.2, vne: 150, dihedral: 0.05 }, breakSpeed: 14, tier: 1, cost: 3200,
    desc: 'Long, slender wing for transports and turboprops: lifts a lot at low speed and sips fuel.' },
  wingWinglet: { cat: 'wings', name: 'Winglet Wing', w: 0.8, h: 5, mass: 1.7, fuel: 3, shape: 'wing',
    wing: { area: 75, span: 29, sweep: 0.45, taper: 0.65, mcrit: 0.84, load: 1.1, oswald: 0.92, winglets: true, flaps: true, vne: 210 }, breakSpeed: 14, tier: 2, cost: 6000,
    desc: 'Modern airliner wing with upturned winglets at the tips: less drag, longer range.' },
  wingStrake: { cat: 'wings', name: 'Strakes', w: 0.18, h: 3, mass: 0.06, shape: 'wing',
    wing: { area: 5, span: 4, sweep: 1.3, taper: 0.95, slope: 1.6, stall: 0.9, mcrit: 0.95, wave: 0.4, load: 2, vne: 600 }, breakSpeed: 14, tier: 3, cost: 2500,
    desc: 'Knife-thin extensions ahead of the wing root. They keep lifting long after the wing stalls: for wild high-angle flying.' },
  stabilizerL: { cat: 'wings', name: 'Large Tailplane', w: 0.35, h: 2.4, mass: 0.25, shape: 'wing', wing: { area: 13, span: 10, vne: 600 }, breakSpeed: 14, tier: 1, cost: 900,
    desc: 'Big fixed tail for heavy planes.' },
  vtailV: { cat: 'wings', name: 'V-Tail', w: 0.3, h: 1.7, mass: 0.18, shape: 'elevator', wing: { area: 9, span: 6, control: 0.35, dihedral: 0.62 }, breakSpeed: 14, tier: 2, cost: 1600,
    desc: 'Two tail surfaces in a V: they pitch and yaw the plane at once, so it needs no separate fin or elevator. Less drag, more style.' },

  // aero engines
  propS: { cat: 'airEng', name: 'Small Propeller', w: 1.9, h: 0.7, mass: 0.15, thrust: 14, ispSL: 3400, ispVac: 3400, gimbal: 0, air: { kind: 'prop', v0: 40 }, blades: 2,
    shape: 'prop', plume: 'none', aero: true, breakSpeed: 9, maxTemp: 1500, tier: 0, cost: 1800, desc: 'Little two-blade engine for light planes.' },
  propeller: { cat: 'airEng', name: 'Propeller', w: 2.6, h: 0.9, mass: 0.35, thrust: 34, ispSL: 3200, ispVac: 3200, gimbal: 0, air: { kind: 'prop', v0: 45 },
    shape: 'prop', plume: 'none', aero: true, breakSpeed: 10, maxTemp: 1500, tier: 0, cost: 4000,
    desc: 'Piston engine and propeller. Mount it on the nose. Needs air, and pulls hardest at low speed.' },
  propL: { cat: 'airEng', name: 'Radial Engine', w: 3.4, h: 1.3, mass: 0.8, thrust: 62, ispSL: 3000, ispVac: 3000, gimbal: 0, air: { kind: 'prop', v0: 70 }, blades: 4,
    shape: 'prop', plume: 'none', aero: true, breakSpeed: 10, maxTemp: 1500, tier: 1, cost: 6500, desc: 'Big four-blade warbird engine. Lots of torque: the plane wants to roll.' },
  turboprop: { cat: 'airEng', name: 'Turboprop', w: 3.6, h: 1.8, mass: 0.7, thrust: 70, ispSL: 5200, ispVac: 5200, gimbal: 0, air: { kind: 'prop', v0: 95 }, blades: 5,
    shape: 'prop', plume: 'none', aero: true, breakSpeed: 10, maxTemp: 1600, tier: 2, cost: 9000, desc: 'Gas turbine driving a five-blade prop: fast, frugal and strong.' },
  pusher: { cat: 'airEng', name: 'Pusher Propeller', w: 2.6, h: 0.9, mass: 0.35, thrust: 32, ispSL: 3200, ispVac: 3200, gimbal: 0, air: { kind: 'prop', v0: 45 }, pusher: true,
    shape: 'prop', plume: 'none', breakSpeed: 10, maxTemp: 1500, tier: 1, cost: 4000, desc: 'Propeller that faces backwards: mount it on the tail end and it pushes.' },
  propTwin: { cat: 'airEng', name: 'Twin Wing Props', w: 2.6, h: 1.6, mass: 0.9, thrust: 64, ispSL: 3200, ispVac: 3200, gimbal: 0, air: { kind: 'prop', v0: 55 },
    twinZ: 3.2, pod: true, shape: 'prop', plume: 'none', aero: true, breakSpeed: 10, maxTemp: 1500, tier: 1, cost: 8000,
    desc: 'Two propeller engines in nacelles, one on each wing. Drop them onto a wing.' },
  jetS: { cat: 'airEng', name: 'Small Turbojet', w: 1, h: 2.2, mass: 0.45, thrust: 45, ispSL: 4000, ispVac: 4000, gimbal: 0, air: { kind: 'jet', vmax: 550 },
    shape: 'jet', plume: 'jet', maxTemp: 2000, tier: 1, cost: 6000, desc: 'Compact jet for light fast planes.' },
  jet: { cat: 'airEng', name: 'Turbojet', w: 1.5, h: 3, mass: 1.1, thrust: 110, ispSL: 4200, ispVac: 4200, gimbal: 0.02, air: { kind: 'jet', vmax: 650 },
    shape: 'jet', plume: 'jet', maxTemp: 2000, tier: 2, cost: 12000,
    desc: 'Air-breathing jet for fast planes. Thrust grows with speed up to about Mach 2, but it flames out in thin air.' },
  jetAB: { cat: 'airEng', name: 'Afterburning Turbojet', w: 1.8, h: 4, mass: 1.6, thrust: 135, ispSL: 4000, ispVac: 4000, gimbal: 0.03, air: { kind: 'jet', vmax: 1100, ab: 1.75 },
    shape: 'jet', plume: 'jet', maxTemp: 2200, tier: 3, cost: 18000, desc: 'Above 90% throttle the afterburner lights: much more thrust, much more fuel. Mach 2 and beyond.' },
  jetPods: { cat: 'airEng', name: 'Twin Jet Pods', w: 1.2, h: 2.6, mass: 1, thrust: 90, ispSL: 4000, ispVac: 4000, gimbal: 0, air: { kind: 'jet', vmax: 600 },
    twinZ: 2.8, pod: true, shape: 'jet', plume: 'jet', maxTemp: 2000, tier: 1, cost: 11000, desc: 'Two small jets in pods under the wings. Drop them onto a wing.' },
  turbofan: { cat: 'airEng', name: 'Turbofan', w: 2.4, h: 3.2, mass: 1.5, thrust: 150, ispSL: 9000, ispVac: 9000, gimbal: 0, air: { kind: 'fan', vmax: 290 },
    shape: 'jet', plume: 'jet', fan: true, maxTemp: 1900, tier: 2, cost: 14000, desc: 'Big quiet airliner engine: very frugal and strong at take-off, but it runs out of puff near Mach 1.' },
  fanPods: { cat: 'airEng', name: 'Twin Turbofan Pods', w: 2.2, h: 3.4, mass: 2.6, thrust: 230, ispSL: 8500, ispVac: 8500, gimbal: 0, air: { kind: 'fan', vmax: 290 },
    twinZ: 5.5, pod: true, shape: 'jet', plume: 'jet', fan: true, maxTemp: 1900, tier: 2, cost: 24000, desc: 'A pair of turbofans hanging under the wings. Drop them onto a wing.' },
  jetF: { cat: 'airEng', name: 'Fighter Turbofan', w: 1.6, h: 3.6, mass: 1.3, thrust: 125, ispSL: 5200, ispVac: 5200, gimbal: 0.02, air: { kind: 'jet', vmax: 900, ab: 1.6 },
    shape: 'jet', plume: 'jet', maxTemp: 2200, tier: 3, cost: 20000, desc: 'Modern fighter engine: frugal at cruise, afterburner above 90% throttle. Mach 1.8 with ease.' },
  jetTV: { cat: 'airEng', name: 'Thrust-Vectoring Jet', w: 1.7, h: 3.8, mass: 1.5, thrust: 130, ispSL: 4800, ispVac: 4800, gimbal: 0.3, vector: true, air: { kind: 'jet', vmax: 950, ab: 1.6 },
    shape: 'jet', plume: 'jet', maxTemp: 2200, tier: 4, cost: 30000, desc: 'Its nozzle swivels with the stick, so the plane turns even when the wings have stalled. Afterburner above 90%.' },
  ramjet: { cat: 'airEng', name: 'Ramjet', w: 1.3, h: 4.4, mass: 0.6, thrust: 180, ispSL: 3500, ispVac: 3500, gimbal: 0, air: { kind: 'ram', vmin: 260, vmax: 1100 },
    shape: 'jet', plume: 'jet', maxTemp: 2600, tier: 3, cost: 15000, desc: 'No moving parts and huge thrust, but only above about 950 km/h. Get there on another engine first.' },
  jato: { cat: 'airEng', name: 'JATO Booster', w: 0.6, h: 2, mass: 0.08, fuel: 0.22, thrust: 45, ispSL: 200, ispVac: 210, gimbal: 0, shape: 'srb', plume: 'solid', solid: true,
    tier: 0, cost: 900, maxTemp: 2000, desc: 'Strap-on rocket for a short take-off or a glider launch. Burns for about ten seconds.' },
  propContra: { cat: 'airEng', name: 'Contra-Rotating Prop', w: 3.4, h: 1.8, mass: 1.0, thrust: 85, ispSL: 3000, ispVac: 3000, gimbal: 0, air: { kind: 'prop', v0: 80 }, blades: 3,
    contra: true, shape: 'prop', plume: 'none', aero: true, breakSpeed: 10, maxTemp: 1600, tier: 3, cost: 12000,
    desc: 'Two propellers spinning opposite ways: huge power with no torque roll at all.' },
  propV12: { cat: 'airEng', name: 'V12 Inline Engine', w: 3, h: 1.6, mass: 0.6, thrust: 50, ispSL: 3100, ispVac: 3100, gimbal: 0, air: { kind: 'prop', v0: 75 }, blades: 3,
    spinner: 'long', shape: 'prop', plume: 'none', aero: true, breakSpeed: 10, maxTemp: 1500, tier: 1, cost: 6000,
    desc: 'A sleek liquid-cooled V12 behind a pointed spinner, as in the fastest piston fighters. Pairs well with the Warbird Cockpit.' },
  ductedFan: { cat: 'airEng', name: 'Ducted Fan', w: 2.2, h: 1.6, mass: 0.45, thrust: 40, ispSL: 3600, ispVac: 3600, gimbal: 0, air: { kind: 'prop', v0: 85 }, blades: 7,
    duct: true, shape: 'prop', plume: 'none', aero: true, breakSpeed: 10, maxTemp: 1500, tier: 2, cost: 7000,
    desc: 'A many-bladed fan inside a ring: quieter, and better at speed than an open propeller.' },
  electric: { cat: 'airEng', name: 'Electric Motor', w: 2.2, h: 1.1, mass: 0.2, fuel: 0.06, battery: true, thrust: 24, ispSL: 60000, ispVac: 60000, gimbal: 0,
    air: { kind: 'prop', v0: 45 }, blades: 2, style: 'electric', shape: 'prop', plume: 'none', aero: true, breakSpeed: 9, maxTemp: 1400, tier: 2, cost: 5000,
    desc: 'A silent motor with its own battery, good for about 20 minutes at full power. Needs no fuel tank.' },
  turbofanHB: { cat: 'airEng', name: 'Geared Turbofan', w: 3.2, h: 4.2, mass: 2.8, thrust: 290, ispSL: 11000, ispVac: 11000, gimbal: 0, air: { kind: 'fan', vmax: 285 },
    shape: 'jet', plume: 'jet', fan: true, maxTemp: 1900, tier: 3, cost: 26000, desc: 'The biggest, most frugal fan: for long-haul airliners and heavy lifters.' },
  fanPodsL: { cat: 'airEng', name: 'Twin Geared Turbofan Pods', w: 3, h: 4.4, mass: 5, thrust: 540, ispSL: 10500, ispVac: 10500, gimbal: 0, air: { kind: 'fan', vmax: 285 },
    twinZ: 7, pod: true, shape: 'jet', plume: 'jet', fan: true, maxTemp: 1900, tier: 3, cost: 48000,
    desc: 'A pair of giant turbofans for the wings of a big airliner. Drop them onto a wing.' },
  scramjet: { cat: 'airEng', name: 'Scramjet', w: 1.4, h: 5, mass: 0.9, thrust: 240, ispSL: 2600, ispVac: 2600, gimbal: 0, air: { kind: 'ram', vmin: 900, vmax: 2300 },
    shape: 'jet', style: 'scram', plume: 'jet', maxTemp: 3400, tier: 4, cost: 40000,
    desc: 'Supersonic-combustion ramjet: dead below Mach 2.7, then it pushes on towards Mach 7. Get up to speed on a ramjet or rocket first, and watch the heat.' },
  pulsejet: { cat: 'airEng', name: 'Pulsejet', w: 0.7, h: 3.4, mass: 0.16, thrust: 28, ispSL: 1500, ispVac: 1500, gimbal: 0, air: { kind: 'jet', vmax: 230 },
    shape: 'jet', style: 'pulse', plume: 'jet', maxTemp: 1900, tier: 0, cost: 1500, desc: 'A loud, cheap stovepipe with no moving parts. Thirsty, but it works from a standstill.' },
  rocketPlane: { cat: 'airEng', name: 'Rocket Motor', w: 1.3, h: 2, mass: 0.35, thrust: 70, ispSL: 255, ispVac: 310, gimbal: 0.04, shape: 'engine', plume: 'kero',
    mount: 0.35, bellTop: 0.4, bellBot: 0.85, tier: 3, cost: 9000, maxTemp: 2400,
    desc: 'A liquid rocket for X-planes: needs no air, so it goes all the way to space. Drinks fuel at an astonishing rate.' },
  rotor: { cat: 'airEng', name: 'Main Rotor', w: 10, h: 1.2, mass: 0.7, thrust: 80, ispSL: 2600, ispVac: 2600, gimbal: 0, air: { kind: 'rotor', v0: 25, torque: 14000 },
    shape: 'rotor', plume: 'none', breakSpeed: 8, maxTemp: 1500, tier: 1, cost: 9000,
    desc: 'Helicopter rotor and turboshaft. Throttle sets the lift; the stick tilts the craft. Mount it on top of the cabin.' },
  tailRotor: { cat: 'airEng', name: 'Tail Rotor', w: 1.6, h: 1.6, mass: 0.05, shape: 'tailrotor', tier: 1, cost: 800,
    desc: 'Anti-torque rotor for the end of a tail boom. Spins with the main rotor.' },

  // gear and extras
  gearS: { cat: 'airGear', name: 'Small Gear', w: 1, h: 0.7, mass: 0.06, shape: 'gear', wheel: { r: 0.3, drive: false, brake: true, track: 1.4 }, breakSpeed: 6, tier: 0, cost: 500,
    desc: 'Light landing gear for small planes.' },
  gear: { cat: 'airGear', name: 'Landing Gear', w: 1.4, h: 0.9, mass: 0.15, shape: 'gear', wheel: { r: 0.4, drive: false, brake: true, track: 1.8 }, breakSpeed: 7, tier: 0, cost: 800,
    desc: 'Wheel on a sideways strut. Mount it under the fuselage. It rolls freely; hold B to brake.' },
  gearL: { cat: 'airGear', name: 'Heavy Gear', w: 2, h: 1.4, mass: 0.5, shape: 'gear', wheel: { r: 0.6, drive: false, brake: true, track: 2.8 }, breakSpeed: 9, tier: 1, cost: 2000,
    desc: 'Big wheels for heavy planes.' },
  gearR: { cat: 'airGear', name: 'Retractable Gear', w: 1.4, h: 0.9, mass: 0.22, shape: 'gear', wheel: { r: 0.42, drive: false, brake: true, track: 1.8, retract: true }, breakSpeed: 7,
    tier: 1, cost: 1800, desc: 'Folds away in flight (G) to cut drag. Remember to put it down before landing!' },
  gearSR: { cat: 'airGear', name: 'Small Retractable Gear', w: 1, h: 0.7, mass: 0.09, shape: 'gear', wheel: { r: 0.3, drive: false, brake: true, track: 1.4, retract: true }, breakSpeed: 6,
    tier: 1, cost: 900, desc: 'Light gear that folds away (G): for small, fast planes.' },
  gearRL: { cat: 'airGear', name: 'Heavy Retractable Gear', w: 2, h: 1.4, mass: 0.6, shape: 'gear', wheel: { r: 0.6, drive: false, brake: true, track: 2.8, retract: true }, breakSpeed: 9,
    tier: 2, cost: 2600, desc: 'Big wheels that fold away in flight.' },
  gearBogie: { cat: 'airGear', name: 'Airliner Bogie', w: 2.2, h: 2.4, mass: 1.0, shape: 'gear', wheel: { r: 0.55, drive: false, brake: true, track: 3, retract: true, bogie: true },
    breakSpeed: 11, tier: 2, cost: 4000, desc: 'Four-wheel main gear for heavy jets: strong, and it folds away (G).' },
  gearTundra: { cat: 'airGear', name: 'Tundra Tyres', w: 1.6, h: 1.3, mass: 0.25, shape: 'gear', wheel: { r: 0.58, drive: false, brake: true, track: 2.2, fat: true }, breakSpeed: 11,
    tier: 1, cost: 1400, desc: 'Big squashy balloon tyres: they soak up hard landings and rough fields.' },
  skids: { cat: 'airGear', name: 'Landing Skids', w: 1.2, h: 3.2, mass: 0.08, shape: 'skid', twinZ: 1.1, depth: 0.15, breakSpeed: 8, tier: 0, cost: 400,
    desc: 'A pair of tube skids for helicopters: put them under the cabin. They slide rather than roll.' },
  tailWheel: { cat: 'airGear', name: 'Tail Wheel', w: 0.6, h: 0.5, mass: 0.03, shape: 'gear', wheel: { r: 0.2, drive: false, track: 0, caster: true }, breakSpeed: 6, tier: 0, cost: 300,
    desc: 'Little swivelling wheel under the tail, for a taildragger.' },
  floats: { cat: 'airGear', name: 'Floats', w: 1, h: 5, mass: 0.3, shape: 'float', float: true, twinZ: 1.6, aero: true, breakSpeed: 10, tier: 1, cost: 1500,
    desc: 'A pair of pontoons: take off from and land on water. They skid on land.' },
  dropTanks: { cat: 'airGear', name: 'Drop Tanks', w: 0.7, h: 2.6, mass: 0.08, fuel: 1.2, shape: 'droptank', twinZ: 3, pod: true, aero: true, tier: 1, cost: 900,
    desc: 'Extra fuel in a pair of tanks under the wings. Drop them onto a wing.' },
  brakeChute: { cat: 'airGear', name: 'Brake Chute', w: 0.7, h: 0.5, mass: 0.05, chute: true, brakeChute: true, chuteArea: 0.35, shape: 'chute', tier: 1, cost: 600,
    desc: 'Drag chute for short landings: open it (STAGE or tap) after touchdown, below 400 km/h.' },

  smoke: { cat: 'airGear', name: 'Smoke Generator', w: 0.4, h: 1, mass: 0.04, shape: 'smokegen', smoke: true, tier: 0, cost: 300,
    desc: 'Air-show smoke. Tap it in flight to switch the trail on and off.' },

  // ---- weapons. Twin pods drop onto a wing like drop tanks; guns and the heavy bomb go on the fuselage.
  // weapon.ammo counts both pods; each: kg released per round (bombs and missiles get lighter as they go).
  gun: { cat: 'weapons', name: 'Machine Gun', w: 0.35, h: 1.5, mass: 0.07, shape: 'gun', tier: 1, cost: 1500,
    weapon: { kind: 'gun', ammo: 600, rate: 16, speed: 880, dmg: 9, spread: 0.004, each: 0.05 },
    desc: 'Fast-firing gun. Mount it on the fuselage pointing forward. Hold V (or FIRE) to shoot.' },
  cannon: { cat: 'weapons', name: 'Autocannon', w: 0.5, h: 2.4, mass: 0.22, shape: 'gun', calibre: 30, tier: 2, cost: 4500,
    weapon: { kind: 'gun', ammo: 180, rate: 8, speed: 1000, dmg: 34, blast: 3, spread: 0.003, each: 0.4 },
    desc: 'Heavy 30 mm cannon: slower, but every shell explodes. Tears tanks and boats apart.' },
  gunPods: { cat: 'weapons', name: 'Gun Pods', w: 0.55, h: 2.4, mass: 0.2, shape: 'gunpod', twinZ: 2.4, pod: true, aero: true, tier: 1, cost: 3000,
    weapon: { kind: 'gun', ammo: 800, rate: 24, speed: 900, dmg: 9, spread: 0.006, each: 0.05 },
    desc: 'A pair of gun pods for the wings. Drop them onto a wing.' },
  rocketPods: { cat: 'weapons', name: 'Rocket Pods', w: 0.75, h: 2.1, mass: 0.16, shape: 'rocketpod', twinZ: 3.1, pod: true, aero: true, tier: 2, cost: 4000,
    weapon: { kind: 'rocket', ammo: 14, rate: 6, speed: 60, accel: 700, burn: 1.1, dmg: 110, blast: 9, each: 15 },
    desc: 'Fourteen unguided rockets in two pods. Point the nose at the target and ripple them off.' },
  aam: { cat: 'weapons', name: 'Heat-Seeking Missiles', w: 0.45, h: 2.9, mass: 0.04, shape: 'missile', twinZ: 3.6, pod: true, aero: true, tier: 2, cost: 9000,
    weapon: { kind: 'missile', seek: 'air', ammo: 2, range: 5000, cone: 0.35, accel: 260, burn: 3, vmax: 900, turn: 30, dmg: 400, blast: 15, each: 90, life: 18 },
    desc: 'Short-range missiles that home on engine heat: a hot jet seen from behind locks from 5 km, a cold one or one coming at you much closer. The motor burns 3 s, then they coast, so long or low shots run out of energy. Flares fool them, more so if the target throttles back.' },
  radarMissiles: { cat: 'weapons', name: 'Radar Missiles', w: 0.5, h: 3.6, mass: 0.05, shape: 'missile', twinZ: 2.4, pod: true, aero: true, tier: 3, cost: 16000,
    weapon: { kind: 'missile', seek: 'air', radar: true, ammo: 2, range: 15000, cone: 0.6, accel: 240, burn: 5, vmax: 1300, turn: 25, dmg: 450, blast: 16, each: 150, life: 30 },
    desc: 'Long-range missiles that ride your nose radar (a Radome reaches furthest): keep the target in front of you until they hit. A low target flying across your beam (notching), or chaff, can shake them. They set off the target\'s warning.' },
  agm: { cat: 'weapons', name: 'Attack Missiles', w: 0.5, h: 2.8, mass: 0.05, shape: 'missile', agm: true, twinZ: 2.9, pod: true, aero: true, tier: 2, cost: 12000,
    weapon: { kind: 'missile', seek: 'ground', ammo: 2, range: 8000, cone: 0.5, accel: 200, burn: 4, vmax: 700, turn: 18, dmg: 900, blast: 20, each: 200 },
    desc: 'Guided missiles for tanks, boats and buildings. Point at a ground target until it locks.' },
  bombs: { cat: 'weapons', name: 'Bombs', w: 0.75, h: 2.4, mass: 0.04, shape: 'bomb', twinZ: 2.7, pod: true, aero: true, tier: 1, cost: 2500,
    weapon: { kind: 'bomb', ammo: 2, dmg: 1200, blast: 30, each: 250 },
    desc: 'A pair of 250 kg bombs. The bombsight on the HUD shows where they will land.' },
  bombL: { cat: 'weapons', name: 'Heavy Bomb', w: 1.1, h: 3.8, mass: 0.08, shape: 'bomb', aero: true, tier: 3, cost: 6000,
    weapon: { kind: 'bomb', ammo: 1, dmg: 4000, blast: 55, each: 1000 },
    desc: 'One 1-tonne bomb. Hang it under the fuselage.' },
  flares: { cat: 'weapons', name: 'Flares', w: 0.4, h: 0.9, mass: 0.03, shape: 'flares', tier: 2, cost: 1200,
    weapon: { kind: 'flare', ammo: 30, each: 1 },
    desc: 'Hot decoys that pull heat-seeking missiles off you, with a chaff cloud for radar missiles: press K (or CM). Flying solo they also fire on their own when a missile closes in.' },
  gatling: { cat: 'weapons', name: 'Rotary Cannon', w: 0.8, h: 3.2, mass: 0.9, shape: 'gun', barrels: 7, calibre: 30, tier: 3, cost: 12000,
    weapon: { kind: 'gun', ammo: 1100, rate: 60, speed: 1050, dmg: 24, spread: 0.006, each: 0.3 },
    desc: 'Seven spinning barrels: a 30 mm buzz saw for busting tanks. Mount it along the nose.' },
  turret: { cat: 'weapons', name: 'Gun Turret', w: 1, h: 1.4, mass: 0.35, shape: 'turret', tier: 2, cost: 6000,
    weapon: { kind: 'turret', ammo: 800, rate: 12, speed: 900, dmg: 8, spread: 0.006, range: 1100, each: 0.05 },
    desc: 'A defensive turret that aims and fires on its own at enemy fighters and drones within a kilometre. Put it on top of (or under) a bomber.' },
  bombBay: { cat: 'weapons', name: 'Internal Bomb Bay', w: 2, h: 4, mass: 0.55, shape: 'fuselage', style: 'bay', bay: true, stealth: 0.5, tier: 3, cost: 7000,
    weapon: { kind: 'bomb', ammo: 4, dmg: 1200, blast: 30, each: 250 },
    desc: 'A fuselage section with four 250 kg bombs inside: no drag, and a stealth plane stays stealthy.' },
  clusterBombs: { cat: 'weapons', name: 'Cluster Bombs', w: 0.75, h: 2.6, mass: 0.04, shape: 'bomb', style: 'cluster', twinZ: 2.7, pod: true, aero: true, tier: 2, cost: 5000,
    weapon: { kind: 'bomb', cluster: 24, ammo: 2, dmg: 220, blast: 10, each: 300 },
    desc: 'Each one bursts 150 m up and scatters 24 bomblets over a football pitch. For convoys and SAM sites.' },
  glideBombs: { cat: 'weapons', name: 'Guided Glide Bombs', w: 0.7, h: 2.8, mass: 0.04, shape: 'bomb', style: 'guided', twinZ: 2.9, pod: true, aero: true, tier: 3, cost: 11000,
    weapon: { kind: 'missile', seek: 'ground', glide: true, label: 'GBU', ammo: 2, range: 12000, cone: 0.45, accel: 0, burn: 0, vmax: 420, turn: 5, dmg: 1300, blast: 28, each: 250, life: 90 },
    desc: 'Bombs with fins and a seeker: lock a ground target up to 12 km away and let it glide in. Release high and fast.' },
  torpedo: { cat: 'weapons', name: 'Torpedoes', w: 0.7, h: 3.6, mass: 0.04, shape: 'bomb', style: 'torpedo', twinZ: 2.6, pod: true, aero: true, tier: 2, cost: 8000,
    weapon: { kind: 'bomb', torpedo: true, ammo: 2, dmg: 2200, blast: 16, each: 700 },
    desc: 'Drop them low and slow over the sea (under 400 km/h when they hit the water): they swim to the nearest boat or ship.' },
  harm: { cat: 'weapons', name: 'Anti-Radar Missiles', w: 0.5, h: 3.8, mass: 0.05, shape: 'missile', style: 'harm', twinZ: 2.6, pod: true, aero: true, tier: 3, cost: 15000,
    weapon: { kind: 'missile', seek: 'radar', label: 'ARM', ammo: 2, range: 22000, cone: 0.8, accel: 260, burn: 5, vmax: 1400, turn: 20, dmg: 700, blast: 18, each: 360 },
    desc: 'They home on enemy radars (radar stations, SAM sites, AA guns and frigates) from 22 km away.' },
  cruiseMissile: { cat: 'weapons', name: 'Cruise Missile', w: 0.9, h: 5, mass: 0.08, shape: 'missile', style: 'cruise', agm: true, aero: true, tier: 4, cost: 30000,
    weapon: { kind: 'missile', seek: 'ground', label: 'CRUISE', ammo: 1, range: 30000, cone: 0.6, accel: 45, burn: 140, vmax: 270, turn: 10, dmg: 2600, blast: 40, each: 1100, life: 150 },
    desc: 'A one-tonne missile with its own jet engine: lock any ground target up to 30 km away and it flies there by itself. Hang it under the fuselage.' },
  ecm: { cat: 'weapons', name: 'ECM Jammer Pod', w: 0.55, h: 2.6, mass: 0.25, shape: 'ecm', ecm: true, aero: true, tier: 3, cost: 9000,
    desc: 'Jams enemy radars: incoming SAMs often lose you, and AA gunners aim badly. Hang it under the fuselage or a wing.' },

  // ---- ground
  cab: { cat: 'ground', name: 'Driver Cab', w: 2.4, h: 1.5, mass: 0.6, control: 2, torque: 4000, crew: 2, shape: 'cab', depth: 2, aero: true, breakSpeed: 11, tier: 0, cost: 2500,
    desc: 'Two-seat cab for cars and trucks.' },
  chassis: { cat: 'ground', name: 'Chassis', w: 4, h: 0.5, mass: 0.5, shape: 'chassis', depth: 2.2, tier: 0, cost: 800,
    desc: 'Flat car frame. Hang wheels under it and put a cab on top.' },
  chassisL: { cat: 'ground', name: 'Long Chassis', w: 6, h: 0.5, mass: 0.75, shape: 'chassis', depth: 2.4, tier: 1, cost: 1100,
    desc: 'Longer frame for trucks and big rovers.' },
  carWheel: { cat: 'ground', name: 'Car Wheel', w: 1.2, h: 1.2, mass: 0.08, shape: 'wheel', wheel: { r: 0.54, drive: true, speed: 38, accel: 5, track: 2 }, breakSpeed: 16, tier: 0, cost: 600,
    desc: 'Driven road wheel. Mount it under a chassis. W/S drive, A/D steer the front wheels; hold B to brake.' },
};
for (const k in PARTS) {
  const d = PARTS[k];
  d.type = k;
  d.maxTemp = d.maxTemp || 2000;
  if (d.solid) d.cost = d.cost || 2000;
}

// Tech tiers for career mode.
const TIERS = [
  { name: 'Basic rocketry', cost: 0 },
  { name: 'Orbital flight', cost: 20000 },
  { name: 'Heavy lifting', cost: 60000 },
  { name: 'Deep space', cost: 150000 },
  { name: 'Advanced propulsion', cost: 400000 },
];

function partDryKg(def) { return def.mass * 1000; }
function partFuelKg(def) { return (def.fuel || 0) * 1000; }
function partStoreKg(def) { const w = def.weapon; return w ? w.ammo * (w.each || 0) : 0; } // bombs, missiles and rounds on board
function partKg(p) { return p.def.mass * 1000 + p.fuel + (p.store || 0); }

let _partSeq = 1;
function makePart(type, x, y, extra) {
  const def = PARTS[type];
  const p = { id: _partSeq++, type, def, x, y, flip: x < 0, fuel: partFuelKg(def), active: false, deployed: 0, temp: AMBIENT_T };
  if (def.weapon) { p.ammo = def.weapon.ammo; p.store = partStoreKg(def); }
  if (extra) Object.assign(p, extra);
  return p;
}
// Parts turn in 90° steps about their centre: p.rot = 0..3, counterclockwise in part space.
function partDims(p) { const d = p.def; return p.rot & 1 ? { w: d.h, h: d.w } : { w: d.w, h: d.h }; }
// A point given relative to the centre of the unturned part -> part space.
function partPt(p, lx, ly) {
  switch (p.rot & 3) {
    case 1: return { x: p.x - ly, y: p.y + lx };
    case 2: return { x: p.x - lx, y: p.y - ly };
    case 3: return { x: p.x + ly, y: p.y - lx };
    default: return { x: p.x + lx, y: p.y + ly };
  }
}
const PART_AXES = [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }];
// Where the part's own "up" points: engines thrust along it, wings fly along it.
function partAxis(p) { return PART_AXES[p.rot & 3]; }
// A part's mirror image across the stack's axis is turned the other way.
function mirrorRot(k) { return (4 - ((k || 0) & 3)) & 3; }
function partRect(p) {
  const { w, h } = partDims(p);
  return { l: p.x - w / 2, r: p.x + w / 2, b: p.y - h / 2, t: p.y + h / 2 };
}
// Size across the build plane (z): round parts are as deep as they are wide, wings span it.
function partDepth(p) {
  const d = p.def;
  if (d.depth) return d.depth;
  if (d.wing) return d.wing.span;
  if (d.fin || d.shape === 'vtail' || d.shape === 'tailrotor') return 0.15;
  if (d.wheel) return 0.4;
  return d.w;
}

// Wheel centre and radius in part space. Most wheels hang below an upright strut; landing gear
// struts run sideways, with the wheel at the outer end (away from the fuselage).
function wheelGeom(p) {
  const d = p.def, r = d.wheel.r || Math.min(d.w, d.h) * 0.45;
  const c = d.shape === 'gear' ? partPt(p, (p.flip ? -1 : 1) * (d.w / 2 - r), 0) : partPt(p, 0, -d.h * 0.05);
  return { x: c.x, y: c.y, r };
}

// Two parts are attached if they share an edge segment.
function partsTouch(a, b) {
  const A = partRect(a), B = partRect(b), eps = 0.02, minOverlap = 0.1;
  const ox = Math.min(A.r, B.r) - Math.max(A.l, B.l);
  const oy = Math.min(A.t, B.t) - Math.max(A.b, B.b);
  if (ox > minOverlap && (Math.abs(A.t - B.b) < eps || Math.abs(B.t - A.b) < eps)) return true;
  if (oy > minOverlap && (Math.abs(A.r - B.l) < eps || Math.abs(B.r - A.l) < eps)) return true;
  return false;
}
function partsOverlap(a, b) {
  const A = partRect(a), B = partRect(b);
  return Math.min(A.r, B.r) - Math.max(A.l, B.l) > 0.02 && Math.min(A.t, B.t) - Math.max(A.b, B.b) > 0.02;
}
// Wings and tail surfaces are thin plates that may pass through the hull they are mounted on (a mid or
// low wing, a fin on the tail cone), and engine pods and drop tanks hang off wings. So a surface and a
// non-surface may overlap, and overlapping is how they attach; two parts of the same sort may not.
function isSurface(d) { return !!(d.wing || d.shape === 'vtail'); }
// Twin parts sit out to the sides (twinZ), so in the side view they may also overlap the centreline hull.
function partsClash(a, b) {
  if (!!a.def.twinZ !== !!b.def.twinZ) return false;
  return isSurface(a.def) === isSurface(b.def) && partsOverlap(a, b);
}
function partsMounted(a, b) {
  if (isSurface(a.def) === isSurface(b.def)) return false;
  const A = partRect(a), B = partRect(b);
  return Math.min(A.r, B.r) - Math.max(A.l, B.l) > 0.04 && Math.min(A.t, B.t) - Math.max(A.b, B.b) > 0.04;
}

function buildAdjacency(parts) {
  const adj = new Map();
  for (const p of parts) adj.set(p.id, new Set());
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++)
      if (partsTouch(parts[i], parts[j]) || partsMounted(parts[i], parts[j])) { adj.get(parts[i].id).add(parts[j].id); adj.get(parts[j].id).add(parts[i].id); }
  return adj;
}

function componentOf(startId, adj, skip) {
  const seen = new Set([startId]);
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    for (const n of adj.get(id) || []) if (!seen.has(n) && !(skip && skip(n))) { seen.add(n); stack.push(n); }
  }
  return seen;
}

function findControlPart(parts) {
  let best = null;
  for (const p of parts) if (p.def.control && (!best || p.def.control > best.def.control)) best = p;
  return best;
}

function designCost(parts) { return parts.reduce((s, p) => s + (p.def || PARTS[p.type]).cost, 0); }

// Exhaust exit of an engine, in part space relative to the part centre.
function nozzleOf(def) {
  switch (def.shape) {
    case 'srb': return { y: -def.h / 2, half: def.w * 0.36 };
    case 'ion': return { y: -def.h / 2, half: def.w * 0.32 };
    case 'spike': return { y: -def.h / 2, half: def.w * 0.42 };
    case 'jet': return { y: -def.h / 2, half: def.w * 0.28 };
    default: return { y: -def.h / 2, half: (def.w * (def.bellBot || 0.8)) / 2 };
  }
}

// ---------------------------------------------------------------------------
// Staging heuristic.
// Segments are the pieces left after removing separators. The segment with the
// control part is the root; each separator joins a segment to one deeper in the tree.
// Stage 1 ignites every engine at the bottom of its column. Each following stage
// fires the deepest remaining separators and ignites engines that are now exposed.

function computeStages(parts, adj, controlId) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const isSep = (id) => byId.get(id).def.separator;
  const segOf = new Map();
  const segs = [];
  for (const p of parts) {
    if (p.def.separator || segOf.has(p.id)) continue;
    const comp = componentOf(p.id, adj, isSep);
    const idx = segs.length;
    segs.push({ ids: comp, depth: -1, below: [] });
    for (const id of comp) segOf.set(id, idx);
  }
  const root = segOf.get(controlId);
  if (root == null) return [];
  segs[root].depth = 0;
  const seps = [];
  const queue = [root];
  while (queue.length) {
    const si = queue.shift();
    for (const id of segs[si].ids) for (const n of adj.get(id)) {
      if (!isSep(n) || seps.find((s) => s.id === n)) continue;
      const sp = byId.get(n);
      for (const m of adj.get(n)) {
        if (isSep(m)) continue;
        const sj = segOf.get(m);
        if (sj === si || segs[sj].depth >= 0) continue;
        segs[sj].depth = segs[si].depth + 1;
        seps.push({ id: n, far: sj, near: si, depth: segs[sj].depth });
        // a vertical separator hanging under the near segment's engines blocks them until it fires
        if (!sp.def.side && [...segs[si].ids].some((i) => byId.get(i).def.thrust && sp.y < byId.get(i).y)) segs[si].below.push(sj);
        queue.push(sj);
      }
    }
  }
  const attachedSegs = segs.map((s, i) => i).filter((i) => segs[i].depth >= 0);
  const enginesIn = (si) => [...segs[si].ids].map((i) => byId.get(i)).filter((q) => q.def.thrust);
  const stages = [];
  const ignited = new Set();
  const dropped = new Set();
  const exposed = (si) => segs[si].below.every((sj) => dropped.has(sj));
  const igniteExposed = (list) => {
    for (const si of attachedSegs) {
      if (dropped.has(si) || !exposed(si)) continue;
      for (const e of enginesIn(si)) if (!ignited.has(e.id)) { ignited.add(e.id); list.push(e.id); }
    }
  };
  const first = [];
  igniteExposed(first);
  if (first.length) stages.push(first);
  const maxDepth = Math.max(0, ...seps.map((s) => s.depth));
  for (let d = maxDepth; d >= 1; d--) {
    const st = [];
    for (const s of seps) if (s.depth === d) {
      if (!st.includes(s.id)) st.push(s.id);
      const stack = [s.far];
      while (stack.length) {
        const k = stack.pop(); dropped.add(k);
        for (const t of seps) if (t.near === k) stack.push(t.far);
      }
    }
    igniteExposed(st);
    if (st.length) stages.push(st);
  }
  const chutes = parts.filter((p) => p.def.chute && segOf.get(p.id) != null && segs[segOf.get(p.id)].depth >= 0).map((p) => p.id);
  if (chutes.length) stages.push(chutes);
  return stages;
}

function describeStage(ids, byId) {
  const counts = {};
  for (const id of ids) {
    const p = byId.get(id); if (!p) continue;
    const verb = p.def.thrust ? 'Ignite ' + p.def.name : p.def.separator ? 'Separate' : p.def.chute ? 'Deploy parachute' : p.def.name;
    counts[verb] = (counts[verb] || 0) + 1;
  }
  return Object.entries(counts).map(([k, n]) => (n > 1 && !k.startsWith('Separate') ? `${k} ×${n}` : k)).join(' · ') || '—';
}

// Δv estimate by replaying the stage list.
function estimateDeltaV(parts, adj, controlId, stages, useSeaLevel) {
  if (!controlId) return { total: 0, perStage: [], twr: [] };
  const P = parts.map((p) => ({ ...p, fuel: p.fuel }));
  const byId = new Map(P.map((p) => [p.id, p]));
  const A = new Map([...adj].map(([k, v]) => [k, new Set(v)]));
  let attached = componentOf(controlId, A);
  const active = new Set();
  const perStage = [], twr = [];
  let total = 0;
  for (const st of stages) {
    for (const id of st) {
      const p = byId.get(id);
      if (!p || !attached.has(id)) continue;
      if (p.def.thrust && !p.def.air) active.add(id); // air-breathing engines don't count in space
      if (p.def.separator) {
        cutSeparator(id, A, controlId);
        attached = componentOf(controlId, A);
      }
    }
    let dv = 0, firstTwr = 0;
    for (let guard = 0; guard < 24; guard++) {
      const groups = fuelGroups([...attached].map((i) => byId.get(i)), A);
      let F = 0, mdot = 0;
      const burning = [];
      for (const g of groups) {
        const fuel = g.tanks.reduce((s, t) => s + t.fuel, 0);
        const eng = g.engines.filter((e) => active.has(e.id));
        if (fuel <= 1e-6 || !eng.length) continue;
        let gm = 0;
        for (const e of eng) {
          const isp = useSeaLevel ? e.def.ispSL : e.def.ispVac;
          F += e.def.thrust * 1000; gm += e.def.thrust * 1000 / (isp * G0);
        }
        mdot += gm; burning.push({ g, fuel, gm });
      }
      if (!burning.length) break;
      const tBurn = Math.min(...burning.map((b) => b.fuel / b.gm));
      const m0 = [...attached].reduce((s, i) => s + partKg(byId.get(i)), 0);
      if (!firstTwr) firstTwr = F / (m0 * EARTH.surfaceG);
      const m1 = m0 - mdot * tBurn;
      dv += (F / mdot) * Math.log(m0 / m1);
      for (const b of burning) {
        const used = b.gm * tBurn;
        for (const t of b.g.tanks) t.fuel = Math.max(0, t.fuel - used * (t.fuel / b.fuel));
      }
    }
    perStage.push(dv);
    twr.push(firstTwr);
    total += dv;
  }
  return { total, perStage, twr };
}

// Fire a separator: cut its links on the control part's side, so it stays with the piece that falls away.
function cutSeparator(sepId, adj, controlId) {
  for (const n of [...adj.get(sepId)]) {
    adj.get(sepId).delete(n); adj.get(n).delete(sepId);
    if (!componentOf(controlId, adj).has(n)) { adj.get(sepId).add(n); adj.get(n).add(sepId); }
  }
}

// Liquid fuel flows freely inside a segment; separators and solid boosters block it.
// Each solid booster is its own group, burning its own propellant.
function fuelGroups(parts, adj) {
  const ids = new Set(parts.map((p) => p.id));
  const byId = new Map(parts.map((p) => [p.id, p]));
  const seen = new Set();
  const groups = [];
  for (const p of parts) {
    if (seen.has(p.id) || p.def.separator) continue;
    if (p.def.solid) { seen.add(p.id); groups.push({ tanks: [p], engines: [p], solid: true }); continue; }
    if (p.def.battery) { seen.add(p.id); groups.push({ tanks: [p], engines: [p] }); continue; } // an electric motor runs on its own battery
    const comp = componentOf(p.id, adj, (n) => !ids.has(n) || byId.get(n).def.separator || byId.get(n).def.solid || byId.get(n).def.battery);
    const g = { tanks: [], engines: [] };
    for (const id of comp) {
      seen.add(id);
      const q = byId.get(id);
      if (q.def.fuel) g.tanks.push(q);
      if (q.def.thrust) g.engines.push(q);
    }
    groups.push(g);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Drawing. Called with a transform where 1 unit = 1 metre and +y is up.

const PAL = {
  ink: '#1a1f27', steel: '#79828d', steelLight: '#c4cbd3', steelDark: '#4d545d',
  orange: '#ff7a1a', glass: '#7fd8ff', gold: '#d9a441', goldDark: '#a7782a', hazard: '#ffc93c', chuteA: '#ff7a1a', chuteB: '#f3f1ea',
  shield: '#3a2f2a', shieldLight: '#5a4a40', nuclear: '#7dffb0', ion: '#7fb8ff',
};
// With flat = true, parts are painted without fake cylinder shading (used for 3D textures,
// where real lighting does the shading).
const PartPaint = { flat: false };
function darkGradient(ctx, l, r) { // stealth grey
  if (PartPaint.flat) return '#4b5058';
  const g = ctx.createLinearGradient(l, 0, r, 0);
  g.addColorStop(0, '#2d3036'); g.addColorStop(0.45, '#5a5f68'); g.addColorStop(1, '#33373d');
  return g;
}
function tintGradient(ctx, l, r, c) { // hull shading in another colour
  if (PartPaint.flat) return c;
  const k = ctx.createLinearGradient(l, 0, r, 0);
  k.addColorStop(0, shade(c, -0.35)); k.addColorStop(0.4, shade(c, 0.12)); k.addColorStop(1, shade(c, -0.25));
  return k;
}
function shade(hex, k) { // lighten (k > 0) or darken a #rrggbb colour
  const n = parseInt(hex.slice(1), 16), f = (v) => Math.round(clamp(k > 0 ? v + (255 - v) * k : v * (1 + k), 0, 255));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
// Sawtooth panel line across a stealth part.
function sawtooth(ctx, l, r, y, k) {
  ctx.beginPath(); ctx.moveTo(l, y);
  const n = 4, dx = (r - l) / n;
  for (let i = 0; i < n; i++) { ctx.lineTo(l + dx * (i + 0.5), y + k); ctx.lineTo(l + dx * (i + 1), y); }
  ctx.stroke();
}
function hullGradient(ctx, l, r) {
  if (PartPaint.flat) return '#e3e7eb';
  const g = ctx.createLinearGradient(l, 0, r, 0);
  g.addColorStop(0, '#9da6b0'); g.addColorStop(0.3, '#f5f7f9'); g.addColorStop(0.55, '#e6e9ed'); g.addColorStop(1, '#8e97a1');
  return g;
}
function metalGradient(ctx, l, r) {
  if (PartPaint.flat) return '#8d96a0';
  const g = ctx.createLinearGradient(l, 0, r, 0);
  g.addColorStop(0, '#3f454d'); g.addColorStop(0.35, '#b8c0c9'); g.addColorStop(0.6, '#8a939d'); g.addColorStop(1, '#353a41');
  return g;
}
function goldGradient(ctx, l, r) {
  if (PartPaint.flat) return '#d6a243';
  const g = ctx.createLinearGradient(l, 0, r, 0);
  g.addColorStop(0, '#8c6420'); g.addColorStop(0.35, '#f0c35c'); g.addColorStop(0.65, '#d9a441'); g.addColorStop(1, '#7c5718');
  return g;
}

// Airfoil half-thickness (NACA 00xx, 1 at the thickest point); f = 0 at the leading edge.
function foilHalf(f) { return (0.2969 * Math.sqrt(f) - 0.126 * f - 0.3516 * f * f + 0.2843 * f ** 3 - 0.1036 * f ** 4) / 0.1; }

// Wing cross-section: leading edge at +y, turned about the quarter chord by p.deflect.
// ox, th: offset across the part and thickness, for one of a biplane's two wings.
function foilPath(ctx, p, ox = 0, th = p.def.w) {
  const d = p.def, x = p.x + ox, h = d.h, t = p.y + h / 2, py = p.y + h / 4, a = p.deflect || 0;
  const c = Math.cos(a), s = Math.sin(a), N = 18, pts = [];
  for (let i = 0; i <= N; i++) { const f = Math.pow(i / N, 1.6); pts.push([foilHalf(f) * th / 2, t - f * h]); }
  const put = (dx, yy, first) => {
    const dy = yy - py, X = x + c * dx - s * dy, Y = py + s * dx + c * dy;
    if (first) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
  };
  pts.forEach(([hx, yy], i) => put(hx, yy, i === 0));
  for (let i = N; i >= 0; i--) put(-pts[i][0], pts[i][1], false);
  ctx.closePath();
}

// Side-view outlines of the aircraft and ground hulls (parts3d.js revolves or extrudes the same shapes).
const HULLS = {
  cockpit(ctx, x, y, w, h) { // nose at +y; the canopy sits on the -x side, drawn separately
    const b = y - h / 2, t = y + h / 2;
    ctx.moveTo(x - w / 2, b); ctx.lineTo(x + w / 2, b); ctx.lineTo(x + w / 2, b + h * 0.28);
    ctx.bezierCurveTo(x + w / 2, b + h * 0.72, x + w * 0.26, t, x + w * 0.12, t);
    ctx.lineTo(x, t);
    ctx.bezierCurveTo(x - w * 0.3, t, x - w / 2, b + h * 0.88, x - w / 2, b + h * 0.6);
    ctx.closePath();
  },
  tailcone(ctx, x, y, w, h, d) { // the -x edge stays straight; the +x edge sweeps up to it
    const b = y - h / 2, t = y + h / 2, bw = d.botW || w * 0.35;
    ctx.moveTo(x - w / 2, b); ctx.lineTo(x - w / 2 + bw, b);
    ctx.bezierCurveTo(x - w / 2 + bw + w * 0.12, b + h * 0.4, x + w / 2, t - h * 0.5, x + w / 2, t);
    ctx.lineTo(x - w / 2, t); ctx.closePath();
  },
  jet(ctx, x, y, w, h) {
    const b = y - h / 2, t = y + h / 2;
    ctx.moveTo(x - w * 0.3, b); ctx.lineTo(x + w * 0.3, b);
    ctx.bezierCurveTo(x + w * 0.4, b + h * 0.22, x + w / 2, b + h * 0.4, x + w / 2, b + h * 0.62);
    ctx.bezierCurveTo(x + w / 2, t - h * 0.1, x + w * 0.47, t, x + w * 0.43, t);
    ctx.lineTo(x - w * 0.43, t);
    ctx.bezierCurveTo(x - w * 0.47, t, x - w / 2, t - h * 0.1, x - w / 2, b + h * 0.62);
    ctx.bezierCurveTo(x - w / 2, b + h * 0.4, x - w * 0.4, b + h * 0.22, x - w * 0.3, b);
    ctx.closePath();
  },
  jetnose(ctx, x, y, w, h) { // long ogive towards +y; the canopy (on the -x side) is drawn separately
    const b = y - h / 2, t = y + h / 2;
    ctx.moveTo(x - w / 2, b); ctx.lineTo(x + w / 2, b);
    ctx.bezierCurveTo(x + w / 2, b + h * 0.45, x + w * 0.14, t - h * 0.08, x, t);
    ctx.bezierCurveTo(x - w * 0.14, t - h * 0.08, x - w / 2, b + h * 0.45, x - w / 2, b);
    ctx.closePath();
  },
  airnose(ctx, x, y, w, h) { // blunt airliner nose, rounder on the top (-x) side
    const b = y - h / 2, t = y + h / 2;
    ctx.moveTo(x - w / 2, b); ctx.lineTo(x + w / 2, b);
    ctx.bezierCurveTo(x + w / 2, b + h * 0.55, x + w * 0.3, t, x + w * 0.05, t);
    ctx.bezierCurveTo(x - w * 0.3, t, x - w / 2, b + h * 0.7, x - w / 2, b + h * 0.35);
    ctx.closePath();
  },
  glassnose(ctx, x, y, w, h) { // round bomber nose: a bullet, glazed towards the tip
    const b = y - h / 2, t = y + h / 2;
    ctx.moveTo(x - w / 2, b); ctx.lineTo(x + w / 2, b);
    ctx.bezierCurveTo(x + w / 2, b + h * 0.5, x + w * 0.32, t, x, t);
    ctx.bezierCurveTo(x - w * 0.32, t, x - w / 2, b + h * 0.5, x - w / 2, b);
    ctx.closePath();
  },
  bubble(ctx, x, y, w, h) { // helicopter cabin: a glass egg on a flat floor
    const b = y - h / 2, t = y + h / 2;
    ctx.moveTo(x - w * 0.36, b); ctx.lineTo(x + w * 0.36, b);
    ctx.bezierCurveTo(x + w * 0.5, b + h * 0.12, x + w * 0.5, t, x, t);
    ctx.bezierCurveTo(x - w * 0.5, t, x - w * 0.5, b + h * 0.12, x - w * 0.36, b);
    ctx.closePath();
  },
  float(ctx, x, y, w, h) { // pontoon on the +x side with a stepped bottom; struts drawn separately
    const l = x - w * 0.1, r = x + w / 2, b = y - h / 2, t = y + h / 2;
    ctx.moveTo(l, b + h * 0.06); ctx.lineTo(l, t - h * 0.2);
    ctx.bezierCurveTo(l, t - h * 0.04, x + w * 0.2, t, r, t - h * 0.02);
    ctx.lineTo(r, b + h * 0.45); ctx.lineTo(r - w * 0.08, b + h * 0.42); ctx.lineTo(r - w * 0.08, b);
    ctx.lineTo(l + w * 0.1, b); ctx.closePath();
  },
  droptank(ctx, x, y, w, h) { // tank on the +x side, pointed at both ends; pylon drawn separately
    const l = x - w * 0.05, r = x + w / 2, c = (l + r) / 2, b = y - h / 2, t = y + h / 2;
    ctx.moveTo(c, t); ctx.bezierCurveTo(r, t - h * 0.2, r, b + h * 0.25, c, b);
    ctx.bezierCurveTo(l, b + h * 0.25, l, t - h * 0.2, c, t); ctx.closePath();
  },
  cab(ctx, x, y, w, h) { // driving towards +x
    const l = x - w / 2, r = x + w / 2, b = y - h / 2, t = y + h / 2;
    ctx.moveTo(l, b); ctx.lineTo(r, b); ctx.lineTo(r, b + h * 0.45); ctx.lineTo(r - w * 0.05, b + h * 0.53);
    ctx.lineTo(r - w * 0.3, b + h * 0.56); ctx.lineTo(r - w * 0.46, t); ctx.lineTo(l + w * 0.06, t); ctx.lineTo(l, t - h * 0.08);
    ctx.closePath();
  },
};

// Outline path of a part (used for fills, heat glow and highlights).
// A turned part is drawn as an unturned copy at the origin, inside a rotated frame.
function turned(ctx, p, draw) {
  const k = (p.rot + (p.def.pusher ? 2 : 0)) & 3; // a pusher prop is a tractor drawn the other way round
  if (!k) return draw(p);
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate((k * Math.PI) / 2);
  const q = Object.create(p);
  q.x = 0; q.y = 0; q.rot = 0;
  draw(q);
  ctx.restore();
}
function partPath(ctx, p) { turned(ctx, p, (q) => partPath0(ctx, q)); }
function drawPart(ctx, p, lw) { turned(ctx, p, (q) => drawPart0(ctx, q, lw)); }

function partPath0(ctx, p) {
  const d = p.def, x = p.x, y = p.y, w = d.w, h = d.h;
  const l = x - w / 2, r = x + w / 2, b = y - h / 2, t = y + h / 2;
  ctx.beginPath();
  switch (d.shape) {
    case 'pod': {
      const tw = w * 0.42;
      ctx.moveTo(l, b); ctx.lineTo(r, b); ctx.lineTo(x + tw / 2, t); ctx.lineTo(x - tw / 2, t); ctx.closePath();
      break;
    }
    case 'adapter': {
      const tw = d.topW;
      ctx.moveTo(l, b); ctx.lineTo(r, b); ctx.lineTo(x + tw / 2, t); ctx.lineTo(x - tw / 2, t); ctx.closePath();
      break;
    }
    case 'nose':
      ctx.moveTo(l, b);
      ctx.bezierCurveTo(l, b + h * 0.6, x - w * 0.18, t, x, t);
      ctx.bezierCurveTo(x + w * 0.18, t, r, b + h * 0.6, r, b);
      ctx.closePath();
      break;
    case 'fin': {
      const s = p.flip ? -1 : 1, inn = x - s * w / 2, out = x + s * w / 2;
      ctx.moveTo(inn, t); ctx.lineTo(out, b + h * 0.28); ctx.lineTo(out, b); ctx.lineTo(inn, b); ctx.closePath();
      break;
    }
    case 'shield':
      ctx.moveTo(l, t); ctx.lineTo(r, t); ctx.lineTo(r, b + h * 0.45);
      ctx.quadraticCurveTo(x, b - h * 0.25, l, b + h * 0.45); ctx.closePath();
      break;
    case 'wheel':
      ctx.arc(x, y - h * 0.05, Math.min(w, h) * 0.45, 0, TAU);
      break;
    case 'probe': {
      const bh = h * 0.7, c = 0.18 * w;
      ctx.moveTo(l + c, b); ctx.lineTo(r - c, b); ctx.lineTo(r, b + c); ctx.lineTo(r, b + bh - c); ctx.lineTo(r - c, b + bh);
      ctx.lineTo(l + c, b + bh); ctx.lineTo(l, b + bh - c); ctx.lineTo(l, b + c); ctx.closePath();
      break;
    }
    case 'engine': {
      const mh = h * d.mount, tw = w * d.bellTop / 2, bw = w * d.bellBot / 2, yt = t - mh;
      ctx.rect(l + w * 0.12, yt, w * 0.76, mh);
      ctx.moveTo(x - tw, yt);
      ctx.bezierCurveTo(x - tw, yt - (yt - b) * 0.45, x - bw * 0.95, b + (yt - b) * 0.2, x - bw, b);
      ctx.lineTo(x + bw, b);
      ctx.bezierCurveTo(x + bw * 0.95, b + (yt - b) * 0.2, x + tw, yt - (yt - b) * 0.45, x + tw, yt);
      ctx.closePath();
      break;
    }
    case 'spike': {
      const mh = h * d.mount;
      ctx.rect(l + w * 0.05, t - mh, w * 0.9, mh);
      ctx.moveTo(l + w * 0.08, t - mh); ctx.lineTo(r - w * 0.08, t - mh); ctx.lineTo(x + w * 0.14, b); ctx.lineTo(x - w * 0.14, b); ctx.closePath();
      break;
    }
    case 'srb': {
      const nh = Math.min(0.7, h * 0.12);
      ctx.rect(l, b + nh, w, h - nh);
      ctx.moveTo(x - w * 0.22, b + nh); ctx.lineTo(x + w * 0.22, b + nh); ctx.lineTo(x + w * 0.36, b); ctx.lineTo(x - w * 0.36, b); ctx.closePath();
      break;
    }
    case 'cockpit': case 'tailcone': case 'jet': case 'cab': case 'jetnose': case 'airnose': case 'float': case 'droptank': case 'glassnose': case 'bubble':
      HULLS[d.shape](ctx, x, y, w, h, d);
      break;
    case 'biplane': { // two wings stacked across the part
      const g = d.wing.gap / 2, th = d.wing.thick;
      foilPath(ctx, p, -g, th); foilPath(ctx, p, g, th);
      break;
    }
    case 'rotodome': // the dish (on the -x side, the top of a plane) and its pylon
      ctx.rect(l, b, w * 0.32, h);
      ctx.rect(l + w * 0.3, y - 0.6, w * 0.7, 1.2);
      break;
    case 'skid': // a tube along the bottom (+x) and two struts up to the cabin
      ctx.rect(r - 0.24, b + 0.1, 0.24, h - 0.2);
      ctx.rect(l, y + h * 0.25 - 0.07, w - 0.2, 0.14);
      ctx.rect(l, y - h * 0.25 - 0.07, w - 0.2, 0.14);
      break;
    case 'ecm': { // a pod on a pylon, hanging on the +x side
      const cx = x + w * 0.12, rw = w * 0.66;
      ctx.rect(l, y - h * 0.18, cx - l, h * 0.36);
      ctx.rect(cx - rw / 2, b + h * 0.06, rw, h * 0.88);
      break;
    }
    case 'turret': // base on the +x (mounting) side, dome and twin barrels pointing along +y
      ctx.rect(x + w * 0.1, b + h * 0.15, w * 0.4, h * 0.7);
      ctx.moveTo(x + w * 0.12, y); ctx.ellipse(x - w * 0.04, y, w * 0.36, h * 0.34, 0, 0, TAU);
      ctx.rect(x - w * 0.16, y, w * 0.14, h / 2);
      break;
    case 'airbrake':
      ctx.rect(l, b, w, h);
      break;
    case 'wing': case 'elevator':
      foilPath(ctx, p);
      break;
    case 'vtail': {
      const s = p.flip ? -1 : 1, inn = x - s * w / 2, out = x + s * w / 2;
      ctx.moveTo(inn, b); ctx.lineTo(inn, t); ctx.lineTo(out, b + h * 0.4); ctx.lineTo(out, b); ctx.closePath();
      break;
    }
    case 'prop':
      ctx.rect(x - 0.36, b, 0.72, h * 0.3);
      ctx.moveTo(x - 0.3, b + h * 0.3); ctx.quadraticCurveTo(x - 0.3, t, x, t); ctx.quadraticCurveTo(x + 0.3, t, x + 0.3, b + h * 0.3); ctx.closePath();
      ctx.rect(l, b + h * 0.42 - 0.05, w, 0.1);
      break;
    case 'rotor':
      ctx.rect(x - 0.09, b, 0.18, h - 0.28);
      ctx.rect(x - 0.32, t - 0.38, 0.64, 0.2);
      ctx.rect(l, t - 0.31, w, 0.06);
      break;
    case 'tailrotor':
      ctx.arc(x, y, Math.min(w, h) * 0.47, 0, TAU);
      break;
    case 'gear': {
      const g = wheelGeom(p), i = x - (p.flip ? -1 : 1) * w / 2;
      ctx.rect(Math.min(i, g.x), g.y - 0.08, Math.abs(g.x - i), 0.16);
      ctx.moveTo(g.x + g.r, g.y); ctx.arc(g.x, g.y, g.r, 0, TAU);
      break;
    }
    case 'chute':
      ctx.rect(l + w * 0.1, b, w * 0.8, h * 0.4);
      ctx.moveTo(l + w * 0.1, b + h * 0.4); ctx.quadraticCurveTo(x, t + h * 0.4, r - w * 0.1, b + h * 0.4); ctx.closePath();
      break;
    default:
      ctx.rect(l, b, w, h);
  }
}

function drawPart0(ctx, p, lw) {
  const d = p.def, x = p.x, y = p.y, w = d.w, h = d.h;
  const l = x - w / 2, r = x + w / 2, b = y - h / 2, t = y + h / 2;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(8,11,16,0.9)';
  switch (d.shape) {
    case 'pod': {
      const tw = w * 0.42;
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.fillStyle = '#4a3a30'; ctx.fillRect(l, b, w, h * 0.09);
      ctx.fillStyle = PAL.orange; ctx.fillRect(x - tw / 2, t - h * 0.08, tw, h * 0.08);
      // panel line
      ctx.strokeStyle = 'rgba(20,26,34,0.25)';
      ctx.beginPath(); ctx.moveTo(l + w * 0.08, b + h * 0.45); ctx.lineTo(r - w * 0.08, b + h * 0.45); ctx.stroke();
      ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      ctx.beginPath(); ctx.arc(x - w * 0.1, y + h * 0.02, w * 0.14, 0, TAU);
      ctx.fillStyle = PAL.glass; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x - w * 0.13, y + h * 0.06, w * 0.05, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'probe': {
      const bh = h * 0.7;
      partPath(ctx, p); ctx.fillStyle = goldGradient(ctx, l, r); ctx.fill(); ctx.stroke();
      ctx.fillStyle = PAL.ink; ctx.fillRect(x - w * 0.22, b + bh * 0.3, w * 0.44, bh * 0.4);
      ctx.fillStyle = PAL.glass; ctx.fillRect(x - w * 0.1, b + bh * 0.42, w * 0.2, bh * 0.16);
      ctx.beginPath(); ctx.moveTo(x + w * 0.2, b + bh); ctx.lineTo(x + w * 0.2, t - 0.04);
      ctx.lineWidth = lw * 1.5; ctx.stroke(); ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(x + w * 0.2, t - 0.06, 0.06, 0, TAU); ctx.fillStyle = PAL.orange; ctx.fill();
      break;
    }
    case 'probeL': {
      ctx.fillStyle = goldGradient(ctx, l, r);
      ctx.fillRect(l, b, w, h * 0.75); ctx.strokeRect(l, b, w, h * 0.75);
      ctx.fillStyle = PAL.goldDark;
      for (let i = 1; i < 4; i++) ctx.fillRect(l + (w * i) / 4 - 0.02, b, 0.04, h * 0.75);
      ctx.fillStyle = PAL.ink; ctx.fillRect(x - w * 0.18, b + h * 0.18, w * 0.36, h * 0.38);
      ctx.fillStyle = PAL.glass; ctx.fillRect(x - w * 0.06, b + h * 0.28, w * 0.12, h * 0.16);
      // dish
      ctx.beginPath(); ctx.ellipse(r - w * 0.2, b + h * 0.86, w * 0.14, h * 0.12, 0, Math.PI, TAU);
      ctx.fillStyle = PAL.steelLight; ctx.fill(); ctx.stroke();
      break;
    }
    case 'tank': {
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fillRect(l, b, w, h);
      const band = Math.min(0.16, h * 0.12);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, band); ctx.fillRect(l, t - band, w, band);
      if (h >= 2) {
        ctx.fillStyle = 'rgba(255,122,26,0.95)';
        ctx.fillRect(l + w * 0.14, b + band, Math.min(0.18, w * 0.09), h - band * 2);
      }
      if (h >= 3) {
        ctx.strokeStyle = 'rgba(20,26,34,0.35)';
        for (let yy = b + 2; yy < t - 0.5; yy += 2) { ctx.beginPath(); ctx.moveTo(l, yy); ctx.lineTo(r, yy); ctx.stroke(); }
        ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      }
      // fuel gauge stripe (flight only)
      if (p.fuelFrac != null && d.fuel) {
        const f = p.fuelFrac;
        ctx.fillStyle = 'rgba(10,14,20,0.18)';
        ctx.fillRect(r - w * 0.16, b + band, w * 0.08, (h - band * 2) * (1 - f) );
      }
      ctx.strokeRect(l, b, w, h);
      break;
    }
    case 'engine': {
      const mh = h * d.mount;
      if (d.style === 'nuclear') {
        ctx.fillStyle = '#2b3138'; ctx.fillRect(l + w * 0.1, t - mh, w * 0.8, mh); ctx.strokeRect(l + w * 0.1, t - mh, w * 0.8, mh);
        ctx.fillStyle = PAL.nuclear;
        for (let i = 0; i < 3; i++) ctx.fillRect(l + w * 0.1, t - mh * (0.25 + i * 0.25), w * 0.8, mh * 0.05);
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.arc(x, t - mh * 0.5, w * 0.08, 0, TAU); ctx.fill();
        // radiator fins
        ctx.fillStyle = '#5a636d';
        ctx.fillRect(l, t - mh * 0.85, w * 0.1, mh * 0.6); ctx.fillRect(r - w * 0.1, t - mh * 0.85, w * 0.1, mh * 0.6);
      } else {
        ctx.fillStyle = metalGradient(ctx, l + w * 0.12, r - w * 0.12);
        ctx.fillRect(l + w * 0.12, t - mh, w * 0.76, mh);
        ctx.strokeRect(l + w * 0.12, t - mh, w * 0.76, mh);
        ctx.fillStyle = PAL.ink; ctx.fillRect(l + w * 0.12, t - mh * 0.35, w * 0.76, mh * 0.12);
        ctx.strokeStyle = 'rgba(30,34,40,0.8)';
        ctx.beginPath(); ctx.moveTo(x - w * 0.2, t - mh * 0.2); ctx.lineTo(x - w * 0.1, t - mh); ctx.moveTo(x + w * 0.2, t - mh * 0.2); ctx.lineTo(x + w * 0.1, t - mh); ctx.stroke();
        ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      }
      const tw = w * d.bellTop / 2, bw = w * d.bellBot / 2, yt = t - mh;
      ctx.beginPath();
      ctx.moveTo(x - tw, yt);
      ctx.bezierCurveTo(x - tw, yt - (yt - b) * 0.45, x - bw * 0.95, b + (yt - b) * 0.2, x - bw, b);
      ctx.lineTo(x + bw, b);
      ctx.bezierCurveTo(x + bw * 0.95, b + (yt - b) * 0.2, x + tw, yt - (yt - b) * 0.45, x + tw, yt);
      ctx.closePath();
      ctx.fillStyle = metalGradient(ctx, x - bw, x + bw); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.moveTo(x - bw * 0.35, b + 0.05); ctx.lineTo(x - tw * 0.4, yt - 0.05); ctx.stroke();
      ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      ctx.fillStyle = 'rgba(10,12,16,0.6)'; ctx.fillRect(x - bw, b, bw * 2, Math.min(0.1, h * 0.05));
      if (p.firing > 0) { ctx.fillStyle = `rgba(255,170,80,${0.35 * p.firing})`; ctx.fillRect(x - bw * 0.9, b, bw * 1.8, Math.min(0.25, h * 0.1)); }
      break;
    }
    case 'spike': {
      const mh = h * d.mount;
      ctx.fillStyle = metalGradient(ctx, l, r); ctx.fillRect(l + w * 0.05, t - mh, w * 0.9, mh); ctx.strokeRect(l + w * 0.05, t - mh, w * 0.9, mh);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l + w * 0.05, t - mh * 0.4, w * 0.9, mh * 0.15);
      ctx.beginPath(); ctx.moveTo(l + w * 0.08, t - mh); ctx.lineTo(r - w * 0.08, t - mh); ctx.lineTo(x + w * 0.14, b); ctx.lineTo(x - w * 0.14, b); ctx.closePath();
      ctx.fillStyle = metalGradient(ctx, l, r); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(20,24,30,0.55)';
      ctx.beginPath(); ctx.moveTo(l + w * 0.08, t - mh); ctx.lineTo(x - w * 0.14, b); ctx.lineTo(x - w * 0.05, b); ctx.lineTo(x - w * 0.12, t - mh); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r - w * 0.08, t - mh); ctx.lineTo(x + w * 0.14, b); ctx.lineTo(x + w * 0.05, b); ctx.lineTo(x + w * 0.12, t - mh); ctx.closePath(); ctx.fill();
      break;
    }
    case 'ion': {
      ctx.fillStyle = metalGradient(ctx, l, r); ctx.fillRect(l + w * 0.1, b + h * 0.3, w * 0.8, h * 0.7); ctx.strokeRect(l + w * 0.1, b + h * 0.3, w * 0.8, h * 0.7);
      ctx.fillStyle = '#20262e'; ctx.beginPath(); ctx.ellipse(x, b + h * 0.3, w * 0.4, h * 0.3, 0, Math.PI, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(127,184,255,0.7)';
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * w * 0.08, b + h * 0.3); ctx.lineTo(x + i * w * 0.08, b + h * 0.06); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      ctx.fillStyle = PAL.gold; ctx.fillRect(l + w * 0.2, t - h * 0.25, w * 0.6, h * 0.12);
      break;
    }
    case 'srb': {
      const nh = Math.min(0.7, h * 0.12);
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fillRect(l, b + nh, w, h - nh);
      ctx.fillStyle = PAL.ink;
      const seg = (h - nh) / 4;
      for (let i = 1; i < 4; i++) ctx.fillRect(l, b + nh + seg * i - 0.05, w, 0.1);
      ctx.fillStyle = PAL.orange; ctx.fillRect(l, t - 0.35, w, 0.35);
      ctx.fillStyle = '#2b3138'; ctx.fillRect(l, b + nh, w, 0.14);
      ctx.strokeRect(l, b + nh, w, h - nh);
      ctx.beginPath(); ctx.moveTo(x - w * 0.22, b + nh); ctx.lineTo(x + w * 0.22, b + nh); ctx.lineTo(x + w * 0.36, b); ctx.lineTo(x - w * 0.36, b); ctx.closePath();
      ctx.fillStyle = metalGradient(ctx, x - w * 0.36, x + w * 0.36); ctx.fill(); ctx.stroke();
      if (p.fuelFrac != null) {
        ctx.fillStyle = 'rgba(10,14,20,0.18)';
        ctx.fillRect(r - w * 0.2, b + nh + 0.2, w * 0.1, (h - nh - 0.6) * (1 - p.fuelFrac));
      }
      break;
    }
    case 'sep': {
      ctx.save();
      ctx.beginPath(); ctx.rect(l, b, w, h); ctx.clip();
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, h);
      ctx.fillStyle = PAL.hazard;
      const s = 0.28, span = w + h;
      for (let k = -span; k < span; k += s * 2) {
        ctx.beginPath();
        ctx.moveTo(l + k, b); ctx.lineTo(l + k + s, b); ctx.lineTo(l + k + s + h, t); ctx.lineTo(l + k + h, t); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      ctx.strokeRect(l, b, w, h);
      break;
    }
    case 'nose': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = PAL.orange; ctx.fillRect(l, t - h * 0.22, w, h * 0.22);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, Math.min(0.1, h * 0.08)); ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'fin': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      const s = p.flip ? -1 : 1;
      ctx.fillStyle = PAL.orange; ctx.fillRect(Math.min(x + s * w * 0.25, x + s * w / 2), b, w * 0.25, h);
      ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'shield': {
      partPath(ctx, p);
      const g = ctx.createLinearGradient(0, b, 0, t);
      g.addColorStop(0, '#241c18'); g.addColorStop(1, PAL.shieldLight);
      ctx.fillStyle = g; ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      for (let i = 0; i < w * 4; i++) ctx.fillRect(l + 0.12 + i * 0.25, b + h * 0.45, 0.06, 0.06);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, t - 0.08, w, 0.08);
      break;
    }
    case 'chute': {
      if (p.used) { ctx.fillStyle = PAL.steelDark; ctx.fillRect(l + w * 0.1, b, w * 0.8, h * 0.4); ctx.strokeRect(l + w * 0.1, b, w * 0.8, h * 0.4); break; }
      ctx.fillStyle = PAL.steelLight; ctx.fillRect(l + w * 0.1, b, w * 0.8, h * 0.4);
      ctx.beginPath(); ctx.moveTo(l + w * 0.1, b + h * 0.4);
      ctx.quadraticCurveTo(x, t + h * 0.4, r - w * 0.1, b + h * 0.4); ctx.closePath();
      ctx.fillStyle = p.deployed > 0 ? PAL.steel : PAL.orange; ctx.fill(); ctx.stroke();
      ctx.strokeRect(l + w * 0.1, b, w * 0.8, h * 0.4);
      break;
    }
    case 'leg': {
      const s = p.flip ? -1 : 1;
      const inner = x - s * w / 2, outer = x + s * w / 2;
      ctx.fillStyle = PAL.steelDark;
      ctx.fillRect(Math.min(inner, inner + s * 0.18), t - 0.9, 0.18, 0.9);
      ctx.strokeStyle = PAL.steelLight; ctx.lineCap = 'round';
      ctx.lineWidth = 0.13;
      ctx.beginPath(); ctx.moveTo(inner + s * 0.09, t - 0.15); ctx.lineTo(outer - s * 0.12, b + 0.16); ctx.stroke();
      ctx.lineWidth = 0.08; ctx.strokeStyle = PAL.steel;
      ctx.beginPath(); ctx.moveTo(inner + s * 0.09, t - 0.85); ctx.lineTo(outer - s * 0.16, b + 0.5); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(Math.min(outer, outer - s * 0.48), b, 0.48, 0.12);
      ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      break;
    }
    case 'wheel': {
      const rad = Math.min(w, h) * 0.45, cy = y - h * 0.05;
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(x - w * 0.1, cy, w * 0.2, t - cy);
      ctx.beginPath(); ctx.arc(x, cy, rad, 0, TAU); ctx.fillStyle = '#20242a'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, cy, rad * 0.62, 0, TAU); ctx.fillStyle = PAL.steelLight; ctx.fill();
      ctx.strokeStyle = PAL.steelDark; ctx.lineWidth = rad * 0.1;
      const sp = p.spin || 0;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) { const a = sp + (i * TAU) / 5; ctx.moveTo(x, cy); ctx.lineTo(x + Math.cos(a) * rad * 0.6, cy + Math.sin(a) * rad * 0.6); }
      ctx.stroke();
      ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      ctx.beginPath(); ctx.arc(x, cy, rad * 0.16, 0, TAU); ctx.fillStyle = PAL.orange; ctx.fill();
      break;
    }
    case 'rcs': {
      const s = p.flip ? -1 : 1, out = x + s * w / 2;
      ctx.fillStyle = '#d7dce1'; ctx.fillRect(l, y - h * 0.3, w, h * 0.6); ctx.strokeRect(l, y - h * 0.3, w, h * 0.6);
      ctx.fillStyle = PAL.steelDark;
      ctx.fillRect(x - w * 0.12, t - h * 0.2, w * 0.24, h * 0.2);
      ctx.fillRect(x - w * 0.12, b, w * 0.24, h * 0.2);
      ctx.fillRect(Math.min(out, out - s * w * 0.2), y - h * 0.1, w * 0.2, h * 0.2);
      break;
    }
    case 'girder': {
      ctx.strokeStyle = '#9aa3ad'; ctx.lineWidth = 0.08;
      const xl = l + w * 0.15, xr = r - w * 0.15;
      ctx.beginPath(); ctx.moveTo(xl, b); ctx.lineTo(xl, t); ctx.moveTo(xr, b); ctx.lineTo(xr, t);
      for (let yy = b; yy < t - 0.01; yy += 0.5) { ctx.moveTo(xl, yy); ctx.lineTo(xr, Math.min(t, yy + 0.5)); ctx.moveTo(xl, yy); ctx.lineTo(xr, yy); }
      ctx.stroke();
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(l, b, w, 0.1); ctx.fillRect(l, t - 0.1, w, 0.1);
      ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      break;
    }
    case 'cockpit': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, t - h * 0.1, w, h * 0.1); // nose cap
      ctx.fillStyle = PAL.orange; ctx.fillRect(x + w * 0.05, b, w * 0.12, h * 0.75); // stripe along the belly side
      ctx.restore();
      partPath(ctx, p); ctx.stroke();
      // bubble canopy on the -x side (the top of a plane)
      ctx.beginPath(); ctx.ellipse(x - w * 0.42, b + h * 0.42, w * 0.22, h * 0.3, 0, 0, TAU);
      ctx.fillStyle = PAL.glass; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x - w * 0.5, b + h * 0.5, w * 0.06, h * 0.12, 0, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
      break;
    }
    case 'jetnose': { // canopy: where along the nose (at) and how long (len), as fractions of its length
      const cp = d.canopy || {}, at = cp.at || 0.3, cl = cp.len || 0.2, stealth = d.style === 'stealth';
      partPath(ctx, p); ctx.fillStyle = stealth ? darkGradient(ctx, l, r) : hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      if (stealth) { // dark chines along both edges and sawtooth panel lines
        ctx.fillStyle = '#2b2e34'; ctx.fillRect(l, b, w * 0.14, h); ctx.fillRect(r - w * 0.14, b, w * 0.14, h);
        ctx.strokeStyle = 'rgba(15,17,20,0.7)'; ctx.lineWidth = lw; sawtooth(ctx, l, r, b + h * 0.12, h * 0.05); sawtooth(ctx, l, r, b + h * 0.62, h * 0.05);
      } else {
        ctx.fillStyle = '#3a4048'; ctx.fillRect(l, t - h * 0.2, w, h * 0.2); // radome tip
        ctx.fillStyle = PAL.orange; ctx.fillRect(x + w * 0.05, b, w * 0.1, h * 0.6);
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(8,11,16,0.9)'; ctx.lineWidth = lw;
      partPath(ctx, p); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x - w * 0.42, b + h * at, w * 0.2, h * cl, 0, 0, TAU);
      ctx.fillStyle = cp.gold ? '#c9a24a' : PAL.glass; ctx.fill(); ctx.stroke();
      if ((cp.seats || 1) > 1) { ctx.beginPath(); ctx.moveTo(x - w * 0.62, b + h * at); ctx.lineTo(x - w * 0.22, b + h * at); ctx.stroke(); } // the frame between the seats
      ctx.beginPath(); ctx.ellipse(x - w * 0.5, b + h * (at + cl * 0.3), w * 0.05, h * cl * 0.35, 0, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
      break;
    }
    case 'glassnose': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = '#c9ced4'; ctx.fillRect(x + w * 0.22, b, w * 0.3, h); // belly
      ctx.fillStyle = PAL.orange; ctx.fillRect(x + w * 0.1, b, w * 0.05, h * 0.6);
      ctx.fillStyle = PAL.glass; ctx.fillRect(l, b + h * 0.6, w, h * 0.4); // the glazed tip, framed
      ctx.strokeStyle = 'rgba(40,48,58,0.85)'; ctx.lineWidth = lw * 1.3;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { const yy = b + h * (0.6 + i * 0.1); ctx.moveTo(l, yy); ctx.lineTo(r, yy); }
      for (let i = 1; i < 5; i++) { const xx = l + (w * i) / 5; ctx.moveTo(xx, b + h * 0.6); ctx.lineTo(xx, t); }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(8,11,16,0.9)'; ctx.lineWidth = lw;
      partPath(ctx, p); ctx.stroke();
      ctx.fillStyle = PAL.ink; // flight deck windows on top, behind the glazing
      for (let i = 0; i < 3; i++) ctx.fillRect(x - w * 0.47 + i * w * 0.07, b + h * 0.38 - i * h * 0.02, w * 0.05, h * 0.1);
      break;
    }
    case 'cabin': { // a fuselage section with a bubble canopy on top (-x)
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fillRect(l, b, w, h);
      ctx.fillStyle = '#2f6fb7'; ctx.fillRect(x + w * 0.04, b, w * 0.1, h);
      ctx.fillStyle = PAL.orange; ctx.fillRect(x + w * 0.14, b, w * 0.04, h);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, 0.06); ctx.fillRect(l, t - 0.06, w, 0.06);
      ctx.strokeRect(l, b, w, h);
      ctx.beginPath(); ctx.ellipse(x - w * 0.42, y + h * 0.05, w * 0.22, h * 0.34, 0, 0, TAU);
      ctx.fillStyle = PAL.glass; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - w * 0.64, y - h * 0.05); ctx.lineTo(x - w * 0.2, y - h * 0.05); ctx.stroke(); // canopy frame
      ctx.beginPath(); ctx.ellipse(x - w * 0.52, y + h * 0.14, w * 0.05, h * 0.1, 0, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
      break;
    }
    case 'bubble': {
      partPath(ctx, p); ctx.fillStyle = PAL.glass; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fillRect(l, b, w, h * 0.24); // floor and doors' sills
      ctx.fillStyle = PAL.orange; ctx.fillRect(l, b + h * 0.24, w, h * 0.04);
      ctx.fillStyle = '#3a4048'; ctx.beginPath(); ctx.arc(x - w * 0.08, b + h * 0.5, w * 0.11, 0, TAU); ctx.fill(); // the pilot
      ctx.strokeStyle = 'rgba(40,48,58,0.8)'; ctx.lineWidth = lw * 1.3;
      ctx.beginPath(); ctx.moveTo(x + w * 0.12, b + h * 0.28); ctx.lineTo(x + w * 0.04, t); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(x + w * 0.25, b + h * 0.66, w * 0.06, h * 0.14, -0.3, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(8,11,16,0.9)'; ctx.lineWidth = lw;
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'dronecore': {
      const bh = h * 0.78;
      ctx.fillStyle = PartPaint.flat ? '#6b737c' : metalGradient(ctx, l, r); ctx.fillRect(l, b, w, bh); ctx.strokeRect(l, b, w, bh);
      ctx.beginPath(); ctx.ellipse(x, b + bh, w * 0.34, h - bh, 0, 0, Math.PI); ctx.fillStyle = '#e9ecef'; ctx.fill(); ctx.stroke(); // satellite dome
      ctx.fillStyle = PAL.ink; for (let i = 0; i < 3; i++) ctx.fillRect(l + w * 0.15, b + h * (0.12 + i * 0.12), w * 0.7, 0.05); // vents
      ctx.fillStyle = '#7dffb0'; ctx.fillRect(l + w * 0.12, b + h * 0.58, w * 0.12, w * 0.12); // status light
      ctx.fillStyle = PAL.orange; ctx.fillRect(r - w * 0.22, b + h * 0.58, w * 0.1, w * 0.12);
      break;
    }
    case 'rotodome': {
      const dw = w * 0.32;
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(l + w * 0.3, y - 0.6, w * 0.7, 1.2); ctx.strokeRect(l + w * 0.3, y - 0.6, w * 0.7, 1.2);
      ctx.fillStyle = PartPaint.flat ? '#eef1f4' : hullGradient(ctx, l, l + dw); ctx.fillRect(l, b, dw, h);
      ctx.fillStyle = '#2b3036'; ctx.fillRect(l, b + h * 0.06, dw, h * 0.3); ctx.fillRect(l, t - h * 0.36, dw, h * 0.3); // the radar arrays
      ctx.fillStyle = PAL.orange; ctx.fillRect(l + dw * 0.3, y - 0.2, dw * 0.4, 0.4);
      ctx.strokeRect(l, b, dw, h);
      break;
    }
    case 'skid': {
      ctx.fillStyle = PAL.steelDark;
      for (const yy of [y + h * 0.25, y - h * 0.25]) { ctx.fillRect(l, yy - 0.07, w - 0.2, 0.14); ctx.strokeRect(l, yy - 0.07, w - 0.2, 0.14); }
      ctx.beginPath(); ctx.moveTo(r - 0.24, b + 0.1); ctx.lineTo(r, b + 0.1); ctx.lineTo(r, t - 0.35); ctx.quadraticCurveTo(r, t - 0.05, r - 0.4, t - 0.1);
      ctx.lineTo(r - 0.4, t - 0.24); ctx.quadraticCurveTo(r - 0.24, t - 0.26, r - 0.24, t - 0.4); ctx.closePath();
      ctx.fillStyle = PAL.steelLight; ctx.fill(); ctx.stroke();
      break;
    }
    case 'airnose': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = '#c9ced4'; ctx.fillRect(x + w * 0.22, b, w * 0.3, h); // belly
      ctx.fillStyle = '#2f6fb7'; ctx.fillRect(x + w * 0.04, b, w * 0.1, h * 0.8);
      ctx.fillStyle = PAL.orange; ctx.fillRect(x + w * 0.14, b, w * 0.04, h * 0.7);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, t - h * 0.05, w, h * 0.05);
      ctx.restore();
      partPath(ctx, p); ctx.stroke();
      ctx.fillStyle = PAL.ink; // windscreen, on the top side near the nose
      for (let i = 0; i < 3; i++) ctx.fillRect(x - w * 0.36 + i * w * 0.07, b + h * 0.62 - i * h * 0.03, w * 0.05, h * 0.11);
      ctx.fillStyle = PAL.glass;
      for (let yy = b + 0.3; yy < b + h * 0.45; yy += 0.5) ctx.fillRect(x - w * 0.2, yy, w * 0.1, 0.24);
      break;
    }
    case 'float': {
      const s = 0.09, xa = x - w / 2, xb = x - w * 0.1;
      ctx.fillStyle = PAL.steelDark; // struts up to the fuselage
      for (const yy of [y + h * 0.18, y - h * 0.22]) ctx.fillRect(xa, yy - s / 2, xb - xa, s);
      partPath(ctx, p); ctx.fillStyle = PartPaint.flat ? '#e8b23a' : (() => { const g = ctx.createLinearGradient(xb, 0, x + w / 2, 0); g.addColorStop(0, '#ffd36a'); g.addColorStop(1, '#c98f1c'); return g; })();
      ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = PAL.ink; ctx.fillRect(x + w * 0.3, b, w * 0.2, h); ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'droptank': {
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(x - w / 2, y - h * 0.15, w * 0.5, h * 0.3); // pylon
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, x - w * 0.05, r); ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = PAL.orange; ctx.fillRect(l, t - h * 0.14, w, h * 0.06); ctx.fillRect(l, b + h * 0.08, w, h * 0.06); ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'airbrake': {
      ctx.fillStyle = PAL.steelLight; ctx.fillRect(l, b, w, h);
      ctx.fillStyle = PAL.hazard;
      for (let yy = b; yy < t - 0.01; yy += 0.3) ctx.fillRect(l, yy, w, 0.15);
      ctx.strokeRect(l, b, w, h);
      break;
    }
    case 'fuselage': {
      if (d.style) { drawFuselageStyle(ctx, p, lw); break; }
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fillRect(l, b, w, h);
      ctx.fillStyle = '#c9ced4'; ctx.fillRect(x + w * 0.22, b, w * 0.28, h); // belly
      ctx.fillStyle = '#2f6fb7'; ctx.fillRect(x + w * 0.04, b, w * 0.1, h); // cheatline
      ctx.fillStyle = PAL.orange; ctx.fillRect(x + w * 0.14, b, w * 0.04, h);
      ctx.fillStyle = PAL.glass;
      for (let yy = b + 0.35; yy < t - 0.3; yy += 0.55) ctx.fillRect(x - w * 0.2, yy, w * 0.13, 0.28);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, 0.06); ctx.fillRect(l, t - 0.06, w, 0.06);
      if (p.fuelFrac != null) { ctx.fillStyle = 'rgba(10,14,20,0.18)'; ctx.fillRect(x - w * 0.42, b + 0.1, w * 0.06, (h - 0.2) * (1 - p.fuelFrac)); }
      ctx.strokeRect(l, b, w, h);
      break;
    }
    case 'tailcone': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = '#2f6fb7'; ctx.fillRect(x + w * 0.04, b, w * 0.1, h);
      ctx.fillStyle = PAL.orange; ctx.fillRect(x + w * 0.14, b, w * 0.04, h);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, 0.12);
      ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'biplane': { // struts and bracing wires between the two wings, then the wings as any other
      const g = d.wing.gap / 2;
      ctx.fillStyle = PAL.steelDark;
      for (const yy of [y + h * 0.12, y - h * 0.22]) ctx.fillRect(x - g, yy - 0.05, 2 * g, 0.1);
      ctx.strokeStyle = 'rgba(40,46,54,0.8)'; ctx.lineWidth = 0.025;
      ctx.beginPath(); ctx.moveTo(x - g, y + h * 0.12); ctx.lineTo(x + g, y - h * 0.22); ctx.moveTo(x - g, y - h * 0.22); ctx.lineTo(x + g, y + h * 0.12); ctx.stroke();
      ctx.strokeStyle = 'rgba(8,11,16,0.9)'; ctx.lineWidth = lw;
    }
    // falls through
    case 'wing': case 'elevator': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = PAL.steel; ctx.fillRect(l - 1, t - h * 0.08, w + 2, h * 0.08); // leading edge
      ctx.fillStyle = d.shape === 'elevator' ? PAL.orange : 'rgba(255,122,26,0.85)';
      ctx.fillRect(l - 1, b - 1, w + 2, h * (d.shape === 'elevator' ? 0.35 : 0.18) + 1);
      ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'vtail': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      const s = p.flip ? -1 : 1, out = x + s * w / 2;
      ctx.fillStyle = PAL.orange; ctx.fillRect(Math.min(out, out - s * w * 0.3), b, w * 0.3, h);
      ctx.fillStyle = '#2f6fb7'; ctx.fillRect(l, b, w, h * 0.12);
      ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'prop': {
      const R = propRadius(d), rows = d.contra ? [b + h * 0.38, b + h * 0.56] : [b + h * 0.42];
      ctx.fillStyle = metalGradient(ctx, x - 0.36, x + 0.36); ctx.fillRect(x - 0.36, b, 0.72, h * 0.3); ctx.strokeRect(x - 0.36, b, 0.72, h * 0.3);
      rows.forEach((yb, row) => {
        if (p.firing > 0.3) { // blur of the spinning disc, seen edge-on
          ctx.fillStyle = `rgba(150,160,175,${0.25 * p.firing})`;
          ctx.beginPath(); ctx.ellipse(x, yb, R, 0.08, 0, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#2b3036';
        const nb = d.blades || 3, sp = (row ? -1 : 1) * (p.spin || 0) + row * 0.5;
        for (let i = 0; i < nb; i++) {
          const k = Math.cos(sp + (i * TAU) / nb) * R;
          ctx.fillRect(Math.min(x, x + k), yb - 0.06, Math.abs(k), 0.12);
          ctx.fillStyle = PAL.hazard; ctx.fillRect(x + k - Math.sign(k) * 0.14 - 0.07, yb - 0.06, 0.14, 0.12); ctx.fillStyle = '#2b3036';
        }
      });
      if (d.duct) { // the ring round the fan, seen from the side
        const yb = rows[0];
        ctx.fillStyle = hullGradient(ctx, l, r);
        for (const s2 of [-1, 1]) { const xx = x + s2 * (R + 0.08); ctx.fillRect(xx - 0.08, yb - 0.42, 0.16, 0.84); ctx.strokeRect(xx - 0.08, yb - 0.42, 0.16, 0.84); }
      }
      ctx.beginPath(); ctx.moveTo(x - 0.3, b + h * 0.3); ctx.quadraticCurveTo(x - 0.3, t, x, t); ctx.quadraticCurveTo(x + 0.3, t, x + 0.3, b + h * 0.3); ctx.closePath();
      ctx.fillStyle = d.style === 'electric' ? tintGradient(ctx, x - 0.3, x + 0.3, '#3b7dd8') : hullGradient(ctx, x - 0.3, x + 0.3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = PAL.orange; ctx.beginPath(); ctx.arc(x, t - 0.1, 0.07, 0, TAU); ctx.fill();
      break;
    }
    case 'jet': {
      const scram = d.style === 'scram', pulse = d.style === 'pulse';
      partPath(ctx, p); ctx.fillStyle = scram ? darkGradient(ctx, l, r) : pulse ? tintGradient(ctx, l, r, '#8a6f55') : metalGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      if (scram) { // heat tiles, and the wedge of the intake ramp
        ctx.strokeStyle = 'rgba(10,12,14,0.5)'; ctx.lineWidth = lw;
        ctx.beginPath(); for (let yy = b + 0.3; yy < t; yy += 0.4) { ctx.moveTo(l, yy); ctx.lineTo(r, yy); } ctx.stroke();
        ctx.fillStyle = '#1b1d21'; ctx.beginPath(); ctx.moveTo(l, t); ctx.lineTo(x, t - h * 0.3); ctx.lineTo(r, t); ctx.closePath(); ctx.fill();
        ctx.fillStyle = PAL.orange; ctx.fillRect(l, b + h * 0.08, w, h * 0.03);
      } else if (pulse) { // a valve box at the front, rings down the pipe
        ctx.fillStyle = '#5d4a3a'; ctx.fillRect(l, t - h * 0.22, w, h * 0.22);
        ctx.fillStyle = 'rgba(30,22,16,0.5)'; for (let i = 1; i < 6; i++) ctx.fillRect(l, b + h * 0.13 * i, w, 0.05);
      }
      if (scram || pulse) { ctx.restore(); partPath(ctx, p); ctx.stroke(); ctx.fillStyle = '#15181c'; ctx.fillRect(x - w * 0.24, b, w * 0.48, 0.08); if (p.firing > 0) { ctx.fillStyle = `rgba(255,150,80,${0.4 * p.firing})`; ctx.fillRect(x - w * 0.24, b, w * 0.48, 0.12); } break; }
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fillRect(l, t - h * 0.55, w, h * 0.55); // cowling
      ctx.fillStyle = PAL.orange; ctx.fillRect(l, t - h * 0.58, w, h * 0.04);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, t - h * 0.06, w, h * 0.06); // intake lip
      ctx.fillStyle = 'rgba(20,24,30,0.45)'; for (let i = 1; i < 4; i++) ctx.fillRect(l, b + h * 0.1 * i, w, 0.04);
      ctx.restore();
      partPath(ctx, p); ctx.stroke();
      ctx.fillStyle = '#15181c'; ctx.fillRect(x - w * 0.24, b, w * 0.48, 0.08);
      if (p.firing > 0) { ctx.fillStyle = `rgba(255,150,80,${0.4 * p.firing})`; ctx.fillRect(x - w * 0.24, b, w * 0.48, 0.12); }
      break;
    }
    case 'rotor': {
      const yb = t - 0.28, R = w / 2;
      ctx.fillStyle = PAL.steel; ctx.fillRect(x - 0.09, b, 0.18, yb - b);
      ctx.fillStyle = PAL.steelDark; ctx.beginPath(); ctx.moveTo(x - 0.42, b); ctx.lineTo(x + 0.42, b); ctx.lineTo(x + 0.11, b + 0.36); ctx.lineTo(x - 0.11, b + 0.36); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (p.firing > 0.3) {
        ctx.fillStyle = `rgba(150,160,175,${0.22 * p.firing})`;
        ctx.beginPath(); ctx.ellipse(x, yb, R, 0.07, 0, 0, TAU); ctx.fill();
      }
      const droop = 0.18 * (1 - Math.min(1, (p.firing || 0) * 2));
      for (let i = 0; i < 4; i++) {
        const k = Math.cos((p.spin || 0) + (i * TAU) / 4) * R;
        if (Math.abs(k) < 0.05) continue;
        ctx.strokeStyle = '#30353c'; ctx.lineWidth = 0.09; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, yb); ctx.lineTo(x + k, yb - droop * Math.abs(k) / R); ctx.stroke();
        ctx.strokeStyle = PAL.hazard; ctx.beginPath(); ctx.moveTo(x + k * 0.94, yb - droop * 0.94); ctx.lineTo(x + k, yb - droop * Math.abs(k) / R); ctx.stroke();
      }
      ctx.lineCap = 'butt'; ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(x - 0.3, yb - 0.08, 0.6, 0.16); ctx.strokeRect(x - 0.3, yb - 0.08, 0.6, 0.16);
      ctx.fillStyle = PAL.orange; ctx.beginPath(); ctx.arc(x, yb + 0.1, 0.12, Math.PI, TAU); ctx.fill();
      break;
    }
    case 'tailrotor': {
      const R = Math.min(w, h) * 0.47;
      if (p.firing > 0.3) { ctx.fillStyle = `rgba(150,160,175,${0.25 * p.firing})`; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = '#30353c'; ctx.lineWidth = 0.14; ctx.lineCap = 'round';
      const a = p.spin || 0;
      ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * R, y - Math.sin(a) * R); ctx.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); ctx.stroke();
      ctx.strokeStyle = PAL.orange; ctx.lineWidth = 0.14;
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * R * 0.85, y + Math.sin(a) * R * 0.85); ctx.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R);
      ctx.moveTo(x - Math.cos(a) * R * 0.85, y - Math.sin(a) * R * 0.85); ctx.lineTo(x - Math.cos(a) * R, y - Math.sin(a) * R); ctx.stroke();
      ctx.lineCap = 'butt'; ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      ctx.fillStyle = PAL.steelDark; ctx.beginPath(); ctx.arc(x, y, 0.14, 0, TAU); ctx.fill(); ctx.stroke();
      break;
    }
    case 'gear': {
      const g = wheelGeom(p), s = p.flip ? -1 : 1, i = x - s * w / 2;
      if (p.retracted) { ctx.fillStyle = PAL.steelDark; ctx.fillRect(Math.min(i, i + s * 0.3), g.y - 0.2, 0.3, 0.4); break; }
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(Math.min(i, i + s * 0.12), g.y - 0.2, 0.12, 0.4);
      ctx.strokeStyle = PAL.steelLight; ctx.lineWidth = 0.12; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(i + s * 0.1, g.y); ctx.lineTo(g.x, g.y); ctx.stroke();
      ctx.lineCap = 'butt'; ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      const bog = d.wheel.bogie ? g.r * 1.06 : 0;
      if (bog) { ctx.fillStyle = PAL.steel; ctx.fillRect(g.x - 0.08, g.y - bog, 0.16, bog * 2); ctx.strokeRect(g.x - 0.08, g.y - bog, 0.16, bog * 2); }
      for (const wy of bog ? [g.y - bog, g.y + bog] : [g.y]) {
        ctx.beginPath(); ctx.arc(g.x, wy, g.r, 0, TAU); ctx.fillStyle = '#20242a'; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(g.x, wy, g.r * 0.6, 0, TAU); ctx.fillStyle = PAL.steelLight; ctx.fill();
        ctx.strokeStyle = PAL.steelDark; ctx.lineWidth = g.r * 0.12;
        ctx.beginPath();
        for (let k = 0; k < 5; k++) { const a = (p.spin || 0) + (k * TAU) / 5; ctx.moveTo(g.x, wy); ctx.lineTo(g.x + Math.cos(a) * g.r * 0.58, wy + Math.sin(a) * g.r * 0.58); }
        ctx.stroke();
        ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(8,11,16,0.9)';
        ctx.beginPath(); ctx.arc(g.x, wy, g.r * 0.18, 0, TAU); ctx.fillStyle = PAL.orange; ctx.fill();
      }
      break;
    }
    case 'cab': {
      partPath(ctx, p); ctx.fillStyle = PartPaint.flat ? '#e2642e' : (() => { const g = ctx.createLinearGradient(0, b, 0, t); g.addColorStop(0, '#b8481d'); g.addColorStop(0.5, '#ef7a3c'); g.addColorStop(1, '#d4602a'); return g; })();
      ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, h * 0.12);
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(l, b + h * 0.3, w, h * 0.06);
      ctx.restore();
      // side windows: one behind the windscreen, one at the back
      ctx.fillStyle = PAL.glass;
      ctx.beginPath(); ctx.moveTo(r - w * 0.33, b + h * 0.6); ctx.lineTo(r - w * 0.47, t - h * 0.1); ctx.lineTo(x - w * 0.02, t - h * 0.1); ctx.lineTo(x - w * 0.02, b + h * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillRect(l + w * 0.1, b + h * 0.6, w * 0.32, h * 0.3); ctx.strokeRect(l + w * 0.1, b + h * 0.6, w * 0.32, h * 0.3);
      ctx.fillStyle = '#fff4d6'; ctx.fillRect(r - 0.12, b + h * 0.3, 0.12, 0.14); // headlight
      ctx.fillStyle = '#ff3b2f'; ctx.fillRect(l, b + h * 0.3, 0.1, 0.14);
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'chassis': {
      ctx.fillStyle = '#3a4048'; ctx.fillRect(l, b, w, h);
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(l, b + h * 0.35, w, h * 0.3);
      ctx.fillStyle = PAL.hazard; ctx.fillRect(l, t - h * 0.18, 0.4, h * 0.18); ctx.fillRect(r - 0.4, t - h * 0.18, 0.4, h * 0.18);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (let xx = l + 0.5; xx < r - 0.3; xx += 0.75) { ctx.beginPath(); ctx.arc(xx, y, 0.06, 0, TAU); ctx.fill(); }
      ctx.strokeRect(l, b, w, h);
      break;
    }
    // ---- weapons: stores hang on the +x side (below a wing or the fuselage), the pylon reaches to -x
    case 'gun': {
      if (d.barrels > 1) { // a rotary cannon: drum, motor and a cluster of barrels that turns as it fires
        const bw = w * 0.56, bt = b + h * 0.36;
        ctx.fillStyle = '#5d6670'; ctx.fillRect(l, b, w, h * 0.36); ctx.strokeRect(l, b, w, h * 0.36);
        ctx.fillStyle = '#2b3036'; ctx.fillRect(x - bw / 2, bt, bw, t - bt); ctx.strokeRect(x - bw / 2, bt, bw, t - bt);
        ctx.fillStyle = '#4a525b';
        for (let i = 0; i < 3; i++) { const k = Math.sin((p.spin || 0) + (i * TAU) / 3) * bw * 0.32; ctx.fillRect(x + k - bw * 0.07, bt, bw * 0.14, t - bt); }
        for (const yy of [bt + (t - bt) * 0.35, t - h * 0.06]) { ctx.fillStyle = '#1b1f24'; ctx.fillRect(x - bw * 0.62, yy, bw * 1.24, h * 0.05); }
        break;
      }
      const big = (d.calibre || 0) > 20, bw = w * (big ? 0.34 : 0.3);
      ctx.fillStyle = '#5d6670'; ctx.fillRect(l, b, w, h * 0.42); ctx.strokeRect(l, b, w, h * 0.42); // receiver
      ctx.fillStyle = '#2b3036'; ctx.fillRect(x - bw / 2, b + h * 0.42, bw, h * 0.58); ctx.strokeRect(x - bw / 2, b + h * 0.42, bw, h * 0.58); // barrel
      ctx.fillStyle = '#1b1f24'; ctx.fillRect(x - bw * 0.8, t - h * 0.08, bw * 1.6, h * 0.08); // muzzle
      if (big) { ctx.fillStyle = '#3d444c'; ctx.fillRect(l + w * 0.1, b + h * 0.08, w * 0.8, h * 0.06); }
      break;
    }
    case 'gunpod': case 'rocketpod': case 'missile': case 'bomb': {
      const pod = d.shape === 'gunpod' || d.shape === 'rocketpod', cx = x + w * 0.12, rw = w * (d.shape === 'missile' ? 0.42 : d.shape === 'bomb' ? 0.62 : 0.66);
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(l, y - h * 0.18, cx - l, h * 0.36); // pylon
      if ((p.ammo === 0) && !pod) break; // all fired: just the pylon
      const bl = cx - rw / 2, br = cx + rw / 2, bt = t - (d.shape === 'gunpod' ? h * 0.12 : 0);
      ctx.beginPath();
      if (d.shape === 'missile') {
        ctx.moveTo(bl, b + h * 0.06); ctx.lineTo(bl, t - h * 0.16); ctx.quadraticCurveTo(cx, t + h * 0.02, br, t - h * 0.16); ctx.lineTo(br, b + h * 0.06); ctx.closePath();
      } else if (d.shape === 'bomb') {
        ctx.moveTo(cx - rw * 0.2, b + h * 0.12); ctx.bezierCurveTo(bl, b + h * 0.3, bl, t - h * 0.12, cx, t);
        ctx.bezierCurveTo(br, t - h * 0.12, br, b + h * 0.3, cx + rw * 0.2, b + h * 0.12); ctx.closePath();
      } else {
        ctx.moveTo(bl, b + h * 0.05); ctx.lineTo(bl, bt - h * 0.08); ctx.quadraticCurveTo(cx, bt + h * 0.02, br, bt - h * 0.08); ctx.lineTo(br, b + h * 0.05); ctx.closePath();
      }
      ctx.fillStyle = storeColour(d); ctx.fill(); ctx.stroke();
      if (d.style) { drawStoreStyle(ctx, d, cx, rw, b, t, h); break; }
      if (d.shape === 'missile') { // fins, seeker and a band
        ctx.fillStyle = '#4d545d';
        ctx.beginPath(); ctx.moveTo(bl, b + h * 0.06); ctx.lineTo(bl - rw * 0.7, b); ctx.lineTo(bl, b + h * 0.24); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(br, b + h * 0.06); ctx.lineTo(br + rw * 0.7, b); ctx.lineTo(br, b + h * 0.24); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = d.weapon.radar ? '#e8e2d0' : '#2c3a48'; ctx.fillRect(bl, t - h * 0.2, rw, h * 0.05);
        ctx.fillStyle = d.agm ? '#3f6b3a' : '#ffb547'; ctx.fillRect(bl, y - h * 0.02, rw, h * 0.04);
      } else if (d.shape === 'bomb') { // tail fins and yellow nose band
        ctx.fillStyle = '#4b5541'; ctx.fillRect(cx - rw * 0.55, b, rw * 1.1, h * 0.12); ctx.strokeRect(cx - rw * 0.55, b, rw * 1.1, h * 0.12);
        ctx.fillStyle = PAL.hazard; ctx.fillRect(cx - rw * 0.42, t - h * 0.22, rw * 0.84, h * 0.04);
      } else if (d.shape === 'rocketpod') { // tube mouths
        ctx.fillStyle = '#1b1f24';
        for (let i = 0; i < 3; i++) ctx.fillRect(bl + rw * (0.12 + i * 0.28), bt - h * 0.06, rw * 0.18, h * 0.05);
      } else { // gun pod barrel
        ctx.fillStyle = '#2b3036'; ctx.fillRect(cx - rw * 0.1, bt - h * 0.06, rw * 0.2, h * 0.18);
      }
      break;
    }
    case 'ecm': {
      const cx = x + w * 0.12, rw = w * 0.66;
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(l, y - h * 0.18, cx - l, h * 0.36);
      ctx.beginPath(); ctx.moveTo(cx - rw / 2, b + h * 0.12); ctx.lineTo(cx - rw / 2, t - h * 0.12); ctx.quadraticCurveTo(cx, t + h * 0.02, cx + rw / 2, t - h * 0.12);
      ctx.lineTo(cx + rw / 2, b + h * 0.12); ctx.quadraticCurveTo(cx, b - h * 0.02, cx - rw / 2, b + h * 0.12); ctx.closePath();
      ctx.fillStyle = '#7d8790'; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b3036'; ctx.fillRect(cx - rw / 2, t - h * 0.2, rw, h * 0.08); ctx.fillRect(cx - rw / 2, b + h * 0.12, rw, h * 0.08); // emitter windows
      ctx.fillStyle = '#4d545d';
      for (const yy of [y - h * 0.15, y + h * 0.1]) { ctx.beginPath(); ctx.moveTo(cx + rw / 2, yy); ctx.lineTo(cx + rw / 2 + 0.18, yy - 0.05); ctx.lineTo(cx + rw / 2 + 0.18, yy + 0.12); ctx.lineTo(cx + rw / 2, yy + 0.16); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = '#7dffb0'; ctx.fillRect(cx - rw * 0.1, y - 0.05, rw * 0.2, 0.1);
      break;
    }
    case 'turret': {
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(x + w * 0.1, b + h * 0.15, w * 0.4, h * 0.7); ctx.strokeRect(x + w * 0.1, b + h * 0.15, w * 0.4, h * 0.7);
      ctx.fillStyle = '#2b3036';
      for (const dx of [-0.05, 0.05]) { ctx.fillRect(x - w * 0.09 + dx - 0.035, y, 0.07, h / 2); }
      ctx.beginPath(); ctx.ellipse(x - w * 0.04, y, w * 0.36, h * 0.34, 0, 0, TAU);
      ctx.fillStyle = PartPaint.flat ? '#7d8790' : metalGradient(ctx, x - w * 0.4, x + w * 0.32); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x - w * 0.16, y + h * 0.08, w * 0.14, h * 0.13, 0, 0, TAU); ctx.fillStyle = PAL.glass; ctx.fill(); ctx.stroke();
      break;
    }
    case 'flares': {
      ctx.fillStyle = '#4d545d'; ctx.fillRect(l, b, w, h); ctx.strokeRect(l, b, w, h);
      ctx.fillStyle = '#ffb547';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { ctx.beginPath(); ctx.arc(l + w * (0.3 + j * 0.4), b + h * (0.2 + i * 0.3), w * 0.12, 0, TAU); ctx.fill(); }
      break;
    }
    case 'smokegen': {
      ctx.fillStyle = '#d7dbe0'; ctx.fillRect(l, b, w, h); ctx.strokeRect(l, b, w, h);
      ctx.fillStyle = '#e8483a'; ctx.fillRect(l, b + h * 0.25, w, h * 0.12);
      ctx.fillStyle = '#2b3036'; ctx.fillRect(x - w * 0.25, b - h * 0.02, w * 0.5, h * 0.1);
      break;
    }
    default: // shapes without a dedicated drawing
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill(); ctx.stroke();
      break;
    case 'adapter': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, 0.12); ctx.fillRect(l, t - 0.12, w, 0.12); ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
  }
  // heat glow
  const hot = p.temp ? (p.temp - 900) / (d.maxTemp - 900) : 0;
  if (hot > 0) {
    ctx.save();
    partPath(ctx, p); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,${Math.round(110 - 60 * Math.min(1, hot))},30,${Math.min(0.85, hot * 0.9)})`;
    ctx.fillRect(l - 0.5, b - 0.5, w + 1, h + 1);
    ctx.restore();
  }
}

// Blade radius of a propeller (a ducted fan's blades stop short of its ring).
function propRadius(d) { return d.duct ? d.w / 2 - 0.2 : d.w / 2; }

// Fuselage sections with their own paint: cargo, tank, armour, stealth, intakes, tail boom, bomb bay.
function drawFuselageStyle(ctx, p, lw) {
  const d = p.def, st = d.style, x = p.x, y = p.y, w = d.w, h = d.h, l = x - w / 2, r = x + w / 2, b = y - h / 2, t = y + h / 2;
  const base = { cargo: '#8f978c', armor: '#8b939c', bay: '#a9b0b8', tank: null, intake: null, boom: null }[st];
  ctx.fillStyle = st === 'stealth' ? darkGradient(ctx, l, r) : base ? tintGradient(ctx, l, r, base) : hullGradient(ctx, l, r);
  ctx.fillRect(l, b, w, h);
  if (st === 'stealth') {
    ctx.fillStyle = '#2b2e34'; ctx.fillRect(l, b, w * 0.14, h); ctx.fillRect(r - w * 0.14, b, w * 0.14, h);
    ctx.strokeStyle = 'rgba(15,17,20,0.7)'; ctx.lineWidth = lw; sawtooth(ctx, l, r, b + h * 0.1, 0.25); sawtooth(ctx, l, r, t - h * 0.14, 0.25);
  } else if (st === 'cargo') {
    ctx.fillStyle = shade('#8f978c', -0.25); ctx.fillRect(x + w * 0.22, b, w * 0.28, h); // belly
    ctx.strokeStyle = 'rgba(20,24,28,0.75)'; ctx.lineWidth = lw * 1.2;
    ctx.strokeRect(x + w * 0.05, b + 0.15, w * 0.4, h * 0.22); // the loading ramp at the back
    ctx.strokeRect(x - w * 0.1, t - h * 0.28, w * 0.35, h * 0.16); // crew door
    ctx.fillStyle = PAL.glass; for (let yy = b + h * 0.45; yy < t - h * 0.35; yy += 0.9) { ctx.beginPath(); ctx.arc(x - w * 0.2, yy, 0.13, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#2f6fb7'; ctx.beginPath(); ctx.arc(x - w * 0.12, y, w * 0.12, 0, TAU); ctx.fill(); ctx.fillStyle = '#eef1f4'; ctx.beginPath(); ctx.arc(x - w * 0.12, y, w * 0.07, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d23a2f'; ctx.beginPath(); ctx.arc(x - w * 0.12, y, w * 0.03, 0, TAU); ctx.fill();
  } else if (st === 'tank') {
    ctx.fillStyle = '#2f6fb7'; ctx.fillRect(x + w * 0.04, b, w * 0.1, h);
    ctx.fillStyle = PAL.hazard; for (const yy of [b + h * 0.2, y, t - h * 0.2]) ctx.fillRect(l, yy - 0.08, w, 0.16);
    if (p.fuelFrac != null) { ctx.fillStyle = 'rgba(10,14,20,0.18)'; ctx.fillRect(x - w * 0.42, b + 0.1, w * 0.06, (h - 0.2) * (1 - p.fuelFrac)); }
  } else if (st === 'armor') {
    ctx.strokeStyle = 'rgba(30,34,40,0.6)'; ctx.lineWidth = lw;
    ctx.beginPath(); for (let yy = b + h / 4; yy < t - 0.01; yy += h / 4) { ctx.moveTo(l, yy); ctx.lineTo(r, yy); } ctx.moveTo(x, b); ctx.lineTo(x, t); ctx.stroke();
    ctx.fillStyle = 'rgba(30,34,40,0.55)';
    for (let yy = b + 0.15; yy < t; yy += h / 4) for (const xx of [l + 0.12, x - 0.12, x + 0.12, r - 0.12]) { ctx.beginPath(); ctx.arc(xx, yy, 0.04, 0, TAU); ctx.fill(); }
    ctx.fillStyle = PAL.orange; ctx.fillRect(x + w * 0.14, b, w * 0.04, h);
  } else if (st === 'intake') {
    ctx.fillStyle = '#2f6fb7'; ctx.fillRect(x + w * 0.04, b, w * 0.1, h);
    ctx.fillStyle = PAL.steelDark; ctx.fillRect(x - w * 0.3, b, w * 0.55, h * 0.7); // the intake duct along the cheek
    ctx.fillStyle = '#15181c'; ctx.fillRect(x - w * 0.26, t - h * 0.32, w * 0.47, h * 0.06); // its mouth
    ctx.fillStyle = PAL.hazard; ctx.fillRect(x - w * 0.3, t - h * 0.26, w * 0.55, 0.06);
  } else if (st === 'boom') {
    ctx.fillStyle = PAL.orange; ctx.fillRect(l, b, w, 0.25); ctx.fillRect(l, t - 0.25, w, 0.25);
    ctx.fillStyle = PAL.ink; ctx.fillRect(l, y - 0.04, w, 0.08);
  } else if (st === 'bay') {
    ctx.strokeStyle = 'rgba(20,24,28,0.8)'; ctx.lineWidth = lw * 1.2; // the bomb-bay doors on the belly
    ctx.strokeRect(x + w * 0.2, b + h * 0.08, w * 0.28, h * 0.84);
    ctx.beginPath(); ctx.moveTo(x + w * 0.34, b + h * 0.08); ctx.lineTo(x + w * 0.34, t - h * 0.08); ctx.stroke();
    ctx.fillStyle = PAL.hazard; ctx.fillRect(x + w * 0.2, b + h * 0.08, w * 0.28, 0.08);
    ctx.fillStyle = '#d23a2f'; for (let i = 0; i < (p.ammo == null ? 4 : p.ammo); i++) ctx.fillRect(x - w * 0.3 + i * 0.18, y - 0.06, 0.12, 0.12); // bombs left
  }
  ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, 0.06); ctx.fillRect(l, t - 0.06, w, 0.06);
  ctx.strokeStyle = 'rgba(8,11,16,0.9)'; ctx.lineWidth = lw;
  ctx.strokeRect(l, b, w, h);
}
// Missiles and bombs: their body colour, and the extra paint for the special ones.
function storeColour(d) {
  if (d.shape === 'missile') return { harm: '#e6e9ec', cruise: '#c9c2a6' }[d.style] || (d.agm ? '#c9c2a6' : '#eef1f4');
  if (d.shape === 'bomb') return { cluster: '#8d949c', guided: '#9aa38c', torpedo: '#3f464e' }[d.style] || '#5f6b52';
  return '#7d8790';
}
function drawStoreStyle(ctx, d, cx, rw, b, t, h) {
  const bl = cx - rw / 2, br = cx + rw / 2;
  switch (d.style) {
    case 'cluster': // yellow bands and a split line down the casing
      ctx.fillStyle = PAL.hazard; for (const f of [0.35, 0.55, 0.75]) ctx.fillRect(cx - rw * 0.42, b + h * f, rw * 0.84, h * 0.04);
      ctx.fillStyle = '#5d646c'; ctx.fillRect(cx - rw * 0.55, b, rw * 1.1, h * 0.12);
      break;
    case 'guided': // canards at the nose, big tail fins and a seeker window
      ctx.fillStyle = '#5d646c'; ctx.fillRect(cx - rw * 0.7, b, rw * 1.4, h * 0.14);
      ctx.fillRect(cx - rw * 0.62, t - h * 0.32, rw * 1.24, h * 0.06);
      ctx.fillStyle = '#2c3a48'; ctx.fillRect(cx - rw * 0.2, t - h * 0.1, rw * 0.4, h * 0.06);
      break;
    case 'torpedo': // contra-props and a cross of fins at the tail
      ctx.fillStyle = '#9aa3ad'; ctx.fillRect(cx - rw * 0.55, b, rw * 1.1, h * 0.05); ctx.fillRect(cx - rw * 0.4, b + h * 0.06, rw * 0.8, h * 0.03);
      ctx.fillStyle = PAL.orange; ctx.fillRect(cx - rw * 0.42, t - h * 0.2, rw * 0.84, h * 0.03);
      break;
    case 'harm': case 'cruise': { // fins, a band and (cruise) little wings mid-body
      const big = d.style === 'cruise';
      ctx.fillStyle = '#4d545d';
      ctx.beginPath(); ctx.moveTo(bl, b + h * 0.06); ctx.lineTo(bl - rw * 0.6, b); ctx.lineTo(bl, b + h * 0.2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(br, b + h * 0.06); ctx.lineTo(br + rw * 0.6, b); ctx.lineTo(br, b + h * 0.2); ctx.closePath(); ctx.fill();
      if (big) { ctx.fillStyle = '#9a9478'; ctx.fillRect(bl - rw * 0.35, b + h * 0.42, rw * 1.7, h * 0.08); ctx.fillStyle = '#2b3036'; ctx.fillRect(cx - rw * 0.25, b + h * 0.08, rw * 0.5, h * 0.06); }
      else { ctx.fillStyle = '#4d545d'; ctx.fillRect(bl, b + h * 0.5, rw, h * 0.1); ctx.fillStyle = '#e8483a'; ctx.fillRect(bl, t - h * 0.3, rw, h * 0.04); }
      break;
    }
  }
}

// Canopy for an opened parachute, drawn in part space.
function drawCanopy(ctx, p, lw) {
  const k = p.deployed;
  if (k <= 0 || p.used) return;
  const big = p.def.chuteArea > 1 ? 1.5 : 1;
  const x = p.x, base = p.y + p.def.h / 2;
  const cw = (2.5 + 6.5 * k) * big, ch = (3 + 6 * k) * big;
  const top = base + ch;
  ctx.lineWidth = lw;
  ctx.strokeStyle = 'rgba(230,230,230,0.7)';
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) { ctx.moveTo(x, base); ctx.lineTo(x + (i / 2) * cw / 2, top - ch * 0.12); }
  ctx.stroke();
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const a0 = Math.PI - (i / segs) * Math.PI, a1 = Math.PI - ((i + 1) / segs) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, top - ch * 0.12);
    ctx.ellipse(x, top - ch * 0.12, cw / 2, ch * 0.42, 0, -a0, -a1, false);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? PAL.chuteB : PAL.chuteA;
    ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(x, top - ch * 0.12, cw / 2, ch * 0.42, 0, Math.PI, TAU); ctx.strokeStyle = 'rgba(8,11,16,0.6)'; ctx.stroke();
}

// Render a whole saved design onto a small canvas (the hangar's thumbnails).
function renderDesignThumb(d, w, h, dpr, rot = 0) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  const ps = (d.parts || []).filter((q) => PARTS[q.type]).map((q) => makePart(q.type, q.x, q.y, { flip: !!q.flip, rot: (q.rot || 0) & 3 }));
  if (!ps.length) return c;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const cr = Math.cos(rot), sr = Math.sin(rot), ac = Math.abs(cr), as = Math.abs(sr);
  for (const p of ps) { // bounds in display space (planes are shown nose-right, as on the blueprint)
    const { w: pw, h: ph } = partDims(p), cx = cr * p.x - sr * p.y, cy = sr * p.x + cr * p.y;
    const hw = (ac * pw + as * ph) / 2, hh = (as * pw + ac * ph) / 2;
    x0 = Math.min(x0, cx - hw); x1 = Math.max(x1, cx + hw);
    y0 = Math.min(y0, cy - hh); y1 = Math.max(y1, cy + hh);
  }
  const s = Math.min((c.width * 0.86) / Math.max(x1 - x0, 0.5), (c.height * 0.86) / Math.max(y1 - y0, 0.5));
  const ctx = c.getContext('2d');
  ctx.setTransform(s, 0, 0, -s, c.width / 2 - (s * (x0 + x1)) / 2, c.height / 2 + (s * (y0 + y1)) / 2);
  ctx.rotate(rot);
  const lw = Math.min(0.08, dpr / s);
  for (const p of ps) if (!p.def.wing) drawPart(ctx, p, lw);
  for (const p of ps) if (p.def.wing) drawPart(ctx, p, lw); // wings pass over the hull, as in the builder
  return c;
}

// Render a part onto a small canvas for the palette.
function renderPartIcon(type, size, dpr, rot = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(size * dpr);
  const ctx = c.getContext('2d');
  const def = PARTS[type];
  const s = (size * dpr * 0.8) / Math.max(def.w, def.h, 1.2);
  ctx.setTransform(s, 0, 0, -s, c.width / 2, c.height / 2);
  ctx.rotate(rot);
  const p = { def, type, x: 0, y: 0, flip: false, deployed: 0 };
  drawPart(ctx, p, (1.4 / s) * dpr);
  return c;
}
