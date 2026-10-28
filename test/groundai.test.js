// The ground AI (js/groundai.js): the Tank Range (Practice and Hostile), the Practice Battle, the kinematic movement
// and its budget, when the AI shoots and when it doesn't, respawns, rooms, and the Hostile gates for Armour. Real
// stock vehicles on the real map, stepped as Flight.update steps them (physics for what moves itself at 1/120 s,
// Combat.step, Combat.frame once a 60 fps frame), with a Flight stand-in whose start() builds and places a design as
// Flight.start does (keeping opts.keep).   node test/groundai.test.js
const G = require('./lib/game.js');
const t = G.checks('groundai.test.js');
const ctx = G.load({ combat: true });
const R = (code) => G.run(ctx, code);
ctx.__now = () => Number(process.hrtime.bigint()) / 1e6;

R(`
Math.random = mulberry32(31337);
var SET = { targets: 'practice', high: false };
Settings.get = (k) => SET[k];
var world = () => ({ time: 0, target: null, toasts: [], broken: [], vessels: [], active: null, firing: false, mgFiring: false, groundAim: false, aim: null, zero: 800, warpIdx: 0,
  running: true, destroyed: false, camAbs: null, launchCost: 0, flags: {}, downs: 0, design: null,
  toast(m) { this.toasts.push(m); }, award(f) { this.flags[f] = true; },
  // (Flight.onDestroyed's and Flight.revert's first lines, as flight.js has them)
  onDestroyed() { if (this.destroyed) return; this.destroyed = true; this.downs++; if (GroundAI.battle && GroundAI.onDestroyed(this)) return; },
  revert() { if (GroundAI.battle && GroundAI.revert(this)) return; this.start(this.design, { place: GroundMode.placement('highland', 0, 0, 'tank') }); },
  start(design, opts) {
    this.design = design;
    const ps = partsFromDesign(design.parts), adjAll = buildAdjacency(ps), ctrl = findControlPart(ps), keep = componentOf(ctrl.id, adjAll), parts = ps.filter((p) => keep.has(p.id)), adj = new Map();
    for (const p of parts) { if (p.att != null && !keep.has(p.att)) p.att = null; adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id)))); }
    const v = new Vessel(parts, adj, EARTH); v.name = design.name; v.kind = design.kind; v.stages = computeStages(parts, adj, ctrl.id); v.rebuildGroups();
    const P = opts && opts.place;
    v.placeOnSurface(EARTH, siteAngle(EARTH, P ? P.e : EARTH.sites.runway.east), 0, P ? P.z : 0, P ? P.yaw || 0 : 0);
    this.launchCost = designCost(parts);
    this.vessels = [v, ...(opts && Array.isArray(opts.keep) ? opts.keep.filter((o) => o && o !== v && !o.dead) : [])]; this.active = v; this.destroyed = false; this.firing = false;
    Combat.reset(this); this.running = true;
    return v;
  },
  ripParts(v, parts) { for (const p of parts) { for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.get(p.id).clear(); } for (const q of v.splitComponents()) { q.isDebris = true; this.vessels.push(q); } v.rebuildGroups(); if (v === this.active && !v.control) this.onDestroyed(); },
  breakParts(v, parts) { for (const p of parts) { v.parts = v.parts.filter((q) => q !== p); for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.delete(p.id); }
    if (!v.parts.length) { v.dead = true; if (v === this.active) this.onDestroyed(); return; } for (const q of v.splitComponents()) { q.isDebris = true; this.vessels.push(q); } v.rebuildGroups(); if (v === this.active && !v.control) this.onDestroyed(); },
  cleanup() { this.vessels = this.vessels.filter((v) => !v.dead && v.parts.length); } });
// secs of 60 fps frames: each frame two 1/120 s physics steps (what moves itself), Combat.step, then Combat.frame
var go = (F, secs, each) => { for (let f = 0, N = Math.round(secs * 60); f < N; f++) { if (each && each(F, f) === false) return;
  for (let i = 0; i < 2; i++) { for (const v of F.vessels.slice()) if (!v.remote && !v.wreck && !v.kin && !v.dead && v.parts.length && !(v !== F.active && v.landed && v.restTime > 2)) v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; }
  Combat.frame(F, 1 / 60); F.cleanup(); } };
var designOf = (key) => ({ name: TEMPLATES[key].name, kind: TEMPLATES[key].kind, parts: templateRows(TEMPLATES[key]) });
var eOf = (v) => { const L = Terrain.locate(EARTH, v.x, v.y, v.z, {}); return { e: -wrapAngle(L.a - EARTH.padAngle) * EARTH.radius, z: L.z, h: L.r - EARTH.radius - Terrain.surfaceAt(EARTH, L.a, L.z), wet: Terrain.waterAt(EARTH, L.a, L.z) }; };
var NPAD = GroundMode.placement('highland', 0, 0, 'tank');
// the AI's own shells in flight, counted once each
var counter = () => { const seen = new Set(); let n = 0; return { tick() { for (const s of Combat.S.shots) if ((s.k === 'shell' || s.k === 'missile' || s.k === 'rocket') && s.owner && s.owner.ai && s.owner.ai.ground && !seen.has(s)) { seen.add(s); n++; } }, get n() { return n; } }; };
var MPstub = null;
`);

