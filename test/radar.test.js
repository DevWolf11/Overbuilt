// Aircraft radar as parts (the big update). No magic radar: cockpits, noses, the Radome and the Drone Core lost their
// hidden radar number, and nine radar parts took its place (five sets that go inside a nose, cockpit or fuselage, a tail
// warning set, a radar pod, a mast radar and the Rotodome), plus active radar missiles. Here: the catalogue (A), the pure
// geometry that puts a set inside its host and joins it there, and the builder's pure radar functions (B). Every figure
// is worked independently (by hand, from the spec's tables, or from the placement probe the spec was written from),
// never from the code's own output.
//   node test/radar.test.js
const fs = require('fs'), path = require('path');
const G = require('./lib/game.js');
const ctx = G.load({ combat: true, props: true }), R = (c) => G.run(ctx, c);
const t = G.checks('radar: the radar parts, sets inside noses, joins and the builder\'s radar rules');
const { PARTS } = ctx;
const near = (a, b, e) => Math.abs(a - b) <= e;

// ---------------------------------------------------------------- A. the catalogue
const NEW = ['radarRanging', 'radarPulse', 'radarPD', 'radarPESA', 'radarAESA', 'radarTail', 'radarPod', 'radarMast', 'radarMissilesA'];
const INNER = NEW.slice(0, 6), OUTSIDE = ['radarPod', 'radarMast', 'rotodome'];
// [name, tier, cost, mass t, w, h, hp (null: the formula)], then radarSet [kind, range, cone, scan, down, notch, lock, guide, tws, eccm, lpi, warn, ground]
const SPEC = {
  radarRanging: ['Ranging Radar', 1, 1000, 0.005, 0.40, 0.35, 120], radarPulse: ['Pulse Radar', 2, 2500, 0.01, 0.60, 0.50, 160],
  radarPD: ['Pulse-Doppler Radar', 3, 3500, 0.01, 0.70, 0.55, 180], radarPESA: ['PESA Radar', 4, 6500, 0.01, 0.90, 0.55, 200],
  radarAESA: ['AESA Radar', 4, 9000, 0.01, 0.80, 0.45, 200], radarTail: ['Tail Warning Radar', 2, 1200, 0.005, 0.32, 0.30, 100],
  radarPod: ['Radar Pod', 3, 4000, 0.16, 0.55, 2.4, null], radarMast: ['Mast Radar', 3, 6000, 0.12, 0.90, 0.95, null],
  radarMissilesA: ['Active Radar Missiles', 4, 19000, 0.05, 0.45, 3.7, null],
};
const SETS = {
  radarRanging: ['RNG', 8000, 20, 0.6, false, 0, 0, 0, 0, 0, 0, false, 0], radarPulse: ['PULSE', 14000, 45, 2.4, false, 0, 1.8, 1, 1, 0, 0, false, 0],
  radarPD: ['PD', 18000, 60, 2.0, true, 40, 1.4, 2, 2, 0, 0, false, 0], radarPESA: ['PESA', 24000, 60, 1.2, true, 25, 1.0, 2, 4, 0.5, 0, false, 0],
  radarAESA: ['AESA', 26000, 70, 0.8, true, 15, 0.7, 2, 6, 0.7, 0.6, false, 0], radarTail: ['TAIL', 4000, 60, 1.0, true, 0, 0, 0, 0, 0, 0, true, 0],
  radarPod: ['POD', 12000, 45, 2.0, true, 40, 1.6, 1, 1, 0, 0, false, 0], radarMast: ['MAST', 9000, 180, 1.5, true, 10, 1.0, 2, 2, 0.3, 0, false, 8000],
  rotodome: ['AEW', 45000, 180, 4.8, true, 30, 2.0, 2, 4, 0.5, 0, false, 0],
};
const FIELDS = ['kind', 'range', 'cone', 'scan', 'down', 'notch', 'lock', 'guide', 'tws', 'eccm', 'lpi', 'warn', 'ground'];
const badA1 = [];
for (const k of NEW) {
  const d = PARTS[k], [name, tier, cost, mass, w, h, hp] = SPEC[k] || [];
  if (!d || d.name !== name || d.tier !== tier || d.cost !== cost || d.mass !== mass || d.w !== w || d.h !== h || (hp != null && d.hp !== hp) || d.gv) badA1.push(k);
}
for (const k in SETS) {
  const S = PARTS[k] && PARTS[k].radarSet;
  if (!S || !Object.isFrozen(S) || Object.keys(S).sort().join() !== [...FIELDS].sort().join() || FIELDS.some((f, i) => S[f] !== SETS[k][i])) badA1.push(k + '.radarSet');
}
t('A1 the nine new parts with the spec\'s numbers, each radar\'s radarSet complete (13 fields) and frozen', !badA1.length, badA1);
t('...the five sets and the tail set: inner, flush, as deep as wide, not armour, own hit points, at most 10 kg, in the Radar tab\'s "Inside a nose"', INNER.every((k) => { const d = PARTS[k];
  return d.inner && d.flush && d.depth === d.w && !d.gv && d.hp > 0 && d.mass <= 0.01 && d.cat === 'radar' && d.tray === 'Inside a nose' && d.shape === 'radarset' && d.maxTemp === 2400 && R(`innerRadar(PARTS.${k})`); }));
