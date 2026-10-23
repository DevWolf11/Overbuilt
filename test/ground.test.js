// The ground update (tanks and other armour). §contract (Phase 1): every old design stays out of the new code
// (counted), armour thickness rides the save path (rows, codes, spawn rows, saved flights) with the mass and price it
// brings, turret rings turn what sits on them (groups, poses), each hook hands the new parts to the new systems, and
// the new multiplayer messages leave the old ones as they were. The tests build small test parts of their own (keys
// 'tst…'), shaped like the catalogue's, so they hold whatever the catalogue holds; one tank of the catalogue's own
// parts then takes the same paths, where the parts meet the hooks.
//   node test/ground.test.js
const G = require('./lib/game.js'), fs = require('fs'), path = require('path');
const ctx = G.load({ combat: true, ground: true });
const R = (c) => G.run(ctx, c);
const t = G.checks('ground: §contract (Phase 1)');
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------- counters on every function of the new systems
const SYSTEMS = ['Gear', 'Aim', 'Armour', 'GroundMode', 'GroundAI'];
const wrap = (c) => G.run(c, `var CALLS = {}; for (const name of ${JSON.stringify(SYSTEMS)}) {
  if (typeof this[name] === 'undefined') continue;
  const o = this[name];
  for (const k of Object.keys(o)) if (typeof o[k] === 'function') { const f = o[k]; o[k] = function (...a) { CALLS[name + '.' + k] = (CALLS[name + '.' + k] || 0) + 1; return f.apply(this, a); }; }
}`);
wrap(ctx);
const calls = (c = ctx) => G.run(c, 'JSON.stringify(CALLS)');
t('the loader brings Gear, Aim, Armour, GroundMode and GroundAI', SYSTEMS.every((n) => !!ctx[n]), SYSTEMS.filter((n) => !ctx[n]).join());

// ---------------------------------------------------------------- old designs: zero calls into the new code
// 1. the traces script (every template, 12 s, the same stick script), with the weapons' step and frame alongside
// (the range's targets and fighters about, hostile), guns firing for a second. simOf: test/lib/game.js's stand-in for
// Flight, with the craft in its world.
R(`var near = (a, b, e = 1e-9) => Math.abs(a - b) <= e, most = 0;
var simOf = (v) => ({ time: 0, target: null, toasts: [], broken: [], vessels: [v], active: v, running: true, warpIdx: 1, firing: false, destroyed: false, camAbs: { x: 0, y: 0, z: 0 },
  toast(t) { this.toasts.push(t); },
  ripParts(v, parts) { this.broken.push('rip'); for (const p of parts) { for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.get(p.id).clear(); } v.splitComponents(); v.rebuildGroups(); },
  breakParts(v, parts) { this.broken.push('break'); for (const p of parts) { v.parts = v.parts.filter((q) => q !== p); for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.delete(p.id); }
    if (!v.parts.length) { v.dead = true; return; } v.splitComponents(); v.rebuildGroups(); } });
var oldRun = (v, F, secs, script) => {
  const dt = 1 / 120;
  for (let i = 0; i < secs / dt; i++) {
    script(v, i * dt, F, i);
    v.physicsStep(dt, F); Combat.step(dt, F); F.time += dt;
    if (i % 4 === 0) Combat.frame(F, dt * 4);
    most = Math.max(most, Combat.S.shots.length);
    if (v.dead || !v.parts.length) break;
  }
};`);
let traced = 0;
for (const key of Object.keys(ctx.TEMPLATES)) {
  const T = ctx.TEMPLATES[key];
  ctx.__v = G.craft(ctx, T.parts, T.kind || 'rocket');
  R(`(() => {
    const v = __v;
    if (v.kind === 'plane') {
      const r = v.radius() + 1500, u = { x: v.x / v.radius(), y: v.y / v.radius() };
      v.x = u.x * r; v.y = u.y * r; v.landed = false; v.vx = u.y * 110; v.vy = -u.x * 110;
      v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true;
    }
    for (const id of v.stages[v.stageIdx] || []) { const p = v.byId.get(id); if (p && p.def.thrust) p.active = true; } v.stageIdx++;
    v.throttle = 0.9;
    Combat.reset({});
    oldRun(v, simOf(v), 12, (v, tt, F, i) => {
      v.ctl.v = tt > 2 && tt < 4 ? -0.6 : 0; v.ctl.h = tt > 4 && tt < 5 ? 1 : tt > 7 && tt < 8 ? -0.7 : 0; v.ctl.r = tt > 9 && tt < 10 ? 0.5 : 0;
      if (v.kind !== 'plane' && tt > 6 && v.stageIdx < v.stages.length && i % 240 === 0) { for (const id of v.stages[v.stageIdx] || []) { const p = v.byId.get(id); if (p && p.def.thrust) p.active = true; } v.stageIdx++; }
      F.firing = tt > 3 && tt < 4;
    });
  })()`);
  traced++;
}
t(`the traces script with weapons (${traced} templates, up to ${R('most')} rounds in flight): no calls`, calls() === '{}' && R('most') > 0, calls());

// 2. the combat fingerprint's operations on every stock plane and the raider (boxes, muzzles, blasts, guns, flares,
// chaff, turrets), then every store fired and the rounds flown until they land; other players' shots and flares
R(`var Tt = Combat._t, fp = 0;
for (const key of Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].kind === 'plane').concat(['RAIDER'])) {
  const rows = key === 'RAIDER' ? RAIDER : TEMPLATES[key].parts;
  const ps = rows.map(([type, x, y, rot, o]) => makePart(type, x, y, Object.assign({ flip: x < 0, rot: rot || 0 }, o || {}, { att: null })));
  rows.forEach((r, i) => { const a = r[4] && r[4].att; if (Number.isInteger(a) && a !== i && ps[a]) ps[i].att = ps[a].id; });
  const adjAll = buildAdjacency(ps), ctrl = findControlPart(ps), keep = componentOf(ctrl.id, adjAll), kp = ps.filter((p) => keep.has(p.id)), adj = new Map();
  for (const p of kp) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const v = new Vessel(kp, adj, EARTH); v.kind = 'plane'; v.stages = computeStages(kp, adj, ctrl.id); v.rebuildGroups();
  v.x = EARTH.radius + 3000; v.y = 0; v.z = 0; v.vx = 200; v.vy = v.vz = 0; v.q = { w: 1, x: 0, y: 0, z: 0 };
  const F = simOf(v);
  for (const p of v.parts) { Tt.boxesOf(p); if (p.def.weapon) for (const s of [-1, 1]) Tt.muzzle(p, s); }
  for (const [x, y, z] of [[0, 6, 3], [1.5, 5, -4], [0, 2, 0], [-1, 10, 6], [2, 8, -2.5], [1, 12, 2.8]]) Combat.explode(EARTH, v.toWorld(x, y, z), 6, 100, null, F, true);
  for (const p of v.parts) if (p.def.weapon && p.def.weapon.kind === 'gun') { p.cool = 0; Tt.fireGun(v, p, 0.2, false, F); }
  if (v.parts.some((p) => p.def.weapon && p.def.weapon.kind === 'flare')) Combat.flares(v, F, true);
  if (v.parts.some((p) => p.def.weapon && p.def.weapon.kind === 'chaff')) Combat.chaff(v, F);
  for (const p of v.parts) if (p.def.weapon && p.def.weapon.kind === 'turret') { p.cool = 0; Tt.turretFire(v, p, 0.01, F, false, false); }
  for (const p of v.parts) {
    const w = p.def.weapon;
    if (!w || !(p.ammo > 0)) continue;
    if (w.kind === 'missile') Tt.launchMissile(v, p, null, F);
    else if (w.kind === 'rocket') Tt.fireRocket(v, p, false, F);
    else if (w.kind === 'bomb') Tt.dropBomb(v, p, F);
  }
  Combat.systems(v); Combat.status(v);
  for (let i = 0; i < 120 * 8 && Combat.S.shots.length; i++) { v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; }
  const g = { body: EARTH, remote: 9, parts: [], x: v.x, y: v.y, z: v.z, vx: 0, vy: 0, vz: 0 };
  Combat.netShot(g, { k: 'rocket', b: 'earth', P: [v.x, v.y, v.z], V: [10, 0, 0], D: [1, 0, 0] });
  Combat.netFlares(g, { P: [v.x, v.y, v.z], V: [0, 0, 0], chaff: 1 });
  for (const p of v.parts.slice()) if (v.parts.includes(p)) Combat.damage(v, p, 1e6, 'shot', F);
  Combat.reset(F); fp++;
}`);
t(`the combat fingerprint's operations (${R('fp')} craft): no calls`, calls() === '{}', calls());

