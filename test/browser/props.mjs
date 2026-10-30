// The battlefields' props in the real page (js/props.js, render3d.js updateProps):
//  - a TK-34 in Highland Ridge's village: the set is built and shown with the arena's own ground, every prop's pieces
//    drawn (instances per piece as Props lays them out), nine draws or fewer for them; a tree knocked over tips over and
//    ends lying, on the next frames; the crosshair's ray stops on a house in front of it
//  - the tank yard: a TK-34 on its first bay, the space centre's set shown (the island's props and the Runway's)
//  - an old plane on the runway: the island's props shown, Highland Ridge's never built (battery)
//  - without the Earth map: the Runway arena's props alone
//  - phones in portrait and a desktop; no console errors
// SHOTS=<dir> saves screenshots there (props-*.png).   node test/browser/props.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('props: the battlefields\' solid scenery in the page');
const mapIn = () => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' && Render3D.ready;
const start = ([key, place]) => { const t = TEMPLATES[key]; store.set('rss.flight', null); App.showScene('flight'); Flight.start({ name: t.name, kind: t.kind, parts: templateRows(t) }, place ? { place } : undefined); Render3D.skipDraw = true; };
// (start: page.evaluate hands over one argument, [key, place])
const setUp = (k) => { const I = Render3D.propsInfo()[k]; return Flight.running && !!I && I.shown && I.ready && !I.job; };
// how many instances of each piece Props' own layout asks for, the maps given
const want = (ids) => { const n = new Array(9).fill(0); for (const m of Props.areas()) if (ids.includes(m.id)) for (const p of m.props) Props.pieces(p, (pc) => n[pc]++); return n; };

