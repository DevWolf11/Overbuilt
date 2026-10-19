'use strict';
// App shell: canvas sizing, scenes (home, hangar, flight), menus and the main loop.

const App = {
  scene: 'home',

  init() {
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
    $('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal' && !(App.scene === 'flight' && Flight.ended)) UI.closeModal(); });
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && UI.modalOpen && !(App.scene === 'flight' && Flight.ended)) { e.preventDefault(); e.stopImmediatePropagation(); UI.closeModal(); } }, true);
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    // phones kill background tabs without warning: save the flight whenever the page is hidden
    const stash = () => { if (this.scene === 'flight') Flight.save(); };
    document.addEventListener('visibilitychange', () => { if (document.hidden) stash(); });
    addEventListener('pagehide', stash);
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    this.toHome();
  },

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    if (Render3D.ready) Render3D.resize(this.W, this.H, this.dpr);
  },

  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    try {
      let in3d = false;
      if (this.scene === 'build') {
        in3d = this.use3D();
        if (in3d) { Render3D.setVisible(true); Render3D.renderBuilder(Builder, dt); this.clear2D(); } else Builder.render(this.ctx, this.W, this.H, this.dpr);
      } else if (this.scene === 'flight') {
        Flight.update(dt);
        in3d = this.use3D() && !Flight.mapMode && Flight.running;
        if (in3d) {
          Flight.updateCamera();
          Render3D.setVisible(true);
          Render3D.renderFlight(Flight, dt);
          this.clear2D();
          World.drawOverlay3D(this.ctx, this.W, this.H, this.dpr, Flight);
        } else Flight.render(this.ctx, this.W, this.H, this.dpr);
      } else this.renderHome(dt);
      if (!in3d && Render3D.ready) Render3D.setVisible(false);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame((tt) => this.frame(tt));
  },

  clear2D() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); },

  // ---------------------------------------------------------------- 3D view
  get view3d() { return !!Settings.get('view3d') && Render3D.supported && !Render3D.failed; },
  use3D() {
    if (!this.view3d || !Render3D.ready) {
      if (Render3D.failed && Settings.get('view3d') && !this.warned3d) { this.warned3d = true; UI.toast('3D view stopped working. Back to 2D.'); this.sync3D(); }
      return false;
    }
    return true;
  },
  init3D() {
    const show = Render3D.supported;
    document.querySelectorAll('.view3d-toggle').forEach((b) => { b.hidden = !show; b.addEventListener('click', () => this.set3D(!Settings.get('view3d'))); });
    if (this.view3d) this.load3D();
    this.sync3D();
  },
  load3D() {
    Render3D.load().then(() => { Render3D.resize(this.W, this.H, this.dpr); this.sync3D(); }).catch((e) => {
      console.error(e);
      Settings.set('view3d', false);
      this.sync3D();
      UI.toast('3D view isn’t available on this device');
    });
  },
  set3D(on) {
    if (on && !Render3D.supported) { UI.toast('3D view isn’t available on this device'); return; }
    Settings.set('view3d', !!on);
    if (on) { this.load3D(); if (!Render3D.ready) UI.toast('Loading 3D view…'); }
    Sound.click();
    this.sync3D();
  },
  sync3D() {
    const on = this.view3d;
    document.querySelectorAll('.view3d-toggle').forEach((b) => {
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Switch to 2D view (V)' : 'Switch to 3D view (V)';
      b.setAttribute('aria-label', b.title);
    });
    $('#build-3d-hint').hidden = !on;
  },

  showScene(name) {
    this.scene = name;
    $('#home').hidden = name !== 'home';
    $('#build-ui').hidden = name !== 'build';
    $('#flight-ui').hidden = name !== 'flight';
  },

  // ---------------------------------------------------------------- home
  bindHome() {
    $('#home-build').addEventListener('click', () => this.toBuild());
    $('#home-resume').addEventListener('click', () => this.resumeFlight());
    $('#home-settings').addEventListener('click', () => this.showSettings());
    $('#home-help').addEventListener('click', () => this.showHelp());
    $('#home-dv').addEventListener('click', () => this.showDeltaV());
    $('#home-mode').addEventListener('click', () => this.chooseMode());
    $('#btn-home').addEventListener('click', () => this.toHome());
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      Career.setMode(b.dataset.mode);
      this.toHome();
      Builder.buildPalette(); Builder.changed(true);
      if (!store.get('rss.seenHelp', false)) { store.set('rss.seenHelp', true); setTimeout(() => this.showHelp(), 250); }
    }));
  },

  toHome() {
    if (this.scene === 'flight') { Flight.save(); Flight.stop(); }
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
    if (this.scene === 'flight') { Flight.save(); Flight.stop(); }
    this.showScene('build');
    Builder.buildPalette();
    Builder.changed(true);
    Builder.fitView();
  },

  launch() {
    if (!Builder.ctrl) { UI.toast('Add a Command Pod or Probe Core first'); return; }
    const s = Builder.statsData;
    if (s.locked.length) { UI.toast('This rocket uses parts you haven’t unlocked yet'); return; }
    if (!Career.canAfford(s.cost)) { UI.toast(`Not enough funds: this rocket costs ${money(s.cost)}`); return; }
    const go = () => {
      if (s.loose) UI.toast(`${s.loose} loose part(s) left in the hangar`);
      store.set('rss.flight', null);
      this.showScene('flight');
      Flight.start(Builder.serialize());
      const tip = { rocket: 'Press STAGE (Space) to ignite', plane: 'Press STAGE (Space) to start the engine', car: 'Drive with D and A (⟳ ⟲)', heli: 'Press STAGE (Space) to start the rotor' }[Builder.kind];
      if (Settings.get('hints') && tip) UI.toast(tip);
    };
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
    this.showScene('flight');
    try { Flight.restore(saved); } catch (e) { console.error(e); UI.toast('That saved flight could not be loaded'); store.set('rss.flight', null); this.toBuild(); }
  },

  // ---------------------------------------------------------------- menus
  showHelp() {
    UI.modal({
      kicker: 'Flight manual', title: 'How to fly',
      body: `<ol class="howto">
        <li><b>Build.</b> Drag parts from the tray onto the blueprint; edges snap together. Tap a tray part to stack it automatically, or drag a part back onto the tray to remove it. The yellow disc is the centre of mass; the purple arrow is where the stage-1 engines push.</li>
        <li><b>Stage.</b> Orange numbers show the firing order. Separators split the rocket, and fuel can't flow through them. Solid boosters can't be shut down.</li>
        <li><b>Launch.</b> Hit STAGE to light the engines. Climb straight up to about 3 km, then lean right a little at a time.</li>
        <li><b>Orbit.</b> Once apoapsis clears 30 km, cut the engines, coast up, press PRO and burn until periapsis also clears 30 km.</li>
        <li><b>Travel.</b> In the map, tap a planet or moon to target it. The HUD tells you when the transfer window opens. Warp to it, burn prograde until an encounter appears, then burn retrograde at periapsis to be captured.</li>
        <li><b>Come home hot.</b> Returns from the Moon and planets heat the leading part. Lead with a heat shield, then open the parachute below 250 m/s.</li>
        <li><b>Other vehicles.</b> Pick Plane, Car or Helicopter above the stats. Planes are built nose-right with wings, a tail and landing gear, and take off from the runway: full throttle, then pull up with ⟲ at about 55 m/s. Cars drive with ⟲ ⟳. Helicopters lift off from the helipad as you raise the throttle. Hold B (or Brake) to stop on the ground.</li>
        <li><b>3D.</b> The 3D button shows the same world in 3D. Drag to look around; the zoom and controls stay the same.</li>
      </ol>${Flight.controlsHelp()}`,
      actions: [{ label: 'Got it', primary: true }],
    });
  },

  showResearch() {
    const wrap = el('div', { class: 'tiers' });
    TIERS.forEach((t, i) => {
      const owned = Career.sandbox || i <= Career.data.tier;
      const next = !Career.sandbox && i === Career.data.tier + 1;
      const parts = Object.values(PARTS).filter((p) => p.tier === i).map((p) => p.name).join(', ');
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
    const hints = el('input', { id: 'set-hints', type: 'checkbox' }); hints.checked = Settings.get('hints');
    hints.addEventListener('change', () => Settings.set('hints', hints.checked));
    const marks = el('input', { id: 'set-markers', type: 'checkbox' }); marks.checked = Settings.get('markers');
    marks.addEventListener('change', () => Settings.set('markers', marks.checked));
    const v3 = el('input', { id: 'set-3d', type: 'checkbox' }); v3.checked = !!Settings.get('view3d'); v3.disabled = !Render3D.supported;
    v3.addEventListener('change', () => this.set3D(v3.checked));
    wrap.append(row('Volume', vol), row('Graphics', q), row('3D view', v3), row('Flight hints', hints), row('Prograde markers', marks));
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
  },
};

addEventListener('DOMContentLoaded', () => App.init());

if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.RSS_NO_SW) {
  addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
