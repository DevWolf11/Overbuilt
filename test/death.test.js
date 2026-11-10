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
  t('A1 ...a bandit (the raider) knocked out by the player: shot down (ai.down, "Bandit shot down!", a kill), the SHOT DOWN banner (the kill outranks PILOT KO), no end for the player',
    B.ai.down && F.log.includes('Bandit shot down!') && Combat.S.kills === k0 + 1 && Death.fb.text === 'SHOT DOWN' && F.ondead === 0 && B.down, [F.log, Death.fb.text]);
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
  t('A5 the Mustang\'s engine dead: crippled (engines), gliding, not down; the player told so in one toast (the engine out and all engines out: F4)', eng.v.hulkWhy === 'engines' && !eng.v.down && eng.F.ondead === 0 && eng.F.log.join() === 'All engines out!', [eng.v.hulkWhy, eng.F.log]);
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
    t('A7 ...the player told: "on fire! Throttle back or dive to put it out" (once), then the engine out (its only one: "All engines out!", one toast, F4)', F.log.filter((m) => m === `${j.def.name} on fire! Throttle back or dive to put it out`).length === 1 && F.log.length === 2 && F.log[1] === 'All engines out!', F.log);
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
// Steps every vessel of F (but the one given) as Flight.update does (two 1/120 s steps a 60 fps frame), with Death's
// tick every 0.07 s of sim time (Combat.frame's), and drops the dead (Flight.cleanup). each(f): stop on true.
function fly(F, secs, each, still) {
  const dt = 1 / 120;
  F.tickE = F.tickE || 0; F.tickN = F.tickN || 0;
  for (let i = 0, N = Math.round(secs / dt); i < N; i++) {
    for (const o of F.vessels.slice()) if (!o.dead && o.parts.length && o !== still && !o.wreck && !(o !== F.active && o.landed && o.restTime > 2 && !o.thrust)) o.physicsStep(dt, F);
    F.time += dt; F.tickE += dt;
    if (F.tickE >= 0.07) { Death.tick(F, F.tickE, ++F.tickN); F.tickE = 0; }
    F.vessels = F.vessels.filter((o) => !o.dead && o.parts.length);
    if (each && each(i * dt + dt)) return i * dt + dt;
  }
  return null;
}
// a craft flying level at cruise (the half-wing probe's: 200 m/s, or 0.75 of a slow plane's speed limit), alt m up over
// the sea, hold on, gear up, engines lit at 0.85
function cruise(key, alt = 2000, ai) {
  const mk = (V) => {
    const v = G.craft(ctx, rows(key), 'plane'), u = { x: v.x / v.radius(), y: v.y / v.radius() }, r = EARTH.radius + alt;
    v.x = u.x * r; v.y = u.y * r; v.landed = false; v.vx = u.y * V; v.vy = -u.x * V;
    v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true;
    G.stage(v); v.throttle = 0.85; v.sas = 'hold';
    if (ai) { v.ai = { t: 0, down: false }; v.name = 'Bandit'; v.sas = 'off'; }
    return v;
  };
  const probe = mk(100);
  return mk(probe.vne < 160 ? Math.min(110, 0.75 * probe.vne) : 200);
}
const counter = (name) => { let n = 0; const f0 = FX[name]; FX[name] = function (...a) { n++; return f0.apply(this, a); }; return { get n() { return n; }, off() { FX[name] = f0; } }; };

// B1 the pilot knocked out 2 km up: the hulk falls limp (no stick, no thrust) and is on the ground within 35 s; a
// bandit shot down (pilot out, or crippled with a half wing and its pilot alive) is just as limp
{
  const D = 180 / Math.PI, bad = [], times = {};
  const rates = (key, how, ai) => {
    const out = [];
    for (const s of [-1, 0, 1]) {
      const v = cruise(key, 2000, ai), F = fsim(ai ? air('falcon') : v);
      if (ai) F.vessels.push(v);
      fly(F, 1, null);
      how(v, F);
      for (let i = 0; i < 120; i++) { v.ctl.v = s; v.ctl.h = s; v.ctl.r = s; v.physicsStep(1 / 120, F); F.time += 1 / 120; }
      const w = v.bodyAV();
      out.push({ v, F, w: [w.x, w.y, w.z] });
    }
    const same = out.every((o) => o.w.every((x, j) => Math.abs(x - out[1].w[j]) <= 1e-9));
    return { same, v: out[1].v, F: out[1].F, w: out.map((o) => o.w.map((x) => +(x * D).toFixed(3))) };
  };
  const ko = (v, F) => Combat.damage(v, v.control, dmgTo(v.control, 1.01), 'shot', F);
  for (const key of ['falcon', 'mustang', 'jumbo', 'RAIDER']) {
    const r = rates(key, ko);
    deaths = [];
    const { v, F } = r, t0 = F.time;
    const tg = fly(F, 35, () => v.dead);
    times[key] = tg == null ? null : +(tg + 1).toFixed(1);
    if (!(r.same && v.down && v.isDebris && tg != null && tg + 1 <= 35 && deaths.includes('crash') && v.thrust === 0)) bad.push({ key, same: r.same, w: r.w, tg, deaths, thrust: v.thrust });
    void t0;
  }
  t(`B1 the pilot knocked out 2 km up (Falcon, Mustang, Jumbo, the raider): the stick held full either way turns it no more than hands off (body rates equal to 1e-9 after 1 s), no thrust, one fireball on the ground within 35 s (${JSON.stringify(times)})`, !bad.length, bad);
  const P = air('falcon'), k0 = Combat.S.kills;
  const bko = rates('RAIDER', (v, F) => { F.active = P; Combat.damage(v, v.control, dmgTo(v.control, 1.01), 'shot', F, P); }, true);
  const bcut = rates('RAIDER', (v, F) => { F.active = P; const w = v.mainWing; Combat.damage(v, w, dmgTo(w, 1.1), 'shot', F, P, 1); }, true);
  const lim = (o) => o.v.ai.down && o.v.isDebris && o.v.throttle === 0 && o.v.hulk != null && o.v.thrust === 0;
  t('B1 ...a bandit shot down by the player, its pilot knocked out or its wing half cut (its pilot alive): limp (debris, throttle 0, no thrust, a hulk), the stick it held turns it no more (1e-9), the kill the player\'s each time',
    bko.same && bcut.same && lim(bko) && lim(bcut) && !!bcut.v.control && bcut.v.hulkWhy === 'wing' && Combat.S.kills - k0 === 6 && Death.fb.text === 'SHOT DOWN', { ko: bko.w, cut: bcut.w, kills: Combat.S.kills - k0, fb: Death.fb.text });
}

// B2 the crash (the real Flight.breakParts, cause 'impact'): a hulk goes up in one fireball and leaves a crash site; a
// cold piece only thuds; an intact plane whose cockpit breaks goes up in one; one whose gear breaks, the old way
{
  const ex = counter('explosion');
  const P0n = () => Death.S.pyres.length;
  Death.reset({}); deaths = [];
  // a hulk (its pilot out) hitting the ground with its gear
  const h = air('falcon'), HF = fsim(h);
  Combat.damage(h, h.control, dmgTo(h.control, 1.01), 'shot', HF);
  const e0 = ex.n, gear = h.parts.find((p) => p.def.wheel);
  HF.breakParts(h, [gear], 'impact');
  const a = { deaths: deaths.slice(), dead: h.dead, pyres: P0n(), ex: ex.n - e0, parts: h.parts.includes(gear), k: Death.S.pyres[0] && +Death.S.pyres[0].k.toFixed(2) };
  // a cold piece (a fin shot off, no fuel, no engine): a thud, no crash site
  deaths = [];
  const c = air('falcon'), CF = fsim(c), fin = c.parts.find((p) => p.def.shape === 'vtail');
  Combat.damage(c, fin, dmgTo(fin, 1.1), 'shot', CF);
  const piece = CF.vessels.find((o) => o !== c && o.parts.includes(fin)), p0 = P0n(), e1 = ex.n;
  CF.breakParts(piece, piece.parts.slice(), 'impact');
  const b = { deaths: deaths.slice(), dead: piece.dead, hulk: piece.hulk != null, one: piece.parts.length === 1, pyres: P0n() - p0, ex: ex.n - e1 };
  // an intact plane whose cockpit breaks in a crash; one whose gear breaks
  deaths = [];
  const i = air('falcon'), IF = fsim(i), e2 = ex.n;
  IF.breakParts(i, [i.control], 'impact');
  const cc = { deaths: deaths.slice(), dead: i.dead, ondead: IF.ondead, ex: ex.n - e2, crashedAt: IF.crashedAt, hulk: i.hulk };
  deaths = [];
  const g = air('falcon'), GF = fsim(g), gr = g.parts.filter((p) => p.def.wheel), e3 = ex.n, n0 = g.parts.length;
  GF.breakParts(g, [gr[0]], 'impact');
  const gg = { deaths: deaths.slice(), dead: !!g.dead, ex: ex.n - e3, parts: n0 - g.parts.length, control: !!g.control, ondead: GF.ondead };
  ex.off();
  t('B2 a hulk (pilot out) breaking its gear on the ground: one fireball (crash), gone, a crash site its size (no part blown up on its own)',
    a.deaths.join() === 'crash' && a.dead && a.pyres === 1 && a.ex === 0 && a.k > 2.5, a);
  t('B2 ...a cold piece (a fin shot off: a hulk of one part) hitting the ground: a thud, gone, no crash site', b.one && b.hulk && b.deaths.join() === 'thud' && b.dead && b.pyres === 0 && b.ex === 0, b);
  t('B2 ...an intact Falcon whose cockpit breaks in a crash: one fireball, gone, destroyed now (the end screen counts from the crash), no hulk made', cc.deaths.join() === 'crash' && cc.dead && cc.ondead === 1 && cc.ex === 0 && cc.crashedAt === 0 && cc.hulk == null, cc);
  t('B2 ...an intact Falcon whose gear breaks: today\'s breakage (an explosion at the part), flying on', gg.deaths.length === 0 && !gg.dead && gg.ex === 1 && gg.parts === 1 && gg.control && gg.ondead === 0, gg);
  // Hollywood: the cockpit blows up the old way; a hulk still goes in one
  const h0 = SILLY.hollywood;
  SILLY.hollywood = true;
  try {
    deaths = [];
    const w = air('falcon'), WF = fsim(w); WF.breakParts(w, [w.control], 'impact');
    const hw = { deaths: deaths.slice(), dead: !!w.dead, cockpit: w.parts.includes(w.control) };
    t('B2 ...Hollywood: a crash that breaks the cockpit blows it up the old way (no fireball for the craft, not gone in one)', hw.deaths.length === 0 && !hw.dead, hw);
  } finally { SILLY.hollywood = h0; }
  // the crash sites: a new flight clears them, a respawn keeps them; the newest 6 kept
  const keep = P0n();
  Death.reset({ spawnOpts: { mp: { mode: 'sandbox' } } }); const mp = P0n();
  Death.reset({ spawnOpts: { keep: [h] } }); const kp = P0n();
  Death.reset({ spawnOpts: { keep: [] } }); const fresh = P0n();
  for (let k = 0; k < 8; k++) R('Death').pyre(EARTH, { x: k, y: 0, z: 0 }, 3, false, { time: k });
  const six = Death.S.pyres.map((p) => p.x).join();
  Death.reset({});
  t('B2 ...crash sites: kept by a respawn (a room\'s, or one keeping vessels), cleared by a new flight; the newest 6 kept', keep === 2 && mp === 2 && kp === 2 && fresh === 0 && six === '2,3,4,5,6,7', [keep, mp, kp, fresh, six]);
}

