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
  // pyres: crash sites {b, x, y, z, t, k, wet} (the crash section); lost: the player's losses merged in a hit window (the HUD's)
  const S = { pyres: [], lost: null };
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
      FX.sparks(v.body, at, vel, 8); FX.puff(v.body, at, vel, 6, '#cfd5dc'); // (the canopy)
      return true;
    }
    // 4 a main rotor (a helicopter's; a drone's motor): torn off, it falls. ripParts says '<name> shot off!' to the
    // player: a drone's motor by its name, a helicopter's 'Main Rotor shot off!'
    if (p.def.air && p.def.air.kind === 'rotor') { sim.ripParts(v, [p], cause); return true; }
    // 5 an engine (jets, props, fan pods, rocket motors on a plane): dead, aboard (a pair is one part: both pods)
    if (p.def.thrust) {
      p.active = false; p.firing = 0; deadHp(p);
      toastMe(v, sim, `${p.def.name} out!`);
      if (!(p.burn > 0)) ignite(v, p, FIRE.lit0.eng, v.lastHitBy, sim);
      return true;
    }
    // 6 a main wing: one half off (the plane spirals)
    if (p.def.wing && !p.def.wing.control && !p.cut) return cutWing(v, p, side, cause, sim);
    // 7 anything else: torn off, burning as it falls if it holds fuel
    return tearOff(v, p, cause, sim);
  }
  function tearOff(v, p, cause, sim) {
    if ((p.fuel || 0) > 50 && !(p.burn > 0)) ignite(v, p, FIRE.lit0.fuel, v.lastHitBy, sim);
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
    if (v === sim.active && !v.ai) { toastMe(v, sim, `${s === 1 ? 'Right' : 'Left'} wing shot off!`); Sound.explode(); if (typeof haptic === 'function') haptic([60, 40, 80]); }
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
    if (v.hulkWhy !== why) { v.hulkWhy = why; if (CRIPPLED[why]) toastMe(v, sim, CRIPPLED[why]); }
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
  // (D2 fills this section: ignite, fireTick (the fire's part of tick(): burn-through, the trails, the leak trail),
  // airPartFX (air kinds' grey smoke, partFX's air half).) ignite(v, p, odds, by, sim, quiet): lights the part on a
  // roll of dice(p, p.fireN), true when lit; quiet: the caller says so itself (damage's 30 % line). Not yet: nothing
  // burns.
  function ignite(v, p, odds, by, sim, quiet) { void v; void p; void odds; void by; void sim; void quiet; return false; }
  // tick()'s first part: the burning parts (their timers, their damage, burn-through), the trails, the leak trail, the
  // crackle. Not yet: nothing.
  function fireTick(F, e, n) { void F; void e; void n; }
  // partFX()'s air half: an aircraft's damaged part smokes here (grey; black and white are the trails'), true when it
  // did. Not yet: false (the generic smoke for every part).
  function airPartFX(o, p, f, n) { void o; void p; void f; void n; return false; }

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
  const hotOf = (v) => fuelOf(v) > 50 || v.parts.some((p) => p.def.thrust || p.burn > 0);
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
    const c = v.toWorld(v.com.x, v.com.y, v.com.z || 0), hot = hotOf(v), size = airSize(v);
    const L = Terrain.locate(v.body, c.x, c.y, c.z, {}), wet = !!Terrain.waterAt(v.body, L.a, L.z);
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
    S.lost = null;
    fb.tick = -9; fb.text = ''; fb.pri = -1; fb.t = -9; fb.life = 0;
  }

  // ================================================================ ground
  // (D4 fills this section: the old-car rule, groundKO, settle, wreckFX, impactGround (impact's ground branch),
  // groundTick (settling, wreck smoke) and koPartFX (partFX's ground half).)
  // An old part of a ground vehicle at 0 hp (Combat.destroyPart, after the air rule): true when handled (the cab of an
  // old car: knocked out, the hulk stays). Not yet: today's body for every part.
  function groundPart(v, p, cause, sim) { void v; void p; void cause; void sim; return false; }
  // impact()'s ground branch: a hull or cab broken in a crash knocks the vehicle out and it stays; the parts today's
  // breakage still takes. Not yet: all of them, as today.
  function impactGround(v, parts, sim) { void v; void sim; return parts; }
  // tick()'s last part: knocked-out vehicles settling into wrecks, thrown turrets coming to rest, the nearest wrecks'
  // fire and smoke. Not yet: nothing.
  function groundTick(F, e, n) { void F; void e; void n; }
  // partFX()'s ground half: a knocked-out vehicle's parts leave the generic hp smoke (its wreck smokes in groundTick),
  // true when so. Not yet: false.
  function koPartFX(o, p, f, n) { void o; void p; void f; void n; return false; }

  // ================================================================ HUD
  // (D6 fills this section: the drawing, the chime, the end of a life's strip.) The air HUD's hit feedback: a tick
  // round the gun cross after each of our hits, and one banner at a time (a lower one never replaces a higher one
  // still showing).
  const FB = { 'HIT': ['#f2f5f7', 0, 0.6], 'ENGINE OUT': ['#ffd23f', 1, 1.5], 'ON FIRE': ['#ffa040', 2, 1.5],
    'WING OFF': ['#ffd23f', 3, 1.5], 'TAIL OFF': ['#ffd23f', 3, 1.5], 'FIN OFF': ['#ffd23f', 3, 1.5], 'ROTOR OFF': ['#ffd23f', 3, 1.5], 'ENGINE OFF': ['#ffd23f', 3, 1.5],
    'PILOT KO': ['#ff5d5d', 4, 2.2], 'SHOT DOWN': ['#ff5d5d', 5, 2.2], 'KNOCKED OUT': ['#ff5d5d', 5, 2.2] };
  const now = (sim) => (sim && Number.isFinite(sim.time) ? sim.time : typeof Flight !== 'undefined' && Number.isFinite(Flight.time) ? Flight.time : 0);
  function feedback(text, sim) {
    const k = FB[text];
    if (!k) return;
    const t = now(sim);
    if (fb.text && t - fb.t < fb.life && k[1] < fb.pri) return;
    fb.text = text; fb.col = k[0]; fb.pri = k[1]; fb.life = k[2]; fb.t = t;
  }
  // one of our hits landed on an aircraft or a ground vehicle (damage, a hit message): the tick, and HIT when no banner is up
  function hit(sim) {
    const t = now(sim);
    fb.tick = t;
    if (!fb.text || t - fb.t >= fb.life) feedback('HIT', sim);
  }
  // drawn from Combat.drawHUD (not while destroyed, nor in a ground vehicle's sight). Not yet: nothing drawn.
  function drawHits(ctx, W, H, dpr, F) { void ctx; void W; void H; void dpr; void F; }

  return {
    S, fb, DET, dice, alive, partDead, airSize, groundSize, deathFX, tagPieces, base,
    airHit, airRule, airPart, detonated, cutWing, airCheck, afterAir,
    ignite, partFX,
    impact, tick, reset, crash, pyre, limp, // (the crash section's: crash, crash sites, who flies no more)
    groundPart,
    feedback, hit, drawHits,
    _t: { detRoll, state, intactClS, tearOff, loaded, FB },
  };
})();
