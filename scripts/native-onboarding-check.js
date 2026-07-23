const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const onboardingService = require('../onboarding-service');
const nativeSite = require('../native-site');

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
    host: '127.0.0.1:4181',
    'x-forwarded-host': '127.0.0.1:4181',
    'x-forwarded-proto': 'http',
    'user-agent': 'WheelsonAuto native onboarding regression test',
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
    const date = new Date(dateKey(offset) + 'T12:00:00');
    if (date.getDay() !== 0) return dateKey(offset);
  }
  throw new Error('Could not find a pickup day in the next seven days.');
}

function nextSunday() {
  for (let offset = 1; offset <= 7; offset += 1) {
    const date = new Date(dateKey(offset) + 'T12:00:00');
    if (date.getDay() === 0) return dateKey(offset);
  }
  throw new Error('Could not find Sunday in the next seven days.');
}

function plusDays(value, days) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function pngDataUrl() {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return 'data:image/png;base64,' + Buffer.concat([header, Buffer.alloc(256, 1)]).toString('base64');
}

function cloverSignature(secret, rawBody) {
  const timestamp = Math.floor(Date.now() / 1000);
  const value = crypto.createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex');
  return 't=' + timestamp + ',v1=' + value;
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-native-onboarding-'));
  const nativeCss = await fs.readFile(path.join(__dirname, '..', 'native-site.css'), 'utf8');
  const nativeSiteClient = await fs.readFile(path.join(__dirname, '..', 'native-site-client.js'), 'utf8');
  assert(nativeCss.includes('[hidden]{display:none!important}'), 'Hidden selfie preview and camera controls must stay invisible until the live-camera flow reveals them.');
  assert(nativeCss.includes('.selfie-browser-help') && nativeCss.includes('.selfie-browser-help>div'), 'Camera recovery guidance must remain compact and responsive.');
  assert(nativeSiteClient.includes("name === 'NotAllowedError'") && nativeSiteClient.includes("name === 'NotFoundError'") && nativeSiteClient.includes("name === 'NotReadableError'"), 'Live-camera failures must distinguish permission, missing-device, and busy-camera errors.');
  assert(nativeSiteClient.includes('navigator.share') && nativeSiteClient.includes('navigator.clipboard.writeText(window.location.href)'), 'A blocked embedded browser must let the customer securely share or copy the same saved onboarding link.');
  assert(nativeSiteClient.includes("name !== 'OverconstrainedError'") && nativeSiteClient.includes("getUserMedia({ video:true, audio:false })"), 'Unsupported ideal camera constraints must retry with a compatible secure camera request.');
  assert(onboardingService.applicationBlocksOnboarding({ status: 'Denied - archived', stage: 'Denied' }), 'Denied applications must block every onboarding surface.');
  assert(onboardingService.applicationBlocksOnboarding({ status: 'Archived', stage: 'History' }), 'Archived applications must require a fresh approval and secure link.');
  assert(!onboardingService.applicationBlocksOnboarding({ status: 'Customer setup in progress', stage: 'Onboarding' }), 'An active approved onboarding application must remain available.');
  assert(/@media\(max-width:980px\)[^{]*\{[^}]*[\s\S]*?\.onboarding-progress\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(nativeCss), 'Tablet and phone onboarding milestones must use a compact grid instead of a horizontal scroller.');
  const webhookSecret = 'native-onboarding-hco-secret';
  process.env.TZ = 'America/New_York';
  process.env.DATA_DIR = dataDir;
  process.env.WOA_ADMIN_PIN = '7319';
  process.env.WOA_ADMIN_USERNAME = 'owner';
  process.env.WOA_ADMIN_PASSWORD = 'NativeOnboardingOwner123!';
  process.env.WOA_SESSION_SECRET = 'native-onboarding-session-secret';
  process.env.CLOVER_WEBHOOK_SECRET = webhookSecret;
  process.env.CLOVER_HCO_WEBHOOK_SECRET = webhookSecret;
  process.env.CLOVER_MERCHANT_ID = 'KJ7PNEZR6QVP1';
  process.env.WOA_PAYMENT_PROVIDER = 'clover';
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.WOA_EMAIL_ENABLED = '0';
  process.env.WOA_MESSAGING_ENABLED = '0';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:4181';
  const localTimeZone = process.env.TZ;
  process.env.TZ = 'UTC';
  assert(nativeSite.localDateKey(new Date('2026-07-15T23:30:00-04:00')) === '2026-07-15', 'Pickup date bounds must use New Jersey local calendar dates instead of shifting through UTC after evening hours.');
  assert(onboardingService.pickupWindow({ minimumPickupDays: 1, maximumVehicleHoldDays: 7 }, '2026-07-22', new Date('2026-07-22T03:30:00Z')).ok, 'Backend pickup validation must still accept the next New Jersey business day after UTC has crossed midnight.');
  process.env.TZ = localTimeZone;
  const stripeStatusFixture = {
    documents: [
      { applicationId: 'app-stripe-state', onboardingSessionId: 'session-stripe-state', documentKind: 'driver_license_front' },
      { applicationId: 'app-stripe-state', onboardingSessionId: 'session-stripe-state', documentKind: 'driver_license_back' },
      { applicationId: 'app-stripe-state', onboardingSessionId: 'session-stripe-state', documentKind: 'identity_selfie' },
      { applicationId: 'app-stripe-state', onboardingSessionId: 'session-stripe-state', documentKind: 'insurance' }
    ],
    recurringPayments: [{ applicationId: 'app-stripe-state', onboardingSessionId: 'session-stripe-state', paymentProvider: 'stripe', cloverPaymentSource: 'clv_should_not_unlock_stripe', status: 'Active' }],
    paymentRequests: []
  };
  const stripeStateWithoutStripeCard = nativeSite.onboardingStatus(stripeStatusFixture, { id: 'session-stripe-state', paymentProvider: 'stripe', documentReviewStatus: 'Waiting on staff' }, { id: 'app-stripe-state', pricingSnapshot: {} });
  assert(stripeStateWithoutStripeCard.documents && !stripeStateWithoutStripeCard.card && stripeStateWithoutStripeCard.paymentProvider === 'stripe', 'Stripe onboarding must require the selfie and must not accept a Clover card source as Stripe-ready.');
  stripeStatusFixture.recurringPayments[0].stripeCustomerId = 'cus_stripe_state';
  stripeStatusFixture.recurringPayments[0].stripePaymentMethodId = 'pm_stripe_state';
  stripeStatusFixture.recurringPayments[0].stripeLivemode = true;
  assert(nativeSite.onboardingStatus(stripeStatusFixture, { id: 'session-stripe-state', paymentProvider: 'stripe' }, { id: 'app-stripe-state', pricingSnapshot: {} }).card, 'Stripe onboarding should unlock only after live-mode customer and payment-method references are saved.');

  const initial = {
    business: { name: 'WheelsonAuto' },
    vehicles: [{ id: 'veh-native-1', year: '2016', make: 'Ford', model: 'Focus', vin: '1FADP3K24GL123456', plate: 'A19-WWM', status: 'Ready', organizationId: 'org-wheelsonauto' }],
    onlineVehicles: [{ id: 'online-native-1', platformVehicleId: 'veh-native-1', title: '2016 Ford Focus', slug: '2016-ford-focus', year: '2016', make: 'Ford', model: 'Focus', vin: '1FADP3K24GL123456', plate: 'A19-WWM', weeklyPayment: 229, downPayment: 485, contractMonths: 18, availability: 'Available', published: true, organizationId: 'org-wheelsonauto' }],
    applications: [], websiteLeads: [], customers: [], contracts: [], payments: [], paymentRequests: [], cardSetupRequests: [], recurringPayments: [], maintenance: [], claims: [], messages: [], tasks: [], documents: [], eSignatures: [], onboardingSessions: [], pickupAppointments: [], contractTemplates: [], customerAccounts: [], staffAccounts: [], dailyCloseouts: [], auditLogs: [], apiProviders: [], organizations: [{ id: 'org-wheelsonauto', name: 'WheelsonAuto', status: 'Active' }], integrations: { clover: {}, messaging: {} }, publicSite: { defaultWeeklyPayment: 229, defaultDownPayment: 485, minimumPickupDays: 1, maximumVehicleHoldDays: 7, pickupSlotMinutes: 30, pickupCapacity: 1 }
  };
  await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(initial, null, 2));

  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');
  try {
    const preview = await request(server, 'GET', '/site-preview');
    assert(preview.status === 200 && /2016 Ford Focus/.test(preview.text), 'Public preview should render only the native published vehicle.');
    assert(/<b>19 months<\/b>/.test(preview.text) && !/<b>18 months<\/b>/.test(preview.text), 'Public purchase-eligibility copy should use the canonical 19-month term even when an older vehicle record still says 18.');
    assert(/name="robots" content="noindex,nofollow"/.test(preview.text) && /class="site-brand" href="\/site-preview"/.test(preview.text), 'Render preview should stay out of search results and keep preview navigation inside the public preview.');
    const applicationPage = await request(server, 'GET', '/apply/2016-ford-focus');
    assert(applicationPage.status === 200 && /Insurance required before vehicle release/.test(applicationPage.text) && /name="insurancePickupConsent"/.test(applicationPage.text) && /active full-coverage insurance for the assigned vehicle and VIN/.test(applicationPage.text), 'Customers must see and acknowledge the full-coverage requirement before submitting an application.');

    const applicationPayload = {
      onlineVehicleId: 'online-native-1', firstName: 'Native', lastName: 'Applicant', phone: '8565550107', email: 'native.applicant@example.com', address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', dateOfBirth: '1990-04-20', driverLicenseId: 'N12345678901234', driverLicenseExpires: '2030-04-20', employer: 'WheelsonAuto Test', income: 5000, password: 'NativeTest123', applicationConsent: true, insurancePickupConsent: true
    };
    const applicationResponse = await request(server, 'POST', '/api/public/applications', { json: applicationPayload });
    assert(applicationResponse.status === 201 && applicationResponse.json && applicationResponse.json.application.id && /\/onboard\//.test(applicationResponse.json.onboardingUrl || ''), 'Published vehicle application should be accepted and immediately create its secure setup.');
    const applicationId = applicationResponse.json.application.id;
    let saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    const savedApplication = saved.applications.find(row => row.id === applicationId);
    const pendingCustomerAccount = saved.customerAccounts.find(row => row.applicationId === applicationId);
    const savedSession = saved.onboardingSessions.find(row => row.applicationId === applicationId);
    const onboardingId = savedSession.id;
    const token = applicationResponse.json.onboardingUrl.split('/onboard/')[1];
    savedApplication.requestedPickupDate = nextPickupDate();
    savedApplication.requestedPickupTime = '1:00 PM';
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    assert(savedApplication && pendingCustomerAccount && /^pbkdf2\$/.test(pendingCustomerAccount.passwordHash || '') && !savedApplication.pendingPasswordHash, 'A successful application should immediately create a PBKDF2-backed customer portal login without duplicating password secrets.');
    assert(!JSON.stringify(saved).includes('NativeTest123'), 'Plaintext customer password must never be persisted.');
    const customerEmailLogin = await request(server, 'POST', '/customer/login', { form: { username: applicationPayload.email, password: applicationPayload.password } });
    assert(customerEmailLogin.status === 302 && String(customerEmailLogin.cookie).includes('woa_customer_session='), 'New applicant should be able to log in immediately with email and the application password.');
    const customerPhoneLogin = await request(server, 'POST', '/customer/login', { form: { username: '(856) 555-0107', password: applicationPayload.password } });
    assert(customerPhoneLogin.status === 302 && String(customerPhoneLogin.cookie).includes('woa_customer_session='), 'New applicant should be able to log in with a formatted application phone number.');
    const customerPortal = await request(server, 'GET', '/customer', { cookie: String(customerEmailLogin.cookie).split(';')[0] });
    assert(customerPortal.status === 200 && /setup|onboarding/i.test(customerPortal.text) && /2016 Ford Focus/.test(customerPortal.text), 'Pending applicant portal should show the active setup status and selected vehicle.');

    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    saved.applications.unshift({
      id: 'app-legacy-pending-login', organizationId: 'org-wheelsonauto', name: 'Legacy Applicant', phone: '8565550199', email: 'legacy.applicant@example.com', onlineVehicleId: 'online-native-1', vehicleId: 'veh-native-1', vehicle: '2016 Ford Focus', status: 'New - staff review', stage: 'New', pendingPasswordHash: pendingCustomerAccount.passwordHash, pendingPasswordSalt: pendingCustomerAccount.passwordSalt, pendingPasswordUpdatedAt: pendingCustomerAccount.passwordUpdatedAt
    });
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    const legacyCustomerLogin = await request(server, 'POST', '/customer/login', { form: { username: '856-555-0199', password: applicationPayload.password } });
    assert(legacyCustomerLogin.status === 302 && String(legacyCustomerLogin.cookie).includes('woa_customer_session='), 'Applications saved before immediate portal activation should self-repair on the first correct login.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(saved.customerAccounts.some(row => row.applicationId === 'app-legacy-pending-login') && !saved.applications.find(row => row.id === 'app-legacy-pending-login').pendingPasswordHash, 'Legacy pending login migration should move the password hash into one customer account and remove the application copy.');

    const login = await request(server, 'POST', '/login', { form: { username: 'owner', password: 'NativeOnboardingOwner123!' } });
    assert(login.status === 302 && String(login.cookie).includes('woa_session='), 'Owner login should provide a signed staff session.');
    const ownerCookie = String(login.cookie).split(';')[0];
    const onboardingPage = await request(server, 'GET', '/onboard/' + token);
    assert(onboardingPage.status === 200 && /<option value="11:30 AM">11:30 AM<\/option>/.test(onboardingPage.text) && /<option value="4:30 PM">4:30 PM<\/option>/.test(onboardingPage.text), 'Thirty-minute pickup settings should render every valid appointment start through 4:30 PM.');
    assert(new RegExp('name="requestedPickupDate"[^>]+value="' + savedApplication.requestedPickupDate + '"').test(onboardingPage.text) && /<option value="1:00 PM" selected>1:00 PM<\/option>/.test(onboardingPage.text), 'Onboarding should prefill the original pickup request without marking the customer profile complete.');
    assert(/data-profile-validation/.test(onboardingPage.text) && /data-field-error="driverLicenseId"/.test(onboardingPage.text) && /autocomplete="street-address"/.test(onboardingPage.text) && onboardingPage.text.includes('/native-site-client.js?v=' + nativeSite.NATIVE_SITE_ASSET_VERSION) && onboardingPage.text.includes('/native-site.css?v=' + nativeSite.NATIVE_SITE_ASSET_VERSION), 'Profile onboarding should expose and freshly load inline customer-side validation before a server rejection.');
    assert(/submit\.disabled = !!names\.length/.test(nativeSiteClient) && /submit\.setAttribute\('aria-disabled'/.test(nativeSiteClient), 'The profile save control must stay disabled until license, pickup, expiration, and autopay-consent checks are complete.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(savedSession && savedSession.tokenHash && !savedSession.publicToken, 'Onboarding session should persist only a token hash.');
    assert(saved.onlineVehicles[0].published === false && saved.onlineVehicles[0].heldApplicationId === applicationId, 'Application submission should immediately unpublish and hold the selected car.');
    assert(saved.vehicles.find(row => row.id === 'veh-native-1').status === 'Pending customer setup' && saved.vehicles.find(row => row.id === 'veh-native-1').heldApplicationId === applicationId, 'Application submission should immediately remove the selected internal car from ready fleet inventory.');

    saved.applications.unshift({ id: 'app-competing', organizationId: 'org-wheelsonauto', name: 'Second Applicant', onlineVehicleId: 'online-native-1', vehicle: '2016 Ford Focus', status: 'New' });
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    const competing = await request(server, 'POST', '/api/onboarding/links', { cookie: ownerCookie, json: { applicationId: 'app-competing' } });
    assert(competing.status === 409, 'A second applicant must not receive an active onboarding hold for the same car.');
    const unavailableApplication = await request(server, 'POST', '/api/public/applications', { json: { ...applicationPayload, email: 'second@example.com' } });
    assert(unavailableApplication.status === 409, 'Held/unpublished vehicle must stop accepting new public applications.');

    const expiredHold = JSON.parse(JSON.stringify(saved));
    expiredHold.onboardingSessions.find(row => row.id === onboardingId).expiresAt = new Date(Date.now() - 60000).toISOString();
    const expiredResult = onboardingService.releaseExpiredHolds(expiredHold, Date.now());
    assert(expiredResult.released === 1 && expiredHold.onlineVehicles[0].published === true && expiredHold.vehicles[0].status === 'Ready', 'Expired seven-day onboarding holds should automatically return the car to ready published inventory.');

    const sundayProfile = await request(server, 'POST', '/api/public/onboarding/' + token + '/profile', { json: { address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', driverLicenseId: 'N12345678901234', driverLicenseExpires: '2030-04-20', insuranceProvider: 'Test Insurance', insurancePolicyNumber: 'POLICY-100', requestedPickupDate: nextSunday(), requestedPickupTime: '1:00 PM', pickupAutopayConsent: true } });
    assert(sundayProfile.status === 400 && /Sunday/i.test(sundayProfile.json.error), 'Sunday pickup should be rejected server-side.');
    const tooLateProfile = await request(server, 'POST', '/api/public/onboarding/' + token + '/profile', { json: { address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', driverLicenseId: 'N12345678901234', driverLicenseExpires: '2030-04-20', insuranceProvider: 'Test Insurance', insurancePolicyNumber: 'POLICY-100', requestedPickupDate: dateKey(8), requestedPickupTime: '1:00 PM', pickupAutopayConsent: true } });
    assert(tooLateProfile.status === 400 && /seven days/i.test(tooLateProfile.json.error), 'Specific-car pickup must not be scheduled more than seven days out.');
    const pickupDate = nextPickupDate();
    const incompleteLicense = await request(server, 'POST', '/api/public/onboarding/' + token + '/profile', { json: { address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', driverLicenseId: '66', driverLicenseExpires: '2030-04-20', insuranceProvider: 'Test Insurance', insurancePolicyNumber: 'POLICY-100', requestedPickupDate: pickupDate, requestedPickupTime: '1:00 PM', pickupAutopayConsent: true } });
    assert(incompleteLicense.status === 400 && /complete driver license number/i.test(incompleteLicense.json.error), 'An obviously incomplete driver license number must not unlock document upload or contract creation.');
    const expiredLicense = await request(server, 'POST', '/api/public/onboarding/' + token + '/profile', { json: { address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', driverLicenseId: 'N12345678901234', driverLicenseExpires: '2020-04-20', insuranceProvider: 'Test Insurance', insurancePolicyNumber: 'POLICY-100', requestedPickupDate: pickupDate, requestedPickupTime: '1:00 PM', pickupAutopayConsent: true } });
    assert(expiredLicense.status === 400 && /valid through the requested pickup date/i.test(expiredLicense.json.error), 'An expired driver license must not unlock document upload or contract creation.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    saved.pickupAppointments.unshift({ id: 'pickup-existing-full-slot', organizationId: 'org-wheelsonauto', customer: 'Existing Pickup', date: pickupDate, time: '11:30 AM', status: 'Confirmed' });
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    const availability = await request(server, 'GET', '/api/public/onboarding/' + token + '/pickup-availability?date=' + pickupDate);
    const fullSlot = availability.json && availability.json.slots.find(slot => slot.time === '11:30 AM');
    assert(availability.status === 200 && availability.json.slotMinutes === 30 && fullSlot && fullSlot.available === false && fullSlot.remaining === 0, 'Pickup availability should mark a capacity-one occupied slot as full before the customer submits it.');
    const fullProfile = await request(server, 'POST', '/api/public/onboarding/' + token + '/profile', { json: { address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', driverLicenseId: 'N12345678901234', driverLicenseExpires: '2030-04-20', insuranceProvider: 'Test Insurance', insurancePolicyNumber: 'POLICY-100', requestedPickupDate: pickupDate, requestedPickupTime: '11:30 AM', pickupAutopayConsent: true } });
    assert(fullProfile.status === 409 && /full/i.test(fullProfile.json.error), 'A slot that fills before submission must be rejected before documents, signing, or payment.');
    const forgedTime = await request(server, 'POST', '/api/public/onboarding/' + token + '/profile', { json: { address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', driverLicenseId: 'N12345678901234', driverLicenseExpires: '2030-04-20', insuranceProvider: 'Test Insurance', insurancePolicyNumber: 'POLICY-100', requestedPickupDate: pickupDate, requestedPickupTime: '5:00 PM', pickupAutopayConsent: true } });
    assert(forgedTime.status === 400 && /business hours/i.test(forgedTime.json.error), 'A forged appointment start at closing time must be rejected server-side.');
    const profile = await request(server, 'POST', '/api/public/onboarding/' + token + '/profile', { json: { address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', driverLicenseId: 'N12345678901234', driverLicenseExpires: '2030-04-20', insuranceProvider: 'Test Insurance', insurancePolicyNumber: 'POLICY-100', requestedPickupDate: pickupDate, requestedPickupTime: '1:00 PM', pickupAutopayConsent: true } });
    assert(profile.status === 200, 'Valid next-day-to-seven-day pickup profile should save.');
    const documentStepPage = await request(server, 'GET', '/onboard/' + token);
    assert(documentStepPage.status === 200 && /data-selfie-browser-help/.test(documentStepPage.text) && /data-selfie-share/.test(documentStepPage.text) && /data-selfie-copy/.test(documentStepPage.text), 'The unlocked live-selfie step must provide secure camera-browser recovery controls.');
    assert(!/name="identity_selfie"[^>]+type="file"/.test(documentStepPage.text), 'Camera recovery must not weaken the live-selfie requirement into a gallery file upload.');
    const reservedAvailability = await request(server, 'GET', '/api/public/onboarding/' + token + '/pickup-availability?date=' + pickupDate);
    assert(reservedAvailability.status === 200 && reservedAvailability.json.slots.find(slot => slot.time === '1:00 PM').available === true, 'A customer revisiting their own onboarding link must not be blocked by their own reserved slot.');

    const image = pngDataUrl();
    const documents = await request(server, 'POST', '/api/public/onboarding/' + token + '/documents', { json: { documents: [
      { kind: 'driver_license_front', name: 'license-front.png', type: 'image/png', dataUrl: image },
      { kind: 'driver_license_back', name: 'license-back.png', type: 'image/png', dataUrl: image },
      { kind: 'identity_selfie', name: 'live-selfie-with-license.png', type: 'image/png', dataUrl: image }
    ] } });
    assert(documents.status === 201 && documents.json.documents.length === 3, 'License front/back and the live selfie with license should save as the preliminary private screening files.');
    const signature = await request(server, 'POST', '/api/public/onboarding/' + token + '/signature', { json: { typedName: 'Native Applicant', electronicConsent: true, signatureMatchConsent: true, signatureData: image } });
    assert(signature.status === 201, 'Customer should be able to sign the exact versioned agreement immediately after the screening files are complete.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    const signedAgreement = saved.eSignatures.find(row => row.onboardingSessionId === onboardingId);
    const signedContractDocument = saved.documents.find(row => row.onboardingSessionId === onboardingId && row.documentKind === 'signed_contract');
    assert(signedAgreement && /nineteen \(19\) consecutive months/i.test(signedAgreement.contractBody || ''), 'New signed agreements should lock the corrected 19-month optional-purchase term.');
    assert(signedAgreement && Number(signedAgreement.pricingSnapshot && signedAgreement.pricingSnapshot.contractMonths) === 19, 'The immutable pricing snapshot should store the canonical 19-month term.');
    assert(signedContractDocument && signedAgreement.contractDocumentId === signedContractDocument.id && signedContractDocument.customerVisible === true && signedContractDocument.customerAccountId === pendingCustomerAccount.id, 'Signing must atomically add a private immutable contract artifact linked to the e-signature and customer portal account.');
    const customerContractDownload = await request(server, 'GET', '/customer/documents/' + encodeURIComponent(signedContractDocument.id), { cookie: String(customerEmailLogin.cookie).split(';')[0] });
    assert(customerContractDownload.status === 200 && /WHEELSONAUTO SIGNED AGREEMENT/.test(customerContractDownload.text) && /nineteen \(19\) consecutive months/i.test(customerContractDownload.text) && /END OF SIGNED AGREEMENT/.test(customerContractDownload.text), 'The signed-in customer must be able to open only their own complete signed-agreement artifact.');
    const foreignContractDownload = await request(server, 'GET', '/customer/documents/' + encodeURIComponent(signedContractDocument.id), { cookie: String(legacyCustomerLogin.cookie).split(';')[0] });
    assert(foreignContractDownload.status === 404, 'A different signed-in customer must not be able to open another customer\'s signed contract artifact.');
    const card = await request(server, 'POST', '/api/public/onboarding/' + token + '/card', { json: { autopayConsent: true } });
    assert(card.status === 201 && /\/setup-card\//.test(card.json.redirectUrl || ''), 'Signed customer should receive a no-charge Clover card-on-file setup step with explicit autopay consent.');

    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    const session = saved.onboardingSessions.find(row => row.id === onboardingId);
    const recurring = saved.recurringPayments.find(row => row.onboardingSessionId === onboardingId || row.applicationId === applicationId);
    assert(recurring && recurring.nextRun === plusDays(pickupDate, 7), 'Card setup should prepare the first automatic charge for one week after pickup.');
    recurring.cloverPaymentSource = 'clv_test_saved_source';
    recurring.paymentSetup = 'Card saved for WheelsonAuto charges';
    recurring.status = 'Active';
    session.cardCompletedAt = new Date().toISOString();
    session.status = 'Card linked';
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    const finalReview = await request(server, 'POST', '/api/onboarding/review', { cookie: ownerCookie, json: { onboardingSessionId: onboardingId, stage: 'final', decision: 'approve', identityConfirmed: true, signatureMatchConfirmed: true, vehicleConfirmed: true, cardConfirmed: true, notes: 'One combined screening review passed before payment.' } });
    assert(finalReview.status === 200 && finalReview.json.finalReviewStatus === 'Approved', 'Owner should give one final decision only after the screening files, agreement, exact vehicle/VIN, and saved card are ready.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    const approvedSession = saved.onboardingSessions.find(row => row.id === onboardingId);
    const approvedRecurring = saved.recurringPayments.find(row => row.id === recurring.id);
    const paymentBase = { recurringPaymentId: recurring.id, applicationId, onboardingSessionId: onboardingId, onlineVehicleId: 'online-native-1', organizationId: 'org-wheelsonauto', customer: 'Native Applicant', phone: '8565550107', email: 'native.applicant@example.com', vehicleId: 'veh-native-1', vehicle: '2016 Ford Focus', vin: '1FADP3K24GL123456', licensePlate: 'A19-WWM', method: 'Clover Hosted Checkout', source: 'WheelsonAuto native onboarding', checkoutCreatedAt: new Date().toISOString(), onboardingReturnUrl: 'http://127.0.0.1:4181/onboard/' + token };
    saved.paymentRequests.unshift(
      { ...paymentBase, id: 'plink-native-first', amount: 229, frequency: 'First week', paymentType: 'First weekly payment', reason: 'First weekly payment', status: 'Unpaid - Clover checkout ready', checkoutSessionId: 'checkout-native-first', checkoutHref: 'https://checkout.clover.test/first', createdAt: new Date().toISOString() },
      { ...paymentBase, id: 'plink-native-deposit', amount: 485, frequency: 'One time', paymentType: 'Nonrefundable down payment', reason: 'Nonrefundable down payment', status: 'Clover checkout ready', checkoutSessionId: 'checkout-native-deposit', checkoutHref: 'https://checkout.clover.test/deposit', createdAt: new Date().toISOString() }
    );
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));

    const invalidWebhook = await request(server, 'POST', '/api/webhooks/clover', { raw: JSON.stringify({ Type: 'PAYMENT', Status: 'APPROVED', Data: 'checkout-native-deposit', Id: 'clover-payment-deposit' }), headers: { 'content-type': 'application/json', 'clover-signature': 't=1,v1=invalid' } });
    assert(invalidWebhook.status === 401, 'Unsigned or invalid Clover callbacks must not change payment state.');
    async function signedWebhook(event) {
      const raw = JSON.stringify({ MerchantId: process.env.CLOVER_MERCHANT_ID, ...event });
      return request(server, 'POST', '/api/webhooks/clover', { raw, headers: { 'content-type': 'application/json', 'clover-signature': cloverSignature(webhookSecret, raw) } });
    }
    const beforeVerificationOnly = await fs.readFile(path.join(dataDir, 'data.json'), 'utf8');
    const verificationOnlyRaw = JSON.stringify({ Type: 'TEST', Status: 'APPROVED', Message: 'Clover Hosted Checkout URL verification' });
    const verificationOnly = await request(server, 'POST', '/api/webhooks/clover?verify_only=1', { raw: verificationOnlyRaw, headers: { 'content-type': 'application/json', 'clover-signature': cloverSignature(webhookSecret, verificationOnlyRaw) } });
    const afterVerificationOnly = await fs.readFile(path.join(dataDir, 'data.json'), 'utf8');
    assert(verificationOnly.status === 200 && verificationOnly.json.verified && verificationOnly.json.dryRun && beforeVerificationOnly === afterVerificationOnly, 'Signed Clover URL verification must prove delivery without writing a fake event into business data.');
    const wrongMerchantWebhook = await signedWebhook({ Type: 'PAYMENT', Status: 'APPROVED', Data: 'checkout-native-deposit', Id: 'wrong-merchant-payment', MerchantId: 'WRONGMERCHANT' });
    assert(wrongMerchantWebhook.status === 200 && !wrongMerchantWebhook.json.hostedCheckout.matched && /merchant/i.test(wrongMerchantWebhook.json.hostedCheckout.reason || ''), 'A validly signed event for another merchant must not reconcile a WheelsonAuto payment.');
    const depositWebhook = await signedWebhook({ Type: 'PAYMENT', Status: 'APPROVED', Data: 'checkout-native-deposit', Id: 'clover-payment-deposit' });
    assert(depositWebhook.status === 200 && depositWebhook.json.hostedCheckout.approved, 'Signed Clover deposit webhook should verify the first transaction.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(saved.pickupAppointments.filter(row => row.onboardingSessionId === onboardingId).length === 0, 'Deposit alone must not confirm this customer pickup before the first weekly payment.');
    assert(saved.payments.filter(row => row.onboardingSessionId === onboardingId).length === 1, 'Deposit should create exactly one payment record.');
    assert(saved.documents.filter(row => row.onboardingSessionId === onboardingId && row.kind === 'Receipt').length === 1, 'Deposit should create its own receipt.');
    const providerNeutralDepositRequest = saved.paymentRequests.find(row => row.id === 'plink-native-deposit');
    const providerNeutralDepositPayment = saved.payments.find(row => row.paymentRequestId === 'plink-native-deposit');
    assert(providerNeutralDepositRequest.paymentProvider === 'clover' && providerNeutralDepositRequest.providerCheckoutSessionId === 'checkout-native-deposit' && providerNeutralDepositRequest.providerPaymentId === 'clover-payment-deposit', 'Legacy Clover request IDs should be mirrored into provider-neutral checkout/payment fields.');
    assert(providerNeutralDepositPayment.paymentProvider === 'clover' && providerNeutralDepositPayment.providerPaymentId === 'clover-payment-deposit', 'Verified payment history should retain provider-neutral identity for a future Stripe adapter.');

    const redirectOnly = await request(server, 'GET', '/pay/plink-native-first/success?session_id=checkout-native-first');
    assert(redirectOnly.status === 200 && /waiting for the signed provider confirmation/i.test(redirectOnly.text), 'Provider success redirect alone must not be treated as payment proof.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(!/paid|success/i.test(saved.paymentRequests.find(row => row.id === 'plink-native-first').status), 'Unverified redirect must keep the first weekly payment unpaid.');

    const firstWeekWebhook = await signedWebhook({ Type: 'PAYMENT', Status: 'APPROVED', Data: 'checkout-native-first', Id: 'clover-payment-first' });
    assert(firstWeekWebhook.status === 200 && firstWeekWebhook.json.hostedCheckout.approved, 'Signed first-week webhook should verify the second transaction.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(!saved.pickupAppointments.some(row => row.onboardingSessionId === onboardingId), 'Both payments must still leave pickup locked until the customer chooses a VIN-specific insurance path.');
    const insurance = await request(server, 'POST', '/api/public/onboarding/' + token + '/insurance', { json: { insuranceOption: 'upload', insuranceProvider: 'Test Full Coverage', insurancePolicyNumber: 'POLICY-100', insuranceVinConfirmed: true, documents: [{ kind: 'insurance', name: 'insurance.png', type: 'image/png', dataUrl: image }] } });
    assert(insurance.status === 201, 'After both payments, the customer should be able to upload insurance for the exact VIN and reserve pickup.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    let finalRecurring = saved.recurringPayments.find(row => row.id === recurring.id);
    const appointment = saved.pickupAppointments.find(row => row.onboardingSessionId === onboardingId);
    assert(appointment && appointment.date === pickupDate && appointment.autopayAnchorDate === pickupDate, 'The insurance choice should reserve the exact requested pickup once.');
    assert(finalRecurring.nextRun === plusDays(pickupDate, 7) && finalRecurring.autopayAnchorDate === pickupDate && finalRecurring.autoChargeEnabled === false, 'The weekly schedule should be prepared but must remain disabled before physical handoff.');
    assert(finalRecurring.paymentDay === appointment.weekday && finalRecurring.autopayWeekday === appointment.weekday, 'Pickup weekday and recurring weekday must stay synchronized.');
    assert(saved.payments.filter(row => row.onboardingSessionId === onboardingId).length === 2, 'Deposit and first week must remain two separate payment records.');
    assert(saved.documents.filter(row => row.onboardingSessionId === onboardingId && row.kind === 'Receipt').length === 2, 'Deposit and first week must produce separate receipts.');
    assert(saved.vehicles.find(row => row.id === 'veh-native-1').status === 'Pending pickup', 'Internal fleet car should move to pending pickup after onboarding payments and insurance selection.');
    const customerAccount = saved.customerAccounts.find(row => row.applicationId === applicationId);
    assert(customerAccount && /^pbkdf2\$/.test(customerAccount.passwordHash || '') && !customerAccount.password, 'Finalized customer account should inherit only the secure password hash.');
    assert(!JSON.stringify(saved).includes('NativeTest123'), 'Final customer data must still contain no plaintext password.');

    const handoff = await request(server, 'POST', '/api/pickups/' + appointment.id + '/complete', { cookie: ownerCookie, json: { confirmed: true, mileage: 91000, notes: 'License, keys, and active insurance checked in person.', insuranceConfirmed: true, insuranceVinConfirmed: true, insuranceProvider: 'Test Full Coverage', insurancePolicyNumber: 'POLICY-100' } });
    assert(handoff.status === 200 && handoff.json.vehicle.status === 'Rented' && handoff.json.recurring.status === 'Active', 'Only the staff insurance check and physical handoff should activate the rental and recurring card schedule.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    finalRecurring = saved.recurringPayments.find(row => row.id === recurring.id);
    assert(finalRecurring.autoChargeEnabled === true && finalRecurring.nextRun === plusDays(pickupDate, 7), 'Handoff must activate weekly autopay without changing its pickup-day anchor.');

    await signedWebhook({ Type: 'PAYMENT', Status: 'APPROVED', Data: 'checkout-native-first', Id: 'clover-payment-first' });
    await signedWebhook({ Type: 'PAYMENT', Status: 'DECLINED', Data: 'checkout-native-first', Id: 'clover-payment-first-late-decline' });
    const idempotent = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(idempotent.pickupAppointments.filter(row => row.onboardingSessionId === onboardingId).length === 1, 'Repeated Clover webhook must not duplicate the pickup appointment.');
    assert(idempotent.payments.filter(row => row.paymentRequestId === 'plink-native-first').length === 1, 'Repeated Clover webhook must not duplicate payment history.');
    assert(idempotent.documents.filter(row => row.paymentRequestId === 'plink-native-first' && row.kind === 'Receipt').length === 1, 'Repeated Clover webhook must not duplicate receipts.');
    assert(/paid/i.test(idempotent.paymentRequests.find(row => row.id === 'plink-native-first').status), 'A late duplicate decline must never downgrade an already-verified paid request.');

    console.log('Native onboarding check passed: automatic setup, live selfie screening, one final review, no-charge card setup, delayed VIN-specific insurance, signed Clover reconciliation, separate receipts, handoff, and pickup-anchored weekly autopay are connected.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
