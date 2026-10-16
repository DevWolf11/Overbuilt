// Bundle the game into one self-contained HTML file: dist/rocket-science-simulator.html
// Usage: node tools/build-single.mjs [--fragment]
//   --fragment  omit <!doctype>/<html>/<head>/<body> wrappers (for hosts that add their own skeleton)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fragment = process.argv.includes('--fragment');
let html = readFileSync(join(root, 'index.html'), 'utf8');

// inline the stylesheet
html = html.replace(/<link rel="stylesheet" href="css\/style.css">/, () => `<style>\n${readFileSync(join(root, 'css/style.css'), 'utf8')}</style>`);
// inline scripts, in order
html = html.replace(/<script src="(js\/[\w-]+\.js)"><\/script>/g, (_, src) => `<script>\n${readFileSync(join(root, src), 'utf8')}</script>`);
// a single file has no service worker, manifest or icon files next to it
html = html.replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/g, '');
html = html.replace('<script>\n\'use strict\';\n// Shared helpers', '<script>window.RSS_NO_SW = true;</script>\n<script>\n\'use strict\';\n// Shared helpers');

if (fragment) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\n/, '')
    .replace(/<meta name="viewport"[^>]*>\n/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = head.trim() + '\n' + body.trim() + '\n';
}
mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist', fragment ? 'rocket-science-simulator.fragment.html' : 'rocket-science-simulator.html');
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
