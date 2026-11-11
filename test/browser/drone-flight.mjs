// A drone in flight (the big update, spec-drones §8, §14, §19.4): a Bumble FPV flown alone from the helipad on phones
// (360×640, 390×844, 844×390) and desktops (1280×720, 1920×1080):
//  - it starts in first person (FPV), its own mesh hidden, at the camera's field of view; H and the pad's eye swap to the
//    chase view and back; the choice is kept for the next drone;
//  - the on-screen display (drone.js): its status block, mode and flight line on the screen and clear of every control
//    and panel (the buttons top right, the mode pad, the stick and its zone, the throttle box, the weapon box, the alert
//    line, the JAM chip), and of a warning receiver's scope when one is drawn; at most 40 canvas calls a frame; static only
//    while the link is weak (q under 0.6);
//  - the climb lever: a drag up climbs, let go it springs back and holds the height; ▲ held climbs; Level ignores Full and
//    Cut; Acro (2) makes the box the throttle again and Z full works; 1 back to Level; the mode pad's buttons and pressed
//    states; the keys' hints, the help and the manual from the bindings (73 rows, the Drones group);
//  - a gimbal camera (a Mavik Scout): the wheel zooms 1×, 4×, 12× (60°, 15°, 5°), C held and the mouse look round, a tap of
//    C centres it, J toggles thermal (and opens no chat); the impact view (any key ends it);
//  - an old plane's HUD shows none of it (no drone buttons, no drone classes). No console errors.
// Times on Flight.time (headless Chromium runs the sim at about 0.08× real time). SHOTS=<dir> saves screenshots there
// (drone-*.png; default test/.cache/shots).
//   node test/browser/drone-flight.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || path.join(ROOT, 'test', '.cache', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => page.screenshot({ path: path.join(SHOTS, `drone-${name}.png`) });
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('drone flight: FPV and chase, the OSD, the climb lever, the mode pad, the keys, the gimbal');

