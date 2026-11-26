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

// ================================================================ 7. placement for every place (WP7, spec §11.2)
// The spec's parts that aren't in the catalogue yet come from test/lib/shipdefs.js (test-only defs with §6's keys, sizes and
// fields; a key already in PARTS is left alone, so this runs on the real parts as they land). A destroyer's hull (the X
// class) by taps, then every kind of part tapped onto it: on an empty design, on the bare hull, and on a full design.
R(require('fs').readFileSync(require('path').join(__dirname, 'lib', 'shipdefs.js'), 'utf8'));
R(`var hullX = () => { const ps = []; for (const k of ['hbMidX', 'hbBowX', 'hbSternX', 'hbMidX']) tap(ps, k, true); return ps; };
  var deckOf = (ps, x) => ps.filter((p) => p.def.shull).reduce((m, p) => { const H = shullOf(p.def); return x >= p.x + H.x0 - 1e-6 && x <= p.x + H.x1 + 1e-6 ? Math.max(m, p.y + shullSec(p.def.shull.st, x - p.x)[0]) : m; }, -Infinity);
  var keelOf = (ps, x) => ps.filter((p) => p.def.shull).reduce((m, p) => { const H = shullOf(p.def); return x >= p.x + H.x0 - 1e-6 && x <= p.x + H.x1 + 1e-6 ? Math.min(m, p.y + shullSec(p.def.shull.st, x - p.x)[1]) : m; }, Infinity);
  var deckTop = (ps, q) => { let t = -Infinity; const R = partRect(q); for (let x = R.l; x <= R.r + 1e-9; x += 0.25) t = Math.max(t, deckOf(ps, Math.min(x, R.r))); return t; };
  var ext = (ps) => { let a = Infinity, b = -Infinity; for (const p of ps) if (p.def.shull) { const H = shullOf(p.def); a = Math.min(a, p.x + H.x0); b = Math.max(b, p.x + H.x1); } return [a, b]; };
  var where = (q) => (q && !q.why ? { x: q.x, y: q.y, z: q.z, rot: q.rot, on: q.att && q.att.type, R: partRect(q) } : q);`);
const PLACES = ['bridgeL', 'stealthHouse', 'deckhouseL', 'funnel', 'hangar', 'helipad', 'consoleS', 'mastLattice', 'mastPole', 'nRadarAir', 'nRadarFC', 'nRadarSea',
  'nRingM', 'ciws', 'asm4', 'vls8', 'torpTube', 'decoy', 'turbine', 'dieselS', 'outboard', 'screwS', 'screwL', 'waterjet', 'rudderL', 'foilBow', 'foilAft',
  'bulkhead', 'pump', 'ballast', 'dcLocker', 'magazine', 'torpDecoy'];
r = R(`(() => { const ps = []; return ${JSON.stringify(PLACES)}.map((k) => [k, Ship.spotOf(k, ps, {})]).filter(([, s]) => !(s && /Put a hull down first/.test(s.why))).map(([k]) => k); })()`);
t('empty: every ship part that goes on a hull (deck, superstructure, masts, the edge, inside, the stern, the bow, under the keel) asks for a hull first', r.length === 0, r);
r = R(`(() => { const ps = []; return ['ribHull', 'pontoon', 'hbBowX'].map((k) => { const s = Ship.spotOf(k, ps, {}); return [s.x, s.y, s.z]; }); })()`);
t('empty: any hull (a one-piece RIB hull, a float, a destroyer\'s bow) goes at the origin', r.every((q) => q.join() === '0,0,0'), r);
r = R(`(() => { const ps = []; return ['nHouse127', 'nGun76', 'mgHeavy'].map((k) => Ship.spotOf(k, ps, {})); })()`);
t('empty: a gun house, a naval gun, a pintle gun: null (the builder\'s own rules)', r.every((q) => q === null), r);
// the bare hull: each part alone on it, from the same view (its middle)
r = R(`(() => { const out = {}, ps0 = hullX(), [X0, X1] = ext(ps0), L = X1 - X0, s0 = Ship.stats(ps0);
  for (const k of ${JSON.stringify(PLACES)}) { const ps = hullX(), q = Ship.spotOf(k, ps, { sym: true }); out[k] = where(q); if (q && !q.why) out[k].deck = deckTop(ps, q); }
  return { out, X0, X1, L, n: ps0.length, open: s0.open, cg: s0.cg }; })()`);
