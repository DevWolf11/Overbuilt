// Multiplayer craft sync: the spawn-row sanitiser on forged input (ids, types, numbers, depth, paint, att links and
// loops, the 600-part cap), onSpawn and buildGhost on what survives, an owner -> ghost round trip of a jumbo with
// moved pods and paint (adjacency, mass, centre of mass, inertia, hull equal), snapshots carrying com.z, the carrier
// size check (measure) against test/baseline/mp-measure.json, the part cap, and battleDesign.
//   node test/mp.test.js [--update]
const G = require('./lib/game.js'), { check } = require('./lib/baseline.js');
const N = G.load({ mp: true, earth: false });
const R = (code) => G.run(N, code);
const t = G.checks('multiplayer: spawn rows, ghosts, snapshots, measure');

// ---- 1. forged spawn rows
R(`var forged = [
  [1, 'fuselageW', 0, 7.5, 0, 0],                         // old 6-element row
  [2, 'wingL', 0.9, 11.6, 0, 0, 7, 1, 'stealth'],          // wing: z forced to 0, skin ok
  [3, 'fanPods', 1.8, 12.4, 0, 0, NaN, 2, 'constructor'],  // NaN z -> default, bad skin
  [4, 'fanPods', 1.8, 12.4, 0, 0, 1e9, 2, '__proto__'],    // z clamped to 20
  [5, 'jet', 1.5, 11.6, 7, 1, -1e9, 6, 'red'],             // single: z clamped to -20; rot 7 -> 3; att cycle 5 <-> 6
  [6, 'jet', 1.5, 11.6, 0, 'yes', 4, 5, 'toString'],
  [7, '__proto__', 0, 0], [8, 'constructor', 0, 0], [9, 'hasOwnProperty', 0, 0],
  [10, 'aam', 0.5, 11, 0, 0, -0.001, 999, 'stealth'],      // twin z below the minimum; att to an unknown id
  [10, 'gun', 0, 0], [0, 'gun', 0, 0], [-3, 'gun', 0, 0], [1.5, 'gun', 0, 0], ['11', 'gun', 0, 0], [2 ** 60, 'gun', 0, 0],
  [11, 'gun', 1e9, -1e9, 0, 0, 0, 11, 7],                  // self link; x/y clamped; skin a number
  [12, 'gun', 0, 0, 0, 0, '3', [1], { a: 1 }],             // string z, array att, object skin
  [13, 'wheel', 0, 0, 0, 0, 0, 0, 'red'],                  // a wheel can't be painted
  [14, 'cockpitAir', 0, 18.2, 0, 0, 0, 15, 0], [15, 'tailconeW', 0, 2.25, 0, 0, 0, 16, 0], [16, 'fuselageW', 0, 13.5, 0, 0, 0, 14, 0], // a three-part loop
  null, 'x', 5, {}, [17, 'gun', NaN, 0], [18, 'gun', 0, Infinity],
];
var rows = mpSpawnRows(forged);`);
console.log(JSON.stringify(R('rows')));
t('every row has 9 fields', R('rows.every((r) => r.length === 9)'));
t('ids are unique positive integers', R('new Set(rows.map((r) => r[0])).size === rows.length && rows.every((r) => Number.isSafeInteger(r[0]) && r[0] > 0)'));
t('types are own PARTS keys (no __proto__/constructor)', R('rows.every((r) => typeof r[1] === "string" && Object.prototype.hasOwnProperty.call(PARTS, r[1]))') && !R('rows.some((r) => ["__proto__", "constructor", "hasOwnProperty"].includes(r[1]))'));
t('duplicate id 10 keeps the first (aam)', R('rows.filter((r) => r[0] === 10).length === 1 && rows.find((r) => r[0] === 10)[1] === "aam"'));
t('x/y finite and clamped to 500', R('rows.every((r) => Number.isFinite(r[2]) && Number.isFinite(r[3]) && Math.abs(r[2]) <= 500 && Math.abs(r[3]) <= 500)') && R('rows.find((r) => r[0] === 11)[2] === 500 && rows.find((r) => r[0] === 11)[3] === -500'));
t('rot&3 and flip 0/1', R('rows.every((r) => r[4] >= 0 && r[4] <= 3 && (r[5] === 0 || r[5] === 1))') && R('rows.find((r) => r[0] === 5)[4] === 3 && rows.find((r) => r[0] === 6)[5] === 1'));
t('z: wing 0, NaN pods default 5.5, 1e9 pods 20, single -1e9 -> -20, twin below min -> min, string -> default', R(`(() => { const z = (id) => rows.find((r) => r[0] === id)[6];
  return z(2) === 0 && z(3) === 5.5 && z(4) === 20 && z(5) === -20 && z(10) === twinMinZ(PARTS.aam) && z(12) === 0 && z(1) === 0; })()`), R('rows.map((r) => r[6])'));
t('z all finite within PART_Z_MAX', R('rows.every((r) => Number.isFinite(r[6]) && Math.abs(r[6]) <= PART_Z_MAX)'));
t('skins: stealth kept, constructor/__proto__/toString/number/object/wheel -> 0', R(`(() => { const s = (id) => rows.find((r) => r[0] === id)[8];
  return s(2) === 'stealth' && s(3) === 0 && s(4) === 0 && s(5) === 'red' && s(6) === 0 && s(11) === 0 && s(12) === 0 && s(13) === 0 && s(10) === 'stealth'; })()`), R('rows.map((r) => r[8])'));
t('att: other ids in the message only; unknown 999 and self link dropped', R(`(() => { const a = (id) => rows.find((r) => r[0] === id)[7]; return a(2) === 1 && a(3) === 2 && a(4) === 2 && a(10) === 0 && a(11) === 0 && a(12) === 0; })()`));
t('att cycles broken (5<->6, 14->15->16->14)', R(`(() => { const by = new Map(rows.map((r) => [r[0], r[7]]));
  for (const [id] of by) { const seen = new Set(); for (let q = id; q; q = by.get(q)) { if (seen.has(q)) return false; seen.add(q); } } return true; })()`));
t('att ids all exist', R('rows.every((r) => r[7] === 0 || rows.some((q) => q[0] === r[7]))'));
t('601 rows rejected (null), 600 accepted', R(`mpSpawnRows(Array.from({ length: 601 }, (_, i) => [i + 1, 'gun', 0, i])) === null && mpSpawnRows(Array.from({ length: 600 }, (_, i) => [i + 1, 'gun', 0, i])).length === 600`));
t('non-arrays rejected', R(`[null, undefined, 'x', 5, {}, { length: 3 }].every((l) => mpSpawnRows(l) === null)`));
let threw = null;
try { R(`for (const l of [[[1]], [[1, 'gun']], [[1, 'gun', 0]], [[1, 'gun', 0, 0, null, null, null, null, null]], [[1, 'gun', 0, 0, {}, [], {}, {}, {}]]]) mpSpawnRows(l);`); } catch (e) { threw = e; }
t('short and junk rows never throw', !threw, threw && String(threw));

// ---- 2. onSpawn + buildGhost on forged input
R(`MP.peers.clear(); MP.onSpawn({ t: 'spawn', f: 7, name: 'x', kind: 'constructor', parts: forged, junk: 'x'.repeat(10) });`);
t('onSpawn stores clean design, kind constructor -> plane', R(`(() => { const d = MP.peers.get(7).design; return Object.keys(d).join() === 'kind,parts' && d.kind === 'plane' && JSON.stringify(d.parts) === JSON.stringify(rows); })()`));
R(`MP.onSpawn({ t: 'spawn', f: 8, kind: ['heli'], parts: [[1, 'cab', 0, 0]] }); MP.onSpawn({ t: 'spawn', f: 9, kind: '__proto__', parts: [] }); MP.onSpawn({ t: 'spawn', f: 10, kind: 'heli', parts: 'nope' });`);
t('array kind -> plane; __proto__ -> plane; bad parts ignored', R(`MP.peers.get(8).design.kind === 'plane' && MP.peers.get(9).design.kind === 'plane' && !MP.peers.has(10)`));
threw = null;
try { R(`MP.buildGhost(7); var g = MP.peers.get(7).ghost;`); } catch (e) { threw = e; }
t('buildGhost works on the forged result', !threw && R('!!g && g.parts.length === rows.length'), threw && String(threw.stack));
t('ghost parts carry z, skin, att, ids', R(`rows.every((r) => { const p = g.parts.find((q) => q.id === r[0]); return p && partZ(p) === Math.abs(r[6]) * (p.def.twinZ ? 1 : Math.sign(r[6]) || 1) && (p.skin || 0) === r[8] && (p.att || 0) === r[7]; })`));
t('ghost geometry finite (reach, mass, com)', R('Number.isFinite(g.reach) && Number.isFinite(g.mass) && Number.isFinite(g.com.x) && Number.isFinite(g.com.y) && Number.isFinite(g.com.z || 0)'), R('[g.reach, g.mass, g.com]'));
t('ghost adjacency includes att links', R('g.adj.get(3).has(2) && g.adj.get(2).has(1)'));

