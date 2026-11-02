// Flight traces of every template at full precision: 12 s of flight with a fixed script of stick inputs (pitch,
// yaw, roll), staging for rockets. Planes start at 1.5 km and 110 m/s with the gear up. Any change to the physics,
// however small, shows up here, so a refactor that should not change behaviour can prove it.
//   node test/traces.js [--update]
const G = require('./lib/game.js'), { check } = require('./lib/baseline.js');
const ctx = G.load({ props: true }), dt = 1 / 120; // (every prop built: none stands on these paths, and they change nothing)
const out = {};
for (const key of Object.keys(ctx.TEMPLATES)) {
  const v = G.craft(ctx, ctx.TEMPLATES[key].parts, ctx.TEMPLATES[key].kind || 'rocket'), s = G.sim();
  if (v.kind === 'plane') {
    const r = v.radius() + 1500, u = { x: v.x / v.radius(), y: v.y / v.radius() };
    v.x = u.x * r; v.y = u.y * r; v.landed = false; v.vx = u.y * 110; v.vy = -u.x * 110;
    v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true;
  }
  G.stage(v); v.throttle = 0.9;
  const T = [];
  for (let i = 0; i < 12 / dt; i++) {
    const t = i * dt;
    v.ctl.v = t > 2 && t < 4 ? -0.6 : 0; v.ctl.h = t > 4 && t < 5 ? 1 : t > 7 && t < 8 ? -0.7 : 0; v.ctl.r = t > 9 && t < 10 ? 0.5 : 0;
    if (v.kind !== 'plane' && t > 6 && v.stageIdx < v.stages.length && i % 240 === 0) G.stage(v);
    v.physicsStep(dt, s); s.time += dt;
    if (v.dead || !v.parts.length) break;
    if (i % 120 === 0) T.push([v.x, v.y, v.z, v.vx, v.vy, v.vz, v.q.w, v.q.x, v.q.y, v.q.z, v.av.x, v.av.y, v.av.z, v.mass].map((x) => x.toPrecision(15)).join(' '));
  }
  out[key] = { T, broken: s.broken, parts: v.parts.length, toasts: [...new Set(s.toasts)].length };
}
check('traces', out, { show: 8 });