const B = r.out, X0 = r.X0, X1 = r.X1, Lx = r.L, onDeck = (q) => !!q && !q.why && Math.abs(q.R.b - q.deck) < 0.02;
t('the X hull by four taps (a midsection, the bow, the stern, a second midsection in behind the bow): 108 m, closed', r.n === 4 && Math.abs(Lx - 108) < 0.01 && r.open === 0, { n: r.n, L: Lx, open: r.open });
t('a hulled design: every part gets a pose (none refused, none left to the builder)', PLACES.every((k) => B[k] && !B[k].why), PLACES.filter((k) => !B[k] || B[k].why).map((k) => k + ':' + JSON.stringify(B[k])));
t('...a gun ring: on the deck, on the centre line, as far forward as the bow\'s beam lets it', onDeck(B.nRingM) && B.nRingM.z === 0 && B.nRingM.x > X1 - 0.12 * Lx && B.nRingM.on === 'hbBowX', B.nRingM);
t('...the helicopter deck: on the deck at her very stern', onDeck(B.helipad) && Math.abs(B.helipad.R.l - X0) < 0.3, B.helipad);
t('...a bridge: on the deck, its front 30-40 % of her length from the bow', onDeck(B.bridgeL) && B.bridgeL.R.r >= X1 - 0.4 * Lx - 1e-6 && B.bridgeL.R.r <= X1 - 0.3 * Lx + 1e-6 && B.bridgeL.z === 0, B.bridgeL);
t('...the stealth superstructure: a bridge too (its front 30-40 % from the bow)', onDeck(B.stealthHouse) && B.stealthHouse.R.r >= X1 - 0.4 * Lx - 1e-6 && B.stealthHouse.R.r <= X1 - 0.3 * Lx + 1e-6, B.stealthHouse);
t('...a helm console: on the deck a little aft of amidships', onDeck(B.consoleS) && B.consoleS.x < (X0 + X1) / 2 && B.consoleS.x > X0 + 0.3 * Lx, B.consoleS);
t('...vertical launch cells: flush, their top at the deck line, on the centre line, in the hull', !!B.vls8 && Math.abs(B.vls8.R.t - B.vls8.deck) < 0.3 && B.vls8.z === 0 && /^hb/.test(B.vls8.on), B.vls8);
t('...anti-ship missiles (symmetry on): on the deck at its edge (the twin across), over the deck', onDeck(B.asm4) && B.asm4.z > 4 && B.asm4.z + 2.3 <= 8.01, B.asm4);
t('...torpedo tubes and decoys: at the deck edge', onDeck(B.torpTube) && B.torpTube.z > 7 && onDeck(B.decoy) && B.decoy.z > 7, [B.torpTube, B.decoy]);
t('...with no superstructure: a funnel, a deckhouse, a hangar, masts and radars on the deck; the close-in gun on the deck aft', ['funnel', 'deckhouseL', 'hangar', 'mastLattice', 'nRadarAir'].every((k) => onDeck(B[k])) && onDeck(B.ciws) && B.ciws.x < X0 + 0.1 * Lx, ['funnel', 'ciws'].map((k) => B[k]));
t('...inside: engines, a pump, ballast, a damage control party and a magazine low in the hull (under the waterline)', ['turbine', 'dieselS', 'pump', 'ballast', 'dcLocker', 'magazine'].every((k) => B[k].R.b < -3 && /^hb/.test(B[k].on)), ['turbine', 'ballast', 'magazine'].map((k) => B[k]));
t('...ballast the lowest of them (its middle: her weight low); the damage control party amidships', B.ballast.y <= Math.min(B.turbine.y, B.pump.y, B.magazine.y, B.dcLocker.y, B.dieselS.y) + 0.01 && Math.abs(B.dcLocker.x - (X0 + X1) / 2) < 10, [['turbine', 'pump', 'magazine', 'dcLocker', 'dieselS', 'ballast'].map((k) => B[k].y), B.dcLocker.x]);
t('...a bulkhead: across the middle of a compartment (a segment\'s middle), on the centre line', B.bulkhead.z === 0 && R(`hullX().some((p) => p.def.shull && Math.abs(p.x - ${B.bulkhead.x}) < 0.01)`), B.bulkhead);
t('...the stern: propellers and a rudder under it, an outboard on the transom\'s aft face (its foot under the keel), a waterjet in the transom at the keel line',
  B.screwL.on === 'hbSternX' && B.rudderL.on === 'hbSternX' && B.outboard.R.r <= X0 + 1e-6 && B.outboard.R.r > X0 - 0.1 && B.outboard.R.b < -3 + 0.01 && B.waterjet.R.l < X0 && B.waterjet.R.r > X0 && Math.abs(B.waterjet.R.b - (-3 + 0.01)) < 0.05,
  ['screwL', 'rudderL', 'outboard', 'waterjet'].map((k) => B[k]));
