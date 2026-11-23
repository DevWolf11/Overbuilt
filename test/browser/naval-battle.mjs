// A naval battle between two tabs of one browser (the "This device" transport, as a player would test it; the ships
// update, spec §10): A creates a naval battle from its own button, B joins; the lobby shows the naval settings (the sea,
// the Shetland Sound); both build from the money's stock corvette and the host skips to the battle; both start at their
// own ends of the Sound, afloat, 7 km apart, each with the other's ghost. B's corvette is brought 700 m off A's beam: a
// 57 mm round from A holes her (the hit's ho rows), her holes on both screens (her own hull, and A's ghost of her: hull);
// A's torpedo runs on both screens (B's copy beside A's own) and holes her under the water; then, holed past saving, she
// sinks on both screens (down.sea: A's ghost of her goes down with her snapshots, and settles as a wreck on the bed at
// the same place on both); B's Respawn panel; and time up, the result on both. Each player's bytes a second, and the
// console clean. Screenshots (SHOTS=<dir>, else test/.cache/shots/) of the connect screen, the lobby, the build, the
// battle with the other ship, her sinking, the Respawn panel and the results, at 390x844 and 1280x720.
//   node test/browser/naval-battle.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = (process.env.SHOTS || path.join(ROOT, 'test', '.cache', 'shots')) + path.sep;
fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const errs = [];
const ok = checks('naval battle: two tabs');
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
const mk = async (tag) => { const p = await ctx.newPage(); watch(p, errs, tag + ' '); return p; };
const A = await mk('A');
await openGame(A, srv.url);
const B = await mk('B');
await B.goto(srv.url + 'index.html');
await B.waitForTimeout(300);
for (const p of [A, B]) await p.waitForFunction(() => Terrain.earthMap.state !== 'loading', null, { timeout: 90000 });
const mapState = await A.evaluate(() => Terrain.earthMap.state);
log('map', mapState, 'NET_VERSION', await A.evaluate(() => NET_VERSION));
ok('the real map is in (the Sound is on it) and NET_VERSION is 14', mapState === 'ready' && (await A.evaluate(() => NET_VERSION)) === 14);
const shot = async (page, name, sizes = [[390, 844], [1280, 720]]) => {
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { App.resize && App.resize(); App.redraw && App.redraw(); MPUI.scopeAt = 0; });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}naval-${name}-${w}x${h}.png` });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
};
// a picture of the flight (the renderer on for a moment: off otherwise, so the sim runs nearer real time)
const flightShot = async (page, name, sizes) => { await page.evaluate(() => { Render3D.skipDraw = false; }); await shot(page, name, sizes); await page.evaluate(() => { Render3D.skipDraw = true; }); };
const holes = (expr) => `(() => { const v = ${expr}; return v ? +v.parts.reduce((s, p) => s + (p.holes ? p.holes.reduce((q, h) => q + h.a, 0) : 0), 0).toFixed(4) : -1; })()`;
const simWait = (p, secs) => p.evaluate((s) => new Promise((ok) => { const t0 = Flight.time; const f = () => (Flight.time > t0 + s ? ok() : requestAnimationFrame(f)); f(); }), secs);

// ---- the connect screen: the naval battle's own button; A creates one, B joins
await A.click('#home-mp');
await A.fill('#mp-name', 'Alice'); await A.dispatchEvent('#mp-name', 'change');
await A.click('[data-tr="local"]');
let r = await A.evaluate(() => { const b = $('#mp-create-naval'); return { on: !b.disabled, name: b.querySelector('.hb-name').textContent, sub: b.querySelector('.hb-sub').textContent }; });
ok('the connect screen has a Create naval battle button, on with the map', r.on && r.name === 'Create naval battle' && /Shetland Sound/.test(r.sub), r);
await shot(A, 'connect');
await A.click('#mp-create-naval');
await A.waitForFunction(() => MP.live && Net.code, null, { timeout: 10000 });
const code = await A.evaluate(() => Net.code);
await B.click('#home-mp');
await B.fill('#mp-name', 'Bob'); await B.dispatchEvent('#mp-name', 'change');
await B.click('[data-tr="local"]');
await B.fill('#mp-join-code', code);
await B.click('#mp-join');
await B.waitForFunction(() => MP.live && MP.me, null, { timeout: 10000 });
await A.waitForFunction(() => MP.state.players.length === 2);
r = await B.evaluate(() => ({ st: MP.state.settings, teams: MP.state.players.map((p) => p.team), kicker: $('#mp-kicker').textContent, rows: [...$('#mp-settings').querySelectorAll('.mp-set > span')].map((e) => e.textContent),
  arena: $('#mp-settings .mp-arena') && $('#mp-settings .mp-arena').textContent, naval: MP.naval, ground: MP.ground }));
log('lobby', JSON.stringify(r));
ok('the lobby: a naval battle (Game: Naval, MP.naval, never MP.ground), the Shetland Sound, the sea and the naval settings shown, teams 0 and 1',
  r.st.game === 'naval' && r.st.arena === 'sound' && r.st.sea === 'moderate' && r.naval && !r.ground && r.teams.join() === '0,1' && /Naval battle/.test(r.kicker) && /Shetland Sound/.test(r.arena)
  && ['Game', 'Format', 'Money', 'Tickets', 'Respawns', 'Air support', 'Sea', 'Aim', 'Sea trial', 'Arena'].every((k) => r.rows.includes(k)) && !r.rows.includes('Carriers'), r);
await A.evaluate(() => { MP.setSetting('test', false); MP.setSetting('sea', 'calm'); }); // (no sea trial: straight from building to the battle; a calm sea)
await B.waitForFunction(() => MP.state.settings.test === false && MP.state.settings.sea === 'calm' && Ship.sea() === 'calm');
ok('the host\'s sea is everyone\'s (calm on both screens)', (await A.evaluate(() => Ship.sea())) === 'calm' && (await B.evaluate(() => Ship.sea())) === 'calm');
await shot(B, 'lobby');

// ---- build: both get the money's stock corvette ($75k: the Vizby) on the blueprint; the host skips to the battle
await A.evaluate(() => MP.startMatch());
for (const p of [A, B]) await p.waitForFunction(() => App.scene === 'build' && Builder.mp, null, { timeout: 15000 });
r = await A.evaluate(() => ({ kind: Builder.kind, kinds: Builder.mp.kinds, spawn: MP.spawnId, map: !$('#spawn-map').hidden, cost: Builder.statsData && Builder.statsData.cost, budget: Builder.mp.budget }));
log('A builds', JSON.stringify(r));
ok('the build phase: a ship on the blueprint (the money\'s stock corvette), only ships, each team its end of the Sound, no spawn map', r.kind === 'ship' && r.kinds.join() === 'ship' && r.spawn === 'sea0' && !r.map && r.cost <= r.budget, r);
await shot(B, 'build');
await A.evaluate(() => MP.advance());
for (const p of [A, B]) await p.waitForFunction(() => Flight.running && MP.phase === 'battle' && Flight.active && Flight.time > 0.5, null, { timeout: 90000 });
for (const p of [A, B]) await p.evaluate(() => { Render3D.skipDraw = true; });
await A.waitForFunction(() => MP.peers.get(2) && MP.peers.get(2).ghost && !MP.peers.get(2).ghost.hiddenUntilSnap, null, { timeout: 30000 });
await B.waitForFunction(() => MP.peers.get(1) && MP.peers.get(1).ghost && !MP.peers.get(1).ghost.hiddenUntilSnap, null, { timeout: 30000 });
const bytes0 = await Promise.all([A, B].map((p) => p.evaluate(() => ({ i: Net.bytesIn, o: Net.bytesOut, t: performance.now() }))));
const where = (p) => p.evaluate(() => { const v = Flight.active, q = mpEZ(v.x, v.y, v.z, {}), g = [...MP.peers.values()][0].ghost; return { e: q.e, z: q.z, kind: v.kind, name: v.name, afloat: v.afloat, ghost: g && { afloat: g.afloat, hydro: g.hydro, sh: !!g.sh }, obj: MP.state.obj, sea: Ship.S.seaOff }; });
await simWait(A, 2); await simWait(B, 2);
const wa = await where(A), wb = await where(B);
log('A at', JSON.stringify([wa.e, wa.z, wa.name]), 'B at', JSON.stringify([wb.e, wb.z, wb.name]));
ok('both start at their own ends of the Sound (A West, B East: 7 km apart), afloat; each sees the other\'s ship as a hydro ghost, afloat',
  Math.hypot(wa.e - 16200, wa.z - 4600) < 5 && Math.hypot(wb.e - 23300, wb.z - 4600) < 5 && wa.afloat && wb.afloat && wa.kind === 'ship' && wa.ghost.afloat && wa.ghost.hydro && wb.ghost.afloat, [wa, wb]);
ok('the objective: tickets for both, the zones at sea (a duel: Mid-Sound alone, 450 m)', wa.obj && wa.obj.tk.join() === '600,600' && wb.obj.zones.length === 1 && wb.obj.zones[0].id === 'C' && wb.obj.zones[0].r === 450, wa.obj);
const seaT = await Promise.all([A, B].map((p) => p.evaluate(() => Ship.seaT(Flight))));
log('sea clocks', JSON.stringify(seaT));
ok('B\'s sea runs on the host\'s clock (within half a second: the two tabs\' frames apart)', Math.abs(seaT[0] - seaT[1]) < 0.5, seaT);
await flightShot(B, 'battle-start');

// ---- B's corvette brought 700 m off A's starboard beam (as if she had steamed there), bow on to her
await B.evaluate(() => { const v = Flight.active, H = MP.peers.get(1).ghost, q = mpEZ(H.x, H.y, H.z, {}), P = { e: q.e, z: q.z + 700, yaw: Math.PI / 2 }; v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), VEHICLE_KINDS.ship.launchRot, P.z, P.yaw); Ship.launch(v, P); });
await A.waitForFunction(() => { const g = MP.peers.get(2).ghost, v = Flight.active; return g && Math.hypot(g.x - v.x, g.y - v.y, g.z - v.z) < 800; }, null, { timeout: 20000 });
await simWait(A, 1);

// ---- A's 57 mm: three rounds at her waterline (scripted, as the gun would lay them): the hit's holes reach B
await B.evaluate(() => { window.__hits = []; Net.on('hit', (m) => window.__hits.push(JSON.parse(JSON.stringify(m)))); });
const fired = await A.evaluate(() => {
  const v = Flight.active, g = MP.peers.get(2).ghost, gun = v.parts.find((p) => p.def.weapon && p.def.weapon.naval) || v.parts.find((p) => p.def.weapon && p.def.weapon.kind === 'tgun'), w = gun.def.weapon;
  const key = (w.shells || []).find((k) => SHELLS[k] && SHELLS[k].type !== 'ap') || (w.shells || [])[0] || Object.keys(SHELLS).find((k) => SHELLS[k].cal === w.cal), SH = SHELLS[key];
  for (let k = 0; k < 3; k++) {
    const m = v.toWorld(gun.x, gun.y + gun.def.h / 2 + 0.5, partZ(gun)), t = g.toWorld(g.com.x + (k - 1) * 8, g.com.y + 0.8, g.com.z || 0);
    const dx = t.x - m.x, dy = t.y - m.y, dz = t.z - m.z, d = Math.hypot(dx, dy, dz), tf = d / SH.v0, rr = Math.hypot(t.x, t.y, t.z), drop = 0.5 * 9.81 * tf * tf;
    const ax = dx + (t.x / rr) * drop, ay = dy + (t.y / rr) * drop, az = dz + (t.z / rr) * drop, l = Math.hypot(ax, ay, az);
    const s = { k: 'shell', sh: key, b: v.body, x: m.x, y: m.y, z: m.z, vx: v.vx + (ax / l) * SH.v0, vy: v.vy + (ay / l) * SH.v0, vz: v.vz + (az / l) * SH.v0, t: 0, life: SH.life || 8, owner: v, enemy: false, net: 0, cal: SH.cal, pen: SH.pen || 0, v0: SH.v0, spare: v, tracer: true, prox: 0, ric: false, gTop: Infinity };
    Combat.S.shots.push(s); MP.sendShot(s);
  }
  return { key, cal: SH.cal };
});
log('A fires', JSON.stringify(fired));
await B.waitForFunction(() => window.__hits.some((m) => Array.isArray(m.ho) && m.ho.length), null, { timeout: 30000 });
await B.waitForFunction(new Function(`return ${holes('Flight.active')} > 0`), null, { timeout: 20000 });
await A.waitForFunction(new Function(`return ${holes('MP.peers.get(2).ghost')} > 0`), null, { timeout: 20000 });
let hB = await B.evaluate(holes('Flight.active')), hA = await A.evaluate(holes('MP.peers.get(2).ghost'));
await simWait(B, 1); await simWait(A, 1);
hB = await B.evaluate(holes('Flight.active')); hA = await A.evaluate(holes('MP.peers.get(2).ghost'));
r = await B.evaluate(() => window.__hits.map((m) => ({ k: m.k, list: m.list.length, ho: m.ho && m.ho.length, fi: m.fi && m.fi.length })));
log('B got', JSON.stringify(r), 'her holes', hB, 'A\'s ghost of her', hA);
ok('A\'s rounds hole B\'s corvette: the hits carry their holes (ho); B\'s hull has them, and A\'s ghost of her the same (hull: within 0.01 m²)', r.some((m) => m.ho > 0) && hB > 0 && Math.abs(hA - hB) < 0.01, { r, hB, hA });

// ---- A's torpedo at her: a copy runs on B's screen beside A's own; it holes her under the water, on both screens
const tp = await A.evaluate(() => { const v = Flight.active, g = MP.peers.get(2).ghost, q = mpEZ(v.x, v.y, v.z, {}), w = mpEZ(g.x, g.y, g.z, {}); const s = Ship.torpAt(v, Math.atan2(w.e - q.e, -(w.z - q.z)), Flight); return !!s; });
await B.waitForFunction(() => Combat.S.shots.some((s) => s.k === 'stor' && s.net === 1), null, { timeout: 20000 });
const runs = await Promise.all([A.evaluate(() => { const s = Combat.S.shots.find((q) => q.k === 'stor' && !q.net); return s && [s.x, s.y, s.z]; }), B.evaluate(() => { const s = Combat.S.shots.find((q) => q.k === 'stor' && q.net === 1); return s && [s.x, s.y, s.z]; })]);
const apart = runs[0] && runs[1] ? Math.hypot(runs[0][0] - runs[1][0], runs[0][1] - runs[1][1], runs[0][2] - runs[1][2]) : -1;
log('torpedo', tp, 'A\'s and B\'s copy', apart.toFixed(1), 'm apart');
ok('A\'s torpedo runs as a copy on B\'s screen too (within 60 m of A\'s own: the two tabs\' clocks and its updates a second)', tp && apart >= 0 && apart < 60, { tp, apart });
await flightShot(A, 'torpedo', [[1280, 720]]);
const h1 = hB;
await B.waitForFunction((h1) => !Combat.S.shots.some((s) => s.k === 'stor') && (() => { const v = Flight.active; return v.parts.reduce((s, p) => s + (p.holes ? p.holes.reduce((q, h) => q + h.a, 0) : 0), 0); })() > h1 + 0.5, h1, { timeout: 240000 });
await simWait(A, 1.5);
hB = await B.evaluate(holes('Flight.active')); hA = await A.evaluate(holes('MP.peers.get(2).ghost'));
const wB = await B.evaluate(() => Math.round(Flight.active.sh.comps.reduce((s, c) => s + c.W, 0)));
log('after the torpedo: her holes', hB, 'A\'s ghost', hA, 'water', wB);
ok('...it holes her under the water: the water comes in, her holes the same on A\'s ghost of her', hB > h1 + 0.5 && Math.abs(hA - hB) < 0.05 && wB > 5, { h1, hB, hA, wB });

// ---- holed past saving, she sinks on both screens: A's ghost of her goes down with her, a wreck on the bed on both
const tk0 = await A.evaluate(() => MP.state.obj.tk[1]);
await B.evaluate(() => { const v = Flight.active, rows = []; for (const c of v.sh.comps) { const x = (c.lo + c.hi) / 2, X = partPt(c.p, x, -c.p.def.h / 2 + 0.3); rows.push([c.p, X.x, X.y, partZ(c.p), 15]); } Ship.addHoles(v, rows, Flight.time); v.lastHitBy = MP.peers.get(1).ghost; v.lastHitAt = Flight.time; });
await B.waitForFunction(() => Flight.active.fate, null, { timeout: 240000 });
await A.waitForFunction(() => MP.peers.get(2) && MP.peers.get(2).sink, null, { timeout: 30000 });
r = await A.evaluate(() => { const g = MP.peers.get(2).ghost; return { fate: g.fate, sink: MP.peers.get(2).sink.why, ghosts: MP.ghosts().length, alt: Math.hypot(g.x, g.y, g.z) - EARTH.radius }; });
log('A sees her doomed', JSON.stringify(r));
ok('B\'s corvette founders (doomed: sunk); on A\'s screen her ghost stays, doomed and going down (no fireball, no drop)', r.fate === 'sunk' && r.sink === 'sunk' && r.ghosts === 1, r);
await A.evaluate(() => { const g = MP.peers.get(2).ghost; Flight.spectate = g; });
await flightShot(A, 'sinking', [[1280, 720], [390, 844]]);
await A.evaluate(() => { Flight.spectate = null; });
await A.waitForFunction(() => MP.wrecks.some((w) => w.pid === 2), null, { timeout: 240000 });
await B.waitForFunction(() => Flight.active.wreck, null, { timeout: 30000 });
const wrA = await A.evaluate(() => { const w = MP.wrecks.find((x) => x.pid === 2).v; return { at: mpEZ(w.x, w.y, w.z, {}), alt: Math.hypot(w.x, w.y, w.z) - EARTH.radius, ghost: !!MP.peers.get(2).ghost }; });
const wrB = await B.evaluate(() => { const v = Flight.active; return { at: mpEZ(v.x, v.y, v.z, {}), alt: Math.hypot(v.x, v.y, v.z) - EARTH.radius }; });
const tkA = await A.evaluate(() => ({ tk: MP.state.obj.tk[1], cost: MP.battleCost.get(2), kills: MP.me.kills }));
log('the wreck on A', JSON.stringify(wrA), 'on B', JSON.stringify(wrB), JSON.stringify(tkA));
ok('...she settles on the bed as a wreck on both screens, at the same place (within 1 m) and depth; A no longer has a ghost of her', Math.hypot(wrA.at.e - wrB.at.e, wrA.at.z - wrB.at.z) < 1 && Math.abs(wrA.alt - wrB.alt) < 1 && wrA.alt < -3 && !wrA.ghost, { wrA, wrB });
ok('B\'s team loses 30 + price/2,500 tickets (priced by the host from her spawn rows); A has the kill', tk0 - tkA.tk === 30 + Math.round(tkA.cost / 2500) && tkA.kills === 1, { tk0, tkA });

// ---- B's Respawn panel, then back in
await B.waitForFunction(() => !$('#modal').hidden && document.querySelector('#modal .rsp'), null, { timeout: 60000 });
await B.evaluate(() => { Render3D.skipDraw = false; });
await shot(B, 'respawn', [[390, 844], [1280, 720]]);
await B.evaluate(() => { Render3D.skipDraw = true; });
r = await B.evaluate(() => ({ title: $('#modal-card .modal-title').textContent, opts: [...document.querySelectorAll('#modal .rsp-opt')].map((b) => b.querySelector('b').textContent) }));
log('B respawn panel', JSON.stringify(r));
ok('the Respawn panel: her fate and who did it, her ship to come back in, another one', /Sunk: Alice/.test(r.title) && r.opts.some((t) => /Your ship \(Vizby/.test(t)) && r.opts.some((t) => /Change ship/.test(t)), r);
await B.waitForFunction(() => { const b = [...document.querySelectorAll('#modal .rsp-opt')].find((x) => /Your ship/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 30000 });
await B.evaluate(() => [...document.querySelectorAll('#modal .rsp-opt')].find((x) => /Your ship/.test(x.textContent)).click());
await B.waitForFunction(() => !Flight.destroyed && Flight.active && !Flight.active.fate && Flight.time > 0.3, null, { timeout: 60000 });
await A.waitForFunction(() => MP.peers.get(2) && MP.peers.get(2).ghost && MP.player(2).flying, null, { timeout: 30000 });
r = await B.evaluate(() => { const v = Flight.active, q = mpEZ(v.x, v.y, v.z, {}); return { e: q.e, z: q.z, wrecks: MP.wrecks.length, kept: MP.wrecks.every((w) => Flight.vessels.includes(w.v)) }; });
const rA = await A.evaluate(() => ({ wrecks: MP.wrecks.length, kept: MP.wrecks.every((w) => Flight.vessels.includes(w.v)) }));
log('B back in', JSON.stringify(r), 'A', JSON.stringify(rA));
ok('B is back in at her end of the Sound; her wreck stays on both screens', Math.hypot(r.e - 23300, r.z - 4600) < 150 && r.wrecks === 1 && r.kept && rA.wrecks === 1 && rA.kept, [r, rA]);
const bytes1 = await Promise.all([A, B].map((p) => p.evaluate(() => ({ i: Net.bytesIn, o: Net.bytesOut, t: performance.now() }))));
const rate = [0, 1].map((i) => { const s = (bytes1[i].t - bytes0[i].t) / 1000; return { in: Math.round((bytes1[i].i - bytes0[i].i) / s), out: Math.round((bytes1[i].o - bytes0[i].o) / s), s: +s.toFixed(1) }; });
log('bytes a second in the battle (host A, client B):', JSON.stringify(rate));
ok('network: each player sends and receives under 20 kB a second in the battle', rate.every((x) => x.in < 20000 && x.out < 20000 && x.out > 100), rate);

// ---- time up: the result on both screens
await A.evaluate(() => MP.advance());
for (const p of [A, B]) await p.waitForFunction(() => MP.phase === 'results' && !$('#modal').hidden, null, { timeout: 30000 });
r = await B.evaluate(() => ({ kicker: $('#modal-card .modal-kicker').textContent, title: $('#modal-card .modal-title').textContent, head: [...document.querySelectorAll('#modal th')].map((e) => e.textContent), res: MP.state.result }));
const ra = await A.evaluate(() => ({ title: $('#modal-card .modal-title').textContent }));
log('results on B', r.kicker, '/', r.title, '| A', ra.title);
ok('time up: Faroes win on time (more tickets), the results on both screens (Victory for A, Defeat for B), the Sound named', r.res.winner === 0 && r.res.why === 'time' && r.res.naval === true && r.res.arena === 'sound' && /Faroes win on time .*Shetland Sound/.test(r.kicker) && r.title === 'Defeat' && ra.title === 'Victory!'
  && r.head.join() === 'Player,Team,Kills,Caps,Lost,Score,Ping', r);
await shot(B, 'results');

const bad = errs.filter((e) => !/favicon|net::ERR|Failed to load resource/.test(e));
ok('no errors in either tab\'s console', !bad.length, bad.slice(0, 6));
log('screenshots in', SHOTS);
ok.done();
await b.close(); srv.close();
