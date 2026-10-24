// Ground physics bench, headless: microseconds per physics step and Terrain calls per step for ground vehicles,
// stepped as driving.js steps them (the stick read every 1/60 s frame, two 1/120 s substeps a frame). Each vehicle
// first settles untimed, then the same steps are run three times timed and once more counting calls; the runs are
// deterministic, so the counts belong to exactly the steps that were timed. Calls are counted through the Terrain
// object, as vessel.js (and gear.js) make them; "counted" adds up surfaceAt, heightAt, waterAt and deckAt, the
// calls a ground vehicle's step is budgeted in, and normalAt is listed apart (it makes four surfaceAt of its own).
// Not in run.mjs: timings depend on the machine, so compare runs made on one machine.
//   node test/bench/ground-bench.mjs [name words] [--secs 5]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const G = require('../lib/game.js');
const ctx = G.load({ combat: true });
const FPS = 60, SUB = 2, h = 1 / 120;

// The vehicles. key: a template (or rows + kind: design rows or template rows); place: a site by default, or
// { e, z, yaw } on Earth as a spawn, or (v, ctx) => ...; setup(v); script(v, t) sets the stick each frame;
// warm: seconds stepped untimed first (the parked one comes to rest); secs: seconds timed.
// The tanks (test/lib/tanks.js) stand on the arena's north pad (flat, 160 m east to west), starting at its west end
// facing east so 7 s of driving stays on it, and on a dry 10° hillside of the arena (planar to 1 mm over a tank).
const TANKS = require('../lib/tanks.js'), PAD = { e: 17750 - 70, z: 13800, yaw: 0 }, SLOPE = { e: 16475, z: 15450, yaw: 0.63 };
const VEHICLES = [
  { name: 'Dune Buggy, driving on the runway', key: 'buggy', warm: 2, script: (v) => { v.ctl.v = 1; } },
  { name: 'Dune Buggy, parked on the runway', key: 'buggy', warm: 3, script: (v) => { v.ctl.v = 0; } },
  ...[['tk34', 'TK-34'], ['ms4', 'MS-4 Shermin'], ['tygr', 'Tygr I'], ['ma1', 'MA-1 Abrahm'], ['pumo', 'Pumo 8x8']].flatMap(([k, n]) => [
    { name: `${n}, driving on the pad`, rows: TANKS[k], kind: 'tank', place: PAD, warm: 2, script: (v) => { v.ctl.v = 1; } },
    { name: `${n}, parked on the pad`, rows: TANKS[k], kind: 'tank', place: PAD, warm: 3, script: (v) => { v.ctl.v = 0; } }]),
  { name: 'TK-34, driving on a 10° hillside', rows: TANKS.tk34, kind: 'tank', place: SLOPE, warm: 2, script: (v) => { v.ctl.v = 1; } },
  { name: 'TK-34, parked on a 10° hillside', rows: TANKS.tk34, kind: 'tank', place: SLOPE, warm: 3, script: (v) => { v.ctl.v = 0; } },
  { name: 'TK-34, pivoting on the pad', rows: TANKS.tk34, kind: 'tank', place: PAD, warm: 2, script: (v) => { v.ctl.h = 1; } },
];

const args = process.argv.slice(2), si = args.indexOf('--secs');
const SECS = si >= 0 ? +args[si + 1] : null, words = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--secs');
const T = ctx.Terrain, CALLS = ['surfaceAt', 'heightAt', 'waterAt', 'deckAt', 'normalAt', 'locate'], ORIG = {}, n = {};
for (const k of CALLS) { ORIG[k] = T[k]; n[k] = 0; }
const counting = (on) => { for (const k of CALLS) T[k] = on ? function (...a) { n[k]++; return ORIG[k].apply(this, a); } : ORIG[k]; };

