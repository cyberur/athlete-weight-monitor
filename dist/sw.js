/* Athlete Weight Monitor service worker — generated at build time. */
const VERSION = '6b5fbfd13c36';
const CACHE = `awm-${VERSION}`;
const PRECACHE = [
  "./",
  "assets/index-BYEhKOzY.js",
  "assets/index-GgHMEvof.css",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "index.html",
  "manifest.webmanifest"
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('awm-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache-first for everything we precached; navigations fall back to the cached app shell.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const shell = (await cache.match('./index.html', { ignoreVary: true })) || (await cache.match('./', { ignoreVary: true }));
        if (shell) return shell;
        return fetch(req);
      }),
    );
    return;
  }

  event.respondWith(
    // ignoreVary: hosts often send "Vary: Origin" and Vite loads assets with crossorigin,
    // which would otherwise make the cached copies miss when offline.
    caches.match(req.url, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(req)),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source && event.source.postMessage({ type: 'version', version: VERSION });
});
