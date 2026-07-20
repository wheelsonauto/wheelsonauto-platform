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
      cookie: this.headers['Set-Cookie'] || this.headers['set-cookie'] || '',
      location: this.headers.Location || this.headers.location || ''
    });
  }
}

async function request(server, method, route, options = {}) {
  const headers = {
    host: '127.0.0.1:4182',
    'x-forwarded-host': '127.0.0.1:4182',
    'x-forwarded-proto': 'http',
    'user-agent': 'WheelsonAuto Stripe Identity regression test',
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

function dateKey(offset) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function nextPickupDate() {
  for (let offset = 1; offset <= 7; offset += 1) {
    if (new Date(dateKey(offset) + 'T12:00:00').getDay() !== 0) return dateKey(offset);
  }
  throw new Error('No valid pickup day found.');
}

function pngDataUrl() {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return 'data:image/png;base64,' + Buffer.concat([header, Buffer.alloc(256, 2)]).toString('base64');
}

function stripeSignature(secret, rawBody) {
  const timestamp = Math.floor(Date.now() / 1000);
  const value = crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex');
  return 't=' + timestamp + ',v1=' + value;
}

function createFakeStripe() {
  const state = { status: 'requires_input', requests: [] };
  return {
    state,
    baseUrl: 'https://api.stripe.test/v1',
    fetch: async (url, options = {}) => {
      const body = String(options.body || '');
      state.requests.push({ method: options.method || 'GET', url: String(url).replace('https://api.stripe.test', ''), body, headers: options.headers || {} });
      const response = {
        id: 'vs_test_wheelsonauto_identity',
        object: 'identity.verification_session',
        status: state.status,
        livemode: false,
        url: state.status === 'requires_input' ? 'https://verify.stripe.test/vs_test_wheelsonauto_identity' : null,
        metadata: { flow: 'wheelsonauto_onboarding_identity' },
        last_error: state.status === 'requires_input' ? null : undefined
      };
      return { ok: true, status: 200, text: async () => JSON.stringify(response) };
    }
  };
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-stripe-identity-'));
  const fakeStripe = createFakeStripe();
  const previousFetch = global.fetch;
  global.fetch = fakeStripe.fetch;
  const webhookSecret = 'whsec_wheelsonauto_identity_test';
  process.env.TZ = 'America/New_York';
  process.env.NODE_ENV = 'test';
  process.env.WOA_ALLOW_ISOLATED_PROVIDER_TESTS = '1';
  process.env.DATA_DIR = dataDir;
  process.env.WOA_ADMIN_PIN = '7319';
  process.env.WOA_ADMIN_USERNAME = 'owner';
  process.env.WOA_ADMIN_PASSWORD = 'StripeIdentityOwner123!';
  process.env.WOA_SESSION_SECRET = 'stripe-identity-session-secret';
  process.env.WOA_IDENTITY_PROVIDER = 'stripe';
  process.env.STRIPE_SECRET_KEY = 'sk_test_wheelsonauto_identity';
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  process.env.STRIPE_API_BASE = fakeStripe.baseUrl;
  process.env.WOA_ONBOARDING_PAYMENT_PROVIDER = 'stripe';
  process.env.WOA_PAYMENT_PROVIDER = 'clover';
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.WOA_EMAIL_ENABLED = '0';
  process.env.WOA_MESSAGING_ENABLED = '0';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4182';

  const initial = {
    business: { name: 'WheelsonAuto' },
    vehicles: [{ id: 'veh-identity-1', year: '2017', make: 'Toyota', model: 'Camry', vin: '4T1BF1FK0HU123456', plate: 'ID-TEST', status: 'Ready', organizationId: 'org-wheelsonauto' }],
    onlineVehicles: [{ id: 'online-identity-1', platformVehicleId: 'veh-identity-1', title: '2017 Toyota Camry', slug: '2017-toyota-camry', vin: '4T1BF1FK0HU123456', plate: 'ID-TEST', weeklyPayment: 229, downPayment: 485, availability: 'Available', published: true, organizationId: 'org-wheelsonauto' }],
    applications: [{ id: 'app-identity-1', organizationId: 'org-wheelsonauto', name: 'Identity Test Customer', firstName: 'Identity', lastName: 'Customer', phone: '8565550111', email: 'identity@example.com', address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', driverLicenseId: 'D12345678901234', driverLicenseExpires: '2032-01-01', onlineVehicleId: 'online-identity-1', vehicleId: 'veh-identity-1', vehicle: '2017 Toyota Camry', status: 'New - staff review', stage: 'New', pricingSnapshot: { weeklyPayment: 229, downPayment: 485 } }],
    websiteLeads: [], customers: [], contracts: [], payments: [], paymentRequests: [], cardSetupRequests: [], recurringPayments: [], maintenance: [], claims: [], messages: [], tasks: [], documents: [], eSignatures: [], onboardingSessions: [], pickupAppointments: [], contractTemplates: [], customerAccounts: [], staffAccounts: [], dailyCloseouts: [], auditLogs: [], apiProviders: [], verificationCases: [], organizations: [{ id: 'org-wheelsonauto', name: 'WheelsonAuto', status: 'Active' }], integrations: { clover: {}, stripe: {}, messaging: {} }, publicSite: { minimumPickupDays: 1, maximumVehicleHoldDays: 7, pickupSlotMinutes: 30, pickupCapacity: 2 }
  };
  await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(initial, null, 2));

  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');
  try {
    const login = await request(server, 'POST', '/login', { form: { username: 'owner', password: 'StripeIdentityOwner123!' } });
    const ownerCookie = String(login.cookie).split(';')[0];
    assert(login.status === 302 && ownerCookie.includes('woa_session='), 'Owner login should create a signed session.');
    const link = await request(server, 'POST', '/api/onboarding/links', { cookie: ownerCookie, json: { applicationId: 'app-identity-1', paymentProvider: 'stripe' } });
    assert(link.status === 201 && link.json.onboarding.identityProvider === 'stripe', 'New onboarding must lock Stripe Identity when its runtime is enabled.');
    const onboardingId = link.json.onboarding.id;
    const token = link.json.onboarding.url.split('/onboard/')[1];
    const pickupDate = nextPickupDate();
    const profile = await request(server, 'POST', '/api/public/onboarding/' + token + '/profile', { json: { address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', driverLicenseId: 'D12345678901234', driverLicenseExpires: '2032-01-01', insuranceProvider: 'Test Insurance', insurancePolicyNumber: 'POLICY-ID-1', requestedPickupDate: pickupDate, requestedPickupTime: '1:00 PM', pickupAutopayConsent: true } });
    assert(profile.status === 200, 'Profile and pickup must save before identity files.');
    const image = pngDataUrl();
    const documents = await request(server, 'POST', '/api/public/onboarding/' + token + '/documents', { json: { documents: [
      { kind: 'driver_license_front', name: 'license-front.png', type: 'image/png', dataUrl: image },
      { kind: 'driver_license_back', name: 'license-back.png', type: 'image/png', dataUrl: image },
      { kind: 'identity_selfie', name: 'identity-selfie.png', type: 'image/png', dataUrl: image },
      { kind: 'insurance', name: 'insurance.png', type: 'image/png', dataUrl: image }
    ] } });
    assert(documents.status === 201, 'Private ID, selfie, and insurance files must save before Stripe verification.');
    const pageBefore = await request(server, 'GET', '/onboard/' + token);
    assert(/Verify license and selfie/.test(pageBefore.text), 'Customer page should show the Stripe Identity action in the existing verification step.');
    assert(!/onboarding-uploads|data:image\//.test(pageBefore.text), 'Private ID file paths and contents must never render into the public onboarding page.');

    const earlyApproval = await request(server, 'POST', '/api/onboarding/review', { cookie: ownerCookie, json: { onboardingSessionId: onboardingId, stage: 'documents', decision: 'approve', identityConfirmed: true } });
    assert(earlyApproval.status === 409 && /Stripe Identity must verify/i.test(earlyApproval.json.error), 'Staff must not bypass Stripe Identity before the signed verified result.');
    const identity = await request(server, 'POST', '/api/public/onboarding/' + token + '/identity', { json: {} });
    assert(identity.status === 201 && identity.json.redirectUrl === 'https://verify.stripe.test/vs_test_wheelsonauto_identity', 'Customer should receive the short-lived Stripe-hosted verification URL.');
    const createRequest = fakeStripe.state.requests.find(row => row.method === 'POST' && row.url === '/v1/identity/verification_sessions');
    const identityForm = new URLSearchParams(createRequest && createRequest.body || '');
    assert(createRequest && /options%5Bdocument%5D%5Ballowed_types%5D%5B0%5D=driving_license/.test(createRequest.body), 'Stripe session must accept only driver licenses.');
    assert(identityForm.get('options[document][require_live_capture]') === 'true' && identityForm.get('options[document][require_matching_selfie]') === 'true', 'Stripe session must require live capture and a matching selfie.');
    assert(!/Identity.Test.Customer|identity%40example|D12345678901234|POLICY-ID-1/i.test(createRequest.body), 'Stripe metadata must not contain customer PII, license numbers, or insurance numbers.');
    let saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    let session = saved.onboardingSessions.find(row => row.id === onboardingId);
    assert(session.stripeIdentityVerificationId === 'vs_test_wheelsonauto_identity' && session.identityVerificationStatus === 'requires_input', 'WheelsonAuto should persist only the provider session reference and safe status.');
    assert(!JSON.stringify(saved).includes('verify.stripe.test'), 'Short-lived Stripe verification URLs must never be persisted.');
    assert(saved.documents.filter(row => row.onboardingSessionId === onboardingId && /^Driver license/.test(row.type || '')).length === 2, 'License front and back must remain in the private customer file.');

    fakeStripe.state.status = 'verified';
    const returned = await request(server, 'GET', '/onboard/' + token + '?identity=returned');
    assert(returned.status === 200 && /Stripe verified the live license and selfie/.test(returned.text), 'Stripe return should reconcile the authoritative status before rendering.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    session = saved.onboardingSessions.find(row => row.id === onboardingId);
    const verificationCase = saved.verificationCases.find(row => row.onboardingSessionId === onboardingId && row.provider === 'Stripe Identity');
    assert(session.identityVerificationStatus === 'verified' && verificationCase && verificationCase.status === 'Verified', 'Verified Stripe Identity status must connect to the onboarding and verification inbox.');
    const approval = await request(server, 'POST', '/api/onboarding/review', { cookie: ownerCookie, json: { onboardingSessionId: onboardingId, stage: 'documents', decision: 'approve', identityConfirmed: true, notes: 'Stripe verified identity; full coverage confirmed.' } });
    assert(approval.status === 200, 'Staff should approve identity and insurance only after Stripe verifies the identity.');

    const lateEvent = { id: 'evt_identity_late_requires_input', type: 'identity.verification_session.requires_input', data: { object: { id: 'vs_test_wheelsonauto_identity', object: 'identity.verification_session', status: 'requires_input', livemode: false, last_error: { code: 'selfie_document_mismatch' } } } };
    const raw = JSON.stringify(lateEvent);
    const lateWebhook = await request(server, 'POST', '/api/webhooks/stripe', { raw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, raw) } });
    assert(lateWebhook.status === 200 && lateWebhook.json.identitySessionId === onboardingId, 'Signed Stripe Identity webhooks must reconcile to the exact onboarding file.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    session = saved.onboardingSessions.find(row => row.id === onboardingId);
    assert(session.identityVerificationStatus === 'verified' && session.documentReviewStatus === 'Approved', 'A late requires-input event must never downgrade an already verified and approved customer.');
    assert(saved.verificationCases.filter(row => row.onboardingSessionId === onboardingId && row.provider === 'Stripe Identity').length === 1, 'Webhook reconciliation must not duplicate the identity case.');

    const privateLicense = await request(server, 'GET', '/api/onboarding/documents/' + saved.documents.find(row => row.onboardingSessionId === onboardingId && row.documentKind === 'driver_license_front').id, { cookie: ownerCookie });
    assert(privateLicense.status === 200 && privateLicense.headers['X-Robots-Tag'] === 'noindex, nofollow', 'Authorized staff must be able to retrieve the private ID file with no-index protections.');
    const providerStatus = await request(server, 'GET', '/api/verification/status', { cookie: ownerCookie });
    assert(providerStatus.status === 200 && providerStatus.json.providers.identityRuntimeReady === true && providerStatus.json.providers.identityMode === 'test', 'Provider status must distinguish the prepared test runtime from live mode.');
    console.log('Stripe Identity check passed: private ID file, hosted live capture, signed status, staff gate, no PII metadata, no URL persistence, and late-event protection are connected.');
  } finally {
    global.fetch = previousFetch;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
