// The sandbox's spawn points (the spawn points update: EARTH.spawns, Spawns in mpui.js, their pads in EARTH.groundPads and
// their props in props.js). The list: every kind's spots by region as the owner asked (Armour four on the Faroes, two in
// Scotland, two on Shetland; drones beside the tanks in each region and the helipad; planes, helicopters and rockets on
// Shetland and in Scotland too), one default per kind, today's start. Each spot dry, flat and clear of every prop; each
// drone pad within 150 m of a tank spot. Spawns.solo: nothing chosen (or a battle room) starts exactly as before, a stored
// choice starts there, forged choices are ignored, no map falls back. A room's next players stand apart on the pad.
// Then physics: each kind's stock craft started at each of its spots and stepped 5 s (as the game steps a flight) stays
// put, upright, whole and on its ground; the air starts fly. No prop of the new maps on its pad's spots, the track, an
// airfield's strip or the old Shetland slope path, every one on dry ground with its foot on it.
//   node test/spawns.test.js
const G = require('./lib/game.js'), fs = require('fs'), path = require('path');
const t = G.checks('spawns: the sandbox\'s spawn points');
const ctx = G.load({ combat: true, ground: true, props: true, flight: true }), R = (c) => G.run(ctx, c);
// Spawns from mpui.js and airfieldPlacement from mp.js, over stand-ins for the page (the map in, the 3D view on)
const src = (f) => fs.readFileSync(path.join(G.ROOT, 'js', f), 'utf8');
R(`var __ls = new Map(); var localStorage = { getItem: (k) => (__ls.has(k) ? __ls.get(k) : null), setItem: (k, v) => __ls.set(k, String(v)), removeItem: (k) => __ls.delete(k) };
var App = { use3D: () => !App.flat, flat: false, afterEarth(f) { f(); } };
var $ = () => null;`);
R(src('mp.js').match(/function airfieldPlacement\(af, slot, kind\) \{[\s\S]*?\n\}/)[0]);
R(src('mpui.js').match(/const Spawns = \{[\s\S]*?\n\};/)[0] + '\nthis.Spawns = Spawns;');
R(`Math.random = mulberry32(777); Settings.get = ((g) => (k) => (k === 'targets' ? 'off' : g.call(Settings, k)))(Settings.get);
var designOf = (key) => ({ name: TEMPLATES[key].name, kind: TEMPLATES[key].kind, parts: templateRows(TEMPLATES[key]) });`);
const E = ctx.EARTH, T = ctx.Terrain, S = ctx.Spawns, P = ctx.Props;
const A = (e) => ctx.siteAngle(E, e), gH = (e, z) => T.surfaceAt(E, A(e), z), wet = (e, z) => T.waterAt(E, A(e), z);
const J = (o) => JSON.stringify(o);

// ---------------------------------------------------------------- the list
const KINDS = ['rocket', 'plane', 'car', 'heli', 'drone', 'tank', 'ship'], L = E.spawns;
const by = (kind, region) => L.filter((s) => s.kinds.includes(kind) && (!region || s.region === region)).map((s) => s.id);
t('ids unique, every spot a known kind in a known region with a name and a blurb, exactly one of site, pad, airfield, arena, air and sea',
  new Set(L.map((s) => s.id)).size === L.length && L.every((s) => s.kinds.length && s.kinds.every((k) => KINDS.includes(k)) && ['Faroes', 'Shetland', 'Scotland'].includes(s.region) && s.name && s.blurb
    && ['site', 'pad', 'airfield', 'arena', 'air', 'sea'].filter((f) => s[f] != null).length === 1 && (!s.pad || E.groundPads[s.pad]) && (!s.airfield || E.airfields[s.airfield]) && (!s.site || E.sites[s.site])));
t('one default a kind, today\'s start: the pad, the runway (planes and cars), the helipad (helicopters and drones), Highland Ridge\'s north pad (Armour), the bay (ships)',
  J(KINDS.map((k) => L.filter((s) => s.def && s.def.includes(k)).map((s) => s.id))) === J([['pad'], ['runway'], ['runway'], ['helipad'], ['helipad'], ['highlandN'], ['bay']]));
