// Multiplayer craft sync: the spawn-row sanitiser on forged input (ids, types, numbers, depth, paint, att links and
// loops, the 600-part cap), onSpawn and buildGhost on what survives, an owner -> ghost round trip of a jumbo with
// moved pods and paint (adjacency, mass, centre of mass, inertia, hull equal), snapshots carrying com.z, the carrier
// size check (measure) against test/baseline/mp-measure.json, the part cap (and the room's part limit off), and battleDesign.
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

// ---- 5b. the part limit as a room setting (settings.cap: on unless the host sets it false)
R(`var big = Array.from({ length: 1500 }, () => makePart('gun', 0, 0)), huge = Array.from({ length: 9000 }, (_, i) => makePart('fuselageW', i * 1.25, i * 2.5, { z: 0.125 }));`);
t('the part limit: 600 with no room, with a room that never set it (an older room’s state), and on; off: MP_NET_PARTS',
  R(`(() => { const a = (MP.state = null, MP.maxParts()), b = (MP.state = { mode: 'sandbox', settings: { budget: 75000 }, players: [] }, MP.maxParts());
    const c = (MP.state.settings.cap = true, MP.maxParts()), d = (MP.state.settings.cap = false, MP.maxParts()); return [a, b, c, d].join() === [600, 600, 600, MP_NET_PARTS].join(); })()`));
R(`MP.state.settings.cap = true; Net.isHost = false; var p601 = MP.designProblems({ cost: 0 }, many, 'plane'); Net.isHost = true; var p601h = MP.designProblems({ cost: 0 }, many, 'plane'); Net.isHost = false;`);
t('...on: 601 parts are too many, and it says who can turn the limit off', R(`p601.length === 1 && /the most is 600 \\(the host can turn the part limit off\\)/.test(p601[0]) && /turn the part limit off in the room’s settings/.test(p601h[0])`), R('[p601, p601h]'));
R(`MP.state = { mode: 'pvp', phase: 'build', settings: { budget: 1e9 }, players: [] }; MP.spawnId = 'faroes'; var pPvp = MP.designProblems({ cost: 0 }, many, 'plane'); MP.state = { mode: 'sandbox', settings: { budget: 75000 }, players: [] };`);
t('...in a battle, past its lobby, no hint (its settings are fixed by then)', R(`pPvp.some((x) => x === 'Too many parts for the shared world: 601, the most is 600.')`), R('pPvp'));
R(`MP.state.settings.cap = false; var pBig = MP.designProblems({ cost: 0 }, big, 'plane'), pHuge = MP.designProblems({ cost: 0 }, huge, 'plane');`);
t('...off: 1,500 parts fly; 9,000 fuselages are too big to send (KB, and about how many would go)', R(`pBig.length === 0 && pHuge.length === 1 && /^Too big to send to the others: \\d+ KB of parts, the most is 244 KB \\(about \\d+ parts of these\\)\\.$/.test(pHuge[0])`), R('[pBig, pHuge]'));
// what passes the check goes: the biggest design of these that passes, sent as startFlight writes it, is under NET_MAX_BYTES
R(`var fit = huge.slice(0, Math.floor(9000 * MP_SPAWN_CHARS / mpSpawnChars(huge))); while (mpSpawnChars(fit) > MP_SPAWN_CHARS) fit.pop(); while (MP.designProblems({ cost: 0 }, fit, 'plane').length) fit.pop();
  var fitMsg = JSON.stringify({ t: 'spawn', name: 'The biggest of them', kind: 'plane', f: 7, parts: fit.map((p) => [p.id, p.type, +p.x.toFixed(3), +p.y.toFixed(3), p.rot || 0, p.flip ? 1 : 0, +partZ(p).toFixed(3), p.att || 0, p.skin || 0]) }).length;`);
t('...the biggest craft that passes, as its spawn message (sender stamped), is under the 256 KB the host passes on', R(`fit.length > 4000 && fitMsg < 256 * 1024 && Math.abs(fitMsg - mpSpawnChars(fit)) < 200`), R('[fit.length, fitMsg, mpSpawnChars(fit)]'));
// a peer's spawn past 600 parts: taken with the limit off, ignored with it on
R(`var rows1500 = Array.from({ length: 1500 }, (_, i) => [i + 1, 'gun', 0, i]); MP.peers.clear();
  MP.state.settings.cap = true; MP.onSpawn({ t: 'spawn', f: 2, kind: 'plane', parts: rows1500 }); var on1500 = MP.peers.get(2) ? MP.peers.get(2).design : null;
  MP.state.settings.cap = false; MP.onSpawn({ t: 'spawn', f: 2, kind: 'plane', parts: rows1500 }); var off1500 = MP.peers.get(2).design;
  var forged = mpSpawnRows(Array.from({ length: MP_NET_PARTS + 1 }, (_, i) => [i + 1, 'gun', 0, i]), MP.maxParts());`);
t('...a peer’s 1,500-part spawn: ignored with the limit on, its craft with it off; a list past MP_NET_PARTS still refused', R(`!on1500 && off1500 && off1500.parts.length === 1500 && forged === null`));
// the host sets it: in a sandbox at any time, in a battle only in its lobby
R(`var pushes = 0, push0 = MP.push; MP.push = () => { pushes++; }; Net.isHost = true;
  MP.state = { mode: 'sandbox', phase: 'free', settings: { budget: 75000 }, players: [] };
  MP.setSetting('cap', false); var sb = MP.state.settings.cap; MP.setSetting('budget', 45000); var sbBudget = MP.state.settings.budget; MP.setSetting('cap', 'no'); var sbJunk = MP.state.settings.cap;
  MP.state = { mode: 'pvp', phase: 'battle', settings: { budget: 75000 }, players: [] }; MP.setSetting('cap', false); var pvpBattle = MP.state.settings.cap;
  MP.state.phase = 'lobby'; MP.setSetting('cap', false); var pvpLobby = MP.state.settings.cap;
  Net.isHost = false; MP.state.settings.cap = true; MP.setSetting('cap', false); var notHost = MP.state.settings.cap;
  MP.push = push0; MP.state = null;`);
t('...the host sets it in a sandbox at any time (nothing else there), in a battle only in its lobby; junk values and other players refused',
  R(`sb === false && sbBudget === 75000 && sbJunk === false && pvpBattle === undefined && pvpLobby === false && notHost === true && pushes === 2`), R('[sb, sbBudget, sbJunk, pvpBattle, pvpLobby, notHost, pushes]'));

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
// a room's stand-ins (mp.js with combat.js, death.js and the ground update's systems, on the real map): the host pid 1,
// a timer queue (flush), Net's messages (sent), Flight.start as the game's (the part tree holding the control part,
// placed at opts.place, the kept vessels kept)
const ROOM = `var __T = 1000, __P = 0, __timers = [], __handlers = new Map(), __ls = new Map(), __ui = [];
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
    var rowsOf = (key, mm) => templateRows(TEMPLATES[key]).map((q, i) => { const r = [i + 1, q.type, q.x, q.y, q.rot, q.flip ? 1 : 0, q.z || 0, q.att != null ? q.att + 1 : 0, q.skin || 0]; if (mm && mm[q.type] != null) r.push(mm[q.type]); return r; });`;
// ---- 6. ground battles (the ground update): settings, kinds, pads, pricing, the zones, deaths, wrecks, respawns, the
// new messages from honest and hostile peers. A host (pid 1, team 0) and players 2 (team 1) and 3 (team 0) on the real map.
async function groundBattle() {
  const Q = G.load({ mp: true, combat: true });
  const X = (code) => G.run(Q, code);
  X(ROOM);

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
  // (P4 play-test) air support's list: what each aircraft carries said, the armed ones first (it began with an unarmed trainer)
  X(`MP.state.settings.air = true; MP.stockMemo = null; var airC = MP.choices(true); MP.state.settings.air = false; MP.stockMemo = null;`);
  t('ground: the aircraft at a respawn list what each carries (guns, rockets, missiles, bombs), every armed one before any unarmed one',
    X(`(() => { const first = airC.findIndex((c) => !c.arms), last = airC.map((c) => !!c.arms).lastIndexOf(true);
      return airC.length > 4 && airC.every((c) => typeof c.arms === 'string') && !!airC[0].arms && (first < 0 || last < first) && airC.some((c) => /guns/.test(c.arms)); })()`),
    X(`airC.map((c) => c.name + ': ' + (c.arms || 'unarmed')).join('; ')`));
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
  // wrecks: at most 8 standing, each for five minutes (the big update), the last 6 s sinking; a detonation throws the
  // ghost's turret here too
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
  // (re-pinned by the big update: wrecks stay five minutes, not 90 s, and leave by sinking; the cap starts a sink)
  X(`var old8 = MP.wrecks.slice(), n8 = old8.length; for (let i = 0; i < 8; i++) { const ps = [makePart('hullMedium', 0, 1)]; const w = new Vessel(ps, buildAdjacency(ps), EARTH); w.rebuildGroups(); w.remote = 5; MP.addWreck(w, 5); }
    var up8 = () => MP.wrecks.filter((w) => MP.sinkStart(w) > __P), new8 = MP.wrecks.slice(n8);
    MP.peers.forEach((P) => { P.recv = __P; }); MP.beforeUpdate(0.016); var s0 = old8.map((w) => w.v.sink || 0);
    __P += 3000; MP.peers.forEach((P) => { P.recv = __P; }); MP.beforeUpdate(0.016); var s3 = old8.map((w) => w.v.sink), in3 = old8.every((w) => MP.wrecks.includes(w) && Flight.vessels.includes(w.v) && w.v.wreck);
    __P += 3100; MP.peers.forEach((P) => { P.recv = __P; }); MP.beforeUpdate(0.016); var gone6 = old8.every((w) => !MP.wrecks.includes(w) && !Flight.vessels.includes(w.v)) && MP.wrecks.length === 8;`);
  t('ground: at most 8 wrecks standing: the newest 8 stand, every older one starts sinking at once (the oldest first), still there and solid as it goes down',
    X(`n8 >= 1 && old8.some((w) => w.v === gh) && up8().length === 8 && new8.every((w) => up8().includes(w)) && s0.every((k) => k === 0) && s3.every((k) => k > 0.45 && k < 0.55) && in3`), X('[n8, up8().length, s0, s3, in3]'));
  t('ground: ...and gone 6 s later, the 8 standing kept', X('gone6'));
  X(`__P += 293000; MP.peers.forEach((P) => { P.recv = __P; }); MP.beforeUpdate(0.016); var at299 = MP.wrecks.length, k299 = MP.wrecks.map((w) => w.v.sink).join();
    __P += 8000; MP.peers.forEach((P) => { P.recv = __P; }); MP.beforeUpdate(0.016);`);
  t('ground: and each for five minutes, the last 6 s sinking (then gone: a clock past its end drops it at once)', X(`at299 === 8 && MP.wrecks.length === 0 && !Flight.vessels.some((v) => v.wreck && v !== Flight.active)`), X('[at299, k299, MP.wrecks.length]'));
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
    t('ground: obj, spot, fallen and wrecks are host-only (a player\'s are never passed on), crush is anyone\'s; NET_VERSION 13 (7: the ground update; 8: the props; 9: every shot and craft meets them, and what falls is shared; 10: the part limit a room setting; 11: the big update: aircraft shot apart and falling, wrecks on every screen, radar parts, rdr and mp.a, drones beside their tanks: c, tc, extras; 12: the spawn points update: no causeway, levelled pads and props at the spawn points; 13: the drones' second balance and lock-on)', NC.Net._t.HOST_ONLY.has('obj') && NC.Net._t.HOST_ONLY.has('spot') && NC.Net._t.HOST_ONLY.has('fallen') && NC.Net._t.HOST_ONLY.has('wrecks') && !NC.Net._t.HOST_ONLY.has('crush') && !NC.Net._t.HOST_ONLY.has('seen') && !NC.Net._t.HOST_ONLY.has('rdr') && NC.V === 13);
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
  // the sandbox: Armour and armed cars at the tank yard on the space centre's island (the map in, 3D), side by side;
  // others as ever
  await X(`MP.host('sandbox', 'local')`);
  X(`MP.addPlayer(2, 'Bea'); MP.addPlayer(3, 'Cid');`);
  t('ground: the sandbox puts Armour and armed cars side by side at the tank yard, facing east; unarmed cars and planes where they were', X(`(() => { const out = [], want = [];
    for (const me of [1, 2, 3]) { Net.me = me; const k = me - 1, a = MP.placement(null, 'tank'), b = MP.placement(null, 'car', { parts: templateRows(TEMPLATES.technical) }), c = MP.placement(null, 'car', { parts: templateRows(TEMPLATES.buggy) }), d = MP.placement(null, 'plane');
      const w = Props.yardPlace(k), Y = EARTH.groundPads.yard; if (a.yaw !== 0 || Math.abs(a.e - Y.e) > Y.hl || Math.abs(a.z - Y.z) > Y.hw) return false;
      out.push([a.e, a.z, b.e, b.z, c ? c.e : null, d ? d.e : null].join('/')); want.push([w.e, w.z, w.e, w.z, k ? EARTH.sites.runway.east + k * 220 : null, k ? EARTH.sites.runway.east + k * 220 : null].join('/')); }
    Net.me = 1; return out.join(' ') === want.join(' '); })()`));
  // (an old car's gun, flares or chaff, or smoke alone, arm it with nothing new: it starts on the runway as ever)
  t('ground: the sandbox keeps an old car with a gun, flares or chaff (or only smoke) on the runway', X(`(() => { const out = [];
    for (const me of [1, 2, 3]) { Net.me = me; const k = me - 1, want = k ? EARTH.sites.runway.east + k * 220 : null;
      for (const type of ['gun', 'cannon', 'rocketPods', 'flares', 'chaff', 'turretL', 'smokeL']) { const c = MP.placement(null, 'car', { parts: [...templateRows(TEMPLATES.buggy), { type, x: 0, y: 1.6 }] }); out.push((c ? c.e : null) === want && (!c || c.z === 0)); } }
    Net.me = 1; return out.every(Boolean); })()`));
}