// ---------------------------------------------------------------- the Tank Range, Practice
R(`SET.targets = 'practice';
var F1 = world(); F1.start(designOf('tk34'), { place: NPAD }); go(F1, 1.5);
var keys1 = GroundAI.ai.map((v) => v.ai.key + ':' + v.ai.role).sort().join(), at0 = GroundAI.ai.map((v) => ({ v, p: eOf(v) }));`);
t('Tank Range (Practice): a TK-34 on Highland Ridge\'s north pad gets its five targets, three parked and two on patrol, all real stock vehicles moved kinematically',
  R(`!!GroundAI.range && GroundAI.range.mode === 'practice' && keys1 === 'leapard1:patrol,ms4:parked,pumo:patrol,tk34:parked,zsy23:parked' && GroundAI.ai.every((v) => v.kin && v.ai.ground && v.gv && F1.vessels.includes(v)) && Combat.S.gai === 1`), R('keys1'));
t('...the toast says they never shoot back, and no drones for a tank without AA', R(`F1.toasts.some((m) => /five targets ahead · they never shoot back/.test(m)) && GroundAI.range.drones.length === 0`), R('F1.toasts'));
R(`var ctr1 = counter(), fired1 = false; go(F1, 60, () => { ctr1.tick(); if (GroundAI.ai.some((v) => v.aimFire || v.mgFire || v.aimP)) fired1 = true; });
var moved1 = at0.map(({ v, p }) => { const q = eOf(v); return [v.ai.role, Math.round(Math.hypot(q.e - p.e, q.z - p.z))]; });`);
t('...in 60 s with the player in front of them none of them aims or fires', R(`ctr1.n === 0 && !fired1`), R('[ctr1.n, fired1]'));
t('...the patrollers drive round their loop (about 6 and 4 m/s), the parked ones stay exactly where they are', R(`moved1.every(([r, d]) => r === 'parked' ? d === 0 : d > 150)`), R('moved1'));
R(`var tgt1 = GroundAI.ai.find((v) => v.ai.key === 'tk34'), p1 = eOf(tgt1); tgt1.lastHitBy = F1.active; Armour.knockOut(tgt1, F1, 'crew');
var kos1 = GroundAI.range.kos, best1 = GroundAI.range.best, wreck1 = tgt1.wreck && F1.vessels.includes(tgt1), n1 = GroundAI.ai.filter((v) => !v.ai.down).length;
go(F1, 44); var back44 = GroundAI.ai.some((v) => v.ai.key === 'tk34'), wreck44 = F1.vessels.includes(tgt1) && !tgt1.dead;
go(F1, 2); var nt = GroundAI.ai.find((v) => v.ai.key === 'tk34'), p2 = nt && eOf(nt);`);
t('...one the player knocks out counts (1 KO, the best shot its range), says "Enemy TK-34 knocked out!", and stays as a wreck',
  R(`kos1 === 1 && Math.abs(best1 - 604) < 15 && wreck1 && n1 === 4 && F1.toasts.includes('Enemy TK-34 knocked out!') && Combat.S.kills === 1`), R('[kos1, best1, wreck1, n1, F1.toasts.slice(-3)]'));
