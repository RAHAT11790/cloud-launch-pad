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
const brandIcon = 'https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png';

// Handle background messages (both notification+data and data-only)
messaging.onBackgroundMessage((payload) => {
  // If notification payload exists, FCM SDK may auto-show it
  // For data-only messages, we must show manually
  const notification = payload.notification || {};
  const data = payload.data || {};
  
  const notifTitle = notification.title || data.title || 'RS ANIME';
  const notifBody = notification.body || data.body || '';
  const notifImage = notification.image || data.image || undefined;
  const notifIcon = notification.icon || data.icon || brandIcon;
  
  const notifOptions = {
    body: notifBody,
    icon: notifIcon,
    image: notifImage,
    badge: brandIcon,
    vibrate: [200, 100, 200],
    data: data,
    tag: `rsanime-bg-${Date.now()}`,
    requireInteraction: false,
  };
  
  return self.registration.showNotification(notifTitle, notifOptions);
});

// Also listen for raw push events as fallback
self.addEventListener('push', (event) => {
  // Only handle if FCM SDK didn't already handle it
  if (event.data) {
    try {
      const payload = event.data.json();
      // If there's no notification key, FCM SDK won't auto-show, handle here
      if (!payload.notification && payload.data) {
        const data = payload.data;
        const title = data.title || 'RS ANIME';
        const options = {
          body: data.body || '',
          icon: data.icon || brandIcon,
          image: data.image || undefined,
          badge: brandIcon,
          vibrate: [200, 100, 200],
          data: data,
          tag: `rsanime-push-${Date.now()}`,
        };
        event.waitUntil(self.registration.showNotification(title, options));
      }
    } catch (e) {
      // Not JSON, ignore
    }
  }
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

// Activate immediately without waiting
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
