// The near ground in the page (render3d's ground drawn round a craft on or near the ground from the physics' own
// lattice: handbook chapter 3 §1.6), on a desktop (1280 x 720, High) and a phone in portrait (390 x 844, Low):
//  - a TK-34 on the slope test path's hillside and at Bixter's outpost: the near ground goes up (faded in, one shader
//    program with the patch and the arena's ground), and the ground drawn there, found as the eye finds it (a ray straight
//    down through the ground meshes on show, each where its shader doesn't cut it away: Render3D.rayGround), is the
//    physics' (Terrain.heightAt) within 5 cm at worst within 64 m of the tank on High, 32 m on Low (its cells as fine as
//    that takes), and within 25 cm at the 95th percentile and 60 cm at worst out to 100 m (coarser cells past that),
//    where the patch alone (Render3D.nearOff) is 0.5-9 m off; Render3D.drawnGround reads what is drawn
//  - what it costs a GPU (Render3D.groundFill: the ground's pixels and the 2 x 2 pixel quads its triangles touch, all of
//    which a GPU shades), in the view behind the tank: the patch and the near ground together shade at most 10% more
//    than the patch alone (4-6% here; with 2 m and 4 m cells everywhere it was 16%, their slivers filling 80% of their
//    quads), the near ground's triangles filling at least 85% of the quads they touch
//  - driving 300 m (the tank moved along the ground frame by frame): the window follows a tile at a time (its cells
//    chosen again round the tank every 8 m), its share of a frame within its budget at the 99th percentile, and the ground
//    round the tank is still the physics'
//  - a Skylark landed on that hillside: the ground under its wheels is the physics' (its gear on the ground drawn)
//  - a Falcon 1 km up: no near ground built or shown, the patch whole (a plane at altitude pays nothing)
//  - at Watten, 1.4 km from Highland Ridge in ground play: the arena's ground and the near ground both on show, each with
//    its own cut, each the physics' ground; driven to the box's edge the near ground gives way to the arena's, the ground
//    drawn the physics' or the patch's all along (no gap, no step)
//  - no console errors. SHOTS=<dir>: the tank on the hillside and the landed Skylark, the near ground off and on
//   node test/browser/near-ground.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('near-ground: the ground drawn round a craft is the ground it stands on');
const mapIn = () => typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' && Render3D.ready;

// in the page: frames back to back (drawn or not) until cond holds and nothing is being built, then n more drawn
const SETTLE = async ([cond, drawn, max]) => {
  const C = new Function('return ' + cond);
  Render3D.skipDraw = !drawn;
  let n = 0, quiet = 0;
  for (; n < max && quiet < 4; n++) { Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true); quiet = C() && !Render3D.bench.busy() ? quiet + 1 : 0; if ((n & 15) === 15) await new Promise((r) => setTimeout(r, 0)); }
  Render3D.skipDraw = false;
  return { n, ok: quiet >= 4 };
};
// in the page: |drawn − physics| at points round the craft (r ≤ R1, half of them within R0), rays down the meshes on show
const MEASURE = ([R0, R1, N]) => {
  let s = 11;
  const rnd = () => ((s = Math.imul(s, 48271) % 2147483647) & 0x7fffffff) / 2147483647;
  const v = Flight.active, L = Terrain.locate(EARTH, v.x, v.y, v.z, {}), ce = -wrapAngle(L.a - EARTH.padAngle) * EARTH.radius, cz = L.z, near = [], all = [], read = [];
  for (let k = 0; k < N; k++) {
    const r = k < N / 2 ? R0 * Math.sqrt(rnd()) : R1 * Math.sqrt(rnd()), t = rnd() * 2 * Math.PI, e = ce + r * Math.cos(t), z = cz + r * Math.sin(t), a = siteAngle(EARTH, e);
    const d = Render3D.rayGround(EARTH, a, z);
    if (d == null) continue;
    const x = Math.abs(d - Terrain.heightAt(EARTH, a, z));
    (r <= R0 ? near : all).push(x);
    if (r <= R0) read.push(Math.abs(Render3D.drawnGround(EARTH, a, z) - d)); // (on the near ground; the patch's reading, meshHeight, is bilinear, its triangles not)
  }
  const st = (A) => { const q = [...A].sort((x, y) => x - y); return { n: q.length, p95: +(q[Math.floor(q.length * 0.95)] || 0).toFixed(3), max: +(q[q.length - 1] || 0).toFixed(3) }; };
  return { near: st(near), all: st([...near, ...all]), read: st(read) };
};
const START = ([key, e, z, yaw, air]) => { const t = TEMPLATES[key]; store.set('rss.flight', null); App.showScene('flight'); Flight.start({ name: t.name, kind: t.kind, parts: templateRows(t) }, { place: { e, z, yaw, air } }); Flight.paused = true; };

