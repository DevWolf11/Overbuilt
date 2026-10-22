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
  // starts), load (strength, 1 = about 9 g for a light plane), dihedral (rad), flaps, vne (equivalent airspeed
  // in m/s, the HUD speed at sea level, where it starts to flutter apart: faster up high, in thinner air), mmax
  // (the Mach number where it does, up to where the air gets very thin; none for the delta, tails and strakes).
  // A subsonic wing's Mach limit keeps its breaking speed about the same at every height.

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
  wingS: { cat: 'wings', name: 'Small Wing', w: 0.35, h: 1.75, mass: 0.15, shape: 'wing', wing: { area: 7, span: 5, flaps: true, vne: 250, mmax: 0.74 }, breakSpeed: 14, tier: 0, cost: 700,
    desc: 'Short wing with ailerons and flaps, for small planes or a slow plane\'s canard (on a fast jet, use the Canard).' },
  wing: { cat: 'wings', name: 'Wing', w: 0.5, h: 3, mass: 0.4, shape: 'wing', wing: { area: 30, span: 13, flaps: true, vne: 236, mmax: 0.74 }, breakSpeed: 14, tier: 0, cost: 1500,
    desc: 'Main wing with ailerons and flaps (one part is the whole span). Put it through the fuselage near the centre of mass, high, low or in the middle. It stalls if the nose is pulled too high.' },
  wingL: { cat: 'wings', name: 'Large Wing', w: 0.8, h: 5, mass: 1.6, fuel: 3, shape: 'wing', wing: { area: 75, span: 28, flaps: true, sweep: 0.42, taper: 0.62, mcrit: 0.82, load: 1.1, vne: 264, mmax: 1.02 },
    breakSpeed: 14, tier: 1, cost: 4500, desc: 'Long, gently swept airliner wing with flaps and fuel tanks inside.' },
  wingSwept: { cat: 'wings', name: 'Swept Wing', w: 0.45, h: 4, mass: 0.6, shape: 'wing', wing: { area: 32, span: 11, sweep: 0.6, taper: 0.55, mcrit: 0.9, load: 1.4, flaps: true, vne: 375, mmax: 1.7 },
    breakSpeed: 14, tier: 2, cost: 3500, desc: 'Swept back for fast jets: less drag near Mach 1, but it needs more speed to lift.' },
  wingDelta: { cat: 'wings', name: 'Delta Wing', w: 0.5, h: 7, mass: 1.1, fuel: 1.5, shape: 'wing',
    wing: { area: 48, span: 9.5, sweep: 1, taper: 0.92, slope: 2.6, stall: 0.55, mcrit: 0.95, wave: 0.5, load: 1.8, dihedral: 0, vne: 444 },
    breakSpeed: 14, tier: 2, cost: 5000, desc: 'Big triangle for supersonic fighters. Hard to stall, little wave drag, but sluggish at low speed.' },
  wingGlider: { cat: 'wings', name: 'Glider Wing', w: 0.25, h: 1.4, mass: 0.25, shape: 'wing', wing: { area: 21, span: 19, taper: 0.5, load: 0.6, dihedral: 0.09, vne: 139, mmax: 0.5 },
    breakSpeed: 12, tier: 0, cost: 1800, desc: 'Very long, thin wing: hardly any drag, so it glides for miles. Fragile at high speed.' },
  stabilizer: { cat: 'wings', name: 'Tailplane', w: 0.3, h: 1.8, mass: 0.12, shape: 'wing', wing: { area: 6, span: 6, vne: 556 }, breakSpeed: 14, tier: 0, cost: 500,
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
    wing: { area: 38, span: 13, swing: [0.25, 1.05], taper: 0.5, mcrit: 0.8, load: 1.5, flaps: true, vne: 431, mmax: 2.5 }, breakSpeed: 14, tier: 3, cost: 8000,
    desc: 'Variable sweep: spread wide for slow flight and landing, folding back by itself as you go faster. The best of both, at a price.' },
  wingForward: { cat: 'wings', name: 'Forward-Swept Wing', w: 0.45, h: 3.6, mass: 0.75, shape: 'wing',
    wing: { area: 30, span: 11, sweep: -0.5, taper: 0.5, stall: 0.38, mcrit: 0.88, load: 1.6, flaps: true, vne: 389, mmax: 1.8 }, breakSpeed: 14, tier: 3, cost: 7000,
    desc: 'Swept forwards: the tips keep flying after the root stalls, so it stays controllable at crazy angles. Its lift sits well ahead of the part: mount it further back.' },
  wingElliptical: { cat: 'wings', name: 'Elliptical Wing', w: 0.4, h: 2.8, mass: 0.45, shape: 'wing',
    wing: { area: 27, span: 11.8, planform: 'ellipse', oswald: 0.97, flaps: true, load: 1.3, vne: 236, mmax: 0.74, dihedral: 0.07 }, breakSpeed: 14, tier: 1, cost: 3000,
    desc: 'The famous curved wing of a WWII fighter: the least drag for its lift, and a lovely shape.' },
  wingBiplane: { cat: 'wings', name: 'Biplane Wings', w: 2.2, h: 1.7, mass: 0.6, shape: 'biplane',
    wing: { area: 40, span: 10, ar: 5, gap: 1.7, thick: 0.22, stall: 0.32, oswald: 0.62, cd0: 0.03, load: 2.2, vne: 156, mmax: 0.48, dihedral: 0.05 }, breakSpeed: 14, tier: 0, cost: 2200,
    desc: 'Two wings braced with struts and wires: lots of lift and very strong, but draggy. Slow and stately, or loopy and aerobatic.' },
  wingStraightL: { cat: 'wings', name: 'Long Straight Wing', w: 0.6, h: 3.4, mass: 0.9, fuel: 1.5, shape: 'wing',
    wing: { area: 55, span: 30, taper: 0.4, flaps: true, load: 1.2, vne: 208, mmax: 0.66, dihedral: 0.05 }, breakSpeed: 14, tier: 1, cost: 3200,
    desc: 'Long, slender wing for transports and turboprops: lifts a lot at low speed and sips fuel.' },
  wingWinglet: { cat: 'wings', name: 'Winglet Wing', w: 0.8, h: 5, mass: 1.7, fuel: 3, shape: 'wing',
    wing: { area: 75, span: 29, sweep: 0.45, taper: 0.65, mcrit: 0.84, load: 1.1, oswald: 0.92, winglets: true, flaps: true, vne: 264, mmax: 1.05 }, breakSpeed: 14, tier: 2, cost: 6000,
    desc: 'Modern airliner wing with upturned winglets at the tips: less drag, longer range.' },
  wingStrake: { cat: 'wings', name: 'Strakes', w: 0.18, h: 3, mass: 0.06, shape: 'wing',
    wing: { area: 5, span: 4, sweep: 1.3, taper: 0.95, slope: 1.6, stall: 0.9, mcrit: 0.95, wave: 0.4, load: 2, vne: 556 }, breakSpeed: 14, tier: 3, cost: 2500,
    desc: 'Knife-thin extensions ahead of the wing root. They keep lifting long after the wing stalls: for wild high-angle flying.' },
  stabilizerL: { cat: 'wings', name: 'Large Tailplane', w: 0.35, h: 2.4, mass: 0.25, shape: 'wing', wing: { area: 13, span: 10, vne: 556 }, breakSpeed: 14, tier: 1, cost: 900,
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
  // (one press of K: flares, if fitted, and a bundle from here; with no dispenser the flares bring their own weaker cloud)
  chaff: { cat: 'weapons', name: 'Chaff Dispenser', w: 0.4, h: 0.9, mass: 0.03, shape: 'flares', style: 'chaff', tier: 2, cost: 1500,
    weapon: { kind: 'chaff', ammo: 24, each: 1 },
    desc: 'Bundles of foil that burst into a glittering cloud and pull radar missiles off you, far better than the cloud that comes with flares: press K (or CM). Best once the missile is a few km out, flying across its path. Flying solo it also fires on its own against radar missiles.' },
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

  // ---- 5th generation: the FS-22 (after the F-22) and FS-35 (after the F-35), at full scale. Their bodies are
  // lofted from cross-sections (us5Lofts, at the end of this file) for both the 2D art and the 3D model (body3d 'us5').
  // look: the camouflage they come in; fill: how much of the side-view box's front the body really fills (drag);
  // doors: bay or gun doors that open only to fire (stealthOf counts them while open); bayRack: where each store
  // leaves the bay, by store; vec2d: a flat nozzle that vectors in pitch only; irK: the exhaust's heat, as seen by
  // heat seekers; twinMirror: the left one of a pair is the mirror image (canted fins, gear legs).
  us5Nose22: { cat: 'cabins', name: 'FS-22 Stealth Nose', w: 2.2, h: 5.6, depth: 2.36, mass: 2.4, control: 3, torque: 3200, crew: 1, radar: 18000, stealth: 0.7,
    shape: 'us5body', us5: 'nose22', body3d: 'us5', look: 'raptor', fill: 0.6, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 4, cost: 14000,
    desc: 'The FS-22’s chined nose: a sharp-edged radome, a long radar and a frameless gold-tinted bubble canopy. Radar barely sees it. Put the Caret-Intake Fuselage behind it.' },
  us5Intake22: { cat: 'air', name: 'FS-22 Caret-Intake Fuselage', w: 2.2, h: 4.4, depth: 4.66, mass: 3.3, fuel: 2.6, stealth: 0.7, shape: 'us5body', us5: 'intake22',
    body3d: 'us5', look: 'raptor', fill: 0.45, bay: true, doors: true, bayRack: [[0.38, -0.78, -2.67], [0.38, -0.78, 2.67]], tier: 4, cost: 11000,
    weapon: { kind: 'missile', seek: 'air', ammo: 2, range: 5000, cone: 0.35, accel: 260, burn: 3, vmax: 900, turn: 30, dmg: 400, blast: 15, each: 90, life: 18 },
    desc: 'The FS-22’s middle: raked caret intakes on both cheeks, and a heat-seeking missile in a side bay behind each one. The doors swing out only to fire, so it stays stealthy until then.' },
  us5Bay22: { cat: 'weapons', name: 'Internal Missile Bay', w: 2.2, h: 3.8, depth: 4.66, mass: 3.0, fuel: 1.4, stealth: 0.7, shape: 'us5body', us5: 'bay22', body3d: 'us5',
    look: 'raptor', fill: 0.57, bay: true, doors: true, tier: 4, cost: 13000,
    bayRack: [[1.05, 0, -0.16], [1.05, 0, 0.16], [1.05, 0, -0.47], [1.05, 0, 0.47], [1.05, 0, -0.78], [1.05, 0, 0.78]],
    weapon: { kind: 'missile', seek: 'air', radar: true, ammo: 6, range: 15000, cone: 0.6, accel: 240, burn: 5, vmax: 1300, turn: 25, dmg: 450, blast: 16, each: 150, life: 30 },
    desc: 'The FS-22’s belly bay: six radar missiles inside, out of the wind and out of sight. The doors snap open for each launch and shut again, and only while they are open do enemy radars see you sooner (watch ◈).' },
  us5Aft22: { cat: 'air', name: 'FS-22 Aft Fuselage', w: 2.2, h: 2.0, depth: 4.5, mass: 1.9, fuel: 0.6, stealth: 0.7, shape: 'us5body', us5: 'aft22', body3d: 'us5', look: 'raptor',
    fill: 0.5, tier: 4, cost: 5000, desc: 'The FS-22’s tail end, with the booms that carry its tailplanes. Two Flat Vectoring Nozzle Engines go behind it, the Canted Twin Tails on top.' },
  us5Eng22: { glowAft: 7, glowK: 0.2, cat: 'airEng', name: 'Flat Vectoring Nozzle Engine', w: 1.2, h: 3.1, depth: 1.48, mass: 1.8, thrust: 186, ispSL: 5400, ispVac: 5400, gimbal: 0.35, vec2d: true, irK: 0.7,
    stealth: 0.6, air: { kind: 'jet', vmax: 580, ab: 1.3 }, shape: 'jet', us5: 'eng22', body3d: 'us5', look: 'raptor', plume: 'jet', maxTemp: 2300, tier: 4, cost: 24000,
    desc: 'The FS-22’s engine: strong enough to cruise past Mach 1.5 without the afterburner, and its flat nozzle swings up and down with the stick to pitch the plane, even stalled. It also hides the hot exhaust from heat seekers. Fit them in pairs.' },
  us5Wing22: { cat: 'wings', name: 'FS-22 Wing', w: 0.45, h: 9.84, mass: 3.0, fuel: 2.2, shape: 'wing', us5: 'wing', look: 'raptor', breakSpeed: 14, tier: 4, cost: 8000,
    wing: { area: 78, span: 13.56, sweep: 0.539, taper: 0.83, stall: 0.48, mcrit: 0.92, wave: 0.5, load: 2.6, dihedral: -0.05, flaps: true, vne: 486, mmax: 2.5 },
    desc: 'The FS-22’s big clipped-diamond wing, with fuel inside: swept 42° at the front and forwards at the back. Lifts at high angles, slips through the sound barrier. Put its root on the chines of the bay section.' },
  us5Tail22: { cat: 'wings', name: 'FS-22 Stabilators', w: 0.3, h: 5.6, mass: 0.65, shape: 'elevator', us5: 'wing', look: 'raptor', breakSpeed: 14, tier: 4, cost: 3000,
    wing: { area: 20, span: 8.84, sweep: 0.57, taper: 0.82, control: 0.35, root: 1.95 },
    desc: 'All-moving tailplanes in the same diamond shape as the wing, on booms beside the engines. They pitch the plane and help it roll.' },
  us5Fins22: { cat: 'wings', name: 'FS-22 Canted Twin Tails', w: 2.6, h: 4, mass: 0.55, twinZ: 2.0, stealth: 0.7, cant: 0.49, tipC: 1.5, tipLE: 1.25, shape: 'vtail', us5: 'fin',
    body3d: 'us5', look: 'raptor', twinMirror: true, tier: 4, cost: 2500,
    desc: 'A pair of big fins leaning outwards (28°), so radar waves glance off them, with rudders. Mount them on top of the aft fuselage.' },
  us5Gun: { cat: 'weapons', name: 'Internal Rotary Cannon', w: 0.35, h: 1.8, depth: 0.45, mass: 0.3, stealth: 0.7, shape: 'gun', us5: 'gun', body3d: 'us5', look: 'raptor', barrels: 6, calibre: 20,
    doors: true, tier: 3, cost: 8000, weapon: { kind: 'gun', ammo: 480, rate: 50, speed: 1050, dmg: 14, spread: 0.004, each: 0.26 },
    desc: 'A 20 mm six-barrel cannon buried in the skin, behind a door that snaps open as you fire: a stealth fighter’s gun. Mount it beside the fuselage at a wing root.' },
  us5GearN: { cat: 'airGear', name: 'Stealth Nose Gear', w: 0.9, h: 0.8, mass: 0.25, shape: 'gear', us5: 'gear', body3d: 'us5', wheel: { r: 0.33, drive: false, brake: true, track: 0, retract: true },
    breakSpeed: 8, tier: 3, cost: 1500, desc: 'One steerable wheel on a tall leg that folds away (G), behind doors. For the nose of a big fighter.' },
  us5GearM: { cat: 'airGear', name: 'Stealth Main Gear', w: 0.9, h: 1.0, mass: 0.7, shape: 'gear', us5: 'gear', body3d: 'us5', twinZ: 1.6, twinMirror: true,
    wheel: { r: 0.45, drive: false, brake: true, track: 0, retract: true }, breakSpeed: 9, tier: 3, cost: 2600,
    desc: 'A pair of single-wheel legs that fold into the fuselage sides (G). For heavy fighters.' },
  us5Nose35: { cat: 'cabins', name: 'FS-35 Stealth Nose', w: 2.4, h: 4.5, depth: 2.44, mass: 1.8, control: 3, torque: 3000, crew: 1, radar: 16000, stealth: 0.65,
    shape: 'us5body', us5: 'nose35', body3d: 'us5', look: 'lightning', fill: 0.6, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 4, cost: 15000,
    desc: 'The FS-35’s nose: a chined radome, the faceted window of its targeting camera under the chin and a tall bulged canopy for a good view. Put the Bump-Intake Fuselage behind it.' },
  us5Intake35: { cat: 'air', name: 'FS-35 Bump-Intake Fuselage', w: 2.4, h: 2.6, depth: 3.9, mass: 2.5, fuel: 1.8, stealth: 0.65, shape: 'us5body', us5: 'intake35', body3d: 'us5',
    look: 'lightning', fill: 0.45, tier: 4, cost: 8000,
    desc: 'The FS-35’s intakes: a smooth bump on each side sweeps the slow air away, so the inlets need no splitter plate, and the raked lips hide the engine face from radar.' },
  us5Bay35: { cat: 'weapons', name: 'FS-35 Missile Bays', w: 2.4, h: 3.8, depth: 3.84, mass: 2.3, fuel: 1.7, stealth: 0.65, shape: 'us5body', us5: 'bay35', body3d: 'us5',
    look: 'lightning', fill: 0.58, bay: true, doors: true, tier: 4, cost: 12000, bayRack: [[1.16, 0, -0.33], [1.16, 0, 0.33], [1.16, 0, -0.7], [1.16, 0, 0.7]],
    weapon: { kind: 'missile', seek: 'air', radar: true, ammo: 4, range: 15000, cone: 0.6, accel: 240, burn: 5, vmax: 1300, turn: 25, dmg: 450, blast: 16, each: 150, life: 30 },
    desc: 'Two bays in the FS-35’s belly, left and right, with two radar missiles each. Their doors open only for a launch, so the plane keeps its stealth until it shoots.' },
  us5Aft35: { cat: 'air', name: 'FS-35 Aft Fuselage', w: 2.4, h: 2.4, depth: 3.6, mass: 1.5, fuel: 0.9, stealth: 0.65, shape: 'us5body', us5: 'aft35', body3d: 'us5', look: 'lightning',
    fill: 0.5, tier: 4, cost: 5000, desc: 'The FS-35’s tail end around its single big engine, with booms for the tailplanes. The FS-35 Stealth Turbofan goes behind it.' },
  us5Eng35: { glowAft: 7, glowK: 0.2, cat: 'airEng', name: 'FS-35 Stealth Turbofan', w: 1.5, h: 2.4, depth: 1.52, mass: 1.75, thrust: 196, ispSL: 5300, ispVac: 5300, gimbal: 0.02, irK: 0.85, stealth: 0.6,
    air: { kind: 'jet', vmax: 450, ab: 1.47 }, shape: 'jet', us5: 'eng35', body3d: 'us5', look: 'lightning', plume: 'jet', maxTemp: 2300, tier: 4, cost: 32000,
    desc: 'One huge fighter engine, the most powerful ever fitted to a fighter, with a sawtooth-edged round nozzle that scatters radar. Afterburner above 90%. Runs out of puff past about Mach 1.6.' },
  us5Wing35: { cat: 'wings', name: 'FS-35 Wing', w: 0.45, h: 6.46, mass: 2.0, fuel: 1.8, shape: 'wing', us5: 'wing', look: 'lightning', breakSpeed: 14, tier: 4, cost: 7000,
    wing: { area: 42.7, span: 10.7, sweep: 0.418, taper: 0.765, stall: 0.52, mcrit: 0.88, wave: 0.6, load: 3.3, dihedral: 0.02, flaps: true, vne: 458, mmax: 2.0 },
    desc: 'The FS-35’s trapezoid wing, swept 34°, with fuel inside: big for the plane, so it is agile at low speed.' },
  us5Tail35: { cat: 'wings', name: 'FS-35 Stabilators', w: 0.25, h: 4.4, mass: 0.45, shape: 'elevator', us5: 'wing', look: 'lightning', breakSpeed: 14, tier: 4, cost: 2500,
    wing: { area: 12, span: 6.7, sweep: 0.5, taper: 0.8, control: 0.35, root: 1.5 },
    desc: 'All-moving tailplanes for the FS-35, on the booms beside its engine.' },
  us5Fins35: { cat: 'wings', name: 'FS-35 Canted Twin Tails', w: 2.1, h: 2.8, mass: 0.35, twinZ: 1.45, stealth: 0.65, cant: 0.35, tipC: 1.05, tipLE: 1.35, shape: 'vtail', us5: 'fin',
    body3d: 'us5', look: 'lightning', twinMirror: true, tier: 4, cost: 2000,
    desc: 'The FS-35’s fins, leaning out 20°, with rudders. Mount them on top of the aft fuselage.' },

  // ---- Russian look-alike jets: the MyG-21, MyG-29, Sugoi-27, Sugoi-35 and Sugoi-57, at the real aircraft's size
  // (their templates are in builder.js). The hulls are lofted from cross-sections (`loft`, `glass`: see ruSample at
  // the end of this file), drawn by RU_ART (`ru`) and lofted again in 3D by parts3d.js. A wing with a `plan` is
  // drawn in 3D to that planform, LERX and all: [[s, leading edge, trailing edge], ...], s out along the half-span
  // (0..1), the edges in metres from the part's centre (fore +). Engines: thrust in proportion to the stock ones
  // (the Fighter Turbofan stands for a 76 kN class engine), times two for a pair.
  ruIRST: { cat: 'air', name: 'IRST Ball', w: 0.36, h: 0.8, depth: 0.42, mass: 0.12, irst: 0.3, shape: 'ruLoft', ru: 'irst', ruBall: [-0.02, 0.58, 0.17],
    loft: ruG(0, 0, { s: [[0, 0.16, 0.18, 0.05], [0.15, 0.05, 0.18, 0.15], [0.42, -0.06, 0.18, 0.19], [0.6, -0.07, 0.18, 0.19], [0.8, 0, 0.18, 0.1]], n: 2, nb: 6 }),
    tier: 3, cost: 2500,
    desc: 'Infrared search-and-track: a glass ball ahead of the canopy that sees engine heat. Heat-seeking missiles lock on from 30% further away. Mount it on top of the nose.' },
  ruGearNoseL: { cat: 'airGear', name: 'Tall Nose Gear', w: 2.55, h: 0.9, mass: 0.25, shape: 'gear', wheel: { r: 0.34, drive: false, brake: true, track: 0, retract: true }, breakSpeed: 9,
    tier: 3, cost: 1000, desc: 'A long single-wheel nose leg for big fighters that sit high. Folds away (G).' },
  ruGearMainL: { cat: 'airGear', name: 'Heavy Fighter Main Gear', w: 1.6, h: 1.1, mass: 0.9, twinZ: 1.9, shape: 'gear', wheel: { r: 0.52, drive: false, brake: true, track: 0, retract: true },
    breakSpeed: 10, tier: 3, cost: 2200, desc: 'A pair of long main legs with big single wheels, one under each engine nacelle. Folds away (G).' },

  // the Sugoi-27 (after the Su-27 Flanker), also the Sugoi-35's airframe
  ruNose27: { cat: 'cabins', name: 'Sugoi-27 Nose', w: 1.7, h: 8.3, depth: 1.64, mass: 2.2, control: 3, torque: 4000, crew: 1, radar: 20000, shape: 'ruLoft', ru: 'nose',
    ruRadome: 5.9, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 3, cost: 8500,
    loft: ruG(-0.1, 13.6, { s: [[13.6, -0.95, 0.36, 0.82, -0.3], [14.3, -0.95, 0.5, 0.82, -0.25], [15.1, -0.95, 0.7, 0.82, -0.18], [16.0, -0.95, 0.75, 0.82, -0.15],
      [17.0, -0.95, 0.75, 0.8, -0.15], [17.8, -0.95, 0.72, 0.76, -0.15], [18.6, -0.83, 0.66, 0.7, -0.12], [19.5, -0.66, 0.55, 0.6, -0.08], [20.5, -0.47, 0.38, 0.44, -0.05],
      [21.3, -0.25, 0.17, 0.24, -0.04], [21.9, -0.04, -0.03, 0, -0.035]], n: 2.2, nb: 2.3 }),
    glass: ruG(-0.1, 13.6, { s: [[13.75, -0.96, -0.82, 0.1, -0.9], [14.2, -1.12, -0.78, 0.32, -0.84], [15.0, -1.32, -0.72, 0.46, -0.8], [15.9, -1.36, -0.72, 0.48, -0.79],
      [16.6, -1.25, -0.74, 0.45, -0.8], [17.05, -1.04, -0.8, 0.36, -0.86], [17.3, -0.96, -0.86, 0.2, -0.92]], n: 2, nb: 6, frames: [0.66] }),
    desc: 'The long, drooping nose of a big air-superiority fighter: a powerful radar under the radome and a bubble canopy with a view all round. Put an IRST ball ahead of the canopy.' },
  ruBody27: { cat: 'air', name: 'Sugoi-27 Centre Fuselage', w: 1.3, h: 10, depth: 2.6, mass: 3.2, fuel: 3, shape: 'ruLoft', ru: 'body', ruLines: [1.6, 3.4, 5.4, 7.6], ruBrake: [7.9, 9.4], tier: 3, cost: 4500,
    loft: ruG(-0.3, 3.6, { s: [[3.6, 0.15, 0.35, 0.38, 0.3, 2, 2], [4.2, -0.1, 0.35, 0.5, 0.28, 1.9, 3], [5.0, -0.4, 0.35, 0.72, 0.25, 1.8, 3], [6.0, -0.62, 0.35, 0.98, 0.22, 1.7, 3],
      [7.0, -0.78, 0.35, 1.18, 0.2, 1.6, 3], [8.5, -0.88, 0.35, 1.3, 0.2, 1.6, 3], [10.0, -0.93, 0.35, 1.3, 0.18, 1.6, 3], [11.5, -0.95, 0.35, 1.22, 0.1, 1.7, 3],
      [12.6, -0.95, 0.35, 1.02, -0.1, 1.9, 2.6], [13.6, -0.95, 0.36, 0.82, -0.3, 2.2, 2.3]] }),
    desc: 'The flat lifting body of a Sugoi-27, with a big airbrake on its spine and fuel inside. The nacelles hang under it; it narrows into the tail stinger.' },
  ruNacelle27: { cat: 'air', name: 'Sugoi-27 Intake Nacelles', w: 1.35, h: 10, depth: 1.4, twinZ: 1.3, mass: 2.8, fuel: 1, shape: 'ruLoft', ru: 'nacelle', ruIntake: [9.3, 10],
    loft: ruG(1.025, 3.6, { s: [[3.6, 0.33, 1.57, 0.62, 0.95, 2, 2], [5.5, 0.34, 1.58, 0.64, 0.96, 2.4, 2.4], [8.0, 0.35, 1.63, 0.68, 0.99, 3, 3], [11.0, 0.35, 1.68, 0.7, 1.0, 4.5, 4],
      [12.9, 0.35, 1.7, 0.7, 1.0, 6, 5], [13.25, 0.95, 1.7, 0.7, 1.3, 6, 5], [13.6, 1.55, 1.7, 0.68, 1.62, 6, 5]] }),
    tier: 3, cost: 3500, desc: 'A pair of engine nacelles with raked intakes, far apart with a tunnel between them. Hang them under the centre fuselage.' },
  ruAL31: { glowAft: 7, glowK: 0.2, cat: 'airEng', name: 'Sugoi-27 Twin Engines', w: 1.24, h: 2.3, depth: 1.24, twinZ: 1.3, mass: 1.8, thrust: 270, ispSL: 5200, ispVac: 5200, gimbal: 0.02,
    air: { kind: 'jet', vmax: 720, ab: 1.65 }, shape: 'jet', body3d: 'ruLoft', ru: 'jet', ruJet: { petal: 1.1, exit: 0.44 }, plume: 'jet', maxTemp: 2300, tier: 3, cost: 20000,
    loft: ruG(0.95, 1.3, { s: [[2.4, 0.37, 1.53, 0.58], [3.6, 0.33, 1.57, 0.62]], mat: 'metal' }, { s: [[1.3, 0.48, 1.42, 0.47], [2.4, 0.38, 1.52, 0.57]], mat: 'steelDark' }),
    desc: 'Two big afterburning turbofans, nozzles and all, for the back of a pair of nacelles: a Sugoi’s heart. Afterburner above 90% throttle, Mach 2 and more up high.' },
  ruStinger27: { cat: 'air', name: 'Sugoi-27 Tail Stinger', w: 0.75, h: 3.6, depth: 0.76, mass: 0.3, shape: 'ruLoft', ru: 'tail', tier: 3, cost: 900,
    loft: ruG(0.525, 0, { s: [[0, 0.47, 0.58, 0.06, 0.52], [0.25, 0.3, 0.74, 0.2, 0.52], [0.9, 0.2, 0.86, 0.32, 0.52], [2.2, 0.16, 0.9, 0.37, 0.5], [3.0, 0.15, 0.75, 0.38, 0.4],
      [3.6, 0.15, 0.42, 0.38, 0.3]] }),
    desc: 'The long boom between the engines that ends the tail: room for the brake chute and the flares, with the tail radar-warning aerial at its tip.' },
  ruBoom27: { cat: 'air', name: 'Sugoi-27 Tail Booms', w: 0.35, h: 6, depth: 0.5, twinZ: 2.25, mass: 0.5, shape: 'ruLoft', ru: 'tail', tier: 3, cost: 1100,
    loft: ruG(0.505, 0.9, { s: [[0.9, 0.47, 0.56, 0.04], [1.3, 0.38, 0.64, 0.18], [2.0, 0.33, 0.68, 0.25], [5.8, 0.33, 0.68, 0.25], [6.9, 0.36, 0.62, 0.2]], n: 3 }),
    desc: 'A pair of flat beams beside the engines that carry the fins and the tailerons.' },
  ruFins27: { cat: 'wings', name: 'Sugoi-27 Twin Fins', w: 3.17, h: 4.6, depth: 0.2, twinZ: 2.25, mass: 0.4, shape: 'vtail', body3d: 'ruFin', ru: 'fin',
    ruFin: { rte: 0.174, tle: 0.37, tte: 0, cant: 0, star: 0.12 }, tier: 3, cost: 1300, desc: 'Two tall fins with rudders, one on each tail boom.' },
  ruVentral27: { cat: 'wings', name: 'Sugoi-27 Ventral Fins', w: 0.9, h: 1.8, depth: 0.12, twinZ: 2.25, mass: 0.1, shape: 'vtail', body3d: 'ruFin', ru: 'fin',
    ruFin: { rte: 0.11, tle: 0.39, tte: 0, cant: 0.3 }, tier: 3, cost: 400, desc: 'Little fins under the tail booms, splayed outwards: steadier at high angles of attack.' },
  ruWing27: { cat: 'wings', name: 'Sugoi-27 Wing', w: 0.45, h: 9.55, mass: 2.8, fuel: 1.5, shape: 'wing',
    wing: { area: 62, span: 14.7, sweep: 0.733, taper: 0.76, slope: 3, stall: 0.45, mcrit: 0.95, wave: 0.3, load: 2.72, dihedral: 0, flaps: true, vne: 472, mmax: 2.8,
      plan: [[0, 4.775, -4.775], [0.109, 4.775, -4.775], [0.129, 4.175, -4.79], [0.17, 3.225, -4.865], [0.231, 2.025, -4.945], [0.299, 0.925, -5.045], [0.361, 0.075, -5.125],
        [0.422, -0.595, -5.215], [1, -4.425, -6.025]] },
    breakSpeed: 14, tier: 3, cost: 5500,
    desc: 'A Sugoi-27’s wing in one piece: the big curved root extension (LERX) blending into a 42° swept wing with flaps, 14.7 m across. It keeps lifting at wild angles of attack.' },
  ruTail27: { cat: 'wings', name: 'Sugoi-27 Tailerons', w: 0.18, h: 3, mass: 0.5, shape: 'elevator',
    wing: { area: 12.25, span: 9.9, sweep: 0.785, mcrit: 0.95, wave: 0.4, control: 0.22, plan: [[0.505, 1.5, -1.5], [1, -0.95, -1.95]] }, breakSpeed: 14, tier: 3, cost: 1700,
    desc: 'All-moving swept tailplanes on the tail booms (the middle of the part is left open for the engines). They pitch the plane and help it roll.' },  // the Sugoi-35 (after the Su-35): the Flanker airframe with a bigger radar and vectoring engines
  ruNose35: { cat: 'cabins', name: 'Sugoi-35 Nose', w: 1.7, h: 8.3, depth: 1.66, mass: 2.5, control: 3, torque: 4500, crew: 1, radar: 26000, shape: 'ruLoft', ru: 'nose',
    ruRadome: 5.5, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 4, cost: 10500,
    loft: ruG(-0.1, 13.6, { s: [[13.6, -0.95, 0.36, 0.83, -0.3], [14.3, -0.95, 0.5, 0.83, -0.25], [15.1, -0.95, 0.7, 0.83, -0.18], [16.0, -0.95, 0.75, 0.83, -0.15],
      [17.0, -0.95, 0.75, 0.81, -0.15], [17.8, -0.95, 0.73, 0.78, -0.15], [18.6, -0.86, 0.69, 0.73, -0.12], [19.5, -0.72, 0.6, 0.65, -0.08], [20.5, -0.52, 0.43, 0.49, -0.05],
      [21.35, -0.27, 0.2, 0.26, -0.04], [21.9, -0.04, -0.03, 0, -0.035]], n: 2.2, nb: 2.3 }),
    glass: ruG(-0.1, 13.6, { s: [[13.75, -0.96, -0.82, 0.1, -0.9], [14.2, -1.12, -0.78, 0.32, -0.84], [15.0, -1.32, -0.72, 0.46, -0.8], [15.9, -1.36, -0.72, 0.48, -0.79],
      [16.6, -1.25, -0.74, 0.45, -0.8], [17.05, -1.04, -0.8, 0.36, -0.86], [17.3, -0.96, -0.86, 0.2, -0.92]], n: 2, nb: 6, frames: [0.66] }),
    desc: 'An upgraded Sugoi nose: a bigger, longer-reaching radar under a fatter radome. Put an IRST ball ahead of the canopy, a little to the right.' },
  ruAL41: { glowAft: 7, glowK: 0.2, cat: 'airEng', name: 'Sugoi-35 Vectoring Engines', w: 1.26, h: 2.5, depth: 1.26, twinZ: 1.3, mass: 2.0, thrust: 282, ispSL: 5000, ispVac: 5000, gimbal: 0.1, vector: true,
    air: { kind: 'jet', vmax: 760, ab: 1.65 }, shape: 'jet', body3d: 'ruLoft', ru: 'jet', ruJet: { petal: 1.4, exit: 0.45 }, plume: 'jet', maxTemp: 2300, tier: 4, cost: 26000,
    loft: ruG(0.95, 1.1, { s: [[2.5, 0.36, 1.54, 0.59], [3.6, 0.33, 1.57, 0.63]], mat: 'metal' }, { s: [[1.1, 0.47, 1.43, 0.48], [2.5, 0.37, 1.53, 0.58]], mat: 'steelDark', vec: 1.4 }),
    desc: 'A pair of uprated afterburning turbofans whose nozzles swivel in every direction with the stick: the plane still turns when its wings have stalled. Afterburner above 90%.' },
  ruStinger35: { cat: 'air', name: 'Sugoi-35 Tail Stinger', w: 0.8, h: 3.6, depth: 0.86, mass: 0.35, shape: 'ruLoft', ru: 'tail', tier: 4, cost: 1100,
    loft: ruG(0.53, 0, { s: [[0.35, 0.36, 0.7, 0.14, 0.53], [0.7, 0.2, 0.86, 0.33, 0.53], [1.6, 0.14, 0.93, 0.42, 0.52], [3.0, 0.13, 0.78, 0.43, 0.4], [3.6, 0.15, 0.42, 0.39, 0.3]] }),
    desc: 'A shorter, fatter stinger between the engines, packed with radar-warning gear and flares.' },

  // the MyG-29 (after the MiG-29 Fulcrum)
  ruGearNose2: { cat: 'airGear', name: 'Twin Nose Gear', w: 2.0, h: 0.9, mass: 0.18, shape: 'gear', wheel: { r: 0.3, drive: false, brake: true, track: 0.52, retract: true }, breakSpeed: 9,
    tier: 3, cost: 1200, desc: 'A long nose leg with two wheels side by side, for fighters that sit high. Folds away (G).' },
  ruGearMain: { cat: 'airGear', name: 'Fighter Main Gear', w: 1.2, h: 0.9, mass: 0.45, twinZ: 1.4, shape: 'gear', wheel: { r: 0.4, drive: false, brake: true, track: 0, retract: true },
    breakSpeed: 9, tier: 2, cost: 2000, desc: 'A pair of main legs with single wheels, one each side under the wing roots or nacelles. Folds away (G).' },
  ruNose29: { cat: 'cabins', name: 'MyG-29 Nose', w: 1.5, h: 6.5, depth: 1.44, mass: 1.6, control: 3, torque: 3000, crew: 1, radar: 16000, shape: 'ruLoft', ru: 'nose', ruRadome: 3.9,
    aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 3, cost: 7500,
    loft: ruG(-0.1, 10.4, { s: [[10.4, -0.85, 0.32, 0.72, -0.26], [11.0, -0.85, 0.45, 0.72, -0.22], [11.8, -0.85, 0.6, 0.72, -0.15], [12.6, -0.85, 0.65, 0.7, -0.12],
      [13.9, -0.84, 0.64, 0.64, -0.08], [14.6, -0.7, 0.58, 0.55, -0.04], [15.3, -0.5, 0.47, 0.44, 0], [15.9, -0.3, 0.35, 0.31, 0.04], [16.5, -0.1, 0.22, 0.16, 0.07],
      [16.9, 0.07, 0.11, 0, 0.09]], n: 2.2, nb: 2.3 }),
    glass: ruG(-0.1, 10.4, { s: [[10.55, -0.86, -0.74, 0.1, -0.8], [11.0, -1.05, -0.7, 0.3, -0.75], [11.7, -1.2, -0.66, 0.42, -0.72], [12.4, -1.18, -0.68, 0.42, -0.73],
      [12.95, -1.0, -0.74, 0.34, -0.78], [13.25, -0.86, -0.8, 0.18, -0.83]], n: 2, nb: 6, frames: [0.7] }),
    desc: 'A light fighter’s drooping nose with its radar and a bubble canopy. Put an IRST ball just ahead of the windscreen.' },
  ruBody29: { cat: 'air', name: 'MyG-29 Centre Fuselage', w: 1.15, h: 7.4, depth: 2.2, mass: 2.2, fuel: 2, shape: 'ruLoft', ru: 'body', ruLines: [1.0, 2.6, 4.2, 5.8], tier: 3, cost: 4000,
    loft: ruG(-0.275, 3.0, { s: [[3.0, 0.08, 0.3, 0.36, 0.25, 2, 2], [3.6, -0.15, 0.3, 0.45, 0.22, 1.9, 3], [4.6, -0.42, 0.3, 0.7, 0.18, 1.8, 3], [6.0, -0.62, 0.3, 0.98, 0.15, 1.7, 3],
      [7.5, -0.76, 0.3, 1.1, 0.12, 1.6, 3], [9.0, -0.84, 0.3, 1.0, 0, 1.8, 2.8], [10.4, -0.85, 0.32, 0.72, -0.26, 2.2, 2.3]] }),
    desc: 'The flat lifting fuselage of a MyG-29, its hump behind the canopy full of fuel. The intake nacelles hang under it.' },
  ruNacelle29: { cat: 'air', name: 'MyG-29 Intake Nacelles', w: 1.15, h: 7.2, depth: 1.2, twinZ: 1.2, mass: 1.8, fuel: 0.6, shape: 'ruLoft', ru: 'nacelle', ruIntake: [6.2, 7.2],
    loft: ruG(0.875, 2.8, { s: [[2.8, 0.355, 1.395, 0.52, 0.875, 2, 2], [4.5, 0.33, 1.42, 0.56, 0.88, 2.5, 2.5], [6.5, 0.3, 1.45, 0.6, 0.9, 3.5, 3.5], [9.0, 0.3, 1.45, 0.6, 0.9, 6, 5],
      [9.4, 0.75, 1.45, 0.6, 1.1, 6, 5], [10.0, 1.32, 1.45, 0.58, 1.38, 6, 5]] }),
    tier: 3, cost: 3000, desc: 'Two widely spaced engine nacelles with ramp intakes under the wing-root extensions, and a lifting tunnel between them.' },
  ruRD33: { glowAft: 7, glowK: 0.2, cat: 'airEng', name: 'MyG-29 Twin Engines', w: 1.04, h: 2.2, depth: 1.04, twinZ: 1.2, mass: 1.4, thrust: 162, ispSL: 5000, ispVac: 5000, gimbal: 0.02,
    air: { kind: 'jet', vmax: 720, ab: 1.65 }, shape: 'jet', body3d: 'ruLoft', ru: 'jet', ruJet: { petal: 1.0, exit: 0.36 }, plume: 'jet', maxTemp: 2300, tier: 3, cost: 18000,
    loft: ruG(0.875, 0.6, { s: [[1.6, 0.4, 1.35, 0.47], [2.8, 0.355, 1.395, 0.52]], mat: 'metal' }, { s: [[0.6, 0.48, 1.27, 0.38], [1.6, 0.41, 1.34, 0.46]], mat: 'steelDark' }),
    desc: 'Two light afterburning turbofans for a pair of nacelles: a nimble fighter’s engines. Afterburner above 90% throttle.' },
  ruBeaver29: { cat: 'air', name: 'MyG-29 Beavertail', w: 0.3, h: 3, depth: 1.1, mass: 0.15, shape: 'ruLoft', ru: 'tail', tier: 3, cost: 600,
    loft: ruG(0.27, 0, { s: [[0, 0.22, 0.32, 0.3, 0.27], [0.6, 0.15, 0.38, 0.52, 0.27], [2.4, 0.12, 0.42, 0.55, 0.27], [3.0, 0.12, 0.3, 0.4, 0.22, 2.5, 2.5]], n: 3 }),
    desc: 'The flat tail between the engines, with the brake chute and the airbrakes.' },
  ruBoom29: { cat: 'air', name: 'MyG-29 Tail Booms', w: 0.3, h: 4.7, depth: 0.45, twinZ: 2.025, mass: 0.3, shape: 'ruLoft', ru: 'tail', tier: 3, cost: 1000,
    loft: ruG(0.45, 0.7, { s: [[0.7, 0.4, 0.5, 0.04], [1.0, 0.33, 0.57, 0.15], [1.6, 0.3, 0.6, 0.22], [4.6, 0.3, 0.6, 0.22], [5.4, 0.33, 0.56, 0.18]], n: 3 }),
    desc: 'A pair of flat beams outside the engines for the fins and tailerons.' },
  ruFins29: { cat: 'wings', name: 'MyG-29 Twin Fins', w: 2.5, h: 3.8, depth: 0.18, twinZ: 2.025, mass: 0.3, shape: 'vtail', body3d: 'ruFin', ru: 'fin', twinMirror: true,
    ruFin: { rte: 0.105, tle: 0.295, tte: 0, cant: 0.105, star: 0.13 }, tier: 3, cost: 1200, desc: 'Two fins with rudders, leaning slightly outwards, one on each tail boom.' },
  ruTail29: { cat: 'wings', name: 'MyG-29 Tailerons', w: 0.15, h: 2.4, mass: 0.3, shape: 'elevator',
    wing: { area: 7.05, span: 7.78, sweep: 0.873, mcrit: 0.95, wave: 0.4, control: 0.35, plan: [[0.578, 1.2, -1.2], [1, -0.75, -1.6]] }, breakSpeed: 14, tier: 3, cost: 1600,
    desc: 'All-moving swept tailplanes on the tail booms (open in the middle for the engines).' },
  ruWing29: { cat: 'wings', name: 'MyG-29 Wing', w: 0.36, h: 9.05, mass: 1.6, fuel: 0.6, shape: 'wing',
    wing: { area: 38, span: 11.36, sweep: 0.85, taper: 0.8, slope: 2.9, stall: 0.45, mcrit: 0.95, wave: 0.3, load: 2.45, dihedral: 0, flaps: true, vne: 472, mmax: 2.6,
      plan: [[0, 4.525, -4.525], [0.127, 4.525, -4.475], [0.167, 3.725, -4.455], [0.229, 2.525, -4.415], [0.29, 1.375, -4.375], [0.343, 0.375, -4.345], [1, -2.985, -4.175]] },
    breakSpeed: 14, tier: 3, cost: 5000,
    desc: 'A MyG-29’s wing in one piece: sharp 73° root extensions running into a 42° swept wing with flaps, 11.4 m across.' },

  // the Sugoi-57 (after the Su-57): stealthy, chined, its weapons inside
  ruGearNose2L: { cat: 'airGear', name: 'Tall Twin Nose Gear', w: 2.45, h: 0.9, mass: 0.24, shape: 'gear', wheel: { r: 0.32, drive: false, brake: true, track: 0.55, retract: true },
    breakSpeed: 9, tier: 4, cost: 1300, desc: 'A tall nose leg with two wheels side by side, for a big fighter. Folds away (G).' },
  ruNose57: { cat: 'cabins', name: 'Sugoi-57 Nose', w: 1.38, h: 7.5, depth: 1.84, mass: 2.2, control: 3, torque: 4500, crew: 1, radar: 28000, stealth: 0.6, shape: 'ruLoft', ru: 'nose',
    ruRadome: 5.0, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 4, cost: 13000,
    loft: ruG(-0.09, 12.6, { s: [[12.6, -0.78, 0.25, 0.92, 0.1], [13.4, -0.78, 0.4, 0.88, 0.12], [14.4, -0.78, 0.53, 0.82, 0.14], [15.4, -0.78, 0.58, 0.76, 0.15],
      [16.4, -0.78, 0.57, 0.68, 0.15], [17.2, -0.76, 0.52, 0.58, 0.15], [18.0, -0.56, 0.42, 0.46, 0.14], [18.8, -0.34, 0.31, 0.33, 0.12], [19.5, -0.15, 0.2, 0.19, 0.1],
      [20.1, 0.06, 0.09, 0, 0.08]], n: 2, nb: 2.6, chine: true }),
    glass: ruG(-0.09, 12.6, { s: [[13.0, -0.79, -0.7, 0.1, -0.74], [13.5, -0.98, -0.62, 0.36, -0.66], [14.3, -1.17, -0.56, 0.5, -0.6], [15.2, -1.2, -0.56, 0.52, -0.6],
      [15.9, -1.1, -0.58, 0.48, -0.63], [16.3, -0.92, -0.64, 0.36, -0.7], [16.6, -0.79, -0.72, 0.16, -0.76]], n: 2, nb: 6, gold: true }),
    desc: 'A chined stealth nose with a long frameless, gold-tinted canopy and a powerful radar. Radar glances off it.' },
  ruBody57: { cat: 'air', name: 'Sugoi-57 Centre Fuselage', w: 1.03, h: 9.1, depth: 3.5, mass: 4.0, fuel: 4, stealth: 0.6, shape: 'ruLoft', ru: 'body', ruLines: [1.4, 3.2, 5.4, 7.6],
    loft: ruG(-0.265, 3.5, { s: [[3.5, 0, 0.25, 0.5, 0.18, 1.6, 3], [4.5, -0.35, 0.25, 1.0, 0.15, 1.4, 4], [6.0, -0.58, 0.25, 1.55, 0.12, 1.3, 4], [8.0, -0.72, 0.25, 1.75, 0.1, 1.3, 4],
      [10.0, -0.78, 0.25, 1.62, 0.1, 1.4, 4], [11.5, -0.78, 0.25, 1.25, 0.1, 1.7, 3], [12.6, -0.78, 0.25, 0.92, 0.1, 2, 2.6]], chine: true }),
    tier: 4, cost: 8000, desc: 'A wide, flat, chined stealth body with fuel inside. The engines hang far apart under it, with the weapons bay between them.' },
  ruNacelle57: { cat: 'air', name: 'Sugoi-57 Intake Nacelles', w: 1.2, h: 9.7, depth: 1.3, twinZ: 1.7, mass: 3.2, fuel: 1.0, stealth: 0.6, shape: 'ruLoft', ru: 'nacelle',
    ruIntake: [8.9, 9.7, 'bot'],
    loft: ruG(0.85, 3.5, { s: [[3.5, 0.275, 1.425, 0.575, 0.85, 2, 2], [5.5, 0.26, 1.44, 0.6, 0.86, 3, 3], [8.0, 0.25, 1.45, 0.64, 0.85, 4, 4], [11.5, 0.25, 1.45, 0.65, 0.85, 5, 5],
      [12.4, 0.25, 1.45, 0.65, 0.85, 6, 6], [12.8, 0.25, 1.05, 0.65, 0.65, 6, 6], [13.2, 0.25, 0.62, 0.62, 0.44, 6, 6]] }),
    tier: 4, cost: 5500, desc: 'Two engine nacelles set far apart, with raked stealthy intakes.' },
  ruAL41F1: { glowAft: 7, glowK: 0.2, cat: 'airEng', name: 'Sugoi-57 Vectoring Engines', w: 1.15, h: 2.7, depth: 1.15, twinZ: 1.7, mass: 2.2, thrust: 304, ispSL: 5000, ispVac: 5000, gimbal: 0.3, vector: true,
    air: { kind: 'jet', vmax: 770, ab: 1.58 }, shape: 'jet', body3d: 'ruLoft', ru: 'jet', ruJet: { petal: 1.5, exit: 0.4 }, plume: 'jet', maxTemp: 2300, tier: 4, cost: 33500,
    loft: ruG(0.85, 0.8, { s: [[2.3, 0.32, 1.38, 0.53], [3.5, 0.275, 1.425, 0.575]], mat: 'metal' }, { s: [[0.8, 0.4, 1.3, 0.43], [2.3, 0.33, 1.37, 0.52]], mat: 'steelDark', vec: 1.5 }),
    desc: 'The newest pair of afterburning turbofans: strong enough to cruise past Mach 1, with nozzles that swivel with the stick. Afterburner above 90%.' },
  ruBay57: { cat: 'weapons', name: 'Internal Radar Missiles', w: 0.45, h: 6, depth: 2.1, mass: 0.6, stealth: 0.6, bay: true, doors: true, shape: 'ruLoft', ru: 'bay', tier: 4, cost: 21000,
    weapon: { kind: 'missile', seek: 'air', radar: true, label: 'RV-77', ammo: 4, range: 15000, cone: 0.6, accel: 240, burn: 5, vmax: 1300, turn: 25, dmg: 450, blast: 16, each: 150, life: 30 },
    loft: ruG(0.475, 5.0, { s: [[5.0, 0.25, 0.4, 0.9, 0.3, 4, 4], [5.6, 0.25, 0.65, 1.04, 0.4, 5, 5], [10.4, 0.25, 0.68, 1.04, 0.4, 5, 5], [11.0, 0.25, 0.45, 0.95, 0.3, 4, 4]] }),
    desc: 'Two long bays between the engines with four radar missiles inside: no drag, and a stealth plane stays stealthy. They ride your nose radar like the outside ones.' },
  ruBayS57: { cat: 'weapons', name: 'Internal Heat Seekers', w: 0.36, h: 3, depth: 0.5, twinZ: 2.6, mass: 0.1, stealth: 0.6, bay: true, doors: true, shape: 'ruLoft', ru: 'bay', tier: 4, cost: 8000,
    weapon: { kind: 'missile', seek: 'air', label: 'RV-74', ammo: 2, range: 5000, cone: 0.35, accel: 260, burn: 3, vmax: 900, turn: 30, dmg: 400, blast: 15, each: 90, life: 18 },
    loft: ruG(0.43, 9.0, { s: [[9.0, 0.25, 0.32, 0.12, 0.27, 3, 3], [9.5, 0.25, 0.58, 0.24, 0.35, 4, 4], [11.4, 0.25, 0.6, 0.24, 0.36, 4, 4], [12.0, 0.25, 0.36, 0.16, 0.28, 3, 3]] }),
    desc: 'A pair of little bays in the wing roots, outside the intakes, each with a heat seeker inside.' },
  ruStinger57: { cat: 'air', name: 'Sugoi-57 Tail Cone', w: 0.5, h: 3.5, depth: 1.0, mass: 0.25, stealth: 0.6, shape: 'ruLoft', ru: 'tail', tier: 4, cost: 1000,
    loft: ruG(0.25, 0, { s: [[0, 0.18, 0.32, 0.1, 0.25, 1.6, 2], [0.6, 0.06, 0.45, 0.35, 0.25, 1.6, 2.5], [2.8, 0, 0.5, 0.48, 0.22, 1.6, 3], [3.5, 0, 0.25, 0.5, 0.18, 1.6, 3]], chine: true }),
    desc: 'A short flat tail cone between the engines.' },
  ruBoom57: { cat: 'air', name: 'Sugoi-57 Tail Booms', w: 0.3, h: 4.5, depth: 0.5, twinZ: 2.6, mass: 0.5, stealth: 0.6, shape: 'ruLoft', ru: 'tail', tier: 4, cost: 1200,
    loft: ruG(0.4, 0.8, { s: [[0.8, 0.36, 0.44, 0.04], [1.1, 0.28, 0.52, 0.16], [1.6, 0.25, 0.55, 0.25], [4.6, 0.25, 0.55, 0.25], [5.3, 0.28, 0.52, 0.2]], n: 3 }),
    desc: 'A pair of flat beams outside the engines for the fins and tailerons.' },
  ruFins57: { cat: 'wings', name: 'Sugoi-57 All-Moving Fins', w: 2.16, h: 3.6, depth: 0.16, twinZ: 2.6, mass: 0.35, stealth: 0.6, shape: 'vtail', body3d: 'ruFin', ru: 'fin', twinMirror: true,
    ruFin: { rte: 0.167, tle: 0.333, tte: 0, cant: 0.454, all: true, star: 0.13 }, tier: 4, cost: 2200,
    desc: 'Two small fins canted outwards (stealthy), each turning all in one piece as a rudder.' },
  ruTail57: { cat: 'wings', name: 'Sugoi-57 Tailerons', w: 0.14, h: 2.8, mass: 0.5, shape: 'elevator',
    wing: { area: 10, span: 10, sweep: 0.785, mcrit: 0.95, wave: 0.4, control: 0.35, plan: [[0.57, 1.4, -1.4], [1, -0.75, -1.75]] }, breakSpeed: 14, tier: 4, cost: 2000,
    desc: 'All-moving tailplanes on the tail booms (open in the middle for the engines).' },
  ruLevcon57: { cat: 'wings', name: 'Sugoi-57 LEVCONs', w: 0.12, h: 2.7, mass: 0.25, shape: 'elevator',
    wing: { area: 5, span: 5.3, sweep: 1.1, mcrit: 0.95, wave: 0.5, control: 0.25, plan: [[0.377, 1.35, -1.35], [1, -1.9, -2.2]] }, breakSpeed: 14, tier: 4, cost: 2500,
    desc: 'Leading-edge vortex controllers: moving root extensions ahead of the wing that pitch the nose like canards and keep it flying at wild angles.' },
  ruWing57: { cat: 'wings', name: 'Sugoi-57 Wing', w: 0.36, h: 7.4, mass: 3.0, fuel: 1.0, shape: 'wing',
    wing: { area: 74, span: 14.1, sweep: 0.6, taper: 0.8, slope: 3.0, stall: 0.45, mcrit: 0.95, wave: 0.5, load: 2.3, dihedral: 0, flaps: true, vne: 472, mmax: 2.6,
      plan: [[0, 3.7, -3.7], [0.17, 3.7, -3.55], [0.369, 3.5, -3.35], [1, -1.44, -2.74]] },
    breakSpeed: 14, tier: 4, cost: 7500, desc: 'A big 48° swept stealth wing with flaps, 14.1 m across. Put the LEVCONs ahead of its roots.' },

  // the MyG-21 (after the MiG-21 Fishbed)
  ruGearNose: { cat: 'airGear', name: 'Short Nose Gear', w: 0.78, h: 0.8, mass: 0.1, shape: 'gear', wheel: { r: 0.27, drive: false, brake: true, track: 0, retract: true }, breakSpeed: 8,
    tier: 2, cost: 900, desc: 'A short single-wheel nose leg for a small fighter. Folds away (G).' },
  ruNose21: { cat: 'cabins', name: 'MyG-21 Shock-Cone Nose', w: 1.57, h: 5.1, depth: 1.24, mass: 1.3, control: 3, torque: 2200, crew: 1, radar: 8000, shape: 'ruLoft', ru: 'nose21',
    ruCone: 4.4, ruLip: 4.7, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 2, cost: 7500,
    loft: ruG(-0.165, 9.4, { s: [[9.4, -0.62, 0.62, 0.62, 0], [11.0, -0.62, 0.62, 0.62, 0], [12.6, -0.59, 0.59, 0.59, 0], [13.6, -0.53, 0.53, 0.53, 0], [14.1, -0.48, 0.48, 0.48, 0]], open: true },
      { s: [[13.8, -0.31, 0.31, 0.31, 0], [14.15, -0.25, 0.25, 0.25, 0], [14.5, -0.01, 0.01, 0, 0]] },
      { s: [[9.4, -0.92, -0.3, 0.28, -0.55], [9.95, -0.93, -0.3, 0.3, -0.55]] }),
    glass: ruG(-0.165, 9.4, { s: [[9.95, -0.93, -0.55, 0.3, -0.6], [10.4, -0.99, -0.52, 0.36, -0.57], [11.0, -1.0, -0.5, 0.37, -0.55], [11.5, -0.92, -0.52, 0.33, -0.57],
      [11.85, -0.72, -0.56, 0.2, -0.6], [12.0, -0.63, -0.59, 0.05, -0.61]], n: 2, nb: 6, frames: [0.62] }),
    desc: 'A round nose that is all intake, with the radar in the shock cone in its mouth and a small bubble canopy behind. A long pitot boom on top.' },
  ruBody21: { cat: 'air', name: 'MyG-21 Fuselage', w: 1.57, h: 6.2, depth: 1.24, mass: 1.6, fuel: 2, shape: 'ruLoft', ru: 'body', ruLines: [0.8, 2.4, 4.0, 5.4], tier: 2, cost: 3500,
    loft: ruG(-0.165, 3.2, { s: [[3.2, -0.6, 0.6, 0.6, 0], [5.0, -0.61, 0.62, 0.62, 0.005], [9.4, -0.62, 0.62, 0.62, 0]] },
      { s: [[4.4, -0.6, -0.3, 0.1, -0.45], [5.4, -0.8, -0.3, 0.2, -0.5], [8.0, -0.9, -0.3, 0.26, -0.55], [9.4, -0.92, -0.3, 0.28, -0.55]] }),
    desc: 'A slim round fuselage full of fuel, with the dorsal spine running back from the canopy to the fin.' },
  ruR25: { glowAft: 7, glowK: 0.2, cat: 'airEng', name: 'MyG-21 Afterburning Turbojet', w: 1.2, h: 3.2, depth: 1.2, mass: 1.25, thrust: 103, ispSL: 4000, ispVac: 4000, gimbal: 0.02, air: { kind: 'jet', vmax: 800, ab: 1.73 },
    shape: 'jet', body3d: 'ruLoft', ru: 'jet', ruJet: { petal: 1.0, exit: 0.4, paint: true }, plume: 'jet', maxTemp: 2300, tier: 2, cost: 14500,
    loft: ruG(0, 0, { s: [[1.0, -0.52, 0.52, 0.52], [3.2, -0.6, 0.6, 0.6]] }, { s: [[0, -0.45, 0.45, 0.45], [1.0, -0.5, 0.5, 0.5]], mat: 'steelDark' }),
    desc: 'The rear fuselage of a small fighter with its afterburning turbojet and nozzle: thirsty, loud and fast. Afterburner above 90% throttle.' },
  ruWing21: { cat: 'wings', name: 'MyG-21 Delta Wing', w: 0.25, h: 6.1, mass: 0.9, fuel: 0.3, shape: 'wing',
    wing: { area: 23, span: 7.15, sweep: 0.8, taper: 0.9, slope: 2.6, stall: 0.5, mcrit: 0.95, wave: 0.45, load: 2.25, dihedral: 0, flaps: true, vne: 472,
      plan: [[0, 3.05, -3.05], [0.173, 2.1, -3.05], [1, -2.45, -3.05]] },
    breakSpeed: 14, tier: 2, cost: 3800, desc: 'A small, thin 57° delta with clipped tips, 7.2 m across: little drag at Mach 2, but it needs speed to lift.' },
  ruTail21: { cat: 'wings', name: 'MyG-21 Stabilator', w: 0.12, h: 1.9, mass: 0.12, shape: 'elevator',
    wing: { area: 4.5, span: 3.6, sweep: 0.96, taper: 0.6, mcrit: 0.95, wave: 0.5, control: 0.35 }, breakSpeed: 14, tier: 2, cost: 1000,
    desc: 'A small swept all-moving tailplane, low on the tail behind a delta.' },
  ruFin21: { cat: 'wings', name: 'MyG-21 Fin', w: 2.2, h: 4.1, depth: 0.16, mass: 0.15, shape: 'vtail', body3d: 'ruFin', ru: 'fin',
    ruFin: { rte: 0.024, tle: 0.27, tte: 0, cant: 0, star: 0.12 }, tier: 2, cost: 600, desc: 'A big fin swept back at 60°, with a rudder. Stand it on the spine at the tail.' },
  ruAAM21: { cat: 'weapons', name: 'Early Heat Seekers', w: 0.4, h: 2.8, mass: 0.04, shape: 'missile', twinZ: 2.3, pod: true, aero: true, tier: 2, cost: 6000,
    weapon: { kind: 'missile', seek: 'air', label: 'RV-13', ammo: 2, range: 4000, cone: 0.3, accel: 230, burn: 2.5, vmax: 800, turn: 24, dmg: 380, blast: 14, each: 75, life: 16 },
    desc: 'A pair of first-generation heat seekers for a small wing: they lock on to a hot engine from 4 km, best from behind, and turn less hard than the newer ones. Flares fool them easily.' },
  ruVentral21: { cat: 'wings', name: 'MyG-21 Ventral Fin', w: 0.3, h: 1.7, depth: 0.1, mass: 0.03, shape: 'vtail', body3d: 'ruFin', ru: 'fin',
    ruFin: { rte: 0.1, tle: 0.45, tte: 0, cant: 0 }, tier: 2, cost: 300, desc: 'A little fin under the tail, for steadiness at Mach 2.' },

  // ---- US 3rd- and 4th-generation look-alikes (FS-4, FS-16, FS-15): lofted bodies, see us4Rows at the end of this file
  // shared by the FS look-alikes: single-wheel gear legs and the 20 mm cannon
  us4LegS: { flush: true, cat: 'airGear', name: 'Short Gear Leg', w: 0.75, h: 0.7, mass: 0.1, shape: 'gear', wheel: { r: 0.3, drive: false, brake: true, track: 0, retract: true }, breakSpeed: 8, tier: 2, cost: 700,
    desc: 'A single small wheel on a short leg that folds away (G): the nose gear of a low-slung fighter.' },
  us4LegM: { flush: true, cat: 'airGear', name: 'Gear Leg', w: 1.3, h: 0.9, mass: 0.22, shape: 'gear', wheel: { r: 0.42, drive: false, brake: true, track: 0, retract: true }, breakSpeed: 8, tier: 2, cost: 900,
    desc: 'A single wheel on a leg that folds away (G). Use a pair, one each side, for a fighter\'s main gear.' },
  us4LegL: { flush: true, cat: 'airGear', name: 'Long Gear Leg', w: 1.75, h: 0.9, mass: 0.28, shape: 'gear', wheel: { r: 0.42, drive: false, brake: true, track: 0, retract: true }, breakSpeed: 8, tier: 2, cost: 1100,
    desc: 'A single wheel on a long leg that folds away (G): a tall fighter\'s nose gear, or one under each wing for a wide stance.' },
  us4Vulcan: { flush: true, cat: 'weapons', name: '20 mm Rotary Cannon', w: 0.32, h: 1.8, mass: 0.12, shape: 'gun', barrels: 6, calibre: 20, tier: 3, cost: 7000, weapon: { kind: 'gun', ammo: 510, rate: 50, speed: 1030, dmg: 11, spread: 0.005, each: 0.25 },
    desc: 'Six spinning 20 mm barrels: a short, savage burst for dogfights. Tuck it inside the fuselage with just the muzzle at a gun port.' },
  // FS-4 (3rd generation, after the F-4 Phantom II)
  us4f4Nose: { cat: 'cabins', name: 'FS-4 Twin-Seat Nose', w: 2.18, h: 8.6, depth: 1.46, fill: 0.72, mass: 2.3, control: 3, torque: 4000, crew: 2, radar: 14000, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 2, cost: 6000, shape: 'us4body',
    body: { tubes: [
      { st: [[-4.3, -0.71, 0.37, 1.09, 0.73, 2.6, 3.2], [-3.3, -0.63, 0.35, 1.07, 0.7, 2.6, 3], [-2.1, -0.53, 0.33, 1.03, 0.68, 2.5, 2.8], [-0.9, -0.47, 0.32, 0.97, 0.66, 2.4, 2.6], [0.1, -0.43, 0.31, 0.91, 0.63, 2.3, 2.4], [1.3, -0.35, 0.31, 0.82, 0.57, 2.2, 2.2], [2.3, -0.25, 0.32, 0.73, 0.48, 2, 2], [3.4, -0.07, 0.33, 0.59, 0.31, 2, 2], [4.3, 0.31, 0.33, 0.35, 0, 2, 2]] },
      { st: [[-4.3, -0.83, -0.71, -0.55, 0.3, 2], [-3.7, -0.99, -0.73, -0.47, 0.4, 2], [-2.9, -1.09, -0.75, -0.47, 0.46, 2], [-2.1, -1.09, -0.75, -0.47, 0.47, 2], [-1.3, -1.03, -0.73, -0.47, 0.46, 2], [-0.6, -0.95, -0.68, -0.47, 0.42, 2], [-0.1, -0.65, -0.53, -0.45, 0.28, 2], [0.2, -0.43, -0.43, -0.41, 0.05, 2]], kind: 'glass', front: 'open', back: 'open' }],
      seats: [[-0.85, -0.95], [-0.91, -2.6]],
      frames: [-0.18, -1.6, -1.8, -3.65],
      deco: [['tone', 2.3, '#2c3034'], ['line', -0.47, -0.9, 0.97, -0.9], ['line', -0.63, -3.3, 1.07, -3.3]] },
    desc: 'A long drooping radome and two seats in a row under a framed canopy, pilot in front and radar operator behind. The Side Intakes go either side of its back end.' },
  us4f4Body: { cat: 'air', name: 'FS-4 Centre Fuselage', w: 1.98, h: 5.1, depth: 1.48, fill: 0.82, mass: 2.2, fuel: 3.2, tier: 2, cost: 2800, shape: 'us4body',
    body: { tubes: [
      { st: [[-2.55, -0.77, 0.21, 0.99, 0.74, 3, 3.5], [-1.05, -0.79, 0.21, 0.99, 0.74, 3, 3.5], [0.45, -0.81, 0.21, 0.97, 0.74, 3, 3.4], [2.55, -0.87, 0.21, 0.93, 0.73, 2.6, 3.2]] },
      { st: [[-2.25, -0.77, -0.75, -0.64, 0.04, 2], [-0.55, -0.87, -0.77, -0.64, 0.26, 2], [1.15, -0.94, -0.81, -0.64, 0.3, 2], [2.55, -0.99, -0.86, -0.69, 0.3, 2]], back: 'open', hide: true }],
      deco: [['line', -0.79, -0.05, 0.99, -0.05], ['line', -0.84, 1.75, 0.95, 1.75]] },
    desc: 'The middle of a heavy twin-jet fighter: the spine behind the canopy, a big fuel tank and wells for radar missiles underneath. The wing goes through it, low.' },
  us4f4Intakes: { cat: 'air', name: 'FS-4 Side Intakes', w: 1.76, h: 7.8, depth: 0.85, fill: 0.81, mass: 1.4, twinZ: 1.12, twinMirror: true, tier: 2, cost: 2000, shape: 'us4body',
    body: { tubes: [
      { st: [[-3.9, -0.88, 0.1, 0.88, 0.38, 3.5], [-1.9, -0.8, 0.1, 0.86, 0.38, 4], [0.1, -0.7, 0.08, 0.84, 0.38, 4.5], [1.6, -0.62, 0.06, 0.8, 0.38, 5], [2.8, -0.58, 0.06, 0.78, 0.38, 5]], front: 'intake' }],
      plates: [[-0.66, 0.84, 2.3, 3.9, -0.4, 0.05]],
      deco: [['line', -0.6, 2.2, 0.8, 2.2], ['line', -0.8, -1.8, 0.86, -1.8]] },
    desc: 'A pair of tall intakes with splitter plates standing off the fuselage ahead of them, and the ducts behind. Put them either side of the centre fuselage, flush.' },
  us4f4Engines: { glowAft: 7, glowK: 0.2, cat: 'airEng', name: 'FS-4 Twin Turbojets', w: 1.76, h: 5.5, depth: 3, fill: 0.91, mass: 4.5, thrust: 211, ispSL: 4200, ispVac: 4200, gimbal: 0.02, air: { kind: 'jet', vmax: 800, ab: 1.6 }, plume: 'jet', maxTemp: 2300, tier: 2, cost: 17000, shape: 'us4body',
    body: { tubes: [
      { st: [[0.25, -0.21, 0.25, 0.71, 0.46, 2], [1.45, -0.42, 0.18, 0.8, 0.56, 2.4], [2.75, -0.62, 0.1, 0.88, 0.62, 3]], z: [-0.62, 0.62], back: 'open', hide: true },
      { st: [[-2.75, -0.5, -0.36, -0.24, 0.1, 2], [-1.95, -0.6, -0.4, -0.16, 0.3, 2.5], [-0.75, -0.7, -0.36, -0.04, 0.46, 3], [0.45, -0.78, -0.24, 0.24, 0.66, 3], [1.65, -0.84, -0.04, 0.62, 1.1, 3.4], [2.75, -0.88, 0.1, 0.88, 1.5, 3.6]] }],
      noz: [{ x: 0.25, y0: 0.65, y1: 0.1, r0: 0.52, r1: 0.44, z: [-0.62, 0.62] }],
      deco: [['line', -0.8, 1.25, 0.7, 1.25]] },
    desc: 'The back of a 1960s twin-jet fighter: two thirsty afterburning turbojets low down, their nozzles tucked under the tail boom that carries the fin and stabilator. Mach 2 and more up high.' },
  us4f4Wing: { cat: 'wings', name: 'FS-4 Dog-Tooth Wing', w: 0.4, h: 6.6, mass: 2.6, fuel: 0.6, shape: 'wing', wing: { area: 49.2, span: 11.7, sweep: 0.773, taper: 0.77, flaps: true, stall: 0.36, mcrit: 0.85, wave: 0.5, cd0: 0.01, load: 2.15, dihedral: 0.08, vne: 444, mmax: 2.6, crank: { at: 0.64, d0: 0, d1: 0.21, tooth: 0.12 } }, breakSpeed: 14, tier: 2, cost: 4000,
    desc: 'A swept wing whose outer panels tilt up 12° beyond a dog-tooth notch in the leading edge: the FS-4\'s trademark, added to cure a wobble. Mount it low through the fuselage.' },
  us4f4Stab: { cat: 'wings', name: 'Anhedral Stabilator', w: 0.2, h: 2.6, mass: 0.4, shape: 'elevator', wing: { area: 9.3, span: 5.4, sweep: 0.666, taper: 0.615, dihedral: -0.4, control: 0.35 }, breakSpeed: 14, tier: 2, cost: 1200,
    desc: 'An all-moving tailplane that droops 23° (anhedral), so it stays out of the wing\'s wake at high angles. Mount it on the tail boom.' },
  us4f4Fin: { cat: 'wings', name: 'FS-4 Tail Fin', w: 2.17, h: 5.05, mass: 0.3, shape: 'vtail', vtail: { tle: 0.29, tte: 0.08 }, tier: 2, cost: 900,
    desc: 'A long, steeply swept fin with a rudder, running from the spine to the end of the tail boom.' },
  us4f4Gun: { flush: true, cat: 'weapons', name: 'FS-4 Chin Gun', w: 0.64, h: 3.25, depth: 0.44, fill: 0.66, mass: 0.25, tier: 2, cost: 4500, weapon: { kind: 'gun', ammo: 640, rate: 50, speed: 1030, dmg: 11, spread: 0.005, each: 0.25 }, shape: 'us4body',
    body: { tubes: [
      { st: [[-1.625, -0.2, 0, 0.06, 0.04, 2], [-1.125, -0.2, 0.1, 0.26, 0.19, 2], [-0.075, -0.22, 0.11, 0.32, 0.22, 2], [0.925, -0.28, 0.07, 0.26, 0.19, 2], [1.625, -0.32, 0.03, 0.16, 0.13, 2]], front: 'intake' }] },
    desc: 'A 20 mm rotary cannon in a long fairing under the nose, the muzzle near the radome. Fit it under a fighter nose.' },
  // FS-16 (4th generation, after the F-16)
  us4f16Nose: { cat: 'cabins', name: 'FS-16 Bubble Canopy Nose', w: 1.86, h: 6.5, depth: 1.36, fill: 0.56, mass: 1.5, control: 3, torque: 3000, crew: 1, radar: 15000, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 3, cost: 6500, shape: 'us4body',
    body: { tubes: [
      { st: [[-3.25, -0.27, 0.48, 0.93, 0.68, 2.6, 3.6], [-2.25, -0.23, 0.46, 0.93, 0.64, 2.6, 3.4], [-1.25, -0.2, 0.45, 0.93, 0.61, 2.6, 3.2], [-0.25, -0.19, 0.43, 0.93, 0.57, 2.6, 3], [0.35, -0.17, 0.41, 0.9, 0.53, 2.4, 2.8], [1.05, -0.1, 0.37, 0.81, 0.45, 2.2, 2.4], [1.75, 0.02, 0.33, 0.65, 0.31, 2, 2], [2.35, 0.17, 0.31, 0.47, 0.16, 2, 2], [2.75, 0.3, 0.3, 0.3, 0, 2, 2]] },
      { st: [[-3.25, -0.61, -0.43, -0.12, 0.3, 2], [-2.85, -0.75, -0.43, -0.09, 0.37, 2], [-2.35, -0.87, -0.43, -0.09, 0.41, 2], [-1.75, -0.93, -0.44, -0.09, 0.43, 2], [-1.15, -0.9, -0.43, -0.09, 0.42, 2], [-0.55, -0.74, -0.37, -0.09, 0.38, 2], [-0.05, -0.45, -0.25, -0.09, 0.28, 2], [0.3, -0.19, -0.17, -0.12, 0.06, 2]], kind: 'glass', front: 'open', back: 'open' }],
      seats: [[-0.59, -1.65]],
      probe: [0.3, 2.75, 3.25, 0.03],
      deco: [['tone', 1.05, -0.1], ['line', -0.17, 0.35, 0.9, 0.35], ['line', -0.27, -2.65, 0.93, -2.65]] },
    desc: 'Pointed radome, chined nose and a frameless bubble canopy: the pilot sits high with a view all round. Hang the Chin Intake under it.' },
  us4f16Body: { cat: 'air', name: 'FS-16 Blended Fuselage', w: 1.63, h: 5.6, depth: 1.64, fill: 0.74, mass: 2.3, fuel: 2.6, tier: 3, cost: 3500, shape: 'us4body',
    body: { tubes: [
      { st: [[-2.8, -0.525, 0.275, 0.815, 0.78, 2.4, 3], [-2.2, -0.545, 0.295, 0.815, 0.8, 2.4, 3], [-1.2, -0.565, 0.315, 0.815, 0.82, 2.4, 3.2], [-0.2, -0.585, 0.315, 0.795, 0.82, 2.4, 3.4], [0.8, -0.585, 0.315, 0.765, 0.8, 2.4, 3.6], [1.8, -0.545, 0.295, 0.735, 0.75, 2.5, 3.6], [2.8, -0.485, 0.265, 0.715, 0.68, 2.6, 3.6]] },
      { st: [[-2.6, -0.525, -0.505, -0.385, 0.02, 2], [-2, -0.585, -0.485, -0.335, 0.16, 2], [-1.2, -0.625, -0.485, -0.335, 0.2, 2], [0.3, -0.685, -0.525, -0.335, 0.24, 2], [1.8, -0.755, -0.585, -0.335, 0.28, 2], [2.8, -0.815, -0.625, -0.335, 0.3, 2]], back: 'open', hide: true }],
      deco: [['line', -0.685, 0.3, 0.795, 0.3], ['line', -0.585, -1.8, 0.815, -1.8]] },
    desc: 'The wide, flat middle of a blended-body fighter, with the dorsal spine on top and fuel inside. The wing goes through it.' },
  us4f16Intake: { cat: 'air', name: 'FS-16 Chin Intake', w: 0.64, h: 4.2, depth: 1.32, fill: 0.73, mass: 0.4, tier: 3, cost: 1200, shape: 'us4body',
    body: { tubes: [
      { st: [[-2.1, -0.47, -0.37, -0.3, 0.66, 3], [-1.6, -0.47, -0.24, -0.02, 0.62, 3], [-0.9, -0.5, -0.14, 0.18, 0.58, 3], [-0.1, -0.52, -0.09, 0.28, 0.54, 3, 3.2], [0.9, -0.54, -0.08, 0.32, 0.51, 3, 3.2], [1.7, -0.54, -0.08, 0.32, 0.49, 3], [2.1, -0.54, -0.08, 0.3, 0.47, 3]], front: 'intake', rake: -0.25 }] },
    desc: 'The single gaping intake that hangs under the cockpit and feeds the engine. Put it under the nose and the fuselage; the nose gear folds into it.' },
  us4f16Engine: { glowAft: 7, glowK: 0.2, cat: 'airEng', name: 'FS-16 Afterburning Turbofan', w: 1.34, h: 3.4, depth: 2.04, fill: 0.66, mass: 2.3, thrust: 128, ispSL: 5200, ispVac: 5200, gimbal: 0.02, air: { kind: 'jet', vmax: 750, ab: 1.7 }, plume: 'jet', maxTemp: 2200, tier: 3, cost: 17500, shape: 'us4body',
    body: { tubes: [
      { st: [[-0.6, -0.51, 0.07, 0.65, 0.58, 2, 2], [0.1, -0.57, 0.09, 0.67, 0.66, 2.2, 2.6], [0.9, -0.63, 0.11, 0.67, 0.74, 2.3, 2.8], [1.7, -0.67, 0.13, 0.67, 0.78, 2.4, 3]] },
      { st: [[-1.45, 0.02, 0.12, 0.21, 0.12, 2.5], [-1.1, -0.03, 0.12, 0.27, 0.22, 3], [-0.1, -0.05, 0.12, 0.31, 0.3, 3], [0.9, -0.03, 0.12, 0.31, 0.28, 3], [1.6, 0.02, 0.12, 0.25, 0.1, 3]], z: [-0.72, 0.72], hide: true }],
      noz: [{ x: 0.07, y0: -0.55, y1: -1.7, r0: 0.59, r1: 0.47 }],
      deco: [['line', -0.63, 0.9, 0.67, 0.9]] },
    desc: 'The tail of a single-engine fighter: one big afterburning turbofan, the petal nozzle and the fairings the tailplanes hinge on. Afterburner above 90% throttle: Mach 2 up high.' },
  us4f16Wing: { cat: 'wings', name: 'FS-16 Cropped Delta Wing', w: 0.22, h: 4.8, mass: 1.3, fuel: 0.6, shape: 'wing', wing: { area: 27.9, span: 9.45, sweep: 0.532, taper: 0.773, flaps: true, stall: 0.4, mcrit: 0.9, wave: 0.6, load: 2.72, dihedral: 0, vne: 450, mmax: 2.4 }, breakSpeed: 14, tier: 3, cost: 4500,
    desc: 'A small, thin cropped delta with flaperons and a straight trailing edge: agile and quick, good for 9 g. Put it through the fuselage at the waist.' },
  us4f16Lerx: { cat: 'wings', name: 'FS-16 Strakes (LERX)', w: 0.1, h: 5.84, mass: 0.12, shape: 'wing', wing: { area: 2.6, span: 2.3, sweep: 1.355, taper: 0.993, slope: 1.6, stall: 0.9, mcrit: 0.95, wave: 0.4, load: 2, vne: 556 }, breakSpeed: 14, tier: 3, cost: 1200,
    desc: 'The long blended strakes from the cockpit to the wing root: they keep the wing flying at angles that would stall it. Line their tips up with the wing\'s leading edge.' },
  us4f16Fin: { cat: 'wings', name: 'FS-16 Tail Fin', w: 2.6, h: 3.9, mass: 0.2, shape: 'vtail', vtail: { tle: 0.32, tte: 0.03 }, tier: 3, cost: 1000,
    desc: 'A single tall, swept fin with a rudder. Mount it on the spine over the engine.' },
  us4f16Stab: { cat: 'wings', name: 'FS-16 Stabilators', w: 0.16, h: 2.64, mass: 0.25, shape: 'elevator', wing: { area: 5.9, span: 5.6, sweep: 0.596, taper: 0.68, dihedral: -0.175, control: 0.35 }, breakSpeed: 14, tier: 3, cost: 1500,
    desc: 'All-moving swept tailplanes, drooping a little (anhedral). They pitch the plane and help it roll. Mount them on the tail fairings.' },
  us4f16Ventral: { cat: 'wings', name: 'Ventral Fins', w: 0.6, h: 1.4, mass: 0.04, shape: 'vtail', twinZ: 0.62, twinMirror: true, vtail: { tle: 0.45, tte: 0, cant: 0.26 }, tier: 3, cost: 400,
    desc: 'A pair of small fins under the tail, splayed outwards: they keep the nose straight at high angles of attack.' },
  // FS-15 (4th generation, after the F-15)
  us4f15Nose: { cat: 'cabins', name: 'FS-15 Radar Nose', w: 2.3, h: 7.8, depth: 1.42, fill: 0.65, mass: 2, control: 3, torque: 4000, crew: 1, radar: 18000, aero: true, sharp: true, breakSpeed: 12, maxTemp: 2400, tier: 3, cost: 8000, shape: 'us4body',
    body: { tubes: [
      { st: [[-3.9, -0.57, 0.45, 1.15, 0.71, 2.6, 3], [-3.1, -0.53, 0.43, 1.11, 0.7, 2.6, 3], [-2.1, -0.45, 0.4, 1.05, 0.68, 2.6, 2.8], [-0.9, -0.39, 0.37, 1.01, 0.67, 2.5, 2.6], [0.3, -0.37, 0.35, 0.99, 0.66, 2.4, 2.4], [1.3, -0.32, 0.33, 0.93, 0.62, 2.2, 2.2], [2.3, -0.19, 0.31, 0.79, 0.49, 2, 2], [3.2, 0.02, 0.29, 0.57, 0.28, 2, 2], [3.9, 0.27, 0.27, 0.27, 0, 2, 2]] },
      { st: [[-3.9, -0.77, -0.6, -0.37, 0.38, 2], [-3.3, -0.95, -0.63, -0.33, 0.46, 2], [-2.5, -1.1, -0.65, -0.31, 0.5, 2], [-1.7, -1.15, -0.65, -0.31, 0.5, 2], [-0.9, -1.07, -0.63, -0.31, 0.47, 2], [-0.2, -0.77, -0.53, -0.31, 0.38, 2], [0.4, -0.39, -0.37, -0.31, 0.08, 2]], kind: 'glass', front: 'open', back: 'open' }],
      seats: [[-0.85, -1.5]],
      frames: [-0.35],
      deco: [['tone', 1.3, -0.1], ['line', -0.32, 1.3, 0.93, 1.3], ['line', -0.5, -3.2, 1.11, -3.2]] },
    desc: 'A big radome and a tall bubble canopy, the pilot sitting high above the box intakes. Put the FS-15 Box Intakes either side of its back end.' },
  us4f15Body: { cat: 'air', name: 'FS-15 Centre Fuselage', w: 1.97, h: 7.6, depth: 1.42, fill: 0.82, mass: 2.6, fuel: 4.4, tier: 3, cost: 4000, shape: 'us4body',
    body: { tubes: [
      { st: [[-3.8, -0.785, 0.255, 0.985, 0.71, 3, 3.5], [-1.8, -0.785, 0.255, 0.985, 0.71, 3, 3.5], [0.2, -0.795, 0.255, 0.985, 0.71, 3, 3.5], [2.2, -0.795, 0.245, 0.965, 0.71, 2.8, 3.2], [3.8, -0.785, 0.235, 0.935, 0.71, 2.6, 3]] },
      { st: [[-0.4, -0.785, -0.765, -0.665, 0.04, 2], [1.2, -0.865, -0.785, -0.665, 0.3, 2], [2.7, -0.935, -0.815, -0.665, 0.36, 2], [3.8, -0.985, -0.815, -0.665, 0.38, 2]], back: 'open', hide: true }],
      deco: [['line', -0.795, 0.2, 0.985, 0.2], ['line', -0.785, -2.2, 0.985, -2.2]] },
    desc: 'The middle of a twin-engine fighter: a flat deck between the intake ducts, a big fuel tank, the dorsal spine behind the canopy. The wing goes through it.' },
  us4f15Intakes: { cat: 'air', name: 'FS-15 Box Intakes', w: 1.8, h: 9.8, depth: 1.1, fill: 0.94, mass: 1.6, twinZ: 1.27, tier: 3, cost: 2500, shape: 'us4body',
    body: { tubes: [
      { st: [[-4.9, -0.9, 0.02, 0.82, 0.55, 3.5, 3.5], [-2.9, -0.9, 0.02, 0.87, 0.55, 4, 4], [-0.9, -0.88, 0.02, 0.9, 0.55, 5, 5], [1.1, -0.73, 0.07, 0.9, 0.55, 6, 6], [3.1, -0.53, 0.17, 0.9, 0.55, 6, 6], [4.9, -0.43, 0.22, 0.9, 0.55, 6, 6]], front: 'intake', rake: 0.45 }],
      deco: [['line', -0.48, 3.7, 0.9, 3.3], ['line', -0.88, -1.9, 0.9, -1.9]] },
    desc: 'A pair of big square intakes with raked mouths, standing just clear of the cockpit, and the ducts behind them. Put them either side of the centre fuselage, flush.' },
  us4f15Engines: { glowAft: 7, glowK: 0.2, cat: 'airEng', name: 'FS-15 Twin Turbofans', w: 1.77, h: 4, depth: 3.7, fill: 0.95, mass: 4, thrust: 255, ispSL: 5000, ispVac: 5000, gimbal: 0.02, air: { kind: 'jet', vmax: 800, ab: 1.7 }, plume: 'jet', maxTemp: 2300, tier: 4, cost: 25000, shape: 'us4body',
    body: { tubes: [
      { st: [[-1.1, -0.585, 0.035, 0.655, 0.62, 2], [0, -0.665, 0.035, 0.755, 0.66, 2.2], [1, -0.765, 0.055, 0.835, 0.68, 2.6], [2, -0.885, 0.085, 0.885, 0.71, 3]], z: [-0.66, 0.66], back: 'open' },
      { st: [[-1.7, -0.585, -0.405, -0.205, 0.16, 3], [-0.8, -0.665, -0.385, -0.045, 0.24, 3.5], [0.5, -0.765, -0.325, 0.335, 0.3, 4], [2, -0.885, 0.035, 0.835, 0.3, 4]], z: [-1.55, 1.55], hide: true },
      { st: [[-0.4, -0.585, -0.415, -0.265, 0.15, 2.5], [0.8, -0.785, -0.265, 0.235, 0.5, 3], [2, -0.885, 0.155, 0.885, 0.71, 3, 3.5]], hide: true }],
      noz: [{ x: 0.035, y0: -1.05, y1: -2, r0: 0.64, r1: 0.52, z: [-0.66, 0.66] }],
      deco: [['line', -0.765, 0.6, 0.755, 0.6]] },
    desc: 'The back end of a twin-engine fighter: two afterburning turbofans side by side and the tail booms that carry its fins and stabilators. Afterburner above 90% throttle: Mach 2.5 up high.' },
  us4f15Wing: { cat: 'wings', name: 'FS-15 Wing', w: 0.38, h: 6.9, mass: 2.5, fuel: 0.8, shape: 'wing', wing: { area: 56.5, span: 13.05, sweep: 0.674, taper: 0.75, flaps: true, stall: 0.36, mcrit: 0.9, wave: 0.4, cd0: 0.009, load: 2.36, dihedral: 0, vne: 450, mmax: 2.85 }, breakSpeed: 14, tier: 3, cost: 5500,
    desc: 'A big swept wing with cropped tips: huge area for its weight, so it turns hard and climbs like a rocket. Mount it high, through the top of the intake ducts.' },
  us4f15Tails: { cat: 'wings', name: 'FS-15 Twin Tails', w: 2.9, h: 3.9, mass: 0.5, shape: 'vtail', twinZ: 1.55, vtail: { tle: 0.45, tte: 0 }, tier: 3, cost: 1200,
    desc: 'A pair of tall upright fins with rudders, one on each tail boom.' },
  us4f15Stab: { cat: 'wings', name: 'FS-15 Stabilators', w: 0.2, h: 4.03, mass: 0.45, shape: 'elevator', wing: { area: 10.4, span: 8.6, sweep: 0.793, taper: 0.752, control: 0.35 }, breakSpeed: 14, tier: 3, cost: 1800,
    desc: 'Big all-moving swept tailplanes that reach out behind the nozzles. Mount them on the tail booms.' },
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
// z: where the part sits across the blueprint (see partZ); att: the id of the part it is attached to;
// skin: its paint (SKINS), null for its own look.
function makePart(type, x, y, extra) {
  const def = PARTS[type];
  const p = { id: _partSeq++, type, def, x, y, z: partDefaultZ(def), att: null, skin: null, flip: x < 0, fuel: partFuelKg(def), active: false, deployed: 0, temp: AMBIENT_T };
  if (def.weapon) { p.ammo = def.weapon.ammo; p.store = partStoreKg(def); }
  if (extra) Object.assign(p, extra);
  if (!Number.isFinite(p.z)) p.z = partDefaultZ(def);
  if (p.att === undefined) p.att = null;
  if (p.skin === undefined) p.skin = null;
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

// ---------------------------------------------------------------------------
// Depth: the third axis, across the blueprint (z). The 2D blueprint looks along it from +z; for planes
// +z is the right wing. A part's p.z is where it sits along it. Twin parts (def.twinZ: engine pods,
// stores, floats, twin tails) are a pair, one each side, and their p.z is how far out each one sits.
// Wings span both sides through the centre and rocket legs and fins stand in fours around the stack,
// so those always sit at z = 0.
const PART_Z_MAX = 20;
function hasOwn(o, k) { return o != null && Object.prototype.hasOwnProperty.call(o, k); }
function zLocked(d) { return !!(d.wing || d.leg || d.fin); }
function partDefaultZ(d) { return zLocked(d) ? 0 : d.twinZ || 0; }
function twinMinZ(d) { return partDepth({ def: d }) / 2 + 0.05; } // closer in, the two halves would overlap
function cleanZ(z, d) {
  if (zLocked(d)) return 0;
  if (!Number.isFinite(z)) return partDefaultZ(d);
  if (d.twinZ) return clamp(Math.abs(z), twinMinZ(d), PART_Z_MAX);
  return clamp(z, -PART_Z_MAX, PART_Z_MAX);
}
// The part's depth: the centre for one part, how far out each one sits for a twin pair (>= 0).
function partZ(p) {
  const d = p.def;
  if (zLocked(d)) return 0;
  const z = Number.isFinite(p.z) ? p.z : partDefaultZ(d);
  return d.twinZ ? Math.abs(z) : z;
}
// Where its mass sits across: a pair balances out at 0.
function partZc(p) { return p.def.twinZ ? 0 : partZ(p); }
// The depth of each copy: both sides of a pair, else the part itself.
function partZs(p) { const z = partZ(p); return p.def.twinZ ? [-z, z] : [z]; }
// Its boxes in 3D, [l, r, b, t, near, far]: the side-view rectangle at each copy's depth.
function partBoxes(p) {
  const R = partRect(p), hd = partDepth(p) / 2;
  return partZs(p).map((z) => [R.l, R.r, R.b, R.t, z - hd, z + hd]);
}

// Wheel centre and radius in part space. Most wheels hang below an upright strut; landing gear
// struts run sideways, with the wheel at the outer end (away from the fuselage).
function wheelGeom(p) {
  const d = p.def, r = d.wheel.r || Math.min(d.w, d.h) * 0.45;
  const c = d.shape === 'gear' ? partPt(p, (p.flip ? -1 : 1) * (d.w / 2 - r), 0) : partPt(p, 0, -d.h * 0.05);
  return { x: c.x, y: c.y, r };
}

// How far two ranges overlap (negative: the gap between them).
function spanOverlap(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0); }
// Two parts are attached if they share a face: flush in one axis, overlapping in the other two.
function partsTouch(a, b) {
  const A = partRect(a), B = partRect(b), eps = 0.02, m = 0.1;
  const ox = spanOverlap(A.l, A.r, B.l, B.r), oy = spanOverlap(A.b, A.t, B.b, B.t);
  const ty = ox > m && (Math.abs(A.t - B.b) < eps || Math.abs(B.t - A.b) < eps), tx = oy > m && (Math.abs(A.r - B.l) < eps || Math.abs(B.r - A.l) < eps);
  if (!ty && !tx && !(ox > m && oy > m)) return false;
  const ha = partDepth(a) / 2, hb = partDepth(b) / 2, mz = Math.min(m, ha, hb);
  for (const za of partZs(a)) for (const zb of partZs(b)) {
    const oz = spanOverlap(za - ha, za + ha, zb - hb, zb + hb);
    if ((ty || tx) && oz > mz) return true;
    if (ox > m && oy > m && Math.abs(oz) < eps && !legacyTwin(a) && !legacyTwin(b)) return true; // side by side across the blueprint
  }
  return false;
}
// A pair placed before parts had a depth (no att, at its catalogue spread): it keeps the side-view rules
// it was built with, overlapping the hull it hangs beside and joined only as its pylons show.
function legacyTwin(p) { return !!p.def.twinZ && p.att === null && Math.abs(partZ(p) - p.def.twinZ) < 5e-4; }
// The same in the side view alone, as parts joined before they had a depth.
function partsTouch2D(a, b) {
  const A = partRect(a), B = partRect(b), eps = 0.02, m = 0.1;
  const ox = spanOverlap(A.l, A.r, B.l, B.r), oy = spanOverlap(A.b, A.t, B.b, B.t);
  return (ox > m && (Math.abs(A.t - B.b) < eps || Math.abs(B.t - A.b) < eps)) || (oy > m && (Math.abs(A.r - B.l) < eps || Math.abs(B.r - A.l) < eps));
}
// Do the parts' boxes overlap by more than m (side view) and mz (across)?
function partsOverlap(a, b, m = 0.02, mz = m) {
  const A = partRect(a), B = partRect(b);
  if (spanOverlap(A.l, A.r, B.l, B.r) <= m || spanOverlap(A.b, A.t, B.b, B.t) <= m) return false;
  const ha = partDepth(a) / 2, hb = partDepth(b) / 2;
  for (const za of partZs(a)) for (const zb of partZs(b)) if (spanOverlap(za - ha, za + ha, zb - hb, zb + hb) > mz) return true;
  return false;
}
// Wings and tail surfaces are thin plates that may pass through the hull they are mounted on (a mid or
// low wing, a fin on the tail cone), and engine pods and drop tanks hang off wings. So a surface and a
// non-surface may overlap, and overlapping is how they attach; two parts of the same sort may not. A
// wing and a fin are plates at right angles, so a fin may stand through a tailplane too.
function isSurface(d) { return !!(d.wing || d.shape === 'vtail'); }
function surfaceKind(d) { return d.wing ? 'wing' : d.shape === 'vtail' ? 'fin' : null; }
function partsMix(a, b) { const sa = surfaceKind(a.def), sb = surfaceKind(b.def); return sa !== sb && !!(sa || sb); }
// A flush part (def.flush: an internal gun, a chin-gun fairing, a gear leg whose top sits in its well) is set into
// the bodies around it, so it may overlap them (but not another flush part).
function partsClash(a, b) {
  if (!!a.def.twinZ !== !!b.def.twinZ && (legacyTwin(a) || legacyTwin(b))) return false;
  if (!a.def.flush !== !b.def.flush) return false;
  return !partsMix(a, b) && partsOverlap(a, b);
}
function partsMounted(a, b) { return partsMix(a, b) && partsOverlap(a, b, 0.04, 0); }
function partsMounted2D(a, b) {
  if (!partsMix(a, b)) return false;
  const A = partRect(a), B = partRect(b);
  return spanOverlap(A.l, A.r, B.l, B.r) > 0.04 && spanOverlap(A.b, A.t, B.b, B.t) > 0.04;
}
// Twin parts placed before parts had a depth (no att) still join whatever they meet in the side view,
// as the pylons drawn for them show: twin tails on the jet pipe, floats under the fuselage.
function pylonLink(a, b) {
  const old = (p) => p.def.twinZ && p.att == null;
  return (old(a) || old(b)) && (partsTouch2D(a, b) || partsMounted2D(a, b));
}

// Which parts hold together: shared faces, surfaces through what they're mounted on, and every part
// attached to another (att), wherever exactly it ended up.
function buildAdjacency(parts) {
  const adj = new Map(), byId = new Map();
  for (const p of parts) { adj.set(p.id, new Set()); byId.set(p.id, p); }
  const link = (a, b) => { adj.get(a.id).add(b.id); adj.get(b.id).add(a.id); };
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j];
      if (partsTouch(a, b) || partsMounted(a, b) || pylonLink(a, b)) link(a, b);
    }
  for (const p of parts) if (p.att != null && p.att !== p.id && byId.has(p.att)) link(p, byId.get(p.att));
  return adj;
}

