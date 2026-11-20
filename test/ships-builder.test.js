// The ships update, the builder's half (WP4; spec §11.2-11.3, §17.1 "builder"): Ship.stats and Ship.hydrostatics, the
// still-water float, checked against an analytic box hull (draught, GM, heel and trim from weight moved, sinking); the
// slice ship's numbers and the stats object's shape; Ship.spotOf on an empty, a hulled and a full design (hull segments
// end to end, the bow forward and the stern aft, a midsection in behind the bow, the deck, inside, screws and rudders under
// the stern, the refusals); the slice ship built by taps alone and joined as Ship.groups joins her; every warning, each
// from a design with that fault. Last, the flight (the hydro core, WP1) agrees with the
// builder: draught ±10 %, GM ±0.15 m, top speed ±12 %.
//   node test/ships-builder.test.js
const G = require('./lib/game.js');
const ctx = G.load({ earth: false });
const R = (c) => G.run(ctx, c);
const t = G.checks('ships: the builder (hydrostatics, placement, warnings)');
const pct = (a, b) => Math.abs(a - b) / Math.abs(b);

// ================================================================ 1. the float, against a box hull
// a 20 m × 6 m × 4 m box (nb 50: square corners, as near as the rings' 5 bilge points let it be), its centre of gravity at
// the part's middle (2 m above its keel): T = m/(ρ·L·B), GM = B²/(12T) + T/2 − KG
R(`PARTS.__box = { ...PARTS.hbMidM, type: '__box', name: 'Box', w: 20, h: 4, depth: 6, mass: 60, family: 'Boats', shull: { cls: 'M', wl: 0, st: [[-10, 2, -2, 3, 3, 50], [10, 2, -2, 3, 3, 50]], ends: { aft: 'closed', fore: 'closed' }, k: 0 } };
  PARTS.__w1 = { ...PARTS.dieselM, type: '__w1', name: 'Weight', mass: 1, engine: undefined, module: undefined }; PARTS.__w2 = { ...PARTS.__w1, type: '__w2', mass: 2 }; // (test weights: 1 t, 2 t)
  var box = (t, extra) => { PARTS.__box.mass = t; SHULL_CACHE.delete(PARTS.__box); return [makePart('__box', 0, 0, {}), ...(extra || []).map(([k, x, y, z]) => makePart(k, x, y, { z }))]; };`);
const A = R('shullOf(PARTS.__box).phys[0].A'), Bw = 6, L = 20;
t('the box\'s section is all but square (its rings\' area within 0.2 % of 24 m²)', pct(A, 24) < 0.002, A);
for (const m of [60, 120, 200]) {
  const s = R(`(() => { const s = Ship.stats(box(${m})); return { draft: s.draft, GM: s.GM, heel: s.heel, trim: s.trim, freeboard: s.freeboard, disp: s.disp }; })()`);
  const T = (m * 1000) / 1025 / (L * Bw), GM = (Bw * Bw) / (12 * T) + T / 2 - 2;
  t(`${m} t: draught ${T.toFixed(3)} m ±1 % (${s.draft.toFixed(3)}), GM ${GM.toFixed(3)} m ±3 % (${s.GM.toFixed(3)}), level, freeboard 4 − T`,
    pct(s.draft, T) < 0.01 && pct(s.GM, GM) < 0.03 && Math.abs(s.heel) < 0.01 && Math.abs(s.trim) < 0.01 && Math.abs(s.freeboard - (4 - s.draft)) < 0.02 && pct(s.disp, m) < 1e-9, s);
}
// weight moved across (2 t, 2 m to starboard on a 120 t box): tan φ = w·d / (Δ·GM); along (1 t, 8 m forward): bow down
{
  const s = R(`(() => { const s = Ship.stats(box(118, [['__w2', 0, 3.2, 2]])); return { heel: s.heel, trim: s.trim, GM: s.GM, m: s.mass }; })()`);
  const want = (Math.atan((2000 * 2) / (s.m * s.GM)) * 180) / Math.PI;
  t('weight to starboard: she heels to starboard as the wall-sided formula says (±15 %), no trim', s.heel > 0 && pct(s.heel, want) < 0.15 && Math.abs(s.trim) < 0.05, { ...s, want });
  const f = R(`(() => { const s = Ship.stats(box(115, [['__w1', 8, 3.2, 0]])); return { heel: s.heel, trim: s.trim, GML: s.GML, m: s.mass }; })()`), wantT = (Math.atan((1000 * 8) / (f.m * f.GML)) * 180) / Math.PI;
  t('weight forward: down by the bow (trim +) as the formula says (±15 %), no heel', f.trim > 0 && pct(f.trim, wantT) < 0.15 && Math.abs(f.heel) < 0.01, { ...f, want: wantT });
}
{
  const s = R(`(() => { const s = Ship.stats(box(500)); return { sinks: s.sinks, cap: s.cap, mass: s.mass, draft: s.draft, top: s.top }; })()`);
  t('heavier than the closed hull floats (492 t): she sinks', s.sinks && pct(s.cap, 1025 * A * 20) < 0.01 && s.top === 0, s);
  const u = R(`(() => { const s = Ship.stats(box(40, [...Array(10)].map((_, i) => ['__w2', 0, 30 + 2.2 * i, 0]))); return { GM: s.GM, cap: s.capsize }; })()`);
  t('weight piled high: GM below zero', u.GM < 0, u);
}
t('a design with no hull: hull false, nothing floats', R(`(() => { const s = Ship.stats([makePart('bridgeM', 0, 0, {})]); return !s.hull && s.draft === 0 && s.top === 0; })()`));

