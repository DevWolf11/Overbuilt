// The big update's drones (spec-drones §19.1): the catalogue (35 drone parts, 10 bay and counter-drone parts), the
// flight laws (Level, Acro, the winged law) on the stock drones flown from the helipad, the battery, a motor lost, the
// builder's numbers (stats, what fits a bay, the bay's chosen drone) and the zero-call contract for drones. The
// expected values are the spec's tables, worked out from the parts, never read back from the code; the margins sit on
// the spec's measurements (§6.6). (Links, warheads, bays, counter-drone and the AI come with their own packages.)
//   node test/drones.test.js
const G = require('./lib/game.js');
const ctx = G.load({ combat: true, ground: true, props: true });
const R = (c) => G.run(ctx, c);
const t = G.checks('drones: catalogue, laws, battery, builder maths, contract');
const D = 180 / Math.PI;
const { PARTS } = ctx;

// The stock drones (spec §18): the templates' own rows once the catalogue has them, else the spec's
const SPEC_ROWS = {
  bumble: [['drFrameS', 0, 0], ['drFC', 0, 0.0375, 0, { att: 0 }], ['drCam', 0.155, 0.0425, 0, { att: 0 }], ['drLink', -0.1, 0.0325, 0, { att: 0 }],
    ['drMotorS', 0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', 0.15, 0.0475, 0, { z: -0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: -0.15, att: 0 }],
    ['drBattS', -0.03, -0.0425, 0, { att: 0 }], ['drCharge', 0.06, -0.1125, 3, { att: 8 }]],
  bumbleF: [['drFrameS', 0, 0], ['drFC', 0, 0.0375, 0, { att: 0 }], ['drCam', 0.155, 0.0425, 0, { att: 0 }], ['drSpool', 0, 0.1275, 0, { att: 1 }],
    ['drMotorS', 0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', 0.15, 0.0475, 0, { z: -0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: -0.15, att: 0 }],
    ['drBattM', -0.03, -0.0475, 0, { att: 0 }], ['drCharge', 0.06, -0.1225, 3, { att: 8 }]],
  mavik: [['drFrameM', 0, 0], ['drFCgps', 0, 0.05, 0, { att: 0 }], ['drGimbal', 0.2, -0.075, 0, { att: 0 }], ['drLinkL', -0.12, 0.075, 0, { att: 0 }],
    ['drMotorM', 0.2, 0.06, 0, { z: 0.2, att: 0 }], ['drMotorM', 0.2, 0.06, 0, { z: -0.2, att: 0 }], ['drMotorM', -0.2, 0.06, 0, { z: 0.2, att: 0 }], ['drMotorM', -0.2, 0.06, 0, { z: -0.2, att: 0 }],
    ['drBattM', -0.04, -0.055, 0, { att: 0 }], ['drLegs', 0, -0.085, 0, { att: 0 }]],
  babaYara: [['drFrameH', 0, 0], ['drFCgps', 0, 0.065, 0, { att: 0 }], ['drCam', 0.3, 0.065, 0, { att: 0 }], ['drLink', -0.3, 0.055, 0, { att: 0 }],
    ['drMotorL', 0.6, 0.1, 0, { att: 0 }], ['drMotorL', 0.3, 0.1, 0, { z: 0.52, att: 0 }], ['drMotorL', 0.3, 0.1, 0, { z: -0.52, att: 0 }],
    ['drMotorL', -0.3, 0.1, 0, { z: 0.52, att: 0 }], ['drMotorL', -0.3, 0.1, 0, { z: -0.52, att: 0 }], ['drMotorL', -0.6, 0.1, 0, { att: 0 }],
    ['drBattL', 0, -0.1, 0, { z: 0.11, att: 0 }], ['drBattL', 0, -0.1, 0, { z: -0.11, att: 0 }], ['drBombs', 0, -0.26, 0, { att: 10 }], ['drLegsL', 0, -0.215, 0, { att: 0 }]],
  lancett: [['drBody', 0, 0, 3], ['drFC', 0.1, 0, 0, { att: 0 }], ['drBattM', -0.12, 0, 0, { att: 0 }], ['drChargeT', 0.75, 0, 3, { att: 0 }], ['drCam', 0.4, 0.105, 0, { att: 0 }],
    ['drLinkL', -0.25, 0.13, 0, { att: 0 }], ['drWing', 0.3, 0.095, 3, { att: 0 }], ['drTail', -0.48, 0.09, 3, { att: 0 }], ['drFin', -0.48, 0.17, 3, { att: 0 }], ['drPusher', -0.6, 0, 3, { att: 0 }]],
};
const STOCK = Object.keys(SPEC_ROWS);
const rowsOf = (k) => (ctx.TEMPLATES[k] && ctx.TEMPLATES[k].kind === 'drone' ? ctx.TEMPLATES[k].parts : SPEC_ROWS[k]);
ctx.__ROWS = Object.fromEntries(STOCK.map((k) => [k, rowsOf(k)]));
R(`var rowsOf = (k) => __ROWS[k].map((r) => ({ type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: r[1] < 0, ...(r[4] || {}) }));`);

// A drone off the helipad, its motors on, flying Level (as Flight.start sets one up), and the stand-in for Flight
const drone = (k, at = 'site') => { const v = G.craft(ctx, rowsOf(k), 'drone', at); R(''); ctx.__d = v; R(`for (const p of __d.parts) if (p.def.thrust) p.active = true; __d.stageIdx = __d.stages.length; __d.sas = 'hold'; __d.throttle = 0;`); return v; };
R(`var fly = (v, s, secs, c, each) => { const n = Math.round(secs * 120); for (let i = 0; i < n; i++) { if (c) { v.ctl.v = c.v || 0; v.ctl.h = c.h || 0; v.ctl.r = c.r || 0; v.ctl.z = c.z || 0; } if (each && each(i) === false) return i; v.physicsStep(1 / 120, s); s.time = (s.time || 0) + 1 / 120; } return n; };
var pos = (v) => [v.x, v.y, v.z], dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
var agl = (v) => v.altitude() - Terrain.surfaceAt(v.body, v.surfaceSpot().a, v.surfaceSpot().z);
var path = (v) => v.heading(); // (the flight path's heading at speed)
var wrapD = (a) => ((a * 180 / Math.PI + 540) % 360) - 180;`);
const sim = () => { const s = G.sim(); ctx.__s = s; return s; };

// ================================================================ 1. the catalogue
const REAL_DRONE = /\b(dji|mavic|phantom|switchblade|lancet|shahed|geran|bayraktar|orlan|zala|baba yaga|vampire|wasp|raven|scaneagle|reaper|predator|skyranger|skynex|dronebuster|coyote|midge|lancer|black hornet)\b/i;
const TABS = ['drFrame', 'drPower', 'drLink', 'drPay'];
const DR = Object.keys(PARTS).filter((k) => TABS.includes(PARTS[k].cat));
const KIT = ['dockRack', 'dockHangar', 'dockTubes', 'cdJam', 'cdJamL', 'cdDetect', 'cdRadar', 'cdGun', 'cdLaser', 'cdCage'];
const bad = (list, f) => list.filter((k) => !f(k));
t('35 drone parts in the four tabs (13 frames, 9 motors and power, 7 links and sensors, 6 payloads)', DR.length === 35 && TABS.map((c) => DR.filter((k) => PARTS[k].cat === c).length).join() === '13,9,7,6',
  TABS.map((c) => DR.filter((k) => PARTS[k].cat === c).length).join());
t('the Drone kind: the helipad, rot 0, its four tabs in order, and its categories after Kit and before Radar', R(`(() => { const K = VEHICLE_KINDS.drone, ids = PART_CATEGORIES.map((c) => c.id);
  return K.name === 'Drone' && K.site === 'helipad' && K.launchRot === 0 && K.cats.join() === 'drFrame,drPower,drLink,drPay' && ids.slice(21, 25).join() === K.cats.join() && ids[25] === 'radar'
    && PART_CATEGORIES.slice(21, 25).map((c) => c.name).join('|') === 'Frames|Motors & power|Links & sensors|Payloads'; })()`));
t('each has a mass, a price, a tier 1-4, a size, a drag area (wings excepted), hit points, maxTemp 1500 and a description', !bad(DR, (k) => { const d = PARTS[k];
  return d.mass > 0 && d.cost > 0 && Number.isInteger(d.tier) && d.tier >= 1 && d.tier <= 4 && d.w > 0 && d.h > 0 && R(`partDepth({ def: PARTS.${k} })`) > 0 && (d.wing ? true : d.cda > 0)
    && d.drone && d.drone.hp > 0 && d.maxTemp === 1500 && typeof d.desc === 'string' && d.desc.length > 20 && typeof d.tray === 'string'; }).length, bad(DR, (k) => PARTS[k].mass > 0 && PARTS[k].drone && PARTS[k].drone.hp > 0).join());
t('no drone part carries a field the ground update\'s code reads (gv, family, place, outline, armour, mods, module, hp, aim, track, awheel, engine, ring, seat, rack, inner)',
  !bad(DR, (k) => !['gv', 'family', 'place', 'outline', 'armour', 'mods', 'module', 'hp', 'aim', 'track', 'awheel', 'engine', 'ring', 'seat', 'rack', 'inner'].some((f) => f in PARTS[k])).length);
t('a part\'s hit points are its own (Combat.maxHp): a racing motor 15, a hex frame 60; old parts as before', R(`Combat.maxHp(PARTS.drMotorS) === 15 && Combat.maxHp(PARTS.drFrameH) === 60 && Combat.maxHp(PARTS.cockpit) === Math.round((60 + 220 * Math.sqrt(PARTS.cockpit.mass + (PARTS.cockpit.fuel || 0) * 0.25)) * 1.4)`));
// the spec's numbers (§4.2): [kg, $, tier, hp, kgf of thrust, g/W, Wh]
const SPEC = {
  drFC: [0.03, 200, 1, 20], drFCgps: [0.05, 600, 1, 20], drFrameS: [0.14, 120, 1, 25], drFrameM: [0.18, 200, 1, 30], drFrameH: [2.2, 900, 2, 60], drFrameO: [4.2, 1600, 3, 90],
  drLegs: [0.03, 40, 1, 15], drLegsL: [1.2, 150, 2, 40], drGuard: [0.025, 30, 1, 10], drBody: [1.2, 600, 2, 40], drWing: [0.6, 200, 2, 25], drTail: [0.15, 120, 2, 15], drFin: [0.05, 60, 2, 10],
  drMotorS: [0.06, 150, 1, 15, 1.6, 4.2], drMotorM: [0.05, 200, 1, 15, 0.8, 6], drMotorL: [0.3, 600, 2, 30, 6.1, 7], drFan: [0.15, 350, 2, 25, 2.0, 3], drPusher: [0.3, 300, 2, 20, 3.1, 8],
  drBattS: [0.28, 120, 1, 15, 0, 0, 50], drBattM: [0.45, 250, 1, 15, 0, 0, 100], drBattL: [4.0, 900, 2, 40, 0, 0, 700], drGen: [4.5, 2500, 3, 60, 0, 0, 2000],
  drLink: [0.02, 80, 1, 10], drLinkL: [0.06, 400, 1, 10], drSpool: [1.2, 900, 2, 20], drSpoolL: [2.8, 1600, 3, 25], drSat: [1.2, 2500, 3, 25], drCam: [0.02, 100, 1, 8], drGimbal: [0.08, 900, 2, 12],
  drCharge: [0.9, 700, 1, 20], drChargeT: [1.6, 1400, 2, 25], drChargeHE: [1.2, 600, 1, 20], drGrenade: [0.2, 300, 1, 15], drBombs: [0.8, 600, 2, 30], drMissile: [0.6, 1800, 3, 30],
};
const off = Object.keys(SPEC).filter((k) => { const d = PARTS[k], [kg, $, tier, hp, kgf, gw, wh] = SPEC[k];
  return !d || Math.abs(d.mass * 1000 - kg) > 1e-9 || d.cost !== $ || d.tier !== tier || d.drone.hp !== hp
    || (kgf && (Math.abs((d.thrust * 1000) / 9.80665 - kgf) > 0.06 || Math.abs(d.ispSL / 3600 - gw) > 1e-9 || d.ispVac !== d.ispSL || d.gimbal !== 0 || d.drone.motor !== 1))
    || (wh && (Math.abs(d.fuel * 1e6 - wh) > 1e-6 || d.drone.cell !== 1 || d.battery)); });
t('masses, prices, tiers and hit points as §4.2 has them; motors\' lift (kgf) and grams per watt (isp = 3600 × g/W); batteries\' Wh (fuel t = Wh × 1e-6)', !off.length && Object.keys(SPEC).length === 35, off.join());
t('roles: two controllers (FPV drops, GPS homes), frames with their motor stations, every motor a rotor or a prop, links, cameras, three warheads, droppers and the missile',
  PARTS.drFC.drone.fc.fs === 'drop' && PARTS.drFCgps.drone.fc.fs === 'home' && PARTS.drFC.control === 1 && PARTS.drFCgps.control === 1
  && PARTS.drFrameS.drone.frame.tips.length === 4 && PARTS.drFrameH.drone.frame.tips.length === 6 && PARTS.drFrameO.drone.frame.tips.length === 8
  && PARTS.drFrameO.drone.frame.tips.every(([x, z]) => Math.abs(Math.hypot(x, z) - 0.95) < 0.002)
  && ['drMotorS', 'drMotorM', 'drMotorL', 'drFan'].every((k) => PARTS[k].air.kind === 'rotor') && PARTS.drPusher.air.kind === 'prop' && PARTS.drFan.drone.guard === 1
  && DR.filter((k) => PARTS[k].drone.link).map((k) => PARTS[k].drone.link.kind).join() === 'radio,long,fibre,fibre,sat'
  && PARTS.drCam.drone.cam.fov === 100 && PARTS.drGimbal.drone.cam.zoom.join() === '1,4,12' && PARTS.drGen.drone.loud === 1
  && DR.filter((k) => PARTS[k].drone.warhead).length === 3 && PARTS.drChargeT.drone.warhead.tandem === true && PARTS.drChargeHE.drone.warhead.pen === 0
  && PARTS.drCharge.weapon.kind === 'warhead' && PARTS.drGrenade.weapon.he === 22 && PARTS.drBombs.weapon.he === 45 && PARTS.drMissile.weapon.seek === 'ground' && PARTS.drMissile.weapon.heat === 450);
t('axial parts go on at rot 3 (warheads, the missile rail, the body, the pusher, the wing, the tail, the fin)', ['drCharge', 'drChargeT', 'drChargeHE', 'drMissile', 'drBody', 'drPusher', 'drWing', 'drTail', 'drFin'].every((k) => PARTS[k].drone.rot === 3)
  && DR.filter((k) => PARTS[k].drone.rot != null).length === 9);
t('the drone wing\'s limit: 80 m/s (288 km/h); the tail a control surface', PARTS.drWing.wing.vne === 80 && PARTS.drTail.wing.control === 0.35);
t('10 bay and counter-drone parts: armour kit (gv, the Drones family, on top, tkit or tradar, a known module or none, no control, not inner, hit points, a depth)', KIT.every((k) => { const d = PARTS[k];
  return d && d.gv && d.family === 'Drones' && d.place === 'top' && ['tkit', 'tradar'].includes(d.shape) && (d.module == null || ['radar', 'sight', 'breech', 'launcher'].includes(d.module))
    && !d.control && !d.inner && d.hp > 0 && d.depth > 0 && d.desc.length > 20 && !d.weapon; }) && KIT.filter((k) => PARTS[k].cat === 'launchers').length === 3 && KIT.filter((k) => PARTS[k].cat === 'kit').length === 7);
t('the bays: Rack 3 × ($3,000, 3.5 kg, 0.8 m), Hangar 1 × ($9,000, 25 kg), Tubes 2 × ($4,500, 8 kg, winged, out of a tube at 28 m/s, 20°)',
  JSON.stringify(['dockRack', 'dockHangar', 'dockTubes'].map((k) => { const q = PARTS[k].dock; return [q.n, q.budget, q.kg, q.span, !!q.wing, q.stock, q.launch]; }))
  === JSON.stringify([[3, 3000, 3.5, 0.8, false, 'bumble', 'hop'], [1, 9000, 25, 1.8, false, 'mavik', 'hop'], [2, 4500, 8, 1.8, true, 'lancett', 'tube']]) && PARTS.dockTubes.dock.v0 === 28 && PARTS.dockTubes.dock.el === 20);
t('the kit: jammers 500 and 1,000 m, a detector 2 km, a low-looking search radar 4 km, the gun (600 m, 1.1 km cued, 200 rounds), the laser (1 km, 1.5 km cued), the cage (slats 0.5, flush)',
  PARTS.cdJam.cuas.jam === 500 && PARTS.cdJamL.cuas.jam === 1000 && PARTS.cdDetect.cuas.detect === 2000 && PARTS.cdRadar.searchRadar.low === true && PARTS.cdRadar.searchRadar.range === 4000
  && PARTS.cdGun.cuas.gun.range === 600 && PARTS.cdGun.cuas.gun.cued === 1100 && PARTS.cdGun.cuas.gun.ammo === 200 && PARTS.cdLaser.cuas.laser.range === 1000 && PARTS.cdLaser.cuas.laser.cued === 1500
  && PARTS.cdCage.slat === 0.5 && PARTS.cdCage.cage === true && PARTS.cdCage.flush === true && PARTS.cdCage.armour.mm === 2);
t('names and descriptions use no real product or system name', !bad([...DR, ...KIT], (k) => !REAL_DRONE.test(PARTS[k].name) && !REAL_DRONE.test(PARTS[k].desc)).length,
  bad([...DR, ...KIT], (k) => !REAL_DRONE.test(PARTS[k].name) && !REAL_DRONE.test(PARTS[k].desc)).join());
{
  const tk = Object.keys(ctx.TEMPLATES).filter((k) => ctx.TEMPLATES[k].kind === 'drone' || ['bmk2d', 'ma1c'].includes(k));
  t(`...nor do the drone templates' names and blurbs (${tk.length} so far)`, tk.every((k) => !REAL_DRONE.test(ctx.TEMPLATES[k].name) && !REAL_DRONE.test(ctx.TEMPLATES[k].desc || '')));
}

// ================================================================ 2. the laws (each stock multicopter from the helipad)
function law(k) {
  const s = sim(), v = drone(k); ctx.__v = v;
  return JSON.parse(R(`(() => {
    const v = __v, s = __s, F = v.dr.fc, o = {};
    fly(v, s, 0.5, {});
    fly(v, s, 4, { z: 1 }); o.climb = v.vSpeed();
    fly(v, s, 3, {}); // (settles on its new height)
    const h0 = agl(v), p0 = pos(v); fly(v, s, 10, {}); o.hold = agl(v) - h0; o.drift = dist(pos(v), p0);
    let t90 = null, t80 = null, n = 0; const S = {};
    fly(v, s, 12, { v: 1 }, (i) => { Drone.hframe(v, S); const a = v.attitude(); if (t90 == null && -a.pitch > 0.9 * F.lean) t90 = (i + 1) / 120; if (t80 == null && S.vf > 0.8 * F.vmax) t80 = (i + 1) / 120; });
    o.t90 = t90; o.t80 = t80; Drone.hframe(v, S); o.top = S.vf; o.vTop = Drone.stats(v.parts).vTop;
    const hd = path(v), sp0 = v.speed(); fly(v, s, 2, { v: 1, h: 1 }); o.turn = Math.abs(wrapD(path(v) - hd)); o.turnK = v.speed() / sp0;
    fly(v, s, 3, { v: 1 });
    const d0 = pos(v); let stop = null; fly(v, s, 12, {}, (i) => { if (v.speed() < 0.5) { stop = i / 120; return false; } }); o.stop = stop; o.stopD = dist(pos(v), d0);
    fly(v, s, 2, {}); const y0 = Drone.hframe(v).head; fly(v, s, 0.5, { h: 1 }); o.yaw = Math.abs(wrapD(Drone.hframe(v).head - y0));
    fly(v, s, 3, {}); fly(v, s, 8, { z: 1 }); o.from = agl(v); // (up to 70 m and more)
    fly(v, s, 4, { v: 1 }); fly(v, s, 2, { v: 1, z: -1 }); o.dive = Math.atan2(-v.vSpeed(), Drone.hframe(v).vf) * 180 / Math.PI;
    fly(v, s, 4, {}); v.sas = 'acro'; v.throttle = 0.6; fly(v, s, 0.25, { h: 1 }); o.flick = v.attitude().bank * 180 / Math.PI; fly(v, s, 2, {}); o.acro = v.attitude().bank * 180 / Math.PI;
    o.broken = s.broken.length; o.toasts = s.toasts;
    return JSON.stringify(o);
  })()`));
}
const B = law('bumble'), M = law('mavik'), FPV = PARTS.drFC.drone.fc, GPS = PARTS.drFCgps.drone.fc;
const fx = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, typeof x === 'number' ? +x.toFixed(2) : x]));
t('lever full 4 s: climbs at 90 % of the controller\'s rate or better (Bumble 8 m/s, Mavik 5)', B.climb >= 0.9 * FPV.vz && M.climb >= 0.9 * GPS.vz, [B.climb, M.climb]);
t('let go: the height over the ground held within 0.5 m for 10 s, drifting under 0.5 m', Math.abs(B.hold) <= 0.5 && Math.abs(M.hold) <= 0.5 && B.drift < 0.5 && M.drift < 0.5, fx({ b: B.hold, bd: B.drift, m: M.hold, md: M.drift }));
t('full stick ahead: 90 % of the lean within 0.5 s; the Bumble at 80 % of its top speed within 4.5 s', B.t90 != null && B.t90 <= 0.5 && M.t90 != null && M.t90 <= 0.5 && B.t80 != null && B.t80 <= 4.5, [B.t90, M.t90, B.t80]);
t('top speed no more than the controller\'s (+0.5 m/s), and within 10 % of what the builder says (stats.vTop)', B.top <= FPV.vmax + 0.5 && M.top <= GPS.vmax + 0.5 && Math.abs(B.top / B.vTop - 1) <= 0.1 && Math.abs(M.top / M.vTop - 1) <= 0.1,
  fx({ b: B.top, bs: B.vTop, m: M.top, ms: M.vTop }));
