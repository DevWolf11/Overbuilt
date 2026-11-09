// The big update's damage model in the real page (spec-damage §10.5), on a desktop (1280×720, High) and a phone in
// portrait (390×844, Low), the time read off Flight.time (the sim runs slowly under software WebGL), the console clean:
//  1. the Tank Range (Highland Ridge, targets on Practice): a computer TK-34 parked 35 m ahead of ours (7 m right), knocked out by an ammunition detonation (Armour.knockOut with a
//     store): one 'ammo' death, screenshots at 0, 0.3, 1 and 3 s; the particles never past FX.max(); it stays as a wreck
//     (GroundAI's list) with its turret thrown; six seconds (wall clock) after it is first drawn as one it is one mesh,
//     matt (env ≤ 0.2); at 60 s it only smokes (its column, no flame), screenshot.
//  4. an old car (the Dune Buggy) knocked out by a shot through its cab: every part aboard, its driver out (ko 'crew'),
//     one small 'ko' death, a wreck within 6 s, burning (flames from it), charred (its plain colours 0.35 of its paint,
//     hardly shiny), baked like any wreck.
//  5. the TK-34's wreck at the end of its five minutes (the clock moved on 294 s): sinking (screenshots at 0, 3 and
//     6 s), lower each time, gone at 6 s with its thrown turret.
//  2. Hostile: a bandit 400 m ahead with an engine on fire (a black trail, screenshot), then its cockpit shot: shot down
//     (the kill's SHOT DOWN banner, which outranks PILOT KO), the banner drawn inside the HUD's canvas and clear of the
//     top panels, a screenshot of its fall; within 60 s of the kill the bandit and every piece of it are gone.
//  3. our plane's pilot knocked out 1 km up: the strip ("Pilot knocked out · tap/Esc for options", #flight-alert.lost)
//     shows over the fall and clears every control and panel on the 8 screens of controls.mjs; untouched, the end screen
//     opens 1.2 s (± 0.3) after the crash (300 m up, in a dive), or 10 s after the death if the hulk still glides then
//     (1 km up); a tap (a click) on the strip opens it at once.
// The 8 baked wrecks' draw calls (spec item 6) are ground-models.mjs's (§5b: eight baked wrecks cost at most 8 draws).
// SHOTS=<dir> saves screenshots there (deaths-*.png; else test/.cache/shots/); ONLY=1,3 runs those sections alone.
//   node test/browser/deaths.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || path.join(ROOT, 'test', '.cache', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null, part = (n) => !ONLY || ONLY.includes(n);
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('deaths: wrecks, falls, crashes, banners and the strip in the page');
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);

