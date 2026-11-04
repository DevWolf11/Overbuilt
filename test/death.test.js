// The big update's damage model (js/death.js): what 0 hp does. A: the air rule (aircraft shot apart, engines dead,
// half a wing off, the pilot knocked out, the rare detonation; rockets and Hollywood the old way; helicopters), with
// the credit and HUD gates it opens. B: the fall and the crash. C: ground vehicles knocked out and left as wrecks.
// D: the particle budget. E: saved flights. The checks run the real combat.js and death.js, and the real
// Flight.ripParts and breakParts over Object.create(Flight) stand-ins, at 1/120 s steps; each is written against
// numbers worked out apart from the code (a half wing's lift, a part's health, a mirror case) and fails on the code
// before the update.
//   node test/death.test.js
const G = require('./lib/game.js');
const ctx = G.load({ combat: true, flight: true, props: true }); // (every prop built: none stands where these fly)
ctx.Math.random = () => 0.5; // (the pictures' dice; the damage model's own are its parts' ids)
const R = (c) => G.run(ctx, c);
const { Combat, Death, FX, TEMPLATES, PARTS, EARTH } = ctx;
const SILLY = R('Silly.flags'), wingAero = R('wingAero');
const t = G.checks('death: the damage model (death.js)');
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const PLANES = Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].kind === 'plane');
const HELIS = Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].kind === 'heli');
const maxHp = (p) => Combat.maxHp(p.def);
const dmgTo = (p, f) => (maxHp(p) * f) / (1 - (p.def.armor || 0)); // (what takes a part from full health to f of its own; armour turns the rest)

// The stand-in for Flight: its real ripParts and breakParts (counted), the rest stubbed (no page)
function fsim(active, extra) {
  const F = Object.create(ctx.Flight);
  Object.assign(F, { time: 0, vessels: active ? [active] : [], active: active || null, running: true, destroyed: false, mp: null, camAbs: { x: 0, y: 0, z: 0 },
    warpIdx: 1, firing: false, groundAim: false, flyAim: false, target: null, dist: () => 1e9, absPos: () => ({ x: 0, y: 0, z: 0 }),
    log: [], ondead: 0, nBreak: 0, nRip: 0,
    toast(m) { this.log.push(m); }, onDestroyed() { this.ondead++; this.destroyed = true; } }, extra || {});
  F.breakParts = function (...a) { this.nBreak++; return ctx.Flight.breakParts.apply(this, a); };
  F.ripParts = function (...a) { this.nRip++; return ctx.Flight.ripParts.apply(this, a); };
  return F;
}
const rows = (key) => (key === 'RAIDER' ? ctx.RAIDER : G.templateRows(ctx, key));
// a craft 3 km over the sea, level and still, its first stage's engines lit at 0.9
function air(key, kind = 'plane') { const v = G.craft(ctx, rows(key), kind, 'air'); G.stage(v); v.throttle = 0.9; return v; }
// design rows of a template as flight.test.js builds them (type, place, turn), for adding parts with att
const rowsOf = (k) => TEMPLATES[k].parts.map(([type, x, y, rot]) => ({ type, x, y, flip: x < 0, rot: rot || 0 }));
// a part's share of clS (vessel.js rebuildGroups: a plane's wing)
const clsOf = (p) => { const W = wingAero(p.def, true); return W.vortex ? p.def.wing.area * W.clMax : p.def.wing.area * W.slope * W.stall; };
// FX.death counted (the graphics package's effects; the headless FX may not have it yet)
let deaths = [];
{ const d0 = FX.death; FX.death = function (...a) { deaths.push(a[4]); if (d0) return d0.apply(this, a); }; }
let detonations = 0;
{ const d0 = Death.detonated; Death.detonated = function (...a) { detonations++; return d0.apply(this, a); }; }

