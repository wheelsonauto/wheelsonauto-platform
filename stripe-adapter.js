const crypto = require('crypto');

function appendFormValue(form, key, value) {
  if (value === undefined || value === null || value === '') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendFormValue(form, key + '[' + index + ']', item));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([childKey, childValue]) => appendFormValue(form, key + '[' + childKey + ']', childValue));
    return;
  }
  form.append(key, typeof value === 'boolean' ? String(value) : value);
}

function formBody(payload = {}) {
  const form = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => appendFormValue(form, key, value));
  return form;
}

function stripeError(body, status) {
  const details = body && body.error || body || {};
  const error = new Error(String(details.message || 'Stripe request failed.') + (details.decline_code ? ' (' + details.decline_code + ')' : ''));
  error.statusCode = Number(status || 502);
  error.code = String(details.code || details.decline_code || 'stripe_error');
  error.declineCode = String(details.decline_code || '');
  error.type = String(details.type || '');
  error.paymentIntent = details.payment_intent || null;
  return error;
}

function stripeClient(options = {}) {
  const secretKey = String(options.secretKey || '').trim();
  const apiBase = String(options.apiBase || 'https://api.stripe.com/v1').replace(/\/+$/, '');
  const requestFetch = options.fetch || global.fetch;

  function ready() {
    if (!secretKey) {
      const error = new Error('Stripe is not connected yet. Add STRIPE_SECRET_KEY in Render.');
      error.statusCode = 503;
      throw error;
    }
  }

  async function request(method, pathname, payload = {}, requestOptions = {}) {
    ready();
    const verb = String(method || 'GET').toUpperCase();
    const form = formBody(payload);
    const url = apiBase + pathname + (verb === 'GET' && form.toString() ? '?' + form.toString() : '');
    const response = await requestFetch(url, {
      method: verb,
      headers: {
        Authorization: 'Bearer ' + secretKey,
        ...(verb === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
        ...(requestOptions.idempotencyKey ? { 'Idempotency-Key': String(requestOptions.idempotencyKey).slice(0, 255) } : {})
      },
      body: verb === 'GET' ? undefined : form.toString()
    });
    const raw = await response.text();
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { message: raw || 'Stripe returned an unreadable response.' }; }
    if (!response.ok) throw stripeError(body, response.status);
    return body;
  }

  return {
    configured: () => !!secretKey,
    createCustomer: payload => request('POST', '/customers', payload),
    createSetupCheckoutSession: (payload, idempotencyKey) => request('POST', '/checkout/sessions', payload, { idempotencyKey }),
    retrieveCheckoutSession: id => request('GET', '/checkout/sessions/' + encodeURIComponent(id), { expand: ['setup_intent', 'payment_intent', 'customer'] }),
    retrieveSetupIntent: id => request('GET', '/setup_intents/' + encodeURIComponent(id), { expand: ['payment_method'] }),
    createPaymentIntent: (payload, idempotencyKey) => request('POST', '/payment_intents', payload, { idempotencyKey }),
    retrievePaymentIntent: id => request('GET', '/payment_intents/' + encodeURIComponent(id), { expand: ['customer', 'payment_method', 'latest_charge'] }),
    retrieveCharge: id => request('GET', '/charges/' + encodeURIComponent(id), { expand: ['customer', 'payment_intent'] }),
    submitDisputeEvidence: (id, payload, idempotencyKey) => request('POST', '/disputes/' + encodeURIComponent(id), payload, { idempotencyKey })
  };
}

function verifyWebhook(rawBody, signatureHeader, secret, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)) {
  const configuredSecret = String(secret || '').trim();
  if (!configuredSecret) return { ok: false, reason: 'Stripe webhook secret is not configured.' };
  const parts = String(signatureHeader || '').split(',').map(part => part.trim()).filter(Boolean);
  const timestampPart = parts.find(part => part.startsWith('t='));
  const signatures = parts.filter(part => part.startsWith('v1=')).map(part => part.slice(3));
  const timestamp = Number(timestampPart && timestampPart.slice(2));
  if (!Number.isFinite(timestamp) || !signatures.length) return { ok: false, reason: 'Stripe-Signature is missing its timestamp or v1 signature.' };
  if (Math.abs(Number(nowSeconds) - timestamp) > Number(toleranceSeconds || 300)) return { ok: false, reason: 'Stripe webhook timestamp is outside the allowed tolerance.' };
  const expected = crypto.createHmac('sha256', configuredSecret).update(timestamp + '.' + String(rawBody || '')).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const ok = signatures.some(signature => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const actual = Buffer.from(signature, 'hex');
    return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
  });
  return { ok, reason: ok ? '' : 'Stripe webhook signature did not match.', timestamp };
}

module.exports = { formBody, stripeClient, verifyWebhook };
