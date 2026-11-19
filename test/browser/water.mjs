// The water's depth (render3d waterHook, OB_DEEP; handbook chapter 3 §1.7), in the page at noon, on a phone in portrait
// (390×844, DPR 2) and a desktop (1280×720), on High and on Low, the pixel ratio pinned, the flight paused:
//  1. the hooks: Render3D.waterInfo().deep, the sea's material with OB_DEEP on High and on Low, the chunk patches still in
//     (info().patched { fog: true, shadow: true })
//  2. the sea floor is drawn under shallow water: a plane 60 m over a bay 2-4 m deep, looking down: the ground as drawn
//     lies below the water there, and hiding the ground (bench.ground false) changes the water's pixels a lot; over the
//     open sea (100 m deep) it changes them hardly at all
//  3. the water is darker over deep water than over shallow, seen the same way
//  4. a wreck sinking away (death.js's junk: a Falcon floating 35 m off, v.sink) goes down through the water: its top
//     below the surface, it still shows (its pixels against the same frame with it hidden) at a third and at half of its
//     sink, much less by the end; it takes a stencil slot and the sea's stencil test is on only while it does
//  5. an aircraft that crashes into the water is drawn sinking for SINK_GHOST s of the sim's time, then goes
//  6. junk sinking on dry ground takes no slot and leaves the water alone; no new shader program at the first sinking
//     thing (the veils' programs built while the flight loaded)
//  7. no change inland: in Highland Ridge's village, the water's depth (against the old water shader, bench.oldWater)
//     changes only pixels that are the water's (hiding the water changes them too), and no stencil or veil is on (the
//     ground's colours away from the water are checked against the commit before by render-bench --same)
//  8. the swell near a ship (the ships update): with no ship near, none (no grid drawn, the ocean whole); a patrol boat at
//     her marks turns it on (128² cells of 4 m on High, 64² of 6 m on Low) with the ocean cut under it and a recentre's
//     fill timed; the shader's wave function run on the GPU with the uniforms as drawn agrees with Ship.wave within 1 mm
//     at 50 points (and the packer on the CPU); flattened, the grid draws the very ocean it covers (no seam), the waves
//     on change the picture; under way she lays a wake (its pixels: bench.wake) and throws bow spray. Until the hydro core
//     lands, the waves are the spec's copy (test/lib/seawaves.js); a tree with no ship skips 8b-e.
// The console stays clean.     node test/browser/water.mjs
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
import { seaWaves } from '../lib/seawaves.js';
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('water: the sea and the lakes with depth');
const mapIn = () => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' && Render3D.ready;
const T_NOON = 70500;
const BAY = { e: 16400, z: 26400, yaw: 0, air: { alt: 60, speed: 0 } }, SEA = { e: -1344, z: 3967, yaw: 0, air: { alt: 60, speed: 0 } };
const SHIP_AT = { e: -1344, z: 3967, yaw: 0.5 }; // (the open sea of the render bench, a ship's spawn: her heading)
const SINK = { e: 3330, z: -30, yaw: 0, air: { alt: 12, speed: 0 } }, HL = { e: 18190, z: 15040, yaw: 0 }, LAND = { e: 1500, z: 0, yaw: 0, air: { alt: 12, speed: 0 } };
// in the page: start a paused flight at a place (cam: distance, pitch), everything round it built; a frame's pixels in a
// region (x0..x1, y0..y1 as shares of the screen) as mean RGB; a frame's whole buffer
const HELP = () => {
  window.__start = async (key, place, cam) => {
    const tp = TEMPLATES[key];
    store.set('rss.flight', null); App.showScene('flight');
    Flight.start({ name: tp.name, kind: tp.kind, parts: templateRows(tp) }, { place });
    Flight.paused = true; Flight.time = 70500;
    Props.play = key === 'tk34';
    Render3D.bench.pin = true; Render3D.setVisible(true); Render3D.resize(innerWidth, innerHeight, devicePixelRatio);
    Flight.scale = (innerHeight / 2) / cam[0] / Math.tan((25 * Math.PI) / 180);
    Render3D.skipDraw = true; Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
    Render3D.resetCamera(); Render3D.orbitBy(0, (cam[1] - (Flight.active.kind === 'plane' ? 0.2 : 0.18)) / 0.006);
    await window.__settle();
  };
  window.__settle = async () => {
    Render3D.skipDraw = true;
    for (let n = 0, quiet = 0; n < 8000; n++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); const I = Render3D.propsInfo().hl; quiet = (!Props.play || (I && I.ready && I.shown)) && !Render3D.bench.busy() ? quiet + 1 : 0; if (n > 200 && quiet > 30) break; if ((n & 63) === 63) await new Promise((r) => setTimeout(r, 0)); }
    Render3D.skipDraw = false;
  };
  window.__buf = () => {
    Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
    const gl = document.getElementById('view3d').getContext('webgl2'), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { buf, w, h };
  };
  window.__mean = (x0, x1, y0, y1) => { // (y from the top)
    const { buf, w, h } = window.__buf(), m = [0, 0, 0];
    let n = 0;
    for (let y = Math.floor(y0 * h); y < y1 * h; y += 2) for (let x = Math.floor(x0 * w); x < x1 * w; x += 2) { const i = ((h - 1 - y) * w + x) * 4; m[0] += buf[i]; m[1] += buf[i + 1]; m[2] += buf[i + 2]; n++; }
    return m.map((q) => q / n);
  };
  window.__same = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
  window.__diff = (a, b) => { let n = 0, s = 0; for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); if (d > 12) { n++; s += d; } } return { n, mean: n ? s / n / 3 : 0 }; };
  // a Falcon lying on the water (or the ground) 35 m ahead and 16 m right of the craft, as death.js's junk
  window.__junk = (sink) => {
    const v = Flight.active, tp = TEMPLATES.falcon, ps = partsFromDesign(templateRows(tp)), adj = buildAdjacency(ps), c = findControlPart(ps);
    const w = new Vessel(ps, adj, v.body); w.name = 'junk'; w.kind = 'plane'; w.stages = computeStages(ps, adj, c.id); w.rebuildGroups();
    const r0 = Math.hypot(v.x, v.y, v.z), up = { x: v.x / r0, y: v.y / r0, z: v.z / r0 }, f = v.axis(0, 1, 0), k0 = f.x * up.x + f.y * up.y + f.z * up.z;
    const fw = { x: f.x - up.x * k0, y: f.y - up.y * k0, z: f.z - up.z * k0 }, fl = Math.hypot(fw.x, fw.y, fw.z), rt = { x: fw.y * up.z - fw.z * up.y, y: fw.z * up.x - fw.x * up.z, z: fw.x * up.y - fw.y * up.x }, rl = Math.hypot(rt.x, rt.y, rt.z);
    const P = { x: v.x + (fw.x / fl) * 35 + (rt.x / rl) * 16, y: v.y + (fw.y / fl) * 35 + (rt.y / rl) * 16, z: v.z + (fw.z / fl) * 35 + (rt.z / rl) * 16 }, n = Math.hypot(P.x, P.y, P.z);
    const L = Terrain.locate(v.body, P.x, P.y, P.z, {}), g = v.body.radius + Terrain.surfaceAt(v.body, L.a, L.z) + 1.2;
    w.q = { ...v.q }; w.x = (P.x / n) * g; w.y = (P.y / n) * g; w.z = (P.z / n) * g; w.vx = w.vy = w.vz = 0;
    if (sink != null) { w.junkAt = 0; w.sinkAt = 0; w.sink = sink; }
    w.splashed = true;
    Flight.vessels.push(w);
    return w;
  };
  // its pixels: the frame with it against the frame with its mesh hidden (its stencil marks with it)
  window.__shows = (w) => { const a = window.__buf().buf, m = Render3D.meshOf(w); m.group.visible = false; const b2 = window.__buf().buf; m.group.visible = true; return window.__diff(a, b2); };
};

