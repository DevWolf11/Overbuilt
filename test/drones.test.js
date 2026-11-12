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
  t(`...nor do the drone templates' names and blurbs (${tk.length}: the five drones, the BMK-2D Nest and the MA-1C Abrahm)`, tk.length === 7 && tk.every((k) => !REAL_DRONE.test(ctx.TEMPLATES[k].name) && ctx.TEMPLATES[k].blurb.length >= 40 && !REAL_DRONE.test(ctx.TEMPLATES[k].blurb)));
  t('the drone templates: after the jets and before the Armour, none military, career tier the highest of their parts\', each paint a skin its part takes; the two tanks out of old Hostile waves (dw)', R(`(() => {
    const K = Object.keys(TEMPLATES), d = K.filter((k) => TEMPLATES[k].kind === 'drone');
    return d.join() === 'bumble,bumbleF,mavik,babaYara,lancett' && K.indexOf('bumble') === K.indexOf('sugoi57') + 1 && K.indexOf('tk34') === K.indexOf('lancett') + 1 && K.slice(-2).join() === 'bmk2d,ma1c'
      && ${JSON.stringify(tk)}.every((k) => { const T = TEMPLATES[k]; return !T.military && T.tier === Math.max(...T.parts.map((r) => PARTS[r[0]].tier || 0)) && (T.kind === 'drone') === !T.dw
        && Object.keys(T.paint || {}).every((type) => T.parts.some((r) => r[0] === type) && cleanSkin(T.paint[type], PARTS[type]) === T.paint[type]); }); })()`));
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

