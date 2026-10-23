// Warning receivers, missiles in sight and turrets on the ground. A missile homing on a craft is heard only with a
// warning receiver (RWR) on board: the basic one says that one is coming, the threat display also what kind, from where
// and what to do. Flying solo, countermeasures go out by themselves only with one (everything with the basic one, the
// right decoy with the display). In a room heat seekers are heard too now, and a missile that turns on us after its
// launch is heard from then. Every hostile missile in sight within 4 km gets a marker. A turret holds its fire while its
// craft touches the ground or the water. And the stock military planes carry theirs within their battle budgets.
//   node test/rwr.test.js
const Gm = require('./lib/game.js');
const ctx = Gm.load({ combat: true }), C = ctx.Combat, T = C._t;
ctx.Math.random = () => 0.5;
const t = Gm.checks('rwr: warning receivers, missiles in sight, turrets on the ground');
const rows = (key) => Gm.templateRows(ctx, key);
const without = (rs, test) => rs.filter((r) => !test(ctx.PARTS[r.type || r[0]]));
// a craft in the air (3 km up, level, still) as the player's, and the stand-in for Flight
function scene(rs, kind = 'plane') {
  const v = Gm.craft(ctx, rs, kind, 'air'), F = Gm.sim();
  Object.assign(F, { running: true, active: v, vessels: [v], warpIdx: 0, destroyed: false, firing: false, camAbs: null });
  C.reset(F); C.S.fighterT = 1e9;
  return { v, F };
}
// a missile d metres off the nose (in part space: along +y), flying at it at 600 m/s; homing on `target`
function missile(v, d, kind, target, extra) {
  const f = v.axis(0, 1, 0), radar = kind === 'radar';
  return { k: 'missile', b: v.body, x: v.x + f.x * d, y: v.y + f.y * d, z: v.z + f.z * d, vx: -f.x * 600, vy: -f.y * 600, vz: -f.z * 600, dx: -f.x, dy: -f.y, dz: -f.z,
    t: 1, life: 60, burn: 0, accel: 0, vmax: 900, turn: 25, dmg: 300, blast: 13, seek: 'air', heat: kind === 'heat', radar, target, owner: {}, enemy: true,
    ...T.airframe({ seek: 'air', radar }), ...(extra || {}) };
}
const kinds = () => C.S.flares.map((f) => (f.flare ? 'flare' : f.str > 1 ? 'bundle' : 'cloud')).join(',');
// one combat frame (the warner and the solo countermeasures run there)
const frame = (F, n = 1) => { for (let i = 0; i < n; i++) { F.time += 1 / 30; C.frame(F, 1 / 30); } };
const SOLO = 21; // (0.7 s: solo countermeasures go out at most every 0.6 s)

// 1. the parts
const P = ctx.PARTS;
t('two warning receivers in the weapons tab: basic (1) and with a threat display (2), round fairings', P.rwr.rwr === 1 && P.rwrPlus.rwr === 2 && P.rwr.cat === 'weapons' && P.rwrPlus.cat === 'weapons'
  && Gm.run(ctx, `clashShape(PARTS.rwr, false).round && clashShape(PARTS.rwrPlus, false).round`), [P.rwr.cost, P.rwrPlus.cost]);
t('the small turret is retired (old designs keep it, as it was); the manned one is bigger', P.turret.retired && P.turret.w === 1 && P.turret.h === 1.4 && !P.turretL.retired
  && P.turretL.w > P.turret.w && P.turretL.h > P.turret.h && JSON.stringify(P.turretL.weapon) === JSON.stringify(P.turret.weapon));
t('an old design with the small turret still loads it', Gm.run(ctx, `partsFromDesign([{ type: 'turret', x: -2, y: 13.5 }])[0].type === 'turret'`));

