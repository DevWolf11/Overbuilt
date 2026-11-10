// Radar in the builder (the big update, spec-radar §3.3-§3.6 and §12.2's builder half), on a phone in portrait (390×844,
// touch) and a desktop (1280×720, mouse): an old jet that relied on the hidden radar warns, and Fit a radar puts the set
// its nose was built for inside it (the warning goes); a tap on another set swaps them; the Radar tab groups its parts
// (Inside a nose, Outside) and each says how far and where it looks; the nose goes see-through for 1.6 s after a fit and
// then the blueprint is idle; the nose's card has a chip that selects the set; a set dragged from the tray (a finger on
// the phone, the mouse on the desktop) goes into the nose under it; dragged on over the tail fin it is red and the drop
// does nothing, and into the fuselage it moves there; deleting its host takes the set along; in 3D, X-ray shows the set
// and a tap there picks it, a set over a wing is red, and one dragged onto the fuselage goes inside it.
//   node test/browser/radar.mjs        (screenshots: SHOTS=<dir>, default test/.cache/shots/)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = (process.env.SHOTS || path.join(ROOT, 'test', '.cache', 'shots')) + path.sep;
fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch();
const errs = [];
const ok = checks('radar: sets in the builder');
const frames = (page, n) => page.evaluate((n) => new Promise((ok) => { let i = 0; const f = () => (++i >= n ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// fingers (CDP: every touch event lists the points still down)
const fingers = (cdp) => {
  const pts = new Map(), send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts.values()] });
  return {
    down: async (id, x, y) => { pts.set(id, { x, y, id }); await send('touchStart'); },
    move: async (id, x, y) => { pts.set(id, { x, y, id }); await send('touchMove'); },
    up: async (id) => { pts.delete(id); await send('touchEnd'); },
  };
};
// the Falcon as it was before the big update: its rows without the radar set it carries now
const noSet = (page) => page.evaluate(() => {
  const t = TEMPLATES.falcon;
  Builder.loadDesign({ name: 'Falcon', kind: t.kind, parts: templateRows(t).filter((r) => !innerRadar(PARTS[r.type])) });
});
const state = (page) => page.evaluate(() => {
  const sets = Builder.parts.filter((p) => innerRadar(p.def)), s = sets[0], h = s && Builder.parts.find((q) => q.id === s.att);
  return {
    sets: sets.map((p) => p.type), host: h ? h.type : null, inside: !!(s && h && insideOf(s, h)), att: s ? s.att : null,
    warn: $('#s-warn').hidden ? '' : $('#s-warn').textContent, fix: !$('#s-fix').hidden, row: !$('#s-radar-row').hidden,
    radar: $('#s-radar').textContent, amber: $('#s-radar').className === 'warnv', loose: Builder.statsData.loose,
    toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent),
  };
});
// cyan pixels (the set's rim and X-ray outline, #5fd7ff) in the set's box on the 2D canvas
const cyan = (page) => page.evaluate(() => {
  const s = Builder.parts.find((p) => innerRadar(p.def)), R = partRect(s), c = App.canvas, k = c.width / c.clientWidth, r = c.getBoundingClientRect();
  const a = Builder.partScreen({ x: R.l, y: R.b }), z = Builder.partScreen({ x: R.r, y: R.t });
  const x0 = Math.floor((Math.min(a.x, z.x) - r.left) * k), y0 = Math.floor((Math.min(a.y, z.y) - r.top) * k), w = Math.ceil(Math.abs(z.x - a.x) * k) + 1, h = Math.ceil(Math.abs(z.y - a.y) * k) + 1;
  const d = App.ctx.getImageData(x0, y0, w, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 150 && d[i + 1] > 170 && d[i + 2] > 220) n++;
  return n;
});
const tray = (page, cat) => page.evaluate((cat) => { Builder.category = cat; Builder.buildPalette(); }, cat);
const item = (page, name) => page.evaluate((name) => { const e = [...document.querySelectorAll('#palette-items .part-item')].find((x) => x.querySelector('.part-name').textContent === name); if (!e) return null; e.scrollIntoView({ inline: 'center', block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, spec: e.querySelector('.part-spec').textContent }; }, name);
const at = (page, f) => page.evaluate((f) => { const p = Builder.parts.find(new Function('p', 'return ' + f)), s = Builder.partScreen(p); return { x: s.x, y: s.y }; }, f);

for (const [W, H, touch] of [[390, 844, true], [1280, 720, false]]) {
  const tag = `${W}x${H} `, ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  watch(page, errs, tag);
  await openGame(page, srv.url, { build3d: false });
  await page.evaluate(() => App.toBuild());
  await noSet(page);
  await frames(page, 3);
  // ---- the old jet warns; Fit a radar puts its nose's set back
  let s = await state(page);
  ok(tag + 'the Falcon without a set: "need a radar", the Fit a radar button, the Radar row "none" in amber', /need a radar to lock on/.test(s.warn) && s.fix && s.row && s.radar === 'none' && s.amber, s);
  await page.screenshot({ path: SHOTS + `radar-warn-${W}.png` });
  await page.click('#s-fix');
  await frames(page, 2);
  s = await state(page);
  ok(tag + 'Fit a radar: a pulse-Doppler set inside the Fighter Nose (att), the warning and the button gone', s.sets.join() === 'radarPD' && s.host === 'cockpitJet' && s.inside && !/radar/i.test(s.warn) && !s.fix && s.radar === 'PD 18 km ±60°' && !s.amber && s.loose === 0, s);
  ok(tag + '...and it says so', s.toasts.some((t) => t === 'Pulse-Doppler Radar fitted in the Fighter Nose'), s.toasts);
  await page.evaluate(() => { Builder.selected = null; Builder.renderInfo(); }); // (its cover wedge off: only the set's own cyan counts)
  await frames(page, 3);
  const peek = await page.evaluate(() => Builder.xrayShown());
  const c0 = await cyan(page);
  await page.screenshot({ path: SHOTS + `radar-fit-peek-${W}.png` });
  await page.waitForTimeout(1800);
  await frames(page, 3);
  const c1 = await cyan(page), after = await page.evaluate(() => Builder.xrayShown());
  ok(tag + 'the peek: the set shows through its nose for 1.6 s (cyan in its box), then the nose covers it again', peek && c0 > 4 && !after && c1 === 0, { peek, c0, after, c1 });
  // ---- the Radar tab: two groups in order, each part's reach; a tap on the AESA swaps it in
  await tray(page, 'radar');
  const groups = await page.evaluate(() => [...document.querySelectorAll('#palette-items .tray-group')].map((e) => e.textContent));
  ok(tag + 'the Radar tab: "Inside a nose" then "Outside"', groups.join('|') === 'Inside a nose|Outside', groups);
  const aesa = await item(page, 'AESA Radar');
  ok(tag + 'the tray line: "26 km ±70°"', aesa && aesa.spec === '26 km ±70°', aesa);
  await page.waitForTimeout(150);
  if (touch) await page.tap('#palette-items .part-item:has-text("AESA Radar")'); else await page.click('#palette-items .part-item:has-text("AESA Radar")');
  await frames(page, 2);
  s = await state(page);
  ok(tag + 'a tap on the AESA: one set, in the same nose, the swap said', s.sets.join() === 'radarAESA' && s.host === 'cockpitJet' && s.inside && s.toasts.includes('AESA Radar replaces the Pulse-Doppler Radar in the Fighter Nose') && s.radar === 'AESA 26 km ±70°', s);
  await page.screenshot({ path: SHOTS + `radar-swap-${W}.png` });
  // ---- the host chip
  await page.evaluate(() => { Builder.selected = Builder.parts.find((p) => p.type === 'cockpitJet'); Builder.renderInfo(); });
  await frames(page, 2);
  const chip = await page.evaluate(() => [...document.querySelectorAll('#pi-holds .pi-chip')].map((e) => e.textContent));
  await page.screenshot({ path: SHOTS + `radar-chip-${W}.png` });
  await page.click('#pi-holds .pi-chip');
  const picked = await page.evaluate(() => Builder.selected && Builder.selected.type);
  ok(tag + 'the nose\'s card: "Holds: AESA Radar ›", and a tap on it selects the set (its depth row hidden)', chip.join() === 'Holds: AESA Radar ›' && picked === 'radarAESA' && (await page.evaluate(() => $('#pi-depth').hidden)), { chip, picked });
  await frames(page, 2);
  await page.screenshot({ path: SHOTS + `radar-wedge-${W}.png` });
  // ---- a drag from the tray into the nose (a finger on the phone, the mouse on the desktop), after the set is taken out
  await page.evaluate(() => { Builder.removeParts(Builder.parts.filter((p) => innerRadar(p.def))); });
  await tray(page, 'radar');
  const pesa = await item(page, 'PESA Radar'), nose = await page.evaluate(() => { const n = Builder.parts.find((p) => p.type === 'cockpitJet'), s = Builder.partScreen({ x: n.x, y: n.y + 0.6 }); return s; });
  const lift = touch ? 44 : 0;
  if (touch) {
    const T = fingers(await ctx.newCDPSession(page));
    await T.down(1, pesa.x, pesa.y); await T.move(1, pesa.x, pesa.y - 20);
    for (let i = 1; i <= 8; i++) await T.move(1, pesa.x + ((nose.x - pesa.x) * i) / 8, pesa.y - 20 + ((nose.y + lift - pesa.y + 20) * i) / 8);
    await frames(page, 2);
    const g = await page.evaluate(() => Builder.drag && Builder.drag.ghost && { ok: Builder.drag.ghost.ok, host: Builder.drag.host && Builder.drag.host.type });
    await page.screenshot({ path: SHOTS + `radar-drag2d-${W}.png` });
    await T.up(1);
    ok(tag + 'dragging the PESA over the nose: it goes in (the nose is its host)', g && g.ok && g.host === 'cockpitJet', g);
  } else {
    await page.mouse.move(pesa.x, pesa.y); await page.mouse.down();
    await page.mouse.move(nose.x, nose.y, { steps: 10 });
    await frames(page, 2);
    const g = await page.evaluate(() => Builder.drag && Builder.drag.ghost && { ok: Builder.drag.ghost.ok, host: Builder.drag.host && Builder.drag.host.type });
    await page.screenshot({ path: SHOTS + `radar-drag2d-${W}.png` });
    await page.mouse.up();
    ok(tag + 'dragging the PESA over the nose: it goes in (the nose is its host)', g && g.ok && g.host === 'cockpitJet', g);
  }
  await frames(page, 2);
  s = await state(page);
  ok(tag + '...and dropped there, it is inside the nose', s.sets.join() === 'radarPESA' && s.host === 'cockpitJet' && s.inside && s.loose === 0, s);
  // ---- the set dragged on: over the tail fin it is red and the drop does nothing; into the fuselage it moves there
  const mv = await page.evaluate(() => {
    const set = Builder.parts.find((p) => innerRadar(p.def)), fin = Builder.parts.find((p) => p.type === 'vtailTwin'), F = partRect(fin), fus = Builder.parts.find((p) => p.type === 'fuselageS');
    const before = { x: set.x, y: set.y, att: set.att };
    Builder.setXray(true); // (the set drawn over its nose, so a press there takes it)
    const go = (x, y) => { const q = Builder.partScreen({ x, y }); Builder.dragTo(q.x, q.y); return Builder.drag.ghost; };
    const s0 = Builder.partScreen(set);
    Builder.grab(set, Builder.screenToWorld(s0.x, s0.y), 1);
    const g1 = go(F.l + 0.15, (F.b + F.t) / 2), red = { ok: g1.ok, host: g1.host && g1.host.type };
    Builder.dropDrag(9);
    const stay = { x: set.x, y: set.y, att: set.att };
    const s1 = Builder.partScreen(set);
    Builder.grab(set, Builder.screenToWorld(s1.x, s1.y), 1);
    const g2 = go(fus.x, fus.y), into = { ok: g2.ok, host: g2.host && g2.host.type };
    Builder.dropDrag(9);
    const h = Builder.parts.find((q) => q.id === set.att);
    return { before, red, stay, into, att: h && h.type, inside: !!h && insideOf(set, h), loose: Builder.statsData.loose };
  });
  ok(tag + 'the set over the tail fin: red, and dropped there it stays in the nose', !mv.red.ok && !mv.red.host && mv.stay.x === mv.before.x && mv.stay.y === mv.before.y && mv.stay.att === mv.before.att, mv);
  ok(tag + '...dragged into the fuselage, it moves there (inside it, joined)', mv.into.ok && mv.att === 'fuselageS' && mv.inside && mv.loose === 0, mv);
  await frames(page, 2);
  await page.screenshot({ path: SHOTS + `radar-xray-${W}.png` });
  // ---- deleting its host takes the set along
  const gone = await page.evaluate(() => { Builder.selected = Builder.parts.find((p) => p.type === 'fuselageS'); Builder.deleteSelected(); return Builder.parts.filter((p) => innerRadar(p.def)).length; });
  ok(tag + 'deleting the fuselage takes the set with it', gone === 0, gone);
  await page.evaluate(() => Builder.setXray(false));
  // ---- 3D: X-ray shows the set and a tap picks it; a set dragged onto the fuselage goes inside it
  await noSet(page);
  await page.evaluate(() => App.setPreview3D(true));
  await page.waitForFunction(() => Render3D.ready && App.preview3D(), null, { timeout: 60000 });
  await page.evaluate(() => { Builder.quickAdd('radarPD'); Builder.selected = null; Builder.renderInfo(); Builder.setXray(true); Render3D.orbitBy(0, 0); });
  await page.waitForTimeout(2500);
  const pk = await page.evaluate(() => { const s = Builder.parts.find((p) => innerRadar(p.def)), q = Render3D.designToScreen(s.x, s.y, partZc(s)), h = Render3D.pickPart(q.x, q.y); return h && h.part.type; });
  ok(tag + '3D X-ray: a tap on the set seen through its nose picks the set', pk === 'radarPD', pk);
  await page.screenshot({ path: SHOTS + `radar-xray3d-${W}.png` });
  const d3 = await page.evaluate(() => {
    const F = Builder.parts.find((p) => p.type === 'fuselageS'), q = Render3D.designToScreen(F.x - F.def.w / 2, F.y, 0);
    Builder.drag = { type: 'radarPESA', fromPalette: true, offset: { x: 0, y: 0 }, rot: 0 };
    Render3D.editView(true);
    const Wg = Builder.parts.find((p) => p.type === 'wingDelta'), sec = Parts3D.wingAt(Wg.def, 3), qw = Render3D.designToScreen(Wg.x + sec.x, Wg.y + (sec.le + sec.te) / 2, 3);
    Builder.dragTo(qw.x, qw.y + (isTouch ? 44 : 0));
    const gw = Builder.drag.ghost, wing = { ok: gw && gw.ok, host: gw && gw.host && gw.host.type, hit: Builder.drag.ghost && Render3D.surfaceHit(qw.x, qw.y, new Set()) };
    wing.hit = wing.hit && wing.hit.part.type;
    Builder.dragTo(q.x, q.y + (isTouch ? 44 : 0));
    const g = Builder.drag.ghost, out = { wing, ok: g && g.ok, host: g && g.host && g.host.type };
    Builder.dropDrag(q.y);
    const s = Builder.parts.find((p) => p.type === 'radarPESA'), h = s && Builder.parts.find((p) => p.id === s.att);
    return { ...out, att: h && h.type, inside: !!h && insideOf(s, h) };
  });
  ok(tag + '3D: a set over a wing is red', d3.wing.hit === 'wingDelta' && !d3.wing.ok && !d3.wing.host, d3.wing);
  ok(tag + '3D: a set dragged onto the fuselage goes inside it', d3.ok && d3.host === 'fuselageS' && d3.att === 'fuselageS' && d3.inside, d3);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOTS + `radar-drag3d-${W}.png` });
  await page.evaluate(() => { Builder.setXray(false); App.setPreview3D(false); });
  await ctx.close();
}

ok('no page errors', !errs.length, errs.join('\n'));
await b.close(); srv.close();
ok.done();
