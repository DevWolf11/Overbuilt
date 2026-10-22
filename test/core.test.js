// The part model with depth (z), attach links (att) and paint (skin): clashes and mounting at different depths,
// legacy twin pairs keeping the side-view rule, design rows round trip, cleaning of bad rows, attachedTo and
// sideOrder.   node test/core.test.js
const G = require('./lib/game.js');
const ctx = G.load({ earth: false });
const R = (code) => G.run(ctx, code);
const t = G.checks('core: part model');
R(`var mk = (t, x, y, e) => makePart(t, x, y, e);
var fus = mk('fuselageW', 0, 7.5), wing = mk('wingL', 0.9, 11.6), podA = mk('fanPods', 1.8, 12.4), podB = mk('fanPods', 1.8, 12.4, { z: 9 }), jet = mk('jet', 1.5, 11.6, { z: 4 }), jet0 = mk('jet', 1.5, 11.6);`);
t('two fan pod pairs on one wing at different depths do not clash', !R('partsClash(podA, podB)'));
t('two fan pod pairs at the same depth clash', R('partsClash(podA, mk("fanPods", 1.8, 12.4))'));
t('a single jet out on the wing does not clash with the fuselage', !R('partsClash(jet, mk("fuselageW", 0, 13.5))'));
t('a single jet on the centreline over the fuselage clashes', R('partsClash(jet0, mk("fuselageW", 0, 11.6))'));
t('the jet out on the wing is mounted on it', R('partsMounted(jet, wing)'));
t('pod pair B (no att, legacy) still links by the side view', R('pylonLink(podB, wing)'));
t('pod pair B with att does not use the side-view rule', R('podB.att = wing.id, !pylonLink(podB, fus)'));
R(`var ps = [fus, wing, podA, podB, jet]; var rows = designRows(ps);`);
t('rows omit default depth', R('rows[2].z === undefined && rows[3].z === 9 && rows[4].z === 4'));
t('rows carry att as an index', R('rows[3].att === 1'));
R(`var back = partsFromDesign(rows);`);
t('round trip keeps depth and att', R('back[3].z === 9 && back[3].att === back[1].id && back[4].z === 4 && back[2].z === 5.5'));
t('unknown rows are dropped after att indices are read', R(`(() => { const r = [{type:'nope',x:0,y:0}, ...rows]; r[4].att = 2; const b = partsFromDesign(r); return b.length === 5 && b[3].att === b[1].id; })()`));
t('att cycles are broken', R(`(() => { const r = rows.map((q) => ({ ...q })); r[0].att = 1; r[1].att = 0; const b = partsFromDesign(r); return (b[0].att == null) !== (b[1].att == null); })()`));
t('bad skins and z are cleaned', R(`(() => { const b = partsFromDesign([{type:'fuselage',x:0,y:0,z:1e9,skin:'__proto__'},{type:'wingL',x:0,y:0,z:5,skin:'stealth'},{type:'aam',x:0,y:0,z:-0.01}]); return b[0].z === 20 && b[0].skin === null && b[1].z === 0 && b[1].skin === 'stealth' && b[2].z > 0.2; })()`));
t('a skin on a wheel is refused', R(`partsFromDesign([{type:'wheel',x:0,y:0,skin:'red'}])[0].skin === null`));
t('attachedTo walks the tree', R(`(() => { const a = mk('fuselage',0,0), b = mk('wingL',0,0,{att:a.id}), c = mk('jet',0,0,{att:b.id}), d = mk('aam',0,0,{att:c.id}); return attachedTo([a,b,c,d],[b]).length === 2; })()`));
// the Russian look-alike jets: their templates can be edited (no clashes) and fly whole; the lofted hulls stay in their
// parts' boxes (the canopies may stand above, as other cockpits' do); wing plans run from the root out to the tip
t('the look-alike jets\' templates: no parts clash, every part is joined', R(`Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].parts.some((r) => r[0].startsWith('ru'))).every((k) => {
  const ps = partsFromDesign(templateRows(TEMPLATES[k]));
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (partsClash(ps[i], ps[j])) return false;
  return componentOf(findControlPart(ps).id, buildAdjacency(ps)).size === ps.length; })`));
t('lofted hulls stay inside their part\'s box', R(`Object.values(PARTS).filter((d) => d.loft).every((d) => ruLofts(d).hull.every((L) => L.st.every((s) =>
  s.top >= -d.w / 2 - 0.03 && s.bot <= d.w / 2 + 0.03 && s.top <= s.bot && Math.abs(s.y) <= d.h / 2 + 1e-6 && s.hw <= (d.depth || d.w) / 2 + 0.03)))`));
t('wing plans run from the root out to the tip, leading edge ahead of the trailing edge', R(`Object.values(PARTS).filter((d) => d.wing && d.wing.plan).every((d) => {
  const P = d.wing.plan; return P[P.length - 1][0] === 1 && P.every((r, i) => r[1] > r[2] && r[0] >= 0 && (i === 0 || r[0] > P[i - 1][0])); })`));
t('sideOrder puts the far side first and pods last', R(`sideOrder([mk('jet',0,0,{z:3}), fus, mk('jet',0,0,{z:-3}), wing]).map((p) => p.type + ':' + partZ(p)).join(',') === 'jet:-3,fuselageW:0,wingL:0,jet:3'`));
t.done();
