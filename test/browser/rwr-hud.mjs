// The warning receiver's display on every screen: a jet at 3 km with a heat seeker and a radar missile homing on it,
// frozen, on a phone in portrait (two sizes), a phone on its side, a desktop and in a room on a phone on its side
// (where the room's bar takes the top). The threat scope and the warning's lines must stay clear of the flight data,
// the controls and the room's bar, and on the screen.
//   node test/browser/rwr-hud.mjs
import { launch, serve, watch, openGame, checks } from '../lib/browser.mjs';
const srv = await serve(), b = await launch(), errs = [];
const ok = checks('rwr: the threat display finds room on every screen');
// a jet at 3 km, level, a heat seeker 15 km ahead and a radar missile 15 km off the right wing, both homing on it (far
// enough out to last the test: the flight runs on, so the panels are as in flight)
const threats = () => {
  const v = Flight.active, r0 = Math.hypot(v.x, v.y, v.z), up = { x: v.x / r0, y: v.y / r0, z: v.z / r0 };
  v.x += up.x * 3000; v.y += up.y * 3000; v.z += up.z * 3000; const f0 = v.axis(0, 1, 0); v.vx = f0.x * 250; v.vy = f0.y * 250; v.vz = f0.z * 250; v.landed = false;
  const f = v.axis(0, 1, 0), rt = v.axis(0, 0, 1);
  const mk = (a, c, heat) => {
    const x = v.x + f.x * a + rt.x * c, y = v.y + f.y * a + rt.y * c, z = v.z + f.z * a + rt.z * c, dx = v.x - x, dy = v.y - y, dz = v.z - z, l = Math.hypot(dx, dy, dz);
    return { k: 'missile', b: v.body, x, y, z, vx: (dx / l) * 700, vy: (dy / l) * 700, vz: (dz / l) * 700, dx: dx / l, dy: dy / l, dz: dz / l, t: 1, life: 600, burn: 1e9, accel: 0, vmax: 900, turn: 0,
      dmg: 0, blast: 0, seek: 'air', heat, radar: !heat, target: v, owner: {}, enemy: true, air: true, sarh: false, drag: 0, bleed: 0, gimbal: 3, track: 99, arm: 9, irccm: 0, nav: 0, cm: new WeakSet(), lostT: 0, notchT: 0, trackT: 0 };
  };
  Combat.S.shots.push(mk(15000, -120, true), mk(0, 15000, false));
  Combat.S.rwrBox = null;
};
// where everything is, once a frame has drawn the display
const layout = () => {
  const rect = (q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
  const B = Combat.S.rwrBox;
  return { W: innerWidth, H: innerHeight, rwr: Combat.S.rwr, threats: Combat.S.threats.length, B, scope: B && { l: B.x - B.R, t: B.y - B.R, r: B.x + B.R, b: B.y + B.R + 14 },
    text: B && { l: innerWidth / 2 - 150, t: B.ty - 22, r: innerWidth / 2 + 150, b: B.ty + 44 },
    panels: { telemetry: rect('#flight-ui .telemetry'), controls: rect('#flight-ui .left-controls'), bar: rect('#mp-bar') } };
};
const meets = (a, c) => !!a && !!c && a.l < c.r && a.r > c.l && a.t < c.b && a.b > c.t;
function judge(tag, L) {
  const clash = [];
  for (const [k, P] of Object.entries(L.panels)) { if (meets(L.scope, P)) clash.push('scope/' + k); if (k !== 'controls' && meets(L.text, P)) clash.push('text/' + k); }
  const on = L.scope && L.scope.l >= 0 && L.scope.t >= 0 && L.scope.r <= L.W && L.scope.b <= L.H;
  ok(`${tag} (${L.W}×${L.H}): the scope (R ${L.B && L.B.R}) and the lines clear of the panels, on the screen`, L.rwr === 2 && L.threats === 2 && on && !clash.length, JSON.stringify({ clash, scope: L.scope, ty: L.B && L.B.ty, panels: L.panels }));
}
for (const [tag, vp] of [['phone portrait', [390, 844, true]], ['small phone', [375, 667, true]], ['phone on its side', [844, 390, true]], ['desktop', [1280, 720, false]]]) {
  const page = await (await b.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: vp[2], isMobile: vp[2] })).newPage();
  watch(page, errs, tag + ' ');
  await openGame(page, srv.url, {});
  await page.evaluate(() => { Render3D.skipDraw = true; App.toBuild(); Builder.loadTemplate('fs16'); App.launch(); });
  await page.waitForFunction(() => Flight.running && Render3D.ready, null, { timeout: 60000 });
  await page.evaluate(threats);
  await page.waitForFunction(() => Combat.S.rwrBox, null, { timeout: 20000 });
  await page.waitForTimeout(1300); // (the place is looked up again once a second: now with the panels as they are in flight)
  judge(tag, await page.evaluate(layout));
  await page.close();
}
// in a room, on a phone on its side: the room's bar takes the top middle
{
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }), A = await ctx.newPage(), B = await ctx.newPage();
  watch(A, errs, 'room A '); watch(B, errs, 'room B ');
  await openGame(A, srv.url);
  await B.goto(srv.url + 'index.html'); await B.waitForTimeout(300);
  if (await B.isVisible('[data-mode="sandbox"]')) await B.click('[data-mode="sandbox"]');
  for (const p of [A, B]) await p.evaluate(() => { Render3D.skipDraw = true; });
  await A.click('#home-mp'); await A.fill('#mp-name', 'Alice'); await A.dispatchEvent('#mp-name', 'change'); await A.click('[data-tr="local"]'); await A.click('#mp-create-sandbox');
  await A.waitForFunction(() => MP.live && Net.code, null, { timeout: 10000 });
  const code = await A.evaluate(() => Net.code);
  await B.click('#home-mp'); await B.fill('#mp-name', 'Bob'); await B.dispatchEvent('#mp-name', 'change'); await B.click('[data-tr="local"]'); await B.fill('#mp-join-code', code); await B.click('#mp-join');
  await B.waitForFunction(() => MP.live && MP.me, null, { timeout: 10000 });
  await A.evaluate(() => { Builder.loadTemplate('fs16'); App.launch(); });
  await B.evaluate(() => { Builder.loadTemplate('falcon'); App.launch(); });
  await A.waitForFunction(() => Flight.running && Flight.mp && Render3D.ready, null, { timeout: 60000 });
  await A.bringToFront();
  await A.evaluate(threats);
  await A.waitForFunction(() => Combat.S.rwrBox, null, { timeout: 20000 });
  await A.waitForTimeout(1300);
  judge('in a room, on its side', await A.evaluate(layout));
}
ok('no page errors', !errs.length, errs.join('\n'));
await b.close(); srv.close();
ok.done();