t('the Bumble turns 35° or more of its path in 2 s at full speed, keeping 85 % of its speed', B.turn >= 35 && B.turnK >= 0.85, fx({ turn: B.turn, k: B.turnK }));
t('let go at top speed: under 0.5 m/s within 5 s and 55 m (Bumble), 4.5 s and 35 m (Mavik)', B.stop != null && B.stop <= 5 && B.stopD <= 55 && M.stop != null && M.stop <= 4.5 && M.stopD <= 35, fx({ b: B.stop, bd: B.stopD, m: M.stop, md: M.stopD }));
t('yaw at a hover: 45-65° in 0.5 s', B.yaw >= 45 && B.yaw <= 65 && M.yaw >= 45 && M.yaw <= 65, fx({ b: B.yaw, m: M.yaw }));
t('the dive (full stick and lever down 2 s from 70 m up): an FPV controller 30° or steeper, a GPS one 20° or less', B.from >= 70 && M.from >= 40 && B.dive >= 30 && M.dive <= 20, fx({ b: B.dive, m: M.dive, from: B.from }));
t('Acro: a flick to 60° of bank, let go 2 s: nothing levels it (52° or more)', Math.abs(B.flick) >= 50 && Math.abs(B.acro) >= 52 && Math.abs(M.acro) >= 52, fx({ b: B.acro, flick: B.flick, m: M.acro }));
t('nothing broke and nothing was said (the battery far from 25 %)', B.broken === 0 && M.broken === 0 && !B.toasts.length && !M.toasts.length, [B.toasts, M.toasts]);
{ // the Tilt layout (Settings → Drone stick): sideways slides, Q/E turns
  const s = sim(), v = drone('bumble'); ctx.__v = v;
  const o = JSON.parse(R(`(() => { const g = Settings.get; Settings.get = (k) => (k === 'droneStick' ? 'tilt' : g(k));
    try { const v = __v, s = __s, o = {}; fly(v, s, 0.5, {}); fly(v, s, 3, { z: 1 }); fly(v, s, 2, {});
      const h0 = Drone.hframe(v).head; fly(v, s, 3, { h: 1 }); o.vr = Drone.hframe(v).vr; o.yawH = Math.abs(wrapD(Drone.hframe(v).head - h0));
      fly(v, s, 3, {}); const h1 = Drone.hframe(v).head; fly(v, s, 0.5, { r: 1 }); o.yawR = Math.abs(wrapD(Drone.hframe(v).head - h1));
      return JSON.stringify(o); } finally { Settings.get = g; } })()`));
  t('the Tilt layout: the stick sideways slides (30 % of its slide speed or more after 3 s, no turn) and Q/E turns', o.vr >= 0.3 * FPV.vmax * R('DRONE.SLIDE') && o.yawH < 5 && o.yawR >= 45, fx(o));
}
{ // following the ground: from about 20 m up, 60 s of full stick in four headings off the helipad (east, south, west, north:
  // the engineer's route), the northern one over a hill 23 m above the pad
  const out = [];
  for (const turnS of [0, 0.785, 1.571, 2.356]) { // (at 2 rad/s: east, then south, west and north)
    const s = sim(), v = drone('bumble'); ctx.__v = v;
    out.push(JSON.parse(R(`(() => { const v = __v, s = __s; fly(v, s, 0.5, {}); fly(v, s, 2.5, { z: 1 }); fly(v, s, 2, {}); fly(v, s, ${turnS}, { h: 1 }); fly(v, s, 1, {});
      let low = 1e9, rise = -1e9; const g0 = Terrain.surfaceAt(v.body, v.surfaceSpot().a, v.surfaceSpot().z);
      fly(v, s, 60, { v: 1 }, (i) => { if (i % 12 === 0) { low = Math.min(low, v.groundAltitude()); rise = Math.max(rise, Terrain.surfaceAt(v.body, v.surfaceSpot().a, v.surfaceSpot().z) - g0); } });
      return JSON.stringify({ low, rise, broken: s.broken.length }); })()`)));
  }
  t('following the ground: 60 s of full stick at about 20 m in four headings off the helipad never comes under 10 m', out.every((o) => o.low >= 10 && !o.broken) && out.some((o) => o.rise > 15),
    out.map((o) => `${o.low.toFixed(1)} m (ground +${o.rise.toFixed(0)} m)`).join(', '));
}