t('...the pod, the mast and the Rotodome: radar parts outside ("Outside"), not inner; the pod a store with a radar style and no jammer', OUTSIDE.every((k) => PARTS[k].cat === 'radar' && PARTS[k].tray === 'Outside' && !PARTS[k].inner && !R(`innerRadar(PARTS.${k})`))
  && PARTS.radarPod.shape === 'ecm' && PARTS.radarPod.style === 'radar' && PARTS.radarPod.pod && PARTS.radarPod.aero && !('ecm' in PARTS.radarPod) && PARTS.radarMast.shape === 'mastdome');
t('...hit points by the formula for the pod (60 + 220·√0.16 = 148) and the mast (60 + 220·√0.12 = 136)', R('Combat.maxHp(PARTS.radarPod)') === 148 && R('Combat.maxHp(PARTS.radarMast)') === 136, [R('Combat.maxHp(PARTS.radarPod)'), R('Combat.maxHp(PARTS.radarMast)')]);
{
  const a = PARTS.radarMissilesA, b = PARTS.radarMissiles, wa = { ...a.weapon }, wb = { ...b.weapon };
  delete wa.active; delete wa.label;
  t('...Active Radar Missiles: the radar missiles\' numbers plus active 6 km and the ARH label, a pair on pylons in the Weapons tab', JSON.stringify(wa) === JSON.stringify(wb) && a.weapon.active === 6000 && a.weapon.label === 'ARH'
    && a.cat === 'weapons' && a.shape === 'missile' && a.style === 'arh' && a.twinZ === 2.4 && a.pod && a.aero && !a.radarSet);
}
const cats = R('PART_CATEGORIES.map((c) => c.id)');
t('...the categories end in Radar, and so do the plane\'s and the helicopter\'s tabs (other kinds reach it through More)', cats[cats.length - 1] === 'radar' && R(`PART_CATEGORIES[PART_CATEGORIES.length - 1].name`) === 'Radar'
  && R(`VEHICLE_KINDS.plane.cats.join()`) === 'cabins,air,wings,airEng,airGear,weapons,radar' && R(`VEHICLE_KINDS.heli.cats[VEHICLE_KINDS.heli.cats.length - 1]`) === 'radar'
  && R(`['rocket', 'car', 'tank'].every((k) => !VEHICLE_KINDS[k].cats.includes('radar'))`));

// A2: no magic radar left
const NOSES = { cockpitJet: 'radarPD', cockpitStealth: 'radarPD', us4f16Nose: 'radarPD', ruNose29: 'radarPD', us4f15Nose: 'radarPD', ruNose27: 'radarPD', radome: 'radarPD',
  cockpitTandem: 'radarPulse', ruNose21: 'radarPulse', us4f4Nose: 'radarPulse', ruNose35: 'radarPESA', us5Nose22: 'radarAESA', us5Nose35: 'radarAESA', ruNose57: 'radarAESA' };
const OLD = Object.keys(PARTS).filter((k) => !NEW.includes(k));
t('A2 no part has a number for radar (the hidden radars of cockpits, noses, the Radome and the Drone Core are gone)', !Object.keys(PARTS).some((k) => typeof PARTS[k].radar === 'number'),
  Object.keys(PARTS).filter((k) => 'radar' in PARTS[k]));
