// Ships WP6 in the real game (spec §4.4, §4.8): a hydrofoil flying on her foils, and a helicopter on a ship's deck.
//  - a hydrofoil (the Pegazus where the catalogue has her; else ships-drive.test.js's stand-in on its test parts) launched
//    from the hangar at the bay, rung to Flank: foilborne past 30 kn, her hull clear of the water; a screenshot;
//  - the Dragonfly launched from the hangar, then set down on the helicopter deck of a Cyclon (a test deck: WP5's
//    helipad where it exists) steaming at about 15 kn: lashed, riding her; a screenshot; full throttle lifts it off;
//  - no console errors (App.frame swallows them). Waits on Flight.time (Render3D.skipDraw while the sim runs).
// SHOTS=<dir> saves the screenshots there (ship-drive-*.png; default test/.cache/shots).
//   node test/browser/ship-drive.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || path.join(ROOT, 'test', '.cache', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('ship drive: a hydrofoil foilborne, a helicopter lashed on a deck under way');

// the test parts (ships-drive.test.js's T6, the ones used here) and the two designs, unless the catalogue has them
const setup = () => {
  const T = {
    tstTurbine: { gv: true, ship: true, place: 'inside', cat: 'shDrive', name: 'Gas Turbine', w: 8, h: 3, depth: 3, mass: 22, shape: 'tkit', style: 'engine', inner: true, flush: true, module: 'engine', hp: 2500, tier: 2, cost: 4000, engine: { kw: 20000, fuel: 'turbine', spool: 15 } },
    tstJet: { gv: true, ship: true, place: 'stern', cat: 'shDrive', name: 'Waterjet', w: 3, h: 1.4, depth: 1.4, mass: 4, shape: 'tkit', hp: 600, tier: 1, cost: 2500, jet: { D: 1.4, steer: 30, bucket: 0.5 } },
    tstFoilBow: { gv: true, ship: true, place: 'bow', cat: 'shDrive', name: 'Bow Hydrofoil', w: 2, h: 3.6, depth: 6, mass: 4, shape: 'tkit', hp: 500, tier: 2, cost: 3000, foil: { kind: 'foil', n: 'y', area: 7, ar: 5, chord: 1.2, inc: 2, y: -1.6, ride: true, max: 8, load: 1500 } },
    tstFoilAft: { gv: true, ship: true, place: 'keel', cat: 'shDrive', name: 'Main Hydrofoil', w: 2.4, h: 3.6, depth: 12, mass: 9, shape: 'tkit', hp: 900, tier: 2, cost: 5000, foil: { kind: 'foil', n: 'y', area: 15, ar: 6, chord: 1.6, inc: 2, y: -1.6, ride: true, intake: true, h: 1.6, struts: 2, load: 3500 } },
    tstBallast: { gv: true, ship: true, place: 'inside', cat: 'shKit', name: 'Fuel and Ballast (×5)', w: 3, h: 0.8, depth: 2.5, mass: 50, shape: 'tkit', inner: true, flush: true, hp: 2000, tier: 1, cost: 100 },
    tstPad: { gv: true, ship: true, place: 'deck', cat: 'shSuper', name: 'Helicopter Deck', w: 12, h: 0.4, depth: 7, mass: 3, shape: 'tkit', hp: 2500, tier: 1, cost: 1500, deck: { hl: 5.8, hw: 3.4 } },
  };
  for (const k in T) if (!PARTS[k]) { PARTS[k] = T[k]; T[k].type = k; T[k].maxTemp = 2000; }
  if (!TEMPLATES.pegazus) TEMPLATES.tstHydro = { name: 'Test Hydrofoil', kind: 'ship', tier: 2, blurb: '',
    parts: [['hbSternM', -17, 0], ['hbMidM', -10, 0], ['hbMidM', -2, 0], ['hbMidM', 6, 0], ['hbBowM', 15, 0.3], ['bridgeM', 5, 3.5, 0, { att: 3 }],
      ['tstTurbine', -10, -0.2, 0, { att: 1 }], ['tstFoilBow', 12, -3.8, 0, { att: 4 }], ['tstFoilAft', -6, -3.8, 0, { att: 2 }], ['tstJet', -21.5, -1.4, 0, { att: 0 }], ['tstBallast', -2, -1.2, 0, { att: 2 }]] };
  window.__errs = [];
  addEventListener('error', (e) => window.__errs.push('onerror ' + e.message));
  for (const [o, k, n] of [[Flight, 'update', 'Flight.update'], [Render3D, 'renderFlight', 'Render3D.renderFlight'], [Ship, 'frame', 'Ship.frame'], [Ship, 'lashStep', 'Ship.lashStep']]) {
    const f = o[k]; o[k] = function (...a) { try { return f.apply(this, a); } catch (e) { window.__errs.push(`${n}: ${e && e.stack}`); throw e; } };
  }
};
const frames = (page, n = 2) => page.evaluate((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const until = (page, t) => page.waitForFunction((t) => Flight.time > t, t, { timeout: 600000, polling: 500 });
async function fly(page, key) {
  await page.waitForFunction(() => Terrain.earthMap.state !== 'loading', null, { timeout: 120000 });
  await page.evaluate(async (key) => { await Render3D.load(); App.toBuild(); Builder.loadTemplate(key); store.set('rss.flight', null); App.launch(); }, key);
  await page.waitForFunction(() => Flight.running && Flight.active && Flight.time > 0.5, null, { timeout: 180000 });
}
const pageErrors = async (page, tag) => { const e = await page.evaluate(() => window.__errs.splice(0)); for (const x of e) errs.push(tag + x); };

const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } }), page = await ctx.newPage();
watch(page, errs, 'desktop ');
await openGame(page, srv.url, { hints: false });
await page.evaluate(setup);

