// A ship at sea (the ships update, WP3: spec §4.6 the helm's inputs, §4.11 launch, §12.1-12.4 the HUD, keys and touch):
//  - the Cyclon Patrol Boat launched from the hangar (App.launch) starts at the bay: named, kind ship, bow out to sea
//    (west), the heading hold on, the telegraph at Stop, Ship.launch asked to float her (ship.js core: a stub until it lands);
//  - the HUD: the ground HUD with body.ship over it, the helm panel under the flight data (the telegraph's rungs and
//    order, HOLD, the rudder bar), speed in knots, the throttle box as the telegraph lever (FLANK, STOP);
//  - a phone in portrait (360×640, 390×844): a tap on the lever rings that detent (Half ahead), FLANK and STOP ring theirs,
//    a drag down rings astern; the stick is the rudder (v.ctl.h, and the helm's sh.rud once the core turns it); nothing
//    on the HUD overlaps; the hint and the help speak of the lever;
//  - a desktop (1280×720): W rings a step ahead, held keeps ringing, S astern, Z flank, X stop; D the rudder; 5 hand
//    steering and back, 6 the CIWS, 7 damage control's priority, H the bridge view (render3d's first-person path) and back;
//    the key hints, the help and the manual list the ship's keys; never a rocket's autopilot on 1-6;
//  - every sea spot (Spawns: off the slipway, the carriers, Shetland harbour, Caithness) starts her there, along its yaw;
//    Settings → Sea sets the swell (Ship.sea); the death words (Sunk, Capsized…) and knots on the end screen.
// No console errors (App.frame swallows them). Times on Flight.time (headless Chromium runs the sim at about 0.08× real
// time). SHOTS=<dir> saves screenshots there (ship-*.png; default test/.cache/shots).
//   node test/browser/ship-flight.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || path.join(ROOT, 'test', '.cache', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => page.screenshot({ path: path.join(SHOTS, `ship-${name}.png`) });
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('ship flight: launch at the bay, the helm (telegraph and rudder) by keys and touch, the helm panel, the sea spots');

