// The builder by vehicle and by shape: each kind of craft gets its own part tabs (More shows the rest), each
// look-alike jet's parts sit together in the tray, and parts go as close as their 3D shapes let them: one put
// beside a round or tapering hull, in 2D or 3D, slides in until it meets the hull's surface.
//   node test/browser/builder-shapes.mjs
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const srv = await serve(), b = await launch();
const page = await (await b.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
const errs = [];
watch(page, errs);
await openGame(page, srv.url, { build3d: false });
await page.evaluate(() => App.toBuild());
await page.waitForTimeout(300);
const ev = (f, a) => page.evaluate(f, a);
const ok = checks('builder: part tabs by craft, parts by shape');
const tabs = () => ev(() => [...document.querySelectorAll('#palette-tabs .tab')].map((t) => t.textContent + (t.getAttribute('aria-selected') === 'true' ? '*' : '')));

// 1. tabs by kind
await ev(() => Builder.setKind('rocket'));
let t = await tabs();
ok('a rocket shows the rocket parts and More', t.join('|') === 'Command*|Fuel|Engines|Coupling|Aero|Utility|Structure|More…', t.join('|'));
await ev(() => Builder.setKind('plane'));
t = await tabs();
ok('a plane shows cockpits, fuselage, wings, aero engines, gear and weapons', t.join('|') === 'Cockpits*|Fuselage|Wings|Aero engines|Gear|Weapons|More…', t.join('|'));
await ev(() => [...document.querySelectorAll('#palette-tabs .tab')].find((b) => b.textContent === 'More…').click());
t = await tabs();
ok('More shows every tab, the plane ones first', t.length === 22 && t.slice(0, 6).join('|') === 'Cockpits*|Fuselage|Wings|Aero engines|Gear|Weapons' && t.includes('Command') && t.includes('Hulls') && t[21] === 'Fewer', t.join('|'));
await ev(() => [...document.querySelectorAll('#palette-tabs .tab')].find((b) => b.textContent === 'Engines').click());
let items = await ev(() => [...document.querySelectorAll('#palette-items .part-item')].length);
ok('a rocket engine can still go on a plane', items > 5, items);
await ev(() => [...document.querySelectorAll('#palette-tabs .tab')].find((b) => b.textContent === 'Fewer').click());
t = await tabs();
ok('Fewer goes back to the plane tabs (from Engines, to the first)', t[0] === 'Cockpits*' && t.length === 7, t.join('|'));
await ev(() => { Builder.moreCats = false; Builder.setKind('tank'); });
t = await tabs();
ok('armour shows hulls, turrets, drive, guns, launchers, crew and kit', t.join('|') === 'Hulls*|Turrets|Drive|Guns|Launchers|Crew & ammo|Kit|More…', t.join('|'));
const per = await ev((names) => names.map((name) => { [...document.querySelectorAll('#palette-tabs .tab')].find((b) => b.textContent === name).click();
  return name + ' ' + document.querySelectorAll('#palette-items .part-item').length; }).join(', '), t.slice(0, -1).map((n) => n.replace('*', '')));
ok('each armour tab holds its parts (the catalogue\'s 71)', per === 'Hulls 7, Turrets 11, Drive 10, Guns 16, Launchers 8, Crew & ammo 10, Kit 9', per);
await ev(() => { Builder.loadTemplate('sugoi27'); });
await ev(() => [...document.querySelectorAll('#palette-tabs .tab')].find((b) => b.textContent === 'Wings').click());
const tray = await ev(() => [...document.querySelectorAll('#palette-items > *')].map((e) => (e.classList.contains('tray-group') ? '#' + e.textContent : '.')));
const groups = tray.filter((s) => s[0] === '#').map((s) => s.slice(1));
ok('the wings tab: the stock wings first, then each jet\'s, by generation', tray[0] === '.' && groups.join(',') === 'MyG-21,FS-4,FS-16,MyG-29,FS-15,Sugoi-27,FS-22,FS-35,Sugoi-57', groups.join(','));
await ev(() => Builder.loadTemplate('pathfinder'));
t = await tabs();
ok('loading a rocket brings back the rocket tabs', t[0] === 'Command*' && t.length === 8, t.join('|'));
await ev(() => Builder.loadTemplate('fs16'));
await ev(() => [...document.querySelectorAll('#palette-tabs .tab')].find((b) => b.textContent === 'Weapons').click());
const weap = await ev(() => [...document.querySelectorAll('#palette-items .part-name')].map((e) => e.textContent));
ok('the weapons tab offers both warning receivers and the manned turret, not the retired small one', weap.includes('Basic RWR') && weap.includes('Advanced RWR') && weap.includes('Gun Turret') && !weap.includes('Small Gun Turret'), weap.join(', '));

// 2. 2D: a pod put beside a nose cone's slim tip sits on the cone, not out at the edge of its box
let r = await ev(() => {
  Builder.loadDesign({ name: 't', kind: 'plane', parts: [{ type: 'noseL', x: 0, y: 0 }] });
  const n = Builder.parts[0], d = PARTS.noseL, w = PARTS.podSmall.w, R = partRect(n), y = R.t - PARTS.podSmall.h / 2 - 0.05;
  const s = Builder.snap('podSmall', { x: R.r + w / 2, y }, []);
  const at = { def: PARTS.podSmall, type: 'podSmall', x: s.x, y: s.y, z: s.z, rot: 0 }, deeper = { ...at, x: at.x - 0.03 };
  return { boxX: R.r + w / 2, x: s.x, y: s.y, att: s.att && s.att.type, free: !partsClash(at, n), deeperClash: partsClash(deeper, n) };
});
ok('2D: beside a nose cone\'s tip a pod slides in onto its surface (and no further)', r.x < r.boxX - 0.1 && r.free && r.deeperClash && r.att === 'noseL', JSON.stringify(r));
r = await ev(() => {
  Builder.loadDesign({ name: 't', kind: 'plane', parts: [{ type: 'fuselage', x: 0, y: 0 }] });
  const f = Builder.parts[0], R = partRect(f), w = PARTS.podSmall.w;
  const s = Builder.snap('podSmall', { x: R.r + w / 2, y: 0 }, []);
  return { boxX: R.r + w / 2, x: s.x };
});
ok('2D: beside a straight round fuselage it stays where its box edge was (it is round all along)', Math.abs(r.x - r.boxX) <= 0.03, JSON.stringify(r));

// 3. 3D: a part dropped on the lower curve of a round fuselage touches the curve
r = await ev(() => {
  Builder.loadDesign({ name: 't', kind: 'plane', parts: [{ type: 'fuselage', x: 0, y: 0 }] });
  const f = Builder.parts[0], rad = PARTS.fuselage.w / 2, a = Math.PI / 4;
  const hit = { part: f, x: f.x + rad * Math.cos(a), y: 0, z: rad * Math.sin(a), nx: Math.cos(a), ny: 0, nz: Math.sin(a) * 0.999 };
  const s = Builder.attach('podSmall', 0, hit, Builder.parts), R = partRect(f), w = PARTS.podSmall.w;
  const at = { def: PARTS.podSmall, type: 'podSmall', x: s.x, y: s.y, z: s.z, rot: 0 }, deeper = { ...at, x: at.x - 0.03 * Math.cos(a), z: at.z - 0.03 * Math.sin(a) };
  return { boxX: R.r + w / 2, x: s.x, z: s.z, ok: s.ok, att: s.att && s.att.type, free: !partsClash(at, f), deeperClash: partsClash(deeper, f) };
});
ok('3D: dropped on the lower curve of a fuselage, a pod hangs on the curve, not below the box', r.ok && r.x < r.boxX - 0.15 && r.free && r.deeperClash && r.att === 'fuselage', JSON.stringify(r));

// 3b. a part slid beside an old twin pair (no attachment, at its catalogue spread: they keep the side-view rules) stops at
// the pod's surface, not inside it; and one slid onto a curved hull stays on it when nudged along or moved out a little
r = await ev(() => {
  Builder.loadTemplate('jumbo');
  const pod = Builder.parts.find((p) => p.type === 'fanPods'), R = partRect(pod), w = PARTS.podSmall.w;
  const s = Builder.snap('podSmall', { x: R.r + w / 2, y: pod.y, z: partZ(pod) }, []);
  return { podX: pod.x, boxX: R.r + w / 2, x: s.x };
});
ok('beside an old pod pair a part stops at the pod\'s surface', r.x > r.podX + 0.9 && r.x <= r.boxX, JSON.stringify(r));
r = await ev(() => {
  Builder.loadDesign({ name: 't', kind: 'plane', parts: [{ type: 'cockpitJet', x: 0, y: (PARTS.fuselage.h + PARTS.cockpitJet.h) / 2 }, { type: 'fuselage', x: 0, y: 0 }] });
  const f = Builder.parts[1], rad = PARTS.fuselage.w / 2, a = Math.PI / 4;
  const hit = { part: f, x: f.x + rad * Math.cos(a), y: 0, z: rad * Math.sin(a), nx: Math.cos(a), ny: 0, nz: Math.sin(a) * 0.999 };
  const s = Builder.attach('podSmall', 0, hit, Builder.parts);
  Builder.symmetry = false; Builder.addPart('podSmall', s.x, s.y, 0, { z: s.z, att: f, host: f });
  const p = Builder.selected, out = { slid: s.x, placed: { att: !!p.att, loose: Builder.statsData.loose } };
  Builder.nudge(0, 0.25); out.afterNudge = { att: !!p.att, loose: Builder.statsData.loose };
  p.z += 0.08; Builder.changed(); Builder.letGo(new Set([p])); out.afterDepth = { att: !!p.att, loose: Builder.statsData.loose };
  return out;
});
ok('a part slid onto a fuselage\'s curve stays on it when nudged along or moved out a little', r.placed.att && !r.placed.loose && r.afterNudge.att && !r.afterNudge.loose && r.afterDepth.att && !r.afterDepth.loose, JSON.stringify(r));

// 3c. every part's 3D model fits inside its clash shape (within 1.5 cm), so nothing can be put into a canopy, a nozzle
// or a fitting (a part whose fittings stand out has a padding, CLASH_PAD, or keeps its box, CLASH_BOXED)
await ev(() => App.setPreview3D(true));
await page.waitForFunction(() => Render3D.ready && App.preview3D(), null, { timeout: 60000 });
r = await ev(() => {
  const out = [], inv = new THREE.Matrix4(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const type in PARTS) {
    const d = PARTS[type];
    if (isSurface(d)) continue;
    for (const flip of [false, true]) {
      const S = clashShape(d, flip);
      if (S.box) continue;
      const p = makePart(type, 0, 0, { z: d.twinZ || 0 }); p.flip = flip;
      const root = Parts3D.buildPart(p, true); root.updateMatrixWorld(true);
      const hd = partDepth(p) / 2, dep = S.depth || partDepth(p);
      let worst = 0;
      for (const H of root.userData.rig.holders) {
        inv.copy(H.matrixWorld).invert();
        H.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          for (let q = o; q; q = q.parent) if (!q.visible) return;
          m.multiplyMatrices(inv, o.matrixWorld);
          const pos = o.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(m);
            if (Math.abs(v.x) > d.w / 2 + 1e-6 || Math.abs(v.y) > d.h / 2 + 1e-6 || Math.abs(v.z) > hd + 1e-6) continue;
            let s = clashSpan(S, v.y);
            if (!s) { const a = clashSpan(S, v.y - 0.003), c = clashSpan(S, v.y + 0.003); s = a && c ? [Math.min(a[0], c[0]), Math.max(a[1], c[1]), a[2] || c[2]] : a || c; }
            if (!s) { worst = 9; continue; }
            const e = s[2] ? 0 : S.pad, lo = s[0] - e, hi = s[1] + e;
            worst = Math.max(worst, S.round && !s[2] ? Math.hypot(v.x - (lo + hi) / 2, v.z) - (hi - lo) / 2 : Math.max(lo - v.x, v.x - hi, Math.abs(v.z) - (s[2] ? hd : dep / 2 + e)));
          }
        });
      }
      if (worst > 0.015) out.push(`${type}${flip ? '|f' : ''} ${worst.toFixed(3)}`);
    }
  }
  return out;
});
ok('every part\'s 3D model fits inside its clash shape', !r.length, r.join(' '));
await ev(() => App.setPreview3D(false));