// ================================================================ A. the air rule
// A1 the cockpit to -0.01 of its health on every plane template and the raider: the pilot knocked out, nothing torn off
{
  const bad = [];
  for (const key of PLANES.concat(['RAIDER'])) {
    const v = air(key), F = fsim(v), n0 = v.parts.length, ck = v.control, mh = maxHp(ck);
    Combat.damage(v, ck, dmgTo(ck, 1.01), 'shot', F);
    const ok = v.parts.length === n0 && !v.control && ck.ko === true && near(ck.hp, -0.01 * mh, 1e-6) && v.down === true && v.hulkWhy === 'pilot' && v.isDebris === true && v.throttle === 0
      && v.parts.every((q) => !q.def.thrust || q.def.solid || q.active === false) && F.nBreak === 0 && F.nRip === 0 && F.ondead === 1 && F.vessels.length === 1;
    if (!ok) bad.push(key);
  }
  t(`A1 a cockpit shot to 0 on every plane template and the raider (${PLANES.length + 1}): the pilot knocked out, every part aboard, limp (debris, throttle 0, engines off), nothing broken or blown up, the end of the flight once`, !bad.length, bad);
  // the raider as a bandit, shot by the player: shot down at once, the kill and its banner ours
  const P = air('falcon'), B = air('RAIDER'), F = fsim(P);
  F.vessels.push(B); B.ai = { t: 0, down: false }; B.name = 'Bandit';
  Death.reset(F); const k0 = Combat.S.kills;
  Combat.damage(B, B.control, dmgTo(B.control, 1.01), 'shot', F, P);
  t('A1 ...a bandit (the raider) knocked out by the player: shot down (ai.down, "Bandit shot down!", a kill), the PILOT KO banner, no end for the player',
    B.ai.down && F.log.includes('Bandit shot down!') && Combat.S.kills === k0 + 1 && Death.fb.text === 'PILOT KO' && F.ondead === 0 && B.down, [F.log, Death.fb.text]);
}

// A2 every engine of every plane template to -0.1 of its health: dead, aboard; a second hit takes nothing more
{
  const bad = [];
  let n = 0;
  for (const key of PLANES) {
    const v = air(key), F = fsim(v), engs = v.parts.filter((p) => p.def.thrust);
    for (const e of engs) {
      if (!v.parts.includes(e)) { bad.push(key + ':' + e.type + ' gone'); continue; }
      const parts = v.parts.length;
      Combat.damage(v, e, dmgTo(e, 1.1), 'shot', F); n++;
      if (!(v.parts.includes(e) && v.parts.length === parts && e.active === false && e.firing === 0 && near(e.hp, -0.1 * maxHp(e), 1e-6) && Death.partDead(e))) bad.push(key + ':' + e.type);
      const hp = e.hp, fx = FX.list.length, last = v.lastHitAt;
      F.time += 1;
      Combat.damage(v, e, 50, 'shot', F, P0());
      if (e.hp !== hp || v.parts.length !== parts || FX.list.length !== fx || v.lastHitAt !== last) bad.push(key + ':' + e.type + ' again');
    }
    if (F.nBreak) bad.push(key + ' broke');
  }
  t(`A2 every engine of every plane template (${n}) shot to 0: aboard, off, firing nothing, at its health; a second hit leaves its health, the parts, the particles and the last hit as they were; nothing blown up`, !bad.length, bad);
}
function P0() { return { name: 'someone' }; }

