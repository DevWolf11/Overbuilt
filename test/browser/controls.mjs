// The controls update (controls.js), in the real page:
//  - Touch Aim on a phone: only the stick moves the circle (a rate: right turns it right, held it keeps going, let go it
//    stays; the plane isn't flown by hand); a drag on the view looks round without moving the circle and glides back when
//    the finger lifts; a double tap puts the circle on the nose (and doesn't use a part); a slide on FIRE fires and no
//    longer moves the circle; the stick works while FIRE is held (two fingers).
//  - The floating stick: the ring comes to the thumb anywhere in its zone and glides home after; inside its dead zone
//    nothing, past it an expo curve (fine near the middle, full at the edge); in Off the stick flies the plane directly;
//    held still, nothing in its DOM is written.
//  - The HUD's size (--ui-scale) on 360×640, 375×667, 390×844, 430×932, 768×1024, 844×390, 1280×720 and 1920×1080: for a
//    plane in Aim and in Off, a rocket on the pad and a tank, every control and panel on the screen and clear of the others
//    (and of Aim's circle); the scale in its bands; the UI size setting scales it, within a phone's limit.
//  - The layout editor (from Settings and the pause menu): a control dragged moves, sized and faded by the sliders, snaps to
//    an edge, is saved per orientation and comes back after a reload; Reset to default; a forged saved layout is cleaned
//    (unknown keys, nonsense, a place off the screen ignored).
//  - A desktop (no touch controls): no stick or touch buttons, the key hints for the craft from the current bindings,
//    collapsible; the Touch controls switch turns them round both ways.
//  - UI size held to what fits (also the editor's UI size slider): smaller as asked; at 150% a phone's controls no longer
//    run into each other or the flight data (portrait and on its side, a plane and a tank); the stick and the editor's drag
//    follow the finger at any size.
//  - Keys: a key rebound in the Keys screen works in flight and shows in the hints, the help and the manual; Esc cancels,
//    Backspace clears; a clash asks (swap, clear it there); reset one and all; kept after a reload; a forged rss.keys
//    cleaned; the builder's keys too. No console errors (App.frame swallows them).
// SHOTS=<dir> saves screenshots there (ctl-*.png); ONLY=1,3 runs those sections alone.
//   node test/browser/controls.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `ctl-${name}.png`) }); };
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('controls: the floating stick, touch Aim, the HUD\'s size, the layout editor, a desktop\'s HUD and the keys');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null, part = (n) => !ONLY || ONLY.includes(n);

const instrument = () => {
  window.__errs = [];
  addEventListener('error', (e) => window.__errs.push('onerror ' + e.message));
  for (const [o, k, n] of [[Flight, 'update', 'Flight.update'], [Flight, 'drawFlyAim', 'Flight.drawFlyAim'], [Render3D, 'renderFlight', 'Render3D.renderFlight'], [GHUD, 'draw', 'GHUD.draw']]) {
    const f = o[k]; o[k] = function (...a) { try { return f.apply(this, a); } catch (e) { window.__errs.push(`${n}: ${e && e.stack}`); throw e; } };
  }
};
async function open(vp, settings = {}, tag = '', keep) {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: vp[2], isMobile: vp[2] }), page = await ctx.newPage();
  watch(page, errs, tag);
  await openGame(page, srv.url, settings);
  if (keep) { await page.evaluate((k) => { for (const [a, v] of Object.entries(k)) localStorage.setItem(a, v); }, keep); await page.reload(); await page.waitForTimeout(400); }
  await page.evaluate(instrument);
  return { ctx, page };
}
// a template in flight: a plane in the air (Aim unless sas says otherwise), a rocket on its pad, a tank on Highland Ridge's pad
async function fly(page, key, sas) {
  await page.waitForFunction(() => Terrain.earthMap.state !== 'loading', null, { timeout: 120000 });
  await page.evaluate(async ([key, sas]) => {
    await Render3D.load();
    App.toBuild(); Builder.loadTemplate(key); store.set('rss.flight', null); App.showScene('flight');
    const k = Builder.kind;
    if (k === 'plane') Flight.start(Builder.serialize(), { place: { e: 0, z: 0, yaw: 0, air: { alt: 1500, speed: 200 } } });
    else if (k === 'tank') Flight.start(Builder.serialize(), { place: GroundMode.soloPlace('tank') });
    else Flight.start(Builder.serialize());
    if (sas) Flight.setSas(sas);
  }, [key, sas || null]);
  await page.waitForFunction(() => Flight.running && Flight.active && Flight.time > 0.6, null, { timeout: 120000 });
}
const until = (page, t) => page.waitForFunction((t) => Flight.time > t, t, { timeout: 180000 });
const frames = (page, n = 2) => page.evaluate((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const pageErrors = async (page, tag) => { const e = await page.evaluate(() => window.__errs.splice(0)); for (const x of e) errs.push(tag + x); };
// fingers (CDP: every touch event lists the points still down)
function fingers(cdp) {
  const pts = new Map(), send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts.values()] });
  return {
    down: async (id, x, y) => { pts.set(id, { x, y, id }); await send('touchStart'); },
    move: async (id, x, y) => { pts.set(id, { x, y, id }); await send('touchMove'); },
    up: async (id) => { pts.delete(id); await send('touchEnd'); },
  };
}
const state = (page) => page.evaluate(() => {
  const v = Flight.active, P = v.pilot, n = v.axis(P.F.x, P.F.y, P.F.z), D = Flight.flyDir, F = surfaceFrame(v.x, v.y, v.z), C = Flight.flyCamDir;
  const ang = (a, b) => (a && b ? Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 57.2958 : null);
  const j = document.querySelector('#joy').getBoundingClientRect();
  return { t: Flight.time, sas: v.sas, flyAim: Flight.flyAim, off: ang(n, D), right: D ? D.x * F.north.x + D.y * F.north.y + D.z * F.north.z : null, up: D ? D.x * F.up.x + D.y * F.up.y + D.z * F.up.z : null,
    D: D && { x: D.x, y: D.y, z: D.z }, look: !!Flight.flyLook, cam: ang(C, D), ctl: { v: v.ctl.v, h: v.ctl.h }, stick: { h: Flight.stick.h, v: Flight.stick.v }, aim: { x: Flight.stickAim.x, y: Flight.stickAim.y },
    firing: Flight.firing, joy: { x: (j.left + j.right) / 2, y: (j.top + j.bottom) / 2, w: j.width }, rest: Controls._S.rest };
});
const angD = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z))) * 57.2958;

