// Fingerprint of every template and the AI raider: connections, what flies, stages, delta-v, and the vessel's mass,
// centre of mass, inertia, hull, reach and wheels. Any change to how parts join or weigh shows up here.
//   node test/fingerprint.js            compare with test/baseline/fingerprint.json
//   node test/fingerprint.js --update   rewrite the baseline (only for an intended change)
const G = require('./lib/game.js'), { check } = require('./lib/baseline.js');
const ctx = G.load({ earth: false, props: true }); // (the Runway's props built: nothing changes)
const r = (v) => (Number.isFinite(v) ? +(+v).toPrecision(7) : v);
const designs = Object.entries(ctx.TEMPLATES).map(([k, t]) => [k, t.kind || 'rocket', t.parts]);
designs.push(['RAIDER', 'plane', ctx.RAIDER]);
const out = {};
for (const [key, kind, rows] of designs) {
  // the template rows exactly as written (the legacy path: no att, default depths), as old saves load
  const parts = rows.map(([type, x, y, rot, o]) => ctx.makePart(type, x, y, Object.assign({ flip: x < 0, rot: rot || 0 }, o && o.z != null ? { z: o.z } : {})));
  const idx = new Map(parts.map((p, i) => [p.id, i]));
  const adj = ctx.buildAdjacency(parts), ctrl = ctx.findControlPart(parts), keep = ctx.componentOf(ctrl.id, adj);
  const edges = [];
  for (const [a, s] of adj) for (const b of s) if (idx.get(a) < idx.get(b)) edges.push(`${idx.get(a)}-${idx.get(b)}`);
  const ps = parts.filter((p) => keep.has(p.id));
  const sub = new Map(); for (const p of ps) sub.set(p.id, new Set([...adj.get(p.id)].filter((id) => keep.has(id))));
  const st = ctx.computeStages(ps, sub, ctrl.id);
  const dv = ctx.estimateDeltaV(ps, sub, ctrl.id, st, false);
  const v = new ctx.Vessel(ps, sub, ctx.EARTH);
  v.kind = kind; v.stages = ctx.computeStages(ps, sub, ctrl.id); v.rebuildGroups();
  const I = v.I || {};
  out[key] = {
    edges: edges.sort(), kept: ps.length, of: parts.length,
    stages: st.map((s) => s.map((id) => idx.get(id)).sort((a, b) => a - b)), dv: r(dv.total),
    mass: r(v.mass), com: [r(v.com.x), r(v.com.y), r(v.com.z || 0)],
    I: Object.fromEntries(Object.entries(I).map(([k, x]) => [k, r(x)])),
    reach: r(v.reach), depth: r(v.depth), width: r(v.width),
    hull: (v.hull || []).map((k) => [r(k.x), r(k.y), r(k.z)].join(',')).sort(), wheels: (v.wheels || []).length,
  };
}
check('fingerprint', out);
