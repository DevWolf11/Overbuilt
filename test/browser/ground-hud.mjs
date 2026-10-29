// The ground HUD and its controls (the ground update): Armour vehicles on the pad, in the real page.
//  - Where things go: on a phone in portrait (two sizes), a phone on its side, a desktop and in a room (a phone on its
//    side, the room's bar at the top), FIRE, SMOKE, the weapon chip, SIGHT, MG, LOCK, the zero pill, the shell chips, the
//    minimap, the damage diagram, the radar scope and the warning receiver's display stay clear of each other, of the
//    flight data, the controls, the room's bar, the buttons top right, the hint, the kill feed and Brake, and on screen.
//    With a stage left and thrust aboard (a JATO Booster), the Stage pill and the throttle too, and a tap on FIRE's middle
//    is FIRE's.
//  - What shows: an unarmed Armour design still hides the autopilot (body.ground); Brake on a tracked tank; SMOKE with
//    smoke launchers alone.
//  - The controls: R doesn't set the sight's zero, Y does (Realistic aim, a rangefinder aboard); a click under pointer
//    lock never uses a part; a slide on FIRE turns the turret; a drag on the view aims (a finger, and a mouse when the
//    lock is refused, whichever button went down first); Esc under pointer lock opens the menu once, whichever comes
//    first, the key or the lock let go; the capture click never fires, a click shorter than a frame does; Shift+Tab
//    leaves the sight alone; alt-tab ends a look round; the sight's wheel counts a touchpad's travel and never moves the
//    range under the lock (PgUp / PgDn do); the aim camera's zoom has no dead notches; an unarmed design's menu lists
//    its own keys; Blocked shows with the crosshair on the ground over a berm; a quick tap on a shell chip queues the
//    round even across a stalled frame, a long press loads it now.
//  - The sight: the view narrows to 50/zoom degrees and back, project() and metresPerPixelAt agreeing all the while.
//  - The HUD: the reload ring round FIRE; at most 120 2D-context calls a frame; none of its DOM written while nothing
//    changes; no console errors (App.frame swallows them).
// SHOTS=<dir> saves screenshots there (3f-*.png).
//   node test/browser/ground-hud.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const require = createRequire(import.meta.url);
const T = require('../lib/tanks.js');
const SHOTS = process.env.SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `3f-${name}.png`) }); };
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('ground-hud: the ground HUD and controls');

// ---- the vehicles (design rows: att is an index into the same list)
const row = (type, x, y, o = {}) => ({ type, x, y, flip: false, rot: 0, ...o });
// everything the HUD can show at once: the MA-1 (shells, MGs, smoke, a rangefinder) with a twin ATGM launcher (the weapon
// chip), a search radar (the scope) and a tracking radar (LOCK)
const KIT = [...T.ma1, row('atgmTube', -1.0, 2.7, { z: -1.35, att: 5 }), row('radarSearch', -1.6, 3.6, { att: 5 }), row('radarTrack', 0.3, 3.5, { z: 0.55, att: 5 })];
const BARE = [row('hullMedium', 0, 1.1), row('trackMed', 0, 0.5, { z: -1.35, att: 0 }), row('trackMed', 0, 0.5, { z: 1.35, att: 0 }), row('engDiesel', -1.8, 1.1, { att: 0 })];
const SMOKY = [...BARE, row('ringM', 0, 1.85, { att: 0 }), row('turretCast', 0, 2.425, { att: 4 }), row('smokeL', 0.6, 2.6, { z: -1.1, att: 5 }), row('smokeL', 0.6, 2.6, { z: 1.1, att: 5 })];
// the kit with a JATO Booster on the hull: a stage left (the Stage pill) and thrust aboard (the throttle)
const ROCKET = [...KIT, row('jato', -4.6, 1.3, { rot: 1, att: 0 })];

// in the page: the HUD's 2D-context calls a frame, the arcs it draws, and what errors App.frame would swallow
const instrument = () => {
  window.__errs = []; window.__ops = []; window.__arcs = [];
  addEventListener('error', (e) => window.__errs.push('onerror ' + e.message));
  const P = CanvasRenderingContext2D.prototype;
  let inHud = false, n = 0;
  for (const k of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, k);
    if (!d || typeof d.value !== 'function' || k === 'constructor') continue;
    const f = d.value;
    P[k] = function (...a) { if (inHud) { n++; if (k === 'arc') window.__arcs.push(a.slice(0, 3)); } return f.apply(this, a); };
  }
  const wrap = (o, k, name, around) => { const f = o[k]; o[k] = function (...a) { try { return around ? around(() => f.apply(this, a)) : f.apply(this, a); } catch (e) { window.__errs.push(`${name}: ${e && e.stack}`); throw e; } }; };
  wrap(GHUD, 'draw', 'GHUD.draw', (go) => { inHud = true; n = 0; window.__arcs.length = 0; try { return go(); } finally { inHud = false; window.__ops.push(n); if (window.__ops.length > 600) window.__ops.shift(); } });
  wrap(GHUD, 'frame', 'GHUD.frame'); wrap(GHUD, 'sync', 'GHUD.sync'); wrap(Flight, 'update', 'Flight.update'); wrap(Render3D, 'renderFlight', 'Render3D.renderFlight');
};
// a design flown from the pad (the real Earth map's): its HUD up
async function fly(page, name, rows) {
  await page.evaluate(([name, rows]) => { App.toBuild(); Builder.loadDesign({ name, kind: 'tank', parts: rows }); }, [name, rows]);
  await page.waitForFunction(() => Render3D.ready && Terrain.earthMap.state !== 'loading', null, { timeout: 120000 });
  await page.evaluate(() => { store.set('rss.flight', null); App.showScene('flight'); Flight.start(Builder.serialize()); });
  await page.waitForFunction(() => Flight.running && Flight.active && Flight.time > 0.5, null, { timeout: 60000 });
  await page.waitForTimeout(400);
}
async function open(vp, settings = {}, tag = '') {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: vp[2], isMobile: vp[2] }), page = await ctx.newPage();
  watch(page, errs, tag);
  await openGame(page, srv.url, settings);
  await page.evaluate(instrument);
  return { ctx, page };
}
const pageErrors = async (page, tag) => { const e = await page.evaluate(() => window.__errs.splice(0)); for (const x of e) errs.push(tag + x); };

