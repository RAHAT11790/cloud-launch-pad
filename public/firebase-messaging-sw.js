// firebase-messaging-sw.js
// Background push receiver + notification click handler.
// Must live at /firebase-messaging-sw.js (site root) so Firebase Messaging finds it.

importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

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
const IMAGE_CACHE = "rs-image-cache-v2";
const inFlightImageRequests = new Map();
const IMG_HOSTS = [
  "i.ibb.co",
  "image.tmdb.org",
  "firebasestorage.googleapis.com",
  "rs-anime.firebasestorage.app",
  "animesalt.cam",
  "cdn.animesalt.cam",
  "lh3.googleusercontent.com",
  "graph.facebook.com",
];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== IMAGE_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isImageRequest(request, url) {
  if (request.method !== "GET") return false;
  if (request.destination === "image") return true;
  if (IMG_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return true;
  return /\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  let url;
  try { url = new URL(event.request.url); } catch { return; }
  if (!isImageRequest(event.request, url)) return;
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  event.respondWith((async () => {
    const cache = await caches.open(IMAGE_CACHE);
    const cacheKey = url.href;
    const cached = await cache.match(cacheKey);
    const networkFetch = (() => {
      const pending = inFlightImageRequests.get(cacheKey);
      if (pending) return pending.then((resp) => resp ? resp.clone() : null);
      const pendingFetch = fetch(event.request).then((resp) => {
        if (resp && (resp.status === 200 || resp.type === "opaque")) {
          cache.put(cacheKey, resp.clone()).catch(() => {});
        }
        return resp;
      }).catch(() => null).finally(() => {
        inFlightImageRequests.delete(cacheKey);
      });
      inFlightImageRequests.set(cacheKey, pendingFetch);
      return pendingFetch.then((resp) => resp ? resp.clone() : null);
    })();

    if (cached) {
      networkFetch.catch(() => {});
      return cached;
    }
    const fresh = await networkFetch;
    if (fresh) return fresh;
    return new Response(Uint8Array.from(atob("R0lGODlhAQABAAAAACw="), (c) => c.charCodeAt(0)), {
      headers: { "Content-Type": "image/gif" },
    });
  })());
});

// Some browsers deliver via 'push' without going through onBackgroundMessage
// when the payload is data-only. Handle both paths → richer notification
// with anime backdrop image and RS logo watermark badge.
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = n.title || d.title || "🎬 RS Anime";
  const options = {
    body: n.body || d.body || "New episode is live!",
    icon: n.icon || "/icon-192.png",
    badge: "/icon-192.png",
    image: n.image || d.image || undefined,
    tag: d.contentId || "rsanime",
    renotify: true,
    requireInteraction: false,
    data: {
      deepLink: d.deepLink || "/",
      contentId: d.contentId || "",
      contentType: d.contentType || "",
      seasonNumber: d.seasonNumber || "",
      episodeNumber: d.episodeNumber || "",
    },
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let target = data.deepLink || "/";
  // Fallback: build /watch/<id>?s=&e= if only IDs came through
  if ((!data.deepLink || data.deepLink === "/") && data.contentId) {
    const s = data.seasonNumber ? `?s=${encodeURIComponent(data.seasonNumber)}` : "";
    const e = data.episodeNumber ? `${s ? "&" : "?"}e=${encodeURIComponent(data.episodeNumber)}` : "";
    target = `/watch/${encodeURIComponent(data.contentId)}${s}${e}`;
  }
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // Prefer an existing tab on the same origin — navigate + focus
    for (const client of clientsList) {
      try {
        const u = new URL(client.url);
        if (u.origin === self.location.origin) {
          await client.navigate(target);
          return client.focus();
        }
      } catch {}
    }
    return self.clients.openWindow(target);
  })());
});
