// Radar in the builder (the big update, spec-radar §3.3-§3.6 and §12.2's builder half), on a phone in portrait (390×844,
// touch) and a desktop (1280×720, mouse): an old jet that relied on the hidden radar warns, and Fit a radar puts the set
// its nose was built for inside it (the warning goes); a tap on another set swaps them; the Radar tab groups its parts
// (Inside a nose, Outside) and each says how far and where it looks; the nose goes see-through for 1.6 s after a fit and
// then the blueprint is idle; the nose's card has a chip that selects the set; a set dragged from the tray (a finger on
// the phone, the mouse on the desktop) goes into the nose under it; dragged on over the tail fin it is red and the drop
// does nothing, and into the fuselage it moves there; deleting its host takes the set along; in 3D, X-ray shows the set
// and a tap there picks it, a set over a wing is red, and one dragged onto the fuselage goes inside it. Then the flight
// HUD (below): the scope on eight screens, the RDR pill, picks, radar off and on, RADAR OUT; the lock's and the bandit's
// labels clear of the flight data on a phone in portrait (RADAR_HUD=lock: that part alone).
//   node test/browser/radar.mjs        (screenshots: SHOTS=<dir>, default test/.cache/shots/; RADAR_PART=builder or hud: one half)
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

const PART = process.env.RADAR_PART || ''; // ('builder' or 'hud': one half only)
for (const [W, H, touch] of PART === 'hud' ? [] : [[390, 844, true], [1280, 720, false]]) {
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

// ================================================================ the flight HUD (spec-radar §6, §7, §12.2's HUD half)
// The FS-16 (a pulse-Doppler set in its nose, an advanced RWR) at 3 km with bandits ahead, one above and one below, on
// phones in portrait (360×640, 375×667, 390×844), on its side (844×390) and desktops (1280×720, 1920×1080), and at UI
// sizes 75% and 150%: the radar's scope sits in the warning receiver's slot (Combat.S.rwrBox.rad), on the screen and
// clear of the flight data, the controls, the buttons top right, the time warp, the hint, the weapon box and its RDR
// pill, FIRE, the throttle, the stage box, the key hints and Aim's circle at rest; the pill is clear of everything
// Controls.fit measures. With ten contacts the scope takes at most 60 canvas calls. On the phone a tap on a bandit's
// marker picks it, a tap on RDR steps the pick, a 0.7 s hold switches the radar off (OFF on the scope, RDR OFF) and on
// again; on the desktop I (Shift+I back) and O do the same, and the pill is hidden. The set shot out: RADAR OUT, the
// toast, RDR OUT. Screenshots of each, with a lock: radar-hud-<W>x<H>[-ui<u>].png.
const HUD = [[360, 640, true, 1], [375, 667, true, 1], [390, 844, true, 1], [844, 390, true, 1], [1280, 720, false, 1], [1920, 1080, false, 1],
  [360, 640, true, 1.5], [360, 640, true, 0.75], [390, 844, true, 1.5], [844, 390, true, 1.5], [1920, 1080, false, 1.5], [1280, 720, false, 0.75],
  [667, 375, true, 1], [740, 360, true, 1], [844, 390, true, 1.25], [844, 390, true, 0.75]]; // (review P3-RHUD-4: short landscape phones, BRAKE beside the scope)
// in the page: count the 2D-context calls inside Radar.draw, and keep the scope's label (its fillTexts in the 9 px font:
// the text, and each line's box as drawn, measured with the canvas's own font)
const instrument = () => {
  const P = CanvasRenderingContext2D.prototype, R = (window.__rd = { calls: [], label: '', rows: [] }), mt = P.measureText;
  let on = false, n = 0, txt = '', rows = [];
  for (const k of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, k);
    if (!d || typeof d.value !== 'function' || k === 'constructor') continue;
    const f = d.value;
    P[k] = function (...a) {
      if (on) {
        n++;
        if (k === 'fillText' && this.font.includes('9px')) { const w = mt.call(this, a[0]).width, l = this.textAlign === 'center' ? a[1] - w / 2 : a[1]; txt = a[0]; rows.push({ t: a[0], l, r: l + w, top: a[2] - 8, b: a[2] + 2 }); }
      }
      return f.apply(this, a);
    };
  }
  const draw = Radar.draw;
  Radar.draw = function (...a) { on = true; n = 0; rows = []; try { return draw.apply(this, a); } finally { on = false; R.calls.push(n); if (R.calls.length > 120) R.calls.shift(); R.label = txt; R.rows = rows; } };
};
// the jet at 3 km, level at 250 m/s; n bandits ahead (the first one above, the second below), coming at it, held
// (they neither fly nor fire: the picture stays put); the range's ground targets cleared (no SAMs)
const fly = (n) => {
  const v = Flight.active, r0 = Math.hypot(v.x, v.y, v.z), up = { x: v.x / r0, y: v.y / r0, z: v.z / r0 };
  v.x += up.x * 3000; v.y += up.y * 3000; v.z += up.z * 3000; const f0 = v.axis(0, 1, 0); v.vx = f0.x * 250; v.vy = f0.y * 250; v.vz = f0.z * 250; v.landed = false;
  const f = v.axis(0, 1, 0), rt = v.axis(0, 0, 1);
  const at = [[9000, -1500, 800], [12000, 2500, -600], [6000, 3000, 0], [15000, -5000, 300], [8000, 6000, 200], [11000, -7000, -200], [14000, 0, 500], [5000, -2000, 100], [16000, 6000, 0], [7000, 1000, -300]];
  for (let i = 0; i < n; i++) {
    const o = Combat.spawnFighter(Flight), [a, c, u] = at[i];
    o.x = v.x + f.x * a + rt.x * c + up.x * u; o.y = v.y + f.y * a + rt.y * c + up.y * u; o.z = v.z + f.z * a + rt.z * c + up.z * u;
    o.q = { ...v.q }; o.vx = -v.vx * 0.9; o.vy = -v.vy * 0.9; o.vz = -v.vz * 0.9; o.ai.hold = true;
  }
  Combat.S.targets.length = 0; Combat.S.spawned = true; Combat.S.rwrBox = null;
  Radar.S.rc = []; // (the range's target drones are radar contacts (P5-OLD-1): those seen before they were cleared would fade on the scope for 1.5 s)
};
// a lock on the first bandit with the radar missiles chosen (as if held for the lock time)
const lockOn = () => {
  const v = Flight.active, F = Flight, sys = Combat.systems(v), i = sys.findIndex((c) => c.w.kind === 'missile' && c.w.radar && c.w.seek === 'air');
  const t = F.vessels.find((o) => o !== v && Combat.isFighter(o));
  v.wsel = i; Radar.S.pick = t; Combat.S.cand = t; Combat.S.lockT = 9; Flight.updateHUD(true);
  return i >= 0 && !!t;
};
// where everything is
const where = () => {
  const rect = (q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const W = innerWidth, H = innerHeight, B = Combat.S.rwrBox;
  const panels = { telemetry: '#flight-ui .telemetry', left: '#flight-ui .left-controls', bar: '#mp-bar', topRight: '#flight-ui .flight-top-right', warp: '#warp', hint: '#hint', box: '#weapon-box', pill: '#btn-radar', fire: '#btn-fire', throttle: '#flight-ui .throttle-box', stage: '#flight-ui .stage-box', keys: '#key-hints',
    brake: '#btn-brake', rot: '#flight-ui .rot-controls', sas: '#sas-bar', air: '#flight-ui .air-btns', cm: '#btn-cm' }; // (BRAKE: outside the left controls' box in landscape)
  const P = {};
  for (const k in panels) P[k] = rect(panels[k]);
  P.aim = { l: W / 2 - 26, t: H / 2 - 26, r: W / 2 + 26, b: H / 2 + 26 };
  // what Controls.fit measures (this HUD's movable controls and the panels), for the pill
  const fit = {};
  for (const k in Controls.CTL) { const [sel, , hud] = Controls.CTL[k]; if (k !== 'radar' && k !== 'gmap' && (hud === 'both' || hud === 'air')) fit[k] = rect(k === 'joy' ? '#flight-ui .rot-controls' : sel); }
  for (const q of ['#flight-ui .telemetry', '#flight-ui .flight-top-right', '#warp', '#mp-bar', '#gai-bar']) fit[q] = rect(q);
  fit.aim = P.aim;
  return { W, H, z: Controls.z, B, disc: B && { l: B.x - B.R, t: B.y - B.R, r: B.x + B.R, b: B.y + B.R + 14 }, P, fit, pc: document.body.classList.contains('pc'),
    pillShown: getComputedStyle($('#btn-radar')).display !== 'none' && !$('#btn-radar').hidden, pill: $('#btn-radar').textContent, pillCls: $('#btn-radar').className, label: window.__rd.label };
};
const meets = (a, c) => !!a && !!c && a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
const label = (page) => page.evaluate(() => new Promise((ok) => { let i = 0; const f = () => (++i >= 3 ? ok(window.__rd.label) : requestAnimationFrame(f)); requestAnimationFrame(f); }));
const flightAt = (page, t) => page.waitForFunction((t) => Flight.time >= t, t, { timeout: 60000 });

const ONLY = process.env.RADAR_HUD ? process.env.RADAR_HUD.split(',') : null; // (e.g. RADAR_HUD=390x844,1280x720: those screens only)
for (const [W, H, touch, ui] of PART === 'builder' ? [] : HUD.filter(([w, h, , u]) => !ONLY || ONLY.includes(`${w}x${h}`) || ONLY.includes(`${w}x${h}@${u}`))) {
  const tag = `${W}x${H}${ui !== 1 ? ` UI ${ui * 100}%` : ''} `, full = ui === 1 && ((W === 390 && H === 844) || (W === 1280 && H === 720));
  const ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  watch(page, errs, tag);
  await openGame(page, srv.url, { targets: 'hostile', uiSize: ui });
  await page.evaluate(() => { App.toBuild(); Builder.loadTemplate('fs16'); App.launch(); });
  await page.waitForFunction(() => Flight.running && Render3D.ready, null, { timeout: 60000 });
  await page.evaluate(instrument);
  await page.evaluate(fly, full && touch ? 10 : 2);
  await page.waitForFunction(() => Radar.S.rc.length > 0 && Combat.S.rwrBox, null, { timeout: 60000 });
  await page.waitForTimeout(1300); // (the place is looked up again once a second: now with the panels as they are in flight)
  ok(tag + 'a lock on the bandit above with the radar missiles chosen', await page.evaluate(lockOn));
  await page.waitForFunction(() => Combat.S.lock, null, { timeout: 60000 });
  await page.evaluate(() => Flight.updateHUD(true));
  const L = await page.evaluate(where);
  const clash = Object.entries(L.P).filter(([k, r]) => meets(L.disc, r)).map(([k]) => k);
  const on = L.disc && L.disc.l >= 0 && L.disc.t >= 0 && L.disc.r <= L.W && L.disc.b <= L.H;
  ok(tag + `the radar's scope (R ${L.B && L.B.R}) in the warning receiver's slot, on the screen, clear of every panel and control`, !!L.B && L.B.rad === true && on && !clash.length, { clash, disc: L.disc, z: L.z, P: L.P });
  if (touch) {
    const pc = Object.entries(L.fit).filter(([k, r]) => meets(L.P.pill, r)).map(([k]) => k);
    ok(tag + `the RDR pill ("${L.pill}") shown, on the screen and clear of everything Controls.fit measures`, L.pillShown && /^RDR PD$/.test(L.pill) && L.P.pill.l >= 0 && L.P.pill.r <= L.W && L.P.pill.t >= 0 && !pc.length, { pc, pill: L.P.pill });
  } else ok(tag + 'a desktop: no RDR pill (I and O)', L.pc && !L.pillShown);
  ok(tag + `the scope's label: "${L.label}"`, /^PD 18( km)? · LOCK \d+\.\d$/.test(L.label), L.label);
  // (review P3-RHUD-4) the label at its widest (a set damaged: "PD 14 · LOCK 9.0 · DMG 62%", wider than the disc): every
  // line of it on the screen and clear of every panel and control (on two lines where one has no room)
  const dl = await page.evaluate(() => new Promise((done) => {
    const v = Flight.active, s = v.parts.find((q) => innerRadar(q.def)), hp = s.hp; s.hp = Math.round(0.38 * Combat.maxHp(s.def)); let i = 0;
    const f = () => { if (++i < 4) return requestAnimationFrame(f); const rows = window.__rd.rows.slice(); s.hp = hp; done({ rows, lines: Combat.S.rwrBox.lines }); };
    requestAnimationFrame(f);
  }));
  const lclash = Object.entries(L.P).filter(([, r]) => dl.rows.some((q) => meets({ l: q.l, r: q.r, t: q.top, b: q.b }, r))).map(([k]) => k);
  ok(tag + `the label at its widest ("${dl.rows.map((q) => q.t).join(' / ')}", ${dl.lines} line${dl.lines > 1 ? 's' : ''}) on the screen and clear of every panel and control`,
    dl.rows.length >= 1 && /DMG 62%/.test(dl.rows.map((q) => q.t).join()) && !lclash.length && dl.rows.every((q) => q.l >= 0 && q.r <= L.W && q.b <= L.H), { lclash, rows: dl.rows });
  await page.screenshot({ path: SHOTS + `radar-hud-${W}x${H}${ui !== 1 ? `-ui${ui * 100}` : ''}.png` });
  if (!full) { await ctx.close(); continue; }
  // ---- the canvas calls with ten contacts (or two on the desktop), over 20 frames: with a pick and the gun chosen at
  // most 60; with the radar missiles' lock and their reach drawn too, at most 64
  const calls = () => page.evaluate(() => new Promise((ok) => { window.__rd.calls.length = 0; let i = 0; const f = () => (++i >= 20 ? ok({ n: Radar.S.rc.length, max: Math.max(...window.__rd.calls), frames: window.__rd.calls.length }) : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  const c1 = await calls();
  await page.evaluate(() => { const v = Flight.active; Combat.S.lock = Combat.S.cand = null; Combat.S.lockT = 0; v.wsel = Combat.systems(v).findIndex((c) => c.w.kind === 'gun'); Flight.updateHUD(true); });
  const c0 = await calls();
  ok(tag + `Radar.draw: at most 60 canvas calls a frame with ${c0.n} contacts and a pick (${c0.max}); 64 with the lock and the missiles' reach too (${c1.max})`,
    c0.frames >= 8 && c1.frames >= 8 && c0.max <= 60 && c1.max <= 64 && (!touch || c0.n >= 10), { c0, c1 });
  await page.evaluate(() => { Radar.S.pick = null; Flight.updateHUD(true); });
  if (touch) {
    // ---- a tap on a bandit's marker picks it
    const m = await page.evaluate(() => { const ok = (x, y) => { const e = document.elementFromPoint(x, y); return e && e.tagName === 'CANVAS'; }; const k = Radar.S.marks.find((q) => ok(q.x, q.y)); if (!k) return null; window.__want = k.ref; return { x: k.x, y: k.y }; });
    if (m) { await page.touchscreen.tap(m.x, m.y); await page.waitForTimeout(900); }
    ok(tag + 'a tap on a bandit\'s marker picks it', !!m && (await page.evaluate(() => Radar.S.pick === window.__want && !!Radar.S.pick)), m);
    // ---- a tap on RDR: the next target; a 0.7 s hold: the radar off, and on again
    const cdp = await ctx.newCDPSession(page), T = fingers(cdp), pr = L.P.pill, px = (pr.l + pr.r) / 2, py = (pr.t + pr.b) / 2;
    const p0 = await page.evaluate(() => { window.__p0 = Radar.S.pick; return true; });
    await page.touchscreen.tap(px, py); await page.waitForTimeout(300); // (one CDP call: a slow headless frame between a separate down and up would read as a hold)
    ok(tag + 'a tap on RDR steps the pick', p0 && (await page.evaluate(() => Radar.S.pick !== window.__p0)), await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent)));
    await T.down(1, px, py); await page.waitForTimeout(700); await T.up(1); await page.waitForTimeout(200);
    let r = await page.evaluate(() => ({ off: !!Flight.active.radarOff, pill: $('#btn-radar').textContent, cls: $('#btn-radar').className }));
    let lb = await label(page);
    ok(tag + `a 0.7 s hold on RDR: the radar off ("${lb}", "${r.pill}")`, r.off && / · OFF$/.test(lb) && r.pill === 'RDR OFF' && /\boff\b/.test(r.cls), { r, lb });
    await page.screenshot({ path: SHOTS + `radar-hud-off-${W}x${H}.png` });
    await T.down(1, px, py); await page.waitForTimeout(700); await T.up(1); await page.waitForTimeout(200);
    r = await page.evaluate(() => ({ off: !!Flight.active.radarOff, pill: $('#btn-radar').textContent }));
    ok(tag + '...and held again, on', !r.off && r.pill === 'RDR PD', r);
  } else {
    // ---- I picks the next target, Shift+I steps back (past the first: auto); O off and on
    await page.keyboard.press('KeyI'); await page.waitForTimeout(150);
    const a = await page.evaluate(() => !!Radar.S.pick);
    await page.keyboard.press('Shift+KeyI'); await page.waitForTimeout(150);
    const z = await page.evaluate(() => Radar.S.pick);
    ok(tag + 'I picks a target, Shift+I steps back to auto', a && z === null, { a, z });
    await page.keyboard.press('KeyO'); await page.waitForTimeout(150);
    const off = await page.evaluate(() => !!Flight.active.radarOff), lb = await label(page);
    ok(tag + `O: the radar off ("${lb}")`, off && / · OFF$/.test(lb), lb);
    await page.keyboard.press('KeyO'); await page.waitForTimeout(150);
    ok(tag + '...and on again', !(await page.evaluate(() => !!Flight.active.radarOff)));
  }
  // ---- the set shot out: RADAR OUT on the scope, the toast, RDR OUT
  const said = await page.evaluate(() => { const v = Flight.active, p = v.parts.find((q) => innerRadar(q.def)); Combat.damage(v, p, 1e6, 'shot', Flight); Flight.updateHUD(true); return [...document.querySelectorAll('.toast')].map((t) => t.textContent); });
  const lb = await label(page), r = await page.evaluate(() => ({ pill: $('#btn-radar').textContent, cls: $('#btn-radar').className }));
  ok(tag + `the set shot out: "${lb}" on the scope and the toast${touch ? `, "${r.pill}"` : ''}`, lb === 'RADAR OUT' && said.some((t) => /knocked out: radar out/.test(t)) && (!touch || (r.pill === 'RDR OUT' && /\bout\b/.test(r.cls))), { lb, r, said });
  await page.screenshot({ path: SHOTS + `radar-hud-out-${W}x${H}.png` });
  await ctx.close();
}

// (review P3-RHUD-2, -3) a tap goes to the scope only where one is drawn: after an FS-16 flight an old design with no
// warning receiver and no radar (the Skylark) has no scope, and a tap where the FS-16's was reaches the part pick as it
// always did; and in the 2D view (no scope drawn) a tap there picks no target
if (PART !== 'builder' && (!ONLY || ONLY.includes('390x844'))) {
  const tag = '390x844 ', ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  watch(page, errs, tag);
  await openGame(page, srv.url, { targets: 'hostile' });
  await page.evaluate(() => { App.toBuild(); Builder.loadTemplate('fs16'); App.launch(); });
  await page.waitForFunction(() => Flight.running && Render3D.ready, null, { timeout: 60000 });
  await page.evaluate(fly, 2);
  await page.waitForFunction(() => Radar.S.rc.length > 0 && Combat.S.rwrBox && Combat.S.rwrBox.rad, null, { timeout: 60000 });
  const B0 = await page.evaluate(() => ({ ...Combat.S.rwrBox }));
  // the 2D view: no drawHUD, no scope; a tap at its place picks nothing
  await page.evaluate(() => { Silly.flags.retro2d = true; });
  await page.waitForFunction(() => !App.use3D() && !Combat.S.rwrBox, null, { timeout: 30000 });
  await page.evaluate(() => { document.querySelectorAll('.toast').forEach((t) => t.remove()); Radar.S.pick = null; });
  await page.touchscreen.tap(B0.x, B0.y); await page.waitForTimeout(600);
  const r2d = await page.evaluate(() => ({ pick: !!Radar.S.pick, box: Combat.S.rwrBox, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent) }));
  ok(tag + 'the 2D view: no scope (rwrBox null), and a tap at its 3D place picks no target', !r2d.pick && r2d.box === null && !r2d.toasts.some((t) => /^Target|No targets/.test(t)), r2d);
  await page.evaluate(() => { Silly.flags.retro2d = false; });
  // the Skylark next: no scope, the tap at the old place goes to the part pick
  await page.evaluate(() => { App.toBuild(); Builder.loadTemplate('skylark'); App.launch(); });
  await page.waitForFunction(() => UI.modalOpen || Flight.running, null, { timeout: 60000 });
  await page.evaluate(() => { const x = [...document.querySelectorAll('#modal-card button')].find((e) => e.textContent === 'Launch new'); if (x) x.click(); });
  await page.waitForFunction(() => Flight.running && Render3D.ready && Flight.active && Flight.active.parts.length && Flight.time > 0.5, null, { timeout: 90000 });
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => {
    window.__n = { pick: 0 }; const pk = Render3D.pickPart; Render3D.pickPart = function (...a) { window.__n.pick++; return pk.apply(this, a); };
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    return { rwr: Combat.S.rwr, aboard: Radar.aboard(Flight.active), box: Combat.S.rwrBox };
  });
  await page.touchscreen.tap(B0.x, B0.y); await page.waitForTimeout(600);
  const rs = await page.evaluate(() => ({ pick: window.__n.pick, toasts: [...document.querySelectorAll('.toast')].map((t) => t.textContent) }));
  ok(tag + 'after an FS-16 flight, the Skylark: no scope (rwrBox null), and a tap where the FS-16\'s was goes to the part pick, not the radar',
    st.rwr === 0 && !st.aboard && st.box === null && rs.pick === 1 && !rs.toasts.some((t) => /^Target|No targets/.test(t)), { st, rs, B0 });
  await ctx.close();
}

// (review FEEL-3) a bandit dead ahead at our height on a phone in portrait sits at the flight data's height, by its right
// edge: the seeker's "LOCK 6.0 km" and the marker's "Bandit 6.0 km" are drawn clear of the flight data and the buttons
// top right (beside the marker, apart from each other), not under them
for (const [W, H] of PART === 'builder' || (ONLY && !ONLY.includes('lock')) ? [] : [[360, 640], [390, 844]]) {
  const tag = `${W}x${H} lock label `, ctx = await b.newContext({ viewport: { width: W, height: H }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }), page = await ctx.newPage();
  watch(page, errs, tag);
  await openGame(page, srv.url, { targets: 'hostile' });
  await page.evaluate(() => { App.toBuild(); Builder.loadTemplate('fs16'); App.launch(); });
  await page.waitForFunction(() => Flight.running && Render3D.ready, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__lb = {};
    const P = CanvasRenderingContext2D.prototype, ft = P.fillText;
    P.fillText = function (t, x, y) {
      const m = this.canvas === App.canvas && /^(?:▸ )?(LOCK|Bandit) \d/.exec(t);
      if (m) { const w = this.measureText(t).width, l = this.textAlign === 'center' ? x - w / 2 : this.textAlign === 'right' ? x - w : x; window.__lb[m[1]] = { t, l, r: l + w, t0: y - 11, b: y + 3 }; }
      return ft.apply(this, arguments);
    };
    const v = Flight.active, r0 = Math.hypot(v.x, v.y, v.z), up = { x: v.x / r0, y: v.y / r0, z: v.z / r0 };
    v.x += up.x * 3000; v.y += up.y * 3000; v.z += up.z * 3000; const f = v.axis(0, 1, 0); v.vx = f.x * 250; v.vy = f.y * 250; v.vz = f.z * 250; v.landed = false;
    const o = Combat.spawnFighter(Flight);
    o.x = v.x + f.x * 6000; o.y = v.y + f.y * 6000; o.z = v.z + f.z * 6000; o.q = { ...v.q }; o.vx = -v.vx * 0.9; o.vy = -v.vy * 0.9; o.vz = -v.vz * 0.9; o.ai.hold = true;
    Combat.S.targets.length = 0; Combat.S.spawned = true; Combat.S.fighterT = 1e9;
  });
  await page.waitForFunction(() => Radar.S.rc.length > 0, null, { timeout: 60000 });
  ok(tag + 'a lock on the bandit dead ahead', await page.evaluate(lockOn));
  await page.waitForFunction(() => Combat.S.lock, null, { timeout: 60000 });
  await page.waitForTimeout(1200); await page.evaluate(() => { window.__lb = {}; });
  await page.evaluate(() => new Promise((ok) => { let i = 0; const f = () => (++i >= 3 ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
  const L = await page.evaluate(() => { const r = (q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const x = e.getBoundingClientRect(); return x.width > 0 ? { l: x.left, t: x.top, r: x.right, b: x.bottom } : null; };
    return { lb: window.__lb, tel: r('#flight-ui .telemetry'), top: r('#flight-ui .flight-top-right') }; });
  const box = (q) => q && { l: q.l, r: q.r, t: q.t0, b: q.b }, lk = box(L.lb.LOCK), bd = box(L.lb.Bandit);
  const clash = [['LOCK', lk], ['Bandit', bd]].flatMap(([k, a]) => [['flight data', L.tel], ['top right', L.top]].filter(([, p]) => meets(a, p)).map(([n]) => `${k}/${n}`));
  if (meets(lk, bd)) clash.push('LOCK/Bandit');
  ok(tag + `"${L.lb.LOCK && L.lb.LOCK.t}" and "${L.lb.Bandit && L.lb.Bandit.t}" drawn clear of the flight data, the buttons top right and each other`, !!lk && !!bd && !clash.length && [lk, bd].every((a) => a.l >= 0 && a.r <= W), { clash, L });
  await page.screenshot({ path: SHOTS + `radar-lock-label-${W}x${H}.png` });
  // (the roadmap's phone HUD nits) a: our engine on fire, its warning up (#flight-alert); the bandit put where its LOCK
  // tag's own place (20 px over it) is the warning's middle: both tags drawn clear of the warning, on the screen. b: the
  // bandit 14 km off, held by the radar alone, at the screen's left edge, at the flight data's height and lower: its tag
  // slid onto the screen, never cut off. The flight paused (the picture still, the HUD drawn 10 times a second)
  const N = await page.evaluate(async () => {
    const v = Flight.active, e = v.parts.find((p) => p.def.thrust);
    Death.ignite(v, e, 1, null, Flight); e.burn = 1e6;
    const fr = (n) => new Promise((ok) => { let i = 0; const g = () => (++i >= n ? ok() : requestAnimationFrame(g)); requestAnimationFrame(g); });
    for (let i = 0; i < 600 && ($('#flight-alert').hidden || !$('#flight-alert').textContent); i++) await fr(1);
    await new Promise((r) => setTimeout(r, 1300)); await fr(2); // (the warning placed: looked at once a second)
    Flight.paused = true; await fr(3);
    const rc = (q) => { const r = $(q).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, A = rc('#flight-alert'), tel = rc('#flight-ui .telemetry');
    const o = Flight.vessels.find((q) => q !== v && Combat.isFighter(q)), f = v.axis(0, 1, 0), rt = v.axis(0, 0, 1), r0 = Math.hypot(v.x, v.y, v.z), up = { x: v.x / r0, y: v.y / r0, z: v.z / r0 };
    // (the bandit d m ahead, u up and s right, put where it shows at screen point (X, Y): Newton's steps on project)
    const place = (d, u, s2) => { o.x = v.x + f.x * d + up.x * u + rt.x * s2; o.y = v.y + f.y * d + up.y * u + rt.y * s2; o.z = v.z + f.z * d + up.z * u + rt.z * s2; o.vx = v.vx; o.vy = v.vy; o.vz = v.vz; };
    const scr = (d, u, s2) => { const B = bodyPos(v.body, Flight.time); return Render3D.project(B.x + v.x + f.x * d + up.x * u + rt.x * s2, B.y + v.y + f.y * d + up.y * u + rt.y * s2, v.z + f.z * d + up.z * u + rt.z * s2); };
    const aim = (d, X, Y) => { let u = 0, s2 = 0; for (let i = 0; i < 40; i++) { const p = scr(d, u, s2), pu = scr(d, u + 20, s2), ps = scr(d, u, s2 + 20); u += ((Y - p.y) / (pu.y - p.y || -1e-3)) * 20; s2 += ((X - p.x) / (ps.x - p.x || 1e-3)) * 20; } place(d, u, s2); return scr(d, u, s2); };
    // (the tags drawn in a frame after the move: the HUD of a paused flight is drawn 10 times a second, slower here)
    const tags = async (want) => { window.__lb = {}; App.redraw(); for (let i = 0; i < 300 && !want.every((k) => window.__lb[k]); i++) await new Promise((r) => setTimeout(r, 50)); await fr(2); window.__lb = {}; App.redraw(); for (let i = 0; i < 300 && !want.every((k) => window.__lb[k]); i++) await new Promise((r) => setTimeout(r, 50)); return { ...window.__lb }; };
    const m = aim(6000, (A.l + A.r) / 2, (A.t + A.b) / 2 + 20), a = await tags(['LOCK', 'Bandit']);
    const out = { A, tel, marker: { x: m.x, y: m.y }, a, b: [] };
    // b: the lock let go, the bandit far off (the radar's alone), its marker 30 px off the left edge to 30 px in
    Combat.S.lock = Combat.S.cand = null; Combat.S.lockT = 0; Radar.S.pick = null;
    for (const Y of [tel.b - 20, tel.b + 30, innerHeight * 0.45]) for (const X of [-30, -6, 12, 30]) {
      const p = aim(14000, X, Y), t = await tags(['Bandit']);
      out.b.push({ X: Math.round(p.x), Y: Math.round(p.y), has: Radar.has(o), tag: t.Bandit || null });
    }
    Flight.paused = false;
    return out;
  });
  const own = N.a.LOCK && { l: N.marker.x - (N.a.LOCK.r - N.a.LOCK.l) / 2, r: N.marker.x + (N.a.LOCK.r - N.a.LOCK.l) / 2, t: N.marker.y - 20 - 11, b: N.marker.y - 20 + 3 };
  const tb = (q) => q && { l: q.l, r: q.r, t: q.t0, b: q.b };
  ok(tag + `our engine on fire ("${await page.evaluate(() => $('#flight-alert').textContent)}"): the locked bandit's tags, whose own place is under the warning, drawn clear of it and on the screen`,
    !!own && meets(own, N.A) && !!N.a.LOCK && !!N.a.Bandit && !meets(tb(N.a.LOCK), N.A) && !meets(tb(N.a.Bandit), N.A) && [N.a.LOCK, N.a.Bandit].every((q) => q.l >= 0 && q.r <= W && q.t0 >= 0 && q.b <= H), N);
  await page.screenshot({ path: SHOTS + `radar-fire-lock-${W}x${H}.png` });
  ok(tag + `a far bandit the radar holds at the screen's left edge: its tag on the screen wherever its marker is (${N.b.map((q) => `${q.X},${q.Y}: ${q.tag ? Math.round(q.tag.l) + '..' + Math.round(q.tag.r) : '-'}`).join('; ')})`,
    N.b.length === 12 && N.b.every((q) => q.has && q.tag && q.tag.l >= 0 && q.tag.r <= W && q.tag.t0 >= 0), N.b);
  await ctx.close();
}
ok('no page errors', !errs.length, errs.join('\n'));
await b.close(); srv.close();
ok.done();
