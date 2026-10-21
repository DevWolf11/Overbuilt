// Compare results with a committed baseline in test/baseline/<name>.json. Pass --update (or UPDATE=1) to rewrite
// the baseline instead, after a change that is meant to alter the results; say why in the commit.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'baseline');
const updating = () => process.argv.includes('--update') || process.env.UPDATE === '1';

// data: { key: { field: value } }. Returns the number of differences (0 when updating).
function check(name, data, { show = 20, allowNew = false } = {}) {
  const file = path.join(DIR, name + '.json');
  if (updating()) {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
    console.log(`baseline ${name} written (${Object.keys(data).length} entries)`);
    return 0;
  }
  if (!fs.existsSync(file)) { console.log(`FAIL no baseline ${path.relative(process.cwd(), file)}: run with --update`); process.exitCode = 1; return 1; }
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  for (const k of new Set([...Object.keys(base), ...Object.keys(data)])) {
    const A = base[k], B = data[k];
    if (A === undefined) { if (!allowNew) out.push(`${k}: new (not in the baseline)`); continue; }
    if (B === undefined) { out.push(`${k}: missing`); continue; }
    if (typeof A !== 'object' || A === null) { if (JSON.stringify(A) !== JSON.stringify(B)) out.push(`${k}\n  was ${JSON.stringify(A)}\n  now ${JSON.stringify(B)}`); continue; }
    for (const f of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const x = JSON.stringify(A[f]), y = JSON.stringify(B[f]);
      if (x !== y) out.push(`${k}.${f}\n  was ${String(x).slice(0, 400)}\n  now ${String(y).slice(0, 400)}`);
    }
  }
  for (const d of out.slice(0, show)) console.log('DIFF ' + d);
  if (out.length > show) console.log(`... and ${out.length - show} more`);
  console.log(out.length ? `FAIL ${name}: ${out.length} differences from test/baseline/${name}.json` : `ok   ${name}: identical to the baseline (${Object.keys(base).length} entries)`);
  if (out.length) process.exitCode = 1;
  return out.length;
}
module.exports = { check, updating };