// ================================================================ 3. the battery
{
  const E = {};
  for (const [k, want] of [['bumble', 7.5], ['bumbleF', 8.2], ['mavik', 31.3], ['babaYara', 27.4]]) {
    const s = sim(), v = drone(k); ctx.__v = v;
    E[k] = JSON.parse(R(`(() => { const v = __v, s = __s; fly(v, s, 0.5, {}); fly(v, s, 3, { z: 1 }); fly(v, s, 3, {});
      const w0 = Drone.charge(v); fly(v, s, 30, {}); const w1 = Drone.charge(v); return JSON.stringify({ min: 30 / (w0 - w1) / 60, stat: Drone.stats(v.parts).hoverMin }); })()`));
    E[k].want = want;
  }
  t('hover endurance within 10 % of the builder\'s (stats.hoverMin), which is the spec\'s (Bumble 7.5, Bumble Fibre 8.2, Mavik 31.3, Baba Yara 27.4 min)',
    Object.values(E).every((o) => Math.abs(o.min / o.stat - 1) <= 0.1 && Math.abs(o.stat / o.want - 1) <= 0.03), Object.entries(E).map(([k, o]) => `${k} ${o.min.toFixed(1)}/${o.stat.toFixed(1)}`).join(', '));
}
{ // the warnings and the end: a Bumble hovering from 26 % (the lever nudged now and then, so the 5 % auto-land doesn't take it down)
  const s = sim(), v = drone('bumble'); ctx.__v = v;
  const o = JSON.parse(R(`(() => { const v = __v, s = __s; fly(v, s, 0.5, {}); fly(v, s, 4, { z: 1 }); fly(v, s, 2, {});
    for (const p of v.dr.cells) p.fuel = p.def.fuel * 1000 * 0.26;
    let out = null, at = null, fell = null;
    fly(v, s, 200, {}, (i) => {
      v.ctl.z = i % 240 < 6 ? 0.05 : 0;
      if (at == null && v.parts.some((p) => p.flameout)) { at = Drone.charge(v); out = s.time; }
      if (at != null && fell == null && s.time - out > 2) fell = v.vSpeed();
      if (fell != null) return false;
    });
    return JSON.stringify({ at, fell, toasts: s.toasts, flat: v.dl.flat }); })()`));
  const n = (x) => o.toasts.filter((q) => q === x).length;
  t('the 25 % and 10 % toasts come once each, then "Battery flat"', n('Battery 25%: head back') === 1 && n('Battery 10%: land or bring it home') === 1 && n('Battery flat') === 1 && o.flat, o.toasts);
  t('the motors flame out under 1 % charge (not at 20 %: the gated threshold), and it falls', o.at != null && o.at < 0.01 && o.fell != null && o.fell < -2, { at: o.at, fell: o.fell });
}
{ // the auto-land at 5 %: 2 s with no stick and no lever, and it comes down and sits, props idle
  const s = sim(), v = drone('bumble'); ctx.__v = v;
  const o = JSON.parse(R(`(() => { const v = __v, s = __s; fly(v, s, 0.5, {}); fly(v, s, 3, { z: 1 }); fly(v, s, 2, {});
    fly(v, s, 3, {}); for (const p of v.dr.cells) p.fuel = p.def.fuel * 1000 * 0.045;
    const h0 = agl(v); fly(v, s, 1.5, {}); const early = agl(v) - h0; fly(v, s, 25, {});
    return JSON.stringify({ early, landed: v.landed, thr: v.throttle, broken: s.broken.length }); })()`));
  t('...at 5 % it lands by itself after 2 s untouched (not before), and sits with its props idle', Math.abs(o.early) < 0.3 && o.landed && o.thr === 0 && !o.broken, o);
}

