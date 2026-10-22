// Wings and speed: every wing's own breaking speed (equivalent airspeed, and a Mach number for the subsonic
// ones), flutter that warns first, then tears the wing off within seconds (at once far past it), the Mach limit
// up high and its fade in thin air (a space plane coming home), noodle wings, debris that doesn't tear again,
// and which warning the HUD shows.   node test/flutter.test.js
const G = require('./lib/game.js');
const ctx = G.load({ flight: true });
const R = (code) => G.run(ctx, code);
const t = G.checks('flutter: wing speed limits');
R('this.__wingAero = wingAero; this.__qbasis = qbasis; this.__soundSpeed = soundSpeed; this.__airDensity = airDensity;');
const dt = 1 / 120;

// each wing's limit, as asked for (km/h at sea level, Mach): an independent table, not the code's own numbers
const WANT = {
  wingBiplane: [560, 0.48], wingGlider: [500, 0.5], wingStraightL: [750, 0.66], wing: [850, 0.74], wingElliptical: [850, 0.74],
  wingS: [900, 0.74], wingL: [950, 1.02], wingWinglet: [950, 1.05], wingSwept: [1350, 1.7], wingForward: [1400, 1.8],
  wingSwing: [1550, 2.5], wingDelta: [1600, 0], stabilizer: [2000, 0], stabilizerL: [2000, 0], wingStrake: [2000, 0],
  // the US 3rd/4th-generation look-alikes: full afterburner level low down warns without tearing, and the Mach limit sits
  // a little past each jet's top speed up high (FS-4 about 2.2, FS-16 2.05, FS-15 2.5)
  us4f4Wing: [1510, 2.6], us4f16Wing: [1620, 2.4], us4f16Lerx: [2000, 0], us4f15Wing: [1620, 2.85],
};
const wings = Object.keys(ctx.PARTS).filter((k) => ctx.PARTS[k].wing && !ctx.PARTS[k].wing.control);
t('every fixed wing has a limit in the table', wings.every((k) => WANT[k]), wings.filter((k) => !WANT[k]).join(','));
const off = wings.filter((k) => WANT[k] && (Math.abs(ctx.__wingAero(ctx.PARTS[k]).vne * 3.6 - WANT[k][0]) > 3 || ctx.__wingAero(ctx.PARTS[k]).mmax !== WANT[k][1]));
t('each one breaks where it should (within 3 km/h)', !off.length, off.join(','));
t('moving surfaces have no speed limit', Object.keys(ctx.PARTS).filter((k) => ctx.PARTS[k].wing && ctx.PARTS[k].wing.control).every((k) => ctx.__wingAero(ctx.PARTS[k]).vne === 0));
// the HUD speed a plain Wing starts to flutter at, from the rule: within the 800-900 km/h asked for, at every height
// planes fly at (equivalent airspeed limit low down, the Mach limit higher up)
const band = [0, 1000, 2000, 3000, 5000, 8000, 12000].map((h) => {
  const rho = ctx.__airDensity(ctx.EARTH, h), a = ctx.__soundSpeed(ctx.EARTH, h);
  return Math.round(Math.min(850 / Math.sqrt(rho / 1.2), 0.74 * a * 3.6));
});
t('a plain Wing breaks at 780-910 km/h on the HUD from sea level to 12 km', band.every((k) => k >= 780 && k <= 910), band.join(' '));

