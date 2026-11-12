// The sandbox's spawn points in the page (the spawn points update: Spawns in mpui.js, the Start button beside Launch):
//  - the Start button in Sandbox only, naming where the craft starts, inside the top bar with nothing over anything
//    else from a 360 x 640 phone to a 1920 x 1080 desktop (under 640 px its twin in the stats panel's head instead)
//  - the picker: the map and a list grouped by region, the kind's spots only (Armour: eight), the current one checked
//  - a spot chosen is checked, named on the button, remembered (rss.spawn) through a reload, and the launch starts there;
//    Revert starts there again; another kind keeps its own (a rocket still on the pad)
//  - each new spot's props set up and drawn round it (SHOTS=<dir>: screenshots of Watten, Bixter's drone pad, Lunna's
//    launch pad, Funningur, the Shetland airfield's helipads and the headland's slipway, phone and desktop)
//  - no console errors
//   node test/browser/spawns.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('spawns: the sandbox\'s Start button and its picker in the page');
const mapIn = () => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' && Render3D.ready;
// the top bar's buttons: each inside the window and over no other
const bar = () => {
  const L = [...document.querySelectorAll('#build-top button, #build-top .brand-name')].filter((n) => n.offsetParent && !n.hidden).map((n) => ({ id: n.id || n.className, r: n.getBoundingClientRect() }));
  const out = [], W = innerWidth;
  for (const a of L) if (a.r.left < -0.5 || a.r.right > W + 0.5) out.push(a.id + ' outside');
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const p = L[i].r, q = L[j].r; if (p.left < q.right - 0.5 && q.left < p.right - 0.5 && p.top < q.bottom - 0.5 && q.top < p.bottom - 0.5) out.push(`${L[i].id} over ${L[j].id}`); }
  const s = [document.querySelector('#btn-start'), document.querySelector('#btn-start-p')].find((n) => n && n.offsetParent && !n.hidden), sr = s && s.getBoundingClientRect();
  const st = document.querySelector('#stats').getBoundingClientRect();
  if (s && s.id === 'btn-start-p' && (sr.left < st.left - 0.5 || sr.right > st.right + 0.5)) out.push('btn-start-p outside the stats panel');
  return { bad: out, start: s ? { id: s.id, w: Math.round(sr.width), text: s.textContent, label: s.getAttribute('aria-label') } : null };
};

// ---- the button in every size (and none in Career)
for (const [w, h] of [[360, 640], [390, 844], [1280, 720], [1920, 1080]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  watch(page, errs, `${w}x${h} `);
  await openGame(page, srv.url);
  await page.waitForFunction(mapIn, null, { timeout: 180000 });
  await page.evaluate(() => { App.toBuild(); Builder.loadTemplate('tk34'); });
  await page.waitForTimeout(300);
  const r = await page.evaluate(bar);
  ok(`${w}x${h}: the Start button names where Armour starts (Highland Ridge), and nothing in the top bar is outside it or over anything else (on a phone, in the stats panel's head)`, !!r.start && /Highland Ridge/.test(r.start.label) && /Highland Ridge/.test(r.start.text) && !r.bad.length && r.start.id === (w > 640 ? 'btn-start' : 'btn-start-p'), r);
  await ctx.close();
}
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, errs, 'career ');
  await page.goto(srv.url + 'index.html');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('rss.seenHelp', 'true'); localStorage.setItem('rss.settings', JSON.stringify({ hints: false, targets: 'off', quality: 'low' })); });
  await page.reload(); await page.waitForTimeout(400);
  if (await page.isVisible('[data-mode="career"]')) await page.click('[data-mode="career"]');
  await page.waitForFunction(mapIn, null, { timeout: 180000 });
  const hid = await page.evaluate(() => { App.toBuild(); return !Career.sandbox && document.querySelector('#btn-start').hidden; });
  ok('Career: no Start button (every craft starts where it always has)', hid);
  await ctx.close();
}

