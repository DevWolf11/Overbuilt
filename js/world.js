'use strict';
// Flight-view rendering: sky and lighting, planets (terrain, oceans, clouds, scenery),
// rockets with engine plumes, particle effects and navigation markers.

const Settings = {
  data: Object.assign({ quality: 'high', hints: true, volume: 0.8, markers: true, build3d: false, targets: 'practice' }, store.get('rss.settings', {})),
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; store.set('rss.settings', this.data); },
  get high() { return this.data.quality !== 'low'; },
};

function hash1(i, seed = 0) {
  const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
function luminance(rgbStr) {
  const m = rgbStr.match(/\d+/g);
  if (!m) return 0;
  return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
}
function rgba(hex, a) { const c = hexToRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

// ---------------------------------------------------------------------------
// Particles and effects

function randDir() {
  const z = Math.random() * 2 - 1, a = Math.random() * TAU, s = Math.sqrt(1 - z * z);
  return { x: s * Math.cos(a), y: s * Math.sin(a), z };
}

const FX = {
  list: [],
  max() { return Settings.high ? 900 : 350; },
  add(p) {
    p.life = 0;
    if (p.z === undefined) { p.z = 0; p.vz = 0; }
    this.list.push(p);
    if (this.list.length > this.max()) this.list.splice(0, this.list.length - this.max());
  },
  clear() { this.list.length = 0; },
  // p and v are {x, y, z} relative to the body; bursts fly out in every direction.
  puff(body, p, v, n, color) {
    for (let i = 0; i < n; i++) {
      const d = randDir(), s = 2 + Math.random() * 6;
      this.add({ kind: 'smoke', b: body, x: p.x, y: p.y, z: p.z, vx: v.x + d.x * s, vy: v.y + d.y * s, vz: v.z + d.z * s, max: 0.8 + Math.random() * 0.6, size: 0.6, grow: 2.5, color, alpha: 0.6 });
    }
  },
  sparks(body, p, v, n) {
    for (let i = 0; i < n; i++) {
      const d = randDir(), s = 6 + Math.random() * 24;
      this.add({ kind: 'spark', b: body, x: p.x, y: p.y, z: p.z, vx: v.x + d.x * s, vy: v.y + d.y * s, vz: v.z + d.z * s, max: 0.3 + Math.random() * 0.5, size: 0.15, grow: 0, color: '#ffd27a', alpha: 1 });
    }
  },
  explosion(body, p, v, size, air) {
    if (Silly.on('hollywood')) size *= 3;
    const at = { b: body, x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z };
    this.add({ kind: 'flash', ...at, max: 0.35, size: size * 4, grow: size * 8, color: '#fff3c4', alpha: 1 });
    this.add({ kind: 'ring', ...at, max: 0.7, size: size, grow: size * 14, color: '#ffe2a8', alpha: 0.7 });
    for (let i = 0; i < 26; i++) {
      const d = randDir(), s = 4 + Math.random() * 22;
      this.add({ kind: 'fire', ...at, vx: v.x + d.x * s, vy: v.y + d.y * s, vz: v.z + d.z * s, max: 0.6 + Math.random() * 1.4, size: size * 0.5, grow: size * 1.5, color: i % 3 ? '#ff9a3c' : '#ffe08a', alpha: 1 });
    }
    if (air) for (let i = 0; i < 14; i++) {
      const d = randDir(), s = 2 + Math.random() * 8;
      this.add({ kind: 'smoke', ...at, vx: v.x + d.x * s, vy: v.y + d.y * s, vz: v.z + d.z * s, max: 2 + Math.random() * 2.5, size: size * 0.6, grow: size * 2.5, color: '#4a4f57', alpha: 0.75 });
    }
    this.sparks(body, p, v, 16);
  },
  // spray thrown up around n (the ground's normal) at p
  splash(body, p, n, count) {
    for (let i = 0; i < count; i++) {
      const s = 4 + Math.random() * 10, d = randDir(), j = 4;
      this.add({ kind: 'smoke', b: body, x: p.x, y: p.y, z: p.z, vx: n.x * s + d.x * j, vy: n.y * s + d.y * j, vz: n.z * s + d.z * j,
        max: 0.8 + Math.random(), size: 0.4, grow: 2.5, color: '#e6f3ff', alpha: 0.8, heavy: true });
    }
  },
  update(dt, F) {
    const keep = [];
    for (const p of this.list) {
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.exp(-(p.kind === 'fire' ? 2.5 : p.kind === 'spark' ? 0.6 : 1.6) * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      if (p.heavy || p.kind === 'spark') {
        const r = Math.hypot(p.x, p.y, p.z) || 1, g = (p.b.mu / (r * r)) * dt;
        p.vx -= (p.x / r) * g; p.vy -= (p.y / r) * g; p.vz -= (p.z / r) * g;
      }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      keep.push(p);
    }
    this.list = keep;
  },
  draw(ctx, cam, S, time, night) {
    const dim = 1 - night * 0.55;
    for (const p of this.list) {
      const bp = bodyPos(p.b, time);
      const x = bp.x + p.x - cam.x, y = bp.y + p.y - cam.y;
      const k = p.life / p.max;
      const size = p.size + p.grow * k;
      if (size * S < 0.35 && p.kind !== 'spark') continue;
      switch (p.kind) {
        case 'spark': {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.12, 1.5 / S);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 0.04, y - p.vy * 0.04); ctx.stroke();
          break;
        }
        case 'flash': {
          ctx.globalCompositeOperation = 'lighter';
          const g = ctx.createRadialGradient(x, y, 0, x, y, size);
          g.addColorStop(0, `rgba(255,245,210,${0.9 * (1 - k)})`); g.addColorStop(1, 'rgba(255,160,60,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, size, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'ring': {
          ctx.globalAlpha = p.alpha * (1 - k);
          ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.2, 2 / S) * (1 - k) + 0.05;
          ctx.beginPath(); ctx.arc(x, y, size, 0, TAU); ctx.stroke();
          break;
        }
        case 'plasma': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = p.alpha * (1 - k);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(x, y, size, 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        default: {
          ctx.globalAlpha = p.alpha * (1 - k) * (p.kind === 'fire' ? 1 : dim);
          ctx.fillStyle = p.kind === 'fire' && k > 0.45 ? '#6f6258' : p.color;
          ctx.beginPath(); ctx.arc(x, y, size, 0, TAU); ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  },
};

// ---------------------------------------------------------------------------
// Planet discs (shared by the flight view when zoomed out and the map view)

// The real Earth seen from above the orbital plane (+z, which is the south pole's side), as on the map.
// Canvas x, y are the sim's x, y; built once the map has loaded.
let earthDiscCv = null;
function earthDisc() {
  if (earthDiscCv || !EARTH.mapped) return earthDiscCv;
  const N = 512, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d'), im = g.createImageData(N, N), c = [0, 0, 0], deep = hexToRgb('#0d3566'), shal = hexToRgb('#2a7ab3');
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = ((i + 0.5) / N) * 2 - 1, y = ((j + 0.5) / N) * 2 - 1, r2 = x * x + y * y, k = (j * N + i) * 4;
    if (r2 > 1) continue;
    const a = Math.atan2(y, x), z = Math.asin(Math.sqrt(1 - r2)) * EARTH.radius, h = Terrain.earthH(a, z);
    Terrain.earthColor(a, z, c);
    if (h < 0) { const t = smoothstep(-300, -10, h); for (let q = 0; q < 3; q++) c[q] = lerp(lerp(deep[q], shal[q], t), c[q], 0.2); }
    else for (let q = 0; q < 3; q++) c[q] = Math.min(255, 255 * Math.pow(c[q] / 255, 0.8) * 1.1);
    im.data[k] = c[0]; im.data[k + 1] = c[1]; im.data[k + 2] = c[2]; im.data[k + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return (earthDiscCv = cv);
}

function paintBodyDisc(ctx, b, cx, cy, R, sx, sy, flipY) {
  // sx, sy: unit vector towards the Sun in the same coordinate space as cx, cy
  if (b.star) {
    const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 3.2);
    g.addColorStop(0, 'rgba(255,240,190,0.9)'); g.addColorStop(0.3, 'rgba(255,190,90,0.35)'); g.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 3.2, 0, TAU); ctx.fill();
    const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g2.addColorStop(0, '#fffbe8'); g2.addColorStop(0.7, '#ffd36a'); g2.addColorStop(1, '#ff9d2e');
    ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    return;
  }
  const yUp = flipY ? -1 : 1; // +1 when y points up in this space
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
  const lit = ctx.createRadialGradient(cx + sx * R * 0.35, cy + sy * R * 0.35, R * 0.1, cx, cy, R * 1.1);
  lit.addColorStop(0, mixColor(b.colors.map, '#ffffff', 0.18)); lit.addColorStop(1, b.colors.map);
  ctx.fillStyle = lit; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  const disc = b === EARTH && earthDisc();
  if (disc) {
    ctx.save();
    ctx.translate(cx, cy);
    if (flipY) ctx.scale(1, -1);
    ctx.drawImage(disc, -R, -R, R * 2, R * 2);
    ctx.restore();
  } else if (b.ocean) {
    // land profile along the rim, read straight from the terrain
    ctx.fillStyle = b.colors.land;
    const N = 180;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      if (terrainHeight(b, a) <= 0) continue;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const aa = flipY ? -a : a;
      ctx.arc(cx, cy, R * 1.01, aa - (TAU / N) * 0.6, aa + (TAU / N) * 0.6);
      ctx.closePath(); ctx.fill();
    }
    const inner = ctx.createRadialGradient(cx + sx * R * 0.3, cy + sy * R * 0.3, R * 0.1, cx, cy, R * 0.9);
    inner.addColorStop(0, '#3d86cf'); inner.addColorStop(1, b.colors.map);
    ctx.fillStyle = inner;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.94, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 12; i++) {
      const a = hash1(i, 3) * TAU, rr = R * (0.15 + 0.7 * hash1(i, 4));
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, R * (0.08 + 0.08 * hash1(i, 5)), R * 0.035, 0, 0, TAU); ctx.fill();
    }
  }
  if (b.bands) {
    for (let i = -6; i <= 6; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(120,70,30,0.28)' : 'rgba(255,235,200,0.22)';
      ctx.fillRect(cx - R, cy + (i / 7) * R - R * 0.06, R * 2, R * 0.1 + hash1(i, 9) * R * 0.06);
    }
    ctx.fillStyle = 'rgba(190,80,50,0.55)';
    ctx.beginPath(); ctx.ellipse(cx + R * 0.3, cy + R * 0.28 * yUp * -1, R * 0.16, R * 0.08, 0, 0, TAU); ctx.fill();
  }
  if (b.caps) {
    ctx.fillStyle = 'rgba(245,240,235,0.85)';
    ctx.beginPath(); ctx.ellipse(cx, cy - R * 0.97, R * 0.45, R * 0.16, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx, cy + R * 0.97, R * 0.35, R * 0.12, 0, 0, TAU); ctx.fill();
  }
  if (b.craters || b === PHOBOS) {
    for (let i = 0; i < 10; i++) {
      const a = hash1(i, b.radius) * TAU, rr = R * 0.75 * Math.sqrt(hash1(i + 20, b.radius));
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, R * (0.05 + 0.1 * hash1(i + 40, b.radius)), 0, TAU); ctx.fill();
    }
  }
  if (b === EUROPA) {
    ctx.strokeStyle = 'rgba(160,90,60,0.45)'; ctx.lineWidth = R * 0.02;
    for (let i = 0; i < 7; i++) {
      const a = hash1(i, 11) * TAU;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.quadraticCurveTo(cx, cy, cx - Math.cos(a + 0.6) * R, cy - Math.sin(a + 0.6) * R); ctx.stroke();
    }
  }
  if (b.haze && !b.bands) {
    ctx.fillStyle = 'rgba(255,240,200,0.18)';
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.ellipse(cx, cy + (i / 4) * R, R, R * 0.07, 0.1 * i, 0, TAU); ctx.fill(); }
  }
  // night side
  const sh = ctx.createLinearGradient(cx + sx * R, cy + sy * R, cx - sx * R, cy - sy * R);
  sh.addColorStop(0, 'rgba(2,3,8,0)'); sh.addColorStop(0.42, 'rgba(2,3,8,0)'); sh.addColorStop(0.62, 'rgba(2,3,8,0.78)'); sh.addColorStop(1, 'rgba(2,3,8,0.86)');
  ctx.fillStyle = sh; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.restore();
  if (b.atmoHeight) {
    const ah = Math.max(b.atmoHeight * (R / b.radius), R * 0.04);
    const g = ctx.createRadialGradient(cx, cy, R, cx, cy, R + ah * 1.6);
    g.addColorStop(0, `rgba(${b.colors.halo},0.5)`); g.addColorStop(1, `rgba(${b.colors.halo},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R + ah * 1.6, 0, TAU); ctx.arc(cx, cy, R, 0, TAU, true); ctx.fill();
  }
}

// ---------------------------------------------------------------------------

const World = {
  stars: (() => {
    const rnd = mulberry32(7), out = [];
    for (let i = 0; i < 520; i++) {
      // a faint Milky Way band: bias some stars towards a diagonal
      let x = rnd(), y = rnd();
      if (i % 3 === 0) { const t = rnd(); x = t; y = clamp(0.25 + t * 0.5 + (rnd() - 0.5) * 0.12, 0, 1); }
      out.push({ x, y, m: rnd() * rnd(), tw: rnd() * TAU });
    }
    return out;
  })(),

  // Lighting for the camera position: up vector, sun direction, day/night factors.
  environment(F) {
    const v = F.active, b = v.body, cam = F.camAbs, t = F.time;
    const bp = bodyPos(b, t);
    const rx = cam.x - bp.x, ry = cam.y - bp.y, r = Math.hypot(rx, ry) || 1;
    const up = { x: rx / r, y: ry / r };
    const sl = Math.hypot(cam.x, cam.y) || 1;
    const sun = { x: -cam.x / sl, y: -cam.y / sl };
    const elev = up.x * sun.x + up.y * sun.y;
    const alt = r - b.radius;
    const atmo = b.atmoHeight ? clamp(1 - alt / b.atmoHeight, 0, 1) : 0;
    let night = 0;
    if (!b.star) {
      if (alt < b.radius * 0.3) night = 1 - smoothstep(-0.18, 0.06, elev);
      // in space: inside the planet's shadow cylinder?
      const along = rx * sun.x + ry * sun.y;
      if (along < 0) {
        const perp = Math.abs(rx * sun.y - ry * sun.x);
        night = Math.max(night, 1 - smoothstep(b.radius * 0.97, b.radius * 1.05, perp));
      }
    }
    const day = 1 - night;
    const sunset = atmo * clamp(1 - Math.abs(elev - 0.03) / 0.28, 0, 1);
    return { b, up, sun, elev, alt, atmo, night, day, sunset };
  },

  render(ctx, W, H, dpr, F) {
    const v = F.active;
    const S = F.scale * dpr;
    const Wd = W * dpr, Hd = H * dpr;
    const cos = Math.cos(F.viewRot), sin = Math.sin(F.viewRot);
    const base = [S * cos, -S * sin, -S * sin, -S * cos, Wd / 2, Hd / 2];
    const cam = F.camAbs;
    const env = this.environment(F);
    this.env = env;
    const toScreenDir = (x, y) => ({ x: cos * x - sin * y, y: -(sin * x + cos * y) });

    // ---- sky
    const b = env.b;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const a = env.atmo;
    const skyDay = b.colors.sky || '#03050b', skyHor = b.colors.horizon || '#03050b';
    let zen = mixColor('#03050b', skyDay, Math.pow(a, 0.7) * (0.1 + 0.9 * env.day));
    let hor = mixColor('#04060d', skyHor, Math.pow(a, 0.45) * (0.14 + 0.86 * env.day));
    if (env.sunset > 0) {
      const sc = hexToRgb('#ff8a4a');
      const hc = hor.match(/\d+/g).map(Number);
      hor = `rgb(${Math.round(lerp(hc[0], sc[0], env.sunset * 0.75))},${Math.round(lerp(hc[1], sc[1], env.sunset * 0.75))},${Math.round(lerp(hc[2], sc[2], env.sunset * 0.75))})`;
    }
    const sky = ctx.createLinearGradient(0, 0, 0, Hd);
    sky.addColorStop(0, zen); sky.addColorStop(1, hor);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, Wd, Hd);
    const starA = clamp(1 - luminance(zen) * 3.2, 0, 1);
    if (starA > 0.02) this.drawStars(ctx, Wd, Hd, starA, F.viewRot, F.time);

    // sun glare in the sky (the real Sun is usually far off-screen)
    const sd = toScreenDir(env.sun.x, env.sun.y);
    const sunVisible = env.elev > -0.08 || env.alt > b.radius * 0.5;
    if (!b.star && sunVisible && env.night < 0.9) {
      const k = (1 - env.night) * (0.35 + 0.65 * (1 - a * 0.5));
      const rr = Math.min(Wd, Hd);
      const gx = Wd / 2 + sd.x * rr * 0.62, gy = Hd / 2 + sd.y * rr * 0.62;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, rr * (0.25 + a * 0.35));
      g.addColorStop(0, `rgba(255,248,225,${0.9 * k})`); g.addColorStop(0.08, `rgba(255,236,190,${0.55 * k})`);
      g.addColorStop(0.4, `rgba(255,200,140,${0.12 * k})`); g.addColorStop(1, 'rgba(255,200,140,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, Wd, Hd);
    }

    // ---- bodies
    for (const body of BODIES) this.drawBody(ctx, body, cam, S, base, Wd, Hd, F, env);
    if (Math.hypot(cam.x - bodyPos(EARTH, F.time).x, cam.y - bodyPos(EARTH, F.time).y) < EARTH.radius + 60000) this.drawSpaceCenter(ctx, cam, base, S, F, env);

    // ---- particles (behind rockets)
    ctx.setTransform(...base);
    FX.draw(ctx, cam, S, F.time, env.night);

    // ---- vessels
    for (const ves of F.vessels) if (ves !== v) this.drawVessel(ctx, ves, cam, base, S, F);
    if (v.parts.length) this.drawVessel(ctx, v, cam, base, S, F);

    // ---- clouds in front
    if (b === EARTH && Settings.high) this.drawClouds(ctx, b, cam, S, base, Wd, Hd, F, env);

    // ---- night & haze
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (env.night > 0.02 && !b.star) { ctx.fillStyle = `rgba(2,4,14,${0.42 * env.night})`; ctx.fillRect(0, 0, Wd, Hd); }
    if (b.haze && env.atmo > 0) {
      const rho = airDensity(b, env.alt);
      const k = clamp(Math.sqrt(rho / b.rho0), 0, 1) * 0.55;
      if (k > 0.01) { ctx.fillStyle = `rgba(${b.colors.fog},${k * (0.4 + 0.6 * env.day)})`; ctx.fillRect(0, 0, Wd, Hd); }
    }

    // ---- plumes on top, glowing through the night tint
    ctx.setTransform(...base);
    for (const ves of F.vessels) this.drawPlumes(ctx, ves, cam, base, S, F);

    // ---- markers
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (v.parts.length) this.drawMarkers(ctx, v, Wd, Hd, dpr, S, F, toScreenDir);
  },

  drawStars(ctx, W, H, alpha, rot, time) {
    const off = (rot / TAU) * W * 0.6;
    const big = W > 2000 ? 1.6 : 1;
    for (const s of this.stars) {
      let x = (s.x * W + off) % W; if (x < 0) x += W;
      const y = s.y * H;
      const tw = 0.75 + 0.25 * Math.sin(time * 0.001 + s.tw + performance.now() * 0.002 * (s.m > 0.6 ? 1 : 0));
      ctx.globalAlpha = alpha * (0.25 + 0.75 * s.m) * tw;
      ctx.fillStyle = s.m > 0.7 ? '#ffe9c4' : s.m < 0.2 ? '#c9d8ff' : '#dfe8ff';
      const sz = (0.6 + s.m * 1.7) * big;
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.globalAlpha = 1;
  },

  drawBody(ctx, b, cam, S, base, W, H, F, env) {
    const bc = bodyPos(b, F.time);
    const rx = bc.x - cam.x, ry = bc.y - cam.y;
    const d = Math.hypot(rx, ry);
    const diag = Math.hypot(W, H) / 2 / S;
    const R = b.radius;
    if (d - R * (b.star ? 3.2 : 1.2) - b.terrainMax - b.atmoHeight * 1.6 > diag) return; // nothing on screen
    ctx.setTransform(...base);
    const sl = Math.hypot(bc.x, bc.y) || 1;
    const sx = -bc.x / sl, sy = -bc.y / sl;
    if (b.star || R * S < 260) {
      paintBodyDisc(ctx, b, rx, ry, R, b.star ? 0 : sx, b.star ? 0 : sy, false);
      return;
    }
    if (b.atmoHeight && R * S < 4e4) {
      const g = ctx.createRadialGradient(rx, ry, R * 0.99, rx, ry, R + b.atmoHeight * 1.6);
      g.addColorStop(0, `rgba(${b.colors.halo},0.55)`); g.addColorStop(1, `rgba(${b.colors.halo},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(rx, ry, R + b.atmoHeight * 1.6, 0, TAU); ctx.fill();
    }
    if (d - R - b.terrainMax > diag) return;

    // terrain around the part of the surface near the camera
    const camAng = Math.atan2(-ry, -rx);
    const reach = diag * 1.15 + b.terrainMax * 2;
    const cosSpan = (d * d + R * R - reach * reach) / (2 * d * R);
    if (cosSpan > 1) return;
    const span = cosSpan < -1 ? Math.PI : Math.min(Math.PI, Math.acos(cosSpan) * 1.05 + 0.0005);
    const N = span >= Math.PI ? 720 : 360;
    const angs = new Float64Array(N + 1), hs = new Float64Array(N + 1);
    for (let i = 0; i <= N; i++) { angs[i] = camAng - span + (2 * span * i) / N; hs[i] = terrainHeight(b, angs[i]); }
    const P = (i, rr) => [rx + rr * Math.cos(angs[i]), ry + rr * Math.sin(angs[i])];
    const deep = Math.max(R * 0.2, R - reach * 3);
    const close = () => {
      if (span < Math.PI) {
        ctx.lineTo(rx + deep * Math.cos(camAng + span), ry + deep * Math.sin(camAng + span));
        ctx.lineTo(rx + deep * Math.cos(camAng - span), ry + deep * Math.sin(camAng - span));
      }
      ctx.closePath();
    };
    // ground
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const [x, y] = P(i, R + hs[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    close();
    ctx.fillStyle = b.colors.ground; ctx.fill();
    // strata: a darker band just under the surface
    ctx.save(); ctx.clip();
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const [x, y] = P(i, R + hs[i] - 30); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    close();
    ctx.fillStyle = b.colors.deep; ctx.fill();
    ctx.restore();
    // surface lines (grass/sand/regolith)
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const [x, y] = P(i, R + hs[i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.strokeStyle = b.colors.deep; ctx.lineWidth = Math.min(30, 12 / S); ctx.stroke();
    ctx.strokeStyle = b.colors.surface; ctx.lineWidth = Math.min(8, 4 / S); ctx.stroke();
    // beaches and oceans
    if (b.ocean) {
      ctx.beginPath();
      let on = false;
      for (let i = 0; i <= N; i++) {
        if (hs[i] >= 0 && hs[i] < 14) { const [x, y] = P(i, R + hs[i]); if (on) ctx.lineTo(x, y); else ctx.moveTo(x, y); on = true; } else on = false;
      }
      ctx.strokeStyle = b.colors.sand; ctx.lineWidth = Math.min(10, 5 / S); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i <= N; i++) { const [x, y] = P(i, R); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      for (let i = N; i >= 0; i--) { const [x, y] = P(i, R + Math.min(0, hs[i])); ctx.lineTo(x, y); }
      ctx.closePath();
      ctx.fillStyle = b.colors.water; ctx.fill();
      ctx.beginPath();
      on = false;
      for (let i = 0; i <= N; i++) {
        if (hs[i] < 0) { const [x, y] = P(i, R); if (on) ctx.lineTo(x, y); else ctx.moveTo(x, y); on = true; } else on = false;
      }
      ctx.strokeStyle = b.colors.waterTop; ctx.lineWidth = Math.min(6, 2.5 / S); ctx.stroke();
    }
    // day/night shading across the planet
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const [x, y] = P(i, R + Math.max(b.ocean ? 0 : -1e9, hs[i]) + 1.5 / S); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    close();
    ctx.clip();
    const sh = ctx.createLinearGradient(rx + sx * R, ry + sy * R, rx - sx * R, ry - sy * R);
    sh.addColorStop(0, 'rgba(2,3,8,0)'); sh.addColorStop(0.45, 'rgba(2,3,8,0)'); sh.addColorStop(0.56, 'rgba(2,3,8,0.6)'); sh.addColorStop(1, 'rgba(2,3,8,0.7)');
    ctx.fillStyle = sh;
    ctx.fillRect(-diag * 2, -diag * 2, diag * 4, diag * 4);
    ctx.restore();
    // scenery, darkened to match the local time of day
    if (S > 0.9 && Settings.high) this.drawScenery(ctx, b, rx, ry, camAng, span, S, F, env.night);
  },

  drawScenery(ctx, b, rx, ry, camAng, span, S, F, night = 0) {
    const R = b.radius;
    const dk = (c) => (night > 0.02 ? mixColor(c, '#05070d', night * 0.7) : c);
    const trunk = dk('#4a3624'), leafA = dk('#2f5a2c'), leafB = dk('#3b6b33'), rock = b.colors.rock ? dk(b.colors.rock) : null;
    if (b.trees) {
      const step = 41;
      const i0 = Math.floor(((camAng - span) * R) / step), i1 = Math.ceil(((camAng + span) * R) / step);
      if (i1 - i0 < 900) {
        for (let i = i0; i <= i1; i++) {
          const h1 = hash1(i, 1);
          if (h1 > 0.42) continue;
          const ang = (i * step) / R;
          if (clearZone(b, ang)) continue;
          const th = terrainHeight(b, ang);
          if (th < 4) continue;
          const tall = 6 + hash1(i, 2) * 10;
          const x = rx + (R + th - 0.5) * Math.cos(ang), y = ry + (R + th - 0.5) * Math.sin(ang);
          ctx.save(); ctx.translate(x, y); ctx.rotate(ang - Math.PI / 2);
          ctx.fillStyle = trunk; ctx.fillRect(-0.35, 0, 0.7, tall * 0.35);
          ctx.fillStyle = hash1(i, 5) > 0.5 ? leafA : leafB;
          if (hash1(i, 6) > 0.5) { ctx.beginPath(); ctx.moveTo(-tall * 0.28, tall * 0.25); ctx.lineTo(0, tall); ctx.lineTo(tall * 0.28, tall * 0.25); ctx.closePath(); ctx.fill(); }
          else { ctx.beginPath(); ctx.ellipse(0, tall * 0.62, tall * 0.3, tall * 0.4, 0, 0, TAU); ctx.fill(); }
          ctx.restore();
        }
      }
    }
    if (b.rocks) {
      const step = 17;
      const i0 = Math.floor(((camAng - span) * R) / step), i1 = Math.ceil(((camAng + span) * R) / step);
      if (i1 - i0 < 1400) {
        ctx.fillStyle = rock;
        for (let i = i0; i <= i1; i++) {
          const h1 = hash1(i, 7);
          if (h1 > 0.5) continue;
          const ang = (i * step) / R;
          const th = terrainHeight(b, ang);
          const sz = 0.4 + Math.pow(hash1(i, 8), 3) * 3.5;
          const x = rx + (R + th - sz * 0.3) * Math.cos(ang), y = ry + (R + th - sz * 0.3) * Math.sin(ang);
          ctx.save(); ctx.translate(x, y); ctx.rotate(ang - Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(-sz, 0); ctx.lineTo(-sz * 0.6, sz * 0.7); ctx.lineTo(sz * 0.2, sz * (0.8 + hash1(i, 9) * 0.3)); ctx.lineTo(sz, sz * 0.3); ctx.lineTo(sz * 0.9, 0);
          ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
    }
  },

  drawClouds(ctx, b, cam, S, base, W, H, F, env) {
    const bc = bodyPos(b, F.time);
    const rx = bc.x - cam.x, ry = bc.y - cam.y;
    const d = Math.hypot(rx, ry);
    const diag = Math.hypot(W, H) / 2 / S;
    if (d - b.radius - 9000 > diag) return;
    const camAng = Math.atan2(-ry, -rx);
    const span = Math.min(Math.PI, (diag * 1.2 + 4000) / b.radius);
    const step = 750;
    const drift = F.time * 0.000002;
    const i0 = Math.floor(((camAng - span - drift) * b.radius) / step), i1 = Math.ceil(((camAng + span - drift) * b.radius) / step);
    if (i1 - i0 > 600) return;
    ctx.setTransform(...base);
    const shade = Math.round(255 - 150 * env.night);
    for (let i = i0; i <= i1; i++) {
      if (hash1(i, 21) > 0.62) continue;
      const ang = (i * step) / b.radius + drift;
      const alt = 2200 + hash1(i, 22) * 4500;
      const wdt = 260 + hash1(i, 23) * 700;
      if (wdt * S < 3) continue;
      const cx = rx + (b.radius + alt) * Math.cos(ang), cy = ry + (b.radius + alt) * Math.sin(ang);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang - Math.PI / 2);
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = `rgb(${shade},${shade},${Math.min(255, shade + 8)})`;
      for (let k = 0; k < 4; k++) {
        const ox = (hash1(i * 7 + k, 24) - 0.5) * wdt * 0.8, oy = hash1(i * 7 + k, 25) * wdt * 0.12;
        ctx.beginPath(); ctx.ellipse(ox, oy, wdt * (0.22 + 0.15 * hash1(i * 7 + k, 26)), wdt * 0.11, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  drawSpaceCenter(ctx, cam, base, S, F, env) {
    const e = bodyPos(EARTH, F.time);
    const ox = e.x - cam.x, oy = e.y + EARTH.radius + EARTH.padHeight - cam.y;
    ctx.setTransform(...base);
    ctx.translate(ox, oy);
    const nk = env.night * 0.65;
    const dk = (c) => (nk > 0.02 ? mixColor(c, '#05070d', nk) : c);
    // pad
    ctx.fillStyle = dk('#3b4048'); ctx.fillRect(-12, -3, 24, 3);
    ctx.fillStyle = dk('#585f69'); ctx.fillRect(-12, -0.5, 24, 0.5);
    ctx.fillStyle = dk('#ffc93c');
    for (let x = -11.5; x < 11.5; x += 2) ctx.fillRect(x, -0.45, 1, 0.12);
    // flame trench
    ctx.fillStyle = dk('#23272d'); ctx.fillRect(-3, -3, 6, 2.5);
    // tower
    ctx.strokeStyle = dk('#8a929c'); ctx.lineWidth = 0.25;
    const tx = 8.5, th = 30;
    ctx.beginPath();
    ctx.moveTo(tx, 0); ctx.lineTo(tx, th); ctx.moveTo(tx + 2.4, 0); ctx.lineTo(tx + 2.4, th);
    for (let y = 0; y < th; y += 2.4) { ctx.moveTo(tx, y); ctx.lineTo(tx + 2.4, y + 2.4); ctx.moveTo(tx + 2.4, y); ctx.lineTo(tx, y + 2.4); }
    ctx.stroke();
    ctx.fillStyle = dk('#8a929c');
    for (let y = 8; y < th; y += 8) ctx.fillRect(tx - 3, y, 3, 0.35);
    const blink = Math.sin(performance.now() / 300) > 0 ? '#ff5d5d' : '#7a2a2a';
    ctx.fillStyle = blink; ctx.beginPath(); ctx.arc(tx + 1.2, th + 0.6, 0.5, 0, TAU); ctx.fill();
    // assembly building
    const win = env.night > 0.4 ? '#ffd98a' : '#8fb4d0';
    ctx.fillStyle = dk('#c9ccd1'); ctx.fillRect(-115, 0, 48, 62);
    ctx.fillStyle = dk('#9aa0a8'); ctx.fillRect(-115, 0, 48, 4);
    ctx.fillStyle = dk('#2f5f9a'); ctx.fillRect(-111, 46, 12, 12);
    ctx.fillStyle = dk('#d43c3c'); ctx.fillRect(-97, 46, 16, 12);
    ctx.fillStyle = dk('#5b636d'); ctx.fillRect(-96, 0, 14, 40);
    ctx.fillStyle = win;
    for (let y = 8; y < 40; y += 6) for (let x = -112; x < -100; x += 4) ctx.fillRect(x, y, 2, 2.4);
    // mission control
    ctx.fillStyle = dk('#b8bcc3'); ctx.fillRect(-160, 0, 34, 16);
    ctx.fillStyle = win;
    for (let x = -157; x < -129; x += 4) ctx.fillRect(x, 8, 2.4, 3);
    ctx.strokeStyle = dk('#9aa0a8'); ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(-143, 16); ctx.lineTo(-143, 26); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-143, 27, 3, 1.4, 0.4, 0, TAU); ctx.fillStyle = dk('#d6d9de'); ctx.fill();
    // water tower and flag
    ctx.fillStyle = dk('#8a929c');
    ctx.fillRect(38, 0, 0.5, 18); ctx.fillRect(44, 0, 0.5, 18);
    ctx.beginPath(); ctx.arc(41.2, 21, 4, 0, TAU); ctx.fillStyle = dk('#e8ebef'); ctx.fill();
    ctx.fillStyle = dk('#ff7a1a'); ctx.fillRect(37.5, 20, 7.5, 1.2);
    ctx.fillStyle = dk('#9aa0a8'); ctx.fillRect(-30, 0, 0.3, 14);
    ctx.fillStyle = dk('#ffb547'); ctx.fillRect(-29.7, 10.5, 5, 3.2);
    this.drawAirfield(ctx, cam, base, S, F, env, dk);
  },

  // Runway, helipad and the causeway road. They run for kilometres, so each piece is placed at its own
  // spot on the curved surface instead of in one flat frame.
  drawAirfield(ctx, cam, base, S, F, env, dk) {
    const e = bodyPos(EARTH, F.time), R = EARTH.radius;
    const W = F.canvas.width, H = F.canvas.height, reach = Math.hypot(W, H) / 2 / S + 200;
    const at = (east, h) => {
      const a = siteAngle(EARTH, east), r = R + terrainHeight(EARTH, a) + (h || 0);
      const x = e.x + r * Math.cos(a) - cam.x, y = e.y + r * Math.sin(a) - cam.y;
      if (Math.hypot(x, y) > reach) return false;
      ctx.setTransform(...base); ctx.translate(x, y); ctx.rotate(a - Math.PI / 2);
      return true;
    };
    const night = env.night > 0.4;
    // helipad
    if (at(EARTH.sites.helipad.east)) {
      ctx.fillStyle = dk('#4a5059'); ctx.fillRect(-10, -0.6, 20, 0.6);
      ctx.fillStyle = dk('#e9edf1'); ctx.fillRect(-10, -0.12, 20, 0.12);
      ctx.fillStyle = dk('#ffc93c'); ctx.fillRect(-3, -0.1, 6, 0.1);
      ctx.fillStyle = night ? '#7dffb0' : dk('#5b636d'); ctx.fillRect(-10.2, 0, 0.4, 0.4); ctx.fillRect(9.8, 0, 0.4, 0.4);
    }
    // runway: asphalt with dashes, and edge lights that glow at night
    const rw = EARTH.runway;
    if (S > 0.05) {
      for (let x = rw.from; x < rw.to; x += 40) {
        if (!at(x + 20)) continue;
        ctx.fillStyle = dk('#2b2f35'); ctx.fillRect(-20.5, -0.5, 41, 0.5);
        ctx.fillStyle = dk('#e9edf1');
        if (((x - rw.from) / 40) % 2 === 0) ctx.fillRect(-10, -0.08, 20, 0.08);
        if (x === rw.from || x + 40 >= rw.to) ctx.fillRect(-20, -0.08, 40, 0.08);
        ctx.fillStyle = night ? '#ffe9a8' : dk('#9aa0a8'); ctx.fillRect(-0.15, 0, 0.3, 0.35);
      }
    }
    // causeway road with railing posts
    if (S > 0.4) {
      for (let x = EARTH.causeway.from; x < EARTH.causeway.to; x += 25) {
        if (!at(x + 12.5)) continue;
        ctx.fillStyle = dk('#34383e'); ctx.fillRect(-12.6, -0.4, 25.2, 0.4);
        ctx.fillStyle = dk('#d9dde2'); ctx.fillRect(-4, -0.06, 8, 0.06);
        ctx.fillStyle = dk('#8a929c'); ctx.fillRect(-0.1, 0, 0.2, 1); ctx.fillRect(-12.5, 0.85, 25, 0.12);
      }
    }
    // airport hangar and control tower beside the runway
    if (at(900)) {
      ctx.fillStyle = dk('#aab2bb');
      ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(-30, 12); ctx.quadraticCurveTo(0, 22, 30, 12); ctx.lineTo(30, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = dk('#5b636d'); ctx.fillRect(-22, 0, 44, 10);
      ctx.fillStyle = dk('#ff7a1a'); ctx.fillRect(-30, 11, 60, 0.8);
    }
    if (at(1250)) {
      ctx.fillStyle = dk('#c9ccd1'); ctx.fillRect(-2, 0, 4, 22);
      ctx.fillStyle = night ? '#ffd98a' : dk('#7fb8d8'); ctx.fillRect(-3.5, 22, 7, 3);
      ctx.fillStyle = dk('#5b636d'); ctx.fillRect(-4, 25, 8, 0.8);
      ctx.fillStyle = Math.sin(performance.now() / 400) > 0 ? '#ff5d5d' : '#7a2a2a'; ctx.fillRect(-0.3, 25.8, 0.6, 0.6);
    }
  },

  drawVessel(ctx, v, cam, base, S, F) {
    const bp = bodyPos(v.body, F.time);
    const x = bp.x + v.x - cam.x, y = bp.y + v.y - cam.y;
    const ext = Math.max(v.bounds.maxX - v.bounds.minX, v.bounds.maxY - v.bounds.minY) + 30;
    const W = F.canvas.width, H = F.canvas.height;
    if (Math.hypot(x, y) - ext > Math.hypot(W, H) / 2 / S) return;
    ctx.setTransform(...base);
    ctx.translate(x, y);
    ctx.rotate(v.rot);
    ctx.translate(-v.com.x, -v.com.y);
    const lw = 1.1 / F.scale;
    // reentry plasma sheath
    if (v.heatFlux > 3e7) {
      const k = clamp((v.heatFlux - 3e7) / 1.5e8, 0, 1);
      const sp = v.speed() || 1;
      const c = Math.cos(-v.rot), s = Math.sin(-v.rot);
      const lvx = (c * v.vx - s * v.vy) / sp, lvy = (s * v.vx + c * v.vy) / sp;
      const L = v.bounds.maxY - v.bounds.minY;
      const cx = v.com.x + lvx * (v.width * 0.55), cy = v.com.y + lvy * (L * 0.5);
      const rad = Math.max(v.width, 2) * (1.5 + k * 1.5);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(255,236,190,${0.8 * k})`); g.addColorStop(0.35, `rgba(255,140,40,${0.55 * k})`); g.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.fill();
      // trailing streaks
      ctx.lineWidth = Math.max(v.width * 0.08, 0.12);
      for (let i = -1; i <= 1; i++) {
        const x0 = cx + lvy * i * v.width * 0.5, y0 = cy - lvx * i * v.width * 0.5;
        const x1 = cx - lvx * L * 2.2 + lvy * i * v.width * 0.7, y1 = cy - lvy * L * 2.2 - lvx * i * v.width * 0.7;
        const sg = ctx.createLinearGradient(x0, y0, x1, y1);
        sg.addColorStop(0, `rgba(255,190,110,${0.6 * k})`); sg.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.strokeStyle = sg;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    for (const p of v.parts) p.fuelFrac = p.def.fuel ? p.fuel / (p.def.fuel * 1000) : null;
    for (const p of v.parts) if (p.def.chute) drawCanopy(ctx, p, lw);
    for (const p of v.parts) if (p.def.leg || p.def.fin || p.def.wheel) drawPart(ctx, p, lw);
    for (const p of v.parts) if (!p.def.leg && !p.def.fin && !p.def.wheel) drawPart(ctx, p, lw);
    if (F.flash && v === F.active) {
      const age = (performance.now() - F.flash.t) / 500;
      const p = v.byId.get(F.flash.id);
      if (age < 1 && p) {
        ctx.strokeStyle = `rgba(255,181,71,${1 - age})`; ctx.lineWidth = 3 / F.scale;
        partPath(ctx, p); ctx.stroke();
      } else F.flash = null;
    }
  },

  drawPlumes(ctx, v, cam, base, S, F) {
    if (!v.parts.some((p) => p.firing > 0)) return;
    const bp = bodyPos(v.body, F.time);
    const x = bp.x + v.x - cam.x, y = bp.y + v.y - cam.y;
    ctx.setTransform(...base);
    ctx.translate(x, y); ctx.rotate(v.rot); ctx.translate(-v.com.x, -v.com.y);
    const rho = airDensity(v.body, v.altitude());
    ctx.globalCompositeOperation = 'lighter';
    for (const p of v.parts) if (p.def.thrust && p.firing > 0 && p.def.plume !== 'none') this.drawFlame(ctx, p, p.firing, rho);
    ctx.globalCompositeOperation = 'source-over';
  },

  drawFlame(ctx, e, k, rho) {
    const d = e.def, nz = nozzleOf(d);
    const type = d.plume || 'kero';
    const vac = 1 - clamp(rho / 0.4, 0, 1);
    const ny = e.y + nz.y, bw = nz.half;
    const flick = 0.88 + Math.random() * 0.24;
    const C = {
      kero: ['255,214,140', '255,140,40', '255,70,20'],
      solid: ['255,240,190', '255,180,70', '255,110,40'],
      hydro: ['235,245,255', '150,190,255', '90,120,255'],
      nuclear: ['230,255,250', '140,230,255', '80,160,255'],
      ion: ['200,225,255', '90,150,255', '60,90,255'],
      spike: ['255,220,150', '255,150,60', '255,90,30'],
      jet: ['255,228,196', '255,160,96', '150,120,255'],
    }[type] || ['255,214,140', '255,140,40', '255,70,20'];
    const lenK = type === 'ion' ? 3.5 : type === 'solid' ? 4.2 : type === 'hydro' ? 3.4 : 3.2;
    const len = Math.max(d.w, 1) * (1.4 + lenK * k) * (1 + (type === 'spike' ? 0 : vac * 0.9)) * flick;
    const spread = bw * (type === 'spike' ? 1 : 1 + vac * (type === 'ion' ? 0.4 : 1.8));
    // nozzle glow
    let g = ctx.createRadialGradient(e.x, ny, 0, e.x, ny, bw * 2.4);
    g.addColorStop(0, `rgba(${C[0]},${0.55 * k})`); g.addColorStop(1, `rgba(${C[1]},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, ny, bw * 2.4, 0, TAU); ctx.fill();
    // outer plume
    g = ctx.createLinearGradient(0, ny, 0, ny - len);
    g.addColorStop(0, `rgba(${C[0]},0.95)`); g.addColorStop(0.3, `rgba(${C[1]},0.7)`); g.addColorStop(1, `rgba(${C[2]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(e.x - bw * 0.92, ny);
    ctx.quadraticCurveTo(e.x - spread, ny - len * 0.35, e.x, ny - len);
    ctx.quadraticCurveTo(e.x + spread, ny - len * 0.35, e.x + bw * 0.92, ny);
    ctx.closePath(); ctx.fill();
    // core
    g = ctx.createLinearGradient(0, ny, 0, ny - len * 0.5);
    g.addColorStop(0, 'rgba(255,255,245,0.95)'); g.addColorStop(1, `rgba(${C[0]},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(e.x - bw * 0.55, ny);
    ctx.quadraticCurveTo(e.x - bw * 0.5, ny - len * 0.2, e.x, ny - len * 0.5);
    ctx.quadraticCurveTo(e.x + bw * 0.5, ny - len * 0.2, e.x + bw * 0.55, ny);
    ctx.closePath(); ctx.fill();
    // shock diamonds in thick air
    if ((type === 'kero' || type === 'solid' || type === 'spike') && rho > 0.25 && Settings.high) {
      for (let i = 0; i < 4; i++) {
        const yy = ny - len * (0.14 + i * 0.13), sz = bw * (0.42 - i * 0.07);
        ctx.fillStyle = `rgba(255,250,230,${0.55 - i * 0.11})`;
        ctx.beginPath(); ctx.moveTo(e.x, yy + sz); ctx.lineTo(e.x + sz * 0.7, yy); ctx.lineTo(e.x, yy - sz); ctx.lineTo(e.x - sz * 0.7, yy); ctx.closePath(); ctx.fill();
      }
    }
  },

  drawMarkers(ctx, v, W, H, dpr, S, F, toScreenDir) {
    if (!Settings.get('markers')) return;
    const bp = bodyPos(v.body, F.time);
    const vx = (bp.x + v.x - F.camAbs.x), vy = (bp.y + v.y - F.camAbs.y);
    const c = toScreenDir(vx, vy);
    const cx = W / 2 + c.x * S, cy = H / 2 + c.y * S;
    const ext = Math.max(v.bounds.maxX - v.bounds.minX, v.bounds.maxY - v.bounds.minY) * S;
    const R = Math.max(ext * 0.7, 70 * dpr);
    const mark = (wx, wy, kind, color) => {
      const l = Math.hypot(wx, wy); if (!l) return;
      const d = toScreenDir(wx / l, wy / l);
      this.markerGlyph(ctx, cx + d.x * R, cy + d.y * R, kind, color, dpr);
    };
    this.markersFor(v, F, bp, mark);
    // far zoom: keep the craft findable
    if ((v.bounds.maxY - v.bounds.minY) * S < 6 * dpr) this.findRing(ctx, cx, cy, dpr);
  },

  // The same markers over the 3D view: each one sits where its direction points, on a sphere around the craft.
  drawOverlay3D(ctx, W, H, dpr, F) {
    const v = F.active;
    if (!v || !v.parts.length || !Settings.get('markers')) return;
    const bp = bodyPos(v.body, F.time), ax = bp.x + v.x, ay = bp.y + v.y, az = v.z;
    const c = Render3D.project(ax, ay, az);
    if (c.behind) return;
    const mpp = Render3D.metresPerPixelAt(ax, ay, az);
    if (!(mpp > 0)) return;
    const ext = Math.max(v.bounds.maxX - v.bounds.minX, v.bounds.maxY - v.bounds.minY);
    const Rm = Math.max(ext * 0.7, 70 * mpp);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const mark = (wx, wy, kind, color, wz = 0) => {
      const l = Math.hypot(wx, wy, wz); if (!l) return;
      const p = Render3D.project(ax + (wx / l) * Rm, ay + (wy / l) * Rm, az + (wz / l) * Rm);
      if (!p.behind) this.markerGlyph(ctx, p.x * dpr, p.y * dpr, kind, color, dpr);
    };
    this.markersFor(v, F, bp, mark);
    if (ext / mpp < 6) this.findRing(ctx, c.x * dpr, c.y * dpr, dpr);
  },

  markersFor(v, F, bp, mark) {
    if (!v.landed && v.speed() > 1) {
      mark(v.vx, v.vy, 'pro', 'rgba(185,255,120,0.85)', v.vz);
      mark(-v.vx, -v.vy, 'retro', 'rgba(185,255,120,0.55)', -v.vz);
    }
    if (F.target && F.target !== v.body) {
      const tp = bodyPos(F.target, F.time);
      mark(tp.x - (bp.x + v.x), tp.y - (bp.y + v.y), 'target', 'rgba(232,120,255,0.85)', -v.z);
    }
  },

  markerGlyph(ctx, x, y, kind, color, dpr) {
    const r = 7 * dpr;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    if (kind === 'pro') {
      ctx.arc(x, y, r, 0, TAU); ctx.moveTo(x, y - r); ctx.lineTo(x, y - r * 1.8); ctx.moveTo(x - r, y); ctx.lineTo(x - r * 1.8, y); ctx.moveTo(x + r, y); ctx.lineTo(x + r * 1.8, y);
      ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 1.6 * dpr, 0, TAU); ctx.fill();
    } else if (kind === 'retro') {
      ctx.arc(x, y, r, 0, TAU); ctx.moveTo(x - r * 0.7, y - r * 0.7); ctx.lineTo(x + r * 0.7, y + r * 0.7); ctx.moveTo(x + r * 0.7, y - r * 0.7); ctx.lineTo(x - r * 0.7, y + r * 0.7); ctx.stroke();
    } else {
      ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, 1.6 * dpr, 0, TAU); ctx.fill();
    }
  },

  findRing(ctx, x, y, dpr) {
    ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, TAU); ctx.stroke();
  },
};
