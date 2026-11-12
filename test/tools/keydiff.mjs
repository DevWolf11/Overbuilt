// Key-by-key proof that only the intended baseline keys moved (the PR #36/#38 method). It compares every
// test/baseline/*.json in a checkout's working tree with the same file at a git ref (a commit, branch or tag), key
// by key and field by field, and fails on anything that moved, appeared or went missing without being allowed.
//
//   node test/tools/keydiff.mjs <baseRef> [--repo dir] [--allow file:key[=f1|f2],...] [--add file:key,...]
//
//   <baseRef>  what to compare with: 68ea3fe, main, HEAD~1, a tag. Resolved in the checkout being checked.
//   --repo     the checkout whose working tree is checked (default: the one holding this script, whatever the cwd,
//              so a worktree's copy checks that worktree).
//   --allow    keys that may move. file:key lets any of its fields move; file:key=f1|f2 only those fields (e.g.
//              fingerprint:falcon=edges|kept|of|mass|com|I|dv); file:* lets every key of that file move (only for a
//              whole-file move the plan names). A key with no fields (a string value, as handling.json's) moves as
//              "(value)". "file" is the baseline's name without .json (fingerprint, traces, mp-air, ...).
//   --add      keys that may be new (file:key, or file:* for any new key of that file).
//   Both flags take comma-separated lists and may be repeated; a key that itself holds a comma (some mp-air keys)
//   can only be named through file:*.
//
// Examples (run from anywhere):
//   node test/tools/keydiff.mjs 68ea3fe                       # nothing may differ
//   node test/tools/keydiff.mjs big-p2 --allow "driving:falcon takeoff,handling:fs16"
//   node test/tools/keydiff.mjs big-p3 --add "fingerprint:bumble,traces:bumble,mp-measure:bumble"
//
// It prints one line per baseline file (keys before -> after; moved, added, removed), then each moved key with the
// fields that moved ("moved" when allowed, "MOVED!" when not), each new key ("added" / "ADDED!") and each key or
// file that went missing ("GONE!": never allowed). Exit code 0 when every change was allowed, 1 when not, 2 on a
// usage error or a ref git can't resolve.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node test/tools/keydiff.mjs <baseRef> [--repo dir] [--allow file:key[=f1|f2],...] [--add file:key,...]';
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) { console.log(USAGE); process.exit(0); }
const VALUED = new Set(['--repo', '--allow', '--add']);
const opts = (n) => args.flatMap((a, i) => (a === n && i + 1 < args.length ? [args[i + 1]] : []));
const base = args.find((a, i) => !a.startsWith('-') && !(i > 0 && VALUED.has(args[i - 1])));
const unknown = args.filter((a, i) => a.startsWith('-') && !VALUED.has(a) && !(i > 0 && VALUED.has(args[i - 1])));
if (!base || unknown.length) { console.error((unknown.length ? `unknown option ${unknown.join(' ')}\n` : '') + USAGE); process.exit(2); }
const repo = path.resolve(opts('--repo').pop() || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
try { git('rev-parse', '--verify', '--quiet', `${base}^{commit}`); } catch { console.error(`keydiff: ${base} is not a commit in ${repo}`); process.exit(2); }

const list = (n) => opts(n).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
const allowF = new Map(); // file:key -> Set of fields, or null (any field)
for (const e of list('--allow')) { const i = e.indexOf('='); allowF.set(i < 0 ? e : e.slice(0, i), i < 0 ? null : new Set(e.slice(i + 1).split('|'))); }
const add = new Set(list('--add'));
const ok = (S, f, k) => S.has(`${f}:${k}`) || S.has(`${f}:*`);
const okMove = (f, k, fields) => {
  const r = allowF.has(`${f}:${k}`) ? allowF.get(`${f}:${k}`) : allowF.has(`${f}:*`) ? null : undefined;
  return r === null || (r !== undefined && fields.every((x) => r.has(x)));
};

const dir = path.join(repo, 'test', 'baseline');
const here = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
let then = [];
try { then = git('ls-tree', '--name-only', `${base}:test/baseline/`).split('\n').filter((f) => f.endsWith('.json')); } catch { then = []; }
let bad = 0;
for (const file of [...new Set([...here, ...then])].sort()) {
  const f = file.replace(/\.json$/, '');
  if (!here.includes(file)) { bad++; console.log(`FAIL ${f}: the whole file is GONE! from the working tree`); continue; }
  let A = {};
  if (then.includes(file)) A = JSON.parse(git('show', `${base}:test/baseline/${file}`));
  const B = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const moved = [], added = [], gone = [];
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (!(k in A)) { added.push(k); continue; }
    if (!(k in B)) { gone.push(k); continue; }
    const a = A[k], b = B[k];
    if (typeof a !== 'object' || a === null) { if (JSON.stringify(a) !== JSON.stringify(b)) moved.push([k, ['(value)']]); continue; }
    const bo = b && typeof b === 'object' ? b : {};
    const fields = [...new Set([...Object.keys(a), ...Object.keys(bo)])].filter((x) => JSON.stringify(a[x]) !== JSON.stringify(bo[x]));
    if (b === null || typeof b !== 'object') fields.push('(value)');
    if (fields.length) moved.push([k, fields]);
  }
  const badMoved = moved.filter(([k, fl]) => !okMove(f, k, fl)), badAdded = added.filter((k) => !ok(add, f, k));
  bad += badMoved.length + badAdded.length + gone.length;
  const tag = badMoved.length || badAdded.length || gone.length ? 'FAIL' : 'ok  ';
  console.log(`${tag} ${f}: ${Object.keys(A).length} -> ${Object.keys(B).length} keys; moved ${moved.length}, added ${added.length}, removed ${gone.length}`);
  for (const [k, fl] of moved) console.log(`     ${okMove(f, k, fl) ? 'moved ' : 'MOVED!'} ${k}: ${fl.join(', ')}`);
  for (const k of added) console.log(`     ${ok(add, f, k) ? 'added ' : 'ADDED!'} ${k}`);
  for (const k of gone) console.log(`     GONE!  ${k}`);
}
console.log(bad ? `FAIL: ${bad} unexpected baseline changes against ${base}` : `ok: only the allowed baseline keys moved against ${base}`);
process.exitCode = bad ? 1 : 0;
