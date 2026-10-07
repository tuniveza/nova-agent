/* Nova Calendar — sw.js
   Makes Nova Calendar work offline once it's been opened: the app is kept in a cache and refreshed
   in the background (updates arrive on the next visit), and fonts are kept once fetched. Your notes
   and day cards live in localStorage, not here. Bump VERSION when the list of app files changes. */
const VERSION = 'nova-calendar-v7';
const APP = [
  './', './manifest.webmanifest', './css/nova.css',
  './js/embed.js', './js/sfx.js', './js/themes.js', './js/presets.js', './js/sky.js', './js/cosmos.js', './js/store.js', './js/backdrop.js', './js/app.js', './js/portal-badge.js', './js/nova-manual.js', './js/nova-manual-data.js',
  './assets/icon.svg', './assets/icon-192.png', './assets/icon-512.png', './assets/apple-touch-icon.png', './assets/sigil.svg'
];
const KEEP_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const key = req.mode === 'navigate' ? './' : req;
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
        const fresh = fetch(req).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => cached);
        return cached || fresh;
      })
    );
  } else if (KEEP_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(VERSION + '-fonts').then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      })
    );
  }
});
