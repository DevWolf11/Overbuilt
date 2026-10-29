// The Ground Battle's rules (js/gmode.js, pure): the arenas and the stock fallback list; the objective at the start
// (three zones, or zone C alone in a duel); capture by one, two and three vehicles and with troops aboard, who may
// capture (ground kinds, slow, on the ground, inside the zone), contested zones frozen, no decay, an enemy zone
// neutral at the middle and taken at the end; the bleed; deaths priced by cost and the aircraft multiplier; the result
// on tickets, wipe-out and time, and the draws; dt clamping; the same battle twice. Then where vehicles start: every
// slot on its pad on level dry ground off the berms, 22 m apart, never inside each other (measured with real vehicles),
// facing the zones as placeOnSurface turns them (as Flight.start does), helicopters beside the pad, planes at the air
// start; the Runway arena without the map; soloPlace.   node test/gmode.test.js
const G = require('./lib/game.js'), fs = require('fs'), path = require('path');
const TANKS = require('./lib/tanks.js');
const t = G.checks('gmode: the Ground Battle rules');
const ctx = G.load({ ground: true });
const R = (c) => G.run(ctx, c);
const GM = ctx.GroundMode, EARTH = ctx.EARTH;
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const J = (o) => JSON.stringify(o);

// ---------------------------------------------------------------- arenas, the stock list
t('arena(): Highland Ridge and the Runway; nothing for an unknown id or an inherited name',
  GM.arena('highland') === EARTH.arenas.highland && GM.arena('runway') === EARTH.arenas.runway &&
  ['nope', '__proto__', 'toString', 'constructor', '', null, undefined, 3].every((k) => GM.arena(k) === null));
t('pick(): Highland Ridge with the map, the Runway without', GM.pick(true) === 'highland' && GM.pick(false) === 'runway');
t('GROUND_STOCK: the three money tiers best first, then the technical; frozen',
  J(ctx.GROUND_STOCK) === J({ 45000: ['tk34', 'ms4', 'pumo'], 75000: ['tk72', 'leapard1', 'tk34'], 120000: ['ma1', 'tk72', 'leapard1'], fallback: 'technical' }) &&
  Object.isFrozen(ctx.GROUND_STOCK) && Object.isFrozen(ctx.GROUND_STOCK[45000]));
t('stock(budget): the dearest tier the money reaches (the cheapest below them all), ending with the technical',
  J(GM.stock(45000)) === J(['tk34', 'ms4', 'pumo', 'technical']) && J(GM.stock(75000)) === J(['tk72', 'leapard1', 'tk34', 'technical']) &&
  J(GM.stock(120000)) === J(['ma1', 'tk72', 'leapard1', 'technical']) && J(GM.stock(100000)) === J(GM.stock(75000)) &&
  J(GM.stock(20000)) === J(GM.stock(45000)) && J(GM.stock(1e9)) === J(GM.stock(120000)) && J(GM.stock('x')) === J(GM.stock(45000)));

// ---------------------------------------------------------------- the objective at the start
const fresh = (fmt = '3v3', sizes = [3, 3], arena = 'highland', tickets) => GM.init(arena, { format: fmt, tickets }, sizes);
{
  const o = fresh();
  t('init: 600 tickets each, zones A, B and C (55 m) neutral, the team sizes, nothing bled',
    J(o) === J({ arena: 'highland', tk: [600, 600], zones: [
      { id: 'A', name: 'Hilltop', e: 17050, z: 15000, r: 55, own: -1, p: 0 }, { id: 'B', name: 'East', e: 18450, z: 15000, r: 55, own: -1, p: 0 },
      { id: 'C', name: 'Slope', e: 17750, z: 15000, r: 55, own: -1, p: 0 }], sizes: [3, 3], bleed: [0, 0] }), o);
  t('init: the objective is plain data (it rides in MP.state) and shares nothing with EARTH.arenas',
    J(JSON.parse(J(o))) === J(o) && o.zones.every((zn, i) => zn !== EARTH.arenas.highland.zones[i]));
  t('init: the tickets setting (400, 900, the Practice Battle\'s 300); a forged or missing one gives 600',
    [400, 900, 300].every((n) => J(fresh('2v2', [2, 2], 'highland', n).tk) === J([n, n])) &&
    ['x', -5, 0, NaN, Infinity, null, undefined, {}].every((n) => J(fresh('2v2', [2, 2], 'highland', n).tk) === J([600, 600])));
  const d = fresh('1v1', [1, 1]);
  t('init: a 1v1 is fought over zone C alone, 70 m wide', d.zones.length === 1 && d.zones[0].id === 'C' && d.zones[0].r === 70, d.zones);
  t('init: so is a bigger format with one player a side (2v2, one each), but not one with two on a side',
    J(fresh('2v2', [1, 1]).zones) === J(d.zones) && J(fresh('2v2', [1, 0]).zones) === J(d.zones) && fresh('2v2', [2, 1]).zones.length === 3);
  t('init: the Runway arena: zones West, East and Centre (45 m) on the runway; its duel is over Centre at 45 m',
    J(fresh('3v3', [3, 3], 'runway').zones.map((zn) => [zn.id, zn.e, zn.z, zn.r])) === J([['A', 1250, 0, 45], ['B', 2150, 0, 45], ['C', 1700, 0, 45]]) &&
    J(fresh('1v1', [1, 1], 'runway').zones.map((zn) => [zn.id, zn.r])) === J([['C', 45]]));
  t('init: an arena given as its EARTH.arenas entry is stored by id; an unknown one falls back to the Runway (no map needed)',
    GM.init(EARTH.arenas.highland, {}, [2, 2]).arena === 'highland' && GM.init('moon', {}, [2, 2]).arena === 'runway' && GM.init(null, null).arena === 'runway');
  t('init: without team sizes, both teams count as started', J(GM.init('highland', { format: '2v2' }).sizes) === J([1, 1]) && GM.init('highland', { format: '2v2' }).zones.length === 3);
}

