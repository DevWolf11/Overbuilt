// Run the test suites and print a summary.
//   node test/run.mjs              the headless suites (Node only, about a minute)
//   node test/run.mjs --browser    the browser suites too (Playwright + Chromium, a few minutes)
//   node test/run.mjs -v           print every suite's full output, not just failures
//   node test/run.mjs fingerprint traces    only the named suites
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const NODE = ['fingerprint.js', 'core.test.js', 'physics.test.js', 'flight.test.js', 'combat.test.js', 'mp.test.js', 'traces.js', 'handling.js'];
const BROWSER = ['browser/builder2d.mjs', 'browser/builder3d.mjs', 'browser/mp-two-tabs.mjs'];
const args = process.argv.slice(2), verbose = args.includes('-v');
const named = args.filter((a) => !a.startsWith('-'));
let suites = [...NODE, ...(args.includes('--browser') ? BROWSER : [])];
if (named.length) suites = [...NODE, ...BROWSER].filter((s) => named.some((n) => s.includes(n)));

const run = (file, argv = [path.join(DIR, file)]) => new Promise((ok) => {
  const t0 = Date.now(), p = spawn(process.execPath, argv, { cwd: path.join(DIR, '..') });
  let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => ok({ file, code, out, secs: (Date.now() - t0) / 1000 }));
});

// make the Earth map cache first if it's missing or stale (one Chromium run), so parallel suites don't race to
const earth = await run('earth cache', ['-e', `require(${JSON.stringify(path.join(DIR, 'lib', 'earth.js'))}).layers()`]);
if (earth.code !== 0) console.log('The Earth map cache could not be made (Playwright missing?):\n' + earth.out);
const results = [];
// Node suites in parallel; browser suites one at a time (they're heavy and the MP one uses two tabs)
const node = suites.filter((s) => !s.startsWith('browser/')), browser = suites.filter((s) => s.startsWith('browser/'));
const width = Math.max(1, Math.min(node.length, os.cpus().length));
const queue = [...node];
await Promise.all(Array.from({ length: width }, async () => { while (queue.length) results.push(await run(queue.shift())); }));
for (const s of browser) results.push(await run(s));

let bad = 0;
for (const r of [...suites].map((s) => results.find((x) => x.file === s))) {
  const failed = r.code !== 0 || /^FAIL/m.test(r.out);
  if (failed) bad++;
  const tally = (r.out.match(/^(all \d+ passed|\d+ of \d+ FAILED)$/m) || [])[0] || (r.out.match(/^(ok|FAIL)\s+\S+: .*$/m) || [''])[0];
  console.log(`${failed ? 'FAIL' : 'ok  '}  ${r.file.padEnd(26)} ${r.secs.toFixed(1).padStart(5)} s  ${tally}`);
  if (failed || verbose) console.log(r.out.split('\n').map((l) => '      ' + l).join('\n'));
}
console.log(bad ? `\n${bad} of ${suites.length} suites failed` : `\nall ${suites.length} suites passed`);
process.exitCode = bad ? 1 : 0;