// ---- the picker, a launch there, Revert, a reload; then each new spot's props (screenshots)
for (const [w, h, tag] of [[1280, 720, '1280x720'], [390, 844, '390x844']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  watch(page, errs, tag + ' ');
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `spawns-${name}-${tag}.png`) }); };
  await openGame(page, srv.url, { quality: w < 500 ? 'low' : 'high' });
  await page.waitForFunction(mapIn, null, { timeout: 180000 });
  await ev(() => { App.toBuild(); Builder.loadTemplate('tk34'); store.set('rss.flight', null); });
  await page.click(w > 640 ? '#btn-start' : '#btn-start-p');
  await page.waitForTimeout(600);
  const pick = await ev(() => ({ open: !document.querySelector('#start-map').hidden, regions: [...document.querySelectorAll('#start-list .start-region')].map((n) => n.textContent),
    spots: [...document.querySelectorAll('#start-list .spawn-opt')].map((n) => n.dataset.spot), on: document.querySelector('#start-list [aria-checked="true"]').dataset.spot,
    ink: (() => { const c = document.querySelector('#start-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 30) n++; return n; })() }));
  ok(`${tag}: the picker opens on its map with the list by region, Armour's eight spots, Highland Ridge checked`, pick.open && pick.regions.join() === 'Faroes,Shetland,Scotland' && pick.spots.join() === 'yard,funningur,vidareidi,tvoroyri,northRoe,bixter,highlandN,watten' && pick.on === 'highlandN' && pick.ink > 100, pick);
  await shot('picker');
  await page.click('#start-list [data-spot="watten"]');
  await page.waitForTimeout(300);
  const chose = await ev(() => ({ on: document.querySelector('#start-list [aria-checked="true"]').dataset.spot, btn: document.querySelector('#btn-start').getAttribute('aria-label'), kept: JSON.parse(localStorage.getItem('rss.spawn')) }));
  ok(`${tag}: Watten chosen: checked, named on the button, remembered for Armour`, chose.on === 'watten' && /Watten/.test(chose.btn) && chose.kept.tank === 'watten', chose);
  await page.click('#start-done');
  await page.click('#btn-launch');
  await page.waitForFunction(() => App.scene === 'flight' && Flight.running && Flight.active, null, { timeout: 120000 });
  const where = () => { const v = Flight.active, L = Terrain.locate(EARTH, v.x, v.y, v.z, {}); return { e: Math.round(-wrapAngle(L.a - EARTH.padAngle) * EARTH.radius), z: Math.round(L.z), kind: v.kind }; };
  const at = await ev(where), W = await ev(() => Spawns.place(Spawns.byId('watten'), 'tank', 0));
  ok(`${tag}: the launch starts at Watten`, Math.hypot(at.e - W.e, at.z - W.z) < 3, { at, W });
  await ev(() => { Render3D.skipDraw = true; Flight.revert(); });
  await page.waitForTimeout(500);
  const at2 = await ev(where);
  ok(`${tag}: Revert starts there again`, Math.hypot(at2.e - W.e, at2.z - W.z) < 3, at2);
  // a reload: still remembered; a rocket keeps its own (the pad)
  await page.reload(); await page.waitForTimeout(400);
  if (await page.isVisible('[data-mode="sandbox"]')) await page.click('[data-mode="sandbox"]');
  await page.waitForFunction(mapIn, null, { timeout: 180000 });
  const again = await ev(() => { App.toBuild(); Builder.loadTemplate('tk34'); const a = document.querySelector('#btn-start').getAttribute('aria-label'); Builder.loadTemplate('pathfinder'); Builder.changed(true); return { tank: a, rocket: document.querySelector('#btn-start').getAttribute('aria-label') }; });
  ok(`${tag}: after a reload Armour still starts at Watten; a rocket at the launch pad`, /Watten/.test(again.tank) && /Launch pad/.test(again.rocket), again);
  // each new spot's props round it, set up and drawn
  const cases = [['watten', 'tk34', 'tank', 'gb'], ['bixterDrone', 'bumble', 'drone', 'sh'], ['lunna', 'pathfinder', 'rocket', 'sh'], ['funningur', 'tk34', 'tank', 'sc'], ['shetlandAir', 'dragonfly', 'heli', 'sh']];
  for (const [id, key, kind, set] of cases) {
    await ev(([id, key, kind]) => { const t = TEMPLATES[key]; store.set('rss.flight', null); App.showScene('flight'); Flight.start({ name: t.name, kind: t.kind, parts: templateRows(t) }, { place: Spawns.place(Spawns.byId(id), kind, 0) }); Render3D.skipDraw = true; }, [id, key, kind]);
    await page.waitForFunction((k) => { const I = Render3D.propsInfo()[k]; return Flight.running && !!I && I.shown && I.ready && !I.job && I.drawn > 0; }, set, { timeout: 600000, polling: 250 });
    const I = await ev((k) => Render3D.propsInfo()[k], set);
    ok(`${tag}: at ${id} its region's props are set up and drawn round it`, I.shown && I.drawn > 50, I);
    if (SHOTS) {
      await ev((kind) => { Render3D.skipDraw = false; if (kind === 'drone' && Flight.setFpv) Flight.setFpv(false, true); Flight.aimYaw = 0.6; Flight.aimPitch = -0.12; Flight.scale *= 0.3; }, kind);
      await page.waitForTimeout(3500);
      await shot(id);
    }
  }
  // the headland past the runway: the road down to the slipway, the sea beyond (no causeway)
  await ev((shots) => { const t = TEMPLATES.buggy; store.set('rss.flight', null); App.showScene('flight'); Flight.start({ name: t.name, kind: t.kind, parts: templateRows(t) }, { place: { e: 2950, z: 0, yaw: 0 } }); Render3D.skipDraw = !shots; }, !!SHOTS);
  await page.waitForTimeout(SHOTS ? 4000 : 500);
  const sea = await ev(() => ({ road: Terrain.surfaceAt(EARTH, siteAngle(EARTH, 3300), 0), wet: Terrain.waterAt(EARTH, siteAngle(EARTH, 3400), 0), far: Terrain.waterAt(EARTH, siteAngle(EARTH, 9000), 0) }));
  ok(`${tag}: past the headland's slipway the track is sea (no causeway)`, sea.wet && sea.far, sea);
  await shot('headland');
  await ctx.close();
}
ok('no console errors', !errs.length, errs.slice(0, 6));
await b.close(); srv.close();
ok.done();
