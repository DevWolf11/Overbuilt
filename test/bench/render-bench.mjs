// The 3D view's cost and picture before and after a change: fixed scenes at a fixed pixel ratio in headless Chromium
// (SwiftShader does the GPU's work on the CPU, so a finished frame's wall time stands for GPU cost), draw calls and
// vertices by pass, the CPU's share (the same frames with Render3D.skipDraw; a CDP 4x slowdown on the phone profile),
// a CPU profile of the busiest scene, particle fill, programs, and each scene's pixels.
// node test/bench/render-bench.mjs [--base <dir>] [--profiles phone,desktop] [--quality high,low] [--scenes a,b]
//      [--frames 2] [--rounds 16] [--fov 100] [--cpuprofile] [--save out.json] [--shots dir] [--check] [--same] [--find-times]
//
// Two trees, A and B: B is this checkout (or ROOT=<dir>), A the --base tree (a worktree of the commit to compare
// against: git worktree add ../ob-base 68ea3fe). Without --base only B is measured. Both run the same code here: before
// the page loads, render3d.js is patched at two anchors that every tree has (const perf …; function adaptResolution(dt) {)
// so the pixel ratio stays pinned on a tree with no Render3D.bench, and a tree's render clock and build state can be read
// and set (window.__rb), so A and B draw the very same frames. A and B take turns (A B A B …) and Math.random is reseeded
// before every frame, so a picture hook that changes nothing shows identical pixels (--same fails the run otherwise; a
// flight scene may differ in at most 0.01% of its pixels, as the base tree against itself does, the hangar in none).
// --check fails (exit 1) on a breach of the budgets of spec-graphics §3.4; --find-times prints the scene constants below
// (the times of day, the sea, the town and the land), found on this tree. Not in run.mjs: a full run takes an hour or two.
// The damage model's two scenes (spec-damage §11), rangefight and wrecks8, step the simulation in every timed frame, so
// their cpuMs is a whole frame's JS (physics, Combat.frame, the fires, falls, crashes and wrecks' smoke, the renderer's
// share); they run only when named and --check reports them without budgets (each tree plays its own rules):
//   node test/bench/render-bench.mjs --base ../ob-p1 --scenes rangefight,wrecks8 --profiles phone --quality low
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { ROOT, launch, serve, watch, openGame } from '../lib/browser.mjs';

// ---------------------------------------------------------------------------------------------------------- constants
// Found with --find-times (on big-ga, 2026-11-04) and committed, so every tree draws the same moments and places:
// T_NOON: the Sun 45° up over the runway (full daylight, shadows a body length long); T_DUSK: the sunset's warmth 0.7 at
// the runway (the Sun about 6° up); SEA: the nearest open water to the runway (no land within 3 km round, nor for 20 km
// ahead), the nose towards the Sun; TOWN: the most built-up 1 km cell within 40 km of the pad; LAND: green lowland in
// Scotland (dry, open ground 1.5 km round and 8 km ahead), the "over land" of the low, 10 km and dogfight scenes.
const T_NOON = 70500, T_DUSK = 130000;
const SEA = { e: -1344, z: 3967, yaw: 0, air: { alt: 120, speed: 170 } };
const TOWN = { e: 35000, z: 25000, yaw: 0.4 };
const HL = { e: 18190, z: 15040, yaw: 0 }; // Highland Ridge's village, a TK-34 in the street
const LAND = { e: 20000, z: 38000, yaw: 5.3124 };

// the scenes: craft (a template key), place (a spawn as Flight.start takes it; none: its kind's site), time, what it
// stresses; load: scripted effects; props: the props sets it shows (and waits for); hangar: the 3D builder instead
const SCENES = {
  runway: { key: 'falcon', time: 'noon', what: 'space centre, shadows, glass, the shadow filter' },
  lowland: { key: 'falcon', place: { ...LAND, air: { alt: 250, speed: 180 } }, time: 'noon', what: 'terrain, trees, fog, clouds, anti-tiling', land: true },
  sea: { key: 'falcon', place: SEA, time: 'noon', what: 'water', sea: true },
  town: { key: 'buggy', place: TOWN, time: 'noon', what: 'the city shadow cut', town: true },
  alt10k: { key: 'falcon', place: { ...LAND, air: { alt: 10000, speed: 240 } }, time: 'noon', what: 'sky, haze from altitude' },
  highland: { key: 'tk34', place: HL, time: 'noon', what: 'arena mesh, props, shadow box, blobs', props: ['hl'] },
  battle: { key: 'tk34', place: HL, time: 'noon', what: 'particles, debris, lights, tracers, sorting', props: ['hl'], load: 'battle' },
  dogfight: { key: 'falcon', place: { ...LAND, air: { alt: 3000, speed: 200 } }, time: 'noon', what: 'trails, tracers, an air death', load: 'dogfight' },
  dusk: { key: 'falcon', time: 'dusk', what: 'fog in-scatter, sky, sunset colours' },
  hangar: { key: 'tk34', hangar: true, what: 'the hangar, byte for byte (a craft with no glass)' },
  // (the drone package: a stock drone 20 m up in Highland Ridge seen through its camera at --fov; needs a drone template)
  fpv: { drone: true, place: { ...HL, air: { alt: 20, speed: 0 } }, time: 'noon', what: 'the drone\'s FPV view at --fov', props: ['hl'] },
  // (the damage model, spec-damage §11: the simulation stepped in every timed frame as the game steps it, Flight.update, so
  // its cpuMs is the JS of a whole frame. Named with --scenes only; reported, not judged by --check: each tree plays its
  // own rules, so their pictures and their pieces differ on purpose)
  rangefight: { key: 'falcon', place: { e: 6000, z: 0, yaw: 0, air: { alt: 1500, speed: 200 } }, time: 'noon', what: 'a Hostile range fight: two bandits shot down (one burning), one crashing, the sim stepped', load: 'rangefight', sim: true, targets: 'hostile' },
  wrecks8: { key: 'tk34', place: HL, time: 'noon', what: 'eight knocked-out tanks in Highland Ridge (burning, smoking, wisps; baked), the sim stepped', props: ['hl'], pre: 'wrecks8', sim: true },
};
const QUIET = ['runway', 'lowland', 'sea', 'alt10k', 'highland', 'dusk'], BUSY = ['battle', 'dogfight'], SIM = ['rangefight', 'wrecks8'];
const PROFILES = {
  phone: { context: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, throttle: 4 },
  desktop: { context: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }, throttle: 1 },
};