t('...a torpedo decoy on the stern\'s deck', onDeck(B.torpDecoy) && B.torpDecoy.x < X0 + 0.1 * Lx, B.torpDecoy);
{
  const kb = R(`keelOf(hullX(), ${B.foilBow.x})`), ka = R(`keelOf(hullX(), ${B.foilAft.x})`);
  t('...the bow hydrofoil under the forefoot, in her foremost fifth, its top at the keel', B.foilBow.x >= X1 - 0.2 * Lx && B.foilBow.R.t <= kb + 1e-6 && B.foilBow.z === 0, { ...B.foilBow, kb });
  t('...the main hydrofoil under her 10 % of her length aft of the centre of gravity, its top at the keel', Math.abs(B.foilAft.x - (r.cg.x - 0.1 * Lx)) < 0.5 && B.foilAft.R.t <= ka + 1e-6, { ...B.foilAft, ka, cg: r.cg.x });
}
// one-piece hulls beside one another (a catamaran of RIBs; floats in a pair)
r = R(`(() => { const ps = [], a = tap(ps, 'ribHull', true), b = tap(ps, 'ribHull', true), H = shullOf(PARTS.ribHull), hb = Math.max(...H.rings.map((r) => r.bd));
  const keel = (p) => p.y + Math.min(...H.rings.map((r) => r.yk));
  return { n: ps.length, z: b.z, want: 2 * hb + 0.5, level: Math.abs(keel(ps[1]) - keel(ps[0])) < 1e-6, pair: !!ps[2] && partZ(ps[2]) === -partZ(ps[1]) }; })()`);
t('one-piece hulls: a second RIB hull goes beside the first, both half-beams and 0.5 m out, keels level, a pair with symmetry on (a catamaran)', r.n === 3 && Math.abs(r.z - r.want) < 0.01 && r.level && r.pair, r);
// the ground update's places on a ship: a gun on a bare ring with no house aboard, roof kit on the superstructure, a gun
// house on the free ring nearest the view, and with one aboard, its gun left to the builder's tank rules
r = R(`(() => { const ps = hullX(), ring = tap(ps, 'nRingM', true), gun = tap(ps, 'nGun76', true), br = tap(ps, 'bridgeL', true), mg = tap(ps, 'mgHeavy', true), ring2 = tap(ps, 'nRingM', true), house = tap(ps, 'nHouse127', true);
  const g = ps.find((p) => p.type === 'nGun76'), rg = ps.find((p) => p.type === 'nRingM'), d = PARTS.nGun76;
  return { gun: [gun.att === rg, +(gun.x - (rg.x + d.h / 2 - d.aim.pivot * d.h)).toFixed(3), Math.abs(partRect(g).b - partRect(rg).t) < 1e-6, gun.rot],
    mg: [mg.att && mg.att.type, Math.abs(partRect(ps.find((p) => p.type === 'mgHeavy')).b - partRect(ps.find((p) => p.type === 'bridgeL')).t) < 1e-6],
    ring1: rg.x, br: partRect(ps.find((p) => p.type === 'bridgeL')).r, ring2: where(ring2), house: [house.att === ps.filter((p) => p.type === 'nRingM')[1], house.x === ring2.x], then: Ship.spotOf('nGun76', ps, {}), noRing: Ship.spotOf('nHouse127', hullX(), {}) }; })()`);
t('a naval gun with no gun house aboard: on the bare ring, its trunnion over the ring\'s middle, pointing forward', r.gun[0] && r.gun[1] === 0 && r.gun[2] && r.gun[3] === 3, r.gun);
t('a pintle gun with no turret aboard: on the bridge\'s roof', r.mg[0] === 'bridgeL' && r.mg[1], r.mg);
t('a second gun ring: still ahead of the bridge, room for both gun houses between them (5 m apart); a gun house on the free ring', !!r.ring2 && r.ring2.R.l >= r.br - 1e-6 && r.ring1 - r.ring2.x >= 5 - 1e-6 && r.house[0] && r.house[1], r);
t('...with a gun house aboard, a tapped gun is left to the builder (null: into the house\'s face, as on a tank); a house with no ring aboard says why', r.then === null && /Put a gun ring on the deck first/.test(r.noRing.why), r);