// ---- 7. deaths in a room (the big update, spec-damage §5): wrecks in a sandbox too, a spawn on top of one sinks it;
// an aircraft shot down falls on every screen (down.fall: a hulk of our own physics, no longer the peer's ghost), its
// pieces fall (onParts), half a wing goes (pv's 13th column), fires show (hp's 3rd column), a hit's wing side, and the
// kill goes to whoever crippled it however long it fell. A host (pid 1) and peers 2 and 3, on the real map.
async function roomDeaths() {
  const Q = G.load({ mp: true, combat: true });
  const X = (code) => G.run(Q, code);
  X(ROOM);
  X(`Flight.onDestroyed = function () { if (this.destroyed) return; this.destroyed = true; if (this.mp) MP.onLocalDestroyed(); };
    Flight.dist = () => 500; // (the camera near enough for falling pieces: 3 km)
    var up = (v, h) => { const r = Math.hypot(v.x, v.y, v.z); v.x += (v.x / r) * h; v.y += (v.y / r) * h; v.z += (v.z / r) * h; };
    var craftOf = (key, kind, e, h) => { const ps = partsFromDesign(templateRows(TEMPLATES[key])), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = kind; v.name = key; v.rebuildGroups();
      v.placeOnSurface(EARTH, siteAngle(EARTH, e), VEHICLE_KINDS[kind].launchRot); if (h) { up(v, h); v.landed = false; } return v; };
    var centre = (v) => v.toWorld(v.com.x, v.com.y, v.com.z || 0);
    var snapOf = (v, f) => ({ t: 's', f, th: __T, b: v.body.id, P: [v.x, v.y, v.z], V: [v.vx, v.vy, v.vz], Q: [v.q.w, v.q.x, v.q.y, v.q.z], W: [v.av.x, v.av.y, v.av.z], C: [v.com.x, v.com.y, v.com.z || 0], g: 0, l: 0 });
    // a peer's craft (template key) as their spawn and a first snapshot put it: twin, where it is (e along the runway, h up)
    var ghostOf = (f, key, kind, e, h, vel, spin) => { emit({ t: 'spawn', f, name: 'P' + f, kind, parts: rowsOf(key) }); const tw = craftOf(key, kind, e, h);
      if (vel) { tw.vx = vel[0]; tw.vy = vel[1]; tw.vz = vel[2]; } if (spin) tw.av = v3(...spin);
      MP.player(f) && (MP.player(f).flying = true); emit(snapOf(tw, f)); MP.peers.get(f).recv = __P; MP.beforeUpdate(0.016); return MP.peers.get(f).ghost; };
    // our own craft, flying (no Flight.start: placed as given)
    var fly = (v) => { Flight.active = v; Flight.vessels = [v, ...Flight.vessels.filter((o) => o.remote)]; Flight.running = true; Flight.destroyed = false; Flight.spectate = null;
      MP.sent = { s: 1e12, pv: 1e12, hp: 1e12, hpSig: '' }; MP.lastParts = v.parts.length; return v; };
    var RW = EARTH.sites.runway.east, __af = [];`);

  // -- a sandbox: wrecks stay here too
  await X(`MP.host('sandbox', 'local')`);
  X(`MP.addPlayer(2, 'Bea'); MP.addPlayer(3, 'Cid'); __design = { name: 'Buggy', kind: 'car', parts: templateRows(TEMPLATES.buggy) }; MP.startFlight(false);
    var tk = ghostOf(2, 'tk34', 'tank', RW + 300, 0); Combat.S.kills = 0; UI.toasts = []; emit({ t: 'down', f: 2, by: 1, P: (({ x, y, z }) => [x, y, z])(centre(tk)), w: 1, why: 'crew' });
    var bg = ghostOf(3, 'buggy', 'car', RW + 360, 0); emit({ t: 'down', f: 3, by: 0, P: (({ x, y, z }) => [x, y, z])(centre(bg)), w: 1, why: 'crew' });`);
  t('rooms: in a sandbox a peer\'s knocked-out TK-34 stays as a wreck here (it used to vanish), burning as any wreck (ko); "knocked out!" for us',
    X(`MP.wrecks.length === 2 && MP.wrecks[0].v === tk && tk.wreck && !MP.peers.get(2).ghost && Flight.vessels.includes(tk) && tk.ko && tk.ko.why === 'crew' && tk.ko.x === false && UI.toasts.includes('Bea knocked out!') && Combat.S.kills === 1`), X('[MP.wrecks.length, tk.ko, UI.toasts]'));
  t('rooms: ...and so does an old car (the buggy) whose driver was knocked out', X(`MP.wrecks[1].v === bg && bg.wreck && bg.ko.why === 'crew' && Flight.vessels.includes(bg)`));
  X(`var me1 = Flight.active; me1.placeOnSurface(EARTH, siteAngle(EARTH, RW + 50), VEHICLE_KINDS.car.launchRot); me1.vx = 6; Net.out = [];
    Death.groundKO(me1, Flight, 'crew'); var dn1 = sent('down')[0] && sent('down')[0][0]; flush();`);
  t('rooms: our buggy\'s driver knocked out in a sandbox: we tell everyone to keep the hulk (w: 1, why) and it stops dead where it is',
    X(`!!dn1 && dn1.w === 1 && dn1.why === 'crew' && dn1.x === undefined && dn1.fall === undefined && me1.wreck && me1.vx === 0 && MP.hulk && MP.hulk.v === me1`), X('dn1'));
  X(`MP.respawn(); var me2 = Flight.active, w1 = MP.wrecks.find((w) => w.v === me1);`);
  t('rooms: our sandbox respawn keeps our wreck (and the others\') on the field, standing',
    X(`me2 !== me1 && !!w1 && Flight.vessels.includes(me1) && Flight.vessels.includes(tk) && Flight.vessels.includes(bg) && Flight.starts.at(-1).keep === 3 && MP.wrecks.every((w) => MP.sinkStart(w) > __P)`), X('[Flight.starts.at(-1), MP.wrecks.length]'));
  // two wrecks of a peer's, 11.9 m and 13 m from where our next craft's centre will be (a respawn: the same start)
  X(`var wAt = (P, d) => { const ps = [makePart('hullMedium', 0, 1)], w = new Vessel(ps, buildAdjacency(ps), EARTH); w.kind = 'tank'; w.rebuildGroups();
      const e = { x: -P.y, y: P.x, z: 0 }, l = Math.hypot(e.x, e.y) || 1, c = centre(w);
      w.x += P.x + (e.x / l) * d - c.x; w.y += P.y + (e.y / l) * d - c.y; w.z += P.z - c.z; w.remote = 3; MP.addWreck(w, 3); return MP.wrecks.at(-1); };
    var c2 = centre(me2), near12 = wAt(c2, 11.9), far13 = wAt(c2, 13); __P += 100; MP.respawn(); var c3 = centre(Flight.active);`);
  t('rooms: a spawn on top of a wreck starts it sinking now (11.9 m off); one 13 m off stands', X(`near12.sinkAt === __P && far13.sinkAt == null && MP.sinkStart(far13) > __P && Math.hypot(c3.x - c2.x, c3.y - c2.y, c3.z - c2.z) < 0.01`),
    X('[near12.sinkAt, far13.sinkAt, Math.hypot(c3.x - c2.x, c3.y - c2.y, c3.z - c2.z)]'));
  // a peer spawns on top of a wreck: on our screen it starts sinking at their craft's first snapshot; their ghost
  // rebuilt later (our own respawn drops every ghost) sinks nothing
  X(`var at3 = centre(craftOf('buggy', 'car', RW + 600, 0)), n3 = wAt(at3, 4), f3 = wAt(at3, 20); __P += 100; var g3 = ghostOf(3, 'buggy', 'car', RW + 600, 0);
    var n4 = wAt(at3, 3); __P += 100; MP.dropAllGhosts(); MP.peers.get(3).recv = __P; MP.beforeUpdate(0.016); var g3b = MP.peers.get(3).ghost;`);
  t('rooms: a peer\'s new craft on top of a wreck: it starts sinking at the craft\'s first snapshot here too (as on its owner\'s screen); 20 m off it stands; the ghost rebuilt later sinks nothing',
    X(`!!g3 && !g3.hiddenUntilSnap && n3.sinkAt === __P - 100 && f3.sinkAt == null && !!g3b && g3b !== g3 && !g3b.hiddenUntilSnap && n4.sinkAt == null`), X('[!!g3, n3.sinkAt, f3.sinkAt, !!g3b, n4.sinkAt, __P]'));

  // -- an air battle (players 2, 3 and 4 the other team): an aircraft shot down in the air falls here too
  await X(`MP.host('pvp', 'local')`);
  X(`for (const [pid, n] of [[2, 'Bea'], [3, 'Cid'], [4, 'Dot']]) { MP.addPlayer(pid, n); MP.player(pid).team = 1; } MP.player(1).team = 0; MP.state.phase = 'battle'; MP.finishing = true; __timers = []; // (no last team standing: the battle goes on)
    Flight.mp = { mode: 'pvp', solo: false, phase: 'battle' }; Flight.vessels = []; fly(craftOf('falcon', 'plane', RW, 2000));
    var fxd = [], fd0 = FX.death; FX.death = (b, at, vel, size, kind) => { fxd.push(kind); };
    var fg = ghostOf(2, 'falcon', 'plane', RW + 800, 500, [120, 0, 0], [0.1, 0.2, 0]), fc = centre(fg); Flight.spectate = fg; UI.toasts = []; Combat.S.kills = 0; Death.fb.text = '';
    emit({ t: 'down', f: 2, by: 1, P: [fc.x, fc.y, fc.z], fall: [0, -50, 120] });`);
  t('rooms: an aircraft shot down in the air (down.fall) falls here as a hulk of our own physics: no longer their ghost (not in ghosts or enemyGhosts), not remote, foreign 2, pilot out, engines dead, moving as its owner said',
    X(`!MP.ghosts().includes(fg) && !MP.enemyGhosts().includes(fg) && !fg.remote && fg.foreign === 2 && fg.control === null && fg.down && fg.isDebris && fg.hulk != null && !fg.dead && Flight.vessels.includes(fg)
      && fg.vx === 0 && fg.vy === -50 && fg.vz === 120 && !MP.peers.get(2).ghost && fg.parts.every((p) => !p.def.thrust || (!p.active && !p.firing))`), X('[fg.remote, fg.foreign, !!fg.control, fg.vx, fg.vy, fg.vz]'));
  t('rooms: ...where its owner said (P), no mid-air fireball, still watched if we watched it; "shot down!" and the SHOT DOWN banner for the shooter',
    X(`(() => { const c = centre(fg); return Math.hypot(c.x - fc.x, c.y - fc.y, c.z - fc.z) < 1e-6 && !fxd.length && Flight.spectate === fg && UI.toasts.includes('Bea shot down!') && Combat.S.kills === 1 && Death.fb.text === 'SHOT DOWN'; })()`), X('[UI.toasts, Death.fb.text, fxd]'));
  X(`var cd = Combat.damage, onFg = 0; Combat.damage = function (v, p, ...a) { if (v === fg) onFg++; return cd.call(this, v, p, ...a); };
    emit({ t: 'hit', f: 2, to: 1, list: fg.parts.filter((p) => !Flight.active.parts.some((q) => q.id === p.id)).slice(0, 6).map((p) => [p.id, 500]), k: 'shot' }); Combat.damage = cd;
    Net.out = []; MP.sendHits(fg, [[fg.parts[0], 50]], 'shot'); MP.sendHit(fg, fg.parts[1], 50, 'shot'); var outFg = sent('hit').length;`);
  t('rooms: ...a hit message naming its parts lands nowhere, and our hits on it send nothing (it is no one\'s to hurt: a picture)', X(`onFg === 0 && outFg === 0 && fg.parts.every((p) => p.hp == null)`), X('[onFg, outFg]'));
  // it falls (our physics, with the real crash hook) and crashes once: one fireball and a crash site, and nobody hurt
  X(`var fs = { time: 0, target: null, toasts: [], broken: [], vessels: Flight.vessels, camAbs: { x: 0, y: 0, z: 0 }, active: Flight.active, toast() {},
      ripParts(v, ps) { for (const p of ps) { for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.get(p.id).clear(); } v.splitComponents(); v.rebuildGroups(); },
      breakParts(v, parts, cause) { if (cause === 'impact') { parts = Death.impact(v, parts, this); if (!parts || !parts.length) return; } this.broken.push(parts.length); v.parts = v.parts.filter((q) => !parts.includes(q)); if (!v.parts.length) v.dead = true; } };
    var hp0 = JSON.stringify(Flight.active.parts.map((p) => p.hp)), py0 = Death.S.pyres.length, fT = 0;
    for (let i = 0; i < 120 * 90 && !fg.dead; i++) { fg.physicsStep(1 / 120, fs); fs.time += 1 / 120; fT = fs.time; }`);
  t('rooms: ...it falls under our physics and crashes once where it hits: one fireball, one crash site, nothing hurt, nothing broken part by part',
    X(`fg.dead && fxd.join() === 'crash' && Death.S.pyres.length === py0 + 1 && !fs.broken.length && JSON.stringify(Flight.active.parts.map((p) => p.hp)) === hp0 && !Flight.destroyed`), X('[fg.dead, fT, fxd, Death.S.pyres.length - py0, fs.broken]'));
  X(`__ui = []; __timers = []; Flight.destroyed = true; MP.beforeUpdate(0.016); var nT = __timers.length; flush(); var spec = __ui.some(([k]) => k === 'spectate'); Flight.destroyed = false;`);
  t('rooms: ...and the spectator moves on to the next player 1.5 s after it crashed', X(`nT === 1 && spec && Flight.spectate === null`), X('[nT, spec]'));
  // forged or useless falls: the ghost goes, as a plane shot down always did
  X(`var gone = []; for (const f of ['1', [NaN, 0, 0], [1e6, 0, 0], undefined]) { const g = ghostOf(3, 'falcon', 'plane', RW + 900, 500), c = centre(g); emit({ t: 'down', f: 3, by: 0, P: [c.x, c.y, c.z], fall: f }); gone.push(g.dead && !g.foreign && !Flight.vessels.includes(g) && !MP.peers.get(3).ghost); }
    emit({ t: 'spawn', f: 4, name: 'Dot', kind: 'plane', parts: rowsOf('falcon') }); var hid = MP.peers.get(4).ghost; emit({ t: 'down', f: 4, by: 0, P: [1, 2, 3], fall: [0, -50, 120] }); gone.push(hid.hiddenUntilSnap && hid.dead && !hid.foreign);`);
  t('rooms: a down without fall, or with a forged one (\'1\', NaN, 1e6 m/s), or on a ghost never seen: the ghost goes (no hulk falls)', X(`gone.join() === 'true,true,true,true,true'`), X('gone'));
  // a crippled aircraft that crashed (a down with no fall, on the ground): the fireball and the crash site its owner saw
  X(`fxd.length = 0; var py1 = Death.S.pyres.length, lg = ghostOf(3, 'falcon', 'plane', RW + 1000, 6), lc = centre(lg); emit({ t: 'down', f: 3, by: 0, P: [lc.x, lc.y, lc.z] });`);
  t('rooms: a peer\'s aircraft that crashed (down, no fall, near the ground): a crash fireball and a crash site here too, then the ghost goes', X(`fxd.join() === 'crash' && Death.S.pyres.length === py1 + 1 && lg.dead`), X('[fxd, Death.S.pyres.length - py1]'));
  // what comes off a peer's craft falls (onParts): in pieces of our physics, at most 6, each where it was, moving as the craft moved there
  X(`var cg = ghostOf(2, 'falcon', 'plane', RW + 1200, 800, [150, 0, 0], [0.2, 0.1, 0.3]), ctl = cg.parts.find((p) => p.def.control), gone14 = cg.parts.filter((p) => p !== ctl).slice(-14);
    var v0 = new Set(Flight.vessels); emit({ t: 'parts', f: 2, ids: cg.parts.filter((p) => !gone14.includes(p)).map((p) => p.id) }); var pcs = Flight.vessels.filter((v) => !v0.has(v));
    var placed = pcs.every((v) => { const rel = qrot(cg.q, v.com.x - cg.com.x, v.com.y - cg.com.y, (v.com.z || 0) - (cg.com.z || 0)), pv = cg.pointVel(rel);
      return v.x === cg.x + rel.x && v.y === cg.y + rel.y && v.z === cg.z + rel.z && v.vx === pv.x && v.vy === pv.y && v.vz === pv.z && v.q.w === cg.q.w && v.av.x === cg.av.x; });`);
  t('rooms: 14 parts shot off a peer\'s plane fall here as at most 6 pieces of ours (foreign, hulks, debris), each where it was and moving as the plane moved there; the ghost lets them go',
    X(`pcs.length >= 1 && pcs.length <= 6 && placed && pcs.every((v) => v.foreign === 2 && !v.remote && v.hulk != null && v.isDebris && v.kind === 'plane') && gone14.every((p) => !cg.parts.includes(p)) && pcs.every((v) => v.parts.every((p) => gone14.includes(p)))`),
    X('[pcs.length, placed, pcs.map((v) => v.parts.length)]'));
  X(`Flight.dist = () => 5000; var cg2 = ghostOf(3, 'falcon', 'plane', RW + 1300, 800), v1 = new Set(Flight.vessels); emit({ t: 'parts', f: 3, ids: cg2.parts.slice(0, 10).map((p) => p.id) }); var far = Flight.vessels.filter((v) => !v1.has(v)).length; Flight.dist = () => 500;`);
  t('rooms: ...none when the camera is 5 km off (the parts just go)', X(`far === 0 && cg2.parts.length === 10`));
  // half a wing (pv's 13th column) and fires (hp's 3rd column) on a peer's plane
  X(`var wg = ghostOf(4, 'falcon', 'plane', RW + 1400, 700), ww = wg.mainWing, gun = wg.parts.find((p) => p.def.weapon && p.def.weapon.kind === 'gun'), row = (p, c) => [p.id, 0, 0, 0, 0, null, 0, 0, null, 0, 0, 0, c];
    var vs = () => Flight.vessels.filter((v) => v.foreign === 4).length, cuts = [];
    for (const c of ['x', 2, -2]) { emit({ t: 'pv', f: 4, list: [row(ww, c)] }); cuts.push(ww.cut || 0, vs()); }
    emit({ t: 'pv', f: 4, list: [row(gun, 1)] }); cuts.push(gun.cut || 0, vs());
    wg.hitByMeAt = __P; Death.fb.text = ''; emit({ t: 'pv', f: 4, list: [row(ww, 1)] }); var half = Flight.vessels.find((v) => v.foreign === 4), fbW = Death.fb.text;
    emit({ t: 'pv', f: 4, list: [row(ww, 1)] }); emit({ t: 'pv', f: 4, list: [row(ww, -1)] }); var after = [ww.cut, vs()];`);
  t('rooms: a pv row\'s 13th column cuts a peer\'s wing: the half that went falls (foreign, its own cut the other way); junk values and a gun ignored, never twice, never undone; WING OFF when it was our doing',
    X(`cuts.join() === '0,0,0,0,0,0,0,0' && !!half && half.parts.length === 1 && half.parts[0].type === ww.type && half.parts[0].cut === -1 && half.hulk != null && fbW === 'WING OFF' && after.join() === '1,1' && wg.clS < Death._t.intactClS(wg) - 1e-9`),
    X('[cuts, !!half, fbW, after]'));
  // (Phase 2 review MP-P2-2) one forged pv message cutting every plain wing of a craft of 201 wings: the ghost rebuilt
  // once, at most 6 halves falling (it cost 0.6 s and left 201 vessels of our physics; 583 wings, 3 s and 581)
  X(`emit({ t: 'spawn', f: 5, name: 'P5', kind: 'plane', parts: (() => { const b = rowsOf('falcon'), w = b.find((r) => PARTS[r[1]].wing && !PARTS[r[1]].wing.control), rs = b.slice(); for (let i = 0; i < 200; i++) { const r = w.slice(); r[0] = 1000 + i; r[3] = w[3] + (i % 20) * 0.05; rs.push(r); } return rs; })() });
    { const tw = craftOf('falcon', 'plane', RW + 1500, 700); emit(snapOf(tw, 5)); } MP.peers.get(5).recv = __P; MP.beforeUpdate(0.016);
    var fw = MP.peers.get(5).ghost, fwings = fw.parts.filter((p) => p.def.wing && !p.def.wing.control), rb = 0, rb0 = fw.rebuildGroups; fw.rebuildGroups = function () { rb++; return rb0.apply(this, arguments); };
    var nv5 = Flight.vessels.length; emit({ t: 'pv', f: 5, list: fwings.map((p) => [p.id, 0, 0, 0, 0, null, 0, 0, null, 0, 0, 0, 1]) }); var made5 = Flight.vessels.length - nv5;`);
  t('rooms: ...one message cutting every wing of a 201-wing craft: all cut, the ghost rebuilt once, at most 6 halves falling', X(`fwings.length === 201 && fwings.every((p) => p.cut === 1) && rb === 1 && made5 === 6`), X('[fwings.length, rb, made5]'));
  X(`var eng = wg.parts.find((p) => p.def.thrust); Death.fb.text = ''; emit({ t: 'hp', f: 4, list: [[eng.id, 25, 1]] }); var b1 = eng.burn, h1 = eng.hp, fbF = Death.fb.text; emit({ t: 'hp', f: 4, list: [[eng.id, 25]] }); var b2 = eng.burn;
    emit({ t: 'hp', f: 4, list: [[ww.id, 50]] }); var hw = ww.hp;`);
  t('rooms: an hp row\'s 3rd column: that part of a peer\'s plane burns here (ON FIRE when it was our doing); without it, out; a cut wing\'s health is its half\'s',
    X(`b1 === 1 && Math.abs(h1 - 0.25 * Combat.maxHp(eng.def)) < 1e-9 && fbF === 'ON FIRE' && b2 === 0 && Math.abs(hw - 0.25 * Combat.maxHp(ww.def)) < 1e-9`), X('[b1, h1, fbF, b2, hw]'));
  // our side of it: our cut wing's pv row has 13 columns (every other row 12), a burning part's hp row 3
  X(`var mine = fly(craftOf('falcon', 'plane', RW, 2000)), mw = mine.mainWing; Death.cutWing(mine, mw, 1, 'shot', Flight); var en = mine.parts.find((p) => p.def.thrust); en.hp = 0.5 * Combat.maxHp(en.def); en.burn = 5;
    const hpq = mine.parts.find((p) => p !== en && !p.def.wing); hpq.hp = 0.8 * Combat.maxHp(hpq.def);
    MP.sent = { s: 1e12, pv: -1e9, hp: -1e9, hpSig: '' }; Net.out = []; MP.afterUpdate(); var pvs = sent('pv')[0][0].list, hps = sent('hp')[0][0].list;`);
  t('rooms: our plane with half a wing gone sends its wing\'s pv row with 13 columns (1: its +z half), every other row 12',
    X(`pvs.find((r) => r[0] === mw.id).length === 13 && pvs.find((r) => r[0] === mw.id)[12] === 1 && pvs.filter((r) => r[0] !== mw.id).every((r) => r.length === 12) && pvs.length > 3`), X('pvs.map((r) => r.length)'));
  t('rooms: ...and a burning engine\'s hp row 3 columns ([id, %, 1]), every other row 2', X(`JSON.stringify(hps.find((r) => r[0] === en.id)) === JSON.stringify([en.id, 50, 1]) && hps.filter((r) => r[0] !== en.id).every((r) => r.length === 2) && hps.some((r) => r[0] === hpq.id)`), X('hps'));
  // a hit's wing side, both ways
  X(`Net.out = []; var gs = ghostOf(3, 'falcon', 'plane', RW + 1500, 600), w3 = gs.mainWing, f3 = gs.parts.find((p) => !p.def.wing && !p.def.control && !p.def.thrust); Death.fb.tick = -9;
    MP.sendHits(gs, [[w3, 50, 1], [f3, 20]], 'blast'); MP.sendHit(gs, f3, 10, 'shot'); MP.sendHit(gs, w3, 10, 'shot', -1); MP.sendHit(gs, w3, 10, 'shot', 'x'); var hs = sent('hit').map(([m]) => m);`);
  t('rooms: our hits on a peer\'s plane: a plain wing\'s rows carry the half hit (3rd element), every other row as ever ([id, damage]); the hit tick; its losses ours to hear for 8 s',
    X(`JSON.stringify(hs[0].list) === JSON.stringify([[w3.id, 50, 1], [f3.id, 20]]) && JSON.stringify(hs[1]) === JSON.stringify({ t: 'hit', to: 3, list: [[f3.id, 10]], k: 'shot' }) && JSON.stringify(hs[2].list) === JSON.stringify([[w3.id, 10, -1]]) && JSON.stringify(hs[3].list) === JSON.stringify([[w3.id, 10]]) && gs.hitByMeAt === __P && Death.fb.tick === Flight.time`),
    X('hs'));
  X(`var me3 = fly(craftOf('falcon', 'plane', RW, 2000)), w4 = me3.mainWing; Flight.time = 0; w4.hp = 10; emit({ t: 'hit', f: 2, to: 1, list: [[w4.id, 50, -1]], k: 'shot' });`);
  t('rooms: a hit row [id, 50, -1] on our wing takes its -z half (the half the shooter saw hit); crippled, not destroyed, the credit theirs', X(`w4.cut === -1 && me3.hulk != null && !me3.down && !Flight.destroyed && MP.pidOf(me3.doomBy) === 2`), X('[w4.cut, me3.hulk, MP.pidOf(me3.doomBy)]'));
  // kill credit: whoever crippled it, however long it fell; today's 20 s otherwise
  X(`Flight.time = 40; Net.out = []; __timers = []; Death.crash(me3, Flight); var dc1 = sent('down')[0][0], tm1 = __timers.map((x) => x[0]);`);
  t('rooms: crippled by player 2 at 0 s, crashed at 40 s: the kill is still theirs (by 2); no fall, no wreck; the battle\'s 1800 ms timer as ever', X(`dc1.by === 2 && dc1.fall === undefined && dc1.w === undefined && Object.keys(dc1).join() === 't,by,P' && tm1.join() === '1800'`), X('[dc1, tm1]'));
  X(`var me4 = fly(craftOf('falcon', 'plane', RW, 2000)); Flight.time = 0; emit({ t: 'hit', f: 2, to: 1, list: [[me4.parts.find((p) => !p.def.wing && !p.def.control && !p.def.thrust).id, 1]], k: 'shot' });
    Flight.time = 25; Net.out = []; Death.crash(me4, Flight); var dc2 = sent('down')[0][0];`);
  t('rooms: not crippled, last hit 25 s before the crash: crashed by ourselves (by 0)', X(`me4.hulk == null && dc2.by === 0`), X('dc2'));
  X(`var me5 = fly(craftOf('falcon', 'plane', RW, 2000)), w5 = me5.mainWing; Flight.time = 0; w5.hp = 10; emit({ t: 'hit', f: 2, to: 1, list: [[w5.id, 50, 1]], k: 'shot' }); var crip5 = me5.hulk != null && MP.pidOf(me5.doomBy) === 2;
    me5.landed = true; me5.vx = me5.vy = me5.vz = 0; for (let k = 0; k < 3; k++) { Flight.time += 1.1; Death.tick(Flight, 1.1, k); } var safe5 = me5.hulk == null && me5.doomBy == null;
    Flight.time = 30; Net.out = []; Death.crash(me5, Flight); var dc3 = sent('down')[0][0];`);
  t('rooms: crippled, landed and at rest 3 s (it made it), crashed later: by 0 (its credit went when it landed)', X(`crip5 && safe5 && dc3.by === 0`), X('[crip5, safe5, dc3]'));
  // our pilot knocked out in the air by a hit message whose next row takes our tailplane off: down.fall (the kill
  // theirs) once the hit is over, after the last word on the hulk as it then is (the tailplane gone there too); the end
  // screen waits for the fall
  X(`var me6 = fly(craftOf('falcon', 'plane', RW, 2000)), ck = me6.control, tl = me6.parts.find((p) => p.def.wing && p.def.wing.control); me6.vx = 150.04; me6.vy = -20.06; me6.vz = 3.33; Flight.time = 0; __timers = []; __ui = []; __af = [];
    var rp0 = Flight.ripParts; Flight.ripParts = function (v, ps) { for (const p of ps) { for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.get(p.id).clear(); } for (const q of v.splitComponents()) { q.isDebris = !q.control; this.vessels.push(q); } v.rebuildGroups(); };
    Flight.afterFall = (cb) => { __af.push(cb); }; MP.sent = { s: 0, pv: 0, hp: 0, hpSig: '' }; MP.lastParts = me6.parts.length; Net.out = [];
    MP.player(1).flying = true; var k06 = MP.player(2).kills; ck.hp = 10; tl.hp = 5; emit({ t: 'hit', f: 2, to: 1, list: [[ck.id, 20], [tl.id, 50]], k: 'shot' }); var sync6 = sent('down').length, tlOff = !me6.parts.includes(tl), rec6 = MP.player(2).kills - k06;`);
  await null; // (the end of the task the hit message came in)
  X(`var order = Net.out.map(([m]) => m.t), dk = sent('down')[0] && sent('down')[0][0], pm = sent('parts')[0] && sent('parts')[0][0];
    flush(); var waited = __af.length === 1 && !__ui.some(([k]) => k === 'spectate'); __af[0] && __af[0](); var after6 = __ui.some(([k]) => k === 'spectate'); delete Flight.afterFall; Flight.ripParts = rp0;`);
  t('rooms: our pilot knocked out in the air: no down while the hit message is still landing (its next row takes our tailplane off); the host books the kill at once',
    X(`sync6 === 0 && tlOff && Flight.destroyed && rec6 === 1`), X('[sync6, tlOff, Flight.destroyed, rec6]'));
  t('rooms: ...then down with fall (our velocity, 0.1 m/s) and by 2, after a last snapshot, part states, health and the parts left (the tailplane gone: the hulk falls as it is everywhere)',
    X(`!!dk && JSON.stringify(dk.fall) === JSON.stringify([150, -20.1, 3.3]) && dk.by === 2 && dk.w === undefined && order.indexOf('s') >= 0 && order.indexOf('s') < order.indexOf('down') && order.indexOf('hp') < order.indexOf('down') && order.indexOf('pv') < order.indexOf('down')
      && !!pm && order.indexOf('parts') < order.indexOf('down') && !pm.ids.includes(tl.id) && pm.ids.includes(ck.id) && order.filter((x) => x === 'down').length === 1`), X('[dk, order, pm && pm.ids.length]'));
  t('rooms: ...the spectating timer (1800 ms, as ever) waits for the fall and the crash (Flight.afterFall), then runs', X(`waited && after6`), X('[waited, after6, __af.length]'));
  // crashed in the same task as the knock-out (a pilot killed a metre off the ground... and then the ground): one down, no fall
  X(`var me7 = fly(craftOf('falcon', 'plane', RW, 2000)), ck7 = me7.control; Flight.time = 0; me7.vx = 100; MP.sent = { s: 0, pv: 0, hp: 0, hpSig: '' }; Net.out = [];
    ck7.hp = 10; emit({ t: 'hit', f: 3, to: 1, list: [[ck7.id, 20]], k: 'shot' }); Death.crash(me7, Flight);`);
  await null;
  t('rooms: knocked out and crashed in one go: one down, no fall, by the hitter', X(`sent('down').length === 1 && sent('down')[0][0].fall === undefined && sent('down')[0][0].by === 3`), X(`sent('down').map(([m]) => m)`));
  // forged: an hp row's 3rd column other than 1 lights nothing; a hit row's side other than ±1 is no side (the dice choose)
  X(`var fg2 = ghostOf(3, 'falcon', 'plane', RW + 1600, 600), e2 = fg2.parts.find((p) => p.def.thrust), lit2 = []; for (const c of ['1', 2, true, -1, NaN, null]) { e2.burn = 0; emit({ t: 'hp', f: 3, list: [[e2.id, 40, c]] }); lit2.push(e2.burn); }
    var me8 = fly(craftOf('falcon', 'plane', RW, 2000)), w8 = me8.mainWing; w8.hp = 10; Flight.time = 0; emit({ t: 'hit', f: 2, to: 1, list: [[w8.id, 50, 'x']], k: 'shot' }); var cut8 = w8.cut;
    var me9 = fly(craftOf('falcon', 'plane', RW, 2000)), w9 = me9.mainWing; w9.hp = 10; emit({ t: 'hit', f: 2, to: 1, list: [[w9.id, 50, 7]], k: 'shot' }); var cut9 = w9.cut;`);
  t('rooms: forged columns: an hp row\'s 3rd column \'1\', 2, true, -1, NaN or null lights no fire; a hit row\'s side \'x\' or 7 still cuts a half (the dice\'s), nothing thrown',
    X(`lit2.every((b) => b === 0) && (cut8 === 1 || cut8 === -1) && (cut9 === 1 || cut9 === -1)`), X('[lit2, cut8, cut9]'));
  // a peer's hulk falling on our tank: it passes through (a picture), never shoving or denting us; a piece of our own does
  X(`var tk0 = fly(craftOf('tk34', 'tank', RW + 2500, 0)), hp0t = JSON.stringify(tk0.parts.map((p) => p.hp)), P0 = [tk0.x, tk0.y, tk0.z], V0 = [tk0.vx, tk0.vy, tk0.vz];
    var drop = (foreign) => { const h = craftOf('falcon', 'plane', RW + 2500, 0), c = centre(tk0), d = centre(h); h.x += c.x - d.x; h.y += c.y - d.y; h.z += c.z - d.z; const r = Math.hypot(h.x, h.y, h.z); h.vx = (-h.x / r) * 40; h.vy = (-h.y / r) * 40; h.vz = (-h.z / r) * 40;
      Object.assign(h, { isDebris: true, hulk: 0, down: true }); if (foreign) h.foreign = 2; Flight.vessels.push(h); Gear.bump(tk0, Flight); Flight.vessels = Flight.vessels.filter((o) => o !== h); return h; };
    drop(true); var still = tk0.x === P0[0] && tk0.y === P0[1] && tk0.z === P0[2] && tk0.vx === V0[0] && tk0.vy === V0[1] && tk0.vz === V0[2] && JSON.stringify(tk0.parts.map((p) => p.hp)) === hp0t;
    drop(false); var moved = tk0.x !== P0[0] || tk0.vx !== V0[0] || tk0.vy !== V0[1];`);
  t('rooms: a peer\'s hulk (foreign) landing on our TK-34 passes through: not moved, not shoved, not dented (the same hulk of our own would)', X(`still && moved`), X('[still, moved]'));
  X(`FX.death = fd0;`);
}

