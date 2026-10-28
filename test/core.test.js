// The part model with depth (z), attach links (att) and paint (skin): clashes and mounting at different depths,
// legacy twin pairs keeping the side-view rule, design rows round trip, cleaning of bad rows, attachedTo and
// sideOrder.   node test/core.test.js
const G = require('./lib/game.js');
const ctx = G.load({ earth: false });
const R = (code) => G.run(ctx, code);
const t = G.checks('core: part model');
R(`var mk = (t, x, y, e) => makePart(t, x, y, e);
var fus = mk('fuselageW', 0, 7.5), wing = mk('wingL', 0.9, 11.6), podA = mk('fanPods', 1.8, 12.4), podB = mk('fanPods', 1.8, 12.4, { z: 9 }), jet = mk('jet', 1.5, 11.6, { z: 4 }), jet0 = mk('jet', 1.5, 11.6);`);
t('two fan pod pairs on one wing at different depths do not clash', !R('partsClash(podA, podB)'));
t('two fan pod pairs at the same depth clash', R('partsClash(podA, mk("fanPods", 1.8, 12.4))'));
t('a single jet out on the wing does not clash with the fuselage', !R('partsClash(jet, mk("fuselageW", 0, 13.5))'));
t('a single jet on the centreline over the fuselage clashes', R('partsClash(jet0, mk("fuselageW", 0, 11.6))'));
t('the jet out on the wing is mounted on it', R('partsMounted(jet, wing)'));
t('pod pair B (no att, legacy) still links by the side view', R('pylonLink(podB, wing)'));
t('pod pair B with att does not use the side-view rule', R('podB.att = wing.id, !pylonLink(podB, fus)'));
R(`var ps = [fus, wing, podA, podB, jet]; var rows = designRows(ps);`);
t('rows omit default depth', R('rows[2].z === undefined && rows[3].z === 9 && rows[4].z === 4'));
t('rows carry att as an index', R('rows[3].att === 1'));
R(`var back = partsFromDesign(rows);`);
t('round trip keeps depth and att', R('back[3].z === 9 && back[3].att === back[1].id && back[4].z === 4 && back[2].z === 5.5'));
t('unknown rows are dropped after att indices are read', R(`(() => { const r = [{type:'nope',x:0,y:0}, ...rows]; r[4].att = 2; const b = partsFromDesign(r); return b.length === 5 && b[3].att === b[1].id; })()`));
t('att cycles are broken', R(`(() => { const r = rows.map((q) => ({ ...q })); r[0].att = 1; r[1].att = 0; const b = partsFromDesign(r); return (b[0].att == null) !== (b[1].att == null); })()`));
t('bad skins and z are cleaned', R(`(() => { const b = partsFromDesign([{type:'fuselage',x:0,y:0,z:1e9,skin:'__proto__'},{type:'wingL',x:0,y:0,z:5,skin:'stealth'},{type:'aam',x:0,y:0,z:-0.01}]); return b[0].z === 20 && b[0].skin === null && b[1].z === 0 && b[1].skin === 'stealth' && b[2].z > 0.2; })()`));
t('a skin on a wheel is refused', R(`partsFromDesign([{type:'wheel',x:0,y:0,skin:'red'}])[0].skin === null`));
t('attachedTo walks the tree', R(`(() => { const a = mk('fuselage',0,0), b = mk('wingL',0,0,{att:a.id}), c = mk('jet',0,0,{att:b.id}), d = mk('aam',0,0,{att:c.id}); return attachedTo([a,b,c,d],[b]).length === 2; })()`));
// the look-alike jets: their templates can be edited (no clashes) and fly whole; the Russian ones' lofted hulls stay in their
// parts' boxes (the canopies may stand above, as other cockpits' do); wing plans run from the root out to the tip
t('the look-alike jets\' templates: no parts clash, every part is joined', R(`Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].parts.some((r) => /^(ru|us4|us5)/.test(r[0]))).every((k) => {
  const ps = partsFromDesign(templateRows(TEMPLATES[k]));
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (partsClash(ps[i], ps[j])) return false;
  return componentOf(findControlPart(ps).id, buildAdjacency(ps)).size === ps.length; })`));
