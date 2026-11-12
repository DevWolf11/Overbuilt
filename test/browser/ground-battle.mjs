// A ground battle between two tabs of one browser (the "This device" transport, as a player would test it): A creates a
// ground battle, B joins, both build (A the money's stock tank, B a Pumo armoured car) and the host skips to the battle.
// Both start on their own pads on Highland Ridge. A scripted shell from A's gun goes through B's side: the hit, with its
// module rows, reaches B and hurts its crew. B is knocked out: its hulk stays on A's screen as a wreck that burns and
// smokes (the big update), B's team loses
// tickets by B's price, and B comes back through the Respawn panel. A takes zone C, and the battle ends on tickets with
// the results on both screens. Each player's bytes a second are logged. (The big update) B's Pumo carries a Drone Rack:
// back in after its knock-out, B launches a drone; A sees it as B's second craft (c) beside B's still tank, shoots it
// down (it falls on A's screen too), and nothing is booked; the bytes a second with the drone up stay under 20 kB. Screenshots of the lobby, the Respawn panel,
// the bar in the battle and the results at 390x844 and 1280x720 (SHOTS=<dir>, else test/.cache/shots/).
//   node test/browser/ground-battle.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = (process.env.SHOTS || path.join(ROOT, 'test', '.cache', 'shots')) + path.sep;
fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const errs = [];
const ok = checks('ground battle: two tabs');
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
const mk = async (tag) => { const p = await ctx.newPage(); watch(p, errs, tag + ' '); return p; };
const A = await mk('A');
await openGame(A, srv.url);
const B = await mk('B');
await B.goto(srv.url + 'index.html');
await B.waitForTimeout(300);
if (await B.isVisible('[data-mode="sandbox"]')) await B.click('[data-mode="sandbox"]');
for (const p of [A, B]) await p.waitForFunction(() => Terrain.earthMap.state !== 'loading', null, { timeout: 60000 });
const mapState = await A.evaluate(() => Terrain.earthMap.state);
log('map', mapState, 'NET_VERSION', await A.evaluate(() => NET_VERSION));
const shot = async (page, name, sizes = [[390, 844], [1280, 720]]) => {
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { App.resize && App.resize(); App.redraw(); MPUI.scopeAt = 0; });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}3g-${name}-${w}x${h}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
};

// ---- the lobby: A creates a ground battle, B joins
await A.click('#home-mp');
await A.fill('#mp-name', 'Alice'); await A.dispatchEvent('#mp-name', 'change');
await A.click('[data-tr="local"]');
await shot(A, 'connect', [[390, 844]]);
await A.click('#mp-create-ground');
await A.waitForFunction(() => MP.live && Net.code, null, { timeout: 10000 });
const code = await A.evaluate(() => Net.code);
await B.click('#home-mp');
await B.fill('#mp-name', 'Bob'); await B.dispatchEvent('#mp-name', 'change');
await B.click('[data-tr="local"]');
await B.fill('#mp-join-code', code);
await B.click('#mp-join');
await B.waitForFunction(() => MP.live && MP.me, null, { timeout: 10000 });
await A.waitForFunction(() => MP.state.players.length === 2);
let r = await A.evaluate(() => ({ st: MP.state.settings, teams: MP.state.players.map((p) => p.team), kicker: $('#mp-kicker').textContent, game: [...$('#mp-settings').querySelectorAll('.mp-set > span')].map((e) => e.textContent) }));
log('lobby', JSON.stringify(r));
ok('the lobby: a ground battle (Game: Ground), Highland Ridge on the real map, the ground settings shown, teams 0 and 1', r.st.game === 'ground' && r.st.arena === (mapState === 'ready' ? 'highland' : 'runway') && r.teams.join() === '0,1' && /Ground battle/.test(r.kicker)
  && ['Game', 'Format', 'Money', 'Tickets', 'Respawns', 'Air support', 'Aim', 'Arena'].every((k) => r.game.includes(k)) && !r.game.includes('Carriers'), r);
await A.evaluate(() => { MP.setSetting('test', false); MP.setSetting('air', true); }); // (no test drive: straight from building to the battle; air support on)
await B.waitForFunction(() => MP.state.settings.test === false && MP.state.settings.air === true);
await shot(B, 'lobby');