t('Armour: four on the Faroes (the Tank Yard and three outposts), two in Scotland (Highland Ridge, Watten), two on Shetland',
  J(by('tank', 'Faroes')) === J(['yard', 'funningur', 'vidareidi', 'tvoroyri']) && J(by('tank', 'Scotland')) === J(['highlandN', 'watten']) && J(by('tank', 'Shetland')) === J(['northRoe', 'bixter']));
t('cars: the runway and every Armour spot', J(by('car')) === J(['runway', ...by('tank')].sort((a, b) => L.findIndex((s) => s.id === a) - L.findIndex((s) => s.id === b))));
t('drones: the helipad, and a drone pad by the tanks in each region', J(by('drone', 'Faroes')) === J(['helipad', 'yardDrone']) && J(by('drone', 'Shetland')) === J(['bixterDrone']) && J(by('drone', 'Scotland')) === J(['highlandDrone', 'wattenDrone']));
t('planes: the runway, the Shetland and Scotland airfields, two air starts; helicopters: the helipad and the two airfields\' helipads; rockets: the pad, Lunna and Bettyhill',
  J(by('plane')) === J(['runway', 'shetlandAir', 'scotlandAir', 'airFaroes', 'airHighland']) && J(by('heli')) === J(['helipad', 'shetlandAir', 'scotlandAir']) && J(by('rocket')) === J(['pad', 'lunna', 'bettyhill']));

// ---------------------------------------------------------------- where each puts a craft
t('ships (the ships update): the bay (their own site), off the slipway and Carrier West on the Faroes, off Shetland harbour and Carrier East, off Caithness and Carrier South; only ships at sea, and no ship on land',
  J(by('ship', 'Faroes')) === J(['bay', 'slipway', 'carrierW']) && J(by('ship', 'Shetland')) === J(['shetlandHbr', 'carrierE']) && J(by('ship', 'Scotland')) === J(['caithness', 'carrierS'])
  && L.every((s) => !s.sea === !s.kinds.includes('ship') || s.site === 'bay') && L.filter((s) => s.kinds.includes('ship')).every((s) => s.kinds.join() === 'ship'));
const ALL = [];
for (const s of L) for (const k of s.kinds) if (!s.site) ALL.push([s, k, R(`JSON.stringify(Spawns.place(Spawns.byId('${s.id}'), '${k}', 0))`)]);
const places = ALL.map(([s, k, j]) => [s, k, JSON.parse(j)]);
t('every spot off a site gives a place (with its spot\'s id; planes on the ground soft, so a seaplane keeps to the water)', places.every(([s, k, p]) => p && Number.isFinite(p.e) && Number.isFinite(p.z) && Number.isFinite(p.yaw) && p.spot === s.id && (k !== 'plane' || !!p.air !== !!p.soft)), places.filter(([, , p]) => !p).map(([s, k]) => s.id + ' ' + k));
// a ground spot: dry and flat under a 16 m square, no prop's solid footprint within 9 m (a drone or helicopter pad's 7 m)
const bad = [];
for (const [s, k, p] of places) {
  if (p.air || s.sea) continue; // (a sea spot's water: below)
  let lo = Infinity, hi = -Infinity, w = 0;
  for (let u = -8; u <= 8; u += 2) for (let v = -8; v <= 8; v += 2) { const h = gH(p.e + u, p.z + v); lo = Math.min(lo, h); hi = Math.max(hi, h); if (wet(p.e + u, p.z + v)) w++; }
  const slope = Math.atan((hi - lo) / 16) * 180 / Math.PI, clear = P.freeAt(p.e, p.z, k === 'drone' || k === 'heli' ? 7 : 9);
  if (w || slope > 4 || !clear) bad.push(`${s.id} ${k}: wet ${w}, ${slope.toFixed(1)}°, clear ${clear}`);
}
t('every ground spot dry, under 4° over 16 m, and clear of every prop\'s footprint', !bad.length, bad);
{
  const far = [];
  for (const s of L.filter((q) => q.kinds.includes('drone') && !q.site)) {
    const p = JSON.parse(R(`JSON.stringify(Spawns.place(Spawns.byId('${s.id}'), 'drone', 0))`)), near = L.filter((q) => q.region === s.region && q.kinds.includes('tank'))
      .map((q) => JSON.parse(R(`JSON.stringify(Spawns.place(Spawns.byId('${q.id}'), 'tank', 0))`))).map((q) => Math.hypot(q.e - p.e, q.z - p.z));
    if (!(Math.min(...near) < 150)) far.push(`${s.id} ${Math.min(...near).toFixed(0)} m`);
  }
  t('every drone pad within 150 m of a tank spot in its region (a tank\'s drone and a drone flown alone start together)', !far.length, far);
}
{ // a room: the next players at a spot stand apart (rockets share the pad, as the room's pad has always been shared)
  const close = [];
  for (const s of L.filter((q) => !q.site && !q.air)) for (const k of s.kinds.filter((q) => q !== 'rocket')) {
    const ps = JSON.parse(R(`JSON.stringify([0, 1, 2, 3, 4, 5].map((n) => Spawns.place(Spawns.byId('${s.id}'), '${k}', n)))`));
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (Math.hypot(ps[i].e - ps[j].e, ps[i].z - ps[j].z) < 10) close.push(`${s.id} ${k} ${i}-${j}`);
    if (s.pad) { const f = E.groundPads[s.pad]; for (const q of ps) { const de = q.e - f.e, dz = q.z - f.z; if (Math.abs(de * f.c + dz * f.s) > f.hl - 4 || Math.abs(-de * f.s + dz * f.c) > f.hw - 4) close.push(`${s.id} ${k} off its pad`); } }
  }
  t('a room\'s next five players at a spot stand 10 m or more apart, on its pad', !close.length, close.slice(0, 6));
}