// ================================================================ 2. the slice ship's numbers
// (the update's first slice, as the contract's Cyclon template has it: its own rows here, so the catalogue's later Cyclon
// (armed, ballasted) moves nothing in this suite)
const SLICE = [['hbSternM', -13, 0], ['hbMidM', -6, 0], ['hbMidM', 2, 0], ['hbBowM', 11, 0.3], ['bridgeM', 3, 3.5, 0, { att: 2 }],
  ['dieselM', -6, -0.209, 0, { z: -0.91, att: 1 }], ['dieselM', -6, -0.209, 0, { z: 0.91, att: 1 }],
  ['screwM', -14.5, -2.9, 0, { z: -1.4, att: 0 }], ['screwM', -14.5, -2.9, 0, { z: 1.4, att: 0 }],
  ['rudderM', -15.55, -2.67, 0, { z: -1.4, att: 0 }], ['rudderM', -15.55, -2.67, 0, { z: 1.4, att: 0 }]];
ctx.__SLICE = SLICE;
R(`var sliceRows = () => __SLICE.map((r) => ({ type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: r[1] < 0, ...(r[4] || {}) }));`);
const S = R(`(() => { const s = Ship.stats(partsFromDesign(sliceRows())); return { hull: s.hull, disp: s.disp, draft: s.draft, fb: s.freeboard, GM: s.GM, KB: s.KB, KG: s.KG, BM: s.BM, top: s.top, turn: s.turn,
  comps: s.comps, open: s.open, thrust: s.thrust, rudder: s.rudder, noEngine: s.noEngine, dry: s.dryScrews.length + s.dryRudders.length, Lwl: s.Lwl, trim: s.trim, heel: s.heel, kw: s.kw, plane: s.plane }; })()`);
t('the Cyclon (slice): a hull, 4 compartments, none open, 4,000 kW to two screws, two rudders, none out of the water', S.hull && S.comps === 4 && S.open === 0 && S.thrust && S.rudder && !S.noEngine && S.dry === 0 && S.kw === 4000, S);
t('...floats with her draught under her hull\'s depth, upright, a level trim (<1°), GM positive and KB + BM − KG = GM', S.draft > 0.3 && S.draft < 2.5 && S.fb > 1 && Math.abs(S.heel) < 0.01 && Math.abs(S.trim) < 1 && S.GM > 0.5
  && Math.abs(S.KB + S.BM - S.KG - S.GM) < 1e-9, S);