// 3. a buggy drive on the runway: away, round a corner, back, braked to a stop
ctx.__v = G.craft(ctx, R('templateRows(TEMPLATES.buggy)'), 'car');
R(`var bug = __v; Combat.reset({});
oldRun(bug, simOf(bug), 14, (v, tt) => { v.ctl.v = tt < 6 ? 1 : tt < 9 ? 0 : tt < 11 ? -1 : 0; v.ctl.h = tt > 4 && tt < 6 ? 1 : 0; v.brake = tt > 11; });
var bugSaved = Vessel.restore(JSON.parse(JSON.stringify(bug.serialize())));`);
t('a buggy drive (and its saved flight): no calls', calls() === '{}' && R('bug.speed() < 1 && bugSaved.parts.length === bug.parts.length'), calls());

// 4. designs, codes and costs of every template
R(`for (const k in TEMPLATES) { const ps = partsFromDesign(templateRows(TEMPLATES[k])); designRows(ps); designCost(ps); designCost(templateRows(TEMPLATES[k])); }`);
t('rows and costs of every template: no calls', calls() === '{}', calls());
t('old vessels carry the new fields\' defaults (no gear, no groups, not plated)', R(`!bug.gv && bug.gear === NO_GEAR && bug.aimed === NO_GEAR && bug.tg === null && bug.tgOf === null && !bug.plated && Object.isFrozen(NO_GEAR)`));

// 5. multiplayer: an old craft's spawn rows out and back, and its ghost
const mp = G.load({ mp: true, earth: false });
wrap(mp);
const spawnOld = G.run(mp, `(() => {
  const out = [];
  for (const k in TEMPLATES) {
    const ps = partsFromDesign(templateRows(TEMPLATES[k])), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = TEMPLATES[k].kind || 'rocket'; v.rebuildGroups();
    Flight.active = v; MP.sendSpawn();
    const rows = Net.out[Net.out.length - 1][0].parts, clean = mpSpawnRows(rows);
    MP.peers.set(7, { design: { kind: v.kind, parts: clean }, gun: {}, ghost: null }); MP.buildGhost(7);
    out.push(rows.every((r) => r.length === 9) && clean.every((r) => r.length === 9) && MP.peers.get(7).ghost.mass === v.mass);
    MP.peers.delete(7);
  }
  return out.every(Boolean);
})()`);
t('old spawn rows keep their nine columns, and ghosts weigh what the craft does', spawnOld);
t('spawning and ghosting every template: no calls', calls(mp) === '{}', calls(mp));

// ---------------------------------------------------------------- the kinds
t('isGround: cars and armour, nothing else', R(`isGround('car') && isGround('tank') && !isGround('plane') && !isGround('heli') && !isGround('rocket') && !isGround(undefined)`));
t('the Armour kind: launches from the runway at rot 0 with its seven tabs', R(`(() => { const K = VEHICLE_KINDS.tank; return K.name === 'Armour' && K.site === 'runway' && K.launchRot === 0
  && K.cats.join() === 'hulls,turrets,drive,guns,launchers,crew,kit' && K.cats.every((c) => PART_CATEGORIES.some((q) => q.id === c)); })()`));
t('21 part categories, the seven new ones after Ground', R(`PART_CATEGORIES.length === 21 && PART_CATEGORIES.map((c) => c.id).slice(13).join() === 'ground,hulls,turrets,drive,guns,launchers,crew,kit'`));
t('PILOT.tank and a car-like drive frame', R(`!!PILOT.tank && PILOT.tank.F.x === 1 && PILOT.tank.U.y === 1`));

// ---------------------------------------------------------------- test parts (shaped like the catalogue's; §3.1, §3.5)
R(`var TST = {
  tstHull: { cat: 'hulls', name: 'Test Hull', gv: true, family: 'WWII', shape: 'thull', w: 5.6, h: 1.3, depth: 2.2, mass: 11, cost: 6500, tier: 1, control: 1, place: 'hull', hp: 1100,
    outline: [[-0.5, -0.5], [0.42, -0.5], [0.5, -0.1], [0.3, 0.5], [-0.5, 0.5]],
    armour: { mm: 45, min: 15, max: 120, edge: [0.5, 1, 1, 0.4, 0.8], z: 0.9 }, mods: [{ k: 'crew', role: 'driver', at: [0.3, 0, -0.2], r: 0.4, hp: 100 }, { k: 'ammo', at: [-0.1, -0.1, 0.2], r: 0.4, hp: 80, rounds: 20 }] },
  tstTrack: { cat: 'drive', name: 'Test Track', gv: true, shape: 'ttrack', w: 5.6, h: 1.0, depth: 0.5, mass: 3, cost: 2000, tier: 1, module: 'track', breakSpeed: 18, place: 'side', hp: 550,
    track: { r: 0.32, n: 3, travel: 0.25, vmax: 14, rev: 0.35, turn: 0.7, mu: 0.9, side: 0.6, crr: 0.035, load: 35 }, armour: { mm: 20 } },
  tstWheel: { cat: 'drive', name: 'Test Wheel', gv: true, shape: 'twheel', w: 1.3, h: 1.3, depth: 0.45, mass: 0.45, cost: 750, tier: 1, module: 'wheel', place: 'side', hp: 300,
    awheel: { r: 0.6, travel: 0.3, vmax: 26, mu: 0.75, side: 0.75, load: 6 } },
  tstEngine: { cat: 'drive', name: 'Test Engine', gv: true, shape: 'tkit', inner: true, flush: true, w: 1.6, h: 0.9, depth: 1.6, mass: 1.6, cost: 3500, tier: 1, module: 'engine', place: 'inside', hp: 350,
    engine: { kw: 450, fuel: 'diesel' } },
  tstRing: { cat: 'turrets', name: 'Test Ring', gv: true, shape: 'tring', w: 2.0, h: 0.2, depth: 2.0, mass: 0.6, cost: 2500, tier: 0, module: 'ring', place: 'roof', hp: 350, ring: { rate: 24, cap: 12 } },
  tstRingS: { cat: 'turrets', name: 'Test Small Ring', gv: true, shape: 'tring', w: 1.0, h: 0.1, depth: 1.0, mass: 0.1, cost: 1000, tier: 0, module: 'ring', place: 'roof', hp: 200, ring: { rate: 40, cap: 1, stab: 2 } },
  tstTurret: { cat: 'turrets', name: 'Test Turret', gv: true, shape: 'tturret', w: 2.9, h: 1.0, depth: 2.4, mass: 11, cost: 7000, tier: 2, control: 1, place: 'ring', hp: 1100,
    outline: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], armour: { mm: 100, min: 40, max: 200, edge: [0.3, 1, 0.4, 0.8], z: 0.8 } },
  tstCast: { cat: 'turrets', name: 'Test Cast Turret', gv: true, shape: 'tcast', w: 2.6, h: 0.95, depth: 2.6, mass: 6.5, cost: 6000, tier: 1, control: 1, place: 'ring', hp: 900,
    round: { slope: 25 }, armour: { mm: 90, min: 20, max: 160, mat: 'composite', round: { f: 1, s: 0.65, r: 0.55, t: 0.22 } } },
  tstGun: { cat: 'guns', name: 'Test Gun', gv: true, shape: 'tgun', w: 0.55, h: 4.6, depth: 0.9, mass: 1.6, cost: 6500, tier: 1, flush: true, place: 'front', module: 'breech', hp: 300,
    weapon: { kind: 'tgun', cal: 85, reload: 7, ammo: 6, shells: ['aphe85', 'he85'], each: 16 }, aim: { el: [-5, 22], elRate: 6, pivot: 0.18, disp: 0.3, stab: 0 } },
  tstMast: { cat: 'kit', name: 'Test Mast', gv: true, shape: 'tkit', w: 0.3, h: 1.5, depth: 0.3, mass: 0.2, cost: 100, tier: 0, hp: 100 },
  tstBox: { cat: 'kit', name: 'Test Box', gv: true, shape: 'tkit', w: 0.8, h: 0.5, depth: 0.8, mass: 0.3, cost: 100, tier: 0, hp: 100 },
};
for (const [k, d] of Object.entries(TST)) { d.type = k; d.maxTemp = d.maxTemp || 2000; PARTS[k] = d; }
// a tank: hull, two tracks, an engine inside, a ring on the roof, a turret on it and a gun in the turret's front
// (rot 3: barrel forward, its trunnion just inside the face); rows as the builder saves them (att: an index)
var TANK = [
  { type: 'tstHull', x: 0, y: 1.1, flip: false, rot: 0 },
  { type: 'tstTrack', x: 0, y: 0.5, flip: false, rot: 0, z: -1.35, att: 0 }, { type: 'tstTrack', x: 0, y: 0.5, flip: false, rot: 0, z: 1.35, att: 0 },
  { type: 'tstEngine', x: -1.8, y: 1.1, flip: true, rot: 0, att: 0 },
  { type: 'tstRing', x: 0.3, y: 1.85, flip: false, rot: 0, att: 0 }, { type: 'tstTurret', x: 0.3, y: 2.45, flip: false, rot: 0, att: 4 },
  { type: 'tstGun', x: 3.072, y: 2.45, flip: false, rot: 3, att: 5 }];
var vesselOf = (rows, kind = 'tank') => { const ps = partsFromDesign(rows), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = kind; v.rebuildGroups(); return v; };
var kg = (ps) => ps.reduce((s, p) => s + partKg(p), 0);`);

