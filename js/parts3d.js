'use strict';
// 3D part models for the 3D view (three.js): hulls revolved or extruded from the 2D outlines and painted
// with the 2D artwork, dedicated models for aircraft and ground parts, engine plumes and parachute canopies.
// Loaded before three.js (which is lazy-loaded), so nothing here touches THREE until init().

const Parts3D = (() => {
  let THREE = null, aniso = 1, shared = null;
  const models = new Map(), textures = new Map();
  const PX_PER_M = 64;
  const CREASE = 0.45; // radians: sharper turns in a revolved outline get a hard edge

  // Material kinds. Every part instance gets its own materials, so heat glow and transparency are per part.
  const KINDS = {
    hull: { map: true, roughness: 0.5, metalness: 0.25 },
    metal: { map: true, roughness: 0.38, metalness: 0.62 },
    gold: { map: true, roughness: 0.3, metalness: 0.8 },
    shield: { map: true, roughness: 0.85, metalness: 0.05 },
    sep: { map: true, roughness: 0.55, metalness: 0.3 },
    vc: { vertexColors: true, roughness: 0.42, metalness: 0.2 },
    steel: { color: PAL.steel, roughness: 0.4, metalness: 0.7 },
    steelLight: { color: PAL.steelLight, roughness: 0.32, metalness: 0.7 },
    steelDark: { color: PAL.steelDark, roughness: 0.5, metalness: 0.55 },
    ink: { color: PAL.ink, roughness: 0.7, metalness: 0.2 },
    orange: { color: PAL.orange, roughness: 0.45, metalness: 0.1 },
    white: { color: '#eef1f4', roughness: 0.4, metalness: 0.1 },
    tyre: { color: '#1b1e22', roughness: 0.92, metalness: 0, env: 0.3 },
    nozzle: { color: '#15181c', roughness: 0.6, metalness: 0.5, double: true },
    intake: { color: '#15181c', roughness: 0.6, metalness: 0.5, double: true },
    dish: { color: PAL.steelLight, roughness: 0.3, metalness: 0.6, double: true },
    glass: { color: '#1d3a5c', roughness: 0.05, metalness: 0.2, opacity: 0.75, env: 1 },
    lamp: { basic: '#fff4d6' },
    tail: { basic: '#ff3b2f' },
  };
  const LATHE = new Set(['pod', 'probe', 'probeL', 'tank', 'fuselage', 'srb', 'sep', 'nose', 'adapter', 'tailcone', 'engine', 'spike', 'ion', 'shield', 'jet', 'cockpit',
    'jetnose', 'airnose', 'float', 'droptank']);
  const LATHE_KIND = { probe: 'gold', probeL: 'gold', engine: 'metal', spike: 'metal', ion: 'metal', shield: 'shield', sep: 'sep' };
  const RECIPE = { chute: 'chute', fin: 'extrude', vtail: 'vtail', leg: 'leg', rcs: 'rcs', girder: 'girder', chassis: 'chassis', cab: 'cab',
    wing: 'wing', elevator: 'wing', prop: 'prop', rotor: 'rotor', tailrotor: 'tailRotor', wheel: 'wheel', gear: 'gear', airbrake: 'airbrake' };
  const FLAT_DEPTH = { fin: 0.12 };
  const PLUMES = {
    kero: [[255, 214, 140], [255, 140, 40], [255, 70, 20]],
    solid: [[255, 240, 190], [255, 180, 70], [255, 110, 40]],
    hydro: [[235, 245, 255], [150, 190, 255], [90, 120, 255]],
    nuclear: [[230, 255, 250], [140, 230, 255], [80, 160, 255]],
    ion: [[200, 225, 255], [90, 150, 255], [60, 90, 255]],
    spike: [[255, 220, 150], [255, 150, 60], [255, 90, 30]],
    jet: [[255, 228, 196], [255, 160, 96], [150, 120, 255]],
  };

  // Symmetric airfoil (NACA 4-digit form), half thickness normalised to 1 at its maximum, 30% chord back.
  const foil = (f) => (0.2969 * Math.sqrt(f) - 0.126 * f - 0.3516 * f * f + 0.2843 * f ** 3 - 0.1036 * f ** 4) / 0.1;
  // Section samples [chord fraction from the leading edge, signed thickness]: an airfoil from the trailing
  // edge over the top to the leading edge and back underneath, and a closed ellipse for blades.
  const FOIL = [], ELLIPSE = [];
  for (let i = 12; i >= 0; i--) { const f = (1 - Math.cos((Math.PI * i) / 12)) / 2; FOIL.push([f, foil(f)]); }
  for (let i = 1; i <= 12; i++) { const f = (1 - Math.cos((Math.PI * i) / 12)) / 2; FOIL.push([f, -foil(f)]); }
  for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; ELLIPSE.push([(1 - Math.cos(a)) / 2, Math.sin(a)]); }

  const noop = () => {};
  const pow2 = (v) => Math.min(512, Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, v)))));
  const texSize = (d) => [pow2(d.w * PX_PER_M), pow2(d.h * PX_PER_M)];
  const dummy = (d, flip) => ({ def: d, type: d.type, x: 0, y: 0, flip: !!flip, deployed: 0, used: false, firing: 0, temp: AMBIENT_T, spin: 0, deflect: 0 });
  const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
  const dist = (a, c) => Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const rectPoly = (w, h) => [-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2];
  const v2 = (x, y) => new THREE.Vector2(x, y);

  function need() {
    if (!THREE) THREE = window.THREE || null;
    if (!THREE) throw new Error('Parts3D: three.js is not loaded');
  }

  // ------------------------------------------------------------------ outlines
  // A stand-in canvas context that records the path calls partPath() makes as polygons
  // [x0, y0, x1, y1, ...], flattening curves. Anything else it might call is a no-op.
  function recorder() {
    const polys = [], stack = [];
    let cur = null, has = false, sx = 0, sy = 0, cx = 0, cy = 0, m = [1, 0, 0, 1, 0, 0];
    const pt = (x, y) => { cur.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]); cx = x; cy = y; };
    const ensure = (x, y) => { if (!cur) c.moveTo(has ? cx : x, has ? cy : y); };
    const c = {
      polys,
      beginPath() { polys.length = 0; cur = null; has = false; },
      moveTo(x, y) { cur = []; polys.push(cur); pt(x, y); sx = x; sy = y; has = true; },
      lineTo(x, y) { if (!cur && !has) c.moveTo(x, y); else { ensure(x, y); pt(x, y); } },
      closePath() { if (cur) { cur = null; cx = sx; cy = sy; } },
      bezierCurveTo(x1, y1, x2, y2, x, y) {
        ensure(x1, y1);
        const x0 = cx, y0 = cy;
        for (let i = 1; i <= 16; i++) {
          const t = i / 16, u = 1 - t;
          pt(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y);
        }
      },
      quadraticCurveTo(x1, y1, x, y) {
        ensure(x1, y1);
        const x0 = cx, y0 = cy;
        for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; pt(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y); }
      },
      arc(x, y, r, a0, a1, ccw) { c.ellipse(x, y, r, r, 0, a0, a1, ccw); },
      ellipse(x, y, rx, ry, rot, a0, a1, ccw) {
        let s = a1 - a0;
        if (!ccw) s = s >= TAU ? TAU : ((s % TAU) + TAU) % TAU;
        else s = -s >= TAU ? -TAU : -((((a0 - a1) % TAU) + TAU) % TAU);
        const n = Math.max(2, Math.ceil(Math.abs(s) / (TAU / 48))), cr = Math.cos(rot), sr = Math.sin(rot);
        for (let i = 0; i <= n; i++) {
          const a = a0 + (s * i) / n, ex = rx * Math.cos(a), ey = ry * Math.sin(a);
          c.lineTo(x + ex * cr - ey * sr, y + ex * sr + ey * cr);
        }
      },
      rect(x, y, w, h) { c.moveTo(x, y); pt(x + w, y); pt(x + w, y + h); pt(x, y + h); c.closePath(); },
      roundRect(x, y, w, h) { c.rect(x, y, w, h); },
      save() { stack.push(m.slice()); },
      restore() { if (stack.length) m = stack.pop(); },
      translate(x, y) { m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; },
      rotate(a) {
        const co = Math.cos(a), si = Math.sin(a), [a0, b0, c0, d0] = m;
        m[0] = a0 * co + c0 * si; m[1] = b0 * co + d0 * si; m[2] = c0 * co - a0 * si; m[3] = d0 * co - b0 * si;
      },
      scale(x, y) { m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; },
    };
    return new Proxy(c, { get: (o, k) => (k in o ? o[k] : noop) });
  }

  // 3D silhouettes for the aircraft and ground shapes follow the spec geometry rather than partPath, so a
  // canopy bubble in a 2D outline never gets revolved into the hull. Coordinates are relative to the centre.
  const PROFILE = {
    probeL(c, w, h) { c.rect(-w / 2, -h / 2, w, h * 0.75); },
    ion(c, w, h) {
      const y = -h / 2 + h * 0.3;
      c.rect(-w * 0.4, y, w * 0.8, h * 0.7);
      c.moveTo(-w * 0.4, y); c.ellipse(0, y, w * 0.4, h * 0.3, 0, Math.PI, TAU); c.closePath();
    },
    cockpit(c, w, h) { // nose at +y, canopy (added separately) on the -x side
      const b = -h / 2, t = h / 2;
      c.moveTo(-w / 2, b); c.lineTo(w / 2, b); c.lineTo(w / 2, b + h * 0.28);
      c.bezierCurveTo(w / 2, b + h * 0.72, w * 0.26, t, w * 0.12, t);
      c.lineTo(0, t);
      c.bezierCurveTo(-w * 0.3, t, -w / 2, b + h * 0.88, -w / 2, b + h * 0.6);
      c.closePath();
    },
    tailcone(c, w, h, d) { // the -x edge stays straight; the +x edge sweeps up to it
      const b = -h / 2, t = h / 2, bw = d.botW || w * 0.35;
      c.moveTo(-w / 2, b); c.lineTo(-w / 2 + bw, b);
      c.bezierCurveTo(-w / 2 + bw + w * 0.12, b + h * 0.4, w / 2, t - h * 0.5, w / 2, t);
      c.lineTo(-w / 2, t); c.closePath();
    },
    jet(c, w, h) {
      const b = -h / 2, t = h / 2;
      c.moveTo(-w * 0.3, b); c.lineTo(w * 0.3, b);
      c.bezierCurveTo(w * 0.4, b + h * 0.22, w / 2, b + h * 0.4, w / 2, b + h * 0.62);
      c.bezierCurveTo(w / 2, t - h * 0.1, w * 0.47, t, w * 0.43, t);
      c.lineTo(-w * 0.43, t);
      c.bezierCurveTo(-w * 0.47, t, -w / 2, t - h * 0.1, -w / 2, b + h * 0.62);
      c.bezierCurveTo(-w / 2, b + h * 0.4, -w * 0.4, b + h * 0.22, -w * 0.3, b);
      c.closePath();
    },
    jetnose(c, w, h, d) { HULLS.jetnose(c, 0, 0, w, h, d); },
    airnose(c, w, h, d) { HULLS.airnose(c, 0, 0, w, h, d); },
    float(c, w, h, d) { HULLS.float(c, 0, 0, w, h, d); },
    droptank(c, w, h, d) { HULLS.droptank(c, 0, 0, w, h, d); },
    cab(c, w, h) { // side view, driving towards +x
      const l = -w / 2, r = w / 2, b = -h / 2, t = h / 2;
      c.moveTo(l, b); c.lineTo(r, b); c.lineTo(r, b + h * 0.45); c.lineTo(r - w * 0.05, b + h * 0.53);
      c.lineTo(r - w * 0.3, b + h * 0.56); c.lineTo(r - w * 0.46, t); c.lineTo(l + w * 0.06, t); c.lineTo(l, t - h * 0.08);
      c.closePath();
    },
  };

  function outline(d, flip) {
    const c = recorder(), P = PROFILE[d.shape];
    if (P) P(c, d.w, d.h, d); else partPath(c, dummy(d, flip));
    return c.polys.filter((q) => q.length >= 6);
  }

  // Horizontal extent of the outline at height y.
  function span(polys, y) {
    let lo = Infinity, hi = -Infinity;
    for (const P of polys) for (let i = 0, n = P.length; i < n; i += 2) {
      const j = (i + 2) % n, y1 = P[i + 1], y2 = P[j + 1];
      if ((y1 <= y) !== (y2 <= y)) { const x = P[i] + ((y - y1) * (P[j] - P[i])) / (y2 - y1); if (x < lo) lo = x; if (x > hi) hi = x; }
    }
    return lo <= hi ? [lo, hi] : null;
  }

  // ------------------------------------------------------------------ geometry helpers
  function geo(pos, nor, uv, idx, col) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    if (!nor) g.computeVertexNormals();
    return g;
  }

  // Surface of revolution about the part's vertical axis. At each height the outline's horizontal extent
  // [l, r] becomes a ring of centre (l + r) / 2 and radius (r - l) / 2, so asymmetric outlines (tail cone)
  // revolve into upswept shapes. Between outline vertices the extent is linear, so rings go at vertex heights.
  // UVs project the 2D drawing from the front: seen head-on, the part shows exactly its 2D artwork.
  function latheGeo(polys, d, o) {
    const w = d.w, h = d.h, seg = w >= 1.5 ? 44 : 32, ys = [];
    let lo = Infinity, hi = -Infinity;
    for (const P of polys) for (let i = 1; i < P.length; i += 2) { ys.push(P[i]); lo = Math.min(lo, P[i]); hi = Math.max(hi, P[i]); }
    if (o.y0 != null) lo = Math.max(lo, o.y0);
    if (o.y1 != null) hi = Math.min(hi, o.y1);
    ys.push(lo, hi);
    ys.sort((a, b) => a - b);
    const H = [];
    for (const y of ys) if (y >= lo && y <= hi && (!H.length || y - H[H.length - 1] > 1e-5)) H.push(y);
    // runs of smoothly connected rings; a new run starts at a crease, a step or after a gap
    const runs = [];
    let run = null;
    for (let i = 0; i + 1 < H.length; i++) {
      const ya = H[i], yb = H[i + 1], e = (yb - ya) * 1e-3, A = span(polys, ya + e), B = span(polys, yb - e);
      if (!A || !B) { run = null; continue; }
      const sl = (B[0] - A[0]) / (yb - ya), sr = (B[1] - A[1]) / (yb - ya), top = run && run[run.length - 1];
      if (top && Math.abs(top.l - A[0]) + Math.abs(top.r - A[1]) < 1e-4 &&
        Math.abs(Math.atan(top.sl) - Math.atan(sl)) < CREASE && Math.abs(Math.atan(top.sr) - Math.atan(sr)) < CREASE) {
        top.sl = (top.sl + sl) / 2; top.sr = (top.sr + sr) / 2;
      } else {
        const joined = !!run;
        run = [{ y: ya, l: A[0], r: A[1], sl, sr }];
        run.joined = joined;
        runs.push(run);
      }
      run.push({ y: yb, l: B[0], r: B[1], sl, sr });
    }
    const pos = [], nor = [], uv = [], idx = [], [tw, th] = texSize(d), iu = (2.5 * w) / tw, iv = (2.5 * h) / th;
    // fy: flat normal (+1/-1, caps and steps); otherwise the normal of the ring surface, which for centre
    // c(y) and radius r(y) is (cos a, -(r' + c' cos a), sin a). The texture is sampled a few texels inside
    // the silhouette, or the 2D outline stroke would be smeared around the sides.
    const ring = (n, fy) => {
      const C = (n.l + n.r) / 2, R = Math.max(0, (n.r - n.l) / 2), dR = (n.sr - n.sl) / 2, dC = (n.sr + n.sl) / 2, s0 = pos.length / 3;
      const Ru = Math.max(0, R - iu), vy = (n.y - (fy || 0) * iv) / h + 0.5;
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * TAU, co = Math.cos(a), si = Math.sin(a);
        let nx = co, ny = -(dR + dC * co), nz = si;
        if (fy) { nx = 0; ny = fy; nz = 0; }
        const L = Math.hypot(nx, ny, nz) || 1;
        pos.push(C + R * co, n.y, R * si); nor.push(nx / L, ny / L, nz / L); uv.push((C + Ru * co) / w + 0.5, vy);
      }
      return s0;
    };
    // quads between rings a and b; outward for a below b, facing +y for an outer ring a around an inner b
    const strip = (a, b, rev) => {
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        if (rev) idx.push(a + k, a + k1, b + k1, a + k, b + k1, b + k);
        else idx.push(a + k, b + k1, a + k1, a + k, b + k, b + k1);
      }
    };
    const cap = (n, fy, hole) => {
      if (hole >= 1 || n.r - n.l < 2e-4) return;
      const o2 = ring(n, fy), C = (n.l + n.r) / 2;
      if (hole > 0) { const R = ((n.r - n.l) / 2) * hole; strip(o2, ring({ y: n.y, l: C - R, r: C + R, sl: 0, sr: 0 }, fy), fy < 0); return; }
      const c0 = pos.length / 3;
      pos.push(C, n.y, 0); nor.push(0, fy, 0); uv.push(C / w + 0.5, (n.y - fy * iv) / h + 0.5);
      for (let k = 0; k < seg; k++) { const k1 = (k + 1) % seg; if (fy > 0) idx.push(o2 + k, c0, o2 + k1); else idx.push(o2 + k, o2 + k1, c0); }
    };
    runs.forEach((R, j) => {
      let prev = -1;
      for (const n of R) { const s = ring(n, 0); if (prev >= 0) strip(prev, s); prev = s; }
      if (R.joined) {
        const below = runs[j - 1][runs[j - 1].length - 1], first = R[0];
        if (Math.abs(below.l - first.l) + Math.abs(below.r - first.r) > 1e-4) { // a step: the wider side shows a flat ring
          const up = below.r - below.l > first.r - first.l, fy = up ? 1 : -1;
          strip(ring(up ? below : first, fy), ring(up ? first : below, fy), !up);
        }
      } else cap(R[0], -1, j === 0 ? o.holeBot || 0 : 0);
      if (!(runs[j + 1] && runs[j + 1].joined)) cap(R[R.length - 1], 1, j === runs.length - 1 ? o.holeTop || 0 : 0);
    });
    return geo(pos, nor, uv, idx);
  }

  // Front projection of the 2D drawing (u from x, v from y). With inset, faces that don't look along z
  // (extrusion walls) sample the paint just inside the outline instead of the outline stroke itself.
  function projUV(g, d, inset) {
    const P = g.attributes.position, N = g.attributes.normal, [tw, th] = texSize(d), uv = new Float32Array(P.count * 2);
    const ku = 1 - 10 / tw, kv = 1 - 10 / th;
    for (let i = 0; i < P.count; i++) {
      const side = inset && Math.abs(N.getZ(i)) < 0.7;
      uv[i * 2] = (P.getX(i) * (side ? ku : 1)) / d.w + 0.5;
      uv[i * 2 + 1] = (P.getY(i) * (side ? kv : 1)) / d.h + 0.5;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }

  // Outline extruded along z, centred on z = 0, with a bevel that keeps the footprint.
  function extrudeGeo(polys, depth, bevel) {
    const shapes = [];
    for (const P of polys) {
      const q = [];
      for (let i = 0; i < P.length; i += 2) {
        const n = q.length;
        if (!n || Math.abs(q[n - 2] - P[i]) + Math.abs(q[n - 1] - P[i + 1]) > 1e-6) q.push(P[i], P[i + 1]);
      }
      if (q.length > 4 && Math.abs(q[0] - q[q.length - 2]) + Math.abs(q[1] - q[q.length - 1]) < 1e-6) q.length -= 2;
      if (q.length < 6) continue;
      const s = new THREE.Shape();
      s.moveTo(q[0], q[1]);
      for (let i = 2; i < q.length; i += 2) s.lineTo(q[i], q[i + 1]);
      shapes.push(s);
    }
    const g = new THREE.ExtrudeGeometry(shapes, { depth: Math.max(1e-3, depth - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel,
      bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 1, steps: 1 });
    return g.translate(0, 0, bevel - depth / 2);
  }

  // Merges geometries that share a material into one indexed geometry.
  function merge(gs) {
    if (gs.length === 1) return gs[0];
    let n = 0, m = 0;
    for (const g of gs) { n += g.attributes.position.count; m += g.index ? g.index.count : g.attributes.position.count; }
    const hasCol = gs.some((g) => g.attributes.color);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = hasCol ? new Float32Array(n * 3).fill(1) : null;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(m);
    let o = 0, k = 0;
    for (const g of gs) {
      const a = g.attributes, c = a.position.count;
      pos.set(a.position.array, o * 3); nor.set(a.normal.array, o * 3);
      if (a.uv) uv.set(a.uv.array, o * 2);
      if (col && a.color) col.set(a.color.array, o * 3);
      if (g.index) for (let i = 0; i < g.index.count; i++) idx[k++] = g.index.array[i] + o;
      else for (let i = 0; i < c; i++) idx[k++] = o + i;
      o += c;
      g.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }

  // Stretches a +y aligned geometry centred on the origin from a to c.
  function orient(g, a, c) {
    const d = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
    return g.translate((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2);
  }
  const rod = (a, c, r, seg) => orient(new THREE.CylinderGeometry(r, r, dist(a, c), seg || 10), a, c);
  const beam = (a, c, t) => orient(new THREE.BoxGeometry(t, dist(a, c), t), a, c);
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const cone = (a, n, r0, r1, len) => orient(new THREE.CylinderGeometry(r1, r0, len, 12), a, [a[0] + n[0] * len, a[1] + n[1] * len, a[2] + n[2] * len]);

  // Flat quad on the outline edge (x0, y0)-(x1, y1) of a counter-clockwise outline, across z = ±zh,
  // pushed `off` outwards and shortened by `trim` (fraction) at both ends.
  function quad(x0, y0, x1, y1, zh, off, trim) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = dy / L, ny = -dx / L;
    const ax = x0 + dx * trim + nx * off, ay = y0 + dy * trim + ny * off, bx = x1 - dx * trim + nx * off, by = y1 - dy * trim + ny * off;
    return geo([ax, ay, zh, bx, by, zh, bx, by, -zh, ax, ay, -zh], [nx, ny, 0, nx, ny, 0, nx, ny, 0, nx, ny, 0], [0, 0, 1, 0, 1, 1, 0, 1], [0, 2, 1, 0, 3, 2]);
  }

  // Lofts sections through stations { o: leading edge point, A: chord direction, B: thickness direction,
  // c: chord, t: half thickness, col, lead: leading edge colour }, with flat caps at both ends.
  function sweep(st, shape) {
    const S = shape === 'foil' ? FOIL : ELLIPSE, closed = S === ELLIPSE, M = S.length, pos = [], col = [], idx = [];
    const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    const nrm = (a, b, c) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const s of st) for (const [f, q] of S) {
      const a = f * s.c, b = q * s.t, c = f < 0.07 && s.lead ? s.lead : s.col;
      pos.push(s.o[0] + s.A[0] * a + s.B[0] * b, s.o[1] + s.A[1] * a + s.B[1] * b, s.o[2] + s.A[2] * a + s.B[2] * b);
      col.push(c[0], c[1], c[2]);
    }
    for (let j = 0; j + 1 < st.length; j++) for (let i = 0; i < (closed ? M : M - 1); i++) {
      const a = j * M + i, b = j * M + ((i + 1) % M);
      idx.push(a, b, b + M, a, b + M, a + M);
    }
    // samples 3 and 4 lie on the +B side for both section shapes; make that side face +B
    if (dot(nrm(P(3), P(4), P(4 + M)), st[0].B) < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    for (const [j, k] of [[0, 1], [st.length - 1, st.length - 2]]) {
      const s = st[j], out = [s.o[0] - st[k].o[0], s.o[1] - st[k].o[1], s.o[2] - st[k].o[2]], c0 = pos.length / 3;
      pos.push(s.o[0] + s.A[0] * s.c * 0.4, s.o[1] + s.A[1] * s.c * 0.4, s.o[2] + s.A[2] * s.c * 0.4);
      col.push(s.col[0], s.col[1], s.col[2]);
      for (let i = 0; i < M; i++) { pos.push(pos[(j * M + i) * 3], pos[(j * M + i) * 3 + 1], pos[(j * M + i) * 3 + 2]); col.push(col[(j * M + i) * 3], col[(j * M + i) * 3 + 1], col[(j * M + i) * 3 + 2]); }
      for (let i = 0; i < (closed ? M : M - 1); i++) {
        const a = c0 + 1 + i, b = c0 + 1 + ((i + 1) % M);
        if (dot(nrm(P(c0), P(a), P(b)), out) >= 0) idx.push(c0, a, b); else idx.push(c0, b, a);
      }
    }
    return geo(pos, null, null, idx, col);
  }

  // Wing: the airfoil cross-section extruded over the whole span (z), tapering and sweeping towards the
  // tips, white with a darker leading edge and orange tip bands.
  function wingGeo(d) {
    const w = d.w, h = d.h, wd = d.wing || {}, half = (wd.span || 5) / 2, white = lin('#eef1f4'), lead = lin('#9aa3ad'), tip = lin(PAL.orange), st = [];
    const taper = wd.taper != null ? wd.taper : 0.45, back = wd.sweep ? Math.tan(wd.sweep) * half : 0.08 * half;
    for (const [a, col] of [[-1, tip], [-0.86, tip], [-0.86, white], [-0.4, white], [0, white], [0.4, white], [0.86, white], [0.86, tip], [1, tip]]) {
      const s = Math.abs(a), c = h * (1 - taper * s), qc = h / 4 - back * s;
      st.push({ o: [0, qc + c / 4, a * half], A: [0, -1, 0], B: [1, 0, 0], c, t: (w / 2) * (1 - 0.4 * s), col, lead });
    }
    return sweep(st, 'foil');
  }

  // Propeller or rotor blade along +x from r0 to r1, twisted from pitch p0 to p1, in the rotor plane
  // 'xz' (axis y) or 'xy' (axis z); the outer `band` metres carry the tip colour.
  function bladeGeo(r0, r1, c0, c1, th, p0, p1, plane, col, tip, band) {
    const st = [];
    for (const [r, cc] of [[r0, col], [r1 - band, col], [r1 - band, tip], [r1, tip]]) {
      const k = (r - r0) / (r1 - r0), c = lerp(c0, c1, k), p = lerp(p0, p1, k), co = Math.cos(p), si = Math.sin(p);
      const A = plane === 'xz' ? [0, -si, co] : [0, -co, si], B = plane === 'xz' ? [0, co, si] : [0, si, co];
      st.push({ o: [r, -A[1] * c * 0.3, -A[2] * c * 0.3], A, B, c, t: th * (1 - 0.4 * k), col: cc });
    }
    return sweep(st, 'ellipse');
  }

  function nozzleGeo(r, y, depth) {
    return new THREE.LatheGeometry([[1, 0.002], [0.8, 0.3], [0.52, 0.7], [0.3, 0.95], [0, 1]].map(([a, b]) => v2(r * a, y + depth * b)), 32);
  }

  // Tyre (with staggered tread blocks), rim, spokes and hub cap around the z axis, outer face towards +z.
  function wheelNode(r, W) {
    const key = 'wheel|' + r + '|' + W;
    if (models.has(key)) return models.get(key);
    const prof = [[0.6, -0.5], [0.84, -0.5], [0.95, -0.4], [0.97, -0.26], [0.97, 0.26], [0.95, 0.4], [0.84, 0.5], [0.6, 0.5]];
    const list = [[new THREE.LatheGeometry(prof.map(([a, b]) => v2(r * a, W * b)), 40).rotateX(Math.PI / 2), 'tyre'],
      [new THREE.CylinderGeometry(r * 0.62, r * 0.62, W * 0.84, 28).rotateX(Math.PI / 2), 'steelLight'],
      [new THREE.CylinderGeometry(r * 0.17, r * 0.17, 0.05, 16).rotateX(Math.PI / 2).translate(0, 0, W * 0.42 + 0.02), 'orange']];
    for (let i = 0; i < 18; i++) list.push([box(r * 0.06, r * 0.16, W * 0.56, r * 0.965, 0, (i % 2 ? 0.14 : -0.14) * W).rotateZ((i / 18) * TAU), 'tyre']);
    for (let i = 0; i < 5; i++) list.push([box(r * 0.56, r * 0.1, 0.03, r * 0.3, 0, W * 0.42 + 0.015).rotateZ((i / 5) * TAU), 'steelDark']);
    const n = node(list);
    models.set(key, n);
    return n;
  }
  // One wheel, or a pair at z = ±tr (2D physics has one wheel; the second is cosmetic), spinning about z.
  function wheelPair(x, y, tr, r, W) {
    const wn = wheelNode(r, W);
    return (tr > 0 ? [1, -1] : [1]).map((s) => ({ pos: [x, y, s * tr], pieces: [], subs: [
      { role: 'spin', axis: 'z', pieces: [], subs: [s > 0 ? wn : { rot: [0, Math.PI, 0], pieces: wn.pieces, subs: [] }] }] }));
  }

  // A model node: pieces [geometry, material kind] (merged per kind) and offset or animated sub-nodes.
  function node(list, subs, extra) {
    const by = new Map(), n = { pieces: [], subs: subs || [] };
    for (const [g, k] of list) { if (!by.has(k)) by.set(k, []); by.get(k).push(g); }
    for (const [k, gs] of by) n.pieces.push([merge(gs), k]);
    return Object.assign(n, extra);
  }

  // ------------------------------------------------------------------ models by recipe
  const BUILD = {
    lathe(d, flip) {
      const sh = d.shape, w = d.w, h = d.h, b = -h / 2, t = h / 2, nz = sh === 'engine' || sh === 'srb' || sh === 'jet';
      const list = [[latheGeo(outline(d, flip), d, { holeBot: nz ? 0.9 : 0, holeTop: sh === 'jet' ? 0.84 : 0 }), LATHE_KIND[sh] || 'hull']];
      if (sh === 'engine' || sh === 'srb') {
        const depth = sh === 'srb' ? Math.min(0.7, h * 0.12) * 1.6 : h * (1 - d.mount) * 0.7;
        list.push([nozzleGeo(nozzleOf(d).half * 0.9, b, depth), 'nozzle']);
        if (d.style === 'nuclear') { // radiator fins around the reactor
          const mh = h * d.mount;
          for (let i = 0; i < 4; i++) list.push([box(0.12 * w, 0.6 * mh, 0.04, 0.44 * w, t - 0.55 * mh, 0).rotateY((i * Math.PI) / 2), 'steelDark']);
        }
      } else if (sh === 'probe') {
        const ax = w * 0.2;
        list.push([rod([ax, b + h * 0.7, 0], [ax, t - 0.06, 0], 0.018, 8), 'steelDark'], [new THREE.SphereGeometry(0.06, 12, 8).translate(ax, t - 0.06, 0), 'orange']);
      } else if (sh === 'probeL') { // the dish from the 2D drawing
        const R = w * 0.14, y0 = b + h * 0.75, x0 = w / 2 - w * 0.2, pts = [];
        for (let i = 0; i <= 8; i++) { const k = i / 8; pts.push(v2(R * k, y0 + 0.03 + h * 0.11 * k * k)); }
        list.push([new THREE.LatheGeometry(pts, 24).translate(x0, 0, 0), 'dish'], [rod([x0, y0, 0], [x0, y0 + h * 0.22, 0], 0.014, 6), 'steelDark']);
      } else if (sh === 'jetnose') { // long bubble canopy and the pilot
        list.push([new THREE.SphereGeometry(1, 32, 16).scale(0.21 * w, 0.24 * h, 0.24 * w).translate(-0.4 * w, b + 0.3 * h, 0), 'glass'],
          [new THREE.SphereGeometry(0.08 * w, 16, 12).translate(-0.46 * w, b + 0.28 * h, 0), 'white']);
      } else if (sh === 'airnose') { // flight-deck windows wrapping round the top of the nose
        for (const z of [-1, 1]) list.push([box(0.04, h * 0.12, w * 0.3, -0.32 * w, b + h * 0.66, z * w * 0.17).rotateY(z * 0.5), 'glass']);
        list.push([box(0.04, h * 0.12, w * 0.22, -0.4 * w, b + h * 0.64, 0), 'glass']);
      } else if (sh === 'float') { // struts up to the hull
        for (const yy of [0.18 * h, -0.22 * h]) list.push([rod([-w / 2, yy, 0], [-w * 0.05, yy, 0], 0.05, 8), 'steelDark']);
      } else if (sh === 'droptank') {
        list.push([box(w * 0.5, h * 0.3, 0.08, -w * 0.25, 0, 0), 'steelDark']);
      } else if (sh === 'cockpit') {
        list.push([new THREE.SphereGeometry(1, 32, 16).scale(0.22 * w, 0.3 * h, 0.27 * w).translate(-0.42 * w, b + 0.42 * h, 0), 'glass'],
          [new THREE.SphereGeometry(0.075 * w, 16, 12).translate(-0.47 * w, b + 0.4 * h, 0), 'white']); // the pilot's helmet
      } else if (sh === 'jet') {
        const ri = w * 0.36, y = t - 0.42;
        list.push([new THREE.CylinderGeometry(ri, ri, t - y, 32, 1, true).translate(0, (t + y) / 2, 0), 'intake'],
          [new THREE.CylinderGeometry(ri, ri, 0.03, 32).translate(0, y, 0), 'steelDark'],
          [new THREE.LatheGeometry([v2(w * 0.13, y), v2(w * 0.11, y + 0.14), v2(w * 0.06, y + 0.27), v2(0, y + 0.33)], 20), 'steelLight'],
          [nozzleGeo(w * 0.3 * 0.9, b, h * 0.25), 'nozzle']);
        for (let i = 0; i < 16; i++) list.push([box(ri - w * 0.12, 0.02, 0.08, (ri + w * 0.12) / 2, 0, 0).rotateX(0.55).translate(0, y + 0.04, 0).rotateY((i / 16) * TAU), 'steel']);
      }
      return node(list);
    },

    chute(d, flip) { // canister, plus a lid that pops off when the canopy opens
      const polys = outline(d, flip), y = -d.h / 2 + d.h * 0.4;
      return node([[latheGeo(polys, d, { y1: y }), 'hull']], [node([[latheGeo(polys, d, { y0: y }), 'hull']], null, { role: 'lid' })]);
    },

    extrude(d, flip) {
      const depth = d.depth || FLAT_DEPTH[d.shape] || Math.min(d.w, 1);
      return node([[projUV(extrudeGeo(outline(d, flip), depth, Math.min(0.03, depth * 0.2)), d, true), 'hull']]);
    },

    box(d) { // side separator
      return node([[projUV(extrudeGeo([rectPoly(d.w, d.h)], d.depth || 0.6, 0.03), d, true), d.shape === 'sep' ? 'sep' : 'hull']]);
    },

    leg(d, flip) {
      const w = d.w, h = d.h, s = flip ? -1 : 1, i = -s * w / 2, o = s * w / 2, t = h / 2, b = -h / 2;
      const top = [i + s * 0.09, t - 0.15, 0], foot = [o - s * 0.2, b + 0.13, 0], knee = [lerp(top[0], foot[0], 0.55), lerp(top[1], foot[1], 0.55), 0];
      const brace = [o - s * 0.16, b + 0.5, 0];
      return node([[box(0.18, 0.9, 0.3, i + s * 0.09, t - 0.45, 0), 'steelDark'], [rod(top, knee, 0.085, 12), 'steel'], [rod(knee, foot, 0.055, 12), 'steelLight'],
        [rod([i + s * 0.09, t - 0.85, 0.11], brace, 0.035, 8), 'steel'], [rod([i + s * 0.09, t - 0.85, -0.11], brace, 0.035, 8), 'steel'],
        [new THREE.SphereGeometry(0.07, 10, 8).translate(foot[0], foot[1], 0), 'steelDark'],
        [new THREE.CylinderGeometry(0.2, 0.22, 0.1, 20).translate(o - s * 0.22, b + 0.05, 0), 'ink']]);
    },

    rcs(d, flip) {
      const w = d.w, h = d.h, s = flip ? -1 : 1, list = [[projUV(extrudeGeo([rectPoly(w, h * 0.6)], 0.5, 0.04), d, true), 'hull']];
      for (const [p, n] of [[[0, h * 0.3, 0], [0, 1, 0]], [[0, -h * 0.3, 0], [0, -1, 0]], [[s * w / 2, 0, 0], [s, 0, 0]], [[0, 0, 0.25], [0, 0, 1]], [[0, 0, -0.25], [0, 0, -1]]])
        list.push([cone(p, n, 0.05, 0.075, 0.12), 'steelDark']);
      return node(list);
    },

    girder(d) { // a real lattice: four longerons, ties and diagonals every half metre, end plates
      const w = d.w, h = d.h, b = -h / 2 + 0.1, t = h / 2 - 0.1, x = w * 0.35, z = 0.175, list = [];
      const bar = (a, c) => list.push([beam(a, c, 0.04), 'steel']);
      for (const sx of [-x, x]) for (const sz of [-z, z]) bar([sx, b, sz], [sx, t, sz]);
      const n = Math.max(1, Math.round((t - b) / 0.5));
      for (let k = 0; k <= n; k++) {
        const y = b + ((t - b) * k) / n, y2 = b + ((t - b) * (k + 1)) / n;
        for (const sz of [-z, z]) bar([-x, y, sz], [x, y, sz]);
        for (const sx of [-x, x]) bar([sx, y, -z], [sx, y, z]);
        if (k === n) continue;
        for (const sz of [-z, z]) bar([-x, y, sz], [x, y2, sz]);
        for (const sx of [-x, x]) bar([sx, y, k % 2 ? -z : z], [sx, y2, k % 2 ? z : -z]);
      }
      list.push([box(w, 0.1, 0.5, 0, -h / 2 + 0.05, 0), 'steelDark'], [box(w, 0.1, 0.5, 0, h / 2 - 0.05, 0), 'steelDark']);
      return node(list);
    },

    airbrake(d) { // a panel hinged at its back edge; the pivot lifts its front edge into the wind
      const w = d.w, h = d.h, g = projUV(extrudeGeo([rectPoly(w, h)], 1.1, 0.02), d, true).translate(0, h / 2, 0);
      return node([[box(w * 0.6, 0.1, 0.9, 0, -h / 2, 0), 'steelDark']], [{ role: 'pivot', pos: [0, -h / 2, 0], pieces: [[g, 'hull']], subs: [] }]);
    },

    chassis(d) {
      return node([[projUV(extrudeGeo([rectPoly(d.w, d.h)], d.depth || 2.2, 0.05), d, true), 'hull']]);
    },

    cab(d) { // windows on the sides come from the 2D artwork; glass windshield and rear window, lamps
      const w = d.w, h = d.h, depth = d.depth || 2, l = -w / 2, r = w / 2, b = -h / 2, t = h / 2, zh = depth / 2 - 0.12, list = [];
      list.push([projUV(extrudeGeo(outline(d), depth, 0.06), d, true), 'hull'],
        [quad(r - w * 0.3, b + h * 0.56, r - w * 0.46, t, zh, 0.012, 0.06), 'glass'], [quad(l, t - h * 0.12, l, b + h * 0.6, zh, 0.012, 0.04), 'glass']);
      for (const z of [depth / 2 - 0.32, -depth / 2 + 0.32]) {
        list.push([box(0.04, 0.12, 0.24, r + 0.012, b + h * 0.34, z), 'lamp'], [box(0.04, 0.1, 0.18, l - 0.012, b + h * 0.34, z), 'tail']);
      }
      return node(list);
    },

    wing(d) { // elevators turn about their quarter chord
      const g = wingGeo(d);
      if (!(d.wing && d.wing.control)) return node([[g, 'vc']]);
      return node([], [{ role: 'pivot', pos: [0, d.h / 4, 0], pieces: [[g.translate(0, -d.h / 4, 0), 'vc']], subs: [] }]);
    },

    vtail(d, flip) { // swept fin with an airfoil section: root chord on the inner edge, short tip chord at the rear
      const w = d.w, h = d.h, s = flip ? -1 : 1, th = (d.depth || 0.15) / 2, white = lin('#eef1f4'), st = [];
      for (const k of [0, 1]) st.push({ o: [-s * w / 2 + s * w * k, h / 2 - 0.6 * h * k, 0], A: [0, -1, 0], B: [0, 0, 1], c: h * (1 - 0.6 * k), t: th * (1 - 0.4 * k), col: white });
      return node([[projUV(sweep(st, 'foil'), d, true), 'hull']]);
    },

    prop(d) {
      const w = d.w, h = d.h, b = -h / 2, t = h / 2, R = w / 2, y = b + h * 0.42, nose = [], blades = [], nb = d.blades || 3, ch = R > 1.5 ? 0.34 : 0.26;
      for (let i = 0; i <= 10; i++) { const k = i / 10; nose.push(v2(0.3 * Math.pow(1 - k ** 1.7, 0.6), lerp(b + h * 0.3, t, k))); }
      for (let i = 0; i < nb; i++) blades.push(bladeGeo(0.22, R, ch, ch * 0.5, 0.03, 0.8, 0.22, 'xz', lin('#2b3036'), lin(PAL.hazard), 0.14).rotateY((i * TAU) / nb));
      const extra = [];
      if (d.twinZ) extra.push([new THREE.LatheGeometry([v2(0.12, b - 2.4), v2(0.38, b - 1.6), v2(0.46, b - 0.6), v2(0.4, b)], 24), 'white']); // nacelle back over the wing
      return node([[projUV(new THREE.LatheGeometry([v2(0, b), v2(0.33, b), v2(0.36, b + 0.04), v2(0.36, b + h * 0.26), v2(0.3, b + h * 0.3)], 28), d), 'hull'],
        [projUV(new THREE.LatheGeometry(nose, 28), d), 'hull'], [new THREE.CircleGeometry(R, 48).rotateX(-Math.PI / 2).translate(0, y, 0), 'disc'], ...extra],
      [{ role: 'spin', axis: 'y', pos: [0, y, 0], pieces: [[merge(blades), 'vc']], subs: [] }], { anim: { rate: 45, disc: [12, 35, 0.22] } });
    },

    rotor(d) { // mast from the bottom of the part, hub near the top, four drooping blades
      const w = d.w, h = d.h, b = -h / 2, t = h / 2, R = w / 2, y = t - 0.28;
      const blade = bladeGeo(0.24, R, 0.36, 0.3, 0.035, 0.12, 0.03, 'xz', lin('#30353c'), lin(PAL.hazard), 0.3), subs = [], hub = [];
      for (let i = 0; i < 4; i++) {
        subs.push({ rot: [0, (i * TAU) / 4, 0], pieces: [], subs: [{ role: 'droop', pieces: [[blade, 'vc']], subs: [] }] });
        hub.push(box(0.3, 0.08, 0.12, 0.32, 0, 0).rotateY((i * TAU) / 4));
      }
      hub.push(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 24));
      return node([[rod([0, b, 0], [0, y, 0], 0.09, 12), 'steel'],
        [new THREE.LatheGeometry([v2(0.42, b), v2(0.38, b + 0.1), v2(0.18, b + 0.3), v2(0.11, b + 0.36)], 24), 'steelDark'],
        [new THREE.CylinderGeometry(0.28, 0.28, 0.05, 24).translate(0, b + h * 0.48, 0), 'steelDark'],
        [new THREE.RingGeometry(0.34, R, 64, 1).rotateX(-Math.PI / 2).translate(0, y, 0), 'disc']],
      [node([[merge(hub), 'steelDark'], [new THREE.SphereGeometry(0.13, 16, 8, 0, TAU, 0, Math.PI / 2).translate(0, 0.08, 0), 'orange']], subs, { role: 'spin', axis: 'y', pos: [0, y, 0] })],
      { anim: { rate: 28, disc: [6, 22, 0.16] } });
    },

    tailRotor(d) { // two blades in the x-y plane on a stub shaft towards +z
      const R = Math.min(d.w, d.h) * 0.47, zo = 0.3, blade = bladeGeo(0.08, R, 0.16, 0.12, 0.022, 0.18, 0.08, 'xy', lin('#30353c'), lin(PAL.orange), 0.1);
      return node([[box(0.24, 0.24, 0.16, 0, 0, 0.06), 'steelDark'], [rod([0, 0, 0], [0, 0, zo], 0.04, 10), 'steel'],
        [new THREE.CircleGeometry(R, 40).translate(0, 0, zo), 'disc']],
      [node([[merge([blade, blade.clone().rotateZ(Math.PI)]), 'vc'], [new THREE.CylinderGeometry(0.07, 0.07, 0.1, 14).rotateX(Math.PI / 2), 'steelDark']], null,
        { role: 'spin', axis: 'z', pos: [0, 0, zo] })], { anim: { rate: 120, disc: [15, 60, 0.18], tail: true } });
    },

    wheel(d) { // strut from the axle up to the top of the part, as in 2D
      const g = wheelGeom(dummy(d)), r = g.r, W = clamp(r * 0.62, 0.2, 0.4), tr = ((d.wheel && d.wheel.track) || 0) / 2, t = d.h / 2;
      const list = [[box(d.w * 0.16, t - g.y, d.w * 0.16, 0, (t + g.y) / 2, 0), 'steelDark']];
      if (tr > 0) list.push([rod([0, g.y, -tr], [0, g.y, tr], r * 0.12, 10), 'steel']);
      return node(list, wheelPair(0, g.y, tr, r, W));
    },

    gear(d, flip) { // sideways strut from the inner edge, splaying to a pair of wheels at the outer end
      const s = flip ? -1 : 1, g = wheelGeom(dummy(d, flip)), r = g.r, W = clamp(r * 0.6, 0.18, 0.35), tr = ((d.wheel && d.wheel.track) || 0) / 2;
      const i = -s * d.w / 2, knee = [lerp(i, g.x, 0.5), g.y, 0], hz = Math.max(0, tr - W * 0.5 - 0.05);
      const list = [[box(0.1, 0.42, 0.42, i + s * 0.05, g.y, 0), 'steelDark'], [rod([i + s * 0.1, g.y, 0], knee, 0.075, 12), 'steel'],
        [new THREE.SphereGeometry(0.09, 12, 8).translate(knee[0], knee[1], 0), 'steelDark']];
      if (tr > 0) for (const z of [hz, -hz]) list.push([rod(knee, [g.x, g.y, z], 0.045, 10), 'steelLight'], [rod([g.x, g.y, z], [g.x, g.y, Math.sign(z) * tr], 0.035, 8), 'steel']);
      else list.push([rod(knee, [g.x, g.y, 0], 0.05, 10), 'steelLight']);
      return node(list, wheelPair(g.x, g.y, tr, r, W));
    },
  };

  function recipe(d) {
    if (d.body3d && BUILD[d.body3d]) return d.body3d;
    if (d.shape === 'sep' && d.side) return 'box';
    return RECIPE[d.shape] || (LATHE.has(d.shape) ? 'lathe' : 'extrude');
  }

  function model(d, flip) {
    const key = d.type + (flip ? '|f' : '');
    let m = models.get(key);
    if (!m) { m = BUILD[recipe(d)](d, flip); m.anim = m.anim || {}; models.set(key, m); }
    return m;
  }

  // ------------------------------------------------------------------ textures and materials
  // The 2D drawing in flat paint (real lighting does the shading). Offset copies drawn underneath
  // bleed the edge colours outwards so texture filtering at the silhouette never reaches empty texels.
  function paint(d, flip) {
    const [W, H] = texSize(d), cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'), kx = W / d.w, ky = H / d.h, p = dummy(d, flip), flat = PartPaint.flat;
    PartPaint.flat = true;
    try {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ctx.setTransform(kx, 0, 0, -ky, W / 2 + Math.cos(a) * 3, H / 2 + Math.sin(a) * 3);
        drawPart(ctx, p, 1e-4);
      }
      ctx.setTransform(kx, 0, 0, -ky, W / 2, H / 2);
      drawPart(ctx, p, 0.9 / Math.min(kx, ky));
    } finally { PartPaint.flat = flat; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#a7b0ba'; ctx.fillRect(0, 0, W, H);
    return cv;
  }

  function canvasTex(w, h, draw, srgb) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function textureFor(def, flip) {
    need();
    const key = def.type + (flip ? '|f' : '');
    let t = textures.get(key);
    if (!t) {
      t = new THREE.CanvasTexture(paint(def, flip));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, aniso);
      textures.set(key, t);
    }
    return t;
  }

  function makeMat(kind, d, flip) {
    if (kind === 'disc') return new THREE.MeshBasicMaterial({ map: shared.disc, color: 0xdfe5ec, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const k = KINDS[kind] || KINDS.hull;
    if (k.basic) return new THREE.MeshBasicMaterial({ color: k.basic });
    const m = new THREE.MeshStandardMaterial({ color: k.color || 0xffffff, roughness: k.roughness, metalness: k.metalness, envMapIntensity: k.env || 0.8 });
    if (k.map) m.map = textureFor(d, flip);
    if (k.vertexColors) m.vertexColors = true;
    if (k.double) m.side = THREE.DoubleSide;
    if (k.opacity) { m.transparent = true; m.opacity = k.opacity; m.userData.glass = true; }
    if (api.envMap) m.envMap = api.envMap;
    m.userData.op = m.opacity;
    m.userData.c0 = m.color.clone();
    return m;
  }

  // ------------------------------------------------------------------ shared plume and canopy resources
  const PLUME_VS = `
uniform vec2 uP0, uP1, uP2;
varying float vT;
varying vec3 vN, vV;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  float t = uv.y, a = uv.x * 6.28318530718, s = 1.0 - t;
  vec2 q = s * s * uP0 + 2.0 * s * t * uP1 + t * t * uP2;
  vec2 dq = 2.0 * s * (uP1 - uP0) + 2.0 * t * (uP2 - uP1);
  vec3 dir = vec3(cos(a), 0.0, sin(a));
  vec4 mv = modelViewMatrix * vec4(dir.x * q.x, q.y, dir.z * q.x, 1.0);
  vT = t;
  vN = normalMatrix * vec3(-dq.y * dir.x, dq.x, -dq.y * dir.z);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
  // Colour and alpha stops of World.drawFlame along the plume; soft edges where the surface turns away.
  const PLUME_FS = `
uniform vec3 uC0, uC1, uC2;
uniform float uK, uTime, uCore;
varying float vT;
varying vec3 vN, vV;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 col;
  float a;
  if (uCore > 0.5) { col = mix(vec3(1.0, 1.0, 0.92), uC0, vT); a = 0.95 * (1.0 - vT); }
  else if (vT < 0.3) { col = mix(uC0, uC1, vT / 0.3); a = mix(0.95, 0.7, vT / 0.3); }
  else { float k = (vT - 0.3) / 0.7; col = mix(uC1, uC2, k); a = 0.7 * (1.0 - k); }
  float f = abs(dot(normalize(vN), normalize(vV)));
  a *= smoothstep(0.02, 0.6, f) * uK * (0.9 + 0.1 * sin(vT * 38.0 - uTime * 47.0)) * 0.62;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

  function ensureShared() {
    if (shared) return;
    const A = 28, L = 24, uv = [], idx = [];
    for (let j = 0; j <= L; j++) for (let i = 0; i <= A; i++) uv.push(i / A, j / L);
    for (let j = 0; j < L; j++) for (let i = 0; i < A; i++) { const a = j * (A + 1) + i, c = a + A + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
    const plume = new THREE.BufferGeometry();
    plume.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((uv.length / 2) * 3), 3));
    plume.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    plume.setIndex(idx);
    // canopy suspension lines run from the canister (0, -0.88) to the rim, in units of the canopy size
    const lp = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; lp.push(0, -0.88, 0, Math.cos(a), 0, Math.sin(a)); }
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    const gores = canvasTex(64, 16, (ctx, w, h) => {
      ctx.fillStyle = PAL.chuteA; ctx.fillRect(0, 0, w / 2, h);
      ctx.fillStyle = PAL.chuteB; ctx.fillRect(w / 2, 0, w / 2, h);
      ctx.fillStyle = 'rgba(20,20,20,0.35)'; ctx.fillRect(0, h - 2, w, 2);
    }, true);
    gores.wrapS = THREE.RepeatWrapping; gores.repeat.set(6, 1);
    shared = {
      plume, lines,
      diamond: new THREE.LatheGeometry([v2(0, -1), v2(0.7, 0), v2(0, 1)], 12),
      dome: new THREE.SphereGeometry(1, 36, 10, 0, TAU, 0, Math.PI / 2),
      glow: canvasTex(64, 64, (ctx, w) => {
        const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      }),
      disc: canvasTex(128, 128, (ctx, w) => { // a blurred blade disc: clear hub, faint sweep, brighter tips
        const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.12, 'rgba(255,255,255,0)'); g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.86, 'rgba(255,255,255,0.4)'); g.addColorStop(0.95, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
      }),
      canopy: new THREE.MeshStandardMaterial({ map: gores, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 }),
      lineMat: new THREE.LineBasicMaterial({ color: 0xe6e6e6, transparent: true, opacity: 0.7 }),
      color: new THREE.Color(),
    };
  }

  function makePlume(p, root) {
    const d = p.def, type = PLUMES[d.plume] ? d.plume : 'kero', rgb = PLUMES[type], nz = nozzleOf(d);
    const C = rgb.map((c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace));
    const shader = (core) => new THREE.ShaderMaterial({
      uniforms: { uP0: { value: new THREE.Vector2() }, uP1: { value: new THREE.Vector2() }, uP2: { value: new THREE.Vector2() },
        uC0: { value: C[0] }, uC1: { value: C[1] }, uC2: { value: C[2] }, uK: { value: 0 }, uTime: { value: 0 }, uCore: { value: core } },
      vertexShader: PLUME_VS, fragmentShader: PLUME_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    });
    const g = new THREE.Group(), outer = new THREE.Mesh(shared.plume, shader(0)), core = new THREE.Mesh(shared.plume, shader(1));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: shared.glow, color: C[0], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    outer.frustumCulled = core.frustumCulled = false; // shaped in the vertex shader
    outer.raycast = core.raycast = glow.raycast = noop;
    g.add(outer, core, glow);
    const dia = [];
    if (type === 'kero' || type === 'solid' || type === 'spike' || (d.air && d.air.ab)) for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(shared.diamond, new THREE.MeshBasicMaterial({ color: 0xfff6dc, transparent: true, opacity: 0.55 - 0.11 * i,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      m.raycast = noop;
      dia.push(m); g.add(m);
    }
    g.position.y = nz.y;
    g.visible = false;
    root.add(g);
    return { g, type, nz, glow, dia, outer: outer.material.uniforms, core: core.material.uniforms,
      mats: [outer.material, core.material, glow.material, ...dia.map((m) => m.material)], hex: (rgb[1][0] << 16) | (rgb[1][1] << 8) | rgb[1][2], seed: ((p.id || 0) * 2.39) % TAU };
  }

  function makeCanopy(p, root) {
    const g = new THREE.Group(), dome = new THREE.Mesh(shared.dome, shared.canopy), lines = new THREE.LineSegments(shared.lines, shared.lineMat);
    dome.scale.y = 0.42;
    dome.castShadow = dome.receiveShadow = true;
    dome.userData.part = p;
    lines.raycast = noop;
    g.add(dome, lines);
    g.visible = false;
    root.add(g);
    return { g, dome };
  }

  // ------------------------------------------------------------------ part instances
  function instance(n, obj, rig) {
    for (const [g, kind] of n.pieces) {
      let m = rig.mats[kind];
      if (!m) { m = rig.mats[kind] = makeMat(kind, rig.part.def, rig.part.flip); if (kind === 'disc') rig.disc = m; else rig.matList.push(m); }
      const mesh = new THREE.Mesh(g, m);
      if (kind === 'disc') mesh.raycast = noop;
      else { mesh.castShadow = mesh.receiveShadow = true; mesh.userData.part = rig.part; rig.meshes.push(mesh); }
      obj.add(mesh);
    }
    for (const s of n.subs) {
      const g = new THREE.Group();
      if (s.pos) g.position.fromArray(s.pos);
      if (s.rot) g.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
      if (s.role === 'spin') { rig.spins.push(g); rig.axis = s.axis; } else if (s.role === 'droop') rig.droops.push(g); else if (s.role) rig[s.role] = g;
      obj.add(g);
      instance(s, g, rig);
    }
  }

  // Object3D for one part, origin at the part centre. Its materials belong to it (VesselMesh disposes them).
  // radial: a rocket's legs and fins stand in fours around the stack, so each gets a twin turned 90° about
  // the stack's axis (the physics adds the same copies to the hull).
  function buildPart(p, builder, radial) {
    need(); ensureShared();
    const d = p.def, m = model(d, !!p.flip), root = new THREE.Group();
    const rig = { part: p, root, anim: m.anim, mats: {}, matList: [], meshes: [], spins: [], droops: [], axis: 'y', disc: null, pivot: null, lid: null,
      nozzle: null, plume: null, plumes: [], canopy: null, heat: 0, fire: 0, rate: 0, last: null, fspin: 0, seen: 0, opacity: 1, tint: '' };
    // twin parts are a pair, one each side
    const holders = d.twinZ ? [-1, 1].map((s) => { const g = new THREE.Group(); g.position.z = s * d.twinZ; root.add(g); return g; }) : [root];
    for (const h of holders) instance(m, h, rig);
    rig.nozzle = rig.mats.nozzle || null;
    if (!builder && d.thrust && d.plume !== 'none') rig.plumes = holders.map((h) => makePlume(p, h));
    rig.plume = rig.plumes[0] || null;
    if (!builder && d.chute) { rig.canopy = makeCanopy(p, root); rig.meshes.push(rig.canopy.dome); }
    root.position.set(p.x, p.y, 0);
    root.rotation.z = (((p.rot || 0) + (d.pusher ? 2 : 0)) & 3) * Math.PI / 2; // a pusher prop faces backwards
    root.userData.part = p;
    root.userData.rig = rig;
    if (radial && (d.leg || d.fin)) {
      const tw = rig.twin = new THREE.Group();
      instance(m, tw, rig);
      tw.position.set(0, p.y, -p.x);
      tw.rotation.set(0, Math.PI / 2, root.rotation.z);
      tw.userData.part = p;
    }
    return root;
  }

  // Heat glow on every lit material, deep orange to white hot. The paint darkens as it chars so the glow
  // reads in daylight, as the 2D additive glow does. A firing engine's nozzle glows too.
  function emissive(rig) {
    const h = rig.heat, k = Math.min(1, h), I = h > 0 ? Math.min(1.4, h ** 1.2 * 1.2) : 0, c = shared.color.setRGB(1, 0.22 + 0.33 * k * k, 0.04 + 0.12 * k ** 3);
    const dim = 1 - 0.88 * Math.min(1, h * 1.6);
    for (const m of rig.matList) if (m.isMeshStandardMaterial) {
      m.emissive.copy(c); m.emissiveIntensity = I;
      m.color.copy(m.userData.c0).multiplyScalar(dim);
    }
    if (rig.nozzle && rig.fire > 0) { rig.nozzle.emissive.setRGB(1, 0.42, 0.1); rig.nozzle.emissiveIntensity = Math.max(I, 2.2 * rig.fire); }
  }

  // Twin pods hang off a wing. Without one under them (or a wing too short to reach), each pod gets a
  // streamlined pylon to the nearest hull part, so nothing floats. Built in the vessel's frame.
  function dropPylons(rig) {
    if (!rig.pylons) return;
    rig.pylons.removeFromParent();
    rig.pylons.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    rig.pylons = null;
  }
  function pylonsFor(rig, parts, group) {
    dropPylons(rig);
    const p = rig.part, d = p.def;
    if (!d.twinZ || d.float) return; // floats carry their own struts
    // a wing holds the pod if, out at the pod's station, its chord (tapered and swept as wingGeo draws it)
    // runs under the pod
    const pr0 = partRect(p);
    const holds = (q) => {
      const wd = q.def.wing;
      if (!wd || q.def.twinZ || !(isSurface(d) ? partsOverlap(p, q) : partsMounted(p, q))) return false;
      const half = (wd.span || 5) / 2, s = d.twinZ / half;
      if (s > 1.08) return false;
      if ((q.rot || 0) & 1) return true; // a wing turned on its side: trust the side view
      const h = q.def.h, taper = wd.taper != null ? wd.taper : 0.45, back = wd.sweep ? Math.tan(wd.sweep) * half : 0.08 * half;
      const c = h * (1 - taper * Math.min(s, 1)), le = q.y + h / 4 - back * Math.min(s, 1) + c / 4, te = le - c;
      return Math.min(le, pr0.t) - Math.max(te, pr0.b) > 0.15 * Math.min(c, pr0.t - pr0.b);
    };
    if (parts.some((q) => q !== p && holds(q))) return;
    // the nearest hull part, and the point on it closest to the pod
    let best = null, bd = Infinity;
    for (const q of parts) {
      if (q === p || q.def.twinZ || isSurface(q.def) || q.def.wheel) continue;
      const r = partRect(q), cx = clamp(p.x, r.l, r.r), cy = clamp(p.y, r.b, r.t), dd = Math.hypot(cx - p.x, cy - p.y);
      if (dd < bd) { bd = dd; best = { r, cx, cy }; }
    }
    if (!best || bd > 4) return;
    const { r, cx, cy } = best, ins = 0.3; // end a little inside the hull
    const tx = clamp(cx, r.l + (r.r - r.l) * ins, r.r - (r.r - r.l) * ins), ty = clamp(cy, r.b + (r.t - r.b) * ins, r.t - (r.t - r.b) * ins);
    const pr = partRect(p), chord = clamp((pr.t - pr.b) * 0.45, 0.4, 1.8), thick = 0.16;
    const mat = rig.mats.white || rig.matList[0];
    if (!mat) return;
    const g = new THREE.Group(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _px = new THREE.Vector3(), _py = new THREE.Vector3(), _pz = new THREE.Vector3(), _pm = new THREE.Matrix4();
    for (const s of [-1, 1]) {
      _pa.set(p.x, p.y, s * d.twinZ); _pb.set(tx, ty, 0);
      const len = _pa.distanceTo(_pb);
      if (len < 0.3) continue;
      // long axis along the strut, the chord fore and aft (+y), the thin side across
      _px.subVectors(_pb, _pa).normalize();
      _py.set(0, 1, 0).addScaledVector(_px, -_px.y);
      if (_py.lengthSq() < 1e-4) _py.set(1, 0, 0).addScaledVector(_px, -_px.x);
      _py.normalize(); _pz.crossVectors(_px, _py);
      _pm.makeBasis(_px, _py, _pz).setPosition(_pa.add(_pb).multiplyScalar(0.5));
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, chord, thick), mat);
      m.applyMatrix4(_pm);
      m.castShadow = m.receiveShadow = true;
      m.userData.part = p;
      g.add(m);
    }
    rig.pylons = g;
    group.add(g);
  }

  function freeRig(rig) {
    rig.root.removeFromParent();
    dropPylons(rig);
    if (rig.twin) rig.twin.removeFromParent();
    for (const m of rig.matList) m.dispose();
    if (rig.disc) rig.disc.dispose();
    for (const P of rig.plumes) for (const m of P.mats) m.dispose();
  }

  // A part's place and quarter turn (they change as it is dragged around the blueprint).
  function place(rig) {
    const p = rig.part;
    rig.root.position.set(p.x, p.y, 0);
    rig.root.rotation.z = (((p.rot || 0) + (p.def.pusher ? 2 : 0)) & 3) * Math.PI / 2;
    if (rig.twin) { rig.twin.position.set(0, p.y, -p.x); rig.twin.rotation.set(0, Math.PI / 2, rig.root.rotation.z); }
  }
  function tint(rig, r, g, b, k) {
    const key = k > 0 ? `${r},${g},${b},${k}` : '';
    if (rig.tint === key) return;
    rig.tint = key;
    for (const m of rig.matList) if (m.isMeshStandardMaterial) { m.emissive.setRGB(r, g, b); m.emissiveIntensity = k; }
  }
  // The builder's see-through part following the pointer before it is dropped (radial: with its twin).
  function ghost(p, radial) {
    const root = buildPart(p, true, radial), rig = root.userData.rig;
    for (const m of rig.matList) { m.transparent = true; m.opacity = (m.userData.op || 1) * 0.6; m.depthWrite = false; }
    for (const mesh of rig.meshes) mesh.castShadow = false;
    return rig;
  }

  function shown(o) {
    for (; o; o = o.parent) if (!o.visible) return false;
    return true;
  }

  class VesselMesh {
    constructor(parts, opts) {
      need(); ensureShared();
      this.builder = !!(opts && opts.builder);
      this.radial = !!(opts && opts.radial);
      this.group = new THREE.Group();
      this.items = new Map();
      this.list = [];
      this.pickables = [];
      this.exhaust = [];
      this.pool = [];
      this.stamp = 0;
      this.env = api.envMap;
      for (const p of parts) this.add(p);
      this.pylons(parts);
    }

    // (Re)build pylons when the layout changes: parts added, lost or moved.
    pylons(parts) {
      let sig = parts.length;
      for (const p of parts) sig += p.x * 7.13 + p.y * 3.31 + (p.rot || 0) * 1.7 + (p.flip ? 0.5 : 0);
      if (sig === this.pylonSig) return;
      this.pylonSig = sig;
      for (const rig of this.list) if (rig.part.def.twinZ) pylonsFor(rig, parts, this.group);
    }

    add(p) {
      const obj = buildPart(p, this.builder, this.radial), rig = obj.userData.rig;
      this.items.set(p, rig);
      this.list.push(rig);
      this.group.add(obj);
      if (rig.twin) this.group.add(rig.twin);
      for (const m of rig.meshes) this.pickables.push(m);
      return rig;
    }

    // Drops parts that are gone (separation, explosions) and disposes their materials.
    prune(stamp) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const rig = this.list[i];
        if (rig.seen === stamp) continue;
        freeRig(rig);
        this.items.delete(rig.part);
        this.list.splice(i, 1);
      }
      this.pickables = this.list.flatMap((r) => r.meshes);
    }

    sync(v, o) {
      o = o || {};
      const parts = v.parts, dt = o.dt > 0 ? Math.min(o.dt, 0.25) : 0, time = o.time || 0, rho = o.rho > 0 ? o.rho : 0, high = o.quality !== 'low' && o.quality !== false;
      const stamp = ++this.stamp;
      let rotor = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        (this.items.get(p) || this.add(p)).seen = stamp;
        if (p.def.air && p.def.air.kind === 'rotor' && p.firing > rotor) rotor = p.firing;
      }
      if (this.list.length > parts.length) this.prune(stamp);
      this.pylons(parts);
      if (api.envMap !== this.env) {
        this.env = api.envMap;
        for (const r of this.list) for (const m of r.matList) if (m.isMeshStandardMaterial) m.envMap = this.env;
      }
      this.exhaust.length = 0;
      for (let i = 0; i < this.list.length; i++) this.update(this.list[i], dt, time, rho, high, rotor);
    }

    update(rig, dt, time, rho, high, rotor) {
      const p = rig.part, d = p.def, A = rig.anim;
      place(rig);
      const hot = p.temp > 900 ? (p.temp - 900) / (d.maxTemp - 900) : 0, fire = rig.nozzle && p.firing > 0 ? Math.min(1, p.firing) : 0;
      if (Math.abs(hot - rig.heat) > 0.003 || (hot > 0) !== (rig.heat > 0) || fire !== rig.fire) { rig.heat = hot; rig.fire = fire; emissive(rig); }
      if (rig.spins.length) {
        let s = p.spin;
        if (typeof s !== 'number' || !isFinite(s)) { // no spin bookkeeping: turn props and rotors with the throttle
          rig.fspin += (A.tail ? rotor : p.firing > 0 ? p.firing : 0) * (A.rate || 0) * dt;
          s = rig.fspin;
        }
        const ds = rig.last == null ? 0 : Math.abs(s - rig.last);
        rig.last = s;
        if (dt > 0) rig.rate += ((ds < 40 ? ds : 0) / dt - rig.rate) * Math.min(1, dt * 5);
        for (let i = 0; i < rig.spins.length; i++) rig.spins[i].rotation[rig.axis] = s;
        if (rig.disc) rig.disc.opacity = A.disc ? smoothstep(A.disc[0], A.disc[1], rig.rate) * A.disc[2] : 0;
        if (rig.droops.length) { const k = -lerp(0.06, -0.025, smoothstep(3, 20, rig.rate)); for (const g of rig.droops) g.rotation.z = k; }
      }
      if (rig.pivot) rig.pivot.rotation.z = p.deflect || 0;
      if (rig.lid) rig.lid.visible = !(p.deployed > 0 || p.used);
      if (rig.canopy) {
        const k = p.deployed || 0, c = rig.canopy.g;
        c.visible = k > 0 && !p.used;
        if (c.visible) {
          const big = d.chuteArea > 1 ? 1.5 : 1, cw = (2.5 + 6.5 * k) * big, ch = (3 + 6 * k) * big, br = 1 + 0.015 * Math.sin(time * 2.6 + (p.id || 0));
          c.position.set(0, d.h / 2 + 0.88 * ch, 0);
          c.scale.set((cw / 2) * br, ch, (cw / 2) * br);
        }
      }
      if (d.wheel && d.wheel.retract) rig.root.visible = !p.retracted;
      for (let n = 0; n < rig.plumes.length; n++) {
        const P = rig.plumes[n], k = p.firing > 0 ? Math.min(1, p.firing) : 0, ab = p.ab || 0;
        P.g.visible = k > 0;
        if (k <= 0) continue;
        // length and spread as in World.drawFlame, with a smooth flicker instead of a random one; an
        // afterburner stretches the flame and lights shock diamonds in it
        const type = P.type, vac = 1 - clamp(rho / 0.4, 0, 1), bw = P.nz.half;
        const lenK = type === 'ion' ? 3.5 : type === 'solid' ? 4.2 : type === 'hydro' ? 3.4 : 3.2;
        const flick = 1 + 0.12 * (0.6 * Math.sin(time * 37.3 + P.seed) + 0.4 * Math.sin(time * 71.9 + P.seed * 2.1));
        const len = Math.max(d.w, 1) * (1.4 + lenK * k) * (1 + (type === 'spike' ? 0 : vac * 0.9)) * (1 + 1.3 * ab) * flick;
        const spread = bw * (type === 'spike' ? 1 : 1 + vac * (type === 'ion' ? 0.4 : 1.8)), tw = time % 600;
        P.outer.uP0.value.set(bw * 0.92, 0); P.outer.uP1.value.set(spread, -len * 0.35); P.outer.uP2.value.set(0, -len);
        P.core.uP0.value.set(bw * 0.55, 0); P.core.uP1.value.set(bw * 0.5, -len * 0.2); P.core.uP2.value.set(0, -len * 0.5);
        P.outer.uK.value = P.core.uK.value = Math.min(1.6, 0.3 + k + 0.6 * ab);
        P.outer.uTime.value = P.core.uTime.value = tw;
        P.glow.material.opacity = 0.55 * k + 0.4 * ab;
        P.glow.scale.setScalar(bw * (4.8 + 3 * ab));
        const shock = (rho > 0.25 || ab > 0.3) && high && (type !== 'jet' || ab > 0.3);
        for (let i = 0; i < P.dia.length; i++) {
          const m = P.dia[i];
          m.visible = shock;
          if (shock) { m.position.y = -len * (0.14 + 0.13 * i); m.scale.setScalar(bw * (0.42 - 0.07 * i)); }
        }
        if (n) continue;
        const e = this.pool[this.exhaust.length] || (this.pool[this.exhaust.length] = { x: 0, y: 0, k: 0, color: 0 });
        const np = partPt(p, 0, P.nz.y);
        e.x = np.x; e.y = np.y; e.k = k * rig.plumes.length; e.color = P.hex;
        this.exhaust.push(e);
      }
    }

    pick(raycaster) {
      const hits = raycaster.intersectObjects(this.pickables, false);
      for (const h of hits) if (shown(h.object)) return h.object.userData.part;
      return null;
    }

    // Builder: a glow over a part's paint (selection, hover, a spot it can't go), or none (k = 0).
    setTint(part, r, g, b, k) {
      const rig = this.items.get(part);
      if (rig) tint(rig, r, g, b, k);
    }

    // Builder: parts not attached to the control part are drawn see-through.
    setOpacity(part, a) {
      const rig = this.items.get(part);
      if (!rig || rig.opacity === a) return;
      rig.opacity = a;
      for (const m of rig.matList) {
        const t = a < 1 || !!m.userData.glass;
        if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
        m.opacity = (m.userData.op || 1) * a;
        m.depthWrite = a >= 1;
      }
      for (const mesh of rig.meshes) mesh.castShadow = a >= 1;
    }

    dispose() {
      for (const rig of this.list) freeRig(rig);
      this.list.length = 0;
      this.items.clear();
      this.pickables.length = 0;
      this.exhaust.length = 0;
      this.group.removeFromParent();
    }
  }

  const api = {
    envMap: null,
    init(three, renderer) {
      THREE = three || window.THREE || null;
      if (renderer && renderer.capabilities) aniso = renderer.capabilities.getMaxAnisotropy();
    },
    textureFor,
    buildPart: (p) => buildPart(p, false),
    VesselMesh,
    ghost,
    place,
    tint,
    freeGhost: freeRig,
  };
  return api;
})();