// ---------------------------------------------------------------- Spawns.solo: the default as ever, a choice remembered
R(`var oldStart = (k) => JSON.stringify({ place: k === 'tank' ? GroundMode.soloPlace(k) : null });
var soloOf = (k) => JSON.stringify({ place: Spawns.solo(k).place });`);
t('nothing chosen: every kind starts exactly where it did (Armour on Highland Ridge\'s north pad, the rest at their sites)', R(`${J(KINDS)}.every((k) => soloOf(k) === oldStart(k))`), R(`${J(KINDS)}.map((k) => k + ' ' + soloOf(k)).join(' | ')`));
R(`Spawns.choose('tank', 'watten'); Spawns.choose('drone', 'wattenDrone'); Spawns.choose('rocket', 'lunna'); Spawns.choose('plane', 'airHighland');`);
t('a choice is remembered per kind (rss.spawn) and the flight starts there', R(`Spawns.solo('tank').sp.id === 'watten' && Spawns.solo('tank').place.spot === 'watten' && Spawns.solo('drone').place.spot === 'wattenDrone' && Spawns.solo('rocket').place.spot === 'lunna' && Spawns.solo('plane').place.air.alt === 1000
  && JSON.parse(localStorage.getItem('rss.spawn')).tank === 'watten' && soloOf('car') === oldStart('car') && soloOf('heli') === oldStart('heli')`));
t('...a spot chosen that is its kind\'s default starts as ever; solo play always offers the choice (every flight is sandbox), a battle room ignores it', R(`(() => { Spawns.choose('rocket', 'pad'); const a = soloOf('rocket') === oldStart('rocket'); Spawns.choose('rocket', 'lunna');
  const solo = Spawns.offered(); this.MP = { live: true, pvp: true, ground: false }; const b = !Spawns.offered() && ${J(KINDS)}.every((k) => soloOf(k) === oldStart(k)); delete this.MP; return a && b && solo; })()`));
t('forged or stale choices are ignored: another kind\'s spot, unknown ids, __proto__, numbers, an array, junk', R(`(() => { const ok = [];
  for (const raw of ['{"tank":"lunna"}', '{"tank":"nowhere"}', '{"__proto__":"yard","tank":"__proto__"}', '{"tank":7}', '["watten"]', 'junk', '{"tank":{"id":"watten"}}']) {
    localStorage.setItem('rss.spawn', raw); ok.push(soloOf('tank') === oldStart('tank') && Spawns.choose('car', 'nowhere') === false && Spawns.choose('rocket', 'yard') === false); }
  localStorage.setItem('rss.spawn', '{}'); return ok.every(Boolean); })()`));
t('without the map or the 3D view: a chosen spot falls back to the default (and says so), its site spots still fine', R(`(() => { Spawns.choose('tank', 'watten'); Spawns.choose('car', 'runway'); App.flat = true;
  const a = Spawns.solo('tank'), c = Spawns.solo('car'); App.flat = false; return a.fell && a.sp.id === 'highlandN' && !c.fell && c.place === null; })()`));
