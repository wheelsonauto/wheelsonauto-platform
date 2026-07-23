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
      const pathname = new URL(String(url)).pathname;
      const body = String(options.body || '');
      state.requests.push({ method: options.method || 'GET', url: pathname, body, headers: options.headers || {} });
      if (pathname === '/v1/customers') {
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'cus_test_identity', object: 'customer' }) };
      }
      if (pathname === '/v1/checkout/sessions') {
        return { ok: true, status: 200, text: async () => JSON.stringify({
          id: 'cs_test_identity_card_setup',
          object: 'checkout.session',
          mode: 'setup',
          status: 'open',
          url: 'https://checkout.stripe.test/c/pay/cs_test_identity_card_setup'
        }) };
      }
      const response = {
        id: 'vs_test_wheelsonauto_identity',
        object: 'identity.verification_session',
        status: state.status,
        livemode: false,
        url: state.status === 'requires_input' ? 'https://verify.stripe.test/vs_test_wheelsonauto_identity' : null,
        metadata: { flow: 'wheelsonauto_onboarding_identity' },
        verified_outputs: state.status === 'verified' ? { first_name: 'Identity', last_name: 'Customer' } : null,
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
    const screeningPage = await request(server, 'GET', '/onboard/' + token);
    assert(/data-selfie-capture/.test(screeningPage.text) && /Hold your physical driver license just below your chin/.test(screeningPage.text), 'The preliminary selfie step must use the guided live-camera capture and clear license-below-chin instructions.');
    const documents = await request(server, 'POST', '/api/public/onboarding/' + token + '/documents', { json: { documents: [
      { kind: 'driver_license_front', name: 'license-front.png', type: 'image/png', dataUrl: image },
      { kind: 'driver_license_back', name: 'license-back.png', type: 'image/png', dataUrl: image },
      { kind: 'identity_selfie', name: 'live-selfie-with-license.png', type: 'image/png', dataUrl: image }
    ] } });
    assert(documents.status === 201 && documents.json.documents.length === 3, 'The low-cost WheelsonAuto screening must store the two license sides and live selfie before Stripe Identity starts.');
    const pageBefore = await request(server, 'GET', '/onboard/' + token);
    assert(/Verify who submitted the application/.test(pageBefore.text) && /Identity is not verified yet/.test(pageBefore.text) && /preliminary screening approval and a saved card are required first/i.test(pageBefore.text), 'Customer page must clearly distinguish preliminary screening from paid identity verification.');
    assert(!/onboarding-uploads|data:image\//.test(pageBefore.text), 'Private ID file paths and contents must never render into the public onboarding page.');

    const identityCreatesBeforeApproval = fakeStripe.state.requests.filter(row => row.method === 'POST' && row.url === '/v1/identity/verification_sessions').length;
    const earlyIdentity = await request(server, 'POST', '/api/public/onboarding/' + token + '/identity', { json: {} });
    assert(earlyIdentity.status === 409 && fakeStripe.state.requests.filter(row => row.method === 'POST' && row.url === '/v1/identity/verification_sessions').length === identityCreatesBeforeApproval, 'Stripe Identity must not start or create a billable session before preliminary WheelsonAuto screening approval.');
    const signature = await request(server, 'POST', '/api/public/onboarding/' + token + '/signature', { json: { typedName: 'Identity Test Customer', electronicConsent: true, signatureMatchConsent: true, signatureData: image } });
    assert(signature.status === 201, 'The customer should sign before the combined review.');
    const card = await request(server, 'POST', '/api/public/onboarding/' + token + '/card', { json: { autopayConsent: true } });
    assert(card.status === 201 && /^https:\/\/checkout\.stripe\.test\//.test(card.json.redirectUrl || ''), 'The customer should go directly to Stripe-hosted card fields and save a card without a charge before preliminary screening.');
    const cardCheckoutRequest = fakeStripe.state.requests.find(row => row.method === 'POST' && row.url === '/v1/checkout/sessions');
    const cardCheckoutForm = new URLSearchParams(cardCheckoutRequest && cardCheckoutRequest.body || '');
    assert(cardCheckoutForm.get('mode') === 'setup' && cardCheckoutForm.get('currency') === 'usd' && cardCheckoutForm.get('payment_method_types[0]') === 'card', 'The pre-review card step must create a USD, card-only Stripe setup session.');
    assert(!cardCheckoutForm.has('setup_intent_data[usage]'), 'The Stripe card step must not send the unsupported setup_intent_data[usage] parameter.');
    let saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    let session = saved.onboardingSessions.find(row => row.id === onboardingId);
    const recurring = saved.recurringPayments.find(row => row.onboardingSessionId === onboardingId);
    recurring.stripeCustomerId = 'cus_test_identity';
    recurring.stripePaymentMethodId = 'pm_test_identity';
    recurring.stripeLivemode = true;
    recurring.stripeCardSavedAt = new Date().toISOString();
    recurring.status = 'Setup complete';
    session.cardCompletedAt = new Date().toISOString();
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    const correction = await request(server, 'POST', '/api/onboarding/review', { cookie: ownerCookie, json: { onboardingSessionId: onboardingId, stage: 'final', decision: 'request_correction', correctionKinds: ['identity_selfie'], notes: 'Retake the live selfie with the physical license below the chin.' } });
    assert(correction.status === 200, 'The combined review must be able to request only the specific screening file that needs correction.');
    const correctionPage = await request(server, 'GET', '/onboard/' + token);
    assert(/Correction requested for Identity selfie/i.test(correctionPage.text) && /data-selfie-capture/.test(correctionPage.text) && !/name="driver_license_front"/.test(correctionPage.text), 'A selfie correction must reopen only the guided live-camera capture.');
    const correctedSelfie = await request(server, 'POST', '/api/public/onboarding/' + token + '/documents', { json: { documents: [
      { kind: 'identity_selfie', name: 'live-selfie-with-license-corrected.png', type: 'image/png', dataUrl: image }
    ] } });
    assert(correctedSelfie.status === 201 && correctedSelfie.json.documents.length === 1, 'A requested selfie correction must replace only that private file.');
    const finalApproval = await request(server, 'POST', '/api/onboarding/review', { cookie: ownerCookie, json: { onboardingSessionId: onboardingId, stage: 'final', decision: 'approve', identityConfirmed: true, signatureMatchConfirmed: true, vehicleConfirmed: true, cardConfirmed: true, notes: 'Preliminary file, signature, VIN, and saved card all reviewed.' } });
    assert(finalApproval.status === 200 && finalApproval.json.finalReviewStatus === 'Approved', 'One combined staff approval must unlock the paid Stripe Identity step.');
    const paymentCreatesBeforeIdentity = fakeStripe.state.requests.filter(row => row.method === 'POST' && row.url === '/v1/checkout/sessions').length;
    const paymentBeforeIdentity = await request(server, 'POST', '/api/public/onboarding/' + token + '/payment', { json: { paymentType: 'deposit' } });
    assert(paymentBeforeIdentity.status === 409 && /Stripe Identity/i.test(paymentBeforeIdentity.json.error || '') && fakeStripe.state.requests.filter(row => row.method === 'POST' && row.url === '/v1/checkout/sessions').length === paymentCreatesBeforeIdentity, 'Preliminary staff screening must never unlock a real payment before Stripe verifies who submitted the application.');
    const identity = await request(server, 'POST', '/api/public/onboarding/' + token + '/identity', { json: {} });
    assert(identity.status === 201 && identity.json.redirectUrl === 'https://verify.stripe.test/vs_test_wheelsonauto_identity', 'Approved customer should receive the short-lived Stripe-hosted verification URL.');
    const createRequest = fakeStripe.state.requests.find(row => row.method === 'POST' && row.url === '/v1/identity/verification_sessions');
    const identityForm = new URLSearchParams(createRequest && createRequest.body || '');
    assert(createRequest && /options%5Bdocument%5D%5Ballowed_types%5D%5B0%5D=driving_license/.test(createRequest.body), 'Stripe session must accept only driver licenses.');
    assert(identityForm.get('options[document][require_live_capture]') === 'true' && identityForm.get('options[document][require_matching_selfie]') === 'true', 'Stripe session must require live capture and a matching selfie.');
    assert(!/Identity.Test.Customer|identity%40example|D12345678901234|POLICY-ID-1/i.test(createRequest.body), 'Stripe metadata must not contain customer PII, license numbers, or insurance numbers.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    session = saved.onboardingSessions.find(row => row.id === onboardingId);
    assert(session.stripeIdentityVerificationId === 'vs_test_wheelsonauto_identity' && session.identityVerificationStatus === 'requires_input', 'WheelsonAuto should persist only the provider session reference and safe status.');
    assert(!JSON.stringify(saved).includes('verify.stripe.test'), 'Short-lived Stripe verification URLs must never be persisted.');
    assert(saved.documents.filter(row => row.onboardingSessionId === onboardingId && /driver_license|identity_selfie/.test(row.documentKind || '')).length === 3, 'WheelsonAuto must retain one current preliminary license/selfie set while Stripe keeps the authoritative paid verification capture.');

    fakeStripe.state.status = 'verified';
    const returned = await request(server, 'GET', '/onboard/' + token + '?identity=returned');
    assert(returned.status === 200 && /Identity verified: Stripe confirmed the live driver license, matching selfie, and application legal name/.test(returned.text), 'Stripe return should reconcile and clearly display the authoritative identity proof before payment.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    session = saved.onboardingSessions.find(row => row.id === onboardingId);
    const verificationCase = saved.verificationCases.find(row => row.onboardingSessionId === onboardingId && row.provider === 'Stripe Identity');
    assert(session.identityVerificationStatus === 'verified' && verificationCase && verificationCase.status === 'Verified', 'Verified Stripe Identity status must connect to the onboarding and verification inbox.');
    const lateEvent = { id: 'evt_identity_late_requires_input', type: 'identity.verification_session.requires_input', data: { object: { id: 'vs_test_wheelsonauto_identity', object: 'identity.verification_session', status: 'requires_input', livemode: false, last_error: { code: 'selfie_document_mismatch' } } } };
    const raw = JSON.stringify(lateEvent);
    const lateWebhook = await request(server, 'POST', '/api/webhooks/stripe', { raw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, raw) } });
    assert(lateWebhook.status === 200 && lateWebhook.json.identitySessionId === onboardingId, 'Signed Stripe Identity webhooks must reconcile to the exact onboarding file.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    session = saved.onboardingSessions.find(row => row.id === onboardingId);
    assert(session.identityVerificationStatus === 'verified' && session.finalReviewStatus === 'Approved', 'A late requires-input event must never downgrade an already verified and approved customer.');
    assert(saved.verificationCases.filter(row => row.onboardingSessionId === onboardingId && row.provider === 'Stripe Identity').length === 1, 'Webhook reconciliation must not duplicate the identity case.');

    const privateSelfie = await request(server, 'GET', '/api/onboarding/documents/' + saved.documents.find(row => row.onboardingSessionId === onboardingId && row.documentKind === 'identity_selfie').id, { cookie: ownerCookie });
    assert(privateSelfie.status === 200 && privateSelfie.headers['X-Robots-Tag'] === 'noindex, nofollow', 'Authorized staff must be able to retrieve the private screening selfie with no-index protections.');
    const providerStatus = await request(server, 'GET', '/api/verification/status', { cookie: ownerCookie });
    assert(providerStatus.status === 200 && providerStatus.json.providers.identityRuntimeReady === true && providerStatus.json.providers.identityMode === 'test', 'Provider status must distinguish the prepared test runtime from live mode.');
    console.log('Stripe Identity check passed: preliminary live-camera screening, one combined approval, one paid hosted ID/selfie capture, legal-name status, selective correction, no PII metadata, no URL persistence, and late-event protection are connected.');
  } finally {
    global.fetch = previousFetch;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
