// Two real tanks (test/lib/tanks.js) on the runway, with every ground-update system meeting the next as they do in a
// game: a TK-34 lays its turret and fires a real 85 mm APHE round (aim.js) that armour.js flies and resolves on a Tygr
// 300 m off; the same round against an MA-1's front; a knocked-out driver (armour.js's crew) stops the tracks (gear.js)
// until someone takes the wheel; a broken track and a destroyed engine as gear.js feels them; a knock-out stopping the
// turret, the gun, the tracking radar's lock and the missiles it guides (wire and command).
const G = require('./lib/game.js');
const T = require('./lib/tanks.js');
const t = G.checks('duel.test.js');
const ctx = G.load({ combat: true });
ctx.__tanks = T;
const R = (code) => G.run(ctx, code);

R(`
Settings.get = (k) => ({ targets: 'off', high: false })[k]; // (no range, no fighters)
var A0 = siteAngle(EARTH, EARTH.sites.runway.east), RAD = Math.PI / 180;
// a craft from rows, e m east of the runway site, turned yaw, on the ground
var tank = (rows, e, yaw) => { const ps = partsFromDesign(rows), adj = buildAdjacency(ps), v = new Vessel(ps, adj, EARTH); v.kind = 'tank'; v.stages = computeStages(ps, adj, ps[0].id); v.rebuildGroups();
  v.placeOnSurface(EARTH, A0 - (e || 0) / EARTH.radius, 0, 0, yaw || 0); return v; };
// held level alt m over the sea at angle ang, still (nothing steps its physics: it floats)
var level = (v, alt, ang) => { const r = EARTH.radius + alt; v.x = r * Math.cos(ang || 0); v.y = r * Math.sin(ang || 0); v.z = 0; v.vx = v.vy = v.vz = 0; v.av = v3();
  const S = surfaceFrame(v.x, v.y, v.z); v.q = qbasis(S.east, S.up, S.north); v.landed = false; return v; };
var build = (rows) => { const ps = partsFromDesign(rows), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'tank'; v.rebuildGroups(); return v; };
var world = (...vs) => ({ time: 0, target: null, toasts: [], broken: [], vessels: vs, active: vs[0], firing: false, mgFiring: false, groundAim: true, aim: null, zero: 800, warpIdx: 0,
  running: true, destroyed: false, camAbs: { x: 0, y: 0, z: 0 }, toast(m) { this.toasts.push(m); }, onDestroyed() { this.downs = (this.downs || 0) + 1; },
  ripParts(v, parts) { for (const p of parts) { for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.get(p.id).clear(); } v.splitComponents(); v.rebuildGroups(); },
  breakParts(v, parts) { for (const p of parts) { v.parts = v.parts.filter((q) => q !== p); for (const n of v.adj.get(p.id) || []) v.adj.get(n) && v.adj.get(n).delete(p.id); v.adj.delete(p.id); }
    if (!v.parts.length) { v.dead = true; return; } v.splitComponents(); v.rebuildGroups(); } });
// secs of frames at 60 a second (Combat.frame, then two 1/120 s steps: each vessel's physics, Combat.step)
var go = (F, secs, each) => { for (let f = 0, N = Math.round(secs * 60); f < N; f++) { if (each && each(F.time) === false) return;
  Combat.frame(F, 1 / 60); for (let i = 0; i < 2; i++) { for (const v of F.vessels) if (!v.remote && !v.wreck && !v.dead && v.parts.length) v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; } } };
// the crosshair on P, from the gunner's sight (as the HUD's aim ray would set it)
var aimAt = (F, v, P) => { const o = Aim.sightPoint(v, v3()), dx = P.x - o.x, dy = P.y - o.y, dz = P.z - o.z, d = Math.hypot(dx, dy, dz);
  F.aim = { o, dir: { x: dx / d, y: dy / d, z: dz / d }, P: { x: P.x, y: P.y, z: P.z }, d, src: 'ground', indirect: false }; };
var fwd = (v) => { const a = v.axis(1, 0, 0); return v.vx * a.x + v.vy * a.y + v.vz * a.z; };
var yawRate = (v) => { const r = v.radius(); return (v.av.x * v.x + v.av.y * v.y + v.av.z * v.z) / r; };
var partOf = (v, type) => v.parts.find((p) => p.type === type);
var hpOf = (v) => v.parts.map((p) => (p.hp == null ? -1 : p.hp) + '|' + JSON.stringify(p.mods || null) + '|' + !!p.broken).join();
var SHOT = 'b,cal,enemy,gTop,k,life,net,owner,pen,prox,ric,sh,spare,t,tracer,v0,vx,vy,vz,x,y,z'; // (spec §6.1's fields, a main gun's: not cheap)
// a TK-34 lays its gun on a target's centre of mass e m off (no dispersion: the plate is tested, not the luck of the draw)
// and fires on the trigger: what the round was, how it flew, what it did
var duel = (rows, e) => {
  const a = tank(__tanks.tk34, 0, 0), b = tank(rows, e, Math.PI), F = world(a, b); Combat.reset(F); Armour.fb.shot = null;
  go(F, 2); aimAt(F, a, b.toWorld(b.com.x, b.com.y, b.com.z || 0)); go(F, 8);
  const gun = partOf(a, 'gun85'), ring = a.tg[0].ring, h0 = hpOf(b), MS = Armour.moveShell; let flown = 0;
  Armour.moveShell = function (s) { if (s.owner === a) flown++; return MS.apply(this, arguments); };
  const v0 = { x: a.vx, y: a.vy, z: a.vz }, d = Aim.dir(a, gun, v3());
  const mr = Math.random; Math.random = () => 0; F.firing = true; Combat._t.playerFrame(F, 1 / 60); F.firing = false; Math.random = mr;
  const s = Combat.S.shots.find((q) => q.k === 'shell' && q.owner === a), keys = s ? Object.keys(s).sort().join() : '', kick = (a.vx - v0.x) * d.x + (a.vy - v0.y) * d.y + (a.vz - v0.z) * d.z, at = F.time;
  go(F, 1.5);
  Armour.moveShell = MS;
  return { keys, sh: s && s.sh, flown, gone: !Combat.S.shots.includes(s), fb: Armour.fb.shot, hurt: hpOf(b) !== h0, ko: b.ko ? b.ko.why : null, kick, shotAt: gun.shotAt === at,
    laid: Math.abs(ring.aimYaw || 0) < 0.002 && (gun._err || 0) < 0.002, reload: gun.reload > 0, ready: gun.ammo };
};
var tg = duel(__tanks.tygr, 300), ab = duel(__tanks.ma1, 300);
`);
t('the TK-34 lays its turret and gun on a Tygr 300 m off, and fires on the trigger: an 85 mm APHE round with exactly the fields of a shell',
  R(`tg.laid && tg.keys === SHOT && tg.sh === 'aphe85' && tg.shotAt && tg.reload && tg.ready === 5`), R('[tg.laid, tg.keys, tg.sh, tg.shotAt, tg.reload, tg.ready]'));
