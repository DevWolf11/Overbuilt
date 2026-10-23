// Ground driving traces at full precision (17 significant digits, every 0.25 s): the Dune Buggy driving, cornering,
// braking, reversing, along the causeway and up a 10° slope on Shetland; the Dragonfly and the Lunar Rover rolling;
// the take-off rolls of the Falcon, the Mustang and the FS-16. Each craft is driven as the game drives it: the stick
// is read once a frame at 60 fps, then two 1/120 s substeps run, each a physics step and Combat.step (the order of
// Flight.physicsTick; combat.js is loaded, as in the page, so bumps dent and crashes break at the game's limits).
// Any change to ground contact, driving, steering or a plane's ground roll shows up here. Every scenario runs twice
// and must come out the same both times.
//   node test/driving.js [--update]
const G = require('./lib/game.js'), { check } = require('./lib/baseline.js');
const ctx = G.load({ combat: true }), R = (c) => G.run(ctx, c);
const FPS = 60, SUB = 2, h = 1 / 120; // a 1/60 s frame: n = ceil(total / PHYS_DT - 0.05) = 2 substeps of 1/120 s
const D = 180 / Math.PI, TOP = ctx.PARTS.carWheel.wheel.speed; // the buggy's top speed: a stick at V/TOP holds V
const fwd = (v) => v.wheelSpeed || 0; // speed along the ground, as the drive measures it
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('-'));

// where things start: a site (as Flight.start), or placed as placeOnSurface would put a spawn
const onEarth = (e, z = 0, yaw = 0) => (v) => v.placeOnSurface(ctx.EARTH, ctx.siteAngle(ctx.EARTH, e), ctx.VEHICLE_KINDS[v.kind].launchRot, z, yaw);
// A dry slope of about 10° on Shetland (real Earth map), found by searching e 17,400-20,400, z -2,600..2,400 for ground
// that rises 9.85° over the next 60 m (9.2-10.6° at 4 m baselines, under 1° across): e 17,720, z -620, 26.1 m high;
// uphill is yaw 0.0089 (a hair north of east).
const SLOPE = { e: 17720, z: -620, yaw: 0.0089 };
// The Lunar Rover is a Moon rover: it flies there, drops its stages and drives on its Rover Wheels. Its lander is
// the part tree left when both separators have fired (cutSeparator and splitComponents, as Flight.fireSeparator
// does, without the random tumble), set down on a flat stretch of the Moon's track (angle 0.2592: under 0.3° over 80 m).
const moonRover = (v) => {
  ctx.__v = v;
  R('for (const p of __v.parts.filter((p) => p.def.separator)) if (__v.byId.has(p.id)) cutSeparator(p.id, __v.adj, __v.control.id); __v.splitComponents(); delete this.__v;');
  v.placeOnSurface(ctx.MOON, 0.2592, ctx.VEHICLE_KINDS[v.kind].launchRot);
};
// keeping to the road the way a player would: steer back towards its middle (z = 0) and along it (heading east)
const LOC = {}, keepLane = (v) => {
  ctx.Terrain.locate(v.body, v.x, v.y, v.z, LOC);
  v.ctl.h = Math.max(-1, Math.min(1, -0.05 * LOC.z - 3 * (v.heading() - Math.PI / 2)));
};
// cornering: full stick to speed V, then hold V (a stick at V/TOP: the drive is a speed controller) with full right steer for 5 s
const corner = (V) => (v, t, st) => {
  if (st.go == null && fwd(v) >= V) st.go = t;
  v.ctl.v = st.go == null ? 1 : V / TOP; v.ctl.h = st.go == null ? 0 : 1;
  return st.go == null || t < st.go + 5;
};
// take-off roll (us4.test.js's script): staged, full throttle, attitude hold; full back stick from 1.15× the stall speed
// while the nose is under 10°; runs until 4 s after the wheels leave the ground
const takeoff = { setup(v, st) { st.vs = Math.sqrt((2 * v.mass * 9.80665) / (1.2 * v.clS)); G.stage(v); v.throttle = 1; v.sas = 'hold'; },
  script(v, t, st) {
    if (st.lift == null && !v.wheelsDown && v.groundAltitude() > 1) st.lift = t;
    v.ctl.v = v.airspeed > st.vs * 1.15 && v.attitude().pitch * D < 10 && v.groundAltitude() < 200 ? -1 : 0; v.ctl.h = v.ctl.r = 0;
    return st.lift == null || t < st.lift + 4;
  }, secs: 60 };