t('...a top speed and a turning circle (both "~": between 15 and 60 knots, 2-15 lengths)', S.top * 1.9438 > 15 && S.top * 1.9438 < 60 && S.turn > 2 * S.Lwl && S.turn < 15 * S.Lwl, { kn: S.top * 1.9438, turn: S.turn, Lwl: S.Lwl });
t('...no warnings', R(`(() => { const ps = partsFromDesign(sliceRows()), w = []; Ship.warnings(ps, Ship.stats(ps), w); return w.length === 0; })()`));
t('Ship.stats is quick enough to run on every edit (the slice ship < 15 ms here)', R(`(() => { const ps = partsFromDesign(sliceRows()); Ship.stats(ps); const t0 = Date.now(); for (let i = 0; i < 10; i++) Ship.stats(ps); return (Date.now() - t0) / 10; })()`) < 15);

// every stock ship's inner parts (engines, stores) wholly inside the hull segment they hang on: each corner of the box, at
// both its ends, inside that section's polygon (the Cyclon's diesels once poked 35 cm out of her V bottom)
const inner = R(`(() => { const out = [];
  const inPoly = (P, y, z) => { const n = P.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n, ay = P[2 * i], az = P[2 * i + 1], by = P[2 * j], bz = P[2 * j + 1]; if ((by - ay) * (z - az) - (bz - az) * (y - ay) < -1e-6) return false; } return true; };
  for (const k of Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].kind === 'ship')) {
    const ps = partsFromDesign(templateRows(TEMPLATES[k])), by = new Map(ps.map((p) => [p.id, p]));
    for (const p of ps) { const H = by.get(p.att); if (!p.def.inner || !H || !H.def.shull) continue;
      const { w, h } = partDims(p), d = partDepth(p), z = partZ(p) - partZ(H), S = H.def.shull;
      const okp = [p.x - w / 2, p.x + w / 2].every((x) => { const P = shullPoly(shullSec(S.st, x - H.x), S.wl); return [-1, 1].every((a) => [-1, 1].every((b) => inPoly(P, p.y + (a * h) / 2 - H.y, z + (b * d) / 2))); });
      if (!okp) out.push(k + ':' + p.type + '@' + [p.x, p.y, partZ(p)].join()); } }
  return out; })()`);
t('every stock ship\'s inner parts lie wholly inside the hull they hang on', inner.length === 0, inner);

// ================================================================ 3. placement (Ship.spotOf)
// a tap as the builder makes it: the pose, its twin across with symmetry on, a midsection's shift of the bow first
R(`var tap = (ps, type, sym, at) => {
  const s = Ship.spotOf(type, ps, { ...(at || {}), sym });
  if (!s || s.why) return s;
  if (s.shift) for (const p of [...s.shift.parts, ...attachedTo(ps, s.shift.parts)]) { p.x = +(p.x + s.shift.dx).toFixed(3); p.y = +(p.y + s.shift.dy).toFixed(3); }
  const p = makePart(type, s.x, s.y, { rot: s.rot, z: s.z, att: s.att ? s.att.id : null }); ps.push(p);
  if (sym && Math.abs(s.z) > 0.01) { const m = makePart(type, s.x, s.y, { rot: s.rot, z: -s.z, att: s.att ? s.att.id : null }); if (!ps.some((o) => partsClash(m, o))) ps.push(m); }
  return s; };
  var clean = (ps) => ps.every((a, i) => ps.every((b, j) => j <= i || !partsClash(a, b)));
  var ends = (p) => { const H = shullOf(p.def); return { aft: partPt(p, H.rings[0].x, H.rings[0].yk), fore: partPt(p, H.rings[H.nr - 1].x, H.rings[H.nr - 1].yk) }; };
  var meet = (a, b) => { const f = ends(a).fore, r = ends(b).aft; return Math.abs(f.x - r.x) < 0.02 && Math.abs(f.y - r.y) < 0.02 && Math.abs(partZ(a) - partZ(b)) < 0.02; };`);