// The sim stand-in, keeping the cause and the pieces that tear off (as Flight.ripParts does) so they fly on.
function sim() {
  const s = G.sim();
  s.ripParts = function (v, parts, cause = 'g') {
    this.broken.push(`rip(${cause}):` + parts.map((p) => p.type).join(',') + (v.isDebris ? ':debris' : ''));
    for (const p of parts) { for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.get(p.id).clear(); }
    for (const piece of v.splitComponents()) { piece.isDebris = !piece.control; this.vessels.push(piece); }
    v.rebuildGroups();
  };
  return s;
}
// a template in level flight at `alt`, held at true airspeed V (km/h) for `secs`: what tore, when, the worst
// overspeed and the HUD warnings. Pieces torn off fly on freely.
function hold(key, kmh, alt, secs, opt = {}) {
  const v = G.craft(ctx, G.templateRows(ctx, key), 'plane', 'air'), s = sim();
  const V = kmh / 3.6, r = ctx.EARTH.radius + alt, N = { x: 0, y: -1, z: 0 }, Dn = { x: -1, y: 0, z: 0 };
  const Rt = { x: Dn.y * N.z - Dn.z * N.y, y: Dn.z * N.x - Dn.x * N.z, z: Dn.x * N.y - Dn.y * N.x };
  v.q = ctx.__qbasis(Dn, N, Rt); v.av = { x: 0, y: 0, z: 0 };
  v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true;
  G.stage(v); v.throttle = 0.5;
  v.ground = function () { this.landed = false; this.splashed = false; this.wheelsDown = false; };
  if (opt.prep) opt.prep(v);
  let tore = null, over = 0, alert = false, mach = false;
  const alerts = new Set();
  for (let i = 0; i < secs / dt; i++) {
    v.x = r; v.y = 0; v.z = 0; v.vx = -(opt.sink || 0); v.vy = N.y * V; v.vz = 0; // (held: speed and height fixed; sink: a descent rate)
    if (opt.each) opt.each(v);
    v.physicsStep(dt, s); s.time += dt;
    for (const d of s.vessels) if (d.parts.length) d.physicsStep(dt, s);
    if ((v.overspeed || 0) > over) { over = v.overspeed; mach = v.overMach; }
    if (v.overspeed > 0.9) alert = true;
    const st = ctx.Flight.structAlert.call({ destroyed: false }, v);
    if (st) alerts.add(st.kind + st.level);
    if (tore == null && s.broken.some((b) => b.startsWith('rip'))) tore = i * dt;
    if (!v.parts.length) break;
  }
  return { tore, over, mach, alert, alerts, broken: s.broken, v, s };
}
const show = (x) => (x.tore == null ? x.over.toFixed(2) : 't' + x.tore.toFixed(2));

// the Skylark's plain Wing: 850 km/h at sea level
const sk7 = hold('skylark', 700, 300, 10);
t('Skylark at 700 km/h low down: no warning, nothing breaks', sk7.tore == null && !sk7.alert, sk7.over.toFixed(2));
const sk8 = hold('skylark', 800, 300, 10);
t('at 800 km/h: the overspeed warning, but the wings hold', sk8.tore == null && sk8.alert, sk8.over.toFixed(2));
const sk9 = hold('skylark', 950, 300, 12);
t('at 950 km/h: it flutters, and the wing goes after a few seconds (not at once)', sk9.tore != null && sk9.tore > 2 && sk9.tore < 8, sk9.tore);
t('flutter is what tore it', sk9.broken[0] === 'rip(speed):wing', sk9.broken.join(' '));
t('the warning: overspeed near the limit, "slow down" past it (and never over-g)', sk8.alerts.has('speed1') && !sk8.alerts.has('speed2') && sk9.alerts.has('speed2') && ![...sk8.alerts, ...sk9.alerts].some((a) => a[0] === 'g'), [...sk8.alerts, '/', ...sk9.alerts].join(' '));
const sk12 = hold('skylark', 1150, 300, 1);
t('at 1150 km/h (1.35 times over): at once', sk12.tore != null && sk12.tore < 0.05, sk12.tore);
// the Mach limit: up high the equivalent airspeed is low, but a straight wing still can't go much faster
const sk3 = [hold('skylark', 860, 3000, 8), hold('skylark', 1000, 3000, 6)];
t('at 3 km: fine at 860 km/h, torn off by the Mach limit at 1000', sk3[0].tore == null && sk3[1].tore != null && sk3[1].mach, sk3.map(show).join(' '));
const skHi = [hold('skylark', 720, 9000, 6), hold('skylark', 900, 9000, 6)];
t('at 9 km: fine at 720 km/h (Mach 0.67), torn off at 900 (Mach 0.84)', skHi[0].tore == null && skHi[1].tore != null && skHi[1].mach, skHi.map(show).join(' '));
// in thin air the Mach limit fades: a space plane coming home at Mach 5 keeps its wings
const vac = [hold('skylark', 1500, 29000, 3), hold('hornet', 6000, 28000, 3), hold('kestrel', 6000, 28000, 3), hold('jumbo', 5000, 27000, 3)];
t('at 27-29 km, Mach 1.5-6 in thin air: plain, swept, swing and airliner wings stay on', vac.every((x) => x.tore == null), vac.map(show).join(' '));
const home = [hold('hornet', 4000, 26000, 2, { sink: 60 }), hold('hornet', 4000, 26000, 2)];
t('coming down that fast, the warning shows early (amber, high up, before the air thickens); not on the way up', home[0].tore == null && home[0].alerts.has('speed1') && !home[0].alerts.has('speed2') && !home[1].alerts.size,
  home.map((x) => [...x.alerts].join(',') || '-').join(' / '));

