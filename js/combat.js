'use strict';
// Weapons, damage and targets. Guns, rockets, missiles and bombs fly as projectiles stepped with the physics;
// they hit the parts of craft (every part has health), targets and the ground, and explode. Around the space
// centre a target range waits: vehicles, radars and bunkers on the islands, boats at sea and drones in the
// air. In hostile mode the AA guns, SAM sites and frigates fire back and enemy fighters come hunting.

// Targets: how tough and big they are (m), and how they move (m/s).
const TARGET_KINDS = {
  tank: { name: 'Tank', hp: 600, r: 3.6, h: 2.6, speed: 4, land: true },
  truck: { name: 'Truck', hp: 220, r: 3.2, h: 2.8, speed: 9, land: true },
  radar: { name: 'Radar', hp: 320, r: 4, h: 6, land: true, emitter: true },
  bunker: { name: 'Bunker', hp: 1600, r: 6, h: 3.5, land: true },
  aa: { name: 'AA gun', hp: 380, r: 3.2, h: 3, land: true, aa: true, emitter: true },
  sam: { name: 'SAM site', hp: 420, r: 4, h: 4, land: true, sam: true, emitter: true },
  boat: { name: 'Patrol boat', hp: 520, r: 7, h: 3.5, speed: 7, sea: true },
  ship: { name: 'Frigate', hp: 3200, r: 20, h: 9, speed: 3, sea: true, aa: true, emitter: true },
  drone: { name: 'Target drone', hp: 140, r: 3.2, h: 1.2, speed: 75, air: true },
};
const TARGET_LAYOUT = { tank: 3, truck: 3, radar: 2, bunker: 2, aa: 3, sam: 2, boat: 4, ship: 1, drone: 4 };
// The enemy fighter: a Falcon with only its cannon.
const RAIDER = [['jetF', 0, 2.2], ['fuselage', 0, 6], ['fuselageS', 0, 9], ['cockpitJet', 0, 12.1], ['wingDelta', 0.4, 5.8],
  ['canard', 0, 10.4], ['vtailTwin', -1.55, 2.2], ['gearR', 1.7, 5.2], ['gearR', 1.5, 11.3], ['cannon', -1.25, 8.6], ['flares', -1.2, 4.3]];

