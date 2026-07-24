'use strict';

(function setupStaffApp() {
  var serviceWorkerReady = null;
  var notifications = [];
  var unreadCount = 0;
  var initialized = false;
  var pollTimer = null;
  var seenStorageKey = 'woa-staff-device-notification-ids';

  function secureOrigin() {
    return window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function timeLabel(value) {
    var date = new Date(value || 0);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function seenIds() {
    try { return JSON.parse(localStorage.getItem(seenStorageKey) || '[]'); } catch (error) { return []; }
  }

  function saveSeenIds(ids) {
    try { localStorage.setItem(seenStorageKey, JSON.stringify(Array.from(new Set(ids)).slice(-160))); } catch (error) {}
  }

  function notificationCenter() {
    return document.querySelector('[data-app-notification-center]');
  }

  function renderCenter() {
    var center = notificationCenter();
    if (!center) return;
    var panel = center.querySelector('[data-app-notification-panel]');
    var list = center.querySelector('[data-app-notification-list]');
    var count = center.querySelector('[data-app-notification-count]');
    var open = panel && !panel.hidden;
    if (count) {
      count.textContent = unreadCount > 99 ? '99+' : String(unreadCount || '');
      count.hidden = unreadCount < 1;
    }
    if (!list) return;
    list.innerHTML = notifications.length ? notifications.map(function (item) {
      return '<button type="button" class="app-notification-item ' + (item.read ? 'read' : 'unread') + ' ' + escapeHtml(item.tone || 'blue') + '" data-app-notification-id="' + escapeHtml(item.id) + '"><span class="app-notification-status"></span><span><strong>' + escapeHtml(item.title) + '</strong><small>' + escapeHtml(item.body) + '</small><time>' + escapeHtml(timeLabel(item.at)) + '</time></span></button>';
    }).join('') : '<div class="app-notification-empty">No app notifications right now.</div>';
    if (panel) panel.hidden = !open;
  }

  function attachCenter() {
    var topbar = document.querySelector('.admin-shell .topbar');
    if (!topbar || topbar.querySelector('[data-app-notification-center]')) return;
    var center = document.createElement('div');
    center.className = 'app-notification-center';
    center.setAttribute('data-app-notification-center', '');
    center.innerHTML = '<button type="button" class="app-notification-bell" data-app-notification-toggle aria-label="Open app notifications" aria-expanded="false"><span class="app-notification-bell-mark" aria-hidden="true"></span><span class="app-notification-bell-label">Alerts</span><b data-app-notification-count hidden></b></button><aside class="app-notification-panel" data-app-notification-panel hidden><header><div><strong>Notifications</strong><small>Messages, payments, applications, and work updates</small></div><button type="button" class="app-notification-close" data-app-notification-close aria-label="Close notifications">Close</button></header><div class="app-notification-tools"><button type="button" data-app-notification-enable>Enable device alerts</button><button type="button" data-app-notification-read-all>Mark all read</button></div><div class="app-notification-list" data-app-notification-list></div></aside>';
    topbar.appendChild(center);
    renderCenter();
  }

  async function deviceNotify(items) {
    if (!initialized || !('Notification' in window) || Notification.permission !== 'granted' || !serviceWorkerReady) return;
    var seen = seenIds();
    var seenSet = new Set(seen);
    var fresh = items.filter(function (item) { return !item.read && !seenSet.has(item.id); }).slice(0, 4);
    if (!fresh.length) return;
    var registration = await serviceWorkerReady.catch(function () { return null; });
    if (!registration) return;
    fresh.forEach(function (item) {
      registration.showNotification(item.title, {
        body: item.body,
        tag: item.id,
        renotify: false,
        icon: 'https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=192',
        badge: 'https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=192',
        data: { url: '/?appNotice=' + encodeURIComponent(item.view || 'Dashboard') + '&tab=' + encodeURIComponent(item.tab || '') }
      }).catch(function () {});
      seen.push(item.id);
    });
    saveSeenIds(seen);
  }

  async function refreshNotifications() {
    try {
      var response = await fetch('/api/app-notifications', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (response.status === 401) return;
      var result = await response.json();
      if (!response.ok || !result.ok) return;
      var previousIds = new Set(notifications.map(function (item) { return item.id; }));
      var nextNotifications = result.notifications || [];
      var fresh = initialized ? nextNotifications.filter(function (item) { return !item.read && !previousIds.has(item.id); }) : [];
      notifications = nextNotifications;
      unreadCount = Number(result.unreadCount || 0);
      attachCenter();
      renderCenter();
      if (!initialized) {
        var baseline = seenIds().concat(notifications.map(function (item) { return item.id; }));
        saveSeenIds(baseline);
        initialized = true;
      } else {
        if (fresh.length && typeof window.notify === 'function') window.notify(fresh[0].title + (fresh[0].body ? ': ' + fresh[0].body : ''));
        await deviceNotify(notifications);
      }
    } catch (error) {}
  }

  async function markRead(ids, all) {
    try {
      var response = await fetch('/api/app-notifications/read', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(all ? { all: true } : { ids: ids || [] })
      });
      var result = await response.json();
      if (response.ok && result.ok) {
        notifications = result.notifications || notifications;
        unreadCount = Number(result.unreadCount || 0);
        renderCenter();
      }
    } catch (error) {}
  }

  function openStaffTarget(item) {
    if (!item || !item.view) return;
    var viewButton = Array.prototype.find.call(document.querySelectorAll('[data-view]'), function (button) { return button.getAttribute('data-view') === item.view; });
    if (viewButton) viewButton.click();
    if (item.tab) window.setTimeout(function () {
      var tabButton = Array.prototype.find.call(document.querySelectorAll('[data-tab]'), function (button) { return button.getAttribute('data-tab') === item.tab; });
      if (tabButton) tabButton.click();
    }, 80);
  }

  document.addEventListener('click', function (event) {
    var center = notificationCenter();
    if (!center) return;
    var panel = center.querySelector('[data-app-notification-panel]');
    var toggle = event.target.closest('[data-app-notification-toggle]');
    if (toggle) {
      var opening = panel.hidden;
      panel.hidden = !opening;
      toggle.setAttribute('aria-expanded', opening ? 'true' : 'false');
      return;
    }
    if (event.target.closest('[data-app-notification-close]')) {
      panel.hidden = true;
      center.querySelector('[data-app-notification-toggle]').setAttribute('aria-expanded', 'false');
      return;
    }
    if (event.target.closest('[data-app-notification-read-all]')) { markRead([], true); return; }
    if (event.target.closest('[data-app-notification-enable]')) {
      if (!('Notification' in window)) return;
      Notification.requestPermission().then(function (permission) {
        event.target.textContent = permission === 'granted' ? 'Device alerts enabled' : 'Device alerts blocked';
      });
      return;
    }
    var itemButton = event.target.closest('[data-app-notification-id]');
    if (itemButton) {
      var item = notifications.find(function (row) { return row.id === itemButton.getAttribute('data-app-notification-id'); });
      markRead([item && item.id]);
      panel.hidden = true;
      openStaffTarget(item);
      return;
    }
    if (!center.contains(event.target)) panel.hidden = true;
  });

  function openTargetFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var target = params.get('appNotice');
    if (!target) return;
    window.setTimeout(function () { openStaffTarget({ view: target, tab: params.get('tab') || '' }); }, 250);
  }

  if ('serviceWorker' in navigator && secureOrigin()) {
    serviceWorkerReady = navigator.serviceWorker.register('/staff-service-worker.js', { scope: '/', updateViaCache: 'none' }).then(function () { return navigator.serviceWorker.ready; });
  }
  window.addEventListener('load', function () {
    attachCenter();
    refreshNotifications();
    openTargetFromUrl();
    pollTimer = window.setInterval(refreshNotifications, 5000);
  }, { once: true });
  new MutationObserver(attachCenter).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('focus', refreshNotifications);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshNotifications(); });
  window.addEventListener('pagehide', function () { if (pollTimer) window.clearInterval(pollTimer); }, { once: true });
})();
