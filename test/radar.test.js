// Aircraft radar as parts (the big update). No magic radar: cockpits, noses, the Radome and the Drone Core lost their
// hidden radar number, and nine radar parts took its place (five sets that go inside a nose, cockpit or fuselage, a tail
// warning set, a radar pod, a mast radar and the Rotodome), plus active radar missiles. Here: the catalogue (A), the pure
// geometry that puts a set inside its host and joins it there, and the builder's pure radar functions (B); then radar.js:
// what each radar sees (D), locks, the pick and guidance through Combat.frame (E), eyes, the tail warning, the solo locks
// on us and LPI (G), the AI and the range controller's call (H). Every figure is worked independently (by hand, from the
// spec's tables, or from the placement probe the spec was written from), never from the code's own output.
//   node test/radar.test.js
const fs = require('fs'), path = require('path');
const G = require('./lib/game.js');
const ctx = G.load({ combat: true, props: true }), R = (c) => G.run(ctx, c);
const t = G.checks('radar: the radar parts, sets inside noses, joins, the builder\'s radar rules, what radars see, locks and guidance');
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

// ---------------------------------------------------------------- B5-B6. the stock jets carry their sets
const probsAll = R(`Object.keys(TEMPLATES).map((k) => [k, radarProblems(partsFromDesign(templateRows(TEMPLATES[k])))]).filter((e) => e[1].length)`);
t('B5 radarProblems: no warning for any stock template (each jet with radar missiles has a set that guides them, inside its nose)', !probsAll.length, probsAll);
const own = R(`__JETS.map(([k, ni, set, x, y]) => {
  const rows = templateRows(TEMPLATES[k]), ps = partsFromDesign(rows), sets = ps.filter((p) => innerRadar(p.def)), s = sets[0], H = ps[ni];
  const adj = buildAdjacency(ps), ctl = findControlPart(ps);
  const tap = insideSpot(set, 0, H, null, ps.filter((p) => p !== s), __PL); // (where a tap in the builder puts it)
  return { k, n: sets.length, type: s && s.type, last: s === ps[ps.length - 1], host: !!s && s.att === H.id, inside: !!s && insideOf(s, H), free: !!s && !ps.some((o) => o !== s && o !== H && partsClash(s, o)),
    joined: !!s && componentOf(ctl.id, adj).has(s.id), dx: s ? Math.abs(s.x - x) : 9, dy: s ? Math.abs(s.y - y) : 9, z: !!s && partZ(s) === partZ(H), rot: s && s.rot, tap: !!s && !!tap && Math.hypot(tap.x - s.x, tap.y - s.y) <= 0.01 };
})`);
const badB6 = own.filter((o, i) => o.n !== 1 || o.type !== JETS[i][2] || !o.last || !o.host || !o.inside || !o.free || !o.joined || o.dx > 0.03 || o.dy > 0.03 || !o.z || o.rot !== 0 || !o.tap);
t('B6 each of the twelve radar jets carries one set, its era\'s, as its last row: hosted by its nose (att), inside it 4 cm clear, clashing with nothing, joined to the tree, within 1 cm of where a tap in the builder puts it (three nudged a few mm so the gun fingerprint\'s last digit holds), within 3 cm of the probe\'s spot', !badB6.length, badB6);
t('...the other templates carry no radar part (Spectre, Striker, Hornet, Viper, the bomber, warbirds, airliners, helicopters, cars, rockets, Armour), and RAIDER none either',
  R(`Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].parts.some((r) => PARTS[r[0]].radarSet)).sort().join()`) === JETS.map((j) => j[0]).sort().join() && R(`RAIDER.length === 11 && !RAIDER.some((r) => PARTS[r[0]].radarSet)`));
t('...every set\'s tier is at most its template\'s, and each template blurb that names its radar names the right one (Sugoi-35: PESA; Spectre: none)', R(`__JETS.every(([k, , set]) => PARTS[set].tier <= TEMPLATES[k].tier)`)
  && /a PESA radar/.test(ctx.TEMPLATES.sugoi35.blurb) && !/bigger radar/.test(ctx.TEMPLATES.sugoi35.blurb) && /No radar: it stays silent\.$/.test(ctx.TEMPLATES.spectre.blurb));
// prices: each nose dropped by its set, so every radar jet costs what it did (worked by hand from the spec's table, §9.2)
const COST = { falcon: 73400, kestrel: 69900, myg21: 45000, fs4: 97900, fs16: 75000, myg29: 91800, fs15: 113600, sugoi27: 113300, sugoi35: 119500, fs22: 120000, fs35: 101300, sugoi57: 119800,
  striker: 39900, hornet: 26400, viper: 34700, spectre: 59200 };
const costs = R(`Object.fromEntries(${JSON.stringify(Object.keys(COST))}.map((k) => [k, TEMPLATES[k].parts.reduce((s, r) => s + PARTS[r[0]].cost, 0)]))`);
t('...the template totals: the twelve radar jets as before (the MyG-21 and FS-16 at their caps, the FS-22 at $120k), Striker, Hornet, Viper and Spectre $3,500 cheaper (their nose, no set)',
  Object.keys(COST).every((k) => costs[k] === COST[k]), costs);
const NOSE$ = { cockpitJet: 3500, cockpitTandem: 5500, cockpitStealth: 10500, ruNose21: 5900, us4f4Nose: 3500, us4f16Nose: 1300, ruNose29: 4000, us4f15Nose: 4500, ruNose27: 5000,
  ruNose35: 2000, us5Nose22: 2700, us5Nose35: 6000, ruNose57: 2200, radome: 600, droneCore: 3000, rotodome: 12000 };
t('...the noses\' new prices (each the old one less its set\'s; the Radome, Drone Core and Rotodome unchanged)', Object.keys(NOSE$).every((k) => PARTS[k].cost === NOSE$[k]), Object.keys(NOSE$).filter((k) => PARTS[k].cost !== NOSE$[k]));

// ---------------------------------------------------------------- C. physics gates (vessel.js, combat.js stealthOf)
ctx.__G = G;
const twin = R(`__JETS.map(([k]) => {
  const all = templateRows(TEMPLATES[k]), wo = all.filter((r) => !innerRadar(PARTS[r.type])), set = all.find((r) => innerRadar(PARTS[r.type]));
  const mk = (rows) => { const ps = partsFromDesign(rows), adj = buildAdjacency(ps), v = new Vessel(ps, adj, EARTH); v.kind = 'plane'; v.rebuildGroups(); return v; };
  const a = mk(all), b = mk(wo), hull = (v) => JSON.stringify(v.hull.map((h) => [h.p.type, h.x, h.y, h.z]));
  return { k, area: ['x', 'y', 'z'].every((c) => a.area[c] === b.area[c]), hull: hull(a) === hull(b), wheels: JSON.stringify(a.wheelPts.map((w) => [w.x, w.y, w.z, w.r])) === JSON.stringify(b.wheelPts.map((w) => [w.x, w.y, w.z, w.r])),
    nose: a.noseAero === b.noseAero && a.noseSharp === b.noseSharp && a.noseAero, dims: a.depth === b.depth && a.width === b.width, reach: Math.abs(a.reach - b.reach),
    mass: Math.abs(a.mass - b.mass - PARTS[set.type].mass * 1000), st: [Combat.stealthOf(a), Combat.stealthOf(b)], com: a.com.y - b.com.y };
})`);
const badC = twin.filter((o) => !o.area || !o.hull || !o.wheels || !o.nose || !o.dims || o.mass > 1e-6 || o.st[0] !== o.st[1] || o.reach > 0.01 || !(o.com > 0 && o.com < 0.03));
t('C10 each radar jet with and without its set: the same areas (x, y, z), hull and wheel points, nose (aero, sharp), depth and width; heavier by exactly the set; its centre of mass 0-3 cm forward (so its reach within 1 cm); the same stealth', !badC.length,
  badC.length ? badC : twin.map((o) => `${o.k} com +${(o.com * 100).toFixed(1)} cm, reach ${(o.reach * 1000).toFixed(1)} mm`).join('; '));
const st = Object.fromEntries(twin.map((o) => [o.k, +o.st[0].toFixed(4)]));
const spectre = +ctx.Combat.stealthOf(G.craft(ctx, G.templateRows(ctx, 'spectre'), 'plane', 'air')).toFixed(4);
t('...stealth as before the sets (FS-22 0.6814, FS-35 0.6410, Sugoi-57 0.5417; the Spectre, with no set, 0.4709)', st.fs22 === 0.6814 && st.fs35 === 0.641 && st.sugoi57 === 0.5417 && spectre === 0.4709, [st.fs22, st.fs35, st.sugoi57, spectre]);
t('...a Radar Pod hung on a stealth jet counts as a store (−0.12), unlike a set inside', R(`(() => { const ps = partsFromDesign(templateRows(TEMPLATES.fs22)), a = Combat.stealthOf({ parts: ps }), b = Combat.stealthOf({ parts: ps.concat([makePart('radarPod', 2, 8)]) });
  return Math.abs(a - b - 0.12) < 1e-9; })()`));
