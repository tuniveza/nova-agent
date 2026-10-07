/* Nova Notes — sw.js
   Makes Nova Notes work offline once it's been opened: the app itself is kept in a cache and
   refreshed in the background (so updates arrive on the next visit), fonts are kept once fetched,
   and Word import's helper library is kept after its first use. Notes themselves live in
   IndexedDB, not here. Bump VERSION when the list of app files changes. */
const VERSION = 'nova-notes-v6';
const APP = [
  './',
  './manifest.webmanifest',
  './css/nova-notes.css',
  './js/sfx.js',
  './js/themes.js',
  './js/backdrop.js',
  './js/store.js',
  './js/convert.js',
  './js/google.js',
  './js/editor.js',
  './js/app.js',
  './js/portal-badge.js',
  './js/nova-manual.js',
  './js/nova-manual-data.js',
  './assets/sigil.svg',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/apple-touch-icon.png'
];
const KEEP_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The app's own files: answer from the cache straight away, refresh it in the background
  if (url.origin === self.location.origin) {
    // Launches like ./?new or ./?share=… are the app page itself
    const key = req.mode === 'navigate' ? './' : req;
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(key, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  // Fonts and the Word-import library: keep them once fetched
  if (KEEP_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(VERSION + '-ext').then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      })
    );
  }
  // Everything else (Google sign-in, Drive) goes straight to the network
});
