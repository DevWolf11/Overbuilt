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
// Ground battles (the ground update) are a game of their own inside 'pvp': settings.game 'ground'. An air battle
// carries none of these settings (no `game` means air), so it is exactly what it was. The arena isn't chosen: the
// host's map decides it (GroundMode.pick). Each team starts on its pad (a spawn of kind 'pad': no money bonus, no
// size limits); aircraft, with air support on, join at respawn.
const MP_ARMS = { gun: 'guns', agun: 'guns', rocket: 'rockets', missile: 'missiles', bomb: 'bombs' }; // (an aircraft's weapons, as the respawn list says them)
const MP_GROUND = { game: 'ground', tickets: 600, respawn: 'free', air: false, aim: 'arcade', arena: 'highland' };
const MP_PADS = [
  { id: 'pad0', name: 'North pad', kind: 'pad', team: 0, desc: 'Your team’s start, at the north end of the battlefield.' },
  { id: 'pad1', name: 'South pad', kind: 'pad', team: 1, desc: 'Your team’s start, at the south end of the battlefield.' },
];
// What the host may set in the lobby, and to what (anything else is refused)
const MP_SET_OK = {
  format: (v, st) => hasOwn(MP_FORMATS, v) && !(st.game === 'ground' && v === 'ffa'), budget: [45000, 75000, 120000], build: [120, 180, 300],
  test: [true, false], carriers: [true, false], ff: [true, false], tod: ['day', 'dusk', 'night'], limit: [600, 900, 1500],
  game: ['air', 'ground'], tickets: [400, 600, 900], respawn: ['free', 'lineup'], air: [true, false], aim: ['arcade', 'realistic'],
};
const MP_WRECKS = 8, MP_WRECK_MS = 90000; // the most wrecks kept on the field, and for how long
const MP_WRECK_AGL = 10; // (a knocked-out ground vehicle higher than this off the ground leaves no wreck: none hangs in the air)
const mpAir = (kind) => kind === 'plane' || kind === 'heli';
// living troops on board (a hull's built-in bay and placed troop bays, while they're whole), at most 12
function mpTroops(v) {
  let n = 0;
  for (const p of v.parts) {
    const d = p.def;
    if (d.troops && !p.broken && !(p.hp <= 0)) n += d.troops;
    if (d.mods) for (let i = 0; i < d.mods.length; i++) if (d.mods[i].k === 'troops' && !p.broken && !(p.mods && p.mods[i] <= 0)) n += d.mods[i].troops || 0;
  }
  return Math.min(12, n);
}
// (e, z) of a point near Earth (sim), as the arenas give them
const mpLoc = {};
function mpEZ(x, y, z, out) {
  Terrain.locate(EARTH, x, y, z, mpLoc);
  out.e = wrapAngle(EARTH.padAngle - mpLoc.a) * EARTH.radius; out.z = mpLoc.z;
  return out;
}

