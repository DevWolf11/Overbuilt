'use strict';
// The ground-combat HUD (the ground update, spec §8-§9): what the crosshair is on (the aim ray, 20 times a second); the
// canvas over the 3D view (crosshair, the gun's reticle and reload ring, range, hit results and the arcs toward whoever
// hit us, lead and lock, the rocket strike, zone badges, enemy tags, the damage diagram, the radar scope, the sight's
// stadia); the minimap and the full-screen tactical map; where the canvas pieces go on each screen; and the touch
// controls (sight, machine guns, lock, the shell chips, a long press on an enemy's tag to spot it).

const GHUD = (() => {
  const RAY = { o: v3(), d: v3() }, Q = { x: 0, y: 0, behind: true }, A1 = v3(), A2 = v3(), LOC = {}, MZ = v3(), BD = v3();
  const COL = { friend: '#62d0ff', enemy: '#ff5d5d', none: '#d4dce6', hud: '#e9edf1', ok: '#7dffb0', amber: '#ffb547', warn: '#ffd23f', grey: '#aab4bf' };
  const MONO = '600 12px "IBM Plex Mono", ui-monospace, monospace', BOLD = '700 15px "Chakra Petch", system-ui, sans-serif';
  const DEG = Math.PI / 180;
  // what the screen holds (place), the aim's last full look, the damage diagram's and the minimap's pictures, spots
  const S = { aimAt: -1e9, P: null, placeAt: -1e9, W: 0, H: 0, drop: 0, dropKey: '', dropR: 0, diag: null, diagKey: '', map: null, mapKey: '', mapAt: -1e9,
    tags: [], nTags: 0, spots: new Map(), pings: [], press: null, ops: 0, tac: null, fireW: 0, rangeKey: null, rangeTxt: '', wh: 0, whT: -1e9,
    cmd: { on: null, v: null, d: 0, t: 0, e: 0 },
    blk: { p: null, v0: 0, D: 0, mx: 0, my: 0, mz: 0, ux: 0, uy: 0, uz: 0, blk: -1 }, rk: { key: '', at: -1e9, blk: -1 } };

  // ---------------------------------------------------------------- who is who
  const mp = () => typeof MP !== 'undefined' && MP.live;
  function myTeam() {
    if (mp() && typeof MP.teamOf === 'function' && typeof Net !== 'undefined') return MP.teamOf(Net.me);
    const B = typeof GroundAI !== 'undefined' && GroundAI.battle;
    return B && B.team != null ? B.team : 0;
  }
  // a vessel the player fights: another player's on the other side, or the ground AI's that isn't ours
  function foe(o) {
    if (o.remote) return mp() && typeof MP.enemy === 'function' && typeof Net !== 'undefined' ? MP.enemy(Net.me, o.remote) : false;
    return !!(o.ai && !o.ai.ally && (o.ai.team == null || o.ai.team !== myTeam()));
  }
  const friendAI = (o) => !!(o.ai && (o.ai.ally || (o.ai.team != null && o.ai.team === myTeam())));

  // ---------------------------------------------------------------- the aim (§8.2)
  // What the crosshair is on, into F.aim: a full look 20 times a second (the vessels as drawn, along the camera's ray, then
  // the ground as drawn, 25 m a step out to 3 km, the crossing found on the real ground), the point carried along the
  // ray between. Held while looking round (C) and while a rocket strike is set on the tactical map.
  function aimUpdate(F) {
    const v = F.active, A = F.aim, D = F.aimDir;
    if (!v || !A || !D) return;
    A.dir.x = D.x; A.dir.y = D.y; A.dir.z = D.z;
    const r = Render3D.aimRay(RAY);
    if (r) { A.o.x = r.o.x; A.o.y = r.o.y; A.o.z = r.o.z; } else { A.o.x = v.x; A.o.y = v.y; A.o.z = v.z; }
    if (F.freeLook) return; // (the turret holds on the point it had)
    if (F.strike) { // (the tactical map's strike: the launcher lays on it until the aim moves off)
      if ((F.strikeMove || 0) > 90) { F.strike = null; F.strikeMove = 0; F.toast('Strike cancelled'); }
      else { A.P.x = F.strike.x; A.P.y = F.strike.y; A.P.z = F.strike.z; A.d = Math.hypot(A.P.x - A.o.x, A.P.y - A.o.y, A.P.z - A.o.z); A.indirect = true; A.src = 'ground'; A.blk = rocketBlk(v, A); return; }
    }
    A.indirect = false;
    const now = performance.now();
    if (now - S.aimAt < 50) { A.P.x = A.o.x + A.dir.x * A.d; A.P.y = A.o.y + A.dir.y * A.d; A.P.z = A.o.z + A.dir.z * A.d; return; }
    S.aimAt = now;
    look(F, v, A);
  }
  function look(F, v, A) {
    const o = A.o, d = A.dir, b = v.body, R = b.radius;
    let best = 3000, hitV = null, Px = 0, Py = 0, Pz = 0;
    // 1. vessels and wrecks within 3 km, as they are drawn (a far one is drawn raised or lowered: Render3D.reseatOf)
    for (const w of F.vessels) {
      if (w === v || w.dead || !w.parts.length || w.body !== b || w.isDebris) continue;
      const rr = Math.hypot(w.x, w.y, w.z) || 1, off = Render3D.reseatOf(w), ux = w.x / rr, uy = w.y / rr, uz = w.z / rr;
      const cx = w.x + ux * off - o.x, cy = w.y + uy * off - o.y, cz = w.z + uz * off - o.z, t = cx * d.x + cy * d.y + cz * d.z, reach = (w.reach || 6) + 1;
      if (t < -reach || t - reach > best) continue;
      const qx = cx - d.x * t, qy = cy - d.y * t, qz = cz - d.z * t;
      if (qx * qx + qy * qy + qz * qz > reach * reach) continue;
      // along the ray shifted back where the physics has it: the point it gives is where its shell will strike
      A1.x = o.x - ux * off; A1.y = o.y - uy * off; A1.z = o.z - uz * off;
      const L = Math.max(0, t) + reach + 2;
      A2.x = A1.x + d.x * L; A2.y = A1.y + d.y * L; A2.z = A1.z + d.z * L;
      const h = Armour.hitFirst(w, A1, A2);
      if (!h || h.t * L >= best) continue;
      best = h.t * L; hitV = w; Px = A1.x + d.x * best; Py = A1.y + d.y * best; Pz = A1.z + d.z * best;
    }
    // 2. the ground as drawn (the arena's own ground, else the terrain patch and the berms), 25 m a step, and where the
    // line crosses it, the real ground (six halvings)
    const sea = b.ocean ? 0 : -Infinity, gap = (s) => {
      Terrain.locate(b, o.x + d.x * s, o.y + d.y * s, o.z + d.z * s, LOC);
      return LOC.r - R - Math.max(sea, Render3D.drawnGround(b, LOC.a, LOC.z));
    }, real = (s) => {
      Terrain.locate(b, o.x + d.x * s, o.y + d.y * s, o.z + d.z * s, LOC);
      return LOC.r - R - Math.max(sea, Terrain.surfaceAt(b, LOC.a, LOC.z));
    };
    let gs = -1;
    for (let s = 25, prev = 0; s <= best + 25; prev = s, s += 25) {
      if (gap(Math.min(s, best)) >= 0) continue;
      let lo = prev, hi = Math.min(s, best);
      for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (real(m) < 0) hi = m; else lo = m; }
      gs = hi;
      break;
    }
    if (gs >= 0 && gs < best) { best = gs; hitV = null; A.src = 'ground'; }
    else A.src = hitV ? 'vessel' : 'none';
    A.v = hitV;
    if (A.src === 'none') best = 1500;
    A.d = best;
    if (hitV) { A.P.x = Px; A.P.y = Py; A.P.z = Pz; } else { A.P.x = o.x + d.x * best; A.P.y = o.y + d.y * best; A.P.z = o.z + d.z * best; }
    blocked(v, A);
  }
  // Where the chosen gun's round meets the ground short of the crosshair's point: the barrel sits lower than the camera,
  // so just over a crest the camera sees past, the shell may not (A.blk: metres along the barrel; -1 clear). Its path:
  // the barrel's line, dropping as the round falls (the gun is already lifted for the range), against the physics'
  // ground, every 2 m near the gun, out to every 20 m. On a vessel, up to 6 m short of it; on the ground, to a tenth of
  // the way (8 m at least) short (a round coming in low may land a little short of it), at the sky the first 300 m, and
  // only once the gun is laid (swinging round, its line meets the ground anywhere: no false Blocked).
  function blocked(v, A) {
    A.blk = -1;
    const st = Aim.status(v), p = st && st.part, w = p && p.def.weapon;
    if (w && w.kind === 'rocket') { A.blk = A.src === 'ground' ? rocketBlk(v, A) : -1; return; }
    if (!w || !(w.kind === 'tgun' || w.kind === 'agun') || (A.src !== 'vessel' && !(st.err < 0.01))) return; // (on the ground: once the gun is laid, not while it swings round)
    const sh = st.shells[st.sel], S0 = sh && SHELLS[sh.key], v0 = (S0 && S0.v0) || 800, b = v.body, R = b.radius, sea = b.ocean ? 0 : -Infinity;
    const M = Aim.muzzle(v, p, A1), u = Aim.dir(v, p, A2), r0 = Math.hypot(M.x, M.y, M.z) || 1, ux = M.x / r0, uy = M.y / r0, uz = M.z / r0;
    const d0 = Math.hypot(A.P.x - M.x, A.P.y - M.y, A.P.z - M.z), D = A.src === 'vessel' ? d0 - 6 : A.src === 'ground' ? d0 - Math.max(8, d0 * 0.1) : Math.min(300, d0);
    const B = S.blk; // (the gun, its line and the point all where they were: the last answer stands)
    if (B.p === p && B.v0 === v0 && Math.abs(B.D - D) < 0.5 && Math.abs(B.mx - M.x) + Math.abs(B.my - M.y) + Math.abs(B.mz - M.z) < 0.01 && Math.abs(B.ux - u.x) + Math.abs(B.uy - u.y) + Math.abs(B.uz - u.z) < 1e-5) { A.blk = B.blk; return; }
    const gap = (s) => {
      const k = 4.905 * (s / v0) * (s / v0);
      Terrain.locate(b, M.x + u.x * s - ux * k, M.y + u.y * s - uy * k, M.z + u.z * s - uz * k, LOC);
      return LOC.r - R - Math.max(sea, Terrain.surfaceAt(b, LOC.a, LOC.z));
    };
    for (let s = 2, prev = 0; s < D; prev = s, s += clamp(s * 0.25, 2, 20)) { // (finely near the gun: a berm in front is 24 m across)
      if (gap(s) >= 0) continue;
      let lo = prev, hi = s;
      for (let i = 0; i < 5; i++) { const m = (lo + hi) / 2; if (gap(m) < 0) hi = m; else lo = m; }
      A.blk = hi;
      break;
    }
    B.p = p; B.v0 = v0; B.D = D; B.mx = M.x; B.my = M.y; B.mz = M.z; B.ux = u.x; B.uy = u.y; B.uz = u.z; B.blk = A.blk;
  }

  // Rocket artillery (P4 play-test): where its rockets, laid by the range table for the point (the crosshair's, or the
  // tactical map's strike), come down on the ground short of it: a crest between (A.blk: metres out; -1 clear). Their
  // path (Aim.rocketH) against the physics' ground every 25 m along the bearing, out to a tenth short of the point (30 m
  // at least); five times a second at most, and only when the launcher, the point or the elevation moved.
  function rocketBlk(v, A) {
    const st = Aim.status(v), p = st && st.part, w = p && p.def.weapon, sk = v._strike;
    if (!w || w.kind !== 'rocket' || !sk || sk.out) return -1;
    const C = S.rk, now = performance.now(), T = Aim.trunnion(v, p, A1);
    const key = `${p.id}|${Math.round(T.x)}|${Math.round(T.y)}|${Math.round(T.z)}|${Math.round(A.P.x)}|${Math.round(A.P.y)}|${Math.round(A.P.z)}|${Math.round(sk.el * 2000)}`;
    if (key === C.key || now - C.at < 200) return C.blk;
    C.key = key; C.at = now; C.blk = -1;
    const b = v.body, R = b.radius, sea = b.ocean ? 0 : -Infinity;
    Terrain.locate(b, T.x, T.y, T.z, LOC); const a0 = LOC.a, z0 = LOC.z, h0 = LOC.r - R;
    Terrain.locate(b, A.P.x, A.P.y, A.P.z, LOC); const da = wrapAngle(LOC.a - a0), dz = LOC.z - z0, Dg = Math.hypot(R * da, dz);
    for (let s = 25, end = Dg - Math.max(30, Dg * 0.1); s < end; s += 25) {
      const f = s / Dg, g = Math.max(sea, Terrain.surfaceAt(b, a0 + da * f, z0 + dz * f)) - h0;
      if (Aim.rocketH(p.def, sk.el, s, b) < g) { C.blk = s; break; }
    }
    return C.blk;
  }

  // ---------------------------------------------------------------- the canvas (§9.1), every frame in aim mode
  function draw(ctx, W, H, dpr, F) {
    const v = F.active;
    if (!v || !v.parts.length || F.destroyed || !Render3D.ready || !F.aim) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    place(W, H, F);
    const st = Aim.status(v), cx = W / 2, cy = H / 2, bp = bodyPos(v.body, F.time), t = F.time;
    BPX = bp.x; BPY = bp.y;
    ctx.lineCap = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    S.nTags = 0;
    // enemy tags and team-mates (the ground AI's here; other players' are the room's: MPUI.drawHUD), zone badges
    tags(ctx, F, v, pr);
    zones(ctx, F, v, pr);
    // the crosshair (or the gunner's sight's own marks)
    if (F.sight) sightMarks(ctx, W, H, F, v, st); else crosshair(ctx, cx, cy);
    // the gun's reticle: where its round goes now (the barrel as it points, its drop at the range), its reload round it
    if (st) reticle(ctx, F, v, st, pr, W, H);
    // the range, under the crosshair
    rangeText(ctx, F, v, cx, cy);
    if (st) weaponMarks(ctx, F, v, st, pr, cx, cy);
    hits(ctx, F, v, cx, cy, W, H, t);
    if (st) fireRing(ctx, st);
    if (!F.sight) diagram(ctx, F, v);
    if (st && st.scope && !F.sight) scope(ctx, F, v, st);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // (a body-relative point on the screen, into Q: the body's place this frame is BPX, BPY)
  let BPX = 0, BPY = 0;
  const pr = (x, y, z) => Render3D.projectTo(BPX + x, BPY + y, z, Q);
  const CROSS = [[-1, 0], [1, 0], [0, -1], [0, 1]], TICKS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  function crosshair(ctx, x, y) {
    ctx.strokeStyle = 'rgba(8, 11, 16, 0.55)'; ctx.lineWidth = 3.5;
    ctx.beginPath();
    for (const [a, b] of CROSS) { ctx.moveTo(x + a * 5, y + b * 5); ctx.lineTo(x + a * 13, y + b * 13); }
    ctx.stroke();
    ctx.strokeStyle = COL.hud; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = COL.hud; ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  function reticle(ctx, F, v, st, pr, W, H) {
    const p = st.part, w = p.def.weapon;
    if (!w || !(w.kind === 'tgun' || w.kind === 'agun' || w.kind === 'rocket' || w.kind === 'missile')) return;
    const M = Aim.muzzle(v, p, MZ), u = Aim.dir(v, p, BD), A = F.aim, blk = A.blk > 0 ? A.blk : -1, R = blk > 0 ? Math.max(10, blk) : Math.max(30, Math.hypot(A.P.x - M.x, A.P.y - M.y, A.P.z - M.z));
    const r0 = Math.hypot(v.x, v.y, v.z) || 1;
    let drop = 0;
    const sh = st.shells[st.sel];
    if (sh && (w.kind === 'tgun' || w.kind === 'agun')) {
      if (S.dropKey !== sh.key || Math.abs(S.dropR - R) > R * 0.03) { const o = Aim.solve(sh.key, R, 0, v.body); S.drop = o ? o.drop : 0; S.dropKey = sh.key; S.dropR = R; }
      drop = S.drop;
    }
    const s = pr(M.x + u.x * R - (v.x / r0) * drop, M.y + u.y * R - (v.y / r0) * drop, M.z + u.z * R - (v.z / r0) * drop);
    const hx = W / 2, hy = H / 2, m = 28, dx = (s.behind ? -1 : 1) * (s.x - hx), dy = (s.behind ? -1 : 1) * (s.y - hy);
    if (s.behind || Math.abs(dx) > hx - m || Math.abs(dy) > hy - m) { // (off the screen)
      if (!st.limited) return;
      // (P4 play-test) held at its limit with its mark off the screen (a casemate gun past its arc on a narrow phone): a red
      // arrow at the edge, toward where the gun points, and what to do
      const k = Math.min((hx - m) / (Math.abs(dx) || 1e-6), (hy - m) / (Math.abs(dy) || 1e-6)), ex = hx + dx * k, ey = hy + dy * k, a = Math.atan2(dy, dx), c = Math.cos(a), n = Math.sin(a);
      ctx.fillStyle = COL.enemy; ctx.beginPath(); ctx.moveTo(ex + c * 10, ey + n * 10); ctx.lineTo(ex - c * 6 - n * 8, ey - n * 6 + c * 8); ctx.lineTo(ex - c * 6 + n * 8, ey - n * 6 - c * 8); ctx.closePath(); ctx.fill();
      ctx.font = MONO; text(ctx, 'Turn the hull', clamp(ex - c * 64, 50, W - 50), clamp(ey - n * 26 + 4, 20, H - 10)); // (beside the arrow, clear of it)
      return;
    }
    const ok = !st.limited && st.err < 0.3 * DEG && blk < 0, x = s.x, y = s.y;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8, 11, 16, 0.5)';
    ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = st.limited ? COL.enemy : blk > 0 ? COL.amber : ok ? COL.ok : COL.hud;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.stroke();
    if (st.limited || blk > 0) { ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke(); }
    if (blk > 0 && !st.limited) { ctx.font = MONO; ctx.fillStyle = COL.amber; ctx.textAlign = 'left'; ctx.fillText('Blocked', x + 16, y + 4); ctx.textAlign = 'center'; } // (the round would hit the ground there: a crest the camera sees over)
    if (st.reload < 1) { // (the reload: a ring that fills)
      ctx.lineWidth = 2.5; ctx.strokeStyle = COL.amber;
      ctx.beginPath(); ctx.arc(x, y, 13, -Math.PI / 2, -Math.PI / 2 + TAU * st.reload); ctx.stroke();
    }
  }
  function rangeText(ctx, F, v, cx, cy) { // (its words made again only when the 10 m, the zero or the mode change)
    const A = F.aim, D = Math.hypot(A.P.x - v.x, A.P.y - v.y, A.P.z - v.z), d = Math.round(D / 10), real = Aim.realistic(), l = real && lrf(v);
    const c = real && !l ? cmdRange(F, v, D) : null, cd = c == null ? 0 : Math.round(c / 10);
    const key = real ? (l ? 1e5 : c != null ? 3e5 : 2e5) + (c != null ? cd : d) * 1e6 + F.zero : A.src === 'none' ? -1 : d;
    if (key !== S.rangeKey) {
      S.rangeKey = key;
      S.rangeTxt = real ? (l ? `Range ${fmtR(d * 10)} · Sight ${fmtR(F.zero)}` : c != null ? `Range ≈ ${fmtR(cd * 10)} · Sight ${fmtR(F.zero)}` : `Sight ${fmtR(F.zero)}`) : A.src === 'none' ? '—' : fmtR(d * 10);
    }
    ctx.font = MONO; ctx.fillStyle = COL.hud;
    text(ctx, S.rangeTxt, cx, cy + (F.sight ? 46 : 32));
  }
  // (Realistic aim with no rangefinder working) a living commander's reading of the range (§8.5): once the crosshair has
  // stayed 3 s on one vehicle, or on one spot (the range within 4% of where it began), the range within ±4%, the same
  // error for as long as it stays there; else null
  function cmdRange(F, v, D) {
    const A = F.aim, C = S.cmd, on = A.src === 'vessel' && A.v ? A.v : A.src === 'ground' && !A.indirect ? 'ground' : null;
    if (!on || !Armour.has(v, 'commander')) { C.on = C.v = null; return null; }
    if (on !== C.on || C.v !== v || (on === 'ground' && Math.abs(D - C.d) > C.d * 0.04) || F.time < C.t) { C.on = on; C.v = v; C.d = D; C.t = F.time; C.e = (Math.random() * 2 - 1) * 0.04; }
    return F.time - C.t >= 3 ? D * (1 + C.e) : null;
  }
  // the range the sight can be set to: the rangefinder's, else the commander's reading (null: none yet)
  const readRange = (F, v) => { const P = F.aim.P, D = Math.hypot(P.x - v.x, P.y - v.y, P.z - v.z); return lrf(v) ? D : Aim.realistic() ? cmdRange(F, v, D) : null; };
  const fmtR = (d) => `${Math.round(d / 10) * 10 >= 1000 ? (Math.round(d / 10) * 10).toLocaleString('en-US') : Math.round(d / 10) * 10} m`;
  const lrf = (v) => { if (v._lrfN !== v.parts.length) { v._lrfN = v.parts.length; v._lrf = v.parts.find((p) => p.def.lrf) || null; } return !!v._lrf && !v._lrf.broken; };
  // text with a dark rim (Combat's hudText), counted as two calls
  function text(ctx, t, x, y) {
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(8, 11, 16, 0.6)'; ctx.strokeText(t, x, y);
    ctx.fillText(t, x, y);
  }
  // lead diamond, radar lock box, GUIDING, the rocket strike
  function weaponMarks(ctx, F, v, st, pr, cx, cy) {
    ctx.lineWidth = 1.5;
    if (st.lead) {
      const s = pr(st.lead.x, st.lead.y, st.lead.z);
      if (!s.behind) { ctx.strokeStyle = COL.warn; ctx.beginPath(); ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x + 7, s.y); ctx.lineTo(s.x, s.y + 7); ctx.lineTo(s.x - 7, s.y); ctx.closePath(); ctx.stroke(); }
    }
    const T = st.lock || (st.locking > 0 && v.trk && v.trk.cand);
    if (T) {
      const p = Combat.refPos(T);
      if (p) {
        const s = pr(p.x, p.y, p.z);
        if (!s.behind) {
          const k = st.lock ? 12 : 26 - 14 * st.locking;
          ctx.strokeStyle = st.lock ? COL.ok : COL.hud; ctx.strokeRect(s.x - k, s.y - k, 2 * k, 2 * k);
          ctx.font = MONO; ctx.fillStyle = ctx.strokeStyle; ctx.fillText(st.lock ? 'LOCK' : 'LOCKING', s.x, s.y - k - 5);
        }
      }
    } else if (st.lockOn) { ctx.font = MONO; ctx.fillStyle = COL.grey; ctx.fillText('RADAR · LOOKING', cx, cy - 44); }
    if (st.guiding > 0) { ctx.font = BOLD; ctx.fillStyle = COL.warn; text(ctx, st.guidePast ? 'GUIDING' : `GUIDING ${st.guiding.toFixed(1)} s`, cx, cy - 64); } // (past the aim point: no seconds to go)
    const sk = st.strike;
    if (sk && (F.aim.indirect || st.kind === 'rocket')) {
      const s = pr(F.aim.P.x, F.aim.P.y, F.aim.P.z);
      if (!s.behind) { ctx.strokeStyle = sk.out ? COL.enemy : COL.warn; ctx.beginPath(); ctx.arc(s.x, s.y, 18, 0, TAU); ctx.stroke(); }
      const blk = !sk.out && F.aim.blk > 0;
      ctx.font = MONO; ctx.fillStyle = sk.out || blk ? COL.enemy : COL.warn;
      text(ctx, sk.out ? 'Out of range' : blk ? `Blocked by the ground ${fmtR(F.aim.blk)} out` : `Strike: ${(sk.d / 1000).toFixed(1)} km · ${Math.round(sk.t)} s`, cx, cy + (F.sight ? 64 : 50));
    }
  }
  // the shooter's result (§6.8): a line 48 px over the crosshair for 1.4 s, four ticks on it; knocked out; when we are
  // hit, a red arc on the screen's edge toward the shooter for 2 s
  const RES = { ric: ['Ricochet!', '#ffd23f'], nopen: ['Did not penetrate', '#b9c2cc'], hit: ['Hit', '#ffb547'], pen: ['Penetration', '#ff5d5d'] };
  const WHAT = { TRACK: 'tracks', WHEEL: 'wheels', ENGINE: 'engine', GUN: 'gun', RING: 'turret ring', RADAR: 'radar', SIGHT: 'sight', LAUNCHER: 'launcher', AMMO: 'ammo', FUEL: 'fuel', TROOPS: 'troops' };
  function resultText(sh) {
    const R = RES[sh.r];
    if (!R) return null;
    if (sh.r === 'pen') return [`Penetration${sh.crew ? ` · ${sh.crew} crew` : ''}`, R[1]];
    if (sh.r === 'hit') { const w = sh.what.filter((x) => WHAT[x]).map((x) => WHAT[x]); return [w.length ? `Hit · ${w.slice(0, 2).join(', ')}` : 'Hit', R[1]]; }
    return R;
  }
  function hits(ctx, F, v, cx, cy, W, H, t) {
    const fb = Armour.fb;
    if (fb.shot && t - fb.shot.t < 1.4 && t >= fb.shot.t) {
      const R = resultText(fb.shot);
      if (R) {
        const a = Math.min(1, 3 * (1.4 - (t - fb.shot.t)));
        ctx.globalAlpha = a; ctx.font = BOLD; ctx.fillStyle = R[1]; text(ctx, R[0], cx, cy - 48);
        ctx.strokeStyle = R[1]; ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [p, q] of TICKS) { ctx.moveTo(cx + p * 16, cy + q * 16); ctx.lineTo(cx + p * 22, cy + q * 22); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    if (fb.ko && t - fb.ko.t < 2.2 && t >= fb.ko.t) { ctx.font = '700 20px "Chakra Petch", system-ui, sans-serif'; ctx.fillStyle = COL.enemy; text(ctx, fb.ko.text, cx, cy - 74); }
    // the arcs: the shooter's bearing in the view (right of the camera's line is clockwise)
    if (fb.hurt.length && F.aimDir) {
      const r0 = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r0, uy = v.y / r0, uz = v.z / r0, D = F.aimDir;
      const rx = D.y * uz - D.z * uy, ry = D.z * ux - D.x * uz, rz = D.x * uy - D.y * ux; // (dir × up: the screen's right)
      const Rr = Math.min(W, H) * 0.42;
      ctx.lineWidth = 6;
      for (const h of fb.hurt) {
        const age = t - h.t;
        if (age < 0 || age > 2) continue;
        const a = Math.atan2(h.d.x * rx + h.d.y * ry + h.d.z * rz, h.d.x * D.x + h.d.y * D.y + h.d.z * D.z) - Math.PI / 2;
        ctx.strokeStyle = `rgba(255, 70, 60, ${(0.85 * (1 - age / 2)).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(cx, cy, Rr, a - 0.28, a + 0.28); ctx.stroke();
      }
    }
    // repairs: what is broken, and how long it takes once stopped
    const rp = v.repair;
    if (rp && S.P && !F.sight) {
      const p = S.P.diag;
      ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = rp.on ? COL.ok : COL.amber;
      text(ctx, rp.on ? `Repairing: ${rp.name.toLowerCase()} ${Math.ceil(rp.t)} s` : `Stop to repair: ${rp.name.toLowerCase()}`, p.x, p.y + p.h + 13);
      ctx.textAlign = 'center';
    }
  }
  // the reload ring round FIRE (where place measured it)
  function fireRing(ctx, st) {
    const f = S.P && S.P.fire;
    if (!f || !(st.reload < 1)) return;
    ctx.lineWidth = 3; ctx.strokeStyle = COL.amber;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 4, -Math.PI / 2, -Math.PI / 2 + TAU * st.reload); ctx.stroke();
  }
  // In the gunner's sight: a thin cross with gaps, mil ticks along the level, the zoom; Realistic, the stadia: the drop
  // of the shell loaded at each 200 m (100 m ticks) on a ladder under the middle, the sight's zero marked
  function sightMarks(ctx, W, H, F, v, st) {
    const cx = W / 2, cy = H / 2, px = (H / 2) / Math.tan((25 / F.zoom) * DEG); // (pixels a radian)
    ctx.strokeStyle = 'rgba(12, 16, 12, 0.85)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - W, cy); ctx.lineTo(cx - 18, cy); ctx.moveTo(cx + 18, cy); ctx.lineTo(cx + W, cy);
    ctx.moveTo(cx, cy + 18); ctx.lineTo(cx, cy + H);
    for (let m = 5; m <= 40; m += 5) { const x = m * 1e-3 * px; if (x > W / 2) break; const k = m % 10 ? 4 : 8; ctx.moveTo(cx + x, cy - k); ctx.lineTo(cx + x, cy); ctx.moveTo(cx - x, cy - k); ctx.lineTo(cx - x, cy); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(12, 16, 12, 0.9)'; ctx.beginPath(); ctx.moveTo(cx - 9, cy + 9); ctx.lineTo(cx, cy); ctx.lineTo(cx + 9, cy + 9); ctx.stroke(); // (the chevron)
    ctx.font = MONO; ctx.fillStyle = 'rgba(12, 16, 12, 0.85)'; ctx.textAlign = 'left';
    ctx.fillText(`${F.zoom}×`, cx + 24, cy - 12);
    const sh = st && st.shells[st.sel];
    if (sh && Aim.realistic()) { // (each range's drop against the zero's: how far under the chevron to put the target)
      const z0 = Aim.solve(sh.key, F.zero, 0, v.body), e0 = z0 ? z0.el : 0;
      ctx.beginPath();
      for (let d = 200; d <= 3000; d += 100) {
        const o = Aim.solve(sh.key, d, 0, v.body);
        if (!o) break;
        const y = cy + (o.el - e0) * px;
        if (y > H - 20) break;
        const big = d % 400 === 0;
        ctx.moveTo(cx + 26, y); ctx.lineTo(cx + (big ? 38 : 32), y);
        if (big) ctx.fillText(String(d / 100), cx + 42, y + 4);
      }
      ctx.stroke();
    }
    ctx.textAlign = 'center';
  }

  // ---------------------------------------------------------------- tags and zones
  // The ground AI's vehicles: team-mates always (blue, filled), enemies while spotted (red): within 250 m, seen (from our
  // top to theirs over the drawn ground, 1.5 km, a quarter more with a commander), spotted by hand (J, a long press) in
  // the last 15 s, or fired a main gun within 2.5 km in the last 3 s. Wrecks: a dim cross.
  function spotted(F, v, o, d) {
    if (d < 250) return true;
    const t = F.time, man = S.spots.get(o);
    if (man != null && t - man < 15) return true;
    if (d < 2500) for (const p of o.aimed || NO_GEAR) if (p.shotAt != null && t - p.shotAt < 3 && t >= p.shotAt && p.def.weapon && p.def.weapon.kind === 'tgun') return true;
    const far = 1500 * (Armour.has(v, 'commander') ? 1.25 : 1);
    if (d >= far) return false;
    // (a thermal sight sees through smoke; a look is good for a second, ours or theirs at us: the spotting budget)
    const eyes = Aim.eyes(v), r = Aim.known(v, o, eyes && eyes.thermal, t, 1);
    return r != null ? r : Aim.sees(v, o, eyes);
  }
  function tags(ctx, F, v, pr) {
    for (const o of F.vessels) {
      if (o === v || o.dead || !o.parts.length || o.remote || !o.ai || !o.ai.ground) continue;
      const d = Math.hypot(o.x - v.x, o.y - v.y, o.z - v.z);
      if (d > 4000) continue;
      const fr = friendAI(o), wreck = !!(o.wreck || o.ko || o.ai.down);
      if (!fr && !wreck && !spotted(F, v, o, d)) continue;
      const r0 = Math.hypot(o.x, o.y, o.z) || 1, k = (o.bounds ? o.bounds.maxY - o.com.y : 2) + 1.2;
      const s = pr(o.x + (o.x / r0) * k, o.y + (o.y / r0) * k, o.z + (o.z / r0) * k);
      if (s.behind) continue;
      if (wreck) { ctx.strokeStyle = 'rgba(200, 200, 200, 0.45)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(s.x - 4, s.y - 4); ctx.lineTo(s.x + 4, s.y + 4); ctx.moveTo(s.x + 4, s.y - 4); ctx.lineTo(s.x - 4, s.y + 4); ctx.stroke(); continue; }
      const col = fr ? COL.friend : COL.enemy, q = d > 1500 ? 6 : 5;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y - q); ctx.lineTo(s.x + q, s.y); ctx.lineTo(s.x, s.y + q); ctx.lineTo(s.x - q, s.y); ctx.closePath();
      if (fr) ctx.fill(); else ctx.stroke();
      if (d > 120) { ctx.font = '500 10px "IBM Plex Mono", monospace'; ctx.fillText(fmt.dist(d), s.x, s.y - 9); }
      if (!fr) { const T = S.tags[S.nTags] || (S.tags[S.nTags] = { x: 0, y: 0, o: null }); T.x = s.x; T.y = s.y; T.o = o; S.nTags++; }
    }
  }
  const ZC = (own) => (own < 0 ? COL.none : own === myTeam() ? COL.friend : COL.enemy);
  function zones(ctx, F, v, pr) {
    const O = typeof GroundMode !== 'undefined' && GroundMode.obj ? GroundMode.obj() : null;
    if (!O || !Array.isArray(O.zones) || v.body !== EARTH) return;
    const R = EARTH.radius;
    for (const z of O.zones) {
      const a = siteAngle(EARTH, z.e), ph = z.z / R, h = R + Render3D.drawnGround(EARTH, a, z.z) + 8, cp = Math.cos(ph);
      const x = h * cp * Math.cos(a), y = h * cp * Math.sin(a), zz = h * Math.sin(ph), s = pr(x, y, zz);
      if (s.behind || s.x < -20 || s.x > S.W + 20 || s.y < -20 || s.y > S.H + 20) continue;
      const d = Math.hypot(x - v.x, y - v.y, zz - v.z), own = z.own, p = z.p || 0, r = 11;
      ctx.globalAlpha = Math.hypot(s.x - S.W / 2, s.y - S.H / 2) < 44 ? 0.35 : 1; // (faded under the crosshair, so it stays clear to aim)
      ctx.lineWidth = 2; ctx.fillStyle = 'rgba(8, 13, 24, 0.72)'; ctx.strokeStyle = ZC(own);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill(); ctx.stroke();
      if (Math.abs(p) > 0.02 && Math.abs(p) < 0.999) { ctx.strokeStyle = p < 0 ? (myTeam() === 0 ? COL.friend : COL.enemy) : myTeam() === 1 ? COL.friend : COL.enemy; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y, r + 3, -Math.PI / 2, -Math.PI / 2 + TAU * Math.abs(p)); ctx.stroke(); }
      ctx.font = '700 12px "Chakra Petch", system-ui, sans-serif'; ctx.fillStyle = ZC(own); ctx.fillText(z.id, s.x, s.y + 4);
      ctx.font = '500 10px "IBM Plex Mono", monospace'; ctx.fillStyle = COL.hud; ctx.fillText(fmt.dist(d), s.x, s.y + r + 13);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- the damage diagram (a top view, cached)
  // Drawn from above, nose up: the hull's parts, the turret turned as it is, the barrels, the crew (dark when out), the
  // modules amber when hurt, red when broken, flickering while burning, and a thin wedge where the camera looks. Painted
  // into its own canvas only when any of that changes (modules, crew, the turret to 2°, the view to 5°), then copied.
  function diagram(ctx, F, v) {
    const P = S.P && S.P.diag;
    if (!P || !v.gv) return;
    const key = diagKey(F, v);
    if (key !== S.diagKey) { S.diagKey = key; paintDiagram(F, v, P); }
    if (S.diag) ctx.drawImage(S.diag, P.x, P.y, P.w, P.h);
  }
  function hullYaw(F, v) { // the view's bearing off the hull's nose (rad, clockwise from above)
    const D = F.aimDir;
    if (!D) return 0;
    const r = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r, f = v.axis(v.pilot.F.x, v.pilot.F.y, v.pilot.F.z, A1);
    const fu = f.x * ux + f.y * uy + f.z * uz, fx = f.x - ux * fu, fy = f.y - uy * fu, fz = f.z - uz * fu;
    const sx = fy * uz - fz * uy, sy = fz * ux - fx * uz, sz = fx * uy - fy * ux; // (the hull's right: f × up)
    return Math.atan2(D.x * sx + D.y * sy + D.z * sz, D.x * fx + D.y * fy + D.z * fz);
  }
  const mix = (k, n) => (Math.imul(k, 31) + n) | 0;
  function diagKey(F, v) { // (a number: no garbage every frame)
    let k = mix(mix(mix(Math.round(hullYaw(F, v) / (5 * DEG)), v.parts.length), S.P.diag.w), S.P.diag.h), fire = false;
    if (v.tg) for (const g of v.tg) k = mix(k, Math.round((g.ring.aimYaw || 0) / (2 * DEG)));
    for (const p of v.parts) {
      if (!p.def.module && !p.def.mods) continue;
      const hp = Combat.hpFrac(p);
      k = mix(k, p.broken ? 1 : hp < 0.5 ? 2 : hp < 0.99 ? 3 : 4);
      if (p.fire > 0) fire = true;
      if (p.mods) for (const m of p.mods) k = mix(k, m > 0 ? 5 : 6);
    }
    if (fire || (v.mfire && v.mfire.length)) k = mix(k, 7 + (Math.floor(performance.now() / 250) % 2)); // (a fire flickers)
    return k;
  }
  function paintDiagram(F, v, P) {
    const dpr = App.dpr || 1, c = S.diag || (S.diag = document.createElement('canvas')), W = Math.round(P.w * dpr), H = Math.round(P.h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = 'rgba(8, 13, 24, 0.62)'; g.strokeStyle = 'rgba(150, 185, 230, 0.25)'; g.lineWidth = 1;
    roundRect(g, 0.5, 0.5, P.w - 1, P.h - 1, 6); g.fill(); g.stroke();
    // the top view's extent (part space: x the hull's length, z across)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of v.parts) {
      if (p.def.weapon && p.def.aim && p.def.weapon.kind !== 'smoke') { const q = Aim.localTrunnion(v, p, A2), u = Aim.localDir(v, p, BD), L = barrel(p); for (const s of [0, L]) { x0 = Math.min(x0, q.x + u.x * s); x1 = Math.max(x1, q.x + u.x * s); } continue; }
      const hw = p.def.w / 2, Z = partZ(p), hd = (p.def.depth || p.def.w) / 2; x0 = Math.min(x0, p.x - hw); x1 = Math.max(x1, p.x + hw); z0 = Math.min(z0, Z - hd); z1 = Math.max(z1, Z + hd);
    }
    const small = P.w < 110, areaW = P.w * (small ? 0.5 : 0.55), k = Math.min((P.h - 10) / Math.max(x1 - x0, 1), (areaW - 8) / Math.max(z1 - z0, 1)), ox = areaW / 2 + 2, oy = P.h / 2;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, X = (z) => ox + (z - mz) * k, Y = (x) => oy - (x - mx) * k;
    const now = performance.now();
    const colOf = (p, base) => { const hp = Combat.hpFrac(p); if (p.fire > 0) return Math.floor(now / 250) % 2 ? '#ff8a2a' : '#ffd23f'; if (p.broken) return '#ff5d5d'; if (p.def.module && hp < 0.5) return '#ffb547'; return base; };
    for (let pass = 0; pass < 4; pass++) for (const p of v.parts) { // (the hull, its modules, the turret, its modules)
      const d = p.def, gp = v.tgOf && v.tgOf.get(p.id);
      if (!!gp !== pass > 1 || !!d.inner !== (pass & 1) > 0 || (d.inner && !d.module) || (d.weapon && d.aim && d.weapon.kind !== 'smoke')) continue;
      const hw = (d.w / 2) * k, hd = ((d.depth || d.w) / 2) * k, Z = partZ(p);
      g.save();
      if (gp) { let psi = 0; for (let q = gp; q; q = q.parent) psi += q.ring.aimYaw || 0; g.translate(X(gp.c.z), Y(gp.c.x)); g.rotate(psi); g.translate(-X(gp.c.z), -Y(gp.c.x)); }
      g.fillStyle = colOf(p, d.track || d.awheel ? '#47505b' : gp ? '#93a1af' : d.inner ? '#5d6976' : '#6f7c8a');
      g.globalAlpha = d.inner ? 0.9 : 0.92;
      g.fillRect(X(Z) - hd, Y(p.x) - hw, 2 * hd, 2 * hw);
      if (!d.inner) { g.globalAlpha = 1; g.strokeStyle = 'rgba(10, 14, 20, 0.7)'; g.lineWidth = 1; g.strokeRect(X(Z) - hd + 0.5, Y(p.x) - hw + 0.5, 2 * hd - 1, 2 * hw - 1); }
      g.restore();
    }
    g.globalAlpha = 1;
    // the barrels, as they point
    g.lineWidth = 2; g.lineCap = 'round';
    for (const p of v.aimed) {
      const w = p.def.weapon;
      if (!w || w.kind === 'smoke') continue;
      const tr = Aim.localTrunnion(v, p, A2), dir = Aim.localDir(v, p, BD), L = barrel(p);
      g.strokeStyle = p.broken ? '#ff5d5d' : '#dfe6ee';
      g.beginPath(); g.moveTo(X(tr.z), Y(tr.x)); g.lineTo(X(tr.z + dir.z * L), Y(tr.x + dir.x * L)); g.stroke();
    }
    // the view: a thin wedge from the turret (or the middle)
    const ref = (v.tg && v.tg[0]) ? v.tg[0].c : { x: mx, z: mz }, a = hullYaw(F, v), cxw = X(ref.z), cyw = Y(ref.x), Lw = Math.min(P.h, areaW) * 0.48;
    g.fillStyle = 'rgba(255, 255, 255, 0.16)';
    g.beginPath(); g.moveTo(cxw, cyw); g.arc(cxw, cyw, Lw, a - Math.PI / 2 - 0.22, a - Math.PI / 2 + 0.22); g.closePath(); g.fill();
    // the crew: pips, and a count
    const C = Armour.crewOf(v), crew = (C && C.crew) || [];
    let alive = 0;
    for (const e of crew) { // (where each sits: a built-in seat in its host, or a placed one; turned with its turret)
      if (e.alive) alive++;
      const h = e.host, M = e.i >= 0 && h.def.mods ? h.def.mods[e.i] : null, o = A2;
      if (M) { aimPt(h, M.at[0] * h.def.w, M.at[1] * h.def.h, o); o.z += M.at[2] * partDepth(h); } else { o.x = e.part.x; o.y = e.part.y; o.z = partZ(e.part); }
      Aim.pose(v, M ? h : e.part, o, o);
      g.fillStyle = e.alive ? '#7dffb0' : '#20262d'; g.strokeStyle = 'rgba(0, 0, 0, 0.7)'; g.lineWidth = 1;
      g.beginPath(); g.arc(X(o.z), Y(o.x), 2.3, 0, TAU); g.fill(); g.stroke();
    }
    // what's wrong, in words
    g.textAlign = 'left'; g.font = `600 ${small ? 9 : 10}px "IBM Plex Mono", ui-monospace, monospace`; // (CREW 4/4 fits the small one)
    const tx = areaW + 4, all = Math.max(crew.length, v._crewN || 0); // (against the crew it set out with; none: no line, as on a technical)
    g.fillStyle = alive < all ? '#ffb547' : '#c9d3de';
    if (all) g.fillText(`CREW ${alive}/${all}`, tx, 15);
    let y = 28;
    const seen = new Set();
    for (const p of v.parts) {
      const m = p.def.module;
      if (!m || seen.has(m) || y > P.h - 4) continue;
      const bad = p.broken || p.fire > 0 || ((m === 'engine' || m === 'ring') && Combat.hpFrac(p) < 0.5);
      if (!bad) continue;
      seen.add(m);
      g.fillStyle = p.fire > 0 ? '#ff8a2a' : p.broken ? '#ff5d5d' : '#ffb547';
      g.fillText((p.fire > 0 ? 'FIRE ' : '') + (WHAT[(m === 'breech' ? 'GUN' : m.toUpperCase())] || m).toUpperCase(), tx, y);
      y += 12;
    }
  }
  const barrel = (p) => p.def.h * (1 - (p.def.aim && p.def.aim.pivot != null ? p.def.aim.pivot : 0.5)); // (trunnion to muzzle, m)
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // ---------------------------------------------------------------- an SPAA's search radar scope
  function scope(ctx, F, v, st) {
    const P = S.P && S.P.scope;
    if (!P) return;
    const R = P.R, cx = P.x, cy = P.y, K = R / (st.scopeR || 10000);
    ctx.fillStyle = 'rgba(8, 13, 24, 0.72)'; ctx.strokeStyle = 'rgba(125, 255, 176, 0.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, TAU); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(st.sweep) * R, cy - Math.cos(st.sweep) * R); ctx.stroke();
    ctx.fillStyle = COL.ok;
    const now = F.time;
    for (const b of st.scope) {
      const age = now - b.t, rr = Math.min(R - 2, b.d * K);
      if (age > 1.2) continue;
      ctx.globalAlpha = Math.max(0.2, 1 - age / 1.2);
      ctx.fillRect(cx + Math.sin(b.a) * rr - 2, cy - Math.cos(b.a) * rr - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.font = '600 9px "IBM Plex Mono", ui-monospace, monospace'; ctx.fillStyle = 'rgba(125, 255, 176, 0.75)';
    ctx.fillText(`RADAR ${Math.round((st.scopeR || 0) / 1000)} km`, cx, cy + R + 11);
  }

  // ---------------------------------------------------------------- where things go (§9.5), once a second
  // The canvas pieces (the damage diagram, the radar scope) take the first spot clear of the panels (the flight data,
  // the room's bar, the controls, the buttons top right, the warning receiver's display, the minimap, a Stage pill, a
  // throttle); FIRE is measured for its reload ring; the minimap's backing store follows its size, and its bottom goes to
  // --gmap-b (the hint sits under it on a phone). Nothing is written unless it changed.
  function rect(q) { const e = typeof q === 'string' ? document.querySelector(q) : q; if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; }
  function place(W, H, F) {
    const now = performance.now();
    const M = mp() && typeof MPUI !== 'undefined' && MPUI.scope, mk = M ? M.x + M.y * 1e4 : 0; // (a room's own scope, on wide screens: placed again as it comes)
    if (S.P && now - S.placeAt < 1000 && S.W === W && S.H === H && S.sight === !!F.sight && S.mk === mk) return S.P;
    S.placeAt = now; S.W = W; S.H = H; S.sight = !!F.sight; S.mk = mk;
    const T = rect('#flight-ui .telemetry'), lc = rect('#flight-ui .left-controls'), bar = rect('#mp-bar') || rect('#gai-bar'), tr = rect('#flight-ui .flight-top-right'), gm = rect('#gmap'), fire = rect('#btn-fire');
    const rw = Combat.S.rwrBox && Combat.S.rwr > 1 ? { left: Combat.S.rwrBox.x - Combat.S.rwrBox.R, right: Combat.S.rwrBox.x + Combat.S.rwrBox.R, top: Combat.S.rwrBox.y - Combat.S.rwrBox.R, bottom: Combat.S.rwrBox.y + Combat.S.rwrBox.R + 14 } : null;
    const ms = M ? { left: M.x - M.R, right: M.x + M.R, top: M.y - M.R, bottom: M.y + M.R + 4 } : null;
    const block = [T, lc, bar, tr, gm, rw, ms, rect('#ammo-stack'), rect('#btn-sight'), rect('#btn-mg'), rect('#btn-lock'), rect('#weapon-box .weapon-chip'), rect('#btn-cm'), rect('#btn-brake'), rect('#flight-ui .stage-box'), rect('#flight-ui .throttle-box'), fire].filter(Boolean);
    const hit = (a) => block.some((b) => a.x < b.right && a.x + a.w > b.left && a.y < b.bottom && a.y + a.h > b.top) || a.x < 4 || a.y < 4 || a.x + a.w > W - 4 || a.y + a.h > H - 4;
    const small = W < 380 || H < 700, land = H < 500, dw = small ? 104 : 120, dh = small ? 62 : 72, Tb = T ? T.bottom : 80, Tl = T ? T.left : 12, Tr = T ? T.right : 200;
    const tries = [[Tl, Tb + 8], ...(ms ? [[Tl, ms.bottom + 8]] : []), [Tr + 8, T ? T.top : 12], [Tl, Tb + 8 + 60], [lc ? lc.right + 10 : 140, lc ? lc.top : H - 200]];
    let diag = null;
    for (const [x, y] of tries) { const a = { x, y, w: dw, h: dh }; if (!hit(a)) { diag = a; break; } }
    if (!diag) diag = { x: Tl, y: Tb + 8, w: dw, h: dh };
    block.push({ left: diag.x, right: diag.x + diag.w, top: diag.y, bottom: diag.y + dh + 18 });
    const R0 = land ? 40 : W < 500 ? 40 : 46;
    let scope = null;
    const spots = [[Tl + R0, diag.y + dh + 30 + R0, R0], [diag.x + diag.w + 14 + R0, diag.y + R0, R0], ...(ms ? [[ms.right + 14 + R0, ms.top + R0, R0]] : []), [Tr + 14 + R0, (T ? T.top : 12) + R0, R0], [Tl + 30, diag.y + dh + 50, 30]];
    for (const [x, y, R] of spots) {
      const a = { x: x - R, y: y - R, w: 2 * R, h: 2 * R + 14 };
      if (!hit(a)) { scope = { x, y, R }; break; }
    }
    S.P = { diag, scope, fire: fire ? { x: (fire.left + fire.right) / 2, y: (fire.top + fire.bottom) / 2, r: fire.width / 2 } : null };
    // the minimap's backing store, and where the hint goes under it
    const map = $('#gmap');
    if (map && gm) {
      const dpr = App.dpr || 1, w = Math.round(gm.width * dpr), h = Math.round(gm.height * dpr);
      if (map.width !== w || map.height !== h) { map.width = w; map.height = h; S.mapKey = ''; }
      const b = `${Math.round(gm.bottom + 8)}px`;
      if (S.gmapB !== b) { S.gmapB = b; document.body.style.setProperty('--gmap-b', b); }
      // (P4 play-test) under the room's bar when it grows (its capture line, its lineup): the phone's minimap goes down with it
      const t = bar && bar.left < gm.right && bar.right > gm.left ? `${Math.round(bar.bottom + 8)}px` : '0px';
      if (S.gmapT !== t) { S.gmapT = t; document.body.style.setProperty('--gmap-t', t); }
    }
    return S.P;
  }

  // ---------------------------------------------------------------- the DOM (§9.3), from updateHUD: nothing written unless it changed
  const setTxt = (e, t) => { if (e && e.textContent !== t) e.textContent = t; };
  const hide = (e, h) => { if (e && e.hidden !== h) e.hidden = h; };
  const attr = (e, k, val) => { if (e && e.getAttribute(k) !== val) e.setAttribute(k, val); };
  const cls = (e, k, on) => { if (e && e.classList.contains(k) !== on) e.classList.toggle(k, on); };
  function sync(F, ws) {
    const v = F.active, gnd = !!F._bodyGround && !!v && !F.destroyed, ga = F.groundAim && gnd, E = S.el || (S.el = els());
    const st = ga ? Aim.status(v) : null, sys = gnd ? Combat.systems(v) : [], cur = sys[v ? v.wsel : 0];
    hide(E.sight, !ga); if (ga) attr(E.sight, 'aria-pressed', String(!!F.sight));
    const mg = ga && v.aimed.some((p) => p.def.weapon && p.def.weapon.kind === 'agun' && (p.def.weapon.cal || 0) < 15) && !(cur && cur.w.kind === 'agun' && (cur.w.cal || 0) < 15);
    hide(E.mg, !mg);
    const trk = ga && !!Aim.kit(v).track;
    hide(E.lock, !trk);
    if (trk) { const on = !!(st && (st.lock || st.lockOn)); attr(E.lock, 'aria-pressed', String(on)); setTxt(E.lock, st && st.lock ? 'Locked' : 'Lock'); }
    setTxt(E.cm, gnd && ws && ws.smoke > 0 && !(ws.flares > 0 || ws.chaff > 0) ? 'Smoke' : 'CM');
    attr(E.cm, 'title', gnd && ws && ws.smoke > 0 ? 'Smoke (K)' : 'Flares and chaff (K)');
    // the shell chips: the main gun's rounds (two or more), the loaded one pressed, the next one marked
    const sh = st && st.shells.length > 1 && st.kind === 'tgun' ? st.shells : null, key = sh ? sh.map((s) => s.label).join('|') + (isTouch ? '' : '#') : '';
    if (key !== S.chipKey) { S.chipKey = key; E.ammo.replaceChildren(...(sh || []).map((s, i) => el('button', { class: 'ammo-chip', 'data-i': String(i), 'aria-pressed': 'false', text: isTouch ? s.label : `${s.n} ${s.label}`, title: `${s.label} (${s.n}; twice, or hold: load it now)` }))); }
    hide(E.ammo, !sh);
    if (sh) E.ammo.childNodes.forEach((c, i) => { attr(c, 'aria-pressed', String(i === st.sel)); cls(c, 'queued', i === st.queued); });
    // the weapon chip: with two systems or more besides the machine guns
    const n = sys.filter((s) => !(s.w.kind === 'agun' && (s.w.cal || 0) < 15)).length;
    cls(E.wbox, 'g-one', gnd && n < 2);
    // Realistic aim: the sight's setting
    const real = ga && Aim.realistic();
    hide(E.range, !real);
    if (real) setTxt(E.range, `Zero ${F.zero} m`);
    hide(E.gmap, !gnd);
    if (!gnd && S.tacOpen) tactical(false);
  }
  function els() { return { sight: $('#btn-sight'), mg: $('#btn-mg'), lock: $('#btn-lock'), cm: $('#btn-cm'), ammo: $('#ammo-stack'), wbox: $('#weapon-box'), range: $('#btn-range'), gmap: $('#gmap') }; }

  // ---------------------------------------------------------------- the minimap, at most 4 times a second, when it changed
  // North up (game north: −z), the arena's box when in one (else 3 km round us): zones by owner, team-mates, spotted
  // enemies, our heading cone, the rocket strike and pings; an SPAA's radar blips.
  function mapFrame(F, v) {
    const B = arenaBox(v), half = B ? Math.max(B.e1 - B.e0, B.z1 - B.z0) / 2 + 150 : 1500;
    const me = eZ(v);
    return B ? { e: (B.e0 + B.e1) / 2, z: (B.z0 + B.z1) / 2, half, B } : { e: me.e, z: me.z, half, B: null };
  }
  function eZ(o) { Terrain.locate(o.body || EARTH, o.x, o.y, o.z, LOC); return { e: -wrapAngle(LOC.a - EARTH.padAngle) * EARTH.radius, z: LOC.z }; }
  function arenaBox(v) {
    if (!EARTH.arenas || v.body !== EARTH) return null;
    const p = eZ(v);
    for (const k in EARTH.arenas) { const A = EARTH.arenas[k], B = A.box; if (B && (A.clear ? EARTH.mapped : true) && p.e > B.e0 - 1500 && p.e < B.e1 + 1500 && p.z > B.z0 - 1500 && p.z < B.z1 + 1500) return B; }
    return null;
  }
  function units(F, v) { // [x e, z, kind: 0 us, 1 friend, 2 enemy, 3 wreck, yaw]
    const out = [];
    for (const o of F.vessels) {
      if (o.dead || !o.parts.length || o.isDebris || o.body !== v.body || (!o.control && !o.wreck)) continue;
      let k;
      if (o === v) k = 0;
      else if (o.wreck || o.ko) k = 3;
      else if (o.remote) { const en = foe(o); if (en && !(typeof MP.spotted === 'function' ? MP.spotted(o.remote) : typeof MPUI !== 'undefined' && MPUI.spotted(o, v, F))) continue; k = en ? 2 : 1; }
      else if (o.ai) {
        const en = !friendAI(o), d = Math.hypot(o.x - v.x, o.y - v.y, o.z - v.z);
        if (en && (o.ai.ground ? !spotted(F, v, o, d) : d > 3000)) continue; // (an aircraft is seen within 3 km)
        k = en ? 2 : 1;
      }
      else k = 1;
      const p = eZ(o);
      out.push([p.e, p.z, k]);
    }
    return out;
  }
  // the pings on show: ours (8 s) and, in a room, the team's (MP.pings: 10 s), counted for the pictures' keys
  const PGS = { L: [null, null], n: 0, now: 0, ok: (p) => PGS.now - p.t < (p.by != null ? 10000 : 8000) };
  function pings() {
    const now = (PGS.now = performance.now()), T = mp() && Array.isArray(MP.pings) ? MP.pings : NO_GEAR;
    let k = S.pings.length;
    for (const p of T) if (now - p.t < 10000) k = (Math.imul(k, 31) + Math.round(p.e) * 7 + Math.round(p.z)) | 0;
    PGS.L[0] = S.pings; PGS.L[1] = T; PGS.n = k;
    return PGS;
  }
  function drawMap(F, v) {
    const c = $('#gmap');
    if (!c || c.hidden || !c.width) return;
    const now = performance.now();
    if (now - S.mapAt < 250) return;
    const fr = mapFrame(F, v), U = units(F, v), O = typeof GroundMode !== 'undefined' && GroundMode.obj ? GroundMode.obj() : null, st = Aim.status(v);
    const w = c.width, K = w / (2 * fr.half), X = (e) => w / 2 + (e - fr.e) * K, Y = (z) => c.height / 2 + (z - fr.z) * K; // (east right; game north, −z, up)
    const yaw = F.aimYaw, sweep = st && st.scope ? Math.round(st.sweep * 20) : -1;
    const PG = pings();
    let key = `${w}|${Math.round(fr.e)}|${Math.round(fr.z)}|${Math.round(yaw * 30)}|${sweep}|${PG.n}|${F.strike ? 1 : 0}`;
    for (const u of U) key += `|${Math.round(X(u[0]))},${Math.round(Y(u[1]))},${u[2]}`;
    if (O && O.zones) for (const z of O.zones) key += `|${z.own},${Math.round((z.p || 0) * 50)}`;
    if (key === S.mapKey) return;
    S.mapKey = key; S.mapAt = now;
    const g = c.getContext('2d'), dpr = App.dpr || 1;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, c.height);
    g.fillStyle = 'rgba(8, 13, 24, 0.72)'; g.fillRect(0, 0, w, c.height);
    if (fr.B) { g.strokeStyle = 'rgba(255, 181, 71, 0.55)'; g.lineWidth = dpr; g.strokeRect(X(fr.B.e0), Y(fr.B.z0), (fr.B.e1 - fr.B.e0) * K, (fr.B.z1 - fr.B.z0) * K); }
    if (O && O.zones) for (const z of O.zones) {
      g.strokeStyle = ZC(z.own); g.fillStyle = z.own < 0 ? 'rgba(212, 220, 230, 0.18)' : z.own === myTeam() ? 'rgba(98, 208, 255, 0.25)' : 'rgba(255, 93, 93, 0.25)'; g.lineWidth = 1.5 * dpr;
      g.beginPath(); g.arc(X(z.e), Y(z.z), Math.max(5 * dpr, z.r * K), 0, TAU); g.fill(); g.stroke();
      g.fillStyle = ZC(z.own); g.font = `700 ${9 * dpr}px "Chakra Petch", system-ui, sans-serif`; g.textAlign = 'center'; g.fillText(z.id, X(z.e), Y(z.z) + 3 * dpr);
    }
    const me = eZ(v);
    // our heading cone (the aim, east = yaw 0, game north is yaw +90°: up)
    g.fillStyle = 'rgba(255, 255, 255, 0.18)';
    g.beginPath(); g.moveTo(X(me.e), Y(me.z)); g.arc(X(me.e), Y(me.z), 22 * dpr, -yaw - 0.35, -yaw + 0.35); g.closePath(); g.fill();
    for (const u of U) {
      g.fillStyle = u[2] === 0 ? '#ffffff' : u[2] === 1 ? COL.friend : u[2] === 2 ? COL.enemy : 'rgba(170, 170, 170, 0.6)';
      g.beginPath(); g.arc(X(u[0]), Y(u[1]), (u[2] === 0 ? 3.2 : 2.6) * dpr, 0, TAU); g.fill();
    }
    if (F.strike) { const p = eZ(F.strike); g.strokeStyle = COL.warn; g.lineWidth = 1.5 * dpr; g.beginPath(); g.arc(X(p.e), Y(p.z), 5 * dpr, 0, TAU); g.stroke(); }
    for (const L of PG.L) for (const p of L) if (PG.ok(p)) { g.strokeStyle = COL.warn; g.beginPath(); g.arc(X(p.e), Y(p.z), 4 * dpr, 0, TAU); g.stroke(); }
    if (st && st.scope) { // (the radar's sweep, its blips round us)
      const R = st.scopeR * K, f = hullHeading(v);
      g.strokeStyle = 'rgba(125, 255, 176, 0.4)'; g.beginPath(); g.moveTo(X(me.e), Y(me.z)); g.lineTo(X(me.e) + Math.cos(f - st.sweep) * R, Y(me.z) - Math.sin(f - st.sweep) * R); g.stroke();
      g.fillStyle = COL.ok;
      for (const b of st.scope) g.fillRect(X(me.e) + Math.cos(f - b.a) * b.d * K - 2, Y(me.z) - Math.sin(f - b.a) * b.d * K - 2, 4, 4);
    }
  }
  // the hull's heading in the map's terms (rad, east 0, game north +π/2)
  function hullHeading(v) {
    const f = v.axis(v.pilot.F.x, v.pilot.F.y, v.pilot.F.z, A1), r = Math.hypot(v.x, v.y, v.z) || 1, ux = v.x / r, uy = v.y / r, uz = v.z / r, el = Math.hypot(ux, uy) || 1;
    const ex = uy / el, ey = -ux / el, nx = ey * uz, ny = -ex * uz, nz = ex * uy - ey * ux;
    return Math.atan2(-(f.x * nx + f.y * ny + f.z * nz), f.x * ex + f.y * ey);
  }

  // ---------------------------------------------------------------- the tactical map (M, or a tap on the minimap)
  // Full screen, drawn only while open (4 times a second at most, when something on it moved): the ground's hillshade
  // (baked once a session from the arena's own ground, or the real ground a few hundred points a frame), the box, the
  // zones, who is where. A tap: with rocket artillery chosen, a strike there ("Strike: 4.2 km · 19 s"); else a ping for
  // the team (at most one a second; with no team, outside a room, a mark for yourself).
  function tactical(open) {
    open = !!open && typeof Flight !== 'undefined' && Flight.groundAim;
    const box = $('#gtac');
    if (!box) return;
    if (open === S.tacOpen) return;
    S.tacOpen = open;
    box.hidden = !open;
    S.tacKey = '';
    if (open && Flight.active) tacInfo(Flight, Flight.active); // (right away, not at its first picture)
    if (open && Flight.unlockPointer) Flight.unlockPointer();
  }
  function tacFrame(F, v) {
    const B = arenaBox(v), me = eZ(v), half = B ? Math.max(B.e1 - B.e0, B.z1 - B.z0) / 2 + 200 : 2000;
    return B ? { e: (B.e0 + B.e1) / 2, z: (B.z0 + B.z1) / 2, half, B } : { e: me.e, z: me.z, half, B: null };
  }
  function drawTac(F, v) {
    const c = $('#gtac-canvas');
    if (!c) return;
    const r = c.getBoundingClientRect(), dpr = App.dpr || 1, w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; S.tacKey = ''; }
    const fr = tacFrame(F, v), now = performance.now();
    // the hillshade: baked over frames, kept for its frame
    const T = S.tac;
    if (!T || T.e !== Math.round(fr.e) || T.z !== Math.round(fr.z) || T.half !== fr.half) S.tac = { e: Math.round(fr.e), z: Math.round(fr.z), half: fr.half, n: 80, i: 0, h: new Float32Array(81 * 81), img: null };
    const H = S.tac;
    if (!H.img) bake(H, fr);
    if (now - (S.tacAt || 0) < 250 && S.tacKey) return;
    const U = units(F, v), O = typeof GroundMode !== 'undefined' && GroundMode.obj ? GroundMode.obj() : null;
    const size = Math.min(w, h - 50 * dpr) * 0.96, ox = (w - size) / 2, oy = (h - 50 * dpr - size) / 2, K = size / (2 * fr.half);
    const X = (e) => ox + size / 2 + (e - fr.e) * K, Y = (z) => oy + size / 2 + (z - fr.z) * K;
    const PG = pings();
    let key = `${w}x${h}|${H.img ? 1 : H.i}|${Math.round(F.aimYaw * 30)}|${F.strike ? 1 : 0}|${PG.n}`;
    for (const u of U) key += `|${Math.round(X(u[0]) / 2)},${Math.round(Y(u[1]) / 2)},${u[2]}`;
    if (O && O.zones) for (const z of O.zones) key += `|${z.own},${Math.round((z.p || 0) * 50)}`;
    if (key === S.tacKey) return;
    S.tacKey = key; S.tacAt = now; S.tacXY = { ox, oy, size, fr };
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b1220'; g.fillRect(0, 0, w, h);
    if (H.img) { g.imageSmoothingEnabled = true; g.drawImage(H.img, ox, oy, size, size); }
    if (fr.B) { g.strokeStyle = 'rgba(255, 181, 71, 0.7)'; g.lineWidth = 2 * dpr; g.strokeRect(X(fr.B.e0), Y(fr.B.z0), (fr.B.e1 - fr.B.e0) * K, (fr.B.z1 - fr.B.z0) * K); }
    g.textAlign = 'center';
    if (O && O.zones) for (const z of O.zones) {
      g.strokeStyle = ZC(z.own); g.lineWidth = 2 * dpr; g.fillStyle = 'rgba(8, 13, 24, 0.35)';
      g.beginPath(); g.arc(X(z.e), Y(z.z), Math.max(9 * dpr, z.r * K), 0, TAU); g.fill(); g.stroke();
      g.fillStyle = ZC(z.own); g.font = `700 ${14 * dpr}px "Chakra Petch", system-ui, sans-serif`; g.fillText(z.id, X(z.e), Y(z.z) + 5 * dpr);
    }
    const me = eZ(v);
    g.fillStyle = 'rgba(255, 255, 255, 0.2)';
    g.beginPath(); g.moveTo(X(me.e), Y(me.z)); g.arc(X(me.e), Y(me.z), 60 * dpr, -F.aimYaw - 0.3, -F.aimYaw + 0.3); g.closePath(); g.fill();
    for (const u of U) { g.fillStyle = u[2] === 0 ? '#ffffff' : u[2] === 1 ? COL.friend : u[2] === 2 ? COL.enemy : 'rgba(170, 170, 170, 0.7)'; g.beginPath(); g.arc(X(u[0]), Y(u[1]), (u[2] === 0 ? 5 : 4) * dpr, 0, TAU); g.fill(); }
    if (F.strike) { const p = eZ(F.strike); g.strokeStyle = COL.warn; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(X(p.e), Y(p.z), 10 * dpr, 0, TAU); g.moveTo(X(p.e) - 14 * dpr, Y(p.z)); g.lineTo(X(p.e) + 14 * dpr, Y(p.z)); g.moveTo(X(p.e), Y(p.z) - 14 * dpr); g.lineTo(X(p.e), Y(p.z) + 14 * dpr); g.stroke(); }
    for (const L of PG.L) for (const p of L) if (PG.ok(p)) { g.strokeStyle = COL.warn; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(X(p.e), Y(p.z), 8 * dpr, 0, TAU); g.stroke(); }
    tacInfo(F, v);
  }
  // what a tap on the tactical map does (alone, or beside the AI, there's no team to ping: a mark for yourself)
  function tacInfo(F, v) {
    setTxt($('#gtac-info'), artillery(v) ? (F.strike ? 'Strike set: fire when the launcher is laid · tap again to move it' : 'Tap the map to set a rocket strike') : mp() ? 'Tap the map to ping for your team' : 'Tap the map to mark a spot');
  }
  // the hillshade: the ground at 81 × 81 points (the arena's own mesh where it is built: quick; else the real ground, a
  // few hundred points a frame), lit from the north-west
  function bake(T, fr) {
    const n = T.n, R = EARTH.radius, t0 = performance.now();
    while (T.i < (n + 1) * (n + 1) && performance.now() - t0 < 2.5) {
      const i = T.i % (n + 1), j = Math.floor(T.i / (n + 1)), e = fr.e - fr.half + (2 * fr.half * i) / n, z = fr.z - fr.half + (2 * fr.half * j) / n, a = siteAngle(EARTH, e);
      const h = Render3D.drawnGround(EARTH, a, z);
      T.h[T.i++] = h != null ? h : Terrain.heightAt(EARTH, a, z);
    }
    if (T.i < (n + 1) * (n + 1)) return;
    // (smoothed twice with a 1-2-1 kernel each way: the height map's 32 m cells are planes, and shaded raw they show as a quilt)
    const m = n + 1, tmp = new Float32Array(m * m);
    for (let pass = 0; pass < 4; pass++) {
      const src = pass % 2 ? tmp : T.h, dst = pass % 2 ? T.h : tmp, dx = pass % 2 ? m : 1;
      for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
        const k = j * m + i, at = pass % 2 ? j : i, lo = at > 0 ? k - dx : k, hi = at < n ? k + dx : k;
        dst[k] = (src[lo] + 2 * src[k] + src[hi]) / 4;
      }
    }
    const c = document.createElement('canvas'); c.width = c.height = n;
    const g = c.getContext('2d'), im = g.createImageData(n, n), cell = (2 * fr.half) / n;
    let lo = Infinity, hi = -Infinity;
    for (const h of T.h) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * (n + 1) + i, h = (T.h[k] + T.h[k + 1] + T.h[k + n + 1] + T.h[k + n + 2]) / 4;
      const dE = (T.h[k + 1] + T.h[k + n + 2] - T.h[k] - T.h[k + n + 1]) / (2 * cell), dS = (T.h[k + n + 1] + T.h[k + n + 2] - T.h[k] - T.h[k + 1]) / (2 * cell);
      const sh = clamp(1 - (dE + dS) * 2.2, 0.55, 1.4), u = (h - lo) / Math.max(1, hi - lo), o = (j * n + i) * 4, wet = h <= 0.5;
      im.data[o] = clamp((wet ? 30 : 74 + 70 * u) * sh, 0, 255); im.data[o + 1] = clamp((wet ? 70 : 96 + 52 * u) * sh, 0, 255); im.data[o + 2] = clamp((wet ? 120 : 62 + 30 * u) * sh, 0, 255); im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    T.img = c;
  }
  const artillery = (v) => { const cur = v && Combat.systems(v)[v.wsel]; return !!(cur && cur.w.kind === 'rocket' && cur.def.aim); };
  function tacTap(F, cx, cy) {
    const v = F.active, M = S.tacXY, c = $('#gtac-canvas');
    if (!v || !M || !c) return;
    const r = c.getBoundingClientRect(), dpr = App.dpr || 1, x = (cx - r.left) * dpr, y = (cy - r.top) * dpr;
    if (x < M.ox || y < M.oy || x > M.ox + M.size || y > M.oy + M.size) { tactical(false); return; } // (a tap off the map shuts it)
    const e = M.fr.e - M.fr.half + ((x - M.ox) / M.size) * 2 * M.fr.half, z = M.fr.z - M.fr.half + ((y - M.oy) / M.size) * 2 * M.fr.half;
    const a = siteAngle(EARTH, e), ph = z / EARTH.radius, h = EARTH.radius + (Render3D.drawnGround(EARTH, a, z) || 0) + 0.5, cp = Math.cos(ph);
    const P = { x: h * cp * Math.cos(a), y: h * cp * Math.sin(a), z: h * Math.sin(ph) };
    if (artillery(v)) { F.strike = P; F.strikeMove = 0; Sound.click(); F.toast(`Strike set: ${fmt.dist(Math.hypot(P.x - v.x, P.y - v.y, P.z - v.z))} out`); S.tacKey = ''; return; }
    const now = performance.now();
    if (now - (S.pingAt || -1e9) < 1000) return;
    S.pingAt = now;
    S.pings.push({ e, z, t: now });
    if (S.pings.length > 3) S.pings.shift();
    if (mp() && typeof MP.sendSeen === 'function') MP.sendSeen([], false, [e, z]); // (a ping is a place on the map: e, z)
    Sound.click(); F.toast(mp() ? 'Ping for your team' : 'Spot marked'); S.tacKey = ''; S.mapKey = '';
  }

  // ---------------------------------------------------------------- spotting by hand (J, a long press on a tag)
  function spot(F, o) {
    const v = F.active;
    if (!v) return;
    if (!o) { // (the one under the crosshair, else the tag nearest the middle within 60 px)
      if (F.aim && F.aim.v && foe(F.aim.v)) o = F.aim.v;
      else { let bd = 60; for (let i = 0; i < S.nTags; i++) { const T = S.tags[i], d = Math.hypot(T.x - S.W / 2, T.y - S.H / 2); if (d < bd) { bd = d; o = T.o; } } if (!o && mp()) o = ghostNear(F, S.W / 2, S.H / 2, 60); }
    }
    if (!o) { F.toast('Nothing to spot there'); return; }
    S.spots.set(o, F.time);
    if (o.remote && mp() && typeof MP.sendSeen === 'function') MP.sendSeen([o.remote], true, null);
    if (o.ai && typeof GroundAI !== 'undefined' && typeof GroundAI.spot === 'function') GroundAI.spot(o, F);
    Sound.click(); haptic(15); F.toast(`Spotted ${o.name || 'an enemy'}`);
  }
  function ghostNear(F, x, y, lim) { // another player's craft drawn within lim px of (x, y)
    const v = F.active;
    let best = null, bd = lim;
    for (const o of F.vessels) {
      if (!o.remote || o.dead || !foe(o)) continue;
      const bp = bodyPos(o.body, F.time), s = Render3D.projectTo(bp.x + o.x, bp.y + o.y, o.z, Q);
      if (s.behind) continue;
      const d = Math.hypot(s.x - x, s.y - y - 14);
      if (d < bd) { bd = d; best = o; }
    }
    void v;
    return best;
  }
  // a finger held still on a tag for 600 ms spots it
  function press(F, e, down) {
    clearTimeout(S.pressT);
    if (!down || e.pointerType === 'mouse') { S.press = null; return; }
    S.press = { x: e.clientX, y: e.clientY };
    S.pressT = setTimeout(() => {
      const p = S.press;
      S.press = null;
      if (!p || !F.groundAim) return;
      let o = null, bd = 34;
      for (let i = 0; i < S.nTags; i++) { const T = S.tags[i], d = Math.hypot(T.x - p.x, T.y - p.y); if (d < bd) { bd = d; o = T.o; } }
      if (!o && mp()) o = ghostNear(F, p.x, p.y, 34);
      if (o) spot(F, o);
    }, 600);
  }
  function dragged(p, e) { if (S.press && Math.hypot(e.clientX - S.press.x, e.clientY - S.press.y) > 12) { S.press = null; clearTimeout(S.pressT); } }

  // ---------------------------------------------------------------- the sight's setting, and the wheel
  function zeroKey(F) {
    const v = F.active;
    if (!v || !F.aim || !Aim.realistic()) return;
    const d = readRange(F, v);
    if (d == null) {
      F.toast(Armour.has(v, 'commander') ? 'No rangefinder aboard: keep the crosshair on a target for 3 s for the commander\'s reading, or set the sight with PgUp / PgDn'
        : 'No rangefinder aboard: set the sight with PgUp / PgDn, or the wheel on its range ladder (right)');
      return;
    }
    F.zero = clamp(Math.round(d / 50) * 50, 200, 3000);
    F.toast(`Sight set to ${F.zero} m`); Sound.click();
  }
  // In the sight the wheel steps its zoom, or (Realistic aim, the pointer free at the right edge) the range ladder 100 m.
  // Under the pointer lock clientX stands where the lock began, so it is never the ladder there (PgUp / PgDn are). A
  // touchpad sends many small events, and sideways ones: a step per 40 px of travel (a mouse's notch is 100: one step).
  function wheel(F, e) {
    if (!F.sight) return false;
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1);
    if (!dy) return true; // (sideways)
    if (e.timeStamp - S.whT > 350 || (S.wh < 0) !== (dy < 0)) S.wh = 0;
    S.whT = e.timeStamp; S.wh += dy;
    if (Math.abs(S.wh) < 40) return true;
    const up = S.wh < 0; S.wh = 0;
    if (Aim.realistic() && !F._locked && e.clientX > innerWidth * 0.82) { F.zero = clamp(F.zero + (up ? 100 : -100), 200, 3000); F.updateHUD(true); return true; } // (the range ladder)
    const Z = [3, 6, 8], i = Z.indexOf(F.zoom), j = clamp((i < 0 ? 0 : i) + (up ? 1 : -1), 0, 2);
    if (Z[j] !== F.zoom) F.setSight(true, Z[j]);
    return true;
  }

  // ---------------------------------------------------------------- the touch controls (§8.6)
  function bind() {
    const F = Flight;
    const holdBtn = (b, on, off) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture && b.setPointerCapture(e.pointerId); b.classList.add('held'); on(e); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { if (b.classList.contains('held')) { b.classList.remove('held'); off(); } });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    $('#btn-sight').addEventListener('click', () => { F.setSight(!F.sight); Sound.click(); });
    holdBtn($('#btn-mg'), () => { F.touchMG = true; haptic(8); }, () => { F.touchMG = false; });
    $('#btn-lock').addEventListener('click', () => { const v = F.active; if (v) { Aim.lockKey(v); Sound.click(); F.updateHUD(true); } });
    $('#btn-range').addEventListener('click', () => {
      const v = F.active;
      if (!v) return;
      // (the commander's reading the first tap, if the sight isn't on it already; after that, 100 m steps)
      const c = !lrf(v) && F.aim ? readRange(F, v) : null;
      if (lrf(v) || (c != null && clamp(Math.round(c / 50) * 50, 200, 3000) !== F.zero)) zeroKey(F); else { F.zero = F.zero >= 3000 ? 200 : F.zero + 100; F.updateHUD(true); }
    });
    // the shell chips: a tap loads that round next; held 0.5 s, it comes out of the breech and that one goes in now.
    // Which it was is told on release by the events' own times (a frame that stalls between the finger going down and
    // coming up must not make a tap a long press); the timer only buzzes to say it has been held long enough.
    const stack = $('#ammo-stack');
    stack.addEventListener('pointerdown', (e) => {
      const c = e.target.closest('.ammo-chip');
      if (!c) return;
      e.preventDefault();
      clearTimeout(S.chipT);
      S.chipDown = { i: +c.dataset.i, t: e.timeStamp };
      S.chipT = setTimeout(() => haptic(20), 500);
    });
    const chipUp = (e) => {
      clearTimeout(S.chipT);
      const c = e.target.closest && e.target.closest('.ammo-chip'), d = S.chipDown, v = F.active;
      S.chipDown = null;
      if (!c || !d || e.type !== 'pointerup' || !v) return;
      const i = +c.dataset.i;
      if (e.timeStamp - d.t >= 500 && i === d.i) { if (Aim.select(v, i, F) && Aim.select(v, i, F)) { F.toast('Loading it now'); F.updateHUD(true); } }
      else if (Aim.select(v, i, F)) { Sound.click(); F.updateHUD(true); }
    };
    stack.addEventListener('pointerup', chipUp);
    stack.addEventListener('pointercancel', chipUp);
    stack.addEventListener('contextmenu', (e) => e.preventDefault());
    $('#gmap').addEventListener('click', () => tactical(true));
    $('#gtac-close').addEventListener('click', () => tactical(false));
    $('#gtac-globe').addEventListener('click', () => { tactical(false); if (typeof Flight !== 'undefined' && Flight.running && !Flight.mapMode) Flight.toggleMap(); }); // (the old map: the globe)
    if (isTouch) $('#gtac-close').textContent = 'Close'; // (M is a key: a phone has none)
    const tc = $('#gtac-canvas');
    let down = null;
    tc.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    tc.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) tacTap(F, e.clientX, e.clientY); down = null; });
  }

  // every frame from App.frame (after the canvas): the minimap and the tactical map, when they need it
  function frame(F) {
    const v = F.active;
    if (!v || !F._bodyGround) return;
    drawMap(F, v);
    if (S.tacOpen) drawTac(F, v);
    const now = performance.now();
    while (S.pings.length && now - S.pings[0].t > 8000) { S.pings.shift(); S.mapKey = ''; S.tacKey = ''; }
  }

  return {
    draw, frame,
    place: (W, H) => place(W, H, typeof Flight !== 'undefined' ? Flight : {}),
    aimUpdate, sync, bind, tactical, wheel, press, dragged, spot, zeroKey, team: myTeam,
    get tacOpen() { return !!S.tacOpen; },
    set redrawDiagram(on) { if (on) S.diagKey = ''; },
    _S: S, // (the tests read where things went)
  };
})();