// ================================================================ 4. the winged law (the Lancett, 150 m up, throttle 0.6)
{
  const s = sim(), v = drone('lancett'); ctx.__v = v;
  const o = JSON.parse(R(`(() => { const v = __v, s = __s, r = v.radius(); v.x += v.x / r * 150; v.y += v.y / r * 150; v.z += v.z / r * 150;
    const f = v.axis(1, 0, 0); v.vx = f.x * 28; v.vy = f.y * 28; v.vz = f.z * 28; v.landed = false; v.throttle = 0.6;
    const o = { winged: v.aircraft && v.dr.wing && !v.dr.lift };
    fly(v, s, 2, {}); const a0 = v.altitude(); let lo = 1e9, hi = -1e9, slo = 1e9, shi = -1e9;
    fly(v, s, 20, {}, () => { const a = v.altitude(); lo = Math.min(lo, a); hi = Math.max(hi, a); slo = Math.min(slo, v.speed()); shi = Math.max(shi, v.speed()); });
    o.hand = [lo - a0, hi - a0, slo, shi];
    const h0 = path(v), b0 = v.altitude(); fly(v, s, 4, { h: 1 }); o.bank = v.attitude().bank * 180 / Math.PI; o.turn = Math.abs(wrapD(path(v) - h0)); o.dh = v.altitude() - b0;
    fly(v, s, 4, {}); o.level = v.attitude().bank * 180 / Math.PI;
    fly(v, s, 3, { v: 1 }); o.dive = v.attitude().pitch * 180 / Math.PI;
    fly(v, s, 4, {}); o.vs = v.vSpeed();
    o.state = [v.altHold, v.pitchHold, v.holdPitch].map(String).join();
    o.broken = s.broken.length;
    return JSON.stringify(o); })()`));
  t('the Lancett is a winged drone (wings, no lift rotor)', o.winged);
  t('hands off 20 s: its height within 3 m, 28-36 m/s', o.hand[0] >= -3 && o.hand[1] <= 3 && o.hand[2] >= 28 && o.hand[3] <= 36, fx({ lo: o.hand[0], hi: o.hand[1], slo: o.hand[2], shi: o.hand[3] }));
  t('full stick right 4 s: banks 35-55°, turns 45° or more, its height within 5 m', o.bank >= 35 && o.bank <= 55 && o.turn >= 45 && Math.abs(o.dh) <= 5, fx({ bank: o.bank, turn: o.turn, dh: o.dh }));
  t('let go 4 s: the wings level (under 3°)', Math.abs(o.level) < 3, o.level);
  t('full stick ahead 3 s: the nose 30° down or more; let go 4 s: no longer diving (vs ≥ -1 m/s)', o.dive <= -30 && o.vs >= -1, fx({ dive: o.dive, vs: o.vs }));
  t('the plane laws\' state stays untouched (altHold, pitchHold, holdPitch undefined); nothing broke', o.state === 'undefined,undefined,undefined' && !o.broken, o.state);
}

