// The ground update's models and art: every armour part draws in 2D (as it is, in X-ray and in the armour view) and builds
// in 3D, in the hangar and in flight; a tank's 3D model stays within its draw-call budget; turrets turn with their rings
// where aim.js says they point; belts run, wheels turn and barrels recoil; inner parts are left out in flight; wrecks are
// charred; X-ray shows what is inside; and a belt's own texture is let go with its part (no leak over 50 spawns). The big
// update's bake (spec-damage §4.5): a wreck is one mesh 6 s after it is first drawn as one (eight cost at most 8 draws more
// than none, and 8 more shadow draws), charred, its paint kept, built with no shader compiled then, still tapped part by part,
// taken apart again when it changes, never in the hangar, and 50 baked wrecks leave no geometry or texture behind.
//   node test/browser/ground-models.mjs
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const srv = await serve(), b = await launch();
const page = await (await b.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
const errs = [];
watch(page, errs);
// draws by pass (the shadow map's: its 2048 viewport; the canvas') while window.__pass is set, and every shader program built
await page.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype, fb = P.bindFramebuffer, de = P.drawElements, da = P.drawArrays, dei = P.drawElementsInstanced, dai = P.drawArraysInstanced, cp = P.createProgram;
  let cur = null;
  P.bindFramebuffer = function (t, f) { if (t === this.FRAMEBUFFER || t === this.DRAW_FRAMEBUFFER) cur = f; return fb.call(this, t, f); };
  const add = (gl) => { const C = window.__pass; if (!C) return; let k = 'canvas'; if (cur) { const v = gl.getParameter(gl.VIEWPORT); k = v[2] === 2048 && v[3] === 2048 ? 'shadow' : 'env'; } C[k] = (C[k] || 0) + 1; };
  P.drawElements = function (...a) { add(this); return de.apply(this, a); };
  P.drawArrays = function (...a) { add(this); return da.apply(this, a); };
  P.drawElementsInstanced = function (...a) { add(this); return dei.apply(this, a); };
  P.drawArraysInstanced = function (...a) { add(this); return dai.apply(this, a); };
  window.__nprog = 0; P.createProgram = function () { window.__nprog++; return cp.call(this); };
});
await openGame(page, srv.url, { build3d: false, quality: 'high' });
const ev = (f, a) => page.evaluate(f, a);
const ok = checks('ground models: 2D art, 3D models and what moves');
const row = (type, x, y, o = {}) => ({ type, x, y, flip: false, rot: 0, ...o });
// the TK-34 and MA-1 of spec §12, as design rows (att: an index), every part joined to the hull
const TK34 = [row('hullMedium', 0, 1.1), row('trackMed', 0, 0.5, { z: -1.35, att: 0 }), row('trackMed', 0, 0.5, { z: 1.35, att: 0 }), row('engDiesel', -1.8, 1.1, { att: 0 }),
  row('ringM', 0, 1.85, { att: 0 }), row('turretCast', 0, 2.425, { att: 4 }), row('gun85', 2.622, 2.425, { rot: 3, att: 5 }), row('mgCoax', 1.4, 2.425, { rot: 3, z: 0.6, att: 5 }),
  row('mgCoax', 2.03, 1.35, { rot: 3, z: 0.55, att: 0 })];
const MA1 = [row('hullMBT', 0, 1.15), row('trackMBT', 0, 0.55, { z: -1.575, att: 0 }), row('trackMBT', 0, 0.55, { z: 1.575, att: 0 }), row('engTurbine', -2.4, 1.15, { att: 0 }),
  row('ringP', -0.3, 1.96, { att: 0 }), row('turretWedge', -0.3, 2.495, { att: 4 }), row('gun120', 3.548, 2.45, { rot: 3, att: 5 }), row('mgCoax', 1.7, 2.45, { rot: 3, z: 0.75, att: 5 }),
  row('mgHeavy', -1.0, 3.17, { rot: 3, z: 0.8, att: 5 }), row('smokeL', 0.6, 2.6, { z: -1.8, att: 5 }), row('smokeL', 0.6, 2.6, { z: 1.8, att: 5 }),
  row('thermal', -0.6, 3.12, { z: -0.8, att: 5 }), row('lrf', -0.4, 3.07, { z: -0.3, att: 5 }), row('skirts', 0.5, 0.85, { z: -1.93, att: 1 }), row('skirts', 0.5, 0.85, { z: 1.93, att: 2 })];

