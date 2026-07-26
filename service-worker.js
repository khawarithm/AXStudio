/**
 * service-worker.js
 * AXStudio offline strategy:
 *   - App shell (HTML/CSS/JS/manifest/icons): precached at install, served
 *     cache-first with a background revalidation ("stale-while-revalidate").
 *   - Third-party library CDN files (pdf.js, pdf-lib, tesseract.js): cached
 *     at runtime on first successful fetch (network-first, falling back to
 *     cache), so the app keeps working offline after the first visit.
 *   - Everything else: network-first with cache fallback.
 *
 * Bump CACHE_VERSION whenever app shell files change to force clients to
 * pick up the new assets.
 */

const CACHE_VERSION = 'axstudio-v1.0.0';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/tokens.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/viewer.css',
  '/css/dialogs.css',
  '/css/animations.css',
  '/js/app.js',
  '/js/modules/utils.js',
  '/js/modules/notifications.js',
  '/js/modules/theme.js',
  '/js/modules/pdfEngine.js',
  '/js/modules/bookmarks.js',
  '/js/modules/exporter.js',
  '/js/modules/textExtractor.js',
  '/js/modules/pdfUtilities.js',
  '/js/modules/printManager.js',
  '/js/components/viewerController.js',
  '/js/components/fileLoader.js',
  '/js/components/navigation.js',
  '/js/components/exportPanel.js',
  '/js/components/extractPanel.js',
  '/js/components/utilitiesPanel.js',
  '/js/components/printPanel.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/favicon-32.png',
  '/assets/icons/favicon-16.png',
  '/assets/icons/apple-touch-icon.png',
];

// Third-party libs are CDN URLs in this build (see /libs/README.md to
// switch to fully local files for a stricter offline guarantee).
const CDN_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('axstudio-') && key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Strategy 1: CDN libraries -> cache-first (they're versioned/immutable URLs)
  if (CDN_LIBS.some((libUrl) => request.url.startsWith(libUrl.split('?')[0]))) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Strategy 2: Same-origin app shell files -> stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE));
    return;
  }

  // Strategy 3: everything else (other cross-origin requests) -> network-first
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || networkFetch || caches.match('/index.html');
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}
