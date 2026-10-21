// Physics of parts with a depth (z), attach links (att) and paint (skin): side thrust and its torque, the centre of
// mass across, the full inertia tensor (against a brute-force sum) and its inverse, the hull, propeller torque on
// either wing, an off-centre parachute, saving and restoring a flight (and cleaning bad saves), debris splitting off
// where it was, and reentry heating of the windward copy.   node test/physics.test.js
const G = require('./lib/game.js');
const ctx = G.load();
const R = (code) => G.run(ctx, code);
const t = G.checks('physics: depth, attach and paint');
R(`var _tpl = (k) => TEMPLATES[k].parts.map(([type, x, y, rot]) => ({ type, x, y, flip: x < 0, rot: rot || 0 }));
var _sim = () => ({ time: 0, toasts: [], toast(m) { this.toasts.push(m); }, breakParts() {}, ripParts() {} });
// as Flight.start builds a craft from a design
var craft = (rows, kind = 'plane') => {
  const parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
  const ps = parts.filter((p) => keep.has(p.id));
  for (const p of ps) if (p.att != null && !keep.has(p.att)) p.att = null;
  const adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const v = new Vessel(ps, adj, EARTH); v.kind = kind; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups();
  v.of = parts.length;
  return v;
};
var hornet = _tpl('hornet'); // 0 jet, 3 wingSwept (x 0.2, y 5.3, span 11)
var jetAt = (z) => ({ type: 'jet', x: 1.2, y: 5.0, flip: false, rot: 0, z, att: 3 });
var only = (v, list) => { for (const p of v.parts) p.active = list.includes(p); };
var engines = (v) => v.parts.filter((p) => p.def.thrust);`);

// --- (b1) a single jet out on the right wing (z = +4) yaws the nose away from it (left) -------------------
R(`var v1 = craft([...hornet, jetAt(4)]); var side = v1.parts.find((p) => p.type === 'jet' && p.z === 4);
only(v1, [side]); var cz1 = v1.com.z, E1 = v1.applyEngines(1 / 120, 1.2, v3(0, 100, 0), _sim());`);
t('single side jet is kept (att to the wing)', R('v1.parts.length === v1.of && side.att === v1.parts.find((p) => p.type === "wingSwept").id'));
t('it fires', R('E1.F.y > 50000'), R('E1.F.y.toFixed(0)'));
t('com.z moves towards it by m*z/M', R('Math.abs(v1.com.z - partKg(side) * 4 / v1.mass) < 1e-12'), R('v1.com.z.toFixed(5)'));
t('T.x = -(z - com.z) * F (r x F)', R('Math.abs(E1.T.x + (4 - cz1) * E1.F.y) < 1e-9 * E1.F.y'), R('E1.T.x.toFixed(0)'));
t('T.y = 0 (thrust has no x part)', R('E1.T.y === 0'));
t('T.x < 0: about part x (down) that turns the nose (+y) towards -z, the left wing: away from the engine', R('E1.T.x < 0'));
// the pilot frame says the same: yaw (+ nose right) = -wb.U, U = -x for planes
t('pilot yaw for -T.x is nose left', R('(() => { const P = PILOT.plane; return -(P.U.x * -1) < 0; })()'));
// fly it: the same plane in the air, with and without the side jet lit, a third of a second
R(`var flyYaw = (lit) => {
  const v = craft([...hornet, jetAt(4)]), s = _sim();
  v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[VEHICLE_KINDS.plane.site].east), VEHICLE_KINDS.plane.launchRot);
  const R2 = v.radius() + 2000, w = { x: v.x / v.radius(), y: v.y / v.radius() };
  v.x = w.x * R2; v.y = w.y * R2; v.landed = false; v.vx = w.y * 110; v.vy = -w.x * 110; v.gearUp = true; v.sas = 'off';
  only(v, lit ? engines(v) : engines(v).filter((p) => p.z !== 4));
  for (let i = 0; i < 40; i++) v.physicsStep(1 / 120, s);
  const wb = v.bodyAV(); return -dot3(wb, v.pilot.U);
};
var yawOn = flyYaw(true), yawOff = flyYaw(false);`);
t('in flight, lighting the right-wing jet swings the nose left (yaw rate lower)', R('yawOn < yawOff'), R('[yawOn.toFixed(4), yawOff.toFixed(4)].join(" vs ")'));