t('...the Radome is a housing, not a radar; among the old parts only the Rotodome has a radarSet', !PARTS.radome.radarSet && OLD.filter((k) => PARTS[k].radarSet).join() === 'rotodome');
t('...each nose that lost its radar names the set Fit a radar puts back (radarFit), a set that guides radar missiles', Object.keys(NOSES).every((k) => PARTS[k].radarFit === NOSES[k] && PARTS[NOSES[k]].radarSet.guide >= 1)
  && Object.keys(PARTS).filter((k) => PARTS[k].radarFit).sort().join() === Object.keys(NOSES).sort().join());
t('...the three internal radar-missile bays and the new pair go active at 6 km; the old radar missiles don\'t', ['us5Bay22', 'us5Bay35', 'ruBay57', 'radarMissilesA'].every((k) => PARTS[k].weapon.active === 6000)
  && !('active' in PARTS.radarMissiles.weapon) && Object.keys(PARTS).filter((k) => PARTS[k].weapon && PARTS[k].weapon.active).length === 4);
t('...nothing else about the old parts moved: keys, sizes, masses and shapes of the noses, the Radome, the Rotodome and the Drone Core as before; the FS-15 nose renamed',
  PARTS.cockpitJet.w === 1.6 && PARTS.cockpitJet.h === 4.2 && PARTS.cockpitJet.mass === 0.8 && PARTS.radome.cost === 600 && PARTS.radome.cat === 'air' && PARTS.radome.mass === 0.1
  && PARTS.rotodome.w === 1.7 && PARTS.rotodome.h === 5 && PARTS.rotodome.mass === 0.9 && PARTS.rotodome.cost === 12000 && PARTS.rotodome.shape === 'rotodome'
  && PARTS.droneCore.mass === 0.15 && PARTS.droneCore.control === 2 && PARTS.us4f15Nose.name === 'FS-15 Nose' && PARTS.us4f15Nose.shape === 'us4body');

// A3: no real designations
const REAL = /\b(apg|an\/|irbis|zhuk|captor|sapfir|longbow|hawkeye|sentry|phazotron|awacs|amraam|sparrow|aim-\d+|r-\d+|n0\d\d)\b/i;
const texts = Object.keys(PARTS).map((k) => [k, PARTS[k].name + ' | ' + PARTS[k].desc]).concat(Object.entries(ctx.TEMPLATES).map(([k, T]) => ['template ' + k, T.name + ' | ' + (T.blurb || '')]));
t('A3 no real radar or missile designation in any part\'s name or description or any template\'s blurb', !texts.some(([, s]) => REAL.test(s)), texts.filter(([, s]) => REAL.test(s)).map((e) => e[0]));
t('...the noses that lost their radar say so ("Room inside for a radar set"), and none still promises one', Object.keys(NOSES).filter((k) => k !== 'radome').every((k) => PARTS[k].desc.endsWith(' Room inside for a radar set (Radar tab).'))
  && PARTS.radome.desc.includes('the most room of any nose for a radar set') && !OLD.some((k) => /a (long|powerful|bigger, longer-reaching) radar|nose radar|with its radar/.test(PARTS[k].desc)));

// A4: the tiers
const FWD = ['radarRanging', 'radarPulse', 'radarPD', 'radarPESA', 'radarAESA'].map((k) => PARTS[k]);
const inc = (a) => a.every((x, i) => !i || x > a[i - 1]), dec = (a) => a.every((x, i) => !i || x < a[i - 1]), nondec = (a) => a.every((x, i) => !i || x >= a[i - 1]);
t('A4 the inner forward sets get better with their tier: range up, lock time down (those that lock), targets at once up', nondec(FWD.map((d) => d.tier)) && inc(FWD.map((d) => d.radarSet.range))
  && dec(FWD.slice(1).map((d) => d.radarSet.lock)) && nondec(FWD.map((d) => d.radarSet.tws)) && nondec(FWD.map((d) => d.cost)));
t('...the pulse-Doppler set is the radar every fighter had before: ±60°, a 1.4 s lock, no help against a jammer, notched under 40 m/s', ((S) => S.cone === 60 && S.lock === 1.4 && S.eccm === 0 && S.notch === 40 && S.down && S.lpi === 0)(PARTS.radarPD.radarSet));