// A3 half a wing: the Hornet with a jet and two stores (a cruise missile hanging on a bomb) on its wing's right half,
// a missile pair (one part, a copy each side) on the wing too, and a jet on its left half
{
  const mk = () => {
    const rs = [...rowsOf('hornet'), { type: 'jet', x: 1.2, y: 5.0, z: 4, att: 3 }, { type: 'bombL', x: 0.9, y: 4.0, z: 3.2, att: 3 }, { type: 'cruiseMissile', x: 0.9, y: 6.5, z: 3, att: 10 },
      { type: 'jet', x: 1.2, y: 5.0, z: -4, att: 3 }, { type: 'aam', x: 0.9, y: 4.0, z: 2.4, att: 3 }];
    const v = G.craft(ctx, rs, 'plane', 'air'), F = fsim(v), w = v.parts.find((p) => p.type === 'wingSwept');
    return { v, F, w, mh: maxHp(w), cls0: v.clS, half: clsOf(w) / 2 };
  };
  const side = (s) => {
    const { v, F, w, mh, cls0, half } = mk();
    Combat.damage(v, w, dmgTo(w, 1.1), 'shot', F, null, s);
    const piece = F.vessels.find((o) => o !== v), cut = piece && piece.parts.find((p) => p.type === 'wingSwept');
    return { v, F, w, mh, cls0, half, piece, cut,
      ok: w.cut === s && near(w.hp, 0.4 * mh, 1e-6) && F.vessels.length === 2 && !!cut && cut.cut === -s && cut !== w
        && piece.parts.map((p) => p.type + (p.type === 'jet' ? (p.z > 0 ? '+' : '-') : '')).sort().join() === (s === 1 ? 'bombL,cruiseMissile,jet+,wingSwept' : 'jet-,wingSwept')
        && v.parts.some((p) => p.type === 'jet' && p.z * s < 0) && v.parts.some((p) => p.type === 'aam') && v.parts.includes(w) && piece.isDebris
        && near(v.clS, cls0 - half, 1e-9) && v.hulk != null && v.hulkWhy === 'wing' && !v.down && F.ondead === 0 && !!v.control };
  };
  const a = side(1), b = side(-1);
  t('A3 the Hornet\'s wing shot to -0.1 on its right half: that half off (cut 1), the overkill carried over (0.4 of its health left), one falling piece of the half wing (cut -1) with the right jet and both stores (one on the other); the left jet and the missile pair (both sides) stay; half its lift gone; crippled, not down',
    a.ok && near(a.v.clS / a.cls0, 0.5, 1e-9), { clS: a.v.clS / a.cls0, cut: a.w.cut, hp: a.w.hp / a.mh, piece: a.piece && a.piece.parts.map((p) => p.type + ':' + p.z) });
  t('A3 ...and the mirror: the left half off (cut -1) with the left jet; the stores, the pair and the right jet stay', b.ok && near(b.v.clS / b.cls0, 0.5, 1e-9), { cut: b.w.cut, piece: b.piece && b.piece.parts.map((p) => p.type + ':' + p.z) });
  // a second 0 on the half that's left: the whole wing goes
  Combat.damage(a.v, a.w, dmgTo(a.w, 0.6), 'shot', a.F);
  t('A3 ...a second 0 on the half that\'s left tears the rest off: down (no lift), the end of the flight', !a.v.parts.includes(a.w) && a.v.down && a.v.hulkWhy === 'lift' && a.F.ondead === 1 && a.v.clS === 0, [a.v.hulkWhy, a.v.clS]);
  // overkill of half its health or more: the whole wing at once
  const { v, F, w } = mk();
  Combat.damage(v, w, dmgTo(w, 1.6), 'shot', F, null, 1);
  t('A3 overkill of half its health: the whole wing goes at once (with all it carries), down (no lift)', !v.parts.includes(w) && !w.cut && v.down && v.hulkWhy === 'lift' && F.ondead === 1
    && !v.parts.some((p) => (p.type === 'jet' && p.z) || p.type === 'aam' || p.type === 'bombL' || p.type === 'cruiseMissile'), v.parts.map((p) => p.type));
  // which half: the side a blast is on, on a level, a rolled and an upside-down plane; a round's through the left half
  const blastSide = (roll, z) => {
    const { v, F, w } = mk(), q = v.q, h = roll / 2;
    v.q = { w: Math.cos(h), x: Math.sin(h) * v.pilot.F.x, y: Math.sin(h) * v.pilot.F.y, z: Math.sin(h) * v.pilot.F.z }; void q;
    for (const p of v.parts) if (p !== w) p.hp = 1e9; // (only the wing takes it)
    w.hp = 1;
    Combat.explode(EARTH, v.toWorld(w.x, w.y, z), 6, 50, null, F, true); // (a blast reaches a part by its middle and size: 6 m, from 3 m out)
    return w.cut;
  };
  const sides = [0, Math.PI / 2, Math.PI].map((r) => [blastSide(r, 3), blastSide(r, -3)]);
  t('A3 a blast over the right half cuts the right half, over the left the left, level, rolled 90° and upside down', sides.every(([r, l]) => r === 1 && l === -1), sides);
  const sh = (() => {
    const { v, F, w } = mk();
    for (const p of v.parts) if (p !== w) p.hp = 1e9;
    w.hp = 1;
    const a0 = v.toWorld(w.x - 0.2, w.y - 20, -2.5), dir = v.axis(0, 1, 0);
    Combat.S.shots = [{ k: 'bullet', b: EARTH, x: a0.x, y: a0.y, z: a0.z, vx: dir.x * 900, vy: dir.y * 900, vz: dir.z * 900, t: 0, life: 3, dmg: 9, blast: 0, owner: null }];
    for (let i = 0; i < 10 && Combat.S.shots.length; i++) Combat.step(1 / 120, F);
    return w.cut;
  })();
  t('A3 a round through the left half (moveShot) cuts the left half', sh === -1, sh);
}

