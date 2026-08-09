// Firebase Messaging Service Worker — background/closed-app push
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDIMMW8WMG8b_lAJfEcY0tpT9JnipyL3mc",
  authDomain: "rs-anime-web.firebaseapp.com",
  projectId: "rs-anime-web",
  storageBucket: "rs-anime-web.firebasestorage.app",
  messagingSenderId: "856791666296",
  appId: "1:856791666296:web:9b769ba6d774734e0ce78d",
});

const BRAND_ICON = "https://i.ibb.co/gLc93Bc3/android-chrome-512x512.png";
const BRAND_BADGE = "/notification-badge.svg";
const messaging = firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const shownIds = new Set();

// Unified renderer used by both onBackgroundMessage and raw push events.
async function showFromData(d) {
  d = d || {};
  const id = d.notificationId || d.messageId || d.contentId || "";
  if (id) {
    if (shownIds.has(id)) return;
    shownIds.add(id);
    setTimeout(() => shownIds.delete(id), 120000);
  }
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

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch {}
    const msg = payload.notification || payload.data || payload.webpush?.notification || payload.webpush?.data || payload;
    const fcmData = payload.data || payload.webpush?.data || {};
    const hasVisibleNotification = !!(payload.notification || payload.webpush?.notification);
    // Firebase/Chrome display visible notification payloads natively. This raw
    // path is only for older/data-only sends so installed PWAs still receive a
    // user-visible notification when the tab is closed.
    if (hasVisibleNotification) return;
    await showFromData({ ...fcmData, ...msg });
  })());
});


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
