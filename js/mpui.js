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
      for (const id of ['#mp-create-sandbox', '#mp-create-pvp']) $(id).disabled = on;
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
    const join = () => go((status) => MP.join($('#mp-join-code').value, transport(), status), 'Joining…', true);
    const stoppable = () => this.connecting && this.connecting.join && !MP.active; // (still looking for the host, not yet in)
    $('#mp-join').addEventListener('click', () => { if (!this.connecting) join(); else if (stoppable()) this.abandon(); });
    $('#mp-join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.repeat) { e.target.blur(); if (stoppable()) this.abandon(); join(); } }); // (a corrected code starts over; the keyboard goes away)
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
    $('#mp-spawn-btn').addEventListener('click', () => this.openSpawnMap());
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
      if (e.code === 'Backquote') { this.showScore(true); e.preventDefault(); }
      if (App.scene === 'flight' && (e.code === 'KeyT' || e.code === 'Enter') && !UI.modalOpen) { e.preventDefault(); this.chatInput(true); }
      if (App.scene === 'flight' && Flight.destroyed && (e.code === 'BracketLeft' || e.code === 'BracketRight')) this.spectate(e.code === 'BracketLeft' ? -1 : 1);
    }, true);
    addEventListener('keyup', (e) => { if (e.code === 'Backquote' && !this.scoreSticky) this.showScore(false); });
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
    if (live) $('#mp-code').textContent = Net.code;
    $('#mp-kicker').textContent = live ? (s.mode === 'pvp' ? `Battle · ${s.settings.format.toUpperCase()}` : 'Sandbox') + (Net.transport === 'local' ? ' · this device' : ' · online') : 'Multiplayer';
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
    if (s.mode === 'sandbox') {
      box.append(el('p', { class: 'mp-explain', text: 'Everyone builds and flies whatever they like, from the usual pad, runway and helipad. You see each other’s craft, and guns and missiles hurt. Crash or get shot down and you can fly again straight away. No time warp in a shared world.' }),
        el('p', { class: 'mp-explain', text: `Share the code ${Net.code} with up to four friends. ${Net.transport === 'local' ? 'This room is on this device: open the game in another tab to join it.' : 'They join from anywhere over the internet.'}` }));
      this.stayHint(box);
      return;
    }
    const seg = (key, opts, val) => {
      const g = el('div', { class: 'kind-select' });
      for (const [v, label] of opts) {
        const b = el('button', { class: 'kind-btn', text: label });
        b.setAttribute('aria-checked', String(val === v));
        b.disabled = !host;
        b.addEventListener('click', () => { MP.setSetting(key, v); Sound.click(); });
        g.append(b);
      }
      return g;
    };
    const set = (label, ctl) => box.append(el('div', { class: 'mp-set' }, el('span', { text: label }), ctl));
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
    if (!host) box.append(el('p', { class: 'mp-explain', text: 'The host sets up the match.' }));
    else if (s.phase === 'lobby') this.stayHint(box);
  },
  // The host's game is the room: on a phone it can't let anyone in while the screen is off or another app is
  // in front (as when sending the code in a chat app), so say so, first thing in the card.
  stayHint(box) {
    if (Net.isHost && Net.transport !== 'local' && isTouch) box.prepend(el('p', { class: 'mp-explain mp-stay', text: 'Keep the game on screen while friends join: your phone lets them in, and it can’t while its screen is off or another app is open. After sending the code, come straight back.' }));
  },
  renderFoot() {
    const s = MP.state, me = MP.me, pvp = s.mode === 'pvp';
    $('#mp-ready').hidden = !pvp || s.phase !== 'lobby';
    $('#mp-ready').setAttribute('aria-pressed', String(!!(me && me.ready)));
    $('#mp-ready').textContent = me && me.ready ? 'Ready ✓' : 'Ready';
    $('#mp-start').hidden = !pvp || !Net.isHost || s.phase !== 'lobby';
    $('#mp-hangar').hidden = pvp;
    let note = '';
    if (pvp && s.phase === 'lobby') note = Net.isHost ? 'Start when everyone’s in. Build, (test), then fight: one life each.' : 'Waiting for the host to start the battle.';
    else if (pvp) note = `Battle running: ${{ build: 'building', test: 'test flights', polish: 'final touches', battle: 'fighting', results: 'results' }[s.phase] || s.phase}.`;
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
    const label = s.mode === 'sandbox' ? 'Sandbox' : { build: 'Build', test: 'Test flight', polish: 'Final touches', battle: 'Battle', results: 'Results' }[s.phase] || s.phase;
    $('#mp-phase').textContent = label;
    const building = s.mode === 'pvp' && (s.phase === 'build' || s.phase === 'polish');
    $('#mp-ready-btn').hidden = !building || App.scene !== 'build';
    $('#mp-ready-btn').setAttribute('aria-pressed', String(!!(MP.me && MP.me.ready)));
    $('#mp-ready-btn').textContent = MP.me && MP.me.ready ? 'Ready ✓' : 'Ready';
    $('#mp-spawn-btn').hidden = !building || App.scene !== 'build';
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
      fill.style.width = `${clamp(left / (s.endsLen || 1), 0, 1) * 100}%`;
      $('#mp-bar').classList.toggle('urgent', left < 15 && s.phase !== 'battle');
    } else { timer.textContent = s.mode === 'sandbox' ? Net.code : ''; fill.style.width = '100%'; $('#mp-bar').classList.remove('urgent'); }
    // the line under the timer
    const info = $('#mp-bar-info');
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

  // ------------------------------------------------------------------ spawn map
  // The battle area in the game's own frame: east along the runway to the right, game north up.
  MAP: { e0: -9000, e1: 31000, z0: -9000, z1: 21000 },
  openSpawnMap() {
    if (!MP.live || !MP.pvp) return;
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
    if (!this.mapImg || this.mapImg.width !== W) this.mapImg = this.bakeMap(W, H);
    ctx.drawImage(this.mapImg, 0, 0);
    const M = this.MAP, px = (e) => ((e - M.e0) / (M.e1 - M.e0)) * W, pz = (z) => ((z - M.z0) / (M.z1 - M.z0)) * H;
    // a 5 km grid and a scale bar
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    for (let e = Math.ceil(M.e0 / 5000) * 5000; e < M.e1; e += 5000) { ctx.beginPath(); ctx.moveTo(px(e), 0); ctx.lineTo(px(e), H); ctx.stroke(); }
    for (let z = Math.ceil(M.z0 / 5000) * 5000; z < M.z1; z += 5000) { ctx.beginPath(); ctx.moveTo(0, pz(z)); ctx.lineTo(W, pz(z)); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = `600 ${11 * dpr}px "IBM Plex Mono", monospace`;
    const sb = px(M.e0 + 5000) - px(M.e0);
    ctx.fillRect(14 * dpr, H - 16 * dpr, sb, 2 * dpr); ctx.fillText('5 km', 14 * dpr, H - 22 * dpr);
    ctx.textAlign = 'right'; ctx.fillText('N ↑', W - 10 * dpr, 18 * dpr); ctx.textAlign = 'left';
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
  bakeMap(W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'), img = ctx.createImageData(W, H), M = this.MAP, out = [0, 0, 0], ready = Terrain.earthMap.state === 'ready';
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
  },
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
    box.append(el('h3', { text: MP.pvp ? `Scoreboard · ${MP.state.settings.format.toUpperCase()}` : `Room ${Net.code}` }), this.scoreTable(MP.state.players));
    box.hidden = false;
  },
  scoreTable(players) {
    const t = el('table', { class: 'dv-table' });
    t.innerHTML = '<thead><tr><th>Pilot</th><th>Team</th><th>Kills</th><th>Lost</th><th>Damage</th><th>Ping</th></tr></thead>';
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
  results(r) {
    if (!r || !MP.live) return;
    const me = MP.me, ffa = r.ffa;
    let kicker, title;
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
      ctx.fillText(MP.nameOf(g.remote), s.x, s.y - 26);
      if (d > 300) { ctx.font = '500 10px "IBM Plex Mono", monospace'; ctx.globalAlpha = 0.8; ctx.fillText(fmt.dist(d), s.x, s.y - 38); ctx.globalAlpha = 1; }
    }
    // radar warning receiver: who has a radar lock on us, and from where
    if (MP.rwr.size && !F.destroyed) {
      const v = F.active, fwd = (() => { const a = v.pilot.F; return v.axis(a.x, a.y, a.z); })(), up = v.axis(-1, 0, 0), right = v.axis(0, 0, 1);
      const cx = W / 2, cy = H * 0.72, R = 34;
      ctx.strokeStyle = 'rgba(255,93,93,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
      for (const pid of MP.rwr.keys()) {
        const P = MP.peers.get(pid);
        if (!P || !P.ghost) continue;
        const g = P.ghost, dx = g.x - v.x, dy = g.y - v.y, dz = g.z - v.z;
        const a = Math.atan2(dx * right.x + dy * right.y + dz * right.z, dx * fwd.x + dy * fwd.y + dz * fwd.z);
        ctx.fillStyle = '#ff5d5d';
        ctx.beginPath(); ctx.arc(cx + Math.sin(a) * R, cy - Math.cos(a) * R, 4, 0, TAU); ctx.fill();
        void up;
      }
      if (Math.floor(performance.now() / 300) % 2 === 0) { ctx.font = '700 13px "Chakra Petch", system-ui, sans-serif'; ctx.fillStyle = '#ff5d5d'; ctx.fillText('RADAR LOCK', cx, cy + R + 16); }
    }
    this.drawRadar(ctx, W, H, F, me);
    if (F.destroyed && F.spectate) {
      ctx.font = '600 13px "Chakra Petch", system-ui, sans-serif'; ctx.fillStyle = '#e9edf1';
      ctx.fillText(`Watching ${MP.nameOf(F.spectate.remote)} · ${isTouch ? 'tap' : '[ ]'} to switch`, W / 2, H - 40);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  },

  // Can we see another player's craft? Friends (and everyone in the sandbox) always; enemies within about 6 km by
  // eye, or further on our own radar if it's ahead of us (stealth shrinks both).
  spotted(g, me, F) {
    if (!MP.pvp || (!MP.ffa() && MP.teamOf(g.remote) === MP.teamOf(Net.me))) return true;
    const dx = g.x - me.x, dy = g.y - me.y, dz = g.z - me.z, d = Math.hypot(dx, dy, dz), st = Combat.stealthOf(g);
    if (d < 6000 * (1 - 0.5 * st)) return true;
    const v = F.active;
    if (F.destroyed || !v || !v.parts.length) return false;
    const radar = v.parts.reduce((m, p) => Math.max(m, p.def.radar || 0), 0);
    if (!radar || d > radar * (1 - st)) return false;
    const f = v.axis(v.pilot.F.x, v.pilot.F.y, v.pilot.F.z);
    return (dx * f.x + dy * f.y + dz * f.z) / d > 0.5; // within 60° of the nose
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
      ctx.beginPath(); ctx.arc(x, y, MP.rwr.has(g.remote) ? 4.5 : 3.2, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#e9edf1'; ctx.beginPath(); ctx.moveTo(S.x, S.y - 6); ctx.lineTo(S.x + 4, S.y + 4); ctx.lineTo(S.x - 4, S.y + 4); ctx.closePath(); ctx.fill();
    ctx.font = '500 9px "IBM Plex Mono", monospace'; ctx.fillStyle = 'rgba(150, 185, 230, 0.7)'; ctx.textAlign = 'left';
    ctx.fillText('8 km', S.x + S.R - 22, S.y + S.R - 4);
    ctx.textAlign = 'center';
  },

  hide() {
    $('#mp-bar').hidden = true; $('#mp-score').hidden = true; $('#mp-hud-chat').hidden = true; $('#spawn-map').hidden = true;
    $('#mp-feed').innerHTML = ''; $('#mp-hud-log').innerHTML = ''; $('#mp-chat-log').innerHTML = '';
  },
};

function fmtClock(s) { s = Math.ceil(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
