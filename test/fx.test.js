// The effects API (world.js FX): the old recipes untouched, FX.death's stages, FX.update's new fields, the presets and
// the 2D fallback.   node test/fx.test.js
//   1  FX.explosion, puff, sparks and splash byte for byte: their source is today's, and they build the same particles,
//      bit for bit, from the same Math.random as a copy of today's FX (68ea3fe, frozen below), with none of the new fields
//   2  FX.death: every kind's stages on High and Low, its options, its live peaks under the damage spec's budgets, the cap,
//      and never a Math.random
//   3  FX.update in place: an old particle moves bit for bit as today's update moves it (cloned lists, new particles
//      about), and the new fields (rise, drag, floor, trail, pop) do what they say
//   4  the presets, FX.flame and FX.trail; FX.seed makes the stream repeat; the headless stub has the API's names
//   5  FX.draw (the 2D view) with every kind: no throw, nothing drawn for a timer
//   6  three's chunks as Render3D.init patches them (run here on Node's copy of three): the shadow filter (flight's PCF
//      branch 4 bilinear taps and a faded edge, the hangar's soft branch three's own 16 taps verbatim), idempotent, and a
//      chunk that isn't r159's left alone with its flag false and one warning
const G = require('./lib/game.js');
const ctx = G.load({ flight: true });
const R = (code) => G.run(ctx, code);
const t = G.checks('fx: the effects API');

// ---- today's FX (68ea3fe, world.js:37-105), frozen: what the old recipes and the old update must stay
const OLD = String.raw`function randDir() {
  const z = Math.random() * 2 - 1, a = Math.random() * TAU, s = Math.sqrt(1 - z * z);
  return { x: s * Math.cos(a), y: s * Math.sin(a), z };
}

const FX = {
  list: [],
  max() { return Settings.high ? 900 : 350; },
  add(p) {
    p.life = 0;
    if (p.z === undefined) { p.z = 0; p.vz = 0; }
    this.list.push(p);
    if (this.list.length > this.max()) this.list.splice(0, this.list.length - this.max());
  },
  clear() { this.list.length = 0; },
  // a chaff cloud's foil ('glint'): each strip flashes as it turns in the light, by its own age (the same at any frame rate)
  twinkle(p) { const s = Math.sin(p.tw + p.life * p.tf); return 0.15 + 0.85 * s * s * s * s; },
  // p and v are {x, y, z} relative to the body; bursts fly out in every direction.
  puff(body, p, v, n, color) {
    for (let i = 0; i < n; i++) {
      const d = randDir(), s = 2 + Math.random() * 6;
      this.add({ kind: 'smoke', b: body, x: p.x, y: p.y, z: p.z, vx: v.x + d.x * s, vy: v.y + d.y * s, vz: v.z + d.z * s, max: 0.8 + Math.random() * 0.6, size: 0.6, grow: 2.5, color, alpha: 0.6 });
    }
  },
  sparks(body, p, v, n) {
    for (let i = 0; i < n; i++) {
      const d = randDir(), s = 6 + Math.random() * 24;
      this.add({ kind: 'spark', b: body, x: p.x, y: p.y, z: p.z, vx: v.x + d.x * s, vy: v.y + d.y * s, vz: v.z + d.z * s, max: 0.3 + Math.random() * 0.5, size: 0.15, grow: 0, color: '#ffd27a', alpha: 1 });
    }
  },
  explosion(body, p, v, size, air) {
    if (Silly.on('hollywood')) size *= 3;
    const at = { b: body, x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z };
    this.add({ kind: 'flash', ...at, max: 0.35, size: size * 4, grow: size * 8, color: '#fff3c4', alpha: 1 });
    this.add({ kind: 'ring', ...at, max: 0.7, size: size, grow: size * 14, color: '#ffe2a8', alpha: 0.7 });
    for (let i = 0; i < 26; i++) {
      const d = randDir(), s = 4 + Math.random() * 22;
      this.add({ kind: 'fire', ...at, vx: v.x + d.x * s, vy: v.y + d.y * s, vz: v.z + d.z * s, max: 0.6 + Math.random() * 1.4, size: size * 0.5, grow: size * 1.5, color: i % 3 ? '#ff9a3c' : '#ffe08a', alpha: 1 });
    }
    if (air) for (let i = 0; i < 14; i++) {
      const d = randDir(), s = 2 + Math.random() * 8;
      this.add({ kind: 'smoke', ...at, vx: v.x + d.x * s, vy: v.y + d.y * s, vz: v.z + d.z * s, max: 2 + Math.random() * 2.5, size: size * 0.6, grow: size * 2.5, color: '#4a4f57', alpha: 0.75 });
    }
    this.sparks(body, p, v, 16);
  },
  // spray thrown up around n (the ground's normal) at p
  splash(body, p, n, count) {
    for (let i = 0; i < count; i++) {
      const s = 4 + Math.random() * 10, d = randDir(), j = 4;
      this.add({ kind: 'smoke', b: body, x: p.x, y: p.y, z: p.z, vx: n.x * s + d.x * j, vy: n.y * s + d.y * j, vz: n.z * s + d.z * j,
        max: 0.8 + Math.random(), size: 0.4, grow: 2.5, color: '#e6f3ff', alpha: 0.8, heavy: true });
    }
  },
  update(dt, F) {
    const keep = [];
    for (const p of this.list) {
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.exp(-(p.kind === 'fire' ? 2.5 : p.kind === 'spark' ? 0.6 : 1.6) * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      if (p.heavy || p.kind === 'spark') {
        const r = Math.hypot(p.x, p.y, p.z) || 1, g = (p.b.mu / (r * r)) * dt;
        p.vx -= (p.x / r) * g; p.vy -= (p.y / r) * g; p.vz -= (p.z / r) * g;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      keep.push(p);
    }
    this.list = keep;
  },`;
