// Aim's instructor, after the PR #40 play-test (each check pins one of its findings, so it can't come back), every plane
// template unless a check says which, headless. The circle is kept fixed over the ground as Flight.planeTick keeps it.
//  1. a low pass: the circle on the horizon at 40 m over the sea holds the height (30-50 m), 0.6-1.4 g, no bucking;
//  2. the circle a little below the nose (6°, 10°, 15°, 25°) is pushed to with the wings about level (bank under 10°),
//     and levelling off from a 25° climb doesn't roll the plane over;
//  3. arriving from a 90° turn: no skid (sideslip under 6°) and the nose not past the aim by more than 3°;
//  4. a circle held on a target in a steady 4 g turn (fighters, 600 km/h): the nose within 2° of it 80% of the time;
//  5. the circle straight down from 5 km, and 45° down from 3 km, with Settings → Aim pulls out of dives on: the plane dives
//     at it and pulls out by itself at the last moment, at least 15 m up (50 m until PR #44), no wing past 110% of its
//     rating; 5b. with it off (the default since PR #45), 45° down from 3 km: it holds the dive, the nose on the circle
//     (within 3° 150 m up; the bomber and the Jumbo, that can't dive at 45°, 20°), and never pulls out by itself;
//  7. slow, the gear and full landing flaps down, the throttle shut, the circle level: no departure; a landing flown as a
//     player would (the speed held by the throttle down the glide, shut in the flare, the circle on a point 300 m down
//     the runway) touches down on its main wheels near it, gently, wings level;
//  8. the keys in Aim go through hold's limits: full back stick held at 950 km/h tears no wing;
//  9. stirring the circle hard left and right at 1,100 km/h: no wing past 105% of its rating; hold at its g limit raises
//     no over-g warning (Flight.structAlert) while under the rating;
// 10. the circle 10° up and 10° right: the nose ends within 1° of it (no steady gap away from the horizon);
// 12. on the runway, a level circle: the plane lifts off rather than racing down the runway (under 2.8 times its stall
//     speed a second later, at full throttle; the deltas, slow to rotate, under 6), and a circle 10° right of the
//     runway's line steers the roll round to it;
// 13. Off's AoA cap holds below 1 g speed (a Sugoi-27 at 300 km/h, 8 km, full back stick: no more than the stall + 10°);
// 14. the Albatross (a glider) with the circle straight up: no departure, it runs out of speed and comes back down;
// 15. the circle put on the cross, 2 km up, stays on it (the nose within 1° 3 s later: the nose flies to the circle, the
//     flight path only low down and landing);
// 16. a flick 3° right or 3° down is reached within 0.75° in under 1 s (the bomber and the Jumbo 1.5 s), no more than 2° past.
// About four minutes.   node test/instructor.test.js [check numbers, e.g. 1,4]
const G = require('./lib/game.js');
const ctx = G.load({ props: true, flight: true });
const t = G.checks("planes: Aim's instructor (the play-test's findings)");
const D = 180 / Math.PI, dt = 1 / 120, G0 = 9.80665;
const only = (process.argv[2] || '').split(',').filter(Boolean).map(Number);
const want = (n) => !only.length || only.includes(n);
G.run(ctx, 'this.__air = airDensity; this.__sf = surfaceFrame; this.__qaxis = qaxis; this.__qmul = qmul;');
const PLANES = Object.keys(ctx.TEMPLATES).filter((k) => ctx.TEMPLATES[k].kind === 'plane');
const FIGHTERS = ['hornet', 'viper', 'falcon', 'myg21', 'fs4', 'fs16', 'myg29', 'fs15', 'sugoi27', 'sugoi35', 'fs22', 'fs35', 'sugoi57'];

