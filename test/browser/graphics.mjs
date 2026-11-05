// The 3D view's graphics in the page (spec-graphics §13.3), on a phone in portrait (390×844, DPR 2) and a desktop
// (1280×720), on High unless noted, the pixel ratio pinned (Render3D.bench.pin), sim time read from Flight.time:
//  1. the renderer's measuring hooks: info() has scale, programs, patched and proxies; gfx() has every field; the pin
//     holds the pixel ratio at basePixelRatio() through slow frames that would cut it; the effect meshes' warm-up counts
//     down over the first flight frames drawn (and again after a quality change); bench.busy settles once a TK-34 in
//     Highland Ridge's village is built round it, bench.day reads daylight at noon; Render3D.propsCastOff takes the
//     props out of the shadow pass and puts them back; patched.shadow: the shadow filter's chunk patch is in (the fog's
//     is the haze package's), flight draws with it (three's PCF type) and the hangar, after a flight, with three's soft PCF
//  2. the city's shadow stand-ins: a Buggy in the most built-up town at noon, paused: stand-ins hold buildings, the picture
//     is the same to the byte as with the buildings casting whole (Render3D.shadowAll), for at most a quarter of the
//     shadow pass' vertices; an instance cap overflow falls back to the whole mesh, and a scenery swap chooses afresh
//  6. the Sun's direction (G26): with a missile in flight and range targets about (both overwrite the renderer's shared
//     temporary), the light still sits along the Sun's direction, and the picture is the one without them
//  3-5, 7-10, 12-13. (each graphics package adds its own: tracers, particles and light, decals, no compile at first use,
//     water, terrain, haze against the sky, 2D fallback, screenshots)
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
  // (and the vertices drawn by pass, × instances, while __verts is set; and, while __types is set, the canvas' draws by
  // the shadow filter their program was built with: three's SHADOWMAP_TYPE_* define, 'none' without shadows)
  const ss = P.shaderSource, at = P.attachShader, up = P.useProgram, srcOf = new WeakMap(), typeOf = new WeakMap();
  let prog = null;
  P.shaderSource = function (sh, src) { srcOf.set(sh, src); return ss.call(this, sh, src); };
  P.attachShader = function (p, sh) { const m = /#define (SHADOWMAP_TYPE_\w+)/.exec(srcOf.get(sh) || ''); if (m) typeOf.set(p, m[1]); return at.call(this, p, sh); };
  P.useProgram = function (p) { prog = p; return up.call(this, p); };
  const add = (gl, n, i) => { const C = window.__pass, V = window.__verts, Y = window.__types; if (!C && !V && !Y) return; let k = 'canvas'; if (cur) { const v = gl.getParameter(gl.VIEWPORT); k = v[2] === 2048 && v[3] === 2048 ? 'shadow' : 'env'; }
    if (C) C[k] = (C[k] || 0) + 1; if (V) V[k] = (V[k] || 0) + n * i; if (Y && k === 'canvas') { const t = typeOf.get(prog) || 'none'; Y[t] = (Y[t] || 0) + 1; } };
  P.drawElements = function (m, n, t, o) { add(this, n, 1); return de.call(this, m, n, t, o); };
  P.drawArrays = function (m, f, n) { add(this, n, 1); return da.call(this, m, f, n); };
  P.drawElementsInstanced = function (m, n, t, o, i) { add(this, n, i); return dei.call(this, m, n, t, o, i); };
  P.drawArraysInstanced = function (m, f, n, i) { add(this, n, i); return dai.call(this, m, f, n, i); };
  // a frame drawn with Math.random seeded (the engine's flicker) and the whole canvas read back at once: an FNV-1a hash
  window.__mb = (s) => () => { let t = (s = (s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__shot = () => {
    const r = Math.random; Math.random = window.__mb(1); window.__verts = {};
    Flight.updateCamera(); Render3D.renderFlight(Flight, 0, true);
    const gl = document.getElementById('view3d').getContext('webgl2'), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const verts = window.__verts; window.__verts = null; Math.random = r;
    let hs = 0x811c9dc5; for (let i = 0; i < buf.length; i++) { hs ^= buf[i]; hs = Math.imul(hs, 16777619); }
    return { hash: hs >>> 0, verts, w, h };
  };
};
const T_NOON = 70500, TOWN = { e: 35000, z: 25000, yaw: 0.4 }; // (test/bench/render-bench.mjs: noon over the runway, the most built-up town near it)
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
  ok(`${tag}: the shadow filter's chunk patch is in (info().patched.shadow)`, h0.patched.shadow === true, h0.patched);
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
  // the flight Sun's shadow filter: every shadowed program the canvas draws with is three's PCF type (its branch patched
  // to 4 taps and a faded edge), none the hangar's soft PCF
  const ty = await ev(() => { window.__types = {}; Flight.updateCamera(); Render3D.renderFlight(Flight, 0, true); const t = window.__types; window.__types = null; return t; });
  ok(`${tag}: in flight the shadowed programs are the 4-tap filter's (three's PCF type, patched), none three's soft 16 taps`, ty.SHADOWMAP_TYPE_PCF > 10 && !ty.SHADOWMAP_TYPE_PCF_SOFT, ty);
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
  // and the hangar's shadows are three's own soft PCF (16 taps), as before: no program of flight's in it
  const ht = await ev(() => { window.__types = {}; Render3D.orbitBy(0.01, 0); Render3D.renderBuilder(Builder, 0, true); const t = window.__types; window.__types = null; Render3D.orbitBy(-0.01, 0); return t; });
  ok(`${tag}: after a flight the hangar draws its shadowed parts with three's soft PCF (16 taps), none with flight's filter`, ht.SHADOWMAP_TYPE_PCF_SOFT > 0 && !ht.SHADOWMAP_TYPE_PCF, ht);
  await shot('hangar');

  // ---- 2. the city's shadow stand-ins, at noon in the most built-up town: a craft paused and everything built round it.
  // (A fresh page: Highland Ridge's arena mesh, left half built above, would keep bench.busy true for good)
  const pt = await ctx.newPage();
  watch(pt, errs, tag + ' town ');
  await pt.addInitScript(PASSES);
  const ev2 = (f, a) => pt.evaluate(f, a);
  await openGame(pt, srv.url, { quality: 'high', fps: 0 });
  await pt.waitForFunction(mapIn, null, { timeout: 300000, polling: 250 });
  await ev2(() => App.showScene('flight'));
  const town = (key, place) => ev2(async ([key, place, T_NOON]) => {
    const t = TEMPLATES[key];
    store.set('rss.flight', null); Flight.start({ name: t.name, kind: t.kind, parts: templateRows(t) }, { place }); Flight.paused = true; Flight.time = T_NOON; Props.play = false;
    Render3D.bench.pin = true; Render3D.skipDraw = true;
    let n = 0, quiet = 0;
    for (; n < 8000 && quiet < 30; n++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); quiet = Render3D.bench.busy() ? 0 : quiet + 1; if ((n & 63) === 63) await new Promise((r) => setTimeout(r, 0)); }
    Render3D.skipDraw = false;
    return { frames: n, day: Render3D.bench.day() };
  }, [key, place, T_NOON]);
  // the picture as it is, with every building casting whole (shadowAll), and as it is again
  const triple = () => ev2(() => {
    Render3D.shadowAll = false; const a = window.__shot(), I = Render3D.info(), G = Render3D.gfx();
    Render3D.shadowAll = true; const b = window.__shot(), Ib = Render3D.info();
    Render3D.shadowAll = false; const c = window.__shot();
    return { a: a.hash, b: b.hash, c: c.hash, va: a.verts.shadow || 0, vb: b.verts.shadow || 0, ca: a.verts.canvas, cb: b.verts.canvas, proxies: I.proxies, proxiesAll: Ib.proxies, box: G.box.half, scenery: G.scenery };
  });
  const tw = await town('buggy', TOWN);
  const s2 = await triple();
  ok(`${tag}: a Buggy in town at noon, everything built (${tw.frames} frames); the shadow stand-ins hold buildings (walls, roofs, boats ${s2.proxies.join(', ')})`, tw.frames < 8000 && tw.day > 0.95 && s2.proxies[0] > 0 && s2.proxies[1] > 0, { ...tw, ...s2 });
  ok(`${tag}: the picture with the stand-ins is the picture with every building casting whole, to the byte (and again after)`, s2.a === s2.b && s2.c === s2.a && s2.ca === s2.cb && s2.proxiesAll.every((x) => x === 0), s2);
  ok(`${tag}: the shadow pass draws at most a quarter of the vertices it drew with the buildings casting whole (${s2.va} against ${s2.vb})`, s2.vb > 0 && s2.va <= 0.25 * s2.vb, s2);
  if (SHOTS) await pt.screenshot({ path: path.join(SHOTS, `graphics-town-${tag}.png`) });
  // a scenery swap mid-flight: 600 m on, the next set is built behind the one on show and swapped in; the stand-ins are chosen afresh
  const tw2 = await town('buggy', { ...TOWN, e: TOWN.e + 600 });
  const s2b = await triple();
  ok(`${tag}: 600 m on, the scenery built afresh and swapped in (set ${s2.scenery.id}/${s2.scenery.ver} → ${s2b.scenery.id}/${s2b.scenery.ver}): the stand-ins chosen afresh, the picture still the whole-casting one to the byte, fewer shadow vertices`, JSON.stringify(s2b.scenery) !== JSON.stringify(s2.scenery) && s2b.proxies[0] > 0 && s2b.a === s2b.b && s2b.c === s2b.a && s2b.va < s2b.vb, { ...tw2, ...s2b, before: s2.scenery });
  // fewer than that in a stand-in (Render3D.bench.proxyCap 2, as a box too big for the stand-ins would be): walls and
  // roofs fall back to casting whole, the same picture, nearly the vertices of casting whole (the boats, none in reach,
  // still cast nothing)
  const s2c = await ev2(() => { Render3D.bench.proxyCap = 2; const a = window.__shot(), I = Render3D.info(); Render3D.shadowAll = true; const b = window.__shot(); Render3D.shadowAll = false;
    Render3D.bench.proxyCap = 0; const c = window.__shot(), Ic = Render3D.info(); return { a: a.hash, b: b.hash, c: c.hash, va: a.verts.shadow, vb: b.verts.shadow, vc: c.verts.shadow, proxies: I.proxies, back: Ic.proxies }; });
  ok(`${tag}: more buildings in reach than a stand-in holds: those meshes cast whole (stand-ins ${s2c.proxies.join(', ')}), the same picture; back to the stand-ins after`, s2c.proxies[0] === 0 && s2c.proxies[1] === 0 && s2c.a === s2c.b && s2c.va <= s2c.vb && s2c.va > s2c.vc && s2c.c === s2c.a && s2c.back[0] > 0, s2c);
  // a Jumbo in town: a bigger shadow box (twice the Buggy's), more stand-ins, the same picture to the byte
  await town('jumbo', TOWN);
  const s2d = await triple();
  ok(`${tag}: a Jumbo's bigger shadow box (half-width ${s2d.box} m): more stand-ins (${s2d.proxies.join(', ')}), the picture the same to the byte`, s2d.box > s2.box && s2d.proxies[0] > s2.proxies[0] && s2d.a === s2d.b && s2d.c === s2d.a && s2d.va < s2d.vb, s2d);

  // ---- 6. the Sun's direction: a missile in flight and range targets about write the renderer's shared temporary
  // before the shadows are placed; the light must still sit along the Sun's direction (G26), and with them out of
  // sight the picture is the one without them
  await town('buggy', TOWN);
  const s6 = await ev2((TOWN) => {
    const v = Flight.active, f = v.axis(1, 0, 0), u = v.axis(0, 1, 0), base = window.__shot().hash;
    const sun = () => { const G = Render3D.gfx(), d = { x: G.sunAt.x - G.box.cx, y: G.sunAt.y - G.box.cy, z: G.sunAt.z - G.box.cz }, l = Math.hypot(d.x, d.y, d.z), s = G.sunV;
      return 1 - (d.x * s.x + d.y * s.y + d.z * s.z) / l; };
    // a missile 3 km behind (out of view and of the shadow box), climbing; a range tank 5 km behind
    const back = (k) => ({ x: v.x - f.x * k, y: v.y - f.y * k, z: v.z - f.z * k });
    const m = back(3000);
    Combat.shots.push({ k: 'missile', b: v.body, ...m, vx: u.x * 300, vy: u.y * 300, vz: u.z * 300, dx: u.x, dy: u.y, dz: u.z, t: 1, life: 60 });
    const tg = { kind: 'tank', def: TARGET_KINDS.tank, pos: back(5000), vel: null, heading: 0.3, alive: true, hp: 1 };
    Combat.targets.push(tg);
    const off = sun(), hash = window.__shot().hash, on = sun();
    Combat.shots.pop(); Combat.targets.splice(Combat.targets.indexOf(tg), 1);
    return { off, on, same: hash === base };
  }, TOWN);
  ok(`${tag}: with a missile in flight and a range target about, the Sun's light sits along the Sun's direction (1 − cos ${s6.on.toExponential(1)})`, s6.on < 1e-9 && s6.off < 1e-9, s6);
  ok(`${tag}: and with both out of sight the picture is the one without them, to the byte (shadows didn't swing)`, s6.same, s6);
  await pt.close();
  await ctx.close();
}
ok('no console errors through flight, globe and hangar', errs.length === 0, errs.slice(0, 5).join('\n'));
ok.done();
await b.close(); srv.close();