// the gates change nothing for any part but a set: every template without one (the TK-34 and the other Armour among them), and
// RAIDER, built with the gates and with innerRadar() stubbed to false, have the same areas, hull, wheels, nose, reach and stealth
const fp = R(`(() => {
  const keys = Object.keys(TEMPLATES).filter((k) => !TEMPLATES[k].parts.some((r) => innerRadar(PARTS[r[0]])));
  const mk = (k) => { const T = TEMPLATES[k], ps = partsFromDesign(T ? templateRows(T) : RAIDER.map(([type, x, y, rot]) => ({ type, x, y, rot: rot || 0, flip: x < 0 }))), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = T ? T.kind : 'plane'; v.rebuildGroups();
    return JSON.stringify([v.area, v.hull.map((h) => [h.x, h.y, h.z]), v.wheelPts.map((w) => [w.x, w.y, w.z, w.r]), v.noseAero, v.noseSharp, v.reach, v.depth, v.width, v.mass, Combat.stealthOf(v)]); };
  const now = keys.concat(['RAIDER']).map(mk), real = innerRadar;
  innerRadar = () => false;
  try { const off = keys.concat(['RAIDER']).map(mk); return { n: keys.length, diff: keys.concat(['RAIDER']).filter((k, i) => now[i] !== off[i]), tk34: keys.includes('tk34') }; } finally { innerRadar = real; }
})()`);
t(`...for the ${fp.n} templates without a set (TK-34 and the other Armour included) and RAIDER, the gates change nothing: areas, hull, wheels, nose, reach and stealth as with them switched off`, fp.n >= 39 && fp.tk34 && !fp.diff.length, fp);

// ---------------------------------------------------------------- F. damage (the real Flight.breakParts and ripParts)
const FC = G.load({ combat: true, flight: true, props: true }), RF = (c) => G.run(FC, c);
FC.Math.random = () => 0.5;
FC.__JETS = JETS;
RF(`var __fsim = (v) => { const F = Object.create(Flight); Object.assign(F, { time: 0, vessels: [v], active: v, running: true, destroyed: false, mp: null, camAbs: { x: 0, y: 0, z: 0 }, warpIdx: 1, firing: false,
    groundAim: false, flyAim: false, target: null, dist: () => 1e9, absPos: () => ({ x: 0, y: 0, z: 0 }), log: [], toast(m) { this.log.push(m); }, onDestroyed() { this.destroyed = true; } }); return F; };
  var __booms = 0; { const e0 = FX.explosion; FX.explosion = function (...a) { __booms++; return e0.apply(this, a); }; }
  var __set = (v) => v.parts.find((p) => innerRadar(p.def)), __has = (F, p) => F.vessels.filter((o) => !o.dead && o.parts.includes(p));`);
const air = (k) => G.craft(FC, G.templateRows(FC, k), 'plane', 'air');
FC.__air = air;
{
  const r = RF(`(() => { const v = __air('falcon'), F = __fsim(v), s = __set(v), n0 = v.parts.length, b0 = __booms, f0 = FX.list.length;
    Combat.damage(v, s, Combat.maxHp(s.def) * 0.5, 'shot', F); const half = Combat.hpFrac(s), t0 = F.log.slice();
    Combat.damage(v, s, 1e6, 'shot', F); const t1 = F.log.slice();
    Combat.damage(v, s, 1e6, 'shot', F); Combat._t.destroyPart(v, s, 'shot', F);
    return { half, broken: s.broken === true, aboard: v.parts.includes(s) && v.parts.length === n0 && F.vessels.length === 1, booms: __booms - b0, fx: FX.list.length - f0, t0, t1, t2: F.log.slice(),
      guiding: radarSummary(v.parts).guiding, dead: Death.partDead(s), control: !!v.control, down: !!v.down };
  })()`);
  t('F24 a set at half health is at half (the radar\'s reach follows it: radar.js)', near(r.half, 0.5, 1e-9), r.half);
  t('...at 0 hp it is broken and stays aboard: nothing exploded or torn off, the craft flies on (not down)', r.broken && r.aboard && r.booms === 0 && r.fx === 0 && r.control && !r.down, r);
  t('...the player hears it once ("Pulse-Doppler Radar knocked out: radar out"), and it no longer counts as a radar', r.t1.slice(r.t0.length).join('|') === 'Pulse-Doppler Radar knocked out: radar out' && r.t2.length === r.t1.length && !r.guiding && r.dead, [r.t0, r.t1, r.t2]);
  const sv = RF(`(() => { const v = __air('falcon'), F = __fsim(v), s = __set(v); Combat.damage(v, s, 1e6, 'shot', F);
    const d = JSON.parse(JSON.stringify(v.serialize())), back = Vessel.restore(d), q = __set(back);
    return { keys: Object.keys(d.parts.find((p) => p.type === 'radarPD')).join(), hp: q.hp, guiding: radarSummary(back.parts).guiding, fine: radarSummary(__air('falcon').parts).guiding }; })()`);
  t('...a restored flight with the set at 0 hp reads it as out (hp is saved; no new save field)', sv.hp <= 0 && !sv.guiding && sv.fine && !/broken|ko/.test(sv.keys) && /\bhp\b/.test(sv.keys), sv);
}
{
  // every part of each jet to 0, one at a time, wherever it is by then: the set is broken, and stays with its host
  const r = RF(`__JETS.map(([k]) => { const v = __air(k), F = __fsim(v), s = __set(v), host = v.byId.get(s.att), all = v.parts.slice(); let lost = 0;
    Combat.damage(v, s, 1e6, 'shot', F);
    for (const p of all) { const o = __has(F, p)[0]; if (!o) continue; Combat.damage(o, p, 1e6, 'shot', F); const hs = __has(F, host)[0], ss = __has(F, s)[0]; if (hs !== ss || (!hs && ss)) lost++; }
    const ss = __has(F, s);
    return [k, s.broken === true, lost, ss.length <= 1, ss.length === 1 && ss[0].parts.length > 1]; })`);
  t('...every part of each radar jet shot to 0, one after another: its set broken, never alone, always where its nose is', r.every(([, b, lost, one, notAlone]) => b && lost === 0 && one && notAlone), r);
  const bp = RF(`__JETS.map(([k]) => { const v = __air(k), F = __fsim(v), s = __set(v), host = v.byId.get(s.att); F.breakParts(v, [host], 'blast');
    return [k, !F.vessels.some((o) => o.parts.includes(s)), !F.vessels.some((o) => o.parts.length === 1 && innerRadar(o.parts[0].def)), !v.adj.has(s.id)]; })`);
  t('...the nose blown up (Flight.breakParts): the set goes with it, unseen (no vessel holds it, no lone debris, no joins left)', bp.every((e) => e[1] && e[2] && e[3]), bp);
  const bb = RF(`(() => { const v = __air('falcon'), F = __fsim(v), s = __set(v), host = v.byId.get(s.att), b0 = __booms; F.breakParts(v, [host], 'blast'); return __booms - b0; })()`);
  t('...one explosion for the nose, none for the set inside it', bb === 1, bb);
  const rp = RF(`__JETS.map(([k]) => { const v = __air(k), F = __fsim(v), s = __set(v), host = v.byId.get(s.att), n0 = v.parts.length; F.ripParts(v, [host], 'shot');
    const ps = __has(F, s), ph = __has(F, host); return [k, ps.length === 1 && ps[0] === ph[0], F.vessels.length > 1 && ps[0].parts.length < n0]; })`);
  t('...the nose torn off (Flight.ripParts): the set goes with it, in the same piece', rp.every((e) => e[1] && e[2]), rp);
}
{
  // F25: a radar missile (blast 16 m, 450) bursting ahead of the Falcon's nose tip, on its axis (worked by hand from explode's
  // falloff, 450·(1 − d/16)^1.5, d from the part's centre less half its longest side: the set 10.05 m → 102 of its 180;
  // the nose 9.0 m → 130 of its 359; at 1.5 m the nose takes 388 and the set 225)
  const burst = (ahead) => RF(`(() => { const v = __air('falcon'), F = __fsim(v), nose = v.byId.get(__set(v).att), s = __set(v);
    Combat.explode(EARTH, v.toWorld(0, 12.1 + 2.1 + ${ahead}, 0), 16, 450, null, F, true);
    return { nose: nose.hp / Combat.maxHp(nose.def), set: s.hp / Combat.maxHp(s.def), broken: !!s.broken, ko: !!nose.ko, setIn: __has(F, s)[0] === __has(F, nose)[0] && __has(F, s).length === 1 }; })()`);
  const b9 = burst(9), b4 = burst(4), b15 = burst(1.5);
  t('F25 a radar missile 9 m ahead of the Falcon\'s nose: the nose at 64 %, the set alive at 43 % (its own 180 hp)', near(b9.nose, 229 / 359, 0.01) && near(b9.set, 78 / 180, 0.01) && !b9.broken, b9);
  t('...4 m ahead: the set out (broken, still in the nose), the nose hurt (19 %) but its pilot flying', b4.set <= 0 && b4.broken && b4.setIn && b4.nose > 0.1 && b4.nose < 0.3 && !b4.ko, b4);
  t('...1.5 m ahead: both at 0: the pilot knocked out, the set out, both aboard the falling hulk', b15.set <= 0 && b15.nose <= 0 && b15.broken && b15.ko && b15.setIn, b15);
}
// ---------------------------------------------------------------- D-H. the radar logic (radar.js) and what combat.js asks of it
// Scenes as rwr.test.js's: the player's craft 3 km up (by the range, over the sea), level, its nose level and east-west,
// bandits (RAIDER, the AI fighter) put where each check needs them. Every figure is the spec's table worked by hand.
const C = ctx.Combat, RD = ctx.Radar, T = C._t;
ctx.Math.random = () => 0.5; // (chaff odds: 0.5 against a bundle's 0.75)
R(`var __lvl = (o, f) => { const up = norm3(v3(o.x, o.y, o.z)), F = v3(f.x, f.y, f.z), k = dot3(F, up); F.x -= up.x * k; F.y -= up.y * k; F.z -= up.z * k; norm3(F);
     const nx = v3(-up.x, -up.y, -up.z); o.q = qbasis(nx, F, cross3(nx, F)); o.av = v3(); return o; };
   var __snd = []; Sound = new Proxy({}, { get: (o, k) => (...a) => { __snd.push([k, ...a]); } });`);