// ---------------------------------------------------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const A_DIR = opt('base', null) ? path.resolve(opt('base')) : null, B_DIR = ROOT;
const PROF = opt('profiles', 'phone,desktop').split(','), QUAL = opt('quality', 'high,low').split(',');
const FRAMES = +opt('frames', 2), ROUNDS = +opt('rounds', 16), FOV = +opt('fov', 100), CPU_FRAMES = 12;
const SAVE = opt('save', null), SHOTS = opt('shots', null);
let LIST = opt('scenes', Object.keys(SCENES).filter((k) => k !== 'fpv' && !SIM.includes(k)).join(',')).split(',');
for (const k of [...PROF.filter((p) => !PROFILES[p]), ...LIST.filter((s) => !SCENES[s]), ...QUAL.filter((q) => !['high', 'low'].includes(q))]) throw new Error('unknown profile, scene or quality: ' + k);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const commit = (dir) => { try { const c = execSync('git rev-parse --short HEAD', { cwd: dir, encoding: 'utf8' }).trim(); const d = execSync('git status --porcelain -- js', { cwd: dir, encoding: 'utf8' }).trim(); return c + (d ? '+dirty' : ''); } catch { return '?'; } };

// ---------------------------------------------------------------------------------------------------------- the page
// render3d.js as served: the two frozen anchors. Before adaptResolution (module scope inside Render3D): __perf, and
// __rb: the render clock (read or set), the clouds sorted afresh on the next frame (the order they were last sorted in
// depends on where the camera was then, to within a metre), and whether anything is still being built a slice a frame
// (null if this tree's internals differ: then the harness waits on the props and a frame count instead).
const ANCHOR_PERF = 'const perf = { ema: 1 / 60, scale: 1, at: 0 };', ANCHOR_AR = 'function adaptResolution(dt) {';
const RB = 'window.__rb = { clock(v) { try { if (v != null) clock = v; return clock; } catch (e) { return null; } }, ' +
  'resort() { try { S.clouds.sortAt = -9; S.clouds.sortP = null; } catch (e) { /* (another tree) */ } }, busy() { try { return !!(pjob || bandWait || (S.scenery && S.scenery.job) || ' +
  '(S.clouds && S.clouds.job) || jobs.length || AR.job || AR.bjob || [...PR.sets.values()].some((s) => s.job)); } catch (e) { return null; } } };\n  ';