// ---------------------------------------------------------------- B. geometry and the builder's pure functions
// The twelve stock jets' sets as the spec's placement probe found them (the set's centre, front-most in its nose, clear of
// any flush part; scratchpad radeng2/place2.js, a separate implementation sampling the outline exactly): [template,
// nose's row, set, x, y]. This checkout's spot must be within 3 cm (stations 2 cm apart, rows rounded to 1 cm).
const JETS = [['falcon', 3, 'radarPD', 0, 12.8], ['kestrel', 3, 'radarPulse', 0, 15.37], ['myg21', 0, 'radarRanging', 0, 13.98], ['fs4', 2, 'radarPulse', -0.02, 17.95],
  ['fs16', 2, 'radarPD', -0.08, 13.35], ['myg29', 0, 'radarPD', -0.01, 15.33], ['fs15', 2, 'radarPD', -0.05, 18], ['sugoi27', 0, 'radarPD', -0.05, 20.37],
  ['sugoi35', 0, 'radarPESA', -0.05, 20.14], ['fs22', 0, 'radarAESA', 0.06, 16.96], ['fs35', 0, 'radarAESA', 0.09, 14.38], ['sugoi57', 0, 'radarAESA', -0.07, 17.96]];
ctx.__JETS = JETS;
// a template's builder rows without any radar set it may carry now (so these checks hold before and after the jets get theirs)
R(`var __rowsOf = (k) => templateRows(TEMPLATES[k]).filter((r) => !innerRadar(PARTS[r.type]));
   var __PL = PILOT.plane.F, __back = { x: -PILOT.plane.F.x, y: -PILOT.plane.F.y };`);
const spots = R(`__JETS.map(([k, ni, set, x, y]) => {
  const ps = partsFromDesign(__rowsOf(k)), H = ps[ni], s = insideSpot(set, 0, H, null, ps, __PL);
  return s && { k, nose: H.type, x: s.x, y: s.y, z: s.z, rot: s.rot, inside: insideOf(s, H), free: !ps.some((o) => o !== H && partsClash(s, o)), ex: x, ey: y };
})`);
const off = spots.filter((s, i) => !s || !near(s.x, JETS[i][3], 0.03) || !near(s.y, JETS[i][4], 0.03) || !s.inside || !s.free || s.rot !== 0 || s.z !== R(`partZ(partsFromDesign(__rowsOf('${JETS[i][0]}'))[${JETS[i][1]}])`));
t('B7 insideSpot: each era set in each stock jet\'s nose at the probe\'s spot (within 3 cm), inside 4 cm clear, at the nose\'s depth, clashing with nothing', !off.length,
  off.length ? off : spots.map((s) => `${s.k} ${s.x},${s.y}`).join(' '));
t('...the FS-4\'s pulse set sits clear of its chin gun, though a set and the gun (both flush) clash 10 cm nearer it', R(`(() => {
  const ps = partsFromDesign(__rowsOf('fs4')), gun = ps.find((p) => p.type === 'us4f4Gun'), s = insideSpot('radarPulse', 0, ps[2], null, ps, __PL);
  return !partsClash(s, gun) && partsClash({ ...s, x: s.x + 0.1 }, gun); })()`));
t('...none inside the Tail Boom (0.7 m wide) for a pulse-Doppler set (0.7 m); the Bush Cockpit (1.5 m) takes one low in its body', R(`(() => {
  const boom = makePart('tailBoom', 0, 0), bush = makePart('cockpitS', 0, 0), s = insideSpot('radarPD', 0, bush, null, [], __PL);
  return insideSpot('radarPD', 0, boom, null, [], __PL) === null && !!s && insideOf(s, bush) && s.y < 1 - 0.275; })()`));
t('...a tail set at rot 2 lands at the very back of a tail cone (its back end 15 cm behind its centre)', R(`(() => {
  const tc = makePart('tailcone', 0, -5), s = insideSpot('radarTail', 2, tc, null, [], __back);
  return !!s && s.rot === 2 && Math.abs(s.y - (-5 - 1.25 + 0.15)) < 0.005 && insideOf(s, tc); })()`));
t('...a helicopter\'s fuselage turned a quarter (rot 3, nose +x) takes a set at rot 3 in its front 30 cm', R(`(() => {
  const H = makePart('fuselage', 0, 0, { rot: 3 }), s = insideSpot('radarPD', 3, H, null, [], PILOT.heli.F);
  return !!s && s.rot === 3 && s.x > 2 - 0.275 - 0.3 && Math.abs(s.y) < 0.01 && insideOf(s, H); })()`));