// ---------------------------------------------------------------------------
// Designs as saved: [{type, x, y, flip, rot, z?, att?, skin?}], where att is the index of the part it is
// attached to in the same list. Only what differs from the defaults is written, so designs saved before
// parts had a depth or paint read back the same.
function designRows(parts) {
  const at = new Map(parts.map((p, i) => [p.id, i]));
  return parts.map((p) => {
    const q = { type: p.type, x: +p.x.toFixed(3), y: +p.y.toFixed(3), flip: p.flip, rot: p.rot || 0 }, z = partZ(p);
    if (Math.abs(z - partDefaultZ(p.def)) > 5e-4) q.z = +z.toFixed(3);
    if (p.att != null && at.has(p.att) && p.att !== p.id) q.att = at.get(p.att);
    if (p.skin) q.skin = p.skin;
    return q;
  });
}
// ...and back. Rows of unknown parts are dropped only after the links are read, so indices still match;
// anything malformed (from an old version, a pasted code or a peer) falls back to a default.
function partsFromDesign(rows) {
  if (!Array.isArray(rows)) return [];
  const made = rows.map((q) => {
    if (!q || typeof q.type !== 'string' || !hasOwn(PARTS, q.type) || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return null;
    const def = PARTS[q.type];
    return makePart(q.type, clamp(q.x, -500, 500), clamp(q.y, -500, 500), { flip: !!q.flip, rot: (q.rot | 0) & 3, z: cleanZ(q.z, def), skin: cleanSkin(q.skin, def) });
  });
  made.forEach((p, i) => {
    if (!p) return;
    const a = rows[i].att, h = Number.isInteger(a) && a !== i ? made[a] : null;
    p.att = h ? h.id : null;
  });
  const parts = made.filter(Boolean);
  cleanAtt(parts);
  return parts;
}
// Drop links to parts that aren't there and break any loop (a part attached, through others, to itself).
function cleanAtt(parts) {
  const byId = new Map(parts.map((p) => [p.id, p])), done = new Set();
  for (const p of parts) if (p.att != null && (p.att === p.id || !byId.has(p.att))) p.att = null;
  for (const p of parts) {
    const path = new Set();
    for (let q = p; q && q.att != null && !done.has(q.id); q = byId.get(q.att)) {
      path.add(q.id);
      if (path.has(q.att)) { q.att = null; break; }
    }
    for (const id of path) done.add(id);
  }
  return parts;
}
// Everything attached to these parts, and to what's attached to them, and so on (not the parts themselves).
function attachedTo(parts, roots) {
  const kids = new Map();
  for (const p of parts) if (p.att != null) { if (!kids.has(p.att)) kids.set(p.att, []); kids.get(p.att).push(p); }
  const seen = new Set(roots), out = [], stack = [...roots];
  while (stack.length) for (const k of kids.get(stack.pop().id) || []) if (!seen.has(k)) { seen.add(k); out.push(k); stack.push(k); }
  return out;
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
    case 'us4body': { const n = def.body.noz && def.body.noz[0]; return n ? { y: n.y1, half: n.r1, x: n.x } : { y: -def.h / 2, half: def.w * 0.28 }; } // (x: the nozzle's height)
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
// Paint. A skin repaints a part's body; markings that mean something (glass, hazard stripes, nozzles,
// tyres, struts) keep their colours. Purely cosmetic: nothing but the drawing reads it, so a stealth-grey
// wing is no stealthier. base: the body colour (#rrggbb); paint: reuse one of the tuned painters;
// accent: what happens to livery stripes ('keep' them, null to hide them, unset: a tone of the base);
// rough/metal: the finish in 3D.
const SKINS = {
  white: { name: 'Gloss white', base: '#e3e7eb', paint: 'hull', accent: 'keep' },
  light: { name: 'Light grey', base: '#b9c0c7', accent: 'keep' },
  grey: { name: 'Air-superiority grey', base: '#8e98a3' },
  stealth: { name: 'Stealth grey', base: '#4b5058', paint: 'dark', accent: null, rough: 0.85, metal: 0.05 },
  black: { name: 'Night black', base: '#26292e', accent: null, rough: 0.8, metal: 0.1 },
  navy: { name: 'Navy blue', base: '#24344d' },
  blue: { name: 'Blue', base: '#2f6fb7' },
  olive: { name: 'Olive drab', base: '#5f6b52', rough: 0.8, metal: 0.05 },
  tan: { name: 'Desert tan', base: '#c2ad84', rough: 0.75, metal: 0.05 },
  red: { name: 'Racing red', base: '#c8322b' },
  orange: { name: 'Safety orange', base: '#ff7a1a' },
  yellow: { name: 'Trainer yellow', base: '#f2c230' },
  metal: { name: 'Bare metal', base: '#8d96a0', paint: 'metal', accent: 'keep', rough: 0.35, metal: 0.75 },
  // 5th-generation camouflage (camo: a second tone laid over the base in soft blotches; pat: which pattern, us5CamoAt)
  raptor: { name: 'FS-22 two-tone stealth grey', base: '#8a9199', camo: '#6a7179', pat: 0, accent: null, rough: 0.6, metal: 0.22 },
  lightning: { name: 'FS-35 radar-absorbent grey', base: '#5c6269', camo: '#50565d', pat: 1, accent: null, rough: 0.5, metal: 0.25 },
  splinter: { name: 'Aggressor splinter', base: '#97a3ad', camo: '#46505a', pat: 2, accent: null, rough: 0.6, metal: 0.12 },
  // camouflage for the Russian look-alike jets (camo: the pattern over the base, drawn by camoCanvas at the end of this file)
  ruFlanker: { name: 'Sugoi blue', base: '#b7c4ce', camo: { k: 'blotch', c: ['#8fa2b2', '#61788c'], seed: 27, n: 10 }, accent: null, rough: 0.7, metal: 0.1 },
  ruSplinter: { name: 'Grey splinter', base: '#98a3ac', camo: { k: 'splinter', c: ['#6c7883', '#47525d'], seed: 35 }, accent: null, rough: 0.7, metal: 0.1 },
  ruFulcrum: { name: 'MyG grey-green', base: '#b9c0b9', camo: { k: 'blotch', c: ['#8e9b8f', '#6d7c70'], seed: 29 }, accent: null, rough: 0.7, metal: 0.1 },
  ruPixel: { name: 'Digital splinter', base: '#a9b6bf', camo: { k: 'digital', c: ['#7e8d99', '#5b6976', '#c7d1d8'], seed: 57, n: 16, r: 0.7, px: 0.125 }, accent: null, rough: 0.75, metal: 0.08 },
  ruFrontline: { name: 'Frontline camo', base: '#a69c74', camo: { k: 'blotch', c: ['#5c6a40', '#7d5e3f', '#4f5a36'], seed: 21, n: 13, r: 0.75 }, accent: null, rough: 0.75, metal: 0.05 },
  // the US 3rd/4th-generation look-alikes' schemes (patterned as the Russian ones; gull and gunship grey are plain)
  us4viper: { name: 'FS-16 two-tone grey', base: '#7f878e', camo: { k: 'blotch', c: ['#5d646b'], seed: 16, n: 9 }, accent: null, rough: 0.72, metal: 0.08 },
  us4eagle: { name: 'FS-15 blue-grey', base: '#8a949d', camo: { k: 'blotch', c: ['#5d6b7b'], seed: 15, n: 9 }, accent: null, rough: 0.72, metal: 0.08 },
  us4sea: { name: 'Vietnam SEA camouflage', base: '#69734f', camo: { k: 'blotch', c: ['#a78d63', '#3f4a34'], seed: 4, n: 11 }, accent: null, rough: 0.8, metal: 0.05 },
  us4gull: { name: 'Navy gull grey', base: '#a7aaa6', accent: null, rough: 0.7, metal: 0.1 },
  us4gunship: { name: 'Gunship grey', base: '#50565d', accent: null, rough: 0.78, metal: 0.08 },
};
const SKIN_IDS = Object.keys(SKINS);
// Shapes that are all structure, rubber or cloth: nothing to paint.
const NO_SKIN = new Set(['sep', 'shield', 'chute', 'leg', 'wheel', 'gear', 'girder', 'rotor', 'tailrotor']);
function skinnable(d) { return !NO_SKIN.has(d.shape); }
function cleanSkin(id, d) { return typeof id === 'string' && hasOwn(SKINS, id) && skinnable(d) ? id : null; }
// The paint a part comes in, as a skin, when it has one worth matching (stealth parts are dark grey; look: a part
// that comes in a camouflage of its own, the 5th-generation ones).
function ownSkin(d) { return d.look || (d.style === 'stealth' ? 'stealth' : null); }
// What a part looks painted in: its skin, else its own look.
function skinOf(p) { return p.skin || ownSkin(p.def); }

// With flat = true, parts are painted without fake cylinder shading (used for 3D textures,
// where real lighting does the shading). skin: the SKINS entry of the part being drawn, if any
// (set by drawPart only).
const PartPaint = { flat: false, skin: null, camoAt: null }; // camoAt: [x, y], where a part drawn at the origin really is (a 3D texture), so its camouflage lines up with its neighbours'
function darkGradient0(ctx, l, r) { // stealth grey
  if (PartPaint.flat) return '#4b5058';
  const g = ctx.createLinearGradient(l, 0, r, 0);
  g.addColorStop(0, '#2d3036'); g.addColorStop(0.45, '#5a5f68'); g.addColorStop(1, '#33373d');
  return g;
}
function tintGradient0(ctx, l, r, c) { // hull shading in another colour
  if (PartPaint.flat) return c;
  const k = ctx.createLinearGradient(l, 0, r, 0);
  k.addColorStop(0, shade(c, -0.35)); k.addColorStop(0.4, shade(c, 0.12)); k.addColorStop(1, shade(c, -0.25));
  return k;
}
// The painted body: the skin's own painter or its colour with hull shading.
function skinFill(ctx, l, r) {
  const s = PartPaint.skin;
  if (s.camo) return typeof s.camo === 'string' ? us5CamoFill(ctx, s) : camoFill(ctx, s); // (a camouflage: its pattern, in metres; a two-tone one is us5CamoFill's, a patterned one camoFill's, both at the end of this file)
  switch (s.paint) {
    case 'hull': return hullGradient0(ctx, l, r);
    case 'dark': return darkGradient0(ctx, l, r);
    case 'metal': return metalGradient(ctx, l, r);
    default: return tintGradient0(ctx, l, r, s.base);
  }
}
// Body painters: the part's own look unless it wears a skin.
function darkGradient(ctx, l, r) { return PartPaint.skin ? skinFill(ctx, l, r) : darkGradient0(ctx, l, r); }
function tintGradient(ctx, l, r, c) { return PartPaint.skin ? skinFill(ctx, l, r) : tintGradient0(ctx, l, r, c); }
function hullGradient(ctx, l, r) { return PartPaint.skin ? skinFill(ctx, l, r) : hullGradient0(ctx, l, r); }
function goldGradient(ctx, l, r) { return PartPaint.skin ? skinFill(ctx, l, r) : goldGradient0(ctx, l, r); }
// metalGradient stays bare metal (nozzle bells, ramps); bodies made of metal use bodyMetal.
function bodyMetal(ctx, l, r) { return PartPaint.skin ? skinFill(ctx, l, r) : metalGradient(ctx, l, r); }
// A body painted some other way: own() gives its unskinned fill.
function bodyGrad(ctx, l, r, own) { return PartPaint.skin ? skinFill(ctx, l, r) : own(); }
// A flat body colour, and a darker or lighter tone of the body (belly, chines, ribs).
function bodyFlat(hex) { return PartPaint.skin ? PartPaint.skin.base : hex; }
function bodyTone(hex, k) { return PartPaint.skin ? shade(PartPaint.skin.base, k) : hex; }
// A livery stripe or tip: as drawn, hidden, or a tone of the skin.
function accent(css) {
  const s = PartPaint.skin;
  if (!s || s.accent === 'keep') return css;
  if (s.accent === null) return 'rgba(0,0,0,0)';
  return s.accent || shade(s.base, skinLum(s.base) < 0.35 ? 0.22 : -0.25);
}
function skinLum(hex) { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; }
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
function hullGradient0(ctx, l, r) {
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
function goldGradient0(ctx, l, r) {
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
// The order to draw parts in the side view, back to front: by depth (the view looks from +z, so the far
// side first), then legs, fins and wheels, the hull, the wings and tail surfaces through it, and the pods
// hanging off them. Picking goes the other way.
function sideLayer(d) { return d.pod ? 3 : isSurface(d) ? 2 : d.leg || d.fin || d.wheel ? 0 : 1; }
function sideOrder(parts) {
  return parts.map((p, i) => [p, Math.round(partZ(p) * 20), sideLayer(p.def), i])
    .sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[3] - b[3]).map((e) => e[0]);
}
// Draw a part in its paint (the one place a skin is switched on).
function drawPart(ctx, p, lw) {
  const prev = PartPaint.skin;
  PartPaint.skin = p.skin && hasOwn(SKINS, p.skin) && skinnable(p.def) ? SKINS[p.skin] : null;
  try { turned(ctx, p, (q) => drawPart0(ctx, q, lw)); } finally { PartPaint.skin = prev; }
}

function partPath0(ctx, p) {
  const d = p.def, x = p.x, y = p.y, w = d.w, h = d.h;
  const l = x - w / 2, r = x + w / 2, b = y - h / 2, t = y + h / 2;
  ctx.beginPath();
  if (d.us5) { us5Path(ctx, p); return; } // (the 5th-generation look-alikes: at the end of this file)
  switch (d.ru ? 'ru' : d.shape) { // (d.ru: a look-alike jet's lofted hull, case 'ru' at the end)
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
    case 'vtail': { // def.vtail (optional): where the root's trailing edge and the tip's edges sit, as fractions up the chord
      const s = p.flip ? -1 : 1, inn = x - s * w / 2, out = x + s * w / 2, v = d.vtail || {};
      ctx.moveTo(inn, b + h * (v.rte || 0)); ctx.lineTo(inn, t); ctx.lineTo(out, b + h * (v.tle != null ? v.tle : 0.4)); ctx.lineTo(out, b + h * (v.tte || 0)); ctx.closePath();
      break;
    }
    case 'us4body':
      us4Path(ctx, p);
      break;
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
    case 'ru': // the Russian look-alike jets (MyG and Sugoi): lofted hulls and fins, RU_ART at the end of this file
      ruPath(ctx, p);
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
  if (d.us5) us5Draw(ctx, p, lw); // (the 5th-generation look-alikes draw themselves, at the end of this file; the heat glow follows)
  else switch (d.ru ? 'ru' : d.shape) {
    case 'pod': {
      const tw = w * 0.42;
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.fillStyle = '#4a3a30'; ctx.fillRect(l, b, w, h * 0.09);
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(x - tw / 2, t - h * 0.08, tw, h * 0.08);
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
      ctx.fillStyle = bodyTone(PAL.goldDark, -0.3);
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
        ctx.fillStyle = accent('rgba(255,122,26,0.95)');
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
        ctx.fillStyle = bodyFlat('#2b3138'); ctx.fillRect(l + w * 0.1, t - mh, w * 0.8, mh); ctx.strokeRect(l + w * 0.1, t - mh, w * 0.8, mh);
        ctx.fillStyle = PAL.nuclear;
        for (let i = 0; i < 3; i++) ctx.fillRect(l + w * 0.1, t - mh * (0.25 + i * 0.25), w * 0.8, mh * 0.05);
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.arc(x, t - mh * 0.5, w * 0.08, 0, TAU); ctx.fill();
        // radiator fins
        ctx.fillStyle = '#5a636d';
        ctx.fillRect(l, t - mh * 0.85, w * 0.1, mh * 0.6); ctx.fillRect(r - w * 0.1, t - mh * 0.85, w * 0.1, mh * 0.6);
      } else {
        ctx.fillStyle = bodyMetal(ctx, l + w * 0.12, r - w * 0.12);
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
      ctx.fillStyle = bodyMetal(ctx, l, r); ctx.fillRect(l + w * 0.05, t - mh, w * 0.9, mh); ctx.strokeRect(l + w * 0.05, t - mh, w * 0.9, mh);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l + w * 0.05, t - mh * 0.4, w * 0.9, mh * 0.15);
      ctx.beginPath(); ctx.moveTo(l + w * 0.08, t - mh); ctx.lineTo(r - w * 0.08, t - mh); ctx.lineTo(x + w * 0.14, b); ctx.lineTo(x - w * 0.14, b); ctx.closePath();
      ctx.fillStyle = metalGradient(ctx, l, r); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(20,24,30,0.55)';
      ctx.beginPath(); ctx.moveTo(l + w * 0.08, t - mh); ctx.lineTo(x - w * 0.14, b); ctx.lineTo(x - w * 0.05, b); ctx.lineTo(x - w * 0.12, t - mh); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r - w * 0.08, t - mh); ctx.lineTo(x + w * 0.14, b); ctx.lineTo(x + w * 0.05, b); ctx.lineTo(x + w * 0.12, t - mh); ctx.closePath(); ctx.fill();
      break;
    }
    case 'ion': {
      ctx.fillStyle = bodyMetal(ctx, l, r); ctx.fillRect(l + w * 0.1, b + h * 0.3, w * 0.8, h * 0.7); ctx.strokeRect(l + w * 0.1, b + h * 0.3, w * 0.8, h * 0.7);
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
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(l, t - 0.35, w, 0.35);
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
      ctx.save(); ctx.clip(); ctx.fillStyle = accent(PAL.orange); ctx.fillRect(l, t - h * 0.22, w, h * 0.22);
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, Math.min(0.1, h * 0.08)); ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'fin': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      const s = p.flip ? -1 : 1;
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(Math.min(x + s * w * 0.25, x + s * w / 2), b, w * 0.25, h);
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
      ctx.fillStyle = bodyFlat('#d7dce1'); ctx.fillRect(l, y - h * 0.3, w, h * 0.6); ctx.strokeRect(l, y - h * 0.3, w, h * 0.6);
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
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(x + w * 0.05, b, w * 0.12, h * 0.75); // stripe along the belly side
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
        ctx.fillStyle = bodyTone('#2b2e34', -0.42); ctx.fillRect(l, b, w * 0.14, h); ctx.fillRect(r - w * 0.14, b, w * 0.14, h);
        ctx.strokeStyle = 'rgba(15,17,20,0.7)'; ctx.lineWidth = lw; sawtooth(ctx, l, r, b + h * 0.12, h * 0.05); sawtooth(ctx, l, r, b + h * 0.62, h * 0.05);
      } else {
        ctx.fillStyle = '#3a4048'; ctx.fillRect(l, t - h * 0.2, w, h * 0.2); // radome tip
        ctx.fillStyle = accent(PAL.orange); ctx.fillRect(x + w * 0.05, b, w * 0.1, h * 0.6);
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
      ctx.fillStyle = bodyTone('#c9ced4', -0.11); ctx.fillRect(x + w * 0.22, b, w * 0.3, h); // belly
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(x + w * 0.1, b, w * 0.05, h * 0.6);
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
      ctx.fillStyle = accent('#2f6fb7'); ctx.fillRect(x + w * 0.04, b, w * 0.1, h);
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(x + w * 0.14, b, w * 0.04, h);
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
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(l, b + h * 0.24, w, h * 0.04);
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
      ctx.fillStyle = bodyGrad(ctx, l, r, () => (PartPaint.flat ? '#6b737c' : metalGradient(ctx, l, r))); ctx.fillRect(l, b, w, bh); ctx.strokeRect(l, b, w, bh);
      ctx.beginPath(); ctx.ellipse(x, b + bh, w * 0.34, h - bh, 0, 0, Math.PI); ctx.fillStyle = '#e9ecef'; ctx.fill(); ctx.stroke(); // satellite dome
      ctx.fillStyle = PAL.ink; for (let i = 0; i < 3; i++) ctx.fillRect(l + w * 0.15, b + h * (0.12 + i * 0.12), w * 0.7, 0.05); // vents
      ctx.fillStyle = '#7dffb0'; ctx.fillRect(l + w * 0.12, b + h * 0.58, w * 0.12, w * 0.12); // status light
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(r - w * 0.22, b + h * 0.58, w * 0.1, w * 0.12);
      break;
    }
    case 'rotodome': {
      const dw = w * 0.32;
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(l + w * 0.3, y - 0.6, w * 0.7, 1.2); ctx.strokeRect(l + w * 0.3, y - 0.6, w * 0.7, 1.2);
      ctx.fillStyle = bodyGrad(ctx, l, l + dw, () => (PartPaint.flat ? '#eef1f4' : hullGradient0(ctx, l, l + dw))); ctx.fillRect(l, b, dw, h);
      ctx.fillStyle = '#2b3036'; ctx.fillRect(l, b + h * 0.06, dw, h * 0.3); ctx.fillRect(l, t - h * 0.36, dw, h * 0.3); // the radar arrays
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(l + dw * 0.3, y - 0.2, dw * 0.4, 0.4);
      ctx.strokeRect(l, b, dw, h);
      break;
    }
    case 'skid': {
      ctx.fillStyle = PAL.steelDark;
      for (const yy of [y + h * 0.25, y - h * 0.25]) { ctx.fillRect(l, yy - 0.07, w - 0.2, 0.14); ctx.strokeRect(l, yy - 0.07, w - 0.2, 0.14); }
      ctx.beginPath(); ctx.moveTo(r - 0.24, b + 0.1); ctx.lineTo(r, b + 0.1); ctx.lineTo(r, t - 0.35); ctx.quadraticCurveTo(r, t - 0.05, r - 0.4, t - 0.1);
      ctx.lineTo(r - 0.4, t - 0.24); ctx.quadraticCurveTo(r - 0.24, t - 0.26, r - 0.24, t - 0.4); ctx.closePath();
      ctx.fillStyle = bodyFlat(PAL.steelLight); ctx.fill(); ctx.stroke();
      break;
    }
    case 'airnose': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = bodyTone('#c9ced4', -0.11); ctx.fillRect(x + w * 0.22, b, w * 0.3, h); // belly
      ctx.fillStyle = accent('#2f6fb7'); ctx.fillRect(x + w * 0.04, b, w * 0.1, h * 0.8);
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(x + w * 0.14, b, w * 0.04, h * 0.7);
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
      partPath(ctx, p); ctx.fillStyle = bodyGrad(ctx, xb, x + w / 2, () => { if (PartPaint.flat) return '#e8b23a'; const g = ctx.createLinearGradient(xb, 0, x + w / 2, 0); g.addColorStop(0, '#ffd36a'); g.addColorStop(1, '#c98f1c'); return g; });
      ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = PAL.ink; ctx.fillRect(x + w * 0.3, b, w * 0.2, h); ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'droptank': {
      ctx.fillStyle = PAL.steelDark; ctx.fillRect(x - w / 2, y - h * 0.15, w * 0.5, h * 0.3); // pylon
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, x - w * 0.05, r); ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = accent(PAL.orange); ctx.fillRect(l, t - h * 0.14, w, h * 0.06); ctx.fillRect(l, b + h * 0.08, w, h * 0.06); ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'airbrake': {
      ctx.fillStyle = bodyFlat(PAL.steelLight); ctx.fillRect(l, b, w, h);
      ctx.fillStyle = PAL.hazard;
      for (let yy = b; yy < t - 0.01; yy += 0.3) ctx.fillRect(l, yy, w, 0.15);
      ctx.strokeRect(l, b, w, h);
      break;
    }
    case 'fuselage': {
      if (d.style) { drawFuselageStyle(ctx, p, lw); break; }
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fillRect(l, b, w, h);
      ctx.fillStyle = bodyTone('#c9ced4', -0.11); ctx.fillRect(x + w * 0.22, b, w * 0.28, h); // belly
      ctx.fillStyle = accent('#2f6fb7'); ctx.fillRect(x + w * 0.04, b, w * 0.1, h); // cheatline
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(x + w * 0.14, b, w * 0.04, h);
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
      ctx.fillStyle = accent('#2f6fb7'); ctx.fillRect(x + w * 0.04, b, w * 0.1, h);
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(x + w * 0.14, b, w * 0.04, h);
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
      ctx.fillStyle = accent(d.shape === 'elevator' ? PAL.orange : 'rgba(255,122,26,0.85)'); // control surfaces
      ctx.fillRect(l - 1, b - 1, w + 2, h * (d.shape === 'elevator' ? 0.35 : 0.18) + 1);
      ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'vtail': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      const s = p.flip ? -1 : 1, out = x + s * w / 2;
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(Math.min(out, out - s * w * 0.3), b, w * 0.3, h);
      ctx.fillStyle = accent('#2f6fb7'); ctx.fillRect(l, b, w, h * 0.12);
      ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'prop': {
      const R = propRadius(d), rows = d.contra ? [b + h * 0.38, b + h * 0.56] : [b + h * 0.42];
      ctx.fillStyle = bodyMetal(ctx, x - 0.36, x + 0.36); ctx.fillRect(x - 0.36, b, 0.72, h * 0.3); ctx.strokeRect(x - 0.36, b, 0.72, h * 0.3);
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
      partPath(ctx, p); ctx.fillStyle = scram ? darkGradient(ctx, l, r) : pulse ? tintGradient(ctx, l, r, '#8a6f55') : bodyMetal(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      if (scram) { // heat tiles, and the wedge of the intake ramp
        ctx.strokeStyle = 'rgba(10,12,14,0.5)'; ctx.lineWidth = lw;
        ctx.beginPath(); for (let yy = b + 0.3; yy < t; yy += 0.4) { ctx.moveTo(l, yy); ctx.lineTo(r, yy); } ctx.stroke();
        ctx.fillStyle = '#1b1d21'; ctx.beginPath(); ctx.moveTo(l, t); ctx.lineTo(x, t - h * 0.3); ctx.lineTo(r, t); ctx.closePath(); ctx.fill();
        ctx.fillStyle = accent(PAL.orange); ctx.fillRect(l, b + h * 0.08, w, h * 0.03);
      } else if (pulse) { // a valve box at the front, rings down the pipe
        ctx.fillStyle = bodyTone('#5d4a3a', -0.3); ctx.fillRect(l, t - h * 0.22, w, h * 0.22);
        ctx.fillStyle = 'rgba(30,22,16,0.5)'; for (let i = 1; i < 6; i++) ctx.fillRect(l, b + h * 0.13 * i, w, 0.05);
      }
      if (scram || pulse) { ctx.restore(); partPath(ctx, p); ctx.stroke(); ctx.fillStyle = '#15181c'; ctx.fillRect(x - w * 0.24, b, w * 0.48, 0.08); if (p.firing > 0) { ctx.fillStyle = `rgba(255,150,80,${0.4 * p.firing})`; ctx.fillRect(x - w * 0.24, b, w * 0.48, 0.12); } break; }
      ctx.fillStyle = hullGradient(ctx, l, r); ctx.fillRect(l, t - h * 0.55, w, h * 0.55); // cowling
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(l, t - h * 0.58, w, h * 0.04);
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
      partPath(ctx, p); ctx.fillStyle = bodyGrad(ctx, l, r, () => { if (PartPaint.flat) return '#e2642e'; const g = ctx.createLinearGradient(0, b, 0, t); g.addColorStop(0, '#b8481d'); g.addColorStop(0.5, '#ef7a3c'); g.addColorStop(1, '#d4602a'); return g; });
      ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, h * 0.12);
      ctx.fillStyle = accent('rgba(255,255,255,0.75)'); ctx.fillRect(l, b + h * 0.3, w, h * 0.06);
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
      ctx.fillStyle = bodyFlat('#3a4048'); ctx.fillRect(l, b, w, h);
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
        ctx.fillStyle = bodyFlat('#5d6670'); ctx.fillRect(l, b, w, h * 0.36); ctx.strokeRect(l, b, w, h * 0.36);
        ctx.fillStyle = '#2b3036'; ctx.fillRect(x - bw / 2, bt, bw, t - bt); ctx.strokeRect(x - bw / 2, bt, bw, t - bt);
        ctx.fillStyle = '#4a525b';
        for (let i = 0; i < 3; i++) { const k = Math.sin((p.spin || 0) + (i * TAU) / 3) * bw * 0.32; ctx.fillRect(x + k - bw * 0.07, bt, bw * 0.14, t - bt); }
        for (const yy of [bt + (t - bt) * 0.35, t - h * 0.06]) { ctx.fillStyle = '#1b1f24'; ctx.fillRect(x - bw * 0.62, yy, bw * 1.24, h * 0.05); }
        break;
      }
      const big = (d.calibre || 0) > 20, bw = w * (big ? 0.34 : 0.3);
      ctx.fillStyle = bodyFlat('#5d6670'); ctx.fillRect(l, b, w, h * 0.42); ctx.strokeRect(l, b, w, h * 0.42); // receiver
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
      ctx.fillStyle = bodyFlat(storeColour(d)); ctx.fill(); ctx.stroke();
      if (d.style) { drawStoreStyle(ctx, d, cx, rw, b, t, h); break; }
      if (d.shape === 'missile') { // fins, seeker and a band
        ctx.fillStyle = '#4d545d';
        ctx.beginPath(); ctx.moveTo(bl, b + h * 0.06); ctx.lineTo(bl - rw * 0.7, b); ctx.lineTo(bl, b + h * 0.24); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(br, b + h * 0.06); ctx.lineTo(br + rw * 0.7, b); ctx.lineTo(br, b + h * 0.24); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = d.weapon.radar ? '#e8e2d0' : '#2c3a48'; ctx.fillRect(bl, t - h * 0.2, rw, h * 0.05);
        ctx.fillStyle = d.agm ? '#3f6b3a' : '#ffb547'; ctx.fillRect(bl, y - h * 0.02, rw, h * 0.04);
      } else if (d.shape === 'bomb') { // tail fins and yellow nose band
        ctx.fillStyle = bodyTone('#4b5541', -0.2); ctx.fillRect(cx - rw * 0.55, b, rw * 1.1, h * 0.12); ctx.strokeRect(cx - rw * 0.55, b, rw * 1.1, h * 0.12);
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
      ctx.fillStyle = bodyFlat('#7d8790'); ctx.fill(); ctx.stroke();
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
      ctx.fillStyle = bodyGrad(ctx, x - w * 0.4, x + w * 0.32, () => (PartPaint.flat ? '#7d8790' : metalGradient(ctx, x - w * 0.4, x + w * 0.32))); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x - w * 0.16, y + h * 0.08, w * 0.14, h * 0.13, 0, 0, TAU); ctx.fillStyle = PAL.glass; ctx.fill(); ctx.stroke();
      break;
    }
    case 'flares': {
      ctx.fillStyle = bodyFlat('#4d545d'); ctx.fillRect(l, b, w, h); ctx.strokeRect(l, b, w, h);
      if (d.style === 'chaff') { // chaff: four wrapped bundles of silver foil
        for (let i = 0; i < 4; i++) {
          const yy = b + h * (0.08 + i * 0.225), bh = h * 0.17;
          ctx.fillStyle = '#c3cbd4'; ctx.fillRect(l + w * 0.14, yy, w * 0.72, bh);
          ctx.fillStyle = '#eef3f8'; ctx.fillRect(l + w * 0.2, yy + bh * 0.6, w * 0.36, bh * 0.22);
          ctx.fillStyle = '#7d8790'; ctx.fillRect(x - w * 0.05, yy, w * 0.1, bh);
        }
        break;
      }
      ctx.fillStyle = '#ffb547';
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { ctx.beginPath(); ctx.arc(l + w * (0.3 + j * 0.4), b + h * (0.2 + i * 0.3), w * 0.12, 0, TAU); ctx.fill(); }
      break;
    }
    case 'smokegen': {
      ctx.fillStyle = bodyFlat('#d7dbe0'); ctx.fillRect(l, b, w, h); ctx.strokeRect(l, b, w, h);
      ctx.fillStyle = accent('#e8483a'); ctx.fillRect(l, b + h * 0.25, w, h * 0.12);
      ctx.fillStyle = '#2b3036'; ctx.fillRect(x - w * 0.25, b - h * 0.02, w * 0.5, h * 0.1);
      break;
    }
    // ---- US 3rd/4th-generation look-alikes: a lofted body with its canopy, intakes and nozzles (us4* helpers at the end)
    case 'us4body':
      drawUS4(ctx, p, lw);
      break;
    default: // shapes without a dedicated drawing
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill(); ctx.stroke();
      break;
    case 'adapter': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = PAL.ink; ctx.fillRect(l, b, w, 0.12); ctx.fillRect(l, t - 0.12, w, 0.12); ctx.restore();
      partPath(ctx, p); ctx.stroke();
      break;
    }
    case 'ru': // the Russian look-alike jets (MyG and Sugoi): RU_ART at the end of this file
      ruDraw(ctx, p, lw);
      break;
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
    ctx.fillStyle = bodyTone('#2b2e34', -0.42); ctx.fillRect(l, b, w * 0.14, h); ctx.fillRect(r - w * 0.14, b, w * 0.14, h);
    ctx.strokeStyle = 'rgba(15,17,20,0.7)'; ctx.lineWidth = lw; sawtooth(ctx, l, r, b + h * 0.1, 0.25); sawtooth(ctx, l, r, t - h * 0.14, 0.25);
  } else if (st === 'cargo') {
    ctx.fillStyle = bodyTone(shade('#8f978c', -0.25), -0.25); ctx.fillRect(x + w * 0.22, b, w * 0.28, h); // belly
    ctx.strokeStyle = 'rgba(20,24,28,0.75)'; ctx.lineWidth = lw * 1.2;
    ctx.strokeRect(x + w * 0.05, b + 0.15, w * 0.4, h * 0.22); // the loading ramp at the back
    ctx.strokeRect(x - w * 0.1, t - h * 0.28, w * 0.35, h * 0.16); // crew door
    ctx.fillStyle = PAL.glass; for (let yy = b + h * 0.45; yy < t - h * 0.35; yy += 0.9) { ctx.beginPath(); ctx.arc(x - w * 0.2, yy, 0.13, 0, TAU); ctx.fill(); }
    if (!PartPaint.skin || PartPaint.skin.accent !== null) { // the roundel, unless the paint is low-visibility
      ctx.fillStyle = '#2f6fb7'; ctx.beginPath(); ctx.arc(x - w * 0.12, y, w * 0.12, 0, TAU); ctx.fill(); ctx.fillStyle = '#eef1f4'; ctx.beginPath(); ctx.arc(x - w * 0.12, y, w * 0.07, 0, TAU); ctx.fill();
      ctx.fillStyle = '#d23a2f'; ctx.beginPath(); ctx.arc(x - w * 0.12, y, w * 0.03, 0, TAU); ctx.fill();
    }
  } else if (st === 'tank') {
    ctx.fillStyle = accent('#2f6fb7'); ctx.fillRect(x + w * 0.04, b, w * 0.1, h);
    ctx.fillStyle = PAL.hazard; for (const yy of [b + h * 0.2, y, t - h * 0.2]) ctx.fillRect(l, yy - 0.08, w, 0.16);
    if (p.fuelFrac != null) { ctx.fillStyle = 'rgba(10,14,20,0.18)'; ctx.fillRect(x - w * 0.42, b + 0.1, w * 0.06, (h - 0.2) * (1 - p.fuelFrac)); }
  } else if (st === 'armor') {
    ctx.strokeStyle = 'rgba(30,34,40,0.6)'; ctx.lineWidth = lw;
    ctx.beginPath(); for (let yy = b + h / 4; yy < t - 0.01; yy += h / 4) { ctx.moveTo(l, yy); ctx.lineTo(r, yy); } ctx.moveTo(x, b); ctx.lineTo(x, t); ctx.stroke();
    ctx.fillStyle = 'rgba(30,34,40,0.55)';
    for (let yy = b + 0.15; yy < t; yy += h / 4) for (const xx of [l + 0.12, x - 0.12, x + 0.12, r - 0.12]) { ctx.beginPath(); ctx.arc(xx, yy, 0.04, 0, TAU); ctx.fill(); }
    ctx.fillStyle = accent(PAL.orange); ctx.fillRect(x + w * 0.14, b, w * 0.04, h);
  } else if (st === 'intake') {
    ctx.fillStyle = accent('#2f6fb7'); ctx.fillRect(x + w * 0.04, b, w * 0.1, h);
    ctx.fillStyle = PAL.steelDark; ctx.fillRect(x - w * 0.3, b, w * 0.55, h * 0.7); // the intake duct along the cheek
    ctx.fillStyle = '#15181c'; ctx.fillRect(x - w * 0.26, t - h * 0.32, w * 0.47, h * 0.06); // its mouth
    ctx.fillStyle = PAL.hazard; ctx.fillRect(x - w * 0.3, t - h * 0.26, w * 0.55, 0.06);
  } else if (st === 'boom') {
    ctx.fillStyle = accent(PAL.orange); ctx.fillRect(l, b, w, 0.25); ctx.fillRect(l, t - 0.25, w, 0.25);
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
      ctx.fillStyle = accent(PAL.orange); ctx.fillRect(cx - rw * 0.42, t - h * 0.2, rw * 0.84, h * 0.03);
      break;
    case 'harm': case 'cruise': { // fins, a band and (cruise) little wings mid-body
      const big = d.style === 'cruise';
      ctx.fillStyle = '#4d545d';
      ctx.beginPath(); ctx.moveTo(bl, b + h * 0.06); ctx.lineTo(bl - rw * 0.6, b); ctx.lineTo(bl, b + h * 0.2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(br, b + h * 0.06); ctx.lineTo(br + rw * 0.6, b); ctx.lineTo(br, b + h * 0.2); ctx.closePath(); ctx.fill();
      if (big) { ctx.fillStyle = bodyTone('#9a9478', -0.24); ctx.fillRect(bl - rw * 0.35, b + h * 0.42, rw * 1.7, h * 0.08); ctx.fillStyle = '#2b3036'; ctx.fillRect(cx - rw * 0.25, b + h * 0.08, rw * 0.5, h * 0.06); }
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
  const ps = partsFromDesign(d.parts); // with their depth and paint
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
  for (const p of sideOrder(ps)) drawPart(ctx, p, lw); // back to front, as in the builder
  return c;
}

// Render a part onto a small canvas for the palette, in a paint (a SKINS id) if given.
function renderPartIcon(type, size, dpr, rot = 0, skin = null) {
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(size * dpr);
  const ctx = c.getContext('2d');
  const def = PARTS[type];
  const s = (size * dpr * 0.8) / Math.max(def.w, def.h, 1.2);
  ctx.setTransform(s, 0, 0, -s, c.width / 2, c.height / 2);
  ctx.rotate(rot);
  const p = { def, type, x: 0, y: 0, flip: false, deployed: 0, skin };
  drawPart(ctx, p, (1.4 / s) * dpr);
  return c;
}

// ===========================================================================
// 5th-generation look-alikes: the FS-22 (after the F-22 Raptor) and the FS-35 (after the F-35 Lightning II). Their
// shapes, camouflage and 2D art. A body is lofted through cross-sections, `rings` of points [x, y, z] in the part's own
// frame (+x down, +y towards the nose, +z the right wing); the same lofts make the 2D outline and art here and the 3D
// model (parts3d.js, BUILD.us5), so the two agree. A loft is { rings, kind: 'body' (in its paint) or a material
// ('goldglass', 'intake'...), smooth (rounded, not faceted), open (an arch such as a canopy: nothing from its last
// point back to its first), caps: 'front' | 'back' | 'both' (else none) and capKind, skip: [[i, k]] faces left out
// (between rings i and i+1 and points k and k+1) where a door fills the hole, sil: false to leave it out of the outline }.

// A table of sections [y, ...] (y ascending), at y (clamped to its ends).
function us5Lerp(rows, y) {
  if (y <= rows[0][0]) return rows[0].slice(1);
  for (let i = 1; i < rows.length; i++) if (y <= rows[i][0]) {
    const a = rows[i - 1], b = rows[i], k = (y - a[0]) / (b[0] - a[0]);
    return a.slice(1).map((v, j) => v + (b[j + 1] - v) * k);
  }
  return rows[rows.length - 1].slice(1);
}
// A stealth section r = [top, bot, cw, cx, tw, bw]: a flat spine (x = top) sloping out to sharp chines cw out at
// height cx, and a belly (x = bot) with flat sides bw out. keels: points on the belly at these half widths
// (descending), where bay doors hinge.
function us5Hex(y, r, keels) {
  const [top, bot, cw, cx, tw, bw] = r, sh = top + (cx - top) * 0.18, lo = bot - (bot - cx) * 0.22;
  const K = (keels || []).map((z) => [bot + (lo - bot) * (z / bw), y, z]);
  return [[top, y, 0], [sh, y, tw], [cx, y, cw], [lo, y, bw], ...K, [bot, y, 0], ...K.slice().reverse().map((q) => [q[0], y, -q[2]]), [lo, y, -bw], [cx, y, -cw], [sh, y, -tw]];
}
// The upper half of a section, closed by a flat underside at the chines (a shelf over the intakes).
function us5Lid(y, r) { const [top, , cw, cx, tw] = r, sh = top + (cx - top) * 0.18; return [[cx, y, cw], [sh, y, tw], [top, y, 0], [sh, y, -tw], [cx, y, -cw]]; }
// The lower middle of a body b = [bot, cw, cx, bw, lo]: from the chines (cw out at height cx) down to a belly.
function us5Belly(y, b) { const [bot, cw, cx, bw, lo] = b; return [[cx, y, -cw], [lo, y, -bw], [bot, y, 0], [lo, y, bw], [cx, y, cw]]; }
// The spine's height at z across a section: where a canopy sits.
function us5Top(r, z) {
  const [top, , cw, cx, tw] = r, sh = top + (cx - top) * 0.18, a = Math.abs(z);
  return a <= tw ? top + ((sh - top) * a) / (tw || 1) : a <= cw ? sh + ((cx - sh) * (a - tw)) / (cw - tw || 1) : cx;
}
// An arch from the left sill over the top to the right one: a canopy's section (hgt above the sill, hw out).
function us5Arch(y, sill, hgt, hw, n = 12) {
  const R = [];
  for (let i = 0; i <= n; i++) { const a = Math.PI * (1 - i / n); R.push([sill - hgt * Math.pow(Math.sin(a), 0.7), y, hw * Math.cos(a)]); }
  return R;
}
// An ellipse round (xc, zc), rz across and rx up and down (n points, starting at the top).
function us5Oval(y, xc, zc, rz, rx, n = 16, rot = 0) {
  const R = [];
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU; R.push([xc - rx * Math.cos(a), y, zc + rz * Math.sin(a)]); }
  return R;
}
// A canopy on a table of sections, from its stations [y, height, half width].
function us5Canopy(rows, C, kind = 'goldglass') {
  return { rings: C.map(([y, hg, hw]) => us5Arch(y, us5Top(us5Lerp(rows, y), hw) + 0.015, hg, hw)), kind, smooth: true, open: true, canopy: true };
}
const us5Mirror = (R) => R.map((q) => [q[0], q[1], -q[2]]);

// The bays, shared by the art and the 3D model: the doors' extent along the part (y0..y1); each door [the ring point
// it hinges on, the point it reaches to (fractional: between two points), how far it swings open (radians about the
// long axis)] on the rings of the bay's loft (the right duct, for side bays); where the stores sit (mx: their height
// inside; at: [x, z] of a side bay's missile, shut) and the cavity's roof.
const US5_BAYS = {
  intake22: { y0: 0.6, y1: -2.15, side: true, doors: [[1, 2, -1.3]], msl: 'aim9', at: [0.42, 2.0] },
  bay22: { y0: 1.8, y1: -1.8, doors: [[4, 5, -1.75], [6, 5, 1.75]], msl: 'aim120', mx: 0.6, roof: 0.3 },
  bay35: { y0: 1.75, y1: -1.75, doors: [[4, 4.5, -1.7], [5, 4.5, 1.7], [7, 7.5, -1.7], [8, 7.5, 1.7]], msl: 'aim120', mx: 0.68, roof: 0.42 },
};
// A ring point by a fractional index (between two points).
function us5At(R, f) { const i = Math.floor(f), k = f - i, a = R[i], b = R[Math.min(R.length - 1, i + 1)]; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
// Where a door's free edge is ([x, z]) when open by k (0 shut .. 1 open), turned about its hinge as rotation.y turns it in 3D.
function us5Swing(R, door, k) {
  const h = R[door[0]], f = us5At(R, door[1]), a = door[2] * k, dx = f[0] - h[0], dz = f[2] - h[2];
  return [h[0] + dx * Math.cos(a) + dz * Math.sin(a), h[2] - dx * Math.sin(a) + dz * Math.cos(a)];
}

const US5_N22 = [[-2.8, -0.85, 0.88, 1.18, 0.07, 0.46, 0.64], [-2.0, -0.80, 0.84, 1.10, 0.07, 0.44, 0.60], [-1.0, -0.70, 0.76, 0.98, 0.08, 0.40, 0.52],
  [0, -0.58, 0.66, 0.80, 0.09, 0.33, 0.40], [0.8, -0.44, 0.55, 0.62, 0.10, 0.26, 0.30], [1.6, -0.28, 0.43, 0.41, 0.11, 0.17, 0.19],
  [2.3, -0.11, 0.28, 0.20, 0.12, 0.07, 0.09], [2.8, 0.12, 0.12, 0, 0.12, 0, 0]];
const US5_N35 = [[-2.25, -0.95, 1.0, 1.22, 0.08, 0.46, 0.7], [-1.2, -0.84, 0.94, 1.07, 0.10, 0.41, 0.6], [-0.1, -0.65, 0.80, 0.85, 0.12, 0.32, 0.44],
  [0.95, -0.42, 0.59, 0.57, 0.14, 0.21, 0.27], [1.75, -0.16, 0.37, 0.26, 0.15, 0.08, 0.1], [2.25, 0.17, 0.17, 0, 0.17, 0, 0]];
// the FS-22's body behind its intakes, wide over the ducts (front and back of the bay section), and the FS-35's
const US5_MID22 = [-0.88, 0.92, 2.33, -0.05, 0.55, 2.0], US5_MID22B = [-0.86, 0.90, 2.27, -0.05, 0.58, 1.95];
const US5_MID35 = [-1.15, 1.05, 1.92, -0.02, 0.6, 1.62], US5_MID35B = [-1.06, 1.03, 1.88, -0.02, 0.62, 1.58];
// a duct beside the body: [inner top, outer top, outer bottom, inner bottom] at y, each [x, z] (z on the right)
const us5Duct = (y, it, ot, ob, ib) => [[it[0], y, it[1]], [ot[0], y, ot[1]], [ob[0], y, ob[1]], [ib[0], y, ib[1]]];
// a pair of lofts, the right one and its mirror image
const us5Pair = (L) => [L, { ...L, rings: L.rings.map(us5Mirror), left: true }];
// a tail boom beside the engines at (xc, zc), tapering off behind y1
const us5Boom = (y0, y1, xc, zc, hw, hx) => ({ rings: [us5Oval(y0, xc, zc, hw, hx, 6), us5Oval((y0 + y1) / 2, xc, zc, hw, hx, 6), us5Oval(y1 + 0.5, xc, zc, hw * 0.6, hx * 0.7, 6), us5Oval(y1, xc + hx * 0.2, zc, 0.02, 0.02, 6)] });

const US5_SHAPES = {
  nose22() {
    return [{ rings: US5_N22.map((r) => us5Hex(r[0], r.slice(1))), caps: 'back', chine: true },
      us5Canopy(US5_N22, [[0.6, 0, 0.06], [0.3, 0.3, 0.3], [-0.25, 0.52, 0.43], [-0.85, 0.66, 0.48], [-1.5, 0.7, 0.49], [-2.2, 0.62, 0.47], [-2.9, 0.45, 0.42], [-3.4, 0.24, 0.32], [-3.75, 0.03, 0.16]])];
  },
  intake22() {
    const LID = [[-2.2, ...US5_MID22], [0.9, -0.87, 0, 2.31, -0.04, 0.52, 0], [1.4, -0.865, 0, 2.06, -0.01, 0.5, 0], [1.8, -0.86, 0, 1.62, 0.03, 0.48, 0], [2.2, ...US5_N22[0].slice(1)]];
    const BELLY = [[-2.2, 0.92, 1.24, -0.05, 1.24, 0.80], [0.6, 0.91, 1.24, -0.04, 1.22, 0.79], [1.6, 0.9, 1.22, 0.0, 0.95, 0.75], [2.2, 0.88, 1.18, 0.07, 0.64, 0.702]];
    const duct = { rings: [[[0.02, 1.15, 1.26], [-0.04, 0.75, 2.30], [0.76, 1.65, 2.06], [0.84, 2.2, 1.27]],
      us5Duct(0.6, [0.0, 1.26], [-0.05, 2.31], [0.75, 2.04], [0.81, 1.27]), us5Duct(-2.15, [-0.02, 1.25], [-0.05, 2.33], [0.73, 2.0], [0.8, 1.25]),
      us5Duct(-2.2, [-0.02, 1.25], [-0.05, 2.33], [0.73, 2.0], [0.8, 1.25])], caps: 'front', capKind: 'intake', inset: 0.06, skip: [[1, 1]], duct: true };
    return [{ rings: [-2.2, 0.9, 1.4, 1.8, 2.2].map((y) => us5Lid(y, us5Lerp(LID, y))), chine: true },
      { rings: [-2.2, 0.6, 1.6, 2.2].map((y) => us5Belly(y, us5Lerp(BELLY, y))) }, ...us5Pair(duct)];
  },
  bay22() { // (the bay's floor is flat between the keels, where its doors hinge)
    const B = [[-1.9, ...US5_MID22B], [1.9, ...US5_MID22]], R = [-1.9, -1.8, 1.8, 1.9].map((y) => us5Hex(y, us5Lerp(B, y), [0.95]));
    for (const r of [R[1], R[2]]) r[5][0] = r[4][0];
    return [{ rings: R, skip: [[1, 4], [1, 5]], chine: true }];
  },
  aft22() {
    const A = [[-1.0, -0.70, 0.66, 1.72, -0.02, 0.85, 1.35], [0.2, -0.82, 0.84, 2.12, -0.04, 0.68, 1.8], [1.0, ...US5_MID22B]];
    // and between the engines, a flat tail fairing (the "beaver tail") running back between the nozzles
    const dia = (y, top, bot, hw) => [[top, y, 0], [(top + bot) / 2, y, hw], [bot, y, 0], [(top + bot) / 2, y, -hw]];
    const tail = { rings: [dia(-0.9, -0.42, 0.34, 0.24), dia(-2.0, -0.24, 0.2, 0.16), dia(-3.0, -0.05, 0.05, 0.02)] };
    return [{ rings: [-1.0, -0.4, 0.2, 0.6, 1.0].map((y) => us5Hex(y, us5Lerp(A, y))), caps: 'back', chine: true }, ...us5Pair(us5Boom(0.4, -3.4, 0.2, 1.98, 0.21, 0.32)), tail];
  },
  nose35() {
    return [{ rings: US5_N35.map((r) => us5Hex(r[0], r.slice(1))), caps: 'back', chine: true },
      us5Canopy(US5_N35, [[0.3, 0, 0.07], [0.0, 0.38, 0.36], [-0.45, 0.62, 0.5], [-1.0, 0.75, 0.56], [-1.65, 0.75, 0.56], [-2.25, 0.63, 0.53], [-2.75, 0.43, 0.46], [-3.05, 0.2, 0.33], [-3.2, 0.03, 0.18]])];
  },
  intake35() {
    const LID = [[-1.3, ...US5_MID35], [0.15, -1.14, 0, 1.9, -0.01, 0.57, 0], [0.75, -1.06, 0, 1.6, 0.04, 0.5, 0], [1.3, ...US5_N35[0].slice(1)]];
    const BELLY = [[-1.3, 1.05, 1.27, -0.02, 1.27, 0.87], [0.3, 1.04, 1.27, 0.0, 1.25, 0.86], [1.3, 1.0, 1.22, 0.08, 0.7, 0.81]];
    const duct = { rings: [[[0.02, 1.0, 1.28], [-0.03, 0.88, 1.93], [0.8, 0.32, 1.66], [0.88, 0.48, 1.29]],
      us5Duct(0.2, [0.0, 1.28], [-0.02, 1.93], [0.8, 1.65], [0.87, 1.28]), us5Duct(-1.3, [-0.02, 1.27], [-0.02, 1.92], [0.815, 1.62], [0.87, 1.27])],
    caps: 'front', capKind: 'intake', inset: 0.06, duct: true };
    // the bump: a smooth bulge on the body's side just ahead of each inlet (it pushes the slow air aside)
    const bump = { rings: [1.45, 1.25, 1.0, 0.75, 0.5].map((y, i) => us5Oval(y, 0.42, 1.2, [0.03, 0.12, 0.17, 0.18, 0.16][i], [0.12, 0.33, 0.41, 0.42, 0.4][i], 12)), smooth: true, sil: false };
    return [{ rings: [-1.3, 0.15, 0.75, 1.3].map((y) => us5Lid(y, us5Lerp(LID, y))), chine: true },
      { rings: [-1.3, 0.3, 1.3].map((y) => us5Belly(y, us5Lerp(BELLY, y))) }, ...us5Pair(duct), ...us5Pair(bump)];
  },
  bay35() { // (two flat-floored bays, a keel between them)
    const B = [[-1.9, ...US5_MID35B], [1.9, ...US5_MID35]], R = [-1.9, -1.75, 1.75, 1.9].map((y) => us5Hex(y, us5Lerp(B, y), [0.9, 0.12]));
    for (const r of [R[1], R[2]]) { r[5][0] = r[4][0]; r[7][0] = r[8][0]; }
    return [{ rings: R, skip: [[1, 4], [1, 7]], chine: true }];
  },
  aft35() {
    const A = [[-1.2, -0.82, 0.8, 1.22, 0.0, 0.5, 0.78], [-0.2, -0.96, 0.95, 1.62, -0.01, 0.56, 1.25], [1.2, ...US5_MID35B]];
    return [{ rings: [-1.2, -0.7, -0.2, 0.5, 1.2].map((y) => us5Hex(y, us5Lerp(A, y))), caps: 'back', chine: true }, ...us5Pair(us5Boom(0.0, -2.4, 0.2, 1.55, 0.2, 0.3))];
  },
  eng22() { // the nacelle back to the nozzle's throat (the nozzle itself is drawn on its own: it swivels)
    const box = (y, hw, hh, c) => [[-hh, y, -hw + c], [-hh, y, hw - c], [-hh + c, y, hw], [hh - c, y, hw], [hh, y, hw - c], [hh, y, -hw + c], [hh - c, y, -hw], [-hh + c, y, -hw]];
    return [{ rings: [box(-0.45, 0.6, 0.47, 0.12), box(0.5, 0.71, 0.56, 0.18), box(1.55, 0.74, 0.6, 0.2)], caps: 'front' }];
  },
  eng35() {
    return [{ rings: [us5Oval(0.15, 0, 0, 0.73, 0.73, 24), us5Oval(0.6, 0, 0, 0.75, 0.75, 24), us5Oval(1.2, 0, 0, 0.75, 0.75, 24)], smooth: true, caps: 'front' }];
  },
};
// The lofts of a part type (worked out once, kept on its def out of sight).
function us5Lofts(d) {
  if (!d._us5) Object.defineProperty(d, '_us5', { value: US5_SHAPES[d.us5] ? US5_SHAPES[d.us5]().map((L) => ({ kind: 'body', ...L })) : [], enumerable: false });
  return d._us5;
}
// A loft seen from the side (+z): along its top edge from the back to the front, then back along its bottom.
function us5Side(L) {
  const top = [], bot = [];
  for (const R of L.rings) {
    let a = R[0], b = R[0];
    for (const q of R) { if (q[0] < a[0]) a = q; if (q[0] > b[0]) b = q; }
    top.push([a[0], a[1]]); bot.push([b[0], b[1]]);
  }
  return [...top, ...bot.reverse()];
}
// Its chine: the point furthest out on the right, ring by ring.
function us5Chine(L) { return L.rings.map((R) => R.reduce((m, q) => (q[2] > m[2] ? q : m), R[0])).map((q) => [q[0], q[1]]); }

// Flat parts in the part's frame: a canted fin seen from the side (its root on the inner edge, its tip on the outer;
// flip: standing up from the top of the plane), the flat nozzle (its flaps swivel about the hinge; the sidewall
// stays), the round one.
function us5FinPoly(d, flip) {
  const s = flip ? -1 : 1, xi = -s * d.w / 2, xo = s * d.w / 2, t = d.h / 2;
  return [[xi, t], [xo, t - d.tipLE], [xo, t - d.tipLE - d.tipC], [xi, -t]];
}
const US5_NOZ22 = { hinge: -0.45, len: 1.1, x0: 0.44, x1: 0.17, hw: 0.55, side: [[-0.48, -0.45], [0.48, -0.45], [0.48, -1.42], [-0.48, -1.12]] };
const US5_NOZ35 = { y0: 0.15, y1: -1.2, r0: 0.7, r1: 0.55, teeth: 14 };
// The gun's fairing seen from the side: a low hump on its base (the side it mounts by), the port at the front.
function us5GunPoly(d, flip) {
  const b = flip ? 1 : -1, t = d.h / 2, base = b * d.w / 2, H = d.w * 0.55;
  return [[base, -t], [base, t - 0.05], [base - b * H * 0.6, t], [base - b * H, t - 0.4], [base - b * H * 0.85, -t + 0.6], [base - b * 0.01, -t]];
}

// ---- camouflage: soft blotches of a second tone (the skin's camo) over its base, repeating every 16 m; u, v in metres
const US5_CAMO_TILE = 16;
function us5CamoAt(pat, u, v) {
  const k = TAU / US5_CAMO_TILE, s = Math.sin;
  if (pat === 1) { // fine, faint patches: the quilted look of a radar-absorbent coat
    const n = s(4 * k * u + 0.9 * s(3 * k * v)) * s(4 * k * v + 0.8 * s(2 * k * u + 1.3)) + 0.3 * s(7 * k * u - 5 * k * v);
    return smoothstep(0.15, 0.45, n);
  }
  if (pat === 2) { // hard-edged splinters
    const n = s(3 * k * u + 2 * k * v + 1.1) + 0.8 * s(5 * k * u - 3 * k * v + 0.4) + 0.6 * s(k * u + 4 * k * v);
    return smoothstep(0.22, 0.34, n);
  }
  const n = s(2 * k * u + 1.6 * s(k * v + 0.7)) * s(2 * k * v + 1.4 * s(3 * k * u + 1.9)) + 0.35 * s(k * u - 3 * k * v + 1.2 * s(2 * k * v));
  return smoothstep(0.08, 0.32, n);
}
const US5_CAMO = {};
// The pattern as a tile (a canvas, 16 px a metre), per skin.
function us5CamoTile(S) {
  if (US5_CAMO[S.name]) return US5_CAMO[S.name];
  const N = 256, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N), A = parseInt(S.base.slice(1), 16), B = parseInt(S.camo.slice(1), 16);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const t = us5CamoAt(S.pat, ((i + 0.5) / N) * US5_CAMO_TILE, ((j + 0.5) / N) * US5_CAMO_TILE), o = (j * N + i) * 4;
    for (let ch = 0; ch < 3; ch++) { const sh = 16 - ch * 8, a = (A >> sh) & 255, b = (B >> sh) & 255; img.data[o + ch] = Math.round(a + (b - a) * t); }
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (US5_CAMO[S.name] = c);
}
// The fill of a camouflaged skin: its tile as a pattern in metres (in the coordinates of whatever is being drawn).
function us5CamoFill(ctx, S) {
  if (typeof document === 'undefined' || !ctx.createPattern) return S.base;
  const pat = ctx.createPattern(us5CamoTile(S), 'repeat');
  if (!pat) return S.base;
  const o = PartPaint.camoAt || [0, 0];
  if (pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix().translate(-o[0], -o[1]).scale(US5_CAMO_TILE / 256)); // (in metres, from the blueprint's origin)
  return pat;
}

// ---- 2D: the outline (each loft from the side, and the flat parts' shapes) and the art.
function us5Path(ctx, p) {
  const d = p.def, poly = (P) => { P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
  if (d.us5 === 'wing') { foilPath(ctx, p); return; }
  if (d.us5 === 'gear') {
    const g = wheelGeom(p), s = p.flip ? -1 : 1, i = p.x - s * d.w / 2;
    ctx.rect(Math.min(i, g.x) - 0.08, g.y - 0.09, Math.abs(g.x - i) + 0.16, 0.18); ctx.moveTo(g.x + g.r, g.y); ctx.arc(g.x, g.y, g.r, 0, TAU);
    return;
  }
  ctx.save(); ctx.translate(p.x, p.y);
  if (d.us5 === 'fin') poly(us5FinPoly(d, p.flip));
  else if (d.us5 === 'gun') poly(us5GunPoly(d, p.flip));
  else if (d.us5 === 'eng22') { const N = US5_NOZ22; poly(N.side); poly([[-N.x0, N.hinge], [N.x0, N.hinge], [N.x1, N.hinge - N.len], [-N.x1, N.hinge - N.len]]); }
  else if (d.us5 === 'eng35') { const N = US5_NOZ35; poly([[-N.r0, N.y0], [N.r0, N.y0], [N.r1, N.y1], [-N.r1, N.y1]]); }
  for (const L of us5Lofts(d)) if (L.kind === 'body' && L.sil !== false) poly(us5Side(L));
  ctx.restore();
}

function us5Draw(ctx, p, lw) {
  const d = p.def, prev = PartPaint.skin, own = !prev && d.look && hasOwn(SKINS, d.look);
  if (own) PartPaint.skin = SKINS[d.look]; // (their own look: a camouflage, as if painted)
  try { (US5_ART[d.us5] || US5_ART.body)(ctx, p, lw, d); } finally { PartPaint.skin = prev; }
}
// Draw in the part's frame (x and y relative to its centre).
function us5Local(ctx, p, f) { ctx.save(); ctx.translate(p.x, p.y); try { f(); } finally { ctx.restore(); } }
const us5Poly = (ctx, P) => { ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
const US5_INK = 'rgba(8,11,16,0.9)', US5_LINE = 'rgba(18,22,27,0.42)';
// The body: every loft in its paint, on the blueprint with a soft light from above, and its chines as creases.
function us5Body(ctx, p, lw, d) {
  const L = us5Lofts(d).filter((q) => q.kind === 'body' && q.sil !== false), w = d.w;
  partPath(ctx, p); ctx.fillStyle = skinFill(ctx, p.x - w / 2, p.x + w / 2); ctx.fill();
  if (!PartPaint.flat) {
    ctx.save(); partPath(ctx, p); ctx.clip();
    const g = ctx.createLinearGradient(p.x - w / 2, 0, p.x + w / 2, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(0.42, 'rgba(255,255,255,0)'); g.addColorStop(0.58, 'rgba(0,0,0,0.04)'); g.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = g; ctx.fillRect(p.x - w, p.y - d.h, w * 2, d.h * 2);
    ctx.restore();
  }
  us5Local(ctx, p, () => {
    ctx.strokeStyle = 'rgba(12,15,19,0.5)'; ctx.lineWidth = lw * 1.1;
    for (const q of L) if (q.chine) { ctx.beginPath(); us5Chine(q).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
  });
}
function us5Outline(ctx, p, lw) { ctx.strokeStyle = US5_INK; ctx.lineWidth = lw; partPath(ctx, p); ctx.stroke(); }
// A panel line across a body at y, from its spine to its belly, sawtooth-edged as on a stealth plane.
function us5Seam(ctx, rows, y, k, lw) {
  const r = us5Lerp(rows, y), n = 5, dx = (r[1] - r[0] - 0.08) / n;
  ctx.strokeStyle = US5_LINE; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(r[0] + 0.04, y);
  for (let i = 0; i < n; i++) { ctx.lineTo(r[0] + 0.04 + dx * (i + 0.5), y + k); ctx.lineTo(r[0] + 0.04 + dx * (i + 1), y); }
  ctx.stroke();
}
// A missile seen from the side, nose forward, centred on (x, y): white, with fins (aim9: slim, with canards).
function us5Missile(ctx, x, y, len, kind, lw) {
  const r = kind === 'aim9' ? 0.065 : 0.09, t = y + len / 2, b = y - len / 2, f = kind === 'aim9' ? 0.16 : 0.2;
  ctx.fillStyle = '#e6e9ec'; ctx.strokeStyle = US5_INK; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x - r, b); ctx.lineTo(x - r, t - r * 3); ctx.quadraticCurveTo(x, t + 0.02, x + r, t - r * 3); ctx.lineTo(x + r, b); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#9aa3ad';
  for (const yy of [b, kind === 'aim9' ? t - len * 0.22 : y]) { ctx.beginPath(); ctx.moveTo(x - r - f, yy); ctx.lineTo(x + r + f, yy); ctx.lineTo(x + r, yy + f * 1.4); ctx.lineTo(x - r, yy + f * 1.4); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = kind === 'aim9' ? '#3b4652' : '#c9cfd6'; ctx.fillRect(x - r, t - r * 3.2, r * 2, r * 1.2);
}
// A canopy: gold-tinted glass from its sill up, with a long reflection; frame: a bow across it at that y.
function us5Glass(ctx, p, lw, d, frame) {
  const C = us5Lofts(d).find((q) => q.canopy);
  us5Local(ctx, p, () => {
    const P = us5Side(C), top = Math.min(...P.map((q) => q[0])), sill = Math.max(...P.map((q) => q[0]));
    us5Poly(ctx, P);
    let g = '#c3974a';
    if (!PartPaint.flat) { g = ctx.createLinearGradient(top, 0, sill, 0); g.addColorStop(0, '#f0d38a'); g.addColorStop(0.5, '#c79a45'); g.addColorStop(1, '#7c5a22'); }
    ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = US5_INK; ctx.lineWidth = lw; ctx.stroke();
    const n = Math.floor(P.length / 2), a = P[Math.floor(n * 0.3)], b = P[Math.floor(n * 0.75)];
    ctx.strokeStyle = 'rgba(255,248,225,0.55)'; ctx.lineWidth = lw * 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a[0] + 0.1, a[1]); ctx.lineTo(b[0] + 0.08, b[1]); ctx.stroke(); ctx.lineCap = 'butt';
    if (frame != null) {
      const q = P.slice(0, n).reduce((m, v) => (Math.abs(v[1] - frame) < Math.abs(m[1] - frame) ? v : m), P[0]);
      ctx.strokeStyle = US5_INK; ctx.lineWidth = lw * 2.4; ctx.beginPath(); ctx.moveTo(q[0], frame); ctx.lineTo(sill - 0.02, frame); ctx.stroke();
    }
  });
}
// Bay doors on a belly, seen edge-on from the side: a seam when shut; open, they hang below the belly.
function us5BellyDoors(ctx, p, lw, d, B) {
  const k = clamp(p.deployed || 0, 0, 1), R = us5Lofts(d)[0].rings, bot = (i) => Math.max(...R[i].map((q) => q[0]));
  us5Local(ctx, p, () => {
    ctx.strokeStyle = US5_LINE; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(bot(2) - 0.02, B.y0 + 0.05); ctx.lineTo(bot(2) - 0.12, B.y0 - 0.1); ctx.lineTo(bot(1) - 0.12, B.y1 + 0.1); ctx.lineTo(bot(1) - 0.02, B.y1 - 0.05); ctx.stroke();
    if (k <= 0) return;
    const drop = Math.max(...B.doors.map((D) => us5Swing(R[1], D, k)[0])) - bot(1);
    ctx.fillStyle = bodyTone('#5a6068', -0.35); ctx.strokeStyle = US5_INK;
    us5Poly(ctx, [[bot(2) - 0.05, B.y0 - 0.05], [bot(2) + drop, B.y0 - 0.25], [bot(1) + drop, B.y1 + 0.05], [bot(1) - 0.05, B.y1 + 0.05]]); ctx.fill(); ctx.stroke();
  });
}

const US5_ART = {
  body(ctx, p, lw, d) { us5Body(ctx, p, lw, d); us5Outline(ctx, p, lw); },
  nose22(ctx, p, lw, d) {
    us5Body(ctx, p, lw, d);
    us5Local(ctx, p, () => { us5Seam(ctx, US5_N22, 1.0, 0.12, lw); us5Seam(ctx, US5_N22, -2.7, -0.1, lw); });
    us5Outline(ctx, p, lw);
    us5Glass(ctx, p, lw, d, null);
  },
  nose35(ctx, p, lw, d) {
    us5Body(ctx, p, lw, d);
    us5Local(ctx, p, () => {
      us5Seam(ctx, US5_N35, 0.9, 0.12, lw);
      const r = us5Lerp(US5_N35, 0.45)[1]; // the targeting camera's faceted window under the chin
      us5Poly(ctx, [[r - 0.03, 0.85], [r + 0.13, 0.62], [r + 0.13, 0.2], [r - 0.03, 0.05]]); ctx.fillStyle = '#2a3a52'; ctx.fill(); ctx.strokeStyle = US5_INK; ctx.lineWidth = lw; ctx.stroke();
      ctx.strokeStyle = 'rgba(160,200,255,0.5)'; ctx.beginPath(); ctx.moveTo(r + 0.05, 0.7); ctx.lineTo(r + 0.05, 0.3); ctx.stroke();
    });
    us5Outline(ctx, p, lw);
    us5Glass(ctx, p, lw, d, -2.3);
  },
  intake22(ctx, p, lw, d) {
    us5Body(ctx, p, lw, d);
    const B = US5_BAYS.intake22, D = B.doors[0], k = clamp(p.deployed || 0, 0, 1), duct = us5Lofts(d).find((q) => q.duct);
    us5Local(ctx, p, () => {
      us5Poly(ctx, duct.rings[0].map((q) => [q[0], q[1]])); ctx.fillStyle = '#121519'; ctx.fill(); ctx.strokeStyle = US5_INK; ctx.lineWidth = lw; ctx.stroke(); // the inlet
      // the side bay's door on the duct, sawtooth at both ends; open, the bay is dark and the missile swings out on its arm
      const R = duct.rings[1], h = R[D[0]], hx = h[0], fx = us5At(R, D[1])[0], door = [[hx + 0.03, B.y0], [fx - 0.03, B.y0 - 0.12], [fx - 0.03, B.y1 + 0.12], [hx + 0.03, B.y1]];
      us5Poly(ctx, door);
      if (k > 0) {
        ctx.fillStyle = '#16191d'; ctx.fill();
        const tip = us5Swing(R, D, k)[0], a = D[2] * k, x = hx + (B.at[0] - hx) * Math.cos(a) + (B.at[1] - h[2]) * Math.sin(a);
        us5Poly(ctx, [[hx, B.y0], [tip, B.y0 - 0.12], [tip, B.y1 + 0.12], [hx, B.y1]]); ctx.fillStyle = skinFill(ctx, hx, tip); ctx.fill(); ctx.strokeStyle = US5_INK; ctx.stroke();
        if ((p.ammo == null ? 2 : p.ammo) >= 2) us5Missile(ctx, x, (B.y0 + B.y1) / 2, 2.7, 'aim9', lw); // (the near bay's: the first heat seeker leaves from the near side)
      } else { ctx.strokeStyle = US5_LINE; ctx.lineWidth = lw; ctx.stroke(); }
      us5Seam(ctx, [[-2.2, ...US5_MID22], [2.2, ...US5_MID22]], -2.1, 0.1, lw);
    });
    us5Outline(ctx, p, lw);
  },
  intake35(ctx, p, lw, d) {
    us5Body(ctx, p, lw, d);
    us5Local(ctx, p, () => {
      const m = us5Lofts(d).find((q) => q.duct).rings[0];
      ctx.beginPath(); ctx.ellipse(0.42, 1.0, 0.36, 0.42, 0, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill(); // the bump, catching the light
      ctx.strokeStyle = US5_LINE; ctx.lineWidth = lw; ctx.stroke();
      us5Poly(ctx, m.map((q) => [q[0], q[1]])); ctx.fillStyle = '#121519'; ctx.fill(); ctx.strokeStyle = US5_INK; ctx.stroke(); // the inlet
      us5Seam(ctx, [[-1.3, ...US5_MID35], [1.3, ...US5_MID35]], -1.2, 0.1, lw);
    });
    us5Outline(ctx, p, lw);
  },
  bay22(ctx, p, lw, d) {
    const rows = [[-1.9, ...US5_MID22B], [1.9, ...US5_MID22]];
    us5Body(ctx, p, lw, d);
    us5BellyDoors(ctx, p, lw, d, US5_BAYS.bay22);
    us5Local(ctx, p, () => us5Seam(ctx, rows, -1.75, 0.1, lw));
    us5Outline(ctx, p, lw);
  },
  bay35(ctx, p, lw, d) {
    const rows = [[-1.9, ...US5_MID35B], [1.9, ...US5_MID35]];
    us5Body(ctx, p, lw, d);
    us5BellyDoors(ctx, p, lw, d, US5_BAYS.bay35);
    us5Local(ctx, p, () => us5Seam(ctx, rows, 1.8, -0.1, lw));
    us5Outline(ctx, p, lw);
  },
  eng22(ctx, p, lw, d) {
    const N = US5_NOZ22;
    us5Local(ctx, p, () => { // the flaps (swivelling about the throat with the stick), behind the fixed sidewall
      ctx.save(); ctx.translate(0, N.hinge); ctx.rotate(p.deflect || 0);
      us5Poly(ctx, [[-N.x0, 0], [N.x0, 0], [N.x1, -N.len], [-N.x1, -N.len]]); ctx.fillStyle = bodyMetal(ctx, -N.x0, N.x0); ctx.fill(); ctx.strokeStyle = US5_INK; ctx.lineWidth = lw; ctx.stroke();
      ctx.fillStyle = p.firing > 0 ? `rgba(255,150,80,${0.25 + 0.5 * p.firing})` : '#15181c'; ctx.fillRect(-N.x1 + 0.05, -N.len, (N.x1 - 0.05) * 2, 0.12);
      ctx.restore();
    });
    us5Body(ctx, p, lw, d);
    us5Local(ctx, p, () => {
      us5Poly(ctx, N.side); ctx.fillStyle = skinFill(ctx, -0.5, 0.5); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fill(); ctx.strokeStyle = US5_INK; ctx.lineWidth = lw; ctx.stroke();
      ctx.strokeStyle = US5_LINE; ctx.beginPath(); ctx.moveTo(-0.45, 0.9); ctx.lineTo(0.45, 0.9); ctx.stroke();
    });
    us5Outline(ctx, p, lw);
  },
  eng35(ctx, p, lw, d) {
    const N = US5_NOZ35;
    us5Body(ctx, p, lw, d);
    us5Local(ctx, p, () => { // the round nozzle, its trailing edge in teeth
      us5Poly(ctx, [[-N.r0, N.y0], [N.r0, N.y0], [N.r1, N.y1 + 0.12], [-N.r1, N.y1 + 0.12]]); ctx.fillStyle = bodyGrad(ctx, -N.r0, N.r0, () => (PartPaint.flat ? '#4a4f56' : tintGradient0(ctx, -N.r0, N.r0, '#4a4f56'))); ctx.fill();
      ctx.strokeStyle = US5_INK; ctx.lineWidth = lw; ctx.stroke();
      ctx.fillStyle = '#3d4248'; ctx.beginPath();
      const n = 7;
      ctx.moveTo(-N.r1, N.y1 + 0.12);
      for (let i = 0; i < n; i++) { const x = -N.r1 + (2 * N.r1 * i) / n; ctx.lineTo(x + N.r1 / n, N.y1); ctx.lineTo(x + (2 * N.r1) / n, N.y1 + 0.12); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = US5_LINE;
      for (const yy of [-0.3, -0.75]) { const k = (N.y0 - yy) / (N.y0 - N.y1), rr = N.r0 + (N.r1 - N.r0) * k; ctx.beginPath(); ctx.moveTo(-rr, yy); ctx.lineTo(rr, yy); ctx.stroke(); }
      if (p.firing > 0) { ctx.fillStyle = `rgba(255,150,80,${0.4 * p.firing})`; ctx.fillRect(-N.r1, N.y1, N.r1 * 2, 0.12); }
    });
    us5Outline(ctx, p, lw);
  },
  wing(ctx, p, lw, d) { // in its paint: a darker leading edge, and the flaperons (or the moving tail's hinge) as a seam
    const { x, y } = p, w = d.w, h = d.h, l = x - w / 2, r = x + w / 2, t = y + h / 2, b = y - h / 2;
    partPath(ctx, p); ctx.fillStyle = skinFill(ctx, l, r); ctx.fill();
    ctx.save(); partPath(ctx, p); ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(l - 1, t - h * 0.06, w + 2, h * 0.06);
    ctx.strokeStyle = US5_LINE; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(l - 1, b + h * (d.wing.control ? 0.5 : 0.2)); ctx.lineTo(r + 1, b + h * (d.wing.control ? 0.5 : 0.2)); ctx.stroke();
    ctx.restore();
    us5Outline(ctx, p, lw);
  },
  fin(ctx, p, lw, d) { // a canted fin from the side, with its rudder
    const P = us5FinPoly(d, p.flip);
    us5Local(ctx, p, () => {
      us5Poly(ctx, P); ctx.fillStyle = skinFill(ctx, -d.w / 2, d.w / 2); ctx.fill();
      if (!PartPaint.flat) { ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fill(); }
      const k = 0.3, a = [P[3][0] + (P[0][0] - P[3][0]) * 0.1, P[3][1] + d.h * k * 0.95], c = [P[2][0], P[2][1] + d.tipC * k];
      ctx.strokeStyle = US5_LINE; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0] - (c[0] - a[0]) * 0.06, c[1]); ctx.stroke();
      us5Poly(ctx, P); ctx.strokeStyle = US5_INK; ctx.stroke();
    });
  },
  gun(ctx, p, lw, d) { // a low fairing with the gun's port at the front; firing, the door on top lifts and the barrels show
    const P = us5GunPoly(d, p.flip), b = p.flip ? 1 : -1, k = clamp(p.deployed || 0, 0, 1), t = d.h / 2, base = b * d.w / 2, H = d.w * 0.55;
    us5Local(ctx, p, () => {
      us5Poly(ctx, P); ctx.fillStyle = skinFill(ctx, -d.w / 2, d.w / 2); ctx.fill(); ctx.strokeStyle = US5_INK; ctx.lineWidth = lw; ctx.stroke();
      const xa = base - b * H * 0.7, xb = base - b * H * 0.15;
      ctx.fillStyle = '#121519'; ctx.fillRect(Math.min(xa, xb), t - 0.28, Math.abs(xb - xa), 0.26); // the port
      if (k > 0) { ctx.fillStyle = '#4a5058'; ctx.fillRect(Math.min(xa, xb) + 0.02, t - 0.26, Math.abs(xb - xa) - 0.04, 0.05); }
      ctx.save(); ctx.translate(base - b * (H + 0.01), t - 0.42); ctx.rotate(b * k);
      ctx.strokeStyle = k > 0 ? US5_INK : US5_LINE; ctx.lineWidth = lw * (k > 0 ? 2 : 1); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 0.42); ctx.stroke();
      ctx.restore();
    });
  },
  gear(ctx, p, lw, d) { // a tall leg down to one wheel, a door beside it; folded away, nothing shows
    if (p.retracted) return;
    const g = wheelGeom(p), s = p.flip ? -1 : 1, i = p.x - s * d.w / 2;
    ctx.fillStyle = PAL.steelLight; ctx.fillRect(Math.min(i, g.x), g.y - 0.07, Math.abs(g.x - i), 0.14);
    ctx.fillStyle = PAL.steelDark; ctx.fillRect(Math.min(i, i + s * 0.35), g.y - 0.11, 0.35, 0.22);
    ctx.fillStyle = '#4f555c'; ctx.fillRect(Math.min(i, i + s * d.w * 0.6), g.y + 0.16, d.w * 0.6, 0.05); // the gear door, edge-on
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.fillStyle = '#20242a'; ctx.fill(); ctx.strokeStyle = US5_INK; ctx.lineWidth = lw; ctx.stroke();
    ctx.beginPath(); ctx.arc(g.x, g.y, g.r * 0.58, 0, TAU); ctx.fillStyle = PAL.steelLight; ctx.fill();
    ctx.strokeStyle = PAL.steelDark; ctx.lineWidth = g.r * 0.12; ctx.beginPath();
    for (let k = 0; k < 5; k++) { const a = (p.spin || 0) + (k * TAU) / 5; ctx.moveTo(g.x, g.y); ctx.lineTo(g.x + Math.cos(a) * g.r * 0.55, g.y + Math.sin(a) * g.r * 0.55); }
    ctx.stroke(); ctx.lineWidth = lw;
  },
};

// ===========================================================================
// Russian look-alike jets (the MyG and Sugoi parts): camouflage paint, lofted hulls and their 2D art.

// Camouflage (a skin with `camo`: { k: 'blotch' | 'splinter' | 'digital', c: [colours over the base], seed, n: patches of the
// first colour (two fewer of each next one), r: their size, px: a digital pattern's pixel in metres }): a
// seamless pattern in metres (16 m to a tile; 16 px to the metre on screen, 32 in 3D textures), the same on every part, so in the side view the
// patches run on across the joins. The 3D wings take the same canvas as a texture. Without a page (tests) it is the
// base colour.
const CAMO_M = 16, CAMO_PX = 16, CAMO = new Map(); // (the screen's resolution: a fine tile costs the 2D blueprint dear)
function camoCanvas(s, ppm = CAMO_PX) {
  if (!s || !s.camo || typeof document === 'undefined') return null;
  const key = s.name + '|' + ppm;
  let cv = CAMO.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = CAMO_M * ppm;
  const ctx = cv.getContext('2d'), C = s.camo, T = CAMO_M * ppm;
  let seed = (C.seed || 7) >>> 0;
  const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // pixel art: the digital pattern is drawn on a coarse grid (a quarter metre a pixel), then blown up unsmoothed
  const px = C.k === 'digital' ? Math.max(1, Math.round((C.px || 0.25) * ppm)) : 1, g = px > 1 ? document.createElement('canvas') : cv, c = px > 1 ? g.getContext('2d') : ctx, S = T / px;
  if (px > 1) g.width = g.height = S;
  c.fillStyle = s.base; c.fillRect(0, 0, S, S);
  const shape = (pts, smooth) => { // a closed patch, drawn nine times over so it wraps round the tile's edges
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      c.beginPath();
      if (smooth) {
        const n = pts.length, mx = (i) => (pts[i % n][0] + pts[(i + 1) % n][0]) / 2 + ox, my = (i) => (pts[i % n][1] + pts[(i + 1) % n][1]) / 2 + oy;
        c.moveTo(mx(0), my(0));
        for (let i = 1; i <= n; i++) c.quadraticCurveTo(pts[i % n][0] + ox, pts[i % n][1] + oy, mx(i), my(i));
      } else pts.forEach(([x, y], i) => (i ? c.lineTo(x + ox, y + oy) : c.moveTo(x + ox, y + oy)));
      c.closePath(); c.fill();
    }
  };
  C.c.forEach((col, k) => {
    c.fillStyle = col;
    const n = (C.n || (C.k === 'blotch' ? 9 : 12)) - k * (C.k === 'blotch' ? 2 : 3);
    for (let i = 0; i < n; i++) {
      const cx = rnd() * S, cy = rnd() * S, R = ((C.k === 'blotch' ? 1.4 + rnd() * 2.2 : 1.2 + rnd() * 2.4) * (C.r || 1) * ppm) / px, a0 = rnd() * TAU, stretch = 1.3 + rnd() * 1.4;
      const m = C.k === 'blotch' ? 8 : 4 + Math.floor(rnd() * 3), pts = [];
      for (let j = 0; j < m; j++) {
        const a = (j / m) * TAU + (rnd() - 0.5) * 0.6, rr = R * (0.55 + rnd() * 0.65);
        const u = Math.cos(a) * rr * stretch, v = Math.sin(a) * rr; // long patches, laid at a slant
        pts.push([cx + u * Math.cos(a0) - v * Math.sin(a0), cy + u * Math.sin(a0) + v * Math.cos(a0)]);
      }
      shape(pts, C.k === 'blotch');
    }
  });
  if (px > 1) { ctx.imageSmoothingEnabled = false; ctx.drawImage(g, 0, 0, T, T); }
  CAMO.set(key, cv);
  return cv;
}
function camoFill(ctx, s) {
  const ppm = PartPaint.flat ? 32 : CAMO_PX, cv = camoCanvas(s, ppm), pat = cv && ctx.createPattern ? ctx.createPattern(cv, 'repeat') : null;
  if (!pat) return s.base;
  const o = PartPaint.camoAt || [0, 0];
  if (pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix([1 / ppm, 0, 0, 1 / ppm, -o[0], -o[1]])); // pixels to metres, from the blueprint's origin
  return pat;
}

// A lofted hull: cross-sections along the part. def.loft (and def.glass, its canopies) are lists of
//   { s: [[y, top, bot, hw, mid, nt, nb], ...], n, nb, z, chine, mat }
// y: metres up the part from its tail end (0) to its nose (h); top, bot: the section's top and bottom (x, metres
// from the part's centre; -x is up on a plane); hw: its half-width across; mid: the height of its widest line
// (default halfway); nt, nb: how its upper and lower halves round off (superellipse exponents: 2 round, more is
// boxier, less comes to a ridge), default n and nb. Two rows at the same y make a step; between rows the values
// follow a smooth curve that never overshoots. z: the section's centre across; chine: a crease along the widest
// line; mat: its 3D material. A canopy shows above its widest line only. parts3d.js lofts the same sections.
function ruMono(xs, vs) {
  const n = xs.length;
  if (n < 2) return () => vs[0];
  const dl = [], m = [];
  for (let i = 0; i < n - 1; i++) dl.push((vs[i + 1] - vs[i]) / (xs[i + 1] - xs[i]));
  m[0] = dl[0]; m[n - 1] = dl[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = dl[i - 1] * dl[i] <= 0 ? 0 : (dl[i - 1] + dl[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (dl[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / dl[i], b = m[i + 1] / dl[i], q = a * a + b * b;
    if (q > 9) { const k = 3 / Math.sqrt(q); m[i] = k * a * dl[i]; m[i + 1] = k * b * dl[i]; }
  }
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = clamp((x - xs[i]) / h, 0, 1), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * vs[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * vs[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
// Loft rows written in the aircraft's own frame (y from its tail, x down from its datum), moved to the part's: x from
// the part's centre xc, y from its tail end y0.
function ruG(xc, y0, ...lofts) {
  return lofts.map((L) => Object.assign({}, L, { s: L.s.map((r) => r.map((v, i) => (v == null ? undefined : i === 0 ? +(v - y0).toFixed(4) : i <= 2 || i === 4 ? +(v - xc).toFixed(4) : v))) }));
}
// The sections, sampled densely along the part (y now from the part's centre); cached per part type.
const RU_SAMPLED = new WeakMap();
function ruSample(L, h) {
  const n0 = L.n || 2, nb0 = L.nb || n0, runs = [];
  let run = [];
  for (const r of L.s) { if (run.length && Math.abs(r[0] - run[run.length - 1][0]) < 1e-6) { runs.push(run); run = []; } run.push(r); }
  runs.push(run);
  const step = clamp(h / 40, 0.05, 0.3), st = [];
  runs.forEach((R, j) => {
    const ys = R.map((r) => r[0]), col = (i, f) => ruMono(ys, R.map((r) => (r[i] != null ? r[i] : f(r))));
    const top = col(1), bot = col(2), hw = col(3), mid = col(4, (r) => (r[1] + r[2]) / 2), nt = col(5, () => n0), nb = col(6, () => nb0), at = [];
    for (let i = 0; i < ys.length; i++) {
      at.push(ys[i]);
      if (i + 1 < ys.length) { const k = Math.ceil((ys[i + 1] - ys[i]) / step - 1e-9); for (let q = 1; q < k; q++) at.push(ys[i] + ((ys[i + 1] - ys[i]) * q) / k); }
    }
    at.forEach((y, i) => st.push({ y: y - h / 2, top: top(y), bot: bot(y), hw: Math.max(0, hw(y)), mid: mid(y), nt: Math.max(0.6, nt(y)), nb: Math.max(0.6, nb(y)), step: j > 0 && i === 0 }));
  });
  return Object.assign({}, L, { st });
}
function ruLofts(d) {
  let o = RU_SAMPLED.get(d);
  if (!o) RU_SAMPLED.set(d, (o = { hull: (d.loft || []).map((L) => ruSample(L, d.h)), glass: (d.glass || []).map((L) => ruSample(L, d.h)) }));
  return o;
}
// A section's outline at angle a (0: the +z side, π/2: its top, π: -z, 3π/2: its bottom), as [x, z].
function ruPt(s, a, zc) {
  const c = Math.cos(a), sn = Math.sin(a), up = sn >= 0, e = 2 / (up ? s.nt : s.nb);
  return [up ? s.mid - (s.mid - s.top) * Math.pow(Math.abs(sn), e) : s.mid + (s.bot - s.mid) * Math.pow(Math.abs(sn), e), (zc || 0) + s.hw * Math.sign(c) * Math.pow(Math.abs(c), e)];
}
// The section of hull loft k at y (from the part's tail end), interpolated.
function ruAt(d, y, k = 0) {
  const st = ruLofts(d).hull[k].st, yy = y - d.h / 2;
  if (yy <= st[0].y) return st[0];
  for (let i = 1; i < st.length; i++) if (st[i].y >= yy) {
    const a = st[i - 1], b = st[i], t = b.y > a.y ? (yy - a.y) / (b.y - a.y) : 1, L = (k2) => lerp(a[k2], b[k2], t);
    return { y: yy, top: L('top'), bot: L('bot'), hw: L('hw'), mid: L('mid'), nt: L('nt'), nb: L('nb') };
  }
  return st[st.length - 1];
}
// A fin's side view: root chord on the inner edge (from rte up to the top), tip chord on the outer (tte to tle).
function ruFinPath(ctx, p) {
  const d = p.def, F = d.ruFin, s = p.flip ? -1 : 1, b = p.y - d.h / 2, h = d.h, inn = p.x - (s * d.w) / 2, out = p.x + (s * d.w) / 2;
  ctx.moveTo(inn, b + h); ctx.lineTo(out, b + h * F.tle); ctx.lineTo(out, b + h * F.tte); ctx.lineTo(inn, b + h * F.rte); ctx.closePath();
}
// The side view of the hull (each loft's top edge from the tail to the nose and its bottom edge back), or the fin.
function ruPath(ctx, p) {
  const d = p.def;
  if (d.ruFin) { ruFinPath(ctx, p); return; }
  for (const L of ruLofts(d).hull) {
    const st = L.st;
    st.forEach((s, i) => (i ? ctx.lineTo(p.x + s.top, p.y + s.y) : ctx.moveTo(p.x + s.top, p.y + s.y)));
    for (let i = st.length - 1; i >= 0; i--) ctx.lineTo(p.x + st[i].bot, p.y + st[i].y);
    ctx.closePath();
  }
}
const RU_INK = 'rgba(8,11,16,0.9)', RU_PANEL = 'rgba(24,30,38,0.38)';
// The 2D art: the hull in its paint, a paler belly, then the part's own details (RU_ART) and its canopy.
function ruDraw(ctx, p, lw) {
  const d = p.def, A = RU_ART[d.ru] || {}, w = d.w, h = d.h, x = p.x, b = p.y - h / 2, l = x - w / 2, r = x + w / 2;
  const G = { p, d, x, b, l, r, w, h, lw, X: (v) => x + v, Y: (v) => b + v, at: (y, k) => ruAt(d, y, k), s: p.flip ? -1 : 1 };
  ctx.beginPath(); ruPath(ctx, p);
  ctx.fillStyle = A.fill ? A.fill(ctx, G) : hullGradient(ctx, l, r); ctx.fill();
  ctx.save(); ctx.clip();
  if (!d.ruFin && A.belly !== false) { // the underside a shade paler (on paint: of the paint; low-visibility paint stays even)
    const S = PartPaint.skin;
    ctx.fillStyle = S ? shade(S.base, S.camo ? 0.22 : S.accent === null ? 0.06 : 0.25) : '#ccd2d8';
    for (const L of ruLofts(d).hull) {
      ctx.beginPath();
      L.st.forEach((s, i) => { const yy = p.y + s.y, xx = x + s.bot - (s.bot - s.top) * 0.14; if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); });
      for (let i = L.st.length - 1; i >= 0; i--) ctx.lineTo(x + L.st[i].bot + 0.5, p.y + L.st[i].y);
      ctx.closePath(); ctx.fill();
    }
  }
  if (A.body) { ctx.lineWidth = lw; ctx.strokeStyle = RU_PANEL; A.body(ctx, G); }
  ctx.restore();
  ctx.strokeStyle = RU_INK; ctx.lineWidth = lw;
  ctx.beginPath(); ruPath(ctx, p); ctx.stroke();
  for (const L of ruLofts(d).glass) { // the canopy above its sill, with a glint and its frames
    const st = L.st;
    ctx.beginPath();
    st.forEach((s, i) => (i ? ctx.lineTo(x + s.top, p.y + s.y) : ctx.moveTo(x + s.top, p.y + s.y)));
    for (let i = st.length - 1; i >= 0; i--) ctx.lineTo(x + st[i].mid, p.y + st[i].y);
    ctx.closePath();
    ctx.fillStyle = L.gold ? '#c9a24a' : PAL.glass; ctx.fill(); ctx.stroke();
    const k = Math.floor(st.length * 0.62), s = st[k];
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(x + s.top + (s.mid - s.top) * 0.35, p.y + s.y, (s.mid - s.top) * 0.16, (st[st.length - 1].y - st[0].y) * 0.16, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(40,48,58,0.85)'; ctx.lineWidth = lw * 1.4;
    for (const f of L.frames || []) { const q = st[Math.round(f * (st.length - 1))]; ctx.beginPath(); ctx.moveTo(x + q.mid, p.y + q.y); ctx.lineTo(x + q.top, p.y + q.y); ctx.stroke(); }
    ctx.strokeStyle = RU_INK; ctx.lineWidth = lw;
  }
  if (A.over) A.over(ctx, G);
}
// Details: a panel line across the hull at y (from the tail end), part of the way from the top (k0) to the bottom (k1);
// a line along it, k of the way down from the top; a red star with a white rim.
function ruCross(ctx, G, y, k0 = 0, k1 = 1) {
  const s = G.at(y), t = s.top + (s.bot - s.top) * k0, u = s.top + (s.bot - s.top) * k1;
  ctx.beginPath(); ctx.moveTo(G.X(t), G.Y(y)); ctx.lineTo(G.X(u), G.Y(y)); ctx.stroke();
}
function ruAlong(ctx, G, y0, y1, k) {
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) { const y = lerp(y0, y1, i / 12), s = G.at(y), xx = G.X(s.top + (s.bot - s.top) * k); if (i) ctx.lineTo(xx, G.Y(y)); else ctx.moveTo(xx, G.Y(y)); }
  ctx.stroke();
}
function ruStar(ctx, cx, cy, R, lw) {
  if (PartPaint.skin && PartPaint.skin.accent === null && !PartPaint.skin.camo) return; // (low-visibility paint: no markings)
  const pts = (rr) => { ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? rr * 0.4 : rr; ctx.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); } ctx.closePath(); };
  pts(R * 1.3); ctx.fillStyle = '#f2f4f6'; ctx.fill();
  pts(R); ctx.fillStyle = '#c8322b'; ctx.fill();
  ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(90,20,18,0.8)'; ctx.stroke();
}
// A darker tone of the paint (radomes, antennas, dielectric panels).
const ruDark = (hex, k) => (PartPaint.skin ? shade(PartPaint.skin.base, k) : hex);

const RU_ART = {
  // a nose: the radome from ruRadome (metres up the part) to the tip, panel lines, the nose-gear doors and an
  // angle-of-attack vane
  nose: {
    body(ctx, G) {
      const R0 = G.d.ruRadome, chine = G.d.loft[0].chine;
      ctx.fillStyle = ruDark('#b3bcc5', -0.16); ctx.fillRect(G.l - 1, G.Y(R0), G.w + 2, G.h - R0 + 1);
      ctx.fillStyle = '#4b535c'; ctx.fillRect(G.l - 1, G.Y(G.h - 0.2), G.w + 2, 1); // the pitot tip
      ruCross(ctx, G, R0); ruCross(ctx, G, R0 - 2.2, 0, 0.45); ruCross(ctx, G, 0.6);
      ruAlong(ctx, G, 0.6, R0, chine ? 0.5 : 0.45);
      if (chine) { ctx.strokeStyle = 'rgba(24,30,38,0.55)'; ruMid(ctx, G, 0, G.h); } // the chine
      const g = G.at(1.4); ctx.strokeStyle = RU_PANEL; ctx.strokeRect(G.X(g.bot - 0.3), G.Y(0.9), 0.28, 1.3); // nose-gear doors
      ctx.fillStyle = '#3f474f'; ctx.fillRect(G.X(G.at(R0 - 1.2).mid - 0.05), G.Y(R0 - 1.3), 0.12, 0.22); // the angle-of-attack vane
    },
  },
  // the MyG-21's nose: the intake ring round the shock cone (a radome), the long pitot boom over it
  nose21: {
    body(ctx, G) {
      const C = G.d.ruCone;
      ctx.fillStyle = ruDark('#59626b', -0.38); ctx.fillRect(G.l - 1, G.Y(C), G.w + 2, G.h - C + 1); // the cone
      for (const y of [0.5, 2.6, C - 1.1]) ruCross(ctx, G, y);
      ruAlong(ctx, G, 0.3, C - 0.1, 0.45);
      ctx.fillStyle = ruDark('#9aa3ac', -0.22); ctx.fillRect(G.X(G.at(C - 1.6).top + 0.1), G.Y(C - 1.9), 0.18, 0.6); // a dielectric panel
    },
    over(ctx, G) {
      const lip = G.d.ruLip, s = G.at(lip - 0.02);
      ctx.fillStyle = '#15181c'; ctx.fillRect(G.X(s.top + 0.04), G.Y(lip - 0.05), s.bot - s.top - 0.08, 0.07); // the intake's mouth
      ctx.strokeStyle = '#3f474f'; ctx.lineWidth = Math.max(G.lw * 2, 0.05); // the pitot boom
      ctx.beginPath(); ctx.moveTo(G.X(s.top + 0.12), G.Y(lip - 0.3)); ctx.lineTo(G.X(s.top + 0.12), G.Y(G.h + 1.1)); ctx.stroke();
      ctx.lineWidth = G.lw; ctx.strokeStyle = RU_INK;
    },
  },
  // a centre fuselage: frames (ruLines, metres up the part), a seam along it, an airbrake on the spine (ruBrake)
  body: {
    body(ctx, G) {
      for (const y of G.d.ruLines || []) ruCross(ctx, G, y);
      ruAlong(ctx, G, 0.4, G.h - 0.3, G.d.loft[0].chine ? 0.55 : 0.3);
      if (G.d.loft[0].chine) { ctx.strokeStyle = 'rgba(24,30,38,0.55)'; ruMid(ctx, G, 0, G.h); }
      const B = G.d.ruBrake;
      if (B) { const s = G.at((B[0] + B[1]) / 2); ctx.strokeStyle = RU_PANEL; ctx.strokeRect(G.X(s.top + 0.02), G.Y(B[0]), 0.2, B[1] - B[0]); }
    },
  },
  // engine nacelles: frames, a seam, the intake's dark mouth on its raked face (ruIntake: from, to, and 'bot' when the
  // face is on the underside) and the ramp-bleed louvres behind it
  nacelle: {
    body(ctx, G) {
      const I = G.d.ruIntake;
      for (const k of [0.12, 0.36, 0.62, 0.84]) ruCross(ctx, G, I[0] * k);
      ruAlong(ctx, G, 0, I[0] - 0.2, 0.5);
      ctx.fillStyle = ruDark('#9aa3ac', -0.2);
      for (let i = 0; i < 4; i++) { const y = I[0] - 1.6 + i * 0.22, s = G.at(y); ctx.fillRect(G.X(I[2] === 'bot' ? s.bot - 0.42 : s.top + 0.12), G.Y(y), 0.3, 0.1); }
    },
    over(ctx, G) {
      const I = G.d.ruIntake, bot = I[2] === 'bot', a = G.at(I[0] + 0.02), c = G.at(I[1] - 0.04);
      ctx.strokeStyle = '#15181c'; ctx.lineWidth = Math.max(G.lw * 3, 0.07);
      ctx.beginPath(); ctx.moveTo(G.X(bot ? a.bot - 0.05 : a.top + 0.05), G.Y(I[0] + 0.02)); ctx.lineTo(G.X(bot ? c.bot - 0.02 : c.top + 0.02), G.Y(I[1] - 0.04)); ctx.stroke();
      ctx.lineWidth = G.lw; ctx.strokeStyle = RU_INK;
    },
  },
  // a tail stinger or boom: frames and a dark aerial at the tip
  tail: {
    body(ctx, G) {
      ruCross(ctx, G, G.h * 0.25); ruCross(ctx, G, G.h * 0.62);
      if (G.d.loft[0].chine) { ctx.strokeStyle = 'rgba(24,30,38,0.55)'; ruMid(ctx, G, 0, G.h); }
      ctx.fillStyle = '#4b535c'; ctx.fillRect(G.l - 1, G.Y(-1), G.w + 2, 1 + Math.min(0.3, G.h * 0.06));
    },
  },
  // an engine's aft casing (bare titanium, or painted like the fuselage: ruJet.paint) and its nozzle petals
  jet: {
    belly: false,
    fill: (ctx, G) => (G.d.ruJet.paint ? hullGradient(ctx, G.l, G.r) : bodyGrad(ctx, G.l, G.r, () => (PartPaint.flat ? '#8a8378' : tintGradient0(ctx, G.l, G.r, '#8a8378')))),
    body(ctx, G) {
      const y1 = G.d.ruJet.petal; // petals from the tail end up to y1
      ctx.fillStyle = PartPaint.flat ? '#3a3e44' : metalGradient(ctx, G.l, G.r); ctx.fillRect(G.l - 1, G.Y(-1), G.w + 2, y1 + 1);
      ctx.fillStyle = 'rgba(160,110,60,0.35)'; ctx.fillRect(G.l - 1, G.Y(y1), G.w + 2, Math.min(0.6, (G.h - y1) * 0.45)); // heat tint
      ctx.strokeStyle = 'rgba(12,14,18,0.6)';
      for (let i = 1; i < 7; i++) { const k = i / 7, s0 = G.at(0.02), s1 = G.at(y1 - 0.02); ctx.beginPath(); ctx.moveTo(G.X(lerp(s0.top, s0.bot, k)), G.Y(0)); ctx.lineTo(G.X(lerp(s1.top, s1.bot, k)), G.Y(y1)); ctx.stroke(); }
      ctx.strokeStyle = RU_PANEL; ruCross(ctx, G, y1); ruCross(ctx, G, (y1 + G.h) / 2);
      if (G.p.firing > 0) { ctx.fillStyle = `rgba(255,150,80,${0.45 * G.p.firing})`; ctx.fillRect(G.l - 1, G.Y(-1), G.w + 2, 1.12); }
    },
  },
  // a fin: the rudder's hinge (none on an all-moving fin), a red star and a dark tip
  fin: {
    body(ctx, G) {
      const F = G.d.ruFin, s = G.s, inn = G.x - (s * G.w) / 2, out = G.x + (s * G.w) / 2, b = G.b, h = G.h;
      if (!F.all) { ctx.beginPath(); ctx.moveTo(lerp(inn, out, 0.08), b + h * (F.rte + 0.1)); ctx.lineTo(lerp(inn, out, 0.92), b + h * (F.tte + 0.08)); ctx.stroke(); }
      ctx.fillStyle = '#3f474f'; ctx.fillRect(Math.min(out, out - s * 0.18), b, 0.18, h);
      if (F.star) ruStar(ctx, lerp(inn, out, 0.48), b + h * lerp((F.rte + F.tte) / 2, (1 + F.tle) / 2, 0.5), Math.min(G.w, h) * F.star, G.lw);
    },
  },
  // the sensor ball's fairing; the ball itself is drawn over it
  irst: {
    body(ctx, G) { ruCross(ctx, G, G.h * 0.3); },
    over(ctx, G) {
      const B = G.d.ruBall, cx = G.X(B[0]), cy = G.Y(B[1]);
      ctx.beginPath(); ctx.arc(cx, cy, B[2], 0, TAU); ctx.fillStyle = PartPaint.flat ? '#b48a3c' : '#c79a46'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - B[2] * 0.3, cy + B[2] * 0.25, B[2] * 0.3, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
    },
  },
  // the internal weapons bay: two doors along the belly, and the missiles still inside
  bay: {
    body(ctx, G) {
      ctx.strokeStyle = 'rgba(20,24,28,0.75)'; ctx.lineWidth = G.lw * 1.2;
      const a = G.at(G.h / 2);
      ctx.strokeRect(G.X(a.bot - 0.14), G.Y(0.7), 0.12, G.h - 1.4);
      ctx.beginPath(); ctx.moveTo(G.X(a.bot - 0.14), G.Y(G.h / 2)); ctx.lineTo(G.X(a.bot - 0.02), G.Y(G.h / 2)); ctx.stroke();
      ctx.fillStyle = '#d23a2f';
      for (let i = 0; i < (G.p.ammo == null ? G.d.weapon.ammo : G.p.ammo); i++) ctx.fillRect(G.X(a.top + 0.06), G.Y(1 + i * 0.5), 0.1, 0.32); // missiles left
    },
  },
};
// A line along the widest part of the hull (a chine), from y0 to y1.
function ruMid(ctx, G, y0, y1) {
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) { const y = lerp(y0, y1, i / 16), s = G.at(y); if (i) ctx.lineTo(G.X(s.mid), G.Y(y)); else ctx.moveTo(G.X(s.mid), G.Y(y)); }
  ctx.stroke();
}

// ===========================================================================
// US 3rd- and 4th-generation look-alikes (FS-4, FS-16, FS-15): lofted bodies (shape 'us4body') and camouflage.
//
// def.body describes the body in the part's own coordinates (about its centre; x is down, y towards the nose):
//   tubes: [{ st, z, kind, front, back, rake, hide }]: surfaces lofted through stations st = [[y, xt, xw, xb, hw, nt, nb], ...]
//     in rising y. xt: the top (negative is up), xb: the bottom, xw: the waist, where it is widest (hw either side); nt and
//     nb: how square the upper and lower halves are (2 round, 4 boxy; nb defaults to nt). Two stations at the same y make a
//     step. In between it is a smooth monotone curve, so a few stations draw a smooth body. z: copies across (default [0]);
//     kind: 'hull' (painted, default) or 'glass'; front/back: 'cap' (default), 'open' or 'intake' (a dark mouth); rake: how
//     far the lower lip of the front end sits behind the upper one (negative: ahead of it); hide: no outline in 2D.
//   noz: [{ x, y0, y1, r0, r1, z }]: nozzles from the base (y0, radius r0) to the exit (y1, r1); the first one is where
//     the flame comes out (nozzleOf), at each z. plates: [[x0, x1, y0, y1, z, t]] splitter plates; seats: [[x, y]] pilots;
//     frames: [y, ...] canopy bows; probe: [x, y0, y1, r] a pitot boom; colour: the unpainted body colour;
//     deco: ['line', x0, y0, x1, y1] panel lines, ['tone', y0, k or '#colour'] a radome from y0 forwards, ['port', x, y, w, h].
// The 2D art below and the 3D loft (parts3d.js) are both made from it, so the two views agree.

// Monotone cubic through (X, V), rising X: no overshoot, and a flat run stays flat.
function us4Pchip(X, V) {
  const n = X.length, d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((V[i + 1] - V[i]) / (X[i + 1] - X[i]));
  if (n === 2) m[0] = m[1] = d[0];
  else if (n > 2) {
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) continue;
      const h0 = X[i] - X[i - 1], h1 = X[i + 1] - X[i], w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
    const end = (h0, h1, d0, d1) => {
      let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(s) !== Math.sign(d0)) s = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) s = 3 * d0;
      return s;
    };
    m[0] = end(X[1] - X[0], X[2] - X[1], d[0], d[1]);
    m[n - 1] = end(X[n - 1] - X[n - 2], X[n - 2] - X[n - 3], d[n - 2], d[n - 3]);
  }
  return (x) => {
    if (n === 1) return V[0];
    let i = 0;
    while (i < n - 2 && x > X[i + 1]) i++;
    const h = X[i + 1] - X[i], t = (x - X[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * V[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * V[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
// A tube's sections, every 0.2 m or closer and at every station: { y, xt, xw, xb, hw, nt, nb, run } (run: which smooth
// stretch it belongs to; a step starts a new one). Worked out once per tube.
function us4Rows(T) {
  if (T._rows) return T._rows;
  const st = T.st, rows = [], runs = [[st[0]]];
  for (let i = 1; i < st.length; i++) { if (st[i][0] - st[i - 1][0] < 1e-6) runs.push([]); runs[runs.length - 1].push(st[i]); }
  runs.forEach((S, run) => {
    const Y = S.map((s) => s[0]), F = [1, 2, 3, 4, 5, 6].map((k) => us4Pchip(Y, S.map((s) => (s[k] != null ? s[k] : s[5]))));
    const at = (y) => { const v = F.map((f) => f(y)); return { y, xt: v[0], xw: v[1], xb: v[2], hw: Math.max(0, v[3]), nt: Math.max(1.2, v[4]), nb: Math.max(1.2, v[5]), run }; };
    for (let j = 0; j < S.length - 1; j++) {
      const ya = Y[j], yb = Y[j + 1], m = Math.max(1, Math.ceil((yb - ya) / 0.2 - 1e-9));
      for (let q = 0; q < m; q++) rows.push(at(ya + ((yb - ya) * q) / m));
    }
    rows.push(at(Y[Y.length - 1]));
  });
  T._rows = rows;
  return rows;
}
// A point round a section, at angle a (0: the right side, z+; pi/2: the top), relative to the tube's own centre line.
function us4Pt(r, a) {
  const c = Math.cos(a), s = Math.sin(a), up = s >= 0, e = 2 / (up ? r.nt : r.nb);
  const z = r.hw * Math.sign(c) * Math.pow(Math.abs(c), e), k = Math.pow(Math.abs(s), e);
  return { x: up ? r.xw - (r.xw - r.xt) * k : r.xw + (r.xb - r.xw) * k, z };
}
// Where the lip of a raked mouth cuts a point at fraction f down the front section (0 the top, 1 the bottom).
function us4Lip(T, yf, f) { const k = T.rake || 0; return yf - (k > 0 ? k * f : -k * (1 - f)); }
// The tube's outline seen from the side (+z), at the part's (x, y), kept within its box across (a tube may reach into
// the part it hangs on; only its own box shows). A raked front end is cut on the slant.
function us4Outline(ctx, T, x, y, w) {
  const R = us4Rows(T), yf = R[R.length - 1].y, c = (v) => x + Math.max(-w / 2, Math.min(w / 2, v));
  ctx.moveTo(c(R[0].xt), y + R[0].y);
  for (const q of R) ctx.lineTo(c(q.xt), y + Math.min(q.y, us4Lip(T, yf, 0)));
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(c(R[i].xb), y + Math.min(R[i].y, us4Lip(T, yf, 1)));
  ctx.closePath();
}
function us4Path(ctx, p) {
  for (const T of p.def.body.tubes) us4Outline(ctx, T, p.x, p.y, p.def.w);
}
// The body's own paint (or its skin): a light air-superiority grey with hull shading.
function us4Fill(ctx, p, l, r) { return tintGradient(ctx, l, r, p.def.body.colour || '#b9c1c9'); }
// One nozzle seen from the side: petals tapering to the exit, a dark rim, and a glow while it fires.
function us4Nozzle(ctx, p, N) {
  const x = p.x + (N.x || 0), y0 = p.y + N.y0, y1 = p.y + N.y1;
  ctx.beginPath(); ctx.moveTo(x - N.r0, y0); ctx.lineTo(x + N.r0, y0); ctx.lineTo(x + N.r1, y1); ctx.lineTo(x - N.r1, y1); ctx.closePath();
  ctx.fillStyle = metalGradient(ctx, x - N.r0, x + N.r0); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(20,24,30,0.55)';
  ctx.beginPath();
  for (let i = 1; i < 6; i++) { const k = i / 6 - 0.5; ctx.moveTo(x + 2 * k * N.r0, y0); ctx.lineTo(x + 2 * k * N.r1, y1); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(8,11,16,0.9)';
  ctx.fillStyle = '#15181c'; ctx.fillRect(x - N.r1, y1, 2 * N.r1, 0.07);
  if (p.firing > 0) { ctx.fillStyle = `rgba(255,150,80,${0.45 * p.firing})`; ctx.fillRect(x - N.r1, y1, 2 * N.r1, 0.12); }
}
// A radome or another patch of its own colour: a tone of the paint (k), or a colour of its own.
function us4Tone(B, k) { return typeof k === 'string' ? k : bodyTone(shade(B.colour || '#b9c1c9', k), k); }
function drawUS4(ctx, p, lw) {
  const d = p.def, B = d.body, x = p.x, y = p.y, w = d.w, h = d.h, l = x - w / 2, r = x + w / 2;
  const hulls = B.tubes.filter((T) => (T.kind || 'hull') === 'hull'), glass = B.tubes.filter((T) => T.kind === 'glass');
  ctx.save();
  for (const N of B.noz || []) us4Nozzle(ctx, p, N);
  for (const T of glass) { // the canopy (its lower half is hidden by the body): glass, a highlight, its bows and the pilots
    const R = us4Rows(T);
    let top = R[0];
    for (const q of R) if (q.xt < top.xt) top = q;
    ctx.beginPath(); us4Outline(ctx, T, x, y, w); ctx.fillStyle = PAL.glass; ctx.fill(); ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#3a4048';
    for (const [sx, sy] of B.seats || []) { ctx.beginPath(); ctx.arc(x + sx, y + sy, 0.13, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(x + top.xt * 0.55 + top.xw * 0.45, y + top.y + 0.2, 0.07, Math.min(0.9, (R[R.length - 1].y - R[0].y) * 0.22), 0, 0, TAU); ctx.fill();
    ctx.lineWidth = lw * 1.6;
    ctx.beginPath(); for (const fy of B.frames || []) { ctx.moveTo(x + top.xt - 1, y + fy); ctx.lineTo(x + top.xb + 1, y + fy); }
    ctx.stroke();
    ctx.lineWidth = lw;
    ctx.restore();
  }
  ctx.beginPath(); for (const T of hulls) us4Outline(ctx, T, x, y, w);
  ctx.fillStyle = us4Fill(ctx, p, l, r); ctx.fill();
  ctx.save(); ctx.clip();
  for (const D of B.deco || []) {
    if (D[0] === 'tone') { ctx.fillStyle = us4Tone(B, D[2]); ctx.fillRect(l, y + D[1], w, h); }
    else if (D[0] === 'port') { ctx.fillStyle = '#1b1f24'; ctx.fillRect(x + D[1] - D[3] / 2, y + D[2] - D[4] / 2, D[3], D[4]); }
  }
  ctx.strokeStyle = 'rgba(20,26,34,0.32)'; ctx.lineWidth = lw * 0.8;
  ctx.beginPath(); for (const D of B.deco || []) if (D[0] === 'line') { ctx.moveTo(x + D[1], y + D[2]); ctx.lineTo(x + D[3], y + D[4]); }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = 'rgba(8,11,16,0.9)'; ctx.lineWidth = lw;
  for (const T of hulls) if (!T.hide) { ctx.beginPath(); us4Outline(ctx, T, x, y, w); ctx.stroke(); }
  for (const T of hulls) if (T.front === 'intake') { // the mouth: a dark slot behind the lip
    const R = us4Rows(T), q = R[R.length - 1], yt = y + us4Lip(T, q.y, 0), yb = y + us4Lip(T, q.y, 1), k = 0.16;
    ctx.beginPath(); ctx.moveTo(x + q.xt, yt); ctx.lineTo(x + q.xb, yb); ctx.lineTo(x + q.xb - 0.06, yb - k); ctx.lineTo(x + q.xt + 0.06, yt - k); ctx.closePath();
    ctx.fillStyle = '#15181c'; ctx.fill();
  }
  for (const P of B.plates || []) { // splitter plates stand clear of the body, ahead of the mouth
    ctx.fillStyle = us4Tone(B, -0.08); ctx.fillRect(x + P[0], y + P[2], P[1] - P[0], P[3] - P[2]);
    ctx.strokeRect(x + P[0], y + P[2], P[1] - P[0], P[3] - P[2]);
  }
  if (B.probe) { const [px, y0, y1, pr] = B.probe; ctx.fillStyle = PAL.steelDark; ctx.fillRect(x + px - pr, y + y0, 2 * pr, y1 - y0); }
  ctx.restore();
}
// The body seen from above, for the right half of its 3D texture (x here runs across the part, along z): its paint.
// Like drawPart, the one other place that puts a skin on.
function drawPartTop(ctx, p) {
  const prev = PartPaint.skin;
  PartPaint.skin = p.skin && hasOwn(SKINS, p.skin) && skinnable(p.def) ? SKINS[p.skin] : null;
  try {
    const d = p.def, B = d.body, D = d.depth || d.w;
    ctx.fillStyle = us4Fill(ctx, p, -D / 2, D / 2); ctx.fillRect(-D / 2 - 0.1, -d.h / 2 - 0.1, D + 0.2, d.h + 0.2);
    for (const E of B.deco || []) if (E[0] === 'tone') { ctx.fillStyle = us4Tone(B, E[2]); ctx.fillRect(-D / 2 - 0.1, E[1], D + 0.2, d.h); }
  } finally { PartPaint.skin = prev; }
}