// --- (b2) a mirrored pair (z = +4 and -4) gives no lateral torque ----------------------------------------
R(`var v2 = craft([...hornet, jetAt(4), jetAt(-4)]); var pair = v2.parts.filter((p) => p.type === 'jet' && p.z);
only(v2, pair); var E2 = v2.applyEngines(1 / 120, 1.2, v3(0, 100, 0), _sim());`);
t('mirrored pair: com.z = 0', R('v2.com.z === 0'));
t('mirrored pair: T.x = T.y = 0', R('E2.T.x === 0 && E2.T.y === 0'), R('[E2.T.x, E2.T.y, E2.T.z.toFixed(0)].join(" ")'));
t('mirrored pair: I.xz = I.yz = 0', R('v2.I.xz === 0 && v2.I.yz === 0'));
t('mirrored pair: thrust twice the single', R('Math.abs(E2.F.y - 2 * E1.F.y) < 1e-6 * E1.F.y'));

// --- (b3) com.z for an off-centre heavy store, and the inertia against a brute-force sum over copies ----
R(`var v3c = craft([...hornet, { type: 'bombL', x: 1.0, y: 5.5, flip: false, rot: 0, z: -3, att: 3 }]); var bomb = v3c.parts.find((p) => p.type === 'bombL');`);
t('heavy bomb at z = -3: com.z = m*z/M', R('Math.abs(v3c.com.z - partKg(bomb) * -3 / v3c.mass) < 1e-12'), R('v3c.com.z.toFixed(5)'));
R(`var brute = (v) => { // each copy a point mass pm/n plus the part's own box
  const c = v.com, I = { xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 };
  for (const p of v.parts) {
    const pm = partKg(p), { w, h } = partDims(p), d = partDepth(p), tr = p.def.wheel ? (p.def.wheel.track || 0) / 2 : 0;
    const zs = tr ? [partZ(p) - tr, partZ(p) + tr] : partZs(p), mk = pm / zs.length;
    I.xx += pm * (h * h + d * d) / 12; I.yy += pm * (w * w + d * d) / 12; I.zz += pm * (w * w + h * h) / 12;
    for (const z of zs) { const dx = p.x - c.x, dy = p.y - c.y, dz = z - c.z;
      I.xx += mk * (dy * dy + dz * dz); I.yy += mk * (dx * dx + dz * dz); I.zz += mk * (dx * dx + dy * dy); I.xy -= mk * dx * dy; I.xz -= mk * dx * dz; I.yz -= mk * dy * dz; }
  }
  return I;
};
var relErr = (v) => { const B = brute(v), s = Math.max(v.I.xx, v.I.yy, v.I.zz); return Math.max(...['xx', 'yy', 'zz', 'xy', 'xz', 'yz'].map((k) => Math.abs(B[k] - v.I[k]) / s)); };`);
t('asymmetric craft: I matches a per-copy brute-force sum', R('relErr(v3c) < 1e-12 && relErr(v1) < 1e-12'), R('relErr(v3c).toExponential(2)'));
t('asymmetric craft: Ixz and Iyz are not zero', R('v3c.I.xz !== 0 && v3c.I.yz !== 0'), R('[v3c.I.xz.toFixed(1), v3c.I.yz.toFixed(1)].join(" ")'));
t('stock template: I matches the brute-force sum too (twins and wheel pairs)', R('relErr(craft(_tpl("bomber"))) < 1e-12 && relErr(craft(_tpl("falcon"))) < 1e-12'));

// --- (b4) the 3x3 inverse --------------------------------------------------------------------------------
R(`var invErr = (v) => { const I = v.I, A = [[I.xx, I.xy, I.xz], [I.xy, I.yy, I.yz], [I.xz, I.yz, I.zz]], B = [[I.ixx, I.ixy, I.ixz], [I.ixy, I.iyy, I.iyz], [I.ixz, I.iyz, I.izz]];
  let e = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += B[i][k] * A[k][j]; e = Math.max(e, Math.abs(s - (i === j ? 1 : 0))); } return e; };
var alias = (v) => { const a = v3(0.3, -1.2, 0.7), o = v3(a.x, a.y, a.z); v.mulInvI(v.mulI(o, o), o); return Math.max(Math.abs(o.x - a.x), Math.abs(o.y - a.y), Math.abs(o.z - a.z)); };`);
for (const k of ['v1', 'v3c', 'craft(_tpl("jumbo"))', 'craft(_tpl("ares"), "rocket")']) {
  t(`I^-1 * I = identity (${k})`, R(`invErr(${k}) < 1e-12`), R(`invErr(${k}).toExponential(2)`));
}
t('mulI/mulInvI with o === v round-trip', R('alias(v3c) < 1e-12 && alias(v1) < 1e-12'), R('alias(v3c).toExponential(2)'));
t('positive definite: the Schur complement > 0', R('v3c.I.izz > 0 && v1.I.izz > 0'));

