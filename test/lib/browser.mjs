// Shared bits for the browser tests: Playwright (local install, global install, or PLAYWRIGHT=<path to its
// index.mjs>), a static server for the repo, and a page opened on the game with test-friendly settings.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(process.env.ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));

export async function playwright() {
  if (process.env.PLAYWRIGHT) return import(pathToFileURL(process.env.PLAYWRIGHT).href);
  try { return await import('playwright'); } catch {}
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  for (const p of [path.join(g, 'playwright', 'index.mjs'), '/opt/node22/lib/node_modules/playwright/index.mjs']) {
    if (fs.existsSync(p)) return import(pathToFileURL(p).href);
  }
  throw new Error('Playwright not found: npm i -g playwright (and a Chromium), or set PLAYWRIGHT=/path/to/playwright/index.mjs');
}

// software WebGL, so the 3D view works headless
export async function launch() {
  const { chromium } = await playwright();
  const opts = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  if (process.env.CHROMIUM) opts.executablePath = process.env.CHROMIUM;
  return chromium.launch(opts);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream' };
// serve the repo on a free port; returns { url, close }
export function serve(root = ROOT) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(root, u.endsWith('/') ? u + 'index.html' : u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => srv.close() })));
}

// collect page errors (and console errors) under a tag
export function watch(page, errs, tag = '', warnings = false) {
  page.on('pageerror', (e) => errs.push(`${tag}PAGEERROR ${e.message}\n${e.stack}`));
  page.on('console', (m) => { if (m.type() === 'error' || (warnings && m.type() === 'warning')) errs.push(`${tag}${m.type()} ${m.text()}`); });
}

// the game in a fresh profile: help seen, hints and AI targets off, low quality; sandbox picked
export async function openGame(page, url, settings = {}) {
  await page.goto(url + 'index.html');
  await page.evaluate((s) => {
    localStorage.clear(); localStorage.setItem('rss.seenHelp', 'true');
    localStorage.setItem('rss.settings', JSON.stringify({ hints: false, targets: 'off', quality: 'low', ...s }));
  }, settings);
  await page.reload();
  await page.waitForTimeout(400);
  if (await page.isVisible('[data-mode="sandbox"]')) await page.click('[data-mode="sandbox"]');
}

export function checks(title) {
  let fails = 0, n = 0;
  if (title) console.log('# ' + title);
  const ok = (name, cond, extra) => {
    n++; if (!cond) fails++;
    console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra !== undefined ? '   ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
  };
  ok.done = () => { console.log(fails ? `${fails} of ${n} FAILED` : `all ${n} passed`); if (fails) process.exitCode = 1; return fails; };
  return ok;
}