// ---------------------------------------------------------------- capture
const Z = (o, id) => o.zones.find((zn) => zn.id === id);
const unit = (team, zn, more = {}) => ({ team, e: zn ? zn.e : 0, z: zn ? zn.z : 0, kind: 'tank', speed: 3, gd: 1, troops: 0, ...more });
// tick at 4 Hz (the host's 250 ms) until the zone's own changes to `team`; the seconds it took and the events
const until = (o, id, units, team, max = 120, M = GM) => {
  const ev = [];
  for (let i = 1; i <= max * 4; i++) { ev.push(...M.tick(o, 0.25, units)); if (Z(o, id).own === team) return { s: i * 0.25, ev }; }
  return { s: Infinity, ev };
};
{
  const o = fresh(), C = Z(o, 'C');
  const r = until(o, 'C', [unit(1, C)], 1);
  t('one vehicle takes a neutral zone in 20 s', r.s === 20, r.s);
  t('the event: { k: cap, zone, team, by: the capturing units } and nothing else', J(r.ev) === J([{ k: 'cap', zone: 'C', team: 1, by: [0] }]), r.ev);
  t('team 1 fills the bar to +1, team 0 to -1', C.p === 1 && (() => { const o2 = fresh(); until(o2, 'A', [unit(0, Z(o2, 'A'))], 0); return Z(o2, 'A').p === -1 && Z(o2, 'A').own === 0; })());
  const half = fresh(), hC = Z(half, 'C');
  for (let i = 0; i < 40; i++) GM.tick(half, 0.25, [unit(0, hC)]);
  t('halfway after 10 s, still neutral', near(hC.p, -0.5) && hC.own === -1, hC);
}
for (const [n, s, why] of [[2, 20 / 1.5, 'two vehicles: x1.5'], [3, 20 / 1.8, 'three vehicles: x1.8'], [5, 20 / 1.8, 'five vehicles: still x1.8']]) {
  const o = fresh(), C = Z(o, 'C'), us = Array.from({ length: n }, (_, i) => unit(0, C, { e: C.e + i * 4 }));
  const r = until(o, 'C', us, 0);
  t(`${why}: a neutral zone in ${s.toFixed(2)} s (the next 250 ms tick)`, r.s >= s && r.s < s + 0.25 + 1e-9 && J(r.ev[0].by) === J(us.map((_, i) => i)), r.s);
}
for (const [us, s, why] of [[[unit(1, null, { troops: 4 })], 20 / 1.5, 'one vehicle with living troops: x1.5'],
  [[unit(1, null, { troops: 4 }), unit(1, null), unit(1, null)], 20 / 2.7, 'three vehicles, one with troops: x1.8 x1.5'],
  [[unit(1, null, { troops: 0 })], 20, 'troops 0 (all dead): no bonus'],
  [[unit(1, null), unit(1, null, { troops: 6, speed: 45 })], 20, 'troops aboard a vehicle that isn\'t capturing (too fast): no bonus, and it doesn\'t count']]) {
  const o = fresh(), C = Z(o, 'C');
  for (const u of us) { u.e = C.e; u.z = C.z; }
  const r = until(o, 'C', us, 1);
  t(`${why}: ${s.toFixed(2)} s`, r.s >= s && r.s < s + 0.25 + 1e-9, r.s);
}
{
  const o = fresh(), C = Z(o, 'C');
  until(o, 'C', [unit(0, C)], 0);
  const r = until(o, 'C', [unit(1, C)], 1);
  t('an enemy zone: neutral when the bar passes the middle (20 s), then taken at the end (40 s)',
    r.s === 40 && J(r.ev) === J([{ k: 'lost', zone: 'C', team: 0 }, { k: 'cap', zone: 'C', team: 1, by: [0] }]), r);
  const o2 = fresh(), C2 = Z(o2, 'C');
  until(o2, 'C', [unit(0, C2)], 0);
  for (let i = 0; i < 79; i++) GM.tick(o2, 0.25, [unit(1, C2)]);
  t('19.75 s into retaking it, it is still the holder\'s', C2.own === 0 && C2.p < 0, C2);
  const ev = GM.tick(o2, 0.25, [unit(1, C2)]);
  t('at 20 s it is neutral (lost), at p = 0', C2.own === -1 && C2.p === 0 && J(ev) === J([{ k: 'lost', zone: 'C', team: 0 }]), [C2, ev]);
  const o3 = fresh(), C3 = Z(o3, 'C');
  until(o3, 'C', [unit(0, C3)], 0);
  for (let i = 0; i < 40; i++) GM.tick(o3, 0.25, [unit(1, C3)]);
  const back = [], mid = C3.p;
  for (let i = 0; i < 39; i++) back.push(...GM.tick(o3, 0.25, [unit(0, C3)]));
  const p39 = C3.p;
  back.push(...GM.tick(o3, 0.25, [unit(0, C3)]));
  t('the holder driving back in pushes the bar back home (10 s from halfway), with no event: it never lost it',
    near(mid, -0.5) && p39 > -1 && C3.p === -1 && C3.own === 0 && back.length === 0, [mid, p39, C3, back]);
}
{
  const o = fresh(), C = Z(o, 'C');
  for (let i = 0; i < 40; i++) GM.tick(o, 0.25, [unit(1, C)]);
  const p = C.p;
  for (let i = 0; i < 240; i++) GM.tick(o, 0.25, []);
  t('no decay: a half-taken zone left empty for a minute stays half taken', C.p === p && near(p, 0.5) && C.own === -1, C);
  for (let i = 0; i < 120; i++) GM.tick(o, 0.25, [unit(1, C), unit(0, C)]);
  t('contested: both teams inside freeze it (30 s)', C.p === p && C.own === -1, C);
  for (let i = 0; i < 120; i++) GM.tick(o, 0.25, [unit(1, C), unit(1, C), unit(1, C), unit(0, C)]);
  t('contested three against one: still frozen', C.p === p, C);
  const r = until(o, 'C', [unit(1, C)], 1);
  t('the one left alone carries on from where it was (10 s more)', r.s === 10, r.s);
}
{
  const o = fresh(), A = Z(o, 'A'), B = Z(o, 'B'), C = Z(o, 'C');
  for (let i = 0; i < 80; i++) GM.tick(o, 0.25, [unit(0, A), unit(1, B)]);
  t('zones are taken independently: team 0 holds A, team 1 holds B, C untouched', A.own === 0 && B.own === 1 && C.own === -1 && C.p === 0, o.zones);
}
// who may capture
{
  const C = EARTH.arenas.highland.zones[2];
  const rate = (u) => { const o = fresh(); GM.tick(o, 1, [u]); return Z(o, 'C').p; };
  const ok = (u) => rate(u) !== 0;
  t('a tank and a car capture', ok(unit(0, C)) && ok(unit(1, C, { kind: 'car' })));
  t('helicopters, planes, rockets and unknown kinds don\'t', ['heli', 'plane', 'rocket', 'boat', undefined].every((k) => !ok(unit(0, C, { kind: k }))));
  t('under 30 m/s only (29.9 does, 30 doesn\'t; speed is a magnitude); a missing or forged speed doesn\'t',
    ok(unit(0, C, { speed: 29.9 })) && !ok(unit(0, C, { speed: 30 })) && ok(unit(0, C, { speed: -10 })) && !ok(unit(0, C, { speed: -30 })) &&
    [undefined, NaN, Infinity, 'fast', null].every((s) => !ok(unit(0, C, { speed: s }))));
  t('on the ground only (gd)', !ok(unit(0, C, { gd: 0 })) && !ok(unit(0, C, { gd: false })) && !ok(unit(0, C, { gd: undefined })) && ok(unit(0, C, { gd: true })));
  t('inside the zone only: 54.9 m from its centre does, 55.1 m doesn\'t (and the zone of a duel is 70 m)',
    ok(unit(0, C, { e: C.e + 54.9 })) && !ok(unit(0, C, { e: C.e + 55.1 })) && ok(unit(0, C, { z: C.z - 38.8, e: C.e + 38.8 })) &&
    (() => { const o = fresh('1v1', [1, 1]); GM.tick(o, 1, [unit(0, C, { z: C.z + 69 })]); return Z(o, 'C').p < 0; })());
  t('only teams 0 and 1; a unit with no place is ignored', [2, -1, undefined, '0'].every((tm) => !ok(unit(tm, C))) &&
    [[NaN, C.z], [C.e, Infinity], [undefined, C.z]].every(([e, z]) => !ok(unit(0, C, { e, z }))));
  t('inZone: on the edge counts; across the ground (e, z) only; nothing for no zone or no place',
    GM.inZone(C.e + 55, C.z, C) && GM.inZone(C.e + 33, C.z + 44, C) && !GM.inZone(C.e + 33.1, C.z + 44, C) && !GM.inZone(C.e, C.z, null) && !GM.inZone(NaN, C.z, C));
  t('tick survives junk: no objective, no units, null units in the list', J(GM.tick(null, 1, [])) === '[]' && J(GM.tick({}, 1, [])) === '[]' &&
    (() => { const o = fresh(); return J(GM.tick(o, 1, null)) === '[]' && J(GM.tick(o, 1, [null, 5, 'x', unit(0, C)])) === '[]' && Z(o, 'C').p === -0.05; })());
}
// dt
{
  const C = EARTH.arenas.highland.zones[2];
  const after = (dt) => { const o = fresh(); GM.tick(o, dt, [unit(1, C)]); return Z(o, 'C').p; };
  t('dt is clamped to 1 s: a 5 s stall moves the bar as 1 s does', after(5) === after(1) && near(after(1), 0.05) && after(1e9) === after(1), [after(5), after(1)]);
  t('dt of 0, negative or not a number does nothing', [0, -1, NaN, undefined, 'x'].every((dt) => after(dt) === 0));
  const o = fresh();
  Object.assign(Z(o, 'A'), { own: 1, p: 1 });
  GM.tick(o, 5, []);
  t('the bleed is clamped too: a 5 s stall costs one second\'s tickets', J(o.tk) === J([599, 600]), o.tk);
}

