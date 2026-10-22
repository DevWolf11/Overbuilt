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
t('measure: legacy template rows (makePart, no att) measure the same as through partsFromDesign', Object.keys(N.TEMPLATES).every((k) =>
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
(async () => {
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
