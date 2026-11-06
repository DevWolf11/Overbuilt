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
  // the limp hulk falls on as one with its knocked-out pilot: a later round tearing its fuselage off leaves the
  // player's craft the cockpit's section, as with the pilot alive (not whichever piece holds parts[0]), its bandit's
  // ai with it; the torn-off rest is debris
  const tear = (key, body, ko, ai) => {
    const v = air(key), F = fsim(v), ck = v.control, b = v.parts.find((p) => p.type === body);
    if (ai) v.ai = { t: 0, down: false };
    if (ko) Combat.damage(v, ck, dmgTo(ck, 1.01), 'shot', F);
    F.time = 2;
    Combat.damage(v, b, dmgTo(b, 1.6), 'shot', F);
    return { parts: v.parts.map((p) => p.type).sort().join(), ck: v.parts.includes(ck), ko: !!ck.ko, rest: F.vessels.filter((o) => o !== v).every((o) => o.isDebris && !o.parts.includes(ck)) };
  };
  const kb = [];
  for (const [k, body] of [['fs16', 'us4f16Body'], ['mustang', 'fuselage'], ['falcon', 'fuselageS']]) {
    const a = tear(k, body, false), b = tear(k, body, true), c = tear(k, body, true, true);
    if (!(a.ck && b.ck && b.ko && c.ck && b.parts === a.parts && c.parts === a.parts && b.rest && c.rest)) kb.push({ k, a, b });
  }
  t('A1 ...a knocked-out FS-16, Mustang and Falcon (and as bandits) with the fuselage torn off later: the cockpit\'s section is still the craft, the same as with the pilot alive; the rest is debris', !kb.length, kb);
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
  // what's gone is gone for hits too: after the right half fell, a round through the middle of where it was (moveShot)
  // misses the wing, as one past the old tip does, and one through the left half still hits; the falling half's box is
  // its own half
  const gh = (() => {
    const { v, F, w } = mk(), span = w.def.wing.span;
    Combat.damage(v, w, dmgTo(w, 1.1), 'shot', F, null, 1);
    const piece = F.vessels.find((o) => o !== v), q = piece.parts.find((p) => p.type === 'wingSwept');
    piece.x += 500; // (only the plane in the way)
    for (const p of v.parts) if (p !== w) p.hp = 1e9;
    const shoot = (z) => {
      const a0 = v.toWorld(w.x - 0.05, w.y - 25, z), dir = v.axis(0, 1, 0), h = w.hp;
      Combat.S.shots = [{ k: 'bullet', b: EARTH, x: a0.x, y: a0.y, z: a0.z, vx: dir.x * 900, vy: dir.y * 900, vz: dir.z * 900, t: 0, life: 3, dmg: 9, blast: 0, owner: null }];
      for (let i = 0; i < 20 && Combat.S.shots.length; i++) Combat.step(1 / 120, F);
      return +(h - w.hp).toFixed(6);
    };
    const B = (p) => Combat.boxesOf(p)[0], zc = R('partZc')(w);
    return { gone: shoot(span / 4), tip: shoot(span * 0.75), left: shoot(-span / 4), wz: [B(w)[4] - zc, B(w)[5] - zc], qz: [B(q)[4] - zc, B(q)[5] - zc], hz: span / 2 };
  })();
  t('A3 ...the right half gone: a round where it was misses the wing (as past the old tip), one through the left half hits; the wing\'s box is its left half, the falling half\'s its right',
    gh.gone === 0 && gh.tip === 0 && gh.left > 0 && near(gh.wz[0], -gh.hz) && gh.wz[1] === 0 && gh.qz[0] === 0 && near(gh.qz[1], gh.hz), gh);
  // the suites' stand-in sim (G.sim) takes the new path: a blast cuts the wing (the falling half, never stepped, goes
  // into its vessels), and a second blast at that half tears it off through G.sim's ripParts without a throw
  const gs = (() => {
    const v = G.craft(ctx, G.templateRows(ctx, 'hornet'), 'plane', 'air'), s = G.sim(), w = v.mainWing;
    s.vessels.push(v); v.physicsStep(1 / 120, s);
    for (const p of v.parts) if (p !== w) p.hp = 1e9;
    w.hp = 1;
    try {
      Combat.explode(EARTH, v.toWorld(w.x, w.y, w.def.wing.span / 4 + 3), 6, 50, null, s, true);
      const piece = s.vessels.find((o) => o !== v), q = piece && piece.parts[0];
      if (!q) return 'no piece';
      q.hp = 1;
      Combat.explode(EARTH, piece.toWorld(q.x, q.y, R('partZc')(q)), 6, 50, null, s, true);
      return s.broken.some((b) => b.startsWith('rip:wingSwept@0.0g')) ? 'ok' : s.broken.join();
    } catch (e) { return 'threw ' + e.message; }
  })();
  t('A3 ...G.sim: a blast cuts the wing, a second at the falling half (never stepped) tears it off without a throw', gs === 'ok', gs);
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