// an empty design
let r = R(`(() => { const ps = [], a = Ship.spotOf('hbMidM', ps, {}), b = Ship.spotOf('bridgeM', ps, {}), c = Ship.spotOf('dieselM', ps, {}), d = Ship.spotOf('screwM', ps, {}), e = Ship.spotOf('rudderM', ps, {}), f = Ship.spotOf('hbBowM', ps, {});
  return { mid: [a.x, a.y, a.z, a.att], bow: [f.x, f.y], why: [b.why, c.why, d.why, e.why], gun: Ship.spotOf('gun75', ps, {}), none: Ship.spotOf('nope', ps, {}) }; })()`);
t('empty: the first hull segment (any) goes at (0, 0) on the centre line, hanging on nothing', JSON.stringify(r.mid) === '[0,0,0,null]' && JSON.stringify(r.bow) === '[0,0]', r);
t('empty: deck, inside and stern parts ask for a hull first', r.why.every((w) => /Put a hull down first/.test(w)), r.why);
t('a part with no ship place (a tank gun) or none at all: null (the builder\'s own rules)', r.gun === null && r.none === null, r);
// a hulled design: one midsection
r = R(`(() => { const ps = [makePart('hbMidM', 0, 0, {})], b = tap(ps, 'hbBowM'), s = tap(ps, 'hbSternM'), [mid, bow, st] = ps;
  return { bow: [b.x, b.y, b.att === mid], stern: [s.x, s.y, s.att === mid], meetF: meet(mid, bow), meetA: meet(st, mid), clean: clean(ps), again: [Ship.spotOf('hbBowM', ps, {}).why, Ship.spotOf('hbSternM', ps, {}).why] }; })()`);
t('a midsection: a bow goes on its front, its keel level (centre 0.3 m higher), joined section to section', r.bow[0] === 9 && r.bow[1] === 0.3 && r.bow[2] && r.meetF, r);
t('...a stern on its back, joined; nothing clashes', r.stern[0] === -7 && r.stern[1] === 0 && r.stern[2] && r.meetA && r.clean, r);
t('...a second bow or stern is refused, saying why', /has a bow already/.test(r.again[0]) && /has a stern already/.test(r.again[1]), r.again);
r = R(`(() => { const ps = [makePart('hbMidM', 0, 0, {})], a = tap(ps, 'hbMidM'), b = tap(ps, 'hbBowM'), c = tap(ps, 'hbMidM'); return [[a.x, a.y], [b.x, b.y], [c.x, c.y]]; })()`);
t('a midsection goes on the open front, and with a bow on, on the open back', JSON.stringify(r) === '[[8,0],[17,0.3],[-8,0]]', r);
r = R(`(() => { const ps = [makePart('hbMidM', 0, 0, {}), makePart('hbBowM', 9, 0.3, {}), makePart('hbSternM', -7, 0, {}), makePart('bridgeM', 9, 4.8, {})]; ps[3].att = ps[1].id;
  const s = Ship.spotOf('hbMidM', ps, {}), q = tap(ps, 'hbMidM'), [mid, bow, st, br, m2] = ps;
  return { shift: s.shift && [s.shift.parts.map((p) => p.type).join(), s.shift.dx, s.shift.dy], at: [q.x, q.y], bow: [bow.x, bow.y], br: [br.x, br.y], joined: meet(mid, m2) && meet(m2, bow) && meet(st, mid), clean: clean(ps) }; })()`);
t('bow and stern on: a midsection goes in behind the bow, the bow and what hangs on it 8 m forward, all joined', r.shift && r.shift[0] === 'hbBowM' && r.shift[1] === 8 && r.shift[2] === 0
  && r.at.join() === '8,0' && r.bow.join() === '17,0.3' && r.br.join() === '17,4.8' && r.joined && r.clean, r);