// 4. cheap enough to run on every pointer move: snap against a whole jet
r = await ev(() => {
  Builder.loadTemplate('sugoi27');
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) Builder.snap('podSmall', { x: 1.6 + (i % 5) * 0.1, y: 6 + i * 0.2 }, []);
  return (performance.now() - t0) / 40;
});
ok(`snap against a 20-part jet takes ${r.toFixed(1)} ms`, r < 25, r);
r = await ev(() => { // dragging the jet's own nose about it: every move checks it against every part
  Builder.loadTemplate('sugoi27');
  const n = Builder.parts.find((p) => p.type === 'ruNose27'), others = Builder.parts.filter((p) => p !== n), t0 = performance.now();
  for (let i = 0; i < 60; i++) Builder.snap('ruNose27', { x: -2 + (i % 10) * 0.4, y: 6 + i * 0.2 }, [n]);
  return (performance.now() - t0) / 60;
});
ok(`dragging a big lofted part about its own jet: ${r.toFixed(2)} ms a move`, r < 8, r);

// 5. on a phone in portrait the More tab stays in sight at the end of the tab strip
{
  const ph = await (await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage();
  watch(ph, errs);
  await openGame(ph, srv.url, { build3d: false });
  await ph.evaluate(() => App.toBuild());
  r = await ph.evaluate(() => [...['rocket', 'plane', 'car', 'heli', 'tank']].map((k) => { Builder.setKind(k); const strip = $('#palette-tabs').getBoundingClientRect(), m = [...document.querySelectorAll('#palette-tabs .tab')].find((t) => t.textContent === 'More…').getBoundingClientRect(); return m.right <= strip.right + 1 && m.left >= strip.left; }));
  ok('phone portrait: More is in sight for every kind of craft', r.every(Boolean), JSON.stringify(r));
}

ok('no page errors', !errs.length, errs.join('\n'));
await b.close(); srv.close();
ok.done();