// A7 fire: lit on the dice (a part's id: the same part, the same fire), 4 % of a part's health a second while a craft
// someone flies burns, its timer faster with the throttle back and in a dive, out in water, nothing from a piece; a big
// tank burnt through goes up on its own dice; the player's toasts say what really happened; never from a crash
{
  const FIRE = ctx.FIRE, makePart = R('makePart'), airDensity = R('airDensity'), dice = Death.dice;
  let n = 0;
  const tick = (F, secs, e = 0.07, stop) => { for (let i = 0, N = Math.round(secs / e); i < N; i++) { F.time += e; Death.tick(F, e, ++n); if (stop && stop()) return F.time; } return null; };
  const jetOf = (v) => v.parts.find((p) => p.def.thrust);
  // the dice: the same part (id), the same fire; a fresh copy of it too; about the odds asked for
  {
    const v = air('falcon'), F = fsim(v), j = jetOf(v);
    const a = [Death.ignite(v, j, 0.5, null, F, true), j.burn, j.fireN];
    delete j.burn; delete j.fireN; delete j.burnBy;
    const b = [Death.ignite(v, j, 0.5, null, F, true), j.burn, j.fireN];
    const c = makePart(j.type, j.x, j.y); c.id = j.id;
    const d = [Death.ignite(v, c, 0.5, null, F, true), c.burn, c.fireN];
    let lit = 0;
    for (let i = 0; i < 600; i++) { const q = makePart('jet', 0, 0); q.id = 50000 + i; if (Death.ignite(v, q, 0.4, null, F, true)) lit++; }
    const span = [];
    for (let i = 0; i < 400; i++) { const q = makePart('jet', 0, 0); q.id = 70000 + i; if (Death.ignite(v, q, 1, null, F, true)) span.push(q.burn); }
    t('A7 ignite twice on the same part, and on a fresh copy of it (the same id): the same outcome and the same fire', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(d) && a[2] === 1, [a, b, d]);
    t(`A7 ...the dice light about the odds asked (${lit} of 600 at 0.4) and burn 8-22 s (${Math.min(...span).toFixed(1)}-${Math.max(...span).toFixed(1)} s, mean ${(span.reduce((s, x) => s + x, 0) / span.length).toFixed(1)})`,
      lit > 0.33 * 600 && lit < 0.47 * 600 && span.length === 400 && Math.min(...span) >= 8 && Math.max(...span) <= 22 && Math.min(...span) < 9 && Math.max(...span) > 21, { lit });
  }
  // an engine lit at 30 % (throttle 0.85, 100 m/s): at 0 in 7.5 s, the damage the lighter's
  {
    const v = air('falcon'), F = fsim(v), j = jetOf(v), mh = maxHp(j), by = P0();
    v.throttle = 0.85; v.dynP = 0.5 * airDensity(EARTH, 3000) * 100 * 100;
    j.hp = 0.3 * mh;
    const lit = Death.ignite(v, j, 1, by, F);
    let mid = null;
    const at = tick(F, 12, 0.07, () => { if (mid == null && F.time >= 2) mid = v.lastHitBy === by && near(v.lastHitAt, F.time, 1e-9) && j.burnBy === by; return !(j.hp > 0); });
    t(`A7 an engine lit at 30 % (throttle 0.85, 100 m/s): at 0 hp after ${at == null ? 'over 12' : at.toFixed(2)} s (7.5 ± 0.3), dead aboard; the fire's damage credited to who lit it (lastHitBy, lastHitAt kept fresh)`,
      lit && at != null && Math.abs(at - 7.5) <= 0.3 && v.parts.includes(j) && j.active === false && mid === true, { at, mid });
    t('A7 ...the player told: "on fire! Throttle back or dive to put it out" (once), then the engine out', F.log.filter((m) => m === `${j.def.name} on fire! Throttle back or dive to put it out`).length === 1 && F.log.includes(`${j.def.name} out!`), F.log);
  }
  // the timer: 3× with an engine throttled back, 3× above 150 m/s EAS, 9× both; a fuel fire doesn't care for the throttle
  {
    const run = (thr, eas, fuel) => {
      const v = air('falcon'), F = fsim(v), p = fuel ? v.parts.find((q) => q.type === 'fuselage') : jetOf(v);
      v.throttle = thr; v.dynP = 0.6 * eas * eas; p.burn = 20;
      tick(F, 1, 0.1);
      return +(20 - p.burn).toFixed(6);
    };
    const r = { plain: run(0.85, 100), idle: run(0.2, 100), dive: run(0.85, 160), both: run(0.1, 160), fuelIdle: run(0.2, 100, true), fuelDive: run(0.2, 160, true) };
    t('A7 a fire\'s timer: 1 s a second, 3 with an engine at 0.2 throttle, 3 above 150 m/s EAS, 9 with both; a fuel fire 1 at idle, 3 in a dive', r.plain === 1 && r.idle === 3 && r.dive === 3 && r.both === 9 && r.fuelIdle === 1 && r.fuelDive === 3, r);
  }
  // 200 seeded hits across 30 % on an engine or a fuel part (> 50 kg) of the player's craft: "on fire!" toasts = fires lit,
  // the rest "badly damaged"; about 40 % of the engines and 30 % of the fuel parts lit
  {
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const S = { eng: [0, 0], fuel: [0, 0] }; let fires = 0, burns = 0, badly = 0, wrong = 0;
    for (let i = 0; i < 200; i++) {
      const v = air(['falcon', 'mustang', 'fs16', 'skylark'][i % 4]), F = fsim(v), C = v.parts.filter((p) => p.def.thrust || p.fuel > 50);
      const p = C[Math.floor(rnd() * C.length)], mh = maxHp(p);
      p.hp = (0.3 + 0.6 * rnd()) * mh;
      Combat.damage(v, p, (p.hp - (0.02 + 0.26 * rnd()) * mh) / (1 - (p.def.armor || 0)), 'shot', F, P0());
      const lit = p.burn > 0, f = F.log.filter((m) => m.startsWith(`${p.def.name} on fire! `)).length, b = F.log.filter((m) => m === `${p.def.name} badly damaged`).length;
      fires += f; burns += lit ? 1 : 0; badly += b;
      if (f !== (lit ? 1 : 0) || b !== (lit ? 0 : 1) || F.log.length !== 1) wrong++;
      S[p.def.thrust ? 'eng' : 'fuel'][lit ? 1 : 0]++;
    }
    const pe = S.eng[1] / (S.eng[0] + S.eng[1]), pf = S.fuel[1] / (S.fuel[0] + S.fuel[1]);
    t(`A7 200 seeded hits across 30 % on the player's engines and fuel parts: "on fire!" toasts (${fires}) = fires lit (${burns}), the other ${badly} "badly damaged"; engines lit ${(pe * 100).toFixed(0)} % (40), fuel parts ${(pf * 100).toFixed(0)} % (30)`,
      !wrong && fires === burns && fires + badly === 200 && Math.abs(pe - 0.4) < 0.13 && Math.abs(pf - 0.3) < 0.13, { wrong, S });
  }
  // water puts it out at once; a fire on a piece (a torn-off tank) or on a limp hulk burns and hurts nothing
  {
    const v = air('falcon'), F = fsim(v), j = jetOf(v), mh = maxHp(j);
    j.hp = 0.25 * mh; j.burn = 10; v.splashed = true;
    tick(F, 0.07);
    t('A7 a burning craft in the water: out the next tick ("fire out"), no damage', j.burn === 0 && near(j.hp, 0.25 * mh) && F.log.includes(`${j.def.name}: fire out`), [j.burn, F.log]);
    const w = air('falcon'), W = fsim(w), fs = w.parts.find((p) => p.type === 'fuselageS');
    W.ripParts(w, [fs], 'shot');
    const piece = W.vessels.find((o) => o !== w && o.parts.includes(fs)), fmh = maxHp(fs);
    fs.hp = 0.5 * fmh; fs.burn = 10;
    const k = air('mustang'), K = fsim(k), e = jetOf(k), emh = maxHp(e);
    Combat.damage(k, k.control, dmgTo(k.control, 1.01), 'shot', K);
    e.hp = 0.5 * emh; e.burn = 10;
    tick(W, 1, 0.1); tick(K, 1, 0.1);
    t('A7 a fire on a piece (a torn-off tank) and on a limp hulk (the pilot knocked out): burns on (1 s less), deals nothing',
      !!piece && piece.isDebris && near(fs.hp, 0.5 * fmh) && near(fs.burn, 9, 1e-9) && k.down && near(e.hp, 0.5 * emh) && near(e.burn, 9, 1e-9), [fs.hp / fmh, fs.burn, e.hp / emh, e.burn]);
  }
  // a big tank (2000 kg) burnt to 0: it goes up exactly when dice(tank, 950) < 0.1, else it is torn off still burning;
  // one holding 400 kg never goes up (only over 500 kg), whatever its dice
  {
    const seen = [0, 0, 0]; let bad = 0, tries = 0, toast = true;
    for (let i = 0; i < 900 && (tries < 40 || !seen[0] || !seen[1] || !seen[2]); i++, tries++) {
      const v = air('falcon'), F = fsim(v), fus = v.parts.find((p) => p.type === 'fuselage'), mh = maxHp(fus), small = i % 2 === 1;
      if (small) fus.fuel = 400;
      fus.hp = 0.01 * mh; fus.burn = 10;
      const d0 = detonations;
      tick(F, 2, 0.07, () => !v.parts.includes(fus));
      const went = detonations - d0, roll = dice(fus, 950) < FIRE.burnThrough, want = roll && !small;
      if (small) { if (roll) seen[2]++; } else seen[want ? 1 : 0]++;
      if (went !== (want ? 1 : 0) || v.parts.includes(fus)) bad++;
      if (want && !F.log.includes('Fuel tank exploded!')) toast = false;
      if (!want && !(fus.burn > 0)) bad++; // (torn off, burning as it falls)
    }
    t(`A7 a 2000 kg tank burnt to 0 hp: goes up exactly when dice(tank, 950) < 0.1 ("Fuel tank exploded!"), else torn off and burning as it falls; a 400 kg one never (${tries} craft, ${seen[1]} went up, ${seen[2]} small ones with the dice for it didn't)`, !bad && toast && seen[0] && seen[1] && seen[2], { bad, seen });
  }
  // never from a crash (carry-over from Phase 1's review): a crash's dent, and the blast of a tank a crash broke open,
  // taking a jet under 30 % light nothing; the same jet shot under 30 % burns (its dice say so)
  {
    let v;
    for (let i = 0; i < 200; i++) { v = air('falcon'); if (dice(jetOf(v), 1) < FIRE.lit30.eng) break; }
    const F = fsim(v), j = jetOf(v), mh = maxHp(j), fus = v.parts.find((p) => p.type === 'fuselage');
    j.hp = 0.31 * mh;
    Combat.impact(v, j, 0.8, F);
    const dent = { f: j.hp / mh, burn: j.burn, n: j.fireN, log: F.log.slice() };
    j.hp = 0.3 * mh + 0.5; F.time = 1;
    Combat.damage(v, fus, 1e6, 'impact', F); // (the fuselage broken in a crash: its 2000 kg go up, the old way)
    const blast = { f: j.hp / mh, burn: j.burn, n: j.fireN };
    t('A7 a crash never lights a fire: a dent taking the jet under 30 % ("badly damaged", no fire, no roll), the blast of the fuselage a crash broke open taking it under 30 % (no fire, no roll)',
      dent.f < 0.3 && dent.burn === undefined && dent.n === undefined && dent.log.join() === `${j.def.name} badly damaged` && blast.f < 0.3 && blast.burn === undefined && blast.n === undefined, { dent, blast });
    const o = F.vessels.find((q) => q.parts.includes(j));
    j.hp = 0.31 * mh; F.time = 2;
    Combat.damage(o, j, dmgTo(j, 0.05), 'shot', F, P0());
    t('A7 ...the same jet shot under 30 %: on fire (its first roll, as its dice said)', j.burn > 0 && j.fireN === 1, [j.burn, j.fireN]);
  }
  // nothing burns on a drone, a rocket or a car; Hollywood lights nothing (and keeps the old smoke)
  {
    const d = air('falcon', 'drone'), DF = fsim(d), dj = jetOf(d);
    const rk = air('pathfinder', 'rocket'), RF = fsim(rk), re = jetOf(rk);
    dj.hp = 0.31 * maxHp(dj); re.hp = 0.31 * maxHp(re);
    Combat.damage(d, dj, dmgTo(dj, 0.05), 'shot', DF, P0()); Combat.damage(rk, re, dmgTo(re, 0.05), 'shot', RF, P0());
    const forced = Death.ignite(d, dj, 1, null, DF);
    const h0 = SILLY.hollywood; SILLY.hollywood = true;
    let hw;
    try { const h = air('mustang'), HF = fsim(h), he = jetOf(h); he.hp = 0.31 * maxHp(he); Combat.damage(h, he, dmgTo(he, 0.05), 'shot', HF, P0()); hw = [Death.ignite(h, he, 1, null, HF), he.burn, he.fireN, HF.log.join(), he.def.name]; } finally { SILLY.hollywood = h0; }
    t('A7 no fire on a drone (its motor shot under 30 %: "badly damaged"; ignite refuses even at odds 1), a rocket (today\'s toast) or in Hollywood (today\'s toast)',
      !(dj.burn > 0) && dj.fireN === undefined && forced === false && DF.log.join() === `${dj.def.name} badly damaged` && !(re.burn > 0) && re.fireN === undefined && RF.log.join() === `${re.def.name} on fire!`
      && hw[0] === false && hw[1] === undefined && hw[2] === undefined && hw[3] === `${hw[4]} on fire!`, { d: DF.log, r: RF.log, hw });
  }
  // the banner: our fire on a bandit says ON FIRE; a burning piece torn off it says nothing; the fire's damage is no hit
  {
    let v;
    for (let i = 0; i < 200; i++) { v = air('mustang'); if (dice(jetOf(v), 1) < FIRE.lit30.eng) break; }
    const P = air('falcon'), F = fsim(P), j = jetOf(v);
    F.vessels.push(v); v.ai = { t: 0, down: false }; F.time = 3; Death.reset(F);
    j.hp = 0.31 * maxHp(j);
    Combat.damage(v, j, dmgTo(j, 0.05), 'shot', F, P);
    const on = Death.fb.text === 'ON FIRE' && j.burn > 0 && j.burnBy === P;
    Death.reset(F); F.time = 4;
    tick(F, 1, 0.1);
    const quiet = Death.fb.tick === -9 && !Death.fb.text && v.lastHitBy === P;
    let w;
    for (let i = 0; i < 300; i++) { w = air('falcon'); if (dice(w.parts.find((p) => p.type === 'fuselageS'), 1) < FIRE.lit0.fuel) break; }
    const G2 = fsim(P), fs = w.parts.find((p) => p.type === 'fuselageS');
    G2.vessels.push(w); w.ai = { t: 0, down: false }; G2.time = 5; Death.reset(G2);
    fs.hp = -1; w.lastHitBy = P;
    Death._t.tearOff(w, fs, 'shot', G2); // (the air rule's #7 alone, before the craft is checked: crippled or down)
    const piece = { burn: fs.burn, off: !w.parts.includes(fs), fb: Death.fb.text };
    // the player's own fuel tank torn off burning: "shot off!", not "on fire!"
    let m;
    for (let i = 0; i < 300; i++) { m = air('falcon'); if (dice(m.parts.find((p) => p.type === 'fuselageS'), 1) < FIRE.lit0.fuel) break; }
    const MF = fsim(m), mf = m.parts.find((p) => p.type === 'fuselageS'); mf.hp = -1;
    Death._t.tearOff(m, mf, 'shot', MF);
    t('A7 our fire on a bandit\'s engine: the ON FIRE banner, the fire ours (burnBy); its burning ticks no hit marker; a fuel tank torn off it burning: no banner (a piece); the player\'s own: "shot off!", no word of a fire',
      on && quiet && piece.burn > 0 && piece.off && !piece.fb && mf.burn > 0 && MF.log.join() === `${mf.def.name} shot off!`, { on, quiet, piece, log: MF.log });
  }
  // the pictures: black smoke and a flame behind a fire, white behind a leak, grey (every 2nd tick, no fire) behind
  // other damage on an aircraft; a car and a rocket keep the old smoke; the nearest 4 trails within 3 km at full rate
  // (puffs 14 m apart on Low, 7 on High), the rest to 8 km every 2nd tick, none further or above 4× warp
  {
    const SET = ctx.Settings, q0 = SET.data.quality, tr0 = FX.trail, fl0 = FX.flame, add0 = FX.add;
    const calls = [];
    FX.trail = function (b, p, v, preset, k) { calls.push({ f: 'trail', preset, k, p: { ...p } }); };
    FX.flame = function (b, p) { calls.push({ f: 'flame', p: { ...p } }); };
    FX.add = function (q) { calls.push({ f: 'add', kind: q.kind, color: q.color }); };
    const cam = (extra) => fsim(null, Object.assign({ dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), absPos: (o) => ({ x: o.x, y: o.y, z: o.z }) }, extra));
    try {
      SET.data.quality = 'low';
      const v = air('falcon'), F = cam(); F.active = v; F.vessels = [v]; F.camAbs = { x: v.x, y: v.y - 60, z: v.z };
      v.vx = 0; v.vy = 250; v.vz = 0;
      const j = jetOf(v), fus = v.parts.find((p) => p.type === 'fuselage'), cn = v.parts.find((p) => p.type === 'canard');
      j.burn = 20; fus.hp = 0.4 * maxHp(fus); cn.hp = 0.5 * maxHp(cn);
      const sum = { black: 0, white: 0, grey: 0, flame: 0, fire: 0, old: 0, k: new Set() };
      Combat.S.smokeT = 0.07; Combat.S.smokeE = 0; // (each tick 5 frames, 1/12 s: 21 m of flight)
      for (let i = 0; i < 60; i++) { F.time += 1 / 60; calls.length = 0; Combat.frame(F, 1 / 60); for (const c of calls) { if (c.f === 'trail') { sum[c.preset]++; if (c.preset === 'black') sum.k.add(c.k); } else if (c.f === 'flame') sum.flame++; else if (c.kind === 'fire') sum.fire++; else if (c.kind === 'smoke') sum.old++; } }
      t(`A7 a Falcon at 250 m/s on Low with its engine burning, its fuselage leaking and its canard damaged, a second of frames: black smoke and a flame every tick (${sum.black}, ${sum.flame}), 2 puffs a tick (14 m apart), white every tick (${sum.white}), grey every 2nd (${sum.grey}), no fire particle, no old smoke`,
        sum.black >= 11 && sum.flame === sum.black && sum.white === sum.black && sum.grey >= Math.floor(sum.black / 2) && sum.grey <= Math.ceil(sum.black / 2) && sum.fire === 0 && sum.old === 0 && [...sum.k].join() === '2', { ...sum, k: [...sum.k] });
      // the old smoke for a car and a rocket (and for a plane in Hollywood)
      const old = (key, kind, hw) => {
        const c = G.craft(ctx, rows(key), kind, 'air'), CF = cam(); CF.active = c; CF.vessels = [c]; CF.camAbs = { x: c.x, y: c.y, z: c.z };
        const p = c.parts.find((q) => !q.def.control && !q.def.gv); p.hp = 0.2 * maxHp(p);
        const h0 = SILLY.hollywood; SILLY.hollywood = !!hw; calls.length = 0;
        try { for (let i = 0; i < 30; i++) { CF.time += 1 / 60; Combat.frame(CF, 1 / 60); } } finally { SILLY.hollywood = h0; }
        return calls.some((x) => x.f === 'add' && x.kind === 'smoke' && x.color === '#2b2d31') && calls.some((x) => x.f === 'add' && x.kind === 'fire') && !calls.some((x) => x.f === 'trail');
      };
      t('A7 ...a car\'s, a rocket\'s and (in Hollywood) a plane\'s damaged part keep the old smoke and flame', old('buggy', 'car') && old('pathfinder', 'rocket') && old('mustang', 'plane', true));
      // the trail rule: seven burning planes 0.3-9 km from the camera
      const P = [300, 900, 1500, 2100, 2700, 5000, 9000].map((d) => { const o = air('mustang'); o.z = d; o.vx = 0; o.vy = 250; o.vz = 0; jetOf(o).burn = 20; return o; });
      const R2 = cam({ warpIdx: 1 }); R2.active = P[0]; R2.vessels = P.slice(); R2.camAbs = { x: P[0].x, y: P[0].y, z: 0 };
      const at = (cs) => cs.filter((c) => c.f === 'trail').map((c) => [Math.round(c.p.z / 100) * 100, c.k].join(':')).join(' ');
      calls.length = 0; Death._t.fireTick(R2, 0.07, 100); const even = at(calls);
      calls.length = 0; Death._t.fireTick(R2, 0.07, 101); const odd = at(calls);
      SET.data.quality = 'high'; calls.length = 0; Death._t.fireTick(R2, 0.07, 102); const high = at(calls);
      R2.warpIdx = 3; calls.length = 0; Death._t.fireTick(R2, 0.07, 104); const warp = calls.length;
      t('A7 the trails of seven burning planes 0.3-9 km off: the nearest 4 at full rate (2 puffs a tick on Low, 3 on High), the 2.7 km and 5 km ones a puff every 2nd tick, none at 9 km; none at 8× warp',
        even === '300:2 900:2 1500:2 2100:2 2700:1 5000:1' && odd === '300:2 900:2 1500:2 2100:2' && high === '300:3 900:3 1500:3 2100:3 2700:1 5000:1' && warp === 0, { even, odd, high, warp });
    } finally { FX.trail = tr0; FX.flame = fl0; FX.add = add0; SET.data.quality = q0; }
  }
}

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

