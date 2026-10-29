// A ground battle between two tabs of one browser (the "This device" transport, as a player would test it): A creates a
// ground battle, B joins, both build (A the money's stock tank, B a Pumo armoured car) and the host skips to the battle.
// Both start on their own pads on Highland Ridge. A scripted shell from A's gun goes through B's side: the hit, with its
// module rows, reaches B and hurts its crew. B is knocked out: its hulk stays on A's screen as a wreck, B's team loses
// tickets by B's price, and B comes back through the Respawn panel. A takes zone C, and the battle ends on tickets with
// the results on both screens. Each player's bytes a second are logged. Screenshots of the lobby, the Respawn panel,
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
await B.evaluate(() => { Builder.loadTemplate('pumo'); Builder.changed(true); });
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
