/* Offline shell for Yangon Heat.

   The earlier version let a failed fetch reject, which handed the browser a
   network error and a blank page whenever the host hiccuped. Every path here
   now ends in something renderable: a cached copy, or a readable message. */

const SHELL = 'yangon-heat-shell-v15';
const DATA = 'yangon-heat-data-v15';
const FILES = ['./', './index.html', './styles.css', './app.js',
               './manifest.json', './privacy.html'];

const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="my"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ရန်ကုန် အပူအခြေအနေ</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0B1410; color:#E6F1E9; font-family:system-ui, sans-serif;
         padding:24px; text-align:center; line-height:1.7; }
  p { max-width:30rem; }
  .muted { color:#8AA394; font-size:14px; }
  button { margin-top:18px; background:#7CC49B; color:#06231a; border:none;
           border-radius:999px; padding:11px 22px; font-size:15px; cursor:pointer; }
</style></head>
<body><div>
  <p><b>ဆာဗာနှင့် ချိတ်ဆက်၍ မရသေးပါ</b></p>
  <p class="muted">ဆာဗာက အိပ်နေခြင်း ဖြစ်နိုင်ပါသည်။ တစ်မိနစ်ခန့် စောင့်ပြီး ပြန်ကြိုးစားပါ။<br>
  The server may be waking up. Wait a moment and try again.</p>
  <button onclick="location.reload()">ထပ်ကြိုးစားမည် / Try again</button>
</div></body></html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(FILES))
      .catch(() => {})            // a missing file must not block activation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // another origin — the API, map tiles, fonts — is the page's business
  if (url.origin !== self.location.origin) return;

  // asset links must always be fresh or the Android app loses its verification
  if (url.pathname.startsWith('/.well-known/')) return;

  // Navigations: try the network, fall back to the cached page, and only then
  // to a message. This is what was missing when the host returned 503.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) throw new Error(`status ${response.status}`);
          const copy = response.clone();
          caches.open(SHELL).then((c) => c.put('./index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('./index.html')
          .then((hit) => hit || caches.match('./')
            .then((root) => root || new Response(OFFLINE_PAGE, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
              status: 200,
            }))))
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(DATA).then((c) => c.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit
          || new Response(JSON.stringify({ detail: 'offline' }), {
            headers: { 'Content-Type': 'application/json' }, status: 503,
          })))
    );
    return;
  }

  // Everything else: cache first, network second, and never reject — a missing
  // stylesheet should not take the page down with it.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).catch(() =>
      new Response('', { status: 504, statusText: 'offline' })))
  );
});