t('Spawns.room (a multiplayer sandbox): our spot for our slot, nothing for a site or nothing chosen (the room\'s own places)', R(`(() => { Spawns.choose('tank', 'bixter'); const a = Spawns.room('tank', 2), b = Spawns.place(Spawns.byId('bixter'), 'tank', 2);
  Spawns.choose('heli', 'helipad'); localStorage.setItem('rss.spawn', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('rss.spawn')), { car: undefined })));
  return JSON.stringify(a) === JSON.stringify(b) && Spawns.room('heli', 1) === null && Spawns.room('car', 0) === null; })()`));

// ---------------------------------------------------------------- physics: each kind's stock craft at each of its spots
// (as Flight.start builds and places it, the drone's and the helicopter's start as its; then 5 s of 60 fps frames, each
// two 1/120 s steps and Combat's step and frame)
R(`var world = () => { const F = Object.create(Flight);
  Object.assign(F, { time: 0, target: null, log: [], broken: [], vessels: [], active: null, firing: false, mgFiring: false, groundAim: false, warpIdx: 0, mp: null, scale: 12,
    running: true, destroyed: false, camAbs: { x: 0, y: 0, z: 0 }, launchCost: 0, flags: {}, stats: { maxAlt: 0, maxSpeed: 0, maxG: 0 }, design: null, crashedAt: null,
    toast(m) { this.log.push(m); }, award(f) { this.flags[f] = true; }, syncAwake() {}, syncSas() {}, updatePrediction() {}, updateDvEstimate() {}, updateHUD() {}, strip() {}, setSight() {}, unlockPointer() {},
    endAfter() {}, onDestroyed() { this.destroyed = true; }, cleanup() { this.vessels = this.vessels.filter((v) => !v.dead && v.parts.length); } });
  return F; };
var mk = (design, P) => {
  const ps = partsFromDesign(design.parts), adjAll = buildAdjacency(ps), ctrl = findControlPart(ps), keep = componentOf(ctrl.id, adjAll), parts = ps.filter((p) => keep.has(p.id)), adj = new Map();
  for (const p of parts) { if (p.att != null && !keep.has(p.att)) p.att = null; adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id)))); }
  const v = new Vessel(parts, adj, EARTH); v.name = design.name; v.kind = design.kind; v.stages = computeStages(parts, adj, ctrl.id); v.rebuildGroups();
  if (v.kind === 'drone') { for (const p of v.parts) if (p.def.thrust) p.active = true; v.stageIdx = v.stages.length; v.sas = 'hold'; v.throttle = v.aircraft ? 0.7 : 0; }
  if (v.kind === 'plane') v.sas = 'hold';
  v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), VEHICLE_KINDS[v.kind].launchRot, P.z, P.yaw || 0);
  const air = P.air ? P.air : P.spot && v.kind === 'drone' && v.dr.wing ? { alt: 120, speed: 26 } : null;
  if (air) { const r = v.radius(), f = v.axis(v.pilot.F.x, v.pilot.F.y, v.pilot.F.z); v.x += (v.x / r) * air.alt; v.y += (v.y / r) * air.alt; v.z += (v.z / r) * air.alt; v.vx = f.x * air.speed; v.vy = f.y * air.speed; v.vz = f.z * air.speed; v.landed = false;
    if (v.hasRetract) { v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true; } }
  if (v.kind === 'heli') v.throttle = 0;
  if (v.kind === 'drone') v.dl = { t: 0, at0: { x: v.x, y: v.y, z: v.z }, t0: 0 };
  return v; };
var go = (F, secs) => { for (let f = 0, N = Math.round(secs * 60); f < N; f++) { for (let i = 0; i < 2; i++) { for (const v of F.vessels.slice()) if (!v.dead && v.parts.length) v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; }
  Combat.frame(F, 1 / 60); F.cleanup(); } };
var STOCK = { tank: ['tk34', 'ma1c'], car: ['buggy', 'technical'], drone: ['bumble', 'lancett'], heli: ['dragonfly'], plane: ['falcon'], rocket: ['pathfinder'], ship: [] }; // (ships: their own trial, below)
var trial = (id, kind, key) => { const P = Spawns.place(Spawns.byId(id), kind, 0), F = world(), v = mk(designOf(key), P), n = v.parts.length;
  F.vessels = [v]; F.active = v; Combat.reset(F); go(F, 0.5);
  const x0 = { x: v.x, y: v.y, z: v.z }, up0 = v.axis(0, 1, 0), fw0 = v.axis(1, 0, 0), g0 = v.altitude();
  go(F, 4.5);
  const up1 = v.axis(0, 1, 0), fw1 = v.axis(1, 0, 0), turn = Math.acos(Math.min(1, up0.x * up1.x + up0.y * up1.y + up0.z * up1.z)) * 180 / Math.PI;
  const sp = Math.hypot(v.vx, v.vy, v.vz), moved = Math.hypot(v.x - x0.x, v.y - x0.y, v.z - x0.z);
  return { id, kind, key, air: !!(P.air || (kind === 'drone' && v.dr && v.dr.wing)), dead: !!(F.destroyed || v.dead), lost: n - v.parts.length, turn: +turn.toFixed(2), moved: +moved.toFixed(2), speed: +sp.toFixed(2),
    agl: +v.groundAltitude().toFixed(2), alt: +v.altitude().toFixed(1), alt0: +g0.toFixed(1), landed: !!v.landed }; };`);
