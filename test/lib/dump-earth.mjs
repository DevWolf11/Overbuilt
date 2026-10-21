// Decode the Earth map in assets/ the way the game does (Chromium, no colour management) and write the raw layers to
// test/.cache/earth/, for the Node tests (Node can't decode the PNG and JPEG layers by itself). Run by
// test/lib/earth.js when the cache is missing; run it by hand after re-baking assets/.  node test/lib/dump-earth.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, launch, serve } from './browser.mjs';

const OUT = path.join(ROOT, 'test', '.cache', 'earth');
// layer: [file, channels kept]
const LAYERS = { height: ['earth-height.png', 1], color: ['earth-color.jpg', 3], night: ['earth-night.jpg', 1], lakes: ['earth-lakes.png', 3],
  urban: ['earth-urban.png', 1], regions: ['earth-regions.png', 3] };

const srv = await serve();
const b = await launch();
const page = await b.newPage();
await page.goto(srv.url + 'manifest.webmanifest');
fs.mkdirSync(OUT, { recursive: true });
const meta = {};
for (const [k, [file, step]] of Object.entries(LAYERS)) {
  const r = await page.evaluate(async ({ url, step }) => {
    const bl = await (await fetch(url)).blob();
    const im = await createImageBitmap(bl, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const cv = new OffscreenCanvas(im.width, im.height), g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, im.width, im.height).data, n = im.width * im.height, o = new Uint8Array(n * step);
    for (let i = 0; i < n; i++) for (let c = 0; c < step; c++) o[i * step + c] = d[i * 4 + c];
    let s = '';
    for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
    return { w: im.width, h: im.height, b64: btoa(s) };
  }, { url: srv.url + 'assets/' + file, step });
  fs.writeFileSync(path.join(OUT, k + '.bin'), Buffer.from(r.b64, 'base64'));
  meta[k] = [r.w, r.h, step];
  console.log(`${k}: ${r.w}x${r.h}x${step}`);
}
fs.copyFileSync(path.join(ROOT, 'assets', 'earth-places.json'), path.join(OUT, 'places.json'));
fs.copyFileSync(path.join(ROOT, 'assets', 'earth-lines.bin'), path.join(OUT, 'lines.bin'));
// remember which assets these came from, so a re-bake invalidates the cache
const stamp = Object.values(LAYERS).map(([f]) => f).concat(['earth-places.json', 'earth-lines.bin'])
  .map((f) => f + ':' + fs.statSync(path.join(ROOT, 'assets', f)).size).join(' ');
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ ...meta, stamp }));
await b.close(); srv.close();
console.log('wrote ' + OUT);