// ---------------------------------------------------------------- armour thickness: mm, its mass and price
t('cleanMm: 5 mm steps within the part\'s range', R(`cleanMm(62, PARTS.tstHull) === 60 && cleanMm(63, PARTS.tstHull) === 65 && cleanMm(1, PARTS.tstHull) === 15 && cleanMm(999, PARTS.tstHull) === 120`));
t('cleanMm: nothing for junk, for parts without armour, or armour that can\'t be dialled', R(`[NaN, Infinity, '50', null, undefined, {}].every((x) => cleanMm(x, PARTS.tstHull) === undefined)
  && Object.keys(PARTS).filter((k) => !k.startsWith('tst')).every((k) => cleanMm(50, PARTS[k]) === undefined || !!PARTS[k].armour) && cleanMm(20, PARTS.tstTrack) === undefined`));
const mpm = R('massPerMm(PARTS.tstTurret)'), want = 7.85e-3 * (2.9 * 2.4 * 0.3 + 1 * 2.4 * 1 + 2.9 * 2.4 * 0.4 + 1 * 2.4 * 0.8 + 2 * 2.9 * 1 * 0.8);
t('massPerMm: the plates\' area × edge factor (and both sides), as steel', near(mpm, want, 1e-12), [mpm, want]);
t('massPerMm: composite weighs 0.45 of steel; a round turret by bearing', near(R('massPerMm(PARTS.tstCast)'), 7.85e-3 * 0.45 * (Math.PI * 2.6 * 0.95 * (1 + 2 * 0.65 + 0.55) / 4 + Math.PI * 1.3 * 1.3 * 0.22), 1e-12));
t('armourMassT and armourCostDelta: thicker plate, more steel and money ($400 a tonne; $900 composite)', R(`near(armourMassT(PARTS.tstTurret, 150), 11 + massPerMm(PARTS.tstTurret) * 50)
  && armourCostDelta(PARTS.tstTurret, 150) === Math.round(massPerMm(PARTS.tstTurret) * 50 * 400) && armourCostDelta(PARTS.tstTurret, 100) === 0 && armourCostDelta(PARTS.tstTurret, 40) < 0
  && armourCostDelta(PARTS.tstCast, 160) === Math.round(massPerMm(PARTS.tstCast) * 70 * 900) && armourCostDelta(PARTS.tstHull, 'junk') === 0 && armourCostDelta(PARTS.cab, 50) === 0`));
t('old parts: partKg and designCost unchanged for every template (no mm anywhere)', R(`Object.keys(TEMPLATES).every((k) => {
  const ps = partsFromDesign(templateRows(TEMPLATES[k]));
  return ps.every((p) => p.mm === undefined && partKg(p) === p.def.mass * 1000 + p.fuel + (p.store || 0)) && designCost(ps) === ps.reduce((s, p) => s + p.def.cost, 0)
    && designRows(ps).every((q) => !('mm' in q));
})`));
t('a mm on an old part (a forged row) is dropped', R(`partsFromDesign([{ type: 'cab', x: 0, y: 0, mm: 50 }])[0].mm === undefined`));
t('findControlPart passes over a knocked-out crew', R(`(() => { const ps = partsFromDesign(TANK), h = ps[0], tu = ps[5]; const a = findControlPart(ps) === h; h.ko = true; const b = findControlPart(ps) === tu; tu.ko = true; return a && b && findControlPart(ps) === null; })()`));

// ---------------------------------------------------------------- the round trip: rows <-> RSS3 code <-> spawn rows <-> saved flight
const bsrc = fs.readFileSync(path.join(G.ROOT, 'js', 'builder.js'), 'utf8');
const method = (name) => { const m = bsrc.match(new RegExp(`\\n  ${name}\\([a-z]*\\) \\{[\\s\\S]*?\\n  \\},`)); if (!m) throw new Error(`builder.js: ${name} not found`); return m[0]; };
Object.assign(ctx, { TextEncoder, TextDecoder, btoa, atob });
R(`var Codes = {${method('designCode')}${method('parseCode')}};
// designCode as it was before the ground update, to prove old designs keep their codes
var oldCode = (d) => {
  let ext = false;
  const rows = d.parts.map((q) => { const r = [q.type, q.x, q.y, q.flip ? 1 : 0, q.rot || 0], more = [q.z ?? null, q.att ?? null, q.skin ?? null];
    while (more.length && more[more.length - 1] == null) more.pop(); if (more.length) { ext = true; r.push(...more); } return r; });
  const bytes = new TextEncoder().encode(JSON.stringify({ n: d.name, k: d.kind || 'rocket', p: rows }));
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return (ext ? 'RSS2.' : 'RSS1.') + btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
};`);
t('every template keeps its RSS1/RSS2 code, byte for byte', R(`Object.keys(TEMPLATES).every((k) => { const d = { name: TEMPLATES[k].name, kind: TEMPLATES[k].kind, parts: designRows(partsFromDesign(templateRows(TEMPLATES[k]))) };
  const c = Codes.designCode(d); return c === oldCode(d) && /^RSS[12]\\./.test(c); })`));
R(`var tps = partsFromDesign(TANK); tps[0].mm = 60; tps[5].mm = 150; var trows = designRows(tps), tmass = kg(tps);`);
t('designRows writes mm only where it was dialled', R(`trows[0].mm === 60 && trows[5].mm === 150 && trows.filter((q) => 'mm' in q).length === 2`));
t('rows -> parts: the same mass (the thicker plates included)', R(`near(kg(partsFromDesign(trows)), tmass) && tmass > kg(partsFromDesign(TANK)) + 5000`), R('[tmass, kg(partsFromDesign(TANK))]'));
t('designCost: the dialled armour\'s price', R(`designCost(tps) === designCost(partsFromDesign(TANK)) + armourCostDelta(PARTS.tstHull, 60) + armourCostDelta(PARTS.tstTurret, 150) && designCost(trows) === designCost(tps)`));
R(`var code = Codes.designCode({ name: 'T', kind: 'tank', parts: trows }), back = Codes.parseCode(code);`);
t('an RSS3 code only when some row has mm, and it reads back with the same mass', R(`code.startsWith('RSS3.') && back && back.kind === 'tank' && near(kg(partsFromDesign(back.parts)), tmass)
  && Codes.designCode({ name: 'T', kind: 'tank', parts: designRows(partsFromDesign(TANK)) }).startsWith('RSS2.')`), R('code.slice(0, 12)'));
t('an older version\'s reader (RSS1/RSS2 only) refuses an RSS3 code cleanly', R(`!/RSS[12]\\.([A-Za-z0-9_-]+)/.exec(code)`));
t('a code\'s mm goes through cleanMm (forged: clamped; anything but a number is junk, as in spawn rows and saves: the nominal plate)', R(`(() => {
  const raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.slice(5).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
  const read = (a, b) => { raw.p[0][8] = a; raw.p[5][8] = b; const forged = 'RSS3.' + btoa(JSON.stringify(raw)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); return partsFromDesign(Codes.parseCode(forged).parts); };
  const ps = read(1e9, 'x');
  return ps[0].mm === 120 && ps[5].mm === undefined && [['70', [150]], [false, ''], [true, []], [' 70 ', '0x46']].every(([a, b]) => { const q = read(a, b); return q[0].mm === undefined && q[5].mm === undefined; }); })()`));
// spawn rows (a peer's copy) and its ghost
G.run(mp, `${R(`'var TST = ' + JSON.stringify(TST, (k, v) => (k === 'type' || k === 'maxTemp' ? undefined : v))`)}; for (const [k, d] of Object.entries(TST)) { d.type = k; d.maxTemp = 2000; PARTS[k] = d; }`);
mp.__trows = R('trows');
const sp = G.run(mp, `(() => {
  const ps = partsFromDesign(__trows), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'tank'; v.rebuildGroups();
  Flight.active = v; MP.sendSpawn();
  const rows = Net.out[Net.out.length - 1][0].parts, clean = mpSpawnRows(rows);
  MP.peers.set(8, { design: { kind: 'tank', parts: clean }, gun: {}, ghost: null }); MP.buildGhost(8);
  const g = MP.peers.get(8).ghost;
  const forged = mpSpawnRows(rows.map((r, i) => (i === 0 ? [...r.slice(0, 9), 1e9] : i === 1 ? [...r.slice(0, 9), 50] : r)));
  return { cols: rows.map((r) => r.length).join(), mm: rows.filter((r) => r.length === 10).map((r) => r[9]).join(), ghost: g.mass, v: v.mass, plated: g.plated, groups: g.tg.length,
    forged: [forged[0][9], forged[1].length].join() };
})()`);
t('spawn rows carry mm in a tenth column (only where dialled)', sp.cols === '10,9,9,9,9,10,9' && sp.mm === '60,150', JSON.stringify(sp));
t('the ghost weighs what the craft does, and turns its turret the same', near(sp.ghost, sp.v, 1e-9) && sp.plated && sp.groups === 1, JSON.stringify(sp));
t('a peer\'s forged mm is clamped, and dropped on a part without dialable armour', sp.forged === '120,9', sp.forged);
// a saved flight
R(`var tv = vesselOf(trows); tv.parts[4].aimYaw = 0.7; tv.parts[6].aimYaw = 0.05; tv.parts[6].aimEl = 0.1; tv.parts[1].broken = true; tv.parts[6].shellSel = 1; tv.parts[6].stow = 3;
  tv.parts[0].mods = [100, 12.5];
  var saved = JSON.parse(JSON.stringify(tv.serialize())), back2 = Vessel.restore(saved);`);
