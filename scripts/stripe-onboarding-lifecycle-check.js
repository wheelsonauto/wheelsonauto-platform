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
    host: '127.0.0.1:4183',
    'x-forwarded-host': '127.0.0.1:4183',
    'x-forwarded-proto': 'http',
    'user-agent': 'WheelsonAuto full Stripe onboarding lifecycle test',
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

function localDateKey(offset) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function nextPickupDate() {
  for (let offset = 1; offset <= 7; offset += 1) {
    if (new Date(localDateKey(offset) + 'T12:00:00').getDay() !== 0) return localDateKey(offset);
  }
  throw new Error('No valid pickup day found in the next seven days.');
}

function plusDays(value, days) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function pngDataUrl(seed = 3) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return 'data:image/png;base64,' + Buffer.concat([header, Buffer.alloc(384, seed)]).toString('base64');
}

function stripeSignature(secret, rawBody) {
  const timestamp = Math.floor(Date.now() / 1000);
  const value = crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex');
  return 't=' + timestamp + ',v1=' + value;
}

function metadataFromForm(form) {
  const metadata = {};
  for (const [key, value] of form.entries()) {
    const match = /^metadata\[([^\]]+)\]$/.exec(key);
    if (match) metadata[match[1]] = value;
  }
  return metadata;
}

function createFakeStripe() {
  const state = {
    requests: [],
    checkoutCounter: 0,
    checkouts: new Map(),
    disputeMetadata: {}
  };
  const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  });
  return {
    state,
    baseUrl: 'https://api.stripe.test/v1',
    fetch: async (url, options = {}) => {
      const href = String(url);
      const pathname = new URL(href).pathname;
      const method = String(options.method || 'GET').toUpperCase();
      const body = String(options.body || '');
      const form = new URLSearchParams(body);
      state.requests.push({ method, pathname, body, headers: options.headers || {} });

      if (method === 'POST' && pathname === '/v1/customers') {
        return response({ id: 'cus_test_lifecycle', object: 'customer', email: form.get('email') || '' });
      }
      if (method === 'POST' && pathname === '/v1/identity/verification_sessions') {
        return response({
          id: 'vs_test_lifecycle',
          object: 'identity.verification_session',
          status: 'requires_input',
          livemode: false,
          url: 'https://verify.stripe.test/vs_test_lifecycle',
          metadata: metadataFromForm(form)
        });
      }
      if (method === 'GET' && pathname === '/v1/identity/verification_sessions/vs_test_lifecycle') {
        return response({ id: 'vs_test_lifecycle', object: 'identity.verification_session', status: 'verified', livemode: false, metadata: {} });
      }
      if (method === 'POST' && pathname === '/v1/checkout/sessions') {
        state.checkoutCounter += 1;
        const mode = form.get('mode') || '';
        const reference = form.get('client_reference_id') || String(state.checkoutCounter);
        const id = 'cs_test_' + mode + '_' + reference.replace(/[^a-z0-9_-]/gi, '').slice(-36);
        const checkout = {
          id,
          object: 'checkout.session',
          mode,
          status: 'open',
          payment_status: 'unpaid',
          customer: form.get('customer') || 'cus_test_lifecycle',
          client_reference_id: reference,
          metadata: metadataFromForm(form),
          url: 'https://checkout.stripe.test/' + id
        };
        state.checkouts.set(id, checkout);
        return response(checkout);
      }
      if (method === 'GET' && pathname === '/v1/setup_intents/seti_test_lifecycle') {
        return response({
          id: 'seti_test_lifecycle',
          object: 'setup_intent',
          status: 'succeeded',
          customer: 'cus_test_lifecycle',
          payment_method: { id: 'pm_test_lifecycle', object: 'payment_method', card: { brand: 'visa', last4: '4242' } }
        });
      }
      if (method === 'GET' && pathname === '/v1/charges/ch_test_first_week') {
        return response({
          id: 'ch_test_first_week',
          object: 'charge',
          payment_intent: 'pi_test_first_week',
          customer: 'cus_test_lifecycle',
          metadata: state.disputeMetadata
        });
      }
      if (method === 'GET' && pathname === '/v1/payment_intents/pi_test_first_week') {
        return response({
          id: 'pi_test_first_week',
          object: 'payment_intent',
          customer: 'cus_test_lifecycle',
          metadata: state.disputeMetadata
        });
      }
      return response({ error: { code: 'unexpected_test_request', message: method + ' ' + pathname + ' was not mocked.' } }, 500);
    }
  };
}

