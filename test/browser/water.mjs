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
// The console stays clean.     node test/browser/water.mjs
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('water: the sea and the lakes with depth');
const mapIn = () => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' && Render3D.ready;
const T_NOON = 70500;
const BAY = { e: 16400, z: 26400, yaw: 0, air: { alt: 60, speed: 0 } }, SEA = { e: -1344, z: 3967, yaw: 0, air: { alt: 60, speed: 0 } };
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
  }
  await ctx.close();
}
ok('no console errors', errs.length === 0, errs.slice(0, 5).join('\n'));
ok.done();
await b.close(); srv.close();