// the old FX as OFX in the game's scope (its own list, today's randDir as oldRandDir), and each method's source text
const methodSrc = (src, name) => { const m = src.match(new RegExp(`\\n  (${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}),?(?:\\n|$)`)); return m && m[1]; };
ctx.__old = { randDir: OLD.match(/function randDir\(\) \{[\s\S]*?\n\}/)[0] };
for (const k of ['puff', 'sparks', 'explosion', 'splash', 'update']) ctx.__old[k] = methodSrc(OLD, k);
R(`var oldRandDir = (${ctx.__old.randDir.replace('function randDir', 'function')});
var OFX = { list: [], max() { return Settings.high ? 900 : 350; }, add(p) { p.life = 0; if (p.z === undefined) { p.z = 0; p.vz = 0; } this.list.push(p); if (this.list.length > this.max()) this.list.splice(0, this.list.length - this.max()); } };
for (const k of ['puff', 'sparks', 'explosion', 'splash', 'update']) OFX[k] = eval('({' + __old[k].replace(/randDir\\(\\)/g, 'oldRandDir()') + '})')[k];`);
// a seeded Math.random (mulberry32, its own state), a throwing one, and an exact comparison of two particle lists
R(`var seedMath = (n) => { let s = n >>> 0; Math.random = () => { let t = (s = (s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
var mathRandom = Math.random, randomCalls = 0;
var noRandom = () => { Math.random = () => { randomCalls++; throw new Error('Math.random called'); }; };
var sameList = (a, b) => {
  if (a.length !== b.length) return 'length ' + a.length + ' vs ' + b.length;
  for (let i = 0; i < a.length; i++) {
    const ka = Object.keys(a[i]).sort(), kb = Object.keys(b[i]).sort();
    if (ka.join() !== kb.join()) return i + ': keys ' + ka.join() + ' vs ' + kb.join();
    for (const k of ka) if (!Object.is(a[i][k], b[i][k])) return i + '.' + k + ': ' + a[i][k] + ' vs ' + b[i][k];
  }
  return '';
};
var clone = (L) => L.map((p) => Object.assign({}, p));
var NEW_FIELDS = ['rise', 'drag', 'floor', 'trail', 'trailT', 'hot', 'pop', 'heat', 'cool', 'ease', 'fin', 'nolight', 'restAt', 'tt'];
var P0 = { x: EARTH.radius + 2, y: 0, z: 0 }, V0 = { x: 0, y: 0, z: 0 }, VA = { x: 30, y: -120, z: 8 };
var count = (L, f) => L.filter(f).length;
var setQ = (q) => Settings.set('quality', q);`);

// ---------------------------------------------------------------------------------------------------------------
// 1 the old recipes byte for byte
t('1 FX.explosion, puff, sparks, splash and randDir: the source text is today\'s', R(`['puff', 'sparks', 'explosion', 'splash'].every((k) => FX[k].toString() === __old[k]) && randDir.toString() === __old.randDir`),
  R(`['puff', 'sparks', 'explosion', 'splash'].filter((k) => FX[k].toString() !== __old[k]).join() + (randDir.toString() === __old.randDir ? '' : ' randDir')`));
R(`var oldRun = (fn) => { const out = {}; for (const [k, F] of [['now', FX], ['old', OFX]]) { F.list.length = 0; seedMath(4242); FX.seed(99); fn(F); out[k] = clone(F.list); out[k + 'S'] = FX._s; } Math.random = mathRandom; return out; };
var R1 = { air: oldRun((F) => F.explosion(EARTH, P0, VA, 3, true)), vac: oldRun((F) => F.explosion(EARTH, P0, V0, 1.5, false)),
  puff: oldRun((F) => F.puff(EARTH, P0, VA, 9, '#778899')), sparks: oldRun((F) => F.sparks(EARTH, P0, VA, 12)), splash: oldRun((F) => F.splash(EARTH, P0, { x: 1, y: 0, z: 0 }, 15)) };
setQ('low'); R1.low = oldRun((F) => F.explosion(EARTH, P0, VA, 2, true)); setQ('high');
Silly.flags.hollywood = true; R1.holly = oldRun((F) => F.explosion(EARTH, P0, VA, 2, true)); Silly.flags.hollywood = false;`);
t('1 FX.explosion in air: 58 particles (1 flash, 1 ring, 26 fire, 14 smoke, 16 sparks)', R(`(() => { const L = R1.air.now; return L.length === 58 && count(L, (p) => p.kind === 'flash') === 1 && count(L, (p) => p.kind === 'ring') === 1
  && count(L, (p) => p.kind === 'fire') === 26 && count(L, (p) => p.kind === 'smoke') === 14 && count(L, (p) => p.kind === 'spark') === 16; })()`), R('R1.air.now.length'));
t('1 none of the new fields on any old recipe\'s particle', R(`Object.values(R1).every((r) => r.now.every((p) => NEW_FIELDS.every((k) => !(k in p))))`));
t('1 bit-identical to today\'s FX from the same Math.random: explosion in air and out of it, on Low, in Hollywood; puff; sparks; splash',
  R(`Object.values(R1).every((r) => sameList(r.now, r.old) === '')`), R(`Object.entries(R1).map(([k, r]) => k + ':' + (sameList(r.now, r.old) || 'same')).join(' ')`));
t('1 the old recipes never draw from FX.rnd (its stream stays where it was)', R(`Object.values(R1).every((r) => r.nowS === r.oldS && r.nowS === (99 >>> 0))`));

// ---------------------------------------------------------------------------------------------------------------
// 2 FX.death
// the stages by kind (High counts; spec-graphics §5.4), typed here from the spec, not from world.js's table
R(`var WANT = {
  ammo: { flash: 1, ring: 1, fire: 16, debris: 10, spark: 14, dust: 10, W: 20, Ws: 4, column: 12, emit: 3, F: 4, L: 0.32, cc: '#2a2c30' },
  crash: { flash: 1, ring: 1, fire: 20, debris: 8, spark: 14, dust: 10, W: 20, Ws: 4, column: 12, emit: 0, F: 3.5, L: 0.3, cc: '#2a2c30' },
  air: { flash: 1, ring: 1, fire: 22, debris: 10, spark: 16, dust: 0, W: 0, Ws: 0, column: 14, emit: 0, F: 4, L: 0.3, cc: '#3b3e44' },
  fuel: { flash: 1, ring: 0, fire: 14, debris: 4, spark: 8, dust: 0, W: 10, Ws: 2, column: 8, emit: 1, F: 2.5, L: 0.25, cc: '#34363a' },
  ko: { flash: 1, ring: 0, fire: 5, debris: 0, spark: 8, dust: 0, W: 4, Ws: 1, column: 6, emit: 0, F: 1.5, L: 0.18, cc: '#5a5e66' },
  thud: { flash: 0, ring: 0, fire: 0, debris: 0, spark: 6, dust: 6, W: 4, Ws: 1, column: 0, emit: 0 } };
var COLS = ['#2a2c30', '#3b3e44', '#34363a', '#5a5e66'];
var stages = (L) => ({ flash: count(L, (p) => p.kind === 'flash'), ring: count(L, (p) => p.kind === 'ring'), fire: count(L, (p) => p.kind === 'fire'),
  debris: count(L, (p) => p.kind === 'debris'), spark: count(L, (p) => p.kind === 'spark'), dust: count(L, (p) => p.kind === 'smoke' && p.color === '#9a8f7c'),
  W: count(L, (p) => p.kind === 'smoke' && p.color === '#e6f3ff'), Ws: count(L, (p) => p.kind === 'smoke' && p.color === '#f2f5f8'),
  column: count(L, (p) => p.kind === 'smoke' && COLS.includes(p.color)), emit: count(L, (p) => p.kind === 'emit'), all: L.length });
var death = (kind, q, size = 5, opt, air, at = P0, v = V0) => { setQ(q); FX.clear(); FX.seed(7); FX.death(EARTH, at, v, size, kind, air, opt); const L = clone(FX.list); setQ('high'); return L; };
var expect = (kind, q, water) => { const W = WANT[kind], h = (n) => (q === 'high' ? n : Math.ceil(n / 2)), e = {};
  for (const k of ['fire', 'debris', 'spark', 'column']) e[k] = h(W[k]);
  e.flash = W.flash; e.ring = W.ring; e.emit = W.emit; e.dust = water ? 0 : h(W.dust); e.W = water ? h(W.W) : 0; e.Ws = water ? h(W.Ws) : 0;
  e.all = Object.values(e).reduce((a, b) => a + b, 0); return e; };
var diff = (a, b) => Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => k + ' ' + a[k] + '≠' + b[k]).join(', ');`);
for (const q of ['high', 'low']) for (const water of [false, true]) {
  const bad = R(`Object.keys(WANT).map((k) => { const d = diff(stages(death(k, '${q}', 5, { water: ${water} })), expect(k, '${q}', ${water})); return d ? k + ': ' + d : ''; }).filter(Boolean).join('; ')`);
  t(`2 stage counts per kind, ${q === 'high' ? 'High' : 'Low (FX.nq; flashes, rings and pops kept)'}${water ? ', in water (splash and steam, no dust)' : ''}`, bad === '', bad);
}
t('2 exactly one flash at t = 0 for every kind but thud (none)', R(`Object.keys(WANT).every((k) => count(death(k, 'high'), (p) => p.kind === 'flash') === (k === 'thud' ? 0 : 1))`));
t('2 the flash: size F·s, grow 2F·s, life L, #fff3c4', R(`Object.keys(WANT).filter((k) => k !== 'thud').every((k) => { const f = death(k, 'high', 2.5).find((p) => p.kind === 'flash'), W = WANT[k];
  return Math.abs(f.size - W.F * 2.5) < 1e-12 && Math.abs(f.grow - 2 * W.F * 2.5) < 1e-12 && f.max === W.L && f.color === '#fff3c4' && !f.nolight; })`));
