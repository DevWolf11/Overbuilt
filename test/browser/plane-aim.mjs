// Aim, the mouse aim for planes (PR #40), in the real page:
//  - With Settings → Planes start in: Aim, a new plane flight starts in Aim (the autopilot bar's Aim pressed); by default
//    it starts in hold (the play-test after PR #42), and the setting starts it in any of the bar's five modes; a restored
//    save keeps its own mode, and an old save's Off flies the manual law (the Off button pressed); the Retro 2D flight doesn't offer Aim (no button, the key
//    says why).
//  - A desktop: the first click captures the mouse (and doesn't fire); the mouse's movement under the lock moves the circle
//    (right turns it right, up lifts it) and the plane follows it; a click under the lock fires; held keys fly the plane
//    by hand and the circle rides the nose; C held looks round (the circle stays where it was), a tap puts the circle on
//    the nose; 4 is Off (the manual law), 5 back to Aim.
//  - A phone (the controls update): only the stick moves the circle (held right, it turns right and the plane isn't flown
//    by hand); a drag on the view looks round and leaves the circle where it is; a slide on FIRE fires and doesn't move it.
//  - One cross (the play-test after PR #40): Aim's HUD is the circle and one cross where the nose points and the guns hit
//    (green with a gun selected, pale blue in the same place with a missile); no pipper beside it, no prograde marks (both
//    back in hold). The camera eases after the circle: it trails while the stick turns it, the circle at most 60% of the
//    way to the screen's edge, and settles on it once the stick is let go.
//  - On the runway (the play-test's finding 12): a level circle, full throttle: the FS-16 lifts off under 500 km/h.
//  - Where things go: on a phone in portrait (390×844, 375×667), a phone on its side (844×390) and a desktop (1280×720: no
//    touch controls, the key hints instead), the autopilot bar, the stick, the roll buttons, Brake, the flaps and gear pills,
//    FIRE, CM, the weapon chip, the throttle, the stage box, the key hints, the flight data and the buttons top right stay on
//    the screen and clear of each other, and the circle sits on the screen clear of them; no console errors (App.frame
//    swallows them).
// SHOTS=<dir> saves screenshots there (aim-*.png).
//   node test/browser/plane-aim.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `aim-${name}.png`) }); };
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('plane-aim: Aim, the mouse aim, and the manual law in the page');