function build(b) {
  const kind = b.kind || (b.key && ctx.TEMPLATES[b.key].kind) || 'rocket';
  const v = G.craft(ctx, b.rows || G.templateRows(ctx, b.key), kind), s = G.sim();
  Object.assign(s, { active: v, vessels: [v], firing: false, destroyed: false });
  if (typeof b.place === 'function') b.place(v, ctx);
  else if (b.place) v.placeOnSurface(ctx.EARTH, ctx.siteAngle(ctx.EARTH, b.place.e), ctx.VEHICLE_KINDS[v.kind].launchRot, b.place.z || 0, b.place.yaw || 0);
  if (b.setup) b.setup(v);
  return { v, s };
}
// steps frames [f0, f1) of a run; returns the microseconds spent in physicsStep
function frames({ v, s }, b, f0, f1) {
  let ns = 0n;
  for (let f = f0; f < f1; f++) {
    b.script(v, f / FPS);
    for (let i = 0; i < SUB; i++) {
      const t0 = process.hrtime.bigint();
      v.physicsStep(h, s);
      ns += process.hrtime.bigint() - t0;
      ctx.Combat.step(h, s); s.time += h;
    }
  }
  return Number(ns) / 1000;
}
function bench(b) {
  const w = Math.round((b.warm || 0) * FPS), m = Math.round((SECS || b.secs || 5) * FPS), steps = m * SUB, us = [];
  frames(build(b), b, 0, w + m); // JIT warm-up
  for (let r = 0; r < 3; r++) { const run = build(b); frames(run, b, 0, w); us.push(frames(run, b, w, w + m) / steps); }
  const run = build(b);
  frames(run, b, 0, w);
  for (const k of CALLS) n[k] = 0;
  counting(true);
  frames(run, b, w, w + m);
  counting(false);
  const per = (k) => n[k] / steps, v = run.v;
  return { name: b.name, kind: v.kind, us: Math.min(...us), usMed: us.sort((a, c) => a - c)[1], counted: per('surfaceAt') + per('heightAt') + per('waterAt') + per('deckAt'),
    ...Object.fromEntries(CALLS.map((k) => [k, per(k)])), speed: v.speed(), contacts: v.wheelsDown ? 'wheels' : v.landed ? 'hull' : v.contactTime ? 'touching' : 'none' };
}

const list = VEHICLES.filter((b) => !words.length || words.some((x) => b.name.toLowerCase().includes(x.toLowerCase())));
for (const b of list) frames(build(b), b, 0, Math.round(((b.warm || 0) + 2) * FPS)); // (every vehicle's code warmed up first, so the first timed isn't the JIT's)
const rows = list.map(bench), f = (x, d = 1) => x.toFixed(d);
const cols = [['vehicle', 36], ['kind', 6], ['µs/step', 8], ['(median)', 9], ['counted', 8], ['surfaceAt', 10], ['locate', 7], ['normalAt', 9], ['waterAt', 8], ['deckAt', 7], ['heightAt', 9], ['m/s', 6], ['on', 6]];
console.log(cols.map(([c, w]) => c.padEnd(w)).join(' '));
for (const r of rows) console.log([r.name, r.kind, f(r.us), f(r.usMed), f(r.counted), f(r.surfaceAt), f(r.locate), f(r.normalAt), f(r.waterAt), f(r.deckAt), f(r.heightAt), f(r.speed), r.contacts]
  .map((x, i) => String(x).padEnd(cols[i][1])).join(' '));
console.log(`(physicsStep alone, timed over ${SECS ? SECS + ' s' : "each vehicle's secs (5 s unless set)"}: the best and the median of three runs; calls per 1/120 s step)`);

// Collisions between vehicles: Gear.bump for each of twelve tanks parked in a column on the pad, 9 m nose to tail (the
// spheres tested, nothing touching), and again packed side by side in a row 3.6 m apart, every neighbour's boxes in
// the separating-axis test (none touching), timed alone.
if (!words.length || words.some((x) => 'collisions'.includes(x.toLowerCase()))) {
  for (const [what, de, dz] of [['in a column 9 m apart', 9, 0], ['in a row 3.6 m apart', 0, 3.6]]) {
    const all = [];
    for (let i = 0; i < 12; i++) {
      const v = G.craft(ctx, TANKS.tk34, 'tank');
      v.placeOnSurface(ctx.EARTH, ctx.siteAngle(ctx.EARTH, PAD.e + i * de), 0, PAD.z - 20 + i * dz, 0);
      all.push(v);
    }
    const s = G.sim(); Object.assign(s, { active: all[0], vessels: all });
    const N = 20000, best = [];
    for (let r = 0; r < 4; r++) { const t0 = process.hrtime.bigint(); for (let i = 0; i < N; i++) ctx.Gear.bump(all[i % 12], s); best.push(Number(process.hrtime.bigint() - t0) / 1000 / N); }
    console.log(`collisions: Gear.bump among 12 TK-34s ${what}: ${Math.min(...best.slice(1)).toFixed(2)} µs a call (best of 3 after a warm-up)`);
  }
}