t('a saved flight: the same mass, the turret where it was, a broken track still broken', R(`near(back2.mass, tv.mass) && back2.parts[0].mm === 60 && back2.parts[5].mm === 150 && back2.parts[4].aimYaw === 0.7
  && back2.parts[6].aimEl === 0.1 && back2.parts[1].broken === true && back2.parts[6].shellSel === 1 && back2.parts[6].stow === 3 && back2.parts[0].mods.join() === '100,12.5' && back2.tg.length === 1`),
  R(`JSON.stringify([back2.mass - tv.mass, ...['mm', 'aimYaw', 'aimEl', 'broken', 'shellSel', 'stow', 'mods'].map((k) => back2.parts.map((p) => p[k]))])`));
t('an old part saves exactly the fields it did', R(`(() => { const o = bug.serialize().parts[0]; return Object.keys(o).join() === 'id,type,x,y,z,att,skin,rot,flip,fuel,active,deployed,used,fired,temp,flameout,hp,ammo,store'; })()`));
t('restore sanitises: junk angles dropped, mm clamped, mods trimmed, the new fields kept off old parts', R(`(() => {
  const d = JSON.parse(JSON.stringify(saved)); const q = d.parts;
  q[4].aimYaw = 'x'; q[6].aimEl = 99; q[0].mm = 1e9; q[0].mods = [5, 'x', 7, 9]; q[6].shellSel = 7; q[1].broken = 'yes'; q[6].stow = -4;
  const bq = JSON.parse(JSON.stringify(bug.serialize())); bq.parts[0].mm = 50; bq.parts[0].ko = true; bq.parts[0].aimYaw = 3;
  const a = Vessel.restore(d), b = Vessel.restore(bq);
  return a.parts[4].aimYaw === undefined && near(a.parts[6].aimEl, Math.PI / 2) && a.parts[0].mm === 120 && a.parts[0].mods.join() === '5,' && a.parts[6].shellSel === undefined
    && a.parts[1].broken === true && a.parts[6].stow === 0 && !('mm' in b.parts[0]) && !('ko' in b.parts[0]) && !('aimYaw' in b.parts[0]) && !!b.control;
})()`), R(`(() => { const d = JSON.parse(JSON.stringify(saved)); const q = d.parts;
  q[4].aimYaw = 'x'; q[6].aimEl = 99; q[0].mm = 1e9; q[0].mods = [5, 'x', 7, 9]; q[6].shellSel = 7; q[1].broken = 'yes'; q[6].stow = -4; const a = Vessel.restore(d);
  return JSON.stringify(['mm', 'aimYaw', 'aimEl', 'broken', 'shellSel', 'stow', 'mods'].map((k) => a.parts.map((p) => p[k]))); })()`));

// ---------------------------------------------------------------- a ground-update craft: gear points, hull, groups
R(`var tk = vesselOf(TANK);`);
t('the tank: gv, plated, its two tracks as running gear, its gun aimed, one turret group', R(`tk.gv && tk.plated && tk.gear.length === 2 && tk.gear.every((p) => p.type === 'tstTrack') && tk.aimed.length === 1 && tk.aimed[0].type === 'tstGun' && tk.tg.length === 1`));
t('Gear.points: three per track along the belt, the sag in the radius, sides by depth', R(`(() => {
  const g = tk.wheelPts.filter((k) => k.gear); if (g.length !== 6) return false;
  const L = g.filter((k) => k.side === -1), Rr = g.filter((k) => k.side === 1), d = PARTS.tstTrack;
  return L.length === 3 && Rr.length === 3 && L.every((k) => k.z === -1.35) && near(Rr[0].x, -0.4 * d.w) && near(Rr[2].x, 0.4 * d.w) && near(Rr[1].x, 0)
    && g.every((k) => near(k.y, 0.5 - d.h / 2 + d.track.r) && near(k.r, d.track.r + 0.4 * d.track.travel)) && g.map((k) => k.i).join() === '0,1,2,0,1,2';
})()`));
t('an armoured wheel: one point at its centre', R(`(() => { const ps = partsFromDesign([{ type: 'tstWheel', x: 1, y: 0.65, z: 1 }]); const w = []; Gear.points(ps[0], w); return w.length === 1 && w[0].x === 1 && w[0].y === 0.65 && w[0].z === 1 && near(w[0].r, 0.72) && w[0].side === 1; })()`));
t('the hull: outline corners for the hull and turret, none for the engine inside, none for tracks', R(`(() => {
  const by = (t) => tk.hull.filter((k) => k.p.type === t).length;
  const hc = tk.hull.filter((k) => k.p.type === 'tstHull'), o = PARTS.tstHull.outline;
  return by('tstHull') === 10 && by('tstTurret') === 8 && by('tstEngine') === 0 && by('tstTrack') === 0 && by('tstRing') === 8 && by('tstGun') === 8
    && o.every(([fx, fy]) => hc.some((k) => near(k.x, fx * 5.6) && near(k.y, 1.1 + fy * 1.3) && near(Math.abs(k.z), 1.1)));
})()`));
t('a wing part doesn\'t make armour an aircraft (a car it still does)', R(`(() => { const rows = [...TANK, { type: 'wingS', x: -2.6, y: 2.625, flip: true, rot: 0, att: 0 }], v = vesselOf(rows), c = vesselOf(rows, 'car');
  return v.wings.length === 1 && !v.aircraft && c.aircraft; })()`));
t('the body box: what doesn\'t turn (hull, tracks, ring)', R(`(() => { const B = tk.bodyBox; return near(B.minX, -2.8) && near(B.maxX, 2.8) && near(B.minY, 0) && near(B.maxY, 1.95) && near(B.minZ, -1.6) && near(B.maxZ, 1.6); })()`));

// turret groups on hand-built rings
R(`var grp = (rows) => { const ps = partsFromDesign(rows); return { ps, tg: Aim.groupsOfParts(ps, buildAdjacency(ps)) }; };
var typesOf = (g) => g.members.map((p) => p.type).join();`);
t('a ring turns the turret on it and the gun in the turret (and nothing below its top)', R(`(() => { const { ps, tg } = grp(TANK), g = tg[0], ring = ps[4];
  return tg.length === 1 && g.ring === ring && typesOf(g) === 'tstTurret,tstGun' && !g.jam && !g.parent && near(g.c.x, 0.3) && near(g.c.y, 1.95) && g.c.z === 0
    && near(g.mass, (partKg(ps[5]) + partKg(ps[6])) / 1000) && near(g.rate, 24 * Math.PI / 180 * Math.sqrt(12 / g.mass)) && g.stab === 0 && g.yawLim === null && g.dep === null; })()`),
  R(`JSON.stringify(grp(TANK).tg.map((g) => [typesOf(g), g.jam, g.c, g.mass, g.rate]))`));
t('a part hanging (att) on the turret below the ring\'s top turns with it', R(`(() => { const { tg } = grp([...TANK, { type: 'tstBox', x: -1.55, y: 2.05, rot: 0, att: 5 }]); return typesOf(tg[0]) === 'tstTurret,tstGun,tstBox' && !tg[0].jam; })()`));
t('a mast on the hull touching the turret jams the ring (it names both)', R(`(() => { const { ps, tg } = grp([...TANK, { type: 'tstMast', x: -1.3, y: 2.5, rot: 0 }]); const j = tg[0].jam;
  return !!j && j[0] === ps[5].id && j[1] === ps[7].id; })()`), R(`JSON.stringify(grp([...TANK, { type: 'tstMast', x: -1.3, y: 2.5, rot: 0 }]).tg[0].jam)`));
t('a heavy turret turns slower, never below 0.35 of the ring\'s rate', R(`(() => { const { tg } = grp(TANK.map((q) => (q.type === 'tstTurret' ? { ...q, mm: 200 } : q))); const g = tg[0];
  return g.mass > 12.7 && near(g.rate, 24 * Math.PI / 180 * Math.max(0.35, Math.sqrt(12 / g.mass))); })()`));