t('...the Radome (a 2 × 2.2 m cone) takes the biggest set, a PESA', R(`(() => { const H = makePart('radome', 0, 0), s = insideSpot('radarPESA', 0, H, null, [], __PL); return !!s && insideOf(s, H); })()`));
t('...a set at the tip of the Tandem Cockpit, inside its box (which the clash test uses) but not its outline, is not inside', R(`(() => {
  const H = makePart('cockpitTandem', 0, 0), q = { def: PARTS.radarPD, type: 'radarPD', x: 0, y: 2.6 - 0.275 - 0.02, z: 0, rot: 0, flip: false };
  return clashShape(PARTS.cockpitTandem, false).box && !insideOf(q, H) && !insideOf(q, H, -0.02) && insideSpot('radarPD', 0, H, null, [], __PL).y < q.y - 0.5; })()`));
t('...a drag (want) takes the accepted station nearest the pointer along the nose, none more than 1 m from it', R(`(() => {
  const ps = partsFromDesign(__rowsOf('falcon')), H = ps[3], a = insideSpot('radarPD', 0, H, { x: H.x, y: H.y }, ps, __PL), far = insideSpot('radarPD', 0, H, { x: H.x, y: H.y + 40 }, ps, __PL);
  return !!a && Math.abs(a.y - H.y) <= 0.011 && far === null; })()`));
t('...partLocal undoes partPt for every turn, and a radar host is a body (never a wing, pair, engine, store, armour or another radar)', R(`(() => {
  for (let r = 0; r < 4; r++) { const H = { x: 1.5, y: -2, rot: r }, q = partPt(H, 0.3, -0.7), L = partLocal(H, q.x, q.y); if (Math.abs(L.x - 0.3) > 1e-9 || Math.abs(L.y + 0.7) > 1e-9) return false; }
  return ['cockpitJet', 'fuselage', 'radome', 'cockpitHeli', 'tailcone', 'us5Nose22', 'ruNose27', 'us4f16Nose'].every((k) => radarHost(PARTS[k]))
    && !['wing', 'vtailTwin', 'jetF', 'radarMissiles', 'dropTanks', 'radarPD', 'radarPod', 'rotodome', 'gearR', 'chute'].some((k) => PARTS[k] && radarHost(PARTS[k])); })()`));

// B8: the legacy path (template rows as fingerprint.js builds them: makePart, no att) and partsFromDesign
const legacy = R(`__JETS.map(([k, ni, set, x, y]) => {
  const rows = TEMPLATES[k].parts.filter((r) => !innerRadar(PARTS[r[0]])).concat([[set, x, y, 0]]);
  const ps = rows.map(([type, x, y, rot, o]) => makePart(type, x, y, Object.assign({ flip: x < 0, rot: rot || 0 }, o && o.z != null ? { z: o.z } : {})));
  const adj = buildAdjacency(ps), s = ps[ps.length - 1], ctl = findControlPart(ps), e = [...adj.get(s.id)];
  return componentOf(ctl.id, adj).has(s.id) && e.length === 1 && e[0] === ps[ni].id;
})`);
t('B8 legacy rows (no att): every jet\'s set joins the tree, by exactly one edge, to its nose', legacy.every(Boolean), legacy);
const KEYS = Object.keys(ctx.TEMPLATES);
ctx.__KEYS = KEYS;
// the joins as they were before radar sets (an independent copy of the old pair and att loops)
R(`var __oldAdj = (parts) => { const adj = new Map(), byId = new Map(); for (const p of parts) { adj.set(p.id, new Set()); byId.set(p.id, p); }
  const link = (a, b) => { adj.get(a.id).add(b.id); adj.get(b.id).add(a.id); };
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) { const a = parts[i], b = parts[j]; if (partsTouch(a, b) || partsMounted(a, b) || pylonLink(a, b)) link(a, b); }
  for (const p of parts) if (p.att != null && p.att !== p.id && byId.has(p.att)) link(p, byId.get(p.att));
  return adj; };
  var __same = (A, B) => A.size === B.size && [...A].every(([k, s]) => B.has(k) && s.size === B.get(k).size && [...s].every((x) => B.get(k).has(x)));`);
