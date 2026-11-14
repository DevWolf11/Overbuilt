'use strict';
// Multiplayer screens and overlays: connect and lobby, the spawn map, the phase bar (timer, money, ready),
// chat, the kill feed, the scoreboard, results, and the in-flight tags on other players' craft.

const MPUI = {
  bound: false,

  // ------------------------------------------------------------------ connect and lobby
  open() {
    this.bind();
    App.showMP();
    this.refresh();
    if (!MP.active) setTimeout(() => { const n = $('#mp-name'); if (!n.value && !isTouch) n.focus(); }, 50);
  },
  bind() {
    if (this.bound) return;
    this.bound = true;
    const name = $('#mp-name');
    name.value = store.get('rss.mp.name', '');
    name.addEventListener('change', () => { store.set('rss.mp.name', name.value.trim().slice(0, 18)); if (MP.live) MP.setMine('name', MP.myName()); });
    const tr = store.get('rss.mp.tr', 'p2p');
    const seg = $('#mp-transport');
    const setTr = (t) => { store.set('rss.mp.tr', t); for (const b of seg.querySelectorAll('.kind-btn')) b.setAttribute('aria-checked', String(b.dataset.tr === t)); };
    seg.addEventListener('click', (e) => { const b = e.target.closest('.kind-btn'); if (b) { setTr(b.dataset.tr); Sound.click(); } });
    setTr(tr);
    const busy = (on, text, err) => {
      for (const id of ['#mp-create-sandbox', '#mp-create-pvp', '#mp-create-ground', '#mp-practice']) $(id).disabled = on;
      const jb = $('#mp-join'), joining = on && this.connecting && this.connecting.join; // (a join can wait a minute on a host: let the player call it off)
      jb.textContent = joining ? 'Cancel' : 'Join'; jb.classList.toggle('primary', !joining); jb.disabled = on && !joining;
      const st = $('#mp-status'); st.textContent = text || ''; st.classList.toggle('err', !!err);
    };
    const go = async (fn, wait, isJoin) => {
      if (this.connecting) return; // (one attempt at a time)
      store.set('rss.mp.name', name.value.trim().slice(0, 18));
      if (!name.value.trim()) { name.value = MP.myName(); }
      const tok = this.connecting = { join: !!isJoin };
      busy(true, wait);
      try {
        await fn((text) => { if (this.connecting === tok) busy(true, text); }); // (how a join is going)
        if (this.connecting !== tok) { MP.active && MP.end(); return; } // abandoned (left the screen meanwhile)
        busy(false, ''); this.refresh(); Sound.chime();
      } catch (e) { if (this.connecting === tok) { busy(false, e.message || String(e), true); MP.active && MP.end(); } } // (an abandoned attempt leaves any newer session alone)
      finally { if (this.connecting === tok) this.connecting = null; }
    };
    this.abandon = () => { if (this.connecting) { this.connecting = null; busy(false, ''); Net.leave(true); } };
    const transport = () => store.get('rss.mp.tr', 'p2p');
    $('#mp-create-sandbox').addEventListener('click', () => go(() => MP.host('sandbox', transport()), 'Opening a room…'));
    $('#mp-create-pvp').addEventListener('click', () => go(() => MP.host('pvp', transport()), 'Opening a room…'));
    $('#mp-create-ground').addEventListener('click', () => go(() => MP.host('pvp', transport(), { game: 'ground' }), 'Opening a room…'));
    $('#mp-practice').addEventListener('click', () => { if (!this.connecting && !MP.active) this.practice(); });
    const join = () => go((status) => MP.join($('#mp-join-code').value, transport(), status), 'Joining…', true);
    const stoppable = () => this.connecting && this.connecting.join && !MP.active; // (still looking for the host, not yet in)
    $('#mp-join').addEventListener('click', () => { if (!this.connecting) join(); else if (stoppable()) this.abandon(); });
    $('#mp-join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.repeat) { if (isTouch) e.target.blur(); if (stoppable()) this.abandon(); join(); } }); // (a corrected code starts over; the keyboard goes away)
    $('#mp-back').addEventListener('click', () => this.leave());
    $('#mp-test').addEventListener('click', () => this.testNetwork());
    $('#mp-code').addEventListener('click', () => {
      const code = Net.code;
      try { navigator.clipboard.writeText(code).then(() => UI.toast('Room code copied'), () => UI.toast(`Room code: ${code}`)); } catch (e) { UI.toast(`Room code: ${code}`); }
    });
    $('#mp-chat-form').addEventListener('submit', (e) => { e.preventDefault(); const i = $('#mp-chat-input'); this.say(i.value); i.value = ''; });
    $('#mp-ready').addEventListener('click', () => { const me = MP.me; if (me) MP.setMine('ready', !me.ready); Sound.click(); });
    $('#mp-start').addEventListener('click', () => this.start());
    $('#mp-hangar').addEventListener('click', () => { App.toBuild(); });
    // overlays
    $('#mp-ready-btn').addEventListener('click', () => { MP.toggleReady(); Sound.click(); });
    $('#mp-spawn-btn').addEventListener('click', () => { if (MP.ground) this.respawnPanel(this.koBy || 0); else this.openSpawnMap(); }); // (a ground battle: Respawn)
    $('#mp-lineup').addEventListener('click', (e) => { const b = e.target.closest('[data-slot]'); if (b && +b.dataset.slot > 0) this.lineupPick(+b.dataset.slot); });
    $('#mp-score-btn').addEventListener('click', () => this.toggleScore());
    $('#spawn-done').addEventListener('click', () => this.closeSpawnMap());
    $('#spawn-map').addEventListener('pointerdown', (e) => { if (e.target.id === 'spawn-map') this.closeSpawnMap(); });
    const cv = $('#spawn-canvas');
    cv.addEventListener('pointerdown', (e) => this.spawnClick(e));
    const hi = $('#mp-hud-input');
    hi.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.say(hi.value); hi.value = ''; this.chatInput(false); }
      else if (e.key === 'Escape') { hi.value = ''; this.chatInput(false); }
    });
    addEventListener('keydown', (e) => {
      if (!MP.live || e.repeat) return;
      const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
      if (typing) return;
      if (Controls.editing) return;
      if (Keys.is(e.code, 'score')) { this.showScore(true); e.preventDefault(); }
      if (App.scene === 'flight' && Keys.is(e.code, 'chat') && !UI.modalOpen) { e.preventDefault(); this.chatInput(true); }
      if (App.scene === 'flight' && Flight.destroyed && (Keys.is(e.code, 'prevCraft') || Keys.is(e.code, 'nextCraft'))) this.spectate(Keys.is(e.code, 'prevCraft') ? -1 : 1);
    }, true);
    addEventListener('keyup', (e) => { if (Keys.is(e.code, 'score') && !this.scoreSticky) this.showScore(false); });
  },
  // Can online play get through this network? Matchmaking server, direct links, relay: a verdict in plain words.
  async testNetwork() {
    const b = $('#mp-test');
    if (b.disabled) return;
    b.disabled = true; b.textContent = 'Testing… (10 s)';
    let r;
    try { r = await Net.probe(); } catch (e) { r = null; }
    b.disabled = false; b.textContent = 'Test this network';
    if (!r) { UI.toast('The test couldn’t run in this browser', 'warn'); return; }
    const relay = r.relay.length ? `gets through (${r.relay.map((p) => ({ udp: 'UDP', tcp: 'TCP', tls: 'TLS, port 443' })[p] || p).join(', ')})` : r.relaySetUp ? 'blocked' : 'none set up in the game yet';
    const verdict = !r.server ? 'This network blocks the matchmaking server (peerjs.com), so online rooms can’t open or be joined from here. “This device” still works.'
      : r.relay.length ? (r.direct ? 'Online play should work here: direct links get out, and the relay covers friends on stricter networks.' : 'This network blocks direct links, but the relay gets through, so online play works here through the relay.')
      : r.direct ? 'Direct links get out of this network, so online play should work, unless your friend’s network is a strict one (a relay would cover that).'
      : r.relaySetUp ? 'This network blocks direct links, and the relay too, so online play can’t get out of here.'
      : 'This network blocks direct links (it blocks UDP, as many school and office networks do). Online play needs a relay server to get out of here, and the game doesn’t have one set up yet.';
    const row = (ok, name, text) => el('div', { class: 'mp-test-row' + (ok ? ' ok' : '') }, el('span', { text: ok ? '✓' : '✗' }), el('b', { text: name }), el('span', { text }));
    UI.modal({ kicker: 'Online play', title: 'This network', body: el('div', { class: 'mp-test-out' },
      row(r.server, 'Matchmaking server', r.server ? 'reachable' : 'blocked'),
      row(r.direct, 'Direct links (UDP)', r.direct ? 'get out' : 'blocked'),
      row(r.relay.length > 0, 'Relay server', relay),
      el('p', { text: verdict })), actions: [{ label: 'OK', primary: true }] });
  },
  say(text) {
    text = String(text || '').trim().slice(0, 140);
    if (!text || !MP.live) return;
    Net.send({ t: 'chat', text });
    this.chat(Net.me, text);
  },
  async leave() {
    if (!MP.active) { if (this.abandon) this.abandon(); App.toHome(); return; }
    UI.modal({
      kicker: Net.isHost ? 'You are the host' : `Room ${Net.code}`, title: 'Leave the room?',
      body: Net.isHost ? 'The room closes for everyone when the host leaves.' : 'You can join again with the same code.',
      actions: [{ label: 'Stay' }, { label: Net.isHost ? 'Close the room' : 'Leave', danger: true, primary: true, onClick: () => MP.end() }],
    });
  },
  start() {
    const s = MP.state;
    if (!s || !Net.isHost) return;
    const need = MP_FORMATS[s.settings.format].n, have = s.players.length;
    const go = () => MP.startMatch();
    if (have < 2) {
      UI.modal({ kicker: 'Only you so far', title: 'Start alone?', body: `A ${s.settings.format} battle wants ${need} players. Share the room code ${Net.code}, or start anyway to try it out on your own.`,
        actions: [{ label: 'Wait' }, { label: 'Start anyway', primary: true, onClick: go }] });
      return;
    }
    if (s.settings.format !== 'ffa') {
      const n0 = s.players.filter((p) => p.team === 0).length, n1 = s.players.filter((p) => p.team === 1).length;
      if (!n0 || !n1) { UI.toast('Both teams need at least one player'); return; }
      if (n0 !== n1 || have !== need) {
        UI.modal({ kicker: `${n0} v ${n1}`, title: 'Uneven teams', body: `The teams aren’t ${s.settings.format}. Start anyway?`, actions: [{ label: 'Wait' }, { label: 'Start', primary: true, onClick: go }] });
        return;
      }
    }
    go();
  },

  // Redraw whatever is showing from MP.state.
  refresh() {
    const s = MP.state, live = MP.live;
    $('#mp-connect').hidden = live;
    $('#mp-lobby').hidden = !live;
    $('#mp-code-box').hidden = !live;
    if (live) { $('#mp-code').textContent = Net.code; $('#mp-code-box .mp-code-label').textContent = Net.offline ? 'Joining paused: reconnecting…' : 'Room code'; }
    $('#mp-kicker').textContent = live ? (s.mode === 'pvp' ? `${MP.ground ? 'Ground battle' : 'Battle'} · ${s.settings.format.toUpperCase()}` : 'Sandbox') + (Net.transport === 'local' ? ' · this device' : ' · online') : 'Multiplayer';
    $('#mp-heading').textContent = live ? (s.mode === 'pvp' ? (s.phase === 'lobby' ? 'Battle lobby' : 'Battle in progress') : 'Shared sandbox') : 'Play together';
    if (live) { this.renderPlayers(); this.renderSettings(); this.renderFoot(); }
    this.renderBar();
  },
  renderPlayers() {
    const s = MP.state, box = $('#mp-teams');
    box.innerHTML = '';
    const row = (p) => {
      const r = el('div', { class: 'mp-player' + (p.pid === Net.me ? ' me' : '') + (p.ready ? ' ready' : '') });
      const status = s.mode === 'sandbox' ? (p.flying ? 'flying' : 'hangar') : s.phase === 'lobby' ? '' : p.alive ? 'alive' : p.flying ? 'flying' : '';
      r.append(el('span', { class: 'mp-ready-dot', title: p.ready ? 'Ready' : '' }), el('span', { class: 'mp-pname', text: p.name }),
        el('span', { class: 'mp-tag' + (p.pid === 1 ? ' host' : ''), text: p.pid === 1 ? 'host' : status || '·' }),
        el('span', { class: 'mp-ping' + (p.ping > 250 ? ' bad' : ''), text: p.pid === Net.me && !Net.isHost ? '' : p.pid === 1 ? '' : `${p.ping} ms` }));
      return r;
    };
    if (s.mode === 'pvp' && s.settings.format !== 'ffa') {
      const per = MP_FORMATS[s.settings.format].n / 2;
      for (const t of [0, 1]) {
        const ps = s.players.filter((p) => p.team === t);
        const team = el('div', { class: `mp-team t${t}` });
        const head = el('div', { class: 'mp-team-head' }, el('b', { text: MP_TEAM_NAMES[t] }), el('span', { class: 'muted', text: `${ps.length}/${per}` }));
        if (s.phase === 'lobby' && MP.me && MP.me.team !== t) {
          const b = el('button', { class: 'btn small', text: 'Join' });
          b.addEventListener('click', () => { MP.setMine('team', t); Sound.click(); });
          head.append(b);
        }
        team.append(head);
        for (const p of ps) team.append(row(p));
        for (let i = ps.length; i < per; i++) team.append(el('div', { class: 'mp-empty', text: 'Open slot' }));
        box.append(team);
      }
    } else {
      const team = el('div', { class: 'mp-team' });
      team.append(el('div', { class: 'mp-team-head' }, el('b', { text: s.mode === 'pvp' ? 'Free-for-all' : 'In the room' }), el('span', { class: 'muted', text: `${s.players.length}/${s.mode === 'pvp' ? 6 : 5}` })));
      for (const p of s.players) team.append(row(p));
      box.append(team);
    }
  },
  renderSettings() {
    const s = MP.state, box = $('#mp-settings'), st = s.settings, host = Net.isHost && (s.phase === 'lobby' || s.mode === 'sandbox');
    box.innerHTML = '';
    $('#mp-settings-h').textContent = s.mode === 'pvp' ? 'Match' : 'How it works';
    const set = (label, ctl) => box.append(el('div', { class: 'mp-set' }, el('span', { text: label }), ctl));
    if (s.mode === 'sandbox') {
      box.append(el('p', { class: 'mp-explain', text: 'Everyone builds and flies whatever they like, from the usual pad, runway and helipad. You see each other’s craft, and guns and missiles hurt. Crash or get shot down and you can fly again straight away. No time warp in a shared world.' }),
        el('p', { class: 'mp-explain', text: `Share the code ${Net.code} with up to four friends. ${Net.transport === 'local' ? 'This room is on this device: open the game in another tab to join it.' : 'They join from anywhere over the internet.'}` }));
      this.partCap(st, host, set);
      this.stayHint(box);
      return;
    }
    const seg = (key, opts, val, fit) => { // (fit: as many columns as choices; the air battle's keep their four)
      const g = el('div', { class: 'kind-select' + (fit ? ` n${opts.length}` : '') });
      for (const [v, label] of opts) {
        const b = el('button', { class: 'kind-btn', text: label });
        b.setAttribute('aria-checked', String(val === v));
        b.disabled = !host;
        b.addEventListener('click', () => { MP.setSetting(key, v); Sound.click(); });
        g.append(b);
      }
      return g;
    };
    set('Game', seg('game', [['air', 'Air'], ['ground', 'Ground']], st.game === 'ground' ? 'ground' : 'air', true));
    if (st.game === 'ground') { this.renderGround(box, st, host, seg, set); return; }
    set('Format', seg('format', [['1v1', '1v1'], ['2v2', '2v2'], ['3v3', '3v3'], ['ffa', 'FFA']], st.format));
    set('Money', seg('budget', [[45000, '$45k'], [75000, '$75k'], [120000, '$120k']], st.budget));
    set('Build time', seg('build', [[120, '2 min'], [180, '3 min'], [300, '5 min']], st.build));
    const tf = el('input', { type: 'checkbox' }); tf.checked = !!st.test; tf.disabled = !host;
    tf.addEventListener('change', () => MP.setSetting('test', tf.checked));
    set('Test flight', el('label', { class: 'mp-set-inline' }, tf, el('span', { class: 'muted small', text: ' 1 min flight, then 2 min to polish' })));
    const cv = el('input', { type: 'checkbox' }); cv.checked = !!st.carriers; cv.disabled = !host;
    cv.addEventListener('change', () => MP.setSetting('carriers', cv.checked));
    set('Carriers', el('label', { class: 'mp-set-inline' }, cv, el('span', { class: 'muted small', text: ' catapult spawns: +30% money, size limits' })));
    if (st.format !== 'ffa') {
      const ff = el('input', { type: 'checkbox' }); ff.checked = !!st.ff; ff.disabled = !host;
      ff.addEventListener('change', () => MP.setSetting('ff', ff.checked));
      set('Friendly fire', ff);
    }
    set('Time of day', seg('tod', [['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']], st.tod));
    set('Time limit', seg('limit', [[600, '10 min'], [900, '15 min'], [1500, '25 min']], st.limit));
    this.partCap(st, host, set);
    if (!host) box.append(el('p', { class: 'mp-explain', text: 'The host sets up the match.' }));
    else if (s.phase === 'lobby') this.stayHint(box);
  },
  // A ground battle's settings: teams (no free-for-all), the money by era, tickets, respawns, air support, aim, then
  // as an air battle's (no carriers); the arena is the host's map's
  renderGround(box, st, host, seg, set) {
    set('Format', seg('format', [['1v1', '1v1'], ['2v2', '2v2'], ['3v3', '3v3']], st.format, true));
    const era = el('div', { class: 'kind-select mp-money' });
    for (const [v, m, e] of [[45000, '$45k', 'WWII'], [75000, '$75k', 'Cold War'], [120000, '$120k', 'Modern']]) {
      const b = el('button', { class: 'kind-btn' }, el('b', { text: m }), el('small', { text: e }));
      b.setAttribute('aria-checked', String(st.budget === v)); b.disabled = !host;
      b.addEventListener('click', () => { MP.setSetting('budget', v); Sound.click(); });
      era.append(b);
    }
    set('Money', era);
    set('Tickets', seg('tickets', [[400, '400'], [600, '600'], [900, '900']], st.tickets, true));
    set('Respawns', seg('respawn', [['free', 'Free'], ['lineup', 'Lineup of 3']], st.respawn, true));
    set('Air support', seg('air', [[false, 'Off'], [true, 'On']], !!st.air, true));
    set('Aim', seg('aim', [['arcade', 'Arcade'], ['realistic', 'Realistic']], st.aim, true));
    set('Build time', seg('build', [[120, '2 min'], [180, '3 min'], [300, '5 min']], st.build, true));
    const tf = el('input', { type: 'checkbox' }); tf.checked = !!st.test; tf.disabled = !host;
    tf.addEventListener('change', () => MP.setSetting('test', tf.checked));
    set('Test drive', el('label', { class: 'mp-set-inline' }, tf, el('span', { class: 'muted small', text: ' 1 min on your pad, then 2 min to polish' })));
    const ff = el('input', { type: 'checkbox' }); ff.checked = !!st.ff; ff.disabled = !host;
    ff.addEventListener('change', () => MP.setSetting('ff', ff.checked));
    set('Friendly fire', ff);
    set('Time of day', seg('tod', [['day', 'Day'], ['dusk', 'Dusk'], ['night', 'Night']], st.tod, true));
    set('Time limit', seg('limit', [[600, '10 min'], [900, '15 min'], [1500, '25 min']], st.limit, true));
    this.partCap(st, host, set);
    const A = EARTH.arenas && EARTH.arenas[st.arena], hill = st.arena === 'highland', flat = MP.no3D();
    set('Arena', el('div', { class: 'mp-arena' }, el('b', { text: A ? A.name : 'Runway' }),
      el('span', { class: 'muted small', text: hill ? ' · three zones in the North Scotland hills' : ' · The real map didn’t load: the battle is on the runway' }),
      ...(flat ? [el('span', { class: 'small mp-flat', text: ' · Ground battles need the 3D view: this device can’t show it' })] : [])));
    box.append(el('p', { class: 'mp-explain', text: `Build Armour or a car, then hold the zones: each team starts with ${st.tickets} tickets, and every vehicle lost costs some (a dear one more). ${st.respawn === 'lineup' ? 'Three vehicles each, every one spawns once.' : 'Respawn as often as your team has tickets.'}${st.air ? ' Knock-outs and captures earn sortie points for aircraft.' : ''}` }));
    if (!host) box.append(el('p', { class: 'mp-explain', text: 'The host sets up the match.' }));
    else if (MP.state.phase === 'lobby') this.stayHint(box);
  },
  // The host's game is the room: on a phone it can't let anyone in while the screen is off or another app is
  // in front (as when sending the code in a chat app), so say so, first thing in the card.
  // The part limit (settings.cap): on, MP_MAX_PARTS a craft; off, as many as the network carries. The host's to set: in
  // a sandbox at any time (for the next craft flown), in a battle in its lobby.
  partCap(st, host, set) {
    const c = el('input', { type: 'checkbox' }); c.checked = st.cap !== false; c.disabled = !host;
    c.addEventListener('change', () => MP.setSetting('cap', c.checked));
    set('Part limit', el('label', { class: 'mp-set-inline' }, c, el('span', { class: 'muted small',
      text: c.checked ? ` ${MP_MAX_PARTS} parts a craft. Off: as many as the network can send (about 5,000), though big craft slow down phones` : ' Off: any craft the network can send (about 5,000 parts). Big ones slow down phones' })));
  },
  stayHint(box) {
    if (Net.isHost && Net.transport !== 'local' && isTouch) box.prepend(el('p', { class: 'mp-explain mp-stay', text: 'Keep the game on screen while friends join: your phone or tablet lets them in, and it can’t while its screen is off or another app is open. After sending the code, come straight back.' }));
  },
  renderFoot() {
    const s = MP.state, me = MP.me, pvp = s.mode === 'pvp';
    $('#mp-ready').hidden = !pvp || s.phase !== 'lobby';
    $('#mp-ready').setAttribute('aria-pressed', String(!!(me && me.ready)));
    $('#mp-ready').textContent = me && me.ready ? 'Ready ✓' : 'Ready';
    $('#mp-start').hidden = !pvp || !Net.isHost || s.phase !== 'lobby';
    $('#mp-hangar').hidden = pvp;
    let note = '';
    if (pvp && s.phase === 'lobby') note = Net.isHost ? (MP.ground ? 'Start when everyone’s in. Build, (test drive), then hold the zones.' : 'Start when everyone’s in. Build, (test), then fight: one life each.') : 'Waiting for the host to start the battle.';
    else if (pvp) note = `Battle running: ${{ build: 'building', test: MP.ground ? 'test drives' : 'test flights', polish: 'final touches', battle: 'fighting', results: 'results' }[s.phase] || s.phase}.`;
    else note = 'Build anything, then fly it into the shared world.';
    $('#mp-foot-note').textContent = note;
  },

  // ------------------------------------------------------------------ the phase bar
  renderBar() {
    const bar = $('#mp-bar'), s = MP.state;
    const show = MP.live && (App.scene === 'build' || App.scene === 'flight') && (s.mode === 'pvp' ? s.phase !== 'lobby' : true);
    bar.hidden = !show;
    if (App.scene === 'build' && Builder.canvas) Builder.renderLaunch();
    if (App.scene !== 'flight' && !$('#mp-hud-chat').hidden) { $('#mp-hud-input').hidden = true; $('#mp-hud-input').blur(); $('#mp-hud-chat').hidden = true; }
    if (!show) { this.scoreSticky = false; $('#mp-score').hidden = true; return; }
    bar.classList.toggle('flight', App.scene === 'flight');
    const label = s.mode === 'sandbox' ? 'Sandbox' : { build: 'Build', test: MP.ground ? 'Test drive' : 'Test flight', polish: 'Final touches', battle: 'Battle', results: 'Results' }[s.phase] || s.phase;
    $('#mp-phase').textContent = label;
    const building = s.mode === 'pvp' && (s.phase === 'build' || s.phase === 'polish');
    $('#mp-ready-btn').hidden = !building || App.scene !== 'build';
    $('#mp-ready-btn').setAttribute('aria-pressed', String(!!(MP.me && MP.me.ready)));
    $('#mp-ready-btn').textContent = MP.me && MP.me.ready ? 'Ready ✓' : 'Ready';
    const sb = $('#mp-spawn-btn'), st = MP.ground ? 'Respawn' : 'Spawn';
    if (sb.textContent !== st) sb.textContent = st;
    if (!MP.ground) sb.hidden = !building || App.scene !== 'build'; // (a ground battle: no spawn map; Respawn once knocked out: tickGround)
    this.renderLineup(building && App.scene === 'build' && MP.ground && s.settings.respawn === 'lineup');
    bar.classList.toggle('ground', MP.ground);
    if (!MP.ground) { if ($('#mp-bar-info').hidden) $('#mp-bar-info').hidden = false; if (!$('#mp-ground').hidden) $('#mp-ground').hidden = true; if (!$('#mp-cap').hidden) $('#mp-cap').hidden = true; } // (after a ground battle)
    $('#mp-score-btn').hidden = s.mode !== 'pvp' && App.scene !== 'flight';
    if ($('#mp-score-btn').hidden && !$('#mp-score').hidden) { this.scoreSticky = false; $('#mp-score').hidden = true; }
    this.tick();
  },
  tick() {
    const s = MP.state;
    if (!MP.live || $('#mp-bar').hidden) return;
    const timer = $('#mp-timer'), fill = $('#mp-timer-fill');
    if (s.ends) {
      const left = Math.max(0, (s.ends - Net.hostNow()) / 1000);
      timer.textContent = fmtClock(left);
      fill.style.transform = `scaleX(${clamp(left / (s.endsLen || 1), 0, 1)})`;
      $('#mp-bar').classList.toggle('urgent', left < 15 && s.phase !== 'battle');
    } else { timer.textContent = s.mode === 'sandbox' ? Net.code : ''; fill.style.transform = ''; $('#mp-bar').classList.remove('urgent'); }
    // the line under the timer
    const info = $('#mp-bar-info');
    if (MP.ground) { this.tickGround(s, info); return; }
    if (s.mode === 'sandbox') info.textContent = `${s.players.length} in the room · ${s.players.filter((p) => p.flying).length} flying`;
    else if (App.scene === 'build' && Builder.statsData) {
      const cost = Builder.statsData.cost || 0, budget = MP.budgetFor(MP.spawnId);
      const sp = MP.spawnDef(MP.spawnId);
      const ready = s.players.filter((p) => p.ready).length;
      info.innerHTML = `<span class="${cost > budget ? 'over' : 'ok'}">${money(cost)}</span> / ${money(budget)} · ${sp.name} · ${ready}/${s.players.length} ready`;
    } else if (s.phase === 'battle') {
      const alive = (t) => s.players.filter((p) => p.alive && p.team === t).length;
      info.textContent = s.format === 'ffa' ? `${s.players.filter((p) => p.alive).length} of ${s.players.length} still flying` : `${MP_TEAM_NAMES[0]} ${alive(0)} · ${alive(1)} ${MP_TEAM_NAMES[1]}`;
    } else info.textContent = '';
  },

  // A ground battle's bar, 4 times a second, writing only what changed: money and readiness while building; in the
  // battle our tickets and theirs round the three zones (ours blue, theirs red, each filled as far as it's taken), a
  // capture bar while we stand in a zone, and Respawn once we're knocked out.
  tickGround(s, info) {
    const o = s.obj, me = MP.me, battle = s.phase === 'battle' && !!o;
    if (App.scene === 'build' && Builder.statsData && (s.phase === 'build' || s.phase === 'polish')) {
      const cost = Builder.statsData.cost || 0, budget = MP.budgetFor(MP.spawnId), A = EARTH.arenas && EARTH.arenas[s.settings.arena];
      const html = `<span class="${cost > budget ? 'over' : 'ok'}">${money(cost)}</span> / ${money(budget)} · ${A ? A.name : 'Runway'} · ${s.players.filter((p) => p.ready).length}/${s.players.length} ready`;
      if (info._html !== html) { info._html = html; info.innerHTML = html; } // (numbers and our own arena names only)
    } else if (info.textContent) { info._html = null; info.textContent = ''; }
    const gl = $('#mp-ground'), cap = $('#mp-cap'), rb = $('#mp-spawn-btn');
    mpSet(gl, 'hidden', !battle); mpSet(info, 'hidden', battle); // (in the battle the tickets and zones take the info line's place)
    mpSet(rb, 'hidden', !(battle && App.scene === 'flight' && Flight.destroyed && me && me.alive));
    if (!battle) { mpSet(cap, 'hidden', true); return; }
    const mine = me && me.team === 1 ? 1 : 0, sg = mine ? 1 : -1;
    mpSet($('#mp-tk0'), 'textContent', String(o.tk[mine])); mpSet($('#mp-tk1'), 'textContent', String(o.tk[1 - mine]));
    const zs = $('#mp-zones');
    if (zs.childElementCount !== o.zones.length) { zs.textContent = ''; for (const z of o.zones) zs.append(el('span', { class: 'mp-zone', 'data-z': z.id }, el('i'), el('b', { text: z.id }))); }
    o.zones.forEach((z, i) => {
      const c = zs.children[i], toUs = z.p * sg; // (how far it's ours: -1..1)
      mpSet(c, 'className', 'mp-zone' + (z.own < 0 ? '' : z.own === mine ? ' us' : ' them'));
      mpBar(c.firstElementChild, toUs);
    });
    // the zone we're in: capturing (it moves our way), losing it, holding it, or stuck (contested, or we don't count)
    const v = Flight.active, q = this.capQ || (this.capQ = {});
    let inZ = null;
    if (v && !Flight.destroyed && v.body === EARTH && Flight.running) { mpEZ(v.x, v.y, v.z, q); inZ = o.zones.find((z) => GroundMode.inZone(q.e, q.z, z)) || null; }
    mpSet(cap, 'hidden', !inZ);
    if (!inZ) { this.capWas = null; return; }
    const toUs = inZ.p * sg, was = this.capWas && this.capWas.id === inZ.id ? this.capWas.p : toUs;
    this.capWas = { id: inZ.id, p: toUs };
    const what = toUs > was + 1e-3 ? 'Capturing' : toUs < was - 1e-3 ? 'Losing' : inZ.own === mine && toUs >= 0.999 ? 'Holding' : 'Contested';
    mpSet($('#mp-cap-text'), 'textContent', `${what} ${inZ.id} · ${Math.round(Math.abs(toUs) * 100)}%`);
    mpBar($('#mp-cap-fill'), toUs);
  },

  // ------------------------------------------------------------------ spawn map
  // The battle area in the game's own frame: east along the runway to the right, game north up.
  MAP: { e0: -9000, e1: 31000, z0: -9000, z1: 21000 },
  openSpawnMap() {
    if (!MP.live || !MP.pvp || MP.ground) return; // (a ground battle: each team its pad)
    $('#spawn-map').hidden = false;
    App.afterEarth(() => this.drawSpawnMap());
    this.renderSpawnList();
    const me = MP.me;
    $('#spawn-kicker').textContent = MP.ffa() ? 'Free-for-all · pick any base' : `Team ${MP_TEAM_NAMES[me ? me.team : 0]}`;
  },
  closeSpawnMap() { $('#spawn-map').hidden = true; Builder.changed && Builder.changed(true); },
  spawnXY(sp, W, H) {
    const M = this.MAP, at = this.spawnAt(sp);
    return { x: ((at.e - M.e0) / (M.e1 - M.e0)) * W, y: ((at.z - M.z0) / (M.z1 - M.z0)) * H };
  },
  spawnAt(sp) {
    if (sp.kind === 'carrier') { const c = EARTH.carriers[sp.carrier]; return { e: c.e, z: c.z }; }
    if (sp.id === 'faroes') return { e: (EARTH.runway.from + EARTH.runway.to) / 2, z: 0 };
    const a = EARTH.airfields[sp.airfield]; return { e: a.e, z: a.z };
  },
  drawSpawnMap() {
    const cv = $('#spawn-canvas'), r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(200, Math.round(r.width * dpr)), H = Math.max(150, Math.round(r.height * dpr));
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    if (!this.mapImg || this.mapImg.width !== W || this.mapImg.height !== H) this.mapImg = this.bakeMap(W, H);
    ctx.drawImage(this.mapImg, 0, 0);
    const M = this.MAP;
    spawnMapGrid(ctx, W, H, M, dpr, 5000); // (a 5 km grid and a scale bar)
    // the spawn points: ours bright, others dim, the chosen one ringed; other players' choices as dots
    const me = MP.me, mine = new Set(MP.spawnsFor(me).map((sp) => sp.id));
    this.hot = [];
    for (const sp of MP_SPAWNS) {
      if (sp.kind === 'carrier' && !MP.state.settings.carriers) continue;
      if (!MP.ffa() && sp.team === -1) continue;
      const { x, y } = this.spawnXY(sp, W, H), ok = mine.has(sp.id), sel = MP.spawnId === sp.id;
      const col = MP.ffa() ? '#ffb547' : sp.team === 0 ? '#62d0ff' : '#ff5d5d';
      ctx.globalAlpha = ok ? 1 : 0.45;
      ctx.fillStyle = col; ctx.strokeStyle = '#05070d'; ctx.lineWidth = 2 * dpr;
      const R = (sp.kind === 'carrier' ? 8 : 10) * dpr;
      ctx.beginPath();
      if (sp.kind === 'carrier') { // the ship, bow the way it sails (east is right, z grows down the map)
        const cv = EARTH.carriers[sp.carrier], a = Math.atan2(cv.s, cv.c), c = Math.cos(a), sn = Math.sin(a);
        const pt = (u, v) => [x + u * c - v * sn, y + u * sn + v * c];
        [[-1.4, -0.5], [1.2, -0.5], [1.7, 0], [1.2, 0.5], [-1.4, 0.5]].forEach(([u, v], i) => { const [px, py] = pt(u * R, v * R); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
        ctx.closePath();
      } else { ctx.arc(x, y, R, 0, TAU); }
      ctx.fill(); ctx.stroke();
      if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); ctx.arc(x, y, R + 7 * dpr, 0, TAU); ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.font = `700 ${12 * dpr}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center';
      const label = sp.name.toUpperCase(), hw = ctx.measureText(label).width / 2 + 4 * dpr; // kept inside the map
      ctx.fillText(label, clamp(x, hw, W - hw), y - R - 9 * dpr);
      const who = MP.state.players.filter((p) => p.spawn === sp.id);
      who.forEach((p, i) => { ctx.fillStyle = p.pid === Net.me ? '#ffb547' : col; ctx.beginPath(); ctx.arc(x - (who.length - 1) * 5 * dpr + i * 10 * dpr, y + R + 9 * dpr, 3.5 * dpr, 0, TAU); ctx.fill(); });
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      if (ok) this.hot.push({ id: sp.id, x: x / dpr, y: y / dpr, r: (R / dpr) + 14 });
    }
  },
  // a satellite-coloured map of the battle area, sea shaded by depth (once per size)
  bakeMap(W, H) { return spawnMapBake(W, H, this.MAP); },
  spawnClick(e) {
    const r = $('#spawn-canvas').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = Infinity;
    for (const h of this.hot || []) { const d = Math.hypot(h.x - x, h.y - y); if (d < h.r && d < bd) { bd = d; best = h; } }
    if (best) this.pickSpawn(best.id);
  },
  pickSpawn(id) {
    if (!MP.live || MP.spawnId === id) return;
    MP.spawnId = id;
    MP.setMine('spawn', id);
    if (Builder.mp) { Builder.mp.budget = MP.budgetFor(id); Builder.mp.limits = MP.limitsFor(id); MP.setMoney(Builder.mp.budget); }
    Sound.click();
    this.drawSpawnMap(); this.renderSpawnList();
    if (App.scene === 'build') { Builder.buildPalette(); Builder.changed(true); }
    this.tick();
  },
  renderSpawnList() {
    const list = $('#spawn-list'), me = MP.me;
    list.innerHTML = '';
    const mine = MP.spawnsFor(me);
    for (const sp of mine) {
      const carrier = sp.kind === 'carrier';
      const b = el('button', { class: 'spawn-opt', role: 'radio' });
      b.setAttribute('aria-checked', String(MP.spawnId === sp.id));
      b.append(el('b', { text: sp.name }), el('span', { text: sp.desc }),
        el('span', { class: carrier ? 'bonus' : '', text: carrier ? `Budget ${money(MP.budgetFor(sp.id))} · max ${MP_CARRIER.span} m wide, ${MP_CARRIER.length} m long, ${MP_CARRIER.mass / 1000} t` : `Budget ${money(MP.budgetFor(sp.id))}` }));
      b.addEventListener('click', () => this.pickSpawn(sp.id));
      list.append(b);
    }
  },

  // ------------------------------------------------------------------ chat, notices, kill feed
  chat(pid, text) {
    const name = MP.nameOf(pid), team = MP.pvp && !MP.ffa() ? MP.teamOf(pid) : -1;
    const log = $('#mp-chat-log');
    const line = el('div', null, el('b', { text: name + ': ' }), document.createTextNode(text));
    log.append(line); while (log.children.length > 80) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
    this.hudLine(el('div', null, el('b', { class: team >= 0 ? `t${team}` : '', text: name + ': ' }), document.createTextNode(text)));
    if (pid !== Net.me) Sound.click();
  },
  notice(text) {
    const log = $('#mp-chat-log');
    log.append(el('div', { class: 'sys', text })); log.scrollTop = log.scrollHeight;
    if (App.scene === 'flight' || App.scene === 'build') {
      const feed = $('#mp-feed'), k = el('div', { class: 'kf', text });
      feed.append(k);
      while (feed.children.length > 5) feed.firstChild.remove();
      setTimeout(() => k.classList.add('out'), 5000); setTimeout(() => k.remove(), 5500);
    }
  },
  hudLine(node) {
    const box = $('#mp-hud-chat'), log = $('#mp-hud-log');
    box.hidden = !(App.scene === 'flight' && MP.live);
    log.append(node); while (log.children.length > 6) log.firstChild.remove();
    setTimeout(() => node.classList.add('old'), 9000);
  },
  chatInput(on) {
    const box = $('#mp-hud-chat'), i = $('#mp-hud-input');
    box.hidden = !on && !$('#mp-hud-log').children.length;
    i.hidden = !on;
    if (on) { box.hidden = false; Flight.keys.clear(); Flight.touchFire = false; setTimeout(() => i.focus(), 0); } else i.blur();
  },

  // ------------------------------------------------------------------ scoreboard and results
  toggleScore() { this.scoreSticky = !this.scoreSticky; this.showScore(this.scoreSticky); },
  showScore(on) {
    const box = $('#mp-score');
    if (!on || !MP.live) { box.hidden = true; return; }
    box.innerHTML = '';
    const o = MP.ground && MP.state.obj, mine = MP.me && MP.me.team === 1 ? 1 : 0;
    box.append(el('h3', { text: MP.pvp ? `Scoreboard · ${MP.state.settings.format.toUpperCase()}${o ? ` · tickets ${o.tk[mine]} – ${o.tk[1 - mine]}` : ''}` : `Room ${Net.code}` }), this.scoreTable(MP.state.players));
    box.hidden = false;
  },
  scoreTable(players, ground) {
    const t = el('table', { class: 'dv-table' });
    if (ground ?? MP.ground) return this.groundTable(t, players);
    t.innerHTML = '<thead><tr><th>Player</th><th>Team</th><th>Kills</th><th>Lost</th><th>Damage</th><th>Ping</th></tr></thead>';
    const tb = el('tbody');
    const ffa = MP.ffa();
    for (const p of [...players].sort((a, b) => (a.team - b.team) || (b.kills - a.kills))) {
      const tr = el('tr', { class: (p.alive === false && MP.phase === 'battle' ? 'dead' : '') + (p.pid === Net.me ? ' me' : '') });
      const team = MP.pvp ? (ffa ? '—' : MP_TEAM_NAMES[p.team === 1 ? 1 : 0]) : '—', n = (x) => String(Math.round(+x || 0));
      tr.append(el('td', { text: String(p.name) }), el('td', { class: MP.pvp && !ffa ? `t${p.team === 1 ? 1 : 0}` : '', text: team }), el('td', { text: n(p.kills) }),
        el('td', { text: n(p.deaths) }), el('td', { text: n(p.dmg) }), el('td', { text: p.pid === 1 ? '—' : `${n(p.ping)} ms` }));
      tb.append(tr);
    }
    t.append(tb);
    return t;
  },
  // a ground battle's: Player · Team · Kills · Caps · Lost · Score · Ping, best score first in each team (the name in its
  // team's colour: a narrow phone drops the Team column)
  groundTable(t, players) {
    t.classList.add('mp-gtable');
    t.innerHTML = '<thead><tr><th>Player</th><th>Team</th><th>Kills</th><th>Caps</th><th>Lost</th><th>Score</th><th>Ping</th></tr></thead>';
    const tb = el('tbody'), n = (x) => String(Math.round(+x || 0));
    for (const p of [...players].sort((a, b) => (a.team - b.team) || ((b.score || 0) - (a.score || 0)) || (b.kills - a.kills))) {
      const tr = el('tr', { class: (p.alive === false && MP.phase === 'battle' ? 'dead' : '') + (p.pid === Net.me ? ' me' : '') }), tm = p.team === 1 ? 1 : 0;
      tr.append(el('td', { class: `t${tm}`, text: String(p.name) }), el('td', { class: `t${tm}`, text: MP_TEAM_NAMES[tm] }), el('td', { text: n(p.kills) }), el('td', { text: n(p.caps) }),
        el('td', { text: n(p.deaths) }), el('td', { text: n(p.score) }), el('td', { text: p.pid === 1 ? '—' : `${n(p.ping)} ms` }));
      tb.append(tr);
    }
    t.append(tb);
    return el('div', { class: 'mp-twrap' }, t); // (a phone scrolls it sideways rather than cut it off)
  },
  results(r) {
    if (!r || !MP.live) return;
    const me = MP.me, ffa = r.ffa;
    let kicker, title;
    if (r.ground) { // "Shetland win on tickets (212 – 0) · Highland Ridge"
      const A = EARTH.arenas && EARTH.arenas[r.arena], where = A ? A.name : 'Runway', tk = Array.isArray(r.tk) ? r.tk.map((x) => Math.round(+x || 0)) : [0, 0];
      if (r.winner !== 0 && r.winner !== 1) { kicker = `${r.why === 'time' || r.why === 'draw' ? 'Level on tickets' : 'Both teams out'} (${tk[0]} – ${tk[1]}) · ${where}`; title = 'Draw'; }
      else { kicker = `${MP_TEAM_NAMES[r.winner]} win ${{ tickets: 'on tickets', wiped: 'with nobody left against them', time: 'on time' }[r.why] || ''} (${tk[r.winner]} – ${tk[1 - r.winner]}) · ${where}`; title = me && me.team === r.winner ? 'Victory!' : 'Defeat'; }
      const body = el('div');
      body.append(this.scoreTable(r.players, true));
      const actions = Net.isHost ? [{ label: 'Leave', onClick: () => MP.end() }, { label: 'Back to the lobby', primary: true, onClick: () => MP.backToLobby() }]
        : [{ label: 'Leave', onClick: () => MP.end() }, { label: 'Waiting for the host…', keepOpen: true }];
      MP.modalLocked = true;
      UI.modal({ kicker, title, body, actions, onClose: () => { MP.modalLocked = false; } });
      if (title === 'Victory!') Sound.chime();
      return;
    }
    if (r.winner == null) { kicker = r.why === 'time' ? 'Time is up' : 'Everyone went down'; title = 'Draw'; }
    else if (ffa) { const w = r.players.find((p) => p.pid === r.winner || p.team === r.winner); kicker = 'Last one flying'; title = w && w.pid === Net.me ? 'Victory!' : `${w ? w.name : 'Someone'} wins`; }
    else { kicker = `${MP_TEAM_NAMES[r.winner]} win${r.why === 'time' ? ' on time' : ''}`; title = me && me.team === r.winner ? 'Victory!' : 'Defeat'; }
    const body = el('div');
    body.append(this.scoreTable(r.players));
    const actions = Net.isHost ? [{ label: 'Leave', onClick: () => MP.end() }, { label: 'Back to the lobby', primary: true, onClick: () => MP.backToLobby() }]
      : [{ label: 'Leave', onClick: () => MP.end() }, { label: 'Waiting for the host…', keepOpen: true }];
    MP.modalLocked = true;
    UI.modal({ kicker, title, body, actions, onClose: () => { MP.modalLocked = false; } });
    if (title === 'Victory!') Sound.chime();
  },

  // ------------------------------------------------------------------ in flight
  // after a crash in battle: watch another player's craft
  // how to switch to another player while spectating: a tap on touch controls, else the keys bound to it ([ ])
  switchWord() { return typeof Controls !== 'undefined' && Controls.touch ? 'tap' : typeof Keys !== 'undefined' ? `${Keys.k('prevCraft')} ${Keys.k('nextCraft')}` : '[ ]'; },
  spectate(dir) {
    const list = MP.ghosts().sort((a, b) => (MP.teamOf(a.remote) === MP.teamOf(Net.me) ? 0 : 1) - (MP.teamOf(b.remote) === MP.teamOf(Net.me) ? 0 : 1) || a.remote - b.remote);
    if (!list.length) { Flight.spectate = null; return; }
    const i = list.indexOf(Flight.spectate);
    Flight.spectate = list[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + list.length) % list.length];
    UI.toast(`Watching ${MP.nameOf(Flight.spectate.remote)}`);
  },
  // name tags over other players' craft, team colours; radar lock warning; who you are watching
  drawHUD(ctx, W, H, dpr, F) {
    if (!MP.shared || !Render3D.ready) return;
    const me = F.spectate || F.active;
    if (!me) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    const myTeam = MP.teamOf(Net.me);
    for (const g of MP.ghosts()) {
      if (g === F.spectate) continue;
      const bp = bodyPos(g.body, F.time), c = g.toWorld(g.com.x, g.com.y, g.com.z || 0), d = Math.hypot(c.x - me.x, c.y - me.y, c.z - me.z);
      const friend = MP.pvp && !MP.ffa() && MP.teamOf(g.remote) === myTeam;
      if (!this.spotted(g, me, F)) continue;
      const s = Render3D.project(bp.x + c.x, bp.y + c.y, c.z);
      if (s.behind) continue;
      const col = !MP.pvp ? '#ffb547' : friend ? '#62d0ff' : '#ff5d5d';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
      const k = d > 1500 ? 7 : 5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y - k - 14); ctx.lineTo(s.x + k, s.y - 14); ctx.lineTo(s.x, s.y + k - 14); ctx.lineTo(s.x - k, s.y - 14); ctx.closePath();
      if (friend) ctx.fill(); else ctx.stroke();
      ctx.font = '600 11px "Chakra Petch", system-ui, sans-serif';
      mpTag(ctx, MP.nameOf(g.remote), s.x, s.y - 26, W);
      if (d > 300) { ctx.font = '500 10px "IBM Plex Mono", monospace'; ctx.globalAlpha = 0.8; mpTag(ctx, fmt.dist(d), s.x, s.y - 38, W); ctx.globalAlpha = 1; }
      if (!friend && typeof Radar !== 'undefined') Radar.mark(g, s.x, s.y - 14); // (a tap on an enemy's tag picks it: radar.js)
    }
    // (the big update) the other players' drones from their tanks' bays: "Ann's drone", only while our eyes or sensors
    // mark it (Drone.marked: 400 m by eye, a detector, a Drone Radar), a small diamond
    if (typeof Drone !== 'undefined' && MP.extraGhosts) for (const g of MP.extraGhosts()) {
      if (g === F.spectate || !F.active || !Drone.marked(F.active, g)) continue;
      const bp = bodyPos(g.body, F.time), c = g.toWorld(g.com.x, g.com.y, g.com.z || 0), d = Math.hypot(c.x - me.x, c.y - me.y, c.z - me.z);
      const s = Render3D.project(bp.x + c.x, bp.y + c.y, c.z);
      if (s.behind) continue;
      const friend = MP.pvp && !MP.ffa() && MP.teamOf(g.remote) === myTeam, col = !MP.pvp ? '#ffb547' : friend ? '#62d0ff' : '#ff5d5d', k = 4;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y - k - 10); ctx.lineTo(s.x + k, s.y - 10); ctx.lineTo(s.x, s.y + k - 10); ctx.lineTo(s.x - k, s.y - 10); ctx.closePath();
      if (friend) ctx.fill(); else ctx.stroke();
      ctx.font = '600 10px "Chakra Petch", system-ui, sans-serif';
      mpTag(ctx, g.name, s.x, s.y - 20, W);
      if (d > 300) { ctx.font = '500 10px "IBM Plex Mono", monospace'; ctx.globalAlpha = 0.8; mpTag(ctx, fmt.dist(d), s.x, s.y - 32, W); ctx.globalAlpha = 1; }
    }
    // (a radar lock on us shows only with a warning receiver on board: Combat's RWR display)
    if (!MP.ground) this.drawRadar(ctx, W, H, F, me); // (a ground battle has its own minimap: ghud.js)
    if (F.destroyed && F.spectate) {
      ctx.font = '600 13px "Chakra Petch", system-ui, sans-serif'; ctx.fillStyle = '#e9edf1';
      ctx.fillText(`Watching ${MP.nameOf(MP.pidOf(F.spectate))} · ${this.switchWord()} to switch`, W / 2, H - 40); // (their craft, or its hulk falling: foreign)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  },

  // Can we see another player's craft? Friends (and everyone in the sandbox) always; enemies within about 6 km by
  // eye (less for a stealthy one), or further while our own radar part holds them (radar.js).
  spotted(g, me, F) {
    if (!MP.pvp || (!MP.ffa() && MP.teamOf(g.remote) === MP.teamOf(Net.me))) return true;
    if (MP.ground) return MP.spotted(g.remote, me); // (a ground battle: sight lines, spotting by the team, gun flashes)
    const d = Math.hypot(g.x - me.x, g.y - me.y, g.z - me.z);
    if (d < 6000 * (1 - 0.5 * Combat.stealthOf(g))) return true;
    // further only on our own radar: what its last scan held (radar.js: its cone, its reach less their stealth, look-down,
    // notching, the ground in the way; nothing with the radar off or no radar part aboard)
    return !F.destroyed && !!F.active && typeof Radar !== 'undefined' && Radar.has(g);
  },
  // A heading-up radar scope under the flight data (wide screens): 8 km round; friends, spotted enemies, bases.
  drawRadar(ctx, W, H, F, me) {
    if (W < 761) return;
    const now = performance.now();
    if (!this.scopeAt || now - this.scopeAt > 1000) { // where it fits: between the flight data and the controls
      this.scopeAt = now;
      const t = $('#flight-ui .telemetry'), lc = $('#flight-ui .left-controls');
      const top = t ? t.getBoundingClientRect().bottom : 220, bottom = lc ? lc.getBoundingClientRect().top : H - 260;
      this.scope = bottom - top >= 132 ? { x: (t ? t.getBoundingClientRect().left : 12) + 62, y: top + 12 + 58, R: 58 } : null;
    }
    const S = this.scope;
    if (!S) return;
    const up = norm3(v3(me.x, me.y, me.z)), f0 = me.axis(me.pilot.F.x, me.pilot.F.y, me.pilot.F.z), fu = dot3(f0, up);
    let fw = v3(f0.x - up.x * fu, f0.y - up.y * fu, f0.z - up.z * fu);
    if (len3(fw) < 1e-3) fw = surfaceFrame(me.x, me.y, me.z).east;
    norm3(fw);
    const rt = cross3(fw, up), K = S.R / 8000;
    const at = (x, y, z) => { const dx = x - me.x, dy = y - me.y, dz = z - me.z, X = (dx * rt.x + dy * rt.y + dz * rt.z) * K, Y = (dx * fw.x + dy * fw.y + dz * fw.z) * K; return { x: S.x + X, y: S.y - Y, in: X * X + Y * Y <= S.R * S.R }; };
    ctx.save();
    ctx.fillStyle = 'rgba(8, 13, 24, 0.72)'; ctx.strokeStyle = 'rgba(150, 185, 230, 0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(S.x, S.y, S.R, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(S.x, S.y, S.R / 2, 0, TAU); ctx.moveTo(S.x, S.y - S.R); ctx.lineTo(S.x, S.y + S.R); ctx.moveTo(S.x - S.R, S.y); ctx.lineTo(S.x + S.R, S.y);
    ctx.strokeStyle = 'rgba(150, 185, 230, 0.13)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(S.x, S.y, S.R, 0, TAU); ctx.clip();
    // airfields and carriers
    if (!this.bases) this.bases = [...MP_SPAWNS.map((sp) => {
      const f = sp.kind === 'carrier' ? EARTH.carriers[sp.carrier] : sp.airfield ? EARTH.airfields[sp.airfield] : { e: EARTH.runway.from + 1000, z: 0 };
      const a = siteAngle(EARTH, f.e), ph = f.z / EARTH.radius, r = EARTH.radius;
      return { sp, x: r * Math.cos(ph) * Math.cos(a), y: r * Math.cos(ph) * Math.sin(a), z: r * Math.sin(ph) };
    })];
    for (const B of this.bases) {
      if (B.sp.team === -1 && !MP.ffa()) continue;
      const p = at(B.x, B.y, B.z);
      if (!p.in) continue;
      ctx.fillStyle = 'rgba(200, 212, 228, 0.55)';
      if (B.sp.kind === 'carrier') ctx.fillRect(p.x - 4, p.y - 1.5, 8, 3); else ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    }
    for (const g of MP.ghosts()) {
      if (!this.spotted(g, me, F)) continue;
      const p = at(g.x, g.y, g.z), friend = !MP.pvp || (!MP.ffa() && MP.teamOf(g.remote) === MP.teamOf(Net.me));
      const ex = Math.min(1, S.R / Math.max(1, Math.hypot(p.x - S.x, p.y - S.y))); // off the scope: pinned to its edge
      const x = p.in ? p.x : S.x + (p.x - S.x) * ex * 0.97, y = p.in ? p.y : S.y + (p.y - S.y) * ex * 0.97;
      ctx.fillStyle = !MP.pvp ? '#ffb547' : friend ? '#62d0ff' : '#ff5d5d';
      ctx.beginPath(); ctx.arc(x, y, MP.rwr.has(g.remote) && Combat.S.rwr > 1 ? 4.5 : 3.2, 0, TAU); ctx.fill(); // (bigger: its radar holds us, as the threat display tells)
    }
    ctx.restore();
    ctx.fillStyle = '#e9edf1'; ctx.beginPath(); ctx.moveTo(S.x, S.y - 6); ctx.lineTo(S.x + 4, S.y + 4); ctx.lineTo(S.x - 4, S.y + 4); ctx.closePath(); ctx.fill();
    ctx.font = '500 9px "IBM Plex Mono", monospace'; ctx.fillStyle = 'rgba(150, 185, 230, 0.7)'; ctx.textAlign = 'left';
    ctx.fillText('8 km', S.x + S.R - 22, S.y + S.R - 4);
    ctx.textAlign = 'center';
  },

  // ------------------------------------------------------------------ ground battles: respawns, the lineup, practice
  // Knocked out: back in once the host's respawn time comes. Free respawns: our vehicle again, another one (a saved
  // design or a stock one within the money), or with air support and a sortie point an aircraft; a Lineup of 3: the
  // slots not yet used. Big buttons for thumbs; built with el() (names from peers stay text).
  respawnPanel(by) {
    if (!MP.ground || !MP.live || MP.phase !== 'battle' || !Flight.destroyed || !MP.me) return;
    this.koBy = by || 0;
    const st = MP.state.settings, lineup = st.respawn === 'lineup';
    // the countdown to the host's respawn time (the buttons that spawn wait for it)
    const state = () => {
      const me = MP.me;
      if (!me || MP.phase !== 'battle') return null;
      const o = MP.state.obj, left = Math.ceil(((me.respawnAt || 0) - 300 - Net.hostNow()) / 1000), out = !o || !(o.tk[me.team] > 0), none = lineup && !me.alive && !me.flying; // (none: the host says no slot we can take is left)
      return { text: out ? 'Your team is out of tickets.' : none ? 'No vehicle you can take: watching the rest of the battle' : left > 0 ? `Back in the fight in ${left} s` : lineup ? 'Pick a slot' : 'Pick your vehicle', wait: out || none || left > 0 };
    };
    const go = (d, slot) => { if (!MP.respawnWith(d, slot)) UI.toast('Not yet: wait for the timer', 'warn'); };
    const airOk = () => { const me = MP.me; return !!me && (me.sorties || 0) > 0 && Net.hostNow() - (me.sortieEnd || -1e9) >= 60000; };
    const airText = () => { const me = MP.me, n = (me && me.sorties) || 0, w = me ? Math.ceil((60000 - (Net.hostNow() - (me.sortieEnd || -1e9))) / 1000) : 0;
      return !n ? 'Knock-outs and captures earn sortie points' : w > 0 ? `${n} sortie point${n > 1 ? 's' : ''} · ready in ${w} s` : `${n} sortie point${n > 1 ? 's' : ''}: one a flight`; };
    const main = (R) => {
      const me = MP.me;
      if (lineup) {
        for (let i = 0; i < 3; i++) {
          const d = MP.lineup[i] || (i ? null : MP.groundDesign || MP.myDesign);
          if (!d || ((me.slots || 0) & (1 << i))) continue;
          const air = mpAir(d.kind);
          R.opt(`Slot ${i + 1}: ${d.name || VEHICLE_KINDS[d.kind].name}`, air ? airText : `${money(designCost(partsFromDesign(d.parts)))} · spawns once`, () => go(d, i), air ? airOk : true);
        }
        if (!R.list.childElementCount) R.list.append(el('p', { class: 'muted', text: 'Every slot is used: watch the rest of the battle.' }));
      } else {
        const d = MP.groundDesign || MP.myDesign;
        if (d) R.opt(`Your vehicle (${d.name || VEHICLE_KINDS[d.kind].name})`, money(designCost(partsFromDesign(d.parts))), () => go(d));
        R.opt('Change vehicle…', 'Another of your designs, or a stock one within the money', () => R.page(pick(false)), true, true);
        if (st.air) R.opt('Aircraft…', airText, () => R.page(pick(true)), airOk, true);
      }
    };
    const pick = (air) => (R) => {
      R.opt('‹ Back', air ? 'The ground vehicles' : 'Your vehicle', () => R.page(main), true, true);
      const C = MP.choices(air);
      for (const c of C) R.opt(c.name, `${money(c.cost)}${c.saved ? ' · your design' : ''}${c.arms != null ? ` · ${c.arms || 'unarmed'}` : ''}`, () => go(c.design));
      if (!C.length) R.list.append(el('p', { class: 'muted', text: air ? 'No aircraft fits the money.' : 'No vehicle fits the money.' }));
    };
    this.rsp({ kicker: 'Respawn', title: by ? `Knocked out by ${MP.nameOf(by)}` : 'Knocked out', state, fill: main, actions: [{ label: 'Spectate', onClick: () => MPUI.spectate(1) }] });
  },
  // The Respawn panel itself, a room's and the Practice Battle's (groundai.js): a line counting down to the respawn time
  // and big buttons for thumbs, built with el() (names from peers stay text). o: { kicker, title, actions, state () ->
  // { text, wait } (null: the panel is done with), fill (R) }: fill adds the buttons with R.opt(title, sub, fn, ok = true,
  // now = false) (now: works before the timer, as a menu does; the others wait for it) and turns the page with R.page(fill).
  // sub and ok may be functions (an aircraft's sortie point and its minute's wait): read again with the line, four times a
  // second. The line and the buttons are written only when they change.
  rsp(o) {
    const body = el('div', { class: 'rsp' }), wait = el('p', { class: 'rsp-wait' }), list = el('div', { class: 'rsp-list' }), gated = [], live = [];
    body.append(wait, list);
    let shown = null, timer = 0, held = true;
    const tick = () => {
      const s = $('#modal').hidden || !body.isConnected ? null : o.state();
      if (!s) { clearInterval(timer); return; }
      if (s.text !== shown) { shown = s.text; wait.textContent = s.text; held = !!s.wait; for (const b of gated) b.disabled = held; }
      for (const L of live) {
        const t = L.sub(), off = !L.ok() || (!L.now && held);
        if (L.span.textContent !== t) L.span.textContent = t;
        if (L.b.disabled !== off) L.b.disabled = off;
      }
    };
    const R = {
      list,
      opt(title, sub, fn, ok = true, now = false) {
        const fs = typeof sub === 'function' ? sub : null, fo = typeof ok === 'function' ? ok : null, span = el('span', { text: fs ? fs() : sub });
        const b = el('button', { class: 'rsp-opt' + (now ? ' menu' : '') }, el('b', { text: title }), span);
        b.addEventListener('click', () => { Sound.click(); fn(); });
        if (fs || fo) { b.disabled = !(fo ? fo() : ok); live.push({ b, span, now, sub: fs || (() => sub), ok: fo || (() => ok) }); }
        else { b.disabled = !ok; if (ok && !now) gated.push(b); }
        list.append(b);
        return b;
      },
      page(fill) { list.textContent = ''; gated.length = 0; live.length = 0; fill(R); shown = null; if (body.isConnected) tick(); },
    };
    UI.modal({ kicker: o.kicker, title: o.title, body, actions: o.actions, onClose: () => clearInterval(timer) });
    R.page(o.fill);
    timer = setInterval(tick, 250);
  },
  // The lineup in the build phase (Lineup of 3): slot 1 is what's on the blueprint, slots 2 and 3 a saved or stock design
  // each (tap to change)
  renderLineup(on) {
    const box = $('#mp-lineup');
    if (box.hidden !== !on) box.hidden = !on;
    if (!on) return;
    const sig = MP.lineup.map((d) => (d ? d.name : '')).join('|');
    if (box._sig === sig) return;
    box._sig = sig;
    box.textContent = '';
    for (let i = 0; i < 3; i++) {
      const d = MP.lineup[i];
      box.append(el('button', { class: 'mp-slot' + (i ? '' : ' built'), 'data-slot': String(i), title: i ? 'Tap to pick another vehicle for this slot' : 'The vehicle on your blueprint' },
        el('small', { text: String(i + 1) }), el('span', { text: i ? (d ? d.name : 'Pick…') : 'Your build' })));
    }
  },
  lineupPick(i) {
    if (!MP.ground || !MP.state || MP.state.settings.respawn !== 'lineup') return;
    const body = el('div', { class: 'rsp' }), list = el('div', { class: 'rsp-list' });
    body.append(list);
    const add = (c) => {
      const b = el('button', { class: 'rsp-opt' }, el('b', { text: c.name }), el('span', { text: `${money(c.cost)}${c.saved ? ' · your design' : ''}${mpAir(c.design.kind) ? ' · aircraft: needs a sortie point' : ''}` }));
      b.addEventListener('click', () => { MP.lineup[i] = c.design; UI.closeModal(); Sound.click(); this.renderBar(); });
      list.append(b);
    };
    for (const c of MP.choices(false)) add(c);
    if (MP.state.settings.air) for (const c of MP.choices(true)) add(c);
    UI.modal({ kicker: `Lineup · slot ${i + 1}`, title: 'Pick a vehicle', body, actions: [{ label: 'Cancel' }] });
  },
  // The Practice Battle (groundai.js): the ground battle's rules alone on this device, against the AI
  practice() {
    const body = el('div', { class: 'rsp' }), list = el('div', { class: 'rsp-list' });
    body.append(el('p', { class: 'mp-explain', text: 'You and two AI allies against three AI vehicles, 600 tickets a side, on Highland Ridge (on the runway without the map). Pick the era: it sets the money and the stock vehicles. You drive the design on your blueprint when it fits the money.' }), list);
    for (const [cash, name, sub] of [[45000, 'WWII · $45k', 'Medium tanks and armoured cars'], [75000, 'Cold War · $75k', 'Main battle tanks with stabilised guns'], [120000, 'Modern · $120k', 'Composite armour, thermal sights, missiles']]) {
      const me = GroundAI.practiceVehicle(cash); // (P4 play-test: which vehicle you'll be in, said before you pick)
      const b = el('button', { class: 'rsp-opt' }, el('b', { text: name }), el('span', { text: sub }), el('span', { class: 'rsp-you', text: `You drive ${me.yours ? 'your' : 'the stock'} ${me.name} · ${money(me.cost)}` }));
      b.addEventListener('click', () => { UI.closeModal(); Sound.click(); GroundAI.startBattle(Flight, { money: cash }); });
      list.append(b);
    }
    UI.modal({ kicker: 'Practice battle', title: 'Against the AI', body, actions: [{ label: 'Back' }] });
  },
  // A ground battle's ground must be the same for everyone: say so when our map isn't the host's
  mapCheck() {
    const s = MP.state;
    if (!MP.ground || !s || Net.isHost) return;
    const mine = MP.mapReady();
    if (s.settings.arena === 'highland' && !mine) UI.toast('Your map didn’t load: the hills you see differ from the others’', 'warn');
    else if (s.settings.arena === 'runway' && mine) UI.toast('The host’s map didn’t load, so the battle is on the runway: off it, your ground differs from theirs', 'warn');
  },

  hide() {
    $('#mp-bar').hidden = true; $('#mp-score').hidden = true; $('#mp-hud-chat').hidden = true; $('#spawn-map').hidden = true;
    $('#mp-feed').innerHTML = ''; $('#mp-hud-log').innerHTML = ''; $('#mp-chat-log').innerHTML = '';
  },
};

// (DOM writes only on change, for what updates a few times a second)
function mpSet(e, k, v) { if (e[k] !== v) e[k] = v; }
// a tag's text centred at x (its baseline y), slid sideways to stay on a W px wide screen: a player's name at the edge isn't cut off
function mpTag(ctx, t, x, y, W) { const w = ctx.measureText(t).width / 2 + 2; ctx.fillText(t, w * 2 < W ? clamp(x, w, W - w) : x, y); }
// a bar filled to |f| (0..1), ours (f >= 0) or theirs
function mpBar(e, f) {
  const t = `scaleX(${Math.min(1, Math.abs(f)).toFixed(2)})`, c = f >= 0 ? 'us' : 'them';
  if (e._tf !== t) { e._tf = t; e.style.transform = t; }
  if (e.className !== c) e.className = c;
}
function fmtClock(s) { s = Math.ceil(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// ------------------------------------------------------------------ the maps behind the spawn pickers (the room's
// battle area, MPUI.drawSpawnMap; the sandbox's regions, Spawns)
// A satellite-coloured map of the box M (e0..e1 along the track, z0..z1 across: game north up), sea shaded by depth,
// W x H pixels
function spawnMapBake(W, H, M) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), out = [0, 0, 0], ready = Terrain.earthMap.state === 'ready';
  const step = W > 600 ? 2 : 1;
  for (let j = 0; j < H; j += step) for (let i = 0; i < W; i += step) {
    const e = M.e0 + ((i + 0.5) / W) * (M.e1 - M.e0), z = M.z0 + ((j + 0.5) / H) * (M.z1 - M.z0), a = siteAngle(EARTH, e);
    let r = 20, g = 50, b = 90;
    if (ready) {
      const h = Terrain.earthH(a, z);
      if (h < 0) { const d = clamp(-h / 180, 0, 1); r = 18 - 10 * d; g = 64 - 34 * d; b = 112 - 40 * d; }
      else { Terrain.earthColor(a, z, out); const k = 1.15 + 0.004 * Math.min(h, 300); r = out[0] * k; g = out[1] * k; b = out[2] * k; }
    }
    for (let dj = 0; dj < step && j + dj < H; dj++) for (let di = 0; di < step && i + di < W; di++) {
      const o = ((j + dj) * W + i + di) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
// a grid every `cell` m over the map of box M, a scale bar of one cell and the north arrow
function spawnMapGrid(ctx, W, H, M, dpr, cell) {
  const px = (e) => ((e - M.e0) / (M.e1 - M.e0)) * W, pz = (z) => ((z - M.z0) / (M.z1 - M.z0)) * H;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
  for (let e = Math.ceil(M.e0 / cell) * cell; e < M.e1; e += cell) { ctx.beginPath(); ctx.moveTo(px(e), 0); ctx.lineTo(px(e), H); ctx.stroke(); }
  for (let z = Math.ceil(M.z0 / cell) * cell; z < M.z1; z += cell) { ctx.beginPath(); ctx.moveTo(0, pz(z)); ctx.lineTo(W, pz(z)); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `600 ${11 * dpr}px "IBM Plex Mono", monospace`;
  const sb = px(M.e0 + cell) - px(M.e0);
  ctx.fillRect(14 * dpr, H - 16 * dpr, sb, 2 * dpr); ctx.fillText(cell >= 1000 ? `${cell / 1000} km` : `${cell} m`, 14 * dpr, H - 22 * dpr);
  ctx.textAlign = 'right'; ctx.fillText('N ↑', W - 10 * dpr, 18 * dpr); ctx.textAlign = 'left';
}

// ------------------------------------------------------------------ the sandbox's spawn points (the spawn points update)
// Where a solo flight in Sandbox starts (and a craft in a multiplayer sandbox room): EARTH.spawns, a few for each kind of
// craft on the Faroes, Shetland and in Scotland, picked in the hangar (the Start button beside Launch) and remembered per
// kind (rss.spawn). Nothing chosen (or Career) starts as ever: the kind's own site, Armour on Highland Ridge's north pad.
// A spot off its kind's own site needs the real Earth map and the 3D view; without them the flight starts as ever.
const Spawns = {
  KEY: 'rss.spawn',
  // the regions as the picker's map shows them: a middle and the height of the view (its width follows the canvas)
  REGIONS: [
    { id: 'Faroes', e: 300, z: 300, h: 6600 },
    { id: 'Shetland', e: 18500, z: -400, h: 4000 },
    { id: 'Scotland', e: 18600, z: 12300, h: 4400 },
  ],
  view: null, // (the region the picker shows)
  hot: [],
  byId(id) { return typeof id === 'string' ? EARTH.spawns.find((sp) => sp.id === id) || null : null; },
  list(kind) { return EARTH.spawns.filter((sp) => sp.kinds.includes(kind)); },
  def(kind) { return EARTH.spawns.find((sp) => sp.def && sp.def.includes(kind)) || null; },
  // the spot remembered for this kind, if it is still one of its spots
  stored(kind) {
    const m = store.get(this.KEY, null), id = m && typeof m === 'object' && hasOwn(m, kind) ? m[kind] : null, sp = this.byId(id);
    return sp && sp.kinds.includes(kind) ? sp : null;
  },
  choose(kind, id) {
    const sp = this.byId(id);
    if (!sp || !sp.kinds.includes(kind)) return false;
    const m = store.get(this.KEY, null), o = m && typeof m === 'object' && !Array.isArray(m) ? m : {};
    o[kind] = id;
    store.set(this.KEY, o);
    return true;
  },
  // where the picker is offered: a solo flight in Sandbox, or a multiplayer sandbox room (a battle has its own)
  offered() {
    const live = typeof MP !== 'undefined' && MP.live;
    return live ? !MP.pvp && !MP.ground : !!(Career.data && Career.sandbox);
  },
  // the real map in and the 3D view: what every spot off its kind's own site needs
  ready() { return !!(Terrain.earthMap && Terrain.earthMap.state === 'ready' && EARTH.mapped && App.use3D()); },
  // the spot a solo flight of this kind starts at now: the one chosen (Sandbox), else the kind's default
  current(kind) { return (this.offered() && this.stored(kind)) || this.def(kind); },
  // Flight.start's place for a craft of `kind` at spot sp, the `slot`-th of the players there (a room; 0 alone); null: the
  // kind's own site (Flight.start's default). Off a site, only with the map and the 3D view (ready).
  place(sp, kind, slot = 0) {
    if (!sp || sp.site || !this.ready()) return null;
    const k = Number.isFinite(+slot) && +slot > 0 ? Math.floor(Math.min(+slot, 1e6)) : 0;
    let P = null;
    if (sp.arena) {
      const air = kind === 'drone' || kind === 'heli';
      P = GroundMode.placement(sp.arena, 0, k, air ? kind : 'tank');
      if (P && air && k >= 4) { const b = 50 * Math.floor(k / 4), c = Math.cos(P.yaw), s = -Math.sin(P.yaw); P = Object.assign({}, P, { e: P.e - c * b, z: P.z - s * b }); } // (a battle's pad holds four: a room's next ones 50 m behind)
    }
    else if (sp.airfield) P = airfieldPlacement(EARTH.airfields[sp.airfield], k, kind === 'heli' ? 'heli' : 'plane');
    else if (sp.air) {
      const c = Math.cos(sp.air.yaw), s = -Math.sin(sp.air.yaw), side = (k ? (k % 2 ? 1 : -1) * Math.ceil(k / 2) : 0) * 80;
      P = { e: sp.air.e - s * side, z: sp.air.z + c * side, yaw: sp.air.yaw, air: { alt: sp.air.alt, speed: sp.air.speed } };
    } else if (sp.pad) {
      const f = EARTH.groundPads[sp.pad];
      if (!f) return null;
      // (in a room: rockets share the pad; drones three abreast 12 m apart towards the pad's middle, a second row 12 m on,
      // away from the vehicles; vehicles 14 m abreast in threes, a second row 16 m behind)
      let u = sp.u || 0, v = sp.v || 0;
      if (kind === 'drone' || kind === 'heli') { u += Math.floor((k % 6) / 3) * 12 * (u > 20 ? -1 : 1); v += (k % 3) * 12 * (v > 0 ? -1 : 1); }
      else if (kind !== 'rocket') { u -= Math.floor((k % 6) / 3) * 16; v += (k % 3) * 14; }
      P = { e: f.e + u * f.c - v * f.s, z: f.z + u * f.s + v * f.c, yaw: f.yaw };
    }
    if (!P) return null;
    P = Object.assign({}, P, { spot: sp.id });
    if (kind === 'plane' && !P.air) P.soft = true; // (a seaplane still starts on the water)
    return P;
  },
  // A solo launch's place (App.launch, Flight.revert): { place, sp, fell } (fell: the spot chosen needs the map and the 3D
  // view, so the flight starts at the kind's default instead)
  solo(kind) {
    const sp = this.current(kind), d = this.def(kind);
    if (sp && sp !== d && !sp.site) {
      const P = this.place(sp, kind, 0);
      if (P) return { place: P, sp, fell: false };
      return { place: kind === 'tank' ? GroundMode.soloPlace(kind) : null, sp: d, fell: true };
    }
    return { place: kind === 'tank' ? GroundMode.soloPlace(kind) : null, sp: d, fell: false }; // (as ever: Armour on Highland Ridge's north pad)
  },
  // A multiplayer sandbox's place for us: the spot we chose (not a kind's own site: the room's own spacing has those), or
  // null for the room's usual places (mp.js placement)
  room(kind, slot) {
    const sp = this.stored(kind);
    if (!sp || sp.site) return null;
    return this.place(sp, kind, slot);
  },

  // ---- the Start button and the picker
  kindNow() { return typeof Builder !== 'undefined' && Builder.kind ? Builder.kind : 'rocket'; },
  // (the button beside Launch, and its twin in the stats panel's head that takes its place on a narrow screen: style.css)
  renderBtn() {
    for (const b of [$('#btn-start'), $('#btn-start-p')]) {
      if (!b) continue;
      const on = this.offered() && !!this.list(this.kindNow()).length;
      if (b.hidden !== !on) b.hidden = !on;
      if (!on) continue;
      const sp = this.current(this.kindNow()), t = sp ? sp.name : '';
      const s = b.querySelector('.start-text');
      if (s && s.textContent !== t) s.textContent = t;
      b.title = `Start: ${t} (pick where this craft starts)`;
      b.setAttribute('aria-label', `Start: ${t}`);
    }
  },
  open() {
    if (!this.offered()) return;
    const kind = this.kindNow(), sp = this.current(kind);
    this.view = (sp && sp.region) || 'Faroes';
    $('#start-kicker').textContent = `${typeof MP !== 'undefined' && MP.live ? 'Sandbox room' : 'Sandbox'} · ${(VEHICLE_KINDS[kind] || { name: 'Rocket' }).name}`;
    $('#start-map').hidden = false;
    this.renderList();
    App.afterEarth(() => { this.draw(); this.renderList(); });
  },
  close() { $('#start-map').hidden = true; this.renderBtn(); if (typeof Builder !== 'undefined' && Builder.redraw) Builder.redraw(); },
  pick(id) {
    const kind = this.kindNow(), sp = this.byId(id);
    if (!sp || !sp.kinds.includes(kind)) return;
    if (!sp.site && !this.ready()) { UI.toast('That start needs the Earth map and the 3D view', 'warn'); return; }
    this.choose(kind, id);
    this.view = sp.region;
    if (typeof Sound !== 'undefined') Sound.click();
    this.draw(); this.renderList(); this.renderBtn();
  },
  // the box of region r on a W x H canvas (its height fixed, its width the canvas's shape)
  box(r, W, H) { const hh = r.h / 2, hw = (hh * W) / H; return { e0: r.e - hw, e1: r.e + hw, z0: r.z - hh, z1: r.z + hh }; },
  // where spot sp is (e, z) for the map: its place, or its site's middle
  at(sp, kind) {
    if (sp.site) return { e: EARTH.sites[sp.site].east, z: 0 };
    if (sp.air) return { e: sp.air.e, z: sp.air.z };
    if (sp.airfield) { const P = airfieldPlacement(EARTH.airfields[sp.airfield], 0, kind === 'heli' ? 'heli' : 'plane'); return { e: P.e, z: P.z }; }
    if (sp.arena) { const P = GroundMode.placement(sp.arena, 0, 0, kind === 'drone' ? 'drone' : 'tank'); return P ? { e: P.e, z: P.z } : { e: 0, z: 0 }; }
    const f = EARTH.groundPads[sp.pad];
    return { e: f.e + (sp.u || 0) * f.c - (sp.v || 0) * f.s, z: f.z + (sp.u || 0) * f.s + (sp.v || 0) * f.c };
  },
  draw() {
    const cv = $('#start-canvas');
    if (!cv || $('#start-map').hidden) return;
    const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const W = Math.max(200, Math.round(r.width * dpr)), H = Math.max(150, Math.round(r.height * dpr));
    cv.width = W; cv.height = H;
    const R = this.REGIONS.find((q) => q.id === this.view) || this.REGIONS[0], M = this.box(R, W, H), ctx = cv.getContext('2d');
    const key = `${R.id}:${W}x${H}:${Terrain.earthMap.state}`;
    if (!this.img || this.imgKey !== key) { this.img = spawnMapBake(W, H, M); this.imgKey = key; }
    ctx.drawImage(this.img, 0, 0);
    spawnMapGrid(ctx, W, H, M, dpr, 1000);
    ctx.fillStyle = '#fff'; ctx.font = `700 ${13 * dpr}px "Chakra Petch", sans-serif`; ctx.fillText(R.id.toUpperCase(), 12 * dpr, 20 * dpr);
    const kind = this.kindNow(), cur = this.current(kind), ok = this.ready();
    this.hot = [];
    for (const sp of this.list(kind)) {
      if (sp.region !== R.id) continue;
      const q = this.at(sp, kind), x = ((q.e - M.e0) / (M.e1 - M.e0)) * W, y = ((q.z - M.z0) / (M.z1 - M.z0)) * H, sel = sp === cur, can = sp.site || ok, Rr = 9 * dpr;
      ctx.globalAlpha = can ? 1 : 0.4;
      ctx.fillStyle = sp.air ? '#62d0ff' : '#ffb547'; ctx.strokeStyle = '#05070d'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      if (sp.air) { ctx.moveTo(x, y - Rr); ctx.lineTo(x + Rr, y + Rr * 0.8); ctx.lineTo(x - Rr, y + Rr * 0.8); ctx.closePath(); } else ctx.arc(x, y, Rr, 0, TAU);
      ctx.fill(); ctx.stroke();
      if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); ctx.arc(x, y, Rr + 7 * dpr, 0, TAU); ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.font = `700 ${12 * dpr}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center';
      const label = sp.name.toUpperCase(), hw = ctx.measureText(label).width / 2 + 4 * dpr, below = y - Rr - 22 * dpr < 0;
      ctx.fillText(label, clamp(x, hw, W - hw), below ? y + Rr + 18 * dpr : y - Rr - 8 * dpr);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      if (can) this.hot.push({ id: sp.id, x: x / dpr, y: y / dpr, r: 23 });
    }
  },
  click(ev) {
    const r = $('#start-canvas').getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    let best = null, bd = Infinity;
    for (const h of this.hot) { const d = Math.hypot(h.x - x, h.y - y); if (d < h.r && d < bd) { bd = d; best = h; } }
    if (best) this.pick(best.id);
  },
  renderList() {
    const list = $('#start-list'), kind = this.kindNow(), cur = this.current(kind), ok = this.ready();
    list.innerHTML = '';
    for (const R of this.REGIONS) {
      const L = this.list(kind).filter((sp) => sp.region === R.id);
      if (!L.length) continue;
      const h = el('button', { class: 'start-region' + (this.view === R.id ? ' on' : ''), text: R.id });
      h.addEventListener('click', () => { this.view = R.id; this.draw(); this.renderList(); });
      list.append(h);
      for (const sp of L) {
        const can = sp.site || ok, b = el('button', { class: 'spawn-opt', role: 'radio' });
        b.dataset.spot = sp.id;
        b.setAttribute('aria-checked', String(sp === cur));
        b.disabled = !can;
        b.append(el('b', { text: sp.name }), el('span', { text: can ? sp.blurb : `${sp.blurb} · needs the Earth map and the 3D view` }));
        b.addEventListener('click', () => this.pick(sp.id));
        list.append(b);
      }
    }
  },
  bind() {
    const b = $('#btn-start');
    if (!b) return;
    b.addEventListener('click', () => this.open());
    $('#btn-start-p').addEventListener('click', () => this.open());
    $('#start-done').addEventListener('click', () => this.close());
    $('#start-map').addEventListener('pointerdown', (e) => { if (e.target.id === 'start-map') this.close(); });
    $('#start-canvas').addEventListener('pointerdown', (e) => this.click(e));
    addEventListener('resize', () => { if (!$('#start-map').hidden) this.draw(); });
  },
};
