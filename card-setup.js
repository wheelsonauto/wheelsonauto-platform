(function () {
  var form = document.getElementById('cardSetupForm');
  var message = document.getElementById('setupMessage');
  var config = window.__CARD_SETUP__ || {};
  var clover = null;
  var cardFieldsReady = false;

  function show(text, bad) {
    if (!message) return;
    message.style.display = 'block';
    message.className = bad ? 'notice bad' : 'notice';
    message.textContent = text;
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function setButton(disabled, text) {
    var button = form && form.querySelector('button[type="submit"]');
    if (!button) return;
    button.disabled = !!disabled;
    if (text) button.textContent = text;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.Clover) return resolve();
      var existing = Array.prototype.slice.call(document.scripts).find(function (script) { return script.src === src; });
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      var script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function mountElement(elements, type, selector) {
    var mountedError = null;
    var styles = {
      body: {
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: '16px',
        color: '#15191f'
      },
      input: {
        fontSize: '16px',
        color: '#15191f'
      }
    };
    try {
      var element = elements.create(type, styles);
      element.mount(selector);
      return element;
    } catch (err) {
      mountedError = err;
    }
    try {
      var fallback = elements.create(type);
      fallback.mount(selector);
      return fallback;
    } catch (err2) {
      throw mountedError || err2;
    }
  }

  function normalizeToken(result) {
    if (typeof result === 'string') return result;
    if (!result || typeof result !== 'object') return '';
    if (typeof result.token === 'string') return result.token;
    if (result.token && typeof result.token.id === 'string') return result.token.id;
    if (typeof result.id === 'string') return result.id;
    if (typeof result.source === 'string') return result.source;
    return '';
  }

  function normalizeErrors(result) {
    if (!result || !result.errors) return '';
    if (typeof result.errors === 'string') return result.errors;
    if (Array.isArray(result.errors)) return result.errors.map(function (item) {
      return item && (item.message || item.error || item) || '';
    }).filter(Boolean).join(' ');
    return Object.keys(result.errors).map(function (key) {
      var value = result.errors[key];
      return value && (value.message || value.error || value) || key;
    }).filter(Boolean).join(' ');
  }

  async function jsonFetch(url, options) {
    var response = await fetch(url, options);
    var text = await response.text();
    var body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (err) { body = { raw: text }; }
    if (!response.ok) throw new Error(body.message || body.error || body.raw || 'Request failed');
    return body;
  }

  async function setupCloverFields() {
    if (!form) return;
    setButton(true, 'Loading secure card fields...');
    try {
      if (!config.publicKey || !config.submitUrl) throw new Error('Clover card setup is missing required keys.');
      await loadScript(config.sdkUrl || 'https://checkout.clover.com/sdk.js');
      if (!window.Clover) throw new Error('Clover secure card fields did not load.');
      try {
        clover = new window.Clover(config.publicKey, { merchantId: config.merchantId });
      } catch (err) {
        clover = new window.Clover(config.publicKey);
      }
      var elements = clover.elements();
      mountElement(elements, 'CARD_NUMBER', '#cardNumber');
      mountElement(elements, 'CARD_DATE', '#cardDate');
      mountElement(elements, 'CARD_CVV', '#cardCvv');
      mountElement(elements, 'CARD_POSTAL_CODE', '#cardZip');
      cardFieldsReady = true;
      setButton(false, 'Save card with Clover');
      show('Secure Clover card fields are ready.');
    } catch (err) {
      cardFieldsReady = false;
      setButton(true, 'Clover setup unavailable');
      show('Clover secure card fields could not load. Please refresh once, or use a normal Chrome/Safari tab if this in-app browser blocks Clover.', true);
    }
  }

  if (!form) return;
  setupCloverFields();

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    setButton(true, 'Saving...');
    try {
      if (!cardFieldsReady || !clover) throw new Error('Clover secure card fields are not ready yet.');
      if (!document.getElementById('consent').checked) throw new Error('Please approve the card-on-file authorization before saving.');
      show('Sending card securely to Clover...');
      var result = await clover.createToken();
      var errors = normalizeErrors(result);
      if (errors) throw new Error(errors);
      var token = normalizeToken(result);
      if (!token) throw new Error('Clover did not return a card token.');
      show('Card token created. Saving card-on-file...');
      var saved = await jsonFetch(config.submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          token: token,
          cardName: val('cardName')
        })
      });
      form.style.display = 'none';
      show(saved.cloverSubscriptionId ? 'Card saved and recurring subscription created. You can now test manual charge from WheelsonAuto.' : 'Card saved. You can now test manual charge from WheelsonAuto.');
      if (saved.redirectUrl || config.returnUrl) {
        window.setTimeout(function () { window.location.href = saved.redirectUrl || config.returnUrl; }, 650);
      }
    } catch (err) {
      show(String(err && err.message || err), true);
      setButton(false, 'Save card with Clover');
    }
  });
})();
