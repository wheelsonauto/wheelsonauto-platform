const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

class MockRequest extends Readable {
  constructor(method, url, headers, body) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers || {};
    this.socket = { remoteAddress: '127.0.0.1' };
    this.body = Buffer.from(body || '');
    this.sent = false;
  }
  _read() {
    if (this.sent) return;
    this.sent = true;
    if (this.body.length) this.push(this.body);
    this.push(null);
  }
}

class MockResponse {
  constructor(resolve) {
    this.statusCode = 200;
    this.headers = {};
    this.parts = [];
    this.resolve = resolve;
  }
  writeHead(status, headers = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
  }
  setHeader(name, value) { this.headers[name] = value; }
  end(body = '') {
    this.parts.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body || '')));
    const text = Buffer.concat(this.parts).toString('utf8');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    this.resolve({
      status: this.statusCode,
      headers: this.headers,
      text,
      json,
      cookie: this.headers['Set-Cookie'] || this.headers['set-cookie'] || ''
    });
  }
}

async function request(server, method, route, options = {}) {
  const headers = {
    host: '127.0.0.1:4188',
    'x-forwarded-host': '127.0.0.1:4188',
    'x-forwarded-proto': 'http',
    'user-agent': 'WheelsonAuto Stripe timeout reconciliation test',
    ...(options.headers || {})
  };
  let body = options.raw || '';
  if (Object.prototype.hasOwnProperty.call(options, 'json')) {
    body = JSON.stringify(options.json);
    headers['content-type'] = 'application/json';
  }
  if (options.form) {
    body = new URLSearchParams(options.form).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }
  if (options.cookie) headers.cookie = options.cookie;
  headers['content-length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = new MockRequest(method, route, headers, body);
    const res = new MockResponse(resolve);
    try { server.emit('request', req, res); } catch (error) { reject(error); }
  });
}

function localDateKey(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function stripeSignature(secret, rawBody) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex');
  return 't=' + timestamp + ',v1=' + signature;
}

function metadataFromForm(form) {
  const metadata = {};
  for (const [key, value] of form.entries()) {
    const match = /^metadata\[([^\]]+)\]$/.exec(key);
    if (match) metadata[match[1]] = value;
  }
  return metadata;
}

