// Offline support: always try the network first so updates show up on the next load, and fall back to
// the cached copy when offline.
const CACHE = 'rocket-science-sim-v7';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/util.js', 'js/space.js', 'js/terrain.js', 'js/parts.js', 'js/vessel.js', 'js/ui.js', 'js/audio.js',
  'js/world.js', 'js/parts3d.js', 'js/render3d.js', 'js/vendor/three.min.js',
  'js/career.js', 'js/map.js', 'js/builder.js', 'js/flight.js', 'js/main.js',
];
self.addEventListener('install', (e) => {
  // bypass the browser's HTTP cache so a new version never caches old files
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
