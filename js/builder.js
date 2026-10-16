'use strict';
// Build screen: drag parts from the palette onto a blueprint grid.

const TEMPLATES = {
  hopper: {
    name: 'Hopper', blurb: 'A suborbital hop. Fly up, separate, open the parachute.',
    parts: [['hawk', 0, 1], ['tankM', 0, 3], ['separator', 0, 4.25], ['pod', 0, 5.5], ['chute', 0, 6.75]],
  },
  orbiter: {
    name: 'Orbiter', blurb: 'Two stages, enough to circle Earth and come home.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankL', 0, 8], ['separator', 0, 10.25], ['valiant', 0, 11.25],
      ['tankM', 0, 13], ['pod', 0, 15], ['chute', 0, 16.25]],
  },
  lunar: {
    name: 'Lunar Lander', blurb: 'Boosters, a transfer stage and a lander with legs. Moon and back.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankL', 0, 8], ['separator', 0, 10.25], ['valiant', 0, 11.25],
      ['tankL', 0, 14], ['separator', 0, 16.25], ['valiant', 0, 17.25], ['tankM', 0, 19], ['pod', 0, 21], ['chute', 0, 22.25],
      ['leg', 1.25, 17.5], ['leg', -1.25, 17.5],
      ['sideSep', 1.25, 5], ['tankL', 2.5, 4], ['hawk', 2.5, 1], ['nose', 2.5, 6.75],
      ['sideSep', -1.25, 5], ['tankL', -2.5, 4], ['hawk', -2.5, 1], ['nose', -2.5, 6.75]],
  },
  probe: {
    name: 'Moon Probe', blurb: 'A light probe on an orbiter booster. Crash it into the Moon, or land it gently.',
    parts: [['hawk', 0, 1], ['tankL', 0, 4], ['tankM', 0, 7], ['separator', 0, 8.25], ['valiant', 0, 9.25],
      ['tankM', 0, 11], ['separator', 0, 12.25], ['kolibri', 0, 13], ['tankThin', 0, 14.5], ['probe', 0, 16],
      ['leg', 0.75, 14], ['leg', -0.75, 14]],
  },
};