// ---- where everything is
const layout = () => {
  const rect = (q) => { const e = typeof q === 'string' ? document.querySelector(q) : q; if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width && r.height && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const P = GHUD._S.P || {}, box = (a) => a && { l: a.x, t: a.y, r: a.x + a.w, b: a.y + a.h }, B = Combat.S.rwrBox;
  const hud = {
    fire: rect('#btn-fire'), smoke: rect('#btn-cm'), chip: rect('#btn-weapon'), sight: rect('#btn-sight'), mg: rect('#btn-mg'), lock: rect('#btn-lock'), range: rect('#btn-range'),
    shells: rect('#ammo-stack'), map: rect('#gmap'), stage: rect('#btn-stage'), throttle: rect('#flight-ui .throttle-box'), diagram: box(P.diag), scope: P.scope && { l: P.scope.x - P.scope.R, t: P.scope.y - P.scope.R, r: P.scope.x + P.scope.R, b: P.scope.y + P.scope.R + 14 },
    rwr: B && Combat.S.rwr > 1 ? { l: B.x - B.R, t: B.y - B.R, r: B.x + B.R, b: B.y + B.R + 14 } : null,
    feed: document.querySelector('#mp-feed').children.length ? rect('#mp-feed') : null,
  };
  const M = MP.live && MPUI.scope;
  // the hint: its words, not the strip it sits in
  const hint = document.querySelector('#hint'), ht = hint && !hint.hidden && hint.querySelector('#hint-text');
  const panels = {
    telemetry: rect('#flight-ui .telemetry'), controls: rect('#flight-ui .left-controls'), bar: rect('#mp-bar'), topRight: rect('#flight-ui .flight-top-right'),
    hint: ht ? rect(ht.textContent ? hint : null) : null, brake: rect('#btn-brake'), roomScope: M ? { l: M.x - M.R, t: M.y - M.R, r: M.x + M.R, b: M.y + M.R } : null,
  };
  const f = hud.fire, mid = f && document.elementFromPoint((f.l + f.r) / 2, (f.t + f.b) / 2);
  return { W: innerWidth, H: innerHeight, hud, panels, ground: document.body.classList.contains('ground'), aim: Flight.groundAim, sight: Flight.sight, fireMid: !!mid && mid.closest('button') === document.querySelector('#btn-fire') };
};
const meets = (a, c) => !!a && !!c && a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
function judge(tag, L, need) {
  const clash = [], off = [], H = Object.entries(L.hud), missing = need.filter((k) => !L.hud[k]);
  for (let i = 0; i < H.length; i++) {
    const [k, a] = H[i];
    if (!a) continue;
    if (a.l < 0 || a.t < 0 || a.r > L.W || a.b > L.H) off.push(k);
    for (let j = i + 1; j < H.length; j++) if (meets(a, H[j][1])) clash.push(`${k}/${H[j][0]}`);
    for (const [p, c] of Object.entries(L.panels)) if (meets(a, c)) clash.push(`${k}/${p}`);
  }
  ok(`${tag} (${L.W}×${L.H}): the ground HUD clear of itself and the panels, on the screen`, L.ground && L.aim && !clash.length && !off.length && !missing.length && L.fireMid,
    JSON.stringify({ clash, off, missing, fireMid: L.fireMid, hud: L.hud, panels: L.panels }));
}
const NEED = ['fire', 'smoke', 'chip', 'sight', 'mg', 'lock', 'range', 'shells', 'map', 'diagram', 'scope'];

// ---- 1. the layout, on four screens; the HUD's cost a frame and its DOM writes on the phone
const SIZES = [['phone portrait', [390, 844, true]], ['small phone', [375, 667, true]], ['phone on its side', [844, 390, true]], ['desktop', [1280, 720, false]]];
for (const [tag, vp] of SIZES) {
  const { ctx, page } = await open(vp, { hints: true, aimMode: 'realistic' }, tag + ' ');
  await fly(page, 'Kit', KIT);
  await page.waitForTimeout(1300); // (the places are looked up once a second)
  const L = await page.evaluate(layout);
  judge(tag, L, NEED);
  await shot(page, `hud-${vp[0]}x${vp[1]}`);
  if (tag === 'phone portrait') {
    // the HUD's 2D-context calls a frame (aiming on, the diagram, the radar scope, the range): at most 120
    await page.evaluate(() => { Render3D.skipDraw = true; window.__ops.length = 0; });
    await page.waitForFunction(() => window.__ops.length >= 30, null, { timeout: 30000 }).catch(() => {});
    const ops = await page.evaluate(() => window.__ops.slice());
    const mx = Math.max(...ops), avg = ops.reduce((s, x) => s + x, 0) / Math.max(ops.length, 1);
    ok('the HUD: at most 120 2D-context calls a frame', ops.length >= 30 && mx <= 120, `${ops.length} frames: max ${mx}, mean ${avg.toFixed(1)}`);
    // nothing of the ground HUD's DOM written while nothing changes (the tank still, the aim held)
    const muts = await page.evaluate(async () => {
      const recs = [], o = new MutationObserver((l) => { for (const r of l) recs.push(`${r.target.id || r.target.className || r.target.nodeName} ${r.type} ${r.attributeName || ''}`); });
      for (const q of ['#ammo-stack', '#btn-sight', '#btn-mg', '#btn-lock', '#btn-range', '#gmap', '#gtac', '#row-crew']) { const e = document.querySelector(q); if (e) o.observe(e, { attributes: true, childList: true, subtree: true, characterData: true }); }
      const cm = document.querySelector('#btn-cm'); o.observe(cm, { childList: true, characterData: true, subtree: true, attributeFilter: ['title'] });
      const bodyRec = [], ob = new MutationObserver((l) => { for (const r of l) bodyRec.push(r.attributeName); }); ob.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
      const t0 = performance.now();
      let frames = 0; const tick = () => { frames++; if (frames < 40 && performance.now() - t0 < 20000) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      await new Promise((r) => { const w = () => (frames >= 40 || performance.now() - t0 > 20000 ? r() : setTimeout(w, 100)); setTimeout(w, 2000); });
      o.disconnect(); ob.disconnect();
      return { recs, body: bodyRec, frames };
    });
    ok('the HUD: none of its DOM written over 40 frames (2 s or more) while nothing changes', !muts.recs.length && !muts.body.length && muts.frames >= 40, JSON.stringify({ frames: muts.frames, recs: muts.recs.slice(0, 8), body: muts.body.slice(0, 8) }));
    await page.evaluate(() => { Render3D.skipDraw = false; });
    // the sight, on a phone
    await page.evaluate(() => Flight.setSight(true, 3));
    await page.waitForTimeout(700);
    judge('phone portrait, in the sight', await page.evaluate(layout), ['fire', 'sight', 'shells', 'range']);
    await shot(page, 'sight-390x844');
    await page.evaluate(() => Flight.setSight(false));
    // the tactical map
    await page.evaluate(() => GHUD.tactical(true));
    await page.waitForTimeout(600);
    const tac = await page.evaluate(() => ({ open: GHUD.tacOpen, shown: !document.querySelector('#gtac').hidden }));
    ok('the tactical map opens (M, or a tap on the minimap) and shuts', tac.open && tac.shown, tac);
    await shot(page, 'tactical-390x844');
    await page.evaluate(() => GHUD.tactical(false));
  }
  if (tag === 'desktop') { // (a mouse: the first click asks for the pointer)
    await page.evaluate(() => Flight.setSight(true, 6));
    await page.waitForTimeout(700);
    await shot(page, 'sight-1280x720');
    await page.evaluate(() => Flight.setSight(false));
  }
  // a stage left and thrust aboard: the Stage pill and the throttle find room too, and FIRE stays FIRE
  await fly(page, 'Rocket Kit', ROCKET);
  await page.waitForTimeout(1300);
  const LR = await page.evaluate(layout);
  judge(`${tag}, a stage left and thrust aboard`, LR, [...NEED, 'stage', 'throttle']);
  await shot(page, `hud-stage-${vp[0]}x${vp[1]}`);
  await pageErrors(page, tag + ' ');
  await ctx.close();
}

// ---- 2. in a room, on a phone on its side and upright (the room's bar at the top, the kill feed showing)
for (const [tag, vp] of [['in a room, on its side', [844, 390]], ['in a room, upright', [390, 844]]]) {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: true, isMobile: true }), A = await ctx.newPage(), B = await ctx.newPage();
  watch(A, errs, tag + ' A '); watch(B, errs, tag + ' B ');
  await openGame(A, srv.url, {});
  await B.goto(srv.url + 'index.html'); await B.waitForTimeout(300);
  if (await B.isVisible('[data-mode="sandbox"]')) await B.click('[data-mode="sandbox"]');
  await A.evaluate(instrument);
  await A.click('#home-mp'); await A.fill('#mp-name', 'Alice'); await A.dispatchEvent('#mp-name', 'change'); await A.click('[data-tr="local"]'); await A.click('#mp-create-sandbox');
  await A.waitForFunction(() => MP.live && Net.code, null, { timeout: 10000 });
  const code = await A.evaluate(() => Net.code);
  await B.click('#home-mp'); await B.fill('#mp-name', 'Bob'); await B.dispatchEvent('#mp-name', 'change'); await B.click('[data-tr="local"]'); await B.fill('#mp-join-code', code); await B.click('#mp-join');
  await B.waitForFunction(() => MP.live && MP.me, null, { timeout: 10000 });
  await A.waitForFunction(() => Render3D.ready && Terrain.earthMap.state !== 'loading', null, { timeout: 120000 });
  await A.evaluate((rows) => { Builder.loadDesign({ name: 'Kit', kind: 'tank', parts: rows }); App.launch(); }, KIT);
  await B.evaluate((rows) => { Builder.loadDesign({ name: 'TK', kind: 'tank', parts: rows }); App.launch(); }, T.tk34);
  await A.waitForFunction(() => Flight.running && Flight.mp && Flight.active && Render3D.ready, null, { timeout: 60000 });
  await A.bringToFront();
  await A.waitForTimeout(1200);
  await A.evaluate(() => { MPUI.notice('Bob joined the room'); MPUI.notice('Bob: hello'); });
  await A.waitForTimeout(1500); // (the places are looked up again: the room's scope came with its first frame)
  const L = await A.evaluate(layout);
  judge(tag, L, [...NEED.filter((k) => k !== 'range'), 'feed']); // (the zero pill: Realistic aim is the room's setting, Arcade here)
  ok(`${tag}: the room's bar is up`, !!L.panels.bar, L.panels);
  await shot(A, `hud-room-${vp[0]}x${vp[1]}`);
  await pageErrors(A, tag + ' A ');
  await ctx.close();
}