t('...the gun kicks the hull back along the barrel', R('tg.kick < -0.05'), R('tg.kick'));
t('...armour.js flies the round (Armour.moveShell, step by step) and it ends on the Tygr, resolved: it goes through, and hurts it',
  R(`tg.flown >= 40 && tg.gone && !!tg.fb && tg.fb.r === 'pen' && tg.hurt`), R('({ flown: tg.flown, fb: tg.fb, hurt: tg.hurt, ko: tg.ko })'));
t('the same round against an MA-1\'s front: it doesn\'t go through, and nobody inside is hurt',
  R(`ab.flown >= 40 && ab.gone && !!ab.fb && (ab.fb.r === 'nopen' || ab.fb.r === 'ric') && !ab.fb.crew && !ab.ko`), R('({ fb: ab.fb, ko: ab.ko })'));

R(`var dv = tank(__tanks.tk34, 0, 0), DF = world(dv); Combat.reset(DF); DF.groundAim = false; go(DF, 1);
go(DF, 3, () => { dv.ctl.v = 1; }); var dv1 = fwd(dv);
var hull = dv.parts[0]; Armour.modDamage(dv, hull, hull.def.mods.findIndex((m) => m.role === 'driver'), 1000, DF, null);
var dHas = Armour.has(dv, 'driver'), dPow = [];
go(DF, 2, () => { dv.ctl.v = 1; dPow.push(dv.drivePower); }); var dv2 = fwd(dv), dHas2 = Armour.has(dv, 'driver');
go(DF, 4, () => { dv.ctl.v = 1; }); var dv3 = fwd(dv), dHas3 = Armour.has(dv, 'driver');`);
t('a knocked-out driver: the tracks lose their power at once (W held) and the tank rolls to a stop',
  R(`dv1 > 6 && !dHas && dPow.slice(1).every((w) => w === 0) && dv2 < dv1 - 2 && !dHas2`), R('({ dv1, dv2, dHas, pow: Math.max(...dPow.slice(1)) })'));
