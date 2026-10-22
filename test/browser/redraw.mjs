// Redraw on demand (battery): the hangar is drawn only when something changes, so a change that forgets to ask for a
// redraw would leave a stale picture on screen. Every kind of edit, by hand and from code, must show at once in 2D
// and 3D; the idle 2D and 3D hangar must stop drawing; the home backdrop draws 30 times a second and a paused
// flight 10; the frame cap gives a 90-144 Hz screen 60 frames' work a second.
//   node test/browser/redraw.mjs        (screenshots go to test/.cache/shots/)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = path.join(ROOT, 'test', '.cache', 'shots') + path.sep;
fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch();
const page = await (await b.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
const errs = [];
watch(page, errs);
await openGame(page, srv.url, { build3d: false, fps: 0 });
const ev = (f, a) => page.evaluate(f, a);
const frames = (n) => ev((n) => new Promise((ok) => { let i = 0; const f = () => (++i >= n ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const ok = checks('Redraw on demand: every edit shows at once, idle screens stop drawing');
// count what gets drawn; no safety-net redraws (only the ones asked for count)
await ev(() => {
  window.__n = { b2: 0, b3: 0, home: 0, flight: 0 };
  const wrap = (o, k, c) => { const f = o[k]; o[k] = function (...a) { const r = f.apply(this, a); if (r !== false) window.__n[c]++; return r; }; };
  wrap(Builder, 'render', 'b2'); wrap(Render3D, 'renderBuilder', 'b3'); wrap(App, 'renderHome', 'home'); wrap(Render3D, 'renderFlight', 'flight');
  App.heartbeat = 1e9;
  window.__hash = () => { const c = App.canvas, d = App.ctx.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 3) h = (h * 31 + d[i]) | 0; return h; };
});
const at = (pick) => ev((pick) => { const p = Builder.parts.find((q) => q.type === pick) || Builder.parts[0], s = Builder.partScreen(p); return { x: s.x, y: s.y }; }, pick);
const idle = async (key, ms = 1000) => { const n0 = await ev((k) => __n[k], key); await page.waitForTimeout(ms); return (await ev((k) => __n[k], key)) - n0; };
// draws over the next n animation frames
const over = (key, n) => ev(([k, n]) => new Promise((ok) => { const c0 = __n[k]; let i = 0; const f = () => (++i >= n ? ok(__n[k] - c0) : requestAnimationFrame(f)); requestAnimationFrame(f); }), [key, n]);
// a spot on the blueprint with no part and no panel over it
const empty = () => ev(() => {
  for (let y = 120; y < innerHeight - 200; y += 20) for (let x = innerWidth - 60; x > 60; x -= 20) {
    if (document.elementFromPoint(x, y) !== App.canvas) continue;
    if (!App.preview3D() && Builder.hitParts(Builder.screenToWorld(x, y)).length) continue;
    if (App.preview3D() && Render3D.pickPart(x, y)) continue;
    return { x, y };
  }
  return null;
});
// software WebGL draws slowly, so easing takes a while here: wait until the 3D hangar has not drawn for a while
const settle3d = () => ev(() => new Promise((ok) => {
  let last = __n.b3, at = performance.now();
  const t0 = at, f = () => { if (__n.b3 !== last) { last = __n.b3; at = performance.now(); } if (performance.now() - at > 1500 || performance.now() - t0 > 40000) ok(); else requestAnimationFrame(f); };
  requestAnimationFrame(f);
}));

// ---- the 2D blueprint
await ev(() => { App.toBuild(); Builder.loadTemplate('skylark'); });
await frames(4); await page.waitForTimeout(300);
let n = await idle('b2');
ok('the idle 2D blueprint is not drawn again', n === 0, `${n} draws in 1 s`);
const shows = async (name, act) => {
  const h0 = await ev(() => __hash());
  await act();
  await frames(3);
  const h1 = await ev(() => __hash());
  ok(`2D: ${name} shows at once`, h1 !== h0);
};
const wing = await at('wing');
await shows('a click on a part (selects it)', () => page.mouse.click(wing.x, wing.y));
await shows('a part dragged (while it moves)', async () => { const p = await at('tailcone'); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 30, p.y - 20, { steps: 4 }); });
await page.mouse.up(); await frames(3);
await shows('undo (button)', () => page.click('#btn-undo'));
await shows('redo (Ctrl+Y)', () => page.keyboard.press('Control+KeyY'));
await ev(() => { Builder.selected = Builder.parts.find((p) => p.type === 'wing'); Builder.renderInfo(); });
await frames(3);
await shows('paint (a swatch)', () => page.click('#pi-skins .skin-sw[data-skin="stealth"]'));
await shows('rotate (R)', async () => { await ev(() => { Builder.selected = Builder.parts.find((p) => p.def.wheel) || Builder.parts[1]; Builder.renderInfo(); }); await page.keyboard.press('KeyR'); });
await shows('zoom (wheel)', async () => { await page.mouse.move(600, 380); await page.mouse.wheel(0, -240); });
await shows('pan (drag empty space)', async () => { const p = await empty(); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x - 50, p.y + 40, { steps: 3 }); await page.mouse.up(); });
await shows('symmetry off (button)', () => page.click('#btn-sym'));
await shows('grid on (G)', () => page.keyboard.press('KeyG'));
await shows('Fit (button)', () => page.click('#btn-fit'));
// from code, with no input at all: a multiplayer update, the hangar loading a design, a pick
await shows('a template loaded from code', () => ev(() => Builder.loadTemplate('hornet')));
await shows('a selection made from code', () => ev(() => { Builder.selected = Builder.parts[2]; Builder.renderInfo(); }));
await shows('paint changed from code (as a battle update does)', () => ev(() => { for (const p of Builder.parts) p.skin = 'grey'; Builder.changed(true); }));
await shows('the window resized', () => page.setViewportSize({ width: 1100, height: 740 }));
n = await idle('b2', 600);
ok('...and then it is idle again', n === 0, `${n} draws`);

// ---- the 3D hangar
await page.keyboard.press('KeyV');
await page.waitForFunction(() => Render3D.ready && App.preview3D(), null, { timeout: 30000 });
await ev(() => { Builder.loadTemplate('skylark'); Render3D.orbitBy(0, 0); }); // (the turntable stops)
await settle3d(); // (the camera eases into place)
const gl = () => ev(() => Render3D.info().frame);
let f0 = await gl(); await page.waitForTimeout(1000); let f1 = await gl();
ok('the idle 3D hangar issues no draw calls', f1 === f0, `${f1 - f0} renders in 1 s`);
ok('...and leaves the 2D canvas over it alone', await ev(() => !App.ink));
// the canvases only (the panels over them change with an edit too)
const ui = (on) => ev((on) => { for (const id of ['build-ui', 'toasts']) document.getElementById(id).style.visibility = on ? '' : 'hidden'; }, on);
const shot = async () => { await ui(false); const s = await page.screenshot({ clip: { x: 0, y: 0, width: 1100, height: 740 } }); await ui(true); return s; };
const shows3 = async (name, act) => {
  const s0 = await shot();
  await act();
  await frames(4);
  const s1 = await shot();
  ok(`3D: ${name} shows at once`, !s0.equals(s1));
};
await shows3('turning the view (drag)', async () => { const p = await empty(); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x - 60, p.y + 20, { steps: 4 }); await page.mouse.up(); });
await shows3('zoom (wheel)', async () => { await page.mouse.move(600, 380); await page.mouse.wheel(0, 200); });
await settle3d();
await shows3('a click on a part (selects it)', async () => { const p = await at('fuselageS'); await page.mouse.click(p.x, p.y); });
await shows3('paint (a swatch)', () => page.click('#pi-skins .skin-sw[data-skin="stealth"]'));
await shows3('undo (button)', () => page.click('#btn-undo'));
await settle3d(); // (no input for a while: only the edit itself can ask for a picture)
await shows3('a template loaded from code', () => ev(() => Builder.loadTemplate('hornet')));
await settle3d();
await shows3('a selection made from code', () => ev(() => { Builder.selected = Builder.parts[1]; Builder.renderInfo(); }));
await page.screenshot({ path: SHOTS + 'redraw-3d.png' });
await settle3d();
f0 = await gl(); await page.waitForTimeout(1000); f1 = await gl();
ok('...and then it stops drawing again', f1 === f0, `${f1 - f0} renders in 1 s`);
await ev(() => Render3D.resetCamera()); // (the turntable spins again: it draws every frame)
n = await over('b3', 8);
ok('the spinning turntable draws every frame', n >= 7, `${n} draws in 8 frames`);

// ---- how often things are drawn, on synthetic frame times: App.frame is called with made-up times, hz frames a
// second, its own frame requests held back. (Real frames come far too slowly and unevenly under software WebGL.)
const synth = (fps, hz, secs = 1) => ev(([fps, hz, secs]) => {
  const raf = window.requestAnimationFrame, keep = ['last', 'due', 'next', 'drawnAt', 'lag', 'dirty', 'busyUntil', 'view'].map((k) => [k, App[k]]);
  const fps0 = Settings.data.fps, n0 = { ...__n }, st = App.stale;
  let work = 0;
  window.requestAnimationFrame = () => 0; // (the loop's own next frame is already asked for: it carries on afterwards)
  Settings.data.fps = fps;
  App.stale = function (...a) { work++; return st.apply(this, a); }; // (once a frame that does its work)
  App.due = 0;
  try { for (let i = 1, t0 = App.last; i <= hz * secs; i++) App.frame(t0 + (i * 1000) / hz); } finally {
    App.stale = st; window.requestAnimationFrame = raf; Settings.data.fps = fps0;
    for (const [k, v] of keep) App[k] = v;
  }
  const out = { work };
  for (const k in __n) out[k] = __n[k] - n0[k];
  return out;
}, [fps, hz, secs]);
const near = (v, want, tol) => Math.abs(v - want) <= tol;
await ev(() => App.toHome());
await frames(2);
const cap = { c120: await synth(60, 120), c90: await synth(60, 90), c144: await synth(60, 144), c60: await synth(60, 60), u120: await synth(0, 120), u60: await synth(0, 60) };
console.log('home, 1 s of frames: work done, backdrop drawn', JSON.stringify(Object.fromEntries(Object.entries(cap).map(([k, r]) => [k, [r.work, r.home]]))));
ok('frame cap 60: a 120 Hz screen does 60 frames of work a second', near(cap.c120.work, 60, 2));
ok('frame cap 60: a 90 Hz screen does 60', near(cap.c90.work, 60, 2));
ok('frame cap 60: a 144 Hz screen does about 60', near(cap.c144.work, 60, 4));
ok('frame cap 60: a 60 Hz screen loses no frame', cap.c60.work === 60);
ok('no cap: a 120 Hz screen does all 120', cap.u120.work === 120);
ok('the home backdrop draws 30 times a second', [cap.c120, cap.c90, cap.c144, cap.c60, cap.u120, cap.u60].every((r) => near(r.home, 30, 1)), JSON.stringify([cap.c120, cap.c90, cap.c144, cap.c60, cap.u120, cap.u60].map((r) => r.home)));
await ev(() => App.showSettings());
let r = await synth(0, 60);
ok('...and 10 times a second under a dialog', near(r.home, 10, 1), r.home);
await ev(() => UI.closeModal());
// the 3D hangar with its turntable spinning: every frame, but 10 a second under a dialog
await ev(() => { App.toBuild(); Render3D.resetCamera(); });
await frames(2);
r = await synth(0, 60, 0.5);
ok('the spinning turntable draws every frame', r.b3 === 30, r.b3);
await ev(() => App.showResearch());
r = await synth(0, 60, 0.5);
ok('...and 10 times a second under a dialog', near(r.b3, 5, 1), r.b3);
await ev(() => UI.closeModal());
// a flight: every frame; paused, or under a dialog, 10 frames a second (no GL drawing here: it would be slow)
await ev(() => { Render3D.skipDraw = true; Builder.loadTemplate('hopper'); App.launch(); });
await page.waitForFunction(() => App.scene === 'flight' && Flight.running, null, { timeout: 60000 });
await frames(5);
r = await synth(0, 60);
ok('a flight is drawn every frame', r.flight === 60, r.flight);
await ev(() => Flight.openMenu());
r = await synth(0, 60);
ok('a paused flight 10 times a second', near(r.flight, 10, 1), r.flight);
await ev(() => { UI.closeModal(); App.showHelp(); });
r = await synth(0, 60);
ok('a flight under a dialog 10 times a second', near(r.flight, 10, 1), r.flight);
await ev(() => { UI.closeModal(); Render3D.skipDraw = false; });

ok('no page errors', errs.length === 0, errs.join('\n'));
ok.done();
await b.close(); srv.close();