{ // the autopilots fly a drone left in Acro (P4-OF-1): Home, Land, the unattended hold and a GPS controller's lost link
  // take over by the Level law (a winged drone: its own law), whatever mode the pilot was flying in
  const acro = (k, what) => { const s = sim(), v = drone(k); ctx.__v = v; R(`__v.dl = { t: 0, at0: { x: __v.x, y: __v.y, z: __v.z }, t0: 0 };`);
    return JSON.parse(R(`(() => { const v = __v, s = __s; fly(v, s, 0.5, {}); fly(v, s, 5, { z: 1 }); fly(v, s, 4, { v: 1 }); fly(v, s, 5, {});
      const H = v.dl.at0, d0 = Math.hypot(v.x - H.x, v.y - H.y, v.z - H.z), a0 = agl(v); v.sas = 'acro'; fly(v, s, 0.3, {});
      if ('${what}' === 'home') Drone.home(s, v); else if ('${what}' === 'land') Drone.land(s, v); else if ('${what}' === 'hold') v.dl.mode = 'hold'; else v.dl.lost = true;
      fly(v, s, 20, {}, () => !s.broken.length);
      return JSON.stringify({ d0, d1: Math.hypot(v.x - H.x, v.y - H.y, v.z - H.z), dh: agl(v) - a0, sp: v.speed(), landed: v.landed, broken: s.broken.length }); })()`)); };
  const mh = acro('mavik', 'home'), ml = acro('mavik', 'lost'), bl = acro('bumble', 'land'), bh = acro('bumble', 'hold');
  t('in Acro, Home and a GPS lost link fly it back and set it down; Land sets it down; the unattended hold hovers (P4-OF-1)',
    mh.d1 < 0.5 * mh.d0 && mh.landed && ml.d1 < 0.5 * ml.d0 && ml.landed && bl.landed && !bl.broken && Math.abs(bh.dh) < 3 && bh.sp < 2 && !bh.broken,
    fx({ mh: mh.d1, ml: ml.d1, bl: bl.landed, bhdh: bh.dh, bhsp: bh.sp }));
  const s = sim(), v = drone('lancett'); ctx.__v = v;
  const w = JSON.parse(R(`(() => { const v = __v, s = __s, r = v.radius(); v.x += v.x / r * 150; v.y += v.y / r * 150; v.z += v.z / r * 150;
    const f = v.axis(1, 0, 0); v.vx = f.x * 28; v.vy = f.y * 28; v.vz = f.z * 28; v.landed = false; v.throttle = 0.6; v.dl = { t: 0, at0: { x: v.x, y: v.y, z: v.z }, t0: 0 };
    fly(v, s, 3, {}); v.sas = 'acro'; const p0 = pos(v); v.dl.mode = 'hold'; let turned = 0, last = path(v);
    fly(v, s, 40, {}, () => { const h = path(v); turned += Math.abs(wrapD(h - last)); last = h; return !s.broken.length; });
    return JSON.stringify({ turned, end: dist(pos(v), p0), broken: s.broken.length }); })()`));
  t('...and a winged drone left in Acro circles where it was left (360° or more in 40 s, within 300 m)', w.turned >= 360 && w.end < 300 && !w.broken, fx(w));
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

// ================================================================ 6 and 9. the link and the bays (a second game, with flight.js: the real switchTo,
// onDestroyed, serialize, canRecover and stepsNear over a stand-in page)
{
  const B = G.load({ combat: true, ground: true, props: true, flight: true }), RB = (c) => G.run(B, c);
  B.__ROWS = ctx.__ROWS;
  RB(`var rowsOf = (k) => __ROWS[k].map((r) => ({ type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: r[1] < 0, ...(r[4] || {}) }));
  Math.random = mulberry32(4242);
  var SET = { targets: 'off', droneView: 'fpv', droneStick: 'turn' }, get0 = Settings.get.bind(Settings);
  Settings.get = (k) => (k in SET ? SET[k] : get0(k));
  Flight.running = true; // (GroundAI.battle asks the page's Flight)
  var MapView = { focusVessel() {} }; Controls.relayout = () => {}; Controls.keyHints = () => {};
  var App = { use3D: () => !App.flat, flat: false, showScene() {}, afterEarth(f) { f(); }, scene: 'flight' };
  // the stock drones as templates where the catalogue has none yet (the bays' stock drone, a stored choice)
  for (const k of ['bumble', 'mavik']) if (!TEMPLATES[k]) TEMPLATES[k] = { name: k === 'bumble' ? 'Bumble FPV' : 'Mavik Scout', kind: 'drone', parts: __ROWS[k] };
  var designOf = (key) => ({ name: TEMPLATES[key].name, kind: TEMPLATES[key].kind, parts: templateRows(TEMPLATES[key]) });
  // a TK-34 with a Drone Rack on its engine deck (the BMK-2D's bay; plain rows until its template comes)
  var nest = () => { const d = designOf('tk34'); d.name = 'Test Nest'; d.parts = d.parts.concat([{ type: 'dockRack', x: -2.1, y: 1.925, rot: 0, flip: false, att: 0 }]); return d; };
  var NPAD = GroundMode.placement('highland', 0, 0, 'tank');
  // a vessel from a design, as Flight.start builds it, on the pad (or place)
  var mk = (design, P) => {
    const ps = partsFromDesign(design.parts), adjAll = buildAdjacency(ps), ctrl = findControlPart(ps), keep = componentOf(ctrl.id, adjAll), parts = ps.filter((p) => keep.has(p.id)), adj = new Map();
    for (const p of parts) { if (p.att != null && !keep.has(p.att)) p.att = null; adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id)))); }
    const v = new Vessel(parts, adj, EARTH); v.name = design.name; v.kind = design.kind; v.stages = computeStages(parts, adj, ctrl.id); v.rebuildGroups();
    if (v.docks.length) v.droneChoice = Drone.cleanChoice(design.drone);
    P = P || NPAD; v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), 0, P.z, P.yaw || 0);
    return v; };
  var enemy = () => { const o = mk(designOf('ms4'), { e: NPAD.e + 300, z: NPAD.z }); o.ai = { ground: true, team: 1 }; return o; };
  // Flight over a stand-in page: the real flight.js for what this package changed, the page's own work stubbed
  var world = () => { const F = Object.create(Flight);
    Object.assign(F, { time: 0, target: null, log: [], broken: [], vessels: [], active: null, firing: false, mgFiring: false, groundAim: false, warpIdx: 0, mp: null, scale: 12,
      running: true, destroyed: false, camAbs: { x: 0, y: 0, z: 0 }, launchCost: 0, flags: {}, stats: { maxAlt: 0, maxSpeed: 0, maxG: 0 }, design: null, deaths: 0, ends: 0, carrierDown: null, crashedAt: null,
      toast(m) { this.log.push(m); }, award(f) { this.flags[f] = true; }, syncAwake() {}, syncSas() {}, updatePrediction() {}, updateDvEstimate() {}, updateHUD() {}, strip() {}, setSight() {}, unlockPointer() {},
      endAfter() { this.ends++; }, cleanup() { this.vessels = this.vessels.filter((v) => !v.dead && v.parts.length); },
      start(design, opts) {
        this.design = design;
        const v = mk(design, opts && opts.place);
        this.launchCost = designCost(v.parts);
        this.vessels = [v, ...(opts && Array.isArray(opts.keep) ? opts.keep.filter((o) => o && o !== v && !o.dead) : [])]; this.active = v; this.destroyed = false; this.carrierDown = null;
        Combat.reset(this); this.running = true;
        return v;
      } });
    const od = F.onDestroyed; F.onDestroyed = function () { if (!(this.active && this.active.carrier)) this.deaths++; return od.call(this); }; // (deaths: the tank's, not a drone's)
    return F; };
  // secs of 60 fps frames: two 1/120 s physics steps (a sleeping parked tank is let be, as Flight's), Combat.step, Combat.frame
  var go = (F, secs, each) => { for (let f = 0, N = Math.round(secs * 60); f < N; f++) { if (each && each(F, f) === false) return f;
    for (let i = 0; i < 2; i++) { for (const v of F.vessels.slice()) if (!v.remote && !v.wreck && !v.kin && !v.dead && v.parts.length && !(v !== F.active && v.landed && v.restTime > 2)) v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; }
    Combat.frame(F, 1 / 60); F.cleanup(); } return Math.round(secs * 60); };
  var up = (o) => { const r = Math.hypot(o.x, o.y, o.z); return { x: o.x / r, y: o.y / r, z: o.z / r }; };
  var bayOf = (C) => C.docks[0], topOf = (C) => { const p = bayOf(C), R = partRect(p); return C.toWorld((R.l + R.r) / 2, R.t, partZc(p)); };
  var overTop = (d, C) => { const T = topOf(C), U = up(C); return (d.x - T.x) * U.x + (d.y - T.y) * U.y + (d.z - T.z) * U.z; };
  var across = (a, b) => { const U = up(b), dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z, k = dx * U.x + dy * U.y + dz * U.z; return Math.hypot(dx - U.x * k, dy - U.y * k, dz - U.z * k); };
  // move a vessel to h m over the ground d m east of where it is (as if it flew there), still
  var putAt = (v, de, h) => { const L = Terrain.locate(EARTH, v.x, v.y, v.z, {}), lat = L.z / EARTH.radius, a = L.a - de / (EARTH.radius * Math.cos(lat)), r = EARTH.radius + Terrain.surfaceAt(EARTH, a, L.z) + h;
    v.x = r * Math.cos(lat) * Math.cos(a); v.y = r * Math.cos(lat) * Math.sin(a); v.z = r * Math.sin(lat); v.vx = v.vy = v.vz = 0; v.landed = false; };
  // a launched carrier: the Nest on Highland Ridge's north pad, settled, its drone up
  var launched = (set) => { const F = world(), C = F.start(Object.assign(nest(), set || {})); go(F, 1.5); const ok = Drone.key(F); return { F, C, d: F.active, ok }; };`);

  // ---------------------------------------------------------------- 6. the link
  RB(`var solo = (k, rows) => { const F = world(), v = F.start({ name: k, kind: 'drone', parts: rows || rowsOf(k) });
    for (const p of v.parts) if (p.def.thrust) p.active = true; v.stageIdx = v.stages.length; v.sas = 'hold'; v.throttle = 0; v.dl = { t: 0, at0: { x: v.x, y: v.y, z: v.z }, t0: 0 };
    go(F, 3, (F) => { v.ctl.z = F.time < 2 ? 1 : 0; }); return { F, v }; };
  var at0Of = (v) => { const a = v.dl.at0, r = Math.hypot(a.x, a.y, a.z); return { x: a.x + a.x / r * 2, y: a.y + a.y / r * 2, z: a.z + a.z / r * 2 }; };
  var ticks = (F, secs) => { for (let i = 0, n = Math.round(secs * 60); i < n; i++) { F.time += 1 / 60; Drone.frame(F, 1 / 60); } };`);
  RB(`var K1 = (() => { const { F, v } = solo('bumble'); putAt(v, 2700, 40); let lostAt = null; const t0 = F.time; go(F, 3, () => { if (lostAt == null && v.dl.lost) lostAt = F.time - t0; });
    const o = { lostAt, thr: v.throttle, q: v.dl.q, via: v.dl.via && v.dl.via.kind, said: F.log.filter((m) => /Link/.test(m)) };
    putAt(v, -2200, 40); v.dl.hold = null; let backAt = null; const t1 = F.time; go(F, 2, () => { if (backAt == null && !v.dl.lost) backAt = F.time - t1; });
    o.backAt = backAt; o.q2 = v.dl.q; o.said2 = F.log.slice(-1)[0]; o.mode = v.dl.mode; o.sas = v.sas; return o; })();`);
  const K1 = JSON.parse(RB('JSON.stringify(K1)'));
  t('6 the radio past its range (a Bumble 2.7 km out on its 2.5 km link): LOST after 0.5 s ("Link lost"); an FPV controller lets it fall (throttle 0)',
    K1.lostAt != null && K1.lostAt >= 0.45 && K1.lostAt <= 0.85 && K1.thr === 0 && K1.q === 0 && K1.said.includes('Link lost'), K1);
  t('...back in range: the link is back once over 0.35 for 0.5 s, in Level ("Link back")', K1.backAt != null && K1.backAt >= 0.45 && K1.backAt <= 0.85 && K1.q2 > 0.35 && K1.said2 === 'Link back' && K1.mode === 'pilot' && K1.sas === 'hold', K1);
  RB(`var K2 = (() => { const rows = rowsOf('mavik').filter((r) => r.type !== 'drLinkL'); const { F, v } = solo('mavik', rows); const a0 = at0Of(v);
    putAt(v, 1150, 40); let lostAt = null, landedAt = null; go(F, 200, () => { if (lostAt == null && v.dl.lost) lostAt = F.time; if (v.landed && v.speed() < 0.3) { landedAt = F.time; return false; } });
    return { lostAt: lostAt != null, landedAt, off: across(v, a0), mode: v.dl.mode, said: F.log.filter((m) => /Link/.test(m)) }; })();`);
  const K2 = JSON.parse(RB('JSON.stringify(K2)'));
  t('6 a GPS controller (a Mavik on its own 1 km radio, 1.15 km out): LOST, then it flies home by itself and lands within 10 m of where it took off ("Link lost: flying home")',
    K2.lostAt && K2.landedAt != null && K2.off < 10 && K2.said[0] === 'Link lost: flying home', K2);
  // a hill between: the station's line to a drone 3 m over the ground behind a ridge (the ground sampled finely here)
  RB(`var K3 = (() => { const { F, v } = solo('bumble'); const P = at0Of(v), L0 = Terrain.locate(EARTH, v.x, v.y, v.z, {}), lat = L0.z / EARTH.radius;
    const spot = (de, dn, h) => { const a = L0.a - de / (EARTH.radius * Math.cos(lat)), z = L0.z + dn, la = z / EARTH.radius, r = EARTH.radius + Terrain.surfaceAt(EARTH, a, z) + h; return { x: r * Math.cos(la) * Math.cos(a), y: r * Math.cos(la) * Math.sin(a), z: r * Math.sin(la) }; };
    const margin = (Q) => { let m = Infinity; for (let i = 1; i < 60; i++) { const f = i / 60, x = P.x + (Q.x - P.x) * f, y = P.y + (Q.y - P.y) * f, z = P.z + (Q.z - P.z) * f, A = Terrain.locate(EARTH, x, y, z, {}); m = Math.min(m, Math.hypot(x, y, z) - EARTH.radius - Terrain.surfaceAt(EARTH, A.a, A.z)); } return m; };
    let hid = null, open = null;
    for (let b = 0; b < 72 && (!hid || !open); b++) for (const d of [700, 1000, 1300]) { const de = d * Math.cos(b * Math.PI / 36), dn = d * Math.sin(b * Math.PI / 36), Q = spot(de, dn, 3), m = margin(Q);
      if (!hid && m < -8) hid = Q; const Q2 = spot(de, dn, 80); if (!open && margin(Q2) > 1.3) open = Q2; }
    const q = (Q) => { Object.assign(v, Q); v.dl.losAt = null; ticks(F, 0.25); return v.dl.q; };
    return { found: !!hid && !!open, hid: hid && q(hid), open: open && q(open) }; })();`);
  const K3 = JSON.parse(RB('JSON.stringify(K3)'));
  t('6 a hill between the station and the drone: the link ×0.35 (a clear line: 1)', K3.found && Math.abs(K3.hid - 0.35) < 1e-9 && K3.open === 1, K3);
  // a 500 m jammer on an enemy tank: where each kind of link dies (k: radio 1, long 0.6, sat 0.25, fibre 0; dead inside 0.35 of that)
  RB(`var jamTank = (ai) => { const d = designOf('ms4'); d.parts = d.parts.concat([{ type: 'cdJam', x: -1.4, y: 1.95, rot: 0, flip: false, att: 0 }]); const o = mk(d, { e: NPAD.e + 80, z: NPAD.z }); if (ai) o.ai = { ground: true, team: 1, ally: false }; return o; };
  var JAM = (() => { const out = {};
    const rowsSat = rowsOf('bumble').filter((r) => r.type !== 'drLink').concat([{ type: 'drSat', x: -0.1, y: 0.0725, rot: 0, flip: false, att: 0 }]);
    const rowsLong = rowsOf('mavik');
    for (const [k, rows, near, far] of [['radio', rowsOf('bumble'), 165, 470], ['long', rowsLong, 98, 260], ['sat', rowsSat, 40, 115], ['fibre', rowsOf('bumbleF'), 8, 400]]) {
      for (const [mine, at] of [[false, near], [false, far], [true, near]]) {
        const F = world(), J = jamTank(!mine), v = Drone.build(rows, k); F.vessels.push(J); F.vessels.push(v); F.active = v;
        const jp = J.parts.find((p) => p.type === 'cdJam'), Q = J.toWorld(jp.x, jp.y, partZc(jp)), r = Math.hypot(Q.x, Q.y, Q.z);
        v.x = Q.x + Q.x / r * at; v.y = Q.y + Q.y / r * at; v.z = Q.z + Q.z / r * at; v.landed = false; v.dl = { t: 0, at0: { x: v.x, y: v.y, z: v.z }, t0: 0 };
        ticks(F, 1); out[k + (mine ? ':ours' : '') + ':' + at] = [v.dl.lost, +v.dl.q.toFixed(3), v.dl.jam, v.dl.via && v.dl.via.kind];
      }
    }
    return out; })();`);
  const JAM = JSON.parse(RB('JSON.stringify(JAM)'));
  const lostAt = (k, d) => JAM[`${k}:${d}`][0];
  t('6 a 500 m jammer on an enemy tank: a radio link LOST inside 175 m (not at 470 m), a long-range one inside 105 m (not at 260 m), a satellite one inside 44 m (not at 115 m), fibre never (8 m)',
    lostAt('radio', 165) && !lostAt('radio', 470) && lostAt('long', 98) && !lostAt('long', 260) && lostAt('sat', 40) && !lostAt('sat', 115) && !lostAt('fibre', 8) && !lostAt('fibre', 400) && JAM['fibre:8'][1] === 1, JAM);
  t('...our own jammer does nothing to our own drones', ['radio:ours:165', 'long:ours:98', 'sat:ours:40', 'fibre:ours:8'].every((k) => !JAM[k][0] && JAM[k][1] === 1 && !JAM[k][2]), JAM);
  RB(`var JC = (() => { const F = world(), C = F.start((() => { const d = nest(); d.parts = d.parts.concat([{ type: 'cdJam', x: 1.6, y: 1.95, rot: 0, flip: false, att: 0 }]); return d; })()); go(F, 0.5);
    const e = Drone.build(rowsOf('bumble'), 'Enemy'), r = C.radius(); e.x = C.x + C.x / r * 300; e.y = C.y + C.y / r * 300; e.z = C.z + C.z / r * 300; e.landed = false; e.ai = { drone: true, ground: false, team: 1, ally: false };
    e.dl = { t: 0, at0: { x: e.x, y: e.y, z: e.z }, t0: 0 }; F.vessels.push(e); ticks(F, 0.3); const n1 = Drone.jamN(F);
    e.x = C.x + C.x / r * 600; e.y = C.y + C.y / r * 600; e.z = C.z + C.z / r * 600; ticks(F, 0.3); return { n1, n2: Drone.jamN(F) }; })();`);
  const JC = JSON.parse(RB('JSON.stringify(JC)'));
  t('6 the JAM chip\'s count: an enemy drone inside our tank\'s 500 m jammer (1), outside it (0)', JC.n1 === 1 && JC.n2 === 0, JC);
  RB(`var FB = (() => { const { F, v } = solo('bumbleF'); putAt(v, 5100, 60); ticks(F, 1); const o = { snapped: v.dl.snapped, lost: v.dl.lost, q: v.dl.q, said: F.log.filter((m) => /Fibre/.test(m)) };
    putAt(v, -4900, 30); v.dl.losAt = null; ticks(F, 3); o.q2 = v.dl.q; o.lost2 = v.dl.lost; return o; })();`);
  const FB = JSON.parse(RB('JSON.stringify(FB)'));
  t('6 a fibre spool past its 5 km: snapped for good ("Fibre ran out at 5.0 km"); flown back to 200 m its link stays dead (q 0, LOST)', FB.snapped && FB.lost && FB.q === 0 && FB.said[0] === 'Fibre ran out at 5.0 km' && FB.q2 === 0 && FB.lost2, FB);
  RB(`var LG = (() => { const { F, v } = solo('bumble'); const c = { v: 0, h: 0, r: 0, z: 0 }; let seen = null;
    v.dl.q = 0.2; v.dl.via = { kind: 'radio', range: 2500 };
    for (let i = 0; i < 60; i++) { F.time += 1 / 60; const x = { v: i >= 6 ? 1 : 0, h: 0, r: 0, z: 0 }; Drone.lagged(v, x, F); if (seen == null && x.v === 1) seen = (i - 6) / 60; }
    const s = { kind: 'sat', range: 50000, lag: 0.25 }; v.dl.q = 1; v.dl.via = s; v.dl.ring = null; let seen2 = null;
    for (let i = 0; i < 60; i++) { F.time += 1 / 60; const x = { v: i >= 6 ? 1 : 0, h: 0, r: 0, z: 0 }; Drone.lagged(v, x, F); if (seen2 == null && x.v === 1) seen2 = (i - 6) / 60; }
    v.dl.via = { kind: 'radio', range: 2500 }; const x = { v: 0.5, h: 0, r: 0, z: 0 }; Drone.lagged(v, x, F); return { seen, seen2, none: x.v === 0.5 && v.dl.ring === null }; })();`);
  const LG = JSON.parse(RB('JSON.stringify(LG)'));
  t('6 a weak link (q 0.2) brings the stick late by 0.16 s, a satellite link by its 0.25 s; a good radio link at once', LG.seen != null && Math.abs(LG.seen - 0.16) <= 0.05 && LG.seen2 != null && Math.abs(LG.seen2 - 0.25) <= 0.05 && LG.none, LG);

  // ---------------------------------------------------------------- 9. the bay
  RB(`var L1 = (() => { const F = world(), C = F.start(nest()); go(F, 1.5); C.ctl.v = 1; const c0 = { x: C.x, y: C.y, z: C.z }, n0 = Drone.left(C);
    const ok = Drone.key(F), d = F.active; let h1 = null; go(F, 1, () => { h1 = overTop(d, C); });
    const o = { ok, n0, n1: Drone.left(C), docked: bayOf(C).docked, active: F.active === d && d.kind === 'drone' && d.carrier === C && C.drone === d, fpv: F.fpv, h1,
      park: C.parked === true && C.brake === true && C.ctl.v === 0 && C.ctl.h === 0 && C.ctl.r === 0 && C.throttle === 0, lid: bayOf(C).deployed, toast: F.log.slice(-1)[0], scale: F.scale, cs: C._scale };
    go(F, 10); o.moved = Math.hypot(C.x - c0.x, C.y - c0.y, C.z - c0.z); o.lid2 = bayOf(C).deployed; o.drone = Combat.S.dr; o.hover = overTop(d, C);
    return o; })();`);
  const L1 = JSON.parse(RB('JSON.stringify(L1)'));
  t('9 launch from a parked Nest (U): 3 drones → 2, a drone 4-6 m over the deck within 1 s, flown in first person; the lid up', L1.ok && L1.n0 === 3 && L1.n1 === 2 && L1.docked === 2 && L1.active && L1.fpv === true && L1.h1 >= 4 && L1.h1 <= 6 && L1.lid === 1 && L1.lid2 === 0, L1);
  t('...the tank parks (braked, its controls let go): with W held at the launch it moves under 0.1 m in 10 s; "Drone up: U back to the tank · H view"', L1.park && L1.moved < 0.1 && /^Drone up: U back to the tank · H view$/.test(L1.toast), [L1.moved, L1.toast]);
  t('...the camera comes in for the drone (the tank\'s scale kept for the way back)', L1.scale > 12 && L1.cs === 12, [L1.scale, L1.cs]);
  RB(`var S2 = (() => { const { F, C, d } = launched(); go(F, 1); putAt(d, 25, 12); d.dl.hold = null; go(F, 3); const h0 = overTop(d, C), a0 = across(d, C);
    const k1 = Drone.key(F), inTank = F.active === C && !C.parked, fpv1 = F.fpv, sc1 = F.scale, mode1 = d.dl.mode; go(F, 5);
    const h1 = overTop(d, C), a1 = across(d, C), k2 = Drone.key(F), back = F.active === d && d.dl.mode === 'pilot' && C.parked;
    return { k1, inTank, fpv1, sc1, mode1, dh: h1 - h0, da: a1 - a0, k2, back, log: F.log.slice(-3) }; })();`);
  const S2 = JSON.parse(RB('JSON.stringify(S2)'));
  t('9 U from the drone: back in the tank (unparked, chase view, its own scale); the drone holds (±1 m over 5 s); U again: the drone', S2.k1 && S2.inTank && S2.fpv1 === false && S2.sc1 === 12 && S2.mode1 === 'hold'
    && Math.abs(S2.dh) <= 1 && Math.abs(S2.da) <= 1 && S2.k2 && S2.back, S2);
  RB(`var D3 = (() => { const { F, C, d } = launched(); go(F, 1); putAt(d, 300, 25); d.dl.hold = null; go(F, 0.5);
    Drone.home(F, d); let t = null; go(F, 45, () => { if (t == null && !F.vessels.includes(d)) { t = F.time; return false; } });
    return { t: t == null ? null : t - 1.5 - 1.5 - 0.5, docked: bayOf(C).docked, left: Drone.left(C), active: F.active === C, dead: d.dead, cdr: C.drone ? C.drone.name : null, log: F.log.slice(-2) }; })();`);
  const D3 = JSON.parse(RB('JSON.stringify(D3)'));
  t('9 Home (3) from 300 m: it climbs, flies back, lets down over the bay and docks within 40 s; 3 left again; control back in the tank; "Bumble FPV docked · ×3"',
    D3.t != null && D3.t <= 40 && D3.docked === 3 && D3.left === 3 && D3.active && D3.dead && D3.cdr == null && D3.log.includes('Bumble FPV docked · ×3'), D3);
  RB(`var D4 = (() => { const { F, C, d } = launched(); go(F, 2); const n = Drone.left(C), k = Drone.key(F); return { n, k, after: Drone.left(C), active: F.active === C, gone: !F.vessels.includes(d) }; })();
  var D4b = (() => { const { F, C, d } = launched(); go(F, 1); putAt(d, 20, 15); go(F, 1); const k = Drone.key(F); return { k, inTank: F.active === C, still: F.vessels.includes(d) && !d.dead, n: Drone.left(C) }; })();`);
  const D4 = JSON.parse(RB('JSON.stringify(D4)')), D4b = JSON.parse(RB('JSON.stringify(D4b)'));
  t('9 U within 3 m of its bay docks at once (2 → 3); 20 m off, U goes back to the tank and the drone stays up', D4.k && D4.n === 2 && D4.after === 3 && D4.active && D4.gone && D4b.k && D4b.inTank && D4b.still && D4b.n === 2, { D4, D4b });
  // losing it
  RB(`var X1 = (() => { const { F, C, d } = launched(); go(F, 2); const foe = enemy(); const fc = d.dr.fcPart; Combat.damage(d, fc, 1e6, 'shot', F, foe);
    const o = { active: F.active === C, destroyed: F.destroyed, deaths: F.deaths, ends: F.ends, cdr: C.drone ? C.drone.name : null, hulk: d.hulk != null, toast: F.log.slice(-1)[0], fpv: F.fpv, sc: F.scale };
    go(F, 6); o.ends2 = F.ends; o.still = F.active === C && !F.destroyed; o.left = Drone.left(C); return o; })();`);
  const X1 = JSON.parse(RB('JSON.stringify(X1)'));
  t('9 the flown drone shot down (its controller knocked out): control is back in the tank in the same frame, no end screen, not destroyed; "Drone lost: back in the Test Nest"; its bay doesn\'t get it back',
    X1.active && !X1.destroyed && X1.ends === 0 && X1.ends2 === 0 && X1.still && X1.cdr == null && X1.hulk && X1.toast === 'Drone lost: back in the Test Nest' && X1.fpv === false && X1.sc === 12 && X1.left === 2, X1);
  RB(`var X2 = (() => { const { F, C, d } = launched(); go(F, 2); for (const p of d.dr.cells) p.fuel = 0; go(F, 0.2);
    const o = { active: F.active === C, destroyed: F.destroyed, ends: F.ends, cdr: C.drone ? C.drone.name : null, log: F.log.slice(-3) }; go(F, 30); o.gone = d.dead || !F.vessels.includes(d); return o; })();`);
  const X2 = JSON.parse(RB('JSON.stringify(X2)'));
  t('9 the battery flat: the same (control back at once, "Battery flat: back in the Test Nest"); the drone falls, and is gone 3 s after it lands', X2.active && !X2.destroyed && X2.ends === 0 && X2.cdr == null && X2.log.includes('Battery flat: back in the Test Nest') && X2.gone, X2);
  RB(`var X3 = (() => { const { F, C, d } = launched(); go(F, 2); putAt(d, 3000, 400); let lostAt = null, back = null;
    go(F, 8, () => { if (lostAt == null && d.dl.lost) lostAt = F.time; if (back == null && F.active === C) back = F.time; });
    return { lostAt: lostAt != null, after: back != null && lostAt != null ? back - lostAt : null, cdr: C.drone === d, log: F.log.filter((m) => /link/i.test(m)), fall: d.throttle }; })();`);
  const X3 = JSON.parse(RB('JSON.stringify(X3)'));
  t('9 the link lost 5 s (3 km out on a 2.5 km radio): handed back to the tank ("Lost the drone\'s link: back in the Test Nest"); the drone stays the tank\'s (an FPV controller lets it fall)',
    X3.lostAt && X3.after != null && X3.after >= 4.9 && X3.after <= 5.5 && X3.cdr && X3.log.includes('Lost the drone\'s link: back in the Test Nest') && X3.fall === 0, X3);
  // LAST FLIGHT
  RB(`var LF = (() => { const F = world(); GroundAI.startBattle(F, { money: 120000, design: nest(), seed: 3 }); const C = F.active; go(F, 1.5); Drone.key(F); const d = F.active; go(F, 1);
    const B = GroundAI.battle, tk0 = B.obj.tk[B.team], lost0 = B.lost; Armour.knockOut(C, F, 'crew'); go(F, 0.1);
    const o = { lf: F.carrierDown === C, active: F.active === d, tk: tk0 - B.obj.tk[B.team], lost: B.lost - lost0, booked: B.booked === C, wreck: !!C.wreck, deaths0: F.deaths, end: d.dl.lastEnd - F.time,
      alert: Drone.alertText(F) };
    go(F, 19.5); o.mid = F.active === d && F.carrierDown === C && F.deaths === 0; go(F, 1);
    o.after = F.active === C; o.deaths = F.deaths; o.destroyed = F.destroyed; o.tk2 = tk0 - B.obj.tk[B.team]; o.booked2 = B.booked; o.ends = F.ends; return o; })();`);
  const LF = JSON.parse(RB('JSON.stringify(LF)'));
  t('9 the Nest knocked out under its flown drone (a Practice Battle): a LAST FLIGHT of 20 s, the tickets and the wreck booked at once, "Your tank is knocked out! Last flight: 20 s"',
    LF.lf && LF.active && LF.tk > 0 && LF.lost === 1 && LF.booked && LF.wreck && LF.deaths0 === 0 && Math.abs(LF.end - 19.9) < 0.15 && LF.alert === 'Your tank is knocked out! Last flight: 20 s', LF);
  t('...then the tank\'s end, exactly once (onDestroyed: the tickets not taken again, the booking used)', LF.mid && LF.after && LF.deaths === 1 && LF.destroyed && LF.tk2 === LF.tk && LF.booked2 == null, LF);
  RB(`var LU = (() => { const { F, C, d } = launched(); go(F, 1); Armour.knockOut(C, F, 'crew'); go(F, 0.2); const lf = F.carrierDown === C; const k = Drone.key(F);
    return { lf, k, active: F.active === C, deaths: F.deaths, destroyed: F.destroyed, ends: F.ends }; })();`);
  const LU = JSON.parse(RB('JSON.stringify(LU)'));
  t('...U ends it early: the tank\'s death at once (solo: the end screen\'s timer)', LU.lf && LU.k && LU.active && LU.deaths === 1 && LU.destroyed && LU.ends === 1, LU);
  RB(`var LD = (() => { const { F, C, d } = launched(); go(F, 1); Armour.knockOut(C, F, 'crew'); go(F, 0.2); const foe = enemy();
    Combat.damage(d, d.dr.fcPart, 1e6, 'shot', F, foe); return { active: F.active === C, deaths: F.deaths, destroyed: F.destroyed, ends: F.ends, said: F.log.filter((m) => /Drone lost/.test(m)).length }; })();`);
  const LD = JSON.parse(RB('JSON.stringify(LD)'));
  t('...the drone shot down in its LAST FLIGHT ends it too (the tank\'s death once, no "Drone lost")', LD.active && LD.deaths === 1 && LD.destroyed && LD.ends === 1 && LD.said === 0, LD);
  // refusals
  RB(`var RF = (() => { const out = {}, F = world(), C = F.start(nest()); go(F, 1.5); const try1 = (k, f, undo) => { f(); const n = F.vessels.length, ok = Drone.launch(F, C); out[k] = [ok, F.vessels.length - n, F.log.slice(-1)[0], Drone.left(C)]; undo(); };
    const v0 = { x: C.vx, y: C.vy, z: C.vz }, f = C.axis(1, 0, 0);
    try1('moving', () => { C.vx += f.x * 4; C.vy += f.y * 4; C.vz += f.z * 4; }, () => { C.vx = v0.x; C.vy = v0.y; C.vz = v0.z; });
    try1('empty', () => { bayOf(C).docked = 0; }, () => { bayOf(C).docked = null; });
    try1('broken', () => { bayOf(C).broken = true; }, () => { bayOf(C).broken = undefined; });
    try1('flat', () => { App.flat = true; }, () => { App.flat = false; });
    try1('room', () => { F.mp = { mode: 'sandbox' }; this.MP = { extra: new Map([[1, { v: { dead: false } }]]) }; }, () => { F.mp = null; delete this.MP; });
    try1('water', () => { C.splashed = true; }, () => { C.splashed = false; });
    return out; })();`);
  const RF = JSON.parse(RB('JSON.stringify(RF)'));
  const no = (k, msg) => RF[k] && RF[k][0] === false && RF[k][1] === 0 && RF[k][2] === msg && RF[k][3] === (k === 'empty' ? 0 : 3);
  t('9 launches refused, each saying why and changing nothing: moving 4 m/s, the rack empty, broken, the 2D view, a drone already up in a room, in the water',
    no('moving', 'Stop to launch') && no('empty', 'The rack is empty') && no('broken', 'The rack is broken: wait for the crew') && no('flat', 'Drones need the 3D view') && no('room', 'One drone at a time in a room') && no('water', 'Not in the water'), RF);
  // a save with the drone up
  RB(`var SV = (() => { const { F, C, d } = launched(); go(F, 2); const data = JSON.parse(JSON.stringify(F.serialize()));
    const back = data.vessels.map((x) => Vessel.restore(x)), T = back[data.active], bay = T && T.docks[0];
    const live = { docked: bayOf(C).docked };
    const F2 = world(); F2.resetState = function (vs, a, t) { this.vessels = vs; this.active = a; this.time = t; }; this.$ = () => ({ hidden: false }); let ok = true;
    try { F2.restore(data); } catch (e) { ok = String(e); } delete this.$;
    return { n: data.vessels.length, kinds: data.vessels.map((x) => x.kind), active: data.active, docked: bay && bay.docked, left: T && Drone.left(T), live, rescale: data.scale, ok, a2: F2.active && F2.active.kind, ch: F2.active && F2.active.droneChoice }; })();`);
  const SV = JSON.parse(RB('JSON.stringify(SV)'));
  t('9 a save with the drone up: the tank alone, the craft flown, its bay full again (3) in the save and still 2 aboard; it restores with the tank active', SV.n === 1 && SV.kinds[0] === 'tank' && SV.active === 0 && SV.docked === 3 && SV.left === 3 && SV.live.docked === 2 && SV.rescale === 12 && SV.ok === true && SV.a2 === 'tank' && SV.ch == null, SV);
  // a stored choice that doesn't fit
  RB(`var CH = (() => { const F = world(), d0 = nest(); d0.drone = { key: 'mavik' }; const C = F.start(d0); go(F, 1.5); Drone.key(F); const a = F.active; const l1 = F.log.slice(-2);
    Drone.key(F); go(F, 0.5); Drone.key(F); go(F, 0.1); return { name: a.name, said: l1, again: F.log.filter((m) => /doesn't fit/.test(m)).length, choice: C.droneChoice }; })();`);
  const CH = JSON.parse(RB('JSON.stringify(CH)'));
  t('9 a stored drone that doesn\'t fit the rack (the Mavik Scout, $3,190 of $3,000): the rack\'s stock Bumble FPV goes up, said once', CH.name === 'Bumble FPV' && CH.said.includes('The Mavik Scout doesn\'t fit a Drone Rack: launching a Bumble FPV') && CH.again === 1, CH);
  // the rest of flight.js's share
  RB(`var FL = (() => { const { F, C, d } = launched(); go(F, 1);
    const rec = Flight.canRecover.call(F), near = Flight.stepsNear.call(F, C, 9000), farOld = Flight.stepsNear.call(F, mk(designOf('tk34')), 9000);
    F.switchTo(C, true, true); go(F, 3); const rec2 = Flight.canRecover.call(F);
    const cyc = (() => { const n = F.vessels.filter((v) => v.control && !v.dead && !v.ai && !v.remote && !v.carrier).length; return n; })();
    F.switchTo(d, true, true); Flight.cycleVessel.call(F, 1); const cy = F.active === C;
    return { rec, near, farOld, rec2, cyc, cy, by: Combat.byMe(d, F), byOld: Combat.byMe({}, F) }; })();`);
  const FL = JSON.parse(RB('JSON.stringify(FL)'));
  t('9 a tank can\'t be recovered with its drone up (nor the drone); a parked tank 9 km from its flown drone is still stepped (plan I14), an old one isn\'t; from the drone, Tab is U',
    FL.rec === false && FL.rec2 === false && FL.near === true && FL.farOld === false && FL.cyc === 1 && FL.cy, FL);
  t('...kill credit through the drone: Combat.byMe(drone) while the tank is flown (plan I3), not for a craft with no carrier', FL.by === true && FL.byOld === false, FL);
  RB(`var AL = (() => { const { F, C, d } = launched(); go(F, 1); const foe = enemy();
    const hull = C.parts.find((p) => p.def.control); Combat.damage(C, hull, 1, 'shot', F, foe); const a = Drone.alertText(F), h = Drone.hud.hitAt; go(F, 3.2); const b = Drone.alertText(F); return { a, h, b }; })();`);
  const AL = JSON.parse(RB('JSON.stringify(AL)'));
  t('9 the parked tank hit while its drone flies: "YOUR TANK IS HIT · U: back" on the alert line for 3 s', AL.a === 'YOUR TANK IS HIT · U: back' && AL.b == null, AL);
  // plan I13: who removes a drone. A live one nobody has any more (its link lost, landed) is the bays' clean-up (Drone.frame);
  // a hulk is death.js's alone (Drone.frame never touches it), and its tank hears of it
  RB(`var I13 = (() => { const { F, C, d } = launched(); go(F, 1); F.switchTo(C, true, true); go(F, 0.5);
    const hulk = mk(designOf('tk34')); // (stand-ins: a landed drone, lost, nobody's; and the same as a hulk)
    const live = Drone.build(rowsOf('bumble'), 'Live'), dead = Drone.build(rowsOf('bumble'), 'Hulk');
    for (const v of [live, dead]) { v.placeOnSurface(EARTH, siteAngle(EARTH, NPAD.e + 50), 0, NPAD.z); v.landed = true; v.dl = { t: 0, at0: { x: v.x * 1.01, y: v.y * 1.01, z: v.z }, t0: 0, lost: true, lostT: 1, mode: 'pilot' }; F.vessels.push(v); }
    dead.hulk = 0; dead.down = true;
    let goneAt = null; for (let i = 0; i < 300; i++) { F.time += 1 / 60; Drone.frame(F, 1 / 60); if (goneAt == null && live.dead) goneAt = i / 60; }
    d.hulk = 0; d.down = true; Drone.frame(F, 1 / 60);
    // a GPS drone homing to a tank knocked out meanwhile: it lets down by the wreck, never docks in it
    const gps = rowsOf('bumble').map((r) => (r.type === 'drFC' ? { ...r, type: 'drFCgps' } : r));
    const { F: F4, C: C4, d: d4 } = launched({ drone: { name: 'GPS Bumble', parts: gps } }); go(F4, 1); putAt(d4, 40, 20); d4.dl.hold = null; F4.switchTo(C4, true, true); C4.ko = { why: 'crew', x: false, t: 0 }; d4.dl.mode = 'home';
    go(F4, 25); const wreckDock = d4.name !== 'GPS Bumble' || !d4.dl.lost || Drone.left(C4) === 3 || F4.log.some((m) => /docked/.test(m));
    return { goneAt, hulk: !dead.dead, cdr: C.drone ? C.drone.name : null, log: F.log.slice(-1)[0], wreckDock }; })();`);
  const I13 = JSON.parse(RB('JSON.stringify(I13)'));
  t('I13 a live drone nobody has, its link lost and landed, is gone after 3 s (Drone.frame); a hulk never by Drone.frame; a tank whose unflown drone is shot down hears "The Bumble FPV was shot down"; nothing docks in a knocked-out tank',
    I13.goneAt != null && I13.goneAt >= 2.9 && I13.goneAt <= 3.2 && I13.hulk && I13.cdr == null && I13.log === 'The Bumble FPV was shot down' && !I13.wreckDock, I13);

  // ---------------------------------------------------------------- 7. warheads and the fuse (the Bumble flown into parked vehicles)
  RB(`var kit = (key, extra, name) => { const d = designOf(key); d.name = name || ('Kit ' + key); d.parts = d.parts.concat(extra || []); return d; };
  // the drone flown (F.active) from the pad, its motors on, sitting; a vessel from a design parked e m east of the pad
  var pilot = (rows, name) => { const F = world(), v = F.start({ name: name || 'Bumble FPV', kind: 'drone', parts: rows || rowsOf('bumble') });
    for (const p of v.parts) if (p.def.thrust) p.active = true; v.stageIdx = v.stages.length; v.sas = 'hold'; v.throttle = 0; v.dl = { t: 0, at0: { x: v.x, y: v.y, z: v.z }, t0: 0 };
    return { F, v }; };
  var park = (F, design, e) => { const o = mk(design, { e: NPAD.e + e, z: NPAD.z }); F.vessels.push(o); return o; };
  var partOf = (o, f) => o.parts.find(f);
  var topOf2 = (o, p) => { const R = partRect(p); return o.toWorld((R.l + R.r) / 2, R.t, partZc(p)); };
  // throw the drone from P (sim) along unit dir at sp m/s, falling free (Acro, idle), its fuse looking from here
  var fling = (v, P, dir, sp) => { v.x = P.x; v.y = P.y; v.z = P.z; v.vx = dir.x * sp; v.vy = dir.y * sp; v.vz = dir.z * sp; v.av.x = v.av.y = v.av.z = 0;
    v.sas = 'acro'; v.throttle = 0; v.landed = false; v.contactTime = 0; v.restTime = 0; if (v.dl) { v.dl.prev = null; v.dl.sp = 0; } };
  var arm = (v) => { v.dl.armOK = true; v.dl.t0 = -10; };
  var add3 = (a, b, k) => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
  var crewHp = (o) => Armour.crewOf(o).crew.reduce((s, e) => s + (e.i >= 0 ? (e.host.mods && e.host.mods[e.i] != null ? e.host.mods[e.i] : e.host.def.mods[e.i].hp || 100) : e.part.hp == null ? Combat.maxHp(e.part.def) : e.part.hp), 0);
  var hpOf = (o) => o.parts.reduce((s, p) => s + (p.hp == null ? Combat.maxHp(p.def) : p.hp), 0);
  // a dive from h m over the top of part p of o (straight down, sp m/s): what the warhead did (Armour.fb.shot, the drone gone)
  // the hull's top over its engine (the engine deck), as an offset from the hull's top middle
  var deckOff = (C) => { const hull = C.parts[0], eng = C.parts.find((p) => p.def.module === 'engine'), T = topOf2(C, hull), E = C.toWorld(eng.x, eng.y, partZc(eng)), U = up(C), dx = E.x - T.x, dy = E.y - T.y, dz = E.z - T.z, k = dx * U.x + dy * U.y + dz * U.z; return { x: dx - U.x * k, y: dy - U.y * k, z: dz - U.z * k }; };
  var dive = (F, v, o, p, h, sp, off) => { const T = topOf2(o, p), U = up(o), P = add3(off ? add3(T, off, 1) : T, U, h); arm(v); Armour.fb.shot = null;
    fling(v, P, { x: -U.x, y: -U.y, z: -U.z }, sp); go(F, Math.max(0.2, (h / sp) * 2 + 0.1), () => !v.dead && F.active === v ? undefined : false); return { shot: Armour.fb.shot, dead: v.dead, boom: !!(v.dl && v.dl.boom) }; };`);
  RB(`var W7 = (() => { const out = {};
    // the TK-34's engine deck, a dive at 30 m/s
    { const { F, v } = pilot(); const C = park(F, designOf('tk34'), 30); go(F, 1); const eng = partOf(C, (p) => p.def.module === 'engine'), hull = C.parts[0], e0 = hpOf(C);
      const R = dive(F, v, C, hull, 6, 30, deckOff(C));
      out.deck = { r: R.shot && R.shot.r, what: R.shot && R.shot.what, boom: R.boom, dead: R.dead, eng: eng.hp != null && eng.hp < Combat.maxHp(eng.def), lost: Math.round(e0 - hpOf(C)), log: F.log.slice(-2) }; }
    // the MA-1's front, level at 25 m/s
    { const { F, v } = pilot(); const C = park(F, designOf('ma1'), 40); go(F, 1); const U = up(C), f = C.axis(1, 0, 0), c0 = crewHp(C);
      const P = add3(add3({ x: C.x, y: C.y, z: C.z }, f, (C.reach || 5) + 8), U, 0.6); arm(v); Armour.fb.shot = null;
      fling(v, P, { x: -f.x, y: -f.y, z: -f.z }, 25); go(F, 0.8, () => (v.dead ? false : undefined));
      out.front = { r: Armour.fb.shot && Armour.fb.shot.r, boom: !!v.dl.boom, crew: Math.round(c0 - crewHp(C)) }; }
    // 40 dives into a roof cage over an MA-1's turret: plain shaped charges, then tandem
    const caged = () => { const T = PARTS.turretWedge; return kit('ma1', [{ type: 'cdCage', x: -0.3, y: 2.495 + T.h / 2 + 0.375 + 0.01, rot: 0, flip: false, att: 5 }], 'Caged MA-1'); };
    for (const [key, rows] of [['plain', rowsOf('bumble')], ['tandem', rowsOf('bumble').map((r) => (r.type === 'drCharge' ? { ...r, type: 'drChargeT' } : r))]]) {
      let crushed = 0, n = 0, met = 0;
      for (let i = 0; i < 40; i++) {
        const { F, v } = pilot(rows); const C = park(F, caged(), 40); go(F, 0.5); const cg = partOf(C, (p) => p.def.cage);
        const s = (i * 0.61803) % 1, t = (i * 0.41421) % 1, R = dive(F, v, C, cg, 3, 30, (() => { const a = C.axis(1, 0, 0), b = C.axis(0, 0, 1); return { x: a.x * (s - 0.5) * 2 + b.x * (t - 0.5) * 2, y: a.y * (s - 0.5) * 2 + b.y * (t - 0.5) * 2, z: a.z * (s - 0.5) * 2 + b.z * (t - 0.5) * 2 }; })());
        if (R.shot) { n++; if (R.shot.what.includes('SLAT')) crushed++; } if (R.boom) met++;
      }
      out[key] = { crushed, n, met };
    }
    // a frag charge on the ZSY-23's open top
    { const { F, v } = pilot(rowsOf('bumble').map((r) => (r.type === 'drCharge' ? { ...r, type: 'drChargeHE' } : r))); const C = park(F, designOf('zsy23'), 30); go(F, 1);
      const c0 = crewHp(C), R = dive(F, v, C, partOf(C, (p) => p.def.ring), 4, 25); out.frag = { boom: R.boom, crew: Math.round(c0 - crewHp(C)) }; }
    return out; })();`);
  const W7 = JSON.parse(RB('JSON.stringify(W7)'));
  t('7 a Bumble diving at 30 m/s onto the TK-34\'s engine deck: its shaped charge goes through, into the engine', W7.deck.boom && W7.deck.dead && W7.deck.r === 'pen' && W7.deck.what.includes('ENGINE'), W7.deck);
  t('7 ...level at 25 m/s into the MA-1\'s front: it goes off, and doesn\'t get through (no crew hurt)', W7.front.boom && W7.front.r !== 'pen' && W7.front.crew === 0, W7.front);
  t('7 40 dives into a roof cage over an MA-1\'s turret: 35-65 % of the plain shaped charges crushed, no tandem charge', W7.plain.met === 40 && W7.plain.n === 40 && W7.plain.crushed >= 14 && W7.plain.crushed <= 26 && W7.tandem.met === 40 && W7.tandem.crushed === 0, [W7.plain, W7.tandem]);
  t('7 a frag charge bursting on the ZSY-23\'s open top hurts its crew', W7.frag.boom && W7.frag.crew > 0, W7.frag);

  RB(`var W7b = (() => { const out = {};
    // grenades dropped from 6 m onto a Light Hull's deck, a Heavy Box's and a caged MA-1's turret roof
    const drop = (design, pick) => { const { F, v } = pilot(rowsOf('bumble').filter((r) => r.type !== 'drCharge').concat([{ type: 'drGrenade', x: 0, y: -0.075, rot: 0, flip: false, att: 0 }]), 'Dropper'); const C = park(F, design, 30); go(F, 1);
      const T = pick(C), U = up(C), P = add3(T, U, 6); fling(v, P, { x: 0, y: 0, z: 0 }, 0); v.sas = 'hold'; v.dl.hold = null; v.dl.mode = 'pilot';
      const h0 = new Map(C.parts.map((q) => [q, q.hp == null ? Combat.maxHp(q.def) : q.hp])), c0 = crewHp(C), m0 = JSON.stringify(C.parts.map((q) => q.mods || null));
      const g = partOf(v, (q) => q.def.weapon && q.def.weapon.kind === 'bomb'); Combat._t.dropBomb(v, g, F);
      go(F, 1.6); const hit = C.parts.filter((q) => (q.hp == null ? Combat.maxHp(q.def) : q.hp) < h0.get(q)).map((q) => q.type);
      return { hit, crew: Math.round(c0 - crewHp(C)), mods: m0 !== JSON.stringify(C.parts.map((q) => q.mods || null)), broken: C.parts.filter((q) => q.broken).map((q) => q.type) }; };
    const deck = (C) => add3(topOf2(C, C.parts[0]), deckOff(C), 1);
    out.light = drop(designOf('ms18'), deck);
    out.heavy = drop(designOf('tygr'), deck);
    const T = PARTS.turretWedge;
    out.bare = drop(designOf('ma1'), (C) => topOf2(C, C.parts[5]));
    out.cage = drop(kit('ma1', [{ type: 'cdCage', x: -0.3, y: 2.495 + T.h / 2 + 0.375 + 0.01, rot: 0, flip: false, att: 5 }]), (C) => topOf2(C, C.parts.find((p) => p.def.cage)));
    // a manual detonation 30 m up: a TK-34 below it takes nothing; SAFE, FIRE says so
    { const { F, v } = pilot(); const C = park(F, designOf('tk34'), 0.1); go(F, 1); const h0 = hpOf(C);
      Drone.detonate(v, F, null, null, null, 'fire'); const safe = F.log.slice(-1)[0];
      const U = up(C); fling(v, add3({ x: C.x, y: C.y, z: C.z }, U, 30), { x: 0, y: 0, z: 0 }, 0); arm(v); go(F, 0.05); v.vx = v.vy = v.vz = 0;
      F.firing = true; F.fireTap = true; Combat.S.wasFiring = false; v.wsel = Combat.systems(v).findIndex((s) => s.w.kind === 'warhead'); Combat._t.playerFrame(F, 1 / 60); F.firing = false;
      out.fire = { safe, dead: v.dead, lost: hpOf(C) < h0, impact: !!F.impactCam, ends: F.deaths }; }
    // a warhead shot to 0 hp: it bursts as high explosive (no jet), and the drone is gone
    { const { F, v } = pilot(); const C = park(F, designOf('tk34'), 0.1); go(F, 1); const foe = enemy(); F.vessels.push(foe);
      const U = up(C); fling(v, add3({ x: C.x, y: C.y, z: C.z }, U, 6), { x: 0, y: 0, z: 0 }, 0); v.vx = v.vy = v.vz = 0; go(F, 0.05);
      let jets = 0, blasts = []; const lh = Armour.legacyHit, ex = Combat.explode; Armour.legacyHit = function (...a) { jets++; return lh.apply(this, a); }; Combat.explode = function (...a) { blasts.push([a[2], a[3], a[7]]); return ex.apply(this, a); };
      try { Combat.damage(v, partOf(v, (p) => p.def.drone && p.def.drone.warhead), 1e6, 'shot', F, foe); } finally { Armour.legacyHit = lh; Combat.explode = ex; }
      out.cook = { dead: v.dead, jets, blasts, deaths: F.deaths }; }
    return out; })();`);
  const W7b = JSON.parse(RB('JSON.stringify(W7b)'));
  const inside = (r) => r.crew > 0 || r.mods || r.broken.length > 0; // (its blast through the roof: a crewman, a module or a part inside)
  t('7 a grenade dropped on a Light Hull\'s deck beats its roof (something inside hurt)', inside(W7b.light), W7b.light);
  t('7 ...on a Heavy Box\'s roof it doesn\'t; on the MA-1\'s turret roof it hurts the crew, on a roof cage over it (bursting on the cage) it doesn\'t', !inside(W7b.heavy) && W7b.bare.crew > 0 && W7b.cage.crew === 0, [W7b.heavy, W7b.bare, W7b.cage]);
  t('7 FIRE before it is armed: "Not armed yet: fly 20 m clear"; armed, 30 m over a TK-34: it bursts there, the impact view, and the tank below takes nothing',
    W7b.fire.safe === 'Not armed yet: fly 20 m clear' && W7b.fire.dead && !W7b.fire.lost && W7b.fire.impact, W7b.fire);
  t('7 a warhead shot to 0 hp bursts as high explosive (0.6 of its damage, no jet) and the drone is gone', W7b.cook.dead && W7b.cook.jets === 0 && W7b.cook.blasts.length === 1 && W7b.cook.blasts[0][0] === 3 && W7b.cook.blasts[0][1] === 300 && W7b.cook.blasts[0][2] === 10, W7b.cook);

  // safe-arm
  RB(`var SA = (() => { const out = {};
    // from the Nest: out 30 m for 3 s (armed), then flown back into its own tank's hull at 10 m/s
    { const { F, C, d } = launched(); go(F, 0.6); putAt(d, 30, 15); go(F, 3); const armed = !!d.dl.arm; const hull = C.parts[0], T = topOf2(C, hull), U = up(C);
      fling(d, add3(T, U, 3), { x: -U.x, y: -U.y, z: -U.z }, 10); go(F, 1); out.own = { armed, boom: !!d.dl.boom }; }
    // from the pad: dropped onto a TK-34 5 m away within 1 s (safe), and 20 m out after 2 s (armed)
    const onto = (e, wait) => { const { F, v } = pilot(); const C = park(F, designOf('tk34'), e); go(F, wait); const T = topOf2(C, C.parts[0]), U = up(C);
      fling(v, add3(T, U, 3), { x: -U.x, y: -U.y, z: -U.z }, 8); go(F, 0.8); return { t0: +v.dl.t.toFixed(2), boom: !!v.dl.boom }; };
    out.near = onto(5, 0.5); out.far = onto(20, 2.2);
    // open ground: let down at 3 m/s (none), crashing at 6 m/s (it goes off)
    const land = (sp) => { const { F, v } = pilot(); go(F, 0.2); const U = up(v); arm(v); fling(v, add3({ x: v.x, y: v.y, z: v.z }, U, 0.2), { x: -U.x, y: -U.y, z: -U.z }, sp); go(F, 1.2); return { boom: !!v.dl.boom, dead: v.dead }; };
    out.soft = land(3); out.hard = land(6);
    return out; })();`);
  const SA = JSON.parse(RB('JSON.stringify(SA)'));
  t('7 safe-arm: a Bumble from the Nest, armed, flown into its own tank at 10 m/s never goes off', SA.own.armed && !SA.own.boom, SA.own);
  t('7 ...from the pad, dropped onto a TK-34 5 m off within 1 s: safe, no burst; 20 m off after 2 s: armed, it bursts', !SA.near.boom && SA.far.boom, [SA.near, SA.far]);
  t('7 ...armed, let down on open ground at 3 m/s: nothing; crashing at 6 m/s: it goes off', !SA.soft.boom && !SA.soft.dead && SA.hard.boom, [SA.soft, SA.hard]);

  // a bay drone's warhead on an enemy tank: back in the carrier at once (no end screen), the kill credit the player's;
  // a jammed FPV falls with its fuse live and bursts where it lands; one shot down (its controller out) is debris and
  // doesn't; a drone's crash is a fireball with a warhead aboard, else a thud (plan I5)
  RB(`var W7c = (() => { const out = {};
    { const { F, C, d } = launched(); go(F, 0.6); putAt(d, 40, 15); go(F, 2.5); const foe = enemy(); F.vessels.push(foe); go(F, 0.5);
      const T = topOf2(foe, foe.parts[0]), U = up(foe); fling(d, add3(add3(T, deckOff(foe), 1), U, 4), { x: -U.x, y: -U.y, z: -U.z }, 25); go(F, 0.6);
      out.bay = { boom: !!d.dl.boom, back: F.active === C, deaths: F.deaths, destroyed: F.destroyed, hit: foe.lastHitBy === d, mine: Combat.byMe(foe.lastHitBy, F), fpv: !!F.fpv }; }
    const fall = (how) => { const { F, v } = pilot(); go(F, 0.2); const U = up(v); fling(v, add3({ x: v.x, y: v.y, z: v.z }, U, 30), { x: 0, y: 0, z: 0 }, 0); arm(v); v.sas = 'hold'; v.dl.hold = null; go(F, 0.1);
      const kinds = [], d0 = FX.death; FX.death = function (b, p, vel, size, kind, ...r) { kinds.push(kind); return d0.call(this, b, p, vel, size, kind, ...r); };
      try { how(F, v); go(F, 4); } finally { FX.death = d0; }
      return { boom: !!v.dl.boom, dead: v.dead, debris: !!v.isDebris, kinds }; };
    out.jam = fall((F, v) => { const J = mk(kit('ms4', [{ type: 'cdJam', x: -1.6, y: 2.0, rot: 0, flip: false, att: 0 }]), { e: NPAD.e + 60, z: NPAD.z }); J.ai = { ground: true, team: 1 }; F.vessels.push(J); });
    out.shot = fall((F, v) => { const foe = enemy(); F.vessels.push(foe); Combat.damage(v, v.dr.fcPart, 1e6, 'shot', F, foe); });
    { const { F, v } = pilot(rowsOf('mavik'), 'Mavik Scout'); go(F, 0.2); const U = up(v); fling(v, add3({ x: v.x, y: v.y, z: v.z }, U, 30), { x: 0, y: 0, z: 0 }, 0); v.sas = 'hold'; v.dl.hold = null; go(F, 0.1);
      const kinds = [], d0 = FX.death; FX.death = function (b, p, vel, size, kind, ...r) { kinds.push(kind); return d0.call(this, b, p, vel, size, kind, ...r); };
      try { const foe = enemy(); F.vessels.push(foe); Combat.damage(v, v.dr.fcPart, 1e6, 'shot', F, foe); go(F, 4); } finally { FX.death = d0; }
      out.cold = { dead: v.dead, kinds }; }
    return out; })();`);
  const W7c = JSON.parse(RB('JSON.stringify(W7c)'));
  t('7 a drone from a bay bursting on an enemy MS-4: back in its tank at once (no end screen), the hit the drone\'s and the credit the player\'s (plan I3)', W7c.bay.boom && W7c.bay.back && W7c.bay.deaths === 0 && !W7c.bay.destroyed && W7c.bay.hit && W7c.bay.mine, W7c.bay);
  t('7 a jammed FPV (its link lost: it drops) keeps its fuse and bursts where it lands; one shot down (its controller out) is debris and lands without going off (plan I5)', W7c.jam.boom && W7c.jam.dead && !W7c.shot.boom && W7c.shot.debris && W7c.shot.dead, [W7c.jam, W7c.shot]);
  t('7 a drone\'s crash: a fireball with a live warhead aboard, a thud without (the Mavik Scout)', W7c.shot.kinds.includes('crash') && W7c.cold.dead && W7c.cold.kinds.length > 0 && W7c.cold.kinds.every((k) => k === 'thud'), [W7c.shot.kinds, W7c.cold]);

  // ---------------------------------------------------------------- 10. counter-drone
  RB(`var hostile = (F, k, de, h, rows) => { const b = Drone.build(rows || rowsOf(k), 'Foe ' + k); b.placeOnSurface(EARTH, siteAngle(EARTH, NPAD.e), 0, NPAD.z); putAt(b, de, h);
    for (const p of b.parts) if (p.def.thrust) p.active = true; b.stageIdx = b.stages.length; b.sas = 'hold'; b.throttle = 0.5;
    b.ai = { drone: true, ground: false, team: 1, ally: false }; b.dl = { t: 0, at0: { x: b.x, y: b.y, z: b.z }, t0: 0 }; F.vessels.push(b); return b; };
  var gunTank = (more) => kit('tk34', [{ type: 'cdGun', x: -1.6, y: 1.95, rot: 0, flip: false, att: 0 }].concat(more || []), 'Gun tank');
  var DET = { type: 'cdDetect', x: -2.4, y: 2.0, rot: 0, flip: false, att: 0 }, RAD = { type: 'cdRadar', x: -2.4, y: 2.06, rot: 0, flip: false, att: 0 };
  var downed = (b) => b.dead || b.down || !b.control || b.isDebris;
  // secs of play with a counter-drone tank (the player's) and a hostile drone de m east, h up: when it went down, rounds fired
  var engage = (design, de, h, secs, rows, setup) => { const F = world(), C = F.start(design); go(F, 1); const b = hostile(F, 'bumble', de, h, rows); if (setup) setup(F, C, b);
    const g = C.cuas.find((p) => p.def.cuas.gun || p.def.cuas.laser); const a0 = g.ammo; let at = null, on = null;
    go(F, secs, (F) => { if (on == null && g.gunOn) on = F.time; if (at == null && downed(b)) { at = F.time; return false; } });
    return { at: at == null ? null : +(at - 1).toFixed(2), on: on == null ? null : +(on - 1).toFixed(2), fired: a0 - g.ammo, F, C, b, g }; };`);
  RB(`var W10 = (() => { const out = {}, pick = (r) => ({ at: r.at, on: r.on, fired: r.fired });
    out.g500 = pick(engage(gunTank(), 500, 30, 6));
    out.g700 = pick(engage(gunTank(), 700, 30, 6));
    out.g1000 = pick(engage(gunTank([DET]), 1000, 40, 10));
    out.fib = pick(engage(gunTank([DET]), 1000, 40, 6, rowsOf('bumbleF')));
    out.fibR = pick(engage(gunTank([RAD]), 1000, 40, 10, rowsOf('bumbleF')));
    // ground vehicles: an enemy MS-4 300 m off draws nothing
    { const F = world(), C = F.start(gunTank()); go(F, 1); F.vessels.push(enemy()); const g = C.cuas[0], a0 = g.ammo; go(F, 4); out.ground = { fired: a0 - g.ammo, landed: !!C.landed || C.contactTime > 0 }; }
    // broken: nothing
    out.broken = pick(engage(gunTank(), 400, 30, 4, null, (F, C) => { C.cuas[0].broken = true; }));
    // the laser at 300 m and 1,500 m (from the beam first on target to the kill)
    const laserT = (more) => kit('tk34', [{ type: 'cdLaser', x: -1.6, y: 2.0, rot: 0, flip: false, att: 0 }].concat(more || []), 'Laser tank');
    const L3 = engage(laserT(), 300, 30, 6), L15 = engage(laserT([DET]), 1460, 60, 12);
    out.l300 = { on: L3.on, at: L3.at, k: L3.at - L3.on }; out.l1500 = { on: L15.on, at: L15.at, k: L15.at - L15.on };
    // the beam: 8 s on, then off until cooled to 0.3 (a drone that can't be burnt)
    { const r = engage(laserT(), 300, 30, 0.1); const { F, C, b, g } = r; const dmg = Combat.damage; Combat.damage = function (v, p, a, c, ...rest) { if (c === 'laser') return; return dmg.call(this, v, p, a, c, ...rest); };
      let first = null, off = null, back = null;
      try { go(F, 16, (F) => { if (first == null && g.gunOn) first = F.time; if (first != null && off == null && !g.gunOn) off = F.time; if (off != null && back == null && g.gunOn) back = F.time; }); } finally { Combat.damage = dmg; }
      out.heat = { on: off - first, cool: back - off }; }
    // smoke between: the laser holds its beam
    { const r = engage(laserT(), 300, 30, 0.1); const { F, C, b, g } = r; const P = { x: (C.x + b.x) / 2, y: (C.y + b.y) / 2, z: (C.z + b.z) / 2 };
      Combat.S.smoke.push({ b: EARTH, x: P.x, y: P.y, z: P.z, vx: 0, vy: 0, vz: 0, fly: 0, t: 5, r: 9, life: 60, fx: 0, by: C }); let on = 0;
      go(F, 4, () => { if (g.gunOn) on++; }); out.smoke = { on, down: downed(b) }; }
    return out; })();`);
  const W10 = JSON.parse(RB('JSON.stringify(W10)'));
  t('10 the anti-drone gun against a Bumble hovering 500 m off: down within 4 s', W10.g500.at != null && W10.g500.at <= 4, W10.g500);
  t('10 ...at 700 m with no sensor: it never fires; with a Drone Detector at 1 km (cued): it fires and downs it within 8 s', W10.g700.fired === 0 && W10.g1000.at != null && W10.g1000.at <= 8 && W10.g1000.fired > 0, [W10.g700, W10.g1000]);
  t('10 ...a fibre Bumble at 1 km is silent to the detector (never cued, never fired at); a Drone Radar cues it', W10.fib.fired === 0 && W10.fibR.fired > 0 && W10.fibR.at != null, [W10.fib, W10.fibR]);
  t('10 ...it holds its fire at ground vehicles, fires with its own tank on the ground, and broken does nothing', W10.ground.fired === 0 && W10.ground.landed && W10.g500.fired > 0 && W10.broken.fired === 0 && W10.broken.at == null, [W10.ground, W10.broken]);
  t('10 the laser: 0.8-1.0 s on a Bumble at 300 m, 2.7-3.2 s at 1.5 km (cued)', W10.l300.k >= 0.8 && W10.l300.k <= 1.0 && W10.l1500.k >= 2.7 && W10.l1500.k <= 3.2, [W10.l300, W10.l1500]);
  t('10 ...its beam is off after 8 s on, and back on once cooled to 0.3 (3.5 s)', Math.abs(W10.heat.on - 8) < 0.1 && Math.abs(W10.heat.cool - 3.5) < 0.1, W10.heat);
  t('10 ...smoke between holds it off', W10.smoke.on === 0 && !W10.smoke.down, W10.smoke);
  // the stock counter-drone and bay templates (§18) against the same numbers: the MA-1C Abrahm (its gun on its cage's roof,
  // turning with the turret) and the BMK-2D Nest (three Bumbles on its rear deck)
  RB(`var W9 = (() => { const out = {}, pick = (r) => ({ at: r.at, on: r.on, fired: r.fired });
    out.g500 = pick(engage(designOf('ma1c'), 500, 30, 6));
    out.g1000 = pick(engage(designOf('ma1c'), 1000, 40, 10));
    out.fib = pick(engage(designOf('ma1c'), 1000, 40, 6, rowsOf('bumbleF')));
    { const F = world(), C = F.start(designOf('ma1c')); go(F, 1); F.vessels.push(enemy()); const g = C.cuas.find((p) => p.def.cuas.gun), a0 = g.ammo; go(F, 4); out.ground = a0 - g.ammo;
      out.kit = C.cuas.map((p) => p.type).sort().join() + '|' + !!C.parts.find((p) => p.def.cage) + '|' + (C.tg || []).length; }
    { const F = world(), C = F.start(designOf('bmk2d')); go(F, 1.5); const n0 = Drone.left(C), ok = Drone.key(F), d = F.active; let h = null; go(F, 1, () => { h = overTop(d, C); });
      out.nest = { ok, n0, n1: Drone.left(C), name: d.name, kind: d.kind, mine: d.carrier === C, fpv: F.fpv, h }; }
    return out; })();`);
  const W9 = JSON.parse(RB('JSON.stringify(W9)'));
  t('10 the stock MA-1C Abrahm: its gun downs a Bumble hovering 500 m off within 4 s, and one 1 km off (its detector cues it) within 8 s', W9.g500.at != null && W9.g500.at <= 4 && W9.g1000.at != null && W9.g1000.at <= 8, [W9.g500, W9.g1000]);
  t('10 ...a fibre Bumble 1 km off is silent to it; it holds its fire at an enemy tank; its kit: the gun, jammer and detector, the cage, one turret', W9.fib.fired === 0 && W9.ground === 0 && W9.kit === 'cdDetect,cdGun,cdJam|true|1', [W9.fib, W9.ground, W9.kit]);
  t('9 the stock BMK-2D Nest: U launches a Bumble FPV of its three, 4-6 m over its deck within 1 s, flown in first person', W9.nest.ok && W9.nest.n0 === 3 && W9.nest.n1 === 2 && W9.nest.name === 'Bumble FPV' && W9.nest.kind === 'drone' && W9.nest.mine && W9.nest.fpv === true && W9.nest.h >= 4 && W9.nest.h <= 6, W9.nest);
  // cdLow: a SPAA's tracking radar on a Bumble hovering 20 m up
  RB(`var LOW = (() => { const res = {};
    for (const [k, more] of [['without', []], ['with', [RAD]]]) {
      const F = world(), C = F.start(kit('zsy23', more)); go(F, 1); const b = hostile(F, 'bumble', 900, 20); go(F, 0.5);
      Aim.lockKey(C); let locked = null; go(F, 4, (F) => { C.aimP = { x: b.x, y: b.y, z: b.z }; if (locked == null && C.trk && C.trk.lock === b) locked = F.time; });
      res[k] = { locked, low: C.cdLow };
    }
    return res; })();`);
  const LOW = JSON.parse(RB('JSON.stringify(LOW)'));
  t('10 a ZSY-23\'s tracking radar locks a Bumble hovering 20 m up 900 m off with a Drone Radar aboard (cdLow), not without (ground clutter)', LOW.with.low && LOW.with.locked != null && !LOW.without.low && LOW.without.locked == null, LOW);
  // seeing drones (plan I4(b)): by eye 400 m; a detector marks emitters; Radar.eye asks Drone.marked
  RB(`var EY = (() => { const F = world(), C = F.start(designOf('tk34')); go(F, 1); const a = hostile(F, 'bumble', 350, 20), b = hostile(F, 'bumble', 600, 20), c = hostile(F, 'bumble', 1500, 40);
    const D = park(F, kit('tk34', [DET]), -30); go(F, 0.3);
    return { a: Drone.marked(C, a), b: Drone.marked(C, b), c: Drone.marked(C, c), cD: Drone.marked(D, c), eyeA: Radar.eye(C, a, 350), eyeB: Radar.eye(C, b, 600), thr: Drone.threats(C, F).length, cands: Combat.candidates(C, 'air', F).filter((x) => x.ref.kind === 'drone').length,
      sees: Radar.sees(C, a, a, 'guide') }; })();`);
  const EY = JSON.parse(RB('JSON.stringify(EY)'));
  t('10 drones seen by eye 400 m only (Radar.eye asks Drone.marked); a detector marks one at 1.5 km; the player\'s seekers get hostile AI drones, the radar never',
    EY.a === 1 && EY.b === 0 && EY.c === 0 && EY.cD === 2 && EY.eyeA === true && EY.eyeB === false && EY.thr === 3 && EY.cands === 3 && EY.sees !== true, EY);
  // ---------------------------------------------------------------- 11. the AI (spec §15): the drone war in the Tank
  // Range and the Practice Battle, the AI's drones, SPAA against drones, tanks that can't
  RB(`var aiOf = (F) => F.vessels.filter((o) => o.ai && o.ai.drone && !o.dead);
  var liveD = (d) => !!d && !d.dead && d.hulk == null && !!d.control && !(d.ai && d.ai.down);
  var A11 = (() => { const out = {};
    // Range Practice with an MA-1C (a gun, a jammer, a detector, a cage): two passive Bumbles circling 400 m ahead of the pad
    { SET.targets = 'practice'; const F = world(); F.start(designOf('ma1c'), { place: NPAD }); go(F, 1);
      const R0 = GroundAI.range, ds = aiOf(F), d0 = ds[0], P = d0 && Terrain.locate(EARTH, d0.x, d0.y, d0.z, {});
      out.start = { dw: GroundAI.dw, dr: Combat.S.dr, n: ds.length, passive: ds.every((d) => d.ai.passive && d.ai.team === 1 && !d.ai.ally && d.name === 'Enemy drone' && !Combat.isFighter(d)),
        h: P ? +(P.r - EARTH.radius - Terrain.surfaceAt(EARTH, P.a, P.z)).toFixed(0) : null, said: F.log.some((m) => /five targets ahead and two drones overhead/.test(m)) };
      const goneAt = [null, null]; go(F, 12, (F) => { R0.dd.forEach((s, i) => { if (goneAt[i] == null && s.gone) goneAt[i] = F.time; }); if (goneAt.every((x) => x != null)) return false; });
      const was = R0.dd.map((s) => s.v), back = R0.dd.map((s, i) => s.backAt - goneAt[i]);
      out.down = { downAt: goneAt.every((x) => x != null) ? +(Math.max(...goneAt) - 1).toFixed(1) : null, kos: R0.kos, said: F.log.filter((m) => m === 'Enemy drone down!').length, armed: was.some((d) => d && d.dl && d.dl.armedAt != null) };
      go(F, Math.min(...goneAt) + 44 - F.time); out.at44 = R0.dd.map((s, i) => s.v === was[i]);
      go(F, Math.max(...goneAt) + 45.5 - F.time); out.at46 = R0.dd.map((s, i) => s.v !== was[i] && !!s.v && s.v.ai.passive);
      out.back = back.map((x) => +x.toFixed(2));
      GroundAI.reset(F); out.reset = aiOf(F).length; }
    // Range Hostile with the BMK-2D Nest (a bay, no kit): an attack Bumble from the south, 1.6 km off (P4-AI-3), onto its roof
    { SET.targets = 'hostile'; const F = world(), C = F.start(designOf('bmk2d'), { place: NPAD }); go(F, 1);
      const R0 = GroundAI.range; R0.waveAt = 1e9; R0.dAt = F.time; let d = null, t0 = F.time, boom = null, dist0 = null, miss = null;
      go(F, 77, (F) => { if (!d) { d = aiOf(F)[0]; if (d) dist0 = Math.hypot(d.x - C.x, d.y - C.y, d.z - C.z); }
        if (d && d.dead && boom == null) { boom = F.time - t0; miss = Math.hypot(d.x - C.x, d.y - C.y, d.z - C.z); return false; } });
      out.hostile = { dw: GroundAI.dw, said: F.log.includes('Enemy drone inbound!'), dist0: dist0 && Math.round(dist0), boom: boom && +boom.toFixed(1), miss: miss && +miss.toFixed(1), hurt: C.hurtAt != null || !!C.ko };
      GroundAI.reset(F); }
    // two at most up at a time (three called for at once)
    { const F = world(); F.start(designOf('bmk2d'), { place: NPAD }); go(F, 1); const R0 = GroundAI.range; R0.waveAt = 1e9;
      for (let i = 0; i < 3; i++) { R0.dAt = F.time; go(F, 0.1); } out.most = aiOf(F).filter(liveD).length; GroundAI.reset(F); }
    SET.targets = 'off';
    return out; })();`);
  const A11 = JSON.parse(RB('JSON.stringify(A11)'));
  t('11 Range Practice with an MA-1C: two passive enemy Bumbles circle 50 m up ("...and two drones overhead"); they are no bandits', A11.start.dw && A11.start.dr && A11.start.n === 2 && A11.start.passive && Math.abs(A11.start.h - 50) <= 3 && A11.start.said, A11.start);
  t('11 ...its anti-drone gun downs both ("Enemy drone down!", two range KOs; they never armed), and each comes back 45 s later (not at 44 s)',
    A11.down.downAt != null && A11.down.kos === 2 && A11.down.said === 2 && !A11.down.armed && A11.back.every((b) => Math.abs(b - 45) < 0.2) && A11.at44.every((x) => x) && A11.at46.every((x) => x) && A11.reset === 0, [A11.down, A11.back, A11.at44, A11.at46]);
  t('11 Range Hostile: an attack Bumble ("Enemy drone inbound!") from 1.6 km (outside every kit\'s reach: P4-AI-3) reaches the player\'s Nest within 75 s and goes off on it; two at most at a time',
    A11.hostile.dw && A11.hostile.said && Math.abs(A11.hostile.dist0 - 1600) < 30 && A11.hostile.boom != null && A11.hostile.boom <= 75 && A11.hostile.miss < 8 && A11.hostile.hurt && A11.most === 2, [A11.hostile, A11.most]);
  // SPAA against drones; a tank's gun never stalls on one; the parked carrier is a target
  RB(`var B11 = (() => { const out = {};
    const flyer = (seed) => { Math.random = mulberry32(seed); GroundAI.seed(seed); const { F, v } = pilot(); go(F, 3, (F) => { v.ctl.z = F.time < 3 ? 1 : 0; }); return { F, v }; };
    // the AI ZSY-23 (guarding) against the player's Bumble hovering 400 m off: ten seeds
    out.zsy = [];
    for (let s = 1; s <= 10; s++) { const { F, v } = flyer(s * 7919), Z = GroundAI.spawn(F, 'zsy23', NPAD.e, NPAD.z + 400, Math.PI / 2, 1, 'guard', { skill: Math.random() });
      let at = null; go(F, 20, (F) => { if (at == null && (F.destroyed || v.hulk != null || !v.control)) { at = F.time; return false; } });
      out.zsy.push({ at: at && +(at - 3).toFixed(1), aa: Z.ai.aa, h: +v.altitude().toFixed(0) }); GroundAI.reset(F); }
    // a non-AA tank (an MA-1 out to fight) with the player's Bumble hovering 300 m off: never its target, and it drives on
    { const { F, v } = flyer(5), M = GroundAI.spawn(F, 'ma1', NPAD.e, NPAD.z + 300, Math.PI / 2, 1, 'fight', { skill: 1 }), k0 = { e: M.ai.k.e, z: M.ai.k.z };
      let tg = 0, aim = 0; go(F, 20, () => { if (M.ai.tgt === v) tg++; if (M.aimP) aim++; });
      out.mbt = { aa: M.ai.aa, tg, aim, moved: Math.round(Math.hypot(M.ai.k.e - k0.e, M.ai.k.z - k0.z)), alive: !F.destroyed }; GroundAI.reset(F); }
    // the parked carrier: a Nest with its drone up is a unit (in the way too) and an MS-4 shoots it, not the drone
    { Math.random = mulberry32(77); GroundAI.seed(77); const { F, C, d, ok } = launched(); const M = GroundAI.spawn(F, 'ms4', NPAD.e, NPAD.z + 500, Math.PI / 2, 1, 'guard', { skill: 1 });
      go(F, 0.5); const U = GroundAI.units.map((u) => (u.v === C ? 'C' : u.v === d ? 'd' : u.v === M ? 'M' : '?')).join();
      let tC = 0, tD = 0, hurt = null; const t0 = F.time; go(F, 30, (F) => { if (M.ai.tgt === C) tC++; if (M.ai.tgt === d) tD++; if (hurt == null && (C.hurtAt != null || C.ko)) { hurt = F.time - t0; return false; } });
      out.carrier = { ok, U, tC: tC > 0, tD, hurt: hurt && +hurt.toFixed(1), parked: !!C.parked }; GroundAI.reset(F); }
    return out; })();`);
  const B11 = JSON.parse(RB('JSON.stringify(B11)'));
  const zk = B11.zsy.filter((r) => r.at != null && r.at <= 15).length;
  t('11 the AI ZSY-23 downs the player\'s Bumble hovering 400 m off within 15 s in at least 7 of 10 seeded runs', zk >= 7 && B11.zsy.every((r) => r.aa), [zk, B11.zsy]);
  t('11 a non-AA AI tank (an MA-1) never targets the player\'s drone 300 m off, never aims at it, and drives on', !B11.mbt.aa && B11.mbt.tg === 0 && B11.mbt.aim === 0 && B11.mbt.moved > 30 && B11.mbt.alive, B11.mbt);
  t('11 the parked carrier (its drone up) is a unit, and an AI MS-4 targets and hits it, never its drone', B11.carrier.ok && B11.carrier.parked && B11.carrier.U.includes('C') && B11.carrier.U.includes('d') && B11.carrier.tC && B11.carrier.tD === 0 && B11.carrier.hurt != null, B11.carrier);
  // the Practice Battle with the BMK-2D ($45k): the enemy fields a Nest and a ZSY-23; the Nest launches once it sees us
  RB(`var C11 = (() => { const out = {}, F = world(); Math.random = mulberry32(3); GroundAI.startBattle(F, { money: 45000, design: designOf('bmk2d'), seed: 99 });
    const foes = GroundAI.ai.filter((v) => v.ai.team === 1), N = foes.find((v) => v.ai.key === 'bmk2d'); let contact = null, launch = null, D = null; const t0 = F.time;
    go(F, 160, (F) => { if (contact == null && GroundAI.units.some((u) => u.team === 0 && Math.hypot(u.e - N.ai.k.e, u.z - N.ai.k.z) < 1400)) contact = F.time - t0;
      const d = aiOf(F)[0]; if (d && launch == null) { launch = F.time - t0; D = d; return false; } });
    out.b = { dw: GroundAI.dw, foes: foes.map((v) => v.ai.key).join(), allies: GroundAI.ai.filter((v) => v.ai.team === 0).map((v) => v.ai.key).join(), contact: contact && +contact.toFixed(1), launch: launch && +launch.toFixed(1),
      nest: D && D.ai.nest === N, left: N.docks[0].docked, name: D && D.name, said: F.log.includes('Enemy drone inbound!') };
    go(F, 1); out.b.hop = D && +(D.altitude() - N.altitude()).toFixed(1);
    // ...and a battle in a design without a bay or kit is as ever: the money's stock tanks
    const G2 = world(); GroundAI.startBattle(G2, { money: 45000, design: designOf('tk34'), seed: 99 }); out.old = { dw: GroundAI.dw, foes: GroundAI.ai.filter((v) => v.ai.team === 1).map((v) => v.ai.key).join() };
    GroundAI.reset(G2); return out; })();`);
  const C11 = JSON.parse(RB('JSON.stringify(C11)'));
  t('11 a Practice Battle in the BMK-2D ($45k): the enemy\'s slot 1 is a BMK-2D Nest and slot 2 a ZSY-23, the allies as ever; the Nest launches a Bumble within 75 s of contact',
    C11.b.dw && C11.b.foes === 'tk34,bmk2d,zsy23' && C11.b.allies === 'ms4,pumo' && C11.b.contact != null && C11.b.launch != null && C11.b.launch - C11.b.contact <= 75 && C11.b.nest && C11.b.left === 2 && C11.b.name === 'Enemy drone' && C11.b.said && C11.b.hop > 3,
    C11.b);
  t('11 ...in a design with no bay or kit, no drone war: the money\'s three stock tanks', !C11.old.dw && C11.old.foes === 'tk34,ms4,pumo', C11.old);

  // ---------------------------------------------------------------- the Phase 4 review's fixes (each fails before its fix)
  // P4-OF-2 / P4-BAY-5: a battery hit under half its hp leaks a share of its own charge, not a plane tank's 4 kg/s
  RB(`var R1 = (() => { const { F, v } = solo('bumble'); const cell = v.dr.cells[0], q0 = Drone.charge(v); Combat.damage(v, cell, 0.6 * Combat.maxHp(cell.def), 'shot', F, null);
    const hp = Combat.hpFrac(cell); go(F, 3); const q3 = Drone.charge(v), out = v.parts.some((p) => p.flameout);
    return { hp, q0, q3, out, said: F.log.filter((m) => /Battery/.test(m)) }; })();`);
  const R1 = JSON.parse(RB('JSON.stringify(R1)'));
  t('P4-OF-2 a Bumble\'s battery hit to 40 % hp leaks about 1 % of its charge a second: 3 s later it still flies on over 90 %, and only "damaged" is said',
    R1.hp > 0.35 && R1.hp < 0.45 && R1.q3 < R1.q0 - 0.01 && R1.q3 > R1.q0 - 0.06 && !R1.out && R1.said.length === 1 && /damaged/.test(R1.said[0]), R1);
  // P4-OF-4: the drone key is read before an Armour's own keys, so it clashes with them: a saved Tactical map on U keeps U
  const R2 = JSON.parse(RB(`JSON.stringify({ drone: Keys.clean({ tacMap: ['KeyU'] }).drone, lock: Keys.clean({ lock: ['KeyU'] }).drone, ctx: Keys.INFO.drone.ctx })`));
  t('P4-OF-4 a player\'s own Armour key on U (Tactical map, Radar lock) leaves the drone key unbound', R2.drone.length === 0 && R2.lock.length === 0, R2);
  // P4-BAY-1: a tap on our hovering bay drone (Flight.tapAt -> switchTo) takes it as U does: Level flies it; never with its link lost
  RB(`var R3 = (() => { const { F, C, d } = launched(); go(F, 1); putAt(d, 40, 20); d.dl.hold = null; go(F, 1); Drone.key(F); go(F, 0.5);
    F.switchTo(d); const took = F.active === d, mode = d.dl.mode, p0 = { x: d.x, y: d.y, z: d.z };
    go(F, 2, () => { d.ctl.v = 1; }); const moved = Math.hypot(d.x - p0.x, d.y - p0.y, d.z - p0.z);
    F.switchTo(C, true, true); d.dl.lost = true; d.dl.mode = 'hold'; F.switchTo(d); const tookLost = F.active === d, said = F.log.slice(-1)[0];
    return { took, mode, moved, tookLost, said }; })();`);
  const R3 = JSON.parse(RB('JSON.stringify(R3)'));
  t('P4-BAY-1 a tap on the bay\'s hovering drone takes it in Level (2 s of full stick flies it on), and is refused with its link lost', R3.took && R3.mode === 'pilot' && R3.moved > 5 && !R3.tookLost && R3.said === 'No link to the drone', R3);
  // P4-BAY-2: a LAST FLIGHT ended on a tank with no controls left (its crew out): the drone is left on hold, its stick let go, the HUDs swapped
  RB(`var R4 = (() => { const { F, C, d } = launched(); go(F, 1); putAt(d, 80, 25); d.dl.hold = null; go(F, 1);
    let rl = 0; const rl0 = Controls.relayout; Controls.relayout = () => { rl++; };
    try { Armour.knockOut(C, F, 'crew'); go(F, 0.2); const lf = F.carrierDown === C, ctl = !!C.control; go(F, 1, () => { d.ctl.v = 1; }); const r0 = rl; Drone.key(F);
      return { lf, ctl, tank: F.active === C, mode: d.dl.mode, v: d.ctl.v, rl: rl - r0 }; } finally { Controls.relayout = rl0; } })();`);
  const R4 = JSON.parse(RB('JSON.stringify(R4)'));
  t('P4-BAY-2 a LAST FLIGHT ended over a tank whose crew is out: the tank active, the drone on hold with its stick let go, the HUDs swapped', R4.lf && !R4.ctl && R4.tank && R4.mode === 'hold' && R4.v === 0 && R4.rl >= 1, R4);
  // P4-BAY-3, P4-MP-1: a drone of ours left unattended in a room that dies in one go (a crash), or whose battery goes flat and then
  // crashes, is told to the room (MP.dropExtra 'down'), and leaves MP.extra
  RB(`var mpRec = (calls) => new Proxy({ extra: new Map(), shared: false, mainDown: false, hulk: null, wrecks: [],
      sendExtra(v) { v.craft = 1; this.extra.set(1, { v, c: 1 }); return true; },
      dropExtra(v, how) { for (const [c, E] of this.extra) if (E.v === v) { this.extra.delete(c); calls.push(how); return true; } return false; },
      announceDown() { this.mainDown = true; }, onLocalDestroyed() { return true; }, enemy() { return false; }, hostile() { return false; } },
    { get: (t, k) => (k in t ? t[k] : typeof k === 'string' ? () => [] : undefined) });
  var R5 = (() => { const out = {};
    for (const how of ['crash', 'flat']) {
      const calls = []; this.MP = mpRec(calls);
      try { const F = world(); F.mp = { mode: 'sandbox', solo: false }; const C = F.start(nest()); go(F, 1.5); Drone.key(F); const d = F.active;
        go(F, 1); putAt(d, 60, how === 'crash' ? 6 : 60); d.dl.hold = null; go(F, 0.5); Drone.key(F); go(F, 0.5);
        if (how === 'crash') { const U = up(d); d.vx = -U.x * 40; d.vy = -U.y * 40; d.vz = -U.z * 40; } else for (const p of d.dr.cells) p.fuel = 0;
        go(F, how === 'crash' ? 5 : 25);
        out[how] = { tank: F.active === C, dead: !!d.dead, told: calls.filter((c) => c === 'down').length, left: MP.extra.size }; } finally { delete this.MP; }
    }
    return out; })();`);
  const R5 = JSON.parse(RB('JSON.stringify(R5)'));
  t('P4-BAY-3, P4-MP-1 an unattended drone in a room that crashes, or goes flat and then crashes, is told to the room once ("down") and leaves MP.extra',
    ['crash', 'flat'].every((k) => R5[k].tank && R5[k].dead && R5[k].told === 1 && R5[k].left === 0), R5);
  // P4-BAY-4: a save in the 1.5 s after a launch keeps the bay's lid shut
  RB(`var R6 = (() => { const { F, C } = launched(); go(F, 0.5); const live = bayOf(C).deployed, data = F.serialize(), row = data.vessels[data.active].parts.find((p) => p.id === bayOf(C).id);
    return { live, saved: row.deployed }; })();`);
  const R6 = JSON.parse(RB('JSON.stringify(R6)'));
  t('P4-BAY-4 a save 0.5 s after a launch (its lid still up) saves the lid shut', R6.live === 1 && !R6.saved, R6);
  // P4-CTR-1: FIRE does nothing on a drone whose link is lost (a jammer 60 m off): no burst, no grenade
  RB(`var R7 = (() => { const out = {};
    const jamFoe = (F, e) => { const o = mk(kit('ms4', [{ type: 'cdJam', x: -1.6, y: 2.0, rot: 0, flip: false, att: 0 }]), { e: NPAD.e + e, z: NPAD.z }); o.ai = { ground: true, team: 1 }; F.vessels.push(o); return o; };
    const press = (F, v, kind) => { F.firing = true; F.fireTap = true; Combat.S.wasFiring = false; v.wsel = Combat.systems(v).findIndex((s) => s.w.kind === kind); Combat._t.playerFrame(F, 1 / 60); F.firing = false; };
    { const { F, v } = pilot(); go(F, 0.2); const U = up(v); fling(v, add3({ x: v.x, y: v.y, z: v.z }, U, 60), { x: 0, y: 0, z: 0 }, 0); arm(v); v.sas = 'hold'; v.dl.hold = null; go(F, 0.1);
      jamFoe(F, 60); go(F, 1.2); const lost = !!v.dl.lost; press(F, v, 'warhead'); out.warhead = { lost, boom: !!v.dl.boom }; }
    { const rows = rowsOf('bumble').filter((r) => r.type !== 'drCharge').concat([{ type: 'drGrenade', x: 0, y: -0.075, rot: 0, flip: false, att: 0 }]);
      const { F, v } = pilot(rows, 'Dropper'); go(F, 0.2); const U = up(v); fling(v, add3({ x: v.x, y: v.y, z: v.z }, U, 60), { x: 0, y: 0, z: 0 }, 0); v.sas = 'hold'; v.dl.hold = null; go(F, 0.1);
      jamFoe(F, 60); go(F, 1.2); const lost = !!v.dl.lost, g = v.parts.find((p) => p.def.weapon && p.def.weapon.kind === 'bomb'), a0 = g.ammo; press(F, v, 'bomb'); out.drop = { lost, used: a0 - g.ammo }; }
    return out; })();`);
  const R7 = JSON.parse(RB('JSON.stringify(R7)'));
  t('P4-CTR-1 with its link lost, FIRE neither sets off an armed warhead nor drops a grenade', R7.warhead.lost && !R7.warhead.boom && R7.drop.lost && R7.drop.used === 0, R7);
  // P4-CTR-2: a ZSY-23 with its Drone Radar shot out loses a Bumble hovering 20 m up in the clutter, as with none
  RB(`var R8 = (() => { const F = world(), C = F.start(kit('zsy23', [{ type: 'cdRadar', x: 0, y: 3.4, rot: 0, flip: false, att: 0 }])); go(F, 1);
    const R = C.parts.find((p) => p.def.searchRadar && p.def.searchRadar.low); R.broken = true; R.hp = 0; const b = hostile(F, 'bumble', 900, 20); go(F, 0.5);
    Aim.lockKey(C); let locked = null; go(F, 4, (F) => { C.aimP = { x: b.x, y: b.y, z: b.z }; if (locked == null && C.trk && C.trk.lock === b) locked = F.time; }); return { locked }; })();`);
  const R8 = JSON.parse(RB('JSON.stringify(R8)'));
  t('P4-CTR-2 a broken Drone Radar lifts no clutter: the tracking radar never locks the low Bumble', R8.locked == null, R8);
  // P4-CTR-3: an AI kamikaze scratched 25 s before it bursts on our tank is no kill of ours
  RB(`var R9 = (() => { const F = world(), C = F.start(designOf('tk34')); go(F, 1); const b = hostile(F, 'bumble', 200, 30); arm(b); b.ai.passive = false; go(F, 0.2);
    Combat.damage(b, b.parts.find((p) => p.def.thrust), 1, 'shot', F, C); go(F, 25); const k0 = Combat.S.kills, n0 = F.log.length;
    const T = topOf2(C, C.parts[0]), U = up(C); fling(b, add3(add3(T, deckOff(C), 1), U, 5), { x: -U.x, y: -U.y, z: -U.z }, 25); b.dl.prev = null; go(F, 0.8);
    return { boom: !!(b.dl && b.dl.boom), kills: Combat.S.kills - k0, said: F.log.slice(n0).filter((m) => /drone down/.test(m)) }; })();`);
  const R9 = JSON.parse(RB('JSON.stringify(R9)'));
  t('P4-CTR-3 a kamikaze that bursts on our tank (scratched 25 s before) is no kill and no "Enemy drone down!"', R9.boom && R9.kills === 0 && !R9.said.length, R9);
  // P4-CTR-4: our parked tank's anti-drone gun downing a hostile drone while we fly the tank's drone: our kill
  RB(`var R10 = (() => { const F = world(), d0 = nest(); d0.parts = d0.parts.concat([{ type: 'cdGun', x: -0.9, y: 1.95, rot: 0, flip: false, att: 0 }]); const C = F.start(d0); go(F, 1.5);
    Drone.key(F); const d = F.active; go(F, 0.6); putAt(d, -60, 25); go(F, 0.5); const k0 = Combat.S.kills; const b = hostile(F, 'bumble', 300, 30);
    go(F, 8, () => !(b.dead || b.ai.down)); return { flying: F.active === d, down: !!(b.dead || b.ai.down), byTank: b.lastHitBy === C, kills: Combat.S.kills - k0 }; })();`);
  const R10 = JSON.parse(RB('JSON.stringify(R10)'));
  t('P4-CTR-4 the parked tank\'s anti-drone gun downing a drone while we fly its drone counts as our kill', R10.flying && R10.down && R10.byTank && R10.kills === 1, R10);
  // P4-CTR-8 and P4-CTR-5: an AI drone picked with I is named as a drone, never a Bandit; the gun's LEAD shows it only when seen
  RB(`var R11 = (() => { const F = world(), v = F.start(designOf('fs16')); go(F, 0.5); const b = hostile(F, 'bumble', 300, 30); go(F, 0.5);
    const n0 = F.log.length; Radar.S.pick = null; Radar.next(F, 1); return { pick: Radar.S.pick === b, said: F.log.slice(n0) }; })();`);
  const R11 = JSON.parse(RB('JSON.stringify(R11)'));
  t('P4-CTR-8 an AI drone picked with I is announced by its name, not as a Bandit', R11.pick && R11.said.length === 1 && !/Bandit/.test(R11.said[0]), R11);
  RB(`var R12 = (() => { const $0 = this.$, R3D = this.Render3D, out = {};
    const rec = () => { const calls = []; return { calls, ctx: new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'fillText' ? (s) => calls.push(String(s)) : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: (t, k, v) => { t[k] = v; return true; } }) }; };
    this.$ = () => null; this.Render3D = { ready: true, project: () => ({ x: 400, y: 300, behind: false }), projectTo: (x, y, z, o) => Object.assign(o, { x: 400, y: 300, behind: false }) };
    try { for (const de of [300, 1500]) { const F = world(), v = F.start(designOf('fs16')); go(F, 0.5); hostile(F, 'bumble', de, 40); go(F, 0.5);
      v.wsel = Combat.systems(v).findIndex((s) => s.w.kind === 'gun'); const R = rec(); Combat.drawHUD(R.ctx, 800, 600, 1, F); out[de] = R.calls.filter((s) => /LEAD/.test(s)).length; } }
    finally { this.$ = $0; if (R3D === undefined) delete this.Render3D; else this.Render3D = R3D; }
    return out; })();`);
  const R12 = JSON.parse(RB('JSON.stringify(R12)'));
  t('P4-CTR-5 the gun\'s LEAD marker shows an AI drone 300 m off (seen) and not one 1.5 km off that nothing sees', R12[300] === 1 && R12[1500] === 0, R12);
  // UX-P4-4, UX-P4-5: the help names the side buttons as drawn (no ◀ ▶) and follows Settings → Drone stick (Tilt: A/D and the stick slide, Q/E and the buttons turn)
  RB(`var R13 = (() => { const g = Settings.get, T0 = Controls.touch, out = {}, txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ');
    try { for (const st of ['turn', 'tilt']) { Settings.get = (k) => (k === 'droneStick' ? st : g.call(Settings, k));
      const { F } = solo('bumble'); Controls.touch = false; const keys = txt(Flight.droneHelp.call(F)), hint = Drone.help(F); Controls.touch = true; const touch = txt(Flight.droneHelp.call(F));
      out[st] = { ad: (keys.match(/Level: (turn|slide)[^·]*· Acro: roll/) || [''])[0], qe: (keys.match(/Level: (turn|slide)[^·]*· Acro: yaw/) || [''])[0], hint, glyph: /◀|▶/.test(keys + touch), buttons: (touch.match(/round arrow buttons by the stick (turn|slide)/) || [])[1] }; } }
    finally { Settings.get = g; Controls.touch = T0; }
    return out; })();`);
  const R13 = JSON.parse(RB('JSON.stringify(R13)'));
  t('UX-P4-4, UX-P4-5 the drone help follows the stick layout (Turn: A/D turn, Q/E and the round arrow buttons slide; Tilt: the reverse) and names no ◀ ▶',
    /Level: turn/.test(R13.turn.ad) && /Level: slide/.test(R13.turn.qe) && R13.turn.buttons === 'slide' && /A\/D turn/.test(R13.turn.hint)
    && /Level: slide/.test(R13.tilt.ad) && /Level: turn/.test(R13.tilt.qe) && R13.tilt.buttons === 'turn' && /A\/D slide, Q\/E turn/.test(R13.tilt.hint) && !R13.turn.glyph && !R13.tilt.glyph, R13);
  // P4-AI-1: an MA-1C's turret (its kit aboard) thrown by an ammo detonation keeps the range and its tally
  RB(`var R14 = (() => { SET.targets = 'hostile'; const F = world(), C = F.start(designOf('ma1c'), { place: NPAD }); go(F, 2); const R0 = GroundAI.range; R0.waveAt = 1e9; R0.kos = 3; R0.best = 850;
    const tg = (C.tg || []).filter((g) => !g.parent).sort((a, b) => b.mass - a.mass)[0], tp = C.parts.find((p) => tg && tg.ids.has(p.id) && !p.def.cuas && p.def.weapon) || C.parts.find((p) => tg && tg.ids.has(p.id));
    Armour.knockOut(C, F, 'ammo', { st: { part: tp }, rounds: 10 }); go(F, 2.5);
    const out = { same: GroundAI.range === R0, kos: GroundAI.range && GroundAI.range.kos, cuas: C.cuas.length, dw: GroundAI.dw };
    GroundAI.reset(F); SET.targets = 'off'; return out; })();`);
  const R14 = JSON.parse(RB('JSON.stringify(R14)'));
  t('P4-AI-1 a drone-war range kept when the knocked-out MA-1C\'s kit leaves with its thrown turret (the tally of 3 kept)', R14.same && R14.kos === 3 && R14.cuas === 0 && R14.dw, R14);
  // P4-AI-2: a player on the south pad itself: the attack drone still appears 1.6 km off, never on top of them
  RB(`var R15 = (() => { SET.targets = 'hostile'; const pad = EARTH.groundPads.highlandS, F = world(), C = F.start(designOf('bmk2d'), { place: { e: pad.e, z: pad.z, yaw: 0 } }); go(F, 1);
    const R0 = GroundAI.range; R0.waveAt = 1e9; R0.planeAt = 1e9; R0.dAt = F.time; go(F, 0.2); const d = aiOf(F)[0], dist = d ? Math.hypot(d.x - C.x, d.y - C.y, d.z - C.z) : null;
    GroundAI.reset(F); SET.targets = 'off'; return { dist }; })();`);
  const R15 = JSON.parse(RB('JSON.stringify(R15)'));
  t('P4-AI-2 with the player on the south pad the attack drone appears 1.6 km off (it appeared inside the tank)', R15.dist != null && Math.abs(R15.dist - 1600) < 30, R15);
  // P4-AI-4, P4-AI-5: practice drones downed by the MA-1C's automatic gun, or dropped by a Wide-band Jammer, go on the tally
  // ("Enemy drone down!") but never win the career's Tank Range mission with no hand on the controls
  RB(`var R16 = (() => { const out = {}; SET.targets = 'practice';
    for (const [k, more] of [['ma1c', []], ['tk34', [{ type: 'cdJamL', x: -2.4, y: 2.0, rot: 0, flip: false, att: 0 }]]]) {
      Math.random = mulberry32(3); const F = world(), C = F.start(more.length ? kit(k, more) : designOf(k), { place: NPAD }), n0 = F.log.length;
      go(F, 50, (F) => { C.ctl.v = C.ctl.h = 0; F.firing = false; });
      out[k + (more.length ? '+jamL' : '')] = { kos: GroundAI.range.kos, award: !!F.flags.tankRange, down: F.log.slice(n0).filter((m) => m === 'Enemy drone down!').length };
      GroundAI.reset(F); }
    SET.targets = 'off'; return out; })();`);
  const R16 = JSON.parse(RB('JSON.stringify(R16)'));
  t('P4-AI-4, P4-AI-5 the automatic gun\'s and a jammer\'s downed practice drones count on the tally ("Enemy drone down!") but win no career mission with no input',
    R16.ma1c.kos >= 3 && !R16.ma1c.award && R16['tk34+jamL'].kos >= 2 && R16['tk34+jamL'].down >= 2 && !R16['tk34+jamL'].award, R16);
  // P4-AI-6: a Drone Radar or a Roof Cage alone brings the drone war (range and Practice Battle)
  RB(`var R17 = (() => { const out = {}; const SP = { cdCage: { x: 0, y: 2.2 }, cdRadar: { x: -2.4, y: 2.06 } };
    for (const t of ['cdRadar', 'cdCage']) { const row = [{ type: t, x: SP[t].x, y: SP[t].y, rot: 0, flip: false, att: 0 }];
      SET.targets = 'practice'; const F = world(); F.start(kit('tk34', row), { place: NPAD }); go(F, 1.2); const range = GroundAI.dw; GroundAI.reset(F);
      const G2 = world(); GroundAI.startBattle(G2, { money: 45000, design: kit('tk34', row), seed: 1 }); const battle = GroundAI.dw; GroundAI.reset(G2); SET.targets = 'off';
      out[t] = { range, battle }; }
    return out; })();`);
  const R17 = JSON.parse(RB('JSON.stringify(R17)'));
  t('P4-AI-6 a Drone Radar or a Roof Cage alone brings the drone war to the range and a Practice Battle', R17.cdRadar.range && R17.cdRadar.battle && R17.cdCage.range && R17.cdCage.battle, R17);
}

// ================================================================ 11. the AI: old play (no drone war) as it was before drones
// The Tank Range in a TK-34 (Practice, then Hostile's first two waves) and a Practice Battle, in a game with drone.js and in
// a second one without it (as before the drones): the same layout, the same waves, the same looks at the ground (S.calls),
// the same toasts, the AI where it was, to the millimetre.
{
  const play = (opts) => { const c = G.load(opts); G.run(c, `Math.random = mulberry32(31337);
    var SET = { targets: 'practice' }; Settings.get = (k) => SET[k];
    var world = () => ({ time: 0, target: null, toasts: [], broken: [], vessels: [], active: null, firing: false, mgFiring: false, groundAim: false, aim: null, zero: 800, warpIdx: 0,
      running: true, destroyed: false, camAbs: null, launchCost: 0, flags: {}, design: null, toast(m) { this.toasts.push(m); }, award(f) { this.flags[f] = true; },
      onDestroyed() { if (this.destroyed) return; this.destroyed = true; if (GroundAI.battle && GroundAI.onDestroyed(this)) return; },
      start(design, opts) { this.design = design;
        const ps = partsFromDesign(design.parts), adjAll = buildAdjacency(ps), ctrl = findControlPart(ps), keep = componentOf(ctrl.id, adjAll), parts = ps.filter((p) => keep.has(p.id)), adj = new Map();
        for (const p of parts) { if (p.att != null && !keep.has(p.att)) p.att = null; adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id)))); }
        const v = new Vessel(parts, adj, EARTH); v.name = design.name; v.kind = design.kind; v.stages = computeStages(parts, adj, ctrl.id); v.rebuildGroups();
        const P = opts && opts.place; v.placeOnSurface(EARTH, siteAngle(EARTH, P ? P.e : 0), 0, P ? P.z : 0, P ? P.yaw || 0 : 0);
        this.vessels = [v, ...(opts && Array.isArray(opts.keep) ? opts.keep.filter((o) => o && o !== v && !o.dead) : [])]; this.active = v; this.destroyed = false; Combat.reset(this); this.running = true; return v; },
      ripParts() {}, breakParts(v, parts) { v.parts = v.parts.filter((q) => !parts.includes(q)); if (!v.parts.length) v.dead = true; },
      cleanup() { this.vessels = this.vessels.filter((v) => !v.dead && v.parts.length); } });
    var go = (F, secs) => { for (let f = 0, N = Math.round(secs * 60); f < N; f++) { for (let i = 0; i < 2; i++) { for (const v of F.vessels.slice()) if (!v.remote && !v.wreck && !v.kin && !v.dead && v.parts.length && !(v !== F.active && v.landed && v.restTime > 2)) v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; }
      Combat.frame(F, 1 / 60); F.cleanup(); } };
    var designOf = (key) => ({ name: TEMPLATES[key].name, kind: TEMPLATES[key].kind, parts: templateRows(TEMPLATES[key]) });
    var NPAD = GroundMode.placement('highland', 0, 0, 'tank');
    var sig = (F) => GroundAI.ai.map((v) => [v.ai.key, v.ai.role, v.ai.team, v.ai.state, Math.round(v.ai.k.e * 1000), Math.round(v.ai.k.z * 1000)].join(':')).join('|');
    var OLD = (() => { const out = {};
      { const F = world(); F.start(designOf('tk34'), { place: NPAD }); GroundAI.calls = 0; go(F, 20); out.practice = { sig: sig(F), calls: GroundAI.calls, toasts: F.toasts.join('/'), dr: Combat.S.dr, dw: !!GroundAI.dw, n: F.vessels.length }; GroundAI.reset(F); }
      { SET.targets = 'hostile'; const F = world(); F.start(designOf('tk34'), { place: NPAD }); GroundAI.calls = 0; go(F, 40); const w1 = sig(F); GroundAI.range.waveAt = F.time; GroundAI.range.left = []; go(F, 5);
        out.hostile = { w1, w2: sig(F), wave: GroundAI.range.wave, calls: GroundAI.calls, toasts: F.toasts.join('/'), dr: Combat.S.dr, n: F.vessels.length }; GroundAI.reset(F); SET.targets = 'practice'; }
      { const F = world(); GroundAI.startBattle(F, { money: 75000, design: designOf('tk72'), seed: 5 }); GroundAI.calls = 0; go(F, 20);
        out.battle = { sig: sig(F), calls: GroundAI.calls, toasts: F.toasts.join('/'), tk: GroundAI.battle.obj.tk.join(), dr: Combat.S.dr }; GroundAI.reset(F); }
      return out; })();`); return JSON.parse(G.run(c, 'JSON.stringify(OLD)')); };
  const now = play({ combat: true }), before = play({ combat: true, drone: false });
  const same = (k) => JSON.stringify(now[k]) === JSON.stringify(before[k]);
  t('11 old play (no drone war): the Tank Range in a TK-34, Practice and Hostile (two waves), and a $75k Practice Battle play exactly as with drone.js left out: layout, waves, S.calls, toasts, every AI to the millimetre',
    same('practice') && same('hostile') && same('battle') && !now.practice.dr && !now.practice.dw && !now.hostile.dr && !now.battle.dr && now.hostile.wave === 2 && now.practice.calls > 0,
    [now, before].map((o) => ({ p: [o.practice.calls, o.practice.n, o.practice.sig.length], h: [o.hostile.calls, o.hostile.wave, o.hostile.n], b: [o.battle.calls, o.battle.tk] })));
}

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
