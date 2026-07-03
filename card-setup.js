(function () {
  var form = document.getElementById('cardSetupForm');
  var message = document.getElementById('setupMessage');
  var config = window.__CARD_SETUP__ || {};
  function show(text, bad) {
    if (!message) return;
    message.style.display = 'block';
    message.className = bad ? 'notice bad' : 'notice';
    message.textContent = text;
  }
  function clean(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').replace(/\s+/g, '') : '';
  }
  function val(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }
  function brandFromNumber(number) {
    if (/^4/.test(number)) return 'VISA';
    if (/^5[1-5]/.test(number) || /^2[2-7]/.test(number)) return 'MASTERCARD';
    if (/^3[47]/.test(number)) return 'AMEX';
    if (/^6(?:011|5)/.test(number)) return 'DISCOVER';
    return 'UNKNOWN';
  }
  async function jsonFetch(url, options) {
    var response = await fetch(url, options);
    var text = await response.text();
    var body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (err) { body = { raw: text }; }
    if (!response.ok) throw new Error(body.message || body.error || body.raw || 'Request failed');
    return body;
  }
  if (!form) return;
  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      if (!config.publicKey || !config.tokenUrl) throw new Error('Clover card setup is missing the public key.');
      if (!document.getElementById('consent').checked) throw new Error('Please approve the card-on-file authorization before saving.');
      var number = clean('cardNumber');
      var expMonth = clean('expMonth').padStart(2, '0');
      var expYear = clean('expYear');
      if (expYear.length === 2) expYear = '20' + expYear;
      var cvv = clean('cvv');
      if (number.length < 12 || !expMonth || expYear.length !== 4 || cvv.length < 3) throw new Error('Please check the card number, expiration, and CVV.');
      show('Sending card securely to Clover...');
      var token = await jsonFetch(config.tokenUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          apikey: config.publicKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          card: {
            number: number,
            exp_month: expMonth,
            exp_year: expYear,
            cvv: cvv,
            first6: number.slice(0, 6),
            last4: number.slice(-4),
            brand: brandFromNumber(number),
            address_zip: clean('zip') || undefined
          }
        })
      });
      if (!token.id) throw new Error('Clover did not return a card token.');
      show('Card token created. Saving card-on-file...');
      var saved = await jsonFetch(config.submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          token: token.id,
          brand: token.card && token.card.brand || brandFromNumber(number),
          last4: token.card && token.card.last4 || number.slice(-4),
          cardName: val('cardName')
        })
      });
      form.style.display = 'none';
      show(saved.cloverSubscriptionId ? 'Card saved and recurring subscription created. You can now test manual charge from WheelsonAuto.' : 'Card saved. You can now test manual charge from WheelsonAuto.');
    } catch (err) {
      show(String(err && err.message || err), true);
      if (button) button.disabled = false;
    }
  });
})();
