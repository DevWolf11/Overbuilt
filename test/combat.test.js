// Combat with parts at a depth: hit boxes and rounds for twin pods at +-z, blasts, a destroyed pair exploding at both
// pods, rocket pods rippling across, guns converging, missiles and bombs alternating sides, the AI raider, paint
// never touching radar. Then a fingerprint of every stock plane (hit boxes, muzzles, blast damage around the craft,
// where gun rounds go, flares and turret rounds) against test/baseline/combat.json.
//   node test/combat.test.js [--update]
const Gm = require('./lib/game.js'), { check } = require('./lib/baseline.js');
const ctx = Gm.load({ combat: true, props: true }), C = ctx.Combat, T = C._t, G = ctx; // (every prop built: nothing changes)
ctx.Math.random = () => 0.5; // no gun spread
const r3 = (x) => +x.toFixed(3);
const t = Gm.checks('combat: depth');
const ok = (c, msg) => t(msg, c);
// a vessel from rows [type, x, y, rot, extra], level at 3 km over the sea, identity attitude; whole: keep loose parts.
// (extra.att is an index into the rows, as the builder saves it: made into the part's id, as partsFromDesign does)
function craft(ctx, rows, kind = 'plane', whole) {
  const parts = rows.map(([type, x, y, rot, o]) => G.makePart(type, x, y, Object.assign({ flip: x < 0, rot: rot || 0 }, o || {}, { att: null })));
  rows.forEach((r, i) => { const a = r[4] && r[4].att; if (Number.isInteger(a) && a !== i && parts[a]) parts[i].att = parts[a].id; });
  const adjAll = G.buildAdjacency(parts), ctrl = G.findControlPart(parts), keep = whole ? new Set(parts.map((p) => p.id)) : G.componentOf(ctrl.id, adjAll);
  const ps = parts.filter((p) => keep.has(p.id)), adj = new Map();
  for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const v = new G.Vessel(ps, adj, G.EARTH);
  v.kind = kind; v.stages = G.computeStages(ps, adj, ctrl.id); v.rebuildGroups();
  v.x = G.EARTH.radius + 3000; v.y = 0; v.z = 0; v.vx = v.vy = v.vz = 0; v.q = { w: 1, x: 0, y: 0, z: 0 };
  return { v, parts, kept: ps.length };
}
// the stand-in for Flight that combat reports to
function sim(ctx, v) {
  return { time: 0, vessels: [v], active: v, running: true, toasts: [], broken: [], camAbs: null, warpIdx: 1, firing: false,
    toast(t) { this.toasts.push(t); },
    ripParts(v, ps) { this.broken.push('rip:' + ps.map((p) => p.type)); v.parts = v.parts.filter((q) => !ps.includes(q)); },
    breakParts(v, ps) { this.broken.push('break:' + ps.map((p) => p.type)); v.parts = v.parts.filter((q) => !ps.includes(q)); } };
}
// a jet with twin pods at z = 4
const base = [['jetF', 0, 2.2], ['fuselage', 0, 6], ['fuselageS', 0, 9], ['cockpitJet', 0, 12.1], ['wingDelta', 0.4, 5.8]];
{
  const { v, kept } = craft(ctx, base.concat([['jetPods', 1.2, 5.6, 0, { z: 4 }]]));
  const pod = v.parts.find((p) => p.type === 'jetPods');
  ok(kept === 6 && pod && pod.z === 4, `jetPods at z=4 kept (kept ${kept}, z ${pod && pod.z})`);
  console.log('     boxes', JSON.stringify(T.boxesOf(pod).map((b) => b.map(r3))));
  const seg = (z) => { const a = v.toWorld(pod.x, pod.y - 30, z), b = v.toWorld(pod.x, pod.y + 30, z); return T.hitVessel(v, a, b); };
  for (const [z, want] of [[4, 'jetPods'], [-4, 'jetPods'], [2.8, null], [-2.8, null], [4.55, 'jetPods'], [4.7, null]]) {
    const h = seg(z);
    ok((h ? h.p.type : null) === want, `round along the nose at x=${pod.x}, z=${z}: ${h ? h.p.type : 'miss'} (want ${want || 'miss'})`);
  }
  // through the real projectile step: the pod takes the hit
  const F = sim(ctx, v);
  const a = v.toWorld(pod.x, pod.y - 10, 4);
  C.S.shots = [{ k: 'bullet', b: G.EARTH, x: a.x, y: a.y, z: a.z, vx: 0, vy: 900, vz: 0, t: 0, life: 3, dmg: 9, blast: 0, owner: null }];
  // (the round flies along +y in sim axes: part +y with the identity attitude)
  C.step(1 / 60, F);
  ok(pod.hp != null && pod.hp < C.maxHp(pod.def), `bullet stepped through z=+4 damaged the pod (hp ${pod.hp && pod.hp.toFixed(1)} of ${C.maxHp(pod.def)})`);
  // blast: centre distance from each copy
  pod.hp = null;
  C.explode(G.EARTH, v.toWorld(pod.x, pod.y, 4 + 3), 5, 100, null, F, true);
  ok(pod.hp != null, `blast 3 m outboard of the +4 pod reaches it (hp ${pod.hp && pod.hp.toFixed(1)})`);
  // destroyed: blasts at each pod
  const booms = [];
  const ex0 = ctx.FX.explosion; ctx.FX.explosion = (b, at) => booms.push(r3(v.toLocal(at.x, at.y, at.z).z));
  pod.fuel = 2000; T.destroyPart(v, pod, 'shot', F);
  ctx.FX.explosion = ex0;
  ok(booms.length === 2 && booms.includes(-4) && booms.includes(4), `destroyed pod pair with fuel blows at ${JSON.stringify(booms)}`);
}
// rocket pods at z = 5: muzzles at ±5; the pods ripple
{
  const { v } = craft(ctx, base.concat([['rocketPods', 1, 5, 0, { z: 5 }], ['rocketPods', 1, 7.5, 0, { z: 2.5 }]]), 'plane', true);
  const [A, B] = v.parts.filter((p) => p.type === 'rocketPods');
  ok(T.muzzle(A, -1).z === -5 && T.muzzle(A, 1).z === 5, `rocket pod pair at p.z=5: muzzle z ${T.muzzle(A, -1).z}, ${T.muzzle(A, 1).z}`);
  const F = sim(ctx, v); F.firing = true; v.wsel = T.systems(v).findIndex((s) => s.key === 'rocketPods');
  C.S.shots = []; C.S.rocketT = 0;
  const seq = [];
  for (let i = 0; i < 8; i++) { C.S.rocketT = 0; const n = C.S.shots.length; C.step(1 / 600, F); const s = C.S.shots[n]; if (s) { const l = v.toLocal(s.x, s.y, s.z); seq.push(r3(l.z)); } }
  console.log('     rocket z order', JSON.stringify(seq));
  ok(JSON.stringify(seq) === JSON.stringify([-5, 5, -2.5, 2.5, -5, 5, -2.5, 2.5]), 'rockets ripple across all four pods, sides alternating');
}
// a single cannon at z = 1.5: rounds leave at 1.5 and meet the centreline 600 m out
{
  const { v } = craft(ctx, base.concat([['cannon', -1.25, 8.6, 0, { z: 1.5 }]]), 'plane', true);
  const gun = v.parts.find((p) => p.type === 'cannon'), F = sim(ctx, v);
  C.S.shots = []; gun.cool = 0;
  T.fireGun(v, gun, 1 / 16 - 1e-6, false, F);
  const s = C.S.shots[0], l = v.toLocal(s.x, s.y, s.z), vl = v.toLocal(v.x + s.vx, v.y + s.vy, v.z + s.vz), o = v.toLocal(v.x, v.y, v.z);
  const dz = vl.z - o.z, dy = vl.y - o.y, spd = Math.hypot(vl.x - o.x, dy, dz), zAt600 = l.z + (dz / dy) * 600;
  ok(Math.abs(l.z - 1.5) < 1e-9, `cannon at p.z=1.5: round spawns at z ${r3(l.z)}`);
  ok(Math.abs(zAt600) < 1e-6 && Math.abs(spd - gun.def.weapon.speed) < 1e-6, `converges: z 600 m out ${zAt600.toExponential(2)}, speed ${spd.toFixed(3)} (unit direction)`);
  const g0 = v.parts.find((p) => p.type === 'cannon'); g0.z = 0.2; C.S.shots = []; g0.cool = 0; g0.ammo = 10;
  T.fireGun(v, g0, 1 / 16 - 1e-6, false, F);
  const s2 = C.S.shots[0], vl2 = v.toLocal(v.x + s2.vx, v.y + s2.vy, v.z + s2.vz);
  ok(Math.abs(vl2.z - o.z) < 1e-9, `a gun at |z| 0.2 (under 0.3) fires straight (dz ${(vl2.z - o.z).toExponential(1)})`);
}
// missiles from two twin racks, and heavy bombs from mirrored single racks: sides alternate
{
  const { v } = craft(ctx, base.concat([['aam', 1, 4.6, 0, { z: 2.5 }], ['aam', 1, 7.5, 0, { z: 5 }],
    ['bombL', 1.4, 5, 0, { z: -3 }], ['bombL', 1.4, 5, 0, { z: 3 }], ['bombL', 1.4, 8, 0, { z: -6 }], ['bombL', 1.4, 8, 0, { z: 6 }]]), 'plane', true);
  const F = sim(ctx, v); F.vessels = [v];
  const order = (key, n) => {
    v.wsel = T.systems(v).findIndex((s) => s.key === key);
    const out = [];
    for (let i = 0; i < n; i++) { const k = C.S.shots.length; F.fireTap = true; T.playerFrame(F, 1 / 60); const s = C.S.shots[k]; out.push(s ? r3(v.toLocal(s.x, s.y, s.z).z) : 'none'); }
    return out;
  };
  C.S.shots = [];
  const m = order('aam', 5);
  console.log('     missiles z', JSON.stringify(m), F.toasts.slice(-1));
  ok(JSON.stringify(m.slice(0, 4)) === '[2.5,-2.5,5,-5]' && m[4] === 'none', 'four missiles from two racks: right, left, right, left (as the 3D model drops them), then empty');
  const b = order('bombL', 4);
  console.log('     bombs z', JSON.stringify(b));
  ok(JSON.stringify(b) === '[-3,3,-6,6]', 'mirrored single bomb racks: left, right, left, right across both racks');
  // a mirrored single pair: each side in turn (a one-sided pair)
  const { v: w } = craft(ctx, base.concat([['bombL', 1.4, 5, 0, { z: 3 }], ['bombL', 1.4, 5, 0, { z: -3 }]]), 'plane', true);
  ok(Math.abs(w.com.z || 0) < 1e-9, `mirrored pair keeps com.z at 0 (${w.com.z})`);
}
// the bandit: all 11 parts
{
  const { v } = craft(ctx, [['cockpitJet', 0, 12.1]]);
  v.altitude = () => 3000;
  const F = sim(ctx, v);
  const b = T.spawnFighter(F);
  ok(b.parts.length === 11 && ctx.RAIDER.length === 11, `RAIDER spawns with ${b.parts.length} of ${ctx.RAIDER.length} parts`);
  ok(b.parts.some((p) => p.type === 'vtailTwin'), 'its twin tail is kept (pylonLink)');
}
// skins never touch radar
{
  const { v } = craft(ctx, ctx.TEMPLATES.falcon.parts, 'plane');
  const s0 = C.stealthOf(v);
  for (const p of v.parts) p.skin = 'stealth';
  ok(C.stealthOf(v) === s0, `stealthOf unchanged with every part painted (${s0})`);
}
// an IRST ball (the look-alike jets): heat seekers lock on 30% further away; radar and ground missiles as before
{
  const { v } = craft(ctx, ctx.TEMPLATES.falcon.parts, 'plane'), W = ['aam', 'radarMissiles', 'agm'].map((k) => ctx.PARTS[k].weapon);
  const before = W.map((w) => T.rangeOf(v, w));
  v.parts.push(G.makePart('ruIRST', -1.2, 12));
  const after = W.map((w) => T.rangeOf(v, w));
  ok(Math.abs(after[0] - before[0] * 1.3) < 1e-9 && after[1] === before[1] && after[2] === before[2], `IRST: heat seekers lock from 30% further, radar and attack missiles unchanged (${before} -> ${after})`);
}
t.done();

