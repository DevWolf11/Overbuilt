// How often a tank's counter-drone kit stops a kamikaze drone, measured: a player's Bumble FPV flies straight at a parked
// enemy tank from 1.5 km (or from: the tests start it 600 m out, past every kit's reach but a sensor's) at 30 m/s, 30-60 m
// up (at least 15 m over the hills), from a random bearing, then dives onto its turret from 60-150 m out (40 m up); or as
// APPROACH flies it. It is stopped if it goes down (shot, burnt, its controller out) before it is within 4 m of the
// turret, or its link is lost (a jammer, a round through its radio): it flies on its last stick for 2.5 s, then its
// failsafe drops it, and it is stopped unless it falls on the tank; so too a quad shot down to fewer motors than it flies
// on (it spins and sinks). Runs that hit a hill, or lost the link behind one, unshot, are left out. Two-
// drone runs send a second one 3 s behind (or alongside, "together"). The drone's flight is scripted (its velocity set
// every frame, so it flies the line a player would), its kit's reply is the game's own. Not run by run.mjs: a tool.
//
//   node test/tools/cuas-run.js            # every kit, 60 runs each
//   node test/tools/cuas-run.js 100 gun    # 100 runs of the named kits (jam, gun, gunDet, laser, laser2, gun2, ma1c, ma1c2, ma1cF, ma1cF2)
//   node test/tools/cuas-run.js 40 gun --ap=level,look   # ...flown in as a player flies (APPROACH: straight level look acro
//                                                        # weave side high lock); the drone hand-flown, the kit's tank the
//                                                        # enemy AI's (lock: a player's drone on its lock-on, Drone.autoFlown)
//   node test/tools/cuas-run.js 30 ai:gun ai:jam          # the computer's attack Bumble (the Tank Range's Hostile drone, from a
//                                                        # random bearing 1.6 km out) at the kit (ai:bare: none)
const G = require('../lib/game.js');
const { harness } = require('./drone-strike.js');

