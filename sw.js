// Service worker: caches the app shell so the app starts offline.
// Weather data is cached by the app itself (localStorage), not here.
// IMPORTANT: bump VERSION on every deployment so phones pick up the update.
const VERSION = 'v1.5.0';
const SHELL_CACHE = `wetter-shell-${VERSION}`;
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/api.js',
  './js/storage.js',
  './js/weathercodes.js',
  './js/background.js',
  './js/modal.js',
  './js/warnings.js',
  './js/radar.js',
  './js/ensemble.js',
  './js/chart.js',
  './icons/logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API calls go straight to the network

  // Stale-while-revalidate for the app shell
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((res) => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
