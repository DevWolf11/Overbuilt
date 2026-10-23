// The ground update's catalogue (its design, §3 and §10.2): the 71 armour parts and the fields each must carry, the
// shells their guns fire, the four paints, and Highland Ridge's ground (levelled pads, earth berms, the fine detail
// faded), which must leave the ground everywhere else exactly as it was: heights at 2,000 points round the islands,
// the airfields and the arena are checked against the values the code gave before the arena existed.
//   node test/catalogue.test.js
//   node test/catalogue.test.js --print     the ground sample's values for this checkout (ROOT=<checkout> for another)
const G = require('./lib/game.js');
if (process.argv.includes('--print')) { console.log(JSON.stringify({ map: groundSample(G.load()), nomap: groundSample(G.load({ earth: false })) })); process.exit(0); }
const ctx = G.load({ combat: true }), R = (c) => G.run(ctx, c);
const t = G.checks('catalogue: ground parts, shells, paints and the arena ground');
const { PARTS, SHELLS, SHELL_TYPES, SKINS, EARTH, Terrain: T } = ctx;
const D = 180 / Math.PI, fin = (x) => typeof x === 'number' && Number.isFinite(x);
const bad = (list, f) => list.filter((k) => !f(k));
const show = (l) => (l.length ? l.slice(0, 6).join(', ') + (l.length > 6 ? ` (+${l.length - 6})` : '') : undefined);

// ---------------------------------------------------------------- the parts
const GV = Object.keys(PARTS).filter((k) => PARTS[k].gv);
const CATS = R('VEHICLE_KINDS.tank.cats'); // the Armour kind's seven tabs
const FAMILIES = ['WWII', 'Cold War', 'Modern', 'AA'];
const PLACES = ['hull', 'roof', 'ring', 'side', 'inside', 'front', 'top', 'flank', 'face', 'skirt'];
const SHAPES = ['thull', 'tturret', 'tcast', 'tring', 'ttrack', 'twheel', 'tgun', 'tlaunch', 'tradar', 'tkit'];
const MODULES = ['track', 'wheel', 'engine', 'breech', 'ring', 'radar', 'sight', 'launcher', 'crew', 'ammo', 'fuel', 'troops'];
const ROLES = ['driver', 'gunner', 'commander', 'loader', 'radio'];
// real vehicles and weapons appear in code comments only: never in what a player reads
const REAL = /\b(tiger|panther|sherman|abrams|leopard|gepard|shilka|tunguska|pantsir|hellcat|puma|bradley|marder|javelin|stinger|grad|osa|kornet|konkurs|malyutka|patriot|stug|bofors|oerlikon|flak|kwk|t-?34|t-?72|t-?80|m1a1|m4|m18|bmp|brdm|bm-?21|zsu|9k\d+|strela|igla|tow|hellfire|maverick|katyusha|chieftain|centurion|challenger)\b/i;

t('71 ground parts (PARTS 257 -> 328)', GV.length === 71 && Object.keys(PARTS).length === 328, `${GV.length} of ${Object.keys(PARTS).length}`);
t('each is in one of the seven ground tabs, and every tab has parts', CATS.length === 7 && CATS.every((c) => R('PART_CATEGORIES').some((q) => q.id === c) && GV.some((k) => PARTS[k].cat === c))
  && !bad(GV, (k) => CATS.includes(PARTS[k].cat)).length, show(bad(GV, (k) => CATS.includes(PARTS[k].cat))));
t('each has a family, a place and a known shape', !bad(GV, (k) => FAMILIES.includes(PARTS[k].family) && PLACES.includes(PARTS[k].place) && SHAPES.includes(PARTS[k].shape)).length,
  show(bad(GV, (k) => FAMILIES.includes(PARTS[k].family) && PLACES.includes(PARTS[k].place) && SHAPES.includes(PARTS[k].shape))));
t('tier 0-4, a price, a mass, hit points, a size and a description', !bad(GV, (k) => { const d = PARTS[k];
  return Number.isInteger(d.tier) && d.tier >= 0 && d.tier <= 4 && d.cost > 0 && d.mass > 0 && d.hp > 0 && d.w > 0 && d.h > 0 && d.depth > 0 && typeof d.desc === 'string' && d.desc.length > 20; }).length);