// ---- 8. the room's wrecks on every screen (Phase 2 review P2-GND-2, P2-GND-3, MP-P2-1): our own hulk is one of the
// wrecks from its down (the 9th wreck's cap and a spawn on top of it act on it at once, as on every other screen); a
// player joining late gets the room's wrecks from the host; a sandbox's wrecks stay while we are in the hangar
async function roomWrecks() {
  const H = `Flight.onDestroyed = function () { if (this.destroyed) return; this.destroyed = true; if (this.mp) MP.onLocalDestroyed(); };
    var centre = (v) => v.toWorld(v.com.x, v.com.y, v.com.z || 0), RW = EARTH.sites.runway.east;
    var craftOf = (key, kind, e) => { const ps = partsFromDesign(templateRows(TEMPLATES[key])), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = kind; v.name = key; v.rebuildGroups(); v.placeOnSurface(EARTH, siteAngle(EARTH, e), VEHICLE_KINDS[kind].launchRot); return v; };
    var wreckAt = (e, pid) => { const v = craftOf('tk34', 'tank', e); v.remote = pid; MP.addWreck(v, pid); return MP.wrecks.at(-1); };
    var snapOf = (v, f) => ({ t: 's', f, th: __T, b: v.body.id, P: [v.x, v.y, v.z], V: [0, 0, 0], Q: [v.q.w, v.q.x, v.q.y, v.q.z], W: [0, 0, 0], C: [v.com.x, v.com.y, v.com.z || 0], g: 0, l: 1 });`;
  const room = async () => { const Q = G.load({ mp: true, combat: true }), X = (c) => G.run(Q, c); X(ROOM); X(H); await X(`MP.host('sandbox', 'local')`); return X; };
  // the owner's screen: eight wrecks stand; our TK-34 is knocked out (the 9th)
  const A = await room();
  A(`MP.addPlayer(2, 'Bea'); MP.addPlayer(3, 'Cid'); __design = { name: 'Tank', kind: 'tank', parts: templateRows(TEMPLATES.tk34) }; MP.startFlight(false);
    for (let i = 0; i < 8; i++) { __P = i * 1000; wreckAt(RW + 400 + i * 40, 2); } __P = 10000;
    var oldest = MP.wrecks[0], me = Flight.active; me.placeOnSurface(EARTH, siteAngle(EARTH, RW + 250), VEHICLE_KINDS.tank.launchRot); // (driven off its start)
    Armour.knockOut(me, Flight, 'crew'); var mine = MP.wrecks.find((w) => w.v === me);`);
  t('wrecks: our knocked-out hulk is one of the room\'s wrecks from its down: as the 9th it starts the oldest sinking now, as on every other screen (it waited for our respawn)',
    A(`!!mine && mine.pid === 1 && mine.t === 10000 && oldest.sinkAt === 10000 && MP.hulk.v === me`), A('[!!mine, oldest.sinkAt, mine && mine.t]'));
  A(`__P = 11000; MP.respawn(); var kept = MP.wrecks.filter((w) => w.v === me).length, keep1 = Flight.starts.at(-1).keep;`);
  t('wrecks: ...our respawn keeps it (once) standing where it was', A(`kept === 1 && Flight.vessels.includes(me) && mine.sinkAt == null && MP.sinkStart(mine) === 10000 + 294000`), A('[kept, keep1, mine.sinkAt]'));
  // a peer's new craft 4 m from our hulk while we wait to respawn: it sinks on our screen at their first snapshot too
  const B = await room();
  B(`MP.addPlayer(2, 'Bea'); __design = { name: 'Tank', kind: 'tank', parts: templateRows(TEMPLATES.tk34) }; MP.startFlight(false);
    __P = 1000; var me = Flight.active; me.placeOnSurface(EARTH, siteAngle(EARTH, RW + 300), VEHICLE_KINDS.tank.launchRot); Armour.knockOut(me, Flight, 'crew');
    __P = 3000; emit({ t: 'spawn', f: 2, name: 'P2', kind: 'tank', parts: rowsOf('ms4') }); var c0 = centre(me), tw = craftOf('ms4', 'tank', RW); { const c = centre(tw); tw.x += c0.x - c.x; tw.y += c0.y - c.y; tw.z += c0.z - c.z + 4; }
    emit(snapOf(tw, 2)); MP.peers.get(2).recv = __P; MP.beforeUpdate(0.016); var w = MP.wrecks.find((x) => x.v === me), s3 = w && w.sinkAt;
    __P = 9100; MP.peers.get(2).recv = __P; MP.beforeUpdate(0.016);`);
  t('wrecks: a peer spawning 4 m from our hulk while we wait to respawn sinks it on our screen too (at their first snapshot, gone 6 s later), as on every other',
    B(`s3 === 3000 && !MP.wrecks.some((x) => x.v === me) && !Flight.vessels.includes(me)`), B('[s3, MP.wrecks.length]'));
  // a player joining late: the host (A, our hulk and the eight others, the oldest sinking) sends each standing wreck
  A(`__P = 12000; Net.out = []; emit({ t: 'join', pid: 4, name: 'Dot' }); var W = sent('wrecks').filter(([, to]) => to === 4).map(([m]) => JSON.parse(JSON.stringify(m)));
    var standing = MP.wrecks.filter((w) => MP.sinkStart(w) + 6000 > __P), mineW = W.find((m) => m.p === 1);`);
  t('wrecks: a player joining late gets the room\'s wrecks from the host, one a message (ours too, with its parts, where it lies and how old it is); none to anyone else',
    A(`W.length === standing.length && W.length >= 8 && sent('wrecks').every(([, to]) => to === 4) && !!mineW && mineW.r.length === me.parts.length && mineW.a === 2000 && mineW.s === -1 && mineW.why === 'crew' && mineW.k === 'tank' && mineW.P[0] === me.x`),
    A('[W.length, standing.length, mineW && [mineW.r.length, mineW.a, mineW.s]]'));
  const msgs = A('JSON.stringify(W)'), at = A('JSON.stringify([me.x, me.y, me.z, me.q.w, me.q.x, me.q.y, me.q.z, me.parts.map((p) => p.id).join()])');
  // the late joiner (pid 4, not the host) builds them: where they lie, as old as they are, solid wrecks, ours as player 1's
  const C = await room();
  C(`Net.isHost = false; Net.me = 4; MP.wrecks = []; __P = 50000; var W = ${msgs}; for (const m of W) emit(Object.assign({}, m, { f: 1 }));
    var got = MP.wrecks.find((w) => w.pid === 1), A0 = ${at};`);
  t('wrecks: ...and builds each where it lies, as old as it is, a solid wreck (player 1\'s TK-34 with the same parts), sinking where the host\'s was sinking',
    C(`MP.wrecks.length === W.length && !!got && got.v.wreck && got.v.ko && got.v.ko.why === 'crew' && got.t === 50000 - 2000 && Math.abs(got.v.x - A0[0]) < 1e-6 && Math.abs(got.v.y - A0[1]) < 1e-6 && Math.abs(got.v.q.w - A0[3]) < 1e-9
      && got.v.parts.map((p) => p.id).join() === A0[7] && got.v.remote === 1 && MP.wrecks.filter((w) => w.sinkAt != null).length === W.filter((m) => m.s >= 0).length`),
    C('[MP.wrecks.length, got && got.t, got && [got.v.x - A0[0], got.v.parts.length]]'));
  C(`var n0 = MP.wrecks.length; emit(Object.assign({}, W[0], { f: 2 })); var fromPeer = MP.wrecks.length;
    emit(Object.assign({}, W[0], { f: 1, k: 'plane' })); emit(Object.assign({}, W[0], { f: 1, r: 'x' })); emit(Object.assign({}, W[0], { f: 1, P: [1e9, 0, 0] })); emit(Object.assign({}, W[0], { f: 1, Q: [0, 0, 0, 0] })); emit(Object.assign({}, W[0], { f: 1, a: NaN }));
    var forged = MP.wrecks.length; for (let i = 0; i < 20; i++) emit(Object.assign({}, W[0], { f: 1 })); var capped = MP.wrecks.length;`);
  t('wrecks: ...only from the host; a forged one (an aircraft, bad rows, off in space, no turn, no age) builds nothing; at most 16 held',
    C(`fromPeer === n0 && forged === n0 && capped === 16`), C('[n0, fromPeer, forged, capped]'));
  // the hangar (a sandbox): Back to hangar and Fly again keeps the room's wrecks; back in a battle's lobby they go
  A(`__P = 20000; MP.beforeUpdate(0.016); var n1 = MP.wrecks.length; MP.leaveFlight(); var inHangar = MP.wrecks.length; MP.startFlight(false); __P = 21000; MP.beforeUpdate(0.016);
    var back = MP.wrecks.length, inFlight = MP.wrecks.every((w) => Flight.vessels.includes(w.v));`);
  t('wrecks: in a sandbox, Back to hangar and Fly again keeps the room\'s wrecks (they stand on every other screen): in our next flight, solid', A(`n1 >= 8 && inHangar === n1 && back === n1 && inFlight`), A('[n1, inHangar, back]'));
  A(`MP.state.mode = 'pvp'; MP.onPhase('battle', 'lobby'); var lobby = MP.wrecks.length;`);
  t('wrecks: ...and a battle\'s lobby starts with none', A(`lobby === 0`), A('lobby'));
}

