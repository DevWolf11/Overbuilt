'use strict';
// Aircraft radar as parts (the big update). No magic radar: a craft sees other aircraft and target drones by eye (6 km,
// less for a stealthy one; drones 4 km) and further only with a radar part (def.radarSet, parts.js): five sets that go
// inside a nose, cockpit or fuselage, a tail warning set, a radar pod, a mast radar and the Rotodome. Each has a reach
// (less against stealth and jammers, less when damaged), a scan cone, look-down (a pulse radar loses anything below
// it in the ground's echo), a notch gate, a lock time, what it guides (nothing, semi-active missiles, or those and a
// data link that lets active ones go on alone), how many targets at once, jamming resistance and low probability of
// intercept. Here: what a radar sees (cone, reach, look-down, notching, stealth, jamming, the ground in the way), the
// player's picture four times a second (contacts, ground contacts for the mast, the tail warning), the pick (I, a tap),
// radar on and off, the RWR's solo radar locks (bandits, the frigate, AI SPAA) and the search strobes an advanced RWR
// hears. Locks, launch and guidance live in combat.js and ask here. The AI bandits keep their implicit radar: nothing
// here steers or arms them. No random numbers (the seeded Monte Carlos stay as they were); never calls Gear, Armour,
// GroundMode, GroundAI or Props, and Aim only behind Combat.S.gai (the ground update's zero-call contract).
const Radar = (() => {
  const S = {
    rc: [],                // contacts at the last scan, nearest first, at most 16: { ref, x, y, z, vx, vy, vz, d, k: 'air' | 'ground' | 'six', side, t }
    set: new Set(),        // the air refs a scanning radar held at the last scan (has)
    gset: new Set(),       // ground refs (a ground radar: the mast); ours only, never shared
    six: 0,                // m to the nearest enemy aircraft a tail set holds within 3 km; 0 none
    rcT: 0, rcN: 0,        // the scan's timer; scans that ran (0 for a craft with no radar)
    los: new Map(),        // ref -> { t, losAt, los }: the scan's line-of-sight memo (0.5 s)
    pick: null,            // the air target the player chose (I, a tap): wins over "nearest the nose"
    locks: [], lkT: 0,     // solo radar locks on us: [{ x, y, z }] (bandits, the frigate, AI SPAA), 4 Hz
    scanners: [], scT: 0,  // radars painting us (an advanced RWR's search strobes): [{ x, y, z, ref }], 2 Hz
    heard: new WeakSet(),  // scanners already announced (one 500 Hz tick each)
    marks: [],             // [{ ref, x, y }] air markers drawn this frame (taps)
    gunIn: false,          // the radar holds the gun's LEAD target inside 900 m (a yellow pipper)
    lostT: -9, chirpT: -9, chirpAt: 0, sixT: 0, // LOST (1 s), the new-contact chirp (once a second) and its second note, the tail tone
    said: {}, tipped: false, // what the weapon chip's states have said this flight; the first-flight tip
    stM: new WeakMap(),    // vessel -> { st, t }: stealth, kept 0.5 s of sim time
  };
  let now = 0; // F.time at the last step (the memos read it)
  const NONE = Object.freeze([]);
  const LOS_TOP = 2000; // m: above the highest ground (terrain.js's height table tops out at 1,515 m), the ground is never in the way
  const SIX = 3000;     // m: the tail warning's reach for CHECK SIX
  const KEEP = 1.5;     // s: a contact not seen again stays on the scope this long (fading)

  // ---------------------------------------------------------------- a craft's radars
  // [{ p, R, ax, ay, cos }] for v's radar parts (cached by part count; works and rk read the parts live)
  function radars(v) {
    if (!v || !v.parts) return NONE;
    if (v._rdN === v.parts.length && v._rd) return v._rd;
    const list = [];
    for (const p of v.parts) {
      const R = p.def.radarSet;
      if (R) { const a = partAxis(p); list.push({ p, R, ax: a.x, ay: a.y, cos: R.cone >= 180 ? -2 : Math.cos((R.cone * Math.PI) / 180) }); }
    }
    v._rd = list.length ? list : NONE; v._rdN = v.parts.length;
    return v._rd;
  }
  const works = (p) => !p.broken && !(p.hp <= 0); // (hp null: a part at full health)
  const rk = (p) => { const f = Combat.hpFrac(p); return f >= 0.6 ? 1 : 0.4 + f; }; // (damage shrinks its reach)
  const aboard = (v) => !!v && !!v.parts && radars(v) !== NONE;
  // the radar that locks and guides: the longest-reaching working one that guides anything
  function mainRadar(v) {
    if (!v || v.radarOff) return null;
    let b = null, br = 0;
    for (const r of radars(v)) if (r.R.guide >= 1 && works(r.p)) { const g = r.R.range * rk(r.p); if (g > br) { br = g; b = r; } }
    return b;
  }
  const guideRange = (v) => { const r = mainRadar(v); return r ? r.R.range * rk(r.p) : 0; };
  // the longest reach of any working radar but a tail set's (the HUD's brackets, the scope's scale)
  const radarOf = (v) => (!v || v.radarOff ? 0 : radars(v).reduce((m, r) => (works(r.p) && !r.R.warn ? Math.max(m, r.R.range * rk(r.p)) : m), 0));
  // the best working radar that isn't a tail set (else the tail set, else null): its kind names the scope and the pill
  function bestRadar(v) {
    const m = mainRadar(v);
    if (m) return m;
    let b = null, br = -1, tail = null;
    for (const r of radars(v)) if (works(r.p)) { if (r.R.warn) tail = tail || r; else if (r.R.range * rk(r.p) > br) { br = r.R.range * rk(r.p); b = r; } }
    return b || tail;
  }
  // how long the main radar takes to lock t (a jammer slows it by what its jamming resistance doesn't cancel)
  function lockTime(v, t) {
    const rd = mainRadar(v), jam = !!t && !!t.parts && Combat.jams(t);
    return rd ? rd.R.lock * (jam ? 2 - rd.R.eccm : 1) : 1.4 * (jam ? 2 : 1);
  }
  // the radar missiles of v's in flight that its radar guides (not gone active), and at how many targets
  function guided(v) {
    let n = 0; const ts = new Set();
    for (const s of Combat.S.shots) if (s.launcher === v && s.sarh && !s.pit && s.target && !s.net) { n++; ts.add(s.target); }
    return { n, ts };
  }
  // the main radar guides as many targets as it can (a new target would be one too many)
  function busy(v, lock) {
    const rd = mainRadar(v);
    if (!rd) return false;
    const { ts } = guided(v);
    if (lock) ts.delete(lock);
    return ts.size >= rd.R.tws;
  }
  // stealth, kept for 0.5 s of sim time (deterministic: no wall clock); 0 for a range target
  function stealth(o) {
    if (!o || !o.parts) return 0;
    const m = S.stM.get(o);
    if (m && now - m.t < 0.5 && now >= m.t) return m.st;
    const st = Combat.stealthOf(o);
    S.stM.set(o, { st, t: now });
    return st;
  }

  // ---------------------------------------------------------------- what a radar sees
  // Nothing in the way between L and p (d apart): the ground and the sea, sampled every 400 m; free when both are far
  // above the highest ground (less the chord's sag). memo (a missile, a contact) keeps the answer `keep` seconds.
  function seesOver(L, p, d, memo, keep = 0.25) {
    if (L.body !== EARTH) return true;
    const hL = Math.hypot(L.x, L.y, L.z) - EARTH.radius, hP = Math.hypot(p.x, p.y, p.z) - EARTH.radius;
    if (Math.min(hL, hP) - (d * d) / (8 * EARTH.radius) > LOS_TOP) return true;
    if (memo && memo.losAt != null && memo.t - memo.losAt < keep && memo.t >= memo.losAt) return memo.los;
    const c = Combat.clearLine(L, p, d, 400);
    if (memo) { memo.losAt = memo.t; memo.los = c; }
    return c;
  }
  // Can L's radars see t (at tp)? job: 'guide' (radars that guide missiles), 'scan' (every working radar but a tail
  // set's), 'warn' (the tail set's), 'paint' (as 'scan', ignoring the clutter, and only within an LPI radar's heard
  // range: what a warning receiver hears). true, 'notch' (low and crossing the beam), 'clutter' (low, under a radar
  // that can't look down) or false. No 5 km fallback: no radar part, nothing seen.
  function sees(L, t, tp, job = 'guide', memo, keep = 0.25) {
    if (!L || L.dead || !L.parts || !L.parts.length || L.radarOff || !t || !tp || !tp.alive) return false;
    if (t.kind === 'drone' || (t.ai && t.ai.drone)) return false; // (drones: the counter-drone kit's job, not an aircraft radar's)
    const rl = radars(L);
    if (rl === NONE) return false;
    const dx = tp.x - L.x, dy = tp.y - L.y, dz = tp.z - L.z, d = Math.hypot(dx, dy, dz) || 1;
    let out = false, st = -1, los = null;
    for (const r of rl) {
      if (!works(r.p) || (job === 'guide' ? r.R.guide < 1 : job === 'warn' ? !r.R.warn : r.R.warn)) continue;
      if (r.cos > -1) { const f = L.axis(r.ax, r.ay, 0); if ((dx * f.x + dy * f.y + dz * f.z) / d < r.cos) continue; }
      if (st < 0) st = stealth(t);
      const reach = Combat.radarReach(r.R.range * rk(r.p), t, d, r.R.eccm, st);
      if (d > reach || (job === 'paint' && r.R.lpi && d > reach * (1 - r.R.lpi))) continue;
      if (los === null) los = seesOver(L, tp, d, memo, keep);
      if (!los) return false;
      if (job === 'paint') return true;
      const c = Combat.clutter(L, t, tp, dx, dy, dz, d, r.R);
      if (c === true) return true;
      if (c) out = c;
    }
    return out;
  }
  // Does a warning receiver on t hear v's lock? An LPI radar's only within its quiet reach.
  function heard(v, t) {
    const r = mainRadar(v);
    if (!r || !r.R.lpi || !t) return true;
    const tp = Combat.refPos(t);
    return !!tp && Math.hypot(tp.x - v.x, tp.y - v.y, tp.z - v.z) < r.R.range * rk(r.p) * (1 - r.R.lpi);
  }

  // ---------------------------------------------------------------- eyes
  // seen by eye: an aircraft within 6 km (a stealthy one closer: paint and shape, half its radar stealth), a target drone 4 km
  function eye(v, o, d) {
    if (!o) return false;
    if (o.def) return o.def.air ? d < 4000 : true; // (a range target: drones by eye; the ground's keep their brackets)
    return d < 6000 * (1 - 0.5 * stealth(o));
  }
  const has = (o) => S.set.has(o);
  const seen = (v, o, d) => eye(v, o, d) || S.set.has(o);

  // ---------------------------------------------------------------- the picture (the player's craft, 4 Hz)
  const mpLive = () => typeof MP !== 'undefined' && !!MP.active;
  const fighters = (F) => F.vessels.filter((o) => o !== F.active && !o.dead && Combat.isFighter(o) && !o.ai.down && o.control);
  const nose = (o, out) => o.axis(0, 1, 0, out); // (a bandit's nose: RAIDER is a plane)
  const N0 = { x: 0, y: 0, z: 0 };
  // is the point (x, y, z) within 60° of o's nose?
  function inNose(o, x, y, z) {
    const dx = x - o.x, dy = y - o.y, dz = z - o.z, d = Math.hypot(dx, dy, dz) || 1, f = nose(o, N0);
    return (dx * f.x + dy * f.y + dz * f.z) / d > 0.5;
  }
  function clearPic(keepPick) {
    S.rc.length = 0; S.set.clear(); S.gset.clear(); S.six = 0; S.scanners.length = 0;
    if (!keepPick) S.pick = null;
  }
  function step(F, dt) {
    now = F.time || 0;
    const v = F.active;
    if (S.chirpAt && performance.now() >= S.chirpAt) { S.chirpAt = 0; Sound.tone(1600, 0.03, 0.025); } // (the chirp's second note)
    if (!v || !v.parts || !v.parts.length || F.destroyed || v.down || F.groundAim) {
      clearPic(true); S.locks.length = 0;
      if (S.pick && !alive(S.pick)) S.pick = null;
      return;
    }
    // radar locks on us, solo (in a room the others report theirs): whatever the RWR makes of them
    if ((S.lkT -= dt) <= 0) { S.lkT = 0.25; lockers(v, F); }
    chip(v, F);
    if (!aboard(v) || v.radarOff) { clearPic(true); if (S.pick && !alive(S.pick)) S.pick = null; } // (a pick by eye stays)
    else if ((S.rcT -= dt) <= 0) { S.rcT = 0.25; scan(v, F); }
    if (Combat.S.rwr > 1) { if ((S.scT -= dt) <= 0) { S.scT = 0.5; scanners(v, F); } }
    else S.scanners.length = 0;
    // CHECK SIX: a tone every second (unless the missile warning sounds)
    if (S.six > 0 && !Combat.S.warn) { if ((S.sixT -= dt) <= 0) { Sound.beep(900); S.sixT = 1; } }
    else S.sixT = 0;
  }
  const alive = (o) => { const tp = Combat.refPos(o); return !!tp && tp.alive; };
  function lockers(v, F) {
    const out = S.locks;
    out.length = 0;
    if (mpLive()) return;
    const st = stealth(v), r = 6000 * (1 - st);
    for (const o of fighters(F)) if (Math.hypot(o.x - v.x, o.y - v.y, o.z - v.z) < r && inNose(o, v.x, v.y, v.z)) out.push({ x: o.x, y: o.y, z: o.z, ref: o });
    for (const t of Combat.S.targets) if (t.alive && t.def.rsam && Combat.S.shots.some((s) => s.owner === t && s.k === 'missile' && s.target === v)) { const c = Combat.targetCentre(t); out.push({ x: c.x, y: c.y, z: c.z, ref: t }); }
    if (Combat.S.gai) for (const o of F.vessels) if (o !== v && o.ai && o.ai.ground && !o.dead && Aim.lockTarget(o) === v) out.push({ x: o.x, y: o.y, z: o.z, ref: o });
  }
  // the weapon chip's state, said once a flight per state while an air radar missile is chosen
  const CHIP = {
    none: () => 'No radar on board: radar missiles can\'t lock. Fit one in the builder (Radar tab).',
    off: () => `Radar off: ${typeof Controls !== 'undefined' && Controls.touch ? 'hold RDR' : typeof Keys !== 'undefined' ? Keys.k('radarPower') : 'O'} to switch it on.`,
    out: () => 'Radar knocked out: radar missiles can\'t lock.',
    guns: (v) => { const r = bestRadar(v); return `The ${r ? r.p.def.name : 'radar'} can't guide radar missiles.`; },
  };
  function chip(v, F) {
    if (!F.toast) return;
    const sys = Combat.systems(v), cur = sys[v.wsel];
    if (!cur || !cur.w || !(cur.w.kind === 'missile' && cur.w.radar && cur.w.seek === 'air') || cur.def.aim) return;
    const st = chipState(v, cur);
    if (st === 'ok' || S.said[st]) return;
    S.said[st] = true;
    F.toast(CHIP[st](v), 'warn');
  }
  // a contact's side: bandits and enemy players foes, team-mates friends, everyone in a sandbox and the range neutral
  function sideOf(o) {
    if (o.remote) return typeof MP !== 'undefined' && MP.pvp ? (typeof Net !== 'undefined' && MP.enemy(Net.me, o.remote) ? 'foe' : 'friend') : 'neutral';
    if (o.ai) return o.ai.ally ? 'friend' : 'foe';
    return 'neutral';
  }
  function memoOf(o, M) {
    let m = S.los.get(o);
    if (!m) m = { t: now, losAt: null, los: true };
    m.t = now; M.set(o, m);
    return m;
  }
  function contact(o, tp, d, k) {
    return { ref: o, x: tp.x, y: tp.y, z: tp.z, vx: tp.vx, vy: tp.vy, vz: tp.vz, d, k, side: sideOf(o), t: now };
  }
  function scan(v, F) {
    S.rcN++;
    const rl = radars(v), M = new Map(), prev = S.set, seenNow = new Map();
    let far = 0, gfar = 0;
    for (const r of rl) if (works(r.p)) { const g = r.R.range * rk(r.p); if (g > far) far = g; if (r.R.ground > 0 && r.R.ground * rk(r.p) > gfar) gfar = r.R.ground * rk(r.p); }
    S.set = new Set(); S.gset.clear(); S.six = 0;
    // the air: bandits, the range's target drones, and in a room the other players' craft in the air
    const air = [];
    for (const o of fighters(F)) if (!o.landed) air.push(o);
    for (const e of Combat.S.targets) if (e.alive && e.def.air) air.push(e);
    if (typeof MP !== 'undefined' && MP.active && MP.ghosts) for (const g of MP.ghosts()) if (!g.hiddenUntilSnap && !g.landed && !isGround(g.kind) && g.kind !== 'drone' && g !== v) air.push(g);
    for (const o of air) {
      const tp = Combat.refPos(o);
      if (!tp || !tp.alive) continue;
      const d = Math.hypot(tp.x - v.x, tp.y - v.y, tp.z - v.z);
      if (d > far) continue;
      const m = memoOf(o, M);
      if (sees(v, o, tp, 'scan', m, 0.5) === true) { S.set.add(o); seenNow.set(o, contact(o, tp, d, 'air')); continue; }
      if (sideOf(o) === 'foe' && sees(v, o, tp, 'warn', m, 0.5) === true) {
        seenNow.set(o, contact(o, tp, d, 'six'));
        if (d < SIX && (!S.six || d < S.six)) S.six = d;
      }
    }
    // the ground (a ground radar: the mast): vehicles and the range's ground targets in its cover and in sight
    if (gfar > 0) {
      const gr = [];
      for (const o of F.vessels) if (o !== v && o.ai && o.ai.ground && !o.dead && !o.wreck && o.control) gr.push(o);
      if (typeof MP !== 'undefined' && MP.active && MP.ghosts) for (const g of MP.ghosts()) if (isGround(g.kind) && !g.wreck && !g.hiddenUntilSnap) gr.push(g);
      for (const e of Combat.S.targets) if (e.alive && !e.def.air) gr.push(e);
      for (const o of gr) {
        const tp = Combat.refPos(o);
        if (!tp || !tp.alive) continue;
        const dx = tp.x - v.x, dy = tp.y - v.y, dz = tp.z - v.z, d = Math.hypot(dx, dy, dz) || 1;
        if (d > gfar) continue;
        let ok = false;
        for (const r of rl) {
          if (!works(r.p) || !(r.R.ground > 0) || d > r.R.ground * rk(r.p)) continue;
          if (r.cos > -1) { const f = v.axis(r.ax, r.ay, 0); if ((dx * f.x + dy * f.y + dz * f.z) / d < r.cos) continue; }
          ok = true; break;
        }
        if (!ok || !seesOver(v, tp, d, memoOf(o, M), 0.5)) continue;
        S.gset.add(o); seenNow.set(o, contact(o, tp, d, 'ground'));
      }
    }
    S.los = M; // (memos only for what is still about)
    // a new foe on the scope: a short chirp (at most once a second; not when four or more are on it already)
    let foes = 0, fresh = false;
    for (const c of seenNow.values()) if (c.k === 'air' && c.side === 'foe') { foes++; if (!prev.has(c.ref)) fresh = true; }
    if (fresh && foes - 1 < 4 && now - S.chirpT >= 1) { S.chirpT = now; Sound.tone(1600, 0.03, 0.025); S.chirpAt = performance.now() + 60; }
    // the scope: what was seen now, and what was seen in the last 1.5 s (fading), nearest first, at most 16
    const out = [...seenNow.values()];
    for (const c of S.rc) if (!seenNow.has(c.ref) && now - c.t < KEEP && now >= c.t && alive(c.ref)) out.push(c);
    out.sort((a, b) => a.d - b.d);
    if (out.length > 16) out.length = 16;
    S.rc = out;
    if (S.pick && !alive(S.pick)) S.pick = null;
  }
  // radars painting us, for an advanced RWR's search strobes: the other players' (an LPI one only close), bandits with
  // us in their nose, the frigate in hostile mode, the AI's ground search radars
  function scanners(v, F) {
    const out = [], tp = Combat.refPos(v), st = stealth(v);
    const add = (o, x, y, z) => { out.push({ x, y, z, ref: o }); if (!S.heard.has(o)) { S.heard.add(o); Sound.tone(500, 0.06, 0.03); } };
    if (typeof MP !== 'undefined' && MP.active && MP.enemyGhosts) for (const g of MP.enemyGhosts()) {
      const P = MP.peers && MP.peers.get(g.remote);
      if (g.hiddenUntilSnap || (P && P.radarOff)) continue;
      if (sees(g, v, tp, 'paint') === true) add(g, g.x, g.y, g.z);
    }
    for (const o of fighters(F)) {
      const d = Math.hypot(o.x - v.x, o.y - v.y, o.z - v.z);
      if (d < 16000 * (1 - st) && inNose(o, v.x, v.y, v.z) && seesOver(o, tp, d)) add(o, o.x, o.y, o.z);
    }
    if (Combat.hostile()) for (const t of Combat.S.targets) {
      if (!t.alive || !t.def.rsam) continue;
      const c = Combat.targetCentre(t);
      if (Math.hypot(c.x - v.x, c.y - v.y, c.z - v.z) < t.def.radar && Combat.siteSees(t, v, tp) !== false) add(t, c.x, c.y, c.z);
    }
    if (Combat.S.gai) for (const o of F.vessels) {
      if (o === v || !o.ai || !o.ai.ground || o.ai.ally || o.dead || o.ko) continue;
      const k = Aim.kit(o), p = k.search;
      if (!p || p.broken) continue;
      const d = Math.hypot(o.x - v.x, o.y - v.y, o.z - v.z);
      if (d < p.def.searchRadar.range && seesOver(o, tp, d)) add(o, o.x, o.y, o.z);
    }
    S.scanners = out;
  }

  // ---------------------------------------------------------------- commands
  const nameOf = (o) => (o.def ? 'Target drone' : o.remote ? o.name || 'Player' : 'Bandit');
  function nose0(v) { const a = v.pilot.F; return v.axis(a.x, a.y, a.z); }
  // I (Shift+I back), a tap on the scope: the next target in sight, by angle off the nose; past either end, auto
  function next(F, dir = 1) {
    const v = F.active;
    if (!v || !v.parts || !v.parts.length || F.groundAim || F.destroyed) return;
    const f = nose0(v), list = [];
    for (const c of Combat.candidates(v, 'air', F)) {
      const dx = c.x - v.x, dy = c.y - v.y, dz = c.z - v.z, d = Math.hypot(dx, dy, dz) || 1;
      if (!seen(v, c.ref, d)) continue;
      list.push({ ref: c.ref, d, a: Math.acos(clamp((dx * f.x + dy * f.y + dz * f.z) / d, -1, 1)) });
    }
    list.sort((a, b) => a.a - b.a);
    const i = S.pick ? list.findIndex((c) => c.ref === S.pick) : -1, j = i < 0 ? (dir > 0 ? 0 : list.length - 1) : i + (dir > 0 ? 1 : -1);
    const c = j >= 0 && j < list.length ? list[j] : null;
    S.pick = c ? c.ref : null;
    Combat.S.cand = Combat.S.lock = null; Combat.S.lockT = 0;
    if (F.toast) F.toast(c ? `Target: ${nameOf(c.ref)} ${fmt.dist(c.d)}` : list.length ? 'Target: auto (nearest the nose)' : 'No targets in sight');
    Sound.click();
  }
  // O: the radar off (silent: their warning receivers can't hear it) or on again
  function toggle(F) {
    const v = F.active;
    if (!v || !aboard(v) || F.groundAim || F.destroyed || v.down) return;
    v.radarOff = !v.radarOff;
    if (F.toast) F.toast(v.radarOff ? 'Radar off: silent. Their warning receivers can\'t hear you' : 'Radar on');
    if (v.radarOff) {
      clearPic(true);
      const cs = Combat.systems(v)[v.wsel];
      if (cs && cs.w.radar) { Combat.S.lock = Combat.S.cand = null; Combat.S.lockT = 0; }
    }
    S.rcT = 0; // (on again: a scan at once)
    if (typeof MP !== 'undefined' && typeof MP.sendRadar === 'function') MP.sendRadar(!v.radarOff);
    Sound.click();
  }
  // a tap (CSS px): on the scope, the next target; else the nearest air marker within 30 px. True if it was ours.
  function tap(F, cx, cy) {
    const v = F.active, B = Combat.S.rwrBox;
    if (!v || F.groundAim || F.destroyed) return false;
    if (B && B.rad && Math.hypot(cx - B.x, cy - B.y) < B.R) { next(F, 1); return true; }
    let best = null, bd = 30;
    for (const m of S.marks) { const d = Math.hypot(m.x - cx, m.y - cy); if (d < bd) { bd = d; best = m; } }
    if (!best) return false;
    S.pick = best.ref;
    Combat.S.cand = Combat.S.lock = null; Combat.S.lockT = 0;
    const tp = Combat.refPos(best.ref);
    if (F.toast && tp) F.toast(`Target: ${nameOf(best.ref)} ${fmt.dist(Math.hypot(tp.x - v.x, tp.y - v.y, tp.z - v.z))}`);
    Sound.click();
    return true;
  }
  const mark = (ref, x, y) => { S.marks.push({ ref, x, y }); };
  const beginFrame = () => { S.marks.length = 0; S.gunIn = false; };
  // a held radar lock lost (notch, range, cone, the ground, chaff): LOST on the scope for a second and a low tone
  function lost(F) { S.lostT = F.time || 0; Sound.tone(380, 0.12, 0.04); }
  // the weapon chip for an air radar missile: 'ok', 'off', 'none' (no radar aboard), 'guns' (only radars that guide
  // nothing) or 'out' (every radar broken)
  function chipState(v, cur) {
    if (v.radarOff) return 'off';
    if (mainRadar(v)) return 'ok';
    if (!aboard(v)) return 'none';
    return radars(v).some((r) => works(r.p) && !r.R.warn) ? 'guns' : 'out';
  }
  // the RDR pill's words
  function pill(v) {
    if (v.radarOff) return 'RDR OFF';
    if (!radars(v).some((r) => works(r.p))) return 'RDR OUT';
    const b = bestRadar(v);
    return 'RDR ' + (b ? b.R.kind : 'TAIL');
  }
  // The controller's call as a solo bandit spawns: "Bandit inbound: 14 km, your 10 o'clock" (12 ahead, 3 right).
  function clock(v, x, y, z) {
    const r = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r, f0 = nose0(v), fu = f0.x * ux + f0.y * uy + f0.z * uz;
    let fx = f0.x - ux * fu, fy = f0.y - uy * fu, fz = f0.z - uz * fu;
    if (Math.hypot(fx, fy, fz) < 1e-3) { const b = v.axis(-1, 0, 0); fx = b.x; fy = b.y; fz = b.z; } // (straight up or down: the belly's way)
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    const rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux; // (forward × up: the right)
    const dx = x - v.x, dy = y - v.y, dz = z - v.z, a = Math.atan2(dx * rx + dy * ry + dz * rz, dx * fx + dy * fy + dz * fz);
    return ((Math.round(a / (Math.PI / 6)) % 12) + 12) % 12 || 12;
  }
  function call(F, v, b) {
    if (!F.toast || !v || !b) return;
    F.toast(`Bandit inbound: ${fmt.dist(Math.hypot(b.x - v.x, b.y - v.y, b.z - v.z))}, your ${clock(v, b.x, b.y, b.z)} o'clock`, 'warn');
  }
  function reset() {
    clearPic(false);
    S.rcT = 0; S.rcN = 0; S.los = new Map(); S.locks.length = 0; S.lkT = 0; S.scT = 0; S.heard = new WeakSet(); S.marks.length = 0; S.gunIn = false;
    S.lostT = -9; S.chirpT = -9; S.chirpAt = 0; S.sixT = 0; S.said = {}; S.stM = new WeakMap();
    now = 0;
  }

  return {
    S, step, reset, sees, has, eye, seen, aboard, radars, works, rk, mainRadar, guideRange, radarOf, bestRadar, lockTime, guided, busy, heard,
    next, toggle, tap, mark, beginFrame, lost, chipState, pill, call, clock,
    get now() { return now; },
    _t: { seesOver, stealth, scan, lockers, scanners, LOS_TOP, NONE },
  };
})();