// the full design: every kind of part tapped onto the hull in turn (symmetry on), each where it should be among the rest
const FULL = ['bridgeL', 'nRingM', 'nHouse127', 'deckhouseL', 'funnel', 'helipad', 'hangar', 'ciws', 'mastLattice', 'nRadarAir', 'nRadarFC', 'nRadarSea', 'vls8', 'asm4',
  'torpTube', 'decoy', 'turbine', 'turbine', 'screwL', 'rudderL', 'magazine', 'pump', 'dcLocker', 'ballast', 'bulkhead', 'torpDecoy', 'foilBow', 'foilAft'];
R(`var full = () => { const ps = hullX(), why = []; for (const k of ${JSON.stringify(FULL)}) { const s = tap(ps, k, true); if (!s || s.why) why.push(k + ': ' + (s && s.why)); } return { ps, why }; };`);
r = R(`(() => { const { ps, why } = full(), one = (k) => ps.find((p) => p.type === k), all = (k) => ps.filter((p) => p.type === k), Rc = (k) => partRect(one(k));
  const adj = buildAdjacency(ps), c = findControlPart(ps), comp = componentOf(c.id, adj);
  const sup = ps.filter((p) => ['bridgeL', 'deckhouseL', 'hangar'].includes(p.type)), sx0 = Math.min(...sup.map((p) => partRect(p).l)), sx1 = Math.max(...sup.map((p) => partRect(p).r));
  return { n: ps.length, joined: comp.size, why, clean: clean(ps),
    ring: [Rc('nRingM').l >= Rc('bridgeL').r - 1e-6, one('nHouse127').att === one('nRingM').id],
    house: Math.abs(Rc('deckhouseL').r - Rc('bridgeL').l) < 0.02, funnel: one('funnel').att === one('deckhouseL').id,
    hangar: Math.abs(Rc('hangar').l - Rc('helipad').r) < 0.3, ciws: [one('ciws').att === one('hangar').id, Math.abs(Rc('ciws').b - Rc('hangar').t) < 1e-6],
    mast: one('mastLattice').att === one('bridgeL').id, radar: one('nRadarAir').att === one('mastLattice').id && Math.abs(Rc('nRadarAir').b - Rc('mastLattice').t) < 1e-6,
    vls: Rc('vls8').l >= sx1 - 1e-6 || Rc('vls8').r <= sx0 + 1e-6, edge: all('torpTube').length === 2 && all('decoy').length === 2,
    mag: Math.abs(one('magazine').x - one('nRingM').x) < 25, pumpLow: Rc('pump').b < -3, sym: all('asm4').length === 2 && all('turbine').length === 4 }; })()`);
t('the full design: 28 taps put every part on (each found a place), every one joined, nothing clashes', !r.why.length && r.joined === r.n && r.clean, r);
t('...the gun ring ahead of the bridge, its gun house on it; the deckhouse just aft of the bridge, the funnel on the deckhouse', r.ring.every(Boolean) && r.house && r.funnel, r);
t('...the hangar just ahead of the helicopter deck, the close-in gun on the hangar\'s roof (the aftmost superstructure)', r.hangar && r.ciws.every(Boolean), r);
t('...the lattice mast on the bridge (the highest superstructure), the air radar on the mast\'s top', r.mast && r.radar, r);
t('...the cells clear of the superstructure; tubes and decoys in pairs at the edge; the magazine toward the gun ring; pairs with symmetry', r.vls && r.edge && r.mag && r.sym && r.pumpLow, r);

// ================================================================ 8. the kit's warnings (WP7, spec §11.3): each fires, then clears
// Each from a design that has the fault and the same design with it put right. A sound base: the slice ship (no warnings),
// and a destroyer's hull with a bridge, turbines, screws and rudders (warns only what a case adds).
R(`var dd = () => { const ps = hullX(); for (const k of ['bridgeL', 'turbine', 'turbine', 'screwL', 'rudderL', 'pump']) tap(ps, k, true); return ps; };
  var ww = (ps, extra) => { const w = []; Ship.warnings(ps, Ship.stats(ps), w, extra); return w.join(' '); };
  var put = (ps, k, x, y, z, on) => { const p = makePart(k, x, y, { z: z || 0, att: on ? on.id : null }); ps.push(p); return p; };
  var kind = (ps, t) => ps.find((p) => p.type === t);`);
