// Wings and speed: every wing's own breaking speed (equivalent airspeed, and a Mach number for the subsonic
// ones), flutter that warns first, then tears the wing off within seconds (at once far past it), the Mach limit
// up high and its fade in near-vacuum, noodle wings, debris that doesn't tear again, and the HUD warning.
//   node test/flutter.test.js
const G = require('./lib/game.js');
const ctx = G.load();
const R = (code) => G.run(ctx, code);
const t = G.checks('flutter: wing speed limits');
R('this.__wingAero = wingAero; this.__qbasis = qbasis; this.__soundSpeed = soundSpeed; this.__airDensity = airDensity; this.__Silly = Silly;');
const dt = 1 / 120;

// each wing's limit, as asked for (km/h at sea level, Mach): an independent table, not the code's own numbers
const WANT = {
  wingBiplane: [560, 0.75], wingGlider: [500, 0.7], wingStraightL: [750, 0.8], wing: [850, 0.85], wingElliptical: [850, 0.85],
  wingS: [900, 0.85], wingL: [950, 0.95], wingWinglet: [950, 0.97], wingSwept: [1350, 1.6], wingForward: [1400, 1.8],
  wingSwing: [1550, 2.4], wingDelta: [1600, 0], stabilizer: [2000, 0], stabilizerL: [2000, 0], wingStrake: [2000, 0],
};
const wings = Object.keys(ctx.PARTS).filter((k) => ctx.PARTS[k].wing && !ctx.PARTS[k].wing.control);
t('every fixed wing has a limit in the table', wings.every((k) => WANT[k]), wings.filter((k) => !WANT[k]).join(','));
const off = wings.filter((k) => WANT[k] && (Math.abs(ctx.__wingAero(ctx.PARTS[k]).vne * 3.6 - WANT[k][0]) > 3 || ctx.__wingAero(ctx.PARTS[k]).mmax !== WANT[k][1]));
t('each one breaks where it should (within 3 km/h)', !off.length, off.join(','));
t('moving surfaces have no speed limit', Object.keys(ctx.PARTS).filter((k) => ctx.PARTS[k].wing && ctx.PARTS[k].wing.control).every((k) => ctx.__wingAero(ctx.PARTS[k]).vne === 0));

// a template in level flight at `alt`, held at true airspeed V (km/h) for `secs`: what tore, when, the worst overspeed
function hold(key, kmh, alt, secs, opt = {}) {
  const v = G.craft(ctx, G.templateRows(ctx, key), 'plane', 'air'), s = G.sim();
  const V = kmh / 3.6, r = ctx.EARTH.radius + alt, N = { x: 0, y: -1, z: 0 }, Dn = { x: -1, y: 0, z: 0 };
  const Rt = { x: Dn.y * N.z - Dn.z * N.y, y: Dn.z * N.x - Dn.x * N.z, z: Dn.x * N.y - Dn.y * N.x };
  v.q = ctx.__qbasis(Dn, N, Rt); v.av = { x: 0, y: 0, z: 0 };
  v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true;
  G.stage(v); v.throttle = 0.5;
  v.ground = function () { this.landed = false; this.splashed = false; this.wheelsDown = false; };
  if (opt.prep) opt.prep(v);
  const n0 = v.parts.length;
  let tore = null, over = 0, alert = false, mach = false;
  for (let i = 0; i < secs / dt; i++) {
    v.x = r; v.y = 0; v.z = 0; v.vx = N.x * V; v.vy = N.y * V; v.vz = 0; // (held: speed and height fixed)
    v.physicsStep(dt, s); s.time += dt;
    if ((v.overspeed || 0) > over) { over = v.overspeed; mach = v.overMach; }
    if (v.overspeed > 0.9) alert = true;
    if (tore == null && s.broken.some((b) => b.startsWith('rip:'))) tore = i * dt;
    if (!v.parts.length) break;
  }
  return { tore, over, mach, alert, broken: s.broken, lost: n0 - v.parts.length, v, s };
}