const instrument = () => {
  window.__errs = [];
  addEventListener('error', (e) => window.__errs.push('onerror ' + e.message));
  for (const [o, k, n] of [[Flight, 'update', 'Flight.update'], [Render3D, 'renderFlight', 'Render3D.renderFlight'], [GHUD, 'draw', 'GHUD.draw'], [Ship, 'hud', 'Ship.hud']]) {
    const f = o[k]; o[k] = function (...a) { try { return f.apply(this, a); } catch (e) { window.__errs.push(`${n}: ${e && e.stack}`); throw e; } };
  }
  window.__launch = []; window.__over = []; const L = Ship.launch, O = Ship.overWater;
  Ship.launch = function (v, P) { window.__launch.push(P ? { e: P.e, z: P.z } : null); return L.apply(this, arguments); };
  Ship.overWater = function (v) { const r = O.apply(this, arguments); window.__over.push(!!r); return r; };
};
async function open(vp, tag, settings = {}) {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: vp[2], isMobile: vp[2] }), page = await ctx.newPage();
  watch(page, errs, tag);
  await openGame(page, srv.url, { hints: true, ...settings });
  await page.evaluate(instrument);
  return { ctx, page };
}
const pageErrors = async (page, tag) => { const e = await page.evaluate(() => window.__errs.splice(0)); for (const x of e) errs.push(tag + x); };
const frames = (page, n = 2) => page.evaluate((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const until = (page, t) => page.waitForFunction((t) => Flight.time > t, t, { timeout: 180000 });
// the Cyclon from the hangar, launched as a player would (App.launch: Spawns.solo, the bay unless a spot was chosen)
async function sail(page, spot) {
  await page.waitForFunction(() => Terrain.earthMap.state !== 'loading', null, { timeout: 120000 });
  await page.evaluate(async (spot) => {
    await Render3D.load();
    App.toBuild(); Builder.loadTemplate('cyclon'); store.set('rss.flight', null);
    // [WP5] the finished Cyclon carries guns (a turret, two MGs): with them she takes the armed HUD (the aim view, its
    // keys); the helm's checks here are the unarmed ship's, so her guns come off first (the armed ship: WP9's, WP12's)
    Builder.parts = Builder.parts.filter((p) => !(p.def.weapon || p.def.ring || p.def.shape === 'tturret')); Builder.changed();
    if (spot) Spawns.choose('ship', spot);
    App.launch();
  }, spot || null);
  await page.waitForFunction(() => Flight.running && Flight.active && Flight.active.kind === 'ship' && Flight.time > 0.6, null, { timeout: 180000 });
  await page.waitForTimeout(1200); // (the ground HUD's places: looked up once a second)
  await frames(page, 2);
}
// where she is and which way her bow points: metres east of the pad and across the track (z), and the bow's share east
const where = (page) => page.evaluate(() => {
  const v = Flight.active, r = Math.hypot(v.x, v.y, v.z), ux = v.x / r, uy = v.y / r, el = Math.hypot(ux, uy), f = v.axis(1, 0, 0);
  const east = -wrapAngle(Math.atan2(v.y, v.x) - EARTH.padAngle) * EARTH.radius, z = Math.asin(Math.max(-1, Math.min(1, v.z / r))) * EARTH.radius;
  const fe = f.x * (uy / el) + f.y * (-ux / el); // (the bow's share of game east)
  return { east, z, fe, name: v.name, kind: v.kind, sas: v.sas, tel: v.sh && v.sh.tel, hydro: v.hydro, launch: window.__launch.slice(), over: window.__over.slice() };
});
const helm = (page) => page.evaluate(() => {
  const v = Flight.active, sh = v.sh, q = (s) => document.querySelector(s), vis = (s) => { const e = q(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
  const H = q('#ship-helm');
  return { t: Flight.time, rec: Flight.canRecover(), recBtn: !q('#btn-recover').hidden, kn: v.speed() * SHIP.KN, hdg: Ship.heading(v, sh) * 57.29578, hold: sh.hold, afloat: !!v.afloat, tel: sh.tel, rud: sh.rud, ctlH: v.ctl.h, sas: v.sas, ciws: sh.ciwsOn, dc: sh.dcPri, bridge: !!Flight.bridge,
    ship: document.body.classList.contains('ship'), ground: document.body.classList.contains('ground'), lever: vis('#flight-ui .throttle-box'),
    helm: vis('#ship-helm'), inTel: !!H && H.parentNode === q('#flight-ui .telemetry'), order: H && H.querySelector('.sh-order').textContent, mode: H && H.querySelector('.sh-mode').textContent,
    lit: H ? [...H.querySelectorAll('.sh-rungs i')].findIndex((i) => i.classList.contains('on')) : -1, ang: H && H.querySelector('.sh-ang').textContent,
    speed: q('#t-speed').textContent, label: q('#throttle-label').textContent, max: q('#btn-tmax').textContent, cut: q('#btn-tcut').textContent, hint: q('#hint').hidden ? '' : q('#hint-text').textContent };
});

// ---- where everything is (controls.mjs's rule): every control and panel on the screen and clear of the others
const layout = () => {
  const rect = (q) => { const e = typeof q === 'string' ? document.querySelector(q) : q; if (!e || e.hidden) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width && r.height && cs.display !== 'none' && cs.visibility !== 'hidden' ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const P = GHUD._S.P || {};
  const items = { stick: rect('#joy'), brake: rect('#btn-brake'), fire: rect('#btn-fire'), cm: rect('#btn-cm'), chip: rect('#btn-weapon'), throttle: rect('#flight-ui .throttle-box'), stage: rect('#btn-stage'),
    telemetry: rect('#flight-ui .telemetry'), topRight: rect('#flight-ui .flight-top-right'), warp: rect('#warp'), keys: rect('#key-hints'), hint: rect('#hint'), map: rect('#gmap'),
    diagram: P.diag ? { l: P.diag.x, t: P.diag.y, r: P.diag.x + P.diag.w, b: P.diag.y + P.diag.h } : null };
  const helm = rect('#ship-helm'), tel = items.telemetry;
  return { W: innerWidth, H: innerHeight, items, z: Controls.z, helmIn: !!helm && !!tel && helm.l >= tel.l - 0.5 && helm.r <= tel.r + 0.5 && helm.b <= tel.b + 0.5 && helm.t >= tel.t - 0.5 };
};
const meets = (a, c) => !!a && !!c && a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
function judge(tag, L, need = []) {
  const clash = [], off = [], E = Object.entries(L.items).filter(([, a]) => a), missing = need.filter((k) => !L.items[k]);
  for (let i = 0; i < E.length; i++) {
    const [k, a] = E[i];
    if (a.l < -0.5 || a.t < -0.5 || a.r > L.W + 0.5 || a.b > L.H + 0.5) off.push(k);
    for (let j = i + 1; j < E.length; j++) if (meets(a, E[j][1])) clash.push(`${k}/${E[j][0]}`);
  }
  ok(`${tag}: every control and panel on the screen and clear of the others, the helm panel inside the flight data`, !clash.length && !off.length && !missing.length && L.helmIn,
    JSON.stringify({ z: L.z, clash, off, missing, helmIn: L.helmIn }));
}
// fingers (CDP: every touch event lists the points still down)
function fingers(cdp) {
  const pts = new Map(), send = (type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...pts.values()] });
  return {
    down: async (id, x, y) => { pts.set(id, { x, y, id }); await send('touchStart'); },
    move: async (id, x, y) => { pts.set(id, { x, y, id }); await send('touchMove'); },
    up: async (id) => { pts.delete(id); await send('touchEnd'); },
  };
}
const box = (page, q) => page.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }, q);

// ================================================================ a phone in portrait
for (const vp of [[390, 844, true], [360, 640, true]]) {
  const tag = `${vp[0]}×${vp[1]} `, { ctx, page } = await open(vp, tag), cdp = await ctx.newCDPSession(page), T = fingers(cdp);
  await sail(page);
  const w = await where(page);
  if (vp[0] === 390) {
    ok('launched from the hangar: the Cyclon Patrol Boat, a ship, at the bay (2.3 km west of the pad, on the track), her bow out to sea (west)',
      w.name === 'Cyclon Patrol Boat' && w.kind === 'ship' && Math.abs(w.east + 2300) < 40 && Math.abs(w.z) < 40 && w.fe < -0.95, w);
    ok(`she starts on the heading hold, the telegraph at Stop, floating (hydro); Flight.start asked ship.js whether she is over water (once) and${w.over[0] ? '' : ', the core not in yet (overWater: no),'} set her afloat at her marks there when it said so (Ship.launch, at the bay's own site)`,
      w.sas === 'hold' && w.tel === 0 && w.hydro && w.over.length === 1 && w.launch.length === (w.over[0] ? 1 : 0) && (!w.launch.length || w.launch[0] === null), w);
  }
  let h = await helm(page);
  ok(`${tag}the ground HUD with body.ship: the helm panel in the flight data (Stop lit, HOLD), speed in knots, the throttle box her telegraph (Flank, Stop)`,
    h.ship && h.ground && h.helm && h.inTel && h.order === 'Stop' && h.lit === 3 && /^HOLD/.test(h.mode) && / kn( ▲| ▼)?$/.test(h.speed) && h.lever && h.max === 'Flank' && h.cut === 'Stop' && h.label === 'Stop', h);
  if (vp[0] === 390) ok('the first hint: the lever is her engine telegraph, the stick her rudder', /lever on the left is her engine telegraph/.test(h.hint), h.hint);
  judge(`${tag}a ship (the Cyclon)`, await page.evaluate(layout), ['stick', 'throttle', 'telemetry', 'map']);
  await shot(page, `helm-${vp[0]}x${vp[1]}`);
  // the lever: a tap at Half ahead's detent (5/7 up), FLANK, STOP, a drag down to Half astern
  const tr = await box(page, '#throttle-track');
  await page.touchscreen.tap(tr.x, tr.t + tr.h * (1 - 5 / 7)); await frames(page, 2);
  const t1 = await helm(page);
  await page.touchscreen.tap((await box(page, '#btn-tmax')).x, (await box(page, '#btn-tmax')).y); await frames(page, 2);
  const t2 = await helm(page);
  await shot(page, `flank-${vp[0]}x${vp[1]}`);
  await page.touchscreen.tap((await box(page, '#btn-tcut')).x, (await box(page, '#btn-tcut')).y); await frames(page, 2);
  const t3 = await helm(page);
  await T.down(5, tr.x, tr.t + tr.h * (1 - 3 / 7)); for (let i = 1; i <= 4; i++) await T.move(5, tr.x, tr.t + tr.h * (1 - 3 / 7) + (i / 4) * tr.h * (2 / 7)); await T.up(5); await frames(page, 2);
  const t4 = await helm(page);
  ok(`${tag}the lever: a tap at a detent rings it (Half ahead), FLANK rings Flank, STOP Stop, a drag down rings astern (Half astern); the panel and the lever's label follow`,
    t1.tel === 2 && t1.order === 'Half ahead' && t1.lit === 5 && t1.label === 'Half\nahead' && t2.tel === 4 && t2.order === 'Flank' && t3.tel === 0 && t4.tel === -2 && t4.order === 'Half astern' && t4.lit === 1,
    { t1: [t1.tel, t1.order, t1.lit, t1.label], t2: [t2.tel, t2.order], t3: t3.tel, t4: [t4.tel, t4.order, t4.lit] });
  await page.touchscreen.tap((await box(page, '#btn-tcut')).x, (await box(page, '#btn-tcut')).y);
  // the stick: the rudder (sideways), its forward throw nothing (the lever is the telegraph)
  const j = await box(page, '#joy');
  await T.down(1, j.x, j.y); await T.move(1, j.x + 20, j.y); await T.move(1, j.x + 60, j.y); await frames(page, 3);
  const s1 = await helm(page), t0 = s1.t;
  await T.move(1, j.x + 40, j.y - 40); await frames(page, 3);
  const s1b = await page.evaluate(() => ({ tel: Flight.active.sh.tel, v: Flight.active.ctl.v, h: Flight.active.ctl.h }));
  await until(page, t0 + 1.2);
  const s2 = await helm(page);
  await T.up(1); await frames(page, 3);
  const s3 = await helm(page);
  const core = await page.evaluate(() => !/^function pre\(v, dt, sim\) \{\}$/.test(Ship.pre.toString().replace(/\s+/g, ' ').trim())); // (ship.js core's helm in: the rudder follows)
  ok(`${tag}the stick is her rudder: sideways puts it to starboard (ctl.h ${s1.ctlH.toFixed(2)}), up does nothing to the telegraph; let go, centred${core ? '; the helm turned it to starboard' : ' (the hydro core\'s helm not in yet: sh.rud stays)'}`,
    s1.ctlH > 0.99 && s1b.tel === 0 && s1b.v === 0 && s1b.h > 0.5 && s3.ctlH === 0 && (!core || s2.rud > 0), { s1: [s1.ctlH, s1.tel, s1.rud], s1b, s2: s2.rud, s3: s3.ctlH, core });
  // under way by touch (the hydro core's helm): FLANK, and she gathers way; the stick to starboard, and she turns to starboard
  if (core && vp[0] === 390) {
    await page.touchscreen.tap((await box(page, '#btn-tmax')).x, (await box(page, '#btn-tmax')).y);
    const u0 = await helm(page); await until(page, u0.t + 4); const u1 = await helm(page);
    await T.down(2, j.x, j.y); await T.move(2, j.x + 30, j.y); await T.move(2, j.x + 60, j.y);
    await until(page, u1.t + 4); const u2 = await helm(page);
    await T.up(2); await frames(page, 3);
    await until(page, u2.t + 2); const u3 = await helm(page);
    const turn = ((u2.hdg - u1.hdg + 540) % 360) - 180;
    ok(`${tag}under way by touch: afloat, FLANK and in 4 s she makes ${u1.kn.toFixed(1)} kn (the panel and the flight data in knots); the stick to starboard turns her to starboard (${turn.toFixed(1)}° in 4 s); let go, she holds a heading (${u3.mode})`,
      u0.afloat && u1.tel === 4 && u1.kn > 4 && / kn/.test(u1.speed) && turn > 3 && u2.rud > 10 && /^HOLD \d{3}°$/.test(u3.mode) && Number.isFinite(u3.hold), { u0: [u0.afloat, u0.kn], u1: [u1.tel, u1.kn, u1.speed, u1.hdg], u2: [u2.rud, u2.hdg], u3: [u3.mode, u3.hold] });
    await shot(page, `underway-${vp[0]}x${vp[1]}`);
    await page.touchscreen.tap((await box(page, '#btn-tcut')).x, (await box(page, '#btn-tcut')).y);
  }
  // the help on touch: the touch line first (the lever and the stick), the keys folded away
  const hp = await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = Flight.controlsHelp(); return { first: d.querySelector('.help-grid').textContent, folded: !!d.querySelector('details.help-keys') }; });
  ok(`${tag}the menu's help on a phone: the lever and the stick first, the keys folded away`, /telegraph/.test(hp.first) && /rudder/.test(hp.first) && hp.folded, hp);
  // UI size 150% and 60%: still clear
  for (const u of [1.5, 0.6]) {
    await page.evaluate((u) => { Settings.set('uiSize', u); Controls.relayout(); }, u);
    await page.waitForTimeout(1300); await frames(page, 2);
    judge(`${tag}a ship at UI size ${u * 100}% (scale ${await page.evaluate(() => Controls.z)})`, await page.evaluate(layout), ['stick', 'throttle', 'telemetry']);
    if (u === 1.5 && vp[0] === 360) await shot(page, `helm-150-${vp[0]}x${vp[1]}`);
  }
  await page.evaluate(() => { Settings.set('uiSize', 1); Controls.relayout(); });
  await pageErrors(page, tag);
  await ctx.close();
}

