// Multiplayer across two tabs of one browser (BroadcastChannel, the "This device" transport): A hosts a sandbox and
// flies a Jumbo with its fan pods moved out to z 9, a stealth-grey wing and a single jet hung on the wing; B joins
// in a Skylark. B's ghost of A must match A's craft exactly. Then: the host drops a relayed message over 256 KB, and
// a forged spawn from B is rebuilt clean on A without breaking anything. Then the part limit: on, B's 1,009-part craft
// can't fly; the host turns it off and sees it. Then the props: a tree knocked over on B's
// screen falls on A's; a third tab joining later gets the room's set; a player's forged "fallen" goes nowhere. Then the
// big update's deaths on the other screen: B's plane, its pilot knocked out 1 km up, falls on A's screen as A's own hulk
// and crashes there once, leaving a crash site; B's wing loses a half, which A sees go; B's Dune Buggy knocked out in the
// sandbox stays on A's screen as a wreck.
//   node test/browser/mp-two-tabs.mjs        (screenshot in test/.cache/shots/)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = path.join(ROOT, 'test', '.cache', 'shots') + path.sep;
fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch();
const ctx = await b.newContext({ viewport: { width: 900, height: 560 } });
const errs = [];
const mk = async (tag) => { const p = await ctx.newPage(); watch(p, errs, tag + ' '); return p; };
const ok = checks('multiplayer: two tabs');
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
const A = await mk('A');
await openGame(A, srv.url);
const B = await mk('B');
await B.goto(srv.url + 'index.html');
await B.waitForTimeout(300);
if (await B.isVisible('[data-mode="sandbox"]')) await B.click('[data-mode="sandbox"]');
for (const p of [A, B]) await p.evaluate(() => { Render3D.skipDraw = true; });
log('NET_VERSION', await A.evaluate(() => NET_VERSION));
await A.click('#home-mp');
await A.fill('#mp-name', 'Alice'); await A.dispatchEvent('#mp-name', 'change');
await A.click('[data-tr="local"]');
await A.click('#mp-create-sandbox');
await A.waitForFunction(() => MP.live && Net.code, null, { timeout: 10000 });
const code = await A.evaluate(() => Net.code);
await B.click('#home-mp');
await B.fill('#mp-name', 'Bob'); await B.dispatchEvent('#mp-name', 'change');
await B.click('[data-tr="local"]');
await B.fill('#mp-join-code', code);
await B.click('#mp-join');
await B.waitForFunction(() => MP.live && MP.me, null, { timeout: 10000 });
await A.waitForFunction(() => MP.state.players.length === 2);
log('room', code, 'joined as', await B.evaluate(() => Net.me));