// A4 the half-wing flight: hold on, hands off, at cruise 2 km up (the spec's judge probe): most planes spiral down
{
  const D = 180 / Math.PI, dt = 1 / 120;
  const fly = (key, cut) => {
    const mk = (V) => {
      const v = G.craft(ctx, rows(key), 'plane'), s = G.sim();
      const u = { x: v.x / v.radius(), y: v.y / v.radius() }, r = EARTH.radius + 2000;
      v.x = u.x * r; v.y = u.y * r; v.landed = false; v.vx = u.y * V; v.vy = -u.x * V;
      v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true;
      G.stage(v); v.throttle = 0.85; v.sas = 'hold';
      return { v, s };
    };
    const probe = mk(100).v, V0 = probe.vne < 160 ? Math.min(110, 0.75 * probe.vne) : 200, { v, s } = mk(V0);
    for (let i = 0; i < 120; i++) { v.physicsStep(dt, s); s.time += dt; }
    v.mainWing.cut = cut; v.rebuildGroups();
    let t80 = null, tg = null, peak = 0;
    for (let i = 0; i < 35 / dt; i++) {
      v.ctl.v = v.ctl.h = v.ctl.r = 0; v.physicsStep(dt, s); s.time += dt;
      const r = Math.hypot(v.x, v.y, v.z), Rr = v.axis(v.pilot.R.x, v.pilot.R.y, v.pilot.R.z), w = v.bodyAV(), P = v.pilot;
      const bank = Math.asin(Math.max(-1, Math.min(1, (Rr.x * v.x + Rr.y * v.y + Rr.z * v.z) / r))) * D, roll = (w.x * P.F.x + w.y * P.F.y + w.z * P.F.z) * D;
      if (Math.abs(roll) > Math.abs(peak)) peak = roll;
      if (t80 == null && Math.abs(bank) > 80) t80 = i * dt;
      if (v.groundAltitude() < 3 || s.broken.some((b) => String(b).startsWith('impact'))) { tg = i * dt; break; }
    }
    return { t80, tg, peak };
  };
  const out = PLANES.map((k) => [k, fly(k, 1)]);
  const banked = out.filter(([, o]) => o.t80 != null && o.t80 <= 15).length, down = out.filter(([, o]) => o.tg != null).length;
  t(`A4 half the main wing cut, hold on and hands off: ${banked} of ${PLANES.length} plane templates bank past 80° within 15 s (at least 21), ${down} reach the ground within 35 s (at least 22)`,
    PLANES.length === 25 && banked >= 21 && down >= 22, out.filter(([, o]) => o.t80 == null || o.t80 > 15 || o.tg == null).map(([k, o]) => `${k} ${JSON.stringify(o)}`));
  const r = fly('falcon', 1), l = fly('falcon', -1);
  t('A4 the Falcon with its right half cut rolls one way, its left half the other, as fast (peak roll rates within 5 %)', r.peak * l.peak < 0 && Math.abs(Math.abs(r.peak) / Math.abs(l.peak) - 1) < 0.05, [r.peak, l.peak]);
}