// the stock drones' rows (spec §18), until their templates come: the Bumble FPV and the Mavik Scout (a gimbal camera)
const ROWS = {
  bumble: [['drFrameS', 0, 0], ['drFC', 0, 0.0375, 0, { att: 0 }], ['drCam', 0.155, 0.0425, 0, { att: 0 }], ['drLink', -0.1, 0.0325, 0, { att: 0 }],
    ['drMotorS', 0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', 0.15, 0.0475, 0, { z: -0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: -0.15, att: 0 }],
    ['drBattS', -0.03, -0.0425, 0, { att: 0 }], ['drCharge', 0.06, -0.1125, 3, { att: 8 }]],
  mavik: [['drFrameM', 0, 0], ['drFCgps', 0, 0.05, 0, { att: 0 }], ['drGimbal', 0.2, -0.075, 0, { att: 0 }], ['drLinkL', -0.12, 0.075, 0, { att: 0 }],
    ['drMotorM', 0.2, 0.06, 0, { z: 0.2, att: 0 }], ['drMotorM', 0.2, 0.06, 0, { z: -0.2, att: 0 }], ['drMotorM', -0.2, 0.06, 0, { z: 0.2, att: 0 }], ['drMotorM', -0.2, 0.06, 0, { z: -0.2, att: 0 }],
    ['drBattM', -0.04, -0.055, 0, { att: 0 }], ['drLegs', 0, -0.085, 0, { att: 0 }]],
};
const instrument = () => {
  window.__errs = [];
  addEventListener('error', (e) => window.__errs.push('onerror ' + e.message));
  for (const [o, k, n] of [[Flight, 'update', 'Flight.update'], [Render3D, 'renderFlight', 'Render3D.renderFlight'], [Drone, 'drawOSD', 'Drone.drawOSD']]) {
    const f = o[k]; o[k] = function (...a) { try { return f.apply(this, a); } catch (e) { window.__errs.push(`${n}: ${e && e.stack}`); throw e; } };
  }
};
async function open(vp, tag, settings = {}) {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: vp[2], isMobile: vp[2] }), page = await ctx.newPage();
  watch(page, errs, tag);
  await openGame(page, srv.url, settings);
  await page.evaluate(instrument);
  return { ctx, page };
}
// a drone from its rows, off the helipad (a key: the stock template's, once there is one), climbed to 20 m on the lever
async function fly(page, key, climb = true) {
  await page.waitForFunction(() => Terrain.earthMap.state !== 'loading', null, { timeout: 120000 });
  await page.evaluate(async ([key, rows]) => {
    await Render3D.load();
    const T = typeof TEMPLATES !== 'undefined' && TEMPLATES[key] && TEMPLATES[key].kind === 'drone' ? TEMPLATES[key] : null;
    const parts = T ? templateRows(T) : rows.map((r) => ({ type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: r[1] < 0, ...(r[4] || {}) }));
    store.set('rss.flight', null); App.showScene('flight');
    Flight.start({ name: T ? T.name : key, kind: 'drone', parts });
  }, [key, ROWS[key]]);
  await page.waitForFunction(() => Flight.running && Render3D.ready, null, { timeout: 60000 });
  if (climb) {
    const t0 = await page.evaluate(() => { Flight.droneLift = 1; return Flight.time; });
    await page.waitForFunction((t0) => Flight.time > t0 + 2.6, t0, { timeout: 120000 });
    await page.evaluate(() => { Flight.droneLift = 0; });
  }
  await frames(page, 3);
}
const frames = (page, n) => page.evaluate((n) => new Promise((ok) => { let i = 0; const f = () => (++i >= n ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const pageErrors = async (page, tag) => { const e = await page.evaluate(() => window.__errs); if (e.length) errs.push(...e.map((x) => tag + x)); };
// where the OSD's blocks went (screen px), and every control and panel on show
const layout = () => {
  const r = (q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
  const P = Drone._osd.last, box = (p) => p && { l: p.x, t: p.y, r: p.x + p.w, b: p.y + p.h };
  const rb = Combat.S.rwrBox;
  return { W: innerWidth, H: innerHeight, osd: P && { status: box(P.s), mode: box(P.m), line: box(P.f) },
    rwr: rb && { l: rb.x - rb.R, r: rb.x + rb.R, t: rb.y - rb.R, b: rb.y + rb.R + (rb.lines === 2 ? 28 : 14) },
    ctl: { top: r('#flight-ui .flight-top-right'), pad: r('#sas-bar'), joy: r('#joy'), zone: r('#joy-zone'), thr: r('#flight-ui .throttle-box'), weap: r('#weapon-box'),
      alert: r('#flight-alert'), jam: r('#jam-chip'), warp: r('#warp'), keys: r('#key-hints'), roll: r('#flight-ui .roll-btns') } };
};
const meets = (a, c) => !!a && !!c && a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
function judge(tag, L) {
  const clash = [], off = [];
  for (const [k, a] of Object.entries(L.osd || {})) {
    if (!a) { off.push(k + ' missing'); continue; }
    if (a.l < 0 || a.t < 0 || a.r > L.W || a.b > L.H) off.push(k);
    for (const [c, q] of Object.entries(L.ctl)) if (meets(a, q)) clash.push(`${k}/${c}`);
    if (L.rwr && meets(a, L.rwr)) clash.push(`${k}/rwr`);
  }
  const o = L.osd || {};
  for (const [x, y] of [['status', 'mode'], ['status', 'line'], ['mode', 'line']]) if (meets(o[x], o[y])) clash.push(`${x}/${y}`);
  ok(`${tag} (${L.W}×${L.H}): the OSD's status, mode and flight line on the screen, clear of the controls, the panels and each other`, !clash.length && !off.length, JSON.stringify({ clash, off, osd: L.osd, ctl: L.ctl }));
}
// the OSD's canvas calls in one frame: the real drawOSD on a counting stand-in of the HUD's context
const osdCalls = () => {
  const c = App.ctx, n = { calls: 0 };
  const P = new Proxy(c, { get(t, k) { const v = t[k]; if (typeof v === 'function') return (...a) => { n.calls++; return v.apply(t, a); }; return v; }, set(t, k, v) { t[k] = v; return true; } });
  Drone.drawOSD(P, App.W, App.H, App.dpr, Flight);
  return n.calls;
};

// ================================================================ 1. FPV and the OSD on five screens
for (const [w, h, touch] of [[360, 640, true], [390, 844, true], [844, 390, true], [1280, 720, false], [1920, 1080, false]]) {
  const tag = `${w}×${h} `, { ctx, page } = await open([w, h, touch], tag);
  await fly(page, 'bumble');
  await page.waitForTimeout(1200); // (the OSD's places are looked up again once a second: now with the panels as in flight)
  await frames(page, 2);
  const st = await page.evaluate(() => {
    const v = Flight.active, m = Render3D.meshOf(v), root = m && m.group.parent;
    return { fpv: Flight.fpv, cls: document.body.className, drawn: !!Render3D.fpvCam(), cam: Drone.fov(v, Flight), hidden: root ? !root.visible : null,
      tele: getComputedStyle(document.querySelector('#flight-ui .telemetry')).display, stage: getComputedStyle(document.querySelector('#flight-ui .stage-box')).display,
      agl: v.altitude() - v.groundHeight(), label: document.querySelector('#throttle-label').textContent, tmax: document.querySelector('#btn-tmax').textContent };
  });
  ok(`${tag}a drone starts in FPV (body.fpv, its mesh hidden, the camera's ${100}°), the flight data and the stage box gone, the lever's ▲ ▼ and HOLD`,
    st.fpv && st.drawn && /\bfpv\b/.test(st.cls) && /\bdrone-level\b/.test(st.cls) && st.cam === 100 && st.hidden === true && st.tele === 'none' && st.stage === 'none' && st.agl > 5 && /^HOLD \d+ m$/.test(st.label) && st.tmax === '▲', st);
  const L = await page.evaluate(layout);
  judge(tag + 'FPV', L);
  const calls = await page.evaluate(osdCalls);
  ok(`${tag}the OSD draws in at most 40 canvas calls a frame`, calls > 0 && calls <= 40, calls);
  await shot(page, `fpv-${w}x${h}`);
  await page.evaluate(() => Flight.setFpv(false));
  await frames(page, 3); await page.waitForTimeout(400);
  const ch = await page.evaluate(() => ({ fpv: Flight.fpv, cls: document.body.className, tele: getComputedStyle(document.querySelector('#flight-ui .telemetry')).display, batt: !document.querySelector('#row-batt').hidden && document.querySelector('#t-batt').textContent, link: !document.querySelector('#row-link').hidden && document.querySelector('#t-link').textContent, view: Settings.get('droneView') }));
  ok(`${tag}the chase view: the flight data back with Battery and Link rows, the choice kept (Settings → Drone view: chase)`, !ch.fpv && !/\bfpv\b/.test(ch.cls) && ch.tele !== 'none' && /^\d+%/.test(ch.batt) && /^\d+%$/.test(ch.link) && ch.view === 'chase', ch);
  await shot(page, `chase-${w}x${h}`);
  await pageErrors(page, tag);
  await ctx.close();
}

// ================================================================ 2. the lever, the pad, the keys, static (a phone and a desktop)
{
  const tag = 'phone controls ', { ctx, page } = await open([390, 844, true], tag);
  await fly(page, 'bumble');
  // the climb lever: drag the track's top, held: climbing; let go: back to the middle, holding
  const tr = await page.evaluate(() => { const r = document.querySelector('#throttle-track').getBoundingClientRect(); return { x: r.left + r.width / 2, top: r.top, h: r.height }; });
  const sim = async (type, y) => { await page.mouse.move(tr.x, y); if (type === 'pointerdown') await page.mouse.down(); else await page.mouse.up(); };
  await sim('pointerdown', tr.top + tr.h * 0.1);
  const t0 = await page.evaluate(() => Flight.time);
  await page.waitForFunction((t0) => Flight.time > t0 + 0.6, t0, { timeout: 60000 });
  const held = await page.evaluate(() => ({ lift: Flight.droneLift, z: Flight.active.ctl.z, vs: Flight.active.vSpeed(), label: document.querySelector('#throttle-label').textContent }));
  await sim('pointerup', tr.top + tr.h * 0.1);
  const t1 = await page.evaluate(() => Flight.time);
  await page.waitForFunction((t1) => Flight.time > t1 + 2, t1, { timeout: 90000 });
  const rel = await page.evaluate(() => ({ lift: Flight.droneLift, z: Flight.active.ctl.z, vs: Flight.active.vSpeed(), label: document.querySelector('#throttle-label').textContent }));
  ok('the lever: dragged up it climbs (▲ in the label), let go it springs back to the middle and holds the height (HOLD)', held.lift > 0.8 && held.z > 0.8 && held.vs > 1 && /^▲/.test(held.label) && rel.lift === 0 && rel.z === 0 && Math.abs(rel.vs) < 1 && /^HOLD/.test(rel.label), { held, rel });
  // the middle (±5 %) holds
  await sim('pointerdown', tr.top + tr.h * 0.52);
  const mid = await page.evaluate(() => Flight.droneLift);
  await sim('pointerup', tr.top + tr.h * 0.52);
  ok('the lever\'s middle (±5%) holds: no climb', mid === 0, mid);
  // the mode pad: five buttons (no Tank: not from a bay), Level and the eye pressed; Acro presses Acro and the box is a throttle
  const pad = await page.evaluate(() => [...document.querySelectorAll('#sas-bar .sas-btn')].filter((b) => !b.hidden).map((b) => `${b.dataset.sas || b.dataset.dact}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}`).join());
  ok('the mode pad: Level*, Acro, View*, Home, Land (no Tank for a drone flown alone; nothing of the rocket\'s or the plane\'s)', pad === 'hold*,acro,view*,home,land', pad);
  await page.evaluate(() => document.querySelector('#sas-bar [data-sas="acro"]').click());
  await frames(page, 2);
  const acro = await page.evaluate(() => ({ sas: Flight.active.sas, cls: document.body.className, tmax: document.querySelector('#btn-tmax').textContent, label: document.querySelector('#throttle-label').textContent, pad: [...document.querySelectorAll('#sas-bar .sas-btn')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.sas || b.dataset.dact).join() }));
  ok('Acro: pressed on the pad, the box is the throttle again (Max, a percentage)', acro.sas === 'acro' && !/drone-level/.test(acro.cls) && acro.tmax === 'Max' && /%$/.test(acro.label) && acro.pad === 'acro,view', acro);
  await page.evaluate(() => document.querySelector('#sas-bar [data-sas="hold"]').click());
  // the eye on the pad: chase and back
  await page.evaluate(() => document.querySelector('#sas-bar [data-dact="view"]').click());
  const v1 = await page.evaluate(() => Flight.fpv);
  await page.evaluate(() => document.querySelector('#sas-bar [data-dact="view"]').click());
  const v2 = await page.evaluate(() => ({ fpv: Flight.fpv, view: Settings.get('droneView') }));
  ok('the pad\'s eye: chase, then FPV again (kept as First person)', v1 === false && v2.fpv && v2.view === 'fpv', { v1, v2 });
  // static only while the link is weak (q under 0.6), and the launch's cut
  const stat = await page.evaluate(() => {
    const v = Flight.active, run = () => { Drone.drawOSD(App.ctx, App.W, App.H, App.dpr, Flight); return Drone._osd.calls; };
    v.dl.q = 0.7; Flight.dronePulse = -1e9; const a = run(); v.dl.q = 0.3; const c = run(); v.dl.q = 1; Flight.dronePulse = Flight.time; const d = run(); Flight.dronePulse = -1e9; v.dl.q = 1;
    return { a, c, d };
  });
  ok('static: none at q 0.7, drawn at q 0.3 (and in a launch\'s 0.35 s cut)', stat.c > stat.a && stat.d > stat.a, stat);
  // the help: the drone's list from the bindings, the touch line first
  const help = await page.evaluate(() => { const h = Flight.controlsHelp(); return { touch: /class="tap">Touch/.test(h), level: /Level: fly forward/.test(h), keys: /<summary>Keys/.test(h) }; });
  ok('the menu\'s help on a drone: its own list, the touch line first and the keys folded away', help.touch && help.level && help.keys, help);
  await shot(page, 'pad-390x844');
  await pageErrors(page, tag);
  await ctx.close();
}
{
  const tag = 'desktop keys ', { ctx, page } = await open([1280, 720, false], tag);
  await fly(page, 'bumble');
  await page.click('#view3d', { position: { x: 640, y: 300 } }).catch(() => {});
  // Shift held climbs; Z (full) does nothing in Level; 2 Acro, Z full; 1 Level; H chase and back; the hints
  await page.keyboard.down('Shift');
  const t0 = await page.evaluate(() => Flight.time);
  await page.waitForFunction((t0) => Flight.time > t0 + 0.5, t0, { timeout: 60000 });
  const up = await page.evaluate(() => ({ z: Flight.active.ctl.z, vs: Flight.active.vSpeed() }));
  await page.keyboard.up('Shift');
  await frames(page, 2);
  const z0 = await page.evaluate(() => Flight.active.ctl.z);
  await page.keyboard.press('KeyZ');
  const thr = await page.evaluate(() => Flight.active.throttle);
  await page.keyboard.press('Digit2');
  await page.keyboard.press('KeyZ');
  const ac = await page.evaluate(() => ({ sas: Flight.active.sas, thr: Flight.active.throttle, hints: document.querySelector('#key-hints-list').textContent }));
  await page.keyboard.press('Digit1');
  const lv = await page.evaluate(() => ({ sas: Flight.active.sas, hints: document.querySelector('#key-hints-list').textContent }));
  ok('keys: Shift climbs (the lever up), let go it holds; Z does nothing in Level; 2 Acro (Z full throttle), 1 Level; the key hints follow (Climb, descend · Throttle)',
    up.z === 1 && up.vs > 0.5 && z0 === 0 && thr < 0.99 && ac.sas === 'acro' && ac.thr === 1 && /Throttle/.test(ac.hints) && /Full, cut/.test(ac.hints) && lv.sas === 'hold' && /Climb, descend/.test(lv.hints) && /Level, Acro/.test(lv.hints), { up, z0, thr, ac, lv });
  await page.keyboard.press('KeyH');
  const h1 = await page.evaluate(() => Flight.fpv);
  await page.keyboard.press('KeyH');
  const h2 = await page.evaluate(() => Flight.fpv);
  // J on a drone without a gimbal: a word, no chat; T in solo: nothing
  await page.keyboard.press('KeyJ');
  const j = await page.evaluate(() => ({ modal: UI.modalOpen, chat: !!document.querySelector('#mp-hud-chat:not([hidden])') }));
  ok('H swaps FPV and chase; J (the gimbal\'s thermal) on an FPV camera opens nothing', h1 === false && h2 === true && !j.modal && !j.chat, { h1, h2, j });
  // the impact view: any key ends it
  await page.evaluate(() => { const v = Flight.active; Drone.impactView(Flight, v, { x: v.x, y: v.y, z: v.z }); });
  await frames(page, 2);
  const im = await page.evaluate(() => ({ cam: !!Flight.impactCam, cls: document.body.classList.contains('impactcam') }));
  await page.keyboard.press('KeyW');
  const im2 = await page.evaluate(() => ({ cam: !!Flight.impactCam, cls: document.body.classList.contains('impactcam') }));
  ok('the impact view: the camera hangs at the blast (body.impactcam), a key ends it', im.cam && im.cls && !im2.cam && !im2.cls, { im, im2 });
  await pageErrors(page, tag);
  await ctx.close();
}

// ================================================================ 3. a gimbal camera (the Mavik Scout)
{
  const tag = 'gimbal ', { ctx, page } = await open([1280, 720, false], tag);
  await fly(page, 'mavik');
  const f0 = await page.evaluate(() => ({ fov: Drone.fov(Flight.active, Flight), on: Flight.gimbalOn() }));
  await page.mouse.move(640, 360);
  for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -120); await frames(page, 1); }
  const f1 = await page.evaluate(() => ({ zoom: Flight.gim.zoom, fov: Drone.fov(Flight.active, Flight) }));
  await page.mouse.wheel(0, 240); await frames(page, 1);
  await page.keyboard.down('KeyC');
  await page.mouse.move(700, 330, { steps: 4 });
  await page.keyboard.up('KeyC');
  const look = await page.evaluate(() => ({ yaw: Flight.gim.yaw, pitch: Flight.gim.pitch }));
  await page.keyboard.press('KeyC');
  const ctr = await page.evaluate(() => ({ yaw: Flight.gim.yaw, pitch: Flight.gim.pitch }));
  await page.keyboard.press('KeyJ');
  await frames(page, 2);
  const th = await page.evaluate(() => Flight.gim.thermal);
  ok('a gimbal: 60° at 1×, the wheel to 12× (5°) and back; C held and the mouse look round (right: yaw −, up: pitch +), a tap of C centres it; J thermal on',
    f0.on && f0.fov === 60 && f1.zoom === 2 && f1.fov === 5 && look.yaw < -0.02 && look.pitch > 0.02 && ctr.yaw === 0 && ctr.pitch === 0 && th === true, { f0, f1, look, ctr, th });
  await shot(page, 'gimbal-1280x720');
  await pageErrors(page, tag);
  await ctx.close();
}

// ================================================================ 4. a tank with a Drone Rack: the DRONE button, U in the hints and the help
for (const [w, h, touch] of [[360, 640, true], [390, 844, true], [844, 390, true], [1280, 720, false]]) {
  const tag = `rack ${w}×${h} `, { ctx, page } = await open([w, h, touch], tag);
  await page.waitForFunction(() => Terrain.earthMap.state !== 'loading', null, { timeout: 120000 });
  await page.evaluate(async () => {
    await Render3D.load(); App.toBuild(); Builder.loadTemplate('tk34'); store.set('rss.flight', null);
    const d = Builder.serialize(); d.parts.push({ type: 'dockRack', x: -1.6, y: 1.0, rot: 0, att: 0 }); // (a Drone Rack on the hull's back)
    App.showScene('flight'); Flight.start(d, { place: GroundMode.soloPlace('tank') });
  });
  await page.waitForFunction(() => Flight.running && Render3D.ready, null, { timeout: 60000 });
  await page.waitForTimeout(1500); await frames(page, 3);
  const L = await page.evaluate(() => {
    const r = (q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
    const b = document.querySelector('#btn-drone');
    return { docks: Flight.active.docks.length, btn: r('#btn-drone'), text: b.textContent, shown: getComputedStyle(b).display !== 'none', pc: document.body.classList.contains('pc'),
      ctl: { brake: r('#btn-brake'), joy: r('#joy'), ammo: r('#ammo-stack'), mg: r('#btn-mg'), sight: r('#btn-sight'), lock: r('#btn-lock'), fire: r('#btn-fire'), gmap: r('#gmap'), tele: r('#flight-ui .telemetry'), cm: r('#btn-cm'), weapon: r('#btn-weapon') },
      diag: GHUD._S.P && GHUD._S.P.diag, hints: document.querySelector('#key-hints-list').textContent, help: Flight.controlsHelp(), manual: (() => { const s = Flight.running; Flight.running = false; const t = Flight.groundHelp(); Flight.running = s; return t; })() };
  });
  if (touch) {
    const clash = Object.entries(L.ctl).filter(([, q]) => meets(L.btn, q)).map(([k]) => k);
    const d = L.diag && { l: L.diag.x, t: L.diag.y, r: L.diag.x + L.diag.w, b: L.diag.y + L.diag.h };
    ok(`${tag}the DRONE button (DRONE ×3) on the screen, clear of the brake, the stick, the shell chips, MG, the sight, FIRE, the minimap and the damage diagram, at least 44 px`,
      L.docks === 1 && L.shown && /^DRONE×3$/.test(L.text) && !clash.length && !meets(L.btn, d) && L.btn.l >= 0 && L.btn.r <= w && L.btn.b <= h && L.btn.r - L.btn.l >= 44 && L.btn.b - L.btn.t >= 44, { btn: L.btn, clash, d });
    await shot(page, `rack-${w}x${h}`);
  } else ok(`${tag}a desktop: no DRONE button, U in the key hints (Drone ×3)`, L.docks === 1 && !L.shown && L.pc && /Drone ×3/.test(L.hints), { shown: L.shown, hints: L.hints });
  ok(`${tag}the help's U line: in flight for a vehicle with a bay, and always in the manual`, /Launch a drone/.test(L.help) && /Launch a drone/.test(L.manual), { help: /Launch a drone/.test(L.help) });
  await pageErrors(page, tag);
  await ctx.close();
}
// a plain tank: no U line in flight
{
  const tag = 'tank ', { ctx, page } = await open([1280, 720, false], tag);
  await page.waitForFunction(() => Terrain.earthMap.state !== 'loading', null, { timeout: 120000 });
  await page.evaluate(async () => { await Render3D.load(); App.toBuild(); Builder.loadTemplate('tk34'); store.set('rss.flight', null); App.showScene('flight'); Flight.start(Builder.serialize(), { place: GroundMode.soloPlace('tank') }); });
  await page.waitForFunction(() => Flight.running && Render3D.ready, null, { timeout: 60000 });
  await frames(page, 3);
  const t = await page.evaluate(() => ({ help: /Launch a drone/.test(Flight.controlsHelp()), hints: /Drone/.test(document.querySelector('#key-hints-list').textContent), btn: !document.querySelector('#btn-drone').hidden }));
  ok('a tank without a bay: no U line, no Drone hint, no button', !t.help && !t.hints && !t.btn, t);
  await pageErrors(page, tag);
  await ctx.close();
}

// ================================================================ 5. a drone with a warning receiver: the OSD clear of its scope
for (const [w, h, touch] of [[390, 844, true], [1280, 720, false]]) {
  const tag = `rwr ${w}×${h} `, { ctx, page } = await open([w, h, touch], tag);
  ROWS.rwr = ROWS.bumble.concat([['rwrPlus', -0.05, 0.1, 0, { att: 0 }]]);
  await fly(page, 'rwr');
  await page.evaluate(() => {
    const v = Flight.active, f = v.axis(1, 0, 0), rt = v.axis(0, 0, 1);
    const mk = (a, c, heat) => {
      const x = v.x + f.x * a + rt.x * c, y = v.y + f.y * a + rt.y * c, z = v.z + f.z * a + rt.z * c, dx = v.x - x, dy = v.y - y, dz = v.z - z, l = Math.hypot(dx, dy, dz);
      return { k: 'missile', b: v.body, x, y, z, vx: (dx / l) * 700, vy: (dy / l) * 700, vz: (dz / l) * 700, dx: dx / l, dy: dy / l, dz: dz / l, t: 1, life: 600, burn: 1e9, accel: 0, vmax: 900, turn: 0,
        dmg: 0, blast: 0, seek: 'air', heat, radar: !heat, target: v, owner: {}, enemy: true, air: true, sarh: false, drag: 0, bleed: 0, gimbal: 3, track: 99, arm: 9, irccm: 0, nav: 0, cm: new WeakSet(), lostT: 0, notchT: 0, trackT: 0 };
    };
    Combat.S.shots.push(mk(15000, -120, true), mk(0, 15000, false));
  });
  await page.waitForFunction(() => Combat.S.rwrBox, null, { timeout: 30000 });
  await page.waitForTimeout(1300); await frames(page, 2);
  const L = await page.evaluate(layout);
  ok(`${tag}a warning receiver's scope is drawn (Combat.S.rwrBox)`, !!L.rwr, L.rwr);
  judge(tag + 'FPV with an RWR', L);
  await shot(page, `rwr-${w}x${h}`);
  await pageErrors(page, tag);
  await ctx.close();
}

// ================================================================ 6. an old plane: none of it
{
  const tag = 'plane ', { ctx, page } = await open([390, 844, true], tag);
  await page.waitForFunction(() => Terrain.earthMap.state !== 'loading', null, { timeout: 120000 });
  await page.evaluate(async () => { await Render3D.load(); App.toBuild(); Builder.loadTemplate('falcon'); store.set('rss.flight', null); App.launch(); });
  await page.waitForFunction(() => Flight.running && Render3D.ready, null, { timeout: 60000 });
  await frames(page, 3);
  const pl = await page.evaluate(() => ({ cls: document.body.className, drone: [...document.querySelectorAll('#sas-bar [data-drone]')].some((b) => !b.hidden), rows: !document.querySelector('#row-batt').hidden || !document.querySelector('#row-link').hidden, btn: !document.querySelector('#btn-drone').hidden, fov: Drone.fov(Flight.active, Flight), tmax: document.querySelector('#btn-tmax').textContent }));
  ok('an old plane: no drone buttons, rows, classes or DRONE button; Max stays Max', !/drone|fpv/.test(pl.cls) && !pl.drone && !pl.rows && !pl.btn && pl.tmax === 'Max', pl);
  await pageErrors(page, tag);
  await ctx.close();
}

ok('no page errors', !errs.length, errs.join('\n'));
await b.close(); srv.close();
ok.done();
