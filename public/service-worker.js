const CACHE_NAME = '3-notch-job-tracker-v6';
const urlsToCache = [
  '/logo.png'
];

// Install service worker
self.addEventListener('install', (event) => {
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache - caching logo only');
        return cache.addAll(urlsToCache);
      })
  );
});

// Network-first strategy - only cache images
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache images, not HTML/JS/CSS (prevents stale content on iPad/mobile)
        const url = event.request.url;
        const isImage = url.match(/\.(png|jpg|jpeg|gif|svg|ico)$/);
        if (response.ok && isImage) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache as fallback (offline support)
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            return new Response('Offline - please check your connection', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// Update service worker and clear old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});