// ---------------------------------------------------------------- the bleed
{
  const o = fresh();
  Object.assign(Z(o, 'A'), { own: 1, p: 1 }); Object.assign(Z(o, 'B'), { own: 1, p: 1 }); Object.assign(Z(o, 'C'), { own: 0, p: -1 });
  const seen = [];
  for (let i = 0; i < 40; i++) { GM.tick(o, 0.25, []); seen.push(o.tk[0]); }
  t('two zones against one: the team behind bleeds a ticket a second, the one ahead nothing', J(o.tk) === J([590, 600]), o.tk);
  t('tickets stay whole: one gone every fourth 250 ms tick', seen.slice(0, 8).join() === '600,600,600,599,599,599,599,598' && seen.every(Number.isInteger), seen.slice(0, 8));
  const o3 = fresh();
  for (const zn of o3.zones) Object.assign(zn, { own: 0, p: -1 });
  for (let i = 0; i < 40; i++) GM.tick(o3, 0.25, []);
  t('all three zones: three tickets a second', J(o3.tk) === J([600, 570]), o3.tk);
  const oe = fresh();
  Object.assign(Z(oe, 'A'), { own: 1, p: 1 }); Object.assign(Z(oe, 'B'), { own: 0, p: -1 });
  for (let i = 0; i < 40; i++) GM.tick(oe, 0.25, []);
  t('one zone each: nobody bleeds; none held: nobody bleeds', J(oe.tk) === J([600, 600]) && (() => { const n = fresh(); for (let i = 0; i < 40; i++) GM.tick(n, 0.25, []); return J(n.tk) === '[600,600]'; })());
  const od = fresh('1v1', [1, 1]);
  od.zones[0].own = 1; od.zones[0].p = 1; od.tk[0] = 5;
  for (let i = 0; i < 40; i++) GM.tick(od, 0.25, []);
  t('a duel: holding C drains the other side a ticket a second, never below 0', J(od.tk) === J([0, 600]), od.tk);
  // a battle as it goes: team 0 takes C (20 s) while team 1 takes A and B (13.5 s each, two vehicles), then they sit
  const ob = fresh();
  const us = [unit(0, Z(ob, 'C')), unit(1, Z(ob, 'A')), unit(1, Z(ob, 'A')), unit(1, Z(ob, 'B')), unit(1, Z(ob, 'B'))];
  for (let i = 0; i < 4 * 60; i++) GM.tick(ob, 0.25, us);
  t('a minute in: team 1 took A and B at 13.5 s, team 0 took C at 20 s and has bled 1 a second for 40 s (6.5 s at 2 a second before)',
    J(ob.tk) === J([600 - 13 - 40, 600]) && ob.zones.map((zn) => zn.own).join() === '1,1,0', ob.tk);
}

