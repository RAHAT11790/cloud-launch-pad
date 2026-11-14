/* RS player: isolated decoder frame.
 * Scope is ONLY /rs-iso/ — it never touches the site's own pages.
 * Adds Document-Isolation-Policy to the decoder frame so that frame (and only
 * that frame) may use several processor cores for the built-in video decoder.
 * Nothing is cached.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode !== 'navigate') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/rs-iso/')) return;
  event.respondWith((async () => {
    const res = await fetch(req);
    const headers = new Headers(res.headers);
    headers.set('Document-Isolation-Policy', 'isolate-and-credentialless');
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  })());
});
