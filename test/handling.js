// Plane handling for every plane template, headless: 30 s hands-off cruise, a banked turn, a 35° climb until the
// speed is gone, and 6 s of full back stick. Prints a table (sideslip, heading drift, yaw rate, angle of attack, time
// stalled, departures = loss of control) and checks it against test/baseline/handling.json.
// The table is the tool for tuning flight controls: run it before and after a change and compare.
//   node test/handling.js [--update] [plane,plane,...] [sas mode: hold (default) | off | ...]
const G = require('./lib/game.js'), { check } = require('./lib/baseline.js');
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ctx = G.load({ props: true }); // (every prop built: none on these paths, and nothing changes)
const only = argv[0] && argv[0] !== 'all' ? argv[0].split(',') : null;
const SAS = argv[1] || 'hold';
const D = 180 / Math.PI, dt = 1 / 120;
const keys = Object.keys(ctx.TEMPLATES).filter((k) => ctx.TEMPLATES[k].kind === 'plane' && (!only || only.includes(k)));
const f0 = (x) => (Number.isFinite(x) ? Math.round(x) : '-');
function air(key, V, alt = 2000) {
  const v = G.craft(ctx, ctx.TEMPLATES[key].parts, 'plane'), s = G.sim();
  const r = v.radius() + alt, u = { x: v.x / v.radius(), y: v.y / v.radius() };
  v.x = u.x * r; v.y = u.y * r; v.landed = false; v.vx = u.y * V; v.vy = -u.x * V;
  v.gearUp = true; for (const p of v.wheels) if (p.def.wheel.retract) p.retracted = true;
  G.stage(v); v.throttle = 0.85; v.sas = SAS;
  return { v, s };
}
function rates(v) { const P = v.pilot, w = v.bodyAV(); const d = (a) => w.x * a.x + w.y * a.y + w.z * a.z; return { pitch: d(P.R), roll: d(P.F), yaw: -d(P.U) }; }
// run with an input function, tracking the worst of everything
function fly(v, s, secs, input, M) {
  for (let i = 0; i < secs / dt; i++) {
    v.ctl.v = 0; v.ctl.h = 0; v.ctl.r = 0;
    if (input) input(v, i * dt);
    v.physicsStep(dt, s); s.time += dt;
    if (v.dead || !v.parts.length) { M.dead = true; return; }
    const r = rates(v), at = v.attitude();
    M.slip = Math.max(M.slip, Math.abs(v.slip || 0) * D);
    M.yaw = Math.max(M.yaw, Math.abs(r.yaw));
    M.aoa = Math.max(M.aoa, (v.aoa || 0) * D);
    if (v.aoa != null && v.aoa > v.stallAoA + 0.05) M.stallT += dt;
    M.minV = Math.min(M.minV, v.airspeed);
    M.slipSum += Math.abs(v.slip || 0) * D; M.n++;
    M.maxBank = Math.max(M.maxBank, Math.abs(at.bank) * D);
    if (Math.abs(r.yaw) > 1.0 || Math.abs(v.slip || 0) > 0.45) M.depart = true;
    if (v.groundAltitude() < 5) { M.ground = true; return; }
  }
}
const newM = () => ({ slip: 0, yaw: 0, aoa: 0, stallT: 0, minV: 1e9, slipSum: 0, n: 0, maxBank: 0, depart: false });
const avgSlip = (M) => (M.n ? M.slipSum / M.n : 0);
G.run(ctx, 'this.__wingAero = wingAero;');
console.log(`sas=${SAS}`);
console.log('plane'.padEnd(12), 'V0 | hands-off 30s: slip° maxSlip° hdg° bank° alt | turn (bank+pull): avgSlip° maxSlip° yaw/s aoa° stall s dep | climb 35°: minV dep stall s | full back 6s: dep stall s maxBank°');
const out = {}, bad = [];
for (const key of keys) {
  // cruise at twice the clean stall speed, within limits
  const probe = air(key, 100);
  let k = 0;
  for (const p of probe.v.parts) if (p.def.wing && !p.def.wing.control) { const W = ctx.__wingAero(p.def); k += p.def.wing.area * W.slope * W.stall; }
  const V0 = Math.min(240, Math.max(55, 2 * Math.sqrt((2 * probe.v.mass * 9.8) / (1.225 * k))));
  // 1. hands-off
  let { v, s } = air(key, V0); let M = newM();
  fly(v, s, 4, null, newM()); // settle
  const h0 = v.heading(), b0 = v.attitude().bank, a0 = v.altitude();
  fly(v, s, 30, null, M);
  const hands = `${f0(avgSlip(M))} ${f0(M.slip)} ${f0((((v.heading() - h0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * D)} ${f0((v.attitude().bank - b0) * D)} ${f0(v.altitude() - a0)}${M.depart ? ' DEP' : ''}${M.dead ? ' DEAD' : ''}`;
  if (M.depart || M.dead) bad.push(key + ' hands-off');
  // 2. a turn: roll right to about 50° then pull moderately for 12 s
  ({ v, s } = air(key, V0)); fly(v, s, 4, null, newM());
  M = newM();
  fly(v, s, 12, (v, t) => { const b = v.attitude().bank * D; if (t < 4 && b < 50) v.ctl.h = 1; if (t > 0.3) v.ctl.v = -0.5; }, M);
  const turn = `${f0(avgSlip(M))} ${f0(M.slip)} ${M.yaw.toFixed(2)} ${f0(M.aoa)} ${M.stallT.toFixed(1)} ${M.depart ? 'DEP' : 'ok'}${M.ground ? ' GND' : ''}${M.dead ? ' DEAD' : ''}`;
  if (M.depart || M.dead) bad.push(key + ' turn');
  // 3. a climb: pull to 35° then hold it until the speed is gone
  ({ v, s } = air(key, V0)); fly(v, s, 4, null, newM());
  M = newM();
  fly(v, s, 25, (v) => { if (v.attitude().pitch * D < 35 && !v._held) v.ctl.v = -1; else v._held = true; }, M);
  const climb = `${f0(M.minV)} ${M.depart ? 'DEP' : 'ok'} ${M.stallT.toFixed(1)}`;
  if (M.depart || M.dead) bad.push(key + ' climb');
  // 4. full back stick
  ({ v, s } = air(key, V0)); fly(v, s, 4, null, newM());
  M = newM();
  fly(v, s, 6, (v) => { v.ctl.v = -1; }, M);
  const yank = `${M.depart ? 'DEP' : 'ok'} ${M.stallT.toFixed(1)} ${f0(M.maxBank)}`;
  if (M.depart || M.dead) bad.push(key + ' full back stick');
  const row = [key.padEnd(12), String(Math.round(V0)).padStart(3), '|', hands.padEnd(22), '|', turn.padEnd(26), '|', climb.padEnd(14), '|', yank].join(' ');
  console.log(row);
  out[key] = row;
}
console.log(bad.length ? `FAIL loss of control: ${bad.join(', ')}` : 'ok   no plane departs (loses control) in any manoeuvre');
if (bad.length) process.exitCode = 1;
if (!only && SAS === 'hold') check('handling', out);
