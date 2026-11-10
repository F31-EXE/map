// GrimMap web app offline: the app itself (page, scripts, fonts, icons) is kept in a
// cache so the installed app opens in the field without internet. Map tiles, Firebase
// and other sites go to the network as usual; offline maps are the region schemes
// stored in the browser (see src/services/vectorRegions.web.ts).
const CACHE = 'grimmap-app-v1';
const SHELL = './';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        c
          .addAll([SHELL, './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'])
          .then(() => c.add('./regions.json').catch(() => {}))
      )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page sends what it loaded before this worker took over (first visit), so the
// app opens offline right after the first visit.
self.addEventListener('message', (e) => {
  const urls = e.data && e.data.type === 'cache' && Array.isArray(e.data.urls) ? e.data.urls : [];
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(
        urls
          .filter((u) => new URL(u, self.location.href).origin === self.location.origin)
          .map((u) => c.match(u).then((hit) => hit || c.add(u).catch(() => {})))
      )
    )
  );
});

function keep(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Pages (any route of the single-page app): fresh when online, the saved one offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => keep(SHELL, res))
        .catch(() => caches.match(SHELL))
    );
    return;
  }
  // The region list changes monthly: fresh when online.
  if (url.pathname.endsWith('/regions.json')) {
    e.respondWith(
      fetch(req)
        .then((res) => keep(req, res))
        .catch(() => caches.match(req))
    );
    return;
  }
  // Scripts, styles, fonts, images: file names change with every build, so the
  // cached copy is always right.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res))));
});