t('2 a crash has its shock ring only over 3 m', R(`count(death('crash', 'high', 5), (p) => p.kind === 'ring') === 1 && count(death('crash', 'high', 2.5), (p) => p.kind === 'ring') === 0`));
t('2 the ring: size s, grow 14s, 0.6 s, α 0.6', R(`(() => { const r = death('ammo', 'high', 2).find((p) => p.kind === 'ring'); return r.size === 2 && r.grow === 28 && r.max === 0.6 && r.alpha === 0.6; })()`));
t("2 'det' is 'ammo'; an unknown kind (or an Object prototype name) is 'ko'", R(`sameList(death('det', 'high'), death('ammo', 'high')) === '' && sameList(death('bogus', 'high'), death('ko', 'high')) === ''
  && sameList(death('toString', 'high'), death('ko', 'high')) === '' && sameList(death(undefined, 'high'), death('ko', 'high')) === ''`));
t('2 the fireball: size 0.55s (ko 0.3s), grow 1.4s, life 0.8-1.8 s, rise 6 (fuel 7), drag 2, eased', R(`Object.keys(WANT).filter((k) => WANT[k].fire).every((k) => death(k, 'high', 4).filter((p) => p.kind === 'fire')
  .every((p) => Math.abs(p.size - (k === 'ko' ? 0.3 : 0.55) * 4) < 1e-12 && Math.abs(p.grow - 5.6) < 1e-12 && p.max >= 0.8 && p.max <= 1.8 && p.rise === (k === 'fuel' ? 7 : 6) && p.drag === 2 && p.ease === 1))`));
t("2 a knock-out's flames start half a metre up", R(`death('ko', 'high', 4).filter((p) => p.kind === 'fire').every((p) => Math.abs(p.x - P0.x - 0.5) < 1e-6)`));
t('2 debris chunks: the first half hot (trailing from 1.2 s), on the floor 0.3s under p, heavy, drag 0.15, trails every 0.15 s (Low 0.3)',
  R(`(() => { const H = death('ammo', 'high', 5).filter((p) => p.kind === 'debris'), L = death('ammo', 'low', 5).filter((p) => p.kind === 'debris');
    const ok = (D, tr) => D.every((p, i) => p.hot === i < D.length / 2 && p.trailT === (p.hot ? 1.2 : 0) && p.trail === tr && p.heavy && p.drag === 0.15 && Math.abs(p.floor - (Math.hypot(P0.x, P0.y, P0.z) - 1.5)) < 1e-6 && p.grow === 0);
    return ok(H, 0.15) && ok(L, 0.3) && count(H, (p) => p.hot) === 5 && count(L, (p) => p.hot) === 3; })()`));
t("2 the column: life 4-7 s (Low × 0.7), heat 0.3 but a knock-out's, eased, fading in over 0.15", R(`Object.keys(WANT).filter((k) => WANT[k].column).every((k) => ['high', 'low'].every((q) => death(k, q, 3).filter((p) => p.kind === 'smoke' && COLS.includes(p.color))
  .every((p) => p.color === WANT[k].cc && p.max >= 4 * (q === 'high' ? 1 : 0.7) && p.max <= 7 * (q === 'high' ? 1 : 0.7) && p.heat === (k === 'ko' ? 0 : 0.3) && p.ease === 1 && p.fin === 0.15 && p.rise === 1.4 && p.alpha === 0.6)))`));
t('2 cook-off pops: ammo at 0.15, 0.42 and 0.8 s, fuel at 0.3 s, sized s (kept on Low)', R(`(() => { const t = (k, q) => death(k, q, 3).filter((p) => p.kind === 'emit').map((p) => p.max + '/' + p.pop).join();
  return t('ammo', 'high') === '0.15/3,0.42/3,0.8/3' && t('ammo', 'low') === '0.15/3,0.42/3,0.8/3' && t('fuel', 'high') === '0.3/3'; })()`));
t('2 opt.ground: false drops the dust and the floors', R(`(() => { const L = death('ammo', 'high', 5, { ground: false }); return stages(L).dust === 0 && L.filter((p) => p.kind === 'debris').every((p) => !p.floor) && stages(L).debris === 10; })()`));
t("2 'air' is off the ground by default (no dust, no floors); every other kind on it", R(`(() => { const A = death('air', 'high', 5), C = death('crash', 'high', 5);
  return A.filter((p) => p.kind === 'debris').every((p) => !p.floor) && C.filter((p) => p.kind === 'debris').every((p) => p.floor > 0) && stages(C).dust === 10
    && count(death('air', 'high', 5, { ground: true }), (p) => p.kind === 'debris' && p.floor > 0) === 10; })()`));
