// The 3D view's graphics in the page (spec-graphics §13.3), on a phone in portrait (390×844, DPR 2) and a desktop
// (1280×720), on High unless noted, the pixel ratio pinned (Render3D.bench.pin), sim time read from Flight.time:
//  1. the renderer's measuring hooks: info() has scale, programs, patched and proxies; gfx() has every field; the pin
//     holds the pixel ratio at basePixelRatio() through slow frames that would cut it; the effect meshes' warm-up counts
//     down over the first flight frames drawn (and again after a quality change); bench.busy settles once a TK-34 in
//     Highland Ridge's village is built round it, bench.day reads daylight at noon; Render3D.propsCastOff takes the
//     props out of the shadow pass and puts them back. (patched.fog and patched.shadow true: the haze and the shadow
//     filter's packages)
//  2-10, 12-13. (each graphics package adds its own: proxies, tracers, particles and light, decals, Sun direction, no
//     compile at first use, water, terrain, haze against the sky, 2D fallback, screenshots)
// 11. the idle 3D hangar after a flight: nothing drawn in a second
// The console stays clean through flight, hangar and globe.
//   node test/browser/graphics.mjs       (SHOTS=<dir> saves screenshots there: graphics-*.png)
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('graphics: the 3D view\'s hooks and effects in the page');
const mapIn = () => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' && Render3D.ready;
const HL = { e: 18190, z: 15040, yaw: 0 };
// draws by pass (the shadow map's, the env cube's, the canvas'), counted from the WebGL calls while __pass is set
const PASSES = () => {
  const P = WebGL2RenderingContext.prototype, fb = P.bindFramebuffer, de = P.drawElements, da = P.drawArrays, dei = P.drawElementsInstanced, dai = P.drawArraysInstanced;
  let cur = null;
  P.bindFramebuffer = function (t, f) { if (t === this.FRAMEBUFFER || t === this.DRAW_FRAMEBUFFER) cur = f; return fb.call(this, t, f); };
  const add = (gl) => { const C = window.__pass; if (!C) return; let k = 'canvas'; if (cur) { const v = gl.getParameter(gl.VIEWPORT); k = v[2] === 2048 && v[3] === 2048 ? 'shadow' : 'env'; } C[k] = (C[k] || 0) + 1; };
  P.drawElements = function (...a) { add(this); return de.apply(this, a); };
  P.drawArrays = function (...a) { add(this); return da.apply(this, a); };
  P.drawElementsInstanced = function (...a) { add(this); return dei.apply(this, a); };
  P.drawArraysInstanced = function (...a) { add(this); return dai.apply(this, a); };
};
const GFX = ['fxN', 'fxDraw', 'streakN', 'debrisN', 'decalN', 'decals', 'engine', 'waterUvShared', 'terrDefines', 'amatDefines', 'oceanDefines', 'waterOffset', 'fogArrays', 'sunV', 'box'];

