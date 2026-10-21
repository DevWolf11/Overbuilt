// flight.js and world.js with parts at a depth: a torn-off wing takes what hangs on it (ripParts), explosions at the
// part's depth (breakParts), and the 2D flight view's draw order.   node test/flight.test.js
const G = require('./lib/game.js');
const ctx = G.load({ flight: true });
const R = (code) => G.run(ctx, code);
const t = G.checks('flight: ripParts, breakParts, 2D draw order');
R(`var rowsOf = (k) => TEMPLATES[k].parts.map(([type, x, y, rot]) => ({ type, x, y, flip: x < 0, rot: rot || 0 }));
var craft = (rows, kind = 'plane') => {
  const parts = partsFromDesign(rows), adjAll = buildAdjacency(parts), ctrl = findControlPart(parts), keep = componentOf(ctrl.id, adjAll);
  const ps = parts.filter((p) => keep.has(p.id));
  for (const p of ps) if (p.att != null && !keep.has(p.att)) p.att = null;
  const adj = new Map(); for (const p of ps) adj.set(p.id, new Set([...adjAll.get(p.id)].filter((id) => keep.has(id))));
  const v = new Vessel(ps, adj, EARTH); v.kind = kind; v.stages = computeStages(ps, adj, ctrl.id); v.rebuildGroups();
  v.placeOnSurface(EARTH, siteAngle(EARTH, EARTH.sites[VEHICLE_KINDS.plane.site].east), VEHICLE_KINDS.plane.launchRot);
  return v;
};
var fake = () => ({ active: null, vessels: [], toast() {}, onDestroyed() { this.dead = true; } });
// the hornet with a jet and a missile rack on its wing (att), a tank touching the fuselage under the jet
var hornet = rowsOf('hornet'); // 3: wingSwept
var withStores = [...hornet, { type: 'jet', x: 1.2, y: 5.0, z: 4, att: 3 }, { type: 'aam', x: 0.9, y: 4.0, z: 3.2, att: 3 }, { type: 'aam', x: 0.9, y: 6.5, z: 3, att: 10 }];`);

// ripParts: a torn-off wing takes its jet and both missile racks (one hanging off the other) with it
R(`var v = craft(withStores), F = fake(), wing = v.parts.find((p) => p.type === 'wingSwept');
var kids = attachedTo(v.parts, [wing]).map((p) => p.type).sort().join();
FX.clear(); Flight.ripParts.call(F, v, [wing]);`);
t('the wing has three parts attached (jet, rack, rack on the rack)', R(`kids === 'aam,aam,jet'`), R('kids'));
t('one debris piece', R('F.vessels.length === 1'), R('F.vessels.map((d) => d.parts.map((p) => p.type).join("+")).join(" | ")'));
t('it is the wing with its jet and missiles', R(`F.vessels[0].parts.map((p) => p.type).sort().join() === 'aam,aam,jet,wingSwept'`));
t('the plane keeps everything else', R(`v.parts.length === TEMPLATES.hornet.parts.length - 1 && !!v.control`));
t('sparks and puff went off (at the wing)', R('FX.list.length > 0'));
// the same with the craft hanging off the wing (cockpit attached to it): the wing goes, the cockpit's branch stays
R(`var rows2 = withStores.map((q) => ({ ...q })); rows2[2].att = 3; rows2[1].att = 2; rows2[0].att = 1; // cockpit -> wing, fuselage -> cockpit, jet -> fuselage
var v2 = craft(rows2), F2 = fake(), wing2 = v2.parts.find((p) => p.type === 'wingSwept');
Flight.ripParts.call(F2, v2, [wing2]);`);
t('a craft attached to its own wing still loses only the wing and its stores', R(`F2.vessels.length === 1 && F2.vessels[0].parts.map((p) => p.type).sort().join() === 'aam,aam,jet,wingSwept' && !!v2.control`),
  R('F2.vessels.map((d) => d.parts.map((p) => p.type).join("+")).join(" | ")'));
// no att (an old design): the old rule, every link of the ripped part cut
R(`var vx3 = craft(rowsOf('bomber')), F3 = fake(), w3 = vx3.parts.find((p) => p.type === 'wingL'); Flight.ripParts.call(F3, vx3, [w3]);`);
t('old designs: the wing goes alone, as before (pods were linked to it by the side view)', R(`F3.vessels.map((d) => d.parts.map((p) => p.type).sort().join('+')).sort().join(' | ')`) === R(`(() => { const v = craft(rowsOf('bomber')), w = v.parts.find((p) => p.type === 'wingL');
  for (const n of [...v.adj.get(w.id)]) { v.adj.get(w.id).delete(n); v.adj.get(n).delete(w.id); }
  return v.splitComponents().map((d) => d.parts.map((p) => p.type).sort().join('+')).sort().join(' | '); })()`), R(`F3.vessels.map((d) => d.parts.map((p) => p.type).sort().join('+')).sort().join(' | ')`));

// FX at the part's depth
R(`var v4 = craft(withStores), F4 = fake(), jet4 = v4.parts.find((p) => p.type === 'jet' && p.z === 4);
FX.clear(); Flight.breakParts.call(Object.assign(F4, { dist: () => 1e9, absPos: () => ({}), camAbs: {} }), v4, [jet4], 'impact');
var at = FX.list.find((f) => f.kind === 'flash'), want = null;`);
R(`var v4b = craft(withStores), jb = v4b.parts.find((p) => p.type === 'jet' && p.z === 4); want = v4b.toWorld(jb.x, jb.y, 4);`);
t('breakParts: the explosion is out on the wing (z = 4), not on the centreline', R('Math.hypot(at.x - want.x, at.y - want.y, at.z - want.z) < 1e-6'));
R(`var v5 = craft(rowsOf('bomber')), F5 = fake(), pods = v5.parts.find((p) => p.type === 'fanPods'); FX.clear();
Flight.breakParts.call(Object.assign(F5, { dist: () => 1e9, absPos: () => ({}), camAbs: {} }), v5, [pods], 'impact');
var fl = FX.list.filter((f) => f.kind === 'flash');`);
t('breakParts: a pod pair blows up at both pods', R('fl.length === 2 && Math.hypot(fl[0].x - fl[1].x, fl[0].y - fl[1].y, fl[0].z - fl[1].z) > 10'), R('Math.hypot(fl[0].x - fl[1].x, fl[0].y - fl[1].y, fl[0].z - fl[1].z).toFixed(2)'));

// the 2D flight view: canopies first, then sideOrder
R(`var drawn = []; var _dp = drawPart, _dc = drawCanopy; drawPart = (c, p) => drawn.push(p); drawCanopy = (c, p) => drawn.push('canopy');
var any = new Proxy(function () {}, { get: (o, k) => k === Symbol.toPrimitive ? () => 0 : any, apply: () => any, set: () => true });
var v6 = craft([...withStores, { type: 'jet', x: 1.2, y: 5.0, z: -4 }]);
var bp6 = bodyPos(EARTH, 0); World.drawVessel(any, v6, { x: bp6.x + v6.x, y: bp6.y + v6.y }, [1, 0, 0, 1, 0, 0], 1, { canvas: { width: 800, height: 600 }, time: 0, scale: 10, flash: null });
drawPart = _dp; drawCanopy = _dc;`);
t('drawVessel draws every part once, in sideOrder', R('drawn.length === v6.parts.length && drawn.every((p, i) => p === sideOrder(v6.parts)[i])'), R('drawn.map((p) => p.type + ":" + partZ(p)).join(" ")'));
t.done();