// ---- helpers (as test/planes.test.js and the play-test's lab)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const upOf = (v) => { const r = v.radius(); return { x: v.x / r, y: v.y / r, z: v.z / r }; };
const noseOf = (v) => { const P = v.pilot; return v.axis(P.F.x, P.F.y, P.F.z); };
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * D;
const rates = (v) => { const P = v.pilot, w = v.bodyAV(), d = (a) => w.x * a.x + w.y * a.y + w.z * a.z; return { pitch: d(P.R), roll: d(P.F), yaw: -d(P.U) }; };
const departed = (v) => { const r = rates(v); return Math.abs(v.slip || 0) > 0.45 || Math.abs(r.yaw) > 1 || Math.abs(v.aoa || 0) > 1.05 || Math.hypot(r.pitch, r.roll, r.yaw) > 5.4; };
function frame(v) {
  const F0 = noseOf(v), U = upOf(v), k = dot(F0, U), Fl = norm({ x: F0.x - U.x * k, y: F0.y - U.y * k, z: F0.z - U.z * k });
  return { Fl, U, Rt: { x: Fl.y * U.z - Fl.z * U.y, y: Fl.z * U.x - Fl.x * U.z, z: Fl.x * U.y - Fl.y * U.x } };
}
function dirAt(Fr, az, el) {
  const ca = Math.cos(az / D), sa = Math.sin(az / D), ce = Math.cos(el / D), se = Math.sin(el / D);
  return norm({ x: Fr.Fl.x * ca * ce + Fr.Rt.x * sa * ce + Fr.U.x * se, y: Fr.Fl.y * ca * ce + Fr.Rt.y * sa * ce + Fr.U.y * se, z: Fr.Fl.z * ca * ce + Fr.Rt.z * sa * ce + Fr.U.z * se });
}
// a direction kept fixed over the ground (east, up, north at the craft), as Flight.planeTick keeps the circle
const local = (v) => { const F = ctx.__sf(v.x, v.y, v.z); return { e: { ...F.east }, u: { ...F.up }, n: { ...F.north } }; };
const toLoc = (F, a) => ({ x: dot(a, F.e), y: dot(a, F.u), z: dot(a, F.n) });
const toSim = (F, a) => ({ x: F.e.x * a.x + F.u.x * a.y + F.n.x * a.z, y: F.e.y * a.x + F.u.y * a.y + F.n.y * a.z, z: F.e.z * a.x + F.u.z * a.y + F.n.z * a.z });
function air(key, V, alt, sas = 'hold', throttle = 0.85) {
  const v = G.craft(ctx, G.templateRows(ctx, key), 'plane'), s = G.sim();
  const u = { x: v.x / v.radius(), y: v.y / v.radius() }, r = ctx.EARTH.radius + alt;
  v.x = u.x * r; v.y = u.y * r; v.landed = false; v.vx = u.y * V; v.vy = -u.x * V;
  v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true;
  if (key !== 'albatross') G.stage(v);
  v.throttle = throttle; v.sas = sas;
  return { v, s };
}
function run(v, s, secs, input, each) {
  for (let i = 0; i < Math.round(secs / dt); i++) {
    v.ctl.v = 0; v.ctl.h = 0; v.ctl.r = 0;
    if (input) input(v, i * dt);
    v.physicsStep(dt, s); s.time += dt;
    if (v.dead || !v.parts.length) return false;
    if (each && each(v, (i + 1) * dt) === false) break;
  }
  return true;
}
const vstall = (v, alt) => Math.sqrt((2 * v.mass * G0) / (ctx.__air(ctx.EARTH, alt) * v.clS));
const speedOf = (key) => { const p = air(key, 100, 2000).v; return p.vne < 160 ? Math.min(110, 0.75 * p.vne) : 200; };
// the aim fixed over the ground: az° right, el° up of where the nose points now
function aimFixed(v, az, el) { const Floc = toLoc(local(v), dirAt(frame(v), az, el)); return (vv) => { vv.aimDir = toSim(local(vv), Floc); }; }