for (const [w, h, dpr, tag] of [[390, 844, 2, 'phone'], [1280, 720, 1, 'desktop']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, ...(w < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  watch(page, errs, tag + ' ');
  const ev = (f, a) => page.evaluate(f, a);
  await openGame(page, srv.url, { quality: 'high', fps: 0 });
  await page.waitForFunction(mapIn, null, { timeout: 300000, polling: 250 });
  await ev(() => { window.requestAnimationFrame = () => 0; });
  await ev(HELP);
  for (const q of ['high', 'low']) {
    const T = `${tag} ${q}`;
    await ev((q) => Settings.set('quality', q), q);
    // ---- 1. the hooks
    await ev(async (SEA) => { await window.__start('falcon', SEA, [60, 1.2]); }, SEA);
    const h1 = await ev(() => ({ wi: Render3D.waterInfo(), defs: Render3D.gfx().oceanDefines, patched: Render3D.info().patched }));
    ok(`${T}: the water has its depth (OB_DEEP${q === 'high' ? ', OB_HI' : ''}), the chunk patches still in`, h1.wi.deep && 'OB_DEEP' in h1.defs && ('OB_HI' in h1.defs) === (q === 'high') && h1.patched.fog && h1.patched.shadow && !h1.wi.stencil, h1);
    // ---- 2 and 3. the sea floor under shallow water; darker over deep water
    const look = (place) => ev(async (place) => {
      await window.__start('falcon', place, [60, 1.2]);
      const v = Flight.active, L = Terrain.locate(v.body, v.x, v.y, v.z, {});
      const R = [0.1, 0.9, 0.62, 0.95], m = window.__mean(...R);
      Render3D.bench.ground = false; const g = window.__mean(...R); Render3D.bench.ground = true;
      return { m, g, dg: Math.max(...m.map((x, i) => Math.abs(x - g[i]))), bed: Render3D.drawnGround(v.body, L.a, L.z), lum: 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2] };
    }, place);
    const sh = await look(BAY), dp = await look(SEA);
    ok(`${T}: the sea floor is drawn under the shallows (${sh.bed.toFixed(1)} m), and seen through the water: hiding it moves the water's pixels by ${sh.dg.toFixed(0)}/255`, sh.bed < -1 && sh.dg > 12, sh);
    ok(`${T}: over the open sea (${dp.bed.toFixed(0)} m) the floor hardly shows (${dp.dg.toFixed(1)}/255)`, dp.bed < -40 && dp.dg < 4, dp);
    ok(`${T}: deep water is darker than the shallows (luminance ${dp.lum.toFixed(0)} against ${sh.lum.toFixed(0)})`, dp.lum < sh.lum * 0.85, { deep: dp.m, shallow: sh.m });
    // ---- 4. a wreck sinking away through the water (and 6: no new program at the first one)
    const s4 = await ev(async (SINK) => {
      await window.__start('falcon', SINK, [40, 0.5]);
      for (let i = 0; i < 4; i++) window.__buf(); // (the flight's first frames drawn: what loads with it, compiled)
      const p0 = Render3D.info().programs, w = window.__junk(0.05), out = {};
      for (const k of [0.05, 0.33, 0.5, 0.75, 0.99]) { w.sink = k; const s = window.__shows(w), I = Render3D.waterInfo(); out[k] = { px: s.n, mean: +s.mean.toFixed(1), info: I.sinks[0] || null, stencil: I.stencil, veils: I.veils }; }
      out.programs = [p0, Render3D.info().programs];
      Flight.vessels.splice(Flight.vessels.indexOf(w), 1); Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
      out.after = Render3D.waterInfo();
      return out;
    }, SINK);
    const s33 = s4[0.33], s50 = s4[0.5], s75 = s4[0.75], s99 = s4[0.99], E = (q) => q.px * q.mean; // (E: how much of it shows, pixels × their mean difference)
    ok(`${T}: a wreck sinking away goes down through the water and still shows: at a third ${s33.px} px of it, at half its top ${s50.info && s50.info.dep} m under and ${s50.px} px, at three quarters ${s75.info && s75.info.dep} m and ${s75.px} px`,
      !!s33.info && s33.info.slot === 1 && s33.px > 300 && s50.info.dep > 0.5 && s50.px > 150 && s75.info.dep > s50.info.dep && s75.px > 100 && s33.stencil && s33.veils === 1, s4);
    ok(`${T}: and fades with depth: at the end it hardly shows (${s99.px} px, ${s99.mean}/255 off: ${(E(s99) / E(s33)).toFixed(2)} of a third's)`, E(s99) < 0.35 * E(s33) && s99.mean < 12, s4);
    ok(`${T}: gone, it leaves no stencil test or veil behind`, !s4.after.stencil && s4.after.veils === 0 && s4.after.sinks.length === 0, s4.after);
    ok(`${T}: no shader program built at the first sinking thing (${s4.programs.join(' → ')})`, s4.programs[0] === s4.programs[1], s4.programs);
    // ---- 5. an aircraft that crashes into the water sinks for a while, then goes
    const s5 = await ev(() => {
      const w = window.__junk(null); Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
      w.dead = true; const t0 = Flight.time, out = {};
      Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
      out.at0 = { mesh: !!Render3D.meshOf(w), info: Render3D.waterInfo() };
      Flight.time = t0 + 3; out.at3 = { shows: window.__shows(w), info: Render3D.waterInfo() };
      Flight.time = t0 + 9; Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
      out.at9 = { mesh: !!Render3D.meshOf(w), info: Render3D.waterInfo() };
      Flight.vessels.splice(Flight.vessels.indexOf(w), 1); Flight.time = t0;
      return out;
    });
    ok(`${T}: an aircraft that crashes into the water is drawn sinking (3 s on: ${s5.at3.shows.n} px of it, ${s5.at3.info.sinks[0] && s5.at3.info.sinks[0].dep} m under), and is gone after 8 s`,
      s5.at0.mesh && s5.at0.info.sinks.some((s) => s.ghost) && s5.at3.shows.n > 100 && s5.at3.info.sinks[0].dep > 0.3 && !s5.at9.mesh && s5.at9.info.sinks.length === 0 && !s5.at9.info.stencil, s5);
    // ---- 6. junk sinking on dry ground: no slot, the water alone
    const s6 = await ev(async (LAND) => {
      await window.__start('falcon', LAND, [40, 0.5]);
      const w = window.__junk(0.5); Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
      const I = Render3D.waterInfo();
      Flight.vessels.splice(Flight.vessels.indexOf(w), 1);
      return I;
    }, LAND);
    ok(`${T}: junk sinking on dry ground takes no slot and leaves the water alone (as before: into the ground)`, s6.sinks.length === 0 && !s6.stencil && s6.veils === 0, s6);
    // ---- 7. no change inland
    const s7 = await ev(async (HL) => {
      await window.__start('tk34', HL, [20, 0.25]);
      const a = window.__buf().buf; Render3D.bench.oldWater = true; const b2 = window.__buf().buf; Render3D.bench.oldWater = false;
      Render3D.bench.water = false; const c = window.__buf().buf; Render3D.bench.water = true;
      const a2 = window.__buf().buf, I = Render3D.waterInfo();
      let changed = 0, dry = 0; // (pixels the depth changes, and of those, ones that aren't water's: hiding the water leaves them be)
      for (let i = 0; i < a.length; i += 4) if (a[i] !== b2[i] || a[i + 1] !== b2[i + 1] || a[i + 2] !== b2[i + 2]) { changed++; if (a[i] === c[i] && a[i + 1] === c[i + 1] && a[i + 2] === c[i + 2]) dry++; }
      return { changed, dry, back: window.__same(a, a2), stencil: I.stencil, veils: I.veils };
    }, HL);
    ok(`${T}: inland (Highland Ridge's village) the water's depth changes the water's pixels only (${s7.changed} px, ${s7.dry} of them not water), no stencil or veil, and back to the byte`, s7.dry === 0 && s7.back === 0 && !s7.stencil && s7.veils === 0, s7);
    // ---- 8. the swell near a ship (the ships update, render3d updateSwell)
    // a. no ship, no swell: over the open sea a Falcon's frame has no grid on show and no hole in the ocean
    const s8a = await ev(async (SEA) => { await window.__start('falcon', SEA, [60, 1.2]); const I = Render3D.swellInfo(); return { shown: I.shown, on: I.on, hole: I.hole }; }, SEA);
    ok(`${T}: with no ship near, no swell: the grid not drawn, the ocean whole (hole ${s8a.hole})`, !s8a.shown && !s8a.on && s8a.hole.join() === '1,1,0,0', s8a);
    if (await ev(() => !TEMPLATES.cyclon)) { ok(`${T}: (no ship on this tree: the swell's checks skipped)`, true); continue; }
    // b. a patrol boat at her marks in the open sea (the waves: the hydro core's, else the spec's copy, test/lib/seawaves.js)
    const mock = await ev(seaWaves);
    const s8b = await ev(async (SHIP_AT) => {
      await window.__start('cyclon', SHIP_AT, [45, 0.35]);
      const v = Flight.active, mid = v.parts.find((q) => q.def.hull && q.def.shull && q.def.shull.ends.fore === 'joint' && q.def.shull.ends.aft === 'joint') || v.parts.find((q) => q.def.hull);
      const w = v.toWorld(mid.x, mid.y + mid.def.shull.wl, 0), R = v.body.radius, alt = Math.hypot(w.x, w.y, w.z) - R, r0 = Math.hypot(v.x, v.y, v.z);
      if (Math.abs(alt) > 0.05) { v.x *= (r0 - alt) / r0; v.y *= (r0 - alt) / r0; v.z *= (r0 - alt) / r0; } // (her design waterline at sea level)
      await window.__settle();
      window.__buf();
      const I = Render3D.swellInfo();
      const ms = []; for (let i = 0; i < 5; i++) ms.push(Render3D.swellRefill());
      ms.sort((a, b) => a - b);
      return { I, ms: +ms[2].toFixed(2), hydro: v.hydro };
    }, SHIP_AT);
    const amp = s8b.I.W ? [3, 7, 11, 15].map((i) => s8b.I.W[i]) : [];
    ok(`${T}: a ship near: the swell on, ${s8b.I.N}² cells of ${s8b.I.cell} m round the camera, the ocean cut under it, the waves' amplitudes ${amp.map((a) => a.toFixed(2)).join(', ')} m${mock ? ' (the spec\'s copy of the waves)' : ''}`,
      s8b.hydro && s8b.I.on && s8b.I.shown && s8b.I.N === (q === 'high' ? 128 : 64) && s8b.I.hole.join() !== '1,1,0,0' && s8b.I.hole[2] > s8b.I.hole[0] && amp.some((a) => a > 0.05), s8b.I);
    ok(`${T}: filling the grid (a recentre) takes ${s8b.ms} ms (median of 5; spec ≤ 2 ms on the bench's desktop, ${q === 'high' ? 'High' : 'Low'})`, s8b.ms < (q === 'high' ? 6 : 3), s8b.ms);
    // c. the GPU's swell is the physics' sea: the shader's own wave function (Render3D.swellGLSL) run on the GPU with the
    // uniforms as drawn, at 50 points over the grid, against Ship.wave there and then (height within 1 mm, slopes 1e-4)
    const s8c = await ev(() => {
      const I = Render3D.swellInfo(), cv = document.createElement('canvas'), gl = cv.getContext('webgl2');
      if (!gl || !gl.getExtension('EXT_color_buffer_float')) return { skip: 'no float render targets' };
      const N = 50, pts = [];
      let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < N; i++) pts.push([(rnd() * 2 - 1) * I.half, (rnd() * 2 - 1) * I.half]);
      const vs = '#version 300 es\nin vec2 p; void main() { gl_Position = vec4( p, 0.0, 1.0 ); }';
      const fs = '#version 300 es\nprecision highp float;\n' + Render3D.swellGLSL + `\nuniform vec2 uPts[ ${N} ];\nout vec4 o;\nvoid main() { int i = int( gl_FragCoord.x ); o = vec4( obSwell( uPts[ i ] ), 1.0 ); }`;
      const sh = (t, src) => { const q = gl.createShader(t); gl.shaderSource(q, src); gl.compileShader(q); if (!gl.getShaderParameter(q, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(q)); return q; };
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); gl.useProgram(pr);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, N, 1);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, N, 1);
      gl.uniform4fv(gl.getUniformLocation(pr, 'uSwW'), new Float32Array(I.W)); gl.uniform2fv(gl.getUniformLocation(pr, 'uSwP'), new Float32Array(I.P));
      gl.uniform2fv(gl.getUniformLocation(pr, 'uPts'), new Float32Array(pts.flat()));
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const out = new Float32Array(N * 4); gl.readPixels(0, 0, N, 1, gl.RGBA, gl.FLOAT, out);
      const t = Ship.seaT(Flight), o = [0, 0, 0];
      let eh = 0, es = 0, amp = 0;
      for (let i = 0; i < N; i++) {
        Ship.wave(I.eA + pts[i][0], -I.zA + pts[i][1], t, o);
        eh = Math.max(eh, Math.abs(out[i * 4] - o[0])); es = Math.max(es, Math.abs(out[i * 4 + 1] - o[1]), Math.abs(out[i * 4 + 2] - o[2])); amp = Math.max(amp, Math.abs(o[0]));
      }
      // (and the packer evaluated with the shader's formula in double precision, on the CPU)
      let ec = 0;
      for (let i = 0; i < N; i++) { let h = 0; for (let c = 0; c < 4; c++) { const w = I.W.slice(c * 4, c * 4 + 4); h += w[3] * Math.sin(w[2] * (w[0] * pts[i][0] + w[1] * pts[i][1]) + I.P[c * 2 + 1]); } Ship.wave(I.eA + pts[i][0], -I.zA + pts[i][1], t, o); ec = Math.max(ec, Math.abs(h - o[0])); }
      return { eh, es, ec, amp };
    });
    ok(`${T}: the swell drawn is the physics' sea: the GPU's height within ${s8c.eh != null ? (s8c.eh * 1000).toFixed(3) : '?'} mm of Ship.wave at 50 points (waves up to ${(s8c.amp || 0).toFixed(2)} m), slopes within ${s8c.es != null ? s8c.es.toExponential(1) : '?'}; the packer on the CPU ${s8c.ec != null ? (s8c.ec * 1000).toFixed(3) : '?'} mm`,
      !!s8c.skip || (s8c.eh <= 0.001 && s8c.es <= 1e-4 && s8c.ec <= 0.001 && s8c.amp > 0.05), s8c);
    // d. no seam: with the waves flattened, the grid is the ocean it replaces (the same pixels within a hair, its edge
    // invisible), and the waves on change the picture
    const s8d = await ev(() => {
      const v = Flight.active, wu = Ship.waveUniforms;
      Ship.waveUniforms = (e, n, t, out) => { const o = wu(e, n, t, out); for (let i = 3; i < o.length; i += 6) o[i] = 0; return o; };
      const flat = window.__buf().buf;
      v.hydro = false; const sea = window.__buf().buf; const I0 = Render3D.swellInfo(); v.hydro = true;
      Ship.waveUniforms = wu; const wav = window.__buf().buf;
      let n = 0, big = 0, sum = 0, nw = 0;
      for (let i = 0; i < flat.length; i += 4) { const d = Math.max(Math.abs(flat[i] - sea[i]), Math.abs(flat[i + 1] - sea[i + 1]), Math.abs(flat[i + 2] - sea[i + 2])); if (d > 3) n++; if (d > 12) big++; sum += d; if (Math.abs(wav[i] - sea[i]) + Math.abs(wav[i + 1] - sea[i + 1]) + Math.abs(wav[i + 2] - sea[i + 2]) > 12) nw++; }
      const px = flat.length / 4;
      return { off: !I0.shown && I0.hole.join() === '1,1,0,0', share: +(n / px).toFixed(5), big: +(big / px).toFixed(5), mean: +(sum / px).toFixed(4), waves: +(nw / px).toFixed(4) };
    });
    ok(`${T}: no seam: the swell's grid flattened draws the ocean it covers (${(s8d.share * 100).toFixed(2)}% of the pixels over 3/255 off, ${(s8d.big * 100).toFixed(3)}% over 12, ${s8d.mean}/255 on average), and the waves on change ${(s8d.waves * 100).toFixed(1)}% of the picture`,
      s8d.off && s8d.share < 0.02 && s8d.big < 0.002 && s8d.mean < 1 && s8d.waves > 0.05, s8d); // (on Low the Fresnel is worked out a vertex: on the grid's 6 m cells a step or two of 255 off the ocean's own)
    // e. under way: a wake laid behind her (one draw), bow spray; the wake's own pixels
    const s8e = await ev(async () => {
      const v = Flight.active, fw = v.axis(1, 0, 0), sp = 12, dt = 1 / 30;
      v.vx = fw.x * sp; v.vy = fw.y * sp; v.vz = fw.z * sp; v.splashed = true;
      Render3D.skipDraw = true;
      let spray = 0;
      for (let i = 0; i < 12 * 30; i++) {
        v.x += v.vx * dt; v.y += v.vy * dt; v.z += v.vz * dt; Flight.time += dt;
        const n0 = FX.list.length; Flight.emitParticles(dt); spray += FX.list.length - n0; FX.update(dt, Flight);
        Flight.updateCamera(); Render3D.renderFlight(Flight, dt, true);
        if ((i & 63) === 63) await new Promise((r) => setTimeout(r, 0));
      }
      Render3D.skipDraw = false;
      const I = Render3D.swellInfo(), a = window.__buf().buf; Render3D.bench.wake = false; const c = window.__buf().buf; Render3D.bench.wake = true;
      v.vx = v.vy = v.vz = 0;
      return { wakes: I.wakes, wverts: I.wverts, recentres: I.recentres, spray, px: window.__diff(a, c).n };
    });
    ok(`${T}: under way at 12 m/s she lays a wake (${s8e.wakes} ribbon set, ${s8e.wverts} vertices, ${s8e.px} px of foam on screen) and throws bow spray (${s8e.spray} puffs in 12 s), the grid following (${s8e.recentres} recentres)`,
      s8e.wakes === 1 && s8e.wverts > 50 && s8e.px > 200 && s8e.spray > 5 && s8e.spray < 12 * 30, s8e);
  }
  await ctx.close();
}
ok('no console errors', errs.length === 0, errs.slice(0, 5).join('\n'));
ok.done();
await b.close(); srv.close();