async function routePatch(page) {
  await page.route('**/js/render3d.js', async (route) => {
    const r = await route.fetch(), s = await r.text();
    if (!s.includes(ANCHOR_PERF) || !s.includes(ANCHOR_AR)) { console.error('render-bench: a render3d.js anchor is missing (frozen: ' + JSON.stringify([ANCHOR_PERF, ANCHOR_AR]) + ')'); process.exit(2); }
    route.fulfill({ response: r, body: s.replace(ANCHOR_PERF, 'const perf = window.__perf = { ema: 1 / 60, scale: 1, at: 0 };').replace(ANCHOR_AR, RB + ANCHOR_AR + ' if (window.__fixed) return;') });
  });
}
// before any page script: Math.random reseedable (mulberry32), WebGL programs created counted (any tree), draws by pass
const INIT = () => {
  window.__mb = (s) => () => { let t = (s = (s + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__seed = (n) => { Math.random = window.__mb(n >>> 0); };
  const P = WebGL2RenderingContext.prototype, cp = P.createProgram;
  window.__glProg = 0;
  P.createProgram = function () { window.__glProg++; return cp.call(this); };
  // passes: on while __pass is an object; the pass told by the framebuffer and the viewport at draw time
  const fb = P.bindFramebuffer, de = P.drawElements, da = P.drawArrays, dei = P.drawElementsInstanced, dai = P.drawArraysInstanced;
  let cur = null;
  P.bindFramebuffer = function (t, f) { if (t === this.FRAMEBUFFER || t === this.DRAW_FRAMEBUFFER) cur = f; return fb.call(this, t, f); };
  const add = (gl, n, i) => {
    const C = window.__pass;
    if (!C) return;
    let k = 'canvas';
    if (cur) { const v = gl.getParameter(gl.VIEWPORT); k = v[2] === 2048 && v[3] === 2048 ? 'shadow' : 'env'; }
    const q = C[k] || (C[k] = { draws: 0, verts: 0 });
    q.draws++; q.verts += n * i;
  };
  P.drawElements = function (m, n, t, o) { add(this, n, 1); return de.call(this, m, n, t, o); };
  P.drawArrays = function (m, f, n) { add(this, n, 1); return da.call(this, m, f, n); };
  P.drawElementsInstanced = function (m, n, t, o, i) { add(this, n, i); return dei.call(this, m, n, t, o, i); };
  P.drawArraysInstanced = function (m, f, n, i) { add(this, n, i); return dai.call(this, m, f, n, i); };
};

// in the page: the Sun where the craft is, as render3d's envAt has it (any tree): elevation, daylight and the sunset's warmth
const ENV = `window.__env = () => {
  const v = Flight.active, b = v.body, bp = bodyPos(b, Flight.time), r = Math.hypot(v.x, v.y, v.z) || 1, ax = bp.x + v.x, ay = bp.y + v.y, sl = Math.hypot(ax, ay) || 1;
  const elev = (v.x / r) * (-ax / sl) + (v.y / r) * (-ay / sl), atmo = b.atmoHeight ? clamp(1 - (r - b.radius) / b.atmoHeight, 0, 1) : 0;
  const day = 1 - (1 - smoothstep(-0.18, 0.06, elev)), sunset = atmo * clamp(1 - Math.abs(elev - 0.03) / 0.28, 0, 1);
  return { elev, day, sunset, sx: -ax / sl, sy: -ay / sl };
};`;

const mapIn = () => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' && typeof Render3D !== 'undefined' && Render3D.ready;
async function openTree(browser, dir, url, profile, quality, tag, errs) {
  const ctx = await browser.newContext(PROFILES[profile].context);
  const page = await ctx.newPage();
  await routePatch(page);
  await page.addInitScript(INIT);
  watch(page, errs, tag + ' ');
  await openGame(page, url, { quality, fps: 0, build3d: false });
  await page.waitForFunction(mapIn, null, { timeout: 300000, polling: 250 });
  // App's loop stops for good (only the harness draws from here on); a frame it had asked for runs out on the home screen
  await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await page.waitForTimeout(300);
  await page.evaluate(ENV);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, dir, tag, ev: (f, a) => page.evaluate(f, a) };
}

// ---------------------------------------------------------------------------------------------------------- a scene
// Start it, pin the pixel ratio, set the time of day
async function startScene(T, name) {
  const S = SCENES[name];
  return T.ev(([S, t, fov]) => {
    window.__fixed = true;
    if (Render3D.bench) Render3D.bench.pin = true;
    store.set('rss.flight', null);
    if (S.hangar) {
      Settings.set('build3d', true);
      App.toBuild(); Builder.xray = false; Builder.loadTemplate(S.key); // (Armour's X-ray off: the hangar as built, not see-through)
    } else {
      let key = S.key;
      if (S.drone) { key = Object.keys(TEMPLATES).find((k) => TEMPLATES[k].kind === 'drone'); if (!key) return { skip: 'no drone template on this tree' }; }
      const tp = TEMPLATES[key];
      if (S.targets) Settings.set('targets', S.targets); // (the range's mode: the fighters live only in Hostile)
      App.showScene('flight');
      Flight.start({ name: tp.name, kind: tp.kind, parts: templateRows(tp) }, S.place ? { place: S.place } : undefined);
      Flight.paused = true;
      Flight.time = t;
      // ground play as Combat.frame says it (the paused flight never runs it): Highland Ridge's props on show
      const v = Flight.active;
      if (typeof Props !== 'undefined') Props.play = v.kind === 'tank' || !!v.gv || !!(v.gear && v.gear.length);
      if (S.drone && Render3D.setFov) Render3D.setFov(fov);
    }
    Render3D.setVisible(true);
    window.__perf.scale = 1; Render3D.resize(innerWidth, innerHeight, devicePixelRatio);
    return { ok: true, scale: window.__perf.scale };
  }, [S, S.time === 'dusk' ? T_DUSK : T_NOON, FOV]);
}
// One frame drawn (or not) the way renderFlight/renderBuilder are driven here. In the page.
// A scene with sim (window.__sim, from its effects on): the simulation's step first, as App.frame runs it (Flight.update:
// physics, Combat.frame, the effects), the flight unpaused for it.
const FRAME = `window.__frame = (dt, seed) => {
  if (seed != null) window.__seed(seed);
  if (App.scene === 'build') return Render3D.renderBuilder(Builder, dt, true);
  if (window.__sim) { Flight.paused = false; try { Flight.update(dt); } finally { Flight.paused = true; } }
  Flight.updateCamera(); return Render3D.renderFlight(Flight, dt, true);
};`;
// Warm up with nothing drawn (the follow camera settles, everything is built), at least `min` frames and until nothing
// has been in the building for 30 frames and the scene's props are up. Render3D.bench.busy (or the route patch's __rb on
// an older tree) says what is being built; on a tree whose insides differ (null), the props and the frame count only.
async function warm(T, name, min) {
  const S = SCENES[name];
  await T.ev(FRAME);
  return T.ev(async ([S, min]) => {
    if (S.hangar) { // (the hangar always draws; a first frame makes it the builder's view, then the turntable stops and the camera eases into place)
      window.__frame(0.1, 1); Render3D.orbitBy(0, 0);
      for (let i = 0; i < 40; i++) window.__frame(0.1, 1);
      return { frames: 41 };
    }
    const busy = () => (Render3D.bench ? Render3D.bench.busy() : window.__rb.busy());
    const props = () => !S.props || S.props.every((k) => { const I = Render3D.propsInfo()[k]; return !!I && I.ready && !I.job && I.shown; });
    Render3D.skipDraw = true;
    let n = 0, quiet = 0, b = null;
    const t0 = performance.now();
    for (; n < 6000; n++) {
      window.__frame(1 / 60, 1);
      b = busy();
      quiet = b !== true && props() ? quiet + 1 : 0;
      if (n >= min && quiet >= 30) break;
      if ((n & 63) === 63) await new Promise((r) => setTimeout(r, 0)); // (let the page breathe: map tiles, textures)
    }
    Render3D.skipDraw = false;
    return { frames: n, busy: b, props: props(), ms: Math.round(performance.now() - t0) };
  }, [S, min]);
}
// the scripted effects (battle, dogfight), the same calls on every tree: FX.death/smoke/flame/trail where the tree has
// them, else FX.explosion and plain FX.add of the same counts; then 0.4 s of FX.update, so they are mid-life
const LOAD = `window.__load = (kind) => {
  window.__seed(1); if (FX.seed) FX.seed(1);
  const v = Flight.active, b = v.body, r0 = Math.hypot(v.x, v.y, v.z), up = { x: v.x / r0, y: v.y / r0, z: v.z / r0 };
  const F = v.pilot.F, f = v.axis(F.x, F.y, F.z), k0 = f.x * up.x + f.y * up.y + f.z * up.z;
  const fw = { x: f.x - up.x * k0, y: f.y - up.y * k0, z: f.z - up.z * k0 }, fl = Math.hypot(fw.x, fw.y, fw.z); fw.x /= fl; fw.y /= fl; fw.z /= fl;
  const rt = { x: fw.y * up.z - fw.z * up.y, y: fw.z * up.x - fw.x * up.z, z: fw.x * up.y - fw.y * up.x }, Z = { x: 0, y: 0, z: 0 };
  const at = (a, s, u, ground) => { // a m ahead, s m right, u m up (on the ground: u over the ground there)
    const p = { x: v.x + fw.x * a + rt.x * s + up.x * u, y: v.y + fw.y * a + rt.y * s + up.y * u, z: v.z + fw.z * a + rt.z * s + up.z * u };
    if (!ground) return p;
    const L = Terrain.locate(b, p.x, p.y, p.z, {}), rr = b.radius + Terrain.surfaceAt(b, L.a, L.z) + u, n = Math.hypot(p.x, p.y, p.z);
    return { x: p.x / n * rr, y: p.y / n * rr, z: p.z / n * rr };
  };
  // (without the effects API: the presets' colour, size, growth, life and alpha, drifting up as they would rise)
  const SM = { black: ['#26272b', 1.0, 5, 3.5, 0.7], column: ['#303236', 2.5, 12, 9, 0.55] };
  const death = (p, size, kind) => (FX.death ? FX.death(b, p, Z, size, kind) : FX.explosion(b, p, Z, size, kind === 'air'));
  const smoke = (p, pre) => (FX.smoke ? FX.smoke(b, p, Z, pre) : FX.add({ kind: 'smoke', b, x: p.x, y: p.y, z: p.z, vx: up.x * 2, vy: up.y * 2, vz: up.z * 2,
    max: SM[pre][3] * (0.85 + 0.3 * Math.random()), size: SM[pre][1], grow: SM[pre][2], color: SM[pre][0], alpha: SM[pre][4] }));
  const flame = (p) => (FX.flame ? FX.flame(b, p, Z) : FX.add({ kind: 'fire', b, x: p.x, y: p.y, z: p.z, vx: up.x * 4, vy: up.y * 4, vz: up.z * 4,
    max: 0.5 + 0.3 * Math.random(), size: 0.7, grow: 1.3, color: '#ff9a3c', alpha: 1 }));
  const trail = (p, w, n) => { if (FX.trail) return FX.trail(b, p, w, 'black', n, 1 / 60); for (let i = 0; i < n; i++) { const g = i / n / 60; smoke({ x: p.x - w.x * g, y: p.y - w.y * g, z: p.z - w.z * g }, 'black'); } };
  const tracers = (n, from, to, s, u) => { for (let i = 0; i < n; i++) { const a = from + (to - from) * (i / n), p = at(a, s + (i % 7) * 2 - 6, u + (i % 5)), d = (i & 1) ? 1 : -1; Combat.shots.push({ k: 'bullet', tracer: true, b, x: p.x, y: p.y, z: p.z, vx: rt.x * 900 * d, vy: rt.y * 900 * d, vz: rt.z * 900 * d }); } };
  if (kind === 'battle') {
    death(at(40, 0, 0, true), 5, 'ammo');
    death(at(120, -25, 0, true), 6, 'crash');
    death(at(600, 120, 200), 4, 'air'); // (300 m up in the spec's words: here 200 m up, 600 m off, where the camera sees it)
    for (const [a, s] of [[60, -30], [120, 40], [200, -60]]) { for (let i = 0; i < 30; i++) smoke(at(a, s, 1, true), 'column'); for (let i = 0; i < 10; i++) flame(at(a, s, 1, true)); }
    const w = { x: rt.x * 80, y: rt.y * 80, z: rt.z * 80 }; // a burning plane crossing 150 m ahead, 60 m up
    for (let i = 0; i < 40; i++) trail(at(150, -60 + i * 80 / 60, 60), w, 4);
    tracers(60, 30, 300, 0, 2);
    FX.sparks(b, at(30, 0, 1, true), Z, 60);
  } else if (kind === 'dogfight') {
    const e = Combat.spawnFighter(Flight), P = at(400, 30, 40); // the bandit 400 m ahead (a little up and right), flying as we do
    e.x = P.x; e.y = P.y; e.z = P.z; e.q = { ...v.q }; e.vx = v.vx; e.vy = v.vy; e.vz = v.vz; e.ai.hold = true;
    const w = { x: v.vx, y: v.vy, z: v.vz };
    for (let i = 0; i < 150; i++) { const g = (150 - i) / 60; trail({ x: P.x - w.x * g, y: P.y - w.y * g, z: P.z - w.z * g }, w, 4); }
    for (let i = 0; i < 100; i++) { const p = at(20 + i * 3.6, (i % 3) - 1, (i % 4) - 1.5); Combat.shots.push({ k: 'bullet', tracer: true, b, x: p.x, y: p.y, z: p.z, vx: v.vx + fw.x * 900, vy: v.vy + fw.y * 900, vz: v.vz + fw.z * 900 }); }
    death(at(600, 150, 0), 4, 'air');
  } else if (kind === 'rangefight') {
    // two bandits flying as we do, shot down (their cockpits; the kills ours): one 300 m ahead with an engine on fire,
    // one 400 m ahead and right, 40 m over the ground and diving at 60 m/s (it crashes in the frames measured)
    const mk = (P, dive) => { const e = Combat.spawnFighter(Flight); e.x = P.x; e.y = P.y; e.z = P.z; e.q = { ...v.q }; e.vx = v.vx - up.x * dive; e.vy = v.vy - up.y * dive; e.vz = v.vz - up.z * dive; e.ai.hold = true; e.lastHitBy = v; e.lastHitAt = Flight.time; return e; };
    const e1 = mk(at(300, -20, 10), 0), e2 = mk(at(400, 40, 40, true), 60), eng = e1.parts.find((p) => p.def.thrust);
    if (typeof Death !== 'undefined' && typeof Death.ignite === 'function') Death.ignite(e1, eng, 1, v, Flight);
    for (const e of [e1, e2]) Combat.damage(e, e.control, 1e6, 'shot', Flight, v);
    tracers(40, 30, 300, 0, 2);
  } else if (kind === 'wrecks8') {
    // (before the warm-up) eight TK-34s knocked out round the street, 30-95 m ahead, frozen where they stand: two by an
    // ammunition detonation 5 s ago (burning), three 60 s ago (smoking), three 150 s ago (a wisp); their blasts cleared
    const tp = TEMPLATES.tk34, ages = [5, 5, 60, 60, 60, 150, 150, 150], spots = [[30, -12], [35, 10], [50, -25], [55, 22], [70, -8], [75, 30], [90, -35], [95, 12]];
    for (const [i, [a, s]] of spots.entries()) {
      const ps = partsFromDesign(templateRows(tp)), all = buildAdjacency(ps), c = findControlPart(ps), keep = componentOf(c.id, all), kp = ps.filter((p) => keep.has(p.id)), adj = new Map();
      for (const p of kp) adj.set(p.id, new Set([...all.get(p.id)].filter((id) => keep.has(id))));
      const w = new Vessel(kp, adj, b); w.name = tp.name; w.kind = tp.kind; w.stages = computeStages(kp, adj, c.id); w.rebuildGroups();
      const P = at(a, s, 1.6, true); w.q = { ...v.q }; w.x = P.x; w.y = P.y; w.z = P.z; w.vx = w.vy = w.vz = 0;
      Flight.vessels.push(w); w.lastHitBy = v;
      Armour.knockOut(w, Flight, i < 2 ? 'ammo' : 'crew', i < 2 ? { st: Armour.crewOf(w).stores[0], rounds: 30 } : undefined);
      if (w.ko) w.ko.t = Flight.time - ages[i];
      w.wreck = true; w.vx = w.vy = w.vz = 0; w.av = { x: 0, y: 0, z: 0 };
    }
    for (const o of Flight.vessels) if (o.tossed) { o.wreck = true; o.vx = o.vy = o.vz = 0; o.av = { x: 0, y: 0, z: 0 }; }
    if (FX.clear) FX.clear(); else FX.list.length = 0;
    return { fx: FX.list.length, wrecks: Flight.vessels.filter((o) => o.wreck).length };
  }
  FX.update(0.4, Flight);
  return { fx: FX.list.length, shots: Combat.shots.length };
};`;
// What the scene stands for, checked on every tree (fails loudly otherwise)
async function cond(T, name) {
  const S = SCENES[name];
  return T.ev((S) => {
    if (S.hangar) { // no glass in the hangar's craft (canopy glass is meant to change): a throwaway model of its parts
      const vm = new Parts3D.VesselMesh(Builder.parts, { builder: true }); let glass = 0;
      vm.group.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) if (m.userData && m.userData.glass) glass++; });
      vm.dispose();
      return { ok: glass === 0, glass };
    }
    const E = window.__env(), v = Flight.active, out = { elev: +E.elev.toFixed(3), day: +E.day.toFixed(3), sunset: +E.sunset.toFixed(3) };
    const cam = Render3D.aimRay(); // (where the camera is and looks: the same on both trees, or their pictures can't match)
    if (cam) out.cam = [cam.o.x, cam.o.y, cam.o.z, cam.d.x, cam.d.y, cam.d.z].map((q) => +q.toFixed(4)).concat(+Flight.scale.toFixed(4));
    if (Render3D.bench) { out.benchDay = +Render3D.bench.day().toFixed(3); out.benchSunset = +Render3D.bench.sunset().toFixed(3); }
    let ok = S.time === 'dusk' ? Math.abs(E.sunset - 0.7) < 0.1 : E.day > 0.95;
    if (S.sea) { const L = Terrain.locate(v.body, v.x, v.y, v.z, {}), f = v.axis(0, 1, 0); out.water = Terrain.waterAt(v.body, L.a, L.z); out.sunAhead = +(f.x * E.sx + f.y * E.sy).toFixed(2); ok = ok && out.water && out.sunAhead > 0.3; }
    if (S.land) { const L = Terrain.locate(v.body, v.x, v.y, v.z, {}); out.land = !Terrain.waterAt(v.body, L.a, L.z); ok = ok && out.land; }
    if (S.town) { const L = Terrain.locate(v.body, v.x, v.y, v.z, {}); out.urban = +Terrain.urbanAt(L.a, L.z).toFixed(2); ok = ok && out.urban > 0.8; }
    if (S.props) { const I = Render3D.propsInfo(); out.props = S.props.map((k) => !!(I[k] && I[k].shown && I[k].ready)); ok = ok && out.props.every(Boolean); }
    return { ...out, ok };
  }, S);
}
// timed frames: median wall time of the frame and a one-pixel read (the GPU's work done)
const timed = (T, n, skip) => T.ev(([n, skip]) => {
  const gl = document.getElementById('view3d').getContext('webgl2'), px = new Uint8Array(4), ts = [];
  Render3D.skipDraw = !!skip;
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    window.__frame(1 / 60, 1);
    if (!skip) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    ts.push(performance.now() - t0);
  }
  Render3D.skipDraw = false;
  return ts;
}, [n, skip]);
// one frame with the passes counted, then one whose pixels are read whole (FNV-1a; the buffer for diffs and PNGs)
async function snapshot(T, want) {
  return T.ev((want) => {
    const gl = document.getElementById('view3d').getContext('webgl2');
    window.__pass = {};
    window.__frame(1 / 60, 1);
    const passes = window.__pass; window.__pass = null;
    const I = Render3D.info();
    // the particles' fill in screens: the tree's own measure (Render3D.bench.fill), and the harness's on every tree
    let est = 0;
    if (App.scene !== 'build') {
      const t = Flight.time, o = {};
      for (const p of FX.list) {
        const bp = bodyPos(p.b, t), x = bp.x + p.x, y = bp.y + p.y, z = p.z || 0, s = Render3D.projectTo(x, y, z, o);
        if (s.behind) continue;
        const r = (p.size + (p.grow || 0) * Math.min(1, p.life / p.max)) / Render3D.metresPerPixelAt(x, y, z);
        if (s.x + r < 0 || s.y + r < 0 || s.x - r > innerWidth || s.y - r > innerHeight) continue;
        est += (Math.PI * r * r) / (innerWidth * innerHeight);
      }
    }
    window.__frame(1 / 60, 1);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let hs = 0x811c9dc5;
    for (let i = 0; i < buf.length; i++) hs = Math.imul(hs ^ buf[i], 16777619);
    let b64 = null;
    if (want) { let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); b64 = btoa(s); }
    const out = {
      passes, calls: I.calls, triangles: I.triangles, textures: I.memory.textures, geometries: I.memory.geometries, pixelRatio: I.pixelRatio,
      programs: I.programs != null ? I.programs : null, glPrograms: window.__glProg, proxies: I.proxies || null, patched: I.patched || null,
      fx: typeof FX !== 'undefined' ? FX.list.length : 0, fillEst: +est.toFixed(3), fill: Render3D.bench && Render3D.bench.fill > 0 ? +Render3D.bench.fill.toFixed(3) : +est.toFixed(3),
      hash: (hs >>> 0).toString(16), w, h, b64,
    };
    return out;
  }, want);
}
// a CPU profile of n frames (self ms a frame of the functions that matter)
const PROF_FNS = ['updateParticles', 'updateStreaks', 'update', 'shadowProxies', 'syncDecals', 'renderFlight', 'syncVessels', 'syncCombat'];
async function profile(T, n) {
  await T.cdp.send('Profiler.enable');
  await T.cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await T.cdp.send('Profiler.start');
  await timed(T, n, false);
  const { profile: P } = await T.cdp.send('Profiler.stop');
  const dt = [], self = {};
  const byId = new Map(P.nodes.map((q) => [q.id, q]));
  for (let i = 0; i < P.samples.length; i++) dt.push((P.timeDeltas[i + 1] != null ? P.timeDeltas[i + 1] : 0) / 1000);
  for (let i = 0; i < P.samples.length; i++) {
    const q = byId.get(P.samples[i]), f = q.callFrame, nm = f.functionName === 'update' && /world\.js/.test(f.url) ? 'FX.update' : f.functionName;
    if (!PROF_FNS.includes(f.functionName)) continue;
    if (f.functionName === 'update' && nm !== 'FX.update') continue;
    self[nm] = (self[nm] || 0) + dt[i];
  }
  for (const k in self) self[k] = +(self[k] / n).toFixed(3);
  return self;
}