// ---- 1. a low pass
if (want(1)) {
  const bad = [];
  for (const key of PLANES) {
    const { v, s } = air(key, speedOf(key), 40, 'hold', 0.8);
    // out over the sea: 25 km round the planet the other way
    const r = v.radius(), da = 25000 / r, a = Math.atan2(v.y, v.x) + da, c = Math.cos(da), sn = Math.sin(da), vx = v.vx, vy = v.vy;
    v.x = Math.cos(a) * r; v.y = Math.sin(a) * r; v.vx = vx * c - vy * sn; v.vy = vx * sn + vy * c; v.q = ctx.__qmul(ctx.__qaxis(0, 0, 1, da), v.q);
    run(v, s, 1);
    const aim = aimFixed(v, 0, 0); v.sas = 'aim';
    let lo = 1e9, hi = -1e9, gl = 9, gh = -9;
    const ok = run(v, s, 25, aim, (vv, tt) => { if (tt < 5) return; const h = vv.groundAltitude(); lo = Math.min(lo, h); hi = Math.max(hi, h); gl = Math.min(gl, vv.nz || 0); gh = Math.max(gh, vv.nz || 0); });
    if (!ok || lo < 28 || hi > 50 || gl < 0.6 || gh > 1.4) bad.push(`${key} ${Math.round(lo)}-${Math.round(hi)} m, ${gl.toFixed(1)}-${gh.toFixed(1)} g${ok ? '' : ' CRASHED'}`);
  }
  t('1. a low pass, the circle on the horizon at 40 m over the sea: every plane holds 28-50 m, 0.6-1.4 g (before: bucking up to 120-150 m, -0.8 to 6.8 g)', !bad.length, bad.join(' | ') || undefined);
}

// ---- 2. below the nose: a push, not a roll
if (want(2)) {
  const bad = [];
  for (const key of PLANES) {
    for (const el of [-6, -10, -15, -25]) {
      const { v, s } = air(key, speedOf(key), 3000, 'hold', 0.6);
      run(v, s, 2);
      const aim = aimFixed(v, 0, el); v.sas = 'aim';
      let bank = 0;
      run(v, s, 8, aim, (vv) => { bank = Math.max(bank, Math.abs(vv.attitude().bank) * D); });
      if (bank > 10) bad.push(`${key} ${el}°: bank ${bank.toFixed(0)}°`);
    }
  }
  for (const key of ['fs16', 'mustang', 'hornet', 'jumbo', 'skylark', 'sugoi27', 'falcon']) {
    const { v, s } = air(key, 600 / 3.6, 2000, 'hold', 1);
    run(v, s, 0.5);
    v.sas = 'aim';
    run(v, s, 8, aimFixed(v, 0, 25));
    let bank = 0;
    run(v, s, 8, aimFixed(v, 0, 0), (vv) => { bank = Math.max(bank, Math.abs(vv.attitude().bank) * D); });
    if (bank > 15) bad.push(`${key} levelling off from a climb: bank ${bank.toFixed(0)}°`);
  }
  t('2. the circle 6-25° below the nose: pushed to with the wings about level (bank under 10°, every plane), and levelling off from a 25° climb under 15° of bank (before: half rolls of 114-180°)', !bad.length, bad.join(' | ') || undefined);
}

// ---- 3. arriving from a 90° turn
if (want(3)) {
  const bad = [];
  for (const key of PLANES) {
    if (key === 'albatross') continue; // (a glider: slow, its own check below)
    const { v, s } = air(key, speedOf(key), 2000, 'hold', 0.9);
    run(v, s, 1);
    const aim = aimFixed(v, 90, 0); v.sas = 'aim';
    let slip = 0, past = 0, on = false;
    run(v, s, 18, aim, (vv) => {
      slip = Math.max(slip, Math.abs(vv.slip || 0) * D);
      const n = noseOf(vv), F = frame(vv), A = vv.aimDir, az = Math.atan2(dot(A, F.Rt), dot(A, F.Fl)) * D;
      if (ang(n, vv.aimDir) < 6) on = true;
      if (on) past = Math.max(past, -az); // (the aim now left of the nose: the nose past it)
    });
    if (slip > 6 || past > 3) bad.push(`${key}: slip ${slip.toFixed(1)}°, past the aim ${past.toFixed(1)}°`);
  }
  t('3. arriving from a 90° turn: no skid (sideslip under 6°) and the nose no more than 3° past the aim (before: 14-25° of sideslip, 19° of swing on the FS-16, FS-35, MyG-29, FS-22)', !bad.length, bad.join(' | ') || undefined);
}