// ---------------------------------------------------------------- deaths
{
  const lose = (cost, air) => { const o = fresh(); const n = GM.death(o, 1, cost, air); return [n, o.tk[1], o.tk[0]]; };
  t('a knock-out costs 30 + round(cost / 2500) tickets: $0 30, $45k 48, $75k 60, $120k 78',
    J([0, 45000, 75000, 120000].map((c) => lose(c)[0])) === J([30, 48, 60, 78]) && J(lose(75000)) === J([60, 540, 600]));
  t('rounded to the nearest: $1,249 costs 30, $1,250 costs 31', lose(1249)[0] === 30 && lose(1250)[0] === 31);
  t('an aircraft costs half as much again (rounded): a $120k plane 117, a $45k one 72; air may be the kind (plane, heli) too',
    lose(120000, true)[0] === 117 && lose(45000, true)[0] === 72 && lose(45000, 'heli')[0] === 72 && lose(45000, 'plane')[0] === 72 && lose(1250, 1)[0] === 47 &&
    lose(45000, 'tank')[0] === 48 && lose(45000, false)[0] === 48);
  t('a forged cost: not a number or negative counts as $0, a huge one is capped at $10M',
    [NaN, -5e5, 'x', undefined, Infinity].every((c) => lose(c)[0] === 30) && lose(1e12)[0] === 30 + 4000);
  const o = fresh('3v3', [3, 3], 'highland', 100);
  const n = [GM.death(o, 0, 120000), GM.death(o, 0, 120000)];
  t('tickets never go below 0; the price is still the full one', J(n) === J([78, 78]) && J(o.tk) === J([0, 100]), [n, o.tk]);
  t('no such team: nothing happens', [2, -1, undefined, '1'].every((tm) => { const q = fresh(); return GM.death(q, tm, 5e4) === 0 && J(q.tk) === '[600,600]'; }) && GM.death(null, 0, 5e4) === 0);
}