R(`var NEST = [...TANK, { type: 'tstRingS', x: 0, y: 3.0, rot: 0, att: 5 }, { type: 'tstBox', x: 0, y: 3.3, rot: 0, att: 7 }, { type: 'tstRingS', x: 0, y: 3.6, rot: 0, att: 8 }, { type: 'tstBox', x: 0, y: 3.9, rot: 0, att: 9 }];`);
t('rings nest: a cupola ring on the turret is its own group riding on the turret\'s; a third level stays fixed', R(`(() => { const { ps, tg } = grp(NEST);
  return tg.length === 2 && tg[0].ring === ps[4] && !tg[0].parent && tg[1].ring === ps[7] && tg[1].parent === tg[0] && typesOf(tg[0]) === 'tstTurret,tstGun,tstRingS,tstBox,tstRingS,tstBox'
    && typesOf(tg[1]) === 'tstBox,tstRingS,tstBox' && tg[1].stab === 2; })()`));
t('a ring not standing upright (rot 1) is no turret ring', R(`grp(TANK.map((q) => (q.type === 'tstRing' ? { ...q, rot: 1 } : q))).tg.length === 0`));
t('groups come out the same from the same rows (builder, craft, ghost)', R(`JSON.stringify(grp(NEST).tg.map((g) => [g.ring.type, typesOf(g), g.mass, g.rate, !!g.parent]))
  === JSON.stringify(vesselOf(NEST).tg.map((g) => [g.ring.type, typesOf(g), g.mass, g.rate, !!g.parent]))`));
t('tgOf: each turning part\'s innermost group', R(`(() => { const v = vesselOf(NEST), P = v.parts; return v.tgOf.get(P[5].id) === v.tg[0] && v.tgOf.get(P[6].id) === v.tg[0] && v.tgOf.get(P[10].id) === v.tg[1] && !v.tgOf.has(P[0].id) && !v.tgOf.has(P[4].id); })()`));

// poses
R(`var nv = vesselOf(NEST), NP = nv.parts; NP[4].aimYaw = 0.7; NP[7].aimYaw = -0.4;
var o = v3(), o2 = v3(), dev = 0;
for (const p of NP) for (const P of [{ x: p.x + 0.3, y: p.y - 0.2, z: partZ(p) + 0.1 }, { x: p.x - 1, y: p.y + 0.4, z: partZ(p) - 0.7 }]) {
  Aim.pose(nv, p, P, o); Aim.unpose(nv, p, o, o2); dev = Math.max(dev, Math.hypot(o2.x - P.x, o2.y - P.y, o2.z - P.z));
}`);
t('pose then unpose gives the point back (every part, two levels)', R('dev < 1e-12'), R('dev'));
t('pose: a part that doesn\'t turn stays put; one on the turret swings round the ring\'s axis, keeping its height', R(`(() => {
  const P = { x: 2, y: 1, z: 0.5 }, h = Aim.pose(nv, NP[0], P, v3()), c = nv.tg[0].c, T = { x: 2, y: 2.5, z: 0.5 }, q = Aim.pose(nv, NP[5], T, v3());
  const a0 = Math.atan2(T.z - c.z, T.x - c.x), a1 = Math.atan2(q.z - c.z, q.x - c.x);
  return h.x === 2 && h.y === 1 && h.z === 0.5 && q.y === 2.5 && near(Math.hypot(q.x - c.x, q.z - c.z), Math.hypot(T.x - c.x, T.z - c.z), 1e-12) && near(a1 - a0, 0.7, 1e-12);
})()`));
t('pose: two levels compose, the cupola\'s turn first, then the turret\'s', R(`(() => {
  const P = { x: 0.6, y: 3.9, z: 0.2 }, q = Aim.pose(nv, NP[10], P, v3()), c1 = nv.tg[0].c, c2 = nv.tg[1].c;
  const t2 = (p, c, a) => ({ x: c.x + (p.x - c.x) * Math.cos(a) - (p.z - c.z) * Math.sin(a), y: p.y, z: c.z + (p.x - c.x) * Math.sin(a) + (p.z - c.z) * Math.cos(a) });
  const w = t2(t2(P, c2, -0.4), c1, 0.7); return near(q.x, w.x, 1e-12) && near(q.z, w.z, 1e-12);
})()`));
R(`var gun = tk.parts[6], ring = tk.parts[4], s = v3(), m = v3(), tr = v3();
tk.x = EARTH.radius + 100; tk.y = 0; tk.z = 0; tk.q = qnorm(quat(0.9, 0.1, -0.3, 0.2));
var L = gun.def.h - gun.def.aim.pivot * gun.def.h, fwd = tk.axis(1, 0, 0), right = tk.axis(0, 0, 1);`);
t('dir: a rot-3 gun at rest points along the hull\'s nose; the ring at 90° turns it to the right', R(`(() => {
  ring.aimYaw = 0; gun.aimYaw = 0; gun.aimEl = 0; Aim.dir(tk, gun, s); const a = Math.hypot(s.x - fwd.x, s.y - fwd.y, s.z - fwd.z) < 1e-12;
  ring.aimYaw = Math.PI / 2; Aim.dir(tk, gun, s); const b = Math.hypot(s.x - right.x, s.y - right.y, s.z - right.z) < 1e-12; ring.aimYaw = 0; return a && b; })()`));
t('dir: elevation raises the barrel (+el up), the gun\'s own yaw turns it right', R(`(() => {
  gun.aimEl = 0.2; Aim.dir(tk, gun, s); const up = tk.axis(0, 1, 0), e = tk.axis(Math.cos(0.2), Math.sin(0.2), 0);
  gun.aimEl = 0; gun.aimYaw = 0.1; Aim.dir(tk, gun, m); const y = tk.axis(Math.cos(0.1), 0, Math.sin(0.1)); gun.aimYaw = 0;
  return Math.hypot(s.x - e.x, s.y - e.y, s.z - e.z) < 1e-12 && Math.hypot(m.x - y.x, m.y - y.y, m.z - y.z) < 1e-12 && dot3(s, up) > 0; })()`));
t('trunnion and muzzle: at rest the muzzle is the barrel\'s tip; turned and raised, it stays one barrel from the trunnion', R(`(() => {
  Aim.muzzle(tk, gun, m); Aim.trunnion(tk, gun, tr); const tip = tk.toWorld(gun.x + gun.def.h / 2, gun.y, 0), T0 = tk.toWorld(gun.x + (-gun.def.h / 2 + gun.def.aim.pivot * gun.def.h), gun.y, 0);
  const a = Math.hypot(m.x - tip.x, m.y - tip.y, m.z - tip.z) < 1e-9 && Math.hypot(tr.x - T0.x, tr.y - T0.y, tr.z - T0.z) < 1e-9;
  ring.aimYaw = 1.1; gun.aimEl = 0.3; Aim.muzzle(tk, gun, m); Aim.trunnion(tk, gun, tr); Aim.dir(tk, gun, s);
  const b = near(Math.hypot(m.x - tr.x, m.y - tr.y, m.z - tr.z), L, 1e-9) && near((m.x - tr.x) / L, s.x, 1e-9) && near((m.y - tr.y) / L, s.y, 1e-9) && near((m.z - tr.z) / L, s.z, 1e-9);
  const pt = Aim.pose(tk, gun, { x: gun.x - gun.def.h / 2 + gun.def.aim.pivot * gun.def.h, y: gun.y, z: 0 }, v3()), pw = tk.toWorld(pt.x, pt.y, pt.z);
  ring.aimYaw = 0; gun.aimEl = 0; return a && b && Math.hypot(tr.x - pw.x, tr.y - pw.y, tr.z - pw.z) < 1e-9; })()`));
t('an aimed part\'s own traverse turns it about its trunnion (the pintle, the ball mount): the trunnion stays put, the muzzle swings one barrel out (2D\'s yaw node and 2B\'s hit prism turn there too)', R(`(() => {
  ring.aimYaw = 0.4; gun.aimEl = 0.1; gun.aimYaw = 0; Aim.trunnion(tk, gun, tr); const t0 = { x: tr.x, y: tr.y, z: tr.z };
  let ok = true;
  for (const yaw of [0.35, Math.PI / 2, Math.PI]) { gun.aimYaw = yaw; Aim.trunnion(tk, gun, tr); Aim.muzzle(tk, gun, m); Aim.dir(tk, gun, s);
    ok = ok && Math.hypot(tr.x - t0.x, tr.y - t0.y, tr.z - t0.z) < 1e-9 && Math.hypot(m.x - tr.x - s.x * L, m.y - tr.y - s.y * L, m.z - tr.z - s.z * L) < 1e-9; }
  ring.aimYaw = 0; gun.aimYaw = 0; gun.aimEl = 0; return ok; })()`));
t('sightPoint: over the main gun\'s trunnion, turning with its turret', R(`(() => {
  const want = (yaw) => { ring.aimYaw = yaw; const q = Aim.pose(tk, gun, { x: gun.x - gun.def.h / 2 + gun.def.aim.pivot * gun.def.h, y: gun.y + 0.35, z: 0.3 }, v3()); return tk.toWorld(q.x, q.y, q.z); };
  let ok = true; for (const yaw of [0, 0.8, -2]) { const w = want(yaw); Aim.sightPoint(tk, s); ok = ok && Math.hypot(s.x - w.x, s.y - w.y, s.z - w.z) < 1e-9; }
  ring.aimYaw = 0; return ok; })()`));