// --- hull, reach, toWorld/toLocal, ground ----------------------------------------------------------------
t('the side jet has its own contact points out at z ~ 4', R('v1.hull.filter((k) => k.p === side).every((k) => Math.abs(k.z - 4) <= 0.75 + 1e-9) && v1.hull.some((k) => k.p === side)'));
t('reach covers it (from the centre of mass)', R('v1.hull.every((k) => Math.hypot(k.x - v1.com.x, k.y - v1.com.y, k.z - v1.com.z) <= v1.reach)'));
t('a twin pair keeps its points at +-z (fanPods on the bomber)', R(`(() => { const v = craft(_tpl('bomber')); const pp = v.hull.filter((k) => k.p.type === 'fanPods'); return pp.some((k) => k.z > 5) && pp.some((k) => k.z < -5); })()`));
t('bounds and depth across', R('v1.bounds.maxZ >= 5.5 && v1.depth === v1.bounds.maxZ - v1.bounds.minZ'), R('[v1.bounds.minZ, v1.bounds.maxZ].join("..")'));
t('toLocal(toWorld(p)) = p with com.z != 0', R(`(() => { v1.q = qnorm(quat(0.9, 0.2, -0.3, 0.1)); const w = v1.toWorld(1, 2, 3), l = v1.toLocal(w.x, w.y, w.z); return Math.hypot(l.x - 1, l.y - 2, l.z - 3) < 1e-9; })()`));
t('toWorld(com) is the vessel position', R(`(() => { const w = v1.toWorld(v1.com.x, v1.com.y, v1.com.z); return Math.hypot(w.x - v1.x, w.y - v1.y, w.z - v1.z) < 1e-6; })()`));
t('placed on the runway, an asymmetric craft rests at groundAltitude ~ 0.02', R(`(() => { const v = craft([...hornet, jetAt(4)]); v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[VEHICLE_KINDS.plane.site].east), VEHICLE_KINDS.plane.launchRot); return Math.abs(v.groundAltitude() - 0.02) < 1e-6; })()`));
t('the nose (noseSharp) is the centreline cockpit, not a forward pod', R(`(() => { const v = craft([...hornet, { type: 'aam', x: 0.9, y: 11.5, flip: false, rot: 0, z: 4, att: 3 }]); return v.noseSharp === craft(hornet).noseSharp && v.noseAero; })()`));

// --- props: a single propeller's reaction torque flips on the left wing, so a mirrored pair cancels ------
R(`var sky = _tpl('skylark'); // 4 propeller, 4 wing at x -0.85 y 3.6
var propAt = (z) => ({ type: 'propS', x: -0.85, y: 4.6, flip: true, rot: 0, z, att: 4 });
var propT = (zs) => { const v = craft([...sky, ...zs.map(propAt)]), pp = v.parts.filter((p) => p.type === 'propS'); only(v, pp); return [v, v.applyEngines(1 / 120, 1.2, v3(0, 60, 0), _sim())]; };
var [vp1, P1] = propT([3]), [vp2, P2] = propT([-3]), [vp3, P3] = propT([3, -3]);`);
t('props kept', R('vp3.parts.filter((p) => p.type === "propS").length === 2'));
t('one prop at +3: torque about the thrust axis (T.y) from the twist', R('P1.T.y !== 0'), R('P1.T.y.toFixed(1)'));
t('its mirror image twists the other way', R('Math.abs(P1.T.y + P2.T.y) < 1e-9 * Math.abs(P1.T.y)'), R('P2.T.y.toFixed(1)'));
t('a mirrored pair cancels: T.x = T.y = 0', R('Math.abs(P3.T.x) < 1e-9 && Math.abs(P3.T.y) < 1e-9'), R('[P3.T.x, P3.T.y].join(" ")'));

