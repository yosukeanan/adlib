// Ad-lib trainer service worker: offline cache (stale-while-revalidate).
// Bump CACHE when you upload a new version so old files are cleared.
const CACHE = 'adlib-v2';
// Every file the app needs offline. Add new modules here (tests/smoke.mjs checks this list).
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/band.js',
  './js/board.js',
  './js/frame.js',
  './js/main.js',
  './js/mic.js',
  './js/player.js',
  './js/setup.js',
  './js/songs.js',
  './js/state.js',
  './js/stats.js',
  './js/synth.js',
  './js/theory.js',
  './js/ui.js',
  './js/util.js',
  './icon-180.png', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Serve from cache immediately, refresh the cache in the background.
// Updates therefore appear on the next launch.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(e.request, {ignoreSearch: true});
    const network = fetch(e.request).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