// ---------------------------------------------------------------- the result
{
  const res = (tk, timeUp, alive, sizes = [3, 3]) => { const o = fresh('3v3', sizes); o.tk = tk; return GM.result(o, timeUp, alive); };
  t('it goes on while both teams have tickets', res([600, 600]) === null && res([1, 1], false, [1, 1]) === null);
  t('a team out of tickets loses (tickets), time up or not', J(res([12, 0])) === J({ winner: 0, why: 'tickets' }) && J(res([0, 12], true)) === J({ winner: 1, why: 'tickets' }));
  t('both out of tickets at once: a draw', J(res([0, 0])) === J({ winner: null, why: 'draw' }));
  t('time up: more tickets wins (time); equal tickets is a draw', J(res([212, 100], true)) === J({ winner: 0, why: 'time' }) &&
    J(res([99, 100], true)) === J({ winner: 1, why: 'time' }) && J(res([300, 300], true)) === J({ winner: null, why: 'draw' }));
  t('wiped: a team with nobody left in the fight loses (counts or booleans)', J(res([600, 600], false, [2, 0])) === J({ winner: 0, why: 'wiped' }) &&
    J(res([600, 600], false, [0, 1])) === J({ winner: 1, why: 'wiped' }) && J(res([600, 600], false, [true, false])) === J({ winner: 0, why: 'wiped' }));
  t('wiped: both at once is a draw; no alive list, no wipe-out', J(res([600, 600], false, [0, 0])) === J({ winner: null, why: 'draw' }) && res([600, 600], false) === null);
  t('wiped: a team that started with nobody can\'t be wiped out (a room with one side), but the lone side running out ends it as a draw',
    res([600, 600], false, [2, 0], [2, 0]) === null && J(res([600, 600], false, [0, 0], [2, 0])) === J({ winner: null, why: 'draw' }));
  t('tickets come first, then the wipe-out, then the time', J(res([0, 600], true, [3, 0])) === J({ winner: 1, why: 'tickets' }) &&
    J(res([100, 600], true, [3, 0])) === J({ winner: 0, why: 'wiped' }));
  t('no objective: no result', GM.result(null, true) === null && GM.result({}, true) === null);
  // knock-outs to the end
  const o = fresh('2v2', [2, 2], 'highland', 400);
  let k = 0;
  while (!GM.result(o, false)) { GM.death(o, k % 3 ? 1 : 0, 75000, k % 4 === 0); k++; }
  t('knock-outs priced by cost run a team out of tickets: the other wins', J(GM.result(o, false)) === J({ winner: 0, why: 'tickets' }) && o.tk[1] === 0 && o.tk[0] > 0, [k, o.tk]);
}

// ---------------------------------------------------------------- deterministic
{
  const play = () => {
    const o = fresh(), out = [];
    for (let i = 0; i < 4 * 90; i++) {
      const s = i * 0.25, us = [unit(0, Z(o, i < 200 ? 'A' : 'C'), { speed: s % 7 }), unit(1, Z(o, 'A'), { troops: i % 50 < 25 ? 2 : 0 }), unit(1, Z(o, 'B'), { gd: i % 9 ? 1 : 0 })];
      out.push(...GM.tick(o, 0.25 + (i % 3) * 0.01, us));
      if (i % 60 === 7) GM.death(o, i % 2, 1000 * i, i % 3 === 0);
    }
    return J([o, out]);
  };
  const a = play();
  t('the same battle twice gives the same objective and events', a === play() && a.includes('"cap"'));
  const code = fs.readFileSync(path.join(G.ROOT, 'js', 'gmode.js'), 'utf8').replace(/\/\/.*$/gm, '');
  t('gmode.js (its code, not its comments) has no Math.random, no DOM and no Flight', !/Math\.random|document\.|window\.|\bFlight\b|\bDate\b/.test(code));
}

