// The ground drawn against the ground the physics has, outside Highland Ridge (whose own mesh arena-probe.js measures):
// at the runway's apron, the tank yard, the spawn points' outposts (Faroes, Shetland, Scotland), hilly Shetland, the
// slope test path and lowland Scotland. Before: the terrain patch render3d draws round a craft on the ground there
// (test/lib/patch.js: its own vertex grid, cell-size detail and float32 heights, as its triangles draw it), centred on
// the craft as when it was just built and 300 m off as when it is about to be rebuilt. After: the near ground render3d
// draws round the craft (Render3D.nearGeo: its window of tiles on the physics' own lattice, 2 m cells in its middle and
// 4 m cells round them, read as its triangles draw it), on high and low, against Terrain.heightAt; every node's height
// must be the physics' own to the bit (float32), the fine middle within 5 cm everywhere and the whole window within
// 15 cm. The 95th percentile and the worst, within 100 m and 300 m of the craft (the near ground reaches 176 m on high,
// 144 m on low, then the patch: the browser check (test/browser/near-ground.mjs) measures what is drawn there).
// A Node tool, not in run.mjs (about a minute):   node test/tools/ground-probe.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const G = require('../lib/game.js'), { patchAt } = require('../lib/patch.js');
const ctx = G.load({ flight: true }); // (render3d.js reads Settings)
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../js/render3d.js'), 'utf8') + '\nthis.Render3D = Render3D;', ctx, { filename: 'render3d.js' });
const T = ctx.Terrain, EARTH = ctx.EARTH, R3 = ctx.Render3D, A = (e) => ctx.siteAngle(EARTH, e), H = (e, z) => T.heightAt(EARTH, A(e), z);
let fails = 0;
const verdict = (ok, line) => { console.log((ok ? 'ok   ' : 'FAIL ') + line); if (!ok) fails++; };
const SITES = [
  ['runway apron', 1150, -120], ['tank yard', 2050, 340], ['Funningur', 700, -900], ['Viðareiði', 1300, -1800], ['Tvøroyri', 2800, 2200],
  ['North Roe', 17900, -900], ['Bixter', 19000, 1000], ['Shetland hill', 18400, -300], ['slope path', 17720, -620],
  ['Watten', 19900, 12100], ['Scotland low', 20600, 11300],
];
let seed = 7;
const rnd = () => ((seed = Math.imul(seed, 48271) % 2147483647) & 0x7fffffff) / 2147483647;
const pct = (d, p) => { const s = [...d].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };
const f2 = (x) => x.toFixed(2).padStart(5);
const N = 1200, rows = [];
console.log(`drawn minus physics ground (m), ${N} points a site, |d|: p95 / max within 100 m and within 300 m of a craft on the ground`);
console.log(`${'site'.padEnd(14)}${'patch, just built'.padStart(26)}${'patch, 300 m off'.padStart(26)}${'near ground (hi): fine / coarse, max'.padStart(40)}`);
for (const [name, e0, z0] of SITES) {
  const P0 = patchAt(ctx, e0, z0, true), P1 = patchAt(ctx, e0 + 300, z0, true);
  const res = { p0: [[], []], p1: [[], []] };
  for (let k = 0; k < N; k++) {
    const r = k < N / 2 ? 100 * Math.sqrt(rnd()) : 100 + 200 * rnd(), t = rnd() * 2 * Math.PI, e = e0 + r * Math.cos(t), z = z0 + r * Math.sin(t), h = H(e, z);
    for (const [key, P] of [['p0', P0], ['p1', P1]]) { const d = Math.abs(P.tri(e, z) - h); res[key][1].push(d); if (r <= 100) res[key][0].push(d); }
  }
  // the near ground: every node the physics' own (to float32), and its triangles against the lattice's bilinear
  const out = [];
  for (const hi of [true, false]) {
    const t0 = Date.now(), g = R3.nearGeo(EARTH, A(e0), z0, hi), ms = Date.now() - t0, n = g.n;
    let bad = 0, nodes = 0;
    for (const t of g.tiles.values()) for (let jj = 0; jj <= g.T; jj++) for (let ii = 0; ii <= g.T; ii++) {
      const h = t.h[jj * (g.T + 1) + ii];
      if (h !== h) continue;
      const ia = t.TI * g.T + ii, iz = t.TJ * g.T + jj, phys = T.heightAt(EARTH, ((((ia % n) + n) % n) * 2 * Math.PI) / n, iz * 2);
      nodes++; if (Math.fround(phys) !== h) bad++;
    }
    const half = (g.NT * g.T * 2) / 2, fhalf = (g.NF * g.T * 2) / 2, fine = [], coarse = [];
    const ce = -ctx.wrapAngle(((g.ti0 + g.NT / 2) * g.T * 2 * Math.PI) / n - EARTH.padAngle) * EARTH.radius, cz = (g.tj0 + g.NT / 2) * g.T * 2;
    const fe = -ctx.wrapAngle(((g.fi0 + g.NF / 2) * g.T * 2 * Math.PI) / n - EARTH.padAngle) * EARTH.radius, fz = (g.fj0 + g.NF / 2) * g.T * 2;
    for (let k = 0; k < 3000; k++) {
      const e = ce + (rnd() * 2 - 1) * half * 0.995, z = cz + (rnd() * 2 - 1) * half * 0.995, d = Math.abs(R3.nearGeoAt(g, A(e), z) - H(e, z));
      (Math.abs(e - fe) < fhalf * 0.995 && Math.abs(z - fz) < fhalf * 0.995 ? fine : coarse).push(d);
    }
    const fm = pct(fine, 1), cm = pct(coarse, 1);
    verdict(!bad && fm < 0.05 && cm < 0.15, `${name} ${hi ? 'high' : 'low '}: ${nodes} nodes, ${bad} off the physics; ${g.evals} heights in ${ms} ms; fine ${f2(pct(fine, 0.95))} / ${f2(fm)} m, coarse ${f2(pct(coarse, 0.95))} / ${f2(cm)} m (p95 / max)`);
    if (hi) out.push(`${f2(pct(fine, 0.95))}/${f2(fm)}   ${f2(pct(coarse, 0.95))}/${f2(cm)}`);
  }
  const s = (k, w) => `${f2(pct(res[k][w], 0.95))}/${f2(pct(res[k][w], 1))}`;
  rows.push(`${name.padEnd(14)}${(s('p0', 0) + '  ' + s('p0', 1)).padStart(26)}${(s('p1', 0) + '  ' + s('p1', 1)).padStart(26)}${out[0].padStart(40)}`);
}
console.log('\n' + rows.join('\n'));
verdict(!fails, fails ? `ground probe: ${fails} problems` : 'ground probe: the near ground is the physics\' ground at every node, within 5 cm in its fine middle and 15 cm over its 4 m cells');
if (fails) process.exitCode = 1;
