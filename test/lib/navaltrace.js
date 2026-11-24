// A 1v1 naval battle between two players, each on their own copy of the game (two VM contexts: the host, pid 1, and a
// client, pid 2), their messages passed between them as the room passes them (JSON, the sender stamped), the physics,
// Combat and the room stepped in lockstep as flight.js steps them. The battle (the ships update, spec §10): the host
// opens a naval battle, the client joins, the match runs to its battle in the Shetland Sound; then the host's Arley and
// the client's meet 700 m apart: the host's 127 mm holes the client's ship (ho on the hit), its torpedo runs on both
// screens and holes her under the water, the client's anti-ship missile is shot down by the host's close-in gun (mkill:
// its owner ends it), and the client's ship, flooded, goes down on both screens (down.sea; her snapshots while she sinks)
// and settles on the bed as a wreck (sk); then the result. Recorded step by step: what each side sent (a digest of
// every message), and what each side sees of both ships.
//   const { trace, facts } = await require('./lib/navaltrace.js')(G, ROOM);
module.exports = async function navaltrace(G, ROOM) {
  const NAV = `
    Net.send = function (m, to) { m.f = Net.me; (this.out = this.out || []).push([JSON.parse(JSON.stringify(m)), to]); };
    Math.random = mulberry32(4242); Ship.seed(2026); if (typeof Armour.seed === 'function') Armour.seed(11);
    var __sim = ${'(' + G.sim.toString() + ')()'};
    Object.assign(Flight, { toast(t) { (Flight.log = Flight.log || []).push(t); }, ripParts: __sim.ripParts, breakParts: __sim.breakParts, broken: [], warpIdx: 0, flags: {},
      onDestroyed() { if (this.destroyed) return; this.destroyed = true; if (this.mp) MP.onLocalDestroyed(); } });
    // Flight.start as the game's for a ship: placed at opts.place, then afloat at her marks (Ship.launch); the flight's clock opts.time
    Flight.start = function (design, opts) {
      const parts = partsFromDesign(design.parts), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
      const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
      const v = new Vessel(ps, adj, EARTH); v.name = design.name; v.kind = design.kind; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups();
      if (v.kind === 'ship') v.sas = 'hold';
      if (v.aimed.length) Aim.limits(v);
      const P = opts.place, K = VEHICLE_KINDS[v.kind];
      if (P) v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), K.launchRot, P.z, P.yaw || 0); else v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[K.site].east), K.launchRot, 0, Math.PI);
      if (v.hydro && Ship.overWater(v)) Ship.launch(v, P);
      Flight.starts.push({ name: design.name, kind: design.kind, key: design.key, place: P, keep: (opts.keep || []).length });
      Flight.vessels = [v, ...(opts.keep || []).filter((o) => o && !o.dead)]; Flight.active = v; Flight.running = true; Flight.mp = opts.mp; Flight.destroyed = false;
      Flight.time = opts.time != null ? opts.time : 0; Combat.reset(Flight);
    };
    // one 1/60 s frame as flight.js runs it: the ghosts posed, two physics steps (each with Combat's), Combat's frame, the
    // flight's clean-up, then our snapshots and missiles out
    var frame = () => {
      __P += 1000 / 60; __T += 1000 / 60;
      if (!Flight.running) return;
      MP.beforeUpdate(1 / 60);
      for (let i = 0; i < 2; i++) {
        for (const v of Flight.vessels.slice()) { if (v.remote || v.dead || v.wreck || v.kin) continue; if (v.moored && v !== Flight.active) { Ship.drift(v, 1 / 120, Flight); continue; } v.physicsStep(1 / 120, Flight); }
        for (const v of Flight.vessels) if (v.remote && !v.wreck) { v.x += v.vx / 120; v.y += v.vy / 120; v.z += v.vz / 120; }
        Combat.step(1 / 120, Flight); Flight.time += 1 / 120;
      }
      Combat.frame(Flight, 1 / 60);
      Flight.vessels = Flight.vessels.filter((v) => !v.dead && v.parts.length);
      MP.afterUpdate(); MP.syncMissiles();
    };
    var r1 = (x) => Math.round(x * 10) / 10, rr = (x) => Math.round(x);
    var holeA = (v) => v ? +v.parts.reduce((s, p) => s + (p.holes ? p.holes.reduce((q, h) => q + h.a, 0) : 0), 0).toFixed(4) : 0;
    var water = (v) => v && v.sh ? +v.sh.comps.reduce((s, c) => s + c.W, 0).toFixed(1) : 0;
    var hpOf = (v) => v ? Math.round(v.parts.reduce((s, p) => s + (p.hp == null ? Combat.maxHp(p.def) : Math.max(0, p.hp)), 0)) : 0;
    var eOf = (v) => mpEZ(v.x, v.y, v.z, {});
    // a digest of one message: its type and what it carries (numbers rounded, lists counted), stable to run
    var dig = (m) => { const o = { t: m.t };
      if (m.t === 's') { o.k = Object.keys(m).filter((k) => k !== 'f').join(); if (m.sh) o.sh = m.sh[0]; if (m.af) o.af = 1; if (m.sk) o.sk = m.sk; if (m.st !== undefined) o.st = 1; }
      else if (m.t === 'hit') { o.n = m.list.length; o.k = m.k; if (m.ho) o.ho = m.ho.length; if (m.fi) o.fi = m.fi.length; if (m.kb !== undefined) o.kb = 1; if (m.m) o.m = m.m.length; }
      else if (m.t === 'shot') { o.k = m.k; if (m.k === 'stor') { o.id = m.id; if (m.end) o.end = 1; if (m.x) o.x = 1; } else if (m.sh) o.sh = m.sh; }
      else if (m.t === 'msl') { o.id = m.id; o.tg = m.tg; if (m.asm) o.asm = 1; if (m.vls) o.vls = 1; }
      else if (m.t === 'mkill') { o.pid = m.pid; o.id = m.id; }
      else if (m.t === 'down') { o.by = m.by; if (m.sea) o.sea = m.sea.why + (Array.isArray(m.sea.at) ? '@' : ''); if (m.w) o.w = 1; }
      else if (m.t === 'state') { o.phase = m.s.phase; o.game = m.s.settings.game; o.sea = m.s.settings.sea || null; if (m.s.obj) o.tk = m.s.obj.tk.join('/'); }
      else if (m.t === 'set') { o.k = m.k; }
      else if (m.t === 'obj') { o.tk = m.tk.join('/'); }
      else if (m.t === 'spawn') { o.kind = m.kind; o.n = m.parts.length; }
      else if (m.t === 'hull') { o.ho = m.ho.length; o.fi = m.fi.length; }
      return JSON.stringify(o); };
    // the messages sent since the last look, digested and counted (a digest x its count, in the order first sent)
    var outs = () => { const L = Net.out || [], c = new Map(); for (const [m, to] of L) { const k = dig(m) + (to ? '>' + to : ''); c.set(k, (c.get(k) || 0) + 1); } return [...c].map(([k, n]) => (n > 1 ? n + 'x ' : '') + k); };
    // what this screen sees: our ship and the other player's ghost (or wreck)
    var view = () => { const v = Flight.active, P = [...MP.peers.values()][0], g = P && P.ghost, w = MP.wrecks.find((x) => x.pid !== Net.me);
      const me = v ? { kind: v.kind, afloat: !!v.afloat, fate: v.fate || null, wreck: !!v.wreck, holes: holeA(v), water: water(v), hp: hpOf(v), tel: v.sh ? v.sh.tel : null } : null;
      const gh = g ? { afloat: !!g.afloat, tel: g.sh ? g.sh.tel : null, fate: g.fate || null, sinking: !!(P && P.sink), parts: g.parts.length, holes: holeA(g), fires: g.parts.filter((p) => p.fire > 0).length } : null;
      return { me, ghost: gh, wreck: w ? { pid: w.pid, kind: w.v.kind } : null, phase: MP.phase, tk: MP.state && MP.state.obj ? MP.state.obj.tk.join('/') : null, seaOff: r1(Ship.S.seaOff), sea: Ship.sea(), torps: Combat.shots.filter((s) => s.k === 'stor').length }; };`;
  const mk = async (host) => {
    const Q = G.load({ mp: true, combat: true }), X = (c) => G.run(Q, c);
    X(ROOM); X(NAV);
    if (host) await X(`MP.host('pvp', 'local', { game: 'naval', budget: 120000, test: false, sea: 'calm' })`);
    else X(`Net.isHost = false; Net.me = 2; MP.begin();`);
    return X;
  };
  const A0 = await mk(true), B0 = await mk(false), trace = {}, facts = {};
  const safe = (X) => (c) => { try { return X(c); } catch (e) { return JSON.stringify({ err: String(e && e.message) }); } };
  const A = safe(A0), B = safe(B0);
  // the room passing messages: the host's to the client (all but those for someone else), the client's to the host
  const pump = () => {
    for (let k = 0; k < 4; k++) {
      const a = JSON.parse(A(`(() => { const o = Net.out || []; Net.out = []; return JSON.stringify(o); })()`));
      const b = JSON.parse(B(`(() => { const o = Net.out || []; Net.out = []; return JSON.stringify(o); })()`));
      if (!a.length && !b.length) return;
      for (const [m, to] of a) if (to == null || to === 2) { m.f = 1; B(`emit(${JSON.stringify(m)})`); }
      for (const [m, to] of b) if (to == null || to === 1) { m.f = 2; A(`emit(${JSON.stringify(m)})`); }
    }
  };
  let n = 0;
  const step = (name, code, frames = 0) => {
    const ea = [], eb = [];
    if (code) { if (code.a) try { A(code.a); } catch (e) { ea.push(String(e && e.message)); } if (code.b) try { B(code.b); } catch (e) { eb.push(String(e && e.message)); } }
    const oa = [], ob = [];
    const look = () => { oa.push(...JSON.parse(A('JSON.stringify(outs())'))); ob.push(...JSON.parse(B('JSON.stringify(outs())'))); pump(); };
    look();
    for (let i = 0; i < frames; i++) {
      if (process.env.NAVDBG && i % 60 === 0) console.log(name, i / 60, A(process.env.NAVDBG_A || '""'), B(process.env.NAVDBG_B || '""'));
      try { A('frame()'); } catch (e) { ea.push(String(e && e.message)); }
      try { B('frame()'); } catch (e) { eb.push(String(e && e.message)); }
      look();
      A('flush(); MP.tick()'); B('flush(); MP.tick()'); look();
    }
    const merge = (L) => { const c = new Map(); for (const s of L) { const m = /^(\d+)x (.*)$/.exec(s), k = m ? m[2] : s, q = m ? +m[1] : 1; c.set(k, (c.get(k) || 0) + q); } return [...c].map(([k, q]) => (q > 1 ? q + 'x ' : '') + k); };
    trace[String(++n).padStart(2, '0') + ' ' + name] = { host: { sent: merge(oa), sees: JSON.parse(A('JSON.stringify(view())')), err: ea }, client: { sent: merge(ob), sees: JSON.parse(B('JSON.stringify(view())')), err: eb } };
  };

  // ---- the lobby and the build: a naval battle, 1v1, $120k (the stock destroyer), no sea trial, a calm sea
  step('host and join', { a: `emit({ t: 'join', pid: 2, name: 'Bea' });` });
  step('a client cannot change the sea', { b: `MP.setSetting('sea', 'rough'); Net.send({ t: 'set', k: 'sea', v: 'rough' }, 1);` });
  step('start: build', { a: `MP.startMatch(); flush();` });
  facts.build = { host: A(`JSON.stringify([Builder.mp, __loaded])`), client: B(`JSON.stringify([Builder.mp, __loaded])`) };
  step('both ready: the battle', { a: `MP.setMine('ready', true);`, b: `MP.setMine('ready', true);` });
  step('the battle starts', { a: `__T += 4000; MP.tick(); flush();` }, 2);
  B('flush();'); A('flush();');
  facts.starts = { host: A('JSON.stringify([Flight.starts.at(-1), eOf(Flight.active)])'), client: B('JSON.stringify([Flight.starts.at(-1), eOf(Flight.active)])') };
  step('a few seconds afloat: snapshots both ways and ghosts at sea', null, 120);
  facts.sea = { host: A('JSON.stringify([Ship.S.seaOff, Flight.time, Ship.seaT(Flight)])'), client: B('JSON.stringify([Ship.S.seaOff, Flight.time, Ship.seaT(Flight)])') };

  // ---- the host's ship 1.1 km on from her start, west of the zones (as if she had steamed there: the Sound's 38 m bed
  // there is shallow enough for a wreck; the starts lie in 43-45 m), then the client's brought 700 m off her starboard
  // beam (south of her: her torpedo tube's side), bow on to her
  A(`(() => { const v = Flight.active, P = { e: 16200, z: 4600, yaw: 0 }; v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), VEHICLE_KINDS.ship.launchRot, P.z, P.yaw); Ship.launch(v, P); })();`);
  step('the host west of the zones', null, 30);
  B(`(() => { const v = Flight.active, H = MP.peers.get(1).ghost, q = eOf(H), P = { e: q.e, z: q.z + 700, yaw: Math.PI / 2 }; v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), VEHICLE_KINDS.ship.launchRot, P.z, P.yaw); Ship.launch(v, P); })();`);
  step('closing to 700 m off her beam', null, 90);

  // ---- the host's 127 mm: three rounds into the client's hull, aimed at her waterline amidships (dropped for the range)
  A(`var shoot = (sh, k) => { const v = Flight.active, g = MP.peers.get(2).ghost, gun = v.parts.find((p) => p.def.weapon && p.def.weapon.naval), SH = SHELLS[sh];
      const m = v.toWorld(gun.x, gun.y + gun.def.h / 2 + 0.5, partZ(gun)), t = g.toWorld(g.com.x + (k - 1) * 12, g.com.y + 1.2, g.com.z || 0);
      const dx = t.x - m.x, dy = t.y - m.y, dz = t.z - m.z, d = Math.hypot(dx, dy, dz), tf = d / SH.v0, r = Math.hypot(t.x, t.y, t.z), drop = 0.5 * 9.81 * tf * tf;
      const ax = dx + (t.x / r) * drop, ay = dy + (t.y / r) * drop, az = dz + (t.z / r) * drop, l = Math.hypot(ax, ay, az);
      const s = { k: 'shell', sh, b: v.body, x: m.x, y: m.y, z: m.z, vx: v.vx + (ax / l) * SH.v0, vy: v.vy + (ay / l) * SH.v0, vz: v.vz + (az / l) * SH.v0, t: 0, life: SH.life, owner: v, enemy: false, net: 0, cal: SH.cal, pen: SH.pen, v0: SH.v0, spare: v, tracer: true, prox: 0, ric: false, gTop: Infinity };
      Combat.S.shots.push(s); MP.sendShot(s); return s; };
    var hb = null;`);
  B(`var h0 = holeA(Flight.active), w0 = water(Flight.active);`);
  step('the host fires three 127 mm rounds at her', { a: `hb = holeA(MP.peers.get(2).ghost); for (let k = 0; k < 3; k++) shoot(Object.keys(SHELLS).includes('sap127') ? 'sap127' : 'he127', k);` }, 90);
  facts.shells = { client: B(`JSON.stringify({ holes: holeA(Flight.active), was: h0, water: water(Flight.active) })`), host: A(`JSON.stringify({ ghostHoles: holeA(MP.peers.get(2).ghost) })`) };

  // ---- the host's torpedo, at her: a copy runs on her screen, the real one holes her under the water
  step('the host fires a torpedo', { a: `var tp = (() => { const v = Flight.active, g = MP.peers.get(2).ghost, q = eOf(v), r = eOf(g); return Ship.torpAt(v, Math.atan2(r.e - q.e, -(r.z - q.z)), Flight); })(); var tpOk = !!tp;` }, 60);
  facts.torpRun = { host: A(`JSON.stringify({ fired: tpOk, ours: Combat.shots.filter((s) => s.k === 'stor' && !s.net).length })`), client: B(`JSON.stringify({ copies: Combat.shots.filter((s) => s.k === 'stor' && s.net === 1).length })`) };
  B(`var h1 = holeA(Flight.active);`);
  step('the torpedo runs and hits', null, 60 * 40);
  facts.torpHit = { client: B(`JSON.stringify({ holes: holeA(Flight.active), was: h1, copies: Combat.shots.filter((s) => s.k === 'stor').length, water: water(Flight.active), fires: Flight.active.parts.filter((p) => p.fire > 0).map((p) => p.id).join() })`),
    host: A(`JSON.stringify({ ours: Combat.shots.filter((s) => s.k === 'stor').length, ghostHoles: holeA(MP.peers.get(2).ghost), ghostFires: MP.peers.get(2).ghost.parts.filter((p) => p.fire > 0).map((p) => p.id).join() })`) };

  // ---- the client's anti-ship missile at the host's ship: the host's close-in gun kills its copy (mkill), the client ends it
  B(`var asm = null, asmIds = [];`);
  step('the client fires an anti-ship missile', { b: `asm = Ship.asmAt(Flight.active, MP.peers.get(1).ghost, Flight); if (asm) asmIds.push(MP.missiles.get(asm) && MP.missiles.get(asm).id);` }, 30);
  A(`var hpA0 = hpOf(Flight.active), holesA0 = holeA(Flight.active);`);
  step('the missile flies; the close-in gun shoots', null, 60 * 8);
  facts.asm = { client: B(`JSON.stringify({ fired: !!asm, live: !!asm && Combat.shots.includes(asm), killedBy: asm && asm.killedBy ? 1 : 0, dead: !!(asm && asm.dead) })`),
    host: A(`JSON.stringify({ copies: Combat.shots.filter((s) => s.k === 'missile' && s.net === 2).length, hit: hpOf(Flight.active) < hpA0 - 1 || holeA(Flight.active) > holesA0 })`) };

  // ---- her end: holed past saving (her keel opened, every compartment), she founders, is doomed and goes down on both
  // screens (down.sea), the host's ghost of her posed from her snapshots until she settles on the bed as a wreck (sk 2)
  step('she founders', { b: `(() => { const v = Flight.active, S = v.sh, rows = []; for (const c of S.comps) { const x = (c.lo + c.hi) / 2, X = partPt(c.p, x, -c.p.def.h / 2 + 0.3); rows.push([c.p, X.x, X.y, partZ(c.p), 15]); } Ship.addHoles(v, rows, Flight.time); v.lastHitBy = MP.peers.get(1).ghost; v.lastHitAt = Flight.time; })();` }, 60 * 32);
  facts.down = { host: A(`JSON.stringify(view())`), client: B(`JSON.stringify({ fate: Flight.active.fate, destroyed: Flight.destroyed, sinking: !!MP.seaSink })`),
    hostDepth: A(`(() => { const g = MP.peers.get(2).ghost; return g ? Math.round(Math.hypot(g.x, g.y, g.z) - EARTH.radius) : null; })()`) };
  step('she goes down', null, 60 * 12);
  facts.sinking = { hostDepth: A(`(() => { const g = MP.peers.get(2).ghost || (MP.wrecks.find((w) => w.pid === 2) || {}).v; return g ? Math.round(Math.hypot(g.x, g.y, g.z) - EARTH.radius) : null; })()`),
    clientDepth: B(`Math.round(Math.hypot(Flight.active.x, Flight.active.y, Flight.active.z) - EARTH.radius)`) };
  step('on the bed', null, 60 * 6);
  facts.end = { host: A(`JSON.stringify(view())`), client: B(`JSON.stringify(view())`), hostDeaths: A(`JSON.stringify(MP.state.players.map((p) => [p.pid, p.kills, p.deaths, p.team]))`),
    wreckAt: [A(`(() => { const w = MP.wrecks.find((x) => x.pid === 2); return w ? JSON.stringify(eOf(w.v)) : null; })()`), B(`(() => { const w = MP.wrecks.find((x) => x.pid === 2); return w ? JSON.stringify(eOf(w.v)) : null; })()`)] };

  // ---- back in: the client's new destroyer at her end of the Sound (her wreck stays on both screens); then time: the result
  step('the client respawns', { b: `__T += 6000; var back = MP.respawnWith(MP.groundDesign || MP.myDesign);`, a: `__T += 6000;` }, 30);
  facts.respawn = { client: B(`JSON.stringify({ back, wrecks: MP.wrecks.length, kept: MP.wrecks.every((w) => Flight.vessels.includes(w.v)), at: eOf(Flight.active) })`), host: A(`JSON.stringify({ ghost: !!MP.peers.get(2).ghost, wrecks: MP.wrecks.length })`) };
  step('time is up: the result', { a: `MP.finish(null, 'time'); flush();` }, 2);
  facts.result = { host: A(`JSON.stringify(MP.state.result && [MP.state.result.winner, MP.state.result.why, MP.state.result.naval, MP.state.result.arena, MP.state.result.tk])`), client: B(`JSON.stringify([MP.phase, __ui.filter(([k]) => k === 'results').length])`) };
  return { trace, facts, A: A0, B: B0 };
};
