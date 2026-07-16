(function () {
  'use strict';

  function setupPortalNavigation() {
    var portal = document.querySelector('.customer-portal');
    var hub = portal && portal.querySelector('.customer-action-hub');
    if (!portal || !hub || !window.matchMedia) return;
    var mobile = window.matchMedia('(max-width: 760px)');
    var links = Array.prototype.slice.call(hub.querySelectorAll('a[href^="#portal-"]'));
    var panels = Array.prototype.slice.call(portal.querySelectorAll('.customer-panel[id^="portal-"]'));
    var groups = {
      '#portal-overview': ['portal-vehicle', 'portal-card'],
      '#portal-payments': ['portal-payments', 'portal-payment-history'],
      '#portal-card': ['portal-card'],
      '#portal-service': ['portal-service'],
      '#portal-documents': ['portal-documents'],
      '#portal-issues': ['portal-issues'],
      '#portal-messages': ['portal-messages']
    };
    function resetDesktop() {
      portal.classList.remove('customer-mobile-focused', 'customer-mobile-detail');
      panels.forEach(function (panel) { panel.classList.remove('portal-mobile-visible'); if (panel.parentNode) panel.parentNode.classList.remove('portal-mobile-has-visible'); });
      links.forEach(function (link) { link.classList.remove('active'); link.removeAttribute('aria-current'); });
    }
    function show(hash, scroll) {
      if (!mobile.matches) { resetDesktop(); return; }
      var key = groups[hash] ? hash : '#portal-overview';
      var visible = groups[key];
      portal.classList.add('customer-mobile-focused');
      portal.classList.toggle('customer-mobile-detail', key !== '#portal-overview');
      panels.forEach(function (panel) {
        var showPanel = visible.indexOf(panel.id) >= 0;
        panel.classList.toggle('portal-mobile-visible', showPanel);
        if (panel.parentNode) panel.parentNode.classList.toggle('portal-mobile-has-visible', Array.prototype.some.call(panel.parentNode.children, function (child) { return child.classList && child.classList.contains('portal-mobile-visible'); }));
      });
      links.forEach(function (link) {
        var active = link.getAttribute('href') === key;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      });
      if (window.history && window.history.replaceState) window.history.replaceState(null, '', key);
      if (scroll) hub.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    links.forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (!mobile.matches) return;
        event.preventDefault();
        show(link.getAttribute('href'), true);
      });
    });
    function applyLayout() { if (mobile.matches) show(window.location.hash, false); else resetDesktop(); }
    if (mobile.addEventListener) mobile.addEventListener('change', applyLayout); else mobile.addListener(applyLayout);
    applyLayout();
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

  setupPortalNavigation();

  var form = document.querySelector('[data-customer-document-upload]');
  if (!form) return;
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
      window.setTimeout(function () { window.location.href = '/customer#portal-documents'; }, 450);
    } catch (error) {
      show(error.message || 'The document could not be uploaded.', true);
      if (button) { button.disabled = false; button.textContent = 'Upload securely'; }
    }
  });
})();