// ---------------------------------------------------------------- placement
// A vehicle placed as Flight.start places it (placeOnSurface with the kind's launch rotation, the place's z and yaw),
// and where its nose points across the ground (e, z): east is the way of decreasing angle, z is the depth.
R(`var placed = (rows, kind, P) => { const ps = partsFromDesign(rows), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = kind; v.rebuildGroups();
    v.placeOnSurface(EARTH, siteAngle(EARTH, P.e), VEHICLE_KINDS[kind].launchRot, P.z, P.yaw || 0); return v; };
  var eOf = (a) => -wrapAngle(a - EARTH.padAngle) * EARTH.radius;
  var where = (v) => { const L = Terrain.locate(EARTH, v.x, v.y, v.z, {}); return { e: eOf(L.a), z: L.z }; };
  var heading = (v, f) => { const a = where(v), w = v.axis(f.x, f.y, f.z), k = 50, L = Terrain.locate(EARTH, v.x + w.x * k, v.y + w.y * k, v.z + w.z * k, {});
    const de = eOf(L.a) - a.e, dz = L.z - a.z, d = Math.hypot(de, dz); return { e: de / d, z: dz / d }; };`);
ctx.__rows = { tk34: TANKS.tk34, ma1: TANKS.ma1, pumo: TANKS.pumo, buggy: G.templateRows(ctx, 'buggy'), dragonfly: G.templateRows(ctx, 'dragonfly'),
  hummingbird: G.templateRows(ctx, 'hummingbird'), jumbo: G.templateRows(ctx, 'jumbo'), fs16: G.templateRows(ctx, 'fs16') };
const KINDS = { tk34: 'tank', ma1: 'tank', pumo: 'tank', buggy: 'car', dragonfly: 'heli', hummingbird: 'heli', jumbo: 'plane', fs16: 'plane' };
// how far each vehicle reaches across the ground from its centre (its parts' and wheels' farthest point)
const reach = {};
for (const k in KINDS) reach[k] = R(`(() => { const ps = partsFromDesign(__rows.${k}), v = new Vessel(ps, buildAdjacency(ps), EARTH); v.kind = '${KINDS[k]}'; v.rebuildGroups(); return v.reach; })()`);
const groundReach = Math.max(reach.tk34, reach.ma1, reach.pumo, reach.buggy), heliReach = Math.max(reach.dragonfly, reach.hummingbird);
t('the vehicles measured: tanks, an 8x8 and a buggy reach under 9 m, helicopters under 11 m, the jumbo under 40 m',
  groundReach > 3 && groundReach < 9 && heliReach > 4 && heliReach < 11 && reach.jumbo < 40, reach);

// ground under a spot: level (the heights over the vehicle's footprint within 2 cm), dry and off the berms
const ground = (c, P, rad) => G.run(c, `(() => { const P = ${J(P)}, H = []; let wet = false, berm = 0;
  for (let i = -${rad}; i <= ${rad}; i += 2) for (let j = -${rad}; j <= ${rad}; j += 2) { const e = P.e + i, z = P.z + j, a = siteAngle(EARTH, e);
    H.push(Terrain.surfaceAt(EARTH, a, z)); wet = wet || Terrain.waterAt(EARTH, a, z); berm = Math.max(berm, Terrain.bermAt(e, z)); }
  return { lo: Math.min(...H), hi: Math.max(...H), wet, berm }; })()`);