t('...it comes back 45 s later (not at 44 s), somewhere else at least 400 m from the player, and its wreck goes then',
  R(`!back44 && wreck44 && !!nt && Math.hypot(p2.e - p1.e, p2.z - p1.z) > 50 && Math.hypot(p2.e - NPAD.e, p2.z - NPAD.z) > 395 && !F1.vessels.includes(tgt1) && !p2.wet`), R('[back44, wreck44, !!nt, p2]'));
R(`for (const v of GroundAI.ai.slice(0, 2)) { v.lastHitBy = F1.active; Armour.knockOut(v, F1, 'crew'); } go(F1, 0.5);`);
t('...three knock-outs with a ground vehicle: the Tank Range mission ($25,000)', R(`GroundAI.range.kos === 3 && F1.flags.tankRange === true`), R('[GroundAI.range.kos, F1.flags]'));
// an AA vehicle: the drones
R(`var F2 = world(); F2.start(designOf('zsy23'), { place: NPAD }); go(F2, 1.5);
var dr = GroundAI.range && GroundAI.range.drones, drN = (dr || []).filter((d) => Combat.S.targets.includes(d) && d.alive).length, drAt = (dr || []).map((d) => [Math.round(d.cz), Math.round(d.h)]);`);
t('...an AA vehicle (ZSY-23) also gets two target drones circling north of the pad, 400-600 m up', R(`drN === 2 && dr.every((d) => d.cz < 13000 && d.h >= 400 && d.h <= 650 && d.def.air)`), R('drAt'));
R(`var d0 = dr[0]; Combat.hitTarget(d0, 1e6, F2.active, F2); go(F2, 0.5); var dk = GroundAI.range.kos; go(F2, 45); var dBack = d0.alive && Combat.S.targets.includes(d0);`);
t('...a drone the player shoots down counts too, and flies again 45 s later', R(`dk === 1 && dBack`), R('[dk, dBack]'));

// ---------------------------------------------------------------- when an AI shoots (a fighting one, on its own)
R(`SET.targets = 'off';`);
// (a 'guard' fights where it stands: the distance stays as set; a 'fight' one would drive off to the zones)
R(`var duel = (where, D, secs, before, role = 'guard') => {
  const F = world(); F.start(designOf('ma1'), { place: where }); go(F, 1);
  for (const p of F.active.parts) if (p.def.module === 'crew') p.hp = 1e9; // (the player takes hits and stays: only the shooting is watched)
  const P = eOf(F.active), a = where.yaw, ce = Math.cos(a), cz = -Math.sin(a);
  const ai = GroundAI.spawn(F, 'tk34', P.e + ce * D, P.z + cz * D, a + Math.PI, 1, role, { skill: 0.5 });
  if (before) before(F, ai);
  const c = counter(); let first = null, seen = false;
  go(F, secs, () => { c.tick(); if (c.n && first == null) first = F.time; if (ai.ai.seen) seen = true; });
  const out = { n: c.n, first, seen, state: ai.ai.state, tD: Math.round(ai.ai.tD), F, ai };
  GroundAI.reset(F);
  return out;
};
var RUN = { e: 900, z: 0, yaw: 0 };
var d10 = duel(RUN, 1000, 15, null, 'fight'), d14 = duel(RUN, 1400, 15), dHid = duel(NPAD, 1000, 15);`);
t('an AI that fights, 1 km from the player across the flat runway: it sees, stops and fires within 15 s (its reaction, then the turret laid)',
  R(`d10.seen && d10.n >= 1 && d10.first != null && d10.first < 1 + 15 && d10.state === 'engage'`), R('[d10.n, d10.first, d10.state, d10.tD]'));