t('2 opt.light: false: the flash (and the pops\' flashes) light nothing', R(`(() => { const L = death('ammo', 'high', 5, { light: false }); return L.find((p) => p.kind === 'flash').nolight === true && L.filter((p) => p.kind === 'emit').every((p) => p.nolight); })()`));
t('2 Hollywood triples the size (the flash 3× as big)', R(`(() => { const a = death('ammo', 'high', 2).find((p) => p.kind === 'flash').size; Silly.flags.hollywood = true; const b = death('ammo', 'high', 2).find((p) => p.kind === 'flash').size; Silly.flags.hollywood = false;
  return Math.abs(b - 3 * a) < 1e-12 && a === 8; })()`));
t("2 air left out: from the air's density ('air' smokes low down, not above the atmosphere; given, it wins)", R(`(() => { const hi = { x: EARTH.radius + 40000, y: 0, z: 0 };
  return stages(death('air', 'high', 5, undefined, undefined, P0)).column === 14 && stages(death('air', 'high', 5, undefined, undefined, hi)).column === 0
    && stages(death('air', 'high', 5, undefined, false, P0)).column === 0 && stages(death('air', 'high', 5, undefined, true, hi)).column === 14; })()`));
t('2 opt.up: the dust skirt goes out along the ground (square to up), 6-14 m/s', R(`(() => { const u = { x: 0, y: 1, z: 0 }, D = death('thud', 'high', 2, { up: u }).filter((p) => p.color === '#9a8f7c');
  return D.length === 6 && D.every((p) => Math.abs(p.vy) < 1e-9 && Math.hypot(p.vx, p.vz) >= 6 - 1e-9 && Math.hypot(p.vx, p.vz) <= 14 + 1e-9); })()`));
t('2 a size of 0, below or not a number shows nothing', R(`[0, -2, NaN, null, '3x'].every((sz) => death('ammo', 'high', sz).length === 0) && death('ammo', 'high', 0.01).length === 67`));
t('2 every particle starts where it should and carries the body', R(`Object.keys(WANT).every((k) => death(k, 'high', 3, { water: k === 'ko' }, undefined, P0, VA).every((p) => p.b === EARTH && p.life === 0 && Math.hypot(p.x - P0.x, p.y - P0.y, p.z - P0.z) <= 3 && ['x', 'y', 'z', 'vx', 'vy', 'vz', 'max', 'size', 'grow'].every((f) => Number.isFinite(p[f]))))`));
// live peaks, stepping FX.update at 1/60 for 8 s, against spec-damage's budgets (High / Low)
R(`var BUDGET = { ammo: [110, 58], crash: [105, 55], air: [95, 50], fuel: [60, 32], ko: [26, 14], thud: [12, 6] };
var peak = (kind, q, water) => { setQ(q); FX.clear(); FX.seed(11); FX.death(EARTH, P0, V0, 5, kind, undefined, { water }); let pk = FX.list.length;
  for (let i = 0; i < 480; i++) { FX.update(1 / 60); pk = Math.max(pk, FX.list.length); } const left = FX.list.length; FX.clear(); setQ('high'); return [pk, left]; };
var PK = Object.keys(BUDGET).map((k) => [k, peak(k, 'high', false), peak(k, 'low', false), peak(k, 'high', true), peak(k, 'low', true)]);`);
t('2 live peaks (8 s at 1/60, debris trails and pops included) within the budgets, on land and in water', R(`PK.every(([k, h, l, hw, lw]) => h[0] <= BUDGET[k][0] && hw[0] <= BUDGET[k][0] && l[0] <= BUDGET[k][1] && lw[0] <= BUDGET[k][1])`),
  R(`PK.map(([k, h, l, hw, lw]) => k + ' ' + h[0] + '/' + l[0] + ' (water ' + hw[0] + '/' + lw[0] + ')').join(', ')`));
t('2 and every death has run its course in 8 s (nothing left over)', R(`PK.every(([k, h, l, hw, lw]) => h[1] + l[1] + hw[1] + lw[1] === 0)`));
t('2 five deaths in one step stay under the cap, oldest dropped (Low, a list near full)', R(`(() => { setQ('low'); FX.clear(); for (let i = 0; i < 340; i++) FX.add({ kind: 'smoke', b: EARTH, x: P0.x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, max: 50, size: 1, grow: 0, color: '#000', alpha: 1, id: i });
  for (let i = 0; i < 5; i++) FX.death(EARTH, P0, V0, 5, 'ammo'); const n1 = FX.list.length; FX.update(1 / 60); const n2 = FX.list.length, oldLeft = count(FX.list, (p) => p.id !== undefined), first = FX.list.find((p) => p.id !== undefined);
  const ok = n1 === FX.max() && n2 <= FX.max() && oldLeft < 340 && first.id === 340 - oldLeft; FX.clear(); setQ('high'); return ok; })()`));
// never Math.random: every new recipe, every kind and option, the update's trails and pops, on High and Low
R(`var noRand = (() => { const err = []; randomCalls = 0; noRandom();
  try {
    for (const q of ['high', 'low']) { setQ(q);
      for (const k of [...Object.keys(WANT), 'det', 'x']) for (const o of [undefined, { water: true }, { ground: false }, { light: false, up: { x: 0, y: 1, z: 0 } }]) { FX.clear(); FX.death(EARTH, P0, VA, 4, k, undefined, o); for (let i = 0; i < 120; i++) FX.update(1 / 30); }
      for (const pr of ['black', 'grey', 'white', 'dust', 'column', 'steam', 'nope']) FX.smoke(EARTH, P0, VA, pr, 1.5);
      FX.flame(EARTH, P0, VA, 2); FX.trail(EARTH, P0, VA, 'black', 5, 1 / 30); FX.dir(); FX.dir({ x: 1, y: 0, z: 0 }, 0.5); FX.rnd(); FX.nq(7);
      for (let i = 0; i < 300; i++) FX.update(1 / 30);
    }
  } catch (e) { err.push(e.message); }
  Math.random = mathRandom; setQ('high'); FX.clear(); return err.length ? err[0] : randomCalls; })();`);
t('2 Math.random never called by FX.death, smoke, flame, trail, dir or the update\'s trails and pops (a throwing stub)', R('noRand === 0'), R('noRand'));