// ---- 9. drones in a room (the big update, spec-drones §16): a player's second craft (a drone from their tank's bay)
// on its own craft index c, beside their tank's ghost; refused when forged, without a bay or too big for it; nothing
// booked when it goes down; our own drone's messages (c last) and the hits on it; a tank knocked out under its flown
// drone told once; a standalone drone in a ground battle (11 tickets at $1,920); the zones and spotting see main craft only.
const DRONE_ROWS = `(() => { const T = typeof TEMPLATES !== 'undefined' && TEMPLATES.bumble && TEMPLATES.bumble.kind === 'drone' ? TEMPLATES.bumble : null; if (T) return templateRows(T);
  const R = [['drFrameS', 0, 0], ['drFC', 0, 0.0375, 0, { att: 0 }], ['drCam', 0.155, 0.0425, 0, { att: 0 }], ['drLink', -0.1, 0.0325, 0, { att: 0 }],
    ['drMotorS', 0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', 0.15, 0.0475, 0, { z: -0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: -0.15, att: 0 }],
    ['drBattS', -0.03, -0.0425, 0, { att: 0 }], ['drCharge', 0.06, -0.1125, 3, { att: 8 }]];
  return R.map((r) => ({ type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: r[1] < 0, ...(r[4] || {}) })); })()`;
