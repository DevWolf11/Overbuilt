// A scripted multiplayer session, recorded step by step: for proving that the air battle (and the sandbox) behave
// exactly as before a change to mp.js. A host opens a 2v2 battle, three players join, settings change, players pick
// teams, spawns and kinds, the match runs through build, test, polish and battle (spawns, shoot-downs, crashes, a
// leaver), the result shows, then a second match runs out of time; then a sandbox with every kind. After each step it
// records the session state, every message sent (and to whom), the toasts, the flights started with their
// options, the builder's battle settings, and the money, limits and problems the builder would show.
//   const trace = require('./lib/mptrace.js')(G);   // -> { step: { state, out, toasts, ... } }
// Uses only what mp.js had before the ground update, so ROOT can point at an older checkout.
module.exports = async function mptrace(G) {
  const N = G.load({ mp: true, earth: false });
  const R = (code) => G.run(N, code);
  R(`var __T = 1000, __timers = [], __handlers = new Map(), __flights = [], __ls = new Map();
    var localStorage = { getItem: (k) => (__ls.has(k) ? __ls.get(k) : null), setItem: (k, v) => __ls.set(k, String(v)) };
    __ls.set('rss.mp.name', JSON.stringify('Hosty'));
    var setTimeout = (fn, ms) => { __timers.push([ms, fn]); return __timers.length; }, clearTimeout = () => {}, setInterval = () => 0, clearInterval = () => {};
    var navigator = {}, document = { hidden: false, addEventListener() {} }, isTouch = false;
    Object.assign(Net, { isHost: true, me: 1, code: 'TRACE', transport: 'local', pings: new Map([[2, 40], [3, 55], [4, 120]]), names: new Map(),
      hostNow: () => __T, host: async () => {}, lock() {}, leave() {}, on: (t, fn) => { if (!__handlers.has(t)) __handlers.set(t, []); __handlers.get(t).push(fn); } });
    var emit = (m) => { for (const fn of __handlers.get(m.t) || []) fn(m); };
    var MPUI = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}) });
    var App = { scene: 'mp', afterEarth: (fn) => fn(), showScene(s) { App.scene = s; }, showMP() { App.scene = 'mp'; }, toBuild() { App.scene = 'build'; }, toHome() { App.scene = 'home'; } };
    var Career = { data: { mode: 'career', funds: 123, tier: 2, done: {}, flights: 3 }, save() {} };
    UI.closeModal = () => {}; UI.modal = (o) => { (UI.modals = UI.modals || []).push(o.title); };
    Object.assign(Flight, { running: false, mp: null, vessels: [], time: 0, destroyed: false,
      start(design, opts) { __flights.push({ design: { name: design.name, kind: design.kind, n: design.parts.length }, opts: JSON.parse(JSON.stringify(opts, (k, v) => (k === 'carrier' ? v && v.name : v))) }); Flight.running = true; Flight.mp = opts.mp; Flight.destroyed = false; },
      stop() { Flight.running = false; }, summaryHTML: () => '', dist: () => 1e9, absPos: () => ({ b: EARTH, x: 0, y: 0, z: 0 }), camAbs: { b: EARTH, x: 0, y: 0, z: 0 } });
    var Combat = { S: { kills: 0 }, hpFrac: () => 1, maxHp: () => 100, reset() {}, shots: [] };
    var __design = { name: 'Bird', kind: 'plane', parts: templateRows(TEMPLATES.mustang) };
    Object.assign(Builder, { kind: 'plane', mp: null, ctrl: true, parts: [], attached: new Set(), statsData: { cost: 30000 },
      serialize: () => JSON.parse(JSON.stringify(__design)), renderKind() {}, buildPalette() {}, changed() {}, setKind(k) { Builder.kind = k; },
      loadDesign() {}, loadTemplate() {}, designs: () => [], markSaved() {}, renderLaunch() {} });`);
  const trace = {};
  let n = 0;
  const step = (name, code) => {
    let err = null;
    try { if (code) R(code); } catch (e) { err = String(e && e.message); }
    trace[String(++n).padStart(2, '0') + ' ' + name] = R(`(() => {
      const s = MP.state, o = { state: s ? JSON.parse(JSON.stringify(s)) : null, out: (Net.out || []).map((x) => JSON.stringify(x)), toasts: UI.toasts || [], modals: UI.modals || [],
        flights: __flights.slice(), timers: __timers.map((t) => t[0]), builderMp: Builder.mp ? JSON.parse(JSON.stringify(Builder.mp)) : null, kind: Builder.kind,
        spawnId: MP.spawnId, myDesign: MP.myDesign ? [MP.myDesign.name, MP.myDesign.kind, MP.myDesign.parts.length] : null, career: [Career.data.mode, Career.data.funds] };
      Net.out = []; UI.toasts = []; UI.modals = []; __flights.length = 0;
      return o; })()`);
    if (err) trace[String(n).padStart(2, '0') + ' ' + name].err = err;
  };
  const flush = (ms = 1e9) => R(`(() => { const due = __timers.filter((t) => t[0] <= ${ms}); __timers = __timers.filter((t) => t[0] > ${ms}); for (const [, fn] of due) fn(); })()`);
  const at = (t) => R(`__T = ${t}`);

  // ---- a 2v2 air battle
  await R(`MP.host('pvp', 'local')`);
  step('host');
  step('three join', `emit({ t: 'join', pid: 2, name: 'Bea' }); emit({ t: 'join', pid: 3, name: 'Cid' }); emit({ t: 'join', pid: 4, name: 'Dot' });`);
  step('settings', `for (const [k, v] of [['format', '2v2'], ['budget', 120000], ['build', 300], ['test', true], ['carriers', true], ['ff', true], ['tod', 'dusk'], ['limit', 600], ['format', 'ffa'], ['format', '2v2'], ['ff', false]]) MP.setSetting(k, v);`);
  step('a client cannot set settings', `Net.isHost = false; MP.setSetting('budget', 45000); Net.isHost = true;`);
  step('rows', `for (const [pid, k, v] of [[2, 'team', 1], [3, 'team', 0], [4, 'team', 1], [2, 'name', 'Bea the Bold'], [3, 'name', ''], [4, 'kind', 'helicopterXYZ'], [2, 'ready', 1], [3, 'flying', 1], [4, 'dmg', 500], [2, 'cost', 1], [2, 'spawn', 'faroes'], [9, 'ready', true]]) emit({ t: 'set', f: pid, k, v });`);
  step('start', `MP.startMatch();`);
  flush();
  step('build');
  trace['build:numbers'] = R(`[MP.spawnsFor(MP.me).map((s) => s.id), MP.spawnsFor(MP.player(2)).map((s) => s.id), MP.defaultSpawn(), MP.budgetFor('carrierA'), MP.budgetFor('faroes'), MP.limitsFor('carrierA'), MP.limitsFor('shetland')]`);
  trace['build:problems'] = R(`(() => { const ps = (k) => partsFromDesign(templateRows(TEMPLATES[k])); const out = {};
    for (const [k, kind, sp] of [['mustang', 'plane', 'faroes'], ['jumbo', 'plane', 'faroes'], ['jumbo', 'plane', 'carrierA'], ['buggy', 'car', 'carrierA'], ['buggy', 'car', 'faroes'], ['hopper', 'rocket', 'faroes'], ['dragonfly', 'heli', 'carrierA'], ['fs15', 'plane', 'carrierA'], ['mustang', 'tank', 'faroes']]) {
      if (!TEMPLATES[k]) continue; MP.spawnId = sp; out[k + '/' + kind + '/' + sp] = MP.designProblems({ cost: designCost(ps(k)) }, ps(k), kind); }
    MP.spawnId = 'faroes'; return out; })()`);
  step('spawn picks', `emit({ t: 'set', f: 2, k: 'spawn', v: 'carrierB' }); emit({ t: 'set', f: 4, k: 'spawn', v: 'carrierA' }); emit({ t: 'set', f: 3, k: 'spawn', v: 'faroes' }); MP.setMine('spawn', 'carrierA'); MP.spawnId = 'carrierA';`);
  step('everyone ready', `for (const pid of [2, 3, 4]) emit({ t: 'set', f: pid, k: 'ready', v: true }); MP.toggleReady();`);
  at(400000); step('to test', `MP.tick();`);
  flush();
  step('test flight down', `Flight.destroyed = true; MP.onLocalDestroyed();`);
  flush();
  at(500000); step('to polish', `MP.advance();`);
  step('my design too big for the carrier', `__design = { name: 'Big', kind: 'plane', parts: templateRows(TEMPLATES.jumbo) }; MP.toggleReady(); MP.toggleReady();`);
  at(600000); step('to battle', `MP.advance();`);
  step('peers spawn', `for (const [pid, k] of [[2, 'skylark'], [3, 'camel'], [4, 'dragonfly']]) emit({ t: 'spawn', f: pid, name: k, kind: TEMPLATES[k].kind, parts: templateRows(TEMPLATES[k]).map((q, i) => [i + 1, q.type, q.x, q.y, q.rot, q.flip ? 1 : 0, 0, 0, 0]) });`);
  step('placements', ``);
  trace['battle:placements'] = R(`(() => { const out = {}; for (const sp of ['faroes', 'shetland', 'scotland', 'carrierA', 'carrierB']) for (const k of ['plane', 'heli', 'car']) { const p = MP.placement(sp, k); out[sp + '/' + k] = p && JSON.parse(JSON.stringify(p, (kk, v) => (kk === 'carrier' ? v && v.name : v))); } return out; })()`);
  step('a hit, a kill', `emit({ t: 'down', f: 2, by: 1, P: [1, 2, 3] });`);
  step('a crash', `emit({ t: 'down', f: 4, by: 4, P: [1, 2, 3] });`);
  flush();
  step('results', ``);
  step('back to the lobby', `MP.backToLobby();`);
  step('second match, no test flight', `MP.setSetting('test', false); MP.setSetting('format', '1v1'); MP.startMatch();`);
  flush();
  at(900000); step('battle again', `MP.tick();`);
  step('a leaver', `emit({ t: 'leave', pid: 3 });`);
  at(2000000); step('out of time', `MP.tick();`);
  flush();
  step('finish', ``);
  step('end', `MP.end();`);

  // ---- a sandbox: every kind's placement by slot, a respawn and a crash
  await R(`(Net.out = [], MP.host('sandbox', 'local'))`);
  step('sandbox host');
  step('sandbox joins', `emit({ t: 'join', pid: 2, name: 'Bea' }); emit({ t: 'join', pid: 3, name: 'Cid' });`);
  trace['sandbox:placements'] = R(`(() => { const out = {}; for (const me of [1, 2, 3]) { Net.me = me; for (const k of ['rocket', 'plane', 'heli', 'car']) out[me + '/' + k] = MP.placement(null, k); } Net.me = 1; return out; })()`);
  step('sandbox fly', `__design = { name: 'Buggy', kind: 'car', parts: templateRows(TEMPLATES.buggy) }; Builder.statsData = { cost: 5000 }; MP.launch();`);
  step('sandbox crash', `Flight.destroyed = true; Flight.active = { lastHitBy: null, com: { x: 0, y: 0, z: 0 }, toWorld: () => ({ x: 1, y: 2, z: 3 }) }; MP.onLocalDestroyed();`);
  flush();
  step('sandbox respawn', `Flight.destroyed = false; Flight.active = null; MP.respawn();`);
  step('sandbox end', `MP.end();`);
  return trace;
};