// ---------------------------------------------------------------------------------------------------------------
// 3 FX.update
// a mixed list of old particles (every old recipe and kind), then stepped by FX.update and by today's update side by side
R(`var oldMix = () => { seedMath(77); const F = { list: [], max: OFX.max, add: OFX.add }; for (const k of ['puff', 'sparks', 'explosion', 'splash']) F[k] = OFX[k];
  F.explosion(EARTH, P0, VA, 2.5, true); F.explosion(EARTH, { x: 0, y: EARTH.radius + 900, z: 40 }, { x: 200, y: 0, z: 0 }, 1, false); F.puff(EARTH, P0, VA, 10, '#8a8e95'); F.sparks(EARTH, P0, V0, 12); F.splash(EARTH, P0, { x: 1, y: 0, z: 0 }, 14);
  F.add({ kind: 'glint', b: EARTH, x: P0.x, y: 3, z: 1, vx: 4, vy: 1, vz: 0, max: 4, size: 0.6, grow: 0.4, color: '#eef3fa', alpha: 1, tw: 1, tf: 9 });
  F.add({ kind: 'plasma', b: EARTH, x: P0.x + 50, y: 0, vx: -900, vy: 30, max: 0.6, size: 2, grow: 3, color: '#ff9a4a', alpha: 0.4 });
  F.add({ kind: 'smoke', b: MOON, x: MOON.radius + 3, y: 0, z: 0, vx: 1, vy: 2, vz: 3, max: 3, size: 1, grow: 2, color: '#ccc', alpha: 0.5, heavy: true });
  Math.random = mathRandom; return F.list; };
var steps = [1 / 60, 1 / 60, 1 / 30, 0.004, 1 / 60, 0.1, 1 / 120];
var stepBoth = (n, mixNew) => { const A = oldMix(), B = clone(A), old = new Set(B); OFX.list = A; FX.clear(); for (const p of B) FX.list.push(p);
  if (mixNew) { FX.seed(5); FX.death(EARTH, P0, VA, 4, 'ammo'); FX.smoke(EARTH, P0, VA, 'black'); FX.flame(EARTH, P0, VA); }
  let bad = '';
  for (let i = 0; i < n && !bad; i++) { const dt = steps[i % steps.length]; OFX.update(dt); FX.update(dt); bad = sameList(OFX.list, FX.list.filter((p) => old.has(p))); if (bad) bad = 'step ' + i + ' ' + bad; }
  const r = [bad, OFX.list.length, FX.list.length]; FX.clear(); return r; };
var U1 = stepBoth(400, false), U2 = stepBoth(400, true);`);
t('3 an old particle follows today\'s update bit for bit (cloned list: every old kind, heavy ones, another body, uneven steps)', R(`U1[0] === '' && U1[2] === U1[1]`), R('U1'));
t('3 ... with new particles (a death, trails, pops, smoke) in the same list', R(`U2[0] === ''`), R('U2'));
t('3 a particle goes on the step its life reaches max, exactly as today (life ≥ max)', R(`(() => { const mk = () => ({ kind: 'smoke', b: EARTH, x: P0.x, y: 0, z: 0, vx: 1, vy: 0, vz: 0, max: 0.25, size: 1, grow: 0, color: '#000', alpha: 1 });
  FX.clear(); FX.add(mk()); OFX.list = []; OFX.add(mk()); const n = [];
  for (let i = 0; i < 2; i++) { FX.update(0.125); OFX.update(0.125); n.push(FX.list.length, OFX.list.length); } FX.clear(); return n.join() === '1,1,0,0'; })()`));
t('3 the list keeps its identity and order', R(`(() => { FX.clear(); for (let i = 0; i < 20; i++) FX.add({ kind: 'smoke', b: EARTH, x: P0.x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, max: i % 3 ? 5 : 0.01, size: 1, grow: 0, color: '#000', alpha: 1, id: i });
  const L = FX.list; FX.update(1 / 60); const ids = L.map((p) => p.id), ok = FX.list === L && ids.join() === [...Array(20).keys()].filter((i) => i % 3).join(); FX.clear(); return ok; })()`));
R(`var one = (p, secs, dt = 1 / 60) => { FX.clear(); FX.add(p); for (let t = 0; t < secs - 1e-9; t += dt) FX.update(dt); return p; };`);
t('3 rise lifts ½·rise·t² with no gravity and no drag (smoke, drag 0)', R(`(() => { const p = one({ kind: 'smoke', b: EARTH, x: P0.x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, max: 5, size: 1, grow: 0, color: '#000', alpha: 1, rise: 2, drag: 0 }, 1);
  const h = p.x - P0.x; return Math.abs(h - 1) < 0.02 && Math.abs(p.y) < 1e-9; })()`), R(`(() => { const p = one({ kind: 'smoke', b: EARTH, x: P0.x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, max: 5, size: 1, grow: 0, color: '#000', alpha: 1, rise: 2, drag: 0 }, 1); return (p.x - P0.x).toFixed(4) + ' m in 1 s'; })()`));
t('3 ... and less with its drag (rise 2, drag 1.2: under ½·rise·t², still up)', R(`(() => { const p = one({ kind: 'smoke', b: EARTH, x: P0.x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, max: 5, size: 1, grow: 0, color: '#000', alpha: 1, rise: 2, drag: 1.2 }, 1);
  const h = p.x - P0.x; return h > 0.5 && h < 0.95; })()`));
t('3 drag overrides the kind\'s (fire with drag 0.5; smoke with drag 0 keeps its speed)', R(`(() => { const dt = 1 / 60, f = one({ kind: 'fire', b: EARTH, x: P0.x, y: 0, z: 0, vx: 0, vy: 10, vz: 0, max: 5, size: 1, grow: 0, color: '#000', alpha: 1, drag: 0.5 }, dt);
  const s = one({ kind: 'smoke', b: EARTH, x: P0.x, y: 0, z: 0, vx: 0, vy: 10, vz: 0, max: 5, size: 1, grow: 0, color: '#000', alpha: 1, drag: 0 }, 0.5);
  return f.vy === 10 * Math.exp(-0.5 * dt) && s.vy === 10; })()`));
t('3 a heavy particle falls as before (EARTH, 1 s: about ½·g·t²)', R(`(() => { const g = EARTH.mu / (P0.x * P0.x), p = one({ kind: 'smoke', b: EARTH, x: P0.x + 500, y: 0, z: 0, vx: 0, vy: 0, vz: 0, max: 5, size: 1, grow: 0, color: '#000', alpha: 1, heavy: true, drag: 0 }, 1);
  return Math.abs((P0.x + 500 - p.x) - 0.5 * g) < 0.03 * g; })()`));
R(`var chunk = (o) => Object.assign({ kind: 'debris', b: EARTH, x: P0.x + 3, y: 0, z: 0, vx: 6, vy: 4, vz: 0, max: 3, size: 0.3, grow: 0, color: '#2a2622', alpha: 1, heavy: true, drag: 0.15, floor: P0.x, trail: 0.15, trailT: 1.2, hot: true }, o);`);
R(`var landing = (() => { FX.clear(); const p = chunk({ vx: -15 }); FX.add(p); const seen = new Set([p]), born = [];
  for (let i = 0; i < 120; i++) { FX.update(1 / 60); for (const q of FX.list) if (!seen.has(q)) { seen.add(q); born.push(p.life); } }
  FX.clear(); return { r: Math.hypot(p.x, p.y, p.z) - P0.x, v: [p.vx, p.vy, p.vz], restAt: p.restAt, trailT: p.trailT, born }; })();`);
