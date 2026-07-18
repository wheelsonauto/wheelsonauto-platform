const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

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
    host: '127.0.0.1:4191',
    'x-forwarded-host': '127.0.0.1:4191',
    'x-forwarded-proto': 'http',
    'user-agent': 'WheelsonAuto autopay restart test',
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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(Date.now() + offset * 24 * 60 * 60 * 1000));
  const value = type => (parts.find(part => part.type === type) || {}).value;
  return [value('year'), value('month'), value('day')].join('-');
}

async function readSaved(dataDir) {
  return JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
}

function loadServer() {
  delete require.cache[require.resolve('../server.js')];
  return require('../server.js').server;
}

async function ownerCookie(server) {
  const login = await request(server, 'POST', '/login', { form: { pin: '7319' } });
  const cookie = String(login.cookie).split(';')[0];
  assert(login.status === 302 && cookie.includes('woa_session='), 'The restart test owner login must create a signed session.');
  return cookie;
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-autopay-restart-'));
  const originalFetch = global.fetch;
  const chargeRequests = [];
  let providerMode = 'decline';

  process.env.TZ = 'America/New_York';
  process.env.DATA_DIR = dataDir;
  process.env.WOA_ADMIN_PIN = '7319';
  process.env.WOA_SESSION_SECRET = 'autopay-restart-session-secret';
  process.env.WOA_PAYMENT_PROVIDER = 'clover';
  process.env.CLOVER_MERCHANT_ID = 'merchant_restart_test';
  process.env.CLOVER_ECOMMERCE_PRIVATE_KEY = 'clover_restart_private_test';
  process.env.CLOVER_CHARGE_BASE = 'https://clover.restart.test';
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.WOA_EMAIL_ENABLED = '0';
  process.env.WOA_MESSAGING_ENABLED = '0';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4191';

  global.fetch = async (url, options = {}) => {
    if (new URL(String(url)).pathname === '/v1/charges') {
      chargeRequests.push({
        idempotencyKey: String(options.headers && (options.headers['idempotency-key'] || options.headers['Idempotency-Key']) || ''),
        body: JSON.parse(String(options.body || '{}'))
      });
      if (providerMode === 'decline') {
        return {
          ok: false,
          status: 402,
          async text() { return JSON.stringify({ type: 'card_error', code: 'card_declined', message: 'Restart test decline' }); }
        };
      }
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ id: 'charge_restart_retry_success', status: 'succeeded', paid: true, captured: true }); }
      };
    }
    return { ok: false, status: 500, async text() { return JSON.stringify({ message: 'Unexpected restart test request.' }); } };
  };

  const today = localDateKey();
  const initial = {
    business: { name: 'WheelsonAuto' },
    vehicles: [{ id: 'veh-restart-1', year: '2019', make: 'Mitsubishi', model: 'Mirage', vin: 'ML32A3HJ9KH000002', plate: 'WOA-R01', status: 'Rented', currentCustomer: 'Restart Customer', organizationId: 'org-wheelsonauto' }],
    onlineVehicles: [],
    customers: [{ id: 'customer-restart-1', name: 'Restart Customer', phone: '8565550201', email: 'restart@example.com', vehicleId: 'veh-restart-1', organizationId: 'org-wheelsonauto' }],
    recurringPayments: [{
      id: 'rec-restart-1',
      customer: 'Restart Customer',
      phone: '8565550201',
      email: 'restart@example.com',
      vehicle: '2019 Mitsubishi Mirage',
      vehicleId: 'veh-restart-1',
      vin: 'ML32A3HJ9KH000002',
      licensePlate: 'WOA-R01',
      amount: 229,
      frequency: 'Weekly',
      nextRun: today,
      chargeTime: '00:00',
      status: 'Active',
      tone: 'good',
      autoChargeEnabled: true,
      autopayManagedBy: 'WheelsonAuto',
      paymentProvider: 'clover',
      provider: 'Clover',
      cloverCustomerId: 'clover_restart_customer_1',
      cardSavedAt: new Date().toISOString(),
      paymentSetup: 'Card saved through WheelsonAuto',
      organizationId: 'org-wheelsonauto'
    }, {
      id: 'rec-reschedule-1',
      customer: 'Reschedule Customer',
      amount: 199,
      frequency: 'Weekly',
      nextRun: localDateKey(7),
      chargeTime: '18:00',
      status: '2x failed - contact customer',
      tone: 'bad',
      retryCount: 2,
      failedAttempts: 2,
      autoChargeEnabled: true,
      autopayManagedBy: 'WheelsonAuto',
      paymentProvider: 'clover',
      cloverCustomerId: 'clover_reschedule_customer_1',
      cardSavedAt: new Date().toISOString(),
      organizationId: 'org-wheelsonauto'
    }, {
      id: 'rec-pending-edit-1',
      customer: 'Pending Confirmation Customer',
      amount: 188,
      frequency: 'Weekly',
      nextRun: localDateKey(7),
      chargeTime: '18:00',
      status: 'Stripe confirmation pending',
      autoChargeEnabled: true,
      paymentProvider: 'stripe',
      stripeCustomerId: 'cus_pending_edit',
      stripePaymentMethodId: 'pm_pending_edit',
      stripeChargeAttempt: {
        status: 'confirmation_pending',
        idempotencyKey: 'woa-pending-edit',
        scheduledDueDate: localDateKey(7),
        amountCents: 18800
      },
      organizationId: 'org-wheelsonauto'
    }],
    payments: [], paymentRequests: [], refundRequests: [], cardSetupRequests: [], applications: [], websiteLeads: [], contracts: [], maintenance: [], claims: [], messages: [], tasks: [], documents: [], eSignatures: [], onboardingSessions: [], pickupAppointments: [], contractTemplates: [], customerAccounts: [], staffAccounts: [], dailyCloseouts: [], auditLogs: [], apiProviders: [], verificationCases: [],
    organizations: [{ id: 'org-wheelsonauto', name: 'WheelsonAuto', status: 'Active' }],
    integrations: { clover: {}, stripe: {}, messaging: {} }
  };
  await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(initial, null, 2));

  try {
    let server = loadServer();
    let cookie = await ownerCookie(server);

    const firstRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie, json: {} });
    assert(firstRun.status === 207 && firstRun.json.failed === 1, 'The first known Clover decline must be recorded as one failed attempt.');
    assert(chargeRequests.length === 1, 'The first autopay run must submit one Clover request.');
    const firstKey = chargeRequests[0].idempotencyKey;
    assert(firstKey === 'woa-auto-rec-restart-1-' + today + '-22900', 'Attempt one must retain the original production idempotency key across deploys and restarts.');

    let saved = await readSaved(dataDir);
    let recurring = saved.recurringPayments.find(row => row.id === 'rec-restart-1');
    assert(recurring && recurring.retryCount === 1 && /1x failed/i.test(recurring.status), 'The first decline must persist retry count one.');
    assert(recurring.cloverChargeAttempt && recurring.cloverChargeAttempt.idempotencyKey === firstKey, 'The failed Clover attempt must keep its exact provider idempotency key.');
    assert(saved.payments.some(payment => payment.recurringPaymentId === 'rec-restart-1' && payment.cloverIdempotencyKey === firstKey), 'The failed transaction history must retain the Clover idempotency key.');

    server = loadServer();
    cookie = await ownerCookie(server);
    const immediateRestartRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie, json: {} });
    assert(immediateRestartRun.status === 200 && immediateRestartRun.json.charged === 0 && immediateRestartRun.json.failed === 0, 'A server restart must preserve the one-hour retry delay.');
    assert(chargeRequests.length === 1, 'Restarting before one hour must not contact Clover again.');

    const blockedPendingEdit = await request(server, 'POST', '/api/recurring-payments/update', {
      cookie,
      json: {
        recurringPaymentId: 'rec-pending-edit-1',
        amount: 177,
        frequency: 'Weekly',
        nextRun: localDateKey(8),
        chargeTime: '18:00',
        status: 'Active'
      }
    });
    assert(blockedPendingEdit.status === 409 && blockedPendingEdit.json.confirmationPending === true, 'An unresolved provider charge must block amount/date edits until reconciliation.');

    const rescheduled = await request(server, 'POST', '/api/recurring-payments/update', {
      cookie,
      json: {
        recurringPaymentId: 'rec-reschedule-1',
        amount: 199,
        frequency: 'Weekly',
        nextRun: localDateKey(8),
        chargeTime: '18:00',
        status: '2x failed - contact customer',
        autopayManagedBy: 'WheelsonAuto'
      }
    });
    assert(rescheduled.status === 200 && rescheduled.json.retryReset === true && rescheduled.json.status === 'Active', 'Moving a failed customer to a new billing anchor must reset only the new period to active attempt zero.');
    saved = await readSaved(dataDir);
    const rescheduledRow = saved.recurringPayments.find(row => row.id === 'rec-reschedule-1');
    assert(rescheduledRow.retryCount === 0 && rescheduledRow.failedAttempts === 0 && rescheduledRow.retryResetFromAttempts === 2, 'The rescheduled customer must retain evidence of the old failure count while starting the new period at zero.');

    recurring = saved.recurringPayments.find(row => row.id === 'rec-restart-1');
    recurring.lastAutoChargeAttemptAt = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));

    providerMode = 'success';
    server = loadServer();
    cookie = await ownerCookie(server);
    const delayedRetry = await request(server, 'POST', '/api/woa-autopay/run', { cookie, json: {} });
    assert(delayedRetry.status === 200 && delayedRetry.json.charged === 1, 'The saved failed attempt must retry after the one-hour boundary.');
    assert(chargeRequests.length === 2, 'Exactly one real provider retry must be submitted after the delay.');
    assert(chargeRequests[1].idempotencyKey === firstKey + '-attempt-2', 'The second real Clover attempt must use a new idempotency key instead of replaying the first decline.');

    saved = await readSaved(dataDir);
    recurring = saved.recurringPayments.find(row => row.id === 'rec-restart-1');
    assert(recurring.status === 'Active' && recurring.retryCount === 0 && recurring.nextRun > today, 'A successful retry must clear failure state and advance the weekly schedule once.');
    assert(recurring.cloverChargeAttempt.status === 'succeeded' && recurring.cloverChargeAttempt.attemptNumber === 2, 'The recurring customer must retain proof that attempt two succeeded.');
    assert(saved.payments.filter(payment => payment.recurringPaymentId === 'rec-restart-1' && payment.status === 'Paid').length === 1, 'The retry lifecycle must create exactly one paid transaction.');

    server = loadServer();
    cookie = await ownerCookie(server);
    const completedRestartRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie, json: {} });
    assert(completedRestartRun.status === 200 && completedRestartRun.json.charged === 0 && chargeRequests.length === 2, 'A restart after success must not charge the completed billing date again.');

    console.log('Autopay restart check passed: Clover attempt keys, one-hour delay, safe schedule edits, retry success, and completed-period restart recovery are protected.');
  } finally {
    global.fetch = originalFetch;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
