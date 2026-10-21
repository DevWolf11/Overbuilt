// Combat with parts at a depth: hit boxes and rounds for twin pods at +-z, blasts, a destroyed pair exploding at both
// pods, rocket pods rippling across, guns converging, missiles and bombs alternating sides, the AI raider, paint
// never touching radar. Then a fingerprint of every stock plane (hit boxes, muzzles, blast damage around the craft,
// where gun rounds go, flares and turret rounds) against test/baseline/combat.json.
//   node test/combat.test.js [--update]
const Gm = require('./lib/game.js'), { check } = require('./lib/baseline.js');
const ctx = Gm.load({ combat: true }), C = ctx.Combat, T = C._t, G = ctx;
ctx.Math.random = () => 0.5; // no gun spread
const r3 = (x) => +x.toFixed(3);
const t = Gm.checks('combat: depth');
const ok = (c, msg) => t(msg, c);
// a vessel from rows [type, x, y, rot, extra], level at 3 km over the sea, identity attitude; whole: keep loose parts
function craft(ctx, rows, kind = 'plane', whole) {
  const parts = rows.map(([type, x, y, rot, o]) => G.makePart(type, x, y, Object.assign({ flip: x < 0, rot: rot || 0 }, o || {})));
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
t.done();

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
    // turret rounds
    for (const p of v.parts) if (p.def.weapon && p.def.weapon.kind === 'turret') { C.S.shots = []; p.cool = 0; T.turretFire(v, p, 0.01, F, false, false); const s = C.S.shots[0], l = v.toLocal(s.x, s.y, s.z); o.flares.push(`turret ${r(l.x)},${r(l.y)},${r(l.z)}`); }
  }
  return out;
}
check('combat', finger());