const runs = [];
for (const s of L.filter((q) => !q.site)) for (const k of s.kinds) for (const key of R(`JSON.stringify(STOCK['${k}'])`) && JSON.parse(R(`JSON.stringify(STOCK['${k}'])`))) runs.push(JSON.parse(R(`JSON.stringify(trial('${s.id}', '${k}', '${key}'))`)));
const ground = runs.filter((r) => !r.air), flying = runs.filter((r) => r.air);
const rest = ground.filter((r) => r.dead || r.lost || r.turn > 3 || r.moved > 1 || r.speed > 0.3 || r.agl > 2.5);
t(`each kind's stock craft at each of its ground spots (${ground.length} starts) stays put 5 s: whole, upright (under 3° of tilt), under 1 m of travel and at rest, on its ground`, !rest.length && ground.length > 40, rest.length ? rest.slice(0, 6) : { n: ground.length, most: Math.max(...ground.map((r) => r.moved)), tilt: Math.max(...ground.map((r) => r.turn)) });
const fly = flying.filter((r) => r.dead || r.lost || r.alt < 0.6 * r.alt0 || r.speed < 15);
t(`the air starts (${flying.length}: planes over the Faroes and Highland Ridge, a winged drone over its pads) fly on, whole and up`, !fly.length && flying.length >= 6, fly.length ? fly : flying.map((r) => `${r.id} ${r.key} ${r.alt}/${r.alt0} m ${r.speed} m/s`));