// in the page, once the game is up: exceptions App.frame would swallow, the death effects and fire and smoke made (where,
// what), the particles' most after any update, the banners drawn on the HUD's canvas, the end screens opened (sim time)
const instrument = () => {
  window.__errs = [];
  for (const [o, k, n] of [[Flight, 'update', 'Flight.update'], [Render3D, 'renderFlight', 'Render3D.renderFlight'], [Combat, 'frame', 'Combat.frame'], [Combat, 'drawHUD', 'Combat.drawHUD']]) {
    const f = o[k]; o[k] = function (...a) { try { return f.apply(this, a); } catch (e) { window.__errs.push(`${n}: ${e && e.stack}`); throw e; } };
  }
  const W = (window.__fx = { death: [], flame: [], smoke: [], max: 0 });
  for (const k of ['death', 'flame', 'smoke']) {
    const f = FX[k];
    FX[k] = function (b, at, vel, a3, a4) { W[k].push({ t: Flight.time, x: at.x, y: at.y, z: at.z, kind: k === 'death' ? a4 : k === 'smoke' ? a3 : null }); if (W[k].length > 4000) W[k].splice(0, 2000); return f.apply(this, arguments); };
  }
  const up = FX.update;
  FX.update = function (...a) { const r = up.apply(this, a); if (FX.list.length > W.max) W.max = FX.list.length; return r; };
  window.__ban = [];
  const ft = CanvasRenderingContext2D.prototype.fillText, FB = ['HIT', 'ENGINE OUT', 'ON FIRE', 'WING OFF', 'TAIL OFF', 'FIN OFF', 'ROTOR OFF', 'ENGINE OFF', 'PILOT KO', 'SHOT DOWN', 'KNOCKED OUT'];
  CanvasRenderingContext2D.prototype.fillText = function (s, x, y) {
    if (this.canvas === App.canvas && FB.includes(s)) {
      const w = this.measureText(s).width, f = parseFloat((this.font.match(/(\d+(?:\.\d+)?)px/) || [0, 15])[1]), m = this.getTransform(), d = m.a || 1;
      window.__ban.push({ s, t: Flight.time, l: x - w / 2, r: x + w / 2, top: y - f, bot: y + 4, W: this.canvas.width / d, H: this.canvas.height / d });
      if (window.__ban.length > 200) window.__ban.splice(0, 100);
    }
    return ft.apply(this, arguments);
  };
  window.__modal = [];
  const md = UI.modal;
  UI.modal = function (o) { window.__modal.push({ t: Flight.time, title: o && o.title, kicker: o && o.kicker }); return md.apply(this, arguments); };
  // sim time from now: dt seconds of it
  window.__until = (dt, cap = 600000) => new Promise((ok) => { const t0 = Flight.time, w0 = performance.now(); const f = () => (Flight.time >= t0 + dt || performance.now() - w0 > cap ? ok(Flight.time) : requestAnimationFrame(f)); f(); });
  // the craft's ground axes (forward, right, up) and a vessel built from a template, a m ahead, s m right, u m up
  window.__ax = () => { const v = Flight.active, r0 = Math.hypot(v.x, v.y, v.z), U = { x: v.x / r0, y: v.y / r0, z: v.z / r0 }, P = v.pilot.F, f = v.axis(P.x, P.y, P.z), k0 = f.x * U.x + f.y * U.y + f.z * U.z;
    const F = { x: f.x - U.x * k0, y: f.y - U.y * k0, z: f.z - U.z * k0 }, fl = Math.hypot(F.x, F.y, F.z); F.x /= fl; F.y /= fl; F.z /= fl;
    return { F, U, R: { x: F.y * U.z - F.z * U.y, y: F.z * U.x - F.x * U.z, z: F.x * U.y - F.y * U.x } }; };
  window.__make = (key, a, s, u) => {
    const A = Flight.active, X = window.__ax(), t = TEMPLATES[key], ps = partsFromDesign(templateRows(t)), all = buildAdjacency(ps), c = findControlPart(ps), keep = componentOf(c.id, all), kp = ps.filter((p) => keep.has(p.id)), adj = new Map();
    for (const p of kp) adj.set(p.id, new Set([...all.get(p.id)].filter((id) => keep.has(id))));
    const v = new Vessel(kp, adj, EARTH); v.name = t.name; v.kind = t.kind; v.stages = computeStages(kp, adj, c.id); v.rebuildGroups();
    v.q = { ...A.q }; v.x = A.x + X.F.x * a + X.R.x * s + X.U.x * u; v.y = A.y + X.F.y * a + X.R.y * s + X.U.y * u; v.z = A.z + X.F.z * a + X.R.z * s + X.U.z * u;
    v.vx = v.vy = v.vz = 0; Flight.vessels.push(v); return v;
  };
  // effects made within r m of a vessel since t0
  window.__near = (k, o, t0, r = 12) => { const c = o.toWorld(o.com.x, o.com.y, o.com.z || 0); return window.__fx[k].filter((q) => q.t >= t0 && Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z) < r); };
  // a wreck's own flames since t0: at its burn point (death.js), to a few cm
  window.__burns = (o, t0) => { const c = Death._g.burnPoint(o); return c ? window.__fx.flame.filter((q) => q.t >= t0 && Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z) < 0.05) : []; };
  // a template in flight: a plane in the air at alt and speed, else at its kind's site
  window.__fly = async (key, alt, speed) => {
    await Render3D.load();
    const t = TEMPLATES[key];
    store.set('rss.flight', null); App.showScene('flight');
    Flight.start({ name: t.name, kind: t.kind, parts: templateRows(t) }, { place: alt ? { e: 6000, z: 0, yaw: 0, air: { alt, speed } } : GroundMode.placement('highland', 0, 0, 'tank') });
    window.__modal.length = 0; window.__ban.length = 0;
  };
  // what is drawn of a vessel's model: meshes on show (a baked wreck: its one mesh), and whether it is baked
  window.__model = (v) => { const vm = Render3D.meshOf(v); if (!vm) return null; let n = 0; vm.group.traverseVisible((o) => { if (o.isMesh) n++; }); return { meshes: n, baked: !!vm.baked, env: vm.baked ? vm.baked.material.envMapIntensity : null }; };
};
async function open(vp, settings, tag) {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: vp[2], isMobile: vp[2] }), page = await ctx.newPage();
  watch(page, errs, tag + ' ');
  await openGame(page, srv.url, { planeStart: 'hold', fps: 0, ...settings });
  await page.waitForFunction(() => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state !== 'loading', null, { timeout: 180000 });
  await page.evaluate(instrument);
  const ev = (f, a) => page.evaluate(f, a);
  const until = (dt) => ev((dt) => window.__until(dt), dt);
  const shot = async (name) => { await page.screenshot({ path: path.join(SHOTS, `deaths-${name}-${vp[0]}x${vp[1]}.png`), timeout: 180000 }); };
  return { ctx, page, ev, until, shot, tag };
}
const pageErrs = async (P) => { const e = await P.ev(() => window.__errs.slice(0, 5)); for (const x of e) errs.push(P.tag + ' ' + x); };

