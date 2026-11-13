'use strict';
// What 0 hp does (the big update's damage model). The hp maths stay combat.js's (maxHp, the blast's fall-off, liftK and
// engineK); this file decides what a part at zero does, and what follows. An aircraft (plane, helicopter, drone) is
// shot apart as in War Thunder: a part at zero is torn off and falls, an engine dies (and may burn), a main wing loses
// one half and the plane spirals, a destroyed cockpit knocks the pilot out and the craft falls limp; only now and then
// does a hit on its fuel or its weapons blow it up in the air. Rockets keep their old rules, and so does everything in
// Hollywood (the secret menu). Ground vehicles (Armour, old cars, the Desert Technical) are knocked out and stay as
// wrecks. combat.js, flight.js, armour.js, groundai.js and mp.js call in here, each behind a gate an old design's
// flight without hits never opens. Rolls that change the simulation use dice(p, salt) (a hash of the part's id: no
// random stream consumed); pictures use FX.rnd.
//
// The file is laid out in fixed sections (each package of the update fills its own): constants and helpers; the air
// rule; fire; crash and lifecycle; ground; the HUD.

// ================================================================ constants and helpers
const DEATH = {
  det: 0.10, detBomb: 0.20, over: 0.5,       // the rare mid-air detonation: odds per hit event per craft; overkill gate (of max hp)
  crippleLift: 0.75, downLift: 0.30,         // shares of the intact craft's clS: crippled below 0.75, down below 0.30
  tailYaw: 0.12, tailW: 3.2,                 // a helicopter without its tail rotor (vessel.js's DEATH_TAIL_YAW, DEATH_TAIL_W: it loads first)
  hulkFar: 12000,                            // m: an airborne hulk is stepped this far from the active craft (NEAR_DIST is 6000)
  restT: 2, restV: 3,                        // s at rest (landed or splashed, under 3 m/s): a hot hulk goes up
  hulkMax: 150,                              // s: any hulk still about after this crashes
  junkRest: 90, junkMax: 40,                 // s a cold piece lies once still before sinking; most junk pieces kept
  endAfter: 1.2, endMax: 10,                 // s: the end screen after the crash; at most this long after death
  doomRest: 3,                               // s at rest on the ground alive: a crippled craft's credit is cleared
  pyres: 6, pyreFire: 30, pyreEnd: 75,       // crash sites: most kept; s of fire; s until gone
  wreckLife: 300, sink: 6, wrecks: 8,        // ground wrecks: s alive, s sinking (the last 6 of the 300), most standing
  burn: { ammo: 40, ko: 20 },                // s a ground wreck burns before it only smokes
  smoke: 120,                                // s a wreck's smoke column lasts; then a thin wisp until it sinks
  settleV: 2, settleT: 6,                    // m/s and s: a KO'd ground hulk on the ground becomes a wreck
  spawnClear: 12,                            // m: a spawn sinks a standing wreck this close
  hitWin: 8,                                 // s: our last hit on a ghost lets its losses show on our HUD
  trail: { space: [7, 14], nmax: [4, 2], near: 3000, far: 8000, full: 4 }, // m between puffs (High, Low); puffs a tick (High, Low); m full rate; m reduced; trails at full rate
};
const FIRE = {
  lit30: { eng: 0.4, fuel: 0.3 },            // odds a hit taking an engine / a fuel part (> 50 kg) from ≥ 30 % to under 30 % lights it
  lit0: { eng: 0.6, fuel: 0.5 },             // odds an engine at 0 hp burns; a fuel part (> 50 kg) torn off burns as it falls
  t0: 8, tSpan: 14,                          // s of fire: 8 + 14·dice (8-22 s, mean 15)
  dps: 0.04,                                 // of the burning part's max hp per second
  idleK: 3, diveK: 3, diveEas: 150,          // the fire's timer runs ×3 on an engine fire at throttle ≤ 0.2, ×3 above 150 m/s EAS (multiplied)
  burnThrough: 0.10,                         // a fuel part (> 500 kg) burnt to 0 hp detonates
};

