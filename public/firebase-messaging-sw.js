/* RS ANIME — Firebase Messaging Service Worker
 * Handles background push notifications when the page is closed/hidden.
 * Uses the compat SDK so it works without bundlers inside the SW.
 */

importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCP5bfue5FOc0eTO4E52-0A0w3PppO3Mvw",
  authDomain: "rs-anime.firebaseapp.com",
  databaseURL: "https://rs-anime-default-rtdb.firebaseio.com",
  projectId: "rs-anime",
  storageBucket: "rs-anime.firebasestorage.app",
  messagingSenderId: "843989457516",
  appId: "1:843989457516:web:57e0577d092183eedd9649",
});

const messaging = firebase.messaging();

const DEFAULT_ICON = "/android-chrome-192x192.png";
const DEFAULT_BADGE = "/notification-badge.svg";

messaging.onBackgroundMessage((payload) => {
  try {
    const n = payload.notification || {};
    const d = payload.data || {};
    const title = n.title || d.title || "RS ANIME";
    const body = n.body || d.body || "";
    const icon = n.icon || d.icon || DEFAULT_ICON;
    const image = n.image || d.image;
    const url = d.url || (payload.fcmOptions && payload.fcmOptions.link) || "/";

    self.registration.showNotification(title, {
      body,
      icon,
      image,
      badge: DEFAULT_BADGE,
      data: { url, ...d },
      tag: d.key || d.contentId || undefined,
      renotify: !!(d.key || d.contentId),
    });
  } catch (err) {
    console.warn("[SW] background message error:", err);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  const url = data.url || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        try {
          if ("focus" in client) {
            await client.focus();
            if ("navigate" in client && url) {
              try { await client.navigate(url); } catch (_) {}
            }
            return;
          }
        } catch (_) {}
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