t('...1.4 km off it sees the player but holds its fire (it stops to shoot only within 1.2 km)', R(`d14.seen && d14.n === 0 && d14.tD === 1400`), R('[d14.n, d14.seen, d14.state, d14.tD]'));
t('...1 km off behind Highland Ridge\'s rise (no line of sight either way) it never sees the player, and never fires',
  R(`!dHid.seen && dHid.n === 0`), R('[dHid.n, dHid.seen, dHid.state]'));
R(`var smokeAt = (F, ai) => { const A = F.active, m = { x: (A.x + ai.x) / 2, y: (A.y + ai.y) / 2, z: (A.z + ai.z) / 2 }, r = Math.hypot(m.x, m.y, m.z), k = (r + 3) / r;
  Combat.S.smoke.push({ b: EARTH, x: m.x * k, y: m.y * k, z: m.z * k, vx: 0, vy: 0, vz: 0, fly: 0, t: 1, r: 9, life: 13, fx: 0, by: A }); };
var dSm = duel(RUN, 1000, 11, smokeAt), dSm2 = (() => { const F = world(); F.start(designOf('ma1'), { place: RUN }); go(F, 1);
  for (const p of F.active.parts) if (p.def.module === 'crew') p.hp = 1e9;
  const P = eOf(F.active), ai = GroundAI.spawn(F, 'tk34', P.e + 1000, P.z, Math.PI, 1, 'guard', { skill: 0.5 }), c = counter(); smokeAt(F, ai);
  let during = 0, cleared = null; go(F, 30, () => { c.tick(); if (Combat.S.smoke.length) during = c.n; else if (cleared == null) cleared = F.time; });
  const o = { during, after: c.n - during, cleared }; GroundAI.reset(F); return o; })();`);
t('...smoke on the line between them hides the player: no shot while it hangs there; once it clears, the AI fires',
  R(`dSm.n === 0 && !dSm.seen && dSm2.during === 0 && dSm2.after >= 1 && dSm2.cleared != null`), R('[dSm.n, dSm.seen, dSm2]'));
// the round it loads: AP at armour, HE at an open top
R(`var roundAt = (me) => { const F = world(); F.start(designOf(me), { place: RUN }); go(F, 1); const P = eOf(F.active);
  const ai = GroundAI.spawn(F, 'tk34', P.e + 800, P.z, Math.PI, 1, 'guard', { skill: 0.5 }); go(F, 2);
  const g = ai.parts.find((p) => p.type === 'gun85'), r = g.shellNext || g.shellSel || g.def.weapon.shells[0]; GroundAI.reset(F); return r; };
var rMA = roundAt('ma1'), rOpen = roundAt('ms18');`);
t('...it loads AP (APHE) at a plated tank and HE at an open-topped one', R(`rMA === 'aphe85' && rOpen === 'he85'`), R('[rMA, rOpen]'));
// below 40% crew it falls back to its pad
R(`var Fr = world(); Fr.start(designOf('ma1'), { place: RUN }); go(Fr, 1); var Pr = eOf(Fr.active), air = GroundAI.spawn(Fr, 'tk34', Pr.e + 900, Pr.z, Math.PI, 1, 'fight', { skill: 0.5 });
go(Fr, 2); var C = Armour.crewOf(air), killN = C.crew.length - 1; for (let i = 0; i < killN; i++) { const e = C.crew[i]; if (e.i >= 0) { e.host.mods = e.host.mods || e.host.def.mods.map((q) => q.hp || 100); e.host.mods[e.i] = 0; } else e.part.broken = true; }
air.ko = null; for (const p of air.parts) p.ko = false; go(Fr, 1); var ret = air.ai.home && air.ai.state === 'retreat'; GroundAI.reset(Fr);`);
t('...below 40% of its crew alive it falls back toward its own pad', R(`ret`), R('[killN, air.ai.home, air.ai.state]'));
// a parked tank in its way: round it (or back off and round it) to its zone
R(`var Fw = world(); Fw.start(designOf('tk34'), { place: RUN }); go(Fw, 0.5); // (the player far off: nobody to stop and shoot at)
var mover = GroundAI.spawn(Fw, 'tk34', 17750, 14250, -Math.PI / 2, 1, 'fight', { skill: 0.5 }), block = GroundAI.spawn(Fw, 'ms4', 17750, 14262, 0, 1, 'parked');
var mv0 = eOf(mover), passed = false; go(Fw, 40, () => { const q = eOf(mover); if (q.z > 14300) passed = true; }); GroundAI.reset(Fw);`);
t('...a tank parked in its way: it steers round it (backing off and turning when stuck) and gets on to its zone', R(`passed`), R('[mv0, eOf(mover), mover.ai.state, mover.ai.revT]'));

