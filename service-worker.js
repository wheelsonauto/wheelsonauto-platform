'use strict';

const SHELL_CACHE = 'wheelsonauto-customer-shell-v7';
const SHELL_ASSETS = [
  '/styles.css',
  '/customer-portal.js',
  '/manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('wheelsonauto-customer-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isPrivateRequest(url) {
  return url.pathname === '/customer'
    || url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/customer/document')
    || url.pathname.startsWith('/customer/message')
    || url.pathname.startsWith('/customer/login')
    || url.pathname.startsWith('/customer/forgot')
    || url.pathname.startsWith('/customer/logout')
    || url.pathname.startsWith('/setup-card/')
    || url.pathname.startsWith('/pay/');
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || isPrivateRequest(url)) return;
  if (!SHELL_ASSETS.includes(url.pathname)) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fresh = fetch(event.request).then(response => {
        if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(event.request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data && event.notification.data.url || '/customer', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.startsWith(self.location.origin + '/customer'));
    if (existing) return existing.navigate(target).then(() => existing.focus());
    return self.clients.openWindow(target);
  }));
});