// ================================================================ 5. a motor lost
{
  const loss = (k) => { const s = sim(), v = drone(k); ctx.__v = v;
    return JSON.parse(R(`(() => { const v = __v, s = __s; fly(v, s, 0.5, {}); fly(v, s, 4, { z: 1 }); fly(v, s, 3, {});
      const h0 = agl(v); s.ripParts(v, [v.dr.rotors[0]]); fly(v, s, 3, {});
      return JSON.stringify({ yaw: Math.abs(dot3(v.bodyAV(), PILOT.drone.U)), dh: agl(v) - h0, vs: v.vSpeed(), n: v.dr.rotors.length, mot0: v.dr.mot0 }); })()`)); };
  const q = loss('bumble'), h = loss('babaYara');
  t('a quad down one motor spins (over 1 rad/s) and comes down; the stick still works', q.yaw > 1 && q.dh < -3 && q.vs < -1 && q.n === 3 && q.mot0 === 4, fx(q));
  t('a hex down one keeps hovering (within 1 m)', Math.abs(h.dh) <= 1 && h.yaw < 0.2 && h.n === 5 && h.mot0 === 6, fx(h));
}

// ================================================================ 8. the builder's numbers: stats, what fits a bay, the bay's chosen drone
{
  const T18 = { // §18: parts, kg, $, thrust/weight, hover min, top km/h (Level; the Lancett's at 0.6 throttle), the bays it fits
    bumble: [10, 1.68, 1920, 3.88, 7.5, 97, 'dockRack,dockHangar'], bumbleF: [10, 3.08, 2870, 2.12, 8.3, 102, 'dockRack,dockHangar'], mavik: [10, 1.15, 3190, 2.84, 31.5, 54, 'dockHangar'],
    babaYara: [14, 21.5, 7830, 1.71, 27.5, 55, 'dockHangar'], lancett: [10, 4.56, 3630, 0.66, 0, 115, 'dockTubes'] };
  const got = JSON.parse(R(`JSON.stringify(Object.fromEntries(${JSON.stringify(STOCK)}.map((k) => { const ps = partsFromDesign(rowsOf(k)), s = Drone.stats(ps);
    return [k, { n: ps.length, kg: s.kg, cost: designCost(ps), twr: s.twr, hover: s.hoverMin, top: s.vTop * 3.6, fits: s.fits.join(), why: s.why }]; })))`));
  const near = (a, b) => (b === 0 ? a === 0 : Math.abs(a / b - 1) <= 0.03);
  const offS = STOCK.filter((k) => { const [n, kg, $, twr, hov, top] = T18[k], g = got[k]; return g.n !== n || !near(g.kg, kg) || g.cost !== $ || !near(g.twr, twr) || !near(g.hover, hov) || !near(g.top, top); });
  t('Drone.stats for each stock drone: parts, mass, price, thrust/weight, hover time and top speed within 3 % of §18', !offS.length,
    offS.map((k) => `${k} ${JSON.stringify(fx(got[k]))}`).join('; ') || STOCK.map((k) => `${k} ${got[k].kg.toFixed(2)} kg ${got[k].top.toFixed(0)} km/h`).join(', '));
  t('...and the bays each fits: Bumble and Bumble Fibre a Rack or a Hangar, the Mavik and Baba Yara a Hangar, the Lancett the Tubes', STOCK.every((k) => got[k].fits === T18[k][6]), STOCK.map((k) => `${k}: ${got[k].fits}`).join('; '));
  t('the Mavik\'s reason at a Rack: "Too dear: $3,190 of $3,000"; the Lancett\'s at a Hangar "Takes multirotors only", a Bumble\'s at the Tubes "Takes winged drones only"',
    got.mavik.why.dockRack === 'Too dear: $3,190 of $3,000' && got.lancett.why.dockHangar === 'Takes multirotors only' && got.bumble.why.dockTubes === 'Takes winged drones only', [got.mavik.why, got.lancett.why, got.bumble.why]);
  const F = JSON.parse(R(`(() => { const D = PARTS.dockRack.dock, b = rowsOf('bumble');
    const big = rowsOf('babaYara'), wide = b.map((r) => (r.type === 'drMotorS' ? { ...r, z: Math.sign(r.z) * 0.5 } : r)), tank = b.concat([{ type: 'cdJam', x: 0, y: 0.5, rot: 0, flip: false }]);
    const many = b.concat(Array.from({ length: 31 }, (_, i) => ({ type: 'drGuard', x: 2 + i, y: 3, rot: 0, flip: false })));
    return JSON.stringify([Drone.fits({ kind: 'plane', parts: b }, D).why, Drone.fits(b.filter((r) => r.type !== 'drFC'), D).why, Drone.fits(many, D).why, Drone.fits(big, PARTS.dockTubes.dock).why,
      Drone.fits(big, D).why, Drone.fits(wide, D).why, Drone.fits(tank, PARTS.dockHangar.dock).why, Drone.fits({ kind: 'drone', parts: b }, D).ok]); })()`));
  t('what fits a bay, the picker\'s words: not a drone, armour parts, too many parts, too dear, too wide', F[0] === 'Not a drone' && F[1] === 'Not a drone' && F[2] === 'Too many parts: 41 of 40'
    && F[3] === 'Too dear: $7,830 of $4,500' && /^Too dear/.test(F[4]) && F[5] === 'Too wide: 1.2 of 0.8 m' && F[6] === 'Armour parts don\'t fly' && F[7] === true, F);
  // (a Bumble with a 700 Wh battery as well: $1,920 + $900, 1.68 + 4.0 + 0.7 kg)
  const heavy = R(`Drone.fits(rowsOf('bumble').concat([{ type: 'drBattL', x: -0.03, y: -0.15, rot: 0, flip: false, att: 8 }]), PARTS.dockRack.dock).why`);
  t('a heavy one: "Too heavy: 6.38 of 3.5 kg" (a Bumble with a 700 Wh battery as well)', heavy === 'Too heavy: 6.38 of 3.5 kg', heavy);
  const geo = JSON.parse(R(`JSON.stringify(${JSON.stringify(STOCK)}.map((k) => { const ps = partsFromDesign(rowsOf(k)), adj = buildAdjacency(ps), keep = componentOf(findControlPart(ps).id, adj), clash = [];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (partsClash(ps[i], ps[j])) clash.push(ps[i].type + ' x ' + ps[j].type);
    return [k, keep.size === ps.length, clash]; }))`));
  t('all 5 stock drones are clash-free and joined', geo.every(([, joined, clash]) => joined && !clash.length), geo.filter(([, j, c]) => !j || c.length));
  const C = JSON.parse(R(`(() => { const b = rowsOf('bumble'), c = (d) => Drone.cleanChoice(d);
    const name = c({ name: 'x'.repeat(500), parts: b });
    return JSON.stringify({ gv: c({ name: 'a', parts: b.concat([{ type: 'cdJam', x: 0, y: 0.5, rot: 0, flip: false }]) }), many: c({ name: 'a', parts: b.concat(Array.from({ length: 31 }, (_, i) => ({ type: 'drGuard', x: 2 + i, y: 3, rot: 0, flip: false }))) }),
      nofc: c({ name: 'a', parts: b.filter((r) => r.type !== 'drFC') }), key: c({ key: 'nope' }), plane: c({ key: 'falcon' }), notArr: c({ name: 'a', parts: 'x' }), nul: c(null), str: c('bumble'),
      name: name && name.name.length, rows: name && name.parts.length, same: name && JSON.stringify(name.parts) === JSON.stringify(designRows(partsFromDesign(b))),
      stock: Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].kind === 'drone').every((k) => JSON.stringify(c({ key: k })) === JSON.stringify({ key: k })) }); })()`));
  t('cleanChoice refuses armour parts, 41 rows, no controller, an unknown key, a key that is no drone, parts that are no list; cuts a 500-letter name to 40; keeps the rows as designRows makes them',
    C.gv === null && C.many === null && C.nofc === null && C.key === null && C.plane === null && C.notArr === null && C.nul === null && C.str === null && C.name === 40 && C.rows === 10 && C.same && C.stock, C);
  t('...and a choice\'s rows come back to build a drone of kind drone, its motors on, flying Level, not yet placed', R(`(() => { const ch = Drone.cleanChoice({ name: 'Mine', parts: rowsOf('bumble') }), v = Drone.build(Drone.choiceRows(ch), ch.name);
    return v && v.kind === 'drone' && v.name === 'Mine' && v.parts.length === 10 && v.dr && v.dr.rotors.length === 4 && v.dr.rotors.every((p) => p.active) && v.sas === 'hold' && v.stageIdx === v.stages.length && Drone.build([], 'x') === null; })()`));
}

