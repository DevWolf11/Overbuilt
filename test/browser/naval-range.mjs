// The Naval Range (the ships update, WP10: spec §9.1, §9.2), in the game as a player meets it:
//  - Practice (Settings → Targets: Practice), the Arley Berk launched from the hangar off the slipway (Spawns): within a
//    second the bar ("Naval Range: 0 sunk", "Practice · they don't shoot back"), the hulk moored 2 km ahead and three
//    ships steaming their loops; her 127 mm through the gunner's sight on the hulk, FIRE held, until it sinks: SUNK, the
//    bar's "1 sunk" and the best shot (ships held to their own physics: nothing scripted but the aim);
//  - Hostile, her bow east 5 km nearer Shetland (Flight.start at a sea place): "the first ships come from the east", the
//    first wave 20 s in, two Cyclons that close and fight; she survives 60 s of Flight.time with her own guns, CIWS and
//    the computer's ships' fire about her; the bar's wave and ships left;
//  - on a phone in portrait (390×844) and a desktop (1280×720): the bar on the screen, clear of the helm panel and the
//    minimap, screenshots (naval-*.png) to look at; no console errors (App.frame swallows them).
// Times on Flight.time (headless Chromium runs the sim at about 0.08× real time: the drawing is off while waiting,
// Render3D.skipDraw). SHOTS=<dir> saves the screenshots there (default test/.cache/shots).
//   node test/browser/naval-range.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const SHOTS = process.env.SHOTS || path.join(ROOT, 'test', '.cache', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => page.screenshot({ path: path.join(SHOTS, `naval-${name}.png`) });
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('naval range: Practice (a hulk sunk with the Arley\'s gun) and Hostile (a wave survived), the bar, phone and desktop');