// ---------------------------------------------------------------- the Practice Battle
R(`SET.targets = 'practice';
var F3 = world(); GroundAI.startBattle(F3, { money: 45000, design: designOf('tk34'), seed: 5 });
var B3 = GroundAI.battle, teams3 = GroundAI.ai.map((v) => v.ai.team).sort().join(), obj3 = GroundMode.obj();
var pad3 = GroundAI.ai.map((v) => { const p = eOf(v), f = EARTH.arenas.highland.pads[v.ai.team]; return Math.round(Math.hypot(p.e - f.e, p.z - f.z)); });`);
t('Practice Battle: you and two AI allies on the north pad, three AI enemies on the south one, 300 tickets a side, its objective what GroundMode.obj() shows',
  R(`!!B3 && teams3 === '0,0,1,1,1' && B3.obj.tk.join() === '300,300' && obj3 === B3.obj && B3.obj.zones.length === 3 && pad3.every((d) => d <= 23) && GroundAI.ai.filter((v) => v.ai.team === 0).every((v) => v.ai.ally)`),
  R('[teams3, B3 && B3.obj.tk, pad3]'));
t('...its vehicles are the money tier\'s stock ones (GROUND_STOCK), and the old range is not spawned', R(`GroundAI.ai.every((v) => GROUND_STOCK[45000].includes(v.ai.key)) && !Combat.S.spawned && Combat.S.targets.length === 0`),
  R('GroundAI.ai.map((v) => v.ai.key)'));
R(`var budget = { calls: 0, ai: 0 }, kinT = 0, kinN = 0, worst = 0, wet3 = 0, inSees = 0, inSpawn = 0, inFrame = 0;
// every look at the ground made inside GroundAI.frame by the moves and decisions (not by Aim.sees' line of sight, nor
// placing a new vehicle), counted at Terrain itself
var SA = Terrain.surfaceAt, WA = Terrain.waterAt, SEES = Aim.sees, POS = Vessel.prototype.placeOnSurface, FR = GroundAI.frame, KS = GroundAI.kinStep;
Terrain.surfaceAt = function () { if (inFrame && !inSees && !inSpawn) budget.calls++; return SA.apply(this, arguments); };
Terrain.waterAt = function () { if (inFrame && !inSees && !inSpawn) budget.calls++; return WA.apply(this, arguments); };
Aim.sees = function () { inSees++; try { return SEES.apply(this, arguments); } finally { inSees--; } };
Vessel.prototype.placeOnSurface = function () { inSpawn++; try { return POS.apply(this, arguments); } finally { inSpawn--; } };
GroundAI.frame = function (F, dt) { inFrame++; try { budget.ai += GroundAI.ai.length * dt; return FR.call(this, F, dt); } finally { inFrame--; } };
GroundAI.kinStep = function (v, dt) { const t0 = __now(); KS.call(this, v, dt); const d = __now() - t0; kinT += d; kinN++; };
var c0 = GroundAI.calls;
go(F3, 120, (F, f) => { if (f % 30) return; for (const v of GroundAI.ai) { const p = eOf(v); worst = Math.max(worst, Math.abs(p.h - v.ai.k.hoff)); if (p.wet) wet3++; } });
Terrain.surfaceAt = SA; Terrain.waterAt = WA; Aim.sees = SEES; Vessel.prototype.placeOnSurface = POS; GroundAI.frame = FR; GroundAI.kinStep = KS;
var perAI = budget.calls / budget.ai, own = (GroundAI.calls - c0) / budget.ai, us = kinT / kinN * 1000;
console.log('     (measured: ' + perAI.toFixed(1) + ' ground looks a second per AI at Terrain, ' + own.toFixed(1) + ' counted by GroundAI; a move ' + us.toFixed(1) + ' µs in Node; centre off its rest height by at most ' + worst.toFixed(2) + ' m)');`);
t('...over 120 s every AI stays on the ground (its centre within 0.6 m of its height at rest over the ground under it) and out of the water',
  R(`worst < 0.6 && wet3 === 0 && budget.ai > 300`), R('[worst, wet3, budget.ai]'));
