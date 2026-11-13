// The wingtip vapour trails (flight.js emitParticles) in the page, on High: a plane pulling hard in the air puts its
// streaks off the tips of its main wing as the 3D model draws them (the owner's report after PR #50: on a wing ahead of or
// behind the craft's middle, or swept, they came off in front of the tip or behind it).
//  - For stock planes with every kind of main wing (straight, elliptical, a biplane, a delta, a swing wing, a cranked
//    wing, swept ones, a planform drawn wing), custom designs with the main wing moved 2 m forward and 2 m back, and the
//    Winglet Wing and the Forward-Swept Wing (no stock plane has them) in a Jumbo's and a Skylark's, at 200 m/s: each streak's newest puff, as drawn (after FX.update, at the frame's render), is within 0.3 m (×
//    the span over 10 m, for the big ones) of the middle of that tip of the wing's mesh (its outermost ring of vertices, a
//    winglet's top), both sides, in the craft's own frame.
//  - No console errors (App.frame swallows them).
// SHOTS=<dir> saves a screenshot per plane (wingtips-<key>.png), the view from behind and above.
//   node test/browser/wingtips.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('wingtips: the vapour trails come off the wingtips');
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }), page = await ctx.newPage();
watch(page, errs);
await openGame(page, srv.url, { quality: 'high' });
await page.evaluate(async () => {
  await Render3D.load();
  window.__errs = [];
  const f = Flight.update; Flight.update = function (...a) { try { return f.apply(this, a); } catch (e) { window.__errs.push(String(e && e.stack)); throw e; } };
  // a hard pull, every frame: the streaks' g, and both tips' dice won
  const em = Flight.emitParticles;
  Flight.emitParticles = function (dt) {
    const v = this.active, g = v && v.gForce, r = Math.random;
    if (v) v.gForce = 7;
    Math.random = () => 0;
    try { return em.call(this, dt); } finally { Math.random = r; if (v) v.gForce = g; }
  };
  // after each frame drawn: the newest puff of each streak against the main wing's mesh, in the craft's part space
  const rf = Render3D.renderFlight;
  Render3D.renderFlight = function (F, ...a) {
    const out = rf.call(this, F, ...a);
    const v = F.active, w = v && v.mainWing, vm = v && Render3D.meshOf(v), rig = vm && w && vm.items.get(w);
    if (!rig || !window.__want) return out;
    const lw = vm.group.parent.parent, bp = bodyPos(v.body, F.time), cam = F.camAbs, P = new rig.root.position.constructor();
    const pts = [];
    rig.root.updateWorldMatrix(true, true);
    rig.root.traverse((o) => {
      if (!o.isMesh || !o.visible || !o.geometry) return;
      const A = o.geometry.attributes.position;
      for (let i = 0; i < A.count; i++) {
        P.fromBufferAttribute(A, i).applyMatrix4(o.matrixWorld); lw.worldToLocal(P);
        pts.push(v.toLocal(P.x + cam.x - bp.x, P.y + cam.y - bp.y, P.z + (cam.z || 0)));
      }
    });
    const tips = {};
    for (const s of [-1, 1]) {
      const zmax = Math.max(...pts.map((q) => s * q.z)), far = pts.filter((q) => s * q.z > zmax - 0.2); // (the tip's ring: a swing wing's, turned back, slants 0.1 m across)
      const wd = w.def.wing, top = wd.winglets || wd.gap ? Math.min(...far.map((q) => q.x)) : null, at = top == null ? far : far.filter((q) => q.x < top + (wd.gap ? wd.gap / 2 : 0.05)); // (winglets: the winglet's top; a biplane: the top wing's)
      const n = at.length;
      tips[s] = { x: at.reduce((a, q) => a + q.x, 0) / n, y: at.reduce((a, q) => a + q.y, 0) / n, z: at.reduce((a, q) => a + q.z, 0) / n };
    }
    const dt = window.__dt || 0;
    const puffs = FX.list.filter((p) => p.color === '#f4f8ff' && p.size === 0.25 && p.life <= dt + 1e-9).map((p) => v.toLocal(p.x, p.y, p.z));
    window.__got = { tips, puffs, span: w.def.wing.span, wy: w.y, n: pts.length };
    return out;
  };
  const fu = FX.update; FX.update = function (dt, F) { window.__dt = dt; return fu.call(this, dt, F); };
});
// the designs: [label, template, metres the main wing moves forward, another main wing in its place]
const CASES = [['skylark', 'skylark', 0], ['mustang (elliptical)', 'mustang', 0], ['camel (biplane)', 'camel', 0], ['viper (delta)', 'viper', 0],
  ['kestrel (swing wing)', 'kestrel', 0], ['jumbo (large swept)', 'jumbo', 0], ['fs4 (cranked)', 'fs4', 0], ['fs16', 'fs16', 0], ['sugoi27 (planform)', 'sugoi27', 0], ['fs35', 'fs35', 0],
  ['skylark, wing 2 m forward', 'skylark', 2], ['skylark, wing 2 m back', 'skylark', -2], ['fs16, wing 2 m forward', 'fs16', 2], ['fs16, wing 2 m back', 'fs16', -2],
  ['jumbo with the Winglet Wing', 'jumbo', 0, 'wingWinglet'], ['skylark with the Forward-Swept Wing', 'skylark', 0, 'wingForward']];