t('3 a floor stops a chunk dead: on it, still, restAt set, its trail ended (puffs only before it landed)', R(`Math.abs(landing.r) < 1e-6 && landing.v.every((x) => x === 0) && landing.restAt > 0 && landing.restAt < 0.5
  && landing.trailT === 0 && landing.born.length > 0 && landing.born.every((t) => t <= landing.restAt)`), R('JSON.stringify(landing)'));
t('3 ... and stays there (gravity can\'t sink it)', R(`(() => { FX.clear(); const p = chunk({ vx: -15, max: 9 }); FX.add(p); for (let i = 0; i < 400; i++) FX.update(1 / 60); const r = Math.hypot(p.x, p.y, p.z); FX.clear(); return Math.abs(r - P0.x) < 1e-6; })()`));
R(`var trailRun = (o, dt = 1 / 60) => { FX.clear(); const p = chunk(Object.assign({ floor: 0, x: P0.x + 400, vx: 0 }, o)); FX.add(p); const born = [];
  for (let i = 0; i < 180; i++) { FX.update(dt); for (const q of FX.list) if (q !== p && !born.includes(q)) born.push(Object.assign(q, { at: p.life })); }
  FX.clear(); return born; };
var TR = trailRun({}), TRL = trailRun({ trail: 0.3 });`);
t('3 a hot chunk lays a puff every trail s while life < trailT (fire licks under 0.5 s, then dark smoke)', R(`(() => { const n = Math.ceil(1.2 / 0.15), ok = (B, n) => B.length >= n - 1 && B.length <= n && B.every((q) => q.at <= 1.2 + 1e-9 && q.kind === (q.at < 0.5 ? 'fire' : 'smoke'));
  return ok(TR, n) && ok(TRL, Math.ceil(1.2 / 0.3)) && TR.some((q) => q.kind === 'fire') && TR.some((q) => q.kind === 'smoke'); })()`),
  R(`TR.map((q) => q.kind[0] + q.at.toFixed(2)).join(' ') + ' | Low ' + TRL.map((q) => q.kind[0] + q.at.toFixed(2)).join(' ')`));
t('3 ... its puffs follow it: at its place, a tenth of its speed, the smoke rising and eased', R(`TR.filter((q) => q.kind === 'smoke').every((q) => q.rise === 0.5 && q.ease === 1 && q.alpha === 0.55 && q.color === '#3a3a3c') && TR.filter((q) => q.kind === 'fire').every((q) => q.max === 0.35 && q.color === '#ff9a3c')`));
t('3 a cold chunk (trailT 0) lays nothing', R(`trailRun({ hot: false, trailT: 0 }).length === 0`));
t('3 born particles join after the loop (behind the chunk) and under the cap (Low: the oldest go)', R(`(() => { setQ('low'); FX.clear(); for (let i = 0; i < FX.max() - 1; i++) FX.add({ kind: 'smoke', b: EARTH, x: P0.x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, max: 50, size: 1, grow: 0, color: '#000', alpha: 1, id: i });
  const p = chunk({ floor: 0, x: P0.x + 400, vx: 0, trail: 0.01 }); FX.add(p); FX.update(1 / 30); // (3 puffs in one step)
  const L = FX.list, ip = L.indexOf(p), ok = L.length === FX.max() && ip >= 0 && L.slice(ip + 1).length === 3 && L.slice(ip + 1).every((q) => q.kind === 'fire') && L[0].id === 3;
  FX.clear(); setQ('high'); return ok; })()`));
// the cook-off pops: each emit bursts once, as it runs out: nq(3) flames rising 4, nq(4) sparks and a flash 0.8s
R(`var popRun = (q, dt) => { setQ(q); FX.clear(); FX.seed(3); FX.death(EARTH, P0, V0, 2.5, 'ammo'); const E = FX.list.filter((p) => p.kind === 'emit'), out = [];
  for (let i = 0; i < Math.round(1.2 / dt); i++) { const live = E.filter((e) => FX.list.includes(e)), before = new Set(FX.list); FX.update(dt);
    for (const e of live) if (!FX.list.includes(e)) { const nb = FX.list.filter((p) => !before.has(p)); out.push({ t: e.life, fire: count(nb, (p) => p.kind === 'fire' && p.rise === 4 && p.size === 0.75), spark: count(nb, (p) => p.kind === 'spark'), flash: count(nb, (p) => p.kind === 'flash' && p.size === 2 && p.max === 0.12) }); } }
  FX.clear(); setQ('high'); return out; };
var POP = popRun('high', 1 / 120), POPL = popRun('low', 1 / 60);`);
t('3 an emit bursts once at 0.15, 0.42 and 0.8 s: 3 flames, 4 sparks and a flash each (Low 2, 2 and the flash)', R(`(() => { const ok = (P, dt, f, s) => P.length === 3 && P.every((b, i) => b.t >= [0.15, 0.42, 0.8][i] - 1e-9 && b.t < [0.15, 0.42, 0.8][i] + dt + 1e-9 && b.fire === f && b.spark === s && b.flash === 1);
  return ok(POP, 1 / 120, 3, 4) && ok(POPL, 1 / 60, 2, 2); })()`), R('JSON.stringify(POP)'));

