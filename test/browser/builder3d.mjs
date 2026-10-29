// The 3D builder (software WebGL): the pointer finds a wing at depth, a jet dragged from the tray hangs under the wing
// 8 m out with a twin on the other wing, paint shows, and the craft flies with its depth and paint.
//   node test/browser/builder3d.mjs        (screenshots go to test/.cache/shots/)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = path.join(ROOT, 'test', '.cache', 'shots') + path.sep;
fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch();
const page = await (await b.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
const errs = [];
watch(page, errs);
await openGame(page, srv.url, { build3d: true });
await page.evaluate(() => App.toBuild());
await page.waitForFunction(() => Render3D.ready && App.preview3D(), null, { timeout: 30000 });
const log = (...a) => console.log(...a);
const ev = (f, a) => page.evaluate(f, a);
const ok = checks('3D builder: surface attach, paint, flight');
await ev(() => Builder.loadTemplate('jumbo'));
await page.waitForTimeout(1500);
log('api', JSON.stringify(await ev(() => ({ surfaceHit: typeof Render3D.surfaceHit, dp: Render3D.designPoint.length, dts: Render3D.designToScreen.length }))));
// where the wing's underside is, 8 m out on the right wing, on screen (once the hangar's camera has eased in to fit the
// craft: still easing, the wing moved between this and the pointer's test, and it missed, now and then)
const wingPoint = () => ev(() => { const w = Builder.parts.find((p) => p.type === 'wingL'), sec = Parts3D.wingAt ? Parts3D.wingAt(w.def, 8) : null; return { ...Render3D.designToScreen(w.x + (sec ? sec.x : 0), sec ? (sec.le + sec.te) / 2 + w.y : w.y - 2.5, 8), sec }; });
let at = await wingPoint();
for (let i = 0; i < 40; i++) { await page.waitForTimeout(250); const q = await wingPoint(), still = Math.hypot(q.x - at.x, q.y - at.y) < 0.5; at = q; if (still) break; }
log('screen point', JSON.stringify(at));
const hit = await ev((a) => { const h = Render3D.surfaceHit(a.x, a.y, new Set()); return h && { type: h.part.type, x: +h.x.toFixed(2), y: +h.y.toFixed(2), z: +h.z.toFixed(2), n: [h.nx, h.ny, h.nz].map((v) => +v.toFixed(2)) }; }, at);
log('hit', JSON.stringify(hit));
ok('the pointer finds the wing at depth', hit && hit.type === 'wingL' && Math.abs(hit.z - 8) < 1.5);
// drag a jet from the tray onto that spot
const placed = await ev((a) => {
  Builder.drag = { type: 'jet', fromPalette: true, offset: { x: 0, y: 0 }, rot: 0 };
  Render3D.editView(true);
  Builder.dragTo(a.x, a.y);
  const g = Builder.drag.ghost, host = Builder.drag.host && Builder.drag.host.type;
  Builder.dropDrag(a.y);
  const jets = Builder.parts.filter((p) => p.type === 'jet');
  return { ghost: g && { x: g.x, y: g.y, z: g.z, ok: g.ok, att: g.att && g.att.type }, host, jets: jets.map((p) => ({ z: partZ(p), att: p.att && Builder.parts.find((q) => q.id === p.att).type, skin: p.skin })), loose: Builder.statsData.loose };
}, at);
log('placed', JSON.stringify(placed));
ok('a jet dropped under the wing 8 m out hangs there, with a twin on the other wing', placed.jets.length === 2 && placed.jets.every((j) => j.att === 'wingL' && Math.abs(Math.abs(j.z) - placed.ghost.z) < 1e-6) && Math.abs(placed.ghost.z) > 6 && placed.loose === 0);
await page.waitForTimeout(800);
await page.screenshot({ path: SHOTS + 'b3d-jets.png' });
// paint the wing stealth grey and look
await ev(() => { Builder.selected = Builder.parts.find((p) => p.type === 'wingL'); Builder.renderInfo(); Builder.paintSel('stealth'); });
await page.waitForTimeout(800);
await page.screenshot({ path: SHOTS + 'b3d-paint.png' });
// fly it: the off-centre jets and pods fly symmetrically
await ev(() => App.launch());
await page.waitForFunction(() => typeof Flight !== 'undefined' && Flight.running, null, { timeout: 60000 });
await page.waitForTimeout(3000);
const fl = await ev(() => { const v = Flight.active; return { parts: v.parts.length, jets: v.parts.filter((p) => p.type === 'jet').map((p) => partZ(p)), skins: v.parts.filter((p) => p.skin).map((p) => p.type + ':' + p.skin), comz: v.com.z }; });
log('flight', JSON.stringify(fl));
ok('the flight craft keeps depth and paint', fl.jets.length === 2 && Math.abs(fl.jets[0] + fl.jets[1]) < 1e-6 && fl.skins.length > 0 && Math.abs(fl.comz || 0) < 1e-6);
await page.screenshot({ path: SHOTS + 'b3d-flight.png' });

ok('no page errors', errs.length === 0, errs.join('\n'));
ok.done();
await b.close(); srv.close();