for (const [w, h, tag] of [[1280, 720, '1280x720'], [390, 844, '390x844']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  watch(page, errs, tag + ' ');
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `props-${name}-${tag}.png`) }); };
  const draw = async () => { await ev(() => { Render3D.skipDraw = false; }); await page.waitForTimeout(1500); };
  await openGame(page, srv.url, { quality: w < 500 ? 'low' : 'high' });
  await page.waitForFunction(mapIn, null, { timeout: 180000 });
  // ---- Highland Ridge's village
  await ev(start, ['tk34', { e: 18190, z: 15040, yaw: 0 }]);
  await page.waitForFunction(setUp, 'hl', { timeout: 600000, polling: 250 });
  const hl = await ev((want) => { const I = Render3D.propsInfo().hl, w = eval(want)(['highland']); return { slots: I.slots, want: w.reduce((a, b) => a + b, 0), drawn: I.drawn, n: I.n, props: I.props, layout: Props.areas().find((m) => m.id === 'highland').props.length, built: !!Render3D.info().t.arenaBand }; }, want.toString());
  ok(`${tag}: in the village the Highland Ridge set is up with the arena's own ground, every prop's pieces in it, the far ones as their far shapes and the small far ones left out (level of detail)`,
    hl.built && hl.props === hl.layout && hl.props > 2500 && hl.slots === hl.want && hl.drawn < hl.slots && hl.n.slice(9).some((c) => c > 0), hl);
  await draw();
  // (a frame drawn at 1280x720 in software WebGL can take seconds: wait for two new ones, not for the clock)
  const frames = (n) => page.waitForFunction((k) => Flight.frameN >= k, n, { timeout: 120000, polling: 100 });
  await ev(() => { Flight.aimYaw = 0; Flight.aimPitch = -0.02; });
  await frames(await ev(() => Flight.frameN + 2));
  const calls = await ev(() => { const on = Render3D.info().calls; Render3D.propsOff = true; return on; });
  await frames(await ev(() => Flight.frameN + 2));
  const off = await ev(() => { const c = Render3D.info().calls; Render3D.propsOff = false; return c; });
  ok(`${tag}: the props add at most 20 draws (nine pieces and four far shapes, the near ones' shadows)`, calls > off && calls - off <= 20, { with: calls, without: off });
  await page.waitForTimeout(800);
  await shot('village');
  // the crosshair on a house: a house straight ahead along the street's side, the ray stops at its wall
  const ray = await ev(() => {
    // from the camera's own eye (where the aim ray starts) at the middle of a house's wall it sees first among the props
    const v = Flight.active, L = Terrain.locate(EARTH, v.x, v.y, v.z, {}), e0 = -wrapAngle(L.a - EARTH.padAngle) * EARTH.radius, z0 = L.z, R = EARTH.radius;
    const O = Render3D.aimRay({ o: v3(), d: v3() }).o, M = Props.F.SHELL | Props.F.SIGHT;
    const H = Props.areas().find((m) => m.id === 'highland').props.filter((p) => p.k === Props.K.house && Math.hypot(p.e - e0, p.z - z0) < 150).sort((a, b) => Math.hypot(a.e - e0, a.z - z0) - Math.hypot(b.e - e0, b.z - z0));
    for (const p of H) {
      const a = siteAngle(EARTH, p.e), ph = p.z / R, r = R + p.g + p.h / 2, T = { x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) };
      if (Props.segment(O, T, M) < 0 || Props._S.list[Props.hit.p] !== p) continue;
      const d = Math.hypot(T.x - O.x, T.y - O.y, T.z - O.z);
      Flight.aimDir = { x: (T.x - O.x) / d, y: (T.y - O.y) / d, z: (T.z - O.z) / d };
      GHUD.aimUpdate(Flight, true);
      const A = Flight.aim, P = Terrain.locate(EARTH, A.P.x, A.P.y, A.P.z, {}), pe = -wrapAngle(P.a - EARTH.padAngle) * R, de = pe - p.e, dz = P.z - p.z;
      const u = Math.abs(de * p.c + dz * p.s), w = Math.abs(-de * p.s + dz * p.c);
      return { ok: A.src === 'ground' && u < p.w / 2 + 0.6 && w < p.d / 2 + 0.6, d: Math.round(A.d), src: A.src, u: +u.toFixed(1), w: +w.toFixed(1) };
    }
    return { ok: false, n: H.length };
  });
  ok(`${tag}: the crosshair's ray stops on a house in front of the tank (its range is the wall's)`, ray.ok, ray);
  // a tree knocked over (as a vehicle would): it tips over in the next frames and ends lying
  const tree = await ev(() => { const p = Props.areas().find((m) => m.id === 'highland').props.find((q) => q.k === Props.K.conifer && !q.down); p.down = 1; p.fe = 1; p.fz = 0; p.t0 = Flight.time; Props._S.fallen.push(p); Props._S.crushed++; return Props.fallen.length; });
  await page.waitForFunction(() => Render3D.propsInfo().hl.anim > 0, null, { timeout: 30000 }).catch(() => {});
  const tipping = await ev(() => Render3D.propsInfo().hl.anim);
  await page.waitForFunction(() => Render3D.propsInfo().hl.anim === 0 && Flight.time > 1, null, { timeout: 300000 });
  ok(`${tag}: a tree knocked over tips over on the next frames, and is done in 0.7 s of the sim`, tree >= 1 && tipping === 1, { tree, tipping });
  // ---- the tank yard
  await ev(() => { const t = TEMPLATES.tk34, P = Props.yardPlace(1); Flight.start({ name: t.name, kind: t.kind, parts: templateRows(t) }, { place: P }); Render3D.skipDraw = true; });
  await page.waitForFunction(setUp, 'sc', { timeout: 600000, polling: 250 });
  const sc = await ev((want) => { const I = Render3D.propsInfo(); return { slots: I.sc.slots, want: eval(want)(['runway', 'isle']).reduce((a, b) => a + b, 0), drawn: I.sc.drawn, props: I.sc.props, hl: I.hl ? I.hl.shown : false }; }, want.toString());
  ok(`${tag}: at the tank yard the space centre's set is up (the island's props and the Runway's), Highland Ridge's not shown`, sc.props > 700 && sc.slots === sc.want && sc.drawn > 0 && !sc.hl, sc);
  await draw();
  await ev(() => { Flight.aimYaw = 0; Flight.aimPitch = -0.03; });
  await page.waitForTimeout(1200);
  await shot('yard');
  // ---- an old plane on the runway: the island's props, and Highland Ridge's arena and set never built here
  await ev(() => { Flight.stop(); });
  await ctx.close();
  const ctx2 = await b.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const p2 = await ctx2.newPage();
  watch(p2, errs, tag + ' plane ');
  await openGame(p2, srv.url, { quality: w < 500 ? 'low' : 'high' });
  await p2.waitForFunction(mapIn, null, { timeout: 180000 });
  await p2.evaluate(start, ['falcon', null]);
  await p2.waitForFunction(setUp, 'sc', { timeout: 600000, polling: 250 });
  const pl = await p2.evaluate(() => ({ sets: Object.keys(Render3D.propsInfo()), hlGroup: Props._S.groups.find((g) => g.ids.includes('highland')).started, arena: !!Render3D.info().t.arena }));
  ok(`${tag}: an old plane on the runway sees the island's props; Highland Ridge's are never laid out or drawn for it, nor its arena ground`, pl.sets.join() === 'sc' && !pl.hlGroup && !pl.arena, pl);
  await ctx2.close();
}
// ---- without the Earth map: the Runway arena's props alone
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.route('**/assets/earth-*', (r) => r.abort());
  page.on('pageerror', (e) => errs.push(`nomap PAGEERROR ${e.message}`));
  await openGame(page, srv.url, { quality: 'high' });
  await page.waitForFunction(() => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state !== 'loading' && Terrain.earthMap.state !== 'none' && Render3D.ready, null, { timeout: 180000 });
  await page.evaluate(start, ['tk34', { e: 1180, z: 40, yaw: 0 }]);
  await page.waitForFunction(setUp, 'sc', { timeout: 600000, polling: 250 });
  const r = await page.evaluate(() => ({ mapped: !!EARTH.mapped, maps: Props.areas().map((m) => m.id), props: Render3D.propsInfo().sc.props }));
  ok('without the Earth map: the Runway arena\'s props alone (sheds, containers, sandbags, blocks, a few trees)', !r.mapped && r.maps.join() === 'runway' && r.props > 60, r);
  if (SHOTS) { await page.evaluate(() => { Render3D.skipDraw = false; Flight.aimYaw = 0.35; Flight.aimPitch = -0.02; }); await page.waitForTimeout(2500); await page.screenshot({ path: path.join(SHOTS, 'props-runway-1280x720.png') }); }
  await ctx.close();
}
ok('no console errors', !errs.length, errs.slice(0, 6));
await b.close(); srv.close();
ok.done();
