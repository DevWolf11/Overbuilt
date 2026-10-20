'use strict';
// The flight view, drawn with three.js: sky, planets, terrain and scenery, the space centre, vessels
// (meshes from Parts3D), particles and the sound-barrier vapour cone, plus a turntable in the hangar.
// The planets orbit in the sim's XY plane; craft fly in full 3D. Everything is placed relative to the
// focus (floating origin) inside groups turned into the local surface frame: y up, x east, z north.

const Render3D = (() => {
  const FOV = 50, TANH = Math.tan((FOV * Math.PI) / 360);
  const PW = 2.2;     // terrain grid spacing exponent: dense under the craft, coarse at the horizon
  const TILE = 12;    // metres per repeat of the ground detail texture
  const TILT = 0.26;  // the light leans a little towards the camera so faces seen head-on get some sun
  let THREE = null, renderer = null, canvas = null, loading = null, supported = null;
  let W = 1, H = 1, DPR = 1, shown = false, mode = 'flight', high = null, clock = 0, frameNo = 0, maxAniso = 1;
  let spaceScene, spaceWorld, localScene, localWorld, studio, camera, bcam;
  const api = { ready: false, failed: false, envMap: null };

  // ------------------------------------------------------------------ colour helpers (noise and terrain live in terrain.js)
  const { hashI, vnoise2, vnoise3, fbm3, cfgOf, grid, setCol, setRow, contAt, height, h3dAt, trackHalf, trackBlend, apronW } = Terrain;
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const lin = (c) => LIN[c < 0 ? 0 : c > 255 ? 255 : Math.round(c)];
  const C = (hex) => hexToRgb(hex);
  function mixC(a, b, t, out) {
    out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }
  const setCol3 = (col, c, k = 1) => col.setRGB(lin(c[0]) * k, lin(c[1]) * k, lin(c[2]) * k);
  const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;


  // Colours (sRGB 0..255) for ground and planet maps. tex: painting a whole-planet texture.
  const P = {
    sand: C('#d2bf8e'), wet: C('#b9a676'), seabed: C('#3d5b5a'), grassA: C('#77a152'), grassB: C('#4a6b3c'), forest: C('#3e5f35'),
    arid: C('#b39c66'), hill: C('#6b7148'), rockE: C('#77705f'), basalt: C('#4a4844'), snow: C('#eef3f6'), concrete: C('#9fa3a7'),
    oceanD: C('#123a6a'), oceanS: C('#2873ab'), ice: C('#e9f1f6'), marsDust: C('#d58e5f'), venA: C('#e8cd8c'), venB: C('#c9a35f'),
    venC: C('#f4e2b4'), jupA: C('#e6d1ae'), jupB: C('#c08d5c'), jupC: C('#9c6b45'), jupD: C('#d9b88a'), spot: C('#c2603f'),
    eurA: C('#e5eff4'), eurB: C('#c8d6de'), linea: C('#9b6a4c'),
  };
  const T1 = [0, 0, 0], T2 = [0, 0, 0], BIO = [0, 0, 0], BIOL = [0, 0, 0];
  const FOAM = [238, 246, 250], ASPHALT = [74, 77, 82], URBAN = [132, 126, 116], HEDGE = [70, 96, 52], LAKE_S = [52, 128, 150], LAKE_D = [22, 70, 104];
  const FIELDS = [[196, 176, 104], [118, 158, 72], [140, 112, 76], [160, 186, 104], [96, 132, 64], [184, 160, 92]];
  const FIELD_AVG = [0, 1, 2].map((q) => FIELDS.reduce((s, f) => s + f[q], 0) / FIELDS.length);
  let SHORE = 1e9; // estimated distance to the waterline (m): height over the local slope
  let FAR = 0; // 0..1: how coarse the terrain cell being painted is (thin bands like beaches fade out)
  // the real Earth's colour (Blue Marble) under a point, lifted a little: the photo is dark. Where the
  // photo shows water but the ground is land (the space centre's island, coasts the two maps disagree
  // on), BIOW says how much to trust it: 0 for open water.
  let BIOW = 1;
  let CLIFF = 0; // the Faroes and Shetland: sea cliffs, not beaches (set per vertex, like BIOL)
  function bioAt(a, z) {
    Terrain.earthColor(a, z, BIO);
    for (let k = 0; k < 3; k++) BIOL[k] = Math.min(255, 255 * Math.pow(BIO[k] / 255, 0.8) * 1.08);
    BIOW = 1 - smoothstep(4, 22, BIO[2] - Math.max(BIO[0], BIO[1]));
    return BIOL;
  }
  // how green the ground is (0 desert, ice, rock .. 1 forest), for trees
  const vegOf = (c) => lerp(0.8, (1 - smoothstep(0.22, 0.45, lum(c))) * (c[1] >= c[0] * 0.92 ? 1 : 0.35), BIOW);
  function paint(c, h, n, cont, dark, slope, lat, tex, out) {
    const p = c.pal, al = Math.abs(lat);
    switch (c.kind) {
      case 'earth': {
        if (c.mapped) { // the real Earth: BIOL holds the map's colour here
          if (tex) { // a texel is ~2 km: blend land and sea by how much of it is land, so coasts stay smooth
            const t = smoothstep(-700, -30, h);
            mixC(P.oceanD, P.oceanS, 0.55 * t * t, out);
            mixC(out, BIOL, 0.25, out);
            if (BIOW < 1) mixC(mixC(P.grassB, P.arid, 0.25, T2), BIOL, BIOW, BIOL); // land the photo shows as sea
            return mixC(out, BIOL, smoothstep(-5, 5, h), out);
          }
          if (h < 0) mixC(P.wet, P.seabed, Math.max(smoothstep(-2, -40, h), CLIFF * 0.9), out); // (rock, not sand, under the cliffs)
          else {
            mixC(P.grassA, P.grassB, clamp(n * 1.2 - 0.1, 0, 1), out);
            mixC(out, BIOL, 0.72 * BIOW, out);
            mixC(out, P.sand, (1 - smoothstep(18, 45, SHORE)) * (1 - FAR) * (1 - CLIFF), out); // a beach some tens of metres wide, however gentle the coast
            if (SHORE < 6) mixC(out, mixC(P.wet, P.sand, SHORE / 6, T1), (1 - FAR) * (1 - CLIFF * 0.7), out);
            const k = 0.9 + 0.2 * n; out[0] *= k; out[1] *= k; out[2] *= k; // meadows and woods, lighter and darker
            mixC(out, P.rockE, smoothstep(650, 1000, h) * 0.6, out);
            // snow where the photo is bright and colourless (ice, snowfields), not merely bright (desert sand)
            const mx = Math.max(BIOL[0], BIOL[1], BIOL[2]), sat = mx > 0 ? (mx - Math.min(BIOL[0], BIOL[1], BIOL[2])) / mx : 0;
            mixC(out, P.snow, Math.max(smoothstep(0.62, 0.8, lum(BIOL)) * (1 - smoothstep(0.08, 0.2, sat)) * BIOW, smoothstep(1050, 1300, h)), out);
          }
          if (!tex && h >= 0) mixC(out, CLIFF > 0 ? mixC(P.rockE, P.basalt, CLIFF, T1) : P.rockE, Math.max(smoothstep(0.28, 0.55, slope), CLIFF * smoothstep(0.1, 0.3, slope) * smoothstep(1, 5, h)), out);
          return out;
        }
        if (h < 0) {
          if (tex) mixC(P.oceanD, P.oceanS, smoothstep(-160, -8, h), out);
          else mixC(P.wet, P.seabed, smoothstep(-2, -40, h), out);
        } else if (h < 4) mixC(P.wet, P.sand, h / 4, out);
        else {
          mixC(P.grassA, P.grassB, clamp(n * 1.2 - 0.1, 0, 1), out);
          mixC(out, P.forest, smoothstep(0.1, 0.5, cont / 300) * 0.6, out);
          if (tex || h > 60) mixC(out, P.arid, smoothstep(0.55, 0.8, n + (cont - 60) / 600) * (1 - smoothstep(0.3, 0.8, al)) * 0.8, out);
          mixC(out, P.sand, 1 - smoothstep(4, 14, h), out);
          mixC(out, P.hill, smoothstep(140, 260, h), out);
          mixC(out, P.rockE, smoothstep(260, 380, h), out);
          mixC(out, P.snow, smoothstep(470, 560, h), out);
        }
        if (!tex && h >= 0) mixC(out, P.rockE, smoothstep(0.28, 0.55, slope), out);
        if (tex) mixC(out, P.ice, smoothstep(1.12, 1.2, al + n * 0.08), out);
        return out;
      }
      case 'mars': {
        mixC(p.surface, p.map, n, out);
        mixC(out, p.deep, smoothstep(0.05, 0.35, -cont / c.cont) * 0.55, out);
        mixC(out, P.marsDust, smoothstep(0.1, 0.4, cont / c.cont) * 0.5, out);
        break;
      }
      case 'venus': {
        if (tex) {
          mixC(P.venA, P.venB, n, out);
          return mixC(out, P.venC, smoothstep(0.15, 0.5, cont / c.cont), out);
        }
        mixC(p.surface, p.ground, n, out);
        mixC(out, p.deep, smoothstep(0.1, 0.4, -cont / c.cont) * 0.5, out);
        break;
      }
      case 'jupiter': {
        const w = Math.sin(lat * 11 + n * 1.6 + cont / 40) + 0.5 * Math.sin(lat * 23 + n * 2.5);
        mixC(P.jupA, P.jupB, smoothstep(-0.6, 0.6, w), out);
        mixC(out, P.jupC, smoothstep(0.9, 1.4, w) * 0.7, out);
        mixC(out, P.jupD, smoothstep(0.7, 1, Math.abs(lat)) * 0.6, out);
        return out;
      }
      case 'europa': {
        mixC(P.eurA, P.eurB, n, out);
        const line = Math.abs(cont / c.cont - 0.12 * (n - 0.5));
        mixC(out, P.linea, (1 - smoothstep(0.012, 0.035, line)) * 0.75, out);
        break;
      }
      default: {
        mixC(p.surface, p.ground, clamp(0.25 + 0.6 * n, 0, 1), out);
        mixC(out, p.deep, smoothstep(0.0, 0.3, -cont / c.cont) * 0.55, out); // dark maria
      }
    }
    if (dark > 0) mixC(out, dark > 0 ? p.deep : out, Math.min(dark, 1) * 0.55, out);
    else if (dark < 0) mixC(out, p.surface, Math.min(-dark, 1) * 0.5, out);
    if (!tex) mixC(out, p.rock, smoothstep(0.3, 0.7, slope) * 0.7, out);
    if (tex && c.b.caps) mixC(out, P.ice, smoothstep(1.2, 1.27, al + n * 0.06), out);
    return out;
  }

  // ------------------------------------------------------------------ geometry and texture helpers
  function sphereGeo(nw, nh) {
    const pos = [], nor = [], uv = [], idx = [];
    for (let j = 0; j <= nh; j++) {
      const lat = -Math.PI / 2 + (j / nh) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i <= nw; i++) {
        const lon = (i / nw) * TAU, x = cl * Math.cos(lon), y = cl * Math.sin(lon);
        pos.push(x, y, sl); nor.push(x, y, sl); uv.push(i / nw, j / nh);
      }
    }
    for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
      const a = j * (nw + 1) + i, b = a + 1, c = a + nw + 1, d = c + 1;
      if (j > 0) idx.push(a, b, d);
      if (j < nh - 1) idx.push(a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  // Merges simple geometries into one with vertex colours (static scenery, built once).
  class Batch {
    constructor() { this.p = []; this.n = []; this.c = []; this.uv = []; }
    add(geo, m, col) {
      const g = geo.index ? geo.toNonIndexed() : geo, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv;
      const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m); this.p.push(v.x, v.y, v.z);
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); this.n.push(v.x, v.y, v.z);
        this.c.push(col.r, col.g, col.b);
        this.uv.push(ua ? ua.getX(i) : 0, ua ? ua.getY(i) : 0);
      }
      if (g !== geo) g.dispose();
      geo.dispose();
      return this;
    }
    box(x, y, z, w, h, d, col, rz = 0, ry = 0) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), new THREE.Vector3(1, 1, 1));
      return this.add(new THREE.BoxGeometry(w, h, d), m, col);
    }
    // a beam between two points
    beam(a, b, t, col) {
      const d = new THREE.Vector3().subVectors(b, a), len = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
      return this.add(new THREE.BoxGeometry(t, len, t), m, col);
    }
    geo(geo, x, y, z, col, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
      return this.add(geo, m, col);
    }
    build() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      return g;
    }
  }
  const col = (hex) => new THREE.Color(hex);
  function canvasTex(w, h, draw, srgb = true, repeat = false) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    draw(g, w, h);
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    return t;
  }
  // Tileable height noise -> greyscale detail map and its normal map (ground, water ripples).
  function noiseMaps(size, cells, oct, lo, hi, bump, seed) {
    const H2 = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let v = 0, a = 0.5, f = cells;
      for (let o = 0; o < oct; o++) { v += a * vnoise2((x / size) * f, (y / size) * f, f, seed + o, f); f *= 2; a *= 0.5; }
      H2[y * size + x] = v;
    }
    const at = (x, y) => H2[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
    const map = canvasTex(size, size, (g) => {
      const im = g.createImageData(size, size);
      for (let i = 0; i < size * size; i++) { const v = Math.round(lerp(lo, hi, clamp(H2[i] * 1.3 - 0.15, 0, 1))); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
      g.putImageData(im, 0, 0);
    }, true, true);
    const nrm = canvasTex(size, size, (g) => {
      const im = g.createImageData(size, size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * bump, dy = (at(x, y - 1) - at(x, y + 1)) * bump, l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
        im.data[i] = (-dx / l * 0.5 + 0.5) * 255; im.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; im.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; im.data[i + 3] = 255;
      }
      g.putImageData(im, 0, 0);
    }, false, true);
    return { map, nrm };
  }

  // ------------------------------------------------------------------ shaders
  const LOGV = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
  const LOGF = '#include <common>\n#include <logdepthbuf_pars_fragment>\n';
  const OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>\n';
  const smat = (o) => new THREE.ShaderMaterial(Object.assign({ extensions: { fragDepth: true } }, o));
  const SKY_VS = `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const SKY_FS = `#include <common>
uniform vec3 uZen, uHor, uSunset, uGlow, uUp, uSun;
uniform float uDip, uSunsetK, uGlare, uAlpha;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float e = dot(d, uUp), el = asin(clamp(e, -1.0, 1.0)) + uDip;
  vec3 c = mix(uHor, uZen, pow(clamp(el / 1.25, 0.0, 1.0), 0.55));
  vec3 hd = d - uUp * e, hs = uSun - uUp * dot(uSun, uUp);
  float az = dot(hd, hs) / max(length(hd) * length(hs), 1e-4) * 0.5 + 0.5;
  c = mix(c, uSunset, uSunsetK * pow(az, 2.5) * (1.0 - smoothstep(-0.05, 0.55, el)));
  c *= mix(1.0, 0.55, smoothstep(0.0, -0.2, el));
  float s = max(dot(d, uSun), 0.0);
  c += uGlow * uGlare * (0.9 * pow(s, 1800.0) + 0.22 * pow(s, 90.0) + 0.1 * pow(s, 8.0));
  gl_FragColor = vec4(c, uAlpha);
  ${OUT}
}`;
  const STAR_VS = `attribute float aSize; attribute vec3 aCol;
uniform float uPx;
varying vec3 vCol;
void main() { vCol = aCol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uPx; }`;
  const STAR_FS = `uniform float uAlpha;
varying vec3 vCol;
void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float a = max(0.0, 1.0 - dot(q, q)); gl_FragColor = vec4(vCol * a * a * uAlpha, 1.0); }`;
  const BAND_FS = `uniform float uAlpha; uniform vec3 uN;
varying vec3 vDir;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
void main() {
  vec3 d = normalize(vDir);
  float b = exp(-pow(dot(d, uN), 2.0) / 0.018);
  float n = n3(d * 6.0) * 0.6 + n3(d * 15.0) * 0.3 + n3(d * 40.0) * 0.1;
  gl_FragColor = vec4(vec3(0.55, 0.6, 0.75) * b * smoothstep(0.35, 0.9, n) * uAlpha * 0.16, 1.0);
}`;
  const GLOW_VS = `${LOGV}attribute float aSize; attribute vec3 aCol;
uniform float uScale, uMin;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(uMin, aSize * uScale / max(-mv.z, 1e-3));
  vCol = aCol;
  #include <logdepthbuf_vertex>
}`;
  const GLOW_FS = `${LOGF}uniform float uAlpha;
varying vec3 vCol;
void main() {
  #include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float a = 1.0 - r2;
  gl_FragColor = vec4(vCol * a * a * uAlpha, 1.0);
  ${OUT}
}`;
  const CLOUD_MAX = 6000;
  // Cumulus puffs: camera-facing quads with a soft lumpy texture whose baked normals are lit by the Sun,
  // so a cluster of them reads as a lit, billowing volume: bright tops, grey-blue bases.
  // aC: the quad's turn, its cell in the 2x2 atlas, how high it sits in its cloud (0 base .. 1 top), opacity.
  const CLOUD_VS = `${LOGV}attribute vec4 aC;
uniform vec3 uSunV; uniform float uFogD;
varying vec2 vUv; varying vec3 vL, vV; varying float vShade, vA, vFog;
void main() {
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz), cr = cos(aC.x), sr = sin(aC.x);
  vec4 mv = c + vec4(vec2(cr * position.x - sr * position.y, sr * position.x + cr * position.y) * s, 0.0, 0.0);
  gl_Position = projectionMatrix * mv;
  vV = normalize(mv.xyz);
  vUv = vec2(mod(aC.y, 2.0), floor(aC.y / 2.0)) * 0.5 + uv * 0.5;
  vL = normalize(vec3(cr * uSunV.x + sr * uSunV.y, -sr * uSunV.x + cr * uSunV.y, uSunV.z)); // the Sun in the quad's turned frame
  vShade = aC.z;
  float d = -c.z;
  vA = aC.w * smoothstep(s * 0.3, s * 1.2, d); // right up close a puff would fill the screen: it thins out
  vFog = 1.0 - exp(-uFogD * uFogD * d * d);
  #include <logdepthbuf_vertex>
}`;
  const CLOUD_FS = `${LOGF}uniform sampler2D uMap; uniform vec3 uLit, uShadow, uFogC, uSunV;
varying vec2 vUv; varying vec3 vL, vV; varying float vShade, vA, vFog;
void main() {
  #include <logdepthbuf_fragment>
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vA;
  if (a < 0.008) discard;
  vec3 n = normalize(t.rgb * 2.0 - 1.0);
  float l = clamp(dot(n, vL) * 0.6 + 0.4, 0.0, 1.0) * mix(0.3, 1.0, vShade); // the lit side, and less light low in the cloud
  vec3 col = mix(uShadow, uLit, l);
  // looking towards the Sun the whole cloud glows a little (light scattered forwards through it)
  col += uLit * pow(max(dot(vV, uSunV), 0.0), 5.0) * 0.4;
  col = mix(col, uFogC, vFog);
  gl_FragColor = vec4(col, a);
  ${OUT}
}`;
  // Four lumpy puffs in a 2x2 atlas: alpha is the density, RGB the normal of that density seen as a height.
  function cloudAtlas() {
    const N = 128, cv = document.createElement('canvas');
    cv.width = cv.height = 2 * N;
    const g = cv.getContext('2d'), im = g.createImageData(2 * N, 2 * N), d = im.data, h = new Float32Array(N * N);
    for (let cell = 0; cell < 4; cell++) {
      const ox = (cell & 1) * N, oy = (cell >> 1) * N, lumps = [];
      for (let k = 0; k < 7; k++) lumps.push([0.5 + (hashI(cell, k, 1) - 0.5) * 0.44, 0.52 + (hashI(cell, k, 2) - 0.5) * 0.34, 0.16 + 0.13 * hashI(cell, k, 3)]);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const u = (x + 0.5) / N, v = (y + 0.5) / N;
        let m = 0;
        for (const [lx, ly, lr] of lumps) { const r = Math.hypot(u - lx, v - ly) / lr; if (r < 1) m = Math.max(m, Math.sqrt(1 - r * r) * lr * 4); }
        const n = vnoise2(u * 7, v * 7, 0, cell * 7 + 1) * 0.6 + vnoise2(u * 19, v * 19, 0, cell * 7 + 2) * 0.4;
        const wisp = vnoise2(u * 41, v * 41, 0, cell * 7 + 3); // fine noise eats into the edges
        h[y * N + x] = Math.max(0, m * (0.7 + 0.6 * n) - 0.08 - 0.22 * wisp * (1 - smoothstep(0.1, 0.6, m))) * (1 - smoothstep(0.38, 0.5, Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5))));
      }
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const H = (xx, yy) => h[clamp(yy, 0, N - 1) * N + clamp(xx, 0, N - 1)];
        const dx = (H(x + 1, y) - H(x - 1, y)) * 9, dy = (H(x, y + 1) - H(x, y - 1)) * 9; // canvas rows run down, v up
        const l = Math.hypot(dx, dy, 1), o = ((oy + y) * 2 * N + ox + x) * 4;
        d[o] = ((-dx / l) * 0.5 + 0.5) * 255; d[o + 1] = ((dy / l) * 0.5 + 0.5) * 255; d[o + 2] = ((1 / l) * 0.5 + 0.5) * 255;
        d[o + 3] = 255 * Math.pow(smoothstep(0.0, 0.55, h[y * N + x]), 1.3);
      }
    }
    g.putImageData(im, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.NoColorSpace; // normals, not colours
    return t;
  }
  const SUN_VS = `${LOGV}varying vec3 vN, vV; varying vec2 vUv;
void main() {
  vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
  const SUN_FS = `${LOGF}uniform sampler2D uMap; uniform float uK;
varying vec3 vN, vV; varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  vec3 c = texture2D(uMap, vUv).rgb * uK * (0.3 + 0.7 * pow(mu, 0.5));
  gl_FragColor = vec4(c, 1.0);
  ${OUT}
}`;
  // Atmosphere seen from outside: brightness from how far the view ray passes through the air shell.
  const ATM_VS = `${LOGV}varying vec3 vP;
void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`;
  const ATM_FS = `${LOGF}uniform vec3 uCam, uSun, uCol; uniform float uR0, uK;
varying vec3 vP;
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vP - uCam);
  vec3 q = uCam - d * dot(uCam, d);
  float b = length(q), H = 1.0 - uR0;
  float g = b > uR0 ? pow(clamp(1.0 - (b - uR0) / H, 0.0, 1.0), 2.4) : exp(-(uR0 - b) / (H * 0.55)) * 0.85 + 0.15 * smoothstep(0.0, uR0, b);
  float sl = dot(normalize(q), uSun);
  vec3 c = uCol * g * smoothstep(-0.35, 0.45, sl) + vec3(1.0, 0.45, 0.2) * g * 0.5 * (1.0 - smoothstep(0.0, 0.35, abs(sl + 0.05)));
  gl_FragColor = vec4(c * uK, 1.0);
  ${OUT}
}`;
  const PART_VS = `${LOGV}#include <fog_pars_vertex>
attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSize;
varying vec2 vUv; varying vec4 vCol; varying float vKind;
void main() {
  vUv = position.xy; vCol = iCol; vKind = iSize.y;
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  mvPosition.xy += position.xy * iSize.x;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
  const PART_FS = `${LOGF}#include <fog_pars_fragment>
varying vec2 vUv; varying vec4 vCol; varying float vKind;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = vKind > 0.5 ? smoothstep(0.6, 0.8, r) * (1.0 - smoothstep(0.86, 1.0, r)) : pow(1.0 - r * r, 1.7);
  gl_FragColor = vec4(vCol.rgb, vCol.a * a);
  ${OUT}
  #include <fog_fragment>
}`;
  const SHEATH_FS = `${LOGF}uniform float uK, uT;
varying vec3 vN, vV; varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float along = vUv.y;
  float fl = 0.85 + 0.15 * sin(uT * 37.0 + along * 20.0);
  vec3 c = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.9, 0.7), smoothstep(0.5, 1.0, along));
  gl_FragColor = vec4(c * pow(f, 1.6) * smoothstep(0.0, 0.6, along) * uK * fl * 2.5, 1.0);
  ${OUT}
}`;

  // Condensation cone around a craft near Mach 1: dense where the shock meets the hull, wispy behind.
  const VAPOR_FS = `${LOGF}uniform float uK, uT;
