'use strict';
// Build screen: drag parts from the tray onto a blueprint grid.

const TEMPLATES = {
  hopper: {
    name: 'Hopper', kind: 'rocket', tier: 0, blurb: 'A suborbital hop. Fly up, separate, open the parachute.',
    parts: [['hawk', 0, 1], ['tankM', 0, 3], ['separator', 0, 4.25], ['pod', 0, 5.5], ['chute', 0, 6.75]],
  },
  pathfinder: {
    name: 'Pathfinder', kind: 'rocket', tier: 0, blurb: 'Two Hawk stages and basic parts. Enough to reach Earth orbit.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankL', 0, 8], ['separator', 0, 10.25], ['hawk', 0, 11.5], ['tankM', 0, 13.5],
      ['pod', 0, 15.5], ['chute', 0, 16.75], ['fin', 1.375, 2.75], ['fin', -1.375, 2.75]],
  },
  orbiter: {
    name: 'Orbiter', kind: 'rocket', tier: 1, blurb: 'Efficient vacuum upper stage. Orbit with fuel to spare.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankL', 0, 8], ['separator', 0, 10.25], ['valiant', 0, 11.25],
      ['tankM', 0, 13], ['pod', 0, 15], ['chute', 0, 16.25], ['fin', 1.375, 2.75], ['fin', -1.375, 2.75]],
  },
  probe: {
    name: 'Moon Probe', kind: 'rocket', tier: 1, blurb: 'A light probe on a two-stage booster. Land it gently on the Moon.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankM', 0, 7], ['separator', 0, 8.25], ['valiant', 0, 9.25],
      ['tankM', 0, 11], ['separator', 0, 12.25], ['kolibri', 0, 13], ['tankThin', 0, 14.5], ['probe', 0, 16],
      ['leg', 0.75, 14], ['leg', -0.75, 14]],
  },
  lunar: {
    name: 'Lunar Lander', kind: 'rocket', tier: 1, blurb: 'Boosters, a transfer stage, a lander and a shielded capsule. Moon and back.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankL', 0, 8], ['separator', 0, 10.25], ['valiant', 0, 11.25],
      ['tankL', 0, 14], ['separator', 0, 16.25], ['valiant', 0, 17.25], ['tankM', 0, 19], ['separator', 0, 20.25],
      ['heatShield', 0, 20.75], ['pod', 0, 22], ['chute', 0, 23.25],
      ['leg', 1.25, 17.5], ['leg', -1.25, 17.5],
      ['sideSep', 1.25, 5], ['tankL', 2.5, 4], ['hawk', 2.5, 1], ['nose', 2.5, 6.75],
      ['sideSep', -1.25, 5], ['tankL', -2.5, 4], ['hawk', -2.5, 1], ['nose', -2.5, 6.75]],
  },
  rover: {
    name: 'Lunar Rover', kind: 'rocket', tier: 3, blurb: 'A rover that flies itself to the Moon, lands on its wheels and drives.',
    parts: [['titan', 0, 1.5], ['tankWideL', 0, 6], ['tankWideL', 0, 12], ['separatorL', 0, 15.25], ['valiant', 0, 16.25], ['tankL', 0, 19],
      ['separatorL', 0, 21.25], ['kolibri', 0.5, 22], ['kolibri', -0.5, 22], ['wheel', 1.75, 22], ['wheel', -1.75, 22],
      ['tankWide', 0, 24], ['probeL', 0, 25.875]],
  },
  ares: {
    name: 'Ares Mars Lander', kind: 'rocket', tier: 3, blurb: 'Titan and Thunder boosters, a nuclear transfer stage and a shielded Mars lander.',
    parts: [['titan', 0, 1.5], ['tankWideL', 0, 6], ['tankWideL', 0, 12], ['adapterL', 0, 15.5], ['separator', 0, 16.25],
      ['prometheus', 0, 18], ['tankXL', 0, 22.5], ['separator', 0, 25.75], ['heatShield', 0, 26.25], ['separator', 0, 26.75],
      ['spire', 0, 27.75], ['tankM', 0, 29.5], ['probeL', 0, 30.875], ['chuteL', 0, 31.5],
      ['leg', 1.25, 28.5], ['leg', -1.25, 28.5],
      ['sideSep', 1.75, 5], ['thunder', 2.75, 4], ['noseS', 2.75, 8.5],
      ['sideSep', -1.75, 5], ['thunder', -2.75, 4], ['noseS', -2.75, 8.5]],
  },
  // Planes are built nose-right: the stack runs along +y and the landing gear sits on the +x side.
  skylark: {
    name: 'Skylark', kind: 'plane', tier: 0, blurb: 'A propeller trainer. Full throttle, then pull up gently at about 55 m/s.',
    parts: [['tailcone', 0, 1.25], ['fuselage', 0, 4.5], ['cockpit', 0, 7.75], ['propeller', 0, 9.45],
      ['wing', -1.25, 4.6], ['elevator', -0.65, -0.75], ['vtail', -1.8, 1.1], ['gear', 1.7, 4.6], ['gear', 1.7, 7.6]],
  },
  hornet: {
    name: 'Hornet', kind: 'plane', tier: 2, blurb: 'A turbojet fighter. Fast enough to break the sound barrier.',
    parts: [['jet', 0, 1.5], ['fuselage', 0, 5], ['cockpit', 0, 8.25], ['wing', -1.25, 4.6], ['elevator', 0.9, 0.9],
      ['vtail', -1.55, 1.5], ['gear', 1.7, 4.2], ['gear', 1.7, 8]],
  },
  buggy: {
    name: 'Dune Buggy', kind: 'car', tier: 0, blurb: 'Drive with the rotate controls. The causeway leads to the mainland.',
    parts: [['chassis', 0, 1.25], ['cab', -0.4, 2.25], ['carWheel', 1.4, 0.4], ['carWheel', -1.4, 0.4]],
  },
  dragonfly: {
    name: 'Dragonfly', kind: 'heli', tier: 1, blurb: 'A light helicopter. Raise the throttle until it lifts, then tilt to fly.',
    parts: [['cab', 0, 1.75], ['tankS', 0, 3], ['rotor', -0.7, 4.1], ['chassis', -3.2, 2.05], ['tailRotor', -4.6, 1],
      ['carWheel', 0.9, 0.4], ['carWheel', -0.9, 0.4]],
  },
};