function cuas(ctx) {
  harness(ctx);
  G.run(ctx, `
  var kitOf = (key, extra, name) => { const d = designOf(key); d.name = name || ('Kit ' + key); d.parts = d.parts.concat(extra || []); return d; };
  var KITS = {
    gun: () => kitOf('tk34', [{ type: 'cdGun', x: -1.6, y: 1.95, rot: 0, flip: false, att: 0 }]),
    jam: () => kitOf('tk34', [{ type: 'cdJam', x: -1.6, y: 2.0, rot: 0, flip: false, att: 0 }]),
    gunDet: () => kitOf('tk34', [{ type: 'cdGun', x: -1.6, y: 1.95, rot: 0, flip: false, att: 0 }, { type: 'cdDetect', x: -2.4, y: 2.0, rot: 0, flip: false, att: 0 }]),
    laser: () => kitOf('tk34', [{ type: 'cdLaser', x: -1.6, y: 2.0, rot: 0, flip: false, att: 0 }]),
    ma1c: () => designOf('ma1c'),
    bare: () => designOf('bmk2d'), // (no kit: a bay, so the drone war is on)
  };
  // a point dn m north and de m east of o, h m over the ground there
  var spot = (o, de, dn, h) => { const L0 = Terrain.locate(EARTH, o.x, o.y, o.z, {}), lat = L0.z / EARTH.radius, a = L0.a - de / (EARTH.radius * Math.cos(lat)), z = L0.z + dn, la = z / EARTH.radius, r = EARTH.radius + Terrain.surfaceAt(EARTH, a, z) + h;
    return { x: r * Math.cos(la) * Math.cos(a), y: r * Math.cos(la) * Math.sin(a), z: r * Math.sin(la) }; };
  // a hostile drone at P: hand (a player's, flown by hand: no AI of its own, the kit tank the enemy AI's, so the game's
  // foe rules make them enemies) or the computer's (an AI drone at the player's tank: Drone.autoFlown)
  var foeDrone = (F, P, k, hand) => { const b = Drone.build(templateRows(TEMPLATES[k || 'bumble']), 'Foe ' + (k || 'bumble')); b.placeOnSurface(EARTH, siteAngle(EARTH, NPAD.e), 0, NPAD.z); Object.assign(b, { x: P.x, y: P.y, z: P.z, vx: 0, vy: 0, vz: 0 });
    if (!hand) b.ai = { drone: true, ground: false, team: 1, ally: false }; b.dl = { t: 0, at0: { x: P.x, y: P.y, z: P.z }, t0: 0 }; b.sas = 'acro'; b.throttle = 0; F.vessels.push(b); return b; };
  // How a player flies in (ap: APPROACH's): sp m/s, h m up, the dive from wd m out at the turret (40 m up, or wh); lvl:
  // [m, m/s]: within that range it slows to line the tank up in the camera (a Level pilot); pause: s it hovers there (it
  // stops to look) before the dive; weave: [m/s across, period s] until the dive; side: m abeam (it flies past on a line
  // that far to the side, then turns in from abeam: a crossing drone); dsp: the dive's m/s (else sp); lock: v.dl.lockOn
  // set (the player's auto lock-on: the drone flies itself, Drone.autoFlown)
  var APPROACH = {
    straight: { sp: [28, 32], h: [30, 60], wd: [60, 150] },
    level: { sp: [24, 27], h: [20, 40], wd: [60, 120], lvl: [250, 15], dsp: 27 },
    look: { sp: [24, 27], h: [25, 45], wd: [60, 120], lvl: [220, 0], pause: 3, dsp: 27 },
    acro: { sp: [42, 48], h: [15, 30], wd: [40, 90] },
    weave: { sp: [28, 32], h: [20, 40], wd: [50, 100], weave: [14, 4] },
    side: { sp: [28, 32], h: [20, 40], side: [70, 110] },
    high: { sp: [30, 35], h: [120, 150], wd: [50, 80], wh: 120, dsp: 42 },
    lock: { sp: [28, 32], h: [30, 60], wd: [60, 150], lock: true },
  };
  // n drones (gap s apart, from the same bearing; gap 0: together, 25° apart), at the kit, flown in as apk; each one's fate
  var attack = (kit, s, n, gap, dk, from, apk) => { from = from || 1500;
    const ap = APPROACH[apk || 'straight'], R = mulberry32(s), rr = (a, b) => a + (b - a) * R();
    const F = world(), C = F.start(KITS[kit]()); C.ai = { ground: true, team: 1, ally: false, k: null }; go(F, 1); // (the kit's tank the enemy's: a player's drone flies at it)
    const brg = rr(0, 2 * Math.PI), h = rr(30, 60), sp = rr(28, 32), wd = rr(60, 150), tur = C.parts.find((p) => p.def.control && p !== C.parts[0] && p.def.place === 'ring') || C.parts[0];
    const T = topOf2(C, tur), D = [], jam = C.parts.some((p) => p.def.cuas && p.def.cuas.jam);
    // (straight and lock: as the tool always flew, its draws unchanged; the others draw their own after)
    const S = apk && apk !== 'straight' && apk !== 'lock' ? { sp: rr(...ap.sp), h: rr(...ap.h), wd: ap.wd ? rr(...ap.wd) : 0, side: ap.side ? rr(...ap.side) * (R() < 0.5 ? -1 : 1) : 0, ph: rr(0, 6.283) } : { sp, h, wd, side: 0, ph: 0 };
    for (let i = 0; i < n; i++) { const b = brg + (gap ? 0 : (i - (n - 1) / 2) * 0.44), ue = Math.sin(b), un = Math.cos(b), ce = Math.cos(b), cn = -Math.sin(b);
      const P0 = spot(C, ue * from + ce * S.side, un * from + cn * S.side, S.h);
      const W = S.side ? spot(C, ce * S.side, cn * S.side, S.h) : spot(C, ue * S.wd, un * S.wd, ap.wh || 40);
      D.push({ start: F.time + i * gap, P0, W, v: null, fate: null, phase: 0, t: 0, held: 0 }); }
    const T0 = F.time;
    go(F, 90, (F) => {
      let live = 0;
      for (const d of D) {
        if (d.fate) continue;
        live++;
        if (!d.v) { if (F.time >= d.start) { d.v = foeDrone(F, d.P0, dk, true); if (ap.lock) d.v.dl.lockOn = { t: C }; } else continue; }
        const v = d.v;
        d.r = Math.round(Math.hypot(T.x - v.x, T.y - v.y, T.z - v.z));
        if (d.on == null && C.cuas.some((p) => p.gunOn)) d.on = d.r;
        const near = Math.hypot(T.x - v.x, T.y - v.y, T.z - v.z);
        if (d.lostR == null && v.dl && v.dl.lost && v.dl.jam) d.lostR = Math.round(near);
        if (d.drop != null) { // (its failsafe acting: it falls on, unflown; it gets through if it ends on the tank)
          if (near < 4 || (v.dl && v.dl.boom && near < 8)) { d.fate = 'through'; d.t = F.time - T0; }
          else if (v.dead || v.landed || F.time - d.drop > 8) { d.fate = d.hurt ? 'down' : d.why || 'jammed'; d.t = F.time - T0; }
          continue;
        }
        if (v.dead || v.down || !v.control || v.isDebris) { d.fate = d.on == null && !v.lastHitBy ? 'crash' : 'down'; d.t = F.time - T0; continue; }
        // (its link lost: it flies on LINK.HOLD s on its last stick, then its failsafe drops it, as a player's would: to a
        // jammer (jammed), to a round that broke its radio (down), or behind a hill (lost: the kit's doing neither, so not
        // counted). A lock lets go when the link drops)
        if (v.dl && v.dl.lost && v.dl.lostT >= DRONE.LINK.HOLD - 1e-6) { d.drop = F.time; d.dropR = Math.round(near); d.why = v.dl.jam && jam ? 'jammed' : v.lastHitBy ? 'down' : 'lost'; continue; }
        // (a quad shot down to fewer motors than it can fly on spins and sinks (dl.spin): it falls on, unflown, as a pilot's would)
        if (v.dl && v.dl.spin) { d.drop = F.time; d.hurt = true; d.dropR = Math.round(near); v.throttle = Math.min(v.throttle, DRONE.SPIN.THR); continue; }
        if (v.dl && v.dl.lockOn && v.dl.lost) v.dl.lockOn = null;
        const aim = d.phase ? T : d.W, dx = aim.x - v.x, dy = aim.y - v.y, dz = aim.z - v.z, l = Math.hypot(dx, dy, dz);
        if (!d.phase && l < 8) d.phase = 1;
        if (d.phase && near < 4) { d.fate = 'through'; d.t = F.time - T0; continue; }
        let k = d.phase ? ap.dsp || S.sp : S.sp, ex = 0, ey = 0, ez = 0;
        if (!d.phase && ap.lvl && near < ap.lvl[0]) { // (lining it up: slower; or a stop to look first)
          if (ap.pause && d.held < ap.pause) { d.held += 1 / 60; k = 0; } else k = ap.pause ? ap.dsp : ap.lvl[1]; }
        if (!d.phase && ap.weave) { // (across the way it goes, a sine: ±weave[0] m/s every weave[1] s)
          const r0 = Math.hypot(v.x, v.y, v.z), ux = v.x / r0, uy = v.y / r0, uz = v.z / r0, cx = dy * uz - dz * uy, cy = dz * ux - dx * uz, cz = dx * uy - dy * ux, cl = Math.hypot(cx, cy, cz) || 1;
          const w = ap.weave[0] * Math.sin(S.ph + (2 * Math.PI * (F.time - T0)) / ap.weave[1]);
          ex = (cx / cl) * w; ey = (cy / cl) * w; ez = (cz / cl) * w; }
        if (!d.phase) { // (on its way in it keeps over the hills as a pilot would: at least 15 m, climbing over what rises ahead)
          const L = Terrain.locate(EARTH, v.x, v.y, v.z, {}), agl = L.r - EARTH.radius - Terrain.surfaceAt(EARTH, L.a, L.z), r0 = Math.hypot(v.x, v.y, v.z), lift = clamp((15 - agl) * 1.5, 0, 12);
          if (lift > 0) { ex += (v.x / r0) * lift; ey += (v.y / r0) * lift; ez += (v.z / r0) * lift; } }
        v.vx = dx / l * k + ex; v.vy = dy / l * k + ey; v.vz = dz / l * k + ez; v.av.x = v.av.y = v.av.z = 0; v.landed = false;
      }
      if (!live) return false;
    });
    for (const d of D) if (!d.fate) d.fate = 'timeout';
    const used = C.cuas.reduce((a, p) => a + (p.def.cuas.gun ? p.def.cuas.gun.ammo - p.ammo : 0), 0);
    return D.map((d) => [d.fate, +d.t.toFixed(1), d.r, d.on, used, d.dropR, d.lostR]);
  };
  // The computer's own attack drone (GroundAI's drone war, as the Tank Range's Hostile mode sends one: a Bumble seeing its
  // target from where it starts, coming at the range's 30 m/s), at a parked kit tank, from 1.6 km off on a bearing drawn
  // from the seed (the range always sends it from the south pad's way: one bearing, one outcome), flown by drone.js's AI.
  // Its fate: through (it went off within 8 m of the tank), down, jammed (lost to a jammer, it fell or went off away from
  // the tank) or timeout; and what it did to the tank
  var aiAttack = (kit, s) => {
    SET.targets = 'hostile'; Math.random = mulberry32(s); GroundAI.seed(s);
    const R = mulberry32(s + 1), F = world(), C = F.start(KITS[kit](), { place: NPAD }); go(F, 1);
    const R0 = GroundAI.range; R0.waveAt = 1e9; R0.planeAt = 1e9; R0.dAt = 1e9;
    const b = R() * 2 * Math.PI, d = Drone.spawnAI(F, 'bumble', { e: NPAD.e + Math.sin(b) * 1600, z: NPAD.z + Math.cos(b) * 1600, h: 3, yaw: R() * 6.283 }, 1, { see: 2000, cruise: 30 });
    let fate = null; const t0 = F.time;
    go(F, 120, (F) => {
      if (d.dead || (d.dl && d.dl.boom) || d.hulk != null || !d.control || (d.ai && d.ai.down) || d.landed) { fate = Math.hypot(d.x - C.x, d.y - C.y, d.z - C.z) < 8 ? 'through' : d.dl && d.dl.jam ? 'jammed' : 'down'; return false; } });
    const out = [fate || 'timeout', +(F.time - t0).toFixed(1), C.ko ? (C.ko.x ? 'destroyed' : 'ko') : C.hurtAt != null ? 'hurt' : 'none'];
    GroundAI.reset(F); SET.targets = 'off';
    return [out];
  };`);
}
const RUNS = { jam: ['jam', 1, 0], gun: ['gun', 1, 0], gunDet: ['gunDet', 1, 0], laser: ['laser', 1, 0], laser2: ['laser', 2, 3], gun2: ['gun', 2, 3], ma1c: ['ma1c', 1, 0], ma1c2: ['ma1c', 2, 0],
  ma1cF: ['ma1c', 1, 0, 'bumbleF'], ma1cF2: ['ma1c', 2, 0, 'bumbleF'], bare: ['bare', 1, 0] }; // (F: Bumble Fibres, which its jammer can't touch and its detector can't hear)