t('no ground part uses the fields old code reads (twinZ, mount, crew, smoke, armor, radar) or retires', !bad(GV, (k) => !['twinZ', 'mount', 'crew', 'smoke', 'armor', 'radar', 'retired', 'wheel', 'pod'].some((f) => f in PARTS[k])).length,
  show(bad(GV, (k) => !['twinZ', 'mount', 'crew', 'smoke', 'armor', 'radar', 'retired', 'wheel', 'pod'].some((f) => f in PARTS[k]))));
t('no old part gained a ground field', !Object.keys(PARTS).filter((k) => !PARTS[k].gv).some((k) => ['gv', 'family', 'place', 'outline', 'armour', 'mods', 'module', 'hp', 'aim', 'track', 'awheel', 'engine', 'ring', 'seat', 'rack', 'inner'].some((f) => f in PARTS[k])));
t('names and descriptions use no real designation', !bad(GV, (k) => !REAL.test(PARTS[k].name) && !REAL.test(PARTS[k].desc)).length, show(bad(GV, (k) => !REAL.test(PARTS[k].name) && !REAL.test(PARTS[k].desc))));
t('module, control and inner as the catalogue has them', !bad(GV, (k) => { const d = PARTS[k];
  if (d.module != null && !MODULES.includes(d.module)) return false;
  if (d.shape === 'thull' || d.seat) return d.control === 1;
  if (d.place === 'ring') return d.control === 1 && !d.module;
  if (d.place === 'inside') return d.inner && d.flush;
  return !d.control && !d.inner; }).length);

// outlines: convex and counter-clockwise, inside the part's box; one armour factor per edge
const edges = (o) => o.map((p, i) => [p, o[(i + 1) % o.length]]);
const convex = (o) => o.length >= 3 && edges(o).every(([a, b], i) => { const [, c] = edges(o)[(i + 1) % o.length]; return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 1e-9; });
const area = (o) => edges(o).reduce((s, [a, b]) => s + (a[0] * b[1] - b[0] * a[1]) / 2, 0);
const PRISM = GV.filter((k) => PARTS[k].shape === 'thull' || PARTS[k].shape === 'tturret');
t('hulls and box turrets have an outline', PRISM.length === 12 && PRISM.every((k) => Array.isArray(PARTS[k].outline)), `${PRISM.length}`);
const OUT = GV.filter((k) => PARTS[k].outline);
t('every outline is convex, counter-clockwise and within its box', !bad(OUT, (k) => { const o = PARTS[k].outline;
  return convex(o) && area(o) > 0 && o.every(([x, y]) => fin(x) && fin(y) && Math.abs(x) <= 0.5 + 1e-9 && Math.abs(y) <= 0.5 + 1e-9); }).length, show(bad(OUT, (k) => convex(PARTS[k].outline) && area(PARTS[k].outline) > 0)));
t('hull outlines touch every side of their box (bottom, nose, top and back)', !bad(GV.filter((k) => PARTS[k].shape === 'thull'), (k) => { const o = PARTS[k].outline, xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
  return Math.min(...xs) === -0.5 && Math.max(...xs) === 0.5 && Math.min(...ys) === -0.5 && Math.max(...ys) === 0.5; }).length);
t('armour.edge has one factor per outline edge', !bad(OUT, (k) => { const a = PARTS[k].armour; return a && Array.isArray(a.edge) && a.edge.length === PARTS[k].outline.length && a.edge.every((f) => fin(f) && f >= 0 && f <= 1.5); }).length,
  show(bad(OUT, (k) => PARTS[k].armour && PARTS[k].armour.edge && PARTS[k].armour.edge.length === PARTS[k].outline.length)));