// ---- 3. owner -> ghost round trip of a jumbo with pods at z 9 and a stealth wing
R(`var td = templateRows(TEMPLATES.jumbo).map((q) => ({ ...q })); td.find((q) => q.type === 'fanPods').z = 9; td.find((q) => q.type === 'wingL').skin = 'stealth';
  td.push({ type: 'jet', x: 1.5, y: 11.6, flip: false, rot: 0, z: 3.5, att: td.findIndex((q) => q.type === 'wingL'), skin: 'stealth' }, { type: 'jet', x: 1.5, y: 11.6, flip: false, rot: 0, z: -3.5, att: td.findIndex((q) => q.type === 'wingL'), skin: 'stealth' });
  var own = partsFromDesign(td); var oadj = buildAdjacency(own); var ov = new Vessel(own, oadj, EARTH); ov.kind = 'plane'; ov.name = 'J'; ov.rebuildGroups();
  Flight.active = ov; Flight.running = true; Flight.mp = { solo: false };
  MP.sendSpawn(); var msg = JSON.parse(JSON.stringify(MP.spawnMsg)); msg.f = 3; Flight.running = false;
  MP.onSpawn(msg); MP.buildGhost(3); var gh = MP.peers.get(3).ghost;`);
console.log('spawn row of fanPods:', JSON.stringify(R(`msg.parts.find((r) => r[1] === 'fanPods')`)), ' wing:', JSON.stringify(R(`msg.parts.find((r) => r[1] === 'wingL')`)), ' jets:', JSON.stringify(R(`msg.parts.filter((r) => r[1] === 'jet')`)));
t('spawn rows have 9 fields', R('msg.parts.every((r) => r.length === 9)'));
t('ghost pods at z 9, wing stealth, jets att to wing', R(`partZ(gh.parts.find((p) => p.type === 'fanPods')) === 9 && gh.parts.find((p) => p.type === 'wingL').skin === 'stealth' && gh.parts.filter((p) => p.type === 'jet').every((p) => p.att === gh.parts.find((q) => q.type === 'wingL').id)`));
t('ghost adjacency equals owner adjacency', R(`(() => { const s = (a) => [...a].map(([k, v]) => k + ':' + [...v].sort((x, y) => x - y).join(',')).sort().join(';'); return s(gh.adj) === s(oadj); })()`));
t('ghost com/mass/reach/I/hull equal owner', R(`JSON.stringify([gh.com, gh.mass, gh.reach, gh.I, gh.hull]) === JSON.stringify([ov.com, ov.mass, ov.reach, ov.I, ov.hull])`), R('[gh.mass, ov.mass, gh.reach, ov.reach, JSON.stringify(gh.I), JSON.stringify(ov.I)]'));
// snapshot C carries com.z and the ghost picks it up
R(`ov.com.z = 0.25; ov.x = 1; ov.y = 2; ov.z = 3; ov.vx = ov.vy = ov.vz = 0; ov.q = quat(1, 0, 0, 0); ov.av = v3(0, 0, 0); ov.body = EARTH;
  Net.out = []; Net.hostNow = () => 0; Flight.running = true; Flight.mp = { solo: false }; MP.active = true; MP.state = { players: [] };
  MP.sent = { s: -1e9, pv: 1e12, hp: 1e12, hpSig: '' }; MP.lastParts = ov.parts.length; performance.now = () => 1000;
  Object.defineProperty(MP, 'shared', { get: () => true, configurable: true });
  MP.afterUpdate(); var snap = Net.out.find(([m]) => m.t === 's')[0];`);
t('snapshot C has 3 numbers', R('snap.C.length === 3 && snap.C[2] === 0.25'), R('snap.C'));
R(`var s3 = JSON.parse(JSON.stringify(snap)); s3.f = 3; MP.onSnap(s3); MP.poseGhost(MP.peers.get(3), 0, true);`);
t('ghost com.z from a 3-number snapshot', R('gh.com.z === 0.25'));
R(`var s2 = JSON.parse(JSON.stringify(snap)); s2.f = 3; s2.C = s2.C.slice(0, 2); MP.onSnap(s2); MP.poseGhost(MP.peers.get(3), 0, true);`);
t('2-number snapshot accepted, com.z = 0', R('MP.peers.get(3).snap === s2 && gh.com.z === 0'));
R(`var s4 = JSON.parse(JSON.stringify(snap)); s4.f = 3; s4.C = [0, 0, NaN]; MP.onSnap(s4); var s5 = JSON.parse(JSON.stringify(snap)); s5.f = 3; s5.C = [0, 0, 0, 0]; MP.onSnap(s5);`);
t('NaN or 4-number C rejected', R('MP.peers.get(3).snap === s2'));
// countermeasures: the chaff strength rides in 'cm' (the receiver clamps it: combat.test), the dispenser in spawn rows
R(`Net.out = []; Flight.active = ov; for (const f of [{ chaff: true, str: 2 }, { chaff: true }, { flare: true }]) MP.sendFlares(ov, Object.assign({ x: 1, y: 2, z: 3, vx: 0, vy: 0, vz: 0 }, f));`);
t("'cm' says chaff 2 for a dispenser's bundle, 1 for the cloud with flares, 0 for a flare", R(`JSON.stringify(Net.out.filter(([m]) => m.t === 'cm').map(([m]) => m.chaff)) === '[2,1,0]'`), R(`Net.out.map(([m]) => m.chaff)`));
t('a Chaff Dispenser survives the spawn-row sanitiser', R(`(() => { const r = mpSpawnRows([[1, 'fuselage', 0, 6], [2, 'chaff', -1.2, 5.3]]); return r.length === 2 && r[1][1] === 'chaff'; })()`));
delete N.MP.shared;
// onParts clears att to a host that broke off
R(`MP.onParts({ f: 3, ids: gh.parts.filter((p) => p.type !== 'wingL').map((p) => p.id) });`);
t('onParts: survivors lose att to a lost host', R(`gh.parts.filter((p) => p.type === 'jet').every((p) => p.att === null) && !gh.parts.some((p) => p.type === 'wingL')`));

// ---- 4. measure (the carrier size check): every template through partsFromDesign as before (baseline), and
// z-aware for moved pods
const measured = {};
for (const k of Object.keys(N.TEMPLATES)) measured[k] = R(`MP.measure(partsFromDesign(templateRows(TEMPLATES.${k})))`);
check('mp-measure', measured);
t('measure: legacy template rows (makePart, no att) measure the same as through partsFromDesign', Object.keys(N.TEMPLATES).filter((k) => N.TEMPLATES[k].parts.every((r) => !r[4])).every((k) => // (templates whose rows carry z/att aren't legacy rows)
  JSON.stringify(R(`(() => { const ps = TEMPLATES.${k}.parts.map(([type, x, y, rot]) => makePart(type, x, y, { flip: x < 0, rot: rot || 0 })); return MP.measure(ps); })()`)) === JSON.stringify(measured[k])));
t('measure: jumbo pods at z 9 stay inside the 28 m wing; at z 15 they widen the span to 2*15+w', R(`(() => { const a = MP.measure(partsFromDesign(templateRows(TEMPLATES.jumbo))).span, b = MP.measure(own).span;
  const w = td.map((q) => q.type === 'fanPods' ? { ...q, z: 15 } : q), c = MP.measure(partsFromDesign(w)).span; return a === 28 && b === 28 && c === 2 * 15 + Math.max(PARTS.fanPods.w, 0.6); })()`), R(`[MP.measure(own).span, MP.measure(partsFromDesign(td.map((q) => q.type === 'fanPods' ? { ...q, z: 15 } : q))).span]`));
t('measure: one off-centre jet at z 6 counts its own side only', R(`(() => { const f = makePart('fuselage', 0, 0), j = makePart('jet', 1.5, 0, { z: 6 }); return Math.abs(MP.measure([f, j]).span - (6 + partDepth(j) / 2 + partDepth(f) / 2)) < 1e-9; })()`));