// ---------------------------------------------------------------- the ships update: the sea spots
// Every ship spot (the bay's own site too), and a room's first six places at each (abreast, 120 m apart): the water under
// a box round each stock ship there (her length plus 20 m, her beam plus 4 m, along her yaw) deeper than her draft + 2 m
// everywhere (her draft: what ship.js's hydrostatics says she draws, or, before it does, her hull's whole depth, keel to
// deck: more than she can draw), and the spot clear of the carriers' hulls; the abreast places 120 m apart.
{
  const SHIPS = Object.keys(ctx.TEMPLATES).filter((k) => ctx.TEMPLATES[k].kind === 'ship');
  R(`var shipDims = (key) => { const ps = partsFromDesign(templateRows(TEMPLATES[key])); const hs = ps.filter((p) => p.def.shull); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, b = 0;
    for (const p of ps) { const r = partRect(p); x0 = Math.min(x0, r.l); x1 = Math.max(x1, r.r); }
    for (const p of hs) { const r = partRect(p); y0 = Math.min(y0, r.b); y1 = Math.max(y1, r.t); b = Math.max(b, p.def.depth || 0); }
    const hy = typeof Ship !== 'undefined' ? Ship.hydrostatics(ps) : null, draft = hy && hy.draft > 0 ? hy.draft : y1 - y0;
    return { L: x1 - x0, B: b, draft, hull: hs.length }; };`);
  const dims = Object.fromEntries(SHIPS.map((k) => [k, JSON.parse(R(`JSON.stringify(shipDims('${k}'))`))]));
  const spots = L.filter((s) => s.kinds.includes('ship')), bad = [], near = [];
  for (const s of spots) {
    const ps = s.site ? [{ e: E.sites[s.site].east, z: 0, yaw: Math.PI }] : JSON.parse(R(`JSON.stringify([0, 1, 2, 3, 4, 5].map((n) => Spawns.place(Spawns.byId('${s.id}'), 'ship', n)))`));
    for (const [n, P] of ps.entries()) for (const k of SHIPS) {
      const d = dims[k], c = Math.cos(P.yaw), sn = -Math.sin(P.yaw), hl = d.L / 2 + 10, hw = d.B / 2 + 2;
      let lo = Infinity;
      for (let u = -hl; u <= hl; u += 4) for (let v = -hw; v <= hw; v += 2) lo = Math.min(lo, -T.heightAt(E, A(P.e + u * c - v * sn), P.z + u * sn + v * c));
      if (!(lo > d.draft + 2)) bad.push(`${s.id}#${n} ${k}: ${lo.toFixed(1)} m of water, draws ${d.draft.toFixed(1)}`);
      for (const C of Object.values(E.carriers)) if (Math.hypot(P.e - C.e, P.z - C.z) < C.hl + d.L / 2 + 40) near.push(`${s.id}#${n} by ${C.name}`);
    }
    if (!s.site) for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (Math.hypot(ps[i].e - ps[j].e, ps[i].z - ps[j].z) < 119) near.push(`${s.id} ${i}-${j} close`);
  }
  t(`every ship spot and a room's six places at each: deeper than each stock ship's draft + 2 m under her whole length and beam (${SHIPS.join(', ')}), clear of the carriers, 120 m apart`,
    SHIPS.length > 0 && Object.values(dims).every((d) => d.hull > 0 && d.L > 5) && !bad.length && !near.length, bad.length || near.length ? [...bad, ...near].slice(0, 8) : dims);
  // her start as Flight.start makes it: placed on the water at the spot, then (when ship.js's core floats her) afloat at her
  // marks (Ship.launch); 5 s on she is whole, upright and where she started (no slipway, carrier or shore under her)
  R(`var shipTrial = (id, key) => { const sp = Spawns.byId(id), P = sp.site ? { e: EARTH.sites[sp.site].east, z: 0, yaw: Math.PI } : Spawns.place(sp, 'ship', 0), F = world(), v = mk(designOf(key), P), n = v.parts.length;
    if (v.hydro && Ship.overWater(v)) Ship.launch(v, P);
    F.vessels = [v]; F.active = v; Combat.reset(F); const x0 = { x: v.x, y: v.y, z: v.z }, up0 = v.axis(0, 1, 0); go(F, 5);
    const up1 = v.axis(0, 1, 0), tilt = Math.acos(Math.min(1, up0.x * up1.x + up0.y * up1.y + up0.z * up1.z)) * 180 / Math.PI;
    return { id, key, dead: !!(F.destroyed || v.dead), lost: n - v.parts.length, tilt: +tilt.toFixed(2), moved: +Math.hypot(v.x - x0.x, v.y - x0.y, v.z - x0.z).toFixed(2), hydro: v.hydro }; };`);
  const st = [];
  for (const s of spots) for (const k of SHIPS) st.push(JSON.parse(R(`JSON.stringify(shipTrial('${s.id}', '${k}'))`)));
  const sick = st.filter((r) => r.dead || r.lost || r.tilt > 6 || r.moved > 15 || !r.hydro);
  t(`each stock ship started at each ship spot (${st.length} starts) is whole, upright (under 6° on the swell) and where she started 5 s on`, !sick.length && st.length >= spots.length, sick.length ? sick.slice(0, 6) : { most: Math.max(...st.map((r) => r.moved)), tilt: Math.max(...st.map((r) => r.tilt)) });
  // [WP11] the Naval Battle's arena, the Shetland Sound (EARTH.arenas.sound): each team's twelve starts (GroundMode.placement:
  // abreast 120 m apart, a second row astern) deep enough under every stock ship's box there, and every zone's water (its
  // duel ring too) deeper than the deepest stock ship's draft + 2 m, sampled every 25 m; nothing of it on land
  const S = E.arenas.sound, deep = Math.max(...Object.values(dims).map((d) => d.draft)) + 2, sb = [];
  for (const tm of [0, 1]) for (let k = 0; k < 12; k++) {
    const P = ctx.GroundMode.placement('sound', tm, k, 'ship');
    for (const key of SHIPS) {
      const d = dims[key], c = Math.cos(P.yaw), sn = -Math.sin(P.yaw), hl = d.L / 2 + 10, hw = d.B / 2 + 2;
      let lo = Infinity;
      for (let u = -hl; u <= hl; u += 4) for (let v = -hw; v <= hw; v += 2) lo = Math.min(lo, -T.heightAt(E, A(P.e + u * c - v * sn), P.z + u * sn + v * c));
      if (!(lo > d.draft + 2)) sb.push(`team ${tm} #${k} ${key}: ${lo.toFixed(1)} m`);
    }
  }
  let zlo = Infinity;
  for (const zn of S.zones) { const r = Math.max(zn.r, zn.rDuel || 0); for (let u = -r; u <= r; u += 25) for (let v = -r; v <= r; v += 25) if (u * u + v * v <= r * r) zlo = Math.min(zlo, -T.heightAt(E, A(zn.e + u), zn.z + v)); }
  t(`the Shetland Sound: each team's twelve starts deeper than each stock ship's draft + 2 m under her whole box, and every zone (its duel ring too) ${zlo.toFixed(1)} m deep at its shallowest, past the deepest draft + 2 m (${deep.toFixed(1)} m)`,
    !sb.length && zlo > deep && S.pads.every((f) => !!wet(f.e, f.z)), sb.slice(0, 6));
  // (review play-1) the two starts out of each other's sight at every money tier: each stock ship afloat at the West start,
  // her top over the water (where Ship.spots and the sea radars look from and at), on a rough sea's highest crest; the
  // tallest two see each other over the horizon √(2R·h₁) + √(2R·h₂) apart, which must fall short of the starts' 9.4 km
  const tops = JSON.parse(R(`JSON.stringify(Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].kind === 'ship').map((key) => {
    const P = GroundMode.placement('sound', 0, 0, 'ship'), ps = partsFromDesign(templateRows(TEMPLATES[key])), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = 'ship'; v.rebuildGroups();
    v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), VEHICLE_KINDS.ship.launchRot, P.z, P.yaw); Ship.launch(v, P);
    const c = v.com, w = v.toWorld(c.x, v.bounds.maxY, c.z || 0);
    return [key, +(Math.hypot(w.x, w.y, w.z) - EARTH.radius).toFixed(2)]; }))`));
  const crest = JSON.parse(R(`JSON.stringify(SHIP.WAVES.reduce((a, w) => a + w[0], 0) * SHIP.SEA.rough.a)`)), hmax = Math.max(...tops.map((x) => x[1])) + crest;
  const sees = 2 * Math.sqrt(2 * E.radius * hmax), apart = Math.hypot(S.pads[0].e - S.pads[1].e, S.pads[0].z - S.pads[1].z);
  t(`the Shetland Sound: its starts ${(apart / 1000).toFixed(1)} km apart, out of sight of each other for every stock ship (the tallest, ${tops.reduce((m, x) => (x[1] > m[1] ? x : m))[0]}, on a rough crest: ${(sees / 1000).toFixed(2)} km over the horizon), so no start is shot at from the other`,
    tops.length >= 8 && sees < apart - 300, tops);
}