t('lofted hulls stay inside their part\'s box', R(`Object.values(PARTS).filter((d) => d.loft).every((d) => ruLofts(d).hull.every((L) => L.st.every((s) =>
  s.top >= -d.w / 2 - 0.03 && s.bot <= d.w / 2 + 0.03 && s.top <= s.bot && Math.abs(s.y) <= d.h / 2 + 1e-6 && s.hw <= (d.depth || d.w) / 2 + 0.03)))`));
t('wing plans run from the root out to the tip, leading edge ahead of the trailing edge', R(`Object.values(PARTS).filter((d) => d.wing && d.wing.plan).every((d) => {
  const P = d.wing.plan; return P[P.length - 1][0] === 1 && P.every((r, i) => r[1] > r[2] && r[0] >= 0 && (i === 0 || r[0] > P[i - 1][0])); })`));
t('sideOrder puts the far side first and pods last', R(`sideOrder([mk('jet',0,0,{z:3}), fus, mk('jet',0,0,{z:-3}), wing]).map((p) => p.type + ':' + partZ(p)).join(',') === 'jet:-3,fuselageW:0,wingL:0,jet:3'`));
t.done();

// ---- the stock ground vehicles (spec §12): sixteen templates after the jets, fifteen Armour and an armed car. Each
// can be edited (no clashes) and fights whole (every part joined to its control part), its turret turns all the way
// round and its gun dips as far ahead as it may, it costs no more than its money tier, it drives off down the runway,
// climbs a 15° slope and stands on every spawn slot of Highland Ridge's two pads without sinking or tipping.
const g = G.checks('core: the stock ground vehicles');
const W = G.load({ combat: true }), RW = (code) => G.run(W, code);
const GROUND = { // key: [name, money tier it fits ($)]
  tk34: ['TK-34', 45000], ms4: ['MS-4 Shermin', 45000], tygr: ['Tygr I', 45000], pumo: ['Pumo 8×8', 45000], stuq3: ['StuQ III', 45000], ms18: ['MS-18 Hellion', 45000],
  leapard1: ['Leapard 1', 45000], tk72: ['TK-72', 75000], ma1: ['MA-1 Abrahm', 120000], zsy23: ['ZSY-23 Shilko', 45000], gepardo: ['Gepardo', 75000], bmk2: ['BMK-2', 45000],
  brdk2: ['BRDK-2 Gadfly', 45000], bk21: ['BK-21 Grod', 45000], ok8: ['OK-8 Hive', 75000], technical: ['Desert Technical', 45000],
};
W.__G = GROUND;
const keys = Object.keys(W.TEMPLATES), gv = keys.filter((k) => W.TEMPLATES[k].parts.some((r) => W.PARTS[r[0]] && W.PARTS[r[0]].gv));
g('51 templates; the sixteen ground ones last (after the jets), under their own names', keys.length === 51 && JSON.stringify(gv) === JSON.stringify(Object.keys(GROUND)) && JSON.stringify(keys.slice(-16)) === JSON.stringify(gv)
  && gv.every((k) => W.TEMPLATES[k].name === GROUND[k][0]), gv.map((k) => W.TEMPLATES[k].name).join(', '));
g('fifteen are Armour (kind tank), the Desert Technical a car; none of them military; each with a blurb', gv.filter((k) => W.TEMPLATES[k].kind === 'tank').length === 15 && W.TEMPLATES.technical.kind === 'car'
  && gv.every((k) => !W.TEMPLATES[k].military && W.TEMPLATES[k].blurb.length > 40));
