'use strict';
// App shell: canvas sizing, scenes (home, hangar, flight), menus and the main loop.

const App = {
  scene: 'home',

  init() {
    Terrain.loadEarth(EARTH_MAP_FILES); // the real Earth's heights and colours
    this.canvas = $('#view');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
    document.querySelectorAll('[data-icon]').forEach((n) => n.prepend(icon(n.dataset.icon)));
    Builder.init(this.canvas);
    Flight.init(this.canvas);
    this.init3D();
    this.homeTime = 0;
    this.bindHome();
    // a dialog closes on a tap outside it or Escape (not the end-of-flight or end-of-battle ones)
    const locked = () => (App.scene === 'flight' && Flight.ended) || MP.modalLocked;
    $('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal' && !locked()) UI.closeModal(); });
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && UI.modalOpen && !locked()) { e.preventDefault(); e.stopImmediatePropagation(); UI.closeModal(); } }, true);
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    // phones kill background tabs without warning: save the flight whenever the page is hidden
    const stash = () => { if (this.scene === 'flight') Flight.save(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) stash(); });
    addEventListener('pagehide', stash);
    this.watchInput();
    this.last = performance.now();
    this.loop = (t) => this.frame(t);
    requestAnimationFrame(this.loop);
    this.toHome();
  },

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    if (Render3D.ready) Render3D.resize(this.W, this.H, this.dpr);
    if (typeof Builder !== 'undefined' && Builder.canvas) Builder.layout();
    this.ink = false; this.dirty = true; // (resizing a canvas wipes it)
  },

  // ---------------------------------------------------------------- main loop
  // Battery first: a frame does only the work that can change what is on screen. The frame cap (Settings)
  // lets a 90-144 Hz screen do at most 60 frames' work a second. A picture that can't have changed (the
  // idle hangar, 2D or 3D) isn't drawn again: the canvases keep the last one until something changes, with
  // a redraw every half second as a safety net. Slow backdrops draw less often: the home and multiplayer
  // screens 30 times a second, anything under a dialog (a paused flight too) 10 times.
  frame(t) {
    requestAnimationFrame(this.loop);
    const fps = Settings.get('fps'), cap = fps > 0 ? 1000 / fps : 0;
    if (cap) { // too soon after the last frame: skip this one (on average no more than fps frames a second)
      if (t < this.due - 2) return;
      this.due = t + cap - clamp(t - this.due, 0, cap);
    }
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (this.poked) { this.poked = false; this.dirty = true; this.busyUntil = t + 1000; }
    try {
      let in3d = false;
      const modal = !this.modals[0].hidden || !this.modals[1].hidden;
      if (this.scene === 'build') {
        in3d = this.preview3D();
        const view = in3d ? 'build3d' : 'build2d', force = this.stale(view, t) || Builder.dirty;
        if (!in3d) {
          if (force) { Builder.render(this.ctx, this.W, this.H, this.dpr); this.ink = true; this.drew(t); }
        } else {
          Render3D.setVisible(true);
          this.lag += dt;
          // the 3D view draws while anything in it moves (Render3D knows), for a second after the player
          // does anything, and when asked to; the turntable turns 10 frames a second under a dialog
          if (!modal || force || t >= this.next - 2) {
            if (Render3D.renderBuilder(Builder, this.lag, force || t < this.busyUntil)) this.drew(t, 100);
            this.lag = 0;
          }
          this.clear2D();
        }
      } else if (this.scene === 'flight') {
        Flight.update(dt);
        const globe = Flight.running && Flight.mapMode && GlobeView.active && this.use3D();
        in3d = (this.use3D() && !Flight.mapMode && Flight.running) || globe;
        if (in3d) Render3D.setVisible(true);
        // paused, or a dialog over the flight: the world stands still (or goes on, dimmed and blurred behind
        // the dialog), so 10 frames a second show it, beacons still blinking
        const calm = !!Flight.paused || modal, force = this.stale(globe ? 'globe' : in3d ? 'flight3d' : 'flight2d', t);
        this.lag += dt;
        if (!calm || force || t >= this.next - 2) {
          const d = this.lag;
          this.lag = 0;
          if (globe) {
            Flight.updateCamera();
            GlobeView.render(this.ctx, this.W, this.H, this.dpr, Flight, d);
          } else if (in3d) {
            Flight.updateCamera();
            Render3D.renderFlight(Flight, d, calm || d !== dt); // (several frames' time in one isn't a slow frame)
            this.clear2D();
            World.drawOverlay3D(this.ctx, this.W, this.H, this.dpr, Flight);
            Combat.drawHUD(this.ctx, this.W, this.H, this.dpr, Flight);
            if (Flight.groundAim) GHUD.draw(this.ctx, this.W, this.H, this.dpr, Flight); // (aiming a ground vehicle's guns)
            if (MP.live) MPUI.drawHUD(this.ctx, this.W, this.H, this.dpr, Flight);
          } else Flight.render(this.ctx, this.W, this.H, this.dpr);
          this.ink = true;
          this.drew(t, 100);
        }
      } else { // home and the multiplayer screens: the solar system turns slowly behind the menus
        const force = this.stale('home', t);
        this.lag += dt;
        if (force || t >= this.next - 2) { this.renderHome(this.lag); this.lag = 0; this.ink = true; this.drew(t, modal ? 100 : 1000 / 30); }
      }
      if (!in3d && Render3D.ready) Render3D.setVisible(false);
    } catch (err) {
      console.error(err);
    }
  },
  // Is the view's picture out of date: a redraw asked for, another view than the last one drawn, or none
  // drawn for a while (a safety net for a change nobody asked to redraw for)
  stale(view, t) {
    if (view !== this.view) { this.view = view; this.dirty = true; this.lag = 0; }
    return this.dirty || t - this.drawnAt > this.heartbeat;
  },
  // (gap: a slow view's next frame is due that long after this one, on average, whatever the screen's rate)
  drew(t, gap = 0) { this.dirty = false; Builder.dirty = false; this.drawnAt = t; this.next = t + gap - clamp(t - this.next, 0, gap); },
  redraw() { this.dirty = true; },
  heartbeat: 500, // ms
  lag: 0, drawnAt: -1e9, next: 0, due: 0, busyUntil: 0, ink: true,
  // Anything the player does may change a still picture: draw it again, and keep the 3D hangar drawing for a
  // second while it eases into place. (A mouse only passing over changes nothing; the 3D hangar's hover
  // highlight asks for its own redraw.)
  watchInput() {
    const poke = (e) => { if (e.type !== 'pointermove' || e.buttons || e.pointerType !== 'mouse') this.poked = true; };
    for (const k of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'keydown', 'keyup', 'touchstart', 'touchend', 'input', 'change', 'click'])
      addEventListener(k, poke, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.redraw(); });
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => this.redraw()); // (the blueprint's labels)
    this.modals = [$('#modal'), $('#spawn-map')];
  },

  // the 2D canvas over the 3D view: cleared only when something was drawn on it
  clear2D() { if (!this.ink) return; this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.ink = false; },

  // ---------------------------------------------------------------- 3D view
  // Flight is always drawn in 3D; the flat 2D renderer is only a fallback for devices without WebGL.
  // The hangar is a 2D blueprint with an optional 3D preview.
  use3D() {
    if (this.scene === 'flight' && Silly.on('retro2d')) return false;
    if (!Render3D.supported || Render3D.failed || !Render3D.ready) {
      if ((Render3D.failed || !Render3D.supported) && this.scene === 'flight' && !this.warned3d) { this.warned3d = true; UI.toast('3D isn’t available on this device: flying in 2D'); }
      return false;
    }
    return true;
  },
  preview3D() { return !!Settings.get('build3d') && this.use3D(); },
  init3D() {
    const show = Render3D.supported;
    document.querySelectorAll('.view3d-toggle').forEach((b) => { b.hidden = !show; b.addEventListener('click', () => this.setPreview3D(!Settings.get('build3d'))); });
    if (show) this.load3D();
    this.sync3D();
  },
  load3D() {
    Render3D.load().then(() => { Render3D.resize(this.W, this.H, this.dpr); this.sync3D(); }).catch((e) => {
      console.error(e);
      this.sync3D();
    });
  },
  setPreview3D(on) {
    if (on && !Render3D.supported) { UI.toast('3D view isn’t available on this device'); return; }
    Settings.set('build3d', !!on);
    if (on && !Render3D.ready) UI.toast('Loading 3D view…');
    Sound.click();
    this.sync3D();
  },
  sync3D() {
    const on = !!Settings.get('build3d') && Render3D.supported && !Render3D.failed;
    document.querySelectorAll('.view3d-toggle').forEach((b) => {
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Back to the 2D blueprint (V)' : '3D preview (V)';
      b.setAttribute('aria-label', b.title);
    });
    // the 3D hint shows when the 3D view comes on, then fades after a while
    const hint = $('#build-3d-hint');
    hint.hidden = !on;
    hint.classList.remove('faded');
    clearTimeout(this.hintTimer);
    if (on) this.hintTimer = setTimeout(() => hint.classList.add('faded'), 9000);
    hint.textContent = isTouch
      ? '3D · drop parts onto any wing or body: they attach where you drop them · drag to turn · tap a part, then drag it to move · pinch to zoom'
      : '3D · drop parts onto any wing or body: they attach where you drop them · drag empty space to turn · right-drag to pan · [ ] in and out';
    const grid = $('#btn-grid'); if (grid) grid.hidden = on; // the grid is a 2D mode
  },

  showScene(name) {
    this.scene = name;
    $('#home').hidden = name !== 'home';
    $('#build-ui').hidden = name !== 'build';
    $('#flight-ui').hidden = name !== 'flight';
    $('#mp-ui').hidden = name !== 'mp';
    document.body.classList.toggle('flying', name === 'flight'); // (the HUD's panels lose their blur: style.css)
    if (name === 'build') Builder.layout();
    MPUI.renderBar();
    this.redraw();
  },
  // the multiplayer room: connect, lobby, settings and chat
  showMP() {
    if (this.scene === 'flight' && Flight.running) { if (Flight.mp) MP.leaveFlight(); else { Flight.save(); Flight.stop(); } }
    this.showScene('mp');
  },

  // ---------------------------------------------------------------- home
  bindHome() {
    $('#home-build').addEventListener('click', () => this.toBuild());
    $('#home-resume').addEventListener('click', () => this.resumeFlight());
    $('#home-settings').addEventListener('click', () => this.showSettings());
    $('#home-help').addEventListener('click', () => this.showHelp());
    $('#home-dv').addEventListener('click', () => this.showDeltaV());
    $('#home-mode').addEventListener('click', () => this.chooseMode());
    $('#btn-home').addEventListener('click', () => { if (MP.active) MPUI.leave(); else this.toHome(); });
    $('#home-mp').addEventListener('click', () => MPUI.open());
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      Career.setMode(b.dataset.mode);
      this.toHome();
      Builder.buildPalette(); Builder.changed(true);
      if (!store.get('rss.seenHelp', false)) { store.set('rss.seenHelp', true); setTimeout(() => this.showHelp(), 250); }
    }));
  },

  toHome() {
    if (this.scene === 'flight') { Flight.save(); Flight.stop(); }
    if (MP.active) { MP.end(); return; } // (MP.end comes back here once the room is closed)
    this.showScene('home');
    const first = !Career.mode;
    $('#home-modes').hidden = !first;
    $('#home-main').hidden = first;
    const saved = store.get('rss.flight', null);
    $('#home-resume').hidden = !(saved && saved.vessels && saved.vessels.length);
    if (saved && saved.vessels && saved.vessels.length) {
      const av = saved.vessels[clamp(saved.active || 0, 0, saved.vessels.length - 1)];
      $('#home-resume-sub').textContent = `${av.name} · ${BODY_BY_ID[av.body] ? BODY_BY_ID[av.body].name : ''} · T+ ${fmt.clock(saved.time || 0)}`;
    }
    const p = Career.progress();
    $('#home-mode-label').textContent = Career.sandbox ? 'Sandbox' : 'Career';
    $('#home-mode-sub').textContent = Career.sandbox ? 'Every part, unlimited funds' : `${money(Career.data.funds)} · Tier ${Career.data.tier} · ${p.done}/${p.total} missions`;
  },

  chooseMode() {
    $('#home-modes').hidden = false;
    $('#home-main').hidden = true;
  },

  renderHome(dt) {
    this.homeTime += dt * 40000;
    const ctx = this.ctx, dpr = this.dpr;
    const portrait = this.H > this.W * 1.1;
    const S = (Math.min(this.W, this.H * (portrait ? 0.55 : 1)) * 0.48 * dpr) / (MARS.orbitRadius * 1.08);
    // keep the system clear of the title: right of it on wide screens, above it on phones
    const c = portrait ? { x: 0, y: -(this.H * 0.26 * dpr) / S } : { x: -(this.W * 0.16 * dpr) / S, y: 0 };
    MapView.drawSystem(ctx, this.W * dpr, this.H * dpr, dpr, this.homeTime, c, S, {});
  },

  // ---------------------------------------------------------------- scenes
  toBuild() {
    if (this.scene === 'flight') { if (Flight.mp) MP.leaveFlight(); else { Flight.save(); Flight.stop(); } }
    this.showScene('build');
    Builder.buildPalette();
    Builder.changed(true);
    Builder.fitView();
  },

  launch() {
    if (!Builder.ctrl) { UI.toast('Add a Command Pod or Probe Core first'); return; }
    if (MP.live) { MP.launch(); return; } // in a room: fly into the shared world (or, in a battle, mark ready)
    const s = Builder.statsData;
    if (s.locked.length) { UI.toast('This rocket uses parts you haven’t unlocked yet'); return; }
    if (!Career.canAfford(s.cost)) { UI.toast(`Not enough funds: this rocket costs ${money(s.cost)}`); return; }
    const go = () => this.afterEarth(() => {
      if (s.loose) UI.toast(`${s.loose} loose part(s) left in the hangar`);
      store.set('rss.flight', null);
      this.showScene('flight');
      Flight.start(Builder.serialize());
      const tip = { rocket: 'Press STAGE (Space) to ignite', plane: 'Press STAGE (Space) to start the engine', car: 'Drive with W/S and steer with A/D', heli: 'Press STAGE (Space) to start the rotor' }[Builder.kind];
      if (Settings.get('hints') && tip) UI.toast(tip);
    });
    const saved = store.get('rss.flight', null);
    if (saved && saved.vessels && saved.vessels.length) {
      UI.modal({
        title: 'Abandon the saved flight?', body: 'Launching a new rocket replaces the flight you saved earlier.',
        actions: [{ label: 'Cancel' }, { label: 'Resume saved flight', onClick: () => this.resumeFlight() }, { label: 'Launch new', primary: true, onClick: go }],
      });
      return;
    }
    go();
  },

  resumeFlight() {
    const saved = store.get('rss.flight', null);
    if (!saved) return;
    this.afterEarth(() => {
      this.showScene('flight');
      try { Flight.restore(saved); } catch (e) { console.error(e); UI.toast('That saved flight could not be loaded'); store.set('rss.flight', null); this.toBuild(); }
    });
  },
  // Flights need the Earth map's terrain (or the knowledge that it can't load): it usually arrives long before launch.
  afterEarth(fn) {
    const em = Terrain.earthMap;
    if (em.state !== 'loading') { fn(); return; }
    UI.toast('Loading Earth…');
    em.promise.then(fn);
  },

  // ---------------------------------------------------------------- menus
  showHelp() {
    UI.modal({
      kicker: 'Flight manual', title: 'How to fly',
      body: `<ol class="howto">
        <li><b>Build.</b> Drag parts from the tray onto the craft: they attach to whatever you drop them on, right where you drop them, and things attached to a part move with it. Tap a tray part to stack it automatically, or drag a part back onto the tray to remove it. Press R (or the turn button) to rotate the selected part a quarter turn. The yellow disc is the centre of mass; the purple arrow is where the stage-1 engines push.</li>
        <li><b>Depth and paint.</b> The blueprint is a side view; in 3D, drop engines, pods and missiles anywhere along a wing, as many as fit. In 2D, [ and ] (or the Depth slider) move the selected part in and out across the craft. With symmetry on, a plane's parts come in left and right pairs. Paint any part, Match it to what it hangs on, or paint the whole craft (All). G switches on a grid in 2D.</li>
        <li><b>Stage.</b> Orange numbers show the firing order. Separators split the rocket, and fuel can't flow through them. Solid boosters can't be shut down.</li>
        <li><b>Launch.</b> Hit STAGE to light the engines. Climb straight up to about 3 km, then lean east (D) a little at a time. W/S lean the rocket towards or away from you and Q/E roll it: the world is fully 3D, so you can fly in any direction.</li>
        <li><b>Orbit.</b> Once apoapsis clears 30 km, cut the engines, coast up, press PRO and burn until periapsis also clears 30 km.</li>
        <li><b>Travel.</b> In the map, tap a planet or moon to target it. The HUD tells you when the transfer window opens. Warp to it, burn prograde until an encounter appears, then burn retrograde at periapsis to be captured.</li>
        <li><b>Come home hot.</b> Returns from the Moon and planets heat the leading part. Lead with a heat shield, then open the parachute below 250 m/s.</li>
        <li><b>Planes.</b> Built nose-right with wings, a tail and landing gear; they take off from the runway. Full throttle, then pull back (S) at about 55 m/s. Bank with A/D to turn, Q/E use the rudder. Let go and the autopilot holds your pitch and bank. Fast jets can break the sound barrier: watch for the vapour cone at Mach 1. Every wing has a speed limit (the builder shows it): past it, it flutters and tears off, so slow down when the Overspeed warning comes up.</li>
        <li><b>Missiles.</b> A hostile missile in sight, within 4 km, shows a red MSL marker. Only a warning receiver (RWR, in the Weapons tab) tells you one is homing on you: the basic one that it's coming, the advanced one what kind, from where and what to do. Without one, keep looking around. K drops flares and chaff; flying solo, with an RWR on board, they go out by themselves.</li>
        <li><b>Cars and helicopters.</b> Cars drive with W/S and steer with A/D. Helicopters lift off as you raise the throttle (Shift); the stick tilts them to fly that way and they level out when you let go, Q/E turn. Hold B (or Brake) to stop on the ground.</li>
        <li><b>Camera.</b> Drag to look around, scroll or pinch to zoom, C to reset. It follows behind planes, cars and helicopters and beside rockets. On touch screens the stick at the bottom left flies the craft.</li>
      </ol>${Flight.controlsHelp()}`,
      actions: [{ label: 'Got it', primary: true }],
    });
  },

  showResearch() {
    const wrap = el('div', { class: 'tiers' });
    TIERS.forEach((t, i) => {
      const owned = Career.sandbox || i <= Career.data.tier;
      const next = !Career.sandbox && i === Career.data.tier + 1;
      const parts = Object.values(PARTS).filter((p) => p.tier === i && !p.retired).map((p) => p.name).join(', ');
      const row = el('div', { class: 'tier' + (owned ? ' owned' : '') },
        el('div', { class: 'tier-head' }, el('span', { class: 'tier-num', text: `Tier ${i}` }), el('span', { class: 'tier-name', text: t.name }),
          el('span', { class: 'tier-cost', text: owned ? 'Unlocked' : money(t.cost) })),
        el('p', { class: 'tier-parts', text: parts }));
      if (next) {
        const b = el('button', { class: 'btn primary small', text: `Unlock for ${money(t.cost)}` });
        b.disabled = Career.data.funds < t.cost;
        b.addEventListener('click', () => {
          if (Career.buyTier()) { UI.toast(`${t.name} unlocked`); Sound.chime(); UI.closeModal(); Builder.buildPalette(); Builder.changed(true); this.showResearch(); }
        });
        row.append(b);
      }
      wrap.append(row);
    });
    UI.modal({ kicker: Career.sandbox ? 'Sandbox: everything unlocked' : `Funds ${money(Career.data.funds)}`, title: 'Research & Development', body: wrap, actions: [{ label: 'Close' }] });
  },

  showMissions() {
    const wrap = el('div', { class: 'missions' });
    let lastBody = null;
    for (const m of MISSIONS) {
      const group = m.body ? m.body.name : 'Earth';
      if (group !== lastBody) { wrap.append(el('h3', { class: 'summary-h', text: group })); lastBody = group; }
      const done = Career.isDone(m.id);
      wrap.append(el('div', { class: 'mission' + (done ? ' done' : '') },
        el('span', { class: 'mission-check', text: done ? '✓' : '' }),
        el('div', { class: 'mission-text' }, el('b', { text: m.title }), el('span', { text: m.desc })),
        el('span', { class: 'mission-reward', text: Career.sandbox ? '' : money(m.reward) })));
    }
    const p = Career.progress();
    UI.modal({ kicker: `${p.done} of ${p.total} complete`, title: 'Missions', body: wrap, actions: [{ label: 'Close' }] });
  },

  showDeltaV() {
    const rows = deltaVChart();
    const t = el('table', { class: 'dv-table' });
    t.innerHTML = `<thead><tr><th>Body</th><th>Land ↔ orbit</th><th>From Earth orbit</th><th>Capture</th><th>Trip</th></tr></thead>`;
    const tb = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      tr.innerHTML = `<td><span class="dot" style="background:${r.body.colors.map}"></span>${r.body.name}</td>
        <td>${r.landable ? Math.round(r.ascent).toLocaleString('en-US') : '—'}</td>
        <td>${r.body === EARTH ? '—' : Math.round(r.travel).toLocaleString('en-US')}</td>
        <td>${r.body === EARTH ? '—' : Math.round(r.arrive).toLocaleString('en-US')}</td>
        <td>${r.time ? fmt.duration(r.time) : '—'}</td>`;
      tb.append(tr);
    }
    t.append(tb);
    const wrap = el('div', { class: 'dv-wrap' }, t);
    wrap.append(el('p', { class: 'muted small', text: 'Δv in m/s, measured from low orbits, assuming Hohmann transfers and a good launch. Thick atmospheres cost more to climb out of; parachutes and aerobraking save fuel on the way down.' }));
    UI.modal({ kicker: 'Reference', title: 'Δv map', body: wrap, actions: [{ label: 'Close' }] });
  },

  showSettings() {
    const wrap = el('div', { class: 'settings' });
    const row = (label, control) => el('label', { class: 'setting' }, el('span', { text: label }), control);
    const vol = el('input', { id: 'set-volume', type: 'range', min: '0', max: '1', step: '0.05', value: String(Settings.get('volume')) });
    vol.addEventListener('input', () => { Settings.set('volume', +vol.value); Sound.unlock(); Sound.applyVolume(); });
    const q = el('select', { id: 'set-quality' });
    q.innerHTML = '<option value="high">High: clouds, trees, shadows, effects</option><option value="low">Low: faster on older phones</option>';
    q.value = Settings.get('quality');
    q.addEventListener('change', () => Settings.set('quality', q.value));
    const fps = el('select', { id: 'set-fps' });
    fps.innerHTML = '<option value="60">60 fps: saves battery, runs cooler</option><option value="0">Unlimited: as fast as the screen refreshes</option>';
    fps.value = Settings.get('fps') > 0 ? '60' : '0';
    fps.addEventListener('change', () => Settings.set('fps', +fps.value));
    const hints = el('input', { id: 'set-hints', type: 'checkbox' }); hints.checked = Settings.get('hints');
    hints.addEventListener('change', () => Settings.set('hints', hints.checked));
    const marks = el('input', { id: 'set-markers', type: 'checkbox' }); marks.checked = Settings.get('markers');
    marks.addEventListener('change', () => Settings.set('markers', marks.checked));
    const tg = el('select', { id: 'set-targets' });
    tg.innerHTML = '<option value="practice">Practice: targets don’t fight back</option><option value="hostile">Hostile: AA, SAMs and enemy fighters</option><option value="off">Off: no targets</option>';
    tg.value = Settings.get('targets');
    tg.addEventListener('change', () => Settings.set('targets', tg.value));
    wrap.append(row('Volume', vol), row('Graphics', q), row('Frame rate', fps), row('Targets near the islands', tg), row('Flight hints', hints), row('Prograde markers', marks));
    const fs = el('button', { class: 'btn small', text: 'Toggle fullscreen' });
    fs.addEventListener('click', () => {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => UI.toast('Fullscreen isn’t available here'));
      } catch (e) { UI.toast('Fullscreen isn’t available here'); }
    });
    const reset = el('button', { class: 'btn small danger', text: 'Reset career progress' });
    reset.addEventListener('click', () => {
      if (reset.dataset.armed) {
        Career.reset(); store.set('rss.flight', null);
        UI.closeModal(); UI.toast('Career progress reset'); Builder.buildPalette(); Builder.changed(true); this.toHome();
      } else { reset.dataset.armed = '1'; reset.textContent = 'Tap again to reset everything'; }
    });
    wrap.append(el('div', { class: 'setting-actions' }, fs, reset));
    UI.modal({ kicker: 'Settings', title: 'Options', body: wrap, actions: [{ label: 'Done', primary: true }] });
    // the secret: tap the title seven times
    if (Silly.unlocked) { wrap.append(this.sillySettings()); return; }
    let taps = 0;
    $('#modal-card .modal-title').addEventListener('click', () => {
      if (Silly.unlocked) return;
      if (++taps >= 7) {
        Silly.unlock(); Sound.unlock(); Sound.boom(0.6);
        UI.toast('You found the silly settings. No refunds.');
        const box = this.sillySettings();
        wrap.append(box);
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else if (taps >= 3) UI.toast(`${7 - taps} more…`);
    });
  },

  sillySettings() {
    const box = el('div', { class: 'silly' },
      el('div', { class: 'silly-head', text: 'Silly settings' }),
      el('p', { class: 'muted small', text: 'Unofficial, unbalanced and mostly unsafe. They work in career too; we won’t tell.' }));
    const boxes = [];
    for (const [k, label, desc] of Silly.list) {
      const cb = el('input', { type: 'checkbox', 'data-silly': k });
      cb.checked = Silly.on(k);
      cb.addEventListener('change', () => Silly.set(k, cb.checked));
      boxes.push(cb);
      box.append(el('label', { class: 'silly-row' }, cb, el('span', null, el('b', { text: label }), el('small', { text: desc }))));
    }
    const off = el('button', { class: 'btn small', text: 'All off' });
    off.addEventListener('click', () => { for (const cb of boxes) { cb.checked = false; Silly.set(cb.dataset.silly, false); } });
    box.append(off);
    return box;
  },
};

// the real Earth map, baked by tools/bake-earth.py (the single-file build swaps in data: URLs)
const EARTH_MAP_FILES = {
  height: 'assets/earth-height.png', color: 'assets/earth-color.jpg', night: 'assets/earth-night.jpg', lakes: 'assets/earth-lakes.png',
  urban: 'assets/earth-urban.png', regions: 'assets/earth-regions.png', places: 'assets/earth-places.json', lines: 'assets/earth-lines.bin',
};

addEventListener('DOMContentLoaded', () => App.init());

if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.RSS_NO_SW) {
  addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}); });
  // a new version took over: reload into it, unless that would interrupt a flight
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (App.scene === 'flight' || MP.active) UI.toast('A new version is ready. It loads next time you open the game.');
    else location.reload();
  });
}
