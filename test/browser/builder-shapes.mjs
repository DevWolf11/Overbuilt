// The builder by vehicle and by shape: each kind of craft gets its own part tabs (More shows the rest), each
// look-alike jet's parts sit together in the tray, and parts go as close as their 3D shapes let them: one put
// beside a round or tapering hull, in 2D or 3D, slides in until it meets the hull's surface.
//   node test/browser/builder-shapes.mjs
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const srv = await serve(), b = await launch();
const page = await (await b.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
const errs = [];
watch(page, errs);
await openGame(page, srv.url, { build3d: false });
await page.evaluate(() => App.toBuild());
await page.waitForTimeout(300);
const ev = (f, a) => page.evaluate(f, a);
const ok = checks('builder: part tabs by craft, parts by shape');
const tabs = () => ev(() => [...document.querySelectorAll('#palette-tabs .tab')].map((t) => t.textContent + (t.getAttribute('aria-selected') === 'true' ? '*' : '')));

// 1. tabs by kind
await ev(() => Builder.setKind('rocket'));
let t = await tabs();
ok('a rocket shows the rocket parts and More', t.join('|') === 'Command*|Fuel|Engines|Coupling|Aero|Utility|Structure|More…', t.join('|'));
await ev(() => Builder.setKind('plane'));
t = await tabs();
ok('a plane shows cockpits, fuselage, wings, aero engines, gear and weapons', t.join('|') === 'Cockpits*|Fuselage|Wings|Aero engines|Gear|Weapons|More…', t.join('|'));
await ev(() => [...document.querySelectorAll('#palette-tabs .tab')].find((b) => b.textContent === 'More…').click());
t = await tabs();
ok('More shows every tab, the plane ones first', t.length === 15 && t.slice(0, 6).join('|') === 'Cockpits*|Fuselage|Wings|Aero engines|Gear|Weapons' && t.includes('Command') && t[14] === 'Fewer', t.join('|'));
await ev(() => [...document.querySelectorAll('#palette-tabs .tab')].find((b) => b.textContent === 'Engines').click());
let items = await ev(() => [...document.querySelectorAll('#palette-items .part-item')].length);
ok('a rocket engine can still go on a plane', items > 5, items);
await ev(() => [...document.querySelectorAll('#palette-tabs .tab')].find((b) => b.textContent === 'Fewer').click());
t = await tabs();
ok('Fewer goes back to the plane tabs (from Engines, to the first)', t[0] === 'Cockpits*' && t.length === 7, t.join('|'));
await ev(() => { Builder.loadTemplate('sugoi27'); });
await ev(() => [...document.querySelectorAll('#palette-tabs .tab')].find((b) => b.textContent === 'Wings').click());
const tray = await ev(() => [...document.querySelectorAll('#palette-items > *')].map((e) => (e.classList.contains('tray-group') ? '#' + e.textContent : '.')));
const groups = tray.filter((s) => s[0] === '#').map((s) => s.slice(1));
ok('the wings tab: the stock wings first, then each jet\'s, by generation', tray[0] === '.' && groups.join(',') === 'MyG-21,FS-4,FS-16,MyG-29,FS-15,Sugoi-27,FS-22,FS-35,Sugoi-57', groups.join(','));
await ev(() => Builder.loadTemplate('pathfinder'));
t = await tabs();
ok('loading a rocket brings back the rocket tabs', t[0] === 'Command*' && t.length === 8, t.join('|'));

// 2. 2D: a pod put beside a nose cone's slim tip sits on the cone, not out at the edge of its box
let r = await ev(() => {
  Builder.loadDesign({ name: 't', kind: 'plane', parts: [{ type: 'noseL', x: 0, y: 0 }] });
  const n = Builder.parts[0], d = PARTS.noseL, w = PARTS.podSmall.w, R = partRect(n), y = R.t - PARTS.podSmall.h / 2 - 0.05;
  const s = Builder.snap('podSmall', { x: R.r + w / 2, y }, []);
  const at = { def: PARTS.podSmall, type: 'podSmall', x: s.x, y: s.y, z: s.z, rot: 0 }, deeper = { ...at, x: at.x - 0.03 };
  return { boxX: R.r + w / 2, x: s.x, y: s.y, att: s.att && s.att.type, free: !partsClash(at, n), deeperClash: partsClash(deeper, n) };
});
ok('2D: beside a nose cone\'s tip a pod slides in onto its surface (and no further)', r.x < r.boxX - 0.1 && r.free && r.deeperClash && r.att === 'noseL', JSON.stringify(r));
r = await ev(() => {
  Builder.loadDesign({ name: 't', kind: 'plane', parts: [{ type: 'fuselage', x: 0, y: 0 }] });
  const f = Builder.parts[0], R = partRect(f), w = PARTS.podSmall.w;
  const s = Builder.snap('podSmall', { x: R.r + w / 2, y: 0 }, []);
  return { boxX: R.r + w / 2, x: s.x };
});
ok('2D: beside a straight round fuselage it stays where its box edge was (it is round all along)', Math.abs(r.x - r.boxX) <= 0.03, JSON.stringify(r));

// 3. 3D: a part dropped on the lower curve of a round fuselage touches the curve
r = await ev(() => {
  Builder.loadDesign({ name: 't', kind: 'plane', parts: [{ type: 'fuselage', x: 0, y: 0 }] });
  const f = Builder.parts[0], rad = PARTS.fuselage.w / 2, a = Math.PI / 4;
  const hit = { part: f, x: f.x + rad * Math.cos(a), y: 0, z: rad * Math.sin(a), nx: Math.cos(a), ny: 0, nz: Math.sin(a) * 0.999 };
  const s = Builder.attach('podSmall', 0, hit, Builder.parts), R = partRect(f), w = PARTS.podSmall.w;
  const at = { def: PARTS.podSmall, type: 'podSmall', x: s.x, y: s.y, z: s.z, rot: 0 }, deeper = { ...at, x: at.x - 0.03 };
  return { boxX: R.r + w / 2, x: s.x, z: s.z, ok: s.ok, att: s.att && s.att.type, free: !partsClash(at, f), deeperClash: partsClash(deeper, f) };
});
ok('3D: dropped on the lower curve of a fuselage, a pod hangs on the curve, not below the box', r.ok && r.x < r.boxX - 0.15 && r.free && r.deeperClash && r.att === 'fuselage', JSON.stringify(r));

// 4. cheap enough to run on every pointer move: snap against a whole jet
r = await ev(() => {
  Builder.loadTemplate('sugoi27');
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) Builder.snap('podSmall', { x: 1.6 + (i % 5) * 0.1, y: 6 + i * 0.2 }, []);
  return (performance.now() - t0) / 40;
});
ok(`snap against a 20-part jet takes ${r.toFixed(1)} ms`, r < 25, r);

ok('no page errors', !errs.length, errs.join('\n'));
await b.close(); srv.close();
ok.done();