// B3 at rest and too old: a hot hulk lying still goes up after 2 s (on land; on the sea, steaming); a cold piece lies as
// junk, sinks from 90 s and is gone at 96 s; past 40 at rest the oldest sinks; a hulk still about after 150 s goes up
{
  const sea = () => {
    const v = air('falcon'), r = v.radius(), F = fsim(v), k = (EARTH.radius + 1.2) / r;
    v.x *= k; v.y *= k; v.z *= k; return { v, F };
  };
  // on the runway, its pilot knocked out: still, it goes up 2 s later
  deaths = []; Death.reset({});
  const L = G.craft(ctx, rows('falcon'), 'plane', 'site'), LF = fsim(L);
  Combat.damage(L, L.control, dmgTo(L.control, 1.01), 'shot', LF);
  let gone = null;
  fly(LF, 4, () => { if (L.dead && gone == null) gone = LF.time; return L.dead; });
  const land = { gone, deaths: deaths.slice(), pyres: Death.S.pyres.length, wet: Death.S.pyres[0] && Death.S.pyres[0].wet };
  t(`B3 a hot hulk (pilot out) lying still on the runway: it goes up after 2 s at rest (at ${gone && gone.toFixed(2)} s), a crash site on dry land`, gone > 1.95 && gone < 2.4 && land.deaths.join() === 'crash' && land.pyres === 1 && land.wet === false, land);
  // afloat
  deaths = []; Death.reset({});
  const { v: W, F: WF } = sea();
  Combat.damage(W, W.control, dmgTo(W.control, 1.01), 'shot', WF);
  W.splashed = true; W.vx = W.vy = W.vz = 0;
  for (let n = 1; n <= 40 && !W.dead; n++) { WF.time += 0.07; W.splashed = true; Death.tick(WF, 0.07, n); }
  const wp = Death.S.pyres[0], wet = { dead: W.dead, deaths: deaths.slice(), pyre: !!wp, wet: wp && wp.wet };
  t('B3 ...afloat on the sea: it goes up (a wet crash site, steam and no fire)', wet.dead && wet.deaths.join() === 'crash' && wet.pyre && wet.wet === true, wet);
  // a cold piece at rest: junk
  Death.reset({}); deaths = [];
  const J = G.craft(ctx, rows('falcon'), 'plane', 'site'), JF = fsim(J), fin = J.parts.find((p) => p.def.shape === 'vtail');
  Combat.damage(J, fin, dmgTo(fin, 1.1), 'shot', JF);
  const pc = JF.vessels.find((o) => o !== J && o.parts.includes(fin));
  fly(JF, 6, null, J);
  const lie = { hulk: pc.hulk, junkAt: pc.junkAt, dead: !!pc.dead, landed: pc.landed, deaths: deaths.slice() };
  let sinkAt = null, deadAt = null;
  const t0 = pc.junkAt;
  for (let n = 1; JF.time < 120 && !pc.dead; n++) { JF.time += 0.07; Death.tick(JF, 0.07, n); if (pc.sink > 0 && sinkAt == null) sinkAt = JF.time; if (pc.dead) deadAt = JF.time; }
  t(`B3 ...a cold piece (a fin shot off) at rest: junk (no fireball), sinking from 90 s (${sinkAt && (sinkAt - t0).toFixed(1)}), gone at 96 s (${deadAt && (deadAt - t0).toFixed(1)})`,
    lie.hulk == null && lie.junkAt != null && !lie.dead && !lie.deaths.length && sinkAt - t0 > 89.8 && sinkAt - t0 < 92.5 && deadAt - t0 > 95.8 && deadAt - t0 < 98.5, { lie, sinkAt, deadAt, t0 });
  // 41 junk pieces at rest: the oldest sinks now
  const parts = R('(() => { const out = []; for (let i = 0; i < 41; i++) { const p = makePart("vtail", 0, 0); const v = new Vessel([p], new Map([[p.id, new Set()]]), EARTH); v.kind = "plane"; v.rebuildGroups(); v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites.runway.east + 30 * i), 0); v.junkAt = 0; v.restAt = 10 + i; out.push(v); } return out; })()');
  const JF2 = fsim(null); JF2.vessels = parts.slice(); JF2.active = air('falcon'); JF2.time = 50;
  Death.tick(JF2, 0.07, 1);
  const sinking = parts.filter((o) => o.sinkAt != null);
  t('B3 ...41 junk pieces at rest: the oldest (and only it) starts sinking', sinking.length === 1 && sinking[0] === parts[0] && parts.every((o) => o.landed), sinking.map((o) => o.restAt));
  // a hulk still falling after 150 s goes up where it is
  deaths = []; Death.reset({});
  const O = air('falcon'), OF = fsim(O);
  Combat.damage(O, O.control, dmgTo(O.control, 1.01), 'shot', OF);
  OF.time = 149.9; Death.tick(OF, 0.07, 1); const at149 = !O.dead;
  OF.time = 150.1; Death.tick(OF, 0.07, 2);
  t('B3 ...a hulk still in the air after 150 s: it goes up where it is (not at 149.9 s)', at149 && O.dead && deaths.join() === 'crash', deaths);
  // a crippled craft (its pilot alive) landed safely: still for 3 s, its credit and crash rule go; its damage stays
  Death.reset({}); deaths = [];
  const C = G.craft(ctx, rows('mustang'), 'plane', 'site'), CF = fsim(C), by = air('skylark');
  for (const p of C.parts.filter((q) => q.def.wing && q.def.wing.control)) Combat.damage(C, p, dmgTo(p, 1.1), 'shot', CF, by);
  const was = { hulk: C.hulk != null, doom: C.doomBy === by, why: C.hulkWhy };
  fly(CF, 2.8, null); const early = C.hulk != null;
  fly(CF, 0.8, null);
  t('B3 ...a crippled Mustang (no tail, its pilot alive) landed and still for 3 s: it made it (no hulk, no credit), its damage kept, never blown up',
    was.hulk && was.doom && was.why === 'tail' && early && C.hulk == null && C.doomBy == null && !C.dead && !deaths.length && !C.wings.some((q) => q.def.wing.control), { was, hulk: C.hulk, doom: !!C.doomBy, deaths });
}

// B4 the near list (Flight.stepsNear): a hulk falling 8 km from the player is stepped (it falls and crashes there); at
// 13 km it goes on rails, where the air below the warp height ends it (Flight.railsAdvance), as anything else's would
{
  const v = air('falcon'), F = fsim(v), H = air('mustang'), D2 = air('skylark');
  Combat.damage(H, H.control, dmgTo(H.control, 1.01), 'shot', F); // (a hulk)
  const on = (o, d) => ctx.Flight.stepsNear.call(F, o, d);
  const plain = { d8: on(D2, 8000), d5: on(D2, 5000) }, hulk = { d8: on(H, 8000), d11: on(H, 11900), d13: on(H, 13000) };
  D2.control = null; void D2;
  const h0 = H.altitude();
  for (let i = 0; i < 240; i++) H.physicsStep(1 / 120, F);
  const fell = h0 - H.altitude();
  const used = ctx.Flight.railsAdvance.call(F, H, 1 / 60, false, 0);
  t('B4 a hulk 8 km and 11.9 km off is stepped (not a plain craft beyond 6 km with nobody in it); at 13 km it is not', hulk.d8 && hulk.d11 && !hulk.d13 && plain.d5 && on(H, 5000), { plain, hulk });
  t(`B4 ...stepped, it falls (${fell.toFixed(1)} m in 2 s); on rails under the warp height it ends at once (used ${used} of ${1 / 60} s: dead by the old rule)`, fell > 15 && used < 1 / 60 - 1e-6, [fell, used]);
}

// B5 no pile-up: the Hostile range, six bandits knocked out one after another (their pilots, by the player): 60 s after
// each kill nothing of it is left, never more than two bandits fly at once, and each kill is the player's
{
  const g0 = ctx.Settings.get, SET = { targets: 'hostile' };
  ctx.Settings.get = (k) => (k in SET ? SET[k] : g0.call(ctx.Settings, k));
  try {
    const P = air('falcon'), at = Combat._t.at(9000, 0, 2000), F = fsim(P);
    P.x = at.x; P.y = at.y; P.z = at.z; P.landed = false;
    Combat.reset(F); Combat.S.spawned = true; Combat.S.fighterT = 1; Death.reset(F);
    const k0 = Combat.S.kills, kills = [], left = [], seen = new Set();
    let most = 0, n = 0;
    const frame = () => {
      for (let i = 0; i < 2; i++) { for (const o of F.vessels.slice()) if (o !== P && !o.dead && o.parts.length) o.physicsStep(1 / 120, F); F.time += 1 / 120; }
      Combat.frame(F, 1 / 60);
      F.vessels = F.vessels.filter((o) => !o.dead && o.parts.length);
      const live = F.vessels.filter((o) => Combat.isFighter(o) && !o.ai.down && o.control);
      most = Math.max(most, live.length);
      for (const b of live) if (!seen.has(b)) { seen.add(b); b.seenAt = F.time; }
      for (const b of live) if (F.time - b.seenAt > 8 && kills.length < 6) { kills.push({ b, t: F.time, parts: new Set(b.parts) }); Combat.damage(b, b.control, dmgTo(b.control, 1.01), 'shot', F, P); }
      for (const k of kills) if (!k.checked && F.time - k.t >= 60) { k.checked = true; left.push(F.vessels.filter((o) => o === k.b || o.parts.some((p) => k.parts.has(p))).length); }
      n++;
    };
    while (F.time < 400 && !(kills.length === 6 && kills.every((k) => k.checked))) { frame(); if (kills.length < 6 && !F.vessels.some((o) => Combat.isFighter(o) && !o.ai.down)) Combat.S.fighterT = Math.min(Combat.S.fighterT, 1); }
    t(`B5 the Hostile range, six bandits knocked out one after another (${F.time.toFixed(0)} s of sim): 60 s after each kill nothing of it is left (${left.join(' ')}), never more than ${most} flying at once, every kill the player's`,
      kills.length === 6 && left.length === 6 && left.every((x) => x === 0) && most <= 2 && Combat.S.kills - k0 === 6, { kills: kills.length, left, most, k: Combat.S.kills - k0 });
  } finally { ctx.Settings.get = g0; Combat.reset({}); }
}

// B7 a target drone shot down: it falls on its way (fv), trailing smoke, and goes up where it hits the ground or the
// sea within 30 s; one hovering still (the Tank Range's) falls straight down; the range's respawn doesn't keep the fall
{
  const g0 = ctx.Settings.get;
  ctx.Settings.get = (k) => (k === 'targets' ? 'off' : g0.call(ctx.Settings, k));
  try {
    const P = air('falcon'), F = fsim(P), at = Combat._t.at(9000, 0, 2000);
    P.x = at.x; P.y = at.y; P.z = at.z; // (over the range, where the drones fly: their smoke within 8 km)
    Combat.reset(F);
    const mk = (speed) => {
      const d = Combat._t.makeTarget('drone'), fr = R('surfaceFrame')(d.pos.x, d.pos.y, d.pos.z);
      d.vel = { x: fr.east.x * speed, y: fr.east.y * speed, z: fr.east.z * speed };
      Combat.S.targets.push(d); return d;
    };
    const a = mk(75), b = mk(0), h0 = [a, b].map((d) => d.h);
    const tr = counter('trail');
    deaths = [];
    Combat.hitTarget(a, 1e6, P, F); Combat.hitTarget(b, 1e6, P, F);
    const fv0 = a.fv && Math.hypot(a.fv.x, a.fv.y, a.fv.z), pos0 = { ...b.pos }, r0 = Math.hypot(b.pos.x, b.pos.y, b.pos.z);
    const when = [null, null];
    let lat = 0;
    for (let i = 0; i < 31 * 60 && (when[0] == null || when[1] == null); i++) {
      F.time += 1 / 60; Combat.frame(F, 1 / 60);
      [a, b].forEach((d, j) => { if (when[j] == null && !d.fv) when[j] = F.time; });
      const rb = Math.hypot(b.pos.x, b.pos.y, b.pos.z);
      lat = Math.max(lat, Math.hypot(b.pos.x / rb - pos0.x / r0, b.pos.y / rb - pos0.y / r0, b.pos.z / rb - pos0.z / r0) * EARTH.radius);
    }
    tr.off();
    const alt = (d) => { const L = R('Terrain').locate(EARTH, d.pos.x, d.pos.y, d.pos.z, {}); return Math.hypot(d.pos.x, d.pos.y, d.pos.z) - EARTH.radius - R('Terrain').surfaceAt(EARTH, L.a, L.z); };
    t(`B7 two target drones shot down (one flying at 75 m/s, one still): they fall (from ${h0.map((x) => x.toFixed(0)).join(', ')} m), trailing smoke, and go up where they hit within 30 s (${when.map((x) => x && x.toFixed(1)).join(', ')} s), then nothing more`,
      Math.abs(fv0 - 75) < 1e-6 && when.every((x) => x != null && x <= 30) && deaths.filter((k) => k === 'crash').length === 2 && tr.n > 20 && !a.fv && !b.fv && Math.abs(alt(a)) < 1 && Math.abs(alt(b)) < 1 && lat < 1,
      { fv0, when, deaths, trails: tr.n, alt: [alt(a), alt(b)], lat });
  } finally { ctx.Settings.get = g0; Combat.reset({}); }
}