const RAIDER = R('RAIDER'), HUB = { radarPod: [1.3, 8.6], radarMast: [-0.9, 9], rotodome: [-1, 8] }; // (outside radars: on the fuselage, att 1)
// the Falcon's rows (without any set it may carry) with these radars ([type, rot]; a tail set faces back): inner sets in
// its nose (row 3); swap: part types replaced (and hung on the wing, row 4); drop: rows left out
function jet(sets = [], { swap, drop } = {}) {
  let rows = R(`__rowsOf('falcon')`).map((r) => ({ ...r }));
  if (drop) rows = rows.filter((r) => !drop(r.type));
  if (swap) rows = rows.map((r) => (swap[r.type] ? { ...r, type: swap[r.type], att: 4 } : r));
  for (const s of sets) {
    const [k, rot] = Array.isArray(s) ? s : [s, s === 'radarTail' ? 2 : 0];
    rows.push(HUB[k] ? { type: k, x: HUB[k][0], y: HUB[k][1], rot, flip: false, att: 1 } : { type: k, x: 0, y: 12.6, rot, flip: false, att: 3 });
  }
  return G.craft(ctx, rows, 'plane', 'air');
}
const level = (o, f) => { ctx.__o = o; ctx.__f = f; R('__lvl(__o, __f)'); return o; };
// (by the range, 3 km up, so the AI fighters stay: away from it they are cleared; the range's own targets kept out)
function scene(v, at = T.at(9000, 0, 3000)) {
  v.x = at.x; v.y = at.y; v.z = at.z; v.vx = v.vy = v.vz = 0; v.landed = false;
  level(v, R(`(() => { const u = norm3(v3(${v.x}, ${v.y}, ${v.z})); return norm3(cross3(u, v3(0, 0, 1))); })()`));
  const F = G.sim();
  Object.assign(F, { running: true, active: v, vessels: [v], warpIdx: 0, destroyed: false, firing: false, camAbs: null });
  C.reset(F); C.S.fighterT = 1e9; C.S.spawned = true; C.S.targets = [];
  return F;
}
// v's own frame: nose, right wing, up (copied: axis() may hand back a shared object)
const axes = (v) => { const f = { ...v.axis(0, 1, 0) }, r = { ...v.axis(0, 0, 1) }, L = Math.hypot(v.x, v.y, v.z); return { f, r, u: { x: v.x / L, y: v.y / L, z: v.z / L } }; };
const P = (v, a, b = 0, c = 0) => { const { f, r, u } = axes(v); return { x: v.x + f.x * a + r.x * b + u.x * c, y: v.y + f.y * a + r.y * b + u.y * c, z: v.z + f.z * a + r.z * b + u.z * c }; };
const bearing = (v, d, deg, c = 0) => P(v, d * Math.cos((deg * Math.PI) / 180), d * Math.sin((deg * Math.PI) / 180), c); // (deg to the right of the nose)
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const move = (o, p, vel) => { o.x = p.x; o.y = p.y; o.z = p.z; if (vel) { o.vx = vel.x; o.vy = vel.y; o.vz = vel.z; } return o; };
// a bandit at p, its nose towards `to` (default: the player's craft), still unless vel says otherwise
function bandit(F, p, { to, vel, rows = RAIDER, kind, drone } = {}) {
  const o = G.craft(ctx, rows, 'plane', 'air'), aim = to || F.active;
  move(o, p, vel || { x: 0, y: 0, z: 0 });
  level(o, { x: aim.x - p.x, y: aim.y - p.y, z: aim.z - p.z });
  Object.assign(o, { name: 'Bandit', sas: 'off', throttle: 0.95, gearUp: true, ai: { t: 0, down: false } });
  for (const q of o.parts) if (q.def.thrust) { q.active = true; q.firing = 0.95; } // (hot: its engine at 95 %)
  if (kind) o.kind = kind;
  if (drone) o.ai.drone = true;
  F.vessels.push(o);
  return o;
}
const sees = (L, o, job = 'scan') => RD.sees(L, o, C.refPos(o), job);
const frame = (F, n = 1) => { for (let i = 0; i < n; i++) { F.time += 1 / 60; C.frame(F, 1 / 60); } };
const sysOf = (v, key) => C.systems(v).findIndex((s) => s.key === key);
// frames until the missile system `key` locks `b` (at most `max` s): the time since the first frame, or null
function lockIn(F, v, b, key, max = 6) {
  v.wsel = sysOf(v, key);
  const t0 = F.time + 1 / 60;
  for (let i = 0; i < max * 60; i++) { frame(F); if (C.S.lock === b) return F.time - t0; }
  return null;
}
const fire = (F) => { F.fireTap = true; frame(F); };
const ALL = ['radarRanging', 'radarPulse', 'radarPD', 'radarPESA', 'radarAESA', 'radarPod', 'radarMast', 'rotodome'];

// D11: cone and reach, every radar
{
  const bad = [];
  for (const k of ALL) {
    const v = jet([k]), F = scene(v), S = ctx.PARTS[k].radarSet, b = bandit(F, P(v, 1000)), at = (p) => sees(v, move(b, p));
    const got = [at(P(v, 0.95 * S.range)), at(P(v, 1.05 * S.range)), S.cone >= 180 ? false : at(bearing(v, 0.5 * S.range, S.cone + 5)), S.cone >= 180 ? true : at(bearing(v, 0.5 * S.range, S.cone - 5)),
      at(bearing(v, 3000, 120)), at(bearing(v, 3000, -120))];
    if (got.join() !== [true, false, false, true, S.cone >= 180, S.cone >= 180].join()) bad.push(k + ' ' + got.join());
  }
  t('D11 Radar.sees (scan): a fighter dead ahead at 0.95 × each radar\'s range seen, at 1.05 × not; 5° outside its cone not, 5° inside seen; 120° off the nose only by the mast and the Rotodome', !bad.length, bad);
  const warn = [];
  for (const k of ALL.concat('radarTail')) {
    const v = jet([k]), F = scene(v), b = bandit(F, P(v, -3000));
    warn.push([k, sees(v, b, 'warn') === true, sees(v, b, 'scan') === true]);
  }
  t('...a fighter 3 km behind: the tail set\'s warning sees it, nothing else\'s; the tail set never scans (and the all-round radars see it as a contact)',
    warn.every(([k, w, s]) => w === (k === 'radarTail') && s === (k === 'radarMast' || k === 'rotodome')), warn);
  const v = jet(['radarTail']), F = scene(v), b = bandit(F, P(v, -3900)), w1 = sees(v, b, 'warn') === true, w2 = sees(v, move(b, P(v, -4100)), 'warn') === true;
  const v2 = jet([['radarPD', 2]]), F2 = scene(v2), b2 = bandit(F2, P(v2, -5000)), back = sees(v2, b2) === true, ahead = sees(v2, move(b2, P(v2, 5000))) === true;
  t('...the tail set reaches 4 km (3.9 seen, 4.1 not); a pulse-Doppler set turned round (rot 2) looks backwards (5 km behind seen, ahead not)', w1 && !w2 && back && !ahead, [w1, w2, back, ahead]);
}