// ---- countermeasures: the Chaff Dispenser, the cloud that comes with flares, the HUD status, what the screen shows,
// and the frigate's radar SAM (a small Monte Carlo with the real missile code)
const u = Gm.checks('combat: countermeasures and the frigate radar SAM');
const kinds = () => C.S.flares.map((f) => (f.flare ? 'flare' : f.str > 1 ? 'bundle' : 'cloud')).join(',');
const without = (rows, type) => rows.filter((r) => r[0] !== type);
const FALCON = ctx.TEMPLATES.falcon.parts, HORNET = ctx.TEMPLATES.hornet.parts;
{
  const { v } = craft(ctx, FALCON), F = sim(ctx, v), disp = v.parts.find((p) => p.type === 'chaff'), fl = v.parts.find((p) => p.type === 'flares');
  C.reset(F);
  u('the Falcon carries a Chaff Dispenser: 24 bundles, 24 kg', disp && disp.ammo === 24 && disp.store === 24, disp && [disp.ammo, disp.store]);
  u('chaff is not a weapon to choose (Tab)', !T.systems(v).some((s) => s.key === 'chaff' || s.key === 'flares'), T.systems(v).map((s) => s.key));
  const ok1 = C.countermeasures(v, F);
  u('K with a dispenser: two flares and a bundle, no free cloud', ok1 && kinds() === 'flare,flare,bundle', kinds());
  u('a bundle costs one round and a kilo of store', disp.ammo === 23 && disp.store === 23 && fl.ammo === 28, [disp.ammo, disp.store, fl.ammo]);
  F.time = 0.3;
  u('not again within 0.6 s', !C.countermeasures(v, F) && C.S.flares.length === 3);
  F.time = 0.7;
  u('again after 0.6 s', C.countermeasures(v, F) && disp.ammo === 22);
  disp.ammo = 0; C.S.flares = []; F.time = 2;
  u('an empty dispenser: the flares bring their cloud again', C.countermeasures(v, F) && kinds() === 'flare,flare,cloud', kinds());
}
{
  // a craft with flares and no dispenser: K is exactly what it always was (flares(v, sim, true))
  const a = craft(ctx, without(FALCON, 'chaff')).v, b = craft(ctx, without(FALCON, 'chaff')).v, F = sim(ctx, a);
  C.reset(F); C.countermeasures(a, F);
  const k = JSON.stringify(C.S.flares.map((f) => [f.x, f.y, f.z, f.vx, f.vy, f.vz, f.life, !!f.flare, !!f.chaff, f.str]));
  C.S.flares = []; C.flares(b, F, true);
  const want = JSON.stringify(C.S.flares.map((f) => [f.x, f.y, f.z, f.vx, f.vy, f.vz, f.life, !!f.flare, !!f.chaff, f.str]));
  u('flares only: K drops two flares and the free cloud, as before', kinds() === 'flare,flare,cloud' && k === want, kinds());
}
{
  const { v } = craft(ctx, HORNET.concat([['chaff', -1.2, 3.8]])), F = sim(ctx, v);
  C.reset(F);
  u('a chaff-only craft: K drops one bundle', C.countermeasures(v, F) && kinds() === 'bundle', kinds());
  // the HUD: a craft whose only weapons are flares or chaff still gets the weapon box and the CM button
  const st = (rows) => C.status(craft(ctx, rows, 'plane', true).v);
  const sF = st(HORNET.concat([['flares', -1.2, 3.8]])), sC = st(HORNET.concat([['chaff', -1.2, 3.8]])), sB = st(FALCON);
  u('status(): flares-only plane has one (FLARES, cmOnly, ✦30)', !!sF && sF.name === 'FLARES' && sF.cmOnly && sF.flares === 30 && sF.chaff === 0, sF);
  u('status(): chaff-only plane has one (CHAFF, ≋24)', !!sC && sC.name === 'CHAFF' && sC.cmOnly && sC.chaff === 24, sC);
  u('status(): a plain Hornet has none', st(HORNET) === null);
  u('status(): Falcon shows its gun, ✦30 and ≋24', sB && !sB.cmOnly && sB.name === 'GUN' && sB.flares === 30 && sB.chaff === 24, sB);
  u('stealth: a dispenser sits flush (Spectre unchanged)', C.stealthOf(craft(ctx, ctx.TEMPLATES.spectre.parts).v) === C.stealthOf(craft(ctx, without(ctx.TEMPLATES.spectre.parts, 'chaff')).v));
}
{
  // another player's 'cm': the chaff strength is clamped to the kinds there are
  const g = { body: G.EARTH, remote: 7 }, P = [G.EARTH.radius + 3000, 0, 0], V = [0, 200, 0];
  C.S.flares = [];
  const ins = [0, 1, 2, '2', 5, -3, NaN, 'x', true, null, undefined, 1.4, 1.6, {}, [2]];
  for (const c of ins) C.netFlares(g, { P, V, chaff: c });
  u('netFlares: chaff values sanitised', kinds() === 'flare,cloud,bundle,bundle,bundle,flare,flare,flare,cloud,flare,flare,cloud,bundle,flare,bundle', kinds());
  u('netFlares: a bundle lasts 5 s, a flare 4', C.S.flares[2].life === 5 && C.S.flares[0].life === 4);
  C.netFlares(g, { P: [1, 2], V, chaff: 2 }); C.netFlares(g, { P, V: [0, NaN, 0], chaff: 2 });
  u('netFlares: bad positions are still dropped', C.S.flares.length === ins.length);
}
{
  // the seeker's view: a dispenser's bundle is wider and likelier, and waits until the missile is within 4 km
  const { v } = craft(ctx, FALCON), F = sim(ctx, v);
  C.reset(F);
  const tp = (vy, vz) => ({ x: v.x, y: v.y, z: v.z, vx: 0, vy, vz, alive: true });
  const look = (dist, f, vy, vz, rnd) => { // a radar missile dist behind the target (along -y), one cloud
    ctx.Math.random = () => rnd;
    C.S.flares = [Object.assign({ b: G.EARTH, t: 0, life: 5, chaff: true }, f)];
    const s = { x: v.x, y: v.y - dist, z: v.z, heat: false, cm: new WeakSet(), target: v };
    const hit = T.decoyed(s, v, tp(vy, vz), 0, 1, 0, dist);
    return { hit, seen: s.cm.has(C.S.flares[0]) };
  };
  const at = (dy, dz, str) => ({ x: v.x, y: v.y + dy, z: v.z + dz, str });
  let r = look(3000, at(-200, 0, 2), 0, 250, 0.7);
  u('bundle 200 m off, target crossing the beam: 0.7 < 3 in 4 fools it', r.hit && r.seen);
  r = look(3000, at(-200, 0, 2), 250, 0, 0.3);
  u('bundle, target flying along the beam: 0.3 > about 1 in 7 does not', !r.hit && r.seen);
  r = look(3000, at(-200, 0, 2), 250, 0, 0.1);
  u('... 0.1 < about 1 in 7 does', r.hit);
  r = look(3000, at(-200, 0), 0, 250, 0.7);
  u('the free cloud crossing: 0.7 > 3 in 5 (as before)', !r.hit && r.seen);
  r = look(3000, at(-200, 0), 0, 250, 0.5);
  u('... 0.5 < 3 in 5 (as before)', r.hit);
  r = look(3000, at(0, 300), 0, 250, 0);
  u('free cloud 300 m off: seen and wasted (as before)', !r.hit && r.seen);
  r = look(3000, at(0, 300, 2), 0, 250, 0);
  u('bundle 300 m off: inside its 400 m', r.hit);
  r = look(3000, at(0, 450, 2), 0, 250, 0);
  u('bundle 450 m off: not weighed, and kept for later', !r.hit && !r.seen);
  r = look(6000, at(-100, 0, 2), 0, 250, 0);
  u('bundle with the missile 6 km out: waits (not seen yet)', !r.hit && !r.seen);
  r = look(3900, at(-100, 0, 2), 0, 250, 0);
  u('... and is weighed once it is within 4 km', r.hit && r.seen);
  ctx.Math.random = () => 0;
  C.S.flares = [Object.assign({ b: G.EARTH, t: 0, life: 5, chaff: true }, at(-200, 0, 2))];
  u('a heat seeker ignores chaff bundles', !T.decoyed({ x: v.x, y: v.y - 3000, z: v.z, heat: true, irccm: 0, cm: new WeakSet() }, v, tp(0, 250), 0, 1, 0, 3000));
  // lock breaking follows the same strength: a launcher 5 km behind, the cloud 350 m from the target
  const L = craft(ctx, FALCON).v; L.y -= 5000;
  C.S.flares = [Object.assign({ b: G.EARTH, t: 0, life: 5, chaff: true }, at(0, 350))];
  ctx.Math.random = () => 0;
  u('lock: the free cloud 350 m off is out of its reach', !T.chaffBreaks(L, v));
  C.S.flares = [Object.assign({ b: G.EARTH, t: 0, life: 5, chaff: true }, at(0, 350, 2))];
  ctx.Math.random = () => 0.1;
  u('lock: a bundle 350 m off can break it (about 1 in 7 head on)', T.chaffBreaks(L, v));
  ctx.Math.random = () => 0.5;
}
{
  // what the screen shows: flare sparks so many a second (the same at 60 and 120 frames a second), one burst per
  // chaff cloud, nothing more than 3 km from the camera
  const count = (rows, fps, far) => {
    const { v } = craft(ctx, rows), F = sim(ctx, v), n = {};
    C.reset(F); v.vy = 250;
    const cam = () => { if (far) { const bp = Gm.run(ctx, `bodyPos(EARTH, ${F.time})`); F.camAbs = { x: bp.x + v.x + 5000, y: bp.y + v.y, z: v.z }; } };
    const add0 = ctx.FX.add;
    ctx.FX.add = (p) => { n[p.kind] = (n[p.kind] || 0) + 1; };
    C.countermeasures(v, F);
    const dt = 1 / fps;
    for (let i = 0; i < 5 * fps; i++) { F.time += dt; v.y += v.vy * dt; C.step(dt, F); cam(); T.cmFX(F, dt); }
    ctx.FX.add = add0;
    return n;
  };
  const a = count(FALCON, 60), b = count(FALCON, 120), c = count(without(FALCON, 'chaff'), 60), d = count(without(FALCON, 'chaff'), 144), e = count(FALCON, 120, true);
  console.log('     particles (falcon 60/120, flares only 60/144, camera 5 km off)', JSON.stringify([a, b, c, d, e]));
  u('flare sparks per second, not per frame (60 vs 120 fps)', a.fire > 400 && Math.abs(a.fire - b.fire) <= 2 && Math.abs(c.fire - d.fire) <= 2, [a.fire, b.fire, c.fire, d.fire]);
  u('a bundle bursts once: 12 glints and 3 puffs, at any frame rate', a.glint === 12 && a.smoke === 3 && b.glint === 12 && b.smoke === 3);
  u('the free cloud: 8 glints and 2 puffs', c.glint === 8 && c.smoke === 2 && d.glint === 8 && d.smoke === 2);
  u('nothing more than 3 km from the camera', Object.keys(e).length === 0, e);
}
{
  // the frigate's radar SAM: guided by the ship's own radar (reach, stealth, ECM, notching, the ground in the way)
  let seed = 11;
  ctx.Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let x = seed; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const ship = T.makeTarget('ship');
  const c = ship.pos, r0 = Math.hypot(c.x, c.y, c.z), up = { x: c.x / r0, y: c.y / r0, z: c.z / r0 }, fr = Gm.run(ctx, `surfaceFrame(${c.x}, ${c.y}, ${c.z})`);
  const bearing = (a) => ({ x: fr.east.x * Math.cos(a) + fr.north.x * Math.sin(a), y: fr.east.y * Math.cos(a) + fr.north.y * Math.sin(a), z: fr.east.z * Math.cos(a) + fr.north.z * Math.sin(a) });
  const spot = (a, dist, alt) => { const dir = bearing(a), p = { x: c.x + dir.x * dist, y: c.y + dir.y * dist, z: c.z + dir.z * dist }, k = (G.EARTH.radius + alt) / Math.hypot(p.x, p.y, p.z); return { x: p.x * k, y: p.y * k, z: p.z * k, dir }; };
  // a plane dist from the ship on bearing a, alt up, flying at 250 m/s: away (tail), across (beam) or towards it (head)
  const place = (rows, a, dist, alt, aspect) => {
    const v = Gm.craft(ctx, rows, 'plane', 'air'), s = spot(a, dist, alt), dir = s.dir;
    v.gForce = 1; v.x = s.x; v.y = s.y; v.z = s.z;
    const side = { x: up.y * dir.z - up.z * dir.y, y: up.z * dir.x - up.x * dir.z, z: up.x * dir.y - up.y * dir.x };
    const vd = aspect === 'tail' ? dir : aspect === 'head' ? { x: -dir.x, y: -dir.y, z: -dir.z } : side;
    v.vx = vd.x * 250; v.vy = vd.y * 250; v.vz = vd.z * 250;
    return v;
  };
  const sees = (v) => T.siteSees(ship, v, { x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz, alive: true });
  u('the frigate sees a Falcon 8 km out, 3 km up', sees(place(FALCON, 0.7, 8000, 3000, 'head')) === true);
  u('... not at 13.5 km (out of its radar\'s reach)', sees(place(FALCON, 0.7, 13500, 3000, 'head')) === false);
  u('... nor a Spectre at 8 km (stealth)', sees(place(ctx.TEMPLATES.spectre.parts, 0.7, 8000, 3000, 'head')) === false);
  u('... nor a jamming Falcon at 11 km', sees(place(FALCON.concat([['ecm', 1.275, 7.4]]), 0.7, 11000, 3000, 'head')) === false);
  u('a Falcon 150 m up flying across the beam notches', sees(place(FALCON, 0.7, 7000, 150, 'beam')) === 'notch');
  u('... flying at it, it does not', sees(place(FALCON, 0.7, 7000, 150, 'head')) === true);
  // the ground in the way: some bearing has an island between the ship and a plane 100 m up 10 km out (well inside
  // the radar horizon), and the same spot 3 km up is in plain view
  const mast = { x: c.x * (1 + (ship.def.h + 12) / r0), y: c.y * (1 + (ship.def.h + 12) / r0), z: c.z * (1 + (ship.def.h + 12) / r0) };
  let hid = -1;
  for (let a = 0; a < 6.28 && hid < 0; a += 0.05) { const p = spot(a, 10000, 100); if (!T.clearLine(mast, p, 10000)) hid = a; }
  u('an island hides a low plane from the ship\'s radar (some bearing)', hid >= 0 && T.clearLine(mast, spot(hid, 10000, 3000), 10000), hid.toFixed(2));
  // the Monte Carlo: the plane flies straight; K pressed once at 3 km (or never). (Head on, a missile the chaff
  // fooled still flies on into a plane that holds its course: chaff wants a turn with it, so that case isn't here.)
  const fly = (rows, a, dist, alt, aspect, press) => {
    const v = place(rows, a, dist, alt, aspect), F = Gm.sim();
    Object.assign(F, { running: true, active: v, vessels: [v], warpIdx: 0, destroyed: false, firing: false, camAbs: null });
    C.reset(F); C.S.targets = [ship];
    T.shipSamFire(ship, F);
    const m = C.S.shots[C.S.shots.length - 1], H = 1 / 120;
    let pressed = false;
    for (let t = 0; t < 30; t += H) {
      F.time = t;
      const r = Math.hypot(v.x, v.y, v.z); v.x += v.vx * H; v.y += v.vy * H; v.z += v.vz * H; const k = r / Math.hypot(v.x, v.y, v.z); v.x *= k; v.y *= k; v.z *= k; // (level over the curved sea)
      if (press && !pressed && Math.hypot(m.x - v.x, m.y - v.y, m.z - v.z) < 3000) pressed = C.countermeasures(v, F);
      C.step(H, F);
      if (!C.S.shots.includes(m)) break;
    }
    return v.parts.some((p) => p.hp != null);
  };
  const rate = (n, ...args) => { let h = 0; for (let i = 0; i < n; i++) if (fly(...args)) h++; return h / n; };
  const N = 24, rows = [
    ['no countermeasures, head on', rate(N, FALCON, 0.7, 8000, 3000, 'head', false), 0.9, 1],
    ['one bundle at 3 km, flying away from the ship (about 1 in 7 fools it)', rate(N, FALCON, 0.7, 5000, 3000, 'tail', true), 0.6, 1],
    ['one bundle at 3 km, crossing (3 in 4)', rate(N, FALCON, 0.7, 8000, 3000, 'beam', true), 0.05, 0.45],
    ['flares only: their free cloud at 3 km, crossing (3 in 5)', rate(N, without(FALCON, 'chaff'), 0.7, 8000, 3000, 'beam', true), 0.15, 0.65],
    ['notching: 150 m up, crossing', rate(N, FALCON, 0.7, 7000, 150, 'beam', false), 0, 0.05],
  ];
  for (const [what, hit, lo, hi] of rows) u(`radar SAM hits ${Math.round(hit * 100)}%: ${what} (want ${Math.round(lo * 100)}-${Math.round(hi * 100)}%)`, hit >= lo && hit <= hi);
  ctx.Math.random = () => 0.5;
}
{
  // the frigate fires on its own in Hostile mode: once its radar holds the craft, one at a time, at most every 13 s
  const ship = T.makeTarget('ship');
  const v = Gm.craft(ctx, FALCON, 'plane', 'air'), F = Gm.sim();
  const c = ship.pos, fr = Gm.run(ctx, `surfaceFrame(${c.x}, ${c.y}, ${c.z})`);
  const p = { x: c.x + fr.east.x * 7000, y: c.y + fr.east.y * 7000, z: c.z + fr.east.z * 7000 }, k = (G.EARTH.radius + 3000) / Math.hypot(p.x, p.y, p.z);
  Object.assign(v, { x: p.x * k, y: p.y * k, z: p.z * k, vx: 0, vy: 0, vz: 0, gForce: 1 });
  for (const q of v.parts) q.hp = 1e9; // (it takes the hits and flies on)
  Object.assign(F, { running: true, active: v, vessels: [v], warpIdx: 0, destroyed: false, firing: false, camAbs: null });
  C.reset(F); C.S.targets = [ship]; C.S.spawned = true; C.S.fighterT = 1e9;
  const launches = [];
  let most = 0, warnedR = false;
  for (let t = 0; t < 60; t += 1 / 30) {
    F.time = t;
    const n = C.S.shots.filter((s) => s.k === 'missile' && s.owner === ship).length;
    C.frame(F, 1 / 30);
    for (let i = 0; i < 4; i++) C.step(1 / 120, F);
    const n2 = C.S.shots.filter((s) => s.k === 'missile' && s.owner === ship);
    if (n2.length > n) launches.push(+t.toFixed(2));
    if (C.S.warnR) warnedR = true;
    most = Math.max(most, n2.length);
    v.x = p.x * k; v.y = p.y * k; v.z = p.z * k; // (it hovers there)
  }
  const gaps = launches.slice(1).map((x, i) => x - launches[i]);
  u('the frigate launches radar SAMs at a craft in reach and over 150 m: first after ~20 s, then 13 s or more apart, one at a time', launches.length >= 2 && launches[0] >= 19.5 && launches[0] < 21 && gaps.every((g) => g >= 12.9) && most === 1, JSON.stringify(launches));
  u('the warning says RADAR MISSILE while one is after the craft', warnedR);
  // just off the runway (100 m up, the ship in reach and in view): no radar SAM, as for the SAM sites
  const k2 = (G.EARTH.radius + 100) / Math.hypot(p.x, p.y, p.z);
  C.reset(F); C.S.targets = [ship]; ship.rsamT = null; C.S.spawned = true; C.S.fighterT = 1e9;
  let low = 0;
  for (let t = 0; t < 40; t += 1 / 30) {
    Object.assign(v, { x: p.x * k2, y: p.y * k2, z: p.z * k2, vx: 0, vy: 0, vz: 0, landed: false });
    C.frame(F, 1 / 30);
    low += C.S.shots.filter((s) => s.k === 'missile' && s.owner === ship).length;
  }
  u('no radar SAM at a craft under 150 m (a take-off)', low === 0, low);
}
ctx.Math.random = () => 0.5;
u.done();