// B6 a Practice Battle flown in an aircraft: knocked out 400 m up it leaves no wreck in the sky, it falls and goes up
// where it hits; knocked out standing on the ground it stays as a wreck (and is never blown up by the rest rule)
{
  const designOf = (key) => ({ name: TEMPLATES[key].name, kind: TEMPLATES[key].kind, parts: R('templateRows')(TEMPLATES[key]) });
  const world = () => fsim(null, { launchCost: 0, flags: {}, downs: 0, design: null, warpIdx: 0, mgFiring: false, aim: null, zero: 800,
    award() {}, cleanup() { this.vessels = this.vessels.filter((v) => !v.dead && v.parts.length); },
    onDestroyed() { if (this.destroyed) return; this.destroyed = true; this.downs++; if (ctx.GroundAI.battle && ctx.GroundAI.onDestroyed(this)) return; },
    start(design, opts) {
      this.design = design;
      const v = R('((d, P) => { const ps = partsFromDesign(d.parts), adjAll = buildAdjacency(ps), ctrl = findControlPart(ps), keep = componentOf(ctrl.id, adjAll), parts = ps.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of parts) { if (p.att != null && !keep.has(p.att)) p.att = null; adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id)))); } const v = new Vessel(parts, adj, EARTH); v.name = d.name; v.kind = d.kind; v.stages = computeStages(parts, adj, ctrl.id); v.rebuildGroups(); v.placeOnSurface(EARTH, siteAngle(EARTH, P ? P.e : EARTH.sites.runway.east), 0, P ? P.z : 0, P ? P.yaw || 0 : 0); return v; })')(design, opts && opts.place);
      this.vessels = [v, ...(opts && Array.isArray(opts.keep) ? opts.keep.filter((o) => o && o !== v && !o.dead) : [])]; this.active = v; this.destroyed = false;
      Combat.reset(this); this.running = true;
      return v;
    } });
  const run0 = ctx.Flight.running;
  ctx.Flight.running = true; // (GroundAI.battle reads the real Flight's)
  try {
    const go = (air) => {
      const F = world();
      ctx.GroundAI.startBattle(F, { money: 45000, design: designOf('tk34'), seed: 5 });
      const B = ctx.GroundAI.battle, tank = F.active, pl = air ? cruise('mustang', 0) : G.craft(ctx, rows('mustang'), 'plane', 'site');
      const u = { x: tank.x / tank.radius(), y: tank.y / tank.radius(), z: tank.z / tank.radius() }, r = air ? tank.radius() + 400 : null;
      if (air) { pl.x = u.x * r; pl.y = u.y * r; pl.z = u.z * r; const f = Math.hypot(pl.vx, pl.vy, pl.vz), e = { x: -u.y, y: u.x, z: 0 }, el = Math.hypot(e.x, e.y) || 1; pl.vx = (e.x / el) * f; pl.vy = (e.y / el) * f; pl.vz = 0; }
      else { const P = R('GroundMode').placement(B.arena, 0, 0, 'tank'); pl.placeOnSurface(EARTH, R('siteAngle')(EARTH, P.e), R('VEHICLE_KINDS').plane.launchRot, P.z, P.yaw || 0); }
      tank.dead = true; F.vessels = F.vessels.filter((o) => o !== tank); F.vessels.push(pl); F.active = pl; B.kind = 'plane';
      deaths = [];
      Combat.damage(pl, pl.control, dmgTo(pl.control, 1.01), 'shot', F, F.vessels.find((o) => o.ai && o.ai.ground && o.ai.team === 1));
      const out = { battle: !!B, destroyed: F.destroyed, wreck: !!pl.wreck, lost: B.lost };
      out.tg = fly(F, air ? 30 : 3, () => pl.dead);
      Object.assign(out, { dead: !!pl.dead, deaths: deaths.filter((k) => k === 'crash').length, wreck2: !!pl.wreck });
      return out;
    };
    const up = go(true), down = go(false);
    t(`B6 a Practice Battle's aircraft knocked out 400 m up: no wreck frozen in the sky, it falls and goes up where it hits (${up.tg && up.tg.toFixed(1)} s)`,
      up.battle && up.destroyed && !up.wreck && up.lost === 1 && up.dead && up.deaths === 1 && up.tg != null && up.tg < 25, up);
    t('B6 ...knocked out standing on the ground: it stays as a wreck (not blown up by the rest rule)', down.battle && down.destroyed && down.wreck && down.wreck2 && !down.dead && down.deaths === 0, down);
  } finally { ctx.Flight.running = run0; Combat.reset({}); }
}

// B8 nobody at the controls: Flight.readControls and setThrottle do nothing to a hulk (a knocked-out vehicle brakes);
// usePart and stage won't relight an engine shot dead, nor work a downed hulk's parts
{
  const ui = { updateDvEstimate() {}, updateHUD() {}, updateThrottleDom() {}, setWarp() {}, flash: null, keys: new Set(['KeyW', 'KeyD', 'KeyE']), stick: { v: 1, h: 1, r: 1 }, touchBrake: false };
  const v = air('falcon'), F = fsim(v, ui);
  Combat.damage(v, v.control, dmgTo(v.control, 1.01), 'shot', F);
  ctx.Flight.readControls.call(F, 1 / 60); ctx.Flight.setThrottle.call(F, 1);
  const hulk = { ctl: [v.ctl.v, v.ctl.h, v.ctl.r], brake: v.brake, th: v.throttle };
  const car = G.craft(ctx, rows('buggy'), 'car'), CF = fsim(car, ui);
  car.ko = { why: 'crew', x: false, t: 0 }; CF.destroyed = true;
  ctx.Flight.readControls.call(CF, 1 / 60);
  const m = air('mustang'), MF = fsim(m, ui), e = m.parts.find((p) => p.def.thrust);
  Combat.damage(m, e, dmgTo(e, 1.1), 'shot', MF);
  ctx.Flight.usePart.call(MF, m, e); const used = e.active;
  m.stageIdx = 0; m.stages = [[e.id]];
  ctx.Flight.stage.call(MF); const staged = e.active;
  const tank = v.parts.find((p) => p.def.thrust);
  ctx.Flight.usePart.call(F, v, tank);
  t('B8 a pilot knocked out: the stick and keys held, the hulk\'s controls stay at rest, the throttle stays shut; a knocked-out car brakes',
    hulk.ctl.every((x) => x === 0) && hulk.brake === false && hulk.th === 0 && car.brake === true && car.ctl.v === 0, { hulk, car: car.brake });
  t('B8 ...an engine shot dead: a tap on it and STAGE won\'t relight it ("… is out"); a downed hulk\'s parts can\'t be worked',
    used === false && staged === false && MF.log.filter((x) => / is out$/.test(x)).length === 2 && tank.active === false, MF.log);
  // (Phase 2 review P2-AIR-R2) F and G on a knocked-out pilot's hulk: the flaps and the gear stay as they were (a
  // hulk with its flaps put out and its gear dropped climbed 650 m instead of falling)
  const hk = [];
  for (const key of ['mustang', 'jumbo']) {
    const h = cruise(key), HF = fsim(h, ui);
    Combat.damage(h, h.control, dmgTo(h.control, 1.01), 'shot', HF);
    const was = [h.flaps, h.gearUp];
    ctx.Flight.cycleFlaps.call(HF); ctx.Flight.cycleFlaps.call(HF); ctx.Flight.toggleGear.call(HF);
    hk.push({ key, inert: ctx.Flight.inert.call(HF, h), was, now: [h.flaps, h.gearUp], log: HF.log.slice() });
  }
  // ...while a craft with its pilot in it still works both (no change for the living)
  const lv = cruise('mustang'), LF = fsim(lv, ui);
  ctx.Flight.cycleFlaps.call(LF); ctx.Flight.toggleGear.call(LF);
  t('B8 ...F and G on a knocked-out pilot\'s hulk: its flaps and gear stay as they were, with no toast; a live plane still works both',
    hk.every((x) => x.inert && x.now[0] === x.was[0] && x.now[1] === x.was[1] && !x.log.some((m) => /Gear|flaps/i.test(m))) && lv.flaps === 0.5 && lv.gearUp === false,
    { hk, live: [lv.flaps, lv.gearUp] });
}


// B9 (Phase 1's close) half a wing shot off rolls the plane off towards the lost half at once, whatever its autopilot
// does (the kept half's lift with its aileron at rest, twice more: DEATH_CUT_ROLL, vessel.js): every plane template on
// hold, hands off, at cruise 2 km up, rolls at 60°/s or more within 2 s and banks past 60° within 3 s; not the
// biplane (its other wing holds it up). Before, hold held the wings level: most rolled under 10°/s
{
  const D = 180 / Math.PI, dt = 1 / 120, bad = [], peaks = {};
  for (const key of PLANES) {
    const v = cruise(key), s = G.sim();
    for (let i = 0; i < 120; i++) { v.physicsStep(dt, s); s.time += dt; }
    v.mainWing.cut = 1; v.rebuildGroups();
    const P = v.pilot;
    let peak = 0, bank = 0;
    for (let i = 1; i <= 3 / dt; i++) {
      v.ctl.v = v.ctl.h = v.ctl.r = 0; v.physicsStep(dt, s); s.time += dt;
      const w = v.bodyAV(), roll = (w.x * P.F.x + w.y * P.F.y + w.z * P.F.z) * D, r = Math.hypot(v.x, v.y, v.z), Rr = v.axis(P.R.x, P.R.y, P.R.z);
      if (i * dt <= 2) peak = Math.max(peak, roll);
      bank = Math.max(bank, -Math.asin(Math.max(-1, Math.min(1, (Rr.x * v.x + Rr.y * v.y + Rr.z * v.z) / r))) * D);
    }
    peaks[key] = Math.round(peak);
    if (key !== 'barnstormer' && !(peak >= 60 && bank > 60)) bad.push({ key, peak, bank });
  }
  t(`B9 half the main wing shot off, hold on, hands off: every plane template but the biplane rolls off towards the lost half at 60°/s or more within 2 s and banks past 60° within 3 s (${Object.entries(peaks).map(([k, x]) => k + ' ' + x).join(', ')})`, PLANES.length === 25 && !bad.length, bad);
}

