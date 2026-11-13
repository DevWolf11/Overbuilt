// How often a tank's counter-drone kit stops a kamikaze drone, measured: a hostile Bumble FPV flies straight at a parked
// tank (the player's) from 1.5 km (or from: the tests start it 600 m out, past every kit's reach but a sensor's) at
// 30 m/s, 30-60 m up, from a random bearing, then dives onto its turret from 60-150 m out (40 m up). It is stopped if it
// goes down (shot, burnt, its controller out) before it is within 4 m of the turret, or jammed: a jammer's lost link
// flies it on its last stick for 2.5 s, then its failsafe drops it, and it is stopped unless it falls on the tank. Two-
// drone runs send a second one 3 s behind (or alongside, "together"). The drone's flight is scripted (its velocity set
// every frame, so it flies the line a player would), its kit's reply is the game's own. Not run by run.mjs: a tool.
//
//   node test/tools/cuas-run.js            # every kit, 60 runs each
//   node test/tools/cuas-run.js 100 gun    # 100 runs of the named kits (jam, gun, gunDet, laser, laser2, gun2, ma1c, ma1c2, ma1cF, ma1cF2)
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
  };
  // a point dn m north and de m east of o, h m over the ground there
  var spot = (o, de, dn, h) => { const L0 = Terrain.locate(EARTH, o.x, o.y, o.z, {}), lat = L0.z / EARTH.radius, a = L0.a - de / (EARTH.radius * Math.cos(lat)), z = L0.z + dn, la = z / EARTH.radius, r = EARTH.radius + Terrain.surfaceAt(EARTH, a, z) + h;
    return { x: r * Math.cos(la) * Math.cos(a), y: r * Math.cos(la) * Math.sin(a), z: r * Math.sin(la) }; };
  var foeDrone = (F, P, k) => { const b = Drone.build(templateRows(TEMPLATES[k || 'bumble']), 'Foe ' + (k || 'bumble')); b.placeOnSurface(EARTH, siteAngle(EARTH, NPAD.e), 0, NPAD.z); Object.assign(b, { x: P.x, y: P.y, z: P.z, vx: 0, vy: 0, vz: 0 });
    b.ai = { drone: true, ground: false, team: 1, ally: false }; b.dl = { t: 0, at0: { x: P.x, y: P.y, z: P.z }, t0: 0 }; b.sas = 'acro'; b.throttle = 0; F.vessels.push(b); return b; };
  // n drones (gap s apart, from the same bearing; gap 0: together, 25° apart), at the kit; each one's fate
  var attack = (kit, s, n, gap, dk, from) => { from = from || 1500;
    const R = mulberry32(s), rr = (a, b) => a + (b - a) * R();
    const F = world(), C = F.start(KITS[kit]()); go(F, 1);
    const brg = rr(0, 2 * Math.PI), h = rr(30, 60), sp = rr(28, 32), wd = rr(60, 150), tur = C.parts.find((p) => p.def.control && p !== C.parts[0] && p.def.place === 'ring') || C.parts[0];
    const T = topOf2(C, tur), D = [], jam = C.parts.some((p) => p.def.cuas && p.def.cuas.jam);
    for (let i = 0; i < n; i++) { const b = brg + (gap ? 0 : (i - (n - 1) / 2) * 0.44);
      D.push({ start: F.time + i * gap, P0: spot(C, Math.sin(b) * from, Math.cos(b) * from, h), W: spot(C, Math.sin(b) * wd, Math.cos(b) * wd, 40), v: null, fate: null, phase: 0, t: 0 }); }
    const T0 = F.time;
    go(F, 80, (F) => {
      let live = 0;
      for (const d of D) {
        if (d.fate) continue;
        live++;
        if (!d.v) { if (F.time >= d.start) d.v = foeDrone(F, d.P0, dk); else continue; }
        const v = d.v;
        d.r = Math.round(Math.hypot(T.x - v.x, T.y - v.y, T.z - v.z));
        if (d.on == null && C.cuas.some((p) => p.gunOn)) d.on = d.r;
        const near = Math.hypot(T.x - v.x, T.y - v.y, T.z - v.z);
        if (d.lostR == null && v.dl && v.dl.lost && v.dl.jam) d.lostR = Math.round(near);
        if (d.drop != null) { // (its failsafe acting: it falls on, unflown; it gets through if it ends on the tank)
          if (near < 4 || (v.dl && v.dl.boom && near < 8)) { d.fate = 'through'; d.t = F.time - T0; }
          else if (v.dead || v.landed || F.time - d.drop > 8) { d.fate = 'jammed'; d.t = F.time - T0; }
          continue;
        }
        if (v.dead || v.down || !v.control || v.isDebris) { d.fate = 'down'; d.t = F.time - T0; continue; }
        // (lost to a jammer: it flies on LINK.HOLD s on its last stick, then its failsafe drops it; lost anywhere else, behind
        // a hill from where it took off, it flies on: a player's link is their own)
        if (v.dl && v.dl.lost && v.dl.jam && jam && v.dl.lostT >= DRONE.LINK.HOLD - 1e-6) { d.drop = F.time; d.dropR = Math.round(near); continue; }
        const aim = d.phase ? T : d.W, dx = aim.x - v.x, dy = aim.y - v.y, dz = aim.z - v.z, l = Math.hypot(dx, dy, dz);
        if (!d.phase && l < 8) d.phase = 1;
        if (d.phase && Math.hypot(T.x - v.x, T.y - v.y, T.z - v.z) < 4) { d.fate = 'through'; d.t = F.time - T0; continue; }
        v.vx = dx / l * sp; v.vy = dy / l * sp; v.vz = dz / l * sp; v.av.x = v.av.y = v.av.z = 0; v.landed = false;
      }
      if (!live) return false;
    });
    for (const d of D) if (!d.fate) d.fate = 'timeout';
    const used = C.cuas.reduce((a, p) => a + (p.def.cuas.gun ? p.def.cuas.gun.ammo - p.ammo : 0), 0);
    return D.map((d) => [d.fate, +d.t.toFixed(1), d.r, d.on, used, d.dropR, d.lostR]);
  };`);
}
const RUNS = { jam: ['jam', 1, 0], gun: ['gun', 1, 0], gunDet: ['gunDet', 1, 0], laser: ['laser', 1, 0], laser2: ['laser', 2, 3], gun2: ['gun', 2, 3], ma1c: ['ma1c', 1, 0], ma1c2: ['ma1c', 2, 0],
  ma1cF: ['ma1c', 1, 0, 'bumbleF'], ma1cF2: ['ma1c', 2, 0, 'bumbleF'] }; // (F: Bumble Fibres, which its jammer can't touch and its detector can't hear)
function measure(ctx, name, n, from) {
  const [kit, k, gap, dk] = RUNS[name], res = [];
  for (let i = 0; i < n; i++) { ctx.__a = [kit, 5000 + 104729 * i, k, gap, dk, from]; res.push(JSON.parse(G.run(ctx, 'JSON.stringify(attack(...__a))'))); }
  return res;
}
function summary(res) {
  const n = res.length, stopped = (f) => f === 'down' || f === 'jammed';
  const all = res.filter((r) => r.every((d) => stopped(d[0]))).length, first = res.filter((r) => stopped(r[0][0])).length;
  const second = res.length && res[0].length > 1 ? res.filter((r) => stopped(r[1][0])).length : null;
  const jam = res.filter((r) => r.some((d) => d[0] === 'jammed')).length, to = res.filter((r) => r.some((d) => d[0] === 'timeout')).length;
  return { n, allStopped: Math.round((100 * all) / n), first: Math.round((100 * first) / n), second: second == null ? null : Math.round((100 * second) / n), jam, timeout: to };
}
module.exports = { cuas, measure, summary, RUNS };

if (require.main === module) {
  const args = process.argv.slice(2), n = +args.find((a) => /^\d+$/.test(a)) || 60, names = args.filter((a) => RUNS[a]);
  const ctx = G.load({ combat: true, ground: true, props: true, flight: true });
  cuas(ctx);
  for (const k of names.length ? names : Object.keys(RUNS)) console.log(k.padEnd(7), JSON.stringify(summary(measure(ctx, k, n))));
}
