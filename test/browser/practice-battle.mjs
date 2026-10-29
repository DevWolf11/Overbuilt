// The Practice Battle and the Tank Range played alone in the real page (the ground update):
//  - Career money: a Practice Battle lends its vehicle (the launch is free) and none of it is saved: Save & exit leaves
//    no flight to resume (resumed, it could be Recovered for 90% of a price never paid), and the funds stay put.
//  - Time warp: on the Tank Range and in a Practice Battle their bar takes the warp control's place, and the , and .
//    keys do nothing there (an 8x nobody could see, or a rails warp freezing the AI while the clock jumps).
//  - The Retro 2D flight (a silly setting): the battle is fought on the Runway arena, as a launch goes to the runway
//    (the 2D view can't show Highland Ridge).
//  - Phones in portrait (390, 375 and 360 wide): knocked out, the bar's "Knocked out · back in 5 s" shows whole.
//  - No console errors.
// SHOTS=<dir> saves screenshots there (pb-*.png).   node test/browser/practice-battle.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `pb-${name}.png`) }); };
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('practice-battle: the Practice Battle and the Tank Range, alone');
const mapIn = () => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' && Render3D.ready;
const inBattle = () => App.scene === 'flight' && GroundAI.battle && Flight.running && Flight.time > 1;
const tk34 = () => { const t = TEMPLATES.tk34; return { name: t.name, kind: t.kind, parts: templateRows(t) }; };

// ---- a phone in portrait: career money, then the bar's line at three widths
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  watch(page, errs, '390x844 ');
  await openGame(page, srv.url, { targets: 'practice' });
  await page.evaluate(() => localStorage.setItem('rss.career', JSON.stringify({ mode: 'career', funds: 50000, tier: 0, done: {}, flights: 0 })));
  await page.reload();
  const ev = (f, a) => page.evaluate(f, a);
  const tap = async (sel) => { const L = page.locator(sel).first(); await L.waitFor({ state: 'visible', timeout: 60000 }); await L.tap(); };
  await page.waitForFunction(mapIn, null, { timeout: 180000 });
  await ev(() => App.toHome()); await page.waitForTimeout(300);
  await tap('#home-mp'); await page.waitForTimeout(300);
  await tap('#mp-practice');
  await tap('#modal-card .rsp-opt >> text=/Modern/');
  await page.waitForFunction(inBattle, null, { timeout: 120000 });
  await ev(() => { Render3D.skipDraw = true; });
  const inB = await ev(() => { Flight.save(); return { career: !Career.sandbox, funds: Career.data.funds, saved: store.get('rss.flight', null), recover: Flight.canRecover(), name: Flight.active.name }; });
  ok('career, $50,000: in a Practice Battle (Modern) its vehicle came free, Recover is off, and a save (the 10 s autosave) keeps nothing',
    inB.career && inB.funds === 50000 && !inB.recover && inB.saved === null, inB);
  await tap('#btn-menu');
  await tap('#modal-card .btn >> text=/Save & exit/');
  await page.waitForTimeout(500);
  await ev(() => App.toHome()); await page.waitForTimeout(300);
  const home = await ev(() => ({ saved: store.get('rss.flight', null), resume: !$('#home-resume').hidden, funds: Career.data.funds, scene: App.scene }));
  await shot(page, 'home-after-save-exit-390x844');
  ok('...Save & exit: no flight saved, so Home offers no Resume (nothing to Recover for 90% of a free vehicle), funds still $50,000',
    home.saved === null && !home.resume && home.funds === 50000, home);
  // knocked out in a battle: "Knocked out · back in N s" whole at each width (the panel's Watch closes it)
  await ev((d) => GroundAI.startBattle(Flight, { money: 45000, design: d }), await ev(tk34));
  await page.waitForFunction(inBattle, null, { timeout: 120000 });
  await ev(() => { Render3D.skipDraw = true; Armour.knockOut(Flight.active, Flight, 'crew'); });
  await page.waitForFunction(() => !$('#modal').hidden && document.querySelector('#modal .rsp'), null, { timeout: 60000 });
  await page.locator('#modal-card .btn >> text=/^Watch$/').first().tap();
  for (const [W, H] of [[390, 844], [375, 667], [360, 780]]) {
    await page.setViewportSize({ width: W, height: H });
    await ev(() => { GroundAI.battle.respawnAt = Flight.time + 30; }); // (the countdown held up while we look)
    await page.waitForFunction(() => /back in \d+ s/.test($('#gai-bar .gai-sub').textContent), null, { timeout: 30000 });
    const m = await ev(() => {
      const s = $('#gai-bar .gai-sub'), B = $('#gai-bar').getBoundingClientRect(), V = innerWidth;
      const parts = [...s.querySelectorAll('span')].map((q) => { const r = q.getBoundingClientRect(); return { t: q.textContent, l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; });
      return { text: s.textContent, parts, bar: [Math.round(B.left), Math.round(B.right)], V, cut: s.scrollWidth > s.clientWidth + 1 };
    });
    if (SHOTS) { await ev(() => { Render3D.skipDraw = false; }); await page.waitForTimeout(2500); await shot(page, `knocked-out-${W}x${H}`); await ev(() => { Render3D.skipDraw = true; }); }
    const sec = m.parts.find((q) => /back in \d+ s/.test(q.t));
    ok(`${W}x${H}: knocked out, the bar's line "${m.text}" shows whole: the seconds to the respawn on screen and inside the bar`,
      !m.cut && !!sec && sec.r <= m.bar[1] + 1 && sec.l >= m.bar[0] - 1 && sec.r <= m.V && m.parts.every((q) => q.w > 0), m);
  }
  await ctx.close();
}

