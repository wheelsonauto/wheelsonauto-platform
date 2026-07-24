(function () {
  'use strict';

  function setupPortalNavigation() {
    var portal = document.querySelector('.customer-portal');
    var hub = portal && portal.querySelector('.customer-action-hub');
    if (!portal || !hub) return;
    var mobile = window.matchMedia('(max-width: 760px)');
    var links = Array.prototype.slice.call(hub.querySelectorAll('a[href^="#portal-"]'));
    var panels = Array.prototype.slice.call(portal.querySelectorAll('[data-portal-page][id^="portal-"]'));
    var groups = ['#portal-home', '#portal-messages', '#portal-payments', '#portal-vehicle', '#portal-settings'];
    function show(hash, scroll) {
      var key = groups.indexOf(hash) >= 0 ? hash : '#portal-home';
      portal.classList.add('customer-portal-focused');
      portal.classList.toggle('customer-portal-detail', key !== '#portal-home');
      portal.classList.toggle('customer-mobile-focused', mobile.matches);
      portal.classList.toggle('customer-mobile-detail', mobile.matches && key !== '#portal-home');
      panels.forEach(function (panel) {
        var showPanel = '#' + panel.id === key;
        panel.classList.toggle('portal-visible', showPanel);
        panel.hidden = !showPanel;
      });
      links.forEach(function (link) {
        var active = link.getAttribute('href') === key;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      });
      if (window.history && window.history.replaceState) window.history.replaceState(null, '', key);
      if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    links.forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        show(link.getAttribute('href'), true);
      });
    });
    function applyLayout() { show(window.location.hash, false); }
    if (mobile.addEventListener) mobile.addEventListener('change', applyLayout); else mobile.addListener(applyLayout);
    window.addEventListener('hashchange', applyLayout);
    applyLayout();
  }

  function setupPaymentDateFee() {
    var form = document.querySelector('[data-payment-date-change]');
    if (!form) return;
    var input = form.querySelector('input[name="targetDate"]');
    var output = form.querySelector('[data-payment-date-fee]');
    var button = form.querySelector('button[type="submit"]');
    var weekly = Number(form.getAttribute('data-weekly-amount') || 0);
    var original = form.getAttribute('data-original-date') || '';
    function dateAtNoon(value) { return value ? new Date(value + 'T12:00:00') : null; }
    function render() {
      var target = input && input.value;
      var start = dateAtNoon(original);
      var end = dateAtNoon(target);
      var days = start && end ? Math.round((end.getTime() - start.getTime()) / 86400000) : 0;
      var valid = weekly > 0 && days >= 1 && days <= 7;
      if (button) button.disabled = !valid;
      if (!output) return;
      if (!target) output.textContent = 'Choose a date to see the exact fee.';
      else if (!valid) output.textContent = 'Choose a date one to seven days after the current due date.';
      else output.textContent = days + ' day' + (days === 1 ? '' : 's') + ' x $' + (weekly / 7).toFixed(2) + ' = $' + (weekly / 7 * days).toFixed(2);
      output.classList.toggle('ready', valid);
    }
    if (input) input.addEventListener('change', render);
    render();
  }

  function filePayload(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('Choose a JPG, PNG, or PDF document.'));
      if (file.size > 5 * 1024 * 1024) return reject(new Error('The file must be 5 MB or smaller.'));
      if (['image/jpeg', 'image/png', 'application/pdf'].indexOf(file.type) < 0) return reject(new Error('The file must be JPG, PNG, or PDF.'));
      var reader = new FileReader();
      reader.onload = function () { resolve({ name: file.name, type: file.type, size: file.size, dataUrl: String(reader.result || '') }); };
      reader.onerror = function () { reject(new Error('The selected document could not be read.')); };
      reader.readAsDataURL(file);
    });
  }

  function messageIsCustomer(message) {
    return /inbound|customer action/i.test(String(message && message.direction || ''));
  }

  function messageTime(message) {
    var value = message && (message.createdAt || message.date) || '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function messageFingerprint(messages) {
    return (messages || []).map(function (message) {
      return [message.id, message.createdAt, message.status, message.body].join('|');
    }).join('::');
  }

  function renderConversation(list, messages, forceBottom) {
    if (!list) return;
    var nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    var ordered = (messages || []).slice().sort(function (a, b) {
      return new Date(a.createdAt || a.date || 0).getTime() - new Date(b.createdAt || b.date || 0).getTime();
    });
    list.textContent = '';
    if (!ordered.length) {
      var empty = document.createElement('div');
      empty.className = 'customer-chat-empty';
      var title = document.createElement('strong');
      title.textContent = 'Start a conversation';
      var copy = document.createElement('span');
      copy.textContent = 'Messages stay connected to your WheelsonAuto account and vehicle.';
      empty.appendChild(title);
      empty.appendChild(copy);
      list.appendChild(empty);
    } else {
      ordered.forEach(function (message) {
        var customer = messageIsCustomer(message);
        var bubble = document.createElement('div');
        bubble.className = 'customer-chat-bubble ' + (customer ? 'customer' : 'staff');
        bubble.dataset.messageId = message.id || '';
        var sender = document.createElement('span');
        sender.textContent = customer ? 'You' : (/star/i.test([message.channel, message.source, message.template].filter(Boolean).join(' ')) ? 'Star / WheelsonAuto' : 'WheelsonAuto');
        var body = document.createElement('p');
        body.textContent = message.body || message.subject || message.template || 'Message';
        var time = document.createElement('small');
        time.textContent = [messageTime(message), message.status || ''].filter(Boolean).join(' | ');
        bubble.appendChild(sender);
        bubble.appendChild(body);
        bubble.appendChild(time);
        list.appendChild(bubble);
      });
    }
    if (forceBottom || nearBottom) list.scrollTop = list.scrollHeight;
  }

  function setupConversation() {
    var form = document.querySelector('[data-customer-message-form]');
    var list = document.querySelector('[data-customer-message-list]');
    var status = form && form.querySelector('[data-customer-message-status]');
    var button = form && form.querySelector('button[type="submit"]');
    var textarea = form && form.querySelector('textarea[name="body"]');
    var connection = document.querySelector('[data-customer-connection-status]');
    var lastFingerprint = '';
    var pollTimer = null;
    if (!form || !list || !textarea) return;

    function setStatus(text, error) {
      if (!status) return;
      status.textContent = text;
      status.classList.toggle('err', !!error);
    }
    function updateConnection() {
      if (!connection) return;
      connection.textContent = navigator.onLine ? 'Online' : 'Offline';
      connection.classList.toggle('offline', !navigator.onLine);
    }
    async function refreshConversation(forceBottom) {
      if (document.hidden || window.location.hash !== '#portal-messages') return;
      try {
        var response = await fetch('/api/customer/portal-state', { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (response.status === 401) {
          window.location.href = '/customer/login';
          return;
        }
        var result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'Conversation could not refresh.');
        var messages = result.portal && result.portal.messages || [];
        var nextFingerprint = messageFingerprint(messages);
        if (nextFingerprint !== lastFingerprint) {
          renderConversation(list, messages, !!forceBottom);
          lastFingerprint = nextFingerprint;
          var count = document.querySelector('.customer-action-hub a[href="#portal-messages"] b');
          if (count) count.textContent = String(messages.length);
        }
        updateConnection();
      } catch (error) {
        updateConnection();
        if (!navigator.onLine) setStatus('Offline. Your message has not been sent.', true);
      }
    }
    async function submitMessage(event) {
      event.preventDefault();
      var body = textarea.value.trim();
      if (!body || button.disabled) return;
      button.disabled = true;
      setStatus('Sending securely...');
      try {
        var response = await fetch('/customer/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ body: body })
        });
        var result = await response.json().catch(function () { return {}; });
        if (response.status === 401) {
          window.location.href = '/customer/login';
          return;
        }
        if (!response.ok || !result.ok) throw new Error(result.error || 'Message could not be sent.');
        textarea.value = '';
        var messages = result.portal && result.portal.messages || [];
        lastFingerprint = messageFingerprint(messages);
        renderConversation(list, messages, true);
        setStatus('Delivered to WheelsonAuto.');
      } catch (error) {
        setStatus(error.message || 'Message could not be sent.', true);
      } finally {
        button.disabled = false;
        textarea.focus();
      }
    }

    form.addEventListener('submit', submitMessage);
    textarea.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitMessage(event);
    });
    window.addEventListener('online', function () { updateConnection(); refreshConversation(false); });
    window.addEventListener('offline', updateConnection);
    window.addEventListener('hashchange', function () { refreshConversation(true); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshConversation(false); });
    updateConnection();
    list.scrollTop = list.scrollHeight;
    pollTimer = window.setInterval(function () { refreshConversation(false); }, 8000);
    window.addEventListener('pagehide', function () { if (pollTimer) window.clearInterval(pollTimer); }, { once: true });
    refreshConversation(true);
  }

  function setupInstallableApp() {
    var installButton = document.querySelector('[data-install-customer-app]');
    var deferredPrompt = null;
    var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/customer', updateViaCache: 'none' }).catch(function () {});
    }
    if (!installButton || standalone) return;
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredPrompt = event;
      installButton.hidden = false;
    });
    if (ios) {
      installButton.hidden = false;
      installButton.textContent = 'Add to Home';
    }
    installButton.addEventListener('click', async function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        installButton.hidden = true;
        return;
      }
      if (ios) window.alert('On iPhone, tap Share, then Add to Home Screen.');
    });
    window.addEventListener('appinstalled', function () { installButton.hidden = true; });
  }

  function setupCustomerNotifications() {
    var host = document.querySelector('.customer-account-actions') || document.querySelector('.customer-hero');
    if (!host) return;
    var rows = [];
    var unread = 0;
    var initialized = false;
    var storageKey = 'woa-customer-device-notification-ids';
    var center = document.createElement('div');
    center.className = 'app-notification-center customer-notification-center';
    center.innerHTML = '<button type="button" class="app-notification-bell" data-customer-notification-toggle aria-label="Open app notifications" aria-expanded="false"><span class="app-notification-bell-mark" aria-hidden="true"></span><span class="app-notification-bell-label">Alerts</span><b data-customer-notification-count hidden></b></button><aside class="app-notification-panel" data-customer-notification-panel hidden><header><div><strong>Notifications</strong><small>Messages, payments, application, and service updates</small></div><button type="button" class="app-notification-close" data-customer-notification-close>Close</button></header><div class="app-notification-tools"><button type="button" data-customer-notification-enable>Enable device alerts</button><button type="button" data-customer-notification-read-all>Mark all read</button></div><div class="app-notification-list" data-customer-notification-list></div></aside>';
    host.prepend(center);

    function html(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]; });
    }
    function time(value) {
      var date = new Date(value || 0);
      return isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    function seen() {
      try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch (error) { return []; }
    }
    function saveSeen(ids) {
      try { localStorage.setItem(storageKey, JSON.stringify(Array.from(new Set(ids)).slice(-160))); } catch (error) {}
    }
    function render() {
      var count = center.querySelector('[data-customer-notification-count]');
      count.textContent = unread > 99 ? '99+' : String(unread || '');
      count.hidden = unread < 1;
      center.querySelector('[data-customer-notification-list]').innerHTML = rows.length ? rows.map(function (item) {
        return '<button type="button" class="app-notification-item ' + (item.read ? 'read' : 'unread') + ' ' + html(item.tone || 'blue') + '" data-customer-notification-id="' + html(item.id) + '"><span class="app-notification-status"></span><span><strong>' + html(item.title) + '</strong><small>' + html(item.body) + '</small><time>' + html(time(item.at)) + '</time></span></button>';
      }).join('') : '<div class="app-notification-empty">No app notifications right now.</div>';
    }
    async function showDeviceAlerts() {
      if (!initialized || !('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
      var known = seen();
      var knownSet = new Set(known);
      var fresh = rows.filter(function (item) { return !item.read && !knownSet.has(item.id); }).slice(0, 4);
      if (!fresh.length) return;
      var registration = await navigator.serviceWorker.ready.catch(function () { return null; });
      if (!registration) return;
      fresh.forEach(function (item) {
        registration.showNotification(item.title, { body: item.body, tag: item.id, renotify: false, icon: 'https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=192', badge: 'https://www.wheelsonauto.com/cdn/shop/files/wheelsLOGO.png?v=1772299505&width=192', data: { url: item.url || '/customer' } }).catch(function () {});
        known.push(item.id);
      });
      saveSeen(known);
    }
    async function refresh() {
      try {
        var response = await fetch('/api/customer/notifications', { credentials: 'same-origin', headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (response.status === 401) return;
        var result = await response.json();
        if (!response.ok || !result.ok) return;
        rows = result.notifications || [];
        unread = Number(result.unreadCount || 0);
        render();
        if (!initialized) {
          saveSeen(seen().concat(rows.map(function (item) { return item.id; })));
          initialized = true;
        } else await showDeviceAlerts();
      } catch (error) {}
    }
    async function mark(ids, all) {
      try {
        var response = await fetch('/api/customer/notifications/read', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(all ? { all: true } : { ids: ids || [] }) });
        var result = await response.json();
        if (response.ok && result.ok) { rows = result.notifications || rows; unread = Number(result.unreadCount || 0); render(); }
      } catch (error) {}
    }
    center.addEventListener('click', function (event) {
      var panel = center.querySelector('[data-customer-notification-panel]');
      if (event.target.closest('[data-customer-notification-toggle]')) {
        panel.hidden = !panel.hidden;
        center.querySelector('[data-customer-notification-toggle]').setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
        return;
      }
      if (event.target.closest('[data-customer-notification-close]')) { panel.hidden = true; return; }
      if (event.target.closest('[data-customer-notification-read-all]')) { mark([], true); return; }
      if (event.target.closest('[data-customer-notification-enable]')) {
        if (!('Notification' in window)) return;
        Notification.requestPermission().then(function (permission) { event.target.textContent = permission === 'granted' ? 'Device alerts enabled' : 'Device alerts blocked'; });
        return;
      }
      var itemButton = event.target.closest('[data-customer-notification-id]');
      if (!itemButton) return;
      var item = rows.find(function (row) { return row.id === itemButton.getAttribute('data-customer-notification-id'); });
      if (!item) return;
      mark([item.id], false);
      panel.hidden = true;
      var target = new URL(item.url || '/customer', window.location.origin);
      if (target.hash) window.location.hash = target.hash;
    });
    document.addEventListener('click', function (event) { var panel = center.querySelector('[data-customer-notification-panel]'); if (!center.contains(event.target)) panel.hidden = true; });
    refresh();
    var timer = window.setInterval(refresh, 18000);
    window.addEventListener('pagehide', function () { window.clearInterval(timer); }, { once: true });
  }

  setupPortalNavigation();
  setupPaymentDateFee();
  setupConversation();
  setupInstallableApp();
  setupCustomerNotifications();

  var form = document.querySelector('[data-customer-document-upload]');
  if (form) {
    var status = form.querySelector('[data-document-upload-status]');
    var button = form.querySelector('button[type="submit"]');
    function show(text, error) {
      if (!status) return;
      status.textContent = text;
      status.classList.toggle('err', !!error);
    }
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (button && button.disabled) return;
      var input = form.elements.documentFile;
      try {
        if (button) { button.disabled = true; button.textContent = 'Uploading...'; }
        show('Encrypting the connection and uploading your document...');
        var values = new FormData(form);
        var payload = {
          type: values.get('type'),
          provider: values.get('provider'),
          reference: values.get('reference'),
          expires: values.get('expires'),
          notes: values.get('notes'),
          file: await filePayload(input && input.files && input.files[0])
        };
        var response = await fetch('/customer/document-update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(payload)
        });
        var result = await response.json().catch(function () { return {}; });
        if (!response.ok || result.ok === false) throw new Error(result.error || 'The document could not be uploaded.');
        show(result.message || 'Document uploaded securely.');
        window.setTimeout(function () { window.location.href = '/customer#portal-settings'; }, 450);
      } catch (error) {
        show(error.message || 'The document could not be uploaded.', true);
        if (button) { button.disabled = false; button.textContent = 'Upload securely'; }
      }
    });
  }
})();
