// Load the game's plain scripts into a Node VM context, headless: no DOM, no WebGL. The scripts are read from the
// repo (or from ROOT, to test another checkout) and run as they would in the page, so their globals land on the
// context. Pieces that need the page (effects, sound, settings) are stubbed.
//
//   const G = require('./lib/game.js');
//   const ctx = G.load({ combat: true });   // ctx.PARTS, ctx.Vessel, ctx.TEMPLATES, ctx.Combat, ...
//   const R = (code) => G.run(ctx, code);   // run code inside the game's scope
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.env.ROOT || path.join(__dirname, '..', '..'));
const src = (root, f) => fs.readFileSync(path.join(root, 'js', f), 'utf8');

// opts: root, earth (the real Earth map, default true), combat (combat.js with its internals on Combat._t),
// flight (world.js and flight.js), mp (mp.js with Net/UI/Flight stubs)
function load(opts = {}) {
  const root = opts.root || ROOT;
  const ctx = { console, Math: Object.create(Math), performance: { now: () => 0 } };
  vm.createContext(ctx);
  const run = (code, name) => vm.runInContext(code, ctx, { filename: name });
  run(src(root, 'util.js').replace(/const \$ =[\s\S]*$/, ''), 'util.js'); // the DOM helpers at its end need a page
  run(src(root, 'space.js'), 'space.js');
  run(src(root, 'terrain.js') + '\nthis.Terrain = Terrain;', 'terrain.js');
  if (opts.earth !== false) {
    ctx.__earth = require('./earth.js').layers();
    run('Terrain.setEarthData(__earth); delete this.__earth;');
  }
  run(src(root, 'parts.js'), 'parts.js');
  run(src(root, 'vessel.js'), 'vessel.js');
  if (opts.flight && opts.mp) throw new Error('load(): flight and mp stub each other out; load them in separate contexts');
  run('var Sound = new Proxy({}, { get: () => () => {} });');
  if (opts.flight) { // world.js brings the real Settings and FX
    run('var navigator = {}; var innerWidth = 800, innerHeight = 600;');
    run(src(root, 'world.js') + '\nthis.Settings = Settings; this.FX = FX; this.World = World;', 'world.js');
  } else {
    run(`var Settings = { get: (k) => ({ targets: 'hostile', high: false })[k] };
      var FX = { add() {}, explosion() {}, sparks() {}, puff() {}, splash() {}, clear() {}, list: [] };`);
  }
  if (opts.combat) {
    // expose the internals the tests poke at on Combat._t
    let cs = src(root, 'combat.js');
    const ret = '  return {\n    S, step,';
    if (!cs.includes(ret)) throw new Error("combat.js: its final 'return { S, step, ...' moved; update test/lib/game.js");
    const names = ['boxesOf', 'hitVessel', 'muzzle', 'explode', 'destroyPart', 'fireGun', 'fireRocket', 'launchMissile', 'dropBomb',
      'systems', 'playerFrame', 'spawnFighter', 'turretFire', 'release', 'nextStore', 'nextSide']
      .filter((n) => new RegExp(`function ${n}\\b|const ${n} =`).test(cs));
    cs = cs.replace(ret, `  return {\n    _t: { ${names.join(', ')} }, S, step,`);
    run(cs + '\nthis.Combat = Combat;', 'combat.js');
  }
  const b = src(root, 'builder.js');
  run(b.match(/const TEMPLATES = \{[\s\S]*?\n\};/)[0] + '\nthis.TEMPLATES = TEMPLATES;', 'builder.js (TEMPLATES)');
  const tr = b.match(/function templateRows\(t\) \{[\s\S]*?\n\}/);
  if (tr) run(tr[0], 'builder.js (templateRows)');
  if (!opts.combat) run(src(root, 'combat.js').match(/const RAIDER = \[[\s\S]*?\]\];/)[0] + '\nthis.RAIDER = RAIDER;', 'combat.js (RAIDER)');
  else run('this.RAIDER = RAIDER;');
  if (opts.flight) run(src(root, 'flight.js') + '\nthis.Flight = Flight;', 'flight.js');
  if (opts.mp) {
    run(src(root, 'career.js').match(/function money[^\n]*/)[0], 'career.js (money)');
    run(`var Net = { names: new Map(), isHost: false, me: 1, send(m, to) { (this.out = this.out || []).push([m, to]); } };
      var UI = { toast(t, k) { (this.toasts = this.toasts || []).push(t); } };
      var Flight = { running: false, mp: null, vessels: [] };
      var Builder = {};`);
    run(src(root, 'mp.js') + '\nthis.MP = MP;', 'mp.js');
  }
  // top-level const/let/class bindings aren't properties of the context: copy the common ones over
  for (const k of ['PARTS', 'SKINS', 'EARTH', 'MOON', 'BODIES', 'Vessel', 'VEHICLE_KINDS', 'PILOT', 'PART_Z_MAX', 'Terrain'])
    run(`if (typeof ${k} !== 'undefined') this.${k} = ${k};`);
  return ctx;
}
const run = (ctx, code) => vm.runInContext(code, ctx);