// 1. 2D: every armour part draws, as it is, in X-ray and in the armour view, in its own colours and in a camouflage
let r = await ev(() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), bad = [];
  let n = 0;
  for (const k in PARTS) {
    const d = PARTS[k];
    if (!d.gv) continue;
    for (const [xr, av, skin] of [[null, false, null], [true, false, null], [null, true, 'woodland'], [[], true, 'whitewash']]) {
      PartPaint.xray = xr; PartPaint.armour = av;
      try { g.setTransform(30, 0, 0, -30, 128, 128); drawPart(g, { def: d, type: k, x: 0, y: 0, rot: 3 * (n & 1), flip: false, deployed: 0, skin, id: 1, belt: 1.7, spin: 0.4 }, 0.04); g.beginPath(); partPath(g, { def: d, type: k, x: 0, y: 0, rot: 0 }); n++; }
      catch (e) { bad.push(k + ': ' + e.message); }
    }
  }
  PartPaint.xray = null; PartPaint.armour = false;
  return { n, bad };
});
ok('every armour part draws in 2D: as it is, in X-ray, in the armour view, painted', !r.bad.length && r.n === 71 * 4, r.bad.join('; ') || r.n);
r = await ev((rows) => {
  const ps = partsFromDesign(rows), at = (o) => o.map((p) => p.type).indexOf('engDiesel'), hull = (o) => o.map((p) => p.type).indexOf('hullMedium');
  const a = sideOrder(ps); PartPaint.xray = ps; const b = sideOrder(ps); PartPaint.xray = null;
  return { under: at(a) < hull(a), over: at(b) > hull(b) && at(b) === b.length - 1 };
}, TK34);
ok('2D: an engine inside the hull draws under it, and on top of everything in X-ray', r.under && r.over, JSON.stringify(r));

// 2. 3D: every armour part builds, in the hangar and in flight (inner parts: nothing in flight), with no flipped copy
await ev(() => App.setPreview3D(true));
await page.waitForFunction(() => Render3D.ready && App.preview3D(), null, { timeout: 60000 });
r = await ev(() => {
  const bad = [], inner = [];
  for (const k in PARTS) {
    const d = PARTS[k];
    if (!d.gv) continue;
    try {
      for (const builder of [true, false]) {
        const vm = new Parts3D.VesselMesh([makePart(k, 0, 0)], { builder }), rig = vm.list[0];
        if (d.inner && !builder && (rig.meshes.length || rig.root.visible)) inner.push(k);
        if (!rig.meshes.length && !(d.inner && !builder)) bad.push(k + ' has no meshes');
        vm.dispose();
      }
    } catch (e) { bad.push(k + ': ' + e.message); }
  }
  const a = Parts3D.textureFor(PARTS.hullMedium, false, null, null), f = Parts3D.textureFor(PARTS.hullMedium, true, null, null);
  return { bad, inner, flipFree: a === f };
});
ok('every armour part builds in 3D, in the hangar and in flight', !r.bad.length, r.bad.join('; '));
ok('inner parts (engines, crew, racks) are not built in flight', !r.inner.length, r.inner.join(', '));
ok('their models and textures are the same either way round (one cache entry)', r.flipFree);

// 3. draw calls: what the flight view draws for one TK-34 and one MA-1 (every visible mesh, and again for its shadow)
for (const [name, rows] of [['TK-34', TK34], ['MA-1', MA1]]) {
  r = await ev((rows) => {
    const ps = partsFromDesign(rows), vm = new Parts3D.VesselMesh(ps, {});
    vm.sync({ parts: ps }, { dt: 0.016, time: 1, quality: 'high' });
    let meshes = 0, shadows = 0;
    vm.group.traverse((o) => { if (!o.isMesh) return; for (let q = o; q; q = q.parent) if (!q.visible) return; meshes++; if (o.castShadow) shadows++; });
    vm.dispose();
    return { meshes, shadows };
  }, rows);
  ok(`${name}: ${r.meshes} draw calls in flight (budget 30; ${r.shadows} also cast shadows on high)`, r.meshes <= 30 && r.meshes >= 12, JSON.stringify(r));
}