const Death = (() => {
  // pyres: crash sites {b, x, y, z, t, k, wet} (the crash section); lost: the player's losses merged in a hit window,
  // hold: how many holds are open on it (the HUD's)
  const S = { pyres: [], lost: null, hold: 0 };
  // the air HUD's hit tick and banner (the HUD section draws them)
  const fb = { tick: -9, text: '', col: '', pri: -1, t: -9, life: 0 };
  // a detonation under way (n: its own blasts never roll again), the rolls' event counter for a hit outside any window,
  // and where and how big the craft that went up was (taken before today's body breaks it); crash: a crash's old body
  // under way (Combat.destroyPart for a dent or a burn-up), so the fuel and stores it sets off break every aircraft
  // they reach the old way: a crash is no hit (§3.1)
  const DET = { n: 0, seq: 0, at: null, size: 0, crash: 0 };

  // A number in [0, 1) from a part's id and a salt: the same part and salt, the same number; no random stream consumed.
  // Salts: fire p.fireN (1, 2, …) and 100 + p.fireN; detonation 900 + v.detN; its pieces 960-963; burn-through 950;
  // the half when no side is known 977.
  function dice(p, k) { const x = Math.sin(p.id * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); }
  // (never test p.hp <= 0 alone: null <= 0 is true, and null is a part at full health)
  const alive = (p) => p.hp == null || p.hp > 0;
  // a part kept aboard at 0: a dead engine, a knocked-out cockpit or cab (not the ground update's: armour.js's own rules)
  const partDead = (p) => !p.def.gv && p.hp != null && p.hp <= 0;
  const fuelOf = (v) => { let f = 0; for (const p of v.parts) f += p.fuel || 0; return f; };
  // how big a craft's end looks and sounds (m): full tanks, a Falcon about 6, a Mustang 4.7, the Jumbo 9; a TK-34 3.9
  const airSize = (v) => clamp(1 + 1.3 * Math.cbrt((v.mass || 0) / 1000) + Math.sqrt(fuelOf(v)) / 30, 1.2, 9);
  const groundSize = (v) => clamp(1.2 + 0.9 * Math.cbrt((v.mass || 0) / 1000), 1.5, 6);
  // rounds still on a rack or pod that would go up with it (combat.js's own rule)
  const loaded = (p) => { const wk = p.def.weapon && p.def.weapon.kind; return wk === 'rocket' || wk === 'missile' || wk === 'bomb' ? p.ammo || 0 : 0; };
  const hollywood = () => Silly.on('hollywood');
  const toastMe = (v, sim, text, kind = 'warn') => { if (v === sim.active && !v.ai && sim.toast) sim.toast(text, kind); };

  // The death effect and its sound (FX.death, the graphics package's recipes; Sound.blast): at (body coordinates) the
  // centre of mass unless given, size from the craft (ground kinds: the 'ammo' blast 1.4×, a plain knock-out 0.6×),
  // the sound where the sim can say how far off the camera is, a buzz when it is the player's.
  function deathFX(v, sim, kind, size, at, opt) {
    const P = at || v.toWorld(v.com.x, v.com.y, v.com.z || 0), vel = { x: (v.vx || 0) * 0.2, y: (v.vy || 0) * 0.2, z: (v.vz || 0) * 0.2 };
    const s = size > 0 ? size : isGround(v.kind) ? groundSize(v) * ({ ammo: 1.4, ko: 0.6 }[kind] || 1) : airSize(v);
    const air = airDensity(v.body, Math.hypot(P.x, P.y, P.z) - v.body.radius) > 0.01;
    if (typeof FX.death === 'function') FX.death(v.body, P, vel, s, kind, air, opt);
    if (sim && typeof sim.dist === 'function' && typeof sim.absPos === 'function' && sim.camAbs) Sound.blast(kind === 'ko' ? s * 0.5 : s, sim.dist(sim.absPos(v), sim.camAbs));
    if (v === sim.active && typeof haptic === 'function') haptic([80, 50, 140]);
    return s;
  }
  // The pieces pushed since n0 (a part torn off, a craft broken in two, a detonation's bits): an aircraft's are hulks
  // (they fall and crash, the crash section), anything else's but a rocket's cold junk (it lies, then sinks away).
  function tagPieces(sim, n0, v) {
    if (!sim.vessels) return;
    const t = sim.time || 0;
    for (let i = n0; i < sim.vessels.length; i++) {
      const q = sim.vessels[i];
      if (!q || q === v || q.remote || q.foreign || q.hulk != null || q.junkAt != null) continue;
      if (isAirKind(q.kind)) q.hulk = t; else if (q.kind !== 'rocket') q.junkAt = t;
    }
  }
  // An aircraft's lift if no wing were cut (the clS sum of vessel.js's rebuildGroups, with every half), so a flight
  // restored with a cut wing still measures its losses against the whole craft
  function intactClS(v) {
    const plane = v.kind === 'plane';
    let s = 0;
    for (const p of v.wings) if (!p.def.wing.control) { const W = wingAero(p.def, plane); s += plane && W.vortex ? p.def.wing.area * W.clMax : p.def.wing.area * W.slope * W.stall; }
    return s;
  }
  // What an aircraft had when it was first hit (lazily, at its first damage): its lift, tail surfaces, fins, live
  // engines, main and tail rotors, and whether anyone flew it (a piece of debris has nothing to lose)
  function base(v) {
    v.air0 = { clS: intactClS(v), hs: v.wings.filter((q) => q.def.wing.control).length, vt: v.vtails.length,
      eng: v.parts.filter((q) => q.def.thrust && alive(q)).length, rot: v.rotors.length, tr: v.tailRotors.length, c: !!v.control };
    return v.air0;
  }

  // The hooks more than one section fills (fixed: combat.js and flight.js call these; each section fills only its own
  // part, so the fire, crash and ground sections never share a function).
  // Flight.breakParts' first line for a crash (cause 'impact', the real Flight only): the parts today's per-part
  // breakage still takes, or none (null or []) when the craft went up in one piece. Aircraft: the crash section's;
  // ground vehicles: the ground section's; rockets and everything else: untouched.
  function impact(v, parts, sim) {
    if (isAirKind(v.kind)) return impactAir(v, parts, sim);
    if (isGround(v.kind)) return impactGround(v, parts, sim);
    return parts;
  }
  // Combat.frame's 0.07 s tick (e: the real time since the last; n: the tick's count): the fires (their damage
  // applied after their loop), then falling hulks, rest and age, crash sites and junk, then ground wrecks (settling,
  // their fire and smoke).
  function tick(F, e, n) { fireTick(F, e, n); hulkTick(F, e, n); groundTick(F, e, n); }
  // A part's smoke for Combat.frame's tick (a part at 60 % health or under): true when it was drawn here, so the
  // generic hp smoke leaves it. An aircraft's (the fire section's), a knocked-out ground vehicle's (the ground section's).
  function partFX(o, p, f, n) { return airPartFX(o, p, f, n) || koPartFX(o, p, f, n); }

  // ================================================================ the air rule
  // The gate: an aircraft's old part, shot, blasted or burnt (a crash and burning up keep the old breakage, then meet
  // the crash hook in the real Flight; so do the blasts a crash's dent sets off), outside Hollywood. Rockets, cars and
  // tanks never take it. airHit: the same for the craft (a hit's old body is followed by afterAir; a crash's never).
  function airHit(v, cause) { return isAirKind(v.kind) && cause !== 'impact' && cause !== 'heat' && !DET.crash && !hollywood(); }
  function airRule(v, p, cause) { return airHit(v, cause) && !p.def.gv; }

  // One roll per craft per hit event (an explode, a hit message: Combat.ripWin; a lone shot is its own event, numbered
  // apart from the windows); a detonation's own blasts never roll again.
  function detRoll(v, p, bomb) {
    if (DET.n) return false;
    const win = Combat.ripWin() || -(++DET.seq);
    if (v.detWin === win) return false;
    v.detWin = win; v.detN = (v.detN || 0) + 1;
    return dice(p, 900 + v.detN) < (bomb ? DEATH.detBomb : DEATH.det);
  }
  function detonate(v, p) { DET.at = v.toWorld(p.x, p.y, partZc(p)); DET.size = airSize(v); return 'det'; }
  const deadHp = (p) => { if (!(p.hp <= 0)) p.hp = 0; }; // (called straight, not through damage: still at 0)

  // A part of an aircraft at 0 hp (Combat.destroyPart, after the module line). true: handled; 'det': the rare
  // detonation, so today's body runs (breakParts with the fuel and store blasts) inside DET.n, and then detonated().
  function airPart(v, p, cause, sim, side) {
    const fuel = p.fuel || 0, st = loaded(p), wk = p.def.weapon && p.def.weapon.kind, mh = Combat.maxHp(p.def);
    // 1 the rare mid-air detonation: a big tank or loaded stores overkilled by half its health, on the event's one roll
    if ((fuel > 500 || st > 0) && p.hp != null && -p.hp >= DEATH.over * mh && detRoll(v, p, wk === 'bomb' && st > 0)) return detonate(v, p);
    // 2 a big tank burnt through
    if (cause === 'fire' && fuel > 500 && dice(p, 950) < FIRE.burnThrough) { toastMe(v, sim, 'Fuel tank exploded!'); return detonate(v, p); }
    // 3 the cockpit: the pilot is knocked out, the part stays
    if (p.def.control) {
      p.ko = true; deadHp(p);
      const at = v.toWorld(p.x, p.y, partZc(p)), vel = { x: v.vx, y: v.vy, z: v.vz };
      if (v.kind === 'drone') { FX.sparks(v.body, at, vel, 3); FX.puff(v.body, at, vel, 1, '#8b8f96'); } // (a drone's controller burnt out: a few sparks and a wisp, plan I5)
      else { FX.sparks(v.body, at, vel, 8); FX.puff(v.body, at, vel, 6, '#cfd5dc'); } // (the canopy)
      return true;
    }
    // 4 a main rotor (a helicopter's; a drone's motor): torn off, it falls. ripParts says '<name> shot off!' to the
    // player: a drone's motor by its name, a helicopter's 'Main Rotor shot off!'
    if (p.def.air && p.def.air.kind === 'rotor') { sim.ripParts(v, [p], cause); return true; }
    // 5 an engine (jets, props, fan pods, rocket motors on a plane): dead, aboard (a pair is one part: both pods)
    if (p.def.thrust) {
      p.active = false; p.firing = 0; deadHp(p);
      if (!lose(v, sim, { name: p.def.name, k: 'out', text: `${p.def.name} out!` })) toastMe(v, sim, `${p.def.name} out!`);
      if (v !== sim.active && Combat.byMe(v.lastHitBy, sim)) feedback('ENGINE OUT', sim); // (ours: the banner)
      if (!(p.burn > 0)) ignite(v, p, FIRE.lit0.eng, v.lastHitBy, sim);
      return true;
    }
    // 6 a main wing: one half off (the plane spirals)
    if (p.def.wing && !p.def.wing.control && !p.cut) return cutWing(v, p, side, cause, sim);
    // 7 anything else: torn off, burning as it falls if it holds fuel
    return tearOff(v, p, cause, sim);
  }
  function tearOff(v, p, cause, sim) {
    if ((p.fuel || 0) > 50 && !(p.burn > 0)) ignite(v, p, FIRE.lit0.fuel, v.lastHitBy, sim, 'piece'); // (it burns as it falls: no word of a fire aboard)
    sim.ripParts(v, [p], cause);
    return true;
  }

  // After the detonation's own body ran (breakParts and the fuel and store blasts): its pieces thrown out and
  // tumbling, those holding fuel burning, one fireball, and (ours, in a room) the others see it go.
  function detonated(v, p, sim, n0) {
    const at = DET.at || v.toWorld(p.x, p.y, partZc(p)), size = DET.size || airSize(v);
    DET.at = null; DET.size = 0;
    if (sim.vessels) for (let i = n0; i < sim.vessels.length; i++) {
      const q = sim.vessels[i], k = q && q.parts[0];
      if (!k || q.remote || q.foreign) continue;
      let dx = q.x - at.x, dy = q.y - at.y, dz = q.z - at.z, l = Math.hypot(dx, dy, dz);
      const th = dice(k, 962) * TAU, cz = 2 * dice(k, 963) - 1, sz = Math.sqrt(1 - cz * cz);
      if (!(l > 1e-6)) { dx = sz * Math.cos(th); dy = sz * Math.sin(th); dz = cz; l = 1; }
      const sp = (8 + 7 * dice(k, 960)) / l, w = 1 + 2 * dice(k, 961);
      q.vx += dx * sp; q.vy += dy * sp; q.vz += dz * sp;
      q.av.x += sz * Math.sin(th) * w; q.av.y += cz * w; q.av.z += sz * Math.cos(th) * w; // (an axis of its own)
      const f = q.parts.find((x) => (x.fuel || 0) > 50);
      if (f) ignite(q, f, FIRE.lit0.fuel, v.lastHitBy, sim);
    }
    deathFX(v, sim, 'air', size, at);
    if (typeof MP !== 'undefined' && MP.shared && !v.remote && !v.ai && !v.foreign) MP.sendBoom(v.body, at, 5 * size);
    afterAir(v, sim, n0);
  }

  // Half a main wing off (p.cut: 1, its +z half gone; -1, its -z half). side: the half the hit was on (explode,
  // moveShot, a hit message), else the dice. The overkill carries over to the half that is left: past it, the whole
  // wing goes. What hangs on that half alone (one copy out on that side, with what hangs on it) goes with it; twin
  // pairs and old designs' parts (no att) stay with the plane.
  function cutWing(v, p, side, cause, sim) {
    const s = side === 1 || side === -1 ? side : dice(p, 977) < 0.5 ? 1 : -1, mh = Combat.maxHp(p.def);
    p.hp = 0.5 * mh + Math.min(0, p.hp == null ? 0 : p.hp);
    if (p.hp <= 0) return tearOff(v, p, cause, sim);
    const branches = [];
    for (const c of v.parts) {
      if (c.att !== p.id || partZs(c).length !== 1 || partZc(c) * s <= 0.05) continue;
      const br = [c, ...attachedTo(v.parts, [c])];
      if (!br.some((q) => q.def.control)) branches.push(br);
    }
    const at = v.toWorld(p.x, p.y, partZc(p)), vel = { x: v.vx, y: v.vy, z: v.vz }, f = p.fuel || 0;
    const q = makePart(p.type, p.x, p.y, { flip: p.flip, rot: p.rot, z: p.z, skin: p.skin });
    q.cut = -s; q.hp = 1; q.fuel = f / 2; q.temp = p.temp;
    if (p.fuel != null) p.fuel = f / 2;
    v.parts.push(q); v.adj.set(q.id, new Set());
    for (const br of branches) { // (cut from the rest as Flight.ripParts cuts, then hung on the falling half)
      const go = new Set(br.map((x) => x.id));
      for (const id of go) for (const n of [...(v.adj.get(id) || [])]) if (!go.has(n)) { v.adj.get(id).delete(n); if (v.adj.get(n)) v.adj.get(n).delete(id); }
      const root = br[0];
      v.adj.get(root.id).add(q.id); v.adj.get(q.id).add(root.id);
      root.att = q.id;
    }
    p.cut = s;
    FX.sparks(v.body, at, vel, 14); FX.puff(v.body, at, vel, 8, '#cfd5dc');
    if (v === sim.active && !v.ai) {
      const side = s === 1 ? 'Right wing' : 'Left wing';
      if (!lose(v, sim, { name: side, k: 'off', text: `${side} shot off!`, bang: true })) { toastMe(v, sim, `${side} shot off!`); Sound.explode(); if (typeof haptic === 'function') haptic([60, 40, 80]); }
    }
    const pieces = v.splitComponents();
    v.rebuildGroups();
    for (const piece of pieces) {
      piece.isDebris = !piece.control;
      if (sim.vessels) sim.vessels.push(piece);
      if (q.fuel > 50 && piece.parts.includes(q)) ignite(piece, q, FIRE.lit0.fuel, v.lastHitBy, sim);
    }
    return true;
  }

  // Crippled or down? [down, why]: down (destroyed now, limp) when the pilot is out, under 30 % of the lift is left
  // or a helicopter's (a drone's) main rotors are all gone; crippled (the stick stays) with a half wing, every tail
  // surface, every fin, the tail rotor or every engine gone.
  function state(v) {
    const a = v.air0;
    if (!v.control) return [true, 'pilot'];
    if (v.kind === 'heli' || v.kind === 'drone') {
      if (a.rot && !v.rotors.some(alive)) return [true, 'rotor'];
      if (a.tr && !v.tailRotors.length) return [false, 'tailrotor'];
    }
    if (v.kind === 'plane' || v.kind === 'drone') {
      if (a.clS > 0 && v.clS < DEATH.downLift * a.clS) return [true, 'lift'];
      if (a.clS > 0 && v.clS < DEATH.crippleLift * a.clS) return [false, 'wing'];
      const mw = v.mainWing && v.mainWing.def.wing;
      if (a.hs && !v.wings.some((q) => q.def.wing.control) && !(mw && (mw.elevon || (mw.plane && mw.plane.elevon)))) return [false, 'tail'];
      if (a.vt && !v.vtails.length) return [false, 'fin'];
    }
    if (a.eng && !v.parts.some((q) => q.def.thrust && alive(q))) return [false, 'engines'];
    return [false, ''];
  }
  const CRIPPLED = { tail: 'Tail shot off!', fin: 'Fin shot off!', tailrotor: 'Tail rotor shot off!', engines: 'All engines out' }; // (a wing: its half's own toast said so)
  const CRIP_NAME = { tail: ['Tail', 'off'], fin: ['Fin', 'off'], tailrotor: ['Tail rotor', 'off'], engines: ['All engines', 'out'] }; // (the same, merged with a hit window's other losses)
  // After a part of an aircraft went (the air rule, a detonation, a rip at the end of a hit window): is it crippled or
  // down? The credit (doomBy: the hitter within 20 s, once), a helicopter's spin, the player's toast, the limp hulk
  // (no stick, no autopilot, engines off) and the end of its flight, an AI bandit shot down, and our HUD's banner.
  function airCheck(v, sim) {
    if (v.dead || v.remote || v.foreign || !isAirKind(v.kind) || !v.air0 || !v.air0.c) return;
    const [down, why] = state(v);
    if (!why) return;
    const t = sim.time || 0;
    if (v.hulk == null) { v.hulk = t; v.doomBy = v.lastHitBy && t - (v.lastHitAt ?? -99) < 20 ? v.lastHitBy : null; }
    if (why === 'tailrotor') v.tailLost = true;
    const fresh = v.hulkWhy !== why || (down && !v.down);
    if (down && !v.down && v.kind === 'drone' && typeof Drone !== 'undefined' && Drone.die(v, sim, why)) return; // (a drone shot down goes up with its payloads, where it is: drone.js)
    if (v.hulkWhy !== why) { v.hulkWhy = why; if (CRIPPLED[why] && !lose(v, sim, { name: CRIP_NAME[why][0], k: CRIP_NAME[why][1], text: CRIPPLED[why] })) toastMe(v, sim, CRIPPLED[why]); }
    if (down && !v.down) {
      v.down = true; v.isDebris = true; v.throttle = 0;
      for (const q of v.parts) if (q.def.thrust && !q.def.solid) { q.active = false; q.firing = 0; }
      if (v === sim.active && sim.onDestroyed) sim.onDestroyed();
    }
    if (v.ai && !v.ai.ground && !v.ai.down) Combat.aiDown(v, sim); // (a bandit crippled or down is shot down now)
    if (fresh && v !== sim.active && Combat.byMe(v.lastHitBy, sim)) feedback(down ? (why === 'pilot' && v.kind !== 'drone' ? 'PILOT KO' : 'SHOT DOWN') : `${why === 'tailrotor' ? 'ROTOR' : why === 'engines' ? 'ENGINE' : why.toUpperCase()} OFF`, sim);
  }
  // After every air-rule outcome: its pieces tagged, then the check.
  function afterAir(v, sim, n0) { tagPieces(sim, n0, v); airCheck(v, sim); }

  // ================================================================ fire
  // An aircraft's engine or fuel part catches fire: on a hit taking it under 30 % (Combat.damage's line), an engine at
  // 0 hp, a fuel part torn off, a falling half wing or a detonation's piece holding fuel. Only that part burns (no
  // spread), for 8-22 s, losing 4 % of its health a second while it is on a craft someone flies (on a piece, a limp
  // hulk or another player's craft the fire is only a picture), so a part lit at 30 % is gone in 7.5 s: a burning engine
  // dies, a wing loses its half, a fuselage tears off, and a big tank (over 500 kg) burnt through goes up one time in
  // ten (the air rule's #2). War Thunder's two answers put it out sooner: an engine fire's timer runs three times as
  // fast with the throttle back (0.2 or less), any fire's three times as fast again above 150 m/s EAS (a dive); water
  // puts it out at once. A fire leaves black smoke and a flame behind it, a leaking tank a white trail, other damage a
  // grey one (FX: pictures, drawn from FX.rnd); the player hears it crackle. Never on a drone (grams of battery), a
  // rocket, a car or a tank, nor from a crash (a dent, or the blasts a crash's old body sets off: no hit).
  const T = { F: null, e: 0, o: null, od: 0, crack: 0 }; // the tick under way (airPartFX reads it), the last vessel's camera distance, the next crackle (s from now)
  // a fuel part (fuel left) under half its health, not burning: it leaks (the white trail; the fuel it loses is
  // combat.js's arithmetic, as ever)
  const leaking = (p) => p.fuel > 0 && !(p.burn > 0) && p.hp != null && Combat.hpFrac(p) < 0.5;
  // a craft's burning part, an engine first (the HUD's alert: "Engine fire" or "Fire"), else null
  function burning(v) { let f = null; for (const p of v.parts) if (p.burn > 0) { if (p.def.thrust) return p; f = f || p; } return f; }
  // how far a vessel is from the camera (0 when the sim can't say: every trail at full rate)
  const camDist = (F, o) => (typeof F.dist === 'function' && typeof F.absPos === 'function' && F.camAbs ? F.dist(F.absPos(o), F.camAbs) : 0);
  // where a part's smoke comes from: a plain wing's halves in turn (a cut wing's remaining half only), a pair's copies in
  // turn (k: the turn), else its middle
  function partAt(o, p, k) {
    const w = p.def.wing;
    if (w && !w.control) return o.toWorld(p.x, p.y, partZc(p) + (p.cut ? -p.cut : k % 2 ? -1 : 1) * (w.span || 0) / 4);
    const zs = partZs(p);
    return o.toWorld(p.x, p.y, zs[k % zs.length]);
  }

  // Lights part p of v on a roll of dice(p, p.fireN) under odds: true when lit. by: who lit it (else the craft's last
  // hitter). quiet: true, the caller tells the player itself (damage's 30 % line); 'piece', a part on its way off the
  // craft (torn off): no word to anyone. The player's own craft: a toast and a buzz; a craft we lit: the ON FIRE banner.
  function ignite(v, p, odds, by, sim, quiet) {
    if (v.remote || v.foreign || p.burn > 0 || p.def.gv || v.kind === 'drone' || !airHit(v, null)) return false; // (a peer's craft: its owner's fire; a crash lights nothing: airHit)
    p.fireN = (p.fireN || 0) + 1;
    if (!(dice(p, p.fireN) < odds)) return false;
    p.burn = FIRE.t0 + FIRE.tSpan * dice(p, 100 + p.fireN);
    p.burnBy = by || v.lastHitBy || null;
    if (quiet === 'piece') return true;
    if (v === sim.active && !v.ai) {
      const say = `${p.def.name} on fire! ${p.def.thrust ? 'Throttle back or dive' : 'Dive'} to put it out`;
      if (!quiet && !lose(v, sim, { name: p.def.name, k: 'fire', text: say, p, v })) toastMe(v, sim, say);
      if (typeof haptic === 'function') haptic([30]);
    }
    if (v !== sim.active && v.control && !v.isDebris && Combat.byMe(p.burnBy, sim)) feedback('ON FIRE', sim);
    return true;
  }
  // tick()'s first part, for every vessel on the active craft's body (no distance cap): each burning part's timer and
  // damage (applied after the loop: a part may tear off), the fire out; then the trails behind burning and leaking
  // parts, the nearest 4 within 3 km at full rate (a puff every 7 m on High, 14 m on Low), the rest to 8 km at a
  // trickle, none further or above 4× warp; and the crackle while the player's craft burns.
  function fireTick(F, e, n) {
    const v = F.active;
    T.F = F; T.e = e; T.o = null;
    if (!v || !F.vessels) return;
    const hurt = [], trails = [];
    let mine = false;
    for (const o of F.vessels) {
      if (o.dead || o.body !== v.body) continue;
      const air = isAirKind(o.kind);
      for (const p of o.parts) {
        if (p.burn > 0) {
          if (!o.remote) { // (a peer's craft: only the picture, its owner runs the fire and says when it is out)
            if (o.splashed) p.burn = 0;
            else if (o.foreign || !o.control || o.isDebris) p.burn = Math.max(0, p.burn - e); // (a piece, a limp hulk: it burns, it hurts nothing)
            else {
              const k = (p.def.thrust && o.throttle <= 0.2 ? FIRE.idleK : 1) * (Math.sqrt((o.dynP || 0) / 0.6) > FIRE.diveEas ? FIRE.diveK : 1);
              p.burn = Math.max(0, p.burn - e * k);
              if (alive(p)) hurt.push([o, p, FIRE.dps * Combat.maxHp(p.def) * e]);
            }
            if (!(p.burn > 0) && o === v && !F.destroyed) toastMe(o, F, `${p.def.name}: fire out`, 'info');
          }
          if (p.burn > 0) { if (o === v) mine = true; trails.push({ o, p, burn: true, d: 0 }); continue; }
        }
        if (air && leaking(p)) trails.push({ o, p, burn: false, d: 0 });
      }
    }
    // the trails (pictures), before the damage moves any part to a piece of its own
    if (trails.length && !((F.warpIdx || 0) > 2)) {
      const C = DEATH.trail, hi = Settings.high ? 0 : 1;
      for (const t of trails) t.d = camDist(F, t.o);
      trails.sort((a, b) => a.d - b.d);
      let full = 0;
      for (const { o, p, burn, d } of trails) {
        if (d > C.far) break;
        const all = full < C.full && d <= C.near;
        if (all) full++;
        else if (n % 2) continue; // (further off: a puff and a flame every 2nd tick)
        const P = partAt(o, p, all ? n : n >> 1), vel = { x: o.vx || 0, y: o.vy || 0, z: o.vz || 0 };
        FX.trail(o.body, P, vel, burn ? 'black' : 'white', all ? clamp(Math.ceil((o.speed() * e) / C.space[hi]), 1, C.nmax[hi]) : 1, e);
        if (burn) FX.flame(o.body, P, vel, clamp(Math.max(p.def.w || 0, p.def.h || 0) / 2, 0.6, 2));
      }
    }
    for (const [o, p, d] of hurt) Combat.damage(o, p, d, 'fire', F, p.burnBy); // (the fire's damage is the hitter's who lit it)
    // the crackle: a click every 0.15-0.35 s, scheduled into the coming tick's span (at: s from now)
    if (mine) { while (T.crack < e) { Sound.crackle(T.crack); T.crack += 0.15 + 0.2 * FX.rnd(); } T.crack -= e; } else T.crack = 0;
  }
  // partFX()'s air half (Combat.frame's part loop, a part at 60 % or under): an aircraft's damage leaves a grey trail, a
  // puff every 2nd tick within 3 km of the camera, and no fire unless it really burns (black is a fire's, white a
  // leak's: fireTick's trails). true: drawn here (none of the old generic smoke). Hollywood keeps the old smoke.
  function airPartFX(o, p, f, n) {
    void f;
    if (!isAirKind(o.kind) || p.def.gv || hollywood()) return false;
    if (p.burn > 0 || leaking(p) || n % 2) return true;
    const F = T.F;
    if (!F || (F.warpIdx || 0) > 2) return true;
    if (T.o !== o) { T.o = o; T.od = camDist(F, o); } // (a vessel's parts come one after another)
    if (T.od > DEATH.trail.near) return true;
    if (o.kind === 'drone') { FX.smoke(o.body, partAt(o, p, n >> 1), { x: (o.vx || 0) * 0.15, y: (o.vy || 0) * 0.15, z: (o.vz || 0) * 0.15 }, 'grey', clamp(Math.max(p.def.w, p.def.h) / 2, 0.15, 1)); return true; } // (plan I5: a drone's puff as small as its part)
    FX.trail(o.body, partAt(o, p, n >> 1), { x: o.vx || 0, y: o.vy || 0, z: o.vz || 0 }, 'grey', 1, T.e);
    return true;
  }

  // ================================================================ crash and lifecycle
  // A hulk (an aircraft crippled or down, the pieces shot off one, a peer's falling hulk on our screen: v.hulk, the
  // time it became one) falls under the physics and ends in one fireball where it hits (crash), and a big one leaves a
  // crash site burning for 30 s and smoking to 75 s (a pyre). Any aircraft whose cockpit breaks in a crash goes up the
  // same way. A limp hulk (no pilot, or shot down: no stick) lying still for 2 s goes up if anything in it can burn,
  // else it lies as cold junk; one still about after 150 s goes up wherever it is. A crippled craft whose pilot lands
  // it safely (on the ground, still for 3 s) lives: its credit and its crash rule go. Junk (cold pieces at rest, torn-
  // off ground kit) lies 90 s once still, then sinks away over 6 s; past 40 at rest the oldest sinks at once. All of it
  // runs on the sim's clock, for local vessels only (a peer's craft is its owner's), from Death.tick; nothing here is
  // reached by a flight without hits but a crash that breaks a cockpit (one fireball, where today's breakage blew each
  // part up), and the real Flight alone meets that (the suites' stand-in sims keep the old crash).

  // limp: nobody flies it (no pilot, down, or a bandit shot down); hot: something in it burns when it hits
  const limp = (v) => !v.control || !!v.isDebris;
  // (a drone: a live warhead or bombs aboard, else a thud: grams of battery burn nothing; plan I5)
  const hotOf = (v) => (v.kind === 'drone' ? v.parts.some((p) => (p.def.drone && p.def.drone.warhead && p.ammo !== 0) || (p.def.weapon && p.def.weapon.kind === 'bomb' && p.ammo > 0)) : fuelOf(v) > 50 || v.parts.some((p) => p.def.thrust || p.burn > 0));
  // how far a point on body b is from the camera (0 when the sim can't say: the tests' stand-ins)
  const PYR = { body: null, x: 0, y: 0, z: 0 };
  function camOff(F, b, p) {
    if (typeof F.dist !== 'function' || typeof F.absPos !== 'function' || !F.camAbs) return 0;
    PYR.body = b; PYR.x = p.x; PYR.y = p.y; PYR.z = p.z;
    return F.dist(F.absPos(PYR), F.camAbs);
  }

  // impact()'s aircraft branch (Flight.breakParts, cause 'impact': a crash): a hulk hitting anything, or a crippled one
  // (its pilot alive) hitting hard or breaking its cockpit, goes up in one fireball (null: today's breakage takes
  // nothing); so does any aircraft whose cockpit breaks (not in Hollywood: there it blows up part by part, as ever).
  // Gear or a wing tip broken on landing: today's breakage, part by part.
  function impactAir(v, parts, sim) {
    if (v.kind === 'drone' && typeof Drone !== 'undefined' && Drone.die(v, sim, 'crash')) return null; // (a drone that crashes with payloads aboard: they go off, drone.js)
    const ctrl = parts.some((p) => p.def.control);
    if (v.hulk != null && (!v.control || ctrl || v.speed() > 40)) { crash(v, sim); return null; }
    if (ctrl && !hollywood()) { crash(v, sim); return null; }
    return parts;
  }
  // The end of an aircraft (or a piece of one): one fireball where it is, a small 'thud' for a cold piece (no fuel, no
  // engine, nothing burning), in water a splash and steam; a crash site for anything big and hot; gone (v.dead: the
  // flight's cleanup drops it). Only a picture and a sound: it hurts nothing (the old crash never did, and a peer's hulk
  // landing near us must not). A bandit that wasn't yet is shot down now (the kill its last hitter's); the player's own
  // craft is destroyed now (if it wasn't), and the end screen counts from here (crashedAt).
  function crash(v, sim) {
    if (v.dead) return;
    if (v.kind === 'drone' && typeof Drone !== 'undefined' && Drone.die(v, sim, 'crash')) return; // (its payloads go off where it ends: drone.js)
    const c = v.toWorld(v.com.x, v.com.y, v.com.z || 0), hot = hotOf(v), size = airSize(v);
    const L = Terrain.locate(v.body, c.x, c.y, c.z, {}), wet = !!Terrain.waterAt(v.body, L.a, L.z);
    // (review P2-AIR-R3) on what it hit: the point under its centre on the ground (the sea, a deck), when it is within
    // the craft's reach of it (a banked jumbo's centre is 14 m up when a wing tip touches); one too old to fall any
    // longer goes up where it is
    const gr = v.body.radius + Terrain.surfaceAt(v.body, L.a, L.z), up = L.r - gr;
    if (up < (v.reach || 0) + 2) { const f = gr / L.r; c.x *= f; c.y *= f; c.z *= f; }
    deathFX(v, sim, hot ? 'crash' : 'thud', size, c, { water: wet });
    if (hot && size >= 2.5) pyre(v.body, c, size, wet, sim);
    v.dead = true; v.throttle = 0; v.thrust = 0;
    for (const p of v.parts) if (p.def.thrust) { p.active = false; p.firing = 0; } // (no plume, no engine note from what's gone)
    if (v.ai && !v.ai.down) Combat.aiDown(v, sim);
    if (v === sim.active) { sim.crashedAt = sim.time || 0; if (sim.onDestroyed) sim.onDestroyed(); }
  }
  // A crash site at `at` on body b, k across (the crash's size), wet: in water (steam for 10 s, no fire); the newest 6 kept
  function pyre(b, at, k, wet, sim) {
    S.pyres.push({ b, x: at.x, y: at.y, z: at.z, t: sim.time || 0, k, wet: !!wet });
    while (S.pyres.length > DEATH.pyres) S.pyres.shift();
  }

  // tick()'s second part: hulks at rest or too old, a crippled craft landed safely, junk, then the crash sites.
  function hulkTick(F, e, n) {
    const t = F.time || 0;
    let still = null; // (junk at rest, not yet sinking: the cap's)
    if (F.vessels) for (const o of F.vessels) {
      if (o.dead || o.remote || o.wreck) continue; // (a peer's craft is its owner's; a wreck the ground's)
      if (o.hulk != null) hulkLife(o, F, e, t);
      else if (o.junkAt != null && !o.tossed && junkLife(o, t)) (still || (still = [])).push(o);
    }
    if (still && still.length > DEATH.junkMax) { // (too many lying about: the oldest at rest sink now)
      still.sort((a, b) => a.restAt - b.restAt);
      for (let i = 0; i < still.length - DEATH.junkMax; i++) still[i].sinkAt = t;
    }
    pyreTick(F, n, t);
  }
  function hulkLife(o, F, e, t) {
    if (limp(o)) {
      o.restH = (o.landed || o.splashed) && o.speed() < DEATH.restV ? (o.restH || 0) + e : 0;
      if (o.restH >= DEATH.restT) { if (hotOf(o)) crash(o, F); else { o.hulk = null; o.junkAt = t; o.restH = 0; } } // (a cold piece: junk)
      else if (t - o.hulk > DEATH.hulkMax) crash(o, F);
    } else { // crippled, its pilot alive: landed and still for 3 s, it made it (its damage kept)
      o.restH = o.landed && o.speed() < DEATH.settleV ? (o.restH || 0) + e : 0;
      if (o.restH >= DEATH.doomRest) { o.hulk = null; o.doomBy = null; o.restH = 0; }
    }
  }
  // a junk piece's life: still (on the ground or afloat, under 1 m/s) for 90 s, then 6 s sinking (v.sink 0..1, the
  // renderer lowers it), then gone. true: at rest and not yet sinking
  function junkLife(o, t) {
    if (o.sinkAt == null) {
      if ((o.landed || o.splashed) && o.speed() < 1) { if (o.restAt == null) o.restAt = t; } else o.restAt = null;
      if (o.restAt != null && t - o.restAt > DEATH.junkRest) o.sinkAt = t;
    }
    if (o.sinkAt != null) { o.sink = clamp((t - o.sinkAt) / DEATH.sink, 0, 1); if (o.sink >= 1) o.dead = true; return false; }
    return o.restAt != null;
  }
  // The crash sites: gone at 75 s; the 3 nearest within 6 km of the camera (not above 4x warp) burn for 30 s (a flame
  // every 2nd tick, a column puff every 6th, 12th on Low), then smoke (a thinner puff every 20th); one in water steams
  // for 10 s instead.
  const PZ = { x: 0, y: 0, z: 0 }, PF = { x: 0, y: 0, z: 0 };
  function pyreTick(F, n, t) {
    const P = S.pyres;
    for (let i = P.length - 1; i >= 0; i--) if (!(t - P[i].t < DEATH.pyreEnd && t >= P[i].t)) P.splice(i, 1); // (and any from a clock that went back)
    if (!P.length || (F.warpIdx || 0) > 2) return;
    const near = [];
    for (const p of P) { const d = camOff(F, p.b, p); if (d <= 6000) near.push([d, p]); }
    if (near.length > 1) near.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < near.length && i < 3; i++) {
      const p = near[i][1], age = t - p.t, k = p.k;
      if (p.wet) { if (age < 10 && n % 10 === 0) FX.smoke(p.b, p, PZ, 'steam', k / 3); continue; }
      if (age < DEATH.pyreFire) {
        if (n % 2 === 0) { const j = 0.25 * k; PF.x = p.x + (FX.rnd() * 2 - 1) * j; PF.y = p.y + (FX.rnd() * 2 - 1) * j; PF.z = p.z + (FX.rnd() * 2 - 1) * j; FX.flame(p.b, PF, PZ, 0.5 * k); }
        if (n % (Settings.high ? 6 : 12) === 0) FX.smoke(p.b, p, PZ, 'column', k / 3);
      } else if (n % 20 === 0) FX.smoke(p.b, p, PZ, 'column', (0.7 * k) / 3);
    }
  }
  // A new flight (Combat.reset): the last flight's banner and merged losses go, and its crash sites, but for a respawn
  // (a room's, or one keeping vessels: a Practice Battle's), which keeps the field as it was
  function reset(F) {
    const so = F && F.spawnOpts;
    if (!(so && (so.mp || (Array.isArray(so.keep) && so.keep.length)))) S.pyres.length = 0;
    S.lost = null; S.hold = 0;
    fb.tick = -9; fb.text = ''; fb.pri = -1; fb.t = -9; fb.life = 0;
  }

  // ================================================================ ground
  // Ground vehicles (Armour, old cars, the Desert Technical): every way to die is one knock-out, and the hulk stays. A
  // hit, a blast or a fire taking an old car's cab to 0 knocks its driver out (the cab stays aboard; before, it blew up
  // and the rest rolled off as debris); a crash breaking a hull or a cab knocks the vehicle out where it lies (before, it
  // blew apart). The hulk coasts to a stop with its brakes on and becomes a wreck (settle: frozen, solid, charred by the
  // renderer), burns 20 s (40 after an ammunition detonation), then smokes for two minutes, then wisps until it sinks
  // away (the wrecks' lifetimes: GroundAI's and MP's lists). Old cars never reach Gear, Aim, Armour, GroundMode or
  // GroundAI (the ground update's zero-call contract): their knock-out (groundKO) and every wreck's fire and smoke live
  // here. Hollywood keeps the old breakage (cars blow up, ×3).

  // An old control part of a ground vehicle (an old car's cab, the Technical's) at 0 hp from a hit, a blast or a fire
  // (Combat.destroyPart, after the air rule): the driver knocked out, the cab kept aboard at 0 (a crash and burning up
  // keep today's breakage, then meet the crash hook, impactGround). true: handled.
  function groundPart(v, p, cause, sim) {
    if (!isGround(v.kind) || p.def.gv || !p.def.control || cause === 'impact' || cause === 'heat' || hollywood()) return false;
    deadHp(p); p.ko = true;
    if (v.gv && typeof Armour !== 'undefined') Armour.knockOut(v, sim, 'crew'); else groundKO(v, sim, 'crew'); // (the Technical: armour.js's own knock-out, its gun silenced)
    return true;
  }
  // Armour.knockOut's twin for a vehicle with none of the ground update's parts (it never calls into armour.js): the
  // driver knocked out (why 'crew'), or the car wrecked in a crash ('hull'); every control part out of charge, the
  // throttle closed, our HUD's banner when we did it, the player's toast and the end of their drive, the small 'ko'
  // death effect, an AI's knock-out counted.
  function groundKO(v, sim, why) {
    if (v.ko) return;
    const t = sim.time || 0;
    v.ko = { why, x: false, t };
    for (const q of v.parts) if (q.def.control) q.ko = true;
    v.throttle = 0;
    if (v !== sim.active && v.lastHitBy !== v && Combat.byMe(v.lastHitBy, sim)) {
      feedback('KNOCKED OUT', sim);
      if (typeof Armour !== 'undefined' && sim.active.gv) Armour.fb.ko = { text: 'Knocked out!', t }; // (the ground HUD's banner: a property, no call)
    }
    if (v === sim.active && sim.toast) sim.toast(why === 'hull' ? 'Wrecked!' : 'Driver knocked out!', 'warn');
    deathFX(v, sim, 'ko');
    if (v === sim.active && sim.onDestroyed) sim.onDestroyed();
    if (v.ai && !v.ai.down) Combat.aiDown(v, sim);
  }
  // A knocked-out hulk becomes a wreck: frozen where it stands (no longer stepped, solid to everything, charred)
  function settle(v) { v.wreck = true; v.vx = v.vy = v.vz = 0; v.av = v3(0, 0, 0); }
  // A craft spawning in a room on top of a wreck (a respawn on the spot where it was knocked out, a sandbox's start):
  // every standing wreck whose centre is within 12 m of the new craft's (P, body coordinates on body b) starts sinking
  // now, on every screen alike (its owner at its start, the others at its first snapshot: MP.startFlight, poseGhost),
  // so the wrecks stay solid in step. The room's wrecks (MP's list): GroundAI's never stand in a room. The number sunk.
  function clearSpawn(b, P) {
    if (typeof MP === 'undefined' || !MP.wrecks || !MP.wrecks.length || !P) return 0;
    const now = performance.now();
    let n = 0;
    for (const w of MP.wrecks) {
      const o = w.v;
      if (o.dead || o.body !== b || MP.sinkStart(w) <= now) continue; // (gone, elsewhere, or sinking already)
      const c = o.toWorld(o.com.x, o.com.y, o.com.z || 0);
      if (Math.hypot(c.x - P.x, c.y - P.y, c.z - P.z) <= DEATH.spawnClear) { w.sinkAt = now; n++; }
    }
    return n;
  }
  // The pieces a hit knocked off a ground vehicle since n0 (Combat.destroyPart's old body, flushRips' torn-off kit: an
  // old car's wheel, a skirt, a brick, a tank blown off): cold junk, which lies 90 s once still and then sinks away (the
  // crash section's junkLife), as an aircraft's cold pieces do. Not a crash's or a burn-up's pieces, nor the blasts a
  // crash's old body sets off (no hit: debris from a drive without hits lies as ever), nor Hollywood's; a thrown turret
  // is its wreck's (tossed)
  function groundPieces(v, sim, n0, cause) {
    if (isGround(v.kind) && cause !== 'impact' && cause !== 'heat' && !DET.crash && !hollywood()) tagPieces(sim, n0, v);
  }

  // impact()'s ground branch (Flight.breakParts, a crash): a hull, turret, crew seat or cab broken knocks the vehicle
  // out (Armour's own rule for one of the ground update's, groundKO for an old car), keeps the parts aboard at 0 and
  // freezes the hulk at once (the crash returns before the ground pushes back: stepped on, it would sink); whatever else
  // broke goes as ever. A thrown turret landing hard is no vehicle to knock out: it lies where it fell. Hollywood: the
  // old breakage.
  function impactGround(v, parts, sim) {
    if (hollywood() || !parts.some((p) => p.def.control)) return parts;
    if (!v.tossed) { if (v.gv && typeof Armour !== 'undefined') Armour.knockOut(v, sim, 'hull'); else groundKO(v, sim, 'hull'); }
    for (const p of parts) if (p.def.control) p.hp = Math.min(p.hp ?? 0, 0);
    layDown(v); // (review P2-GND-1: one standing on its nose or tail is laid down first)
    settle(v);
    return parts.filter((p) => !p.def.control);
  }

  // A hull broken in a nose- or tail-first crash is frozen at once (stepped on, it would fall through the ground), and
  // so stood 60-90° up, to 10 m tall, for five minutes. One whose forward axis (+x, part space) is more than 30° off the
  // level is laid down first: pitched about its own lateral axis by the least turn that levels it (so onto its tracks
  // if it leaned that way, onto its roof if it leaned that way by more than 15°), then lifted or lowered until its lowest point is on the ground
  // under it (twice, for a slope). Only for a vehicle knocked out in a crash: everything else settles as it lies
  function layDown(v) {
    const r = Math.hypot(v.x, v.y, v.z) || 1, u = { x: v.x / r, y: v.y / r, z: v.z / r };
    const f = qrot(v.q, 1, 0, 0), y = qrot(v.q, 0, 1, 0), k = qrot(v.q, 0, 0, 1);
    const s = f.x * u.x + f.y * u.y + f.z * u.z, yu = y.x * u.x + y.y * u.y + y.z * u.z;
    if (!(Math.abs(s) > 0.5) || !v.hull) return;
    let th = Math.abs(yu) < 1e-9 ? (s > 0 ? -1 : 1) * (Math.PI / 2) : Math.atan(-s / yu);
    if (yu < 0 && yu > -0.26) th += th > 0 ? -Math.PI : Math.PI; // (all but upright on its end: onto its tracks, not its roof)
    v.q = qnorm(qmul(qaxis(k.x, k.y, k.z, th), v.q));
    const cz = v.com.z || 0, loc = {};
    for (let it = 0; it < 2; it++) {
      let worst = -Infinity;
      for (const P of [v.hull, v.wheelPts || []]) for (const p of P) {
        const o = qrot(v.q, p.x - v.com.x, p.y - v.com.y, (p.z || 0) - cz), px = v.x + o.x, py = v.y + o.y, pz = v.z + o.z, pr = Math.hypot(px, py, pz);
        Terrain.locate(v.body, px, py, pz, loc);
        worst = Math.max(worst, v.body.radius + Terrain.surfaceAt(v.body, loc.a, loc.z) - (pr - (p.r || 0)));
      }
      if (!Number.isFinite(worst)) return;
      v.x += u.x * worst; v.y += u.y * worst; v.z += u.z * worst;
    }
  }
  // Where a wreck burns and smokes from: one of the ground update's vehicles at its engine (else its first control part),
  // an old car at its knocked-out cab; the top of the part, or of the hull it sits inside, so the flames rise from the deck
  function burnPoint(o) {
    let p = null;
    if (o.gv) p = o.parts.find((q) => q.def.module === 'engine' || q.def.engine) || o.parts.find((q) => q.def.control);
    else p = o.parts.find((q) => q.def.control && q.ko) || o.parts.find((q) => q.def.control);
    p = p || o.parts[0];
    if (!p) return null;
    let y = p.y + p.def.h / 2;
    const host = p.def.inner && p.att != null && o.byId ? o.byId.get(p.att) : null;
    if (host) y = Math.max(y, host.y + host.def.h / 2);
    return o.toWorld(p.x, y, partZc(p));
  }
  const WZ = Object.freeze({ x: 0, y: 0, z: 0 });
  // A knocked-out vehicle's fire and smoke (one 0.07 s tick, n its count; F for the clock), from its burn point:
  // burning (20 s, 40 after a detonation), a flame each tick and a smoke column's puff every 6th (12th on Low); then
  // the column every 20th tick to two minutes; then a thin grey wisp every 40th until it sinks. About 30 live particles
  // a burning wreck, 6 a smoking one, 3 after (FX: pictures, drawn from FX.rnd).
  function wreckFX(o, n, F) {
    if (!o.ko || o.dead || o.sink > 0 || !o.parts.length) return;
    const P = burnPoint(o);
    if (!P) return;
    const clk = F || (typeof Flight !== 'undefined' ? Flight : null), tn = clk && Number.isFinite(clk.time) ? clk.time : 0;
    let age = tn - (Number.isFinite(o.ko.t) ? o.ko.t : tn);
    if (!(age >= 0)) age = DEATH.smoke - 1; // (a clock that went back: a new flight's; only the smoke)
    const k = clamp(groundSize(o) / 3, 0.6, 1.6), b = o.body;
    if (age < DEATH.burn[o.ko.x ? 'ammo' : 'ko']) {
      FX.flame(b, P, WZ, k);
      if (n % (Settings.high ? 6 : 12) === 0) { const r = Math.hypot(P.x, P.y, P.z) || 1; FX.smoke(b, { x: P.x + P.x / r, y: P.y + P.y / r, z: P.z + P.z / r }, WZ, 'column', k); }
    } else if (age < DEATH.smoke) { if (n % 20 === 0) FX.smoke(b, P, WZ, 'column', 0.8 * k); }
    else if (n % 40 === 0) FX.smoke(b, P, WZ, 'grey', 0.6 * k);
  }
  // how far a vessel is from the camera (the sim's camera when it can say; else from its active craft)
  function koFar(F, o) {
    if (typeof F.dist === 'function' && typeof F.absPos === 'function' && F.camAbs) return F.dist(F.absPos(o), F.camAbs);
    const A = F.active;
    return A ? Math.hypot(o.x - A.x, o.y - A.y, o.z - A.z) : 0;
  }
  const WRK = []; // (groundTick's knocked-out vehicles, reused)
  // tick()'s last part: knocked-out hulks of ours settling into wrecks (on the ground or in water, under 2 m/s, or 6 s
  // after the knock-out), thrown turrets (ours or a peer's) once they lie still, then the fire and smoke of the 3
  // knocked-out vehicles nearest the camera within 4 km (ours, the AI's, peers' wrecks), none above 4× warp.
  function groundTick(F, e, n) {
    void e;
    if (!F || !F.vessels) return;
    const t = F.time || 0, A = F.active, L = WRK;
    L.length = 0;
    for (const o of F.vessels) {
      if (o.dead) continue;
      if (!o.wreck && !o.remote) {
        const down = o.landed || o.splashed || o.contactTime > 0;
        if (o.ko && !o.kin && !o.foreign) { if (down && (o.speed() < DEATH.settleV || t - (o.ko.t || 0) > DEATH.settleT)) settle(o); }
        else if (o.tossed && down && o.speed() < 1) settle(o);
      }
      if (o.ko && !o.tossed && A && o.body === A.body && o.parts.length) L.push(o); // (a thrown turret's crew knocked out as it lands: no fire of its own)
    }
    if (L.length && !((F.warpIdx || 0) > 2)) {
      const near = [];
      for (const o of L) { const d = koFar(F, o); if (d <= 4000) near.push([d, o]); }
      if (near.length > 3) { near.sort((a, b) => a[0] - b[0]); near.length = 3; }
      for (const [, o] of near) wreckFX(o, n, F);
    }
    L.length = 0;
  }
  // partFX()'s ground half: a knocked-out vehicle's old parts give none of the generic hp smoke (its hull at 0 no longer
  // burns forever; the wreck's fire and smoke are wreckFX's). true when so.
  function koPartFX(o, p, f, n) { void p; void f; void n; return !!o.ko; }

  // ================================================================ HUD
  // What the player sees of it (spec §6). The air HUD's hit feedback, drawn on the HUD's canvas by Combat.drawHUD: a
  // tick round the gun cross after each of our hits, and one banner at a time (HIT, ENGINE OUT, ON FIRE, WING OFF and
  // the like, PILOT KO, SHOT DOWN / KNOCKED OUT; a lower one never replaces a higher one still showing; a kill of ours
  // chimes). The player's own losses in one hit window (a missile's burst: a wing, a fin, an engine, a tank) said in one
  // toast, with one bang and one buzz. The words for the end of a life (Flight's strip, Flight.deathLine).
  const FB = { 'HIT': ['#f2f5f7', 0, 0.6], 'ENGINE OUT': ['#ffd23f', 1, 1.5], 'ON FIRE': ['#ffa040', 2, 1.5],
    'WING OFF': ['#ffd23f', 3, 1.5], 'TAIL OFF': ['#ffd23f', 3, 1.5], 'FIN OFF': ['#ffd23f', 3, 1.5], 'ROTOR OFF': ['#ffd23f', 3, 1.5], 'ENGINE OFF': ['#ffd23f', 3, 1.5],
    'PILOT KO': ['#ff5d5d', 4, 2.2], 'SHOT DOWN': ['#ff5d5d', 5, 2.2], 'KNOCKED OUT': ['#ff5d5d', 5, 2.2] };
  const now = (sim) => (sim && Number.isFinite(sim.time) ? sim.time : typeof Flight !== 'undefined' && Number.isFinite(Flight.time) ? Flight.time : 0);
  // a banner up (shown, not over; a clock that went back ends it)
  const showing = (t) => !!fb.text && t >= fb.t && t - fb.t < fb.life;
  // A banner (FB's words): over a lower one still showing, never under it. The kill's (SHOT DOWN, KNOCKED OUT) chimes once,
  // where the air HUD draws it (not in a ground vehicle's sight, whose own banner is Armour.fb's, nor in a room, where the
  // kill's message chimes: mp.js onDown)
  function feedback(text, sim) {
    const k = FB[text];
    if (!k) return;
    const t = now(sim), up = showing(t);
    if (up && k[1] < fb.pri) return;
    const again = up && fb.text === text;
    fb.text = text; fb.col = k[0]; fb.pri = k[1]; fb.life = k[2]; fb.t = t;
    if (k[1] === 5 && !again && chimes(sim)) Sound.chime();
  }
  function chimes(sim) {
    const F = sim || (typeof Flight !== 'undefined' ? Flight : null);
    return !(F && F.groundAim) && !(typeof MP !== 'undefined' && MP.live);
  }
  // one of our hits landed on an aircraft or a ground vehicle (damage, a hit message): the tick, and HIT when no banner is up
  function hit(sim) {
    const t = now(sim);
    fb.tick = t;
    if (!showing(t)) feedback('HIT', sim);
  }

  // Drawn from Combat.drawHUD, over the 3D view (not while destroyed: drawHUD stops; nor in a ground vehicle's sight,
  // whose hits GHUD shows): round the gun cross (Combat.aimCross: the pipper's cross in Aim, the selected gun's 600 m out,
  // 600 m down the nose without guns; the middle of the screen when it is behind the camera), the tick for 0.15 s after
  // each hit (four short diagonals 16-22 px out, the banner's colour, else white) and the banner 48 px over the cross (a
  // kill's bigger, 74 px over), below it when that would run into the panels at the top of the screen (the flight data,
  // the buttons at the top right: measured once a banner, as the HUD's size and the screen's change), beside them when
  // both would (the cross beside or under a panel: the nearest place clear of them, above or below), kept 8 px inside
  // the screen's sides, fading out in its last third of a second. Nothing to show: no work at all.
  const HX = { x: 0, y: 0, z: 0, armed: false }, TK = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const FONT = '700 15px "Chakra Petch", system-ui, sans-serif', BIG = '700 20px "Chakra Petch", system-ui, sans-serif';
  const TOP = { t: -1, W: 0, H: 0, boxes: [] }; // (the top panels' boxes, measured for the banner of time t on a W×H screen)
  function topBoxes(W, H) {
    if (TOP.t === fb.t && TOP.W === W && TOP.H === H) return TOP.boxes;
    TOP.t = fb.t; TOP.W = W; TOP.H = H; TOP.boxes = [];
    if (typeof document === 'undefined') return TOP.boxes;
    for (const q of ['#flight-ui .telemetry', '#flight-ui .flight-top-right', '#mp-bar', '#gai-bar']) {
      const e = document.querySelector(q);
      if (!e || e.hidden) continue;
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top < H / 2) TOP.boxes.push(r); // (only what sits in the top half)
    }
    return TOP.boxes;
  }
  // does a banner w wide, its baseline at y (font size f), meet any of the boxes (6 px apart)?
  const meets = (B, x, y, w, f) => B.some((r) => x - w / 2 - 6 < r.right && x + w / 2 + 6 > r.left && y - f - 6 < r.bottom && y + 6 > r.top);
  function drawHits(ctx, W, H, dpr, F) {
    void dpr;
    const t = now(F), tick = t >= fb.tick && t - fb.tick < 0.15, ban = showing(t);
    if (!tick && !ban) return;
    const v = F.active;
    if (!v || !v.parts.length || F.destroyed || F.groundAim || typeof Render3D === 'undefined') return;
    // (a drone's FPV view: on its OSD's centre cross, the camera's line, and clear of the OSD's blocks and the alert line,
    // review P5-COMBO-2)
    const osd = v.kind === 'drone' && typeof Drone !== 'undefined' && Drone.osdBoxes ? Drone.osdBoxes(W, H, F) : null;
    const bp = bodyPos(v.body, F.time), P = osd ? null : Combat.aimCross(v, HX), s = osd ? { x: W / 2, y: H / 2 } : Render3D.project(bp.x + P.x, bp.y + P.y, P.z);
    const cx = s.behind ? W / 2 : clamp(s.x, 0, W), cy = s.behind ? 0.45 * H : clamp(s.y, 0.1 * H, 0.9 * H);
    const col = ban ? fb.col : '#f2f5f7';
    ctx.save();
    if (tick) {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineCap = 'butt';
      ctx.beginPath();
      for (const [p, q] of TK) { ctx.moveTo(cx + p * 16, cy + q * 16); ctx.lineTo(cx + p * 22, cy + q * 22); }
      ctx.stroke();
    }
    if (ban) {
      const big = fb.pri === 5, f = big ? 20 : 15;
      ctx.font = big ? BIG : FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const w = ctx.measureText(fb.text).width, B = osd ? topBoxes(W, H).concat(osd) : topBoxes(W, H);
      if (osd) { const al = document.querySelector('#flight-alert'), r = al && !al.hidden && al.getBoundingClientRect(); if (r && r.width > 0 && r.height > 0) B.push(r); }
      let x = clamp(cx, 8 + w / 2, W - 8 - w / 2), y = cy - (big ? 74 : 48);
      const y2 = cy + (big ? 64 : 44) + f;
      if (y - f < 64 || meets(B, x, y, w, f)) { if (!meets(B, x, y2, w, f) || y - f < 0) y = y2; } // (below the cross instead: a phone's top panels)
      if (meets(B, x, y, w, f)) { // (review P2-HUD-2: over a panel both ways, the cross beside or under one: slid sideways clear of it, the nearest place)
        let best = null;
        for (const yy of [y, y === y2 ? cy - (big ? 74 : 48) : y2]) {
          if (yy - f < 0 || yy + 6 > H) continue;
          for (const r of B) for (const xx of [r.left - 7 - w / 2, r.right + 7 + w / 2]) {
            const X = clamp(xx, 8 + w / 2, W - 8 - w / 2), k = Math.abs(X - cx) + Math.abs(yy - y);
            if (!meets(B, X, yy, w, f) && (!best || k < best.k)) best = { x: X, y: yy, k };
          }
        }
        if (best) { x = best.x; y = best.y; }
      }
      ctx.globalAlpha = clamp(3 * (fb.life - (t - fb.t)), 0, 1);
      ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(8, 11, 16, 0.6)'; ctx.strokeText(fb.text, x, y);
      ctx.fillStyle = fb.col; ctx.fillText(fb.text, x, y);
    }
    ctx.restore();
  }

  // The player's own losses from one hit (Combat.damage holds them) or one hit window (Combat.ripWin: an explode, a hit
  // message; and its end, the torn-off kit flushRips sends): each would have been a toast of its own (a part shot off,
  // half a wing, the tail, an engine out, a part damaged or on fire), so a missile's burst stacked three or four on a
  // phone. They wait in S.lost and go as one when the last hold ends outside any window (flushLost): "Right wing, Pylon
  // and 2 more shot off! Jet Engine out!", with one bang and one buzz; a single loss in its own words, as ever.
  // it: { name, k: 'off' | 'out' | 'fire' | 'bad' | 'dmg', text (the toast it would have been), bang }. true: held.
  function lose(v, sim, it) {
    if (!sim || v !== sim.active || v.ai || !(S.hold > 0 || Combat.ripWin() > 0)) return false;
    if (!S.lost) S.lost = { sim, list: [] };
    S.lost.sim = sim; S.lost.list.push(it);
    return true;
  }
  function holdLost() { S.hold++; }
  // "a", "a and b", "a, b and 3 more"
  const names = (a) => (a.length === 1 ? a[0] : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a[0]}, ${a[1]} and ${a.length - 2} more`);
  function lostText(list) {
    if (list.length === 1) return list[0].text;
    const of = (k) => [...new Set(list.filter((x) => x.k === k).map((x) => x.name))];
    const off = of('off'), out0 = of('out'), out = out0.includes('All engines') ? ['All engines'] : out0;
    // (review P2-AIR-R1) a fire is told unless its part was shot off in the window (by the part when the item has it, as
    // ignite's do; by the name else): an engine out and burning says both, '<name> out! <name> on fire!' (spec §3.2 #5)
    const gone = (x) => (x.p && x.v ? !x.v.parts.includes(x.p) : off.includes(x.name));
    const fire = [...new Set(list.filter((x) => x.k === 'fire' && !gone(x)).map((x) => x.name))], bad = of('bad'), dmg = of('dmg').filter((n) => !bad.includes(n));
    const seg = [];
    if (off.length) seg.push(`${names(off)} shot off!`);
    if (out.length) seg.push(`${names(out)} out!`);
    if (fire.length) seg.push(`${names(fire)} on fire!`);
    if (!seg.length) seg.push(bad.length && !dmg.length ? `${names(bad)} badly damaged` : `${names([...bad, ...dmg])} damaged`);
    return seg.join(' ');
  }
  function flushLost() {
    S.hold = Math.max(0, S.hold - 1);
    if (S.hold || Combat.ripWin() > 0) return; // (a hit inside a window: the window's end says it all)
    const L = S.lost;
    S.lost = null;
    if (!L || !L.list.length) return;
    if (L.sim.toast) L.sim.toast(lostText(L.list), 'warn');
    if (L.list.some((x) => x.bang)) { Sound.explode(); if (typeof haptic === 'function') haptic([60, 40, 80]); }
  }

    return {
    S, fb, DET, dice, alive, partDead, airSize, groundSize, deathFX, tagPieces, base,
    airHit, airRule, airPart, detonated, cutWing, airCheck, afterAir,
    ignite, burning, leaking, partFX,
    impact, tick, reset, crash, pyre, limp, // (the crash section's: crash, crash sites, who flies no more)
    groundPart,
    groundKO, settle, groundPieces, wreckFX, _g: { impactGround, groundTick, koPartFX, burnPoint }, // (the ground section's: an old car's knock-out, a hulk made a wreck, a wreck's fire and smoke; _g for the tests)
    clearSpawn, // (multiplayer's: a spawn on top of a wreck sinks it, mp.js)
    feedback, hit, drawHits, lose, holdLost, flushLost, // (the HUD section's: banners and ticks, the losses of one hit window in one toast)
    _t: { detRoll, state, intactClS, tearOff, loaded, FB, fireTick, airPartFX, partAt, T, lostText, TOP },
  };
})();