// ---- where everything is: every control and panel of the HUD in sight, and Aim's circle
const layout = () => {
  const rect = (q) => { const e = typeof q === 'string' ? document.querySelector(q) : q; if (!e || e.hidden) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width && r.height && cs.display !== 'none' && cs.visibility !== 'hidden' ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const ground = document.body.classList.contains('ground'), P = GHUD._S.P || {};
  const items = { stick: rect('#joy'), rollL: rect('#rot-left'), rollR: rect('#rot-right'), brake: rect('#btn-brake'), flaps: rect('#btn-flaps'), gear: rect('#btn-gear'),
    fire: rect('#btn-fire'), cm: rect('#btn-cm'), chip: rect('#btn-weapon'), catapult: rect('#btn-catapult'), throttle: rect('#flight-ui .throttle-box'),
    stage: ground ? rect('#btn-stage') : rect('#flight-ui .stage-box'), telemetry: rect('#flight-ui .telemetry'), topRight: rect('#flight-ui .flight-top-right'), warp: rect('#warp'), keys: rect('#key-hints'),
    sight: rect('#btn-sight'), mg: rect('#btn-mg'), lock: rect('#btn-lock'), range: rect('#btn-range'), shells: rect('#ammo-stack'), map: rect('#gmap'), gai: rect('#gai-bar'),
    diagram: ground && P.diag ? { l: P.diag.x, t: P.diag.y, r: P.diag.x + P.diag.w, b: P.diag.y + P.diag.h } : null };
  if (!ground) document.querySelectorAll('#sas-bar [data-sas]').forEach((x) => { const r = rect(x); if (r) items['sas-' + x.dataset.sas] = r; });
  let circle = null;
  if (Flight.flyAim && Flight.flyDir) {
    const v = Flight.active, bp = bodyPos(v.body, Flight.time), D = Flight.flyDir, L = 2000, c = Render3D.project(bp.x + v.x + D.x * L, bp.y + v.y + D.y * L, v.z + D.z * L);
    if (!c.behind) circle = { l: c.x - 18, t: c.y - 18, r: c.x + 18, b: c.y + 18 };
  }
  return { W: innerWidth, H: innerHeight, items, circle, z: Controls.z, pc: document.body.classList.contains('pc'), ground };
};
const meets = (a, c) => !!a && !!c && a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
function judge(tag, L, need = []) {
  const clash = [], off = [], E = Object.entries(L.items).filter(([, a]) => a), missing = need.filter((k) => !L.items[k]);
  for (let i = 0; i < E.length; i++) {
    const [k, a] = E[i];
    if (a.l < -0.5 || a.t < -0.5 || a.r > L.W + 0.5 || a.b > L.H + 0.5) off.push(k);
    for (let j = i + 1; j < E.length; j++) if (meets(a, E[j][1])) clash.push(`${k}/${E[j][0]}`);
    if (meets(a, L.circle)) clash.push(`${k}/circle`);
  }
  ok(`${tag}: every control and panel on the screen and clear of the others${L.circle ? ' and of the circle' : ''}`, !clash.length && !off.length && !missing.length,
    JSON.stringify({ z: L.z, clash, off, missing, items: Object.keys(L.items).filter((k) => L.items[k]).length }));
}

// ================================================================ 1. touch Aim on a phone
if (part(1)) {
  const tag = 'touch Aim ', { ctx, page } = await open([390, 844, true], {}, tag), cdp = await ctx.newCDPSession(page), T = fingers(cdp);
  await fly(page, 'fs16');
  let s = await state(page);
  ok('a new plane flight on a phone starts in Aim, the stick at its place, its zone round it', s.sas === 'aim' && s.flyAim && s.rest && Math.abs(s.joy.x - s.rest.x) < 2,
    { sas: s.sas, joy: s.joy, rest: s.rest });
  const zone = await page.evaluate(() => { const r = document.querySelector('#joy-zone').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, at: document.elementFromPoint(60, 540).id }; });
  ok('the stick\'s zone takes the bottom-left corner (a thumb\'s reach round the stick), under the other controls', zone.l === 0 && zone.r > 150 && zone.r < 230 && zone.t < 560 && zone.b >= 843 && zone.at === 'joy-zone', zone);
  // the stick: the ring comes to the thumb; held right, the circle turns right at the stick's rate, the plane not flown by hand
  const r0 = s.right, D0 = s.D;
  await T.down(1, 60, 540); await T.move(1, 80, 540); await T.move(1, 100, 540); // (40 px: past the edge, full)
  let h = await state(page);
  ok('the ring comes to the thumb (where it landed), the knob out to its edge', Math.hypot(h.joy.x - 60, h.joy.y - 540) < 3 && h.aim.x > 0.99, { joy: h.joy, aim: h.aim });
  const t0 = h.t;
  await until(page, t0 + 0.5);
  h = await state(page);
  const rate = angD(h.D, D0) / (h.t - t0 + 0.0001);
  ok('in Aim the stick moves the circle (right turns it right, at most about 100°/s at full throw), and the plane isn\'t flown by hand',
    h.right > r0 + 0.2 && rate > 40 && rate < 125 && h.ctl.h === 0 && h.ctl.v === 0 && h.flyAim, { right: [r0, h.right], rate, ctl: h.ctl });
  await T.up(1);
  await frames(page, 3);
  const a1 = await state(page);
  await until(page, a1.t + 0.5);
  const a2 = await state(page);
  ok('let go, the circle stays where it was left (the plane flies on to it), the stick back to nothing', angD(a1.D, a2.D) < 1.5 && a2.aim.x === 0 && a2.aim.y === 0, { moved: angD(a1.D, a2.D), aim: a2.aim });
  await page.waitForFunction(() => { const r = document.querySelector('#joy').getBoundingClientRect(), R = Controls._S.rest; return R && Math.hypot((r.left + r.right) / 2 - R.x, (r.top + r.bottom) / 2 - R.y) < 2; }, null, { timeout: 15000 }).catch(() => {});
  const back = await state(page);
  ok('and the ring glides back to its place', Math.hypot(back.joy.x - back.rest.x, back.joy.y - back.rest.y) < 2, { joy: back.joy, rest: back.rest });
  // a drag on the view looks round; the circle stays; lifted, the view glides back onto the circle
  const l0 = await state(page);
  await T.down(2, 260, 300);
  for (let i = 1; i <= 8; i++) await T.move(2, 260 - i * 12, 300 + i * 2);
  const l1 = await state(page);
  ok('a drag on the view looks round (the camera turned away from the circle) and leaves the circle where it is', l1.look && l1.cam > 20 && angD(l0.D, l1.D) < 1.5, { look: l1.look, cam: l1.cam, moved: angD(l0.D, l1.D) });
  await T.up(2);
  await page.waitForFunction(() => { const a = Flight.flyCamDir, b = Flight.flyDir; return !Flight.flyLook && a.x * b.x + a.y * b.y + a.z * b.z > Math.cos(0.3 / 57.3); }, null, { timeout: 20000 }).catch(() => {}); // (the camera then eases the last of the way)
  const l2 = await state(page);
  ok('lifted, the view glides back onto the circle', !l2.look && l2.cam < 0.5, { look: l2.look, cam: l2.cam });
  // a double tap: the circle on the nose, no part used (synthetic events in one go: headless frames are slow)
  await page.evaluate(() => { Render3D.skipDraw = true; window.__used = 0; const u = Flight.usePart, ta = Flight.tapAt; Flight.usePart = function (...a) { window.__used++; return u.apply(this, a); }; window.__taps = 0; Flight.tapAt = function (...a) { window.__taps++; return ta.apply(this, a); }; Flight.flyAimBy(0.6, -0.3, 1, true); });
  await frames(page, 3); // (planeTick turns the circle into flyDir)
  const d0 = await state(page);
  const dbl = await page.evaluate(() => {
    const c = Flight.canvas, at = (t, x) => c.dispatchEvent(new PointerEvent(t, { pointerType: 'touch', pointerId: 31, isPrimary: true, clientX: x, clientY: 300, bubbles: true }));
    at('pointerdown', 250); at('pointerup', 250); at('pointerdown', 254); at('pointerup', 254);
    return new Promise((done) => setTimeout(() => done(window.__taps), 450));
  });
  const d1 = await state(page);
  ok('a double tap on the view puts the circle on the nose (it stays put after, as the nose swings on), and taps no part', d0.off > 10 && d1.off < 6 && dbl === 0, { before: d0.off, after: d1.off, taps: dbl });
  const one = await page.evaluate(() => {
    const c = Flight.canvas, at = (t) => c.dispatchEvent(new PointerEvent(t, { pointerType: 'touch', pointerId: 32, isPrimary: true, clientX: 250, clientY: 300, bubbles: true }));
    window.__taps = 0; at('pointerdown'); at('pointerup');
    const now = window.__taps;
    return new Promise((done) => setTimeout(() => done([now, window.__taps]), 450));
  });
  ok('a single tap still taps (a part), once it is sure no second tap comes', one[0] === 0 && one[1] === 1, one);
  await page.evaluate(() => { Render3D.skipDraw = false; });
  // a slide on FIRE fires and no longer moves the circle
  const f0 = await state(page);
  const fc = await page.evaluate(() => { const r = document.querySelector('#btn-fire').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await T.down(3, fc[0], fc[1]);
  for (let i = 1; i <= 6; i++) await T.move(3, fc[0] - i * 8, fc[1] - i * 3);
  await frames(page);
  const f1 = await state(page);
  await T.up(3); await frames(page);
  ok('a slide on FIRE fires and no longer moves the circle', f1.firing && angD(f0.D, f1.D) < 1.5, { firing: f1.firing, moved: angD(f0.D, f1.D) });
  // two fingers: FIRE held and the stick moving the circle at once
  await T.down(3, fc[0], fc[1]);
  await T.down(1, 60, 540); await T.move(1, 60, 500); // (up: the circle lifts)
  const m0 = await state(page);
  await until(page, m0.t + 0.4);
  const m1 = await state(page);
  ok('two thumbs: FIRE held and the stick moving the circle at the same time', m1.firing && m1.aim.y > 0.9 && m1.up > m0.up + 0.05, { firing: m1.firing, aim: m1.aim, up: [m0.up, m1.up] });
  // held still: none of the stick's DOM written (only a finger's move writes it)
  const muts = await page.evaluate(() => new Promise((done) => {
    const recs = [], o = new MutationObserver((l) => { recs.push(...l.map((r) => `${r.target.id || r.target.className} ${r.attributeName}`)); });
    o.observe(document.querySelector('#joy'), { attributes: true, subtree: true }); o.observe(document.querySelector('#joy-zone'), { attributes: true });
    let i = 0; const f = () => { if (++i >= 20) { o.disconnect(); done(recs); } else requestAnimationFrame(f); }; requestAnimationFrame(f);
  }));
  await T.up(1); await T.up(3);
  ok('the stick held still: nothing of its DOM written over 20 frames', muts.length === 0, muts.slice(0, 5));
  await shot(page, 'aim-390x844');
  // the dead zone and the curve; in Off the stick flies the plane directly
  const curve = [];
  for (const dx of [3, 10, 18.7, 28, 40]) {
    await T.down(1, 60, 540); await T.move(1, 60 + dx, 540);
    const c = await state(page);
    curve.push({ dx, aim: +c.aim.x.toFixed(3), T: +(c.joy.w * 0.36).toFixed(1) });
    await T.up(1);
  }
  const lin = (d, T) => Math.max(0, (Math.min(1, d / T) - 0.09) / 0.91);
  ok('the stick: nothing inside its dead zone (9%), then an expo curve under the straight line, full at the edge',
    curve[0].aim === 0 && curve.slice(1, 4).every((c) => c.aim > 0 && c.aim < lin(c.dx, c.T) - 0.02) && curve[4].aim > 0.99 && curve[1].aim < curve[2].aim && curve[2].aim < curve[3].aim, curve);
  await page.evaluate(() => Flight.setSas('off'));
  await T.down(1, 60, 540); await T.move(1, 80, 540);
  const o1 = await state(page);
  await T.up(1);
  ok('in Off the stick flies the plane directly (the milder curve), and there is no circle', o1.sas === 'manual' && !o1.flyAim && o1.ctl.h > 0.3 && o1.stick.h > 0.3 && o1.stick.h < 0.75, { sas: o1.sas, ctl: o1.ctl, stick: o1.stick });
  await shot(page, 'off-390x844');
  await pageErrors(page, tag);
  await ctx.close();
}

// ================================================================ 2. the HUD's size and layouts on eight screens
const SIZES = [[360, 640, true], [375, 667, true], [390, 844, true], [430, 932, true], [768, 1024, true], [844, 390, true], [1280, 720, false], [1920, 1080, false]];
const zs = {};
for (const vp of part(2) ? SIZES : []) {
  const tag = `${vp[0]}×${vp[1]}${vp[2] ? '' : ' desktop'}`, { ctx, page } = await open(vp, {}, tag + ' ');
  for (const [what, key, sas] of [['a plane in Aim', 'fs16'], ['a plane in Off', 'fs16', 'off'], ['a rocket on the pad', 'orbiter'], ['a tank', 'tk34']]) {
    await fly(page, key, sas);
    await page.waitForTimeout(1300); // (the ground HUD's places: looked up once a second)
    await frames(page, 2);
    const L = await page.evaluate(layout);
    zs[tag] = L.z;
    const need = L.pc ? ['telemetry', 'keys'] : what === 'a tank' ? ['stick', 'fire', 'sight', 'map', 'shells'] : what === 'a rocket on the pad' ? ['stick', 'throttle', 'stage', 'sas-hold'] : ['stick', 'fire', 'throttle', 'stage', 'sas-aim'];
    judge(`${tag}, ${what}`, L, need);
    const name = `${what === 'a plane in Aim' ? 'aim' : what === 'a plane in Off' ? 'off' : what === 'a tank' ? 'tank' : 'rocket'}-${vp[0]}x${vp[1]}`;
    if (vp[0] === 390 || vp[0] === 768 || vp[0] === 1280 || vp[0] === 1920 || vp[0] === 360 || vp[0] === 844 || vp[0] === 430 || vp[0] === 375) await shot(page, name);
  }
  await pageErrors(page, tag + ' ');
  await ctx.close();
}
if (part(2)) ok('the HUD\'s scale in its bands: a phone 0.92-1.1 by its width, a tablet 1.2, a desktop 1 up to 1.2 at 1080p', zs['360×640'] === 0.92 && zs['375×667'] === 0.96 && zs['390×844'] === 1 && zs['430×932'] === 1.1 && zs['768×1024'] === 1.2 && zs['844×390'] === 1 && zs['1280×720 desktop'] === 1 && zs['1920×1080 desktop'] === 1.2, zs);
// the UI size setting: 125% on a 1080p desktop (1.2 × 1.25), 150% held to a 720p desktop's room; on a phone only as far
// as its room allows
if (part(2)) {
  const { ctx, page } = await open([1920, 1080, false], { uiSize: 1.25 }, 'ui size ');
  await fly(page, 'fs16');
  await page.waitForTimeout(600);
  let L = await page.evaluate(layout);
  const w = await page.evaluate(() => document.querySelector('#flight-ui .telemetry').getBoundingClientRect().width);
  judge('1920×1080 desktop at UI size 125%', L, ['telemetry', 'keys']);
  ok('UI size 125% on a 1080p desktop: 1.5 (its own 1.2 × 1.25), the flight data 321 px wide (214 at 1)', L.z === 1.5 && Math.abs(w - 321) < 2, { z: L.z, w });
  await shot(page, 'uisize125-1920x1080');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => { Settings.set('uiSize', 1.5); Controls.resize(); });
  await page.waitForTimeout(1200);
  L = await page.evaluate(layout);
  judge('1280×720 desktop at UI size 150% (held to 1.13: the desktop layout\'s 640 px of height)', L, ['telemetry', 'keys']);
  const ph = await page.evaluate(() => { const s = (W, H) => Controls.scaleFor(W, H, true); Settings.set('uiSize', 1.5); const a = [s(390, 844), s(844, 390), s(768, 1024)]; Settings.set('uiSize', 0.75); const c = s(390, 844); Settings.set('uiSize', 1); return [...a, c]; });
  ph.push(L.z);
  ok('UI size 150% is held to each layout\'s room (a phone in portrait 1.18, on its side 1.08, a tablet 1.2, a 720p desktop 1.13), and 75% gives 0.75', ph.join() === '1.18,1.08,1.2,0.75,1.13', ph);
  await pageErrors(page, 'ui size ');
  await ctx.close();
}

// ================================================================ 3. the layout editor
if (part(3)) {
  const tag = 'editor ', { ctx, page } = await open([390, 844, true], {}, tag), cdp = await ctx.newCDPSession(page), T = fingers(cdp);
  // from Settings: the flight HUD over the home screen
  await page.evaluate(() => { App.showSettings(); document.querySelector('#set-layout').click(); });
  await frames(page, 2);
  const e0 = await page.evaluate(() => ({ on: Controls.editing, bar: !!document.querySelector('#ctl-edit-bar'), ui: !document.querySelector('#flight-ui').hidden, home: document.querySelector('#home').hidden, fire: (() => { const r = document.querySelector('#btn-fire').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })() }));
  ok('Settings → Edit controls: the editor over the home screen, its bar up, every control shown', e0.on && e0.bar && e0.ui && e0.home && e0.fire.w > 40, e0);
  await shot(page, 'editor-390x844');
  // drag FIRE 120 px left and 160 px up
  await T.down(1, e0.fire.x, e0.fire.y);
  for (let i = 1; i <= 8; i++) await T.move(1, e0.fire.x - i * 15, e0.fire.y - i * 20);
  await T.up(1); await frames(page, 2);
  const e1 = await page.evaluate(() => { const r = document.querySelector('#btn-fire').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, sel: document.querySelector('#btn-fire').classList.contains('ctl-sel'), fireTouched: Flight.touchFire, slider: !!document.querySelector('#ctl-edit-bar input[type=range]') }; });
  ok('a control dragged in the editor moves with the finger (and is chosen: its sliders show); FIRE didn\'t fire', Math.abs(e1.x - (e0.fire.x - 120)) < 2 && Math.abs(e1.y - (e0.fire.y - 160)) < 2 && e1.sel && e1.slider && !e1.fireTouched, { from: e0.fire, to: e1 });
  // its size and opacity
  await page.evaluate(() => { const [s, o] = document.querySelectorAll('#ctl-edit-bar input[type=range]'); s.value = '150'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); o.value = '50'; o.dispatchEvent(new Event('input', { bubbles: true })); o.dispatchEvent(new Event('change', { bubbles: true })); });
  await frames(page, 2);
  const e2 = await page.evaluate(() => { const b = document.querySelector('#btn-fire'), r = b.getBoundingClientRect(); return { w: r.width, op: +getComputedStyle(b).opacity, x: r.left + r.width / 2 }; });
  ok('the size slider at 150% makes it half as big again, the opacity slider fades it to 50%', Math.abs(e2.w - e0.fire.w * 1.5) < 1.5 && Math.abs(e2.op - 0.5) < 0.01, { before: e0.fire.w, ...e2 });
  await shot(page, 'editor-chosen-390x844');
  // the autopilot bar dragged near the left edge snaps onto the margin
  const sb = await page.evaluate(() => { const r = document.querySelector('#sas-bar').getBoundingClientRect(); return { l: r.left, t: r.top, x: r.left + 20, y: r.top + 10 }; });
  await T.down(2, sb.x, sb.y); for (let i = 1; i <= 4; i++) await T.move(2, sb.x - i * 2, sb.y - i * 25); await T.up(2); await frames(page, 2);
  const sn = await page.evaluate(() => document.querySelector('#sas-bar').getBoundingClientRect().left);
  ok('dragged to within 20 px of the edge, it snaps onto the 12 px margin', Math.abs(sn - 12) < 1, { before: sb.l, after: sn });
  await page.evaluate(() => document.querySelector('#ctl-edit-bar .btn.primary').click()); // Done
  await frames(page, 2);
  const saved = await page.evaluate(() => ({ L: JSON.parse(localStorage.getItem('rss.layout')), on: Controls.editing, modal: UI.modalOpen, title: document.querySelector('#modal-card .modal-title') && document.querySelector('#modal-card .modal-title').textContent, ui: document.querySelector('#flight-ui').hidden, home: document.querySelector('#home').hidden }));
  const fe = saved.L && saved.L.portrait && saved.L.portrait.air.fire;
  ok('Done: saved for portrait (FIRE moved, 150%, 50%), the editor gone and Settings back, the home screen as it was', !saved.on && fe && Math.abs(fe.x + 120) < 2 && Math.abs(fe.y + 160) < 2 && fe.s === 1.5 && fe.o === 0.5 && saved.modal && saved.title === 'Options' && saved.ui && !saved.home
    && Object.keys(saved.L.landscape.air).length === 0, { fire: fe, rest: saved });
  await page.evaluate(() => UI.closeModal());
  // after a reload, in flight: FIRE 120 px left and 160 px up of its own place (the weapon chip's real width sets that
  // place), as big and as faded
  await page.reload(); await page.waitForTimeout(400); await page.evaluate(instrument);
  await fly(page, 'fs16');
  await frames(page, 2);
  const e3 = await page.evaluate(() => {
    const b = document.querySelector('#btn-fire'), r = b.getBoundingClientRect(), op = +getComputedStyle(b).opacity, t = b.style.translate, sc = b.style.scale;
    b.style.translate = ''; b.style.scale = ''; const r0 = b.getBoundingClientRect(); b.style.translate = t; b.style.scale = sc;
    return { dx: (r.left + r.right - r0.left - r0.right) / 2, dy: (r.top + r.bottom - r0.top - r0.bottom) / 2, w: r.width, w0: r0.width, op };
  });
  ok('after a reload, in flight: FIRE 120 px left and 160 px up of its own place, as big and as faded', Math.abs(e3.dx + 120) < 1.5 && Math.abs(e3.dy + 160) < 1.5 && Math.abs(e3.w - e3.w0 * 1.5) < 1.5 && Math.abs(e3.op - 0.5) < 0.01, e3);
  await shot(page, 'custom-390x844');
  // the pause menu on touch: Edit controls, over the paused flight, then back to the menu; Reset to default
  await page.evaluate(() => Flight.openMenu());
  const pm = await page.evaluate(() => [...document.querySelectorAll('#modal-card .modal-actions button')].map((x) => x.textContent));
  await page.evaluate(() => [...document.querySelectorAll('#modal-card .modal-actions button')].find((x) => x.textContent === 'Edit controls').click());
  await frames(page, 2);
  const pe = await page.evaluate(() => ({ on: Controls.editing, paused: Flight.paused, modal: UI.modalOpen }));
  await page.evaluate(() => { const b = document.querySelector('#ctl-edit-bar .btn.danger'); b.click(); b.click(); }); // (two taps: all of them)
  await frames(page, 2);
  const e4 = await page.evaluate(() => { const r = document.querySelector('#btn-fire').getBoundingClientRect(); return { w: r.width, L: JSON.parse(localStorage.getItem('rss.layout')).portrait.air }; });
  await page.evaluate(() => document.querySelector('#ctl-edit-bar .btn.primary').click());
  await frames(page, 2);
  const pe2 = await page.evaluate(() => ({ on: Controls.editing, paused: Flight.paused, title: document.querySelector('#modal-card .modal-title') && document.querySelector('#modal-card .modal-title').textContent }));
  ok('the pause menu on a phone offers Edit controls: over the paused flight; Reset to default puts every control back; Done goes back to the menu',
    pm.includes('Edit controls') && pe.on && pe.paused && !pe.modal && Math.abs(e4.w - e0.fire.w) < 1 && Object.keys(e4.L).length === 0 && !pe2.on && pe2.paused && pe2.title === 'Paused', { pm, pe, e4, pe2 });
  await page.evaluate(() => UI.closeModal());
  await pageErrors(page, tag);
  await ctx.close();
}
// a forged saved layout: unknown controls, nonsense and a place off the screen are ignored; sizes and opacity held in range
if (part(3)) {
  const forged = JSON.stringify({ portrait: { air: { fire: { x: 99999, y: 0 }, joy: { x: 'a', y: 1 }, evil: { x: 1, y: 1 }, sas: { x: 2500, y: 0, s: 9, o: -1 }, cm: { x: -10, y: -10, s: 0.1, o: 7 } }, ground: 'nope' }, landscape: [] });
  const { ctx, page } = await open([390, 844, true], {}, 'forged layout ', { 'rss.layout': forged });
  await fly(page, 'fs16');
  await frames(page, 2);
  const f = await page.evaluate(() => {
    const L = Controls.cleanLayout(JSON.parse(localStorage.getItem('rss.layout'))), r = (q) => { const x = document.querySelector(q).getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom }; };
    return { L, sas: r('#sas-bar'), sasT: document.querySelector('#sas-bar').style.translate, fire: document.querySelector('#btn-fire').style.translate, W: innerWidth };
  });
  ok('a forged saved layout: unknown controls and nonsense dropped, sizes and opacity held to 50-200% and 30-100%, a place off the screen ignored (the autopilot at its own)',
    !f.L.portrait.air.fire && !f.L.portrait.air.joy && !f.L.portrait.air.evil && f.L.portrait.air.sas && f.L.portrait.air.sas.s === 2 && f.L.portrait.air.sas.o === 0.3 && f.L.portrait.air.cm.s === 0.5 && f.L.portrait.air.cm.o === 1
      && f.sasT === '' && f.sas.l >= 0 && f.sas.r <= f.W && f.fire === '', f);
  await pageErrors(page, 'forged layout ');
  await ctx.close();
}

