'use strict';
// Ground Battle rules (the ground update), pure so the multiplayer host and the solo Practice Battle share them:
// arenas, where vehicles start, zone capture, tickets, deaths and the result. GROUND_STOCK: the stock vehicles a
// player falls back to at each money tier. No DOM, no Flight, no randomness: the same calls give the same battle.
// (Every global but EARTH is read behind a typeof guard, so the file also loads headless, without what it reads.)
//
// The objective `obj` (init) is plain JSON, so it can live in MP.state:
//   { arena: 'highland' | 'runway', tk: [team 0's tickets, team 1's], zones: [{ id, name, e, z, r, own, p }],
//     sizes: [players per team at the start], bleed: [the fraction of a ticket each team has bled so far] }
// own: -1 neutral, 0 or 1 the team holding it. p: -1..1, how far it is captured: -1 all team 0's, +1 all team 1's.
// Tickets stay whole numbers (bleed carries its fractions in `bleed`).
//
//   arena(id) -> EARTH.arenas[id] | null;  pick(mapReady) -> 'highland' | 'runway'
//   placement(arenaId, team, slot, kind) -> { e, z, yaw, air?: { alt, speed } } | null   (Flight.start's opts.place)
//   soloPlace(kind) -> place | null;  obj() -> the live objective | null;  stock(budget) -> template keys, best first
//   init(arena, settings, teamSizes) -> obj;  tick(obj, dt, units) -> events;  death(obj, team, cost, air) -> tickets
//   result(obj, timeUp, alive?) -> { winner: 0 | 1 | null, why: 'tickets' | 'wiped' | 'time' | 'draw' } | null
//   inZone(e, z, zone) -> bool

// The stock vehicle a player falls back to (MP.battleDesign) at each money tier, best first: the keys of TEMPLATES.
// Below the cheapest tier, its list; when none of a tier's is there or fits, the technical (a ground vehicle, never
// a plane). GroundMode.stock(budget) reads it.
const GROUND_STOCK = Object.freeze({
  45000: Object.freeze(['tk34', 'ms4', 'pumo']), // WWII
  75000: Object.freeze(['tk72', 'leapard1', 'tk34']), // Cold War
  120000: Object.freeze(['ma1', 'tk72', 'leapard1']), // modern
  fallback: 'technical',
});