// B10 (Phase 2 review P2-AIR-R3) the crash's fireball and crash site are on the ground where the craft hit, not at its
// centre of mass: hulks dropped on the runway level and banked 85° (a wing tip touching first: the centre 14 m up),
// and diving; and a hulk too old to fall any longer goes up where it is, in the air (nothing there to stand on)
{
  const qmul = R('qmul'), { Terrain } = ctx, got = [];
  const hAbove = (p) => { const L = Terrain.locate(EARTH, p.x, p.y, p.z, {}); return Math.hypot(p.x, p.y, p.z) - EARTH.radius - Terrain.surfaceAt(EARTH, L.a, L.z); };
  const d0 = FX.death; let at = null;
  FX.death = function (...a) { if (a[4] === 'crash') at = { ...a[1] }; return d0.apply(this, a); };
  try {
    for (const [key, roll, down, along] of [['jumbo', 0, 25, 60], ['jumbo', 85, 25, 60], ['falcon', 45, 25, 60], ['mustang', 0, 190, 70]]) {
      const v = G.craft(ctx, rows(key), 'plane', 'site'), F = fsim(v);
      Death.reset({}); at = null;
      const r0 = Math.hypot(v.x, v.y, v.z), up = { x: v.x / r0, y: v.y / r0, z: v.z / r0 };
      const Fw = v.axis(v.pilot.F.x, v.pilot.F.y, v.pilot.F.z), h = (roll * Math.PI) / 360;
      v.q = qmul({ w: Math.cos(h), x: Math.sin(h) * Fw.x, y: Math.sin(h) * Fw.y, z: Math.sin(h) * Fw.z }, v.q);
      v.x += up.x * 40; v.y += up.y * 40; v.z += up.z * 40; v.landed = false;
      v.vx = -up.x * down + Fw.x * along; v.vy = -up.y * down + Fw.y * along; v.vz = -up.z * down + Fw.z * along;
      Combat.damage(v, v.control, dmgTo(v.control, 1.01), 'shot', F);
      for (let i = 0; i < 120 * 6 && !v.dead; i++) { v.physicsStep(1 / 120, F); F.time += 1 / 120; }
      const p = Death.S.pyres[Death.S.pyres.length - 1];
      got.push({ key, roll, dead: !!v.dead, fire: at && +hAbove(at).toFixed(2), site: p && +hAbove(p).toFixed(2) });
    }
    // a hulk gliding on past DEATH.hulkMax: it goes up in the air where it is
    const g = cruise('falcon', 2000), GF = fsim(g); Death.reset({}); at = null;
    Combat.damage(g, g.control, dmgTo(g.control, 1.01), 'shot', GF);
    g.hulk = -1e3; Death.tick(GF, 0.07, 1);
    got.push({ key: 'old hulk', dead: !!g.dead, fire: at && Math.round(hAbove(at)) });
  } finally { FX.death = d0; Death.reset({}); }
  const onGround = got.slice(0, 4), aloft = got[4];
  t(`B10 a crash's fireball and crash site sit on the ground where it hit, level or banked 85° (${onGround.map((x) => `${x.key} ${x.roll}°: ${x.site} m`).join(', ')}); a hulk too old goes up in the air where it is (${aloft.fire} m up)`,
    onGround.every((x) => x.dead && Math.abs(x.fire) < 0.05 && Math.abs(x.site) < 0.05) && aloft.dead && aloft.fire > 1500, got);
}