// a hull of another class: refused with a reason (a test-only S-class midsection)
R(`PARTS.__midS = { ...PARTS.hbMidM, type: '__midS', name: 'Small Mid', w: 3, h: 1.3, depth: 2.6, shull: { cls: 'S', wl: -0.35, st: [[-1.5, 0.65, -0.65, 1.3, 1.25, 1], [1.5, 0.65, -0.65, 1.3, 1.25, 1]], ends: { aft: 'joint', fore: 'joint' }, k: 0.15 } };`);
r = R(`(() => { const ps = [makePart('hbMidM', 0, 0, {})], a = Ship.spotOf('__midS', ps, {}), ps2 = [makePart('__midS', 0, 0, {})], b = Ship.spotOf('hbBowM', ps2, {}); return [a.why, b.why]; })()`);
t('a segment of another size: "That … is for a smaller / bigger hull"', /is for a smaller hull/.test(r[0]) && /is for a bigger hull/.test(r[1]), r);
// a full design (the hull of the slice ship): deck, inside, stern
r = R(`(() => { const ps = [makePart('hbSternM', -13, 0, {}), makePart('hbMidM', -6, 0, {}), makePart('hbMidM', 2, 0, {}), makePart('hbBowM', 11, 0.3, {})];
  const br = tap(ps, 'bridgeM', true, { x: 3 }), d1 = tap(ps, 'dieselM', true), sc = tap(ps, 'screwM', true), ru = tap(ps, 'rudderM', true);
  const host = (q) => q.att, deck = (q) => q.att.y + shullSec(q.att.def.shull.st, q.x - q.att.x)[0];
  const inside = (q) => { const H = q.att, S = H.def.shull, { w, h } = partDims({ def: q.def, rot: 0 }), d = partDepth({ def: q.def }), zm = Math.abs(q.z) + d / 2;
    return [q.x - w / 2, q.x + w / 2].every((x) => { const P = shullPoly(shullSec(S.st, x - H.x), S.wl), yb = q.y - h / 2 - H.y, yt = q.y + h / 2 - H.y; // (the section's half-breadth at the box's bottom and top)
      const half = (y) => { let best = -1; for (let i = 0; i < P.length / 2; i++) { const j = (i + 1) % (P.length / 2), y0 = P[2 * i], y1 = P[2 * j]; if ((y0 - y) * (y1 - y) <= 0 && y1 !== y0) best = Math.max(best, Math.abs(P[2 * i + 1] + ((P[2 * j + 1] - P[2 * i + 1]) * (y - y0)) / (y1 - y0))); } return best; };
      return half(yb) >= zm - 1e-6 && half(yt) >= zm - 1e-6; }); };
  const keel = (x) => ps.filter((p) => p.def.shull).reduce((k, p) => { const H = shullOf(p.def); return x >= p.x + H.x0 && x <= p.x + H.x1 ? Math.min(k, p.y + shullSec(p.def.shull.st, x - p.x)[1]) : k; }, Infinity);
  const S = ps.find((p) => p.type === 'screwM'), U = ps.find((p) => p.type === 'rudderM');
  return { bridge: [br.x, +(br.y - br.def.h / 2 - deck(br)).toFixed(3), br.z, br.att.type], diesel: [d1.z, inside(d1), d1.att.def.shull ? 1 : 0, ps.filter((p) => p.type === 'dieselM').length],
    screw: [sc.x, sc.z, +(keel(sc.x) - (sc.y + 1.1)).toFixed(3), sc.att.type, ps.filter((p) => p.type === 'screwM').length], rudder: [ru.z, +(partRect(S).l - partRect(U).r).toFixed(3), ru.att.type], clean: clean(ps),
    more: [Ship.spotOf('dieselM', ps, { sym: true }), Ship.spotOf('screwM', ps, { sym: true }), Ship.spotOf('rudderM', ps, { sym: true })].map((q) => q && (q.why || [q.x, q.y, q.z].join())) }; })()`);