// A5 crippled, not down: every tail surface, every fin, every engine; a canard on a delta with elevons is nothing
{
  const shoot = (key, pick) => { const v = air(key), F = fsim(v); for (const p of v.parts.filter(pick)) if (v.parts.includes(p)) Combat.damage(v, p, dmgTo(p, 1.1), 'shot', F); return { v, F }; };
  const tail = shoot('mustang', (p) => p.def.wing && p.def.wing.control), canard = shoot('falcon', (p) => p.def.wing && p.def.wing.control);
  const fin = shoot('fs16', (p) => p.def.shape === 'vtail'), eng = shoot('mustang', (p) => p.def.thrust);
  t('A5 the Mustang\'s every tail surface shot off: crippled (tail), not down', tail.v.hulkWhy === 'tail' && tail.v.hulk != null && !tail.v.down && tail.F.ondead === 0 && !tail.v.wings.some((q) => q.def.wing.control), tail.v.hulkWhy);
  t('A5 the Falcon\'s canard alone: nothing (its delta has elevons)', canard.v.hulk == null && !canard.v.hulkWhy && !canard.v.wings.some((q) => q.def.wing.control), canard.v.hulkWhy);
  t('A5 the FS-16\'s every fin shot off: crippled (fin)', fin.v.hulkWhy === 'fin' && !fin.v.vtails.length && !fin.v.down, fin.v.hulkWhy);
  t('A5 the Mustang\'s engine dead: crippled (engines), gliding, not down', eng.v.hulkWhy === 'engines' && !eng.v.down && eng.F.ondead === 0 && eng.F.log.includes('All engines out'), [eng.v.hulkWhy, eng.F.log]);
}

// A6 the rare mid-air detonation: one roll a hit event a craft, on a big tank's or loaded rack's overkill of half its health
{
  const dice = Death.dice;
  let both = [0, 0], bad = 0, n = 0;
  for (let i = 0; i < 160 && (n < 40 || !both[0] || !both[1]); i++, n++) {
    const v = air('falcon'), F = fsim(v), fus = v.parts.find((p) => p.type === 'fuselage'), rack = v.parts.find((p) => p.type === 'aam');
    const d0 = detonations;
    Combat.holdRips();
    Combat.damage(v, fus, dmgTo(fus, 1.6), 'blast', F);
    if (v.parts.includes(rack)) Combat.damage(v, rack, dmgTo(rack, 1.7), 'blast', F);
    Combat.flushRips();
    const went = detonations - d0, want = dice(fus, 901) < 0.1;
    both[want ? 1 : 0]++;
    if (v.detN !== 1 || went !== (want ? 1 : 0)) bad++;
  }
  t(`A6 in one blast's window a 2000 kg fuselage at -0.6 and a loaded rack at -0.7 of their health: one roll (detN 1), and it goes up exactly when dice(fuselage, 901) < 0.1 (${n} craft, ${both[1]} went up)`, !bad && both[0] && both[1], { bad, both });
  const v = air('falcon'), F = fsim(v), fus = v.parts.find((p) => p.type === 'fuselage');
  Combat.damage(v, fus, dmgTo(fus, 1.4), 'blast', F);
  t('A6 ...a fuselage at -0.4: no roll (torn off, no detonation)', v.detN == null && !v.parts.includes(fus) && F.nBreak === 0, v.detN);
  // a lone hit that sets off a rack: its cook-off overkills the rack beside it, which rolls no more (DET.n)
  let seen = null;
  for (let i = 0; i < 300 && !seen; i++) {
    const rs = [...G.templateRows(ctx, 'falcon'), ['aam', 0.75, 5.6]];
    const c = G.craft(ctx, rs, 'plane', 'air'), CF = fsim(c), [A, B] = c.parts.filter((p) => p.type === 'aam');
    if (!(dice(A, 901) < 0.1)) continue;
    B.hp = 1;
    const d0 = detonations;
    Combat.damage(c, A, dmgTo(A, 1.7), 'shot', CF);
    seen = { went: detonations - d0, detN: c.detN, B: B.hp / maxHp(B) };
  }
  t('A6 ...a lone hit that sets a rack off: its cook-off overkills the rack beside it (past -0.5), which rolls no more (one roll in all)', !!seen && seen.went === 1 && seen.detN === 1 && seen.B <= -0.5, seen);
  // the rate: 400 air-to-air missile bursts at the fuse's distance (blast 15 m, 400) per plane, as the spec's judge
  // aimed them, through the real rules. (The Falcon's racks hang on its wing: a burst that cuts the half they are on takes
  // them with it before their turn, so it rolls in about half its bursts: about 5 %.)
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rate = (key, N = 400) => {
    const d0 = detonations;
    for (let i = 0; i < N; i++) {
      const c = G.craft(ctx, rows(key), 'plane', 'air'), CF = fsim(c);
      let ux = rnd() - 0.5, uy = rnd() - 0.5, uz = rnd() - 0.5; const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
      const dd = 6.75 * (0.6 + 0.4 * rnd());
      Combat.explode(EARTH, c.toWorld(c.com.x + ux * dd, c.com.y + uy * dd, (c.com.z || 0) + uz * dd), 15, 400, null, CF, true);
    }
    return (detonations - d0) / N;
  };
  const R6 = {};
  for (const k of ['falcon', 'fs16', 'myg21', 'bomber', 'skylark', 'mustang', 'hornet', 'fs22', 'jumbo']) R6[k] = +(rate(k) * 100).toFixed(1);
  t('A6 ...the rate in 400 missile bursts: FS-16, MyG-21 5-15 %, the Falcon 3-15 %; the bomber 12-28 %; the Skylark, Mustang, Hornet, FS-22, Jumbo at most 1 %',
    R6.fs16 >= 5 && R6.fs16 <= 15 && R6.myg21 >= 5 && R6.myg21 <= 15 && R6.falcon >= 3 && R6.falcon <= 15 && R6.bomber >= 12 && R6.bomber <= 28 && ['skylark', 'mustang', 'hornet', 'fs22', 'jumbo'].every((k) => R6[k] <= 1), R6);
}

