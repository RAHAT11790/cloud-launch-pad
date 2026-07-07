// Firebase Messaging Service Worker — background push
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCP5bfue5FOc0eTO4E52-0A0w3PppO3Mvw",
  authDomain: "rs-anime.firebaseapp.com",
  projectId: "rs-anime",
  storageBucket: "rs-anime.firebasestorage.app",
  messagingSenderId: "843989457516",
  appId: "1:843989457516:web:57e0577d092183eedd9649",
});

const BRAND_ICON = "https://i.ibb.co.com/gLc93Bc3/android-chrome-512x512.png";
const messaging = firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = n.title || d.title || "RS ANIME";
  const options = {
    body: n.body || d.body || "",
    icon: n.icon || d.icon || BRAND_ICON,
    badge: BRAND_ICON,
    image: n.image || d.image || undefined,
    vibrate: [200, 100, 200],
    tag: d.contentId ? `rsanime-${d.contentId}` : `rsanime-${Date.now()}`,
    renotify: true,
    requireInteraction: false,
    data: { url: d.url || d.deepLink || "/", ...d },
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && (event.notification.data.url || event.notification.data.deepLink)) || "/";
  const url = raw.startsWith("http") ? raw : `${self.location.origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of list) {
      try {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) return client.navigate(url);
          return client;
        }
      } catch {}
    }
    return self.clients.openWindow(url);
  })());
});