t('the deck: the wheelhouse on the deck line where the view looks (x 3), on the centre line, on the midsection under it', r.bridge[0] === 3 && Math.abs(r.bridge[1]) < 0.002 && r.bridge[2] === 0 && r.bridge[3] === 'hbMidM', r.bridge);
t('inside: a pair of diesels (symmetry on) off the centre line, wholly inside the hull\'s sections', r.diesel[0] > 0.89 && r.diesel[1] && r.diesel[2] === 1 && r.diesel[3] === 2, r.diesel);
t('the stern: a pair of screws 0.4 of the half-beam out (±1.4 m), just under the stern\'s keel, 1.5 m ahead of the transom', r.screw[0] === -14.46 && r.screw[1] === 1.4 && r.screw[2] > 0 && r.screw[2] < 0.03 && r.screw[3] === 'hbSternM' && r.screw[4] === 2, r.screw);
t('...a rudder behind each screw, 5 cm aft of it, on the stern', r.rudder[0] === 1.4 && Math.abs(r.rudder[1] - 0.05) < 0.002 && r.rudder[2] === 'hbSternM', r.rudder);
t('...nothing clashes; more taps find more room (a second pair of diesels, a rudder on the centre line), and a third screw none (the beam is full)', r.clean && !/No room/.test(r.more[0]) && /No room for the Propeller/.test(r.more[1]) && !/No room/.test(r.more[2]), r.more);

// ================================================================ 4. the slice ship by taps, joined as Ship.groups joins her
r = R(`(() => { const ps = [], seq = ['hbMidM', 'hbBowM', 'hbSternM', 'hbMidM', 'bridgeM', 'dieselM', 'screwM', 'rudderM'], why = [];
  for (const k of seq) { const s = tap(ps, k, true); if (!s || s.why) why.push(k + ': ' + (s && s.why)); }
  const adj = buildAdjacency(ps), c = findControlPart(ps), comp = componentOf(c.id, adj), v = new Vessel(ps, adj, EARTH); v.kind = 'ship'; v.rebuildGroups();
  const st = Ship.stats(ps), w = []; Ship.warnings(ps, st, w);
  return { n: ps.length, joined: comp.size, why, hydro: v.hydro, joins: v.sh.joins.length, open: v.sh.open.length, comps: v.sh.comps.length, warn: w, clean: clean(ps) }; })()`);
t('eight taps (with symmetry) build the slice ship: 11 parts, every one joined to the wheelhouse, nothing clashes', r.n === 11 && r.joined === 11 && !r.why.length && r.clean, r);
t('...her hull joined end to end as Ship.groups sees it (3 joins, no open end, 4 compartments), and no warnings', r.hydro && r.joins === 3 && r.open === 0 && r.comps === 4 && r.warn.length === 0, r);

// ================================================================ 5. the warnings, one design each
R(`var slice = () => partsFromDesign(sliceRows());
  var warn = (ps) => { const w = []; Ship.warnings(ps, Ship.stats(ps), w); return w.join(' '); };
  var drop = (ps, k) => ps.filter((p) => p.type !== k);
  var add = (ps, rows) => { for (const [k, x, y, z, on] of rows) { const h = ps.find((p) => p.type === on); ps.push(makePart(k, x, y, { z, att: h.id })); } return ps; };`);
