// Building armour on a phone: six taps make a working tank (hull, track, engine, ring, turret, gun), each part
// where it goes; the kind strip fits at every size; the stats and warnings speak tank; the armour stepper dials a
// plate's thickness, which costs mass and money and survives saving, a design code and a reload; plates go flush on a
// face; parts pair up across the hull; X-ray, the armour view, the arcs and the sweep's late answer redraw once.
// From the build screen as a new player first meets it (the stock Hopper), Armour starts an empty design.
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
  ok(`${w} × ${h}: every kind button fits its label`, f.length === 5 && f.every(([, s, c]) => s <= c), JSON.stringify(f));
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

ok('no page errors', errs.length === 0, errs.join('\n'));
ok.done();
await b.close(); srv.close();
