// The stock ground vehicles (js/builder.js's TEMPLATES, spec §12) as design rows ({type, x, y, flip, rot, z, att, skin};
// att an index into the same list), exactly as the builder loads them (templateRows), for the tests: the TK-34, the MS-4
// Shermin, the Tygr I, the MA-1 Abrahm and the Pumo 8×8 by name, and every other ground template by its key (T.all).
// Nose toward +x, tracks or wheels beside the hull at ±z, the engine inside, the main gun at rot 3 in the turret's
// front with its trunnion at the turret face. Read from the checkout's own builder.js (or ROOT's, as test/lib/game.js).
//   const T = require('./lib/tanks.js');  G.craft(ctx, T.tk34, 'tank')
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.env.ROOT || path.join(__dirname, '..', '..'));
const src = fs.readFileSync(path.join(ROOT, 'js', 'builder.js'), 'utf8'), box = {};
vm.createContext(box);
vm.runInContext(src.match(/const TEMPLATES = \{[\s\S]*?\n\};/)[0] + '\n' + src.match(/function templateRows\(t\) \{[\s\S]*?\n\}/)[0] +
  '\nthis.TEMPLATES = TEMPLATES; this.templateRows = templateRows;', box);
const all = {};
for (const k of Object.keys(box.TEMPLATES)) if (box.TEMPLATES[k].kind === 'tank' || k === 'technical') all[k] = JSON.parse(JSON.stringify(box.templateRows(box.TEMPLATES[k])));
for (const k of ['tk34', 'ms4', 'tygr', 'ma1', 'pumo']) if (!all[k]) throw new Error(`test/lib/tanks.js: no '${k}' template in ${ROOT}/js/builder.js`);
module.exports = { tk34: all.tk34, ms4: all.ms4, tygr: all.tygr, ma1: all.ma1, pumo: all.pumo, all };
