// The US 3rd/4th-generation look-alikes (FS-4, FS-16, FS-15): their lofted bodies are well formed and join without a
// step, every part of each template holds on, a body's head-on drag counts only what it fills of its box, the stock
// fins keep their outline, and each jet takes off from the runway and reaches about its real top speed up high.
//   node test/us4.test.js
const G = require('./lib/game.js');
const ctx = G.load();
const R = (code) => G.run(ctx, code);
const t = G.checks('us4: FS-4, FS-16 and FS-15 look-alikes');
const KEYS = ['us4fs4', 'us4fs16', 'us4fs15'];
const D = 180 / Math.PI, dt = 1 / 120;

// 1. every lofted part: finite sections in rising order, the top above the waist above the bottom, inside its box lengthwise
const bad = R(`Object.keys(PARTS).filter((k) => PARTS[k].shape === 'us4body').filter((k) => {
  const d = PARTS[k];
  return d.body.tubes.some((T) => { const rows = us4Rows(T);
    return rows.some((r, i) => [r.y, r.xt, r.xw, r.xb, r.hw, r.nt, r.nb].some((v) => !Number.isFinite(v)) || r.xt > r.xw + 1e-9 || r.xw > r.xb + 1e-9 || r.hw < 0
      || (i && r.y < rows[i - 1].y - 1e-9) || Math.abs(r.y) > d.h / 2 + 1e-6); });
})`);
t('lofted bodies: finite sections in order, top over waist over bottom, within the part lengthwise', bad.length === 0, bad.join(','));
t('lofted bodies: each has a fill share between 0.3 and 1', R(`Object.keys(PARTS).filter((k) => PARTS[k].shape === 'us4body').every((k) => PARTS[k].fill > 0.3 && PARTS[k].fill <= 1)`));

// 2. joints: where two bodies on the centre line meet end to end, their centre tubes carry on with the same section: the
// same side profile everywhere, and the same width too, except where an engine section is wider at the front because it
// also caps the ends of the intake ducts either side
for (const key of KEYS) {
  const joints = R(`(() => {
    const ps = partsFromDesign(templateRows(TEMPLATES.${key})).filter((p) => p.def.shape === 'us4body' && !p.def.twinZ && !p.def.weapon), out = [];
    const main = (p) => us4Rows(p.def.body.tubes.find((T) => !T.z && (T.kind || 'hull') === 'hull'));
    for (const a of ps) for (const b of ps) {
      if (a === b || Math.abs((a.y + a.def.h / 2) - (b.y - b.def.h / 2)) > 0.01) continue;
      const ra = main(a), A = ra[ra.length - 1], B = main(b)[0];
      const gap = Math.max(...['xt', 'xw', 'xb'].map((f) => Math.abs(a.x + A[f] - (b.x + B[f]))), Math.abs(a.y + A.y - (b.y + B.y)), a.def.thrust ? 0 : Math.abs(A.hw - B.hw));
      out.push([a.type + '>' + b.type, +gap.toFixed(4)]);
    }
    return out;
  })()`);
  t(`${key}: the bodies meet end to end without a step (${joints.length} joints)`, joints.length >= 2 && joints.every(([, g]) => g < 0.002), joints);
}

// 3. every part of each template holds on (no loose parts), and the drag of a lofted body counts its fill
for (const key of KEYS) {
  const v = G.craft(ctx, ctx.templateRows(ctx.TEMPLATES[key]), 'plane');
  t(`${key}: all ${v.of} parts joined`, v.parts.length === v.of, `${v.parts.length}/${v.of}`);
}
t('a lofted body alone counts w x depth x fill head-on', R(`(() => { const p = makePart('us4f16Body', 0, 0), v = new Vessel([p], buildAdjacency([p]), EARTH); v.kind = 'plane'; v.rebuildGroups();
  const d = p.def; return Math.abs(v.area.y - d.w * d.depth * d.fill) < 1e-9; })()`));

