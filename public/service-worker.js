const CACHE = 'studio-inventory-v291-r3';
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
  '/js/views/studio-setup.js',
  '/js/views/studio-browse.js',
  '/js/lib/item-placement.js',
  '/js/lib/item-profiles.js',
  '/js/views/loans.js',
  '/js/views/scan-lookup.js',
  '/js/views/floorplan-tab.js',
  '/js/views/software.js',
  '/js/lib/floorplan-geometry.js',
  '/js/lib/floorplan-editor.js',
  '/js/lib/wall-elevation.js',
  '/js/lib/wall-photo-editor.js',
  '/js/lib/measurement.js',
  '/js/lib/wall-cutout.js',
  '/js/lib/wall-perspective.js',
  '/js/lib/wall-calibrator.js',
  '/map.html',
  '/css/map.css',
  '/js/map.js',
  '/js/lib/binder-print.js',
  '/js/lib/completeness-ui.js',
  '/photo-upload.html',
  '/css/photo-upload.css',
  '/js/photo-upload.js',
  '/js/lib/label-settings.js',
  '/js/lib/dymo-labels.js',
  '/js/lib/insurance-rows.mjs',
  '/vendor/jspdf/jspdf.umd.min.js',
  '/vendor/jspdf/jspdf.plugin.autotable.min.js',
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

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
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
  const url = new URL(e.request.url);
  // Pages: always ask the server first, so an update never runs new scripts
  // against an old page. Offline, fall back to the cached page (query strings,
  // which can hold share tokens, are ignored and never stored).
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(async () => {
        const cached = await caches.match(url.pathname, { ignoreSearch: true })
          || await caches.match('/index.html');
        return cached || offlinePage();
      })
    );
    return;
  }
  const isAppAsset = url.pathname.startsWith('/js/') || url.pathname.startsWith('/css/')
    || url.pathname.startsWith('/vendor/');
  if (isAppAsset) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET' && !url.search) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) || Response.error())
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET' && !url.search) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Studio Inventory</title>'
    + '<p style="font-family:system-ui;padding:2rem">Studio Inventory is not reachable. '
    + 'Check that the studio computer is on and the app is running, then reload.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