// ---------------------------------------------------------------------------------------------- 1, 4, 5: on the ground
async function ground(P, hi) {
  const { ev, until, shot, tag } = P;
  await ev(() => { Settings.set('targets', 'practice'); return window.__fly('tk34'); });
  await P.page.waitForFunction(() => Render3D.ready && Flight.running && Flight.active && Flight.active.kind === 'tank' && Flight.time > 1 && GroundAI.range, null, { timeout: 180000 });
  // the computer's TK-34 parked 35 m ahead and 7 m right (GroundAI's: its wreck goes in the list that ages and sinks wrecks), a Dune
  // Buggy 22 m ahead, 8 m to the left
  const setup = await ev(() => {
    const A = Flight.active, X = window.__ax(), q = mpEZ(A.x, A.y, A.z, {}), P0 = { x: A.x + X.F.x * 35 + X.R.x * 7, y: A.y + X.F.y * 35 + X.R.y * 7, z: A.z + X.F.z * 35 + X.R.z * 7 }, q2 = mpEZ(P0.x, P0.y, P0.z, {});
    void q;
    const W = GroundAI.spawn(Flight, 'tk34', q2.e, q2.z, 0, 1, 'parked'), bug = window.__make('buggy', 22, -8, 1.2);
    A.ctl.v = 0; A.brake = true;
    window.__W = W; window.__bug = bug;
    return { W: !!W, kin: W && W.kin, ai: W && W.ai && W.ai.role, bug: bug.parts.length, d: W ? Math.hypot(W.x - A.x, W.y - A.y, W.z - A.z) : null };
  });
  log(tag, 'ground set up', JSON.stringify(setup));
  await until(1.5);
  // ---- 1. the ammunition detonation
  const k1 = await ev(() => {
    const W = window.__W; W.lastHitBy = Flight.active; W.lastHitAt = Flight.time;
    window.__fx.max = FX.list.length; window.__t1 = Flight.time;
    const n0 = window.__fx.death.length, st = Armour.crewOf(W).stores[0];
    Armour.knockOut(W, Flight, 'ammo', { st, rounds: 30 });
    const d = window.__fx.death.slice(n0);
    return { deaths: d.map((x) => x.kind), ko: W.ko && { why: W.ko.why, x: W.ko.x }, max: FX.max(), tossed: Flight.vessels.filter((o) => o.tossed && !o.dead).length };
  });
  log(tag, 'detonation', JSON.stringify(k1));
  ok(`${tag}: a TK-34's ammunition goes up: one 'ammo' death, knocked out (ammo, a detonation), its turret thrown`, k1.deaths.join() === 'ammo' && k1.ko && k1.ko.why === 'ammo' && k1.ko.x && k1.tossed >= 1, k1);
  await shot('ammo-0s');
  for (const [t, nm] of [[0.3, 'ammo-0.3s'], [1, 'ammo-1s'], [3, 'ammo-3s']]) { await ev((t) => window.__until(t - (Flight.time - window.__t1)), t); await shot(nm); }
  const k2 = await ev(() => { const W = window.__W; return { wreck: !!W.wreck, max: window.__fx.max, cap: FX.max(), fire: window.__burns(W, window.__t1 + 1).length, model: window.__model(W) }; });
  ok(`${tag}: the particles never pass the cap (${k2.max} at most, FX.max ${k2.cap}) and the hulk stays as a burning wreck`, k2.max <= k2.cap && k2.wreck && k2.fire > 0, k2);
  // ---- 4. the old car: its cab shot through
  const c1 = await ev(() => {
    const v = window.__bug, n = v.parts.length, cab = v.parts.find((p) => p.def.control), n0 = window.__fx.death.length, vm = Render3D.meshOf(v);
    window.__t4 = Flight.time;
    window.__col0 = new Map(); // (its plain materials' colours as built, before it is a wreck)
    if (vm) for (const r of vm.list) for (const m of r.matList) if (m.isMeshStandardMaterial && !m.map && !m.vertexColors) window.__col0.set(m, m.color.r + m.color.g + m.color.b);
    Combat.damage(v, cab, 1e6, 'shot', Flight, Flight.active);
    return { parts: [n, v.parts.length], ko: v.ko && v.ko.why, cab: !!cab.ko && v.parts.includes(cab), deaths: window.__fx.death.slice(n0).map((x) => x.kind) };
  });
  // a wreck (frozen) within 6 s; its model charred the frame it is drawn as one (before the bake makes it one mesh)
  const c2 = await ev(async () => {
    const v = window.__bug;
    while (!v.wreck && Flight.time - window.__t4 < 6.5) await window.__until(0.05);
    const at = Flight.time - window.__t4;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const vm = Render3D.meshOf(v), ms = vm && !vm.baked ? vm.list.flatMap((r) => r.matList.filter((m) => window.__col0.get(m) > 0.05)) : [];
    const k = ms.map((m) => (m.color.r + m.color.g + m.color.b) / window.__col0.get(m));
    return { wreck: !!v.wreck, at, char: ms.length ? [Math.min(...k), Math.max(...k)] : null, n: ms.length, env: ms.length ? Math.max(...ms.map((m) => m.envMapIntensity)) : null, baked: !!(vm && vm.baked) };
  });
  await ev((t) => window.__until(t - (Flight.time - window.__t4)), 6);
  const c3 = await ev(() => { const v = window.__bug; return { flames: window.__burns(v, window.__t4).length, smoke: window.__near('smoke', v, window.__t4, 6).length }; });
  log(tag, 'buggy', JSON.stringify(c1), JSON.stringify(c2), JSON.stringify(c3));
  ok(`${tag}: an old car shot through its cab: every part aboard, its driver out (crew), one small 'ko' death`, c1.parts[0] === c1.parts[1] && c1.ko === 'crew' && c1.cab && c1.deaths.join() === 'ko', c1);
  ok(`${tag}: ...a wreck within 6 s (${c2.at.toFixed(1)} s), burning (flames and smoke from it)`, c2.wreck && c2.at <= 6 && c3.flames > 5 && c3.smoke > 0, { c2, c3 });
  ok(`${tag}: ...charred: its plain colours a third of their paint (0.35 ± 0.01), hardly shiny (env ≤ 0.2)`, !c2.baked && c2.n > 0 && c2.char[0] > 0.34 && c2.char[1] < 0.36 && c2.env <= 0.2, c2);
  await shot('buggy-burning');
  // ---- 1. baked: six seconds (wall clock) after each was first drawn as a wreck, and a frame or two
  await P.page.waitForTimeout(7000); await until(0.2);
  const k3 = await ev(() => ({ tank: window.__model(window.__W), bug: window.__model(window.__bug) }));
  ok(`${tag}: six seconds after it stopped each wreck is one mesh (one draw), matt (env ≤ 0.2)`, [k3.tank, k3.bug].every((m) => m && m.baked && m.meshes === 1 && m.env <= 0.2), k3);
  // ---- 1. at 60 s: only the smoke column (no flame), and a screenshot
  await ev(() => { window.__W.ko.t = Flight.time - 58; window.__t60 = Flight.time + 1e-6; }); // (after this frame: the last frame's flames carry this time)
  await until(2);
  const k4 = await ev(() => { const W = window.__W; return { flames: window.__burns(W, window.__t60).length, cols: window.__near('smoke', W, window.__t60, 6).filter((q) => q.kind === 'column').length }; });
  ok(`${tag}: a minute on the wreck only smokes: its column, no flame`, k4.flames === 0 && k4.cols > 0, k4);
  await shot('ammo-60s');
  // ---- 5. its five minutes up: the clock on 294 s, so it sinks over the next 6 s and goes (its turret with it)
  const s0 = await ev(() => { const W = window.__W; window.__bits = Flight.vessels.filter((o) => o.tossed && !o.dead); Flight.time += 294.05 - (Flight.time - window.__t1); return { bits: window.__bits.length }; });
  const sink = [];
  for (const [t, nm] of [[0.15, 'sink-0s'], [3, 'sink-3s'], [5.8, 'sink-6s']]) {
    await until(t - (sink.length ? sink[sink.length - 1].at : 0));
    sink.push({ at: t, ...(await ev(() => { const W = window.__W, c = Render3D.meshOf(W); void c; return { sink: W.sink || 0, dead: !!W.dead, bits: window.__bits.map((q) => +(q.sink || 0).toFixed(2)) }; })) });
    await shot(nm);
  }
  await until(0.6);
  const s1 = await ev(() => ({ dead: !!window.__W.dead, bitsDead: window.__bits.every((q) => q.dead), inWorld: Flight.vessels.includes(window.__W) }));
  log(tag, 'sinking', JSON.stringify(sink), JSON.stringify(s1));
  ok(`${tag}: at the end of its five minutes the wreck sinks away over 6 s (deeper each time) with its turret, and is gone`, s0.bits >= 1 && sink[0].sink > 0 && sink[1].sink > sink[0].sink && sink[2].sink > sink[1].sink && sink.every((q) => q.bits.every((k) => k > 0)) && s1.dead && s1.bitsDead, { s0, sink, s1 });
  void hi;
}