const ARM = GV.filter((k) => PARTS[k].armour);
t('armour: nominal mm within its range, steel or composite, composite stronger against shaped charges', !bad(ARM, (k) => { const a = PARTS[k].armour;
  const range = a.min == null ? a.max == null : a.min <= a.mm && a.mm <= a.max && a.min > 0;
  return a.mm > 0 && range && (a.mat === 'steel' || a.mat === 'composite') && (a.mat === 'composite' ? a.heat >= 1.4 && a.heat <= 1.6 : a.heat == null) && (a.z == null || fin(a.z))
    && (a.open == null || a.open.every((i) => PARTS[k].outline && i >= 0 && i < PARTS[k].outline.length)); }).length, show(bad(ARM, (k) => { const a = PARTS[k].armour; return a.mm > 0 && (a.mat === 'steel' || a.mat === 'composite'); })));
t('round parts (lathes) are hit as cylinders: a slope, and armour factors by bearing', !bad(GV.filter((k) => ['tcast', 'tring'].includes(PARTS[k].shape)), (k) => { const d = PARTS[k], r = d.armour && d.armour.round;
  return d.round && fin(d.round.slope) && r && ['f', 's', 'r', 't'].every((q) => fin(r[q])) && !d.outline && d.depth === d.w; }).length);

// the front armour the catalogue promises: the effective thickness against a level shot (mm x factor / cos of the plate's lean)
const eff = (k, i) => { const d = PARTS[k], [a, b] = edges(d.outline)[i], th = Math.atan2(Math.abs(b[0] - a[0]) * d.w, Math.abs(b[1] - a[1]) * d.h); return [d.armour.mm * d.armour.edge[i] / Math.cos(th), th * D]; };
const FRONT = [['hullLight', 2, 46, 57], ['hullMedium', 2, 99, 63], ['hullHeavy', 2, 102, 10], ['hullMBT', 1, 528, 58], ['hullMBT', 2, 335, 62], ['hullIFV', 2, 60, 60],
  ['hullWheeled', 1, 40, 60], ['hullCasemate', 2, 139, 55], ['turretSmall', 1, 33, 25], ['turretBox', 1, 102, 11]];
const offFront = FRONT.filter(([k, i, mm, deg]) => { const [e, a] = eff(k, i); return Math.abs(e - mm) > 1.5 || Math.abs(a - deg) > 0.3; }).map(([k, i]) => `${k}[${i}] ${eff(k, i).map((x) => x.toFixed(1)).join(' mm at ')}°`);
t('the fronts: glacis angles and effective thickness as the parts table has them', !offFront.length, show(offFront) || FRONT.map(([k, i]) => `${k} ${eff(k, i)[0].toFixed(0)}`).join(', '));
t('the cast turret: 90 mm at 25° is 99 mm', Math.abs(PARTS.turretCast.armour.mm / Math.cos(PARTS.turretCast.round.slope / D) - 99) < 1);
t('the MBT hull: the upper glacis is the weak spot', eff('hullMBT', 2)[0] < eff('hullMBT', 1)[0] * 0.7);
t('sides: Light 15, Medium 40, Heavy 80, MBT 70, Troop 20, Wheeled 12, Casemate 48 mm', [['hullLight', 15], ['hullMedium', 40], ['hullHeavy', 80], ['hullMBT', 70], ['hullIFV', 20], ['hullWheeled', 12], ['hullCasemate', 48]]
  .every(([k, mm]) => Math.abs(PARTS[k].armour.mm * PARTS[k].armour.z - mm) < 0.6));

// built-in modules: spheres inside their part (prism outlines in metres; round parts inside the cylinder)
const inPoly = (o, x, y) => edges(o).every(([a, b]) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0);
const MODS = GV.filter((k) => PARTS[k].mods);
t('built-in crew, ammunition, fuel and troops sit inside their part', MODS.length === 14 && !bad(MODS, (k) => PARTS[k].mods.every((m) => {
  const d = PARTS[k], [fx, fy, fz] = m.at;
  const kind = ['crew', 'ammo', 'fuel', 'troops'].includes(m.k) && (m.k !== 'crew' || ROLES.includes(m.role)) && (m.k !== 'ammo' || (m.rounds > 0 && m.cook > 0)) && (m.k !== 'troops' || m.troops > 0);
  const inside = d.outline ? inPoly(d.outline, fx, fy) : Math.hypot(fx * d.w, fz * d.depth) <= d.w / 2 && Math.abs(fy) <= 0.5;
  return kind && inside && Math.abs(fz) <= 0.5 && m.r > 0 && m.hp > 0; })).length, `${MODS.length} parts with mods`);