g('career tier: the highest of its parts\'', gv.every((k) => W.TEMPLATES[k].tier === Math.max(...W.TEMPLATES[k].parts.map((r) => W.PARTS[r[0]].tier || 0))));
g('paint: each paint names a part it carries and a skin those parts take', RW(`Object.keys(__G).every((k) => { const T = TEMPLATES[k]; return T.paint && Object.keys(T.paint).every((type) => T.parts.some((r) => r[0] === type) && cleanSkin(T.paint[type], PARTS[type]) === T.paint[type]); })`));
RW(`var ground = {};
for (const k in __G) {
  const ps = partsFromDesign(templateRows(TEMPLATES[k])), adj = buildAdjacency(ps), ctrl = findControlPart(ps), tg = Aim.groupsOfParts(ps, adj);
  let clash = 0; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (partsClash(ps[i], ps[j])) clash++;
  const W = Aim.summary(ps), main = ps.find((p) => p.def.aim && p.def.weapon && p.def.name === W.gun), mg = tg.find((q) => q.ids.has(main.id)), S = mg && Aim.sweep(ps, mg);
  ground[k] = { n: ps.length, joined: ctrl ? componentOf(ctrl.id, adj).size : 0, ctrl: ctrl && ctrl.type, clash, jam: tg.filter((q) => q.jam).length, groups: tg.length,
    yawLim: tg.map((q) => Aim.sweep(ps, q).yawLim).filter(Boolean).length, dep0: S ? S.dep[0] * 180 / Math.PI : null, el0: main.def.aim.el[0], main: main.type, inGroup: !!mg,
    cost: designCost(ps), gear: Gear.stats(ps) };
}`);
const GR = W.ground;
g('no part clashes with another, and every part is joined to the control part (the hull; the technical\'s cab)', gv.every((k) => GR[k].clash === 0 && GR[k].joined === GR[k].n && GR[k].ctrl === (k === 'technical' ? 'cab' : W.TEMPLATES[k].parts[0][0])),
  gv.filter((k) => GR[k].clash || GR[k].joined !== GR[k].n).map((k) => `${k}: ${GR[k].clash} clashes, ${GR[k].joined}/${GR[k].n} joined`).join('; '));
g('every turret ring turns (none jammed), all the way round (no part in the way)', gv.every((k) => !GR[k].jam && !GR[k].yawLim) && gv.filter((k) => GR[k].groups).length === 14,
  gv.filter((k) => GR[k].jam || GR[k].yawLim).join());
g('the main weapon dips as far ahead as its own mount lets it (within 0.5°); on a turret but for the StuQ\'s casemate gun and the technical\'s own swivel', gv.every((k) => (GR[k].inGroup ? GR[k].dep0 <= GR[k].el0 + 0.5 : k === 'stuq3' || k === 'technical')),
  gv.map((k) => `${k} ${GR[k].main} ${GR[k].dep0 == null ? '-' : GR[k].dep0.toFixed(1)}/${GR[k].el0}`).join(', '));