// ---- build: A gets the money's stock tank on its blueprint; B builds a Pumo; the host skips to the battle
await A.evaluate(() => MP.startMatch());
await A.waitForFunction(() => App.scene === 'build' && Builder.mp, null, { timeout: 10000 });
await B.waitForFunction(() => App.scene === 'build' && Builder.mp, null, { timeout: 10000 });
r = await A.evaluate(() => ({ kind: Builder.kind, name: Builder.name, kinds: Builder.mp.kinds, spawn: MP.spawnId, map: !$('#spawn-map').hidden }));
log('A builds', JSON.stringify(r));
ok('the build phase: Armour on the blueprint (the money\'s stock tank), only Armour and cars, each team its pad, no spawn map', r.kind === 'tank' && r.kinds.join() === 'tank,car' && r.spawn === 'pad0' && !r.map, r);
// (the big update: a Drone Rack on the Pumo's deck, its drone a Bumble)
const BUMBLE = [['drFrameS', 0, 0], ['drFC', 0, 0.0375, 0, { att: 0 }], ['drCam', 0.155, 0.0425, 0, { att: 0 }], ['drLink', -0.1, 0.0325, 0, { att: 0 }],
  ['drMotorS', 0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', 0.15, 0.0475, 0, { z: -0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: -0.15, att: 0 }],
  ['drBattS', -0.03, -0.0425, 0, { att: 0 }], ['drCharge', 0.06, -0.1125, 3, { att: 8 }]].map((r) => ({ type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: r[1] < 0, ...(r[4] || {}) }));
await B.evaluate((rows) => { Builder.loadTemplate('pumo'); Builder.quickAdd('dockRack'); Builder.droneChoice = TEMPLATES.bumble && TEMPLATES.bumble.kind === 'drone' ? { key: 'bumble' } : Drone.cleanChoice({ name: 'Bumble', parts: rows }); Builder.changed(true); }, BUMBLE);
await B.waitForTimeout(300);
await A.evaluate(() => MP.advance());
for (const p of [A, B]) await p.waitForFunction(() => Flight.running && MP.phase === 'battle' && Flight.active && Flight.time > 0.5, null, { timeout: 60000 });
for (const p of [A, B]) await p.evaluate(() => { Render3D.skipDraw = true; });
await A.waitForFunction(() => MP.peers.get(2) && MP.peers.get(2).ghost, null, { timeout: 20000 });
await B.waitForFunction(() => MP.peers.get(1) && MP.peers.get(1).ghost, null, { timeout: 20000 });
const bytes0 = await Promise.all([A, B].map((p) => p.evaluate(() => ({ i: Net.bytesIn, o: Net.bytesOut, t: performance.now() }))));
const where = (p) => p.evaluate(() => { const v = Flight.active, q = mpEZ(v.x, v.y, v.z, {}); return { e: q.e, z: q.z, kind: v.kind, name: v.name, alt: v.groundAltitude(), obj: MP.state.obj }; });
const wa = await where(A), wb = await where(B);
log('A at', JSON.stringify([wa.e, wa.z, wa.name, wa.alt]), 'B at', JSON.stringify([wb.e, wb.z, wb.name, wb.alt]));
const padN = await A.evaluate(() => GroundMode.placement(MP.state.settings.arena, 0, 0, 'tank')), padS = await A.evaluate(() => GroundMode.placement(MP.state.settings.arena, 1, 0, 'tank'));
ok('both start on their own pads (A north, B south), on the ground', Math.hypot(wa.e - padN.e, wa.z - padN.z) < 3 && Math.hypot(wb.e - padS.e, wb.z - padS.z) < 3 && Math.abs(wa.alt) < 3 && Math.abs(wb.alt) < 3 && wb.kind === 'tank' && wb.name === 'Pumo 8×8', [wa, wb, padN, padS]);
ok('the objective: tickets for both, the zones (a duel: zone C)', wa.obj && wa.obj.tk.join() === '600,600' && wb.obj && wb.obj.zones.length === 1 && wb.obj.zones[0].id === 'C', wa.obj);
await B.evaluate(() => { Render3D.skipDraw = false; });
await shot(B, 'bar-battle');
await B.evaluate(() => { Render3D.skipDraw = true; });

// ---- a shell from A's gun into B's side, 25 m off: the hit and its module rows reach B, whose crew is hurt (once
// its 4 s of spawn protection are over: sim time, which runs slow on software WebGL)
await B.waitForFunction(() => Flight.time - Flight.active.spawnAt > 4.5, null, { timeout: 120000 });
await B.evaluate(() => { window.__hits = []; Net.on('hit', (m) => window.__hits.push(JSON.parse(JSON.stringify(m)))); window.__mods0 = JSON.stringify(Flight.active.parts.map((p) => p.mods || null)); });
const fired = await A.evaluate(() => {
  const v = Flight.active, g = MP.peers.get(2).ghost, gun = v.parts.find((p) => p.def.weapon && p.def.weapon.kind === 'tgun'), key = gun.def.weapon.shells ? gun.def.weapon.shells[0] : Object.keys(SHELLS).find((k) => SHELLS[k].cal === gun.def.weapon.cal);
  const SH = SHELLS[key], c = g.toWorld(g.com.x, g.com.y + 0.2, g.com.z || 0), side = g.axis(0, 0, 1), o = { x: c.x + side.x * 25, y: c.y + side.y * 25, z: c.z + side.z * 25 };
  const dx = c.x - o.x, dy = c.y - o.y, dz = c.z - o.z, d = Math.hypot(dx, dy, dz);
  const s = { k: 'shell', sh: key, b: v.body, x: o.x, y: o.y, z: o.z, vx: (dx / d) * SH.v0, vy: (dy / d) * SH.v0, vz: (dz / d) * SH.v0, t: 0, life: SH.life || 6, owner: v, enemy: true, net: 0,
    cal: SH.cal, pen: SH.pen || 0, v0: SH.v0, spare: v, tracer: true, prox: SH.prox || 0, ric: false, gTop: Infinity };
  Combat.S.shots.push(s); MP.sendShot(s); Armour.fb.shot = null;
  return { key, cal: SH.cal, pen: SH.pen };
});
log('A fires', JSON.stringify(fired));
await A.waitForFunction(() => Armour.fb.shot, null, { timeout: 20000 });
await B.waitForFunction(() => window.__hits.length > 0, null, { timeout: 20000 });
await B.waitForTimeout(500);
r = await B.evaluate(() => ({ hits: window.__hits, hurt: JSON.stringify(Flight.active.parts.map((p) => p.mods || null)) !== window.__mods0, crew: Armour.crewOf(Flight.active).crew.map((e) => e.alive), by: Flight.active.lastHitBy && Flight.active.lastHitBy.remote, ko: Flight.active.ko || null, copies: Combat.S.shots.filter((s) => s.k === 'shell').length }));
const fbA = await A.evaluate(() => Armour.fb.shot);
log('A saw', JSON.stringify(fbA), '| B got', JSON.stringify(r.hits.map((m) => ({ k: m.k, list: m.list.length, m: m.m && m.m.length, d: m.d }))), 'crew', JSON.stringify(r.crew), 'ko', JSON.stringify(r.ko));
ok('A\'s shell goes through B\'s side (A\'s own resolution says so)', fbA && fbA.r === 'pen', fbA);
ok('the hit reaches B: kind pen, part rows and module rows (m), where it came from (d)', r.hits.some((m) => m.k === 'pen' && m.list.length > 0 && Array.isArray(m.m) && m.m.length > 0 && Array.isArray(m.d)) && r.by === 1, r.hits);
ok('...and B\'s crew is hurt (its modules took damage)', r.hurt);

// ---- B knocked out (if the shell didn't finish it): its hulk stays on A's screen, B's team pays tickets by its price
const tk0 = await A.evaluate(() => MP.state.obj.tk[1]);
await B.evaluate(() => { if (!Flight.active.ko) Armour.knockOut(Flight.active, Flight, 'crew'); });
await A.waitForFunction(() => MP.wrecks.length === 1 && MP.player(2) && !MP.player(2).flying, null, { timeout: 20000 });
r = await A.evaluate((tk0) => ({ wreck: MP.wrecks[0].v.wreck, inWorld: Flight.vessels.includes(MP.wrecks[0].v), ghost: !!MP.peers.get(2).ghost, tk: MP.state.obj.tk[1], cost: MP.battleCost.get(2), lost: tk0 - MP.state.obj.tk[1], kills: MP.me.kills, score: MP.me.score }), tk0);
log('A after the knock-out', JSON.stringify(r));
ok('B knocked out: its hulk stays on A\'s screen as a wreck (not a ghost any more)', r.wreck && r.inWorld && !r.ghost, r);
// (the big update) ...and there it burns, then smokes, as any wreck does (death.js's wreckFX: its knock-out, g.ko)
const fire = await A.evaluate(async () => {
  const g = MP.wrecks[0].v, c = Death._g.burnPoint(g), fl = FX.flame, sm = FX.smoke, n = { f: 0, s: 0 }, near = (at) => !!c && Math.hypot(at.x - c.x, at.y - c.y, at.z - c.z) < 1.5;
  FX.flame = function (b, at) { if (near(at)) n.f++; return fl.apply(this, arguments); };
  FX.smoke = function (b, at) { if (near(at)) n.s++; return sm.apply(this, arguments); };
  const t0 = Flight.time;
  await new Promise((ok) => { const f = () => (Flight.time > t0 + 2 ? ok() : requestAnimationFrame(f)); f(); });
  FX.flame = fl; FX.smoke = sm;
  return { ko: g.ko, ...n, d: Math.round(Flight.dist(Flight.absPos(g), Flight.camAbs)) };
});
log('B\'s wreck on A\'s screen', JSON.stringify(fire));
ok('...and on A\'s screen it burns and smokes as any wreck (knocked out, g.ko: flames and a smoke column from it)', !!fire.ko && fire.f > 3 && fire.s > 0, fire);
ok('B\'s team loses 30 + price/2,500 tickets, priced by the host from B\'s spawn rows; A scores the kill', r.lost === 30 + Math.round(r.cost / 2500) && r.cost > 0 && r.kills === 1 && r.score === 3, r);

// ---- B's Respawn panel, then back in (its own vehicle)
await B.waitForFunction(() => !$('#modal').hidden && document.querySelector('#modal .rsp'), null, { timeout: 20000 });
await B.evaluate(() => { Render3D.skipDraw = false; });
await shot(B, 'respawn', [[390, 844], [844, 390], [1280, 720]]);
await B.evaluate(() => { Render3D.skipDraw = true; });
r = await B.evaluate(() => ({ title: $('#modal-card .modal-title').textContent, opts: [...document.querySelectorAll('#modal .rsp-opt')].map((b) => [b.querySelector('b').textContent, b.disabled]), wait: $('#modal .rsp-wait').textContent }));
log('B respawn panel', JSON.stringify(r));
ok('the Respawn panel: who did it, the vehicle to come back in, another one, and a countdown', /Knocked out by Alice/.test(r.title) && r.opts.some(([t]) => /Your vehicle \(Pumo/.test(t)) && r.opts.some(([t]) => /Change vehicle/.test(t)), r);
// the Aircraft button keeps up with the open panel: a sortie point comes (the host's word), the minute after the last
// sortie counts down on it, and it comes on by itself
const airBtn = () => B.evaluate(() => { const b = [...document.querySelectorAll('#modal .rsp-opt')].find((x) => /^Aircraft/.test(x.textContent)); return b ? { text: b.querySelector('span').textContent, off: b.disabled } : null; });
const air0 = await airBtn();
await A.evaluate(() => { const p = MP.player(2); p.sorties = 1; p.sortieEnd = Net.hostNow() - 56500; MP.push(); });
await B.waitForFunction(() => { const b = [...document.querySelectorAll('#modal .rsp-opt')].find((x) => /^Aircraft/.test(x.textContent)); return b && b.disabled && /ready in \d s/.test(b.textContent); }, null, { timeout: 10000 });
const air1 = await airBtn();
await B.waitForFunction(() => { const b = [...document.querySelectorAll('#modal .rsp-opt')].find((x) => /^Aircraft/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 15000 });
const air2 = await airBtn();
log('B\'s Aircraft button', JSON.stringify([air0, air1, air2]));
ok('...its Aircraft button counts down the minute after a sortie and comes on by itself, the panel open all along', air0 && air0.off && /sortie points/.test(air0.text) && air1.off && /1 sortie point · ready in \d s/.test(air1.text) && !air2.off && /one a flight/.test(air2.text), [air0, air1, air2]);
await B.waitForFunction(() => { const b = [...document.querySelectorAll('#modal .rsp-opt')].find((x) => /Your vehicle/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 20000 });
await B.evaluate(() => [...document.querySelectorAll('#modal .rsp-opt')].find((x) => /Your vehicle/.test(x.textContent)).click());
await B.waitForFunction(() => !Flight.destroyed && Flight.active && !Flight.active.ko && Flight.time > 0.3, null, { timeout: 30000 });
await A.waitForFunction(() => MP.peers.get(2) && MP.peers.get(2).ghost && MP.player(2).flying, null, { timeout: 20000 });
r = await B.evaluate(() => { const v = Flight.active, q = mpEZ(v.x, v.y, v.z, {}); return { e: q.e, z: q.z, wrecks: MP.wrecks.length, hulk: MP.wrecks.some((w) => w.pid === Net.me && Flight.vessels.includes(w.v)), name: v.name }; });
const ra = await A.evaluate(() => ({ wrecks: MP.wrecks.length, inWorld: MP.wrecks.every((w) => Flight.vessels.includes(w.v)) }));
log('B back in', JSON.stringify(r), 'A wrecks', JSON.stringify(ra));
ok('B respawns through the panel, back on its pad (its own hulk stays where it was), and A still sees the old wreck', Math.hypot(r.e - padS.e, r.z - padS.z) < 30 && r.hulk && ra.wrecks === 1 && ra.inWorld, [r, ra]);

// ---- (the big update) B launches a drone from the Pumo's Drone Rack: on A's screen it is B's second craft (its own
// ghost, c), B's tank ghost staying where it is; A shoots it down (it falls there too); nothing is booked
await B.waitForFunction(() => Flight.active && Flight.active.speed() < 1 && Flight.time - (Flight.active.spawnAt || 0) > 1, null, { timeout: 60000 });
const up = await B.evaluate(() => { const C = Flight.active, docks = C.docks.length, ok = Drone.launch(Flight, C), d = Flight.active; return { docks, choice: !!C.droneChoice, ok, kind: d.kind, c: d.craft, extra: MP.extra.size }; });
log('B launches', JSON.stringify(up));
ok('B launches a drone from its Drone Rack: B flies it, our second craft in the room (c)', up.docks > 0 && up.ok && up.kind === 'drone' && up.c >= 1 && up.extra === 1, up);
await A.waitForFunction(() => { const P = MP.peers.get(2), E = P && P.x && [...P.x.values()][0], g = E && E.ghost; return !!g && !g.hiddenUntilSnap; }, null, { timeout: 30000 });
const seenA = () => A.evaluate(() => { const P = MP.peers.get(2), E = P.x && [...P.x.values()][0], g = E && E.ghost, t = P.ghost, U = (o) => { const r = Math.hypot(o.x, o.y, o.z); return { x: o.x / r, y: o.y / r, z: o.z / r }; };
  const u = t ? U(t) : null, h = g && t ? (g.x - t.x) * u.x + (g.y - t.y) * u.y + (g.z - t.z) * u.z : null;
  return { c: E && E.c, name: g && g.name, kind: g && g.kind, craft: g && g.craft, tank: t ? [t.x, t.y, t.z] : null, tankKind: t && t.kind, h, extras: MP.extraGhosts().length, main: MP.ghosts().length, inWorld: !!g && Flight.vessels.includes(g) }; });
const s0 = await seenA();
const bytesD0 = await Promise.all([A, B].map((p) => p.evaluate(() => ({ i: Net.bytesIn, o: Net.bytesOut, t: performance.now() }))));
await B.evaluate(() => { const d = Flight.active, r = Math.hypot(d.x, d.y, d.z); for (const k of ['x', 'y', 'z']) d[k] += (d[k] / r) * 30; }); // (up 30 m: B's own craft, as if flown there)
await A.waitForFunction((y0) => { const E = [...MP.peers.get(2).x.values()][0], g = E && E.ghost, t = MP.peers.get(2).ghost; const r = Math.hypot(t.x, t.y, t.z); return g && (g.x - t.x) * t.x / r + (g.y - t.y) * t.y / r + (g.z - t.z) * t.z / r > 25; }, null, { timeout: 30000 });
await A.waitForTimeout(6000);
const bytesD1 = await Promise.all([A, B].map((p) => p.evaluate(() => ({ i: Net.bytesIn, o: Net.bytesOut, t: performance.now() }))));
const s1 = await seenA();
const rateD = [0, 1].map((i) => { const s = (bytesD1[i].t - bytesD0[i].t) / 1000; return { in: Math.round((bytesD1[i].i - bytesD0[i].i) / s), out: Math.round((bytesD1[i].o - bytesD0[i].o) / s), s: +s.toFixed(1) }; });
log('A sees B\'s drone', JSON.stringify([s0, s1]), 'bytes a second with it up', JSON.stringify(rateD));
ok('A sees B\'s drone as B\'s second craft ("Bob\'s drone", c), beside B\'s tank ghost, which stays where it is (not a ghost of the main craft)',
  s1.kind === 'drone' && s1.craft === s1.c && s1.name === "Bob's drone" && s1.tankKind === 'tank' && s1.extras === 1 && s1.main === 1 && s1.inWorld && s1.h > 25 && Math.hypot(s1.tank[0] - s0.tank[0], s1.tank[1] - s0.tank[1], s1.tank[2] - s0.tank[2]) < 0.5, [s0, s1]);
ok('network: with a drone up each player still sends and receives under 20 kB a second', rateD.every((x) => x.in < 20000 && x.out < 20000 && x.out > 100), rateD);
const before = await A.evaluate(() => ({ tk: MP.state.obj.tk.slice(), kills: MP.me.kills, deaths: MP.player(2).deaths, flying: MP.player(2).flying, feed: MP.state.feed.length }));
await A.evaluate(() => { const E = [...MP.peers.get(2).x.values()][0], g = E.ghost, fc = g.parts.find((p) => p.def.drone && p.def.drone.fc); window.__toasts = []; const t0 = UI.toast; UI.toast = function (t, k) { window.__toasts.push(t); return t0.apply(this, arguments); }; MP.sendHit(g, fc, 400, 'shot'); });
await A.waitForFunction(() => !MP.extraGhosts().length, null, { timeout: 30000 });
const fallA = await A.evaluate(async () => { const h = Flight.vessels.find((o) => o.foreign === 2 && o.kind === 'drone' && o.hulk != null); if (!h) return null;
  const alt = () => h.groundAltitude(), a0 = alt(), t0 = Flight.time; await new Promise((ok) => { const f = () => (Flight.time > t0 + 0.6 || h.dead ? ok() : requestAnimationFrame(f)); f(); }); return { a0, a1: h.dead ? -1 : alt(), dead: h.dead }; });
await B.waitForFunction(() => Flight.active && Flight.active.kind !== 'drone' && !MP.extra.size, null, { timeout: 30000 });
const after = await A.evaluate(() => ({ tk: MP.state.obj.tk.slice(), kills: MP.me.kills, deaths: MP.player(2).deaths, flying: MP.player(2).flying, feed: MP.state.feed.length, toasts: window.__toasts, tank: !!MP.peers.get(2).ghost }));
const bAfter = await B.evaluate(() => ({ kind: Flight.active.kind, destroyed: Flight.destroyed, extra: MP.extra.size }));
log('A downs B\'s drone', JSON.stringify({ before, after, fallA, bAfter }));
ok('A\'s hit downs B\'s drone: it falls on A\'s screen (a hulk of A\'s physics), A is told "Bob\'s drone down!", B is back in its tank', !!fallA && (fallA.dead || fallA.a1 < fallA.a0) && after.toasts.includes("Bob's drone down!") && bAfter.kind === 'tank' && !bAfter.destroyed && bAfter.extra === 0 && after.tank, { fallA, after, bAfter });
ok('...and nothing is booked: no tickets move, no kill, no death, B still in the fight', JSON.stringify(after.tk) === JSON.stringify(before.tk) && after.kills === before.kills && after.deaths === before.deaths && after.flying && after.feed === before.feed, [before, after]);

// ---- A takes zone C (parked in it on the ground: 20 s alone), then the battle ends on tickets
await A.evaluate(() => { const v = Flight.active, C = MP.state.obj.zones[0]; v.placeOnSurface(EARTH, siteAngle(EARTH, C.e), VEHICLE_KINDS.tank.launchRot, C.z, -Math.PI / 2); v.vx = v.vy = v.vz = 0; v.av = v3(0, 0, 0); });
// (the sight lines spotting looks along, timed while A sits 1.2 km from B's pad: spec §14, at most 10 a second of
// sim time and 0.15 ms each; Aim.sees remembers each pair for half a second)
await A.evaluate(() => { const S = Aim.sees, w = (window.__sees = { n: 0, ms: 0, fresh: 0, t0: Flight.time, w0: performance.now() });
  Aim.sees = function (a, b, o) { const t = performance.now(), M = this._sees.get(a), had = M && M.get(b) && M.get(b).t; const r = S.call(this, a, b, o); const M2 = this._sees.get(a); if (M2 && M2.get(b) && M2.get(b).t !== had) { w.fresh++; w.ms += performance.now() - t; } w.n++; return r; }; });
await A.evaluate(() => { Render3D.skipDraw = false; });
await A.waitForFunction(() => MP.state.obj.zones[0].p < -0.2, null, { timeout: 30000 });
await shot(A, 'bar-capture', [[390, 844], [375, 667], [844, 390], [1280, 720]]);
await A.evaluate(() => { Render3D.skipDraw = true; });
await A.waitForFunction(() => MP.state.obj.zones[0].own === 0, null, { timeout: 40000 });
const sees = await A.evaluate(() => { const w = window.__sees, s = Flight.time - w.t0, ws = (performance.now() - w.w0) / 1000; return { calls: w.n, fresh: w.fresh, perSimS: +(w.fresh / Math.max(1e-3, s)).toFixed(1), perWallS: +(w.fresh / ws).toFixed(1), msEach: +(w.ms / Math.max(1, w.fresh)).toFixed(3), simS: +s.toFixed(1), wallS: +ws.toFixed(1) }; });
log('spotting sight lines on A:', JSON.stringify(sees));
ok('spotting: sight lines looked at afresh at most 10 a second (of game time), each well under a millisecond', sees.fresh > 0 && sees.perSimS <= 10 && sees.msEach < 1, sees);
await B.waitForFunction(() => MP.state.obj && MP.state.obj.zones[0].own === 0, null, { timeout: 10000 });
r = await A.evaluate(() => ({ feed: MP.state.feed.map((f) => f.text), caps: MP.me.caps, score: MP.me.score }));
log('A took C', JSON.stringify(r));
ok('A takes zone C: the feed says so, and A scores the capture', r.feed.includes('Faroes took C') && r.caps === 1 && r.score === 5, r);
const bytes1 = await Promise.all([A, B].map((p) => p.evaluate(() => ({ i: Net.bytesIn, o: Net.bytesOut, t: performance.now() }))));
const rate = [0, 1].map((i) => { const s = (bytes1[i].t - bytes0[i].t) / 1000; return { in: Math.round((bytes1[i].i - bytes0[i].i) / s), out: Math.round((bytes1[i].o - bytes0[i].o) / s), s: +s.toFixed(1) }; });
log('bytes a second in the battle (host A, client B):', JSON.stringify(rate));
ok('network: each player sends and receives under 20 kB a second in the battle', rate.every((x) => x.in < 20000 && x.out < 20000 && x.out > 100), rate);
await A.evaluate(() => { MP.state.obj.tk[1] = 3; }); // (they bleed a ticket a second while we hold the only zone)
for (const p of [A, B]) await p.waitForFunction(() => MP.phase === 'results' && !$('#modal').hidden, null, { timeout: 30000 });
r = await B.evaluate(() => ({ kicker: $('#modal-card .modal-kicker').textContent, title: $('#modal-card .modal-title').textContent, head: [...document.querySelectorAll('#modal th')].map((e) => e.textContent), res: MP.state.result }));
const ra2 = await A.evaluate(() => ({ title: $('#modal-card .modal-title').textContent }));
log('results on B', r.kicker, '/', r.title, '| A', ra2.title);
ok('the battle ends on tickets: Faroes win, the results on both screens (Victory for A, Defeat for B), the ground scoreboard', r.res.ground && r.res.winner === 0 && r.res.why === 'tickets' && /Faroes win on tickets \(\d+ – 0\)/.test(r.kicker) && r.title === 'Defeat' && ra2.title === 'Victory!'
  && r.head.join() === 'Player,Team,Kills,Caps,Lost,Score,Ping', r);
await shot(B, 'results');
// on a narrow phone in portrait the Score column (the result's own number) fits without a sideways scroll: the Team
// column goes, the names wear their team's colour
const narrow = [];
for (const [w, h] of [[360, 780], [375, 667]]) {
  await B.setViewportSize({ width: w, height: h });
  await B.waitForTimeout(200);
  narrow.push(await B.evaluate(() => {
    const wrap = $('#modal .mp-twrap').getBoundingClientRect(), rows = [...document.querySelectorAll('#modal .mp-gtable tr')];
    const score = rows.map((tr) => [...tr.children].find((c, i) => rows[0].children[i].textContent === 'Score').getBoundingClientRect());
    const col = (e) => getComputedStyle(e).color; // (a name in its team's colour, not the plain text's)
    return { w: innerWidth, fits: score.every((r) => r.left >= wrap.left - 0.5 && r.right <= wrap.right + 0.5), team: getComputedStyle(rows[0].children[1]).display, coloured: rows.slice(1).every((tr) => col(tr.children[0]) !== col(tr.children[2])) };
  }));
}
await B.setViewportSize({ width: 1280, height: 720 });
ok('the results on a 360- and 375-wide phone: Score in full, no Team column, the names in their team\'s colour', narrow.every((n) => n.fits && n.team === 'none' && n.coloured), narrow);

// ---- a second battle with a Lineup of 3: the build phase's bar shows the three slots; slot 2 changes from a list
await A.evaluate(() => MP.backToLobby());
for (const p of [A, B]) await p.waitForFunction(() => MP.phase === 'lobby' && App.scene === 'mp', null, { timeout: 20000 });
r = await A.evaluate(() => ({ wrecks: MP.wrecks.length, obj: 'obj' in MP.state }));
ok('back in the lobby: no wrecks, no objective', r.wrecks === 0 && !r.obj, r);
await A.evaluate(() => { MP.setSetting('respawn', 'lineup'); MP.startMatch(); });
await B.waitForFunction(() => App.scene === 'build' && !$('#mp-lineup').hidden, null, { timeout: 20000 });
r = await B.evaluate(() => [...document.querySelectorAll('#mp-lineup .mp-slot')].map((b) => b.textContent));
log('B lineup', JSON.stringify(r));
ok('Lineup of 3: the bar shows the three slots while building (1: the blueprint, 2 and 3: stock vehicles for the money)', r.length === 3 && /Your build/.test(r[0]) && /TK-72/.test(r[1]) && /Leapard 1/.test(r[2]), r);
await B.evaluate(() => MPUI.lineupPick(2));
await B.waitForFunction(() => !$('#modal').hidden && document.querySelectorAll('#modal .rsp-opt').length > 3);
await shot(B, 'lineup-pick', [[390, 844]]);
await B.evaluate(() => [...document.querySelectorAll('#modal .rsp-opt')].find((b) => /MS-4/.test(b.textContent)).click());
await B.waitForFunction(() => /MS-4/.test($('#mp-lineup').textContent));
await shot(B, 'lineup', [[390, 844], [1280, 720]]);
ok('a lineup slot changes from the list of vehicles that fit', await B.evaluate(() => MP.lineup[2] && MP.lineup[2].key === 'ms4'));
ok('no page errors', errs.length === 0, errs.slice(0, 10).join('\n'));
ok.done();
await b.close(); srv.close();