t('...each looks at the ground at most 60 times a second (counted at Terrain: moves, attitude fits, looks ahead), and a move takes well under 40 µs',
  R(`perAI <= 60 && perAI > 20 && Math.abs(perAI - own) < 1 && us < 40`), R('[perAI, own, us]'));
R(`go(F3, 60);`);
t('...the rules run: in 3 minutes zones are taken and tickets go (bleeding, knock-outs)', R(`B3.obj.zones.some((z) => z.own >= 0) && (B3.obj.tk[0] < 300 || B3.obj.tk[1] < 300)`), R('[B3.obj.zones.map((z) => z.id + z.own).join(), B3.obj.tk]'));
// an AI knocked out: wreck, tickets, a new one 5 s later on its pad
R(`var en3 = GroundAI.ai.find((v) => v.ai.team === 1), tk3 = B3.obj.tk[1], had3 = new Set(F3.vessels), kos3 = B3.kos;
en3.lastHitBy = F3.active; Armour.knockOut(en3, F3, 'crew');
var lost3 = tk3 - B3.obj.tk[1], want3 = 30 + Math.round(designCost(en3.parts) / 2500), w3 = en3.wreck && F3.vessels.includes(en3);
var news = () => GroundAI.ai.filter((v) => v.ai.team === 1 && !had3.has(v));
go(F3, 4.5); var at45 = news().length;
go(F3, 1); var fresh = news()[0], fp = fresh && eOf(fresh), sp = EARTH.arenas.highland.pads[1];`);
t('...an enemy the player knocks out stays a wreck, costs its side 30 + its price / $2,500 tickets, counts as the player\'s knock-out, and a new one leaves its pad 5 s later',
  R(`w3 && lost3 >= want3 && B3.kos === kos3 + 1 && at45 === 0 && !!fresh && Math.hypot(fp.e - sp.e, fp.z - sp.z) < 60`), R('[w3, lost3, want3, B3.kos, at45, !!fresh]'));
// the player knocked out: respawn after 5 s, the AI and the wrecks kept
R(`var me3 = F3.active, tk3b = B3.obj.tk[0], ai3 = GroundAI.ai.slice(), wr3 = F3.vessels.filter((v) => v.wreck);
Armour.knockOut(me3, F3, 'crew');
var meW = me3.wreck, lostMe = tk3b - B3.obj.tk[0], early = GroundAI.respawn(F3, B3.design);
go(F3, 5.5); var late = GroundAI.respawn(F3, B3.design), kept3 = ai3.filter((v) => !v.dead).every((v) => F3.vessels.includes(v)) && wr3.every((w) => w.dead || F3.vessels.includes(w));`);
t('...the player knocked out: their hulk stays as a wreck, the side loses its tickets, the respawn is refused before 5 s and done after, on the north pad, with every AI and wreck still there',
  R(`meW && lostMe >= 30 && !early && late && F3.active !== me3 && !F3.destroyed && F3.vessels.includes(me3) && kept3 && Combat.S.gai === 1 && !!GroundAI.battle && F3.downs === 1`),
  R('[meW, lostMe, early, late, kept3, F3.downs]'));