// D12: look-down, notching
{
  // a fighter 600 m below, 5 km ahead (or 3 km behind), flying across at 200 m/s with `radial` m/s along the beam towards us
  const low = (k, radial, behind) => {
    const v = jet([k]), F = scene(v), p = P(v, behind ? -3000 : 5000, 0, -600), d = dist(p, v), { r } = axes(v);
    const u = { x: (p.x - v.x) / d, y: (p.y - v.y) / d, z: (p.z - v.z) / d };
    const b = bandit(F, p, { vel: { x: r.x * 200 - u.x * radial, y: r.y * 200 - u.y * radial, z: r.z * 200 - u.z * radial } });
    return sees(v, b, behind ? 'warn' : 'scan');
  };
  const got = [low('radarPulse', 250), low('radarRanging', 250), low('radarPD', 250), low('radarPD', 30), low('radarPESA', 30), low('radarPESA', 20), low('radarAESA', 20), low('radarAESA', 12), low('radarMast', 12), low('radarTail', 0, true)];
  t('D12 look-down, a fighter 600 m below: closing at 250 m/s lost in the clutter by the pulse (and ranging) sets, seen by a pulse-Doppler; 30 m/s along the beam: PD notch, PESA seen; 20: PESA notch, AESA seen; 12: AESA notch, mast seen; the tail set never notched',
    got.join() === ['clutter', 'clutter', true, 'notch', true, 'notch', true, 'notch', true, true].join(), got);
}

// D13: stealth and jamming
{
  const v = jet(['radarAESA']), F = scene(v), fs22 = G.craft(ctx, R(`__rowsOf('fs22')`), 'plane', 'air'), st = C.stealthOf(fs22);
  const a = sees(v, move(fs22, P(v, 8200))) === true, b = sees(v, move(fs22, P(v, 8400))) === true; // (26 km × (1 − 0.6814) = 8.28 km)
  t('D13 an AESA sees the FS-22 (stealth 0.6814) at 8.2 km, not at 8.4 km', near(st, 0.6814, 1e-4) && a && !b, [st, a, b]);
  const JAM = RAIDER.concat([['ecm', 1.2, 6, 0, { att: 1 }]]), got = [];
  for (const [k, lo, hi] of [['radarPD', 12500, 12700], ['radarAESA', 23500, 23800], ['radarPulse', 9700, 9900]]) { // (× 0.70: 12.6 km; × 0.91: 23.66 km; 14 × 0.7 = 9.8 km)
    const w = jet([k]), Fw = scene(w), j = bandit(Fw, P(w, lo), { rows: JAM });
    got.push([k, C.jams(j), C.stealthOf(j), sees(w, j) === true, sees(w, move(j, P(w, hi))) === true]);
  }
  t('...a jammer past 5 km: the PD\'s reach × 0.70 (12.6 km), the AESA\'s × 0.91 (23.66 km), the pulse set\'s × 0.70 (9.8 km)', got.every((g) => g[1] && g[2] === 0 && g[3] && !g[4]), got);
}

// D14: the ground in the way
{
  const top = R(`(() => { const E = EARTH, R0 = E.radius; let b = { h: -1e9 }, n = 0;
    for (let i = 0; i < 400; i++) for (let j = 0; j < 500; j++) { const lat = -1.4 + (2.8 * (i + 0.5)) / 400, a = -Math.PI + (2 * Math.PI * (j + 0.5)) / 500, h = Terrain.surfaceAt(E, a, lat * R0); n++; if (h > b.h) b = { h, a, lat }; }
    return { n, h: b.h, a: b.a, lat: b.lat }; })()`);
  t('D14 the Earth map\'s highest ground over 200,000 samples stays 400 m under the line-of-sight ceiling (2,000 m)', top.n === 200000 && top.h < RD._t.LOS_TOP - 400, top);
  // a ridge: the highest ground near that top; two craft either side of it, 250 m below its crest, the line between them
  // dipping under the ground (sampled here every 50 m, independently of clearLine)
  const ridge = R(`(() => { const E = EARTH, R0 = E.radius, pt = (a, lat, h) => { const r = R0 + h; return { x: r * Math.cos(lat) * Math.cos(a), y: r * Math.cos(lat) * Math.sin(a), z: r * Math.sin(lat) }; };
    const sf = (p) => { const L = Terrain.locate(E, p.x, p.y, p.z); return { g: Math.max(0, Terrain.surfaceAt(E, L.a, L.z)), h: L.r - R0 }; };
    let c = { h: -1e9 };
    for (let i = -30; i <= 30; i++) for (let j = -30; j <= 30; j++) { const a = ${top.a} + (i * 250) / R0, lat = ${top.lat} + (j * 250) / R0, h = Terrain.surfaceAt(E, a, lat * R0); if (h > c.h) c = { h, a, lat }; }
    for (const D of [3000, 4000, 5000, 6000, 8000]) for (const [ea, nl] of [[1, 0], [0, 1], [0.7, 0.7], [0.7, -0.7]]) {
      const H = c.h - 250, A = pt(c.a + (ea * D) / (R0 * Math.cos(c.lat)), c.lat + (nl * D) / R0, H), B = pt(c.a - (ea * D) / (R0 * Math.cos(c.lat)), c.lat - (nl * D) / R0, H);
      const sa = sf(A), sb = sf(B); if (sa.g > H - 60 || sb.g > H - 60) continue;
      let under = 0; const n = Math.ceil((2 * D) / 50); for (let k = 1; k < n; k++) { const q = sf({ x: A.x + ((B.x - A.x) * k) / n, y: A.y + ((B.y - A.y) * k) / n, z: A.z + ((B.z - A.z) * k) / n }); if (q.h < q.g) under++; }
      if (under >= 3) return { A, B, H, D, crest: c.h, under };
    }
    return null; })()`);
  if (!ridge) t('...a ridge near the highest ground to test with', false);
  else {
    const v = jet(['radarMast']), F = scene(v, ridge.A), b = bandit(F, ridge.B);
    const d = dist(v, b), u = { x: (b.x - v.x) / d, y: (b.y - v.y) / d, z: (b.z - v.z) / d };
    move(b, b, { x: -u.x * 200, y: -u.y * 200, z: -u.z * 200 }); // (closing: not notching)
    const hidden = sees(v, b), cl0 = C.clearLine;
    let calls = 0;
    C.clearLine = function (...a) { calls++; return cl0.apply(this, a); };
    const up = (o, k) => { const L = Math.hypot(o.x, o.y, o.z); move(o, { x: (o.x * (L + k)) / L, y: (o.y * (L + k)) / L, z: (o.z * (L + k)) / L }); };
    const c1 = calls; up(v, 3000); up(b, 3000);
    const above = sees(v, b), c2 = calls;
    C.clearLine = cl0;
    t(`...a ridge (crest ${Math.round(ridge.crest)} m) between two craft ${Math.round(ridge.D * 2 / 1000)} km apart 250 m below it: the mast radar doesn't see through it (clearLine asked); 3 km higher it does, with no line-of-sight check at all`,
      hidden === false && c1 === 0 && above === true && c2 === c1, [hidden, above, c1, c2, ridge.under]);
  }
}

// D15: drones
{
  const v = jet(['radarAESA']), F = scene(v), a = bandit(F, P(v, 3000, 100), { kind: 'drone' }), b = bandit(F, P(v, 3000, -100), { drone: true }), c = bandit(F, P(v, 3000, 300));
  frame(F, 3);
  t('D15 drones are never radar contacts (a drone craft, an AI drone), a fighter beside them is', sees(v, a) === false && sees(v, b) === false && sees(v, c) === true && RD.S.set.has(c) && !RD.S.rc.some((e) => e.ref === a || e.ref === b) && !RD.has(a) && !RD.has(b));
}

// E16: lock times
{
  const got = {};
  for (const k of ['radarPulse', 'radarPD', 'radarPESA', 'radarAESA']) { const v = jet([k]), F = scene(v); got[k] = lockIn(F, v, bandit(F, P(v, 5000)), 'radarMissiles'); }
  const JAM = RAIDER.concat([['ecm', 1.2, 6, 0, { att: 1 }]]);
  for (const k of ['radarPD', 'radarAESA']) { const v = jet([k]), F = scene(v); got[k + '+jam'] = lockIn(F, v, bandit(F, P(v, 4000), { rows: JAM }), 'radarMissiles'); }
  const WANT = { radarPulse: 1.8, radarPD: 1.4, radarPESA: 1.0, radarAESA: 0.7, 'radarPD+jam': 2.8, 'radarAESA+jam': 0.91 }, dt = 1 / 60;
  t('E16 radar lock times on a bandit dead ahead (± a frame): Pulse 1.8, PD 1.4, PESA 1.0, AESA 0.7 s; on a jammer PD 2.8, AESA 0.91 s',
    Object.keys(WANT).every((k) => got[k] != null && got[k] >= WANT[k] - 1e-9 && got[k] <= WANT[k] + 2 * dt + 1e-9), got);
  // a heat seeker on a hot tail 1.5 km ahead: 0.6 s when a radar holds it, else 0.9
  const hs = (sets) => { const v = jet(sets), F = scene(v), b = bandit(F, P(v, 1500), { to: P(v, 3000) }); return lockIn(F, v, b, 'aam'); };
  const cued = hs(['radarPD']), plain = hs([]), rng = hs(['radarRanging']);
  t('...a heat seeker on a target a radar holds locks in 0.6 s (radar-cued; the Ranging set cues too), else 0.9 s',
    cued != null && cued >= 0.6 - 1e-9 && cued <= 0.6 + 2 * dt && rng != null && Math.abs(rng - cued) < 1e-9 && plain != null && plain >= 0.9 - 1e-9 && plain <= 0.9 + 2 * dt, [cued, rng, plain]);
}