// ================================================================ a desktop: the keys
{
  const tag = '1280×720 ', { ctx, page } = await open([1280, 720, false], tag);
  await sail(page);
  await page.waitForTimeout(400);
  const press = async (k) => { await page.keyboard.press(k); await frames(page, 2); return helm(page); };
  const a = await press('KeyW'), b2 = await press('KeyW'), c = await press('KeyS');
  await page.keyboard.down('KeyW');
  await page.waitForFunction(() => Flight.active.sh.tel >= 3, null, { timeout: 60000 }).catch(() => {});
  await page.keyboard.up('KeyW'); await frames(page, 2);
  const d = await helm(page);
  const z = await press('KeyZ'), x = await press('KeyX'), sa = await press('ShiftLeft'), sc = await press('ControlLeft'), ar = await press('ArrowDown'), x2 = await press('KeyX');
  ok('W rings a step ahead (Slow, Half), S a step back, W held keeps ringing (Full), Z Flank, X Stop, Shift and Ctrl (the throttle keys) a step either way, ↓ astern; the panel says so',
    a.tel === 1 && b2.tel === 2 && c.tel === 1 && d.tel >= 3 && z.tel === 4 && z.order === 'Flank' && x.tel === 0 && x.order === 'Stop' && sa.tel === 1 && sc.tel === 0 && ar.tel === -1 && ar.order === 'Slow astern' && x2.tel === 0,
    { a: a.tel, b: b2.tel, c: c.tel, d: d.tel, z: z.tel, x: x.tel, sa: sa.tel, sc: sc.tel, ar: ar.tel });
  await page.keyboard.down('KeyD'); await frames(page, 3);
  const r = await helm(page);
  await page.keyboard.up('KeyD'); await frames(page, 3);
  const r2 = await helm(page);
  ok('D puts the rudder to starboard (ctl.h 1), let go: centred', r.ctlH === 1 && r2.ctlH === 0, { r: r.ctlH, r2: r2.ctlH });
  // under way with the keys (the hydro core's helm): W three times (Full ahead), she gathers way; D held turns her to
  // starboard; let go, she holds her new heading
  for (let i = 0; i < 3; i++) await press('KeyW');
  const w0 = await helm(page); await until(page, w0.t + 4); const w1 = await helm(page);
  await page.keyboard.down('KeyD'); await until(page, w1.t + 4); const w2 = await helm(page); await page.keyboard.up('KeyD');
  await until(page, w2.t + 3); const w3 = await helm(page);
  const wt = ((w2.hdg - w1.hdg + 540) % 360) - 180, drift = Math.abs(((w3.hdg - (w3.hold * 57.29578) + 540) % 360) - 180);
  ok(`W, W, W: Full ahead, and in 4 s she makes ${w1.kn.toFixed(1)} kn (no Recover under way); D held turns her to starboard (${wt.toFixed(1)}° in 4 s, rudder ${w2.rud.toFixed(0)}°); let go, she holds a heading (${w3.mode}, ${drift.toFixed(1)}° off it)`,
    w0.tel === 3 && w0.order === 'Full ahead' && w1.kn > 4 && !w1.rec && !w1.recBtn && wt > 3 && w2.rud > 10 && /^HOLD \d{3}°$/.test(w3.mode) && drift < 15, { w0: w0.tel, w1: w1.kn, w2: [w2.rud, w2.hdg], w3: [w3.mode, w3.hold, w3.hdg] });
  await shot(page, 'underway-1280x720');
  await press('KeyX');
  const k5 = await press('Digit5'), k5b = await press('Digit5'), k6 = await press('Digit6'), k7 = await press('Digit7'), k7b = await press('Digit7');
  ok('5: hand steering (HAND) and back to the heading hold; 6 the CIWS off and on; 7 damage control: flooding first, fires first; 1-6 never a rocket\'s autopilot',
    k5.sas === 'manual' && k5.mode === 'HAND' && k5b.sas === 'hold' && /^HOLD/.test(k5b.mode) && k6.ciws === false && k7.dc === 'flood' && k7b.dc === 'fire', { k5: [k5.sas, k5.mode], k5b: [k5b.sas, k5b.mode], k6: k6.ciws, k7: k7.dc, k7b: k7b.dc });
  for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit6', 'Digit7']) await page.keyboard.press(k);
  await frames(page, 2);
  const sas = await page.evaluate(() => Flight.active.sas);
  ok('...after 1-4 (and 6, 7 again) she is still on the heading hold', sas === 'hold', sas);
  const v1 = await press('KeyH'); await frames(page, 3);
  const cam = await page.evaluate(() => !!Render3D.fpvCam());
  await shot(page, 'bridge-1280x720');
  const v2 = await press('KeyH'); await frames(page, 2);
  const cam2 = await page.evaluate(() => !!Render3D.fpvCam());
  ok('H: the bridge view (render3d\'s first-person path, from over her wheelhouse), H again: the chase view', v1.bridge && cam && !v2.bridge && !cam2, { v1: v1.bridge, cam, v2: v2.bridge, cam2 });
  const hints = await page.evaluate(() => [...document.querySelectorAll('#key-hints-list > div')].map((x) => [...x.querySelectorAll('kbd')].map((k) => k.textContent).join(' ') + ' ' + x.lastElementChild.textContent));
  const has = (re) => hints.some((t) => re.test(t));
  ok('the key hints for a ship, from the bindings: W S the telegraph, A D the rudder, Z X flank and stop, 5 hand steering, 7 damage control, H the bridge view',
    has(/^W S Telegraph/) && has(/^A D Rudder/) && has(/^Z X Flank, stop/) && has(/^5 Hand steer/) && has(/^7 Damage control/) && has(/^H Bridge view/) && has(/^Esc Menu/), hints);
  const help = await page.evaluate(() => {
    const d = document.createElement('div'); d.innerHTML = Flight.controlsHelp();
    const rows = [...d.querySelectorAll('.help-grid > div')].map((x) => x.textContent);
    App.showHelp(); const m = document.querySelector('#modal-card'), heads = [...m.querySelectorAll('h3.summary-h')].map((x) => x.textContent), txt = m.textContent; UI.closeModal();
    return { rows, heads, manual: /Ships\./.test(txt) && /engine telegraph/.test(txt) };
  });
  const row = (re) => help.rows.some((t) => re.test(t));
  ok('the menu\'s help lists her keys (W S / ↑ ↓ the telegraph, A D the rudder, Z X, 5, H, 6, 7) and the manual has a Ships chapter and the Ships list',
    row(/^WS \/ ↑↓Ring the engine telegraph/) && row(/^AD \/ ←→Rudder/) && row(/^ZXFlank speed/) && row(/^5Heading hold/) && row(/^HBridge view/) && row(/^6CIWS/) && row(/^7Damage control/)
    && help.heads.includes('Ships') && help.manual, help);
  await shot(page, 'helm-1280x720');
  judge('1280×720 a ship', await page.evaluate(layout), ['telemetry', 'keys', 'throttle']);
  // the death words and the end screen's knots
  const dw = await page.evaluate(() => { const v = Flight.active, w = []; for (const f of ['sunk', 'capsized', 'magazine', 'action', undefined]) { v.fate = f; w.push(Flight.deathLine(v)); } v.fate = undefined; const s = Flight.summaryHTML(); return { w, sailed: /Sailed/.test(s), kn: / kn</.test(s) }; });
  ok('her loss in words (Sunk, Capsized, Lost to a magazine explosion, Out of action) and the end screen\'s distance sailed and top speed in knots',
    dw.w.join('|') === 'Sunk|Capsized|Lost to a magazine explosion|Out of action|Destroyed' && dw.sailed && dw.kn, dw);
  // Settings → Sea
  const sea = await page.evaluate(() => { App.showSettings(); const s = document.querySelector('#set-sea'), opts = [...s.options].map((o) => o.value), was = s.value; s.value = 'rough'; s.dispatchEvent(new Event('change')); UI.closeModal(); const r = [opts, was, Ship.sea(), Settings.get('sea')]; Ship.setSea('moderate'); Settings.set('sea', 'moderate'); return r; });
  ok('Settings → Sea: Calm, Moderate (the default) or Rough, kept, and the sea follows (Ship.setSea)', sea[0].join() === 'calm,moderate,rough' && sea[1] === 'moderate' && sea[2] === 'rough' && sea[3] === 'rough', sea);
  await pageErrors(page, tag);
  await ctx.close();
}