// ---------------------------------------------------------------------------------------------------------- pictures
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function png(w, h, rgba) { // rgba: bottom row first, as readPixels gives it
  const raw = Buffer.alloc((w * 4 + 1) * h), row = w * 4;
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (row + 1) + 1, (h - 1 - y) * row, (h - y) * row);
  const chunk = (t, d) => { const l = Buffer.alloc(4), c = Buffer.alloc(4), td = Buffer.concat([Buffer.from(t), d]); l.writeUInt32BE(d.length); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function diffShare(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  return n / (a.length / 4);
}

// ---------------------------------------------------------------------------------------------------------- find-times
async function findTimes(browser, url) {
  const errs = [], T = await openTree(browser, B_DIR, url, 'desktop', 'high', 'B', errs);
  const r = await T.ev(async () => {
    window.requestAnimationFrame = () => 0;
    const tp = TEMPLATES.falcon;
    App.showScene('flight');
    Flight.start({ name: tp.name, kind: tp.kind, parts: templateRows(tp) }); Flight.paused = true;
    Render3D.setVisible(true); Render3D.skipDraw = true;
    const at = (t) => { Flight.time = t; Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); const e = window.__env(); return { t, elev: e.elev, day: Render3D.bench ? Render3D.bench.day() : e.day, sunset: Render3D.bench ? Render3D.bench.sunset() : e.sunset }; };
    for (let i = 0; i < 200; i++) at(0);
    let noon = null, dusk = null;
    for (let t = 0; t < 280000 && !(noon && dusk); t += 500) { const q = at(t); if (!noon && q.elev <= Math.SQRT1_2 && q.day > 0.95) noon = q; if (noon && !dusk && q.sunset >= 0.7) dusk = q; }
    // the sea: the nearest point to the runway with no land within 3 km round it, nor for 20 km ahead, the nose towards
    // the Sun at noon (the yaw found once: the Sun's bearing hardly moves over the distances searched)
    const wet = (e, z) => Terrain.heightAt(EARTH, siteAngle(EARTH, e), z) < -2;
    const yawAt = (e, z) => {
      let best = null;
      for (let i = 0; i < 64; i++) {
        const yaw = +(i * Math.PI / 32).toFixed(4), tp2 = TEMPLATES.falcon;
        Flight.start({ name: tp2.name, kind: tp2.kind, parts: templateRows(tp2) }, { place: { e, z, yaw, air: { alt: 120, speed: 170 } } }); Flight.paused = true; Flight.time = noon.t;
        const v = Flight.active, E = window.__env(), f = v.axis(0, 1, 0), d = f.x * E.sx + f.y * E.sy, Fr = surfaceFrame(v.x, v.y, v.z);
        const de = f.x * Fr.east.x + f.y * Fr.east.y + f.z * Fr.east.z, dz = f.x * Fr.north.x + f.y * Fr.north.y + f.z * Fr.north.z, n = Math.hypot(de, dz) || 1;
        if (!best || d > best.d) best = { yaw, d, de: de / n, dz: dz / n };
      }
      return best;
    };
    let sea = null;
    const Y = yawAt(-4000, 0);
    for (let r = 4000; r <= 80000 && !sea; r += 1000) for (let i = 0; i < 48 && !sea; i++) {
      const e = Math.round(1700 + r * Math.cos((i * Math.PI) / 24)), z = Math.round(r * Math.sin((i * Math.PI) / 24));
      let ok = true;
      for (let de = -3000; de <= 3000 && ok; de += 500) for (let dz = -3000; dz <= 3000 && ok; dz += 500) ok = wet(e + de, z + dz);
      for (let s = 0; s <= 20000 && ok; s += 500) ok = wet(e + Y.de * s, z + Y.dz * s);
      if (ok) sea = { e, z };
    }
    const best = yawAt(sea.e, sea.z);
    // the land: green lowland in Scotland (south of the island: +z), 10 km or more from Highland Ridge: dry, open ground
    // 5-200 m up 1.5 km round it and 8 km ahead (the first of yaw 0.6 and every 45° from it that has it); row by row
    const tp3 = TEMPLATES.falcon, heads = [];
    for (let k = 0; k < 8; k++) { // (the headings of yaw 0.6 and every 45° from it)
      const yaw = +(0.6 + (k * Math.PI) / 4).toFixed(4);
      Flight.start({ name: tp3.name, kind: tp3.kind, parts: templateRows(tp3) }, { place: { e: 0, z: 0, yaw, air: { alt: 250, speed: 180 } } }); Flight.paused = true;
      const v3_ = Flight.active, f3 = v3_.axis(0, 1, 0), Fr3 = surfaceFrame(v3_.x, v3_.y, v3_.z);
      heads.push({ yaw, de: f3.x * Fr3.east.x + f3.y * Fr3.east.y + f3.z * Fr3.east.z, dz: f3.x * Fr3.north.x + f3.y * Fr3.north.y + f3.z * Fr3.north.z });
    }
    const dry = (e, z) => { const a = siteAngle(EARTH, e), h = Terrain.heightAt(EARTH, a, z); return h > 5 && h < 200 && !Terrain.waterAt(EARTH, a, z) && Terrain.urbanAt(a, z) < 0.15; };
    let land = null;
    for (let z = 8000; z <= 60000 && !land; z += 2000) for (let e = 0; e <= 60000 && !land; e += 2000) {
      if (Math.hypot(e - 18190, z - 15040) < 10000) continue;
      let ok = true;
      for (let de = -1500; de <= 1500 && ok; de += 500) for (let dz = -1500; dz <= 1500 && ok; dz += 500) ok = dry(e + de, z + dz);
      const hd = ok && heads.find((q) => { for (let s = 0; s <= 8000; s += 500) if (!dry(e + q.de * s, z + q.dz * s)) return false; return true; });
      if (hd) land = { e, z, yaw: hd.yaw, h: Math.round(Terrain.heightAt(EARTH, siteAngle(EARTH, e), z)) };
    }
    // the town: the most built-up 1 km cell within 40 km
    let town = null;
    for (let e = -40000; e <= 40000; e += 1000) for (let z = -40000; z <= 40000; z += 1000) { const u = Terrain.urbanAt(siteAngle(EARTH, e), z); if (!town || u > town.u) town = { e, z, u }; }
    return { noon, dusk, sea: { ...sea, yaw: best.yaw, sunAhead: best.d }, town, land };
  });
  console.log(JSON.stringify(r, null, 1));
  console.log(`const T_NOON = ${r.noon.t}, T_DUSK = ${r.dusk.t};`);
  console.log(`const SEA = { e: ${r.sea.e}, z: ${r.sea.z}, yaw: ${r.sea.yaw}, air: { alt: 120, speed: 170 } };`);
  console.log(`const TOWN = { e: ${r.town.e}, z: ${r.town.z}, yaw: 0.4 };`);
  console.log(`const LAND = { e: ${r.land.e}, z: ${r.land.z}, yaw: ${r.land.yaw} };`);
  if (errs.length) console.log(errs.join('\n'));
  await T.ctx.close();
}

