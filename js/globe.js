'use strict';
// The globe: the map view for finding your way around a planet. The planet turns under a camera that looks
// straight down with north up (real north on the real Earth); drag to turn it, pinch or scroll to zoom. On
// top: where you've been, where you're heading (or the orbit you're on), cities, countries, seas, the space
// centre and a grid of latitude and longitude. The solar-system map is a tap away (MapView).

const GlobeView = {
  mode: 'globe', // or 'system' (MapView)
  body: null,
  dir: { x: 1, y: 0, z: 0 }, // from the planet's centre to the camera (unit, body-relative sim axes)
  up: { x: 0, y: 0, z: -1 },
  alt: 60000, // camera height above the surface (m)
  follow: true,
  trail: null, // { v, body, pts: [x, y, z, ...] } the active craft's track
  infoAt: 0,

  // Globe when near a planet, the solar system when out between them.
  open(F) {
    const v = F.active, b = v.body, R = b.radius, alt = v.radius() - R;
    this.mode = b.star || alt > R * 6 ? 'system' : 'globe';
    this.body = b;
    this.follow = true;
    const r = Math.hypot(v.x, v.y, v.z) || 1;
    this.dir = { x: v.x / r, y: v.y / r, z: v.z / r };
    const o = F.prediction && F.prediction[0] && F.prediction[0].o;
    const orbiting = o && !o.degenerate && o.e < 1 && o.rp > R + (b.atmoHeight || 0) * 0.5;
    this.alt = orbiting ? clamp(o.ra - R, R * 1.2, R * 5) : alt > 20000 ? clamp(alt * 4, R * 0.3, R * 3) : 90000 * (R / 315000) ** 0.5;
    this.alt = clamp(this.alt, 1500, R * 6);
    this.up = this.northAt(this.dir) || { x: 0, y: 0, z: -1 };
  },
  setMode(m, F) {
    if (m === 'system') { this.mode = 'system'; MapView.fit(F); } else { this.open(F); this.mode = 'globe'; }
  },
  get active() { return this.mode === 'globe'; },

  // North on the map at a point (unit vector, body-relative): real north on the real Earth, else the sim's (-z).
  northAt(d) {
    let n;
    if (this.body === EARTH && EARTH.mapped) {
      const g = Terrain.toGeo(Math.atan2(d.y, d.x), Math.asin(clamp(d.z, -1, 1))), lon = g.lon, lat = g.lat;
      if (Math.abs(lat) > 1.5) return null;
      const s = Terrain.toSim(lon, lat + 0.002);
      const cp = Math.cos(s.phi);
      n = { x: cp * Math.cos(s.a) - d.x, y: cp * Math.sin(s.a) - d.y, z: Math.sin(s.phi) - d.z };
    } else n = { x: 0, y: 0, z: -1 };
    const k = n.x * d.x + n.y * d.y + n.z * d.z;
    n.x -= k * d.x; n.y -= k * d.y; n.z -= k * d.z;
    const l = Math.hypot(n.x, n.y, n.z);
    return l > 1e-6 ? { x: n.x / l, y: n.y / l, z: n.z / l } : null;
  },

  update(F, dt) {
    const v = F.active;
    if (!v || !v.parts.length) return;
    if (v.body !== this.body) { const m = this.mode; this.open(F); this.mode = m; } // a new sphere of influence: same view, new planet
    // the track: a point every 0.4 s of game time, or every 2 km
    let tr = this.trail;
    if (!tr || tr.v !== v || tr.body !== v.body) tr = this.trail = { v, body: v.body, pts: [], t: -Infinity };
    const p = tr.pts, n = p.length;
    if (!v.landed || n === 0) {
      const far = n ? Math.hypot(v.x - p[n - 3], v.y - p[n - 2], v.z - p[n - 1]) : Infinity;
      if (far > 5 && (F.time - tr.t > 0.4 || far > 2000)) {
        p.push(v.x, v.y, v.z); tr.t = F.time;
        if (p.length > 9000) tr.pts = p.filter((_, i) => Math.floor(i / 3) % 2 === 0 || i >= p.length - 300); // thin the oldest half
      }
    }
    if (this.follow) {
      const r = Math.hypot(v.x, v.y, v.z) || 1, k = 1 - Math.exp(-dt * 6), d = this.dir;
      d.x += (v.x / r - d.x) * k; d.y += (v.y / r - d.y) * k; d.z += (v.z / r - d.z) * k;
      const l = Math.hypot(d.x, d.y, d.z); d.x /= l; d.y /= l; d.z /= l;
    }
    const n2 = this.northAt(this.dir);
    if (n2) this.up = n2;
  },

  drag(dx, dy) {
    this.follow = false;
    const R = this.body.radius, k = Math.min(0.02, (this.alt * 2 * Math.tan((50 * Math.PI) / 360)) / (innerHeight * R));
    // screen right is forward x up, and forward is -d: (-d) x u = u x d
    const d = this.dir, u = this.up, r = { x: u.y * d.z - u.z * d.y, y: u.z * d.x - u.x * d.z, z: u.x * d.y - u.y * d.x };
    d.x += -r.x * dx * k + u.x * dy * k; d.y += -r.y * dx * k + u.y * dy * k; d.z += -r.z * dx * k + u.z * dy * k;
    const l = Math.hypot(d.x, d.y, d.z); d.x /= l; d.y /= l; d.z /= l;
    const n = this.northAt(d);
    if (n) this.up = n;
  },
  zoom(f) { if (this.body) this.alt = clamp(this.alt / f, 1500, this.body.radius * 6); },
  center() { this.follow = true; },

  // ---------------------------------------------------------------- drawing
  render(ctx, W, H, dpr, F, dt) {
    const v = F.active, b = this.body || v.body, R = b.radius;
    this.update(F, dt);
    const d = this.dir, D = R + this.alt, cam = { x: d.x * D, y: d.y * D, z: d.z * D };
    if (!Render3D.renderGlobe({ body: b, cam, up: this.up, alt: this.alt }, dt)) return false;
    // projection, matching the 3D camera (vertical FOV 50°, looking at the centre, `up` up)
    const T = Math.tan((50 * Math.PI) / 360), f = { x: -d.x, y: -d.y, z: -d.z }, u = this.up;
    const rt = { x: f.y * u.z - f.z * u.y, y: f.z * u.x - f.x * u.z, z: f.x * u.y - f.y * u.x };
    const Wd = W * dpr, Hd = H * dpr, kp = Hd / 2 / T, R2 = (R * 0.9995) ** 2, CC = D * D;
    const P = { x: 0, y: 0, ok: false };
    const proj = (x, y, z) => { // screen point, and whether the planet hides it
      const px = x - cam.x, py = y - cam.y, pz = z - cam.z, zz = px * f.x + py * f.y + pz * f.z;
      P.ok = false;
      if (zz <= 1) return P;
      P.x = Wd / 2 + ((px * rt.x + py * rt.y + pz * rt.z) / zz) * kp;
      P.y = Hd / 2 - ((px * u.x + py * u.y + pz * u.z) / zz) * kp;
      const a = px * px + py * py + pz * pz, bb = 2 * (cam.x * px + cam.y * py + cam.z * pz), disc = bb * bb - 4 * a * (CC - R2);
      if (disc > 0) { const t = (-bb - Math.sqrt(disc)) / (2 * a); if (t > 0 && t < 0.999) return P; }
      P.ok = true;
      return P;
    };
    const onScreen = (m = 0) => P.ok && P.x > -m && P.x < Wd + m && P.y > -m && P.y < Hd + m;
    const font = (w, px, fam = '"Chakra Petch", system-ui, sans-serif') => `${w} ${px * dpr}px ${fam}`;
    const mapped = b === EARTH && EARTH.mapped;
    const sim = {};
    const surf = (lon, lat) => { // real degrees -> sim unit vector (times R)
      if (mapped) { Terrain.toSim(lon / Terrain.DEG, lat / Terrain.DEG, sim); } else { sim.a = -lon / Terrain.DEG + (b.padAngle || 0); sim.phi = -lat / Terrain.DEG; }
      const cp = Math.cos(sim.phi);
      return [R * cp * Math.cos(sim.a), R * cp * Math.sin(sim.a), R * Math.sin(sim.phi)];
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, Wd, Hd);
    ctx.lineJoin = ctx.lineCap = 'round';

    // ---- atmosphere glow around the limb
    const ang = Math.asin(Math.min(1, R / D)), limb = Math.tan(ang) * kp;
    if (limb < Math.hypot(Wd, Hd)) {
      const g = ctx.createRadialGradient(Wd / 2, Hd / 2, limb * 0.985, Wd / 2, Hd / 2, limb * 1.09);
      const hc = b.colors.halo || '120,150,200';
      g.addColorStop(0, `rgba(${hc},0.55)`); g.addColorStop(1, `rgba(${hc},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(Wd / 2, Hd / 2, limb * 1.09, 0, TAU); ctx.arc(Wd / 2, Hd / 2, limb * 0.985, 0, TAU, true); ctx.fill();
    }

    // ---- polylines over the globe, broken where the planet hides them
    const line = (pts, color, width, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.setLineDash(dash ? dash.map((q) => q * dpr) : []);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < pts.length; i += 3) {
        proj(pts[i], pts[i + 1], pts[i + 2]);
        if (!P.ok) { pen = false; continue; }
        if (pen) ctx.lineTo(P.x, P.y); else ctx.moveTo(P.x, P.y);
        pen = true;
      }
      ctx.stroke(); ctx.setLineDash([]);
    };
    // ---- latitude and longitude, finer as you zoom in
    const step = this.alt > R * 0.9 ? 30 : this.alt > R * 0.25 ? 10 : this.alt > R * 0.06 ? 5 : 1;
    if (!this.grid || this.grid.b !== b || this.grid.step !== step) {
      const ls = [], k = Math.min(step, 2);
      for (let lat = -90 + step; lat < 90; lat += step) { const p = []; for (let lon = -180; lon <= 180; lon += k) p.push(...surf(lon, lat)); ls.push([p, lat === 0]); }
      for (let lon = -180; lon < 180; lon += step) { const p = []; for (let lat = -88; lat <= 88; lat += k) p.push(...surf(lon, lat)); ls.push([p, lon === 0]); }
      this.grid = { b, step, ls };
    }
    for (const [p, main] of this.grid.ls) line(p, main ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.13)', main ? 1.1 : 0.8);

    const labels = [];
    const free = (x, y, w, h) => { // keep labels from piling up
      for (const q of labels) if (x < q[0] + q[2] && x + w > q[0] && y < q[1] + q[3] && y + h > q[1]) return false;
      labels.push([x, y, w, h]);
      return true;
    };
    const text = (s, x, y, color, f, align = 'left', shadow = true) => {
      ctx.font = f; ctx.textAlign = align;
      if (shadow) { ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(4,8,16,0.75)'; ctx.strokeText(s, x, y); }
      ctx.fillStyle = color; ctx.fillText(s, x, y);
    };

    // ---- the craft: its track behind, and where it is going
    const vr = Math.hypot(v.x, v.y, v.z), vAlt = vr - R, grounded = v.landed || v.splashed;
    const toGround = (x, y, z) => { const r = Math.hypot(x, y, z) || 1; return [(x / r) * R, (y / r) * R, (z / r) * R]; };
    const orbital = v.kind === 'rocket' || vAlt > 25000 || v.speed() > 1500;
    const tr = this.trail && this.trail.v === v ? this.trail.pts : [];
    if (tr.length > 3) {
      const g = [];
      for (let i = 0; i < tr.length; i += 3) g.push(...(orbital ? [tr[i], tr[i + 1], tr[i + 2]] : toGround(tr[i], tr[i + 1], tr[i + 2])));
      g.push(...(orbital ? [v.x, v.y, v.z] : toGround(v.x, v.y, v.z)));
      line(g, 'rgba(255,255,255,0.55)', 1.6);
    }
    const ahead = [];
    if (orbital && F.prediction && !grounded) {
      F.prediction.forEach((patch, i) => {
        if (patch.body !== b || patch.o.degenerate) return;
        const pts = this.patch3D(patch);
        line(pts, PATCH_COLORS[Math.min(i, PATCH_COLORS.length - 1)], i ? 1.6 : 2.2);
        if (patch.end === 'impact') { const s = stateAt(patch.o, patch.tEnd - patch.t0); ahead.push({ p: [s.x, s.y, s.z], text: 'Impact', color: '#ff5d5d', cross: true }); }
      });
    } else if (v.kind !== 'rocket') {
      // a great circle along the ground track, with a tick for each minute at this speed
      const n = { x: v.x / vr, y: v.y / vr, z: v.z / vr }, vv = { x: v.vx, y: v.vy, z: v.vz };
      const k = vv.x * n.x + vv.y * n.y + vv.z * n.z;
      let t = { x: vv.x - k * n.x, y: vv.y - k * n.y, z: vv.z - k * n.z };
      let gs = Math.hypot(t.x, t.y, t.z);
      if (gs < 3) { // slow or stopped: the way the nose points
        const h = v.heading(), F2 = surfaceFrame(v.x, v.y, v.z);
        t = { x: Math.sin(h) * F2.east.x - Math.cos(h) * F2.north.x, y: Math.sin(h) * F2.east.y - Math.cos(h) * F2.north.y, z: Math.sin(h) * F2.east.z - Math.cos(h) * F2.north.z };
        gs = 0;
      }
      const tl = Math.hypot(t.x, t.y, t.z) || 1; t.x /= tl; t.y /= tl; t.z /= tl;
      const span = Math.max(gs * 900, this.alt * 0.8), pts = [];
      for (let i = 0; i <= 80; i++) {
        const s = (span * i) / 80 / R, c = Math.cos(s), sn = Math.sin(s);
        pts.push(R * (c * n.x + sn * t.x), R * (c * n.y + sn * t.y), R * (c * n.z + sn * t.z));
      }
      line(pts, 'rgba(255,181,71,0.9)', 2, [7, 6]);
      if (gs > 5) for (let m = 1; m * 60 * gs < span; m++) {
        const s = (m * 60 * gs) / R, c = Math.cos(s), sn = Math.sin(s);
        ahead.push({ p: [R * (c * n.x + sn * t.x), R * (c * n.y + sn * t.y), R * (c * n.z + sn * t.z)], text: m % 5 === 0 || m === 1 ? `${m} min` : '', color: '#ffb547', tick: true });
      }
    }

    // ---- places
    if (mapped) {
      const EM = Terrain.earthMap;
      // the space centre and the causeway to Shetland
      if (this.alt < R * 1.5) {
        const pts = [];
        for (let e = -300; e <= EARTH.causeway.shore + 300; e += 400) { const a = siteAngle(EARTH, e); pts.push(R * Math.cos(a), R * Math.sin(a), 0); }
        line(pts, 'rgba(255,181,71,0.75)', 1.4);
      }
      const pa = EARTH.padAngle;
      proj(R * Math.cos(pa), R * Math.sin(pa), 0);
      if (onScreen(20)) {
        ctx.fillStyle = '#ffb547'; ctx.strokeStyle = '#04060c'; ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.moveTo(P.x, P.y - 6 * dpr); ctx.lineTo(P.x + 6 * dpr, P.y); ctx.lineTo(P.x, P.y + 6 * dpr); ctx.lineTo(P.x - 6 * dpr, P.y); ctx.closePath(); ctx.fill(); ctx.stroke();
        text('SPACE CENTRE', P.x + 10 * dpr, P.y + 4 * dpr, '#ffb547', font(700, 11));
        labels.push([P.x - 8 * dpr, P.y - 12 * dpr, 120 * dpr, 22 * dpr]);
      }
      // countries and seas, biggest first, while they're large enough to mean something
      if (!this.regions && EM.country) this.regions = this.regionCentres(EM);
      if (this.regions && this.alt > 40000) {
        const pxPerM = kp / Math.max(this.alt, 1), placedR = [];
        for (const r of this.regions) {
          const sizePx = Math.sqrt(r.area) * pxPerM;
          if (sizePx < (r.sea ? 140 : 70) * dpr || sizePx > Wd * 3) continue;
          proj(...(r.p || (r.p = surf(r.lon, r.lat))));
          if (!onScreen(-20 * dpr)) continue;
          const name = r.sea ? r.name : r.name.toUpperCase();
          ctx.font = r.sea ? font('italic 500', 12) : font(600, 11);
          const w = ctx.measureText(name).width + (r.sea ? 0 : name.length * 1.5 * dpr);
          if (!free(P.x - w / 2, P.y - 10 * dpr, w, 14 * dpr)) continue;
          if (r.sea) text(name, P.x, P.y, 'rgba(160,205,240,0.85)', font('italic 500', 12), 'center', false);
          else { ctx.letterSpacing = `${1.5 * dpr}px`; text(name, P.x, P.y, 'rgba(240,236,224,0.82)', font(600, 11), 'center'); ctx.letterSpacing = '0px'; }
          if (placedR.push(r) > 24) break;
        }
      }
      // cities, biggest first: the first few dozen that fit on screen
      if (!this.cities && EM.cities.length) this.cities = EM.cities.map((c) => ({ c, p: null })).sort((x, y) => y.c[2] - x.c[2]);
      if (this.cities) {
        let shown = 0;
        for (const ci of this.cities) {
          const c = ci.c;
          proj(...(ci.p || (ci.p = surf(c[3], c[4]))));
          if (!onScreen()) continue;
          ctx.font = font(c[2] > 1e6 ? 600 : 500, c[2] > 1e6 ? 12 : 11);
          const w = ctx.measureText(c[0]).width;
          if (!free(P.x - 4 * dpr, P.y - 8 * dpr, w + 12 * dpr, 14 * dpr)) continue;
          ctx.fillStyle = c[5] ? '#ffffff' : 'rgba(235,240,248,0.9)';
          ctx.beginPath(); ctx.arc(P.x, P.y, (c[5] ? 3 : 2.2) * dpr, 0, TAU); ctx.fill();
          if (c[5]) { ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.arc(P.x, P.y, 5 * dpr, 0, TAU); ctx.stroke(); }
          text(c[0], P.x + 7 * dpr, P.y + 4 * dpr, 'rgba(240,244,250,0.95)', ctx.font);
          if (++shown >= clamp(Math.round(limb / (14 * dpr)), 8, 36)) break;
        }
      }
    }
    // ---- markers ahead (minute ticks, impact)
    for (const m of ahead) {
      proj(...m.p);
      if (!onScreen()) continue;
      ctx.fillStyle = m.color; ctx.strokeStyle = m.color;
      if (m.cross) {
        ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(P.x - 5 * dpr, P.y - 5 * dpr); ctx.lineTo(P.x + 5 * dpr, P.y + 5 * dpr); ctx.moveTo(P.x + 5 * dpr, P.y - 5 * dpr); ctx.lineTo(P.x - 5 * dpr, P.y + 5 * dpr); ctx.stroke();
      } else { ctx.beginPath(); ctx.arc(P.x, P.y, 2.6 * dpr, 0, TAU); ctx.fill(); }
      if (m.text && free(P.x + 5 * dpr, P.y - 16 * dpr, (m.text.length * 7 + 4) * dpr, 14 * dpr)) text(m.text, P.x + 7 * dpr, P.y - 5 * dpr, m.color, font(500, 11, '"IBM Plex Mono", ui-monospace, monospace'));
    }

    // ---- the craft itself: an arrow along its track
    const here = orbital && vAlt > R * 0.01 ? [v.x, v.y, v.z] : toGround(v.x, v.y, v.z);
    proj(...here);
    if (P.ok) {
      const x0 = P.x, y0 = P.y;
      const sp = Math.hypot(v.vx, v.vy, v.vz), dl = Math.max(50, this.alt * 0.02);
      let ex, ey;
      if (sp > 3) proj(here[0] + (v.vx / sp) * dl, here[1] + (v.vy / sp) * dl, here[2] + (v.vz / sp) * dl);
      else { const h = v.heading(), F2 = surfaceFrame(v.x, v.y, v.z); proj(here[0] + (Math.sin(h) * F2.east.x - Math.cos(h) * F2.north.x) * dl, here[1] + (Math.sin(h) * F2.east.y - Math.cos(h) * F2.north.y) * dl, here[2] + (Math.sin(h) * F2.east.z - Math.cos(h) * F2.north.z) * dl); }
      ex = P.x - x0; ey = P.y - y0;
      const rot = Math.atan2(ex, -ey);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.3 * pulse})`; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(x0, y0, (13 + 4 * pulse) * dpr, 0, TAU); ctx.stroke();
      ctx.save(); ctx.translate(x0, y0); ctx.rotate(rot);
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#04060c'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(0, -10 * dpr); ctx.lineTo(7 * dpr, 8 * dpr); ctx.lineTo(0, 4 * dpr); ctx.lineTo(-7 * dpr, 8 * dpr); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // other craft
    for (const o of F.vessels) {
      if (o === v || o.body !== b || !o.control) continue;
      proj(...toGround(o.x, o.y, o.z));
      if (!onScreen()) continue;
      const col = o.ai ? '#ff5d5d' : '#62d0ff'; // enemy fighters in red
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(P.x, P.y, 3.5 * dpr, 0, TAU); ctx.fill();
      text(o.name, P.x + 7 * dpr, P.y + 4 * dpr, col, font(500, 10, '"IBM Plex Mono", ui-monospace, monospace'));
    }
    // ---- scale bar
    const mpp = (this.alt * 2 * T) / Hd, raw = mpp * 110 * dpr, pow = 10 ** Math.floor(Math.log10(raw)), nice = [1, 2, 5, 10].map((q) => q * pow).filter((q) => q <= raw).pop() || pow, bw = nice / mpp;
    const bx = Wd - bw - 18 * dpr, by = Hd - 128 * dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(bx, by - 5 * dpr); ctx.lineTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by - 5 * dpr); ctx.stroke();
    text(fmt.dist(nice), bx + bw / 2, by - 8 * dpr, 'rgba(255,255,255,0.9)', font(500, 11, '"IBM Plex Mono", ui-monospace, monospace'), 'center');
    this.updateInfo(F);
    return true;
  },

  // An orbit patch in 3D, relative to its body.
  patch3D(patch) {
    const o = patch.o, pts = [];
    let nuB;
    if (patch.end) { nuB = stateAt(o, patch.tEnd - patch.t0).nu; if (o.e < 1) while (nuB <= o.nu0) nuB += TAU; }
    else if (o.e < 1) nuB = o.nu0 + TAU;
    else { nuB = o.nuMax * 0.985; const lim = nuAtRadius(o, Math.min(patch.body.soi, patch.body.radius * 400)); if (lim != null) nuB = Math.min(nuB, lim); }
    if (!(nuB > o.nu0)) return pts;
    for (let i = 0; i <= 360; i++) { const s = stateFromNu(o, o.nu0 + ((nuB - o.nu0) * i) / 360); pts.push(s.x, s.y, s.z); }
    return pts;
  },

  // Middles of countries and seas, and how big they are (m²), from the region raster: once.
  regionCentres(EM) {
    const n = EM.regions.length, sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n), area = new Float64Array(n);
    const RW = EM.RW, RH = EM.RH, R = EARTH.radius, cell = (TAU / RW) * R;
    for (let y = 0; y < RH; y++) {
      const lat = Math.PI / 2 - ((y + 0.5) / RH) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat), ca = cell * cell * cl;
      for (let x = 0; x < RW; x++) {
        const i = y * RW + x, c = EM.country[i], s = EM.sea[i], k = c ? c - 1 : s ? EM.nCountries + s - 1 : -1;
        if (k < 0) continue;
        const lon = ((x + 0.5) / RW) * TAU - Math.PI;
        sx[k] += cl * Math.cos(lon); sy[k] += cl * Math.sin(lon); sz[k] += sl; area[k] += ca;
      }
    }
    const out = [];
    for (let k = 0; k < n; k++) {
      if (!area[k]) continue;
      const l = Math.hypot(sx[k], sy[k], sz[k]);
      out.push({ name: EM.regions[k], sea: k >= EM.nCountries, area: area[k], lon: Math.atan2(sy[k], sx[k]) * Terrain.DEG, lat: Math.asin(sz[k] / l) * Terrain.DEG });
    }
    return out.sort((a, b) => b.area - a.area);
  },

  // The strip under the map: where you are, and the way home.
  updateInfo(F) {
    const now = performance.now();
    if (now - this.infoAt < 250) return;
    this.infoAt = now;
    const v = F.active, b = v.body, r = v.radius(), a = Math.atan2(v.y, v.x), phi = Math.asin(clamp(v.z / r, -1, 1));
    const deg = (x, p, n) => `${Math.abs(x).toFixed(2)}°${x >= 0 ? p : n}`;
    let lat, lon;
    if (b === EARTH && EARTH.mapped) { const g = Terrain.toGeo(a, phi); lat = g.lat * Terrain.DEG; lon = g.lon * Terrain.DEG; } else { lat = -phi * Terrain.DEG; lon = -wrapAngle(a - (b.padAngle || 0)) * Terrain.DEG; }
    const parts = [`${deg(lat, 'N', 'S')} ${deg(lon, 'E', 'W')}`];
    if (b === EARTH) {
      // the way home: great-circle distance and bearing to the pad
      const pa = EARTH.padAngle, c = { x: Math.cos(pa), y: Math.sin(pa), z: 0 }, u = { x: v.x / r, y: v.y / r, z: v.z / r };
      const ang = Math.acos(clamp(c.x * u.x + c.y * u.y + c.z * u.z, -1, 1)), dist = ang * b.radius;
      if (dist > 60) {
        const Fr = surfaceFrame(v.x, v.y, v.z), w = { x: c.x - u.x, y: c.y - u.y, z: c.z - u.z };
        const e = w.x * Fr.east.x + w.y * Fr.east.y + w.z * Fr.east.z, nn = -(w.x * Fr.north.x + w.y * Fr.north.y + w.z * Fr.north.z);
        const brg = EARTH.mapped ? Terrain.bearingAt(a, phi, e, nn) : ((Math.atan2(e, nn) * Terrain.DEG) % 360 + 360) % 360;
        parts.push(`Space Centre ${fmt.dist(dist)} · ${String(Math.round(brg) % 360).padStart(3, '0')}° ${COMPASS[Math.round(brg / 22.5) % 16]}`);
      } else parts.push('At the Space Centre');
    }
    const el2 = $('#globe-info');
    if (el2) el2.textContent = parts.join(' · ');
  },
};