// the Skylark's plain Wing: 850 km/h at sea level
const sk7 = hold('skylark', 700, 300, 10);
t('Skylark at 700 km/h low down: no warning, nothing breaks', sk7.tore == null && !sk7.alert, sk7.over.toFixed(2));
const sk8 = hold('skylark', 800, 300, 10);
t('at 800 km/h: the overspeed warning, but the wings hold', sk8.tore == null && sk8.alert, sk8.over.toFixed(2));
const sk9 = hold('skylark', 950, 300, 12);
t('at 950 km/h: it flutters, and the wing goes after a few seconds (not at once)', sk9.tore != null && sk9.tore > 2 && sk9.tore < 8, sk9.tore);
t('flutter is what tore it', sk9.broken.some((b) => /^rip:wing\b/.test(b)), sk9.broken.join(' '));
const sk12 = hold('skylark', 1150, 300, 1);
t('at 1150 km/h (1.35 times over): at once', sk12.tore != null && sk12.tore < 0.05, sk12.tore);
// the Mach limit: high up the equivalent airspeed is low, but a straight wing still can't go much faster
const skHi = hold('skylark', 1000, 9000, 6);
t('at 9 km, 1000 km/h (Mach 0.97, about 400 km/h EAS): torn off by the Mach limit', skHi.tore != null && skHi.mach === true, [skHi.tore, skHi.over.toFixed(2), skHi.mach].join(' '));
const skHi8 = hold('skylark', 800, 9000, 6);
t('at 9 km, 800 km/h (Mach 0.78): fine', skHi8.tore == null, skHi8.over.toFixed(2));
// in near-vacuum the Mach limit fades out: no dynamic pressure, no flutter
const skVac = hold('skylark', 1500, 29000, 3);
t('at 29 km, Mach 1.5, nearly no air: the wing stays on', skVac.tore == null, skVac.over.toFixed(2));

// biplane and supersonic wings
const ca = [hold('camel', 500, 300, 8), hold('camel', 620, 300, 8)];
t('Camel (biplane wings): fine at 500 km/h, torn off at 620', ca[0].tore == null && ca[1].tore != null, [ca[0].over.toFixed(2), ca[1].tore].join(' / '));
const vi = [hold('viper', 1450, 300, 6), hold('viper', 2400, 12000, 6), hold('viper', 1900, 300, 3)];
t('Viper (delta): fine at 1450 km/h low down and Mach 2.2 at 12 km; torn off at 1900 km/h low down',
  vi[0].tore == null && vi[1].tore == null && vi[2].tore != null, vi.map((x) => x.tore == null ? x.over.toFixed(2) : 't' + x.tore.toFixed(2)).join(' '));
const ho = [hold('hornet', 1250, 300, 6), hold('hornet', 1700, 300, 3), hold('hornet', 2000, 11000, 6)];
t('Hornet (swept): Mach 1 low down is fine; 1700 km/h low down tears it; Mach 1.8 at 11 km tears it (Mach 1.6 limit)',
  ho[0].tore == null && ho[1].tore != null && ho[2].tore != null, ho.map((x) => x.tore == null ? x.over.toFixed(2) : 't' + x.tore.toFixed(2)).join(' '));

// a wing torn off and still going far too fast doesn't tear again every step
const deb = hold('skylark', 1200, 300, 2);
const pieces = deb.s.broken.filter((b) => b.startsWith('rip:'));
t('one rip, not one per step, once the wing has gone', pieces.length === 1, pieces.join(' '));

// noodle wings: half the speed
R('Silly.flags.noodle = true');
const noo = R('Silly.on("noodle")') ? hold('skylark', 500, 300, 8) : null;
R('Silly.flags.noodle = false');
t('noodle wings: a Skylark at 500 km/h loses its wing (half of 850)', noo && noo.tore != null, noo ? noo.tore : 'could not turn noodle on');

t.done();