// ================================================================ every sea spot
{
  const tag = 'spots ', { ctx, page } = await open([1280, 720, false], tag);
  const spots = await page.evaluate(() => Spawns.list('ship').map((s) => ({ id: s.id, sea: s.sea || null, site: s.site || null })));
  const out = [];
  for (const s of spots) {
    await sail(page, s.id);
    const w = await where(page), want = s.sea || { e: -2300, z: 0, yaw: Math.PI }; // (the bay: EARTH.sites.bay)
    out.push({ id: s.id, east: Math.round(w.east), z: Math.round(w.z), fe: +w.fe.toFixed(2), want: [want.e, want.z, +Math.cos(want.yaw).toFixed(2)] });
  }
  const bad = out.filter((o) => Math.hypot(o.east - o.want[0], o.z - o.want[1]) > 40 || Math.abs(o.fe - o.want[2]) > 0.08);
  ok(`every ship spot (${spots.length}: the bay, off the slipway, the carriers, Shetland harbour and Caithness) starts her there, her bow along its way`, spots.length === 7 && !bad.length, bad.length ? bad : out.map((o) => `${o.id} ${o.east},${o.z}`));
  await shot(page, 'spot-carrierS-1280x720');
  // and after her, an old craft's HUD: no ship layer, no helm panel, the throttle box a throttle again (Max, Cut, a percentage)
  await page.evaluate(async () => { App.toBuild(); Builder.loadTemplate('fs16'); store.set('rss.flight', null); App.showScene('flight'); Flight.start(Builder.serialize()); });
  await page.waitForFunction(() => Flight.running && Flight.active.kind === 'plane' && Flight.time > 0.3, null, { timeout: 120000 });
  await frames(page, 3);
  const old = await page.evaluate(() => ({ ship: document.body.classList.contains('ship'), ground: document.body.classList.contains('ground'), helm: document.querySelector('#ship-helm').hidden,
    max: document.querySelector('#btn-tmax').textContent, cut: document.querySelector('#btn-tcut').textContent, label: document.querySelector('#throttle-label').textContent, bottom: document.querySelector('#throttle-fill').style.bottom, speed: document.querySelector('#t-speed').textContent }));
  ok('a plane after her: no ship layer, the helm panel hidden, the throttle box a throttle again (Max, Cut, a percentage), speed in km/h',
    !old.ship && !old.ground && old.helm && old.max === 'Max' && old.cut === 'Cut' && /^\d+%$/.test(old.label) && old.bottom === '' && / km\/h$/.test(old.speed), old);
  await pageErrors(page, tag);
  await ctx.close();
}

ok('no console errors', !errs.length, errs.slice(0, 6).join('\n'));
await b.close(); srv.close();
ok.done();