// ---- 4. tracking a target in a steady 4 g turn
if (want(4)) {
  const bad = [], sums = [];
  for (const key of FIGHTERS) {
    const V = 600 / 3.6, { v, s } = air(key, V, 2500, 'hold', 0.95);
    run(v, s, 0.5);
    const f = noseOf(v), T = { x: v.x + f.x * 700, y: v.y + f.y * 700, z: v.z + f.z * 700, vx: f.x * V, vy: f.y * V, vz: f.z * V };
    v.sas = 'aim';
    let n = 0, n2 = 0, sum = 0;
    run(v, s, 20, (vv, tt) => {
      const R = Math.hypot(T.x, T.y, T.z), u = { x: T.x / R, y: T.y / R, z: T.z / R }, vd = norm({ x: T.vx, y: T.vy, z: T.vz });
      const side = { x: vd.y * u.z - vd.z * u.y, y: vd.z * u.x - vd.x * u.z, z: vd.x * u.y - vd.y * u.x }, a = tt > 2 ? G0 * Math.sqrt(15) : 0;
      T.vx += side.x * a * dt; T.vy += side.y * a * dt; T.vz += side.z * a * dt;
      const k = vv.speed() / Math.hypot(T.vx, T.vy, T.vz); T.vx *= k; T.vy *= k; T.vz *= k;
      T.x += T.vx * dt; T.y += T.vy * dt; T.z += T.vz * dt;
      vv.aimDir = norm({ x: T.x - vv.x, y: T.y - vv.y, z: T.z - vv.z });
    }, (vv, tt) => { if (tt < 5) return; const e = ang(noseOf(vv), vv.aimDir); n++; sum += e; if (e < 2) n2++; });
    sums.push(`${key} ${(sum / n).toFixed(1)}°`);
    if (n2 / n < 0.8) bad.push(`${key}: within 2° ${Math.round((100 * n2) / n)}% of the time, mean ${(sum / n).toFixed(1)}°`);
  }
  t(`4. the circle held on a target in a 4 g turn at 600 km/h: every fighter's nose within 2° of it 80% of the time (mean error: ${sums.join(', ')}; before: 6.6-7.0°)`, !bad.length, bad.join(' | ') || undefined);
}

// ---- 5. dives
if (want(5)) {
  const bad = [], lows = [];
  for (const [el, alt] of [[-89, 5000], [-45, 3000]]) {
    for (const key of PLANES) {
      const { v, s } = air(key, speedOf(key), alt, 'hold', 0.9);
      run(v, s, 1);
      const aim = aimFixed(v, 0, el); v.sas = 'aim'; v.aimPull = true; // (Settings → Aim pulls out of dives: on)
      let minH = 1e9, strain = 0;
      const ok = run(v, s, el < -60 ? 30 : 25, aim, (vv) => { minH = Math.min(minH, vv.groundAltitude()); strain = Math.max(strain, vv.strain || 0); });
      lows.push(minH);
      if (!ok || minH < 15 || strain > 1.1 || s.broken.some((b) => b.startsWith('rip'))) bad.push(`${key} ${el}° from ${alt} m: ${ok ? Math.round(minH) + ' m' : 'CRASHED'}, strain ${strain.toFixed(2)} ${s.broken.join(';')}`);
    }
  }
  t(`5. the circle straight down from 5 km and 45° down from 3 km, Aim pulls out of dives on: every plane dives at it and pulls out by itself at the last moment, at least 15 m up (lowest ${Math.round(Math.min(...lows))} m; 50 m until PR #44, when the floor still looked 6 s ahead under a circle on the ground), no wing past 110% of its rating nor torn off (before PR #40: the Kestrel, the bomber and the Jumbo hit the ground)`, !bad.length, bad.join(' | ') || undefined);
}