R(`var ai4 = GroundAI.ai.slice(), tk4 = B3.obj.tk[0], old4 = F3.active; F3.revert();
var kept4 = ai4.every((v) => F3.vessels.includes(v) && !v.dead), lost4 = tk4 - B3.obj.tk[0];`);
t('...Revert to launch in a Practice Battle: back on the pad in a fresh vehicle, the AI kept (it costs the vehicle\'s tickets, as a knock-out would)',
  R(`kept4 && F3.active !== old4 && lost4 >= 30 && !!GroundAI.battle && Combat.S.gai === 1`), R('[kept4, lost4]'));
R(`var ai5 = GroundAI.ai.slice(); F3.start(designOf('tk34'), { place: NPAD }); go(F3, 0.1);`);
t('...a new flight (Combat.reset: a new launch, a saved flight resumed) ends it: its AI gone, GroundAI.battle null, its zones off the HUD (and a tank on the north pad gets the Tank Range instead)',
  R(`GroundAI.battle === null && GroundMode.obj() === null && ai5.every((v) => v.dead && !F3.vessels.includes(v)) && !!GroundAI.range && GroundAI.ai.every((v) => v.ai.role !== 'fight')`),
  R('[GroundAI.battle === null, GroundMode.obj() === null, ai5.filter((v) => !v.dead).map((v) => v.name), !!GroundAI.range]'));
R(`GroundAI.reset(F3);`);

// ---------------------------------------------------------------- the Tank Range, Hostile: a wave fights
R(`SET.targets = 'hostile';
var F6 = world(); F6.start(designOf('tk34'), { place: { e: 17750, z: 14700, yaw: -Math.PI / 2 } }); // (south of the berm: zone C and the way to it in sight)
var ko6 = null, waveN = 0, ctr6 = counter();
go(F6, 120, (F) => { ctr6.tick(); if (GroundAI.range) waveN = Math.max(waveN, GroundAI.range.left.length); if (ko6 == null && (F.destroyed || (GroundAI.range && GroundAI.range.kos) || F.vessels.some((v) => v.ai && v.ai.ground && v.wreck))) ko6 = F.time; });`);
t('Tank Range (Hostile): a wave of three leaves the south pad after 12 s and fights the player to a knock-out within 120 s',
  R(`waveN === 3 && ctr6.n > 0 && ko6 != null && ko6 < 120`), R('[waveN, ctr6.n, ko6, F6.toasts.slice(0, 4)]'));
// an AA vehicle on the Hostile range: an attack plane (the old range's fighter) a minute in, coming for it as it stands
R(`GroundAI.reset(F6); var F8 = world(); F8.start(designOf('zsy23'), { place: NPAD }); // (in the pad's hollow, out of the wave's sight)
var pl8 = null, d8 = []; go(F8, 75, (F) => { if (!pl8) pl8 = F.vessels.find((o) => o.gaiPlane && o.control); else if (Math.round(F.time * 60) % 60 === 0) d8.push(Math.round(Math.hypot(pl8.x - F.active.x, pl8.y - F.active.y, pl8.z - F.active.z))); });
var flies8 = !!pl8 && !pl8.dead && pl8.kind === 'plane' && !pl8.ai.ground, closing8 = d8.length > 5 && d8[d8.length - 1] < d8[0] - 2000;`);
t('...with AA aboard an attack plane comes in a minute after the start, and makes for the player even standing still (an SPAA has something to shoot)',
  R(`flies8 && closing8 && F8.toasts.includes('Enemy aircraft inbound!')`), R('[flies8, d8.slice(0, 3), d8.slice(-3)]'));
R(`GroundAI.reset(F8);`);
R(`var F6b = world(); F6b.start(designOf('tk34'), { place: NPAD }); go(F6b, 1.5); var was6 = GroundAI.shown && !!GroundAI.range;
F6b.start(designOf('falcon'), {}); go(F6b, 0.1); var after6 = { shown: GroundAI.shown, range: !!GroundAI.range, ai: GroundAI.ai.length };`);
t('...a plane launched next (no ground craft to call GroundAI.frame) still clears what the range left: nothing shown, nothing on the go',
  R(`was6 && !after6.shown && !after6.range && after6.ai === 0 && Combat.S.gai === 0`), R('after6'));