varying vec3 vN, vV; varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float along = vUv.y; // 0 at the nose, 1 at the rim
  float streak = 0.8 + 0.2 * sin(vUv.x * 62.83 + uT * 9.0) * sin(vUv.x * 25.13 - uT * 5.0 + along * 6.0);
  float body = smoothstep(0.08, 0.8, along) * (1.0 - smoothstep(0.9, 1.0, along));
  float a = uK * (0.32 + 0.68 * pow(f, 1.1)) * body * streak;
  gl_FragColor = vec4(vec3(0.94, 0.97, 1.0), clamp(a, 0.0, 0.8));
  ${OUT}
}`;

  // ------------------------------------------------------------------ setup
  const S = {}; // scene objects
  const tmpV = () => new THREE.Vector3();
  let V1, V2, Q1, M1, RAY, NDC, envCube, envCam, envScene, envUni, envKey = '', envTime = -9;

  function init() {
    THREE = window.THREE;
    canvas = document.getElementById('view3d');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'view3d';
      canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
      document.body.prepend(canvas);
    }
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); api.ready = false; api.failed = true; });
    V1 = tmpV(); V2 = tmpV(); Q1 = new THREE.Quaternion(); M1 = new THREE.Matrix4(); RAY = new THREE.Raycaster(); NDC = new THREE.Vector2();
    camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 5e12);
    bcam = new THREE.PerspectiveCamera(FOV, 1, 0.05, 2e4);
    spaceScene = new THREE.Scene(); spaceWorld = new THREE.Group(); spaceScene.add(spaceWorld);
    localScene = new THREE.Scene(); localWorld = new THREE.Group(); localScene.add(localWorld);
    localScene.fog = new THREE.FogExp2(0x000000, 0);
    high = Settings.high;
    initEnv();
    localScene.environment = envCube.texture;
    initSky();
    initBodies();
    initLocal();
    initTerrain();
    initSpaceCentre();
    initParticles();
    initStudio();
    if (typeof Parts3D !== 'undefined') { Parts3D.envMap = api.envMap; Parts3D.init(THREE, renderer); }
    api.ready = true;
  }

  // Image-based lighting: a small sky (or studio) cube, filtered by three into a PMREM whenever it changes.
  function initEnv() {
    envCube = new THREE.WebGLCubeRenderTarget(64, { type: renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType });
    envCam = new THREE.CubeCamera(0.1, 100, envCube);
    envScene = new THREE.Scene();
    envUni = { uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGround: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunK: { value: 0 } };
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, uniforms: envUni, vertexShader: SKY_VS,
      fragmentShader: `uniform vec3 uZen, uHor, uGround, uSun; uniform float uSunK; varying vec3 vDir;
