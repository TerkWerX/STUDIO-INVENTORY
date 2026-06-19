const CACHE = 'studio-inventory-v17';
const ASSETS = [
  '/',
  '/index.html',
  '/scan.html',
  '/guest.html',
  '/css/styles.css',
  '/css/scan.css',
  '/js/app.js',
  '/js/api.js',
  '/js/utils.js',
  '/js/scan.js',
  '/js/guest.js',
  '/js/views/dashboard.js',
  '/js/views/inventory.js',
  '/js/views/item-form.js',
  '/js/views/reports.js',
  '/js/views/manuals.js',
  '/js/views/about.js',
  '/js/views/brands.js',
  '/js/views/labels.js',
  '/js/views/binder.js',
  '/js/views/studio-view.js',
  '/js/views/loans.js',
  '/js/views/scan-lookup.js',
  '/js/views/floorplan-tab.js',
  '/js/lib/binder-print.js',
  '/js/lib/completeness-ui.js',
  '/photo-upload.html',
  '/css/photo-upload.css',
  '/js/photo-upload.js',
  '/js/lib/label-settings.js',
  '/js/lib/dymo-labels.js',
  '/manifest.json',
  '/icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('/uploads/')) {
    e.respondWith(fetch(e.request));
    return;
  }
  if (e.request.url.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'Offline — server unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});