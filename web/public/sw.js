/**
 * Service worker for the Railway Inspection PWA.
 *
 * Strategy
 *   - App shell (HTML, JS, CSS, icons): cache-first with background refresh,
 *     so the application opens instantly and works with no connectivity.
 *   - Master-data GET requests: network-first with a cache fallback, so an
 *     inspector who loses signal keeps the station, unit, amenity, department
 *     and supervisor lists they last saw.
 *   - Everything else (writes, reports, evidence): straight to the network.
 *     Offline writes are queued in IndexedDB by the application itself, which
 *     keeps the queue visible and under the inspector's control.
 */
const VERSION = 'v1';
const SHELL_CACHE = `ri-shell-${VERSION}`;
const DATA_CACHE = `ri-data-${VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
];

/** Master-data endpoints worth keeping for offline use. */
const CACHEABLE_API = [
  '/api/masters/bootstrap',
  '/api/masters/stations',
  '/api/masters/trains',
  '/api/masters/units',
  '/api/masters/items',
  '/api/masters/departments',
  '/api/masters/supervisors',
  '/api/sync/snapshot',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: serve the shell so deep links work offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached ?? Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const cacheable = CACHEABLE_API.some((path) => url.pathname.startsWith(path));
    if (!cacheable) return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(DATA_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) =>
              cached ??
              new Response(JSON.stringify({ error: { code: 'OFFLINE', message: 'Offline and not cached' } }), {
                status: 503,
                headers: { 'content-type': 'application/json' },
              })
          )
        )
    );
    return;
  }

  // Static assets: cache-first, refreshed in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    })
  );
});
