// The 2D builder: depth keys and slider, a second pair of pods on one wing, a jet hung on a wing with its twin,
// parts following their wing when it moves or is deleted, paint (Match, All, inherited), design codes with depth and
// paint, old saves not shown as changed, grid mode, a rocket booster's twin.
//   node test/browser/builder2d.mjs        (screenshots go to test/.cache/shots/)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = path.join(ROOT, 'test', '.cache', 'shots') + path.sep;
fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch();
const page = await (await b.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
const errs = [];
watch(page, errs);
await openGame(page, srv.url, { build3d: false });
await page.evaluate(() => App.toBuild());
await page.waitForTimeout(300);
const log = (...a) => console.log(...a);
const ev = (f, a) => page.evaluate(f, a);
const ok = checks('2D builder: depth, attach, grid, paint, codes, undo');
// a jumbo: its fan pods hang on the wing at the default spread
await ev(() => Builder.loadTemplate('jumbo'));
let st = await ev(() => ({ n: Builder.parts.length, loose: Builder.statsData.loose, sym: Builder.symmetry, pods: Builder.parts.filter((p) => p.type === 'fanPods').map((p) => partZ(p)) }));
log('jumbo', JSON.stringify(st));
ok('jumbo loads whole, plane symmetry on', st.loose === 0 && st.sym === true);
// select the pods and push them out with ]
await ev(() => { Builder.selected = Builder.parts.find((p) => p.type === 'fanPods'); Builder.renderInfo(); });
await page.keyboard.press('BracketRight'); await page.keyboard.press('Shift+BracketRight');
st = await ev(() => ({ z: partZ(Builder.selected), txt: $('#pi-z-val').textContent, row: !$('#pi-depth').hidden, label: $('#pi-z-label').textContent }));
log('after ] and Shift+]', JSON.stringify(st));
ok('depth keys move the pod pair out', Math.abs(st.z - 6.6) < 1e-6 && st.row && st.label === 'Spread');
// duplicate: a second pair further along the same wing
await ev(() => Builder.duplicateSelected());
st = await ev(() => { const H = Builder.hosts(); return { pods: Builder.parts.filter((p) => p.type === 'fanPods').map((p) => [partZ(p), H.get(p) && H.get(p).type]), loose: Builder.statsData.loose }; });
log('after duplicate', JSON.stringify(st));
ok('a second pair of fan pods on the same wing', st.pods.length === 2 && st.pods.every((q) => q[1] === 'wingL') && st.loose === 0);
// the slider
await ev(() => { Builder.selected = Builder.parts.find((p) => p.type === 'fanPods'); Builder.renderInfo(); });
const hist0 = await ev(() => Builder.history.length);
await page.evaluate(() => { const i = $('#pi-z'); i.value = 4.2; i.dispatchEvent(new Event('input')); i.value = 4.4; i.dispatchEvent(new Event('input')); i.dispatchEvent(new Event('change')); });
st = await ev(() => ({ z: partZ(Builder.selected), hist: Builder.history.length }));
ok('the slider sets the spread and is one undo step', Math.abs(st.z - 4.4) < 1e-6 && st.hist === hist0 + 1);
await ev(() => Builder.undo());
st = await ev(() => Builder.parts.filter((p) => p.type === 'fanPods').map((p) => partZ(p)).sort());
ok('undo brings the spread back', JSON.stringify(st) === '[6.6,9]');
log('pods after undo', JSON.stringify(st));
// a single jet dropped onto the wing in 2D: it hangs out on the wing with a twin on the other side
await ev(() => Builder.loadTemplate('jumbo'));
const drop = await ev(() => {
  const wing = Builder.parts.find((p) => p.type === 'wingL'), s = Builder.snap('jet', { x: wing.x + 0.6, y: wing.y - 0.5 }, [], 0);
  return { s: { x: s.x, y: s.y, z: s.z, ok: s.ok, att: s.att && s.att.type } };
});
log('jet onto wing', JSON.stringify(drop));
ok('a jet dropped on the wing hangs on it off the centre line', drop.s.ok && drop.s.att === 'wingL' && Math.abs(drop.s.z) > 1);
await ev((s) => { const wing = Builder.parts.find((p) => p.type === 'wingL'); Builder.addPart('jet', s.x, s.y, 0, { z: s.z, att: wing, host: wing }); }, drop.s);
st = await ev(() => ({ jets: Builder.parts.filter((p) => p.type === 'jet').map((p) => [partZ(p), !!p.mirror]), loose: Builder.statsData.loose, warn: $('#s-warn').textContent }));
log('jets', JSON.stringify(st));
ok('with symmetry the jet gets a twin on the other wing', st.jets.length === 2 && Math.abs(st.jets[0][0] + st.jets[1][0]) < 1e-6 && st.jets.every((j) => j[1]) && st.loose === 0);
ok('no lopsided warning for a mirrored pair', !/off the centre line/.test(st.warn));
// moving the wing takes its engines along
const mv = await ev(() => {
  const wing = Builder.parts.find((p) => p.type === 'wingL'), jets = Builder.parts.filter((p) => p.type === 'jet' || p.type === 'fanPods');
  const before = jets.map((p) => p.y);
  Builder.grab(wing, { x: wing.x, y: wing.y }, 1);
  Builder.drag.moved = true;
  Builder.moveDragged({ ...Builder.pose(wing), y: wing.y - 1, ok: true, attached: true });
  Builder.dropDrag(0);
  return { dy: jets.map((p, i) => +(p.y - before[i]).toFixed(3)), loose: Builder.statsData.loose };
});
log('wing moved', JSON.stringify(mv));
ok('the engines on the wing moved with it', mv.dy.every((v) => v === -1) && mv.loose === 0);
// deleting the wing removes what hangs on it; undo restores
const del = await ev(() => { const n = Builder.parts.length; Builder.selected = Builder.parts.find((p) => p.type === 'wingL'); Builder.deleteSel(); const m = Builder.parts.length; Builder.undo(); return [n, m, Builder.parts.length]; });
log('delete wing', JSON.stringify(del));
ok('deleting the wing takes the engines; undo brings all back', del[1] === del[0] - 4 && del[2] === del[0]);
// paint: a stealth fuselage, a wing matched to it
await ev(() => Builder.loadTemplate('spectre'));
st = await ev(() => Builder.parts.map((p) => p.type + ':' + (p.skin || '-')).join(' '));
log('spectre', st);
ok('spectre wing and tail come in stealth grey', /wingDelta:stealth/.test(st) && /vtailV:stealth/.test(st) && /jetF:stealth/.test(st));
await ev(() => Builder.loadTemplate('hornet'));
await ev(() => { const f = Builder.parts.find((p) => p.type === 'fuselage'); Builder.selected = f; Builder.renderInfo(); });
await page.click('#pi-skins [data-skin="stealth"]');
await ev(() => { Builder.selected = Builder.parts.find((p) => p.type === 'wingSwept'); Builder.renderInfo(); });
await page.keyboard.press('KeyM');
st = await ev(() => ({ wing: Builder.parts.find((p) => p.type === 'wingSwept').skin, sw: [...$('#pi-skins').children].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.skin) }));
log('paint', JSON.stringify(st));
ok('M matches the wing to the stealth fuselage', st.wing === 'stealth' && st.sw[0] === 'stealth');
await page.click('#btn-paint-all');
st = await ev(() => Builder.parts.map((p) => p.skin || '-'));
ok('All paints every paintable part', st.filter((x) => x === 'stealth').length >= 6);
log('all', JSON.stringify(st));
// a new part dropped on a painted body takes its paint
await ev(() => { const f = Builder.parts.find((p) => p.type === 'fuselage'), s = Builder.snap('cannon', { x: partRect(f).l - 0.3, y: f.y }, [], 0); Builder.addPart('cannon', s.x, s.y, 0, { z: s.z, att: s.att, host: s.host }); });
st = await ev(() => Builder.parts.find((p) => p.type === 'cannon').skin);
ok('a part put on a stealth body comes in stealth grey', st === 'stealth');
// codes round-trip depth, attachment and paint
await ev(() => Builder.loadTemplate('jumbo'));
await ev(() => { const p = Builder.parts.find((q) => q.type === 'fanPods'); p.z = 8; p.skin = 'navy'; Builder.changed(); });
const code = await ev(() => Builder.designCode(Builder.serialize()));
const back = await ev((c) => { const d = Builder.parseCode(c); Builder.loadDesign(d); const p = Builder.parts.find((q) => q.type === 'fanPods'); return { pre: c.slice(0, 5), z: partZ(p), skin: p.skin, loose: Builder.statsData.loose }; }, code);
log('code', JSON.stringify(back));
ok('a design code keeps depth and paint (RSS2)', back.pre === 'RSS2.' && back.z === 8 && back.skin === 'navy' && back.loose === 0);
const plain = await ev(() => { Builder.loadTemplate('skylark'); return Builder.designCode(Builder.serialize()).slice(0, 5); });
ok('a design without depth or paint still makes an RSS1 code', plain === 'RSS1.');
// old saves read back unchanged and not dirty
const dirty = await ev(() => { const d = { name: 'Old', kind: 'plane', parts: TEMPLATES.hornet.parts.map(([type, x, y]) => ({ type, x, y, flip: x < 0, rot: 0 })) }; store.set('rss.hangar', [d]); Builder.loadDesign(d); Builder.markSaved(d); return Builder.isDirty(); });
ok('an old saved design is not shown as changed', dirty === false);
// grid mode: snaps to quarter metres; free mode does not
const g = await ev(() => { Builder.loadTemplate('hopper'); Builder.setGrid(true); const a = Builder.snap('fin', { x: 3.13, y: 7.07 }, [], 0); Builder.setGrid(false); const c = Builder.snap('fin', { x: 3.13, y: 7.07 }, [], 0); return [a.x, a.y, c.x, c.y, $('#btn-grid').getAttribute('aria-pressed')]; });
log('grid', JSON.stringify(g));
ok('grid mode rounds to 0.25 m, free mode does not', g[0] * 4 === Math.round(g[0] * 4) && g[1] * 4 === Math.round(g[1] * 4) && (g[2] * 4 !== Math.round(g[2] * 4) || g[3] * 4 !== Math.round(g[3] * 4)) && g[4] === 'false');
// rockets: a booster on the front of the stack gets a twin at the back
const rk = await ev(() => { Builder.loadTemplate('pathfinder'); const t = Builder.parts.find((p) => p.type === 'tankL'); Builder.addPart('tankM', t.x, t.y, 0, { z: 2.6, att: t }); return Builder.parts.filter((p) => p.type === 'tankM').map((p) => [p.x, p.y, partZ(p)]); });
log('rocket', JSON.stringify(rk));
ok('a booster put on the front of a rocket stack gets its twin at the back', rk.some((r) => r[2] === 2.6) && rk.some((r) => r[2] === -2.6) && rk.filter((r) => r[2] === 2.6)[0][1] === rk.filter((r) => r[2] === -2.6)[0][1]);
await ev(() => Builder.loadTemplate('jumbo'));
await page.waitForTimeout(300);
await page.screenshot({ path: SHOTS + 'b2d-jumbo.png' });
await ev(() => { Builder.selected = Builder.parts.find((p) => p.type === 'fanPods'); Builder.renderInfo(); });
await page.waitForTimeout(200);
await page.screenshot({ path: SHOTS + 'b2d-panel.png' });

ok('no page errors', errs.length === 0, errs.join('\n'));
ok.done();
await b.close(); srv.close();
