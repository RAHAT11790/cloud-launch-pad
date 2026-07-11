// Firebase Messaging Service Worker — background/closed-app push
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

const BRAND_ICON = "https://i.ibb.co/gLc93Bc3/android-chrome-512x512.png";
const BRAND_BADGE = "/notification-badge.svg";
const messaging = firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Unified renderer used by both onBackgroundMessage and raw push events.
async function showFromData(d) {
  d = d || {};
  const title = d.title || "RS ANIME";
  const options = {
    body: d.body || "",
    icon: d.icon || BRAND_ICON,
    badge: d.badge || BRAND_BADGE,
    image: d.image || undefined,
    vibrate: [200, 100, 200],
    tag: d.notificationId ? `rsanime-${d.notificationId}` : (d.contentId ? `rsanime-${d.contentId}-${Date.now()}` : `rsanime-${Date.now()}`),
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: { url: d.url || d.deepLink || "/", ...d },
  };
  try {
    await self.registration.showNotification(title, options);
  } catch (e) {
    // Fallback without image if image failed to load
    delete options.image;
    await self.registration.showNotification(title, options);
  }
}

messaging.onBackgroundMessage((payload) => {
  // If the server sent `webpush.notification`, Chrome/Edge already displayed
  // it natively via the browser push service (works even when tab is closed
  // and queues for offline devices). We MUST NOT show a second one here or
  // users would see duplicates. Only render when it's a data-only payload.
  if (payload && payload.notification) return;
  const d = { ...(payload?.data || {}) };
  return showFromData(d);
});

// Note: we do NOT add a raw `push` listener — the Firebase Messaging SDK
// already registers one and dispatches to onBackgroundMessage. Adding
// another would cause duplicate notifications.


self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const fcm = data.FCM_MSG || data.fcmMessage || {};
  const fcmData = fcm.data || fcm.webpush?.data || {};
  const fcmLink = fcm.fcmOptions?.link || fcm.webpush?.fcm_options?.link || fcm.webpush?.fcmOptions?.link;
  const raw = data.url || data.deepLink || fcmData.url || fcmData.deepLink || fcmLink || "/";
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