// ---- 5. designProblems part cap, battleDesign
R(`MP.state = null; var many = Array.from({ length: 601 }, () => makePart('gun', 0, 0));`);
t('designProblems flags 601 parts (any mode), not 600', R(`MP.designProblems({ cost: 0 }, many, 'plane').length === 1 && MP.designProblems({ cost: 0 }, many.slice(1), 'plane').length === 0`), R(`MP.designProblems({ cost: 0 }, many, 'plane')`));
R(`MP.state = { mode: 'pvp', settings: { budget: 1e9 }, players: [] }; MP.spawnId = 'faroes'; MP.myDesign = { name: 'J', kind: 'plane', parts: td };`);
t('battleDesign passes a z/att/skin design through unchanged', R('MP.battleDesign() === MP.myDesign'));
R(`MP.state.settings.budget = 20000; UI.toasts = []; var bd = MP.battleDesign();`);
t('battleDesign over budget falls back to a stock template rows', R(`bd.parts.length === TEMPLATES[bd.name.toLowerCase()].parts.length && UI.toasts.length === 1`), R('[bd.name, UI.toasts]'));
R(`MP.state.settings.budget = 1e9; MP.myDesign = { kind: 'plane', parts: Array.from({ length: 601 }, (_, i) => ({ type: 'gun', x: 0, y: i })) }; UI.toasts = []; var bd2 = MP.battleDesign();`);
t('battleDesign with 601 loose-free parts swaps in stock (no ctrl or too many)', R('bd2 !== MP.myDesign'));

// ---- big messages in pieces (net.js wire/unwire): PeerJS's json channel refuses 16300 bytes or more
{
  const vm = require('vm'), fs = require('fs'), path = require('path');
  const C = vm.createContext({ console, performance, setTimeout, clearTimeout, setInterval, clearInterval, addEventListener() {}, document: { hidden: false, addEventListener() {} } });
  vm.runInContext(fs.readFileSync(path.join(G.ROOT, 'js/net.js'), 'utf8') + '\nthis.Net = Net;', C);
  const { wire, unwire } = C.Net._t;
  const sent = [], conn = { send: (m) => sent.push(JSON.parse(JSON.stringify(m))) }; // (as PeerJS's json serializer would)
  const big = { t: 'spawn', rows: Array.from({ length: 700 }, (_, i) => [i, 'fuselageW', i * 0.5, -i, 0, 0, 0.25, i - 1, 'é"\\ü✈']) };
  wire(conn)(big);
  const bytes = sent.map((m) => Buffer.byteLength(JSON.stringify(m)));
  t('a 700-part spawn goes in pieces, each well under 16300 bytes', sent.length > 1 && sent.every((m) => m.t === '~') && Math.max(...bytes) < 16300, `${sent.length} pieces, largest ${Math.max(...bytes)} bytes`);
  const back = unwire();
  let out = null;
  for (const m of [...sent].reverse()) out = back(m) || out; // (any order)
  t('the pieces put back together give the same message', JSON.stringify(out) === JSON.stringify(big));
  sent.length = 0; wire(conn)({ t: 'chat', text: 'hi' });
  t('a small message goes whole', sent.length === 1 && sent[0].t === 'chat');
  const u = unwire(), bad = [
    { t: '~', k: 1, i: 0, n: 1, s: '{}' }, { t: '~', k: 1, i: 0, n: 1e6, s: 'x' }, { t: '~', k: 1, i: -1, n: 2, s: 'x' }, { t: '~', k: 1, i: 0.5, n: 2, s: 'x' },
    { t: '~', k: 1, i: 0, n: 2, s: 'x'.repeat(5000) }, { t: '~', k: 1, i: 0, n: 2, s: 5 }, { t: '~', k: 2, i: 0, n: 2, s: '{"t":' }, { t: '~', k: 2, i: 0, n: 2, s: 'zz' },
  ];
  t('forged pieces are dropped (too many, out of range, too long, not text, repeated)', bad.every((m) => u(m) === null));
  t('a piece set that is not JSON gives nothing', u({ t: '~', k: 2, i: 1, n: 2, s: '}' }) === null);
  // a player must not get a piece past the host to the others: rebuilt by them as part of the host's own stream,
  // it could fake any message from the host (close their room, rewrite the match)
  const inner = JSON.stringify({ t: '~', k: 9, i: 0, n: 2, s: '{"t":"closed","f":1}' }), u2 = unwire();
  u2({ t: '~', k: 3, i: 0, n: 2, s: inner.slice(0, 20) });
  t('pieces that rebuild a piece are dropped, and the host never passes a player\'s piece on', u2({ t: '~', k: 3, i: 1, n: 2, s: inner.slice(20) }) === null && C.Net._t.HOST_ONLY.has('~'));
}