// ---- the stock fingerprint
const r = (x) => +(+x).toPrecision(10);
function finger() {
  const out = {};
  const keys = Object.keys(ctx.TEMPLATES).filter((k) => ctx.TEMPLATES[k].kind === 'plane').concat(['RAIDER']);
  for (const key of keys) {
    const rows = key === 'RAIDER' ? ctx.RAIDER : ctx.TEMPLATES[key].parts;
    const { v } = craft(ctx, rows, 'plane');
    const o = out[key] = { boxes: [], muzzles: [], blast: [], guns: [], flares: [] };
    for (const p of v.parts) {
      o.boxes.push(p.type + ':' + T.boxesOf(p).map((b) => b.map(r).join(',')).sort().join('|'));
      if (p.def.weapon) for (const s of [-1, 1]) { const m = T.muzzle(p, s); o.muzzles.push(`${p.type}:${s}:${r(m.x)},${r(m.y)},${r(m.z)}`); }
    }
    // blast damage at a ring of points around the craft
    const F = sim(ctx, v);
    for (const [x, y, z] of [[0, 6, 3], [1.5, 5, -4], [0, 2, 0], [-1, 10, 6], [2, 8, -2.5], [1, 12, 2.8]]) {
      for (const p of v.parts) p.hp = null;
      C.explode(G.EARTH, v.toWorld(x, y, z), 6, 100, null, F, true);
      o.blast.push(v.parts.map((p) => (p.hp == null ? '-' : r(p.hp))).join(','));
    }
    for (const p of v.parts) p.hp = null;
    // guns: where the rounds go (the twin pods' toe-in is new: reported apart)
    for (const p of v.parts) if (p.def.weapon && p.def.weapon.kind === 'gun') {
      C.S.shots = []; p.cool = 0; p.side = undefined;
      T.fireGun(v, p, 2 / p.def.weapon.rate - 1e-9, false, F);
      for (const s of C.S.shots) { const l = v.toLocal(s.x, s.y, s.z), d = v.toLocal(v.x + s.vx, v.y + s.vy, v.z + s.vz), c = v.toLocal(v.x, v.y, v.z); o.guns.push(`${p.type}:${!!p.def.twinZ}:${r(l.x)},${r(l.y)},${r(l.z)}>${r(d.x - c.x)},${r(d.y - c.y)},${r(d.z - c.z)}`); }
    }
    // flares
    if (v.parts.some((p) => p.def.weapon && p.def.weapon.kind === 'flare')) { C.S.flares = []; C.flares(v, F, true); for (const f of C.S.flares) { const l = v.toLocal(f.x, f.y, f.z); o.flares.push(`${r(l.x)},${r(l.y)},${r(l.z)}`); } }
    // a chaff dispenser's bundle
    if (v.parts.some((p) => p.def.weapon && p.def.weapon.kind === 'chaff')) { C.S.flares = []; C.chaff(v, F); for (const f of C.S.flares) { const l = v.toLocal(f.x, f.y, f.z); o.flares.push(`chaff ${r(l.x)},${r(l.y)},${r(l.z)}`); } }
    // turret rounds
    for (const p of v.parts) if (p.def.weapon && p.def.weapon.kind === 'turret') { C.S.shots = []; p.cool = 0; T.turretFire(v, p, 0.01, F, false, false); const s = C.S.shots[0], l = v.toLocal(s.x, s.y, s.z); o.flares.push(`turret ${r(l.x)},${r(l.y)},${r(l.z)}`); }
  }
  return out;
}
check('combat', finger());