// ================================================================ 4. a desktop: no touch controls, the key hints; the switch
const hintRows = () => [...document.querySelectorAll('#key-hints-list > div')].map((x) => [...x.querySelectorAll('kbd')].map((k) => k.textContent).join(' ') + ' ' + x.lastElementChild.textContent);
if (part(4)) {
  const tag = 'desktop ', { ctx, page } = await open([1280, 720, false], {}, tag);
  await fly(page, 'fs16');
  await frames(page, 2);
  const d = await page.evaluate(() => {
    const shown = (q) => { const e = document.querySelector(q); return !!e && e.getBoundingClientRect().width > 0; };
    const hints = [...document.querySelectorAll('#key-hints-list > div')].map((x) => [...x.querySelectorAll('kbd')].map((k) => k.textContent).join(' ') + ' ' + x.lastElementChild.textContent);
    return { pc: document.body.classList.contains('pc'), stick: shown('#joy'), zone: shown('#joy-zone'), fire: shown('#btn-fire'), cm: shown('#btn-cm'), roll: shown('#rot-left'), brake: shown('#btn-brake'),
      sas: shown('#sas-bar'), throttle: shown('#flight-ui .throttle-box'), stage: shown('#flight-ui .stage-box'), chip: shown('#btn-weapon'), keys: shown('#key-hints'), hints };
  });
  const has = (re) => d.hints.some((t) => re.test(t));
  ok('a desktop: no stick, zone, FIRE, CM, roll or Brake buttons; the autopilot, throttle, stage and weapon chip stay; the key hints show',
    d.pc && !d.stick && !d.zone && !d.fire && !d.cm && !d.roll && !d.brake && d.sas && d.throttle && d.stage && d.chip && d.keys, d);
  ok('the key hints for a plane in Aim, from the bindings: the mouse, keys by hand, look, throttle, stage, autopilot 1–5, fire on V, the map and the menu',
    has(/^Mouse Circle/) && has(/^W S A D By hand/) && has(/^C Look/) && has(/^Shift Ctrl Throttle/) && has(/^Space Stage/) && has(/^1 5 Autopilot/) && has(/^LMB V Fire/) && has(/^M Map/) && has(/^Esc Menu/), d.hints);
  await shot(page, 'pc-hints-1280x720');
  // collapsed and kept
  await page.click('#key-hints-toggle'); await frames(page, 2);
  const col = await page.evaluate(() => ({ list: document.querySelector('#key-hints-list').hidden, h: document.querySelector('#key-hints').getBoundingClientRect().height, kept: localStorage.getItem('rss.keyHints') }));
  await page.click('#key-hints-toggle'); await frames(page, 2);
  ok('the key hints fold away to their header (kept) and back', col.list && col.h < 40 && col.kept === 'false', col);
  // a tank: its own hints
  await fly(page, 'tk34');
  await page.waitForTimeout(400);
  const th = await page.evaluate(hintRows);
  ok('a tank\'s key hints: drive, turn, aim, fire, the sight, the MG, shells 1–4, smoke', ['Drive', 'Turn', 'Aim', 'Fire', 'Sight', 'MG', 'Shells', 'Smoke'].every((w) => th.some((t) => t.includes(w))), th);
  await shot(page, 'pc-tank-1280x720');
  // Touch controls: On brings the stick and FIRE back on a desktop (a touchscreen laptop), and the hints go
  await page.evaluate(() => { App.showSettings(); const s = document.querySelector('#set-touch-ui'); s.value = 'on'; s.dispatchEvent(new Event('change')); UI.closeModal(); });
  await fly(page, 'fs16'); await frames(page, 2);
  const on = await page.evaluate(() => ({ pc: document.body.classList.contains('pc'), stick: document.querySelector('#joy').getBoundingClientRect().width > 0, fire: document.querySelector('#btn-fire').getBoundingClientRect().width > 0, keys: document.querySelector('#key-hints').getBoundingClientRect().width > 0 }));
  ok('Settings → Touch controls: On brings the stick and FIRE to a desktop and hides the key hints', !on.pc && on.stick && on.fire && !on.keys, on);
  await pageErrors(page, tag);
  await ctx.close();
}
if (part(4)) {
  const { ctx, page } = await open([390, 844, true], { touchUI: 'off' }, 'touch off ');
  await fly(page, 'fs16'); await frames(page, 2);
  const off = await page.evaluate(() => ({ pc: document.body.classList.contains('pc'), stick: document.querySelector('#joy').getBoundingClientRect().width > 0, keys: document.querySelector('#key-hints').getBoundingClientRect().width > 0, z: Controls.z }));
  const L = await page.evaluate(layout);
  ok('Touch controls: Off on a phone (a tablet with a keyboard): the key hints in place of the stick', off.pc && !off.stick && off.keys, off);
  judge('390×844 with touch controls off', L, ['keys']);
  await pageErrors(page, 'touch off ');
  await ctx.close();
}