const instrument = () => {
  window.__errs = [];
  addEventListener('error', (e) => window.__errs.push('onerror ' + e.message));
  for (const [o, k, n] of [[Flight, 'update', 'Flight.update'], [Render3D, 'renderFlight', 'Render3D.renderFlight'], [GHUD, 'draw', 'GHUD.draw'], [Ship, 'frame', 'Ship.frame']]) {
    const f = o[k]; o[k] = function (...a) { try { return f.apply(this, a); } catch (e) { window.__errs.push(`${n}: ${e && e.stack}`); throw e; } };
  }
};
async function open(vp, tag, settings) {
  const ctx = await b.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: vp[2], isMobile: vp[2] }), page = await ctx.newPage();
  watch(page, errs, tag);
  await openGame(page, srv.url, { hints: false, ...settings });
  await page.evaluate(instrument);
  return { ctx, page };
}
const pageErrors = async (page, tag) => { const e = await page.evaluate(() => window.__errs.splice(0)); for (const x of e) errs.push(tag + x); };
const frames = (page, n = 2) => page.evaluate((n) => new Promise((done) => { let i = 0; const f = () => (++i >= n ? done() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// the Arley from the hangar: off the slipway (Spawns), or at a sea place of the test's
async function sail(page, place) {
  await page.waitForFunction(() => Terrain.earthMap.state !== 'loading', null, { timeout: 180000 });
  await page.evaluate(async (place) => {
    await Render3D.load(); App.toBuild(); Builder.loadTemplate('arley'); store.set('rss.flight', null);
    if (place) { App.showScene('flight'); Flight.start(Builder.serialize(), { place }); }
    else { Spawns.choose('ship', 'slipway'); App.launch(); }
  }, place || null);
  await page.waitForFunction(() => Flight.running && Flight.active && Flight.active.name === TEMPLATES.arley.name && Flight.time > 0.6, null, { timeout: 180000 });
  await page.evaluate(() => {
    window.__simWait = async (dt, draw) => { Render3D.skipDraw = !draw; const f = () => new Promise((r) => requestAnimationFrame(r)), t0 = Flight.time, w0 = performance.now(); while (Flight.time < t0 + dt && performance.now() - w0 < 900000) await f(); Render3D.skipDraw = false; };
    window.__until = async (cond, max, draw) => { Render3D.skipDraw = !draw; const f = () => new Promise((r) => requestAnimationFrame(r)), t0 = Flight.time, w0 = performance.now(); while (!cond() && Flight.time < t0 + max && performance.now() - w0 < 1500000) await f(); Render3D.skipDraw = false; return cond(); };
    // the aim (in the sight) put on a vessel's middle: the camera's ray, a few frames to settle (ship-flight.mjs's way)
    window.__aimAt = async (t) => { const v = Flight.active, RAY = { o: v3(), d: v3() };
      for (let i = 0; i < 4; i++) {
        const r = Math.hypot(v.x, v.y, v.z), ux = v.x / r, uy = v.y / r, uz = v.z / r, el = Math.hypot(ux, uy), ex = uy / el, ey = -ux / el, nx = ey * uz, ny = -ex * uz, nz = ex * uy - ey * ux;
        const O = Render3D.aimRay(RAY).o, tr = Math.hypot(t.x, t.y, t.z), dx = t.x + (t.x / tr) * 2 - O.x, dy = t.y + (t.y / tr) * 2 - O.y, dz = t.z + (t.z / tr) * 2 - O.z, d = Math.hypot(dx, dy, dz);
        Flight.aimYaw = Math.atan2(-(dx * nx + dy * ny + dz * nz) / d, (dx * ex + dy * ey) / d); Flight.aimPitch = Math.asin((dx * ux + dy * uy + dz * uz) / d);
        await window.__simWait(0.1, true);
      }
      GHUD._S.aimAt = -1e9; GHUD.aimUpdate(Flight); return Flight.aim && Flight.aim.v === t; };
    window.__sel = (key) => { const v = Flight.active, i = Combat.systems(v).findIndex((s) => s.key === key); if (i >= 0) v.wsel = i; return i; };
  });
  await page.waitForTimeout(1200); await frames(page, 2);
}
// the bar: its text, on the screen, clear of the helm panel's box and the minimap's
const barOf = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s), box = (e) => { if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' ? r : null; };
  const B = box(q('#naval-bar')), H = box(q('#ship-helm')), M = box(q('.gmap')), W = innerWidth, Hh = innerHeight;
  const over = (a, c) => !!a && !!c && a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1;
  return { shown: !!B, text: B ? q('#naval-bar').innerText.replace(/\s+/g, ' ').trim() : '', inside: !!B && B.left >= 0 && B.top >= 0 && B.right <= W && B.bottom <= Hh, helm: over(B, H), map: over(B, M), warp: !!q('#warp') && !q('#warp').hidden };
});

for (const vp of [[1280, 720, false], [390, 844, true]]) {
  const tag = `${vp[0]}×${vp[1]} `, sz = `${vp[0]}x${vp[1]}`;
  // ---- Practice: the hulk sunk with the Arley's 127 mm
  {
    const { ctx, page } = await open(vp, tag + 'practice ', { targets: 'practice' });
    await sail(page);
    const set = await page.evaluate(async () => { await window.__simWait(1.5); const R = Ship.naval, ships = Ship.aiShips.map((v) => v.ai.key + ':' + v.ai.role), hulk = Ship.aiShips.find((v) => v.ai.role === 'passive');
      window.__hulk = hulk; return { mode: R && R.mode, ships, d: hulk ? Math.round(Math.hypot(hulk.x - Flight.active.x, hulk.y - Flight.active.y, hulk.z - Flight.active.z)) : 0 }; });
    const bar0 = await barOf(page);
    await frames(page, 3); await shot(page, `practice-start-${sz}`);
    ok(`${tag}Practice: the range on (${set.ships.join(', ')}), the hulk ${set.d} m ahead, the bar "${bar0.text}" on the screen (clear of the helm and the minimap, the time warp hidden)`,
      set.mode === 'practice' && set.ships.length === 4 && set.d > 1500 && set.d < 2600 && bar0.shown && bar0.inside && !bar0.helm && !bar0.map && !bar0.warp && /Naval Range: 0 sunk/.test(bar0.text) && /Practice/.test(bar0.text), { set, bar0 });
    // her 127 mm on it through the sight, FIRE held until it goes down (the aim put back on it every few seconds: it bobs)
    const sunk = await page.evaluate(async () => { const v = Flight.active, h = window.__hulk; window.__sel('nGun127'); Flight.setSight(true, 6); await window.__aimAt(h);
      Flight.touchFire = true; const t0 = Flight.time;
      for (let k = 0; k < 40 && !h.fate; k++) { await window.__until(() => !!h.fate, 6); if (!h.fate) await window.__aimAt(h); }
      const t1 = Flight.time; Flight.touchFire = false; Flight.setSight(false);
      await window.__until(() => h.sunk != null || h.dead, 40);
      return { fate: h.fate || '', secs: Math.round(t1 - t0), kos: Ship.naval && Ship.naval.kos, rounds: 20 - (v.parts.find((p) => p.type === 'nGun127').ammo || 0) }; });
    await frames(page, 4);
    const bar1 = await barOf(page);
    await shot(page, `practice-sunk-${sz}`);
    ok(`${tag}...the hulk sunk by her 127 mm (${sunk.fate} after ${sunk.secs} s of FIRE, ${sunk.rounds} rounds and more from the magazine): the bar "${bar1.text}"`,
      !!sunk.fate && sunk.kos === 1 && /1 sunk/.test(bar1.text) && /best shot/.test(bar1.text) && bar1.inside, { sunk, bar1 });
    await pageErrors(page, tag + 'practice ');
    await ctx.close();
  }
  // ---- Hostile: a wave survived for 60 s
  {
    const { ctx, page } = await open(vp, tag + 'hostile ', { targets: 'hostile' });
    await sail(page, { e: 9500, z: 0, yaw: 0 });
    const set = await page.evaluate(async () => { await window.__simWait(1.5); return { mode: Ship.naval && Ship.naval.mode, toasts: [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | ') }; });
    const bar0 = await barOf(page);
    const wave = await page.evaluate(async () => { await window.__until(() => Ship.naval && Ship.naval.left.length > 0, 30); const L = Ship.naval.left; return { wave: Ship.naval.wave, ships: L.map((v) => v.ai.key + '@' + v.ai.skill.toFixed(1)), d: L.map((v) => Math.round(Math.hypot(v.x - Flight.active.x, v.y - Flight.active.y, v.z - Flight.active.z))), t: Flight.time }; });
    // 60 s of the wave: she holds her ground (Half ahead, the heading held) and fights with her guns and CIWS on the aim
    // nearest her, as a player would; a picture once they are firing
    const fight = await page.evaluate(async () => { const v = Flight.active, L = Ship.naval.left.slice(); Ship.setTel(v, 2); window.__sel('nGun127'); const t0 = Flight.time; let fired = 0, seenAt = null;
      while (Flight.time < t0 + 60 && !Flight.destroyed) {
        const near = L.filter((o) => !o.dead && !o.fate).sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y, a.z - v.z) - Math.hypot(b.x - v.x, b.y - v.y, b.z - v.z))[0];
        if (near) { await window.__aimAt(near); Flight.touchFire = true; }
        await window.__simWait(5);
        if (seenAt == null && L.some((o) => o.ai && o.ai.fired > 0)) seenAt = Flight.time;
      }
      Flight.touchFire = false;
      for (const o of L) fired += (o.ai && o.ai.fired) || 0;
      return { secs: Math.round(Flight.time - t0), alive: !Flight.destroyed && !v.fate, fate: v.fate || '', fired, seenAt, holes: +v.parts.reduce((s, p) => s + (p.holes ? p.holes.reduce((q, h) => q + h.a, 0) : 0), 0).toFixed(2), left: Ship.naval ? Ship.naval.left.length : -1, d: L.map((o) => Math.round(Math.hypot(o.x - v.x, o.y - v.y, o.z - v.z))), st: L.map((o) => o.ai && o.ai.state) }; });
    await page.evaluate(async () => { await window.__simWait(0.6, true); });
    const bar1 = await barOf(page);
    await shot(page, `hostile-${sz}`);
    ok(`${tag}Hostile: the range on, the bar "${bar0.text}" (clear of the helm and the minimap); wave ${wave.wave} (${wave.ships.join(', ')}) ${wave.d.join(' and ')} m off at ${wave.t.toFixed(0)} s`,
      set.mode === 'hostile' && bar0.shown && bar0.inside && !bar0.helm && !bar0.map && /Hostile/.test(bar0.text) && wave.wave === 1 && wave.ships.join() === 'cyclon@0.2,cyclon@0.2', { set, bar0, wave });
    ok(`${tag}...she survives ${fight.secs} s of it (afloat: ${fight.alive}, ${fight.holes} m² of holes), the wave firing ${fight.fired} rounds at her (from ${fight.seenAt ? fight.seenAt.toFixed(0) + ' s' : '—'}; ${fight.st.join(', ')} at ${fight.d.join(', ')} m); the bar "${bar1.text}"`,
      fight.secs >= 60 && fight.alive && bar1.shown && bar1.inside && /Hostile/.test(bar1.text), { fight, bar1 });
    await pageErrors(page, tag + 'hostile ');
    await ctx.close();
  }
}
ok(`no console errors (${errs.length})`, errs.length === 0, errs.slice(0, 6));
await b.close(); srv.close();
ok.done();