t('poses on a craft with no groups (an old craft) are the identity', R(`(() => { const p = bug.parts[0], q = Aim.pose(bug, p, { x: 1, y: 2, z: 3 }, v3()), u = Aim.unpose(bug, p, { x: 1, y: 2, z: 3 }, v3()); return q.x === 1 && q.y === 2 && q.z === 3 && u.x === 1 && u.z === 3; })()`));

// ---------------------------------------------------------------- before rebuildGroups, and the impulse
t('a vessel before rebuildGroups: the new fields\' defaults; the weapons\' step and frame, a blast and a round run with it', R(`(() => {
  const ps = partsFromDesign(TANK), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'tank'; v.x = EARTH.radius + 2000;
  const d = !v.gv && v.gear.length === 0 && v.aimed.length === 0 && v.tg === null && v.tgOf === null && !v.plated;
  const F = simOf(v); F.firing = true;
  for (let i = 0; i < 12; i++) { Combat.step(1 / 120, F); Combat.frame(F, 1 / 120); }
  const q = Aim.pose(v, ps[5], { x: 1, y: 2, z: 3 }, v3());
  Combat.explode(EARTH, v.toWorld(0, 1.1, 1.5), 4, 50, null, F, true);
  const w = v.toWorld(0, 1.1, 0), s = { k: 'bullet', b: EARTH, x: w.x, y: w.y - 40, z: w.z, vx: 0, vy: 900, vz: 0, t: 0, life: 2.5, dmg: 5, blast: 0, owner: null, enemy: true, net: 0 };
  for (let i = 0; i < 20 && Combat._t.moveShot(s, 1 / 120, F); i++);
  return d && q.x === 1 && v.parts.some((p) => p.hp != null);
})()`));
t('applyImpulse: momentum j along dir, and spin about the centre of mass', R(`(() => {
  const v = vesselOf(TANK); v.vx = v.vy = v.vz = 0; v.av = v3(); v.q = quat(); const d = v3(0, 1, 0), j = 5000;
  v.applyImpulse({ x: v.com.x + 2, y: v.com.y, z: v.com.z }, d, j);
  const w = v.mulInvI(v3(0, 0, 2 * j));
  return near(v.vy * v.mass, j, 1e-6) && v.vx === 0 && near(v.av.z, w.z, 1e-12) && near(v.av.x, w.x, 1e-12);
})()`));

// ---------------------------------------------------------------- the hooks: each hands the new parts to the new systems
R(`var cnt = (k) => CALLS[k] || 0, Tt = Combat._t;
TST.tstSmoke = PARTS.tstSmoke = { type: 'tstSmoke', maxTemp: 2000, cat: 'kit', name: 'Test Smoke', gv: true, shape: 'tkit', w: 0.5, h: 0.5, depth: 0.4, mass: 0.05, cost: 800, tier: 0, place: 'flank', weapon: { kind: 'smoke', ammo: 2, salvo: 3 } };
// a tank up in the air (part axes = sim axes), and a round fired at a part-space point along sim y from 60 m off
var air = (rows = TANK) => { const v = vesselOf(rows); v.x = EARTH.radius + 2500; v.y = 0; v.z = 0; v.vx = v.vy = v.vz = 0; v.q = quat(); v.av = v3(); return v; };
var round = (v, P, dir, dmg = 10) => { const w = v.toWorld(P.x, P.y, P.z || 0); return { k: 'bullet', b: EARTH, x: w.x, y: w.y - 60 * dir, z: w.z, vx: 0, vy: 900 * dir, vz: 0, t: 0, life: 2.5, dmg, blast: 0, owner: null, enemy: true, net: 0 }; };
var fly = (s, F) => { for (let i = 0; i < 240; i++) if (!Tt.moveShot(s, 1 / 120, F)) return i; return -1; };`);
t('maxHp: a part\'s own hp when it has one (old parts: the formula)', R(`Combat.maxHp(PARTS.tstHull) === 1100 && Combat.maxHp(PARTS.cab) === Math.round((60 + 220 * Math.sqrt(PARTS.cab.mass + (PARTS.cab.fuel || 0) * 0.25)) * (PARTS.cab.control ? 1.4 : 1))`));
t('the weapon systems leave smoke launchers out (they work by themselves)', R(`(() => { const v = air([...TANK, { type: 'tstSmoke', x: 0.3, y: 2.45, rot: 0, z: 1.4, att: 5 }]);
  return v.parts.some((p) => p.type === 'tstSmoke') && Combat.systems(v).every((s) => s.w.kind !== 'smoke') && Combat.systems(v).some((s) => s.w.kind === 'tgun'); })()`));
t('Combat exports what the new systems call', R(`['candidates', 'refPos', 'clutter', 'irSig', 'chaffBreaks', 'segPoint', 'boxesOf', 'hitVessel', 'launchMissile', 'fireRocket', 'release', 'nextStore',
  'targetCentre', 'hitTarget', 'aiDown', 'jams', 'radarOf', 'boomFX'].every((k) => typeof Combat[k] === 'function')`));
R(`var ra = air(), rF = simOf(ra), c0 = [cnt('Armour.hitFirst'), cnt('Armour.legacyHit')];
var gone1 = fly(round(ra, { x: 0, y: 1.1 }, 1), rF), c1 = [cnt('Armour.hitFirst'), cnt('Armour.legacyHit')];
var gun2 = ra.parts.find((p) => p.type === 'tstGun'), gone2 = fly(round(ra, { x: 4.5, y: 2.45 }, 1), rF);`);
t('a round into a plated craft: Armour.hitFirst finds the part; on armour, Armour.legacyHit decides (and the round stops: up through the 22.5 mm belly, the hull takes 10% of its damage)', R(`c1[0] > c0[0] && c1[1] === c0[1] + 1 && gone1 > 0 && Math.abs(ra.parts[0].hp - (1100 - 1)) < 1e-9`), R('[c0, c1, gone1, ra.parts[0].hp]'));
t('...and a part without armour (the gun) takes the round as any part does (its own hp)', R(`gone2 > 0 && gun2.hp === 290 && cnt('Armour.legacyHit') === c1[1]`), R('[gone2, gun2.hp]'));
t('Armour.hitFirst: through a plain box, the same first part and place as the old box test', R(`(() => { const a = ra.toWorld(0, 1.1, -10), e = ra.toWorld(0, 1.1, 10), q = Armour.hitFirst(ra, a, e), o = Tt.hitVessel(ra, a, e); return !!q && q.p === o.p && q.t === o.t; })()`));
t('a shell flies in armour.js; a peer\'s shell copy and smoke go there too', R(`(() => { const k0 = [cnt('Armour.moveShell'), cnt('Armour.netShell'), cnt('Aim.netSmoke')];
  const keep = Tt.moveShot({ k: 'shell', sh: 'x', b: EARTH, x: ra.x + 50, y: 0, z: 0, vx: 0, vy: 900, vz: 0, t: 0, life: 6 }, 1 / 120, rF);
  const g = { body: EARTH, remote: 9, parts: [], x: ra.x, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }, n = Combat.S.shots.length, nf = Combat.S.flares.length;
  Combat.netShot(g, { k: 'shell', sh: 'x', b: 'earth', P: [ra.x, 0, 0], V: [0, 900, 0] }); Combat.netFlares(g, { smoke: 1, P: [ra.x, 0, 0], D: [0, 1, 0] });
  return keep === false && cnt('Armour.moveShell') === k0[0] + 1 && cnt('Armour.netShell') === k0[1] + 1 && cnt('Aim.netSmoke') === k0[2] + 1 && Combat.S.shots.length === n && Combat.S.flares.length === nf; })()`));
t('a blast spares the craft named (a shell\'s own launcher at the muzzle), and only that one', R(`(() => { const v = air(), F = simOf(v), at = v.toWorld(0, 1.1, 1.8);
  Combat.explode(EARTH, at, 4, 150, null, F, true, undefined, v); const spared = v.parts.every((p) => p.hp == null);
  Combat.explode(EARTH, at, 4, 150, null, F, true); return spared && v.parts.some((p) => p.hp != null); })()`));
t('a module part at 0 hp goes to Armour.moduleDown: broken, not ripped off (it stays)', R(`(() => { const v = air(), F = simOf(v), tr = v.parts[1], k = cnt('Armour.moduleDown');
  Combat.damage(v, tr, 1e6, 'shot', F); return cnt('Armour.moduleDown') === k + 1 && v.parts.includes(tr) && tr.broken && tr.hp === 0 && !F.broken.length && v.gear.length === 2; })()`));