const SCENARIOS = {
  'buggy forward': { key: 'buggy', secs: 14, script: (v, t) => { v.ctl.v = t < 10 ? 1 : 0; } }, // 10 s flat out down the runway, then 4 s coasting
  'buggy corner 10': { key: 'buggy', secs: 30, script: corner(10) },
  'buggy corner 20': { key: 'buggy', secs: 30, script: corner(20) },
  'buggy corner 30': { key: 'buggy', secs: 30, script: corner(30) },
  'buggy brake': { key: 'buggy', secs: 30, script: (v, t, st) => { // to 20 m/s, then let go and hold the brake for 4 s
    if (st.go == null && fwd(v) >= 20) st.go = t;
    v.ctl.v = st.go == null ? 1 : 0; v.brake = st.go != null;
    return st.go == null || t < st.go + 4;
  } },
  'buggy reverse': { key: 'buggy', secs: 8, script: (v, t) => { v.ctl.v = -1; v.ctl.h = t >= 5 ? -1 : 0; } }, // 5 s straight back, then 3 s full left
  'buggy causeway': { key: 'buggy', secs: 20, place: onEarth(ctx.EARTH.causeway.from - 300), script: (v) => { v.ctl.v = 1; keepLane(v); } }, // down the ramp from the runway's end and out along the causeway
  'buggy slope': { key: 'buggy', secs: 10, place: onEarth(SLOPE.e, SLOPE.z, SLOPE.yaw), script: (v, t) => { v.ctl.v = t < 6 ? 1 : 0; } }, // 6 s uphill, then 4 s stopped on it
  'buggy sea': { key: 'buggy', secs: 6, place: onEarth(ctx.EARTH.sites.bay.east), script: (v) => { v.ctl.v = 1; } }, // the sea is solid ground that drags (the bay, where seaplanes start)
  'dragonfly roll': { key: 'dragonfly', secs: 5, setup: (v) => { v.throttle = 0; }, script: (v, t) => { v.ctl.v = 1; v.ctl.h = t >= 3 ? 1 : 0; } }, // rotor idle (Flight.start)
  'rover roll': { key: 'rover', secs: 6, place: moonRover, script: (v, t) => { v.ctl.v = 1; v.ctl.h = t >= 4 ? 1 : 0; } },
  'falcon takeoff': { key: 'falcon', ...takeoff },
  'mustang takeoff': { key: 'mustang', ...takeoff },
  'fs16 takeoff': { key: 'fs16', ...takeoff },
};

const f17 = (x) => (typeof x === 'number' ? x.toPrecision(17) : x ? '1' : '0');
// one sample: position from the start (m), velocity, attitude, spin, landed / wheels down / splashed / can drive, g
const sample = (v, p0) => [v.x - p0.x, v.y - p0.y, v.z - p0.z, v.vx, v.vy, v.vz, v.q.w, v.q.x, v.q.y, v.q.z, v.av.x, v.av.y, v.av.z, v.gForce || 0]
  .map(f17).join(' ') + ' ' + [v.landed, v.wheelsDown, v.splashed, v.canDrive].map(f17).join('');
function run(sc) {
  const T = ctx.TEMPLATES[sc.key], v = G.craft(ctx, G.templateRows(ctx, sc.key), T.kind || 'rocket'), s = G.sim(), st = {};
  Object.assign(s, { active: v, vessels: [v], firing: false, destroyed: false });
  if (sc.place) sc.place(v);
  if (sc.setup) sc.setup(v, st);
  const p0 = { x: v.x, y: v.y, z: v.z }, out = { '0.00': sample(v, p0) };
  let f = 0;
  for (; f < sc.secs * FPS; f++) {
    if (sc.script(v, f / FPS, st) === false) break;
    for (let i = 0; i < SUB; i++) { v.physicsStep(h, s); ctx.Combat.step(h, s); s.time += h; }
    if (v.dead || !v.parts.length) { f++; break; }
    if ((f + 1) % 15 === 0) out[((f + 1) / FPS).toFixed(2)] = sample(v, p0);
  }
  out.end = (f / FPS).toFixed(4) + ' s: ' + sample(v, p0);
  if (st.lift != null) out.liftoff = st.lift.toFixed(4) + ' s';
  out.broken = s.broken.join(' ');
  out.parts = v.parts.length;
  return out;
}

const names = Object.keys(SCENARIOS).filter((k) => !ARGS.length || ARGS.some((a) => k.includes(a)));
const first = {}, again = {};
for (const k of names) first[k] = run(SCENARIOS[k]);
for (const k of names) again[k] = run(SCENARIOS[k]); // the second pass starts with the terrain caches the first left
const odd = names.filter((k) => JSON.stringify(first[k]) !== JSON.stringify(again[k]));
for (const k of odd) console.log(`FAIL ${k}: two runs in one process differ (not deterministic)`);
if (odd.length) process.exitCode = 1;
for (const k of names) {
  const o = first[k], n = Object.keys(o).filter((x) => /^\d/.test(x)).length;
  console.log(`${k.padEnd(16)} ${o.end.split(':')[0].padStart(9)}  ${n} samples${o.liftoff ? ', lift-off at ' + o.liftoff : ''}${o.broken ? ', broke: ' + o.broken : ''}`);
}
if (ARGS.length) console.log('(a filtered run: not compared with the baseline)');
else check('driving', first, { show: Infinity });
