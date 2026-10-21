// Multiplayer across two tabs of one browser (BroadcastChannel, the "This device" transport): A hosts a sandbox and
// flies a Jumbo with its fan pods moved out to z 9, a stealth-grey wing and a single jet hung on the wing; B joins
// in a Skylark. B's ghost of A must match A's craft exactly. Then: the host drops a relayed message over 256 KB, and
// a forged spawn from B is rebuilt clean on A without breaking anything.
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

ok('no page errors', errs.length === 0, errs.join('\n'));
ok.done();
await b.close(); srv.close();