// ---------------------------------------------------------------------------------------------------------- main
const browser = await launch(), srvB = await serve(B_DIR), srvA = A_DIR ? await serve(A_DIR) : null;
if (flag('find-times')) { await findTimes(browser, srvB.url); await browser.close(); srvB.close(); if (srvA) srvA.close(); process.exit(0); }
const med = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const r2 = (x) => (x == null || Number.isNaN(x) ? x : +x.toFixed(2));
const results = [], errs = [], t00 = Date.now();
// (a first visit to each tree, thrown away: the browser's caches warm, so the first scene measured is like the rest)
await Promise.all([...(A_DIR ? [[A_DIR, srvA.url]] : []), [B_DIR, srvB.url]].map(async ([dir, url]) => { const t = await openTree(browser, dir, url, PROF[0], QUAL[0], 'first visit', []); await t.ctx.close(); }));
console.log(`render-bench: A ${A_DIR ? A_DIR + ' (' + commit(A_DIR) + ')' : '(none)'}, B ${B_DIR} (${commit(B_DIR)}); ${PROF.join(',')} × ${QUAL.join(',')} × ${LIST.join(',')}; ${ROUNDS} rounds of ${FRAMES} frames`);
for (const prof of PROF) for (const q of QUAL) for (const name of LIST) {
  const t0 = Date.now(), S = SCENES[name], trees = [];
  if (A_DIR) trees.push(['A', A_DIR, srvA.url]);
  trees.push(['B', B_DIR, srvB.url]);
  const T = await Promise.all(trees.map(([tag, dir, url]) => openTree(browser, dir, url, prof, q, `${prof}/${q}/${name}/${tag}`, errs)));
  const st = await Promise.all(T.map((t) => startScene(t, name)));
  if (st.some((s) => s.skip)) { console.log(`${name} ${prof} ${q}: skipped (${st.find((s) => s.skip).skip})`); for (const t of T) await t.ctx.close(); continue; }
  for (const t of T) await t.ev(LOAD);
  const pre = [];
  if (S.pre) for (const t of T) pre.push(await t.ev((k) => window.__load(k), S.pre)); // (what stands before the warm-up)
  // warm up, side by side (each tree says when it has built everything)
  const W = await Promise.all(T.map((t) => warm(t, name, 300)));
  // what stood before the warm-up has stood 6 s on the page's clock (a wreck is baked then: one a frame, so a few frames)
  if (S.pre) await Promise.all(T.map((t) => t.ev(async () => { const t0 = performance.now(); Render3D.skipDraw = true; while (performance.now() - t0 < 6500) { window.__frame(1 / 60, 1); await new Promise((r) => setTimeout(r, 50)); } for (let i = 0; i < 12; i++) window.__frame(1 / 60, 1); Render3D.skipDraw = false; })));
  const C = await Promise.all(T.map((t) => cond(t, name)));
  for (const [i, c] of C.entries()) if (!c.ok) { console.error(`render-bench: ${name} ${prof} ${q} ${trees[i][0]}: the scene isn't what it stands for: ${JSON.stringify(c)}`); process.exitCode = 1; }
  if (C.length === 2 && JSON.stringify(C[0].cam) !== JSON.stringify(C[1].cam)) console.log(`render-bench: ${name} ${prof} ${q}: the camera differs between A and B ${JSON.stringify([C[0].cam, C[1].cam])}`);
  // the same clock on both trees from here on, then the effects, three frames that compile, the timed rounds
  const loads = [];
  for (const t of T) {
    await t.ev(() => { window.__rb.clock(1e5); window.__rb.resort(); }); // (past any clock a warm-up reached: the clouds sorted again now)
    loads.push(S.load ? await t.ev((k) => window.__load(k), S.load) : S.pre ? pre[T.indexOf(t)] : null);
    if (S.sim) await t.ev(() => { window.__sim = true; });
    await timed(t, 3, false);
  }
  // the trees take turns, a round of FRAMES frames each, so the machine's load drifting (other jobs) hits both alike;
  // B/A is the median of the rounds' own ratios. The CPU's share: rounds of CPU_FRAMES frames with nothing drawn,
  // under the slowdown, each round's mean (performance.now() counts in 0.1 ms steps), B − A the median of the rounds'
  const gpu = T.map(() => []), gpuR = T.map(() => []), cpuR = T.map(() => []), thr = PROFILES[prof].throttle;
  for (let r = 0; r < ROUNDS; r++) for (const [i, t] of T.entries()) { const ts = await timed(t, FRAMES, false); gpu[i].push(...ts); gpuR[i].push(med(ts)); }
  if (!S.hangar) { // (the hangar draws whatever skipDraw says)
    if (thr > 1) for (const t of T) await t.cdp.send('Emulation.setCPUThrottlingRate', { rate: thr });
    for (let r = 0; r < ROUNDS; r++) for (const [i, t] of T.entries()) { const ts = await timed(t, CPU_FRAMES, true); cpuR[i].push(ts.reduce((a, x) => a + x, 0) / ts.length); }
    if (thr > 1) for (const t of T) await t.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  const want = !!(SHOTS || A_DIR);
  const snap = [];
  for (const t of T) snap.push(await snapshot(t, want));
  let cpuProf = null;
  if (flag('cpuprofile') && name === 'battle') {
    cpuProf = [];
    for (const t of T) { const thr = PROFILES[prof].throttle; if (thr > 1) await t.cdp.send('Emulation.setCPUThrottlingRate', { rate: thr }); cpuProf.push(await profile(t, 30)); if (thr > 1) await t.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }); }
  }
  const bufs = snap.map((s) => (s.b64 ? Buffer.from(s.b64, 'base64') : null));
  if (SHOTS) for (const [i, s] of snap.entries()) fs.writeFileSync(path.join(SHOTS, `${name}-${prof}-${q}-${trees[i][0]}.png`), png(s.w, s.h, bufs[i]));
  const row = { scene: name, profile: prof, quality: q, secs: Math.round((Date.now() - t0) / 1000) };
  for (const [i, [tag]] of trees.entries()) {
    const { b64, ...s } = snap[i]; void b64;
    row[tag] = { gpuMs: r2(med(gpu[i])), gpuAll: gpu[i].map(r2), cpuMs: +med(cpuR[i]).toFixed(3), cpuRounds: cpuR[i].map((x) => +x.toFixed(3)), warm: W[i], cond: C[i], load: loads[i], ...s, ...(cpuProf ? { profile: cpuProf[i] } : {}),
      ...(S.sim ? { after: await T[i].ev(() => ({ t: +Flight.time.toFixed(2), vessels: Flight.vessels.filter((o) => !o.dead).length, fx: FX.list.length, baked: Flight.vessels.filter((o) => o.wreck && Render3D.meshOf && Render3D.meshOf(o) && Render3D.meshOf(o).baked).length, pyres: typeof Death !== 'undefined' && Death.S ? Death.S.pyres.length : 0 })) } : {}) };
  }
  if (A_DIR) {
    row.ratio = +med(gpuR[1].map((b, r) => b / gpuR[0][r])).toFixed(3);
    row.cpuDelta = +med(cpuR[1].map((b, r) => b - cpuR[0][r])).toFixed(3);
    // (near: at most 0.01% of the pixels differ. The game itself doesn't draw a flight scene the same to the pixel on
    // every load: a few far pixels where surfaces tie in depth go to whichever is drawn last, and that order follows
    // the order things were made in, which time-sliced building varies; 68ea3fe against itself shows the same 13 pixels
    // at the runway's far end now and then. The hangar has no such ties: it must be the same to the byte)
    const share = diffShare(bufs[0], bufs[1]);
    row.pixels = { same: row.A.hash === row.B.hash, near: share <= 1e-4, share: +share.toFixed(5), n: Math.round(share * snap[0].w * snap[0].h) };
  }
  results.push(row);
  const P = (s, k, f) => ((s.passes[k] || {})[f] || 0);
  const line = (tag) => { const s = row[tag]; return `${tag} gpu ${s.gpuMs} ms, cpu ${s.cpuMs} ms, canvas ${P(s, 'canvas', 'draws')}/${P(s, 'canvas', 'verts')}, shadow ${P(s, 'shadow', 'draws')}/${P(s, 'shadow', 'verts')}, prog ${s.programs ?? s.glPrograms}, fx ${s.fx}, fill ${s.fill}`; };
  console.log(`${name.padEnd(9)} ${prof.padEnd(7)} ${q.padEnd(4)} ${row.secs}s  ${A_DIR ? line('A') + ' | ' : ''}${line('B')}${A_DIR ? `  B/A ${row.ratio}, cpu ${row.cpuDelta >= 0 ? '+' : ''}${row.cpuDelta} ms, pixels ${row.pixels.same ? 'identical' : `${row.pixels.n} (${(row.pixels.share * 100).toFixed(3)}%) differ`}` : ''}`);
  for (const t of T) await t.ctx.close();
}