// ================================================================ 8. the builder's quick-add (builder.js droneSpotOf, §10.3)
// Tray taps on an empty Drone blueprint, symmetry on (each motor's mirror twin added as the builder adds it: across the
// centre line, when it clashes with nothing), against the stock drones' rows: within 1 cm per part.
{
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(process.env.ROOT ? path.resolve(process.env.ROOT) : path.join(__dirname, '..'), 'js', 'builder.js'), 'utf8').match(/\nfunction droneSpotOf\([\s\S]*?\n}\n/);
  t('builder.js has the Drone kind\'s quick-add (droneSpotOf)', !!src);
  if (src) R(src[0] + `
var tapAll = (types, sym = true) => { const parts = [], said = [];
  for (const type of types) {
    const s = droneSpotOf(type, parts);
    if (!s) { said.push(type + ': null'); continue; }
    if (s.why) { said.push(s.why); continue; }
    const p = makePart(type, s.x, s.y, { flip: s.x < 0, rot: s.rot, z: s.z, att: s.att ? s.att.id : null }); parts.push(p);
    const z = partZ(p);
    if (sym && Math.abs(z) >= 0.01 && !zLocked(p.def)) { const m = makePart(type, p.x, p.y, { flip: p.x < 0, rot: p.rot, z: -z, att: p.att }); if (!partsClash(m, p) && !parts.some((o) => o !== p && partsClash(m, o))) parts.push(m); }
  }
  return { parts, said }; };
// each tapped part against the next row of its type in the stock rows: [type, dx, dy, dz, the same turn, the same host's type]
var against = (parts, rows) => { const R = rows.map((r) => ({ ...r })), byId = new Map(parts.map((p) => [p.id, p])), out = [];
  for (const p of parts) { const i = R.findIndex((r) => r && r.type === p.type); if (i < 0) { out.push([p.type, 'not in the stock rows']); continue; }
    const r = R[i]; R[i] = null; const h = byId.get(p.att), want = r.att != null ? rows[r.att].type : null;
    out.push([p.type, +Math.abs(p.x - r.x).toFixed(4), +Math.abs(p.y - r.y).toFixed(4), +Math.abs(partZ(p) - (r.z || 0)).toFixed(4), (p.rot || 0) === (r.rot || 0), (h ? h.type : null) === want]); }
  return out; };
var joined = (parts) => { const adj = buildAdjacency(parts), c = findControlPart(parts); return !!c && componentOf(c.id, adj).size === parts.length; };
var clashes = (parts) => { const o = []; for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (partsClash(parts[i], parts[j])) o.push(parts[i].type + ' x ' + parts[j].type); return o; };`);
  const near = (rows, cm = 0.01) => rows.every((r) => r.length === 6 && r[1] <= cm && r[2] <= cm && r[3] <= cm && r[4] && r[5]);
  // the six taps and the charge: frame, controller, motors twice, battery, camera, charge (9 parts: the Bumble without its radio)
  const B = JSON.parse(R(`(() => { const { parts, said } = tapAll(['drFrameS', 'drFC', 'drMotorS', 'drMotorS', 'drBattS', 'drCam', 'drCharge']);
    return JSON.stringify({ n: parts.length, said, rows: against(parts, rowsOf('bumble')), joined: joined(parts), clash: clashes(parts) }); })()`));
  t('quick-add: the six taps and a charge make the Bumble (9 parts: four motors from two taps), each part within 1 cm of its row, the same turn and host',
    B.n === 9 && !B.said.length && near(B.rows), JSON.stringify(B.said.length ? B.said : B.rows.filter((r) => !near([r]))));
  t('...joined and clash-free', B.joined && !B.clash.length, B.clash);
  const B2 = JSON.parse(R(`(() => { const { parts, said } = tapAll(['drFrameS', 'drFC', 'drMotorS', 'drMotorS', 'drBattS', 'drCam', 'drCharge', 'drLink']);
    return JSON.stringify({ n: parts.length, rows: against(parts, rowsOf('bumble')), said }); })()`));
  t('...and a Radio Link tapped too: all ten of the Bumble\'s rows (the link on the frame behind the controller)', B2.n === 10 && near(B2.rows) && !B2.said.length, JSON.stringify(B2.rows.slice(-1)));
  const W = JSON.parse(R(`JSON.stringify([tapAll(['drFrameS', 'drFC', 'drMotorS', 'drMotorS', 'drMotorS']).said, tapAll(['drFrameS', 'drFrameS']).said, tapAll(['drFrameS', 'drBody']).said,
    tapAll(['drFrameH', 'drFCgps', 'drMotorL', 'drMotorL', 'drMotorL', 'drMotorL']).parts.filter((p) => p.type === 'drMotorL').map((p) => [p.x, partZ(p)]),
    tapAll(['drFrameS', 'drFC', 'drMotorS', 'drMotorS'], false).parts.filter((p) => p.type === 'drMotorS').map((p) => [p.x, partZ(p)])])`));
  t('a third motor tap on a quad: "Every arm has its motors: pick a bigger frame"; a second frame: "One frame per drone"; a body on a quad: "A winged drone needs its own design"',
    W[0][0] === 'Every arm has its motors: pick a bigger frame' && W[1][0] === 'One frame per drone' && W[2][0] === 'A winged drone needs its own design', W.slice(0, 3));
  t('a hex frame: four taps of a motor fill its six arms, front first (the nose and tail arms alone, the others in mirrored pairs)', JSON.stringify(W[3]) === JSON.stringify([[0.6, 0], [0.3, 0.52], [0.3, -0.52], [-0.3, 0.52], [-0.3, -0.52], [-0.6, 0]]), JSON.stringify(W[3]));
  t('symmetry off: one motor a tap, the front right one first', JSON.stringify(W[4]) === JSON.stringify([[0.15, 0.15], [0.15, -0.15]]), JSON.stringify(W[4]));
  // a winged one: the body, controller, battery, charge, camera, link, pusher, tail and fin where the Lancett has them; the
  // wing on top of the body, its middle 8 cm behind the centre of mass of what is there
  const L = JSON.parse(R(`(() => { const { parts, said } = tapAll(['drBody', 'drFC', 'drBattM', 'drChargeT', 'drCam', 'drLinkL', 'drPusher', 'drTail', 'drFin']);
    let kg = 0, mx = 0; for (const p of parts) { kg += partKg(p); mx += partKg(p) * p.x; }
    const w = droneSpotOf('drWing', parts);
    parts.push(makePart('drWing', w.x, w.y, { rot: w.rot, att: w.att.id }));
    return JSON.stringify({ said, rows: against(parts.slice(0, -1), rowsOf('lancett')), wing: [+(mx / kg - w.x).toFixed(3), w.rot, +(w.y - partRect(parts[0]).t).toFixed(3), w.att.type], joined: joined(parts), clash: clashes(parts) }); })()`));
  t('a winged drone by taps: controller and battery inside the body, charge on its nose, camera and link on top, pusher, tail and fin at its tail, as the Lancett has them',
    !L.said.length && near(L.rows.map((r) => (r[0] === 'drFin' ? [...r.slice(0, 5), true] : r))), JSON.stringify(L.said.length ? L.said : L.rows.filter((r) => !near([r]))));
  t('...the wing on top of the body, turned forward, its middle 8 cm behind the centre of mass; all of it joined, nothing clashing', L.wing[0] === 0.08 && L.wing[1] === 3 && Math.abs(L.wing[2] - 0.015) < 1e-6 && L.wing[3] === 'drBody' && L.joined && !L.clash.length, JSON.stringify(L));
}