const GroundMode = (() => {
  const CAP_RATE = 1 / 20; // zone progress a second for one vehicle: a neutral zone in 20 s, an enemy's in 40 s
  const CAP_SPEED = 30; // m/s: faster than this, a vehicle is passing through, not taking the zone
  const TROOPS = 1.5; // living troops aboard a capturer speed the capture up by half
  const MULT = (n) => (n >= 3 ? 1.8 : n === 2 ? 1.5 : 1); // two vehicles capture 1.5x as fast, three or more 1.8x
  const TICKETS = 600; // a team's tickets when the settings give none
  const ROW = 22; // m between vehicles abreast on a pad, and between its rows
  const COLS = 3; // at most this many abreast (out to 22 m, a room has at most three a side), well clear of the helicopters
  const HELI = 60; // m: helicopters stand this far beside the pad's centre (behind it, on a pad too narrow for that)
  const HELI_STEP = [25, 30]; // m between helicopters: in a pair's rows beside the pad, in a file behind it
  const AIR = { alt: 1000, speed: 140, back: 2000, step: 80, n: 8 }; // air starts; back: behind a pad with none
  const groundKinds = () => (typeof GROUND_KINDS !== 'undefined' ? GROUND_KINDS : null);
  const fin = (x) => typeof x === 'number' && x === x && x !== Infinity && x !== -Infinity;
  const teamOf = (t) => (t === 1 ? 1 : t === 0 ? 0 : -1);
  // a point `along` metres ahead of f (a pad or an air start, facing its yaw) and `side` metres across, to its right
  // as placeOnSurface turns a craft with that yaw: the nose goes (cos yaw, -sin yaw) in (e, z), as on the airfields
  const at = (f, along, side) => {
    const c = Math.cos(f.yaw), s = -Math.sin(f.yaw);
    return { e: f.e + c * along - s * side, z: f.z + s * along + c * side, yaw: f.yaw };
  };
  // abreast from the centre out: 0, +1, -1, +2, -2, ... (times the spacing)
  const abreast = (k) => (k ? (k % 2 ? 1 : -1) * Math.ceil(k / 2) : 0);
  // who may take a zone: a ground vehicle of one of the two teams, on the ground, slower than 30 m/s
  const capturer = (u, GK) => !!u && (u.team === 0 || u.team === 1) && !!u.gd && fin(u.e) && fin(u.z) && fin(u.speed) &&
    Math.abs(u.speed) < CAP_SPEED && (GK ? GK.has(u.kind) : u.kind === 'tank' || u.kind === 'car');
  const inZone = (e, z, zone) => {
    if (!zone || !fin(e) || !fin(z)) return false;
    const de = e - zone.e, dz = z - zone.z;
    return de * de + dz * dz <= zone.r * zone.r;
  };

  return {
    arena(id) { return typeof EARTH !== 'undefined' && EARTH.arenas && typeof id === 'string' && hasOwnArena(id) ? EARTH.arenas[id] : null; },
    // Highland Ridge on the real map; without it, the space centre's own runway
    pick(mapReady) { return mapReady ? 'highland' : 'runway'; },

    // Where a vehicle of `kind` starts for `team` (0: the north pad / the runway's west end, 1: the other) as the
    // team's `slot`-th player (0, 1, 2, ...): Flight.start's opts.place. Tanks, cars and anything else that drives
    // line up abreast on the pad 22 m apart, from its centre out (0, +22, -22 m), then a second row 22 m behind, all
    // facing the pad's way (towards the zones); a pad holds six (a room has at most three a side) and then starts
    // again at its first spot. Helicopters stand 60 m beside the pad's centre, a pair to a row 25 m apart (four, then
    // again), or, on a pad too narrow for that (the runway's 50 m), in a file behind it from 60 m back, 30 m apart
    // (four): 38 m from the nearest vehicle spot either way. Planes join in the air at the team's air start, 1,000 m
    // over the ground at 140 m/s along their nose (Flight.start's P.air), 80 m apart abreast (eight); an arena with no
    // air starts (the Runway) has them 2 km behind the team's pad, heading the pad's way. null: no such arena.
    placement(arenaId, team, slot, kind) {
      const A = this.arena(arenaId);
      if (!A || !A.pads || A.pads.length < 2) return null;
      const t = team === 1 ? 1 : 0, f = A.pads[t];
      const k = fin(+slot) && +slot > 0 ? Math.floor(Math.min(+slot, 1e6)) : 0;
      if (kind === 'plane') {
        const S = A.air && A.air[t], base = S || at(f, -AIR.back, 0);
        const o = at(base, 0, abreast(k % AIR.n) * AIR.step);
        o.air = { alt: S && S.air && fin(+S.air.alt) ? +S.air.alt : AIR.alt, speed: S && S.air && fin(+S.air.speed) ? +S.air.speed : AIR.speed };
        return o;
      }
      if (kind === 'heli') {
        const h = k % 4;
        return f.hw >= HELI + 15 ? at(f, -Math.floor(h / 2) * HELI_STEP[0], (h % 2 ? -1 : 1) * HELI) : at(f, -HELI - h * HELI_STEP[1], 0);
      }
      const cols = Math.min(COLS, Math.max(1, 2 * Math.floor((f.hw - 3) / ROW) + 1)), rows = Math.max(1, Math.floor((f.hl - 5) / ROW) + 1);
      const n = k % (cols * rows);
      return at(f, -Math.floor(n / cols) * ROW, abreast(n % cols) * ROW);
    },
    // Where a solo launch of this kind starts (App.launch, Flight.revert): Armour on Highland Ridge's north pad when the
    // map is ready and the 3D view is on (the 2D view can't show it there); null for the kind's own launch site.
    soloPlace(kind) {
      return kind === 'tank' && typeof Terrain !== 'undefined' && Terrain.earthMap && Terrain.earthMap.state === 'ready' &&
        typeof App !== 'undefined' && App.use3D() ? this.placement('highland', 0, 0, 'tank') : null;
    },
    // The stock vehicles (TEMPLATES keys) to fall back to with this much money, best first, ending with the technical:
    // the dearest tier the money reaches (the cheapest below them all).
    stock(budget) {
      const tiers = Object.keys(GROUND_STOCK).filter((k) => k !== 'fallback').map(Number).sort((a, b) => a - b);
      let tier = tiers[0];
      for (const m of tiers) if (+budget >= m) tier = m;
      return [...GROUND_STOCK[tier], GROUND_STOCK.fallback];
    },

    // The objective at the start of a battle on `arena` (an id, or an EARTH.arenas entry; an unknown one: the Runway,
    // which needs no map). settings.tickets: each team's tickets (600 when missing). teamSizes: [players on team 0,
    // on team 1] at the start (a team that started with nobody is never 'wiped'). A duel (format '1v1', or nobody's
    // team bigger than one) is fought over zone C alone, its rDuel wide (70 m on Highland Ridge).
    init(arena, settings, teamSizes) {
      let id = typeof arena === 'string' ? arena : null;
      if (arena && typeof arena === 'object' && typeof EARTH !== 'undefined' && EARTH.arenas) for (const k in EARTH.arenas) if (EARTH.arenas[k] === arena) id = k;
      if (!this.arena(id)) id = 'runway';
      const A = this.arena(id), st = settings || {};
      const sizes = Array.isArray(teamSizes) ? [0, 1].map((t) => (fin(+teamSizes[t]) ? Math.max(0, Math.floor(+teamSizes[t])) : 0)) : [1, 1];
      const duel = st.format === '1v1' || (Array.isArray(teamSizes) && Math.max(sizes[0], sizes[1]) <= 1);
      const T = fin(+st.tickets) && +st.tickets >= 1 ? Math.min(Math.round(+st.tickets), 99999) : TICKETS;
      const all = A && Array.isArray(A.zones) ? A.zones : [], mid = all.filter((zn) => zn.id === 'C');
      const src = duel && mid.length ? mid : all;
      const zones = src.map((zn) => ({ id: zn.id, name: zn.name, e: zn.e, z: zn.z, r: duel ? zn.rDuel || zn.r : zn.r, own: -1, p: 0 }));
      return { arena: id, tk: [T, T], zones, sizes, bleed: [0, 0] };
    },

    // One step of the battle, `dt` seconds (clamped to 1 s: a host that stalled doesn't hand out a capture at once).
    // units: [{ team, e, z, kind, speed, gd, troops }], everyone in the fight; extra fields are ignored. A unit takes a
    // zone when it is a ground kind (GROUND_KINDS), slower than 30 m/s, on the ground (gd) and within the zone's r.
    // One team inside: the zone moves its way at 1/20 a second (x1.5 for two vehicles, x1.8 for three or more, x1.5
    // more if any of them has living troops aboard); both: frozen; nobody: it stays where it is. Taking an enemy zone
    // makes it neutral when the bar passes the middle, then yours at the end. Then each team bleeds
    // max(0, the enemy's zones - its own) tickets a second. Returns the events, in order, for the feed:
    //   { k: 'cap', zone: id, team, by: [indices into units of the vehicles that took it] }  ("Shetland took B")
    //   { k: 'lost', zone: id, team }                         (the team that held it: it is neutral now)
    tick(obj, dt, units) {
      const ev = [];
      if (!obj || !Array.isArray(obj.zones) || !Array.isArray(obj.tk)) return ev;
      dt = +dt;
      if (!(dt > 0)) return ev; // (NaN, 0, negative)
      if (dt > 1) dt = 1;
      const list = Array.isArray(units) ? units : [], GK = groundKinds();
      const ok = list.map((u) => capturer(u, GK));
      for (const zn of obj.zones) {
        const n = [0, 0], tr = [false, false], by = [[], []];
        for (let i = 0; i < list.length; i++) {
          const u = list[i];
          if (!ok[i] || !inZone(u.e, u.z, zn)) continue;
          n[u.team]++; by[u.team].push(i);
          if (+u.troops > 0) tr[u.team] = true;
        }
        if (!n[0] === !n[1]) continue; // contested (frozen), or empty (no decay)
        const t = n[0] ? 0 : 1, sg = t ? 1 : -1;
        if (zn.own === t && zn.p === sg) continue; // already all ours
        let p = zn.p + sg * CAP_RATE * MULT(n[t]) * (tr[t] ? TROOPS : 1) * dt;
        if (p * sg >= 1 - 1e-9) p = sg;
        if (Math.abs(p) < 1e-9) p = 0;
        zn.p = p;
        if (zn.own === 1 - t && p * -sg <= 0) { ev.push({ k: 'lost', zone: zn.id, team: zn.own }); zn.own = -1; }
        if (zn.own !== t && p === sg) { zn.own = t; ev.push({ k: 'cap', zone: zn.id, team: t, by: by[t] }); }
      }
      // the bleed: whole tickets, the fractions carried
      const held = [0, 0];
      for (const zn of obj.zones) if (zn.own === 0 || zn.own === 1) held[zn.own]++;
      if (!Array.isArray(obj.bleed)) obj.bleed = [0, 0];
      for (const t of [0, 1]) {
        const d = Math.max(0, held[1 - t] - held[t]);
        if (!d) continue;
        const b = (+obj.bleed[t] || 0) + d * dt, whole = Math.floor(b + 1e-9);
        obj.bleed[t] = Math.max(0, b - whole);
        if (whole) obj.tk[t] = Math.max(0, obj.tk[t] - whole);
      }
      return ev;
    },

    // A vehicle of `team` knocked out: its team loses 30 + round(cost / 2500) tickets (an expensive vehicle costs more),
    // x1.5 (rounded) for an aircraft (air: true, or the kind 'plane' or 'heli'). Applied to obj (never below 0);
    // returns the tickets the death costs (the full price, even when the team had fewer left), 0 for no such team.
    death(obj, team, cost, air) {
      const t = teamOf(team);
      if (!obj || !Array.isArray(obj.tk) || t < 0) return 0;
      const c = fin(+cost) ? Math.min(1e7, Math.max(0, +cost)) : 0;
      const isAir = air === true || air === 1 || air === 'plane' || air === 'heli';
      const n = Math.round((30 + Math.round(c / 2500)) * (isAir ? 1.5 : 1));
      obj.tk[t] = Math.max(0, obj.tk[t] - n);
      return n;
    },

    // Is it over? In this order: a team out of tickets loses ('tickets'; both at once: a draw); a team with nobody
    // left in the fight loses ('wiped'); when the time is up (timeUp), the team with more tickets wins ('time'), equal
    // tickets is a draw. null: it goes on. alive (optional, for 'wiped'): [team 0's players still in the fight, team
    // 1's], counts or booleans: each player alive (able to spawn again: tickets left with Free respawns, a slot left
    // with a lineup) or flying. Only teams that started with players (init's teamSizes) can be wiped out; when every
    // team that started is, it is a draw. winner: 0 or 1, null for a draw.
    result(obj, timeUp, alive) {
      if (!obj || !Array.isArray(obj.tk)) return null;
      const out0 = !(obj.tk[0] > 0), out1 = !(obj.tk[1] > 0);
      if (out0 && out1) return { winner: null, why: 'draw' };
      if (out0 || out1) return { winner: out0 ? 1 : 0, why: 'tickets' };
      if (Array.isArray(alive)) {
        const sz = Array.isArray(obj.sizes) ? obj.sizes : [1, 1];
        const started = [0, 1].filter((t) => sz[t] > 0), gone = started.filter((t) => !(alive[t] === true || +alive[t] > 0));
        if (started.length && gone.length === started.length) return { winner: null, why: 'draw' };
        if (started.length === 2 && gone.length === 1) return { winner: 1 - gone[0], why: 'wiped' };
      }
      if (timeUp) {
        const a = Math.round(obj.tk[0]), b = Math.round(obj.tk[1]);
        return a === b ? { winner: null, why: 'draw' } : { winner: a > b ? 0 : 1, why: 'time' };
      }
      return null;
    },

    // Is (e, z) inside the zone (within r of its centre, across the ground)?
    inZone,
    // The objective that is live: a room's (MP.state.obj) or the Practice Battle's, else null (the HUD reads it here).
    obj() { return (typeof MP !== 'undefined' && MP.live && MP.state.obj) || (typeof GroundAI !== 'undefined' && GroundAI.battle && GroundAI.battle.obj) || null; },
  };
  function hasOwnArena(id) { return Object.prototype.hasOwnProperty.call(EARTH.arenas, id); }
})();