const Builder = {
  init(canvas) {
    this.canvas = canvas;
    this.parts = [];
    this.selected = null;
    this.cam = { x: 0, y: 8, scale: 26 };
    this.pointers = new Map();
    this.symmetry = store.get('orbitforge.symmetry', true);
    this.category = 'command';
    this.buildPalette();
    this.bindDom();
    const saved = store.get('orbitforge.design', null);
    if (saved && saved.parts && saved.parts.length) this.loadDesign(saved);
    else this.loadTemplate('orbiter');
  },

  // ---------------------------------------------------------------- design io
  serialize() {
    return { parts: this.parts.map((p) => ({ type: p.type, x: +p.x.toFixed(3), y: +p.y.toFixed(3), flip: p.flip })) };
  },
  save() { store.set('orbitforge.design', this.serialize()); },
  loadDesign(d) {
    this.parts = d.parts.filter((q) => PARTS[q.type]).map((q) => makePart(q.type, q.x, q.y, { flip: !!q.flip }));
    this.linkMirrors();
    this.selected = null;
    this.changed(true);
    this.fitView();
  },
  loadTemplate(key) {
    const t = TEMPLATES[key];
    this.loadDesign({ parts: t.parts.map(([type, x, y]) => ({ type, x, y, flip: x < 0 })) });
  },
  linkMirrors() {
    for (const p of this.parts) p.mirror = null;
    for (const p of this.parts) {
      if (p.mirror || Math.abs(p.x) < 0.01) continue;
      const m = this.parts.find((q) => q !== p && !q.mirror && q.type === p.type && Math.abs(q.x + p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01);
      if (m) { p.mirror = m; m.mirror = p; }
    }
  },

  changed(skipSave) {
    this.adj = buildAdjacency(this.parts);
    this.ctrl = findControlPart(this.parts);
    this.attached = this.ctrl ? componentOf(this.ctrl.id, this.adj) : new Set();
    const ps = this.parts.filter((p) => this.attached.has(p.id));
    const adj = new Map();
    for (const p of ps) adj.set(p.id, new Set([...this.adj.get(p.id)].filter((id) => this.attached.has(id))));
    this.stages = this.ctrl ? computeStages(ps, adj, this.ctrl.id) : [];
    this.stageOf = new Map();
    this.stages.forEach((st, i) => st.forEach((id) => this.stageOf.set(id, i + 1)));
    const dv = this.ctrl ? estimateDeltaV(ps, adj, this.ctrl.id, this.stages, false) : { total: 0, perStage: [] };
    let mass = 0, thrust = 0;
    for (const p of ps) mass += p.def.mass * 1000 + p.fuel;
    const first = new Set(this.stages[0] || []);
    for (const p of ps) if (first.has(p.id) && p.def.thrust) thrust += p.def.thrust * 1000;
    this.statsData = { mass, thrust, twr: thrust / (mass * EARTH.surfaceG || 1), dv: dv.total, perStage: dv.perStage, loose: this.parts.length - ps.length };
    this.renderStats();
    if (!skipSave) this.save();
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
    this.cam.scale = clamp(scale, 6, 60);
    this.cam.x = (l + r) / 2 - (area.cx - innerWidth / 2) / this.cam.scale;
    this.cam.y = (b + t) / 2 + (area.cy - innerHeight / 2) / this.cam.scale;
  },
  viewArea() {
    // free canvas area between the top bar and the palette (and beside the stats panel on wide screens)
    const top = $('#build-top').getBoundingClientRect().bottom;
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
      // align tops / bottoms when side-mounting
      consider(R.r + w / 2, R.t - h / 2); consider(R.l - w / 2, R.t - h / 2);
      consider(R.r + w / 2, R.b + h / 2); consider(R.l - w / 2, R.b + h / 2);
      // stack in line with neighbours offset sideways
      if (Math.abs(want.x - o.x) < w) { consider(g(want.x), R.t + h / 2); consider(g(want.x), R.b - h / 2); }
    }
    if (best) return { ...best, attached: true, ok: true };
    const gx = g(want.x), gy = g(want.y);
    return { x: gx, y: gy, attached: false, ok: free(gx, gy) };
  },

  // Mirror placement for symmetry mode.
  mirrorOk(type, x, y, ignore) {
    if (Math.abs(x) < 0.01) return false;
    const probe = { def: PARTS[type], type, x: -x, y };
    const self = { def: PARTS[type], type, x, y };
    if (partsOverlap(probe, self)) return false;
    return !this.parts.some((o) => !ignore.includes(o) && partsOverlap(probe, o));
  },

  addPart(type, x, y) {
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
  },

  deleteSelected() {
    const p = this.selected;
    if (!p) return;
    this.parts = this.parts.filter((q) => q !== p && q !== p.mirror);
    this.selected = null;
    this.changed();
    this.renderInfo();
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
      const item = el('button', { class: 'part-item', title: def.desc || def.name });
      item.append(renderPartIcon(type, 56, dpr));
      item.append(el('span', { class: 'part-name', text: def.name }));
      item.append(el('span', { class: 'part-spec', text: this.specLine(def) }));
      this.bindPaletteItem(item, type);
      items.append(item);
    }
  },

  specLine(def) {
    if (def.thrust) return `${def.thrust} kN · ${def.ispVac}s`;
    if (def.fuel) return `${def.fuel} t fuel`;
    if (def.control) return `${def.mass} t`;
    return `${def.mass} t`;
  },

  bindPaletteItem(item, type) {
    let start = null;
    item.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, drag: false };
    });
    item.addEventListener('pointermove', (e) => {
      if (!start || start.id !== e.pointerId) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.drag && (dy < -8 && Math.abs(dy) > Math.abs(dx) * 0.8 || (!isTouch && Math.hypot(dx, dy) > 6))) {
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
      if (wasDrag) this.dropDrag(e.clientY);
      else this.quickAdd(type);
    };
    item.addEventListener('pointerup', end);
    item.addEventListener('pointercancel', end);
  },

  // Tap on a palette item: attach it somewhere sensible near the middle of the view.
  quickAdd(type) {
    const area = this.viewArea();
    const centre = this.screenToWorld(area.cx, area.cy);
    const def = PARTS[type];
    let spot = null;
    if (this.parts.length) {
      // prefer stacking on top of the highest centred part, or under the lowest
      const centred = this.parts.filter((p) => Math.abs(p.x) < 0.01);
      const sorted = centred.sort((a, b) => partRect(b).t - partRect(a).t);
      const topP = sorted[0], botP = sorted[sorted.length - 1];
      const tries = [];
      const top = topP && { x: 0, y: partRect(topP).t + def.h / 2 };
      const bottom = botP && { x: 0, y: partRect(botP).b - def.h / 2 };
      if (def.side || def.leg) {
        for (const p of centred) tries.push({ x: p.def.w / 2 + def.w / 2, y: p.y });
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
    set('#s-mass', fmt.mass(s.mass));
    set('#s-thrust', `${Math.round(s.thrust / 1000).toLocaleString('en-US')} kN`);
    set('#s-twr', s.thrust ? s.twr.toFixed(2) : '—');
    set('#s-dv', `${Math.round(s.dv).toLocaleString('en-US')} m/s`);
    set('#s-stages', String(this.stages.length));
    $('#s-twr').className = s.thrust && s.twr < 1 ? 'bad' : '';
    const warn = [];
    if (!this.ctrl) warn.push('Add a Command Pod or Probe Core to fly.');
    else if (!s.thrust) warn.push('No engine fires in stage 1.');
    else if (s.twr < 1) warn.push('Too heavy to lift off: TWR below 1.');
    if (s.loose) warn.push(`${s.loose} part${s.loose > 1 ? 's' : ''} not attached. They stay behind.`);
    $('#s-warn').textContent = warn.join(' ');
    $('#s-warn').hidden = !warn.length;
    // stage breakdown
    const list = $('#s-stage-list');
    list.innerHTML = '';
    const byId = new Map(this.parts.map((p) => [p.id, p]));
    this.stages.forEach((st, i) => {
      const dv = s.perStage[i] || 0;
      list.append(el('li', null,
        el('span', { class: 'stage-badge', text: String(i + 1) }),
        el('span', { class: 'stage-desc', text: describeStage(st, byId) }),
        el('span', { class: 'stage-dv', text: dv > 0.5 ? `${Math.round(dv)} m/s` : '' })));
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
    const specs = [`Mass ${d.mass} t`];
    if (d.fuel) specs.push(`Fuel ${d.fuel} t`);
    if (d.thrust) specs.push(`Thrust ${d.thrust} kN`, `Isp ${d.ispSL}–${d.ispVac} s`);
    if (d.torque) specs.push(`Torque ${d.torque / 1000} kN·m`);
    $('#pi-specs').textContent = specs.join(' · ');
  },

  // ---------------------------------------------------------------- input
  bindDom() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (App.scene !== 'build') return;
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      if (this.pointers.size === 2) {
        // second finger: cancel any part drag and start pinch
        if (this.drag && !this.drag.fromPalette) this.cancelDrag();
        this.pinch = this.pinchInfo();
        return;
      }
      const w = this.screenToWorld(e.clientX, e.clientY);
      const hit = this.hitPart(w);
      if (hit && e.button !== 2 && e.button !== 1) {
        this.drag = { part: hit, type: hit.type, offset: { x: w.x - hit.x, y: w.y - hit.y }, orig: { x: hit.x, y: hit.y }, moved: false, pointerId: e.pointerId };
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
        // hover
        if (!isTouch) { const w = this.screenToWorld(e.clientX, e.clientY); const h = this.hitPart(w); c.style.cursor = h ? 'grab' : 'default'; }
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
      if (App.scene !== 'build' || UI.modalOpen) return;
      if ((e.code === 'Delete' || e.code === 'Backspace') && this.selected) { e.preventDefault(); this.deleteSelected(); }
      if (e.code === 'Enter' && this.ctrl) App.launch();
      if (e.code === 'KeyF') this.fitView();
    });

    $('#btn-launch').addEventListener('click', () => App.launch());
    $('#btn-delete').addEventListener('click', () => this.deleteSelected());
    $('#btn-fit').addEventListener('click', () => this.fitView());
    const sym = $('#btn-sym');
    sym.setAttribute('aria-pressed', String(this.symmetry));
    sym.addEventListener('click', () => {
      this.symmetry = !this.symmetry;
      store.set('orbitforge.symmetry', this.symmetry);
      sym.setAttribute('aria-pressed', String(this.symmetry));
    });
    $('#btn-clear').addEventListener('click', () => {
      UI.modal({
        title: 'Clear the rocket?', body: 'Every part on the blueprint will be removed.',
        actions: [{ label: 'Cancel' }, { label: 'Clear', danger: true, primary: true, onClick: () => { this.parts = []; this.selected = null; this.changed(); this.renderInfo(); } }],
      });
    });
    $('#btn-templates').addEventListener('click', () => this.openTemplates());
    $('#btn-help').addEventListener('click', () => App.showHelp());
  },

  openTemplates() {
    const list = el('div', { class: 'template-list' });
    for (const key in TEMPLATES) {
      const t = TEMPLATES[key];
      const b = el('button', { class: 'template' },
        el('span', { class: 'template-name', text: t.name }),
        el('span', { class: 'template-blurb', text: t.blurb }));
      b.addEventListener('click', () => { UI.closeModal(); this.loadTemplate(key); });
      list.append(b);
    }
    UI.modal({ kicker: 'Hangar', title: 'Load a rocket', body: list, actions: [{ label: 'Cancel' }] });
  },

  pinchInfo() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  },
  zoomAt(f, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    this.cam.scale = clamp(this.cam.scale * f, 4, 90);
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
    d.screenY = cy;
    if (d.part) { d.part.x = s.x; d.part.y = s.y; }
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
    if (!d.ghost.ok) { p.x = d.orig.x; p.y = d.orig.y; this.changed(); return; }
    p.flip = p.x < 0;
    // keep the symmetric partner in step
    if (p.mirror) {
      const m = p.mirror;
      if (this.mirrorOk(p.type, p.x, p.y, [p, m])) { m.x = -p.x; m.y = p.y; m.flip = m.x < 0; }
      else { p.mirror = null; m.mirror = null; }
    } else if (this.symmetry && this.mirrorOk(p.type, p.x, p.y, [p])) {
      const m = makePart(p.type, -p.x, p.y, { flip: -p.x < 0 });
      this.parts.push(m); p.mirror = m; m.mirror = p;
    }
    this.changed();
    this.renderInfo();
  },

  cancelDrag() {
    const d = this.drag;
    if (d && d.part) { d.part.x = d.orig.x; d.part.y = d.orig.y; }
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
    // grid
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
    // centreline
    ctx.strokeStyle = this.symmetry ? 'rgba(255,181,71,0.35)' : 'rgba(120,170,230,0.25)';
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), Hd); ctx.stroke();
    ctx.setLineDash([]);

    // parts
    ctx.setTransform(S, 0, 0, -S, Wd / 2 - this.cam.x * S, Hd / 2 + this.cam.y * S);
    const lw = 1.2 / this.cam.scale;
    const drawList = (filter) => {
      for (const p of this.parts) {
        if (!filter(p)) continue;
        const loose = !this.attached.has(p.id);
        ctx.globalAlpha = loose ? 0.4 : 1;
        drawPart(ctx, p, lw);
      }
    };
    drawList((p) => p.def.leg);
    drawList((p) => !p.def.leg);
    ctx.globalAlpha = 1;
    // selection
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
    // palette ghost
    const d = this.drag;
    if (d && d.fromPalette && d.ghost) {
      const gp = { def: PARTS[d.type], type: d.type, x: d.ghost.x, y: d.ghost.y, flip: d.ghost.x < 0, deployed: 0 };
      ctx.globalAlpha = 0.75;
      drawPart(ctx, gp, lw);
      if (this.symmetry && this.mirrorOk(d.type, gp.x, gp.y, [])) {
        ctx.globalAlpha = 0.35;
        drawPart(ctx, { ...gp, x: -gp.x, flip: !gp.flip }, lw);
      }
      ctx.globalAlpha = 1;
    }
    if (d && d.ghost && !d.ghost.ok) {
      const def = PARTS[d.type];
      ctx.fillStyle = 'rgba(255,93,93,0.35)';
      ctx.fillRect(d.ghost.x - def.w / 2, d.ghost.y - def.h / 2, def.w, def.h);
    }
    // stage badges
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
