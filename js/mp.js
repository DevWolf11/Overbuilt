'use strict';
// Multiplayer: the session, the match and the shared world.
// One player hosts (their browser is the room, see net.js); the host's copy of the session `state` is the
// truth and goes out to everyone on every change. Each player flies their own craft and sends snapshots of it;
// everyone else shows it as a "remote" Vessel (remote = the owner's player id) posed from those snapshots and
// never stepped by the physics. Hits are decided by the shooter, against the craft as the shooter saw it:
// rounds and blasts that reach someone else's craft become a `hit` message (part ids and damage) that its
// owner applies. Explosions are also sent (`boom`) so everyone sees them.
//
// Modes: 'sandbox' (free play, up to 5) and 'pvp' (1v1, 2v2, 3v3 or free-for-all: lobby -> build ->
// [test -> polish] -> battle -> results).

const MP_FORMATS = { '1v1': { teams: 2, n: 2 }, '2v2': { teams: 2, n: 4 }, '3v3': { teams: 2, n: 6 }, ffa: { teams: 0, n: 6 } };
const MP_DEFAULTS = { format: '1v1', build: 180, test: true, polish: 120, budget: 75000, carriers: true, ff: false, tod: 'day', limit: 900 };
const MP_CARRIER = { bonus: 1.3, span: 13, length: 16, mass: 12000 }; // more money, but the craft has to fit the deck and the catapult
const MP_KINDS_PVP = ['plane', 'heli', 'car'];
const MP_SNAP_MS = 1000 / 15, MP_PV_MS = 200, MP_HP_MS = 500;
const MP_MAX_PARTS = 600; // the most parts a craft in the shared world may have (bigger spawns are ignored)
const MP_TEAM_NAMES = ['Faroes', 'Shetland'];
// Where players start. Bases use EARTH.airfields (and the space centre's own runway); carriers EARTH.carriers.
const MP_SPAWNS = [
  { id: 'faroes', name: 'Faroes', kind: 'base', team: 0, desc: 'The space centre’s runway. Your team’s home field.' },
  { id: 'shetland', name: 'Shetland', kind: 'base', team: 1, airfield: 'shetland', desc: 'Sumburgh airfield at the south tip of Shetland.' },
  { id: 'scotland', name: 'Scotland', kind: 'base', team: -1, airfield: 'scotland', desc: 'Wick airfield on the north coast of Scotland.' },
  { id: 'carrierA', name: 'Carrier West', kind: 'carrier', team: 0, carrier: 'west', desc: 'Catapult launch from the sea west of the Faroes.' },
  { id: 'carrierB', name: 'Carrier East', kind: 'carrier', team: 1, carrier: 'east', desc: 'Catapult launch from the North Sea, east of Shetland.' },
  { id: 'carrierC', name: 'Carrier South', kind: 'carrier', team: -1, carrier: 'south', desc: 'Catapult launch off the coast of Scotland.' },
];

// Checks for what other players send (a broken or hostile peer must not be able to break our game).
const mpNums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const mpBody = (id) => (typeof id === 'string' && hasOwn(BODY_BY_ID, id) && BODY_BY_ID[id]) || null;
// A peer's spawn rows rebuilt clean, [id, type, x, y, rot, flip, z, att, skin]: unique ids, known parts, depth and
// paint as the builder allows them, att another id of the same craft (0: none) and never in a loop, skin 0 for
// the part's own look. Anything else in a row is dropped. null: not a craft we take.
function mpSpawnRows(list) {
  if (!Array.isArray(list) || list.length > MP_MAX_PARTS) return null;
  const rows = [], links = [], seen = new Set();
  for (const r of list) {
    if (!Array.isArray(r) || !Number.isSafeInteger(r[0]) || r[0] <= 0 || seen.has(r[0]) || typeof r[1] !== 'string' || !hasOwn(PARTS, r[1]) || !Number.isFinite(r[2]) || !Number.isFinite(r[3])) continue;
    const def = PARTS[r[1]];
    seen.add(r[0]);
    rows.push([r[0], r[1], clamp(r[2], -500, 500), clamp(r[3], -500, 500), (r[4] | 0) & 3, r[5] ? 1 : 0, cleanZ(r[6], def), 0, cleanSkin(r[8], def) || 0]);
    links.push(r[7]);
  }
  const ps = rows.map((q, i) => ({ id: q[0], att: Number.isSafeInteger(links[i]) && seen.has(links[i]) ? links[i] : null }));
  cleanAtt(ps); // (self links and loops)
  ps.forEach((p, i) => { rows[i][7] = p.att || 0; });
  return rows;
}