const instrument = () => {
  window.__errs = [];
  addEventListener('error', (e) => window.__errs.push('onerror ' + e.message));
  for (const [o, k, n] of [[Flight, 'update', 'Flight.update'], [Flight, 'drawFlyAim', 'Flight.drawFlyAim'], [Render3D, 'renderFlight', 'Render3D.renderFlight']]) {
    const f = o[k]; o[k] = function (...a) { try { return f.apply(this, a); } catch (e) { window.__errs.push(`${n}: ${e && e.stack}`); throw e; } };
  }
};
async function open(vp, settings = {}, tag = '') {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: vp[2], isMobile: vp[2] }), page = await ctx.newPage();
  watch(page, errs, tag);
  await openGame(page, srv.url, { planeStart: 'aim', ...settings }); // (Settings → Planes start in: Aim, but where a check says otherwise)
  await page.evaluate(instrument);
  return { ctx, page };
}
// a template in the air (the arena's air start: over the spot, flying along its nose, gear up, engines running)
async function fly(page, key = 'fs16', speed = 200) {
  await page.evaluate(async ([key, speed]) => {
    await Render3D.load();
    App.toBuild(); Builder.loadTemplate(key); store.set('rss.flight', null); App.showScene('flight');
    Flight.start(Builder.serialize(), { place: { e: 0, z: 0, yaw: 0, air: { alt: 1500, speed } } });
  }, [key, speed]);
  await page.waitForFunction(() => Flight.running && Flight.active && Flight.time > 0.6, null, { timeout: 60000 });
}
const until = (page, t) => page.waitForFunction((t) => Flight.time > t, t, { timeout: 180000 });
const frames = (page, n = 2) => page.evaluate((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const pageErrors = async (page, tag) => { const e = await page.evaluate(() => window.__errs.splice(0)); for (const x of e) errs.push(tag + x); };
const state = (page) => page.evaluate(() => {
  const v = Flight.active, P = v.pilot, n = v.axis(P.F.x, P.F.y, P.F.z), D = Flight.flyDir, F = surfaceFrame(v.x, v.y, v.z);
  return { sas: v.sas, flyAim: Flight.flyAim, off: D ? Math.acos(Math.max(-1, Math.min(1, n.x * D.x + n.y * D.y + n.z * D.z))) * 57.2958 : null,
    right: D ? D.x * F.north.x + D.y * F.north.y + D.z * F.north.z : null, up: D ? D.x * F.up.x + D.y * F.up.y + D.z * F.up.z : null,
    pressed: [...document.querySelectorAll('[data-sas]')].filter((b) => !b.hidden && b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.sas),
    shown: [...document.querySelectorAll('[data-sas]')].filter((b) => !b.hidden).map((b) => b.dataset.sas), locked: Flight._locked, look: !!Flight.flyLook, firing: Flight.firing };
});

// ---- where everything is (the plane's HUD), and the circle on screen
const layout = () => {
  const rect = (q) => { const e = typeof q === 'string' ? document.querySelector(q) : q; if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width && r.height && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const items = { stick: rect('#joy'), rollL: rect('#rot-left'), rollR: rect('#rot-right'), brake: rect('#btn-brake'), flaps: rect('#btn-flaps'), gear: rect('#btn-gear'),
    fire: rect('#btn-fire'), cm: rect('#btn-cm'), chip: rect('#btn-weapon'), throttle: rect('#flight-ui .throttle-box'), stage: rect('#flight-ui .stage-box'),
    telemetry: rect('#flight-ui .telemetry'), topRight: rect('#flight-ui .flight-top-right'), warp: rect('#warp'), keys: rect('#key-hints') };
  document.querySelectorAll('#sas-bar [data-sas]').forEach((b) => { const r = rect(b); if (r) items['sas-' + b.dataset.sas] = r; });
  const v = Flight.active, bp = bodyPos(v.body, Flight.time), D = Flight.flyDir, L = 2000;
  const c = D && Render3D.project(bp.x + v.x + D.x * L, bp.y + v.y + D.y * L, v.z + D.z * L);
  return { W: innerWidth, H: innerHeight, pc: document.body.classList.contains('pc'), items, circle: c && !c.behind ? { l: c.x - 18, t: c.y - 18, r: c.x + 18, b: c.y + 18 } : null };
};
// the camera's lag behind the circle (degrees) and where the circle is across the screen (from the middle, in half-widths)
const camLag = () => {
  const v = Flight.active, bp = bodyPos(v.body, Flight.time), D = Flight.flyDir, C = Flight.flyCamDir, L = 2000, c = Render3D.project(bp.x + v.x + D.x * L, bp.y + v.y + D.y * L, v.z + D.z * L);
  return { lag: Math.acos(Math.max(-1, Math.min(1, C.x * D.x + C.y * D.y + C.z * D.z))) * 57.2958, x: (c.x - innerWidth / 2) / (innerWidth / 2) };
};
const meets = (a, c) => !!a && !!c && a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
function judge(tag, L) {
  const clash = [], off = [], E = Object.entries(L.items);
  for (let i = 0; i < E.length; i++) {
    const [k, a] = E[i];
    if (!a) continue;
    if (a.l < -0.5 || a.t < -0.5 || a.r > L.W + 0.5 || a.b > L.H + 0.5) off.push(k);
    for (let j = i + 1; j < E.length; j++) if (meets(a, E[j][1])) clash.push(`${k}/${E[j][0]}`);
    if (meets(a, L.circle)) clash.push(`${k}/circle`);
  }
  const need = (L.pc ? ['keys', 'chip', 'throttle', 'telemetry', 'sas-aim'] : ['stick', 'fire', 'throttle', 'telemetry', 'sas-aim']).filter((k) => !L.items[k]);
  const onScreen = !!L.circle && L.circle.l >= 0 && L.circle.t >= 0 && L.circle.r <= L.W && L.circle.b <= L.H;
  ok(`${tag} (${L.W}×${L.H}): the plane's HUD clear of itself and of the circle, on the screen`, !clash.length && !off.length && !need.length && onScreen, JSON.stringify({ clash, off, need, onScreen, circle: L.circle }));
}

// ---- a desktop
{
  const { ctx, page } = await open([1280, 720, false], {}, 'desktop ');
  await fly(page);
  let s = await state(page);
  ok('with Planes start in: Aim, a new plane flight starts in Aim: the Aim button pressed, the circle on the nose', s.sas === 'aim' && s.flyAim && s.pressed.join() === 'aim' && s.shown.join() === 'hold,level,heading,off,aim' && s.off < 6, s);
  judge('desktop', await page.evaluate(layout));
  await shot(page, 'desktop');
  // a stand-in pointer lock (headless Chromium's own gives synthetic moves huge jumps)
  await page.evaluate(() => {
    const c = Flight.canvas; window.__pl = null;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => window.__pl });
    c.requestPointerLock = () => { window.__pl = c; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
    document.exitPointerLock = () => { if (!window.__pl) return; window.__pl = null; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
    window.__used = 0; const u = Flight.usePart; Flight.usePart = function (...a) { window.__used++; return u.apply(this, a); };
  });
  const mid = [640, 250];
  await page.mouse.move(mid[0], mid[1]); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(150);
  s = await state(page);
  ok('the first click captures the mouse, and neither fires nor uses a part', s.locked && !s.firing && (await page.evaluate(() => window.__used)) === 0, s);
  // under the lock: 200 px right, 100 px up, in steps (0.0022 rad a pixel: about 25° right and 13° up)
  for (let i = 0; i < 10; i++) await page.evaluate(() => Flight.canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true, clientX: 640, clientY: 250, movementX: 20, movementY: -10 })));
  await frames(page);
  s = await state(page);
  ok('the mouse moves the circle: right turns it right, up lifts it', s.right > 0.3 && s.up > 0.12 && s.off > 15, s);
  const t1 = await page.evaluate(() => Flight.time);
  await until(page, t1 + 4);
  const s2 = await state(page);
  ok('the plane flies its nose onto the circle (within 8° after 4 s)', s2.off < 8, { before: s.off, after: s2.off });
  await page.mouse.down(); await frames(page);
  const fire = await page.evaluate(() => Flight.firing); await page.mouse.up(); await frames(page);
  ok('a click under the lock fires', fire);
  // keys fly it by hand; the circle rides the nose
  await page.keyboard.down('KeyD'); await until(page, (await page.evaluate(() => Flight.time)) + 0.6);
  s = await state(page);
  await page.keyboard.up('KeyD');
  ok('held keys fly it (the manual law) and the circle rides the nose', s.off < 3 && s.sas === 'aim', s);
  // C held looks round: the camera along another way, the circle where it was; a tap puts the circle on the nose
  await page.keyboard.down('KeyC');
  for (let i = 0; i < 5; i++) await page.evaluate(() => Flight.canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true, clientX: 640, clientY: 250, movementX: 60, movementY: 0 })));
  await frames(page);
  const look = await page.evaluate(() => ({ look: !!Flight.flyLook, apart: Flight.flyCamDir !== Flight.flyDir && Math.acos(Math.max(-1, Math.min(1, Flight.flyCamDir.x * Flight.flyDir.x + Flight.flyCamDir.y * Flight.flyDir.y + Flight.flyCamDir.z * Flight.flyDir.z))) * 57.3 }));
  await page.keyboard.up('KeyC'); await frames(page);
  const after = await state(page);
  ok('C held looks round (the view turned, the circle kept), let go the view comes back', look.look && look.apart > 20 && !after.look, { look, after });
  await page.keyboard.down('KeyC'); await page.keyboard.up('KeyC'); await frames(page);
  s = await state(page);
  ok('a tap of C puts the circle on the nose', s.off < 3, s);
  // 4: Off (the manual law), 5: Aim again
  await page.keyboard.press('Digit4'); await frames(page); s = await state(page);
  const off = s;
  await page.keyboard.press('Digit5'); await frames(page); s = await state(page);
  ok('4 is Off (the manual law, the Off button pressed), 5 is Aim again', off.sas === 'manual' && off.pressed.join() === 'off' && !off.flyAim && s.sas === 'aim' && s.flyAim, { off, aim: s });
  // one cross (the play-test after PR #40 counted three marks): in Aim the HUD is the circle and the cross where the nose
  // points and the guns hit; Combat draws no pipper beside it and the prograde marks are gone; in hold they're back
  const marks = await page.evaluate(() => {
    const v = Flight.active, sys = Combat.systems(v), bp = bodyPos(v.body, Flight.time);
    const rec = () => { const c = document.createElement('canvas').getContext('2d'), arcs = [], a = c.arc; c.arc = function (x, y, r, ...o) { arcs.push(Math.round(r * 10) / 10); return a.call(this, x, y, r, ...o); }; return { c, arcs }; };
    const look = () => {
      const h = rec(), f = rec(), m = []; Combat.drawHUD(h.c, App.W, App.H, 1, Flight); if (Flight.flyAim) Flight.drawFlyAim(f.c, App.W, App.H, 1);
      World.markersFor(v, Flight, bp, (x, y, k) => m.push(k));
      return { hud: h.arcs, fly: f.arcs, marks: m };
    };
    v.wsel = sys.findIndex((x) => x.w.kind === 'gun');
    const gun = Combat.aimCross(v, {}), inAim = look();
    v.wsel = sys.findIndex((x) => x.w.kind === 'missile');
    const msl = Combat.aimCross(v, {});
    v.wsel = sys.findIndex((x) => x.w.kind === 'gun');
    Flight.setSas('hold'); Flight.planeTick(0.016);
    const inHold = look();
    Flight.setSas('aim'); Flight.planeTick(0.016);
    return { gun, msl, same: Math.hypot(gun.x - msl.x, gun.y - msl.y, gun.z - msl.z), inAim, inHold };
  });
  ok('Aim shows one cross where the nose points and the guns hit (green with the gun selected, pale blue and in the same place with a missile), no pipper beside it and no prograde marks; in hold the pipper and the marks are back',
    marks.gun.armed && !marks.msl.armed && marks.same < 1e-6 && !marks.inAim.hud.includes(13) && marks.inAim.fly.filter((r) => r === 17).length === 2 && marks.inAim.fly.includes(1.8) && !marks.inAim.marks.length
    && marks.inHold.hud.includes(13) && marks.inHold.marks.includes('pro') && !marks.inHold.fly.length, marks);
  // a restored save keeps its mode; an old save's Off flies the manual law
  const restored = await page.evaluate(() => {
    Flight.active.sas = 'level'; Flight.save(); const d = store.get('rss.flight'); Flight.restore(d); const a = Flight.active.sas;
    d.vessels[d.active].sas = 'off'; Flight.restore(d); return [a, Flight.active.sas, [...document.querySelectorAll('[data-sas]')].filter((b) => !b.hidden && b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.sas).join()];
  });
  ok('a restored flight keeps its own mode (never switched to Aim); a saved Off flies the manual law', restored[0] === 'level' && restored[1] === 'manual' && restored[2] === 'off', restored);
  await pageErrors(page, 'desktop ');
  await ctx.close();
}

