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
  end(body = '') {
    this.parts.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body || '')));
    const text = Buffer.concat(this.parts).toString('utf8');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    this.resolve({ status: this.statusCode, headers: this.headers, text, json, cookie: this.headers['Set-Cookie'] || '', location: this.headers.Location || '' });
  }
}

async function request(server, method, route, options = {}) {
  const headers = {
    host: '127.0.0.1:4181',
    'x-forwarded-host': '127.0.0.1:4181',
    'x-forwarded-proto': 'http',
    'x-forwarded-for': options.ip || '127.0.0.1',
    'user-agent': 'WheelsonAuto public-link security check',
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

function publicHeaders(response) {
  const cache = String(response.headers['Cache-Control'] || response.headers['cache-control'] || '').toLowerCase();
  const referrer = String(response.headers['Referrer-Policy'] || response.headers['referrer-policy'] || '').toLowerCase();
  const robots = String(response.headers['X-Robots-Tag'] || response.headers['x-robots-tag'] || '').toLowerCase();
  return cache.includes('no-store') && referrer === 'no-referrer' && robots.includes('noindex');
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-public-links-'));
  process.env.DATA_DIR = dataDir;
  process.env.WOA_ADMIN_PIN = '7319';
  process.env.WOA_ADMIN_USERNAME = 'owner';
  process.env.WOA_ADMIN_PASSWORD = 'PublicLinkOwner123!';
  process.env.WOA_SESSION_SECRET = 'public-link-security-session-secret';
  process.env.WOA_PUBLIC_SECURE_LINK_LIMIT = '10';
  process.env.WOA_PUBLIC_SECURE_LINK_WINDOW_MS = '900000';
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.WOA_EMAIL_ENABLED = '0';
  process.env.WOA_MESSAGING_ENABLED = '0';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4181';
  const past = new Date(Date.now() - 60000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  const ids = {
    expiredPay: 'plink-' + 'a'.repeat(48),
    activePay: 'plink-' + 'b'.repeat(48),
    paidPay: 'plink-' + 'c'.repeat(48),
    cancelledPay: 'plink-' + 'd'.repeat(48),
    expiredSetup: 'setup-' + 'e'.repeat(48),
    activeSetup: 'setup-' + 'f'.repeat(48),
    negativeSetup: 'setup-' + '0'.repeat(48),
    legacyLinkedSetup: 'setup-' + '9'.repeat(48),
    completedSetup: 'setup-' + '1'.repeat(48)
  };
  const initial = {
    business: { name: 'WheelsonAuto' },
    organizations: [{ id: 'org-wheelsonauto', name: 'WheelsonAuto', status: 'Active' }],
    recurringPayments: [{ id: 'rec-public-link', organizationId: 'org-wheelsonauto', customer: 'Public Link Customer', amount: 229, frequency: 'Weekly', status: 'Active', tone: 'good' }],
    paymentRequests: [
      { id: ids.expiredPay, recurringPaymentId: 'rec-public-link', organizationId: 'org-wheelsonauto', customer: 'Expired Customer', amount: 229, status: 'Open', paymentProvider: 'clover', createdAt: past, expiresAt: past },
      { id: ids.activePay, recurringPaymentId: 'rec-public-link', organizationId: 'org-wheelsonauto', customer: 'Active Customer', amount: 229, status: 'Open', paymentProvider: 'clover', createdAt: new Date().toISOString(), expiresAt: future },
      { id: ids.paidPay, recurringPaymentId: 'rec-public-link', organizationId: 'org-wheelsonauto', customer: 'Paid Customer', amount: 229, status: 'Paid outside app', paidAt: new Date().toISOString(), closedAt: new Date().toISOString(), paymentProvider: 'clover', createdAt: new Date().toISOString(), expiresAt: future },
      { id: ids.cancelledPay, recurringPaymentId: 'rec-public-link', organizationId: 'org-wheelsonauto', customer: 'Cancelled Customer', amount: 229, status: 'Cancelled by office', paymentProvider: 'clover', createdAt: new Date().toISOString(), expiresAt: future }
    ],
    cardSetupRequests: [
      { id: ids.expiredSetup, recurringPaymentId: 'rec-public-link', organizationId: 'org-wheelsonauto', customer: 'Expired Setup', amount: 229, status: 'Open', paymentProvider: 'clover', createdAt: past, expiresAt: past },
      { id: ids.activeSetup, recurringPaymentId: 'rec-public-link', organizationId: 'org-wheelsonauto', customer: 'Active Setup', amount: 229, status: 'Open', paymentProvider: 'clover', createdAt: new Date().toISOString(), expiresAt: future },
      { id: ids.negativeSetup, recurringPaymentId: 'rec-public-link', organizationId: 'org-wheelsonauto', customer: 'Needs Card Customer', amount: 229, status: 'Card not linked - setup needed', paymentProvider: 'clover', createdAt: new Date().toISOString(), expiresAt: future },
      { id: ids.legacyLinkedSetup, recurringPaymentId: 'rec-public-link', organizationId: 'org-wheelsonauto', customer: 'Legacy Linked Customer', amount: 229, status: 'Card linked', paymentProvider: 'clover', createdAt: new Date().toISOString(), expiresAt: future },
      { id: ids.completedSetup, recurringPaymentId: 'rec-public-link', organizationId: 'org-wheelsonauto', customer: 'Completed Setup', amount: 229, status: 'Card saved for manual charges', completedAt: new Date().toISOString(), paymentProvider: 'clover', createdAt: new Date().toISOString(), expiresAt: future }
    ],
    claims: [
      { id: 'claim-active-toll', organizationId: 'org-wheelsonauto', type: 'Toll', customer: 'Toll Customer', amount: 4.25, receiptToken: '2'.repeat(48), receiptStatus: 'Ready', transactionDate: '2026-07-18', postedDate: '2026-07-19' },
      { id: 'claim-revoked-toll', organizationId: 'org-wheelsonauto', type: 'Toll', customer: 'Revoked Toll Customer', amount: 5.25, receiptToken: '3'.repeat(48), receiptStatus: 'Revoked', receiptRevokedAt: new Date().toISOString() }
    ],
    customers: [], vehicles: [], onlineVehicles: [], applications: [], websiteLeads: [], contracts: [], payments: [], maintenance: [], messages: [], tasks: [], documents: [], eSignatures: [], onboardingSessions: [], pickupAppointments: [], contractTemplates: [], customerAccounts: [], staffAccounts: [], dailyCloseouts: [], auditLogs: [], apiProviders: [], integrations: { clover: {}, messaging: {} }
  };
  await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(initial, null, 2));

  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');
  try {
    const activePayment = await request(server, 'GET', '/pay/' + ids.activePay);
    assert(activePayment.status === 200 && activePayment.text.includes('Active Customer') && publicHeaders(activePayment), 'Active payment links must render with private no-store, no-referrer, and noindex headers.');

    const beforeUnsignedFailure = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    const unsignedFailure = await request(server, 'GET', '/pay/' + ids.activePay + '/failure');
    const afterUnsignedFailure = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    const requestBefore = beforeUnsignedFailure.paymentRequests.find(row => row.id === ids.activePay);
    const requestAfter = afterUnsignedFailure.paymentRequests.find(row => row.id === ids.activePay);
    const recurringAfter = afterUnsignedFailure.recurringPayments.find(row => row.id === 'rec-public-link');
    assert(unsignedFailure.status === 200 && /No failed payment was recorded/i.test(unsignedFailure.text), 'Unsigned checkout cancellation should explain that no payment failure was recorded.');
    assert(requestAfter.status === requestBefore.status && !requestAfter.failedAt && recurringAfter.status === 'Active' && recurringAfter.tone === 'good', 'Unsigned failure returns must not mutate payment or recurring status.');

    const expiredPayment = await request(server, 'GET', '/pay/' + ids.expiredPay);
    let saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(expiredPayment.status === 410 && /no longer active/i.test(expiredPayment.text) && publicHeaders(expiredPayment), 'Expired payment links must fail closed with private response headers.');
    assert(saved.paymentRequests.find(row => row.id === ids.expiredPay).status === 'Expired', 'First expired-link access should persist the terminal expired state.');

    const cancelledPayment = await request(server, 'GET', '/pay/' + ids.cancelledPay);
    assert(cancelledPayment.status === 410 && !cancelledPayment.text.includes('Cancelled Customer'), 'Cancelled payment links must not reopen or disclose customer details.');
    const paidPayment = await request(server, 'GET', '/pay/' + ids.paidPay);
    assert(paidPayment.status === 200 && /already received/i.test(paidPayment.text) && !/Pay securely with/i.test(paidPayment.text), 'Completed payment links must not present another checkout action.');

    const activeSetup = await request(server, 'GET', '/setup-card/' + ids.activeSetup);
    assert(activeSetup.status === 200 && activeSetup.text.includes('Active Setup') && publicHeaders(activeSetup), 'Active setup links must render with private response headers.');
    const negativeSetup = await request(server, 'GET', '/setup-card/' + ids.negativeSetup);
    assert(negativeSetup.status === 200 && negativeSetup.text.includes('Needs Card Customer') && !/Card already saved/i.test(negativeSetup.text), 'Negative legacy card statuses must remain open instead of being misclassified by the word linked.');
    const legacyLinkedSetup = await request(server, 'GET', '/setup-card/' + ids.legacyLinkedSetup);
    assert(legacyLinkedSetup.status === 200 && /Card already saved/i.test(legacyLinkedSetup.text) && !legacyLinkedSetup.text.includes('Legacy Linked Customer'), 'A positive legacy card-linked status must remain terminal without redisclosing customer setup details.');
    const expiredSetup = await request(server, 'GET', '/setup-card/' + ids.expiredSetup);
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(expiredSetup.status === 410 && saved.cardSetupRequests.find(row => row.id === ids.expiredSetup).status === 'Expired', 'Expired card links must fail closed and persist expiration.');
    const completedSetup = await request(server, 'POST', '/api/public/card-setup/' + ids.completedSetup + '/complete', { ip: '198.51.100.20', json: { token: 'clv_should_never_be_used' } });
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(completedSetup.status === 409 && /already been completed/i.test(completedSetup.json && completedSetup.json.error || ''), 'A completed card setup token must be single-use.');
    assert(!saved.cardSetupRequests.find(row => row.id === ids.completedSetup).cloverCustomerId, 'Reusing a completed card setup link must stop before provider work or customer mutation.');

    const activeToll = await request(server, 'GET', '/toll-receipt/' + '2'.repeat(48));
    const revokedToll = await request(server, 'GET', '/toll-receipt/' + '3'.repeat(48));
    const missingOnboarding = await request(server, 'GET', '/onboard/' + '4'.repeat(56));
    assert(activeToll.status === 200 && activeToll.text.includes('Toll Customer') && publicHeaders(activeToll), 'Active toll proof should remain privately accessible.');
    assert(revokedToll.status === 404 && !revokedToll.text.includes('Revoked Toll Customer') && publicHeaders(revokedToll), 'Revoked toll proof must fail closed without leaking customer details.');
    assert(missingOnboarding.status === 404 && publicHeaders(missingOnboarding) && !missingOnboarding.text.includes('4'.repeat(56)), 'Missing onboarding bearer links must fail privately without echoing the attempted token.');

    const login = await request(server, 'POST', '/login', { form: { username: 'owner', password: 'PublicLinkOwner123!' } });
    const cookie = String(login.cookie || '').split(';')[0];
    const generatedPayment = await request(server, 'POST', '/api/payment-links', { cookie, json: { recurringPaymentId: 'rec-public-link', customer: 'Generated Payment', amount: 229 } });
    const generatedSetup = await request(server, 'POST', '/api/card-setup-requests', { cookie, json: { customer: 'Generated Setup', amount: 229, frequency: 'Weekly', paymentProvider: 'clover', deferVehicleAssignment: true } });
    assert(generatedPayment.status === 201 && /^plink-[a-f0-9]{48}$/.test(generatedPayment.json.paymentLink.id), 'New payment links must use a 192-bit random public identifier.');
    assert(generatedSetup.status === 201 && /^setup-[a-f0-9]{48}$/.test(generatedSetup.json.setupLink.id), 'New card setup links must use a 192-bit random public identifier.');
    const paymentTtl = Date.parse(generatedPayment.json.paymentLink.expiresAt) - Date.now();
    const setupTtl = Date.parse(generatedSetup.json.setupLink.expiresAt) - Date.now();
    assert(paymentTtl > 13 * 86400000 && paymentTtl <= 14 * 86400000, 'New payment links must expire after the configured two-week window.');
    assert(setupTtl > 6 * 86400000 && setupTtl <= 7 * 86400000, 'New card setup links must expire after the configured seven-day window.');

    let throttled = null;
    for (let index = 0; index < 11; index += 1) {
      throttled = await request(server, 'POST', '/api/public/payment-links/' + ids.expiredPay + '/checkout', { ip: '203.0.113.90' });
    }
    assert(throttled.status === 429 && Number(throttled.headers['Retry-After'] || 0) > 0, 'Repeated public checkout mutations must hit a persistent rate limit.');

    console.log('Public link security check passed: high-entropy expiring links, one-time card setup, provider-authoritative failures, revocable toll proof, private headers, and persistent rate limits are enforced.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