// E17: no radar
{
  const v = jet([]), F = scene(v), b = bandit(F, P(v, 8000));
  const never = lockIn(F, v, b, 'radarMissiles', 5) === null, r0 = T.rangeOf(v, ctx.PARTS.radarMissiles.weapon);
  const v2 = jet([]), F2 = scene(v2), hot = lockIn(F2, v2, bandit(F2, P(v2, 4000), { to: P(v2, 9000) }), 'aam');
  const vi = jet([['ruIRST', 0]]), w = ctx.PARTS.aam.weapon;
  const k = T.rangeOf(vi, w) / T.rangeOf(v, w);
  t('E17 no radar: a bandit dead ahead at 8 km never locks in 5 s; rangeOf(radar missiles) 0; the heat seeker still locks a hot tail at 4 km; an IRST still × 1.3 for heat seekers', never && r0 === 0 && hot != null && near(k, 1.3, 1e-9), [never, r0, hot, k]);
  // the fire edge: unguided, with the toast once a flight
  const n0 = C.S.shots.length; v.wsel = sysOf(v, 'radarMissiles'); F.toasts.length = 0;
  fire(F); const s1 = C.S.shots[C.S.shots.length - 1]; frame(F, 3); fire(F);
  const said = F.toasts.filter((x) => /^No radar to guide the Radar Missiles: they fly straight/.test(x));
  t('...fired anyway, it goes unguided (no target) with "No radar to guide…" once; a second one says nothing', C.S.shots.length === n0 + 2 && s1.k === 'missile' && s1.target === null && said.length === 1, [C.S.shots.length - n0, said]);
}

// E18: how far a radar missile locks
{
  const rm = ctx.PARTS.radarMissiles.weapon, got = {};
  for (const k of ['radarPD', 'radarPulse', 'radarRanging', 'radarPod', 'rotodome']) got[k] = T.rangeOf(jet([k]), rm);
  const off = jet(['radarPD']); off.radarOff = true; got.off = T.rangeOf(off, rm);
  t('E18 rangeOf(radar missiles) = min(15 km, the guiding radar\'s reach): PD 15000, Pulse 14000, Ranging 0 (guides nothing), Radar Pod 12000, Rotodome 15000, radar off 0',
    JSON.stringify(got) === JSON.stringify({ radarPD: 15000, radarPulse: 14000, radarRanging: 0, radarPod: 12000, rotodome: 15000, off: 0 }), got);
}

// E19: targets at once
{
  // three bandits 5 km ahead (4° apart); pick each in turn (Radar.S.pick), lock, fire
  const run = (k) => {
    const v = jet([k]), F = scene(v), bs = [-4, 0, 4].map((a) => bandit(F, bearing(v, 5000, a))), out = [];
    const rm = v.parts.filter((p) => p.type === 'radarMissiles');
    const shoot = (b) => { RD.S.pick = b; const lt = C.S.lock === b ? 0 : lockIn(F, v, b, 'radarMissiles'); for (const p of rm) p.ammo = 8; const n = C.S.shots.length; F.toasts.length = 0; fire(F);
      const s = C.S.shots.length > n ? C.S.shots[C.S.shots.length - 1] : null; out.push(lt == null ? 'nolock' : s ? 'shot' : F.toasts.find((x) => /^Radar busy/.test(x)) || 'none'); return s; };
    return { v, F, bs, out, shoot };
  };
  const A = run('radarPD'), s0 = A.shoot(A.bs[0]); A.shoot(A.bs[1]); A.shoot(A.bs[1]); A.shoot(A.bs[2]);
  s0.pit = true; A.shoot(A.bs[2]);
  t('E19 a PD guides at two targets: a third is refused (the toast, no shot), a second missile at a target already guided goes; a missile gone active frees its slot',
    A.out.join('|') === 'shot|shot|shot|Radar busy: the Pulse-Doppler Radar guides missiles at 2 targets at a time|shot', A.out);
  const B = run('radarPulse'); B.shoot(B.bs[1]); B.shoot(B.bs[0]);
  t('...a pulse set guides at one: a second target refused', B.out.join('|') === 'shot|Radar busy: the Pulse Radar guides missiles at 1 target at a time', B.out);
  const v = jet(['radarAESA']), F = scene(v), bs = [0, 1, 2, 3, 4, 5, 6].map((i) => bandit(F, bearing(v, 5000, i * 2 - 6))), fake = bs.slice(0, 6).map((b) => ({ launcher: v, sarh: true, target: b }));
  C.S.shots.push(...fake.slice(0, 5)); const five = RD.busy(v, bs[6]); C.S.shots.push(fake[5]); const six = RD.busy(v, bs[6]), again = RD.busy(v, bs[0]);
  C.S.shots.length = 0;
  t('...an AESA guides at six: busy with six other targets in flight, not with five; never for a target already guided', !five && six && !again, [five, six, again]);
}

// E20: active radar missiles
{
  // fly one shot (physics at 1/120 s) until `stop` says so or `secs` pass
  const fly = (F, s, secs, stop) => { for (let i = 0; i < secs * 120; i++) { C.step(1 / 120, F); F.time += 1 / 120; if (stop && stop()) return true; } return false; };
  const launch = (k, swap) => {
    const v = jet([k], { swap }), F = scene(v), b = bandit(F, P(v, 12000), { to: P(v, 20000) }), key = swap ? 'radarMissilesA' : 'radarMissiles';
    const lt = lockIn(F, v, b, key); fire(F);
    return { v, F, b, s: C.S.shots.find((x) => x.k === 'missile' && x.launcher === v), lt };
  };
  const ARH = { radarMissiles: 'radarMissilesA' };
  const A = launch('radarAESA', ARH), set = A.v.parts.find((p) => p.type === 'radarAESA');
  const went = fly(A.F, A.s, 20, () => A.s.pit), at = went ? dist(A.s, A.b) : null;
  set.hp = 0; set.broken = true;
  fly(A.F, A.s, 1.5);
  t('E20 an active radar missile from an AESA, launched 12 km out: it goes active inside 6 km and keeps guiding after the set is knocked out',
    A.lt != null && A.s.act === 6000 && A.s.link && went && at <= 6000 && at > 5800 && A.s.target === A.b, [A.lt, A.s.act, A.s.link, went, at, !!A.s.target]);
  const B = launch('radarPulse', ARH), bset = B.v.parts.find((p) => p.type === 'radarPulse');
  fly(B.F, B.s, 3); const notYet = !B.s.pit && B.s.target === B.b;
  bset.hp = 0; bset.broken = true;
  fly(B.F, B.s, 0.9); const still = B.s.target === B.b; fly(B.F, B.s, 0.2);
  t('...from a pulse radar (no data link) it never goes active, and goes dumb 1 s after the set dies', B.s.act === 6000 && !B.s.link && notYet && still && B.s.target === null && !B.s.pit, [B.s.link, notYet, still, !!B.s.target]);
  const Cc = launch('radarAESA');
  const never = !fly(Cc.F, Cc.s, 20, () => Cc.s.pit || dist(Cc.s, Cc.b) < 2500);
  t('...the old Radar Missiles never go active', Cc.s.act === 0 && !Cc.s.pit && dist(Cc.s, Cc.b) < 2600, [Cc.s.act, Cc.s.pit, dist(Cc.s, Cc.b)]);
  void never;
  const D = launch('radarAESA', ARH);
  fly(D.F, D.s, 20, () => D.s.pit);
  const tp = C.refPos(D.b);
  C.S.flares.push({ b: D.b.body, x: tp.x, y: tp.y, z: tp.z, vx: 0, vy: 0, vz: 0, t: 0, life: 30, chaff: true, str: 2 });
  const lostIt = fly(D.F, D.s, 6, () => D.s.target === null);
  t('...an active one is still decoyed by chaff (a bundle at the target: odds 0.75, the roll 0.5)', D.s.pit && lostIt && dist(D.s, D.b) > 30, [D.s.pit, lostIt]);
}