// ---- 3. what shows: an unarmed Armour design, Brake on tracks, SMOKE with smoke launchers alone
{
  const { ctx, page } = await open([390, 844, true], {}, 'shows ');
  await fly(page, 'Bare', BARE);
  const s = await page.evaluate(() => ({ ground: document.body.classList.contains('ground'), aim: Flight.groundAim, sas: getComputedStyle(document.querySelector('#sas-bar')).display, brake: !document.querySelector('#btn-brake').hidden && document.querySelector('#btn-brake').getBoundingClientRect().width > 0 }));
  ok('an unarmed Armour design: ground controls (no autopilot), no aiming', s.ground && !s.aim && s.sas === 'none', s);
  ok('Brake shows on a tracked vehicle', s.brake, s);
  // its menu lists the keys it has (the old ones: M the map, C the camera), not the aiming ones it lacks
  const hl = await page.evaluate(() => { const d = el('div'); d.innerHTML = Flight.controlsHelp(); return [...d.querySelectorAll('.help-grid > div')].map((q) => q.textContent.replace(/\s+/g, ' ').trim()); });
  const says = (re) => hl.some((t) => re.test(t));
  ok('an unarmed Armour design\'s menu lists its keys: drive, the map, the camera; no aiming, machine guns, tactical map or look round', says(/Drive forward/) && says(/^M ?Map view/) && says(/Reset the camera/) && !says(/capture the mouse|Machine guns|Tactical map|look round/), hl);
  await fly(page, 'Smoky', SMOKY);
  const m = await page.evaluate(() => { const c = document.querySelector('#btn-cm'), r = c.getBoundingClientRect(); return { shown: !c.hidden && r.width > 0 && !document.querySelector('#weapon-box').hidden, text: c.textContent.trim(), fire: !document.querySelector('#btn-fire').hidden }; });
  ok('SMOKE shows with smoke launchers alone', m.shown && /smoke/i.test(m.text), m);
  await pageErrors(page, 'shows ');
  await ctx.close();
}