const facing = (P, zones) => { // the yaw's way across the ground against the way to the zones' middle
  const me = zones.reduce((s, zn) => s + zn.e, 0) / zones.length, mz = zones.reduce((s, zn) => s + zn.z, 0) / zones.length;
  const d = Math.hypot(me - P.e, mz - P.z);
  return Math.cos(P.yaw) * (me - P.e) / d - Math.sin(P.yaw) * (mz - P.z) / d;
};
const dist = (a, b) => Math.hypot(a.e - b.e, a.z - b.z);
const padFrame = (f, P) => { const c = Math.cos(f.yaw), s = -Math.sin(f.yaw), de = P.e - f.e, dz = P.z - f.z; return { u: de * c + dz * s, v: -de * s + dz * c }; };
const placementChecks = (c, arenaId, label) => {
  const A = c.EARTH.arenas[arenaId], M = c.GroundMode;
  for (const team of [0, 1]) {
    const f = A.pads[team], name = `${label}, team ${team} (${f.name})`;
    const slots = Array.from({ length: 12 }, (_, k) => M.placement(arenaId, team, k, 'tank'));
    const cap = slots.findIndex((P, k) => k > 0 && P.e === slots[0].e && P.z === slots[0].z);
    const own = slots.slice(0, cap);
    t(`${name}: the pad's first spot at its centre, then +22 m and -22 m abreast; ${cap} spots before it starts again`,
      cap >= 6 && near(dist(slots[0], f), 0, 1e-6) && near(padFrame(f, slots[1]).v, 22, 1e-6) && near(padFrame(f, slots[2]).v, -22, 1e-6) &&
      near(padFrame(f, slots[1]).u, 0, 1e-6) && J(slots[cap]) === J(slots[0]), own.map((P) => padFrame(f, P)).map((q) => [+q.u.toFixed(2), +q.v.toFixed(2)]));
    t(`${name}: every spot on the pad (its ${2 * f.hl} x ${2 * f.hw} m), the vehicle's footprint inside it`,
      own.every((P) => { const q = padFrame(f, P); return Math.abs(q.u) + 5 <= f.hl && Math.abs(q.v) + 2.5 <= f.hw; }));
    const g = own.map((P) => ground(c, P, 6));
    t(`${name}: on level dry ground off the berms (heights within 2 cm over 12 x 12 m, no water, bermAt 0)`,
      g.every((q) => q.hi - q.lo < 0.02 && !q.wet && q.berm === 0), g.map((q) => +(q.hi - q.lo).toFixed(3)));
    let apart = Infinity;
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) apart = Math.min(apart, dist(own[i], own[j]));
    t(`${name}: 22 m apart at the closest, so never inside each other (2 x ${groundReach.toFixed(1)} m reach)`, near(apart, 22, 1e-6) && apart > 2 * groundReach, apart);
    t(`${name}: all facing the pad's way, towards the zones`, own.every((P) => P.yaw === f.yaw && facing(P, A.zones) > 0.99), own.map((P) => facing(P, A.zones)));
    t(`${name}: a car, a rocket or an unknown kind lines up the same way`, ['car', 'rocket', undefined].every((k) => J(M.placement(arenaId, team, 2, k)) === J(slots[2])));
    t(`${name}: a slot that isn't a whole number from 0 is the first spot or rounded down`,
      [-1, NaN, 'x', undefined, null].every((k) => J(M.placement(arenaId, team, k, 'tank')) === J(slots[0])) && J(M.placement(arenaId, team, 2.7, 'tank')) === J(slots[2]));
    // helicopters
    const hs = Array.from({ length: 4 }, (_, k) => M.placement(arenaId, team, k, 'heli'));
    const hg = hs.map((P) => ground(c, P, 8));
    let hApart = Infinity, hTank = Infinity;
    for (let i = 0; i < hs.length; i++) { for (let j = i + 1; j < hs.length; j++) hApart = Math.min(hApart, dist(hs[i], hs[j])); for (const P of own) hTank = Math.min(hTank, dist(hs[i], P)); }
    t(`${name}: helicopters 60 m from the pad's centre (${f.hw >= 75 ? 'beside it' : 'behind it, the pad being narrow'}), on level dry ground off the berms`,
      near(dist(hs[0], f), 60, 1e-6) && hg.every((q) => q.hi - q.lo < 0.02 && !q.wet && q.berm === 0), hs.map((P) => padFrame(f, P)));
    t(`${name}: helicopters clear of each other (${hApart.toFixed(0)} m) and of every vehicle spot (${hTank.toFixed(1)} m)`,
      hApart > 2 * heliReach + 2 && hTank > heliReach + groundReach + 2 && J(M.placement(arenaId, team, 4, 'heli')) === J(hs[0]) && hs.every((P) => P.yaw === f.yaw));
    // planes
    const ps = Array.from({ length: 8 }, (_, k) => M.placement(arenaId, team, k, 'plane'));
    const S = A.air && A.air[team];
    let pApart = Infinity;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) pApart = Math.min(pApart, dist(ps[i], ps[j]));
    t(`${name}: planes ${S ? 'at the air start' : '2 km behind the pad (no air start)'}, 1,000 m up at 140 m/s, facing the zones, 80 m apart abreast`,
      ps.every((P) => P.air && P.air.alt === 1000 && P.air.speed === 140 && facing(P, A.zones) > 0.99) && near(pApart, 80, 1e-6) && pApart > 2 * reach.jumbo &&
      (S ? near(dist(ps[0], S), 0, 1e-6) && ps[0].yaw === S.yaw : near(padFrame(f, ps[0]).u, -2000, 1e-6) && ps[0].yaw === f.yaw),
      [ps[0], S]);
  }
  t(`${label}: the two pads' spots are far apart`, dist(M.placement(arenaId, 0, 0, 'tank'), M.placement(arenaId, 1, 0, 'tank')) > 1000);
  t(`${label}: a team other than 1 is team 0's; no such arena: null`, J(M.placement(arenaId, 7, 1, 'tank')) === J(M.placement(arenaId, 0, 1, 'tank')) &&
    M.placement('moon', 0, 0, 'tank') === null && M.placement(undefined, 1, 0, 'heli') === null);
};
placementChecks(ctx, 'highland', 'Highland Ridge');