const Combat = (() => {
  const S = { shots: [], targets: [], flares: [], kills: 0, lock: null, lockT: 0, cand: null, toneT: 0, warnT: 0, wasFiring: false, spawned: false, fighterT: 0, smokeT: 0, warn: false, killFeed: [], cmAt: -9, gunKey: null, lockPid: 0, lockAt: 0 };
  const mpOn = () => typeof MP !== 'undefined' && MP.active; // in a multiplayer room (no AI targets, SAMs or fighters there)
  const mode = () => (mpOn() ? 'off' : Settings.get('targets') || 'practice');
  const hostile = () => mode() === 'hostile';
  const R = () => EARTH.radius;
  let seed = 1;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

  // ---------------------------------------------------------------- health
  // Every part has health from its size; control parts (the pilot) are a little tougher.
  function maxHp(d) { return Math.round((60 + 220 * Math.sqrt(d.mass + (d.fuel || 0) * 0.25)) * (d.control ? 1.4 : 1)); }
  function hpFrac(p) { return p.hp == null ? 1 : Math.max(0, p.hp) / maxHp(p.def); }
  // A damaged engine loses thrust; a damaged wing, lift.
  function engineK(p) { const f = hpFrac(p); return f >= 0.6 ? 1 : 0.3 + (0.7 * f) / 0.6; }
  function liftK(p) { const f = hpFrac(p); return f >= 0.7 ? 1 : 0.45 + (0.55 * f) / 0.7; }

  function damage(v, p, amount, cause, sim, by) {
    if (!(amount > 0) || v.dead || v.remote || !v.parts.includes(p)) return; // (someone else's craft: only its owner hurts it, see MP.sendHit)
    if (p.hp == null) p.hp = maxHp(p.def);
    const before = hpFrac(p);
    p.hp -= amount * (1 - (p.def.armor || 0)); // armour plate turns most of it away
    if (by) { v.lastHitBy = by; v.lastHitAt = sim.time || 0; }
    const after = hpFrac(p);
    if (v === sim.active && !v.ai) {
      if (before >= 0.3 && after < 0.3 && after > 0 && (p.def.thrust || p.fuel > 50)) sim.toast(`${p.def.name} on fire!`, 'warn');
      else if (before >= 0.6 && after < 0.6 && after > 0) sim.toast(`${p.def.name} damaged`, 'warn');
    }
    if (p.hp <= 0) destroyPart(v, p, cause, sim);
  }
  // A part at zero health: engines, tanks, loaded weapons and cockpits blow up; the rest break off.
  function destroyPart(v, p, cause, sim) {
    const at = v.toWorld(p.x, p.y, 0), b = v.body;
    const wk = p.def.weapon && p.def.weapon.kind, fuel = p.fuel || 0, stores = wk === 'rocket' || wk === 'missile' || wk === 'bomb' ? p.ammo || 0 : 0;
    const boom = p.def.thrust || fuel > 50 || stores > 0 || p.def.control;
    if (boom) sim.breakParts(v, [p], cause);
    else sim.ripParts(v, [p], cause);
    if (fuel > 500) explode(b, at, 4 + Math.sqrt(fuel) * 0.08, 45, null, sim, true); // the fuel goes up too (not quite a chain reaction)
    if (stores) explode(b, at, p.def.weapon.blast * 0.6, p.def.weapon.dmg * 0.5, null, sim, true);
    if (v.ai && !v.control && !v.ai.down) aiDown(v, sim);
  }
  // Hitting the ground a bit too hard dents a part (once per bump) instead of breaking it outright.
  function impact(v, p, ratio, sim) {
    const now = sim.time || 0;
    if (p.bumpAt != null && now - p.bumpAt < 0.4) return;
    p.bumpAt = now;
    damage(v, p, maxHp(p.def) * (ratio - 0.75) * 1.6, 'impact', sim);
    if (v === sim.active && v.parts.includes(p)) Sound.hit();
  }

  // ---------------------------------------------------------------- hit tests
  // A part's box in part space: its rectangle, and across (z) its depth, wing span or twin pods.
  function boxesOf(p) {
    const r = partRect(p), d = p.def;
    if (d.twinZ) { const hw = Math.max(d.w, 0.6) / 2; return [[r.l, r.r, r.b, r.t, d.twinZ - hw, d.twinZ + hw], [r.l, r.r, r.b, r.t, -d.twinZ - hw, -d.twinZ + hw]]; }
    const hz = d.wheel ? (d.wheel.track || 0) / 2 + 0.3 : partDepth(p) / 2;
    return [[r.l, r.r, r.b, r.t, -hz, hz]];
  }
  function segBox(o, e, B) { // segment o->e against an axis-aligned box: entry fraction, or -1
    let t0 = 0, t1 = 1;
    for (let i = 0; i < 3; i++) {
      const a = i === 0 ? o.x : i === 1 ? o.y : o.z, d = (i === 0 ? e.x : i === 1 ? e.y : e.z) - a, lo = B[i * 2], hi = B[i * 2 + 1];
      if (Math.abs(d) < 1e-9) { if (a < lo || a > hi) return -1; continue; }
      let ta = (lo - a) / d, tb = (hi - a) / d;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    return t0;
  }
  // closest approach of a segment to a point: [fraction along it, distance]
  function segPoint(ax, ay, az, bx, by, bz, px, py, pz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, l2 = dx * dx + dy * dy + dz * dz;
    const t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / l2, 0, 1) : 0;
    return [t, len(ax + dx * t - px, ay + dy * t - py, az + dz * t - pz)];
  }
  // The first part of v a segment (body coordinates) passes through.
  function hitVessel(v, a, b) {
    const [, dc] = segPoint(a.x, a.y, a.z, b.x, b.y, b.z, v.x, v.y, v.z);
    if (dc > (v.reach || 10) + 2) return null;
    const la = v.toLocal(a.x, a.y, a.z), lb = v.toLocal(b.x, b.y, b.z);
    let best = null, bt = 2;
    for (const p of v.parts) for (const B of boxesOf(p)) {
      const t = segBox(la, lb, B);
      if (t >= 0 && t < bt) { bt = t; best = p; }
    }
    return best ? { p: best, t: bt } : null;
  }
  function targetCentre(e) { const u = 1 / (len(e.pos.x, e.pos.y, e.pos.z) || 1), k = e.def.h / 2; return { x: e.pos.x * (1 + k * u), y: e.pos.y * (1 + k * u), z: e.pos.z * (1 + k * u) }; }

  // ---------------------------------------------------------------- explosions
  // ours: our craft and its pieces (not someone else's, not AI, not a site on the range)
  const ours = (o) => !!o && !!o.parts && !o.remote && !o.ai;
  // An explosion's sight and sound only (also one someone else set off: netBoom).
  function boomFX(b, at, blast, quiet, sim) {
    const air = airDensity(b, Math.hypot(at.x, at.y, at.z) - b.radius) > 0.01;
    FX.explosion(b, at, { x: 0, y: 0, z: 0 }, clamp(blast / 5, 0.6, 9), air);
    if ((!quiet || blast > 10) && sim && sim.camAbs) { const c = sim.camAbs, bp = bodyPos(b, sim.time); if (len(bp.x + at.x - c.x, bp.y + at.y - c.y, (at.z || 0) - (c.z || 0)) < 6000) Sound.explode(); }
  }
  function explode(b, at, blast, dmg, by, sim, quiet) {
    boomFX(b, at, blast, quiet, sim);
    // our own fire reaching someone else's craft goes to its owner as hits, one message per craft
    const mine = typeof MP !== 'undefined' && ours(by);
    if (mine && blast >= 8) MP.sendBoom(b, at, blast); // (for everyone to see)
    for (const v of sim.vessels.slice()) {
      if (v.dead || v.body !== b || (v.remote && !mine)) continue;
      if (len(v.x - at.x, v.y - at.y, v.z - at.z) > (v.reach || 10) + blast) continue;
      const hits = v.remote ? [] : null;
      for (const p of v.parts.slice()) {
        if (!v.parts.includes(p)) continue;
        let d = Infinity;
        for (const s of p.def.twinZ ? [-1, 1] : [0]) { const w = v.toWorld(p.x, p.y, s * (p.def.twinZ || 0)); d = Math.min(d, len(w.x - at.x, w.y - at.y, w.z - at.z)); }
        d -= Math.max(p.def.w, p.def.h) / 2;
        if (d >= blast) continue;
        const k = dmg * Math.pow(1 - Math.max(0, d) / blast, 1.5);
        if (hits) hits.push([p, k]); else damage(v, p, k, 'blast', sim, by);
      }
      if (hits && hits.length) MP.sendHits(v, hits, 'blast');
    }
    if (mpOn()) return; // (no targets in multiplayer)
    for (const e of S.targets) {
      if (!e.alive) continue;
      const c = targetCentre(e), d = len(c.x - at.x, c.y - at.y, c.z - at.z) - e.def.r;
      if (d < blast) hitTarget(e, dmg * Math.pow(1 - Math.max(0, d) / blast, 1.5), by, sim);
    }
  }

  // ---------------------------------------------------------------- weapons on a craft
  // A craft's weapon systems: one per kind of weapon part (all its guns of one type fire together).
  function systems(v) {
    if (v._wsig === v.parts.length && v._ws) return v._ws;
    const map = new Map();
    for (const p of v.parts) {
      const w = p.def.weapon;
      if (!w || w.kind === 'flare' || w.kind === 'turret') continue; // flares and turrets work by themselves
      if (!map.has(p.type)) map.set(p.type, { key: p.type, def: p.def, w, parts: [] });
      map.get(p.type).parts.push(p);
    }
    v._ws = [...map.values()]; v._wsig = v.parts.length;
    if (v.wsel == null || v.wsel >= v._ws.length) v.wsel = 0;
    return v._ws;
  }
  const ammoOf = (sys) => sys.parts.reduce((s, p) => s + (p.ammo || 0), 0);
  const radarOf = (v) => v.parts.reduce((m, p) => Math.max(m, p.def.radar || 0), 0);
  function rangeOf(v, w) { return w.radar ? (radarOf(v) ? Math.min(w.range, radarOf(v)) : 5000) : w.range; }
  // How hard a craft is to see on radar (0..0.75): the stealthy share of its hull, less for each thing hung outside.
  function stealthOf(v) {
    let a = 0, s = 0, ext = 0;
    for (const p of v.parts) {
      const d = p.def;
      if (d.wing || d.wheel) continue;
      if (d.pod || d.shape === 'missile' || d.shape === 'bomb' || d.shape === 'ecm') { if (p.ammo !== 0) ext++; continue; }
      const ar = d.w * d.h; a += ar; s += ar * (d.stealth || 0);
    }
    return a ? clamp(s / a - 0.12 * ext, 0, 0.75) : 0;
  }
  const jams = (v) => !!v && !!v.parts && v.parts.some((p) => p.def.ecm);
  // where on the part a round leaves: the muzzle, the pod's mouth, the store on the pylon (part space)
  function muzzle(p, side) {
    const d = p.def, z = d.twinZ ? side * d.twinZ : 0;
    if (d.bay) { const q = partPt(p, d.w * 0.6, ((p.ammo || 0) % 2 ? 0.6 : -0.6)); return { x: q.x, y: q.y, z: 0 }; } // out of the belly
    const store = d.shape === 'missile' || d.shape === 'bomb', pod = d.shape === 'gunpod' || d.shape === 'rocketpod';
    const off = pod || store ? d.w * 0.12 : 0, ly = store ? 0 : d.h / 2;
    const q = partPt(p, off, ly);
    return { x: q.x, y: q.y, z };
  }
  function release(v, p) { // one store gone: lighter (and the pylon shows it)
    p.ammo = Math.max(0, (p.ammo || 0) - 1);
    const each = p.def.weapon.each || 0;
    p.store = p.ammo * each;
    if (each >= 10) v.recompute(false);
  }

  function fireGun(v, p, h, enemy, sim, net) { // (net: someone else's gun, rounds for show only)
    const w = p.def.weapon, twin = !!p.def.twinZ;
    p.cool = (p.cool || 0) - h;
    while (p.cool <= 0 && (p.ammo || 0) > 0) {
      p.cool += 1 / w.rate;
      p.side = twin ? -(p.side || 1) : 0;
      const m = muzzle(p, p.side), wp = v.toWorld(m.x, m.y, m.z), ax = partAxis(p), dir = v.axis(ax.x, ax.y, 0);
      const s = w.spread || 0.004, jx = (Math.random() - 0.5) * 2 * s, jy = (Math.random() - 0.5) * 2 * s, jz = (Math.random() - 0.5) * 2 * s;
      const dx = dir.x + jx, dy = dir.y + jy, dz = dir.z + jz, dl = len(dx, dy, dz);
      p.shots = (p.shots || 0) + 1;
      if (p.def.barrels) p.spin = ((p.spin || 0) + (TAU / p.def.barrels)) % TAU; // the barrels turn one along per round
      S.shots.push({ k: 'bullet', b: v.body, x: wp.x, y: wp.y, z: wp.z, vx: v.vx + (dx / dl) * w.speed, vy: v.vy + (dy / dl) * w.speed, vz: v.vz + (dz / dl) * w.speed,
        t: 0, life: 3, dmg: net ? 0 : w.dmg, blast: w.blast || 0, owner: v, tracer: w.blast || p.shots % 3 === 0, enemy, net: net ? v.remote : 0 });
      p.ammo--;
      if (p.shots % (w.blast ? 1 : 2) === 0 && len(wp.x - sim.active.x, wp.y - sim.active.y, wp.z - sim.active.z) < 3000) {
        FX.add({ kind: 'flash', b: v.body, x: wp.x, y: wp.y, z: wp.z, vx: v.vx, vy: v.vy, vz: v.vz, max: 0.05, size: 0.5, grow: 1.2, color: '#ffd27a', alpha: 1 });
        if (v === sim.active && (p.shots % (w.blast ? 1 : 3) === 0)) Sound.gun(!!w.blast);
      }
    }
    if (!(p.ammo > 0)) p.cool = 0;
  }
  function fireRocket(v, p, enemy, sim) {
    const w = p.def.weapon;
    p.side = -(p.side || 1);
    const m = muzzle(p, p.side), wp = v.toWorld(m.x, m.y, m.z), ax = partAxis(p), dir = v.axis(ax.x, ax.y, 0);
    const s = { k: 'rocket', b: v.body, x: wp.x, y: wp.y, z: wp.z, vx: v.vx + dir.x * w.speed, vy: v.vy + dir.y * w.speed, vz: v.vz + dir.z * w.speed,
      dx: dir.x, dy: dir.y, dz: dir.z, t: 0, life: 9, burn: w.burn, accel: w.accel, dmg: w.dmg, blast: w.blast, owner: v, enemy };
    S.shots.push(s);
    release(v, p);
    if (v === sim.active) Sound.burst(0.25, 1200, 0.4, 'bandpass');
    if (typeof MP !== 'undefined' && ours(v)) MP.sendShot(s); // (the others fly a copy)
    return s;
  }
  function launchMissile(v, p, target, sim) {
    const w = p.def.weapon;
    p.side = -(p.side || 1);
    const m = muzzle(p, p.side), wp = v.toWorld(m.x, m.y, m.z), ax = partAxis(p), dir = v.axis(ax.x, ax.y, 0), down = v.kind === 'plane' ? v.axis(1, 0, 0) : { x: 0, y: 0, z: 0 };
    const s = { k: 'missile', b: v.body, x: wp.x, y: wp.y, z: wp.z, vx: v.vx + down.x * 4, vy: v.vy + down.y * 4, vz: v.vz + down.z * 4,
      dx: dir.x, dy: dir.y, dz: dir.z, t: 0, life: w.life || 24, burn: w.burn, accel: w.accel, vmax: w.vmax, turn: w.turn, dmg: w.dmg, blast: w.blast,
      seek: w.seek, heat: !w.radar && w.seek === 'air', glide: !!w.glide, target, owner: v, launcher: v, enemy: !!v.ai, ...airframe(w) };
    S.shots.push(s);
    release(v, p);
    if (v === sim.active) { if (w.glide) Sound.separate(); else Sound.missile(); }
    if (typeof MP !== 'undefined' && ours(v) && MP.shared) MP.sendMissile(s, w); // (it is streamed to the others while it flies)
    return s;
  }
  function dropBomb(v, p, sim) {
    const w = p.def.weapon;
    p.side = -(p.side || 1);
    const m = muzzle(p, p.side), wp = v.toWorld(m.x, m.y, m.z), down = v.kind === 'plane' ? v.axis(1, 0, 0) : { x: 0, y: 0, z: 0 };
    const ax = partAxis(p), dir = v.axis(ax.x, ax.y, 0);
    const s = { k: 'bomb', b: v.body, x: wp.x, y: wp.y, z: wp.z, vx: v.vx + down.x * 2, vy: v.vy + down.y * 2, vz: v.vz + down.z * 2,
      dx: dir.x, dy: dir.y, dz: dir.z, t: 0, life: 90, dmg: w.dmg, blast: w.blast, cluster: w.cluster || 0, torpedo: !!w.torpedo, owner: v };
    S.shots.push(s);
    release(v, p);
    if (v === sim.active) Sound.separate();
    if (typeof MP !== 'undefined' && ours(v)) MP.sendShot(s);
    return s;
  }
  // Flares: a pair of hot decoys; heat seekers chasing this craft may go for them instead. Released by hand
  // (countermeasures) they come with a chaff cloud too (free), for radar missiles.
  function flares(v, sim, chaff) {
    const p = v.parts.find((q) => q.def.weapon && q.def.weapon.kind === 'flare' && q.ammo > 0);
    if (!p) return false;
    const wp = v.toWorld(p.x, p.y, 0), out = [];
    for (const s of [-1, 1]) {
      const side = v.axis(0, 0, s), down = v.kind === 'plane' ? v.axis(1, 0, 0) : side;
      out.push({ b: v.body, x: wp.x, y: wp.y, z: wp.z, vx: v.vx * 0.7 + side.x * 25 + down.x * 15, vy: v.vy * 0.7 + side.y * 25 + down.y * 15, vz: v.vz * 0.7 + side.z * 25 + down.z * 15, t: 0, life: 4, flare: true });
      p.ammo--;
      if (p.ammo <= 0) break;
    }
    if (chaff) out.push({ b: v.body, x: wp.x, y: wp.y, z: wp.z, vx: v.vx * 0.5, vy: v.vy * 0.5, vz: v.vz * 0.5, t: 0, life: 5, chaff: true });
    for (const f of out) { S.flares.push(f); if (typeof MP !== 'undefined') MP.sendFlares(v, f); } // (heat seekers weigh each flare against the craft: decoyed)
    if (v === sim.active) Sound.burst(0.2, 2400, 0.3, 'highpass');
    return true;
  }
  // Countermeasures by hand (key K, or the button): flares and chaff, at most every 0.6 s.
  function countermeasures(v, sim) {
    const now = sim.time || 0;
    if (!v || v.dead || v.remote || !v.parts.length || (now >= S.cmAt && now - S.cmAt < 0.6) || !flares(v, sim, true)) return false;
    S.cmAt = now;
    return true;
  }

  // A defensive turret: swings round to the nearest enemy plane or drone in its half of the sky (leading it)
  // and fires when its guns are on. Aim angles are kept on the part for the 3D model: yaw about the part's
  // x axis, elevation away from its mount.
  function turretStep(v, p, h, F) {
    const w = p.def.weapon, k = p.rot & 3;
    let best = null, bd = w.range;
    for (const c of candidates(v, 'air', F)) { const d = len(c.x - v.x, c.y - v.y, c.z - v.z); if (d < bd) { bd = d; best = c.ref; } }
    const want = { yaw: p.aimYaw || 0, el: p.aimEl || 0 };
    let on = false;
    if (best) {
      const tp = refPos(best), tof = bd / w.speed, at = v.toWorld(p.x, p.y, 0);
      const ax = tp.x + (tp.vx - v.vx) * tof - at.x, ay = tp.y + (tp.vy - v.vy) * tof - at.y, az = tp.z + (tp.vz - v.vz) * tof - at.z;
      const o = v.toLocal(v.x, v.y, v.z), q = v.toLocal(v.x + ax, v.y + ay, v.z + az);
      let lx = q.x - o.x, ly = q.y - o.y; const lz = q.z - o.z;
      for (let i = 0; i < k; i++) { const t2 = lx; lx = ly; ly = -t2; } // into the turret's own (unturned) frame
      const el = Math.atan2(-lx, Math.hypot(ly, lz));
      if (el > -0.12) { want.yaw = Math.atan2(lz, ly); want.el = Math.max(0, el); on = true; }
    }
    // slew at up to 2.5 rad/s
    const dy = Math.atan2(Math.sin(want.yaw - (p.aimYaw || 0)), Math.cos(want.yaw - (p.aimYaw || 0))), de = want.el - (p.aimEl || 0), m = 2.5 * h;
    p.aimYaw = (p.aimYaw || 0) + clamp(dy, -m, m); p.aimEl = (p.aimEl || 0) + clamp(de, -m, m);
    p.gunOn = on && Math.abs(dy) <= 0.06 && Math.abs(de) <= 0.06 && p.ammo > 0; // (sent to the other players)
    if (p.gunOn) turretFire(v, p, h, F, false, false);
  }
  // A turret's guns along its aim (net: someone else's, rounds for show only).
  function turretFire(v, p, h, F, enemy, net) {
    const w = p.def.weapon, k = p.rot & 3;
    p.cool = (p.cool || 0) - h;
    if (p.cool > 0) return;
    p.cool += 1 / w.rate;
    // the guns' direction back in the vessel's frame
    const ce = Math.cos(p.aimEl || 0), gx0 = -Math.sin(p.aimEl || 0), gy0 = ce * Math.cos(p.aimYaw || 0), gz = ce * Math.sin(p.aimYaw || 0);
    let gx = gx0, gy = gy0;
    for (let i = 0; i < k; i++) { const t2 = gx; gx = -gy; gy = t2; }
    const dir = v.axis(gx, gy, gz), wp = v.toWorld(p.x, p.y, 0), s = w.spread;
    const dx = dir.x + (Math.random() - 0.5) * s, dyy = dir.y + (Math.random() - 0.5) * s, dz = dir.z + (Math.random() - 0.5) * s;
    p.shots = (p.shots || 0) + 1;
    S.shots.push({ k: 'bullet', b: v.body, x: wp.x + dir.x * 1.5, y: wp.y + dir.y * 1.5, z: wp.z + dir.z * 1.5, vx: v.vx + dx * w.speed, vy: v.vy + dyy * w.speed, vz: v.vz + dz * w.speed,
      t: 0, life: 2.5, dmg: net ? 0 : w.dmg, blast: 0, owner: v, tracer: p.shots % 2 === 0, enemy, net: net ? v.remote : 0 });
    p.ammo--;
    if (v === F.active && p.shots % 3 === 0) Sound.gun(false);
  }

  // ---------------------------------------------------------------- the player's trigger and lock
  function playerFrame(F, dt) {
    const v = F.active;
    if (!v || !v.parts.length || F.destroyed) { S.lock = S.cand = null; return; }
    const sys = systems(v), cur = sys[v.wsel];
    const trig = !!F.firing, edge = (trig && !S.wasFiring) || F.fireTap; // (a tap shorter than a frame still counts)
    S.wasFiring = trig; F.fireTap = false;
    if (!cur) { S.lock = S.cand = null; return; }
    const w = cur.w;
    // missiles lock on to whatever sits nearest the nose, inside the seeker's cone and range
    if (w.kind === 'missile') {
      // heat seekers see a hot target further (and a cold one, or one seen from the front, much closer);
      // radar needs to see the target (not notching) and keeps its lock anywhere within its field
      const range = rangeOf(v, w), fwd = noseDir(v), air = w.seek === 'air', heat = air && !w.radar, sarh = air && w.radar;
      const cands = candidates(v, w.seek, F);
      let best = null, ba = w.cone;
      if (sarh && S.lock && cands.some((c) => c.ref === S.lock) && radarSees(v, S.lock, refPos(S.lock)) === true && !chaffBreaks(v, S.lock)) best = S.lock;
      else for (const c of cands) {
        const dx = c.x - v.x, dy = c.y - v.y, dz = c.z - v.z, d = len(dx, dy, dz);
        if (d > range || d < (air ? 350 : 150)) continue;
        if (heat && d > range * clamp(Math.sqrt(irSig(c.ref, v)), 0.2, 1)) continue;
        if (sarh && radarSees(v, c.ref, refPos(c.ref)) !== true) continue;
        const ang = Math.acos(clamp((dx * fwd.x + dy * fwd.y + dz * fwd.z) / d, -1, 1));
        if (ang < ba) { ba = ang; best = c.ref; }
      }
      if (best && best === S.cand) S.lockT += dt; else { S.cand = best; S.lockT = 0; }
      S.lock = best && S.lockT > (w.radar ? 1.4 * (best.parts && jams(best) ? 2 : 1) : 0.9) ? best : null; // (a jammer slows a radar lock)
      S.lockR = !!w.radar; // (a radar lock warns its target; a heat seeker is passive)
      S.toneT -= dt;
      if (S.cand && S.toneT <= 0) { Sound.tone(S.lock ? 1250 : 820, S.lock ? 0.09 : 0.06, S.lock ? 0.06 : 0.035); S.toneT = S.lock ? 0.1 : 0.32; }
    } else { S.lock = S.cand = null; S.lockT = 0; }
    if (!edge) return;
    const ready = cur.parts.filter((p) => (p.ammo || 0) > 0);
    if (!ready.length) { F.toast(`${cur.def.name}: empty`); return; }
    if (w.kind === 'missile') launchMissile(v, ready[0], S.lock, F);
    else if (w.kind === 'bomb') dropBomb(v, ready[0], F);
  }
  const noseDir = (v) => { const a = v.pilot.F; return v.axis(a.x, a.y, a.z); };
  // chaff near a radar-locked target can break the lock (each cloud once): about 1 in 7, 3 in 5 if it's crossing the beam
  const chaffSeen = new WeakSet();
  function chaffBreaks(v, t) {
    const tp = refPos(t);
    if (!tp) return false;
    for (const f of S.flares) {
      if (!f.chaff || chaffSeen.has(f) || len(f.x - tp.x, f.y - tp.y, f.z - tp.z) > 250) continue;
      chaffSeen.add(f);
      const d = len(tp.x - v.x, tp.y - v.y, tp.z - v.z) || 1, vr = Math.abs((tp.vx * (tp.x - v.x) + tp.vy * (tp.y - v.y) + tp.vz * (tp.z - v.z)) / d);
      if (Math.random() < (vr < 80 ? 0.6 : 0.15)) { S.cand = null; S.lockT = 0; return true; }
    }
    return false;
  }
  // what a seeker can lock on to: planes in the air (bandits, drones), or things on the ground and at sea
  // (and the other players' craft, enemies only: in the air for air seekers, on the ground or cars for the rest)
  function candidates(v, seek, F) {
    const out = [], foes = typeof MP !== 'undefined' ? MP.enemyGhosts().filter((g) => !g.hiddenUntilSnap) : [];
    if (seek === 'air') {
      for (const o of F.vessels) if (o !== v && !o.dead && o.ai && o.control && !o.landed) out.push({ x: o.x, y: o.y, z: o.z, ref: o });
      for (const e of S.targets) if (e.alive && e.def.air) out.push({ ...e.pos, ref: e });
      for (const g of foes) if (g !== v && !g.landed && g.kind !== 'car') out.push({ x: g.x, y: g.y, z: g.z, ref: g });
    } else {
      for (const e of S.targets) if (e.alive && !e.def.air && (seek !== 'radar' || e.def.emitter)) { const c = targetCentre(e); out.push({ ...c, ref: e }); }
      if (seek !== 'radar') for (const g of foes) if (g !== v && (g.landed || g.kind === 'car')) out.push({ x: g.x, y: g.y, z: g.z, ref: g });
    }
    return out;
  }
  function refPos(t) { // where a missile's target is, and how fast it moves
    if (!t) return null;
    if (t.flare) return { x: t.x, y: t.y, z: t.z, vx: t.vx, vy: t.vy, vz: t.vz, alive: t.t < t.life };
    if (t.def) { const c = targetCentre(t); return { x: c.x, y: c.y, z: c.z, vx: t.vel ? t.vel.x : 0, vy: t.vel ? t.vel.y : 0, vz: t.vel ? t.vel.z : 0, alive: t.alive }; }
    return { x: t.x, y: t.y, z: t.z, vx: t.vx, vy: t.vy, vz: t.vz, alive: !t.dead && t.parts.length > 0 };
  }

  // ---------------------------------------------------------------- stepping projectiles (with the physics)
  function step(h, F) {
    const v = F.active;
    // guns and rocket pods fire while the trigger is held
    const cur = v && v.parts.length && !F.destroyed && F.firing ? systems(v)[v.wsel] : null;
    if (cur && cur.w.kind === 'gun') for (const p of cur.parts) fireGun(v, p, h, false, F);
    else if (cur && cur.w.kind === 'rocket') {
      S.rocketT = (S.rocketT || 0) - h;
      if (S.rocketT <= 0) { const p = cur.parts.find((q) => q.ammo > 0); if (p) { fireRocket(v, p, false, F); S.rocketT = 1 / cur.w.rate; } }
    }
    if (typeof MP !== 'undefined' && MP.shared) {
      // the others fire our gun for show: tell them when it starts and stops (and switches, and when we go down)
      const key = cur && cur.w.kind === 'gun' ? cur.key : null;
      if (key !== S.gunKey) { if (S.gunKey) MP.sendGun(S.gunKey, false); if (key) MP.sendGun(key, true); S.gunKey = key; }
      if (v) netGuns(h, F);
    }
    for (const o of F.vessels) if (o.ai && o.aiFire && !o.dead && o.control) for (const p of o.parts) if (p.def.weapon && p.def.weapon.kind === 'gun') fireGun(o, p, h, true, F);
    if (v && v.parts.length && !F.destroyed && v.turrets !== 0) {
      let n = 0;
      for (const p of v.parts) if (p.def.weapon && p.def.weapon.kind === 'turret') { n++; turretStep(v, p, h, F); }
      if (!n) v.turrets = 0; // none on board: stop looking (a rebuilt craft is a new vessel)
    }
    // a jammer: enemy missiles tracking the craft lose it now and then (not at the last moment)
    if (v && jams(v)) for (const m of S.shots) if (m.k === 'missile' && m.enemy && !m.net && m.target === v && len(m.x - v.x, m.y - v.y, m.z - v.z) > 1200 && Math.random() < 0.35 * h) m.target = null;
    for (const t of S.targets) if (t.firing) aaFire(t, h, F);
    const keep = [];
    for (const s of S.shots) if (moveShot(s, h, F)) keep.push(s);
    S.shots = keep;
    for (const f of S.flares) { f.t += h; f.vx *= 1 - 0.6 * h; f.vy *= 1 - 0.6 * h; f.vz *= 1 - 0.6 * h; const r = len(f.x, f.y, f.z), g = (f.b.mu / (r * r)) * h; f.vx -= (f.x / r) * g; f.vy -= (f.y / r) * g; f.vz -= (f.z / r) * g; f.x += f.vx * h; f.y += f.vy * h; f.z += f.vz * h; }
    S.flares = S.flares.filter((f) => f.t < f.life);
  }
  // The other players' guns and turrets: rounds for show (what they hit is for their owners to say).
  function netGuns(h, F) {
    for (const [, P] of MP.peers) {
      const g = P.ghost;
      if (!g || g.dead || !g.parts.length || g.hiddenUntilSnap) continue;
      const foe = typeof Net !== 'undefined' && MP.enemy(Net.me, g.remote);
      for (const p of g.parts) {
        const w = p.def.weapon;
        if (!w || !(p.ammo > 0)) continue;
        if (w.kind === 'gun' && P.gun && P.gun[p.type]) fireGun(g, p, h, foe, F, true);
        else if (w.kind === 'turret' && p.gunOn) turretFire(g, p, h, F, foe, true);
      }
    }
  }
  function moveShot(s, h, F) {
    if (s.k === 'torp') return swim(s, h, F);
    if (s.netId != null) return moveReplica(s, h, F);
    const b = s.b, r0 = len(s.x, s.y, s.z), g = b.mu / (r0 * r0);
    s.t += h;
    if (s.t > s.life) { if (s.k === 'missile' && !s.net) explode(b, s, s.blast * 0.4, 0, s.owner, F, true); return false; }
    const rho = airDensity(b, r0 - b.radius);
    let spd = len(s.vx, s.vy, s.vz);
    let pulled = 0;
    if (s.k === 'missile' || s.k === 'rocket') {
      const motor = s.t > (s.k === 'missile' ? 0.35 : 0) && s.t < (s.k === 'missile' ? 0.35 : 0) + s.burn;
      if (s.k === 'missile' && s.t > 0.35) { if (s.air) pulled = guideAir(s, h, spd, rho); else guide(s, h, spd); }
      if (motor) { s.vx += s.dx * s.accel * h; s.vy += s.dy * s.accel * h; s.vz += s.dz * s.accel * h; }
      spd = len(s.vx, s.vy, s.vz);
      if (s.air) { // past its top speed the drag climbs steeply; turning hard costs speed, more so in thin air
        let loss = spd > s.vmax ? (spd - s.vmax) * 1.5 * h : 0;
        if (pulled > 0.5) { const q = 0.5 * rho * spd * spd; loss += s.bleed * pulled * pulled * 9.81 * clamp(QREF / Math.max(q, 1), 0.5, 3) * h; }
        if (loss > 0) { const k = Math.max(0, spd - loss) / (spd || 1); s.vx *= k; s.vy *= k; s.vz *= k; spd *= k; }
      } else if (s.vmax && spd > s.vmax) { const k = s.vmax / spd; s.vx *= k; s.vy *= k; s.vz *= k; spd = s.vmax; }
      if (!s.glide && Math.random() < h * (motor ? 60 : 8) && F.warpIdx <= 1) FX.add({ kind: 'smoke', b, x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, max: motor ? 2.2 : 1, size: 0.5, grow: 3.5, color: '#d8dce2', alpha: 0.55 });
      if (motor && Math.random() < h * 40) FX.add({ kind: 'fire', b, x: s.x, y: s.y, z: s.z, vx: -s.dx * 20, vy: -s.dy * 20, vz: -s.dz * 20, max: 0.12, size: 0.5, grow: 0.6, color: '#ffd27a', alpha: 1 });
    }
    // drag (rounds lose speed slowly; bombs are slippery) and gravity
    const kd = (s.air ? s.drag : s.k === 'bullet' ? 0.00012 : s.k === 'bomb' ? 0.00003 : 0.00006) * rho * spd * h;
    s.vx -= s.vx * kd + (s.x / r0) * g * h; s.vy -= s.vy * kd + (s.y / r0) * g * h; s.vz -= s.vz * kd + (s.z / r0) * g * h;
    if (s.k !== 'missile' && s.k !== 'rocket') { const l = len(s.vx, s.vy, s.vz) || 1; s.dx = s.vx / l; s.dy = s.vy / l; s.dz = s.vz / l; }
    const a = { x: s.x, y: s.y, z: s.z }, e = { x: s.x + s.vx * h, y: s.y + s.vy * h, z: s.z + s.vz * h };
    // craft (a copy of someone else's round hits nothing: its owner says what it hit)
    let hit = null, ht = 2, hv = null;
    for (const o of s.net ? [] : F.vessels) {
      if (o.dead || o.body !== b || (o === s.owner && s.t < 1.5)) continue;
      const q = hitVessel(o, a, e);
      if (q && q.t < ht) { ht = q.t; hit = q.p; hv = o; }
    }
    // targets
    let ht2 = 2, he = null;
    for (const t of s.net ? [] : S.targets) {
      if (!t.alive || t === s.owner) continue;
      const c = targetCentre(t), [ft, d] = segPoint(a.x, a.y, a.z, e.x, e.y, e.z, c.x, c.y, c.z);
      if (d < t.def.r && ft < ht2) { ht2 = ft; he = t; }
    }
    const armed = !s.arm || s.t >= s.arm;
    if (!armed && hit) { // too close to have armed: a dud that only knocks
      if (!hv.remote) damage(hv, hit, s.dmg * 0.1, 'shot', F, s.owner);
      else if (typeof MP !== 'undefined' && ours(s.owner)) MP.sendHit(hv, hit, s.dmg * 0.1, 'shot');
      FX.sparks(b, a, { x: hv.vx, y: hv.vy, z: hv.vz }, 6);
      return false;
    }
    // missiles burst when they pass close: the proximity fuse
    if (s.k === 'missile' && s.target && !hit && !he && armed) {
      const tp = refPos(s.target);
      if (tp && tp.alive) { const [ft, d] = segPoint(a.x, a.y, a.z, e.x, e.y, e.z, tp.x, tp.y, tp.z); if (d < s.blast * 0.45) { const at = lerp3(a, e, ft); explode(b, at, s.blast, s.dmg, s.owner, F); return false; } }
    }
    if (hit && ht <= ht2) {
      const at = lerp3(a, e, ht);
      if (s.blast) explode(b, at, s.blast, s.dmg, s.owner, F, s.k === 'bullet');
      else if (hv.remote) { FX.sparks(b, at, { x: hv.vx, y: hv.vy, z: hv.vz }, 3); if (typeof MP !== 'undefined' && ours(s.owner)) MP.sendHit(hv, hit, s.dmg, 'shot'); } // (its owner takes the damage)
      else { damage(hv, hit, s.dmg, 'shot', F, s.owner); FX.sparks(b, at, { x: hv.vx, y: hv.vy, z: hv.vz }, 3); if (hv === F.active) Sound.hit(); }
      return false;
    }
    if (he) {
      const at = lerp3(a, e, ht2);
      if (s.blast) explode(b, at, s.blast, s.dmg, s.owner, F, s.k === 'bullet');
      else { hitTarget(he, s.dmg, s.owner, F); FX.sparks(b, at, { x: 0, y: 0, z: 0 }, 3); }
      return false;
    }
    // the ground (or the sea)
    const L = Terrain.locate(b, e.x, e.y, e.z, {}), gh = b.ocean ? Math.max(0, Terrain.surfaceAt(b, L.a, L.z)) : Terrain.surfaceAt(b, L.a, L.z);
    if (s.cluster && L.r < b.radius + gh + 150 && s.t > 1) { burst(s, e, F); return false; } // a cluster bomb opens 150 m up
    if (L.r < b.radius + gh) {
      const water = b.ocean && Terrain.waterAt(b, L.a, L.z);
      if (s.torpedo && water && !s.net) { // gently enough and it swims; too fast and it breaks up
        const n = { x: e.x / L.r, y: e.y / L.r, z: e.z / L.r };
        FX.splash(b, e, n, 4);
        if (len(s.vx, s.vy, s.vz) > 110) { if (s.owner === F.active) F.toast('Torpedo broke up: drop it slower', 'warn'); return false; }
        const vn = s.vx * n.x + s.vy * n.y + s.vz * n.z, hx = s.vx - n.x * vn, hy = s.vy - n.y * vn, hz = s.vz - n.z * vn, hl = len(hx, hy, hz) || 1;
        Object.assign(s, { k: 'torp', x: e.x, y: e.y, z: e.z, dx: hx / hl, dy: hy / hl, dz: hz / hl, life: s.t + 100, run: 0 });
        return true;
      }
      if (s.blast > 0 && s.net) { if (s.blast < 8) boomFX(b, e, s.blast, true, F); } // (a big one: its owner's boom shows it)
      else if (s.blast > 0) explode(b, e, s.blast, s.dmg, s.owner, F, s.k === 'bullet');
      else if (Math.random() < 0.35) {
        const n = { x: e.x / L.r, y: e.y / L.r, z: e.z / L.r };
        if (water) FX.splash(b, e, n, 2); else FX.puff(b, e, { x: n.x * 3, y: n.y * 3, z: n.z * 3 }, 1, '#9a8f7c');
      }
      return false;
    }
    s.x = e.x; s.y = e.y; s.z = e.z;
    return true;
  }
  const lerp3 = (a, e, t) => ({ x: a.x + (e.x - a.x) * t, y: a.y + (e.y - a.y) * t, z: a.z + (e.z - a.z) * t });
  // A cluster bomb's casing splits: its bomblets scatter and fall on their own.
  function burst(s, at, F) {
    FX.explosion(s.b, at, { x: s.vx, y: s.vy, z: s.vz }, 0.8, true);
    for (let i = 0; i < s.cluster; i++) {
      const a = Math.random() * TAU, k = 3 + Math.random() * 9, up = len(at.x, at.y, at.z);
      const ex = { x: -at.y / up, y: at.x / up, z: 0 }, el = len(ex.x, ex.y, ex.z) || 1, nx = ex.x / el, ny = ex.y / el, nz = ex.z / el;
      const ox = (at.y * nz - at.z * ny) / up, oy = (at.z * nx - at.x * nz) / up, oz = (at.x * ny - at.y * nx) / up; // the other horizontal direction
      const cx = Math.cos(a) * k, cy = Math.sin(a) * k;
      S.shots.push({ k: 'bomb', small: true, b: s.b, x: at.x, y: at.y, z: at.z, vx: s.vx + nx * cx + ox * cy, vy: s.vy + ny * cx + oy * cy, vz: s.vz + nz * cx + oz * cy,
        dx: 0, dy: 0, dz: 0, t: 1, life: 60, dmg: s.dmg, blast: s.blast, owner: s.owner });
    }
  }
  // A torpedo runs just under the surface at 30 m/s, turning towards the nearest boat or ship within 4 km.
  function swim(s, h, F) {
    const b = s.b;
    s.t += h; s.run += h;
    if (s.t > s.life) return false;
    let best = null, bd = 4000;
    for (const t of S.targets) if (t.alive && t.def.sea) { const d = len(t.pos.x - s.x, t.pos.y - s.y, t.pos.z - s.z); if (d < bd) { bd = d; best = t; } }
    const r = len(s.x, s.y, s.z), nx = s.x / r, ny = s.y / r, nz = s.z / r;
    if (best && s.run > 1) {
      let tx = best.pos.x - s.x, ty = best.pos.y - s.y, tz = best.pos.z - s.z;
      const k = tx * nx + ty * ny + tz * nz; tx -= nx * k; ty -= ny * k; tz -= nz * k;
      const tl = len(tx, ty, tz) || 1, m = Math.min(1, 0.6 * h);
      s.dx += (tx / tl - s.dx) * m; s.dy += (ty / tl - s.dy) * m; s.dz += (tz / tl - s.dz) * m;
    }
    const k = s.dx * nx + s.dy * ny + s.dz * nz; s.dx -= nx * k; s.dy -= ny * k; s.dz -= nz * k;
    const dl = len(s.dx, s.dy, s.dz) || 1; s.dx /= dl; s.dy /= dl; s.dz /= dl;
    const a = { x: s.x, y: s.y, z: s.z }, sp = 30;
    s.x += s.dx * sp * h; s.y += s.dy * sp * h; s.z += s.dz * sp * h;
    const r2 = len(s.x, s.y, s.z), k2 = (b.radius - 1.2) / r2; s.x *= k2; s.y *= k2; s.z *= k2; // just under the surface
    s.vx = s.dx * sp; s.vy = s.dy * sp; s.vz = s.dz * sp;
    for (const t of S.targets) {
      if (!t.alive || !t.def.sea) continue;
      const c = targetCentre(t), [, d] = segPoint(a.x, a.y, a.z, s.x, s.y, s.z, c.x, c.y, c.z);
      if (d < t.def.r + 2) { explode(b, s, s.blast, s.dmg, s.owner, F); FX.splash(b, s, { x: nx, y: ny, z: nz }, 14); return false; }
    }
    const L = Terrain.locate(b, s.x, s.y, s.z, {});
    if (!Terrain.waterAt(b, L.a, L.z) || Terrain.heightAt(b, L.a, L.z) > -2) { explode(b, s, s.blast * 0.5, s.dmg * 0.3, s.owner, F, true); return false; } // ran aground
    if (Math.random() < h * 6 && F.warpIdx <= 1) FX.splash(b, { x: s.x * (1 + 1.2 / r2), y: s.y * (1 + 1.2 / r2), z: s.z * (1 + 1.2 / r2) }, { x: nx, y: ny, z: nz }, 1);
    return true;
  }
  // Lead pursuit: steer for where the target will be when the missile gets there, as hard as the airframe
  // allows; a heat seeker that loses sight of its target flies on blind.
  // ---------------------------------------------------------------- air-to-air seekers (and SAMs)
  // Inspired by War Thunder: the motor burns for a few seconds and then the missile coasts, losing speed to drag
  // and to every turn; the fins only pull their full g with enough air flowing past; the seeker sees only so far
  // off the nose and can only swing so fast; heat seekers can be decoyed by flares (more easily when the target
  // throttles back), and radar missiles need the launcher's radar on the target all the way: turn away, fly low
  // across its beam ("notching") or drop chaff, and they go dumb. They arm a moment after launch.
  const QREF = 0.5 * 1.225 * 400 * 400; // the dynamic pressure at which the fins give their full g
  function airframe(w) {
    if (w.seek !== 'air') return {};
    const radar = !!w.radar;
    return { air: true, sarh: radar, drag: w.drag || (radar ? 1.1e-4 : 1.6e-4), bleed: w.bleed || 0.012, gimbal: w.gimbal || (radar ? 1.1 : 0.6),
      track: w.track || (radar ? 1.0 : 0.7), arm: w.arm != null ? w.arm : 0.6, irccm: w.irccm || 0, nav: 4, cm: new WeakSet(), lostT: 0, notchT: 0, trackT: 0 };
  }
  // How bright a craft is to a heat seeker looking from `from` (1: a fighter jet at full dry power seen from
  // behind): its engines by thrust and afterburner (propellers and rotors run cooler) plus the warm airframe;
  // from the side about a third of that, head-on a tenth (unless the afterburner is lit).
  function irSig(o, from) {
    if (!o || !o.parts) return 1; // a target drone
    let e = 0, ab = 0;
    for (const p of o.parts) if (p.def.thrust && p.firing > 0) {
      const air = p.def.air;
      e += p.firing * p.def.thrust * (1 + 1.5 * (p.ab || 0)) * (air && (air.kind === 'prop' || air.kind === 'rotor') ? 0.5 : 1);
      ab = Math.max(ab, p.ab || 0);
    }
    let sig = e / 120 + 0.08;
    if (from) {
      const dx = o.x - from.x, dy = o.y - from.y, dz = o.z - from.z, d = len(dx, dy, dz) || 1, f = noseDir(o);
      const c = (dx * f.x + dy * f.y + dz * f.z) / d, head = 0.1 + 0.2 * ab; // c = 1: we see its tail
      sig *= c >= 0 ? 0.35 + 0.65 * c : 0.35 + (0.35 - head) * c;
    }
    return sig;
  }
  // Can L's radar see t (at tp) right now? Within 60° of its nose and the radar's reach (shorter for a stealthy
  // target, and for a jamming one beyond 5 km), and not lost in the ground clutter: a target low down (below L,
  // or under 300 m) moving across the beam (under 40 m/s over the ground along it) is notching. True, 'notch' or false.
  function radarSees(L, t, tp) {
    if (!L || L.dead || !L.parts || !L.parts.length || !tp || !tp.alive) return false;
    const dx = tp.x - L.x, dy = tp.y - L.y, dz = tp.z - L.z, d = len(dx, dy, dz) || 1;
    let reach = (radarOf(L) || 5000) * (1 - (t.parts ? stealthOf(t) : 0));
    if (t.parts && jams(t) && d > 5000) reach = Math.max(5000, reach * 0.7);
    if (d > reach) return false;
    const f = noseDir(L);
    if ((dx * f.x + dy * f.y + dz * f.z) / d < 0.5) return false;
    if (t.parts) {
      const vr = (tp.vx * dx + tp.vy * dy + tp.vz * dz) / d; // (its speed along the beam over the ground: the clutter's doppler is zero)
      const low = len(tp.x, tp.y, tp.z) < len(L.x, L.y, L.z) - 50 || (t.groundAltitude ? t.groundAltitude() < 300 : false);
      if (low && Math.abs(vr) < 40) return 'notch';
    }
    return true;
  }
  // Countermeasures the seeker sees around the target, each weighed once: a flare against the craft's heat,
  // a chaff cloud (radar missiles) about 1 in 7, or 3 in 5 if the target is crossing the beam.
  function decoyed(s, t, tp, rx, ry, rz, d) {
    for (const f of S.flares) {
      if (s.cm.has(f) || (s.heat ? !f.flare : !f.chaff)) continue;
      const fx = f.x - s.x, fy = f.y - s.y, fz = f.z - s.z, fd = len(fx, fy, fz) || 1;
      if (fd > d + 800 || (fx * rx + fy * ry + fz * rz) / fd < Math.cos(s.heat ? 0.3 : 0.15)) continue;
      s.cm.add(f);
      if (s.heat) {
        const K = 0.3 * clamp(1 - f.t / 3, 0, 1); // a flare burns out in 3 s
        if (Math.random() < Math.min(0.85, K / (K + irSig(t, s))) * (1 - s.irccm)) { s.target = f; return true; }
      } else if (len(f.x - tp.x, f.y - tp.y, f.z - tp.z) < 250) {
        const vr = Math.abs(tp.vx * rx + tp.vy * ry + tp.vz * rz);
        if (Math.random() < (vr < 80 ? 0.6 : 0.15)) { s.target = null; return true; }
      }
    }
    return false;
  }
  // Steer by proportional navigation; returns the g pulled (turning costs speed: moveShot).
  function guideAir(s, h, spd, rho) {
    const t = s.target;
    if (!t) return 0;
    const tp = refPos(t);
    if (!tp || !tp.alive) { s.target = null; return 0; }
    if (s.sarh && !t.flare) { // the launcher's radar must hold the target: notching gets 0.4 s of grace, a lost lock 1 s of memory
      const r = radarSees(s.launcher, t, tp);
      s.notchT = r === 'notch' ? s.notchT + h : 0;
      s.lostT = r === true || (r === 'notch' && s.notchT < 0.4) ? 0 : s.lostT + h;
      if (s.lostT > 1) { s.target = null; return 0; }
    }
    if (s.t > 0.35 + s.burn && spd < 150) { s.target = null; return 0; } // too slow to steer any more
    let rx = tp.x - s.x, ry = tp.y - s.y, rz = tp.z - s.z;
    const d = len(rx, ry, rz) || 1;
    rx /= d; ry /= d; rz /= d;
    if (rx * s.dx + ry * s.dy + rz * s.dz < Math.cos(s.gimbal)) { s.target = null; return 0; } // off the edge of the seeker's view
    if (!t.flare && decoyed(s, t, tp, rx, ry, rz, d)) return 0;
    // the line of sight swinging faster than the seeker can follow breaks the lock
    const vrx = tp.vx - s.vx, vry = tp.vy - s.vy, vrz = tp.vz - s.vz;
    const wx = (ry * vrz - rz * vry) / d, wy = (rz * vrx - rx * vrz) / d, wz = (rx * vry - ry * vrx) / d, wl = len(wx, wy, wz);
    s.trackT = wl > s.track ? s.trackT + h : 0;
    if (s.trackT > 0.25 && d > 60) { s.target = null; return 0; }
    // a = N · closing speed · (LOS rate × LOS), across the nose, up to what the fins can pull here
    const vc = Math.max(60, -(rx * vrx + ry * vry + rz * vrz));
    let ax = s.nav * vc * (wy * rz - wz * ry), ay = s.nav * vc * (wz * rx - wx * rz), az = s.nav * vc * (wx * ry - wy * rx);
    const ad = ax * s.dx + ay * s.dy + az * s.dz;
    ax -= s.dx * ad; ay -= s.dy * ad; az -= s.dz * ad;
    const gmax = s.turn * 9.81 * Math.min(1, (0.5 * rho * spd * spd) / QREF);
    let al = len(ax, ay, az);
    if (al > gmax) { const k = gmax / al; ax *= k; ay *= k; az *= k; al = gmax; }
    const sp = Math.max(spd, 50);
    const nx = s.dx + (ax / sp) * h, ny = s.dy + (ay / sp) * h, nz = s.dz + (az / sp) * h, nl = len(nx, ny, nz) || 1;
    s.dx = nx / nl; s.dy = ny / nl; s.dz = nz / nl;
    s.vx = s.dx * spd; s.vy = s.dy * spd; s.vz = s.dz * spd;
    return al / 9.81;
  }
  function guide(s, h, spd) {
    const tp = refPos(s.target);
    if (!tp || !tp.alive) { s.target = null; return; }
    const dx = tp.x - s.x, dy = tp.y - s.y, dz = tp.z - s.z, d = len(dx, dy, dz);
    const close = Math.max(150, spd - ((tp.vx * dx + tp.vy * dy + tp.vz * dz) / (d || 1)));
    const tgo = Math.min(d / close, 12);
    let ax = dx + tp.vx * tgo, ay = dy + tp.vy * tgo, az = dz + tp.vz * tgo;
    const al = len(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    const cos = clamp(ax * s.dx + ay * s.dy + az * s.dz, -1, 1), ang = Math.acos(cos);
    if (s.heat && ang > 1.2) { s.target = null; return; } // out of the seeker's view
    const maxTurn = ((s.turn * 9.81) / Math.max(spd, 50)) * h;
    const k = ang > 1e-6 ? Math.min(1, maxTurn / ang) : 1;
    let nx = s.dx + (ax - s.dx) * k, ny = s.dy + (ay - s.dy) * k, nz = s.dz + (az - s.dz) * k;
    const nl = len(nx, ny, nz) || 1; s.dx = nx / nl; s.dy = ny / nl; s.dz = nz / nl;
    s.vx = s.dx * spd; s.vy = s.dy * spd; s.vz = s.dz * spd;
  }

  // ---------------------------------------------------------------- the other players' fire (multiplayer)
  // Copies of their rockets, bombs and missiles fly here for show only (dmg 0, no hit tests): their owners
  // say what they hit. Their flares work on our missiles, which fly here.
  const bodyOf = (id) => (typeof BODY_BY_ID !== 'undefined' && typeof id === 'string' && Object.prototype.hasOwnProperty.call(BODY_BY_ID, id) && BODY_BY_ID[id]) || EARTH;
  const vec = (a) => (Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) ? a : null);
  function netShot(g, m) {
    const P = vec(m.P), V = vec(m.V), D = vec(m.D) || [0, 0, 0], bomb = m.k === 'bomb';
    if (!g || !P || !V) return;
    S.shots.push({ k: bomb ? 'bomb' : 'rocket', b: bodyOf(m.b), x: P[0], y: P[1], z: P[2], vx: V[0], vy: V[1], vz: V[2], dx: D[0], dy: D[1], dz: D[2],
      t: 0, life: bomb ? 90 : 9, burn: clamp(+m.burn || 0, 0, 150), accel: clamp(+m.accel || 0, 0, 400), dmg: 0, blast: bomb ? 30 : 9, small: !!m.small, torpedo: !!m.torpedo, owner: g, net: g.remote });
  }
  // a missile of theirs: dead-reckoned between their updates; aimed at us (target), it sets off our warning
  function netMissile(g, m, target) {
    const P = vec(m.P), V = vec(m.V), D = vec(m.D) || [0, 0, 1];
    if (!g || !P || !V || m.id == null) return;
    S.shots.push({ k: 'missile', b: bodyOf(m.b), x: P[0], y: P[1], z: P[2], vx: V[0], vy: V[1], vz: V[2], dx: D[0], dy: D[1], dz: D[2], t: 0, seen: 0, life: 200,
      dmg: 0, blast: 0, seek: m.agm ? 'ground' : 'air', heat: !m.radar && !m.agm, radar: !!m.radar, glide: !!m.glide, target: target || null,
      owner: g, launcher: g, enemy: true, net: m.f != null ? m.f : g.remote, netId: m.id });
  }
  const replica = (pid, id) => S.shots.find((q) => q.netId === id && q.net === pid);
  function netMissileUpdate(pid, id, m) {
    const s = replica(pid, id), P = vec(m.P), V = vec(m.V), D = vec(m.D);
    if (!s || !P) return;
    s.ex = P[0] - s.x; s.ey = P[1] - s.y; s.ez = P[2] - s.z; s.bt = 0.15; // eased in over 0.15 s
    if (len(s.ex, s.ey, s.ez) > 400) { s.x = P[0]; s.y = P[1]; s.z = P[2]; s.ex = s.ey = s.ez = 0; } // (too far off: jump)
    if (V) { s.vx = V[0]; s.vy = V[1]; s.vz = V[2]; }
    if (D) { s.dx = D[0]; s.dy = D[1]; s.dz = D[2]; }
    s.seen = s.t;
    if (m.tg !== (typeof Net !== 'undefined' ? Net.me : 0)) s.target = null; // no longer after us
  }
  function netMissileEnd(pid, id) {
    const s = replica(pid, id);
    if (!s) return;
    S.shots.splice(S.shots.indexOf(s), 1);
    FX.puff(s.b, { x: s.x, y: s.y, z: s.z }, { x: 0, y: 0, z: 0 }, 2, '#cfd5dc'); // (its blast comes as a boom)
  }
  function moveReplica(s, h, F) {
    s.t += h;
    if (s.t > s.life || s.t - s.seen > 3) return false; // (its end may have gone missing)
    if (s.bt > 0) { const k = Math.min(1, h / s.bt); s.x += s.ex * k; s.y += s.ey * k; s.z += s.ez * k; s.ex -= s.ex * k; s.ey -= s.ey * k; s.ez -= s.ez * k; s.bt -= h; }
    s.x += s.vx * h; s.y += s.vy * h; s.z += s.vz * h;
    if (!s.glide && Math.random() < h * 30 && F.warpIdx <= 1) FX.add({ kind: 'smoke', b: s.b, x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, max: 1.6, size: 0.5, grow: 3.5, color: '#d8dce2', alpha: 0.55 });
    return true;
  }
  // their flares and chaff: for show, and our heat seekers after that craft may go for a flare
  // (each flare of a pair comes on its own: about the same odds per pair as ours)
  function netFlares(g, m) {
    const P = vec(m.P), V = vec(m.V);
    if (!g || !P || !V) return;
    const f = { b: g.body, x: P[0], y: P[1], z: P[2], vx: V[0], vy: V[1], vz: V[2], t: 0, life: m.chaff ? 5 : 4, remote: g.remote };
    if (m.chaff) f.chaff = true; else f.flare = true;
    S.flares.push(f); // (our heat seekers chasing that craft may go for it: decoyed)
  }
  const netBoom = (b, at, blast) => { if (at && Number.isFinite(at.x)) boomFX(b || EARTH, at, +blast || 5, false, typeof Flight !== 'undefined' ? Flight : null); };

  // ---------------------------------------------------------------- targets
  function hitTarget(e, dmg, by, sim) {
    if (!e.alive || !(dmg > 0)) return;
    e.hp -= dmg;
    if (by) e.lastHitBy = by;
    if (e.hp > 0) return;
    e.alive = false; e.deadAt = sim.time; e.firing = false; e.vel = null;
    const c = targetCentre(e);
    FX.explosion(EARTH, c, { x: 0, y: 0, z: 0 }, clamp(e.def.r / 1.4, 2, 9), true);
    if (by === sim.active) {
      S.kills++;
      sim.toast(`${e.def.name} destroyed`, 'kill');
      Sound.explode();
    }
  }
  function aiDown(v, sim) {
    v.ai.down = true; v.aiFire = false;
    if (v.lastHitBy === sim.active) { S.kills++; sim.toast('Bandit shot down!', 'kill'); }
  }
  // positions on the planet in the space centre's terms: metres along the track (e) and across it (z)
  function at(e, z, h) {
    const a = siteAngle(EARTH, e), phi = z / R(), r = R() + h, cp = Math.cos(phi);
    return { x: r * cp * Math.cos(a), y: r * cp * Math.sin(a), z: r * Math.sin(phi) };
  }
  const groundAt = (e, z) => Terrain.surfaceAt(EARTH, siteAngle(EARTH, e), z);
  const rawAt = (e, z) => Terrain.heightAt(EARTH, siteAngle(EARTH, e), z);
  // land good for a target: dry, not too steep or high, off the runway and out of the space centre
  function landOk(e, z) {
    const h = rawAt(e, z);
    if (!(h > 2 && h < 220)) return false;
    if (Math.abs(z) < 140 && e > -900 && e < EARTH.causeway.shore + 400) return false;
    if (Math.hypot(e - 1300, z) < 2200) return false;
    return groundAt(e, z) <= h + 0.5 && Math.abs(rawAt(e + 25, z) - h) < 12 && Math.abs(rawAt(e, z + 25) - h) < 12;
  }
  const seaOk = (e, z) => rawAt(e, z) < -12 && Math.abs(z) > 250;
  function place(kind, tries = 400) {
    const def = TARGET_KINDS[kind];
    for (let i = 0; i < tries; i++) {
      let e, z;
      if (def.land) { const shet = rnd() < 0.45; e = shet ? 17200 + rnd() * 3600 : -2500 + rnd() * 6500; z = (rnd() - 0.5) * (shet ? 6000 : 8000); if (!landOk(e, z)) continue; }
      else if (def.sea) { e = 2500 + rnd() * 14000; z = (rnd() - 0.5) * 14000; if (!seaOk(e, z)) continue; }
      else { e = 3000 + rnd() * 13000; z = (rnd() - 0.5) * 10000; }
      return { e, z };
    }
    return null;
  }
  function makeTarget(kind) {
    const def = TARGET_KINDS[kind], spot = place(kind);
    if (!spot) return null;
    const t = { kind, def, e: spot.e, z: spot.z, hp: def.hp, alive: true, heading: rnd() * TAU, turnT: 10 + rnd() * 20, fireT: rnd() * 4, burst: 0, firing: false };
    if (def.air) { t.cx = spot.e; t.cz = spot.z; t.rad = 900 + rnd() * 900; t.ang = rnd() * TAU; t.alt = 500 + rnd() * 900; t.dir = rnd() < 0.5 ? -1 : 1; }
    syncTarget(t, 0);
    return t;
  }
  function spawnAll(F) {
    seed = 1234 + ((F.time * 10) | 0);
    S.targets = [];
    for (const kind in TARGET_LAYOUT) for (let i = 0; i < TARGET_LAYOUT[kind]; i++) { const t = makeTarget(kind); if (t) S.targets.push(t); }
    S.spawned = true;
  }
  // move a target and work out where it is in 3D
  function syncTarget(t, dt) {
    const def = t.def;
    if (t.alive && def.air) {
      t.ang += (t.dir * def.speed * dt) / t.rad;
      t.e = t.cx + Math.cos(t.ang) * t.rad; t.z = t.cz + Math.sin(t.ang) * t.rad;
      t.heading = t.ang + (t.dir * Math.PI) / 2;
      const alt = Math.max(t.alt, groundAt(t.e, t.z) + 200);
      const p0 = t.pos, p = at(t.e, t.z, alt);
      t.vel = p0 && dt > 0 ? { x: (p.x - p0.x) / dt, y: (p.y - p0.y) / dt, z: (p.z - p0.z) / dt } : { x: 0, y: 0, z: 0 };
      t.pos = p; t.h = alt;
      return;
    }
    if (t.alive && def.speed && dt > 0) {
      t.turnT -= dt;
      if (t.turnT <= 0) { t.heading += (rnd() - 0.5) * 1.6; t.turnT = 12 + rnd() * 20; }
      const s = def.speed * dt, ne = t.e + Math.cos(t.heading) * s, nz = t.z - Math.sin(t.heading) * s;
      if (def.land ? landOk(ne, nz) : seaOk(ne, nz)) { t.e = ne; t.z = nz; } else t.heading += Math.PI * (0.6 + rnd() * 0.8);
    }
    const g = def.sea ? 0 : groundAt(t.e, t.z), p0 = t.pos, p = at(t.e, t.z, g);
    t.vel = t.alive && def.speed && p0 && dt > 0 ? { x: (p.x - p0.x) / dt, y: (p.y - p0.y) / dt, z: (p.z - p0.z) / dt } : null;
    t.pos = p; t.h = g;
  }
  // hostile AA: bursts of tracers aimed ahead of the player, while in range
  function aaFire(t, h, F) {
    t.fireT -= h;
    if (t.fireT > 0) return;
    const v = F.active, c = targetCentre(t);
    t.fireT = 0.11;
    const dx = v.x - c.x, dy = v.y - c.y, dz = v.z - c.z, d = len(dx, dy, dz), tof = d / 850;
    let ax = dx + v.vx * tof, ay = dy + v.vy * tof, az = dz + v.vz * tof;
    const al = len(ax, ay, az) || 1, s = jams(v) ? 0.03 : 0.012; // a jammer throws their aim off
    ax = ax / al + (Math.random() - 0.5) * s; ay = ay / al + (Math.random() - 0.5) * s; az = az / al + (Math.random() - 0.5) * s;
    S.shots.push({ k: 'bullet', b: EARTH, x: c.x, y: c.y, z: c.z, vx: ax * 850, vy: ay * 850, vz: az * 850, t: 0, life: 4.5, dmg: 6, blast: 0, owner: t, tracer: true, enemy: true });
  }
  function samFire(t, F) {
    const v = F.active, c = targetCentre(t), up = { x: c.x / R(), y: c.y / R(), z: c.z / R() };
    // off the rail towards the target, a little above the line of sight (its seeker has to see it from the start)
    let lx = v.x - c.x, ly = v.y - c.y, lz = v.z - c.z;
    const ll = len(lx, ly, lz) || 1; lx = lx / ll + up.x * 0.25; ly = ly / ll + up.y * 0.25; lz = lz / ll + up.z * 0.25;
    const l2 = len(lx, ly, lz) || 1, d = { x: lx / l2, y: ly / l2, z: lz / l2 };
    S.shots.push({ k: 'missile', b: EARTH, x: c.x, y: c.y, z: c.z, vx: d.x * 40, vy: d.y * 40, vz: d.z * 40, dx: d.x, dy: d.y, dz: d.z, t: 0.35, life: 26,
      burn: 5, accel: 220, vmax: 950, turn: 22, dmg: 300, blast: 13, seek: 'air', heat: true, target: v, owner: t, enemy: true, ...airframe({ seek: 'air', drag: 1.2e-4, arm: 0.4 }) });
    if (len(v.x - c.x, v.y - c.y, v.z - c.z) < 12000) F.toast('SAM launch!', 'warn');
  }

  // ---------------------------------------------------------------- enemy fighters
  function spawnFighter(F) {
    const parts = RAIDER.map(([type, x, y, rot]) => makePart(type, x, y, { flip: x < 0, rot: rot || 0 }));
    const adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
    const ps = parts.filter((p) => keep.has(p.id)), adj = new Map();
    for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
    const v = new Vessel(ps, adj, EARTH);
    v.kind = 'plane'; v.name = 'Bandit'; v.sas = 'off'; v.throttle = 0.95; v.gearUp = true;
    v.stages = computeStages(ps, adj, ctrl.id);
    for (const p of v.parts) { if (p.def.thrust) p.active = true; if (p.def.wheel && p.def.wheel.retract) p.retracted = true; }
    v.rebuildGroups();
    // somewhere 12-16 km from the player, 1.5-2.5 km up, flying towards them
    const pl = F.active, up0 = norm3(v3(pl.x, pl.y, pl.z)), Fr = surfaceFrame(pl.x, pl.y, pl.z), a = rnd() * TAU, d = 12000 + rnd() * 4000;
    const dir = v3(Fr.east.x * Math.cos(a) + Fr.north.x * Math.sin(a), Fr.east.y * Math.cos(a) + Fr.north.y * Math.sin(a), Fr.east.z * Math.cos(a) + Fr.north.z * Math.sin(a));
    const R0 = len(pl.x, pl.y, pl.z), p = v3(pl.x + dir.x * d, pl.y + dir.y * d, pl.z + dir.z * d), pr = len(p.x, p.y, p.z);
    const alt = Math.max(1500 + rnd() * 1000, (pl.altitude ? pl.altitude() : 0) + 500);
    const r = EARTH.radius + alt;
    v.x = (p.x / pr) * r; v.y = (p.y / pr) * r; v.z = (p.z / pr) * r;
    const up = norm3(v3(v.x, v.y, v.z)), fwd = v3(-dir.x, -dir.y, -dir.z);
    const k = dot3(fwd, up); fwd.x -= up.x * k; fwd.y -= up.y * k; fwd.z -= up.z * k; norm3(fwd);
    const nx = v3(-up.x, -up.y, -up.z);
    v.q = qbasis(nx, fwd, cross3(nx, fwd));
    v.av = v3();
    v.vx = fwd.x * 230; v.vy = fwd.y * 230; v.vz = fwd.z * 230;
    v.ai = { t: 0, down: false };
    void R0; void up0;
    F.vessels.push(v);
    return v;
  }
  // The fighter's pilot: chase the player (aiming ahead of them), roll the lift onto them and pull,
  // fire when the pipper is on; pull up from the ground first of all.
  function flyFighter(v, F, dt) {
    const pl = F.active, ai = v.ai;
    ai.t += dt;
    if (!v.control || ai.hold) { v.aiFire = false; return; }
    const up = norm3(v3(v.x, v.y, v.z)), fwd = noseDir(v), bodyUp = v.axis(-1, 0, 0), right = v.axis(0, 0, 1); // (a plane's part z points to its right)
    let want, engage = false;
    const tgtOk = pl && pl !== v && pl.parts.length && !F.destroyed && pl.body === v.body && (!pl.landed || pl.speed() > 20);
    let d = Infinity;
    if (tgtOk) {
      const dx = pl.x - v.x, dy = pl.y - v.y, dz = pl.z - v.z;
      d = len(dx, dy, dz);
      if (d < 16000 * (1 - (pl.stealth || 0))) {
        engage = true;
        const tof = Math.min(d / 1000, 3);
        want = norm3(v3(dx + (pl.vx - v.vx) * tof, dy + (pl.vy - v.vy) * tof, dz + (pl.vz - v.vz) * tof));
      }
    }
    if (!want) { // orbit the islands
      const c = at(9000, 0, 2500), dx = c.x - v.x, dy = c.y - v.y, dz = c.z - v.z;
      want = norm3(v3(dx, dy, dz));
      const k = dot3(want, up); want.x -= up.x * k * 0.8; want.y -= up.y * k * 0.8; want.z -= up.z * k * 0.8; norm3(want);
    }
    const ga = v.groundAltitude(), vs = v.vSpeed();
    if (ga < 450 || (ga < 1200 && vs < -ga / 8)) { // the ground: climb away from it
      const k = clamp((900 - ga) / 600, 0.3, 1);
      want = norm3(v3(fwd.x + up.x * k * 2, fwd.y + up.y * k * 2, fwd.z + up.z * k * 2));
    }
    // errors in the craft's own frame
    const wu = dot3(want, bodyUp), wr = dot3(want, right), wf = dot3(want, fwd);
    const off = Math.acos(clamp(wf, -1, 1));
    // roll the target overhead (lift towards it), or, when it's dead ahead, level the wings (right wing high: roll right)
    const bankErr = off > 0.08 ? Math.atan2(wr, Math.max(wu, -0.3)) : Math.asin(clamp(dot3(right, up), -1, 1)) * 0.5;
    v.ctl.h = clamp(bankErr * 2.2 - dot3(v.av, fwd) * 0.6, -1, 1);
    const pullK = Math.abs(bankErr) < 0.9 ? 1 : 0.3;
    const strainEase = v.strain > 0.75 ? 0.4 : 1;
    v.ctl.v = clamp(-Math.atan2(wu, Math.max(wf, 0.05)) * 3 * pullK * strainEase, -1, 0.35);
    v.ctl.r = clamp(-wr * 0.8, -0.5, 0.5);
    v.throttle = engage && d > 6000 ? 1 : 0.86; // afterburner only to close a long way
    // shoot when the aim is good and the player is close
    v.aiFire = engage && hostile() && d < 1100 && off < 0.05;
    // flares against a missile on its tail
    if ((ai.flareT = (ai.flareT || 0) - dt) <= 0) {
      for (const m of S.shots) if (m.k === 'missile' && m.target === v && len(m.x - v.x, m.y - v.y, m.z - v.z) < 1800) { if (flares(v, F)) ai.flareT = 0.7; break; }
    }
  }

  // ---------------------------------------------------------------- the per-frame update
  function frame(F, dt) {
    const v = F.active;
    if (!F.running || !v) return;
    const onEarth = v.body === EARTH, near = onEarth && len(v.x - at(8000, 0, 0).x, v.y - at(8000, 0, 0).y, v.z - at(8000, 0, 0).z) < 60000;
    const m = mode();
    // the range: spawn once the player is near it (and on), keep it while they stay
    if (m !== 'off' && near && !S.spawned && Terrain.earthMap.state === 'ready') spawnAll(F);
    if ((m === 'off' || !near) && S.spawned) clearTargets(F);
    if (S.spawned) {
      for (const t of S.targets) {
        if (t.alive) syncTarget(t, dt);
        else if (F.time - t.deadAt > 60) Object.assign(t, makeTarget(t.kind) || {}); // a new one, somewhere else
      }
      // hostile sites wake when the player is near and flying (and see a stealthy craft much later)
      const flying = !v.landed && v.altitude() > 40, st = v.stealth = stealthOf(v);
      for (const t of S.targets) {
        t.firing = false;
        if (!t.alive || !hostile() || !flying || F.destroyed) continue;
        const c = targetCentre(t), d = len(v.x - c.x, v.y - c.y, v.z - c.z);
        if (t.def.aa && d < 3500 * (1 - 0.6 * st)) { t.burst = (t.burst || 0) + dt; t.firing = t.burst % 7 < 3; }
        if (t.def.sam && d < 9000 * (1 - st) && v.altitude() > 150) {
          t.samT = (t.samT == null ? 4 : t.samT) - dt;
          if (t.samT <= 0 && !S.shots.some((s) => s.owner === t)) { samFire(t, F); t.samT = 22; }
        }
      }
      // enemy fighters in hostile mode: two at a time
      if (hostile() && !F.destroyed) {
        const alive = F.vessels.filter((o) => o.ai && !o.ai.down && o.control && !o.dead);
        S.fighterT -= dt;
        if (alive.length < 2 && S.fighterT <= 0 && !v.landed) { spawnFighter(F); S.fighterT = 45; }
      }
    }
    for (const o of F.vessels) if (o.ai && !o.dead) {
      if (o.control && !o.ai.down) flyFighter(o, F, dt);
      if (!o.control && !o.ai.down) aiDown(o, F);
      if (!hostile() || !near) o.dead = true;
    }
    // heat seekers on the player's tail: warning tone, and flares go out by themselves (not in multiplayer: K there)
    S.warn = false;
    const auto = !mpOn();
    for (const s of S.shots) if (s.k === 'missile' && s.target === v && s.enemy) {
      const d = len(s.x - v.x, s.y - v.y, s.z - v.z);
      // a radar missile lights up the warner; in multiplayer a heat seeker is silent unless a jammer pod
      // (doubling as a missile warner) sees it within 2 km
      if (auto || s.radar || s.sarh || (jams(v) && d < 2000)) S.warn = true;
      if (auto && d < 2200 && (S.flareT = (S.flareT || 0) - dt) <= 0 && flares(v, F)) S.flareT = 0.6;
    }
    if (S.warn) { S.warnT -= dt; if (S.warnT <= 0) { Sound.beep(1500); S.warnT = 0.22; } }
    for (const f of S.flares) {
      if (f.chaff) { if (Math.random() < 0.3) FX.add({ kind: 'smoke', b: f.b, x: f.x, y: f.y, z: f.z, vx: 0, vy: 0, vz: 0, max: 1.5, size: 1.5, grow: 4, color: '#c9ced6', alpha: 0.35 }); } // a glinting cloud
      else if (Math.random() < 0.9) FX.add({ kind: 'fire', b: f.b, x: f.x, y: f.y, z: f.z, vx: 0, vy: 0, vz: 0, max: 0.6, size: 1.2, grow: 1.5, color: '#fff2c4', alpha: 1 });
    }
    playerFrame(F, dt);
    // a radar lock on another player's craft lights up their warner (sent again every second while it holds)
    const lk = S.lock && S.lock.remote && S.lockR ? S.lock.remote : 0;
    if (typeof MP !== 'undefined' && (lk !== S.lockPid || (lk && performance.now() - S.lockAt > 1000))) { MP.sendLock(lk, !!lk); S.lockPid = lk; S.lockAt = performance.now(); }
    // damaged parts smoke, badly damaged ones burn; leaking tanks lose fuel
    S.smokeT -= dt;
    if (S.smokeT <= 0) {
      S.smokeT = 0.07;
      for (const o of F.vessels) {
        if (o.dead || o.body !== v.body || len(o.x - v.x, o.y - v.y, o.z - v.z) > 5000) continue;
        for (const p of o.parts) {
          if (p.hp == null) continue;
          const f = hpFrac(p);
          if (f > 0.6) continue;
          const wp = o.toWorld(p.x, p.y, 0);
          FX.add({ kind: 'smoke', b: o.body, x: wp.x, y: wp.y, z: wp.z, vx: o.vx * 0.85, vy: o.vy * 0.85, vz: o.vz * 0.85, max: 2.5, size: 0.8, grow: 4, color: f < 0.3 ? '#2b2d31' : '#5d6168', alpha: 0.65 });
          if (f < 0.3) FX.add({ kind: 'fire', b: o.body, x: wp.x, y: wp.y, z: wp.z, vx: o.vx * 0.9, vy: o.vy * 0.9, vz: o.vz * 0.9, max: 0.35, size: 0.8, grow: 1.2, color: '#ff9a3c', alpha: 1 });
          if (f < 0.5 && p.fuel > 0) p.fuel = Math.max(0, p.fuel - (0.5 - f) * 40 * 0.07);
        }
      }
    }
  }
  function clearTargets(F) {
    S.targets = []; S.spawned = false;
    for (const o of F.vessels) if (o.ai) o.dead = true;
  }
  function reset(F) {
    S.shots = []; S.flares = []; S.targets = []; S.spawned = false; S.lock = S.cand = null; S.lockT = 0; S.warn = false; S.fighterT = 20; S.wasFiring = false;
    S.cmAt = -9; S.gunKey = null; S.lockPid = 0; // (the other players' missile copies and flares went with shots and flares)
    void F;
  }

  // ---------------------------------------------------------------- HUD (drawn over the 3D view)
  function drawHUD(ctx, W, H, dpr, F) {
    const v = F.active;
    if (!v || !v.parts.length || F.destroyed || !Render3D.ready) return;
    const bp = bodyPos(v.body, F.time), pr = (x, y, z) => Render3D.project(bp.x + x, bp.y + y, z);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1.5; ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center';
    const sys = systems(v), cur = sys[v.wsel];
    // targets: brackets with their distance (further with a big radar)
    const seeR = clamp(radarOf(v) * 0.7, 14000, 32000);
    if (S.spawned && v.body === EARTH) {
      for (const t of S.targets) {
        if (!t.alive) continue;
        const c = targetCentre(t), d = len(c.x - v.x, c.y - v.y, c.z - v.z);
        if (d > seeR) continue;
        const s = pr(c.x, c.y, c.z);
        if (s.behind) continue;
        const armed = hostile() && (t.def.aa || t.def.sam), col = armed ? '#ff5d5d' : '#ffb547', k = 7;
        ctx.strokeStyle = col; ctx.globalAlpha = d < 6000 ? 0.95 : 0.6;
        ctx.beginPath();
        ctx.moveTo(s.x - k, s.y - k + 3); ctx.lineTo(s.x - k, s.y - k); ctx.lineTo(s.x - k + 3, s.y - k);
        ctx.moveTo(s.x + k - 3, s.y - k); ctx.lineTo(s.x + k, s.y - k); ctx.lineTo(s.x + k, s.y - k + 3);
        ctx.moveTo(s.x + k, s.y + k - 3); ctx.lineTo(s.x + k, s.y + k); ctx.lineTo(s.x + k - 3, s.y + k);
        ctx.moveTo(s.x - k + 3, s.y + k); ctx.lineTo(s.x - k, s.y + k); ctx.lineTo(s.x - k, s.y + k - 3);
        ctx.stroke();
        if (d < 5000) { ctx.fillStyle = col; ctx.fillText(`${t.def.name} ${fmt.dist(d)}`, s.x, s.y + k + 13); }
      }
      ctx.globalAlpha = 1;
    }
    for (const o of F.vessels) {
      if (!o.ai || o.dead || !o.control || o.ai.down) continue;
      const d = len(o.x - v.x, o.y - v.y, o.z - v.z), s = pr(o.x, o.y, o.z);
      if (s.behind) continue;
      ctx.strokeStyle = '#ff5d5d'; ctx.fillStyle = '#ff5d5d';
      ctx.beginPath(); ctx.moveTo(s.x, s.y - 9); ctx.lineTo(s.x + 9, s.y); ctx.lineTo(s.x, s.y + 9); ctx.lineTo(s.x - 9, s.y); ctx.closePath(); ctx.stroke();
      ctx.fillText(`Bandit ${fmt.dist(d)}`, s.x, s.y + 22);
    }
    // missile seeker: a circle on the candidate, closing to a diamond when it locks
    const cand = S.cand && refPos(S.cand);
    if (cand && cand.alive) {
      const s = pr(cand.x, cand.y, cand.z);
      if (!s.behind) {
        ctx.strokeStyle = S.lock ? '#7dffb0' : '#e9edf1'; ctx.lineWidth = 2;
        const rr = S.lock ? 14 : 22 - 8 * clamp(S.lockT, 0, 1);
        ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, TAU); ctx.stroke();
        if (S.lock) { ctx.fillStyle = '#7dffb0'; ctx.fillText('LOCK', s.x, s.y - 20); }
      }
    }
    // guns: a pipper where the rounds will be 600 m out, and a lead marker on the nearest bandit or drone
    if (cur && (cur.w.kind === 'gun' || cur.w.kind === 'rocket')) {
      const spd = cur.w.kind === 'gun' ? cur.w.speed : 400, fwd = noseDir(v), tof = 600 / spd, up = norm3(v3(v.x, v.y, v.z)), g = 4.9 * tof * tof;
      const px = v.x + (v.vx + fwd.x * spd) * tof - up.x * g, py = v.y + (v.vy + fwd.y * spd) * tof - up.y * g, pz = v.z + (v.vz + fwd.z * spd) * tof - up.z * g;
      const s = pr(px, py, pz);
      if (!s.behind) {
        ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y, 13, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(s.x, s.y, 1.8, 0, TAU); ctx.fillStyle = '#7dffb0'; ctx.fill();
      }
      let best = null, bd = 2000;
      for (const c of candidates(v, 'air', F)) { const d = len(c.x - v.x, c.y - v.y, c.z - v.z); if (d < bd) { bd = d; best = c.ref; } }
      const tp = best && refPos(best);
      if (tp) {
        const t2 = bd / spd, s2 = pr(tp.x + (tp.vx - v.vx) * t2, tp.y + (tp.vy - v.vy) * t2, tp.z + (tp.vz - v.vz) * t2);
        if (!s2.behind) { ctx.strokeStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(s2.x, s2.y, 6, 0, TAU); ctx.stroke(); ctx.fillStyle = '#ffd23f'; ctx.fillText('LEAD', s2.x, s2.y - 10); }
      }
    }
    // bombs: where they would land if released now
    if (cur && cur.w.kind === 'bomb') {
      const ip = bombImpact(v);
      if (ip) {
        const s = pr(ip.x, ip.y, ip.z);
        if (!s.behind) {
          ctx.strokeStyle = '#7dffb0'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(s.x - 10, s.y); ctx.lineTo(s.x + 10, s.y); ctx.moveTo(s.x, s.y - 10); ctx.lineTo(s.x, s.y + 10); ctx.stroke();
          ctx.beginPath(); ctx.arc(s.x, s.y, 16, 0, TAU); ctx.stroke();
          const onT = S.targets.some((t) => t.alive && !t.def.air && len(targetCentre(t).x - ip.x, targetCentre(t).y - ip.y, targetCentre(t).z - ip.z) < cur.w.blast * 0.7);
          ctx.fillStyle = onT ? '#ffd23f' : '#7dffb0'; ctx.fillText(onT ? 'RELEASE' : `${fmt.dist(ip.d)}`, s.x, s.y + 30);
        }
      }
    }
    // a missile on your tail
    if (S.warn && Math.floor(performance.now() / 250) % 2 === 0) {
      ctx.font = '700 22px "Chakra Petch", system-ui, sans-serif'; ctx.fillStyle = '#ff5d5d';
      ctx.fillText('MISSILE', W / 2, H * 0.3);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // The bomb's fall, stepped until it meets the ground (drag as in flight; good to a few metres).
  function bombImpact(v) {
    const b = v.body;
    const s = { x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz };
    for (let i = 0; i < 1200; i++) {
      const r = len(s.x, s.y, s.z), g = b.mu / (r * r), h = 0.05, rho = airDensity(b, r - b.radius), spd = len(s.vx, s.vy, s.vz), kd = 0.00003 * rho * spd * h;
      s.vx -= s.vx * kd + (s.x / r) * g * h; s.vy -= s.vy * kd + (s.y / r) * g * h; s.vz -= s.vz * kd + (s.z / r) * g * h;
      s.x += s.vx * h; s.y += s.vy * h; s.z += s.vz * h;
      if (i % 4 === 0 || r < b.radius + 1500) {
        const L = Terrain.locate(b, s.x, s.y, s.z, {}), gh = Math.max(0, Terrain.surfaceAt(b, L.a, L.z));
        if (L.r < b.radius + gh) return { x: s.x, y: s.y, z: s.z, d: len(s.x - v.x, s.y - v.y, s.z - v.z) };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- controls
  function cycle(F, dir = 1) {
    const v = F.active, sys = v ? systems(v) : [];
    if (!sys.length) return;
    v.wsel = (v.wsel + dir + sys.length) % sys.length;
    S.lock = S.cand = null; S.lockT = 0;
    Sound.click();
  }
  function status(v) {
    const sys = v ? systems(v) : [];
    const sum = (k) => v.parts.filter((p) => p.def.weapon && p.def.weapon.kind === k).reduce((s, p) => s + (p.ammo || 0), 0);
    if (!sys.length) { // only a turret: show its rounds
      if (!v || !v.parts.some((p) => p.def.weapon && p.def.weapon.kind === 'turret')) return null;
      return { name: 'TURRET', ammo: sum('turret'), n: 0, lock: false, kills: S.kills, flares: sum('flare'), stealth: v.stealth || 0 };
    }
    const cur = sys[v.wsel], w = cur.w;
    return { name: w.label || SHORT[w.kind === 'missile' ? (w.seek === 'ground' ? 'agm' : w.radar ? 'radar' : 'aam') : w.kind] || cur.def.name, ammo: ammoOf(cur), n: sys.length,
      lock: !!S.lock, kills: S.kills, flares: sum('flare'), stealth: v.stealth || 0 };
  }
  const SHORT = { gun: 'GUN', rocket: 'RKT', aam: 'AAM', radar: 'AMRAAM', agm: 'AGM', bomb: 'BOMB' };
  function integrity(v) { // the whole craft's health, 0..1
    let a = 0, b = 0;
    for (const p of v.parts) { const m = maxHp(p.def); a += m * hpFrac(p); b += m; }
    return b ? a / b : 1;
  }

  return {
    S, step, frame, reset, damage, impact, explode, engineK, liftK, hpFrac, maxHp, drawHUD, cycle, status, systems, integrity, flares, stealthOf,
    countermeasures, netShot, netMissile, netMissileUpdate, netMissileEnd, netFlares, netBoom,
    get targets() { return S.targets; }, get shots() { return S.shots; }, get flaresList() { return S.flares; },
  };
})();