g('each fits its money tier', gv.every((k) => GR[k].cost <= GROUND[k][1]), gv.map((k) => `${k} $${GR[k].cost}`).join(', '));
g('the stock fallbacks (GROUND_STOCK) are ground templates that fit their tier', Object.keys(W.GROUND_STOCK).filter((b) => b !== 'fallback').every((b) => W.GROUND_STOCK[b].every((k) => GR[k] && GR[k].cost <= +b)) && !!GR[W.GROUND_STOCK.fallback]);
g('the running gear carries each Armour design (no overload)', gv.filter((k) => k !== 'technical').every((k) => GR[k].gear && GR[k].gear.overload === 0 && GR[k].gear.kw > 0));
g('test/lib/tanks.js hands the tests the templates\' own rows', (() => { const T = require('./lib/tanks.js'); return ['tk34', 'ms4', 'tygr', 'ma1', 'pumo'].every((k) => JSON.stringify(T[k]) === JSON.stringify(RW(`templateRows(TEMPLATES.${k})`))) && Object.keys(T.all).length === 16; })());
// on the runway, up a 15° plane (made to measure, as ground.test.js's), and on the Highland Ridge pads
RW(`var A0 = siteAngle(EARTH, EARTH.sites.runway.east), eOf = (a) => -(a - A0) * EARTH.radius, PL = null, TORIG = {};
for (const k of ['surfaceAt', 'heightAt', 'waterAt', 'deckAt', 'normalAt']) TORIG[k] = Terrain[k];
var planeH = (a, z) => 50 + eOf(a) * PL.te;
function usePlane(o) {
  for (const k in TORIG) Terrain[k] = TORIG[k];
  if (!o) { PL = null; return; }
  PL = o; Terrain.surfaceAt = (b, a, z) => planeH(a, z); Terrain.heightAt = Terrain.surfaceAt; Terrain.waterAt = () => false; Terrain.deckAt = () => NaN;
  Terrain.normalAt = (b, a, z, o = v3()) => { const R = b.radius, lat = z / R, cl = Math.max(0.05, Math.cos(lat)), sl = Math.sin(lat), ca = Math.cos(a), sa = Math.sin(a), d = 1.5, da = d / (R * cl);
    const se = (planeH(a - da, z) - planeH(a + da, z)) / (2 * d); o.x = cl * ca - se * sa; o.y = cl * sa + se * ca; o.z = sl; return norm3(o); };
}
var veh = (k, place, pitch) => { const ps = partsFromDesign(templateRows(TEMPLATES[k])), adj = buildAdjacency(ps), v = new Vessel(ps, adj, EARTH); v.kind = TEMPLATES[k].kind; v.stages = computeStages(ps, adj, findControlPart(ps).id); v.rebuildGroups(); v.of = ps.length;
  if (place) v.placeOnSurface(EARTH, siteAngle(EARTH, place.e), VEHICLE_KINDS[v.kind].launchRot, place.z, place.yaw || 0); else v.placeOnSurface(EARTH, A0, VEHICLE_KINDS[v.kind].launchRot, 0, 0);
  if (pitch) { v.q = qmul(v.q, qaxis(0, 0, 1, pitch)); let need = -Infinity;
    for (const [q, r] of [...v.wheelPts.map((q) => [q, q.r]), ...v.hull.map((q) => [q, 0])]) { const w = v.toWorld(q.x, q.y, q.z), L = Terrain.locate(EARTH, w.x, w.y, w.z, {}); need = Math.max(need, EARTH.radius + Terrain.surfaceAt(EARTH, L.a, L.z) - (Math.hypot(w.x, w.y, w.z) - r)); }
    const r = v.radius(), f = (r + need + 0.02) / r; v.x *= f; v.y *= f; v.z *= f; }
  return v; };
var world = (v) => ({ time: 0, target: null, toasts: [], broken: [], vessels: [v], active: v, firing: false, destroyed: false, camAbs: { x: 0, y: 0, z: 0 }, toast(m) { this.toasts.push(m); },
  ripParts(v, ps) { this.broken.push('rip'); }, breakParts(v, ps) { this.broken.push('break'); } });
var go = (v, F, secs, ctl) => { for (let i = 0, n = Math.round(secs * 120); i < n; i++) { if (ctl) v.ctl.v = ctl; v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; } };
var fwd = (v) => { const a = v.axis(1, 0, 0); return v.vx * a.x + v.vy * a.y + v.vz * a.z; };
var low = (v) => { let m = Infinity; for (const q of v.hull) { const w = v.toWorld(q.x, q.y, q.z), L = Terrain.locate(EARTH, w.x, w.y, w.z, {}); m = Math.min(m, Math.hypot(w.x, w.y, w.z) - EARTH.radius - Terrain.surfaceAt(EARTH, L.a, L.z)); } return m; };
var up = (v) => { const r = v.radius(), u = v.axis(0, 1, 0); return (u.x * v.x + u.y * v.y + u.z * v.z) / r; };
var drive = {}, hill = {}, pads = {};
for (const k in __G) {
  let v = veh(k), F = world(v); go(v, F, 1); go(v, F, 10, 1); drive[k] = fwd(v) * 3.6;
  if (k !== 'technical') { usePlane({ te: Math.tan(15 * Math.PI / 180) }); v = veh(k, null, 15 * Math.PI / 180); F = world(v); go(v, F, 1); go(v, F, 8, 1); hill[k] = fwd(v); usePlane(null); }
  pads[k] = [];
  for (const team of [0, 1]) for (let slot = 0; slot < 6; slot++) { v = veh(k, GroundMode.placement('highland', team, slot, TEMPLATES[k].kind)); F = world(v); go(v, F, 3);
    pads[k].push({ low: low(v), up: up(v), speed: v.speed(), parts: v.parts.length === v.of, broken: F.broken.length }); }
}`);
const fx = (o, d = 1) => Object.keys(GROUND).map((k) => `${k} ${o[k] == null ? '-' : o[k].toFixed(d)}`).join(', ');
g('every one drives off down the runway: over 10 km/h after 10 s at full throttle', gv.every((k) => W.drive[k] > 10), fx(W.drive));
g('...and climbs a 15° slope (at over 1.5 m/s, 8 s from a standstill on it)', gv.filter((k) => k !== 'technical').every((k) => W.hill[k] > 1.5), fx(W.hill, 2));
g('on Highland Ridge\'s two pads, in all six spawn slots of each: it settles on its running gear, the hull clear of the ground, upright, still, whole',
  RW('EARTH.mapped') && gv.every((k) => W.pads[k].length === 12 && W.pads[k].every((s) => s.low > 0.3 && s.up > 0.999 && s.speed < 0.2 && s.parts && !s.broken)),
  Object.keys(GROUND).map((k) => `${k} ${Math.min(...W.pads[k].map((s) => s.low)).toFixed(2)} m`).join(', '));