t('every hull has a driver; every turret a gunner', GV.filter((k) => PARTS[k].shape === 'thull').every((k) => PARTS[k].mods.some((m) => m.role === 'driver'))
  && GV.filter((k) => PARTS[k].place === 'ring').every((k) => PARTS[k].mods.some((m) => m.role === 'gunner')));

// running gear, rings, engines, crew parts and kit
const num = (o, ks) => o && ks.every((q) => fin(o[q]) && o[q] >= 0);
t('tracks, armoured wheels and engines carry what the running gear reads', GV.filter((k) => PARTS[k].track).length === 4 && GV.filter((k) => PARTS[k].awheel).length === 2 && GV.filter((k) => PARTS[k].engine).length === 4
  && GV.every((k) => { const d = PARTS[k];
    return (!d.track || (num(d.track, ['r', 'n', 'travel', 'vmax', 'rev', 'turn', 'mu', 'side', 'crr', 'load']) && d.module === 'track' && d.breakSpeed === 18))
      && (!d.awheel || (num(d.awheel, ['r', 'travel', 'vmax', 'mu', 'side', 'load']) && d.module === 'wheel'))
      && (!d.engine || (d.engine.kw > 0 && ['petrol', 'diesel', 'turbine'].includes(d.engine.fuel) && d.module === 'engine')); }));
t('rings: rate, capacity and stabiliser; only the powered ring stabilised', GV.filter((k) => PARTS[k].ring).every((k) => { const r = PARTS[k].ring; return r.rate > 0 && r.cap > 0 && (r.stab === 0 || r.stab === 2) && (r.stab === 2) === (k === 'ringP') && PARTS[k].module === 'ring'; }));
t('seats, racks, the autoloader, the troop bay and the fuel cell', ['driver', 'gunner', 'commander', 'loader'].every((r) => GV.some((k) => PARTS[k].seat === r && PARTS[k].module === 'crew'))
  && GV.filter((k) => PARTS[k].rack).every((k) => num(PARTS[k].rack, ['rounds', 'cook']) && PARTS[k].module === 'ammo') && PARTS.autoloader.autoload === 7
  && PARTS.troopBay.troops === 6 && PARTS.fuelCell.module === 'fuel');
t('radars, sights, ERA, skirts and slats', PARTS.radarSearch.searchRadar.range === 10000 && PARTS.radarTrack.trackRadar.range === 8000 && PARTS.radarTrack.aim && PARTS.thermal.thermal === true && PARTS.lrf.lrf === true
  && PARTS.era.era.ke === 100 && PARTS.era.era.ce === 400 && PARTS.skirts.spaced === true && PARTS.slatCage.slat === 0.5 && PARTS.hullIFV.amph && PARTS.hullWheeled.amph);

// weapons: what aim.js and armour.js read, and every field the old firing code reads for its own kinds
const W = GV.filter((k) => PARTS[k].weapon);
const KIND = { tgun: ['cal', 'reload', 'ammo', 'each'], agun: ['cal', 'rate', 'ammo', 'each'], smoke: ['ammo', 'salvo', 'each'],
  missile: ['ammo', 'accel', 'burn', 'vmax', 'turn', 'range', 'dmg', 'blast', 'life', 'each', 'boost'], rocket: ['ammo', 'rate', 'speed', 'accel', 'burn', 'dmg', 'blast', 'he', 'spread', 'each', 'life'] };
t('every weapon has the numbers its kind is fired with', W.length === 25 && !bad(W, (k) => { const w = PARTS[k].weapon; return KIND[w.kind] && num(w, KIND[w.kind]) && w.ammo > 0; }).length,
  show(bad(W, (k) => { const w = PARTS[k].weapon; return KIND[w.kind] && num(w, KIND[w.kind]); })));