for (const [w, h, q, tag] of [[1280, 720, 'high', 'desktop High'], [390, 844, 'low', 'phone Low']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  watch(page, errs, tag + ' ');
  const ev = (f, a) => page.evaluate(f, a);
  const settle = (cond, drawn = false, max = 6000) => ev(SETTLE, [cond, drawn, max]);
  const shot = async (name) => { if (SHOTS) { await settle('true', true, 6); await page.screenshot({ path: path.join(SHOTS, `near-${name}-${w}x${h}.png`), timeout: 300000 }); } };
  const view = (yaw, pitch, scale) => ev(([y, p, s]) => { Flight.aimYaw = y; Flight.aimPitch = p; Flight.scale = Flight.naturalScale(Flight.active) * s; }, [yaw, pitch, scale]);
  await openGame(page, srv.url, { quality: q });
  await page.waitForFunction(mapIn, null, { timeout: 180000 });
  const NEAR = 'Render3D.nearInfo().shown && Render3D.nearInfo().gs === 0';
  const acc = q === 'high' ? 64 : 32; // (m round the craft where the ground drawn keeps to the physics' within 5 cm)
  const FILL = async () => { await settle('true', true, 2); return ev(() => Render3D.groundFill()); };

  // ---- a tank on a hillside, and at an outpost
  for (const [name, e, z] of [['the slope path\'s hillside', 17720, -620], ['Bixter\'s outpost', 19000, 1000]]) {
    await ev(START, ['tk34', e, z, 0.5]);
    const s1 = await settle(NEAR, false, 20000); // (the first scene waits for the whole world to be built: thousands of slices on a busy machine)
    await settle('true', true, 2); // (two frames drawn: the programs the ground was drawn with)
    const I = await ev(() => Render3D.nearInfo()), G = await ev(() => Render3D.gfx());
    const m = await ev(MEASURE, [100, 300, 240]), fine = await ev(MEASURE, [acc, acc, 120]);
    ok(`${tag}, ${name}: the near ground is up (${s1.n} frames), ${I.window.NT}² tiles and ${I.window.NF}² worked out at every node, ${I.vertices} vertices, cells ${JSON.stringify(I.cells)} (m: tiles); one shader program with the patch`, s1.ok && I.shown && I.gs === 0 && G.terrProgs === 1, { I, progs: G.terrProgs });
    ok(`${tag}, ${name}: the ground drawn is the physics' within ${acc} m (p95 ${fine.near.p95} m, worst ${fine.near.max} m) and near it out to 100 m (p95 ${m.near.p95} m, worst ${m.near.max} m), and drawnGround reads what is drawn there (worst ${m.read.max} m)`,
      fine.near.max < 0.05 && m.near.p95 < 0.25 && m.near.max < 0.6 && m.read.max < 0.02, { fine, m });
    const f1 = await FILL(), v0 = await ev(() => [Flight.aimYaw, Flight.aimPitch, Flight.scale]); // (in the view the flight starts with: behind the tank)
    if (name.startsWith('the slope')) { await view(0.9, -0.1, 0.55); await shot('tank-hill-on'); }
    await ev(() => { Render3D.nearOff = true; });
    await settle('!Render3D.nearInfo().shown');
    if (name.startsWith('the slope')) { await shot('tank-hill-off'); await ev(([y, p, sc]) => { Flight.aimYaw = y; Flight.aimPitch = p; Flight.scale = sc; }, v0); }
    const f0 = await FILL();
    ok(`${tag}, ${name}: the ground costs a GPU at most 10% more than the patch alone (${f1.frags} fragments shaded against ${f0.frags}: ${(f1.frags / f0.frags).toFixed(3)}), the near ground's triangles filling ${f1.near.frags ? ((f1.near.px / f1.near.frags) * 100).toFixed(0) : '-'}% of the 2 x 2 quads they touch`,
      f1.frags <= f0.frags * 1.1 && f1.near.px >= 0.85 * f1.near.frags, { f1, f0 });
    const m0 = await ev(MEASURE, [100, 300, 240]);
    ok(`${tag}, ${name}: without it (the patch alone) the ground drawn is off by ${m0.near.p95} m (p95) and ${m0.near.max} m at worst within 100 m, ${m0.all.max} m within 300 m`, m0.near.max > 0.2, m0);
    await ev(() => { Render3D.nearOff = false; });
  }

  // ---- driving 300 m: the window follows, each slice within its budget
  {
    await ev(START, ['tk34', 17720, -620, 0]);
    await settle(NEAR);
    const d = await ev(async () => {
      const v = Flight.active, K = VEHICLE_KINDS[v.kind], c0 = Render3D.nearInfo().commits, sl = [];
      Render3D.skipDraw = true;
      for (let i = 0; i < 600; i++) { // 0.5 m a frame (30 m/s at 60 frames a second)
        v.placeOnSurface(EARTH, siteAngle(EARTH, 17720 + i * 0.5), K.launchRot, -620, 0);
        Flight.time += 1 / 60; Flight.updateCamera(); Render3D.renderFlight(Flight, 1 / 60, true);
        const I = Render3D.nearInfo(); sl.push((I.frame && I.frame.last) || 0);
        if ((i & 15) === 15) await new Promise((r) => setTimeout(r, 0));
      }
      Render3D.skipDraw = false;
      const I = Render3D.nearInfo();
      sl.sort((x, y) => x - y);
      const budget = Settings.high ? 6 : 5;
      return { commits: I.commits - c0, mean: +(sl.reduce((x, y) => x + y, 0) / sl.length).toFixed(2), p99: sl[Math.floor(sl.length * 0.99)], worst: sl[sl.length - 1], over: sl.filter((x) => x > budget + 4).length, swaps: I.commits32, step: I.step, stepAt: I.stepAt, shown: I.shown, speed: I.speed, budget };
    });
    await settle(NEAR);
    const m = await ev(MEASURE, [acc, acc, 80]);
    // (one frame in a hundred may run long: this machine stalls now and then, the near ground or not, a GC or the host)
    ok(`${tag}: driven 300 m, the near ground follows (${d.commits} swaps), its share of a frame ${d.mean} ms on average and within its budget (99th percentile ${d.p99} ms, ${d.over} of 600 frames over by 4 ms; worst ${d.worst} ms), and the ground round the tank is the physics' (worst ${m.near.max} m within ${acc} m)`,
      d.commits >= 8 && d.shown && d.p99 < d.budget + 4 && d.over <= 6 && m.near.max < 0.05, d);
  }

  // ---- a light plane landed on the hillside
  {
    await ev(START, ['skylark', 17760, -640, 1.2]);
    await settle(NEAR);
    const g = await ev(() => {
      const v = Flight.active, out = [];
      for (const p of v.wheels) { const c = v.toWorld(p.x, p.y, 0), L = Terrain.locate(EARTH, c.x, c.y, c.z, {}); out.push(Math.abs(Render3D.drawnGround(EARTH, L.a, L.z) - Terrain.heightAt(EARTH, L.a, L.z))); }
      return { wheels: out.length, worst: +Math.max(...out).toFixed(3), kind: v.kind, landed: v.landed };
    });
    ok(`${tag}: a Skylark landed on the hillside stands on the ground drawn (its ${g.wheels} wheels' ground drawn within ${g.worst} m of the physics')`, g.wheels > 0 && g.worst < 0.05, g);
    if (SHOTS) { await view(2.2, -0.15, 0.6); await shot('plane-slope-on'); await ev(() => { Render3D.nearOff = true; }); await settle('!Render3D.nearInfo().shown'); await shot('plane-slope-off'); await ev(() => { Render3D.nearOff = false; }); }
  }

  // ---- a plane 1 km up: nothing built
  {
    await ev(START, ['falcon', 6000, 0, 0, { alt: 1000, speed: 140 }]);
    const e0 = await ev(() => Render3D.nearInfo().evals);
    await settle('true', false, 300);
    const I = await ev(() => Render3D.nearInfo());
    ok(`${tag}: a Falcon 1 km up: no near ground wanted, built or shown, the patch whole`, !I.want && !I.shown && !I.building && I.evals === e0 && !I.hole, I);
  }

  // ---- Watten, beside Highland Ridge: the arena's ground and the near ground together; then to the box's edge
  {
    await ev(START, ['tk34', 19900, 12100, 0]);
    const s = await settle(NEAR + ' && Render3D.arenaInfo().on', false, 30000);
    const m = await ev(MEASURE, [acc, 100, 160]), A = await ev(() => { const a = siteAngle(EARTH, 17750); return { arena: Math.abs(Render3D.rayGround(EARTH, a, 14500) - Terrain.heightAt(EARTH, a, 14500)), on: Render3D.arenaInfo().on }; });
    ok(`${tag}: at Watten both the arena's ground and the near ground are on show (${s.n} frames), each the physics' (near: worst ${m.near.max} m within ${acc} m, ${m.all.max} m within 100 m; in the arena ${A.arena.toFixed(3)} m)`, s.ok && A.on && m.near.max < 0.05 && m.all.max < 0.6 && A.arena < 0.3, { m, A });
    // the box's east edge is e 19,100: drive to 120 m past it, then onto it
    const edge = [];
    for (const e of [19400, 19220, 19100]) {
      await ev(START, ['tk34', e, 15000, Math.PI]);
      await settle(`Render3D.arenaInfo().on && !Render3D.nearInfo().building`, false, 30000);
      const r = await ev(([e]) => {
        const out = { gap: 0, step: 0, n: 0, near: Render3D.nearInfo().shown };
        let prev = null;
        for (let x = e - 400; x <= e + 300; x += 3) { // a line across the hand-over: the ground drawn, every 3 m
          const a = siteAngle(EARTH, x), d = Render3D.rayGround(EARTH, a, 15000);
          if (d == null) { out.gap++; continue; }
          if (prev != null) out.step = Math.max(out.step, Math.abs(d - prev) - 1.5); // (beyond the slope over 3 m)
          prev = d; out.n++;
        }
        out.step = +out.step.toFixed(2);
        return out;
      }, [e]);
      edge.push({ e, ...r });
    }
    ok(`${tag}: driving up to Highland Ridge's box, the near ground hands over to the arena's ground with no gap and no step (a line of rays across it every 3 m)`, edge.every((r) => !r.gap && r.step < 0.5), edge);
  }
  await ctx.close();
}
ok('no console errors', !errs.length, errs.slice(0, 6));
await b.close(); srv.close();
ok.done();