// (A7, the fire: the fire package's)

// A8 rockets keep the old rule; A9 so does every craft in Hollywood
{
  const v = air('pathfinder', 'rocket'), F = fsim(v), eng = v.parts.find((p) => p.def.thrust), ck = v.control;
  Combat.damage(v, eng, dmgTo(eng, 1.01), 'shot', F); const b1 = F.nBreak;
  Combat.damage(v, ck, dmgTo(ck, 1.01), 'shot', F);
  t('A8 a rocket\'s engine and its capsule at 0: blown up, the old way (breakParts), no air rule', b1 === 1 && F.nBreak === 2 && !v.parts.includes(eng) && !v.parts.includes(ck) && !ck.ko && v.air0 == null, [b1, F.nBreak]);
  const h0 = SILLY.hollywood;
  SILLY.hollywood = true;
  try {
    const p = air('falcon'), PF = fsim(p), pk = p.control;
    Combat.damage(p, pk, dmgTo(pk, 1.01), 'shot', PF);
    t('A9 Hollywood on: a plane\'s cockpit at 0 blows up the old way (breakParts)', PF.nBreak === 1 && !p.parts.includes(pk) && !pk.ko && !p.down, PF.nBreak);
  } finally { SILLY.hollywood = h0; }
}

// A10 helicopters: the tail rotor shot off spins it; the main rotor shot off drops it; the pilot knocked out, it falls
{
  const dt = 1 / 120, D = 180 / Math.PI;
  const hover = (key) => { // (hovering 300 m up on hold, the throttle found that holds it there: the spec's judge probe)
    const mk = () => { const v = G.craft(ctx, rows(key), 'heli'), u = { x: v.x / v.radius(), y: v.y / v.radius() }, r = EARTH.radius + 300 + (v.radius() - EARTH.radius - v.groundAltitude());
      v.x = u.x * r; v.y = u.y * r; v.landed = false; v.vx = v.vy = v.vz = 0; G.stage(v); v.sas = 'hold'; return v; };
    let lo = 0, hi = 1;
    for (let it = 0; it < 12; it++) { const th = (lo + hi) / 2, c = mk(), s = G.sim(); c.throttle = th; for (let i = 0; i < 360; i++) { c.physicsStep(dt, s); s.time += dt; } if (c.vSpeed() > 0) hi = th; else lo = th; }
    const v = mk(); v.throttle = (lo + hi) / 2;
    const F = fsim(v);
    for (let i = 0; i < 240; i++) { v.physicsStep(dt, F); F.time += dt; }
    return { v, F };
  };
  const down = (v, F, secs) => { for (let i = 0; i < secs / dt; i++) { v.ctl.v = v.ctl.h = v.ctl.r = 0; v.physicsStep(dt, F); F.time += dt; if (v.dead || v.groundAltitude() < 1 || F.nBreak) return i * dt; } return null; };
  for (const key of HELIS) {
    { const { v, F } = hover(key), tr = v.tailRotors[0];
      Combat.damage(v, tr, dmgTo(tr, 1.1), 'shot', F);
      let y3 = 0, ymax = 0;
      for (let i = 0; i < 20 / dt; i++) { v.ctl.v = v.ctl.h = v.ctl.r = 0; v.physicsStep(dt, F); F.time += dt; const yr = Math.abs(v.bodyAV().y) * D; ymax = Math.max(ymax, yr); if (Math.abs(i * dt - 3) < dt / 2) y3 = yr; if (v.dead || v.groundAltitude() < 1 || F.nBreak) break; }
      t(`A10 ${key}: its tail rotor shot off: crippled and spinning (tailLost), ${Math.round(y3)}°/s at 3 s (over 60), at most ${Math.round(ymax)}°/s (under 200)`, v.tailLost === true && v.hulkWhy === 'tailrotor' && !v.down && !v.tailRotors.length && y3 > 60 && ymax < 200, [y3, ymax]); }
    { const { v, F } = hover(key), ro = v.rotors[0];
      Combat.damage(v, ro, dmgTo(ro, 1.1), 'shot', F);
      t(`A10 ${key}: its main rotor shot off: torn off (a falling piece), down (rotor), the end of the flight`, !v.rotors.length && v.down && v.hulkWhy === 'rotor' && F.ondead === 1 && F.vessels.some((o) => o !== v && o.parts.includes(ro)) && F.log.includes('Main Rotor shot off!'), [v.hulkWhy, F.log]); }
    { const { v, F } = hover(key), ck = v.control;
      Combat.damage(v, ck, dmgTo(ck, 1.01), 'shot', F);
      const tg = down(v, F, 20);
      t(`A10 ${key}: its pilot knocked out 300 m up: limp, engine off, on the ground in ${tg == null ? 'over 20' : tg.toFixed(1)} s (within 20)`, v.down && v.hulkWhy === 'pilot' && tg != null && tg <= 20, tg); }
  }
}