const same = R(`__KEYS.filter((k) => !TEMPLATES[k].parts.some((r) => innerRadar(PARTS[r[0]]))).map((k) => {
  const T = TEMPLATES[k], legacy = T.parts.map(([type, x, y, rot, o]) => makePart(type, x, y, Object.assign({ flip: x < 0, rot: rot || 0 }, o && o.z != null ? { z: o.z } : {}))), ps = partsFromDesign(templateRows(T));
  return [k, __same(buildAdjacency(legacy), __oldAdj(legacy)) && __same(buildAdjacency(ps), __oldAdj(ps))];
}).concat([['RAIDER', ((ps) => __same(buildAdjacency(ps), __oldAdj(ps)))(RAIDER.map(([type, x, y, rot]) => makePart(type, x, y, { flip: x < 0, rot: rot || 0 })))]])`);
t(`...for the ${same.length - 1} templates without a set and RAIDER, buildAdjacency is the old one (legacy rows and designs)`, same.length >= 40 && same.every((e) => e[1]), same.filter((e) => !e[1]).map((e) => e[0]));
t('...partsFromDesign gives a set without att its host\'s id (and keeps an att it has)', R(`(() => {
  const rows = __rowsOf('falcon'), n = rows.length, a = partsFromDesign(rows.concat([{ type: 'radarPD', x: 0, y: 12.8, rot: 0, flip: false }])), b = partsFromDesign(rows.concat([{ type: 'radarPD', x: 0, y: 12.8, rot: 0, flip: false, att: 4 }]));
  return a[n].att === a[3].id && b[n].att === b[4].id; })()`));
t('...a set no body holds stays loose (no att, no joins), and a forged loop (the nose hung on the set) is not closed', R(`(() => {
  const rows = __rowsOf('falcon'), n = rows.length, lone = partsFromDesign(rows.concat([{ type: 'radarPD', x: 30, y: 12.8, rot: 0, flip: false }]));
  const loop = rows.map((r, i) => (i === 3 ? { ...r, att: n } : r)).concat([{ type: 'radarPD', x: 0, y: 12.8, rot: 0, flip: false }]), L = partsFromDesign(loop);
  return lone[n].att === null && buildAdjacency(lone).get(lone[n].id).size === 0 && L[3].att === L[n].id && L[n].att === null && cleanAtt(L.slice()).every((p) => p.att !== p.id); })()`));

// B9: which way a part comes in (the builder's defaultRot, run from its source)
const bsrc = fs.readFileSync(path.join(G.ROOT, 'js', 'builder.js'), 'utf8').match(/\n {2}defaultRot\(def, kind = this\.kind\) \{[\s\S]*?\n {2}\},?\n/);
R(`var __B = { kind: 'plane', ${bsrc[0].trim().replace(/,$/, '')} };`);
const rots = R(`['plane', 'rocket', 'heli', 'car', 'tank'].map((k) => [k, __B.defaultRot(PARTS.radarPD, k), __B.defaultRot(PARTS.radarTail, k), __B.defaultRot(PARTS.radarPod, k), __B.defaultRot(PARTS.radarMast, k), __B.defaultRot(PARTS.rotodome, k)].join())`);
t('B9 defaultRot: a set faces the nose (plane and rocket 0, helicopter, car and Armour 3), a tail set the other way (+2); all-round radars as any part (0)',
  rots.join(' ') === 'plane,0,2,0,0,0 rocket,0,2,0,0,0 heli,3,1,3,0,0 car,3,1,3,0,0 tank,3,1,3,0,0', rots);
t('...every old part comes in as before (an aimed part on a ground vehicle at 3, anything else 0)', R(`Object.keys(PARTS).filter((k) => !PARTS[k].radarSet).every((k) => ['plane', 'rocket', 'heli', 'car', 'tank'].every((K) => __B.defaultRot(PARTS[k], K) === (PARTS[k].aim && isGround(K) ? 3 : 0)))`));

// B5 (the pure half): the stats row, the part card and the warnings, on the Falcon's rows
R(`var __fal = (extra, drop) => { const rows = __rowsOf('falcon').filter((r) => !(drop && drop(r))); return partsFromDesign(rows.concat(extra || [])); };
   var __set = (type, x, y) => ({ type, x, y, rot: 0, flip: x < 0, att: 3 });`);