t('guns: shells to fire, a breech, flush, and an aim with a trunnion at 0.18', !bad(W.filter((k) => PARTS[k].shape === 'tgun'), (k) => { const d = PARTS[k];
  return Array.isArray(d.weapon.shells) && d.weapon.shells.length > 0 && d.module === 'breech' && d.flush && d.aim.pivot === 0.18; }).length);
t('launchers: a hot launch (coast 0), an aim, missiles with a seeker and a label', !bad(W.filter((k) => PARTS[k].shape === 'tlaunch'), (k) => { const d = PARTS[k], w = d.weapon;
  return w.coast === 0 && d.aim && d.module === 'launcher' && (w.kind === 'rocket' || (['saclos', 'top', 'clos', 'air'].includes(w.seek) && typeof w.label === 'string' && (w.seek !== 'air' || w.cone > 0))); }).length);
t('aimed parts: elevation limits, rates and a trunnion inside the part', !bad(GV.filter((k) => PARTS[k].aim), (k) => { const a = PARTS[k].aim;
  return Array.isArray(a.el) && a.el[0] < a.el[1] && a.elRate > 0 && a.pivot > 0 && a.pivot < 1 && (!a.trav || (a.trav[0] < a.trav[1] && a.travRate > 0)) && (!a.casemate || num({ a: a.casemate[0], r: a.casemate[1] }, ['a', 'r'])); }).length);
t('ATGMs: wire-guided, tandem and top attack', PARTS.atgmWire.weapon.seek === 'saclos' && PARTS.atgmTube.weapon.tandem && PARTS.atgmTop.weapon.seek === 'top' && PARTS.atgmTop.weapon.tandem
  && PARTS.samCmd.weapon.seek === 'clos' && PARTS.samLong.weapon.radar);
t('stored rounds weigh something and a fresh part is loaded', W.every((k) => { const p = R(`makePart('${k}', 0, 0)`); return p.ammo === PARTS[k].weapon.ammo && p.store > 0 && fin(R(`partStoreKg(PARTS.${k})`)); }));
// a vessel with one of each weapon: the old weapon code (systems, status, the HUD's numbers) takes the new kinds in its stride
{
  const rows = [['hullMedium', 0, 0.65], ...W.map((k, i) => [k, -2.5 + (i % 5) * 1.2, 3 + Math.floor(i / 5) * 4, 3])];
  let ok = false, err = '';
  try {
    ctx.__rows = rows;
    ok = R(`(() => { const parts = partsFromDesign(__rows.map((r) => ({ type: r[0], x: r[1], y: r[2], rot: r[3] || 0, flip: false }))), adj = new Map(parts.map((p) => [p.id, new Set(parts.filter((q) => q !== p).map((q) => q.id))]));
      const v = new Vessel(parts, adj, EARTH); v.kind = 'car'; v.rebuildGroups();
      const sys = Combat.systems(v); let n = 0;
      for (v.wsel = 0; v.wsel < sys.length; v.wsel++) { const s = Combat.status(v); if (s && typeof s.name === 'string' && Number.isFinite(s.ammo)) n++; }
      return sys.length >= 20 && n === sys.length && Number.isFinite(Combat.integrity(v)); })()`);
  } catch (e) { err = e.message; }
  t('the old weapon code lists and counts the new weapons without trouble', ok, err || undefined);
}

// ---------------------------------------------------------------- shells
const LABELS = ['AP', 'APHE', 'APCR', 'APDS', 'APFSDS', 'HEAT', 'HESH', 'HE', 'HE-VT', 'HEI', 'Ball'];
const SK = Object.keys(SHELLS), used = new Set(W.flatMap((k) => PARTS[k].weapon.shells || []));
t('37 shells, every one a gun fires', SK.length === 37 && SK.every((k) => used.has(k)), `${SK.length}`);
t('every shell a gun names exists', [...used].every((k) => Object.prototype.hasOwnProperty.call(SHELLS, k)), show([...used].filter((k) => !SHELLS[k])));
t('every shell has a known type, a generic label and finite numbers', !bad(SK, (k) => { const s = SHELLS[k];
  return Object.prototype.hasOwnProperty.call(SHELL_TYPES, s.type) && LABELS.includes(s.label) && ['cal', 'v0', 'pen', 'k', 'kg', 'dmg'].every((q) => fin(s[q]) && s[q] >= 0) && s.v0 > 0 && s.k > 0 && s.k < 3e-4
    && (s.pen > 0) === !['he', 'hei', 'hevt'].includes(s.type) && (s.he == null || s.blast > 0); }).length, show(bad(SK, (k) => SHELL_TYPES[SHELLS[k].type] && LABELS.includes(SHELLS[k].label))));