const MP = {
  active: false,
  state: null,
  peers: new Map(),    // pid -> { ghost, snap, design, gun: {}, lastSeen }
  myDesign: null,      // the design this player fights with (Builder.serialize format)
  spawnId: null,
  rwr: new Map(),      // pid -> time their radar lock on us was last reported
  missiles: new Map(), // our missiles in flight: shot -> id
  nextMissile: 1,

  get live() { return this.active && !!this.state; },
  get isHost() { return Net.isHost; },
  get me() { return this.state ? this.state.players.find((p) => p.pid === Net.me) : null; },
  get pvp() { return !!this.state && this.state.mode === 'pvp'; },
  get phase() { return this.state ? this.state.phase : null; },
  // the local craft is in the shared world (sandbox flights, PvP battle)
  get shared() { return this.live && Flight.running && !!Flight.mp && !Flight.mp.solo; },
  player(pid) { return this.state ? this.state.players.find((p) => p.pid === pid) : null; },
  nameOf(pid) { const p = this.player(pid); return p ? p.name : Net.names.get(pid) || `Player ${pid}`; },
  teamOf(pid) { const p = this.player(pid); return p ? p.team : -1; },
  ffa() { return this.pvp && this.state.format === 'ffa'; },
  // can a player hurt another? (sandbox: anyone; team battles: enemies, or friends with friendly fire on)
  hostile(a, b) {
    if (!this.state || a === b) return false;
    if (!this.pvp || this.ffa()) return true;
    return this.teamOf(a) !== this.teamOf(b) || !!this.state.settings.ff;
  },
  enemy(a, b) { return !!this.state && a !== b && (!this.pvp || this.ffa() || this.teamOf(a) !== this.teamOf(b)); },

  // ------------------------------------------------------------------ session
  myName() { return (store.get('rss.mp.name', '') || '').trim() || 'Pilot'; },
  async host(mode, transport) {
    const name = this.myName();
    await Net.host({ transport, name, maxPlayers: mode === 'sandbox' ? 5 : 6 });
    this.begin();
    this.state = {
      mode, phase: mode === 'sandbox' ? 'free' : 'lobby', ends: 0, endsLen: 0, round: 0, result: null,
      settings: { ...MP_DEFAULTS }, players: [], feed: [],
      t0: this.timeOfDay('day'), t0At: Net.hostNow(), // the sandbox's shared clock (sun and clouds)
    };
    this.addPlayer(1, name);
    this.push();
    return Net.code;
  },
  async join(code, transport, status) {
    await Net.join(code, { transport, name: this.myName(), status });
    this.begin();
    // the host's `state` follows the welcome
    return new Promise((resolve) => {
      const t0 = performance.now();
      const wait = () => { if (this.state || performance.now() - t0 > 8000 || !this.active) resolve(); else setTimeout(wait, 50); };
      wait();
    });
  },
  begin() {
    this.active = true;
    this.awake(true);
    this.state = null;
    this.peers.clear(); this.rwr.clear(); this.missiles.clear();
    this.myDesign = null; this.spawnId = null; this.feedSeen = 0; this.seenPhase = null; this.seenRound = null;
    this.pushCareer();
    if (!this.bound) this.bind();
    clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.tick(), 250); // keeps running in a background tab
  },
  // Leave the room (or it closed under us).
  end(reason) {
    if (!this.active) return;
    this.active = false;
    this.awake(false);
    clearInterval(this.tickTimer);
    Net.leave();
    this.dropAllGhosts();
    this.state = null;
    Builder.mp = null;
    this.popCareer();
    if (App.scene === 'flight') { Flight.stop(); Flight.mp = null; }
    UI.closeModal();
    MPUI.hide();
    App.toHome();
    if (reason) UI.toast(reason, 'warn');
  },
  // Builds in a match use their own money and never touch the player's career or saved blueprint.
  pushCareer() {
    if (this.savedCareer) return;
    this.savedCareer = { data: Career.data, save: Career.save, design: store.get('rss.design', null) };
    Career.data = { mode: 'sandbox', funds: 0, tier: TIERS.length - 1, done: {}, flights: 0 };
    Career.save = () => {};
  },
  popCareer() {
    const s = this.savedCareer;
    if (!s) return;
    Career.data = s.data; Career.save = s.save;
    this.savedCareer = null;
    store.set('rss.design', s.design);
    Builder.savedAs = null;
    if (s.design && s.design.parts && s.design.parts.length) {
      Builder.loadDesign(s.design);
      const e = s.design.savedAs && Builder.designs().find((x) => x.name === s.design.savedAs);
      if (e) Builder.markSaved(e);
    } else Builder.loadTemplate('hopper');
    Builder.buildPalette();
  },
  setMoney(budget) {
    if (!this.savedCareer) return;
    Career.data = budget == null ? { mode: 'sandbox', funds: 0, tier: TIERS.length - 1, done: {}, flights: 0 }
      : { mode: 'career', funds: budget, tier: TIERS.length - 1, done: {}, flights: 0 };
  },

  // Keep the screen on while in a room: a sleeping phone can't let friends in, and drops out of the room.
  // (The browser lets go of the lock when the game goes out of sight; it's taken again on the way back.)
  awake(on) {
    this.wantAwake = on;
    if (!on) { if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; } return; }
    if (this.wakeLock || !navigator.wakeLock || document.hidden) return;
    navigator.wakeLock.request('screen').then((l) => {
      if (!this.wantAwake || this.wakeLock) { l.release().catch(() => {}); return; }
      this.wakeLock = l;
      l.addEventListener('release', () => { if (this.wakeLock === l) this.wakeLock = null; });
    }).catch(() => {});
  },
  bind() {
    this.bound = true;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.wantAwake) this.awake(true); });
    Net.on('state', (m) => { if (!Net.isHost && m.f === 1) this.applyState(m.s); });
    Net.on('join', (m) => { if (Net.isHost && this.state) { this.addPlayer(m.pid, m.name); this.feed(`${m.name} joined`); this.push(); } });
    Net.on('leave', (m) => this.onLeave(m.pid));
    Net.on('closed', (m) => this.end(m.reason || 'The room closed'));
    Net.on('warn', (m) => UI.toast(m.text, 'warn'));
    Net.on('set', (m) => { if (Net.isHost) this.applySet(m.f, m.k, m.v); });
    Net.on('chat', (m) => MPUI.chat(m.f, m.text));
    // the shared world
    Net.on('spawn', (m) => this.onSpawn(m));
    Net.on('despawn', (m) => { this.dropGhost(m.f, false); this.peer(m.f).design = null; });
    Net.on('s', (m) => this.onSnap(m));
    Net.on('want', (m) => this.resendSpawn(m.f)); // someone sees our craft but missed its spawn (joined later)
    Net.on('pv', (m) => this.onPartVis(m));
    Net.on('parts', (m) => this.onParts(m));
    Net.on('hp', (m) => this.onHp(m));
    Net.on('down', (m) => this.onDown(m));
    Net.on('gun', (m) => { const P = this.peers.get(m.f); if (P) P.gun[m.k] = !!m.on; });
    Net.on('hit', (m) => this.onHit(m));
    Net.on('boom', (m) => this.onBoom(m));
    Net.on('shot', (m) => { const P = this.peers.get(m.f); if (P && P.ghost && Flight.running) Combat.netShot(P.ghost, m); });
    Net.on('msl', (m) => this.onMissile(m));
    Net.on('mp', (m) => Combat.netMissileUpdate(m.f, m.id, m));
    Net.on('mx', (m) => Combat.netMissileEnd(m.f, m.id));
    Net.on('cm', (m) => { const P = this.peers.get(m.f); if (P && P.ghost && Flight.running) Combat.netFlares(P.ghost, m); });
    Net.on('lock', (m) => { if (m.on) this.rwr.set(m.f, performance.now()); else this.rwr.delete(m.f); });
  },

  // ------------------------------------------------------------------ host: roster and settings
  addPlayer(pid, name) {
    const s = this.state;
    if (!s || s.players.some((p) => p.pid === pid)) return;
    const p = { pid, name, team: 0, ready: false, spawn: null, alive: false, kills: 0, deaths: 0, dmg: 0, ping: 0, kind: 'plane', flying: false };
    if (s.mode === 'pvp') {
      if (s.format === 'ffa') p.team = pid;
      else { const n0 = s.players.filter((q) => q.team === 0).length, n1 = s.players.filter((q) => q.team === 1).length; p.team = n1 < n0 ? 1 : 0; }
    }
    s.players.push(p);
  },
  onLeave(pid) {
    this.dropGhost(pid, true);
    this.peers.delete(pid);
    this.rwr.delete(pid);
    if (!Net.isHost || !this.state) return;
    const p = this.player(pid);
    this.state.players = this.state.players.filter((q) => q.pid !== pid);
    if (p) this.feed(`${p.name} left`);
    if (this.state.phase === 'battle') this.checkWin();
    if (this.state.phase === 'build' || this.state.phase === 'polish') this.maybeAllReady();
    this.push();
  },
  // a change to one player's own row (team, ready, spawn) or a host setting
  applySet(pid, k, v) {
    const s = this.state, p = this.player(pid);
    if (!s || !p) return;
    if (k === 'ready') p.ready = !!v;
    else if (k === 'spawn') { if (this.spawnsFor(p).some((sp) => sp.id === v)) p.spawn = v; }
    else if (k === 'kind') p.kind = String(v).slice(0, 8);
    else if (k === 'flying') p.flying = !!v;
    else if (k === 'team') { if (s.phase === 'lobby' && s.mode === 'pvp' && s.format !== 'ffa' && (v === 0 || v === 1)) p.team = v; }
    else if (k === 'name') p.name = String(v).slice(0, 18) || p.name;
    else if (k === 'dmg') { if (s.phase === 'battle' || s.mode === 'sandbox') this.addDamage(pid, clamp(+v || 0, 0, 20000)); }
    else return;
    if (s.phase === 'build' || s.phase === 'polish') this.maybeAllReady();
    this.push();
  },
  setMine(k, v) {
    if (!this.live) return;
    if (Net.isHost) this.applySet(Net.me, k, v);
    else { const p = this.me; if (p) { p[k] = v; MPUI.refresh(); } Net.send({ t: 'set', k, v }, 1); }
  },
  setSetting(k, v) {
    if (!Net.isHost || !this.state || this.state.phase !== 'lobby') return;
    const s = this.state;
    if (k === 'format') {
      if (!MP_FORMATS[v]) return;
      s.settings.format = v; s.format = v;
      // re-deal teams for the new format
      s.players.forEach((p, i) => { p.team = v === 'ffa' ? p.pid : i % 2; });
    } else s.settings[k] = v;
    this.push();
  },
  // host: send the session to everyone (and apply it here)
  push() {
    const s = this.state;
    if (!s) return;
    for (const p of s.players) p.ping = Net.pings.get(p.pid) || 0;
    s.format = s.settings.format;
    Net.send({ t: 'state', s });
    this.applyState(s);
  },
  feed(text) {
    const s = this.state;
    if (!s) return;
    s.feed.push({ n: (s.feedN = (s.feedN || 0) + 1), text });
    if (s.feed.length > 12) s.feed.shift();
  },

  // ------------------------------------------------------------------ everyone: react to the session
  applyState(s) {
    const prev = this.state, prevPhase = this.seenPhase || null, prevRound = this.seenRound ?? -1; // (the host's state is edited in place)
    this.state = Net.isHost ? s : JSON.parse(JSON.stringify(s));
    const me = this.me;
    if (!me) { if (!Net.isHost && this.active && prev) this.end('You were removed from the room'); return; }
    const ids = new Set(this.state.players.map((p) => p.pid));
    for (const pid of [...this.peers.keys()]) if (!ids.has(pid)) { this.dropGhost(pid, true); this.peers.delete(pid); this.rwr.delete(pid); }
    // kill feed and chat-like notices
    for (const f of this.state.feed) if (f.n > (this.feedSeen || 0)) { this.feedSeen = f.n; MPUI.notice(f.text); }
    if (this.state.phase !== prevPhase || this.state.round !== prevRound) {
      this.seenPhase = this.state.phase; this.seenRound = this.state.round;
      this.onPhase(prevPhase, this.state.phase);
    }
    MPUI.refresh();
  },
  onPhase(from, to) {
    const s = this.state;
    Net.lock(s.mode === 'pvp' && to !== 'lobby', 'A battle is in progress: wait for it to finish');
    switch (to) {
      case 'lobby':
        this.leaveFlight();
        UI.closeModal();
        this.myDesign = null;
        App.showMP();
        break;
      case 'free':
        if (!from || from === 'lobby') App.showMP();
        break;
      case 'build':
        this.spawnId = this.me.spawn || this.defaultSpawn();
        if (this.me.spawn !== this.spawnId) this.setMine('spawn', this.spawnId);
        this.enterBuild(true);
        break;
      case 'test':
        this.startFlight(true);
        break;
      case 'polish':
        UI.closeModal();
        this.leaveFlight();
        this.enterBuild(false);
        UI.toast('Test flight over: polish your design');
        break;
      case 'battle':
        this.startFlight(false);
        break;
      case 'results':
        MPUI.results(s.result);
        break;
    }
  },

  // ------------------------------------------------------------------ host: running the match
  startMatch() {
    const s = this.state;
    if (!Net.isHost || !s || s.mode !== 'pvp' || s.phase !== 'lobby') return;
    s.round++;
    for (const p of s.players) Object.assign(p, { ready: false, alive: false, kills: 0, deaths: 0, dmg: 0, spawn: null, flying: false });
    s.result = null;
    s.feed.length = 0;
    this.setPhase('build', s.settings.build);
  },
  setPhase(phase, seconds) {
    const s = this.state;
    s.phase = phase;
    s.ends = seconds ? Net.hostNow() + seconds * 1000 : 0;
    s.endsLen = seconds || 0;
    s.allReadyAt = 0;
    if (phase === 'build' || phase === 'polish') for (const p of s.players) p.ready = false;
    if (phase === 'battle') { for (const p of s.players) { p.alive = true; p.flying = false; } s.battleAt = Net.hostNow(); s.tod = this.timeOfDay(s.settings.tod); s.sides = [...new Set(s.players.map((p) => p.team))]; }
    if (phase === 'test') s.tod = this.timeOfDay(s.settings.tod);
    this.push();
  },
  // everyone ready: the phase ends 3 seconds later
  maybeAllReady() {
    const s = this.state, all = s.players.length && s.players.every((p) => p.ready);
    if (!all && s.allReadyAt) { s.allReadyAt = 0; s.ends = s.endsFull || s.ends; return; } // someone changed their mind
    if (!all || s.allReadyAt) return;
    s.allReadyAt = Net.hostNow(); s.endsFull = s.ends;
    s.ends = Math.min(s.ends || Infinity, Net.hostNow() + 3000);
  },
  // host clock tick (wall clock: keeps going in a background tab)
  tick() {
    if (!this.live) return;
    if (Net.isHost) {
      const s = this.state, now = Net.hostNow();
      if (s.ends && now >= s.ends) this.advance();
      // refresh pings in the lobby now and then
      if ((s.phase === 'lobby' || s.phase === 'free') && now - (this.pingPushed || 0) > 4000) { this.pingPushed = now; this.push(); }
    }
    // clients report the damage they dealt about once a second (the host keeps the score)
    if (!Net.isHost && this.dmgOut > 0 && performance.now() - (this.dmgSent || 0) > 1000) {
      this.dmgSent = performance.now();
      Net.send({ t: 'set', k: 'dmg', v: Math.round(this.dmgOut) }, 1);
      this.dmgOut = 0;
    }
    MPUI.tick();
  },
  advance() {
    const s = this.state, st = s.settings;
    switch (s.phase) {
      case 'build': if (st.test) this.setPhase('test', 60); else this.setPhase('battle', st.limit); break;
      case 'test': this.setPhase('polish', st.polish); break;
      case 'polish': this.setPhase('battle', st.limit); break;
      case 'battle': this.finish(null, 'time'); break;
    }
  },
  // host: is it over? (one team, or one player in a free-for-all, left flying)
  checkWin() {
    const s = this.state;
    if (!Net.isHost || !s || s.phase !== 'battle' || this.finishing) return;
    const teams = new Set(s.players.filter((p) => p.alive).map((p) => p.team));
    const started = new Set(s.sides || s.players.map((p) => p.team));
    if (teams.size > 1 || (started.size <= 1 && teams.size === 1)) return;
    this.finishing = true;
    setTimeout(() => { this.finishing = false; this.finish(teams.size ? [...teams][0] : null, 'last'); }, 3500);
  },
  finish(winner, why) {
    const s = this.state;
    if (!s || s.phase !== 'battle') return;
    if (why === 'time') { // the side with the most players still flying (then kills) wins; otherwise a draw
      const score = new Map();
      for (const p of s.players) { const sc = score.get(p.team) || [0, 0]; sc[0] += p.alive ? 1 : 0; sc[1] += p.kills; score.set(p.team, sc); }
      const ranked = [...score].sort((a, b) => b[1][0] - a[1][0] || b[1][1] - a[1][1]);
      winner = ranked.length > 1 && (ranked[0][1][0] !== ranked[1][1][0] || ranked[0][1][1] !== ranked[1][1][1]) ? ranked[0][0] : null;
    }
    s.result = { winner, why, ffa: s.format === 'ffa', players: s.players.map((p) => ({ ...p })) };
    this.setPhase('results', 0);
  },
  backToLobby() {
    if (!Net.isHost || !this.state) return;
    const s = this.state;
    s.result = null;
    for (const p of s.players) Object.assign(p, { ready: false, alive: false, flying: false });
    this.setPhase(s.mode === 'pvp' ? 'lobby' : 'free', 0);
  },

  // ------------------------------------------------------------------ spawns, money and limits
  spawnsFor(p) {
    const s = this.state;
    if (!s || !p) return [];
    const ffa = s.format === 'ffa';
    return MP_SPAWNS.filter((sp) => (sp.kind !== 'carrier' || s.settings.carriers) && (ffa ? true : sp.team === p.team));
  },
  defaultSpawn() {
    const p = this.me, list = this.spawnsFor(p);
    if (this.ffa()) { // spread out: the base the fewest others picked
      const used = new Map();
      for (const q of this.state.players) if (q.spawn) used.set(q.spawn, (used.get(q.spawn) || 0) + 1);
      const bases = list.filter((sp) => sp.kind === 'base').sort((a, b) => (used.get(a.id) || 0) - (used.get(b.id) || 0) || ((Net.me + MP_SPAWNS.indexOf(a)) % 3) - ((Net.me + MP_SPAWNS.indexOf(b)) % 3));
      return (bases[0] || list[0]).id;
    }
    return (list.find((sp) => sp.kind === 'base') || list[0]).id;
  },
  spawnDef(id) { return MP_SPAWNS.find((sp) => sp.id === id) || MP_SPAWNS[0]; },
  budgetFor(spawnId) {
    const s = this.state;
    if (!this.pvp) return null;
    return Math.round(s.settings.budget * (this.spawnDef(spawnId).kind === 'carrier' ? MP_CARRIER.bonus : 1));
  },
  limitsFor(spawnId) { return this.pvp && this.spawnDef(spawnId).kind === 'carrier' ? MP_CARRIER : null; },
  // The size of a design: span across (wings, pods wherever they hang), length along, mass.
  measure(parts) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, mass = 0;
    for (const p of parts) {
      const r = partRect(p), d = p.def, half = d.twinZ ? Math.max(d.w, 0.6) / 2 : partDepth(p) / 2; // (each of a pair, pylon and all)
      x0 = Math.min(x0, r.l); x1 = Math.max(x1, r.r); y0 = Math.min(y0, r.b); y1 = Math.max(y1, r.t);
      for (const z of partZs(p)) { z0 = Math.min(z0, z - half); z1 = Math.max(z1, z + half); }
      mass += partKg(p);
    }
    return { span: z1 > z0 ? z1 - z0 : 0, length: Math.max(y1 - y0, 0), height: Math.max(x1 - x0, 0), mass };
  },
  // problems with a design for the current match (shown in the builder's stats, and checked before flying)
  designProblems(stats, parts, kind) {
    const out = [];
    if (parts.length > MP_MAX_PARTS) out.push(`Too many parts for the shared world: ${parts.length}, the most is ${MP_MAX_PARTS}.`);
    if (!this.pvp) return out;
    const budget = this.budgetFor(this.spawnId);
    if (stats.cost > budget) out.push(`Over budget by ${money(stats.cost - budget)}: remove parts or pick cheaper ones.`);
    if (!MP_KINDS_PVP.includes(kind)) out.push('Battles are for planes, helicopters and cars: switch the vehicle type.');
    const L = this.limitsFor(this.spawnId);
    if (L && parts.length) {
      const m = this.measure(parts);
      if (kind !== 'plane' && kind !== 'heli') out.push('Only planes and helicopters fly from a carrier.');
      if (m.span > L.span) out.push(`Too wide for the carrier: ${m.span.toFixed(1)} m across, the deck takes ${L.span} m.`);
      if (m.length > L.length) out.push(`Too long for the carrier: ${m.length.toFixed(1)} m, the deck takes ${L.length} m.`);
      if (m.mass > L.mass) out.push(`Too heavy for the catapult: ${fmt.mass(m.mass)}, it takes ${fmt.mass(L.mass)}.`);
    }
    return out;
  },
  // a design that flies in this match: the player's, if it passes, or a stock one that fits the budget
  battleDesign() {
    const d = this.myDesign || Builder.serialize();
    const parts = partsFromDesign(d.parts); // (as Flight.start will build it: depth, paint and attachments)
    const ctrl = findControlPart(parts);
    const keep = ctrl ? componentOf(ctrl.id, buildAdjacency(parts)) : new Set(), used = parts.filter((p) => keep.has(p.id)); // (loose parts stay behind)
    if (ctrl && !this.designProblems({ cost: designCost(used) }, used, d.kind).length) return d;
    const stock = ['mustang', 'camel', 'skylark'].map((k) => TEMPLATES[k]).find((t) => {
      const ps = partsFromDesign(templateRows(t));
      return !this.designProblems({ cost: designCost(ps) }, ps, t.kind).length;
    }) || TEMPLATES.camel;
    UI.toast(`Your design can’t fly in this battle: you get a ${stock.name} instead`, 'warn');
    return { name: stock.name, kind: stock.kind, parts: templateRows(stock) };
  },
  // A time of day for the match: the sun's height over the islands (degrees) for day, dusk and night.
  timeOfDay(tod) {
    const want = { day: 40, dusk: 4, night: -25 }[tod] ?? 40;
    const T = EARTH.period || TAU * Math.sqrt(EARTH.orbitRadius ** 3 / SUN.mu);
    const up = surfaceFrame(Math.cos(EARTH.padAngle), Math.sin(EARTH.padAngle), 0).up;
    let best = 0, err = Infinity;
    for (let i = 0; i < 720; i++) {
      const t = (i / 720) * T, bp = bodyPos(EARTH, t), r = Math.hypot(bp.x, bp.y, bp.z || 0) || 1;
      const el = Math.asin(clamp(-(bp.x * up.x + bp.y * up.y + (bp.z || 0) * up.z) / r, -1, 1)) * (180 / Math.PI);
      // prefer the morning side, so dusk comes later rather than sooner
      const e = Math.abs(el - want);
      if (e < err) { err = e; best = t; }
    }
    return best;
  },

  // ------------------------------------------------------------------ the local player's flights
  // App.launch in a match: sandbox flies into the shared world; in a PvP build it means "ready".
  launch() {
    if (!this.live) return false;
    if (this.pvp) {
      if (this.phase === 'build' || this.phase === 'polish') { this.toggleReady(); return true; }
      UI.toast('Wait for the next phase'); return true;
    }
    const probs = this.designProblems(Builder.statsData, Builder.parts.filter((p) => Builder.attached.has(p.id)), Builder.kind);
    if (probs.length) { UI.toast(probs[0], 'warn'); return true; } // (too big for the others to see)
    this.myDesign = Builder.serialize();
    this.startFlight(false);
    return true;
  },
  toggleReady() {
    const me = this.me;
    if (!me) return;
    if (!me.ready) {
      this.myDesign = Builder.serialize();
      const probs = this.designProblems(Builder.statsData, Builder.parts.filter((p) => Builder.attached.has(p.id)), Builder.kind);
      if (!Builder.ctrl) { UI.toast('Add a cockpit or command part first'); return; }
      if (probs.length) { UI.toast(probs[0], 'warn'); return; }
    }
    this.setMine('ready', !me.ready);
  },
  enterBuild(first) {
    const s = this.state;
    Builder.mp = { budget: this.budgetFor(this.spawnId), limits: this.limitsFor(this.spawnId), kinds: MP_KINDS_PVP };
    Builder.renderKind();
    this.setMoney(Builder.mp.budget);
    if (App.scene !== 'build') App.toBuild();
    if (first && !MP_KINDS_PVP.includes(Builder.kind)) Builder.setKind && Builder.setKind('plane');
    Builder.buildPalette(); Builder.changed(true);
    if (first && s.mode === 'pvp') setTimeout(() => MPUI.openSpawnMap(), 400);
  },
  // Fly: a test flight (alone) or into the shared world (sandbox, battle).
  startFlight(solo) {
    const s = this.state;
    UI.closeModal(); MPUI.closeSpawnMap();
    if (App.scene === 'flight' || Flight.running) { if (Flight.running && Flight.mp && !Flight.mp.solo) Net.send({ t: 'despawn' }); Flight.stop(); this.dropAllGhosts(); }
    let design;
    if (this.pvp) {
      this.myDesign = Builder.mp ? Builder.serialize() : this.myDesign;
      design = this.battleDesign();
      this.myDesign = design;
    } else design = this.myDesign || Builder.serialize();
    const kind = hasOwn(VEHICLE_KINDS, design.kind) ? design.kind : 'plane';
    const place = this.placement(this.pvp ? this.spawnId || this.defaultSpawn() : null, kind);
    const time = this.pvp ? (s.tod || 0) + Math.max(0, (Net.hostNow() - (s.battleAt || Net.hostNow())) / 1000) : this.sandboxTime();
    App.afterEarth(() => {
      if (!this.live) return;
      App.showScene('flight');
      Flight.start(design, { place, time, mp: { mode: s.mode, solo: !!solo, phase: s.phase } });
      Builder.mp = null;
      if (!solo) { this.sendSpawn(); this.setMine('flying', true); if (this.pvp) this.setMine('kind', kind); }
      MPUI.refresh();
      const tip = place && place.carrier ? 'Throttle up, then hit LAUNCH (L) for the catapult' : null;
      if (solo) UI.toast('Test flight: one minute, nobody can hurt you');
      else if (this.pvp) UI.toast(tip || 'Battle! Last team flying wins');
      else if (tip) UI.toast(tip);
    });
  },
  // sandbox: a fresh craft at the start (the old one goes, as if it crashed out of sight)
  respawn() {
    if (!this.live || this.pvp) return;
    if (Flight.running && !Flight.destroyed && Flight.mp && !Flight.mp.solo) Net.send({ t: 'despawn' });
    this.startFlight(false);
  },
  // sandbox: everyone shares the host's clock so the sun and the clouds agree
  sandboxTime() { return this.state && this.state.t0 != null ? this.state.t0 + (Net.hostNow() - this.state.t0At) / 1000 : 0; },
  leaveFlight() {
    if (App.scene !== 'flight' && !Flight.running) return;
    if (Flight.running && Flight.mp && !Flight.mp.solo) { Net.send({ t: 'despawn' }); if (!this.pvp) this.setMine('flying', false); }
    Flight.stop();
    this.dropAllGhosts();
    Combat.reset(Flight);
  },
  // Where a craft starts for a spawn point (PvP) or the normal sites (sandbox): placement for Flight.start.
  placement(spawnId, kind) {
    if (!spawnId) { // sandbox: the usual pad, runway or helipad, a little apart so craft don't start inside each other
      const slot = Math.max(0, this.state.players.map((p) => p.pid).sort((a, b) => a - b).indexOf(Net.me));
      if (!slot) return null;
      if (kind === 'plane' || kind === 'car') return { e: EARTH.sites.runway.east + slot * 220, z: 0, yaw: 0, soft: true };
      if (kind === 'heli') return { e: EARTH.sites.helipad.east + (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 35, z: 0, yaw: 0, soft: true };
      return null; // rockets share the pad
    }
    const sp = this.spawnDef(spawnId);
    const mates = this.state.players.filter((p) => (p.spawn || null) === spawnId).map((p) => p.pid).sort((a, b) => a - b);
    const slot = Math.max(0, mates.indexOf(Net.me));
    if (sp.kind === 'carrier') return carrierPlacement(EARTH.carriers[sp.carrier], slot, kind);
    if (sp.id === 'faroes') {
      if (kind === 'heli') return { e: EARTH.sites.helipad.east + slot * 40, z: slot * 30, yaw: 0 };
      return { e: EARTH.sites.runway.east + slot * 230, z: 0, yaw: 0 };
    }
    return airfieldPlacement(EARTH.airfields[sp.airfield], slot, kind);
  },

  // ------------------------------------------------------------------ the shared world: our craft
  sendSpawn() {
    const v = Flight.active;
    if (!v) return;
    this.lastParts = v.parts.length;
    this.sent = { s: 0, pv: 0, hp: 0, hpSig: '' };
    const ids = new Set(v.parts.map((p) => p.id)); // att: the host's id (ghosts keep ours), 0 for none or a host gone
    this.spawnMsg = { t: 'spawn', name: v.name, kind: v.kind, parts: v.parts.map((p) => [p.id, p.type, +p.x.toFixed(3), +p.y.toFixed(3), p.rot || 0, p.flip ? 1 : 0,
      +partZ(p).toFixed(3), p.att != null && p.att !== p.id && ids.has(p.att) ? p.att : 0, p.skin || 0]) };
    Net.send(this.spawnMsg);
  },
  resendSpawn(pid) {
    const v = Flight.active;
    if (!this.shared || !this.spawnMsg || !v || Flight.destroyed) return;
    Net.send(this.spawnMsg, pid);
    Net.send({ t: 'parts', ids: v.parts.map((p) => p.id) }, pid);
    if (this.sent) { this.sent.hpSig = ''; this.sent.pvFull = 0; } // and the damage and moving parts, with the next updates
  },
  // after each Flight.update: snapshots of our craft, at fixed wall-clock rates
  afterUpdate() {
    if (!this.shared) return;
    const v = Flight.active, now = performance.now(), S = this.sent;
    if (!v || !S) return;
    if (Flight.destroyed || !v.parts.length) return;
    if (v.parts.length !== this.lastParts) { this.lastParts = v.parts.length; Net.send({ t: 'parts', ids: v.parts.map((p) => p.id) }); }
    if (now - S.s >= MP_SNAP_MS) {
      S.s = now;
      const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 1e4) / 1e4;
      Net.send({ t: 's', th: Math.round(Net.hostNow()), b: v.body.id, P: [r2(v.x), r2(v.y), r2(v.z)], V: [r2(v.vx), r2(v.vy), r2(v.vz)],
        Q: [r4(v.q.w), r4(v.q.x), r4(v.q.y), r4(v.q.z)], W: [r4(v.av.x), r4(v.av.y), r4(v.av.z)], C: [r4(v.com.x), r4(v.com.y), r4(v.com.z || 0)],
        g: v.gearUp ? 1 : 0, l: v.landed ? 1 : 0 });
    }
    if (now - S.pv >= MP_PV_MS) { // moving parts: only those that changed (all of them every 2 s)
      S.pv = now;
      const full = now - (S.pvFull || 0) > 2000, list = [];
      if (full) S.pvFull = now;
      if (!S.pvSig) S.pvSig = new Map();
      for (const p of v.parts) {
        const d = p.def;
        if (!(d.wing || d.thrust || d.weapon || d.chute || (d.wheel && d.wheel.retract))) continue;
        const row = [p.id, Math.round((p.deflect || 0) * 100) / 100, Math.round((p.firing || 0) * 100) / 100, Math.round((p.ab || 0) * 100) / 100,
          p.retracted ? 1 : 0, p.sweep != null ? Math.round(p.sweep * 100) / 100 : null, Math.round((p.aimYaw || 0) * 100) / 100, Math.round((p.aimEl || 0) * 100) / 100,
          p.ammo == null ? null : p.ammo, Math.round((p.deployed || 0) * 100) / 100, p.used ? 1 : 0, p.gunOn ? 1 : 0];
        const sig = row.join();
        if (!full && S.pvSig.get(p.id) === sig) continue;
        S.pvSig.set(p.id, sig);
        list.push(row);
      }
      if (list.length) Net.send({ t: 'pv', list });
    }
    if (now - S.hp >= MP_HP_MS) {
      S.hp = now;
      const list = [];
      for (const p of v.parts) if (p.hp != null) list.push([p.id, Math.round(Combat.hpFrac(p) * 100)]);
      const sig = list.join(';');
      if (sig !== S.hpSig) { S.hpSig = sig; Net.send({ t: 'hp', list }); }
    }
  },
  // our craft is gone (Flight.onDestroyed): tell everyone, and who did it
  onLocalDestroyed() {
    if (this.live && Flight.mp && Flight.mp.solo) { // a test flight: try again while the clock runs
      setTimeout(() => {
        if (!this.live || this.phase !== 'test' || App.scene !== 'flight' || !Flight.destroyed) return;
        UI.modal({ kicker: 'Test flight', title: 'Craft lost', body: '<p>Only a test: nothing is lost. Try again, or wait for the polish phase to fix what broke.</p>',
          actions: [{ label: 'Fly again', primary: true, onClick: () => { if (this.phase === 'test') this.startFlight(true); } }] });
      }, 1400);
      return true;
    }
    if (!this.shared) return false;
    const v = Flight.active, s = this.state;
    const by = v.lastHitBy && v.lastHitBy.remote && Flight.time - (v.lastHitAt || -99) < 20 ? v.lastHitBy.remote : 0;
    const P = v.toWorld(v.com.x, v.com.y, v.com.z || 0);
    Net.send({ t: 'down', by, P: [P.x, P.y, P.z] });
    if (Net.isHost) this.recordDown(Net.me, by);
    if (!this.pvp) { // sandbox: back to the hangar or fly again
      setTimeout(() => {
        if (!this.live || App.scene !== 'flight' || !Flight.destroyed) return;
        UI.modal({ kicker: by ? `Shot down by ${this.nameOf(by)}` : 'Crashed', title: 'Craft lost', body: Flight.summaryHTML(),
          actions: [{ label: 'Back to hangar', onClick: () => { this.leaveFlight(); App.toBuild(); } }, { label: 'Fly again', primary: true, onClick: () => this.startFlight(false) }] });
      }, 1600);
      return true;
    }
    // a battle: watch the others until it's over
    Flight.ended = false;
    setTimeout(() => { if (this.live && Flight.destroyed) { MPUI.spectate(1); UI.toast(`${by ? `Shot down by ${this.nameOf(by)}` : 'You crashed'}. Spectating (${isTouch ? 'tap' : '[ ]'} to switch)`, 'warn'); } }, 1800);
    return true;
  },
  // host: book-keeping for a craft lost
  recordDown(pid, by) {
    const s = this.state, p = this.player(pid);
    if (!s || !p || !p.flying) return;
    p.flying = false;
    if (s.phase === 'battle') p.alive = false;
    p.deaths++;
    const k = by && by !== pid ? this.player(by) : null;
    if (k) { k.kills++; this.feed(`${k.name} ⟶ ${p.name}`); } else this.feed(`${p.name} crashed`);
    if (s.phase === 'battle') this.checkWin();
    this.push();
  },

  // ------------------------------------------------------------------ the shared world: everyone else
  peer(pid) {
    let P = this.peers.get(pid);
    if (!P) { P = { ghost: null, snap: null, gun: {}, design: null }; this.peers.set(pid, P); }
    return P;
  },
  onSpawn(m) {
    const parts = mpSpawnRows(m.parts);
    if (!parts) return;
    const P = this.peer(m.f);
    this.dropGhost(m.f, false);
    P.design = { kind: typeof m.kind === 'string' && hasOwn(VEHICLE_KINDS, m.kind) ? m.kind : 'plane', parts }; // (never the raw message)
    P.snap = null;
    if (Flight.running && Flight.mp && !Flight.mp.solo) this.buildGhost(m.f);
    if (Net.isHost && this.state) { const p = this.player(m.f); if (p && !p.flying) { p.flying = true; this.push(); } }
  },
  buildGhost(pid) {
    const P = this.peers.get(pid);
    if (!P || !P.design || P.ghost) return;
    const parts = [];
    for (const [id, type, x, y, rot, flip, z, att, skin] of P.design.parts) { // (clean: see mpSpawnRows)
      const p = makePart(type, x, y, { flip: !!flip, rot, z, skin: skin || null });
      p.id = id; p.att = att || null;
      parts.push(p);
    }
    if (!parts.length) return;
    const v = new Vessel(parts, buildAdjacency(parts), EARTH); // (in depth, and along att: the owner's own joints)
    v.kind = hasOwn(VEHICLE_KINDS, P.design.kind) ? P.design.kind : 'plane';
    v.name = this.nameOf(pid);
    v.remote = pid;
    v.rebuildGroups();
    v.sas = 'off';
    for (const p of v.parts) if (p.def.weapon) p.ammo = p.def.weapon.ammo; // (kept in step by the owner's part states)
    v.hiddenUntilSnap = true;
    P.ghost = v;
    if (P.snap) this.poseGhost(P, 0, true);
  },
  // Take a player's craft out of our world (it comes back from their design and snapshots when we fly again).
  dropGhost(pid, boom) {
    const P = this.peers.get(pid);
    if (!P) return;
    if (P.ghost) {
      if (boom && Flight.running) { const g = P.ghost; FX.explosion(g.body, g.toWorld(g.com.x, g.com.y, g.com.z || 0), { x: g.vx * 0.3, y: g.vy * 0.3, z: g.vz * 0.3 }, 4, true); }
      P.ghost.dead = true;
      if (Flight.vessels) Flight.vessels = Flight.vessels.filter((v) => v !== P.ghost);
      if (Flight.spectate === P.ghost) { Flight.spectate = null; setTimeout(() => { if (this.live && Flight.destroyed && !Flight.spectate) MPUI.spectate(1); }, 1500); }
      P.ghost = null;
    }
    P.gun = {};
  },
  dropAllGhosts() {
    for (const pid of [...this.peers.keys()]) this.dropGhost(pid, false);
    if (Flight.vessels) Flight.vessels = Flight.vessels.filter((v) => !v.remote);
  },
  onSnap(m) {
    if (!mpNums(m.P, 3) || !mpNums(m.V, 3) || !mpNums(m.Q, 4) || !mpNums(m.W, 3) || !(mpNums(m.C, 3) || mpNums(m.C, 2)) || !Number.isFinite(m.th) || !mpBody(m.b)) return;
    if (!(Math.hypot(...m.Q) > 0.5)) return;
    const P = this.peer(m.f);
    P.snap = m; P.recv = performance.now();
    if (!P.design && this.shared && P.recv - (P.asked || 0) > 3000) { P.asked = P.recv; Net.send({ t: 'want' }, m.f); }
    if (!P.ghost && P.design && Flight.running && Flight.mp && !Flight.mp.solo) this.buildGhost(m.f);
  },
  // dead reckoning: where the owner's craft should be now, from its last snapshot; then ease the ghost there
  poseGhost(P, dt, snap) {
    const g = P.ghost, S = P.snap;
    if (!g || !S) return;
    if (S.b !== g.body.id) g.body = mpBody(S.b) || g.body;
    const age = clamp((Net.hostNow() - S.th) / 1000, 0, 0.75);
    const tx = S.P[0] + S.V[0] * age, ty = S.P[1] + S.V[1] * age, tz = S.P[2] + S.V[2] * age;
    const W = S.W, wl = Math.hypot(W[0], W[1], W[2]);
    let tq = quat(S.Q[0], S.Q[1], S.Q[2], S.Q[3]);
    if (wl > 1e-6) tq = qnorm(qmul(tq, qaxis(W[0] / wl, W[1] / wl, W[2] / wl, wl * age))); // body-frame spin
    const ex = tx - g.x, ey = ty - g.y, ez = tz - g.z, err = Math.hypot(ex, ey, ez);
    if (snap || g.hiddenUntilSnap || err > 60) { g.x = tx; g.y = ty; g.z = tz; g.q = tq; g.hiddenUntilSnap = false; }
    else {
      const k = Math.min(1, dt * 10);
      g.x += ex * k; g.y += ey * k; g.z += ez * k;
      g.q = qnorm(qslerp(g.q, tq, Math.min(1, dt * 14)));
    }
    g.vx = S.V[0]; g.vy = S.V[1]; g.vz = S.V[2];
    g.av = v3(W[0], W[1], W[2]);
    const c0 = g.com0 || (g.com0 = { ...g.com }), C = S.C; // (fuel moves it, but never off the craft: a forged one would move the hit boxes away)
    if (Math.hypot(C[0] - c0.x, C[1] - c0.y, (C[2] || 0) - (c0.z || 0)) <= (g.reach || 30) + 1) g.com = { x: C[0], y: C[1], z: C[2] || 0 };
    g.gearUp = !!S.g; g.landed = !!S.l;
    g.lastSeen = P.recv;
  },
  // before each Flight.update: put every ghost where it should be and make sure the flight lists it
  beforeUpdate(dt) {
    if (!this.shared) return;
    const list = Flight.vessels;
    for (const [pid, P] of this.peers) {
      try {
        if (!P.ghost && P.design && P.snap) this.buildGhost(pid);
        const g = P.ghost;
        if (!g) continue;
        if (performance.now() - (P.recv || 0) > 6000) { g.vx = g.vy = g.vz = 0; continue; } // silent: it stays where it was
        this.poseGhost(P, dt, false);
        if (!g.dead && g.parts.length && !list.includes(g)) list.push(g);
      } catch (e) { console.error(e); this.dropGhost(pid, false); P.design = null; P.snap = null; }
    }
    // radar locks time out
    for (const [pid, t] of this.rwr) if (performance.now() - t > 2500) this.rwr.delete(pid);
  },
  onPartVis(m) {
    const P = this.peers.get(m.f), g = P && P.ghost;
    if (!g || !Array.isArray(m.list)) return;
    const by = new Map(g.parts.map((p) => [p.id, p]));
    for (const row of m.list) {
      if (!Array.isArray(row)) continue;
      const [id, defl, fire, ab, ret, sweep, ay, ae, ammo, dep, used, gun] = row.map((x) => (x == null || Number.isFinite(x) ? x : 0));
      const p = by.get(id);
      if (!p) continue;
      p.deflect = defl; p.firing = fire; p.ab = ab; p.retracted = !!ret;
      if (sweep != null) p.sweep = sweep;
      p.aimYaw = ay; p.aimEl = ae;
      if (ammo != null) p.ammo = ammo;
      p.deployed = dep; p.used = !!used; p.gunOn = !!gun;
      if (p.def.thrust) p.active = fire > 0;
    }
  },
  onParts(m) {
    const P = this.peers.get(m.f), g = P && P.ghost;
    if (!g || !Array.isArray(m.ids)) return;
    const keep = new Set(m.ids);
    const gone = g.parts.filter((p) => !keep.has(p.id));
    if (!gone.length) return;
    for (const p of gone) {
      const zs = partZs(p), vel = { x: g.vx, y: g.vy, z: g.vz }; // (each of a pair)
      for (const z of zs) { const wp = g.toWorld(p.x, p.y, z); FX.sparks(g.body, wp, vel, 12 / zs.length); FX.puff(g.body, wp, vel, 6 / zs.length, '#cfd5dc'); }
    }
    g.parts = g.parts.filter((p) => keep.has(p.id));
    for (const p of g.parts) if (p.att != null && !keep.has(p.att)) p.att = null; // (its host broke off)
    for (const id of [...g.adj.keys()]) if (!keep.has(id)) g.adj.delete(id);
  },
  onHp(m) {
    const P = this.peers.get(m.f), g = P && P.ghost;
    if (!g || !Array.isArray(m.list)) return;
    const by = new Map(g.parts.map((p) => [p.id, p]));
    for (const row of m.list) { if (!Array.isArray(row)) continue; const p = by.get(row[0]); if (p && Number.isFinite(row[1])) p.hp = (clamp(row[1], 0, 100) / 100) * Combat.maxHp(p.def); }
  },
  onDown(m) {
    const P = this.peers.get(m.f);
    if (P && P.ghost && Flight.running) {
      const g = P.ghost;
      FX.explosion(g.body, { x: m.P[0], y: m.P[1], z: m.P[2] }, { x: g.vx * 0.3, y: g.vy * 0.3, z: g.vz * 0.3 }, 5, airDensity(g.body, g.altitude()) > 0.01);
      if (Flight.dist(Flight.absPos(g), Flight.camAbs) < 4000) Sound.explode();
    }
    this.dropGhost(m.f, false);
    this.peer(m.f).design = null; // (a new craft comes with a new spawn)
    if (m.by === Net.me) { Combat.S.kills++; UI.toast(`${this.nameOf(m.f)} shot down!`, 'kill'); Sound.chime(); }
    if (Net.isHost) this.recordDown(m.f, m.by);
  },

  // ------------------------------------------------------------------ combat over the network
  // our round (or blast) hit someone else's craft: list = [[part, damage], ...] on that craft
  sendHit(ghost, part, dmg, kind) { this.sendHits(ghost, [[part, dmg]], kind); },
  sendHits(ghost, list, kind) {
    if (!this.shared || !ghost || !ghost.remote || !this.hostile(Net.me, ghost.remote)) return;
    const out = [];
    let total = 0;
    for (const [p, d] of list) if (p && d > 0.05) { out.push([p.id, Math.round(d * 10) / 10]); total += d; }
    if (!out.length) return;
    Net.send({ t: 'hit', to: ghost.remote, list: out, k: kind || 'shot' }, ghost.remote);
    if (Net.isHost) this.addDamage(Net.me, total); else this.dmgOut = (this.dmgOut || 0) + total;
  },
  onHit(m) {
    if (!this.shared || m.to !== Net.me) return;
    const v = Flight.active, P = this.peers.get(m.f);
    if (!v || Flight.destroyed || !this.hostile(m.f, Net.me)) return;
    const by = (P && P.ghost) || { remote: m.f, name: this.nameOf(m.f) };
    const list = Array.isArray(m.list) ? m.list.slice(0, 64) : [[m.part, m.dmg]];
    // a part may have broken off into a piece of debris since: look in every craft of ours
    const mine = Flight.vessels.filter((x) => !x.remote && !x.ai);
    v.lastHitBy = by; v.lastHitAt = Flight.time; // first: the hit may be the one that brings us down
    let first = true;
    for (const row of list) {
      if (!Array.isArray(row)) continue;
      const [id, dmg] = row;
      let part = null, owner = null;
      for (const x of mine) { part = x.parts.find((p) => p.id === id); if (part) { owner = x; break; } }
      if (!part || !(dmg > 0)) continue;
      if (first) { first = false; const zs = partZs(part); for (const z of zs) FX.sparks(owner.body, owner.toWorld(part.x, part.y, z), { x: owner.vx, y: owner.vy, z: owner.vz }, 4 / zs.length); Sound.hit(); }
      Combat.damage(owner, part, Math.min(dmg, 5000), m.k === 'blast' ? 'blast' : 'shot', Flight, by);
    }
  },
  // our explosion, for everyone to see (what it hit was settled here and sent as hits)
  sendBoom(b, at, blast) {
    if (!this.shared) return;
    Net.send({ t: 'boom', b: b.id, P: [Math.round(at.x * 10) / 10, Math.round(at.y * 10) / 10, Math.round(at.z * 10) / 10], r: blast });
  },
  onBoom(m) {
    if (!this.shared || !Flight.running) return;
    if (!mpNums(m.P, 3)) return;
    Combat.netBoom(mpBody(m.b) || EARTH, { x: m.P[0], y: m.P[1], z: m.P[2] }, clamp(+m.r || 5, 1, 60));
  },
  addDamage(pid, dmg) { const p = this.player(pid); if (p) p.dmg = Math.round((p.dmg || 0) + dmg); },
  // missiles: we fly ours and tell the others where they are
  sendMissile(s, w) {
    if (!this.shared) return;
    const id = this.nextMissile++;
    this.missiles.set(s, { id, at: 0 });
    const tgt = s.target && s.target.remote ? s.target.remote : 0;
    Net.send({ t: 'msl', id, b: s.b.id, P: [s.x, s.y, s.z], V: [s.vx, s.vy, s.vz], D: [s.dx, s.dy, s.dz], tg: tgt, radar: w.radar ? 1 : 0, glide: w.glide ? 1 : 0, agm: w.seek === 'ground' ? 1 : 0 });
  },
  onMissile(m) {
    const P = this.peers.get(m.f);
    if (!P || !P.ghost || !Flight.running) return;
    Combat.netMissile(P.ghost, m, m.tg === Net.me && this.hostile(m.f, Net.me) ? Flight.active : null);
  },
  // each frame: where our missiles are (10 Hz), and which have gone
  syncMissiles() {
    if (!this.shared || !this.missiles.size) return;
    const now = performance.now(), live = new Set(Combat.shots);
    for (const [s, M] of this.missiles) {
      if (!live.has(s)) { Net.send({ t: 'mx', id: M.id }); this.missiles.delete(s); continue; }
      if (now - M.at < 100) continue;
      M.at = now;
      const r = (x) => Math.round(x * 10) / 10;
      Net.send({ t: 'mp', id: M.id, P: [r(s.x), r(s.y), r(s.z)], V: [r(s.vx), r(s.vy), r(s.vz)], D: [+s.dx.toFixed(3), +s.dy.toFixed(3), +s.dz.toFixed(3)], tg: s.target && s.target.remote ? s.target.remote : 0 });
    }
  },
  sendShot(s) { // bombs and rockets: the others fly a copy for show
    if (!this.shared) return;
    Net.send({ t: 'shot', k: s.k, b: s.b.id, P: [s.x, s.y, s.z], V: [s.vx, s.vy, s.vz], D: [s.dx || 0, s.dy || 0, s.dz || 0], burn: s.burn || 0, accel: s.accel || 0, small: s.small ? 1 : 0, torpedo: s.torpedo ? 1 : 0 });
  },
  sendGun(key, on) { if (this.shared) Net.send({ t: 'gun', k: key, on: on ? 1 : 0 }); },
  sendFlares(v, f) { if (this.shared && v === Flight.active) Net.send({ t: 'cm', P: [f.x, f.y, f.z], V: [f.vx, f.vy, f.vz], chaff: f.chaff ? 1 : 0 }); },
  sendLock(target, on) {
    if (!this.shared) return;
    if (this.lockSent && (!on || this.lockSent !== target)) { Net.send({ t: 'lock', on: 0 }, this.lockSent); this.lockSent = 0; }
    if (on && target) { Net.send({ t: 'lock', on: 1 }, target); this.lockSent = target; }
  },
  // remote craft the local seekers and HUD can see (enemies only)
  enemyGhosts() {
    const out = [];
    if (!this.shared) return out;
    for (const [pid, P] of this.peers) if (P.ghost && !P.ghost.dead && P.ghost.parts.length && this.enemy(Net.me, pid)) out.push(P.ghost);
    return out;
  },
  // the colour another player's craft has on the map and globe: team mates, everyone in the sandbox; enemies hidden
  mapColor(g) {
    if (!this.pvp) return '#ffb547';
    return !this.ffa() && this.teamOf(g.remote) === this.teamOf(Net.me) ? '#62d0ff' : null;
  },
  ghosts() { const out = []; for (const [, P] of this.peers) if (P.ghost && !P.ghost.dead && P.ghost.parts.length) out.push(P.ghost); return out; },
};