t('a ground launcher\'s missile lights its motor at its own coast time (old missiles: 0.35 s)', R(`(() => {
  const m = (o) => Object.assign({ k: 'missile', b: EARTH, x: EARTH.radius + 3000, y: 0, z: 0, vx: 0, vy: 50, vz: 0, dx: 0, dy: 1, dz: 0, t: 0, life: 10, accel: 100, burn: 2, blast: 3, dmg: 100, owner: null, target: null, enemy: false, net: 0 }, o);
  const a = m({}), b = m({ coast: 0.05, gt: 5 }), F = simOf(ra); F.vessels = [];
  for (let i = 0; i < 12; i++) { Tt.moveShot(a, 1 / 120, F); Tt.moveShot(b, 1 / 120, F); }
  return a.vy < 50.01 && b.vy > 54; })()`), R(`(() => { const m = (o) => Object.assign({ k: 'missile', b: EARTH, x: EARTH.radius + 3000, y: 0, z: 0, vx: 0, vy: 50, vz: 0, dx: 0, dy: 1, dz: 0, t: 0, life: 10, accel: 100, burn: 2, blast: 3, dmg: 100, owner: null, target: null, enemy: false, net: 0 }, o);
  const a = m({}), b = m({ coast: 0.05, gt: 5 }), F = simOf(ra); F.vessels = []; for (let i = 0; i < 12; i++) { Tt.moveShot(a, 1 / 120, F); Tt.moveShot(b, 1 / 120, F); } return [a.vy, b.vy]; })()`));
t('reset clears the smoke clouds and the ground AI count', R(`(() => { Combat.S.smoke = [1]; Combat.S.gai = 2; Combat.reset({}); return Combat.S.smoke.length === 0 && Combat.S.gai === 0; })()`));
R(`var fv = air(), fF = simOf(fv), wrecks = [], fx = new Set(), pf = Armour.partFX;
for (const d of [40, 10, 50, 30, 20]) { const w = air(); w.y = d; w.wreck = true; wrecks.push(w); fF.vessels.push(w); }
Armour.partFX = (o, p, n) => { fx.add(o); };
var f0 = ['GroundAI.frame', 'Armour.repairStep', 'Aim.radarStep', 'Aim.lockPid'].map(cnt);
Combat.S.smokeT = 0; Combat.frame(fF, 1 / 60);
var f1 = ['GroundAI.frame', 'Armour.repairStep', 'Aim.radarStep', 'Aim.lockPid'].map(cnt);
Armour.partFX = pf;`);
t('the frame: a ground-update craft runs GroundAI.frame, Armour.repairStep, Aim.radarStep and the tracking radar\'s lock', R(`f1.every((n, i) => n === f0[i] + 1)`), R('[f0, f1]'));
t('module parts smoke through Armour.partFX; of five wrecks only the three nearest', R(`fx.has(fv) && fx.size === 4 && [10, 20, 30].every((d) => fx.has(wrecks.find((w) => w.y === d))) && !fx.has(wrecks.find((w) => w.y === 50))`),
  R('[...fx].map((o) => o.y)'));
t('GroundMode.obj: nothing live outside a room or a Practice Battle; soloPlace: none for the old kinds', R(`GroundMode.obj() === null && ['rocket', 'plane', 'car', 'heli'].every((k) => GroundMode.soloPlace(k) === null)`));

// ---------------------------------------------------------------- Phase 1's stand-in for Gear.ground: placed, stepped, driven a little
R(`var drv = (() => { const v = vesselOf(TANK); const K = VEHICLE_KINDS.tank; v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[K.site].east), K.launchRot); return v; })();
var dF = simOf(drv), r0 = drv.radius();
oldRun(drv, dF, 2, () => {});
var settled = drv.radius() - r0, still = drv.speed();
oldRun(drv, dF, 4, (v) => { v.ctl.v = 1; });
var fw = drv.axis(1, 0, 0), vf = drv.vx * fw.x + drv.vy * fw.y + drv.vz * fw.z;
var up = norm3(v3(drv.x, drv.y, drv.z)), h0 = Math.atan2(dot3(fw, norm3(v3(-up.y, up.x, 0))), 1);
oldRun(drv, dF, 2, (v) => { v.ctl.v = 0; v.ctl.h = 1; });
var yaw = dot3(drv.av, up);`);
t('a tank on the runway settles on its tracks and stays put', R(`Math.abs(settled) < 0.4 && still < 0.2 && !dF.broken.length && drv.wheelsDown && drv.landed`), R('[settled, still, dF.broken]'));
t('W drives it forward; D turns it on the spot (right)', R(`vf > 2 && yaw < -0.05 && !dF.broken.length`), R('[vf, yaw]'));
t('(and the counters do see the new code run for a ground-update craft)', R(`CALLS['Aim.groups'] > 0 && CALLS['Gear.ground'] > 0 && CALLS['Gear.points'] > 0 && CALLS['Aim.stepAll'] > 0`), calls());

// ---------------------------------------------------------------- the catalogue's own parts meet the hooks (a TK-34-like tank)
// hull (its plate dialled to 60 mm), two tracks, a diesel inside, a ring, a cast turret, the 85 mm gun and a coaxial MG
R(`var REAL = [
  { type: 'hullMedium', x: 0, y: 1.1, flip: false, rot: 0, mm: 60 },
  { type: 'trackMed', x: 0, y: 0.5, flip: false, rot: 0, z: -1.35, att: 0 }, { type: 'trackMed', x: 0, y: 0.5, flip: false, rot: 0, z: 1.35, att: 0 },
  { type: 'engDiesel', x: -1.8, y: 1.1, flip: true, rot: 0, att: 0 },
  { type: 'ringM', x: 0, y: 1.85, flip: false, rot: 0, att: 0 }, { type: 'turretCast', x: 0, y: 2.425, flip: false, rot: 0, att: 4 },
  { type: 'gun85', x: 2.622, y: 2.425, flip: false, rot: 3, att: 5 }, { type: 'mgCoax', x: 1.4, y: 2.425, flip: false, rot: 3, z: 0.6, att: 5 }];
var rps = partsFromDesign(REAL), radj = buildAdjacency(rps), rmass = kg(rps), rmm = (ps) => ps.map((p) => p.mm ?? '-').join();
var rcode = Codes.designCode({ name: 'TK', kind: 'tank', parts: designRows(rps) }), rback = partsFromDesign(Codes.parseCode(rcode).parts);
var rv = vesselOf(REAL), rsaved = Vessel.restore(JSON.parse(JSON.stringify(rv.serialize())));`);
t('real parts: joined, clash-free, the hull in control, the dialled plate the only mm', R(`(() => { let clash = 0; for (let i = 0; i < rps.length; i++) for (let j = i + 1; j < rps.length; j++) if (partsClash(rps[i], rps[j])) clash++;
  return clash === 0 && componentOf(rps[0].id, radj).size === rps.length && findControlPart(rps) === rps[0] && rmm(rps) === '60,-,-,-,-,-,-,-'; })()`), R('rmm(rps)'));
t('real parts: rows -> RSS3 code -> parts, the same mass and mm', R(`rcode.startsWith('RSS3.') && near(kg(rback), rmass) && rmm(rback) === rmm(rps) && rmass > kg(partsFromDesign(REAL.map((q) => ({ ...q, mm: undefined })))) + 3000`),
  R('[rcode.slice(0, 5), kg(rback) - rmass, rmm(rback)]'));
t('real parts: a saved flight, the same mass and mm', R(`near(rsaved.mass, rv.mass) && near(rv.mass, rmass) && rmm(rsaved.parts) === rmm(rps)`), R('[rsaved.mass - rv.mass, rv.mass - rmass, rmm(rsaved.parts)]'));
mp.__rdesign = R('Codes.parseCode(rcode)'); // (the code read back, handed to the multiplayer copy of the game)
const rsp = G.run(mp, `(() => {
  const d = JSON.parse(JSON.stringify(__rdesign)), ps = partsFromDesign(d.parts), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = d.kind; v.rebuildGroups();
  Flight.active = v; MP.sendSpawn();
  const rows = JSON.parse(JSON.stringify(Net.out[Net.out.length - 1][0].parts)), clean = mpSpawnRows(rows);
  MP.peers.set(9, { design: { kind: 'tank', parts: clean }, gun: {}, ghost: null }); MP.buildGhost(9);
  const g = MP.peers.get(9).ghost, mm = (ps) => ps.map((p) => p.mm ?? '-').join(); MP.peers.delete(9);
  return { kind: d.kind, cols: clean.map((r) => r.length).join(), dm: g.mass - v.mass, mass: v.mass, mm: mm(g.parts), vmm: mm(v.parts), groups: g.tg.length, members: g.tg[0] && g.tg[0].members.map((p) => p.type).join() };
})()`);
t('real parts: code -> spawn rows -> ghost, the same mass and mm, the turret turning', rsp.kind === 'tank' && rsp.cols === '10,9,9,9,9,9,9,9' && near(rsp.dm, 0, 1e-9) && near(rsp.mass, R('rmass'), 1e-6)
  && rsp.mm === R('rmm(rps)') && rsp.vmm === rsp.mm && rsp.groups === 1 && rsp.members === 'turretCast,gun85,mgCoax', JSON.stringify(rsp));