// ---- the stock ground vehicles' fingerprint (test/baseline/groundcombat.json): what doesn't turn (the body box), each
// aimed weapon's muzzle with the turrets straight ahead and turned 90°, the shell each gun fires (where it leaves, how
// fast which way), what 24 fixed level rays through the vehicle meet (12 bearings at two heights: part, face, entry),
// and what two fixed shots do inside (an 85 mm APHE at 500 m and a 120 mm dart at 1 km on the hull's front: the
// result, the rows and the module rows). Part ids are made the same each time (the resolver's dice read them).
function groundFinger() {
  const out = {}, P = (o, x, y, z) => { const l = o.toLocal(x, y, z); return [r(l.x), r(l.y), r(l.z)].join(','); };
  const keys = Object.keys(ctx.TEMPLATES).filter((k) => ctx.TEMPLATES[k].parts.some((q) => ctx.PARTS[q[0]] && ctx.PARTS[q[0]].gv));
  const mr = ctx.Math.random;
  ctx.Math.random = () => 0.5;
  for (const key of keys) {
    Gm.run(ctx, '_partSeq = 1000000;');
    const ps = Gm.run(ctx, `partsFromDesign(templateRows(TEMPLATES.${key}))`), adjAll = G.buildAdjacency(ps), ctrl = G.findControlPart(ps), keep = G.componentOf(ctrl.id, adjAll), kp = ps.filter((p) => keep.has(p.id)), adj = new Map();
    for (const p of kp) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
    const v = new G.Vessel(kp, adj, G.EARTH);
    v.kind = ctx.TEMPLATES[key].kind; v.stages = G.computeStages(kp, adj, ctrl.id); v.rebuildGroups();
    v.x = G.EARTH.radius + 3000; v.y = 0; v.z = 0; v.vx = v.vy = v.vz = 0; v.q = { w: 1, x: 0, y: 0, z: 0 };
    const B = v.bodyBox, o = out[key] = { body: [B.minX, B.maxX, B.minY, B.maxY, B.minZ, B.maxZ].map(r).join(','), groups: (v.tg || []).map((g) => `${g.ring.type}:${g.members.map((p) => p.type).join('+')}:${r(g.rate)}`),
      muzzles: [], launch: [], rays: [], shots: [] }, m = { x: 0, y: 0, z: 0 }, F = sim(ctx, v), weapons = v.aimed.filter((p) => p.def.weapon);
    for (const yaw of [0, Math.PI / 2]) {
      for (const g of v.tg || []) if (!g.parent) g.ring.aimYaw = yaw;
      for (const p of weapons) { ctx.Aim.muzzle(v, p, m); o.muzzles.push(`${p.type}@${Math.round(yaw * 180 / Math.PI)}:${P(v, m.x, m.y, m.z)}`); }
    }
    for (const g of v.tg || []) g.ring.aimYaw = 0;
    for (const p of weapons) if (p.def.weapon.kind === 'tgun' || p.def.weapon.kind === 'agun') {
      C.S.shots = []; v.vx = v.vy = v.vz = 0;
      if (!ctx.Aim.shoot(v, p, F)) { o.launch.push(`${p.type}:none`); continue; }
      const s = C.S.shots[0], c = v.toLocal(v.x, v.y, v.z), d = v.toLocal(v.x + s.vx, v.y + s.vy, v.z + s.vz);
      o.launch.push(`${p.type}:${s.sh}:${P(v, s.x, s.y, s.z)}>${r(d.x - c.x)},${r(d.y - c.y)},${r(d.z - c.z)}`);
      v.vx = v.vy = v.vz = 0; v.av = { x: 0, y: 0, z: 0 };
    }
    C.S.shots = [];
    const c = v.com, top = weapons.length ? ctx.Aim.localTrunnion(v, weapons[0], { x: 0, y: 0, z: 0 }).y : B.maxY - 0.3;
    for (const y of [(B.minY + B.maxY) / 2, top]) for (let i = 0; i < 12; i++) {
      const b = (i * Math.PI) / 6, dx = Math.cos(b), dz = Math.sin(b), a = v.toWorld(c.x + dx * 20, y, (c.z || 0) + dz * 20), e = v.toWorld(c.x - dx * 20, y, (c.z || 0) - dz * 20);
      o.rays.push(ctx.Armour.hitAll(v, a, e, []).map((H) => `${H.p.type}${H.edge}@${r(H.t0)}`).join(' '));
    }
    const h = v.parts[0];
    for (const [sh, range] of [['aphe85', 500], ['apfsds120', 1000]]) {
      const S = ctx.SHELLS[sh], spd = S.v0 * Math.exp(-S.k * 1.2 * range), w = v.toWorld(h.x + h.def.w / 2 + 2, h.y, -0.3), s = { k: 'shell', sh, b: G.EARTH, x: w.x, y: w.y, z: w.z, vx: -spd, vy: 0, vz: 0, t: 1, life: 10, owner: null, cal: S.cal, pen: S.pen, v0: S.v0, n: 4242 };
      const e = v.toWorld(h.x - 30, h.y, -0.3), R = ctx.Armour.resolve(s, v, ctx.Armour.hitAll(v, w, e, []), null);
      o.shots.push(`${sh}:${R.r}:${R.crew}:${R.what.join('+')}|${R.rows.map(([p, k]) => `${p.type}=${r(k)}`).join(' ')}|${R.mods.map(([q, i, k]) => `${q.type}.${i}=${r(k)}`).join(' ')}`);
    }
  }
  ctx.Math.random = mr;
  return out;
}
check('groundcombat', groundFinger());
