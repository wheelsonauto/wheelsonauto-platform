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

function latestStaffedDate() {
  let candidate = dateKey(0);
  if (new Date(candidate + 'T12:00:00Z').getUTCDay() === 0) candidate = plusDays(candidate, -1);
  return candidate;
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
  process.env.WOA_DOCUMENT_STORAGE_PROVIDER = 'local';
  process.env.WOA_DOCUMENT_ENCRYPTION_KEY = crypto.createHash('sha256').update('native-onboarding-private-document-key').digest('base64');
  process.env.WOA_DOCUMENT_ENCRYPTION_KEY_VERSION = 'native-onboarding-v1';
  process.env.WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED = '1';
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
    paymentRequests: [{ applicationId: 'app-stripe-state', onboardingSessionId: 'session-stripe-state', paymentProvider: 'stripe', paymentType: 'First weekly payment', status: 'Unpaid - Stripe checkout ready' }]
  };
  const stripeStateWithoutStripeCard = nativeSite.onboardingStatus(stripeStatusFixture, { id: 'session-stripe-state', paymentProvider: 'stripe', documentReviewStatus: 'Waiting on staff' }, { id: 'app-stripe-state', pricingSnapshot: {} });
  assert(stripeStateWithoutStripeCard.documents && !stripeStateWithoutStripeCard.card && !stripeStateWithoutStripeCard.firstWeek && stripeStateWithoutStripeCard.paymentProvider === 'stripe', 'Stripe onboarding must require the selfie, reject Clover-only card state, and never treat an Unpaid request as paid.');
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
    assert(preview.headers['Permissions-Policy'] === 'camera=(), microphone=(), geolocation=()', 'Ordinary public pages must continue to deny camera, microphone, and location access.');
    assert(/<b>19 months<\/b>/.test(preview.text) && !/<b>18 months<\/b>/.test(preview.text), 'Public purchase-eligibility copy should use the canonical 19-month term even when an older vehicle record still says 18.');
    assert(/name="robots" content="noindex,nofollow"/.test(preview.text) && /class="site-brand" href="\/site-preview"/.test(preview.text), 'Render preview should stay out of search results and keep preview navigation inside the public preview.');
    const anonymousApplicationPage = await request(server, 'GET', '/apply/2016-ford-focus');
    assert(anonymousApplicationPage.status === 303 && /\/customer\/register\?next=/.test(anonymousApplicationPage.location), 'Applying must start with a customer account instead of a loose application link.');
    const registrationPage = await request(server, 'GET', anonymousApplicationPage.location);
    assert(registrationPage.status === 200 && /Create My WheelsonAuto/.test(registrationPage.text) && /one secure account before applying/i.test(registrationPage.text), 'The account-first registration page should explain where applications and rentals stay.');
    const customerPassword = 'NativeTest123';
    const registration = await request(server, 'POST', '/customer/register', { form: { next: '/apply/2016-ford-focus', name: 'Native Applicant', phone: '8565550107', email: 'native.applicant@example.com', password: customerPassword, confirmPassword: customerPassword } });
    assert(registration.status === 303 && registration.location === '/apply/2016-ford-focus' && String(registration.cookie).includes('woa_customer_session='), 'Registration should sign in the new customer and return to the chosen car.');
    const customerCookie = String(registration.cookie).split(';')[0];
    const registrationState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    const originalAccount = registrationState.customerAccounts.find(row => row.email === 'native.applicant@example.com');
    const originalPasswordHash = originalAccount && originalAccount.passwordHash;
    const duplicateRegistration = await request(server, 'POST', '/customer/register', { form: { next: '/apply/2016-ford-focus', name: 'Wrong Replacement', phone: '8565550107', email: 'native.applicant@example.com', password: 'Replacement123', confirmPassword: 'Replacement123' } });
    const afterDuplicateRegistration = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(duplicateRegistration.status === 409 && afterDuplicateRegistration.customerAccounts.find(row => row.id === originalAccount.id).passwordHash === originalPasswordHash, 'Registering with an existing email or phone must never replace that customer password.');
    const applicationPage = await request(server, 'GET', '/apply/2016-ford-focus', { cookie: customerCookie });
    assert(applicationPage.status === 200 && /Insurance required before vehicle release/.test(applicationPage.text) && /name="insurancePickupConsent"/.test(applicationPage.text) && /active full-coverage insurance for the assigned vehicle and VIN/.test(applicationPage.text) && !/name="password"/.test(applicationPage.text), 'Signed-in customers should see the application without another password form.');

    const applicationPayload = {
      onlineVehicleId: 'online-native-1', accountMode: 'existing', firstName: 'Native', lastName: 'Applicant', phone: '8565550107', email: 'native.applicant@example.com', address: '100 Test Ave', city: 'Blackwood', state: 'NJ', postalCode: '08012', dateOfBirth: '1990-04-20', driverLicenseId: 'N12345678901234', driverLicenseExpires: '2030-04-20', employer: 'WheelsonAuto Test', income: 5000, applicationConsent: true, insurancePickupConsent: true
    };
    const unauthenticatedApplication = await request(server, 'POST', '/api/public/applications', { json: applicationPayload });
    assert(unauthenticatedApplication.status === 401 && unauthenticatedApplication.json.code === 'customer_login_required', 'The application API must reject requests that are not bound to a signed customer account.');
    const applicationResponse = await request(server, 'POST', '/api/public/applications', { json: applicationPayload, cookie: customerCookie });
    assert(applicationResponse.status === 201 && applicationResponse.json && applicationResponse.json.application.id && /\/customer\/onboarding\//.test(applicationResponse.json.onboardingUrl || ''), 'Published vehicle application should be accepted inside the account and create a portal-owned setup.');
    const applicationId = applicationResponse.json.application.id;
    let saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    const savedApplication = saved.applications.find(row => row.id === applicationId);
    const pendingCustomerAccount = saved.customerAccounts.find(row => row.id === applicationResponse.json.customerAccount.id);
    const savedSession = saved.onboardingSessions.find(row => row.applicationId === applicationId);
    const onboardingId = savedSession.id;
    savedApplication.requestedPickupDate = nextPickupDate();
    savedApplication.requestedPickupTime = '1:00 PM';
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    const portalOnboarding = await request(server, 'GET', applicationResponse.json.onboardingUrl, { cookie: customerCookie });
    const tokenMatch = portalOnboarding.text.match(/data-onboarding-token="([a-f0-9]+)"/i);
    const token = tokenMatch && tokenMatch[1];
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(portalOnboarding.status === 200 && token && savedApplication && pendingCustomerAccount && savedApplication.customerAccountId === pendingCustomerAccount.id && /^pbkdf2\$/.test(pendingCustomerAccount.passwordHash || '') && !savedApplication.pendingPasswordHash, 'The portal should reopen the exact onboarding file without copying account password secrets into the application.');
    assert(portalOnboarding.headers['Permissions-Policy'] === 'camera=(self), microphone=(), geolocation=()', 'The account-owned onboarding page must allow only its own origin to open the live license and selfie camera.');
    assert(!JSON.stringify(saved).includes(customerPassword), 'Plaintext customer password must never be persisted.');
    const customerEmailLogin = await request(server, 'POST', '/customer/login', { form: { username: applicationPayload.email, password: customerPassword } });
    assert(customerEmailLogin.status === 302 && String(customerEmailLogin.cookie).includes('woa_customer_session='), 'Customer should be able to log in with the account email.');
    const customerPhoneLogin = await request(server, 'POST', '/customer/login', { form: { username: '(856) 555-0107', password: customerPassword } });
    assert(customerPhoneLogin.status === 302 && String(customerPhoneLogin.cookie).includes('woa_customer_session='), 'Customer should be able to log in with the account phone number.');
    const customerPortal = await request(server, 'GET', '/customer', { cookie: String(customerEmailLogin.cookie).split(';')[0] });
    assert(customerPortal.status === 200 && /Applications/.test(customerPortal.text) && /My requests/.test(customerPortal.text) && />Continue</.test(customerPortal.text) && /2016 Ford Focus/.test(customerPortal.text) && /#portal-vehicle/.test(customerPortal.text), 'Pending applicant portal should keep the selected car and continuation step inside the Vehicle workspace.');

    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    saved.applications.unshift({
      id: 'app-legacy-pending-login', organizationId: 'org-wheelsonauto', name: 'Legacy Applicant', phone: '8565550199', email: 'legacy.applicant@example.com', onlineVehicleId: 'online-native-1', vehicleId: 'veh-native-1', vehicle: '2016 Ford Focus', status: 'New - staff review', stage: 'New', pendingPasswordHash: pendingCustomerAccount.passwordHash, pendingPasswordSalt: pendingCustomerAccount.passwordSalt, pendingPasswordUpdatedAt: pendingCustomerAccount.passwordUpdatedAt
    });
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    const legacyCustomerLogin = await request(server, 'POST', '/customer/login', { form: { username: '856-555-0199', password: customerPassword } });
    assert(legacyCustomerLogin.status === 302 && String(legacyCustomerLogin.cookie).includes('woa_customer_session='), 'Applications saved before immediate portal activation should self-repair on the first correct login.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(saved.customerAccounts.some(row => row.applicationId === 'app-legacy-pending-login') && !saved.applications.find(row => row.id === 'app-legacy-pending-login').pendingPasswordHash, 'Legacy pending login migration should move the password hash into one customer account and remove the application copy.');

    const login = await request(server, 'POST', '/login', { form: { username: 'owner', password: 'NativeOnboardingOwner123!' } });
    assert(login.status === 302 && String(login.cookie).includes('woa_session='), 'Owner login should provide a signed staff session.');
    const ownerCookie = String(login.cookie).split(';')[0];
    const onboardingPage = await request(server, 'GET', '/onboard/' + token);
    assert(onboardingPage.headers['Permissions-Policy'] === 'camera=(self), microphone=(), geolocation=()', 'The expiring private onboarding link must allow only its own origin to open the live license and selfie camera.');
    assert(onboardingPage.status === 200 && /<option value="11:30 AM">11:30 AM<\/option>/.test(onboardingPage.text) && /<option value="4:30 PM">4:30 PM<\/option>/.test(onboardingPage.text), 'Thirty-minute pickup settings should render every valid appointment start through 4:30 PM.');
    assert(new RegExp('name="requestedPickupDate"[^>]+value="' + savedApplication.requestedPickupDate + '"').test(onboardingPage.text) && /<option value="1:00 PM" selected>1:00 PM<\/option>/.test(onboardingPage.text), 'Onboarding should prefill the original pickup request without marking the customer profile complete.');
    assert(/data-profile-validation/.test(onboardingPage.text) && /data-field-error="driverLicenseId"/.test(onboardingPage.text) && /autocomplete="street-address"/.test(onboardingPage.text) && onboardingPage.text.includes('/native-site-client.js?v=' + nativeSite.NATIVE_SITE_ASSET_VERSION) && onboardingPage.text.includes('/native-site.css?v=' + nativeSite.NATIVE_SITE_ASSET_VERSION), 'Profile onboarding should expose and freshly load inline customer-side validation before a server rejection.');
    assert(/submit\.disabled = !!names\.length/.test(nativeSiteClient) && /submit\.setAttribute\('aria-disabled'/.test(nativeSiteClient), 'The profile save control must stay disabled until license, pickup, expiration, and autopay-consent checks are complete.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(savedSession && savedSession.tokenHash && !savedSession.publicToken, 'Onboarding session should persist only a token hash.');
    assert(saved.onlineVehicles[0].published === true && !saved.onlineVehicles[0].heldApplicationId, 'Application submission must keep the selected car published until a required payment is verified.');
    assert(saved.vehicles.find(row => row.id === 'veh-native-1').status === 'Ready' && !saved.vehicles.find(row => row.id === 'veh-native-1').heldApplicationId, 'Application submission must keep the internal fleet car Ready until a required payment is verified.');

    const secondRegistration = await request(server, 'POST', '/customer/register', { form: { next: '/apply/2016-ford-focus', name: 'Second Applicant', phone: '8565550108', email: 'second.applicant@example.com', password: 'SecondNative123', confirmPassword: 'SecondNative123' } });
    const secondCustomerCookie = String(secondRegistration.cookie).split(';')[0];
    const crossAccountOnboarding = await request(server, 'GET', applicationResponse.json.onboardingUrl, { cookie: secondCustomerCookie });
    assert(crossAccountOnboarding.status === 404, 'A signed customer must not open another customer account\'s onboarding file.');
    const secondApplicationPayload = { ...applicationPayload, firstName: 'Second', lastName: 'Applicant', phone: '8565550108', email: 'second.applicant@example.com' };
    const competing = await request(server, 'POST', '/api/public/applications', { json: secondApplicationPayload, cookie: secondCustomerCookie });
    assert(competing.status === 201 && competing.json.application.id !== applicationId, 'Another customer may apply and complete screening while the car is still unpaid and available.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(saved.onlineVehicles[0].published === true && saved.vehicles.find(row => row.id === 'veh-native-1').status === 'Ready', 'Multiple unpaid applications must not hide or reserve the car.');

    const expiredHold = JSON.parse(JSON.stringify(saved));
    expiredHold.onboardingSessions.find(row => row.id === onboardingId).expiresAt = new Date(Date.now() - 60000).toISOString();
    const expiredResult = onboardingService.releaseExpiredHolds(expiredHold, Date.now());
    assert(expiredResult.released === 0 && expiredHold.onlineVehicles[0].published === true && expiredHold.vehicles[0].status === 'Ready', 'An expired unpaid setup link must not change inventory because unpaid applications never hold the car.');

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
    assert(documentStepPage.status === 200 && (documentStepPage.text.match(/data-live-document-capture/g) || []).length === 3 && /data-camera-browser-help/.test(documentStepPage.text) && /data-camera-share/.test(documentStepPage.text) && /data-camera-copy/.test(documentStepPage.text), 'All three identity screening photos must use guided live-camera capture with secure camera-browser recovery controls.');
    assert(!/name="(?:driver_license_front|driver_license_back|identity_selfie)"[^>]+type="file"/.test(documentStepPage.text), 'Camera recovery must not weaken any identity screening photo into a gallery file upload.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    saved.applications.unshift({ id: 'unpaid-slot-app', pricingSnapshot: { downPayment: 1, weeklyPayment: 1 } });
    saved.onboardingSessions.unshift({ id: 'unpaid-slot-session', applicationId: 'unpaid-slot-app', profileCompletedAt: new Date().toISOString(), requestedPickupDate: pickupDate, requestedPickupTime: '1:00 PM', status: 'Profile complete' });
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    const reservedAvailability = await request(server, 'GET', '/api/public/onboarding/' + token + '/pickup-availability?date=' + pickupDate);
    assert(reservedAvailability.status === 200 && reservedAvailability.json.slots.find(slot => slot.time === '1:00 PM').available === true, 'An unpaid application pickup preference must not consume capacity or block another customer.');

    const image = pngDataUrl();
    const forgedGalleryDocuments = await request(server, 'POST', '/api/public/onboarding/' + token + '/documents', { json: { documents: [
      { kind: 'driver_license_front', name: 'gallery-front.png', type: 'image/png', dataUrl: image },
      { kind: 'driver_license_back', name: 'gallery-back.png', type: 'image/png', dataUrl: image },
      { kind: 'identity_selfie', name: 'gallery-selfie.png', type: 'image/png', dataUrl: image }
    ] } });
    assert(forgedGalleryDocuments.status === 400 && /live camera/i.test(forgedGalleryDocuments.json.error), 'The server must reject gallery-style identity submissions even when a client forges the document request directly.');
    const documents = await request(server, 'POST', '/api/public/onboarding/' + token + '/documents', { json: { documents: [
      { kind: 'driver_license_front', name: 'license-front.png', type: 'image/png', dataUrl: image, captureSource: 'live_camera', capturedAt: new Date().toISOString(), cameraFacingMode: 'environment' },
      { kind: 'driver_license_back', name: 'license-back.png', type: 'image/png', dataUrl: image, captureSource: 'live_camera', capturedAt: new Date().toISOString(), cameraFacingMode: 'environment' },
      { kind: 'identity_selfie', name: 'live-selfie-with-license.png', type: 'image/png', dataUrl: image, captureSource: 'live_camera', capturedAt: new Date().toISOString(), cameraFacingMode: 'user' }
    ] } });
    assert(documents.status === 201 && documents.json.documents.length === 3, 'License front/back and the live selfie with license should save as the preliminary private screening files.');
    const signature = await request(server, 'POST', '/api/public/onboarding/' + token + '/signature', { json: { typedName: 'Native Applicant', electronicConsent: true, signatureMatchConsent: true, signatureData: image } });
    assert(signature.status === 201, 'Customer should be able to sign the exact versioned agreement immediately after the screening files are complete.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    const signedAgreement = saved.eSignatures.find(row => row.onboardingSessionId === onboardingId);
    const signedContractDocument = saved.documents.find(row => row.onboardingSessionId === onboardingId && row.documentKind === 'signed_contract');
    assert(signedAgreement && /nineteen \(19\) consecutive months/i.test(signedAgreement.contractBody || ''), 'New signed agreements should lock the corrected 19-month optional-purchase term.');
    assert(signedAgreement && Number(signedAgreement.pricingSnapshot && signedAgreement.pricingSnapshot.contractMonths) === 19, 'The immutable pricing snapshot should store the canonical 19-month term.');
    assert(signedAgreement && signedAgreement.privateArtifactId === signedAgreement.signatureImageId, 'Encrypted signatures must retain the authenticated storage artifact ID so existing staff and customer contract views can read the drawn signature.');
    assert(signedContractDocument && signedAgreement.contractDocumentId === signedContractDocument.id && signedContractDocument.customerVisible === true && signedContractDocument.customerAccountId === pendingCustomerAccount.id, 'Signing must atomically add a private immutable contract artifact linked to the e-signature and customer portal account.');
    delete signedAgreement.privateArtifactId;
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    const customerContractDownload = await request(server, 'GET', '/customer/documents/' + encodeURIComponent(signedContractDocument.id), { cookie: String(customerEmailLogin.cookie).split(';')[0] });
    assert(customerContractDownload.status === 200 && /WHEELSONAUTO SIGNED AGREEMENT/.test(customerContractDownload.text) && /nineteen \(19\) consecutive months/i.test(customerContractDownload.text) && /END OF SIGNED AGREEMENT/.test(customerContractDownload.text), 'The signed-in customer must be able to open only their own complete signed-agreement artifact.');
    const customerContractPage = await request(server, 'GET', '/customer/contracts/' + encodeURIComponent(signedAgreement.id), { cookie: String(customerEmailLogin.cookie).split(';')[0] });
    assert(customerContractPage.status === 200 && /LONG-TERM VEHICLE RENTAL WITH OPTIONAL PURCHASE AGREEMENT/.test(customerContractPage.text) && /Customer drawn signature/.test(customerContractPage.text) && /Electronic signature certificate/.test(customerContractPage.text) && customerContractPage.text.includes(signedAgreement.documentHash) && customerContractPage.text.includes(signedAgreement.signatureImageHash), 'The customer signed-contract view must look like the full agreement and visibly bind the drawn signature, signer, timestamp, and certificate hashes, including encrypted signatures saved before privateArtifactId was added.');
    const staffContractPage = await request(server, 'GET', '/api/onboarding/contracts/' + encodeURIComponent(signedAgreement.id), { cookie: ownerCookie });
    assert(staffContractPage.status === 200 && /Print \/ save PDF/.test(staffContractPage.text) && /Native Applicant/.test(staffContractPage.text) && /1FADP3K24GL123456/.test(staffContractPage.text), 'Owner review must open the same printable signed agreement with the exact customer and vehicle proof.');
    const foreignContractDownload = await request(server, 'GET', '/customer/documents/' + encodeURIComponent(signedContractDocument.id), { cookie: String(legacyCustomerLogin.cookie).split(';')[0] });
    assert(foreignContractDownload.status === 404, 'A different signed-in customer must not be able to open another customer\'s signed contract artifact.');
    const foreignContractPage = await request(server, 'GET', '/customer/contracts/' + encodeURIComponent(signedAgreement.id), { cookie: String(legacyCustomerLogin.cookie).split(';')[0] });
    assert(foreignContractPage.status === 404, 'A different signed-in customer must not be able to render another customer\'s signed agreement or signature proof.');
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
    assert(saved.onlineVehicles.find(row => row.id === 'online-native-1').published === true && saved.vehicles.find(row => row.id === 'veh-native-1').status === 'Ready', 'Approval, documents, signature, identity review, and a saved card must still leave the unpaid vehicle online and Ready.');
    const approvedSession = saved.onboardingSessions.find(row => row.id === onboardingId);
    const approvedRecurring = saved.recurringPayments.find(row => row.id === recurring.id);
    const paymentBase = { recurringPaymentId: recurring.id, applicationId, onboardingSessionId: onboardingId, onlineVehicleId: 'online-native-1', organizationId: 'org-wheelsonauto', customer: 'Native Applicant', phone: '8565550107', email: 'native.applicant@example.com', vehicleId: 'veh-native-1', vehicle: '2016 Ford Focus', vin: '1FADP3K24GL123456', licensePlate: 'A19-WWM', method: 'Clover Hosted Checkout', source: 'WheelsonAuto native onboarding', checkoutCreatedAt: new Date().toISOString(), onboardingReturnUrl: 'http://127.0.0.1:4181/onboard/' + token };
    saved.paymentRequests.unshift(
      { ...paymentBase, id: 'plink-native-first', amount: 229, frequency: 'First week', paymentType: 'First weekly payment', reason: 'First weekly payment', status: 'Unpaid - Clover checkout ready', checkoutSessionId: 'checkout-native-first', checkoutHref: 'https://checkout.clover.test/first', createdAt: new Date().toISOString() },
      { ...paymentBase, id: 'plink-native-deposit', amount: 485, frequency: 'One time', paymentType: 'Nonrefundable down payment', reason: 'Nonrefundable down payment', status: 'Clover checkout ready', checkoutSessionId: 'checkout-native-deposit', checkoutHref: 'https://checkout.clover.test/deposit', createdAt: new Date().toISOString() }
    );
    saved.pickupAppointments.unshift({ id: 'pickup-stale-unpaid', applicationId, onboardingSessionId: onboardingId, onlineVehicleId: 'online-native-1', vehicleId: 'veh-native-1', customer: 'Native Applicant', vehicle: '2016 Ford Focus', vin: '1FADP3K24GL123456', date: pickupDate, time: '1:00 PM', status: 'Confirmed' });
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));

    const unpaidHandoff = await request(server, 'POST', '/api/pickups/pickup-stale-unpaid/complete', { cookie: ownerCookie, json: { confirmed: true, mileage: 91000, insuranceConfirmed: true, insuranceVinConfirmed: true, insuranceProvider: 'Test Full Coverage', insurancePolicyNumber: 'POLICY-100' } });
    assert(unpaidHandoff.status === 409 && /down payment and first weekly payment/i.test(unpaidHandoff.json.error || ''), 'A stale or forged pickup record must never mark an unpaid vehicle Rented.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    saved.pickupAppointments = saved.pickupAppointments.filter(row => row.id !== 'pickup-stale-unpaid');
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
    assert(saved.onlineVehicles.find(row => row.id === 'online-native-1').published === false && saved.onlineVehicles.find(row => row.id === 'online-native-1').paymentClaimApplicationId === applicationId, 'The first verified required payment must claim and remove the car from public inventory for the paying application.');
    assert(/deposit paid/i.test(saved.vehicles.find(row => row.id === 'veh-native-1').status), 'The fleet car must show a paid-pending state after the deposit, not Ready and not Rented.');
    assert(saved.payments.filter(row => row.onboardingSessionId === onboardingId).length === 1, 'Deposit should create exactly one payment record.');
    assert(saved.documents.filter(row => row.onboardingSessionId === onboardingId && row.kind === 'Receipt').length === 1, 'Deposit should create its own receipt.');
    const providerNeutralDepositRequest = saved.paymentRequests.find(row => row.id === 'plink-native-deposit');
    const providerNeutralDepositPayment = saved.payments.find(row => row.paymentRequestId === 'plink-native-deposit');
    assert(providerNeutralDepositRequest.paymentProvider === 'clover' && providerNeutralDepositRequest.providerCheckoutSessionId === 'checkout-native-deposit' && providerNeutralDepositRequest.providerPaymentId === 'clover-payment-deposit', 'Legacy Clover request IDs should be mirrored into provider-neutral checkout/payment fields.');
    assert(providerNeutralDepositPayment.paymentProvider === 'clover' && providerNeutralDepositPayment.providerPaymentId === 'clover-payment-deposit', 'Verified payment history should retain provider-neutral identity for a future Stripe adapter.');
    const liveFeed = await request(server, 'GET', '/api/applications/live-feed', { cookie: ownerCookie });
    assert(liveFeed.status === 200 && liveFeed.json.items[0].id === applicationId && liveFeed.json.items[0].paid === true && liveFeed.json.counts.scheduledPickup >= 1, 'The live application feed must put a verified paid applicant first in Scheduled Pickup without requiring a dashboard refresh.');

    const redirectOnly = await request(server, 'GET', '/pay/plink-native-first/success?session_id=checkout-native-first');
    assert(redirectOnly.status === 200 && /waiting for the signed provider confirmation/i.test(redirectOnly.text), 'Provider success redirect alone must not be treated as payment proof.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(!/paid|success/i.test(saved.paymentRequests.find(row => row.id === 'plink-native-first').status), 'Unverified redirect must keep the first weekly payment unpaid.');

    const firstWeekWebhook = await signedWebhook({ Type: 'PAYMENT', Status: 'APPROVED', Data: 'checkout-native-first', Id: 'clover-payment-first' });
    assert(firstWeekWebhook.status === 200 && firstWeekWebhook.json.hostedCheckout.approved, 'Signed first-week webhook should verify the second transaction.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(!saved.pickupAppointments.some(row => row.onboardingSessionId === onboardingId), 'Both payments must still leave pickup locked until the customer chooses a VIN-specific insurance path.');
    const sameNameCustomer = { id: 'cus-same-name-other-person', name: 'Native Applicant', customer: 'Native Applicant', phone: '8565550198', email: 'different.native@example.com', status: 'History', immutableMarker: 'do-not-update' };
    const sameNameContract = { id: 'contract-same-name-other-person', customer: 'Native Applicant', phone: '8565550198', email: 'different.native@example.com', status: 'Ended', immutableMarker: 'do-not-update' };
    const sameNameAccount = { id: 'account-same-name-other-person', customer: 'Native Applicant', name: 'Native Applicant', phone: '8565550198', email: 'different.native@example.com', portalStage: 'History', immutableMarker: 'do-not-update' };
    saved.customers.unshift(sameNameCustomer);
    saved.contracts.unshift(sameNameContract);
    saved.customerAccounts.unshift(sameNameAccount);
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
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
    assert(saved.customers.find(row => row.id === sameNameCustomer.id).immutableMarker === 'do-not-update' && saved.customers.some(row => row.applicationId === applicationId && row.id !== sameNameCustomer.id), 'Finalization must never overwrite a different customer merely because the names match.');
    assert(saved.contracts.find(row => row.id === sameNameContract.id).immutableMarker === 'do-not-update' && saved.customerAccounts.find(row => row.id === sameNameAccount.id).immutableMarker === 'do-not-update', 'Finalization must preserve unrelated same-name contracts and portal accounts.');
    assert(!JSON.stringify(saved).includes('NativeTest123'), 'Final customer data must still contain no plaintext password.');

    saved.onboardingSessions.find(row => row.id === onboardingId).finalReviewStatus = 'Needs review';
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));
    const staleApprovalHandoff = await request(server, 'POST', '/api/pickups/' + appointment.id + '/complete', { cookie: ownerCookie, json: { confirmed: true, mileage: 91000, insuranceConfirmed: true, insuranceVinConfirmed: true, insuranceProvider: 'Test Full Coverage', insurancePolicyNumber: 'POLICY-100' } });
    assert(staleApprovalHandoff.status === 409 && /final staff approval/i.test(staleApprovalHandoff.json.error || ''), 'A pickup must stop if final approval or another readiness gate becomes stale after scheduling.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    saved.onboardingSessions.find(row => row.id === onboardingId).finalReviewStatus = 'Approved';
    await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(saved, null, 2));

    const actualPickupDate = latestStaffedDate();
    const handoff = await request(server, 'POST', '/api/pickups/' + appointment.id + '/complete', { cookie: ownerCookie, json: { confirmed: true, actualPickupDate, mileage: 91000, notes: 'License, keys, and active insurance checked in person.', insuranceConfirmed: true, insuranceVinConfirmed: true, insuranceProvider: 'Test Full Coverage', insurancePolicyNumber: 'POLICY-100' } });
    assert(handoff.status === 200 && handoff.json.vehicle.status === 'Rented' && handoff.json.recurring.status === 'Active', 'Only the staff insurance check and physical handoff should activate the rental and recurring card schedule.');
    saved = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    finalRecurring = saved.recurringPayments.find(row => row.id === recurring.id);
    assert(finalRecurring.autoChargeEnabled === true && finalRecurring.autopayAnchorDate === actualPickupDate && finalRecurring.nextRun === plusDays(actualPickupDate, 7), 'Handoff must activate weekly autopay from the actual physical pickup date.');
    assert(saved.customers.find(row => row.id === sameNameCustomer.id).status === 'History' && saved.contracts.find(row => row.id === sameNameContract.id).status === 'Ended' && saved.customerAccounts.find(row => row.id === sameNameAccount.id).portalStage === 'History', 'Physical handoff must update only the application-owned customer, contract, and portal account when names collide.');

    await signedWebhook({ Type: 'PAYMENT', Status: 'APPROVED', Data: 'checkout-native-first', Id: 'clover-payment-first' });
    await signedWebhook({ Type: 'PAYMENT', Status: 'DECLINED', Data: 'checkout-native-first', Id: 'clover-payment-first-late-decline' });
    const idempotent = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(idempotent.pickupAppointments.filter(row => row.onboardingSessionId === onboardingId).length === 1, 'Repeated Clover webhook must not duplicate the pickup appointment.');
    assert(idempotent.payments.filter(row => row.paymentRequestId === 'plink-native-first').length === 1, 'Repeated Clover webhook must not duplicate payment history.');
    assert(idempotent.documents.filter(row => row.paymentRequestId === 'plink-native-first' && row.kind === 'Receipt').length === 1, 'Repeated Clover webhook must not duplicate receipts.');
    assert(/paid/i.test(idempotent.paymentRequests.find(row => row.id === 'plink-native-first').status), 'A late duplicate decline must never downgrade an already-verified paid request.');

    const cleanup = await request(server, 'POST', '/api/applications/cleanup-unpaid-tests', { cookie: ownerCookie, json: { confirmed: true } });
    assert(cleanup.status === 200 && cleanup.json.archived >= 1 && cleanup.json.protected >= 1, 'Owner cleanup should archive old unpaid tests while protecting every paid or active file.');
    const cleaned = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
    assert(!cleaned.applications.find(row => row.id === applicationId).cleanupArchivedAt, 'The paid application must never be archived by the unpaid-test cleanup.');
    assert(cleaned.applications.some(row => row.id !== applicationId && row.cleanupArchivedAt), 'At least one unpaid test file should be removed from the active application workspace.');

    console.log('Native onboarding check passed: automatic setup, live selfie screening, verified-payment inventory claim, live paid-priority queue, safe unpaid-test cleanup, separate receipts, handoff, and pickup-anchored weekly autopay are connected.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