// ---------------------------------------------------------------------------------------------------------------
// 4 presets, flame, trail, the stream, the stub
R(`var PRE = { black: ['#26272b', 1.0, 5, 3.5, 2.5, 0.7, 2.5, 1.2, 0.3, 0.06], grey: ['#7b7f86', 0.8, 4, 3.0, 2.2, 0.5, 2.0, 1.2, 0, 0.06], white: ['#e8edf2', 0.7, 4, 2.5, 1.8, 0.35, 0.5, 1.6, 0, 0.06],
  dust: ['#9a8f7c', 0.8, 3, 1.6, 1.2, 0.55, 0.3, 2.2, 0, 0.06], column: ['#303236', 2.5, 12, 9, 6, 0.55, 3.0, 0.8, 0, 0.1], steam: ['#f2f5f8', 1.2, 6, 3.0, 2.2, 0.4, 3.0, 1.2, 0, 0.06] };
var puffOf = (pr, q, k) => { setQ(q); FX.clear(); FX.smoke(EARTH, P0, VA, pr, k); const p = FX.list[0]; FX.clear(); setQ('high'); return p; };
var preBad = [];
for (const [name, [c, size, grow, life, lo, a, rise, drag, heat, fin]] of Object.entries(PRE)) for (const q of ['high', 'low']) for (let i = 0; i < 25; i++) {
  const k = 0.5 + i * 0.1, p = puffOf(name, q, k), L = q === 'high' ? life : lo;
  if (!(p.kind === 'smoke' && p.color === c && Math.abs(p.size - size * k) < 1e-12 && Math.abs(p.grow - grow * k) < 1e-12 && p.max >= 0.85 * L - 1e-12 && p.max <= 1.15 * L + 1e-12
    && p.alpha === a && p.rise === rise && p.drag === drag && p.heat === heat && p.ease === 1 && p.fin === fin && p.vx === VA.x && p.vy === VA.y && p.vz === VA.z && p.x === P0.x))
    preBad.push(name + ' ' + q + ' k ' + k.toFixed(1));
}`);
t('4 the six presets: colour, size and grow × k, life High / Low × 0.85-1.15, α, rise, drag, heat, eased, fade-in', R(`preBad.length === 0`), R(`preBad.slice(0, 4).join('; ')`));
t('4 an unknown preset (or an Object prototype name) is grey; k defaults to 1', R(`['nope', 'toString', '__proto__', undefined].every((pr) => puffOf(pr, 'high', 1).color === '#7b7f86') && (() => { FX.clear(); FX.smoke(EARTH, P0, VA, 'black'); const p = FX.list[0]; FX.clear(); return p.size === 1 && p.grow === 5; })()`));
t('4 flame: one fire tongue, 0.7k → 1.3k, 0.5-0.8 s, rising 6, at p with v', R(`(() => { const out = []; FX.clear(); for (let i = 0; i < 40; i++) FX.flame(EARTH, P0, VA, 1.5); const L = clone(FX.list); FX.clear();
  return L.length === 40 && L.every((p) => p.kind === 'fire' && Math.abs(p.size - 1.05) < 1e-12 && Math.abs(p.grow - 1.95) < 1e-12 && p.max >= 0.5 && p.max <= 0.8 && p.rise === 6 && p.vx === VA.x && p.x === P0.x && ['#ffd27a', '#ff9a3c'].includes(p.color))
    && L.some((p) => p.color === '#ffd27a') && L.some((p) => p.color === '#ff9a3c'); })()`));
t('4 trail: n puffs back along p − v·dt·i/n, each keeping 0.15 of v', R(`(() => { FX.clear(); const dt = 0.05, n = 4; FX.trail(EARTH, P0, VA, 'white', n, dt); const L = clone(FX.list); FX.clear();
  return L.length === n && L.every((p, i) => Math.abs(p.x - (P0.x - VA.x * dt * i / n)) < 1e-9 && Math.abs(p.y - (P0.y - VA.y * dt * i / n)) < 1e-9 && Math.abs(p.z - (P0.z - VA.z * dt * i / n)) < 1e-9
    && p.vx === VA.x * 0.15 && p.vy === VA.y * 0.15 && p.vz === VA.z * 0.15 && p.color === '#e8edf2' && p.size === 0.7); })()`));
t('4 FX.seed(1) twice gives identical lists (death, smoke, flame, trail and 3 s of update)', R(`(() => { const run = () => { FX.clear(); FX.seed(1); FX.death(EARTH, P0, VA, 4, 'ammo', undefined, { water: true }); FX.death(EARTH, P0, V0, 2, 'fuel'); FX.smoke(EARTH, P0, VA, 'column', 2); FX.flame(EARTH, P0, VA); FX.trail(EARTH, P0, VA, 'black', 3, 0.1);
  const L0 = clone(FX.list); for (let i = 0; i < 180; i++) FX.update(1 / 60); const L = clone(FX.list); FX.clear(); return [L0, L]; };
  const a = run(), b = run(); return a[0].length > 100 && a[1].length > 10 && sameList(a[0], b[0]) === '' && sameList(a[1], b[1]) === ''; })()`));
t('4 the stream: rnd in [0, 1), q 1 on High and 0.5 on Low, nq rounds up, dir a unit vector held to its bias', R(`(() => { FX.seed(123); let ok = true;
  for (let i = 0; i < 2000; i++) { const r = FX.rnd(); if (!(r >= 0 && r < 1)) ok = false; }
  const u = { x: 0, y: 0, z: 1 }; for (let i = 0; i < 2000; i++) { const d = FX.dir(u, 0.3), e = FX.dir(); if (Math.abs(Math.hypot(d.x, d.y, d.z) - 1) > 1e-9 || Math.abs(Math.hypot(e.x, e.y, e.z) - 1) > 1e-9 || d.z < 0.3 - 1e-9) ok = false; }
  setQ('low'); const lo = FX.q() === 0.5 && FX.nq(5) === 3 && FX.nq(1) === 1 && FX.nq(0) === 0; setQ('high'); return ok && lo && FX.q() === 1 && FX.nq(5) === 5; })()`));
