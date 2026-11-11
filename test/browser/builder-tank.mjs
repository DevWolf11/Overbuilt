// Building armour on a phone: six taps make a working tank (hull, track, engine, ring, turret, gun), each part
// where it goes; the kind strip fits at every size; the stats and warnings speak tank; the armour stepper dials a
// plate's thickness, which costs mass and money and survives saving, a design code and a reload; plates go flush on a
// face; parts pair up across the hull; X-ray, the armour view, the arcs and the sweep's late answer redraw once.
// From the build screen as a new player first meets it (the stock Hopper), Armour starts an empty design. (The big
// update) the Drone kind: the six-button strip, a quad by six taps, its stats rows and warnings, the tray's and the part
// panel's words, the scale; a tank's drone bay and its picker (#pi-dock), what the bays carry in the stats and warnings.
//   node test/browser/builder-tank.mjs        (screenshots: SHOTS=<dir>, default test/.cache/shots/)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = (process.env.SHOTS || path.join(ROOT, 'test', '.cache', 'shots')) + path.sep;
fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch();
const errs = [];
const phone = async (w = 390, h = 844, settings = {}) => {
  const page = await (await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage();
  watch(page, errs, `${w}x${h} `);
  await openGame(page, srv.url, { build3d: false, ...settings });
  await page.evaluate(() => App.toBuild());
  await page.waitForTimeout(300);
  return page;
};
const ok = checks('builder: armour on a phone');
const frames = (page, n) => page.evaluate((n) => new Promise((ok) => { let i = 0; const f = () => (++i >= n ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// Gear, Armour and Aim tell the builder a design's numbers (Phase 2's real ones: none of them may answer null)
const realNumbers = (page) => page.evaluate(() => {
  const missing = [];
  if (Gear.stats([{ ...makePart('hullMedium', 0, 1), def: PARTS.hullMedium }]) == null) missing.push('Gear.stats');
  if (Armour.summary([makePart('hullMedium', 0, 1)]) == null) missing.push('Armour.summary');
  if (Aim.summary([makePart('gun85', 0, 1)]) == null) missing.push('Aim.summary');
  return missing;
});
const SIX = [['Hulls', 'Sloped Medium Hull'], ['Drive', 'Medium Track'], ['Drive', 'Tank Diesel'], ['Turrets', 'Turret Ring'], ['Turrets', 'Cast Turret'], ['Guns', '85 mm Gun']];
// after a tray tap (its part's card up): how many of the design's parts are drawn on the bare blueprint (not under a
// panel), and whether the Select / Grid / Fit buttons cover the stats panel
const inSight = (page) => page.evaluate(() => {
  let vis = 0;
  for (const p of Builder.parts) { const s = Builder.partScreen(p), e = s && document.elementFromPoint(s.x, s.y); if (e && e.tagName === 'CANVAS') vis++; }
  const f = $('.fit-col').getBoundingClientRect(), t = $('#stats').getBoundingClientRect();
  return { n: Builder.parts.length, vis, card: !$('#part-info').hidden, fitOverStats: f.left < t.right && f.right > t.left && f.top < t.bottom && f.bottom > t.top };
});
const tapPart = async (page, tab, name) => {
  await page.locator('#palette-tabs .tab', { hasText: new RegExp(`^${tab}$`) }).tap();
  await page.locator('#palette-items .part-item', { has: page.locator('.part-name', { hasText: new RegExp(`^${name}$`) }) }).tap();
  await frames(page, 2);
};

// ---- 1. six taps make a tank (390 × 844, portrait)
const page = await phone();
const ev = (f, a) => page.evaluate(f, a);
await ev(() => { Builder.parts = []; Builder.selected = null; Builder.changed(); });
await page.locator('#kind-select [data-kind="tank"]').tap();
let r = await ev(() => ({ kind: Builder.kind, tab: Builder.category, launch: $('#btn-launch').disabled, warn: $('#s-warn').textContent, sym: Builder.symmetry }));
ok('Armour opens the tray on Hulls, symmetry on', r.kind === 'tank' && r.tab === 'hulls' && r.sym, JSON.stringify(r));
ok('an empty Armour blueprint asks for a hull and can\'t launch', r.launch && r.warn.includes('Add a hull: it holds the crew.'), r.warn);
await tapPart(page, ...SIX[0]);
r = await ev(() => $('#s-warn').textContent);
ok('a hull alone: tracks, an engine and a gun wanted', r.includes('Add tracks or armoured wheels beside the hull.') && r.includes('Add an engine inside the hull') && r.includes('No gun: it can drive and capture, but not fight.'), r);
for (const t of SIX.slice(1)) await tapPart(page, ...t);
const tank = await ev(() => {
  const P = Builder.parts, of = (t) => P.filter((p) => p.type === t), one = (t) => of(t)[0], byId = new Map(P.map((p) => [p.id, p]));
  const hull = one('hullMedium'), eng = one('engDiesel'), ring = one('ringM'), tur = one('turretCast'), gun = one('gun85'), tr = of('trackMed');
  const clash = []; for (const a of P) for (const c of P) if (a.id < c.id && partsClash(a, c)) clash.push(a.type + '/' + c.type);
  const T = partPt(gun, 0, -gun.def.h / 2 + gun.def.aim.pivot * gun.def.h); // the trunnion
  const g = Builder.tg && Builder.tg[0];
  return {
    n: P.length, types: [...new Set(P.map((p) => p.type))].sort().join(','), joined: Builder.attached.size === P.length, clash,
    tracks: tr.map((p) => +partZ(p).toFixed(3)), twin: tr.length === 2 && tr[0].mirror === tr[1], trackAtt: tr.map((p) => byId.get(p.att) && byId.get(p.att).type),
    engine: { inside: Builder.inArmour(eng), att: byId.get(eng.att) && byId.get(eng.att).type, rear: eng.x < hull.x },
    ring: { onRoof: Math.abs(partRect(ring).b - partRect(hull).t) < 0.02, rot: ring.rot || 0 },
    turret: { onRing: Math.abs(partRect(tur).b - partRect(ring).t) < 0.02, att: byId.get(tur.att) && byId.get(tur.att).type },
    gun: { rot: gun.rot, att: byId.get(gun.att) && byId.get(gun.att).type, face: +(T.x - Builder.frontAt(tur, gun.y)).toFixed(3), breechIn: partPt(gun, 0, -gun.def.h / 2).x < Builder.frontAt(tur, gun.y), forward: gun.x > tur.x },
    group: g ? [g.ring.type, [...g.ids].map((id) => byId.get(id).type).sort().join(',')] : null,
    launch: !$('#btn-launch').disabled, warn: $('#s-warn').textContent,
  };
});
ok('six taps: a hull, two tracks, an engine, a ring, a turret and a gun', tank.n === 7 && tank.types === 'engDiesel,gun85,hullMedium,ringM,trackMed,turretCast', tank.types);
ok('...all joined, nothing clashing', tank.joined && !tank.clash.length, tank.clash.join(' '));
ok('the track came with its twin on the other side, both hanging on the hull', tank.twin && tank.tracks[0] === -tank.tracks[1] && Math.abs(tank.tracks[0]) > 1.1 && tank.trackAtt.every((t) => t === 'hullMedium'), JSON.stringify(tank.tracks));
ok('the engine sits inside the hull, at the back', tank.engine.inside && tank.engine.att === 'hullMedium' && tank.engine.rear, JSON.stringify(tank.engine));
ok('the ring lies flat on the roof, the turret on the ring', tank.ring.onRoof && tank.ring.rot === 0 && tank.turret.onRing && tank.turret.att === 'ringM', JSON.stringify([tank.ring, tank.turret]));
ok('the gun points forward (rot 3) from the turret\'s front, its trunnion in the face and its breech inside', tank.gun.rot === 3 && tank.gun.att === 'turretCast' && Math.abs(tank.gun.face) < 0.01 && tank.gun.breechIn && tank.gun.forward, JSON.stringify(tank.gun));
ok('the ring turns the turret and the gun', tank.group && tank.group[0] === 'ringM' && tank.group[1] === 'gun85,turretCast', JSON.stringify(tank.group));
ok('it can launch, with no warnings', tank.launch && !tank.warn, tank.warn);
r = await inSight(page);
ok('the tank is seen taking shape: after the sixth tap, every part in sight above the gun\'s card', r.card && r.vis === r.n && !r.fitOverStats, r);
await page.screenshot({ path: SHOTS + '2e-phone-six-taps.png' });

// ---- 2. its numbers
const missing = await realNumbers(page);
ok('Gear.stats, Armour.summary and Aim.summary answer for a design', !missing.length, missing.join(', '));
await ev(() => { Builder.changed(); Builder.selected = null; Builder.renderInfo(); });
r = await ev(() => ({
  shown: ['#s-mass', '#s-power-row', '#s-top-row', '#s-front-row'].map((id) => !$(id).closest('[hidden]')),
  hidden: ['#s-thrust-row', '#s-twr-row', '#s-dv-row', '#s-stage-box'].map((id) => $(id).hidden),
  mass: $('#s-mass').textContent, power: $('#s-power').textContent, top: $('#s-top').textContent, front: $('#s-front').textContent, line: $('#s-ground').textContent, lineShown: !$('#s-ground').hidden,
}));
ok('the stats read mass, power, top speed and front (no thrust, T/W, fuel or stages)', r.shown.every(Boolean) && r.hidden.every(Boolean), JSON.stringify(r));
ok('...in tonnes, hp/t, km/h and mm', /^\d+(\.\d+)? t$/.test(r.mass) && /^\d+ hp\/t$/.test(r.power) && /^\d+ km\/h$/.test(r.top) && /^\d+ mm$/.test(r.front), `${r.mass} · ${r.power} · ${r.top} · ${r.front}`);
ok('the line under them: the gun, its shell, reload, turret, elevation, crew, how it drives', r.lineShown && /^85 mm APHE \d+ mm at 1 km · reload 7\.0 s · turret \d+°\/s · gun −5°\/\+22° · crew \d+ · pivots \d+°\/s · climbs \d+° · tips at \d\.\d\d g · \d+ rounds$/.test(r.line), r.line);
await page.screenshot({ path: SHOTS + '2e-phone-stats.png' });
// warnings, one at a time
const warnFor = (rows, kind = 'tank') => ev(([rows, kind]) => {
  Builder.loadDesign({ name: 'w', kind, parts: rows.map(([type, x, y, rot, o]) => ({ type, x, y, flip: x < 0, rot: rot || 0, ...(o || {}) })) });
  return $('#s-warn').textContent;
}, [rows, kind]);
const six = await ev(() => { const P = Builder.parts; return P.map((p) => [p.type, p.x, p.y, p.rot || 0, { z: partZ(p), att: P.findIndex((q) => q.id === p.att) >= 0 ? P.findIndex((q) => q.id === p.att) : undefined }]); });
r = await warnFor(six.filter((q, i) => !(q[0] === 'trackMed' && q[4].z < 0)));
ok('a track on one side only: it drives in circles', r.includes('Tracks on one side only: it will drive in circles.'), r);
r = await warnFor(six.map((q) => (q[0] === 'gun85' ? [q[0], q[1], q[2], 0, q[4]] : q)));
ok('a gun left pointing up is pointed out', r.includes('The 85 mm Gun points up: turn it with R so it points forward.'), r);
r = await warnFor([...six, ['seatGunner', -0.529, 2.3, 0, { att: six.findIndex((q) => q[0] === 'turretCast') }]]);
ok('a placed gunner\'s seat takes over the turret\'s own crew: no loader then', r.includes('No loader: reloads take 50% longer.') && !r.includes('No gunner'), r);
r = await warnFor([...six, ['ammoRack', 0.6, 2.05, 0, { att: six.findIndex((q) => q[0] === 'hullMedium') }]]);
ok('an ammo rack left out in the open is pointed out', r.includes('The Ammo Rack sits outside the hull: one hit can set it off.'), r);
r = await warnFor([...six, ['wheelArm', 0.4, 0.65, 0, { z: 1.85 }]].filter((q) => q[0] !== 'engDiesel'));
ok('no engine: it won\'t move', r.includes('Add an engine inside the hull: without one it won’t move.'), r);
r = await warnFor([['chassis', 0, 1.25], ['cab', -0.4, 2.25], ['carWheel', 1.4, 0.4], ['carWheel', -1.4, 0.4], ['canard', -1.7, 1.25]], 'car');
const carRows = await ev(() => ['#s-thrust-row', '#s-twr-row', '#s-power-row', '#s-ground'].map((id) => $(id).hidden));
ok('a car keeps its stats (no ground line) and is told a wing part stops it driving', carRows.join() === 'false,true,true,true' && r.includes('A wing part (Canard) stops a car driving.'), JSON.stringify([carRows, r]));
await ev((rows) => Builder.loadDesign({ name: 'Six taps', kind: 'tank', parts: rows.map(([type, x, y, rot, o]) => ({ type, x, y, flip: x < 0, rot, ...(o.att >= 0 ? { att: o.att } : {}), ...(Math.abs(o.z) > 1e-3 ? { z: o.z } : {}) })) }), six);

// ---- 3. the armour stepper: thicker plate costs mass and money, and is kept
r = await ev(() => { const h = Builder.parts.find((p) => p.type === 'hullMedium'); Builder.selected = h; Builder.renderInfo(); return { mass: Builder.statsData.mass, cost: Builder.statsData.cost, shown: !$('#pi-armour').hidden, val: $('#pi-mm-val').textContent, faces: $('#pi-mm-faces').textContent }; });
// (3I's balance: the Sloped Medium Hull is 55 mm, its lower plate 61 under the glacis; three taps make it 70)
ok('a hull\'s panel shows its armour, 55 mm, and the faces it makes', r.shown && r.val === '55 mm' && /^Glacis 55 mm at 6\d° → \d+ mm · lower 61 mm at 5\d° → \d+ mm · sides 40 mm · roof 20 mm · rear 41 mm$/.test(r.faces), `${r.val} | ${r.faces}`);
for (let i = 0; i < 3; i++) await page.locator('#btn-mm-up').tap();
const up = await ev(() => { const h = Builder.parts.find((p) => p.type === 'hullMedium'); return { mm: h.mm, mass: Builder.statsData.mass, cost: Builder.statsData.cost, val: $('#pi-mm-val').textContent, want: (armourMassT(h.def, 70) - h.def.mass) * 1000, wantCost: armourCostDelta(h.def, 70), hist: Builder.history.length, faces: $('#pi-mm-faces').textContent }; });
ok('three taps on + : 70 mm', up.mm === 70 && up.val === '70 mm', JSON.stringify(up));
ok('...heavier by its steel and dearer', Math.abs(up.mass - r.mass - up.want) < 1 && up.want > 2000 && up.cost - r.cost === up.wantCost && up.wantCost > 0, `${(up.mass - r.mass).toFixed(0)} kg (want ${up.want.toFixed(0)}), $${up.cost - r.cost}`);
ok('...and the glacis line follows', up.faces.startsWith('Glacis 70 mm at'), up.faces);
// the slider: live while it moves, one undo step when it is let go
r = await ev(() => { const s = $('#pi-mm'), h0 = Builder.history.length; s.value = '100'; s.dispatchEvent(new Event('input')); const mid = Builder.history.length; s.value = '110'; s.dispatchEvent(new Event('input')); s.dispatchEvent(new Event('change')); const h = Builder.parts.find((p) => p.type === 'hullMedium'); return { h0, mid, h1: Builder.history.length, mm: h.mm }; });
ok('the slider dials it live, one undo step when it is let go', r.mm === 110 && r.mid === r.h0 && r.h1 === r.h0 + 1, JSON.stringify(r));
await ev(() => Builder.undo());
r = await ev(() => Builder.parts.find((p) => p.type === 'hullMedium').mm);
ok('...and undo puts the 70 mm back', r === 70, r);
// saved, as a code, and after a reload
r = await ev(() => { const code = Builder.designCode(Builder.serialize()), d = Builder.parseCode(code); return { code: code.slice(0, 5), mm: d.parts.find((q) => q.type === 'hullMedium').mm }; });
ok('the design code carries it (RSS3)', r.code === 'RSS3.' && r.mm === 70, JSON.stringify(r));
await ev(() => Builder.storeDesign('Six taps'));
await page.reload(); await page.waitForTimeout(500);
await ev(() => App.toBuild()); await page.waitForTimeout(300);
r = await ev(() => ({ kind: Builder.kind, mm: (Builder.parts.find((p) => p.type === 'hullMedium') || {}).mm, saved: Builder.designs().find((x) => x.name === 'Six taps'), n: Builder.parts.length }));
ok('after a reload the blueprint and the hangar keep 70 mm', r.kind === 'tank' && r.mm === 70 && r.n === 7 && r.saved && r.saved.parts.find((q) => q.type === 'hullMedium').mm === 70, JSON.stringify({ ...r, saved: !!r.saved }));
const tankRows = await ev(() => designRows(Builder.parts)); // (the six-tap tank with its 70 mm hull)
const hangar = await ev(() => { Builder.openHangar(); const t = [...document.querySelectorAll('.design .template-blurb')].map((e) => e.textContent); UI.closeModal(); return t; });
ok('the hangar files it as Armour', hangar.some((t) => t.startsWith('Armour · 7 parts')), hangar.join(' | '));
// (P4 play-test) building Armour, the hangar's stock vehicles come first, each with its class on its card
r = await ev(() => { Builder.openHangar(); const hs = [...document.querySelectorAll('#modal-card h3.summary-h')].map((h) => h.textContent), cards = {};
  for (const b of document.querySelectorAll('#modal-card .template')) cards[b.querySelector('.template-name').textContent] = b.querySelector('.template-blurb').textContent.split(' · ')[0];
  UI.closeModal(); return { hs, cards }; });
ok('the hangar, building Armour: Ground forces first after your designs, each card with its class (tank, tank destroyer, SPAA, SAM launcher, rocket artillery…)',
  r.hs[1] === 'Ground forces' && r.cards['StuQ III'] === 'Tank destroyer' && r.cards['Gepardo'] === 'SPAA' && r.cards['OK-8 Hive'] === 'SAM launcher' && r.cards['BK-21 Grod'] === 'Rocket artillery' && r.cards['TK-34'] === 'Tank', JSON.stringify(r));

// ---- 4. plates go flush on a face, pairs go both sides
r = await ev(() => {
  const h = Builder.parts.find((p) => p.type === 'hullMedium'), R = partRect(h), a = Builder.viewArea(), c = Builder.screenToWorld(a.cx, a.cy);
  Builder.cam.x += R.r + 0.6 - c.x; Builder.cam.y += h.y - c.y; // (the middle of the view ahead of the hull's front)
  Builder.quickAdd('plateApp');
  const p = Builder.selected, ys = []; for (let y = partRect(p).b; y <= partRect(p).t; y += 0.005) if (y > R.b && y < R.t) ys.push(partRect(p).l - Builder.frontAt(h, y)); // (where it comes closest)
  return { type: p.type, rot: p.rot, att: (Builder.parts.find((q) => q.id === p.att) || {}).type, gap: Math.min(...ys), clash: Builder.parts.some((q) => q !== p && partsClash(p, q)), joined: Builder.attached.has(p.id) };
});
ok('an Applique Plate tapped by a hull\'s front stands up (rot 1) flush on it', r.type === 'plateApp' && r.rot === 1 && r.att === 'hullMedium' && r.gap >= -0.005 && r.gap < 0.03 && !r.clash && r.joined, JSON.stringify(r));
await ev(() => Builder.undo());
// (P4 review) on the MBT hull, whose nose reaches its box only at the bottom, a brick stood on the front goes low enough
// to touch it (it stood in the air, half a metre ahead of the plate)
r = await ev((rows) => {
  Builder.loadTemplate('ma1'); Builder.symmetry = true;
  const h = Builder.parts[0], R = partRect(h), a = Builder.viewArea(), c = Builder.screenToWorld(a.cx, a.cy);
  Builder.cam.x += R.r + 0.5 - c.x; Builder.cam.y += h.y - c.y;
  const n = Builder.parts.length; Builder.quickAdd('era');
  const p = Builder.parts[n], P = p && partRect(p);
  let gap = Infinity; if (p) for (let y = Math.max(P.b, R.b); y <= Math.min(P.t, R.t); y += 0.01) gap = Math.min(gap, P.l - Builder.frontAt(h, y));
  const out = p && { rot: p.rot, att: (Builder.parts.find((q) => q.id === p.att) || {}).type, gap: +gap.toFixed(3), clash: Builder.parts.some((q) => q !== p && partsClash(p, q)), joined: Builder.attached.has(p.id) };
  Builder.loadDesign({ name: 'Six taps', kind: 'tank', parts: rows });
  return out;
}, tankRows);
ok('Reactive Bricks tapped by the MA-1\'s nose stand on it (rot 1), touching the plate, not in the air ahead of it', !!r && r.rot === 1 && r.att === 'hullMBT' && r.gap >= -0.005 && r.gap < 0.03 && !r.clash && r.joined, JSON.stringify(r));
r = await ev(() => {
  Builder.quickAdd('smokeL');
  const p = Builder.selected, m = p.mirror;
  return { two: Builder.parts.filter((q) => q.type === 'smokeL').length, z: [partZ(p), m && partZ(m)], same: m && m.x === p.x && m.y === p.y && m.rot === p.rot, att: [p.att, m && m.att].map((id) => (Builder.parts.find((q) => q.id === id) || {}).type) };
});
ok('smoke launchers go on the turret\'s sides as a mirrored pair (z symmetry)', r.two === 2 && r.z[0] === -r.z[1] && r.z[0] !== 0 && r.same && r.att.every((t) => t === 'turretCast'), JSON.stringify(r));
await ev(() => Builder.undo());
// (P4 play-test) a Wet Ammo Rack tapped in: it takes over its host's built-in rounds, and a toast says so (the rounds in
// the line under the stats went 42 → 36 without a word); a second rack says nothing more
r = await ev(() => {
  for (const t of document.querySelectorAll('#toasts .toast')) t.remove();
  Builder.quickAdd('wetRack'); const p = Builder.selected, host = (Builder.parts.find((q) => q.id === p.att) || {}).def;
  const t1 = [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | ');
  for (const t of document.querySelectorAll('#toasts .toast')) t.remove();
  Builder.quickAdd('wetRack'); const t2 = [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | ');
  Builder.undo(); Builder.undo();
  return { host: host && host.name, t1, t2 };
});
ok('a Wet Ammo Rack tapped into the tank: "The … built-in rounds now live in your racks"; a second one says nothing more', /built-in rounds now live in your racks/.test(r.t1) && r.t1.includes(r.host) && !/built-in/.test(r.t2), JSON.stringify(r));
// launchers by a tap (not set into the armour like a gun's breech): wire-guided rails on the turret's front beside the
// gun, never through its barrel; the rocket rails and the big launchers on its roof; on a bare ring, where the stock
// BRDK-2 and BK-21 carry theirs (two taps give the BRDK-2 back its three rails)
r = await ev(() => {
  const rows0 = designRows(Builder.parts), out = {};
  const tap = (type) => { const n = Builder.parts.length; Builder.quickAdd(type); return Builder.parts.slice(n); };
  const judge = (nw) => ({
    n: nw.length, host: [...new Set(nw.map((p) => (Builder.parts.find((q) => q.id === p.att) || {}).type))].join(), rot: nw.every((p) => p.rot === 3),
    z: nw.map((p) => +partZ(p).toFixed(2)), over: nw.map((p) => +(partRect(p).b - partRect(Builder.parts.find((q) => q.id === p.att)).t).toFixed(3)),
    clear: nw.every((p) => !Builder.parts.some((q) => q !== p && (partsClash(p, q) || (q.def.flush && partsOverlap(p, q))))), joined: nw.every((p) => Builder.attached.has(p.id)),
    turns: nw.every((p) => Builder.tg && Builder.tg.some((g) => g.ids.has(p.id))),
  });
  for (const type of ['atgmWire', 'mlrsLight', 'samLong', 'mlrsPod']) { Builder.loadDesign({ name: 'l', kind: 'tank', parts: rows0 }); out[type] = judge(tap(type)); }
  const strip = (k, type) => {
    const rows = templateRows(TEMPLATES[k]), keep = rows.map((q, i) => (q.type === type ? -1 : i)).filter((i) => i >= 0);
    return keep.map((i) => { const q = { ...rows[i] }; if (q.att != null) q.att = keep.indexOf(q.att); return q; });
  };
  const key = (p) => [p.type, +p.x.toFixed(3), +p.y.toFixed(3), +(p.z || 0).toFixed(3), p.rot].join();
  Builder.loadDesign({ name: 'b', kind: 'tank', parts: strip('brdk2', 'atgmWire') });
  const rails = [...tap('atgmWire'), ...tap('atgmWire')];
  out.brdk2 = { ...judge(rails), stock: rails.map((p) => key({ ...p, z: partZ(p) })).sort().join('|') === templateRows(TEMPLATES.brdk2).filter((q) => q.type === 'atgmWire').map(key).sort().join('|') };
  Builder.loadDesign({ name: 'k', kind: 'tank', parts: strip('bk21', 'mlrsLight') });
  out.bk21 = judge(tap('mlrsLight'));
  Builder.loadDesign({ name: 'Six taps', kind: 'tank', parts: rows0 });
  return out;
});
const good = (j, n, host) => j.n === n && j.host === host && j.rot && j.clear && j.joined && j.turns;
ok('a Wire-Guided Missile Rail tapped: a pair on the turret\'s front beside the gun, clear of its barrel', good(r.atgmWire, 2, 'turretCast') && r.atgmWire.z[0] === -r.atgmWire.z[1] && Math.abs(r.atgmWire.z[0]) > 0.6, JSON.stringify(r.atgmWire));
ok('Rocket Rails, the Long-Range SAM Launcher and the Rocket Artillery Pod tapped: on the turret\'s roof', ['mlrsLight', 'samLong', 'mlrsPod'].every((t) => good(r[t], 1, 'turretCast') && Math.abs(r[t].over[0]) < 0.01), JSON.stringify([r.mlrsLight, r.samLong, r.mlrsPod]));
ok('the BRDK-2 without its rails: two taps put back its three, where it carries them, on the ring', good(r.brdk2, 3, 'ringS') && r.brdk2.stock, JSON.stringify(r.brdk2));
ok('the BK-21 without its rockets: one tap puts the Rocket Rails on its ring', good(r.bk21, 1, 'ringM') && Math.abs(r.bk21.over[0]) < 0.01, JSON.stringify(r.bk21));

// ---- 5. the sweep's answer lands 150 ms after an edit, outside any input: it redraws (once) and warns
const sweep = await ev(() => new Promise((done) => {
  App.heartbeat = 1e9;
  const hull = Builder.parts.find((p) => p.type === 'hullMedium'), [a] = Builder.roofOf(hull), D = Math.PI / 180;
  const row = { type: 'radarSearch', x: +(a + 0.35).toFixed(3), y: partRect(hull).t + 0.6 };
  // the real sweep finds the mast in the way
  const g = Builder.tg[0], probe = Aim.sweep([...Builder.parts, makePart(row.type, row.x, row.y)], g), real = !!(probe && probe.yawLim);
  // count the draws from the moment the answer lands (the edit's own draw may still be waiting: it is the same one then)
  // and what asks for a picture (Builder.redraw): the answer itself, once, and nothing after it
  let n = 0, at = null, last = 0, asks = 0;
  const r0 = Builder.render, l0 = Builder.landSweep, rd0 = Builder.redraw;
  Builder.render = function (...x) { n++; last = performance.now(); return r0.apply(this, x); };
  Builder.redraw = function () { asks++; return rd0.call(this); };
  Builder.landSweep = function (...x) { const a0 = asks, r = l0.apply(this, x); at = { n, w: $('#s-warn').textContent, t: performance.now(), asks: asks - a0, a1: asks }; return r; };
  Builder.addPart(row.type, row.x, row.y, 0, { att: hull });
  const w0 = $('#s-warn').textContent, mast = Builder.selected, clear = !Builder.parts.some((q) => q !== mast && partsClash(mast, q)) && Builder.attached.has(mast.id);
  // (software rendering under load: frames may come late, so the draws are counted until the screen has been still for
  // 0.7 s, then it must stay still)
  const wait = () => {
    const now = performance.now();
    if (!at || !((n > at.n && now - last > 700) || now - at.t > 6000)) { setTimeout(wait, 20); return; }
    const k = n - at.n;
    setTimeout(() => { Builder.render = r0; Builder.landSweep = l0; Builder.redraw = rd0; done({ real, clear, k, asks: at.asks, later: asks - at.a1, idle: n - at.n - k, w0, w1: at.w }); }, 800);
  };
  wait();
}));
ok('a Search Radar on the rear deck, clear of the turret', sweep.clear);
ok('the sweep\'s answer asks for one picture when it lands, and is drawn', sweep.real && sweep.asks === 1 && sweep.later === 0 && sweep.k >= 1, JSON.stringify({ real: sweep.real, asks: sweep.asks, later: sweep.later, draws: sweep.k }));
ok('...and then it is idle again', sweep.idle === 0, sweep.idle);
ok('...with its warning: where the turret stops and what stops it', !sweep.w0.includes('The turret stops') && /The turret stops at [±−+]\d+°.*: beyond that the .+ hits the Search Radar\./.test(sweep.w1), sweep.w1);

// ---- 6. X-ray: key X (not Ctrl+X, which cuts), the button, kept in rss.xray
r = await ev(() => ({ on: Builder.xrayShown(), shown: !$('#btn-xray').hidden, pressed: $('#btn-xray').getAttribute('aria-pressed') }));
ok('X-ray is offered for armour, on to begin with', r.on && r.shown && r.pressed === 'true', JSON.stringify(r));
await page.keyboard.press('KeyX');
r = await ev(() => ({ on: Builder.xrayShown(), stored: store.get('rss.xray', null), pressed: $('#btn-xray').getAttribute('aria-pressed') }));
ok('X turns it off (and remembers)', !r.on && r.stored === false && r.pressed === 'false', JSON.stringify(r));
r = await ev(() => { Builder.selected = Builder.parts.find((p) => p.type === 'gun85'); Builder.renderInfo(); return Builder.parts.length; });
await page.keyboard.press('Control+KeyX');
r = await ev((n) => ({ cut: Builder.parts.length < n, on: Builder.xrayShown() }), r);
ok('Ctrl+X cuts, and leaves X-ray alone', r.cut && !r.on, JSON.stringify(r));
await ev(() => { Builder.undo(); Builder.setXray(true); Builder.loadTemplate('skylark'); });
r = await ev(() => ({ shown: !$('#btn-xray').hidden, on: Builder.xrayShown() }));
ok('...and is not offered on a plane with nothing inside', !r.shown && !r.on, JSON.stringify(r));

// ---- 7. More stays in sight; the kind strip fits at every size
r = await ev(() => { Builder.setKind('tank'); const strip = $('#palette-tabs').getBoundingClientRect(), m = [...document.querySelectorAll('#palette-tabs .tab')].find((t) => t.textContent === 'More…').getBoundingClientRect(); return m.right <= strip.right + 1 && m.left >= strip.left; });
ok('phone portrait: More is in sight for armour', r);
// (P4 play-test) a small phone (375 × 667) opens the builder with the stats folded: the kind strip stays, one slim row,
// Armour in sight and its label whole
{
  const pg = await phone(375, 667), k = await pg.evaluate(() => { const a = document.querySelector('#kind-select [data-kind="tank"]'), r = a.getBoundingClientRect(), s = $('#stats').getBoundingClientRect();
    return { folded: $('#stats').classList.contains('collapsed'), shown: !!a.offsetParent && r.width > 30 && r.height > 12, fits: a.scrollWidth <= a.clientWidth, h: Math.round(r.height), statsH: Math.round(s.height),
      home: [$('.home-tag').textContent, $('#home-build .hb-sub').textContent] }; });
  ok('375 × 667, first open: the stats folded, the kind strip still there in one slim row, Armour in sight with its label whole', k.folded && k.shown && k.fits && k.h <= 26, JSON.stringify(k));
  ok('the home screen names tanks: its line and the hangar button\'s', k.home.every((t) => /tank/.test(t)), JSON.stringify(k.home));
  await pg.close();
}
const fits = async (pg) => pg.evaluate(() => { $('#stats').classList.remove('collapsed'); Builder.layout(); return [...document.querySelectorAll('#kind-select .kind-btn')].map((b) => [b.dataset.kind, b.scrollWidth, b.clientWidth]); });
for (const [w, h] of [[390, 844], [375, 667], [844, 390], [1280, 720]]) {
  const pg = w === 390 ? page : await phone(w, h);
  if (w === 1280) await pg.setViewportSize({ width: w, height: h });
  const f = await fits(pg);
  ok(`${w} × ${h}: every kind button fits its label (six: Drone after Armour)`, f.length === 6 && f[5][0] === 'drone' && f.every(([, s, c]) => s <= c), JSON.stringify(f));
  if (pg !== page) await pg.close();
}

// ---- 8. the Armour builder to look at: phone portrait and desktop, 2D and 3D
const look = async (pg, tag) => {
  await pg.evaluate((rows) => { Builder.loadDesign({ name: 'Six taps', kind: 'tank', parts: rows }); Builder.selected = Builder.parts.find((p) => p.type === 'hullMedium'); Builder.renderInfo(); Builder.fitView(); }, tankRows);
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${SHOTS}2e-${tag}-hull.png` });
  await pg.evaluate(() => { Builder.selected = Builder.parts.find((p) => p.type === 'ringM'); Builder.renderInfo(); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${SHOTS}2e-${tag}-ring.png` });
};
await ev((rows) => Builder.loadDesign({ name: 'Six taps', kind: 'tank', parts: rows }), tankRows);
// (P4 play-test) Fit keeps the whole tank, gun and all, clear of the Select / Grid / Fit column on a phone (it centred the
// tank on the whole canvas, its nose and gun under the column): every part's ends, in 2D, left of the column
r = await ev(() => { Builder.selected = null; Builder.renderInfo(); Builder.layout(); Builder.fitView(); Builder.redraw();
  const f = $('.fit-col').getBoundingClientRect(), c = Builder.canvas.getBoundingClientRect();
  const xs = Builder.parts.flatMap((p) => { const R = partRect(p); return [Builder.partScreen({ x: R.l, y: (R.b + R.t) / 2, z: 0 }).x, Builder.partScreen({ x: R.r, y: (R.b + R.t) / 2, z: 0 }).x]; });
  return { maxX: Math.round(Math.max(...xs)), minX: Math.round(Math.min(...xs)), col: Math.round(f.left), W: Math.round(c.width) }; });
ok('phone portrait: Fit keeps the six-tap tank, gun and all, left of the Select / Grid / Fit column and on screen', r.maxX < r.col && r.minX > 0, JSON.stringify(r));
await look(page, 'phone-2d');
await ev(() => App.setPreview3D(true));
await page.waitForFunction(() => Render3D.ready && App.preview3D(), null, { timeout: 60000 });
await page.waitForTimeout(2500);
await look(page, 'phone-3d');
const desk = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
watch(desk, errs, 'desktop ');
await openGame(desk, srv.url, { build3d: false });
await desk.evaluate(() => App.toBuild());
await look(desk, 'desktop-2d');
await desk.evaluate(() => App.setPreview3D(true));
await desk.waitForFunction(() => Render3D.ready && App.preview3D(), null, { timeout: 60000 });
await desk.waitForTimeout(2500);
await look(desk, 'desktop-3d');
// the panels clear of each other on the desktop: the Fit column beside a tall part panel, not over the top bar
r = await desk.evaluate(() => { const f = $('.fit-col').getBoundingClientRect(), t = $('#build-top').getBoundingClientRect(), i = $('#part-info').getBoundingClientRect(), o = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; return { top: o(f, t), info: o(f, i) }; });
ok('desktop: the Fit column clears the top bar and the part panel', !r.top && !r.info, JSON.stringify(r));
// (P4 play-test) the 3D hint: Armour's words (hull or turret, not wings), and clear of the Fit column beside the part panel
r = await desk.evaluate(() => { const h = $('#build-3d-hint'), a = h.getBoundingClientRect(), f = $('.fit-col').getBoundingClientRect(), s = $('#stats').getBoundingClientRect();
  return { shown: !h.hidden, text: h.textContent, over: a.left < f.right && a.right > f.left && a.top < f.bottom && a.bottom > f.top, stats: a.left < s.right && a.right > s.left && a.top < s.bottom && a.bottom > s.top }; });
ok('desktop 3D: the hint speaks of the hull or a turret (not wings) and keeps clear of the Fit column and the stats', r.shown && /the hull or a turret/.test(r.text) && !/wing/.test(r.text) && !r.over && !r.stats, JSON.stringify(r));

// ---- 9. and it launches
await ev(() => { Render3D.skipDraw = true; Builder.selected = null; App.launch(); });
await page.waitForFunction(() => App.scene === 'flight' && typeof Flight !== 'undefined' && Flight.running, null, { timeout: 60000 });
await frames(page, 5);
r = await ev(() => ({ kind: Flight.active.kind, parts: Flight.active.parts.length, gv: Flight.active.gv, mm: (Flight.active.parts.find((p) => p.type === 'hullMedium') || {}).mm }));
ok('the six-tap tank launches as Armour, its 70 mm plate aboard', r.kind === 'tank' && r.parts === 7 && r.gv && r.mm === 70, JSON.stringify(r));
// ...on Highland Ridge's north pad (the map is ready and the view 3D: GroundMode.soloPlace), and Revert puts it back there
const padAt = () => ev(() => { const v = Flight.active, L = Terrain.locate(EARTH, v.x, v.y, v.z, {}); return { e: (EARTH.padAngle - L.a) * EARTH.radius, z: L.z, place: Flight.spawnOpts && Flight.spawnOpts.place, want: GroundMode.soloPlace('tank') }; });
const onPad = (p) => !!p.want && JSON.stringify(p.place) === JSON.stringify(p.want) && Math.abs(p.e - p.want.e) < 2 && Math.abs(p.z - p.want.z) < 2;
const launchedAt = await padAt();
await ev(() => Flight.revert());
await frames(page, 2);
const revertedAt = await padAt();
ok('...on Highland Ridge\'s north pad, and Revert to launch puts it back there', onPad(launchedAt) && onPad(revertedAt), JSON.stringify([launchedAt, revertedAt]));
await ev(() => { App.toBuild(); Render3D.skipDraw = false; });

// ---- 10. the build screen as a new player first meets it (the stock Hopper on the blueprint): Armour starts a new,
// empty design (Undo brings the Hopper back), and six taps make the same tank; the player's own work is asked about,
// and kept on request, with a warning when the tracks don't reach the ground
{
  const pg = await phone(375, 667), e = (f, a) => pg.evaluate(f, a);
  if (!(await pg.isVisible('#kind-select [data-kind="tank"]'))) await pg.locator('#btn-stats').tap(); // (a short phone: the stats start folded)
  const st = () => e(() => ({ kind: Builder.kind, n: Builder.parts.length, name: Builder.name, modal: UI.modalOpen, warn: $('#s-warn').textContent, toast: [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | ') }));
  const s0 = await st();
  await pg.locator('#kind-select [data-kind="tank"]').tap();
  const s1 = await st();
  ok('a fresh profile: the Hopper, then Armour gives an empty Armour design (no question asked), and says Undo brings the Hopper back', s0.kind === 'rocket' && s0.n === 5 && s0.name === 'Hopper' && s1.kind === 'tank' && s1.n === 0 && s1.name === 'Armour' && !s1.modal && /Undo brings back the Hopper/.test(s1.toast), JSON.stringify([s0, s1]));
  await e(() => Builder.undo());
  const s2 = await st();
  await e(() => Builder.redo());
  const s3 = await st();
  ok('...Undo brings the Hopper back as a rocket; Redo the empty Armour design', s2.kind === 'rocket' && s2.n === 5 && s2.name === 'Hopper' && s3.kind === 'tank' && s3.n === 0, JSON.stringify([s2, s3]));
  for (const t of SIX) await tapPart(pg, ...t);
  const s4 = await st();
  ok('...and six taps make the tank: seven parts, joined, launchable, no warnings', s4.n === 7 && !s4.warn && await e(() => Builder.attached.size === Builder.parts.length && !$('#btn-launch').disabled), JSON.stringify(s4));
  const v4 = await inSight(pg);
  ok('...seen taking shape on a small phone too (the gun\'s card up): every part in sight, the stats uncovered', v4.card && v4.vis === v4.n && !v4.fitOverStats, v4);
  await pg.screenshot({ path: SHOTS + '2e-phone-375-six-taps.png' });
  // the player's own work: asked; Keep these parts keeps them (and the tank, built on the rocket, is warned about)
  await e(() => { Builder.loadTemplate('hopper'); const p = Builder.parts.find((q) => q.type === 'parachute') || Builder.parts[0]; Builder.setPose(p, { x: p.x + 0.25, y: p.y }); Builder.changed(); });
  await pg.locator('#kind-select [data-kind="tank"]').tap();
  const s5 = await st();
  await pg.locator('#modal-card button', { hasText: 'Keep these parts' }).tap();
  const s6 = await st();
  ok('edited work: Armour asks first; Keep these parts switches the kind and keeps them', s5.modal && s5.kind === 'rocket' && s6.kind === 'tank' && s6.n === 5 && !s6.modal, JSON.stringify([s5, s6]));
  for (const t of SIX) await tapPart(pg, ...t);
  const s7 = await st();
  ok('...a tank built on the rocket is warned about: its tracks don\'t reach the ground', s7.n === 12 && /The tracks don’t reach the ground: the .+ sits \d+\.\d m lower\./.test(s7.warn), s7.warn);
  await e(() => Builder.loadTemplate('hopper'));
  await pg.locator('#kind-select [data-kind="tank"]').tap();
  const s8 = await st();
  ok('a template as it was loaded: no question, a new Armour design', !s8.modal && s8.kind === 'tank' && s8.n === 0, JSON.stringify(s8));
  // and no stock vehicle gets the new warning
  const bad = await e(() => Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].kind === 'tank' || TEMPLATES[k].kind === 'car').filter((k) => { Builder.loadTemplate(k); return /reach the ground/.test($('#s-warn').textContent); }));
  ok('...and no stock Armour or car has its tracks or wheels off the ground', !bad.length, bad.join(', '));
  await pg.close();
}

// ---- 11. (the big update) the Drone kind: six taps make a quad, its numbers, its warnings, its words, its scale
// The stock drones are the big update's templates package's: where this game has none yet, the spec's rows stand in.
const DRONE_ROWS = {
  bumble: ['Bumble FPV', [['drFrameS', 0, 0], ['drFC', 0, 0.0375, 0, { att: 0 }], ['drCam', 0.155, 0.0425, 0, { att: 0 }], ['drLink', -0.1, 0.0325, 0, { att: 0 }],
    ['drMotorS', 0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', 0.15, 0.0475, 0, { z: -0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: 0.15, att: 0 }], ['drMotorS', -0.15, 0.0475, 0, { z: -0.15, att: 0 }],
    ['drBattS', -0.03, -0.0425, 0, { att: 0 }], ['drCharge', 0.06, -0.1125, 3, { att: 8 }]]],
  mavik: ['Mavik Scout', [['drFrameM', 0, 0], ['drFCgps', 0, 0.05, 0, { att: 0 }], ['drGimbal', 0.2, -0.075, 0, { att: 0 }], ['drLinkL', -0.12, 0.075, 0, { att: 0 }],
    ['drMotorM', 0.2, 0.06, 0, { z: 0.2, att: 0 }], ['drMotorM', 0.2, 0.06, 0, { z: -0.2, att: 0 }], ['drMotorM', -0.2, 0.06, 0, { z: 0.2, att: 0 }], ['drMotorM', -0.2, 0.06, 0, { z: -0.2, att: 0 }],
    ['drBattM', -0.04, -0.055, 0, { att: 0 }], ['drLegs', 0, -0.085, 0, { att: 0 }]]],
  lancett: ['Lancett', [['drBody', 0, 0, 3], ['drFC', 0.1, 0, 0, { att: 0 }], ['drBattM', -0.12, 0, 0, { att: 0 }], ['drChargeT', 0.75, 0, 3, { att: 0 }], ['drCam', 0.4, 0.105, 0, { att: 0 }],
    ['drLinkL', -0.25, 0.13, 0, { att: 0 }], ['drWing', 0.3, 0.095, 3, { att: 0 }], ['drTail', -0.48, 0.09, 3, { att: 0 }], ['drFin', -0.48, 0.17, 3, { att: 0 }], ['drPusher', -0.6, 0, 3, { att: 0 }]]],
};
const stockDrones = (pg) => pg.evaluate((R) => { for (const k in R) if (!TEMPLATES[k]) TEMPLATES[k] = { name: R[k][0], kind: 'drone', tier: 1, blurb: 'A stock drone.', parts: R[k][1] }; }, DRONE_ROWS);
const nb = (t) => (t || '').replace(/ /g, ' ');
const SIX_DRONE = [['Frames', 'FPV Frame'], ['Frames', 'FPV Flight Controller'], ['Motors & power', 'Racing Motor'], ['Motors & power', 'Racing Motor'], ['Motors & power', 'Battery 50 Wh'], ['Links & sensors', 'FPV Camera']];
const droneState = (pg) => pg.evaluate(() => ({ kind: Builder.kind, n: Builder.parts.length, name: Builder.name, tab: Builder.category, sym: Builder.symmetry, symTitle: $('#btn-sym').title, modal: UI.modalOpen,
  tabs: [...document.querySelectorAll('#palette-tabs .tab')].map((t) => t.textContent).join('|'), warn: $('#s-warn').hidden ? '' : $('#s-warn').textContent,
  toast: [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | '), launch: !$('#btn-launch').disabled }));
for (const [w, h, touch] of [[390, 844, true], [1280, 720, false]]) {
  const pg = touch ? await phone(w, h) : await (async () => { const d = await (await b.newContext({ viewport: { width: w, height: h } })).newPage(); watch(d, errs, 'desktop '); await openGame(d, srv.url, { build3d: false }); await d.evaluate(() => App.toBuild()); await d.waitForTimeout(300); return d; })();
  const e = (f, a) => pg.evaluate(f, a), tap = async (loc) => (touch ? loc.tap() : loc.click()), tag = touch ? 'phone' : 'desktop';
  const tapIt = async (tab, name) => { await tap(pg.locator('#palette-tabs .tab', { hasText: new RegExp(`^${tab}$`) })); await tap(pg.locator('#palette-items .part-item', { has: pg.locator('.part-name', { hasText: new RegExp(`^${name}$`) }) })); await frames(pg, 2); };
  await stockDrones(pg);
  if (!(await pg.isVisible('#kind-select [data-kind="drone"]'))) await tap(pg.locator('#btn-stats'));
  await pg.screenshot({ path: `${SHOTS}w3-${tag}-kinds.png` });
  // from the Hopper: a new, empty Drone design, the Frames tab, symmetry on, and the six-tap tip (once)
  const d0 = await droneState(pg);
  await tap(pg.locator('#kind-select [data-kind="drone"]'));
  await frames(pg, 2);
  const d1 = await droneState(pg);
  ok(`${tag}: Drone from the Hopper: an empty Drone design (Undo brings the Hopper back), the Frames tab, symmetry on (mirror left and right), and the tip: six taps make a drone`,
    d0.kind === 'rocket' && d1.kind === 'drone' && d1.n === 0 && d1.name === 'Drone' && d1.tab === 'drFrame' && d1.sym && /mirror left and right/.test(d1.symTitle) && /Undo brings back the Hopper/.test(d1.toast) && /Six taps make a drone: a frame, a flight controller, motors twice, a battery and a camera/.test(d1.toast),
    JSON.stringify([d0, d1]));
  ok(`${tag}: its tabs: Frames, Motors & power, Links & sensors, Payloads and More; an empty one asks for a flight controller and can't launch`,
    d1.tabs === 'Frames|Motors & power|Links & sensors|Payloads|More…' && d1.warn === 'Add a flight controller (Frames).' && !d1.launch, JSON.stringify(d1));
  await pg.screenshot({ path: `${SHOTS}w3-${tag}-drone-empty.png` });
  for (const t of SIX_DRONE) await tapIt(...t);
  const d2 = await droneState(pg);
  const q = await e((B) => { const near = (p, r) => Math.abs(p.x - r[1]) <= 0.01 && Math.abs(p.y - r[2]) <= 0.01 && Math.abs(partZ(p) - ((r[4] || {}).z || 0)) <= 0.01 && (p.rot || 0) === (r[3] || 0);
    const left = B.slice(), miss = []; for (const p of Builder.parts) { const i = left.findIndex((r) => r && r[0] === p.type && near(p, r)); if (i < 0) miss.push([p.type, p.x, p.y, partZ(p)]); else left[i] = null; }
    return { miss, joined: Builder.attached.size === Builder.parts.length, mirrors: Builder.parts.filter((p) => p.type === 'drMotorS' && p.mirror).length }; }, DRONE_ROWS.bumble[1]);
  ok(`${tag}: six taps make a quad: a frame, a controller, four motors (two taps, symmetry pairs them), a battery and a camera, each where the Bumble has it, joined, no warnings, ready to launch`,
    d2.n === 8 && !q.miss.length && q.joined && q.mirrors === 4 && !d2.warn && d2.launch, JSON.stringify([d2.n, q, d2.warn]));
  const vis = await inSight(pg);
  ok(`${tag}: ...seen taking shape: every part in sight, the stats uncovered`, vis.vis === vis.n && !vis.fitOverStats, vis);
  await pg.screenshot({ path: `${SHOTS}w3-${tag}-quad.png` });
  await tapIt('Payloads', 'Shaped Charge');
  await e(() => { Builder.selected = null; Builder.renderInfo(); $('#stats').classList.remove('collapsed'); Builder.layout(); });
  await frames(pg, 2);
  const s = await e(() => ({ rows: [...document.querySelectorAll('#stats .stat-grid > div')].filter((d) => !d.hidden).map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]),
    air: $('#s-air').hidden ? null : $('#s-air').textContent, stages: $('#s-stage-box').hidden, wrap: [...document.querySelectorAll('#stats .stat-grid > div:not([hidden]) dd')].every((d) => d.scrollWidth <= d.clientWidth + 1),
    charge: Builder.parts.find((p) => p.type === 'drCharge') }));
  const row = (k) => nb((s.rows.find((r) => r[0] === k) || [])[1]);
  ok(`${tag}: the stats read Mass 1.66 kg, Thrust 3.9× weight, Battery 50 Wh · hover 7.6 min, Top speed Level 97 km/h · Acro …, Link Radio 1 km (no thrust in kN, fuel or stages)`,
    s.rows.map((r) => r[0]).join('|') === 'Mass|Thrust|Battery|Top speed|Link' && row('Mass') === '1.66 kg' && row('Thrust') === '3.9× weight' && /^50 Wh · hover 7\.\d min$/.test(row('Battery'))
    && /^Level 9\d km\/h · Acro \d+$/.test(row('Top speed')) && row('Link') === 'Radio 1 km' && s.stages && s.wrap, JSON.stringify(s.rows));
  ok(`${tag}: ...and under them: Hovers at 25% · climbs 8 m/s · fits: Drone Rack, Drone Hangar`, nb(s.air) === 'Hovers at 25% · climbs 8 m/s · fits: Drone Rack, Drone Hangar', s.air);
  ok(`${tag}: the charge goes under the battery, pointing forward, its tip 2 cm past the frame`, s.charge && s.charge.rot === 3 && Math.abs(s.charge.x - 0.06) < 0.01 && Math.abs(s.charge.y + 0.1125) < 0.01, JSON.stringify(s.charge && [s.charge.x, s.charge.y, s.charge.rot]));
  await pg.screenshot({ path: `${SHOTS}w3-${tag}-stats.png` });
  // a second time on an empty blueprint: no tip
  await e(() => { Builder.loadTemplate('hopper'); });
  await tap(pg.locator('#kind-select [data-kind="drone"]'));
  await pg.waitForTimeout(3300); // (the first toasts gone)
  const d3 = await droneState(pg);
  ok(`${tag}: the tip comes once (rss.droneTip)`, d3.kind === 'drone' && d3.n === 0 && !/Six taps/.test(d3.toast), d3.toast);
  await pg.close();
}
// a small phone (360 × 640, the stats folded as it first opens): the folded stats one row (the core of each value), and
// the quad in sight above the part's card as it takes shape
{
  const pg = await phone(360, 640), e = (f, a) => pg.evaluate(f, a);
  await pg.locator('#kind-select [data-kind="drone"]').tap();
  for (const [tab, name] of SIX_DRONE) {
    await pg.locator('#palette-tabs .tab', { hasText: new RegExp(`^${tab}$`) }).tap();
    await pg.locator('#palette-items .part-item', { has: pg.locator('.part-name', { hasText: new RegExp(`^${name}$`) }) }).tap();
    await frames(pg, 2);
  }
  const v = await inSight(pg), f = await e(() => ({ folded: $('#stats').classList.contains('collapsed'), rows: [...document.querySelectorAll('#stats .stat-grid > div')].filter((d) => d.offsetParent).map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').innerText.replace(/\u00a0/g, ' ')]),
    one: new Set([...document.querySelectorAll('#stats .stat-grid > div')].filter((d) => d.offsetParent).map((d) => Math.round(d.getBoundingClientRect().top))).size === 1 }));
  ok('360 × 640, folded: the drone\'s stats in one row (1 kg, thrust, battery, top speed: no link, no second halves)', f.folded && f.one && f.rows.map((r) => r[0]).join('|') === 'Mass|Thrust|Battery|Top speed' && f.rows[2][1] === '50 Wh' && /^\d+ km\/h$/.test(f.rows[3][1]), JSON.stringify(f));
  ok('...and six taps make a quad in sight above the card, the stats uncovered', v.card && v.vis === v.n && v.n === 8 && !v.fitOverStats, v);
  await pg.screenshot({ path: `${SHOTS}w3-phone-360-quad.png` });
  await pg.close();
}
// the warnings, the words and the scale (on the phone's page)
{
  await stockDrones(page);
  const W = await ev(() => {
    const warnOf = (kind, rows) => { Builder.loadDesign({ name: 't', kind, parts: rows }); return $('#s-warn').hidden ? '' : $('#s-warn').textContent; };
    const air = () => ($('#s-air').hidden ? '' : $('#s-air').textContent);
    const B = templateRows(TEMPLATES.bumble), L = templateRows(TEMPLATES.lancett), out = {};
    out.ok = warnOf('drone', B);
    out.noMotor = warnOf('drone', B.filter((r) => r.type !== 'drMotorS'));
    out.noBatt = warnOf('drone', B.filter((r, i) => i !== 8 && i !== 9));
    const heavy = B.concat([{ type: 'drBattL', x: -0.03, y: -0.2175, rot: 0, flip: false, att: 9 }]); out.heavy = warnOf('drone', heavy);
    const slug = B.concat(Array.from({ length: 6 }, (_, i) => ({ type: 'drBattM', x: -0.03, y: -0.1875 - 0.06 * i, rot: 0, flip: false, att: 9 + i }))); out.slug = warnOf('drone', slug); // (+3.3 kg: 1.3× its weight)
    out.balance = warnOf('drone', B.map((r) => (r.type === 'drCharge' ? { ...r, x: 0.4 } : r)));
    out.props = warnOf('drone', B.filter((r, i) => i < 8).map((r) => (r.type === 'drMotorS' ? { ...r, y: -0.0475 } : r)));
    out.legs = warnOf('drone', B.filter((r, i) => i < 8).map((r) => (r.type === 'drMotorS' ? { ...r, y: -0.0475 } : r)).concat([{ type: 'drLegs', x: 0, y: -0.0775, rot: 0, flip: false, att: 0 }]));
    out.lancett = warnOf('drone', L); out.lancettAir = air();
    out.wingFwd = warnOf('drone', L.map((r) => (r.type === 'drWing' ? { ...r, x: 0.5 } : r)));
    out.armour = warnOf('drone', B.concat([{ type: 'cdJam', x: 0, y: 0.3, rot: 0, flip: false, att: 1 }]));
    warnOf('drone', B.filter((r) => r.type !== 'drCam')); out.noCam = air();
    Builder.loadDesign({ name: 'b', kind: 'drone', parts: B }); out.kg = $('#s-mass').textContent;
    return out;
  });
  ok('a stock quad warns of nothing', !W.ok, W.ok);
  ok('no motors: "Add motors (Motors & power): nothing lifts it."; no battery: "Add a battery (Motors & power): the motors have no power."',
    W.noMotor.includes('Add motors (Motors & power): nothing lifts it.') && W.noBatt.includes('Add a battery (Motors & power): the motors have no power.'), [W.noMotor, W.noBatt]);
  ok('a 700 Wh battery on a racer: "Too heavy to lift: thrust 6.5 of 6.4 kg"-style; three more 100 Wh ones: "Sluggish: thrust only 1.x× its weight"',
    /Too heavy to lift: thrust \d+\.\d of \d+\.\d kg\./.test(W.heavy) && /Sluggish: thrust only 1\.\d× its weight\./.test(W.slug), [W.heavy, W.slug]);
  ok('the charge pushed 34 cm forward: "Off balance: the weight is N cm ahead of the motors’ middle"', /Off balance: the weight is \d+ cm ahead of the motors’ middle; it will drift and fight itself\./.test(W.balance), W.balance);
  ok('motors under the frame with nothing lower: "The props touch the ground first: add landing legs."; legs under it: no such warning',
    W.props.includes('The props touch the ground first: add landing legs.') && !W.legs.includes('props touch'), [W.props, W.legs]);
  ok('the Lancett (its tail keeps its lift behind its weight): no wing warning, and its line: it flies on its wing, fits the Launch Tubes', !/Wing ahead/.test(W.lancett) && /Flies on its wing: it can’t hover · fits: Launch Tubes/.test(W.lancettAir), [W.lancett, W.lancettAir]);
  ok('its wing moved 20 cm forward: "Wing ahead of the balance point: it will flip. Move the wing back or the battery forward."', W.wingFwd.includes('Wing ahead of the balance point: it will flip. Move the wing back or the battery forward.'), W.wingFwd);
  ok('an armour part aboard: "Armour parts don’t work on a drone."; no camera: a grey note "No camera: you’ll fly it from behind"', W.armour.includes('Armour parts don’t work on a drone.') && /No camera: you’ll fly it from behind/.test(W.noCam), [W.armour, W.noCam]);
  // the tray's one-liners and the part panel's numbers (old parts' unchanged: gated on the new fields)
  const L = await ev(() => { const sl = (k) => Builder.specLine(PARTS[k]), ps = (k) => Builder.partSpecs(makePart(k, 0, 0));
    return { fc: sl('drFC'), gps: sl('drFCgps'), frame: sl('drFrameS'), motor: sl('drMotorS'), batt: sl('drBattS'), link: sl('drLink'), cam: sl('drCam'), gim: sl('drGimbal'), charge: sl('drCharge'), frag: sl('drChargeHE'),
      dock: sl('dockRack'), jam: sl('cdJam'), det: sl('cdDetect'), gun: sl('cdGun'), laser: sl('cdLaser'), cage: sl('cdCage'), radar: sl('cdRadar'),
      pMotor: ps('drMotorS'), pBatt: ps('drBattS'), pLink: ps('drLink'), pFibre: ps('drSpool'), pSat: ps('drSat'), pCam: ps('drCam'), pGim: ps('drGimbal'), pCharge: ps('drCharge'), pDock: ps('dockRack'),
      old: [sl('jet'), sl('tankL'), sl('wingL'), sl('gun85'), sl('hullMedium'), sl('radarPD')], oldWant: [`${PARTS.jet.thrust} kN · ${PARTS.jet.ispVac}s`, `${PARTS.tankL.fuel} t fuel`, `${PARTS.wingL.wing.area} m² · ${PARTS.wingL.wing.span} m span`] }; });
  ok('the tray: FPV · 108 km/h, GPS · 58 km/h, 4 motors · 0.36 m, 1.6 kgf · 4.2 g/W, 50 Wh, Radio 2.5 km, FPV 100°, Zoom 12× · thermal, 350 mm, frag',
    L.fc === 'FPV · 108 km/h' && L.gps === 'GPS · 58 km/h' && L.frame === '4 motors · 0.36 m' && L.motor === '1.6 kgf · 4.2 g/W' && L.batt === '50 Wh' && L.link === 'Radio 2.5 km' && L.cam === 'FPV 100°' && L.gim === 'Zoom 12× · thermal' && L.charge === '350 mm' && L.frag === 'frag', JSON.stringify(L));
  ok('...the kit: 3 drones ≤ $3,000, Jams 500 m, Hears 2 km, 600 m · airburst, 1 km · laser, slats 50% (the Drone Radar 4 km)',
    L.dock === '3 drones ≤ $3,000' && L.jam === 'Jams 500 m' && L.det === 'Hears 2 km' && L.gun === '600 m · airburst' && L.laser === '1 km · laser' && L.cage === 'slats 50%' && L.radar === '4 km', JSON.stringify(L));
  ok('the part panel: Thrust 1.6 kgf · 4.2 g/W · torque 40; Charge 50 Wh; Range 2.5 km · jammable / can’t be jammed / lag 0.25 s; Field 100° · tilted 25° up; Zoom 1-12× · thermal · spots 3 km; Pierces 350 mm · contact fuse · arms 20 m out; Carries 3 drones: up to 3.5 kg, 0.8 m, $3,000 each',
    L.pMotor.includes('Thrust 1.6 kgf · 4.2 g/W · torque 40') && L.pBatt.includes('Charge 50 Wh') && L.pLink.includes('Range 2.5 km · jammable') && L.pFibre.includes('Range 5 km · can’t be jammed') && L.pSat.includes('Range 50 km · lag 0.25 s')
    && L.pCam.includes('Field 100° · tilted 25° up') && L.pGim.includes('Zoom 1-12× · thermal · spots 3 km') && L.pCharge.includes('Pierces 350 mm · contact fuse · arms 20 m out') && L.pDock.includes('Carries 3 drones: up to 3.5 kg, 0.8 m, $3,000 each'), JSON.stringify(L));
  ok('...old parts keep their words', L.old.slice(0, 3).join('|') === L.oldWant.join('|') && !L.old.some((t) => /kgf|Wh|drone/.test(t)), JSON.stringify(L.old));
  // the scale: a drone's blueprint zooms ten times closer, its grid is 2.5 cm and its free placing 5 mm
  const S = await ev(() => {
    if (App.preview3D()) App.setPreview3D(false); // (the grid is the 2D blueprint's)
    Builder.loadTemplate('bumble'); Builder.fitView(); const fit = Builder.cam.scale;
    for (let i = 0; i < 40; i++) Builder.zoomAt(1.5, innerWidth / 2, innerHeight / 2); const max = Builder.cam.scale;
    const free = Builder.snap('drCam', { x: 0.1234, y: 0.5345 }, [], 0); Builder.grid = true; const grid = Builder.snap('drCam', { x: 0.1234, y: 0.5345 }, [], 0); Builder.grid = false; // (in the air above it)
    Builder.loadTemplate('hopper'); Builder.fitView(); const rocket = Builder.cam.scale; for (let i = 0; i < 40; i++) Builder.zoomAt(1.5, innerWidth / 2, innerHeight / 2);
    return { fit, max, free: [free.x, free.y], grid: [grid.x, grid.y], rocket, rmax: Builder.cam.scale };
  });
  const on = (v, k) => Math.abs(v * k - Math.round(v * k)) < 1e-6;
  ok('a drone\'s blueprint: fitted ten times closer than a rocket\'s (up to 600 px/m), zooms to 900 (a rocket\'s still 90)', S.fit > 100 && S.fit <= 600 && S.max === 900 && S.rocket <= 60 && S.rmax === 90, JSON.stringify(S));
  ok('...its grid is 2.5 cm and its free placing 5 mm', S.grid.every((v) => on(v, 40)) && S.free.every((v) => on(v, 200)) && !S.free.every((v) => on(v, 40)), JSON.stringify(S));
}

// ---- 12. (the big update) a tank's drone bay: where a tap puts it, its panel row and picker, the stats and warnings
{
  await stockDrones(page);
  await ev(() => { store.set('rss.hangar', [{ name: 'Wasp <b>Mk2</b>', kind: 'drone', parts: templateRows(TEMPLATES.bumble).concat([{ type: 'drBattL', x: -0.03, y: -0.2025, rot: 0, flip: false, att: 9 }]) },
    { name: 'My quad', kind: 'drone', parts: templateRows(TEMPLATES.bumble) }, { name: 'A plane', kind: 'plane', parts: templateRows(TEMPLATES.skylark) }]); Builder.loadTemplate('bmk2'); });
  await page.locator('#palette-tabs .tab', { hasText: /^Launchers$/ }).tap();
  const tray = await ev(() => [...document.querySelectorAll('#palette-items > *')].map((e) => (e.classList.contains('tray-group') ? '#' + e.textContent : e.querySelector('.part-name').textContent)));
  ok('Launchers: the bays last, behind a Drones label', tray.slice(-4).join('|') === '#Drones|Drone Rack|Drone Hangar|Launch Tubes', tray.join('|'));
  await page.locator('#palette-items .part-item', { has: page.locator('.part-name', { hasText: /^Drone Rack$/ }) }).tap();
  await frames(page, 2);
  r = await ev(() => { const p = Builder.selected, h = Builder.parts.find((q) => q.id === p.att), H = partRect(h), T = Builder.parts.find((q) => q.def.place === 'ring');
    return { type: p.type, att: h.type, onDeck: Math.abs(partRect(p).b - H.t) < 0.01, behind: partRect(p).r <= partRect(T).l + 0.01, z: partZ(p), clash: Builder.parts.some((q) => q !== p && partsClash(p, q)),
      row: !$('#pi-dock').hidden, btn: $('#btn-dock').textContent, line: $('#s-ground').textContent }; });
  ok('a Drone Rack tapped: on the hull\'s back deck behind the turret, hung on the hull, clear of everything', r.type === 'dockRack' && r.att === 'hullIFV' && r.onDeck && r.behind && r.z === 0 && !r.clash, JSON.stringify(r));
  ok('...its panel row: "Carries: Bumble FPV ×3 ▸"; the stats line ends "drones: Bumble FPV ×3"', r.row && r.btn === 'Carries: Bumble FPV ×3 ▸' && /· drones: Bumble FPV ×3$/.test(r.line), JSON.stringify(r));
  await page.screenshot({ path: SHOTS + 'w3-phone-rack.png' });
  await page.locator('#btn-dock').tap();
  await frames(page, 2);
  r = await ev(() => ({ open: UI.modalOpen, title: $('#modal-card .modal-title').textContent, bold: !!$('#modal-card b'),
    cards: [...document.querySelectorAll('#modal-card .dock-pick .design')].map((d) => [d.querySelector('.template-name').textContent, d.querySelector('.template-blurb').textContent, (d.querySelector('.dock-ok') || d.querySelector('.dock-why')).textContent, d.querySelector('button').disabled, !!d.querySelector('canvas')]),
    foot: $('#modal-card .dock-foot').textContent }));
  const names = r.cards.map((c) => c[0]), stock = await ev(() => Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].kind === 'drone').map((k) => TEMPLATES[k].name));
  ok('the picker: the stock drones in order, then the hangar\'s drones (not its plane), each with its picture, weight, width and price', r.open && names.join('|') === [...stock, 'Wasp <b>Mk2</b>', 'My quad'].join('|') && r.cards.every((c) => c[4] && /^\d+\.\d kg · \d\.\d\d m · \$[\d,]+$/.test(c[1])), JSON.stringify(r.cards));
  const card = (n) => r.cards.find((c) => c[0] === n);
  ok('...a tick on those that fit; the Mavik dimmed "Too dear: $3,190 of $3,000", the heavy one "Too heavy: …", the Lancett too dear or winged; a name\'s markup shown as text',
    card('Bumble FPV')[2] === '✓ fits' && !card('Bumble FPV')[3] && card('Mavik Scout')[2] === 'Too dear: $3,190 of $3,000' && card('Mavik Scout')[3] && /^Too heavy: /.test(card('Wasp <b>Mk2</b>')[2]) && /^(Too dear|Takes winged drones only)/.test(card('Lancett')[2]) && card('Lancett')[3] && !r.bold, JSON.stringify(r.cards));
  ok('...its footer: the rack\'s price covers three drones of up to $3,000 each', /The rack’s price covers three drones of up to \$3,000 each: a cheaper one gives no money back\./.test(r.foot), r.foot);
  await page.screenshot({ path: SHOTS + 'w3-phone-picker.png' });
  await page.locator('#modal-card .dock-pick .design-main', { hasText: 'My quad' }).tap();
  await frames(page, 2);
  r = await ev(() => ({ open: UI.modalOpen, choice: Builder.droneChoice, ser: Builder.serialize().drone, btn: $('#btn-dock').textContent, line: $('#s-ground').textContent, dirty: Builder.isDirty() }));
  ok('picking My quad: the bays carry it (droneChoice: its rows), the design carries it, the row says so', !r.open && r.choice && r.choice.name === 'My quad' && r.choice.parts.length === 10 && JSON.stringify(r.ser) === JSON.stringify(r.choice) && r.btn === 'Carries: My quad ×3 ▸' && /drones: My quad ×3$/.test(r.line), JSON.stringify(r));
  r = await ev(() => { Builder.undo(); const a = Builder.droneChoice; Builder.redo(); return [a, Builder.droneChoice && Builder.droneChoice.name]; });
  ok('...one undo step', r[0] === null && r[1] === 'My quad', JSON.stringify(r));
  r = await ev(() => { Builder.droneChoice = { key: 'mavik' }; Builder.changed(); Builder.selected = Builder.parts.find((p) => p.type === 'dockRack'); Builder.renderInfo(); return { warn: $('#s-warn').textContent, btn: $('#btn-dock').textContent }; });
  ok('a pick the rack can\'t carry (the Mavik): "The Drone Rack can’t carry the Mavik Scout (too dear): it carries the Bumble FPV."', r.warn.includes('The Drone Rack can’t carry the Mavik Scout (too dear): it carries the Bumble FPV.') && r.btn === 'Carries: Bumble FPV ×3 ▸', JSON.stringify(r));
  r = await ev(() => { Builder.addPart('drCam', -1, 2.5, 0, { att: Builder.parts[0] }); return $('#s-warn').textContent; });
  ok('a drone part on a tank: "Drone parts only work on a drone: carry one in a Drone Rack, Hangar or Launch Tubes."', r.includes('Drone parts only work on a drone: carry one in a Drone Rack, Hangar or Launch Tubes.'), r);
  r = await ev(() => { Builder.loadTemplate('bmk2'); const a = Builder.serialize(); Builder.droneChoice = { key: 'bumble' }; Builder.changed(); return [JSON.stringify(a) === JSON.stringify(Builder.serialize()), 'drone' in Builder.serialize()]; });
  ok('a design without bays never carries a pick: byte-identical', r[0] && !r[1], JSON.stringify(r));
  // the roof cage: centred over the turret, its bottom on the turret's roof, hung on the turret
  r = await ev(() => { Builder.loadTemplate('ma1'); Builder.parts = Builder.parts.filter((p) => p.type !== 'mgHeavy'); Builder.changed(); Builder.quickAdd('cdCage');
    const c = Builder.selected, t = Builder.parts.find((p) => p.id === c.att); return { type: c.type, att: t.type, x: +(c.x - t.x).toFixed(3), z: partZ(c) - partZ(t), gap: +(partRect(c).b - partRect(t).t).toFixed(3), clash: Builder.parts.some((q) => q !== c && partsClash(c, q)) }; });
  ok('a Roof Cage tapped on the MA-1 (its roof HMG off): over the turret\'s middle, its bottom on the turret roof, hung on the turret', r.type === 'cdCage' && r.att === 'turretWedge' && r.x === 0 && r.z === 0 && r.gap === 0 && !r.clash, JSON.stringify(r));
  // the hangar: building a drone, the stock drones first
  r = await ev(() => { Builder.loadTemplate('bumble'); Builder.openHangar(); const h = [...document.querySelectorAll('#modal-card .summary-h')].map((e) => e.textContent); UI.closeModal(); return h; });
  ok('the hangar, building a drone: Drones first after your designs', r[1] === 'Drones', r.join(' | '));
}

ok('no page errors', errs.length === 0, errs.join('\n'));
ok.done();
await b.close(); srv.close();