// the table: per scene, profile and quality, A and B side by side (B/A for the GPU's time, B − A for the rest)
if (A_DIR && results.length) {
  const pv = (s, k, f) => ((s.passes[k] || {})[f] || 0), pad = (x, n) => String(x).padStart(n);
  console.log('\nscene     profile q     gpu ms A    B   B/A │ cpu ms A    B   B−A │ canvas draws │ shadow vertices │ programs │ fill A   B │ pixels');
  for (const r of results) {
    const d = (a, b) => (b - a >= 0 ? '+' : '') + r2(b - a);
    console.log(`${r.scene.padEnd(9)} ${r.profile.padEnd(7)} ${r.quality.padEnd(4)} ${pad(r.A.gpuMs, 8)} ${pad(r.B.gpuMs, 7)} ${pad(r.ratio, 5)} │ ${pad(r.A.cpuMs, 6)} ${pad(r.B.cpuMs, 5)} ${pad(d(r.A.cpuMs, r.B.cpuMs), 5)} │ ` +
      `${pad(pv(r.A, 'canvas', 'draws'), 5)} ${pad(d(pv(r.A, 'canvas', 'draws'), pv(r.B, 'canvas', 'draws')), 4)} │ ${pad(pv(r.A, 'shadow', 'verts'), 8)} ${pad(d(pv(r.A, 'shadow', 'verts'), pv(r.B, 'shadow', 'verts')), 6)} │ ` +
      `${pad(r.A.glPrograms, 3)} ${pad(d(r.A.glPrograms, r.B.glPrograms), 3)} │ ${pad(r.A.fill, 5)} ${pad(r.B.fill, 5)} │ ${r.pixels.same ? 'same' : `${r.pixels.near ? '≈ ' : ''}${r.pixels.n} px`}`);
  }
}