// ================================================================ 5. keys
if (part(5)) {
  const tag = 'keys ', { ctx, page } = await open([1280, 720, false], {}, tag);
  // the Keys screen from Settings: Fire → H
  await page.evaluate(() => { App.showSettings(); document.querySelector('#set-keys').click(); });
  const slot = (id, i) => `#modal-card .kb-row[data-id="${id}"] .kb-slot[data-slot="${i}"]`;
  const k0 = await page.evaluate(() => ({ title: document.querySelector('#modal-card .modal-title').textContent, groups: [...document.querySelectorAll('#modal-card .kb-h')].map((h) => h.textContent), fire: document.querySelector('#modal-card .kb-row[data-id="fire"] .kb-slot').textContent }));
  ok('Settings → Keys: every action in its group (Flight, Planes, Rockets, Weapons, Camera, Armour, Multiplayer, Builder) with today\'s keys', k0.title === 'Keys' && k0.groups.length === 8 && k0.fire === 'V', k0);
  await page.click(slot('fire', 0));
  const wait = await page.evaluate((q) => document.querySelector(q).textContent, slot('fire', 0));
  await page.keyboard.press('Escape');
  const esc = await page.evaluate((q) => ({ t: document.querySelector(q).textContent, open: UI.modalOpen, cap: !!Keys.capture }), slot('fire', 0));
  await page.click(slot('fire', 0)); await page.keyboard.press('KeyH');
  const h = await page.evaluate((q) => ({ t: document.querySelector(q).textContent, keys: Keys.get('fire'), saved: localStorage.getItem('rss.keys') }), slot('fire', 0));
  ok('a slot waits for a key ("Press a key…"); Esc cancels and the dialog stays; H then binds Fire to H, saved', wait === 'Press a key…' && esc.t === 'V' && esc.open && !esc.cap && h.t === 'H' && h.keys.join() === 'KeyH' && /"fire":\["KeyH"\]/.test(h.saved), { wait, esc, h });
  // a clash: Stage's first key → H asks; Swap gives Fire Stage's Space
  await page.click(slot('stage', 0)); await page.keyboard.press('KeyH');
  const c1 = await page.evaluate(() => { const b = document.querySelector('#modal-card .kb-conflict'); return { shown: b && !b.hidden, text: b && b.textContent }; });
  await page.evaluate(() => [...document.querySelectorAll('#modal-card .kb-conflict button')].find((x) => /^Swap/.test(x.textContent)).click());
  const c2 = await page.evaluate(() => ({ stage: Keys.get('stage'), fire: Keys.get('fire') }));
  ok('a key another action has asks: "H is already: Fire (hold)"; Swap gives each the other\'s', c1.shown && /H is already: Fire/.test(c1.text) && c2.stage.join() === 'KeyH' && c2.fire.join() === 'Space', { c1, c2 });
  // Clear it there: Fire's second key → Space (Fire has it) is no clash with itself; Stage → Space clashes with Fire; clear it there
  await page.click(slot('stage', 0)); await page.keyboard.press('Space');
  await page.evaluate(() => [...document.querySelectorAll('#modal-card .kb-conflict button')].find((x) => x.textContent === 'Clear it there').click());
  const c3 = await page.evaluate(() => ({ stage: Keys.get('stage'), fire: Keys.get('fire') }));
  // Cancel leaves a clash alone; a second key; Backspace clears a slot
  await page.click(slot('fire', 0)); await page.keyboard.press('KeyH');
  await page.click(slot('fire', 1)); await page.keyboard.press('KeyG'); // (G: Gear's, a clash: cancel)
  const c4 = await page.evaluate(() => !document.querySelector('#modal-card .kb-conflict').hidden);
  await page.evaluate(() => [...document.querySelectorAll('#modal-card .kb-conflict button')].find((x) => x.textContent === 'Cancel').click());
  const c4b = await page.evaluate(() => ({ fire: Keys.get('fire'), gear: Keys.get('gear') }));
  await page.click(slot('fire', 1)); await page.keyboard.press('KeyU');
  const c5 = await page.evaluate(() => Keys.get('fire'));
  await page.click(slot('fire', 1)); await page.keyboard.press('Backspace');
  const c6 = await page.evaluate(() => Keys.get('fire'));
  ok('Clear it there takes the key from the other action; Cancel leaves both as they were; a second key is added; Backspace clears its slot',
    c3.stage.join() === 'Space' && c3.fire.join() === '' && c4 && c4b.fire.join() === 'KeyH' && c4b.gear.join() === 'KeyG' && c5.join() === 'KeyH,KeyU' && c6.join() === 'KeyH', { c3, c4, c4b, c5, c6 });
  await page.evaluate(() => { UI.closeModal(); UI.closeModal(); }); // (the Keys screen, then the Settings it went back to)
  // in flight: H fires, V doesn't; the hints, the help and the manual say H
  await fly(page, 'fs16');
  await page.keyboard.down('KeyV'); await frames(page, 2); const fv = await page.evaluate(() => Flight.firing); await page.keyboard.up('KeyV');
  await page.keyboard.down('KeyH'); await frames(page, 2); const fh = await page.evaluate(() => Flight.firing); await page.keyboard.up('KeyH');
  await frames(page, 2);
  const words = await page.evaluate(() => {
    const d = el('div'); d.innerHTML = Flight.controlsHelp();
    const row = [...d.querySelectorAll('.help-grid > div')].find((x) => /Fire \(hold\)/.test(x.textContent));
    App.showHelp(); const m = document.querySelector('#modal-card').innerHTML; UI.closeModal();
    return { hints: [...document.querySelectorAll('#key-hints-list > div')].map((x) => [...x.querySelectorAll('kbd')].map((k) => k.textContent).join(' ') + ' ' + x.lastElementChild.textContent).find((t) => /Fire/.test(t)), help: row && row.innerHTML, manual: /<kbd>H<\/kbd><kbd>Tab<\/kbd><span>Fire/.test(m), tip: document.querySelector('#btn-fire').title };
  });
  ok('in flight Fire is H (V does nothing now); the key hints, the help list, the manual and FIRE\'s tip all say H', !fv && fh && words.hints === 'LMB H Fire' && /^<kbd>H<\/kbd><kbd>Tab<\/kbd>/.test(words.help) && words.manual && words.tip === 'Fire (hold H)', { fv, fh, words });
  // kept after a reload; the builder's keys too (rotate on U)
  await page.reload(); await page.waitForTimeout(400); await page.evaluate(instrument);
  const kept = await page.evaluate(() => Keys.get('fire').join());
  await page.evaluate(() => { Keys.set('bRotate', 0, 'KeyU'); App.toBuild(); Builder.loadTemplate('orbiter'); Builder.selected = Builder.parts[Builder.parts.length - 1]; Builder.renderInfo(); });
  const r0 = await page.evaluate(() => Builder.selected.rot);
  await page.keyboard.press('KeyR'); const r1 = await page.evaluate(() => Builder.selected.rot);
  await page.keyboard.press('KeyU'); const r2 = await page.evaluate(() => Builder.selected.rot);
  ok('kept after a reload; the builder\'s keys too (rotate moved to U: R does nothing, U turns the part; its button\'s tip says U)', kept === 'KeyH' && r1 === r0 && r2 !== r0 && (await page.evaluate(() => document.querySelector('#btn-rotate').title)) === 'Rotate (U)', { kept, r0, r1, r2 });
  // reset all: back to today's keys
  await page.evaluate(() => { App.showSettings(); document.querySelector('#set-keys').click(); });
  await page.evaluate(() => { const b = [...document.querySelectorAll('#modal-card .btn.danger')].find((x) => /Reset all/.test(x.textContent)); b.click(); b.click(); });
  const all = await page.evaluate(() => ({ fire: Keys.get('fire').join(), stage: Keys.get('stage').join(), rot: Keys.get('bRotate').join(), saved: localStorage.getItem('rss.keys') }));
  await page.evaluate(() => { UI.closeModal(); UI.closeModal(); });
  ok('Reset all keys (two taps): every key as it was', all.fire === 'KeyV' && all.stage === 'Space' && all.rot === 'KeyR' && all.saved === '{}', all);
  await shot(page, 'keys-1280x720');
  await pageErrors(page, tag);
  await ctx.close();
}
// the Keys screen's look, a forged rss.keys
if (part(5)) {
  const forged = JSON.stringify({ fire: ['Escape', 'KeyQ', 'KeyZ'], bogus: ['KeyA'], stage: 'Space', thrUp: ['ShiftLeft', '<img src=x>'], map: [42], __proto__: ['KeyA'] });
  const { ctx, page } = await open([1280, 720, false], {}, 'forged keys ', { 'rss.keys': forged });
  const k = await page.evaluate(() => ({ fire: Keys.get('fire'), stage: Keys.get('stage'), thrUp: Keys.get('thrUp'), map: Keys.get('map'), bogus: Keys.get('bogus'), n: Keys.ACTIONS.length }));
  ok('a forged rss.keys: Esc never bound, at most two real key codes, either Shift as Shift, junk and unknown actions dropped, a non-list kept at the default',
    k.fire.join() === 'KeyQ' && k.stage.join() === 'Space' && k.thrUp.join() === 'Shift' && k.map.join() === '' && k.bogus.length === 0, k);
  await page.evaluate(() => { App.showSettings(); document.querySelector('#set-keys').click(); });
  const clash = await page.evaluate(() => [...document.querySelectorAll('#modal-card .kb-slot.clash')].map((s) => s.closest('.kb-row').dataset.id));
  ok('the Keys screen shows a key two live actions share in red (Q: Fire and roll left)', clash.includes('fire') && clash.includes('rollL'), clash);
  await page.evaluate(() => document.querySelector('#modal-card').scrollTop = 0);
  await shot(page, 'keys-screen-1280x720');
  await page.evaluate(() => UI.closeModal());
  await pageErrors(page, 'forged keys ');
  await ctx.close();
}
if (part(5)) {
  // the Keys screen on a phone (it fits), and the Settings dialog's controls section
  const { ctx, page } = await open([390, 844, true], {}, 'phone keys ');
  await page.evaluate(() => { App.showSettings(); });
  await shot(page, 'settings-390x844');
  const s = await page.evaluate(() => { const c = document.querySelector('#modal-card'); return { w: c.scrollWidth <= c.clientWidth + 1, text: c.textContent }; });
  await page.evaluate(() => document.querySelector('#set-keys').click());
  const k = await page.evaluate(() => { const c = document.querySelector('#modal-card'), rows = [...c.querySelectorAll('.kb-row')]; return { fit: c.scrollWidth <= c.clientWidth + 1, rows: rows.length, over: rows.filter((r) => r.getBoundingClientRect().right > innerWidth).length }; });
  await shot(page, 'keys-390x844');
  ok('on a phone: Settings has the controls (Touch controls, UI size, Stick size, Aim stick speed, Keys, Edit controls) and the Keys screen fits its width',
    s.w && /Touch controls/.test(s.text) && /UI size/.test(s.text) && /Stick size/.test(s.text) && /Aim stick speed/.test(s.text) && k.fit && k.rows === 64 && k.over === 0, { s: { w: s.w }, k });
  await page.evaluate(() => UI.closeModal());
  await pageErrors(page, 'phone keys ');
  await ctx.close();
}