const DRONE_HELP = `var BUMBLE = ${DRONE_ROWS};
    var up = (v, h) => { const r = Math.hypot(v.x, v.y, v.z); v.x += (v.x / r) * h; v.y += (v.y / r) * h; v.z += (v.z / r) * h; };
    // a drone's spawn rows, its ids renumbered from base (1: the same ids as a tank's first parts, on purpose)
    var renum = (rows, base) => { const map = new Map(rows.map((r, i) => [r[0], base + i])); return rows.map((r) => { const q = r.slice(); q[0] = map.get(r[0]); q[7] = r[7] ? map.get(r[7]) || 0 : 0; return q; }); };
    var dRows = renum(MP.spawnRows(Drone.build(BUMBLE, 'Bumble')), 1), tankRows = [...rowsOf('tk34'), [99, 'dockRack', 0, 1.4, 0, 0, 0, 0, 0]];
    var snapOf = (v, f, c) => { const m = { t: 's', f, th: __T, b: v.body.id, P: [v.x, v.y, v.z], V: [v.vx, v.vy, v.vz], Q: [v.q.w, v.q.x, v.q.y, v.q.z], W: [0, 0, 0], C: [v.com.x, v.com.y, v.com.z || 0], g: 0, l: 0 }; if (c !== undefined) m.c = c; return m; };
    var twin = (rows, kind, f, e, h) => { const v = MP.vesselOf(mpSpawnRows(rows, 600), kind, f); v.placeOnSurface(EARTH, siteAngle(EARTH, e), VEHICLE_KINDS[kind].launchRot); if (h) up(v, h); return v; };
    var sig = (g) => JSON.stringify(g.parts.map((p) => [p.id, p.hp, p.firing || 0])) + g.parts.length;
    var RW = EARTH.sites.runway.east;`;
