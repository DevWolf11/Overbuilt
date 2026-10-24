// The ground update's models and art: every armour part draws in 2D (as it is, in X-ray and in the armour view) and builds
// in 3D, in the hangar and in flight; a tank's 3D model stays within its draw-call budget; turrets turn with their rings
// where aim.js says they point; belts run, wheels turn and barrels recoil; inner parts are left out in flight; wrecks are
// charred; X-ray shows what is inside; and a belt's own texture is let go with its part (no leak over 50 spawns).
//   node test/browser/ground-models.mjs
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const srv = await serve(), b = await launch();
const page = await (await b.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
const errs = [];
watch(page, errs);
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
  // a ghost (nobody steps it): its belts run with its speed
  v.remote = 7; v.vx = 0; v.vy = 0; v.vz = 0; const q = v.q; v.vx = 2 * (1 - 2 * (q.y * q.y + q.z * q.z)); v.vy = 2 * (2 * (q.x * q.y + q.w * q.z)); v.vz = 2 * (2 * (q.x * q.z - q.w * q.y));
  const g0 = trig.mats.track.map.offset.x; vm.sync(v, { dt: 0.1, time: Flight.time, quality: 'high' }); const ghost = trig.mats.track.map.offset.x - g0;
  delete v.remote; v.vx = v.vy = v.vz = 0; v.susp = susp0; ring.aimYaw = 0; gun.aimEl = 0; gun.shotAt = undefined;
  vm.dispose();
  return { tip: [tip.x, tip.y, tip.z], want, miss: Math.hypot(tip.x - want.x, tip.y - want.y, tip.z - want.z), off, pile, belt, back, home, charred, env, back2, ghost };
});
ok('a turned turret and raised gun: the 3D muzzle is where aim.js puts it (within 1 cm)', r.miss < 0.01, JSON.stringify({ tip: r.tip, want: r.want, miss: r.miss }));
ok('the turret turns about its ring (its centre stays on the ring\'s axis)', r.off < 0.01, r.off);
ok('...and stays turned that far frame after frame (the turn does not pile up)', r.pile < 1e-9, r.pile);
ok('a belt that moves runs its own texture round, turns its wheels and sprocket the same way', r.belt.offset !== 0 && r.belt.wheels !== 0 && Math.sign(r.belt.wheels) === Math.sign(r.belt.sprocket) && r.belt.own, JSON.stringify(r.belt));
ok('the suspension lifts the running gear by its compression past the sag at rest', Math.abs(r.belt.susp - (0.2 - 0.4 * 0.25)) < 1e-6, r.belt.susp);
ok('a shot kicks the barrel back, and it comes home', r.back < -0.1 && r.home === 0, `${r.back} ${r.home}`);
ok('a wreck is charred (a third as bright, hardly shiny), and back if it is not', Math.abs(r.charred - 0.35) < 0.01 && r.env <= 0.2 && Math.abs(r.back2 - 1) < 1e-6, `${r.charred} ${r.env} ${r.back2}`);
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