for (const [w, h, dpr, tag] of [[390, 844, 2, 'phone'], [1280, 720, 1, 'desktop']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, ...(w < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  watch(page, errs, tag + ' ');
  await page.addInitScript(PASSES);
  const ev = (f, a) => page.evaluate(f, a);
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `graphics-${name}-${tag}.png`) }); };
  // flight frames drawn from now (Render3D.frameNo counts them), n of them: the sim runs slowly here, so frames, not the clock
  const frames = async (n) => { const f0 = await ev(() => Render3D.frameNo); await page.waitForFunction(([f0, n]) => Render3D.frameNo >= f0 + n, [f0, n], { timeout: 300000, polling: 50 }); };
  await openGame(page, srv.url, { quality: 'high', fps: 0 });
  await page.waitForFunction(mapIn, null, { timeout: 300000, polling: 250 });

  // ---- 1. the measuring hooks
  const h0 = await ev((GFX) => {
    const I = Render3D.info(), G = Render3D.gfx();
    return { info: ['scale', 'programs', 'patched', 'proxies'].every((k) => k in I), patched: I.patched, proxies: I.proxies, scale: I.scale, programs: I.programs,
      gfx: GFX.filter((k) => !(k in G)), warm: G.warm, bench: Render3D.bench && ['pin', 'fill', 'day', 'sunset', 'busy', 'fogK'].every((k) => k in Render3D.bench),
      flags: Render3D.shadowAll === false && Render3D.propsCastOff === false && Render3D.bench.pin === false && Render3D.bench.fogK === 1, chunks: typeof Render3D._patchChunks === 'function' };
  }, GFX);
  ok(`${tag}: info() reports the resolution's scale, the programs, the chunk patches and the shadow stand-ins`, h0.info && h0.scale === 1 && h0.programs >= 0 && typeof h0.patched.fog === 'boolean' && typeof h0.patched.shadow === 'boolean' && h0.proxies.length === 3, h0);
  ok(`${tag}: gfx() has every field the graphics tests read; Render3D.bench, shadowAll, propsCastOff and _patchChunks are there, all off`, !h0.gfx.length && h0.bench && h0.flags && h0.chunks, h0.gfx);
  ok(`${tag}: before any flight frame the effect meshes' warm-up is still to come (3 frames)`, h0.warm === 3, h0.warm);
  // a TK-34 in Highland Ridge's village, paused (time stands still): the arena's ground, the props, the scenery and the
  // clouds built round it (Combat.frame's ground play, which a paused flight doesn't run, set as it would)
  await ev((HL) => { const t = TEMPLATES.tk34; store.set('rss.flight', null); App.showScene('flight'); Flight.start({ name: t.name, kind: t.kind, parts: templateRows(t) }, { place: HL }); Flight.paused = true; Props.play = true; Render3D.bench.pin = true; Render3D.skipDraw = true; }, HL);
  // (frames run here back to back, as the bench runs them: the planets' maps are painted a slice a frame too)
  const built = await ev(async () => {
    let n = 0, quiet = 0;
    for (; n < 8000 && quiet < 30; n++) {
      Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
      const I = Render3D.propsInfo().hl;
      quiet = !!I && I.ready && I.shown && !Render3D.bench.busy() ? quiet + 1 : 0;
      if ((n & 63) === 63) await new Promise((r) => setTimeout(r, 0));
    }
    return n;
  });
  const day = await ev(async () => {
    const f0 = Render3D.frameNo; await new Promise((r) => { const t = () => (Render3D.frameNo > f0 + 10 ? r() : setTimeout(t, 20)); t(); });
    return { busy: Render3D.bench.busy(), day: Render3D.bench.day(), sunset: Render3D.bench.sunset(), warm: Render3D.gfx().warm };
  });
  ok(`${tag}: bench.busy settles (and stays) once the village is built round the tank; bench.day reads full daylight at the start (noon), sunset none; nothing drawn yet, so the warm-up still waits`, built < 8000 && !day.busy && day.day > 0.95 && day.sunset < 0.05 && day.warm === 3, { ...day, frames: built });
  await ev(() => { Render3D.skipDraw = false; });
  await frames(4);
  const w1 = await ev(() => Render3D.gfx().warm);
  ok(`${tag}: three flight frames drawn and the warm-up is done`, w1 === 0, w1);
  // the pin: slow frames (50 ms) cut the resolution without it, and with it the pixel ratio is basePixelRatio() at once
  const pin = await ev(() => {
    Render3D.skipDraw = true; Render3D.bench.pin = false;
    for (let i = 0; i < 40; i++) Render3D.renderFlight(Flight, 0.05, false);
    const cut = Render3D.info().scale;
    Render3D.bench.pin = true;
    Render3D.renderFlight(Flight, 0.05, false);
    const I = Render3D.info();
    Render3D.skipDraw = false;
    return { cut, scale: I.scale, pr: I.pixelRatio, want: Settings.high ? Math.min(devicePixelRatio, 1.75) : 1 };
  });
  ok(`${tag}: slow frames cut the resolution (adaptive), and bench.pin puts it back to the full pixel ratio at once and holds it`, pin.cut < 1 && pin.scale === 1 && pin.pr === pin.want, pin);
  // propsCastOff: the props' shadow draws go and come back (a paused flight: the same frame each time; the shadow pass's
  // draws counted from the WebGL calls: three's info() leaves them out)
  const pass = (off) => ev((off) => { Render3D.propsCastOff = off; Flight.updateCamera(); Render3D.renderFlight(Flight, 0, true); window.__pass = {}; Render3D.renderFlight(Flight, 0, true); const p = window.__pass; window.__pass = null; return p; }, off);
  const p0 = await pass(false), p1 = await pass(true), p2 = await pass(false);
  ok(`${tag}: Render3D.propsCastOff takes the props out of the shadow pass (fewer shadow draws, the canvas' the same) and puts them back`, p1.shadow < p0.shadow && p1.canvas === p0.canvas && p2.shadow === p0.shadow, { on: p0, off: p1, back: p2 });
  await shot('village'); // (built round the tank: the quality change below rebuilds the ground and the scenery)
  // a quality change: the warm-up again over the next frames drawn
  const q = await ev(async () => {
    Render3D.skipDraw = true;
    Settings.set('quality', 'low');
    const f0 = Render3D.frameNo; await new Promise((r) => { const t = () => (Render3D.frameNo > f0 ? r() : setTimeout(t, 20)); t(); });
    const w = Render3D.gfx().warm;
    Settings.set('quality', 'high');
    const f1 = Render3D.frameNo; await new Promise((r) => { const t = () => (Render3D.frameNo > f1 ? r() : setTimeout(t, 20)); t(); });
    Render3D.skipDraw = false;
    return w;
  });
  await frames(4);
  const w2 = await ev(() => Render3D.gfx().warm);
  ok(`${tag}: a quality change starts the warm-up again (3), done over the next frames drawn`, q === 3 && w2 === 0, { afterChange: q, later: w2 });

  // the globe, then the hangar: the console stays clean
  await ev(() => { Flight.paused = false; Flight.toggleMap(); });
  await page.waitForTimeout(1500);
  await shot('globe');
  await ev(() => Flight.toggleMap());

  // ---- 11. the idle 3D hangar after the flight: nothing drawn in a second
  await ev(() => { App.heartbeat = 1e9; Settings.set('build3d', true); App.toBuild(); Builder.loadTemplate('skylark'); }); // (no half-second safety-net redraw: only asked-for draws count)
  await page.waitForFunction(() => App.preview3D(), null, { timeout: 30000 });
  const h1 = await ev(() => Render3D.info().frame);
  await page.waitForFunction((h1) => Render3D.info().frame > h1, h1, { timeout: 60000, polling: 50 }); // (the hangar drawn once: then its turntable can be stopped)
  await ev(() => Render3D.orbitBy(0, 0));
  // (the camera eases into place: wait until no frame has been drawn for a while)
  await ev(() => new Promise((ok) => { let last = Render3D.info().frame, at = performance.now(); const t0 = at; const f = () => { const n = Render3D.info().frame; if (n !== last) { last = n; at = performance.now(); } if (performance.now() - at > 1500 || performance.now() - t0 > 60000) ok(); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  const f0 = await ev(() => Render3D.info().frame);
  await page.waitForTimeout(1000);
  const f1 = await ev(() => Render3D.info().frame);
  ok(`${tag}: after the flight the idle 3D hangar draws nothing (0 renders in 1 s)`, f1 === f0, `${f1 - f0} renders`);
  await shot('hangar');
  await ctx.close();
}
ok('no console errors through flight, globe and hangar', errs.length === 0, errs.slice(0, 5).join('\n'));
ok.done();
await b.close(); srv.close();