// --- the chute's pull off the centreline (r x F) -----------------------------------------------------------
R(`var chuteT = (z) => {
  const v = craft([{ type: 'pod', x: 0, y: 0, flip: false, rot: 0 }, { type: 'chute', x: 0, y: 1.25, flip: false, rot: 0, z }], 'rocket');
  const ch = v.parts.find((p) => p.def.chute); ch.deployed = 1;
  v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[VEHICLE_KINDS.rocket.site].east), 0);
  const r = v.radius() + 3000, u = { x: v.x / v.radius(), y: v.y / v.radius() }; v.x = u.x * r; v.y = u.y * r; v.landed = false;
  v.q = qnorm(quat(0.95, 0.1, 0.2, 0.15)); v.vx = 40; v.vy = -60; v.vz = 25; v.av = v3(); v.isDebris = true;
  const s = _sim(), T0 = v.av; v.physicsStep(1 / 1000, s); return [v, v.bodyAV()];
};
var [cv0, w0] = chuteT(0), [cv1, w1] = chuteT(0.3);`);
t('an off-centre chute moves com.z', R('cv1.com.z > 0 && cv0.com.z === 0'));
t('and turns the craft differently (lateral term acts)', R('Math.abs(w1.x - w0.x) + Math.abs(w1.y - w0.y) > 1e-4'), R('[w0.x, w0.y, w0.z, w1.x, w1.y, w1.z].map((x) => x.toFixed(4)).join(" ")'));
// check the hand-written lateral term against r x F with F = -h
R(`var lat = (() => { const rz = 0.7, hx = 0.3, hy = -0.5, hz = 0.81, K = 2; // pull per metre of lever
  const T = { x: 0, y: 0, z: 0 }, side = K * rz; T.x += hy * side; T.y -= hx * side;
  const F = { x: -hx * K, y: -hy * K, z: -hz * K }, rx = 0, ry = 0; // the z lever alone
  const C = { x: ry * F.z - rz * F.y, y: rz * F.x - rx * F.z };
  return Math.abs(T.x - C.x) + Math.abs(T.y - C.y); })();`);
t('the chute\'s lateral torque terms equal r x F (F against the flow)', R('lat < 1e-12'));

// --- serialize / restore ----------------------------------------------------------------------------------
R(`var vs = craft([...hornet, jetAt(4), jetAt(-4), { type: 'aam', x: 0.9, y: 5.4, flip: false, rot: 0, z: 3.2, att: 3, skin: 'stealth' }]);
vs.parts.find((p) => p.type === 'wingSwept').skin = 'navy';
var S = JSON.parse(JSON.stringify(vs.serialize())), vr = Vessel.restore(S);
var key = (p) => [p.id, p.type, p.z, p.att, p.skin].join('/');`);
t('serialize writes z, att and skin', R('S.parts.every((q) => "z" in q && "att" in q && "skin" in q)'));
t('restore keeps them all', R('vs.parts.map(key).join() === vr.parts.map(key).join()'), R('vr.parts.filter((p) => p.att != null || p.skin).map(key).join(" ")'));
t('restore keeps com.z and I', R('vr.com.z === vs.com.z && vr.I.xz === vs.I.xz'));
R(`var S2 = JSON.parse(JSON.stringify(S)); S2.parts[0].z = 1e9; S2.parts[3].skin = '__proto__'; S2.parts[4].att = 999999; S2.parts[5].att = S2.parts[5].id;
var aamI = S2.parts.findIndex((q) => q.type === 'aam'); S2.parts[aamI].z = -0.01; delete S2.parts[1].z;
var w = S2.parts.findIndex((q) => q.type === 'wingSwept'); S2.parts[w].att = S2.parts[aamI].id; // a loop: wing -> aam -> wing
var vb2 = Vessel.restore(S2), P2 = (i) => vb2.parts[i];`);
t('restore cleans z (clamped, twins kept apart, missing z gets the default)', R(`P2(0).z === 20 && vb2.parts[aamI].z >= twinMinZ(PARTS.aam) && P2(1).z === partDefaultZ(P2(1).def)`), R('[P2(0).z, vb2.parts[aamI].z, P2(1).z].join(" ")'));
t('restore cleans skin', R('P2(3).skin === null'));
t('restore drops att to a part not in the vessel, or to itself', R('P2(4).att === null && P2(5).att === null'));
t('restore breaks att loops', R('(vb2.parts[w].att == null) !== (vb2.parts[aamI].att == null)'));
t('old saves (no z/att/skin) restore to defaults', R(`(() => { const S3 = JSON.parse(JSON.stringify(S)); for (const q of S3.parts) { delete q.z; delete q.att; delete q.skin; } const v = Vessel.restore(S3); return v.parts.every((p) => p.z === partDefaultZ(p.def) && p.att === null && p.skin === null) && v.com.z === 0; })()`));

