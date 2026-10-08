// Ad-lib trainer service worker: versioned offline cache.
// Bump CACHE when you upload a new version so old files are cleared.
const CACHE = 'adlib-v6';
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
  './js/voicing.js',
  './icon-180.png', './icon-192.png', './icon-512.png'
];

// Each version's files are fetched fresh (bypassing the HTTP cache, which GitHub Pages
// keeps for 10 minutes) and stored together, so a version never mixes old and new modules.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, {cache:'reload'})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// App files: only from this version's cache (the page reloads when a new version takes over).
// Anything else (e.g. web fonts): network first, cached copy when offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(e.request, {ignoreSearch: true});
    if (sameOrigin && cached) return cached;
    try {
      const res = await fetch(e.request);
      if (!sameOrigin && res && (res.ok || res.type === 'opaque')) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      if (cached) return cached;
      throw err;
    }
  }));
});