// ---- 4. a mouse (desktop): the zero, pointer lock, drag aiming without it, Esc, the sight's projection, the reload ring
{
  const { ctx, page } = await open([1280, 720, false], { aimMode: 'realistic' }, 'mouse ');
  await fly(page, 'MA', T.ma1);
  // R doesn't set the zero; Y does (Realistic aim, a rangefinder aboard)
  await page.evaluate(() => { Flight.zero = 800; Flight.aimPitch = -0.02; });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyR');
  const z1 = await page.evaluate(() => Flight.zero);
  await page.keyboard.press('KeyY');
  const z2 = await page.evaluate(() => ({ zero: Flight.zero, d: Math.round(Math.hypot(Flight.aim.P.x - Flight.active.x, Flight.aim.P.y - Flight.active.y, Flight.aim.P.z - Flight.active.z)) }));
  ok('R leaves the sight\'s zero alone; Y sets it to the rangefinder\'s range', z1 === 800 && z2.zero !== 800 && Math.abs(z2.zero - Math.min(3000, Math.max(200, Math.round(z2.d / 50) * 50))) <= 50, { afterR: z1, afterY: z2 });

  // a stand-in pointer lock (headless Chromium has none): requestPointerLock takes it, the browser's own release is __drop()
  await page.evaluate(() => {
    const c = Flight.canvas; window.__pl = null; window.__refuse = false;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => window.__pl });
    c.requestPointerLock = () => { if (window.__refuse) return; window.__pl = c; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
    document.exitPointerLock = () => { if (!window.__pl) return; window.__pl = null; setTimeout(() => document.dispatchEvent(new Event('pointerlockchange'))); };
    window.__drop = () => { window.__pl = null; document.dispatchEvent(new Event('pointerlockchange')); };
    window.__used = 0; window.__taps = 0; window.__menus = 0;
    const u = Flight.usePart, t = Flight.tapAt, m = UI.modal;
    Flight.usePart = function (...a) { window.__used++; return u.apply(this, a); };
    Flight.tapAt = function (...a) { window.__taps++; return t.apply(this, a); };
    UI.modal = function (o, ...a) { if (o && o.title === 'Paused') window.__menus++; return m.call(this, o, ...a); };
  });
  const W = 1280, H = 720, mid = [W / 2, H * 0.62]; // (on the tank)
  const top = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e === Flight.canvas || e.tagName === 'CANVAS'); }, mid);
  ok('the middle of the view is the canvas (for the clicks below)', top);
  // the first click takes the pointer and doesn't fire or use a part; clicks under the lock fire, never use a part
  await page.mouse.move(mid[0], mid[1]); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(100);
  const locked = await page.evaluate(() => { window.__taps = 0; return Flight._locked === true && document.pointerLockElement === Flight.canvas; });
  for (let i = 0; i < 3; i++) { await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up(); await page.waitForTimeout(60); }
  const u = await page.evaluate(() => ({ used: window.__used, taps: window.__taps, fire: Flight.mouseFire }));
  ok('a click under pointer lock never uses a part', locked && u.used === 0 && u.taps === 0 && !u.fire, { locked, ...u });
  // the mouse's own movement aims under the lock
  const y0 = await page.evaluate(() => Flight.aimYaw);
  await page.evaluate(() => { Flight.canvas.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true, clientX: 640, clientY: 400, movementX: 120 })); });
  const y1 = await page.evaluate(() => Flight.aimYaw);
  ok('under the lock the mouse\'s movement aims', y1 < y0 - 0.1, { before: y0, after: y1 });
  // Esc: the browser lets the lock go, then (maybe) the key comes: the menu opens once and stays open
  await page.evaluate(() => window.__drop());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const e1 = await page.evaluate(() => ({ menus: window.__menus, open: UI.modalOpen, paused: Flight.paused }));
  await shot(page, 'menu-1280x720');
  await page.evaluate(() => UI.closeModal());
  await page.waitForTimeout(500);
  // the key first (the lock still held): one menu, and the release that follows says nothing more
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(100); // (the lock again)
  const relock = await page.evaluate(() => Flight._locked);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const e2 = await page.evaluate(() => ({ menus: window.__menus, open: UI.modalOpen, locked: Flight._locked }));
  ok('Esc under pointer lock opens the menu once (the lock let go first, or the key first)', e1.menus === 1 && e1.open && relock && e2.menus === 2 && e2.open && !e2.locked, { e1, relock, e2 });
  await page.evaluate(() => UI.closeModal());
  await page.waitForTimeout(300);
  // the lock refused: a left drag aims
  await page.evaluate(() => { window.__refuse = true; });
  const d0 = await page.evaluate(() => Flight.aimYaw);
  await page.mouse.move(mid[0], mid[1]); await page.mouse.down(); await page.mouse.move(mid[0] + 100, mid[1], { steps: 8 }); await page.mouse.up();
  const d1 = await page.evaluate(() => ({ yaw: Flight.aimYaw, locked: Flight._locked, used: window.__used }));
  ok('without pointer lock a mouse drag aims (and uses no part)', !d1.locked && d1.yaw < d0 - 0.15 && d1.used === 0, { before: d0, after: d1 });
  // ...and holding the sight first (right), then dragging with the left (it comes chorded, as a move), aims as well
  const wrapD = (a, c) => Math.atan2(Math.sin(a - c), Math.cos(a - c));
  const c0 = await page.evaluate(() => Flight.aimYaw);
  await page.mouse.move(mid[0], mid[1]); await page.mouse.down({ button: 'right' }); await page.mouse.down({ button: 'left' });
  await page.mouse.move(mid[0] + 100, mid[1], { steps: 8 }); await page.mouse.up({ button: 'left' }); await page.mouse.up({ button: 'right' });
  const c1 = await page.evaluate(() => ({ yaw: Flight.aimYaw, sight: Flight.sight, used: window.__used }));
  ok('without pointer lock, the sight held (right) and then a left drag aims too', wrapD(c1.yaw, c0) < -0.05 && !c1.sight && c1.used === 0, { before: c0, after: c1 });

  // the lock again: the click that asks for it doesn't fire, even when the lock comes while it is held and the hand moves
  // a pixel; a click shorter than a frame under the lock (a touchpad's tap) fires once, as a V tap does
  const gunShots = () => page.evaluate(() => Flight.active.aimed.filter((p) => p.def.weapon && p.def.weapon.kind === 'tgun').reduce((n, p) => n + (p.shots || 0), 0));
  const load = () => page.evaluate(() => { const v = Flight.active; for (const p of v.aimed) if (p.def.weapon && p.def.weapon.kind === 'tgun') { p.reload = 0; if (!(p.ammo > 0)) p.ammo = 1; } v.wsel = Combat.systems(v).findIndex((q) => q.w.kind === 'tgun'); });
  const frames = (n) => page.evaluate((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  await page.evaluate(() => { window.__refuse = false; });
  await load(); let g0 = await gunShots();
  await page.mouse.move(mid[0], mid[1]); await page.mouse.down(); await page.waitForTimeout(80);
  const capLocked = await page.evaluate(() => Flight._locked);
  await page.mouse.move(mid[0] + 2, mid[1] + 1); await frames(4); await page.mouse.up(); await frames(3);
  const capShots = (await gunShots()) - g0;
  await load(); g0 = await gunShots();
  await page.evaluate(() => { const c = Flight.canvas; c.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, buttons: 1, bubbles: true, pointerId: 1 })); c.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'mouse', button: 0, buttons: 0, bubbles: true, pointerId: 1 })); });
  await frames(4);
  const tapShots = (await gunShots()) - g0;
  ok('the click that captures the mouse never fires, though the hand moves while the lock comes; a click shorter than a frame under the lock fires once', capLocked && capShots === 0 && tapShots === 1, { capLocked, capShots, tapShots });

  // Shift+Tab changes weapon back and leaves the sight alone; Shift on its own toggles it
  const sb = await page.evaluate(() => ({ sight: Flight.sight, wsel: Flight.active.wsel }));
  await page.keyboard.down('ShiftLeft'); await page.keyboard.press('Tab'); await page.keyboard.up('ShiftLeft');
  const sa = await page.evaluate(() => ({ sight: Flight.sight, wsel: Flight.active.wsel }));
  await page.keyboard.press('ShiftLeft'); const sOn = await page.evaluate(() => Flight.sight);
  await page.keyboard.press('ShiftLeft'); const sOff = await page.evaluate(() => Flight.sight);
  ok('Shift+Tab changes weapon back without opening the sight; Shift alone toggles it', !sb.sight && !sa.sight && sa.wsel !== sb.wsel && sOn && !sOff, { sb, sa, sOn, sOff });
  // C held (looking round) when the window loses focus (alt-tab: its keyup goes elsewhere): free look ends
  await page.keyboard.down('KeyC'); await page.waitForTimeout(100);
  const fl = await page.evaluate(() => { const was = Flight.freeLook; dispatchEvent(new Event('blur')); return { was, after: Flight.freeLook }; });
  await page.keyboard.up('KeyC');
  ok('C held when the window loses focus: free look ends, the guns follow the aim again', fl.was && !fl.after, fl);

  // the wheel in the sight: zoom steps, a touchpad's small and sideways events counted as travel; under the lock the
  // pointer has no place, so it never moves the sight's range (PgUp / PgDn do, Realistic aim)
  await page.mouse.click(mid[0], mid[1]); await page.waitForTimeout(100); // (the lock, if a test above let it go)
  const wl = await page.evaluate(() => {
    const w = (dx, dy, x, n = 1) => { for (let i = 0; i < n; i++) Flight.canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, deltaMode: 0, clientX: x, clientY: 300, bubbles: true, cancelable: true })); return { zoom: Flight.zoom, zero: Flight.zero }; };
    Flight.zero = 800; Flight.setSight(true, 3);
    const o = { locked: Flight._locked, pad: w(0, -4, 640, 12) };
    Flight.setSight(true, 6); o.side = w(30, 0, 640);
    Flight.setSight(true, 3); o.edge = w(0, -100, innerWidth - 10);
    return o;
  });
  await page.keyboard.press('PageUp'); const zUp = await page.evaluate(() => Flight.zero);
  await page.keyboard.press('PageDown'); await page.keyboard.press('PageDown'); const zDn = await page.evaluate(() => Flight.zero);
  await page.evaluate(() => Flight.setSight(false));
  ok('the sight\'s wheel: half a notch of touchpad one zoom step, a sideways swipe none; under the lock the right edge zooms; PgUp / PgDn step its range',
    wl.locked && wl.pad.zoom === 6 && wl.side.zoom === 6 && wl.edge.zoom === 6 && wl.edge.zero === 800 && zUp === 900 && zDn === 700, { ...wl, zUp, zDn });
  // the aim camera: scrolled out far past its farthest (30 m), the first notch back brings it in
  const camD = () => page.evaluate(() => { const r = Render3D.aimRay({ o: v3(), d: v3() }), v = Flight.active; return Math.round(Math.hypot(r.o.x - v.x, r.o.y - v.y, r.o.z - v.z) * 100) / 100; });
  for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 100);
  await page.waitForTimeout(400); const far = await camD();
  await page.mouse.wheel(0, -100); await page.waitForTimeout(400); const near = await camD();
  ok('the aim camera: scrolled out past its farthest, the first notch back brings it in', far > 25 && near < far - 0.5, { far, near });
  await load(); // (the main gun chosen again, for the reload ring below)

  // the sight: 50° to 50/zoom and back, a point 5 m beside the aim 400 m out measured by project() and metresPerPixelAt
  const probe = () => {
    const r = Render3D.aimRay(), v = Flight.active, bp = bodyPos(v.body, Flight.time), bx = bp.x, by = bp.y, d = r.d, o = r.o;
    const rr = Math.hypot(v.x, v.y, v.z), ux = v.x / rr, uy = v.y / rr, uz = v.z / rr;
    let sx = d.y * uz - d.z * uy, sy = d.z * ux - d.x * uz, sz = d.x * uy - d.y * ux; const sl = Math.hypot(sx, sy, sz); sx /= sl; sy /= sl; sz /= sl;
    const q0 = [o.x + d.x * 400, o.y + d.y * 400, o.z + d.z * 400], q1 = [q0[0] + sx * 5, q0[1] + sy * 5, q0[2] + sz * 5];
    const a = Render3D.project(bx + q0[0], by + q0[1], q0[2]), c = Render3D.project(bx + q1[0], by + q1[1], q1[2]), m = Render3D.metresPerPixelAt(bx + q0[0], by + q0[1], q0[2]);
    const px = Math.hypot(c.x - a.x, c.y - a.y);
    return { off: Math.hypot(a.x - innerWidth / 2, a.y - innerHeight / 2), px, m, metres: px * m, fov: (2 * Math.atan((m * innerHeight) / 800) * 180) / Math.PI, sightOn: Render3D.sightOn };
  };
  const p0 = await page.evaluate(probe);
  await page.evaluate(() => Flight.setSight(true, 3)); await page.waitForTimeout(400);
  const p1 = await page.evaluate(probe);
  await page.evaluate(() => Flight.setSight(true, 8)); await page.waitForTimeout(400);
  const p2 = await page.evaluate(probe);
  await page.evaluate(() => Flight.setSight(false)); await page.waitForTimeout(400);
  const p3 = await page.evaluate(probe);
  const good = (p, fov) => p.off < 2 && Math.abs(p.metres - 5) < 0.1 && Math.abs(p.fov - fov) < 0.2;
  ok('the sight narrows the view to 50/zoom degrees and back; markers (project) and metresPerPixelAt agree', good(p0, 50) && good(p1, 50 / 3) && good(p2, 50 / 8) && good(p3, 50) && p1.sightOn && !p3.sightOn && p1.px > p0.px * 2.8,
    JSON.stringify({ p0, p1, p2, p3 }));

  // the reload ring: fire the main gun; while it reloads an arc goes round FIRE
  await page.evaluate(() => { Flight.fireTap = true; });
  await page.waitForFunction(() => { const st = Aim.status(Flight.active); if (st && st.reload >= 1 && !Flight.fireTap) Flight.fireTap = true; return st && st.reload < 1; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400); // (a frame or two drawn since)
  const ring = await page.evaluate(() => { const f = GHUD._S.P && GHUD._S.P.fire, st = Aim.status(Flight.active); return { f, reload: st && st.reload, paused: Flight.paused, modal: UI.modalOpen, t: Flight.time, ammo: st && st.part && st.part.ammo, arcs: window.__arcs.slice(), hit: !!f && window.__arcs.some(([x, y, r]) => Math.abs(x - f.x) < 1.5 && Math.abs(y - f.y) < 1.5 && r > f.r) }; });
  ok('the reload ring draws round FIRE while the gun reloads', ring.reload < 1 && ring.hit, { reload: ring.reload, paused: ring.paused, modal: ring.modal, t: ring.t, ammo: ring.ammo, fire: ring.f, arcs: ring.arcs.slice(0, 6) });
  await shot(page, 'reload-1280x720');

  // Blocked when the crosshair is on the ground: a TK-34 14 m downhill of a berm's crest (Highland Ridge, the one between
  // zones A and C), looking over it up the far slope: the camera sees the ground 120 m out, the gun's round would bury
  // itself in the berm a few metres from the muzzle
  await fly(page, 'TK-34', T.tk34);
  await page.evaluate(() => { Flight.unlockPointer(); Render3D.skipDraw = true; const v = Flight.active; v.placeOnSurface(EARTH, siteAngle(EARTH, 17434), VEHICLE_KINDS.tank.launchRot, 15000, Math.PI); v.vx = v.vy = v.vz = 0; v.av = v3(0, 0, 0); Flight.aimAlong(v); });
  const aimQ = () => page.evaluate(() => {
    const F = Flight, v = F.active, R = EARTH.radius, a = siteAngle(EARTH, 17434 - 600), ph = 15000 / R, rr = R + Terrain.surfaceAt(EARTH, a, 15000) + 2.4;
    const Q = { x: rr * Math.cos(ph) * Math.cos(a), y: rr * Math.cos(ph) * Math.sin(a), z: rr * Math.sin(ph) }, o = Render3D.aimRay({ o: v3(), d: v3() }).o;
    let dx = Q.x - o.x, dy = Q.y - o.y, dz = Q.z - o.z; const d = Math.hypot(dx, dy, dz); dx /= d; dy /= d; dz /= d;
    const r = Math.hypot(v.x, v.y, v.z), ux = v.x / r, uy = v.y / r, uz = v.z / r, el = Math.hypot(ux, uy), ex = uy / el, ey = -ux / el, nx = ey * uz, ny = -ex * uz, nz = ex * uy - ey * ux;
    F.aimYaw = Math.atan2(-(dx * nx + dy * ny + dz * nz), dx * ex + dy * ey); F.aimPitch = Math.asin(dx * ux + dy * uy + dz * uz);
  });
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(300); await aimQ(); }
  await page.waitForTimeout(300);
  const bk = await page.evaluate(() => {
    const F = Flight, v = F.active;
    for (let i = 0; i < 2400; i++) { Aim.step(v, 1 / 120, F); if (i > 60 && Aim.status(v).err < 0.0002) break; } // (the turret round, the gun laid)
    GHUD._S.aimAt = -1e9; const t0 = performance.now(); GHUD.aimUpdate(F); const ms = performance.now() - t0;
    return { src: F.aim.src, d: Math.round(F.aim.d), blk: Math.round(F.aim.blk * 10) / 10, err: Aim.status(v).err, ms: Math.round(ms * 1000) / 1000 };
  });
  ok('the crosshair on the ground beyond a berm right in front of the gun (the camera sees past its crest): the reticle says Blocked', bk.src === 'ground' && bk.d > 60 && bk.blk > 0 && bk.blk < 30, bk);
  await page.evaluate(() => { Render3D.skipDraw = false; });
  await pageErrors(page, 'mouse ');
  await ctx.close();
}