// A: a Jumbo, fan pods out at z 9, the wing in stealth grey, and a single jet on the wing at z -3.5 attached to it
const setup = await A.evaluate(() => {
  Builder.loadTemplate('jumbo');
  const pods = Builder.parts.find((p) => p.type === 'fanPods'), wing = Builder.parts.find((p) => p.type === 'wingL');
  pods.z = 9; wing.skin = 'stealth';
  const jet = makePart('jet', 1.5, 11.6, { z: -3.5, att: wing.id, skin: 'stealth' });
  Builder.parts.push(jet);
  Builder.changed();
  const s = Builder.serialize();
  return { attached: Builder.parts.filter((p) => Builder.attached.has(p.id)).length, of: Builder.parts.length, rows: s.parts.filter((q) => q.z != null || q.skin || q.att != null) };
});
log('A design', JSON.stringify(setup));
await A.evaluate(() => App.launch());
await B.evaluate(() => { Builder.loadTemplate('skylark'); App.launch(); });
await A.waitForFunction(() => Flight.running && Flight.mp, null, { timeout: 60000 });
await B.waitForFunction(() => Flight.running && Flight.mp, null, { timeout: 60000 });
await B.waitForFunction(() => Flight.vessels.some((v) => v.remote), null, { timeout: 20000 });
await B.waitForTimeout(1500);
const own = await A.evaluate(() => {
  const v = Flight.active;
  return { parts: v.parts.map((p) => [p.id, p.type, partZ(p), p.skin, p.att]), com: v.com, reach: v.reach, mass: v.mass,
    spawnRow: MP.spawnMsg.parts.filter((r) => r[1] === 'fanPods' || r[1] === 'wingL' || r[1] === 'jet') };
});
const gh = await B.evaluate(() => {
  const g = Flight.vessels.find((v) => v.remote);
  const P = MP.peers.get(g.remote);
  return { name: g.name, kind: g.kind, parts: g.parts.map((p) => [p.id, p.type, partZ(p), p.skin, p.att]), com: g.com, reach: g.reach, mass: g.mass,
    design: Object.keys(P.design).join(), rowLen: [...new Set(P.design.parts.map((r) => r.length))],
    pods: g.parts.filter((p) => p.type === 'fanPods').map((p) => ({ z: p.z, partZ: partZ(p), zs: partZs(p), boxes: partBoxes(p).map((b) => b.map((x) => +x.toFixed(3))) })),
    wing: g.parts.filter((p) => p.type === 'wingL').map((p) => ({ skin: p.skin, skinOf: skinOf(p) })),
    adj: [...g.adj].map(([k, s]) => k + ':' + [...s].sort((a, b) => a - b).join(',')).sort().join(';') };
});
const ownAdj = await A.evaluate(() => [...Flight.active.adj].map(([k, s]) => k + ':' + [...s].sort((a, b) => a - b).join(',')).sort().join(';'));
log('A spawn rows (pods, wing, jet):', JSON.stringify(own.spawnRow));
log('B ghost', gh.name, gh.kind, 'design keys', gh.design, 'row lengths', JSON.stringify(gh.rowLen));
log('B ghost pods', JSON.stringify(gh.pods));
log('B ghost wing', JSON.stringify(gh.wing));
log('B ghost jet', JSON.stringify(gh.parts.filter((p) => p[1] === 'jet')));
const same = JSON.stringify(own.parts) === JSON.stringify(gh.parts);
log('ghost parts (id,type,z,skin,att) equal owner:', same, '| adjacency equal:', ownAdj === gh.adj, '| mass', own.mass, gh.mass);
log('com A', JSON.stringify(own.com), 'ghost com', JSON.stringify(gh.com));
const pass = same && ownAdj === gh.adj && gh.pods.length === 1 && gh.pods[0].partZ === 9 && gh.wing[0].skin === 'stealth';
ok('the ghost on B has the owner\'s parts (id, type, depth, paint, att) and joints', same && ownAdj === gh.adj);
ok('pods at z 9 and the stealth wing reach the ghost', pass);
ok('the ghost\'s centre of mass matches the owner\'s, across too (snapshots carry it to 4 decimals)', ['x', 'y', 'z'].every((k) => Math.abs(own.com[k] - gh.com[k]) < 1e-3) && Math.abs(gh.com.z) > 0.1, [own.com, gh.com]);

// draw a few seconds on B with the ghost in view (the skinned and moved meshes get built)
await B.evaluate(() => { Render3D.skipDraw = false; const g = Flight.vessels.find((v) => v.remote); Flight.spectate = g; });
await B.waitForTimeout(4000);
const meshes = await B.evaluate(() => { const g = Flight.vessels.find((v) => v.remote); Flight.spectate = null; return g ? g.parts.length : 0; });
await B.screenshot({ path: SHOTS + 'mp-ghost-B.png' });
await B.evaluate(() => { Render3D.skipDraw = true; });
log('B drew the ghost for 4 s, parts', meshes);