const res = [];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const [label, key, dy, swap] of CASES.filter((c) => !ONLY || ONLY.includes(c[1]))) {
  await page.evaluate(([key, dy, swap]) => {
    App.toBuild(); Builder.loadTemplate(key); store.set('rss.flight', null);
    const W = Builder.parts.filter((p) => p.def.wing && !p.def.wing.control).sort((a, b) => b.def.wing.area - a.def.wing.area)[0];
    if (dy) for (const p of Builder.parts) if (p === W || p.att === W.id) p.y += dy;
    if (swap) { W.type = swap; W.def = PARTS[swap]; }
    App.showScene('flight'); window.__want = false; window.__got = null;
    Flight.start(Builder.serialize(), { place: { e: 0, z: 0, yaw: 0, air: { alt: 1500, speed: 200 } } });
  }, [key, dy, swap || null]);
  await page.waitForFunction(() => Flight.running && Flight.active && Flight.time > 0.5, null, { timeout: 60000 });
  await page.evaluate(() => { window.__want = true; window.__got = null; });
  await page.waitForFunction(() => window.__got && window.__got.puffs.length >= 2, null, { timeout: 60000 }).catch(() => {});
  const g = await page.evaluate(() => window.__got);
  if (SHOTS) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: path.join(SHOTS, `wingtips-${label.replace(/[^a-z0-9]+/gi, '-')}.png`) });
  }
  if (process.env.DEBUG) console.log(label, JSON.stringify(g && { tips: g.tips, puffs: g.puffs.slice(0, 4) }), await page.evaluate(() => { const w = Flight.active.mainWing; return JSON.stringify({ sweep: w.sweep, x: w.x, y: w.y, rot: w.rot }); }));
  if (!g || g.puffs.length < 2) { res.push({ label, err: 'no streaks' }); continue; }
  const lim = 0.3 * Math.max(1, g.span / 10), d = [];
  for (const s of [-1, 1]) {
    const T = g.tips[s], near = g.puffs.filter((q) => Math.sign(q.z) === s).map((q) => Math.hypot(q.x - T.x, q.y - T.y, q.z - T.z));
    d.push(near.length ? Math.min(...near) : Infinity);
  }
  res.push({ label, d, lim, wy: g.wy });
}
for (const r of res) {
  if (r.err) { ok(`${r.label}: the streaks off the wingtips`, false, r.err); continue; }
  ok(`${r.label}: each streak's newest puff within ${r.lim.toFixed(2)} m of the mesh's wingtip (left ${r.d[0].toFixed(3)} m, right ${r.d[1].toFixed(3)} m)`, Math.max(...r.d) <= r.lim);
}
const pe = await page.evaluate(() => window.__errs);
ok('no errors in the page', !errs.length && !pe.length, [...errs, ...pe].slice(0, 3).join(' | ') || undefined);
await b.close(); srv.close();
ok.done();