// ================================================================ the groups (Drone.groups through rebuildGroups) and the hooks
t('a drone\'s groups: its controller, links (its own radio first), the camera, cells and full charge, motors, mot0 kept across rebuilds', R(`(() => {
  const v = (() => { const ps = partsFromDesign(rowsOf('mavik')); const w = new Vessel(ps, buildAdjacency(ps), EARTH); w.kind = 'drone'; w.rebuildGroups(); return w; })(), d = v.dr;
  const ok = d.fc === PARTS.drFCgps.drone.fc && d.links.map((l) => l.L.kind + l.L.range).join() === 'radio1000,long8000' && d.cam.type === 'drGimbal' && d.cells.length === 1 && Math.abs(d.wh0 - 100) < 1e-9
    && d.rotors.length === 4 && d.mot0 === 4 && d.lift && !d.wing && d.guarded.size === 0 && d.warheads.length === 0;
  v.parts = v.parts.filter((p) => p !== d.rotors[0]); v.adj = buildAdjacency(v.parts); v.rebuildGroups();
  return ok && v.dr.rotors.length === 3 && v.dr.mot0 === 4; })()`));
t('the old Drone Core on a drone: a GPS controller (14 m/s) with a satellite link', R(`(() => { const ps = partsFromDesign([{ type: 'droneCore', x: 0, y: 0, rot: 0, flip: false }]); const v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'drone'; v.rebuildGroups();
  return v.dr.fc === DRONE_LEGACY.droneCore.fc && v.dr.fc.vmax === 14 && v.dr.links.length === 1 && v.dr.links[0].L.kind === 'sat' && v.dr.wh0 === 0 && Drone.charge(v) === 1; })()`));