async function readSaved(dataDir) {
  return JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-stripe-timeout-'));
  const originalFetch = global.fetch;
  const webhookSecret = 'whsec_wheelsonauto_timeout_reconciliation';
  const stripeState = { paymentIntentPosts: 0, idempotencyKey: '', metadata: null };
  process.env.TZ = 'America/New_York';
  process.env.DATA_DIR = dataDir;
  process.env.WOA_ADMIN_PIN = '7319';
  process.env.WOA_SESSION_SECRET = 'stripe-timeout-session-secret';
  process.env.NODE_ENV = 'test';
  process.env.WOA_ALLOW_ISOLATED_PROVIDER_TESTS = '1';
  process.env.WOA_PAYMENT_PROVIDER = 'stripe';
  process.env.STRIPE_SECRET_KEY = 'sk_test_wheelsonauto_timeout';
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  process.env.STRIPE_API_BASE = 'https://api.stripe.test/v1';
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.WOA_EMAIL_ENABLED = '0';
  process.env.WOA_MESSAGING_ENABLED = '0';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4188';

  global.fetch = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (String(options.method || 'GET').toUpperCase() === 'POST' && pathname === '/v1/payment_intents') {
      stripeState.paymentIntentPosts += 1;
      stripeState.idempotencyKey = String(options.headers && options.headers['Idempotency-Key'] || '');
      stripeState.metadata = metadataFromForm(new URLSearchParams(String(options.body || '')));
      const error = new Error('The simulated provider connection timed out after Stripe accepted the request.');
      error.name = 'AbortError';
      throw error;
    }
    return { ok: false, status: 500, text: async () => JSON.stringify({ error: { message: 'Unexpected Stripe test request: ' + pathname } }) };
  };

  const today = localDateKey();
  const initial = {
    business: { name: 'WheelsonAuto' },
    vehicles: [{ id: 'veh-timeout-1', year: '2019', make: 'Mitsubishi', model: 'Mirage', vin: 'ML32A3HJ9KH000001', plate: 'WOA-T01', status: 'Rented', currentCustomer: 'Timeout Customer', organizationId: 'org-wheelsonauto' }],
    onlineVehicles: [],
    customers: [{ id: 'customer-timeout-1', name: 'Timeout Customer', phone: '8565550198', email: 'timeout@example.com', vehicleId: 'veh-timeout-1', organizationId: 'org-wheelsonauto' }],
    recurringPayments: [{
      id: 'rec-timeout-1',
      customer: 'Timeout Customer',
      phone: '8565550198',
      email: 'timeout@example.com',
      vehicle: '2019 Mitsubishi Mirage',
      vehicleId: 'veh-timeout-1',
      vin: 'ML32A3HJ9KH000001',
      licensePlate: 'WOA-T01',
      amount: 229,
      frequency: 'Weekly',
      nextRun: today,
      status: 'Active',
      autoChargeEnabled: true,
      paymentProvider: 'stripe',
      provider: 'Stripe',
      stripeCustomerId: 'cus_timeout_1',
      stripePaymentMethodId: 'pm_timeout_1',
      stripeCardSavedAt: new Date().toISOString(),
      organizationId: 'org-wheelsonauto'
    }],
    payments: [], paymentRequests: [], refundRequests: [], cardSetupRequests: [], applications: [], websiteLeads: [], contracts: [], maintenance: [], claims: [], messages: [], tasks: [], documents: [], eSignatures: [], onboardingSessions: [], pickupAppointments: [], contractTemplates: [], customerAccounts: [], staffAccounts: [], dailyCloseouts: [], auditLogs: [], apiProviders: [], verificationCases: [],
    organizations: [{ id: 'org-wheelsonauto', name: 'WheelsonAuto', status: 'Active' }],
    integrations: { clover: {}, stripe: {}, messaging: {} }
  };
  await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(initial, null, 2));

  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');
  try {
    const login = await request(server, 'POST', '/login', { form: { pin: '7319' } });
    const ownerCookie = String(login.cookie).split(';')[0];
    assert(login.status === 302 && ownerCookie.includes('woa_session='), 'The owner test login must create a signed staff session.');

    const timedOut = await request(server, 'POST', '/api/integrations/payments/manual-charge', {
      cookie: ownerCookie,
      json: { recurringPaymentId: 'rec-timeout-1', amount: 229, scheduledDueDate: today }
    });
    assert(timedOut.status === 202 && timedOut.json && timedOut.json.confirmationPending === true, 'A timed-out Stripe request must remain confirmation pending instead of being counted as a decline.');
    assert(stripeState.paymentIntentPosts === 1, 'The first protected charge must create exactly one Stripe PaymentIntent request.');
    assert(stripeState.idempotencyKey && stripeState.metadata, 'The protected Stripe request must carry an idempotency key and reconciliation metadata.');
    assert(stripeState.metadata.chargeIdempotencyKey === stripeState.idempotencyKey, 'Stripe metadata must retain the exact request idempotency key.');
    assert(stripeState.metadata.chargeClaimKey === 'period:rec-timeout-1:' + today, 'Stripe metadata must retain the exact durable billing-period claim.');

    let saved = await readSaved(dataDir);
    let recurring = saved.recurringPayments.find(row => row.id === 'rec-timeout-1');
    assert(recurring && recurring.stripeChargeAttempt && recurring.stripeChargeAttempt.status === 'confirmation_pending', 'The protected pending attempt must survive in platform state.');
    assert(recurring.retryCount === 0 || !recurring.retryCount, 'An ambiguous timeout must not consume the customer retry count.');

    const succeededIntent = {
      id: 'pi_timeout_late_success',
      object: 'payment_intent',
      status: 'succeeded',
      amount: 22900,
      amount_received: 22900,
      created: Math.floor(Date.now() / 1000),
      customer: 'cus_timeout_1',
      payment_method: 'pm_timeout_1',
      latest_charge: 'ch_timeout_late_success',
      metadata: stripeState.metadata
    };
    const successEvent = { id: 'evt_timeout_late_success', type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000), data: { object: succeededIntent } };
    const successRaw = JSON.stringify(successEvent);
    const lateSuccess = await request(server, 'POST', '/api/webhooks/stripe', { raw: successRaw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, successRaw) } });
    assert(lateSuccess.status === 200 && lateSuccess.json && lateSuccess.json.stripePaymentIntentResult && lateSuccess.json.stripePaymentIntentResult.idempotencyClaimSettled === true, 'A signed late success must settle the exact durable charge claim after saving payment state.');

    saved = await readSaved(dataDir);
    recurring = saved.recurringPayments.find(row => row.id === 'rec-timeout-1');
    const paid = saved.payments.filter(row => row.stripePaymentIntentId === 'pi_timeout_late_success');
    assert(paid.length === 1 && paid[0].status === 'Paid', 'The late success must create exactly one named paid transaction.');
    assert(recurring.stripeChargeAttempt.status === 'succeeded' && recurring.retryCount === 0, 'The late success must clear pending/retry state and settle the protected attempt.');
    assert(recurring.nextRun && recurring.nextRun > today, 'The signed late success must advance the weekly schedule exactly once.');
    assert(saved.documents.filter(row => row.kind === 'Receipt' && row.stripePaymentIntentId === 'pi_timeout_late_success').length === 1, 'The signed late success must create exactly one customer receipt.');

    const replay = await request(server, 'POST', '/api/webhooks/stripe', { raw: successRaw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, successRaw) } });
    assert(replay.status === 200 && replay.json && replay.json.duplicate === true, 'The exact same Stripe webhook must be acknowledged without executing twice.');

    const failedEvent = {
      id: 'evt_timeout_failure_after_success',
      type: 'payment_intent.payment_failed',
      created: Math.floor(Date.now() / 1000) + 1,
      data: { object: { ...succeededIntent, status: 'requires_payment_method', amount_received: 0, last_payment_error: { code: 'card_declined', message: 'Out-of-order simulated decline.' } } }
    };
    const failedRaw = JSON.stringify(failedEvent);
    const lateFailure = await request(server, 'POST', '/api/webhooks/stripe', { raw: failedRaw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, failedRaw) } });
    assert(lateFailure.status === 200 && lateFailure.json && lateFailure.json.stripePaymentIntentResult && lateFailure.json.stripePaymentIntentResult.ignored === true, 'An out-of-order failure must not downgrade a later recorded success.');

    const duplicateCharge = await request(server, 'POST', '/api/integrations/payments/manual-charge', {
      cookie: ownerCookie,
      json: { recurringPaymentId: 'rec-timeout-1', amount: 229, scheduledDueDate: today }
    });
    assert(duplicateCharge.status === 409 && duplicateCharge.json && duplicateCharge.json.duplicateBlocked === true, 'A second charge for the reconciled billing period must be blocked before contacting Stripe.');
    assert(stripeState.paymentIntentPosts === 1, 'Timeout reconciliation, webhook replay, and a duplicate staff action must never create a second Stripe PaymentIntent.');

    saved = await readSaved(dataDir);
    recurring = saved.recurringPayments.find(row => row.id === 'rec-timeout-1');
    assert(recurring.status === 'Active' && recurring.retryCount === 0, 'The customer must remain active and paid after the out-of-order failure is ignored.');
    assert(saved.payments.filter(row => row.stripePaymentIntentId === 'pi_timeout_late_success').length === 1, 'All reconciliation paths must retain one canonical Stripe transaction.');

    console.log('Stripe timeout reconciliation passed: a timed-out request, signed late success, webhook replay, out-of-order failure, and duplicate staff charge remain one protected payment.');
  } finally {
    global.fetch = originalFetch;
    if (server && typeof server.close === 'function') server.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
