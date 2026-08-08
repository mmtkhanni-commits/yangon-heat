/* Cache the shell so the app opens offline, and keep the last successful API
   response so an offline visitor still sees a reading.

   The API now lives on its own origin, so cross-origin requests are passed
   straight through rather than intercepted — trying to cache them here was
   turning a slow response into a failed one. */
const SHELL = 'yangon-heat-shell-v10';
const DATA = 'yangon-heat-data-v10';
const FILES = ['./', './index.html', './styles.css', './app.js',
               './manifest.json', './privacy.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // anything on another origin — the API, map tiles, fonts — goes straight to
  // the network; the page's own code handles its failures
  if (url.origin !== self.location.origin) return;

  // asset links must always come from the network: a stale copy breaks the
  // Android app's link to this domain
  if (url.pathname.startsWith('/.well-known/')) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(DATA).then((c) => c.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