t('a gun\'s shells are its calibre', W.filter((k) => PARTS[k].weapon.shells).every((k) => PARTS[k].weapon.shells.every((s) => SHELLS[s].cal === PARTS[k].weapon.cal)));
t('shell types: ricochet windows, normalisation, path, fragments', Object.values(SHELL_TYPES).every((y) => y.ric[0] < y.ric[1] && y.ric[1] <= 90 && fin(y.norm) && fin(y.L) && y.n >= 0 && y.cone >= 0));
// penetration at range: v = v0·e^(-kρx), pen·(v/v0)^1.43 (ρ 1.2: the arena's air)
const penAt = (k, x) => SHELLS[k].pen * Math.exp(-SHELLS[k].k * 1.2 * x * 1.43);
t('85 mm APHE: 124 mm at 1 km, through a Tygr\'s 102 mm front', Math.abs(penAt('aphe85', 1000) - 124) < 1.5 && penAt('aphe85', 1000) > eff('hullHeavy', 2)[0], penAt('aphe85', 1000).toFixed(1));
t('75 mm AP: 84 mm at 1 km and 95 at 300 m, short of the TK-34\'s 99 mm glacis', Math.abs(penAt('ap75', 1000) - 84) < 1 && Math.abs(penAt('ap75', 300) - 95) < 1 && penAt('ap75', 300) < eff('hullMedium', 2)[0]);
t('120 mm APFSDS at 1.5 km: through the TK-72\'s upper glacis, not its lower plate', Math.abs(penAt('apfsds120', 1500) - 517) < 3 && penAt('apfsds120', 1500) > eff('hullMBT', 2)[0] && penAt('apfsds120', 1500) < eff('hullMBT', 1)[0]);
t('105 mm APDS: 277 mm at 1 km, short of the MA-1\'s turret front', Math.abs(penAt('apds105', 1000) - 277) < 1.5 && penAt('apds105', 1000) < PARTS.turretWedge.armour.mm);