R(`GroundAI.reset(F6); GroundAI.reset(F6b);`);

// ---------------------------------------------------------------- the Hostile gates for Armour (and the car quirk pinned)
R(`SET.targets = 'hostile';
// a high, gentle hilltop in Scotland, 25 km from the space centre (the hostile range reaches 60 km), 233 m up: over the
// SAM sites' 150 m floor
var hi = { e: 22800, z: 19200, yaw: 0 }, hiH = Terrain.surfaceAt(EARTH, siteAngle(EARTH, hi.e), hi.z);
var gate = (key) => {
  const F = world(); F.start(designOf(key), { place: hi }); const v = F.active;
  Combat.reset(F); Combat.S.spawned = true; Combat.S.fighterT = 0;
  const aa = Combat._t.makeTarget('aa'), sam = Combat._t.makeTarget('sam'); aa.e = hi.e + 400; aa.z = hi.z; sam.e = hi.e - 1500; sam.z = hi.z; sam.samT = 0; Combat.S.targets = [aa, sam];
  let aaFire = 0, samN = 0, fighters = 0, moving = 0;
  for (let f = 0; f < 600; f++) {
    if (v.dead || !v.parts.length) break;
    v.ctl.v = 1; v.ctl.h = 0;
    for (let i = 0; i < 2; i++) { for (const o of F.vessels.slice()) if (!o.dead && o.parts.length) o.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; }
    Combat.frame(F, 1 / 60);
    if (aa.firing) aaFire++;
    samN = Math.max(samN, Combat.S.shots.filter((s) => s.k === 'missile' && s.owner === sam).length);
    fighters = Math.max(fighters, F.vessels.filter((o) => o.ai && !o.ai.ground && o.control).length);
    if (!v.landed && v.speed() > 2) moving++;
  }
  return { aaFire, samN, fighters, moving, alt: Math.round(v.altitude()), kind: v.kind };
};
var gT = gate('tk34'), gB = gate('buggy');`);
t('Hostile gates: a TK-34 driving over a hilltop 233 m up draws no AA fire, no SAM and no fighter (Armour flies only once airborne over 1 s and 15 m up)',
  R(`hiH > 200 && gT.moving > 100 && gT.alt > 150 && gT.aaFire === 0 && gT.samN === 0 && gT.fighters === 0`), R('[hiH, gT]'));
t('...a Dune Buggy driving there still does, as it always has (a moving car over 40 m draws AA fire, a SAM over 150 m, and fighters: pinned)',
  R(`gB.moving > 100 && gB.alt > 150 && gB.aaFire > 0 && gB.samN > 0 && gB.fighters > 0`), R('gB'));

// ---------------------------------------------------------------- in a room: none
R(`SET.targets = 'practice'; var MPprev = typeof MP === 'undefined' ? undefined : MP; var MP = { active: true, live: true, shared: false, state: {}, peers: new Map(), enemyGhosts: () => [], sendLock() {}, sendShot() {}, sendSmoke() {}, sendGun() {}, sendHits() {}, enemy: () => true };
var F7 = world(); F7.start(designOf('tk34'), { place: NPAD }); go(F7, 3);
var room = { ai: GroundAI.ai.length, range: !!GroundAI.range, sr: GroundAI.startRange(F7), sb: GroundAI.startBattle(F7, { money: 45000, design: designOf('tk34') }), sp: GroundAI.spawn(F7, 'tk34', 17750, 14400, 0, 1) };
go(F7, 1); room.after = GroundAI.ai.length + F7.vessels.filter((v) => v.ai && v.ai.ground).length; room.gai = Combat.S.gai; room.battle = GroundAI.battle;`);
t('in a multiplayer room no ground AI exists: no range, startRange, startBattle and spawn refuse, nothing on the go',
  R(`room.ai === 0 && !room.range && room.sr === false && room.sb === false && room.sp === null && room.after === 0 && room.gai === 0 && room.battle === null`), R('room'));

t.done();