// ---- 5b. the pull-out off (the default since PR #45): the dive held into the ground
if (want(5)) {
  const bad = [], errs = [];
  for (const key of PLANES) {
    const { v, s } = air(key, speedOf(key), 3000, 'hold', 0.9);
    run(v, s, 1);
    const aim = aimFixed(v, 0, -45); v.sas = 'aim'; v.aimPull = false;
    let a150 = null, vs = -1e9;
    const ok = run(v, s, 25, aim, (vv) => { const h = vv.groundAltitude(); if (h < 150) { if (a150 == null) a150 = ang(noseOf(vv), vv.aimDir); vs = Math.max(vs, vv.vSpeed()); } });
    if (a150 == null) continue; // (the slow ones, held short of their speed limit, never get down in 25 s)
    errs.push(`${key} ${a150.toFixed(1)}°`);
    if (a150 > (['bomber', 'jumbo'].includes(key) ? 20 : 3)) bad.push(`${key}: the nose ${a150.toFixed(1)}° off the circle 150 m up`);
    if (vs > -30) bad.push(`${key}: pulled out by itself (${ok ? Math.round(v.groundAltitude()) + ' m up' : 'then crashed'}, climbing at ${vs.toFixed(0)} m/s)`);
  }
  t(`5b. the pull-out off (the default since PR #45), the circle 45° down from 3 km: every plane that gets down holds the dive into the ground, never pulling out by itself, the nose on the circle 150 m up (${errs.join(', ')})`, !bad.length, bad.join(' | ') || undefined);
}

// ---- 7. slow with the gear and flaps down; a landing
if (want(7)) {
  const bad = [];
  for (const key of PLANES) {
    const probe = air(key, 100, 2000).v, Vs = vstall(probe, 2000), { v, s } = air(key, 1.3 * Vs, 2000, 'hold', 0);
    v.gearUp = false; for (const p of v.wheels) p.retracted = false; v.flaps = 1;
    run(v, s, 0.5);
    const aim = aimFixed(v, 0, 0); v.sas = 'aim';
    let dep = false;
    const ok = run(v, s, 30, aim, (vv) => { if (departed(vv)) dep = true; });
    if (dep || !ok) bad.push(`${key}: ${dep ? 'departed' : 'crashed'}`);
  }
  t('7a. slow (1.3 times the stall speed), the gear and full landing flaps down, the throttle shut, the circle level: no plane departs (before: the Barnstormer, the Bushhopper and both Sugois)', !bad.length, bad.join(' | ') || undefined);
  const land = [];
  for (const [key, kV] of [['skylark', 1.4], ['mustang', 1.4], ['hornet', 1.4], ['fs16', 1.4], ['sugoi27', 1.4], ['fs22', 1.4], ['jumbo', 1.4], ['viper', 1.6]]) {
    const v = G.craft(ctx, G.templateRows(ctx, key), 'plane'), s = G.sim();
    G.stage(v);
    const f = noseOf(v), U = upOf(v), vs = vstall(v, 0), V = kV * vs, d0 = 5000, h0 = d0 * Math.tan(3 / D), g = 3 / D;
    const R0 = { x: v.x + f.x * 300, y: v.y + f.y * 300, z: v.z + f.z * 300 };
    v.x += -f.x * d0 + U.x * h0; v.y += -f.y * d0 + U.y * h0; v.z += -f.z * d0 + U.z * h0;
    v.vx = (f.x * Math.cos(g) - U.x * Math.sin(g)) * V; v.vy = (f.y * Math.cos(g) - U.y * Math.sin(g)) * V; v.vz = (f.z * Math.cos(g) - U.z * Math.sin(g)) * V;
    v.landed = false; v.gearUp = false; v.flaps = 1; v.throttle = 0.3; v.sas = 'aim';
    let td = null, ti = 0;
    run(v, s, 150, (vv) => {
      vv.aimDir = norm({ x: R0.x - vv.x, y: R0.y - vv.y, z: R0.z - vv.z });
      if (vv.groundAltitude() > 10) { const e = V - vv.speed(); ti = Math.max(-1, Math.min(1, ti + e * 0.02 * dt)); vv.throttle = Math.max(0, Math.min(1, 0.3 + e * 0.08 + ti)); } else vv.throttle = 0;
    }, (vv) => {
      if (!vv.wheelsDown) return;
      const at = vv.attitude(), along = (vv.x - R0.x) * f.x + (vv.y - R0.y) * f.y + (vv.z - R0.z) * f.z;
      td = { along: Math.round(along), pitch: at.pitch * D, bank: at.bank * D, sink: -vv.vSpeed() };
      return false;
    });
    if (!td || td.along < -100 || td.along > 1000 || td.pitch < -1 || Math.abs(td.bank) > 5 || td.sink > 2.5 || s.broken.length) land.push(`${key}: ${td ? `${td.along} m from the circle, pitch ${td.pitch.toFixed(1)}°, bank ${td.bank.toFixed(1)}°, sink ${td.sink.toFixed(1)} m/s` : 'no touchdown'} ${s.broken.join(';')}`);
  }
  t('7b. a landing flown as a player would (the circle on a point 300 m down the runway, the approach speed held, the throttle shut in the flare): it touches down within 1 km past it, main wheels first, wings level, under 2.5 m/s (before: 3-4 km short, or nose first)', !land.length, land.join(' | ') || undefined);
}

