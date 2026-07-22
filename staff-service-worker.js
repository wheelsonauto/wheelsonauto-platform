'use strict';

const STAFF_SHELL_CACHE = 'wheelsonauto-staff-shell-v1';
const STAFF_SHELL_ASSETS = [
  '/styles.css',
  '/app.js',
  '/staff-pwa.js',
  '/staff-manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STAFF_SHELL_CACHE).then(cache => cache.addAll(STAFF_SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('wheelsonauto-staff-shell-') && key !== STAFF_SHELL_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isStaffShellAsset(url) {
  return url.origin === self.location.origin && STAFF_SHELL_ASSETS.includes(url.pathname);
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!isStaffShellAsset(url)) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fresh = fetch(event.request).then(response => {
        if (response.ok) caches.open(STAFF_SHELL_CACHE).then(cache => cache.put(event.request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