// ---------------------------------------------------------------- the props round them
const NEW = ['funningur', 'vidareidi', 'tvoroyri', 'northRoe', 'bixter', 'lunna', 'shAir', 'watten', 'bettyhill', 'gbAir'];
const maps = P.areas().filter((m) => NEW.includes(m.id)), K = P.K;
t('ten new maps, appended to the room\'s codes (the old three keep theirs), needing the Earth map', maps.map((m) => m.id).join() === NEW.join() && P.MAP_IDS.slice(0, 3).join() === 'highland,runway,isle' && J(P.MAP_IDS.slice(3)) === J(NEW)
  && (() => { const nm = G.load({ earth: false }).Props; nm.buildAll(); return nm.areas().map((m) => m.id).join() === 'runway'; })());
const n = (id, k) => (P.count(id)[k] || 0);
t('each outpost: its concrete, sandbags, two garages, stores, a fuel tank, a camouflage net, a fence; a drone pad at Bixter and Watten',
  ['funningur', 'vidareidi', 'tvoroyri', 'northRoe', 'bixter', 'watten'].every((id) => n(id, 'apron') === 1 && n(id, 'sandbags') >= 5 && n(id, 'garage') === 2 && n(id, 'container') >= 2 && n(id, 'fueltank') === 1 && n(id, 'camonet') === 1 && n(id, 'fence') + n(id, 'hedge') >= 30 && n(id, 'hpad') === (['bixter', 'watten'].includes(id) ? 1 : 0)));