async function roomDrones() {
  const Q = G.load({ mp: true, combat: true });
  const X = (code) => G.run(Q, code);
  X(ROOM);
  await X(`MP.host('sandbox', 'local')`);
  X(DRONE_HELP);
  // -- a peer's tank (with a Drone Rack) and its drone (c 1): two ghosts
  X(`MP.addPlayer(2, 'Bea'); MP.addPlayer(3, 'Cid'); __design = { name: 'Tank', kind: 'tank', parts: templateRows(TEMPLATES.tk34) }; MP.startFlight(false); Net.out = [];
    var tw = twin(tankRows, 'tank', 2, RW + 300, 0), dw = twin(dRows, 'drone', 2, RW + 330, 30);
    emit({ t: 'spawn', f: 2, name: 'Bea', kind: 'tank', parts: tankRows }); emit(snapOf(tw, 2));
    emit({ t: 'spawn', f: 2, name: 'Bumble', kind: 'drone', parts: dRows, c: 1 }); emit(snapOf(dw, 2, 1)); MP.beforeUpdate(0.016);
    var P2 = MP.peers.get(2), gT = P2.ghost, gD = MP.ghostOf(2, 1);`);
  t('drones: a peer\'s tank (a Drone Rack aboard) and its drone (spawn c 1): two ghosts, the drone "Bea\'s drone" (its own craft index, theirs), both in our flight',
    X(`!!gT && !!gD && gT !== gD && gD.kind === 'drone' && gD.craft === 1 && gD.remote === 2 && gD.name === "Bea's drone" && gD.parts.length === dRows.length && gT.kind === 'tank' && Flight.vessels.includes(gT) && Flight.vessels.includes(gD)`),
    X('[!!gT, !!gD, gD && gD.name, gD && gD.parts.length]'));
  t('drones: ...the drone is an enemy ghost (seekers, turrets and counter-drone kit see it), never one of the players\' ghosts (spectating, the map), and an extra',
    X(`MP.enemyGhosts().includes(gD) && MP.enemyGhosts().includes(gT) && !MP.ghosts().includes(gD) && MP.ghosts().includes(gT) && MP.extraGhosts().length === 1 && MP.extraGhosts()[0] === gD`));
  // -- each snapshot poses its own ghost only
  X(`var t0 = [gT.x, gT.y, gT.z]; dw.x += 40; emit(snapOf(dw, 2, 1)); P2.recv = __P; P2.x.get(1).recv = __P; MP.beforeUpdate(1); var dMoved = Math.abs(gD.x - dw.x) < 1e-6, tSame = gT.x === t0[0] && gT.y === t0[1] && gT.z === t0[2];
    var d0 = [gD.x, gD.y, gD.z]; tw.x += 30; emit(snapOf(tw, 2)); P2.recv = __P; MP.beforeUpdate(1); var tMoved = Math.abs(gT.x - tw.x) < 1e-6, dSame = gD.x === d0[0] && gD.y === d0[1] && gD.z === d0[2];`);
  t('drones: each snapshot poses only its own ghost (the drone\'s c 1 moves the drone, the tank\'s moves the tank)', X('dMoved && tSame && tMoved && dSame'), X('[dMoved, tSame, tMoved, dSame]'));
  // -- parts, hp and pv stay within their c (the drone's ids are the tank's first ten, on purpose)
  X(`var sT = sig(gT), motor = gD.parts.find((p) => p.def.thrust), one = gD.parts.find((p) => p.id === 1);
    emit({ t: 'hp', f: 2, list: [[1, 50]], c: 1 }); emit({ t: 'pv', f: 2, list: [[motor.id, 0, 0.7, 0, 0, null, 0, 0, null, 0, 0, 0]], c: 1 });
    var hpOk = Math.abs(one.hp - 0.5 * Combat.maxHp(one.def)) < 1e-9 && motor.firing === 0.7 && motor.active === true, sT1 = sig(gT);
    emit({ t: 'parts', f: 2, ids: gD.parts.filter((p) => p !== motor).map((p) => p.id), c: 1 }); var lost = !gD.parts.includes(motor) && gD.parts.length === dRows.length - 1;
    var sD = sig(gD); emit({ t: 'hp', f: 2, list: [[1, 20]] }); var tHit = gT.parts.find((p) => p.id === 1).hp < Combat.maxHp(gT.parts.find((p) => p.id === 1).def), dSame2 = sig(gD) === sD;`);
  t('drones: parts, hp and pv with c 1 reach the drone only (the tank\'s parts with the same ids untouched), and the tank\'s (no c) the tank only',
    X('hpOk && sT1 === sT && lost && gT.parts.length === tankRows.length && tHit && dSame2'), X('[hpOk, sT1 === sT, lost, gT.parts.length, tHit, dSame2]'));
  // -- forged c: refused everywhere (never taken as the main craft)
  X(`var bad = [NaN, 0.5, '1', 4, 1e9, {}, null, -1, 0], nT = gT.parts.length, xs0 = P2.x.size, out0 = [];
    for (const c of bad) { emit({ t: 'spawn', f: 2, name: 'x', kind: 'drone', parts: dRows, c }); emit(Object.assign(snapOf(dw, 2), { c })); emit({ t: 'parts', f: 2, ids: [], c }); emit({ t: 'hp', f: 2, list: [[2, 1]], c });
      emit({ t: 'down', f: 2, by: 1, P: [0, 0, 0], c }); emit({ t: 'despawn', f: 2, c }); }
    var forgedOk = gT.parts.length === nT && !gT.dead && P2.ghost === gT && P2.x.size === xs0 && MP.ghostOf(2, 1) === gD && !gD.dead && !!P2.design && P2.x.get(1).snap.c === 1;`);
  t('drones: a forged c (NaN, 0.5, \'1\', 4, 1e9, {}, null, -1, 0) is refused in spawn, s, parts, hp, down and despawn (the tank never takes it)', X('forgedOk'), X('[gT.parts.length, nT, P2.x.size, !!P2.design]'));
  // -- refused spawns: no bay on their craft, too dear or heavy for the bay, too many parts, not a drone
  X(`emit({ t: 'spawn', f: 3, name: 'Cid', kind: 'tank', parts: rowsOf('tk34') }); emit({ t: 'spawn', f: 3, name: 'x', kind: 'drone', parts: dRows, c: 1 }); var noBay = !MP.peers.get(3).x;
    var big = MP.spawnRows(Drone.build([...BUMBLE, { type: 'drBattL', x: 0, y: -0.2, att: 0 }, { type: 'drGimbal', x: 0.1, y: -0.1, att: 0 }], 'Big')), bigFit = Drone.fits({ kind: 'drone', parts: MP.partsOfRows(mpSpawnRows(big, 40)) }, PARTS.dockRack.dock);
    emit({ t: 'spawn', f: 2, name: 'x', kind: 'drone', parts: big, c: 2 }); var tooBig = MP.ghostOf(2, 2) === null && !P2.x.has(2) && P2.x.has(1);
    var many = Array.from({ length: 41 }, (_, i) => [i + 1, 'drMotorS', 0, i * 0.1, 0, 0, 0, 0, 0]); emit({ t: 'spawn', f: 2, name: 'x', kind: 'drone', parts: many, c: 3 });
    emit({ t: 'spawn', f: 2, name: 'x', kind: 'plane', parts: dRows, c: 3 }); var refused = !P2.x.has(3) && P2.x.has(1);`);
  t('drones: a c spawn is refused when their craft has no bay, when the drone doesn\'t fit the bay (too dear, heavy or wide), past 40 parts, or not a drone', X('noBay && !bigFit.ok && tooBig && refused'), X('[noBay, bigFit, tooBig, refused]'));
  // -- one extra per peer: a new one (c 2) puts the old (c 1) away
  X(`emit({ t: 'spawn', f: 2, name: 'Bumble', kind: 'drone', parts: dRows, c: 2 }); emit(snapOf(dw, 2, 2)); MP.beforeUpdate(0.016); var gD2 = MP.ghostOf(2, 2);`);
  t('drones: one extra per peer: their drone c 2 puts c 1 away (its ghost gone from the flight)', X('!!gD2 && gD.dead && !Flight.vessels.includes(gD) && P2.x.size === 1 && P2.x.has(2) && Flight.vessels.includes(gD2)'), X('[!!gD2, gD.dead, P2.x.size]'));
  // -- a down with c: nothing booked; ours: the toast and chime, no kill
  X(`UI.toasts = []; var me2 = MP.player(2), dd0 = me2.deaths, fl0 = me2.flying, k0 = Combat.S.kills, feed0 = MP.state.feed.length;
    emit({ t: 'down', f: 2, by: 1, P: [gD2.x, gD2.y, gD2.z], c: 2 }); var downOk = gD2.dead && !Flight.vessels.includes(gD2) && !P2.x.has(2) && me2.deaths === dd0 && me2.flying === fl0 && Combat.S.kills === k0
      && MP.state.feed.length === feed0 && !!P2.design && P2.ghost === gT && !gT.dead && UI.toasts.includes("Bea's drone down!");`);
  t('drones: a down with c books nothing (no death, kill, feed line; their tank and design kept); shot down by us: "Bea\'s drone down!"', X('downOk'), X('[gD2.dead, me2.deaths, Combat.S.kills, UI.toasts]'));
  // -- shot down in the air (fall): it falls here as a hulk of our own physics
  X(`emit({ t: 'spawn', f: 2, name: 'Bumble', kind: 'drone', parts: dRows, c: 3 }); emit(snapOf(dw, 2, 3)); MP.beforeUpdate(0.016); var gD3 = MP.ghostOf(2, 3);
    emit({ t: 'down', f: 2, by: 3, P: [gD3.x, gD3.y, gD3.z], fall: [3, -8, 1], c: 3 });`);
  t('drones: a down with c and fall: their drone falls here (a foreign hulk of our physics, its velocity theirs), its record gone', X('gD3.foreign === 2 && gD3.remote === 0 && gD3.hulk != null && gD3.isDebris && gD3.vy === -8 && Flight.vessels.includes(gD3) && !P2.x.has(3) && P2.ghost === gT'),
    X('[gD3.foreign, gD3.hulk, gD3.vy, P2.x.size]'));
  // -- a drone's spawn waits for its first snapshot (a frame or several); silent 15 s from it, it goes
  X(`emit({ t: 'spawn', f: 2, name: 'Bumble', kind: 'drone', parts: dRows, c: 1 }); P2.recv = __P; MP.beforeUpdate(0.016); var waits = P2.x.has(1);
    __P += 15100; P2.recv = __P; MP.beforeUpdate(0.016); var gone15 = !P2.x.has(1);`);
  t('drones: a drone\'s spawn waits for its first snapshot (frames go by), and goes after 15 s with none', X('waits && gone15'), X('[waits, gone15]'));
  // -- despawn with c (docked): that drone quietly; a late snapshot asks for its spawn (want c), at most every 3 s
  X(`emit({ t: 'spawn', f: 2, name: 'Bumble', kind: 'drone', parts: dRows, c: 1 }); emit(snapOf(dw, 2, 1)); MP.beforeUpdate(0.016); var gD4 = MP.ghostOf(2, 1);
    emit({ t: 'despawn', f: 2, c: 1 }); Net.out = []; emit(snapOf(dw, 2, 1)); emit(snapOf(dw, 2, 1)); var wants = sent('want');`);
  t('drones: despawn with c (docked) takes that drone away quietly, their tank kept; a late snapshot of it asks once for its spawn (want c 1)', X(`gD4.dead && !Flight.vessels.includes(gD4) && P2.ghost === gT && !!P2.design && wants.length === 1 && wants[0][0].c === 1 && wants[0][1] === 2`), X('[gD4.dead, wants]'));
  // -- onLeave drops both
  X(`emit({ t: 'spawn', f: 2, name: 'Bumble', kind: 'drone', parts: dRows, c: 1 }); emit(snapOf(dw, 2, 1)); P2.recv = __P; MP.beforeUpdate(0.016); var gD5 = MP.ghostOf(2, 1); emit({ t: 'leave', pid: 2 });`);
  t('drones: a player leaving takes their tank and their drone', X('!!gD5 && gD5.dead && gT.dead && !Flight.vessels.includes(gD5) && !Flight.vessels.includes(gT) && !MP.peers.has(2)'), X('[!!gD5, gD5 && gD5.dead, gT.dead]'));

  // -- our own drone: its spawn (c last), its updates (c last, 10 snapshots a second, a motor's throttle in tenths), want
  X(`MP.addPlayer(2, 'Bea'); emit({ t: 'spawn', f: 2, name: 'Bea', kind: 'tank', parts: tankRows }); emit(snapOf(tw, 2)); MP.beforeUpdate(0.016); var gB = MP.peers.get(2).ghost;
    var me = Flight.active, d = Drone.build(BUMBLE, 'Bumble'); d.x = me.x; d.y = me.y; d.z = me.z; up(d, 20); d.carrier = me; me.drone = d; Flight.vessels.push(d);
    Net.out = []; MP.nextC = 1; MP.sendExtra(d); var sp = sent('spawn').map(([m]) => m), E1 = MP.extra.get(1);`);
  t('our drone: its spawn goes out with c 1 last (kind drone, its rows), and it is our extra', X(`sp.length === 1 && Object.keys(sp[0]).join() === 't,name,kind,parts,c' && sp[0].c === 1 && sp[0].kind === 'drone' && sp[0].parts.length === d.parts.length && d.craft === 1 && E1.v === d && MP.nextC === 2`), X('[sp.map((m) => Object.keys(m).join()), d.craft]'));
  X(`d.parts.find((p) => p.def.thrust).firing = 0.537; MP.sent = { s: -1e9, pv: -1e9, hp: -1e9, hpSig: '' }; E1.sent = { s: -1e9, pv: -1e9, hp: -1e9, hpSig: '' }; Net.out = []; __P += 1; MP.afterUpdate();
    var o1 = Net.out.map(([m]) => m), s0 = o1.filter((m) => m.t === 's' && m.c === undefined), s1 = o1.filter((m) => m.t === 's' && m.c === 1), pv1 = o1.find((m) => m.t === 'pv' && m.c === 1);
    __P += 80; Net.out = []; MP.afterUpdate(); var o2 = Net.out.map(([m]) => m); __P += 30; Net.out = []; MP.afterUpdate(); var o3 = Net.out.map(([m]) => m);`);
  t('our drone: its updates carry c 1 last (s, pv, hp), a motor\'s throttle in tenths; the tank\'s none; 80 ms on the tank snaps again, the drone 100 ms after its last',
    X(`s0.length === 1 && s1.length === 1 && Object.keys(s1[0]).at(-1) === 'c' && !!pv1 && Object.keys(pv1).at(-1) === 'c' && pv1.list.some((r) => r[2] === 0.5) && o1.filter((m) => m.c === 1).every((m) => Object.keys(m).at(-1) === 'c')
      && o1.filter((m) => m.c === undefined).every((m) => !('c' in m)) && o2.some((m) => m.t === 's' && m.c === undefined) && !o2.some((m) => m.t === 's' && m.c === 1) && o3.some((m) => m.t === 's' && m.c === 1)`),
    X('[o1.map((m) => m.t + (m.c || "")), o2.map((m) => m.t + (m.c || "")), o3.map((m) => m.t + (m.c || ""))]'));
  X(`Net.out = []; emit({ t: 'want', f: 3, c: 1 }); var rs = Net.out.map(([m, to]) => [m.t, m.c, to]);`);
  t('our drone: a want with c 1 sends its spawn and its parts (c 1) to the one who asked', X(`JSON.stringify(rs) === JSON.stringify([['spawn', 1, 3], ['parts', 1, 3]])`), X('rs'));
  // -- a hit on our drone's part lands on the drone, and it knows who hit it
  X(`var hpTank = JSON.stringify(me.parts.map((p) => p.hp)), fc = d.parts.find((p) => p.def.drone && p.def.drone.fc); Flight.time = 60; emit({ t: 'hit', f: 2, to: 1, list: [[fc.id, 2]], k: 'shot' });`);
  t('our drone: a hit to:me on its part lands on the drone (our tank untouched) and the drone knows who hit it', X(`fc.hp < Combat.maxHp(fc.def) && JSON.stringify(me.parts.map((p) => p.hp)) === hpTank && d.lastHitBy === gB && d.lastHitAt === 60`), X('[fc.hp, d.lastHitBy && d.lastHitBy.remote]'));
  // -- missiles and flares: c and tc
  X(`Net.out = []; MP.sendFlares(d, { x: 1, y: 2, z: 3, vx: 0, vy: 0, vz: 0 }); MP.sendFlares(me, { x: 1, y: 2, z: 3, vx: 0, vy: 0, vz: 0 }); var cms = sent('cm').map(([m]) => m);
    var gX = { remote: 2, craft: 1 }; MP.sendMissile({ b: EARTH, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, dx: 0, dy: 1, dz: 0, target: gX, owner: d }, { seek: 'air' }); var ms = sent('msl')[0][0];`);
  t('flares from our drone carry c 1 (our tank\'s none); a missile from our drone at their drone carries tc 1 and c 1, last', X(`cms.length === 2 && cms[0].c === 1 && !('c' in cms[1]) && ms.tg === 2 && ms.tc === 1 && ms.c === 1 && Object.keys(ms).slice(-2).join() === 'tc,c'`), X('[cms, ms]'));
  X(`var rep = []; Combat.netMissile = (g, m, tgt) => rep.push(tgt); emit({ t: 'msl', f: 2, id: 9, b: 'earth', P: [0, 0, 0], V: [0, 0, 0], D: [0, 1, 0], tg: 1, tc: 1 }); emit({ t: 'msl', f: 2, id: 10, b: 'earth', P: [0, 0, 0], V: [0, 0, 0], D: [0, 1, 0], tg: 1 });
    emit({ t: 'msl', f: 2, id: 11, b: 'earth', P: [0, 0, 0], V: [0, 0, 0], D: [0, 1, 0], tg: 1, tc: 7 });`);
  t('a peer\'s missile with tc 1 is after our drone; without tc (or a forged one) after our tank', X(`rep.length === 3 && rep[0] === d && rep[1] === me && rep[2] === me`), X('rep.map((v) => v && v.name)'));
  // -- our drone goes: docked (despawn c), down (by, P, c last), once
  X(`Net.out = []; MP.dropExtra(d, 'despawn'); MP.dropExtra(d, 'down', gB); var dk = Net.out.map(([m]) => JSON.stringify(m));
    var d2 = Drone.build(BUMBLE, 'Bumble'); d2.x = me.x; d2.y = me.y; d2.z = me.z; d2.landed = true; Flight.vessels.push(d2); MP.sendExtra(d2); Net.out = []; MP.dropExtra(d2, 'down', gB); MP.dropExtra(d2, 'down', gB); var dn = Net.out.map(([m]) => m);`);
  t('our drone docked: one despawn {c}; lost: one down {t, by, P, c} (by the hitter\'s player), nothing more', X(`dk.length === 1 && dk[0] === JSON.stringify({ t: 'despawn', c: 1 }) && dn.length === 1 && Object.keys(dn[0]).join() === 't,by,P,c' && dn[0].by === 2 && dn[0].c === 2 && MP.extra.size === 0`), X('[dk, dn]'));
  // -- a tank knocked out under its flown drone: its down told at once (announceDown), the end once, no second down
  X(`var d3 = Drone.build(BUMBLE, 'Bumble'); d3.x = me.x; d3.y = me.y; d3.z = me.z; up(d3, 25); d3.carrier = me; Flight.vessels.push(d3); MP.sendExtra(d3); Flight.active = d3; __timers = [];
    me.ko = { why: 'crew', x: false, t: 0 }; Net.out = []; MP.me.deaths = 0; MP.announceDown(me); var told = sent('down').map(([m]) => m);
    MP.sent = { s: -1e9, pv: -1e9, hp: -1e9, hpSig: '' }; MP.extra.get(MP.extra.keys().next().value).sent = { s: -1e9, pv: -1e9, hp: -1e9, hpSig: '' }; Net.out = []; MP.afterUpdate(); var after = Net.out.map(([m]) => m);
    Net.out = []; Flight.carrierDown = me; Flight.active = me; Flight.destroyed = true; MP.onLocalDestroyed(); var again = sent('down').length, timers = __timers.map((x) => x[0]);`);
  t('LAST FLIGHT in a room: the tank\'s down is told at once (a wreck, booked once); while its drone flies on only the drone streams; the end screen later sends no second down',
    X(`told.length === 1 && told[0].w === 1 && told[0].c === undefined && MP.me.deaths === 1 && after.length > 0 && after.every((m) => m.c != null) && again === 0 && MP.me.deaths === 1 && timers.join() === '1600'`),
    X('[told, after.map((m) => m.t + m.c), again, MP.me.deaths, timers]'));
  X(`Flight.carrierDown = null; MP.startFlight(false);`);
  t('...a new flight: the drone despawned, mainDown cleared', X(`MP.extra.size === 0 && MP.mainDown === false`));
}
// a ground battle: a drone flown alone (aircraft at a respawn) pays 10 + cost / 2,500 tickets ($1,920: 11); the zones
// count main craft only; spotting reports main craft only
async function groundDrones() {
  const Q = G.load({ mp: true, combat: true });
  const X = (code) => G.run(Q, code);
  X(ROOM);
  await X(`MP.host('pvp', 'local', { game: 'ground', air: true })`);
  X(DRONE_HELP);
  X(`MP.addPlayer(2, 'Bea'); MP.setSetting('test', false); __design = { name: 'Tank', kind: 'tank', parts: templateRows(TEMPLATES.tk34) }; MP.startMatch(); flush(); __T += 200000; MP.tick(); flush();`);
  t('ground drones: a drone is an aircraft at a ground battle\'s respawn (with air support), never at the start; it stands where a helicopter would', X(`(() => {
    const ps = partsFromDesign(BUMBLE), c = designCost(ps); const a = MP.designProblems({ cost: c }, ps, 'drone', true).length, b = MP.designProblems({ cost: c }, ps, 'drone', false);
    return MP.phase === 'battle' && a === 0 && b.length === 1 && b[0] === 'Aircraft join a ground battle when you respawn: build Armour or a car.' && JSON.stringify(MP.padPlace('highland', 1, 0, 'drone')) === JSON.stringify(GroundMode.placement('highland', 1, 0, 'heli')); })()`));
  X(`var cost = designCost(partsFromDesign(BUMBLE)), tk0 = MP.state.obj.tk.slice(), team = MP.player(2).team;
    emit({ t: 'spawn', f: 2, name: 'Bumble', kind: 'drone', parts: dRows }); var flying = MP.player(2).flying, kind = MP.battleKind.get(2);
    emit({ t: 'down', f: 2, by: 0, P: [0, 0, 0] }); var paid = tk0[team] - MP.state.obj.tk[team];`);
  t('ground drones: a drone flown alone downed costs its team 10 + cost / 2,500 tickets (the Bumble\'s ' + '$' + '1,920: 11)', X(`flying && kind === 'drone' && paid === 10 + Math.round(cost / 2500) && (cost !== 1920 || paid === 11)`), X('[cost, paid, kind]'));
  // the zones and spotting: their tank and their drone up beside it; the drone counts for nothing
  X(`__T += 10000; MP.player(2).respawnAt = 0; emit({ t: 'spawn', f: 2, name: 'Bea', kind: 'tank', parts: tankRows }); var tw2 = twin(tankRows, 'tank', 2, RW + 6000, 0), dw2 = twin(dRows, 'drone', 2, RW + 6100, 30);
    emit(snapOf(tw2, 2)); emit({ t: 'spawn', f: 2, name: 'Bumble', kind: 'drone', parts: dRows, c: 1 }); emit(snapOf(dw2, 2, 1)); MP.beforeUpdate(0.016);
    var U = MP.groundUnits(__T).pids, gTk = MP.peers.get(2).ghost, gDr = MP.ghostOf(2, 1);`);
  t('ground drones: the zones count their tank, never their drone (groundUnits: main craft only)', X(`!!gDr && JSON.stringify(U.slice().sort()) === '[1,2]' && MP.groundUnits(__T).units.filter((u) => u.kind === 'drone').length === 0`), X('[U, !!gDr]'));
  X(`(() => { const v = Flight.active, c = gDr.toWorld(gDr.com.x, gDr.com.y, gDr.com.z || 0); gDr.x += v.x - c.x; gDr.y += v.y - c.y; gDr.z += v.z - c.z; up(gDr, 40); gDr.hiddenUntilSnap = false; })();
    MP.reportAt = -1e9; Net.out = []; MP.groundReports(); var seen = sent('seen').map(([m]) => m); var near = MP.sees(Flight.active, gDr, 40), far = (() => { up(gDr, 2000); return MP.sees(Flight.active, gDr, 2040); })();`);
  t('ground drones: their drone 40 m over our tank (their tank far off) is seen by our eyes (Drone.marked), but goes in no seen report (main craft only); 2 km up, not seen',
    X(`seen.every((m) => !m.ids.includes(2)) && near === true && far === false`), X('[seen, near, far]'));
}