t('...until another crewman takes the wheel (4 s later) and it drives again', R(`dHas3 && dv3 > dv2 + 1 && DF.toasts.some((m) => /takes the wheel/.test(m))`), R('({ dv3, toasts: DF.toasts })'));
R(`var drive = (what) => {
  const v = tank(__tanks.tk34, 0, 0), F = world(v); Combat.reset(F); F.groundAim = false; go(F, 1);
  if (what) Armour.moduleDown(v, v.parts.find(what), 'shot', F);
  let yaw = 0; go(F, 4, () => { v.ctl.v = 1; yaw += yawRate(v) / 60; });
  return { v: fwd(v), yaw, toasts: F.toasts };
};
var dOk = drive(null), dTr = drive((p) => p.type === 'trackMed' && partZ(p) > 0), dEn = drive((p) => p.type === 'engDiesel');`);
t('a broken right track (armour.js) drags that side (gear.js): the tank swings hard right, slower, and says so',
  R(`Math.abs(dOk.yaw) < 0.01 && dTr.yaw < -1 && dTr.v < dOk.v && dTr.toasts.includes('Right track broken')`), R('[dOk, dTr]'));
t('a destroyed engine: no power, it doesn\'t move', R(`Math.abs(dEn.v) < 0.1 && dEn.toasts.includes('Engine destroyed')`), R('dEn'));

R(`var kv = tank(__tanks.tk34, 0, 0), KF = world(kv); Combat.reset(KF); go(KF, 1);
aimAt(KF, kv, kv.toWorld(0, 2, 800)); go(KF, 0.5); Armour.knockOut(kv, KF, 'crew');
var ky0 = kv.tg[0].ring.aimYaw; go(KF, 2); var ky1 = kv.tg[0].ring.aimYaw;
var kFire = Aim.fire(kv, Combat.systems(kv)[kv.wsel], 1 / 120, KF); KF.firing = true; Combat._t.playerFrame(KF, 1 / 60); KF.firing = false;
var kShells = Combat.S.shots.filter((s) => s.k === 'shell').length;`);
t('knocked out: the turret stops where it was, the gun won\'t fire (no round leaves), the game is told once',
  R(`!!kv.ko && ky1 === ky0 && !kFire && kShells === 0 && KF.downs === 1 && !Armour.has(kv, 'gunner')`), R('({ ko: kv.ko, turned: ky1 - ky0, kFire, kShells, downs: KF.downs })'));
R(`var bandit = (alt, ang) => { const ps = RAIDER.map(([ty, x, y, rot]) => makePart(ty, x, y, { flip: x < 0, rot: rot || 0 })), b = new Vessel(ps, buildAdjacency(ps), EARTH);
  b.kind = 'plane'; b.rebuildGroups(); level(b, alt, ang); b.ai = { t: 0, down: false }; for (const p of b.parts) if (p.def.thrust) { p.active = true; p.firing = 1; } return b; };
var SAMV = [{ type: 'hullWheeled', x: 0, y: 1.2, flip: false, rot: 0 }, { type: 'samCmd', x: 0.5, y: 2.55, flip: false, rot: 3, att: 0 }, { type: 'radarTrack', x: -1.5, y: 2.4, flip: false, rot: 0, att: 0 }];
var sv = level(build(SAMV), 200, 0), sb = bandit(700, -3000 / (EARTH.radius + 200)), SF = world(sv, sb); Combat.reset(SF);
var fly = (h) => { sb.x += sb.vx * h; sb.y += sb.vy * h; sb.z += sb.vz * h; aimAt(SF, sv, { x: sb.x, y: sb.y, z: sb.z }); };
var Su = surfaceFrame(sv.x, sv.y, sv.z); sb.vx = -Su.east.x * 150; sb.vy = -Su.east.y * 150; sb.vz = -Su.east.z * 150;
var step = (secs) => { for (let i = 0, n = Math.round(secs * 120); i < n; i++) { fly(1 / 120); if (i % 4 === 0) Aim.radarStep(sv, SF, 4 / 120); Combat.step(1 / 120, SF); SF.time += 1 / 120; } };
fly(0); Aim.lockKey(sv); step(1.5); var sLock = Aim.lockTarget(sv) === sb;
Combat.launchMissile(sv, partOf(sv, 'samCmd'), Aim.lockTarget(sv), SF); var sm = Combat.S.shots[Combat.S.shots.length - 1]; step(0.5); var sGuided = sm.clos && sm.target === sb;
Armour.knockOut(sv, SF, 'crew'); step(0.2); var sLost = Aim.lockTarget(sv); step(1.2); var sDumb = sm.target;
var ATGM = [{ type: 'hullLight', x: 0, y: 1.0, flip: false, rot: 0 }, { type: 'atgmWire', x: 0, y: 1.75, flip: false, rot: 3, att: 0 }];
var wv = level(build(ATGM), 300, 0), WF = world(wv); Combat.reset(WF); WF.groundAim = false;
Aim.fire(wv, Combat.systems(wv)[0], 1 / 120, WF); var wm = Combat.S.shots[Combat.S.shots.length - 1];
for (let i = 0; i < 120; i++) { Combat.step(1 / 120, WF); WF.time += 1 / 120; } var wOn = !!wm.saclos && !wm.cut;
Armour.knockOut(wv, WF, 'crew'); for (let i = 0; i < 3; i++) { Combat.step(1 / 120, WF); WF.time += 1 / 120; } var wCut = !!wm.cut;`);
t('knocked out with a missile in the air: the tracking radar lets go of its lock and the command-guided SAM flies on dumb a second later',
  R(`sLock && sGuided && sLost === null && sDumb === null`), R('({ sLock, sGuided, lost: sLost === null, dumb: sDumb === null })'));
