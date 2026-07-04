/* RS Anime image-cache service worker
 * Strategy: stale-while-revalidate for all image requests.
 * Cache survives reloads. If user clears it, SW re-fills on next view.
 * No HTML/JS/CSS is cached — only images — so app updates remain instant.
 */
const IMAGE_CACHE = 'rs-image-cache-v2';
const inFlightImageRequests = new Map();

// Hosts that serve poster/backdrop images we want to keep forever
const IMG_HOSTS = [
  'i.ibb.co',
  'image.tmdb.org',
  'firebasestorage.googleapis.com',
  'rs-anime.firebasestorage.app',
  'animesalt.cam',
  'cdn.animesalt.cam',
  'lh3.googleusercontent.com',
  'graph.facebook.com',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop any other unrelated caches from older SW versions
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== IMAGE_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isImageRequest(request, url) {
  if (request.method !== 'GET') return false;
  if (request.destination === 'image') return true;
  if (IMG_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return true;
  return /\.(png|jpe?g|webp|gif|avif|svg)(\?|$)/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  let url;
  try { url = new URL(event.request.url); } catch { return; }
  if (!isImageRequest(event.request, url)) return;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  event.respondWith((async () => {
    const cache = await caches.open(IMAGE_CACHE);
    const cacheKey = url.href;
    const cached = await cache.match(cacheKey);

    const networkFetch = (() => {
      const pending = inFlightImageRequests.get(cacheKey);
      if (pending) return pending.then((resp) => resp ? resp.clone() : null);
      const pendingFetch = fetch(event.request).then((resp) => {
        // Only cache opaque/200 image responses
        if (resp && (resp.status === 200 || resp.type === 'opaque')) {
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
      // Serve from cache instantly, refresh in background
      networkFetch.catch(() => {});
      return cached;
    }

    const fresh = await networkFetch;
    if (fresh) return fresh;
    // last-resort: 1x1 transparent gif
    return new Response(
      Uint8Array.from(atob('R0lGODlhAQABAAAAACw='), (c) => c.charCodeAt(0)),
      { headers: { 'Content-Type': 'image/gif' } }
    );
  })());
});
