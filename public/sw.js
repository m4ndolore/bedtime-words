/* Caches the page shell so bedtime works offline after the first visit.
 * Bump CACHE on every release so phones pick up the new files. */
const CACHE = 'bedtime-words-2026-10-23a';
const SHELL = [
  '/',
  '/css/app.css',
  '/js/sound.js',
  '/js/store.js',
  '/js/app.js',
  '/pool.json',
  '/fonts/patrick-hand-latin.woff2',
  '/fonts/gaegu-latin-400.woff2',
  '/fonts/gaegu-latin-700.woff2',
  '/icons/icon.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/* Network first for pages and the pool so wording fixes show up; cache first for the rest. */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const fresh = request.mode === 'navigate' || url.pathname === '/pool.json';
  if (fresh) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request.mode === 'navigate' && url.pathname === '/' ? '/' : request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('/'))),
    );
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
