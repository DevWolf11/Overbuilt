'use strict';
// Props: the solid scenery of ground play. Houses, barns, ruins, a church, stone walls, hedges, fences, trees, woods,
// bushes, boulders, hay bales, telegraph poles, and at the sandbox's tank yard garages, a fuel depot, sandbags, crates,
// containers and concrete blocks. Unlike the old scenery (render3d's sceneryJob: visual only, thinned by the quality
// setting) every prop is generated once per map from a fixed seed and the physics' own ground (Terrain.surfaceAt, which
// has the berms, and waterAt), never from the quality, so every player sees and hits the same ones: what you see is what you hit.
//
// Three maps: Highland Ridge (EARTH.arenas.highland, the real Earth map only): a village round zone B with its church,
// a ruined farm and stone walls on hilltop A, a farmstead, an orchard and hedges on slope C, woods on the flanks, fields
// with walls, hedges and fences round them, dirt roads between the pads and zones (painted on the arena's own ground
// mesh: paint), scattered trees, bushes and rocks. The Runway (EARTH.arenas.runway, any map): sheds, containers, sandbags,
// blocks and a few trees along the runway's sides. The space centre's island (the real map only): the tank yard (its pad
// EARTH.groundPads.yard, where Armour starts in a multiplayer sandbox), its driving course, a hamlet, a farm, groves,
// sheep walls, rocks and bushes.
//
// Each prop is made of colliders, each a yawed box, an upright cylinder or a sphere with flags: SHELL (stops shells:
// Armour.moveShell, and the ground update's own rockets and missiles), SIGHT (blocks Aim.sees and the HUD's aim ray: trees
// by their crowns, bushes low down), SOLID (an immovable obstacle to vehicles with running gear: Gear.bump, and to the
// ground AI's moves), CRUSH (falls over when a vehicle drives into it, on every screen: then it blocks nothing). Old
// designs never reach any of it: old weapons' shots (combat.js moveShot) don't test props, old vessels have no running
// gear, and the hooks sit behind the ground update's gates (test/ground.test.js counts the calls).
//
// Coordinates: (e, z) as the space centre has them (metres east along the track, and depth: game north is -z); yaw as
// placeOnSurface turns a craft: a prop's long side (its local x) runs along (cos yaw, -sin yaw) in (e, z), its front
// (local +z) faces (sin yaw, cos yaw). Colliders live in the sim's body-relative axes (precomputed), found through a
// 16 m spatial hash in (e, z).
const Props = (() => {
  const SH = 1, SI = 2, SO = 4, CR = 8; // collider flags
  const P_BOX = 0, P_ROOF = 1, P_CYL = 2, P_SPIRE = 3, P_CONIFER = 4, P_BROAD = 5, P_BUSH = 6, P_ROCK = 7, P_HEDGE = 8;
  const CELL = 16, TCELL = 64;
  // (the shell's quick looks use no Math functions: the test harness's Math is an object of its own, which V8 doesn't
  // see as the built-in, and a call to it costs a hundred times a multiplication there)
  const fl = (v) => { const t = v | 0; return t > v ? t - 1 : t; };
  const OCC = new Uint8Array(1 << 20), cube = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) & 0xfffff;
  // colours (sRGB hex); the renderer turns them linear
  const C = {
    white: 0xe9e3d5, cream: 0xddd2bb, stone: 0xa59d8e, grey: 0x8f8c84, tar: 0x2e2c2a, redw: 0x8e3326, ochre: 0xc9a46a,
    slate: 0x4c5159, slate2: 0x5d6168, tile: 0x9a4a36, tile2: 0x7d4434, turf: 0x627d3c, zinc: 0x7b8086, roofG: 0x55595e,
    barnR: 0x8a3a2b, barnG: 0x76797a, timber: 0x6e563b, wood: 0x7a6045, dark: 0x2f2a25, glass: 0x2c3a46, brick: 0x8a6f62,
    wall: 0xa39d90, wall2: 0x938d82, hedge: 0x3f5a2a, hedge2: 0x4b6431, conifer: 0x5d8a55, broad: 0x7aa05a, broad2: 0x92a84e,
    bush: 0x6d8f4a, rock: 0x7f7c74, rock2: 0x6b6862, bale: 0xc9ab5c, sand: 0xb39d6e, concrete: 0xa7a7a1, apron: 0x8b8c88, paint: 0xd8b13c, crate: 0x8a6b40,
    olive: 0x5f6b45, contB: 0x3f6f8f, contR: 0x9a4434, contG: 0x5f7f45, steel: 0xd6d9dc, rubber: 0x262626, pole: 0x5b4a36,
  };
  // The kinds (indices into K): what each is made of, its colliders and its pieces (see make). solid kinds are
  // buildings, walls, boulders, sandbags, crates, containers, tanks and blocks; crush kinds trees, hedges, fences,
  // bushes, bales, poles and tyres.
  const KINDS = ['house', 'barn', 'church', 'ruin', 'shed', 'garage', 'wall', 'hedge', 'fence', 'conifer', 'broadleaf', 'bush',
    'boulder', 'rock', 'bale', 'pole', 'sandbags', 'crate', 'container', 'fueltank', 'silo', 'block', 'tyres', 'slab'];
  const K = {};
  KINDS.forEach((k, i) => (K[k] = i));
  const BUILDING = new Set([K.house, K.barn, K.church, K.ruin, K.shed, K.garage]);
  const TREE = new Set([K.conifer, K.broadleaf]);

  // ---------------------------------------------------------------- state
  const S = {
    built: false, mapped: null, list: [], cols: [], grid: new Map(), roads: [], rgrid: new Map(), fields: [], maps: [], groups: [],
    stamp: new Uint32Array(0), q: 0, fallen: [], ver: 0, crushed: 0, passT: -1, hit: null, calls: 0, ms: 0, worst: 0, worstAt: '', top: 0, all: false, tops: new Map(), hgrid: new Map(),
  };
  const R = () => EARTH.radius;
  const gKey = (ix, iz) => (ix + 8192) * 16384 + (iz + 8192);
  // a point (e, z) h m over sea level in the sim's body-relative axes (into o)
  function simAt(e, z, h, o) {
    const a = siteAngle(EARTH, e), ph = z / R(), r = R() + h, cp = Math.cos(ph);
    o.x = r * cp * Math.cos(a); o.y = r * cp * Math.sin(a); o.z = r * Math.sin(ph);
    return o;
  }
  // the surface frame at (e, z): up U, east E (decreasing angle), depth W (+z, game south), into the arrays
  function frameAt(e, z, U, E, W) {
    const a = siteAngle(EARTH, e), ph = z / R(), ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(ph), sp = Math.sin(ph);
    U[0] = cp * ca; U[1] = cp * sa; U[2] = sp; E[0] = sa; E[1] = -ca; E[2] = 0; W[0] = -sp * ca; W[1] = -sp * sa; W[2] = cp;
  }
  const LOC = {};
  // (e, z) of a sim point (into o), and its height over sea level (o.h)
  function ezOf(x, y, z, o) {
    Terrain.locate(EARTH, x, y, z, LOC);
    o.e = -wrapAngle(LOC.a - EARTH.padAngle) * R(); o.z = LOC.z; o.h = LOC.r - R();
    return o;
  }
  const gH = (e, z) => Terrain.surfaceAt(EARTH, siteAngle(EARTH, e), z);
  const wet = (e, z) => Terrain.waterAt(EARTH, siteAngle(EARTH, e), z);

  // ---------------------------------------------------------------- a deterministic generator (mulberry32)
  function rng(seed) {
    let s = seed >>> 0;
    const f = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    f.r = (a, b) => a + (b - a) * f();
    f.pick = (L) => L[Math.floor(f() * L.length) % L.length];
    return f;
  }

  // ---------------------------------------------------------------- what each kind is made of
  // make(p) -> { cols: [[type 0 box | 1 cyl | 2 sphere, flags, ox, oy, oz, ha, hh, hw]] } in the prop's own frame (x
  // along its yaw, y up from its base, z across; ha/hw: half along/across, or the radius; hh half height), and pieces(p,
  // cb): cb(piece, x, y, z, sx, sy, sz, ry, rz, colour) for the renderer. H: the walls' height over the base (its lowest
  // corner) up to the eaves over its highest corner.
  const wallsH = (p) => p.h + (p.gt - p.g);
  function colliders(p) {
    const k = p.k, w = p.w, d = p.d, h = p.h, H = wallsH(p), out = [];
    const box = (f, x, y, z, a, hh, c) => out.push([0, f, x, y, z, a, hh, c]);
    if (k === K.house || k === K.barn || k === K.shed) { box(SH | SI | SO, 0, H / 2, 0, w / 2, H / 2, d / 2); box(SH | SI, 0, H + p.r2 / 2, 0, w / 2, p.r2 / 2, d / 4); }
    else if (k === K.garage) box(SH | SI | SO, 0, (H + 0.3) / 2, 0, w / 2, (H + 0.3) / 2, d / 2);
    else if (k === K.church) {
      box(SH | SI | SO, 0, H / 2, 0, w / 2, H / 2, d / 2); box(SH | SI, 0, H + p.r2 / 2, 0, w / 2, p.r2 / 2, d / 4);
      const T = p.tw, tx = -w / 2 - T / 2 + 0.6;
      box(SH | SI | SO, tx, (H + p.th) / 2, 0, T / 2, (H + p.th) / 2, T / 2); box(SH | SI, tx, H + p.th + 3, 0, T / 3, 3, T / 3);
    } else if (k === K.ruin) for (const s of ruinWalls(p)) box(SH | SI | SO, s[0], s[3] / 2, s[1], s[2] / 2, s[3] / 2, s[4] / 2);
    else if (k === K.wall) box(SH | SI | SO, 0, H / 2, 0, w / 2, H / 2, d / 2);
    else if (k === K.sandbags) box(SH | SI | SO, 0, H / 2, 0, w / 2, H / 2, d / 2);
    else if (k === K.hedge) box(SI | CR, 0, h / 2, 0, w / 2, h / 2, d / 2);
    else if (k === K.fence) box(CR, 0, 0.6, 0, w / 2, 0.6, 0.15);
    else if (k === K.conifer) { box(CR, 0, 1.5, 0, 0.4, 1.5, 0.4); out.push([1, SI, 0, h * 0.56, 0, p.r2 * 0.55, h * 0.4, 0]); }
    else if (k === K.broadleaf) { box(CR, 0, 1.5, 0, 0.45, 1.5, 0.45); out.push([2, SI, 0, h * 0.64, 0, p.r2 * 0.82, 0, 0]); }
    else if (k === K.bush) box(SI | CR, 0, h / 2, 0, p.r2 * 0.8, h / 2, p.r2 * 0.8);
    else if (k === K.boulder) box(SH | SI | SO, 0, h * 0.42, 0, w * 0.42, h * 0.42, d * 0.42);
    else if (k === K.rock) box(SH, 0, h * 0.4, 0, w * 0.4, h * 0.4, d * 0.4);
    else if (k === K.bale) box(SI | CR, 0, 0.75, 0, 0.6, 0.75, 0.75);
    else if (k === K.pole) box(CR, 0, 3, 0, 0.2, 3, 0.2);
    else if (k === K.crate || k === K.block || k === K.container) box(SH | SI | SO, 0, (H + 0.2) / 2, 0, w / 2, (H + 0.2) / 2, d / 2);
    else if (k === K.fueltank) box(SH | SI | SO, 0, 1.75, 0, w / 2, 1.6, d / 2);
    else if (k === K.silo) out.push([1, SH | SI | SO, 0, H / 2, 0, w / 2, H / 2, 0]);
    else if (k === K.tyres) box(CR, 0, 0.45, 0, 0.5, 0.45, 0.5);
    return out;
  }
  // a ruin's wall stretches: [x, z, length, height, thickness], from its own dice (p.v): gaps for a door and a
  // window, one side half fallen
  function ruinWalls(p) {
    if (p._rw) return p._rw;
    const w = p.w, d = p.d, h = wallsH(p), t = 0.55, f = rng(Math.floor(p.v * 1e9)), L = [];
    const run = (x0, x1, z, hx, along) => { if (x1 - x0 > 0.4) L.push(along ? [(x0 + x1) / 2, z, x1 - x0, hx, t] : [z, (x0 + x1) / 2, t, hx, x1 - x0]); };
    const dg = f.r(-w / 4, w / 4); // the door
    run(-w / 2, dg - 0.8, d / 2, h * f.r(0.75, 1), true); run(dg + 0.8, w / 2, d / 2, h * f.r(0.45, 0.95), true);
    const wg = f.r(-w / 5, w / 5); // the back: a window gap, its sill 1.1 m up, one end fallen
    run(-w / 2, wg - 0.7, -d / 2, h * f.r(0.6, 1), true); run(wg - 0.7, wg + 0.7, -d / 2, 1.1, true); run(wg + 0.7, w / 2, -d / 2, h * f.r(0.35, 0.8), true);
    const fall = f() < 0.5 ? -1 : 1; // (one gable end stands, the other is half down)
    run(-d / 2 + t, d / 2 - t, fall * w / 2, h * f.r(0.25, 0.45), false);
    const g2 = f.r(-d / 6, d / 6);
    run(-d / 2 + t, g2 - 0.6, -fall * w / 2, h * f.r(0.85, 1.15), false); run(g2 + 0.6, d / 2 - t, -fall * w / 2, h * f.r(0.7, 1.1), false);
    return (p._rw = L);
  }
  function pieces(p, cb) {
    const k = p.k, w = p.w, d = p.d, h = p.h, H = wallsH(p), s0 = 0.5; // (walls run half a metre into the ground)
    if (k === K.house || k === K.barn || k === K.shed) {
      cb(P_BOX, 0, (H - s0) / 2, 0, w, H + s0, d, 0, 0, p.c1);
      cb(P_ROOF, 0, H - 0.05, 0, w + (k === K.shed ? 0.4 : 0.7), p.r2, d + (k === K.shed ? 0.5 : 0.9), 0, 0, p.c2);
      const F = d / 2 + 0.03, B = -d / 2 - 0.03, base = H - h; // (the front faces +z; base: the floor over the lowest corner)
      if (k === K.house) {
        const side = p.v < 0.5 ? 1 : -1;
        cb(P_BOX, side * w * 0.3, H + p.r2 * 0.5, -d * 0.12, 0.75, p.r2 * 0.9 + 0.8, 0.75, 0, 0, C.brick);
        const dx = (p.v * 2 - 1) * w * 0.12;
        cb(P_BOX, dx, base + 1.05, F, 1.1, 2.1, 0.08, 0, 0, C.dark);
        const n = w > 9 ? 3 : 2, floors = h > 5 ? [base + 1.5, base + 4.1] : [base + 1.5];
        for (const y of floors) for (let i = 0; i < n; i++) {
          const x = -w / 2 + ((i + 0.5) * w) / n;
          if (y === base + 1.5 && Math.abs(x - dx) < 1.3) continue;
          cb(P_BOX, x, y, F, 1.0, 1.15, 0.08, 0, 0, C.glass); cb(P_BOX, x, y, B, 1.0, 1.15, 0.08, 0, 0, C.glass);
        }
        cb(P_BOX, w / 2 + 0.03, base + 1.5, 0, 0.08, 1.1, 0.9, 0, 0, C.glass); cb(P_BOX, -w / 2 - 0.03, base + 1.5, 0, 0.08, 1.1, 0.9, 0, 0, C.glass);
      } else if (k === K.barn) {
        cb(P_BOX, 0, base + h * 0.4, F, w * 0.36, h * 0.8, 0.1, 0, 0, C.dark);
        cb(P_BOX, w / 2 + 0.04, base + h * 0.35, 0, 0.1, h * 0.7, d * 0.3, 0, 0, C.dark);
      } else cb(P_BOX, w * 0.2, base + 1.0, F, 1.0, 2.0, 0.08, 0, 0, C.dark);
    } else if (k === K.garage) {
      cb(P_BOX, 0, (H - s0) / 2, 0, w, H + s0, d, 0, 0, p.c1);
      cb(P_BOX, 0, H + 0.15, 0, w + 0.5, 0.3, d + 0.5, 0, 0, p.c2);
      const base = H - h;
      cb(P_BOX, 0, base + h * 0.4, d / 2 + 0.04, w * 0.7, h * 0.8, 0.1, 0, 0, C.zinc);
      for (let i = 1; i < 6; i++) cb(P_BOX, 0, base + (h * 0.8 * i) / 6, d / 2 + 0.1, w * 0.7, 0.06, 0.04, 0, 0, C.roofG);
      cb(P_BOX, 0, H - 0.4, d / 2 + 0.06, w + 0.02, 0.5, 0.06, 0, 0, C.ochre);
    } else if (k === K.church) {
      cb(P_BOX, 0, (H - s0) / 2, 0, w, H + s0, d, 0, 0, p.c1);
      cb(P_ROOF, 0, H - 0.05, 0, w + 0.6, p.r2, d + 0.9, 0, 0, p.c2);
      const T = p.tw, tx = -w / 2 - T / 2 + 0.6, base = H - h;
      cb(P_BOX, tx, (H + p.th - s0) / 2, 0, T, H + p.th + s0, T, 0, 0, p.c1);
      cb(P_BOX, tx, H + p.th + 0.2, 0, T + 0.5, 0.4, T + 0.5, 0, 0, C.wall2);
      cb(P_SPIRE, tx, H + p.th + 0.4, 0, T * 0.95, 7.5, T * 0.95, 0, 0, C.slate);
      for (const [x, z, a, c] of [[tx - T / 2 - 0.03, 0, 0.08, 1], [tx + T / 2 + 0.03, 0, 0.08, 1], [tx, T / 2 + 0.03, 1, 0.08], [tx, -T / 2 - 0.03, 1, 0.08]]) cb(P_BOX, x, H + p.th - 2.2, z, a === 1 ? 1.2 : a, 2.2, c === 1 ? 1.2 : c, 0, 0, C.dark); // (the belfry's openings)
      cb(P_BOX, tx - T / 2 - 0.04, base + 1.4, 0, 0.1, 2.8, 1.6, 0, 0, C.dark);
      for (let i = 0; i < 4; i++) { const x = -w / 2 + ((i + 0.5) * w) / 4; cb(P_BOX, x, base + 2.8, d / 2 + 0.03, 1.1, 2.6, 0.08, 0, 0, C.glass); cb(P_BOX, x, base + 2.8, -d / 2 - 0.03, 1.1, 2.6, 0.08, 0, 0, C.glass); }
    } else if (k === K.ruin) {
      const f = rng(Math.floor(p.v * 1e9) + 7);
      for (const [x, z, a, hh, c] of ruinWalls(p)) cb(P_BOX, x, (hh - s0) / 2, z, a, hh + s0, c, 0, 0, p.c1);
      for (let i = 0; i < 5; i++) { const s = f.r(0.6, 1.3); cb(P_ROCK, f.r(-w / 2, w / 2), -s * 0.2, f.r(-d / 2, d / 2), s, s * 0.6, s, f() * 6.3, 0, C.stone); }
      cb(P_BOX, f.r(-w / 4, w / 4), 0.35, f.r(-d / 4, d / 4), w * 0.5, 0.25, 0.3, f() * 3, 0.4, C.dark); // (a fallen beam)
    } else if (k === K.wall) cb(P_HEDGE, 0, (H - 0.3) / 2, 0, w, H + 0.3, d, 0, 0, p.c1);
    else if (k === K.sandbags) cb(P_HEDGE, 0, (H - 0.2) / 2, 0, w, H + 0.2, d, 0, 0, C.sand);
    else if (k === K.hedge) cb(P_HEDGE, 0, (h - 0.3) / 2, 0, w, h + 0.3, d, 0, 0, p.c1);
    else if (k === K.fence) {
      const n = Math.max(1, Math.round(w / 2.4));
      for (let i = 0; i <= n; i++) cb(P_BOX, -w / 2 + (i * w) / n, 0.5, 0, 0.12, 1.5, 0.12, 0, 0, C.wood);
      cb(P_BOX, 0, 0.55, 0, w, 0.1, 0.06, 0, 0, C.wood); cb(P_BOX, 0, 1.05, 0, w, 0.1, 0.06, 0, 0, C.wood);
    } else if (k === K.conifer) cb(P_CONIFER, 0, -0.4, 0, p.r2 / 2.6, h / 10, p.r2 / 2.6, p.y2, 0, p.c1);
    else if (k === K.broadleaf) cb(P_BROAD, 0, -0.4, 0, p.r2 / 3.5, h / 10, p.r2 / 3.5, p.y2, 0, p.c1);
    else if (k === K.bush) cb(P_BUSH, 0, -0.15, 0, p.r2, h / 1.2, p.r2 * 0.9, p.y2, 0, p.c1);
    else if (k === K.boulder || k === K.rock) cb(P_ROCK, 0, -h * 0.18, 0, w, h, d, p.y2, 0, p.c1);
    else if (k === K.bale) cb(P_CYL, 0, 0.75, 0, 1.5, 1.2, 1.5, 0, Math.PI / 2, C.bale);
    else if (k === K.pole) { cb(P_CYL, 0, 4.0, 0, 0.26, 8.6, 0.26, 0, 0, C.pole); cb(P_BOX, 0, 7.6, 0, 0.12, 0.12, 1.6, 0, 0, C.pole); }
    else if (k === K.crate) { cb(P_BOX, 0, (H - 0.2) / 2, 0, w, H + 0.2, d, 0, 0, C.crate); cb(P_BOX, 0, H - h / 2, 0, w + 0.04, 0.12, d + 0.04, 0, 0, C.timber); }
    else if (k === K.block) cb(P_BOX, 0, (H - 0.2) / 2, 0, w, H + 0.2, d, 0, 0, C.concrete);
    else if (k === K.container) {
      cb(P_BOX, 0, (H - 0.2) / 2, 0, w, H + 0.2, d, 0, 0, p.c1);
      for (let i = 1; i < 8; i++) { const x = -w / 2 + (i * w) / 8; cb(P_BOX, x, H / 2, d / 2 + 0.02, 0.1, h * 0.9, 0.04, 0, 0, C.dark); cb(P_BOX, x, H / 2, -d / 2 - 0.02, 0.1, h * 0.9, 0.04, 0, 0, C.dark); }
      cb(P_BOX, w / 2 + 0.03, H / 2, 0, 0.06, h * 0.92, d * 0.92, 0, 0, C.dark);
    } else if (k === K.fueltank) {
      cb(P_CYL, 0, 1.85, 0, d * 0.92, w * 0.96, d * 0.92, 0, Math.PI / 2, C.steel);
      for (const x of [-w * 0.32, w * 0.32]) cb(P_BOX, x, 0.4, 0, 0.6, 1.3, d * 0.8, 0, 0, C.concrete);
      cb(P_BOX, 0, 3.4, 0, 0.8, 0.4, 0.8, 0, 0, C.steel);
    } else if (k === K.silo) { cb(P_CYL, 0, (H - 0.3) / 2, 0, w, H + 0.3, w, 0, 0, C.steel); cb(P_SPIRE, 0, H, 0, w * 1.05, 1.2, w * 1.05, 0.4, 0, C.zinc); }
    else if (k === K.tyres) for (let i = 0; i < 3; i++) cb(P_CYL, 0, 0.15 + i * 0.3, 0, 0.95, 0.28, 0.95, 0, 0, C.rubber);
    else if (k === K.slab) { // (the yard's apron: its eight bays painted, two rows of four, facing east)
      cb(P_BOX, 0, -0.25, 0, w, 0.6, d, 0, 0, C.apron);
      for (const u of [-10, -32]) for (let i = 0; i <= 4; i++) cb(P_BOX, u + 2, 0.06, -28 + i * 14, 14, 0.03, 0.25, 0, 0, C.paint);
      cb(P_BOX, w / 2 - 1.5, 0.06, 0, 0.3, 0.03, d - 6, 0, 0, C.paint);
    }
  }

  // ---------------------------------------------------------------- placing: the maps' keep-outs and the grid
  // a prop (kind k at e, z turned yaw; w, d, h its size; o: more fields) if its site will do: dry, gentle enough, clear
  // of the map's keep-outs (M.ok) and of what stands there already; null if not
  let M = null, rnd = null;
  function add(k, e, z, yaw, w, d, h, o) {
    const free = o && o.free, lift = (o && o.lift) || 0;
    const c = Math.cos(yaw), s = -Math.sin(yaw), ru = Math.hypot(w, d) / 2;
    if (!free && M.ok && !M.ok(e, z, ru, k)) return null;
    // clear of what stands there already: its footprint and a margin against everyone else's (looked at first: it costs
    // no ground)
    if (!free) { const m = (o && o.gap) ?? (BUILDING.has(k) ? 2.5 : TREE.has(k) ? 1.2 : 0.4); if (overlaps(e, z, c, s, w / 2 + m, d / 2 + m, (o && o.gapW) || 0)) return null; }
    // the ground: the lowest and the highest of its middle and its corners (a building's, a wall's ends)
    const pts = BUILDING.has(k) || k === K.container || k === K.wall || k === K.sandbags || k === K.hedge ? [[0, 0], [w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2], [-w / 2, -d / 2]] : [[0, 0]];
    let g = Infinity, gt = -Infinity;
    for (const [u, v] of pts) {
      const pe = e + u * c - v * s, pz = z + u * s + v * c;
      if (wet(pe, pz)) return null;
      const q = gH(pe, pz);
      g = Math.min(g, q); gt = Math.max(gt, q);
    }
    if (!free) {
      const lim = BUILDING.has(k) ? 0.12 * Math.hypot(w, d) + 0.4 : k === K.wall || k === K.hedge || k === K.fence || k === K.sandbags ? 0.3 * w + 0.5 : Infinity;
      if (gt - g > lim) return null;
    }
    const p = { k, e, z, y: yaw, c, s, w, d, h, g: g + lift, gt: gt + lift, r2: 0, v: rnd(), y2: rnd() * Math.PI * 2, c1: C.white, c2: C.slate, down: 0, map: M.id, i: S.list.length };
    if (o) for (const q in o) if (q !== 'free' && q !== 'lift') p[q] = o[q];
    const cs = colliders(p);
    // clear of the map's protected lines of sight (props only add cover where the arena was made to have none)
    if (!free && M.lines && cs.some((q) => q[1] & SI) && blocksLines(p, cs)) return null;
    S.list.push(p); M.props.push(p);
    S.top = Math.max(S.top, p.gt + p.h + (p.r2 || 0) + (p.th ? p.th + 8 : 0) + 12);
    for (const q of cs) insert(p, q);
    return p;
  }
  // a collider of prop p into S.cols and the grid: its middle and axes in the sim (and its plan footprint)
  const _U = [0, 0, 0], _E = [0, 0, 0], _W = [0, 0, 0], _P = { x: 0, y: 0, z: 0 };
  function insert(p, q) {
    const [t, f, ox, oy, oz, ha, hh, hw] = q;
    const pe = p.e + ox * p.c - oz * p.s, pz = p.z + ox * p.s + oz * p.c;
    frameAt(pe, pz, _U, _E, _W);
    simAt(pe, pz, p.g + oy, _P);
    const col = {
      p: p.i, f, t, cx: _P.x, cy: _P.y, cz: _P.z,
      ax: p.c * _E[0] + p.s * _W[0], ay: p.c * _E[1] + p.s * _W[1], az: p.c * _E[2] + p.s * _W[2], ux: _U[0], uy: _U[1], uz: _U[2],
      wx: -p.s * _E[0] + p.c * _W[0], wy: -p.s * _E[1] + p.c * _W[1], wz: -p.s * _E[2] + p.c * _W[2],
      ha, hh: t === 2 ? ha : hh, hw: t === 0 ? hw : ha, pe, pz, pc: p.c, ps: p.s, box: null, i: S.cols.length,
    };
    S.cols.push(col);
    if (S.stamp.length < S.cols.length) growStamps();
    const br = Math.hypot(col.ha, col.hw) + 1, i0 = Math.floor((pe - br) / CELL), i1 = Math.floor((pe + br) / CELL), j0 = Math.floor((pz - br) / CELL), j1 = Math.floor((pz + br) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const key = gKey(i, j); let L = S.grid.get(key); if (!L) S.grid.set(key, (L = [])); L.push(col.i); }
    // what stops shells has a grid of its own (most props are trees, bushes and hedges: shells pass them by), and its tops
    // over sea level in 64 m cells (a shell's step over none of them, or over them all, looks no further)
    if (f & SH) {
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const key = gKey(i, j); let L = S.hgrid.get(key); if (!L) S.hgrid.set(key, (L = [])); L.push(col.i); }
      // (and the 64 m cubes of the sim's own axes it reaches, in a hashed bitset: a shell's step through none of them
      // looks no further, with no conversion to (e, z) at all)
      const rb = Math.sqrt(col.ha * col.ha + col.hh * col.hh + col.hw * col.hw) + 1;
      for (let x = fl((col.cx - rb) / 64); x <= fl((col.cx + rb) / 64); x++) for (let y = fl((col.cy - rb) / 64); y <= fl((col.cy + rb) / 64); y++)
        for (let zz = fl((col.cz - rb) / 64); zz <= fl((col.cz + rb) / 64); zz++) OCC[cube(x, y, zz)] = 1;
      const top = p.g + oy + hh + 0.5;
      for (let i = Math.floor((pe - br) / TCELL); i <= Math.floor((pe + br) / TCELL); i++) for (let j = Math.floor((pz - br) / TCELL); j <= Math.floor((pz + br) / TCELL); j++) {
        const key = gKey(i, j), t0 = S.tops.get(key);
        if (!(t0 >= top)) S.tops.set(key, top);
      }
    }
  }
  // does a plan rectangle (middle e, z; axis (c, s); half sizes a, b) overlap any collider's footprint? (2D separating axes)
  function overlaps(e, z, c, s, a, b, skipW) {
    const r = Math.hypot(a, b), i0 = Math.floor((e - r) / CELL), i1 = Math.floor((e + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL), qn = ++S.q;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const L = S.grid.get(gKey(i, j));
      if (L) for (const ci of L) {
        const q = S.cols[ci];
        if (S.stamp[ci] === qn) continue;
        S.stamp[ci] = qn;
        if (skipW && skipW === S.list[q.p].k) continue;
        if (rectRect(e, z, c, s, a, b, q.pe, q.pz, q.pc, q.ps, q.ha, q.hw)) return true;
      }
    }
    return false;
  }
  function rectRect(e1, z1, c1, s1, a1, b1, e2, z2, c2, s2, a2, b2) {
    const de = e2 - e1, dz = z2 - z1;
    for (const [ux, uz] of [[c1, s1], [-s1, c1], [c2, s2], [-s2, c2]]) {
      const r1 = a1 * Math.abs(c1 * ux + s1 * uz) + b1 * Math.abs(-s1 * ux + c1 * uz), r2 = a2 * Math.abs(c2 * ux + s2 * uz) + b2 * Math.abs(-s2 * ux + c2 * uz);
      if (Math.abs(de * ux + dz * uz) > r1 + r2) return false;
    }
    return true;
  }
  // the stamps (one per collider, so a query looks at each once) grow with the list
  function growStamps() { if (S.stamp.length < S.cols.length) { const n = new Uint32Array(Math.max(1024, S.cols.length * 2)); n.set(S.stamp); S.stamp = n; } }
  // would prop p's sight-blocking colliders cut one of the map's protected lines?
  function blocksLines(p, cs) {
    const tmp = [];
    for (const q of cs) if (q[1] & SI) insertTmp(p, q, tmp);
    for (const L of M.lines) for (const col of tmp) if (segCol(col, L.a, L.b, 0.6) >= 0) return true;
    return false;
  }
  function insertTmp(p, q, out) {
    const [t, f, ox, oy, oz, ha, hh, hw] = q;
    const pe = p.e + ox * p.c - oz * p.s, pz = p.z + ox * p.s + oz * p.c;
    frameAt(pe, pz, _U, _E, _W);
    simAt(pe, pz, p.g + oy, _P);
    out.push({ f, t, cx: _P.x, cy: _P.y, cz: _P.z, ax: p.c * _E[0] + p.s * _W[0], ay: p.c * _E[1] + p.s * _W[1], az: p.c * _E[2] + p.s * _W[2], ux: _U[0], uy: _U[1], uz: _U[2],
      wx: -p.s * _E[0] + p.c * _W[0], wy: -p.s * _E[1] + p.c * _W[1], wz: -p.s * _E[2] + p.c * _W[2], ha, hh: t === 2 ? ha : hh, hw: t === 0 ? hw : ha });
  }

  // ---------------------------------------------------------------- segments against colliders (sim axes)
  // The fraction along a -> b where it first enters collider q (grown by m), or -1. A box by its slabs, a cylinder by its
  // circle and its height, a sphere as a sphere.
  function segCol(q, a, b, m = 0) {
    const px = a.x - q.cx, py = a.y - q.cy, pz = a.z - q.cz, dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    if (q.t === 2) {
      const r = q.ha + m, A = dx * dx + dy * dy + dz * dz, B = px * dx + py * dy + pz * dz, Cc = px * px + py * py + pz * pz - r * r;
      if (Cc <= 0) return 0;
      const D = B * B - A * Cc;
      if (D < 0 || A < 1e-12) return -1;
      const t = (-B - Math.sqrt(D)) / A;
      return t >= 0 && t <= 1 ? t : -1;
    }
    const la = px * q.ax + py * q.ay + pz * q.az, lu = px * q.ux + py * q.uy + pz * q.uz, lw = px * q.wx + py * q.wy + pz * q.wz;
    const da = dx * q.ax + dy * q.ay + dz * q.az, du = dx * q.ux + dy * q.uy + dz * q.uz, dw = dx * q.wx + dy * q.wy + dz * q.wz;
    let t0 = 0, t1 = 1;
    const slab = (p0, d, h) => {
      if (Math.abs(d) < 1e-12) return Math.abs(p0) <= h;
      let ta = (-h - p0) / d, tb = (h - p0) / d;
      if (ta > tb) { const x = ta; ta = tb; tb = x; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      return t0 <= t1;
    };
    if (!slab(lu, du, q.hh + m)) return -1;
    if (q.t === 0) { if (!slab(la, da, q.ha + m) || !slab(lw, dw, q.hw + m)) return -1; return t0; }
    // an upright cylinder: the circle in (along, across)
    const r = q.ha + m, A = da * da + dw * dw, B = la * da + lw * dw, Cc = la * la + lw * lw - r * r;
    if (A < 1e-12) return Cc <= 0 ? t0 : -1;
    const D = B * B - A * Cc;
    if (D < 0) return -1;
    const sq = Math.sqrt(D), c0 = (-B - sq) / A, c1 = (-B + sq) / A;
    const lo = Math.max(t0, c0), hi = Math.min(t1, c1);
    return lo <= hi ? lo : -1;
  }
  // The cells a plan segment (e0, z0) -> (e1, z1) crosses, in order (Amanatides-Woo), each handed to fn(list): stops when
  // fn returns true
  function walk(e0, z0, e1, z1, fn, grid = S.grid) {
    let i = Math.floor(e0 / CELL), j = Math.floor(z0 / CELL);
    const i1 = Math.floor(e1 / CELL), j1 = Math.floor(z1 / CELL), de = e1 - e0, dz = z1 - z0;
    const si = de > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1, td = Math.abs(CELL / (de || 1e-12)), tdz = Math.abs(CELL / (dz || 1e-12));
    let tm = de !== 0 ? ((si > 0 ? (i + 1) * CELL - e0 : e0 - i * CELL) / Math.abs(de)) : Infinity;
    let tmz = dz !== 0 ? ((sj > 0 ? (j + 1) * CELL - z0 : z0 - j * CELL) / Math.abs(dz)) : Infinity;
    for (let n = 0; n < 4000; n++) {
      const L = grid.get(gKey(i, j));
      if (L && fn(L)) return;
      if (i === i1 && j === j1) return;
      if (tm < tmz) { tm += td; i += si; } else { tmz += tdz; j += sj; }
    }
  }
  // (e, z) of a sim point from the nearest of a few anchors (any within 250 m: shells in flight share them), through the
  // surface frame there, east and south: no trigonometry for a shell's step (the walk needs it to well under a metre: 6 cm
  // at most). Kept here, not on the shells: a field more on every shell would slow moveShell's every look at one.
  const ANC = Array.from({ length: 8 }, () => ({ x: NaN, y: 0, z: 0, e: 0, zz: 0, k: 1, Ex: 0, Ey: 0, Ez: 0, Wx: 0, Wy: 0, Wz: 0 }));
  let ancN = 0;
  function ezNear(P, o) {
    for (let i = 0; i < 8; i++) {
      const q = ANC[i], dx = P.x - q.x, dy = P.y - q.y, dz = P.z - q.z;
      if (dx * dx + dy * dy + dz * dz < 62500) { o.e = q.e + (dx * q.Ex + dy * q.Ey + dz * q.Ez) * q.k; o.z = q.zz + dx * q.Wx + dy * q.Wy + dz * q.Wz; return o; }
    }
    ezOf(P.x, P.y, P.z, o);
    frameAt(o.e, o.z, _U, _E, _W);
    const q = ANC[ancN]; ancN = (ancN + 1) & 7;
    q.x = P.x; q.y = P.y; q.z = P.z; q.e = o.e; q.zz = o.z; q.k = 1 / Math.cos(o.z / R());
    q.Ex = _E[0]; q.Ey = _E[1]; q.Ez = _E[2]; q.Wx = _W[0]; q.Wy = _W[1]; q.Wz = _W[2];
    return o;
  }
  // the maps' spheres in the sim (a quick way to skip what is nowhere near one)
  function nearMap(x, y, z, r) {
    for (const m of S.maps) { const dx = x - m.cx, dy = y - m.cy, dz = z - m.cz3, rr = m.cr + r; if (dx * dx + dy * dy + dz * dz < rr * rr) return true; }
    return false;
  }
  // The first collider with any of the flags in mask that a -> b (sim points on Earth) enters: its fraction (-1: none),
  // the collider in S.hit. Fallen props are passed by.
  const A0 = { e: 0, z: 0, h: 0 }, B0 = { e: 0, z: 0, h: 0 };
  let segBest = 2, segHitC = null, segA = null, segB = null, segMask = 0, segQn = 0, segM = 0;
  function segScan(L) {
    for (const ci of L) {
      if (S.stamp[ci] === segQn) continue;
      S.stamp[ci] = segQn;
      const q = S.cols[ci];
      if (!(q.f & segMask) || S.list[q.p].down) continue;
      const t = segCol(q, segA, segB, segM);
      if (t >= 0 && t < segBest) { segBest = t; segHitC = q; }
    }
    return false;
  }
  // (near: a short step, found through the anchors, ezNear)
  function segment(a, b, mask, m = 0, near = false) {
    S.hit = null;
    // (both ends over the highest prop's top, once every map is in: nothing to meet; the cheapest look first)
    const R0 = R() + S.top, ra = a.x * a.x + a.y * a.y + a.z * a.z, rb = b.x * b.x + b.y * b.y + b.z * b.z;
    if (S.all && ra > R0 * R0 && rb > R0 * R0) return -1;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2, dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, hl = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy) + (dz < 0 ? -dz : dz); // (over half the length: enough for the spheres)
    if (!S.all) needAt(mx, my, mz, hl);
    if (!S.cols.length || !nearMap(mx, my, mz, hl)) return -1;
    if (ra > R0 * R0 && rb > R0 * R0) return -1;
    if (near) { ezNear(a, A0); ezNear(b, B0); } else { ezOf(a.x, a.y, a.z, A0); ezOf(b.x, b.y, b.z, B0); }
    // a shell (SHELL alone): the 64 m grid of what stops shells under a short step, nothing there or both ends over its
    // highest top; then only that grid is walked
    const hard = mask === SH, ea = fl(A0.e / TCELL), eb = fl(B0.e / TCELL), za = fl(A0.z / TCELL), zb = fl(B0.z / TCELL), i0 = ea < eb ? ea : eb, i1 = ea < eb ? eb : ea, j0 = za < zb ? za : zb, j1 = za < zb ? zb : za;
    if (hard && i1 - i0 <= 1 && j1 - j0 <= 1) {
      let hi = -Infinity;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const t = S.tops.get(gKey(i, j)); if (t > hi) hi = t; }
      const RH = R() + hi;
      if (hi === -Infinity || (ra > RH * RH && rb > RH * RH)) return -1;
    }
    S.calls++; // (segments walked: the tests count them)
    segBest = 2; segHitC = null; segA = a; segB = b; segMask = mask; segM = m; segQn = ++S.q;
    walk(A0.e, A0.z, B0.e, B0.z, segScan, hard ? S.hgrid : S.grid);
    if (!segHitC) return -1;
    S.hit = segHitC;
    return segBest;
  }

  // ---------------------------------------------------------------- what the game asks
  // A shell's step a -> b: where it meets a prop that stops shells (fraction, or -1); Props.hit says which
  // (first, in a function small enough to stay fast: past the top of everything once all is in, or through none of the
  // 64 m cubes anything that stops shells reaches)
  function shell(a, b) {
    if (S.all) { const R0 = R() + S.top, q = R0 * R0; if (a.x * a.x + a.y * a.y + a.z * a.z > q && b.x * b.x + b.y * b.y + b.z * b.z > q) return -1; }
    else needAt((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, 30);
    if (!occupied(a, b)) return -1;
    return segment(a, b, SH, 0, true);
  }
  function occupied(a, b) {
    const ax = fl(a.x / 64), bx = fl(b.x / 64), ay = fl(a.y / 64), by = fl(b.y / 64), az = fl(a.z / 64), bz = fl(b.z / 64);
    if (ax - bx > 1 || bx - ax > 1 || ay - by > 1 || by - ay > 1 || az - bz > 1 || bz - az > 1) return true; // (a long one: look)
    return OCC[cube(ax, ay, az)] || OCC[cube(bx, ay, az)] || OCC[cube(ax, by, az)] || OCC[cube(bx, by, az)] || OCC[cube(ax, ay, bz)] || OCC[cube(bx, ay, bz)] || OCC[cube(ax, by, bz)] || OCC[cube(bx, by, bz)];
  }
  // How far along the ray from o (unit dir d) to D m the first prop that blocks sight or stops shells is, past `skip` m
  // (the HUD's aim ray: past our own vehicle, from a camera behind it), or -1
  const RA = { x: 0, y: 0, z: 0 }, RB = { x: 0, y: 0, z: 0 };
  function ray(o, d, D, skip) {
    RA.x = o.x + d.x * skip; RA.y = o.y + d.y * skip; RA.z = o.z + d.z * skip;
    RB.x = o.x + d.x * D; RB.y = o.y + d.y * D; RB.z = o.z + d.z * D;
    if (D <= skip) return -1;
    const t = segment(RA, RB, SH | SI);
    return t < 0 ? -1 : skip + t * (D - skip);
  }
  // what a prop is made of, as a hit shows it: 'stone', 'wood', 'metal' or 'leaf'
  const MAT = {};
  for (const k of ['house', 'church', 'ruin', 'wall', 'boulder', 'rock', 'block', 'silo']) MAT[K[k]] = 'stone';
  for (const k of ['barn', 'shed', 'fence', 'crate', 'pole', 'bale']) MAT[K[k]] = 'wood';
  for (const k of ['garage', 'container', 'fueltank']) MAT[K[k]] = 'metal';
  for (const k of ['hedge', 'conifer', 'broadleaf', 'bush']) MAT[K[k]] = 'leaf';
  MAT[K.sandbags] = 'earth'; MAT[K.tyres] = 'metal';
  const matOf = (q) => (q && S.list[q.p] ? MAT[S.list[q.p].k] || 'stone' : 'stone');
  // every map built?
  const done = () => { ensure(); return S.groups.every((g) => g.done); };
  // Is the line a -> b clear of everything that blocks sight?
  function clear(a, b) { return segment(a, b, SI) < 0; }
  // The colliders near a vehicle's plan spot (e, z) within r that are solid (mask SO) or crush (CR): into out
  function nearList(e, z, r, mask, out) {
    out.length = 0;
    const i0 = Math.floor((e - r) / CELL), i1 = Math.floor((e + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL), qn = ++S.q;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const L = S.grid.get(gKey(i, j));
      if (L) for (const ci of L) {
        if (S.stamp[ci] === qn) continue;
        S.stamp[ci] = qn;
        const q = S.cols[ci];
        if (!(q.f & mask) || S.list[q.p].down) continue;
        const de = q.pe - e, dz = q.pz - z, rr = r + Math.hypot(q.ha, q.hw);
        if (de * de + dz * dz < rr * rr) out.push(q);
      }
    }
    return out;
  }
  // A collider as Gear's box: middle, axes, half sizes (a cylinder's or sphere's as the box round it)
  function boxOf(q) {
    if (q.box) return q.box;
    return (q.box = { c: { x: q.cx, y: q.cy, z: q.cz }, u: [{ x: q.ax, y: q.ay, z: q.az }, { x: q.ux, y: q.uy, z: q.uz }, { x: q.wx, y: q.wy, z: q.wz }], e: [q.ha, q.hh, q.hw] });
  }
  // The solid props a vehicle's body could meet: their boxes, for Gear.bump (a sim spot and the reach of its box)
  const NEAR = [], BOXES = [], VL = { e: 0, z: 0, h: 0 };
  function solidNear(x, y, z, r) {
    BOXES.length = 0;
    needAt(x, y, z, r);
    if (!S.cols.length || !nearMap(x, y, z, r)) return BOXES;
    ezOf(x, y, z, VL);
    nearList(VL.e, VL.z, r, SO, NEAR);
    for (const q of NEAR) { const H = Math.abs(VL.h - (Math.hypot(q.cx, q.cy, q.cz) - R())); if (H < r + q.hh) BOXES.push(boxOf(q)); }
    return BOXES;
  }
  // a circle (e, z, r) against the solid props' footprints: how deep it is in the deepest (0: clear). The ground AI's moves.
  function pen2D(e, z, r) {
    needEZ(e, z);
    if (!S.cols.length) return 0;
    nearList(e, z, r, SO, NEAR);
    let best = 0;
    for (const q of NEAR) {
      const de = e - q.pe, dz = z - q.pz, u = de * q.pc + dz * q.ps, v = -de * q.ps + dz * q.pc;
      let d;
      if (q.t === 0) { const cu = clamp(u, -q.ha, q.ha), cv = clamp(v, -q.hw, q.hw), ins = Math.abs(u) <= q.ha && Math.abs(v) <= q.hw; d = ins ? r + Math.min(q.ha - Math.abs(u), q.hw - Math.abs(v)) : r - Math.hypot(u - cu, v - cv); }
      else d = r + q.ha - Math.hypot(de, dz);
      if (d > best) best = d;
    }
    return best;
  }
  // The ground AI's lane: from (e, z) along the unit (ue, uz) for L m, half as wide as hw: how far to the first solid
  // footprint across it (Infinity: clear)
  const LANE = [];
  function lane(e, z, ue, uz, L, hw) {
    needEZ(e, z);
    if (!S.cols.length) return Infinity;
    nearList(e + ue * L / 2, z + uz * L / 2, L / 2 + hw, SO, LANE);
    let best = Infinity;
    for (const q of LANE) {
      // the lane's middle line against the footprint grown by hw (2D slabs in the footprint's axes)
      const de = e - q.pe, dz = z - q.pz, u0 = de * q.pc + dz * q.ps, v0 = -de * q.ps + dz * q.pc, du = ue * q.pc + uz * q.ps, dv = -ue * q.ps + uz * q.pc;
      const A = (q.t === 0 ? q.ha : q.ha) + hw, B = (q.t === 0 ? q.hw : q.ha) + hw;
      let t0 = 0, t1 = L, ok = true;
      for (const [p0, d, h] of [[u0, du, A], [v0, dv, B]]) {
        if (Math.abs(d) < 1e-9) { if (Math.abs(p0) > h) { ok = false; break; } continue; }
        let ta = (-h - p0) / d, tb = (h - p0) / d;
        if (ta > tb) { const x = ta; ta = tb; tb = x; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 < best) best = t0;
    }
    return best;
  }
  // Cover within r of (e, z) for the ground AI: the solid props that stop shells, one a prop ({ e, z, r: how far its
  // side is from its middle, low: under 2 m, hull-down behind it}), standing
  const COVER_K = new Set([K.house, K.barn, K.church, K.ruin, K.shed, K.garage, K.wall, K.sandbags, K.boulder, K.container, K.block]);
  function coverNear(e, z, r) {
    needEZ(e, z);
    const out = [], seen = new Set();
    nearList(e, z, r, SO, NEAR);
    for (const q of NEAR) {
      const p = S.list[q.p];
      if (seen.has(p) || !(q.f & SH) || !COVER_K.has(p.k)) continue;
      seen.add(p);
      const low = p.k === K.wall || p.k === K.sandbags || p.k === K.block || (p.k === K.boulder && p.h < 2);
      out.push({ e: p.e, z: p.z, r: low ? Math.min(p.w, p.d) / 2 + 0.3 : Math.hypot(p.w, p.d) / 2, low, p });
    }
    return out;
  }
  // free ground for a vehicle at (e, z): no solid footprint within r
  const freeAt = (e, z, r) => pen2D(e, z, r) <= 0;

  // ---------------------------------------------------------------- crushing (every screen: ours, ghosts, the AI)
  // A ground vehicle's plan footprint (its body box, turned with its hull) against the props that crush: each it meets
  // falls over, away from it (along its motion when it moves). now: the sim's clock.
  const CRL = [], VB = { e: 0, z: 0, h: 0 }, Q1 = { x: 0, y: 0, z: 0 };
  function crushBy(v, now) {
    const bb = v.bodyBox || v.bounds;
    if (!bb || !v.q) return 0;
    const com = v.com || { x: 0, y: 0, z: 0 }, ex = (bb.maxX - bb.minX) / 2 + 0.3, ez = (bb.maxZ - bb.minZ) / 2 + 0.2;
    qrot(v.q, (bb.minX + bb.maxX) / 2 - com.x, (bb.minY + bb.maxY) / 2 - com.y, (bb.minZ + bb.maxZ) / 2 - (com.z || 0), Q1);
    const cx = v.x + Q1.x, cy = v.y + Q1.y, cz = v.z + Q1.z, r = Math.hypot(ex, ez);
    needAt(cx, cy, cz, r);
    if (!nearMap(cx, cy, cz, r + 4)) return 0;
    ezOf(cx, cy, cz, VB);
    nearList(VB.e, VB.z, r, CR, CRL);
    if (!CRL.length) return 0;
    // its forward (part +x) and right (part +z) along the ground: (e, z) components through the surface frame
    frameAt(VB.e, VB.z, _U, _E, _W);
    qrot(v.q, 1, 0, 0, Q1);
    let fe = Q1.x * _E[0] + Q1.y * _E[1] + Q1.z * _E[2], fz = Q1.x * _W[0] + Q1.y * _W[1] + Q1.z * _W[2];
    const fl = Math.hypot(fe, fz) || 1; fe /= fl; fz /= fl;
    const hb = (bb.maxY - bb.minY) / 2 + 0.5;
    let n = 0;
    for (const q of CRL) {
      const p = S.list[q.p];
      if (p.down) continue;
      if (Math.abs(VB.h - (p.g + 1)) > hb + 3) continue; // (it isn't down there: a vehicle flying over)
      if (!rectRect(VB.e, VB.z, fe, fz, ex, ez, q.pe, q.pz, q.pc, q.ps, q.ha, q.hw)) continue;
      let de = 0, dz = 0;
      const ve = (v.vx || 0) * _E[0] + (v.vy || 0) * _E[1] + (v.vz || 0) * _E[2], vz = (v.vx || 0) * _W[0] + (v.vy || 0) * _W[1] + (v.vz || 0) * _W[2], sp = Math.hypot(ve, vz);
      if (sp > 0.5) { de = ve / sp; dz = vz / sp; } else { de = p.e - VB.e; dz = p.z - VB.z; const l = Math.hypot(de, dz) || 1; de /= l; dz /= l; }
      fall(p, de, dz, now);
      n++;
    }
    return n;
  }
  function fall(p, de, dz, now) {
    p.down = 1; p.fe = de; p.fz = dz; p.t0 = now || 0;
    S.fallen.push(p); S.crushed++; S.ver++;
  }
  // Each frame (Combat.frame, while ground vehicles are about): every ground vehicle that moves crushes what it drives
  // into, ours, the AI's and the other players' alike, 15 times a second
  function crushStep(F) {
    if (!F || !F.vessels) return;
    const now = F.time || 0;
    if (now - S.passT < 1 / 15 && now >= S.passT) return;
    S.passT = now;
    ensure();
    if (!S.cols.length) return;
    for (const v of F.vessels) {
      if (v.dead || v.wreck || !v.parts || !v.parts.length || v.body !== EARTH || !(v.gv || (v.gear && v.gear.length))) continue;
      const sp = Math.hypot(v.vx || 0, v.vy || 0, v.vz || 0);
      if (sp < 0.4 && !v.remote) continue; // (parked: it can't push anything over)
      crushBy(v, now);
    }
  }
  // stand everything back up (a new flight)
  function reset() {
    for (const p of S.fallen) { p.down = 0; p.t0 = 0; }
    if (S.fallen.length) S.ver++;
    S.fallen.length = 0; S.crushed = 0; S.passT = -1;
  }

  // ---------------------------------------------------------------- roads and fields (painted on the arena's ground)
  const RCELL = 64, rKey = (i, j) => (i + 4096) * 8192 + (j + 4096);
  function road(pts, hw) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [e0, z0] = pts[i], [e1, z1] = pts[i + 1], sg = { e0, z0, e1, z1, hw, L: Math.hypot(e1 - e0, z1 - z0) };
      S.roads.push(sg);
      const m = hw + 24, a0 = Math.floor((Math.min(e0, e1) - m) / RCELL), a1 = Math.floor((Math.max(e0, e1) + m) / RCELL), b0 = Math.floor((Math.min(z0, z1) - m) / RCELL), b1 = Math.floor((Math.max(z0, z1) + m) / RCELL);
      for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) { const k = rKey(a, b); let L = S.rgrid.get(k); if (!L) S.rgrid.set(k, (L = [])); L.push(sg); }
    }
  }
  const segDist = (e, z, g) => {
    const de = g.e1 - g.e0, dz = g.z1 - g.z0, t = g.L > 0 ? clamp(((e - g.e0) * de + (z - g.z0) * dz) / (g.L * g.L), 0, 1) : 0;
    return Math.hypot(e - g.e0 - de * t, z - g.z0 - dz * t);
  };
  // how far (e, z) is from the nearest road's edge (negative: on it), looking no further than about 60 m
  function roadGap(e, z) {
    const L = S.rgrid.get(rKey(Math.floor(e / RCELL), Math.floor(z / RCELL)));
    let best = Infinity;
    if (L) for (const g of L) best = Math.min(best, segDist(e, z, g) - g.hw);
    return best;
  }
  // is any road within m of the rectangle e0..e1, z0..z1? (the arena mesh splits its cells finer along the roads)
  function roadIn(e0, e1, z0, z1, m) {
    paintReady();
    const ce = (e0 + e1) / 2, cz = (z0 + z1) / 2, hr = Math.hypot(e1 - e0, z1 - z0) / 2 + m;
    for (let a = Math.floor((e0 - m) / RCELL); a <= Math.floor((e1 + m) / RCELL); a++) for (let b = Math.floor((z0 - m) / RCELL); b <= Math.floor((z1 + m) / RCELL); b++) {
      const L = S.rgrid.get(rKey(a, b));
      if (L) for (const g of L) if (segDist(ce, cz, g) < hr + g.hw) return true;
    }
    return false;
  }
  const DIRT = [0.15, 0.105, 0.058], DIRT2 = [0.1, 0.085, 0.045];
  // The arena ground's colour at (e, z) (c: linear rgb, changed in place): dirt on the roads, with a darker verge, and
  // the fields' greens, yellows and browns
  function paint(e, z, c) {
    if (!S.built) return c;
    const g = roadGap(e, z);
    for (const f of S.fields) {
      const de = e - f.e, dz = z - f.z, u = Math.abs(de * f.c + dz * f.s), v = Math.abs(-de * f.s + dz * f.c);
      if (u > f.hu + 2 || v > f.hv + 2) continue;
      const w = (1 - smoothstep(f.hu - 3, f.hu + 2, u)) * (1 - smoothstep(f.hv - 3, f.hv + 2, v)) * f.k;
      for (let i = 0; i < 3; i++) c[i] = lerp(c[i], c[i] * f.tint[i] + f.add[i], w);
    }
    if (g < 3.5) { // (the track, and a darker verge where the grass is worn)
      const w = 1 - smoothstep(-0.6, 1.9, g), vg = (1 - smoothstep(0.8, 3.5, g)) * smoothstep(-0.5, 1.2, g) * 0.45;
      for (let i = 0; i < 3; i++) { c[i] = lerp(c[i], DIRT2[i], vg); c[i] = lerp(c[i], DIRT[i], 0.95 * w); }
    }
    return c;
  }
  const FIELD_TINT = { lush: [[0.8, 1.1, 0.68], [0, 0.006, 0]], hay: [[1.35, 1.12, 0.5], [0.035, 0.02, 0]], brown: [[1.0, 0.7, 0.5], [0.04, 0.02, 0.006]], pale: [[1.12, 1.08, 0.75], [0.012, 0.01, 0]] };


  // ---------------------------------------------------------------- layout helpers (generators: the build yields between
  // props, so it can run a slice at a time; yield* into them)
  // a run of segment props of kind k along (e0, z0) -> (e1, z1): pieces of about seg m with gaps (gate: the share left
  // out), each its own prop (a tank breaks through one stretch of hedge, not the whole row)
  function* run(k, e0, z0, e1, z1, seg, d, h, o, gate = 0.12) {
    const L = Math.hypot(e1 - e0, z1 - z0), n = Math.max(1, Math.round(L / seg)), yaw = Math.atan2(-(z1 - z0), e1 - e0);
    for (let i = 0; i < n; i++) {
      if (rnd() < gate) continue;
      const f = (i + 0.5) / n, len = L / n - 0.25;
      add(k, e0 + (e1 - e0) * f, z0 + (z1 - z0) * f, yaw, len, d, h * (0.9 + 0.2 * rnd()), Object.assign({ gapW: k }, o));
      yield;
    }
  }
  // a field: its colour on the ground (data, at once), and walls, hedges or fences round it (fieldEdges: ends short of
  // the corners, a side left open now and then, gates)
  function field(e, z, yaw, hu, hv, tint, edge) {
    const c = Math.cos(yaw), s = -Math.sin(yaw), T = FIELD_TINT[tint];
    const f = { e, z, c, s, hu, hv, tint: T[0], add: T[1], k: 1, edge };
    S.fields.push(f);
    return f;
  }
  function* fieldEdges(f) {
    if (!f.edge) return;
    const { e, z, c, s, hu, hv, edge } = f, P = (u, v) => [e + u * c - v * s, z + u * s + v * c];
    for (const [a, b] of [[[-hu + 2, -hv], [hu - 2, -hv]], [[hu, -hv + 2], [hu, hv - 2]], [[hu - 2, hv], [-hu + 2, hv]], [[-hu, hv - 2], [-hu, -hv + 2]]]) {
      if (rnd() < 0.18) continue;
      const [e0, z0] = P(...a), [e1, z1] = P(...b);
      if (edge === 'wall') yield* run(K.wall, e0, z0, e1, z1, 9, 0.75, 1.15, { c1: rnd() < 0.5 ? C.wall : C.wall2 });
      else if (edge === 'hedge') yield* run(K.hedge, e0, z0, e1, z1, 7, 1.7, 2.1, { c1: rnd() < 0.5 ? C.hedge : C.hedge2 });
      else yield* run(K.fence, e0, z0, e1, z1, 7.5, 0.3, 1.2, {});
    }
  }
  // (tints: the renderer's tree and bush shapes carry their own greens and brown trunks; these vary them a little)
  const TREE_C = [0xffffff, 0xe6f0e2, 0xf2fff0], BROAD_C = [0xffffff, 0xf6ffd8, 0xe8f2e0, 0xfff6d6];
  function tree(e, z, conifer, big = 1, o) {
    if (conifer) { const h = (8 + 7 * rnd()) * big; return add(K.conifer, e, z, 0, 1, 1, h, Object.assign({ r2: h * (0.2 + 0.06 * rnd()), c1: rnd.pick(TREE_C) }, o)); }
    const h = (7 + 6 * rnd()) * big;
    return add(K.broadleaf, e, z, 0, 1, 1, h, Object.assign({ r2: h * (0.32 + 0.08 * rnd()), c1: rnd.pick(BROAD_C) }, o));
  }
  const bush = (e, z, o) => { const r = 0.9 + 0.9 * rnd(); return add(K.bush, e, z, 0, r * 2, r * 2, r * (1.1 + 0.4 * rnd()), Object.assign({ r2: r, c1: rnd() < 0.5 ? 0xffffff : 0xe2ecd6 }, o)); };
  const rock = (e, z, big, o) => {
    const s = big ? 1.6 + 2.6 * rnd() * rnd() : 0.5 + 0.7 * rnd();
    return add(big ? K.boulder : K.rock, e, z, rnd() * 6.28, s * (0.9 + 0.3 * rnd()), s * (0.8 + 0.3 * rnd()), s * (0.55 + 0.35 * rnd()), Object.assign({ c1: rnd() < 0.5 ? C.rock : C.rock2 }, o));
  };
  // n trees (and a third as many bushes) round (e, z) within r, conifers by share mix
  function* wood(e, z, r, n, mix) {
    for (let i = 0, tries = 0; i < n && tries < n * 4; tries++) {
      const t = rnd() * 6.283, d = r * Math.sqrt(rnd());
      if (tree(e + Math.cos(t) * d, z + Math.sin(t) * d, rnd() < mix, 1.1 - 0.25 * (d / r))) i++;
      if ((tries & 3) === 3) yield;
    }
    for (let i = 0; i < n / 3; i++) { const t = rnd() * 6.283, d = r * (0.5 + 0.6 * rnd()); bush(e + Math.cos(t) * d, z + Math.sin(t) * d); if ((i & 3) === 3) yield; }
  }
  const WALLS = [C.white, C.white, C.cream, C.stone, C.cream, C.ochre], ROOFS = [C.slate, C.slate, C.slate2, C.tile, C.tile2];
  function house(e, z, yaw, o) {
    const w = 7.5 + 3.5 * rnd(), d = 6 + 2 * rnd(), two = rnd() < 0.4;
    return add(K.house, e, z, yaw, w, d, two ? 5.4 : 3.3, Object.assign({ r2: 2.1 + 1.2 * rnd(), c1: rnd.pick(WALLS), c2: rnd.pick(ROOFS) }, o));
  }
  function barn(e, z, yaw, o) {
    const w = 14 + 6 * rnd(), d = 8 + 3 * rnd();
    return add(K.barn, e, z, yaw, w, d, 4.6 + 1.4 * rnd(), Object.assign({ r2: 3.4 + 1.2 * rnd(), c1: rnd.pick([C.barnR, C.barnG, C.timber]), c2: rnd.pick([C.zinc, C.roofG, C.slate2]) }, o));
  }
  function ruin(e, z, yaw, o) {
    const w = 8 + 5 * rnd(), d = 6 + 2.5 * rnd();
    return add(K.ruin, e, z, yaw, w, d, 3.4 + 2.2 * rnd(), Object.assign({ c1: rnd.pick([0x8f8678, 0x7d756a, 0x9a8f7f]) }, o)); // (weathered, smoke-stained stone)
  }
  function shed(e, z, yaw, o) { return add(K.shed, e, z, yaw, 4 + 2 * rnd(), 3 + 1.2 * rnd(), 2.5 + 0.5 * rnd(), Object.assign({ r2: 1.1 + 0.4 * rnd(), c1: rnd.pick([C.timber, C.wood, C.barnG]), c2: C.zinc }, o)); }
  // houses along a street (pts), both sides, every 14-22 m, set back from its middle, their fronts to it; keep(e, z):
  // false where none may stand
  function* street(pts, back, mix, keep) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [e0, z0] = pts[i], [e1, z1] = pts[i + 1], L = Math.hypot(e1 - e0, z1 - z0), ue = (e1 - e0) / L, uz = (z1 - z0) / L, yaw = Math.atan2(-uz, ue);
      for (const side of [1, -1]) for (let t = 6 + 8 * rnd(); t < L - 4; t += 14 + 8 * rnd()) {
        if (rnd() < 0.15) continue;
        const sb = back + 2 * rnd(), e = e0 + ue * t - uz * sb * side, z = z0 + uz * t + ue * sb * side;
        if (keep && !keep(e, z)) continue;
        const fy = side > 0 ? yaw + Math.PI : yaw, x = rnd(); // (its front to the street: the far side's turned round)
        let p = null;
        if (x < mix.ruin) p = ruin(e, z, fy);
        else if (x < mix.ruin + mix.barn) p = barn(e - uz * 3 * side, z + ue * 3 * side, fy);
        else if (x < mix.ruin + mix.barn + mix.shed) p = shed(e, z, fy);
        else p = house(e, z, fy, mix.house);
        yield;
        if (p && p.k === K.house && rnd() < 0.55) yield* garden(p);
      }
    }
  }
  // behind a house: a tree or a bush, and a fence, hedge or wall along the back of its plot
  function* garden(p) {
    const bk = p.d / 2 + 5 + 3 * rnd(), be = p.e + p.s * bk, bz = p.z - p.c * bk; // (behind: its local -z)
    if (rnd() < 0.7) tree(be + p.c * (rnd() - 0.5) * p.w, bz + p.s * (rnd() - 0.5) * p.w, rnd() < 0.25, 0.8);
    if (rnd() < 0.5) bush(be + p.c * (rnd() - 0.5) * p.w, bz + p.s * (rnd() - 0.5) * p.w);
    const q = rnd(), back = bk + 4, e0 = p.e + p.s * back - p.c * (p.w / 2 + 3), z0 = p.z - p.c * back - p.s * (p.w / 2 + 3), e1 = p.e + p.s * back + p.c * (p.w / 2 + 3), z1 = p.z - p.c * back + p.s * (p.w / 2 + 3);
    if (q < 0.35) yield* run(K.fence, e0, z0, e1, z1, 6, 0.3, 1.2, {}, 0);
    else if (q < 0.6) yield* run(K.hedge, e0, z0, e1, z1, 6, 1.4, 1.8, { c1: C.hedge2 }, 0);
    else if (q < 0.8) yield* run(K.wall, e0, z0, e1, z1, 7, 0.6, 1.0, { c1: C.wall }, 0);
  }
  // n tries of maker over the box, where a value-noise map (scale m, its seed) is over thresh
  function* scatter(box, n, thresh, scale, seed, maker) {
    for (let i = 0; i < n; i++) {
      const e = box.e0 + rnd() * (box.e1 - box.e0), z = box.z0 + rnd() * (box.z1 - box.z0);
      if (thresh > 0 && Terrain.vnoise2(e / scale, z / scale, 0, seed) < thresh) continue;
      maker(e, z);
      if ((i & 3) === 3) yield;
    }
  }
  // how steep the land is about (e, z), from the map's own relief 20 m either way (cheap: no detail, no lattice)
  const reliefAt = (e, z) => { const H = (de, dz) => Terrain.earthH(siteAngle(EARTH, e + de), z + dz); return Math.hypot(H(20, 0) - H(-20, 0), H(0, 20) - H(0, -20)) / 40; };

  // ---------------------------------------------------------------- Highland Ridge
  // Roads: the north pad to C (round the west of the ridge), C to the village at B and on east (its street), the south
  // pad to C, C up to the hilltop A, the village to the south pad, the north pad to the patrol loop, and the loop itself
  // (groundai.js LOOP: the Tank Range's patrollers drive it)
  const LOOPC = { e: 18450, z: 14810, r: 191 };
  const HL_ROADS = [
    [[17750, 13838], [17705, 14080], [17600, 14330], [17535, 14560], [17575, 14790], [17680, 14945], [17750, 15000]],
    [[17750, 15000], [17900, 15040], [18080, 15046], [18230, 15035], [18450, 15030], [18720, 15032], [18960, 15062]],
    [[17750, 16162], [17722, 15880], [17632, 15600], [17630, 15330], [17690, 15110], [17750, 15000]],
    [[17750, 15000], [17600, 14975], [17440, 14958], [17260, 14955], [17120, 14975], [17050, 15000]],
    [[18450, 15030], [18446, 15230], [18300, 15480], [18030, 15800], [17795, 16150]],
    [[17762, 13838], [17990, 14090], [18200, 14360], [18275, 14650]],
  ];
  // fields round the zones and on the approaches: e, z, yaw, half sizes, colour, and what runs round them
  const HL_FIELDS = [
    [17860, 14905, 0.1, 48, 32, 'lush', 'hedge'], [17590, 15130, 0.05, 36, 24, 'hay', 'wall'], [17890, 15215, -0.1, 52, 30, 'brown', 'hedge'],
    [17480, 14150, 0.4, 60, 40, 'lush', 'wall'], [17960, 14260, 0.3, 50, 36, 'hay', 'hedge'], [17480, 15860, -0.3, 60, 40, 'brown', 'fence'],
    [18010, 15660, 0.2, 55, 35, 'lush', 'hedge'], [18660, 14850, 0, 40, 30, 'lush', 'wall'], [18300, 15210, 0.1, 40, 36, 'hay', 'hedge'],
    [18720, 15270, 0, 46, 30, 'brown', 'fence'], [17220, 15160, -0.2, 50, 36, 'lush', 'wall'], [17260, 14800, 0.2, 55, 35, 'pale', 'wall'],
    [18250, 14560, 0.5, 45, 32, 'hay', 'fence'], [17120, 14480, 0.3, 60, 40, 'pale', 'wall'], [18800, 14560, -0.2, 50, 35, 'lush', 'hedge'],
    [17060, 15560, -0.1, 60, 40, 'lush', 'wall'], [18480, 15560, 0.15, 50, 38, 'pale', 'hedge'],
  ];
  function* highland() {
    const A = EARTH.arenas.highland, B = A.box, Z = {}, berms = A.berms;
    for (const zn of A.zones) Z[zn.id] = zn;
    for (const pts of HL_ROADS) road(pts, 2.7);
    const loop = [];
    for (let i = 0; i <= 32; i++) { const t = (i / 32) * Math.PI * 2; loop.push([LOOPC.e + Math.sin(t) * LOOPC.r, LOOPC.z + Math.cos(t) * LOOPC.r]); }
    road(loop, 2.4);
    const fields = HL_FIELDS.map((f) => field(...f));
    yield; // (the roads and the fields' colours are in: the arena's ground can be painted)
    const targets = [[17580, 14385], [17750, 14560]]; // (the Tank Range's parked targets: groundai.js LAYOUT; the ZSY-23 sits on A)
    M.ok = (e, z, r) => {
      if (e < B.e0 + 10 || e > B.e1 - 10 || z < B.z0 + 10 || z > B.z1 - 10) return false;
      for (const f of A.pads) { const de = e - f.e, dz = z - f.z, u = Math.abs(de * f.c + dz * f.s), v = Math.abs(-de * f.s + dz * f.c); if (u < f.hl + 30 + r && v < f.hw + 30 + r) return false; }
      for (const zn of A.zones) if (Math.hypot(e - zn.e, z - zn.z) < 26 + r) return false;
      for (const b of berms) { const de = e - b.e, dz = z - b.z, u = Math.abs(de * b.c + dz * b.s), v = Math.abs(-de * b.s + dz * b.c); if (u < 16 + r && v < 15 + r) return false; }
      for (const [te, tz] of targets) if (Math.hypot(e - te, z - tz) < 14 + r) return false;
      if (Math.abs(Math.hypot(e - LOOPC.e, z - LOOPC.z) - LOOPC.r) < 13 + r) return false;
      return roadGap(e, z) > 2.5 + r;
    };
    // the protected lines of sight: the hilltop sees the slope and the village (arena-probe's eye 2.4 m, target 1.6 m)
    const eye = (zn, up) => simAt(zn.e, zn.z, gH(zn.e, zn.z) + up, {});
    M.lines = [{ a: eye(Z.A, 2.4), b: eye(Z.C, 1.6) }, { a: eye(Z.A, 2.4), b: eye(Z.B, 1.6) }];
    // (and the Tank Range's: its parked TK-34 and the MS-4's turret over its berm, seen from the north pad's front row)
    for (const de of [0, 22, -22]) { const f = A.pads[0], o = eye({ e: f.e + de, z: f.z }, 2.4); M.lines.push({ a: o, b: eye({ e: targets[0][0], z: targets[0][1] }, 1.6) }, { a: o, b: eye({ e: targets[1][0], z: targets[1][1] }, 2.4) }); }
    yield;
    // ---- the village round zone B: its church, houses along the street and the lane south, farms inside the loop
    add(K.church, 18568, 15092, 0, 17, 8.5, 6.8, { r2: 4.6, tw: 5.4, th: 11, c1: C.stone, c2: C.slate });
    yield;
    tree(18600, 15115, true, 1.1); tree(18540, 15118, false, 1.0); tree(18595, 15070, true, 0.9);
    yield* run(K.wall, 18545, 15128, 18598, 15128, 7, 0.65, 1.05, { c1: C.wall2 }, 0.05); // (the churchyard)
    const B0 = Z.B, villageKeep = (e, z) => Math.hypot(e - B0.e, z - B0.z) > 30;
    yield* street([[18215, 15035], [18450, 15030], [18735, 15033]], 13, { ruin: 0.12, barn: 0.06, shed: 0.08, house: null }, villageKeep);
    yield* street([[18448, 15040], [18446, 15230]], 13, { ruin: 0.12, barn: 0.05, shed: 0.08, house: null }, villageKeep);
    yield* street([[18300, 15480], [18446, 15230]], 13, { ruin: 0.2, barn: 0.1, shed: 0.1, house: null }, villageKeep);
    for (const [e, z, yaw] of [[18400, 14745, 0.2], [18505, 14880, -0.1], [18380, 14905, 0.1]]) { barn(e, z, yaw); yield; shed(e + 16, z - 8, yaw); house(e - 18, z + 6, yaw + Math.PI / 2); yield; }
    ruin(18525, 14760, 0.4); yield; ruin(18610, 14955, 0.05); ruin(18290, 15070, 3.1); yield;
    for (const [e, z] of [[18395, 14775], [18470, 14905], [18520, 15180]]) { for (let i = 0; i < 6; i++) add(K.bale, e + (i % 3) * 3.2, z + Math.floor(i / 3) * 3, 0.2, 1.2, 1.5, 1.5, {}); yield; }
    for (let e = 17930; e < 18200; e += 46) add(K.pole, e, 15046 + 8, 0, 0.3, 0.3, 8.6, {});
    for (let e = 18760; e < 18950; e += 46) add(K.pole, e, 15045 + 8, 0, 0.3, 0.3, 8.6, {});
    yield;
    // ---- the hilltop: a ruined farm and its stone walls
    ruin(17018, 14952, 0.25); yield; ruin(17108, 14950, 0.22); yield; ruin(17085, 15062, -0.15); yield;
    yield* run(K.wall, 16975, 14922, 17040, 14918, 9, 0.75, 1.2, { c1: C.wall }, 0.05); yield* run(K.wall, 17062, 14916, 17145, 14912, 9, 0.75, 1.2, { c1: C.wall }, 0.05);
    yield* run(K.wall, 16972, 14928, 16972, 14978, 9, 0.75, 1.2, { c1: C.wall2 }, 0.1); yield* run(K.wall, 17150, 14918, 17152, 14975, 9, 0.75, 1.2, { c1: C.wall2 }, 0.1);
    yield* run(K.wall, 16985, 15075, 17045, 15078, 9, 0.75, 1.2, { c1: C.wall }, 0.1); yield* run(K.wall, 17065, 15082, 17140, 15080, 9, 0.75, 1.2, { c1: C.wall }, 0.1);
    for (let i = 0; i < 26; i++) { const t = rnd() * 6.283, d = 70 + 120 * rnd(); rock(Z.A.e + Math.cos(t) * d, Z.A.z + Math.sin(t) * d, rnd() < 0.55); if ((i & 3) === 3) yield; }
    tree(16990, 15030, false, 1.1); tree(17150, 15030, true, 1.0); bush(17000, 14905); bush(17120, 14898);
    // ---- the slope: a farmstead, an orchard, hedges
    house(17688, 15085, 0.12 + Math.PI); yield; barn(17728, 15118, 0.1); yield; shed(17660, 15118, 0.15); yield;
    for (let i = 0; i < 4; i++) { for (let j = 0; j < 3; j++) tree(17818 + i * 9 + rnd() * 1.5, 15066 + j * 9 + rnd() * 1.5, false, 0.55, { gap: 0.3 }); yield; }
    yield* run(K.hedge, 17808, 15056, 17862, 15056, 7, 1.5, 1.9, { c1: C.hedge }, 0.1); yield* run(K.hedge, 17866, 15060, 17866, 15094, 7, 1.5, 1.9, { c1: C.hedge }, 0.1);
    // ---- the fields' walls, hedges and fences, and bales in two of them
    for (const f of fields) yield* fieldEdges(f);
    for (const [e, z] of [[17950, 14275], [18300, 15215]]) { for (let i = 0; i < 8; i++) add(K.bale, e - 20 + i * 5.5 + rnd() * 2, z - 10 + (i % 2) * 14 + rnd() * 2, rnd() * 3, 1.2, 1.5, 1.5, {}); yield; }
    // ---- woods on the flanks, copses between, and trees, bushes and rocks scattered over it all (rocks most on steep ground)
    for (const [e, z, r, n, mix] of [[16630, 14260, 200, 95, 0.7], [16560, 15720, 220, 105, 0.6], [18960, 14240, 150, 60, 0.3], [18950, 15860, 170, 70, 0.45],
      [17330, 14560, 70, 24, 0.2], [18190, 15340, 80, 26, 0.3], [17230, 15560, 90, 32, 0.5], [18110, 14660, 55, 16, 0.2], [16920, 13900, 120, 42, 0.6],
      [18600, 16230, 120, 40, 0.5], [16700, 15050, 90, 34, 0.75], [18880, 15000, 60, 18, 0.3]]) yield* wood(e, z, r, n, mix);
    // copses: a few trees and bushes together, here and there over the open ground
    for (let i = 0; i < 34; i++) {
      const e = B.e0 + 60 + rnd() * (B.e1 - B.e0 - 120), z = B.z0 + 60 + rnd() * (B.z1 - B.z0 - 120);
      yield* wood(e, z, 10 + 10 * rnd(), 3 + Math.floor(rnd() * 5), rnd() < 0.5 ? 0.15 : 0.7);
    }
    // the roads: a hedge or a line of trees along a stretch here and there, short of the zones
    for (const pts of HL_ROADS) for (let i = 0; i + 1 < pts.length; i++) {
      if (rnd() < 0.45) continue;
      const [e0, z0] = pts[i], [e1, z1] = pts[i + 1], L = Math.hypot(e1 - e0, z1 - z0), ue = (e1 - e0) / L, uz = (z1 - z0) / L, side = rnd() < 0.5 ? 1 : -1, hedge = rnd() < 0.55, off = hedge ? 11 + 2 * rnd() : 7 + 2 * rnd();
      const a = 0.15 + 0.2 * rnd(), b = 0.85 - 0.2 * rnd(), pe = (f) => e0 + ue * L * f - uz * off * side, pz = (f) => z0 + uz * L * f + ue * off * side;
      if (hedge) yield* run(K.hedge, pe(a), pz(a), pe(b), pz(b), 7, 1.6, 2.0, { c1: rnd() < 0.5 ? C.hedge : C.hedge2 }, 0.2);
      else for (let f = a; f < b; f += 14 / L) { tree(pe(f), pz(f), rnd() < 0.3, 0.9); yield; }
    }
    yield* scatter(B, 900, 0.38, 300, 17, (e, z) => tree(e, z, rnd() < 0.4, 0.95));
    yield* scatter(B, 900, 0.3, 220, 23, (e, z) => bush(e, z));
    yield* scatter(B, 700, 0, 1, 0, (e, z) => { const s = reliefAt(e, z); if (s > 0.08 || rnd() < 0.3) rock(e, z, s > 0.12 && rnd() < 0.5); });
  }

  // ---------------------------------------------------------------- the Runway (no map needed)
  function* runway() {
    const A = EARTH.arenas.runway, Z = A.zones;
    M.ok = (e, z, r) => {
      if (Math.abs(z) < 52 + r) return false; // (the runway and its shoulders: big jets' wingtips pass there)
      for (const f of A.pads) if (Math.abs(e - f.e) < f.hl + 40 + r && Math.abs(z - f.z) < 90 + r) return false;
      if (e > 760 && e < 1420 && z < 0 && z > -230) return false; // (the apron, its hangar and the tower)
      for (const zn of Z) if (Math.hypot(e - zn.e, z - zn.z) < 26 + r) return false;
      return true;
    };
    const big = (e, z, yaw) => add(K.garage, e, z, yaw, 22, 15, 7, { c1: C.zinc, c2: C.roofG });
    big(1460, 98, Math.PI); big(1950, 104, Math.PI); big(2320, -104, 0);
    shed(1500, 76, Math.PI); shed(2260, -82, 0);
    yield;
    const cont = (e, z, yaw, lift, c) => add(K.container, e, z, yaw, 6.1, 2.45, 2.6, { c1: c, lift, free: lift > 0 });
    for (const [e, z, yaw] of [[1100, 78, 0.05], [1630, -82, -0.04], [2060, -86, 0.02], [2420, 74, 0.1]]) {
      const a = cont(e, z, yaw, 0, rnd.pick([C.contB, C.contR, C.contG]));
      if (a && rnd() < 0.7) cont(e, z, yaw + (rnd() - 0.5) * 0.1, 2.6 + (a.gt - a.g), rnd.pick([C.contB, C.contR, C.contG]));
      cont(e + 2 * Math.sin(yaw), z + 3.2 * (z > 0 ? 1 : -1), yaw, 0, rnd.pick([C.contB, C.contR, C.contG]));
      yield;
    }
    for (const zn of Z) for (const s of [1, -1]) { // a sandbagged position beside each zone, blocks and crates
      const z = s * 66, e = zn.e + (rnd() - 0.5) * 30, sb = { gapW: K.sandbags };
      add(K.sandbags, e, z, 0, 7, 0.9, 1.15, sb); add(K.sandbags, e - 4.2, z + s * 2.6, Math.PI / 2, 4.5, 0.9, 1.15, sb); add(K.sandbags, e + 4.2, z + s * 2.6, Math.PI / 2, 4.5, 0.9, 1.15, sb);
      for (let i = 0; i < 3; i++) add(K.block, zn.e + 40 + i * 4, s * (60 + rnd() * 10), rnd(), 1.6, 1.6, 1.4, {});
      for (let i = 0; i < 4; i++) add(K.crate, zn.e - 40 + rnd() * 10, s * (58 + rnd() * 14), rnd() * 3, 1.4, 1.4, 1.3, {});
      yield;
    }
    const box = { e0: 900, e1: 2500, z0: -220, z1: 220 };
    yield* scatter(box, 90, 0, 1, 0, (e, z) => { if (Math.abs(z) > 110) tree(e, z, rnd() < 0.4, 0.9); });
    yield* scatter(box, 120, 0, 1, 0, (e, z) => { if (Math.abs(z) > 80) { if (rnd() < 0.5) bush(e, z); else rock(e, z, rnd() < 0.3); } });
  }

  // ---------------------------------------------------------------- the space centre's island (the map only)
  // The tank yard on the plateau south-east of the runway (its pad: EARTH.groundPads.yard), its driving course, a hamlet
  // of grass-roofed houses in the west, a farm in the north, groves, sheep walls, rocks and bushes
  function* isle() {
    const Y = EARTH.groundPads.yard, I = Terrain.ISLE;
    let le = -360;
    for (let e = -1500; e < 600; e += 20) { if (gH(e, 220) > 6) { le = e + 40; break; } if ((e & 255) === 0) yield; } // (the lighthouse: render3d's own rule)
    M.ok = (e, z, r) => {
      if (Math.hypot((e - I.e) / I.a, z / I.b) > 0.95) return false;
      if (Math.abs(z) < 72 + r && e > 0 && e < 2820) return false; // (the runway, its shoulders and blend, and the road from the pad by the helipad)
      if (Math.hypot(e, z) < 330 + r) return false; // (the pad, the assembly building, mission control, the tank farm, the helipad and the road)
      if (e > 740 && e < 1420 && z > -240 && z < 20) return false; // (the apron, its hangar and the tower)
      if (e > 2650 && Math.abs(z) < 70 + r) return false; // (the causeway)
      if (Math.hypot(e - le, z - 220) < 45 + r) return false; // (the lighthouse)
      { const de = e - Y.e, dz = z - Y.z; if (Math.abs(de) < Y.hl + 18 + r && Math.abs(dz) < Y.hw + 14 + r) return false; } // (the yard: what stands on it is placed by hand)
      if (e > Y.e + Y.hl && e < Y.e + Y.hl + 300 && Math.abs(z - Y.z) < 90) return false; // (the course)
      return true;
    };
    // ---- the tank yard: its concrete, garages along the north side facing in, the workshop, fuel, stores, blocks
    const yo = (u, v) => [Y.e + u, Y.z + v], F = { free: true };
    add(K.slab, Y.e, Y.z, 0, Y.hl * 2 - 4, Y.hw * 2 - 4, 0.3, F);
    for (let i = 0; i < 4; i++) { const [e, z] = yo(-36 + i * 13, -Y.hw - 7); add(K.garage, e, z, 0, 11, 13, 5, { free: true, c1: i % 2 ? C.cream : C.white, c2: C.roofG }); yield; }
    { const [e, z] = yo(20, -Y.hw - 8); add(K.shed, e, z, 0, 10, 8, 4, { free: true, r2: 2, c1: C.olive, c2: C.zinc }); }
    { const [e, z] = yo(38, -Y.hw - 6); add(K.container, e, z, 0, 6.1, 2.45, 2.6, { free: true, c1: C.olive }); }
    yield;
    // the fuel depot (north-east, past the pad's end): two tanks on saddles, a silo, a pump hut, sandbags round it
    const [fe, fz] = yo(Y.hl + 24, -Y.hw + 4);
    add(K.fueltank, fe, fz - 5, 0, 8, 2.8, 3.6, F); add(K.fueltank, fe, fz + 5, 0, 8, 2.8, 3.6, F); add(K.silo, fe + 13, fz - 3, 0, 6, 6, 7, F);
    add(K.shed, fe + 12, fz + 9, Math.PI, 4, 3.2, 2.6, { free: true, r2: 1.1, c1: C.olive, c2: C.zinc });
    for (const [a, b, yaw, L] of [[-7, -11, 0, 10], [7, -11, 0, 10], [-12, 0, Math.PI / 2, 14], [21, -2, Math.PI / 2, 12], [-5, 13, 0, 8], [9, 15, 0, 8]]) add(K.sandbags, fe + a, fz + b, yaw, L, 0.9, 1.2, F);
    yield;
    // stores: containers two high and crates by the west end; blocks along the south edge, sandbags past them
    { const [e, z] = yo(-Y.hl - 6, -10); const a = add(K.container, e, z, Math.PI / 2, 6.1, 2.45, 2.6, { free: true, c1: C.contG }); if (a) add(K.container, e, z, Math.PI / 2 + 0.03, 6.1, 2.45, 2.6, { free: true, lift: 2.6 + a.gt - a.g, c1: C.contB }); add(K.container, e - 3.2, z + 8, Math.PI / 2, 6.1, 2.45, 2.6, { free: true, c1: C.contR }); }
    for (let i = 0; i < 6; i++) { const [e, z] = yo(-Y.hl - 4 + (i % 3) * 1.7, 14 + Math.floor(i / 3) * 1.7); add(K.crate, e, z, 0.1 * i, 1.5, 1.5, 1.4, F); }
    for (let u = -Y.hl + 4; u < Y.hl - 4; u += 7) { if (Math.abs(u - 10) < 6) continue; const [e, z] = yo(u, Y.hw + 6); add(K.block, e, z, 0, 2.6, 1.0, 1.1, F); }
    for (const [a, b] of [[-20, Y.hw + 12], [16, Y.hw + 12]]) { const [e, z] = yo(a, b); add(K.sandbags, e, z, 0, 9, 0.9, 1.15, F); }
    yield;
    // ---- the driving course east of the yard: a slalom of blocks, a tyre ring, bales, a wall and a hedge to get round
    const c0 = Y.e + Y.hl + 60;
    for (let i = 0; i < 6; i++) { const z = Y.z + (i % 2 ? 14 : -14), e = c0 + i * 28; add(K.block, e, z - 4, 0, 1.6, 1.6, 1.4, F); add(K.block, e, z + 4, 0, 1.6, 1.6, 1.4, F); }
    for (let i = 0; i < 12; i++) { const t = (i / 12) * Math.PI * 2; add(K.tyres, c0 + 205 + Math.cos(t) * 14, Y.z + Math.sin(t) * 14, 0, 1, 1, 0.9, F); }
    for (let i = 0; i < 7; i++) add(K.bale, c0 + 120 + i * 3.4, Y.z + 46, 0, 1.2, 1.5, 1.5, F);
    add(K.wall, c0 + 90, Y.z - 48, 0.3, 16, 0.75, 1.2, { free: true, c1: C.wall });
    add(K.hedge, c0 + 150, Y.z - 44, -0.2, 7, 1.6, 2.0, { free: true, c1: C.hedge }); add(K.hedge, c0 + 157, Y.z - 46, -0.2, 7, 1.6, 2.0, { free: true, c1: C.hedge2 });
    for (const [a, b] of [[250, 30], [262, -30], [230, 60]]) rock(c0 + a, Y.z + b, true, F);
    yield;
    // ---- a hamlet in the west: grass roofs (as on the real islands), sheds, walls, a grove
    for (const [e, z, yaw] of [[560, 400, 0.2], [604, 428, 0.32], [528, 446, 0.25], [646, 392, 0.1], [690, 430, 0.15]]) {
      const p = house(e, z, yaw, { c1: rnd.pick([C.tar, C.redw, C.white, C.tar]), c2: C.turf });
      if (p && rnd() < 0.6) shed(e + 12 * Math.cos(yaw), z - 12 * Math.sin(yaw) + 6, yaw, { c2: C.turf });
      yield;
    }
    yield* run(K.wall, 500, 470, 720, 462, 9, 0.7, 1.1, { c1: C.wall2 }); yield* run(K.wall, 495, 380, 495, 465, 9, 0.7, 1.1, { c1: C.wall2 });
    yield* wood(615, 470, 22, 6, 0.4);
    // ---- a farm on the north plateau
    house(1740, -420, 0.05, { c1: C.white, c2: C.turf }); barn(1782, -398, 0.05, { c1: C.redw, c2: C.turf }); shed(1712, -392, 0.05);
    yield* run(K.wall, 1680, -350, 1860, -356, 9, 0.7, 1.1, { c1: C.wall }); yield* run(K.wall, 1860, -360, 1866, -470, 9, 0.7, 1.1, { c1: C.wall });
    yield* wood(1800, -455, 20, 5, 0.5);
    // ---- groves, sheep walls, and rocks and bushes over the island (the Faroes are grassy: few trees)
    for (const [e, z, r, n] of [[Y.e - Y.hl - 70, Y.z + 40, 26, 8], [2420, 445, 22, 5], [1150, 440, 22, 5], [2300, -380, 24, 6], [880, -420, 20, 5]]) yield* wood(e, z, r, n, 0.35);
    for (const [e0, z0, e1, z1] of [[760, 430, 1380, 445], [1200, 300, 1240, 470], [450, -300, 1300, -335], [1460, -250, 1450, -480], [2100, -262, 2600, -300], [2620, 260, 2620, 420]]) yield* run(K.wall, e0, z0, e1, z1, 10, 0.7, 1.1, { c1: rnd() < 0.5 ? C.wall : C.wall2 }, 0.2);
    const box = { e0: 0, e1: 3300, z0: -560, z1: 560 };
    yield* scatter(box, 700, 0, 1, 0, (e, z) => { const s = reliefAt(e, z); if (s > 0.1 || rnd() < 0.2) rock(e, z, s > 0.16 && rnd() < 0.6); });
    yield* scatter(box, 260, 0.45, 260, 31, (e, z) => bush(e, z));
    yield* scatter(box, 40, 0.55, 300, 37, (e, z) => tree(e, z, rnd() < 0.3, 0.8));
  }

  // ---------------------------------------------------------------- building the maps, a slice at a time
  // The maps (need: the real Earth map only; box: where its props may stand, which the renderer shows by; seed: its own),
  // in two groups that stand far apart: Highland Ridge, and the space centre's (the runway first, then the island, which
  // keeps off the runway's). A group is built by a job a slice at a time (tick: the renderer and the app, ahead of need),
  // and at once when something asks about its ground (need: a shell, a sight line, a vehicle there) before it is done.
  const MAPS = {
    highland: { need: true, seed: 0x48525731, gen: highland, box: () => EARTH.arenas.highland.box },
    runway: { need: false, seed: 0x52554e57, gen: runway, box: () => ({ e0: 650, e1: 2750, z0: -260, z1: 260 }) },
    isle: { need: true, seed: 0x49534c45, gen: isle, box: () => ({ e0: -600, e1: 3600, z0: -700, z1: 700 }) },
  };
  const GROUPS = [['highland'], ['runway', 'isle']];
  function ensure() {
    const mapped = !!(typeof EARTH !== 'undefined' && EARTH.mapped);
    if (S.built && S.mapped === mapped) return;
    Object.assign(S, { built: true, mapped, list: [], cols: [], grid: new Map(), roads: [], rgrid: new Map(), fields: [], maps: [], groups: [], fallen: [], crushed: 0, stamp: new Uint32Array(4096), q: 0, ms: 0, top: 0, all: false, tops: new Map(), hgrid: new Map() });
    OCC.fill(0);
    S.ver++;
    if (typeof EARTH === 'undefined' || !EARTH.arenas || !EARTH.groundPads) return;
    for (const ids of GROUPS) {
      const maps = ids.filter((id) => !MAPS[id].need || mapped);
      if (!maps.length) continue;
      // (its spheres in the sim, from the boxes: which group a query near some point needs)
      const sph = maps.map((id) => { const b = MAPS[id].box(), ce = (b.e0 + b.e1) / 2, cz = (b.z0 + b.z1) / 2, c = simAt(ce, cz, 0, {}); return { x: c.x, y: c.y, z: c.z, r: Math.hypot(b.e1 - b.e0, b.z1 - b.z0) / 2 + 400, b }; });
      S.groups.push({ ids: maps, sph, job: null, done: false, M: null, rnd: null, started: false });
    }
  }
  function* groupJob(g) {
    for (const id of g.ids) {
      const m = MAPS[id], box = m.box();
      M = { id, ok: null, lines: null, props: [] };
      rnd = rng(m.seed);
      yield* m.gen();
      const ce = (box.e0 + box.e1) / 2, cz = (box.z0 + box.z1) / 2, c = simAt(ce, cz, 0, {});
      S.maps.push({ id, props: M.props, box, ce, cz, a0: siteAngle(EARTH, ce), cx: c.x, cy: c.y, cz3: c.z, cr: Math.hypot(box.e1 - box.e0, box.z1 - box.z0) / 2 + 400 });
      S.ver++;
      M.ok = null;
      yield;
    }
  }
  // run group g's job until the clock passes `until` (Infinity: to its end); each job keeps its own map and dice
  function step(g, until) {
    if (g.done) return true;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0, M0 = M, r0 = rnd;
    if (!g.job) { g.job = groupJob(g); g.started = true; }
    M = g.M; rnd = g.rnd;
    try {
      for (;;) {
        const t1 = until !== Infinity ? performance.now() : 0, r = g.job.next();
        if (until !== Infinity) { const dt = performance.now() - t1; if (dt > S.worst) { S.worst = dt; S.worstAt = M ? M.id + ' ' + M.props.length : '?'; } }
        if (r.done) { g.done = true; S.all = S.groups.every((q) => q.done); break; }
        if (until !== Infinity && performance.now() >= until) break;
      }
    } finally { g.M = M; g.rnd = rnd; M = M0; rnd = r0; }
    if (typeof performance !== 'undefined') S.ms += performance.now() - t0;
    return g.done;
  }
  // every group whose ground is within r of the sim point (x, y, z), finished now
  function needAt(x, y, z, r) {
    ensure();
    for (const g of S.groups) {
      if (g.done) continue;
      for (const q of g.sph) { const dx = x - q.x, dy = y - q.y, dz = z - q.z, rr = q.r + r; if (dx * dx + dy * dy + dz * dz < rr * rr) { step(g, Infinity); break; } }
    }
  }
  // (the same by e, z: the ground AI)
  function needEZ(e, z) {
    ensure();
    for (const g of S.groups) if (!g.done) for (const q of g.sph) { const b = q.b; if (e > b.e0 - 300 && e < b.e1 + 300 && z > b.z0 - 300 && z < b.z1 + 300) { step(g, Infinity); break; } }
  }
  // A slice of the build: ms of it, the groups named (or all), in order; true when they're all done
  function tick(ms, ids) {
    ensure();
    const until = performance.now() + ms;
    let all = true;
    for (const g of S.groups) {
      if (ids && !g.ids.some((id) => ids.includes(id))) continue;
      if (g.done) continue;
      if (performance.now() >= until || !step(g, until)) all = false;
    }
    return all;
  }
  // everything, now (tests)
  function buildAll() { ensure(); for (const g of S.groups) step(g, Infinity); }
  // the roads and fields of Highland Ridge are in (its job's first step), so its ground can be painted
  function paintReady() {
    ensure();
    const g = S.groups.find((q) => q.ids.includes('highland'));
    if (g && !g.started) step(g, 0);
    return !!g;
  }

  // ---------------------------------------------------------------- the sandbox's tank yard
  // Where Armour and armed cars start in a multiplayer sandbox: the yard's pad, four abreast 14 m apart, facing east to
  // the open ground and the course, a second row 22 m behind (eight spots, then again)
  function yardPlace(slot) {
    const Y = EARTH.groundPads && EARTH.groundPads.yard;
    if (!Y) return null;
    const k = Number.isFinite(+slot) && +slot > 0 ? Math.floor(Math.min(+slot, 1e6)) % 8 : 0, col = k % 4, row = Math.floor(k / 4);
    return { e: Y.e - 10 - 22 * row, z: Y.z - 21 + 14 * col, yaw: 0 };
  }

  // counts by kind for a map (tests, the report)
  function count(id) {
    buildAll();
    const m = S.maps.find((q) => q.id === id), out = {};
    if (!m) return out;
    for (const p of m.props) { const n = KINDS[p.k]; out[n] = (out[n] || 0) + 1; }
    return out;
  }

  return {
    KINDS, K, F: { SHELL: SH, SIGHT: SI, SOLID: SO, CRUSH: CR }, PIECE: { BOX: P_BOX, ROOF: P_ROOF, CYL: P_CYL, SPIRE: P_SPIRE, CONIFER: P_CONIFER, BROAD: P_BROAD, BUSH: P_BUSH, ROCK: P_ROCK, HEDGE: P_HEDGE }, C,
    needNear(x, y, z) { needAt(x, y, z, 50); }, ensure, tick, buildAll, paintReady, done, shell, ray, matOf, clear, segment, solidNear, pen2D, lane, freeAt, coverNear, crushBy, crushStep, reset, paint, roadIn, roadGap, pieces, yardPlace, count,
    all() { buildAll(); return S.list; }, areas() { ensure(); return S.maps; },
    get hit() { return S.hit; }, get fallen() { return S.fallen; }, get ver() { return S.ver; }, get crushed() { return S.crushed; }, get built() { return S.built; }, _S: S,
  };
})();