// ---- the hydrofoil
if (!process.env.SKIPHF) {
await fly(page, await page.evaluate(() => (TEMPLATES.pegazus ? 'pegazus' : 'tstHydro')));
await page.evaluate(() => { Render3D.skipDraw = true; Flight.active.sh.tel = 4; });
const t0 = await page.evaluate(() => Flight.time);
await until(page, t0 + 45);
await page.evaluate(() => { Render3D.skipDraw = false; });
await page.waitForTimeout(3000); await frames(page, 4);
const hf = await page.evaluate(() => { const v = Flight.active; return { kn: v.speed() * SHIP.KN, fsub: v.sh.fsub, c: v.sh.ride && v.sh.ride.c, heel: v.heel * 57.3, trim: v.trim * 57.3, parts: v.parts.length, t: Flight.time }; });
await page.screenshot({ path: path.join(SHOTS, 'ship-drive-hydrofoil.png') });
ok(`a hydrofoil rung to Flank flies on her foils in the game: ${hf.kn.toFixed(0)} kn, her hull clear (${(hf.fsub * 100).toFixed(1)} % of her weight on it), her keel ${hf.c && hf.c.toFixed(2)} m over the waves`, hf.kn > 30 && hf.fsub < 0.02 && hf.c > 0.8, hf);
await pageErrors(page, 'hydrofoil ');
}