// ------------------------------------------------------------------ placements
// Airfields and carriers (space.js) have a centre (e, z), a heading `yaw` and half-sizes along (hl) and across
// (hw); (c, s) is the way along them in (east, z), the way a craft placed with that yaw faces.
// Runways: start near the threshold facing along it, later players further down (and off to the side past three).
function airfieldPlacement(af, slot, kind) {
  if (!af) return null;
  const at = (along, side) => ({ e: af.e + af.c * along - af.s * side, z: af.z + af.s * along + af.c * side, yaw: af.yaw });
  if (kind === 'heli') return at(-af.hl * 0.5 + slot * 45, af.hw + 45);
  return at(-af.hl + 90 + (slot % 3) * 230, slot >= 3 ? (slot % 2 ? 12 : -12) : 0);
}
// Carriers: two bow catapults side by side (later players queue behind them); helicopters on the aft deck.
function carrierPlacement(cv, slot, kind) {
  if (!cv) return null;
  const heli = kind === 'heli';
  const along = heli ? -cv.hl + 28 + (slot % 4) * 26 : cv.hl - cv.cat - 4 - Math.floor(slot / 2) * 40;
  const side = heli ? 0 : slot % 2 ? 6 : -6;
  return {
    e: cv.e + cv.c * along - cv.s * side, z: cv.z + cv.s * along + cv.c * side, yaw: cv.yaw,
    carrier: cv, catapult: heli ? null : { length: cv.hl - along - 3, speed: 78 },
  };
}