// ================================================================ C. ground vehicles
// Old cars, the Desert Technical and Armour knocked out and left as wrecks (C7, the ground AI's lifetimes, runs with the
// Tank Range in groundai.test.js). A vehicle on the runway as Flight.start puts it; stepped as Flight.update steps the
// world (what isn't a wreck, two 1/120 s physics steps a 60 fps frame, Combat.step, Combat.frame once a frame).
const gnd = (key) => G.craft(ctx, rows(key), TEMPLATES[key].kind, 'site');
const goG = (F, secs, each) => {
  for (let f = 0, N = Math.round(secs * 60); f < N; f++) {
    for (let i = 0; i < 2; i++) { for (const o of F.vessels.slice()) if (!o.remote && !o.wreck && !o.kin && !o.dead && o.parts.length) o.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; }
    Combat.frame(F, 1 / 60); F.vessels = F.vessels.filter((o) => !o.dead && o.parts.length);
    if (each && each(f) === false) return;
  }
};
const upBy = (v, h) => { const r = Math.hypot(v.x, v.y, v.z); v.x += (v.x / r) * h; v.y += (v.y / r) * h; v.z += (v.z / r) * h; v.landed = false; v.contactTime = 0; };
// calls into the ground update's systems (gear.js, aim.js, armour.js, gmode.js, groundai.js), counted while fn runs
function sysCalls(fn) {
  const n = {}, undo = [];
  for (const name of ['Gear', 'Aim', 'Armour', 'GroundMode', 'GroundAI']) {
    const o = ctx[name];
    if (!o) continue;
    for (const k of Object.keys(o)) if (typeof o[k] === 'function') { const f = o[k]; o[k] = function (...a) { n[name + '.' + k] = (n[name + '.' + k] || 0) + 1; return f.apply(this, a); }; undo.push([o, k, f]); }
  }
  try { fn(); } finally { for (const [o, k, f] of undo) o[k] = f; }
  return n;
}
// C1 a cab shot to 0 on the Dune Buggy and the Desert Technical, each the player's, driving on the runway: the driver
// knocked out, every part aboard, one small 'ko' death effect, the end of the drive once; it coasts to a stop and is
// a wreck within 6 s; the Technical's gun silenced; the buggy never calls into the ground update's code
{
  const out = {};
  for (const key of ['buggy', 'technical']) {
    const v = gnd(key), F = fsim(v), cab = v.parts.find((p) => p.type === 'cab'), ids = v.parts.map((p) => p.id).join();
    Combat.reset(F); goG(F, 1); v.ctl.v = 1; goG(F, 2); v.ctl.v = 0;
    const sp = v.speed();
    deaths = [];
    let wAt = null, shots = 0;
    const calls = sysCalls(() => {
      Combat.damage(v, cab, dmgTo(cab, 1.2), 'shot', F);
      const t0 = F.time;
      F.firing = true; // (the trigger held: the Technical's gun, knocked out, fires nothing)
      goG(F, 7, () => { shots = Math.max(shots, Combat.S.shots.length); if (wAt == null && v.wreck) wAt = F.time - t0; });
      F.firing = false;
    });
    out[key] = { v, F, cab, sp, wAt, shots, calls, d: deaths.slice(), same: v.parts.map((p) => p.id).join() === ids };
  }
  const b = out.buggy, k = out.technical;
  const ok = (o, toast) => o.same && o.v.ko && o.v.ko.why === 'crew' && o.cab.ko === true && o.cab.hp <= 0 && !o.v.control && o.d.join() === 'ko' && o.F.ondead === 1 && o.F.nBreak === 0 && o.F.nRip === 0
    && o.F.log.includes(toast) && o.sp > 5 && o.wAt != null && o.wAt <= 6 && o.v.speed() === 0;
  t(`C1 the Dune Buggy's cab shot to 0 while driving (${b.sp.toFixed(1)} m/s): its driver knocked out ("Driver knocked out!"), every part aboard, one 'ko' death effect, the end of the drive once, a wreck ${b.wAt != null ? b.wAt.toFixed(1) : '-'} s later`,
    ok(b, 'Driver knocked out!'), { ko: b.v.ko, d: b.d, log: b.F.log, wAt: b.wAt, break: b.F.nBreak, rip: b.F.nRip });
  t(`C1 ...the Desert Technical's the same (armour.js's knock-out: "Knocked out!"), a wreck ${k.wAt != null ? k.wAt.toFixed(1) : '-'} s later, its gun silent with the trigger held (Armour.has false)`,
    ok(k, 'Knocked out!') && ctx.Armour.has(k.v) === false && k.shots === 0, { ko: k.v.ko, d: k.d, log: k.F.log, wAt: k.wAt, shots: k.shots });
  t('C1 ...the buggy\'s knock-out, coast and 7 s as a wreck: no calls into Gear, Aim, Armour, GroundMode or GroundAI', JSON.stringify(b.calls) === '{}', b.calls);
}
// C1b Hollywood: the cab blows up the old way
{
  const v = gnd('buggy'), F = fsim(v), cab = v.parts.find((p) => p.type === 'cab');
  SILLY.hollywood = true;
  try { Combat.damage(v, cab, dmgTo(cab, 1.2), 'shot', F); } finally { SILLY.hollywood = false; }
  t('C1 ...in Hollywood the buggy\'s cab blows up the old way (breakParts, no knock-out)', F.nBreak === 1 && !v.parts.includes(cab) && !v.ko, { n: F.nBreak, ko: v.ko });
}
// C2 a buggy driven nose first into the runway at 30 m/s, and one dropped on its roof at 30 m/s, through the real
// Flight.breakParts and its crash hook: the cab broken is kept aboard knocked out ("Wrecked!"), the hulk frozen at once
// where it hit, and 120 more steps leave it there (a wreck isn't stepped: it can't sink through the ground)
{
  const qmul = R('qmul'), qaxis = R('qaxis'), res = {};
  for (const how of ['nose', 'roof']) {
    const v = gnd('buggy'), F = fsim(v, { dist: () => 10, absPos: (o) => ({ x: o.x, y: o.y, z: o.z }) }), cab = v.parts.find((p) => p.type === 'cab');
    Combat.reset(F); goG(F, 0.5);
    const r = Math.hypot(v.x, v.y, v.z), u = { x: v.x / r, y: v.y / r, z: v.z / r };
    v.q = how === 'nose' ? qmul(v.q, qaxis(0, 0, 1, -Math.PI / 2)) : qmul(v.q, qaxis(1, 0, 0, Math.PI));
    upBy(v, 6); v.vx = -u.x * 30; v.vy = -u.y * 30; v.vz = -u.z * 30; v.av = { x: 0, y: 0, z: 0 };
    deaths = [];
    let at = null;
    goG(F, 1, () => { if (v.wreck && !at) at = [v.x, v.y, v.z]; });
    const P = [v.x, v.y, v.z];
    goG(F, 1);
    res[how] = { v, F, cab, at, still: !!at && P.every((x, i) => x === at[i]) && [v.x, v.y, v.z].every((x, i) => x === at[i]), d: deaths.slice() };
  }
  const ok = (o) => o.v.ko && o.v.ko.why === 'hull' && o.v.wreck && o.v.parts.includes(o.cab) && o.cab.ko && o.cab.hp <= 0 && o.still && o.d.join() === 'ko' && o.F.log.includes('Wrecked!') && o.F.ondead === 1;
  t('C2 a buggy nose first into the runway at 30 m/s: the cab kept, knocked out ("Wrecked!"), the hulk frozen where it hit and still there 120 steps later; one \'ko\' effect',
    ok(res.nose), { ko: res.nose.v.ko, parts: res.nose.v.parts.map((p) => p.type), d: res.nose.d, still: res.nose.still, log: res.nose.F.log });
  t('C2 ...dropped on its roof at 30 m/s: the same, its chassis and wheels still on it', ok(res.roof) && res.roof.v.parts.length === 4, { parts: res.roof.v.parts.map((p) => p.type), still: res.roof.still });
}
// C3 a TK-34 dropped 40 m on its roof: the turret broken in the crash knocks it out (Armour's rule, 'hull'), its hull,
// turret and crew kept (what else broke goes as ever), a wreck at once, one death effect. (Dropped 40 m the right way up, its tracks take the landing: broken, the
// hull untouched, no knock-out, as today.)
{
  const qmul = R('qmul'), qaxis = R('qaxis');
  const v = gnd('tk34'), F = fsim(v, { dist: () => 10, absPos: (o) => ({ x: o.x, y: o.y, z: o.z }) }), n0 = v.parts.length;
  Combat.reset(F); goG(F, 1);
  const ctl = v.parts.filter((p) => p.def.control);
  v.q = qmul(v.q, qaxis(1, 0, 0, Math.PI)); upBy(v, 40);
  deaths = [];
  goG(F, 4);
  t(`C3 a TK-34 dropped 40 m on its roof: knocked out by armour.js ("hull"), its hull, turret and crew kept (${v.parts.length} of ${n0} parts), a wreck, one death effect`,
    v.ko && v.ko.why === 'hull' && ctl.every((p) => v.parts.includes(p)) && v.wreck && deaths.join() === 'ko' && F.destroyed, { ko: v.ko, n: v.parts.length, n0, wreck: v.wreck, d: deaths }); // (the end of the drive: breakParts says so again for what else broke, which Flight.onDestroyed ignores)
  const w = gnd('tk34'), WF = fsim(w);
  Combat.reset(WF); goG(WF, 1); upBy(w, 40); deaths = [];
  goG(WF, 4);
  t('C3 ...dropped 40 m the right way up: its tracks take the landing (broken), no knock-out (as today)', !w.ko && w.parts.filter((p) => p.def.track).every((p) => p.broken) && !deaths.length, { ko: w.ko, log: WF.log });
}
// C3b (Phase 2 review P2-GND-1) dropped 40 m nose first or tail first, the hull broken in the crash: the wreck is laid
// down (its forward axis within 30° of the level, onto its tracks), its lowest point on the ground, no taller than it is
// lying; before, it froze standing on its nose or tail (60-90° up, 5.5-10.4 m tall) for five minutes
{
  const qmul = R('qmul'), qaxis = R('qaxis'), qrot = R('qrot'), got = [];
  const pose = (v) => {
    const r = Math.hypot(v.x, v.y, v.z), u = { x: v.x / r, y: v.y / r, z: v.z / r }, cz = v.com.z || 0, loc = {};
    let lo = 1e9, hi = -1e9, deep = -1e9;
    for (const k of [...v.hull, ...v.wheelPts]) {
      const o = qrot(v.q, k.x - v.com.x, k.y - v.com.y, k.z - cz), h = o.x * u.x + o.y * u.y + o.z * u.z;
      lo = Math.min(lo, h - (k.r || 0)); hi = Math.max(hi, h + (k.r || 0));
      const px = v.x + o.x, py = v.y + o.y, pz = v.z + o.z; ctx.Terrain.locate(v.body, px, py, pz, loc);
      deep = Math.max(deep, v.body.radius + ctx.Terrain.surfaceAt(v.body, loc.a, loc.z) - (Math.hypot(px, py, pz) - (k.r || 0)));
    }
    const f = qrot(v.q, 1, 0, 0), y = qrot(v.q, 0, 1, 0);
    return { pitch: Math.round(Math.asin(Math.abs(f.x * u.x + f.y * u.y + f.z * u.z)) * 180 / Math.PI), up: +(y.x * u.x + y.y * u.y + y.z * u.z).toFixed(2), tall: +(hi - lo).toFixed(1), deep: +deep.toFixed(2) };
  };
  for (const key of ['tk34', 'ma1']) for (const [how, a] of [['nose', -Math.PI / 2], ['nose 60°', -Math.PI / 3], ['tail', Math.PI / 2]]) {
    const v = gnd(key), F = fsim(v, { dist: () => 10, absPos: (o) => ({ x: o.x, y: o.y, z: o.z }) });
    Combat.reset(F); goG(F, 1);
    v.q = qmul(v.q, qaxis(0, 0, 1, a)); upBy(v, 40); v.vx = v.vy = v.vz = 0; v.av = { x: 0, y: 0, z: 0 };
    goG(F, 5);
    got.push({ key, how, ko: v.ko && v.ko.why, wreck: !!v.wreck, ...(v.wreck ? pose(v) : {}) });
  }
  t(`C3b dropped 40 m nose or tail first and knocked out: the wreck lies on its tracks on the ground (${got.map((g) => `${g.key} ${g.how}: ${g.pitch}°, ${g.tall} m tall`).join('; ')})`,
    got.every((g) => g.wreck && g.ko === 'hull' && g.pitch <= 30 && g.up > 0.8 && g.tall < 4.5 && Math.abs(g.deep) < 0.3), got);
}
// C4 Armour.knockOut's death effect: one FX.death, 'ammo' with a detonation (where the rounds went up), 'ko' without; it
// draws none of the victim's dice (the turret a detonation throws tumbles exactly as a bare toss from the same seed does)
{
  const A = ctx.Armour;
  const ko = (det) => { const v = gnd('tk34'), F = fsim(v); deaths = []; A.knockOut(v, F, det ? 'ammo' : 'crew', det ? { st: A.crewOf(v).stores[0], rounds: 30 } : undefined); return { v, F, d: deaths.slice() }; };
  const a = ko(false), b = ko(true);
  const tumble = (bare) => { const v = gnd('tk34'), F = fsim(v); A.seed(4242); if (bare) A.toss(v, F, A.crewOf(v).stores[0]); else A.knockOut(v, F, 'ammo', { st: A.crewOf(v).stores[0], rounds: 30 }); const q = F.vessels.find((o) => o.tossed); return q && [q.av.x, q.av.y, q.av.z, q.vx, q.vy, q.vz]; };
  const t1 = tumble(false), t2 = tumble(true);
  t('C4 Armour.knockOut: one death effect, \'ko\' for a plain knock-out and \'ammo\' for a detonation, which keeps its thrown turret (v.bits)',
    a.d.join() === 'ko' && b.d.join() === 'ammo' && Array.isArray(b.v.bits) && b.v.bits.length === 1 && b.v.bits[0].tossed && !a.v.bits, [a.d, b.d, b.v.bits && b.v.bits.length]);
  t('C4 ...and draws none of the victim\'s dice: the thrown turret tumbles exactly as a bare toss from the same seed', !!t1 && JSON.stringify(t1) === JSON.stringify(t2), [t1, t2]);
}
// C5 a TK-34 knocked out by a detonation 20 m up falls, and settles into a wreck within 6 s of touching down; its thrown
// turret lies where it lands (a wreck, charred, not knocked out itself: no fire of its own). Knocked out on the ground,
// the turret settles once it lies still
{
  const v = gnd('tk34'), F = fsim(v), A = ctx.Armour;
  Combat.reset(F); goG(F, 1); upBy(v, 20);
  deaths = [];
  A.knockOut(v, F, 'ammo', { st: A.crewOf(v).stores[0], rounds: 30 });
  const tur = (v.bits || [])[0];
  let touch = null, wAt = null;
  goG(F, 12, () => { if (touch == null && v.contactTime > 0) touch = F.time; if (wAt == null && v.wreck) wAt = F.time; });
  t(`C5 a TK-34 knocked out 20 m up: it falls, touches down at ${touch != null ? touch.toFixed(2) : '-'} s and is a wreck ${wAt != null && touch != null ? (wAt - touch).toFixed(2) : '-'} s later (≤ 6); its thrown turret lands hard and lies there, a wreck, with no death effect or fire of its own`,
    touch != null && wAt != null && wAt - touch <= 6 && v.speed() === 0 && !!tur && tur.wreck && deaths.join() === 'ammo', { touch, wAt, tur: tur && [tur.wreck, tur.ko], d: deaths });
  const g = gnd('tk34'), GF = fsim(g);
  Combat.reset(GF); goG(GF, 1);
  A.knockOut(g, GF, 'ammo', { st: A.crewOf(g).stores[0], rounds: 30 });
  const gt = (g.bits || [])[0];
  let still = null, gw = null;
  goG(GF, 12, () => { if (gt && still == null && gt.contactTime > 0 && gt.speed() < 1) still = GF.time; if (gt && gw == null && gt.wreck) gw = GF.time; });
  t('C5 ...knocked out on the ground: the turret it throws settles into a wreck once it lies still (on the ground, under 1 m/s)',
    !!gt && gw != null && still != null && gw - still < 0.1 && gt.speed() === 0 && g.wreck, { still, gw });
}
// C5b (Phase 2's merge) the player's TK-34 knocked out in the air in a Practice Battle (a blast threw it, it went off a
// crest): no wreck frozen in the air (GroundAI.onDestroyed made it one at once, where it was); it falls, and is the
// battle's wreck once it lands (five minutes, then sunk, as every other). Knocked out 120 m up with the respawn coming
// before it lands, the respawn keeps it falling, and it is a wreck where it lands.
{
  const designOf = (key) => ({ name: TEMPLATES[key].name, kind: TEMPLATES[key].kind, parts: R('templateRows')(TEMPLATES[key]) });
  const world = () => fsim(null, { launchCost: 0, flags: {}, downs: 0, design: null, warpIdx: 0, mgFiring: false, aim: null, zero: 800,
    award() {}, cleanup() { this.vessels = this.vessels.filter((v) => !v.dead && v.parts.length); },
    onDestroyed() { if (this.destroyed) return; this.destroyed = true; this.downs++; if (ctx.GroundAI.battle && ctx.GroundAI.onDestroyed(this)) return; },
    start(design, opts) {
      this.design = design;
      const v = R('((d, P) => { const ps = partsFromDesign(d.parts), adjAll = buildAdjacency(ps), ctrl = findControlPart(ps), keep = componentOf(ctrl.id, adjAll), parts = ps.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of parts) { if (p.att != null && !keep.has(p.att)) p.att = null; adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id)))); } const v = new Vessel(parts, adj, EARTH); v.name = d.name; v.kind = d.kind; v.stages = computeStages(parts, adj, ctrl.id); v.rebuildGroups(); v.placeOnSurface(EARTH, siteAngle(EARTH, P ? P.e : EARTH.sites.runway.east), 0, P ? P.z : 0, P ? P.yaw || 0 : 0); return v; })')(design, opts && opts.place);
      this.vessels = [v, ...(opts && Array.isArray(opts.keep) ? opts.keep.filter((o) => o && o !== v && !o.dead) : [])]; this.active = v; this.destroyed = false;
      Combat.reset(this); this.running = true;
      return v;
    } });
  const r0 = (o) => Math.hypot(o.x, o.y, o.z);
  const run0 = ctx.Flight.running;
  ctx.Flight.running = true; // (GroundAI.battle reads the real Flight's)
  try {
    const go = (h, respawnAt) => {
      const F = world();
      ctx.GroundAI.startBattle(F, { money: 45000, design: designOf('tk34'), seed: 5 });
      const B = ctx.GroundAI.battle, tank = F.active;
      goG(F, 1);
      const g0 = r0(tank);
      upBy(tank, h); tank.vx = tank.vy = tank.vz = 0;
      ctx.Armour.knockOut(tank, F, 'crew');
      const o = { battle: !!B, destroyed: F.destroyed, wreck0: !!tank.wreck, lost: B.lost, h0: r0(tank) - g0 };
      let wAt = null, hAt = null, kept = null, again = null;
      const t0 = F.time;
      goG(F, 14, () => {
        if (respawnAt != null && again == null && F.time - t0 >= respawnAt) { F.time = Math.max(F.time, B.respawnAt); again = ctx.GroundAI.respawn(F); kept = again && F.active !== tank && F.vessels.includes(tank) && !tank.wreck; }
        if (wAt == null && tank.wreck) { wAt = F.time - t0; hAt = r0(tank) - g0; }
        if (wAt != null && F.time - t0 > wAt + 0.2) return false;
      });
      Object.assign(o, { wAt, hAt, again, kept, still: tank.speed() === 0, apart: F.active !== tank ? Math.hypot(F.active.x - tank.x, F.active.y - tank.y, F.active.z - tank.z) : null });
      if (!again) { F.time = Math.max(F.time, B.respawnAt); again = ctx.GroundAI.respawn(F); }
      const T = F.time;
      F.time = T + 301; goG(F, 0.1); // (five minutes on: the battle's wreck list sinks it and it goes)
      o.sunk = !!tank.dead && !F.vessels.includes(tank);
      return o;
    };
    const lo = go(20), hi = go(120, 4.5);
    t(`C5b a Practice Battle: the player's TK-34 knocked out 20 m up isn't a wreck in the air; it falls and is the battle's wreck where it lands (${lo.wAt != null ? lo.wAt.toFixed(2) : '-'} s on, ${lo.hAt != null ? lo.hAt.toFixed(2) : '-'} m off the ground it stood on), sunk five minutes on`,
      lo.battle && lo.destroyed && !lo.wreck0 && lo.lost === 1 && lo.h0 > 19 && lo.wAt != null && lo.wAt > 1.5 && Math.abs(lo.hAt) < 2 && lo.still && lo.sunk, lo);
    t('C5b ...knocked out 120 m over its pad and respawned (4.5 s on) before it lands: it is kept by the respawn, still falling, the new vehicle on a pad spot clear of it, and is a wreck where it lands, sunk five minutes on',
      hi.destroyed && !hi.wreck0 && hi.again === true && hi.kept === true && hi.wAt != null && hi.wAt > 4.5 && Math.abs(hi.hAt) < 1 && hi.apart > 9 && hi.sunk, hi);
  } finally { ctx.Flight.running = run0; Combat.reset({}); }
}
// C6 a wreck's fire and smoke (Death.wreckFX, one 0.07 s tick each; FX counted): a plain knock-out burns 20 s (a flame
// each tick, a column puff every 6th on High, 12th on Low), a detonation's 40 s; then a column puff every 20th tick to
// two minutes; then a grey wisp every 40th; none once it sinks. Of five knocked-out hulks only the 3 nearest the camera
// within 4 km burn and smoke (groundTick), none above 4× warp; a knocked-out hulk's parts give none of the old smoke
{
  const fl = FX.flame, sm = FX.smoke, Sg = R('Settings'), partZc = R('partZc');
  let log = [];
  FX.flame = function (b, p, v, k) { log.push(['flame', p]); return fl.apply(this, arguments); };
  FX.smoke = function (b, p, v, pr, k) { log.push([pr, p]); return sm.apply(this, arguments); };
  const count = (o, age, n0, N, x) => { log = []; o.ko.t = 0; o.ko.x = x; for (let n = n0; n < n0 + N; n++) Death.wreckFX(o, n, { time: age }); const c = {}; for (const [k] of log) c[k] = (c[k] || 0) + 1; return c; };
  const v = gnd('tk34'); v.ko = { why: 'crew', x: false, t: 0 };
  const q0 = Sg.data.quality;
  Sg.data.quality = 'high';
  const hi = { b: count(v, 10, 1, 60, false), b2: count(v, 19.9, 1, 60, false), s: count(v, 20.1, 1, 60, false), a: count(v, 39.9, 1, 60, true), as: count(v, 40.1, 1, 60, true), s2: count(v, 119.9, 1, 60, false), w: count(v, 121, 1, 80, false) };
  Sg.data.quality = 'low';
  const lo = count(v, 10, 1, 60, false);
  v.sink = 0.2; const sunk = count(v, 10, 1, 60, false); v.sink = 0;
  Sg.data.quality = q0;
  const J = JSON.stringify;
  t('C6 a knocked-out wreck: burning to 20 s (a flame each tick, a column every 6th on High, every 12th on Low), a detonation\'s to 40 s; then a column every 20th tick to 120 s; then a grey wisp every 40th; none while it sinks',
    J(hi.b) === J({ flame: 60, column: 10 }) && J(hi.b2) === J(hi.b) && J(hi.s) === J({ column: 3 }) && J(hi.a) === J(hi.b) && J(hi.as) === J({ column: 3 }) && J(hi.s2) === J({ column: 3 }) && J(hi.w) === J({ grey: 2 })
    && J(lo) === J({ flame: 60, column: 5 }) && J(sunk) === '{}', { hi, lo, sunk });
  // the burn point: a tank's engine deck (its engine's x, the top of the hull it sits in), an old car's knocked-out cab's top
  const eng = v.parts.find((p) => p.def.module === 'engine'), hull = v.byId.get(eng.att), P = Death._g.burnPoint(v), E = v.toWorld(eng.x, hull.y + hull.def.h / 2, partZc(eng));
  const bug = gnd('buggy'), cab = bug.parts.find((p) => p.type === 'cab'); cab.ko = true;
  const B = Death._g.burnPoint(bug), C = bug.toWorld(cab.x, cab.y + cab.def.h / 2, partZc(cab));
  t('C6 ...burning from a tank\'s engine deck (the engine\'s place, on top of the hull it sits in) and an old car\'s knocked-out cab', near(P.x, E.x, 1e-9) && near(P.y, E.y, 1e-9) && near(P.z, E.z, 1e-9) && near(B.x, C.x, 1e-9) && near(B.y, C.y, 1e-9) && near(B.z, C.z, 1e-9));
  // five knocked-out hulks along a line from the camera, 0.5 to 4.5 km: the three nearest burn, none further
  const me = gnd('tk34'), cam = { x: me.x, y: me.y, z: me.z }, five = [];
  for (const d of [4500, 900, 2500, 300, 1700]) { const o = gnd('tk34'); o.z += d; o.ko = { why: 'crew', x: false, t: 0 }; o.wreck = true; o._d = d; five.push(o); }
  const W = fsim(me, { time: 5, camAbs: cam, absPos: (o) => ({ x: o.x, y: o.y, z: o.z }), dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) });
  W.vessels.push(...five);
  const who = () => { const s = new Set(); for (const [k, p] of log) if (k === 'flame') { let best = null, bd = Infinity; for (const o of five) { const d = Math.hypot(p.x - o.x, p.y - o.y, p.z - o.z); if (d < bd) { bd = d; best = o; } } s.add(best._d); } return [...s].sort((a, b) => a - b); };
  log = []; Death._g.groundTick(W, 0.07, 7); const near3 = who();
  W.warpIdx = 3; log = []; Death._g.groundTick(W, 0.07, 7); const warp = log.length; W.warpIdx = 1;
  t('C6 ...of five knocked-out hulks 0.3-4.5 km from the camera, only the three nearest burn (none past 4 km); none above 4× warp', J(near3) === J([300, 900, 1700]) && warp === 0, { near3, warp });
  const f0 = Death.partFX(five[1], five[1].parts[0], 0.1, 3), live = gnd('buggy'), f1 = Death.partFX(live, live.parts[0], 0.1, 3);
  t('C6 ...a knocked-out hulk\'s parts give none of the old generic smoke (Death.partFX takes them); a live car\'s still do', f0 === true && f1 === false);
  FX.flame = fl; FX.smoke = sm;
}
// C8 (Phase 2's merge) what a hit knocks off a ground vehicle is junk, as an aircraft's cold pieces are: it lies 90 s
// once still, then sinks away over 6 s. A buggy's wheel shot off (combat.js's old body), a StuQ's skirt torn off in a
// blast's window (the ground update's kit, together at the window's end: flushRips) and outside one. A crash's dent
// knocking a wheel off, and Hollywood, leave the piece lying as ever (a drive without hits is unchanged)
{
  const pieceOf = (F, v) => F.vessels.find((o) => o !== v && !o.dead);
  const wheelOff = (cause, holly) => {
    const v = gnd('buggy'), F = fsim(v), w = v.parts.find((p) => p.def.wheel);
    Combat.reset(F); goG(F, 0.5);
    SILLY.hollywood = !!holly;
    try { Combat.damage(v, w, dmgTo(w, 1.2), cause, F); } finally { SILLY.hollywood = false; }
    return { v, F, t: F.time, q: pieceOf(F, v), gone: !v.parts.includes(w) };
  };
  const shot = wheelOff('shot'), dent = wheelOff('impact'), holly = wheelOff('shot', true);
  // the shot-off wheel's life: at rest on the runway, 90 s on it sinks, 6 s later it is gone
  let rest = null, sink = null, gone = null;
  if (shot.q) {
    const { F, q } = shot;
    goG(F, 20, () => (q.restAt != null ? false : undefined));
    rest = q.restAt;
    if (rest != null) {
      F.time = rest + 90.05; goG(F, 0.1); sink = q.sinkAt != null ? q.sinkAt - rest : null;
      F.time += 6; goG(F, 0.1); gone = !F.vessels.includes(q) && !!q.dead;
    }
  }
  t(`C8 a buggy's wheel shot off: the piece is junk (tagged at once), still on the runway, sinking 90 s on (${sink != null ? sink.toFixed(1) : '-'} s), gone 6 s later`,
    shot.gone && !!shot.q && near(shot.q.junkAt, shot.t, 1e-9) && shot.q.hulk == null && rest != null && sink != null && sink >= 90 && sink < 90.3 && gone === true, { junk: shot.q && shot.q.junkAt, t: shot.t, rest, sink, gone });
  t('C8 ...knocked off by a crash\'s dent (cause impact), or in Hollywood: it lies as ever (no junk)', dent.gone && !!dent.q && dent.q.junkAt == null && holly.gone && !!holly.q && holly.q.junkAt == null, [dent.gone, dent.q && dent.q.junkAt, holly.gone, holly.q && holly.q.junkAt]);
  const skirt = (win) => {
    const v = gnd('stuq3'), F = fsim(v), s = v.parts.find((p) => p.type === 'skirts');
    if (win) Combat.holdRips();
    try { Combat.damage(v, s, 1e6, 'blast', F); } finally { if (win) Combat.flushRips(); }
    const q = F.vessels.find((o) => o !== v && o.parts.includes(s));
    return { torn: !v.parts.includes(s), junk: q ? q.junkAt : undefined, rips: F.nRip };
  };
  const inWin = skirt(true), alone = skirt(false);
  t('C8 ...a StuQ\'s skirt torn off by a blast (in the blast\'s window, at its end, and alone): junk too', inWin.torn && inWin.junk === 0 && inWin.rips === 1 && alone.torn && alone.junk === 0, { inWin, alone });
}

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

