'use strict';
// Controls: the one key-binding table every keyboard handler reads (Keys, and its Keys screen in Settings), and the
// touch controls (Controls): on or off (a phone's or a desktop's HUD), the HUD's size (--ui-scale), the floating stick,
// the custom touch layout and its editor, and the key hints a desktop shows in their place.

// ------------------------------------------------------------------------------------------------ the binding table
// [action, group, context, label, default keys (KeyboardEvent.code; Shift, Control, Alt and Meta mean either side)].
// The defaults are the keys the game always had. Contexts say which actions can be live at once: 'any' (every craft),
// 'plane' and 'rocket' (the plane's autopilot keys, and every other craft's), 'drone' (a drone's own: the big update),
// 'ground' (aiming a ground vehicle: these take over from the flight keys while it aims, as they always did), 'build'
// (the hangar), 'bay' (the drone key: live on every craft and read before a ground vehicle's own keys, so it clashes
// with every flight context, 'ground' included). Two actions clash when they share a key and can be live together: the
// same context, 'any' beside 'plane', 'rocket' or 'drone', or 'bay' beside any of the flight contexts.
const KEY_ACTIONS = [
  ['fwd', 'Flight', 'any', 'Pitch down · drive forward', ['KeyW', 'ArrowUp']],
  ['back', 'Flight', 'any', 'Pitch up · reverse', ['KeyS', 'ArrowDown']],
  ['left', 'Flight', 'any', 'Turn, roll or steer left', ['KeyA', 'ArrowLeft']],
  ['right', 'Flight', 'any', 'Turn, roll or steer right', ['KeyD', 'ArrowRight']],
  ['rollL', 'Flight', 'any', 'Rockets roll left · planes and helicopters yaw left · drones slide left', ['KeyQ']],
  ['rollR', 'Flight', 'any', 'Rockets roll right · planes and helicopters yaw right · drones slide right', ['KeyE']],
  ['thrUp', 'Flight', 'any', 'Throttle up (hold) · drones: climb', ['Shift', 'PageUp']],
  ['thrDown', 'Flight', 'any', 'Throttle down (hold) · drones: descend', ['Control', 'PageDown']],
  ['thrFull', 'Flight', 'any', 'Full throttle', ['KeyZ']],
  ['thrCut', 'Flight', 'any', 'Cut the throttle', ['KeyX']],
  ['stage', 'Flight', 'any', 'Next stage', ['Space']],
  ['brake', 'Flight', 'any', 'Brake (hold)', ['KeyB']],
  ['map', 'Flight', 'any', 'Map', ['KeyM']],
  ['mapView', 'Flight', 'any', 'Map: the globe or the solar system', ['KeyN']],
  ['warpDown', 'Flight', 'any', 'Time warp down', ['Comma']],
  ['warpUp', 'Flight', 'any', 'Time warp up', ['Period']],
  ['prevCraft', 'Flight', 'any', 'Previous vessel (spectating: player)', ['BracketLeft']],
  ['nextCraft', 'Flight', 'any', 'Next vessel (spectating: player)', ['BracketRight']],
  ['recover', 'Flight', 'any', 'Recover (stopped on the ground)', ['KeyR']],
  ['menu', 'Flight', 'any', 'Menu (Esc always opens it too)', ['KeyP']],
  ['apHold', 'Planes', 'plane', 'Autopilot: hold attitude', ['Digit1']],
  ['apLevel', 'Planes', 'plane', 'Autopilot: level flight', ['Digit2']],
  ['apHeading', 'Planes', 'plane', 'Autopilot: hold heading', ['Digit3']],
  ['apOff', 'Planes', 'plane', 'Autopilot off: fly it yourself', ['Digit4']],
  ['apAim', 'Planes', 'plane', 'Aim: the plane flies to the circle', ['Digit5']],
  ['flaps', 'Planes', 'any', 'Flaps', ['KeyF']],
  ['gear', 'Planes', 'any', 'Landing gear', ['KeyG']],
  ['catapult', 'Planes', 'any', 'Catapult launch', ['KeyL']],
  ['sasHold', 'Rockets', 'rocket', 'Autopilot: hold', ['Digit1']],
  ['sasPro', 'Rockets', 'rocket', 'Autopilot: prograde', ['Digit2']],
  ['sasRetro', 'Rockets', 'rocket', 'Autopilot: retrograde', ['Digit3']],
  ['sasOut', 'Rockets', 'rocket', 'Autopilot: radial out', ['Digit4']],
  ['sasIn', 'Rockets', 'rocket', 'Autopilot: radial in', ['Digit5']],
  ['sasTarget', 'Rockets', 'rocket', 'Autopilot: target', ['Digit6']],
  ['shell1', 'Armour', 'ground', 'Shell 1 next (twice: load it now)', ['Digit1']],
  ['shell2', 'Armour', 'ground', 'Shell 2 next', ['Digit2']],
  ['shell3', 'Armour', 'ground', 'Shell 3 next', ['Digit3']],
  ['shell4', 'Armour', 'ground', 'Shell 4 next', ['Digit4']],
  ['mg', 'Armour', 'ground', 'Machine guns (hold)', ['Space']],
  ['sight', 'Armour', 'ground', 'Gunner\'s sight (with jets or rockets aboard, a Shift key stays the throttle)', ['Shift']],
  ['aimL', 'Armour', 'ground', 'Turn the aim left', ['KeyQ']],
  ['aimR', 'Armour', 'ground', 'Turn the aim right', ['KeyE']],
  ['lock', 'Armour', 'ground', 'Radar lock', ['KeyL']],
  ['spot', 'Armour', 'ground', 'Spot the enemy under the crosshair', ['KeyJ']],
  ['tacMap', 'Armour', 'ground', 'Tactical map', ['KeyM']],
  ['zero', 'Armour', 'ground', 'Realistic aim: set the sight\'s range', ['KeyY']],
  ['zeroUp', 'Armour', 'ground', 'Realistic aim: the sight\'s range +100 m', ['PageUp']],
  ['zeroDown', 'Armour', 'ground', 'Realistic aim: the sight\'s range −100 m', ['PageDown']],
  // (the big update's drones: U launches one from a tank's bay and switches between the drone and its tank; the rest are
  // live while a drone is flown. J is the Armour's spot key, which is never live on a drone)
  ['drone', 'Drones', 'bay', 'Drones: launch one from the bay · switch between the drone and its tank', ['KeyU']],
  ['dView', 'Drones', 'drone', 'Drone: first-person (FPV) or chase view', ['KeyH']],
  ['dLevel', 'Drones', 'drone', 'Drone: Level (stops and holds its height when you let go)', ['Digit1']],
  ['dAcro', 'Drones', 'drone', 'Drone: Acro (no self-levelling; the throttle is yours)', ['Digit2']],
  ['dHome', 'Drones', 'drone', 'Drone: fly home (to its bay, or where it took off)', ['Digit3']],
  ['dLand', 'Drones', 'drone', 'Drone: land here', ['Digit4']],
  ['dLock', 'Drones', 'drone', 'Drone: lock on to the vehicle in the middle of the picture and fly the attack (again, or any stick: let go)', ['Digit5']],
  ['dThermal', 'Drones', 'drone', 'Drone camera: thermal on or off (gimbal)', ['KeyJ']],
  ['fire', 'Weapons', 'any', 'Fire (hold)', ['KeyV']],
  ['weapon', 'Weapons', 'any', 'Change weapon (with Shift: back)', ['Tab']],
  ['cm', 'Weapons', 'any', 'Flares, chaff or smoke', ['KeyK']],
  ['radarNext', 'Weapons', 'any', 'Radar: the next target (with Shift: back)', ['KeyI']],
  ['radarPower', 'Weapons', 'any', 'Radar on or off (off: silent, warning receivers can\'t hear it)', ['KeyO']],
  ['camera', 'Camera', 'any', 'Reset the camera · aiming: hold to look round, tap to centre', ['KeyC']],
  ['chat', 'Multiplayer', 'any', 'Chat', ['KeyT', 'Enter']],
  ['score', 'Multiplayer', 'any', 'Scoreboard (hold)', ['Backquote']],
  ['bRotate', 'Builder', 'build', 'Rotate the part a quarter turn', ['KeyR']],
  ['bIn', 'Builder', 'build', 'Move the part in (depth)', ['BracketLeft']],
  ['bOut', 'Builder', 'build', 'Move the part out (depth)', ['BracketRight']],
  ['bDelete', 'Builder', 'build', 'Remove the part', ['Delete', 'Backspace']],
  ['bMatch', 'Builder', 'build', 'Paint it like the part it hangs on', ['KeyM']],
  ['bGrid', 'Builder', 'build', 'Grid (2D)', ['KeyG']],
  ['b3d', 'Builder', 'build', '2D blueprint or 3D view', ['KeyV']],
  ['bXray', 'Builder', 'build', 'X-ray (armour and radar)', ['KeyX']],
  ['bFit', 'Builder', 'build', 'Fit the view', ['KeyF']],
  ['bLaunch', 'Builder', 'build', 'Launch', ['Enter']],
];

