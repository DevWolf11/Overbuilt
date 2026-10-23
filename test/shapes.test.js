// The builder's clash test on the parts' 3D shapes (parts.js clashShape, sectionsCut, shapesClash): the section
// sums against brute-force point sampling, the height sampling against a dense scan along the axis, and what a
// player sees: round parts may sit as close as their round shapes let them, boxes clash as they always did.
//   node test/shapes.test.js
const G = require('./lib/game.js');
const ctx = G.load({ earth: false });
const R = (code) => G.run(ctx, code);
const t = G.checks('shapes: clashes on the 3D shapes');
const M = 0.02;

// a small seeded random, so a failure can be repeated
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

// 1. sectionsCut: how far a disc or a rectangle cuts into another, against points sampled on a fine grid. Shrinking
// both shapes by half the margin, they still meet exactly when they cut in by more than the margin. Cases within a
// whisker of the margin are left out (the grid can't tell them).
{
  const inside = (s, z, round, d, pv, pz, k) => {
    if (round) return Math.hypot(pv - (s[0] + s[1]) / 2, pz - z) < (s[1] - s[0]) / 2 - k;
    return pv > s[0] + k && pv < s[1] - k && pz > z - d / 2 + k && pz < z + d / 2 - k;
  };
  let bad = [], n = 0;
  for (let i = 0; i < 300; i++) {
    const mk = () => { const v0 = rnd() * 2 - 1, w = 0.05 + rnd() * 1.5; return { s: [v0, v0 + w], z: rnd() * 2 - 1, round: rnd() < 0.5, d: 0.05 + rnd() * 1.5 }; };
    const A = mk(), B = mk();
    const cut = R(`sectionsCut(${JSON.stringify(A.s)}, ${A.z}, ${A.round}, ${A.d}, ${JSON.stringify(B.s)}, ${B.z}, ${B.round}, ${B.d})`);
    if (Math.abs(cut - M) < 0.012) continue;
    n++;
    let meet = false;
    const lo = Math.max(A.s[0], B.s[0]), hi = Math.min(A.s[1], B.s[1]);
    for (let pv = lo; pv < hi && !meet; pv += 0.004) for (let pz = -2; pz < 2 && !meet; pz += 0.004)
      if (inside(A.s, A.z, A.round, A.d, pv, pz, M / 2) && inside(B.s, B.z, B.round, B.d, pv, pz, M / 2)) meet = true;
    if (meet !== cut > M) bad.push(JSON.stringify({ A, B, cut }));
  }
  t(`a disc or a rectangle cutting into another agrees with sampled points (${n} cases)`, !bad.length, bad.slice(0, 3).join(' '));
}

// 2. shapesClash samples the heights where the outlines turn and quarters in between: against a scan every 2 mm along
// the axis, for random pairs of real parts (round, flat, lofted and boxed, turned and not, single and twin) set
// close to one another. Pairs whose deepest cut is within a whisker of the margin are left out.
{
  const kinds = R(`(() => { const o = { round: [], flat: [], loft: [], box: [] };
    for (const k in PARTS) { const d = PARTS[k], S = clashShape(d, false); if (isSurface(d)) continue; (S.box ? o.box : S.round ? o.round : S.depth ? o.flat : o.loft).push(k); }
    return o; })()`);
  const pool = [...kinds.round, ...kinds.round, ...kinds.flat, ...kinds.loft, ...kinds.box];
  let bad = [], n = 0, hits = 0;
  for (let i = 0; i < 400; i++) {
    const ta = pick(pool), tb = pick(pool), rot = Math.floor(rnd() * 4), rotB = rnd() < 0.85 ? (rot + 2 * Math.floor(rnd() * 2)) & 3 : (rot + 1) & 3;
    const da = R(`PARTS.${ta}`), db = R(`PARTS.${tb}`), reach = (Math.max(da.w, da.h) + Math.max(db.w, db.h)) / 2;
    const pa = { x: 0, y: 0, z: (rnd() - 0.5) * 2, rot, flip: rnd() < 0.3 }, pb = { x: (rnd() - 0.5) * reach * 1.4, y: (rnd() - 0.5) * reach * 1.4, z: (rnd() - 0.5) * 3, rot: rotB, flip: rnd() < 0.3 };
    const res = R(`(() => {
      const a = makePart('${ta}', ${pa.x}, ${pa.y}, { z: ${pa.z} }), b = makePart('${tb}', ${pb.x}, ${pb.y}, { z: ${pb.z} });
      a.rot = ${pa.rot}; b.rot = ${pb.rot}; a.flip = ${pa.flip}; b.flip = ${pb.flip};
      if (!partsOverlap(a, b) || partsMix(a, b)) return null;
      const A = clashShape(a.def, a.flip), B = clashShape(b.def, b.flip), ka = a.rot & 3, kb = b.rot & 3;
      if ((A.box && B.box) || (ka & 1) !== (kb & 1)) return null;
      const RA = partRect(a), RB = partRect(b), odd = ka & 1;
      const lo = Math.max(odd ? RA.l : RA.b, odd ? RB.l : RB.b) + 1e-4, hi = Math.min(odd ? RA.r : RA.t, odd ? RB.r : RB.t) - 1e-4;
      let deep = -Infinity;
      for (let u = lo; u <= hi; u += 0.002) deep = Math.max(deep, sectionsCutAt(a, A, ka, b, B, kb, u));
      return { deep, says: shapesClash(a, b, ${M}) };
    })()`);
    if (!res || Math.abs(res.deep - M) < 0.004) continue;
    n++;
    if (res.says) hits++;
    if (res.says !== res.deep > M) bad.push(`${ta}/${tb} rot ${pa.rot}/${pb.rot} at ${pb.x.toFixed(2)},${pb.y.toFixed(2)} z ${pa.z.toFixed(2)}/${pb.z.toFixed(2)}: scan ${res.deep.toFixed(3)}, says ${res.says}`);
  }
  t(`the sampled heights find every cut a 2 mm scan finds, and no other (${n} pairs, ${hits} clashing)`, !bad.length && n > 100 && hits > 10 && hits < n - 10, bad.slice(0, 4).join('; '));
}