// ---- 8. the keys in Aim, within hold's limits
if (want(8)) {
  const bad = [];
  for (const key of ['jumbo', 'bomber', 'kestrel', 'fs16', 'skylark']) {
    const probe = air(key, 100, 1000).v, V = Math.min(950 / 3.6, (0.97 * probe.vne) / Math.sqrt(ctx.__air(ctx.EARTH, 1000) / 1.225));
    const { v, s } = air(key, V, 1000, 'aim', 0.85);
    v.aimDir = noseOf(v);
    let n = 0;
    run(v, s, 8, (vv) => { vv.ctl.v = -1; }, (vv) => { n = Math.max(n, vv.nz || 0); });
    const lim = Math.min(Math.max(2, 0.9 * probe.gRating()), 9.5);
    if (s.broken.length || n > lim * 1.08) bad.push(`${key}: ${n.toFixed(1)} g (limit ${lim.toFixed(1)}) ${s.broken.join(';')}`);
  }
  t("8. the keys in Aim go through hold's limits: full back stick held 8 s at up to 950 km/h tears no wing and pulls no more than 8% past 0.9 of the rating (before: a Jumbo lost a wing in 5.6 s)", !bad.length, bad.join(' | ') || undefined);
}

// ---- 9. rolling g; the warning while held at the limit
if (want(9)) {
  const bad = [];
  for (const key of PLANES) {
    const probe = air(key, 100, 1000).v, V = Math.min(1100 / 3.6, (0.95 * probe.vne) / Math.sqrt(ctx.__air(ctx.EARTH, 1000) / 1.225));
    const { v, s } = air(key, V, 1000, 'hold', 1);
    run(v, s, 1);
    v.sas = 'aim';
    let strain = 0;
    run(v, s, 12, (vv, tt) => { vv.aimDir = dirAt(frame(vv), 70 * Math.sign(Math.sin((tt * Math.PI) / 2)), 0); }, (vv) => { strain = Math.max(strain, vv.strain || 0); });
    if (strain > 1.05 || s.broken.length) bad.push(`${key}: strain ${strain.toFixed(2)} ${s.broken.join(';')}`);
  }
  t('9a. the circle stirred hard left and right at 1,100 km/h (reversals under load): no wing past 105% of its rating (before: up to 129% on the deltas\' rolling wing half)', !bad.length, bad.join(' | ') || undefined);
  const warn = [];
  for (const key of ['jumbo', 'bomber', 'fs16', 'hornet']) {
    const probe = air(key, 100, 1000).v, V = Math.min(950 / 3.6, (0.97 * probe.vne) / Math.sqrt(ctx.__air(ctx.EARTH, 1000) / 1.225));
    const { v, s } = air(key, V, 1000, 'hold', 0.85);
    let w = 0;
    run(v, s, 6, (vv) => { vv.ctl.v = -1; }, (vv) => { const a = ctx.Flight.structAlert.call({ destroyed: false }, vv); if (a && a.kind === 'g' && vv.strain <= 1) w += dt; });
    if (w > 0) warn.push(`${key}: over-g warning ${w.toFixed(2)} s under the rating`);
  }
  t('9b. hold pulling full back stick at up to 950 km/h, kept within its limits: no over-g warning while under the wings\' rating (before: the Jumbo warned)', !warn.length, warn.join(' | ') || undefined);
}