// the Phase 4 review's fixes (each fails before its fix)
async function roomDronesReview() {
  const mk = async () => { const Q = G.load({ mp: true, combat: true }), X = (code) => G.run(Q, code); X(ROOM); await X(`MP.host('sandbox', 'local')`); X(DRONE_HELP); return X; };
  // P4-MP-2: a drone's spawn names its bay, so a player who never saw (or saw go down) the owner's tank still builds it;
  // with neither the tank's design nor a real bay named, it is refused as before
  const A = await mk();
  A(`MP.addPlayer(2, 'Bea'); __design = { name: 'Nest', kind: 'tank', parts: templateRows(TEMPLATES.tk34).concat([{ type: 'dockRack', x: -2.1, y: 1.925, rot: 0, flip: false, att: 0 }]) };
    MP.startFlight(false); var me = Flight.active, d = Drone.build(BUMBLE, 'Bumble'); d.x = me.x; d.y = me.y; d.z = me.z; up(d, 25); d.carrier = me; d.bay = me.docks[0]; me.drone = d; Flight.vessels.push(d);
    Net.out = []; MP.sendExtra(d); var sp = sent('spawn').map(([m]) => m)[0];`);
  const B = await mk();
  B(`Net.isHost = false; Net.me = 4; MP.addPlayer(1, 'Ann'); __design = { name: 'Bird', kind: 'tank', parts: templateRows(TEMPLATES.tk34) }; MP.startFlight(false);
    var dw = twin(dRows, 'drone', 1, RW + 330, 30);
    emit({ t: 'spawn', f: 1, name: 'Bumble', kind: 'drone', parts: dRows, c: 1 }); emit(snapOf(dw, 1, 1)); MP.beforeUpdate(0.016); var bare = !!MP.ghostOf(1, 1);
    emit({ t: 'spawn', f: 1, name: 'Bumble', kind: 'drone', parts: dRows, c: 2, bay: 'drFrameS' }); emit(snapOf(dw, 1, 2)); MP.beforeUpdate(0.016); var forged = !!MP.ghostOf(1, 2);
    emit({ t: 'spawn', f: 1, name: 'Bumble', kind: 'drone', parts: dRows, c: 3, bay: 'dockRack' }); emit(snapOf(dw, 1, 3)); MP.beforeUpdate(0.016); var named = !!MP.ghostOf(1, 3);`);
  t('drones (P4-MP-2): our drone\'s spawn names its bay; a player who never saw our tank builds a drone whose spawn names a real bay, not one with none or a forged one',
    A(`sp && sp.c === d.craft && sp.bay === 'dockRack'`) && B('!bare && !forged && named'), [A('sp && sp.bay'), B('[bare, forged, named]')]);
  // P4-MP-3: our drone bursting 3 m over a peer's tank sends the blast's hits with their direction (toward the burst)
  const C = await mk();
  C(`MP.addPlayer(2, 'Bea'); __design = { name: 'Nest', kind: 'tank', parts: templateRows(TEMPLATES.tk34).concat([{ type: 'dockRack', x: -2.1, y: 1.925, rot: 0, flip: false, att: 0 }]) };
    MP.startFlight(false); var me = Flight.active, tw = twin(tankRows, 'tank', 2, RW + 600, 0); emit({ t: 'spawn', f: 2, name: 'Bea', kind: 'tank', parts: tankRows }); emit(snapOf(tw, 2)); MP.beforeUpdate(0.016);
    var g = MP.peers.get(2).ghost, d = Drone.build(BUMBLE, 'Bumble'); d.x = g.x; d.y = g.y; d.z = g.z; up(d, 3); d.carrier = me; d.bay = me.docks[0]; me.drone = d; Flight.vessels.push(d); MP.sendExtra(d); Flight.active = d;
    Net.out = []; Drone.detonate(d, Flight, { x: d.x, y: d.y, z: d.z }, null, null, 'fuse');
    var H = sent('hit').map(([m]) => m), toB = (() => { const x = d.x - g.x, y = d.y - g.y, z = d.z - g.z, l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; })();
    var cosB = H.map((m) => (m.d ? m.d[0] * toB[0] + m.d[1] * toB[1] + m.d[2] * toB[2] : null));`);
  t('drones (P4-MP-3): our drone\'s burst over a peer\'s tank sends its hits pointing at the burst (their hit marker shows the drone, not our tank)',
    C('H.length > 0 && cosB.every((c) => c != null && c > 0.95)'), C('[H.length, cosB]'));
}

(async () => {
  await groundBattle();
  await roomDeaths();
  await roomWrecks();
  await roomDrones();
  await groundDrones();
  await roomDronesReview();
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