// 4. the stock fins draw (and so build in 3D) exactly as before: def.vtail's defaults are the old outline
const path = (key, extra) => R(`(() => { const pts = [], c = { beginPath() {}, moveTo(x, y) { pts.push(x, y); }, lineTo(x, y) { pts.push(x, y); }, closePath() {} };
  const d = Object.assign({}, PARTS.${key}, ${JSON.stringify(extra)}); partPath0(c, { def: d, x: 1, y: 2, flip: true }); return pts; })()`);
t('a stock fin with the default fin fields has the outline it always had', JSON.stringify(path('vtail', {})) === JSON.stringify(path('vtail', { vtail: { rte: 0, tle: 0.4, tte: 0 } })));

// 5. flying: a take-off from the runway at full afterburner, then level at 11 km, full afterburner, for two minutes
function takeoff(key) {
  const v = G.craft(ctx, ctx.templateRows(ctx.TEMPLATES[key]), 'plane'), s = G.sim(), p0 = [v.x, v.y, v.z];
  const vs = Math.sqrt((2 * v.mass * 9.80665) / (1.2 * v.clS));
  G.stage(v); v.throttle = 1; v.sas = 'hold';
  let lift = null, dist = 0, tt = 0;
  for (; tt < 60 && !v.dead; tt += dt) {
    v.ctl.v = v.airspeed > vs * 1.15 && v.attitude().pitch * D < 10 && v.groundAltitude() < 200 ? -1 : 0; v.ctl.h = v.ctl.r = 0;
    v.physicsStep(dt, s);
    if (lift == null && !v.wheelsDown && v.groundAltitude() > 1) { lift = v.airspeed * 3.6; dist = Math.hypot(v.x - p0[0], v.y - p0[1], v.z - p0[2]); }
    if (lift != null && !v.gearUp && v.groundAltitude() > 30) { v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true; }
  }
  return { lift, dist, alt: v.groundAltitude(), broken: s.broken, parts: v.parts.length };
}
function topSpeed(key, alt, secs) {
  const v = G.craft(ctx, ctx.templateRows(ctx.TEMPLATES[key]), 'plane'), s = G.sim(), r0 = v.radius(), u = [v.x / r0, v.y / r0], r = r0 + alt, V = 1.5 * 296;
  v.x = u[0] * r; v.y = u[1] * r; v.landed = false; v.vx = u[1] * V; v.vy = -u[0] * V;
  v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true;
  G.stage(v); v.throttle = 1; v.sas = 'level';
  for (let tt = 0; tt < secs && !v.dead; tt += dt) { v.ctl.v = v.ctl.h = v.ctl.r = 0; v.physicsStep(dt, s); }
  return { M: v.mach, alt: v.altitude() - alt, broken: s.broken, warn: v.overWarn };
}
const BAND = { us4fs4: [1.95, 2.25], us4fs16: [1.9, 2.15], us4fs15: [2.3, 2.6] }; // the real ones: about Mach 2.2, 2.05 and 2.5
for (const key of KEYS) {
  const T = takeoff(key);
  t(`${key}: takes off from the runway (lifts off in under 1.5 km, climbs away, nothing breaks)`, T.lift != null && T.dist < 1500 && T.alt > 300 && !T.broken.length,
    `lift-off ${Math.round(T.lift)} km/h after ${Math.round(T.dist)} m, ${Math.round(T.alt)} m up a minute later${T.broken.length ? ', broke: ' + T.broken.join(';') : ''}`);
  const S = topSpeed(key, 11000, 150);
  t(`${key}: level at 11 km on full afterburner it settles at Mach ${BAND[key][0]}-${BAND[key][1]}, holding its height, short of the speed warning`,
    S.M >= BAND[key][0] && S.M <= BAND[key][1] && Math.abs(S.alt) < 300 && !S.broken.length && S.warn < 0.9, `Mach ${S.M.toFixed(2)}, ${Math.round(S.alt)} m off, warning at ${S.warn.toFixed(2)}`);
}
t.done();