const Keys = (() => {
  const SIDES = { ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Control', ControlRight: 'Control', AltLeft: 'Alt', AltRight: 'Alt', MetaLeft: 'Meta', MetaRight: 'Meta', OSLeft: 'Meta', OSRight: 'Meta' };
  const BOTH = { Shift: ['ShiftLeft', 'ShiftRight'], Control: ['ControlLeft', 'ControlRight'], Alt: ['AltLeft', 'AltRight'], Meta: ['MetaLeft', 'MetaRight', 'OSLeft', 'OSRight'] };
  const NAMES = { Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Shift: 'Shift', Control: 'Ctrl', Alt: 'Alt', Meta: 'Meta', Tab: 'Tab', Enter: 'Enter',
    Backspace: 'Backspace', Delete: 'Del', Escape: 'Esc', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', IntlBackslash: '\\', Semicolon: ';', Quote: '\'', BracketLeft: '[', BracketRight: ']',
    Minus: '-', Equal: '=', Backquote: '`', PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins', CapsLock: 'Caps', ContextMenu: 'Menu',
    NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .', NumpadEnter: 'Num Enter' };
  const GROUPS = ['Flight', 'Planes', 'Rockets', 'Weapons', 'Camera', 'Armour', 'Drones', 'Multiplayer', 'Builder'];
  const DEF = {}, INFO = {};
  for (const [id, group, ctx, label, def] of KEY_ACTIONS) { DEF[id] = def.slice(); INFO[id] = { id, group, ctx, label }; }
  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  const side = (c) => SIDES[c] || c; // (ShiftLeft → Shift: either side)
  const okCode = (c) => typeof c === 'string' && /^[A-Za-z][A-Za-z0-9]{0,23}$/.test(c) && c !== 'Escape';
  let bind = {}, phys = {}, ver = 0;
  const listeners = [];
  function rebuild() {
    phys = {};
    for (const id in bind) phys[id] = bind[id].flatMap((c) => BOTH[c] || [c]);
    ver++;
    for (const f of listeners) { try { f(); } catch (e) { console.error(e); } }
  }
  // Rows added after keys could be rebound (PR #40): a player may have given their default key to another action before
  // the row existed. A new row's default gives way to the player's own key (below). Add every later row here.
  const LATE = ['radarNext', 'radarPower', 'drone', 'dView', 'dLevel', 'dAcro', 'dHome', 'dLand', 'dThermal', 'dLock'];
  // the player's own keys from rss.keys: only actions that exist, at most two keys each, real key codes (never Esc)
  function clean(raw) {
    const out = {}, own = raw && typeof raw === 'object' ? raw : null;
    for (const id in DEF) {
      const r = own && has(own, id) ? own[id] : null;
      if (!Array.isArray(r)) { out[id] = DEF[id].slice(); continue; }
      const list = [];
      for (const c of r.slice(0, 2)) if (okCode(c) && !list.includes(side(c))) list.push(side(c));
      out[id] = list;
    }
    // a later row left at its default loses a default key the player bound to an action that can be live with it (Fire
    // on I before the radar's I came: I fires, and only fires); the Keys screen shows it unbound, to be set there
    if (own) for (const id of LATE) {
      if (!has(DEF, id) || (has(own, id) && Array.isArray(own[id]))) continue; // (the player's own keys for it: as they set them)
      out[id] = out[id].filter((c) => !Object.keys(out).some((o) => o !== id && has(own, o) && Array.isArray(own[o]) && out[o].includes(c) && clash(INFO[id].ctx, INFO[o].ctx)));
    }
    return out;
  }
  function load() { bind = clean(store.get('rss.keys', null)); rebuild(); }
  function save() {
    const diff = {};
    for (const id in DEF) if (bind[id].join() !== DEF[id].join()) diff[id] = bind[id].slice();
    store.set('rss.keys', diff);
  }
  const clash = (a, b) => a === b || (a === 'any' && (b === 'plane' || b === 'rocket' || b === 'drone')) || (b === 'any' && (a === 'plane' || a === 'rocket' || a === 'drone'))
    || (a === 'bay' && b !== 'build') || (b === 'bay' && a !== 'build'); // (the drone key is read first, whatever the craft: P4-OF-4)
  const name = (c) => NAMES[c] || (/^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : /^Numpad\d$/.test(c) ? `Num ${c.slice(6)}` : c);
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const kb = (c) => `<kbd>${esc(name(c))}</kbd>`;
  const api = {
    ACTIONS: KEY_ACTIONS, GROUPS, INFO,
    get version() { return ver; },
    load, save, clean, name,
    onChange(f) { listeners.push(f); },
    // is this key (e.code) one of the action's?
    is(code, id) { const b = bind[id]; return !!b && b.includes(side(code)); },
    // is the action's key held (keys: a set of e.code)? but: leave out the keys that action has too
    held(keys, id, but) {
      const p = phys[id];
      if (!p) return false;
      for (const c of p) if (keys.has(c) && !(but && bind[but] && bind[but].includes(side(c)))) return true;
      return false;
    },
    mod(code) { return !!BOTH[side(code)]; },
    get(id) { return (bind[id] || []).slice(); },
    // the first key's name (for words: "Full throttle (Z)"), or '—' when nothing is bound
    k(id, i = 0) { const c = bind[id] && bind[id][i]; return c ? name(c) : i ? '' : '—'; },
    // its keys as <kbd>s
    kbd(id) { const b = bind[id] || []; return b.length ? b.map(kb).join('') : '<kbd class="unbound">—</kbd>'; },
    // actions' first keys side by side: "W S A D" (compact, for the key hints)
    firsts(...ids) { return ids.map((id) => (bind[id] && bind[id][0] ? kb(bind[id][0]) : '')).join('') || '<kbd class="unbound">—</kbd>'; },
    // two actions' keys side by side: "W S / ↑ ↓" (the second pair only when both have one)
    pair(a, b) {
      const A = bind[a] || [], B = bind[b] || [], one = (i) => (A[i] ? kb(A[i]) : '') + (B[i] ? kb(B[i]) : '');
      return A[1] && B[1] ? `${one(0)} / ${one(1)}` : one(0) || '<kbd class="unbound">—</kbd>';
    },
    // a row of actions' first keys: "1–5" when they're digits in a row, else each
    run(ids) {
      const cs = ids.map((id) => bind[id] && bind[id][0]);
      const ds = cs.map((c) => (c && /^Digit\d$/.test(c) ? +c.slice(5) : NaN));
      if (ds.every((d, i) => d === ds[0] + i) && ids.length > 2) return `${kb(cs[0])}–${kb(cs[cs.length - 1])}`;
      return cs.filter(Boolean).map(kb).join('') || '<kbd class="unbound">—</kbd>';
    },
    // the actions that would clash with id on this key
    conflicts(id, code) {
      code = side(code);
      const cx = INFO[id].ctx;
      return Object.keys(bind).filter((o) => o !== id && bind[o].includes(code) && clash(cx, INFO[o].ctx));
    },
    set(id, slot, code) {
      if (!has(bind, id) || !okCode(code)) return false;
      code = side(code);
      const b = bind[id].slice(), other = b.indexOf(code);
      if (other >= 0 && other !== slot) b.splice(other, 1); // (already its other key: moved)
      if (slot >= b.length) b.push(code); else b[slot] = code;
      bind[id] = b.slice(0, 2); save(); rebuild(); return true;
    },
    clear(id, slot) { if (!has(bind, id)) return; bind[id] = bind[id].filter((c, i) => i !== slot); save(); rebuild(); },
    drop(id, code) { if (!has(bind, id)) return; bind[id] = bind[id].filter((c) => c !== side(code)); save(); rebuild(); },
    reset(id) { if (!has(DEF, id)) return; bind[id] = DEF[id].slice(); save(); rebuild(); },
    resetAll() { for (const id in DEF) bind[id] = DEF[id].slice(); save(); rebuild(); },
    isDefault(id) { return bind[id].join() === DEF[id].join(); },
    defaults(id) { return DEF[id].slice(); },
    capture: null, // the slot waiting for a key (the Keys screen)
  };
  load();
  return api;
})();

// ------------------------------------------------------------------------------------------------ the touch controls
const Controls = (() => {
  // what the layout editor can move: [selector, its name, the HUD it belongs to ('air': rockets, planes, cars and
  // helicopters; 'ground': Armour; 'both')]
  const CTL = {
    joy: ['#joy', 'Stick', 'both'], sas: ['#sas-bar', 'Autopilot', 'air'], air: ['#flight-ui .air-btns', 'Flaps and gear', 'air'], roll: ['#flight-ui .roll-btns', 'Roll buttons', 'air'],
    brake: ['#btn-brake', 'Brake', 'both'], throttle: ['#flight-ui .throttle-box', 'Throttle', 'both'], stage: ['#flight-ui .stage-box', 'Stage', 'both'],
    fire: ['#btn-fire', 'Fire', 'both'], cm: ['#btn-cm', 'Flares, chaff, smoke', 'both'], chip: ['#btn-weapon', 'Weapon chip', 'both'], catapult: ['#btn-catapult', 'Catapult', 'air'],
    sight: ['#btn-sight', 'Sight', 'ground'], mg: ['#btn-mg', 'Machine guns', 'ground'], lock: ['#btn-lock', 'Radar lock', 'ground'], ammo: ['#ammo-stack', 'Shell chips', 'ground'],
    range: ['#btn-range', 'Sight\'s range', 'ground'], gmap: ['#gmap', 'Minimap', 'ground'], hints: ['#key-hints', 'Key hints', 'both'],
    radar: ['#btn-radar', 'Radar', 'air'], drone: ['#btn-drone', 'Drone', 'ground'],
  };
  const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  // the panels the controls must stay clear of when the HUD grows (fit)
  const PANELS = ['#flight-ui .telemetry', '#flight-ui .flight-top-right', '#warp', '#gmap', '#mp-bar', '#gai-bar'];
  const S = {
    z: 1, // the HUD's scale (--ui-scale): the screen's own times UI size, held to what fits (fit)
    want: 1, nat: 1, // the scale UI size asks for, and the screen's own (UI size 100%)
    layout: null, // { portrait: { air: { key: { x, y, s, o } }, ground }, landscape }
    rest: null, // the stick's rest: { x, y, w } (CSS px)
    joy: { id: null, cx: 0, cy: 0, T: 1, zone: false, dead: true, edge: false, upAt: -1e9 },
    hintKey: '', editing: null,
  };
  const S0 = () => ({ air: {}, ground: {} });
  function cleanLayout(raw) {
    const out = { portrait: S0(), landscape: S0() };
    if (!raw || typeof raw !== 'object') return out;
    for (const o of ['portrait', 'landscape']) for (const h of ['air', 'ground']) {
      const src = has(raw, o) && raw[o] && has(raw[o], h) ? raw[o][h] : null;
      if (!src || typeof src !== 'object') continue;
      for (const k in CTL) {
        if (!has(src, k) || !src[k] || typeof src[k] !== 'object') continue;
        const e = src[k], x = +e.x, y = +e.y, s = e.s == null ? 1 : +e.s, op = e.o == null ? 1 : +e.o;
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 3000 || Math.abs(y) > 3000 || !Number.isFinite(s) || !Number.isFinite(op)) continue; // (a position from nowhere: ignored)
        out[o][h][k] = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, s: clamp(s, 0.5, 2), o: clamp(op, 0.3, 1) };
      }
    }
    return out;
  }
  const doc = () => typeof document !== 'undefined';
  const q = (sel) => (doc() ? document.querySelector(sel) : null);
  const vib = (ms) => { if (Settings.get('haptics') === false) return; try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* unsupported */ } };

  const api = {
    CTL, _S: S, cleanLayout,
    // touch controls on: Settings touchUI 'on' / 'off', or 'auto' (a touch screen's coarse pointer)
    get touch() { const m = Settings.get('touchUI'); return m === 'on' ? true : m === 'off' ? false : typeof isTouch !== 'undefined' && isTouch; },
    get z() { return S.z; },
    get editing() { return !!S.editing; },
    orient() { return innerHeight >= innerWidth ? 'portrait' : 'landscape'; },
    hud() { return doc() && document.body.classList.contains('ground') ? 'ground' : 'air'; },

    init() {
      S.layout = cleanLayout(store.get('rss.layout', null));
      this.applyMode();
      this.bindStick(Flight);
      const kh = q('#key-hints-toggle');
      if (kh) kh.addEventListener('click', () => { const open = !store.get('rss.keyHints', true); store.set('rss.keyHints', open); S.hintKey = ''; this.keyHints(Flight, true); if (typeof App !== 'undefined') App.redraw(); });
      Keys.onChange(() => { this.syncTips(); S.hintKey = ''; });
      this.syncTips();
      addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    },
    // the body's classes: pc (no touch controls: the stick and the touch buttons go, the key hints come)
    applyMode() {
      if (!doc()) return;
      const t = this.touch;
      document.body.classList.toggle('pc', !t); document.body.classList.toggle('touchui', t);
      this.applyScale();
    },
    resize() { this.relayout(); }, // (the HUD's size with it)

    // ---------------------------------------------------------------- the HUD's size
    // From the screen's short side, in bands: a phone's 390 CSS px is 1 (360 → 0.92, 430 → 1.1), a tablet's 1.0-1.3,
    // a desktop 1 up to 800 px tall and larger past it (1080 → 1.2, 1440 → 1.46); times the player's UI size (50-150%),
    // but never so large that the HUD's own room shrinks below what its layout needs: the CSS picks a layout by the
    // screen's real size (a phone on its side up to 500 px tall, a phone in portrait up to 760 px wide, else the desktop's),
    // and each needs its room (330 × 600, 780 × 360, 640 × 640 HUD px). CSS pixels already carry the screen's density
    // (devicePixelRatio), so a dense phone and a desktop get the same physical-ish sizes.
    scaleFor(W, H, touch, u = clamp(+Settings.get('uiSize') || 1, 0.5, 1.5)) {
      const s = Math.min(W, H);
      const a = touch ? (s < 600 ? clamp(s / 390, 0.9, 1.1) : clamp(s / 640, 1, 1.3)) : s < 560 ? clamp(s / 560, 0.85, 1) : clamp(1 + (s - 800) / 1400, 1, 1.5);
      return Math.round(clamp(a * u, 0.5, Math.max(0.5, this.room(W, H))) * 100) / 100;
    },
    // the largest scale the screen has room for (the layout the CSS picks for it, and the room that one needs)
    room(W, H) { return H <= 500 ? Math.min(W / 780, H / 360) : W <= 760 ? Math.min(W / 330, H / 600) : Math.min(W / 640, H / 640); },
    // The HUD's size held to what fits (UI size over 100% used to let a phone's controls run into each other: on 390×844 the
    // roll buttons and Brake into the stage box and CM, on 844×390 flaps and gear into the flight data): over the screen's
    // own scale (nat, UI size 100%), the largest up to the one asked (want) at which no control lands on another, on a
    // panel or the middle of the screen (Aim's circle), or off the screen, that didn't at nat. Measured with every control
    // of this HUD shown (as the editor shows them; put back before anything is painted), on a relayout only (a flight's
    // start, a resize, the setting): a few layouts each, never a frame's work. With the HUD hidden (the home screen) the
    // size asked stands until it shows. Smaller is as asked. Since it measures the layout as it is, moving controls apart
    // in the editor makes room for more.
    fit(want, nat) {
      const ui = q('#flight-ui'), set = (z) => document.documentElement.style.setProperty('--ui-scale', String(z));
      if (want <= nat || !ui || ui.hidden) return want;
      const hud = this.hud(), shown = [];
      for (const k in CTL) {
        if (CTL[k][2] !== 'both' && CTL[k][2] !== hud) continue;
        const e = q(CTL[k][0]);
        if (e && e.hidden) { e.hidden = false; shown.push(e); }
      }
      for (const sel of ['#weapon-box', '#btn-flaps', '#btn-gear']) { const e = q(sel); if (e && e.hidden) { e.hidden = false; shown.push(e); } }
      // (the stick by its slot, whose box its own translate doesn't move: held or gliding home, it is wherever the thumb was)
      const W = innerWidth, H = innerHeight, ctl = Object.keys(CTL).filter((k) => k !== 'gmap').map((k) => (k === 'joy' && q('#flight-ui .rot-controls')) || q(CTL[k][0])).filter(Boolean), els = [...ctl, ...PANELS.map(q).filter(Boolean)];
      const mid = { left: W / 2 - 26, right: W / 2 + 26, top: H / 2 - 26, bottom: H / 2 + 26 }; // (where Aim's circle rests)
      const bad = () => {
        const R = [], out = new Set();
        for (let i = 0; i < els.length; i++) { const r = els[i].getBoundingClientRect(); if (r.width > 0 && r.height > 0) R.push([i, r]); }
        R.push([els.length, mid]);
        for (let a = 0; a < R.length; a++) {
          const [i, r] = R[a];
          if (i < ctl.length && (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5)) out.add(`o${i}`);
          for (let n = a + 1; n < R.length; n++) { const [j, t] = R[n]; if (r.left < t.right - 0.5 && r.right > t.left + 0.5 && r.top < t.bottom - 0.5 && r.bottom > t.top + 0.5) out.add(`${i}.${j}`); }
        }
        return out;
      };
      set(nat);
      const base = bad(), ok = (z) => { set(z); for (const k of bad()) if (!base.has(k)) return false; return true; };
      let z = want;
      if (!ok(want)) { // (the largest that fits, to 0.01, between the screen's own and the size asked)
        let lo = nat, hi = want;
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
        z = Math.max(nat, Math.floor(lo * 100) / 100);
      }
      for (const e of shown) e.hidden = true;
      return z;
    },
    // the size asked, and what fits when the screen holds it back ('' when it doesn't), as UI size percentages
    fits(v) { const f = S.z / (S.nat || 1); return f < v - 0.005 ? `${Math.round(v * 100)}% · fits ${Math.round(f * 100)}%` : ''; },
    applyScale() {
      if (!doc()) return;
      const W = innerWidth, H = innerHeight, t = this.touch;
      S.want = this.scaleFor(W, H, t); S.nat = this.scaleFor(W, H, t, 1);
      const z = this.fit(S.want, S.nat), st = document.documentElement.style;
      if (st.getPropertyValue('--ui-scale') !== String(z)) st.setProperty('--ui-scale', String(z));
      if (z === S.z) return;
      S.z = z;
      if (typeof GHUD !== 'undefined' && GHUD._S) GHUD._S.P = null; // (the ground HUD's places looked up again)
    },

    // ---------------------------------------------------------------- the custom layout
    entries(hud = this.hud(), o = this.orient()) { return S.layout ? S.layout[o][hud] : {}; },
    // every movable control at its place for this HUD and orientation (transforms, so nothing reflows); a control a
    // saved place would put off the screen keeps its own (the place is ignored, not lost)
    relayout() {
      if (!doc() || !S.layout) return;
      const E = this.entries(), W = innerWidth, H = innerHeight;
      for (const k in CTL) { const el = q(CTL[k][0]); if (el) this.place(el, k, E[k]); }
      this.applyScale(); // (the HUD's size, held to what fits with the controls where they are)
      for (const k in CTL) {
        const el = q(CTL[k][0]);
        if (!el) continue;
        const e = E[k];
        if (!e || S.editing) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const ox = Math.max(0, -r.left) + Math.max(0, r.right - W), oy = Math.max(0, -r.top) + Math.max(0, r.bottom - H);
        if (ox > r.width * 0.25 || oy > r.height * 0.25) this.place(el, k, null); // (off the screen: its own place)
      }
      this.measureStick();
    },
    place(el, k, e) {
      const sz = k === 'joy' ? clamp(+Settings.get('stickSize') || 1, 0.75, 1.5) : 1;
      const s = (e ? e.s : 1) * sz;
      const tr = e && (e.x || e.y) ? `${e.x}px ${e.y}px` : '', sc = s !== 1 ? String(Math.round(s * 1000) / 1000) : '', op = e && e.o < 1 ? String(e.o) : '';
      if (el.style.translate !== tr) el.style.translate = tr;
      if (el.style.scale !== sc) el.style.scale = sc;
      if (el.style.opacity !== op) el.style.opacity = op;
    },

    // ---------------------------------------------------------------- the floating stick
    // The left thumb lands anywhere in a generous zone round the stick's place: the ring comes to it (kept on the
    // screen), the knob follows the finger out to the ring's edge, and on release both glide back. The zone keeps its own
    // pointer, so the right thumb (FIRE, the view) goes on independently. Out of a dead zone (9%) the response starts
    // from nothing, on an expo curve (fine near the middle, full at the edge): the direct stick's milder (0.35), Aim's
    // circle rate stronger (0.6). A tick (haptics) leaving the middle and reaching the edge. The DOM is written only
    // when the finger moves; nothing is measured while it does.
    measureStick() {
      const joy = q('#joy'), zone = q('#joy-zone');
      if (!joy || !zone) return;
      const r = joy.getBoundingClientRect();
      if (!r.width) { S.rest = null; return; }
      const keep = S.joy.id != null || performance.now() - S.joy.upAt < 260; // (held, or gliding home: the rest is where it was)
      S.rest = keep && S.rest ? S.rest : { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, w: r.width };
      const W = innerWidth, H = innerHeight, R = S.rest.w / 2, cx = S.rest.x, cy = S.rest.y, map = document.body.classList.contains('mapping');
      // (on the map, only the ring itself: a drag elsewhere pans the map)
      const hw = map ? R : clamp(W * 0.24, 110, 200), up = map ? R : Math.max(R * 1.9, H * 0.33), dn = map ? R : Math.max(R + 24, H * 0.12);
      const L = clamp(cx - hw, 0, W), Rr = clamp(cx + hw, 0, W), T = clamp(cy - up, 0, H), B = clamp(cy + dn, 0, H), z = S.z;
      const st = zone.style, px = (n) => `${Math.round((n / z) * 10) / 10}px`;
      st.left = px(L); st.top = px(T); st.width = px(Rr - L); st.height = px(B - T);
    },
    bindStick(F) {
      const joy = q('#joy'), zone = q('#joy-zone');
      if (!joy || !zone) return;
      const knob = joy.querySelector('.joy-knob'), J = S.joy;
      F.stickAim = F.stickAim || { x: 0, y: 0 };
      const shape = (m, e) => (m <= 0.09 ? 0 : ((m - 0.09) / 0.91) * (1 - e) + e * ((m - 0.09) / 0.91) ** 3);
      const move = (e) => {
        let dx = e.clientX - J.cx, dy = e.clientY - J.cy;
        const d = Math.hypot(dx, dy), m = Math.min(1, d / J.T), ux = d ? dx / d : 0, uy = d ? dy / d : 0;
        if (d > J.T) { dx = ux * J.T; dy = uy * J.T; } // (the knob stops at the ring)
        const k = S.z * (J.s || 1);
        knob.style.transform = `translate(${Math.round((dx / k) * 10) / 10}px, ${Math.round((dy / k) * 10) / 10}px)`;
        const a = shape(m, 0.35), b = shape(m, 0.6);
        F.stick.h = ux * a; F.stick.v = -uy * a; // (up is W: nose down, drive forward)
        F.stickAim.x = ux * b; F.stickAim.y = -uy * b; // (Aim: the circle's rate, up lifts it)
        const out = m > 0.09, edge = m >= 0.99;
        if (out && J.dead) vib(6);
        if (edge && !J.edge) vib(12);
        J.dead = !out; J.edge = edge;
      };
      const off = (e) => {
        if (e && e.pointerId !== J.id) return;
        J.id = null; J.upAt = performance.now();
        F.stick.h = 0; F.stick.v = 0; F.stickAim.x = 0; F.stickAim.y = 0;
        knob.style.transform = ''; joy.style.transform = ''; joy.classList.remove('held');
      };
      zone.addEventListener('pointerdown', (e) => {
        if (J.id != null || S.editing) return; // (a second finger in the zone: nothing)
        e.preventDefault();
        if (!S.rest || performance.now() - J.upAt > 260) this.measureStick(); // (gliding back: the last rest; measured before it counts as held)
        J.id = e.pointerId;
        try { zone.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
        const R0 = S.rest || { x: e.clientX, y: e.clientY, w: 116 }, R = R0.w / 2, W = innerWidth, H = innerHeight;
        J.cx = clamp(e.clientX, R + 2, W - R - 2); J.cy = clamp(e.clientY, R + 2, H - R - 2);
        J.T = R0.w * 0.36; J.dead = true; J.edge = false;
        const E = this.entries().joy;
        J.s = (E ? E.s : 1) * clamp(+Settings.get('stickSize') || 1, 0.75, 1.5);
        const k = S.z * J.s;
        joy.style.transform = `translate(${Math.round(((J.cx - R0.x) / k) * 10) / 10}px, ${Math.round(((J.cy - R0.y) / k) * 10) / 10}px)`;
        joy.classList.add('held');
        move(e);
      });
      zone.addEventListener('pointermove', (e) => { if (e.pointerId === J.id) move(e); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, off);
      zone.addEventListener('contextmenu', (e) => e.preventDefault());
      addEventListener('blur', () => off({ pointerId: J.id }));
      this.stickOff = () => off({ pointerId: J.id });
    },

    // ---------------------------------------------------------------- titles from the bindings
    // a control's tip carries its key: data-k (the action) and data-tip ("Fire (hold {k})"); data-aria for its label
    syncTips() {
      if (!doc()) return;
      document.querySelectorAll('[data-k]').forEach((b) => {
        const k = Keys.k(b.dataset.k);
        if (b.dataset.tip) b.title = b.dataset.tip.replace('{k}', k);
        if (b.dataset.aria) b.setAttribute('aria-label', b.dataset.aria.replace('{k}', k));
      });
    },

    // ---------------------------------------------------------------- a desktop's key hints
    // In place of the touch controls: the keys for the craft and mode at hand, from the current bindings. Rebuilt only
    // when what it would say changes (a short key string a HUD tick), never per frame.
    keyHints(F, force, wsNow) {
      const box = q('#key-hints');
      if (!box || this.touch) return;
      const v = F.active, list = q('#key-hints-list');
      if (S.hintOpen == null || force) S.hintOpen = store.get('rss.keyHints', true) !== false;
      const open = S.hintOpen;
      const ws = v && !F.destroyed ? (wsNow !== undefined ? wsNow : Combat.status(v)) : null, cat = !!(F.catapult && F.catapult.state === 'hold');
      const weap = !!ws && !ws.cmOnly, cm = !!ws && (ws.flares > 0 || ws.chaff > 0 || ws.smoke > 0);
      const dk = !!v && !!v.docks && v.docks.length > 0; // (a drone bay aboard: U launches)
      const mode = !v ? '' : F.groundAim ? `g${Aim.realistic() ? 'r' : ''}${Aim.kit(v).track ? 'l' : ''}${dk ? 'u' : ''}` : F._bodyGround ? `d${dk ? 'u' : ''}` : v.kind === 'plane' ? (F.flyAim ? 'pa' : 'p') + (v.hasFlaps || v.hasRetract ? 'f' : '')
        : v.kind === 'drone' ? `D${v.aircraft ? 'w' : ''}${v.sas}${F.fpv ? 'f' : ''}${v.carrier ? 'b' : ''}${v.dl && v.dl.lockOn ? 'L' : ''}${v.dr && v.dr.cam ? 'c' : ''}${F.fpv && v.dr && v.dr.cam && v.dr.cam.def.drone.cam.gimbal ? 'g' : ''}` : v.kind;
      const rdr = !!(v && !F.destroyed && typeof Radar !== 'undefined' && Radar.aboard(v)); // (a radar aboard: its keys)
      const key = `${mode}|${weap}|${cm}|${cat}|${!!F.mp}|${open}|${Keys.version}|${rdr}${v && v.kind === 'drone' ? '|' + Settings.get('droneStick') : ''}${dk && typeof Drone !== 'undefined' ? '|' + Drone.left(v) + (v.drone && !v.drone.dead ? 'u' : '') : ''}`;
      if (key === S.hintKey && !force) return;
      S.hintKey = key;
      const b = q('#key-hints-toggle');
      b.setAttribute('aria-expanded', String(open)); b.textContent = open ? 'Keys ▾' : 'Keys ▸';
      list.hidden = !open;
      if (!open || !v) { list.innerHTML = ''; return; }
      const f = (...ids) => Keys.firsts(...ids), row = (k, t) => `<div><span class="kh-k">${k}</span><span>${t}</span></div>`;
      const r = [], droneLeft = (o) => (o.drone && !o.drone.dead ? 'Drone (up)' : `Drone ×${typeof Drone !== 'undefined' ? Drone.left(o) : 0}`);
      if (F.groundAim) { // (aiming a ground vehicle's guns)
        r.push(row(f('fwd', 'back'), 'Drive'), row(f('left', 'right'), 'Turn'), row('<kbd>Mouse</kbd>', 'Aim (click)'), row(`<kbd>LMB</kbd>${f('fire')}`, 'Fire'), row(`<kbd>RMB</kbd>${f('sight')}`, 'Sight'),
          row(f('mg'), 'MG (hold)'), row(Keys.run(['shell1', 'shell2', 'shell3', 'shell4']), 'Shells'), row(f('weapon'), 'Weapon'), row(f('cm'), 'Smoke'));
        if (mode.includes('l')) r.push(row(f('lock'), 'Lock'));
        if (mode.includes('r')) r.push(row(f('zero'), 'Range'));
        r.push(row(f('camera'), 'Look (hold)'), row(f('tacMap'), 'Map'), row(f('brake'), 'Brake'));
        if (dk) r.push(row(f('drone'), droneLeft(v)));
      } else if (F._bodyGround || v.kind === 'car') { // (driving: a car, or Armour with nothing to aim)
        r.push(row(f('fwd', 'back'), 'Drive'), row(f('left', 'right'), 'Turn'), row(f('brake'), 'Brake'), row(f('stage'), 'Stage'));
        if (weap) r.push(row(f('fire'), 'Fire'));
        if (cm) r.push(row(f('cm'), 'Smoke'));
        if (dk) r.push(row(f('drone'), droneLeft(v)));
        r.push(row(f('camera'), 'Camera'), row(f('map'), 'Map'));
      } else if (v.kind === 'drone') { // (the big update: a drone's own keys, Level or Acro, its view)
        const tilt = Settings.get('droneStick') === 'tilt', lvl = v.sas !== 'acro' && !v.aircraft;
        if (lvl) r.push(row(f('fwd', 'back'), 'Forward, back'), row(f('left', 'right'), tilt ? 'Slide' : 'Turn'), row(f('rollL', 'rollR'), tilt ? 'Turn' : 'Slide'), row(f('thrUp', 'thrDown'), 'Climb, descend'));
        else r.push(row(f('fwd', 'back'), 'Pitch'), row(f('left', 'right'), 'Roll'), row(f('rollL', 'rollR'), 'Yaw'), row(f('thrUp', 'thrDown'), 'Throttle'), row(f('thrFull', 'thrCut'), 'Full, cut'));
        r.push(row(f('dLevel', 'dAcro'), 'Level, Acro'), row(f('dHome'), 'Home'), row(f('dLand'), 'Land'), row(f('dView'), F.fpv ? 'Chase view' : 'FPV view'));
        if (!v.aircraft && v.dr && v.dr.cam) r.push(row(f('dLock'), v.dl && v.dl.lockOn ? 'Let go' : 'Lock on'));
        if (v.carrier) r.push(row(f('drone'), 'Tank'));
        if (weap) r.push(row(f('fire'), 'Fire'), row(f('weapon'), 'Weapon'));
        if (mode.endsWith('g')) r.push(row(f('camera'), 'Look (hold)'), row(f('dThermal'), 'Thermal'));
        r.push(row(f('map'), 'Map'));
      } else if (v.kind === 'plane') {
        if (F.flyAim) r.push(row('<kbd>Mouse</kbd>', 'Circle (click)'), row(f('fwd', 'back', 'left', 'right'), 'By hand'), row(f('camera'), 'Look (hold)'));
        else r.push(row(f('fwd', 'back'), 'Pitch'), row(f('left', 'right'), 'Roll'));
        r.push(row(f('rollL', 'rollR'), 'Yaw'), row(f('thrUp', 'thrDown'), 'Throttle'), row(f('stage'), 'Stage'), row(Keys.run(['apHold', 'apLevel', 'apHeading', 'apOff', 'apAim']), 'Autopilot'));
        if (mode.endsWith('f')) r.push(row(f('flaps', 'gear'), 'Flaps, gear'));
        if (!F.flyAim) r.push(row(f('brake'), 'Brake'));
        if (weap) r.push(row(`${F.flyAim ? '<kbd>LMB</kbd>' : ''}${f('fire')}`, 'Fire'), row(f('weapon'), 'Weapon'));
        if (cm) r.push(row(f('cm'), 'Flares'));
        if (rdr) r.push(row(f('radarNext', 'radarPower'), 'Radar: next, on/off'));
        if (cat) r.push(row(f('catapult'), 'Launch'));
        r.push(row(f('map'), 'Map'));
      } else { // a rocket or a helicopter
        const heli = v.kind === 'heli';
        r.push(row(f('fwd', 'back', 'left', 'right'), heli ? 'Tilt' : 'Steer'), row(f('rollL', 'rollR'), heli ? 'Turn' : 'Roll'), row(f('thrUp', 'thrDown'), heli ? 'Collective' : 'Throttle'), row(f('stage'), 'Stage'));
        if (!heli) r.push(row(f('thrFull', 'thrCut'), 'Full, cut'), row(Keys.run(['sasHold', 'sasPro', 'sasRetro', 'sasOut', 'sasIn', 'sasTarget']), 'Autopilot'));
        if (heli) r.push(row(f('brake'), 'Brake'));
        if (weap) r.push(row(f('fire'), 'Fire'), row(f('weapon'), 'Weapon'));
        if (cm) r.push(row(f('cm'), 'Flares'));
        if (rdr) r.push(row(f('radarNext', 'radarPower'), 'Radar: next, on/off'));
        if (!F.mp) r.push(row(f('warpDown', 'warpUp'), 'Warp'));
        r.push(row(f('map'), 'Map'));
      }
      r.push(row('<kbd>Esc</kbd>', 'Menu'));
      list.innerHTML = r.join('');
    },

    // ---------------------------------------------------------------- the Keys screen (Settings, and a desktop's pause menu)
    // Every action in its group with its two keys: tap a key, press the new one (Esc cancels, Backspace clears it). A key
    // another action could want at the same time asks: swap them, or clear it there. ↺ puts one back, Reset all every one.
    keysScreen(o = {}) {
      const wrap = el('div', { class: 'kb' });
      wrap.append(el('p', { class: 'muted small kb-note', text: 'Tap a key to change it, then press the new one: Esc cancels, Backspace clears it. While you aim a ground vehicle, the Armour keys take over from the flight keys they share.' }));
      const rows = {}, bar = el('div', { class: 'kb-conflict', role: 'alert' });
      bar.hidden = true;
      for (const g of Keys.GROUPS) {
        wrap.append(el('h3', { class: 'summary-h kb-h', text: g === 'Armour' ? 'Armour (while aiming)' : g }));
        for (const [id, grp, , label] of Keys.ACTIONS) {
          if (grp !== g) continue;
          rows[id] = el('div', { class: 'kb-row', 'data-id': id }, el('span', { class: 'kb-label', text: label }),
            el('button', { class: 'kb-slot', 'data-slot': '0', type: 'button' }), el('button', { class: 'kb-slot', 'data-slot': '1', type: 'button' }),
            el('button', { class: 'kb-reset', type: 'button', title: 'Back to the default', 'aria-label': `${label}: back to the default`, text: '↺' }));
          wrap.append(rows[id]);
        }
      }
      wrap.append(el('p', { class: 'muted small kb-note', text: 'Always: Esc opens the menu (and lets the mouse go); the left mouse button fires and the right one holds the sight while aiming; the wheel zooms; Shift+Tab changes weapon back; the builder keeps Ctrl+Z, Y, C, X, V, D, A and S, and the arrow keys.' }));
      const all = el('button', { class: 'btn small danger', type: 'button', text: 'Reset all keys' });
      wrap.append(el('div', { class: 'setting-actions' }, all));
      const paint = () => {
        for (const id in rows) {
          const R = rows[id], b = Keys.get(id), btn = R.querySelectorAll('.kb-slot');
          btn.forEach((s, i) => {
            const c = b[i];
            s.textContent = c ? Keys.name(c) : i === 0 ? '—' : '+';
            s.classList.toggle('empty', !c); s.classList.remove('wait');
            s.classList.toggle('clash', !!c && Keys.conflicts(id, c).length > 0);
            s.setAttribute('aria-label', `${Keys.INFO[id].label}: ${c ? Keys.name(c) : 'no key'}${i ? ' (second key)' : ''}`);
          });
          R.classList.toggle('changed', !Keys.isDefault(id));
        }
      };
      const stop = () => { Keys.capture = null; };
      const ask = (id, slot, code, others) => {
        const old = Keys.get(id)[slot];
        const btn = (t, f) => { const b = el('button', { class: 'btn small', type: 'button', text: t }); b.addEventListener('click', () => { f(); bar.hidden = true; paint(); }); return b; };
        bar.replaceChildren(el('span', { text: `${Keys.name(code)} is already: ${others.map((x) => Keys.INFO[x].label).join('; ')}.` }),
          btn(old ? `Swap (it gets ${Keys.name(old)})` : 'Move it here', () => { for (const x of others) { const i = Keys.get(x).indexOf(code); Keys.drop(x, code); if (old) Keys.set(x, i, old); } Keys.set(id, slot, code); }),
          btn('Clear it there', () => { for (const x of others) Keys.drop(x, code); Keys.set(id, slot, code); }),
          btn('Cancel', () => {}));
        rows[id].after(bar); bar.hidden = false;
      };
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('button'), R = b && b.closest('.kb-row');
        if (!R) return;
        const id = R.dataset.id;
        bar.hidden = true;
        if (b.classList.contains('kb-reset')) { stop(); Keys.reset(id); paint(); return; }
        const slot = +b.dataset.slot;
        paint();
        b.classList.add('wait'); b.textContent = 'Press a key…';
        Keys.capture = {
          id, slot,
          key: (code) => {
            stop();
            if (code === 'Escape') { paint(); return; }
            if (code === 'Backspace') { Keys.clear(id, slot); paint(); return; }
            const c = Keys.conflicts(id, code);
            if (c.length) { paint(); ask(id, slot, code, c); return; }
            Keys.set(id, slot, code); paint();
          },
        };
      });
      all.addEventListener('click', () => {
        if (!all.dataset.armed) { all.dataset.armed = '1'; all.textContent = 'Tap again to reset every key'; return; }
        stop(); Keys.resetAll(); delete all.dataset.armed; all.textContent = 'Reset all keys'; bar.hidden = true; paint();
      });
      paint();
      UI.modal({ kicker: 'Settings', title: 'Keys', body: wrap, actions: [{ label: 'Done', primary: true }], onClose: () => { stop(); if (o.onClose) o.onClose(); } });
      return wrap;
    },

    // ---------------------------------------------------------------- the layout editor
    // Drag a control to move it; tap one for its size and opacity sliders; it snaps to the screen's edges. Saved per
    // orientation and per HUD (rockets, planes, cars and helicopters; Armour) in rss.layout. From Settings it shows the
    // flight HUD over the home screen; from the pause menu, over the paused flight. Done (or Esc) puts all back.
    edit(o = {}) {
      if (S.editing || !doc()) return;
      const E = S.editing = { o, hud: o.hud || this.hud(), undo: [], sel: null, drag: null, cls: document.body.className, dock: 0 };
      E.inFlight = typeof App !== 'undefined' && App.scene === 'flight';
      const set = (obj, k, v) => { E.undo.push([obj, k, obj[k]]); obj[k] = v; };
      set(q('#flight-ui'), 'hidden', false);
      if (!E.inFlight) set(q('#home'), 'hidden', true);
      E.set = set;
      this.editSetup(E);
      const bar = E.bar = el('div', { id: 'ctl-edit-bar', class: 'ctl-edit-bar panel', role: 'dialog', 'aria-label': 'Edit controls' });
      document.body.append(bar);
      this.editBar(E);
      // every pointer goes to the editor (not the controls, the stick, the view), except on its own bar
      const mine = (e) => !!(e.target && e.target.closest && e.target.closest('#ctl-edit-bar'));
      E.down = (e) => {
        if (mine(e)) return;
        e.preventDefault(); e.stopPropagation();
        const k = this.editHit(E, e.target);
        this.editSelect(E, k);
        if (!k) return;
        const en = this.editEntry(E, k);
        E.drag = { k, id: e.pointerId, sx: e.clientX, sy: e.clientY, x0: en.x, y0: en.y };
      };
      E.move = (e) => {
        if (mine(e)) return;
        e.stopPropagation();
        const d = E.drag;
        if (!d || e.pointerId !== d.id) return;
        e.preventDefault();
        const en = this.editEntry(E, d.k);
        en.x = Math.round((d.x0 + (e.clientX - d.sx) / S.z) * 10) / 10; en.y = Math.round((d.y0 + (e.clientY - d.sy) / S.z) * 10) / 10;
        this.place(q(CTL[d.k][0]), d.k, en);
      };
      E.up = (e) => {
        if (mine(e)) return;
        e.stopPropagation();
        const d = E.drag;
        if (!d || e.pointerId !== d.id) return;
        E.drag = null;
        this.editSnap(E, d.k); this.editSave(E);
      };
      E.block = (e) => { if (!mine(e)) { e.stopPropagation(); if (e.cancelable && e.type !== 'wheel') e.preventDefault(); } };
      E.key = (e) => { if (e.code === 'Escape' && !UI.modalOpen) { e.preventDefault(); e.stopImmediatePropagation(); this.editDone(); } else if (!mine(e)) e.stopImmediatePropagation(); };
      E.rs = () => { this.relayout(); this.editBar(E); };
      addEventListener('pointerdown', E.down, true); addEventListener('pointermove', E.move, true);
      addEventListener('pointerup', E.up, true); addEventListener('pointercancel', E.up, true);
      for (const t of ['click', 'dblclick', 'contextmenu', 'touchstart']) addEventListener(t, E.block, { capture: true, passive: false });
      addEventListener('keydown', E.key, true); addEventListener('resize', E.rs);
      if (this.stickOff) this.stickOff();
      document.body.classList.add('ctl-edit');
      this.relayout();
      if (typeof App !== 'undefined') App.redraw();
    },
    // the HUD being edited: its classes, every one of its controls shown (with stand-in shell chips and key hints)
    editSetup(E) {
      const b = document.body, set = E.set, gr = E.hud === 'ground';
      for (const c of ['ground', 'g-stages', 'g-thrust']) b.classList.toggle(c, gr);
      for (const k in CTL) {
        if (CTL[k][2] !== 'both' && CTL[k][2] !== E.hud) continue;
        const e = q(CTL[k][0]);
        if (e && e.hidden) set(e, 'hidden', false);
      }
      for (const s of ['#weapon-box', '#btn-flaps', '#btn-gear', '#flight-ui .stage-box', '#flight-ui .throttle-box']) { const e = q(s); if (e && e.hidden) set(e, 'hidden', false); }
      const sas = q('#sas-bar'), plane = E.inFlight && Flight.active ? Flight.active.kind === 'plane' : true, drone = !!(E.inFlight && Flight.active && Flight.active.kind === 'drone');
      set(sas, 'className', `sas${plane ? ' plane' : drone ? ' drone' : ''}`);
      sas.querySelectorAll('.sas-btn').forEach((x) => { // (a drone's mode pad in its own flight: the big update)
        const d = x.dataset.drone, want = drone ? !d || (d === 'bay' && !Flight.active.carrier) : plane ? !!d || !PLANE_SAS.has(x.dataset.sas) : !!x.dataset.plane || !!d;
        if (x.hidden !== want) set(x, 'hidden', want);
      });
      const ammo = q('#ammo-stack');
      if (gr && ammo && !ammo.children.length) {
        const kids = [...ammo.childNodes];
        E.undo.push([{ set k(v) { ammo.replaceChildren(...kids); } }, 'k', null]);
        ammo.replaceChildren(...['AP', 'HE', 'APDS'].map((t, i) => el('button', { class: 'ammo-chip', 'aria-pressed': String(i === 0), text: t })));
      }
      const kl = q('#key-hints-list');
      if (kl && !kl.children.length) {
        E.undo.push([{ set k(v) { kl.innerHTML = ''; } }, 'k', null]);
        set(kl, 'hidden', false);
        kl.innerHTML = [['fwd', 'back', 'left', 'right', 'Fly'], ['thrUp', 'thrDown', 'Throttle'], ['stage', 'Stage'], ['fire', 'Fire'], ['map', 'Map']].map((r) => `<div><span class="kh-k">${Keys.firsts(...r.slice(0, -1))}</span><span>${r[r.length - 1]}</span></div>`).join('') + '<div><span class="kh-k"><kbd>Esc</kbd></span><span>Menu</span></div>';
      }
    },
    editHit(E, t) {
      for (const k in CTL) {
        if (CTL[k][2] !== 'both' && CTL[k][2] !== E.hud) continue;
        const e = q(CTL[k][0]);
        if (e && t && e.contains(t) && e.getBoundingClientRect().width > 0) return k;
      }
      return null;
    },
    editEntry(E, k) {
      const L = S.layout[this.orient()][E.hud];
      return L[k] || (L[k] = { x: 0, y: 0, s: 1, o: 1 });
    },
    // to the screen's edges: within 20 px of the 12 px margin it goes onto it (and never off the screen)
    editSnap(E, k) {
      const e = q(CTL[k][0]), en = this.editEntry(E, k);
      if (!e) return;
      const r = e.getBoundingClientRect(), W = innerWidth, H = innerHeight, g = 12, sd = 20;
      let dx = 0, dy = 0;
      if (r.left < g + sd) dx = g - r.left; else if (W - r.right < g + sd) dx = W - g - r.right;
      if (r.top < g + sd) dy = g - r.top; else if (H - r.bottom < g + sd) dy = H - g - r.bottom;
      en.x = Math.round((en.x + dx / S.z) * 10) / 10; en.y = Math.round((en.y + dy / S.z) * 10) / 10;
      this.place(e, k, en);
    },
    editSave(E) {
      const L = S.layout[this.orient()][E.hud];
      for (const k in L) { const e = L[k]; if (Math.abs(e.x) < 0.5 && Math.abs(e.y) < 0.5 && e.s === 1 && e.o === 1) delete L[k]; }
      store.set('rss.layout', S.layout);
      if (E.sel) this.editBar(E);
    },
    editSelect(E, k) {
      document.querySelectorAll('.ctl-sel').forEach((x) => x.classList.remove('ctl-sel'));
      E.sel = k;
      if (k) { const e = q(CTL[k][0]); if (e) e.classList.add('ctl-sel'); }
      this.editBar(E);
    },
    // the editor's bar: which HUD, the selected control's size and opacity, reset, done (top, middle or bottom: ⇅)
    editBar(E) {
      const bar = E.bar;
      if (!bar) return;
      const k = E.sel, en = k ? S.layout[this.orient()][E.hud][k] : null;
      const seg = el('div', { class: 'kind-select ce-seg', role: 'radiogroup', 'aria-label': 'Which controls' });
      for (const [h, t] of [['air', 'Rockets & planes'], ['ground', 'Armour']]) {
        const b = el('button', { class: 'kind-btn', role: 'radio', type: 'button', 'aria-checked': String(E.hud === h), text: t });
        b.addEventListener('click', () => { if (E.hud === h) return; this.editSwitch(E, h); });
        seg.append(b);
      }
      const head = el('div', { class: 'ce-head' }, el('b', { text: `Edit controls · ${this.orient() === 'portrait' ? 'Portrait' : 'Landscape'}` }));
      const dock = el('button', { class: 'btn small icon-only', type: 'button', title: 'Move this bar', 'aria-label': 'Move this bar', text: '⇅' });
      dock.addEventListener('click', () => { E.dock = (E.dock + 1) % 3; bar.dataset.dock = String(E.dock); });
      const done = el('button', { class: 'btn small primary', type: 'button', text: 'Done' });
      done.addEventListener('click', () => this.editDone());
      head.append(dock, done);
      const body = el('div', { class: 'ce-body' });
      const slider = (label, min, max, val, on, id) => {
        const r = el('input', { type: 'range', min: String(min), max: String(max), step: '5', value: String(Math.round(val * 100)) }), out = el('output', { text: `${Math.round(val * 100)}%` });
        if (id) r.id = id;
        r.addEventListener('input', () => { const t = on(+r.value / 100); out.textContent = t || `${r.value}%`; }); // (on may say more: what fits)
        r.addEventListener('change', () => this.editSave(E));
        return el('label', { class: `ce-slider${id ? ' ce-wide' : ''}` }, el('span', { text: label }), r, out);
      };
      if (!k) {
        // the whole HUD at once (Settings → UI size): the same setting, both HUDs and orientations
        body.append(el('p', { class: 'muted small ce-tip', text: 'Drag a control to move it; tap one to change its size and opacity. It snaps to the edges of the screen. UI size sizes the whole HUD, as far as it fits: move some controls apart to make room.' }),
          slider('UI size', 50, 150, clamp(+Settings.get('uiSize') || 1, 0.5, 1.5), (v) => { Settings.set('uiSize', v); this.relayout(); return this.fits(v); }, 'ce-all'));
        const o = body.querySelector('#ce-all').parentNode.querySelector('output'), t = this.fits(clamp(+Settings.get('uiSize') || 1, 0.5, 1.5));
        if (t) o.textContent = t;
      } else {
        const apply = () => this.place(q(CTL[k][0]), k, this.editEntry(E, k));
        const reset = el('button', { class: 'btn small', type: 'button', text: 'Reset this' });
        reset.addEventListener('click', () => { delete S.layout[this.orient()][E.hud][k]; this.place(q(CTL[k][0]), k, null); this.editSave(E); });
        body.append(el('div', { class: 'ce-sel' }, el('b', { text: CTL[k][1] }), reset),
          slider('Size', 50, 200, en ? en.s : 1, (v) => { this.editEntry(E, k).s = v; apply(); }),
          slider('Opacity', 30, 100, en ? en.o : 1, (v) => { this.editEntry(E, k).o = v; apply(); }));
      }
      const all = el('button', { class: 'btn small danger', type: 'button', text: 'Reset to default' });
      all.addEventListener('click', () => {
        if (!all.dataset.armed) { all.dataset.armed = '1'; all.textContent = 'Tap again: all of them'; return; }
        S.layout[this.orient()][E.hud] = {}; store.set('rss.layout', S.layout); this.relayout(); this.editSelect(E, null);
      });
      body.append(el('div', { class: 'ce-foot' }, seg, all));
      bar.replaceChildren(head, body);
      bar.dataset.dock = String(E.dock);
      // never over the chosen control: its own spot first, else the first of middle, top and bottom clear of it
      const c = k && q(CTL[k][0]);
      if (c) {
        const cr = c.getBoundingClientRect(), meets = (r) => r.left < cr.right && r.right > cr.left && r.top < cr.bottom && r.bottom > cr.top;
        for (const d of [E.dock, 0, 1, 2]) { bar.dataset.dock = String(d); if (!meets(bar.getBoundingClientRect())) { E.dock = d; break; } }
        bar.dataset.dock = String(E.dock);
      }
    },
    editSwitch(E, hud) {
      this.editUndo(E);
      E.hud = hud; E.sel = null;
      document.querySelectorAll('.ctl-sel').forEach((x) => x.classList.remove('ctl-sel'));
      this.editSetup(E);
      this.relayout(); this.editBar(E);
    },
    editUndo(E) {
      for (let i = E.undo.length - 1; i >= 0; i--) { const [obj, k, v] = E.undo[i]; if (obj === q('#flight-ui') || obj === q('#home')) continue; obj[k] = v; }
      E.undo = E.undo.filter(([obj]) => obj === q('#flight-ui') || obj === q('#home'));
      const keep = ['ctl-edit'];
      document.body.className = E.cls;
      for (const c of keep) document.body.classList.add(c);
    },
    editDone() {
      const E = S.editing;
      if (!E) return;
      this.editSave(E);
      removeEventListener('pointerdown', E.down, true); removeEventListener('pointermove', E.move, true);
      removeEventListener('pointerup', E.up, true); removeEventListener('pointercancel', E.up, true);
      for (const t of ['click', 'dblclick', 'contextmenu', 'touchstart']) removeEventListener(t, E.block, { capture: true, passive: false });
      removeEventListener('keydown', E.key, true); removeEventListener('resize', E.rs);
      document.querySelectorAll('.ctl-sel').forEach((x) => x.classList.remove('ctl-sel'));
      for (let i = E.undo.length - 1; i >= 0; i--) { const [obj, k, v] = E.undo[i]; obj[k] = v; }
      document.body.className = E.cls;
      E.bar.remove();
      S.editing = null; S.hintKey = '';
      this.relayout();
      if (E.inFlight && typeof Flight !== 'undefined' && Flight.running) Flight.updateHUD(true);
      if (typeof App !== 'undefined') App.redraw();
      if (E.o.done) E.o.done();
    },
  };
  return api;
})();

// a key pressed for the Keys screen's slot: before every other handler (this is added first, in the capture phase)
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  addEventListener('keydown', (e) => {
    const c = Keys.capture;
    if (!c) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    c.key(e.code);
  }, true);
}