// E21: notching a guided missile
{
  const v = jet(['radarPD']), F = scene(v), p = P(v, 7000, 0, -600), d = dist(p, v), u = { x: (p.x - v.x) / d, y: (p.y - v.y) / d, z: (p.z - v.z) / d }, { r } = axes(v);
  const b = bandit(F, p, { vel: { x: -u.x * 250, y: -u.y * 250, z: -u.z * 250 }, to: P(v, 0, 0, -600) });
  const lt = lockIn(F, v, b, 'radarMissiles'); fire(F);
  const s = C.S.shots.find((x) => x.k === 'missile' && x.launcher === v);
  for (let i = 0; i < 36; i++) { C.step(1 / 120, F); F.time += 1 / 120; }
  move(b, b, { x: r.x * 200, y: r.y * 200, z: r.z * 200 }); // (now flying across the beam, low: notching)
  // (steps of 1/120 s: when it first notched, when the grace ran out, when it went dumb)
  let n = 0, tN = null, tL = null;
  for (; n < 360 && s.target; n++) { C.step(1 / 120, F); F.time += 1 / 120; if (tN == null && s.notchT > 0) tN = n; if (tL == null && s.lostT > 0) tL = n; }
  const grace = (tL - tN) / 120, after = (n - tL) / 120;
  t('E21 notching a radar missile: a low target turning across the PD\'s beam gets 0.4 s of grace, then the missile goes dumb a second later',
    lt != null && s.sarh && tN != null && tN < 12 && Math.abs(grace - 0.4) <= 1.5 / 120 && Math.abs(after - 1) <= 1.5 / 120 && !s.target, [lt, tN, grace, after]);
}

// E22: the pick
{
  const v = jet(['radarPD']), F = scene(v), b1 = bandit(F, bearing(v, 5000, 2)), b2 = bandit(F, bearing(v, 5000, 10));
  const auto = lockIn(F, v, b1, 'radarMissiles') != null;
  F.toasts.length = 0;
  RD.next(F, 1); const p1 = RD.S.pick; RD.next(F, 1); const p2 = RD.S.pick, reset = C.S.lock === null && C.S.lockT === 0;
  const l2 = lockIn(F, v, b2, 'radarMissiles');
  RD.next(F, -1); const p3 = RD.S.pick; RD.next(F, 1); RD.next(F, 1); const p4 = RD.S.pick;
  t('E22 the pick: auto locks the bandit nearer the nose; I picks it, I again the other (the lock timer restarts, then locks it), Shift+I back, past the last auto',
    auto && p1 === b1 && p2 === b2 && reset && l2 != null && l2 >= 1.4 - 1e-9 && l2 <= 1.4 + 2 / 60 && p3 === b1 && p4 === null
    && F.toasts.join('|') === 'Target: Bandit 5,000 m|Target: Bandit 5,000 m|Target: Bandit 5,000 m|Target: Bandit 5,000 m|Target: auto (nearest the nose)', [auto, l2, F.toasts]);
  RD.S.pick = b2; b2.dead = true; frame(F, 20);
  const fell = RD.S.pick === null && lockIn(F, v, b1, 'radarMissiles') != null;
  b2.dead = false;
  RD.mark(b2, 100, 100); const tapped = RD.tap(F, 110, 105) && RD.S.pick === b2, miss = RD.tap(F, 300, 300);
  C.S.rwrBox = { x: 60, y: 300, R: 50, ty: 250, W: 390, H: 844, rad: true }; RD.S.pick = null;
  const disc = RD.tap(F, 70, 310) && RD.S.pick === b1;
  C.S.rwrBox = null;
  RD.S.pick = null; F.toasts.length = 0;
  const empty = jet(['radarPD']), Fe = scene(empty); RD.next(Fe, 1);
  t('...a picked bandit that dies falls back to auto; a tap on a drawn marker picks it (30 px), elsewhere it is not ours; a tap on the radar disc steps the pick; nothing in sight says so',
    fell && tapped && !miss && disc && Fe.toasts[0] === 'No targets in sight', [fell, tapped, miss, disc, Fe.toasts]);
}

// E23: radar off
{
  const v = jet(['radarPD']), F = scene(v), b = bandit(F, P(v, 10000));
  const on1 = lockIn(F, v, b, 'radarMissiles') != null && RD.S.rc.length === 1;
  F.toasts.length = 0; RD.toggle(F); frame(F, 180);
  const off = v.radarOff && RD.S.rc.length === 0 && !RD.has(b) && C.S.lock === null && T.rangeOf(v, ctx.PARTS.radarMissiles.weapon) === 0 && RD.chipState(v, C.systems(v)[v.wsel]) === 'off' && RD.pill(v) === 'RDR OFF';
  const saved = !JSON.stringify(v.serialize()).includes('radarOff');
  RD.toggle(F); const back = lockIn(F, v, b, 'radarMissiles') != null && RD.S.rc.length === 1 && RD.pill(v) === 'RDR PD';
  t('E23 radar off: no contacts, no lock, rangeOf 0, the chip and pill say so; on again everything returns; radarOff is never saved',
    on1 && off && back && saved && F.toasts[0] === 'Radar off: silent. Their warning receivers can\'t hear you' && F.toasts.includes('Radar on'), [on1, off, back, saved, F.toasts]);
}

// G26: eyes
{
  const at = (sets, d, rot) => { const v = jet(sets), F = scene(v), b = bandit(F, P(v, d)); frame(F, 2); return RD.seen(v, b, dist(v, b)); };
  const got = [at([], 10000), at(['radarPD'], 10000), at([['radarPD', 2]], 10000), at([], 5000)];
  const v = jet([]), drone = { def: { air: true } }, fs22 = G.craft(ctx, R(`__rowsOf('fs22')`), 'plane', 'air');
  const eyes = [RD.eye(v, drone, 5000), RD.eye(v, drone, 3900), RD.eye(v, fs22, 3900), RD.eye(v, fs22, 4000)]; // (6 km × (1 − 0.5 · 0.6814) = 3.96 km)
  t('G26 by eye: a bandit at 10 km unseen without a radar, seen with a PD ahead, not with a PD looking back; at 5 km seen without one; a target drone at 5 km not, 3.9 km yes; the FS-22 at 3.9 km yes, 4 km not',
    got.join() === 'false,true,false,true' && eyes.join() === 'false,true,true,false', [got, eyes]);
}

// G27: the tail warning
{
  const six = (sets, d) => { const v = jet(sets), F = scene(v); R('__snd.length = 0'); bandit(F, P(v, -d)); frame(F, 70); return [Math.round(RD.S.six), RD.S.rc.filter((c) => c.k === 'six').length, R(`__snd.filter((s) => s[0] === 'beep' && s[1] === 900).length`)]; };
  const a = six(['radarTail'], 2000), b = six([], 2000), c = six(['radarTail'], 3500);
  t('G27 CHECK SIX: a bandit 2 km behind sets S.six with a tail set (and the 900 Hz tone each second), not without one; at 3.5 km a blip but no CHECK SIX',
    Math.abs(a[0] - 2000) < 1 && a[1] === 1 && a[2] === 2 && b.join() === '0,0,0' && c[0] === 0 && c[1] === 1 && c[2] === 0, [a, b, c]);
}

// G28: solo radar locks on us
{
  const go = (drop, to) => { const v = jet([], { drop }), F = scene(v); R('__snd.length = 0'); const b = bandit(F, P(v, 5000), to ? { to: to(v) } : {}); frame(F, 75);
    return { v, F, b, locks: T.lockers().filter((l) => l.ref === b).length, tone: R(`__snd.filter((s) => s[0] === 'tone' && s[1] === 700).length`), rwr: C.S.rwr }; };
  const a = go(), b = go(null, (v) => bearing(v, 9000, 90)), c = go((k) => k === 'rwr');
  t('G28 solo: a bandit 5 km out with us in its nose is a radar lock on us (lockers), and with the Falcon\'s RWR the 700 Hz tone sounds; 90° off its nose nothing; without an RWR nothing heard',
    a.locks === 1 && a.rwr === 1 && a.tone >= 1 && b.locks === 0 && b.tone === 0 && c.locks === 1 && c.rwr === 0 && c.tone === 0, [[a.locks, a.tone], [b.locks, b.tone], [c.locks, c.rwr, c.tone]]);
  // the frigate, while its SAM homes on us (Radar's locker pass on its own)
  const v = jet([]), F = scene(v), sp = P(v, 6000, 0, -3000), ship = { kind: 'frigate', alive: true, def: { rsam: true, h: 20, radar: 30000 }, pos: sp };
  C.S.targets.push(ship);
  RD._t.lockers(v, F); const none = RD.S.locks.length;
  C.S.shots.push({ k: 'missile', owner: ship, target: v, x: sp.x, y: sp.y, z: sp.z });
  RD._t.lockers(v, F); const one = RD.S.locks.length === 1 && RD.S.locks[0].ref === ship && T.lockers().length === 1;
  C.S.shots.length = 0; C.S.targets.length = 0;
  t('...the frigate is a lock on us while one of its SAMs homes on us, not before', none === 0 && one, [none, one]);
}