// ================================================================ F. the HUD and the end of a life
// What the player sees (spec §6): the air HUD's banners (one at a time, a lower one never over a higher one still
// showing; a kill chimes once) and the tick, drawn round the gun cross (a canvas that records its calls; nothing at all
// drawn with nothing to show); a hit window's losses said in one toast; the alert line's order (breaking > a fire >
// the old warnings > a leak) and the damage row; the strip's words; the end screen waiting for the fall (afterFall,
// with a clock of its own: 1.2 s after the crash, at most 10 s after the death; a tap at once).
{
  const SND = ctx.Sound;
  let chimes = 0;
  ctx.Sound = new Proxy({}, { get: (_, k) => (k === 'chime' ? () => { chimes++; } : () => {}) });
  // F1 the banners' order and the chime
  {
    const F = fsim(air('falcon'));
    F.time = 10; Death.reset(F); chimes = 0;
    const fb = Death.fb, seq = [];
    Death.feedback('ENGINE OUT', F); Death.hit(F); seq.push(fb.text, fb.tick); // (HIT only when no banner is up; the tick always)
    F.time = 10.5; Death.feedback('ON FIRE', F); seq.push(fb.text);
    Death.feedback('ENGINE OUT', F); seq.push(fb.text);
    F.time = 11; Death.feedback('PILOT KO', F); Death.feedback('WING OFF', F); seq.push(fb.text);
    F.time = 13.3; Death.feedback('ON FIRE', F); seq.push(fb.text); // (PILOT KO's 2.2 s are over)
    F.time = 15; Death.hit(F); seq.push(fb.text);
    const c0 = chimes;
    F.time = 20; Death.feedback('SHOT DOWN', F); Death.feedback('SHOT DOWN', F); F.time = 21; Death.feedback('KNOCKED OUT', F);
    const c1 = chimes;
    F.time = 30; F.groundAim = true; Death.feedback('SHOT DOWN', F); F.groundAim = false;
    t('F1 banners: HIT never over a banner (the tick still), a higher one over a lower, a lower one never over a higher one still showing, after its time anything; each kill chimes once (not again while its banner shows, not in a ground vehicle\'s sight)',
      seq.join() === 'ENGINE OUT,10,ON FIRE,ON FIRE,PILOT KO,ON FIRE,HIT' && c0 === 0 && c1 === 2 && chimes === 2, { seq, c0, c1, chimes });
  }
  // F2 who gets which: an engine of a bandit's (one of two) killed by us: ENGINE OUT (ON FIRE if it lit); a ground AI's
  // car knocked out by us: KNOCKED OUT; a stranger's hit: nothing
  {
    const P = air('falcon'), B = air('fs22'), F = fsim(P);
    F.vessels.push(B); B.ai = { t: 0, down: false }; B.z = 300; F.time = 5; Death.reset(F);
    const e = B.parts.filter((p) => p.def.thrust)[0];
    Combat.damage(B, e, dmgTo(e, 1.2), 'shot', F, P);
    const eng = Death.fb.text, lit = e.burn > 0;
    const C = gnd('buggy'), CF = fsim(P);
    CF.vessels.push(C); C.ai = { ground: true, t: 0 }; CF.time = 50; Death.reset(CF);
    Combat.damage(C, C.control, dmgTo(C.control, 1.05), 'shot', CF, P);
    const car = Death.fb.text;
    const Q = air('fs22'), QF = fsim(P); QF.vessels.push(Q); Q.ai = { t: 0 }; Q.z = 300; QF.time = 90; Death.reset(QF);
    const qe = Q.parts.filter((p) => p.def.thrust)[0];
    Combat.damage(Q, qe, dmgTo(qe, 1.2), 'shot', QF, P0());
    t(`F2 a bandit's engine (one of two) shot dead by us: ${eng}; an AI car knocked out by us: ${car}; a stranger's hit on a bandit: no banner`,
      eng === (lit ? 'ON FIRE' : 'ENGINE OUT') && !B.ai.down && car === 'KNOCKED OUT' && C.ko && !Death.fb.text, { eng, lit, car, other: Death.fb.text });
  }
  // F3 drawn round the gun cross: a canvas recording what it is asked to draw (Render3D.project stood in: the cross at AX, AY)
  {
    const R0 = ctx.Render3D;
    let AX = 400, AY = 300, BEH = false;
    ctx.Render3D = { project: () => ({ x: AX, y: AY, behind: BEH }) };
    const draw = (F, W = 800, H = 600) => {
      const calls = [], st = {};
      const c = new Proxy(st, { get: (o, k) => (k in o ? o[k] : (...a) => { calls.push([k, ...a]); return k === 'measureText' ? { width: 9 * String(a[0]).length } : undefined; }),
        set: (o, k, x) => { o[k] = x; calls.push(['=' + String(k), x]); return true; } });
      Death.drawHits(c, W, H, 1, F);
      const txt = calls.filter((q) => q[0] === 'fillText').map((q) => ({ s: q[1], x: q[2], y: q[3] }));
      return { n: calls.length, ticks: calls.filter((q) => q[0] === 'moveTo').length, txt, alpha: st.globalAlpha, font: st.font, col: st.strokeStyle };
    };
    const P = air('falcon'), F = fsim(P);
    F.time = 40; Death.reset(F);
    const idle = draw(F);
    Death.hit(F); F.time = 40.05;
    const a = draw(F); F.time = 40.3; const b = draw(F); F.time = 40.7; const c = draw(F);
    Death.feedback('SHOT DOWN', F); F.time = 40.75;
    const d = draw(F);
    AY = 100; const e = draw(F); AY = 300;
    BEH = true; const f = draw(F); BEH = false;
    AX = 4; const g = draw(F); AX = 400;
    F.time = 40.7 + 2.2 - 0.1; const h = draw(F);
    F.time = 40.75; F.groundAim = true; const gi = draw(F); F.groundAim = false; F.destroyed = true; const de = draw(F); F.destroyed = false;
    // (Phase 2 review P2-HUD-2) a 360x640 phone's top panels (the flight data, the buttons at the top right): the cross
    // beside or under them, where the banner above and below both meet one, puts it beside them, clear (it was drawn over
    // them: 49 cross places on this screen); the cross in the open, where it always was
    const D0 = ctx.document, PAN = [[11, 9, 173, 208], [243, 9, 349, 40]];
    ctx.document = { querySelector: (q) => { const r = { '#flight-ui .telemetry': PAN[0], '#flight-ui .flight-top-right': PAN[1] }[q]; return r ? { hidden: false, getBoundingClientRect: () => ({ left: r[0], top: r[1], right: r[2], bottom: r[3], width: r[2] - r[0], height: r[3] - r[1] }) } : null; } };
    const over = (r, big) => r.txt.some((q) => { const ww = 9 * q.s.length, f = big ? 20 : 15; return PAN.some((p) => q.x - ww / 2 < p[2] && q.x + ww / 2 > p[0] && q.y - f < p[3] && q.y + 4 > p[1]); });
    const ph = [];
    for (const [x, y, s] of [[210, 114, 'SHOT DOWN'], [190, 70, 'SHOT DOWN'], [200, 220, 'ENGINE OUT'], [230, 64, 'HIT']]) { Death.feedback(s, F); F.time += 0.01; AX = x; AY = y; const r = draw(F, 360, 640); ph.push({ x, y, s, txt: r.txt, over: over(r, s === 'SHOT DOWN') }); F.time += 3; }
    Death.feedback('SHOT DOWN', F); F.time += 0.01; AX = 180; AY = 400; const open = draw(F, 360, 640); F.time += 3;
    ctx.document = D0; if (D0 === undefined) delete ctx.document; AX = 400; AY = 300;
    ctx.Render3D = R0;
    t('F3 ...the cross beside or under a phone\'s top panels: the banner drawn beside them, over none; the cross in the open: 74 px over it, as ever',
      ph.every((q) => q.txt.length === 1 && !q.over) && open.txt.length === 1 && open.txt[0].x === 180 && open.txt[0].y === 326, { ph: ph.map((q) => [q.x, q.y, q.s, q.txt[0], q.over]), open: open.txt });
    const at = (r, s, x, y) => r.txt.length === 1 && r.txt[0].s === s && near(r.txt[0].x, x, 1e-6) && near(r.txt[0].y, y, 1e-6);
    const w = 9 * 'SHOT DOWN'.length;
    t('F3 the hit marker: nothing at all drawn with nothing to show; the tick (4 diagonals) for 0.15 s, HIT 48 px over the cross for 0.6 s; SHOT DOWN in the bigger font 74 px over',
      idle.n === 0 && a.ticks === 4 && at(a, 'HIT', 400, 252) && b.ticks === 0 && at(b, 'HIT', 400, 252) && c.n === 0 && at(d, 'SHOT DOWN', 400, 226) && /20px/.test(d.font), { idle: idle.n, a, b: b.ticks, c: c.n, d });
    t('F3 ...below the cross where it would meet the top of the screen (+64 px for a kill); the middle of the screen when the cross is behind the camera; kept 8 px inside the side; fading in its last third of a second; not in a ground vehicle\'s sight, not once destroyed',
      at(e, 'SHOT DOWN', 400, 184) && at(f, 'SHOT DOWN', 400, 270 - 74) && at(g, 'SHOT DOWN', 8 + w / 2, 226) && near(h.alpha, 0.3, 1e-9) && gi.n === 0 && de.n === 0, { e: e.txt, f: f.txt, g: g.txt, alpha: h.alpha, gi: gi.n, de: de.n });
  }
  // F4 a hit window's losses in one toast: a big burst on the player's FS-16 (a missile's: a blast, a hit window) takes
  // several parts; the toasts each loss would have been come as one, with one bang. A lone direct hit says it at once
  {
    const v = air('fs16'), F = fsim(v), B = air('falcon');
    B.ai = { t: 0 }; F.time = 3; Death.reset(F);
    let held = 0;
    const l0 = Death.lose;
    Death.lose = function (...a) { const r = l0.apply(this, a); if (r) held++; return r; };
    const w = v.mainWing, at = v.toWorld(w.x, w.y + 1, 2.5);
    Combat._t.explode(EARTH, at, 9, 2600, B, F);
    Death.lose = l0;
    const burst = F.log.slice(), lost = !!Death.S.lost;
    const u = air('fs16'), UF = fsim(u), ue = u.parts.find((p) => p.def.thrust);
    Combat.damage(u, ue, dmgTo(ue, 1.2), 'shot', UF, B);
    // a lone hit taking the 60 % mark: its own words, as ever
    const w2 = air('fs16'), WF = fsim(w2), wp = w2.mainWing;
    Combat.damage(w2, wp, dmgTo(wp, 0.5), 'shot', WF, B);
    t(`F4 a burst taking several parts of the player's craft: ${held} losses, one toast ("${burst[0]}"); a lone hit killing the only engine (out, maybe burning, all engines out): one toast ("${UF.log.join('" "')}"); a lone hit's single loss in its own words`,
      held >= 3 && burst.length === 1 && / shot off!/.test(burst[0]) && !lost && !Death.S.hold && UF.log.length === 1 && UF.log[0] === 'All engines out!' && WF.log.join() === `${wp.def.name} damaged`, { held, burst, lone: UF.log, w: WF.log });
    const L = Death._t.lostText, it = (name, k) => ({ name, k, text: `${name}!` });
    const t1 = L([it('Wing', 'off')]), t2 = L([it('Wing', 'off'), it('Fin', 'off'), it('Pod', 'off'), it('Tank', 'off')]);
    const t3 = L([it('Jet', 'out'), it('All engines', 'out'), it('Jet', 'fire'), it('Tank', 'off'), it('Tank', 'fire')]), t4 = L([it('Jet', 'bad'), it('Nose', 'dmg')]), t5 = L([it('Jet', 'bad'), it('Nose', 'bad')]);
    t('F4 ...the merged words: one loss its own; "a, b and 2 more shot off!"; all engines out over each engine; a fire on an engine out named, none for a part shot off; damage alone, "damaged"',
      t1 === 'Wing!' && t2 === 'Wing, Fin and 2 more shot off!' && t3 === 'Tank shot off! All engines out! Jet on fire!' && t4 === 'Jet and Nose damaged' && t5 === 'Jet and Nose badly damaged', [t1, t2, t3, t4, t5]);
    // (Phase 2 review P2-AIR-R1) a fire is told by the part that burns, not its name: one on a part shot off in the window
    // is not told, one on a part of the same name still aboard is
    const J1 = { id: 1 }, J2 = { id: 2 }, cv = { parts: [J2] }, pf = (p, k) => ({ name: 'Jet', k, text: 'Jet!', p, v: cv });
    const t6 = L([pf(J1, 'off'), pf(J1, 'fire')]), t7 = L([pf(J1, 'off'), pf(J2, 'fire')]);
    t('F4 ...a fire on the part shot off is not told; a fire on its namesake still aboard is', t6 === 'Jet shot off!' && t7 === 'Jet shot off! Jet on fire!', [t6, t7]);
    // a lone killing shot on every plane template's first engine: every engine it lights is told "on fire" (toasts =
    // fires lit), and none is told "fire out" without having been told it was on fire. Before, all 16 lit were silent
    let lit = 0, told = 0, outs = 0, silent = [];
    for (const key of PLANES) {
      const q = air(key), QF = fsim(q), qe = q.parts.find((p) => p.def.thrust);
      if (!qe) continue;
      Combat.damage(q, qe, dmgTo(qe, 1.05), 'shot', QF, B);
      if (!(qe.burn > 0)) continue;
      lit++;
      for (let i = 0; i < 400 && qe.burn > 0; i++) { QF.time += 0.07; Death.tick(QF, 0.07, i + 1); }
      const said = QF.log.join(' | ');
      if (said.includes(`${qe.def.name} on fire!`)) told++; else silent.push(key + ': ' + said);
      if (/fire out/.test(said)) outs++;
    }
    t(`F4 ...a lone shot killing the first engine of each plane: the ${lit} it lit are each told "on fire" (${told}), before any "fire out" (${outs})`, lit >= 10 && told === lit && outs <= told, silent);
  }
  // F5 the HUD's alert line and damage row (Flight.updateHUD over a stand-in page: elements that remember what they're set to)
  {
    const els = new Map();
    const mk = (id) => {
      if (els.has(id)) return els.get(id);
      const cls = new Set(), o = { id, hidden: false, textContent: '', style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
        classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); }, has: (c) => cls.has(c) } };
      const e = new Proxy(o, { get: (x, k) => (k in x ? x[k] : () => {}) });
      els.set(id, e);
      return e;
    };
    ctx.$ = (q) => mk(q.replace(/^#/, '')); ctx.document = { getElementById: (id) => mk(id), querySelectorAll: () => [], querySelector: (q) => mk(q) };
    ctx.UI = { modalOpen: false, toast() {}, modal() {} };
    const hud = (v, set) => {
      const F = Object.create(ctx.Flight);
      if (v.nz == null) v.nz = 7.5; // (a craft never stepped: the over-g line's figure)
      Object.assign(F, { time: 30, vessels: [v], active: v, running: true, destroyed: false, mp: null, prediction: null, target: null, _bodyGround: false, spectate: null, structAlert: () => null, stats: { maxAlt: 0, maxSpeed: 0, maxG: 0 }, flags: {}, hint: () => '' }, set || {});
      F.updateHUD(true);
      const al = mk('flight-alert');
      return { al: al.hidden ? '' : al.textContent, crit: al.classList.has('critical'), lost: al.classList.has('lost'), dmg: mk('row-dmg').hidden ? '' : mk('t-dmg').textContent, danger: mk('row-dmg').classList.has('danger') };
    };
    let asked = 0;
    const b0 = Death.burning, k0 = Death.leaking;
    Death.burning = (...a) => { asked++; return b0(...a); }; Death.leaking = (...a) => { asked++; return k0(...a); };
    const old = hud(air('falcon'));
    Death.burning = b0; Death.leaking = k0;
    const hurtE = () => { const v = air('falcon'), e = v.parts.find((p) => p.def.thrust); e.hp = 0.25 * Combat.maxHp(e.def); return { v, e }; };
    const a = hurtE(); a.e.burn = 5;
    const fire = hud(a.v), brk = hud(a.v, { structAlert: () => ({ kind: 'g', level: 2 }) }), lvl1 = hud(a.v, { structAlert: () => ({ kind: 'g', level: 1 }) });
    const q = air('falcon'), tank = q.parts.find((p) => p.fuel > 50 && !p.def.thrust);
    tank.hp = 0.4 * Combat.maxHp(tank.def);
    const leak = hud(q), leak1 = hud(q, { structAlert: () => ({ kind: 'g', level: 1 }) });
    tank.burn = 4; const ffire = hud(q);
    const c = air('falcon'); c.hulk = 2; c.hulkWhy = 'wing'; c.parts[1].hp = 0.5 * Combat.maxHp(c.parts[1].def);
    const crip = hud(c);
    const d = air('falcon'); d.hulk = 2; d.down = true; d.hulkWhy = 'pilot'; const pko = hud(d);
    d.hulkWhy = 'lift'; const sd = hud(d);
    const g = gnd('buggy'); g.ko = { why: 'crew', x: false, t: 0 }; const ko = hud(g);
    t('F5 an old flight without hits: no alert, no damage row, and nothing asked of the damage model (no fire, no leak looked for)', !old.al && !old.dmg && asked === 0, { old, asked });
    t('F5 the alert line\'s order: breaking (over-g at level 2) over an engine fire, the fire over a level-1 warning, a level-1 warning over a leak; a fuel fire says dive; a leak alone, amber',
      brk.al.startsWith('Over-g') && brk.crit && fire.al === 'Engine fire · throttle back or dive' && fire.crit && lvl1.al === fire.al && leak1.al.startsWith('Over-g') && !leak1.crit
      && leak.al === 'Fuel leak' && !leak.crit && ffire.al === 'Fire · dive to put it out' && ffire.crit, { brk, fire, lvl1, leak, leak1, ffire });
    t('F5 the damage row: on fire, crippled, the pilot knocked out, shot down, knocked out (a ground vehicle), each in red',
      /^On fire · \d+%$/.test(fire.dmg) && fire.danger && /^Crippled · \d+%$/.test(crip.dmg) && crip.danger && pko.dmg === 'Pilot KO' && sd.dmg === 'Shot down' && ko.dmg === 'Knocked out' && ko.danger, { fire: fire.dmg, crip: crip.dmg, pko: pko.dmg, sd: sd.dmg, ko: ko.dmg });
    // the strip once lost: what happened and how to go on, while the end screen waits; not under a dialog, nor while
    // watching someone else; gone once the end screen came
    const s = air('falcon'); s.down = true; s.hulk = 1; s.hulkWhy = 'pilot';
    const strip = (set) => { const r = hud(s, Object.assign({ destroyed: true, endPending: true, deathText: 'Pilot knocked out · by Bea', diedAt: 29 }, set)); return r; };
    const on = strip(), modal = (ctx.UI.modalOpen = true, strip()), spec = (ctx.UI.modalOpen = false, strip({ spectate: {} })), done = strip({ endPending: false });
    t('F5 the strip: "Pilot knocked out · by Bea · Esc for options" (lost, not flashing) while the end screen waits; hidden under a dialog, while spectating, and once the end screen came',
      on.al === 'Pilot knocked out · by Bea · Esc for options' && on.lost && !on.crit && !modal.al && !spec.al && !done.al, { on, modal: modal.al, spec: spec.al, done: done.al });
    delete ctx.$; delete ctx.document; delete ctx.UI;
  }
  // F6 the strip's words (Flight.deathLine)
  {
    const L = (v, set) => { const F = Object.create(ctx.Flight); Object.assign(F, { time: 50, crashedAt: null }, set || {}); return F.deathLine(v); };
    const B = { name: 'Bandit' }, long = { name: 'A name far too long to fit on any strip at all' };
    const pk = air('falcon'); pk.hulkWhy = 'pilot'; pk.down = true; pk.lastHitBy = B; pk.lastHitAt = 45;
    const lf = air('falcon'); lf.hulkWhy = 'lift'; lf.down = true; lf.doomBy = long;
    const cr = air('falcon'); cr.dead = true;
    const cd = air('falcon'); cd.hulk = 10; cd.hulkWhy = 'wing'; cd.doomBy = B; cd.lastHitAt = 0;
    const old = air('falcon'); old.lastHitBy = B; old.lastHitAt = 10;
    const dr = air('falcon'); dr.kind = 'drone'; dr.down = true; dr.hulkWhy = 'pilot';
    const ta = gnd('tk34'), tk = gnd('tk34'), bg = gnd('buggy');
    ta.kind = tk.kind = 'tank'; ta.ko = { why: 'ammo', x: true, t: 0 }; tk.ko = { why: 'crew', x: false, t: 0 }; tk.lastHitBy = B; tk.lastHitAt = 49; bg.ko = { why: 'hull', x: false, t: 0 };
    const w = [L(pk), L(lf), L(cr, { crashedAt: 49 }), L(cd, { crashedAt: 49 }), L(old, { crashedAt: 49 }), L(dr), L(ta), L(tk), L(bg)];
    t('F6 the strip\'s words: the pilot knocked out (by the last hitter), shot down (its credit, 24 letters), crashed (by itself, a hit 40 s before), shot down (crippled by someone, crashed), a drone lost, an ammo detonation, knocked out (by), wrecked (a crash of its own)',
      w.join('|') === 'Pilot knocked out · by Bandit|Shot down · by A name far too long to f|Crashed|Shot down · by Bandit|Crashed|Drone lost|Ammo detonation|Knocked out · by Bandit|Wrecked', w);
  }
  // F7 the end screen waits for the fall (Flight.afterFall, endAfter, endNow over a stand-in with a clock of its own: a
  // timer is due when the sim's time reaches it; the real onDestroyed's lines, its page stubbed)
  {
    const Q = { now: 0, q: [], id: 0 };
    ctx.setTimeout = (fn, ms) => { const id = ++Q.id; Q.q.push({ id, fn, at: Q.now + (ms || 0) / 1000 }); return id; };
    ctx.clearTimeout = (id) => { Q.q = Q.q.filter((x) => x.id !== id); };
    const due = () => { for (;;) { Q.q.sort((a, b) => a.at - b.at); const x = Q.q[0]; if (!x || x.at > Q.now + 1e-9) return; Q.q.shift(); x.fn(); } };
    ctx.UI = { modalOpen: false, toast() {}, modal(o) { ends.push({ t: Q.now, title: o.title }); } };
    let ends = [];
    const stand = (v) => {
      const F = fsim(v);
      Object.assign(F, { setSight() {}, unlockPointer() {}, syncAwake() {}, strip() {}, updateHUD() {}, summaryHTML: () => '', ended: false, spectate: null, _bodyGround: false });
      F.onDestroyed = ctx.Flight.onDestroyed; // (the real one)
      return F;
    };
    // fly the stand-in, its timers on the sim's clock, until the end screen came (or secs)
    const run = (F, secs) => { const dt = 1 / 120; fly(F, secs, () => { Q.now = F.time; due(); return ends.length > 0; }); return ends[0] || null; };
    const end = (key, alt, how) => {
      Q.now = 0; Q.q = []; ends = [];
      const v = cruise(key, alt), F = stand(v);
      Q.now = F.time; how(v, F);
      const e = run(F, 40);
      return { e: e && +(e.t - F.diedAt).toFixed(2), crash: F.crashedAt != null ? +(F.crashedAt - F.diedAt).toFixed(2) : null, after: e && F.crashedAt != null ? +(e.t - F.crashedAt).toFixed(2) : null, dead: v.dead, title: e && e.title, F, v };
    };
    const ko = (v, F) => { v.vx *= 0.4; v.vy *= 0.4; const u = v.radius(); v.vx -= (v.x / u) * 60; v.vy -= (v.y / u) * 60; Combat.damage(v, v.control, dmgTo(v.control, 1.01), 'shot', F); }; // (diving at 60 m/s)
    const low = end('falcon', 300, ko), high = end('falcon', 3000, ko);
    t(`F7 the pilot knocked out 300 m up, diving: the end screen 1.2 s after the crash (${low.after} s; the crash ${low.crash} s after the death), not before`,
      low.dead && low.crash != null && low.crash < 8 && low.after >= 1.2 && low.after <= 1.2 + 0.25 + 0.02 && low.title === 'Vessel destroyed', { e: low.e, crash: low.crash, after: low.after });
    t(`F7 ...3 km up: the end screen at most 10 s after the death (${high.e} s), the hulk still falling`, high.e >= 10 && high.e <= 10.27 && !high.dead && high.crash == null, { e: high.e, crash: high.crash });
    // a tap on the strip (endNow): before the 1.6 s timer, at once; while it waits for the fall, at once
    const tap = (at) => {
      Q.now = 0; Q.q = []; ends = [];
      const v = cruise('falcon', 3000), F = stand(v);
      Q.now = F.time; ko(v, F);
      const d0 = F.diedAt;
      fly(F, at, () => { Q.now = F.time; due(); return ends.length > 0; });
      F.endNow();
      return { t: ends.length ? +(ends[0].t - d0).toFixed(2) : null, n: ends.length, pending: F.endPending, q: Q.q.length };
    };
    const t05 = tap(0.5), t4 = tap(4);
    // a ground vehicle knocked out (no fall): as before, at 1.6 s
    Q.now = 0; Q.q = []; ends = [];
    const g = gnd('buggy'), GF = stand(g);
    GF._bodyGround = true; Q.now = GF.time = 1; Combat.damage(g, g.control, dmgTo(g.control, 1.05), 'shot', GF);
    const gt = run(GF, 5);
    // a timer that comes later (a room's, the Practice Battle's) after a tap: at once when it does; a new flight drops what waits
    Q.now = 0; Q.q = []; ends = [];
    const v3 = cruise('falcon', 3000), F3 = stand(v3); Q.now = F3.time; ko(v3, F3);
    Q.q = []; F3._endGo = null; F3.endNow(); let late = 0;
    F3.afterFall(() => { late++; });
    const v4 = cruise('falcon', 3000), F4 = stand(v4); Q.now = F4.time; ko(v4, F4);
    let never = 0; Q.q = []; F4._endGo = null; F4.afterFall(() => { never++; }); F4.strip = () => {}; F4.endReset(); fly(F4, 12, () => { Q.now = F4.time; due(); });
    t(`F7 a tap on the strip: at once, before the timer (${t05.t} s) and during the fall (${t4.t} s), nothing left waiting; a ground vehicle's end screen at 1.6 s as ever (${gt && +(gt.t - 1).toFixed(2)} s); a later timer after a tap runs at once; a new flight drops what waits`,
      t05.n === 1 && t05.t === 0.5 && t4.n === 1 && t4.t === 4 && !t05.pending && !t4.pending && t05.q === 0 && t4.q === 0 && gt && near(gt.t - 1, 1.6, 0.02) && gt.title === 'Knocked out' && late === 1 && never === 0 && Q.q.length === 0,
      { t05, t4, g: gt, late, never, q: Q.q.length });
    // two timers waiting for one fall (a room's end screen and a spectate pick): neither drops the other; both run once,
    // together, when the fall is over
    Q.now = 0; Q.q = []; ends = [];
    const v5 = cruise('falcon', 300), F5 = stand(v5); Q.now = F5.time; ko(v5, F5);
    Q.q = []; F5._endGo = null;
    const ran = [];
    F5.afterFall(() => ran.push(['a', +(F5.time - F5.diedAt).toFixed(2)])); F5.afterFall(() => ran.push(['b', +(F5.time - F5.diedAt).toFixed(2)]));
    const w0 = ran.length;
    fly(F5, 14, () => { Q.now = F5.time; due(); return ran.length > 1; });
    t(`F7 two timers waiting for one fall: both run once, together, after the crash (${JSON.stringify(ran)})`,
      w0 === 0 && ran.length === 2 && ran[0][0] === 'a' && ran[1][0] === 'b' && ran[0][1] === ran[1][1] && F5.crashedAt != null && ran[0][1] >= F5.crashedAt - F5.diedAt + 1.2 && !(F5.endCbs || []).length && Q.q.length === 0,
      { ran, crash: F5.crashedAt != null ? +(F5.crashedAt - F5.diedAt).toFixed(2) : null });
    delete ctx.setTimeout; delete ctx.clearTimeout; delete ctx.UI;
  }
  ctx.Sound = SND;
}

t.done();