t('real parts: the ring turns the turret, the gun and the coaxial MG (not the hull, tracks or engine), unjammed', R(`(() => { const tg = Aim.groupsOfParts(rps, radj), g = tg[0];
  return tg.length === 1 && g.ring === rps[4] && typesOf(g) === 'turretCast,gun85,mgCoax' && !g.jam && [0, 1, 2, 3, 4].every((i) => !g.ids.has(rps[i].id)) && near(g.c.y, 1.95)
    && near(g.rate, 24 * Math.PI / 180 * clamp(Math.sqrt(12 / g.mass), 0.35, 1)) && rv.tg.length === 1 && rv.aimed.map((p) => p.type).join() === 'gun85,mgCoax'; })()`),
  R(`JSON.stringify(Aim.groupsOfParts(rps, radj).map((g) => [typesOf(g), g.jam, g.mass, g.rate]))`));
t('real parts built turret-first: the same group whichever way the att links run, the hull never turning (hung on the turret itself, it jams the ring)', R(`(() => {
  const sig = (rows, jam) => { const ps = partsFromDesign(rows), v = vesselOf(rows), tg = Aim.groupsOfParts(ps, buildAdjacency(ps));
    return JSON.stringify([tg.map((g) => [typesOf(g), jam ? jam(g.jam, ps) : g.jam, g.mass, g.rate]), v.bodyBox, v.parts.filter((p) => v.tgOf.has(p.id)).map((p) => p.type)]); };
  const up = REAL.map((q) => ({ ...q })); delete up[5].att; up[4].att = 5; up[0].att = 4; // (the ring on the turret, the hull on the ring)
  const onTurret = REAL.map((q) => ({ ...q })); delete onTurret[5].att; onTurret[0].att = 5; // (the hull joined to the turret: welded past the ring)
  return sig(up) === sig(REAL) && sig(onTurret, (j, ps) => (j && j[0] === ps[5].id && j[1] === ps[0].id ? null : 'no jam')) === sig(REAL); })()`));
t('real parts: Gear.points gives each Medium Track three road-wheel contacts, one side each', R(`(() => { const g = rv.wheelPts.filter((k) => k.gear), t = PARTS.trackMed.track;
  return rv.gear.length === 2 && rv.gear.every((p) => p.type === 'trackMed') && g.length === 6 && g.filter((k) => k.side === -1).length === 3 && g.filter((k) => k.side === 1).length === 3
    && g.every((k) => near(k.r, t.r + 0.4 * t.travel) && near(k.y, 0.5 - 0.5 + t.r)); })()`));
R(`var rdv = vesselOf(REAL); rdv.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites.runway.east), 0);
var rdF = simOf(rdv), rlow = Infinity, rnan = false, rw = v3();
var clearOf = (v) => { let m = Infinity; const L = {};
  for (const [k, r] of [...v.hull.map((k) => [k, 0]), ...v.wheelPts.map((k) => [k, k.r])]) { const w = v.toWorld(k.x, k.y, k.z); Terrain.locate(EARTH, w.x, w.y, w.z, L); m = Math.min(m, Math.hypot(w.x, w.y, w.z) - r - EARTH.radius - Terrain.surfaceAt(EARTH, L.a, L.z)); }
  return m; };
for (let i = 0; i < 600; i++) {
  rdv.ctl.v = i >= 240 && i < 480 ? 1 : 0; rdv.ctl.h = i >= 480 ? 1 : 0;
  rdv.physicsStep(1 / 120, rdF); Combat.step(1 / 120, rdF); rdF.time += 1 / 120; if (i % 4 === 0) Combat.frame(rdF, 1 / 30);
  rnan = rnan || ![rdv.x, rdv.y, rdv.z, rdv.vx, rdv.vy, rdv.vz, rdv.q.w, rdv.q.x, rdv.q.y, rdv.q.z, rdv.av.x, rdv.av.y, rdv.av.z].every(Number.isFinite);
  if (i % 12 === 0) rlow = Math.min(rlow, clearOf(rdv));
}`);
t('real parts: on the runway for 5 s (settle, drive, turn) with Phase 1\'s Gear.ground: finite, on its tracks, never through the ground', R(`!rnan && rlow > -0.1 && rlow < 0.1 && rdv.wheelsDown && rdv.canDrive && !rdF.broken.length && rdv.parts.length === 8 && rdv.speed() > 2`),
  R('[rnan, rlow, rdv.wheelsDown, rdv.canDrive, rdF.broken, rdv.speed()]'));

// ---------------------------------------------------------------- multiplayer messages
G.run(mp, `Net.out = []; Net.hostNow = () => 0; Flight.running = true; Flight.mp = { solo: false }; MP.active = true; MP.state = { players: [] };
Object.defineProperty(MP, 'shared', { get: () => true, configurable: true });
var last = () => Net.out[Net.out.length - 1][0], shot = (k, o) => Object.assign({ k, b: EARTH, x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, dx: 0, dy: 1, dz: 0, burn: 1, accel: 9 }, o);
for (const k in CALLS) delete CALLS[k];`);
const msgs = G.run(mp, `(() => {
  MP.sendShot(shot('rocket')); const r = last();
  MP.sendShot(shot('shell', { sh: 'ap37' })); const sh = last();
  MP.sendSmoke(Flight.active, { x: 1, y: 2, z: 3, dx: 0, dy: 0, dz: 1 }); const sm = last();
  const tgt = { remote: 5 }, msl = (seek) => { // the launch message, then its first 10 Hz update (its tg too)
    const s = shot('missile', { target: tgt }); MP.sendMissile(s, { seek }); const m = last();
    globalThis.Combat = { shots: [s] }; MP.missiles.get(s).at = -1e9; MP.syncMissiles(); const u = last(); Combat.shots.length = 0; MP.syncMissiles(); delete globalThis.Combat;
    return [m.agm, m.tg, u.t + u.tg]; };
  return { rocket: Object.keys(r).join(), shell: sh.sh, smoke: JSON.stringify(sm), msl: ['heat', undefined, 'ground', 'saclos', 'top', 'clos'].map(msl).join(' ') };
})()`);
t('a rocket\'s shot message keeps its fields; a shell\'s says which round', msgs.rocket === 't,k,b,P,V,D,burn,accel,small,torpedo' && msgs.shell === 'ap37', JSON.stringify(msgs));
t('a smoke cloud goes as a cm message with smoke set (old peers drop it: no V)', msgs.smoke === '{"t":"cm","smoke":1,"P":[1,2,3],"D":[0,0,1]}', msgs.smoke);
t('missiles: air seekers and the old anti-ground one as before; wire-guided and top-attack go as anti-ground with no target, in their updates too', msgs.msl === '0,5,mp5 0,5,mp5 1,5,mp5 1,0,mp0 1,0,mp0 0,5,mp5', msgs.msl);
t('sending shots, smoke and missiles: no calls into the new systems', calls(mp) === '{}', calls(mp));
t('the pv rows carry a turret ring (its yaw) and nothing new for old craft', G.run(mp, `(() => {
  const pv = (v) => { Flight.active = v; Flight.destroyed = false; MP.sent = { s: 1e12, pv: -1e9, hp: 1e12, hpSig: '' }; MP.lastParts = v.parts.length; Net.out = []; MP.afterUpdate(); const m = Net.out.find(([q]) => q.t === 'pv'); return m ? m[0].list : []; };
  const ps = partsFromDesign(__trows), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'tank'; v.rebuildGroups(); v.parts[4].aimYaw = 0.5;
  const rows = pv(v), ring = rows.find((r) => r[0] === v.parts[4].id);
  const bp = partsFromDesign(templateRows(TEMPLATES.buggy)), b = new Vessel(bp, buildAdjacency(bp), EARTH); b.kind = 'car'; b.rebuildGroups();
  const old = pv(b), want = b.parts.filter((p) => { const d = p.def; return d.wing || d.thrust || d.weapon || d.chute || (d.wheel && d.wheel.retract); }).map((p) => p.id).join();
  return !!ring && ring[6] === 0.5 && old.map((r) => r[0]).join() === want;
})()`));

(async () => {
  // MP.host's settings: merged over the defaults (old calls: the defaults as before)
  const hosted = await G.run(mp, `(async () => {
    Net.host = async () => {}; Net.code = 'TEST'; MP.begin = function () { this.active = true; this.state = null; }; MP.push = () => {};
    await MP.host('pvp', 'local'); const a = JSON.stringify(MP.state.settings);
    await MP.host('pvp', 'local', { game: 'ground' }); const b = MP.state.settings;
    return { same: a === JSON.stringify(MP_DEFAULTS), ground: b.game === 'ground' && Object.keys(MP_DEFAULTS).every((k) => k === 'game' || b[k] === MP_DEFAULTS[k]) };
  })()`);
  t('MP.host(mode, transport, settings): the settings over the defaults; without them, the defaults', hosted.same && hosted.ground, JSON.stringify(hosted));
  t.done();
})();