// A craft as Flight.start builds one from a design: rows are design rows ({type, x, y, rot, flip, z, att, skin},
// att an index) or template rows ([type, x, y, rot, extra]). Only the part tree holding the control part flies.
// The craft sits on its kind's launch site unless `at` is 'air' (3 km over the sea, level, still).
function craft(ctx, rows, kind = 'plane', at = 'site') {
  ctx.__rows = rows; ctx.__kind = kind; ctx.__at = at;
  return run(ctx, `(() => {
    const rows = __rows.map((r) => Array.isArray(r) ? { type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: r[1] < 0, ...(r[4] || {}) } : r);
    const parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
    const ps = parts.filter((p) => keep.has(p.id));
    for (const p of ps) if (p.att != null && !keep.has(p.att)) p.att = null;
    const adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
    const v = new Vessel(ps, adj, EARTH); v.kind = __kind; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups();
    v.of = parts.length;
    if (__at === 'air') { v.x = EARTH.radius + 3000; v.y = 0; v.z = 0; v.vx = v.vy = v.vz = 0; v.q = { w: 1, x: 0, y: 0, z: 0 }; }
    else { const K = VEHICLE_KINDS[v.kind]; v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[K.site].east), K.launchRot); }
    return v;
  })()`);
}
// a template's rows exactly as the builder loads it (templateRows), or the raw rows for old checkouts
const templateRows = (ctx, key) => (ctx.templateRows ? ctx.templateRows(ctx.TEMPLATES[key]) : ctx.TEMPLATES[key].parts);

// the stand-in for Flight a vessel's physics step reports to
function sim() {
  return { time: 0, target: null, toasts: [], broken: [], vessels: [], camAbs: { x: 0, y: 0, z: 0 },
    toast(t) { this.toasts.push(t); },
    ripParts(v, parts) {
      this.broken.push('rip:' + parts.map((p) => p.type).join(',') + '@' + v.gForce.toFixed(1) + 'g');
      for (const p of parts) { for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.get(p.id).clear(); }
      v.splitComponents(); v.rebuildGroups();
    },
    breakParts(v, parts, cause) {
      this.broken.push(cause + ':' + parts.map((p) => p.type).join(','));
      for (const p of parts) { v.parts = v.parts.filter((q) => q !== p); for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.delete(p.id); }
      if (!v.parts.length) { v.dead = true; return; }
      v.splitComponents(); v.rebuildGroups();
    } };
}
// light the next stage's engines
function stage(v) { for (const id of v.stages[v.stageIdx] || []) { const p = v.byId.get(id); if (p && p.def.thrust) p.active = true; } v.stageIdx++; }

// A check list: t(name, cond, extra) prints ok/FAIL; done() prints the tally and sets the exit code.
function checks(title) {
  let fails = 0, n = 0;
  if (title) console.log('# ' + title);
  const t = (name, cond, extra) => {
    n++; if (!cond) fails++;
    console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra !== undefined ? '   ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  };
  t.done = () => { console.log(fails ? `${fails} of ${n} FAILED` : `all ${n} passed`); if (fails) process.exitCode = 1; return fails; };
  return t;
}
module.exports = { ROOT, load, run, craft, templateRows, sim, stage, checks };
