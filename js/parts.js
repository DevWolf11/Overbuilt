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
  { id: 'air', name: 'Fuselage' },
  { id: 'wings', name: 'Wings' },
  { id: 'airEng', name: 'Aero engines' },
  { id: 'airGear', name: 'Gear' },
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
  cockpitS: { cat: 'air', name: 'Bush Cockpit', w: 1.5, h: 2, mass: 0.45, control: 3, torque: 1500, crew: 1, shape: 'cockpit', aero: true, breakSpeed: 11,
    tier: 0, cost: 2500, desc: 'Small cockpit for light planes and gliders.' },
  cockpit: { cat: 'air', name: 'Cockpit', w: 2, h: 2.5, mass: 0.9, control: 3, torque: 2500, crew: 1, shape: 'cockpit', aero: true, breakSpeed: 12,
    tier: 0, cost: 4500, desc: 'Streamlined plane nose with a bubble canopy on top.' },
  cockpitJet: { cat: 'air', name: 'Fighter Nose', w: 1.6, h: 4.2, mass: 0.8, control: 3, torque: 2500, crew: 1, shape: 'jetnose', aero: true, sharp: true,
    breakSpeed: 12, maxTemp: 2400, tier: 2, cost: 7000, desc: 'Long pointed nose with a bubble canopy. Slips through the sound barrier with less drag.' },
  cockpitAir: { cat: 'air', name: 'Airliner Nose', w: 3, h: 3.4, mass: 1.4, control: 3, torque: 4000, crew: 2, shape: 'airnose', aero: true, breakSpeed: 12,
    tier: 1, cost: 6500, desc: 'Flight deck for a wide fuselage.' },
  radome: { cat: 'air', name: 'Radome', w: 2, h: 2.2, mass: 0.1, shape: 'nose', aero: true, sharp: true, tier: 1, cost: 600,
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

  // wings and tails
  wingS: { cat: 'wings', name: 'Small Wing', w: 0.35, h: 1.75, mass: 0.15, shape: 'wing', wing: { area: 7, span: 5, flaps: true }, breakSpeed: 14, tier: 0, cost: 700,
    desc: 'Short wing with ailerons and flaps, for small planes or a canard.' },
  wing: { cat: 'wings', name: 'Wing', w: 0.5, h: 3, mass: 0.4, shape: 'wing', wing: { area: 30, span: 13, flaps: true }, breakSpeed: 14, tier: 0, cost: 1500,
    desc: 'Main wing with ailerons and flaps (one part is the whole span). Put it through the fuselage near the centre of mass, high, low or in the middle. It stalls if the nose is pulled too high.' },
  wingL: { cat: 'wings', name: 'Large Wing', w: 0.8, h: 5, mass: 1.6, fuel: 3, shape: 'wing', wing: { area: 75, span: 28, flaps: true, sweep: 0.42, taper: 0.62, mcrit: 0.82, load: 1.1 },
    breakSpeed: 14, tier: 1, cost: 4500, desc: 'Long, gently swept airliner wing with flaps and fuel tanks inside.' },
  wingSwept: { cat: 'wings', name: 'Swept Wing', w: 0.45, h: 4, mass: 0.6, shape: 'wing', wing: { area: 32, span: 11, sweep: 0.6, taper: 0.55, mcrit: 0.9, load: 1.4, flaps: true },
    breakSpeed: 14, tier: 2, cost: 3500, desc: 'Swept back for fast jets: less drag near Mach 1, but it needs more speed to lift.' },
  wingDelta: { cat: 'wings', name: 'Delta Wing', w: 0.5, h: 7, mass: 1.1, fuel: 1.5, shape: 'wing',
    wing: { area: 48, span: 9.5, sweep: 1, taper: 0.92, slope: 2.6, stall: 0.55, mcrit: 0.95, wave: 0.5, load: 1.8, dihedral: 0 },
    breakSpeed: 14, tier: 2, cost: 5000, desc: 'Big triangle for supersonic fighters. Hard to stall, little wave drag, but sluggish at low speed.' },
  wingGlider: { cat: 'wings', name: 'Glider Wing', w: 0.25, h: 1.4, mass: 0.25, shape: 'wing', wing: { area: 21, span: 19, taper: 0.5, load: 0.6, dihedral: 0.09 },
    breakSpeed: 12, tier: 0, cost: 1800, desc: 'Very long, thin wing: hardly any drag, so it glides for miles. Fragile at high speed.' },
  stabilizer: { cat: 'wings', name: 'Tailplane', w: 0.3, h: 1.8, mass: 0.12, shape: 'wing', wing: { area: 6, span: 6 }, breakSpeed: 14, tier: 0, cost: 500,
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
  ramjet: { cat: 'airEng', name: 'Ramjet', w: 1.3, h: 4.4, mass: 0.6, thrust: 180, ispSL: 3500, ispVac: 3500, gimbal: 0, air: { kind: 'ram', vmin: 260, vmax: 1100 },
    shape: 'jet', plume: 'jet', maxTemp: 2600, tier: 3, cost: 15000, desc: 'No moving parts and huge thrust, but only above about 950 km/h. Get there on another engine first.' },
  jato: { cat: 'airEng', name: 'JATO Booster', w: 0.6, h: 2, mass: 0.08, fuel: 0.22, thrust: 45, ispSL: 200, ispVac: 210, gimbal: 0, shape: 'srb', plume: 'solid', solid: true,
    tier: 0, cost: 900, maxTemp: 2000, desc: 'Strap-on rocket for a short take-off or a glider launch. Burns for about ten seconds.' },
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
  tailWheel: { cat: 'airGear', name: 'Tail Wheel', w: 0.6, h: 0.5, mass: 0.03, shape: 'gear', wheel: { r: 0.2, drive: false, track: 0, caster: true }, breakSpeed: 6, tier: 0, cost: 300,
    desc: 'Little swivelling wheel under the tail, for a taildragger.' },
  floats: { cat: 'airGear', name: 'Floats', w: 1, h: 5, mass: 0.3, shape: 'float', float: true, twinZ: 1.6, aero: true, breakSpeed: 10, tier: 1, cost: 1500,
    desc: 'A pair of pontoons: take off from and land on water. They skid on land.' },
  dropTanks: { cat: 'airGear', name: 'Drop Tanks', w: 0.7, h: 2.6, mass: 0.08, fuel: 1.2, shape: 'droptank', twinZ: 3, pod: true, aero: true, tier: 1, cost: 900,
    desc: 'Extra fuel in a pair of tanks under the wings. Drop them onto a wing.' },
  brakeChute: { cat: 'airGear', name: 'Brake Chute', w: 0.7, h: 0.5, mass: 0.05, chute: true, brakeChute: true, chuteArea: 0.35, shape: 'chute', tier: 1, cost: 600,
    desc: 'Drag chute for short landings: open it (STAGE or tap) after touchdown, below 400 km/h.' },

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

let _partSeq = 1;
function makePart(type, x, y, extra) {
  const def = PARTS[type];
  const p = { id: _partSeq++, type, def, x, y, flip: x < 0, fuel: partFuelKg(def), active: false, deployed: 0, temp: AMBIENT_T };
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
      const m0 = [...attached].reduce((s, i) => s + byId.get(i).def.mass * 1000 + byId.get(i).fuel, 0);
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
    const comp = componentOf(p.id, adj, (n) => !ids.has(n) || byId.get(n).def.separator || byId.get(n).def.solid);
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
function foilPath(ctx, p) {
  const d = p.def, x = p.x, h = d.h, t = p.y + h / 2, py = p.y + h / 4, a = p.deflect || 0;
  const c = Math.cos(a), s = Math.sin(a), N = 18, pts = [];
  for (let i = 0; i <= N; i++) { const f = Math.pow(i / N, 1.6); pts.push([foilHalf(f) * d.w / 2, t - f * h]); }
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
    case 'cockpit': case 'tailcone': case 'jet': case 'cab': case 'jetnose': case 'airnose': case 'float': case 'droptank':
      HULLS[d.shape](ctx, x, y, w, h, d);
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
    case 'jetnose': {
      partPath(ctx, p); ctx.fillStyle = hullGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = '#3a4048'; ctx.fillRect(l, t - h * 0.2, w, h * 0.2); // radome tip
      ctx.fillStyle = PAL.orange; ctx.fillRect(x + w * 0.05, b, w * 0.1, h * 0.6);
      ctx.restore();
      partPath(ctx, p); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x - w * 0.42, b + h * 0.3, w * 0.2, h * 0.2, 0, 0, TAU);
      ctx.fillStyle = PAL.glass; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x - w * 0.5, b + h * 0.36, w * 0.05, h * 0.07, 0, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
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
      const yb = b + h * 0.42, R = w / 2;
      ctx.fillStyle = metalGradient(ctx, x - 0.36, x + 0.36); ctx.fillRect(x - 0.36, b, 0.72, h * 0.3); ctx.strokeRect(x - 0.36, b, 0.72, h * 0.3);
      if (p.firing > 0.3) { // blur of the spinning disc, seen edge-on
        ctx.fillStyle = `rgba(150,160,175,${0.25 * p.firing})`;
        ctx.beginPath(); ctx.ellipse(x, yb, R, 0.08, 0, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#2b3036';
      const nb = d.blades || 3;
      for (let i = 0; i < nb; i++) {
        const k = Math.cos((p.spin || 0) + (i * TAU) / nb) * R;
        ctx.fillRect(Math.min(x, x + k), yb - 0.06, Math.abs(k), 0.12);
        ctx.fillStyle = PAL.hazard; ctx.fillRect(x + k - Math.sign(k) * 0.14 - 0.07, yb - 0.06, 0.14, 0.12); ctx.fillStyle = '#2b3036';
      }
      ctx.beginPath(); ctx.moveTo(x - 0.3, b + h * 0.3); ctx.quadraticCurveTo(x - 0.3, t, x, t); ctx.quadraticCurveTo(x + 0.3, t, x + 0.3, b + h * 0.3); ctx.closePath();
      ctx.fillStyle = hullGradient(ctx, x - 0.3, x + 0.3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = PAL.orange; ctx.beginPath(); ctx.arc(x, t - 0.1, 0.07, 0, TAU); ctx.fill();
      break;
    }
    case 'jet': {
      partPath(ctx, p); ctx.fillStyle = metalGradient(ctx, l, r); ctx.fill();
      ctx.save(); ctx.clip();
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
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.fillStyle = '#20242a'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r * 0.6, 0, TAU); ctx.fillStyle = PAL.steelLight; ctx.fill();
      ctx.strokeStyle = PAL.steelDark; ctx.lineWidth = g.r * 0.12;
      ctx.beginPath();
      for (let k = 0; k < 5; k++) { const a = (p.spin || 0) + (k * TAU) / 5; ctx.moveTo(g.x, g.y); ctx.lineTo(g.x + Math.cos(a) * g.r * 0.58, g.y + Math.sin(a) * g.r * 0.58); }
      ctx.stroke();
      ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(8,11,16,0.9)';
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r * 0.18, 0, TAU); ctx.fillStyle = PAL.orange; ctx.fill();
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