// ---- 10. no steady gap away from the horizon
if (want(10)) {
  const bad = [];
  for (const key of PLANES) {
    const { v, s } = air(key, speedOf(key), 2000, 'hold', 0.7);
    run(v, s, 1);
    const aim = aimFixed(v, 10, 10); v.sas = 'aim';
    let sum = 0, n = 0;
    run(v, s, 14, aim, (vv, tt) => { if (tt > 10) { sum += ang(noseOf(vv), vv.aimDir); n++; } });
    if (sum / n > 1) bad.push(`${key}: ${(sum / n).toFixed(2)}°`);
  }
  t('10. the circle 10° right and 10° up: the nose settles within 1° of it (before: a steady 2-3° gap)', !bad.length, bad.join(' | ') || undefined);
}

// ---- 12. on the runway
if (want(12)) {
  const bad = [];
  for (const key of PLANES) {
    if (key === 'albatross' || key === 'seagull') continue;
    for (const az of [0, 10]) {
      const v = G.craft(ctx, G.templateRows(ctx, key), 'plane'), s = G.sim();
      G.stage(v); v.throttle = 1; v.sas = 'aim'; v.gearUp = false;
      run(v, s, 0.5);
      const Fr = frame(v), A = dirAt(Fr, az, 0), vs = vstall(v, 0), hdg = () => { const n = noseOf(v); return Math.atan2(dot(n, Fr.Rt), dot(n, Fr.Fl)) * D; };
      let lift = null, airT = 0, h6 = null;
      run(v, s, az ? 6 : 30, (vv) => { vv.aimDir = A; }, (vv, tt) => {
        airT = vv.wheelsDown ? 0 : airT + dt; if (airT > 1 && !lift) lift = vv.speed() / vs;
        if (az && h6 == null && (tt >= 5.99 || airT > 0.5)) h6 = hdg(); // (the roll's heading: half a second off the ground, or at 6 s)
      });
      const fast = ['viper', 'falcon'].includes(key) ? 6 : 2.8; // (a second after leaving the ground, full throttle; the deltas rotate late: their small controls on the ground)
      if (!az && (!lift || lift > fast)) bad.push(`${key}: lift-off ${lift ? lift.toFixed(2) + ' Vs' : 'none'}`);
      if (az && !(h6 > 2 && h6 < 12)) bad.push(`${key}: heading ${h6 == null ? '-' : h6.toFixed(1)}° at the end of the roll (the circle 10° right)`);
    }
  }
  t('12. on the runway with a level circle: every plane lifts off (a second later under 2.8 times its stall speed, the deltas under 6), and a circle 10° right steers the roll round to it (2-12° round as it leaves the ground, or 6 s in) (before: it only pitched, and an FS-16 raced to 1,206 km/h)', !bad.length, bad.join(' | ') || undefined);
}

