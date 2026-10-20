'use strict';
// Map view: the whole solar system, predicted trajectories, targets and other vessels.

const PATCH_COLORS = ['#ffb547', '#62d0ff', '#b48cff', '#7dffb0'];

const MapView = {
  scale: 0.0005,
  offset: { x: 0, y: 0 },
  focus: null, // null = active vessel, otherwise a body

  center(F) {
    if (this.focus) { const p = bodyPos(this.focus, F.time); return { x: p.x + this.offset.x, y: p.y + this.offset.y }; }
    const p = F.absPos(F.active);
    return { x: p.x + this.offset.x, y: p.y + this.offset.y };
  },

  fit(F) {
    const v = F.active, b = v.body;
    const o = F.prediction && F.prediction[0] && F.prediction[0].o;
    let r = b.radius * 2.6;
    if (o && !o.degenerate && o.e < 1) r = Math.max(r, Math.min(o.ra, b.soi) * 1.15);
    else if (o && o.e >= 1) r = Math.max(r, isFinite(b.soi) ? b.soi * 1.1 : 3e8);
    if (b.star) r = Math.max(r, Math.hypot(v.x, v.y) * 1.3);
    this.scale = (Math.min(innerWidth, innerHeight) * 0.46) / r;
    this.focus = b.star ? null : b;
    this.offset = { x: 0, y: 0 };
    if (b.star) this.focus = SUN;
  },

  focusBody(b, F) {
    this.focus = b;
    this.offset = { x: 0, y: 0 };
    const kidR = b.children.length ? Math.max(...b.children.map((c) => c.orbitRadius + c.soi)) : 0;
    const r = b.star ? MARS.orbitRadius * 1.15 : Math.max(b.radius * 3, Math.min(kidR * 1.1 || b.radius * 6, b.soi));
    this.scale = (Math.min(innerWidth, innerHeight) * 0.46) / r;
  },
  focusVessel() { this.focus = null; this.offset = { x: 0, y: 0 }; },

  zoom(f, cx, cy) {
    const W = innerWidth, H = innerHeight;
    const before = this.scale;
    this.scale = clamp(this.scale * f, 2e-10, 0.5);
    const k = 1 / before - 1 / this.scale;
    this.offset.x += (cx - W / 2) * k;
    this.offset.y -= (cy - H / 2) * k;
  },
  pan(dx, dy) { this.offset.x -= dx / this.scale; this.offset.y += dy / this.scale; },

  // What is under a tap (CSS pixels)?
  hit(F, sx, sy) {
    const c = this.center(F), S = this.scale;
    const X = (x) => innerWidth / 2 + (x - c.x) * S, Y = (y) => innerHeight / 2 - (y - c.y) * S;
    let best = null, bd = 22;
    for (const v of F.vessels) {
      if (!v.control || v === F.active || v.remote) continue;
      const p = F.absPos(v);
      const d = Math.hypot(X(p.x) - sx, Y(p.y) - sy);
      if (d < bd) { bd = d; best = { vessel: v }; }
    }
    for (const b of BODIES) {
      const p = bodyPos(b, F.time);
      const d = Math.hypot(X(p.x) - sx, Y(p.y) - sy) - Math.max(b.radius * S, 0);
      if (d < bd) { bd = d; best = { body: b }; }
    }
    return best;
  },

  drawBackdrop(ctx, Wd, Hd, dpr, c, S) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04060c'; ctx.fillRect(0, 0, Wd, Hd);
    World.drawStars(ctx, Wd, Hd, 0.45, 0, 0);
    ctx.strokeStyle = 'rgba(98,208,255,0.045)'; ctx.lineWidth = 1;
    const step = Math.pow(10, Math.floor(Math.log10((200 * dpr) / S)));
    const X = (x) => Wd / 2 + (x - c.x) * S, Y = (y) => Hd / 2 - (y - c.y) * S;
    const gx0 = Math.floor((c.x - Wd / 2 / S) / step) * step, gy0 = Math.floor((c.y - Hd / 2 / S) / step) * step;
    ctx.beginPath();
    for (let x = gx0, i = 0; x < c.x + Wd / 2 / S && i < 200; x += step, i++) { ctx.moveTo(X(x), 0); ctx.lineTo(X(x), Hd); }
    for (let y = gy0, i = 0; y < c.y + Hd / 2 / S && i < 200; y += step, i++) { ctx.moveTo(0, Y(y)); ctx.lineTo(Wd, Y(y)); }
    ctx.stroke();
    return { X, Y };
  },

  drawSystem(ctx, Wd, Hd, dpr, time, c, S, opts = {}) {
    const { X, Y } = this.drawBackdrop(ctx, Wd, Hd, dpr, c, S);
    const font = (w, px) => `${w} ${px * dpr}px "Chakra Petch", system-ui, sans-serif`;
    // orbits and spheres of influence
    for (const b of BODIES) {
      if (!b.parent) continue;
      const pp = bodyPos(b.parent, time);
      const rr = b.orbitRadius * S;
      if (rr < 4 * dpr || rr > 4e6) continue;
      const hl = opts.target === b;
      ctx.strokeStyle = hl ? 'rgba(232,120,255,0.55)' : 'rgba(160,175,200,0.22)';
      ctx.lineWidth = (hl ? 1.6 : 1) * dpr;
      ctx.beginPath(); ctx.arc(X(pp.x), Y(pp.y), rr, 0, TAU); ctx.stroke();
      const p = bodyPos(b, time), sr = b.soi * S;
      if (sr > 14 * dpr && sr < 4e6) {
        ctx.setLineDash([4 * dpr, 6 * dpr]);
        ctx.strokeStyle = hl ? 'rgba(232,120,255,0.5)' : 'rgba(160,175,200,0.28)';
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), sr, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // bodies
    for (const b of BODIES) {
      const p = bodyPos(b, time);
      const x = X(p.x), y = Y(p.y), r = b.radius * S;
      if (x < -r - 60 * dpr || x > Wd + r + 60 * dpr || y < -r - 60 * dpr || y > Hd + r + 60 * dpr) continue;
      const l = Math.hypot(p.x, p.y) || 1;
      if (r > 5 * dpr) paintBodyDisc(ctx, b, x, y, r, -p.x / l, p.y / l, true);
      else {
        ctx.fillStyle = b.colors.map;
        ctx.beginPath(); ctx.arc(x, y, Math.max(r, b.star ? 5 * dpr : 3 * dpr), 0, TAU); ctx.fill();
        if (b.star) { const g = ctx.createRadialGradient(x, y, 0, x, y, 18 * dpr); g.addColorStop(0, 'rgba(255,210,120,0.6)'); g.addColorStop(1, 'rgba(255,210,120,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 18 * dpr, 0, TAU); ctx.fill(); }
      }
      // label when it can be told apart from its parent
      const showLabel = !b.parent || b.orbitRadius * S > 26 * dpr || opts.target === b || opts.focus === b;
      if (showLabel) {
        ctx.fillStyle = opts.target === b ? '#e878ff' : 'rgba(220,228,240,0.85)';
        ctx.font = font(600, 11);
        ctx.textAlign = 'center';
        ctx.fillText(b.name.toUpperCase(), x, y + Math.max(r, 4 * dpr) + 14 * dpr);
      }
      if (opts.target === b) {
        ctx.strokeStyle = '#e878ff'; ctx.lineWidth = 1.5 * dpr;
        const rr = Math.max(r, 4 * dpr) + 6 * dpr;
        ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
      }
    }
    return { X, Y };
  },

  render(ctx, W, H, dpr, F) {
    const v = F.active;
    const S = this.scale * dpr;
    const c = this.center(F);
    const Wd = W * dpr, Hd = H * dpr;
    const { X, Y } = this.drawSystem(ctx, Wd, Hd, dpr, F.time, c, S, { target: F.target, focus: this.focus });

    const labels = [];
    const pred = F.prediction;
    if (pred && !v.landed) {
      pred.forEach((patch, i) => {
        const pts = this.patchPoints(patch, F);
        if (pts.length < 4) return;
        const color = PATCH_COLORS[Math.min(i, PATCH_COLORS.length - 1)];
        ctx.strokeStyle = color;
        ctx.lineWidth = (i === 0 ? 2 : 1.6) * dpr;
        ctx.beginPath();
        for (let k = 0; k < pts.length; k += 2) { const sx = X(pts[k]), sy = Y(pts[k + 1]); if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); }
        ctx.stroke();
        const o = patch.o, b = patch.body;
        if (o.degenerate) return;
        const origin = bodyPos(b, patch.t0);
        const within = (nu) => patch.tEnd === Infinity || timeToNu(o, nu) <= patch.tEnd - patch.t0;
        const name = b.star ? 'Sun' : '';
        const tiny = o.e < 1 && o.ra * S < 26 * dpr; // too small on screen for apsis labels
        if (!tiny && o.e > 0.002 && o.rp > b.radius * 0.2 && within(0)) {
          const s = stateFromNu(o, 0);
          labels.push({ x: origin.x + s.x, y: origin.y + s.y, text: `Pe ${fmt.dist(o.rp - b.radius)}${name ? ' · ' + name : ''}`, color });
        }
        if (!tiny && o.e < 1 && o.e > 0.002 && o.ra < b.soi && within(Math.PI)) {
          const s = stateFromNu(o, Math.PI);
          labels.push({ x: origin.x + s.x, y: origin.y + s.y, text: `Ap ${fmt.dist(o.ra - b.radius)}`, color });
        }
        if (patch.end === 'encounter') {
          const m = bodyPos(patch.next, patch.tEnd);
          ctx.strokeStyle = 'rgba(98,208,255,0.55)'; ctx.lineWidth = 1 * dpr;
          ctx.setLineDash([3 * dpr, 4 * dpr]);
          ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), Math.max(patch.next.radius * S, 4 * dpr), 0, TAU); ctx.stroke();
          ctx.setLineDash([]);
          labels.push({ x: m.x, y: m.y, text: `${patch.next.name} encounter`, color: '#62d0ff', dot: false, dy: -1 });
        }
        if (patch.end === 'impact') {
          const s = stateAt(o, patch.tEnd - patch.t0);
          labels.push({ x: origin.x + s.x, y: origin.y + s.y, text: 'Impact', color: '#ff5d5d', cross: true });
        }
      });
    }
    // closest approach to the target
    if (F.approach && F.approach.pos) {
      const a = F.approach;
      ctx.setLineDash([2 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(232,120,255,0.7)'; ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath(); ctx.moveTo(X(a.pos.x), Y(a.pos.y)); ctx.lineTo(X(a.tpos.x), Y(a.tpos.y)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(X(a.tpos.x), Y(a.tpos.y), Math.max(F.target.radius * S, 4 * dpr), 0, TAU); ctx.stroke();
      labels.push({ x: a.pos.x, y: a.pos.y, text: `Closest ${fmt.dist(a.dist)}`, color: '#e878ff' });
    }
    // other vessels
    for (const d of F.vessels) {
      if (d === v) continue;
      const mc = d.remote ? MP.mapColor(d) : '#62d0ff';
      if (!mc) continue; // an enemy player in a battle: not on the map
      const p = F.absPos(d);
      const sx = X(p.x), sy = Y(p.y);
      if (d.control) {
        ctx.fillStyle = mc;
        ctx.beginPath(); ctx.moveTo(sx, sy - 6 * dpr); ctx.lineTo(sx + 5 * dpr, sy + 4 * dpr); ctx.lineTo(sx - 5 * dpr, sy + 4 * dpr); ctx.closePath(); ctx.fill();
        ctx.font = `500 ${10 * dpr}px "IBM Plex Mono", ui-monospace, monospace`; ctx.textAlign = 'left';
        ctx.fillText(d.name, sx + 8 * dpr, sy + 4 * dpr);
      } else {
        ctx.fillStyle = 'rgba(180,190,205,0.5)';
        ctx.fillRect(sx - 1.5 * dpr, sy - 1.5 * dpr, 3 * dpr, 3 * dpr);
      }
    }
    // labels
    ctx.font = `500 ${11 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'left';
    const placed = [];
    for (const l of labels) {
      const sx = X(l.x);
      let sy = Y(l.y);
      // nudge labels that would sit on top of each other
      for (let k = 0; k < 6 && placed.some((p) => Math.abs(p.x - sx) < 90 * dpr && Math.abs(p.y - sy) < 13 * dpr); k++) sy += 14 * dpr;
      placed.push({ x: sx, y: sy });
      ctx.fillStyle = l.color;
      if (l.cross) {
        ctx.strokeStyle = l.color; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.moveTo(sx - 5 * dpr, sy - 5 * dpr); ctx.lineTo(sx + 5 * dpr, sy + 5 * dpr); ctx.moveTo(sx + 5 * dpr, sy - 5 * dpr); ctx.lineTo(sx - 5 * dpr, sy + 5 * dpr); ctx.stroke();
      } else if (l.dot !== false) { ctx.beginPath(); ctx.arc(sx, sy, 3.5 * dpr, 0, TAU); ctx.fill(); }
      ctx.fillText(l.text, sx + 8 * dpr, sy + (l.dy ? 18 : -6) * dpr);
    }
    // active vessel
    const vp = F.absPos(v);
    const sx = X(vp.x), sy = Y(vp.y);
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(-v.rot);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#04060c'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(0, -9 * dpr); ctx.lineTo(6 * dpr, 7 * dpr); ctx.lineTo(0, 4 * dpr); ctx.lineTo(-6 * dpr, 7 * dpr); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  },

  patchPoints(patch, F) {
    const o = patch.o, b = patch.body;
    const origin = bodyPos(b, patch.t0);
    const pts = [];
    if (o.degenerate) {
      const v = F.active;
      const s = { x: v.x, y: v.y, vx: v.vx, vy: v.vy };
      const r0 = Math.hypot(v.x, v.y);
      const tFall = (2 * Math.abs(v.vx * v.x + v.vy * v.y)) / r0 / (b.mu / (r0 * r0)) + 60;
      for (let i = 0; i <= 200; i++) {
        pts.push(origin.x + s.x, origin.y + s.y);
        gravityStep(s, b.mu, tFall / 200);
        if (Math.hypot(s.x, s.y) < b.radius) break;
      }
      return pts;
    }
    const nuA = o.nu0;
    let nuB;
    if (patch.end) {
      nuB = stateAt(o, patch.tEnd - patch.t0).nu;
      if (o.e < 1) { while (nuB <= nuA) nuB += TAU; }
    } else if (o.e < 1) nuB = nuA + TAU;
    else {
      nuB = o.nuMax * 0.985;
      const lim = nuAtRadius(o, b.star ? JUPITER.orbitRadius * 2.5 : Math.min(b.soi, b.radius * 400));
      if (lim != null) nuB = Math.min(nuB, lim);
    }
    if (nuB <= nuA) return pts;
    const n = 420;
    for (let i = 0; i <= n; i++) {
      const s = stateFromNu(o, nuA + ((nuB - nuA) * i) / n);
      pts.push(origin.x + s.x, origin.y + s.y);
    }
    return pts;
  },
};