// I9, I12: the player's hit marker only for the player's hits; Combat.byMe
{
  const P = air('falcon'), A = air('mustang'), B = air('skylark'), C = G.craft(ctx, rows('buggy'), 'car'), F = fsim(P);
  F.vessels.push(A, B, C); A.ai = { t: 0 }; B.ai = { t: 0 }; C.ai = { ground: true }; F.time = 5;
  Death.reset(F);
  const part = (v) => v.parts.find((p) => !p.def.control);
  Combat.damage(A, part(A), 5, 'shot', F, B); Combat.damage(C, part(C), 5, 'shot', F, B); Combat.damage(P, part(P), 5, 'shot', F, A);
  const quiet = Death.fb.tick === -9 && !Death.fb.text;
  Combat.damage(A, part(A), 5, 'shot', F, P); const mine = Death.fb.tick === 5 && Death.fb.text === 'HIT';
  F.time = 6; Combat.damage(C, part(C), 5, 'shot', F, P); const car = Death.fb.tick === 6;
  t('I9 the hit marker ticks for the player\'s hits on an aircraft or a ground vehicle, never for one AI hitting another (a plane, a car) or for a hit on the player', quiet && mine && car, JSON.stringify(Death.fb));
  const S = { active: P }, Q = { carrier: P };
  t('I12 Combat.byMe: the player\'s craft and one it carries; not a stranger, nothing, or anything at all when the sim has no active craft (undefined is no carrier)',
    Combat.byMe(P, S) && Combat.byMe(Q, S) && !Combat.byMe(A, S) && !Combat.byMe(null, S) && !Combat.byMe({}, {}) && !Combat.byMe({ carrier: undefined }, { active: undefined }) && !Combat.byMe(P, {}) && !Combat.byMe(P, null));
  t('Combat.isFighter: an AI aircraft that is neither the ground AI\'s nor a drone', Combat.isFighter(A) && !Combat.isFighter(C) && !Combat.isFighter(P) && !Combat.isFighter({ ai: { drone: true } }));
}