// ---------------------------------------------------------------------------------------------------------- budgets
// spec-graphics §3.4; a tree pair without A has nothing to check
const checks = [];
const budget = (what, ok, got) => { checks.push({ what, ok, got }); if (!ok) console.log('BUDGET ' + what + '   ' + JSON.stringify(got)); };
if (A_DIR && (flag('check') || flag('same'))) {
  const get = (scene, prof, q) => results.find((r) => r.scene === scene && r.profile === prof && r.quality === q);
  const pv = (s, k, f) => ((s.passes[k] || {})[f] || 0);
  const geo = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);
  for (const r of results) {
    const id = `${r.scene} ${r.profile} ${r.quality}`, ph = r.profile === 'phone', hi = r.quality === 'high';
    if (flag('same')) budget(`${id}: pixels identical${r.scene === 'hangar' ? '' : ' (to within 0.01%: a few far depth ties, as the base against itself)'}`, r.pixels.same || (r.scene !== 'hangar' && r.pixels.near), r.pixels);
    if (!flag('check')) continue;
    if (r.scene === 'hangar') { budget(`${id}: hangar pixels identical`, r.pixels.same, r.pixels); continue; }
    if (SIM.includes(r.scene)) continue; // (reported, not judged: each tree plays its own rules)
    const lim = QUIET.includes(r.scene) ? (ph ? 1.05 : 1.08) : r.scene === 'town' ? (ph && !hi ? 1.05 : 1.0) : BUSY.includes(r.scene) ? (ph ? (hi ? 1.2 : 1.12) : 1.25) : null;
    if (lim) budget(`${id}: gpuMs B/A ≤ ${lim}`, r.ratio <= lim, r.ratio);
    if (ph) { const c = BUSY.includes(r.scene) ? (hi ? 1.0 : 0.8) : 0.3; budget(`${id}: cpuMs B−A ≤ +${c} ms`, r.cpuDelta <= c, r.cpuDelta); }
    const pxB = (r.B.proxies || []).reduce((a, x) => a + x, 0), pxA = (r.A.proxies || []).reduce((a, x) => a + x, 0);
    if (hi && r.scene === 'town' && pxB > 0 && !pxA) budget(`${id}: shadow-pass vertices ≤ 0.25×`, pv(r.B, 'shadow', 'verts') <= 0.25 * pv(r.A, 'shadow', 'verts'), [pv(r.A, 'shadow', 'verts'), pv(r.B, 'shadow', 'verts')]);
    else budget(`${id}: shadow-pass vertices ≤ A`, pv(r.B, 'shadow', 'verts') <= pv(r.A, 'shadow', 'verts'), [pv(r.A, 'shadow', 'verts'), pv(r.B, 'shadow', 'verts')]);
    budget(`${id}: shadow-pass draws ≤ A`, pv(r.B, 'shadow', 'draws') <= pv(r.A, 'shadow', 'draws'), [pv(r.A, 'shadow', 'draws'), pv(r.B, 'shadow', 'draws')]);
    budget(`${id}: canvas draws ≤ A + 2`, pv(r.B, 'canvas', 'draws') <= pv(r.A, 'canvas', 'draws') + 2, [pv(r.A, 'canvas', 'draws'), pv(r.B, 'canvas', 'draws')]);
    budget(`${id}: programs ≤ A + 6`, r.B.glPrograms <= r.A.glPrograms + 6, [r.A.glPrograms, r.B.glPrograms]);
    budget(`${id}: textures and geometries +0`, r.B.textures <= r.A.textures && r.B.geometries <= r.A.geometries, [r.A.textures, r.B.textures, r.A.geometries, r.B.geometries]);
    if (r.scene === 'battle') budget(`${id}: particle fill ≤ A and ≤ ${hi ? 6 : 3} screens`, r.B.fill <= Math.max(r.A.fill, 0) + 1e-9 && r.B.fill <= (hi ? 6 : 3), [r.A.fill, r.B.fill]);
    if (r.B.profile && r.A.profile) {
      const up = r.B.profile.updateParticles || 0, ua = r.A.profile.updateParticles || 0;
      budget(`${id}: updateParticles self ≤ 1.3× A (+0.3 ms: the sampling profiler's noise)`, up <= 1.3 * ua + 0.3, [ua, up]);
      budget(`${id}: shadowProxies + syncDecals ≤ 0.3 ms a frame`, (r.B.profile.shadowProxies || 0) + (r.B.profile.syncDecals || 0) <= 0.3, r.B.profile);
    }
  }
  if (flag('check')) for (const prof of PROF) for (const q of QUAL) {
    const qs = QUIET.map((s) => get(s, prof, q)).filter(Boolean);
    if (qs.length < 2 || prof !== 'phone') continue;
    const g = geo(qs.map((r) => r.ratio)), lim = q === 'high' ? 1.02 : 1.03;
    budget(`quiet scenes ${prof} ${q}: gpuMs geometric mean ≤ ${lim}`, g <= lim, +g.toFixed(3));
  }
}
const bad = checks.filter((c) => !c.ok).length;
console.log(`\n${results.length} scene runs in ${Math.round((Date.now() - t00) / 60000)} min` + (checks.length ? `; budgets: ${checks.length - bad} of ${checks.length} met` : ''));
if (errs.length) { console.log('console errors:\n' + errs.slice(0, 20).join('\n')); process.exitCode = 1; }
if (bad) process.exitCode = 1;
if (SAVE) {
  fs.mkdirSync(path.dirname(path.resolve(SAVE)), { recursive: true });
  fs.writeFileSync(SAVE, JSON.stringify({ date: new Date().toISOString(), trees: { A: A_DIR ? { dir: A_DIR, commit: commit(A_DIR) } : null, B: { dir: B_DIR, commit: commit(B_DIR) } },
    args: { profiles: PROF, quality: QUAL, scenes: LIST, frames: FRAMES, rounds: ROUNDS }, consts: { T_NOON, T_DUSK, SEA, TOWN, HL }, results, checks }, null, 1));
  console.log('saved ' + SAVE);
}
await browser.close(); srvB.close(); if (srvA) srvA.close();