// placed as Flight.start does: real vehicles face the zones and sit on the pad
{
  const A = EARTH.arenas.highland;
  for (const team of [0, 1]) {
    const res = {};
    for (const k of ['tk34', 'pumo', 'buggy', 'dragonfly', 'fs16']) {
      ctx.__P = GM.placement('highland', team, 1, KINDS[k]);
      res[k] = R(`(() => { const v = placed(__rows.${k}, '${KINDS[k]}', __P), F = ${KINDS[k] === 'plane' ? 'v.pilot.F' : '{ x: 1, y: 0, z: 0 }'}, h = heading(v, F), w = where(v);
        return { h, w, yawWay: { e: Math.cos(__P.yaw), z: -Math.sin(__P.yaw) } }; })()`);
    }
    const me = A.zones.reduce((s, zn) => s + zn.e, 0) / 3, mz = 15000;
    const towards = (r) => { const d = Math.hypot(me - r.w.e, mz - r.w.z); return (r.h.e * (me - r.w.e) + r.h.z * (mz - r.w.z)) / d; };
    t(`Highland Ridge, team ${team}: a TK-34, a Pumo, a buggy, a helicopter and a plane placed as Flight.start does point their noses at the zones`,
      Object.values(res).every((r) => towards(r) > 0.99 && near(r.h.e, r.yawWay.e, 1e-3) && near(r.h.z, r.yawWay.z, 1e-3)), Object.fromEntries(Object.entries(res).map(([k, r]) => [k, +towards(r).toFixed(4)])));
    const P = GM.placement('highland', team, 1, 'tank');
    t(`Highland Ridge, team ${team}: and stand where placement put them (within 5 cm)`, near(res.tk34.w.e, P.e, 0.05) && near(res.tk34.w.z, P.z, 0.05), [res.tk34.w, P]);
  }
  // the air start as Flight.start makes it: raised 1,000 m and flying along the nose
  ctx.__P = GM.placement('highland', 1, 0, 'plane');
  const air = R(`(() => { const v = placed(__rows.fs16, 'plane', __P), r = v.radius(), up = __P.air.alt, sp = __P.air.speed, f = v.axis(v.pilot.F.x, v.pilot.F.y, v.pilot.F.z);
    v.x += (v.x / r) * up; v.y += (v.y / r) * up; v.z += (v.z / r) * up; v.vx = f.x * sp; v.vy = f.y * sp; v.vz = f.z * sp;
    const L = Terrain.locate(EARTH, v.x, v.y, v.z, {}), agl = L.r - EARTH.radius - Terrain.surfaceAt(EARTH, L.a, L.z);
    const L2 = Terrain.locate(EARTH, v.x + v.vx, v.y + v.vy, v.z + v.vz, {});
    return { agl, dz: L2.z - L.z, de: eOf(L2.a) - eOf(L.a), spd: Math.hypot(v.vx, v.vy, v.vz) }; })()`);
  t('Highland Ridge: team 1\'s plane, started as Flight.start does, is about 1,000 m over the ground flying north (towards the zones) at 140 m/s',
    air.agl > 999 && air.agl < 1010 && air.dz < -139 && Math.abs(air.de) < 1 && near(air.spd, 140, 1e-6), air);
}

// ---------------------------------------------------------------- without the map: the Runway arena, soloPlace
{
  const nm = G.load({ ground: true, earth: false }), M = nm.GroundMode;
  t('without the map: Terrain.earthMap is not ready and pick() gives the Runway', nm.Terrain.earthMap.state !== 'ready' && !nm.EARTH.mapped && M.pick(nm.Terrain.earthMap.state === 'ready') === 'runway');
  placementChecks(nm, 'runway', 'Runway arena (no map)');
  t('Runway arena: team 0 faces east from the west end, team 1 west from the east end, short of the zones',
    M.placement('runway', 0, 0, 'tank').yaw === 0 && M.placement('runway', 1, 0, 'tank').yaw === Math.PI &&
    [0, 1, 2, 3, 4, 5].every((k) => M.placement('runway', 0, k, 'tank').e < 1250 - 45 && M.placement('runway', 1, k, 'tank').e > 2150 + 45));
  t('Runway arena: every vehicle spot on the paved strip (700-2,700 m) and within 25 m of its middle', [0, 1].every((tm) => [0, 1, 2, 3, 4, 5].every((k) => {
    const P = M.placement('runway', tm, k, 'tank'); return P.e > 700 && P.e < 2700 && Math.abs(P.z) <= 22 + 1e-9; })));
  const o = M.init(M.pick(false), { format: '2v2' }, [2, 2]);
  const r = until(o, 'B', [unit(1, Z(o, 'B'))], 1, 120, M);
  t('Runway arena: a battle there runs the same rules (zone B taken in 20 s)', o.arena === 'runway' && r.s === 20 && M === nm.GroundMode, r.s);
  nm.App = { use3D: () => true };
  t('soloPlace: none without the map, even in 3D', M.soloPlace('tank') === null);
  delete nm.App;
}
{
  t('soloPlace: none headless (no App) and none for the old kinds', !('App' in ctx) && GM.soloPlace('tank') === null && ['rocket', 'plane', 'car', 'heli'].every((k) => GM.soloPlace(k) === null));
  ctx.App = { use3D: () => false };
  const flat = GM.soloPlace('tank');
  ctx.App = { use3D: () => true };
  const P = GM.soloPlace('tank'), others = ['rocket', 'plane', 'car', 'heli'].map((k) => GM.soloPlace(k));
  delete ctx.App;
  t('soloPlace: none in the 2D view (it can\'t show Highland Ridge)', flat === null);
  t('soloPlace: with the map and the 3D view, Armour starts at the north pad\'s centre facing the zones; other kinds still at their own sites',
    J(P) === J(GM.placement('highland', 0, 0, 'tank')) && P.e === 17750 && P.z === 13800 && P.yaw === -Math.PI / 2 && others.every((x) => x === null), P);
}
t.done();