// 2. no warning receiver: nothing heard, nothing fired by itself
const FS16 = rows('fs16'), BARE = without(FS16, (d) => d.rwr), FALCON = rows('falcon');
{
  const { v, F } = scene(BARE);
  C.S.shots.push(missile(v, 1500, 'heat', v), missile(v, 1800, 'radar', v));
  frame(F, SOLO);
  t('no RWR: a heat seeker and a radar missile at 1.5 km homing on the craft go unheard', C.S.rwr === 0 && !C.S.warn && !C.S.threats.length);
  t('no RWR: flying solo, no flares or chaff go out by themselves', C.S.flares.length === 0, kinds());
  t('no RWR: the flares and chaff are still there for K', C.countermeasures(v, F) && kinds() === 'flare,flare,bundle', kinds());
}
// 3. the basic one: heard, not told apart; solo, it drops everything
{
  const { v, F } = scene(FALCON);
  C.S.shots.push(missile(v, 1500, 'radar', v));
  frame(F, SOLO);
  t('the basic RWR (the Falcon\'s): a missile is heard', C.S.rwr === 1 && C.S.warn && C.S.threats.length === 1);
  t('the basic RWR: solo, flares and chaff both go out (it can\'t tell a radar missile from a heat seeker)', kinds().startsWith('flare,flare,bundle'), kinds());
}
// 4. the threat display: the right decoy
{
  const { v, F } = scene(FS16);
  C.S.shots.push(missile(v, 1500, 'heat', v));
  frame(F, SOLO);
  t('the advanced RWR (the FS-16\'s): a heat seeker heard; solo, flares only', C.S.rwr === 2 && C.S.warn && kinds() === 'flare,flare', kinds());
  C.reset(F); C.S.fighterT = 1e9;
  C.S.shots.push(missile(v, 1500, 'radar', v));
  frame(F, SOLO);
  t('... a radar missile: a chaff bundle only', C.S.warnR && kinds() === 'bundle', kinds());
  C.reset(F); C.S.fighterT = 1e9;
  const far = missile(v, 6000, 'radar', v), near = missile(v, 3000, 'heat', v);
  C.S.shots.push(far, near, missile(v, 2500, 'heat', null), missile(v, 2000, 'heat', v, { enemy: false }));
  frame(F, SOLO);
  t('nearest first; a missile not homing on us, or our own, is not a threat; nothing goes out beyond 2.2 km', C.S.threats.length === 2 && C.S.threats[0] === near && C.S.threats[1] === far && C.S.flares.length === 0);
  const adv = (m, d) => T.rwrAdvice(v, m, d);
  t('its advice: a heat seeker far off, close in; a radar missile far off, close in (with a dispenser)',
    adv(near, 4000) === 'throttle back · flares at 2 km' && adv(near, 1500) === 'FLARES NOW · break turn' && adv(far, 8000) === 'put it on your wing and dive (notch)' && adv(far, 3000) === 'CHAFF NOW · keep it on your wing',
    [adv(near, 4000), adv(near, 1500), adv(far, 8000), adv(far, 3000)]);
  for (const p of v.parts) if (p.def.weapon && (p.def.weapon.kind === 'flare' || p.def.weapon.kind === 'chaff')) p.ammo = 0;
  t('... with nothing left to drop', adv(near, 1500) === 'break turn hard' && adv(far, 3000) === 'notch it: on your wing, low', [adv(near, 1500), adv(far, 3000)]);
  C.S.shots.length = 0; frame(F);
  t('the warner falls quiet when the missile is gone', !C.S.warn && !C.S.threats.length);
}
// 5. the warner reads the craft as it is now: an RWR shot off is gone
{
  const { v, F } = scene(FS16);
  v.parts = v.parts.filter((p) => !p.def.rwr);
  C.S.shots.push(missile(v, 1500, 'heat', v));
  frame(F);
  t('an RWR shot off: deaf again', C.S.rwr === 0 && !C.S.warn && !C.S.flares.length);
}
// 6. missiles in sight: hostile ones get a marker, our own don't
{
  const { v } = scene(FS16), own = missile(v, 1000, 'heat', null, { owner: v, enemy: false }), ai = missile(v, 1000, 'heat', null), site = missile(v, 1000, 'radar', v);
  t('markers: the AI\'s and the sites\' missiles, not our own', T.hostileMissile(ai, v) && T.hostileMissile(site, v) && !T.hostileMissile(own, v) && !T.hostileMissile({ ...ai, k: 'rocket' }, v));
}
// 7. turrets: in the air they guard the craft; on the ground or the water they park and hold their fire
{
  const { v, F } = scene(rows('bomber')), tur = v.parts.find((p) => p.type === 'turretL');
  const b = Gm.craft(ctx, FALCON, 'plane', 'air'), at = v.toWorld(tur.x - 600, tur.y, 0);
  Object.assign(b, { x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, ai: {} });
  F.vessels.push(b);
  const fire = (secs, ground) => {
    v.contactTime = ground ? 0.5 : 0; const n0 = C.S.shots.length;
    for (let i = 0; i < secs * 120; i++) { T.turretStep(v, tur, 1 / 120, F); F.time += 1 / 120; }
    return C.S.shots.filter((s) => s.owner === v).length - n0;
  };
  t('the Stratobomber\'s manned turret, in the air: turns to a bandit 600 m off its dome and fires', fire(2, false) > 5 && tur.aimEl > 1.2, [tur.aimYaw, tur.aimEl]);
  C.S.shots.length = 0;
  t('touching the ground: not a round, and the guns park', fire(2, true) === 0 && !tur.gunOn && Math.abs(tur.aimEl) < 1e-6 && Math.abs(tur.aimYaw) < 1e-6, [tur.aimYaw, tur.aimEl]);
  t('up again: it fires again', fire(2, false) > 5);
  const old = scene([['fuselageW', 0, 0], ['cockpitAir', 0, 4.7], ['turret', -2, 0]]), ot = old.v.parts.find((p) => p.type === 'turret');
  old.F.vessels.push(b); old.v.contactTime = 0.5;
  for (let i = 0; i < 240; i++) T.turretStep(old.v, ot, 1 / 120, old.F);
  t('the small turret of an old design holds its fire on the ground too', !C.S.shots.some((s) => s.owner === old.v));
}
// 8. the stock military planes: an RWR each (the warbirds none), the basic one up to the 3rd generation, all within budget
{
  const mil = Object.keys(ctx.TEMPLATES).filter((k) => ctx.TEMPLATES[k].military), cost = (k) => ctx.TEMPLATES[k].parts.reduce((s, r) => s + P[r[0]].cost, 0);
  const lvl = (k) => ctx.TEMPLATES[k].parts.reduce((m, r) => Math.max(m, P[r[0]].rwr || 0), 0);
  const want = { mustang: 0, camel: 0, falcon: 1, striker: 1, bomber: 1, kestrel: 1, spectre: 1, myg21: 1, fs4: 1 };
  const bad = mil.filter((k) => lvl(k) !== (k in want ? want[k] : 2));
  t('every military template carries its RWR (warbirds none; basic to the 3rd generation, the display after)', !bad.length, bad.map((k) => k + ':' + lvl(k)));
  const jets = mil.filter((k) => ctx.TEMPLATES[k].parts.some((r) => /^(ru|us4|us5)/.test(r[0])));
  t('the look-alike jets still fit a $120k battle (the MyG-21 a $45k one, the FS-16 a $75k one)', jets.length === 10 && jets.every((k) => cost(k) <= 120000) && cost('myg21') <= 45000 && cost('fs16') <= 75000,
    jets.map((k) => k + ' ' + cost(k)).join(', '));
}
// 9. in a room: heat seekers heard too, nothing fired by itself, a missile turning on us heard from then, radar locks
{
  Gm.run(ctx, `var MP = { active: true, live: true, rwr: new Map(), peers: new Map(), enemyGhosts: () => [], sendLock() {}, enemy: (a, b) => b !== 7 }; var Net = { me: 1 };`);
  const { v, F } = scene(FALCON), g = Gm.craft(ctx, FALCON, 'plane', 'air');
  C.netMissile(g, { P: [v.x + 1500, v.y, v.z], V: [-600, 0, 0], D: [-1, 0, 0], id: 1, f: 5, radar: 0 }, v);
  frame(F);
  t('in a room the basic RWR hears another player\'s heat seeker (it used to be silent)', C.S.warn && C.S.threats.length === 1 && C.S.threats[0].heat);
  t('... and nothing goes out by itself (K there)', C.S.flares.length === 0);
  C.reset(F); C.netMissile(g, { P: [v.x + 1500, v.y, v.z], V: [-600, 0, 0], D: [-1, 0, 0], id: 2, f: 5, radar: 1 }, null);
  frame(F);
  const s = C.S.shots[0], was = C.S.warn;
  C.netMissileUpdate(5, 2, { P: [v.x + 1400, v.y, v.z], V: [-600, 0, 0], D: [-1, 0, 0] }, v);
  frame(F);
  t('a missile launched at nobody that turns on us: heard from its next update', !was && s.target === v && C.S.warn && C.S.warnR);
  C.netMissileUpdate(5, 2, { P: [v.x + 1300, v.y, v.z], V: [-600, 0, 0], D: [-1, 0, 0] }, null);
  frame(F);
  t('... and quiet again once it turns away', s.target === null && !C.S.warn);
  t('markers in a room: an enemy player\'s missile, not a friend\'s', T.hostileMissile(s, v) && !T.hostileMissile({ ...s, net: 7 }, v));
  ctx.MP.peers.set(5, { ghost: g }); ctx.MP.rwr.set(5, 0);
  t('a radar lock is known (for the display) from the lock reports', T.lockers().length === 1 && T.lockers()[0] === g);
  const bare = scene(without(FALCON, (d) => d.rwr));
  C.netMissile(g, { P: [bare.v.x + 1500, bare.v.y, bare.v.z], V: [-600, 0, 0], D: [-1, 0, 0], id: 3, f: 5, radar: 1 }, bare.v);
  frame(bare.F);
  t('in a room with no RWR: a radar missile goes unheard too', !C.S.warn && C.S.rwr === 0);
}
t.done();
