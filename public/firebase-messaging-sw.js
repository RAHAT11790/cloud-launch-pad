// Firebase Messaging Service Worker for background push notifications
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCP5bfue5FOc0eTO4E52-0A0w3PppO3Mvw",
  authDomain: "rs-anime.firebaseapp.com",
  projectId: "rs-anime",
  storageBucket: "rs-anime.firebasestorage.app",
  messagingSenderId: "843989457516",
  appId: "1:843989457516:web:57e0577d092183eedd9649"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  const { title, body, icon, image } = payload.notification || {};
  const notifTitle = title || 'RS ANIME';
  const brandIcon = 'https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png';
  const notifOptions = {
    body: body || '',
    icon: icon || brandIcon,
    image: image || undefined,
    badge: brandIcon,
    vibrate: [200, 100, 200],
    data: payload.data || {},
    tag: `rsanime-bg-${Date.now()}`,
  };
  self.registration.showNotification(notifTitle, notifOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const rawUrl = event.notification.data?.url || '/';
  const url = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
    ? rawUrl
    : `${self.location.origin}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) return client.navigate(url);
          return client;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
