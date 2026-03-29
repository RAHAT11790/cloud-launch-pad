// Service Worker for RS ANIME - Push Notifications + Offline Downloads Page
const CACHE_NAME = 'rs-anime-offline-v1';
const MAIN_DOMAIN = 'https://rsanime03.lovable.app';
const OFFLINE_URLS = [
  '/',
  '/index.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first for app shell, network-first for everything else
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin navigations
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html'))
    );
    return;
  }
  // For JS/CSS assets, try network first then cache
  if (url.origin === self.location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))) {
    event.respondWith(
      fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      }).catch(() => caches.match(event.request))
    );
  }
});

// Handle notification click - open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || '/';
  const urlToOpen = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
    ? rawUrl
    : `${MAIN_DOMAIN}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(MAIN_DOMAIN) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) return client.navigate(urlToOpen);
          return client;
        }
      }
      return self.clients.openWindow(urlToOpen);
    })
  );
});