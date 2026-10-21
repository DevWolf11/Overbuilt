// The real Earth map as raw layers for Terrain.setEarthData, from test/.cache/earth/ (made by dump-earth.mjs with
// Chromium the first time, or when assets/ changes).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.resolve(process.env.ROOT || path.join(__dirname, '..', '..'));
const DIR = path.join(ROOT, 'test', '.cache', 'earth');
const FILES = ['earth-height.png', 'earth-color.jpg', 'earth-night.jpg', 'earth-lakes.png', 'earth-urban.png', 'earth-regions.png', 'earth-places.json', 'earth-lines.bin'];

function fresh() {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json')));
    return meta.stamp === FILES.map((f) => f + ':' + fs.statSync(path.join(ROOT, 'assets', f)).size).join(' ');
  } catch { return false; }
}
let cached = null;
function layers() {
  if (cached) return cached;
  if (!fresh()) {
    console.error('(decoding the Earth map into test/.cache/earth with Chromium, once)');
    execFileSync(process.execPath, [path.join(__dirname, 'dump-earth.mjs')], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ROOT } });
  }
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json')));
  const im = (k) => ({ data: new Uint8Array(fs.readFileSync(path.join(DIR, k + '.bin'))), w: meta[k][0], h: meta[k][1], step: meta[k][2] });
  const lb = fs.readFileSync(path.join(DIR, 'lines.bin'));
  cached = { height: im('height'), color: im('color'), night: im('night'), lakes: im('lakes'), urban: im('urban'), regions: im('regions'),
    places: JSON.parse(fs.readFileSync(path.join(DIR, 'places.json'))), lines: lb.buffer.slice(lb.byteOffset, lb.byteOffset + lb.length) };
  return cached;
}
module.exports = { layers };