t('the destroyer base: no warnings', R(`ww(dd())`) === '', R(`ww(dd())`));
const W8 = [
  ['torpedo tubes with no water under them (no hull, no wings)', `[makePart('bridgeM', 0, 0, {}), makePart('torpTube', 0, 2, {})]`, `(() => { const ps = slice(); tap(ps, 'torpTube', true); return ps; })()`, /Torpedo tubes need water under them/],
  ['vertical launch cells with no fire-control radar', `(() => { const ps = dd(); tap(ps, 'vls8', true); return ps; })()`, `(() => { const ps = dd(); tap(ps, 'vls8', true); tap(ps, 'nRadarFC', true); return ps; })()`, /The vertical launcher's missiles need a Fire-Control Radar aboard/],
  ['something on the helicopter deck', `(() => { const ps = dd(); tap(ps, 'helipad', true); const H = kind(ps, 'helipad'); put(ps, 'ballast', H.x, partRect(H).t + 1, 0, H); return ps; })()`,
    `(() => { const ps = dd(); tap(ps, 'helipad', true); const H = kind(ps, 'helipad'); put(ps, 'ballast', H.x, partRect(H).t + 4.5, 0, H); return ps; })()`, /Something stands on the helicopter deck/],
  ['hydrofoils that can\'t lift her (a destroyer on a patrol hydrofoil\'s foils)', `(() => { const ps = dd(); tap(ps, 'foilBow', true); tap(ps, 'foilAft', true); return ps; })()`,
    `(() => { const ps = slice(); tap(ps, 'foilBow', true); tap(ps, 'foilAft', true); return ps; })()`, /Her foils can't lift her: they hold \d+ t at 40 kn and she weighs [\d,]+ t/],
  ['a bulkhead outside every hull', `(() => { const ps = dd(); const H = ps[0]; put(ps, 'bulkhead', H.x, H.y + 9, 0, H); return ps; })()`, `(() => { const ps = dd(); tap(ps, 'bulkhead', true); return ps; })()`, /A bulkhead only works inside a hull segment/],
  ['more weapon stations than gunners', `(() => { const ps = slice(); for (const k of ['nRingM', 'nGun76', 'torpTube']) tap(ps, k, true); return ps; })()`,
    `(() => { const ps = slice(); for (const k of ['nRingM', 'nGun76']) tap(ps, k, true); return ps; })()`, /3 weapon stations, 1 gunner: only one fires at once/],
  ['a radar below the funnel', `(() => { const ps = dd(); tap(ps, 'deckhouseL', true); tap(ps, 'funnel', true); const F = kind(ps, 'funnel'), D = kind(ps, 'deckhouseL'); put(ps, 'nRadarSea', F.x - 4, partRect(D).t + 0.3, 0, D); return ps; })()`,
    `(() => { const ps = dd(); tap(ps, 'deckhouseL', true); tap(ps, 'funnel', true); tap(ps, 'mastLattice', true); tap(ps, 'nRadarSea', true); return ps; })()`, /The radar sits below the funnel: smoke blinds it aft/],
  ['anti-ship missiles with no surface radar', `(() => { const ps = dd(); tap(ps, 'asm4', true); return ps; })()`, `(() => { const ps = dd(); tap(ps, 'asm4', true); tap(ps, 'mastLattice', true); tap(ps, 'nRadarSea', true); return ps; })()`, /Anti-ship missiles need a target/],
  ['a magazine above the waterline', `(() => { const ps = dd(); const H = ps[0]; put(ps, 'magazine', H.x, H.y + 3.5, 0, H); return ps; })()`, `(() => { const ps = dd(); tap(ps, 'magazine', true); return ps; })()`, /A magazine above the waterline goes up more easily/],
  ['over 500 t with no pump or damage control party', `dd().filter((p) => p.type !== 'pump')`, `(() => { const ps = dd().filter((p) => p.type !== 'pump'); tap(ps, 'dcLocker', true); return ps; })()`, /No pumps or damage control: one hole could be the end of her/],
];
for (const [name, bad, good, re] of W8) {
  const a = R(`ww(${bad})`), b = R(`ww(${good})`);
  t(`warning: ${name} fires, and clears when put right`, re.test(a) && !re.test(b), { fires: a, cleared: b });
}
r = [R(`ww(dd(), { arcs: [{ x: 60, deg: 80 }] })`), R(`ww(dd(), { arcs: [{ x: -30, deg: 45 }] })`), R(`ww(dd(), { arcs: [{ x: 60, deg: 200 }, { x: -30, deg: 360 }] })`)];
t('warning: a gun whose arcs the superstructure blocks past 270° (the turret sweep\'s arc): "the forward gun can only fire over 80°", "the after gun"; clear over 90°',
  /The forward gun can only fire over 80°: raise it or move the superstructure/.test(r[0]) && /The after gun can only fire over 45°/.test(r[1]) && !/can only fire/.test(r[2]), r);
t('the red ones before the amber ones (the hints last)', R(`(() => { const ps = dd(); tap(ps, 'vls8', true); tap(ps, 'asm4', true); return ww(ps); })()`).search(/Fire-Control/) < R(`(() => { const ps = dd(); tap(ps, 'vls8', true); tap(ps, 'asm4', true); return ww(ps); })()`).search(/Anti-ship missiles need/));
t('Ship.kitWarnings alone (any kind carrying ship parts): torpedo tubes on a tank warn (and nothing about gunners: another kind\'s crew is its own); on a plane (wings) they don\'t',
  R(`(() => { const w = []; Ship.kitWarnings([makePart('hullLight', 0, 0, {}), makePart('torpTube', 0, 2, {})], null, w); const v = []; Ship.kitWarnings([makePart('wing', 0, 0, {}), makePart('torpTube', 0, 2, {})], null, v); return w.length === 1 && /need water/.test(w[0]) && !v.length; })()`));

// ================================================================ 9. cards, tray lines, X-ray, ship classes (WP7, spec §11.4)
r = R(`(() => { const o = {}; for (const k of ['hbMidM', 'hbBowX', 'ribHull', 'dieselM', 'turbine', 'outboard', 'screwM', 'screwL', 'waterjet', 'rudderM', 'foilBow', 'foilAft', 'nGun76', 'asm4', 'vls8', 'ciws', 'torpTube', 'decoy', 'nRadarAir', 'nRadarSea', 'nRadarFC',
  'helipad', 'hangar', 'funnel', 'bulkhead', 'pump', 'magazine', 'dcLocker', 'ballast', 'mastLattice', 'bridgeM', 'stealthHouse', 'torpDecoy']) o[k] = [Ship.specs(PARTS[k]).join(' · '), Ship.line(PARTS[k])]; return o; })()`);
const C = r;
t('every ship part has card lines and a tray line', Object.entries(C).every(([, [a, b]]) => a.length > 0 && b), Object.entries(C).filter(([, [a, b]]) => !a || !b).map(([k]) => k));
// (the patrol midsection's own numbers: its hull's volume to the deck × the sea's density, its waterline over its keel:
// WP5's −0.7 over −2.0, 1.3 m)
const HM = R(`(() => { const d = PARTS.hbMidM, S = d.shull; return { t: Math.round((shullOf(d).vol * 1025) / 1000), d: (S.wl - Math.min(...S.st.map((s) => s[2]))).toFixed(1), len: d.w }; })()`);
t(`a hull segment: what it floats (${HM.t} t), what it draws at her marks (${HM.d} m), one watertight compartment and its length`, C.hbMidM[0].startsWith(`Floats up to ${HM.t} t of ship · draws ${HM.d} m at her marks · one watertight compartment, ${HM.len} m`) && C.hbMidM[1] === `draws ${HM.d} m`, { C: C.hbMidM, HM });
t('...a one-piece hull says so; a destroyer\'s plating in steel', /a one-piece hull, 9 m/.test(C.ribHull[0]) && /glass fibre/.test(C.ribHull[0]) && /12 mm steel/.test(C.hbBowX[0]), [C.ribHull, C.hbBowX]);
t('an engine its power ("2,000 kW"); a turbine its spool; an outboard its own propeller and steering', C.dieselM[1] === '2,000 kW' && /2,000 kW/.test(C.dieselM[0]) && /full power in 15 s/.test(C.turbine[0]) && /its own propeller · steers 30°/.test(C.outboard[0]), [C.dieselM, C.turbine, C.outboard]);
t('a propeller its push in knots ("about 150 kN at 15 kn on 2 MW"); the large one full power astern; a waterjet its push and steering', /^about 150 kN at 15 kn on 2 MW/.test(C.screwM[0]) && /full power astern/.test(C.screwL[0]) && /at 30 kn/.test(C.waterjet[0]) && /reverses/.test(C.waterjet[0]), [C.screwM, C.screwL, C.waterjet]);
t('a rudder its throw and area ("turns 35° · 0.8 m²"); a hydrofoil its lift at 40 kn', C.rudderM[0] === 'turns 35° · 0.8 m²' && /^lifts \d+ t at 40 kn/.test(C.foilBow[0]) && /ride control/.test(C.foilAft[0]), [C.rudderM, C.foilBow]);
t('weapons: a gun\'s calibre and rate a minute, missiles\' range and skimming height, the cells\' SAMs, the close-in gun by itself, tubes, decoys',
  /^76 mm · 80 a minute/.test(C.nGun76[0]) && /18 km · skims at 8 m/.test(C.asm4[0]) && /^8 SAMs · 12 km · shoots missiles too/.test(C.vls8[0]) && /^1\.5 km · fires by itself/.test(C.ciws[0]) && /3 torpedoes · 8 km/.test(C.torpTube[0]) && /12 rockets of chaff and flares/.test(C.decoy[0]),
  [C.nGun76, C.asm4, C.vls8, C.ciws, C.torpTube, C.decoy]);
t('radars: "sees ships 14 km (the horizon permitting)", aircraft 18 km, the fire-control radar tracks and guides SAMs', /sees ships 14 km \(the horizon permitting\)/.test(C.nRadarSea[0]) && /sees aircraft 18 km/.test(C.nRadarAir[0]) && /tracks 14 km · guides SAMs/.test(C.nRadarFC[0]), [C.nRadarSea, C.nRadarAir, C.nRadarFC]);
t('the helicopter deck "a helicopter lands and is lashed"; the rest of the kit in plain words', /a helicopter lands and is lashed/.test(C.helipad[0]) && /pumps 0\.15 m³\/s/.test(C.pump[0]) && /400 rounds/.test(C.magazine[0]) && /4 damage control crew/.test(C.dcLocker[0]) && /radars see her 40% less far/.test(C.stealthHouse[0]),
  [C.helipad, C.pump, C.magazine, C.dcLocker, C.stealthHouse]);
t('old parts: no ship line (the builder\'s own)', R(`Ship.line(PARTS.gun75) === null && Ship.line(PARTS.engine) === null && Ship.specs(PARTS.wing).length === 0`));
r = R(`(() => { const ps = dd(); tap(ps, 'bulkhead', true); tap(ps, 'magazine', true); tap(ps, 'dcLocker', true); const X = Ship.xray(ps);
  return { comps: X.comps.map((c) => [c.n, +c.x0.toFixed(2), +c.x1.toFixed(2)]), bh: X.bulkheads.map((b) => b.x), belts: X.belts.length, marks: X.marks.map((m) => m.kind).sort().join() }; })()`);
t('X-ray: her compartments numbered from the bow (a bulkhead cuts one in two), the bulkhead\'s line, the belt bands, the magazine, engines, pump and party', r.comps.length === 5 && r.comps[0][0] === 1 && r.comps[0][2] === 70 && r.bh.length === 1 && r.belts === 2 && r.marks === 'dc,dc,engine,engine,engine,engine,mag,mag,pump,pump', r);
r = R(`(() => { const t = (parts, kind = 'ship') => shipClass({ kind, parts }); return [t([['ribHull', 0, 0]]), t(TEMPLATES.cyclon.parts), t([['hbSternX', -25, 0], ['hbMidX', 0, 0], ['hbBowX', 29, 0.5]]), t([['hbSternM', -13, 0], ...[...Array(8)].map((_, i) => ['hbMidM', -6 + 8 * i, 0]), ['hbBowM', 59, 0.3]]), t([['ribHull', 0, 0]], 'plane')].map((c) => c.name + ' ' + Math.round(c.len)); })()`);
t('ship classes for the hangar: a boat (9 m), the Cyclon a patrol boat (32 m), an 84 m destroyer hull of 3,200 t a destroyer, an 80 m light hull an escort; a flying boat last', r.join() === 'Boat 9,Patrol boat 32,Destroyer 84,Escort 80,Flying boat 9', r);

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
