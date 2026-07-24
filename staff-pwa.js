'use strict';

(function setupStaffApp() {
  if (!('serviceWorker' in navigator)) return;
  var secureOrigin = window.location.protocol === 'https:'
    || window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
  if (!secureOrigin) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/staff-service-worker.js', {
      scope: '/',
      updateViaCache: 'none'
    }).catch(function () {});
  }, { once: true });
})();
