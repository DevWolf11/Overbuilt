// Building a ship (the ships update, WP4): the seven-button kind strip with Ship, the five Ship tabs (Ship hulls first),
// an empty blueprint from the Hopper; the slice ship built by taps alone (a midsection, a bow, a stern, a second
// midsection, the wheelhouse, a pair of diesels, a pair of screws and their rudders), each part where it goes, joined end to
// end; a midsection tapped onto a finished hull goes in behind the bow; the stats speak ship (displacement, draught,
// stability, top speed in knots; no thrust, Δv or stages) and the blue waterline is drawn at her draft in 2D and 3D; a
// 152 m hull fits a 360×640 phone and a 1280×720 desktop; each warning fires (no hull, no bridge, no screw, no rudder, no
// engine, open stern and bow, top-heavy, a list, down by the bow, overloaded, sinks, a propeller out of the water), the
// rocket's "No engine fires in stage 1" never; and she launches, console clean.
//   node test/browser/builder-ship.mjs        (screenshots: SHOTS=<dir>, default test/.cache/shots/)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = (process.env.SHOTS || path.join(ROOT, 'test', '.cache', 'shots')) + path.sep;
fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch();
const errs = [];
const ok = checks('builder: ships');
const open = async (w, h, touch, settings = {}) => {
  const page = await (await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 })).newPage();
  watch(page, errs, `${w}x${h} `);
  await openGame(page, srv.url, { build3d: false, ...settings });
  await page.evaluate(() => App.toBuild());
  await page.waitForTimeout(300);
  return page;
};
const frames = (page, n) => page.evaluate((n) => new Promise((ok) => { let i = 0; const f = () => (++i >= n ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const tapPart = async (page, tab, name, touch = true) => {
  const t = page.locator('#palette-tabs .tab', { hasText: new RegExp(`^${tab}$`) }), it = page.locator('#palette-items .part-item', { has: page.locator('.part-name', { hasText: new RegExp(`^${name}$`) }) });
  if (touch) { await t.tap(); await it.tap(); } else { await t.click(); await it.click(); }
  await frames(page, 2);
};
// the parts on the blueprint not under a panel (drawn on the bare canvas)
const inSight = (page) => page.evaluate(() => {
  let vis = 0;
  for (const p of Builder.parts) { const s = Builder.partScreen(p), e = s && document.elementFromPoint(s.x, s.y); if (e && e.tagName === 'CANVAS') vis++; }
  return { n: Builder.parts.length, vis };
});
const stats = (page) => page.evaluate(() => {
  const S = Builder.statsData.ship, txt = (id) => $(id).textContent.split(String.fromCharCode(160)).join(' '), shown = (id) => !$(id).hidden; // (no-break spaces read as spaces)
  return { kind: Builder.kind, warn: txt('#s-warn'), line: shown('#s-ground') ? txt('#s-ground') : '', disp: txt('#s-disp'), draught: txt('#s-draught'), gm: txt('#s-gm'), top: txt('#s-top'),
    rows: ['#s-mass-row', '#s-disp-row', '#s-draught-row', '#s-stab-row', '#s-top-row', '#s-thrust-row', '#s-twr-row', '#s-dv-row', '#s-stage-box'].filter(shown),
    S: S && { hull: S.hull, draft: S.draft, GM: S.GM, top: S.top, trim: S.trim, heel: S.heel, open: S.open, comps: S.comps, sinks: S.sinks }, launch: !$('#btn-launch').disabled };
});

// ---- 1. a phone in portrait (390 × 844): the kind strip, the tabs, the slice ship by taps
let page = await open(390, 844, true);
const ev = (f, a) => page.evaluate(f, a);
await ev(() => { Builder.loadTemplate('hopper'); });
let r = await ev(() => { const s = $('#kind-select'), bs = [...s.querySelectorAll('.kind-btn')], R0 = s.getBoundingClientRect(); return { n: bs.length, ship: bs.map((x) => x.dataset.kind).indexOf('ship'), inside: bs.every((x) => { const q = x.getBoundingClientRect(); return q.left >= R0.left - 0.5 && q.right <= R0.right + 0.5 && q.width > 30; }) }; });
ok('the kind strip has seven buttons, Ship last, each in the strip', r.n === 7 && r.ship === 6 && r.inside, JSON.stringify(r));
await page.locator('#kind-select [data-kind="ship"]').tap();
await frames(page, 2);
r = await ev(() => ({ kind: Builder.kind, parts: Builder.parts.length, tab: Builder.category, name: Builder.name, tabs: [...document.querySelectorAll('#palette-tabs .tab')].map((t) => t.textContent), sym: Builder.symmetry, symKey: Builder.symKey('ship') }));
ok('Ship from the Hopper: a new, empty Ship design on the Ship hulls tab, symmetry on (its own setting)', r.kind === 'ship' && r.parts === 0 && r.tab === 'shHull' && r.name === 'Ship' && r.sym && r.symKey === 'rss.symmetryShip', JSON.stringify(r));
ok('the five Ship tabs, then More', ['Ship hulls', 'Superstructure', 'Propulsion', 'Naval weapons', 'Ship kit'].every((t, i) => r.tabs[i] === t) && /More/.test(r.tabs[5] || ''), r.tabs.join('|'));
r = await stats(page);
ok('an empty ship: no hull, no bridge, ship rows (no thrust, T/W, Δv or stages), can\'t launch', /No hull: she can't float/.test(r.warn) && /Add a bridge/.test(r.warn) && !/stage 1/.test(r.warn) && !r.launch
  && r.rows.join() === '#s-disp-row,#s-draught-row,#s-stab-row,#s-top-row', JSON.stringify(r));
await tapPart(page, 'Ship hulls', 'Patrol Midsection');
r = await stats(page);
ok('a midsection alone floats (draught, GM, the waterline) with both ends open', r.S.hull && r.S.draft > 0.2 && r.S.GM > 0.5 && /The stern is open/.test(r.warn) && /The bow is open/.test(r.warn), JSON.stringify(r));
await tapPart(page, 'Ship hulls', 'Patrol Bow');
await tapPart(page, 'Ship hulls', 'Patrol Stern');
await tapPart(page, 'Ship hulls', 'Patrol Midsection');
r = await ev(() => { const hs = Builder.parts.filter((p) => p.def.shull).sort((a, b) => a.x - b.x); return { types: hs.map((p) => p.type).join(), xs: hs.map((p) => p.x), ys: hs.map((p) => p.y), open: Builder.statsData.ship.open }; });
ok('four taps: stern, midsection, midsection, bow, end to end (a second midsection goes in behind the bow), no end open', r.types === 'hbSternM,hbMidM,hbMidM,hbBowM' && r.open === 0
  && JSON.stringify(r.xs) === '[-7,0,8,17]' && JSON.stringify(r.ys) === '[0,0,0,0.3]', JSON.stringify(r));
r = await stats(page);
ok('the hull: still no bridge, nothing pushes or steers her', /Add a bridge/.test(r.warn) && /nothing pushes her/.test(r.warn) && /No rudder/.test(r.warn) && !/open/.test(r.warn), r.warn);
await tapPart(page, 'Superstructure', 'Wheelhouse');
await tapPart(page, 'Propulsion', 'Large Marine Diesel');
await tapPart(page, 'Propulsion', 'Propeller');
r = await stats(page);
ok('the wheelhouse on deck, a pair of diesels inside, a pair of screws: she can launch, a rudder still wanted', r.launch && !/Add a bridge/.test(r.warn) && /No rudder/.test(r.warn) && !/nothing pushes/.test(r.warn) && !/No engine/.test(r.warn), r.warn);
await tapPart(page, 'Propulsion', 'Rudder');
r = await ev(() => {
  const ps = Builder.parts, by = (t) => ps.filter((p) => p.type === t), adj = buildAdjacency(ps), c = findControlPart(ps), comp = c ? componentOf(c.id, adj) : new Set();
  const hull = (p) => ps.find((q) => q.id === p.att), deck = (p) => { const h = hull(p); return h ? h.y + shullSec(h.def.shull.st, p.x - h.x)[0] : NaN; };
  const br = by('bridgeM')[0], ds = by('dieselM'), sc = by('screwM'), ru = by('rudderM');
  return { n: ps.length, joined: comp.size, bridgeOnDeck: br && Math.abs(partRect(br).b - deck(br)) < 0.02,
    dieselsIn: ds.length === 2 && ds.every((p) => hull(p) && hull(p).def.shull && Math.abs(partZ(p) + partZ(ds[0] === p ? ds[1] : ds[0])) < 0.01),
    screws: sc.map((p) => [p.x, p.y, partZ(p)]), rudders: ru.map((p) => [p.x, p.y, partZ(p)]),
    ruddersBehind: ru.length === 2 && ru.every((q) => sc.some((s) => Math.abs(partZ(s) - partZ(q)) < 0.01 && partRect(q).r < partRect(s).l + 1e-6 && partRect(s).l - partRect(q).r < 0.2)) };
});
ok('nine taps make the slice ship: 11 parts, all joined, the bridge on the deck, the diesels a pair inside the hull, each rudder just behind its screw',
  r.n === 11 && r.joined === 11 && r.bridgeOnDeck && r.dieselsIn && r.ruddersBehind, JSON.stringify(r));
r = await stats(page);
ok('no warnings left; displacement, draught, GM and ~knots read, and the line her freeboard and compartments', r.warn === '' && /^\d+(\.\d)? t$/.test(r.disp) && /^\d+\.\d m$/.test(r.draught)
  && /^GM \d/.test(r.gm) && /^~\d+ kn$/.test(r.top) && /^freeboard \d+\.\d m · 4 compartments · 4,000 kW · turns in ~\d+ m/.test(r.line), JSON.stringify(r));
r = await inSight(page);
ok('the ship stays in sight as she grows (every part on the bare blueprint)', r.vis === r.n, JSON.stringify(r));
// the waterline: drawn across her at her draft (the pixel under the line amidships is blue, the one well above it not)
const wlPix = () => ev(() => {
  const S = Builder.statsData.ship, x = (S.x0 + S.x1) / 2 + 0.5, W = Builder.waterline3d(), y = W.a + W.bx * x;
  const d = Builder.toDisp(x, y), c = App.canvas.getBoundingClientRect(), k = Builder.cam.scale, dpr = App.canvas.width / c.width;
  const sx = (c.width / 2 + (d.x - Builder.cam.x) * k) * dpr, sy = (c.height / 2 - (d.y - Builder.cam.y) * k) * dpr;
  const px = (yy) => [...App.ctx.getImageData(Math.round(sx), Math.round(yy), 1, 1).data];
  let on = px(sy); for (let d = -4; d <= 4; d++) { const q = px(sy + d); if (q[2] - q[0] > on[2] - on[0]) on = q; } // (the bluest pixel across the line)
  return { on, above: px(sy - 14 * dpr) };
});
await ev(() => { Builder.selected = null; Builder.renderInfo(); });
await frames(page, 3);
r = await wlPix();
ok('2D: the blue waterline is drawn across her at her draft', r.on[2] > 200 && r.on[2] > r.on[0] + 100 && !(r.above[2] > r.above[0] + 100), JSON.stringify(r));
await page.screenshot({ path: SHOTS + 'ship-phone-2d.png' });
// a part's card up: the ship still in sight above it
await ev(() => { Builder.selected = Builder.parts.find((p) => p.type === 'bridgeM'); Builder.renderInfo(); Builder.layout(); Builder.keepInView(); });
await frames(page, 3);
r = await inSight(page);
ok('with a part\'s card up she is still in sight above it', r.vis === r.n, JSON.stringify(r));
await page.screenshot({ path: SHOTS + 'ship-phone-card.png' });

// ---- 2. the warnings, each from a design that has the fault (the slice ship's rows, less some, or with weight added: each
// added part hangs on a hull segment, so it is aboard)
const warnOf = (rows, name = 'W') => ev(([rows, name]) => { Builder.loadDesign({ name, kind: 'ship', parts: rows }); return $('#s-warn').textContent; }, [rows, name]);
const slice = await ev(() => Builder.serialize().parts);
const without = (types) => { const keep = slice.map((q) => !types.includes(q.type)), idx = []; let k = 0; for (const f of keep) idx.push(f ? k++ : -1);
  return slice.filter((_, i) => keep[i]).map((q) => { const o = { ...q }; delete o.att; if (q.att != null && idx[q.att] >= 0) o.att = idx[q.att]; return o; }); };
const host = (t, n = 0) => slice.map((q, i) => [q, i]).filter(([q]) => q.type === t)[n][1];
const plus = (extra) => slice.concat(extra.map(([x, y, z, on]) => ({ type: 'dieselM', x, y, z, flip: x < 0, rot: 0, att: on })));
let w = await warnOf(without(['hbSternM']));
ok('warning: no stern -> the stern is open', /The stern is open: she will flood/.test(w), w);
w = await warnOf(without(['hbBowM']));
ok('warning: no bow -> the bow is open', /The bow is open: she will flood/.test(w), w);
w = await warnOf(without(['dieselM']));
ok('warning: screws but no engine', /No engine turns her propellers/.test(w) && !/nothing pushes/.test(w), w);
w = await warnOf(without(['screwM']));
ok('warning: no screw', /No screw or waterjet: nothing pushes her/.test(w), w);
w = await warnOf(without(['rudderM']));
ok('warning: no rudder', /No rudder: she can't steer/.test(w), w);
w = await warnOf(without(['bridgeM']));
ok('warning: no bridge (and her hull\'s numbers still show)', /Add a bridge/.test(w) && (await stats(page)).S.hull, w);
w = await warnOf(plus([0, 1, 2, 3].map((i) => [-2 + 4 * i, 30, 0, host('hbMidM')])));
ok('warning: top-heavy (weight piled high) -> she will capsize, GM red', /Top-heavy: GM −\d/.test(w) && (await ev(() => $('#s-gm').className)) === 'bad', w);
w = await warnOf(plus([[4, 3.1, 2.4, host('hbMidM', 1)], [4, 5.3, 2.4, host('hbMidM', 1)]]));
ok('warning: weight to one side -> she lists to starboard', /She lists \d+° to starboard: move weight across/.test(w), w);
w = await warnOf(plus([0, 1, 2].map((i) => [18, 3.4 + 2.2 * i, 0, host('hbBowM')])));
ok('warning: weight in the bow -> down by the bow', /Down by the bow [\d.]+°: move weight aft/.test(w), w);
w = await warnOf(plus([...Array(100)].map((_, i) => [-6 + 4 * (i % 6), 3.2 + 2.2 * Math.floor(i / 12), i % 12 < 6 ? 2 : -2, host('hbMidM')])));
ok('warning: far too heavy -> she\'ll sink (and the draught row says so)', /She'll sink/.test(w) && (await stats(page)).draught === 'sinks', w);
r = await ev((slice) => { // (laden a diesel at a time, low and level, until the deck nears the water)
  for (let n = 60; n < 100; n++) {
    const rows = slice.concat([...Array(n)].map((_, i) => ({ type: 'dieselM', x: -6 + 4 * (i % 6), y: -0.5 + 0.01 * Math.floor(i / 12), z: i % 12 < 6 ? 2 : -2, flip: false, rot: 0, att: 1 })));
    Builder.loadDesign({ name: 'L', kind: 'ship', parts: rows });
    const w = $('#s-warn').textContent;
    if (/Overloaded|sink/.test(w)) return { n, w };
  }
  return null;
}, slice);
ok('warning: heavily laden -> overloaded, her deck near the water (before she sinks)', r && /Overloaded: her deck is only 0\.\d m above the water/.test(r.w), JSON.stringify(r));
w = await warnOf(slice.map((q) => (q.type === 'screwM' ? { ...q, y: q.y + 5 } : q)));
ok('warning: a propeller out of the water', /A propeller is out of the water/.test(w), w);
ok('never the rocket\'s "No engine fires in stage 1" on a ship', !/stage 1/.test(w));

// ---- 3. a 152 m hull fits a 360 × 640 phone and a 1280 × 720 desktop (2D)
const LONG = () => { const rows = [{ type: 'hbSternM', x: -73, y: 0, flip: true, rot: 0 }]; for (let i = 0; i < 17; i++) rows.push({ type: 'hbMidM', x: -66 + 8 * i, y: 0, flip: -66 + 8 * i < 0, rot: 0 }); rows.push({ type: 'hbBowM', x: 71 + 0, y: 0.3, flip: false, rot: 0 }); return rows; };
const fits = async (pg) => pg.evaluate((rows) => {
  Builder.loadDesign({ name: 'Long', kind: 'ship', parts: rows }); Builder.fitView();
  const a = Builder.viewArea(), c = App.canvas.getBoundingClientRect(), k = Builder.cam.scale;
  let l = Infinity, r = -Infinity;
  for (const p of Builder.parts) { const R = partRect(p); for (const x of [R.l, R.r]) { const sx = c.left + c.width / 2 + (x - Builder.cam.x) * k; l = Math.min(l, sx); r = Math.max(r, sx); } }
  const len = Math.max(...Builder.parts.map((p) => partRect(p).r)) - Math.min(...Builder.parts.map((p) => partRect(p).l));
  return { len, l, r, a0: a.cx - a.w / 2, a1: a.cx + a.w / 2, scale: k };
}, LONG());
await page.close();
for (const [W, H, touch] of [[360, 640, true], [1280, 720, false]]) {
  const pg = await open(W, H, touch);
  for (const fold of [true, false]) { // (the panel as it opens, folded on a small phone, and opened out)
    if (!fold) await pg.evaluate(() => { $('#stats').classList.remove('collapsed'); Builder.layout(); });
    r = await pg.evaluate(() => { const s = $('#kind-select').getBoundingClientRect(), p = $('#stats').getBoundingClientRect(), bs = [...document.querySelectorAll('#kind-select .kind-btn')];
      return { folded: $('#stats').classList.contains('collapsed'), inside: s.left >= p.left - 0.5 && s.right <= p.right + 0.5, fit: bs.every((b) => b.scrollWidth <= b.clientWidth && b.getBoundingClientRect().right <= s.right + 0.5 && b.getBoundingClientRect().width > 25), n: bs.length }; });
    ok(`${W}×${H}: the kind strip (${r.folded ? 'folded' : 'open'}) keeps all seven inside the panel, each label whole`, r.n === 7 && r.inside && r.fit, JSON.stringify(r));
  }
  r = await fits(pg);
  ok(`a ${Math.round(r.len)} m hull fits ${W}×${H} (all of her inside the view)`, r.len > 150 && r.l >= r.a0 - 1 && r.r <= r.a1 + 1 && r.scale >= 1.2 - 1e-9, JSON.stringify(r));
  await frames(pg, 3);
  await pg.screenshot({ path: SHOTS + `ship-152m-${W}x${H}.png` });
  if (W === 1280) { // the slice ship on a desktop, 2D, then 3D, and a launch
    await pg.evaluate(() => Builder.loadTemplate('cyclon'));
    await frames(pg, 3);
    await pg.screenshot({ path: SHOTS + 'ship-desktop-2d.png' });
    await pg.keyboard.press('KeyV');
    await pg.waitForFunction(() => Render3D.ready && App.preview3D(), null, { timeout: 30000 });
    await pg.evaluate(() => Render3D.orbitBy(0.5, -0.25));
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: SHOTS + 'ship-desktop-3d.png' });
    r = await pg.evaluate(() => ({ wl: !!Builder.waterline3d(), err: null }));
    ok('3D: the waterline sheet is asked for while building a ship', r.wl, JSON.stringify(r));
    await pg.keyboard.press('KeyV');
    await pg.evaluate(() => App.launch());
    await pg.waitForFunction(() => Flight.running && Flight.time > 0.3, null, { timeout: 60000 }).catch(() => {});
    r = await pg.evaluate(() => ({ running: Flight.running, kind: Flight.active && Flight.active.kind, hydro: Flight.active && Flight.active.hydro, name: Flight.active && Flight.active.name }));
    ok('she launches: a ship, afloat (hydro) in flight', r.running && r.kind === 'ship' && r.hydro, JSON.stringify(r));
  }
  await pg.close();
}
// a phone in 3D (the slice ship and its waterline sheet)
page = await open(390, 844, true, { build3d: true });
await page.evaluate(() => { Builder.loadTemplate('cyclon'); });
await page.waitForFunction(() => Render3D.ready && App.preview3D(), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: SHOTS + 'ship-phone-3d.png' });
await page.close();

ok('no page errors', errs.length === 0, errs.slice(0, 5).join('\n'));
await b.close(); srv.close();
ok.done();