// ---------------------------------------------------------------- paints
const NEW_SKINS = ['steppe', 'ambush', 'woodland', 'whitewash'];
t('four armour paints (26 -> 30), in the camouflage formats, with no accent', Object.keys(SKINS).length === 30 && NEW_SKINS.every((k) => { const s = SKINS[k];
  return s && s.accent === null && /^#[0-9a-f]{6}$/.test(s.base) && fin(s.rough) && fin(s.metal) && (k === 'steppe' ? !s.camo : ['blotch', 'splinter'].includes(s.camo.k) && s.camo.c.every((c) => /^#[0-9a-f]{6}$/.test(c))) && !REAL.test(s.name); }));
t('a hull takes them', NEW_SKINS.every((k) => R(`cleanSkin('${k}', PARTS.hullMedium)`) === k));

// ---------------------------------------------------------------- the arenas
const A = EARTH.arenas, H = A && A.highland, P = EARTH.groundPads;
const S = (e, z) => T.surfaceAt(EARTH, ctx.siteAngle(EARTH, e), z), WET = (e, z) => T.waterAt(EARTH, ctx.siteAngle(EARTH, e), z);
t('Highland Ridge: its box, three zones (Hilltop, East, Slope), two pads, two air starts, twelve berms', !!H && H.clear && H.box.e0 === 16400 && H.box.e1 === 19100 && H.box.z0 === 13550 && H.box.z1 === 16450
  && H.zones.map((z) => z.id + z.name + z.r).join() === 'AHilltop55,BEast55,CSlope55' && H.zones[2].rDuel === 70 && H.pads[0] === P.highlandN && H.pads[1] === P.highlandS
  && H.air.length === 2 && H.air.every((s) => s.air.alt === 1000 && s.air.speed === 140) && H.berms.length === 12);
t('the berms come in pairs mirrored across z 15,000, and two on it', H.berms.every((b) => b.z === 15000 || H.berms.some((q) => q.e === b.e && q.z === 30000 - b.z && Math.abs(q.yaw + b.yaw) < 1e-12)) && H.berms.filter((b) => b.z === 15000).length === 2);
t('the Runway arena: pads at the runway\'s ends, three zones, no berms, ground as it is', A.runway.pads.map((p) => p.e + ':' + p.z).join() === '760:0,2640:0' && A.runway.zones.map((z) => z.e).sort().join() === '1250,1700,2150'
  && A.runway.zones.every((z) => z.r === 45) && !A.runway.berms.length && !A.runway.clear && !Object.values(P).some((p) => Math.abs(p.e - 1700) < 3000 && Math.abs(p.z) < 3000));
t('the detail fade: 1 in the box, fading over 200 m, nothing past it (and nothing round the runway)', T.arenaW(17750, 15000) === 1 && T.arenaW(16400, 13550) === 1 && T.arenaW(16300, 15000) > 0 && T.arenaW(16300, 15000) < 1
  && T.arenaW(16199, 15000) === 0 && T.arenaW(19301, 16651) === 0 && T.arenaW(1700, 0) === 0 && T.arenaW(1700, 200) === 0);
// the pads: level to ±5 cm over 160 x 70 m, dry, at their measured heights, and gone without the map
const padOff = [];
for (const [k, p] of Object.entries(P)) for (let u = -p.hl; u <= p.hl; u += 5) for (let v = -p.hw; v <= p.hw; v += 5) {
  const e = p.e + u * p.c - v * p.s, z = p.z + u * p.s + v * p.c, h = S(e, z);
  if (Math.abs(h - p.h) > 0.05 || WET(e, z)) padOff.push(`${k} (${e.toFixed(0)}, ${z.toFixed(0)}) ${h.toFixed(3)}`);
}
t('the pads are level to ±5 cm over their 160 x 70 m and dry', Object.keys(P).length === 2 && !padOff.length, show(padOff));
t('each pad is levelled at its own ground\'s height (25.1 and 51.3 m), facing the other', P.highlandN.h === 25.1 && P.highlandS.h === 51.3 && P.highlandN.yaw === -Math.PI / 2 && P.highlandS.yaw === Math.PI / 2
  && T.fieldAt(17750, 13800).f === P.highlandN && T.fieldAt(17750, 16200).f === P.highlandS);
// the berms: 2.4 m high where they stand, nothing elsewhere, physics standing on them, and none without the map
const crest = H.berms.map((b) => T.bermAt(b.e, b.z));
t('each berm crests at 2.4 m', crest.every((h) => Math.abs(h - 2.4) < 0.01), crest.map((h) => h.toFixed(2)).join(' '));
t('a berm is 26 m long and ends 12 m to either side', H.berms.every((b) => T.bermAt(b.e + 13.01 * b.c, b.z + 13.01 * b.s) === 0 && T.bermAt(b.e - 12.01 * b.s, b.z + 12.01 * b.c) === 0 && T.bermAt(b.e + 6 * b.c, b.z + 6 * b.s) > 2.3));
{
  let s = 99, outside = 0, n = 0; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 4000; i++) { const e = 14000 + rnd() * 8000, z = 11000 + rnd() * 8000; if (e > 16400 && e < 19100 && z > 13550 && z < 16450) continue; n++; if (T.bermAt(e, z) !== 0) outside++; }
  t('no berm outside the arena box', !outside && n > 1500, `${outside} of ${n}`);
}
const flat = G.load({ combat: false }); // (a twin of the game without the berms, to see the ground under them)
G.run(flat, 'EARTH.arenas.highland.berms = []');
const lift = H.berms.map((b) => S(b.e, b.z) - flat.Terrain.surfaceAt(flat.EARTH, flat.siteAngle(flat.EARTH, b.e), b.z));
t('vehicles and shells meet the berms: the ground stands 2.4 m higher on each crest', lift.every((d) => d > 2.15 && d < 2.45), lift.map((d) => d.toFixed(2)).join(' '));
const nomap = G.load({ earth: false });
t('without the Earth map: no berms, no pads, no fade (the arena needs the map)', H.berms.every((b) => nomap.Terrain.bermAt(b.e, b.z) === 0) && nomap.Terrain.fieldAt(17750, 13800).w === 0 && nomap.Terrain.fieldAt(17750, 16200).w === 0);

// ---------------------------------------------------------------- the ground everywhere else, as it was
// ---- ground sample (the reference values below came from this code run on the checkout before the arena, 2e9884a)
function groundSample(c) { // c: a loaded game; -> { map | nomap: ['heightAt:surfaceAt' hashes per 250 points], field: hash }
  const Tc = c.Terrain, Ec = c.EARTH, ang = (e) => c.siteAngle(Ec, e);
  const hash = (vals) => { const b = new Uint8Array(Float64Array.from(vals).buffer); let h = 0x811c9dc5; for (const x of b) { h ^= x; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  let s = 20261023; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const near = (e, z) => e > 16400 - 210 && e < 19100 + 210 && z > 13550 - 210 && z < 16450 + 210; // (the arena box and its 200 m fade)
  const pts = (areas, keepOut) => { const out = []; for (const [n, e0, e1, z0, z1] of areas) for (let i = 0; i < n;) { const e = e0 + rnd() * (e1 - e0), z = z0 + rnd() * (z1 - z0); if (keepOut && near(e, z)) continue; out.push([e, z]); i++; } return out; };
  const blocks = (list) => { const o = []; for (let i = 0; i < list.length; i += 250) { const q = list.slice(i, i + 250); o.push(hash(q.map(([e, z]) => Tc.heightAt(Ec, ang(e), z))) + ':' + hash(q.map(([e, z]) => Tc.surfaceAt(Ec, ang(e), z)))); } return o; };
  const field = [];
  for (const f of Object.values(Ec.airfields)) { const r = f.hl + f.blend + f.hw + 50; for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) { const e = f.e - r + (i / 20) * r, z = f.z - r + (j / 20) * r; if (near(e, z)) continue; const q = Tc.fieldAt(e, z); field.push(q.w, q.w > 0 ? q.h : 0); } }
  for (const site of Object.values(Ec.sites)) for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) { const q = Tc.fieldAt(site.east + i * 60, j * 60); field.push(q.w, q.w > 0 ? q.h : 0); }
  if (!Ec.mapped) return { nomap: blocks(pts([[500, -30000, 40000, -30000, 30000]], false)), field: hash(field) };
  // round the arena (outside its fade), the Faroes and the runway, Shetland, the Scotland airfield, and anywhere
  return { map: blocks(pts([[600, 14000, 22000, 10500, 19500], [400, -3000, 4000, -4000, 4000], [400, 16500, 21000, -3500, 3000], [300, 17500, 20500, 11000, 13340], [300, -40000, 60000, -40000, 40000]], true)), field: hash(field) };
}
// ---- end ground sample
const REF = { // (node test/catalogue.test.js --print, with ROOT at a checkout of 2e9884a)
  map: ['8b991bcd:61e2bffe', '9b8c3c29:5516ca67', 'cb065937:5a4ef780', 'bb9114a7:5dd9846b', '06ade9c5:30381140', '138b09cc:93640bf5', '294a33c6:117857d0', '7c7cfbbb:3d81be7c'],
  nomap: ['6adc1f5a:a262d8e0', '6f2b3f55:20bfe9f7'],
  field: 'f0362d73', nomapField: 'f0362d73',
};
const now = groundSample(G.load()), nowNo = groundSample(nomap);
t('heightAt and surfaceAt are bit for bit as before at 2,000 points outside the arena (8 blocks of 250)', now.map.join() === REF.map.join(), now.map.filter((h, i) => h !== REF.map[i]).length + ' blocks differ');
t('...and at 500 points anywhere without the Earth map, the arena included', nowNo.nomap.join() === REF.nomap.join());
t('fieldAt is as before round every airfield and site (with and without the map)', now.field === REF.field && nowNo.field === REF.nomapField);

t.done();