// the host drops relayed messages over 256 KB (sent from the client B to everyone)
await A.evaluate(() => { window.zz = 0; Net.on('zz', () => window.zz++); });
await B.evaluate(() => { Net.send({ t: 'zz', pad: 'x'.repeat(300 * 1024) }); Net.send({ t: 'zz', pad: 'x'.repeat(1024) }); });
await A.waitForTimeout(800);
const zz = await A.evaluate(() => window.zz);
log('host got', zz, 'of 2 zz messages (300 KB one dropped)');
ok('the host drops a client message over 256 KB and relays the small one', zz === 1);

// a forged spawn from B: junk rows, bad skin and z, an att loop; A must rebuild clean rows and not throw
await B.evaluate(() => Net.send({ t: 'spawn', kind: 'constructor', parts: [[5, 'cockpitAir', 0, 0, 0, 0, NaN, 6, 'constructor'], [6, 'fuselageW', 0, -4.6, 0, 0, 1e9, 5, '__proto__'], [6, 'gun', 0, 0], [7, '__proto__', 0, 0], [8, 'fanPods', 1.8, -4, 0, 0, -1e9, 99, 'stealth']] }));
await A.waitForTimeout(1500);
const forged = await A.evaluate(() => { const P = MP.peers.get(2); return { rows: P && P.design ? P.design.parts : null, kind: P && P.design && P.design.kind, ghost: !!(P && P.ghost), running: Flight.running }; });
log('A after forged spawn from B:', JSON.stringify(forged));
ok('a forged spawn is rebuilt clean (known types, unique ids, z and paint cleaned, kind plane) and A keeps flying', forged.running && forged.kind === 'plane' && Array.isArray(forged.rows) &&
  forged.rows.every((r) => r.length === 9 && r[1] !== '__proto__' && Number.isFinite(r[6]) && Math.abs(r[6]) <= 20 && (r[8] === 0 || r[8] === 'stealth')) && new Set(forged.rows.map((r) => r[0])).size === forged.rows.length);
await A.evaluate(() => { Render3D.skipDraw = false; Flight.spectate = Flight.vessels.find((v) => v.remote) || null; });
await A.waitForTimeout(2500);
await A.evaluate(() => { Render3D.skipDraw = true; Flight.spectate = null; });

// the part limit, a room setting: with it on (as every room starts), B's 1,009-part craft can't fly, and says who can
// turn the limit off; the host turns it off; B flies it, and the host sees all of it
const big = () => {
  Builder.loadTemplate('skylark');
  const c = Builder.parts[0];
  for (let i = 0; i < 1000; i++) Builder.parts.push(makePart('gun', c.x, c.y, { att: c.id, z: ((i % 20) - 10) * 0.05 }));
  Builder.changed(); UI._seen = []; const t0 = UI.toast; UI.toast = (x, k) => { UI._seen.push(x); t0.call(UI, x, k); };
  const flew = Flight.time; MP.launch(); UI.toast = t0;
  return { parts: Builder.parts.length, toasts: UI._seen, cap: MP.state.settings.cap, spawned: MP.spawnMsg ? MP.spawnMsg.parts.length : 0 };
};
const capOn = await B.evaluate(big);
log('B, part limit on:', JSON.stringify(capOn));
ok('the part limit on: B\'s 1,009-part craft doesn\'t fly, and the toast says the host can turn the limit off', capOn.spawned < 600 && capOn.toasts.some((x) => /601|1009/.test(x) && /host can turn the part limit off/.test(x)), capOn);
await A.evaluate(() => MP.setSetting('cap', false));
await B.waitForFunction(() => MP.state.settings.cap === false, null, { timeout: 10000 });
const capOff = await B.evaluate(big);
log('B, part limit off:', JSON.stringify(capOff));
await B.waitForFunction(() => Flight.running && Flight.active && Flight.active.parts.length > 1000 && MP.spawnMsg && MP.spawnMsg.parts.length > 1000, null, { timeout: 120000 });
capOff.spawned = await B.evaluate(() => MP.spawnMsg.parts.length);
const seen = await A.waitForFunction(() => { const g = Flight.vessels.find((v) => v.remote === 2); return g && g.parts.length > 1000 ? g.parts.length : false; }, null, { timeout: 120000 }).then((h) => h.jsonValue()).catch(() => 0);
log('A sees B\'s ghost with', seen, 'parts');
ok('the host turns the limit off: B flies it, and the host sees all 1,009 parts', capOff.spawned === 1009 && seen === 1009, { spawned: capOff.spawned, seen });
await A.evaluate(() => MP.setSetting('cap', true));
await B.waitForFunction(() => MP.state.settings.cap === true, null, { timeout: 10000 });