// ---- relays: the ICE servers from NET_TURN_URL (a provider's credentials address), checked, and tried again when it fails
// ---- 6. ground battles (the ground update): settings, kinds, pads, pricing, the zones, deaths, wrecks, respawns, the
// new messages from honest and hostile peers. A host (pid 1, team 0) and players 2 (team 1) and 3 (team 0) on the real map.
async function groundBattle() {
  const Q = G.load({ mp: true, combat: true });
  const X = (code) => G.run(Q, code);
  X(`var __T = 1000, __P = 0, __timers = [], __handlers = new Map(), __ls = new Map(), __ui = [];
    performance.now = () => __P;
    var localStorage = { getItem: (k) => (__ls.has(k) ? __ls.get(k) : null), setItem: (k, v) => __ls.set(k, String(v)) };
    __ls.set('rss.mp.name', JSON.stringify('Hosty'));
    var setTimeout = (fn, ms) => { __timers.push([ms, fn]); return __timers.length; }, clearTimeout = () => {}, setInterval = () => 0, clearInterval = () => {};
    var flush = () => { const due = __timers; __timers = []; for (const [, fn] of due) fn(); };
    var navigator = {}, document = { hidden: false, addEventListener() {} }, isTouch = false;
    Object.assign(Net, { isHost: true, me: 1, code: 'GRND', transport: 'local', pings: new Map(), names: new Map(),
      hostNow: () => __T, host: async () => {}, lock() {}, leave() {}, on: (t, fn) => { if (!__handlers.has(t)) __handlers.set(t, []); __handlers.get(t).push(fn); } });
    var emit = (m) => { for (const fn of __handlers.get(m.t) || []) fn(m); };
    var sent = (t) => (Net.out || []).filter(([m]) => m.t === t);
    var MPUI = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => { __ui.push([k, ...a]); }) });
    var App = { scene: 'mp', afterEarth: (fn) => fn(), showScene(s) { App.scene = s; }, showMP() {}, toBuild() { App.scene = 'build'; }, toHome() {}, use3D: () => true };
    var Career = { data: { mode: 'career', funds: 0, tier: 4, done: {}, flights: 0 }, save() {} };
    UI.closeModal = () => {}; UI.modal = () => {};
    // Flight.start as the game's: the part tree holding the control part, placed at opts.place, the kept vessels kept
    Object.assign(Flight, { running: false, mp: null, vessels: [], time: 50, destroyed: false, spectate: null, starts: [],
      start(design, opts) {
        const parts = partsFromDesign(design.parts), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
        const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
        const v = new Vessel(ps, adj, EARTH); v.name = design.name; v.kind = design.kind; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups();
        const P = opts.place, K = VEHICLE_KINDS[v.kind];
        if (P) v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), K.launchRot, P.z, P.yaw || 0); else v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[K.site].east), K.launchRot);
        Flight.starts.push({ name: design.name, kind: design.kind, key: design.key, place: P, keep: (opts.keep || []).length });
        Flight.vessels = [v, ...(opts.keep || []).filter((o) => o && !o.dead)]; Flight.active = v; Flight.running = true; Flight.mp = opts.mp; Flight.destroyed = false;
      },
      stop() { Flight.running = false; }, summaryHTML: () => '', dist: () => 1e9, absPos: () => ({ b: EARTH, x: 0, y: 0, z: 0 }), camAbs: { b: EARTH, x: 0, y: 0, z: 0 },
      toast() {}, ripParts() {}, breakParts() {} });
    var __design = { name: 'Bird', kind: 'plane', parts: templateRows(TEMPLATES.mustang) }, __loaded = [];
    Object.assign(Builder, { kind: 'plane', mp: null, ctrl: true, parts: [], attached: new Set(), statsData: { cost: 30000 },
      serialize: () => JSON.parse(JSON.stringify(__design)), renderKind() {}, buildPalette() {}, changed() {}, setKind(k) { Builder.kind = k; },
      loadDesign() {}, loadTemplate(k) { __loaded.push(k); __design = { name: TEMPLATES[k].name, kind: TEMPLATES[k].kind, parts: templateRows(TEMPLATES[k]) }; Builder.kind = TEMPLATES[k].kind; },
      designs: () => [], markSaved() {}, renderLaunch() {} });
    // a template as a peer's spawn rows ([id, type, x, y, rot, flip, z, att id, skin, mm])
    // a ghost put on the ground at (e, z), as its first snapshot would
    var poseOn = (g, e, z, yaw = 0) => { g.placeOnSurface(EARTH, siteAngle(EARTH, e), VEHICLE_KINDS.tank.launchRot, z, yaw); g.hiddenUntilSnap = false; };
    var rowsOf = (key, mm) => templateRows(TEMPLATES[key]).map((q, i) => { const r = [i + 1, q.type, q.x, q.y, q.rot, q.flip ? 1 : 0, q.z || 0, q.att != null ? q.att + 1 : 0, q.skin || 0]; if (mm && mm[q.type] != null) r.push(mm[q.type]); return r; });`);

  // -- settings: MP.host(mode, transport, settings), each key as the lobby allows it; forged values refused
  await X(`MP.host('pvp', 'local', { game: 'ground', budget: 120000, tickets: 'lots', format: 'ffa', polish: 5, arena: 'runway', constructor: 1, __proto__: { evil: 1 } })`);
  t('ground: MP.host(mode, transport, { game: "ground", ... }) takes the valid settings, refuses forged ones (tickets "lots", format ffa, polish, arena)',
    X(`(() => { const st = MP.state.settings; return st.game === 'ground' && st.budget === 120000 && st.tickets === 600 && st.format === '1v1' && st.polish === 120 && st.arena === 'highland' && st.respawn === 'free' && st.air === false && st.aim === 'arcade' && !('evil' in st) && Object.getPrototypeOf(st) === Object.prototype; })()`), X('MP.state.settings'));
  X(`var before = JSON.stringify(MP.state.settings); for (const [k, v] of [['budget', 1e9], ['budget', '75000'], ['tickets', 401], ['respawn', 'forever'], ['air', 'yes'], ['air', 1], ['aim', 'aimbot'], ['game', 'naval'], ['format', 'ffa'], ['format', '4v4'], ['constructor', 1], ['__proto__', { x: 1 }], ['test', 1], ['limit', -1], ['tod', 'noon'], ['arena', 'runway'], ['polish', 1]]) MP.setSetting(k, v);`);
  t('ground: setSetting refuses forged values for every key (and keys it has no business with)', X('JSON.stringify(MP.state.settings) === before && !("x" in MP.state.settings)'), X('MP.state.settings'));
  X(`for (const [k, v] of [['tickets', 900], ['respawn', 'lineup'], ['air', true], ['aim', 'realistic'], ['format', '2v2'], ['budget', 75000]]) MP.setSetting(k, v);`);
  t('ground: and takes the lobby\'s own values', X(`(() => { const st = MP.state.settings; return st.tickets === 900 && st.respawn === 'lineup' && st.air === true && st.aim === 'realistic' && st.format === '2v2' && st.budget === 75000; })()`));
  X('var keepState = MP.state');
  await X(`MP.host('pvp', 'local')`);
  const airOk = X(`!('game' in MP.state.settings) && JSON.stringify(Object.keys(MP.state.settings)) === JSON.stringify(Object.keys(MP_DEFAULTS))`);
  await X(`MP.host('sandbox', 'local', { game: 'ground' })`);
  t('ground: an air battle carries none of the ground settings; a sandbox none either', airOk && X(`!('game' in MP.state.settings)`));
  await X(`MP.host('pvp', 'local')`);
  X(`MP.addPlayer(2, 'B'); MP.addPlayer(3, 'C'); MP.setSetting('format', 'ffa'); MP.setSetting('game', 'ground');`);
  t('ground: switching an FFA lobby to Ground makes it 1v1 and deals the teams again', X(`(() => { const s = MP.state, ok = s.settings.game === 'ground' && s.format === '1v1' && s.players.map((p) => p.team).join() === '0,1,0';
    MP.setSetting('game', 'air'); return ok && MP.state.settings.game === 'air'; })()`));
  X('MP.state = keepState');
  // -- kinds, money and limits
  t('ground: kindsFor gives Armour and cars to a ground battle, the air battle its own list', X(`JSON.stringify(MP.kindsFor(MP.state.settings)) === '["tank","car"]' && MP.kindsFor({}) === MP_KINDS_PVP && MP.kindsFor(null) === MP_KINDS_PVP`));
  X(`MP.addPlayer(2, 'Bea'); MP.addPlayer(3, 'Cid'); MP.setSetting('respawn', 'free'); MP.setSetting('test', false); MP.setSetting('format', '1v1'); MP.setSetting('tickets', 600); MP.state.players.find((p) => p.pid === 3).team = 0;
    var ps = (k) => partsFromDesign(templateRows(TEMPLATES[k])), probs = (k, air) => MP.designProblems({ cost: designCost(ps(k)) }, ps(k), TEMPLATES[k].kind, air);`);
  t('ground: a tank and a car fit; a plane or a helicopter only at a respawn with air support on; a rocket never', X(`(() => {
    MP.spawnId = 'pad0'; MP.state.settings.air = true; const a = [probs('tk34').length, probs('technical').length, probs('mustang').length, probs('mustang', true).length, probs('dragonfly', true).length, probs('hopper', true).length];
    MP.state.settings.air = false; a.push(probs('mustang', true).length); return a.join(); })()`) === '0,0,1,0,0,1,1', X(`[probs('mustang'), probs('mustang', true)]`));
  t('ground: a carrier spawn left from an air battle gives no money bonus and no carrier limits', X(`(() => { MP.spawnId = 'carrierA'; const b = MP.budgetFor('carrierA'), L = MP.limitsFor('carrierA'), p = probs('tk34');
    MP.spawnId = 'pad0'; return b === MP.state.settings.budget && L === null && !p.some((x) => /carrier|catapult/i.test(x)); })()`), X(`[MP.budgetFor('carrierA'), MP.limitsFor('carrierA')]`));
  t('ground: each team spawns from its own pad (no airfields, no carriers), and a forged spawn is refused', X(`(() => { const me = MP.me, b = MP.player(2); const a = MP.spawnsFor(me).map((s) => s.id).join(), c = MP.spawnsFor(b).map((s) => s.id).join();
    emit({ t: 'set', f: 2, k: 'spawn', v: 'carrierB' }); return a === 'pad0' && c === 'pad1' && b.spawn !== 'carrierB'; })()`));
  // -- battleDesign: the money tier's stock tank, by key (the air checks above still look theirs up by name)
  t('ground: battleDesign falls back to the money tier\'s stock vehicle, found by its key, never a plane', X(`(() => { const out = [];
    for (const m of [45000, 75000, 120000]) { MP.state.settings.budget = m; MP.myDesign = __design; UI.toasts = []; const bd = MP.battleDesign(); out.push(bd.key, TEMPLATES[bd.key].name === bd.name, bd.kind, bd.parts.length === TEMPLATES[bd.key].parts.length, UI.toasts.length); }
    MP.state.settings.budget = 75000; MP.myDesign = null; return out.join(); })()`) === 'tk34,true,tank,true,1,tk72,true,tank,true,1,ma1,true,tank,true,1');
  t('ground: with no money for any stock tank, the technical', X(`(() => { MP.state.settings.budget = 1; MP.myDesign = __design; const bd = MP.battleDesign(); MP.state.settings.budget = 75000; MP.myDesign = null; return bd.key === GROUND_STOCK.fallback && bd.kind === 'car'; })()`));
  t('ground: a design that fits is flown as it is', X(`(() => { const d = { name: 'Mine', kind: 'tank', parts: templateRows(TEMPLATES.tk34) }; MP.myDesign = d; const ok = MP.battleDesign() === d; MP.myDesign = null; return ok; })()`));

  // -- the match: build (a stock tank on the blueprint), then the battle on Highland Ridge
  X(`Net.out = []; __ui = []; MP.startMatch(); flush();`);
  t('ground: the build phase starts from the money\'s stock tank (the hangar held a plane), the builder takes Armour and cars, no spawn map', X(`__loaded[0] === 'tk72' && JSON.stringify(Builder.mp.kinds) === '["tank","car"]' && !__ui.some(([k]) => k === 'openSpawnMap') && MP.spawnId === 'pad0'`), X('[__loaded, Builder.mp, __ui.map((u) => u[0])]'));
  X(`__T += 200000; MP.tick(); flush();`);
  t('ground: the battle starts with its zones (a duel: zone C alone, 70 m) and the tickets', X(`(() => { const o = MP.state.obj; return MP.phase === 'battle' && o.arena === 'highland' && o.tk.join() === '600,600' && o.zones.length === 1 && o.zones[0].id === 'C' && o.zones[0].r === 70; })()`), X('MP.state.obj'));
  t('ground: we start on the north pad, on the ground, facing south; the battle toast says what to do', X(`(() => { const s = Flight.starts.at(-1), v = Flight.active, q = mpEZ(v.x, v.y, v.z, {});
    return s.kind === 'tank' && Math.hypot(q.e - 17750, q.z - 13800) < 1 && Math.abs(Flight.active.groundAltitude()) < 3 && Flight.active.spawnAt === Flight.time && UI.toasts.includes('Battle! Hold the zones: 600 tickets each'); })()`), X(`[Flight.starts.at(-1), Flight.active.groundAltitude(), UI.toasts]`));
  // a peer's tank, its hull armour dialled up: the host prices it from the rows
  X(`var rows2 = rowsOf('tk34', { hullMedium: 90 }); emit({ t: 'spawn', f: 2, name: 'Bea', kind: 'tank', parts: rows2 });`);
  t('ground: spawn rows carry armour (mm): kept through the sanitiser, on the ghost, and priced in', X(`(() => { const P = MP.peers.get(2), r = P.design.parts.find((q) => q[1] === 'hullMedium'), g = P.ghost, h = g.parts.find((p) => p.type === 'hullMedium');
    const forged = mpSpawnRows([[1, 'hullMedium', 0, 1, 0, 0, 0, 0, 0, 1e9], [2, 'hullMedium', 0, 1, 0, 0, 0, 0, 0, 'x'], [3, 'cab', 0, 1, 0, 0, 0, 0, 0, 50]]);
    return r.length === 10 && r[9] === 90 && h.mm === 90 && forged[0][9] === PARTS.hullMedium.armour.max && forged[1].length === 9 && forged[2].length === 9; })()`), X(`MP.peers.get(2).design.parts[0]`));
  t('ground: the host prices each spawn from its rows, armour and all (never the player\'s word: a set cost is ignored)', X(`(() => { const want = designCost(partsFromDesign(templateRows(TEMPLATES.tk34)).map((p) => (p.type === 'hullMedium' ? Object.assign(p, { mm: 90 }) : p)));
    emit({ t: 'set', f: 2, k: 'cost', v: 1 }); return MP.battleCost.get(2) === want && MP.player(2).cost === want && want > designCost(partsFromDesign(templateRows(TEMPLATES.tk34))); })()`), X('[MP.battleCost.get(2), MP.player(2).cost]'));
  // pv rows: a turret ring rides in them; on the ghost it eases (new parts only), an old turret is written as ever
  X(`__P = 10000; MP.sent.pv = -1e9; MP.sent.s = 1e12; MP.sent.hp = 1e12; Net.out = []; Flight.active.parts.find((p) => p.def.ring).aimYaw = 0.5; MP.afterUpdate();`);
  t('ground: our part states carry the turret ring (its yaw in the aimYaw column)', X(`(() => { const pv = sent('pv')[0][0], ring = Flight.active.parts.find((p) => p.def.ring); const row = pv.list.find((r) => r[0] === ring.id); return !!row && row.length === 12 && row[6] === 0.5; })()`));
  X(`var gh = MP.peers.get(2).ghost, gring = gh.parts.find((p) => p.def.ring); emit({ t: 'pv', f: 2, list: [[gring.id, 0, 0, 0, 0, null, 1, 0, null, 0, 0, 0]] }); var y1 = gring.aimYaw;
    emit({ t: 'pv', f: 2, list: [[gring.id, 0, 0, 0, 0, null, 2, 0.1, null, 0, 0, 0]] }); var y2 = gring.aimYaw; MP.peers.get(2).recv = __P; MP.beforeUpdate(0.1); var y3 = gring.aimYaw;`);
  t('ground: a ghost\'s ring takes its first angle at once, then eases toward the next (not a 5 Hz step)', X(`y1 === 1 && y2 === 1 && Math.abs(y3 - (1 + (1 - Math.exp(-1.2)))) < 1e-9 && gring.aimYawT === 2`), X('[y1, y2, y3]'));
  t('ground: an old turret on a ghost is written straight from the part state, as ever', X(`(() => { const parts = [makePart('fuselage', 0, 0), makePart('turretL', 0.8, 0)]; parts[1].id = 77; const g = new Vessel(parts, buildAdjacency(parts), EARTH); g.kind = 'plane'; g.rebuildGroups();
    MP.peer(9).ghost = g; emit({ t: 'pv', f: 9, list: [[77, 0, 0, 0, 0, null, 1.25, 0.3, null, 0, 0, 1]] }); const p = g.parts[1]; MP.peers.delete(9); return p.aimYaw === 1.25 && p.aimEl === 0.3 && p.aimYawT === undefined && !g._ease; })()`));
  // a shell from a peer: an unknown round is dropped, a real one flies as a copy
  X(`var n0 = Combat.S.shots.length; for (const sh of ['nope', 'constructor', '__proto__', 5]) emit({ t: 'shot', f: 2, k: 'shell', sh, b: 'earth', P: [gh.x, gh.y, gh.z], V: [100, 0, 0], D: [1, 0, 0] }); var n1 = Combat.S.shots.length;
    emit({ t: 'shot', f: 2, k: 'shell', sh: Object.keys(SHELLS)[0], b: 'earth', P: [gh.x, gh.y, gh.z], V: [100, 0, 0], D: [1, 0, 0] }); var n2 = Combat.S.shots.length;`);
  t('ground: a peer\'s shell with an unknown round (sh) is dropped; a real one flies as a copy, and the flash spots it', X(`n1 === n0 && n2 === n0 + 1 && MP.peers.get(2).firedAt === __P`), X('[n0, n1, n2]'));
  // the zone: our tank in C on the ground takes it in 20 s (a neutral zone, alone); then they bleed
  X(`(() => { const v = Flight.active; v.placeOnSurface(EARTH, siteAngle(EARTH, 17750), VEHICLE_KINDS.tank.launchRot, 15000, 0); v.vx = v.vy = v.vz = 0; })();
    var feed0 = MP.state.feed.length; for (let i = 0; i < 21; i++) { __T += 1000; __P += 1000; MP.gdAt = __P; MP.tick(); }`);
  t('ground: our tank in zone C takes it in 20 s; the feed says so; captures score 2 and a sortie point; then they bleed a ticket a second', X(`(() => { const o = MP.state.obj, z = o.zones[0], me = MP.me;
    return z.own === 0 && z.p === -1 && MP.state.feed.some((f) => f.text === 'Faroes took C') && me.caps === 1 && me.score === 2 && me.sorties === 1 && o.tk[1] >= 598 && o.tk[1] < 600 && o.tk[0] === 600; })()`), X(`[MP.state.obj, MP.me]`));
  t('ground: the zones and tickets go out as obj (from the host) between whole states', X(`sent('obj').length > 0 && sent('obj').every(([m]) => mpNums(m.tk, 2) && m.z.length === 1)`));
  X(`MP.gdAt = -1e9; var p0 = MP.state.obj.zones[0].p; MP.state.obj.zones[0].p = -0.5; MP.state.obj.zones[0].own = -1; __T += 1000; __P += 1000; MP.tick(); var p1 = MP.state.obj.zones[0].p;`);
  t('ground: off the ground (no contact for half a second) a vehicle doesn\'t capture', X('p1 === -0.5'), X('p1'));
  X(`MP.state.obj.zones[0].p = -1; MP.state.obj.zones[0].own = 0;`);
  // the peer's tank knocked out by us: tickets by its price, the killer's score, back in 5 s, a wreck on our screen
  X(`var tk1 = MP.state.obj.tk[1], cost2 = MP.battleCost.get(2); MP.peers.get(2).snap = null; Combat.S.kills = 0; UI.toasts = []; poseOn(gh, 17750, 16200);
    emit({ t: 'down', f: 2, by: 1, P: [gh.x, gh.y, gh.z], w: 1, why: 'crew' });`);
  t('ground: a knock-out costs its team 30 + price/2,500 tickets (priced here), scores 3 and a sortie point for the killer, back in 5 s', X(`(() => { const p = MP.player(2), me = MP.me;
    return MP.state.obj.tk[1] === tk1 - (30 + Math.round(cost2 / 2500)) && p.deaths === 1 && p.alive === true && !p.flying && p.respawnAt === __T + 5000 && me.kills === 1 && me.score === 5 && me.sorties === 2; })()`), X(`[tk1, MP.state.obj.tk[1], cost2, MP.player(2)]`));
  t('ground: "knocked out!" for a tank, and its hulk stays as a wreck (still, solid, no longer their ghost)', X(`UI.toasts.includes('Bea knocked out!') && MP.wrecks.length === 1 && MP.wrecks[0].v === gh && gh.wreck && !MP.peers.get(2).ghost && Flight.vessels.includes(gh) && gh.vx === 0`), X('UI.toasts'));
  // their respawn: a new spawn; the wreck stays
  X(`emit({ t: 'spawn', f: 2, name: 'Bea', kind: 'tank', parts: rowsOf('pumo') }); var gh2 = MP.peers.get(2).ghost;`);
  t('ground: their new vehicle is a new ghost; the old one stays a wreck', X(`!!gh2 && gh2 !== gh && MP.wrecks[0].v === gh && Flight.vessels.includes(gh) && MP.battleCost.get(2) === designCost(partsFromDesign(templateRows(TEMPLATES.pumo)))`));
  // we are knocked out: down with w, why; the Respawn panel; our hulk and theirs both survive our respawn
  X(`Net.out = []; __ui = []; Flight.active.ko = { why: 'hull', x: false, t: 1 }; Flight.active.vx = 9; Flight.active.av = v3(0, 0.4, 0); var at1 = [Flight.active.x, Flight.active.y, Flight.active.z];
    Flight.destroyed = true; MP.onLocalDestroyed(); var down = sent('down')[0][0]; flush();`);
  t('ground: knocked out, we tell everyone to keep our hulk (w: 1) and why; the Respawn panel opens', X(`down.w === 1 && down.why === 'parts' && down.x === undefined && __ui.some(([k]) => k === 'respawnPanel')`), X('[down, __ui]'));
  t('ground: our hulk stops dead where it was knocked out, a wreck from then on, as it lies on every other screen (P: where)', X(`(() => { const v = Flight.active; return v.wreck && v.vx === 0 && v.av.y === 0 && down.P.join() === at1.join() && MP.hulk.v === v; })()`), X('[down.P, at1, Flight.active.vx, Flight.active.wreck]'));
  t('ground: no respawn before the host\'s time', X(`!MP.canSpawnNow() && !MP.respawnWith({ name: 'X', kind: 'tank', parts: templateRows(TEMPLATES.tk34) })`));
  X(`__T += 5000; var hulk = Flight.active; MP.respawnWith({ name: 'Second', kind: 'tank', parts: templateRows(TEMPLATES.ms4) });`);
  t('ground: our respawn keeps our own hulk and the other players\' wrecks on the field', X(`Flight.active !== hulk && Flight.active.name === 'Second' && hulk.wreck && Flight.vessels.includes(hulk) && Flight.vessels.includes(gh) && Flight.starts.at(-1).keep === 2 && MP.wrecks.length === 2`), X(`[Flight.starts.at(-1), MP.wrecks.length]`));
  X(`Flight.vessels = Flight.vessels.filter((v) => !v.remote); MP.beforeUpdate(0.016);`);
  t('ground: ...and beforeUpdate puts them back if anything rebuilt the list', X(`Flight.vessels.includes(gh) && Flight.vessels.includes(hulk)`));
  t('ground: our respawn toast, and our new spawn priced', X(`UI.toasts.some((x) => /Back in the fight: Second/.test(x)) && MP.battleCost.get(1) === designCost(partsFromDesign(templateRows(TEMPLATES.ms4)))`), X('UI.toasts'));
  t('ground: an old hulk of ours is never hit by a peer\'s rounds (onHit looks only in our live craft)', X(`(() => { const h = hulk.parts[0], cd = Combat.damage, hit = []; Combat.damage = (v, p, ...a) => { hit.push(p); return cd(v, p, ...a); };
    emit({ t: 'hit', f: 2, to: 1, list: [[h.id, 500], [Flight.active.parts[0].id, 1]], k: 'shot' }); Combat.damage = cd; return hit.length === 1 && hit[0] === Flight.active.parts[0]; })()`));
  // a malformed down (no place) doesn't throw and is still booked
  X(`var d2 = MP.player(2).deaths; MP.player(2).flying = true; emit({ t: 'down', f: 2, by: 1, P: 'junk' }); emit({ t: 'down', f: 2, by: 1, P: [NaN, 0, 0] });`);
  t('ground: a down with a broken place (P) is booked without the blast (it used to throw)', X('MP.player(2).deaths === d2 + 1'));
  // wrecks: at most 8, each for 90 s; a detonation throws the ghost's turret here too
  X(`emit({ t: 'spawn', f: 2, name: 'Bea', kind: 'tank', parts: rowsOf('tk34') }); var gh3 = MP.peers.get(2).ghost, nv = Flight.vessels.length; MP.player(2).flying = true; poseOn(gh3, 17730, 16200); emit({ t: 'down', f: 2, by: 1, P: [gh3.x, gh3.y, gh3.z], w: 1, x: 1, why: 'ammo' });`);
  t('ground: an ammunition detonation (x) throws the wreck\'s turret here too; the pieces aren\'t ours', X(`(() => { const w = MP.wrecks.at(-1); return w.v === gh3 && w.bits && w.bits.length >= 1 && w.bits.every((q) => q.foreign === 2 && Flight.vessels.includes(q)) && !gh3.parts.some((p) => p.type === 'turretCast'); })()`), X(`MP.wrecks.at(-1).bits && MP.wrecks.at(-1).bits.map((q) => q.parts.map((p) => p.type))`));
  // our own ammunition detonation: the turret it threw lies by our hulk and stays through our respawn, the others' too
  X(`Net.out = []; __ui = []; var v6 = Flight.active; v6.ko = null; v6.lastHitBy = null; Armour.knockOut(v6, Flight, 'ammo', { st: Armour.crewOf(v6).stores.find((e) => e.rounds > 0), rounds: 40 });
    Flight.destroyed = true; MP.onLocalDestroyed(); var down6 = sent('down')[0][0], bits6 = (MP.hulk && MP.hulk.bits) || [], bits3 = MP.wrecks.find((w) => w.v === gh3).bits; flush();
    __T += 6000; globalThis.Render3D = { supported: false, failed: false }; var nT6 = UI.toasts.length; // (this client has no WebGL: the 2D view)
    MP.respawnWith({ name: 'Third', kind: 'tank', parts: templateRows(TEMPLATES.ms4) }); var w6 = MP.wrecks.find((w) => w.v === v6), t6 = UI.toasts.slice(nT6), w2d6 = Flight._warn2d;
    Render3D.supported = true; var no3d6 = MP.no3D(); delete globalThis.Render3D;`);
  t('ground: a client with no 3D view is told on spawning that ground battles need it (in place of the flight\'s own warning); with 3D, or no renderer yet, not',
    X(`t6.includes('Ground battles need the 3D view: this device can’t show it') && w2d6 === true && no3d6 === false && !MP.no3D() && !UI.toasts.slice(0, nT6).some((x) => /need the 3D view/.test(x))`), X('[t6, w2d6, no3d6]'));
  t('ground: our ammunition detonation (x): the turret it threw lies by our hulk through our respawn (pieces our hits never look in)', X(`down6.x === 1 && down6.w === 1 && bits6.length >= 1 && bits6.every((q) => q.tossed && q.foreign === Net.me && Flight.vessels.includes(q)) && !!w6 && w6.bits === bits6 && Flight.active.name === 'Third'`), X(`[down6, bits6.length, !!w6, Flight.active.name]`));
  t('ground: ...and the turret another player\'s detonation threw stays too (our respawn keeps every wreck\'s pieces)', X(`bits3.length >= 1 && bits3.every((q) => Flight.vessels.includes(q)) && Flight.starts.at(-1).keep === MP.wrecks.length + bits3.length + bits6.length`), X('[Flight.starts.at(-1), MP.wrecks.length, bits3.length, bits6.length]'));
  X(`Flight.vessels = Flight.vessels.filter((v) => !v.tossed); MP.beforeUpdate(0.016);`);
  t('ground: ...and beforeUpdate puts thrown turrets back if anything rebuilt the list', X(`bits6.concat(bits3).every((q) => Flight.vessels.includes(q))`));
  // a peer's wreck lies where its owner's hulk stopped (P, give or take 20 m); never an aircraft's, nor one in the sky
  X(`var spawn2 = (key, kind, e) => { emit({ t: 'spawn', f: 2, name: 'Bea', kind, parts: rowsOf(key) }); const g = MP.peers.get(2).ghost; MP.player(2).flying = true; poseOn(g, e, 16200); return g; };
    var g7 = spawn2('ms4', 'tank', 17700), a7 = [g7.x + 4, g7.y - 1, g7.z]; emit({ t: 'down', f: 2, by: 0, P: a7, w: 1, why: 'crew' }); var w7 = MP.wrecks.at(-1);
    var g8 = spawn2('ms4', 'tank', 17680), x8 = g8.x; emit({ t: 'down', f: 2, by: 0, P: [g8.x + 40, g8.y, g8.z], w: 1, why: 'crew' }); var w8 = MP.wrecks.at(-1);
    var n9 = MP.wrecks.length, g9 = spawn2('mustang', 'plane', 17660); emit({ t: 'down', f: 2, by: 0, P: [g9.x, g9.y, g9.z], w: 1, why: 'crew' }); var n9b = MP.wrecks.length, gone9 = !MP.peers.get(2).ghost && !Flight.vessels.includes(g9);
    var g10 = spawn2('ms4', 'tank', 17640), r10 = Math.hypot(g10.x, g10.y, g10.z); for (const k of ['x', 'y', 'z']) g10[k] += (g10[k] / r10) * 200;
    emit({ t: 'down', f: 2, by: 0, P: [g10.x, g10.y, g10.z], w: 1, why: 'crew' }); var n10 = MP.wrecks.length, gone10 = !Flight.vessels.includes(g10);`);
  t('ground: a peer\'s wreck lies where its owner says its hulk stopped (P), not where its ghost had got to; a P 40 m off is ignored', X(`w7.v === g7 && g7.x === a7[0] && g7.y === a7[1] && g7.z === a7[2] && w8.v === g8 && g8.x === x8`), X('[[g7.x, g7.y, g7.z], a7, g8.x, x8]'));
  t('ground: a down with w from an aircraft, or from a ground vehicle 200 m up, leaves no wreck in the sky (the ghost goes, as a plane shot down does)', X(`n9b === n9 && gone9 && n10 === n9 && gone10`), X('[n9, n9b, gone9, n10, gone10]'));
  X(`for (let i = 0; i < 8; i++) { const ps = [makePart('hullMedium', 0, 1)]; const w = new Vessel(ps, buildAdjacency(ps), EARTH); w.rebuildGroups(); w.remote = 5; MP.addWreck(w, 5); } var first = MP.wrecks[0].v;`);
  t('ground: at most 8 wrecks (the oldest go first)', X(`MP.wrecks.length === 8 && !MP.wrecks.some((w) => w.v === gh)`));
  X(`__P += 91000; MP.peers.forEach((P) => { P.recv = __P; }); MP.beforeUpdate(0.016);`);
  t('ground: and each for 90 s', X(`MP.wrecks.length === 0 && !Flight.vessels.some((v) => v.wreck && v !== Flight.active)`));
  // onParts on a plated ghost: a lost ring stops turning what is left
  X(`var g4 = MP.peers.get(2).ghost || (emit({ t: 'spawn', f: 2, name: 'Bea', kind: 'tank', parts: rowsOf('tk34') }), MP.peers.get(2).ghost); var r4 = g4.parts.find((p) => p.def.ring), tg0 = g4.tg.length;
    emit({ t: 'parts', f: 2, ids: g4.parts.filter((p) => p !== r4).map((p) => p.id) });`);
  t('ground: a ghost that loses its ring has its turret groups rebuilt (nothing turns on it now)', X(`tg0 > 0 && g4.tg.length === 0 && !g4.parts.includes(r4) && !g4.adj.has(r4.id)`), X('[tg0, g4.tg.length]'));
  // spotting (MP.spotted, for tags and the HUD): near, spotted by the team (3 s; by hand 15 s), a main gun's flash
  X(`var me5 = Flight.active, at = (d) => { const u = { x: me5.x, y: me5.y, z: me5.z }, r = Math.hypot(u.x, u.y, u.z), up = { x: u.x / r, y: u.y / r, z: u.z / r }, s = { x: -up.y, y: up.x, z: 0 }, l = Math.hypot(s.x, s.y) || 1;
      g4.x = u.x + (s.x / l) * d; g4.y = u.y + (s.y / l) * d; g4.z = u.z; }; MP.spots.clear(); MP.peers.get(2).firedAt = 0; var sp = [];
    at(200); sp.push(MP.spotted(2)); at(2000); sp.push(MP.spotted(2));
    MP.spots.set(2, { t: __P, man: false }); sp.push(MP.spotted(2)); __P += 3100; sp.push(MP.spotted(2));
    MP.spots.set(2, { t: __P, man: true }); __P += 14000; sp.push(MP.spotted(2)); __P += 1100; sp.push(MP.spotted(2));
    MP.peers.get(2).firedAt = __P; sp.push(MP.spotted(2)); at(2600); sp.push(MP.spotted(2)); __P += 3100; at(2000); sp.push(MP.spotted(2));
    sp.push(MP.spotted(3), MP.spotted(99));`);
  t('ground: spotted within 250 m; not at 2 km unless the team spotted it (3 s; by hand 15 s) or its main gun fired within 2.5 km in the last 3 s; friends always, nobody unknown', X(`sp.join() === 'true,false,true,false,true,false,true,false,false,true,false'`), X('sp'));
  X(`var thv = (() => { const ps = partsFromDesign(templateRows(TEMPLATES.ma1)), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'tank'; v.rebuildGroups(); v.x = me5.x; v.y = me5.y; v.z = me5.z; return v; })();
    var S0 = Aim.sees, seen = []; Aim.sees = (a, b, o) => { seen.push(!!(o && o.thermal === true)); return true; }; at(600); MP.sees(thv, g4, 600); MP.sees(me5, g4, 600);
    Flight.time += 1; thv.parts.find((p) => p.def.thermal).broken = true; MP.sees(thv, g4, 600); Aim.sees = S0;`);
  t('ground: our own eyes look through smoke with a working thermal sight (MA-1), not without one or with it broken (MP.sees)', X(`seen.join() === 'true,false,false'`), X('seen'));
  // spotting: seen from a player is passed to their teammates only, and only for real enemies
  X(`Net.out = []; MP.spots.clear(); emit({ t: 'seen', f: 3, ids: [2], man: 1 }); var sp1 = MP.spots.get(2); Net.out = []; MP.spots.clear();
    emit({ t: 'seen', f: 3, ids: [1, 3, 99, 'x', 2.5] }); var sp2 = MP.spots.size; var out2 = Net.out.length;`);
  t('ground: a seen from player 3 (team 0) naming enemy 2 reaches 3\'s team (here the host: marked, by hand); naming friends or nobody: nothing', X(`!!sp1 && sp1.man === true && sp2 === 0 && out2 === 0`), X('[sp1, sp2, out2]'));
  X(`__P += 5000; Net.out = []; MP.spots.clear(); for (let i = 0; i < 4; i++) emit({ t: 'seen', f: 2, ids: [3] }); var relayed = sent('spot');`);
  t('ground: a seen naming player 3 from team 1 goes to team 1 only (not back to the sender, not to team 0); at most 2 a second', X(`relayed.length === 0 && MP.spots.size === 0`), X('relayed'));
  X(`MP.addPlayer(4, 'Dot'); MP.player(4).team = 1; __P += 5000; Net.out = []; for (let i = 0; i < 4; i++) emit({ t: 'seen', f: 2, ids: [3], pt: [17000, 15000] }); var relayed2 = sent('spot');`);
  t('ground: ...with a teammate on team 1 it gets two of the four (the rate cap), with the map ping', X(`relayed2.length === 2 && relayed2.every(([m, to]) => to === 4 && m.by === 2 && m.ids.join() === '3' && m.pt.join() === '17000,15000')`), X('relayed2'));
  // obj and spot only from the host
  {
    const C = G.load({ mp: true, earth: false });
    const Y = (code) => G.run(C, code);
    Y(`var Combat = { S: { kills: 0 } }; Net.isHost = false; Net.me = 3; MP.active = true; MP.state = { mode: 'pvp', phase: 'battle', settings: { game: 'ground' }, format: '2v2', players: [{ pid: 1, team: 0 }, { pid: 2, team: 1 }, { pid: 3, team: 0 }],
      obj: { arena: 'highland', tk: [600, 600], zones: [{ id: 'A', own: -1, p: 0 }, { id: 'C', own: -1, p: 0 }] } };`);
    Y(`MP.onObj({ t: 'obj', f: 2, tk: [1, 1], z: [[1, 100], [1, 100]] }); MP.onObj({ t: 'obj', f: 1, tk: [5, NaN], z: [[1, 100], [1, 100]] }); MP.onObj({ t: 'obj', f: 1, tk: [5, 5], z: [[1, 100]] });
      MP.onObj({ t: 'obj', f: 1, tk: [5, 5], z: [[1, 100], 'x'] }); var same = JSON.stringify(MP.state.obj.tk) + MP.state.obj.zones.map((z) => z.own + ':' + z.p).join();
      MP.onObj({ t: 'obj', f: 1, tk: [550.4, 1e9], z: [[1, 250], [7, -40]] }); var o = MP.state.obj;`);
    t('ground: obj from anyone but the host, or broken (NaN, the wrong zone count, junk rows), changes nothing; the host\'s is clamped', Y(`same === '[600,600]-1:0,-1:0' && o.tk.join() === '550,99999' && o.zones[0].own === 1 && o.zones[0].p === 1 && o.zones[1].own === -1 && o.zones[1].p === -0.4`), Y('[same, o]'));
    Y(`MP.onSpot({ t: 'spot', f: 2, ids: [2], by: 1 }); var s1 = MP.spots.size; MP.onSpot({ t: 'spot', f: 1, ids: [2, 1, 'x', 3], by: 1, man: 1, pt: [1, 2] }); var s2 = [...MP.spots.keys()].join(), pg = MP.pings.length;`);
    t('ground: a spot from anyone but the host is ignored; the host\'s marks enemies only, with its map ping', Y(`s1 === 0 && s2 === '2' && pg === 1`), Y('[s1, s2, pg]'));
    const vm = require('vm'), fs = require('fs'), path = require('path');
    const NC = vm.createContext({ console, performance, setTimeout, clearTimeout, setInterval, clearInterval, addEventListener() {}, document: { hidden: false, addEventListener() {} } });
    vm.runInContext(fs.readFileSync(path.join(G.ROOT, 'js/net.js'), 'utf8') + '\nthis.Net = Net; this.V = NET_VERSION;', NC);
    t('ground: obj and spot are host-only (a player\'s are never passed on); NET_VERSION 7', NC.Net._t.HOST_ONLY.has('obj') && NC.Net._t.HOST_ONLY.has('spot') && !NC.Net._t.HOST_ONLY.has('seen') && NC.V === 7);
  }
  // the lineup: a slot only when unused, the respawn time come and tickets left; each spawn uses its slot
  X(`MP.state.settings.respawn = 'lineup'; const p2 = MP.player(2); p2.slots = 1; p2.slot = 0; p2.respawnAt = __T + 5000;
    emit({ t: 'set', f: 2, k: 'slot', v: 1 }); var early = p2.slot; __T += 5000; emit({ t: 'set', f: 2, k: 'slot', v: 0 }); var used = p2.slot;
    for (const v of [3, -1, 1.5, '1', null]) emit({ t: 'set', f: 2, k: 'slot', v }); var junk = p2.slot; emit({ t: 'set', f: 2, k: 'slot', v: 2 }); var ok = p2.slot;
    MP.player(2).flying = false; emit({ t: 'spawn', f: 2, name: 'Bea', kind: 'tank', parts: rowsOf('ms4') }); var bits = p2.slots;`);
  t('ground: lineup slots: refused before the respawn time, used ones and junk refused, a free one taken; the spawn uses it', X(`early === 0 && used === 0 && junk === 0 && ok === 2 && bits === 5`), X('[early, used, junk, ok, bits]'));
  X(`emit({ t: 'set', f: 2, k: 'troops', v: 6 }); var tr1 = MP.player(2).troops; for (const v of [13, -1, 'x', 2.5, null]) emit({ t: 'set', f: 2, k: 'troops', v }); var tr2 = MP.player(2).troops;`);
  t('ground: living troops: 0-12 whole numbers only', X('tr1 === 6 && tr2 === 6'));
  X(`var q2 = MP.player(2), f0 = q2.flying, r0 = q2.ready; emit({ t: 'set', f: 2, k: 'flying', v: !f0 }); emit({ t: 'set', f: 2, k: 'ready', v: !r0 }); var f1 = q2.flying, r1 = q2.ready;
    var h0 = MP.me.flying; MP.setMine('flying', !h0); var h1 = MP.me.flying; MP.setMine('flying', h0);`);
  t('ground: in the battle a client can\'t say whether it is on the field (set flying) or ready: the host knows from spawns and downs (its own row still takes it)', X('f1 === f0 && r1 === r0 && h1 === !h0 && MP.me.flying === h0'), X('[f0, f1, r0, r1, h0, h1]'));
  X(`for (const v of [8, -1, 1.5, '4', null]) emit({ t: 'set', f: 2, k: 'airSlots', v }); var as0 = q2.airSlots || 0; emit({ t: 'set', f: 2, k: 'airSlots', v: 4 }); var as1 = q2.airSlots;
    var sv = { slots: q2.slots, sorties: q2.sorties, alive: q2.alive, flying: q2.flying }, cr = [];
    q2.slots = 3; q2.sorties = 0; cr.push(MP.canRespawn(q2)); q2.sorties = 1; cr.push(MP.canRespawn(q2)); q2.sorties = 0; q2.airSlots = 2; cr.push(MP.canRespawn(q2)); q2.airSlots = 4;
    MP.player(4).alive = true; q2.flying = true; emit({ t: 'down', f: 2, by: 0, P: 'x', why: 'crew' }); var out2 = q2.alive; Object.assign(q2, sv); MP.player(4).alive = false;`);
  t('ground: a lineup\'s aircraft slots (airSlots, 0-7 only): one left with no sortie point is no respawn, so the host counts that player out', X(`as0 === 0 && as1 === 4 && cr.join() === 'false,true,true' && out2 === false`), X('[as0, as1, cr, out2]'));
  t('ground: an aircraft costs 1.5x the tickets', X(`(() => { const o = { tk: [600, 600] }; return GroundMode.death(o, 1, 50000, mpAir('plane')) === Math.round((30 + 20) * 1.5); })()`));
  // the end: out of tickets
  X(`MP.state.obj.tk[1] = 0; __T += 1000; MP.tick(); flush();`);
  t('ground: a team out of tickets loses: results with the tickets and the arena', X(`(() => { const r = MP.state.result; return MP.phase === 'results' && r.ground && r.winner === 0 && r.why === 'tickets' && r.tk[1] === 0 && r.arena === 'highland'; })()`), X('MP.state.result && [MP.state.result.winner, MP.state.result.why, MP.state.result.tk]'));
  X(`MP.backToLobby();`);
  t('ground: back in the lobby the objective and the wrecks are gone', X(`MP.phase === 'lobby' && !('obj' in MP.state) && MP.wrecks.length === 0`));
  // the sandbox: Armour and armed cars on Highland Ridge's pads (the map in, 3D), the sides in turn; others as ever
  await X(`MP.host('sandbox', 'local')`);
  X(`MP.addPlayer(2, 'Bea'); MP.addPlayer(3, 'Cid');`);
  t('ground: the sandbox puts Armour and armed cars on Highland Ridge\'s pads, the sides in turn; unarmed cars and planes where they were', X(`(() => { const out = [], want = [];
    for (const me of [1, 2, 3]) { Net.me = me; const k = me - 1, a = MP.placement(null, 'tank'), b = MP.placement(null, 'car', { parts: templateRows(TEMPLATES.technical) }), c = MP.placement(null, 'car', { parts: templateRows(TEMPLATES.buggy) }), d = MP.placement(null, 'plane');
      const w = GroundMode.placement('highland', k % 2, Math.floor(k / 2), 'tank');
      out.push([a.e, a.z, b.e, b.z, c ? c.e : null, d ? d.e : null].join('/')); want.push([w.e, w.z, w.e, w.z, k ? EARTH.sites.runway.east + k * 220 : null, k ? EARTH.sites.runway.east + k * 220 : null].join('/')); }
    Net.me = 1; return out.join(' ') === want.join(' '); })()`));
  // (an old car's gun, flares or chaff, or smoke alone, arm it with nothing new: it starts on the runway as ever)
  t('ground: the sandbox keeps an old car with a gun, flares or chaff (or only smoke) on the runway', X(`(() => { const out = [];
    for (const me of [1, 2, 3]) { Net.me = me; const k = me - 1, want = k ? EARTH.sites.runway.east + k * 220 : null;
      for (const type of ['gun', 'cannon', 'rocketPods', 'flares', 'chaff', 'turretL', 'smokeL']) { const c = MP.placement(null, 'car', { parts: [...templateRows(TEMPLATES.buggy), { type, x: 0, y: 1.6 }] }); out.push((c ? c.e : null) === want && (!c || c.z === 0)); } }
    Net.me = 1; return out.every(Boolean); })()`));
}