const probs = R(`[__fal(), __fal([__set('radarRanging', 0, 12.8)]), __fal([__set('radarPD', 2, 12.8)]), __fal([__set('radarPulse', 0, 12.8), { type: 'radarMissilesA', x: 1.2, y: 8, rot: 0, flip: false }]),
  __fal([__set('radarPD', 0, 12.8), { type: 'radarPod', x: 1.2, y: 9, rot: 0, flip: false }]), __fal([__set('radarPD', 0, 12.8)]), __fal([__set('radarTail', 0, 12.8)], (r) => r.type === 'radarMissiles')].map(radarProblems)`);
t('B5 radarProblems: the Falcon without a set needs a radar; with a Ranging set it can\'t guide; a set 2 m out isn\'t inside; active missiles on a Pulse set ride it; a PD and a pod look forward twice; a PD inside: none',
  probs[0].join('|') === 'Radar-guided missiles need a radar to lock on: fit one inside the nose.'
  && probs[1].join('|') === 'The Ranging Radar can\'t guide radar missiles: fit a Pulse radar or better.'
  && probs[2].join('|') === 'The Pulse-Doppler Radar isn\'t inside a nose or fuselage: drag it into one.'
  && probs[3].join('|') === 'With a Pulse Radar the active radar missiles ride it all the way: a pulse-Doppler or better lets them go on alone.'
  && probs[4].join('|') === 'Two radars look forward: only the best one locks.' && probs[5].length === 0 && probs[6].length === 0, probs);
const sum = R(`[radarSummary(__fal([__set('radarPD', 0, 12.8)])), radarSummary(__fal([__set('radarTail', 0, 12.8)], (r) => r.type === 'radarMissiles')), radarSummary(partsFromDesign(templateRows(TEMPLATES.skylark)))].map((s) => JSON.stringify(s))`);
t('...radarSummary: the best radar\'s kind, range and cone, a tail set, radar missiles, active ones, a guiding radar; nothing for an old light plane', sum[0] === JSON.stringify({ best: { name: 'Pulse-Doppler Radar', kind: 'PD', range: 18000, cone: 60 }, tail: false, missiles: true, arh: false, guiding: true })
  && sum[1] === JSON.stringify({ best: null, tail: true, missiles: false, arh: false, guiding: false }) && sum[2] === JSON.stringify({ best: null, tail: false, missiles: false, arh: false, guiding: false }), sum);
t('...a broken set or one at 0 hp doesn\'t count; one at full health (hp null) does', R(`(() => { const ps = __fal([__set('radarPD', 0, 12.8)]), s = ps[ps.length - 1]; const a = radarSummary(ps).guiding; s.hp = null; const b = radarSummary(ps).guiding; s.hp = 0; const c = radarSummary(ps).guiding; s.hp = 50; s.broken = true; return a && b && !c && !radarSummary(ps).guiding; })()`));
const specs = R(`[radarSpecs(PARTS.radarAESA.radarSet), radarSpecs(PARTS.radarTail.radarSet), radarSpecs(PARTS.radarRanging.radarSet), radarSpecs(PARTS.radarMast.radarSet)]`);
t('...radarSpecs: the part card\'s lines, worked by hand (26 km × 0.32 = 8.3 km against a stealth jet; a 0.7 s lock × 1.3 = 0.9 s on a jammer; heard within 26 × 0.4 = 10.4 km)',
  specs[0].join('|') === '26 km ahead, ±70° (8.3 km against a stealth jet)|looks down (a low target crossing slower than 15 m/s hides)|locks in 0.7 s (0.9 s on a jammer)|guides radar missiles at 6 targets; active ones go on alone|hard to jam|warning receivers hear it only within 10.4 km'
  && specs[1].join('|') === '4 km behind (1.3 km against a stealth jet)|looks down|warns of an enemy behind (3 km)'
  && specs[2].join('|') === '8 km ahead, ±20° (2.6 km against a stealth jet)|blind to targets below it|guns: leads to 3 km, cues heat seekers'
  && specs[3].join('|') === '9 km all round (2.9 km against a stealth jet)|looks down (a low target crossing slower than 10 m/s hides)|locks in 1 s (1.7 s on a jammer)|guides radar missiles at 2 targets; active ones go on alone|marks vehicles on the ground (8 km)|resists jamming', specs);

t.done();