// G29: low probability of intercept
{
  const mk = (k, d) => { const v = jet([k]), F = scene(v), g = jet(['radarAESA']); move(g, P(v, d)); level(g, { x: v.x - g.x, y: v.y - g.y, z: v.z - g.z }); return { v, F, g }; };
  const A = mk('radarAESA', 10000), B = mk('radarAESA', 11000), Cc = mk('radarPD', 30000);
  const heard = [RD.heard(A.v, A.g), RD.heard(B.v, B.g), RD.heard(Cc.v, Cc.g)];
  const paint = [sees(mk('radarPD', 12000).g, A.v, 'paint'), sees(mk('radarPD', 9000).g, A.v, 'paint')];
  const p12 = mk('radarPD', 12000), p9 = mk('radarPD', 9000);
  const ghostPaints = [sees(p12.g, p12.v, 'paint'), sees(p9.g, p9.v, 'paint')];
  // the lock report: an MP stand-in (solo rules otherwise) records what Combat.frame sends
  const sent = [];
  const lockOn = (k, d) => {
    const v = jet([k]), F = scene(v), g = jet([]); move(g, P(v, d)); level(g, { x: v.x - g.x, y: v.y - g.y, z: v.z - g.z }); g.remote = 7; g.name = 'Ann';
    ctx.MP = { active: false, shared: false, pvp: false, rwr: new Map(), peers: new Map(), ghosts: () => [g], enemyGhosts: () => [g], enemy: () => true, sendLock: (pid, on) => sent.push([k, d, pid, on]), sendFlares() {}, sendMissile() {} };
    sent.length = 0;
    try { lockIn(F, v, g, 'radarMissiles', 3); frame(F, 5); } finally { delete ctx.MP; }
    return sent.some((s) => s[2] === 7 && s[3]);
  };
  const lk = [lockOn('radarAESA', 10000), lockOn('radarAESA', 11000), lockOn('radarPD', 14000)];
  t('G29 LPI: an AESA\'s lock is heard within 10.4 km (10 km yes, 11 km no), a PD\'s at any range; a ghost\'s AESA paints us (search strobes) at 9 km, not 12 km; Combat.frame reports the AESA\'s lock (MP.sendLock) only inside 10.4 km, the PD\'s at 14 km',
    heard.join() === 'true,false,true' && ghostPaints.join() === 'false,true' && lk.join() === 'true,false,true', [heard, ghostPaints, lk, paint]);
}

// G30: old designs do no radar work
{
  const got = [];
  for (const k of ['skylark', 'mustang', 'jumbo']) {
    const v = G.craft(ctx, G.templateRows(ctx, k), 'plane', 'air'), F = scene(v);
    bandit(F, P(v, 5000));
    frame(F, 600);
    got.push([k, RD.S.rcN, RD.S.rc.length, RD.S.set.size, RD.aboard(v)]);
  }
  t('G30 old designs (Skylark, Mustang, Jumbo) through Combat.frame for 10 s with a bandit about: no scan ever runs (S.rcN 0), no contacts', got.every((g) => g[1] === 0 && g[2] === 0 && g[3] === 0 && !g[4]), got);
}

// H31: the AI and the range controller
{
  const bv = G.craft(ctx, RAIDER, 'plane', 'air');
  t('H31 RAIDER: 11 rows, no radar part; a bandit has no radars (it keeps its implicit one: nothing in radar.js steers or arms it)',
    RAIDER.length === 11 && !RAIDER.some((r) => ctx.PARTS[r[0]].radarSet) && RD.radars(bv) === RD._t.NONE && !RD.aboard(bv));
  const v = jet([]), F = scene(v), { f, r } = axes(v);
  const clk = (deg) => RD.clock(v, ...Object.values(bearing(v, 9000, deg)));
  t('...the controller\'s clock: ahead 12, behind 6, right 3, left 9, 40° right 1, 160° left 7', [clk(0), clk(180), clk(90), clk(-90), clk(40), clk(-160)].join() === '12,6,3,9,1,7', [clk(0), clk(180), clk(90), clk(-90), clk(40), clk(-160)]);
  // a hostile spawn near the range: one call, its distance and clock worked here from the bandit's place
  const spawn = (toast) => {
    const w = jet([]), Fs = scene(w);
    C.S.spawned = false; C.S.fighterT = 0.01; // (the range spawns first: it seeds the random stream from the time, the same both runs)
    if (!toast) Fs.toast = undefined;
    frame(Fs, 2);
    const b = Fs.vessels.find((o) => o !== w && C.isFighter(o));
    return { w, Fs, b };
  };
  const A = spawn(true), B = spawn(false);
  const ok = !!A.b && !!B.b, ax = axes(A.w), d = dist(A.w, A.b), dx = { x: A.b.x - A.w.x, y: A.b.y - A.w.y, z: A.b.z - A.w.z };
  const hz = (a) => { const k = a.x * ax.u.x + a.y * ax.u.y + a.z * ax.u.z; return { x: a.x - ax.u.x * k, y: a.y - ax.u.y * k, z: a.z - ax.u.z * k }; };
  const fh = hz(ax.f), dh = hz(dx), rr = { x: fh.y * ax.u.z - fh.z * ax.u.y, y: fh.z * ax.u.x - fh.x * ax.u.z, z: fh.x * ax.u.y - fh.y * ax.u.x };
  const ang = Math.atan2(dh.x * rr.x + dh.y * rr.y + dh.z * rr.z, dh.x * fh.x + dh.y * fh.y + dh.z * fh.z), want = ((Math.round(ang / (Math.PI / 6)) % 12) + 12) % 12 || 12;
  const calls = A.Fs.toasts.filter((x) => /^Bandit inbound/.test(x));
  t('...a hostile spawn: one call, "Bandit inbound: <its distance>, your <its clock> o\'clock"; the bandit spawned the same with and without a toast',
    ok && calls.length === 1 && calls[0] === `Bandit inbound: ${R(`fmt.dist(${d})`)}, your ${want} o'clock` && ['x', 'y', 'z', 'vx', 'vy', 'vz'].every((k) => A.b[k] === B.b[k]) && JSON.stringify(A.b.q) === JSON.stringify(B.b.q), [calls, want, ok && ['x', 'vx', 'q'].map((k) => [JSON.stringify(A.b[k]), JSON.stringify(B.b[k])]), A.Fs.time, B.Fs.time]);
  void f; void r;
}