// ---- a desktop: the warp keys on the Tank Range and in a battle; then the Retro 2D view
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, errs, '1280x720 ');
  await openGame(page, srv.url, { targets: 'practice' });
  const ev = (f, a) => page.evaluate(f, a);
  await page.waitForFunction(mapIn, null, { timeout: 180000 });
  const d = await ev(tk34);
  await ev((x) => { Flight.start(x, { place: GroundMode.placement('highland', 0, 0, 'tank') }); App.showScene('flight'); }, d);
  await page.waitForFunction(() => App.scene === 'flight' && Flight.running && Flight.time > 1 && GroundAI.range && $('#gai-bar') && !$('#gai-bar').hidden, null, { timeout: 180000 });
  await page.mouse.click(640, 200); // (the page has the keys)
  const keys = async () => { for (let i = 0; i < 3; i++) { await page.keyboard.press('Period'); await page.waitForTimeout(80); } return ev(() => ({ warpIdx: Flight.warpIdx, warpHidden: $('#warp').hidden })); };
  const r = await keys();
  ok('Tank Range: its bar in the warp control\'s place, and . pressed three times leaves the warp at 1x', r.warpIdx === 0 && r.warpHidden, r);
  await ev((x) => GroundAI.startBattle(Flight, { money: 45000, design: x }), d);
  await page.waitForFunction(inBattle, null, { timeout: 120000 });
  const k = await keys();
  ok('Practice Battle: the same, as in a room (everyone on one clock)', k.warpIdx === 0 && k.warpHidden, k);
  await ev(() => App.toBuild());
  const off = await ev(() => { Flight.start(TEMPLATES.buggy ? { name: 'Buggy', kind: 'car', parts: templateRows(TEMPLATES.buggy) } : null); App.showScene('flight'); return true; });
  await page.waitForFunction(() => App.scene === 'flight' && Flight.running && Flight.time > 0.5, null, { timeout: 60000 });
  await ev(() => Flight.setWarp(1));
  const w = await ev(() => ({ warpIdx: Flight.warpIdx, warpHidden: $('#warp').hidden, range: !!GroundAI.range }));
  ok('...a car on the runway (no range, no battle) still warps as ever', off && w.warpIdx === 1 && !w.warpHidden && !w.range, w);
  await ev(() => { Flight.setWarp(0); App.toBuild(); });
  // Retro 2D: from the room screen's button, the battle on the Runway
  await ev(() => { localStorage.setItem('rss.silly', JSON.stringify({ retro2d: true })); localStorage.setItem('rss.sillyUnlocked', 'true'); });
  await page.reload();
  await page.waitForFunction(mapIn, null, { timeout: 180000 });
  await ev(() => App.toHome()); await page.waitForTimeout(300);
  await page.click('#home-mp'); await page.waitForTimeout(300);
  await page.click('#mp-practice');
  await page.locator('#modal-card .rsp-opt >> text=/WWII/').first().click();
  await page.waitForFunction(inBattle, null, { timeout: 120000 });
  await page.waitForTimeout(800);
  const g = await ev(() => { const v = Flight.active, L = Terrain.locate(EARTH, v.x, v.y, v.z, {}); return { arena: GroundAI.battle.arena, e: Math.round(-wrapAngle(L.a - EARTH.padAngle) * EARTH.radius), z: Math.round(L.z), use3D: App.use3D(), ai: GroundAI.ai.length }; });
  await shot(page, 'retro2d-1280x720');
  ok('Retro 2D flight: the Practice Battle is on the Runway arena, the player at its west end and the AI with it (Highland Ridge is out of the 2D view)',
    g.arena === 'runway' && !g.use3D && g.e > 600 && g.e < 900 && Math.abs(g.z) < 100 && g.ai === 5, g);
  await ctx.close();
}

ok('no console or page errors', !errs.length, errs.slice(0, 5));
ok.done();
await b.close(); srv.close();