// ...and a whole pad at once, bumping each other: each money tier's stock vehicles (GroundMode.stock: three and the
// technical) and the six biggest abreast, on both pads, settle where they were put, well clear of each other
RW(`var lineups = [];
for (const keys of [GroundMode.stock(45000), GroundMode.stock(75000), GroundMode.stock(120000), ['stuq3', 'ma1', 'ok8', 'tk72', 'gepardo', 'leapard1']]) for (const team of [0, 1]) {
  const vs = keys.map((k, slot) => { const v = veh(k, GroundMode.placement('highland', team, slot, TEMPLATES[k].kind)); v.p0 = { x: v.x, y: v.y, z: v.z }; return v; }), F = world(vs[0]);
  F.vessels = vs;
  for (let i = 0; i < 360; i++) { for (const v of vs) v.physicsStep(1 / 120, F); Combat.step(1 / 120, F); F.time += 1 / 120; }
  const aside = (v) => { const dx = v.x - v.p0.x, dy = v.y - v.p0.y, dz = v.z - v.p0.z, u = (dx * v.x + dy * v.y + dz * v.z) / v.radius(); return Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - u * u)); };
  let gap = Infinity; // (between the spheres round their body boxes, as Gear.bump's first test)
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) gap = Math.min(gap, Math.hypot(vs[i].x - vs[j].x, vs[i].y - vs[j].y, vs[i].z - vs[j].z) - gearBoxR(vs[i]) - gearBoxR(vs[j]));
  lineups.push({ keys: keys.join('+'), team, gap, aside: Math.max(...vs.map(aside)), ok: !F.broken.length && vs.every((v) => low(v) > 0.3 && up(v) > 0.999 && v.speed() < 0.2 && v.parts.length === v.of) });
}`);
g('a whole pad at once: each money tier\'s stock vehicles, and the six biggest abreast, settle where they were put, well clear of each other',
  W.lineups.length === 8 && W.lineups.every((l) => l.ok && l.gap > 5 && l.aside < 0.2), W.lineups.map((l) => `${l.keys} t${l.team}: ${l.gap.toFixed(1)} m apart, ${l.aside.toFixed(2)} m aside${l.ok ? '' : ' NOT SETTLED'}`).join('; '));
g.done();
