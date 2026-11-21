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
//  5. an aircraft that crashes into the water is drawn sinking for SINK_GHOST s of the sim's time, then goes; 5b. one
//     death.js's sea rule sent under at 150 m/s (v.sea) is drawn ploughing on and going under at once, deep within 2 s,
//     gone at SEA.life; a slow one floats and sinks for SEA.slow s
//  6. junk sinking on dry ground takes no slot and leaves the water alone; no new shader program at the first sinking
//     thing (the veils' programs built while the flight loaded)
//  7. no change inland: in Highland Ridge's village, the water's depth (against the old water shader, bench.oldWater)
//     changes only pixels that are the water's (hiding the water changes them too), and no stencil or veil is on (the
//     ground's colours away from the water are checked against the commit before by render-bench --same)
//  8. the swell near a ship (the ships update): with no ship near, none (no grid drawn, the ocean whole); a patrol boat at
//     her marks turns it on (128² cells of 4 m on High, 64² of 6 m on Low) with the ocean cut under it and a recentre's
//     fill timed; the shader's wave function run on the GPU with the uniforms as drawn agrees with Ship.wave within 1 mm
//     at 50 points (and the packer on the CPU); flattened, the grid draws the very ocean it covers (no seam), the waves
//     on change the picture; under way she lays a wake (its pixels: bench.wake) and throws bow spray; the grid filled behind
//     a slice a frame (none over 1.5 ms here, the whole fill timed apart) and swapped in. A tree with no ship skips 8b-e.
//  9. the sea's looks (the ships update, WP15: OB_SEA, seaFrame): on, lakes on the old water, the whitecaps' clock a half
//     float holds, no warm-up mesh kept (a); whitecaps by sea state, no program built at a change of it (b); the sea state
//     from 3 km (c), the same with every vertex's noises (c2); no shimmer, still while paused (d), gliding under rails
//     warp (d2); the swell grid's edge unseen (e);
//     the wake's foam a minute long, kept while the camera is far (f); a wreck in a loch veiled by the old water (g); with
//     no sea in view, the sheet on the old water's program, the same picture (h)
// The console stays clean.     node test/browser/water.mjs
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('water: the sea and the lakes with depth');
const mapIn = () => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' && Render3D.ready;
const T_NOON = 70500;
const BAY = { e: 16400, z: 26400, yaw: 0, air: { alt: 60, speed: 0 } }, SEA = { e: -1344, z: 3967, yaw: 0, air: { alt: 60, speed: 0 } };
const SHIP_AT = { e: -1344, z: 3967, yaw: 0.5 }; // (the open sea of the render bench, a ship's spawn: her heading)
const LOCH = { e: 22670, z: 35050, yaw: 0, air: { alt: 12, speed: 0 } }; // (a loch in Caithness, 10 m up, 4-7 m deep)
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
    // ---- 5b. (the sea rule, death.js) a crash into the sea at 150 m/s, 25° down (v.sea): drawn ploughing on and going
    // under at once, deep within 2 s, gone at SEA.life; a slow one (v.sea, not fast) floats and sinks for SEA.slow s
    const s5b = await ev(async (SEA) => {
      await window.__start('falcon', SEA, [60, 1.2]);
      const R_SEA = (0, eval)('SEA'); // (death.js's constants: the parameter's name hides them here)
      const plunge = (V, dive) => {
        const w = window.__junk(null); Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
        const r = Math.hypot(w.x, w.y, w.z), U = { x: w.x / r, y: w.y / r, z: w.z / r }, f = w.axis(0, 1, 0), k = f.x * U.x + f.y * U.y + f.z * U.z, h = { x: f.x - U.x * k, y: f.y - U.y * k, z: f.z - U.z * k }, n = Math.hypot(h.x, h.y, h.z), th = (dive * Math.PI) / 180;
        w.vx = (h.x / n) * V * Math.cos(th) - U.x * V * Math.sin(th); w.vy = (h.y / n) * V * Math.cos(th) - U.y * V * Math.sin(th); w.vz = (h.z / n) * V * Math.cos(th) - U.z * V * Math.sin(th);
        const c = w.toWorld(w.com.x, w.com.y, w.com.z || 0), L = Terrain.locate(w.body, c.x, c.y, c.z, {});
        Death.sea(w, Flight, L, c); w.dead = true;
        return w;
      };
      const at = (w) => { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); const I = Render3D.waterInfo(); return { mesh: !!Render3D.meshOf(w), s: I.sinks.find((q) => q.sea) || null, stencil: I.stencil }; };
      const t0 = Flight.time, out = {};
      const w = plunge(150, 25); out.fast = !!w.sea.fast;
      for (const dt of [0.05, 0.5, 2]) { Flight.time = t0 + dt; out[dt] = at(w); }
      Flight.time = t0 + R_SEA.life + 0.05; out.end = at(w);
      Flight.vessels.splice(Flight.vessels.indexOf(w), 1); Flight.time = t0;
      const g = plunge(8, 30); out.slowFast = !!g.sea.fast;
      Flight.time = t0 + 3; out.slow3 = at(g);
      Flight.time = t0 + R_SEA.slow + 0.05; out.slowEnd = at(g);
      Flight.vessels.splice(Flight.vessels.indexOf(g), 1); Flight.time = t0;
      return out;
    }, SEA);
    const q05 = s5b[0.5].s, q2 = s5b[2].s;
    ok(`${T}: a crash into the sea at 150 m/s is drawn ploughing on and going under at once: at 0.5 s ${q05 && q05.on} m on, ${q05 && q05.down} m down (its top ${q05 && q05.dep} m under); at 2 s ${q2 && q2.down} m down`,
      s5b.fast && s5b[0.05].mesh && !!q05 && q05.on > 20 && q05.down > 8 && q05.dep > 2 && q05.slot >= 1 && !!q2 && q2.down > 25 && s5b[2].stencil, s5b);
    ok(`${T}: ...and is gone at SEA.life (no mesh, nothing sinking, no stencil); a slow one floats and sinks, drawn at 3 s, gone after SEA.slow`,
      !s5b.end.mesh && !s5b.end.s && !s5b.end.stencil && !s5b.slowFast && s5b.slow3.mesh && !!s5b.slow3.s && s5b.slow3.s.on < 3 && !s5b.slowEnd.mesh && !s5b.slowEnd.s, { end: s5b.end, slow3: s5b.slow3, slowEnd: s5b.slowEnd });
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
    // 9g. (the sea's looks) a wreck sinking in a loch is veiled by the old water, as the loch round it: its pixels with
    // the veils on the sea's program (OB_SEA, uVeil.z 0) against the old water's (bench.oldSea) within a step of 255
    if (await ev(() => typeof Ship !== 'undefined' && !!Render3D.seaInfo)) {
      const s9g = await ev(async (LOCH) => {
        await window.__start('falcon', LOCH, [60, 1.2]);
        const w = window.__junk(0.5); for (let i = 0; i < 3; i++) window.__buf();
        const v = Flight.active, L = Terrain.locate(v.body, w.x, w.y, w.z, {}), lvl = Terrain.surfaceAt(v.body, L.a, L.z), I = Render3D.waterInfo();
        const a = window.__buf().buf; Render3D.bench.oldSea = true; window.__buf(); const b2 = window.__buf().buf; Render3D.bench.oldSea = false; window.__buf();
        const m = Render3D.meshOf(w); m.group.visible = false; const c = window.__buf().buf; m.group.visible = true;
        let mine = 0, off = 0, max = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (a[i] === c[i] && a[i + 1] === c[i + 1] && a[i + 2] === c[i + 2]) continue;
          mine++; const d = Math.max(Math.abs(a[i] - b2[i]), Math.abs(a[i + 1] - b2[i + 1]), Math.abs(a[i + 2] - b2[i + 2])); if (d > 1) off++; max = Math.max(max, d);
        }
        Flight.vessels.splice(Flight.vessels.indexOf(w), 1);
        return { lvl: +lvl.toFixed(2), veils: I.veils, mine, off, max };
      }, LOCH);
      ok(`${T}: a wreck sinking in a loch (${s9g.lvl} m up) is veiled by the old water: ${s9g.off} of its ${s9g.mine} px off the old water's veil by over 1/255 (at most ${s9g.max})`,
        s9g.lvl > 1 && s9g.veils === 1 && s9g.mine > 300 && s9g.off === 0 && s9g.max <= 1, s9g);
      // 9h. with no sea in view (300 m over it, looking up past the horizon) the sea's sheet is drawn by the old water's
      // program (seaSheet: the old cost), and the picture is the one with it on the sea's (bench.seaAll); looking down
      // again, the sea's
      const s9h = await ev(async (SEA) => {
        await window.__start('falcon', { ...SEA, air: { alt: 300, speed: 0 } }, [30, -0.5]);
        const a = window.__buf().buf, up = Render3D.seaInfo().sheet; Render3D.bench.seaAll = true; const b2 = window.__buf().buf, all = Render3D.seaInfo().sheet; Render3D.bench.seaAll = false;
        await window.__start('falcon', { ...SEA, air: { alt: 300, speed: 0 } }, [30, 1.2]); window.__buf();
        return { up, all, down: Render3D.seaInfo().sheet, px: window.__same(a, b2) };
      }, SEA);
      ok(`${T}: with no sea in view (looking up) the sea's sheet is drawn as the old water (${s9h.up}; ${s9h.px} px off the sea's program's picture), looking down as the sea (${s9h.down})`,
        s9h.up === 'old' && s9h.all === 'sea' && s9h.px === 0 && s9h.down === 'sea', s9h);
    }
    // ---- 9. the sea's looks (the ships update, WP15: render3d OB_SEA, seaFrame), on the open sea with no ship near
    if (await ev(() => typeof Ship !== 'undefined' && !!Render3D.seaInfo)) {
      // a. the hooks: OB_SEA in the ocean's program and its uniforms live; lakes and rivers on their own material, the
      // water as it was (no OB_SEA)
      const s9a = await ev(async (SEA) => { await window.__start('falcon', SEA, [60, 1.2]); window.__buf(); return Render3D.seaInfo(); }, SEA);
      ok(`${T}: the sea's looks are on (OB_SEA, the waves' uniforms live: k ${s9a.k && s9a.k.map((k) => k.toFixed(3)).join(', ')}); lakes and rivers keep the old water (their own material, no OB_SEA)`,
        s9a.on && s9a.define && s9a.sheet === 'sea' && s9a.lakeOwn && s9a.inland && !!s9a.lake && !('OB_SEA' in s9a.lake) && 'OB_DEEP' in s9a.lake && s9a.k.every((k) => k > 0.05) && s9a.a.some((a) => a > 0.05), s9a);
      // (the whitecaps' clock folded small enough for a half float to hold its fraction: a GPU without highp fragments
      // keeps them; the lakes' warm-up mesh let go once the flight has loaded: no geometry kept for it)
      ok(`${T}: the whitecaps' clock is folded under 16 (${s9a.w && s9a.w[3].toFixed(3)}: a half float's fraction holds), and the lakes' warm-up mesh is gone after the warm-up`,
        !!s9a.w && s9a.w[3] >= 0 && s9a.w[3] < 16 && !s9a.warmMesh, { w: s9a.w, warmMesh: s9a.warmMesh });
      // b. whitecaps by sea state: 300 m over the open sea looking steeply down, the Sun behind (no glint), the plane's
      // own model hidden, the white pixels (each channel over 175, grey within 45) averaged over six moments 2.5 s apart
      const s9b = await ev(async (SEA) => {
        await window.__start('falcon', { ...SEA, yaw: Math.PI, air: { alt: 300, speed: 0 } }, [30, 1.3]);
        Render3D.meshOf(Flight.active).group.visible = false;
        const t0 = Flight.time, out = { ver: [] };
        for (const st of ['calm', 'moderate', 'rough']) {
          Ship.setSea(st);
          window.__buf(); out.ver.push(Render3D.seaInfo().ver); // (the ocean's material: a rebuild bumps its version)
          let w = 0, n = 0;
          for (const dt of [0, 2.5, 5, 7.5, 10, 12.5]) {
            Flight.time = t0 + dt;
            const { buf } = window.__buf();
            for (let i = 0; i < buf.length; i += 4) { const r = buf[i], g = buf[i + 1], b2 = buf[i + 2], lo = Math.min(r, g, b2); n++; if (lo > 175 && Math.max(r, g, b2) - lo < 45) w++; }
          }
          out[st] = +((100 * w) / n).toFixed(3);
        }
        Ship.setSea('moderate'); Flight.time = t0; Render3D.meshOf(Flight.active).group.visible = true;
        return out;
      }, SEA);
      ok(`${T}: whitecaps by sea state from 300 m: Calm ${s9b.calm}%, Moderate ${s9b.moderate}% (scattered), Rough ${s9b.rough}% (many)`,
        s9b.calm < 0.01 && s9b.moderate > s9b.calm + 0.02 && s9b.rough > 2 * s9b.moderate && s9b.moderate < 3 && s9b.rough < 20, s9b);
      ok(`${T}: a change of the sea state builds no program mid-flight (the ocean's material version ${s9b.ver.join(' → ')})`, s9b.ver.every((v) => v === s9b.ver[0]), s9b.ver);
      // c. the sea state from 3 km: looking down through the haze (the plane hidden, the Sun to the side), the waves'
      // contrast at their own scale (the luminance 4x4-averaged, its spread within 32 px blocks wholly of sea, not cloud:
      // blue over red by 40) and the white flecks (25 over their 9x9 neighbourhood) grow Calm < Moderate < Rough, where the
      // old sea was the same in all three
      const s9c = await ev(async (SEA) => {
        await window.__start('falcon', { ...SEA, yaw: Math.PI / 2, air: { alt: 3000, speed: 0 } }, [30, 1.35]); // (the Sun to the side: no glitter in view)
        Render3D.meshOf(Flight.active).group.visible = false;
        const out = {};
        for (const st of ['calm', 'moderate', 'rough']) {
          Ship.setSea(st);
          const { buf, w, h } = window.__buf(), L = new Float32Array(w * h), sea = new Uint8Array(w * h);
          for (let k = 0; k < w * h; k++) { const i = k * 4; L[k] = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; sea[k] = buf[i + 2] > buf[i] + 40 ? 1 : 0; }
          const bw = w >> 2, bh = h >> 2, B = new Float32Array(bw * bh), BS = new Uint8Array(bw * bh);
          for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let s = 0, all = 1; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const k = (y * 4 + j) * w + x * 4 + i; s += L[k]; all &= sea[k]; } B[y * bw + x] = s / 16; BS[y * bw + x] = all; }
          let sd = 0, nb = 0;
          for (let y = 0; y + 8 <= bh; y += 8) for (let x = 0; x + 8 <= bw; x += 8) {
            let m = 0, m2 = 0, all = 1;
            for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * bw + x + i; m += B[k]; m2 += B[k] * B[k]; all &= BS[k]; }
            if (all) { m /= 64; sd += Math.sqrt(Math.max(0, m2 / 64 - m * m)); nb++; }
          }
          let fl = 0, ns = 0;
          for (let y = 4; y < h - 4; y += 2) for (let x = 4; x < w - 4; x += 2) {
            const k = y * w + x; if (!sea[k]) continue;
            let m = 0; for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) m += L[k + j * w + i];
            ns++; if (L[k] > m / 81 + 25) fl++;
          }
          out[st] = { sd: +(sd / Math.max(1, nb)).toFixed(3), blocks: nb, flecks: +((100 * fl) / Math.max(1, ns)).toFixed(3) };
        }
        Ship.setSea('moderate'); Render3D.meshOf(Flight.active).group.visible = true;
        return out;
      }, SEA);
      ok(`${T}: the sea state reads from 3 km up: the waves' contrast ${s9c.calm.sd} (Calm) < ${s9c.moderate.sd} (Moderate) < ${s9c.rough.sd} (Rough), white flecks ${s9c.calm.flecks}% < ${s9c.rough.flecks}%`,
        s9c.calm.sd < s9c.moderate.sd && s9c.moderate.sd < s9c.rough.sd && s9c.rough.sd > 1.4 * s9c.calm.sd && s9c.calm.flecks < s9c.rough.flecks && s9c.calm.blocks > 20, s9c);
      // c2. the sea's sheet skips its vertex noises where no triangle of it can come on screen (SEA_VS: the frustum's
      // margin): the picture is the very one with every vertex working them out (bench.seaAll), low over the sea, looking
      // down from 300 m, at the horizon from 3 km, and over a bay's shore from 120 m, in Calm and in Rough
      // (the pixels the hook changes that a frame drawn again without it leaves be: anything else that moves from frame to
      // frame, a beacon, smoke, isn't counted)
      const s9c2 = await ev(async ([SEA, BAY]) => {
        const out = [];
        for (const [place, cam] of [[{ ...SEA, air: { alt: 30, speed: 0 } }, [30, 0.2]], [{ ...SEA, yaw: 2, air: { alt: 300, speed: 0 } }, [30, 1.2]], [{ ...SEA, yaw: 4, air: { alt: 3000, speed: 0 } }, [30, 0.4]], [{ ...BAY, yaw: 1, air: { alt: 120, speed: 0 } }, [30, 0.25]]]) {
          await window.__start('falcon', place, cam);
          for (const st of ['calm', 'rough']) {
            Ship.setSea(st);
            const a = window.__buf().buf; Render3D.bench.seaAll = true; const b2 = window.__buf().buf; Render3D.bench.seaAll = false; const c = window.__buf().buf;
            let n = 0; for (let i = 0; i < a.length; i += 4) if ((a[i] !== b2[i] || a[i + 1] !== b2[i + 1] || a[i + 2] !== b2[i + 2]) && a[i] === c[i] && a[i + 1] === c[i + 1] && a[i + 2] === c[i + 2]) n++;
            out.push(n);
          }
        }
        Ship.setSea('moderate');
        return out;
      }, [SEA, BAY]);
      ok(`${T}: the sea's sheet skips its noises only where nothing of it shows: the pictures with every vertex working them out are the same (${s9c2.join(', ')} px apart in 8 views)`, s9c2.every((n) => n === 0), s9c2);
      // d. no shimmer far off, and still while paused: 500 m up looking at the horizon, two frames 1/60 s apart (the sea's
      // clock and the ripples' drift both moving) differ little where the sea is far (the upper half of the sea: a pixel
      // there is metres across), and two frames while paused not at all
      const s9d = await ev(async (SEA) => {
        await window.__start('falcon', { ...SEA, air: { alt: 500, speed: 0 } }, [30, 0.3]);
        Ship.setSea('rough');
        const a = window.__buf(), a2 = window.__buf().buf;
        Flight.paused = false; Flight.time += 1 / 60; const b2 = window.__buf().buf; Flight.paused = true; // (renderFlight steps the ripples' drift by its dt while unpaused)
        const { w, h } = a;
        // the sea's rows: from just under the horizon (the first row, top down, whose middle pixel is blue water) to the middle
        let hz = h; for (let sy = 0; sy < h; sy++) { const i = ((h - 1 - sy) * w + (w >> 1)) * 4; if (a.buf[i + 2] > a.buf[i] + 40) { hz = sy; break; } } // (screen rows, top down: the horizon)
        let n = 0, s = 0, big = 0, still = 0;
        for (let i = 0; i < a.buf.length; i += 4) if (a.buf[i] !== a2[i] || a.buf[i + 1] !== a2[i + 1] || a.buf[i + 2] !== a2[i + 2]) still++;
        for (let sy = hz + 4; sy < h * 0.5; sy++) for (let x = 0; x < w; x++) { const i = ((h - 1 - sy) * w + x) * 4, d = (Math.abs(a.buf[i] - b2[i]) + Math.abs(a.buf[i + 1] - b2[i + 1]) + Math.abs(a.buf[i + 2] - b2[i + 2])) / 3; s += d; n++; if (d > 24) big++; }
        Ship.setSea('moderate');
        return { rows: n / w, mean: +(s / Math.max(1, n)).toFixed(3), big: +(big / Math.max(1, n)).toFixed(5), still };
      }, SEA);
      ok(`${T}: no shimmer far off in Rough: two frames 1/60 s apart differ by ${s9d.mean}/255 on average over the far sea (${s9d.rows} rows), ${(s9d.big * 100).toFixed(3)}% of it over 24/255; paused, ${s9d.still} px change`,
        s9d.rows > 20 && s9d.mean < 2 && s9d.big < 0.01 && s9d.still === 0, s9d);
      // d2. under rails time warp (500×) the drawn sea runs at the fastest physics warp's pace on real time (seaClock): two
      // frames 1/60 s apart, the sim 8.3 s on, differ no more than two at 8× physics warp do (they jumped to a new pattern
      // each frame), its clock steps 8/60 s, and the warp's end puts it back on the sea's clock
      const s9d2 = await ev(async (SEA) => {
        await window.__start('falcon', { ...SEA, air: { alt: 30, speed: 0 } }, [30, 0.3]);
        Ship.setSea('rough');
        const wi = Flight.warpIdx, t0 = Flight.time, I0 = Render3D.seaInfo().t, out = {};
        Flight.paused = false;
        for (const x of [8, 500]) {
          Flight.warpIdx = WARPS.indexOf(x); Flight.time = t0;
          const a = window.__buf(), ta = Render3D.seaInfo().t;
          Flight.time += x / 60; const b2 = window.__buf().buf, tb = Render3D.seaInfo().t;
          const { w, h } = a;
          let n = 0, s = 0;
          for (let sy = Math.floor(h * 0.6); sy < h; sy++) for (let q = 0; q < w; q++) { const i = ((h - 1 - sy) * w + q) * 4; if (a.buf[i + 2] < a.buf[i] + 20) continue; s += (Math.abs(a.buf[i] - b2[i]) + Math.abs(a.buf[i + 1] - b2[i + 1]) + Math.abs(a.buf[i + 2] - b2[i + 2])) / 3; n++; }
          out[x] = { px: n, mean: +(s / Math.max(1, n)).toFixed(3), step: +(tb - ta).toFixed(4) };
        }
        Flight.warpIdx = wi; Flight.paused = true; window.__buf();
        out.back = +(Render3D.seaInfo().t - Ship.seaT(Flight)).toFixed(4); out.was = +(I0 - Ship.seaT({ time: t0 })).toFixed(4);
        Flight.time = t0; Ship.setSea('moderate');
        return out;
      }, SEA);
      ok(`${T}: under rails warp (500×) the near sea glides: two frames differ by ${s9d2[500].mean}/255 on average, as at 8× physics warp (${s9d2[8].mean}), its drawn clock stepping ${s9d2[500].step} s a frame; the warp's end puts it back on the sea's clock`,
        s9d2[500].px > 1000 && s9d2[500].step > 0 && s9d2[500].step < 0.2 && s9d2[500].mean <= 1.25 * s9d2[8].mean + 0.5 && Math.abs(s9d2.back) < 1e-6 && Math.abs(s9d2.was) < 1e-6, s9d2);
    }
    // ---- 8. the swell near a ship (the ships update, render3d updateSwell)
    // a. no ship, no swell: over the open sea a Falcon's frame has no grid on show and no hole in the ocean
    const s8a = await ev(async (SEA) => { await window.__start('falcon', SEA, [60, 1.2]); const I = Render3D.swellInfo(); return { shown: I.shown, on: I.on, hole: I.hole }; }, SEA);
    ok(`${T}: with no ship near, no swell: the grid not drawn, the ocean whole (hole ${s8a.hole})`, !s8a.shown && !s8a.on && s8a.hole.join() === '1,1,0,0', s8a);
    if (await ev(() => !TEMPLATES.cyclon)) { ok(`${T}: (no ship on this tree: the swell's checks skipped)`, true); continue; }
    // b. a patrol boat at her marks in the open sea
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
      Render3D.swellRefill(true); for (let i = 0; i < 60 && Render3D.swellInfo().filling; i++) window.__buf(); // (a recentre's fill, as the frames run it)
      const J = Render3D.swellInfo();
      return { I, ms: +ms[2].toFixed(2), hydro: v.hydro, sl: { frames: J.frames, slice: J.slice, filling: J.filling } };
    }, SHIP_AT);
    const amp = s8b.I.W ? [3, 7, 11, 15].map((i) => s8b.I.W[i]) : [];
    ok(`${T}: a ship near: the swell on, ${s8b.I.N}² cells of ${s8b.I.cell} m round the camera, the ocean cut under it, the waves' amplitudes ${amp.map((a) => a.toFixed(2)).join(', ')} m`,
      s8b.hydro && s8b.I.on && s8b.I.shown && s8b.I.N === (q === 'high' ? 128 : 64) && s8b.I.hole.join() !== '1,1,0,0' && s8b.I.hole[2] > s8b.I.hole[0] && amp.some((a) => a > 0.05), s8b.I);
    ok(`${T}: filling the grid (a recentre) takes ${s8b.ms} ms in all (median of 5), and is done behind the one on show a slice a frame: ${s8b.sl.frames} frames, the worst ${s8b.sl.slice} ms`, s8b.ms < (q === 'high' ? 6 : 3) && s8b.sl.slice < 1.5 && s8b.sl.frames >= 1 && !s8b.sl.filling, { ms: s8b.ms, ...s8b.sl });
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
    // 9e. (the sea's looks) the grid's edge can't be seen with the sea's shading on: the grid with its heights flat
    // (bench.swellFlat) draws the very sea the ocean draws without it, waves, whitecaps and all (no ring, no dotted line
    // at its far edge); the wakes off, as the collar's slap is the grid's alone
    if (await ev(() => !!Render3D.seaInfo && Render3D.seaInfo().on)) {
      const s9e = await ev(() => {
        const v = Flight.active; Render3D.bench.wake = false; Render3D.bench.swellFlat = true;
        const A = window.__buf().buf, I0 = Render3D.swellInfo();
        v.hydro = false; const B = window.__buf().buf, I1 = Render3D.swellInfo(); v.hydro = true;
        Render3D.bench.swellFlat = false; Render3D.bench.wake = true; window.__buf();
        let n = 0, big = 0, sum = 0;
        for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); if (d > 3) n++; if (d > 12) big++; sum += d; }
        const px = A.length / 4;
        return { on: I0.on && I0.shown, off: !I1.shown, share: +(n / px).toFixed(5), big: +(big / px).toFixed(5), mean: +(sum / px).toFixed(4) };
      });
      ok(`${T}: the grid's edge can't be seen: with its heights flat and the sea's shading on, it draws the sea the ocean draws without it (${(s9e.share * 100).toFixed(2)}% of the pixels over 3/255 off, ${(s9e.big * 100).toFixed(3)}% over 12, ${s9e.mean}/255 on average)`,
        s9e.on && s9e.off && s9e.share < 0.02 && s9e.big < 0.002 && s9e.mean < 1, s9e);
    }
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
    // 9f. (the sea's looks) the wake's foam lasts about a minute: a minute more at 12 m/s, its oldest foam drawn 50 s old
    // or more on at most WAKE.pts points (the old part thinned), the collar along her waterline both sides
    if (await ev(() => !!Render3D.seaInfo && Render3D.seaInfo().on)) {
      const s9f = await ev(async () => {
        const v = Flight.active, fw = v.axis(1, 0, 0), sp = 12, dt = 1 / 10;
        v.vx = fw.x * sp; v.vy = fw.y * sp; v.vz = fw.z * sp;
        Render3D.skipDraw = true;
        for (let i = 0; i < 62 * 10; i++) { v.x += v.vx * dt; v.y += v.vy * dt; v.z += v.vz * dt; Flight.time += dt; Flight.updateCamera(); Render3D.renderFlight(Flight, dt, true); if ((i & 63) === 63) await new Promise((r) => setTimeout(r, 0)); }
        Render3D.skipDraw = false;
        const I = Render3D.swellInfo(), a = window.__buf().buf; Render3D.bench.wake = false; const c = window.__buf().buf; Render3D.bench.wake = true;
        // (the camera pulled 4 km off, past WAKE.near: the wake no longer drawn but still recorded; and back: all there)
        const sc = Flight.scale, cam = () => { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); return Render3D.swellInfo(); };
        Flight.scale = (innerHeight / 2) / 4000 / Math.tan((25 * Math.PI) / 180); const far = cam();
        Flight.scale = sc; const back = cam();
        v.vx = v.vy = v.vz = 0;
        return { age: +I.wakeAge.toFixed(1), pts: I.wakePts, collar: I.collar, wverts: I.wverts, px: window.__diff(a, c).n, cap: SHIP.WAKE.pts, a50: +I.wakeA50.toFixed(4), gap: +I.wakeGap.toFixed(2),
          far: { drawn: far.wakePts, rec: far.wakeRec }, back: +back.wakeAge.toFixed(1) };
      });
      ok(`${T}: the wake's foam lasts a minute: after 62 s at 12 m/s its oldest is ${s9f.age} s old on ${s9f.pts} points (at most ${s9f.cap}, ${s9f.gap} s apart at most), drawn at ${s9f.a50} opacity 50 s old, a collar of ${s9f.collar} rings a side, ${s9f.px} px of foam`,
        s9f.age >= 50 && s9f.age <= 61 && s9f.pts <= s9f.cap && s9f.pts >= 30 && s9f.gap <= 2.6 && s9f.a50 >= 0.05 && s9f.collar >= 4 && s9f.px > 200, s9f);
      ok(`${T}: the camera 4 km off, the wake isn't drawn but is kept (${s9f.far.rec} recorded, ${s9f.far.drawn} points drawn); back, its oldest foam is ${s9f.back} s old`,
        s9f.far.rec === 1 && s9f.far.drawn === 0 && s9f.back >= s9f.age - 0.1, s9f);
    }
  }
  await ctx.close();
}
ok('no console errors', errs.length === 0, errs.slice(0, 5).join('\n'));
ok.done();
await b.close(); srv.close();