async function readSaved(dataDir) {
  return JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-stripe-lifecycle-'));
  const fakeStripe = createFakeStripe();
  const originalFetch = global.fetch;
  const webhookSecret = 'whsec_wheelsonauto_full_lifecycle';
  global.fetch = fakeStripe.fetch;
  process.env.TZ = 'America/New_York';
  process.env.DATA_DIR = dataDir;
  process.env.WOA_ADMIN_PIN = '7319';
  process.env.WOA_SESSION_SECRET = 'stripe-lifecycle-session-secret';
  process.env.WOA_PAYMENT_PROVIDER = 'stripe';
  process.env.WOA_ONBOARDING_PAYMENT_PROVIDER = 'stripe';
  process.env.WOA_IDENTITY_PROVIDER = 'stripe';
  process.env.WOA_STRIPE_IDENTITY_TEST_MODE = '1';
  process.env.STRIPE_SECRET_KEY = 'sk_test_wheelsonauto_lifecycle';
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  process.env.STRIPE_API_BASE = fakeStripe.baseUrl;
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.WOA_EMAIL_ENABLED = '0';
  process.env.WOA_MESSAGING_ENABLED = '0';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4183';

  const initial = {
    business: { name: 'WheelsonAuto' },
    vehicles: [{ id: 'veh-stripe-life-1', year: '2018', make: 'Honda', model: 'Accord', color: 'Silver', vin: '1HGCV1F30JA123456', plate: 'WOA-918', mileage: 68420, status: 'Ready', organizationId: 'org-wheelsonauto' }],
    onlineVehicles: [{ id: 'online-stripe-life-1', platformVehicleId: 'veh-stripe-life-1', title: '2018 Honda Accord', slug: '2018-honda-accord', year: '2018', make: 'Honda', model: 'Accord', color: 'Silver', vin: '1HGCV1F30JA123456', plate: 'WOA-918', mileage: 68420, weeklyPayment: 229, downPayment: 485, contractMonths: 19, availability: 'Available', published: true, organizationId: 'org-wheelsonauto', imageUrls: ['https://images.example.test/accord-front.jpg', 'https://images.example.test/accord-side.jpg'] }],
    applications: [], websiteLeads: [], customers: [], contracts: [], payments: [], paymentRequests: [], cardSetupRequests: [], recurringPayments: [], maintenance: [], claims: [], messages: [], tasks: [], documents: [], eSignatures: [], onboardingSessions: [], pickupAppointments: [], contractTemplates: [], customerAccounts: [], staffAccounts: [], dailyCloseouts: [], auditLogs: [], apiProviders: [], verificationCases: [], organizations: [{ id: 'org-wheelsonauto', name: 'WheelsonAuto', status: 'Active' }], integrations: { clover: {}, stripe: {}, messaging: {} }, publicSite: { defaultWeeklyPayment: 229, defaultDownPayment: 485, minimumPickupDays: 1, maximumVehicleHoldDays: 7, pickupSlotMinutes: 30, pickupCapacity: 2, pickupAddress: '5150 NJ-42, Blackwood, NJ 08012' }
  };
  await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(initial, null, 2));

  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');
  try {
    const publicSite = await request(server, 'GET', '/site-preview');
    assert(publicSite.status === 200 && /2018 Honda Accord/.test(publicSite.text), 'The full lifecycle must begin from a real published WheelsonAuto vehicle listing.');
    const vehicleDetail = await request(server, 'GET', '/vehicles/2018-honda-accord');
    assert(vehicleDetail.status === 200 && /accord-front\.jpg/.test(vehicleDetail.text) && /accord-side\.jpg/.test(vehicleDetail.text) && /2 photos/.test(vehicleDetail.text), 'The selected listing detail must retain its complete scrollable photo gallery.');

    const applicant = {
      onlineVehicleId: 'online-stripe-life-1',
      firstName: 'Stripe',
      lastName: 'Lifecycle',
      phone: '8565550188',
      email: 'stripe.lifecycle@example.com',
      address: '515 Test Lane',
      city: 'Blackwood',
      state: 'NJ',
      postalCode: '08012',
      dateOfBirth: '1991-02-15',
      driverLicenseId: 'S12345678901234',
      driverLicenseExpires: '2032-02-15',
      employer: 'Lifecycle Test Employer',
      income: 5200,
      password: 'StripeLife123',
      applicationConsent: true
    };
    const applied = await request(server, 'POST', '/api/public/applications', { json: applicant });
    assert(applied.status === 201 && applied.json.application.id, 'A customer must be able to apply for the selected online vehicle.');
    const applicationId = applied.json.application.id;
    const customerLogin = await request(server, 'POST', '/customer/login', { form: { username: applicant.email, password: applicant.password } });
    const customerCookie = String(customerLogin.cookie).split(';')[0];
    assert(customerLogin.status === 302 && customerCookie.includes('woa_customer_session='), 'The application must immediately create a secure customer login.');

    const ownerLogin = await request(server, 'POST', '/login', { form: { pin: '7319' } });
    const ownerCookie = String(ownerLogin.cookie).split(';')[0];
    assert(ownerLogin.status === 302 && ownerCookie.includes('woa_session='), 'The owner must be able to enter the review workflow.');
    const link = await request(server, 'POST', '/api/onboarding/links', { cookie: ownerCookie, json: { applicationId, paymentProvider: 'stripe' } });
    assert(link.status === 201 && link.json.onboarding.paymentProvider === 'stripe' && link.json.onboarding.identityProvider === 'stripe', 'Admin approval must lock both Stripe payments and Stripe Identity for the file.');
    const onboardingId = link.json.onboarding.id;
    const token = link.json.onboarding.url.split('/onboard/')[1];
    const pickupDate = nextPickupDate();

    const profile = await request(server, 'POST', '/api/public/onboarding/' + token + '/profile', { json: {
      address: applicant.address,
      city: applicant.city,
      state: applicant.state,
      postalCode: applicant.postalCode,
      driverLicenseId: applicant.driverLicenseId,
      driverLicenseExpires: applicant.driverLicenseExpires,
      insuranceProvider: 'Lifecycle Full Coverage Insurance',
      insurancePolicyNumber: 'FULL-COVERAGE-918',
      requestedPickupDate: pickupDate,
      requestedPickupTime: '1:00 PM',
      pickupAutopayConsent: true
    } });
    assert(profile.status === 200, 'Profile, insurance details, pickup date, and pickup-anchored autopay consent must save together.');
    const image = pngDataUrl();
    const documents = await request(server, 'POST', '/api/public/onboarding/' + token + '/documents', { json: { documents: [
      { kind: 'driver_license_front', name: 'license-front.png', type: 'image/png', dataUrl: image },
      { kind: 'driver_license_back', name: 'license-back.png', type: 'image/png', dataUrl: image },
      { kind: 'identity_selfie', name: 'identity-selfie.png', type: 'image/png', dataUrl: image },
      { kind: 'insurance', name: 'insurance-full-coverage.png', type: 'image/png', dataUrl: image }
    ] } });
    assert(documents.status === 201 && documents.json.documents.length === 4, 'License front/back, selfie, and insurance proof must persist in the private customer file.');

    const identity = await request(server, 'POST', '/api/public/onboarding/' + token + '/identity', { json: {} });
    assert(identity.status === 201 && identity.json.redirectUrl === 'https://verify.stripe.test/vs_test_lifecycle', 'The customer must receive the provider-hosted Stripe Identity page.');
    const identityEvent = { id: 'evt_test_identity_verified', type: 'identity.verification_session.verified', data: { object: { id: 'vs_test_lifecycle', object: 'identity.verification_session', status: 'verified', livemode: false, metadata: { onboardingSessionId: onboardingId, applicationId } } } };
    const identityRaw = JSON.stringify(identityEvent);
    const identityWebhook = await request(server, 'POST', '/api/webhooks/stripe', { raw: identityRaw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, identityRaw) } });
    assert(identityWebhook.status === 200 && identityWebhook.json.identitySessionId === onboardingId, 'Only the signed Stripe Identity result may unlock staff review.');
    const identityEvidenceState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    const identityEvidence = identityEvidenceState.integrations && identityEvidenceState.integrations.stripe || {};
    assert(identityEvidence.lastIdentityWebhookEventId === identityEvent.id && identityEvidence.lastIdentityWebhookLivemode === false, 'A signed Stripe Identity result must retain server-only identity-proof evidence while test-mode events remain distinctly non-live.');
    const documentsApproved = await request(server, 'POST', '/api/onboarding/review', { cookie: ownerCookie, json: { onboardingSessionId: onboardingId, stage: 'documents', decision: 'approve', identityConfirmed: true, notes: 'Stripe verified live license/selfie; full coverage insurance manually reviewed.' } });
    assert(documentsApproved.status === 200, 'Admin must be able to approve verified identity and manually reviewed insurance.');

    const signature = await request(server, 'POST', '/api/public/onboarding/' + token + '/signature', { json: { typedName: 'Stripe Lifecycle', electronicConsent: true, signatureMatchConsent: true, signatureData: pngDataUrl(4) } });
    assert(signature.status === 201, 'The customer must sign the immutable agreement before nonrefundable money is collected.');
    const signatureApproved = await request(server, 'POST', '/api/onboarding/review', { cookie: ownerCookie, json: { onboardingSessionId: onboardingId, stage: 'signature', decision: 'approve', signatureMatchConfirmed: true, notes: 'Signature manually matched to the driver license.' } });
    assert(signatureApproved.status === 200, 'Admin must explicitly approve the license/signature comparison.');

    const card = await request(server, 'POST', '/api/public/onboarding/' + token + '/card', { json: { autopayConsent: true } });
    assert(card.status === 201 && /\/setup-card\//.test(card.json.redirectUrl || ''), 'The signed file must open a Stripe card-on-file authorization.');
    let saved = await readSaved(dataDir);
    const cardRequest = saved.cardSetupRequests.find(row => row.onboardingSessionId === onboardingId);
    const recurring = saved.recurringPayments.find(row => row.onboardingSessionId === onboardingId);
    assert(cardRequest && recurring && recurring.nextRun === plusDays(pickupDate, 7), 'Card authorization must pre-anchor the first recurring run one week after pickup.');
    const cardCheckout = await request(server, 'POST', '/api/public/card-setup/' + cardRequest.id + '/stripe-checkout', { form: { consent: 'yes' } });
    assert(cardCheckout.status === 303 && /^https:\/\/checkout\.stripe\.test\//.test(cardCheckout.location), 'Card entry must redirect into Stripe-hosted secure fields.');
    saved = await readSaved(dataDir);
    const openedCardRequest = saved.cardSetupRequests.find(row => row.id === cardRequest.id);
    const setupEvent = { id: 'evt_test_setup_complete', type: 'checkout.session.completed', data: { object: { id: openedCardRequest.stripeCheckoutSessionId, object: 'checkout.session', mode: 'setup', status: 'complete', payment_status: 'no_payment_required', customer: 'cus_test_lifecycle', client_reference_id: cardRequest.id, setup_intent: 'seti_test_lifecycle', metadata: { flow: 'card_setup', cardSetupRequestId: cardRequest.id, recurringPaymentId: recurring.id, applicationId, onboardingSessionId: onboardingId, customerName: 'Stripe Lifecycle', vehicleId: 'veh-stripe-life-1', vin: '1HGCV1F30JA123456', licensePlate: 'WOA-918' } } } };
    const setupRaw = JSON.stringify(setupEvent);
    const setupWebhook = await request(server, 'POST', '/api/webhooks/stripe', { raw: setupRaw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, setupRaw) } });
    assert(setupWebhook.status === 200 && setupWebhook.json.cardSetupRequestId === cardRequest.id, 'Signed Stripe setup completion must link the reusable card to the exact onboarding file.');
    saved = await readSaved(dataDir);
    const cardReadyRecurring = saved.recurringPayments.find(row => row.id === recurring.id);
    assert(cardReadyRecurring.paymentProvider === 'stripe' && cardReadyRecurring.stripeCustomerId === 'cus_test_lifecycle' && cardReadyRecurring.stripePaymentMethodId === 'pm_test_lifecycle' && cardReadyRecurring.stripeCardLast4 === '4242', 'WheelsonAuto must retain only Stripe customer/payment-method references and safe card display data.');
    assert(!JSON.stringify(saved).includes('4242424242424242'), 'WheelsonAuto must never store a full card number.');

    async function payOnboarding(kind, intentId, eventId) {
      const checkout = await request(server, 'POST', '/api/public/onboarding/' + token + '/payment', { json: { paymentType: kind } });
      assert([200, 201].includes(checkout.status) && checkout.json.paymentRequest && checkout.json.redirectUrl, kind + ' must create a separate Stripe Checkout session.');
      const paymentRequest = checkout.json.paymentRequest;
      const event = { id: eventId, type: 'checkout.session.completed', data: { object: { id: 'cs_test_payment_' + paymentRequest.id, object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', customer: 'cus_test_lifecycle', client_reference_id: paymentRequest.id, payment_intent: intentId, created: Math.floor(Date.now() / 1000), metadata: { flow: 'payment', paymentRequestId: paymentRequest.id, recurringPaymentId: recurring.id, applicationId, onboardingSessionId: onboardingId, customerName: 'Stripe Lifecycle', vehicleId: 'veh-stripe-life-1', vin: '1HGCV1F30JA123456', licensePlate: 'WOA-918' } } } };
      const raw = JSON.stringify(event);
      const webhook = await request(server, 'POST', '/api/webhooks/stripe', { raw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, raw) } });
      assert(webhook.status === 200 && webhook.json.paymentRequestId === paymentRequest.id, kind + ' must settle only from a signed Stripe webhook.');
      return { paymentRequest, event, raw };
    }

    const deposit = await payOnboarding('deposit', 'pi_test_deposit', 'evt_test_deposit_paid');
    saved = await readSaved(dataDir);
    assert(saved.payments.filter(row => row.onboardingSessionId === onboardingId).length === 1 && saved.documents.filter(row => row.onboardingSessionId === onboardingId && row.kind === 'Receipt').length === 1, 'The deposit must remain one distinct transaction and one distinct receipt.');
    assert(!saved.pickupAppointments.some(row => row.onboardingSessionId === onboardingId), 'Deposit alone must never confirm pickup.');
    const firstWeek = await payOnboarding('first_week', 'pi_test_first_week', 'evt_test_first_week_paid');
    saved = await readSaved(dataDir);
    const payments = saved.payments.filter(row => row.onboardingSessionId === onboardingId);
    const receipts = saved.documents.filter(row => row.onboardingSessionId === onboardingId && row.kind === 'Receipt');
    const appointment = saved.pickupAppointments.find(row => row.onboardingSessionId === onboardingId);
    const scheduledRecurring = saved.recurringPayments.find(row => row.id === recurring.id);
    assert(payments.length === 2 && new Set(payments.map(row => row.paymentType)).size === 2, 'Deposit and first week must be separate named Stripe transactions.');
    assert(receipts.length === 2 && receipts.every(row => row.customer === 'Stripe Lifecycle' && row.vin === '1HGCV1F30JA123456' && row.licensePlate === 'WOA-918'), 'Both receipts must carry the exact customer, vehicle, VIN, and tag.');
    assert(appointment && appointment.date === pickupDate && appointment.autopayAnchorDate === pickupDate, 'Both verified payments must confirm the requested pickup exactly once.');
    assert(scheduledRecurring.nextRun === plusDays(pickupDate, 7) && scheduledRecurring.autopayAnchorDate === pickupDate && scheduledRecurring.paymentDay === appointment.weekday, 'Weekly autopay must begin one week after pickup and stay on the pickup weekday.');

    const handoff = await request(server, 'POST', '/api/pickups/' + appointment.id + '/complete', { cookie: ownerCookie, json: { confirmed: true, mileage: 68510, notes: 'Keys and vehicle delivered after identity check.' } });
    assert(handoff.status === 200 && handoff.json.vehicle.status === 'Rented' && handoff.json.recurring.status === 'Active', 'Physical handoff must activate the vehicle, customer file, contract, and Stripe autopay together.');
    const duplicateHandoff = await request(server, 'POST', '/api/pickups/' + appointment.id + '/complete', { cookie: ownerCookie, json: { confirmed: true, mileage: 68510 } });
    assert(duplicateHandoff.status === 200 && duplicateHandoff.json.alreadyCompleted === true, 'Repeated pickup confirmation must be idempotent.');

    const portal = await request(server, 'GET', '/api/customer/portal-state', { cookie: customerCookie });
    assert(portal.status === 200 && portal.json.portal.payments.length === 2 && portal.json.portal.documents.filter(row => row.kind === 'Receipt').length === 2, 'The customer portal must immediately show both verified payments and both receipts.');
    assert(portal.json.portal.payments.every(row => row.customer === 'Stripe Lifecycle' && row.vehicleId === 'veh-stripe-life-1'), 'Customer portal money records must remain attached to the exact applicant and vehicle.');

    fakeStripe.state.disputeMetadata = {
      flow: 'payment',
      paymentRequestId: firstWeek.paymentRequest.id,
      recurringPaymentId: recurring.id,
      applicationId,
      onboardingSessionId: onboardingId,
      customerName: 'Stripe Lifecycle',
      vehicleId: 'veh-stripe-life-1',
      vin: '1HGCV1F30JA123456',
      licensePlate: 'WOA-918'
    };
    const disputeEventCreated = Math.floor(Date.now() / 1000);
    const disputeEvent = { id: 'evt_test_dispute_created', type: 'charge.dispute.created', created: disputeEventCreated, data: { object: { id: 'dp_test_first_week', object: 'dispute', amount: 22900, currency: 'usd', status: 'needs_response', reason: 'fraudulent', charge: 'ch_test_first_week', payment_intent: 'pi_test_first_week', created: disputeEventCreated, evidence_details: { due_by: disputeEventCreated + 604800 }, metadata: fakeStripe.state.disputeMetadata } } };
    const disputeRaw = JSON.stringify(disputeEvent);
    const disputed = await request(server, 'POST', '/api/webhooks/stripe', { raw: disputeRaw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, disputeRaw) } });
    assert(disputed.status === 200 && disputed.json.disputeClaimId, 'A signed Stripe dispute must create one exact matched claim.');
    saved = await readSaved(dataDir);
    const claim = saved.claims.find(row => row.stripeDisputeId === 'dp_test_first_week');
    assert(claim && claim.customer === 'Stripe Lifecycle' && claim.vehicleId === 'veh-stripe-life-1' && claim.vin === '1HGCV1F30JA123456' && claim.plate === 'WOA-918', 'The dispute must resolve to the correct customer and vehicle identity.');
    assert(claim.evidenceReadiness === 'Ready for owner review' && claim.evidencePacket.missing.length === 0, 'The completed lifecycle must produce a complete owner-review dispute packet. Missing: ' + (claim && claim.evidencePacket && claim.evidencePacket.missing || []).join(', '));
    assert(claim.evidencePacket.contractId && claim.evidencePacket.signatureId && claim.evidencePacket.pickupAppointmentId && claim.evidencePacket.priorPaymentIds.length === 1, 'Dispute evidence must include the agreement, e-signature, physical pickup, and prior deposit payment.');

    const closedDisputeEvent = { id: 'evt_test_dispute_closed', type: 'charge.dispute.closed', created: disputeEventCreated + 120, data: { object: { ...disputeEvent.data.object, status: 'won' } } };
    const closedDisputeRaw = JSON.stringify(closedDisputeEvent);
    const closedDispute = await request(server, 'POST', '/api/webhooks/stripe', { raw: closedDisputeRaw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, closedDisputeRaw) } });
    assert(closedDispute.status === 200 && closedDispute.json.stripeDisputeIgnored === false, 'A newer signed closed-dispute event must settle the existing claim.');
    const staleDisputeEvent = { id: 'evt_test_dispute_stale', type: 'charge.dispute.updated', created: disputeEventCreated + 60, data: { object: { ...disputeEvent.data.object, status: 'under_review' } } };
    const staleDisputeRaw = JSON.stringify(staleDisputeEvent);
    const staleDispute = await request(server, 'POST', '/api/webhooks/stripe', { raw: staleDisputeRaw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, staleDisputeRaw) } });
    assert(staleDispute.status === 200 && staleDispute.json.stripeDisputeIgnored === true, 'An older Stripe dispute event must be acknowledged without reopening a closed claim.');
    saved = await readSaved(dataDir);
    const settledClaim = saved.claims.find(row => row.stripeDisputeId === 'dp_test_first_week');
    assert(settledClaim.status === 'Won' && settledClaim.disputeWorkflowStatus === 'Won', 'A delayed Stripe dispute update must never downgrade the final won status.');
    assert(settledClaim.lastIgnoredStripeWebhookEventId === staleDisputeEvent.id && settledClaim.evidencePacket.missing.length === 0, 'Ignored dispute delivery must remain auditable without damaging the complete evidence packet.');

    const duplicateDispute = await request(server, 'POST', '/api/webhooks/stripe', { raw: disputeRaw, headers: { 'content-type': 'application/json', 'stripe-signature': stripeSignature(webhookSecret, disputeRaw) } });
    assert(duplicateDispute.status === 200 && duplicateDispute.json.duplicate === true, 'Repeated Stripe events must be idempotent.');
    const final = await readSaved(dataDir);
    assert(final.claims.filter(row => row.stripeDisputeId === 'dp_test_first_week').length === 1, 'Repeated dispute webhooks must never duplicate claims.');
    assert(final.payments.find(row => row.paymentRequestId === firstWeek.paymentRequest.id).stripePaymentIntentId === 'pi_test_first_week', 'Verified Stripe transactions must retain their explicit PaymentIntent identity for reconciliation and disputes.');
    assert(!JSON.stringify(final).includes(applicant.password), 'No plaintext customer password may survive the complete lifecycle.');

    console.log('Full Stripe onboarding lifecycle passed: listing, application/login, private identity and insurance, approvals, e-sign, reusable card, separate deposit/first week, pickup-anchored autopay, handoff, portal receipts, and complete dispute evidence are connected.');
  } finally {
    global.fetch = originalFetch;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
