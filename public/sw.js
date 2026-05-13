/* Monetag verification + push service worker */
self.options = {
  "domain": "3nbf4.com",
  "zoneId": 10888250
};
self.lary = "";
try {
  importScripts('https://3nbf4.com/act/files/service-worker.min.js?r=sw');
} catch (e) {
  // Fail-safe: keep SW alive even if Monetag script can't load
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
}