// A11 a flight with no hits never meets the air rule (§3.1): a crash's dents (Combat.impact, cause 'impact') keep the
// old breakage alone, so an untouched Skylark dropped hard on one wing tip loses the wing as before (its pilot, its
// stick, its throttle and its flight kept, no hulk), and a parked Dragonfly's tail rotor dented off doesn't spin it
{
  const qmul = R('qmul'), dt = 1 / 120;
  const v = G.craft(ctx, G.templateRows(ctx, 'skylark'), 'plane', 'site'), F = fsim(v), w = v.mainWing;
  const r0 = Math.hypot(v.x, v.y, v.z), up = { x: v.x / r0, y: v.y / r0, z: v.z / r0 }, Fw = v.axis(v.pilot.F.x, v.pilot.F.y, v.pilot.F.z), h = 0.125;
  v.x += up.x * 2.5; v.y += up.y * 2.5; v.z += up.z * 2.5; v.landed = false; // (2.5 m up, banked 0.25 rad, 12 m/s down)
  v.q = qmul({ w: Math.cos(h), x: Math.sin(h) * Fw.x, y: Math.sin(h) * Fw.y, z: Math.sin(h) * Fw.z }, v.q);
  v.vx = -up.x * 12; v.vy = -up.y * 12; v.vz = -up.z * 12;
  for (let i = 0; i < 240; i++) { v.physicsStep(dt, F); F.time += dt; }
  const clean = (o) => o.hulk == null && o.junkAt == null && !o.down && !o.hulkWhy && !o.tailLost;
  t('A11 an untouched Skylark dropped hard on a wing tip: the wing knocked off the old way ("Wing knocked off!"), its pilot, throttle and flight kept; no hulk, no air rule, no tagged pieces',
    !v.parts.includes(w) && !!v.control && !v.isDebris && v.throttle === 1 && F.ondead === 0 && v.air0 == null && F.vessels.every(clean) && F.log.join() === 'Wing knocked off!',
    { log: F.log, down: v.down, hulk: v.hulk, throttle: v.throttle, air0: !!v.air0 });
  const hv = G.craft(ctx, G.templateRows(ctx, 'dragonfly'), 'heli', 'air'), HF = fsim(hv);
  Combat.impact(hv, hv.tailRotors[0], 3, HF);
  G.stage(hv); hv.throttle = 0.6; hv.sas = 'hold';
  for (let i = 0; i < 360; i++) { hv.ctl.v = hv.ctl.h = hv.ctl.r = 0; hv.physicsStep(dt, HF); HF.time += dt; }
  const yaw = Math.abs(hv.bodyAV().y) * 180 / Math.PI;
  t(`A11 an untouched Dragonfly's tail rotor dented off: knocked off the old way, no spin (${yaw.toFixed(1)}°/s at 3 s), no hulk`,
    !hv.tailRotors.length && !hv.tailLost && HF.vessels.every(clean) && hv.air0 == null && yaw < 1 && HF.log.join() === 'Tail Rotor knocked off!', { log: HF.log, yaw, why: hv.hulkWhy });
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
// D1 Settings Low, the worst realistic mix in view: two planes with burning engines at 250 m/s for 10 s, a TK-34's ammo
// death, three knocked-out wrecks and a crash site. The cap lifted (FX.max): what the scene asks for stays within Low's
// 350 every frame, and each burning plane's trail within 75 live puffs. (The wrecks' and the crash site's smoke are the
// ground and crash sections': set up here as their state, Death.S.pyres and v.wreck/v.ko, so their real code joins in.)
{
  const SET = ctx.Settings, q0 = SET.data.quality, tg0 = SET.data.targets, max0 = FX.max, add0 = FX.add, tr0 = FX.trail, py0 = Death.S.pyres.slice();
  SET.data.quality = 'low'; SET.data.targets = 'off';
  FX.clear(); FX.max = () => 1e9;
  let tag = null;
  FX.trail = function (b, p, ...a) { tag = this._who ? this._who(p) : null; try { return tr0.call(this, b, p, ...a); } finally { tag = null; } };
  FX.add = function (q) { if (tag) q._tr = tag; return add0.call(this, q); };
  let peak = 0, trail = 0, at = 0;
  try {
    const A = air('falcon'), B = air('fs16'), dt = 1 / 60;
    B.z = 400;
    for (const o of [A, B]) { o.vx = 0; o.vy = 250; o.vz = 0; o.throttle = 0.9; for (const p of o.parts) if (p.def.thrust) p.burn = 30; }
    const F = fsim(A, { warpIdx: 1, dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), absPos: (o) => ({ x: o.x, y: o.y, z: o.z }) });
    F.vessels.push(B);
    FX._who = (p) => (Math.hypot(p.x - A.x, p.y - A.y, p.z - A.z) < Math.hypot(p.x - B.x, p.y - B.y, p.z - B.z) ? 'A' : 'B');
    const mid = { x: A.x - 150, y: A.y + 1250, z: A.z + 200 };
    const tank = () => { const k = G.craft(ctx, rows('tk34'), 'tank'); k.x = mid.x; k.y = mid.y; k.z = mid.z; k.vx = k.vy = k.vz = 0; return k; };
    const tk = tank();
    for (let i = 0; i < 3; i++) { const w = tank(); w.z += 30 * i; w.wreck = true; w.ko = { why: 'crew', x: false, t: 0 }; F.vessels.push(w); }
    Death.S.pyres.push({ b: EARTH, x: mid.x, y: mid.y - 300, z: mid.z, t: 0, k: 6, wet: false });
    Combat.S.smokeT = 0.07; Combat.S.smokeE = 0;
    for (let i = 0; i < 10 / dt; i++) {
      for (const o of [A, B]) { o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt; }
      F.camAbs = { x: A.x + 8, y: A.y - 40, z: A.z };
      if (i === 30) Death.deathFX(tk, F, 'ammo');
      F.time += dt;
      Combat.frame(F, dt);
      FX.update(dt, F);
      const n = FX.list.length;
      if (n > peak) { peak = n; at = F.time; }
      let a = 0, b = 0;
      for (const q of FX.list) if (q.kind === 'smoke') { if (q._tr === 'A') a++; else if (q._tr === 'B') b++; }
      trail = Math.max(trail, a, b);
    }
  } finally { SET.data.quality = q0; SET.data.targets = tg0; FX.max = max0; FX.add = add0; FX.trail = tr0; delete FX._who; Death.S.pyres.length = 0; Death.S.pyres.push(...py0); FX.clear(); }
  t(`D1 Settings Low, two planes burning at 250 m/s for 10 s, a TK-34's ammo death, three knocked-out wrecks and a crash site: at most ${peak} particles (at ${at.toFixed(1)} s; Low's cap 350), at most ${trail} live puffs a trail (75)`,
    peak <= 350 && peak > 100 && trail <= 75 && trail > 40, { peak, at, trail });
}

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
  // a knocked-out pilot stays out: ko isn't saved, it comes back from the cockpit's health (0 or under), so the craft
  // restores without a pilot (and debris), the saved keys as ever; a live cockpit, even hurt, still flies
  const m = air('mustang'), MF = fsim(m), mk = m.control;
  Combat.damage(m, mk, dmgTo(mk, 1.05), 'shot', MF, P0());
  const md = trip(m), mb = ctx.Vessel.restore(md), mbk = mb.parts.find((p) => p.def.control);
  const hurt = air('mustang'); Combat.damage(hurt, hurt.control, dmgTo(hurt.control, 0.9), 'shot', fsim(hurt));
  const hb2 = ctx.Vessel.restore(trip(hurt));
  t('E1 a knocked-out pilot saved and restored: still knocked out (no control part, ko from its health), debris; ko not among the saved keys; a hurt pilot (10 % left) still flies',
    !m.control && mk.ko && !mb.control && mbk.ko === true && mbk.hp <= 0 && mb.isDebris === true && !('ko' in md.parts.find((p) => p.id === mk.id)) && !!hb2.control && !hb2.control.ko,
    { control: !!mb.control, ko: mbk.ko, hp: mbk.hp, debris: mb.isDebris, hurt: !!hb2.control });
}

t.done();