// the props: a tree knocked over on B's screen falls on A's (the host's) the same way; a third tab joining later gets
// the room's set; a player's forged "fallen" goes nowhere (host-only)
const mapIn = () => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready';
await A.waitForFunction(mapIn, null, { timeout: 180000 }); await B.waitForFunction(mapIn, null, { timeout: 180000 });
const built = () => Props.areas().some((m) => m.id === 'isle') && Props.areas().some((m) => m.id === 'runway');
await A.waitForFunction(built, null, { timeout: 180000 }); await B.waitForFunction(built, null, { timeout: 180000 });
const knock = await B.evaluate(() => {
  const m = Props.areas().find((q) => q.id === 'isle'), n = m.props.findIndex((p) => (p.k === Props.K.conifer || p.k === Props.K.broadleaf) && !p.down), p = m.props[n];
  const ps = partsFromDesign(templateRows(TEMPLATES.buggy)), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'car'; v.rebuildGroups();
  v.placeOnSurface(EARTH, siteAngle(EARTH, p.e - 1.6), 0, p.z, 0); const a = v.axis(1, 0, 0); v.vx = a.x * 8; v.vy = a.y * 8; v.vz = a.z * 8;
  Props.crushStep({ time: Flight.time + 1, vessels: [v] });
  return { n, down: !!p.down, fe: p.fe, fz: p.fz, queued: Props.queued, sig: m.sig };
});
const onA = await A.waitForFunction((n) => { const p = Props.areas().find((q) => q.id === 'isle').props[n]; return p.down ? { fe: p.fe, fz: p.fz, sig: Props.areas().find((q) => q.id === 'isle').sig } : false; }, knock.n, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
log('B knocked over isle prop', knock.n, JSON.stringify(knock), 'A sees', JSON.stringify(onA));
ok('a tree knocked over on B\'s screen falls on the host\'s too, the same way', knock.down && !!onA && Math.hypot(onA.fe - knock.fe, onA.fz - knock.fz) < 0.02, { knock, onA });
await B.evaluate((n) => Net.send({ t: 'fallen', r: 0, L: [[2, Props.areas().find((q) => q.id === 'isle').sig, [n + 1, n + 2], [0, 0]]] }), knock.n);
const C = await mk('C');
await C.goto(srv.url + 'index.html');
await C.waitForTimeout(300);
if (await C.isVisible('[data-mode="sandbox"]')) await C.click('[data-mode="sandbox"]');
await C.evaluate(() => { Render3D.skipDraw = true; });
await C.click('#home-mp');
await C.fill('#mp-name', 'Cy'); await C.dispatchEvent('#mp-name', 'change');
await C.click('[data-tr="local"]');
await C.fill('#mp-join-code', code);
await C.click('#mp-join');
await C.waitForFunction(() => MP.live && MP.me, null, { timeout: 10000 });
await C.waitForFunction(mapIn, null, { timeout: 180000 });
const onC = await C.waitForFunction((n) => { const m = Props.areas().find((q) => q.id === 'isle'), p = m && m.props[n]; return p && p.down ? { fe: p.fe, t0: p.t0, n: Props.crushed } : false; }, knock.n, { timeout: 120000 }).then((h) => h.jsonValue()).catch(() => null);
const forgedFallen = await A.evaluate((n) => { const m = Props.areas().find((q) => q.id === 'isle'); return !!m.props[n + 1].down || !!m.props[n + 2].down; }, knock.n);
log('C (joined later) sees', JSON.stringify(onC), '| B\'s forged fallen reached the host:', forgedFallen);
ok('a third tab joining later gets the room\'s set from the host: the tree already down there', !!onC && Math.abs(onC.fe - knock.fe) < 0.02 && onC.t0 < -1e6 && onC.n === 1, onC);
ok('...and a player\'s own "fallen" message is dropped by the host (host-only)', !forgedFallen);

// the big update's deaths on the other screen (spec-damage §10.5): B's plane, its pilot knocked out 1 km up, falls on A's
// screen as a hulk of A's own physics (no longer B's ghost) and crashes there once, leaving a crash site; B's wing loses
// its right half: A's ghost of it keeps the left half and the right one falls; B's Dune Buggy knocked out in the sandbox
// stays on A's screen as a wreck
const flyB = (key, alt) => B.evaluate(([key, alt]) => {
  UI.closeModal(); Builder.loadTemplate(key); Builder.changed(); MP.launch();
  return new Promise((done) => { const f = () => { const v = Flight.active; if (!(Flight.running && v && v.name === TEMPLATES[key].name && Flight.time > 0.3)) return requestAnimationFrame(f);
    if (alt) { const r = Math.hypot(v.x, v.y, v.z), k = (r + alt) / r, n = v.axis(0, 1, 0); v.x *= k; v.y *= k; v.z *= k; v.vx = n.x * 120; v.vy = n.y * 120; v.vz = n.z * 120; v.landed = false; v.throttle = 0.8; }
    done({ name: v.name, alt: Math.round(v.groundAltitude()) }); }; f(); });
}, [key, alt]);
const seenUp = (alt) => A.waitForFunction((alt) => { const P = MP.peers.get(2), g = P && P.ghost; return !!g && !g.hiddenUntilSnap && g.groundAltitude() > alt; }, alt, { timeout: 60000 });
await A.evaluate(() => { const W = (window.__dx = { death: [] }), f = FX.death; FX.death = function (b, at, vel, size, kind) { W.death.push({ kind, t: Flight.time }); return f.apply(this, arguments); }; });
log('B flies', JSON.stringify(await flyB('mustang', 1000)));
await seenUp(900);
await A.evaluate(() => { window.__g = MP.peers.get(2).ghost; window.__py = Death.S.pyres.length; window.__dx.death.length = 0; });
await B.evaluate(() => { const v = Flight.active; Combat.damage(v, v.control, 1e6, 'shot', Flight, null); });
await A.waitForFunction(() => window.__g.foreign === 2, null, { timeout: 20000 }).catch(() => {});
const f1 = await A.evaluate(() => { const g = window.__g, P = MP.peers.get(2); return { foreign: g.foreign, remote: g.remote, ghost: !!(P && P.ghost), inWorld: Flight.vessels.includes(g), down: !!g.down, ghosts: MP.ghosts().includes(g), control: g.control === null || g.parts.some((p) => p.def.control && p.ko), alt: Math.round(g.groundAltitude()), vy: Math.hypot(g.vx, g.vy, g.vz) }; });
log('A sees B\'s hulk', JSON.stringify(f1));
ok('B\'s pilot knocked out 1 km up: on A\'s screen a falling hulk of A\'s own (foreign, no longer B\'s ghost), moving', f1.foreign === 2 && !f1.remote && !f1.ghost && f1.inWorld && f1.down && !f1.ghosts && f1.alt > 500 && f1.vy > 20, f1);
await A.waitForFunction(() => window.__g.dead, null, { timeout: 600000 }).catch(() => {});
await A.waitForTimeout(500);
const f2 = await A.evaluate(() => ({ dead: !!window.__g.dead, deaths: window.__dx.death.map((d) => d.kind), pyres: Death.S.pyres.length - window.__py, inWorld: Flight.vessels.includes(window.__g) }));
log('A after the crash', JSON.stringify(f2));
ok('...it crashes there once (one fireball, a crash site), and is gone', f2.dead && f2.deaths.filter((k) => k === 'crash').length === 1 && f2.deaths.length === 1 && f2.pyres === 1, f2);
// half a wing
log('B flies', JSON.stringify(await flyB('mustang', 1000)));
await seenUp(900);
await A.evaluate(() => { window.__g = MP.peers.get(2).ghost; window.__n0 = Flight.vessels.length; });
const cut = await B.evaluate(() => { const v = Flight.active, w = v.mainWing; Combat.damage(v, w, 1.1 * Combat.maxHp(w.def), 'shot', Flight, null, 1); return { cut: w.cut, id: w.id, hulk: v.hulk, down: !!v.down }; });
await A.waitForFunction((id) => { const p = window.__g.parts.find((q) => q.id === id); return p && p.cut === 1; }, cut.id, { timeout: 20000 }).catch(() => {});
const c1 = await A.evaluate((id) => { const g = window.__g, p = g.parts.find((q) => q.id === id), half = Flight.vessels.slice(window.__n0).filter((o) => o.foreign === 2 && o.parts.some((q) => q.cut === -1 && q.type === p.type));
  return { cut: p && p.cut, ghost: MP.peers.get(2).ghost === g, halves: half.length, falling: half.map((o) => Math.round(Math.hypot(o.vx, o.vy, o.vz))) }; }, cut.id);
log('B cut', JSON.stringify(cut), 'A sees', JSON.stringify(c1));
ok('B\'s wing loses its right half: A\'s ghost of it keeps the left half, and the right one falls there', cut.cut === 1 && c1.cut === 1 && c1.ghost && c1.halves === 1 && c1.falling[0] > 20, { cut, c1 });
// a Dune Buggy knocked out in the sandbox: a wreck on A's screen
log('B drives', JSON.stringify(await flyB('buggy', 0)));
await A.waitForFunction(() => { const P = MP.peers.get(2), g = P && P.ghost; return !!g && !g.hiddenUntilSnap && g.kind === 'car'; }, null, { timeout: 60000 });
await A.evaluate(() => { window.__g = MP.peers.get(2).ghost; window.__w0 = MP.wrecks.length; });
await B.waitForTimeout(1500);
await B.evaluate(() => { const v = Flight.active; Combat.damage(v, v.parts.find((p) => p.def.control), 1e6, 'shot', Flight, null); });
await A.waitForFunction(() => MP.wrecks.length > window.__w0, null, { timeout: 20000 }).catch(() => {});
const k1 = await A.evaluate(() => { const g = window.__g, w = MP.wrecks.find((x) => x.v === g); return { wreck: !!g.wreck, listed: !!w, pid: w && w.pid, ko: g.ko && g.ko.why, inWorld: Flight.vessels.includes(g), ghost: !!MP.peers.get(2).ghost }; });
const kB = await B.evaluate(() => { const v = Flight.active; return { ko: v.ko && v.ko.why, wreck: !!v.wreck, v: Math.hypot(v.vx, v.vy, v.vz) }; });
log('B\'s buggy knocked out', JSON.stringify(kB), 'A sees', JSON.stringify(k1));
ok('B\'s Dune Buggy knocked out in the sandbox (its driver: crew) stops dead and stays on A\'s screen as a wreck', kB.ko === 'crew' && kB.wreck && kB.v === 0 && k1.wreck && k1.listed && k1.pid === 2 && k1.ko === 'crew' && k1.inWorld && !k1.ghost, { kB, k1 });

ok('no page errors', errs.length === 0, errs.join('\n'));
ok.done();
await b.close(); srv.close();