// ---------------------------------------------------------------------------------------------- 2: a bandit shot down
async function bandit(P) {
  const { ev, until, shot, tag } = P;
  await ev(() => { Settings.set('targets', 'hostile'); return window.__fly('falcon', 1500, 200); });
  await P.page.waitForFunction(() => Render3D.ready && Flight.running && Flight.active && Flight.time > 0.5, null, { timeout: 180000 });
  const a0 = await ev(() => {
    const v = Flight.active, X = window.__ax(), e = Combat.spawnFighter(Flight), d = 400;
    e.x = v.x + X.F.x * d + X.U.x * 15; e.y = v.y + X.F.y * d + X.U.y * 15; e.z = v.z + X.F.z * d + X.U.z * 15; e.q = { ...v.q }; e.vx = v.vx; e.vy = v.vy; e.vz = v.vz; e.ai.hold = true;
    const eng = e.parts.find((p) => p.def.thrust);
    e.lastHitBy = v; e.lastHitAt = Flight.time;
    const lit = Death.ignite(e, eng, 1, v, Flight);
    window.__E = e; window.__n0 = Flight.vessels.length; window.__ta = Flight.time;
    return { lit, burn: eng.burn };
  });
  await until(2.5);
  const a1 = await ev(() => ({ trail: window.__fx.smoke.filter((q) => q.t >= window.__ta && q.kind === 'black').length, alive: !window.__E.dead }));
  ok(`${tag}: a bandit's engine on fire trails black smoke`, a0.lit && a1.trail > 10 && a1.alive, { a0, a1 });
  await shot('bandit-fire');
  const a2 = await ev(() => {
    const e = window.__E, v = Flight.active; e.lastHitAt = Flight.time; window.__ban.length = 0; window.__tk = Flight.time;
    const kills = Combat.S.kills;
    Combat.damage(e, e.control, 1e6, 'shot', Flight, v);
    return { down: !!e.down, ai: !!e.ai.down, kills: Combat.S.kills - kills, fb: Death.fb.text, parts: e.parts.length, ko: !!e.parts.find((p) => p.def.control && p.ko) };
  });
  await until(0.5);
  const a3 = await ev(() => {
    const rect = (q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
    return { ban: window.__ban.filter((x) => x.s === 'SHOT DOWN' || x.s === 'PILOT KO'), top: ['#flight-ui .telemetry', '#flight-ui .flight-top-right'].map(rect).filter(Boolean), W: innerWidth, H: innerHeight };
  });
  const B = a3.ban[a3.ban.length - 1], clear = B && a3.top.every((r) => B.r < r.l || B.l > r.r || B.bot < r.t || B.top > r.b);
  log(tag, 'bandit down', JSON.stringify(a2), 'banner', JSON.stringify(B), 'top', JSON.stringify(a3.top));
  ok(`${tag}: its cockpit shot: the pilot out, shot down (the kill counted), every part still aboard`, a2.down && a2.ai && a2.kills === 1 && a2.ko && a2.parts > 3, a2);
  ok(`${tag}: ...the SHOT DOWN banner (the kill's, over PILOT KO) is drawn inside the canvas and clear of the top panels`, !!B && B.s === 'SHOT DOWN' && B.l >= 0 && B.r <= B.W && B.top >= 0 && B.bot <= B.H && clear, { B, top: a3.top });
  await shot('bandit-fall');
  // gone within 60 s of the kill: the bandit and every piece of it (new bandits aside)
  await ev(() => { Render3D.skipDraw = true; });
  const a4 = await ev(async () => {
    const e = window.__E, t0 = window.__tk, mine = () => [e, ...Flight.vessels.slice(window.__n0).filter((o) => !o.ai)];
    let crashed = null;
    while (Flight.time - t0 < 62) {
      await window.__until(0.5);
      if (crashed == null && e.dead) crashed = Flight.time - t0;
      if (mine().every((o) => o.dead || !Flight.vessels.includes(o))) return { gone: Flight.time - t0, crashed };
    }
    return { gone: null, crashed, left: mine().filter((o) => !o.dead && Flight.vessels.includes(o)).map((o) => [o.name, o.hulk, o.junkAt, Math.round(o.groundAltitude())]) };
  });
  await ev(() => { Render3D.skipDraw = false; Settings.set('targets', 'off'); });
  log(tag, 'bandit gone', JSON.stringify(a4));
  ok(`${tag}: ...it falls and crashes, and within 60 s of the kill it and every piece of it are gone (${a4.gone && a4.gone.toFixed(1)} s)`, a4.gone != null && a4.gone <= 60 && a4.crashed != null, a4);
}

// ---------------------------------------------------------------------------------------------- 3: our pilot knocked out
const meets = (a, c) => !!a && !!c && a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
const layout = () => {
  const rect = (e) => { if (!e || e.hidden) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width && r.height && cs.display !== 'none' && cs.visibility !== 'hidden' ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const items = {};
  for (const k in Controls.CTL) { const r = rect(document.querySelector(Controls.CTL[k][0])); if (r) items[k] = r; }
  for (const q of ['#flight-ui .telemetry', '#flight-ui .flight-top-right', '#warp', '#hint', '#weapon-box', '#flight-ui .rot-controls', '#flight-ui .left-controls']) { const r = rect(document.querySelector(q)); if (r) items[q] = r; }
  const al = document.querySelector('#flight-alert');
  return { W: innerWidth, H: innerHeight, items, alert: rect(al), text: al.textContent, lost: al.classList.contains('lost') };
};
async function strip(P, sizes) {
  const { ev, page, tag } = P;
  // the strip over the fall, on each screen size (the fall held still meanwhile: paused, its strip kept)
  await ev(() => window.__fly('mustang', 1000, 130));
  await page.waitForFunction(() => Render3D.ready && Flight.running && Flight.active && Flight.time > 0.5, null, { timeout: 180000 });
  await ev(() => { const v = Flight.active; Combat.damage(v, v.control, 1e6, 'shot', Flight, null); });
  await P.until(0.3);
  await ev(() => { Flight.paused = true; });
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(() => { if (Controls.resize) Controls.resize(); });
    await page.waitForTimeout(700);
    await ev(() => { Flight.strip(true); Flight.updateHUD(true); });
    await page.waitForTimeout(150);
    const L = await ev(layout), cl = Object.entries(L.items).filter(([, r]) => meets(L.alert, r)).map(([n]) => n);
    const inside = L.alert && L.alert.l >= 0 && L.alert.t >= 0 && L.alert.r <= L.W && L.alert.b <= L.H;
    ok(`${tag} ${w}×${h}: the strip shows over the fall ("${L.text}"), on the screen and clear of every control and panel`, L.lost && !!L.alert && inside && !cl.length && /^Pilot knocked out · (tap|Esc) for options$/.test(L.text), { alert: L.alert, clashes: cl });
    if (w === sizes[0][0] && h === sizes[0][1]) await P.shot('strip');
  }
  await page.setViewportSize({ width: sizes[0][0], height: sizes[0][1] });
  await ev(() => { Flight.paused = false; });
}
async function endScreen(P) {
  const { ev, page, tag } = P;
  // untouched: the end screen 1.2 s after the crash (a pilot knocked out 300 m up in a dive), or 10 s after the death if
  // it is still gliding then (1 km up); the end screen's poll runs every 250 ms of the page's clock, so up to a quarter of
  // a second (of sim time, here about as fast) late
  const lone = async (alt, dive) => {
    await ev(([alt]) => window.__fly('mustang', alt, 130), [alt]);
    await page.waitForFunction(() => Render3D.ready && Flight.running && Flight.active && Flight.time > 0.5, null, { timeout: 180000 });
    await ev((dive) => { Render3D.skipDraw = true; const v = Flight.active, X = window.__ax(); Combat.damage(v, v.control, 1e6, 'shot', Flight, null); v.vx -= X.U.x * dive; v.vy -= X.U.y * dive; v.vz -= X.U.z * dive; }, dive);
    await page.waitForFunction(() => window.__modal.length > 0 || Flight.time > Flight.diedAt + 14, null, { timeout: 900000, polling: 100 });
    const e = await ev(() => ({ modal: window.__modal.slice(), diedAt: Flight.diedAt, crashedAt: Flight.crashedAt, dead: !!Flight.active.dead, alt: Math.round(Flight.active.groundAltitude()) }));
    await ev(() => { Render3D.skipDraw = false; UI.closeModal(); });
    log(tag, 'end screen', alt, JSON.stringify(e));
    return e;
  };
  const e1 = await lone(300, 60), m1 = e1.modal[0], d1 = m1 && e1.crashedAt != null ? m1.t - e1.crashedAt : null;
  ok(`${tag}: untouched, the end screen opens 1.2 s after the crash (${d1 != null ? d1.toFixed(2) : '?'} s; 1.2 ± 0.3, the poll's 0.25 s late at most), within 10 s of the death`, d1 != null && d1 >= 0.9 && d1 <= 1.75 && m1.t - e1.diedAt <= 10.3 && e1.modal.length === 1 && e1.dead, e1);
  const e2 = await lone(1000, 0), m2 = e2.modal[0];
  ok(`${tag}: ...and still gliding 10 s after the death (no crash yet), it opens then (${m2 ? (m2.t - e2.diedAt).toFixed(2) : '?'} s after)`, !!m2 && e2.crashedAt == null && m2.t - e2.diedAt >= 10 && m2.t - e2.diedAt <= 10.4 && e2.modal.length === 1, e2);
  // tapped: at once
  await ev(() => window.__fly('mustang', 1000, 130));
  await page.waitForFunction(() => Render3D.ready && Flight.running && Flight.active && Flight.time > 0.5, null, { timeout: 180000 });
  await ev(() => { const v = Flight.active; Combat.damage(v, v.control, 1e6, 'shot', Flight, null); });
  await P.until(0.4);
  const box = await ev(() => { const r = document.querySelector('#flight-alert').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: Flight.time, shown: !document.querySelector('#flight-alert').hidden }; });
  if (P.touch) await page.touchscreen.tap(box.x, box.y); else await page.mouse.click(box.x, box.y);
  await page.waitForFunction(() => window.__modal.length > 0, null, { timeout: 20000 }).catch(() => {});
  const e3 = await ev(() => ({ modal: window.__modal.slice(), t: Flight.time, crashed: Flight.crashedAt, open: !document.querySelector('#modal').hidden }));
  log(tag, 'tap', JSON.stringify(box), JSON.stringify(e3));
  ok(`${tag}: a ${P.touch ? 'tap' : 'click'} on the strip opens the end screen at once, before the crash`, box.shown && e3.modal.length === 1 && e3.open && e3.modal[0].t - box.t < 0.5 && e3.crashed == null, { box, e3 });
  await P.shot('end');
  await ev(() => UI.closeModal());
}

// ---------------------------------------------------------------------------------------------- the runs
const DESK = [[1280, 720], [1920, 1080]], PHONE = [[360, 640], [375, 667], [390, 844], [430, 932], [768, 1024], [844, 390]];
{
  const P = await open([1280, 720, false], { quality: 'high' }, '1280x720 High');
  if (part(1) || part(4) || part(5)) await ground(P, true);
  if (part(2)) await bandit(P);
  if (part(3)) { await strip(P, DESK); await endScreen(P); }
  await pageErrs(P);
  await P.ctx.close();
}
{
  const P = await open([390, 844, true], { quality: 'low' }, '390x844 Low');
  P.touch = true;
  if (part(1) || part(4) || part(5)) await ground(P, false);
  if (part(3)) { await strip(P, PHONE.slice(2, 3).concat(PHONE.filter((s) => s[0] !== 390))); await endScreen(P); }
  await pageErrs(P);
  await P.ctx.close();
}
ok('no page errors', errs.length === 0, errs.slice(0, 10).join('\n'));
log('done');
ok.done();
await b.close(); srv.close();