// ---- 5. a finger: a drag on the view aims; a slide on FIRE aims and turns the turret
{
  const { ctx, page } = await open([390, 844, true], {}, 'touch ');
  await fly(page, 'TK-34', T.tk34);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  const drag = async (x, y, dx, dy, steps = 8) => { await touch('touchStart', x, y); for (let i = 1; i <= steps; i++) { await touch('touchMove', x + (dx * i) / steps, y + (dy * i) / steps); await page.waitForTimeout(16); } await touch('touchEnd'); };
  const gun = () => { const v = Flight.active, p = v.aimed.find((q) => q.def.weapon && q.def.weapon.kind === 'tgun'), d = Aim.dir(v, p, { x: 0, y: 0, z: 0 }); return { yaw: Flight.aimYaw, pitch: Flight.aimPitch, d: [d.x, d.y, d.z] }; };
  const ang = (a, c) => (Math.acos(Math.max(-1, Math.min(1, a[0] * c[0] + a[1] * c[1] + a[2] * c[2]))) * 180) / Math.PI;
  const v0 = await page.evaluate(gun);
  await drag(195, 300, 60, 0);
  await page.waitForTimeout(100);
  const v1 = await page.evaluate(gun);
  ok('a drag on the view aims (right turns the aim right)', v1.yaw < v0.yaw - 0.2, { before: v0.yaw, after: v1.yaw });
  await page.waitForTimeout(2500); // (the turret follows the aim)
  const v2 = await page.evaluate(gun);
  const fire = await page.evaluate(() => { const r = document.querySelector('#btn-fire').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await drag(fire[0], fire[1], -50, 0, 10);
  await page.waitForTimeout(100);
  const v3 = await page.evaluate(gun);
  await page.waitForTimeout(2500);
  const v4 = await page.evaluate(gun);
  ok('a slide on FIRE aims, and the turret turns after it', v3.yaw > v2.yaw + 0.15 && ang(v2.d, v4.d) > 5 && ang(v0.d, v2.d) > 5, { view: [v0.yaw, v2.yaw, ang(v0.d, v2.d)], fire: [v2.yaw, v3.yaw, v4.yaw, ang(v2.d, v4.d)] });
  // the shell chips: a quick tap queues the round, even when a frame stalls 650 ms between the finger going down and
  // coming up (the long press goes by the events' times, not by when the handlers run); held 0.7 s, it loads now
  const chipAt = (i) => page.evaluate((i) => { const r = document.querySelectorAll('#ammo-stack .ammo-chip')[i].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, i);
  const shells = () => page.evaluate(() => { const s = Aim.status(Flight.active); return { sel: s.sel, queued: s.queued, ready: s.ready, toast: [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | ') }; });
  await page.waitForFunction(() => Aim.status(Flight.active).ready, null, { timeout: 60000 });
  await page.evaluate(() => { window.__stall = 1; $('#ammo-stack').addEventListener('pointerdown', () => { if (window.__stall) { window.__stall = 0; requestAnimationFrame(() => { const t = performance.now(); while (performance.now() - t < 650); }); } }, true); });
  const c1 = await chipAt(1), q0 = await shells();
  await touch('touchStart', ...c1); await page.waitForTimeout(40); await touch('touchEnd');
  await page.waitForTimeout(1000);
  const q1 = await shells();
  await touch('touchStart', ...c1); await page.waitForTimeout(700); await touch('touchEnd');
  await page.waitForTimeout(300);
  const q2 = await shells();
  ok('a quick tap on a shell chip queues it, a frame stalling meanwhile or not; held 0.7 s, it loads now', q1.queued === 1 && q1.sel === q0.sel && q1.ready && q2.sel === 1 && !q2.ready && /Loading it now/.test(q2.toast), { q0, q1, q2 });
  // a finger's targets and words: the chips and the tactical map's Close 40 px tall, Close without a key; a tap off the
  // map shuts it; the menu's controls lead with the touch row; Settings has no mouse speed on a phone
  await page.evaluate(() => GHUD.tactical(true));
  await page.waitForTimeout(400);
  const fz = await page.evaluate(() => { const h = (q) => Math.round(document.querySelector(q).getBoundingClientRect().height); return { chip: h('#ammo-stack .ammo-chip'), close: h('#gtac-close'), text: $('#gtac-close').textContent.trim(), open: GHUD.tacOpen }; });
  await touch('touchStart', 195, 60); await page.waitForTimeout(40); await touch('touchEnd'); // (the dark margin above the map)
  await page.waitForTimeout(300);
  const shut = await page.evaluate(() => !GHUD.tacOpen);
  const words = await page.evaluate(() => {
    const d = el('div'); d.innerHTML = Flight.controlsHelp(); App.showSettings(); const s = $('#modal-card').textContent; UI.closeModal();
    const L = el('div', { class: 'mp-set' }, el('div', { class: 'kind-select n2' }, el('button', { class: 'kind-btn', text: 'Ground' }))); document.body.append(L); // (a ground lobby's choice)
    const lobby = Math.round(L.querySelector('button').getBoundingClientRect().height); L.remove();
    return { first: d.querySelector('.help-grid > div').textContent.slice(0, 40), mouse: /Mouse aim speed/.test(s), aim: /Ground aim/.test(s), lobby };
  });
  ok('a finger\'s targets and words: chips, Close and the lobby\'s choices 40 px tall, "Close" with no key, a tap off the map shuts it, the touch row first, no mouse speed',
    fz.open && fz.chip >= 40 && fz.close >= 40 && words.lobby >= 40 && fz.text === 'Close' && shut && /^Touch/.test(words.first) && !words.mouse && words.aim, { fz, shut, words });
  await page.evaluate(() => { Render3D.skipDraw = false; });
  await shot(page, 'aimed-390x844');
  await pageErrors(page, 'touch ');
  await ctx.close();
}

ok('no page errors (console clean, nothing swallowed by App.frame)', !errs.length, errs.slice(0, 10).join('\n'));
await b.close(); srv.close();
ok.done();