// 3. what the player sees
R(`var mk = (ty, x, y, e) => makePart(ty, x, y, e), w = (ty) => PARTS[ty].w;`);
t('two fuel tanks set diagonally, their boxes overlapping at the corner but their round shapes clear, do not clash',
  R(`(() => { const a = mk('tankM', 0, 0), b = mk('tankM', w('tankM') * 0.8, 0, { z: w('tankM') * 0.8 }); return partsOverlap(a, b) && !partsClash(a, b); })()`));
t('closer in, they do', R(`(() => { const a = mk('tankM', 0, 0), b = mk('tankM', w('tankM') * 0.6, 0, { z: w('tankM') * 0.6 }); return partsClash(a, b); })()`));
t('two tanks in the same place still clash', R(`partsClash(mk('tankM', 0, 0), mk('tankM', 0.3, 0.2))`));
t('a pod beside a nose cone’s slim tip, inside its box, does not clash; beside its wide base it does',
  R(`(() => { const n = mk('nose', 0, 0), d = PARTS.nose, top = d.h / 2 - 0.15, x = d.w / 2 - 0.12;
    const tip = mk('podSmall', x + PARTS.podSmall.w / 2 - 0.05, top), base = mk('podSmall', x + PARTS.podSmall.w / 2 - 0.05, -d.h / 2 + PARTS.podSmall.h / 2);
    return partsOverlap(n, tip) && !partsClash(n, tip) && partsClash(n, base); })()`));
t('two boxed parts (landing gear) clash exactly as their boxes do', R(`(() => {
  let same = true;
  for (const dx of [0, 0.2, 0.5, 0.9, 1.4]) for (const dz of [0, 0.2, 0.39, 0.5]) { const a = mk('gearL', 0, 0), b = mk('gearL', dx, 0.3); b.z = dz; if (partsClash(a, b) !== partsOverlap(a, b)) same = false; }
  return same; })()`));
t('a round part across a boxed one at its corner: clear of the box’s corner, no clash', R(`(() => {
  const f = mk('fuselage', 0, 0), r = PARTS.fuselage.w / 2, g = mk('gun', r * 0.85 + PARTS.gun.w / 2, 0, { z: r * 0.85 + partDepth({ def: PARTS.gun }) / 2 });
  return partsOverlap(f, g) && !partsClash(f, g); })()`));
t('a part turned a quarter against an upright one keeps the box rule', R(`(() => { const a = mk('tankM', 0, 0), b = mk('tankM', w('tankM') * 0.8, 0, { z: w('tankM') * 0.8 }); b.rot = 1; return partsClash(a, b) === partsOverlap(a, b); })()`));
t('the sides of a twin pair each count (pods either side of a fuselage)', R(`(() => { const f = mk('fuselage', 0, 0), r = PARTS.fuselage.w / 2;
  const near = mk('jetPods', 0, 0, { z: r }), far = mk('jetPods', 0, 0, { z: r + PARTS.jetPods.w / 2 + 0.05 }); return partsClash(f, near) && !partsClash(f, far); })()`));
t('a canopy drawn only in 2D still takes room', R(`(() => { const c = mk('cockpit', 0, 0), S = clashShape(PARTS.cockpit, false), d = PARTS.cockpit;
  const only3d = outlineSpan(partOutline(d, false), 0.2 * d.h), both = outlineSpan(S.polys, 0.2 * d.h); return both[0] <= only3d[0] + 1e-9 && both[1] >= only3d[1] - 1e-9; })()`));

t.done();
