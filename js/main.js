'use strict';
// App shell: canvas sizing, scene switching and the main loop.

const App = {
  scene: 'build',

  init() {
    this.canvas = $('#view');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
    // fill the inline icons
    document.querySelectorAll('[data-icon]').forEach((n) => n.prepend(icon(n.dataset.icon)));
    Builder.init(this.canvas);
    Flight.init(this.canvas);
    $('#btn-sound').addEventListener('click', () => { Sound.unlock(); Sound.setMuted(!Sound.muted); this.syncSound(); });
    this.syncSound();
    $('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal' && !Flight.ended) UI.closeModal(); });
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && UI.modalOpen && !(App.scene === 'flight' && Flight.ended)) { e.preventDefault(); e.stopImmediatePropagation(); UI.closeModal(); } }, true);
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    if (!store.get('rss.seenHelp', false)) { store.set('rss.seenHelp', true); setTimeout(() => this.showHelp(), 300); }
    setTimeout(() => Builder.fitView(), 50);
  },

  syncSound() {
    const b = $('#btn-sound');
    b.innerHTML = '';
    b.append(icon(Sound.muted ? 'mute' : 'sound'));
    b.setAttribute('aria-label', Sound.muted ? 'Unmute sound' : 'Mute sound');
  },

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
  },

  frame(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    try {
      if (this.scene === 'build') Builder.render(this.ctx, this.W, this.H, this.dpr);
      else { Flight.update(dt); Flight.render(this.ctx, this.W, this.H, this.dpr); }
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame((tt) => this.frame(tt));
  },

  launch() {
    if (!Builder.ctrl) { UI.toast('Add a Command Pod or Probe Core first'); return; }
    if (Builder.statsData.loose) UI.toast(`${Builder.statsData.loose} loose part(s) left in the hangar`);
    const design = Builder.serialize();
    this.scene = 'flight';
    $('#build-ui').hidden = true;
    $('#flight-ui').hidden = false;
    Flight.start(design);
    Flight.mapMode = false;
    $('#btn-map').classList.remove('on');
    $('#btn-center').hidden = true;
    UI.toast('Press STAGE (Space) to ignite');
  },

  toBuild() {
    Flight.stop();
    this.scene = 'build';
    $('#flight-ui').hidden = true;
    $('#build-ui').hidden = false;
    Builder.fitView();
  },

  showHelp() {
    UI.modal({
      kicker: 'Flight manual', title: 'How to fly',
      body: `<ol class="howto">
        <li><b>Build.</b> Drag parts from the tray onto the blueprint. Parts snap together when their edges touch. Tap a tray part to stack it automatically. Drag a part back onto the tray to remove it.</li>
        <li><b>Stage.</b> The orange numbers show the firing order. Separators split the rocket, and fuel can't flow through them.</li>
        <li><b>Launch.</b> Hit STAGE to light the engines. Climb straight up to about 5 km, then lean east (right) a little at a time.</li>
        <li><b>Orbit.</b> Open the map. When your apoapsis is above 30 km, cut the engines, coast to it, and burn sideways until the periapsis rises above 30 km too.</li>
        <li><b>Moon.</b> From orbit, burn prograde when the Moon is rising over the horizon until the map shows an encounter. Time warp is your friend.</li>
      </ol>${Flight.controlsHelp()}`,
      actions: [{ label: 'Got it', primary: true }],
    });
  },
};

addEventListener('DOMContentLoaded', () => App.init());

if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.RSS_NO_SW) {
  addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
