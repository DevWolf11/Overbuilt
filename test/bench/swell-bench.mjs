// The swell's GPU cost (the ships update, spec-ships §15: on a phone at Low, at most 5 % over the flat sea): the render
// bench's sea300 view (a plane 300 m over the open sea at noon) with a patrol boat in the water under it, timed with her
// v.hydro on (the swell drawn round the camera, the ocean cut under it) and off (the flat sea as ever), in turns (A B A B,
// so the machine's drift hits both), the same frames, nothing else changed (her own model drawn both ways). Also the
// recentre's fill (CPU, under the phone profile's 4× slowdown). SwiftShader does the GPU's work on the CPU, so a frame's
// wall time stands for GPU cost, as in render-bench.mjs.
//   node test/bench/swell-bench.mjs [--profiles phone,desktop] [--quality low,high] [--rounds 16] [--alt 300]
import { launch, serve, watch, openGame } from '../lib/browser.mjs';
import { seaWaves } from '../lib/seawaves.js';
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PROF = opt('profiles', 'phone,desktop').split(','), QUAL = opt('quality', 'low,high').split(','), ROUNDS = +opt('rounds', 16), ALT = +opt('alt', 300);
const PROFILES = {
  phone: { context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, throttle: 4 },
  desktop: { context: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }, throttle: 1 },
};
const SEA = { e: -1344, z: 3967, yaw: 0 }, T_NOON = 70500;
const srv = await serve(), b = await launch(), errs = [];
const med = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2; };
console.log(`swell-bench: ${PROF.join(',')} × ${QUAL.join(',')}, ${ALT} m up, ${ROUNDS} rounds`);
for (const prof of PROF) for (const q of QUAL) {
  const ctx = await b.newContext(PROFILES[prof].context), page = await ctx.newPage();
  watch(page, errs, `${prof}/${q} `);
  await openGame(page, srv.url, { quality: q, fps: 0, build3d: false });
  await page.waitForFunction(() => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' && Render3D.ready, null, { timeout: 300000, polling: 250 });
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  if (!(await page.evaluate(() => !!TEMPLATES.cyclon))) { console.log('no ships on this tree'); break; }
  await page.evaluate(seaWaves);
  const r = await page.evaluate(async ([SEA, T, ALT, rounds]) => {
    const tp = TEMPLATES.falcon;
    store.set('rss.flight', null); App.showScene('flight');
    Flight.start({ name: tp.name, kind: tp.kind, parts: templateRows(tp) }, { place: { ...SEA, air: { alt: ALT, speed: 170 } } });
    Flight.paused = true; Flight.time = T;
    Render3D.bench.pin = true; Render3D.setVisible(true); Render3D.resize(innerWidth, innerHeight, devicePixelRatio);
    // the boat in the water 120 m ahead of the plane's spot on the sea, her design waterline at sea level
    const f = Flight.active, sp = TEMPLATES.cyclon, ps = partsFromDesign(templateRows(sp)), adj = buildAdjacency(ps), c = findControlPart(ps);
    const s = new Vessel(ps, adj, f.body); s.name = sp.name; s.kind = 'ship'; s.stages = computeStages(ps, adj, c.id); s.rebuildGroups();
    const r0 = Math.hypot(f.x, f.y, f.z), up = { x: f.x / r0, y: f.y / r0, z: f.z / r0 }, fw = f.axis(0, 1, 0), k0 = fw.x * up.x + fw.y * up.y + fw.z * up.z;
    const ax = fw.x - up.x * k0, ay = fw.y - up.y * k0, az = fw.z - up.z * k0, al = Math.hypot(ax, ay, az), R = f.body.radius;
    const P = { x: (f.x / r0) * R + (ax / al) * 120, y: (f.y / r0) * R + (ay / al) * 120, z: (f.z / r0) * R + (az / al) * 120 }, n = Math.hypot(P.x, P.y, P.z);
    s.q = { ...f.q }; s.x = (P.x / n) * R; s.y = (P.y / n) * R; s.z = (P.z / n) * R; s.vx = s.vy = s.vz = 0; s.splashed = true;
    const mid = s.parts.find((p) => p.def.hull), w = s.toWorld(mid.x, mid.y + mid.def.shull.wl, 0), alt = Math.hypot(w.x, w.y, w.z) - R;
    s.x -= up.x * alt; s.y -= up.y * alt; s.z -= up.z * alt;
    Flight.vessels.push(s);
    Render3D.skipDraw = true;
    for (let i = 0; i < 6000; i++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); if (i > 300 && !Render3D.bench.busy()) break; if ((i & 63) === 63) await new Promise((q2) => setTimeout(q2, 0)); }
    Render3D.skipDraw = false;
    const gl = document.getElementById('view3d').getContext('webgl2'), px = new Uint8Array(4);
    const frames = (n) => { const ts = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - t0); } return ts; };
    for (const h of [true, false, true]) { s.hydro = h; frames(3); } // (both ways compiled and settled)
    const on = [], off = [], ratio = [];
    for (let k = 0; k < rounds; k++) { s.hydro = true; const a = frames(2); s.hydro = false; const c2 = frames(2); on.push(...a); off.push(...c2); ratio.push((a[0] + a[1]) / (c2[0] + c2[1])); }
    s.hydro = true; frames(2);
    return { on, off, ratio, info: Render3D.swellInfo() };
  }, [SEA, T_NOON, ALT, ROUNDS]);
  const cdp = await ctx.newCDPSession(page), thr = PROFILES[prof].throttle;
  if (thr > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr });
  const fill = await page.evaluate(() => { const ms = []; for (let i = 0; i < 9; i++) ms.push(Render3D.swellRefill()); return ms.sort((a, c) => a - c)[4]; });
  if (thr > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const rt = med(r.ratio);
  console.log(`${prof.padEnd(7)} ${q.padEnd(4)}  flat sea ${med(r.off).toFixed(2)} ms, with the swell ${med(r.on).toFixed(2)} ms: ×${rt.toFixed(3)} (${((rt - 1) * 100).toFixed(1)}%)${prof === 'phone' && q === 'low' ? (rt <= 1.05 ? '  (budget ≤ +5 %: met)' : '  (budget ≤ +5 %: OVER)') : ''}; the grid ${r.info.N}² of ${r.info.cell} m, on ${r.info.on}; a recentre's fill ${fill.toFixed(2)} ms${thr > 1 ? ` (${thr}× slowed)` : ''}`);
  if (prof === 'phone' && q === 'low' && rt > 1.05) process.exitCode = 1;
  await ctx.close();
}
if (errs.length) { console.log('console errors:\n' + errs.slice(0, 10).join('\n')); process.exitCode = 1; }
await b.close(); srv.close();
