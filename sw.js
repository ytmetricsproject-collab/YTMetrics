const CACHE_NAME = 'ytmetrics-cache-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Пропускаем запросы к API и авторизации
  if (url.includes('/api/')) {
    return;
  }

  // Определяем, нужно ли кэшировать ресурс
  const isLocal = url.startsWith(self.location.origin);
  const isExternalAsset = url.includes('cdn.tailwindcss.com') ||
                          url.includes('fonts.googleapis.com') ||
                          url.includes('fonts.gstatic.com');

  if (!isLocal && !isExternalAsset) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then(response => {
        // Кэшируем только успешные ответы
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      }).catch(() => {
        // Игнорируем ошибки сети (например, оффлайн)
      });
    })
  );
});
