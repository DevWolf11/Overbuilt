// The 3D view's graphics in the page (spec-graphics §13.3), on a phone in portrait (390×844, DPR 2) and a desktop
// (1280×720), on High unless noted, the pixel ratio pinned (Render3D.bench.pin), sim time read from Flight.time:
//  1. the renderer's measuring hooks: info() has scale, programs, patched and proxies; gfx() has every field; the pin
//     holds the pixel ratio at basePixelRatio() through slow frames that would cut it; the effect meshes' warm-up counts
//     down over the first flight frames drawn (and again after a quality change); bench.busy settles once a TK-34 in
//     Highland Ridge's village is built round it, bench.day reads daylight at noon; Render3D.propsCastOff takes the
//     props out of the shadow pass and puts them back; patched is { fog: true, shadow: true }: both chunk patches are in,
//     flight draws with it (three's PCF type) and the hangar, after a flight, with three's soft PCF;
//     a debris chunk is a dark lumpy chunk over the sky, not a faint light
//  2. the shadow pass cut to the Sun's shadow box: in Highland Ridge's village only the props within its reach cast, the
//     picture the same to the byte as with every prop casting (Render3D.shadowAll), for fewer shadow vertices. And the
//     city's shadow stand-ins: a Buggy in the most built-up town at noon, paused: stand-ins hold buildings, the picture
//     is the same to the byte as with the buildings casting whole (Render3D.shadowAll), for at most a quarter of the
//     shadow pass' vertices; an instance cap overflow falls back to the whole mesh, and a scenery swap chooses afresh;
//     started on an open spot in town, the first building to come within the box builds no shader then
//  6. the Sun's direction (G26): with a missile in flight and range targets about (both overwrite the renderer's shared
//     temporary), the light still sits along the Sun's direction, and the picture is the one without them
//  7. no shader built at the first explosion, chunk, spark or tracer (the effect meshes are on show, empty, through the
//     warm-up)
//  3. tracers: one glowing streak each (one draw for all, today two), a round without a tracer drawn not at all, a shot's
//     own colour, core width and length (s.col, s.tw, s.tk) taken, a tracer 2 km off at least 1.5 CSS px wide; a drone's
//     laser beam (Drone.beams) drawn as a streak bright all along
//  4. particles and light: an ammo death 40 m from a TK-34 in Highland Ridge: the particle, chunk and streak meshes one
//     draw each; its flash lends S.engine its light at once, at the flash, gone by 0.6 s (a flash with light: false
//     lends none); the chunks come to rest on the ground under them; five deaths stay under the cap; a puff by the ground thins out
//     towards it; a mid-air death 75 m off whites out under a tenth of the screen (its flash and shock ring held to
//     GLOW_MAX of the screen however near)
// 12. the 2D fallback (Silly retro2d): every FX.death kind drawn by FX.draw without an error
// 13. (SHOTS) screenshots of every FX.death kind, the presets, a muzzle flash, flares, chaff, tracers, dust, a splash,
//     damage smoke and a smoke screen
//  5. the shadow box (50 m round a tank's turret camera, pushed 12.5 m into the view; the tight 25 m in the gunner's
//     sight); contact shadows and scorch marks, all in one draw: a still TK-34 and a Buggy on blobs (0.32 on High within
//     the box, 0.6 on Low), none under a Falcon 200 m up, a scorch under a wreck (0.8 after an ammunition detonation,
//     fading in over a second), a round scorch at a crash site that outlives its pyre and goes at 300 s (and with the
//     crash sites wiped before their time, a new flight's); SHOTS: graphics-decals-high/-low
//  8. water: the sea's and the lakes' surfaces run on the ground's very UV attribute (before and after a quality change),
//     their ripples drift with frames drawn in flight and stand still while paused, the second ripple set (OB_HI) on High
//     only
//  9. terrain: the ground's 48 m variation (OB_HI) on the patch and the arena's own ground on High and on neither on Low,
//     the two drawn with one shader program (the arena's ground first shown on Low builds none)
// 10. the haze matches the sky: at dusk on the runway, everything past a kilometre fogged (bench.fogK 200), the ground
//     2 px under the horizon line and the sky 2 px over it agree within 4/255 a channel away from the Sun and 8/255
//     towards it (today's fog, after the tone mapping, missed it by far more); the haze's shared uniforms are written each
//     frame (the sky's own Sun and sunset), patched.fog: the chunk patch is in
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
  // the flight's axes along the ground (forward, right, up at the craft) and a point a m ahead, s m right, u m up (on the
  // ground as the physics has it: u over it)
  window.__ax = () => { const v = Flight.active, r0 = Math.hypot(v.x, v.y, v.z), up = { x: v.x / r0, y: v.y / r0, z: v.z / r0 }, F = v.pilot.F, f = v.axis(F.x, F.y, F.z), k0 = f.x * up.x + f.y * up.y + f.z * up.z;
    const fw = { x: f.x - up.x * k0, y: f.y - up.y * k0, z: f.z - up.z * k0 }, fl = Math.hypot(fw.x, fw.y, fw.z); fw.x /= fl; fw.y /= fl; fw.z /= fl;
    return { fw, up, rt: { x: fw.y * up.z - fw.z * up.y, y: fw.z * up.x - fw.x * up.z, z: fw.x * up.y - fw.y * up.x } }; };
  window.__at = (a, s, u, ground) => { const v = Flight.active, A = window.__ax(), p = { x: v.x + A.fw.x * a + A.rt.x * s + A.up.x * u, y: v.y + A.fw.y * a + A.rt.y * s + A.up.y * u, z: v.z + A.fw.z * a + A.rt.z * s + A.up.z * u };
    if (!ground) return p; const L = Terrain.locate(v.body, p.x, p.y, p.z, {}), rr = v.body.radius + Terrain.surfaceAt(v.body, L.a, L.z) + u, n = Math.hypot(p.x, p.y, p.z); return { x: (p.x / n) * rr, y: (p.y / n) * rr, z: (p.z / n) * rr }; };
  // everything round the craft built again (after a quality change: the ground, the scenery, the props), nothing drawn
  window.__rebuild = async () => {
    Render3D.skipDraw = true;
    let n = 0;
    for (let quiet = 0; n < 8000 && quiet < 30; n++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); const I = Render3D.propsInfo().hl; quiet = (!Props.play || (I && I.ready && I.shown)) && !Render3D.bench.busy() ? quiet + 1 : 0; if ((n & 63) === 63) await new Promise((r) => setTimeout(r, 0)); }
    Render3D.skipDraw = false;
    return n;
  };
  // a frame drawn (the paused flight: the same moment), its canvas draws counted
  window.__draws = () => { window.__pass = {}; Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); const c = window.__pass.canvas || 0; window.__pass = null; return c; };
  // (and every shader program the page builds: window.__nprog)
  const cp = P.createProgram; window.__nprog = 0; P.createProgram = function () { window.__nprog++; return cp.call(this); };
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
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `graphics-${name}-${tag}.png`), timeout: 180000 }); }; // (a frame on High in the village is slow under SwiftShader)
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
  ok(`${tag}: the haze's chunk patch is in (info().patched is { fog: true, shadow: true })`, h0.patched.fog === true && h0.patched.shadow === true, h0.patched);
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

  // ---- 7. no shader built at first use: the effect meshes were on show (empty) through the warm-up
  const p7 = await ev(() => {
    const n0 = window.__nprog, i0 = Render3D.info().programs, v = Flight.active, Z = { x: 0, y: 0, z: 0 }, A = window.__ax(), p = window.__at(20, -6, 2);
    FX.clear(); FX.seed(3); FX.death(v.body, window.__at(40, 0, 1.2, true), Z, 5, 'ammo');
    Combat.shots.push({ k: 'bullet', tracer: true, b: v.body, x: p.x, y: p.y, z: p.z, vx: A.rt.x * 900, vy: A.rt.y * 900, vz: A.rt.z * 900 });
    window.__draws();
    const G = Render3D.gfx(), out = { built: window.__nprog - n0, programs: Render3D.info().programs - i0, fx: G.fxDraw, debris: G.debrisN, streak: G.streakN, shown: G.fxShown };
    Combat.shots.pop(); FX.clear(); window.__draws();
    out.after = Render3D.gfx().fxShown;
    return out;
  });
  ok(`${tag}: the first explosion, its chunks and sparks and the first tracer build no shader (${p7.built} built in that frame)`, p7.built === 0 && p7.programs === 0 && p7.fx > 0 && p7.debris > 0 && p7.streak > 1 && p7.shown.every(Boolean), p7);
  ok(`${tag}: with nothing to draw, the three effect meshes are off again (no draw at all)`, p7.after.every((x) => !x), p7.after);

  // ---- 3. tracers
  const p3 = await ev(() => {
    const v = Flight.active, A = window.__ax(), bp = bodyPos(v.body, Flight.time), pr = Render3D.info().pixelRatio, shot = (p, sp, o) => Object.assign({ k: 'bullet', tracer: true, b: v.body, x: p.x, y: p.y, z: p.z, vx: A.rt.x * sp, vy: A.rt.y * sp, vz: A.rt.z * sp }, o);
    FX.clear(); Combat.shots.length = 0;
    const d0 = window.__draws();
    for (let i = 0; i < 12; i++) Combat.shots.push(shot(window.__at(30 + i * 8, (i % 3) * 3 - 3, 2), 900));
    Combat.shots.push(shot(window.__at(60, 0, 4), 900, { tracer: false })); // (a round without a tracer: not drawn)
    const d1 = window.__draws(), n1 = Render3D.gfx().streakN;
    Combat.shots.length = 0;
    Combat.shots.push(shot(window.__at(50, 0, 3), 300, { col: [1, 0.25, 0.3], tw: 0.06, tk: 0.004 })); // (its own colour, core width and length)
    window.__draws(); const own = Render3D.gfx().streaks[0], len = Math.hypot(own.a[0] - own.b[0], own.a[1] - own.b[1], own.a[2] - own.b[2]);
    // 2 km off: the core at least 1.5 CSS px wide (the shader: max(floor, width × px per metre))
    Combat.shots.length = 0;
    const far = window.__at(2000, 0, 40);
    Combat.shots.push(shot(far, 900));
    window.__draws(); const fr = Render3D.gfx().streaks[0], pj = Render3D.project(bp.x + far.x, bp.y + far.y, far.z), mpp = Render3D.metresPerPixelAt(bp.x + far.x, bp.y + far.y, far.z);
    const coreCss = Math.max(fr.f / pr, fr.c[3] / mpp);
    Combat.shots.length = 0;
    // a drone's laser (Drone.beams, the drone package's: a stand-in here when there is none yet)
    const had = typeof Drone !== 'undefined', D = had ? Drone : (window.Drone = {}), keep = D.beams;
    D.beams = [{ b: v.body, a: window.__at(5, 0, 3), e: window.__at(80, 10, 6), col: [1, 0.25, 0.3], w: 0.06 }];
    window.__draws(); const bm = Render3D.gfx().streaks[0], nb = Render3D.gfx().streakN;
    D.beams = keep; if (!had) delete window.Drone;
    window.__draws();
    return { draws: d1 - d0, n1, own, len, coreCss, far: { behind: pj.behind, x: pj.x, y: pj.y }, f: fr.f, pr, bm, nb };
  });
  ok(`${tag}: twelve tracers (and a round without one) are twelve glowing streaks in one draw (today's lines and heads were two)`, p3.n1 === 12 && p3.draws === 1, p3);
  const near = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
  ok(`${tag}: a shot's own colour, core width and length are taken (s.col, s.tw, s.tk: a laser pulse's)`, near(p3.own.c, [1, 0.25, 0.3, 0.06]) && Math.abs(p3.len - 1.2) < 1e-3, p3.own);
  ok(`${tag}: a tracer 2 km off is at least 1.5 CSS px wide (${p3.coreCss.toFixed(2)} px: the floor)`, !p3.far.behind && p3.coreCss >= 1.5 - 1e-6 && Math.abs(p3.f - 1.5 * p3.pr) < 1e-9, p3);
  ok(`${tag}: a drone's laser beam (Drone.beams) is a streak, bright all along (core width negative), its colour, 1.5 px at least`, p3.nb === 1 && near(p3.bm.c, [1, 0.25, 0.3, -0.06]) && Math.abs(p3.bm.f - 1.5 * p3.pr) < 1e-9, p3.bm);

  // ---- 4. particles and light: an ammo death 40 m from the tank
  const p4 = await ev(() => {
    const v = Flight.active, Z = { x: 0, y: 0, z: 0 }, at = window.__at(40, 0, 1.2, true), bp = bodyPos(v.body, Flight.time), C = Flight.camAbs;
    const lx = bp.x + at.x - C.x, ly = bp.y + at.y - C.y, lz = at.z - C.z; // (where the light should be: the scene's floating origin)
    FX.clear(); const d0 = window.__draws();
    FX.seed(5); FX.death(v.body, at, Z, 5, 'ammo');
    const d1 = window.__draws(), G1 = Render3D.gfx(), off = Math.hypot(G1.engine.x - lx, G1.engine.y - ly, G1.engine.z - lz);
    const light = [];
    for (let i = 1; i <= 120; i++) { FX.update(1 / 60, Flight); window.__draws(); if (i % 6 === 0) light.push([+(i / 60).toFixed(2), +Render3D.gfx().engine.i.toFixed(1)]); }
    // (review P2-VIS-2: a chunk on land rests on the ground under it, its centre half its size up, p.gr; else on its floor)
    const grnd = (p) => { const L = Terrain.locate(p.b, p.x, p.y, p.z, {}); return p.b.radius + Terrain.surfaceAt(p.b, L.a, L.z); };
    const deb = FX.list.filter((p) => p.kind === 'debris'), rest = deb.filter((p) => p.restAt != null);
    const under = deb.filter((p) => Math.hypot(p.x, p.y, p.z) < (p.land ? grnd(p) : p.floor) - 1e-6), land = deb.every((p) => p.land);
    const onFloor = rest.every((p) => p.land ? Math.abs(Math.hypot(p.x, p.y, p.z) - p.gr) < 1e-6 && Math.abs(p.gr - grnd(p) - 0.5 * p.size) < 0.02 : Math.abs(Math.hypot(p.x, p.y, p.z) - p.floor) < 1e-6);
    // light: false lends none
    FX.clear(); window.__draws(); FX.death(v.body, at, Z, 5, 'ammo', undefined, { light: false }); window.__draws(); const nl = Render3D.gfx().engine.i;
    // five deaths at once stay under the cap
    FX.clear(); for (let i = 0; i < 5; i++) FX.death(v.body, at, Z, 5, 'ammo'); FX.update(1 / 60, Flight); const capped = FX.list.length <= FX.max();
    FX.clear(); window.__draws();
    return { draws: d1 - d0, shown: G1.fxShown, i0: G1.engine.i, off, light, deb: deb.length, rest: rest.length, under: under.length, land, onFloor, nl, capped };
  });
  const lit = (t) => p4.light.filter(([s]) => s <= t).map(([, i]) => i);
  ok(`${tag}: the death's particles, chunks and sparks are one draw each (three in all)`, p4.draws === 3 && p4.shown.every(Boolean), p4);
  // (its cook-off pops, at 0.42 and 0.8 s, flash again: a light each for their 0.12 s)
  ok(`${tag}: its flash lends S.engine its light at once, at the flash (${p4.i0.toFixed(0)} cd, ${p4.off.toFixed(2)} m off), fading, none by 0.4 s nor after the last pop (1 s on)`, p4.i0 > 500 && p4.off < 1e-3 && lit(0.3).some((i) => i > 0) && p4.light.find(([s]) => s === 0.4)[1] === 0 && p4.light.filter(([s]) => s >= 1).every(([, i]) => i === 0), p4.light);
  ok(`${tag}: a flash with light: false lends no light`, p4.nl === 0, p4.nl);
  ok(`${tag}: the chunks come to rest on the ground under them (their centres half their size up), none under it (${p4.rest} of ${p4.deb} at rest by 2 s)`, p4.deb > 0 && p4.rest >= p4.deb / 2 && p4.land && p4.onFloor && p4.under === 0, p4);
  ok(`${tag}: five deaths at once stay under the particle cap`, p4.capped, p4);
  // a puff on the ground thins out towards it (no straight cut): its lower edge fades where the ground meets it
  const gfade = await ev(() => {
    const v = Flight.active, gl = document.getElementById('view3d').getContext('webgl2'), bp = bodyPos(v.body, Flight.time), A = window.__ax(), at = window.__at(30, 0, 0, true);
    const px = (p) => { const q = Render3D.project(bp.x + p.x, bp.y + p.y, p.z), k = gl.drawingBufferWidth / innerWidth, b = new Uint8Array(4); gl.readPixels(Math.round(q.x * k), gl.drawingBufferHeight - 1 - Math.round(q.y * k), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return [b[0], b[1], b[2]]; };
    const probe = { x: at.x + A.up.x * 0.25, y: at.y + A.up.y * 0.25, z: at.z + A.up.z * 0.25 }, high = { x: at.x + A.up.x * 3, y: at.y + A.up.y * 3, z: at.z + A.up.z * 3 };
    FX.clear(); window.__draws(); const g0 = px(probe), h0 = px(high);
    for (let i = 0; i < 6; i++) FX.add({ kind: 'smoke', b: v.body, x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, max: 100, size: 6, grow: 0, color: '#26272b', alpha: 1, jz: 0 });
    for (const p of FX.list) p.life = 10;
    window.__draws(); const g1 = px(probe), h1 = px(high);
    FX.clear(); window.__draws();
    const d = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    return { low: d(g0, g1), high: d(h0, h1), g0, g1, h0, h1 };
  });
  ok(`${tag}: a dark puff sitting on the ground thins out towards it (the ground 25 cm up hardly changed: ${gfade.low}; 3 m up darkened: ${gfade.high})`, gfade.high > 60 && gfade.low < gfade.high / 3, gfade);
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
  // a debris chunk is a dark lumpy chunk (the 3D debris mesh, lit) over what's behind it, not a faint light (GB-1)
  const deb = await ev(() => {
    const v = Flight.active, f = v.axis(1, 0, 0), r = Math.hypot(v.x, v.y, v.z), u = { x: v.x / r, y: v.y / r, z: v.z / r };
    const at = { x: v.x + f.x * 30 + u.x * 12, y: v.y + f.y * 30 + u.y * 12, z: v.z + f.z * 30 + u.z * 12 };
    const gl = document.getElementById('view3d').getContext('webgl2');
    const px = (kind) => {
      FX.clear();
      if (kind) FX.add({ kind, b: v.body, x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, max: 100, size: 1.2, grow: 0, color: '#2a2622', alpha: 1, jz: 0 });
      const mr = Math.random; Math.random = window.__mb(1); Flight.updateCamera(); Render3D.renderFlight(Flight, 0, true); Math.random = mr;
      const bp = bodyPos(v.body, Flight.time), pr = Render3D.project(bp.x + at.x, bp.y + at.y, at.z), sx = gl.drawingBufferWidth / innerWidth, buf = new Uint8Array(4);
      gl.readPixels(Math.round(pr.x * sx), gl.drawingBufferHeight - 1 - Math.round(pr.y * sx), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return { rgb: [buf[0], buf[1], buf[2]], lum: buf[0] + buf[1] + buf[2], behind: !!pr.behind, n: Render3D.gfx().debrisN };
    };
    const out = { none: px(null), debris: px('debris') };
    FX.clear();
    return out;
  });
  ok(`${tag}: a debris chunk is a dark chunk over the sky (the pixel ${deb.none.rgb} → ${deb.debris.rgb}), in the debris mesh, not a faint light`, !deb.none.behind && deb.debris.n === 1 && deb.debris.lum < deb.none.lum - 100, deb);
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

  // ---- 4 (cont.). a mid-air death 75 m off (a full Falcon's size, 6 m) whites out well under a quarter of the screen:
  // its flash's glow and its shock ring held to GLOW_MAX of the screen's shorter side however near. 75 m ahead and 15 m
  // up, over the sky: the share of the screen it turns near-white in its first frames, past what was near-white before
  const white = await ev(() => {
    const v = Flight.active, at = window.__at(75, 0, 15), gl = document.getElementById('view3d').getContext('webgl2'), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
    const share = () => { gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); let n = 0; for (let i = 0; i < buf.length; i += 4) if (buf[i] > 235 && buf[i + 1] > 235 && buf[i + 2] > 235) n++; return n / (w * h); };
    FX.clear(); window.__draws(); const s0 = share();
    FX.seed(9); FX.death(v.body, at, { x: 0, y: 0, z: 0 }, 6, 'air', true, { ground: false });
    const out = [];
    for (let i = 0; i < 18; i++) { window.__draws(); out.push(+(share() - s0).toFixed(4)); FX.update(1 / 60, Flight); }
    const bp = bodyPos(v.body, Flight.time), pj = Render3D.project(bp.x + at.x, bp.y + at.y, at.z);
    FX.clear(); window.__draws();
    return { max: Math.max(...out), out, s0, onScreen: !pj.behind && pj.x > 0 && pj.x < innerWidth && pj.y > 0 && pj.y < innerHeight, pj };
  });
  ok(`${tag}: a mid-air death 75 m off whites out at most ${(white.max * 100).toFixed(1)}% of the screen (well under a quarter)`, white.onScreen && white.max < 0.1, white);

  // ---- 2 (Highland Ridge). the props in the shadow pass: only those within reach of the Sun's shadow box (each casting
  // piece's in-box instances written first, nSh of them drawn there): the picture the same to the byte as with every
  // instance in the shadow pass in the order of old (Render3D.shadowAll), for fewer shadow vertices
  const hl2 = await ev(async () => {
    await window.__rebuild(); // (the quality change above: the village built again)
    Render3D.shadowAll = false; const a = window.__shot(); Render3D.shadowAll = true; const b = window.__shot(); Render3D.shadowAll = false; const c = window.__shot();
    return { a: a.hash, b: b.hash, c: c.hash, va: a.verts.shadow || 0, vb: b.verts.shadow || 0, ca: a.verts.canvas, cb: b.verts.canvas };
  });
  ok(`${tag}: in Highland Ridge's village only the props within reach of the shadow box are in the shadow pass (${hl2.va} vertices, ${hl2.vb} with all of them), the picture the same to the byte`, hl2.a === hl2.b && hl2.c === hl2.a && hl2.ca === hl2.cb && hl2.va < 0.6 * hl2.vb, hl2);

  // ---- 5. the shadow box, contact shadows and scorch marks. The box round the tank's turret camera: 50 m, pushed 12.5 m
  // into the view; in the gunner's sight the tight box round the tank (25 m) at the tank
  const box5 = await ev(() => {
    window.__draws(); const a = Render3D.gfx().box;
    Render3D.setSight(true, 3); window.__draws(); const b = Render3D.gfx().box; Render3D.setSight(false); window.__draws();
    return { a, b, ca: Math.hypot(a.cx, a.cy, a.cz), cb: Math.hypot(b.cx, b.cy, b.cz) };
  });
  ok(`${tag}: the shadow box follows the view: ${box5.a.half} m round the tank's turret camera, its middle ${box5.ca.toFixed(2)} m into the view; ${box5.b.half} m in the gunner's sight, at the tank`, box5.a.half === 50 && Math.abs(box5.ca - 12.5) < 0.1 && box5.b.half === 25 && box5.cb < 0.1, box5);
  // a still TK-34 (ours), a Buggy beside it, a wrecked TK-34 (an ammunition detonation), a Falcon 200 m up; a crash site
  const mk = () => ev((HL) => {
    window.__mk = (key, e, z, yaw, o) => { const t = TEMPLATES[key], ps = partsFromDesign(templateRows(t)), adj = buildAdjacency(ps), v = new Vessel(ps, adj, EARTH); v.kind = t.kind; v.name = t.name; v.stages = computeStages(ps, adj, findControlPart(ps).id); v.rebuildGroups();
      v.placeOnSurface(EARTH, siteAngle(EARTH, e), VEHICLE_KINDS[t.kind].launchRot, z, yaw || 0); v.landed = true; Object.assign(v, o || {}); Flight.vessels.push(v); return v; };
    // the decal under v (its ground point within 3 m of v's own, across): {k, a, w, d} or null
    window.__dk = (v) => { const bp = bodyPos(v.body, Flight.time), C = Flight.camAbs, x = bp.x + v.x - C.x, y = bp.y + v.y - C.y, z = v.z - (C.z || 0), r = Math.hypot(v.x, v.y, v.z), u = { x: v.x / r, y: v.y / r, z: v.z / r };
      let best = null;
      for (const d of Render3D.gfx().decals) { const dx = d.x - x, dy = d.y - y, dz = d.z - z, k = dx * u.x + dy * u.y + dz * u.z, h = Math.hypot(dx - u.x * k, dy - u.y * k, dz - u.z * k); if (h < 3 && (!best || h < best.h)) best = { k: d.k, a: +d.a.toFixed(3), w: +d.w.toFixed(2), d: +d.d.toFixed(2), h: +h.toFixed(2) }; }
      return best; };
    window.__ground = (a, s) => window.__at(a, s, 0, true);
    void HL;
  }, HL);
  await mk();
  const p5 = await ev((HL) => {
    const v = Flight.active, d = (k) => { for (let i = 0; i < (k || 2); i++) window.__draws(); };
    FX.clear(); Combat.shots.length = 0; Death.S.pyres.length = 0;
    // one draw for every quad: none at all (our tank sunk out of sight: its blob gone), its blob alone, the blob and three
    // crash sites' scorches
    v.sink = 0.9999; d(); const n0 = Render3D.gfx().decalN, d0 = window.__draws(); v.sink = 0; d(); const n1 = Render3D.gfx().decalN, d1 = window.__draws();
    for (let i = 0; i < 3; i++) { const p = window.__ground(60 + i * 25, -20); Death.S.pyres.push({ b: v.body, x: p.x, y: p.y, z: p.z, t: Flight.time - 5, k: 3, wet: false }); }
    d(); const n3 = Render3D.gfx().decalN, d3 = window.__draws(), shown3 = Render3D.gfx().decalShown;
    Death.S.pyres.length = 0; d(); const wiped = Render3D.gfx().scorches; // (a new flight's Death.reset wipes them before their time: the copies go)
    const draws = { n0, d0, n1, d1, n3, d3, shown3, wiped };
    // the vehicles
    const bug = window.__mk('buggy', HL.e + 3, HL.z + 9, 0.4), wr = window.__mk('tk34', HL.e + 14, HL.z - 7, 0.9, { wreck: true, ko: { why: 'ammo', x: true, t: Flight.time } });
    const fal = window.__mk('falcon', HL.e - 22, HL.z + 14, 1.2), r = Math.hypot(fal.x, fal.y, fal.z);
    fal.x += (fal.x / r) * 200; fal.y += (fal.y / r) * 200; fal.z += (fal.z / r) * 200; fal.landed = false;
    d(); const wr0 = window.__dk(wr);
    Flight.time += 1.2; d(); // (a wreck's scorch fades in over its first second)
    const out = { draws, tank: window.__dk(v), bug: window.__dk(bug), wreck0: wr0, wreck: window.__dk(wr), falcon: window.__dk(fal) };
    // a crash site: a round scorch that outlives its pyre (75 s, Death's pyreTick) and goes at 300 s
    const p = window.__ground(30, 0), t0 = Flight.time, py = { b: v.body, x: p.x, y: p.y, z: p.z, t: t0, k: 4, wet: false };
    Death.S.pyres.push(py);
    const pyre = () => { const bp = bodyPos(v.body, Flight.time), C = Flight.camAbs, x = bp.x + p.x - C.x, y = bp.y + p.y - C.y, z = p.z - (C.z || 0); return Render3D.gfx().decals.find((q) => q.k >= 1 && Math.hypot(q.x - x, q.y - y, q.z - z) < 3) || null; };
    Flight.time = t0 + 1; d(); out.pyre1 = pyre();
    Flight.time = t0 + 80; Death.S.pyres.splice(Death.S.pyres.indexOf(py), 1); d(); out.pyre80 = pyre();
    Flight.time = t0 + 100; d(); out.pyre100 = pyre();
    Flight.time = t0 + 301; d(); out.pyre301 = pyre();
    Flight.time = t0 - 1.2; d();
    window.__keep = [bug, wr, fal];
    return out;
  }, HL);
  const D = p5.draws;
  ok(`${tag}: every contact shadow and scorch is in one draw (no quad: ${D.d0} draws; our tank's blob: ${D.d1}; with three scorches too: ${D.d3})`, D.n0 === 0 && D.n1 === 1 && D.d1 === D.d0 + 1 && D.n3 === 4 && D.d3 === D.d1 && D.shown3, D);
  ok(`${tag}: crash sites' scorches wiped before their time (a new flight) go with them`, D.wiped === 0, D);
  ok(`${tag}: on High a still TK-34 and a Buggy beside it lie on soft blobs (α ${p5.tank && p5.tank.a}, ${p5.bug && p5.bug.a}: inside the Sun's shadow box, 0.32)`, !!p5.tank && !!p5.bug && p5.tank.k === 0 && p5.bug.k === 0 && Math.abs(p5.tank.a - 0.32) < 0.01 && Math.abs(p5.bug.a - 0.32) < 0.01 && p5.tank.w > p5.bug.w, p5);
  ok(`${tag}: a Falcon 200 m up has no blob`, p5.falcon === null, p5.falcon);
  ok(`${tag}: a wreck lies on a scorch (cell ${p5.wreck && p5.wreck.k}), not a blob, fading in over its first second, deep after an ammunition detonation (α ${p5.wreck && p5.wreck.a})`, !p5.wreck0 && !!p5.wreck && p5.wreck.k >= 1 && p5.wreck.k <= 4 && Math.abs(p5.wreck.a - 0.8) < 0.01, p5);
  ok(`${tag}: a crash site leaves one round scorch, still there after its pyre is gone (80 s) and at 100 s, gone at 300 s`, !!p5.pyre1 && Math.abs(p5.pyre1.w - p5.pyre1.d) < 1e-3 && Math.abs(p5.pyre1.a - 0.75) < 0.01 && !!p5.pyre80 && !!p5.pyre100 && !p5.pyre301, p5);
  // (SHOTS) the blobs and scorches, looked down on
  if (SHOTS) {
    await ev(() => { Flight.time += 1.2; const p = window.__ground(30, 0); Death.S.pyres.push({ b: Flight.active.body, x: p.x, y: p.y, z: p.z, t: Flight.time - 2, k: 4, wet: false }); for (let i = 0; i < 3; i++) window.__draws(); });
    await shot('decals-high');
  }
  // on Low (no real shadows): the blobs are the only shadows, 0.6
  const low5 = await ev(async () => {
    Settings.set('quality', 'low'); await window.__rebuild(); for (let i = 0; i < 4; i++) window.__draws();
    return { tank: window.__dk(Flight.active), bug: window.__dk(window.__keep[0]) };
  });
  ok(`${tag}: on Low a still TK-34 and a Buggy each lie on a blob (α ${low5.tank && low5.tank.a}, ${low5.bug && low5.bug.a}: no real shadows there)`, !!low5.tank && !!low5.bug && low5.tank.a > 0.5 && low5.bug.a > 0.5, low5);
  if (SHOTS) await shot('decals-low');
  await ev(async () => {
    for (const o of window.__keep) Flight.vessels.splice(Flight.vessels.indexOf(o), 1);
    Death.S.pyres.length = 0; window.__keep = null;
    Settings.set('quality', 'high'); await window.__rebuild(); for (let i = 0; i < 4; i++) window.__draws();
  });

  // ---- 12. the 2D fallback (Silly's retro2d): every FX.death kind drawn by FX.draw, no error
  const e12 = errs.length;
  const d12 = await ev(async () => {
    const v = Flight.active, Z = { x: 0, y: 0, z: 0 }, d0 = FX.draw, seen = new Set();
    let calls = 0;
    FX.draw = function (...a) { calls++; for (const p of this.list) seen.add(p.kind); return d0.apply(this, a); };
    Silly.flags.retro2d = true; Flight.paused = false; Render3D.skipDraw = false;
    FX.clear(); ['ammo', 'crash', 'air', 'fuel', 'ko', 'thud'].forEach((k, i) => FX.death(v.body, window.__at(20 + i * 15, 0, 1, true), Z, 4, k, undefined, { water: k === 'ko' }));
    const t0 = Flight.time; await new Promise((r) => { const t = () => (Flight.time > t0 + 0.4 || calls > 30 ? r() : setTimeout(t, 30)); t(); });
    FX.draw = d0; Silly.flags.retro2d = false; Flight.paused = true; FX.clear();
    return { calls, kinds: [...seen].sort() };
  });
  ok(`${tag}: the 2D view draws every kind of an FX.death of each kind (${d12.kinds.join(', ')}) with no error`, d12.calls > 0 && ['debris', 'emit', 'fire', 'flash', 'smoke', 'spark'].every((k) => d12.kinds.includes(k)) && errs.length === e12, { ...d12, errs: errs.slice(e12) });

  // ---- 13. screenshots of the effects (SHOTS): every FX.death kind at 0.25 s and 1.5 s, the presets, a muzzle flash and
  // its blast ring, flares, chaff, tracers, dust, a splash, damage smoke, a smoke screen
  if (SHOTS) {
    const fx = (code) => ev((code) => { FX.clear(); Combat.shots.length = 0; FX.seed(4); if (!window.__mr0) window.__mr0 = Math.random; Math.random = window.__mb(4); (0, eval)(code); }, code);
    const run = (secs) => ev((secs) => { for (let t = 0; t < secs - 1e-9; t += 1 / 60) { FX.update(1 / 60, Flight); for (const s of Combat.shots) { s.x += s.vx / 60; s.y += s.vy / 60; s.z += s.vz / 60; } } window.__draws(); }, secs);
    const Z = '{ x: 0, y: 0, z: 0 }', B = 'Flight.active.body';
    for (const k of ['ammo', 'crash', 'air', 'fuel', 'ko', 'thud']) {
      await fx(`FX.death(${B}, __at(${k === 'air' ? '70, 0, 25' : '40, 0, 1.2, true'}), ${Z}, ${k === 'ko' ? 2.3 : 5}, '${k}', ${k === 'air' ? 'true, { ground: false }' : 'undefined'})`);
      await run(0.25); await shot(`death-${k}-0.25s`); await run(1.25); await shot(`death-${k}-1.5s`);
    }
    await fx(`['black', 'grey', 'white', 'dust', 'column', 'steam'].forEach((pr, j) => { for (let i = 0; i < 5; i++) FX.smoke(${B}, __at(45, -20 + j * 8, 2, true), ${Z}, pr); })`); await run(1); await shot('presets');
    await fx(`{ const p = __at(15, 0, 2, true); FX.add({ kind: 'flash', b: ${B}, ...p, vx: 0, vy: 0, vz: 0, max: 0.09, size: 2.4, grow: 6.7, color: '#ffd27a', alpha: 1 }); FX.add({ kind: 'ring', b: ${B}, ...p, vx: 0, vy: 0, vz: 0, max: 0.35, size: 0.6, grow: 4, color: '#e8dcc0', alpha: 0.5 }); }`); await run(0.02); await shot('muzzle');
    await fx(`for (let i = 0; i < 8; i++) { const p = __at(30 + i * 2, -6 + i, 6 - i * 0.4); FX.add({ kind: 'fire', b: ${B}, ...p, vx: 0, vy: 0, vz: 0, max: 0.6, size: 1.2, grow: 1.5, color: '#fff2c4', alpha: 1 }); }
      for (let i = 0; i < 60; i++) { const p = __at(30, 8, 6); FX.add({ kind: 'glint', b: ${B}, ...p, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8, vz: (Math.random() - 0.5) * 8, max: 4, size: 0.15, grow: 0, color: '#eef3fa', alpha: 1, tw: i, tf: 9 + i % 5 }); }`); await run(0.3); await shot('flares-chaff');
    await fx(`{ const A = __ax(); for (let i = 0; i < 24; i++) { const p = __at(25 + i * 9, (i % 5) - 2, 1.5 + (i % 3)), d = i & 1 ? 1 : -1; Combat.shots.push({ k: i % 6 ? 'bullet' : 'shell', tracer: true, enemy: i % 4 === 0, b: ${B}, ...p, vx: A.rt.x * 900 * d, vy: A.rt.y * 900 * d, vz: A.rt.z * 900 * d }); } FX.sparks(${B}, __at(25, 2, 1, true), ${Z}, 30); }`); await run(0.02); await shot('tracers');
    await fx(`for (let i = 0; i < 12; i++) FX.smoke(${B}, __at(20 + i, -4, 0.3, true), ${Z}, 'dust'); FX.splash(${B}, __at(30, 6, 0, true), __ax().up, 25)`); await run(0.4); await shot('dust-splash');
    await fx(`{ const A = __ax(); for (let i = 0; i < 40; i++) FX.trail(${B}, __at(60, -30 + i * 1.5, 25), { x: A.rt.x * 90, y: A.rt.y * 90, z: A.rt.z * 90 }, 'grey', 2, 1 / 60); }`); await run(0.5); await shot('damage-smoke');
    await fx(`{ const c = __at(35, 0, 2, true); for (let i = 0; i < 16; i++) FX.add({ kind: 'smoke', b: ${B}, x: c.x + (Math.random() - 0.5) * 10, y: c.y + (Math.random() - 0.5) * 10, z: c.z + (Math.random() - 0.5) * 10, vx: 0, vy: 0, vz: 0, max: 6, size: 4 + Math.random() * 2, grow: 1.3, color: '#d6d9dc', alpha: 0.75 }); }`); await run(1); await shot('smoke-screen');
    await ev(() => { FX.clear(); Combat.shots.length = 0; Math.random = window.__mr0; window.__draws(); });
  }

  // ---- 8. water: the ground's UVs shared, the ripples' drift, the second set on High only
  const w8 = await ev(async () => {
    const G = () => Render3D.gfx(), one = () => { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); };
    Render3D.skipDraw = true;
    const hi = { shared: G().waterUvShared, defs: G().oceanDefines };
    Settings.set('quality', 'low'); one();
    const lo = { shared: G().waterUvShared, defs: G().oceanDefines };
    Settings.set('quality', 'high'); one();
    const hi2 = { shared: G().waterUvShared, defs: G().oceanDefines };
    await window.__rebuild();
    // paused: frames drawn, the ripples still; flying (the frames' time, not the sim's: drawn here with no physics step)
    const a = G().waterOffset; for (let i = 0; i < 5; i++) one();
    const b = G().waterOffset; Flight.paused = false; for (let i = 0; i < 6; i++) one(); Flight.paused = true;
    const c = G().waterOffset; for (let i = 0; i < 5; i++) one();
    const d = G().waterOffset;
    Render3D.skipDraw = false;
    return { hi, lo, hi2, a, b, c, d };
  });
  ok(`${tag}: the sea and the lakes run on the ground's very UV attribute, before and after a quality change (High, Low, High)`, w8.hi.shared && w8.lo.shared && w8.hi2.shared, w8);
  ok(`${tag}: the water's second ripple set (OB_HI) is on High and not on Low (the material's own STANDARD kept)`, 'OB_HI' in w8.hi.defs && !('OB_HI' in w8.lo.defs) && 'OB_HI' in w8.hi2.defs && 'STANDARD' in w8.lo.defs && 'STANDARD' in w8.hi.defs, { hi: w8.hi.defs, lo: w8.lo.defs });
  ok(`${tag}: the ripples stand still while paused and drift with the frames drawn in flight (0.1 s: ${w8.b.t.toFixed(3)} → ${w8.c.t.toFixed(3)} s)`, w8.a.t === w8.b.t && w8.a.x === w8.b.x && Math.abs(w8.c.t - w8.b.t - 0.1) < 1e-6 && w8.c.x !== w8.b.x && w8.c.bx !== w8.b.bx && w8.d.t === w8.c.t, w8);

  // ---- 9. terrain: the 48 m variation (OB_HI) on High only, on the patch and the arena's own ground alike, and the two
  // drawn with one program: on Low, with the arena's ground (and the props it brings) held off, everything drawn, then
  // the arena's ground shown: no new program
  const t9 = await ev(async () => {
    const G = () => Render3D.gfx(), A = () => Render3D.arenaInfo();
    const draw = async (want) => { // frames back to back (nothing drawn) until the arena's ground is on show, or not, and nothing builds; then two drawn
      Render3D.skipDraw = true;
      let n = 0;
      for (let quiet = 0; n < 8000 && quiet < 30; n++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); quiet = A().on === want && !Render3D.bench.busy() ? quiet + 1 : 0; if ((n & 63) === 63) await new Promise((r) => setTimeout(r, 0)); }
      Render3D.skipDraw = false;
      for (let i = 0; i < 2; i++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); }
      return { on: A().on, n, programs: Render3D.info().programs, progs: G().terrProgs, t: G().terrDefines, a: G().amatDefines };
    };
    const hi = await draw(true);
    Settings.set('quality', 'low'); Render3D.arenaOff = true; Render3D.propsOff = true;
    const off = await draw(false);
    Render3D.arenaOff = false;
    const on = await draw(true);
    Render3D.propsOff = false; Settings.set('quality', 'high');
    const back = await draw(true);
    await window.__rebuild();
    return { hi, off, on, back };
  });
  const same = (x) => JSON.stringify(x.t) === JSON.stringify(x.a);
  ok(`${tag}: the ground's 48 m variation (OB_HI) is on the patch and the arena's ground on High, on neither on Low, back on both on High (the materials' own STANDARD kept)`,
    same(t9.hi) && same(t9.off) && same(t9.on) && same(t9.back) && 'OB_HI' in t9.hi.t && !('OB_HI' in t9.off.t) && !('OB_HI' in t9.on.a) && 'OB_HI' in t9.back.a && 'STANDARD' in t9.on.t && 'STANDARD' in t9.back.a,
    { hi: [t9.hi.t, t9.hi.a], lo: [t9.on.t, t9.on.a], back: [t9.back.t, t9.back.a] });
  ok(`${tag}: the patch and the arena's ground draw with one shader program, on High and on Low`, t9.hi.on && t9.hi.progs === 1 && t9.on.on && t9.on.progs === 1 && t9.back.on && t9.back.progs === 1, { hi: t9.hi.progs, lo: t9.on.progs, back: t9.back.progs });
  ok(`${tag}: on Low, the arena's ground first shown builds no shader program (${t9.off.programs} → ${t9.on.programs})`, !t9.off.on && t9.on.on && t9.on.programs === t9.off.programs, { off: t9.off, on: t9.on });

  // ---- 10. the haze meets the sky: dusk on the runway, a Falcon, the camera 400 m behind it and level; everything past a
  // kilometre fogged (bench.fogK 200). A column 20° off the Sun's azimuth (towards it: its own glare, s^90 and s^1800, isn't
  // in the fog) and one straight away from it: the pixel 2 px under the horizon line (the sea's edge, a point on the
  // horizon projected) is fogged ground, the one 2 px over it sky
  const T_DUSK = 130000;
  const h10 = await ev(async (T_DUSK) => {
    const tp = TEMPLATES.falcon; store.set('rss.flight', null);
    Flight.start({ name: tp.name, kind: tp.kind, parts: templateRows(tp) }); Flight.paused = true; Flight.time = T_DUSK; Props.play = false;
    Render3D.bench.fogK = 200; Flight.scale = (innerHeight / 2) / 400 / Math.tan((25 * Math.PI) / 180);
    Render3D.orbitBy(0, -999); Render3D.orbitBy(0, (1.25 + 0.01) / 0.006); // (the camera level, a hair over the craft)
    await window.__rebuild();
    const gl = document.getElementById('view3d').getContext('webgl2'), pr = gl.drawingBufferWidth / innerWidth;
    const hor = (off) => { // a point on the horizon `off` rad round from the Sun's azimuth, on screen (CSS px), the camera's height
      const c = Render3D.gfx().camAt, v = Flight.active, bp = bodyPos(v.body, Flight.time), R = v.body.radius;
      const rx = c.x - bp.x, ry = c.y - bp.y, rz = c.z, r = Math.hypot(rx, ry, rz), up = [rx / r, ry / r, rz / r], hc = r - R;
      const sl = Math.hypot(c.x, c.y), sd = [-c.x / sl, -c.y / sl, 0], k = sd[0] * up[0] + sd[1] * up[1];
      let hs = [sd[0] - up[0] * k, sd[1] - up[1] * k, -up[2] * k]; const hl = Math.hypot(...hs); hs = hs.map((q) => q / hl);
      const sx = [up[1] * hs[2] - up[2] * hs[1], up[2] * hs[0] - up[0] * hs[2], up[0] * hs[1] - up[1] * hs[0]], co = Math.cos(off), si = Math.sin(off);
      const h = hs.map((q, i) => q * co + sx[i] * si), D = Math.sqrt(2 * R * hc + hc * hc), cd = R / (R + hc), sn = Math.sqrt(1 - cd * cd);
      return Render3D.project(c.x + D * (h[0] * cd - up[0] * sn), c.y + D * (h[1] * cd - up[1] * sn), c.z + D * (h[2] * cd - up[2] * sn));
    };
    const settle = async () => { Render3D.skipDraw = true; for (let i = 0; i < 90; i++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); } Render3D.skipDraw = false; };
    const pick = (y) => { const b = new Uint8Array(4); gl.readPixels(Math.round(window.__col * pr), gl.drawingBufferHeight - 1 - Math.round(y * pr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); return [b[0], b[1], b[2]]; };
    const out = {};
    for (const [name, off] of [['towards', 0.35], ['away', Math.PI]]) {
      // turn the camera until that point sits a third of the way across the screen (left of the craft)
      for (let i = 0; i < 12; i++) {
        const p = hor(off), want = innerWidth * 0.3;
        if (!p.behind && Math.abs(p.x - want) < innerWidth * 0.04) break;
        Render3D.orbitBy(p.behind || p.x < 0 || p.x > innerWidth ? 0.5 / 0.006 : ((p.x - want) / innerWidth) * 1.2 / 0.006, 0); await settle();
      }
      const p = hor(off); window.__col = p.x;
      Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); // (then read the frame just drawn)
      const g = pick(p.y + 2), s = pick(p.y - 2), d = Math.max(...g.map((q, i) => Math.abs(q - s[i])));
      out[name] = { at: [Math.round(p.x), +p.y.toFixed(1)], ground: g, sky: s, d, behind: p.behind };
    }
    out.fog = Render3D.gfx().fogArrays; out.sunset = Render3D.bench.sunset(); out.patched = Render3D.info().patched;
    Render3D.bench.fogK = 1;
    return out;
  }, T_DUSK);
  ok(`${tag}: the haze is written each frame: its colour the sky's at the horizon, a warm sunset side (dusk: ${h10.sunset.toFixed(2)}), an aureole, Earth's falloff`, h10.fog.lin.every((x) => x > 0) && h10.fog.sun[3] > 0.2 && h10.fog.glow[0] > h10.fog.glow[2] && Math.abs(h10.fog.h[0] - 1 / 1600) < 1e-9 && h10.fog.density > 0.005, h10.fog);
  ok(`${tag}: at dusk, away from the Sun, fogged ground 2 px under the horizon matches the sky 2 px over it within 4/255 (${h10.away.ground} | ${h10.away.sky}; r159's fog after the tone mapping missed it by tens)`, !h10.away.behind && h10.away.d <= 4, h10.away);
  ok(`${tag}: at dusk, towards the Sun (20° off it), fogged ground under the horizon matches the sky over it within 8/255 (${h10.towards.ground} | ${h10.towards.sky})`, !h10.towards.behind && h10.towards.d <= 8, h10.towards);
  if (SHOTS) await shot('haze-dusk');

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
  // no shader built mid-play when the first building comes within the shadow box: the flight starts on an open spot in
  // town (the town drawn round it, no building in reach: the stand-ins empty), its first frames drawn (the warm-up),
  // then the Buggy put by the buildings (as if driven there) and the view built round it: that frame builds no program
  // (the stand-ins' depth programs were built while loading, as the buildings' own were when they cast whole)
  // (where the Buggy stands by the buildings, nothing drawn there: the page's own loop draws no frame while skipDraw)
  const byB = await ev2(([TOWN, T_NOON]) => { const t = TEMPLATES.buggy; Render3D.skipDraw = true; store.set('rss.flight', null);
    Flight.start({ name: t.name, kind: t.kind, parts: templateRows(t) }, { place: TOWN }); Flight.paused = true; Flight.time = T_NOON; Props.play = false;
    const v = Flight.active; return { x: v.x, y: v.y, z: v.z, q: { ...v.q } }; }, [TOWN, T_NOON]);
  await town('buggy', { ...TOWN, e: TOWN.e + 600, z: TOWN.z + 600 }); // (open: no building within reach of a ground vehicle's 50 m box)
  const fc = await ev2(async (at) => {
    for (let i = 0; i < 4; i++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); }
    const open = Render3D.info().proxies, p0 = window.__nprog, v = Flight.active;
    Object.assign(v, { x: at.x, y: at.y, z: at.z }); v.q = { ...at.q };
    Render3D.skipDraw = true;
    for (let n = 0, quiet = 0; n < 4000 && quiet < 30; n++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); quiet = Render3D.bench.busy() ? 0 : quiet + 1; if ((n & 63) === 63) await new Promise((r) => setTimeout(r, 0)); }
    Render3D.skipDraw = false;
    const p1 = window.__nprog;
    Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
    return { open, by: Render3D.info().proxies, built: window.__nprog - p1, before: p1 - p0 };
  }, byB);
  ok(`${tag}: the first building to come within the shadow box builds no shader then (stand-ins ${fc.open} on the open spot, ${fc.by} by the buildings: ${fc.built} programs built in that frame)`, fc.open.every((x) => x === 0) && fc.by[0] > 0 && fc.built === 0, fc);
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
  // a Jumbo in town, the camera drawn back: a bigger shadow box (60 m, the Buggy's 50), more stand-ins, the same picture
  // to the byte
  await town('jumbo', TOWN);
  await ev2(async () => { Flight.scale /= 2; Render3D.skipDraw = true; for (let n = 0, quiet = 0; n < 4000 && quiet < 30; n++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); quiet = Render3D.bench.busy() ? 0 : quiet + 1; if ((n & 63) === 63) await new Promise((r) => setTimeout(r, 0)); } Render3D.skipDraw = false; });
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