// ================================================================ B. the fall and the crash
// (the fall, crash and lifecycle package's: B1-B7)

// ================================================================ C. ground vehicles
// (the ground corpses package's: C1-C7)

// ================================================================ D. the particle budget
// (the fire package's: D1)

// ================================================================ E. saved flights
{
  const KEYS = 'id,type,x,y,z,att,skin,rot,flip,fuel,active,deployed,used,fired,temp,flameout,hp,ammo,store';
  const trip = (v) => JSON.parse(JSON.stringify(v.serialize()));
  const v = air('hornet'), F = fsim(v), w = v.parts.find((p) => p.type === 'wingSwept');
  const intact = trip(v);
  Combat.damage(v, w, dmgTo(w, 1.1), 'shot', F, null, -1);
  const back = ctx.Vessel.restore(trip(v)), bw = back.parts.find((p) => p.type === 'wingSwept');
  const h = air('dragonfly', 'heli'), HF = fsim(h);
  Combat.damage(h, h.tailRotors[0], dmgTo(h.tailRotors[0], 1.1), 'shot', HF);
  const hd = trip(h), hb = ctx.Vessel.restore(hd);
  t('E1 a flight saved with a cut wing restores it (cut -1, its lift halved as before); a spinning helicopter restores its spin (tailLost)',
    bw.cut === -1 && near(back.clS, v.clS, 1e-12) && hd.tailLost === true && hb.tailLost === true && !('tailLost' in intact), [bw.cut, back.clS, v.clS, hd.tailLost, hb.tailLost]);
  const forge = (f) => { const d = JSON.parse(JSON.stringify(intact)); f(d); return ctx.Vessel.restore(d); };
  const wi = intact.parts.findIndex((p) => p.type === 'wingSwept'), ei = intact.parts.findIndex((p) => p.type === 'elevator');
  const f1 = forge((d) => { d.parts[wi].cut = 5; }), f2 = forge((d) => { d.parts[wi].cut = 'x'; }), f3 = forge((d) => { d.parts[ei].cut = 1; }), f4 = forge((d) => { d.parts[wi].burn = 9; d.parts[wi].burnBy = { x: 1 }; d.parts[wi].fireN = 3; });
  const hi = trip(air('dragonfly', 'heli')), f5 = ctx.Vessel.restore(Object.assign(JSON.parse(JSON.stringify(hi)), { tailLost: 'yes' })), f6 = ctx.Vessel.restore(Object.assign(JSON.parse(JSON.stringify(hi)), { tailLost: true }));
  const gone = (o) => o.parts.every((p) => p.cut === undefined && p.burn === undefined && p.burnBy === undefined && p.fireN === undefined);
  t('E1 forged saves: cut 5, cut \'x\', a cut on a tail surface, a fire, tailLost \'yes\' and tailLost on a helicopter that still has its tail rotor are all dropped',
    gone(f1) && gone(f2) && gone(f3) && gone(f4) && near(f1.clS, v.clS * 0 + air('hornet').clS, 1e-12) && !f5.tailLost && !f6.tailLost);
  const keys = air('hornet').serialize().parts.map((p) => Object.keys(p).join());
  t('E1 an intact old part\'s saved keys are exactly the old list (ground.test.js)', keys.every((k) => k === KEYS), [...new Set(keys)]);
}

t.done();
