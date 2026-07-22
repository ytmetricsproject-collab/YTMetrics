const CACHE_NAME = 'ytmetrics-cache-v21';
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
    })
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

  // ГЛАВНАЯ СТРАНИЦА (index.html): NETWORK-FIRST.
  // Раньше страница кэшировалась один раз и отдавалась из кэша НАВСЕГДА,
  // даже после того как мы выкатывали новый код на сервер — пользователи
  // залипали на старой версии. Теперь при каждом заходе браузер сначала
  // пытается получить свежий index.html с сервера, и только если сети нет
  // (оффлайн) — отдаёт последнюю сохранённую копию из кэша.
  const isNavigation = event.request.mode === 'navigate' ||
                        url.endsWith('/') || url.endsWith('/index.html');

  if (isNavigation) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(response => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Остальные статичные ресурсы (иконки, шрифты, манифест): CACHE-FIRST,
  // как и раньше — они меняются редко, кэшировать их надёжно.
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then(response => {
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

// Слушаем сообщение от клиента для ручной активации новой версии
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