// biplane and supersonic wings
const ca = [hold('camel', 500, 300, 8), hold('camel', 620, 300, 8), hold('camel', 620, 5000, 8)];
t('Camel (biplane wings): fine at 500 km/h, torn off at 620, low down and at 5 km', ca[0].tore == null && ca[1].tore != null && ca[2].tore != null, ca.map(show).join(' '));
const vi = [hold('viper', 1450, 300, 6), hold('viper', 2400, 12000, 6), hold('viper', 1900, 300, 3)];
t('Viper (delta): fine at 1450 km/h low down and Mach 2.2 at 12 km; torn off at 1900 km/h low down',
  vi[0].tore == null && vi[1].tore == null && vi[2].tore != null, vi.map(show).join(' '));
const ho = [hold('hornet', 1250, 300, 6), hold('hornet', 1700, 300, 3), hold('hornet', 2000, 11000, 6)];
t('Hornet (swept): Mach 1 low down is fine; 1700 km/h low down tears it; Mach 1.88 at 11 km tears it (Mach 1.7 limit)',
  ho[0].tore == null && ho[1].tore != null && ho[2].tore != null, ho.map(show).join(' '));

// a wing torn off and still going far too fast doesn't tear again every step (the pieces fly on here)
const deb = [hold('skylark', 1200, 300, 2), hold('camel', 800, 300, 2), hold('barnstormer', 1200, 300, 2)];
t('one rip each, none from the debris tumbling on', deb.every((x) => x.broken.length === 1 && x.s.vessels.length > 0), deb.map((x) => x.broken.join(' ') + ` (${x.s.vessels.length} pieces)`).join(' | '));

// pulling while fluttering (a dive pull-out): the speed warning, not "ease off" (flutter stress doesn't count as
// the pull's), unless the load is past its limit too; near both limits, the g warning as before
const alert = (o) => { const a = ctx.Flight.structAlert.call({ destroyed: false }, { kind: 'plane', airspeed: 300, wings: [{ stress: 0.5 }], ...o }); return a ? a.kind + a.level : '-'; };
const al = [alert({ overspeed: 1.1, strain: 0.9 }), alert({ overspeed: 1.1, strain: 1.2 }), alert({ overspeed: 0.95, strain: 0.9, wings: [] }), alert({ overspeed: 0.95, strain: 0.5 }), alert({ overspeed: 1.1, strain: 0.9, kind: 'rocket' })];
t('warnings: fluttering in a pull says slow down; over-g past the load limit; near both, over-g; a winged rocket too', al.join(' ') === 'speed2 g2 g1 speed1 speed2', al.join(' '));
t('no warning once the craft is lost', ctx.Flight.structAlert.call({ destroyed: true }, { kind: 'plane', airspeed: 300, wings: [], overspeed: 1.2, strain: 0 }) === null);

// noodle wings: half the speed
R('Silly.flags.noodle = true');
const noo = R('Silly.on("noodle")') ? hold('skylark', 500, 300, 8) : null;
R('Silly.flags.noodle = false');
t('noodle wings: a Skylark at 500 km/h loses its wing (half of 850)', noo && noo.tore != null, noo ? noo.tore : 'could not turn noodle on');
t.done();