// ---------------------------------------------------------------- I. multiplayer
// A room of our own (pid 1) and a peer (pid 2) in an mp context, as mp.test.js's: the `rdr` message (radar off and on) and
// what it does to that peer's search strobes, forged ones, a spawn's reset, the 5 s resend while off, an active missile's
// `a` on its `mp` rows and on the replica, radar contacts spotting for the team (air only), and the room's name tags.
{
  const Q = G.load({ mp: true, combat: true }), X = (c) => G.run(Q, c);
  const msrc = fs.readFileSync(path.join(G.ROOT, 'js', 'mpui.js'), 'utf8').match(/\n {2}spotted\(g, me, F\) \{[\s\S]*?\n {2}\},\n/)[0];
  X(`var __P = 1000, __h = new Map(); performance.now = () => __P;
    var document = { hidden: false, addEventListener() {} }, navigator = {}, setInterval = () => 0, clearInterval = () => {};
    Object.assign(Net, { isHost: false, me: 1, hostNow: () => __P, on: (t, fn) => { if (!__h.has(t)) __h.set(t, []); __h.get(t).push(fn); } });
    var emit = (m) => { for (const fn of __h.get(m.t) || []) fn(m); };
    var sent = (t) => (Net.out || []).filter(([m]) => m.t === t);
    var MPUI = new Proxy({ ${msrc.trim().replace(/,$/, '')} }, { get: (o, k) => (k in o ? o[k] : () => {}) });
    MP.bind(); MP.active = true;
    MP.state = { mode: 'sandbox', format: '2v2', settings: { ...MP_DEFAULTS }, players: [{ pid: 1, name: 'Us', team: 0 }, { pid: 2, name: 'Them', team: 1 }] };
    var spawnRows = (key) => templateRows(TEMPLATES[key]).map((q, i) => [i + 1, q.type, q.x, q.y, q.rot, q.flip ? 1 : 0, q.z || 0, q.att != null ? q.att + 1 : 0, q.skin || 0]);`);
  const v = G.craft(Q, X('TEMPLATES.fs16.parts'), 'plane', 'air');
  Q.__v = v;
  X(`Object.assign(Flight, { running: true, mp: { solo: false }, vessels: [__v], active: __v, time: 10, destroyed: false, spectate: null, groundAim: false, toast() {} });
    MP.sent = { s: 0, pv: 0, hp: 0, hpSig: '' }; MP.spawnMsg = { t: 'spawn', kind: 'plane', parts: spawnRows('fs16') };
    emit({ t: 'spawn', f: 2, kind: 'plane', parts: spawnRows('fs16') });
    var P2 = MP.peers.get(2), g = P2.ghost;`);
  // the ghost behind us, nose on us, 8 km back: its radar (a pulse-Doppler, 15 km) paints us
  X(`(() => { g.q = { ...__v.q }; const f = __v.axis(0, 1, 0); g.x = __v.x - f.x * 8000; g.y = __v.y - f.y * 8000; g.z = __v.z - f.z * 8000; g.vx = g.vy = g.vz = 0; g.hiddenUntilSnap = false; })()`);
  const strobes = () => X(`(Radar._t.scanners(__v, Flight), Radar.S.scanners.some((s) => s.ref === g))`);
  const s0 = strobes();
  X(`emit({ t: 'rdr', f: 2, on: 0 })`);
  const off = X('P2.radarOff'), s1 = strobes();
  X(`emit({ t: 'rdr', f: 2, on: 1 })`);
  const on = X('P2.radarOff'), s2 = strobes();
  t('I32 rdr: a peer\'s radar off sets its radarOff and its search strobes stop; on again, they come back', !!X('g') && s0 && off === true && !s1 && on === false && s2, [s0, off, s1, on, s2]);
  X(`emit({ t: 'rdr', f: 2, on: 0 }); for (const on of ['1', '0', {}, NaN, null, undefined, true, false, [0], 2, -1]) emit({ t: 'rdr', f: 2, on }); emit({ t: 'rdr', f: 2 }); var off2 = P2.radarOff;
    emit({ t: 'rdr', f: 2, on: 1 }); for (const on of ['1', '0', {}, NaN, null, true, false, [0]]) emit({ t: 'rdr', f: 2, on }); var on2 = P2.radarOff;
    emit({ t: 'rdr', f: 99, on: 0 }); emit({ t: 'rdr', f: '__proto__', on: 0 }); emit({ t: 'rdr', on: 0 });`);
  t('...forged rdr (on "1", {}, NaN, null, true, missing; from an unknown pid or none) is ignored, and makes no peer', X(`off2 === true && on2 === false && !MP.peers.has(99) && !MP.peers.has('__proto__') && !MP.peers.has(undefined) && MP.peers.size === 1`), X('[off2, on2, [...MP.peers.keys()]]'));
  X(`emit({ t: 'rdr', f: 2, on: 0 }); emit({ t: 'spawn', f: 2, kind: 'plane', parts: spawnRows('fs16') }); var reset = P2.radarOff;`);
  t('...a new spawn from that player resets it (a new craft starts with its radar on)', X('reset === false'));

  // sending: the toggle says so at once; every 5 s while off; nothing while on; a spawn sent again carries it
  X(`Net.out = []; Radar.toggle(Flight); var t0 = sent('rdr').map(([m, to]) => [m.on, to === undefined]);
    var tick = (dt) => { __P += dt; MP.afterUpdate(); }, n = () => sent('rdr').length;
    var seq = []; for (let i = 0; i < 12; i++) { tick(1000); seq.push(n()); } MP.afterUpdate(true); var last = n();
    Net.out = []; MP.resendSpawn(3); var re = Net.out.map(([m, to]) => m.t + ':' + to + (m.t === 'rdr' ? ':' + m.on : '')).join();
    Net.out = []; Radar.toggle(Flight); var t1 = sent('rdr').map(([m]) => m.on); for (let i = 0; i < 12; i++) tick(1000); var quiet = n();
    Net.out = []; MP.resendSpawn(3); var re2 = Net.out.map(([m]) => m.t).join();`);
  t('...ours: the toggle sends rdr off at once; while off it is said again every 5 s (not by the hulk\'s last word); on, rdr on once and then nothing', X(`JSON.stringify(t0) === '[[0,true]]' && seq.join() === '1,1,1,1,2,2,2,2,2,3,3,3' && last === 3 && JSON.stringify(t1) === '[1]' && quiet === 1 && !__v.radarOff`), X('[t0, seq, last, t1, quiet]'));
  t('...a spawn sent again to one who missed it is followed by rdr off to them while our radar is off (their spawn turned it on), nothing more while on', X(`re === 'spawn:3,parts:3,rdr:3:0' && re2 === 'spawn,parts'`), X('[re, re2]'));
  X(`(() => { const S = MP.sent; MP.sent = null; MP.sendRadar(false); MP.sent = S; })(); Flight.mp = null; Net.out = []; MP.sendRadar(false); var unshared = Net.out.length; Flight.mp = { solo: false };`);
  t('...nothing goes out unless our craft is in the room', X('unshared === 0'));

  // an active missile: `a: 1` on its mp rows (absent before: old rows unchanged), and the replica goes active
  X(`Net.out = []; var ms = { k: 'missile', b: EARTH, x: __v.x, y: __v.y, z: __v.z, vx: 300, vy: 0, vz: 0, dx: 1, dy: 0, dz: 0, target: g, sarh: true }; Combat.S.shots.push(ms); MP.missiles.set(ms, { id: 5, at: -1e9, quiet: false });
    __P += 200; MP.syncMissiles(); var m0 = sent('mp').map(([m]) => Object.keys(m).join()); ms.pit = true; __P += 200; MP.syncMissiles(); var m1 = sent('mp').map(([m]) => m.a);
    Combat.S.shots.splice(Combat.S.shots.indexOf(ms), 1); MP.missiles.clear();`);
  t('I32 mp rows: an active radar missile\'s carry a: 1; before it goes active the row is the old one exactly (t, id, P, V, D, tg)', X(`JSON.stringify(m0) === '["t,id,P,V,D,tg"]' && JSON.stringify(m1) === '[null,1]' && !('a' in sent('mp')[0][0])`), X('[m0, m1]'));
  X(`var at = [g.x + 2000, g.y, g.z], rep = () => Combat.S.shots.find((q) => q.net === 2 && q.netId === 9);
    emit({ t: 'msl', f: 2, id: 9, b: 'earth', P: at, V: [300, 0, 0], D: [1, 0, 0], tg: 1, radar: 1 }); var r0 = !!rep() && !rep().pit;
    emit({ t: 'mp', f: 2, id: 9, P: at, V: [300, 0, 0], D: [1, 0, 0], tg: 1 }); var r1 = rep().pit;
    for (const a of ['1', true, 2, {}, [1]]) emit({ t: 'mp', f: 2, id: 9, P: at, V: [300, 0, 0], D: [1, 0, 0], tg: 1, a }); var r2 = rep().pit;
    emit({ t: 'mp', f: 2, id: 9, P: at, V: [300, 0, 0], D: [1, 0, 0], tg: 1, a: 1 }); var r3 = rep().pit;
    emit({ t: 'mp', f: 2, id: 9, P: at, V: [300, 0, 0], D: [1, 0, 0], tg: 1 }); var r4 = rep().pit;`);
  t('...on our screen: their missile\'s replica goes active (pit) on a: 1 and stays so; anything but the number 1 does nothing', X('r0 && !r1 && !r2 && r3 === true && r4 === true'), X('[r0, r1, r2, r3, r4]'));

  // spotting: a radar contact counts for aircraft against aircraft, our own craft's radar only, never a ground vehicle
  X(`var tk = null; (() => { const parts = partsFromDesign(templateRows(TEMPLATES.tk34)); tk = new Vessel(parts, buildAdjacency(parts), EARTH); tk.kind = 'tank'; })();
    var other = { kind: 'plane' }, sv = (me, o, d) => MP.sees(me, o, d);
    Radar.S.set.clear(); var a0 = [sv(__v, g, 20000), sv(__v, g, 5000)];
    Radar.S.set.add(g); Radar.S.set.add(tk); var a1 = [sv(__v, g, 20000), sv(other, g, 20000), sv(__v, tk, 20000)]; Radar.S.set.clear();`);
  t('I32 MP.sees: an enemy aircraft our radar holds is seen at 20 km (by eye within 6 km either way); not on another craft\'s behalf, and never a ground vehicle', X(`a0.join() === 'false,true' && a1.join() === 'true,false,false'`), X('[a0, a1]'));
  // the room's name tags: within 6 km by eye; further only while our radar holds them; never while destroyed
  X(`MP.state.mode = 'pvp'; MP.state.settings = { ...MP_DEFAULTS }; Radar.S.set.clear();
    var sp = () => MPUI.spotted(g, __v, Flight), far = (k) => { const f = __v.axis(0, 1, 0); g.x = __v.x - f.x * k; g.y = __v.y - f.y * k; g.z = __v.z - f.z * k; };
    far(4000); var b0 = sp(); far(12000); var b1 = sp(); Radar.S.set.add(g); var b2 = sp(); Flight.destroyed = true; var b3 = sp(); Flight.destroyed = false;
    MP.state.players[1].team = 0; Radar.S.set.clear(); var b4 = sp(); MP.state.players[1].team = 1; MP.state.mode = 'sandbox'; Radar.S.set.clear();`);
  t('...MPUI.spotted (an air battle\'s tags and scope): an enemy at 4 km by eye; at 12 km not, unless our radar holds it; never while we are destroyed; a team-mate always', X(`[b0, b1, b2, b3, b4].join() === 'true,false,true,false,true'`), X('[b0, b1, b2, b3, b4]'));
  t('...the radar half reads radar.js (no part loop, no numeric radar left on any part)', !/def\.radar\b/.test(msrc) && /Radar\.has\(g\)/.test(msrc));
}

t.done();