const Builder = {
  init(canvas) {
    this.canvas = canvas;
    this.parts = [];
    this.selected = null;
    this.cam = { x: 0, y: 8, scale: 26 };
    this.pointers = new Map();
    this.symmetry = store.get('rss.symmetry', true);
    this.category = 'command';
    this.name = 'Rocket';
    this.history = [];
    this.future = [];
    this.bindDom();
    const saved = store.get('rss.design', null);
    if (saved && saved.parts && saved.parts.length) this.loadDesign(saved);
    else this.loadTemplate('hopper');
    this.buildPalette();
  },

  // ---------------------------------------------------------------- design io
  serialize() {
    return { name: this.name, parts: this.parts.map((p) => ({ type: p.type, x: +p.x.toFixed(3), y: +p.y.toFixed(3), flip: p.flip })) };
  },
  save() { store.set('rss.design', this.serialize()); },
  loadDesign(d, keepHistory) {
    this.parts = d.parts.filter((q) => PARTS[q.type]).map((q) => makePart(q.type, q.x, q.y, { flip: !!q.flip }));
    if (d.name) this.name = d.name;
    this.linkMirrors();
    this.selected = null;
    if (!keepHistory) { this.history = []; this.future = []; }
    this.changed(!!keepHistory);
    this.renderInfo();
    if (!keepHistory) this.fitView();
  },
  loadTemplate(key) {
    const t = TEMPLATES[key];
    this.loadDesign({ name: t.name, parts: t.parts.map(([type, x, y]) => ({ type, x, y, flip: x < 0 })) });
  },
  linkMirrors() {
    for (const p of this.parts) p.mirror = null;
    for (const p of this.parts) {
      if (p.mirror || Math.abs(p.x) < 0.01) continue;
      const m = this.parts.find((q) => q !== p && !q.mirror && q.type === p.type && Math.abs(q.x + p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01);
      if (m) { p.mirror = m; m.mirror = p; }
    }
  },

  changed(fromHistory) {
    this.adj = buildAdjacency(this.parts);
    this.ctrl = findControlPart(this.parts);
    this.attached = this.ctrl ? componentOf(this.ctrl.id, this.adj) : new Set();
    const ps = this.parts.filter((p) => this.attached.has(p.id));
    const adj = new Map();
    for (const p of ps) adj.set(p.id, new Set([...this.adj.get(p.id)].filter((id) => this.attached.has(id))));
    this.stages = this.ctrl ? computeStages(ps, adj, this.ctrl.id) : [];
    this.stageOf = new Map();
    this.stages.forEach((st, i) => st.forEach((id) => this.stageOf.set(id, i + 1)));
    const dv = this.ctrl ? estimateDeltaV(ps, adj, this.ctrl.id, this.stages, false) : { total: 0, perStage: [], twr: [] };
    let mass = 0, thrust = 0, tx = 0, ty = 0, cx = 0, cy = 0;
    for (const p of ps) { const m = p.def.mass * 1000 + p.fuel; mass += m; cx += m * p.x; cy += m * p.y; }
    const first = new Set(this.stages[0] || []);
    for (const p of ps) if (first.has(p.id) && p.def.thrust) { thrust += p.def.thrust * 1000; tx += p.def.thrust * p.x; ty += p.def.thrust * (p.y - p.def.h / 2); }
    this.com = mass ? { x: cx / mass, y: cy / mass } : null;
    this.cot = thrust ? { x: (tx * 1000) / thrust, y: (ty * 1000) / thrust } : null;
    const locked = this.parts.filter((p) => !Career.unlocked(p.def));
    this.statsData = {
      mass, thrust, twr: thrust / (mass * EARTH.surfaceG || 1), dv: dv.total, perStage: dv.perStage, stageTwr: dv.twr,
      loose: this.parts.length - ps.length, cost: designCost(ps), locked,
    };
    this.renderStats();
    if (!fromHistory) {
      const snap = JSON.stringify(this.serialize());
      if (this.history[this.history.length - 1] !== snap) {
        this.history.push(snap);
        if (this.history.length > 60) this.history.shift();
        this.future = [];
      }
      this.save();
    }
    this.syncUndo();
  },
  undo() {
    if (this.history.length < 2) return;
    this.future.push(this.history.pop());
    this.loadDesign(JSON.parse(this.history[this.history.length - 1]), true);
    this.save();
  },
  redo() {
    if (!this.future.length) return;
    const s = this.future.pop();
    this.history.push(s);
    this.loadDesign(JSON.parse(s), true);
    this.save();
  },
  syncUndo() {
    $('#btn-undo').disabled = this.history.length < 2;
    $('#btn-redo').disabled = !this.future.length;
  },

  // ---------------------------------------------------------------- geometry
  screenToWorld(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    return { x: this.cam.x + (sx - r.left - r.width / 2) / this.cam.scale, y: this.cam.y - (sy - r.top - r.height / 2) / this.cam.scale };
  },
  hitPart(w) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const r = partRect(this.parts[i]);
      const pad = isTouch ? 0.2 : 0.05;
      if (w.x >= r.l - pad && w.x <= r.r + pad && w.y >= r.b - pad && w.y <= r.t + pad) return this.parts[i];
    }
    return null;
  },
  fitView() {
    if (!this.parts.length) { this.cam = { x: 0, y: 6, scale: 26 }; return; }
    let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity;
    for (const p of this.parts) { const R = partRect(p); l = Math.min(l, R.l); r = Math.max(r, R.r); b = Math.min(b, R.b); t = Math.max(t, R.t); }
    const area = this.viewArea();
    const scale = Math.min(area.w / (r - l + 6), area.h / (t - b + 4));
    this.cam.scale = clamp(scale, 5, 60);
    this.cam.x = (l + r) / 2 - (area.cx - innerWidth / 2) / this.cam.scale;
    this.cam.y = (b + t) / 2 + (area.cy - innerHeight / 2) / this.cam.scale;
  },
  viewArea() {
    const top = $('#build-top').getBoundingClientRect().bottom + (innerWidth <= 760 ? $('#stats').getBoundingClientRect().height + 8 : 0);
    const bottom = $('#palette').getBoundingClientRect().top;
    let left = 0;
    if (innerWidth > 760) left = $('#stats').getBoundingClientRect().right;
    return { w: innerWidth - left, h: bottom - top, cx: (left + innerWidth) / 2, cy: (top + bottom) / 2 };
  },

  // Find a good spot for a part of `type` near the desired centre.
  snap(type, want, ignore) {
    const def = PARTS[type];
    const w = def.w, h = def.h;
    const others = this.parts.filter((p) => !ignore.includes(p));
    const probe = (x, y) => ({ def, type, x, y });
    const free = (x, y) => !others.some((o) => partsOverlap(probe(x, y), o));
    const radius = Math.max(1.4, 26 / this.cam.scale);
    let best = null, bestD = radius;
    const consider = (x, y) => {
      const d = Math.hypot(x - want.x, y - want.y);
      if (d < bestD && free(x, y)) { best = { x, y }; bestD = d; }
    };
    const g = (v) => Math.round(v * 4) / 4;
    for (const o of others) {
      const R = partRect(o);
      consider(o.x, R.t + h / 2);
      consider(o.x, R.b - h / 2);
      const yy = clamp(g(want.y), R.b - h / 2 + 0.25, R.t + h / 2 - 0.25);
      consider(R.r + w / 2, yy); consider(R.l - w / 2, yy);
      consider(R.r + w / 2, R.t - h / 2); consider(R.l - w / 2, R.t - h / 2);
      consider(R.r + w / 2, R.b + h / 2); consider(R.l - w / 2, R.b + h / 2);
      if (Math.abs(want.x - o.x) < w) { consider(g(want.x), R.t + h / 2); consider(g(want.x), R.b - h / 2); }
    }
    if (best) return { ...best, attached: true, ok: true };
    const gx = g(want.x), gy = g(want.y);
    return { x: gx, y: gy, attached: false, ok: free(gx, gy) };
  },

  mirrorOk(type, x, y, ignore) {
    if (Math.abs(x) < 0.01) return false;
    const probe = { def: PARTS[type], type, x: -x, y };
    const self = { def: PARTS[type], type, x, y };
    if (partsOverlap(probe, self)) return false;
    return !this.parts.some((o) => !ignore.includes(o) && partsOverlap(probe, o));
  },

  addPart(type, x, y) {
    if (!Career.unlocked(PARTS[type])) { UI.toast(`${PARTS[type].name} unlocks with ${TIERS[PARTS[type].tier].name}`); return; }
    const p = makePart(type, x, y, { flip: x < 0 });
    this.parts.push(p);
    if (this.symmetry && this.mirrorOk(type, x, y, [])) {
      const m = makePart(type, -x, y, { flip: -x < 0 });
      this.parts.push(m);
      p.mirror = m; m.mirror = p;
    }
    this.selected = p;
    this.changed();
    this.renderInfo();
    Sound.click();
  },

  deleteSelected() {
    const p = this.selected;
    if (!p) return;
    this.parts = this.parts.filter((q) => q !== p && q !== p.mirror);
    this.selected = null;
    this.changed();
    this.renderInfo();
  },

  duplicateSelected() {
    const p = this.selected;
    if (!p) return;
    const s = this.snap(p.type, { x: p.x, y: partRect(p).t + p.def.h / 2 }, []);
    if (!s.ok) { UI.toast('No room to duplicate it there'); return; }
    this.addPart(p.type, s.x, s.y);
  },

  // ---------------------------------------------------------------- palette & panels
  buildPalette() {
    const tabs = $('#palette-tabs');
    tabs.innerHTML = '';
    for (const c of PART_CATEGORIES) {
      const b = el('button', { class: 'tab', role: 'tab', 'aria-selected': String(c.id === this.category), text: c.name });
      b.addEventListener('click', () => { this.category = c.id; this.buildPalette(); });
      tabs.append(b);
    }
    const items = $('#palette-items');
    items.innerHTML = '';
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const type in PARTS) {
      const def = PARTS[type];
      if (def.cat !== this.category) continue;
      const locked = !Career.unlocked(def);
      const item = el('button', { class: 'part-item' + (locked ? ' locked' : ''), title: def.desc || def.name });
      item.append(renderPartIcon(type, 56, dpr));
      item.append(el('span', { class: 'part-name', text: def.name }));
      item.append(el('span', { class: 'part-spec', text: locked ? `Tier ${def.tier}` : this.specLine(def) }));
      if (!Career.sandbox && !locked) item.append(el('span', { class: 'part-cost', text: money(def.cost) }));
      if (locked) item.append(el('span', { class: 'lock', text: 'Locked' }));
      this.bindPaletteItem(item, type, locked);
      items.append(item);
    }
  },

  specLine(def) {
    if (def.thrust) return `${def.thrust} kN · ${def.ispVac}s`;
    if (def.fuel) return `${def.fuel} t fuel`;
    return `${def.mass} t`;
  },

  bindPaletteItem(item, type, locked) {
    let start = null;
    item.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId, drag: false }; });
    item.addEventListener('pointermove', (e) => {
      if (!start || start.id !== e.pointerId || locked) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.drag && ((dy < -8 && Math.abs(dy) > Math.abs(dx) * 0.8) || (!isTouch && Math.hypot(dx, dy) > 6))) {
        start.drag = true;
        item.setPointerCapture(e.pointerId);
        this.drag = { type, fromPalette: true, offset: { x: 0, y: 0 } };
        this.selected = null; this.renderInfo();
      }
      if (start.drag) this.dragTo(e.clientX, e.clientY);
    });
    const end = (e) => {
      if (!start || start.id !== e.pointerId) return;
      const wasDrag = start.drag;
      start = null;
      if (e.type === 'pointercancel') { this.drag = null; return; }
      if (locked) { this.showLocked(type); return; }
      if (wasDrag) this.dropDrag(e.clientY);
      else this.quickAdd(type);
    };
    item.addEventListener('pointerup', end);
    item.addEventListener('pointercancel', end);
  },

  showLocked(type) {
    const d = PARTS[type];
    UI.modal({
      kicker: `Tier ${d.tier} · ${TIERS[d.tier].name}`, title: d.name,
      body: `<p>${d.desc}</p><p class="muted">Unlock it in Research &amp; Development.</p>`,
      actions: [{ label: 'Close' }, { label: 'Open R&D', primary: true, onClick: () => App.showResearch() }],
    });
  },

  // Tap on a palette item: attach it somewhere sensible.
  quickAdd(type) {
    const area = this.viewArea();
    const centre = this.screenToWorld(area.cx, area.cy);
    const def = PARTS[type];
    let spot = null;
    if (this.parts.length) {
      const centred = this.parts.filter((p) => Math.abs(p.x) < 0.01);
      const sorted = centred.sort((a, b) => partRect(b).t - partRect(a).t);
      const topP = sorted[0], botP = sorted[sorted.length - 1];
      const tries = [];
      const top = topP && { x: 0, y: partRect(topP).t + def.h / 2 };
      const bottom = botP && { x: 0, y: partRect(botP).b - def.h / 2 };
      if (def.side || def.leg || def.fin || def.shape === 'rcs' || def.shape === 'girder') {
        for (const p of centred) tries.push({ x: p.def.w / 2 + def.w / 2, y: def.fin ? partRect(p).b + def.h / 2 : p.y });
      } else if (def.control || def.chute || def.aero) tries.push(top, bottom);
      else tries.push(bottom, top);
      for (const t of tries.filter(Boolean)) {
        const probe = { def, type, x: t.x, y: t.y };
        if (!this.parts.some((o) => partsOverlap(probe, o))) { spot = t; break; }
      }
    }
    if (!spot) { const s = this.snap(type, centre, []); spot = s.ok ? s : null; }
    if (!spot) { UI.toast('No room there. Drag the part into place instead.'); return; }
    this.addPart(type, spot.x, spot.y);
  },

  renderStats() {
    const s = this.statsData;
    const set = (id, t) => { $(id).textContent = t; };
    set('#s-name', this.name);
    set('#s-mass', fmt.mass(s.mass));
    set('#s-thrust', `${Math.round(s.thrust / 1000).toLocaleString('en-US')} kN`);
    set('#s-twr', s.thrust ? s.twr.toFixed(2) : '—');
    set('#s-dv', `${Math.round(s.dv).toLocaleString('en-US')} m/s`);
    set('#s-stages', String(this.stages.length));
    $('#s-twr').className = s.thrust && s.twr < 1 ? 'bad' : '';
    $('#career-row').hidden = Career.sandbox;
    if (!Career.sandbox) {
      set('#s-cost', money(s.cost));
      set('#s-funds', money(Career.data.funds));
      $('#s-cost').className = s.cost > Career.data.funds ? 'bad' : '';
    }
    const warn = [];
    if (!this.ctrl) warn.push('Add a Command Pod or Probe Core to fly.');
    else if (!s.thrust) warn.push('No engine fires in stage 1.');
    else if (s.twr < 1) warn.push('Too heavy to lift off: TWR below 1.');
    if (s.loose) warn.push(`${s.loose} part${s.loose > 1 ? 's' : ''} not attached. They stay behind.`);
    if (s.locked.length) warn.push(`Uses ${s.locked.length} locked part${s.locked.length > 1 ? 's' : ''}. Unlock them in R&D.`);
    else if (!Career.sandbox && s.cost > Career.data.funds) warn.push(`Costs ${money(s.cost - Career.data.funds)} more than you have.`);
    $('#s-warn').textContent = warn.join(' ');
    $('#s-warn').hidden = !warn.length;
    const list = $('#s-stage-list');
    list.innerHTML = '';
    const byId = new Map(this.parts.map((p) => [p.id, p]));
    this.stages.forEach((st, i) => {
      const dv = s.perStage[i] || 0, twr = s.stageTwr[i] || 0;
      list.append(el('li', null,
        el('span', { class: 'stage-badge', text: String(i + 1) }),
        el('span', { class: 'stage-desc', text: describeStage(st, byId) }),
        el('span', { class: 'stage-dv', text: dv > 0.5 ? `${Math.round(dv)} m/s${twr ? ` · ${twr.toFixed(1)}` : ''}` : '' })));
    });
    $('#btn-launch').disabled = !this.ctrl;
  },

  renderInfo() {
    const p = this.selected;
    const box = $('#part-info');
    if (!p) { box.hidden = true; return; }
    box.hidden = false;
    const d = p.def;
    $('#pi-name').textContent = d.name + (p.mirror ? ' ×2' : '');
    $('#pi-desc').textContent = d.desc || '';
    const specs = [`${d.mass} t`];
    if (d.fuel) specs.push(`${d.fuel} t ${d.solid ? 'solid fuel' : 'fuel'}`);
    if (d.thrust) specs.push(`${d.thrust} kN`, `Isp ${d.ispSL}–${d.ispVac} s`);
    if (d.torque) specs.push(`${d.torque / 1000} kN·m`);
    if (d.heatShield || d.maxTemp !== 2000) specs.push(`max ${d.maxTemp} K`);
    if (!Career.sandbox) specs.push(money(d.cost));
    $('#pi-specs').textContent = specs.join(' · ');
  },

  // ---------------------------------------------------------------- modals
  openHangar() {
    const wrap = el('div', { class: 'hangar' });
    const saves = store.get('rss.hangar', []);
    const nameIn = el('input', { id: 'hangar-name', type: 'text', maxlength: '40', value: this.name, 'aria-label': 'Rocket name' });
    const saveBtn = el('button', { class: 'btn primary small', text: 'Save' });
    saveBtn.addEventListener('click', () => {
      const name = nameIn.value.trim() || 'Rocket';
      this.name = name;
      const list = store.get('rss.hangar', []).filter((x) => x.name !== name);
      list.unshift({ ...this.serialize(), name, savedAt: Date.now() });
      store.set('rss.hangar', list.slice(0, 40));
      this.save(); this.renderStats();
      UI.closeModal(); UI.toast(`Saved “${name}”`);
    });
    wrap.append(el('div', { class: 'hangar-save' }, nameIn, saveBtn));
    if (saves.length) {
      wrap.append(el('h3', { class: 'summary-h', text: 'Your rockets' }));
      const list = el('div', { class: 'template-list' });
      for (const s of saves) {
        const cost = designCost(s.parts.filter((q) => PARTS[q.type]));
        const row = el('div', { class: 'template row' },
          el('button', { class: 'template-main' }, el('span', { class: 'template-name', text: s.name }),
            el('span', { class: 'template-blurb', text: `${s.parts.length} parts${Career.sandbox ? '' : ' · ' + money(cost)}` })));
        const del = el('button', { class: 'btn icon-only small danger', 'aria-label': `Delete ${s.name}` });
        del.append(icon('trash'));
        row.querySelector('.template-main').addEventListener('click', () => { UI.closeModal(); this.loadDesign(s); });
        del.addEventListener('click', () => {
          store.set('rss.hangar', store.get('rss.hangar', []).filter((x) => x.name !== s.name));
          row.remove();
        });
        row.append(del);
        list.append(row);
      }
      wrap.append(list);
    }
    wrap.append(el('h3', { class: 'summary-h', text: 'Example rockets' }));
    const tl = el('div', { class: 'template-list' });
    for (const key in TEMPLATES) {
      const t = TEMPLATES[key];
      const locked = !Career.sandbox && t.tier > Career.data.tier;
      const b = el('button', { class: 'template' + (locked ? ' locked' : '') },
        el('span', { class: 'template-name', text: t.name + (locked ? ` · Tier ${t.tier}` : '') }),
        el('span', { class: 'template-blurb', text: t.blurb }));
      b.addEventListener('click', () => { UI.closeModal(); this.loadTemplate(key); });
      tl.append(b);
    }
    wrap.append(tl);
    UI.modal({ kicker: 'Hangar', title: 'Rockets', body: wrap, actions: [{ label: 'Close' }] });
  },

  // ---------------------------------------------------------------- input
  bindDom() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (App.scene !== 'build') return;
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (this.pointers.size === 2) {
        if (this.drag && !this.drag.fromPalette) this.cancelDrag();
        this.pan = null;
        this.pinch = this.pinchInfo();
        return;
      }
      const w = this.screenToWorld(e.clientX, e.clientY);
      const hit = this.hitPart(w);
      if (hit && e.button !== 2 && e.button !== 1) {
        this.drag = { part: hit, type: hit.type, offset: { x: w.x - hit.x, y: w.y - hit.y }, orig: { x: hit.x, y: hit.y }, moved: false, pointerId: e.pointerId };
        if (hit.mirror) this.drag.mirrorOrig = { x: hit.mirror.x, y: hit.mirror.y };
        this.selected = hit;
        this.renderInfo();
      } else {
        this.pan = { pointerId: e.pointerId };
        this.panMoved = false;
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (App.scene !== 'build') return;
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (!isTouch) { const h = this.hitPart(this.screenToWorld(e.clientX, e.clientY)); c.style.cursor = h ? 'grab' : 'default'; }
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 2 && this.pinch) {
        const now = this.pinchInfo();
        this.zoomAt(now.d / this.pinch.d, now.cx, now.cy);
        this.cam.x -= (now.cx - this.pinch.cx) / this.cam.scale;
        this.cam.y += (now.cy - this.pinch.cy) / this.cam.scale;
        this.pinch = now;
        return;
      }
      if (this.drag && !this.drag.fromPalette && this.drag.pointerId === e.pointerId) {
        if (!this.drag.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6) return;
        this.drag.moved = true;
        this.dragTo(e.clientX, e.clientY);
      } else if (this.pan && this.pan.pointerId === e.pointerId) {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 4) this.panMoved = true;
        this.cam.x -= dx / this.cam.scale;
        this.cam.y += dy / this.cam.scale;
      }
    });
    const up = (e) => {
      if (App.scene !== 'build') return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.drag && !this.drag.fromPalette && this.drag.pointerId === e.pointerId) {
        if (e.type === 'pointercancel') this.cancelDrag();
        else if (this.drag.moved) this.dropDrag(e.clientY);
        else this.drag = null;
      }
      if (this.pan && this.pan.pointerId === e.pointerId) {
        if (!this.panMoved && e.type !== 'pointercancel') { this.selected = null; this.renderInfo(); }
        this.pan = null;
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      if (App.scene !== 'build') return;
      e.preventDefault();
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    addEventListener('keydown', (e) => {
      if (App.scene !== 'build' || UI.modalOpen || e.target.tagName === 'INPUT') return;
      const mod = e.ctrlKey || e.metaKey;
      if ((e.code === 'Delete' || e.code === 'Backspace') && this.selected) { e.preventDefault(); this.deleteSelected(); }
      else if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); }
      else if (mod && e.code === 'KeyY') { e.preventDefault(); this.redo(); }
      else if (mod && e.code === 'KeyD') { e.preventDefault(); this.duplicateSelected(); }
      else if (e.code === 'Enter' && this.ctrl) App.launch();
      else if (e.code === 'KeyF') this.fitView();
    });

    $('#btn-launch').addEventListener('click', () => App.launch());
    $('#btn-delete').addEventListener('click', () => this.deleteSelected());
    $('#btn-dup').addEventListener('click', () => this.duplicateSelected());
    $('#btn-fit').addEventListener('click', () => this.fitView());
    $('#btn-undo').addEventListener('click', () => this.undo());
    $('#btn-redo').addEventListener('click', () => this.redo());
    const sym = $('#btn-sym');
    sym.setAttribute('aria-pressed', String(this.symmetry));
    sym.addEventListener('click', () => {
      this.symmetry = !this.symmetry;
      store.set('rss.symmetry', this.symmetry);
      sym.setAttribute('aria-pressed', String(this.symmetry));
    });
    $('#btn-clear').addEventListener('click', () => {
      UI.modal({
        title: 'Clear the rocket?', body: 'Every part on the blueprint will be removed. You can undo this.',
        actions: [{ label: 'Cancel' }, { label: 'Clear', danger: true, primary: true, onClick: () => { this.parts = []; this.selected = null; this.changed(); this.renderInfo(); } }],
      });
    });
    $('#btn-templates').addEventListener('click', () => this.openHangar());
    $('#btn-rd').addEventListener('click', () => App.showResearch());
    $('#btn-missions').addEventListener('click', () => App.showMissions());
  },

  pinchInfo() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  },
  zoomAt(f, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    this.cam.scale = clamp(this.cam.scale * f, 3, 90);
    const after = this.screenToWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
  },

  dragTo(cx, cy) {
    const d = this.drag;
    const w = this.screenToWorld(cx, cy);
    const want = { x: w.x - d.offset.x, y: w.y - d.offset.y };
    if (d.fromPalette && isTouch) want.y += 40 / this.cam.scale; // keep it visible above the finger
    const ignore = d.part ? [d.part, d.part.mirror].filter(Boolean) : [];
    const s = this.snap(d.type, want, ignore);
    d.ghost = s;
    if (d.part) {
      d.part.x = s.x; d.part.y = s.y;
      if (d.part.mirror && this.mirrorOk(d.type, s.x, s.y, ignore)) { d.part.mirror.x = -s.x; d.part.mirror.y = s.y; }
    }
  },

  dropDrag(clientY) {
    const d = this.drag;
    this.drag = null;
    if (!d || !d.ghost) return;
    const overPalette = clientY > $('#palette').getBoundingClientRect().top;
    if (d.fromPalette) {
      if (overPalette || !d.ghost.ok) return;
      this.addPart(d.type, d.ghost.x, d.ghost.y);
      return;
    }
    const p = d.part;
    if (overPalette) { this.selected = p; this.deleteSelected(); return; }
    if (!d.ghost.ok) { this.cancelDrag(d); this.changed(); return; }
    p.flip = p.x < 0;
    if (p.mirror) {
      const m = p.mirror;
      if (this.mirrorOk(p.type, p.x, p.y, [p, m])) { m.x = -p.x; m.y = p.y; m.flip = m.x < 0; }
      else { if (d.mirrorOrig) { m.x = d.mirrorOrig.x; m.y = d.mirrorOrig.y; } p.mirror = null; m.mirror = null; }
    } else if (this.symmetry && this.mirrorOk(p.type, p.x, p.y, [p])) {
      const m = makePart(p.type, -p.x, p.y, { flip: -p.x < 0 });
      this.parts.push(m); p.mirror = m; m.mirror = p;
    }
    this.changed();
    this.renderInfo();
  },

  cancelDrag(dd) {
    const d = dd || this.drag;
    if (d && d.part) {
      d.part.x = d.orig.x; d.part.y = d.orig.y;
      if (d.part.mirror && d.mirrorOrig) { d.part.mirror.x = d.mirrorOrig.x; d.part.mirror.y = d.mirrorOrig.y; }
    }
    this.drag = null;
  },

  // ---------------------------------------------------------------- render
  render(ctx, W, H, dpr) {
    const S = this.cam.scale * dpr;
    const Wd = W * dpr, Hd = H * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, Hd);
    g.addColorStop(0, '#0b1c33'); g.addColorStop(1, '#071222');
    ctx.fillStyle = g; ctx.fillRect(0, 0, Wd, Hd);
    const X = (x) => Wd / 2 + (x - this.cam.x) * S, Y = (y) => Hd / 2 - (y - this.cam.y) * S;
    const x0 = this.cam.x - Wd / 2 / S, x1 = this.cam.x + Wd / 2 / S;
    const y0 = this.cam.y - Hd / 2 / S, y1 = this.cam.y + Hd / 2 / S;
    const minor = this.cam.scale > 14 ? 0.5 : 1;
    ctx.lineWidth = 1;
    for (const [stepv, col] of [[minor, 'rgba(120,170,230,0.07)'], [2, 'rgba(120,170,230,0.14)']]) {
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let x = Math.floor(x0 / stepv) * stepv; x <= x1; x += stepv) { const sx = Math.round(X(x)) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, Hd); }
      for (let y = Math.floor(y0 / stepv) * stepv; y <= y1; y += stepv) { const sy = Math.round(Y(y)) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(Wd, sy); }
      ctx.stroke();
    }
    // ruler on the left edge, in metres
    ctx.fillStyle = 'rgba(150,185,230,0.45)';
    ctx.font = `500 ${9 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'left';
    for (let y = Math.ceil(y0 / 2) * 2; y <= y1; y += 2) if (this.cam.scale > 8) ctx.fillText(`${y} m`, 4 * dpr, Y(y) - 3 * dpr);
    ctx.strokeStyle = this.symmetry ? 'rgba(255,181,71,0.35)' : 'rgba(120,170,230,0.25)';
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), Hd); ctx.stroke();
    ctx.setLineDash([]);

    ctx.setTransform(S, 0, 0, -S, Wd / 2 - this.cam.x * S, Hd / 2 + this.cam.y * S);
    const lw = 1.2 / this.cam.scale;
    const drawList = (filter) => {
      for (const p of this.parts) {
        if (!filter(p)) continue;
        const loose = !this.attached.has(p.id);
        ctx.globalAlpha = loose ? 0.4 : 1;
        drawPart(ctx, p, lw);
        if (!Career.unlocked(p.def)) {
          ctx.globalAlpha = 0.45; partPath(ctx, p); ctx.fillStyle = '#ff5d5d'; ctx.fill(); ctx.globalAlpha = 1;
        }
      }
    };
    drawList((p) => p.def.leg || p.def.fin || p.def.wheel);
    drawList((p) => !p.def.leg && !p.def.fin && !p.def.wheel);
    ctx.globalAlpha = 1;
    if (this.selected) {
      for (const p of [this.selected, this.selected.mirror]) {
        if (!p) continue;
        const r = partRect(p);
        ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2 / this.cam.scale;
        ctx.setLineDash([0.25, 0.15]);
        ctx.strokeRect(r.l - 0.08, r.b - 0.08, r.r - r.l + 0.16, r.t - r.b + 0.16);
        ctx.setLineDash([]);
      }
    }
    const d = this.drag;
    if (d && d.fromPalette && d.ghost) {
      const gp = { def: PARTS[d.type], type: d.type, x: d.ghost.x, y: d.ghost.y, flip: d.ghost.x < 0, deployed: 0 };
      ctx.globalAlpha = 0.75;
      drawPart(ctx, gp, lw);
      if (this.symmetry && this.mirrorOk(d.type, gp.x, gp.y, [])) { ctx.globalAlpha = 0.35; drawPart(ctx, { ...gp, x: -gp.x, flip: !gp.flip }, lw); }
      ctx.globalAlpha = 1;
    }
    if (d && d.ghost && !d.ghost.ok) {
      const def = PARTS[d.type];
      ctx.fillStyle = 'rgba(255,93,93,0.35)';
      ctx.fillRect(d.ghost.x - def.w / 2, d.ghost.y - def.h / 2, def.w, def.h);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // centre of mass and thrust markers
    if (this.com) {
      const cx = X(this.com.x), cy = Y(this.com.y), r = 9 * dpr;
      ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#14181f';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, Math.PI, Math.PI * 1.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#14181f'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
    }
    if (this.cot) {
      const cx = X(this.cot.x), cy = Y(this.cot.y) + 14 * dpr;
      ctx.fillStyle = '#c38cff';
      ctx.beginPath(); ctx.moveTo(cx, cy - 10 * dpr); ctx.lineTo(cx + 7 * dpr, cy + 6 * dpr); ctx.lineTo(cx, cy + 2 * dpr); ctx.lineTo(cx - 7 * dpr, cy + 6 * dpr); ctx.closePath(); ctx.fill();
    }
    // stage badges
    ctx.font = `600 ${10 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of this.parts) {
      const st = this.stageOf.get(p.id);
      if (!st) continue;
      const r = partRect(p);
      const sx = X(p.x < -0.01 ? r.l : r.r) + (p.x < -0.01 ? -10 : 10) * dpr, sy = Y(p.y);
      ctx.fillStyle = 'rgba(5,9,18,0.85)';
      ctx.beginPath(); ctx.arc(sx, sy, 8 * dpr, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1 * dpr; ctx.stroke();
      ctx.fillStyle = '#ffb547';
      ctx.fillText(String(st), sx, sy + 0.5 * dpr);
    }
    ctx.textBaseline = 'alphabetic';
  },
};