(async () => {
  await groundBattle();
  // ---- the air battle and the sandbox, step by step, exactly as before the ground update (test/lib/mptrace.js:
  // state, messages, toasts, flights and their options, the builder's battle settings, at every step)
  t('an air battle and a sandbox go exactly as before (every state, message, toast and flight: baseline mp-air)', !check('mp-air', await require('./lib/mptrace.js')(G)));
  const vm = require('vm'), fs = require('fs'), path = require('path');
  let answer = null, calls = 0;
  const C = vm.createContext({ console, performance, setTimeout, clearTimeout, setInterval, clearInterval, addEventListener() {}, document: { hidden: false, addEventListener() {} },
    fetch: async () => { calls++; if (!answer) throw new Error('blocked'); return { ok: true, json: async () => answer }; } });
  const src = fs.readFileSync(path.join(G.ROOT, 'js/net.js'), 'utf8').replace("const NET_TURN_URL = '';", "const NET_TURN_URL = 'https://relay.example/creds';");
  vm.runInContext(src + '\nthis.Net = Net;', C);
  const urls = (cfg) => cfg.iceServers.flatMap((x) => [].concat(x.urls));
  const c1 = await C.Net.ice();
  t('relay address unreachable: only the built-in servers, and play goes on', !urls(c1).some((u) => u.includes('relay.example')) && urls(c1).some((u) => u.startsWith('stun:')) && calls === 1, urls(c1).join(' '));
  answer = [{ urls: 'turns:relay.example:443?transport=tcp', username: 'u', credential: 'p' }, { urls: 'javascript:alert(1)' }, { urls: ['turn:relay.example:80'], username: 5 }, 'x', null];
  const c2 = await C.Net.ice(), c3 = await C.Net.ice();
  t('tried again next time; only proper STUN/TURN entries are taken; then kept for the session',
    urls(c2).includes('turns:relay.example:443?transport=tcp') && !urls(c2).some((u) => u.startsWith('javascript')) && urls(c2).length === urls(c1).length + 1 && calls === 2 && urls(c3).length === urls(c2).length, `${calls} fetches: ${urls(c2).join(' ')}`);
  t.done();
})();