// 4. flight: the turret turns with its ring where aim.js points the gun; belts, wheels, recoil, suspension, wreck
await ev((rows) => { Render3D.skipDraw = false; App.toBuild(); Builder.loadDesign({ name: 'tk', kind: 'tank', parts: rows }); App.launch(); }, TK34);
await page.waitForFunction(() => Render3D.ready && Flight.running && Flight.active, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const frames = (n) => ev((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// a VesselMesh synced as the flight view syncs one, to read its nodes
r = await ev(() => {
  const v = Flight.active, vm = new Parts3D.VesselMesh(v.parts, {}), T = THREE, gun = v.parts.find((p) => p.type === 'gun85'), ring = v.parts.find((p) => p.def.ring);
  ring.aimYaw = 0.9; gun.aimEl = 0.2; gun.aimYaw = 0;
  vm.sync(v, { dt: 0.016, time: Flight.time, quality: 'high' });
  vm.group.updateMatrixWorld(true);
  const rig = vm.items.get(gun), inv = new T.Matrix4().copy(vm.group.matrixWorld).invert(), G = gunLayout(gun.def);
  const tip = new T.Vector3(0, G.y1 - G.ty, 0).applyMatrix4(rig.recoil.matrixWorld).applyMatrix4(inv);
  const T0 = Aim.localTrunnion(v, gun, { x: 0, y: 0, z: 0 }), D = Aim.localDir(v, gun, { x: 0, y: 0, z: 0 }), k = gun.def.h - gun.def.aim.pivot * gun.def.h;
  const want = { x: T0.x + D.x * k, y: T0.y + D.y * k, z: T0.z + D.z * k };
  const tr = vm.items.get(v.parts.find((p) => p.type === 'turretCast')), c = Aim.groupsOfParts(v.parts, v.adj)[0].c;
  const off = Math.hypot(tr.root.position.x - c.x, tr.root.position.z - c.z);
  // ...and the same frame after frame (the turn is put on afresh, not piled on the last frame's)
  const q1 = tr.root.quaternion.clone(), g1 = rig.root.quaternion.clone();
  for (let i = 0; i < 4; i++) vm.sync(v, { dt: 0.016, time: Flight.time, quality: 'high' });
  const pile = Math.max(q1.angleTo(tr.root.quaternion), g1.angleTo(rig.root.quaternion));
  // belts, wheels and the suspension
  const tk = v.parts.find((p) => p.def.track), trig = vm.items.get(tk), o0 = trig.mats.track.map.offset.x, a0 = trig.mats.rwheel.map.rotation, s0 = trig.sprocket.rotation.z;
  const susp0 = v.susp; tk.belt = (tk.belt || 0) + 0.4; v.susp = [0.2, 0.2]; // (gear.js's own array goes back after)
  vm.sync(v, { dt: 0.016, time: Flight.time, quality: 'high' });
  const belt = { offset: trig.mats.track.map.offset.x - o0, wheels: trig.mats.rwheel.map.rotation - a0, sprocket: trig.sprocket.rotation.z - s0, susp: trig.susp.position.y, own: trig.mats.track.map !== vm.items.get(v.parts.filter((p) => p.def.track)[1]).mats.track.map };
  // recoil: back at once, home within 0.7 s
  gun.shotAt = Flight.time - 0.05; vm.sync(v, { dt: 0.016, time: Flight.time, quality: 'high' }); const back = rig.recoil.position.y;
  vm.sync(v, { dt: 0.016, time: Flight.time + 0.8, quality: 'high' }); const home = rig.recoil.position.y;
  // a wreck: charred
  const m = tr.matList[0], c0 = m.color.r; v.wreck = true; vm.sync(v, { dt: 0.016, time: Flight.time, quality: 'high' }); const charred = m.color.r / c0, env = m.envMapIntensity;
  v.wreck = false; vm.sync(v, { dt: 0.016, time: Flight.time, quality: 'high' }); const back2 = m.color.r / c0;
  // ...an old part too (the big update: every part of a wreck, an old car's knocked out at last): the Dune Buggy's cab
  const bps = partsFromDesign(templateRows(TEMPLATES.buggy)), bv = new Vessel(bps, buildAdjacency(bps), EARTH); bv.kind = 'car'; bv.rebuildGroups();
  const bvm = new Parts3D.VesselMesh(bv.parts, {}), so = { dt: 0.016, time: Flight.time, quality: 'high' }; bvm.sync(bv, so);
  const cm = bvm.items.get(bv.parts.find((p) => p.type === 'cab')).matList.find((x) => x.isMeshStandardMaterial), cc0 = cm.color.r;
  bv.wreck = true; bvm.sync(bv, so); const old = { charred: cm.color.r / cc0, env: cm.envMapIntensity }; bv.wreck = false; bvm.sync(bv, so); old.back = cm.color.r / cc0; bvm.dispose();
  // a ghost (nobody steps it): its belts run with its speed
  v.remote = 7; v.vx = 0; v.vy = 0; v.vz = 0; const q = v.q; v.vx = 2 * (1 - 2 * (q.y * q.y + q.z * q.z)); v.vy = 2 * (2 * (q.x * q.y + q.w * q.z)); v.vz = 2 * (2 * (q.x * q.z - q.w * q.y));
  const g0 = trig.mats.track.map.offset.x; vm.sync(v, { dt: 0.1, time: Flight.time, quality: 'high' }); const ghost = trig.mats.track.map.offset.x - g0;
  delete v.remote; v.vx = v.vy = v.vz = 0; v.susp = susp0; ring.aimYaw = 0; gun.aimEl = 0; gun.shotAt = undefined;
  vm.dispose();
  return { tip: [tip.x, tip.y, tip.z], want, miss: Math.hypot(tip.x - want.x, tip.y - want.y, tip.z - want.z), off, pile, belt, back, home, charred, env, back2, ghost, old };
});
ok('a turned turret and raised gun: the 3D muzzle is where aim.js puts it (within 1 cm)', r.miss < 0.01, JSON.stringify({ tip: r.tip, want: r.want, miss: r.miss }));
ok('the turret turns about its ring (its centre stays on the ring\'s axis)', r.off < 0.01, r.off);
ok('...and stays turned that far frame after frame (the turn does not pile up)', r.pile < 1e-9, r.pile);
ok('a belt that moves runs its own texture round, turns its wheels and sprocket the same way', r.belt.offset !== 0 && r.belt.wheels !== 0 && Math.sign(r.belt.wheels) === Math.sign(r.belt.sprocket) && r.belt.own, JSON.stringify(r.belt));
ok('the suspension lifts the running gear by its compression past the sag at rest', Math.abs(r.belt.susp - (0.2 - 0.4 * 0.25)) < 1e-6, r.belt.susp);
ok('a shot kicks the barrel back, and it comes home', r.back < -0.1 && r.home === 0, `${r.back} ${r.home}`);
ok('a wreck is charred (a third as bright, hardly shiny), and back if it is not', Math.abs(r.charred - 0.35) < 0.01 && r.env <= 0.2 && Math.abs(r.back2 - 1) < 1e-6, `${r.charred} ${r.env} ${r.back2}`);
ok('...an old part of a wreck too (the Dune Buggy\'s cab), and back', Math.abs(r.old.charred - 0.35) < 0.01 && r.old.env <= 0.2 && Math.abs(r.old.back - 1) < 1e-6, JSON.stringify(r.old));
ok('another player\'s tank (not stepped here) runs its belts at its speed', r.ghost !== 0, r.ghost);

// 5. a belt's texture copy goes with its part: 50 tanks come and go in flight, and no texture is left behind
const tex = () => ev(() => Render3D.info().memory.textures);
const spawn = () => ev(() => { const v = Flight.active, w = Vessel.restore(JSON.parse(JSON.stringify(v.serialize()))); w.x += 12; Flight.vessels.push(w); window.__w = w; });
const drop = () => ev(() => { Flight.vessels = Flight.vessels.filter((v) => v !== window.__w); });
await spawn(); await frames(3); await drop(); await frames(3);
const t0 = await tex();
for (let i = 0; i < 50; i++) { await spawn(); await frames(2); await drop(); await frames(2); }
const t1 = await tex();
ok(`50 tanks spawned and gone leave no textures behind (${t0} -> ${t1})`, t1 <= t0, `${t0} -> ${t1}`);

// 5b. the bake: eight copies of the tank 18-39 m ahead of it, in two files, on the ground; drawn as they are, then wrecks
const passes = (n) => ev(async (n) => { // (draws a frame, by pass: the mean over n frames drawn by the game's own loop)
  window.__pass = {}; const f0 = Render3D.frameNo;
  await new Promise((done) => { const t = () => (Render3D.frameNo >= f0 + n ? done() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  const C = window.__pass, k = Render3D.frameNo - f0; window.__pass = null;
  return { canvas: +((C.canvas || 0) / k).toFixed(2), shadow: +((C.shadow || 0) / k).toFixed(2) };
}, n);
await frames(10);
const empty = await passes(8);
await ev(() => {
  const v = Flight.active, r0 = Math.hypot(v.x, v.y, v.z), up = { x: v.x / r0, y: v.y / r0, z: v.z / r0 }, F = v.pilot.F, f = v.axis(F.x, F.y, F.z), k0 = f.x * up.x + f.y * up.y + f.z * up.z;
  const fw = { x: f.x - up.x * k0, y: f.y - up.y * k0, z: f.z - up.z * k0 }, fl = Math.hypot(fw.x, fw.y, fw.z); fw.x /= fl; fw.y /= fl; fw.z /= fl;
  const rt = { x: fw.y * up.z - fw.z * up.y, y: fw.z * up.x - fw.x * up.z, z: fw.x * up.y - fw.y * up.x };
  const L0 = Terrain.locate(v.body, v.x, v.y, v.z, {}), h = r0 - (v.body.radius + Terrain.surfaceAt(v.body, L0.a, L0.z));
  window.__wr = [];
  for (let i = 0; i < 8; i++) {
    const w = Vessel.restore(JSON.parse(JSON.stringify(v.serialize()))), a = 18 + 7 * (i >> 1), s = (i & 1 ? 1 : -1) * 5;
    const p = { x: v.x + fw.x * a + rt.x * s, y: v.y + fw.y * a + rt.y * s, z: v.z + fw.z * a + rt.z * s }, L = Terrain.locate(v.body, p.x, p.y, p.z, {});
    const rr = v.body.radius + Terrain.surfaceAt(v.body, L.a, L.z) + h, n = Math.hypot(p.x, p.y, p.z);
    w.x = (p.x / n) * rr; w.y = (p.y / n) * rr; w.z = (p.z / n) * rr; w.vx = w.vy = w.vz = 0;
    Flight.vessels.push(w); window.__wr.push(w);
  }
});
await frames(3);
const unb = await passes(4);
ok(`eight tanks as they are cost ${unb.canvas} draws and ${unb.shadow} shadow draws (none: ${empty.canvas}, ${empty.shadow})`, unb.canvas >= empty.canvas + 8 * 8, { empty, unb });
// what the first one's parts look like as a wreck (a model of its own, charred): its plain materials' colours and its
// paint, part by part, and its hull's picture's mean (its opaque pixels', charred)
const pre = await ev(() => {
  const w = window.__wr[0], vm = new Parts3D.VesselMesh(w.parts, {}), plain = {}, lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  vm.sync({ parts: w.parts, wreck: true }, { dt: 0.016, time: 1, quality: 'high' });
  for (const r of vm.list) plain[r.part.id] = r.matList.filter((m) => m.isMeshStandardMaterial && !m.map && !m.vertexColors).map((m) => [m.color.r, m.color.g, m.color.b, (m.userData.c0.r + m.userData.c0.g + m.userData.c0.b) / 0.35]); // (c0: charred too; /0.35, its paint)
  const hull = vm.list.find((r) => r.part.def.place === 'hull' && r.part.def.control), hm = hull.matList.find((m) => m.map), img = hm.map.image, cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const c = cv.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0, 32, 32);
  const d = c.getImageData(0, 0, 32, 32).data, mean = [0, 0, 0];
  let a = 0;
  for (let i = 0; i < d.length; i += 4) { const al = d[i + 3] / 255; a += al; for (let k = 0; k < 3; k++) mean[k] += lin(d[i + k] / 255) * al; }
  const out = { plain, hull: hull.part.id, hullMean: mean.map((x) => (x / a) * hm.color.r) };
  vm.dispose();
  return out;
});
// now wrecks: when each is first drawn baked (s from now)
await ev(() => {
  for (const w of window.__wr) w.wreck = true;
  window.__t0 = performance.now(); window.__p0 = window.__nprog; window.__at = [];
  const watchBake = () => {
    window.__wr.forEach((w, i) => { const vm = Render3D.meshOf(w); if (window.__at[i] == null && vm && vm.baked) window.__at[i] = (performance.now() - window.__t0) / 1000; });
    if (window.__at.filter((x) => x != null).length < 8) requestAnimationFrame(watchBake);
  };
  requestAnimationFrame(watchBake);
});
await page.waitForFunction(() => window.__wr.every((w) => Render3D.meshOf(w) && Render3D.meshOf(w).baked), null, { timeout: 300000, polling: 200 });
r = await ev(() => {
  const s = Math.min(...window.__at), built = window.__nprog - window.__p0;
  const each = window.__wr.map((w) => {
    const vm = Render3D.meshOf(w), m = vm.baked, M = m.material;
    let meshes = 0;
    vm.group.traverse((o) => { if (o.isMesh && o.visible) meshes++; });
    return { meshes, rigs: vm.list.length, shadow: m.castShadow && m.receiveShadow, mat: M.vertexColors && M.roughness === 0.95 && M.metalness === 0.05 && M.envMapIntensity <= 0.2, n: vm.bakeN === w.parts.length };
  });
  return { s, built, ok: each.every((e) => e.meshes === 1 && e.rigs === 0 && e.shadow && e.mat && e.n), each: each[0] };
});
ok(`...baked from ${r.s.toFixed(1)} s on (none before 6 s, wall clock), every one one mesh, casting and taking shadows, matt (roughness 0.95, env 0.2), its parts' meshes let go`, r.s >= 6 && r.ok, r);
ok('...and no shader was built for it then (the baked wrecks\' material is compiled while the flight loads)', r.built === 0, r.built);
const bk = await passes(8);
ok(`eight baked wrecks cost at most 8 draws more than none (${empty.canvas} -> ${bk.canvas}, unbaked ${unb.canvas}) and at most 8 more shadow draws (${empty.shadow} -> ${bk.shadow}, unbaked ${unb.shadow})`, bk.canvas <= empty.canvas + 8 && bk.shadow <= empty.shadow + 8, { empty, unb, bk });
// colours: a plain part's run is its charred colour, a third of its paint (0.35 ± 0.01); the hull keeps its picture's tone
r = await ev((pre) => {
  const w = window.__wr[0], vm = Render3D.meshOf(w), g = vm.baked.geometry, I = g.index.array, C = g.attributes.color.array, plain = [], hull = [0, 0, 0];
  let nh = 0, bad = 0;
  for (const A of vm.bakeAt) {
    const cols = new Set(), sum = [0, 0, 0];
    let n = 0;
    for (let t = A.from; t < A.end; t++) for (let j = 0; j < 3; j++) { const i = I[t * 3 + j] * 3; cols.add(C[i].toFixed(5) + ',' + C[i + 1].toFixed(5) + ',' + C[i + 2].toFixed(5)); for (let k = 0; k < 3; k++) sum[k] += C[i + k]; n++; }
    if (A.part.id === pre.hull && cols.size > 1) { for (let k = 0; k < 3; k++) hull[k] += sum[k]; nh += n; } // (its textured meshes)
    if (cols.size !== 1) continue;
    const c = [...cols][0].split(',').map(Number), m = (pre.plain[A.part.id] || []).find((q) => Math.abs(q[0] - c[0]) < 1e-4 && Math.abs(q[1] - c[1]) < 1e-4 && Math.abs(q[2] - c[2]) < 1e-4);
    if (!m) bad++; else if (m[3] > 0.01) plain.push((c[0] + c[1] + c[2]) / m[3]);
  }
  return { plain: plain.length, k: [Math.min(...plain), Math.max(...plain)], bad, hull: hull.map((x) => x / nh), want: pre.hullMean };
}, pre);
ok(`a baked part in one plain colour is its charred colour: ${r.plain} runs at ${r.k.map((x) => x.toFixed(3)).join('-')} of their paint`, r.plain >= 3 && !r.bad && r.k[0] > 0.34 && r.k[1] < 0.36, r);
const tone = r.hull.map((x, i) => x / r.want[i]);
ok('...and a textured one keeps its picture\'s tone, charred (the hull: within 25% of a third of its picture\'s mean, channel by channel)', tone.every((x) => x > 0.75 && x < 1.25), { baked: r.hull, want: r.want, tone });
// a tap on a baked wreck still finds the part under it (Render3D.pickPart: the run the triangle came from)
r = await ev(() => {
  const w = window.__wr[1], bp = bodyPos(w.body, Flight.time), s = Render3D.project(bp.x + w.x, bp.y + w.y, w.z), cv = document.getElementById('view3d').getBoundingClientRect();
  const h = Render3D.pickPart(cv.left + s.x, cv.top + s.y);
  return { behind: s.behind, vessel: !!h && h.vessel === w, part: !!h && w.parts.includes(h.part), type: h && h.part && h.part.type };
});
ok('a tap on a baked wreck finds the part of it under the finger', !r.behind && r.vessel && r.part, r);
// taken apart when it changes: no longer a wreck (its parts back, as they were), or a part lost (baked afresh without it)
r = await ev(async () => {
  const fr = (n) => new Promise((done) => { const f0 = Render3D.frameNo; const t = () => (Render3D.frameNo >= f0 + n ? done() : requestAnimationFrame(t)); requestAnimationFrame(t); });
  const a = window.__wr[7], va = Render3D.meshOf(a), b = window.__wr[6], vb = Render3D.meshOf(b);
  const lost = b.parts[b.parts.length - 1];
  a.wreck = false; b.adj.delete(lost.id); for (const n of b.adj.values()) n.delete(lost.id); b.parts = b.parts.filter((p) => p !== lost); b.rebuildGroups();
  await fr(3);
  const ms = va.list.flatMap((x) => x.matList.filter((m) => m.isMeshStandardMaterial)), back = ms.every((m) => !m.userData.c0 || m.color.equals(m.userData.c0)) && va.list.every((x) => !x.charred);
  return { aBaked: !!va.baked, aRigs: va.list.length === a.parts.length, back, n: ms.length, bBaked: !!vb.baked, bN: vb.bakeN, bParts: b.parts.length };
});
ok('a baked vessel that is no longer a wreck is drawn part by part again, in its own colours', !r.aBaked && r.aRigs && r.back && r.n > 0, r);
ok('...and a baked wreck that loses a part is baked afresh without it', r.bBaked && r.bN === r.bParts, r);
// never in the hangar (nor X-ray): a builder's model of a wreck stays as it is
r = await ev(() => {
  const ps = Flight.active.parts.map((p) => p), vm = new Parts3D.VesselMesh(ps, { builder: true });
  vm.sync({ parts: ps, wreck: true }, { dt: 0.016, time: 1, quality: 'high' });
  const out = { ready: vm.bakeReady(), bake: vm.bake(), baked: !!vm.baked, rigs: vm.list.length };
  vm.dispose();
  return out;
});
ok('the hangar never bakes (a builder\'s model of a wreck stays part by part)', !r.ready && !r.bake && !r.baked && r.rigs > 0, r);
await ev(() => { Flight.vessels = Flight.vessels.filter((v) => !window.__wr.includes(v)); });
await frames(3);
// 50 wrecks baked and gone: no geometry or texture left behind
const memo = () => ev(() => Render3D.info().memory);
const spawnW = () => ev(() => { const v = Flight.active, w = Vessel.restore(JSON.parse(JSON.stringify(v.serialize()))); w.x += 12; w.wreck = true; Flight.vessels.push(w); window.__w = w; });
const bakeW = () => ev(() => Render3D.meshOf(window.__w).bake());
await spawnW(); await frames(2); await bakeW(); await frames(2); await drop(); await frames(3);
const m0 = await memo();
let bakes = 0;
for (let i = 0; i < 50; i++) { await spawnW(); await frames(2); bakes += (await bakeW()) ? 1 : 0; await frames(1); await drop(); await frames(2); }
const m1 = await memo();
ok(`50 wrecks baked and gone leave no geometry or texture behind (geometries ${m0.geometries} -> ${m1.geometries}, textures ${m0.textures} -> ${m1.textures})`, bakes === 50 && m1.geometries <= m0.geometries && m1.textures <= m0.textures, { bakes, m0, m1 });

// 6. X-ray in the hangar: armour see-through, inner parts in their colours, built-in crew and stores shown
await ev((rows) => { Flight.running = false; App.toBuild(); Builder.loadDesign({ name: 'tk', kind: 'tank', parts: rows }); }, TK34);
await ev(() => App.setPreview3D(true));
await page.waitForFunction(() => Render3D.ready && App.preview3D(), null, { timeout: 60000 });
r = await ev((rows) => {
  const xr0 = Parts3D.xray; Parts3D.xray = false; // (the builder shows an armour design in X-ray to begin with: from off here)
  const ps = partsFromDesign(rows), vm = new Parts3D.VesselMesh(ps, { builder: true }), sv = { parts: ps };
  vm.sync(sv, { dt: 0, time: 0, quality: 'high' });
  const hull = vm.items.get(ps[0]), eng = vm.items.get(ps.find((p) => p.type === 'engDiesel'));
  const before = { op: hull.matList[0].opacity, c: eng.matList[0].color.getHexString() };
  Parts3D.xray = true; vm.sync(sv, { dt: 0, time: 0, quality: 'high' });
  const on = { op: hull.matList[0].opacity, c: eng.matList[0].color.getHexString(), mods: !!hull.modsMesh && hull.modsMesh.visible };
  Parts3D.xray = false; vm.sync(sv, { dt: 0, time: 0, quality: 'high' });
  const off = { op: hull.matList[0].opacity, c: eng.matList[0].color.getHexString(), mods: !!hull.modsMesh && hull.modsMesh.visible };
  vm.dispose(); Parts3D.xray = xr0;
  return { before, on, off };
}, TK34);
ok('X-ray: the armour goes see-through and inner parts take their colour; all back after', r.on.op < 0.35 && r.on.c !== r.before.c && r.on.mods && r.off.op === r.before.op && r.off.c === r.before.c && !r.off.mods, JSON.stringify(r));
// a search radar stands still in the hangar (the idle hangar draws nothing), and turns in flight
r = await ev(() => {
  const p = makePart('radarSearch', 0, 0), a = new Parts3D.VesselMesh([p], { builder: true }), f = new Parts3D.VesselMesh([p], {});
  for (let i = 0; i < 5; i++) { a.sync({ parts: [p] }, { dt: 0.1, time: i * 0.1 }); f.sync({ parts: [p] }, { dt: 0.1, time: i * 0.1 }); }
  const out = { hangar: a.list[0].antenna.rotation.y, flight: f.list[0].antenna.rotation.y, anim: a.list.some((r) => r.spins.length && r.anim && r.anim.always) };
  a.dispose(); f.dispose();
  return out;
});
ok('a search radar turns in flight only: the hangar keeps still', r.hangar === 0 && r.flight > 1 && !r.anim, JSON.stringify(r));

ok('no page errors', !errs.length, errs.join('\n'));
await b.close(); srv.close();
ok.done();