void main() { vec3 d = normalize(vDir); float e = d.y;
  vec3 c = e > 0.0 ? mix(uHor, uZen, pow(e, 0.6)) : mix(uHor, uGround, pow(min(-e * 3.0, 1.0), 0.6));
  c += vec3(1.0, 0.95, 0.85) * uSunK * pow(max(dot(d, uSun), 0.0), 64.0);
  gl_FragColor = vec4(c, 1.0); }`,
    })));
    api.envMap = envCube.texture;
  }
  function updateEnv(zen, hor, ground, sun, sunK, key) {
    // only when the sky changed noticeably, and at most every 0.4 s
    const k = key || [zen, hor, ground].map((c) => c.getHexString()).join('') + Math.round(sunK * 4) + Math.round(sun.x * 3) + Math.round(sun.y * 3);
    if (k === envKey || (clock - envTime < 0.4 && !key)) return;
    envKey = k; envTime = clock;
    envUni.uZen.value.copy(zen); envUni.uHor.value.copy(hor); envUni.uGround.value.copy(ground); envUni.uSun.value.copy(sun); envUni.uSunK.value = sunK;
    envCam.update(renderer, envScene);
  }

  function initSky() {
    const U = S.skyU = {
      uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunset: { value: new THREE.Color('#ff8a4a') }, uGlow: { value: new THREE.Color(1, 0.93, 0.8) },
      uUp: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uDip: { value: 0 }, uSunsetK: { value: 0 }, uGlare: { value: 0 }, uAlpha: { value: 1 },
    };
    const dome = new THREE.SphereGeometry(1000, 48, 24);
    S.sky = new THREE.Mesh(dome, new THREE.ShaderMaterial({ uniforms: U, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthTest: false, depthWrite: false }));
    S.sky.renderOrder = -10; S.sky.frustumCulled = false;
    S.haze = new THREE.Mesh(dome, new THREE.ShaderMaterial({ uniforms: Object.assign({}, U, { uAlpha: { value: 0 } }), vertexShader: SKY_VS, fragmentShader: SKY_FS,
      side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true }));
    S.haze.renderOrder = 50; S.haze.frustumCulled = false;
    spaceScene.add(S.sky, S.haze);
    // stars at infinity, turning with the view; a third of them crowd a faint Milky Way band
    const rnd = mulberry32(11), n = 3000, pos = [], size = [], cl = [];
    const bn = new THREE.Vector3(0.25, 0.55, 0.8).normalize(), u = new THREE.Vector3(1, 0, 0).cross(bn).normalize(), w = bn.clone().cross(u), d = tmpV();
    for (let i = 0; i < n; i++) {
      if (i % 3 === 0) { const a = rnd() * TAU, off = (rnd() - 0.5) * 0.25; d.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a)).addScaledVector(bn, off).normalize(); }
      else { const z = rnd() * 2 - 1, a = rnd() * TAU, r = Math.sqrt(1 - z * z); d.set(r * Math.cos(a), r * Math.sin(a), z); }
      pos.push(d.x * 1e5, d.y * 1e5, d.z * 1e5);
      const m = rnd() * rnd();
      size.push(0.9 + m * 2.6);
      const c = m > 0.7 ? [1, 0.9, 0.75] : m < 0.15 ? [0.75, 0.82, 1] : [0.92, 0.95, 1];
      const k = 0.35 + 0.65 * m;
      cl.push(c[0] * k, c[1] * k, c[2] * k);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    sg.setAttribute('aCol', new THREE.Float32BufferAttribute(cl, 3));
    S.starU = { uAlpha: { value: 1 }, uPx: { value: 1 } };
    S.stars = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: S.starU, vertexShader: STAR_VS, fragmentShader: STAR_FS, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
    S.stars.renderOrder = -9; S.stars.frustumCulled = false;
    S.bandU = { uAlpha: { value: 1 }, uN: { value: bn } };
    S.band = new THREE.Mesh(new THREE.SphereGeometry(9e4, 48, 24), new THREE.ShaderMaterial({ uniforms: S.bandU, vertexShader: SKY_VS, fragmentShader: BAND_FS,
      side: THREE.BackSide, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
    S.band.renderOrder = -9.5; S.band.frustumCulled = false;
    spaceWorld.add(S.stars, S.band);
    // lights for the far layer: planets are lit by the Sun wherever the camera is
    S.sunS = new THREE.DirectionalLight(0xffffff, 3.1);
    S.ambS = new THREE.AmbientLight(0xffffff, 0.04);
    spaceScene.add(S.sunS, S.sunS.target, S.ambS);
  }

  // ------------------------------------------------------------------ planets
  const bodies = [], jobs = [];
  function initBodies() {
    const geo = sphereGeo(160, 80);
    S.sphere = geo;
    const flatN = canvasTex(2, 2, (g) => { g.fillStyle = '#8080ff'; g.fillRect(0, 0, 2, 2); }, false);
    S.flatN = flatN;
    S.glowTex = canvasTex(256, 256, (g) => {
      const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, 'rgba(255,248,225,1)'); gr.addColorStop(0.1, 'rgba(255,230,170,0.55)'); gr.addColorStop(0.35, 'rgba(255,190,110,0.16)'); gr.addColorStop(1, 'rgba(255,160,80,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    });
    for (const b of BODIES) {
      const e = { b, ready: false };
      if (b.star) {
        e.sunU = { uMap: { value: sunTexture() }, uK: { value: 7 } };
        e.mesh = new THREE.Mesh(geo, smat({ uniforms: e.sunU, vertexShader: SUN_VS, fragmentShader: SUN_FS }));
        e.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: S.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, color: new THREE.Color(2.2, 1.9, 1.5) }));
        spaceWorld.add(e.glow);
        e.ready = true;
      } else {
        const ph = canvasTex(2, 1, (g) => { g.fillStyle = b.colors.map; g.fillRect(0, 0, 2, 1); });
        e.mat = new THREE.MeshStandardMaterial({ map: ph, normalMap: flatN, roughness: 1, metalness: 0 });
        if (b.ocean) e.mat.roughnessMap = canvasTex(2, 1, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 2, 1); }, false);
        e.mesh = new THREE.Mesh(geo, e.mat);
        e.job = bodyJob(e);
        jobs.push(e.job);
      }
      e.mesh.scale.setScalar(b.radius);
      e.mesh.matrixAutoUpdate = true;
      spaceWorld.add(e.mesh);
      if (b.atmoHeight) {
        const hc = b.colors.halo.split(',').map((x) => +x);
        e.atmU = { uCam: { value: tmpV() }, uSun: { value: tmpV() }, uCol: { value: new THREE.Color().setRGB(hc[0] / 255, hc[1] / 255, hc[2] / 255, THREE.SRGBColorSpace) }, uR0: { value: 0 }, uK: { value: 1 } };
        e.atm = new THREE.Mesh(geo, smat({ uniforms: e.atmU, vertexShader: ATM_VS, fragmentShader: ATM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        e.atmR = b.radius + b.atmoHeight * 1.6;
        e.atmU.uR0.value = b.radius / e.atmR;
        e.atm.scale.setScalar(e.atmR);
        e.atm.renderOrder = 2;
        spaceWorld.add(e.atm);
      }
      if (b.clouds || b.haze) {
        // Earth: a drifting cloud layer; hazy worlds: their cloud deck (the planet map) over the surface
        e.deckAlt = b.clouds ? 5000 : b.atmoHeight * 0.75;
        e.deckMat = new THREE.MeshStandardMaterial({ map: b.clouds ? canvasTex(2, 1, (g) => { g.fillStyle = 'rgba(255,255,255,0)'; g.fillRect(0, 0, 2, 1); }) : e.mat.map,
          transparent: true, depthWrite: false, roughness: 1, metalness: 0 });
        e.deck = new THREE.Mesh(geo, e.deckMat);
        e.deck.scale.setScalar(b.radius + e.deckAlt);
        e.deck.renderOrder = 1;
        spaceWorld.add(e.deck);
        if (b.clouds) { e.cloudJob = cloudJob(e); jobs.push(e.cloudJob); }
      }
      bodies.push(e);
    }
    // far planets as dots once they shrink below a few pixels
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(BODIES.length * 3), 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(new Float32Array(BODIES.length), 1));
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(new Float32Array(BODIES.length * 3), 3));
    S.dotU = { uScale: { value: 1 }, uMin: { value: 0 }, uAlpha: { value: 1 } };
    S.dots = new THREE.Points(g, smat({ uniforms: S.dotU, vertexShader: GLOW_VS, fragmentShader: GLOW_FS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    S.dots.frustumCulled = false;
    spaceWorld.add(S.dots);
  }
  function sunTexture() {
    return canvasTex(512, 256, (g, w, h) => {
      const im = g.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const lat = Math.PI / 2 - ((y + 0.5) / h) * Math.PI, cl = Math.cos(lat);
        for (let x = 0; x < w; x++) {
          const lon = ((x + 0.5) / w) * TAU, px = cl * Math.cos(lon), py = cl * Math.sin(lon), pz = Math.sin(lat);
          const n = fbm3(px * 24, py * 24, pz * 24, 3, 5) * 0.5 + fbm3(px * 5, py * 5, pz * 5, 2, 9) * 0.5;
          const spot = smoothstep(0.28, 0.4, fbm3(px * 4 + 9, py * 4, pz * 4, 2, 21)) * (1 - smoothstep(0.2, 0.5, Math.abs(Math.abs(lat) - 0.3)));
          const k = clamp(0.85 + n * 0.5 - spot * 0.6, 0, 1.2), i = (y * w + x) * 4;
          im.data[i] = 255 * Math.min(1, k * 1.05); im.data[i + 1] = 255 * clamp(k * 0.78, 0, 1); im.data[i + 2] = 255 * clamp(k * 0.42, 0, 1); im.data[i + 3] = 255;
        }
      }
      g.putImageData(im, 0, 0);
    });
  }
  // Planet maps are painted from the same terrain field as the near-surface mesh, a few rows per frame.
  function* bodyJob(e) {
    while (e.b === EARTH && Terrain.earthMap.state === 'loading') yield; // paint the real Earth once it has loaded
    const b = e.b, c = cfgOf(b);
    const TW = (c.mapped ? 2048 : b.radius >= 50000 ? 1024 : 512) >> (Settings.high ? 0 : 1), TH = TW / 2, no = c.k.length;
    const G = grid(TW, 1, no), hs = new Float32Array(TW * TH), dk = new Float32Array(TW * TH), ns = new Float32Array(TW * TH), cs = new Float32Array(TW * TH);
    const lk = c.mapped ? new Float32Array(TW * TH) : null; // lakes
    const cell = (TAU * c.R) / TW;
    for (let i = 0; i < TW; i++) setCol(c, G, i, ((i + 0.5) / TW) * TAU, cell);
    yield;
    const SUB = c.mapped ? 1 : 4, sw = TW / SUB + 1, sub = new Float32Array(sw * 2);
    let prevRow = -1;
    const fillSub = (ry, slot) => {
      const phi = Math.PI / 2 - ((Math.min(ry * SUB, TH - 1) + 0.5) / TH) * Math.PI;
      for (let k = 0; k < sw; k++) sub[slot * sw + k] = contAt(c, ((Math.min(k * SUB, TW) + 0.5) / TW) * TAU, phi);
    };
    for (let y = 0; y < TH; y++) {
      const ry = Math.floor(y / SUB);
      if (ry !== prevRow) { fillSub(ry, 0); fillSub(ry + 1, 1); prevRow = ry; yield; }
      const ty = (y - ry * SUB) / SUB, phi = Math.PI / 2 - ((y + 0.5) / TH) * Math.PI;
      setRow(c, G, 0, phi * c.R, cell);
      for (let x = 0; x < TW; x++) {
        const kx = Math.floor(x / SUB), tx = (x - kx * SUB) / SUB;
        const cont = lerp(lerp(sub[kx], sub[kx + 1], tx), lerp(sub[sw + kx], sub[sw + kx + 1], tx), ty);
        const i = y * TW + x;
        hs[i] = height(c, G, x, 0, cont); dk[i] = Terrain.dark(); cs[i] = cont;
        if (lk) lk[i] = Terrain.water.pres;
        ns[i] = vnoise2((x / TW) * 64, (y / TH) * 32, 64, c.seed + 5) * 0.65 + vnoise2((x / TW) * 256, (y / TH) * 128, 256, c.seed + 6) * 0.35;
      }
    }
    const cv = document.createElement('canvas'); cv.width = TW; cv.height = TH;
    const nv = document.createElement('canvas'); nv.width = TW; nv.height = TH;
    const g = cv.getContext('2d'), gn = nv.getContext('2d'), im = g.createImageData(TW, TH), imn = gn.createImageData(TW, TH);
    let rv = null, imr = null, lv = null, iml = null;
    if (b.ocean) { rv = document.createElement('canvas'); rv.width = TW; rv.height = TH; imr = rv.getContext('2d').createImageData(TW, TH); }
    if (c.mapped && Terrain.earthMap.night) { lv = document.createElement('canvas'); lv.width = TW; lv.height = TH; iml = lv.getContext('2d').createImageData(TW, TH); }
    const out = [0, 0, 0], k = c.relief;
    for (let y = 0; y < TH; y++) {
      const lat = Math.PI / 2 - ((y + 0.5) / TH) * Math.PI, dxm = cell * Math.max(Math.cos(lat), 0.02), dym = (Math.PI * c.R) / TH;
      for (let x = 0; x < TW; x++) {
        const i = y * TW + x, h = hs[i];
        if (c.mapped) bioAt(((x + 0.5) / TW) * TAU, lat * c.R);
        paint(c, h, ns[i], cs[i], dk[i], 0, lat, true, out);
        if (lk && lk[i] > 0.05) mixC(out, LAKE_D, lk[i] * 0.85, out);
        if (iml) { const v = 255 * Math.pow(clamp((Terrain.nightAt(((x + 0.5) / TW) * TAU, lat * c.R) - 0.1) / 0.6, 0, 1), 1.3); iml.data[i * 4] = iml.data[i * 4 + 1] = iml.data[i * 4 + 2] = v; iml.data[i * 4 + 3] = 255; }
        im.data[i * 4] = out[0]; im.data[i * 4 + 1] = out[1]; im.data[i * 4 + 2] = out[2]; im.data[i * 4 + 3] = 255;
        const sea = b.ocean && h < 0;
        const hx = (q) => (b.ocean ? Math.max(0, q) : q);
        const gx = sea ? 0 : (hx(hs[y * TW + ((x + 1) % TW)]) - hx(hs[y * TW + ((x + TW - 1) % TW)])) / (2 * dxm) * k;
        const gy = sea ? 0 : (hx(hs[Math.max(0, y - 1) * TW + x]) - hx(hs[Math.min(TH - 1, y + 1) * TW + x])) / (2 * dym) * k;
        const l = Math.hypot(gx, gy, 1);
        imn.data[i * 4] = (-gx / l * 0.5 + 0.5) * 255; imn.data[i * 4 + 1] = (-gy / l * 0.5 + 0.5) * 255; imn.data[i * 4 + 2] = (0.5 / l + 0.5) * 255; imn.data[i * 4 + 3] = 255;
        if (imr) { const r = c.mapped ? lerp(90, 255, smoothstep(-5, 5, h)) : sea ? 90 : 255; imr.data[i * 4] = imr.data[i * 4 + 1] = imr.data[i * 4 + 2] = r; imr.data[i * 4 + 3] = 255; }
      }
      if ((y & 15) === 15) yield;
    }
    g.putImageData(im, 0, 0); gn.putImageData(imn, 0, 0);
    const old = [e.mat.map, e.mat.normalMap !== S.flatN ? e.mat.normalMap : null, e.mat.roughnessMap];
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
    e.mat.map = tex;
    e.mat.normalMap = new THREE.CanvasTexture(nv);
    if (imr) { rv.getContext('2d').putImageData(imr, 0, 0); e.mat.roughnessMap = new THREE.CanvasTexture(rv); }
    if (iml) { // city lights on the night side
      lv.getContext('2d').putImageData(iml, 0, 0);
      const nt = new THREE.CanvasTexture(lv);
      nt.colorSpace = THREE.SRGBColorSpace;
      e.mat.emissiveMap = nt; e.mat.emissive.setRGB(1, 0.78, 0.5); e.mat.emissiveIntensity = 1.3;
      e.sunV = new THREE.Vector3(1, 0, 0);
      const U = { value: e.sunV };
      e.mat.onBeforeCompile = (sh) => {
        sh.uniforms.uSunV = U;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uSunV;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= smoothstep(0.06, -0.2, dot(normal, uSunV));');
      };
      e.mat.needsUpdate = true;
    }
    if (e.deckMat && !b.clouds) e.deckMat.map = tex;
    for (const t of old) if (t && t !== e.mat.map && t !== e.mat.roughnessMap) t.dispose();
    e.ready = true;
  }
  function* cloudJob(e) {
    const TW = Settings.high ? 1024 : 512, TH = TW / 2, cv = document.createElement('canvas');
    cv.width = TW; cv.height = TH;
    const g = cv.getContext('2d'), im = g.createImageData(TW, TH);
    for (let y = 0; y < TH; y++) {
      const lat = Math.PI / 2 - ((y + 0.5) / TH) * Math.PI, cl = Math.cos(lat), band = 0.12 * Math.cos(lat * 6) - 0.05;
      for (let x = 0; x < TW; x++) {
        const lon = ((x + 0.5) / TW) * TAU, px = cl * Math.cos(lon), py = cl * Math.sin(lon), pz = Math.sin(lat);
        const n = fbm3(px * 5 + 3, py * 5, pz * 9, 5, 77) + band + 0.08 * fbm3(px * 30, py * 30, pz * 30, 2, 78);
        const a = smoothstep(0.02, 0.32, n), i = (y * TW + x) * 4;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = 255 - 30 * (1 - a); im.data[i + 3] = 235 * a;
      }
      if ((y & 7) === 7) yield;
    }
    g.putImageData(im, 0, 0);
    const old = e.deckMat.map, t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    e.deckMat.map = t;
    old.dispose();
  }
  function runJobs(ms) {
    const t0 = performance.now();
    while (jobs.length && performance.now() - t0 < ms) if (jobs[0].next().done) jobs.shift();
  }
  function finishJob(j) {
    const i = jobs.indexOf(j);
    if (i < 0) return;
    while (!j.next().done);
    jobs.splice(i, 1);
  }

  // ------------------------------------------------------------------ the local layer: lights, terrain, scenery
  function initLocal() {
    S.sun = new THREE.DirectionalLight(0xffffff, 3);
    S.sun.castShadow = Settings.high;
    S.sun.shadow.mapSize.set(2048, 2048);
    S.sun.shadow.bias = -0.0004; S.sun.shadow.normalBias = 0.03;
    S.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    S.engine = new THREE.PointLight(0xff9a4a, 0, 80, 2);
    localScene.add(S.sun, S.sun.target, S.hemi);
    localWorld.add(S.engine);
    // reentry plasma: a glowing, stretched shell around the leading end
    const sg = new THREE.SphereGeometry(1, 24, 16, 0, TAU, 0, Math.PI);
    S.sheathU = { uK: { value: 0 }, uT: { value: 0 } };
    S.sheath = new THREE.Mesh(sg, smat({ uniforms: S.sheathU, vertexShader: SUN_VS, fragmentShader: SHEATH_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    S.sheath.visible = false;
    localWorld.add(S.sheath);
    // the sound-barrier vapour cone: a bell, nose forwards (+y), open towards the tail
    S.vaporU = { uK: { value: 0 }, uT: { value: 0 } };
    const bell = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; bell.push(new THREE.Vector2(0.02 + 0.98 * Math.pow(t, 0.55), 0.5 - t)); } // nose to rim
    S.vapor = new THREE.Mesh(new THREE.LatheGeometry(bell, 48), smat({ uniforms: S.vaporU, vertexShader: SUN_VS, fragmentShader: VAPOR_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    S.vapor.visible = false; S.vapor.renderOrder = 4; S.vaporK = 0;
    localWorld.add(S.vapor);
    // glowing point lights (runway edge lights, beacons)
    S.glowU = { uScale: { value: 1 }, uMin: { value: 1.5 }, uAlpha: { value: 0 } };
    S.blinkU = { uScale: S.glowU.uScale, uMin: { value: 2 }, uAlpha: { value: 0 } };
  }

  // The terrain patch on show, and a second one built behind it a few milliseconds a frame (patchJob) and
  // swapped in when it is ready, so moving fast never stalls a frame for a whole rebuild. terr: what they share.
  const terr = {};
  let patch = {}, patchB = {}, pjob = null, pjobMs = 0, pjobSlice = 0;
  function initTerrain() {
    const det = noiseMaps(256, 24, 4, 208, 255, 6, 3);
    const rip = noiseMaps(256, 16, 3, 255, 255, 3.5, 9);
    rip.nrm.repeat.set(1, 1);
    S.waterN = rip.nrm;
    terr.mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: det.map, normalMap: det.nrm, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.95, metalness: 0 });
    // cities glow at night: aNight (per vertex) times uNight (how dark it is)
    terr.nightU = { value: 0 };
    terr.mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = terr.nightU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aNight;\nvarying float vNight;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvNight = aNight;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.66, 0.32) * vNight * uNight;');
    };
    terr.oceanMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.08, metalness: 0.1, normalMap: rip.nrm, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.2 });
    for (const P of [patch, patchB]) { P.frame = new THREE.Group(); P.frame.visible = false; localWorld.add(P.frame); }
    allocPatch();
    // scenery: trees (Earth) and rocks, placed per grid cell around the craft
    const tr = new Batch(), trunk = col('#5a4130'), leaf = col('#ffffff');
    tr.geo(new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6), 0, 1.2, 0, trunk);
    tr.geo(new THREE.ConeGeometry(2, 4.2, 8), 0, 3.6, 0, leaf).geo(new THREE.ConeGeometry(1.55, 3.6, 8), 0, 5.6, 0, leaf).geo(new THREE.ConeGeometry(1, 3, 8), 0, 7.4, 0, leaf);
    const br = new Batch();
    br.geo(new THREE.CylinderGeometry(0.22, 0.36, 3.4, 6), 0, 1.7, 0, trunk);
    br.geo(new THREE.IcosahedronGeometry(2.4, 1), 0, 4.8, 0, leaf, 0, 0, 0, 1, 0.85, 1).geo(new THREE.IcosahedronGeometry(1.7, 1), 1.1, 5.9, 0.4, leaf).geo(new THREE.IcosahedronGeometry(1.6, 1), -0.9, 5.6, -0.7, leaf);
    const smat2 = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
    const rock = new THREE.IcosahedronGeometry(1, 1), rp = rock.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      V1.fromBufferAttribute(rp, i);
      const k = 0.75 + 0.5 * hashI(Math.round(V1.x * 100), Math.round(V1.y * 100) + Math.round(V1.z * 1e4), 3);
      rp.setXYZ(i, V1.x * k, V1.y * k * 0.7, V1.z * k);
    }
    rock.computeVertexNormals();
    // far trees: one low-poly crown each (a few pixels tall out there; the detailed ones cost ~10x more)
    const trF = new Batch().geo(new THREE.ConeGeometry(2.1, 7.6, 6), 0, 4.6, 0, leaf);
    const brF = new Batch().geo(new THREE.IcosahedronGeometry(2.7, 0), 0, 5, 0, leaf, 0, 0, 0, 1, 0.9, 1);
    const inst = (g) => { const m = new THREE.InstancedMesh(g, smat2, 7000); m.count = 0; m.frustumCulled = false; return m; };
    const gTrees = [tr.build(), br.build()], gFar = [trF.build(), brF.build()];
    const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, flatShading: true });
    // villages (walls and roofs) and boats at sea, on Earth
    const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
    const pyr = new THREE.ConeGeometry(0.75, 1, 4); pyr.rotateY(Math.PI / 4); pyr.translate(0, 0.5, 0);
    // half the sky light: shaded walls lit by the blue sky alone turned whole cities blue
    const hmat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, envMapIntensity: 0.5 });
    const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, flatShading: true, envMapIntensity: 0.6 });
    const boatG = boatGeo(), boatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
    S.cityU = { uScale: { value: 1 }, uMin: { value: 1.6 }, uAlpha: { value: 0 } };
    const lightMat = smat({ uniforms: S.cityU, vertexShader: GLOW_VS, fragmentShader: GLOW_FS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    // two sets, like the terrain: the scenery on show and the next one, filled a slice a frame (sceneryJob)
    const mkSet = () => {
      const set = { trees: gTrees.map(inst), treesFar: gFar.map(inst), frame: new THREE.Group(), b: null, a0: 0, z0: 0, rad: 0 };
      set.rocks = new THREE.InstancedMesh(rock, rockMat, 5000);
      set.rocks.count = 0; set.rocks.frustumCulled = false; set.rocks.receiveShadow = true;
      set.walls = new THREE.InstancedMesh(unit, hmat, 7000); set.roofs = new THREE.InstancedMesh(pyr, roofMat, 7000);
      set.boats = new THREE.InstancedMesh(boatG, boatMat, 200);
      for (const m of [set.walls, set.roofs, set.boats]) { m.count = 0; m.frustumCulled = false; m.castShadow = m.receiveShadow = true; }
      // city lights: a glowing point on many buildings at night
      const cg = new THREE.BufferGeometry(), CL = 7000;
      cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CL * 3), 3).setUsage(THREE.DynamicDrawUsage));
      cg.setAttribute('aCol', new THREE.BufferAttribute(new Float32Array(CL * 3), 3).setUsage(THREE.DynamicDrawUsage));
      cg.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(CL), 1).setUsage(THREE.DynamicDrawUsage));
      cg.setDrawRange(0, 0);
      set.cityLights = new THREE.Points(cg, lightMat);
      set.cityLights.frustumCulled = false;
      set.frame.add(set.trees[0], set.trees[1], set.treesFar[0], set.treesFar[1], set.rocks, set.walls, set.roofs, set.boats, set.cityLights);
      set.frame.visible = false;
      localWorld.add(set.frame);
      return set;
    };
    S.scen = [mkSet(), mkSet()];
    S.scenery = { dirty: true, job: null, ms: 0, slice: 0 };
    // cumulus puffs
    S.cloudU = { uMap: { value: cloudAtlas() }, uSunV: { value: new THREE.Vector3(0, 1, 0) }, uLit: { value: new THREE.Color() }, uShadow: { value: new THREE.Color() },
      uFogC: { value: new THREE.Color() }, uFogD: { value: 0 } };
    S.puffs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), smat({ uniforms: S.cloudU, vertexShader: CLOUD_VS, fragmentShader: CLOUD_FS, transparent: true, depthWrite: false }), CLOUD_MAX);
    S.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    S.puffAttr = new THREE.InstancedBufferAttribute(new Float32Array(CLOUD_MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    S.puffs.geometry.setAttribute('aC', S.puffAttr);
    S.puffs.count = 0; S.puffs.frustumCulled = false; S.puffs.renderOrder = 3;
    S.cloudFrame = new THREE.Group();
    S.cloudFrame.add(S.puffs);
    localWorld.add(S.cloudFrame);
    S.cloudFogC = new THREE.Color();
    S.clouds = { a0: null, b: null, list: null, n: 0, vols: [], job: null, sortAt: -9, inside: 0 };
  }
  function allocPatch() {
    pjob = null;
    allocSlot(patch); allocSlot(patchB);
  }
  function allocSlot(patch) {
    const n = Settings.high ? 96 : 64, m = Settings.high ? 56 : 36, nc = 2 * n + 1, nr = 2 * m + 1, N = nc * nr;
    if (patch.nc === nc && patch.nr === nr) return;
    if (patch.mesh) { patch.frame.remove(patch.mesh, patch.ocean, patch.inland); patch.mesh.geometry.dispose(); patch.ocean.geometry.dispose(); patch.inland.geometry.dispose(); }
    Object.assign(patch, {
      n, m, nc, nr, sx: new Float64Array(nc), sz: new Float64Array(nr), h: new Float32Array(N), dk: new Float32Array(N), cont: new Float32Array(N), tn: new Float32Array(N),
      wl: new Float32Array(N), wp: new Float32Array(N), lk: new Float32Array(N), road: new Float32Array(N), river: new Float32Array(N), // inland water, roads, rivers (the real Earth)
      G: null, b: null, a0: 0, span: 0, at: -9, active: false,
    });
    const idx = new Uint16Array((nc - 1) * (nr - 1) * 6);
    let k = 0;
    for (let j = 0; j < nr - 1; j++) for (let i = 0; i < nc - 1; i++) {
      const a = j * nc + i, b = a + 1, c = a + nc, d = c + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = c; idx[k++] = b; idx[k++] = d; idx[k++] = c;
    }
    const mk = (cols) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * cols), cols).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
      return g;
    };
    const tg = mk(3);
    tg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(N * 2), 2).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('aNight', new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage)); // city lights
    patch.mesh = new THREE.Mesh(tg, terr.mat);
    patch.mesh.receiveShadow = true;
    patch.ocean = new THREE.Mesh(mk(4), terr.oceanMat);
    patch.ocean.receiveShadow = false; // shadows fall on the sea floor, seen through the water
    patch.ocean.renderOrder = 1;
    // lakes and rivers: their own water surface, at their own level
    patch.inland = new THREE.Mesh(mk(4), terr.oceanMat);
    patch.inland.renderOrder = 1;
    patch.inland.visible = false;
    patch.frame.add(patch.mesh, patch.ocean, patch.inland);
    patch.frame.visible = false;
  }
  const cellOf = (a, i) => (a[Math.min(i + 1, a.length - 1)] - a[Math.max(i - 1, 0)]) / 2;
  // What the heavy rebuilds cost (ms: last, worst, count), for Render3D.info().
  const costs = {};
  const note = (name, dt) => { const c = costs[name] || (costs[name] = { last: 0, max: 0, n: 0 }); c.last = +dt.toFixed(1); c.max = Math.max(c.max, c.last); c.n++; };
  const timed = (name, fn) => function (...args) {
    const t0 = performance.now(), r = fn.apply(this, args);
    note(name, performance.now() - t0);
    return r;
  };
  // Fill a patch slot centred on (a0, z0), yielding every row or so (patchJob runs it a slice a frame).
  function* patchJob(patch, b, a0, z0, span) {
    patch.ready = false;
    const c = cfgOf(b), R = c.R, no = c.k.length, { nc, nr, n, m, sx, sz } = patch, kl = latK(z0, R);
    if (!patch.G || patch.G.no !== no) { patch.G = grid(nc, nr, no); patch.G.no = no; }
    const G = patch.G, hs = patch.h, dk = patch.dk, cn = patch.cont;
    for (let i = 0; i < nc; i++) { const u = (i - n) / n; sx[i] = Math.sign(u) * Math.pow(Math.abs(u), PW) * span; }
    for (let j = 0; j < nr; j++) { const u = (j - m) / m; sz[j] = Math.sign(u) * Math.pow(Math.abs(u), PW) * span; }
    for (let i = 0; i < nc; i++) setCol(c, G, i, a0 + sx[i] / (R * kl), cellOf(sx, i));
    for (let j = 0; j < nr; j++) setRow(c, G, j, z0 + sz[j], cellOf(sz, j));
    // continents vary slowly: sample every 4th vertex and interpolate
    const ST = c.mapped ? 1 : 4, ci = [], cj = [];
    for (let i = 0; i < nc; i += ST) ci.push(i);
    if (ci[ci.length - 1] !== nc - 1) ci.push(nc - 1);
    for (let j = 0; j < nr; j += ST) cj.push(j);
    if (cj[cj.length - 1] !== nr - 1) cj.push(nr - 1);
    const sub = new Float32Array(ci.length * cj.length);
    for (let q = 0; q < cj.length; q++) {
      for (let p = 0; p < ci.length; p++) sub[q * ci.length + p] = contAt(c, G.ang[ci[p]], G.phi[cj[q]]);
      if ((q & 7) === 7) yield;
    }
    for (let q = 0; q < cj.length - 1; q++) for (let j = cj[q]; j <= cj[q + 1]; j++) {
      const ty = (j - cj[q]) / (cj[q + 1] - cj[q]);
      for (let p = 0; p < ci.length - 1; p++) for (let i = ci[p]; i <= ci[p + 1]; i++) {
        const tx = (i - ci[p]) / (ci[p + 1] - ci[p]), L = ci.length;
        cn[j * nc + i] = lerp(lerp(sub[q * L + p], sub[q * L + p + 1], tx), lerp(sub[(q + 1) * L + p], sub[(q + 1) * L + p + 1], tx), ty);
      }
    }
    const EW = Terrain.water, wl = patch.wl, wp = patch.wp, lk = patch.lk, rdw = patch.road, rvw = patch.river;
    for (let j = 0; j < nr; j++) {
      for (let i = 0; i < nc; i++) {
        const k = j * nc + i;
        hs[k] = height(c, G, i, j, cn[k]); dk[k] = Terrain.dark();
        if (c.mapped) { wl[k] = EW.level; wp[k] = EW.pres; lk[k] = EW.lake; rdw[k] = EW.road; rvw[k] = EW.river; }
      }
      yield;
    }
    // positions in the frame at a0 (origin on the sea-level sphere, x east, y up, z depth)
    const pos = patch.mesh.geometry.attributes.position.array, nor = patch.mesh.geometry.attributes.normal.array;
    const uv = patch.mesh.geometry.attributes.uv.array, colr = patch.mesh.geometry.attributes.color.array;
    const sd = new Float64Array(nc), cd = new Float64Array(nc);
    for (let i = 0; i < nc; i++) { sd[i] = Math.sin(sx[i] / (R * kl)); cd[i] = Math.cos(sx[i] / (R * kl)); }
    let al0 = (a0 % TAU) * R * kl;
    if (al0 < 0) al0 += TAU * R * kl;
    const uo = al0 % TILE, vo = z0 % TILE;
    for (let j = 0; j < nr; j++) {
      const cp = Math.cos(G.phi[j]), sp = Math.sin(G.phi[j]);
      for (let i = 0; i < nc; i++) {
        const k = j * nc + i, r = R + hs[k];
        pos[k * 3] = -r * cp * sd[i]; pos[k * 3 + 1] = r * cp * cd[i] - R; pos[k * 3 + 2] = r * sp;
        uv[k * 2] = (sx[i] + uo) / TILE; uv[k * 2 + 1] = (sz[j] + vo) / TILE;
      }
    }
    const out = [0, 0, 0], tn = patch.tn, nightA = patch.mesh.geometry.attributes.aNight.array;
    for (let jk = 0; jk < nr * nc; jk++) {
      const j = (jk / nc) | 0, i = jk - j * nc;
      const k = j * nc + i, i0 = i > 0 ? k - 1 : k, i1 = i < nc - 1 ? k + 1 : k, j0 = j > 0 ? k - nc : k, j1 = j < nr - 1 ? k + nc : k;
      const ax = pos[i1 * 3] - pos[i0 * 3], ay = pos[i1 * 3 + 1] - pos[i0 * 3 + 1], az = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
      const bx = pos[j1 * 3] - pos[j0 * 3], by = pos[j1 * 3 + 1] - pos[j0 * 3 + 1], bz = pos[j1 * 3 + 2] - pos[j0 * 3 + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      // slope against the local vertical
      const cp = Math.cos(G.phi[j]), ux = -cp * sd[i], uy = cp * cd[i], uz = Math.sin(G.phi[j]);
      const cu = nx * ux + ny * uy + nz * uz, slope = 1 - cu, tan = Math.max(0.004, Math.sqrt(Math.max(0, 1 - cu * cu)) / Math.max(cu, 0.1));
      tn[k] = tan;
      SHORE = Math.max(0, hs[k]) / tan;
      // each octave fades to its mean once the cells outgrow it (aliased noise smears into blotches far off)
      const cl = Math.max(G.dx[i], G.dz[j]), f90 = 1 - smoothstep(35, 110, cl), f23 = 1 - smoothstep(9, 28, cl);
      const nn = lerp(0.5, vnoise2(G.al[i] / 90, sz[j] / 90, 0, c.seed + 3), f90) * 0.7 + lerp(0.5, vnoise2(G.al[i] / 23, sz[j] / 23, 0, c.seed + 4), f23) * 0.3;
      if (c.mapped) { bioAt(G.ang[i], G.z[j]); FAR = smoothstep(60, 400, Math.max(G.dx[i], G.dz[j])); CLIFF = Terrain.cliffAt(G.ang[i], G.z[j]); }
      paint(c, hs[k], nn, cn[k], dk[k], slope * 3, G.phi[j], false, out);
      CLIFF = 0;
      nightA[k] = 0;
      if (c.mapped && hs[k] >= 0) {
        const cell = Math.max(G.dx[i], G.dz[j]), X = G.al[i], Z = G.z[j], u = Terrain.urbanAt(G.ang[i], Z);
        // farmland: a patchwork of fields on gentle, green-to-dry lowland, in some regions and not others
        const bl = lum(BIOL), farm = BIOW * smoothstep(0.17, 0.24, bl) * (1 - smoothstep(0.42, 0.52, bl)) * (1 - smoothstep(0.08, 0.2, slope)) * smoothstep(3, 8, hs[k]) * (1 - smoothstep(350, 650, hs[k]))
          * smoothstep(0.42, 0.6, vnoise2(X / 2600, Z / 2600, 0, c.seed + 90)) * (1 - FAR) * (1 - smoothstep(0.15, 0.4, u));
        if (farm > 0.01) {
          const th = 0.5 + 1.2 * vnoise2(X / 9000, Z / 9000, 0, c.seed + 91), ct = Math.cos(th), st = Math.sin(th), fx = X * ct - Z * st, fz = X * st + Z * ct;
          const cx = Math.floor(fx / 150), cz = Math.floor(fz / 95), hsh = hashI(cx, cz, 92), edge = Math.min(fx - cx * 150, (cx + 1) * 150 - fx, fz - cz * 95, (cz + 1) * 95 - fz);
          const fc = mixC(FIELDS[Math.floor(hsh * FIELDS.length)], FIELD_AVG, smoothstep(30, 100, cell), T1); // far off, the fields' average
          const hedge = edge < 2.5 ? 1 - smoothstep(3, 10, cell) : 0; // hedges are thinner than a coarse cell: fade, don't alias
          mixC(out, fc, farm * 0.6, out);
          if (hedge > 0) mixC(out, HEDGE, farm * 0.75 * hedge, out);
        }
        // built-up land: blocks of grey with darker streets
        if (u > 0.12) {
          // on cells too coarse for 64 m blocks, their average: a vertex that happens to fall on a street would
          // otherwise paint a whole row or column of the grid as asphalt (long dark streaks)
          const bx = Math.floor(X / 64), bz = Math.floor(Z / 64), street = Math.min(X - bx * 64, (bx + 1) * 64 - X, Z - bz * 64, (bz + 1) * 64 - Z) < 6;
          const fine = 1 - smoothstep(10, 28, cell), sh = 0.96 + (0.28 * hashI(bx, bz, 93) - 0.14) * fine, park = !street && hashI(bx, bz, 94) < 0.22 && fine > 0.5;
          T2[0] = URBAN[0] * sh; T2[1] = URBAN[1] * sh; T2[2] = URBAN[2] * sh;
          if (!park) mixC(T2, ASPHALT, fine * (street ? 1 : 0) + (1 - fine) * 0.17, T2);
          if (!park) mixC(out, T2, smoothstep(0.12, 0.55, u) * 0.7, out);
        }
        if (rvw[k] > 0) mixC(out, P.wet, rvw[k] * 0.5, out);          // river banks
        if (wp[k] > 0.05 && cell > 90) mixC(out, LAKE_D, wp[k] * smoothstep(90, 160, cell) * smoothstep(0, 2, wl[k] - hs[k]), out); // far water, painted on
        if (rdw[k] > 0) mixC(out, ASPHALT, rdw[k], out);              // roads
        nightA[k] = clamp(Math.max(0, Terrain.nightAt(G.ang[i], Z) - 0.08) * 1.2 + u * 0.1 + rdw[k] * 0.1, 0, 1) * (0.15 + 0.85 * smoothstep(30, 400, cell));
      }
      if (b === EARTH && hs[k] > 6 && G.ea[i] > 560 && G.ea[i] < EARTH.causeway.shore - 1000) { // concrete shoulders along the runway and causeway
        const w = G.half[i];
        mixC(out, P.concrete, (1 - smoothstep(w - 4, w + 3, Math.abs(G.z[j]))) * 0.85 * (1 - smoothstep(30, 120, Math.max(G.dx[i], G.dz[j]))), out);
      }
      colr[k * 3] = lin(out[0]); colr[k * 3 + 1] = lin(out[1]); colr[k * 3 + 2] = lin(out[2]);
      if (i === nc - 1) yield;
    }
    const tg = patch.mesh.geometry;
    for (const a of ['position', 'normal', 'uv', 'color', 'aNight']) tg.attributes[a].needsUpdate = true;
    // the frame sits on the equator at a0; away from it the patch lies far off its origin, so centre the
    // culling sphere on the patch's middle vertex or the whole ground gets culled at high latitudes
    const mid = (patch.m * nc + patch.n) * 3;
    for (const g of [tg, patch.ocean.geometry, patch.inland.geometry]) g.boundingSphere.center.set(pos[mid], pos[mid + 1], pos[mid + 2]);
    tg.boundingSphere.radius = span * 1.6 + c.hmax;
    patch.ocean.visible = !!b.ocean;
    if (b.ocean) {
      const og = patch.ocean.geometry, op = og.attributes.position.array, on = og.attributes.normal.array, oc = og.attributes.color.array;
      const deep = C('#0f3d6e'), shal = C('#2b8bb8');
      for (let j = 0; j < nr; j++) {
        const cp = Math.cos(G.phi[j]), sp = Math.sin(G.phi[j]);
        for (let i = 0; i < nc; i++) {
          const k = j * nc + i, ux = -cp * sd[i], uy = cp * cd[i];
          op[k * 3] = R * ux; op[k * 3 + 1] = R * uy - R; op[k * 3 + 2] = R * sp;
          on[k * 3] = ux; on[k * 3 + 1] = uy; on[k * 3 + 2] = sp;
          const far = b === EARTH ? smoothstep(60, 400, Math.max(G.dx[i], G.dz[j])) : 0, t = Math.max(smoothstep(0, 30, -hs[k]), far);
          mixC(shal, deep, t, out);
          const foam = (1 - smoothstep(3, 16, Math.max(0, -hs[k]) / tn[k])) * (1 - smoothstep(0.2, 1.2, hs[k])) * (1 - far) * 0.85; // surf at the waterline
          if (foam > 0) mixC(out, FOAM, foam, out);
          oc[k * 4] = lin(out[0]); oc[k * 4 + 1] = lin(out[1]); oc[k * 4 + 2] = lin(out[2]); oc[k * 4 + 3] = Math.max(0.6 + 0.34 * t, foam);
        }
        if ((j & 7) === 7) yield;
      }
      for (const a of ['position', 'normal', 'color']) og.attributes[a].needsUpdate = true;
      og.boundingSphere.radius = span * 1.6;
    }
    // lakes and rivers: a water surface at their own level where there is water, tucked under the ground elsewhere
    let inland = false;
    if (c.mapped) {
      const ig = patch.inland.geometry, ip = ig.attributes.position.array, inr = ig.attributes.normal.array, ic = ig.attributes.color.array;
      for (let j = 0; j < nr; j++) {
        const cp = Math.cos(G.phi[j]), sp = Math.sin(G.phi[j]);
        for (let i = 0; i < nc; i++) {
          // rivers only where the cells can follow them (their level is the centre line's); lakes are flat, so everywhere
          const fine = Math.max(G.dx[i], G.dz[j]) < 160, k = j * nc + i, ux = -cp * sd[i], uy = cp * cd[i], on = wp[k] > 0.01 && (fine || lk[k] > 0.5);
          let lv = on ? wl[k] : NaN;
          if (!on) for (const q of [k - 1, k + 1, k - nc, k + nc]) if (q >= 0 && q < wp.length && wp[q] > 0.01 && (fine || lk[q] > 0.5) && !(wl[q] <= lv)) lv = wl[q];
          const r = R + (lv === lv ? lv : hs[k] - 6);
          if (on) inland = true;
          ip[k * 3] = r * ux; ip[k * 3 + 1] = r * uy - R; ip[k * 3 + 2] = r * sp;
          inr[k * 3] = ux; inr[k * 3 + 1] = uy; inr[k * 3 + 2] = sp;
          const t = smoothstep(0, 14, (lv === lv ? lv : 0) - hs[k]);
          mixC(LAKE_S, LAKE_D, t, out);
          ic[k * 4] = lin(out[0]); ic[k * 4 + 1] = lin(out[1]); ic[k * 4 + 2] = lin(out[2]); ic[k * 4 + 3] = on ? wp[k] * (0.55 + 0.37 * t) * smoothstep(0.1, 1.2, wl[k] - hs[k]) : 0;
        }
        if ((j & 7) === 7) yield;
      }
      for (const a of ['position', 'normal', 'color']) ig.attributes[a].needsUpdate = true;
      ig.boundingSphere.radius = span * 1.6 + c.hmax;
    }
    patch.inland.visible = inland;
    Object.assign(patch, { b, a0, z0, kl, span, at: clock, ready: true });
  }
  // Swap the freshly built patch in (the scenery is placed on the patch on show, so it follows).
  function swapPatch() {
    const old = patch;
    patch = patchB; patchB = old;
    old.frame.visible = false;
    S.scenery.dirty = true;
  }
  // A whole patch at once, when there is nothing usable on show (another body, a jump across the map).
  function buildPatchNow(b, a0, z0, span) {
    pjob = null;
    const job = patchJob(patchB, b, a0, z0, span);
    while (!job.next().done);
    swapPatch();
  }
  // Height of the rendered terrain mesh (what the eye sees), or null outside it.
  function bsearch(a, v) {
    let lo = 0, hi = a.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a[mid] <= v) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function meshHeight(b, a, zz) {
    if (!patch.b || patch.b !== b) return null;
    const s = wrapAngle(a - patch.a0) * b.radius * patch.kl, sx = patch.sx, sz = patch.sz, z = zz - patch.z0;
    if (Math.abs(s) >= patch.span * 0.999 || Math.abs(z) >= patch.span * 0.999) return null;
    const i = bsearch(sx, s), j = bsearch(sz, z), nc = patch.nc;
    const tx = (s - sx[i]) / (sx[i + 1] - sx[i]), tz = (z - sz[j]) / (sz[j + 1] - sz[j]), h = patch.h, k = j * nc + i;
    return lerp(lerp(h[k], h[k + 1], tx), lerp(h[k + nc], h[k + nc + 1], tx), tz);
  }
  function groundAt(b, a, z) {
    if (b.star) return 0;
    let h = meshHeight(b, a, z);
    if (h == null) h = h3dAt(cfgOf(b), a, z);
    return b.ocean ? Math.max(h, 0) : h;
  }
  // Distance from the edge of the track (where the ground is the 2D profile).
  function offTrack(b, a, z) { return Math.abs(z) - (b === EARTH ? trackHalf(-wrapAngle(a - EARTH.padAngle) * b.radius) : 25); }
  // Built ground at one point.
  function builtAt(b, a, z) {
    const e = b === EARTH ? -wrapAngle(a - EARTH.padAngle) * b.radius : 1e9;
    const half = b === EARTH ? trackHalf(e) : 25, bl = b === EARTH ? trackBlend(e) : 150;
    let B = 1 - smoothstep(half, half + bl, Math.abs(z));
    if (b === EARTH && e > 0 && e < 2000) B = Math.max(B, apronW(e, z));
    return B;
  }

  // Grid offsets within n cells, nearest first (cached per n).
  const spirals = new Map();
  function spiral(n) {
    let s = spirals.get(n);
    if (s) return s;
    s = [];
    for (let q = -n; q <= n; q++) for (let p = -n; p <= n; p++) if (p * p + q * q <= n * n) s.push([p, q]);
    s.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
    spirals.set(n, s);
    return s;
  }
  // Trees and rocks within a few hundred metres to a few km, seated on the rendered terrain.
  // Fills a scenery set, yielding every couple of hundred plots (sceneryJob runs it a slice a frame).
  function* sceneryJob(set, b, a0, z0, rad) {
    const R = b.radius, c = cfgOf(b), hi = Settings.high, nearR = hi ? 380 : 260;
    let nt = [0, 0], nf = [0, 0], nr = 0, work = 0;
    const place = (mesh, idx, a, z, h, sXZ, sY, yaw, color, sZ = sXZ) => {
      const d = (a - a0), cp = Math.cos(z / R), sp = Math.sin(z / R), r = R + h;
      V1.set(-r * cp * Math.sin(d), r * cp * Math.cos(d) - R, r * sp);
      V2.set(-cp * Math.sin(d), cp * Math.cos(d), sp);
      Q1.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, V2);
      M1.makeRotationY(yaw); M1.premultiply(new THREE.Matrix4().makeRotationFromQuaternion(Q1));
      M1.scale(V2.set(sXZ, sY, sZ)); M1.setPosition(V1);
      mesh.setMatrixAt(idx, M1);
      if (color) mesh.setColorAt(idx, color);
    };
    const tmpC = new THREE.Color(), rockC = C(b.colors.rock || b.colors.deep || '#666');
    // on the real Earth: is (a, z) on a road, a river, a lake or in town? (pad: extra metres of clearance)
    const offFeature = (a, z, pad, town) => {
      if (Terrain.lakeAt(a, z) > 0.2 || (!town && Terrain.urbanAt(a, z) > 0.35)) return true;
      const g = Terrain.toGeo(a, z / R), q = Terrain.lineQuery(g.lon * Terrain.DEG, g.lat * Terrain.DEG);
      return q.wd < q.ww / 2 + pad || q.rd < q.rw / 2 + pad;
    };
    // a point in the scenery frame (as place() puts things)
    const framePos = (a, z, h, o) => { const d = a - a0, cp = Math.cos(z / R), r = R + h; return o.set(-r * cp * Math.sin(d), r * cp * Math.cos(d) - R, r * Math.sin(z / R)); };
    if (b.trees) {
      const cell = hi ? 22 : 34, max = hi ? 7000 : 2400, n = Math.ceil(rad / cell);
      const ia = Math.floor((a0 * R) / cell), iq = Math.floor(z0 / cell), kl = latK(z0, R);
      for (let q = iq - n; q <= iq + n && nt[0] + nt[1] + nf[0] + nf[1] < max * 2; q++) for (let p = -n; p <= n; p++) {
        if ((++work & 255) === 0) yield;
        const ix = ia + p, h0 = hashI(ix, q, 41);
        if (h0 > 0.6) continue;
        const along = (ix + 0.2 + 0.6 * hashI(ix, q, 42)) * cell, z = (q + 0.2 + 0.6 * hashI(ix, q, 43)) * cell;
        const dd = Math.hypot((along - a0 * R) * kl, z - z0);
        if (dd > rad) continue;
        const a = along / R, veg = c.mapped ? vegOf(bioAt(a, z)) : 1, forest = vnoise2(along / 420, z / 420, 0, 44) * (0.35 + 0.75 * veg) - (c.mapped ? 0.25 * (1 - veg) : 0);
        if (h0 > forest * 0.9 - 0.05) continue;
        if (offTrack(b, a, z) < 8 || (builtAt(b, a, z) > 0.3 && clearZone(b, a))) continue;
        if (c.mapped && Terrain.treelessAt(a, z)) continue; // the Faroes and Shetland: grass, no trees
        const h = meshHeight(b, a, z);
        if (h == null || h < 4 || h > (c.mapped ? 950 : 420)) continue;
        if (c.mapped && offFeature(a, z, 5)) continue;
        const kind = hashI(ix, q, 45) < 0.55 ? 0 : 1, far = dd > nearR, cnt = far ? nf : nt, i = cnt[kind];
        if (i >= max) continue;
        const s = 0.7 + 0.7 * hashI(ix, q, 46), g = hashI(ix, q, 47);
        tmpC.setRGB(lin(lerp(58, 92, g)) * 1.15, lin(lerp(96, 130, g)), lin(lerp(52, 64, g)));
        place((far ? set.treesFar : set.trees)[kind], i, a, z, h - 0.4, s, s * (0.85 + 0.3 * hashI(ix, q, 48)), hashI(ix, q, 49) * TAU, tmpC);
        cnt[kind]++;
      }
    }
    let nh = 0, nb = 0, nw = 0, nl = 0;
    const lp = set.cityLights.geometry.attributes.position.array, lc = set.cityLights.geometry.attributes.aCol.array, ls = set.cityLights.geometry.attributes.aSize.array;
    const light = (a, z, h, s, warm) => {
      if (nl >= ls.length) return;
      framePos(a, z, h, V1); lp[nl * 3] = V1.x; lp[nl * 3 + 1] = V1.y; lp[nl * 3 + 2] = V1.z;
      lc[nl * 3] = 1; lc[nl * 3 + 1] = warm ? 0.72 : 0.9; lc[nl * 3 + 2] = warm ? 0.4 : 0.75; ls[nl] = s; nl++;
    };
    if (b === EARTH && c.mapped) {
      // real cities (Natural Earth): plots on a grid over the city's footprint, dense and tall in the middle
      const DEG = Terrain.DEG, kl = latK(z0, R), cellB = 30, maxB = hi ? 5200 : 1800, g0 = Terrain.toGeo(a0, z0 / R), sim = {};
      const near = Terrain.citiesNear(g0.lon * DEG, g0.lat * DEG, (rad + 4300) / (R / DEG));
      const glass = ['#7f8c96', '#9aa3a8', '#5f6d78', '#b9bab4', '#a89a8a', '#c8c0b0'].map(col), walls = ['#ddd0b8', '#d2bf9c', '#c8b294', '#dacfbf', '#bdb4a7', '#b9a184', '#adaba6'].map(col), roofs = ['#9c4a35', '#7d6a5a', '#5d6268', '#a65a3c'].map(col); const zinc = col('#6a7076');
      for (const [city, dist] of near) {
        if (nw >= maxB) break;
        const rc = Terrain.cityRadius(city[2]);
        if (dist > rad + rc) continue;
        Terrain.toSim(city[3] / DEG, city[4] / DEG, sim);
        const ca = EARTH.padAngle + wrapAngle(sim.a - EARTH.padAngle), cz = sim.phi * R;
        const seed = Math.round(city[3] * 100) * 7 + Math.round(city[4] * 100), yaw0 = hashI(seed, 1, 101) * Math.PI / 2;
        const big = city[2] > 600000, mega = city[2] > 4e6, cy = Math.cos(yaw0), sy = Math.sin(yaw0);
        // the view's centre in the city's (turned) plot grid, and plots in order of distance from it
        const vx = wrapAngle(a0 - ca) * R * kl, vz = z0 - cz, vgx = vx * cy + vz * sy, vgz = -vx * sy + vz * cy;
        const pc = Math.round(vgx / cellB - 0.5), qc = Math.round(vgz / cellB - 0.5);
        for (const [dp, dq] of spiral(Math.ceil(Math.min(rad, rc * 2) / cellB))) {
          if (nw >= maxB) break;
          if ((++work & 255) === 0) yield;
          const p = pc + dp, q = qc + dq, H = (s) => hashI(p + seed, q, s);
          const gx = (p + 0.5) * cellB, gz = (q + 0.5) * cellB, X = gx * cy - gz * sy, Z = gx * sy + gz * cy, dc = Math.hypot(X, Z);
          if (dc > rc) continue;
          const dens = 1 - smoothstep(rc * 0.25, rc, dc);
          if (H(102) > 0.2 + 0.7 * dens) continue;
          const a = ca + X / (R * kl), z = cz + Z;
          if (Math.hypot(wrapAngle(a - a0) * R * kl, z - z0) > rad) continue;
          if (offTrack(b, a, z) < 60 || Terrain.apronW(-wrapAngle(a - EARTH.padAngle) * R, z) > 0) continue; // (Tórshavn is by the runway)
          const h = meshHeight(b, a, z);
          if (h == null || h < 1.5 || offFeature(a, z, 7, true)) continue;
          const core = Math.pow(dens, 3), cbd = 1 - smoothstep(rc * 0.03, rc * 0.14, dc), tall = big && H(103) < (mega ? 0.22 : 0.12) * cbd; // towers only in a downtown
          const hb = tall ? 25 + (mega ? 110 : 50) * core * (0.3 + 0.7 * H(104)) : 4 + (big ? 13 : 8) * H(104) * (0.4 + dens);
          const w = tall ? 14 + 12 * H(105) : 9 + 14 * H(105), d = tall ? 14 + 12 * H(106) : 8 + 12 * H(106), yaw = yaw0 + (H(107) - 0.5) * 0.12;
          const pal = tall ? glass : walls;
          place(set.walls, nw, a, z, h - 0.5, w, hb + 0.5, yaw, pal[Math.floor(H(108) * pal.length)], d);
          nw++;
          if (!tall && nh < set.roofs.instanceMatrix.count) { // pitched roofs on houses, low grey mansards on blocks of flats
            if (hb < 12) place(set.roofs, nh, a, z, h + hb, w * 1.02, 2 + w * 0.12, yaw, roofs[Math.floor(H(109) * roofs.length)], d * 1.02);
            else place(set.roofs, nh, a, z, h + hb, w * 1.06, 3, yaw, zinc, d * 1.06);
            nh++;
          }
          if (H(110) < 0.65) light(a, z, h + hb + 1, tall ? 5 + 3 * H(111) : 3 + 2 * H(111), H(112) < 0.75);
        }
      }
    }
    if (b === EARTH) {
      // villages: a cluster of houses in some 1.4 km cells, on land the photo shows as land, off the roads
      const cellV = 1400, nV = Math.ceil(rad / cellV) + 1, iaV = Math.floor((a0 * R) / cellV), iqV = Math.floor(z0 / cellV), kl = latK(z0, R);
      const hMax = hi ? 1600 : 600, wallC = ['#efe6d2', '#f4f1ea', '#e3c79a', '#e8b8a6', '#cfdde6', '#d9d2c0'].map(col), roofC = ['#b5523b', '#8e4a33', '#5d6268', '#c2643f', '#9b3b2e'].map(col);
      for (let q = iqV - nV; q <= iqV + nV; q++) for (let p = -nV; p <= nV; p++) {
        if ((++work & 15) === 0) yield; // (each village is a few dozen houses)
        const ix = iaV + p;
        if (hashI(ix, q, 61) > 0.24) continue;
        const ca = (ix + 0.25 + 0.5 * hashI(ix, q, 62)) * cellV, cz = (q + 0.25 + 0.5 * hashI(ix, q, 63)) * cellV;
        if (Math.hypot((ca - a0 * R) * kl, cz - z0) > rad + 300) continue;
        const a = ca / R, e = -wrapAngle(a - EARTH.padAngle) * R;
        if (Math.hypot((e - Terrain.ISLE.e) / Terrain.ISLE.a, cz / Terrain.ISLE.b) < 1.3) continue; // the space centre
        if (e > EARTH.causeway.shore - 100 && e < EARTH.causeway.shore + 2100 && Math.abs(cz) < 900) continue; // the port town is there already
        const hc = meshHeight(b, a, cz);
        if (hc == null || hc < 3 || hc > 700) continue;
        if (c.mapped) { bioAt(a, cz); if (BIOW < 0.6) continue; }
        const n = 4 + Math.floor(hashI(ix, q, 64) * 16), spread = 60 + 14 * n, yaw0 = hashI(ix, q, 65) * TAU;
        for (let k = 0; k < n && nh < hMax; k++) {
          const H = (s) => hashI(ix * 31 + k, q, s);
          const r = spread * Math.sqrt(H(66)), t = H(67) * TAU, hz = cz + r * Math.sin(t), ha = a + (r * Math.cos(t)) / (R * kl);
          const h = meshHeight(b, ha, hz);
          if (h == null || h < 2.5 || offTrack(b, ha, hz) < 15 || (c.mapped && offFeature(ha, hz, 6))) continue;
          if (nw >= set.walls.instanceMatrix.count || nh >= set.roofs.instanceMatrix.count) break;
          const w = 6 + 5 * H(68), d = 5 + 3 * H(69), hh = H(70) < 0.18 ? 6.5 : 3.6, yaw = yaw0 + Math.round(H(71) * 3) * (Math.PI / 2) + (H(72) - 0.5) * 0.4;
          place(set.walls, nw, ha, hz, h - 0.3, w, hh + 0.3, yaw, wallC[Math.floor(H(73) * wallC.length)], d);
          place(set.roofs, nh, ha, hz, h + hh, w * 1.02, 2.2, yaw, roofC[Math.floor(H(74) * roofC.length)], d * 1.02);
          if (H(75) < 0.6) light(ha, hz, h + hh + 2.6, 3 + 2 * H(76), true);
          nw++; nh++;
        }
      }
      // boats: fishing boats and the odd freighter, on water deeper than a few metres
      const cellB = 1100, nB = Math.ceil(rad / cellB) + 1, iaB = Math.floor((a0 * R) / cellB), iqB = Math.floor(z0 / cellB), maxB = hi ? 200 : 80;
      for (let q = iqB - nB; q <= iqB + nB && nb < maxB; q++) for (let p = -nB; p <= nB && nb < maxB; p++) {
        const ix = iaB + p;
        if (hashI(ix, q, 81) > 0.13) continue;
        const ba = (ix + hashI(ix, q, 82)) * cellB, bz = (q + hashI(ix, q, 83)) * cellB;
        if (Math.hypot((ba - a0 * R) * kl, bz - z0) > rad + 500) continue;
        const a = ba / R, h = meshHeight(b, a, bz);
        if (h == null || h > -6) continue;
        const big = hashI(ix, q, 84) < 0.15, s = big ? 3.6 : 0.9 + 0.3 * hashI(ix, q, 85);
        tmpC.setRGB(1, 1, 1);
        if (big) tmpC.setRGB(0.62, 0.2, 0.16); else if (hashI(ix, q, 86) < 0.3) tmpC.setRGB(0.95, 0.85, 0.5);
        place(set.boats, nb, a, bz, 0, s, s, hashI(ix, q, 87) * TAU, tmpC);
        nb++;
      }
    }
    if (b.rocks) {
      const cell = hi ? 9 : 14, max = hi ? 5000 : 1800, rr = Math.min(rad, hi ? 650 : 400), n = Math.ceil(rr / cell);
      const ia = Math.floor((a0 * R) / cell), iq = Math.floor(z0 / cell), kl = latK(z0, R);
      for (let q = iq - n; q <= iq + n && nr < max; q++) for (let p = -n; p <= n && nr < max; p++) {
        if ((++work & 255) === 0) yield;
        const ix = ia + p, h0 = hashI(ix, q, 51);
        if (h0 > 0.22) continue;
        const along = (ix + hashI(ix, q, 52)) * cell, z = (q + hashI(ix, q, 53)) * cell;
        if (Math.hypot((along - a0 * R) * kl, z - z0) > rr) continue;
        const a = along / R;
        if (offTrack(b, a, z) < 4) continue;
        const h = meshHeight(b, a, z);
        if (h == null || (b.ocean && h < 2)) continue;
        const s = 0.4 + 3.6 * Math.pow(hashI(ix, q, 54), 4), g = 0.75 + 0.4 * hashI(ix, q, 55);
        tmpC.setRGB(lin(rockC[0]) * g, lin(rockC[1]) * g, lin(rockC[2]) * g);
        place(set.rocks, nr, a, z, h - s * 0.25, s, s * (0.6 + 0.5 * hashI(ix, q, 56)), hashI(ix, q, 57) * TAU, tmpC);
        nr++;
      }
    }
    set.trees[0].count = nt[0]; set.trees[1].count = nt[1]; set.treesFar[0].count = nf[0]; set.treesFar[1].count = nf[1]; set.rocks.count = nr;
    set.walls.count = nw; set.roofs.count = nh; set.boats.count = nb;
    const lgeo = set.cityLights.geometry;
    lgeo.setDrawRange(0, nl);
    for (const k of ['position', 'aCol', 'aSize']) lgeo.attributes[k].needsUpdate = true;
    for (const m of [set.trees[0], set.trees[1], set.treesFar[0], set.treesFar[1], set.rocks, set.walls, set.roofs, set.boats]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    Object.assign(set, { b, a0, z0, rad });
  }
  // The new scenery set goes on show; the old one becomes the next to fill.
  function swapScenery() {
    const [front, back] = S.scen;
    S.scen = [back, front];
    front.frame.visible = false;
  }
  function buildSceneryNow(b, a0, z0, rad) {
    S.scenery.job = null;
    const job = sceneryJob(S.scen[1], b, a0, z0, rad);
    while (!job.next().done);
    swapScenery();
  }

  // Cumulus on a hashed 750 m grid (the row through the flight plane uses the 2D view's clouds): flat,
  // darker bases 1.4–3.6 km up with puffs heaped above them; fewer, bigger puffs far off. Built a slice a
  // frame into a list (x, y, z, size, turn, atlas cell, height in the cloud, opacity per puff) that
  // sortPuffs copies into the quads, far ones first.
  function* cumulusJob(b, a0, z0) {
    const R = b.radius, step = 750, hi = Settings.high, n = Math.ceil((hi ? 15000 : 9000) / step), nearN = 5000 / step;
    const ia = Math.floor((a0 * R) / step), iq = Math.round(z0 / step), list = new Float32Array(CLOUD_MAX * 8), vols = [];
    let k = 0, work = 0;
    for (let qq = -n; qq <= n; qq++) for (let p = -n; p <= n; p++) {
      if ((++work & 63) === 0) yield;
      const q = iq + qq, i = ia + p, row0 = q === 0;
      const hh = (s) => (row0 ? hash1(i, s) : hashI(i, q, s * 7 + 3));
      if (hh(21) > 0.62) continue;
      const dc = Math.hypot(p, qq);
      if (dc > n) continue;
      const far = dc > nearN, np = far ? (hi ? 4 : 3) : hi ? 14 : 8;
      const base = 1400 + hh(22) * 2200, wdt = 300 + hh(23) * 750, ht = wdt * (0.35 + 0.35 * hh(30));
      const ang = (i * step) / R, zc = row0 ? 0 : (q + (hh(27) - 0.5) * 0.6) * step;
      const rc = R + base + ht * 0.45, d0 = ang - a0, c0 = Math.cos(zc / R);
      vols.push([-rc * c0 * Math.sin(d0), rc * c0 * Math.cos(d0) - R, rc * Math.sin(zc / R), wdt * 0.5, ht * 0.6]); // to fly through
      for (let j = 0; j < np && k < CLOUD_MAX; j++) {
        const g = (s) => (row0 ? hash1(i * 7 + j, s) : hashI(i * 7 + j, q, s));
        const t = Math.pow(g(25), 1.6), y = t * ht * 0.85; // more puffs low down, a narrowing heap above
        const rr = (1 - 0.65 * t) * wdt * 0.5 * Math.sqrt(g(24)), th = g(28) * TAU, ox = rr * Math.cos(th), oz = rr * Math.sin(th) * 0.8;
        const s = wdt * (0.42 + 0.3 * g(26)) * (1 - 0.35 * t) * (far ? 1.5 : 1);
        const a = ang - ox / R, z = zc + oz, d = a - a0, r = R + base + y + s * 0.18, cz = Math.cos(z / R), o = k * 8;
        list[o] = -r * cz * Math.sin(d); list[o + 1] = r * cz * Math.cos(d) - R; list[o + 2] = r * Math.sin(z / R); list[o + 3] = s;
        list[o + 4] = g(29) * TAU; list[o + 5] = Math.floor(g(31) * 4); list[o + 6] = clamp(t * 1.15 + (g(32) - 0.5) * 0.2, 0, 1); list[o + 7] = 0.75 + 0.25 * g(33);
        k++;
      }
    }
    Object.assign(S.clouds, { b, a0, z0, list, n: k, vols, sortAt: -9 });
  }
  // The puffs are see-through, so they are drawn far to near: re-sorted a few times a second.
  const puffKey = new Float32Array(CLOUD_MAX), puffIdx = new Uint32Array(CLOUD_MAX);
  function sortPuffs(cam) {
    const C0 = S.clouds, L = C0.list, n = C0.n;
    if (!L) { S.puffs.count = 0; return; }
    for (let k = 0; k < n; k++) {
      const o = k * 8, dx = L[o] - cam.x, dy = L[o + 1] - cam.y, dz = L[o + 2] - cam.z;
      puffKey[k] = dx * dx + dy * dy + dz * dz; puffIdx[k] = k;
    }
    const idx = puffIdx.subarray(0, n).sort((p, q) => puffKey[q] - puffKey[p]);
    const m = S.puffs.instanceMatrix.array, at = S.puffAttr.array;
    for (let j = 0; j < n; j++) {
      const o = idx[j] * 8, s = L[o + 3], w = j * 16, v = j * 4;
      m[w] = s; m[w + 1] = 0; m[w + 2] = 0; m[w + 3] = 0; m[w + 4] = 0; m[w + 5] = s; m[w + 6] = 0; m[w + 7] = 0;
      m[w + 8] = 0; m[w + 9] = 0; m[w + 10] = s; m[w + 11] = 0; m[w + 12] = L[o]; m[w + 13] = L[o + 1]; m[w + 14] = L[o + 2]; m[w + 15] = 1;
      at[v] = L[o + 4]; at[v + 1] = L[o + 5]; at[v + 2] = L[o + 6]; at[v + 3] = L[o + 7];
    }
    S.puffs.count = n;
    S.puffs.instanceMatrix.needsUpdate = true;
    S.puffAttr.needsUpdate = true;
  }

  // ------------------------------------------------------------------ space centre (Earth)
  // Surface frame at the pad: x metres east along the curved ground, y up, z depth (negative = away from
  // the default camera). surf() follows the planet's curvature, so the runway and causeway stay on the ground.
  function surf(e, h, z, out) {
    const R = EARTH.radius, r = R + h, d = e / R, cp = Math.cos(z / R);
    return out.set(r * cp * Math.sin(d), r * cp * Math.cos(d) - (R + EARTH.padHeight), r * Math.sin(z / R));
  }
  function initSpaceCentre() {
    const g = S.sc = new THREE.Group();
    localWorld.add(g);
    const stdMat = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.85, metalness: 0.05 }, o));
    const night = S.nightMats = [];
    const lit = (o) => { const m = stdMat(Object.assign({ emissive: 0xffffff, emissiveIntensity: 0 }, o)); night.push(m); return m; };
    const place = (obj, e, h, z) => { surf(e, h, z, obj.position); obj.rotation.z = -e / EARTH.radius; g.add(obj); obj.castShadow = obj.receiveShadow = true; return obj; };
    // painters in metres on a canvas: x right, y up from the ground
    const facade = (wm, hm, ppm, draw) => {
      const cw = Math.min(1024, Math.round(wm * ppm)), ch = Math.min(1024, Math.round(hm * ppm));
      const mk = (glow) => canvasTex(cw, ch, (cx) => {
        const s = cw / wm, sy = ch / hm;
        const R = (x, y, w, h, c) => { cx.fillStyle = c; cx.fillRect(x * s, ch - (y + h) * sy, w * s, h * sy); };
        if (glow) { cx.fillStyle = '#000'; cx.fillRect(0, 0, cw, ch); }
        draw(R, glow, cx, s, sy, ch);
      });
      return { map: mk(false), emissiveMap: mk(true) };
    };
    const winRows = (R, glow, x0, x1, dx, y0, y1, dy, w, h) => {
      for (let y = y0; y < y1; y += dy) for (let x = x0; x < x1; x += dx) {
        const on = hashI(Math.round(x * 3), Math.round(y * 3), 5) < 0.7;
        R(x, y, w, h, glow ? (on ? '#ffd98a' : '#000') : '#8fb4d0');
      }
    };
    const concrete = canvasTex(256, 256, (cx) => {
      cx.fillStyle = '#a3a6a9'; cx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1400; i++) { cx.fillStyle = `rgba(${hashI(i, 1, 2) > 0.5 ? '255,255,255' : '40,40,40'},0.05)`; cx.fillRect(hashI(i, 2, 2) * 256, hashI(i, 3, 2) * 256, 3, 3); }
      cx.strokeStyle = 'rgba(60,62,66,0.5)'; cx.lineWidth = 2; cx.strokeRect(1, 1, 254, 254);
    }, true, true);
    // ---- launch pad: deck with hazard stripes, flame trench through the base, a dark flame hole
    const pb = new Batch(), cDark = col('#3b4048'), cDeck = col('#6a717b'), cTrench = col('#1d2126');
    pb.box(-7.5, -1.75, 0, 9, 2.5, 24, cDark).box(7.5, -1.75, 0, 9, 2.5, 24, cDark).box(0, -2.9, 0, 6, 0.2, 24, cTrench);
    pb.box(0, -0.235, 0, 24, 0.53, 24, cDeck);
    for (let x = -11.5; x < 11.5; x += 2) { pb.box(x + 0.5, -0.39, 12.005, 1, 0.12, 0.02, col('#ffc93c')); pb.box(x + 0.5, -0.39, -12.005, 1, 0.12, 0.02, col('#ffc93c')); }
    for (const [x, z] of [[-3.2, 0], [3.2, 0], [0, -3.2], [0, 3.2]]) pb.box(x, 0.33, z, 0.7, 0.6, 0.7, col('#565d66'));
    pb.geo(new THREE.CylinderGeometry(2.3, 2.3, 0.02, 40), 0, 0.035, 0, col('#15181c'));
    for (let a = 0; a < 16; a++) pb.box(Math.cos(a * Math.PI / 8) * 11, 0.035, Math.sin(a * Math.PI / 8) * 11, 1.6, 0.02, 0.5, col(a % 2 ? '#1a1d22' : '#ffc93c'), 0, -a * Math.PI / 8);
    place(new THREE.Mesh(pb.build(), stdMat({ vertexColors: true, map: concrete })), 0, EARTH.padHeight, 0);
    // ---- launch tower: a real lattice with service arms
    const tb = new Batch(), cs = col('#8a929c'), cRed = col('#b3402e');
    const P3 = (x, y, z) => new THREE.Vector3(x, y, z);
    const tx0 = 8.5, tx1 = 10.9, th = 30, zz = 1.2;
    for (const [x, z] of [[tx0, -zz], [tx1, -zz], [tx0, zz], [tx1, zz]]) tb.beam(P3(x, 0, z), P3(x, th, z), 0.24, cs);
    for (let y = 0; y < th; y += 2.4) {
      const y1 = Math.min(th, y + 2.4);
      tb.beam(P3(tx0, y1, -zz), P3(tx1, y1, -zz), 0.12, cs).beam(P3(tx0, y1, zz), P3(tx1, y1, zz), 0.12, cs);
      tb.beam(P3(tx0, y1, -zz), P3(tx0, y1, zz), 0.12, cs).beam(P3(tx1, y1, -zz), P3(tx1, y1, zz), 0.12, cs);
      tb.beam(P3(tx0, y, zz), P3(tx1, y1, zz), 0.09, cs).beam(P3(tx1, y, zz), P3(tx0, y1, zz), 0.09, cs);
      tb.beam(P3(tx0, y, -zz), P3(tx1, y1, -zz), 0.09, cs).beam(P3(tx1, y, -zz), P3(tx0, y1, -zz), 0.09, cs);
      tb.beam(P3(tx1, y, -zz), P3(tx1, y1, zz), 0.09, cs).beam(P3(tx0, y, zz), P3(tx0, y1, -zz), 0.09, cs);
    }
    for (let y = 8; y < th; y += 8) { tb.box(tx0 - 1.5, y + 0.17, 0, 3, 0.35, 0.8, cs); tb.box(tx0 - 2.9, y + 0.17, 0, 0.25, 0.9, 1.4, cRed); }
    tb.box((tx0 + tx1) / 2, th + 0.1, 0, 3, 0.2, 3, cs);
    tb.beam(P3(9.7, th, 0), P3(9.7, th + 4, 0), 0.12, cs);
    place(new THREE.Mesh(tb.build(), stdMat({ vertexColors: true, metalness: 0.5, roughness: 0.5 })), 0, EARTH.padHeight, 0);
    // ---- vehicle assembly building: x -115..-67, 62 m tall, z -110..-50
    const vf = facade(48, 62, 8, (R, glow) => {
      if (!glow) {
        R(0, 0, 48, 62, '#c9ccd1'); R(0, 0, 48, 4, '#9aa0a8');
        for (let x = 0; x < 48; x += 4) R(x, 4, 0.12, 58, 'rgba(120,126,134,0.35)');
        R(4, 46, 12, 12, '#2f5f9a'); R(18, 46, 16, 12, '#d43c3c'); R(19, 0, 14, 40, '#5b636d');
        for (let y = 2; y < 40; y += 2.5) R(19, y, 14, 0.15, '#4b525b');
      }
      winRows(R, glow, 3, 15, 4, 8, 40, 6, 2, 2.4);
    });
    const vs = facade(60, 62, 6, (R, glow) => {
      if (!glow) { R(0, 0, 60, 62, '#c3c6cb'); R(0, 0, 60, 4, '#9aa0a8'); for (let x = 0; x < 60; x += 5) R(x, 4, 0.12, 58, 'rgba(120,126,134,0.35)'); }
      winRows(R, glow, 4, 56, 5, 10, 56, 7, 1.6, 2.2);
    });
    const roof = stdMat({ color: '#8d939b' });
    const vab = new THREE.Mesh(new THREE.BoxGeometry(48, 62, 60), [lit(vs), lit(vs), roof, roof, lit(vf), lit(vs)]);
    vab.geometry.translate(0, 31, 0);
    place(vab, -91, EARTH.padHeight - 0.2, -80);
    // ---- mission control: x -160..-126, 16 m, z -90..-55, with a dish
    const mf = facade(34, 16, 10, (R, glow) => {
      if (!glow) { R(0, 0, 34, 16, '#b8bcc3'); R(0, 0, 34, 1.5, '#8f959d'); R(0, 14.8, 34, 1.2, '#9aa0a8'); }
      winRows(R, glow, 3, 31, 4, 8, 11, 4, 2.4, 3);
      winRows(R, glow, 3, 31, 4, 3, 6, 4, 2.4, 2.2);
    });
    const ms = facade(35, 16, 8, (R, glow) => { if (!glow) R(0, 0, 35, 16, '#b2b6bd'); winRows(R, glow, 2, 33, 4, 8, 11, 4, 2.4, 3); });
    const mcc = new THREE.Mesh(new THREE.BoxGeometry(34, 16, 35), [lit(ms), lit(ms), roof, roof, lit(mf), lit(ms)]);
    mcc.geometry.translate(0, 8, 0);
    place(mcc, -143, EARTH.padHeight - 0.2, -72.5);
    const db = new Batch(), cw = col('#d6d9de');
    db.geo(new THREE.CylinderGeometry(0.2, 0.25, 10, 8), 0, 5, 0, col('#9aa0a8'));
    db.geo(new THREE.SphereGeometry(3, 24, 8, 0, TAU, 0, 0.75), 0, 11.6, 0, cw, Math.PI + 0.5, 0, 0.4);
    db.geo(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), 0.5, 10.9, 0.3, cw, 0.5, 0, 0.4);
    const dish = new THREE.Mesh(db.build(), stdMat({ vertexColors: true, side: THREE.DoubleSide, metalness: 0.3, roughness: 0.4 }));
    place(dish, -143, EARTH.padHeight + 16, -72.5);
    // ---- water tower and flag
    const wb = new Batch(), cLeg = col('#8a929c');
    for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) wb.beam(P3(x, 0, z), P3(x * 0.55, 18.5, z * 0.55), 0.35, cLeg);
    wb.beam(P3(-3, 7, -3), P3(3, 7, 3), 0.12, cLeg).beam(P3(3, 7, -3), P3(-3, 7, 3), 0.12, cLeg);
    wb.geo(new THREE.SphereGeometry(4, 32, 20), 0, 21, 0, col('#e8ebef'));
    wb.geo(new THREE.CylinderGeometry(4.03, 4.03, 1.2, 32, 1, true), 0, 20.6, 0, col('#ff7a1a'));
    place(new THREE.Mesh(wb.build(), stdMat({ vertexColors: true, roughness: 0.5, metalness: 0.2 })), 41.2, EARTH.padHeight, -30);
    const fb = new Batch();
    fb.geo(new THREE.CylinderGeometry(0.12, 0.15, 14, 8), 0, 7, 0, col('#9aa0a8'));
    place(new THREE.Mesh(fb.build(), stdMat({ vertexColors: true, metalness: 0.6, roughness: 0.4 })), -30, EARTH.padHeight, -25);
    const fg = new THREE.PlaneGeometry(5, 3.2, 10, 1), fp = fg.attributes.position;
    for (let i = 0; i < fp.count; i++) fp.setZ(i, Math.sin((fp.getX(i) + 2.5) * 1.3) * 0.25 * ((fp.getX(i) + 2.5) / 5));
    fg.computeVertexNormals();
    place(new THREE.Mesh(fg, stdMat({ color: '#ffb547', side: THREE.DoubleSide, roughness: 0.9 })), -27.35, EARTH.padHeight + 12.1, -25);
    // ---- concrete: the assembly lot, the crawlerway to the pad, the airport apron
    const slab = (e0, e1, z0, z1, rot = 0) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(e1 - e0, 0.6, z1 - z0), stdMat({ map: concrete.clone(), roughness: 0.9 }));
      s.material.map.repeat.set((e1 - e0) / 10, (z1 - z0) / 10); s.material.map.needsUpdate = true;
      s.geometry.translate(0, -0.27, 0);
      place(s, (e0 + e1) / 2, EARTH.padHeight, (z0 + z1) / 2).rotation.y = rot;
      s.castShadow = false;
      return s;
    };
    slab(-180, -50, -125, -38);
    slab(-80, -10, -36, -22).rotation.y = 0;
    slab(-28, 30, -45, -12);
    // ---- helipad at 160 m east: a disc with an H, ringed with lights
    const hp = canvasTex(256, 256, (cx) => {
      cx.fillStyle = '#4a4f57'; cx.beginPath(); cx.arc(128, 128, 128, 0, TAU); cx.fill();
      cx.strokeStyle = '#f2f2ee'; cx.lineWidth = 8; cx.beginPath(); cx.arc(128, 128, 112, 0, TAU); cx.stroke();
      cx.strokeStyle = '#ffc93c'; cx.lineWidth = 4; cx.beginPath(); cx.arc(128, 128, 96, 0, TAU); cx.stroke();
      cx.fillStyle = '#f2f2ee'; cx.fillRect(84, 66, 20, 124); cx.fillRect(152, 66, 20, 124); cx.fillRect(84, 118, 88, 20);
    });
    const heli = new THREE.Mesh(new THREE.CylinderGeometry(10, 10.4, 0.5, 48), [stdMat({ color: '#3d424a' }), stdMat({ map: hp, roughness: 0.8 }), stdMat({ color: '#3d424a' })]);
    heli.geometry.translate(0, -0.21, 0);
    place(heli, EARTH.sites.helipad.east, EARTH.padHeight, 0).castShadow = false;
    // ---- runway 12/30 (it heads 119°) and the causeway road: strips that follow the curved ground
    const strip = (e0, e1, step, z0, z1, hAt, uScale, mat) => {
      const pos = [], uv = [], nor = [], idx = [], n = Math.ceil((e1 - e0) / step), p = tmpV(), q = tmpV();
      for (let i = 0; i <= n; i++) {
        const e = e0 + ((e1 - e0) * i) / n, h = hAt(e);
        for (const [z, v] of [[z0, 0], [z1, 1]]) {
          surf(e, h, z, p); pos.push(p.x, p.y, p.z); uv.push((e - e0) / uScale, v);
          surf(e, h + 1, z, q); q.sub(p); nor.push(q.x, q.y, q.z);
        }
        if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } // wound to face up
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const asphalt = (cx, w, h) => {
      cx.fillStyle = '#3a3d42'; cx.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) { cx.fillStyle = `rgba(${hashI(i, 4, 1) > 0.5 ? '255,255,255' : '0,0,0'},0.06)`; cx.fillRect(hashI(i, 5, 1) * w, hashI(i, 6, 1) * h, 2, 2); }
    };
    const rwTex = canvasTex(512, 256, (cx) => { // 60 m along x 45 m across
      asphalt(cx, 512, 256);
      cx.fillStyle = '#e9ebe6'; cx.fillRect(0, 8, 512, 5); cx.fillRect(0, 243, 512, 5); cx.fillRect(0, 125, 256, 6);
    }, true, true);
    const rh = (e) => EARTH.padHeight + 0.04 + (terrainHeight(EARTH, siteAngle(EARTH, e)) - EARTH.padHeight);
    const rw = EARTH.runway;
    strip(rw.from + 60, rw.to - 60, 20, -22.5, 22.5, rh, 60, stdMat({ map: rwTex, roughness: 0.9 }));
    const endTex = (num, flip) => canvasTex(512, 384, (cx) => { // 60 m long end section with piano keys and the number
      asphalt(cx, 512, 384);
      cx.save();
      if (flip) { cx.translate(512, 384); cx.rotate(Math.PI); }
      cx.fillStyle = '#e9ebe6'; cx.fillRect(0, 12, 512, 7); cx.fillRect(0, 365, 512, 7);
      for (let k = 0; k < 8; k++) { cx.fillRect(14, 40 + k * 18, 200, 10); cx.fillRect(14, 216 + k * 18, 200, 10); }
      cx.save(); cx.translate(330, 192); cx.rotate(Math.PI / 2); cx.font = 'bold 120px sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(num, 0, 0); cx.restore();
      cx.fillRect(440, 186, 72, 12);
      cx.restore();
    });
    strip(rw.from, rw.from + 60, 10, -22.5, 22.5, rh, 60, stdMat({ map: endTex('12', false), roughness: 0.9 }));
    strip(rw.to - 60, rw.to, 10, -22.5, 22.5, rh, 60, stdMat({ map: endTex('30', true), roughness: 0.9 }));
    const rdTex = canvasTex(256, 128, (cx) => { // 24 m along, 12 m across
      asphalt(cx, 256, 128);
      cx.fillStyle = '#e9ebe6'; cx.fillRect(0, 6, 256, 4); cx.fillRect(0, 118, 256, 4);
      cx.fillStyle = '#ffc93c'; cx.fillRect(0, 62, 128, 4);
    }, true, true);
    const roadMat = stdMat({ map: rdTex, roughness: 0.9 }), gh = (e) => terrainHeight(EARTH, siteAngle(EARTH, e)) + 0.05;
    strip(rw.to, EARTH.causeway.shore + 150, 20, -6, 6, gh, 24, roadMat);
    strip(12, EARTH.sites.helipad.east - 11, 8, -4, 4, gh, 24, roadMat);
    strip(EARTH.sites.helipad.east + 11, rw.from, 10, -4, 4, gh, 24, roadMat);
    // ---- airport: an arched hangar and a control tower beside the runway
    const hf = facade(40, 15, 8, (R, glow) => {
      if (!glow) { R(0, 0, 40, 15, '#b9bec4'); R(4, 0, 32, 11, '#5f666f'); for (let x = 4; x < 36; x += 4) R(x, 0, 0.15, 11, '#4b525b'); R(0, 13, 40, 0.8, '#ff7a1a'); }
      winRows(R, glow, 1, 3, 3, 3, 9, 3, 1.2, 1.6); winRows(R, glow, 37, 39, 3, 3, 9, 3, 1.2, 1.6);
    });
    const corr = canvasTex(128, 128, (cx) => { cx.fillStyle = '#aab0b7'; cx.fillRect(0, 0, 128, 128); for (let x = 0; x < 128; x += 8) { cx.fillStyle = 'rgba(70,76,84,0.35)'; cx.fillRect(x, 0, 3, 128); } }, true, true);
    corr.repeat.set(6, 3);
    const arch = new THREE.CylinderGeometry(20, 20, 32, 40, 1, true, -Math.PI / 2, Math.PI);
    arch.rotateX(Math.PI / 2); arch.scale(1, 0.75, 1);
    const hangar = new THREE.Group();
    hangar.add(new THREE.Mesh(arch, stdMat({ map: corr, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5 })));
    const endWall = new THREE.Mesh(new THREE.CircleGeometry(20, 40, 0, Math.PI), lit(hf));
    endWall.scale.y = 0.75; endWall.position.z = 16;
    endWall.material.map.repeat.set(1, 1);
    const back = endWall.clone(); back.position.z = -16; back.rotation.y = Math.PI;
    hangar.add(endWall, back);
    hangar.traverse((o) => { o.castShadow = o.receiveShadow = true; });
    place(hangar, 900, EARTH.padHeight, -95);
    const twb = new Batch(), cT = col('#d4d7dc');
    twb.geo(new THREE.CylinderGeometry(2.2, 2.8, 22, 16), 0, 11, 0, cT);
    twb.geo(new THREE.CylinderGeometry(4.6, 3.6, 1.2, 12), 0, 22.6, 0, col('#9aa0a8'));
    twb.geo(new THREE.CylinderGeometry(4.4, 4.4, 4, 12), 0, 25.2, 0, col('#30495f'));
    twb.geo(new THREE.CylinderGeometry(5, 4.6, 0.8, 12), 0, 27.6, 0, col('#9aa0a8'));
    twb.geo(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), 0, 30.4, 0, col('#9aa0a8'));
    const tower = new THREE.Mesh(twb.build(), stdMat({ vertexColors: true, roughness: 0.35, metalness: 0.3 }));
    place(tower, 1250, EARTH.padHeight, -72);
    // ---- lights: runway edges (white), thresholds (green), ends (red), helipad (yellow); blinking beacons
    const lp = [], lc = [], ls = [], add = (e, h, z, c, s) => { const p = surf(e, h, z, tmpV()); lp.push(p.x, p.y, p.z); lc.push(...c); ls.push(s); };
    for (let e = rw.from; e <= rw.to + 0.1; e += 60) for (const z of [-24, 24]) add(e, rh(e) + 0.4, z, [1, 0.9, 0.7], 0.9);
    for (let z = -20; z <= 20; z += 5) { add(rw.from - 3, rh(rw.from) + 0.4, z, [0.3, 1, 0.45], 1); add(rw.to + 3, rh(rw.to) + 0.4, z, [1, 0.25, 0.2], 1); }
    for (let a = 0; a < 12; a++) add(EARTH.sites.helipad.east + Math.cos(a * TAU / 12) * 10.6, EARTH.padHeight + 0.3, Math.sin(a * TAU / 12) * 10.6, [1, 0.8, 0.3], 0.7);
    for (let e = rw.to + 40; e < EARTH.causeway.shore + 150; e += 80) for (const z of [-6.6, 6.6]) add(e, terrainHeight(EARTH, siteAngle(EARTH, e)) + 1.2, z, [1, 0.85, 0.6], 0.6);
    const glowPts = (p, c, s, U) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      geo.setAttribute('aCol', new THREE.Float32BufferAttribute(c, 3));
      geo.setAttribute('aSize', new THREE.Float32BufferAttribute(s, 1));
      const pts = new THREE.Points(geo, smat({ uniforms: U, vertexShader: GLOW_VS, fragmentShader: GLOW_FS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      pts.frustumCulled = false;
      g.add(pts);
    };
    glowPts(lp, lc, ls, S.glowU);
    const bp = [], bc = [], bs = [];
    for (const [e, h, z] of [[9.7, EARTH.padHeight + 34.3, 0], [-91, EARTH.padHeight + 62.6, -51], [1250, EARTH.padHeight + 33, -72], [41.2, EARTH.padHeight + 25.3, -30]]) {
      const p = surf(e, h, z, tmpV()); bp.push(p.x, p.y, p.z); bc.push(1, 0.25, 0.2); bs.push(2.2);
    }
    glowPts(bp, bc, bs, S.blinkU);
    S.scKit = [g, place, stdMat, lit, glowPts]; // the landmarks need the Earth map's ground: built once it has loaded
    S.rotors = [];
  }

  // Around the space centre: a lighthouse on the west coast, wind turbines on the hills, a tank farm by the
  // pad, a pier in the seaplane bay and a port town where the causeway comes ashore on Shetland.
  function initLandmarks([g, place, stdMat, lit, glowPts]) {
    const ground = (e, z) => Terrain.heightAt(EARTH, siteAngle(EARTH, e), z);
    const vcol = stdMat({ vertexColors: true });
    // ---- lighthouse: banded tower, gallery, lantern, and a beam that sweeps round at night
    let le = -300, lz = 220;
    for (let e = -1500; e < 600; e += 20) if (ground(e, lz) > 6) { le = e + 40; break; }
    const lb = new Batch(), white = col('#f2f2ee'), red = col('#c8372d'), dark = col('#2a2e33');
    for (let i = 0; i < 4; i++) { const r0 = 3.1 - i * 0.22, r1 = r0 - 0.22; lb.geo(new THREE.CylinderGeometry(r1, r0, 5.5, 20), 0, 2.75 + i * 5.5, 0, i % 2 ? red : white); }
    lb.geo(new THREE.CylinderGeometry(2.9, 2.9, 0.35, 20), 0, 22.2, 0, dark).geo(new THREE.CylinderGeometry(1.7, 1.7, 0.4, 16), 0, 25.6, 0, dark);
    lb.geo(new THREE.ConeGeometry(1.9, 1.8, 16), 0, 26.7, 0, red).box(0, 0.4, 0, 9, 0.8, 9, col('#c9c4b8'));
    const lh = new THREE.Group();
    lh.add(new THREE.Mesh(lb.build(), vcol));
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3, 16), lit({ color: 0xbfe6ff, emissive: 0xfff0b0, roughness: 0.2 }));
    lantern.position.y = 23.9; lh.add(lantern);
    const beamGeo = new THREE.ConeGeometry(9, 260, 20, 1, true);
    beamGeo.translate(0, -130, 0); beamGeo.rotateZ(Math.PI / 2); // apex at the lamp, pointing +x
    S.beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    S.beam = new THREE.Group();
    S.beam.position.y = 23.9;
    for (const s of [0, Math.PI]) { const m = new THREE.Mesh(beamGeo, S.beamMat); m.rotation.y = s; m.raycast = () => {}; S.beam.add(m); }
    lh.add(S.beam);
    place(lh, le, ground(le, lz), lz);
    const shade = (o) => o.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = m.material !== S.beamMat; });
    shade(lh);
    // ---- wind turbines on the hills north of the runway (as on the real islands), rotors facing the sea breeze
    const tw = new Batch().geo(new THREE.CylinderGeometry(0.85, 1.6, 40, 12), 0, 20, 0, white).box(0.3, 40.6, 0, 4.4, 2.3, 2.3, white);
    const towerGeo = tw.build();
    const blade = new Batch();
    blade.geo(new THREE.SphereGeometry(0.9, 12, 8), 0, 0, 0, white);
    for (let k = 0; k < 3; k++) blade.geo(new THREE.BoxGeometry(0.25, 19, 1.3), 0, 9.8 * Math.cos(k * TAU / 3), 9.8 * Math.sin(k * TAU / 3), white, k * TAU / 3, 0, 0);
    const bladeGeo = blade.build();
    [[450, -900], [800, -1050], [1150, -850]].forEach(([e0, z0], i) => {
      let e = e0, z = z0, h = ground(e, z); // the highest ground nearby
      for (let k = 0; k < 24; k++) { const de = e0 + 60 * Math.cos(k * 2.4) * (1 + (k >> 3)), dz = z0 + 60 * Math.sin(k * 2.4) * (1 + (k >> 3)), g = ground(de, dz); if (g > h) { h = g; e = de; z = dz; } }
      if (h < 4) return;
      const t = new THREE.Group(), rotor = new THREE.Group();
      t.add(new THREE.Mesh(towerGeo, vcol));
      rotor.position.set(-2.4, 40.6, 0); rotor.add(new THREE.Mesh(bladeGeo, vcol)); rotor.userData.phase = i * 1.7;
      t.add(rotor); S.rotors.push(rotor);
      place(t, e, h - 0.5, z);
      shade(t);
    });
    // ---- tank farm beside the pad: three spheres on legs, a long tank and pipes
    const tk = new Batch(), steel = col('#d9dcdf'), pipe = col('#8d949c');
    for (const [x, z] of [[-74, 52], [-56, 52], [-38, 52]]) {
      tk.geo(new THREE.SphereGeometry(5.2, 22, 14), x, 8.2, z, steel);
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) tk.box(x + dx, 2.4, z + dz, 0.45, 4.8, 0.45, pipe);
    }
    tk.geo(new THREE.CylinderGeometry(2.6, 2.6, 26, 18), -56, 4.2, 70, steel, 0, 0, Math.PI / 2).box(-56, 1.2, 70, 22, 2.4, 1.6, pipe);
    tk.box(-56, 1.1, 60, 44, 0.6, 0.6, pipe).box(-18, 1.1, 30, 0.6, 0.6, 60, pipe);
    place(new THREE.Mesh(tk.build(), stdMat({ vertexColors: true, metalness: 0.35, roughness: 0.45 })), 0, EARTH.padHeight, 0);
    // ---- pier into the seaplane bay, with a boat tied up
    let se = -400;
    for (let e = 400; e > -2200; e -= 10) if (ground(e, -60) < 0.5) { se = e; break; }
    const pr = new Batch(), wood = col('#8a6a4a'), post = col('#5b4532');
    const pierLen = 150, deckH = 1.8;
    for (let x = 30; x > -pierLen; x -= 8) { pr.box(x - 4, deckH, 0, 8.2, 0.35, 4, wood); pr.box(x, deckH / 2 - 2, 1.8, 0.4, deckH + 4, 0.4, post).box(x, deckH / 2 - 2, -1.8, 0.4, deckH + 4, 0.4, post); }
    pr.box(-pierLen - 4, deckH, 5, 8, 0.35, 14, wood);
    const pierM = new THREE.Mesh(pr.build(), stdMat({ vertexColors: true }));
    place(pierM, se, 0, -60);
    const boat = new THREE.Mesh(boatGeo(), stdMat({ vertexColors: true }));
    boat.rotation.order = 'ZYX';
    place(boat, se - pierLen + 6, 0, -51);
    boat.rotation.y = 0.08;
    // ---- port town on the Shetland shore, at the end of the causeway; windows light up at night
    const town = new Batch(), lights = [], lc = [], ls = [];
    const walls = ['#efe6d2', '#f4f1ea', '#e3c79a', '#e8b8a6', '#cfdde6', '#d9d2c0'].map(col), roofs = ['#b5523b', '#8e4a33', '#5d6268', '#c2643f'].map(col);
    const m4 = new THREE.Matrix4(), mr = new THREE.Matrix4(), ms = new THREE.Matrix4(), pv = tmpV();
    let built = 0;
    for (let i = 0; i < 400 && built < 110; i++) {
      // packed along the road where it comes ashore, thinning out away from it
      const e = EARTH.causeway.shore + 100 + hashI(i, 1, 71) * 1300, side = hashI(i, 2, 71) < 0.5 ? -1 : 1, z = side * (24 + 520 * Math.pow(hashI(i, 12, 71), 1.6));
      const h = ground(e, z);
      if (h < 2.5 || h > 120) continue;
      const w = 6 + 5 * hashI(i, 3, 71), d = 5 + 3 * hashI(i, 4, 71), hh = hashI(i, 5, 71) < 0.2 ? 6.5 : 3.6, yaw = Math.round(hashI(i, 6, 71) * 4) * (Math.PI / 2) + (hashI(i, 7, 71) - 0.5) * 0.3;
      const put = (geo, y, sx, sy, sz, c) => {
        surf(e, h + y, z, pv);
        m4.makeRotationZ(-e / EARTH.radius).multiply(mr.makeRotationY(yaw)).multiply(ms.makeScale(sx, sy, sz)).setPosition(pv);
        town.add(geo, m4, c);
      };
      const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
      const roof = new THREE.ConeGeometry(0.75, 1, 4); roof.rotateY(Math.PI / 4); roof.translate(0, 0.5, 0);
      put(box, -0.3, w, hh + 0.3, d, walls[Math.floor(hashI(i, 8, 71) * walls.length)]);
      put(roof, hh, w * 1.02, 2.2, d * 1.02, roofs[Math.floor(hashI(i, 9, 71) * roofs.length)]);
      // window light, just over the roof (inside, the walls would hide it)
      if (hashI(i, 10, 71) < 0.8) { surf(e, h + hh + 2.6, z, pv); lights.push(pv.x, pv.y, pv.z); lc.push(1, 0.72, 0.38); ls.push(4 + 3 * hashI(i, 11, 71)); }
      built++;
    }
    if (built) {
      const tm = new THREE.Mesh(town.build(), stdMat({ vertexColors: true }));
      tm.castShadow = tm.receiveShadow = true;
      g.add(tm);
      S.townU = { uScale: S.glowU.uScale, uMin: { value: 2 }, uAlpha: { value: 0 } };
      glowPts(lights, lc, ls, S.townU);
    }
  }
  // A small fishing boat, bow towards +x: hull, cabin, mast (vertex colours; also used at sea).
  let boatGeoCache = null;
  function boatGeo() {
    if (boatGeoCache) return boatGeoCache;
    const b = new Batch(), hull = col('#f4f4f0'), stripe = col('#2f6fb3'), cab = col('#e9e4d6'), dark = col('#3a3f45');
    const bow = new THREE.ConeGeometry(1.45, 2.6, 4, 1); bow.rotateY(Math.PI / 4); bow.rotateZ(-Math.PI / 2); bow.scale(1, 0.62, 1);
    b.box(0, 0.4, 0, 7, 1.6, 2.9, hull).geo(bow, 4.8, 0.55, 0, hull).box(0, -0.25, 0, 7.02, 0.3, 2.92, stripe);
    b.box(-1.2, 1.9, 0, 2.6, 1.6, 2.2, cab).box(-1.2, 2.35, 0, 2.62, 0.45, 2.22, dark).box(1.6, 3.2, 0, 0.14, 5, 0.14, dark);
    return (boatGeoCache = b.build());
  }

  // ------------------------------------------------------------------ particles (FX.list)
  function initParticles() {
    const mk = (additive) => {
      const N = 1100, geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const at = (name, n) => geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(N * n), n).setUsage(THREE.DynamicDrawUsage));
      at('iPos', 3); at('iCol', 4); at('iSize', 2);
      geo.instanceCount = 0;
      const m = new THREE.Mesh(geo, smat({
        uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog), vertexShader: PART_VS, fragmentShader: PART_FS, fog: !additive,
        transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }));
      m.frustumCulled = false; m.renderOrder = additive ? 6 : 5; m.N = N;
      localWorld.add(m);
      return m;
    };
    S.smoke = mk(false); S.fire = mk(true);
    S.fxCol = new Map();
  }
  function fxColor(hex) {
    let c = S.fxCol.get(hex);
    if (!c) { const r = C(hex); c = [lin(r[0]), lin(r[1]), lin(r[2])]; S.fxCol.set(hex, c); }
    return c;
  }
  const FLASH = [1, 0.92, 0.7], SMOKY = [0.16, 0.13, 0.11];
  function updateParticles(F, env) {
    const dim = 1 - env.night * 0.6, list = FX.list, t = F.time;
    let ns = 0, nf = 0;
    const ps = S.smoke.geometry.attributes, pf = S.fire.geometry.attributes;
    for (const p of list) {
      if (p.jz === undefined) p.jz = (Math.random() - 0.5) * (p.size + p.grow) * 0.3;
      const bp = bodyPos(p.b, t), k = p.life / p.max, size = p.size + p.grow * k;
      const x = bp.x + p.x - camAbs.x, y = bp.y + p.y - camAbs.y, z = (p.z || 0) + p.jz - camAbs.z;
      let add = p.kind !== 'smoke', c = null, a = p.alpha * (1 - k), kind = 0, sz = size;
      switch (p.kind) {
        case 'spark': c = fxColor(p.color); a = 1 - k; sz = 0.22; break;
        case 'flash': c = FLASH; a = 0.9 * (1 - k); break;
        case 'ring': c = fxColor(p.color); kind = 1; break;
        case 'fire': if (k > 0.45) { add = false; c = SMOKY; a *= 0.85; } else c = fxColor(p.color); break;
        default: c = fxColor(p.color);
      }
      const A = add ? pf : ps, i = add ? nf++ : ns++;
      if (i >= S.smoke.N) { if (add) nf--; else ns--; continue; }
      A.iPos.array[i * 3] = x; A.iPos.array[i * 3 + 1] = y; A.iPos.array[i * 3 + 2] = z;
      const m = add ? 1 : dim;
      A.iCol.array[i * 4] = c[0] * m; A.iCol.array[i * 4 + 1] = c[1] * m; A.iCol.array[i * 4 + 2] = c[2] * m; A.iCol.array[i * 4 + 3] = clamp(a, 0, 1);
      A.iSize.array[i * 2] = sz; A.iSize.array[i * 2 + 1] = kind;
    }
    for (const [mesh, n] of [[S.smoke, ns], [S.fire, nf]]) {
      const g = mesh.geometry;
      g.instanceCount = n;
      for (const [name, w] of [['iPos', 3], ['iCol', 4], ['iSize', 2]]) {
        const at = g.attributes[name];
        at.clearUpdateRanges(); at.addUpdateRange(0, Math.max(1, n) * w); at.needsUpdate = true;
      }
      mesh.visible = n > 0;
    }
  }

  // ------------------------------------------------------------------ hangar turntable
  function initStudio() {
    studio = new THREE.Scene();
    studio.background = canvasTex(4, 256, (cx) => { const gr = cx.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#0b1c33'); gr.addColorStop(1, '#071222'); cx.fillStyle = gr; cx.fillRect(0, 0, 4, 256); });
    studio.fog = new THREE.Fog(0x071222, 60, 160);
    studio.environment = envCube.texture;
    const grid = canvasTex(512, 512, (cx) => { // one tile = 5 m: 1 m lines and a brighter 5 m line
      cx.fillStyle = '#0d2443'; cx.fillRect(0, 0, 512, 512);
      cx.fillStyle = 'rgba(120,170,230,0.16)';
      for (let i = 1; i < 5; i++) { cx.fillRect(i * 102.4 - 1, 0, 2, 512); cx.fillRect(0, i * 102.4 - 1, 512, 2); }
      cx.fillStyle = 'rgba(120,170,230,0.42)'; cx.fillRect(0, 0, 512, 3); cx.fillRect(0, 0, 3, 512);
    }, true, true);
    grid.repeat.set(48, 48);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(120, 96), new THREE.MeshStandardMaterial({ map: grid, roughness: 0.75, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    grid.offset.set(0.5, 0.5); // grid lines through the origin
    S.studioHemi = new THREE.HemisphereLight(0x9fc0ff, 0x1a2436, 1.2);
    S.key = new THREE.DirectionalLight(0xfff2e0, 2.6);
    S.key.castShadow = Settings.high;
    S.key.shadow.mapSize.set(2048, 2048);
    S.key.shadow.bias = -0.0004; S.key.shadow.normalBias = 0.02;
    S.rim = new THREE.DirectionalLight(0x8fb8ff, 1.6);
    S.design = new THREE.Group();
    studio.add(floor, S.studioHemi, S.key, S.key.target, S.rim, S.design);
    S.bd = { vm: null, parts: null, snap: '', att: '' };
  }

  // ------------------------------------------------------------------ per frame: flight
  const camAbs = { x: 0, y: 0, z: 0 };
  const viewQ = quat(); // sim -> view
  // the flight camera orbits the focus: `follow` tracks the craft's heading, yaw/pitch are the player's offset
  const fc = { yaw: 0.5, pitch: 0.16, ty: 0.5, tp: 0.16, follow: 0, vessel: null, kind: 'rocket' }, bc = { yaw: 0.5, pitch: 0.16, ty: 0.5, tp: 0.16, auto: true };
  const vessels = new Map();
  const envV = {}, envC = {};
  const zen = [0, 0, 0], hor = [0, 0, 0], ZEN0 = C('#03050b'), HOR0 = C('#04060d'), SUNSET = C('#ff8a4a');

  // Light and sky at a point (the 2D World.environment, with depth taken into account).
  function envAt(b, rx, ry, rz, ax, ay, out) {
    const r = Math.hypot(rx, ry, rz) || 1, sl = Math.hypot(ax, ay) || 1;
    out.b = b; out.ux = rx / r; out.uy = ry / r; out.uz = rz / r; out.sx = -ax / sl; out.sy = -ay / sl; out.r = r;
    const elev = out.ux * out.sx + out.uy * out.sy;
    out.elev = elev; out.alt = r - b.radius;
    out.atmo = b.atmoHeight ? clamp(1 - out.alt / b.atmoHeight, 0, 1) : 0;
    let night = 0;
    if (!b.star) {
      if (out.alt < b.radius * 0.3) night = 1 - smoothstep(-0.18, 0.06, elev);
      const along = rx * out.sx + ry * out.sy;
      if (along < 0) night = Math.max(night, 1 - smoothstep(b.radius * 0.97, b.radius * 1.05, Math.hypot(rx - along * out.sx, ry - along * out.sy, rz)));
    }
    out.night = night; out.day = 1 - night;
    out.sunset = out.atmo * clamp(1 - Math.abs(elev - 0.03) / 0.28, 0, 1);
    return out;
  }
  function skyColors(e) {
    const b = e.b, a = e.atmo;
    mixC(ZEN0, C(b.colors.sky || '#03050b'), Math.pow(a, 0.7) * (0.1 + 0.9 * e.day), zen);
    mixC(HOR0, C(b.colors.horizon || '#03050b'), Math.pow(a, 0.45) * (0.14 + 0.86 * e.day), hor);
    if (e.sunset > 0) mixC(hor, SUNSET, e.sunset * 0.75, hor);
  }
  // turn between the sim's axes and the view's (local up = +Y)
  const toView = (x, y, z, out) => qrot(viewQ, x, y, z, out);
  const toSim = (x, y, z, out) => qunrot(viewQ, x, y, z, out);
  const T3 = v3(), LOC = {};
  // Default camera offsets: beside a rocket (as in the blueprint), behind anything that flies or drives.
  const CAM0 = { rocket: [0.5, 0.16], plane: [0, 0.2], heli: [0.25, 0.22], car: [0, 0.22] };
  function followCam(v, dt, snap) {
    if (!v || !v.parts.length || v.dead) return;
    if (fc.vessel !== v) {
      if (fc.kind !== v.kind || !fc.vessel) { const d = CAM0[v.kind] || CAM0.rocket; fc.ty = fc.yaw = d[0]; fc.tp = fc.pitch = d[1]; }
      fc.vessel = v; fc.kind = v.kind; snap = true;
    }
    // rockets: look from the side the blueprint faces (part +z); others: from behind the nose
    const P = v.pilot, a = v.kind === 'rocket' ? v.axis(0, 0, 1, T3) : v.axis(-P.F.x, -P.F.y, -P.F.z, T3);
    toView(a.x, a.y, a.z, a);
    const h = Math.hypot(a.x, a.z);
    if (h < 0.25) return;
    const want = Math.atan2(a.x, a.z);
    fc.follow += wrapAngle(want - fc.follow) * (snap ? 1 : (1 - Math.exp(-dt * 2.2)) * Math.min(1, (h - 0.25) * 4));
  }

  function renderFlight(F, dt) {
    if (!api.ready || !shown || !F || !F.active) return;
    mode = 'flight';
    dt = clamp(dt || 0, 0, 0.1);
    clock += dt; frameNo++;
    applyQuality();
    adaptResolution(dt);
    const v = F.active, b = v.body, t = F.time, bp = bodyPos(b, t), R = b.radius, hi = Settings.high;
    camAbs.x = F.camAbs.x; camAbs.y = F.camAbs.y; camAbs.z = F.camAbs.z || 0;
    const fq = F.viewQ || quat();
    viewQ.w = fq.w; viewQ.x = fq.x; viewQ.y = fq.y; viewQ.z = fq.z;
    spaceWorld.quaternion.set(viewQ.x, viewQ.y, viewQ.z, viewQ.w); localWorld.quaternion.copy(spaceWorld.quaternion);
    const vx = camAbs.x - bp.x, vy = camAbs.y - bp.y, vz = camAbs.z; // the focus, relative to the body

    // ---- camera: orbit around the craft, following its heading; never below the ground
    followCam(v, dt, false);
    const s = 1 - Math.exp(-dt * 14);
    fc.yaw += (fc.ty - fc.yaw) * s; fc.pitch += (fc.tp - fc.pitch) * s;
    const dist = (H / 2) / F.scale / TANH;
    const cp = Math.cos(fc.pitch), yaw = fc.follow + fc.yaw;
    toSim(dist * Math.sin(yaw) * cp, dist * Math.sin(fc.pitch), dist * Math.cos(yaw) * cp, T3);
    let rx = vx + T3.x, ry = vy + T3.y, rz = vz + T3.z;
    let r3 = Math.hypot(rx, ry, rz), camAlt = r3 - R;
    // near the surface: a terrain patch around the craft
    const near = !b.star && camAlt < Math.max(60000, 0.35 * R);
    updatePatch(F, b, near, Math.max(camAlt, 1), dist);
    if (!b.star) {
      const ca = Math.atan2(ry, rx), gz = Math.asin(clamp(rz / r3, -1, 1)) * R;
      const need = R + groundAt(b, ca, gz) + 2;
      if (r3 < need) { const k = need / r3; rx *= k; ry *= k; rz *= k; r3 = need; camAlt = r3 - R; }
    }
    toView(rx - vx, ry - vy, rz - vz, T3);
    camera.position.set(T3.x, T3.y, T3.z);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const cax = camAbs.x + rx - vx, cay = camAbs.y + ry - vy;

    // ---- light and sky
    envAt(b, rx, ry, rz, cax, cay, envC);
    envAt(b, vx, vy, vz, camAbs.x, camAbs.y, envV);
    skyColors(envC);
    const U = S.skyU;
    setCol3(U.uZen.value, zen); setCol3(U.uHor.value, hor);
    toView(envC.ux, envC.uy, envC.uz, T3); U.uUp.value.set(T3.x, T3.y, T3.z).normalize();
    toView(envC.sx, envC.sy, 0, T3); U.uSun.value.set(T3.x, T3.y, T3.z);
    U.uDip.value = envC.alt > 0 && !b.star ? Math.acos(clamp(R / (R + envC.alt), -1, 1)) : 0;
    U.uSunsetK.value = envC.sunset * 0.8;
    U.uGlare.value = envC.day * (0.25 + 0.75 * envC.atmo) * (b.star ? 0 : 1);
    S.sky.position.copy(camera.position); S.haze.position.copy(camera.position);
    S.haze.material.uniforms.uAlpha.value = envC.atmo > 0 ? clamp(Math.pow(envC.atmo, 0.6) * (0.25 + 0.6 * envC.day), 0, 0.85) : 0;
    S.haze.visible = S.haze.material.uniforms.uAlpha.value > 0.003;
    const starA = clamp(1 - lum(zen) * 3.2, 0, 1);
    S.starU.uAlpha.value = starA; S.bandU.uAlpha.value = starA;
    S.starU.uPx.value = Math.min(DPR, 2) * (H > 1400 ? 1.4 : 1);
    S.stars.visible = S.band.visible = starA > 0.02;
    toSim(camera.position.x, camera.position.y, camera.position.z, T3);
    S.stars.position.set(T3.x, T3.y, T3.z); S.band.position.copy(S.stars.position);
    // the Sun as a light: leaning out of the ecliptic by TILT (see top)
    const sx = envV.sx, sy = envV.sy, cT = Math.cos(TILT), sT = Math.sin(TILT);
    toView(sx * cT, sy * cT, sT, T3);
    const sunDir = V2.set(T3.x, T3.y, T3.z);
    S.sunS.position.copy(sunDir); S.sunS.target.position.set(0, 0, 0);
    S.ambS.intensity = 0.03 + 0.05 * envC.atmo;

    // ---- planets, Sun, far layer
    updateBodies(F, b, envC, dist);

    // ---- local light: sun, sky, engine glow, fog
    const day = envV.day, atm = envV.atmo, hz = b.haze ? smoothstep(0, 1, Math.sqrt(airDensity(b, Math.max(envV.alt, 0)) / b.rho0)) : 0;
    const warm = envV.sunset;
    terr.nightU.value = envV.night * 0.8; // city glow on the ground (the buildings carry their own lights)
    S.cityU.uAlpha.value = envV.night * 1.3;
    S.sun.intensity = 3.1 * day * (1 - 0.55 * hz) * (b.star ? 1.6 : 1);
    S.sun.color.setRGB(1, lerp(0.97, 0.72, warm), lerp(0.92, 0.5, warm));
    S.sun.position.copy(sunDir).multiplyScalar(100); S.sun.target.position.set(0, 0, 0);
    const skyAvg = mixC(zen, hor, 0.5, T1), grd = C(b.colors.ground || '#333333');
    const amb = atm > 0 ? (0.35 + 1.1 * atm) * (0.18 + 0.82 * day) : 0.12 + 0.2 * day * smoothstep(R * 0.5, 0, envV.alt);
    setCol3(S.hemi.color, mixC(skyAvg, [200, 210, 225], atm > 0 ? 0.25 : 0.6, T2));
    setCol3(S.hemi.groundColor, grd, 0.25 + 0.75 * day);
    S.hemi.intensity = amb * 1.6;
    const fogC = mixC(hor, b.colors.fog ? b.colors.fog.split(',').map((q) => +q) : hor, b.haze ? 0.6 : 0, T1);
    setCol3(localScene.fog.color, fogC);
    const rhoF = b.atmoHeight ? airDensity(b, Math.max(0, camAlt * 0.5)) : 0;
    localScene.fog.density = rhoF > 0 ? (b.haze ? 3.2e-4 : b === MARS ? 6e-5 : 2.4e-5) * Math.sqrt(rhoF / b.rho0) : 0;
    const inCloud = S.clouds.inside; // flying through a cloud: thick, bright murk
    if (inCloud > 0.002) {
      localScene.fog.density = lerp(localScene.fog.density, 0.004, inCloud);
      localScene.fog.color.lerp(S.cloudFogC.setRGB(0.72, 0.75, 0.8).multiplyScalar(0.2 + 0.9 * day), inCloud);
    }
    const eS = new THREE.Color(), eG = new THREE.Color();
    setCol3(eS, zen); setCol3(eG, grd, 0.4 * day);
    updateEnv(U.uHor.value, U.uHor.value.clone().lerp(eS, 0.5), eG, sunDir, day * (1 - hz), null);
    envUni.uZen.value.copy(eS);

    // ---- surface things
    updateSpaceCentre(F, b, envV, dist);
    updateScenery(F, b, near, dist);
    updateClouds(F, b, camAlt);

    // ---- vessels, engine glow, plasma, vapour cone, particles
    syncVessels(F, dt, dist);
    vaporCone(F, dt);
    updateParticles(F, envV);
    syncCombat(F);

    // ---- shadows fitted around the active craft
    if (S.sun.castShadow) {
      const ext = v.parts.length ? Math.max(v.bounds.maxX - v.bounds.minX, v.bounds.maxY - v.bounds.minY) : 10;
      const half = Math.max(25, ext * 2.5), sc = S.sun.shadow.camera;
      if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 0.5; sc.far = half * 8; sc.updateProjectionMatrix(); }
      S.sun.position.copy(sunDir).multiplyScalar(half * 4);
    }
    S.glowU.uScale.value = (H * renderer.getPixelRatio()) / (2 * TANH);
    S.cityU.uScale.value = S.glowU.uScale.value;
    S.dotU.uScale.value = S.glowU.uScale.value;

    runJobs(hi ? 4 : 2.5);
    renderer.setRenderTarget(null);
    renderer.clear();
    if (!api.skipDraw) renderer.render(spaceScene, camera);
    renderer.clearDepth();
    if (!api.skipDraw) renderer.render(localScene, camera);
  }

  function updateBodies(F, cur, env, dist) {
    camera.updateMatrixWorld();
    const t = F.time, pxPerRad = H / (2 * TANH), dots = S.dots.geometry.attributes;
    const sunAbs = bodyPos(SUN, t), camSim = toSim(camera.position.x, camera.position.y, camera.position.z, v3());
    bodies.forEach((e, k) => {
      const b = e.b, p = bodyPos(b, t), x = p.x - camAbs.x, y = p.y - camAbs.y, z = -camAbs.z;
      const cx = x - camSim.x, cy = y - camSim.y, cz = z - camSim.z, d = Math.hypot(cx, cy, cz);
      const pr = (b.radius / Math.max(d, 1)) * pxPerRad;
      e.mesh.position.set(x, y, z);
      e.mesh.visible = pr > 0.6;
      if (e.sunV) e.sunV.copy(S.sunS.position).normalize().transformDirection(camera.matrixWorldInverse);
      if (e.glow) {
        e.glow.position.set(x, y, z);
        e.glow.scale.setScalar(Math.max(b.radius * 9, d * 0.09));
      }
      if (!b.star && !e.ready && pr > 40 && e.job) finishJob(e.job);
      // atmosphere glow seen from outside
      if (e.atm) {
        e.atm.position.set(x, y, z);
        e.atm.visible = pr > 2;
        const u = e.atmU;
        u.uCam.value.set(-cx / e.atmR, -cy / e.atmR, -cz / e.atmR);
        const sl = Math.hypot(p.x - sunAbs.x, p.y - sunAbs.y) || 1, cT = Math.cos(TILT);
        u.uSun.value.set(((sunAbs.x - p.x) / sl) * cT, ((sunAbs.y - p.y) / sl) * cT, Math.sin(TILT));
        u.uK.value = (b.haze ? 1.2 : 1) * smoothstep(b.atmoHeight * 0.4, b.atmoHeight * 1.4, d - b.radius);
      }
      if (e.deck) {
        e.deck.position.set(x, y, z);
        const alt = d - b.radius;
        if (b.clouds) {
          e.deck.rotation.z = t * 0.000002; // drifts like the 2D clouds
          e.deckMat.opacity = smoothstep(8000, 14000, alt);
        } else e.deckMat.opacity = smoothstep(e.deckAlt - 6000, e.deckAlt + 4000, alt);
        e.deck.visible = e.deckMat.opacity > 0.01 && pr > 1;
        // near its planet the deck must be drawn with the terrain (which is drawn after the far layer)
        const want = b === cur && patch.active ? localWorld : spaceWorld;
        if (e.deck.parent !== want) want.add(e.deck);
      }
      if (e.atm) {
        const want = b === cur && patch.active ? localWorld : spaceWorld;
        if (e.atm.parent !== want) want.add(e.atm);
      }
      // dot when smaller than a couple of pixels
      dots.position.array[k * 3] = x; dots.position.array[k * 3 + 1] = y; dots.position.array[k * 3 + 2] = z;
      const m = C(b.colors.map), vis = (1 - smoothstep(0.8, 2, pr)) * (b.star ? 3 : 0.9);
      dots.aCol.array[k * 3] = lin(m[0]) * vis; dots.aCol.array[k * 3 + 1] = lin(m[1]) * vis; dots.aCol.array[k * 3 + 2] = lin(m[2]) * vis;
      dots.aSize.array[k] = 0;
    });
    S.dotU.uMin.value = 3 * Math.min(DPR, 2);
    dots.position.needsUpdate = dots.aCol.needsUpdate = dots.aSize.needsUpdate = true;
    const sun = bodies[0];
    // inside an atmosphere the Sun takes the sunset's colour
    sun.sunU.uK.value = 7 * (1 - 0.35 * env.sunset);
    sun.glow.material.color.setRGB(2.2, 1.9 - 0.6 * env.sunset, 1.5 - 0.8 * env.sunset);
  }

  // where the focus is over its body: angle around it and depth along the surface
  function focusSpot(F, b) { const bp = bodyPos(b, F.time); return Terrain.locate(b, camAbs.x - bp.x, camAbs.y - bp.y, camAbs.z, LOC); }
  const latK = (z, R) => Math.max(0.2, Math.cos(z / R)); // metres per radian of angle shrink away from the equator
  function updatePatch(F, b, near, camAlt, dist) {
    if (!near) { patch.active = false; patch.frame.visible = false; return; }
    const c = cfgOf(b), R = b.radius, L = focusSpot(F, b), a = L.a, z = L.z;
    const span = Math.min(R * 1.2, Math.sqrt(2 * R * camAlt + camAlt * camAlt) + Math.sqrt(2 * R * Math.max(c.hmax, 50)) + dist * 1.5);
    const moved = Math.hypot(wrapAngle(a - patch.a0) * R * latK(z, R), z - (patch.z0 || 0));
    const stale = patch.b !== b || moved > patch.span * 0.012 || span > patch.span * 1.6 || span < patch.span / 1.6;
    // nothing usable on show: another body, or the craft (rails warp, a teleport) far off the patch
    const lost = patch.b !== b || !patch.ready || moved > patch.span * 0.25 || span > patch.span * 3 || span < patch.span / 3;
    if (lost) {
      // rails warp can move the craft by thousands of km per frame: rebuild at most a few times a second
      if (clock - patch.at > 0.12 || patch.b !== b || !patch.ready) buildPatchNow(b, a, z, span);
      else { patch.active = false; patch.frame.visible = false; return; }
    } else if (stale && !pjob) { pjob = patchJob(patchB, b, a, z, span); pjobMs = 0; pjobSlice = 0; }
    if (pjob) {
      // a few milliseconds a frame; more as the craft nears the edge of what is on show
      const t0 = performance.now(), budget = (Settings.high ? 4 : 3) + 16 * smoothstep(0.05, 0.2, moved / patch.span);
      let done = false;
      while (!done && performance.now() - t0 < budget) done = pjob.next().done;
      const dt = performance.now() - t0;
      pjobMs += dt; pjobSlice = Math.max(pjobSlice, dt);
      if (done) {
        pjob = null;
        note('patch', pjobMs); note('patchSlice', pjobSlice);
        swapPatch();
      }
    }
    patch.active = true;
    patch.frame.visible = true;
    placeFrame(patch.frame, b, patch.a0, F.time);
  }
  function placeFrame(obj, b, a0, t, h = 0) {
    const bp = bodyPos(b, t), r = b.radius + h;
    obj.position.set(bp.x + r * Math.cos(a0) - camAbs.x, bp.y + r * Math.sin(a0) - camAbs.y, -camAbs.z);
    obj.rotation.z = a0 - Math.PI / 2;
  }

  // Trees, rocks and buildings: rebuilt in the background as the craft moves (or the terrain under them is
  // replaced), all at once only when what is on show is unusable (another body, far from here).
  function updateScenery(F, b, near, dist) {
    const sc = S.scenery, cur = S.scen[0], fr = cur.frame;
    const on = near && patch.active && (b.trees || b.rocks) && dist < 9000;
    fr.visible = !!on;
    if (!on) { sc.job = null; return; }
    const R = b.radius, L = focusSpot(F, b), a = L.a, z = L.z;
    const rad = clamp(dist * 3 + 600, 800, 2400), moved = cur.b === b ? Math.hypot(wrapAngle(a - cur.a0) * R * latK(z, R), z - cur.z0) : Infinity;
    const stale = sc.dirty || moved > cur.rad * 0.25 || rad > cur.rad * 1.5 || rad < cur.rad / 1.5;
    if (cur.b !== b || moved > cur.rad * 0.8) {
      if (cur.b !== b || clock - (sc.at || 0) > 0.3) { buildSceneryNow(b, a, z, rad); sc.at = clock; sc.dirty = false; }
    } else if (stale && !sc.job) { sc.job = sceneryJob(S.scen[1], b, a, z, rad); sc.dirty = false; sc.ms = 0; sc.slice = 0; }
    if (sc.job) {
      const t0 = performance.now(), budget = (Settings.high ? 3 : 2) + 30 * smoothstep(0.35, 0.7, moved / cur.rad);
      let done = false;
      while (!done && performance.now() - t0 < budget) done = sc.job.next().done;
      const dt = performance.now() - t0;
      sc.ms += dt; sc.slice = Math.max(sc.slice, dt);
      if (done) { sc.job = null; note('scenery', sc.ms); note('scenerySlice', sc.slice); swapScenery(); sc.at = clock; }
    }
    const show = S.scen[0];
    show.frame.visible = true;
    placeFrame(show.frame, b, show.a0, F.time);
  }

  function updateClouds(F, b, camAlt) {
    const C0 = S.clouds, on = b === EARTH && camAlt < 12000 && patch.active;
    S.cloudFrame.visible = on;
    if (!on) { C0.job = null; C0.inside = 0; return; }
    const R = b.radius, drift = F.time * 0.000002, L = focusSpot(F, b), a = L.a - drift, z = L.z;
    const moved = C0.b === b ? Math.hypot(wrapAngle(a - C0.a0) * R, z - C0.z0) : Infinity;
    if (moved > 6000) { // a new body or a jump: all at once
      C0.job = null;
      const j = cumulusJob(b, a, z), t0 = performance.now();
      while (!j.next().done);
      note('clouds', performance.now() - t0);
    } else if (moved > 1500 && !C0.job) C0.job = cumulusJob(b, a, z);
    if (C0.job) {
      const t0 = performance.now();
      let done = false;
      while (!done && performance.now() - t0 < (Settings.high ? 2 : 1.5)) done = C0.job.next().done;
      if (done) C0.job = null;
    }
    placeFrame(S.cloudFrame, b, C0.a0 + drift, F.time);
    S.cloudFrame.updateMatrixWorld();
    camera.getWorldPosition(V1);
    S.cloudFrame.worldToLocal(V1);
    if (clock - C0.sortAt > 0.2) { C0.sortAt = clock; sortPuffs(V1); }
    // inside a cloud the world turns to white murk (the fog, next frame)
    let inside = 0;
    for (const v of C0.vols) {
      const dx = (V1.x - v[0]) / v[3], dy = (V1.y - v[1]) / v[4], dz = (V1.z - v[2]) / v[3], d = dx * dx + dy * dy + dz * dz;
      if (d < 1) inside = Math.max(inside, 1 - d);
    }
    C0.inside += (Math.min(1, inside * 2.5) - C0.inside) * 0.15;
    // sunlit tops, sky-tinted shadows, warmer at sunset, dark at night
    const e = envV, U = S.cloudU, day = e.day, warm = e.sunset;
    U.uLit.value.setRGB(1, lerp(0.97, 0.66, warm), lerp(0.94, 0.42, warm)).multiplyScalar(0.1 + 1.55 * day + 0.6 * warm);
    U.uShadow.value.copy(S.hemi.color).multiplyScalar(0.18 + 0.6 * day);
    U.uSunV.value.copy(S.sun.position).normalize().transformDirection(camera.matrixWorldInverse);
    U.uFogC.value.copy(localScene.fog.color); U.uFogD.value = localScene.fog.density;
  }

  function updateSpaceCentre(F, b, env, dist) {
    const ep = bodyPos(EARTH, F.time);
    const pa = EARTH.padAngle, r = EARTH.radius + EARTH.padHeight;
    const ox = ep.x + r * Math.cos(pa) - camAbs.x, oy = ep.y + r * Math.sin(pa) - camAbs.y;
    const on = Math.hypot(ox, oy, camAbs.z) < 60000 + dist;
    S.sc.visible = on;
    if (!on) return;
    if (S.scKit && Terrain.earthMap.state !== 'loading') { initLandmarks(S.scKit); S.scKit = null; }
    S.sc.position.set(ox, oy, -camAbs.z);
    S.sc.rotation.z = pa - Math.PI / 2;
    for (const m of S.nightMats) m.emissiveIntensity = env.night * 1.4;
    S.glowU.uAlpha.value = 0.08 + env.night * 1.2;
    S.blinkU.uAlpha.value = (Math.sin(clock * 5.2) > 0 ? 1 : 0.12) * (0.1 + env.night); // a glint by day, a beacon at night
    for (const r of S.rotors) r.rotation.x = clock * 1.15 + r.userData.phase;
    if (S.beam) {
      S.beam.rotation.y = clock * 0.9;
      S.beam.visible = env.night > 0.05;
      S.beamMat.opacity = 0.2 * env.night;
    }
    if (S.townU) S.townU.uAlpha.value = env.night * 1.4;
  }

  function syncVessels(F, dt, dist) {
    const have = typeof Parts3D !== 'undefined' && Parts3D.VesselMesh;
    const q = { dt, time: F.time, rho: 0, quality: Settings.high ? 'high' : 'low' };
    let glowK = 0;
    const camSim = toSim(camera.position.x, camera.position.y, camera.position.z, v3());
    for (const v of F.vessels) {
      if (!have || !v.parts.length || v.dead) continue;
      let e = vessels.get(v);
      if (!e) {
        e = { vm: new Parts3D.VesselMesh(v.parts, { radial: v.kind === 'rocket' }), root: new THREE.Group() };
        e.root.add(e.vm.group);
        localWorld.add(e.root);
        vessels.set(v, e);
      }
      e.seen = frameNo;
      const bp = bodyPos(v.body, F.time), x = bp.x + v.x - camAbs.x, y = bp.y + v.y - camAbs.y, z = v.z - camAbs.z;
      const ext = Math.max(v.bounds.maxX - v.bounds.minX, v.bounds.maxY - v.bounds.minY, 1);
      const d = Math.hypot(x - camSim.x, y - camSim.y, z - camSim.z);
      const vis = d < 50000 || (ext / d) * (H / (2 * TANH)) > 1;
      e.root.visible = vis;
      if (!vis) continue;
      e.root.position.set(x, y, z);
      e.root.quaternion.set(v.q.x, v.q.y, v.q.z, v.q.w);
      e.vm.group.position.set(-v.com.x, -v.com.y, 0);
      q.rho = airDensity(v.body, v.altitude());
      e.vm.sync(v, q);
      if (v === F.active) glowK = engineGlow(v, e.vm, x, y, z);
    }
    for (const [v, e] of vessels) if (e.seen !== frameNo) { localWorld.remove(e.root); e.vm.dispose(); vessels.delete(v); }
    if (!glowK) S.engine.intensity = 0;
    sheath(F);
  }
  function engineGlow(v, vm, x, y, z) {
    let ex = 0, ey = 0, ek = 0;
    for (const e of vm.exhaust || []) { ex += e.x * e.k; ey += e.y * e.k; ek += e.k; }
    if (ek <= 0) return 0;
    const o = qrot(v.q, ex / ek - v.com.x, ey / ek - v.com.y - 2, 0, T3);
    S.engine.position.set(x + o.x, y + o.y, z + o.z);
    S.engine.intensity = 1400 * Math.min(ek, 4) * (0.9 + Math.random() * 0.2);
    S.engine.distance = 70 + 25 * Math.sqrt(ek);
    return ek;
  }
  // Vapour cone: grows as the craft nears Mach 1 in thick air, flashes as it crosses, fades once supersonic.
  function vaporCone(F, dt) {
    const v = F.active, m = S.vapor;
    let want = 0;
    if (v && v.parts.length && !v.dead && effectMach(v) > 0.85) {
      const air = clamp(airDensity(v.body, v.altitude()) / 0.5, 0, 1), M = effectMach(v);
      want = air * (M < 1 ? smoothstep(0.9, 1, M) : 1 - smoothstep(1.02, 1.2, M));
    }
    S.vaporK += (want - S.vaporK) * (1 - Math.exp(-dt * (want > S.vaporK ? 9 : 3)));
    if (S.vaporK < 0.01 || !v || !v.parts.length) { m.visible = false; return; }
    const sp = v.speed() || 1, ux = v.vx / sp, uy = v.vy / sp, uz = v.vz / sp;
    const L = Math.max(v.bounds.maxY - v.bounds.minY, v.width, 2), r = Math.max(v.width * 0.6, v.depth * 0.5, 1.5) * 1.05;
    const len = L * 0.55, off = L * 0.3 - len / 2; // the nose of the bell just behind the craft's nose
    const bp = bodyPos(v.body, F.time), jitter = 1 + 0.03 * Math.sin(clock * 47);
    m.visible = true;
    m.position.set(bp.x + v.x + ux * off - camAbs.x, bp.y + v.y + uy * off - camAbs.y, v.z + uz * off - camAbs.z);
    m.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, V1.set(ux, uy, uz));
    m.scale.set(r * jitter, len, r * jitter);
    S.vaporU.uK.value = S.vaporK; S.vaporU.uT.value = clock;
  }
  // reentry plasma, like the 2D sheath: on the leading side, trailing behind
  function sheath(F) {
    const v = F.active, m = S.sheath;
    if (!v || !v.parts.length || !(v.heatFlux > 3e7)) { m.visible = false; return; }
    const k = clamp((v.heatFlux - 3e7) / 1.5e8, 0, 1), sp = v.speed() || 1, ux = v.vx / sp, uy = v.vy / sp, uz = v.vz / sp;
    const L = v.bounds.maxY - v.bounds.minY, w = Math.max(v.width, 2);
    const lv = qunrot(v.q, ux, uy, uz, T3);
    const wp = v.toWorld(v.com.x + lv.x * v.width * 0.55, v.com.y + lv.y * L * 0.5, lv.z * v.depth * 0.55), bp = bodyPos(v.body, F.time);
    m.visible = true;
    m.position.set(bp.x + wp.x - camAbs.x, bp.y + wp.y - camAbs.y, wp.z - camAbs.z);
    m.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, V1.set(-ux, -uy, -uz)); // trails behind
    m.scale.set(w * (0.75 + 0.5 * k), L * (1.2 + 1.6 * k), w * (0.75 + 0.5 * k));
    S.sheathU.uK.value = k; S.sheathU.uT.value = clock;
  }

  // ------------------------------------------------------------------ per frame: hangar
  // Building in 3D: the blueprint is the plane z = 0 of S.design (part space), seen in perspective. While
  // a part is being dragged the craft's place, the camera's target and its turn are held still (they
  // otherwise follow the craft's size), so the plane doesn't slide under the pointer.
  const bv = { edit: false, frozen: null, last: null, pan: { x: 0, y: 0, z: 0 }, ghosts: [], tinted: new Set(), tgt: null };
  function builderLayout(B) {
    const kind = (typeof VEHICLE_KINDS !== 'undefined' && VEHICLE_KINDS[B.kind || 'rocket']) || { launchRot: 0 };
    const rot = kind.launchRot || 0, c = Math.cos(rot), s = Math.sin(rot);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of B.parts) {
      const r = partRect(p);
      for (const [px, py] of [[r.l, r.b], [r.r, r.b], [r.l, r.t], [r.r, r.t]]) {
        const X = c * px - s * py, Y = s * px + c * py;
        x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
    }
    if (!B.parts.length) { x0 = -1; x1 = 1; y0 = 0; y1 = 4; }
    return { rot, lift: -y0 + 0.01, size: Math.max(x1 - x0, y1 - y0, 2), tx: (x0 + x1) / 2, ty: (y1 - y0) / 2 };
  }
  // The part being placed (and its mirror twin): see-through, blue where it fits, red where it can't go.
  function syncGhosts(list, radial) {
    for (let i = 0; i < Math.max(list.length, bv.ghosts.length); i++) {
      const want = list[i], g = bv.ghosts[i];
      const key = want ? `${want.type},${want.rot || 0},${want.flip ? 1 : 0},${radial ? 1 : 0}` : '';
      if (g && g.key !== key) { Parts3D.freeGhost(g.rig); bv.ghosts[i] = null; }
      if (!want) continue;
      let G = bv.ghosts[i];
      if (!G) {
        const p = { def: PARTS[want.type], type: want.type, x: want.x, y: want.y, rot: want.rot || 0, flip: !!want.flip, deployed: 0 };
        const rig = Parts3D.ghost(p, radial);
        S.design.add(rig.root); if (rig.twin) S.design.add(rig.twin);
        G = bv.ghosts[i] = { key, rig };
      }
      const p = G.rig.part;
      p.x = want.x; p.y = want.y;
      Parts3D.place(G.rig);
      if (want.ok) Parts3D.tint(G.rig, 0.25, 0.6, 1, 0.45); else Parts3D.tint(G.rig, 1, 0.12, 0.08, 1.1);
    }
    bv.ghosts.length = list.length;
  }
  function renderBuilder(B, dt) {
    if (!api.ready || !shown || !B) return;
    mode = 'builder';
    dt = clamp(dt || 0, 0, 0.1);
    clock += dt;
    applyQuality();
    const bd = S.bd, have = typeof Parts3D !== 'undefined' && Parts3D.VesselMesh, radial = (B.kind || 'rocket') === 'rocket';
    // rebuild the meshes only when parts come, go, flip or change kind; moving and turning them is cheap
    let snap = String(B.parts.length) + (B.kind || '');
    for (const p of B.parts) snap += `|${p.id},${p.type},${p.flip ? 1 : 0}`;
    if (snap !== bd.snap || bd.parts !== B.parts) {
      if (bd.vm) { S.design.remove(bd.vm.group); bd.vm.dispose(); bd.vm = null; }
      if (have && B.parts.length) { bd.vm = new Parts3D.VesselMesh(B.parts, { builder: true, radial }); S.design.add(bd.vm.group); }
      bd.snap = snap; bd.parts = B.parts; bd.att = ''; bv.tinted.clear();
    }
    const att = B.parts.map((p) => (B.attached && B.attached.has(p.id) ? 1 : 0)).join('');
    if (bd.vm && att !== bd.att) { for (const p of B.parts) bd.vm.setOpacity(p, B.attached && B.attached.has(p.id) ? 1 : 0.4); bd.att = att; }
    if (bd.vm) bd.vm.sync({ parts: B.parts }, { dt, time: clock, rho: 0, quality: Settings.high ? 'high' : 'low' });
    // selection (amber), hover (faint) and a dragged part that can't go where it is (red)
    if (bd.vm) {
      const want = new Map(), d = B.drag, sel = B.selected;
      if (B.hover3d) want.set(B.hover3d, [1, 0.72, 0.3, 0.18]);
      if (sel) for (const p of B.multi ? B.sel : [sel, sel.mirror]) if (p) want.set(p, [1, 0.62, 0.15, 0.42]);
      if (d && d.part && d.ghost && !d.ghost.ok) for (const p of d.group || [d.part, d.part.mirror]) if (p) want.set(p, [1, 0.12, 0.08, 1.1]);
      for (const p of bv.tinted) if (!want.has(p)) bd.vm.setTint(p, 0, 0, 0, 0);
      for (const [p, t] of want) bd.vm.setTint(p, t[0], t[1], t[2], t[3]);
      bv.tinted = new Set(want.keys());
    }
    syncGhosts(have && B.ghosts ? B.ghosts() : [], radial);
    // rotate by the kind's launch attitude and rest the lowest point on the floor
    const L = bv.frozen || (bv.last = builderLayout(B));
    if (!bv.tgt || bv.frozen) bv.tgt = { lift: L.lift, tx: L.tx, ty: L.ty, size: L.size };
    else { const k = 1 - Math.exp(-dt * 10); for (const q of ['lift', 'tx', 'ty', 'size']) bv.tgt[q] += (L[q] - bv.tgt[q]) * k; }
    const T = bv.tgt;
    S.design.rotation.z = L.rot;
    S.design.position.set(0, T.lift, 0);
    const size = T.size, tx = T.tx + bv.pan.x, ty = T.ty + bv.pan.y, tz = bv.pan.z;
    // turntable until the player grabs it; while a part is being placed, keep the blueprint facing the camera
    // within ~45° so the pointer can always find it
    if (bc.auto) bc.ty += 0.25 * dt;
    if (bv.edit) { const n = Math.round(bc.ty / Math.PI) * Math.PI; bc.ty = n + clamp(bc.ty - n, -0.8, 0.8); }
    const k = 1 - Math.exp(-dt * 14);
    bc.yaw += (bc.ty - bc.yaw) * k; bc.pitch += (bc.tp - bc.pitch) * k;
    const scale = B.cam && B.cam.scale ? B.cam.scale : 26, dist = (H / 2) / scale / TANH, cp = Math.cos(bc.pitch);
    bcam.position.set(tx + dist * Math.sin(bc.yaw) * cp, Math.max(0.3, ty + dist * Math.sin(bc.pitch)), tz + dist * Math.cos(bc.yaw) * cp);
    bcam.up.set(0, 1, 0);
    bcam.lookAt(tx, ty, tz);
    bcam.far = dist * 4 + 600; bcam.near = Math.max(0.02, dist / 2000);
    // keep the craft where the 2D blueprint shows it, clear of the side and bottom panels (easing when a
    // panel opens; held still while a part is dragged)
    let ox = 0, oy = 0;
    try { const a = B.viewArea(); ox = a.cx - W / 2; oy = a.cy - H / 2; } catch (err) { ox = oy = 0; }
    if (!bv.off) bv.off = { x: ox, y: oy };
    else if (!bv.frozen) { const kk = 1 - Math.exp(-dt * 10); bv.off.x += (ox - bv.off.x) * kk; bv.off.y += (oy - bv.off.y) * kk; }
    bcam.setViewOffset(W, H, -bv.off.x, -bv.off.y, W, H);
    bcam.updateProjectionMatrix();
    bcam.updateMatrixWorld();
    S.design.updateMatrixWorld();
    builderMarkers(B, dist);
    // lights and shadow box sized to the craft
    S.key.position.set(tx + size * 1.2, ty + size * 2.2, size * 1.6);
    S.key.target.position.set(tx, ty * 0.5, 0);
    const sc = S.key.shadow.camera, half = Math.round(size * 0.9 + 2);
    if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 0.1; sc.far = size * 8 + 20; sc.updateProjectionMatrix(); }
    S.rim.position.set(tx - size, ty + size, -size * 2);
    studio.fog.near = dist * 1.4 + size; studio.fog.far = dist * 3.5 + size * 4 + 60;
    updateEnv(new THREE.Color(0.32, 0.4, 0.55), new THREE.Color(0.08, 0.12, 0.2), new THREE.Color(0.02, 0.04, 0.08), V1.set(0.4, 0.8, 0.45).normalize(), 2.5, 'studio');
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(studio, bcam);
  }
  // Centre of mass (yellow and black) and, for planes, centre of lift (blue), drawn over the craft at a
  // fixed size on screen, as on the blueprint.
  function builderMarkers(B, dist) {
    if (!S.marks) {
      const mk = (col) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.95, fog: false }));
        m.renderOrder = 20; S.design.add(m); return m;
      };
      S.marks = { com: mk(0xffd23f), col: mk(0x4aa8ff) };
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.22, 8, 24), new THREE.MeshBasicMaterial({ color: 0x14181f, depthTest: false, fog: false }));
      ring.renderOrder = 21; S.marks.com.add(ring);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.36, 0.36), new THREE.MeshBasicMaterial({ color: 0x4aa8ff, depthTest: false, fog: false }));
      bar.renderOrder = 21; S.marks.col.add(bar);
    }
    const r = (7 * 2 * dist * TANH) / H; // ~7 px
    const put = (m, at, on) => {
      m.visible = !!(on && at);
      if (!m.visible) return;
      m.position.set(at.x, at.y, 0); m.scale.setScalar(r);
      m.quaternion.copy(bcam.quaternion).premultiply(Q1.copy(S.design.quaternion).invert()); // face the camera
    };
    const show = !!(B.markers3d && B.markers3d());
    put(S.marks.com, B.com, show);
    put(S.marks.col, B.col, show && B.kind === 'plane');
  }

  // ------------------------------------------------------------------ quality, sizing, API
  // Adaptive resolution: when frames run long, render fewer pixels (down to 55%) and win them back when
  // there is time to spare. The HUD is HTML, so it stays sharp either way.
  const perf = { ema: 1 / 60, scale: 1, at: 0 };
  function adaptResolution(dt) {
    if (!(dt > 0)) return;
    perf.ema += (Math.min(dt, 0.1) - perf.ema) * 0.08;
    if (clock - perf.at < 0.6) return;
    let k = perf.scale;
    if (perf.ema > 1 / 42) k = Math.max(0.55, k - 0.08);
    else if (perf.ema < 1 / 57) k = Math.min(1, k + 0.04);
    if (k !== perf.scale) { perf.scale = k; perf.at = clock; renderer.setPixelRatio(basePixelRatio() * k); renderer.setSize(W, H, true); }
  }
  const basePixelRatio = () => (Settings.high ? Math.min(DPR, 1.75) : 1);
  function applyQuality() {
    const hi = Settings.high;
    if (hi === high) return;
    high = hi;
    S.sun.castShadow = hi; S.key.castShadow = hi;
    allocPatch();
    patch.b = patchB.b = null; patch.ready = patchB.ready = false;
    S.scenery.dirty = true; S.clouds.b = null;
    resize(W, H, DPR);
  }
  function resize(w, h, dpr) {
    W = Math.max(1, w); H = Math.max(1, h); DPR = dpr || 1;
    if (!renderer) return;
    renderer.setPixelRatio(basePixelRatio() * perf.scale);
    renderer.setSize(W, H, true);
    camera.aspect = bcam.aspect = W / H;
    camera.updateProjectionMatrix(); bcam.updateProjectionMatrix();
  }
  function activeCam() { return mode === 'builder' ? bcam : camera; }
  function scenePoint(ax, ay, az, out) {
    if (mode === 'builder') return out.set(ax, ay, az || 0).applyMatrix4(S.design.matrixWorld);
    toView(ax - camAbs.x, ay - camAbs.y, (az || 0) - camAbs.z, T3);
    return out.set(T3.x, T3.y, T3.z);
  }

  buildPatchNow = timed('patchNow', buildPatchNow); buildSceneryNow = timed('sceneryNow', buildSceneryNow);
  // ------------------------------------------------------------------ combat: tracers, missiles, bombs and targets
  const CB = { ready: false };
  function initCombat() {
    CB.ready = true;
    const N = 700;
    CB.lineGeo = new THREE.BufferGeometry();
    CB.lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
    CB.lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
    CB.lines = new THREE.LineSegments(CB.lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    CB.lines.frustumCulled = false; CB.lines.renderOrder = 7; CB.N = N;
    CB.headGeo = new THREE.BufferGeometry();
    CB.headGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    CB.headGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    CB.heads = new THREE.Points(CB.headGeo, new THREE.PointsMaterial({ size: 1.1, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    CB.heads.frustumCulled = false; CB.heads.renderOrder = 7;
    localWorld.add(CB.lines, CB.heads);
    const m = (c, r = 0.5, me = 0.3) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: me });
    CB.mat = { olive: m('#56603f', 0.8, 0.1), dark: m('#2e3338', 0.5, 0.6), grey: m('#7d8790', 0.6, 0.3), concrete: m('#8c8a84', 0.95, 0), white: m('#e9ecef', 0.4, 0.1),
      navy: m('#5b6670', 0.6, 0.35), orange: m('#ff7a1a', 0.5, 0.1), wreck: m('#1d1b19', 0.95, 0), tyre: m('#1b1e22', 0.9, 0), sand: m('#b9a77c', 0.8, 0.05) };
    // stores in flight, pointing along +y
    const store = (r, l, mat, finR) => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 10), mat)); const nose = new THREE.Mesh(new THREE.ConeGeometry(r, r * 3, 10), mat); nose.position.y = l / 2 + r * 1.5; g.add(nose);
      for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(finR, l * 0.18, 0.02), CB.mat.dark); f.position.y = -l * 0.4; f.rotation.y = (i * Math.PI) / 2 + Math.PI / 4; f.translateX(finR / 2); g.add(f); } return g; };
    CB.kinds = { missile: () => store(0.1, 2.7, CB.mat.white, 0.35), rocket: () => store(0.05, 1.5, CB.mat.grey, 0.15), bomb: () => store(0.19, 1.8, CB.mat.olive, 0.4) };
    CB.pool = { missile: [], rocket: [], bomb: [] };
    CB.tg = new Map(); // target -> model
  }
  // Target models (x forward, y up, metres)
  function targetModel(kind) {
    const M = CB.mat, g = new THREE.Group(), B = (w, h, d, x, y, z, mat) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    const C = (r, h, x, y, z, mat, rx = 0, rz = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; g.add(o); return o; };
    switch (kind) {
      case 'tank': B(6.6, 1.4, 3.4, 0, 0.9, 0, M.olive); B(6.8, 0.8, 0.6, 0, 0.5, 1.5, M.tyre); B(6.8, 0.8, 0.6, 0, 0.5, -1.5, M.tyre); B(3, 0.9, 2.4, -0.3, 2.05, 0, M.olive); C(0.13, 4, 2.9, 2.1, 0, M.dark, 0, Math.PI / 2); break;
      case 'truck': B(2, 2.1, 2.3, 2.6, 1.6, 0, M.olive); B(4.6, 2.5, 2.4, -0.9, 1.8, 0, M.sand); for (const x of [2.5, -0.5, -2.4]) for (const z of [-1.1, 1.1]) C(0.5, 0.35, x, 0.5, z, M.tyre, Math.PI / 2); break;
      case 'radar': B(3, 2, 3, 0, 1, 0, M.grey); C(0.25, 4, 0, 4, 0, M.dark); CB.dish = B(0.3, 2.6, 4.4, 0, 6.2, 0, M.white); g.userData.spin = CB.dish; break;
      case 'bunker': B(10, 3.4, 8, 0, 1.7, 0, M.concrete); B(10.2, 0.4, 0.6, 0, 2.4, 3.95, M.dark); break;
      case 'aa': C(1.7, 1, 0, 0.5, 0, M.olive); { const t = new THREE.Group(); t.position.y = 1.4; g.add(t); const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8), M.dark), b2 = b1.clone(); b1.position.set(1.4, 0.9, 0.3); b2.position.set(1.4, 0.9, -0.3); b1.rotation.z = b2.rotation.z = -1; t.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), M.olive), b1, b2); g.userData.turret = t; } break;
      case 'sam': B(4, 1.2, 2.6, 0, 0.6, 0, M.olive); { const t = new THREE.Group(); t.position.set(0, 1.6, 0); t.rotation.z = 0.6; g.add(t); for (const z of [-0.7, -0.25, 0.25, 0.7]) { const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 4, 10), M.grey); tube.rotation.z = Math.PI / 2; tube.position.set(0, 0, z); t.add(tube); } } break;
      case 'boat': B(14, 2.2, 4, 0, 0.6, 0, M.navy); B(4, 2, 3, -1, 2.6, 0, M.white); C(0.08, 3, -1, 4.8, 0, M.dark); break;
      case 'ship': B(42, 4, 9, 0, 1.5, 0, M.navy); B(14, 5, 7, -4, 6, 0, M.grey); B(4, 3, 4, 10, 4.6, 0, M.grey); C(0.3, 9, -4, 12, 0, M.dark); C(0.15, 5, 14, 5, 0, M.dark, 0, Math.PI / 2); break;
      case 'drone': C(0.35, 4.2, 0, 0, 0, M.orange, 0, Math.PI / 2); B(1, 0.1, 5, 0.2, 0, 0, M.orange); B(0.6, 0.9, 0.08, -1.9, 0.45, 0, M.orange); B(0.5, 0.08, 1.8, -1.9, 0, 0, M.orange); break;
    }
    return g;
  }
  const CF = { up: null, f: null, r: null, m: null };
  function syncCombat(F) {
    if (typeof Combat === 'undefined') return;
    if (!CB.ready) initCombat();
    const t = F.time;
    // tracers: a streak behind each tracer round, with a bright head
    const shots = Combat.shots, pa = CB.lineGeo.attributes.position.array, ca = CB.lineGeo.attributes.color.array, ha = CB.headGeo.attributes.position.array, hc = CB.headGeo.attributes.color.array;
    let n = 0;
    const used = { missile: 0, rocket: 0, bomb: 0 };
    for (const s of shots) {
      const bp = bodyPos(s.b, t), x = bp.x + s.x - camAbs.x, y = bp.y + s.y - camAbs.y, z = s.z - camAbs.z;
      if (s.k === 'bullet') {
        if (!s.tracer || n >= CB.N) continue;
        const k = 0.028, c = s.enemy ? [1, 0.35, 0.2] : s.blast ? [1, 0.75, 0.35] : [1, 0.85, 0.45];
        pa.set([x, y, z, x - s.vx * k, y - s.vy * k, z - s.vz * k], n * 6);
        ca.set([c[0], c[1], c[2], c[0] * 0.15, c[1] * 0.1, c[2] * 0.05], n * 6);
        ha.set([x, y, z], n * 3); hc.set(c, n * 3);
        n++;
        continue;
      }
      const kk = s.k === 'torp' ? 'bomb' : s.k, pool = CB.pool[kk]; // a torpedo in the water looks like the bomb it was
      let o = pool[used[kk]];
      if (!o) { o = CB.kinds[kk](); pool.push(o); localWorld.add(o); }
      used[kk]++;
      o.visible = true;
      o.position.set(x, y, z);
      o.scale.setScalar(s.small ? 0.35 : 1); // cluster bomblets
      V1.set(s.dx || 0, s.dy || 1, s.dz || 0).normalize();
      o.quaternion.setFromUnitVectors(V2.set(0, 1, 0), V1);
    }
    for (const k in CB.pool) for (let i = used[k]; i < CB.pool[k].length; i++) CB.pool[k][i].visible = false;
    CB.lineGeo.setDrawRange(0, n * 2); CB.headGeo.setDrawRange(0, n);
    for (const g of [CB.lineGeo, CB.headGeo]) { g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; }
    CB.lines.visible = CB.heads.visible = n > 0;
    // targets: placed on the ground, sea or sky, facing the way they go; wrecks when destroyed
    const seen = new Set();
    for (const e of Combat.targets) {
      if (!e.pos) continue;
      const bp = bodyPos(EARTH, t), x = bp.x + e.pos.x - camAbs.x, y = bp.y + e.pos.y - camAbs.y, z = e.pos.z - camAbs.z;
      if (Math.hypot(x, y, z) > 30000) continue;
      let o = CB.tg.get(e);
      if (!o || o.userData.kind !== e.kind) { if (o) localWorld.remove(o); o = targetModel(e.kind); o.userData.kind = e.kind; CB.tg.set(e, o); localWorld.add(o); }
      seen.add(e);
      o.visible = true;
      o.position.set(x, y, z);
      const fr = surfaceFrame(e.pos.x, e.pos.y, e.pos.z);
      let fx, fy, fz;
      if (e.vel && Math.hypot(e.vel.x, e.vel.y, e.vel.z) > 0.5) { fx = e.vel.x; fy = e.vel.y; fz = e.vel.z; } else { const c = Math.cos(e.heading || 0), s = Math.sin(e.heading || 0); fx = c * fr.east.x - s * fr.north.x; fy = c * fr.east.y - s * fr.north.y; fz = c * fr.east.z - s * fr.north.z; }
      const k = fx * fr.up.x + fy * fr.up.y + fz * fr.up.z, up = fr.up;
      if (!e.def.air) { fx -= up.x * k; fy -= up.y * k; fz -= up.z * k; }
      const f = V1.set(fx, fy, fz).normalize(), u = V2.set(up.x, up.y, up.z), r = new THREE.Vector3().crossVectors(f, u).normalize();
      u.crossVectors(r, f);
      M1.makeBasis(f, u, r); o.quaternion.setFromRotationMatrix(M1);
      if (!e.alive && !o.userData.dead) { o.userData.dead = true; o.traverse((m) => { if (m.isMesh) m.material = CB.mat.wreck; }); o.scale.set(1, 0.55, 1); if (e.def.air) o.visible = false; }
      if (e.alive && o.userData.dead) { localWorld.remove(o); CB.tg.delete(e); } // a fresh one takes its place next frame
      if (e.alive && o.userData.spin) o.userData.spin.rotation.y = t * 1.4;
      if (e.alive && o.userData.turret && e.firing) o.userData.turret.rotation.y = Math.sin(t * 3) * 0.3;
    }
    for (const [e, o] of CB.tg) if (!seen.has(e)) { localWorld.remove(o); CB.tg.delete(e); }
  }

  // ------------------------------------------------------------------ the globe (map view)
  // The planet as a lit globe, seen from a camera GlobeView aims (body-relative sim coordinates, north up).
  // Its texture is the space view's; up close a sharper tile of the real map is painted for the region in view.
  const GL = { scene: null, cam: null, mesh: null, mat: null, light: null, tile: null, tileMat: null, job: null, want: null, bg: null };
  function initGlobe() {
    GL.scene = new THREE.Scene();
    GL.cam = new THREE.PerspectiveCamera(FOV, 1, 1, 1e9);
    GL.mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    GL.mesh = new THREE.Mesh(S.sphere, GL.mat);
    GL.light = new THREE.DirectionalLight(0xffffff, 1.7);
    GL.scene.add(GL.mesh, GL.light, GL.light.target, new THREE.HemisphereLight(0xdfe9ff, 0x404650, 1.25));
    GL.tileMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    GL.tile = new THREE.Mesh(new THREE.BufferGeometry(), GL.tileMat);
    GL.tile.visible = false; GL.tile.renderOrder = 1;
    GL.scene.add(GL.tile);
    GL.bg = new THREE.Color('#05080f'); GL.oc = new THREE.Color();
  }
  // A square of the real map around (a, phi) (sim angle and latitude), half a side of s radians, painted at
  // n x n texels with hill shading; built a few rows per frame and swapped in when done.
  function* tileJob(b, a0, p0, s, n) {
    const c = cfgOf(b), R = c.R, sa = s / Math.max(Math.cos(p0), 0.05), N1 = n + 1, hs = new Float32Array(N1 * N1);
    const A = (i) => a0 + (i / n - 0.5) * 2 * sa, Ph = (j) => clamp(p0 + (j / n - 0.5) * 2 * s, -1.55, 1.55);
    const exact = s * R < 15000; // up close: the ground as the game shapes it (cliffs, the runway's island), not the raw map
    for (let j = 0; j <= n; j++) {
      const phi = Ph(j);
      for (let i = 0; i <= n; i++) hs[j * N1 + i] = exact ? h3dAt(c, A(i), phi * R) : contAt(c, A(i), phi);
      if ((j & 1) === 1) yield;
    }
    const data = new Uint8Array(n * n * 4), out = [0, 0, 0], cell = (2 * s * R) / n;
    for (let j = 0; j < n; j++) {
      const phi = Ph(j + 0.5), z = phi * R;
      for (let i = 0; i < n; i++) {
        const a = A(i + 0.5), k = j * N1 + i;
        const h = (hs[k] + hs[k + 1] + hs[k + N1] + hs[k + N1 + 1]) / 4;
        bioAt(a, z);
        if (h < -8) mixC(P.oceanD, P.oceanS, 0.55 * smoothstep(-700, -30, h) ** 2, out); // open sea: by depth alone (the photo's coastal tint makes a square)
        else paint(c, h, 0.5, h, 0, 0, phi, true, out);
        if (Terrain.lakeAt(a, z) > 0.3) mixC(out, LAKE_D, 0.85, out);
        if (h > 0) { // light from the north-west (map convention): east is decreasing angle, north is +j here
          const dE = (hs[k] + hs[k + N1] - hs[k + 1] - hs[k + N1 + 1]) / (2 * cell), dN = (hs[k + N1] + hs[k + N1 + 1] - hs[k] - hs[k + 1]) / (2 * cell);
          const sh = clamp(1 + (dE - dN) * 2.2, 0.62, 1.32);
          out[0] *= sh; out[1] *= sh; out[2] *= sh;
        }
        const o = (j * n + i) * 4, ex = Math.min(i, j, n - 1 - i, n - 1 - j) / n;
        data[o] = clamp(out[0], 0, 255); data[o + 1] = clamp(out[1], 0, 255); data[o + 2] = clamp(out[2], 0, 255);
        data[o + 3] = 255 * smoothstep(0, 0.12, ex); // fade into the globe's own texture at the edges
      }
      if ((j & 7) === 7) yield;
    }
    // the curved patch it lies on
    const M = 40, pos = [], uv = [], idx = [], lift = R * 1e-4;
    for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) {
      const a = A((i / M) * n), phi = Ph((j / M) * n), r = R + lift, cp = Math.cos(phi);
      pos.push(r * cp * Math.cos(a), r * cp * Math.sin(a), r * Math.sin(phi)); uv.push(i / M, j / M);
    }
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { const q = j * (M + 1) + i; idx.push(q, q + 1, q + M + 2, q, q + M + 2, q + M + 1); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.anisotropy = maxAniso; tex.needsUpdate = true;
    if (GL.tileMat.map) GL.tileMat.map.dispose();
    GL.tile.geometry.dispose();
    GL.tile.geometry = geo; GL.tileMat.map = tex; GL.tileMat.needsUpdate = true;
    GL.have = { b, a0, p0, s };
  }
  // v: { body, cam: {x,y,z}, up: {x,y,z}, alt } (sim, body-relative). Returns false if it couldn't draw.
  function renderGlobe(v, dt) {
    if (!api.ready) return false;
    if (!GL.scene) initGlobe();
    mode = 'globe';
    clock += dt || 0;
    const b = v.body, R = b.radius, e = bodies.find((q) => q.b === b);
    if (e && e.mat && GL.mat.map !== e.mat.map) { GL.mat.map = e.mat.map; GL.mat.normalMap = e.mat.normalMap !== S.flatN ? e.mat.normalMap : null; GL.mat.needsUpdate = true; }
    if (e && !e.mat && e.sunU) { GL.mat.map = e.sunU.uMap.value; GL.mat.emissiveMap = GL.mat.map; GL.mat.emissive.setRGB(1, 1, 1); GL.mat.needsUpdate = true; }
    GL.mesh.scale.setScalar(R);
    const cam = GL.cam, d = Math.hypot(v.cam.x, v.cam.y, v.cam.z);
    cam.position.set(v.cam.x, v.cam.y, v.cam.z);
    cam.up.set(v.up.x, v.up.y, v.up.z);
    cam.lookAt(0, 0, 0);
    cam.near = Math.max(1, (d - R) * 0.2); cam.far = d + R * 1.2;
    cam.aspect = W / H; cam.updateProjectionMatrix();
    GL.light.position.copy(cam.position).add(V1.set(v.up.x, v.up.y, v.up.z).multiplyScalar(d * 0.6)); // from over the viewer's shoulder, a little north
    // the sharp tile: Earth with its map, close enough for the globe texture to blur
    const near = b === EARTH && cfgOf(b).mapped && v.alt < R * 0.45;
    if (near) {
      // s: half the width of the view (radians of arc), with a margin so small pans stay sharp
      const p0 = Math.asin(clamp(v.cam.z / d, -1, 1)), a0 = Math.atan2(v.cam.y, v.cam.x), s = clamp(((v.alt * TANH) / R) * Math.max(1, W / H) * 1.15, 0.003, 0.45);
      const h = GL.have, off = h && h.b === b ? Math.hypot(wrapAngle(a0 - h.a0) * Math.cos(p0), p0 - h.p0) / h.s : Infinity;
      const stale = !h || h.b !== b || off > 0.45 || s / h.s > 1.25 || s / h.s < 0.45;
      if (stale && !GL.job) GL.job = tileJob(b, a0, p0, s * 1.3, s * R < 12000 ? 256 : Settings.high ? 512 : 384);
    }
    if (GL.job) {
      const t0 = performance.now();
      while (performance.now() - t0 < 10) if (GL.job.next().done) { GL.job = null; break; }
    }
    GL.tile.visible = near && !!GL.have && GL.have.b === b;
    renderer.setRenderTarget(null);
    const oc = renderer.getClearColor(GL.oc), oa = renderer.getClearAlpha();
    renderer.setClearColor(GL.bg, 1);
    renderer.clear();
    if (!api.skipDraw) renderer.render(GL.scene, cam);
    renderer.setClearColor(oc, oa);
    return true;
  }

  Object.assign(api, {
    // draw calls and triangles in the last frame (for tuning)
    info() { return renderer ? { ...renderer.info.render, memory: { ...renderer.info.memory }, pixelRatio: renderer.getPixelRatio(), t: costs } : null; },
    skipDraw: false, // tests: run every frame's work but draw nothing
    get supported() {
      if (supported == null) {
        try {
          const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
          supported = !!gl;
          const ext = gl && gl.getExtension('WEBGL_lose_context');
          if (ext) ext.loseContext();
        } catch (e) { supported = false; }
      }
      return supported;
    },
    load() {
      if (loading) return loading;
      loading = new Promise((resolve, reject) => {
        const go = () => {
          try { init(); resolve(); } catch (e) { api.failed = true; reject(e); }
        };
        if (window.THREE) { go(); return; }
        const s = document.createElement('script');
        s.src = 'js/vendor/three.min.js';
        s.onload = () => (window.THREE ? go() : (api.failed = true, reject(new Error('three.js did not load'))));
        s.onerror = () => { api.failed = true; reject(new Error('three.js could not be loaded')); };
        document.head.appendChild(s);
      });
      return loading;
    },
    setVisible(on) {
      shown = !!on;
      if (canvas) canvas.style.display = shown ? 'block' : 'none';
    },
    resize,
    renderFlight,
    renderBuilder,
    renderGlobe,
    project(ax, ay, az) {
      if (!api.ready) return { x: 0, y: 0, behind: true };
      const cam = activeCam(), p = scenePoint(ax, ay, az, V1);
      const behind = V2.copy(p).applyMatrix4(cam.matrixWorldInverse).z > 0;
      p.project(cam);
      return { x: (p.x + 1) * 0.5 * W, y: (1 - p.y) * 0.5 * H, behind };
    },
    metresPerPixelAt(ax, ay, az) {
      if (!api.ready) return 1;
      const cam = activeCam(), d = Math.max(0.01, -scenePoint(ax, ay, az, V1).applyMatrix4(cam.matrixWorldInverse).z);
      return (2 * d * TANH) / H;
    },
    pickPart(cx, cy) {
      if (!api.ready) return null;
      const r = canvas.getBoundingClientRect();
      NDC.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      RAY.setFromCamera(NDC, activeCam());
      if (mode === 'builder') { const p = S.bd.vm && S.bd.vm.pick(RAY); return p ? { part: p } : null; }
      const F = typeof Flight !== 'undefined' ? Flight : null, list = [];
      if (F && F.active) list.push(F.active);
      for (const v of vessels.keys()) if (v !== (F && F.active)) list.push(v);
      for (const v of list) {
        const e = vessels.get(v);
        if (!e || !e.root.visible) continue;
        const p = e.vm.pick(RAY);
        if (p) return { vessel: v, part: p };
      }
      return null;
    },
    orbitBy(dx, dy) {
      const c = mode === 'builder' ? bc : fc;
      c.ty -= dx * 0.006;
      c.tp = clamp(c.tp + dy * 0.006, -1.25, 1.45);
      if (mode === 'builder') bc.auto = false;
    },
    // still: the hangar's turntable stays put (Fit), rather than spinning again
    resetCamera(still) {
      const c = mode === 'builder' ? bc : fc, d = mode === 'builder' ? [0.5, 0.16] : CAM0[fc.kind] || CAM0.rocket;
      const turns = Math.round((c.yaw - d[0]) / TAU) * TAU; // come back the short way
      c.ty = d[0] + turns; c.tp = d[1];
      if (mode === 'builder') { bc.auto = !still; bv.pan.x = bv.pan.y = bv.pan.z = 0; }
    },
    // ---- building in 3D
    // The point on the blueprint under the pointer, in part space, and the metres per pixel there; null
    // when the blueprint is seen edge-on (or behind the camera).
    // A blueprint point (part space) on screen, in CSS pixels; null if behind the camera.
    designToScreen(x, y) {
      if (!api.ready || mode !== 'builder') return null;
      V1.set(x, y, 0); S.design.localToWorld(V1);
      V2.copy(V1).applyMatrix4(bcam.matrixWorldInverse);
      if (V2.z > 0) return null;
      V1.project(bcam);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + (V1.x * 0.5 + 0.5) * r.width, y: r.top + (-V1.y * 0.5 + 0.5) * r.height };
    },
    designPoint(cx, cy) {
      if (!api.ready || mode !== 'builder') return null;
      const r = canvas.getBoundingClientRect();
      NDC.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      RAY.setFromCamera(NDC, bcam);
      const o = RAY.ray.origin, d = RAY.ray.direction;
      if (Math.abs(d.z) < 0.1) return null;
      const t = -o.z / d.z;
      if (!(t > 0)) return null;
      V1.copy(d).multiplyScalar(t).add(o);
      const fwd = V2.set(0, 0, -1).transformDirection(bcam.matrixWorld).dot(d) * t; // depth along the view
      S.design.worldToLocal(V1);
      return { x: V1.x, y: V1.y, mpp: (2 * fwd * TANH) / H };
    },
    // While a part is dragged: hold the craft and camera still and keep the blueprint facing the camera.
    editView(on) {
      bv.edit = !!on;
      bv.frozen = on ? bv.last : null;
      if (on) bc.auto = false;
    },
    // Slide the 3D view's target across the screen (two fingers, or the right mouse button).
    panBy(dx, dy) {
      if (!api.ready || !bv.tgt) return;
      const dist = Math.max(0.5, bcam.position.distanceTo(V1.set(bv.tgt.tx + bv.pan.x, bv.tgt.ty + bv.pan.y, bv.pan.z)));
      const mpp = (2 * dist * TANH) / H, e = bcam.matrixWorld.elements, lim = bv.tgt.size + 10;
      bv.pan.x = clamp(bv.pan.x - (e[0] * dx - e[4] * dy) * mpp, -lim, lim);
      bv.pan.y = clamp(bv.pan.y - (e[1] * dx - e[5] * dy) * mpp, -lim, lim);
      bv.pan.z = clamp(bv.pan.z - (e[2] * dx - e[6] * dy) * mpp, -lim, lim);
      bc.auto = false;
    },
  });
  return api;
})();