// ---- 13. Off's AoA cap below 1 g speed
if (want(13)) {
  const bad = [];
  for (const key of ['sugoi27', 'sugoi35', 'fs22', 'fs16', 'hornet']) {
    const { v, s } = air(key, 300 / 3.6, 8000, 'manual', 0.85);
    run(v, s, 0.5);
    let aoa = 0;
    run(v, s, 6, (vv) => { vv.ctl.v = -1; }, (vv) => { aoa = Math.max(aoa, (vv.aoa || 0) * D); });
    if (aoa > v.stallAoA * D + 10) bad.push(`${key}: ${aoa.toFixed(0)}° (stall ${(v.stallAoA * D).toFixed(0)}°)`);
  }
  t("13. Off, full back stick below the 1 g speed (300 km/h, 8 km): the AoA no more than the stall + 10° (before: a Sugoi-27 to 74°)", !bad.length, bad.join(' | ') || undefined);
}

// ---- 14. the glider straight up
if (want(14)) {
  const { v, s } = air('albatross', 375 / 3.6, 2000, 'hold', 0.9);
  run(v, s, 1);
  const aim = aimFixed(v, 0, 89); v.sas = 'aim';
  let dep = false, top = 0;
  run(v, s, 25, aim, (vv) => { if (departed(vv)) dep = true; top = Math.max(top, vv.attitude().pitch * D); });
  t(`14. the Albatross with the circle straight up: no departure, it comes back down before its speed runs out (highest pitch ${top.toFixed(0)}°; before: a tail slide)`, !dep && !s.broken.length, s.broken.join(';') || undefined);
}

// ---- 15, 16. the cross on the circle (the play-test after PR #42: "the circle feels odd, the planes don't respond")
// 2 km up at its cruise speed, the circle put on the nose (the cross) and held there 3 s; then flicked 3° right, or 3° down
const elOf = (v) => Math.asin(Math.max(-1, Math.min(1, dot(noseOf(v), upOf(v))))) * D;
const HEAVY = ['bomber', 'jumbo'];
if (want(15) || want(16)) {
  const gap = [], slow = [], past = [], sums = [];
  for (const key of PLANES) {
    for (const [nm, az, el] of [['3° right', 3, 0], ['3° down', 0, -3]]) {
      const { v, s } = air(key, speedOf(key), 2000, 'hold', 0.85);
      run(v, s, 1);
      let aim = aimFixed(v, 0, elOf(v)); v.sas = 'aim';
      let e0 = 0;
      run(v, s, 3, aim, (vv) => { aim(vv); e0 = ang(noseOf(vv), vv.aimDir); });
      if (nm === '3° right' && e0 > 1) gap.push(`${key} ${e0.toFixed(1)}°`);
      aim = aimFixed(v, az, elOf(v) + el);
      let tin = null, worst = 0;
      run(v, s, 3, aim, (vv, tt) => { aim(vv); const e = ang(noseOf(vv), vv.aimDir); if (tin == null) { if (e < 0.75) tin = tt; } else worst = Math.max(worst, e); });
      const lim = HEAVY.includes(key) ? 1.5 : 1;
      if (tin == null || tin > lim) slow.push(`${key} ${nm} ${tin == null ? 'never' : tin.toFixed(2) + ' s'}`);
      if (worst > 2) past.push(`${key} ${nm} ${worst.toFixed(1)}°`);
      if (tin != null) sums.push(tin);
    }
  }
  if (want(15)) t('15. the circle put on the cross (2 km up, cruising) stays on it: every plane\'s nose within 1° of it 3 s later (before: 3-13° over it, the flight path flown at the circle near the horizon at any height)', !gap.length, gap.join(' | ') || undefined);
  if (want(16)) t(`16. a flick of the circle 3° right or 3° down is reached: the nose within 0.75° in under 1 s (the bomber and the Jumbo 1.5 s), never more than 2° away after (mean ${(sums.reduce((a, b) => a + b, 0) / Math.max(1, sums.length)).toFixed(2)} s; before: a 3° flick down never reached, one to the side banked a slow FS-16 38° and swung 3° past)`, !slow.length && !past.length, [...slow, ...past].join(' | ') || undefined);
}
t.done();