// ================================================================ 6. UI size: the whole HUD, held to what fits
// Settings → UI size and the editor's UI size slider (one setting) scale the whole HUD (--ui-scale); smaller as asked;
// larger only as far as it fits (Controls.fit): at 150% a phone's controls no longer run into each other or the flight
// data (on 390×844 the roll buttons and Brake met the stage box and CM, on 844×390 flaps and gear met the flight data);
// the stick and the editor's drag follow the finger at any size.
if (part(6)) {
  const tag = 'ui size fit ', { ctx, page } = await open([390, 844, true], {}, tag), cdp = await ctx.newCDPSession(page), T = fingers(cdp);
  await fly(page, 'fs16');
  await frames(page, 2);
  const sz = () => page.evaluate(() => {
    const w = (q) => { const e = document.querySelector(q); return e ? Math.round(e.getBoundingClientRect().width * 10) / 10 : null; };
    return { z: Controls.z, joy: w('#joy'), fire: w('#btn-fire'), stage: w('#flight-ui .stage-box'), tel: w('#flight-ui .telemetry') };
  });
  const set = (v) => page.evaluate((v) => { Settings.set('uiSize', v); Controls.relayout(); }, v);
  const s1 = await sz();
  await set(0.75); await frames(page, 2);
  const s2 = await sz();
  await page.waitForTimeout(1300);
  judge('390×844, a plane in Aim, UI size 75%', await page.evaluate(layout), ['stick', 'fire', 'throttle', 'stage', 'sas-aim']);
  ok('UI size 75%: the whole HUD three-quarters as big (the stick, FIRE, the stage box and the flight data)', s1.z === 1 && s2.z === 0.75 && [['joy'], ['fire'], ['stage'], ['tel']].every(([k]) => Math.abs(s2[k] - s1[k] * 0.75) < 1.5), { s1, s2 });
  await shot(page, 'uisize75-390x844');
  await T.down(1, 70, 600); await T.move(1, 80, 600);
  const j = await page.evaluate(() => { const r = document.querySelector('#joy').getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; });
  await T.up(1); await page.waitForTimeout(400);
  ok('at 75% the stick still comes to the thumb (where it landed)', Math.hypot(j.x - 70, j.y - 600) < 3, j);
  await set(1.5); await frames(page, 2);
  const s3 = await sz();
  await page.waitForTimeout(1300);
  judge('390×844, a plane in Aim, UI size 150% (held to what fits: it used to overlap)', await page.evaluate(layout), ['stick', 'fire', 'throttle', 'stage', 'sas-aim']);
  ok('UI size 150% on a phone in portrait: as big as fits (over 100%, at most the room\'s 1.18), the whole HUD with it', s3.z > 1 && s3.z <= 1.18 && Math.abs(s3.tel - s1.tel * s3.z) < 1.5, { s1, s3 });
  await shot(page, 'uisize150-390x844');
  // a tank, smaller and larger
  await fly(page, 'tk34');
  for (const v of [0.6, 1.5]) {
    await set(v); await page.waitForTimeout(1300); await frames(page, 2);
    judge(`390×844, a tank, UI size ${v * 100}% (scale ${await page.evaluate(() => Controls.z)})`, await page.evaluate(layout), ['stick', 'fire', 'sight', 'map', 'shells']);
  }
  await shot(page, 'uisize150-tank-390x844');
  // a phone on its side: flaps and gear used to meet the flight data at 150%
  await set(1.5); await fly(page, 'fs16');
  await page.setViewportSize({ width: 844, height: 390 }); await page.evaluate(() => Controls.resize());
  await page.waitForTimeout(1300); await frames(page, 2);
  judge(`844×390, a plane in Aim, UI size 150% (scale ${await page.evaluate(() => Controls.z)}; it used to overlap)`, await page.evaluate(layout), ['stick', 'fire', 'throttle', 'stage', 'sas-aim']);
  await shot(page, 'uisize150-844x390');
  await page.setViewportSize({ width: 390, height: 844 }); await set(1); await frames(page, 2);
  // the editor: its UI size slider (when no control is chosen) is Settings → UI size; a control dragged at 80% follows the finger
  await page.evaluate(() => { App.showSettings(); const r = document.querySelector('#set-ui-size'); r.value = '80'; r.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#set-layout').click(); });
  await frames(page, 2);
  const ed = await page.evaluate(() => { const a = document.querySelector('#ce-all'), f = document.querySelector('#btn-fire').getBoundingClientRect(); return { all: a && a.value, z: Controls.z, fire: { x: (f.left + f.right) / 2, y: (f.top + f.bottom) / 2 } }; });
  await T.down(3, ed.fire.x, ed.fire.y);
  for (let i = 1; i <= 6; i++) await T.move(3, ed.fire.x - i * 10, ed.fire.y - i * 15);
  await T.up(3); await frames(page, 2);
  const ed2 = await page.evaluate(() => { const f = document.querySelector('#btn-fire').getBoundingClientRect(); return { x: (f.left + f.right) / 2, y: (f.top + f.bottom) / 2 }; });
  ok('Settings → UI size 80% is the editor\'s UI size slider; at 80% a control dragged follows the finger', ed.all === '80' && ed.z === 0.8 && Math.abs(ed2.x - (ed.fire.x - 60)) < 2 && Math.abs(ed2.y - (ed.fire.y - 90)) < 2, { ed, ed2 });
  await page.evaluate(() => { const b = document.querySelector('#ctl-edit-bar .btn.danger'); b.click(); b.click(); }); // (FIRE back in its place; nothing chosen: the UI size slider shows)
  await frames(page, 2);
  const out = await page.evaluate(() => { const a = document.querySelector('#ce-all'); a.value = '150'; a.dispatchEvent(new Event('input', { bubbles: true })); return { text: a.parentNode.querySelector('output').textContent, z: Controls.z }; });
  ok('the editor\'s UI size at 150% on a phone says what fits ("150% · fits …%")', /^150% · fits 1[01]\d%$/.test(out.text) && out.z > 1 && out.z <= 1.18, out);
  await shot(page, 'uisize-editor-390x844');
  await page.evaluate(() => document.querySelector('#ctl-edit-bar .btn.primary').click());
  await page.evaluate(() => { UI.closeModal(); Settings.set('uiSize', 1); });
  await pageErrors(page, tag);
  await ctx.close();
}

ok('no console errors', !errs.length, errs.slice(0, 6).join('\n'));
await b.close(); srv.close();
ok.done();