t('each launch pad its concrete and service tower, fuel tanks and a blockhouse; each airfield four helipads, the crews\' hut, a fuel bowser and crates (its hangars, tower and windsock are render3d\'s own)',
  ['lunna', 'bettyhill'].every((id) => n(id, 'apron') === 1 && n(id, 'gantry') === 1 && n(id, 'fueltank') === 2 && n(id, 'garage') === 1) && ['shAir', 'gbAir'].every((id) => n(id, 'hpad') === 4 && n(id, 'shed') === 1 && n(id, 'fueltank') === 1 && n(id, 'crate') === 4));
{
  const off = { wet: [], ground: [], spot: [], strip: [], slope: [], track: [], isle: [] }, I = T.ISLE;
  const foot = (p) => [[0, 0], [p.w / 2, p.d / 2], [-p.w / 2, p.d / 2], [p.w / 2, -p.d / 2], [-p.w / 2, -p.d / 2]].map(([u, v]) => [p.e + u * p.c - v * p.s, p.z + u * p.s + v * p.c]);
  const spots = places.filter(([, , p]) => !p.air).map(([s, k, p]) => [s.id, k, p]);
  for (const m of maps) for (const p of m.props) {
    const tag = `${m.id} ${P.KINDS[p.k]} (${p.e.toFixed(0)}, ${p.z.toFixed(0)})`, F = foot(p), wide = [K.house, K.barn, K.church, K.ruin, K.shed, K.garage, K.container, K.wall, K.sandbags, K.hedge].includes(p.k);
    const lift = p.k === K.container && p.g > Math.min(...F.map(([e, z]) => gH(e, z))) + 1, flat = [K.apron, K.hpad].includes(p.k);
    if (F.slice(0, wide ? 5 : 1).some(([e, z]) => wet(e, z))) off.wet.push(tag);
    if (!lift && Math.abs(p.g - Math.min(...F.slice(0, wide ? 5 : 1).map(([e, z]) => gH(e, z)))) > 0.02) off.ground.push(tag);
    const r = Math.hypot(p.w, p.d) / 2;
    if (!flat) for (const [id, k, q] of spots) if (Math.hypot(p.e - q.e, p.z - q.z) < r + (k === 'rocket' ? 9 : 5)) off.spot.push(`${tag} on ${id} ${k}`);
    for (const f of Object.values(E.airfields)) { const de = p.e - f.e, dz = p.z - f.z, u = Math.abs(de * f.c + dz * f.s), v = Math.abs(-de * f.s + dz * f.c); if (u < f.hl + 300 && v < f.hw + (flat ? 30 : 40 + r)) off.strip.push(tag); } // (helipads 75 m out, where mp.js puts helicopters)
    if (Math.hypot(p.e - 17720, p.z + 620) < 150) off.slope.push(tag);
    if (Math.abs(p.z) < 80 && p.e < 3500) off.track.push(tag);
    if (Math.hypot((p.e - I.e) / I.a, p.z / I.b) < 1.1) off.isle.push(tag);
  }
  t('the new maps\' props: on dry ground with their feet on it (nothing floats), none on a spot where a craft starts, an airfield\'s strip or its ends, the Shetland slope path, the track or the island\'s own map',
    Object.values(off).every((a) => !a.length), Object.fromEntries(Object.entries(off).map(([k, a]) => [k, a.length + (a.length ? ' ' + a.slice(0, 2).join('; ') : '')])));
}
t('in a room a knocked-over windsock is shared (a crush code, its map\'s code appended), a forged one for the tower, a helipad or a garage is refused', R(`(() => {
  Props.sync(true); const out = [];
  const go = (id, kind) => { const m = Props.MAP_IDS.indexOf(id), M = Props.areas().find((q) => q.id === id), i = M.props.findIndex((p) => Props.KINDS[p.k] === kind); return Props.netFall(m, M.sig, [i], [90], 0); };
  out.push(go('bixter', 'windsock') === 1, go('lunna', 'gantry') === -1, go('shAir', 'hpad') === -1, go('watten', 'garage') === -1, go('bixter', 'windsock') === 0);
  Props.sync(false); Props.reset(); return out.every(Boolean); })()`));
t.done();
