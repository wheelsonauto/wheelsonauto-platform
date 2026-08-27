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

function addUtcMonths(dateKey, months) {
  const source = new Date(dateKey + 'T12:00:00Z');
  const preferredDay = source.getUTCDate();
  const month = source.getUTCMonth() + months;
  const year = source.getUTCFullYear() + Math.floor(month / 12);
  const normalizedMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, normalizedMonth + 1, 0, 12)).getUTCDate();
  return new Date(Date.UTC(year, normalizedMonth, Math.min(preferredDay, lastDay), 12)).toISOString().slice(0, 10);
}

async function ownerCookie(server) {
  const login = await request(server, 'POST', '/login', { form: { username: 'owner', password: 'AutopayRestartOwner123!' } });
  const cookie = String(login.cookie).split(';')[0];
  assert(login.status === 302 && cookie.includes('woa_session='), 'The restart test owner login must create a signed session.');
  return cookie;
}

async function main() {
  const serverSource = await fs.readFile(path.join(__dirname, '..', 'server.js'), 'utf8');
  const repairDataStart = serverSource.indexOf('function repairDataIds');
  const repairDataEnd = serverSource.indexOf('function nextUniqueVehicleId', repairDataStart);
  const autopayStart = serverSource.indexOf('async function runWheelsonAutoAutopay');
  const autopayEnd = serverSource.indexOf('\nasync function ', autopayStart + 1);
  const repairDataBody = serverSource.slice(repairDataStart, repairDataEnd);
  const autopayBody = serverSource.slice(autopayStart, autopayEnd > autopayStart ? autopayEnd : undefined);
  assert(!repairDataBody.includes('repairCompletedPickupAutopayStates'), 'Completed-pickup autopay recovery must not mutate PostgreSQL state during generic read-time repair.');
  assert(autopayBody.includes('repairCompletedPickupAutopayStates(data)'), 'Completed-pickup autopay recovery must run inside the transactional autopay job.');

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-autopay-restart-'));
  const originalFetch = global.fetch;
  const chargeRequests = [];
  let providerMode = 'decline';

  process.env.TZ = 'America/New_York';
  process.env.DATA_DIR = dataDir;
  process.env.WOA_ADMIN_PIN = '7319';
  process.env.WOA_ADMIN_USERNAME = 'owner';
  process.env.WOA_ADMIN_PASSWORD = 'AutopayRestartOwner123!';
  process.env.WOA_SESSION_SECRET = 'autopay-restart-session-secret';
  process.env.NODE_ENV = 'test';
  process.env.WOA_ALLOW_ISOLATED_PROVIDER_TESTS = '1';
  process.env.WOA_PAYMENT_PROVIDER = 'stripe';
  process.env.STRIPE_SECRET_KEY = 'sk_test_autopay_restart';
  process.env.STRIPE_API_BASE = 'https://stripe.restart.test/v1';
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.WOA_EMAIL_ENABLED = '0';
  process.env.WOA_MESSAGING_ENABLED = '0';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4191';

  global.fetch = async (url, options = {}) => {
    if (new URL(String(url)).pathname === '/v1/payment_intents') {
      chargeRequests.push({
        idempotencyKey: String(options.headers && (options.headers['idempotency-key'] || options.headers['Idempotency-Key']) || ''),
        body: Object.fromEntries(new URLSearchParams(String(options.body || '')))
      });
      if (providerMode === 'decline') {
        return {
          ok: false,
          status: 402,
          async text() { return JSON.stringify({ error: { type: 'card_error', code: 'card_declined', decline_code: 'card_declined', message: 'Restart test decline' } }); }
        };
      }
      const paymentIntentId = 'pi_restart_success_' + chargeRequests.length;
      return {
        ok: true,
        status: 200,
        async text() { return JSON.stringify({ id: paymentIntentId, status: 'succeeded', livemode: false, created: Math.floor(Date.now() / 1000), latest_charge: 'ch_restart_success_' + chargeRequests.length }); }
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
      paymentProvider: 'stripe',
      provider: 'Stripe',
      stripeCustomerId: 'cus_restart_customer_1',
      stripePaymentMethodId: 'pm_restart_source_1',
      stripeLivemode: false,
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
      paymentProvider: 'stripe',
      provider: 'Stripe',
      stripeCustomerId: 'cus_reschedule_customer_1',
      stripePaymentMethodId: 'pm_reschedule_source_1',
      stripeLivemode: false,
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
    const scheduler = require('../server.js');
    assert(scheduler.nextRecurringOccurrence({ frequency: 'Daily' }, today) === localDateKey(1), 'Daily autopay must advance one calendar day.');
    assert(scheduler.nextRecurringOccurrence({ frequency: 'Weekly' }, today) === localDateKey(7), 'Weekly autopay must advance seven calendar days.');
    assert(scheduler.nextRecurringOccurrence({ frequency: 'Bi-weekly' }, today) === localDateKey(14), 'Bi-weekly autopay must advance fourteen calendar days.');
    assert(scheduler.nextRecurringOccurrence({ frequency: 'Monthly' }, today) === addUtcMonths(today, 1), 'Monthly autopay must advance one calendar month without drifting at month end.');
    const rapidHourDue = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const rapidHourNext = scheduler.nextFutureRecurringRun({ frequency: 'Every hour', nextRun: rapidHourDue }, new Date(), rapidHourDue);
    assert(Date.parse(rapidHourNext) === Date.parse(rapidHourDue) + 60 * 60 * 1000, 'Hourly autopay must advance by exactly one hour after a due occurrence.');
    let cookie = await ownerCookie(server);

    const firstRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie, json: {} });
    assert(firstRun.status === 207 && firstRun.json.failed === 1, 'The first known Stripe decline must be recorded as one failed attempt.');
    assert(chargeRequests.length === 1, 'The first autopay run must submit one Stripe request.');
    const firstKey = chargeRequests[0].idempotencyKey;
    assert(firstKey === 'woa-stripe-auto-rec-restart-1-' + today + '-22900-attempt-1', 'Attempt one must retain the original production idempotency key across deploys and restarts.');

    let saved = await readSaved(dataDir);
    let recurring = saved.recurringPayments.find(row => row.id === 'rec-restart-1');
    assert(recurring && recurring.retryCount === 1 && /1x failed/i.test(recurring.status), 'The first decline must persist retry count one.');
    assert(recurring.stripeChargeAttempt && recurring.stripeChargeAttempt.idempotencyKey === firstKey, 'The failed Stripe attempt must keep its exact provider idempotency key.');
    assert(saved.payments.some(payment => payment.recurringPaymentId === 'rec-restart-1' && payment.stripeIdempotencyKey === firstKey), 'The failed transaction history must retain the Stripe idempotency key.');

    server = loadServer();
    cookie = await ownerCookie(server);
    const immediateRestartRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie, json: {} });
    assert(immediateRestartRun.status === 200 && immediateRestartRun.json.charged === 0 && immediateRestartRun.json.failed === 0, 'A server restart must preserve the one-hour retry delay.');
    assert(chargeRequests.length === 1, 'Restarting before one hour must not contact Stripe again.');

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
    assert(chargeRequests[1].idempotencyKey === 'woa-stripe-auto-rec-restart-1-' + today + '-22900-attempt-2', 'The second real Stripe attempt must use a new idempotency key instead of replaying the first decline.');

    saved = await readSaved(dataDir);
    recurring = saved.recurringPayments.find(row => row.id === 'rec-restart-1');
    assert(recurring.status === 'Active' && recurring.retryCount === 0 && recurring.nextRun > today, 'A successful retry must clear failure state and advance the weekly schedule once.');
    assert(recurring.stripeChargeAttempt.status === 'succeeded' && recurring.stripeChargeAttempt.sequence === 2, 'The recurring customer must retain proof that attempt two succeeded.');
    assert(saved.payments.filter(payment => payment.recurringPaymentId === 'rec-restart-1' && payment.status === 'Paid').length === 1, 'The retry lifecycle must create exactly one paid transaction.');

    server = loadServer();
    cookie = await ownerCookie(server);
    const completedRestartRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie, json: {} });
    assert(completedRestartRun.status === 200 && completedRestartRun.json.charged === 0 && chargeRequests.length === 2, 'A restart after success must not charge the completed billing date again.');

    saved = await readSaved(dataDir);
    const rapidDueAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    saved.recurringPayments.push({
      id: 'rec-rapid-minute-1',
      applicationId: 'app-rapid-minute-1',
      onboardingSessionId: 'onboard-rapid-minute-1',
      pickupAppointmentId: 'pickup-rapid-minute-1',
      customer: 'Rapid Minute Customer',
      amount: 1,
      customerPortalCreditBalance: 50,
      frequency: 'Every minute',
      nextRun: rapidDueAt,
      chargeTime: '',
      status: 'Active',
      tone: 'good',
      autoChargeEnabled: true,
      autopayManagedBy: 'WheelsonAuto',
      paymentProvider: 'stripe',
      provider: 'Stripe',
      stripeCustomerId: 'cus_rapid_customer_1',
      stripePaymentMethodId: 'pm_rapid_source_1',
      stripeLivemode: false,
      cardSavedAt: new Date().toISOString(),
      paymentSetup: 'Card saved through WheelsonAuto',
      organizationId: 'org-wheelsonauto'
    });
    saved.applications.push({
      id: 'app-rapid-minute-1',
      recurringPaymentId: 'rec-rapid-minute-1',
      name: 'Rapid Minute Customer',
      pricingSnapshot: { downPayment: 0 },
      organizationId: 'org-wheelsonauto'
    });
    saved.onboardingSessions.push({
      id: 'onboard-rapid-minute-1',
      applicationId: 'app-rapid-minute-1',
      recurringPaymentId: 'rec-rapid-minute-1',
      paymentProvider: 'stripe',
      organizationId: 'org-wheelsonauto'
    });
    saved.pickupAppointments.push({
      id: 'pickup-rapid-minute-1',
      applicationId: 'app-rapid-minute-1',
      onboardingSessionId: 'onboard-rapid-minute-1',
      recurringPaymentId: 'rec-rapid-minute-1',
      date: localDateKey(-7),
      actualPickupDate: localDateKey(-7),
      status: 'Picked up',
      completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      organizationId: 'org-wheelsonauto'
    });
    saved.paymentRequests.push({
      id: 'payment-request-rapid-minute-1',
      applicationId: 'app-rapid-minute-1',
      onboardingSessionId: 'onboard-rapid-minute-1',
      recurringPaymentId: 'rec-rapid-minute-1',
      paymentType: 'First weekly payment',
      paymentProvider: 'stripe',
      amount: 1,
      status: 'Paid',
      paidAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      organizationId: 'org-wheelsonauto'
    });
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));

    server = loadServer();
    cookie = await ownerCookie(server);
    const rapidRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie, json: {} });
    assert(rapidRun.status === 200 && rapidRun.json.charged === 1, 'A due every-minute schedule must charge on the next autopay worker run.');
    assert(chargeRequests.length === 3 && chargeRequests[2].idempotencyKey.includes('rec-rapid-minute-1'), 'The rapid charge must use its own protected recurring occurrence key.');
    saved = await readSaved(dataDir);
    const rapidRow = saved.recurringPayments.find(row => row.id === 'rec-rapid-minute-1');
    assert(rapidRow.status === 'Rapid test passed' && rapidRow.frequency === 'Every minute' && rapidRow.autoChargeEnabled === false, 'A successful rapid charge must preserve its test frequency and turn rapid autocharge off after one provider result.');
    assert(rapidRun.json.pickupSchedulesRecovered === 1, 'The regression fixture must exercise completed-pickup autopay recovery before the rapid charge.');
    assert(rapidRun.json.rapidSchedulesRepaired === 0, 'Completed-pickup recovery must preserve the exact rapid instant instead of rewriting it into a date-only weekly anchor.');
    assert(Date.parse(rapidRow.nextRun) > Date.parse(rapidDueAt) && rapidRow.lastAutoChargeOccurrenceKey === rapidDueAt, 'A successful rapid charge must advance beyond the processed minute and preserve the exact occurrence.');
    assert(rapidRow.customerPortalCreditBalance === 50, 'A rapid Stripe verification must not consume customer account credit instead of testing the saved card.');
    assert(rapidRow.lastAutoChargeResult === 'Paid - rapid Stripe test complete', 'A rapid success must leave an explicit provider-test result on the recurring plan.');

    server = loadServer();
    cookie = await ownerCookie(server);
    const rapidRestartRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie, json: {} });
    assert(rapidRestartRun.status === 200 && rapidRestartRun.json.charged === 0 && chargeRequests.length === 3, 'Restarting after a rapid success must not charge the same minute twice.');
    saved = await readSaved(dataDir);
    const rapidRestartRow = saved.recurringPayments.find(row => row.id === 'rec-rapid-minute-1');
    assert(rapidRestartRow.autoChargeEnabled === false && rapidRestartRow.status === 'Rapid test passed', 'Completed-pickup recovery must not reactivate a one-shot rapid test after its provider result.');

    console.log('Autopay restart check passed: Stripe attempt keys, one-hour delay, safe schedule edits, one-shot rapid provider testing, retry success, and restart recovery are protected.');
  } finally {
    global.fetch = originalFetch;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