// the computer's drones (GroundAI's drone war) at a kit: ai:<kit>, e.g. ai:gun, ai:bare (no kit), ai:ma1c
const AI_KITS = ['bare', 'gun', 'gunDet', 'laser', 'jam', 'ma1c'];
function measure(ctx, name, n, from, ap) {
  const res = [];
  if (name.startsWith('ai:')) { for (let i = 0; i < n; i++) { ctx.__a = [name.slice(3), 7000 + 104729 * i]; res.push(JSON.parse(G.run(ctx, 'JSON.stringify(aiAttack(...__a))'))); } return res; }
  const [kit, k, gap, dk] = RUNS[name];
  for (let i = 0; i < n; i++) { ctx.__a = [kit, 5000 + 104729 * i, k, gap, dk, from, ap]; res.push(JSON.parse(G.run(ctx, 'JSON.stringify(attack(...__a))'))); }
  return res;
}
function summary(res0) {
  const res = res0.filter((r) => !r.some((d) => d[0] === 'crash' || d[0] === 'lost')), crash = res0.length - res.length; // (a drone flown into a hill on its way, or its link lost behind one, unshot: not the kit's)
  const n = res.length || 1, stopped = (f) => f === 'down' || f === 'jammed';
  const all = res.filter((r) => r.every((d) => stopped(d[0]))).length, first = res.filter((r) => stopped(r[0][0])).length;
  const second = res.length && res[0].length > 1 ? res.filter((r) => stopped(r[1][0])).length : null;
  const jam = res.filter((r) => r.some((d) => d[0] === 'jammed')).length, to = res.filter((r) => r.some((d) => d[0] === 'timeout')).length;
  const through = res.filter((r) => r[0][0] === 'through').length;
  return { n, allStopped: Math.round((100 * all) / n), first: Math.round((100 * first) / n), second: second == null ? null : Math.round((100 * second) / n), through: Math.round((100 * through) / n), jam, timeout: to, crash };
}
module.exports = { cuas, measure, summary, RUNS, AI_KITS };

if (require.main === module) {
  const args = process.argv.slice(2), n = +args.find((a) => /^\d+$/.test(a)) || 60, apA = args.find((a) => a.startsWith('--ap='));
  const aps = apA ? apA.slice(5).split(',') : [null], names = args.filter((a) => RUNS[a] || a.startsWith('ai:'));
  const ctx = G.load({ combat: true, ground: true, props: true, flight: true });
  cuas(ctx);
  for (const k of names.length ? names : Object.keys(RUNS)) for (const ap of k.startsWith('ai:') ? [null] : aps) console.log((k + (ap ? ' ' + ap : '')).padEnd(16), JSON.stringify(summary(measure(ctx, k, n, null, ap))));
}