// --- splitting: debris lands where it was ---------------------------------------------------------------
R(`var vd = craft([...hornet, jetAt(4)]); vd.q = qnorm(quat(0.8, 0.3, -0.2, 0.4)); vd.av = v3(0.2, -0.1, 0.3);
var ck0 = vd.parts.find((p) => p.def.control), ckW = vd.toWorld(ck0.x, ck0.y, 0);
var sj = vd.parts.find((p) => p.type === 'jet' && p.z === 4), before = vd.toWorld(sj.x, sj.y, partZc(sj)), vb4 = vd.pointVel(qrot(vd.q, sj.x - vd.com.x, sj.y - vd.com.y, 4 - vd.com.z));
for (const n of [...vd.adj.get(sj.id)]) { vd.adj.get(sj.id).delete(n); vd.adj.get(n).delete(sj.id); }
var pieces = vd.splitComponents(), deb = pieces[0], after = deb && deb.toWorld(sj.x, sj.y, partZc(sj));`);
t('the cut jet flies off as debris', R('pieces.length === 1 && deb.parts.length === 1'));
t('debris starts exactly where the jet was', R('Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) < 1e-6'), R('Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z).toExponential(2)'));
t('with the velocity of that point', R('Math.hypot(deb.vx - vb4.x, deb.vy - vb4.y, deb.vz - vb4.z) < 1e-9'));
t('the craft left behind does not jump (its com moved across)', R(`(() => { const a = vd.toWorld(ck0.x, ck0.y, 0); return vd.com.z === 0 && Math.hypot(a.x - ckW.x, a.y - ckW.y, a.z - ckW.z) < 1e-6; })()`));

// --- heat: the windward copy of a pair leads ---------------------------------------------------------------
R(`var vh = craft(_tpl('bomber')); var fp = vh.parts.find((p) => p.type === 'fanPods');
vh.updateHeat(1 / 120, 0.02, 3000, v3(0, 0, 3000), _sim()); var leadSide = fp._lead;
vh.updateHeat(1 / 120, 0.02, 3000, v3(0, 0, -3000), _sim()); var leadOther = fp._lead;`);
t('flow from the side: a pod pair at its usual spread leads the same either way, with nothing added for its offset (as before depth existed)',
  R('Math.abs(leadSide - leadOther) < 1e-9 && leadSide < partZ(fp)'), R('leadSide.toFixed(2)'));
R(`fp.z = fp.def.twinZ + 2; vh.updateHeat(1 / 120, 0.02, 3000, v3(0, 0, 3000), _sim()); var leadOut = fp._lead;
vh.updateHeat(1 / 120, 0.02, 3000, v3(0, 0, -3000), _sim()); var leadOut2 = fp._lead;`);
t('the same pair moved 2 m further out leads by those 2 m more, from either side', R('Math.abs(leadOut - leadSide - 2) < 1e-9 && Math.abs(leadOut2 - leadOut) < 1e-9'), R('[leadSide.toFixed(2), leadOut.toFixed(2)].join(" -> ")'));
R(`var vh2 = craft([...hornet, jetAt(4)]); var sj2 = vh2.parts.find((p) => p.type === 'jet' && p.z === 4);
vh2.updateHeat(1 / 120, 0.02, 3000, v3(0, 0, 3000), _sim()); var la = sj2._lead; vh2.updateHeat(1 / 120, 0.02, 3000, v3(0, 0, -3000), _sim()); var lb = sj2._lead;`);
t('a single jet on the right wing leads only when the flow comes from the right', R('la - lb > 7.9'), R('[la.toFixed(2), lb.toFixed(2)].join(" vs ")'));

t.done();