t('...and a wire-guided missile\'s wire is cut', R('wOn && wCut'), R('[wOn, wCut]'));

// a saved flight keeps what the stores have left (armour.js keeps them on the parts: a rack's p.rounds, a host's
// built-in stores in p.mrounds), read back within each store's size
R(`var rv = tank(__tanks.tk34.concat([{ type: 'ammoRack', x: -0.6, y: 2.3, flip: false, rot: 0, att: 5 }]), 0, 0), RS = Armour.crewOf(rv).stores;
RS.forEach((e, i) => { e.rounds = i + 3; }); var left = RS.map((e) => e.rounds).join();
var back = Vessel.restore(JSON.parse(JSON.stringify(rv.serialize()))); back.kind = 'tank'; back.rebuildGroups(); var kept = Armour.crewOf(back).stores.map((e) => e.rounds).join();
var forged = JSON.parse(JSON.stringify(rv.serialize())); forged.parts[0].mrounds = [1e9, 'x', -5, 7, NaN]; forged.parts.find((q) => q.type === 'ammoRack').rounds = 1e9; // (the hull's one store is its 3rd module)
var fv = Vessel.restore(forged); fv.kind = 'tank'; fv.rebuildGroups(); var fRounds = Armour.crewOf(fv).stores.map((e) => e.rounds).join(), fRaw = JSON.stringify(fv.parts[0].mrounds);`);
// ...and who has taken a dead man's seat, or is about to
R(`var save = (v) => { const b = Vessel.restore(JSON.parse(JSON.stringify(v.serialize()))); b.kind = 'tank'; b.rebuildGroups(); return b; };
var sw1 = save(dv), sw1Has = Armour.has(sw1, 'driver'), sw1Roles = JSON.stringify(sw1.parts.find((p) => p.type === 'turretCast').roles);
var pv = tank(__tanks.tk34, 0, 0), PF = world(pv); Combat.reset(PF); go(PF, 0.5); var ph = pv.parts[0];
Armour.modDamage(pv, ph, ph.def.mods.findIndex((m) => m.role === 'driver'), 1000, PF, null); go(PF, 1);
var sw2 = save(pv), sw2Pend = JSON.stringify(sw2.swaps), PF2 = world(sw2); Combat.reset(PF2); var sw2Before = Armour.has(sw2, 'driver'); go(PF2, 3.5); var sw2After = Armour.has(sw2, 'driver');
var forgedSw = JSON.parse(JSON.stringify(pv.serialize())); forgedSw.swaps = [{ role: 'pilot', t: 1 }, { role: 'gunner', t: 1e9 }, null]; forgedSw.parts[5].roles = ['king', 'driver', 7];
var sw3 = Vessel.restore(forgedSw), sw3s = JSON.stringify(sw3.swaps), sw3r = JSON.stringify(sw3.parts[5].roles);`);
t('a saved flight keeps who took the dead driver\'s seat; a seat still waiting is filled after the restore; forged roles and swaps are dropped',
  R(`sw1Has && sw1Roles === '[null,null,"driver",null]' && /"driver"/.test(sw2Pend) && !sw2Before && sw2After && sw3s === '[{"role":"gunner","t":4}]' && sw3r === '[null,"driver",null,null]'`),
  R('({ sw1Has, sw1Roles, sw2Pend, sw2Before, sw2After, sw3s, sw3r })'));
t('a saved flight keeps each store\'s rounds (racks and built-in); forged counts are kept to the store\'s size',
  R(`RS.length === 2 && kept === left && fRounds === '0,20' && fRaw === '[null,null,0,null,null]'`), R('({ left, kept, fRounds, fRaw })'));

t.done();