// Checks for what other players send (a broken or hostile peer must not be able to break our game).
const mpNums = (a, n) => Array.isArray(a) && a.length === n && a.every(Number.isFinite);
const mpBody = (id) => (typeof id === 'string' && hasOwn(BODY_BY_ID, id) && BODY_BY_ID[id]) || null;
// A peer's spawn rows rebuilt clean, [id, type, x, y, rot, flip, z, att, skin, mm?]: unique ids, known parts, depth and
// paint as the builder allows them, att another id of the same craft (0: none) and never in a loop, skin 0 for
// the part's own look, mm an armoured part's thickness as the builder allows it (left off when it has none). Anything
// else in a row is dropped. null: not a craft we take.
function mpSpawnRows(list) {
  if (!Array.isArray(list) || list.length > MP_MAX_PARTS) return null;
  const rows = [], links = [], seen = new Set();
  for (const r of list) {
    if (!Array.isArray(r) || !Number.isSafeInteger(r[0]) || r[0] <= 0 || seen.has(r[0]) || typeof r[1] !== 'string' || !hasOwn(PARTS, r[1]) || !Number.isFinite(r[2]) || !Number.isFinite(r[3])) continue;
    const def = PARTS[r[1]];
    seen.add(r[0]);
    const row = [r[0], r[1], clamp(r[2], -500, 500), clamp(r[3], -500, 500), (r[4] | 0) & 3, r[5] ? 1 : 0, cleanZ(r[6], def), 0, cleanSkin(r[8], def) || 0], mm = cleanMm(r[9], def);
    if (mm != null) row.push(mm);
    rows.push(row);
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
  // (ground battles)
  wrecks: [],          // knocked-out hulks left on the field: { v, pid, t (ms), bits (a tossed turret) }, the oldest first
  hulk: null,          // ours, from its `down` until we respawn (then one of the wrecks): { v, t, bits }
  battleCost: new Map(), // host: pid -> what the craft they last spawned cost (priced here from its spawn rows)
  battleKind: new Map(), // host: pid -> its kind
  spots: new Map(),    // pid -> { t (ms), man } when a teammate (or we, by hand) last spotted that enemy
  pings: [],           // map pings from the team: { e, z, by, t }
  lineup: [null, null, null], // Lineup of 3: the designs for slots 2 and 3 (slot 1 is the one built)

  get live() { return this.active && !!this.state; },
  get isHost() { return Net.isHost; },
  get me() { return this.state ? this.state.players.find((p) => p.pid === Net.me) : null; },
  get pvp() { return !!this.state && this.state.mode === 'pvp'; },
  // a ground battle (settings.game 'ground'); every new branch in an air battle's way checks this first
  get ground() { return !!this.state && this.state.mode === 'pvp' && this.state.settings.game === 'ground'; },
  // Is this client stuck in the 2D view (no WebGL)? A ground battle can't be seen there: the 2D view is a side cut
  // through the launch site, far from Highland Ridge. (Retro 2D flight, a silly setting, is off in any battle.)
  no3D() { return typeof Render3D !== 'undefined' && (!Render3D.supported || !!Render3D.failed); },
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
  myName() { return (store.get('rss.mp.name', '') || '').trim() || 'Player'; },
  async host(mode, transport, settings) { // (settings: over the defaults, e.g. { game: 'ground' }; each as setSetting allows it)
    const name = this.myName();
    await Net.host({ transport, name, maxPlayers: mode === 'sandbox' ? 5 : 6 });
    this.begin();
    const st = { ...MP_DEFAULTS };
    if (mode === 'pvp' && settings && settings.game === 'ground') this.groundSettings(st);
    if (settings) for (const k of Object.keys(settings)) if (k !== 'game' && this.settingOk(k, settings[k], st)) st[k] = settings[k];
    this.state = {
      mode, phase: mode === 'sandbox' ? 'free' : 'lobby', ends: 0, endsLen: 0, round: 0, result: null,
      settings: st, players: [], feed: [],
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
    this.wrecks = []; this.battleCost.clear(); this.battleKind.clear(); this.spots.clear(); this.pings.length = 0;
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
    if (this.wrecks.length) this.clearWrecks();
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
    Net.on('shot', (m) => { const P = this.peers.get(m.f); if (P && P.ghost && Flight.running) { if (m.k === 'shell') P.firedAt = performance.now(); Combat.netShot(P.ghost, m); } }); // (a main gun's flash gives it away: spotted)
    Net.on('msl', (m) => this.onMissile(m));
    Net.on('mp', (m) => Combat.netMissileUpdate(m.f, m.id, m, m.tg === Net.me && this.hostile(m.f, Net.me) ? Flight.active : null));
    Net.on('mx', (m) => Combat.netMissileEnd(m.f, m.id));
    Net.on('cm', (m) => { const P = this.peers.get(m.f); if (P && P.ghost && Flight.running) Combat.netFlares(P.ghost, m); });
    Net.on('lock', (m) => { if (m.on) this.rwr.set(m.f, performance.now()); else this.rwr.delete(m.f); });
    // ground battles: the zones and tickets (host), what each player sees (to the host) and their team's spots (host)
    Net.on('obj', (m) => this.onObj(m));
    Net.on('seen', (m) => this.onSeen(m));
    Net.on('spot', (m) => this.onSpot(m));
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
    // (a ground battle under way: who is on the field is the host's to say, from spawns and downs, never a client's)
    if (pid !== Net.me && this.ground && s.phase === 'battle' && (k === 'flying' || k === 'ready' || k === 'spawn')) return;
    if (k === 'ready') p.ready = !!v;
    else if (k === 'spawn') { if (this.spawnsFor(p).some((sp) => sp.id === v)) p.spawn = v; }
    else if (k === 'kind') p.kind = String(v).slice(0, 8);
    else if (k === 'flying') p.flying = !!v;
    else if (k === 'team') { if (s.phase === 'lobby' && s.mode === 'pvp' && s.format !== 'ffa' && (v === 0 || v === 1)) p.team = v; }
    else if (k === 'name') p.name = String(v).slice(0, 18) || p.name;
    else if (k === 'dmg') { if (s.phase === 'battle' || s.mode === 'sandbox') this.addDamage(pid, clamp(+v || 0, 0, 20000)); }
    else if (k === 'slot' && this.ground) { // the lineup slot to spawn next: unused, the respawn time come, the team's tickets left
      const o = s.obj;
      if (s.settings.respawn !== 'lineup' || !Number.isInteger(v) || v < 0 || v > 2 || ((p.slots || 0) & (1 << v)) || !o || !(o.tk[p.team] > 0) || Net.hostNow() < (p.respawnAt || 0) - 300) return;
      p.slot = v;
    } else if (k === 'troops' && this.ground) { if (!Number.isInteger(v) || v < 0 || v > 12 || p.troops === v) return; p.troops = v; } // (living troops aboard: captures)
    else if (k === 'airSlots' && this.ground) { if (!Number.isInteger(v) || v < 0 || v > 7 || (p.airSlots || 0) === v) return; p.airSlots = v; } // (the lineup's aircraft, a bit a slot: they need a sortie point)
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
    if (!this.settingOk(k, v, s.settings) || (k === 'game' && s.mode !== 'pvp')) return; // (each key to its own values only)
    if (k === 'game' && v === 'ground') {
      this.groundSettings(s.settings);
      if (s.settings.format === 'ffa') { k = 'format'; v = '1v1'; } // (ground battles are team games)
      else { this.push(); return; }
    }
    if (k === 'format') {
      s.settings.format = v; s.format = v;
      // re-deal teams for the new format
      s.players.forEach((p, i) => { p.team = v === 'ffa' ? p.pid : i % 2; });
    } else s.settings[k] = v;
    this.push();
  },
  settingOk(k, v, st) { const ok = hasOwn(MP_SET_OK, k) && MP_SET_OK[k]; return !!ok && (typeof ok === 'function' ? ok(v, st) : ok.includes(v)); },
  // a ground battle's settings over these (game, tickets, respawns, air support, aim; the arena from the host's map)
  groundSettings(st) {
    for (const k of Object.keys(MP_GROUND)) if (k === 'game' || !hasOwn(st, k)) st[k] = MP_GROUND[k];
    st.arena = GroundMode.pick(this.mapReady());
    return st;
  },
  mapReady() { return typeof Terrain !== 'undefined' && !!Terrain.earthMap && Terrain.earthMap.state === 'ready'; },
  // the kinds a battle takes from the builder: planes, helicopters and cars in the air; Armour and cars on the ground
  // (aircraft join a ground battle only at a respawn, with air support on: designProblems' `air`)
  kindsFor(st) { return st && st.game === 'ground' ? ['tank', 'car'] : MP_KINDS_PVP; },
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
        if (this.ground) MPUI.mapCheck(); // (our ground isn't the host's without the same map)
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
        if (this.ground) { this.spawned = false; this.spots.clear(); this.pings.length = 0; this.troopsSent = -1; }
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
    if (this.ground) { // (a ground battle's own score: captures, score, sortie points for aircraft, the lineup's slots used)
      for (const p of s.players) Object.assign(p, { caps: 0, score: 0, sorties: 0, respawnAt: 0, slot: 0, slots: 0, airSlots: 0, troops: 0, cost: 0, sortieEnd: 0 });
      s.settings.arena = GroundMode.pick(this.mapReady());
      delete s.obj;
      this.battleCost.clear(); this.battleKind.clear();
    }
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
    if (phase === 'battle' && this.ground) { // the zones and the tickets (gmode.js)
      s.obj = GroundMode.init(s.settings.arena, s.settings, [0, 1].map((t) => s.players.filter((p) => p.team === t).length));
      this.gt = { at: Net.hostNow(), sent: 0, sig: '', tenth: [10, 10] };
    }
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
      // refresh pings in the lobby now and then (and a ground battle's arena, once the host's map is in)
      if ((s.phase === 'lobby' || s.phase === 'free') && now - (this.pingPushed || 0) > 4000) { this.pingPushed = now; if (this.ground) s.settings.arena = GroundMode.pick(this.mapReady()); this.push(); }
      if (this.ground && s.phase === 'battle' && s.obj) { try { this.groundTick(now); } catch (e) { console.error(e); } }
    }
    if (this.ground && this.phase === 'battle') this.groundReports();
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
    if (this.ground) return this.checkGround(); // (tickets and zones, not the last team flying)
    const teams = new Set(s.players.filter((p) => p.alive).map((p) => p.team));
    const started = new Set(s.sides || s.players.map((p) => p.team));
    if (teams.size > 1 || (started.size <= 1 && teams.size === 1)) return;
    this.finishing = true;
    setTimeout(() => { this.finishing = false; this.finish(teams.size ? [...teams][0] : null, 'last'); }, 3500);
  },
  finish(winner, why) {
    const s = this.state;
    if (!s || s.phase !== 'battle') return;
    if (this.ground) { // on time: more tickets wins (GroundMode.result); the result keeps the tickets and the arena
      if (why === 'time') { const r = s.obj && GroundMode.result(s.obj, true, this.aliveByTeam()); winner = r ? r.winner : null; why = r ? r.why : 'draw'; }
      s.result = { winner, why, ffa: false, ground: true, tk: s.obj ? s.obj.tk.slice() : [0, 0], arena: s.settings.arena, players: s.players.map((p) => ({ ...p })) };
      this.setPhase('results', 0);
      return;
    }
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
    delete s.obj;
    this.setPhase(s.mode === 'pvp' ? 'lobby' : 'free', 0);
  },

  // ------------------------------------------------------------------ host: a ground battle (the rules: gmode.js)
  // Every tick (250 ms, host time, so a phone host that looked away catches up, a second at most): the vehicles on the
  // field from their last snapshots (under 2 s old) and our own, the zones and the bleed; captures go in the feed and
  // score; the tickets and the zones go out as `obj` twice a second while they change (every 2 s anyway), the whole
  // state only on a capture or every tenth of the tickets lost.
  groundTick(now) {
    const s = this.state, o = s.obj, G = this.gt || (this.gt = { at: now, sent: 0, sig: '', tenth: [10, 10] });
    const dt = Math.max(0, (now - G.at) / 1000);
    G.at = now;
    const { units, pids } = this.groundUnits(now);
    let push = false;
    for (const e of GroundMode.tick(o, dt, units)) {
      const zn = o.zones.find((q) => q.id === e.zone), name = zn ? zn.id : '?';
      if (e.k === 'cap') {
        this.feed(`${MP_TEAM_NAMES[e.team]} took ${name}`);
        for (const i of e.by || []) { const p = this.player(pids[i]); if (p) { p.caps = (p.caps || 0) + 1; p.score = (p.score || 0) + 2; p.sorties = (p.sorties || 0) + 1; } }
      } else this.feed(`${MP_TEAM_NAMES[e.team]} lost ${name}`);
      push = true;
    }
    for (const t of [0, 1]) { // (every tenth of the tickets: a push, so the score and the bar stay right)
      const tenth = Math.ceil((o.tk[t] / Math.max(1, s.settings.tickets || 600)) * 10);
      if (tenth < G.tenth[t]) { G.tenth[t] = tenth; push = true; }
    }
    for (const p of s.players) if (!p.flying && p.alive && !this.canRespawn(p)) { p.alive = false; push = true; } // (out of tickets or slots)
    if (this.checkGround()) return;
    if (push) { this.push(); G.sent = now; G.sig = this.objSig(o); this.sendObj(o); return; }
    const sig = this.objSig(o);
    if ((sig !== G.sig && now - G.sent >= 500) || now - G.sent >= 2000) { G.sig = sig; G.sent = now; this.sendObj(o); }
  },
  objSig(o) { let s = o.tk[0] + ',' + o.tk[1]; for (const z of o.zones) s += ';' + z.own + ',' + Math.round(z.p * 100); return s; },
  sendObj(o) { Net.send({ t: 'obj', tk: [o.tk[0], o.tk[1]], z: o.zones.map((z) => [z.own, Math.round(z.p * 100)]) }); },
  // who is on the field, for the zones: each player's vehicle from its last snapshot (under 2 s old) and ours; a player
  // who came back before their respawn time doesn't count until then
  groundUnits(now) {
    const units = [], pids = [], q = {};
    const add = (pid, x, y, z, V, kind, gd) => {
      const p = this.player(pid);
      if (!p || !p.flying || now < (p.respawnAt || 0) || !Number.isFinite(x + y + z)) return;
      mpEZ(x, y, z, q);
      units.push({ team: p.team, e: q.e, z: q.z, kind, speed: Math.hypot(V[0], V[1], V[2]), gd: !!gd, troops: p.troops || 0 });
      pids.push(pid);
    };
    const v = Flight.active;
    if (this.shared && v && !Flight.destroyed && v.body === EARTH) add(Net.me, v.x, v.y, v.z, [v.vx, v.vy, v.vz], v.kind, performance.now() - (this.gdAt || -1e9) < 500);
    for (const [pid, P] of this.peers) {
      const S = P.snap;
      if (!S || !P.design || performance.now() - (P.recv || 0) > 2000 || S.b !== EARTH.id) continue;
      add(pid, S.P[0], S.P[1], S.P[2], S.V, P.design.kind, S.gd === 1);
    }
    return { units, pids };
  },
  // can this player spawn again (Free: while the team has tickets; Lineup: while a slot is unused, too, and an aircraft's
  // only with a sortie point to fly it)
  canRespawn(p) {
    const s = this.state, o = s && s.obj;
    if (!o || !p || !(o.tk[p.team] > 0)) return false;
    return s.settings.respawn !== 'lineup' || !!(7 & ~(p.slots || 0) & ~((p.sorties || 0) > 0 ? 0 : p.airSlots || 0));
  },
  aliveByTeam() { const n = [0, 0]; for (const p of this.state.players) if ((p.team === 0 || p.team === 1) && (p.alive || p.flying)) n[p.team]++; return n; },
  // host: over? (a team out of tickets, or with nobody left; the result shows 3.5 s later)
  checkGround() {
    const s = this.state;
    if (!Net.isHost || !s || s.phase !== 'battle' || !s.obj || this.finishing) return false;
    const r = GroundMode.result(s.obj, false, this.aliveByTeam());
    if (!r) return false;
    this.finishing = true;
    this.push(); this.sendObj(s.obj);
    setTimeout(() => { this.finishing = false; this.finish(r.winner, r.why); }, 3500);
    return true;
  },

  // ------------------------------------------------------------------ spawns, money and limits
  spawnsFor(p) {
    const s = this.state;
    if (!s || !p) return [];
    if (this.ground) return MP_PADS.filter((sp) => sp.team === p.team); // (each team its pad; no carriers)
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
  spawnDef(id) { return MP_SPAWNS.find((sp) => sp.id === id) || (this.ground && MP_PADS.find((sp) => sp.id === id)) || MP_SPAWNS[0]; },
  budgetFor(spawnId) {
    const s = this.state;
    if (!this.pvp) return null;
    if (this.ground) return s.settings.budget; // (a pad: no bonus, whatever spawn an air battle left behind)
    return Math.round(s.settings.budget * (this.spawnDef(spawnId).kind === 'carrier' ? MP_CARRIER.bonus : 1));
  },
  limitsFor(spawnId) { return this.pvp && !this.ground && this.spawnDef(spawnId).kind === 'carrier' ? MP_CARRIER : null; },
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
  // problems with a design for the current match (shown in the builder's stats, and checked before flying). air: a
  // respawn in a ground battle, where aircraft may join too with air support on.
  designProblems(stats, parts, kind, air) {
    const out = [];
    if (parts.length > MP_MAX_PARTS) out.push(`Too many parts for the shared world: ${parts.length}, the most is ${MP_MAX_PARTS}.`);
    if (!this.pvp) return out;
    const budget = this.budgetFor(this.spawnId);
    if (stats.cost > budget) out.push(`Over budget by ${money(stats.cost - budget)}: remove parts or pick cheaper ones.`);
    if (this.ground) {
      if (!this.kindsFor(this.state.settings).includes(kind) && !(air && this.state.settings.air && mpAir(kind)))
        out.push(mpAir(kind) && this.state.settings.air ? 'Aircraft join a ground battle when you respawn: build Armour or a car.' : 'Ground battles are for Armour and cars: switch the vehicle type.');
      return out;
    }
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
    if (this.ground) { // a ground battle's stock: the money tier's vehicles (GROUND_STOCK), then the technical; never a plane
      if (this.fits(d, this.spawnAir)) return d;
      const key = GroundMode.stock(this.state.settings.budget).find((k) => hasOwn(TEMPLATES, k) && this.fits({ kind: TEMPLATES[k].kind, parts: templateRows(TEMPLATES[k]) }))
        || (hasOwn(TEMPLATES, GROUND_STOCK.fallback) ? GROUND_STOCK.fallback : Object.keys(TEMPLATES).find((k) => isGround(TEMPLATES[k].kind)));
      const t = TEMPLATES[key];
      UI.toast(`Your design can’t fight in this battle: you get a ${t.name} instead`, 'warn');
      return { name: t.name, kind: t.kind, key, parts: templateRows(t) };
    }
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
  // Can this design fight in this battle, as Flight.start will build it (the part tree holding the control part, loose
  // parts left behind)? air: an aircraft at a ground battle's respawn.
  fits(d, air) {
    if (!d || !Array.isArray(d.parts)) return false;
    const parts = partsFromDesign(d.parts), ctrl = findControlPart(parts);
    if (!ctrl) return false;
    const keep = componentOf(ctrl.id, buildAdjacency(parts)), used = parts.filter((p) => keep.has(p.id));
    return !this.designProblems({ cost: designCost(used) }, used, d.kind, air).length;
  },
  // What a player may come back in at a ground battle's respawn: their saved designs of those kinds that fit the
  // battle, then the stock ones (TEMPLATES; worked out once per money and kind of craft). air: planes and helicopters.
  choices(air) {
    const kinds = air ? ['plane', 'heli'] : ['tank', 'car'], out = [], st = this.state.settings;
    // (P4 play-test) aircraft are air support: what each carries (guns, rockets, missiles, bombs), the armed ones first
    const arms = (rows) => { if (!air) return undefined; const k = new Set(); for (const p of partsFromDesign(rows)) { const w = p.def.weapon; if (w && MP_ARMS[w.kind]) k.add(MP_ARMS[w.kind]); } return [...k].join(', '); };
    for (const d of Builder.designs ? Builder.designs() : []) {
      if (!kinds.includes(d.kind)) continue;
      const des = { name: String(d.name).slice(0, 40), kind: d.kind, parts: d.parts };
      if (this.fits(des, air)) out.push({ name: des.name, design: des, cost: designCost(partsFromDesign(d.parts)), saved: true, arms: arms(d.parts) });
    }
    const key = st.budget + (air ? 'a' : 'g') + (st.air ? '+' : '-');
    if (!this.stockMemo || this.stockMemo.key !== key) {
      const list = [];
      for (const k of Object.keys(TEMPLATES)) {
        const t = TEMPLATES[k];
        if (!kinds.includes(t.kind)) continue;
        const des = { name: t.name, kind: t.kind, key: k, parts: templateRows(t) };
        if (this.fits(des, air)) list.push({ name: t.name, design: des, cost: designCost(partsFromDesign(des.parts)), arms: arms(des.parts) });
      }
      list.sort((a, b) => (a.design.kind === 'car') - (b.design.kind === 'car') || (air ? !a.arms - !b.arms : 0)); // (Armour first, by era; then the cars. Aircraft: armed first)
      this.stockMemo = { key, list };
    }
    if (air) out.sort((a, b) => !a.arms - !b.arms);
    return out.concat(this.stockMemo.list);
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
      if (!Builder.ctrl) { UI.toast(this.ground ? 'Add a hull (or a car’s chassis and cab) first' : 'Add a cockpit or command part first'); return; }
      if (probs.length) { UI.toast(probs[0], 'warn'); return; }
    }
    this.setMine('ready', !me.ready);
  },
  enterBuild(first) {
    const s = this.state, kinds = this.kindsFor(s.settings);
    Builder.mp = { budget: this.budgetFor(this.spawnId), limits: this.limitsFor(this.spawnId), kinds };
    Builder.renderKind();
    this.setMoney(Builder.mp.budget);
    if (App.scene !== 'build') App.toBuild();
    if (this.ground) { // Armour or a car: start from the money's stock tank when the hangar holds something else
      if (first && !kinds.includes(Builder.kind)) {
        const key = GroundMode.stock(s.settings.budget).find((k) => hasOwn(TEMPLATES, k));
        if (key && Builder.loadTemplate) { Builder.loadTemplate(key); UI.toast(`Ground battle: start from the ${TEMPLATES[key].name}, or build your own`); }
        else if (Builder.setKind) Builder.setKind('tank');
      }
      if (first) this.lineup = [null, ...GroundMode.stock(s.settings.budget).filter((k) => hasOwn(TEMPLATES, k)).slice(0, 2).map((k) => ({ name: TEMPLATES[k].name, kind: TEMPLATES[k].kind, key: k, parts: templateRows(TEMPLATES[k]) }))];
      Builder.buildPalette(); Builder.changed(true);
      return; // (no spawn map: the arena shows in the lobby)
    }
    if (first && !MP_KINDS_PVP.includes(Builder.kind)) Builder.setKind && Builder.setKind('plane');
    Builder.buildPalette(); Builder.changed(true);
    if (first && s.mode === 'pvp') setTimeout(() => MPUI.openSpawnMap(), 400);
  },
  // Fly: a test flight (alone) or into the shared world (sandbox, battle).
  startFlight(solo) {
    const s = this.state, ground = this.ground && !solo && s.phase === 'battle';
    UI.closeModal(); MPUI.closeSpawnMap();
    // a ground battle: our knocked-out hulk stays where it stopped at the `down` (onLocalDestroyed), a wreck like the
    // others', with its thrown turret
    const H = this.hulk, hulk = ground && H && Flight.running && Flight.destroyed && Flight.active === H.v && !H.v.dead && H.v.parts.length ? H : null;
    this.hulk = null;
    if (hulk) { for (const q of hulk.bits || []) q.foreign = Net.me; this.addWreck(hulk.v, Net.me, hulk.bits, hulk.t); } // (the pieces carry the ids our new craft has: hits never look in them)
    if (App.scene === 'flight' || Flight.running) { if (Flight.running && Flight.mp && !Flight.mp.solo) Net.send({ t: 'despawn' }); Flight.stop(); this.dropAllGhosts(); }
    let design;
    if (this.pvp) {
      this.myDesign = Builder.mp ? Builder.serialize() : this.myDesign;
      design = this.battleDesign();
      this.myDesign = design;
    } else design = this.myDesign || Builder.serialize();
    this.spawnAir = false;
    const kind = hasOwn(VEHICLE_KINDS, design.kind) ? design.kind : 'plane';
    const place = this.placement(this.pvp ? this.spawnId || this.defaultSpawn() : null, kind, design);
    const time = this.pvp ? (s.tod || 0) + Math.max(0, (Net.hostNow() - (s.battleAt || Net.hostNow())) / 1000) : this.sandboxTime();
    const again = ground && !!this.spawned; // (a respawn, not the battle's first spawn)
    if (ground) { this.spawned = true; if (!mpAir(kind)) this.groundDesign = design; if (!this.lineup[0] && !again) this.lineup[0] = design; }
    App.afterEarth(() => {
      if (!this.live) return;
      App.showScene('flight');
      const opts = { place, time, mp: { mode: s.mode, solo: !!solo, phase: s.phase } };
      if (ground) opts.keep = this.wrecks.flatMap((w) => (w.bits ? [w.v, ...w.bits] : [w.v])); // (the hulks on the field, ours too, and their thrown turrets)
      Flight.start(design, opts);
      if (ground && Flight.active) Flight.active.spawnAt = Flight.time; // (4 s of spawn protection: Armour)
      Builder.mp = null;
      if (!solo) { this.sendSpawn(); this.setMine('flying', true); if (this.pvp) this.setMine('kind', kind); }
      if (ground && s.settings.respawn === 'lineup') { // (which slots are aircraft, so the host knows when none we can take is left)
        const a = this.lineup.reduce((n, d, i) => n | (d && mpAir(d.kind) ? 1 << i : 0), 0);
        if (this.me && (this.me.airSlots || 0) !== a) this.setMine('airSlots', a);
      }
      MPUI.refresh();
      if (this.ground && this.no3D()) { Flight._warn2d = true; UI.toast('Ground battles need the 3D view: this device can’t show it', 'warn'); } // (in place of flight.js's 'Ground combat needs the 3D view')
      const tip = place && place.carrier ? 'Throttle up, then hit LAUNCH (L) for the catapult' : null;
      if (solo) UI.toast(this.ground ? 'Test drive: one minute on your pad, nobody can hurt you' : 'Test flight: one minute, nobody can hurt you');
      else if (ground) UI.toast(again ? `Back in the fight: ${design.name || VEHICLE_KINDS[kind].name}` : `Battle! Hold the zones: ${s.settings.tickets || 600} tickets each`);
      else if (this.pvp) UI.toast(tip || 'Battle! Last team flying wins');
      else if (tip) UI.toast(tip);
    });
  },
  // sandbox: a fresh craft at the start (the old one goes, as if it crashed out of sight). A ground battle: back in
  // (the design and slot the Respawn panel chose: respawnWith), once the host's row says we may.
  respawn() {
    if (!this.live) return;
    if (this.pvp) { if (this.ground) this.respawnWith(this.groundDesign || this.myDesign); return; }
    if (Flight.running && !Flight.destroyed && Flight.mp && !Flight.mp.solo) Net.send({ t: 'despawn' });
    this.startFlight(false);
  },
  // (a ground battle) may we spawn now: in the battle, knocked out, our team's tickets (and in a lineup, the slot) left,
  // and the host's respawn time come (300 ms early for the trip there)
  canSpawnNow(slot) {
    const s = this.state, me = this.me;
    if (!this.ground || !me || s.phase !== 'battle' || !s.obj || (Flight.running && !Flight.destroyed)) return false;
    if (!(s.obj.tk[me.team] > 0) || Net.hostNow() < (me.respawnAt || 0) - 300) return false;
    if (s.settings.respawn === 'lineup') { const k = slot == null ? me.slot || 0 : slot; return Number.isInteger(k) && k >= 0 && k <= 2 && !((me.slots || 0) & (1 << k)); }
    return true;
  },
  // back in a ground battle in this design (the Respawn panel's choice; slot: the lineup's)
  respawnWith(design, slot) {
    if (!design || !this.canSpawnNow(slot)) return false;
    if (this.state.settings.respawn === 'lineup' && slot != null) this.setMine('slot', slot);
    this.myDesign = design;
    this.spawnAir = mpAir(design.kind);
    this.startFlight(false);
    return true;
  },
  // a knocked-out hulk kept on the field (ours at a respawn, the others' on their `down`): still, never stepped, solid
  // to shells; the oldest goes past MP_WRECKS, each after MP_WRECK_MS (from t: its `down`)
  addWreck(v, pid, bits, t) {
    v.wreck = true; v.vx = v.vy = v.vz = 0; v.av = v3(0, 0, 0);
    this.wrecks.push({ v, pid, t: t || performance.now(), bits: bits && bits.length ? bits : null });
    while (this.wrecks.length > MP_WRECKS) this.dropWreck(this.wrecks[0]);
  },
  dropWreck(w) {
    this.wrecks = this.wrecks.filter((x) => x !== w);
    w.v.dead = true;
    if (Flight.vessels) Flight.vessels = Flight.vessels.filter((v) => v !== w.v && !(w.bits && w.bits.includes(v)));
  },
  clearWrecks() { for (const w of [...this.wrecks]) this.dropWreck(w); },
  // sandbox: everyone shares the host's clock so the sun and the clouds agree
  sandboxTime() { return this.state && this.state.t0 != null ? this.state.t0 + (Net.hostNow() - this.state.t0At) / 1000 : 0; },
  leaveFlight() {
    if (App.scene !== 'flight' && !Flight.running) return;
    if (Flight.running && Flight.mp && !Flight.mp.solo) { Net.send({ t: 'despawn' }); if (!this.pvp) this.setMine('flying', false); }
    Flight.stop();
    this.dropAllGhosts();
    this.hulk = null;
    if (this.wrecks.length) this.clearWrecks();
    Combat.reset(Flight);
  },
  // Where a craft starts for a spawn point (PvP) or the normal sites (sandbox): placement for Flight.start. design
  // (sandbox): whether a car carries a weapon.
  placement(spawnId, kind, design) {
    if (!spawnId) { // sandbox: the usual pad, runway or helipad, a little apart so craft don't start inside each other
      const slot = Math.max(0, this.state.players.map((p) => p.pid).sort((a, b) => a - b).indexOf(Net.me));
      // (Armour and cars armed by the ground update: the tank yard on the space centre's island, side by side facing the
      // open ground (props.js yardPlace), when the map is in and the view is 3D. An old car's gun, flares or chaff keep it
      // on the runway, as before.)
      const armed = kind === 'car' && design && Array.isArray(design.parts) && design.parts.some((q) => { const d = q && hasOwn(PARTS, q.type) && PARTS[q.type]; return d && d.gv && d.weapon && d.weapon.kind !== 'smoke'; });
      if ((kind === 'tank' || armed) && this.mapReady() && (typeof App === 'undefined' || !App.use3D || App.use3D()) && typeof Props !== 'undefined') return this.yardSpot(slot);
      if (!slot) return null;
      if (kind === 'plane' || kind === 'car') return { e: EARTH.sites.runway.east + slot * 220, z: 0, yaw: 0, soft: true };
      if (kind === 'heli') return { e: EARTH.sites.helipad.east + (slot % 2 ? 1 : -1) * Math.ceil(slot / 2) * 35, z: 0, yaw: 0, soft: true };
      return null; // rockets share the pad
    }
    if (this.ground) { // a ground battle: the team's pad (gmode.js), the slot by player number among the team
      const me = this.me, team = me && me.team === 1 ? 1 : 0;
      const slot = Math.max(0, this.state.players.filter((p) => p.team === team).map((p) => p.pid).sort((a, b) => a - b).indexOf(Net.me));
      return this.padPlace(this.state.settings.arena, team, slot, kind);
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
  // A spot at the sandbox's tank yard (Props.yardPlace): our own, or the next of its eight that no other player's craft
  // stands within 10 m of (one parked on ours)
  yardSpot(slot) {
    const first = Props.yardPlace(slot), at = [], now = performance.now();
    for (const [, P] of this.peers) if (P.snap && P.snap.b === EARTH.id && now - (P.recv || 0) < 6000) at.push(mpEZ(P.snap.P[0], P.snap.P[1], P.snap.P[2], {}));
    for (let k = 0; k < 8 && at.length; k++) { const pl = k ? Props.yardPlace(slot + k) : first; if (pl && !at.some((a) => Math.hypot(a.e - pl.e, a.z - pl.z) < 10)) return pl; }
    return first;
  },
  // A spot on an arena's pad (GroundMode.placement): our own, or, when a wreck or another vehicle stands within 12 m of
  // it (we were knocked out at the start), the next of the pad's spots that is clear
  padPlace(arena, team, slot, kind) {
    const first = GroundMode.placement(arena, team, slot, kind);
    if (!first || first.air || kind === 'heli') return first;
    const at = [], now = performance.now();
    for (const w of this.wrecks) if (w.v.body === EARTH && !w.v.dead) at.push(mpEZ(w.v.x, w.v.y, w.v.z, {}));
    for (const [, P] of this.peers) if (P.snap && P.snap.b === EARTH.id && now - (P.recv || 0) < 6000) at.push(mpEZ(P.snap.P[0], P.snap.P[1], P.snap.P[2], {}));
    if (!at.length) return first;
    for (let k = 0; k < 6; k++) {
      const pl = k ? GroundMode.placement(arena, team, slot + k, kind) : first;
      if (pl && !at.some((a) => Math.hypot(a.e - pl.e, a.z - pl.z) < 12)) return pl;
    }
    return first;
  },

  // ------------------------------------------------------------------ the shared world: our craft
  sendSpawn() {
    const v = Flight.active;
    if (!v) return;
    this.lastParts = v.parts.length;
    this.sent = { s: 0, pv: 0, hp: 0, hpSig: '' };
    const ids = new Set(v.parts.map((p) => p.id)); // att: the host's id (ghosts keep ours), 0 for none or a host gone
    this.spawnMsg = { t: 'spawn', name: v.name, kind: v.kind, parts: v.parts.map((p) => {
      const r = [p.id, p.type, +p.x.toFixed(3), +p.y.toFixed(3), p.rot || 0, p.flip ? 1 : 0, +partZ(p).toFixed(3), p.att != null && p.att !== p.id && ids.has(p.att) ? p.att : 0, p.skin || 0];
      if (p.mm != null) r.push(p.mm); // (armour dialled thicker or thinner)
      return r;
    }) };
    Net.send(this.spawnMsg);
    if (Net.isHost && this.ground) this.priceSpawn(Net.me, mpSpawnRows(this.spawnMsg.parts), v.kind);
  },
  // host, a ground battle: what a player's new craft costs, from the spawn rows as everyone builds it (their armour
  // too); it prices the tickets they lose with it (never their own word). A lineup slot is used; an aircraft spends a
  // sortie point.
  priceSpawn(pid, rows, kind) {
    const s = this.state, p = this.player(pid);
    if (!s || !p || !rows || s.phase !== 'battle') return false;
    const cost = designCost(rows.map((r) => ({ type: r[1], mm: r[9] })));
    this.battleCost.set(pid, cost); this.battleKind.set(pid, kind);
    p.cost = cost;
    if (p.flying) return true; // (the same craft's spawn again, for someone who missed it: no new slot or sortie)
    if (s.settings.respawn === 'lineup') p.slots = (p.slots || 0) | (1 << (p.slot || 0));
    if (mpAir(kind)) p.sorties = Math.max(0, (p.sorties || 0) - 1);
    return true;
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
    const ground = this.ground;
    if (ground && (v.wheelsDown || v.contactTime > 0)) this.gdAt = now; // (on the ground in the last half second: it may take a zone)
    if (now - S.s >= MP_SNAP_MS) {
      S.s = now;
      const r2 = (x) => Math.round(x * 100) / 100, r4 = (x) => Math.round(x * 1e4) / 1e4;
      const snap = { t: 's', th: Math.round(Net.hostNow()), b: v.body.id, P: [r2(v.x), r2(v.y), r2(v.z)], V: [r2(v.vx), r2(v.vy), r2(v.vz)],
        Q: [r4(v.q.w), r4(v.q.x), r4(v.q.y), r4(v.q.z)], W: [r4(v.av.x), r4(v.av.y), r4(v.av.z)], C: [r4(v.com.x), r4(v.com.y), r4(v.com.z || 0)],
        g: v.gearUp ? 1 : 0, l: v.landed ? 1 : 0 };
      if (ground) snap.gd = now - (this.gdAt || -1e9) < 500 ? 1 : 0;
      Net.send(snap);
    }
    if (now - S.pv >= MP_PV_MS) { // moving parts: only those that changed (all of them every 2 s)
      S.pv = now;
      const full = now - (S.pvFull || 0) > 2000, list = [];
      if (full) S.pvFull = now;
      if (!S.pvSig) S.pvSig = new Map();
      for (const p of v.parts) {
        const d = p.def;
        if (!(d.wing || d.thrust || d.weapon || d.chute || (d.wheel && d.wheel.retract) || d.ring || d.trackRadar)) continue; // (a turret ring's yaw rides in aimYaw)
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
        const g = this.ground;
        UI.modal({ kicker: g ? 'Test drive' : 'Test flight', title: g ? 'Vehicle lost' : 'Craft lost', body: '<p>Only a test: nothing is lost. Try again, or wait for the polish phase to fix what broke.</p>',
          actions: [{ label: g ? 'Drive again' : 'Fly again', primary: true, onClick: () => { if (this.phase === 'test') this.startFlight(true); } }] });
      }, 1400);
      return true;
    }
    if (!this.shared) return false;
    const v = Flight.active, s = this.state;
    const by = v.lastHitBy && v.lastHitBy.remote && Flight.time - (v.lastHitAt || -99) < 20 ? v.lastHitBy.remote : 0;
    const P = v.toWorld(v.com.x, v.com.y, v.com.z || 0);
    if (this.ground && s.phase === 'battle') { // knocked out: the hulk stays (w), for everyone; then the Respawn panel
      const ko = v.ko, msg = { t: 'down', by, P: [P.x, P.y, P.z] };
      this.hulk = null;
      if (ko && !v.dead && v.parts.length && isGround(v.kind) && v.groundAltitude() < MP_WRECK_AGL) {
        msg.w = 1; if (ko.x) msg.x = 1;
        // it stops here, as it does on every other screen (a wreck is never stepped), with the turret it threw (not
        // pieces of anyone else's); a wreck of ours from the respawn on (startFlight)
        v.wreck = true; v.vx = v.vy = v.vz = 0; v.av = v3(0, 0, 0);
        this.hulk = { v, t: performance.now(), bits: ko.x ? Flight.vessels.filter((q) => q.tossed && !q.foreign && !q.dead && !q.remote) : null };
      }
      msg.why = ko ? (ko.why === 'hull' ? 'parts' : ko.why) : 'parts';
      Net.send(msg);
      if (Net.isHost) this.recordDown(Net.me, by);
      Flight.ended = false;
      setTimeout(() => {
        if (!this.live || !this.ground || this.phase !== 'battle' || !Flight.destroyed) return;
        const me = this.me;
        if (me && me.alive) MPUI.respawnPanel(by);
        else { MPUI.spectate(1); UI.toast(`${by ? `Knocked out by ${this.nameOf(by)}` : 'Knocked out'}. No respawns left: spectating (${isTouch ? 'tap' : '[ ]'} to switch)`, 'warn'); }
      }, 1800);
      return true;
    }
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
    const ground = this.ground && s.phase === 'battle' && s.obj;
    if (s.phase === 'battle' && !ground) p.alive = false;
    p.deaths++;
    const k = by && by !== pid ? this.player(by) : null;
    if (ground) { // the team pays for it in tickets, priced from its spawn rows here (x1.5 for an aircraft); back in 5 s
      const kind = this.battleKind.get(pid) || p.kind;
      GroundMode.death(s.obj, p.team, this.battleCost.get(pid) || 0, mpAir(kind));
      if (mpAir(kind)) p.sortieEnd = Net.hostNow();
      if (k && k.team !== p.team) { k.score = (k.score || 0) + 3; k.sorties = (k.sorties || 0) + 1; }
      p.respawnAt = Net.hostNow() + 5000;
      p.alive = this.canRespawn(p);
      if (k) { k.kills++; this.feed(`${k.name} ⟶ ${p.name}`); } else this.feed(mpAir(kind) ? `${p.name} crashed` : `${p.name} is out`);
      if (this.gt) this.gt.sig = ''; // (the tickets went out with this state)
    } else if (k) { k.kills++; this.feed(`${k.name} ⟶ ${p.name}`); } else this.feed(`${p.name} crashed`);
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
    if (Net.isHost && this.state) {
      const p = this.player(m.f), priced = this.ground && this.priceSpawn(m.f, parts, P.design.kind); // (a ground battle: priced here)
      if (p && (!p.flying || priced)) { p.flying = true; this.push(); }
    }
  },
  buildGhost(pid) {
    const P = this.peers.get(pid);
    if (!P || !P.design || P.ghost) return;
    const parts = [];
    for (const [id, type, x, y, rot, flip, z, att, skin, mm] of P.design.parts) { // (clean: see mpSpawnRows)
      const p = makePart(type, x, y, { flip: !!flip, rot, z, skin: skin || null });
      p.id = id; p.att = att || null;
      if (mm != null) p.mm = mm;
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
        if (g._ease) this.easeTurrets(g, dt);
      } catch (e) { console.error(e); this.dropGhost(pid, false); P.design = null; P.snap = null; }
    }
    // radar locks time out
    for (const [pid, t] of this.rwr) if (performance.now() - t > 2500) this.rwr.delete(pid);
    // the wrecks on the field stay in the flight (a respawn rebuilt its list) until they go, after 90 s
    if (this.wrecks.length) {
      const now = performance.now();
      for (const w of [...this.wrecks]) {
        if (now - w.t > MP_WRECK_MS || w.v.dead) { this.dropWreck(w); continue; }
        if (!list.includes(w.v)) list.push(w.v);
        if (w.bits) for (const q of w.bits) if (!q.dead && q.parts.length && !list.includes(q)) list.push(q); // (its thrown turret)
      }
    }
  },
  // A ghost's turrets and guns (the ground update's parts) ease toward the angles in its part states, so they don't
  // step five times a second; the renderer and our hit tests both see the eased pose
  easeTurrets(g, dt) {
    const k = 1 - Math.exp(-12 * Math.max(0, dt));
    for (const p of g._ease) {
      p.aimYaw += wrapAngle(p.aimYawT - p.aimYaw) * k;
      p.aimEl += (p.aimElT - p.aimEl) * k;
    }
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
      if (p.def.gv) { // (eased toward: easeTurrets; the first angles taken as they are)
        const y = wrapAngle(ay || 0), e = clamp(ae || 0, -1.6, 1.6); // (a turn is a turn; no gun points past straight up)
        if (p.aimYawT == null) { p.aimYaw = y; p.aimEl = e; (g._ease || (g._ease = [])).push(p); }
        p.aimYawT = y; p.aimElT = e;
      } else { p.aimYaw = ay; p.aimEl = ae; } // (an old turret: as ever)
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
    if (g.plated) { // (a lost ring stops turning what is left of its turret)
      for (const s of g.adj.values()) for (const id of [...s]) if (!keep.has(id)) s.delete(id);
      g.byId = new Map(g.parts.map((p) => [p.id, p]));
      Aim.groups(g);
      if (g._ease) g._ease = g._ease.filter((p) => keep.has(p.id));
    }
  },
  onHp(m) {
    const P = this.peers.get(m.f), g = P && P.ghost;
    if (!g || !Array.isArray(m.list)) return;
    const by = new Map(g.parts.map((p) => [p.id, p]));
    for (const row of m.list) { if (!Array.isArray(row)) continue; const p = by.get(row[0]); if (p && Number.isFinite(row[1])) p.hp = (clamp(row[1], 0, 100) / 100) * Combat.maxHp(p.def); }
  },
  onDown(m) {
    const P = this.peers.get(m.f), ground = this.ground, at = mpNums(m.P, 3) ? { x: m.P[0], y: m.P[1], z: m.P[2] } : null; // (a down with no place: no blast, the rest as ever)
    const g = P && P.ghost, kind = (P && P.design && P.design.kind) || (g && g.kind);
    // a ground battle: a knocked-out ground vehicle (w) stays as a wreck, on every screen; an ammunition detonation (x)
    // throws its turret here too. (Never an aircraft's, nor one in the sky or never seen yet: that one goes, as a plane
    // shot down does. Its owner sends w on the ground only: the margin is for the ghost's lag.)
    const hulk = ground && m.w === 1 && g && isGround(kind) && Flight.running && !g.dead && g.parts.length && !g.hiddenUntilSnap && g.groundAltitude() < MP_WRECK_AGL * 3 ? g : null;
    if (g && Flight.running && at) {
      FX.explosion(g.body, at, { x: g.vx * 0.3, y: g.vy * 0.3, z: g.vz * 0.3 }, hulk && m.x !== 1 ? 2.5 : hulk ? 6 : 5, airDensity(g.body, g.altitude()) > 0.01);
      if (Flight.dist(Flight.absPos(g), Flight.camAbs) < 4000) Sound.explode();
    }
    if (hulk) {
      P.ghost = null; P.gun = {};
      if (Flight.spectate === g) { Flight.spectate = null; setTimeout(() => { if (this.live && Flight.destroyed && !Flight.spectate) MPUI.spectate(1); }, 1500); }
      let bits = null;
      if (m.x === 1) { try { bits = Armour.toss(g, Flight, null); for (const q of bits) q.foreign = m.f; } catch (e) { console.error(e); bits = null; } } // (its pieces carry its owner's part ids)
      // where its owner's hulk stopped (P: its centre of mass, the turret gone), give or take 20 m: a forged P can't carry it off
      const dx = at ? at.x - g.x : 0, dy = at ? at.y - g.y : 0, dz = at ? at.z - g.z : 0;
      if (dx * dx + dy * dy + dz * dz < 400) for (const o of bits ? [g, ...bits] : [g]) { o.x += dx; o.y += dy; o.z += dz; }
      this.addWreck(g, m.f, bits);
    } else this.dropGhost(m.f, false);
    this.peer(m.f).design = null; // (a new craft comes with a new spawn)
    if (m.by === Net.me) {
      Combat.S.kills++;
      const ko = ground && isGround(kind);
      UI.toast(`${this.nameOf(m.f)} ${ko ? 'knocked out!' : 'shot down!'}`, 'kill'); Sound.chime();
      if (ground) Armour.fb.ko = { text: m.x === 1 ? 'Ammo detonation!' : ko ? 'Knocked out!' : 'Shot down!', t: Flight.time || 0 }; // (the HUD's banner)
    }
    if (Net.isHost) this.recordDown(m.f, m.by);
  },

  // ------------------------------------------------------------------ combat over the network
  // our round (or blast) hit someone else's craft: list = [[part, damage], ...] on that craft
  sendHit(ghost, part, dmg, kind) { this.sendHits(ghost, [[part, dmg]], kind); },
  // (the ground update: kind 'pen' or 'np' as well; mods: [[host part, module index, damage], ...] for its built-in crew,
  // ammunition and fuel, as m rows; dir: [x, y, z] toward us, for their hit arc; hot: a shaped charge, APHE or HE.
  // A wreck takes nothing.)
  sendHits(ghost, list, kind, mods, dir, hot) {
    if (!this.shared || !ghost || !ghost.remote || ghost.wreck || !this.hostile(Net.me, ghost.remote)) return;
    const out = [], m = [];
    let total = 0;
    for (const [p, d] of list) if (p && d > 0.05) { out.push([p.id, Math.round(d * 10) / 10]); total += d; }
    if (mods) for (const [p, i, d] of mods) if (p && d > 0.05 && m.length < 32) { m.push([p.id, i, Math.round(d * 10) / 10]); total += d; }
    if (!out.length && !m.length) return;
    const msg = { t: 'hit', to: ghost.remote, list: out, k: kind || 'shot' };
    if (m.length) msg.m = m;
    if (dir && dir.length === 3 && dir.every(Number.isFinite)) msg.d = dir.map((x) => Math.round(x * 1000) / 1000);
    if (hot) msg.h = 1;
    Net.send(msg, ghost.remote);
    if (Net.isHost) this.addDamage(Net.me, total); else this.dmgOut = (this.dmgOut || 0) + total;
  },
  onHit(m) {
    if (!this.shared || m.to !== Net.me) return;
    const v = Flight.active, P = this.peers.get(m.f);
    if (!v || Flight.destroyed || !this.hostile(m.f, Net.me)) return;
    const by = (P && P.ghost) || { remote: m.f, name: this.nameOf(m.f) };
    const list = Array.isArray(m.list) ? m.list.slice(0, 64) : [[m.part, m.dmg]];
    // a part may have broken off into a piece of debris since: look in every craft of ours
    const mine = Flight.vessels.filter((x) => !x.remote && !x.ai && !x.wreck && !x.foreign); // (not our old hulk, nor pieces of someone else's)
    v.lastHitBy = by; v.lastHitAt = Flight.time; // first: the hit may be the one that brings us down
    const find = (id) => { for (const x of mine) { const part = x.parts.find((p) => p.id === id); if (part) return [part, x]; } return [null, null]; };
    if (m.h === 1) Armour.hot = true; // (a shaped charge, APHE or HE: our ammunition cooks off more easily)
    let first = true;
    Combat.holdRips(); // (the ground update's kit it strips goes in one piece: Combat.flushRips)
    try {
      for (const row of list) {
        if (!Array.isArray(row)) continue;
        const [id, dmg] = row, [part, owner] = find(id);
        if (!part || !(dmg > 0)) continue;
        if (first) { first = false; const zs = partZs(part); for (const z of zs) FX.sparks(owner.body, owner.toWorld(part.x, part.y, z), { x: owner.vx, y: owner.vy, z: owner.vz }, 4 / zs.length); Sound.hit(); }
        Combat.damage(owner, part, Math.min(dmg, 5000), m.k === 'blast' ? 'blast' : 'shot', Flight, by);
      }
      // (the ground update) built-in modules, as m rows [part id, module index, damage], each checked (we decide what
      // follows: deaths, cook-offs, fires), and where it came from for the hit arc (d, else the shooter's bearing)
      if (Array.isArray(m.m)) for (const row of m.m.slice(0, 32)) {
        if (!Array.isArray(row)) continue;
        const [id, i, dmg] = row, [part, owner] = find(id);
        if (!part || !part.def.mods || !Number.isInteger(i) || i < 0 || i >= part.def.mods.length || !Number.isFinite(dmg) || !(dmg > 0)) continue;
        Armour.modDamage(owner, part, i, Math.min(dmg, 2000), Flight, by, m.h === 1);
      }
    } finally { Combat.flushRips(); }
    if (m.h === 1) Armour.hot = false;
    if (v.gv && !v.dead) {
      let d = Array.isArray(m.d) && m.d.length === 3 && m.d.every(Number.isFinite) ? { x: m.d[0], y: m.d[1], z: m.d[2] } : null, l = d ? Math.hypot(d.x, d.y, d.z) : 0;
      if (!(l >= 0.1 && l <= 10) && by.parts) { d = { x: by.x - v.x, y: by.y - v.y, z: by.z - v.z }; l = Math.hypot(d.x, d.y, d.z); }
      if (l > 0 && Number.isFinite(l)) Armour.hurt(v, { x: d.x / l, y: d.y / l, z: d.z / l }, m.k === 'pen' ? 'pen' : 'np', Flight);
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
    // (an anti-tank missile goes as one against the ground, and a wire-guided or top-attack one tells nobody it's
    // coming, now or in its updates: it has no seeker a warning receiver would hear)
    const id = this.nextMissile++, gr = w.seek === 'ground' || w.seek === 'saclos' || w.seek === 'top', quiet = gr && w.seek !== 'ground';
    this.missiles.set(s, { id, at: 0, quiet });
    const tgt = s.target && s.target.remote && !quiet ? s.target.remote : 0;
    Net.send({ t: 'msl', id, b: s.b.id, P: [s.x, s.y, s.z], V: [s.vx, s.vy, s.vz], D: [s.dx, s.dy, s.dz], tg: tgt, radar: w.radar ? 1 : 0, glide: w.glide ? 1 : 0, agm: gr ? 1 : 0 });
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
      Net.send({ t: 'mp', id: M.id, P: [r(s.x), r(s.y), r(s.z)], V: [r(s.vx), r(s.vy), r(s.vz)], D: [+s.dx.toFixed(3), +s.dy.toFixed(3), +s.dz.toFixed(3)], tg: !M.quiet && s.target && s.target.remote ? s.target.remote : 0 });
    }
  },
  sendShot(s) { // bombs, rockets and shells: the others fly a copy for show
    if (!this.shared) return;
    const m = { t: 'shot', k: s.k, b: s.b.id, P: [s.x, s.y, s.z], V: [s.vx, s.vy, s.vz], D: [s.dx || 0, s.dy || 0, s.dz || 0], burn: s.burn || 0, accel: s.accel || 0, small: s.small ? 1 : 0, torpedo: s.torpedo ? 1 : 0 };
    if (s.k === 'shell') m.sh = s.sh; // (which round: SHELLS)
    Net.send(m);
  },
  sendGun(key, on) { if (this.shared) Net.send({ t: 'gun', k: key, on: on ? 1 : 0 }); },
  sendSmoke(v, c) { if (this.shared && v === Flight.active) Net.send({ t: 'cm', smoke: 1, P: [c.x, c.y, c.z], D: [c.dx || 0, c.dy || 0, c.dz || 0] }); }, // (a smoke grenade's cloud: Aim.netSmoke)
  sendFlares(v, f) { if (this.shared && v === Flight.active) Net.send({ t: 'cm', P: [f.x, f.y, f.z], V: [f.vx, f.vy, f.vz], chaff: f.chaff ? (f.str > 1 ? 2 : 1) : 0 }); }, // (chaff 2: a dispenser's bundle)
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

  // ------------------------------------------------------------------ ground battles: the objective and spotting
  // the host's tickets and zones, between whole states: { tk: [a, b], z: [[own, p×100], ...] }, one row a zone
  onObj(m) {
    const o = this.state && this.state.obj;
    if (Net.isHost || m.f !== 1 || !o || !this.ground) return;
    if (!mpNums(m.tk, 2) || !Array.isArray(m.z) || m.z.length !== o.zones.length || !m.z.every((r) => mpNums(r, 2))) return;
    o.tk[0] = clamp(Math.round(m.tk[0]), 0, 99999); o.tk[1] = clamp(Math.round(m.tk[1]), 0, 99999);
    m.z.forEach(([own, p], i) => { const zn = o.zones[i]; zn.own = own === 0 || own === 1 ? own : -1; zn.p = clamp(Math.round(p), -100, 100) / 100; });
  },
  // host: a player says which enemies they see (at most 6, 1 Hz, by hand too: man) or pings a spot on the map (pt);
  // their team hears it as `spot`. Only real enemies of theirs count, twice a second at most.
  onSeen(m) {
    const s = this.state, p = this.player(m.f);
    if (!Net.isHost || !this.ground || !s || s.phase !== 'battle' || !p) return;
    const now = performance.now(), R = this.seenAt || (this.seenAt = new Map()), last = R.get(m.f) || [-1e9, -1e9];
    if (now - last[0] < 1000) return; // (two in the last second already)
    R.set(m.f, [last[1], now]);
    const ids = [];
    if (Array.isArray(m.ids)) for (const id of m.ids.slice(0, 6)) if (Number.isSafeInteger(id) && !ids.includes(id) && this.player(id) && this.enemy(m.f, id)) ids.push(id);
    const pt = mpNums(m.pt, 2) ? [clamp(Math.round(m.pt[0]), -1e6, 1e6), clamp(Math.round(m.pt[1]), -1e6, 1e6)] : null;
    if (!ids.length && !pt) return;
    const out = { t: 'spot', ids, by: m.f, man: m.man === 1 ? 1 : 0 };
    if (pt) out.pt = pt;
    for (const q of s.players) {
      if (q.pid === m.f || q.team !== p.team) continue;
      if (q.pid === Net.me) this.onSpot({ ...out, f: 1 }); else Net.send(out, q.pid);
    }
  },
  // a teammate spotted these (the host passes it on): marked for 3 s, 15 s when they did it by hand; a map ping for 10 s
  onSpot(m) {
    if (m.f !== 1 || !this.ground || !Array.isArray(m.ids)) return;
    const now = performance.now(), man = m.man === 1;
    for (const id of m.ids.slice(0, 6)) if (Number.isSafeInteger(id) && this.enemy(Net.me, id)) { const S = this.spots.get(id); this.spots.set(id, { t: now, man: man || !!(S && S.man && now - S.t < 15000) }); }
    if (mpNums(m.pt, 2) && Number.isSafeInteger(m.by)) {
      this.pings = this.pings.filter((q) => now - q.t < 10000);
      this.pings.push({ e: m.pt[0], z: m.pt[1], by: m.by, t: now }); while (this.pings.length > 4) this.pings.shift();
    }
  },
  // (for the HUD) we spot these enemies (by hand: man; pt: a place on the map, [e, z]): our team marks them too
  sendSeen(ids, man, pt) {
    if (!this.shared || !this.ground || this.phase !== 'battle') return;
    const msg = { t: 'seen', ids: (Array.isArray(ids) ? ids : []).filter(Number.isSafeInteger).slice(0, 6), man: man ? 1 : 0 };
    if (pt && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) msg.pt = [Math.round(pt[0]), Math.round(pt[1])];
    if (man) for (const id of msg.ids) this.spots.set(id, { t: performance.now(), man: true }); // (we see our own marks)
    if (Net.isHost) this.onSeen({ ...msg, f: Net.me }); else Net.send(msg, 1);
  },
  // Is that player's craft spotted (shown: a tag, the minimap)? Friends always. In a ground battle an enemy is when:
  // within 250 m; in our sight (Aim.sees: the ground, wrecks and smoke in the way) within 1.5 km (+25% with a living
  // commander), 3 km between the ground and the air; a teammate spotted it in the last 3 s, or by hand in the last 15 s;
  // or it fired its main gun within 2.5 km in the last 3 s. Aircraft see aircraft as in an air battle (6 km).
  spotted(pid, eye) {
    if (!this.pvp || (!this.ffa() && this.teamOf(pid) === this.teamOf(Net.me))) return true;
    const P = this.peers.get(pid), g = P && P.ghost;
    if (!g || g.dead || !g.parts.length) return false;
    const me = eye || Flight.spectate || Flight.active;
    if (!me) return false;
    if (!this.ground) return MPUI.spotted(g, me, Flight);
    const now = performance.now(), S = this.spots.get(pid);
    if (S && now - S.t < (S.man ? 15000 : 3000)) return true;
    const d = Math.hypot(g.x - me.x, g.y - me.y, g.z - me.z);
    if (d < 250) return true;
    if (P.firedAt && now - P.firedAt < 3000 && d < 2500) return true;
    return this.sees(me, g, d);
  },
  // our own eyes: aircraft by aircraft within 6 km (as an air battle), else Aim.sees within 1.5 km (+25% with a commander)
  // or 3 km between the ground and the air
  sees(me, g, d) {
    const airMe = mpAir(me.kind), airG = mpAir(g.kind);
    if (airMe && airG) return d < 6000 * (1 - 0.5 * Combat.stealthOf(g));
    const reach = airMe !== airG ? 3000 : me.gv && Armour.has(me, 'commander') ? 1875 : 1500;
    return d < reach && Aim.sees(me, g, Aim.eyes(me)); // (a thermal sight sees through smoke)
  },
  // once a second in a ground battle: the enemies we see go to the host (for our team), and our living troops
  groundReports() {
    const now = performance.now(), v = Flight.active;
    if (!this.shared || !v || Flight.destroyed || now - (this.reportAt || 0) < 1000) return;
    this.reportAt = now;
    const ids = [];
    for (const [pid, P] of this.peers) {
      const g = P.ghost;
      if (!g || g.dead || !g.parts.length || !this.enemy(Net.me, pid)) continue;
      const d = Math.hypot(g.x - v.x, g.y - v.y, g.z - v.z);
      if (d < 250 || this.sees(v, g, d)) ids.push(pid);
      if (ids.length >= 6) break;
    }
    if (ids.length) this.sendSeen(ids, 0);
    const n = v.gv ? mpTroops(v) : 0;
    if (n !== this.troopsSent) { this.troopsSent = n; this.setMine('troops', n); }
    // out of the battle area: a warning only, every 5 s while out (aircraft fly where they like)
    const A = EARTH.arenas && EARTH.arenas[this.state.settings.arena], B = A && A.box, q = mpEZ(v.x, v.y, v.z, this.repQ || (this.repQ = {}));
    if (B && v.body === EARTH && !mpAir(v.kind) && (q.e < B.e0 || q.e > B.e1 || q.z < B.z0 || q.z > B.z1) && now - (this.oobAt || 0) > 5000) { this.oobAt = now; UI.toast('Out of the battle area: the zones are behind you', 'warn'); }
  },
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