// ---- Settings → Planes start in (the play-test after PR #42: the normal autopilot first, for now): a new plane flight
// starts in hold by default, an old settings file's PR #40 planeAim (on) no longer starts it in Aim; the setting offers the
// five modes of the autopilot bar and starts a new flight in the one picked
{
  const { ctx, page } = await open([1280, 720, false], { planeStart: undefined, planeAim: true }, 'start mode ');
  await fly(page);
  const d = await state(page);
  const opts = await page.evaluate(() => { App.showSettings(); const s = document.querySelector('#set-plane-start'), r = { o: [...s.options].map((x) => x.value), v: s.value }; UI.closeModal(); return r; });
  const modes = [];
  for (const m of ['level', 'heading', 'manual', 'aim', 'hold']) {
    await page.evaluate((m) => { App.showSettings(); const s = document.querySelector('#set-plane-start'); s.value = m; s.dispatchEvent(new Event('change', { bubbles: true })); UI.closeModal(); }, m);
    await fly(page);
    const st = await state(page);
    modes.push([m, st.sas, st.pressed.join(), st.flyAim]);
  }
  ok('a new plane flight starts in hold, the normal autopilot, by default (an old settings file with planeAim on too); Settings → Planes start in offers hold, level, heading, Off and Aim and starts a new flight in the one picked',
    d.sas === 'hold' && d.pressed.join() === 'hold' && !d.flyAim && opts.v === 'hold' && opts.o.join() === 'hold,level,heading,manual,aim' && modes.every(([m, sas, p, fa]) => sas === m && p === (m === 'manual' ? 'off' : m) && fa === (m === 'aim')),
    { d: { sas: d.sas, pressed: d.pressed, flyAim: d.flyAim }, opts, modes });
  await shot(page, 'start-hold');
  await pageErrors(page, 'start mode ');
  await ctx.close();
}

