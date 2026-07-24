'use strict';

const STAFF_SHELL_CACHE = 'wheelsonauto-staff-shell-v7';
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
    fetch(event.request)
      .then(response => {
        if (response.ok) caches.open(STAFF_SHELL_CACHE).then(cache => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin));
    if (existing) return existing.navigate(target).then(() => existing.focus());
    return self.clients.openWindow(target);
  }));
});