t('a prop guard (or a duct) guards the motor inside it: a light touch doesn\'t shatter it', R(`(() => { const rows = rowsOf('bumble').concat([{ type: 'drGuard', x: 0.15, y: 0.0475, rot: 0, flip: false, z: 0.15, att: 0 }]);
  const ps = partsFromDesign(rows); const v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'drone'; v.rebuildGroups();
  const m = v.dr.rotors.find((p) => p.x === 0.15 && p.z === 0.15);
  const ps2 = partsFromDesign([{ type: 'drFrameS', x: 0, y: 0, rot: 0, flip: false }, { type: 'drFC', x: 0, y: 0.0375, rot: 0, flip: false, att: 0 }, { type: 'drFan', x: 0.15, y: 0.0775, rot: 0, flip: false, z: 0.15, att: 0 }]);
  const f = new Vessel(ps2, buildAdjacency(ps2), EARTH); f.kind = 'drone'; f.rebuildGroups();
  return v.dr.guarded.size === 1 && v.dr.guarded.has(m.id) && f.dr.guarded.size === 1; })()`));
t('the drag area: each part\'s own cda (the Bumble 0.014 m²)', Math.abs(R(`(() => { const ps = partsFromDesign(rowsOf('bumble')); const v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'drone'; v.rebuildGroups(); return v.droneCdA; })()`) - 0.014) < 1e-9);
t('a saved drone comes back flying Level or Acro, nothing else', R(`(() => { const ps = partsFromDesign(rowsOf('bumble')); const v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'drone'; v.rebuildGroups();
  const back = (sas) => { v.sas = sas; return Vessel.restore(JSON.parse(JSON.stringify(v.serialize()))).sas; };
  return back('acro') === 'acro' && back('hold') === 'hold' && back('level') === 'hold' && back('aim') === 'hold' && back('manual') === 'hold'; })()`));
t('a bay\'s anti-drone gun is loaded (200 rounds) and a tank\'s kit is listed (cuas, docks, cdLow while its Drone Radar works)', R(`(() => {
  const ps = partsFromDesign(templateRows(TEMPLATES.tk34).concat([{ type: 'cdGun', x: -2, y: 2.5, rot: 0, flip: false }, { type: 'dockRack', x: -2, y: 3.2, rot: 0, flip: false }, { type: 'cdRadar', x: 0, y: 3.4, rot: 0, flip: false }]));
  const v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'tank'; v.rebuildGroups();
  const g = v.parts.find((p) => p.type === 'cdGun'), ok = g.ammo === 200 && v.cuas.length === 1 && v.docks.length === 1 && v.cdLow === true && v.dr === null;
  v.parts.find((p) => p.type === 'cdRadar').broken = true; v.rebuildGroups();
  return ok && v.cdLow === false; })()`));

// ================================================================ 12. the contract: drones fly with no call into the ground update's systems
{
  const SYSTEMS = ['Gear', 'Aim', 'Armour', 'GroundMode', 'GroundAI', 'Props'];
  R(`var CALLS = {}; for (const name of ${JSON.stringify(SYSTEMS)}) { const o = this[name]; if (!o) continue;
    for (const k of Object.keys(o)) if (typeof o[k] === 'function') { const f = o[k]; o[k] = function (...a) { CALLS[name + '.' + k] = (CALLS[name + '.' + k] || 0) + 1; return f.apply(this, a); }; } }`);
  const res = [];
  for (const k of STOCK) {
    const v = drone(k), s = sim(); ctx.__v = v;
    res.push(R(`(() => { const v = __v, s = __s; s.vessels = [v]; s.active = v; s.running = true; s.firing = false; s.destroyed = false; s.warpIdx = 1; Combat.reset({});
      if (v.aircraft) { const r = v.radius(); v.x += v.x / r * 150; v.y += v.y / r * 150; v.z += v.z / r * 150; const f = v.axis(1, 0, 0); v.vx = f.x * 28; v.vy = f.y * 28; v.vz = f.z * 28; v.landed = false; v.throttle = 0.6; }
      const dt = 1 / 120;
      for (let i = 0; i < 12 / dt; i++) { const tt = i * dt;
        v.ctl.v = tt > 2 && tt < 4 ? -0.6 : 0; v.ctl.h = tt > 4 && tt < 5 ? 1 : tt > 7 && tt < 8 ? -0.7 : 0; v.ctl.r = tt > 9 && tt < 10 ? 0.5 : 0; v.ctl.z = tt < 2 ? 1 : 0;
        v.physicsStep(dt, s); Combat.step(dt, s); s.time += dt; if (i % 4 === 0) Combat.frame(s, dt * 4);
        if (v.dead || !v.parts.length) break; }
      return [Combat.S.dr, s.broken.length, v.altitude() > 10]; })()`));
  }
  const quiet = R(`JSON.stringify(Object.fromEntries(Object.entries(CALLS).filter(([k]) => !k.startsWith('Props.'))))`);
  t('every stock drone flies the traces script (12 s, stick and lever, weapons stepped): no call into Gear, Aim, Armour, GroundMode or GroundAI (Props only asked)',
    quiet === '{}' && res.every(([dr, broken, up]) => dr === true && broken === 0 && up), [quiet, res]);
}

t.done();