// ---- a phone in portrait: only the stick moves the circle; a drag on the view looks round; a slide on FIRE only fires
for (const vp of [[390, 844, true], [375, 667, true], [844, 390, true]]) {
  const tag = `phone ${vp[0]}×${vp[1]} `;
  const { ctx, page } = await open(vp, {}, tag);
  await fly(page);
  let s = await state(page);
  judge(tag.trim(), await page.evaluate(layout));
  await shot(page, `${vp[0]}x${vp[1]}`);
  if (vp[0] === 390) {
    // a finger's drag on open sky
    const at = [vp[0] * 0.55, vp[1] * 0.3];
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y) === Flight.canvas, at);
    const cdp = await ctx.newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', at[0], at[1]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', at[0] + i * 10, at[1] - i * 4);
    await touch('touchEnd'); await frames(page);
    const s1 = await state(page);
    ok('a drag on the view looks round, and leaves the circle where it was', top && Math.abs(s1.right - s.right) < 0.03 && Math.abs(s1.up - s.up) < 0.03, { top, before: s, after: s1 });
    // a slide on FIRE
    const f = await page.evaluate(() => { const r = document.querySelector('#btn-fire').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await touch('touchStart', f[0], f[1]);
    for (let i = 1; i <= 6; i++) await touch('touchMove', f[0] - i * 8, f[1]);
    await frames(page);
    const firing = await page.evaluate(() => Flight.firing);
    await touch('touchEnd'); await frames(page);
    const s2 = await state(page);
    ok('a slide on FIRE fires and no longer moves the circle', firing && Math.abs(s2.right - s1.right) < 0.03, { before: s1.right, after: s2.right, firing });
    // the stick moves the circle (held right: it turns right), the plane not flown by hand
    const j = await page.evaluate(() => { const r = document.querySelector('#joy').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await touch('touchStart', j[0], j[1]); await touch('touchMove', j[0] + 30, j[1]);
    await until(page, (await page.evaluate(() => Flight.time)) + 0.5);
    const s3 = await state(page), c3 = await page.evaluate(() => Flight.active.ctl.h), cam = await page.evaluate(camLag);
    await touch('touchEnd');
    ok('the stick moves the circle right while held, in Aim, and doesn\'t fly the plane by hand', s3.right > s2.right + 0.2 && s3.sas === 'aim' && c3 === 0, { s3, ctl: c3 });
    // the camera eases after the circle (the play-test after PR #40; a little more after PR #41's): it trails it while the
    // stick turns it, the circle ahead of the middle but no more than 60% of the way to the screen's edge; let go, it
    // settles on the circle within 0.9 s
    await until(page, (await page.evaluate(() => Flight.time)) + 0.9);
    const cam2 = await page.evaluate(camLag);
    ok('the camera follows the circle a moment behind: it trails while the stick turns it (the circle ahead of the middle, at most 60% of the way to the edge) and settles on it once let go', cam.lag > 1 && cam.x > 0.05 && cam.x < 0.66 && cam2.lag < 0.5 && Math.abs(cam2.x) < 0.03, { held: cam, after: cam2 });
  }
  await pageErrors(page, tag);
  await ctx.close();
}

// ---- on the runway: a level circle, full throttle (the flight loop's own update, 60 a second)
{
  const { ctx, page } = await open([1280, 720, false], {}, 'runway ');
  await page.evaluate(async () => { await Render3D.load(); App.toBuild(); Builder.loadTemplate('fs16'); store.set('rss.flight', null); App.showScene('flight'); Flight.start(Builder.serialize()); });
  await page.waitForFunction(() => Flight.running && Flight.active && Flight.time > 0.3, null, { timeout: 60000 });
  await page.keyboard.press('Space'); await page.keyboard.press('KeyZ'); await frames(page, 2);
  const r = await page.evaluate(() => {
    const v = Flight.active; let lift = null, top = 0;
    for (let i = 0; i < 40 * 60 && !lift; i++) { Flight.update(1 / 60); if (v.wheelsDown) top = Math.max(top, v.speed()); else if (Flight.time > 2 && v.groundAltitude() > 3) lift = v.speed(); }
    return { sas: v.sas, lift: lift && Math.round(lift * 3.6), top: Math.round(top * 3.6) };
  });
  ok('on the runway in Aim with a level circle, full throttle: the FS-16 lifts off under 500 km/h (it raced to 1,206 km/h before)', r.sas === 'aim' && r.lift && r.lift < 500, r);
  await pageErrors(page, 'runway ');
  await ctx.close();
}

// ---- the Retro 2D flight: no Aim
{
  const { ctx, page } = await open([1280, 720, false], {}, '2d ');
  await page.evaluate(() => Silly.set('retro2d', true));
  await fly(page);
  await page.keyboard.press('Digit5'); await frames(page);
  const s = await state(page);
  ok('the Retro 2D flight doesn\'t offer Aim: it starts in hold, no Aim button, 5 says why', s.sas === 'hold' && !s.shown.includes('aim') && !s.flyAim, s);
  await page.evaluate(() => Silly.set('retro2d', false));
  await pageErrors(page, '2d ');
  await ctx.close();
}

ok('no console errors', !errs.length, errs.slice(0, 6).join('\n'));
await b.close(); srv.close();
ok.done();