const W = (code) => R(`warn(${code})`);
const cases = [
  ['no hull', `[makePart('bridgeM', 0, 0, {})]`, /^No hull: she can't float/],
  ['no stern: the stern is open', `drop(slice(), 'hbSternM')`, /The stern is open: she will flood/],
  ['no bow: the bow is open', `drop(slice(), 'hbBowM')`, /The bow is open: she will flood/],
  ['a gap in the hull', `slice().map((p) => (p.type === 'hbBowM' ? Object.assign(p, { x: p.x + 1 }) : p))`, /a gap between hull segments/],
  ['no screw', `drop(slice(), 'screwM')`, /No screw or waterjet: nothing pushes her/],
  ['no engine for the screws', `drop(slice(), 'dieselM')`, /No engine turns her propellers/],
  ['no rudder', `drop(slice(), 'rudderM')`, /No rudder: she can't steer/],
  ['top-heavy', `add(slice(), [0, 1, 2, 3].map((i) => ['dieselM', -2 + 4 * i, 30, 0, 'hbMidM']))`, /Top-heavy: GM −\d[\d.]* m, she will capsize/],
  ['a list', `add(slice(), [['dieselM', 4, 3.1, 2.4, 'hbMidM'], ['dieselM', 4, 5.3, 2.4, 'hbMidM']])`, /She lists \d+° to starboard: move weight across/],
  ['down by the bow', `add(slice(), [0, 1, 2].map((i) => ['dieselM', 18, 3.4 + 2.2 * i, 0, 'hbBowM']))`, /Down by the bow [\d.]+°: move weight aft/],
  // (weight added a diesel at a time over the stern until she trims past 1°: the parts' masses may be tuned later)
  ['down by the stern', `(() => { for (let n = 1; ; n++) { const ps = add(slice(), [...Array(n)].map((_, i) => ['dieselM', -14, 3.1 + 2.2 * i, 0, 'hbSternM'])); if (Ship.stats(ps).trim < -1 || n > 12) return ps; } })()`, /Down by the stern [\d.]+°: move weight forward/],
  ['she sinks', `add(slice(), [...Array(100)].map((_, i) => ['dieselM', -6 + 4 * (i % 6), 3.2, 0, 'hbMidM']))`, /Too heavy for her hull: \d+ t on a hull that floats \d+ t\. She'll sink/],
  ['overloaded', `add(slice(), [...Array(78)].map((_, i) => ['dieselM', -6 + 4 * (i % 6), -0.5, 0, 'hbMidM']))`, /Overloaded: her deck is only 0\.\d m above the water/],
  // (8 t raised half a metre at a time until GM falls under 0.3 m, not under 0)
  ['GM low: rolls heavily', `(() => { for (let y = 4; ; y += 0.5) { const ps = add(slice(), [0, 1, 2, 3].map((i) => ['__w2', 2, y + 2.2 * i, 0, 'hbMidM'])); if (Ship.stats(ps).GM < 0.3 || y > 60) return ps; } })()`, /GM under 0\.3 m: she'll roll heavily/],
  ['a propeller out of the water', `slice().map((p) => (p.type === 'screwM' ? Object.assign(p, { y: p.y + 5 }) : p))`, /A propeller is out of the water/],
  ['a rudder out of the water', `slice().map((p) => (p.type === 'rudderM' ? Object.assign(p, { y: p.y + 5 }) : p))`, /A rudder is out of the water/],
];
for (const [name, code, re] of cases) { const w = W(code); t(`warning: ${name}`, re.test(w), w); }
t('none of them ever says the rocket\'s "No engine fires in stage 1" (that is the builder\'s, never reached for a ship)', !cases.some(([, code]) => /stage 1/.test(W(code))));

// ================================================================ 6. the flight agrees (the hydro core, WP1, floats her)
// The slice ship off the bay in a calm sea: settled 40 s, then her draught and GM (Ship.stab) averaged over 10 s; then the
// telegraph at Flank (v.sh.tel 4) for 180 s and her speed over the last 20 s.
{
  const live = G.load({});
  const L2 = (c) => G.run(live, c);
  live.__SLICE = SLICE;
  const v = G.craft(live, SLICE, 'ship');
  live.__v = v; live.__s = G.sim();
  L2('__v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites.bay.east), 0, 0, Math.PI); Ship.launch(__v)'); // (bow out to sea, at her marks, as Flight.start puts a ship at the bay)
  L2(`Ship.setSea('calm'); var steps = (v, s, secs, each) => { for (let i = 0, n = Math.round(secs * 120); i < n; i++) { v.physicsStep(1 / 120, s); s.time = (s.time || 0) + 1 / 120; if (each && i % 60 === 59) each(); } };
    var mean = (secs, f) => { let n = 0, m = 0; steps(__v, __s, secs, () => { const x = f(); if (Number.isFinite(x)) { m += x; n++; } }); return n ? m / n : null; };`);
  L2('steps(__v, __s, 2)');
  const on = L2('!!(__v.sh && __v.sh.B > 0 && __v.afloat)');
  t('the hydro core floats her (Ship.forces: buoyancy, afloat)', on);
  if (on) {
    const st = L2(`(() => { const s = Ship.stats(__v.parts); return { draft: s.draft, GM: s.GM, top: s.top }; })()`);
    L2('steps(__v, __s, 38)');
    const fl = L2(`({ draft: mean(10, () => __v.draft), GM: mean(10, () => Ship.stab(__v)) })`);
    t(`the flight floats her at the builder's draught ±10 % (builder ${st.draft.toFixed(2)} m, flight ${fl.draft.toFixed(2)} m, calm, 10 s mean)`, pct(fl.draft, st.draft) < 0.1, { st, fl });
    t(`...and the builder's GM ±0.15 m (builder ${st.GM.toFixed(2)} m, flight ${fl.GM.toFixed(2)} m)`, Math.abs(fl.GM - st.GM) <= 0.15, { st, fl });
    L2('__v.sh.tel = 4; __v.sas = "hold"; steps(__v, __s, 160)');
    const v1 = L2('mean(20, () => __v.speed())');
    t(`full ahead she makes the builder's top speed ±12 % (builder ~${(st.top * 1.9438).toFixed(1)} kn, flight ${(v1 * 1.9438).toFixed(1)} kn over 160-180 s)`, pct(v1, st.top) < 0.12, { st, v1 });
  }
}
// ================================================================ 7. every stock ship (WP5): the flight agrees with the builder
// Each stock ship of kind ship, as in 6: draught ±10 %, GM ±0.15 m, top speed ±12 %. A ship that goes by waterjets alone
// (the Pegazus, the Vizby) is compared on speed once waterjets push in flight (WP6): until then it says so.
for (const key of G.run(G.load({ earth: false }), `Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].kind === 'ship')`)) {
  const live = G.load({});
  const L2 = (c) => G.run(live, c);
  const v = G.craft(live, G.templateRows(live, key), 'ship');
  live.__v = v; live.__s = G.sim();
  L2('__v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites.bay.east), 0, 0, Math.PI); Ship.launch(__v)');
  L2(`Ship.setSea('calm'); var steps = (v, s, secs, each) => { for (let i = 0, n = Math.round(secs * 120); i < n; i++) { v.physicsStep(1 / 120, s); s.time = (s.time || 0) + 1 / 120; if (each && i % 60 === 59) each(); } };
    var mean = (secs, f) => { let n = 0, m = 0; steps(__v, __s, secs, () => { const x = f(); if (Number.isFinite(x)) { m += x; n++; } }); return n ? m / n : null; };`);
  const st = L2(`(() => { const s = Ship.stats(__v.parts); return { draft: s.draft, GM: s.GM, top: s.top }; })()`);
  L2('steps(__v, __s, 40)');
  const fl = L2(`({ draft: mean(10, () => __v.draft), GM: mean(10, () => Ship.stab(__v)) })`);
  const jetsOnly = L2(`__v.parts.some((p) => p.def.jet) && !__v.parts.some((p) => p.def.screw)`), jetsPush = L2(`!!__v.sh.scr.some((s) => s.p.def.jet)`);
  let v1 = null;
  if (!jetsOnly || jetsPush) { L2('__v.sh.tel = 4; __v.sas = "hold"; steps(__v, __s, 160)'); v1 = L2('mean(20, () => __v.speed())'); }
  const kn = (x) => (x * 1.9438).toFixed(1);
  t(`${key}: the flight floats her at the builder's draught ±10 % (${st.draft.toFixed(2)} / ${fl.draft.toFixed(2)} m) and GM ±0.15 m (${st.GM.toFixed(2)} / ${fl.GM.toFixed(2)} m)${v1 == null ? '' : `, and makes its top speed ±12 % (~${kn(st.top)} / ${kn(v1)} kn)`}`,
    pct(fl.draft, st.draft) < 0.1 && Math.abs(fl.GM - st.GM) <= 0.15 && (v1 == null || pct(v1, st.top) < 0.12), { st, fl, v1 });
  if (v1 == null) console.log(`     (skip) ${key}: her top speed waits for waterjets that push in flight (WP6)`);
}
t.done();
