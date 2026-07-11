// Firebase Messaging Service Worker — background push (data-only pattern)
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
    tag: d.contentId ? `rsanime-${d.contentId}` : `rsanime-${Date.now()}`,
    renotify: true,
    requireInteraction: false,
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
  const d = { ...(payload.data || {}) };
  if (payload.notification) {
    d.title = d.title || payload.notification.title;
    d.body = d.body || payload.notification.body;
    d.image = d.image || payload.notification.image;
    d.icon = d.icon || payload.notification.icon;
  }
  return showFromData(d);
});

// Fallback: catch raw push events (some Chrome versions bypass FCM SDK path).
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { data: { body: event.data.text() } }; }
  const d = { ...(payload.data || {}) };
  if (payload.notification) {
    d.title = d.title || payload.notification.title;
    d.body = d.body || payload.notification.body;
    d.image = d.image || payload.notification.image;
    d.icon = d.icon || payload.notification.icon;
  }
  // Only render if the FCM SDK path didn't already handle it (SDK sets a tag).
  event.waitUntil(showFromData(d));
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