t('4 FX.rnd matches mulberry32 seeded 0x2545f491 at load', (() => { const c2 = G.load({ flight: true }), a = G.run(c2, '[FX.rnd(), FX.rnd(), FX.rnd()]');
  let s = 0x2545f491; const m = () => { let x = (s = (s + 0x6d2b79f5) >>> 0); x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  return a.every((v) => v === m()); })());
const API = ['add', 'clear', 'explosion', 'sparks', 'puff', 'splash', 'death', 'flame', 'smoke', 'trail', 'seed', 'rnd', 'q', 'nq', 'dir'];
t('4 the real FX and the headless stub (test/lib/game.js) both have the effects API', (() => { const stub = G.load({ combat: true }), real = R('FX');
  return API.every((k) => typeof real[k] === 'function' && typeof stub.FX[k] === 'function') && Array.isArray(stub.FX.list); })(), API.join(' '));

// ---------------------------------------------------------------------------------------------------------------
// 5 the 2D fallback
R(`var stubCtx = () => { const calls = [], r = [], alpha = []; const c = { calls, r, alpha, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1,
  createRadialGradient() { calls.push('grad'); return { addColorStop() {} }; } };
  for (const m of ['beginPath', 'arc', 'fill', 'stroke', 'moveTo', 'lineTo', 'save', 'restore', 'fillRect']) c[m] = (...a) => { calls.push(m); if (m === 'arc') r.push(a[2]); if (m === 'fill') alpha.push(c.globalAlpha); };
  return c; };
var draw2d = (L) => { const c = stubCtx(), bp = bodyPos(EARTH, 0); FX.clear(); for (const p of L) FX.add(p); for (const p of FX.list) p.life = p.max * 0.3;
  FX.draw(c, { x: bp.x + P0.x, y: bp.y }, 10, 0, 0.3); FX.clear(); return c; };
var mk = (kind, o) => Object.assign({ kind, b: EARTH, x: P0.x, y: 1, z: 0, vx: 3, vy: 1, vz: 0, max: 1, size: 1, grow: 1, color: '#ff9a3c', alpha: 1 }, o);
var every2d = (() => { try { const c = draw2d(['smoke', 'fire', 'spark', 'flash', 'ring', 'glint', 'plasma', 'debris', 'emit'].map((k) => mk(k, k === 'glint' ? { tw: 1, tf: 8 } : k === 'emit' ? { size: 0, grow: 0, pop: 2 } : {})));
  return c.calls.length; } catch (e) { return e.message; } })();
var deaths2d = (() => { try { FX.seed(2); const L = []; for (const k of ['ammo', 'crash', 'air', 'fuel', 'ko', 'thud']) { FX.clear(); FX.death(EARTH, P0, VA, 3, k, undefined, { water: k === 'ko' }); L.push(...FX.list); FX.smoke(EARTH, P0, VA, 'steam'); }
  FX.clear(); return draw2d(L).calls.length; } catch (e) { return e.message; } })();`);
t('5 FX.draw with every kind (old and new) on a 2D context: no throw', R(`typeof every2d === 'number' && every2d > 0 && typeof deaths2d === 'number' && deaths2d > 0`), R(`every2d + ' / ' + deaths2d`));
t('5 nothing drawn for an emit (a timer), even a big one', R(`draw2d([mk('emit', { size: 5, grow: 5, pop: 2 })]).calls.length === 0`));
t('5 a debris chunk: one filled disc, at least 0.6 px across, fading over the last fifth of its life', R(`(() => { const at = (size, life) => { const c = stubCtx(), bp = bodyPos(EARTH, 0), p = mk('debris', { size, grow: 0 });
    FX.clear(); FX.add(p); p.life = life; FX.draw(c, { x: bp.x + P0.x, y: bp.y }, 10, 0, 0); FX.clear(); return c; };
  const a = at(0.3, 0.5), b = at(0.3, 0.9), c = at(0.04, 0.5);
  return a.calls.join() === 'beginPath,arc,fill' && a.r[0] === 0.3 && a.alpha[0] === 1 && Math.abs(b.alpha[0] - 0.5) < 1e-9 && c.r[0] === 0.06; })()`));

// ---------------------------------------------------------------------------------------------------------------
// 6 the chunk patches (Render3D._patchChunks on Node's three r159; a fresh copy of three and of render3d.js each time)
{
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const THREE_JS = path.join(G.ROOT, 'js', 'vendor', 'three.min.js');
  const three = () => { delete require.cache[require.resolve(THREE_JS)]; return require(THREE_JS); };
  const render3d = () => { const c = G.load({ flight: true, earth: false }), warns = [];
    c.console = Object.assign(Object.create(console), { warn: (...a) => warns.push(a.join(' ')) });
    vm.runInContext(fs.readFileSync(path.join(G.ROOT, 'js', 'render3d.js'), 'utf8') + '\nthis.Render3D = Render3D;', c, { filename: 'render3d.js' });
    return { R3: c.Render3D, warns }; };
  const SH_P = '\t\tif ( frustumTest ) {\n\t\t#if defined( SHADOWMAP_TYPE_PCF )\n', SH_A = '#elif defined( SHADOWMAP_TYPE_PCF_SOFT )', SH_B = '#elif defined( SHADOWMAP_TYPE_VSM )';
  const T = three(), r159 = T.ShaderChunk.shadowmap_pars_fragment, pcf = r159.slice(r159.indexOf(SH_P) + SH_P.length, r159.indexOf(SH_A)), soft = r159.slice(r159.indexOf(SH_A), r159.indexOf(SH_B));
  const { R3, warns } = render3d(), P = R3._patchChunks(T), s1 = T.ShaderChunk.shadowmap_pars_fragment;
  const pcf1 = s1.slice(s1.indexOf(SH_P) + SH_P.length, s1.indexOf(SH_A)), taps = (x) => (x.match(/texture2DCompare/g) || []).length;
  t('6 the shadow chunk is patched on r159 (PATCHED.shadow), with no warning', T.REVISION === '159' && P.shadow === true && warns.length === 0, { rev: T.REVISION, P, warns });
  t('6 the PCF branch (flight\'s: 17 taps on r159) is 4 bilinear taps and a fade over the box\'s outer 12%', taps(pcf) === 17 && taps(pcf1) === 4 && pcf1.includes('smoothstep( 0.88, 1.0,') && pcf1.includes('fract( st )'));
  t('6 the soft branch (the hangar\'s: three\'s 16 taps) is r159\'s verbatim, and so is the rest of the chunk', taps(soft) === 16 && s1.includes(soft) && s1.replace(pcf1, pcf) === r159);
  const P2 = R3._patchChunks(T);
  t('6 a second call changes nothing (idempotent) and keeps the flag', T.ShaderChunk.shadowmap_pars_fragment === s1 && P2.shadow === true && warns.length === 0);
  const again = render3d(), P3 = again.R3._patchChunks(T); // (a fresh render3d on the already patched three: no double patch)
  t('6 a fresh Render3D on a three already patched leaves it as it is, flag true', T.ShaderChunk.shadowmap_pars_fragment === s1 && P3.shadow === true && again.warns.length === 0);
  // a three whose chunk isn't r159's: each kind of mismatch leaves it untouched, the flag false, one warning
  const bad = { 'no PCF branch': (x) => x.replace(SH_P, SH_P.replace('SHADOWMAP_TYPE_PCF )', 'SHADOWMAP_TYPE_PCF2 )')), 'no soft branch': (x) => x.replace(SH_A, '#elif defined( SHADOWMAP_TYPE_PCF_SOFTER )'),
    'two soft branches': (x) => x.replace(SH_B, SH_A + '\n' + SH_B), 'PCF of 16 taps': (x) => x.replace('\t\t\t\ttexture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +\n', ''),
    'getShadow without shadowRadius': (x) => x.replace('float shadowBias, float shadowRadius, vec4 shadowCoord ) {', 'float shadowBias, vec4 shadowCoord ) {') };
  const left = [];
  for (const [why, f] of Object.entries(bad)) {
    const T2 = three(), m = f(T2.ShaderChunk.shadowmap_pars_fragment), r = render3d();
    T2.ShaderChunk.shadowmap_pars_fragment = m;
    const P4 = r.R3._patchChunks(T2);
    if (!(m !== r159 && T2.ShaderChunk.shadowmap_pars_fragment === m && P4.shadow === false && r.warns.length === 1 && /shadow/.test(r.warns[0]))) left.push(why);
  }
  t('6 a chunk that isn\'t r159\'s (no PCF branch, no soft one, two, a PCF of 16 taps, no shadowRadius) is left alone, flag false, one warning', left.length === 0, left.join(', '));
}
t.done();