// ---- the helicopter on a deck under way
await fly(page, 'dragonfly');
await page.evaluate(() => {
  Render3D.skipDraw = true;
  const rows = [...templateRows(TEMPLATES.cyclon), { type: PARTS.helipad && PARTS.helipad.deck ? 'helipad' : 'tstPad', x: -10, y: 2.2, rot: 0, flip: true, att: 1 }];
  const parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
  const ps = parts.filter((p) => keep.has(p.id)), adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const s = new Vessel(ps, adj, EARTH); s.kind = 'ship'; s.name = 'Cyclon'; s.stages = computeStages(ps, adj, ctrl.id); s.rebuildGroups();
  s.placeOnSurface(EARTH, siteAngle(EARTH, -2300), 0, -2600, Math.PI); Ship.launch(s, { e: -2300, z: -2600, yaw: Math.PI });
  s.sh.tel = 1; Flight.vessels.push(s); window.__ship = s;
});
let t1 = await page.evaluate(() => Flight.time);
await until(page, t1 + 40);
await page.evaluate(() => { // the Dragonfly set down just over the deck, at her speed
  const s = window.__ship, h = Flight.active, pad = s.parts.find((p) => p.def.deck), P = s.toWorld(pad.x, pad.y + pad.def.h / 2, 0), r = Math.hypot(P.x, P.y, P.z), U = { x: P.x / r, y: P.y / r, z: P.z / r };
  const L = Terrain.locate(EARTH, h.x, h.y, h.z), hc = h.radius() - EARTH.radius - Terrain.surfaceAt(EARTH, L.a, L.z);
  h.x = P.x + U.x * (hc + 0.4); h.y = P.y + U.y * (hc + 0.4); h.z = P.z + U.z * (hc + 0.4);
  const dv = s.pointVel(v3(h.x - s.x, h.y - s.y, h.z - s.z)); h.vx = dv.x; h.vy = dv.y; h.vz = dv.z; h.av = v3(s.av.x, s.av.y, s.av.z); h.throttle = 0; h.landed = false; h.restTime = 0;
});
t1 = await page.evaluate(() => { window.__dbg = []; const h = Flight.active, s = window.__ship; window.__dbgT = setInterval(() => { const X = s.toLocal(h.x, h.y, h.z), dv = s.pointVel(v3(h.x - s.x, h.y - s.y, h.z - s.z)); window.__dbg.push([Flight.time.toFixed(2), X.x.toFixed(2), X.y.toFixed(2), Math.hypot(h.vx - dv.x, h.vy - dv.y, h.vz - dv.z).toFixed(2), h.thrust.toFixed(0), (h.lift || 0).toFixed(0), h.throttle, (h._lashT || 0).toFixed(2), !!h._deckHit, h.wheelsDown, Ship.D.length].join(' ')); }, 300); return Flight.time; });
await until(page, t1 + 8);
if (process.env.DBG) console.log((await page.evaluate(() => window.__dbg)).join('\n'));
await page.evaluate(() => { Render3D.skipDraw = false; });
await page.waitForTimeout(3000); await frames(page, 4);
const dk = await page.evaluate(() => { const s = window.__ship, h = Flight.active, X = s.toLocal(h.x, h.y, h.z); return { kn: s.speed() * SHIP.KN, lashed: !!h.lash, X, D: Ship.D.length, parts: h.parts.length }; });
await page.screenshot({ path: path.join(SHOTS, 'ship-drive-heli-deck.png') });
ok(`the Dragonfly set down on a Cyclon's helicopter deck at ${dk.kn.toFixed(1)} kn is lashed there (on the deck: ${dk.X.x.toFixed(1)}, ${dk.X.y.toFixed(1)}, ${dk.X.z.toFixed(1)} in her frame)`, dk.lashed && dk.D === 1 && Math.abs(dk.X.x + 10) < 6 && dk.X.y > 2.4 && dk.X.y < 7, dk);
await page.evaluate(() => { Flight.setThrottle(1); if (!Flight.active.parts.some((p) => p.active)) Flight.stage(); });
t1 = await page.evaluate(() => Flight.time);
await until(page, t1 + 6);
const lo = await page.evaluate(() => { const s = window.__ship, h = Flight.active, X = s.toLocal(h.x, h.y, h.z); return { lashed: !!h.lash, up: X.y, dead: h.dead }; });
await page.screenshot({ path: path.join(SHOTS, 'ship-drive-heli-off.png') });
ok(`...staged and full throttle, it lifts off the deck (${lo.up.toFixed(1)} m in her frame)`, !lo.lashed && lo.up > 8 && !lo.dead, lo);
await pageErrors(page, 'deck ');

ok(`no console errors (${errs.length})`, errs.length === 0, errs.slice(0, 5));
await ctx.close(); await b.close(); srv.close();
ok.done();
