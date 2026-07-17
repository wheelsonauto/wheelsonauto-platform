const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const onboarding = require('../onboarding-service.js');

const root = path.resolve(__dirname, '..');
const adminPin = '1234';

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function nativePublicApplicationPayload(overrides = {}) {
  return {
    onlineVehicleId: 'online-direct-001',
    firstName: 'Direct',
    lastName: 'Applicant',
    phone: '3135550111',
    email: 'direct-applicant@example.com',
    password: 'DirectApplicant123!',
    address: '5150 NJ-42',
    city: 'Blackwood',
    state: 'NJ',
    postalCode: '08012',
    dateOfBirth: '1990-01-15',
    driverLicenseId: 'D12345678901234',
    driverLicenseExpires: '2030-01-15',
    employer: 'Direct Smoke Employer',
    income: 4500,
    applicationConsent: true,
    ...overrides
  };
}

function pngDataUrl() {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return 'data:image/png;base64,' + Buffer.concat([header, Buffer.alloc(256, 1)]).toString('base64');
}

class MockRequest extends Readable {
  constructor(method, url, headers, body) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers || {};
    this._body = body ? Buffer.from(body) : Buffer.alloc(0);
    this._sent = false;
  }
  _read() {
    if (this._sent) return;
    this._sent = true;
    if (this._body.length) this.push(this._body);
    this.push(null);
  }
}

class MockResponse {
  constructor(done) {
    this.statusCode = 200;
    this.headers = {};
    this.body = '';
    this._done = done;
  }
  writeHead(status, headers = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
  }
  setHeader(name, value) {
    this.headers[name] = value;
  }
  end(body = '') {
    this.body += Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
    this._done({
      status: this.statusCode,
      headers: this.headers,
      text: this.body,
      json: parseJson(this.body),
      cookie: this.headers['Set-Cookie'] || this.headers['set-cookie'] || '',
      location: this.headers.Location || this.headers.location || ''
    });
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function cleanCookie(raw) {
  return String(raw || '').split(';')[0];
}

function assertSecureCookie(raw, label, options = {}) {
  const text = String(raw || '');
  ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Secure'].forEach(flag => {
    assert(text.includes(flag), label + ' cookie is missing ' + flag + '.');
  });
  if (options.clear) assert(text.includes('Max-Age=0'), label + ' logout cookie should clear the session.');
}

async function request(server, method, route, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = '';
  if (options.cookie) headers.cookie = options.cookie;
  if (Object.prototype.hasOwnProperty.call(options, 'raw')) {
    body = String(options.raw || '');
    headers['content-type'] = options.contentType || 'application/json';
  } else if (options.form) {
    body = new URLSearchParams(options.form).toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (Object.prototype.hasOwnProperty.call(options, 'json')) {
    body = JSON.stringify(options.json);
    headers['content-type'] = 'application/json';
  }
  headers['content-length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = new MockRequest(method, route, headers, body);
    const res = new MockResponse(resolve);
    try {
      server.emit('request', req, res);
    } catch (err) {
      reject(err);
    }
  });
}

async function login(server, form) {
  const res = await request(server, 'POST', '/login', { form });
  assert(res.status === 302, 'Expected login redirect, got ' + res.status + ': ' + res.text.slice(0, 120));
  assert(String(res.cookie).includes('woa_session='), 'Login did not set a session cookie.');
  assert(String(res.cookie).includes('woa_session=v2.staff.'), 'Staff/admin session cookie should use the signed v2 format.');
  assertSecureCookie(res.cookie, 'Staff/admin login');
  return cleanCookie(res.cookie);
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-direct-smoke-'));
  process.env.DATA_DIR = dataDir;
  process.env.WOA_ADMIN_PIN = adminPin;
  process.env.WOA_AUTO_SYNC_MS = '3600000';
  process.env.WOA_AUTOPAY_MS = '3600000';
  process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';
  process.env.WOA_WEBHOOK_AUTO_SYNC_DELAY_MS = '3600000';
  process.env.PUBLIC_BASE_URL = 'https://wheelsonauto-platform.onrender.com';
  process.env.CLOVER_WEBHOOK_SECRET = 'direct-clover-secret';
  process.env.CLOVER_HCO_WEBHOOK_SECRET = 'direct-clover-hosted-checkout-secret';
  process.env.CLOVER_ACCESS_TOKEN = 'direct-clover-token';
  process.env.CLOVER_MERCHANT_ID = 'direct-clover-merchant';
  process.env.CLOVER_ECOMMERCE_PUBLIC_KEY = 'direct-clover-public-key';
  process.env.CLOVER_ECOMMERCE_PRIVATE_KEY = 'direct-clover-private-key';
  process.env.MESSAGING_WEBHOOK_SECRET = 'direct-message-secret';
  process.env.WOA_VERIFICATION_WEBHOOK_SECRET = 'direct-verification-secret';
  process.env.WOA_TRACKER_PROVIDER = 'direct-tracker-adapter';
  process.env.WOA_TRACKER_WEBHOOK_SECRET = 'direct-tracker-secret';
  process.env.WOA_MARKETING_PROVIDER = 'direct-marketing-adapter';
  process.env.WOA_MARKETING_WEBHOOK_SECRET = 'direct-marketing-secret';
  process.env.WOA_BILLING_PROVIDER = 'direct-billing-adapter';
  process.env.WOA_BILLING_WEBHOOK_SECRET = 'direct-billing-secret';
  process.env.RESEND_API_KEY = 'direct-resend-key';
  process.env.RESEND_WEBHOOK_SECRET = 'whsec_' + Buffer.from('direct-resend-webhook-key').toString('base64');
  delete require.cache[require.resolve('../server.js')];
  const {
    server,
    hydrateIncomingEmail,
    parseIncomingEmail,
    verifyResendWebhook,
    smsScamAssessment,
    smsSensitiveActionAssessment,
    smsBridgeCode,
    rememberSmsBridgeThread,
    resolveOwnerSmsBridge,
    ownerSmsMirrorBody,
    configureTwilioSmsWebhook,
    apiProviderLaunchGuidance,
    apiProviderRows,
    apiProviderReviewRows,
    repairDataIds,
    rowClaimsVehicle,
    enrichLinkedProfiles,
    nearEndpointNameMatch,
    calendarDayName,
    nextRecurringOccurrence,
    nextFutureRecurringDate,
    recurringCustomerId,
    mergeRecurringSubscriptionDetail,
    mergeRecurringCustomerDetail,
    membersFromRecurringSubscriptions,
    mapCloverPayment,
    sessionSignature,
    verifySignedSessionCookie
  } = require('../server.js');

  try {
    assert(calendarDayName('2026-07-10') === 'Friday', 'Calendar-only autopay dates must not shift to Thursday through UTC parsing.');
    assert(nextRecurringOccurrence({ frequency: 'Daily' }, '2026-07-10') === '2026-07-11', 'Daily autopay should advance by one day.');
    assert(nextRecurringOccurrence({ frequency: 'Weekly' }, '2026-07-10') === '2026-07-17', 'Weekly autopay should advance by seven days.');
    assert(nextRecurringOccurrence({ frequency: 'Bi-weekly' }, '2026-07-10') === '2026-07-24', 'Bi-weekly autopay should advance by fourteen days.');
    assert(nextFutureRecurringDate({ frequency: 'Weekly', nextRun: '2026-07-10' }, '2026-07-16') === '2026-07-17', 'An overdue Friday schedule should advance to the next future Friday instead of drifting to the runner day.');
    const cailahVehicle = { id: 'veh-sheet-058', name: '2018 Ford Fiesta Silver', vin: '3FADP4AJ8JM111119', plate: 'G90WGR' };
    const natashaVehicle = { id: 'veh-sheet-059', name: '2018 Ford Fiesta Silver', vin: '3FADP4AJ2JM106014', plate: 'A17WWM' };
    const cailahFile = { customer: 'Cailah Breanne Taylor', vehicle: '2018 Ford Fiesta Silver', vehicleId: cailahVehicle.id, vin: cailahVehicle.vin, plate: cailahVehicle.plate };
    assert(rowClaimsVehicle(cailahFile, cailahVehicle), 'A customer file must keep claiming the car whose vehicle ID, VIN, and tag match.');
    assert(!rowClaimsVehicle(cailahFile, natashaVehicle), 'Two same-year/model cars with different vehicle IDs, VINs, and tags must never clear each other customer files.');
    assert(rowClaimsVehicle({ customer: 'Legacy Customer', vehicle: '2018 Ford Fiesta Silver' }, cailahVehicle), 'A legacy row with no strong identity may still use an exact vehicle label as a fallback.');
    const cloverSubscription = mergeRecurringSubscriptionDetail({ id: 'SUB-CAILAH', active: true, amount: 21000 }, { id: 'SUB-CAILAH', customerUuid: 'ECOM-CUSTOMER-CAILAH', collectionMethod: 'CHARGE_AUTOMATICALLY', active: true });
    const hydratedCailah = mergeRecurringCustomerDetail(cloverSubscription, { id: 'ECOM-CUSTOMER-CAILAH', firstName: 'Cailah', lastName: 'Taylor', email: 'cailah@example.com', sources: { data: [{ id: 'clv_cailah_saved_source', brand: 'VISA', last4: '4242' }] } });
    const hydratedMembers = membersFromRecurringSubscriptions({ id: 'PLAN-WEEKLY-210', name: 'Weekly 210', amount: 21000, interval: 'WEEK' }, [hydratedCailah]);
    assert(recurringCustomerId(hydratedCailah) === 'ECOM-CUSTOMER-CAILAH', 'Recurring customerUuid must be retained as the Ecommerce card-on-file customer ID.');
    assert(hydratedMembers.length === 1 && hydratedMembers[0].customer === 'Cailah Taylor' && hydratedMembers[0].email === 'cailah@example.com' && hydratedMembers[0].amount === 210, 'An ID-only Clover subscription must become a named recurring member after Ecommerce customer hydration.');
    assert(hydratedMembers[0].cloverPaymentSource === 'clv_cailah_saved_source' && hydratedMembers[0].cardLast4 === '4242', 'Hydrated Clover recurring members must retain the chargeable saved-card token and safe last-four display.');
    assert(membersFromRecurringSubscriptions({ id: 'PLAN-INACTIVE', amount: 21000 }, [{ id: 'SUB-INACTIVE', customerUuid: 'ECOM-INACTIVE', active: false }]).length === 0, 'Inactive Clover subscriptions must not appear as active customers.');
    const newYorkEveningPayment = mapCloverPayment({ id: 'PAY-NY-EVENING', amount: 27900, createdTime: Date.UTC(2026, 6, 17, 1, 15), result: 'SUCCESS' });
    assert(newYorkEveningPayment.date === '7/16/2026', 'A Clover charge after 8 PM New York time must stay on the local business date instead of moving to the next UTC day.');
    assert(newYorkEveningPayment.createdAt === '2026-07-17T01:15:00.000Z', 'Clover payment sync must retain the precise timestamp for schedule reconciliation.');

    const sharedContactAccountData = {
      customerAccounts: [{
        id: 'customer-account-existing-shared-contact',
        applicationId: 'application-existing-shared-contact',
        customer: 'Existing Shared Contact',
        name: 'Existing Shared Contact',
        phone: '3135550147',
        email: 'shared-contact@example.com'
      }]
    };
    const isolatedPendingAccount = onboarding.createPendingCustomerAccount(sharedContactAccountData, {
      id: 'application-new-shared-contact',
      name: 'New Shared Contact Applicant',
      phone: '3135550147',
      email: 'shared-contact@example.com',
      organizationId: 'org-wheelsonauto'
    });
    assert(isolatedPendingAccount.id !== 'customer-account-existing-shared-contact' && sharedContactAccountData.customerAccounts.length === 2, 'A pending application must create its own portal account when an older account shares its phone or email.');
    assert(sharedContactAccountData.customerAccounts.find(row => row.id === 'customer-account-existing-shared-contact').customer === 'Existing Shared Contact', 'Creating a pending applicant must not overwrite the older shared-contact portal account.');

    const pathologicalNotes = {
      customers: [{ id: 'direct-note-customer', name: 'Direct Note Customer', notes: Array(3000).fill('Vehicle reassigned through WheelsonAuto autopay.').join('\n') }],
      contracts: [{ id: 'direct-note-contract', customer: 'Direct Note Customer', notes: Array(3000).fill('Vehicle reassigned through WheelsonAuto autopay.').join('\n') }]
    };
    const pathologicalSize = Buffer.byteLength(JSON.stringify(pathologicalNotes));
    repairDataIds(pathologicalNotes);
    assert(pathologicalNotes.customers[0].notes === 'Vehicle reassigned through WheelsonAuto autopay.' && pathologicalNotes.contracts[0].notes === 'Vehicle reassigned through WheelsonAuto autopay.', 'State repair must collapse pathological repeated note lines without removing the unique note.');
    assert(pathologicalNotes.systemRepairs.repeatedNoteRepairRows === 2 && pathologicalNotes.systemRepairs.repeatedNoteRepairLines === 5998, 'State repair must record exactly how many repeated note rows and lines were removed.');
    assert(Buffer.byteLength(JSON.stringify(pathologicalNotes)) < pathologicalSize / 20, 'Repeated-note repair should materially shrink a bloated customer/file payload.');

    const providerEvidenceState = {
      integrations: {
        clover: { connected: true, lastCustomerSyncAt: '2026-07-14T12:00:00.000Z', lastPaymentSyncAt: '2026-07-14T12:01:00.000Z', recurringPlanMembers: [{ id: 'direct-provider-recurring' }], webhookEvents: [{ id: 'direct-provider-hosted-webhook', kind: 'Hosted Checkout', authorization: 'Clover-Signature', receivedAt: '2026-07-14T12:03:00.000Z' }, { id: 'direct-provider-app-webhook', kind: 'Clover app event', authorization: 'X-Clover-Auth', receivedAt: '2026-07-14T12:03:01.000Z' }] },
        wheelsonAutoAutopay: { enabled: true, intervalMs: 300000, lastFinishedAt: '2026-07-14T12:04:00.000Z', lastResult: { charged: 1, failed: 0, skipped: 0, errors: [] } }
      },
      recurringPayments: [{ id: 'direct-provider-recurring', customer: 'Direct Provider Customer', cloverCustomerId: 'direct-provider-customer', cloverPaymentSource: 'clv_direct_provider_source', cardSavedAt: '2026-07-14T11:59:00.000Z', autoChargeEnabled: true, lastManualChargeAt: '2026-07-14T12:02:00.000Z' }],
      payments: [{ id: 'direct-provider-payment', customer: 'Direct Provider Customer', status: 'Paid', source: 'Clover saved-card charge', createdAt: '2026-07-14T12:02:00.000Z' }]
    };
    const providerEvidence = new Map(apiProviderRows(providerEvidenceState).map(row => [row.id, row]));
    assert(providerEvidence.get('clover-core').status === 'Connected' && /customers and payments synced successfully/i.test(providerEvidence.get('clover-core').lastTestResult), 'Clover Core should be connected only when runtime customer/payment sync evidence exists.');
    assert(providerEvidence.get('clover-ecommerce').status === 'Connected' && /saved-card charge successfully/i.test(providerEvidence.get('clover-ecommerce').lastTestResult), 'Clover Ecommerce should be connected only after a successful WheelsonAuto saved-card charge.');
    assert(providerEvidence.get('clover-webhooks').status === 'Connected' && /Hosted Checkout event/i.test(providerEvidence.get('clover-webhooks').lastTestResult) && /merchant-token polling/i.test(providerEvidence.get('clover-webhooks').lastTestResult), 'Merchant Clover webhooks should be connected after a signed Hosted Checkout event while merchant-token polling covers POS customer/payment updates.');
    assert(providerEvidence.get('woa-autopay').status === 'Connected' && /1 charged/.test(providerEvidence.get('woa-autopay').lastTestResult), 'WheelsonAuto Autopay should be connected only after a clean monitor run with a managed saved-card schedule.');
    assert(providerEvidence.get('insurance').endpoint.includes('/api/verification/cases') && !/future/i.test(providerEvidence.get('insurance').endpoint), 'Insurance provider readiness must point to the live provider-neutral verification routes.');
    assert(providerEvidence.get('identity-verification').endpoint.includes('/api/webhooks/stripe') && /never persisted|private/i.test(providerEvidence.get('identity-verification').lastTestResult), 'Identity provider readiness must expose signed Stripe callbacks and private-file/URL-retention truth.');
    assert(providerEvidence.get('tracker-gps').endpoint.includes('/api/webhooks/tracker') && /manual updates are live/i.test(providerEvidence.get('tracker-gps').lastTestResult), 'Tracker readiness must expose the provider-neutral signed adapter without pretending a provider event has passed.');
    assert(providerEvidence.get('marketing').endpoint.includes('/api/webhooks/marketing') && /duplicate protection/i.test(providerEvidence.get('marketing').lastTestResult), 'Marketing readiness must expose the exact-match lead adapter without pretending a signed provider event has passed.');
    assert(providerEvidence.get('accounting').endpoint.includes('/api/accounting/quickbooks.csv') && /balanced QuickBooks journal/i.test(providerEvidence.get('accounting').lastTestResult), 'Accounting provider readiness must expose the live balanced journal path without pretending OAuth is connected.');
    assert(providerEvidence.get('pickup-calendar').endpoint.includes('/api/pickups/calendar') && /Google add-to-calendar/i.test(providerEvidence.get('pickup-calendar').lastTestResult), 'Pickup provider readiness must expose the live manual calendar and maps path.');
    assert(/controlled saved-card charge/i.test(apiProviderLaunchGuidance({ id: 'clover-ecommerce', status: 'Testing - live charge needed' }).nextAction), 'Clover Ecommerce guidance should name the controlled saved-card charge required before connection.');
    assert(/10DLC approval/i.test(apiProviderLaunchGuidance({ id: 'sms-phone', status: 'Blocked - 10DLC approval' }).nextAction), 'SMS guidance should name the Telnyx account and 10DLC work blocking outbound delivery.');
    assert(/API credit/i.test(apiProviderLaunchGuidance({ id: 'star-ai', status: 'Blocked - OpenAI credit needed' }).nextAction), 'Star guidance should name usable OpenAI API credit as the current provider blocker.');
    assert(/Hosted Checkout signing secret/i.test(apiProviderLaunchGuidance({ id: 'clover-webhooks', status: 'Ready for credentials' }).nextAction) && /developer account is optional/i.test(apiProviderLaunchGuidance({ id: 'clover-webhooks', status: 'Ready for credentials' }).nextAction), 'Clover webhook guidance should fit the merchant-token setup without falsely requiring a developer account.');
    assert(providerEvidence.get('clover-ecommerce').nextAction && providerEvidence.get('clover-ecommerce').proofRequired, 'Runtime provider rows should expose next-action and proof-required guidance to the app.');
    const providerReviewIds = new Set(apiProviderReviewRows(providerEvidenceState).map(row => row.id));
    assert(!providerReviewIds.has('clover-core') && !providerReviewIds.has('clover-ecommerce') && !providerReviewIds.has('clover-webhooks') && !providerReviewIds.has('woa-autopay'), 'Evidence-backed Clover and WheelsonAuto autopay providers should not remain in the provider readiness warning count.');
    const providerCustomerFailureState = JSON.parse(JSON.stringify(providerEvidenceState));
    providerCustomerFailureState.integrations.wheelsonAutoAutopay.lastResult = { charged: 0, failed: 1, notFound: 0, skipped: 0, errors: ['Direct Provider Customer: card declined'] };
    const providerCustomerFailure = new Map(apiProviderRows(providerCustomerFailureState).map(row => [row.id, row]));
    assert(providerCustomerFailure.get('woa-autopay').status === 'Connected' && /1 failed/.test(providerCustomerFailure.get('woa-autopay').lastTestResult), 'A customer decline should remain a customer follow-up outcome instead of falsely blocking the autopay engine.');
    const providerFatalState = JSON.parse(JSON.stringify(providerEvidenceState));
    providerFatalState.integrations.wheelsonAutoAutopay.fatalError = 'Autopay data store unavailable';
    const providerFatal = new Map(apiProviderRows(providerFatalState).map(row => [row.id, row]));
    assert(providerFatal.get('woa-autopay').status === 'Blocked - monitor error' && /data store unavailable/i.test(providerFatal.get('woa-autopay').lastTestResult), 'A monitor-level failure should block autopay readiness with the actual failure evidence.');
    const weakVehicleRepairState = {
      vehicles: [],
      customers: [{ id: 'direct-weak-customer', name: 'Direct Weak Customer', vehicle: 'Direct Weak Customer' }, { id: 'direct-legit-customer', name: 'John Ford', vehicle: 'Ford Escape' }],
      contracts: [{ id: 'direct-weak-contract', customer: 'Direct Weak Customer', vehicle: '229' }],
      recurringPayments: [{ id: 'direct-weak-recurring', customer: 'Direct Weak Customer', vehicle: '$229.00', amount: 229, status: 'Active' }],
      maintenance: [], claims: [], payments: [], paymentRequests: [], tasks: [], documents: [], applications: [], messages: [], staffAccounts: [], customerAccounts: [], organizations: [], auditLogs: [],
      integrations: { clover: { recurringPlanMembers: [] } }
    };
    repairDataIds(weakVehicleRepairState);
    [...weakVehicleRepairState.customers, ...weakVehicleRepairState.contracts, ...weakVehicleRepairState.recurringPayments].forEach(row => {
      if (row.id === 'direct-legit-customer') return;
      assert(row.vehicle === '' && row.previousVehicle && row.vehicleLinkStatus === 'Needs vehicle match', 'Impossible customer-name or amount vehicle labels should be cleared while retaining audit evidence.');
    });
    assert(weakVehicleRepairState.customers.find(row => row.id === 'direct-legit-customer').vehicle === 'Ford Escape', 'Weak-label repair must not clear a legitimate vehicle that merely shares one word with a customer name.');
    assert(Number(weakVehicleRepairState.systemRepairs && weakVehicleRepairState.systemRepairs.weakVehicleLabelRepairCount || 0) === 3, 'Weak vehicle-label repair should record the number of safely cleared labels.');
    assert(nearEndpointNameMatch('Rone Nfoe', 'Ronel Babey nfor'), 'Customer alias matching should tolerate a one-character first/last-name variation.');
    const aliasVehicleState = {
      vehicles: [{ id: 'veh-direct-alias', name: '2014 Nissan Rogue', vin: 'DIRECTALIASVIN1', plate: 'ALIAS-1', status: 'Rented', currentCustomer: 'Ronel Babey nfor' }],
      customers: [{ id: 'cus-direct-alias', name: 'Ronel Babey nfor', vehicle: '2014 Nissan Rogue', vehicleId: 'veh-direct-alias', vin: 'DIRECTALIASVIN1', licensePlate: 'ALIAS-1', status: 'Active' }],
      contracts: [{ id: 'con-direct-alias', customer: 'Ronel Babey nfor', vehicle: '2014 Nissan Rogue', vehicleId: 'veh-direct-alias', vin: 'DIRECTALIASVIN1', licensePlate: 'ALIAS-1', status: 'Active' }],
      recurringPayments: [{ id: 'rec-direct-alias', customer: 'Rone Nfoe', phone: '(929) 622-1629', email: 'ronel@example.com', cloverCustomerId: 'direct-clover-alias', amount: 230, status: 'Active' }],
      maintenance: [], claims: [], payments: [], paymentRequests: [], tasks: [], documents: [], applications: [], messages: [], staffAccounts: [], customerAccounts: [], organizations: [], auditLogs: [],
      integrations: { clover: { recurringPlanMembers: [] } }
    };
    enrichLinkedProfiles(aliasVehicleState);
    assert(aliasVehicleState.recurringPayments[0].vehicleId === 'veh-direct-alias' && aliasVehicleState.recurringPayments[0].vehicle === '2014 Nissan Rogue' && aliasVehicleState.recurringPayments[0].vin === 'DIRECTALIASVIN1', 'An unambiguous Clover name alias should recover the current vehicle, VIN, and tag instead of showing No vehicle linked.');
    assert(smsScamAssessment('Send me your verification code using https://bit.ly/fake').suspicious, 'Credential and shortened-link SMS should be marked as a potential scam.');
    assert(!smsScamAssessment('Hi, can I bring the car in for an oil change Tuesday?').suspicious, 'Normal customer service SMS should not be marked as a scam.');
    assert(smsSensitiveActionAssessment('Charge the customer card and change autopay to Friday').sensitive, 'Owner phone money/account instructions should require app review.');
    const bridgeData = {};
    const bridgeThread = rememberSmsBridgeThread(bridgeData, { customer: 'Bridge Customer', phone: '3135550117', direction: 'Inbound', vehicle: '2018 Test Car', vin: 'BRIDGEVIN1' });
    assert(bridgeThread && bridgeThread.code === smsBridgeCode('3135550117') && bridgeThread.code.length === 6, 'SMS bridge should create a stable 6-character conversation code.');
    const codedBridgeReply = resolveOwnerSmsBridge(bridgeData, bridgeThread.code + ' Thanks, we will see you Tuesday.');
    assert(codedBridgeReply.ok && codedBridgeReply.thread.phone === '+13135550117' && codedBridgeReply.body === 'Thanks, we will see you Tuesday.', 'Owner coded SMS reply should resolve to the right customer thread.');
    const recentBridgeReply = resolveOwnerSmsBridge(bridgeData, 'I will call you shortly.');
    assert(recentBridgeReply.ok && !recentBridgeReply.usedCode, 'A code-less owner reply should be allowed only for one unambiguous recent inbound customer.');
    rememberSmsBridgeThread(bridgeData, { customer: 'Second Bridge Customer', phone: '3135550118', direction: 'Inbound' });
    assert(!resolveOwnerSmsBridge(bridgeData, 'This reply is ambiguous.').ok, 'A code-less owner reply must be blocked when more than one customer thread is active.');
    const mirrorPreview = ownerSmsMirrorBody({ customer: 'Bridge Customer', phone: '3135550117', direction: 'Inbound', body: 'Please send your OTP to bit.ly/fake' }, bridgeThread, smsScamAssessment('Please send your OTP to bit.ly/fake'));
    assert(mirrorPreview.includes('POTENTIAL SCAM') && mirrorPreview.includes(bridgeThread.code), 'Owner mirror should visibly warn about potential scams and include the conversation code.');
    const twilioCalls = [];
    const twilioConfigured = await configureTwilioSmsWebhook({
      accountSid: 'AC-direct-test',
      authToken: 'direct-auth-token',
      phoneNumber: '7372583742',
      webhookUrl: 'https://wheelsonauto-platform.onrender.com/api/webhooks/messages?provider=twilio',
      fetchImpl: async (url, options = {}) => {
        twilioCalls.push({ url: String(url), options });
        if (String(url).includes('.json?')) {
          return { ok: true, async json() { return { incoming_phone_numbers: [{ sid: 'PN-direct-test', phone_number: '+17372583742' }] }; } };
        }
        return { ok: true, async json() { return { sid: 'PN-direct-test', phone_number: '+17372583742', sms_url: 'https://wheelsonauto-platform.onrender.com/api/webhooks/messages?provider=twilio', sms_method: 'POST' }; } };
      }
    });
    assert(twilioConfigured.connected && twilioConfigured.provider === 'twilio', 'Twilio webhook setup should report a connected inbound SMS route.');
    assert(twilioCalls.length === 2 && twilioCalls[0].url.includes('PhoneNumber=%2B17372583742'), 'Twilio webhook setup should locate the exact assigned number before updating it.');
    assert(twilioCalls[1].options.method === 'POST' && String(twilioCalls[1].options.body).includes('SmsUrl='), 'Twilio webhook setup should POST the WheelsonAuto inbound URL to the assigned number.');

    const resendPayload = JSON.stringify({ type: 'email.received', data: { email_id: 'direct-resend-email', from: 'Direct Customer <direct-customer@example.com>', to: ['office@wheelsonauto.com'], subject: 'Resend body retrieval' } });
    const resendTimestamp = String(Math.floor(Date.now() / 1000));
    const resendId = 'direct-resend-webhook';
    const resendSignature = crypto.createHmac('sha256', Buffer.from('direct-resend-webhook-key')).update(resendId + '.' + resendTimestamp + '.' + resendPayload).digest('base64');
    assert(verifyResendWebhook(resendPayload, { 'svix-id': resendId, 'svix-timestamp': resendTimestamp, 'svix-signature': 'v1,' + resendSignature }), 'Valid Resend webhook signature should pass.');
    assert(!verifyResendWebhook(resendPayload + 'x', { 'svix-id': resendId, 'svix-timestamp': resendTimestamp, 'svix-signature': 'v1,' + resendSignature }), 'Modified Resend webhook payload should fail signature verification.');
    const originalFetch = global.fetch;
    global.fetch = async url => ({
      ok: String(url).includes('/emails/receiving/direct-resend-email'),
      async json() {
        return { id: 'direct-resend-email', from: 'Direct Customer <direct-customer@example.com>', to: ['office@wheelsonauto.com'], subject: 'Resend body retrieval', text: 'This is the full inbound email body.', attachments: [{ id: 'direct-attachment', filename: 'proof.pdf', content_type: 'application/pdf', size: 42 }] };
      }
    });
    const parsedResend = parseIncomingEmail('resend', {}, JSON.parse(resendPayload));
    const hydratedResend = await hydrateIncomingEmail('resend', JSON.parse(resendPayload), parsedResend);
    global.fetch = originalFetch;
    assert(hydratedResend.externalId === 'direct-resend-email' && hydratedResend.body === 'This is the full inbound email body.', 'Resend inbound email should retrieve the full message body.');
    assert(hydratedResend.attachments.length === 1 && hydratedResend.attachments[0].filename === 'proof.pdf', 'Resend inbound email should keep attachment metadata.');

    const loginPage = await request(server, 'GET', '/login');
    assert(loginPage.status === 200, 'Login page did not load.');
    assert(loginPage.text.includes('WheelsonAuto Portal'), 'Login page content is missing.');
    assert(loginPage.text.includes('Forgot password?') && loginPage.text.includes('/forgot'), 'Staff login should include owner-approved password help.');
    assert(loginPage.headers['X-Frame-Options'] === 'DENY' && loginPage.headers['X-Content-Type-Options'] === 'nosniff', 'Login responses must carry anti-framing and content-sniffing security headers.');
    assert(String(loginPage.headers['Content-Security-Policy'] || '').includes("frame-ancestors 'none'"), 'Login responses must prevent embedding by another site.');
    const versionedAppAsset = await request(server, 'GET', '/app.js?v=platform-direct-cache-test');
    assert(versionedAppAsset.status === 200 && versionedAppAsset.headers['Cache-Control'] === 'public, max-age=31536000, immutable', 'Versioned app assets should be cached immutably instead of downloaded again after every login or refresh.');
    const unversionedAppAsset = await request(server, 'GET', '/app.js');
    assert(unversionedAppAsset.status === 200 && unversionedAppAsset.headers['Cache-Control'] === 'no-store', 'Unversioned app assets must remain uncached so a stale direct URL cannot survive a deploy.');
    const unauthenticatedState = await request(server, 'GET', '/api/state');
    assert(unauthenticatedState.status === 401 && unauthenticatedState.json && unauthenticatedState.json.error === 'Authentication required.', 'Protected APIs must return a JSON 401 instead of rendering the staff login page.');
    assert(unauthenticatedState.headers['Cache-Control'] === 'no-store', 'Authenticated JSON APIs must not be cached by browsers or intermediaries.');

    for (let i = 0; i < 6; i += 1) {
      const badLogin = await request(server, 'POST', '/login', { form: { username: 'direct-rate-limit-staff', password: 'wrong-' + i } });
      assert(badLogin.status === 401, 'Bad staff login should fail before throttle limit.');
    }
    const throttledStaffLogin = await request(server, 'POST', '/login', { form: { username: 'direct-rate-limit-staff', password: 'still-wrong' } });
    assert(throttledStaffLogin.status === 429 && throttledStaffLogin.text.includes('Too many failed login attempts') && String(throttledStaffLogin.headers['Retry-After'] || '').length, 'Repeated bad staff login should be throttled with retry guidance.');
    for (let i = 0; i < 6; i += 1) {
      const badCustomerLogin = await request(server, 'POST', '/customer/login', { form: { username: 'direct-rate-limit-customer', password: 'wrong-' + i } });
      assert(badCustomerLogin.status === 401, 'Bad customer login should fail before throttle limit.');
    }
    const throttledCustomerLogin = await request(server, 'POST', '/customer/login', { form: { username: 'direct-rate-limit-customer', password: 'still-wrong' } });
    assert(throttledCustomerLogin.status === 429 && throttledCustomerLogin.text.includes('Too many failed login attempts') && String(throttledCustomerLogin.headers['Retry-After'] || '').length, 'Repeated bad customer login should be throttled with retry guidance.');
    for (let i = 0; i < 6; i += 1) {
      const spoofedForwardedLogin = await request(server, 'POST', '/login', { headers: { 'x-forwarded-for': '192.0.2.' + i + ', 198.51.100.20' }, form: { username: 'direct-forwarded-rate-limit', password: 'wrong-' + i } });
      assert(spoofedForwardedLogin.status === 401, 'Forwarded-chain login attempt should fail before the throttle limit.');
    }
    const throttledForwardedLogin = await request(server, 'POST', '/login', { headers: { 'x-forwarded-for': '192.0.2.200, 198.51.100.20' }, form: { username: 'direct-forwarded-rate-limit', password: 'still-wrong' } });
    assert(throttledForwardedLogin.status === 429, 'Login throttling must use the trusted end of the forwarded chain instead of a spoofable first address.');
    const oversizedStaffLogin = await request(server, 'POST', '/login', { form: { username: 'oversized-staff', password: 'x'.repeat(70 * 1024) } });
    assert(oversizedStaffLogin.status === 413, 'Oversized staff login bodies must be rejected before authentication work.');
    const oversizedCustomerLogin = await request(server, 'POST', '/customer/login', { form: { username: 'oversized-customer', password: 'x'.repeat(70 * 1024) } });
    assert(oversizedCustomerLogin.status === 413, 'Oversized customer login bodies must be rejected before authentication work.');

    const ownerCookie = await login(server, { pin: adminPin });
    const crossOriginOwnerWrite = await request(server, 'POST', '/api/tasks', {
      cookie: ownerCookie,
      headers: { origin: 'https://malicious.example' },
      json: { title: 'Cross-origin request must not save' }
    });
    assert(crossOriginOwnerWrite.status === 403 && /cross-origin/i.test(crossOriginOwnerWrite.json && crossOriginOwnerWrite.json.error || ''), 'Cookie-authenticated writes from another origin must be rejected before route handling.');
    const ownerSessionParts = ownerCookie.split('=')[1].split('.');
    const ownerSessionPayload = JSON.parse(Buffer.from(ownerSessionParts[2], 'base64url').toString('utf8'));
    assert(Number(ownerSessionPayload.exp) > Math.floor(Date.now() / 1000) && Number(ownerSessionPayload.exp) - Number(ownerSessionPayload.iat) <= 24 * 60 * 60, 'Staff session must carry a bounded signed expiration.');
    const expiredPayload = Buffer.from(JSON.stringify({ id: 'expired-owner', role: 'Owner', iat: Math.floor(Date.now() / 1000) - 120, exp: Math.floor(Date.now() / 1000) - 60 }), 'utf8').toString('base64url');
    const expiredSession = 'v2.staff.' + expiredPayload + '.' + sessionSignature('staff', expiredPayload);
    assert(verifySignedSessionCookie(expiredSession, 'staff') === null, 'Expired signed staff sessions must be rejected.');
    const expiredSessionRead = await request(server, 'GET', '/api/state', { cookie: 'woa_session=' + expiredSession });
    assert(expiredSessionRead.status === 401, 'Expired staff session cookies must not authorize API access.');
    const invalidJsonTask = await request(server, 'POST', '/api/tasks', { cookie: ownerCookie, raw: '{not-json' });
    assert(invalidJsonTask.status === 400 && /valid JSON/i.test(invalidJsonTask.json && invalidJsonTask.json.error || ''), 'Malformed API JSON must return a controlled 400 response.');
    const oversizedJsonTask = await request(server, 'POST', '/api/tasks', { cookie: ownerCookie, raw: JSON.stringify({ title: 'x'.repeat(1024 * 1024 + 16) }) });
    assert(oversizedJsonTask.status === 413, 'Oversized API JSON must return 413 instead of consuming an unbounded request body.');
    const paymentCheckoutStatus = await request(server, 'POST', '/api/integrations/payments/checkout-status', { cookie: ownerCookie, json: {} });
    assert(paymentCheckoutStatus.status === 200 && paymentCheckoutStatus.json && paymentCheckoutStatus.json.adapterReady && paymentCheckoutStatus.json.signedWebhookReady && paymentCheckoutStatus.json.verifiedPaymentPipelineReady && paymentCheckoutStatus.json.ok, 'Provider-neutral checkout readiness should require both checkout credentials and signed payment reconciliation.');
    const legacyCheckoutStatus = await request(server, 'POST', '/api/integrations/clover/checkout-status', { cookie: ownerCookie, json: {} });
    assert(legacyCheckoutStatus.status === 200 && legacyCheckoutStatus.json.verifiedPaymentPipelineReady, 'Legacy Clover checkout status route should mirror the provider-neutral readiness result.');
    const missingTwilioSetup = await request(server, 'POST', '/api/integrations/twilio/configure', { cookie: ownerCookie, json: {} });
    assert(missingTwilioSetup.status === 409 && /saved in Render/i.test(missingTwilioSetup.json.error || ''), 'Twilio setup route should clearly report missing Render credentials without faking a connection.');
    const tamperedOwnerCookie = ownerCookie.replace(/\.[^.]+$/, '.bad-signature');
    const tamperedOwnerRead = await request(server, 'GET', '/api/state', { cookie: tamperedOwnerCookie });
    assert(tamperedOwnerRead.status === 401 && tamperedOwnerRead.json && tamperedOwnerRead.json.error === 'Authentication required.', 'Tampered staff session cookie should not authenticate API access.');
    const ownerState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(ownerState.status === 200 && ownerState.json, 'Owner could not read state.');
    const initialStateVersion = await request(server, 'GET', '/api/state/version', { cookie: ownerCookie });
    assert(initialStateVersion.status === 200 && initialStateVersion.json && initialStateVersion.json.version, 'State version endpoint should return a lightweight authenticated version.');
    const unchangedStateVersion = await request(server, 'GET', '/api/state/version', { cookie: ownerCookie });
    assert(unchangedStateVersion.json.version === initialStateVersion.json.version, 'State version should remain stable while business data is unchanged.');
    const legacyApplyRedirect = await request(server, 'GET', '/apply');
    assert(legacyApplyRedirect.status === 302 && legacyApplyRedirect.location === '/inventory', 'Legacy /apply must route customers into the single vehicle-specific native application journey.');
    const publicPrototype = await request(server, 'GET', '/ifleet-prototype.html');
    assert(publicPrototype.status === 200 && /WheelsonAuto Portal/.test(publicPrototype.text) && !/iFleet prototype/i.test(publicPrototype.text), 'The obsolete iFleet prototype must not be publicly served.');

    const duplicateState = JSON.parse(JSON.stringify(ownerState.json));
    duplicateState.vehicles = duplicateState.vehicles || [];
    duplicateState.vehicles = duplicateState.vehicles.filter(vehicle => vehicle.id !== 'veh-signal-text-car');
    duplicateState.vehicles.push(
      { id: 'veh-direct-duplicate', name: 'Direct Duplicate One', vin: 'DIRECTVIN001', plate: 'DIR-001', status: 'Ready' },
      { id: 'veh-direct-duplicate', name: 'Direct Duplicate Two', vin: 'DIRECTVIN002', plate: 'DIR-002', status: 'Ready' },
      { id: 'veh-direct-autopay-file', year: 2026, make: 'Direct', model: 'Autopay File Car', vin: 'DIRECTAUTOPAYFILEVIN', plate: 'DIR-AUTO', tempTag: 'TMP-AUTO', tracker: 'TRK-AUTO', status: 'Ready' },
      { id: 'veh-direct-dispute-car', year: 2025, make: 'Direct', model: 'Dispute Car', vin: 'DIRECTDISPUTEVIN', plate: 'DIR-DSP', tempTag: 'TMP-DSP', tracker: 'TRK-DSP', currentCustomer: 'Direct Dispute Customer', status: 'Rented' },
      { id: 'veh-direct-pickup-car', organizationId: 'org-wheelsonauto', year: 2026, make: 'Direct', model: 'Pickup Car', vin: 'DIRECTPICKUPVIN001', plate: 'DIR-PUP', tracker: 'TRK-PUP', currentCustomer: 'Direct Pickup Customer', status: 'Pending pickup', mileage: 41000 },
      { id: 'veh-signal-text-car', year: 2024, make: 'Signal', model: 'Text Car', vin: 'SIGNALVIN123456789', plate: 'SIG-77', tempTag: 'TMP-SIG', tracker: 'TRK-SIG', currentCustomer: 'Signal Match Person', status: 'Rented' }
    );
    duplicateState.payments = duplicateState.payments || [];
    duplicateState.claims = duplicateState.claims || [];
    duplicateState.recurringPayments = duplicateState.recurringPayments || [];
    duplicateState.customerAccounts = duplicateState.customerAccounts || [];
    duplicateState.customers = duplicateState.customers || [];
    duplicateState.contracts = duplicateState.contracts || [];
    duplicateState.applications = duplicateState.applications || [];
    duplicateState.onboardingSessions = duplicateState.onboardingSessions || [];
    duplicateState.onlineVehicles = duplicateState.onlineVehicles || [];
    duplicateState.maintenance = duplicateState.maintenance || [];
    duplicateState.pickupAppointments = duplicateState.pickupAppointments || [];
    duplicateState.payments = duplicateState.payments.filter(payment => payment.id !== 'pay-signal-alpha-983' && payment.cloverPaymentId !== 'charge-signal-alpha-983');
    duplicateState.claims = duplicateState.claims.filter(claim => claim.id !== 'claim-signal-text-dispute');
    duplicateState.apiProviders = duplicateState.apiProviders || [];
    duplicateState.apiProviders.unshift({
      id: 'api-direct-provider-needed',
      name: 'Direct Provider Needed API',
      group: 'Risk',
      status: 'Provider needed',
      owner: 'Owner',
      envKeys: 'DIRECT_PROVIDER_KEY',
      endpoint: 'Future /api/direct/provider',
      liveTest: 'Run direct provider readiness smoke',
      notes: 'Direct smoke provider should stay under review until a live provider test is saved.'
    });
    duplicateState.payments.unshift(
      { id: 'clover-payment-direct-dispute', cloverPaymentId: 'pay-direct-dispute', customer: 'Direct Dispute Customer', date: 'Today', method: 'Clover', amount: 199, status: 'Paid', source: 'Clover', vehicleId: 'veh-direct-dispute-car', vehicle: '2025 Direct Dispute Car', vin: 'DIRECTDISPUTEVIN', plate: 'DIR-DSP', tracker: 'TRK-DSP', phone: '3135550199', email: 'direct-dispute-customer@example.com' },
      { id: 'clover-payment-direct-unmatched-a', cloverPaymentId: 'pay-direct-unmatched-duplicate', customer: 'Unmatched Clover payment', date: 'Today', method: 'Clover', amount: 7788.88, status: 'Paid', source: 'Clover' },
      { id: 'clover-payment-direct-unmatched-b', cloverPaymentId: 'pay-direct-unmatched-duplicate', customer: 'Customer match needed', date: 'Today', method: 'Clover', amount: 7788.88, status: 'Paid', source: 'Clover' },
      { id: 'pay-signal-alpha-983', cloverPaymentId: 'charge-signal-alpha-983', customer: 'Signal Match Person', date: 'Today', method: 'Clover', amount: 144, status: 'Paid', source: 'Clover', vehicleId: 'veh-signal-text-car', vehicle: '2024 Signal Text Car', vin: 'SIGNALVIN123456789', plate: 'SIG-77', tracker: 'TRK-SIG', phone: '3135550201', email: 'signal-match@example.com' },
      { id: 'clover-payment-direct-webhook-dispute', cloverPaymentId: 'pay-direct-webhook-dispute', customer: 'Direct Webhook Dispute Customer', date: 'Today', method: 'Clover', amount: 88, status: 'Paid', source: 'Clover' }
    );
    duplicateState.recurringPayments.unshift({ id: 'rec-direct-dispute-match', customer: 'Direct Recurring Dispute Customer', cloverCustomerId: 'direct-dispute-customer-id', phone: '3135550100', email: 'direct-dispute@example.com', vehicle: 'Direct Dispute Vehicle', amount: 111, status: 'Active' });
    duplicateState.recurringPayments.unshift({ id: 'rec-direct-pickup', organizationId: 'org-wheelsonauto', applicationId: 'application-direct-calendar', onboardingSessionId: 'onboard-direct-calendar', pickupAppointmentId: 'pickup-direct-calendar', customer: 'Direct Pickup Customer', vehicleId: 'veh-direct-pickup-car', vehicle: '2026 Direct Pickup Car', vin: 'DIRECTPICKUPVIN001', plate: 'DIR-PUP', amount: 229, status: 'Scheduled', nextRun: '2026-07-27', paymentDay: 'Monday', autoChargeEnabled: true });
    duplicateState.customers.unshift({ id: 'cus-direct-pickup', organizationId: 'org-wheelsonauto', applicationId: 'application-direct-calendar', recurringPaymentId: 'rec-direct-pickup', name: 'Direct Pickup Customer', vehicleId: 'veh-direct-pickup-car', vehicle: '2026 Direct Pickup Car', status: 'Approved - awaiting pickup' });
    duplicateState.contracts.unshift({ id: 'con-direct-pickup', organizationId: 'org-wheelsonauto', applicationId: 'application-direct-calendar', onboardingSessionId: 'onboard-direct-calendar', customer: 'Direct Pickup Customer', vehicleId: 'veh-direct-pickup-car', vehicle: '2026 Direct Pickup Car', status: 'Signed - awaiting pickup' });
    duplicateState.applications.unshift({ id: 'application-direct-calendar', organizationId: 'org-wheelsonauto', name: 'Direct Pickup Customer', vehicleId: 'veh-direct-pickup-car', onlineVehicleId: 'online-direct-pickup', status: 'Approved - pickup confirmed', stage: 'Ready for pickup' });
    duplicateState.onboardingSessions.unshift({ id: 'onboard-direct-calendar', organizationId: 'org-wheelsonauto', applicationId: 'application-direct-calendar', onlineVehicleId: 'online-direct-pickup', status: 'Pickup confirmed' });
    duplicateState.onlineVehicles.unshift({ id: 'online-direct-pickup', organizationId: 'org-wheelsonauto', platformVehicleId: 'veh-direct-pickup-car', title: '2026 Direct Pickup Car', published: false, availability: 'Held - pickup scheduled' });
    duplicateState.recurringPayments.unshift({ id: 'rec-direct-draft-portal', customer: 'Direct Draft Portal Customer', phone: '3135550188', email: 'direct-draft-portal@example.com', vehicle: 'Direct Draft Portal Car', amount: 77, status: 'Active' });
    duplicateState.recurringPayments.unshift({ id: 'rec-direct-missing-portal-draft', customer: 'Direct Missing Portal Draft Customer', phone: '3135550189', email: 'direct-missing-portal@example.com', vehicle: 'Direct Missing Portal Draft Car', amount: 79, status: 'Active' });
    duplicateState.customerAccounts.unshift({ id: 'direct-draft-portal-login', name: 'Direct Draft Portal Customer', customer: 'Direct Draft Portal Customer', username: 'direct-draft-portal', phone: '3135550188', email: 'direct-draft-portal@example.com', status: 'Active', recurringPaymentId: 'rec-direct-draft-portal' });
    duplicateState.maintenance.unshift(
      { id: 'mnt-direct-autopay-file-open', vehicleId: 'veh-direct-autopay-file', vehicle: '2026 Direct Autopay File Car', vin: 'DIRECTAUTOPAYFILEVIN', plate: 'DIR-AUTO', tracker: 'TRK-AUTO', customer: 'Previous Direct Service Customer', type: 'Monthly inspection', issue: 'Open inspection should follow reassigned vehicle', due: '2026-07-20', status: 'Scheduled' },
      { id: 'mnt-direct-exact-copy-a', vehicleId: 'veh-direct-dispute-car', vehicle: '2025 Direct Dispute Car', customer: 'Direct Dispute Customer', type: 'Monthly inspection / oil change', issue: 'Exact duplicate repair test', due: '2026-07-29', nextDue: '2026-07-29', status: 'Scheduled' },
      { id: 'mnt-direct-exact-copy-b', vehicleId: 'veh-direct-dispute-car', vehicle: '2025 Direct Dispute Car', customer: 'Direct Dispute Customer', type: 'Monthly inspection / oil change', issue: 'Exact duplicate repair test', due: '2026-07-29', nextDue: '2026-07-29', status: 'Scheduled' }
    );
    duplicateState.pickupAppointments.unshift({ id: 'pickup-direct-calendar', organizationId: 'org-wheelsonauto', applicationId: 'application-direct-calendar', onboardingSessionId: 'onboard-direct-calendar', onlineVehicleId: 'online-direct-pickup', customer: 'Direct Pickup Customer', phone: '3135550177', vehicleId: 'veh-direct-pickup-car', vehicle: '2026 Direct Pickup Car', vin: 'DIRECTPICKUPVIN001', plate: 'DIR-PUP', date: '2026-07-20', time: '11:30 AM', durationMinutes: 30, address: '5150 NJ-42, Blackwood, NJ 08012', status: 'Confirmed' });
    duplicateState.claims.unshift(
      { id: 'claim-direct-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', externalId: 'pay-direct-dispute', amount: 199, status: 'Open' },
      { id: 'claim-direct-recurring-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', cloverCustomerId: 'direct-dispute-customer-id', amount: 111, status: 'Open' },
      { id: 'claim-signal-text-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', amount: 321, status: 'Open', notes: 'Clover dispute note: Signal Match Person / VIN SIGNALVIN123456789 / tag SIG-77.' },
      { id: 'claim-direct-candidate-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', amount: 199, status: 'Open' },
      { id: 'claim-direct-toll-review', type: 'Toll', source: 'Manual toll import', provider: 'E-ZPass', customer: 'Unassigned', plate: 'DIR-TOLL', reference: 'TOLL-DIRECT-001', amount: 12.75, status: 'Open', customerMatchStatus: 'Needs payment/customer match' },
      { id: 'claim-direct-unmatched-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', externalId: 'missing-payment-id', amount: 55, status: 'Open' }
    );
    const duplicateWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: duplicateState });
    assert(duplicateWrite.status === 200 && duplicateWrite.json.ok && duplicateWrite.json.version, 'Owner state write failed or did not return the saved state version.');
    const savedStateVersion = await request(server, 'GET', '/api/state/version', { cookie: ownerCookie });
    assert(savedStateVersion.json.version === duplicateWrite.json.version, 'State version endpoint should match the version returned by the completed save.');
    assert(savedStateVersion.json.version !== initialStateVersion.json.version, 'State version should change immediately after a real save.');
    const duplicateRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const duplicateRows = (duplicateRead.json.vehicles || []).filter(vehicle => String(vehicle.name || '').startsWith('Direct Duplicate'));
    assert(duplicateRows.length === 2, 'Duplicate ID repair should preserve both rows.');
    assert(new Set(duplicateRows.map(vehicle => vehicle.id)).size === 2, 'Duplicate ID repair should make unique vehicle IDs.');
    const duplicateMaintenance = (duplicateRead.json.maintenance || []).filter(row => String(row.id || '').startsWith('mnt-direct-exact-copy-'));
    assert(duplicateMaintenance.length === 2, 'Exact duplicate service repair should preserve both history rows.');
    assert(duplicateMaintenance.filter(row => row.status === 'Scheduled').length === 1, 'Exactly one duplicate service row should remain active.');
    const archivedMaintenance = duplicateMaintenance.find(row => row.status === 'Duplicate');
    assert(archivedMaintenance && archivedMaintenance.duplicateOf, 'The copied service row should be archived and linked to the active record.');
    const repairedDispute = (duplicateRead.json.claims || []).find(claim => claim.id === 'claim-direct-dispute');
    assert(repairedDispute && repairedDispute.customer === 'Direct Dispute Customer', 'Clover dispute should pick up the customer name from the linked payment.');
    assert(repairedDispute.customerMatchSource === 'Payment record', 'Clover dispute should record the payment-match source.');
    const recurringDispute = (duplicateRead.json.claims || []).find(claim => claim.id === 'claim-direct-recurring-dispute');
    assert(recurringDispute && recurringDispute.customer === 'Direct Recurring Dispute Customer', 'Clover dispute should match by Clover customer ID when payment ID is unavailable.');
    assert(recurringDispute.customerMatchSource === 'Recurring customer', 'Clover customer-id dispute should record recurring match source.');
    const textDispute = (duplicateRead.json.claims || []).find(claim => claim.id === 'claim-signal-text-dispute');
    assert(textDispute && textDispute.customer === 'Signal Match Person' && textDispute.customerMatchSource === 'Claim text evidence', 'Clover dispute should match by customer/VIN/tag text evidence when IDs are missing: ' + JSON.stringify(textDispute || null));
    assert(textDispute.vin === 'SIGNALVIN123456789' && textDispute.plate === 'SIG-77', 'Text-evidence dispute should carry VIN and tag evidence.');
    const unmatchedDispute = (duplicateRead.json.claims || []).find(claim => claim.id === 'claim-direct-unmatched-dispute');
    assert(unmatchedDispute && unmatchedDispute.customerMatchStatus === 'Needs payment/customer match', 'Unmatched Clover dispute should be clearly flagged for manual match.');
    const candidateDispute = (duplicateRead.json.claims || []).find(claim => claim.id === 'claim-direct-candidate-dispute');
    assert(candidateDispute && candidateDispute.customerMatchStatus === 'Needs payment/customer match', 'Amount-only Clover dispute should still require manual match.');
    const disputeCandidate = (candidateDispute.matchCandidates || []).find(candidate => candidate.customer === 'Direct Dispute Customer');
    assert(disputeCandidate, 'Amount-only Clover dispute should surface possible customer/payment matches.');
    assert(disputeCandidate.vehicleId === 'veh-direct-dispute-car', 'Dispute match candidate should carry vehicle ID evidence.');
    assert(disputeCandidate.vin === 'DIRECTDISPUTEVIN' && disputeCandidate.plate === 'DIR-DSP', 'Dispute match candidate should carry VIN and tag evidence.');
    assert(disputeCandidate.tracker === 'TRK-DSP', 'Dispute match candidate should carry tracker evidence.');
    assert(disputeCandidate.phone === '3135550199' && disputeCandidate.email === 'direct-dispute-customer@example.com', 'Dispute match candidate should carry contact evidence.');
    assert(String(disputeCandidate.matchReason || '').includes('same amount'), 'Dispute match candidate should explain why it was suggested.');

    const blockedWebhookDispute = await request(server, 'POST', '/api/webhooks/clover', {
      json: {
        type: 'chargeback.created',
        payment: { id: 'pay-direct-webhook-dispute' },
        dispute: { id: 'disp-direct-webhook-blocked' },
        amount: 8800
      }
    });
    assert(blockedWebhookDispute.status === 401, 'Clover dispute webhook should require the configured secret.');

    const cloverVerificationCode = '5220ecf5-7dea-4396-b0ba-a1659c182887';
    const cloverVerification = await request(server, 'POST', '/api/webhooks/clover', { json: { verificationCode: cloverVerificationCode } });
    assert(cloverVerification.status === 200 && cloverVerification.json.verificationCodeReceived, 'Clover app webhook verification handshake should accept only the verification-code payload without treating it as a payment event.');
    const verificationState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(verificationState.json.integrations.clover.pendingVerificationCode === cloverVerificationCode, 'Owner state should expose the pending Clover verification code without exposing webhook secrets.');

    const cloverAppEvent = {
      appId: 'DIRECTCLOVERAPP',
      merchants: {
        'direct-clover-merchant': [
          { objectId: 'P:pay-direct-app-event', type: 'CREATE', ts: 1783526400000 },
          { objectId: 'C:customer-direct-app-event', type: 'UPDATE', ts: 1783526401000 }
        ]
      }
    };
    const acceptedCloverAppEvent = await request(server, 'POST', '/api/webhooks/clover', { headers: { 'x-clover-auth': 'direct-clover-secret' }, json: cloverAppEvent });
    assert(acceptedCloverAppEvent.status === 200 && acceptedCloverAppEvent.json.ok && !acceptedCloverAppEvent.json.duplicate, 'Clover X-Clover-Auth payment/customer event should be accepted.');
    const repeatedCloverAppEvent = await request(server, 'POST', '/api/webhooks/clover', { headers: { 'x-clover-auth': 'direct-clover-secret' }, json: cloverAppEvent });
    assert(repeatedCloverAppEvent.status === 200 && repeatedCloverAppEvent.json.duplicate, 'Repeated Clover app events should be idempotent.');
    const wrongMerchantCloverAppEvent = await request(server, 'POST', '/api/webhooks/clover', {
      headers: { 'x-clover-auth': 'direct-clover-secret' },
      json: { appId: 'DIRECTCLOVERAPP', merchants: { 'another-merchant': [{ objectId: 'P:wrong-merchant-payment', type: 'CREATE', ts: 1783526402000 }] } }
    });
    assert(wrongMerchantCloverAppEvent.status === 200 && wrongMerchantCloverAppEvent.json.ignored, 'Authenticated Clover app events for a different merchant should be acknowledged without entering WheelsonAuto data.');
    const cloverAppEventState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const savedCloverAppEvents = (cloverAppEventState.json.integrations.clover.webhookEvents || []).filter(row => row.kind === 'Clover app event' && (row.objectIds || []).includes('P:pay-direct-app-event'));
    assert(savedCloverAppEvents.length === 1 && savedCloverAppEvents[0].authorization === 'X-Clover-Auth', 'Clover app event should be stored once with payment/customer object IDs and its verified authorization method.');

    const webhookDispute = await request(server, 'POST', '/api/webhooks/clover', {
      headers: { 'x-clover-webhook-secret': 'direct-clover-secret' },
      json: {
        type: 'chargeback.created',
        payment: { id: 'pay-direct-webhook-dispute' },
        dispute: { id: 'disp-direct-webhook' },
        amount: 8800,
        reason: 'Customer dispute opened in Clover'
      }
    });
    assert(webhookDispute.status === 200 && webhookDispute.json.ok, 'Clover dispute webhook should be accepted.');
    const webhookDisputeRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const webhookClaim = (webhookDisputeRead.json.claims || []).find(claim => claim.disputeId === 'disp-direct-webhook');
    assert(webhookClaim && webhookClaim.customer === 'Direct Webhook Dispute Customer', 'Clover dispute webhook should match the customer by payment ID: ' + JSON.stringify(webhookClaim || null));
    assert(webhookClaim.customerMatchSource === 'Payment record', 'Clover dispute webhook should record the payment-match source.');

    const customerWebhookDispute = await request(server, 'POST', '/api/webhooks/clover', {
      headers: { 'x-clover-webhook-secret': 'direct-clover-secret' },
      json: {
        type: 'chargeback.created',
        customer: { id: 'direct-dispute-customer-id' },
        dispute: { id: 'disp-direct-customer-webhook' },
        amount: 11100,
        reason: 'Customer-id only dispute opened in Clover'
      }
    });
    assert(customerWebhookDispute.status === 200 && customerWebhookDispute.json.ok, 'Clover customer-id dispute webhook should be accepted.');
    const customerWebhookRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const customerWebhookClaim = (customerWebhookRead.json.claims || []).find(claim => claim.disputeId === 'disp-direct-customer-webhook');
    assert(customerWebhookClaim && customerWebhookClaim.customer === 'Direct Recurring Dispute Customer', 'Clover dispute webhook should match by customer ID when payment ID is missing: ' + JSON.stringify(customerWebhookClaim || null));
    assert(customerWebhookClaim.customerMatchSource === 'Recurring customer', 'Customer-id dispute webhook should record recurring customer match source.');

    const directAutopayFile = await request(server, 'POST', '/api/recurring-payments', {
      cookie: ownerCookie,
      json: {
        customer: 'Direct Autopay File Customer',
        phone: '3135550666',
        email: 'direct-autopay-file@example.com',
        vehicleId: 'veh-direct-autopay-file',
        amount: 123,
        frequency: 'Weekly',
        firstRun: '2026-07-20',
        nextRun: '2026-07-20',
        chargeTime: '18:00',
        status: 'Active',
        paymentSetup: 'After card setup'
      }
    });
    assert(directAutopayFile.status === 201 && directAutopayFile.json.ok, 'Creating autopay with selected vehicle should succeed.');
    const directAutopayFileRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const directRecurring = (directAutopayFileRead.json.recurringPayments || []).find(row => row.customer === 'Direct Autopay File Customer');
    const directCustomer = (directAutopayFileRead.json.customers || []).find(row => row.name === 'Direct Autopay File Customer');
    const directContract = (directAutopayFileRead.json.contracts || []).find(row => row.customer === 'Direct Autopay File Customer');
    const directVehicle = (directAutopayFileRead.json.vehicles || []).find(row => row.id === 'veh-direct-autopay-file');
    const directOpenMaintenance = (directAutopayFileRead.json.maintenance || []).find(row => row.id === 'mnt-direct-autopay-file-open');
    assert(directRecurring && directRecurring.vehicleId === 'veh-direct-autopay-file' && directRecurring.vin === 'DIRECTAUTOPAYFILEVIN', 'New autopay should keep selected vehicle VIN/tag/tracker on the recurring row.');
    assert(directCustomer && directCustomer.vehicleId === 'veh-direct-autopay-file' && directCustomer.vin === 'DIRECTAUTOPAYFILEVIN' && directCustomer.weeklyAmount === 123, 'New autopay should create a connected customer record.');
    assert(directContract && directContract.vehicleId === 'veh-direct-autopay-file' && directContract.vin === 'DIRECTAUTOPAYFILEVIN' && directContract.weekly === 123, 'New autopay should create a rich customer file.');
    assert(directVehicle && directVehicle.currentCustomer === 'Direct Autopay File Customer' && directVehicle.status === 'Rented', 'Selected vehicle should move from Ready to assigned/rented for the new autopay customer.');
    assert(directOpenMaintenance && directOpenMaintenance.customer === 'Direct Autopay File Customer' && directOpenMaintenance.previousCustomer === 'Previous Direct Service Customer' && directOpenMaintenance.vin === 'DIRECTAUTOPAYFILEVIN' && directOpenMaintenance.plate === 'DIR-AUTO' && directOpenMaintenance.tracker === 'TRK-AUTO', 'Open service work should follow the reassigned vehicle with customer/VIN/tag/tracker context.');
    const driftRepairState = JSON.parse(JSON.stringify(directAutopayFileRead.json));
    driftRepairState.vehicles.unshift({ id: 'veh-direct-drift-repair', organizationId: 'org-wheelsonauto', year: 2025, make: 'Direct', model: 'Drift Repair', vin: 'DIRECTDRIFTVIN', plate: 'DIR-DRIFT', tempTag: 'TMP-DRIFT', tracker: 'TRK-DRIFT', currentCustomer: 'Old Drift Customer', status: 'Rented' });
    driftRepairState.recurringPayments.unshift({ id: 'rec-direct-drift-repair', organizationId: 'org-wheelsonauto', customer: 'New Drift Customer', vehicleId: 'veh-direct-drift-repair', amount: 144, frequency: 'Weekly', status: 'Active', nextRun: '2026-07-22' });
    driftRepairState.customers.unshift({ id: 'cus-direct-drift-repair', organizationId: 'org-wheelsonauto', name: 'New Drift Customer', vehicleId: 'veh-direct-drift-repair', status: 'Active' });
    driftRepairState.maintenance.unshift({ id: 'mnt-direct-drift-repair', organizationId: 'org-wheelsonauto', vehicleId: 'veh-direct-drift-repair', vehicle: '2025 Direct Drift Repair', customer: 'Old Drift Customer', status: 'Scheduled', type: 'Inspection', issue: 'Should follow active assignment', due: '2026-07-22' });
    const driftRepairWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: driftRepairState });
    assert(driftRepairWrite.status === 200 && driftRepairWrite.json.ok, 'Owner could not save drift repair scenario.');
    const driftRepairRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const driftVehicle = (driftRepairRead.json.vehicles || []).find(row => row.id === 'veh-direct-drift-repair');
    const driftRecurring = (driftRepairRead.json.recurringPayments || []).find(row => row.id === 'rec-direct-drift-repair');
    const driftService = (driftRepairRead.json.maintenance || []).find(row => row.id === 'mnt-direct-drift-repair');
    assert(driftVehicle && driftVehicle.currentCustomer === 'New Drift Customer', 'Active autopay should repair stale vehicle current customer.');
    assert(driftRecurring && driftRecurring.vin === 'DIRECTDRIFTVIN' && driftRecurring.plate === 'DIR-DRIFT' && driftRecurring.tracker === 'TRK-DRIFT', 'Active autopay should inherit vehicle VIN/tag/tracker during truth repair.');
    assert(driftService && driftService.customer === 'New Drift Customer' && driftService.previousCustomer === 'Old Drift Customer' && driftService.vin === 'DIRECTDRIFTVIN', 'Open service should follow repaired active vehicle assignment.');
    const readinessBeforeAssignment = await request(server, 'POST', '/api/system/readiness', { cookie: ownerCookie });
    assert(readinessBeforeAssignment.status === 200 && readinessBeforeAssignment.json, 'System readiness should return JSON before assignment regression scenarios.');
    const autopayVehicleCountBefore = Number((readinessBeforeAssignment.json.truthChecks.find(row => row.key === 'autopay_vehicle_link') || {}).count || 0);
    const serviceIdentityCountBefore = Number((readinessBeforeAssignment.json.truthChecks.find(row => row.key === 'service_identity') || {}).count || 0);
    const assignmentConflictState = JSON.parse(JSON.stringify(driftRepairRead.json));
    assignmentConflictState.customers.unshift({ id: 'cus-direct-numeric-vehicle', organizationId: 'org-wheelsonauto', name: 'Direct Numeric Vehicle', vehicle: '109', weeklyAmount: 109, status: 'Active' });
    assignmentConflictState.vehicles.unshift({ id: 'veh-direct-assignment-alias', organizationId: 'org-wheelsonauto', year: 2025, make: 'Direct', model: 'Alias Car', vin: 'DIRECTALIASVIN', plate: 'DIR-ALS', tracker: 'TRK-ALS', currentCustomer: 'Direct Alias Person', status: 'Rented' });
    assignmentConflictState.vehicles.unshift({ id: 'veh-direct-assignment-conflict', organizationId: 'org-wheelsonauto', year: 2025, make: 'Direct', model: 'Conflict Car', vin: 'DIRECTCONFLICTVIN', plate: 'DIR-CNF', tracker: 'TRK-CNF', status: 'Rented' });
    assignmentConflictState.recurringPayments.unshift(
      { id: 'rec-direct-alias-profile-only', organizationId: 'org-wheelsonauto', customer: 'Direct Long Alias Person', amount: 109, status: 'Active', nextRun: '2026-07-24' },
      { id: 'rec-direct-alias-short', organizationId: 'org-wheelsonauto', customer: 'Direct Alias Person', vehicleId: 'veh-direct-assignment-alias', amount: 109, status: 'Active', nextRun: '2026-07-24' },
      { id: 'rec-direct-alias-middle', organizationId: 'org-wheelsonauto', customer: 'Direct Middle Alias Person', vehicleId: 'veh-direct-assignment-alias', amount: 109, status: 'Active', nextRun: '2026-07-24' },
      { id: 'rec-direct-conflict-one', organizationId: 'org-wheelsonauto', customer: 'Direct Conflict One', vehicleId: 'veh-direct-assignment-conflict', amount: 111, status: 'Active', nextRun: '2026-07-24' },
      { id: 'rec-direct-conflict-two', organizationId: 'org-wheelsonauto', customer: 'Direct Conflict Two', vehicleId: 'veh-direct-assignment-conflict', amount: 112, status: 'Active', nextRun: '2026-07-24' }
    );
    assignmentConflictState.maintenance.unshift({ id: 'mnt-direct-open-inspection-no-checklist', organizationId: 'org-wheelsonauto', vehicleId: 'veh-direct-assignment-alias', vehicle: '2025 Direct Alias Car', vin: 'DIRECTALIASVIN', plate: 'DIR-ALS', tracker: 'TRK-ALS', customer: 'Direct Alias Person', status: 'Scheduled', type: 'Inspection', issue: 'Open inspection checklist is completed at sign-off', due: '2026-07-30' });
    const assignmentConflictWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: assignmentConflictState });
    assert(assignmentConflictWrite.status === 200 && assignmentConflictWrite.json.ok, 'Owner could not save assignment conflict scenario.');
    const assignmentConflictRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const numericVehicleCustomer = (assignmentConflictRead.json.customers || []).find(row => row.id === 'cus-direct-numeric-vehicle');
    const aliasVehicle = (assignmentConflictRead.json.vehicles || []).find(row => row.id === 'veh-direct-assignment-alias');
    const conflictVehicle = (assignmentConflictRead.json.vehicles || []).find(row => row.id === 'veh-direct-assignment-conflict');
    assert(numericVehicleCustomer && !numericVehicleCustomer.vehicle && numericVehicleCustomer.previousVehicle === '109', 'A payment amount must not remain displayed as a customer vehicle name.');
    assert(aliasVehicle && !aliasVehicle.assignmentConflict, 'Middle-name variants for the same customer should not create a vehicle assignment conflict.');
    assert(conflictVehicle && /Direct Conflict One/.test(conflictVehicle.assignmentConflict || '') && /Direct Conflict Two/.test(conflictVehicle.assignmentConflict || ''), 'Competing active autopays should mark the vehicle assignment conflict.');
    const conflictHealth = await request(server, 'GET', '/api/system/health', { cookie: ownerCookie });
    assert(conflictHealth.status === 200 && conflictHealth.json && Array.isArray(conflictHealth.json.issues), 'System health should return JSON after assignment conflict save. Got ' + conflictHealth.status + ': ' + String(conflictHealth.text || '').slice(0, 220));
    assert(conflictHealth.json.issues.some(row => row.key === 'vehicle_assignment_conflict' && row.count >= 1 && row.view === 'Operations' && row.tab === 'Assigned'), 'System health should flag vehicle assignment conflicts and route to Operations / Assigned.');
    const conflictReadiness = await request(server, 'POST', '/api/system/readiness', { cookie: ownerCookie });
    assert(conflictReadiness.status === 200 && conflictReadiness.json, 'System readiness should return JSON after assignment conflict save. Got ' + conflictReadiness.status + ': ' + String(conflictReadiness.text || '').slice(0, 220));
    assert(conflictReadiness.json.truthChecks.some(row => row.key === 'vehicle_assignment_conflict' && row.count >= 1 && row.view === 'Operations' && row.tab === 'Assigned'), 'System readiness should flag vehicle assignment conflicts and route to Operations / Assigned.');
    assert(Number((conflictReadiness.json.truthChecks.find(row => row.key === 'autopay_vehicle_link') || {}).count || 0) === autopayVehicleCountBefore, 'An autopay name alias connected through the customer/fleet truth layer must not inflate the missing-vehicle readiness count.');
    assert(Number((conflictReadiness.json.truthChecks.find(row => row.key === 'service_identity') || {}).count || 0) === serviceIdentityCountBefore, 'An open inspection with customer, vehicle identity, and due date must not be treated as incomplete before mechanic sign-off.');
    const conflictReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: ownerCookie });
    assert(conflictReport.text.includes('Vehicle assignment conflicts') && conflictReport.text.includes('DIRECTCONFLICTVIN'), 'Deep report should include vehicle assignment conflict QA and fleet evidence.');
    const readinessCleanupState = JSON.parse(JSON.stringify(assignmentConflictRead.json));
    readinessCleanupState.recurringPayments = readinessCleanupState.recurringPayments.filter(row => row.id !== 'rec-direct-alias-profile-only');
    readinessCleanupState.maintenance = readinessCleanupState.maintenance.filter(row => row.id !== 'mnt-direct-open-inspection-no-checklist');
    const readinessCleanupWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: readinessCleanupState });
    assert(readinessCleanupWrite.status === 200 && readinessCleanupWrite.json.ok, 'Owner could not clean up readiness-only regression records.');

    const onlineVehicleOne = await request(server, 'POST', '/api/online-vehicles', {
      cookie: ownerCookie,
      json: { id: 'online-direct-001', platformVehicleId: 'veh-001', title: '2016 Ford Focus Hatch', weeklyPayment: 229, downPayment: 500, availability: 'Available', published: true }
    });
    assert(onlineVehicleOne.status === 201 && onlineVehicleOne.json.ok, 'Owner could not publish the direct smoke vehicle.');
    const onlineVehicleTwo = await request(server, 'POST', '/api/online-vehicles', {
      cookie: ownerCookie,
      json: { id: 'online-direct-002', title: '2017 Ford Fusion', year: '2017', make: 'Ford', model: 'Fusion', weeklyPayment: 250, downPayment: 600, availability: 'Available', published: true }
    });
    assert(onlineVehicleTwo.status === 201 && onlineVehicleTwo.json.ok, 'Owner could not publish the second direct smoke vehicle.');
    const duplicateOnlineVehicle = await request(server, 'POST', '/api/online-vehicles', {
      cookie: ownerCookie,
      json: { id: 'online-direct-duplicate', platformVehicleId: 'veh-001', title: 'Duplicate Ford Focus', weeklyPayment: 229, downPayment: 500, availability: 'Available', published: true }
    });
    assert(duplicateOnlineVehicle.status === 409 && /already connected/i.test(duplicateOnlineVehicle.json.error || ''), 'One internal fleet car must not be linked to two online vehicle records.');
    const publicApplication = await request(server, 'POST', '/api/public/applications', {
      json: nativePublicApplicationPayload()
    });
    assert(publicApplication.status === 201 && publicApplication.json.ok, 'Public application did not save.');
    const repeatedPublicApplication = await request(server, 'POST', '/api/public/applications', {
      json: nativePublicApplicationPayload()
    });
    assert(repeatedPublicApplication.status === 200 && repeatedPublicApplication.json.duplicate === true && repeatedPublicApplication.json.application.id === publicApplication.json.application.id, 'A repeated same-person/same-car submission must return the existing application instead of creating a duplicate.');
    const sharedPhoneState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    sharedPhoneState.json.customers.unshift({ id: 'cus-direct-shared-phone-old', organizationId: 'org-wheelsonauto', name: 'Old Shared Phone Customer', phone: '3135550147', vehicleId: 'veh-direct-shared-phone-old', vehicle: '2014 Private Old Car', vin: 'PRIVATEOLDVIN001', status: 'History' });
    sharedPhoneState.json.vehicles.unshift({ id: 'veh-direct-shared-phone-old', organizationId: 'org-wheelsonauto', name: '2014 Private Old Car', vin: 'PRIVATEOLDVIN001', plate: 'OLD-PRIVATE', currentCustomer: 'Old Shared Phone Customer', status: 'Rented' });
    sharedPhoneState.json.recurringPayments.unshift({ id: 'rec-direct-shared-phone-old', organizationId: 'org-wheelsonauto', customer: 'Old Shared Phone Customer', phone: '3135550147', vehicleId: 'veh-direct-shared-phone-old', vehicle: '2014 Private Old Car', vin: 'PRIVATEOLDVIN001', amount: 888, cardLast4: '9098', cloverPaymentSource: 'secret-shared-phone-source', status: 'Removed' });
    sharedPhoneState.json.payments.unshift({ id: 'pay-direct-shared-phone-old', organizationId: 'org-wheelsonauto', customer: 'Old Shared Phone Customer', phone: '3135550147', recurringPaymentId: 'rec-direct-shared-phone-old', vehicleId: 'veh-direct-shared-phone-old', vin: 'PRIVATEOLDVIN001', amount: 888, status: 'Paid', source: 'Private old payment' });
    const sharedPhoneWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: sharedPhoneState.json });
    assert(sharedPhoneWrite.status === 200 && sharedPhoneWrite.json.ok, 'Owner could not seed the shared-phone portal isolation scenario.');
    const isolatedApplication = await request(server, 'POST', '/api/public/applications', {
      headers: { 'x-forwarded-for': '198.51.100.88' },
      json: nativePublicApplicationPayload({
        onlineVehicleId: 'online-direct-002',
        firstName: 'Isolated',
        lastName: 'Applicant',
        phone: '3135550147',
        email: 'isolated-applicant@example.com',
        password: 'IsolatedApplicant123!'
      })
    });
    assert(isolatedApplication.status === 201 && isolatedApplication.json.ok, 'Shared-phone applicant should create a separate pending portal account.');
    const isolatedPortalLogin = await request(server, 'POST', '/customer/login', { form: { username: 'isolated-applicant@example.com', password: 'IsolatedApplicant123!' } });
    assert(isolatedPortalLogin.status === 302, 'Shared-phone pending applicant could not log in to the customer portal.');
    const isolatedPortalState = await request(server, 'GET', '/api/customer/portal-state', { cookie: cleanCookie(isolatedPortalLogin.cookie) });
    const isolatedPortalText = JSON.stringify(isolatedPortalState.json && isolatedPortalState.json.portal || {});
    assert(isolatedPortalState.status === 200 && isolatedPortalState.json.ok, 'Shared-phone pending applicant portal state did not load.');
    assert(isolatedPortalState.json.portal.application.id === isolatedApplication.json.application.id && /2017 Ford Fusion/i.test(isolatedPortalState.json.portal.summary.vehicle || ''), 'Pending applicant portal should show only its own application and selected public vehicle.');
    assert(!isolatedPortalText.includes('Old Shared Phone Customer') && !isolatedPortalText.includes('PRIVATEOLDVIN001') && !isolatedPortalText.includes('OLD-PRIVATE') && !isolatedPortalText.includes('9098') && !isolatedPortalText.includes('pay-direct-shared-phone-old'), 'A pending applicant must not inherit another customer file, vehicle, saved card, or payment through a shared phone.');
    assert(!isolatedPortalText.includes('systemHealth') && !isolatedPortalText.includes('platformModules'), 'Customer portal state must not expose internal platform health or module counts.');
    const deniedIsolatedApplication = await request(server, 'POST', '/api/applications/review', { cookie: ownerCookie, json: { applicationId: isolatedApplication.json.application.id, decision: 'deny', notes: 'Direct smoke applicant cleanup.' } });
    assert(deniedIsolatedApplication.status === 200 && deniedIsolatedApplication.json.ok && deniedIsolatedApplication.json.portalDisabled, 'Owner should be able to deny/archive an unapproved application and disable its pending portal login.');
    const deniedPortalState = await request(server, 'GET', '/api/customer/portal-state', { cookie: cleanCookie(isolatedPortalLogin.cookie) });
    assert(deniedPortalState.status === 401, 'A denied application must immediately lose customer portal access.');
    const deniedApplicationState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const deniedApplicationRow = deniedApplicationState.json.applications.find(row => row.id === isolatedApplication.json.application.id);
    const deniedApplicationAccount = deniedApplicationState.json.customerAccounts.find(row => row.applicationId === isolatedApplication.json.application.id);
    const releasedApplicationVehicle = deniedApplicationState.json.onlineVehicles.find(row => row.id === 'online-direct-002');
    assert(deniedApplicationRow && deniedApplicationRow.stage === 'Denied' && deniedApplicationAccount && deniedApplicationAccount.status === 'Disabled', 'Denied application and pending login should move to archived/disabled state together.');
    assert(releasedApplicationVehicle && releasedApplicationVehicle.published === true && releasedApplicationVehicle.availability === 'Available', 'Denying an application should leave its unused online vehicle available for another applicant.');
    for (let i = 0; i < 8; i += 1) {
      const limitedApplicationAttempt = await request(server, 'POST', '/api/public/applications', { headers: { 'x-forwarded-for': '192.0.2.' + i + ', 198.51.100.77' }, json: {} });
      assert([400, 409].includes(limitedApplicationAttempt.status), 'Public application attempts should validate normally before the per-IP submission limit.');
    }
    const blockedApplicationAttempt = await request(server, 'POST', '/api/public/applications', { headers: { 'x-forwarded-for': '192.0.2.250, 198.51.100.77' }, json: {} });
    assert(blockedApplicationAttempt.status === 429 && String(blockedApplicationAttempt.headers['Retry-After'] || '').length, 'Public application flooding must return 429 with retry guidance despite spoofed forwarded prefixes.');

    const weakStaffPassword = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-weak-staff',
        name: 'Direct Weak Staff',
        username: 'direct-weak-staff',
        password: 'weakpass',
        role: 'Mechanic',
        organizationId: 'org-wheelsonauto',
        status: 'Active'
      }
    });
    assert(weakStaffPassword.status === 400 && /letter and one number/i.test(weakStaffPassword.json.error || ''), 'Weak staff passwords should be rejected before account creation.');

    const forbiddenOwnerStaff = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-forbidden-owner-staff',
        name: 'Direct Forbidden Owner Staff',
        username: 'direct-forbidden-owner-staff',
        password: 'DirectForbiddenOwner123!',
        role: 'Owner',
        organizationId: 'org-wheelsonauto',
        status: 'Active'
      }
    });
    assert(forbiddenOwnerStaff.status === 400 && /Manager or Mechanic/i.test(forbiddenOwnerStaff.json.error || ''), 'Owner-level access must never be created through a staff account.');

    const pinOnlyStaff = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-pin-only-staff',
        name: 'Direct Pin Only Staff',
        username: 'direct-pin-only-staff',
        role: 'Mechanic',
        organizationId: 'org-wheelsonauto',
        status: 'Active',
        pinHint: '7899'
      }
    });
    assert(pinOnlyStaff.status === 400 && /password/i.test(pinOnlyStaff.json.error || ''), 'New staff accounts should require a password, not PIN-only access.');

    const mechanic = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-mechanic',
        name: 'Direct Mechanic',
        username: 'direct-mechanic',
        password: 'DirectMechanic123!',
        role: 'Mechanic',
        organizationId: 'org-wheelsonauto',
        status: 'Active',
        pinHint: '7811'
      }
    });
    assert(mechanic.status === 200 && mechanic.json && mechanic.json.ok, 'Owner could not create mechanic: ' + mechanic.status + ' ' + mechanic.text.slice(0, 240));
    const staffPinLoginAttempt = await request(server, 'POST', '/login', { form: { pin: '7811' } });
    assert(staffPinLoginAttempt.status === 401, 'Staff PIN login should be disabled by default; staff should use username/password.');

    const manager = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-manager',
        name: 'Direct Manager',
        username: 'direct-manager',
        password: 'DirectManager123!',
        role: 'Manager',
        organizationId: 'org-wheelsonauto',
        status: 'Active',
        pinHint: '7822'
      }
    });
    assert(manager.status === 200 && manager.json.ok, 'Owner could not create manager.');

    const managerEdit = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-manager',
        name: 'Direct Manager Edited',
        username: 'direct-manager',
        role: 'Manager',
        organizationId: 'org-wheelsonauto',
        status: 'Active',
        phone: '3135550888',
        pinHint: '7822'
      }
    });
    assert(managerEdit.status === 200 && managerEdit.json.ok, 'Owner could not edit manager without replacing password.');

    const staffForgotPage = await request(server, 'GET', '/forgot');
    assert(staffForgotPage.status === 200 && staffForgotPage.text.includes('Reset staff access'), 'Staff forgot-password page did not render.');
    const staffResetRequest = await request(server, 'POST', '/forgot', { form: { identity: 'direct-manager' } });
    assert(staffResetRequest.status === 200 && staffResetRequest.text.includes('request was sent'), 'Staff reset request did not save.');
    const staffResetState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(staffResetState.json.messages.some(message => message.event === 'staff_password_reset' && message.staffAccountId === 'direct-manager'), 'Staff reset request should be saved in Messages.');
    assert((staffResetState.json.auditLogs || []).some(row => row.action === 'Staff password help requested' && String(row.details || '').includes('Direct Manager') && String(row.details || '').includes('Matched staff account')), 'Staff reset request should be owner audit logged.');
    const resetRequestedStaff = (staffResetState.json.staffAccounts || []).find(account => account.id === 'direct-manager');
    assert(resetRequestedStaff && resetRequestedStaff.passwordResetStatus === 'Requested' && resetRequestedStaff.passwordResetRequestedAt, 'Staff reset request should mark the staff login for owner follow-up.');
    const resetManagerPassword = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-manager',
        name: 'Direct Manager Edited',
        username: 'direct-manager',
        password: 'DirectManager456!',
        role: 'Manager',
        organizationId: 'org-wheelsonauto',
        status: 'Active',
        phone: '3135550888',
        pinHint: '7822'
      }
    });
    assert(resetManagerPassword.status === 200 && resetManagerPassword.json.ok && resetManagerPassword.json.staff.passwordResetStatus === 'Reset complete', 'Owner staff password reset should clear the staff reset request.');
    assert(!resetManagerPassword.json.staff.passwordHash && !resetManagerPassword.json.staff.passwordSalt, 'Staff reset response should not expose password secrets.');
    const oldStaffPasswordAttempt = await request(server, 'POST', '/login', { form: { username: 'direct-manager', password: 'DirectManager123!' } });
    assert(oldStaffPasswordAttempt.status === 401, 'Old staff password should stop working after owner reset.');

    const weakCustomerPassword = await request(server, 'POST', '/api/customer-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-weak-customer-login',
        name: 'Weak Customer',
        customer: 'Weak Customer',
        username: 'direct-weak-customer',
        password: '12345678',
        status: 'Active'
      }
    });
    assert(weakCustomerPassword.status === 400 && /letter and one number/i.test(weakCustomerPassword.json.error || ''), 'Weak customer portal passwords should be rejected before login creation.');

    const customerLogin = await request(server, 'POST', '/api/customer-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-customer-login',
        name: 'Alicia Brown',
        customer: 'Alicia Brown',
        username: 'direct-customer',
        password: 'DirectCustomer123!',
        phone: '(856) 555-0171',
        email: 'alicia@example.com',
        recurringPaymentId: 'rec-001',
        status: 'Active'
      }
    });
    assert(customerLogin.status === 200 && customerLogin.json.ok, 'Owner could not create customer login.');
    assert(customerLogin.json.loginUrl.endsWith('/customer/login'), 'Customer login URL should be returned.');
    assert(customerLogin.json.account.loginReady === true, 'Customer login API should mark password-backed accounts as login ready.');
    assert(!customerLogin.json.account.passwordHash && !customerLogin.json.account.passwordSalt, 'Customer login API should not expose password secrets.');
    assert(customerLogin.json.account.contractId || customerLogin.json.account.customerId || customerLogin.json.account.vehicleId || customerLogin.json.account.recurringPaymentId, 'Customer login should auto-link to an existing customer file, vehicle, contract, or autopay record.');
    const cleanPortalLogin = await request(server, 'POST', '/customer/login', { form: { username: 'direct-customer', password: 'DirectCustomer123!' } });
    const cleanPortalState = await request(server, 'GET', '/api/customer/portal-state', { cookie: cleanCookie(cleanPortalLogin.cookie) });
    assert(cleanPortalState.status === 200 && cleanPortalState.json.ok, 'Customer portal state should load immediately after login creation.');
    assert(String(cleanPortalState.json.portal.summary.vehicle || '').trim().toLowerCase() !== 'alicia brown', 'A missing vehicle must not inherit the customer name as a fake car title.');

    const duplicateCustomerLogin = await request(server, 'POST', '/api/customer-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-customer-login-duplicate',
        name: 'Duplicate Alicia',
        customer: 'Duplicate Alicia',
        username: 'direct-customer',
        password: 'DirectCustomer123!',
        status: 'Active'
      }
    });
    assert(duplicateCustomerLogin.status === 409, 'Duplicate customer portal username should be blocked.');

    const franchise = await request(server, 'POST', '/api/organizations', {
      cookie: ownerCookie,
      json: {
        id: 'direct-franchise',
        name: 'Direct Franchise Test',
        type: 'Subscription client',
        status: 'Active',
        plan: 'Pro',
        primaryAdmin: 'Direct Owner',
        fleetCount: 12,
        legalBusinessName: 'Direct Franchise Legal LLC',
        entityType: 'LLC',
        businessContactFirstName: 'Direct',
        businessContactLastName: 'Owner',
        businessPhone: '3135550168',
        businessEmail: 'owner@direct-franchise.example',
        serviceStreet: '100 Provider Test Way',
        serviceCity: 'Detroit',
        serviceState: 'Michigan',
        servicePostalCode: '48201',
        serviceCountry: 'United States',
        taxIdStatus: 'Ready in provider',
        ein: '12-3456789',
        taxId: '12-3456789',
        ssn: '123-45-6789',
        dataScope: 'Isolated tenant',
        billingOwner: 'WheelsonAuto'
      }
    });
    assert(franchise.status === 200 && franchise.json.ok && franchise.json.organization.id === 'direct-franchise', 'Owner could not create company/franchise account.');
    assert(franchise.json.organization.dataScope === 'Shared owner account', 'Company/franchise should stay owner-managed until multi-tenant isolation is enabled.');
    assert(franchise.json.organization.legalBusinessName === 'Direct Franchise Legal LLC' && franchise.json.organization.servicePostalCode === '48201' && franchise.json.organization.taxIdStatus === 'Ready in provider', 'Owner company provider profile did not save its trusted legal identity and service address.');
    assert(!Object.prototype.hasOwnProperty.call(franchise.json.organization, 'ein') && !Object.prototype.hasOwnProperty.call(franchise.json.organization, 'taxId') && !Object.prototype.hasOwnProperty.call(franchise.json.organization, 'ssn'), 'Company provider profile must never store full EIN, tax ID, or SSN values.');

    const duplicateFranchise = await request(server, 'POST', '/api/organizations', {
      cookie: ownerCookie,
      json: { id: 'direct-franchise-copy', name: 'Direct Franchise Test', type: 'Subscription client', status: 'Active' }
    });
    assert(duplicateFranchise.status === 409, 'Duplicate company/franchise names should be blocked.');

    const badStaffCompany = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-bad-company-staff',
        name: 'Bad Company Staff',
        username: 'direct-bad-company-staff',
        password: 'DirectBadCompany123!',
        role: 'Manager',
        organizationId: 'missing-company',
        status: 'Active'
      }
    });
    assert(badStaffCompany.status === 400, 'Staff account with missing company/store should be rejected.');

    const franchiseStaff = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-franchise-manager',
        name: 'Direct Franchise Manager',
        username: 'direct-franchise-manager',
        password: 'DirectFranchiseManager123!',
        role: 'Manager',
        organizationId: 'direct-franchise',
        status: 'Active'
      }
    });
    assert(franchiseStaff.status === 200 && franchiseStaff.json.ok && franchiseStaff.json.staff.companyName === 'Direct Franchise Test', 'Staff account should attach only to saved company/franchise records.');

    const franchiseManagerCookie = await login(server, { username: 'direct-franchise-manager', password: 'DirectFranchiseManager123!' });
    const billingMainManagerCookie = await login(server, { username: 'direct-manager', password: 'DirectManager456!' });
    const billingMechanicCookie = await login(server, { username: 'direct-mechanic', password: 'DirectMechanic123!' });
    const franchiseState = await request(server, 'GET', '/api/state', { cookie: franchiseManagerCookie });
    assert(franchiseState.status === 200 && franchiseState.json && Array.isArray(franchiseState.json.organizations), 'Franchise manager state did not load.');
    assert((franchiseState.json.organizations || []).length === 1 && franchiseState.json.organizations[0].id === 'direct-franchise', 'Franchise manager should only see their company account.');
    assert(!Object.prototype.hasOwnProperty.call(franchiseState.json.organizations[0], 'serviceStreet') && !Object.prototype.hasOwnProperty.call(franchiseState.json.organizations[0], 'businessEmail') && !Object.prototype.hasOwnProperty.call(franchiseState.json.organizations[0], 'taxIdStatus'), 'Manager state should not expose owner provider-onboarding profile details.');
    assert(!(franchiseState.json.vehicles || []).some(vehicle => vehicle.id === 'veh-001'), 'Franchise manager should not see main WheelsonAuto fleet records.');
    assert(!JSON.stringify(franchiseState.json).includes('Direct Dispute Customer'), 'Franchise manager should not see main customer/payment/dispute records.');

    const franchiseSubscription = await request(server, 'POST', '/api/billing/subscriptions', {
      cookie: ownerCookie,
      json: {
        organizationId: 'direct-franchise',
        plan: 'Starter',
        status: 'Trialing',
        amount: 149,
        currentPeriodStart: '2026-07-01',
        currentPeriodEnd: '2026-07-31',
        provider: 'direct-billing-adapter',
        providerCustomerId: 'direct-private-billing-customer',
        providerSubscriptionId: 'direct-private-billing-subscription'
      }
    });
    assert(franchiseSubscription.status === 201 && franchiseSubscription.json.ok && franchiseSubscription.json.summary.subscription.plan === 'Starter', 'Owner should create one company-scoped subscription.');
    const updatedFranchiseSubscription = await request(server, 'POST', '/api/billing/subscriptions', {
      cookie: ownerCookie,
      json: { organizationId: 'direct-franchise', plan: 'Growth', status: 'Active', amount: 249, fleetLimit: 90 }
    });
    assert(updatedFranchiseSubscription.status === 200 && updatedFranchiseSubscription.json.summary.subscription.id === franchiseSubscription.json.summary.subscription.id && updatedFranchiseSubscription.json.summary.capacity.fleet.limit === 90, 'Updating a company subscription should preserve one row and its stable identity.');
    const blockedManagerSubscriptionWrite = await request(server, 'POST', '/api/billing/subscriptions', { cookie: franchiseManagerCookie, json: { organizationId: 'direct-franchise', plan: 'Enterprise' } });
    assert(blockedManagerSubscriptionWrite.status === 403, 'Manager must not change company subscriptions.');
    const franchiseInvoice = await request(server, 'POST', '/api/billing/invoices/record', {
      cookie: ownerCookie,
      json: { organizationId: 'direct-franchise', providerInvoiceId: 'direct-franchise-invoice-1', amount: 249, status: 'Paid', periodStart: '2026-07-01', periodEnd: '2026-07-31' }
    });
    assert(franchiseInvoice.status === 201 && franchiseInvoice.json.ok, 'Owner should record a company invoice.');
    const duplicateFranchiseInvoice = await request(server, 'POST', '/api/billing/invoices/record', {
      cookie: ownerCookie,
      json: { organizationId: 'direct-franchise', providerInvoiceId: 'direct-franchise-invoice-1', amount: 249, status: 'Paid' }
    });
    assert(duplicateFranchiseInvoice.status === 200 && duplicateFranchiseInvoice.json.created === false && duplicateFranchiseInvoice.json.summary.invoices.filter(invoice => invoice.providerInvoiceId === 'direct-franchise-invoice-1').length === 1, 'Repeated company invoice references must update instead of duplicate.');
    const franchiseBillingSummary = await request(server, 'GET', '/api/billing/summary', { cookie: franchiseManagerCookie });
    assert(franchiseBillingSummary.status === 200 && franchiseBillingSummary.json.summary.organization.id === 'direct-franchise' && franchiseBillingSummary.json.summary.subscription.plan === 'Growth', 'Manager should see only their own company billing summary.');
    assert(!JSON.stringify(franchiseBillingSummary.json).includes('direct-private-billing-customer') && !JSON.stringify(franchiseBillingSummary.json).includes('direct-private-billing-subscription') && !JSON.stringify(franchiseBillingSummary.json).includes('direct-franchise-invoice-1'), 'Manager billing summary must not expose provider customer, subscription, or invoice references.');
    const mainManagerBillingSummary = await request(server, 'GET', '/api/billing/summary?organizationId=direct-franchise', { cookie: billingMainManagerCookie });
    assert(mainManagerBillingSummary.status === 200 && mainManagerBillingSummary.json.summary.organization.id === 'org-wheelsonauto' && mainManagerBillingSummary.json.summary.invoices.length === 0, 'A manager must not select another company through the billing summary query.');
    const mechanicBillingSummary = await request(server, 'GET', '/api/billing/summary', { cookie: billingMechanicCookie });
    assert(mechanicBillingSummary.status === 403, 'Mechanic must not view company billing data.');
    const blockedBillingWebhook = await request(server, 'POST', '/api/webhooks/billing', { headers: { 'x-billing-webhook-secret': 'wrong-secret' }, json: { eventId: 'billing-provider-blocked', organizationId: 'direct-franchise', type: 'invoice.paid' } });
    assert(blockedBillingWebhook.status === 401, 'Billing provider webhook must reject invalid credentials.');
    const signedBillingPayload = { eventId: 'billing-provider-signed-1', organizationId: 'direct-franchise', provider: 'direct-billing-adapter', type: 'invoice.paid', invoiceId: 'direct-provider-invoice-2', amount: 249, status: 'paid' };
    const signedBillingBody = JSON.stringify(signedBillingPayload);
    const billingTimestamp = String(Math.floor(Date.now() / 1000));
    const billingSignature = crypto.createHmac('sha256', 'direct-billing-secret').update(billingTimestamp + '.' + signedBillingBody).digest('hex');
    const signedBillingWebhook = await request(server, 'POST', '/api/webhooks/billing', { headers: { 'x-billing-timestamp': billingTimestamp, 'x-billing-signature': 'sha256=' + billingSignature }, json: signedBillingPayload });
    assert(signedBillingWebhook.status === 200 && signedBillingWebhook.json.authorization === 'HMAC-SHA256' && signedBillingWebhook.json.received === 1 && signedBillingWebhook.json.invoices === 1, 'Timestamped HMAC billing event should update the company invoice ledger.');
    const repeatedBillingWebhook = await request(server, 'POST', '/api/webhooks/billing', { headers: { 'x-billing-timestamp': billingTimestamp, 'x-billing-signature': 'sha256=' + billingSignature }, json: signedBillingPayload });
    assert(repeatedBillingWebhook.status === 200 && repeatedBillingWebhook.json.duplicates === 1 && repeatedBillingWebhook.json.received === 0, 'Repeated signed billing events must remain idempotent.');
    const ownerBillingSubscriptions = await request(server, 'GET', '/api/billing/subscriptions', { cookie: ownerCookie });
    const directFranchiseBilling = ownerBillingSubscriptions.json.summaries.find(summary => summary.organization.id === 'direct-franchise');
    assert(ownerBillingSubscriptions.status === 200 && directFranchiseBilling && directFranchiseBilling.invoices.length === 2 && ownerBillingSubscriptions.json.events.some(event => event.authorization === 'HMAC-SHA256'), 'Owner billing control should show the exact subscription, deduplicated invoices, and signed provider evidence.');

    const franchiseWriteState = JSON.parse(JSON.stringify(franchiseState.json));
    franchiseWriteState.vehicles = [{
      id: 'direct-franchise-car',
      organizationId: 'direct-franchise',
      year: 2026,
      make: 'Franchise',
      model: 'Fleet Car',
      vin: 'DIRECTFRANCHISEVIN',
      plate: 'FRANCHISE-1',
      status: 'Ready'
    }];
    const franchiseWrite = await request(server, 'PUT', '/api/state', { cookie: franchiseManagerCookie, json: franchiseWriteState });
    assert(franchiseWrite.status === 200 && franchiseWrite.json.ok, 'Franchise manager could not save their scoped fleet record.');
    const ownerAfterFranchiseWrite = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert((ownerAfterFranchiseWrite.json.vehicles || []).some(vehicle => vehicle.id === 'veh-001'), 'Franchise manager save should not remove main WheelsonAuto fleet records.');
    assert((ownerAfterFranchiseWrite.json.vehicles || []).some(vehicle => vehicle.id === 'direct-franchise-car' && vehicle.organizationId === 'direct-franchise'), 'Franchise manager save should keep the scoped franchise fleet record.');
    assert((ownerAfterFranchiseWrite.json.staffAccounts || []).some(staff => staff.id === 'direct-mechanic'), 'Franchise manager save should not remove main staff accounts.');
    assert((ownerAfterFranchiseWrite.json.staffAccounts || []).some(staff => staff.id === 'direct-manager'), 'Franchise manager save should not remove main manager accounts.');
    const franchiseSpoofState = JSON.parse(JSON.stringify(franchiseState.json));
    franchiseSpoofState.messages = [{
      id: 'direct-franchise-spoof-message',
      organizationId: 'org-wheelsonauto',
      customer: 'Spoofed org customer',
      channel: 'SMS',
      direction: 'Outbound',
      status: 'Draft',
      body: 'This should be scoped to the signed-in franchise company.'
    }];
    const franchiseSpoofWrite = await request(server, 'PUT', '/api/state', { cookie: franchiseManagerCookie, json: franchiseSpoofState });
    assert(franchiseSpoofWrite.status === 200 && franchiseSpoofWrite.json.ok, 'Franchise manager spoof save should be accepted but re-scoped.');
    const ownerAfterFranchiseSpoof = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const spoofedMessage = (ownerAfterFranchiseSpoof.json.messages || []).find(message => message.id === 'direct-franchise-spoof-message');
    assert(spoofedMessage && spoofedMessage.organizationId === 'direct-franchise', 'Staff saves must stamp incoming rows to the signed-in company, not a spoofed organization id.');

    const franchiseCustomerState = JSON.parse(JSON.stringify(ownerAfterFranchiseWrite.json));
    franchiseCustomerState.customers = franchiseCustomerState.customers || [];
    franchiseCustomerState.recurringPayments = franchiseCustomerState.recurringPayments || [];
    franchiseCustomerState.payments = franchiseCustomerState.payments || [];
    franchiseCustomerState.messages = franchiseCustomerState.messages || [];
    franchiseCustomerState.customers.unshift({ id: 'direct-franchise-customer-file', organizationId: 'direct-franchise', name: 'Alicia Brown', phone: '3135558899', email: 'franchise-alicia@example.com', vehicleId: 'direct-franchise-car', vehicle: '2026 Franchise Fleet Car', licensePlate: 'FRANCHISE-1' });
    franchiseCustomerState.recurringPayments.unshift({ id: 'direct-franchise-recurring', organizationId: 'direct-franchise', customer: 'Alicia Brown', phone: '3135558899', email: 'franchise-alicia@example.com', vehicleId: 'direct-franchise-car', vehicle: '2026 Franchise Fleet Car', amount: 88, status: 'Active', nextRun: '2026-07-15' });
    franchiseCustomerState.payments.unshift({ id: 'direct-franchise-payment', organizationId: 'direct-franchise', customer: 'Alicia Brown', recurringPaymentId: 'direct-franchise-recurring', vehicleId: 'direct-franchise-car', amount: 88, status: 'Paid', source: 'Franchise test' });
    franchiseCustomerState.messages.unshift({ id: 'direct-franchise-message', organizationId: 'direct-franchise', customer: 'Alicia Brown', phone: '3135558899', channel: 'SMS', direction: 'Inbound', status: 'Received', body: 'Franchise-only customer message.' });
    const franchiseCustomerWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: franchiseCustomerState });
    assert(franchiseCustomerWrite.status === 200 && franchiseCustomerWrite.json.ok, 'Owner could not seed franchise customer portal records.');
    const franchiseManagerCustomerState = await request(server, 'GET', '/api/state', { cookie: franchiseManagerCookie });
    assert((franchiseManagerCustomerState.json.recurringPayments || []).some(row => row.id === 'direct-franchise-recurring' && row.vehicleId === 'direct-franchise-car' && row.email === 'franchise-alicia@example.com'), 'Franchise manager state should enrich Alicia Brown only from franchise company records.');
    assert(!JSON.stringify(franchiseManagerCustomerState.json).includes('veh-001') && !JSON.stringify(franchiseManagerCustomerState.json).includes('Direct Dispute Customer'), 'Franchise manager state should not leak main-company records during profile enrichment.');
    const franchiseCustomerAccount = await request(server, 'POST', '/api/customer-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-franchise-customer-login',
        organizationId: 'direct-franchise',
        name: 'Alicia Brown',
        customer: 'Alicia Brown',
        username: 'direct-franchise-customer',
        password: 'DirectFranchiseCustomer123!',
        phone: '3135558899',
        email: 'franchise-alicia@example.com',
        customerId: 'direct-franchise-customer-file',
        recurringPaymentId: 'direct-franchise-recurring',
        vehicleId: 'direct-franchise-car',
        status: 'Active'
      }
    });
    assert(franchiseCustomerAccount.status === 200 && franchiseCustomerAccount.json.ok, 'Owner could not create franchise customer portal login.');
    const franchiseCustomerLogin = await request(server, 'POST', '/customer/login', { form: { username: 'direct-franchise-customer', password: 'DirectFranchiseCustomer123!' } });
    assert(franchiseCustomerLogin.status === 302 && String(franchiseCustomerLogin.cookie).includes('woa_customer_session=v2.customer.'), 'Franchise customer login did not set a signed customer session.');
    const franchiseCustomerCookie = cleanCookie(franchiseCustomerLogin.cookie);
    const franchisePortalState = await request(server, 'GET', '/api/customer/portal-state', { cookie: franchiseCustomerCookie });
    assert(franchisePortalState.status === 200 && franchisePortalState.json.ok, 'Franchise customer portal state did not load.');
    assert(franchisePortalState.json.portal.vehicle.id === 'direct-franchise-car', 'Franchise customer portal should show the franchise vehicle, not the main matching-name vehicle.');
    assert(franchisePortalState.json.portal.recurring.id === 'direct-franchise-recurring', 'Franchise customer portal should show the franchise recurring payment.');
    assert(JSON.stringify(franchisePortalState.json).includes('Franchise-only customer message'), 'Franchise customer portal should show scoped franchise messages.');
    assert(!JSON.stringify(franchisePortalState.json).includes('veh-001') && !JSON.stringify(franchisePortalState.json).includes('Direct Dispute Customer'), 'Franchise customer portal should not expose main WheelsonAuto records.');

    const franchiseReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: franchiseManagerCookie });
    assert(franchiseReport.status === 200 && /text\/csv/.test(franchiseReport.headers['Content-Type'] || franchiseReport.headers['content-type'] || ''), 'Franchise manager deep report should download as CSV.');
    assert(franchiseReport.text.includes('Daily closeout') && franchiseReport.text.includes('Customer files') && franchiseReport.text.includes('Fleet profitability'), 'Franchise manager deep report is missing core sections.');
    assert(franchiseReport.text.includes('DIRECTFRANCHISEVIN') && franchiseReport.text.includes('Franchise test'), 'Franchise manager deep report should include scoped franchise customer, fleet, and payment records.');
    assert(!franchiseReport.text.includes('Direct Dispute Customer') && !franchiseReport.text.includes('veh-001'), 'Franchise manager deep report should not expose main WheelsonAuto records.');
    const franchiseHealth = await request(server, 'GET', '/api/system/health', { cookie: franchiseManagerCookie });
    assert(franchiseHealth.status === 200 && franchiseHealth.json && franchiseHealth.json.organizationId === 'direct-franchise', 'Franchise manager system health should be scoped to their company.');
    assert(franchiseHealth.json.star && /admin approval/i.test(franchiseHealth.json.star.guardrails || ''), 'Franchise manager system health should include Star guardrails.');
    const franchiseReadiness = await request(server, 'POST', '/api/system/readiness', { cookie: franchiseManagerCookie });
    assert(franchiseReadiness.status === 200 && franchiseReadiness.json && franchiseReadiness.json.organizationId === 'direct-franchise', 'Franchise manager readiness should be scoped to their company.');
    assert(franchiseReadiness.json.records.vehicles === 1 && franchiseReadiness.json.records.customerAccounts === 1, 'Franchise manager readiness should only count scoped franchise fleet and customer portal records.');

    const mechanicCookie = await login(server, { username: 'direct-mechanic', password: 'DirectMechanic123!' });
    const managerCookie = await login(server, { username: 'direct-manager', password: 'DirectManager456!' });
    const managerResetAttempt = await request(server, 'POST', '/api/reset', { cookie: managerCookie, json: {} });
    assert(managerResetAttempt.status === 403, 'Manager must never be able to reset platform data.');
    const ownerResetWithoutMaintenanceFlag = await request(server, 'POST', '/api/reset', { cookie: ownerCookie, json: {} });
    assert(ownerResetWithoutMaintenanceFlag.status === 403 && /disabled/i.test(ownerResetWithoutMaintenanceFlag.json.error || ''), 'Even owner data reset must stay disabled unless the maintenance-only environment flag is explicitly enabled.');

    const ownerReconciliation = await request(server, 'GET', '/api/integrations/clover/reconciliation', { cookie: ownerCookie });
    assert(ownerReconciliation.status === 200 && ownerReconciliation.json.ok && ownerReconciliation.json.counts.disputes >= 1, 'Owner Clover reconciliation should expose disputes, refunds, webhook events, and unmatched payments.');
    assert(ownerReconciliation.json.unmatchedPayments.filter(row => row.cloverPaymentId === 'pay-direct-unmatched-duplicate').length === 1, 'Clover reconciliation must merge duplicate unmatched rows by provider payment id.');
    assert(ownerReconciliation.json.counts.unmatchedPayments === ownerReconciliation.json.unmatchedPayments.length, 'Clover reconciliation count must reflect the deduplicated unmatched queue.');
    const unmatchedPaymentId = ownerReconciliation.json.unmatchedPayments.find(row => row.cloverPaymentId === 'pay-direct-unmatched-duplicate').id;
    const managerReconciliation = await request(server, 'GET', '/api/integrations/clover/reconciliation', { cookie: managerCookie });
    assert(managerReconciliation.status === 403, 'Manager must not access Clover reconciliation or money controls.');
    const managerPaymentMatch = await request(server, 'POST', '/api/integrations/clover/payments/match', { cookie: managerCookie, json: { paymentId: unmatchedPaymentId, customer: 'Direct Dispute Customer' } });
    assert(managerPaymentMatch.status === 403, 'Manager must not match Clover payments to customer files.');
    const ownerPaymentMatch = await request(server, 'POST', '/api/integrations/clover/payments/match', { cookie: ownerCookie, json: { paymentId: unmatchedPaymentId, customer: 'Direct Dispute Customer' } });
    assert(ownerPaymentMatch.status === 200 && ownerPaymentMatch.json.ok && ownerPaymentMatch.json.matched >= 1, 'Owner Clover payment matching should update every surviving saved row for the same provider payment: ' + JSON.stringify(ownerPaymentMatch.json));
    assert(ownerPaymentMatch.json.payment.customer === 'Direct Dispute Customer' && ownerPaymentMatch.json.payment.vin === 'DIRECTDISPUTEVIN' && ownerPaymentMatch.json.payment.plate === 'DIR-DSP', 'Matched Clover payments must inherit customer, vehicle, VIN, and tag context.');
    const matchedReconciliation = await request(server, 'GET', '/api/integrations/clover/reconciliation', { cookie: ownerCookie });
    assert(!matchedReconciliation.json.unmatchedPayments.some(row => row.cloverPaymentId === 'pay-direct-unmatched-duplicate'), 'A confirmed Clover payment match must leave the unmatched queue immediately.');

    const managerRefundPrepare = await request(server, 'POST', '/api/integrations/clover/refunds/prepare', { cookie: managerCookie, json: { paymentId: 'clover-payment-direct-dispute', amount: 50, reason: 'Direct role test' } });
    assert(managerRefundPrepare.status === 403, 'Manager must not prepare customer refunds.');
    const preparedRefund = await request(server, 'POST', '/api/integrations/clover/refunds/prepare', { cookie: ownerCookie, json: { paymentId: 'clover-payment-direct-dispute', amount: 50, reason: 'Direct partial refund test' } });
    assert(preparedRefund.status === 201 && preparedRefund.json.refund.status === 'Clover POS action required', 'Partial or POS refund should create a tracked Clover action instead of pretending it was sent.');
    assert(preparedRefund.json.refund.organizationId === 'org-wheelsonauto', 'Prepared refund should preserve company scope: ' + JSON.stringify(preparedRefund.json.refund));
    assert(preparedRefund.json.refund.customer === 'Direct Dispute Customer', 'Prepared refund should preserve customer identity: ' + JSON.stringify(preparedRefund.json.refund));
    const duplicateRefund = await request(server, 'POST', '/api/integrations/clover/refunds/prepare', { cookie: ownerCookie, json: { paymentId: 'clover-payment-direct-dispute', amount: 50, reason: 'Direct partial refund test' } });
    assert(duplicateRefund.status === 200 && duplicateRefund.json.created === false && duplicateRefund.json.refund.id === preparedRefund.json.refund.id, 'Repeated refund preparation should be idempotent.');
    const unconfirmedRefund = await request(server, 'POST', '/api/integrations/clover/refunds/execute', { cookie: ownerCookie, json: { refundId: preparedRefund.json.refund.id } });
    assert(unconfirmedRefund.status === 409, 'Live Clover refund execution must require immediate owner confirmation.');
    const unconfirmedManualRefund = await request(server, 'POST', '/api/integrations/clover/refunds/complete-manual', { cookie: ownerCookie, json: { refundId: preparedRefund.json.refund.id, providerRefundId: 'refund-direct-manual' } });
    assert(unconfirmedManualRefund.status === 409, 'Manual Clover refund completion must require owner confirmation.');
    const completedManualRefund = await request(server, 'POST', '/api/integrations/clover/refunds/complete-manual', { cookie: ownerCookie, json: { refundId: preparedRefund.json.refund.id, providerRefundId: 'refund-direct-manual', confirmed: true } });
    assert(completedManualRefund.status === 200 && completedManualRefund.json.refund.status === 'Manual complete', 'Owner should be able to close a refund only after confirming the Clover reference.');
    const repeatManualRefund = await request(server, 'POST', '/api/integrations/clover/refunds/complete-manual', { cookie: ownerCookie, json: { refundId: preparedRefund.json.refund.id, providerRefundId: 'refund-direct-manual', confirmed: true } });
    assert(repeatManualRefund.status === 200, 'Repeating the same manual refund confirmation should remain safe.');
    const refundState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(Number((refundState.json.payments || []).find(row => row.id === 'clover-payment-direct-dispute').refundedAmount) === 50, 'Idempotent manual refund confirmation must not double-count the refunded amount.');

    const managerDisputeAction = await request(server, 'POST', '/api/integrations/clover/disputes/action', { cookie: managerCookie, json: { claimId: 'claim-direct-dispute', action: 'evidence_ready', confirmed: true } });
    assert(managerDisputeAction.status === 403, 'Manager must not change Clover dispute response status.');
    const unmatchedDisputeAction = await request(server, 'POST', '/api/integrations/clover/disputes/action', { cookie: ownerCookie, json: { claimId: 'claim-direct-unmatched-dispute', action: 'evidence_ready', confirmed: true } });
    assert(unmatchedDisputeAction.status === 409, 'Dispute evidence must stay blocked until customer and payment are matched.');
    const matchedDisputeAction = await request(server, 'POST', '/api/integrations/clover/disputes/action', { cookie: ownerCookie, json: { claimId: 'claim-direct-dispute', action: 'evidence_ready', confirmed: true, notes: 'Direct smoke packet reviewed.' } });
    assert(matchedDisputeAction.status === 200 && matchedDisputeAction.json.dispute.status === 'Evidence ready', 'Matched Clover dispute should advance through the owner-confirmed response workflow.');

    const mechanicVerificationCreate = await request(server, 'POST', '/api/verification/cases', { cookie: mechanicCookie, json: { type: 'identity', customer: 'Blocked Mechanic Verification' } });
    assert(mechanicVerificationCreate.status === 403, 'Mechanic must not create identity or insurance verification cases.');
    const providerVerification = await request(server, 'POST', '/api/verification/cases', { cookie: managerCookie, json: { type: 'driver_license', customer: 'Direct Dispute Customer', vehicleId: 'veh-direct-dispute-car', provider: 'Direct Identity Adapter', externalCaseId: 'identity-direct-provider-1', reference: 'D12345678901234', expiresAt: '2030-01-15' } });
    assert(providerVerification.status === 201 && providerVerification.json.verificationCase.status === 'Provider pending', 'Manager should be able to open a provider-neutral driver-license verification case.');
    assert(providerVerification.json.verificationCase.referenceLast4 === '1234' && !JSON.stringify(providerVerification.json).includes('D12345678901234'), 'Verification records must retain only the last four characters of sensitive identity references.');
    const blockedVerificationWebhook = await request(server, 'POST', '/api/webhooks/verification', { headers: { 'x-verification-webhook-secret': 'wrong-secret' }, json: { externalCaseId: 'identity-direct-provider-1', status: 'verified' } });
    assert(blockedVerificationWebhook.status === 401, 'Verification provider webhook must reject an invalid signature secret.');
    const oversizedVerificationWebhook = await request(server, 'POST', '/api/webhooks/verification', { headers: { 'x-verification-webhook-secret': 'direct-verification-secret' }, json: { externalCaseId: 'identity-direct-provider-1', notes: 'x'.repeat(257 * 1024) } });
    assert(oversizedVerificationWebhook.status === 413, 'Verification provider webhook must reject oversized payloads while streaming.');
    const legacyVerificationWebhook = await request(server, 'POST', '/api/webhooks/verification', { headers: { 'x-verification-webhook-secret': 'direct-verification-secret' }, json: { externalCaseId: 'identity-direct-provider-1', status: 'processing', provider: 'Direct Identity Adapter', reference: 'verification-legacy-event-1' } });
    assert(legacyVerificationWebhook.status === 200 && legacyVerificationWebhook.json.authorization === 'Shared secret', 'Existing verification shared-secret callbacks must remain compatible during provider migration.');
    const signedVerificationPayload = { externalCaseId: 'identity-direct-provider-1', status: 'verified', provider: 'Direct Identity Adapter', reference: 'verification-signed-event-1' };
    const signedVerificationBody = JSON.stringify(signedVerificationPayload);
    const verificationTimestamp = String(Math.floor(Date.now() / 1000));
    const verificationSignature = crypto.createHmac('sha256', 'direct-verification-secret').update(verificationTimestamp + '.' + signedVerificationBody).digest('hex');
    const acceptedVerificationWebhook = await request(server, 'POST', '/api/webhooks/verification', { headers: { 'x-verification-timestamp': verificationTimestamp, 'x-verification-signature': 'sha256=' + verificationSignature }, json: signedVerificationPayload });
    assert(acceptedVerificationWebhook.status === 200 && acceptedVerificationWebhook.json.authorization === 'HMAC-SHA256' && acceptedVerificationWebhook.json.verificationCase.status === 'Verified', 'Timestamped HMAC verification result should update the linked case.');
    const repeatedVerificationWebhook = await request(server, 'POST', '/api/webhooks/verification', { headers: { 'x-verification-timestamp': verificationTimestamp, 'x-verification-signature': 'sha256=' + verificationSignature }, json: signedVerificationPayload });
    assert(repeatedVerificationWebhook.status === 200 && repeatedVerificationWebhook.json.duplicate === true && repeatedVerificationWebhook.json.received === false, 'Repeated verification provider event IDs must be idempotent.');
    const staleVerificationTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    const staleVerificationSignature = crypto.createHmac('sha256', 'direct-verification-secret').update(staleVerificationTimestamp + '.' + signedVerificationBody).digest('hex');
    const staleVerificationWebhook = await request(server, 'POST', '/api/webhooks/verification', { headers: { 'x-verification-timestamp': staleVerificationTimestamp, 'x-verification-signature': staleVerificationSignature }, json: signedVerificationPayload });
    assert(staleVerificationWebhook.status === 401, 'Verification HMAC signatures older than five minutes must be rejected.');
    const manualInsurance = await request(server, 'POST', '/api/verification/cases', { cookie: managerCookie, json: { type: 'insurance', customer: 'Direct Dispute Customer', vehicleId: 'veh-direct-dispute-car', provider: 'Manual', reference: 'POLICY-DIRECT-9876', expiresAt: '2030-02-01' } });
    assert(manualInsurance.status === 201 && manualInsurance.json.verificationCase.status === 'Needs staff review' && manualInsurance.json.verificationCase.policyNumberLast4 === '9876', 'Manual insurance verification should enter the staff review queue without retaining the full policy number.');
    const approvedInsurance = await request(server, 'POST', '/api/verification/cases/review', { cookie: managerCookie, json: { caseId: manualInsurance.json.verificationCase.id, decision: 'approve', expiresAt: '2030-02-01', insuredNameConfirmed: true, vehicleConfirmed: true, coverageConfirmed: true, datesConfirmed: true, notes: 'Insurance card and vehicle identity reviewed.' } });
    assert(approvedInsurance.status === 200 && approvedInsurance.json.verificationCase.status === 'Verified', 'Manager should be able to approve a reviewed insurance case.');
    const manualBackground = await request(server, 'POST', '/api/verification/cases', { cookie: managerCookie, json: { type: 'background', customer: 'Direct Dispute Customer', vehicleId: 'veh-direct-dispute-car', provider: 'Manual', reference: 'BACKGROUND-DIRECT-4321', notes: 'Applicant screening review.' } });
    assert(manualBackground.status === 201 && manualBackground.json.verificationCase.status === 'Needs staff review' && manualBackground.json.verificationCase.referenceLast4 === '4321' && !JSON.stringify(manualBackground.json).includes('BACKGROUND-DIRECT-4321'), 'Manual background verification should use the secure last-four-only review queue.');
    const approvedBackground = await request(server, 'POST', '/api/verification/cases/review', { cookie: managerCookie, json: { caseId: manualBackground.json.verificationCase.id, decision: 'approve', notes: 'Background screening evidence reviewed.' } });
    assert(approvedBackground.status === 200 && approvedBackground.json.verificationCase.status === 'Verified', 'Manager should be able to approve a reviewed background case.');
    const verificationStatus = await request(server, 'GET', '/api/verification/status', { cookie: managerCookie });
    assert(verificationStatus.status === 200 && String(verificationStatus.json.providers.background || '').toLowerCase() === 'manual' && verificationStatus.json.cases.some(row => row.id === providerVerification.json.verificationCase.id && row.status === 'Verified') && verificationStatus.json.cases.some(row => row.id === manualBackground.json.verificationCase.id && row.status === 'Verified'), 'Verification status should show signed provider outcomes and manual background reviews to managers.');
    const mechanicVerificationStatus = await request(server, 'GET', '/api/verification/status', { cookie: mechanicCookie });
    assert(mechanicVerificationStatus.status === 403, 'Mechanic must not view customer identity or insurance verification cases.');

    const mechanicTrackerStatus = await request(server, 'GET', '/api/integrations/tracker/status', { cookie: mechanicCookie });
    assert(mechanicTrackerStatus.status === 403, 'Mechanic must not receive tracker/GPS status or precise location records.');
    const managerTrackerSync = await request(server, 'POST', '/api/integrations/tracker/sync', {
      cookie: managerCookie,
      json: {
        updates: [
          { eventId: 'tracker-direct-manual-1', trackerId: 'TRK-DSP', status: 'Active', lastPing: '2026-07-16T14:00:00.000Z', location: 'Direct private tracker location', latitude: 39.751, longitude: -75.061 },
          { eventId: 'tracker-direct-portal-1', vehicleId: 'veh-003', status: 'Active', lastPing: '2026-07-16T14:01:00.000Z', location: 'Customer portal private tracker location', latitude: 39.752, longitude: -75.062 }
        ]
      }
    });
    assert(managerTrackerSync.status === 200 && managerTrackerSync.json.matched === 2 && managerTrackerSync.json.missing === 0, 'Manager tracker adapter should match exact saved tracker and vehicle IDs.');
    const duplicateTrackerSync = await request(server, 'POST', '/api/integrations/tracker/sync', { cookie: managerCookie, json: { eventId: 'tracker-direct-manual-1', trackerId: 'TRK-DSP', status: 'Active' } });
    assert(duplicateTrackerSync.status === 200 && duplicateTrackerSync.json.duplicates === 1 && duplicateTrackerSync.json.received === 0, 'Repeated tracker event IDs must remain idempotent through the server route.');
    const missingTrackerSync = await request(server, 'POST', '/api/integrations/tracker/sync', { cookie: managerCookie, json: { eventId: 'tracker-direct-missing-1', deviceId: 'TRK-NOT-IN-FLEET', status: 'Offline', location: 'Unknown device private location', latitude: 40.001, longitude: -75.001 } });
    assert(missingTrackerSync.status === 200 && missingTrackerSync.json.missing === 1, 'Unknown tracker devices should enter Missing file instead of attaching to a customer car.');
    const trackerStatus = await request(server, 'GET', '/api/integrations/tracker/status', { cookie: managerCookie });
    assert(trackerStatus.status === 200 && trackerStatus.json.vehicles.some(row => row.id === 'veh-direct-dispute-car' && row.trackerLocation === 'Direct private tracker location'), 'Manager tracker status should show the matched vehicle, last ping, and precise location.');
    assert(trackerStatus.json.unmatched.some(row => row.eventId === 'tracker-direct-missing-1') && !JSON.stringify(trackerStatus.json.unmatched).includes('Unknown device private location') && !JSON.stringify(trackerStatus.json.unmatched).includes('40.001'), 'Missing-file tracker rows must retain identifiers but never exact locations.');
    const blockedTrackerWebhook = await request(server, 'POST', '/api/webhooks/tracker', { headers: { 'x-tracker-webhook-secret': 'wrong-secret' }, json: { eventId: 'tracker-provider-blocked', trackerId: 'TRK-DSP' } });
    assert(blockedTrackerWebhook.status === 401, 'Tracker provider webhook must reject invalid credentials.');
    const signedTrackerPayload = { eventId: 'tracker-provider-signed-1', organizationId: 'org-wheelsonauto', trackerId: 'TRK-DSP', provider: 'direct-tracker-adapter', status: 'Moving', lastPing: '2026-07-16T14:05:00.000Z', location: 'Signed provider private location', latitude: 39.753, longitude: -75.063 };
    const signedTrackerBody = JSON.stringify(signedTrackerPayload);
    const trackerTimestamp = String(Math.floor(Date.now() / 1000));
    const trackerSignature = crypto.createHmac('sha256', 'direct-tracker-secret').update(trackerTimestamp + '.' + signedTrackerBody).digest('hex');
    const signedTrackerWebhook = await request(server, 'POST', '/api/webhooks/tracker', { headers: { 'x-tracker-timestamp': trackerTimestamp, 'x-tracker-signature': 'sha256=' + trackerSignature }, json: signedTrackerPayload });
    assert(signedTrackerWebhook.status === 200 && signedTrackerWebhook.json.authorization === 'HMAC-SHA256' && signedTrackerWebhook.json.matched === 1, 'Timestamped HMAC tracker update should reach the exact linked vehicle.');
    const repeatedTrackerWebhook = await request(server, 'POST', '/api/webhooks/tracker', { headers: { 'x-tracker-timestamp': trackerTimestamp, 'x-tracker-signature': 'sha256=' + trackerSignature }, json: signedTrackerPayload });
    assert(repeatedTrackerWebhook.status === 200 && repeatedTrackerWebhook.json.duplicates === 1 && repeatedTrackerWebhook.json.received === 0, 'Repeated signed tracker events must be idempotent.');
    const mechanicTrackerPrivacy = await request(server, 'GET', '/api/state', { cookie: mechanicCookie });
    assert(!JSON.stringify(mechanicTrackerPrivacy.json).includes('Signed provider private location') && !JSON.stringify(mechanicTrackerPrivacy.json).includes('Customer portal private tracker location') && !JSON.stringify(mechanicTrackerPrivacy.json).includes('39.753'), 'Mechanic state must retain tracker health without exposing exact locations or coordinates.');

    const mechanicMarketingStatus = await request(server, 'GET', '/api/integrations/marketing/status', { cookie: mechanicCookie });
    assert(mechanicMarketingStatus.status === 403, 'Mechanic must not receive marketing leads or customer contact details.');
    const managerMarketingSync = await request(server, 'POST', '/api/integrations/marketing/sync', {
      cookie: managerCookie,
      json: {
        eventId: 'marketing-direct-manual-1',
        leadId: 'marketing-direct-lead-1',
        applicationId: 'application-direct-calendar',
        campaign: 'Direct inventory campaign',
        source: 'Direct lead adapter',
        status: 'qualified'
      }
    });
    assert(managerMarketingSync.status === 200 && managerMarketingSync.json.created === 1 && managerMarketingSync.json.results[0].customerId === 'cus-direct-pickup' && managerMarketingSync.json.results[0].vehicleId === 'veh-direct-pickup-car' && managerMarketingSync.json.results[0].status === 'Converted', 'Manager marketing sync should link an exact application to its customer and vehicle conversion.');
    const duplicateMarketingSync = await request(server, 'POST', '/api/integrations/marketing/sync', { cookie: managerCookie, json: { eventId: 'marketing-direct-manual-1', leadId: 'marketing-direct-lead-1', applicationId: 'application-direct-calendar' } });
    assert(duplicateMarketingSync.status === 200 && duplicateMarketingSync.json.duplicates === 1 && duplicateMarketingSync.json.received === 0, 'Repeated marketing event IDs must remain idempotent through the server route.');
    const reviewMarketingSync = await request(server, 'POST', '/api/integrations/marketing/sync', { cookie: managerCookie, json: { eventId: 'marketing-direct-review-1', leadId: 'marketing-direct-review-lead', source: 'Incomplete provider lead' } });
    assert(reviewMarketingSync.status === 200 && reviewMarketingSync.json.results[0].status === 'Needs review' && reviewMarketingSync.json.results[0].matchStatus === 'Needs review', 'Incomplete provider leads should enter the existing Marketing review board instead of disappearing or matching loosely.');
    const marketingStatus = await request(server, 'GET', '/api/integrations/marketing/status', { cookie: managerCookie });
    assert(marketingStatus.status === 200 && marketingStatus.json.leads.some(row => row.externalLeadId === 'marketing-direct-lead-1' && row.applicationId === 'application-direct-calendar') && marketingStatus.json.counts.review >= 1, 'Manager marketing status should expose exact conversion links and the needs-review queue.');
    const blockedMarketingWebhook = await request(server, 'POST', '/api/webhooks/marketing', { headers: { 'x-marketing-webhook-secret': 'wrong-secret' }, json: { eventId: 'marketing-provider-blocked', leadId: 'marketing-direct-lead-1' } });
    assert(blockedMarketingWebhook.status === 401, 'Marketing provider webhook must reject invalid credentials.');
    const signedMarketingPayload = { eventId: 'marketing-provider-signed-1', leadId: 'marketing-direct-lead-1', organizationId: 'org-wheelsonauto', provider: 'direct-marketing-adapter', applicationId: 'application-direct-calendar', campaign: 'Signed campaign attribution', status: 'converted' };
    const signedMarketingBody = JSON.stringify(signedMarketingPayload);
    const marketingTimestamp = String(Math.floor(Date.now() / 1000));
    const marketingSignature = crypto.createHmac('sha256', 'direct-marketing-secret').update(marketingTimestamp + '.' + signedMarketingBody).digest('hex');
    const signedMarketingWebhook = await request(server, 'POST', '/api/webhooks/marketing', { headers: { 'x-marketing-timestamp': marketingTimestamp, 'x-marketing-signature': 'sha256=' + marketingSignature }, json: signedMarketingPayload });
    assert(signedMarketingWebhook.status === 200 && signedMarketingWebhook.json.authorization === 'HMAC-SHA256' && signedMarketingWebhook.json.updated === 1, 'Timestamped HMAC marketing update should advance the existing exact lead conversion.');
    const repeatedMarketingWebhook = await request(server, 'POST', '/api/webhooks/marketing', { headers: { 'x-marketing-timestamp': marketingTimestamp, 'x-marketing-signature': 'sha256=' + marketingSignature }, json: signedMarketingPayload });
    assert(repeatedMarketingWebhook.status === 200 && repeatedMarketingWebhook.json.duplicates === 1 && repeatedMarketingWebhook.json.received === 0, 'Repeated signed marketing events must remain idempotent.');

    const managerLedger = await request(server, 'GET', '/api/accounting/ledger', { cookie: managerCookie });
    assert(managerLedger.status === 200 && managerLedger.json.entries.some(row => row.customer === 'Direct Dispute Customer'), 'Manager accounting view should contain source-linked customer and vehicle records.');
    const mechanicLedger = await request(server, 'GET', '/api/accounting/ledger', { cookie: mechanicCookie });
    assert(mechanicLedger.status === 403, 'Mechanic must not view accounting records.');
    const managerLedgerRebuild = await request(server, 'POST', '/api/accounting/ledger/rebuild', { cookie: managerCookie, json: {} });
    assert(managerLedgerRebuild.status === 403, 'Only the owner can rebuild accounting records.');
    const rebuiltLedger = await request(server, 'POST', '/api/accounting/ledger/rebuild', { cookie: ownerCookie, json: {} });
    assert(rebuiltLedger.status === 200 && rebuiltLedger.json.entries.some(row => row.sourceKey === 'refund:' + preparedRefund.json.refund.id && row.direction === 'debit'), 'Accounting ledger should include the completed customer refund as a debit.');
    const accountingCsv = await request(server, 'GET', '/api/accounting/export.csv', { cookie: managerCookie });
    assert(accountingCsv.status === 200 && /text\/csv/.test(accountingCsv.headers['Content-Type'] || accountingCsv.headers['content-type'] || '') && accountingCsv.text.includes('Direct Dispute Customer') && accountingCsv.text.includes('DIRECTDISPUTEVIN'), 'QuickBooks-ready accounting CSV should retain customer, vehicle, and VIN context.');
    const quickBooksCsv = await request(server, 'GET', '/api/accounting/quickbooks.csv', { cookie: managerCookie });
    assert(quickBooksCsv.status === 200 && /text\/csv/.test(quickBooksCsv.headers['Content-Type'] || quickBooksCsv.headers['content-type'] || '') && quickBooksCsv.text.includes('Journal No.') && quickBooksCsv.text.includes('Debits') && quickBooksCsv.text.includes('Credits') && quickBooksCsv.text.includes('Clover Clearing') && quickBooksCsv.text.includes('Direct Dispute Customer'), 'QuickBooks journal CSV should be balanced-account ready and retain the source customer trail.');
    const mechanicQuickBooksCsv = await request(server, 'GET', '/api/accounting/quickbooks.csv', { cookie: mechanicCookie });
    assert(mechanicQuickBooksCsv.status === 403, 'Mechanic must not export QuickBooks accounting records.');

    const managerPickupCalendar = await request(server, 'GET', '/api/pickups/calendar', { cookie: managerCookie });
    assert(managerPickupCalendar.status === 200 && managerPickupCalendar.json.events.some(row => row.appointmentId === 'pickup-direct-calendar' && /calendar\.google\.com/.test(row.googleCalendarUrl) && /google\.com\/maps/.test(row.mapsUrl)), 'Manager pickup calendar should include deterministic Google Calendar and Maps links.');
    const mechanicPickupCalendar = await request(server, 'GET', '/api/pickups/calendar', { cookie: mechanicCookie });
    assert(mechanicPickupCalendar.status === 403, 'Mechanic must not access customer pickup scheduling.');
    const preparedPickupCalendar = await request(server, 'POST', '/api/pickups/pickup-direct-calendar/calendar', { cookie: managerCookie, json: {} });
    assert(preparedPickupCalendar.status === 200 && preparedPickupCalendar.json.calendarEvent.appointmentId === 'pickup-direct-calendar' && preparedPickupCalendar.json.icsUrl, 'Manager should be able to prepare a reusable pickup calendar record.');
    const pickupIcs = await request(server, 'GET', '/api/pickups/pickup-direct-calendar/calendar.ics', { cookie: managerCookie });
    assert(pickupIcs.status === 200 && /text\/calendar/.test(pickupIcs.headers['Content-Type'] || pickupIcs.headers['content-type'] || '') && pickupIcs.text.includes('DTSTART;TZID=America/New_York:20260720T113000') && pickupIcs.text.includes('DIRECTPICKUPVIN001'), 'Pickup ICS should contain the local appointment time and vehicle identity.');
    const mechanicPickupCompletion = await request(server, 'POST', '/api/pickups/pickup-direct-calendar/complete', { cookie: mechanicCookie, json: { confirmed: true, mileage: 41234 } });
    assert(mechanicPickupCompletion.status === 403, 'Mechanic must not complete the customer/account pickup handoff.');
    const unconfirmedPickupCompletion = await request(server, 'POST', '/api/pickups/pickup-direct-calendar/complete', { cookie: managerCookie, json: { mileage: 41234 } });
    assert(unconfirmedPickupCompletion.status === 400, 'Pickup completion must require explicit physical-handoff confirmation.');
    const completedPickup = await request(server, 'POST', '/api/pickups/pickup-direct-calendar/complete', { cookie: managerCookie, json: { confirmed: true, mileage: 41234, notes: 'Keys and vehicle handed to customer.' } });
    assert(completedPickup.status === 200 && completedPickup.json.appointment.status === 'Picked up' && completedPickup.json.vehicle.status === 'Rented' && completedPickup.json.recurring.status === 'Active', 'Manager should atomically complete the physical pickup, fleet status, and autopay activation.');
    const completedPickupState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const pickupCompletionSnapshot = {
      vehicle: completedPickupState.json.vehicles.find(row => row.id === 'veh-direct-pickup-car'),
      customer: completedPickupState.json.customers.find(row => row.id === 'cus-direct-pickup'),
      contract: completedPickupState.json.contracts.find(row => row.id === 'con-direct-pickup'),
      application: completedPickupState.json.applications.find(row => row.id === 'application-direct-calendar'),
      session: completedPickupState.json.onboardingSessions.find(row => row.id === 'onboard-direct-calendar'),
      onlineVehicle: completedPickupState.json.onlineVehicles.find(row => row.id === 'online-direct-pickup')
    };
    assert(pickupCompletionSnapshot.vehicle.mileage === 41234 && pickupCompletionSnapshot.customer.status === 'Active' && pickupCompletionSnapshot.contract.status === 'Active' && pickupCompletionSnapshot.application.stage === 'Active customer' && pickupCompletionSnapshot.session.status === 'Completed' && pickupCompletionSnapshot.onlineVehicle.availability === 'Rented', 'Pickup completion must update customer, contract, application, onboarding, vehicle, and online inventory together: ' + JSON.stringify(pickupCompletionSnapshot));
    const repeatedPickupCompletion = await request(server, 'POST', '/api/pickups/pickup-direct-calendar/complete', { cookie: managerCookie, json: { confirmed: true, mileage: 41234 } });
    assert(repeatedPickupCompletion.status === 200 && repeatedPickupCompletion.json.alreadyCompleted === true, 'Repeated pickup completion must be idempotent.');

    const tollSeedRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const tollSeedState = JSON.parse(JSON.stringify(tollSeedRead.json));
    tollSeedState.vehicles = tollSeedState.vehicles || [];
    tollSeedState.customers = tollSeedState.customers || [];
    tollSeedState.contracts = tollSeedState.contracts || [];
    tollSeedState.vehicles.unshift({ id: 'direct-toll-vehicle', organizationId: 'org-wheelsonauto', year: '2019', make: 'Test', model: 'Toll Car', vin: 'DIRECTTOLLVIN0001', plate: 'DIRECTTOLL', currentCustomer: 'Direct Toll Customer', status: 'Rented' });
    tollSeedState.customers.unshift({ id: 'direct-toll-customer', organizationId: 'org-wheelsonauto', name: 'Direct Toll Customer', phone: '3135550145', email: 'direct-toll@example.com', vehicleId: 'direct-toll-vehicle', vehicle: '2019 Test Toll Car', vin: 'DIRECTTOLLVIN0001', licensePlate: 'DIRECTTOLL' });
    tollSeedState.contracts.unshift({ id: 'direct-toll-contract', organizationId: 'org-wheelsonauto', customer: 'Direct Toll Customer', vehicleId: 'direct-toll-vehicle', vehicle: '2019 Test Toll Car', startDate: '2026-01-01', status: 'Active' });
    const tollSeedWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: tollSeedState });
    assert(tollSeedWrite.status === 200 && tollSeedWrite.json.ok, 'Owner could not seed toll-import matching records.');
    const directTollCsv = [
      'POSTING DATE,TRANSACTION DATE,TAG/PLATE NUMBER,AGENCY,DESCRIPTION,ENTRY TIME,ENTRY PLAZA,ENTRY LANE,EXIT TIME,EXIT PLAZA,EXIT LANE,VEHICLE TYPE CODE,AMOUNT,PREPAID,PLAN/RATE,FARE TYPE,BALANCE',
      '07/15/2026,07/15/2026,-,NJ E-ZPass,Prepaid Payment,,-,-,17:52:48,-,-,-,$100.00,Y,-,-,$999.99',
      '07/15/2026,07/13/2026,DIRECTTOLL-NJ,DRPA,TOLL,,-,-,22:40:02,WWB,10W,2,($6.00),Y,BUSINESS,N,$899.99'
    ].join('\n');
    const managerTollImport = await request(server, 'POST', '/api/tolls/import', { cookie: managerCookie, json: { preview: true, raw: directTollCsv } });
    assert(managerTollImport.status === 403, 'Manager must not import toll statements or approve customer recovery money.');
    const mechanicTollImport = await request(server, 'POST', '/api/tolls/import', { cookie: mechanicCookie, json: { preview: true, raw: directTollCsv } });
    assert(mechanicTollImport.status === 403, 'Mechanic must not import toll statements.');
    const tollPreview = await request(server, 'POST', '/api/tolls/import', { cookie: ownerCookie, json: { preview: true, raw: directTollCsv } });
    assert(tollPreview.status === 200 && tollPreview.json.summary.importable === 1 && tollPreview.json.summary.accountActivity === 1, 'Owner toll preview should match the customer toll and skip account funding.');
    assert(tollPreview.json.preview.find(row => row.valid).transactionDate === '2026-07-13' && tollPreview.json.preview.find(row => row.valid).postingDate === '2026-07-15', 'Toll API preview must keep transaction and posting dates separate.');
    const tollImport = await request(server, 'POST', '/api/tolls/import', { cookie: ownerCookie, json: { raw: directTollCsv } });
    assert(tollImport.status === 200 && tollImport.json.result.importable === 1 && tollImport.json.result.matched === 1, 'Owner toll import should create one matched recovery claim.');
    const duplicateTollImport = await request(server, 'POST', '/api/tolls/import', { cookie: ownerCookie, json: { raw: directTollCsv } });
    assert(duplicateTollImport.status === 200 && duplicateTollImport.json.result.importable === 0 && duplicateTollImport.json.result.duplicates === 1, 'Re-importing the same E-ZPass row must not create a duplicate claim.');
    const tollImportedState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const directTollClaim = (tollImportedState.json.claims || []).find(row => row.customer === 'Direct Toll Customer' && row.source === 'E-ZPass CSV import');
    assert(directTollClaim && directTollClaim.receiptUrl && directTollClaim.transactionDate === '2026-07-13', 'Imported toll should retain the matched customer and private receipt URL.');
    const publicTollReceipt = await request(server, 'GET', new URL(directTollClaim.receiptUrl).pathname);
    assert(publicTollReceipt.status === 200 && publicTollReceipt.text.includes('Direct Toll Customer') && publicTollReceipt.text.includes('2026-07-13') && publicTollReceipt.text.includes('2026-07-15'), 'Private toll receipt should show customer, transaction date, and posting date.');
    assert(!publicTollReceipt.text.includes('$899.99') && !publicTollReceipt.text.includes('$999.99'), 'Customer toll receipt must not expose the private E-ZPass account balance.');
    const ownerReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: ownerCookie });
    assert(ownerReport.status === 200 && /attachment; filename="wheelsonauto-deep-report-/.test(ownerReport.headers['Content-Disposition'] || ownerReport.headers['content-disposition'] || ''), 'Owner deep report should download with a dated filename.');
    assert(ownerReport.text.includes('Transactions') && ownerReport.text.includes('Autopay roster') && ownerReport.text.includes('Verification inbox') && ownerReport.text.includes('Messages / communications') && ownerReport.text.includes('Star QA') && ownerReport.text.includes('Audit trail'), 'Owner deep report should include money, customer, verification, communication, Star QA, and audit sections.');
    assert(ownerReport.text.includes('Failed twice') && ownerReport.text.includes('Payment not found') && ownerReport.text.includes('Unmatched payments') && ownerReport.text.includes('Missing contact') && ownerReport.text.includes('Customer portal access') && ownerReport.text.includes('Customer vehicle text') && ownerReport.text.includes('Application handoff') && ownerReport.text.includes('Document expiration') && ownerReport.text.includes('Vehicle identity') && ownerReport.text.includes('Daily closeout signoff') && ownerReport.text.includes('Service identity') && ownerReport.text.includes('Claim evidence') && ownerReport.text.includes('Company scope') && ownerReport.text.includes('iFleet function coverage'), 'Owner deep report should include operational Star QA truth rows.');
    assert(ownerReport.text.includes('Toll/violation recovery') && ownerReport.text.includes('need customer/vehicle/plate review before charge or message'), 'Owner deep report should include toll/violation recovery review rows.');
    assert(ownerReport.text.includes('API provider readiness') && ownerReport.text.includes('Provider needed'), 'Owner deep report should include API provider readiness rows before outside providers are live-tested.');
    assert(ownerReport.text.includes('Messaging webhook secret') && ownerReport.text.includes('WOA_MESSAGING_WEBHOOK_SECRET') && ownerReport.text.includes('Clover Hosted Checkout signing secret') && ownerReport.text.includes('CLOVER_HCO_WEBHOOK_SECRET'), 'Owner deep report should include safe webhook-secret readiness rows without exposing secret values.');
    assert(ownerReport.text.includes('Session signing secret') && ownerReport.text.includes('WOA_SESSION_SECRET'), 'Owner deep report should include the stable signed-session secret setup row.');
    assert(ownerReport.text.includes('login-ready customer portal account'), 'Owner deep report should treat draft customer portal records without passwords as unfinished access.');
    assert(ownerReport.text.includes('Possible match Direct Dispute Customer') && ownerReport.text.includes('DIRECTDISPUTEVIN') && ownerReport.text.includes('Tag DIR-DSP') && ownerReport.text.includes('Phone 3135550199') && ownerReport.text.includes('Email direct-dispute-customer@example.com'), 'Owner deep report should include possible dispute customer, vehicle, and contact evidence.');
    assert(ownerReport.text.includes('staff_password_reset') && ownerReport.text.includes('Staff login direct-manager'), 'Owner deep report should include safe staff reset/help communication rows.');
    ['DirectManager123!', 'DirectManager456!', 'DirectCustomer123!', 'DirectCustomer456!', 'passwordHash', 'passwordSalt', 'sourceToken', 'paymentSource'].forEach(secret => {
      assert(!ownerReport.text.includes(secret), 'Owner deep report should not expose secret material: ' + secret);
    });
    const ownerHealth = await request(server, 'GET', '/api/system/health', { cookie: ownerCookie });
    assert(ownerHealth.status === 200 && ownerHealth.json.summary && ownerHealth.json.star && Array.isArray(ownerHealth.json.issues), 'Owner system health should return summary, Star, and issue rows.');
    assert(ownerHealth.json.issues.some(row => row.key === 'unmatched_payments') && ownerHealth.json.issues.some(row => row.key === 'missing_vin') && ownerHealth.json.issues.some(row => row.key === 'dispute_match_review') && ownerHealth.json.issues.some(row => row.key === 'customer_portal_access') && ownerHealth.json.issues.some(row => row.key === 'customer_vehicle_text') && ownerHealth.json.issues.some(row => row.key === 'application_handoff') && ownerHealth.json.issues.some(row => row.key === 'document_expiration') && ownerHealth.json.issues.some(row => row.key === 'vehicle_identity') && ownerHealth.json.issues.some(row => row.key === 'daily_closeout_signoff') && ownerHealth.json.issues.some(row => row.key === 'service_identity') && ownerHealth.json.issues.some(row => row.key === 'claim_evidence') && ownerHealth.json.issues.some(row => row.key === 'company_scope') && ownerHealth.json.issues.some(row => row.key === 'ifleet_function_coverage'), 'Owner system health should include payment, application, document, dispute, portal, closeout signoff, service identity, claim evidence, company scope, iFleet coverage, and fleet truth checks.');
    const tollHealth = ownerHealth.json.issues.find(row => row.key === 'toll_violation_recovery');
    assert(tollHealth && Number(tollHealth.count) > 0 && /Open tolls\/violations/.test(tollHealth.detail || ''), 'Owner system health should include toll/violation recovery with amount and review context.');
    const apiHealth = ownerHealth.json.issues.find(row => row.key === 'api_provider_readiness');
    assert(apiHealth && Number(apiHealth.count) >= 4 && /Provider dependency matrix/.test(apiHealth.detail || ''), 'Owner system health should include default API provider readiness before providers are live-tested.');
    const sessionSecretHealth = ownerHealth.json.issues.find(row => row.key === 'session_signing_secret');
    assert(sessionSecretHealth && sessionSecretHealth.tone === 'warn' && /WOA_SESSION_SECRET|WOA_COOKIE_SECRET/.test(sessionSecretHealth.detail || ''), 'Owner system health should flag missing stable session signing secret.');
    const messagingWebhookHealth = ownerHealth.json.issues.find(row => row.key === 'messaging_webhook_secret');
    assert(messagingWebhookHealth && Number(messagingWebhookHealth.count) === 0 && messagingWebhookHealth.tone === 'good', 'Owner system health should include the messaging webhook secret readiness row.');
    const cloverWebhookHealth = ownerHealth.json.issues.find(row => row.key === 'clover_webhook_secret');
    assert(cloverWebhookHealth && Number(cloverWebhookHealth.count) === 0 && cloverWebhookHealth.tone === 'good', 'Owner system health should include the Clover webhook secret readiness row.');
    const ownerRuntimeState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(ownerRuntimeState.json.integrations && ownerRuntimeState.json.integrations.messaging && ownerRuntimeState.json.integrations.messaging.webhookSecretConfigured === true, 'Owner state should expose safe messaging webhook readiness without exposing the secret.');
    assert(ownerRuntimeState.json.integrations.clover && ownerRuntimeState.json.integrations.clover.webhookSecretConfigured === true, 'Owner state should expose safe Clover webhook readiness without exposing the secret.');
    assert(Array.isArray(ownerRuntimeState.json.integrations.apiProviderRuntime) && ownerRuntimeState.json.integrations.apiProviderRuntime.some(row => row.id === 'clover-core' && row.lastTestResult), 'Owner state should expose runtime-derived provider evidence without exposing provider secrets.');
    const portalHealth = ownerHealth.json.issues.find(row => row.key === 'customer_portal_access');
    assert(portalHealth && Number(portalHealth.count) > 0 && /login-ready/i.test(portalHealth.detail || ''), 'Owner system health should flag active customers whose portal record is not login ready.');
    const ownerReadiness = await request(server, 'POST', '/api/system/readiness', { cookie: ownerCookie });
    assert(ownerReadiness.status === 200 && Array.isArray(ownerReadiness.json.truthChecks) && Object.prototype.hasOwnProperty.call(ownerReadiness.json, 'dataOk'), 'System readiness should return customer/payment/fleet truth checks.');
    assert(ownerReadiness.json.truthChecks.some(row => row.key === 'unmatched_payments') && ownerReadiness.json.truthChecks.some(row => row.key === 'autopay_vehicle_link') && ownerReadiness.json.truthChecks.some(row => row.key === 'customer_vehicle_text') && ownerReadiness.json.truthChecks.some(row => row.key === 'application_handoff') && ownerReadiness.json.truthChecks.some(row => row.key === 'document_expiration') && ownerReadiness.json.truthChecks.some(row => row.key === 'vehicle_identity') && ownerReadiness.json.truthChecks.some(row => row.key === 'daily_closeout_signoff') && ownerReadiness.json.truthChecks.some(row => row.key === 'service_identity') && ownerReadiness.json.truthChecks.some(row => row.key === 'claim_evidence') && ownerReadiness.json.truthChecks.some(row => row.key === 'company_scope') && ownerReadiness.json.truthChecks.some(row => row.key === 'ifleet_function_coverage') && ownerReadiness.json.truthChecks.some(row => row.key === 'payment_request_truth') && ownerReadiness.json.truthChecks.some(row => row.key === 'open_payment_requests'), 'System readiness should include unmatched payment, application handoff, document expiration, vehicle identity, closeout signoff, service identity, claim evidence, company scope, iFleet coverage, customer/vehicle text, payment-link, and autopay vehicle-link checks.');
    assert(ownerReadiness.json.truthChecks.some(row => row.key === 'toll_violation_recovery' && row.severity === 'critical'), 'System readiness should mark unmatched toll/violation recovery as critical before charge/message follow-up.');
    assert(ownerReadiness.json.truthChecks.some(row => row.key === 'api_provider_readiness' && row.severity === 'warning'), 'System readiness should include warning-level API provider readiness for future integrations.');
    assert(ownerReadiness.json.truthChecks.some(row => row.key === 'messaging_webhook_secret' && row.status === 'Clean'), 'System readiness should include messaging webhook secret readiness.');
    assert(ownerReadiness.json.truthChecks.some(row => row.key === 'clover_webhook_secret' && row.status === 'Clean'), 'System readiness should include Clover webhook secret readiness.');
    assert(ownerReadiness.json.envChecks.some(row => row.key === 'WOA_SESSION_SECRET' && row.status === 'Missing'), 'System readiness should list missing WOA_SESSION_SECRET for stable signed cookies.');
    const ifleetCoverageTasks = await request(server, 'POST', '/api/system/ifleet-coverage/tasks', { cookie: ownerCookie });
    assert(ifleetCoverageTasks.status === 200 && ifleetCoverageTasks.json.ok && Array.isArray(ifleetCoverageTasks.json.coverage) && ifleetCoverageTasks.json.coverage.some(row => row.key === 'autopay_closeout') && ifleetCoverageTasks.json.tasks.some(task => task.id === 'task-ifleet-coverage-autopay_closeout' && task.title === 'iFleet coverage: Autopay + closeout'), 'Owner should be able to sync backend iFleet coverage gaps into stable Dispatch tasks.');
    const ifleetCoverageState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert((ifleetCoverageState.json.tasks || []).some(task => task.id === 'task-ifleet-coverage-autopay_closeout' && task.status === 'Open' && /backend iFleet function coverage/i.test(task.notes || '')), 'Synced iFleet coverage task should be saved in Dispatch with backend coverage notes.');

    const draftPortalLogins = await request(server, 'POST', '/api/customer-accounts/create-missing-drafts', { cookie: ownerCookie, json: {} });
    assert(draftPortalLogins.status === 200 && draftPortalLogins.json.ok, 'Owner could not create draft customer portal logins.');
    assert((draftPortalLogins.json.created || []).some(account => account.customer === 'Direct Missing Portal Draft Customer'), 'Draft portal login creation should include active customers with no portal record.');
    const draftPortalState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const draftPortalAccount = (draftPortalState.json.customerAccounts || []).find(account => account.customer === 'Direct Missing Portal Draft Customer');
    assert(draftPortalAccount && draftPortalAccount.loginReady === false && !draftPortalAccount.passwordHash && !draftPortalAccount.passwordSalt, 'Draft portal login should not be usable or expose password secrets until owner sets a password.');
    const draftCustomerLoginAttempt = await request(server, 'POST', '/customer/login', { form: { username: 'direct-missing-portal@example.com', password: 'anything-wrong' } });
    assert(draftCustomerLoginAttempt.status === 401, 'Draft portal login without owner-set password should not allow customer login.');
    const managerHealth = await request(server, 'GET', '/api/system/health', { cookie: managerCookie });
    assert(managerHealth.status === 200 && managerHealth.json.organizationId === 'org-wheelsonauto' && managerHealth.json.star.canAssist === true, 'Manager system health should be available and scoped.');
    const mechanicReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: mechanicCookie });
    assert(mechanicReport.status === 403, 'Mechanic should not be able to download deep financial reports.');
    const mechanicHealth = await request(server, 'GET', '/api/system/health', { cookie: mechanicCookie });
    assert(mechanicHealth.status === 403, 'Mechanic should not be able to read the money/system health snapshot.');
    const mechanicReadiness = await request(server, 'POST', '/api/system/readiness', { cookie: mechanicCookie });
    assert(mechanicReadiness.status === 403, 'Mechanic should not be able to read readiness truth checks.');
    const mechanicCoverageTasks = await request(server, 'POST', '/api/system/ifleet-coverage/tasks', { cookie: mechanicCookie });
    assert(mechanicCoverageTasks.status === 403, 'Mechanic should not be able to create system iFleet coverage tasks.');
    const staffLogout = await request(server, 'GET', '/logout', { cookie: managerCookie });
    assert(staffLogout.status === 302 && staffLogout.location === '/', 'Staff logout should redirect to the login shell.');
    assertSecureCookie(staffLogout.cookie, 'Staff/admin logout', { clear: true });
    const customerLoginPage = await request(server, 'GET', '/customer/login');
    assert(customerLoginPage.status === 200 && customerLoginPage.text.includes('My WheelsonAuto'), 'Customer login page did not render.');
    assert(customerLoginPage.text.includes('Forgot password?'), 'Customer login should include reset help.');
    const customerForgotPage = await request(server, 'GET', '/customer/forgot');
    assert(customerForgotPage.status === 200 && customerForgotPage.text.includes('Reset access'), 'Customer forgot page did not render.');

    const customerResetRequest = await request(server, 'POST', '/customer/forgot', { form: { identity: 'direct-customer' } });
    assert(customerResetRequest.status === 200 && customerResetRequest.text.includes('request was sent'), 'Customer reset request did not save.');
    const resetRequestState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(resetRequestState.json.messages.some(message => message.event === 'customer_password_reset' && message.customer === 'Alicia Brown'), 'Customer reset request should be saved in Messages.');
    assert((resetRequestState.json.auditLogs || []).some(row => row.action === 'Customer password help requested' && String(row.details || '').includes('Alicia Brown') && String(row.details || '').includes('Matched customer account')), 'Customer reset request should be owner audit logged.');
    const resetRequestedAccount = (resetRequestState.json.customerAccounts || []).find(account => account.id === 'direct-customer-login');
    assert(resetRequestedAccount && resetRequestedAccount.passwordResetStatus === 'Requested' && resetRequestedAccount.passwordResetRequestedAt, 'Customer reset request should mark the customer portal login for owner follow-up.');

    const portalPrivacyState = JSON.parse(JSON.stringify(resetRequestState.json));
    portalPrivacyState.recurringPayments = portalPrivacyState.recurringPayments || [];
    let portalPrivacyRecurring = portalPrivacyState.recurringPayments.find(row => row.id === 'rec-001');
    if (!portalPrivacyRecurring) {
      portalPrivacyRecurring = { id: 'rec-001', customer: 'Alicia Brown', amount: 229, status: 'Active' };
      portalPrivacyState.recurringPayments.unshift(portalPrivacyRecurring);
    }
    Object.assign(portalPrivacyRecurring, {
      customer: 'Alicia Brown',
      vehicle: '2015 Lincoln MKZ',
      vehicleId: 'veh-003',
      vin: '3LN6L2G91FR123456',
      licensePlate: 'A03-LMK',
      plate: 'A03-LMK',
      tracker: 'Tracker-Alicia',
      cloverPaymentSource: 'secret-source-token',
      paymentToken: 'secret-payment-token',
      raw: { private: 'secret-raw-value' }
    });
    portalPrivacyState.customers = portalPrivacyState.customers || [];
    let portalPrivacyCustomer = portalPrivacyState.customers.find(row => row.name === 'Alicia Brown' || row.customer === 'Alicia Brown');
    if (!portalPrivacyCustomer) {
      portalPrivacyCustomer = { id: 'direct-customer-privacy-file', organizationId: 'org-wheelsonauto', name: 'Alicia Brown' };
      portalPrivacyState.customers.unshift(portalPrivacyCustomer);
    }
    Object.assign(portalPrivacyCustomer, {
      cloverPaymentSource: 'customer-secret-source-token',
      paymentToken: 'customer-secret-payment-token',
      raw: { private: 'customer-secret-raw-value' }
    });
    portalPrivacyState.paymentRequests = portalPrivacyState.paymentRequests || [];
    portalPrivacyState.payments = portalPrivacyState.payments || [];
    portalPrivacyState.payments.unshift({
      id: 'direct-customer-private-payment-row',
      organizationId: 'org-wheelsonauto',
      customer: 'Alicia Brown',
      recurringPaymentId: 'rec-002',
      vehicleId: 'veh-003',
      vehicle: '2015 Lincoln MKZ',
      vin: '3LN6L2G91FR123456',
      amount: 229,
      status: '1x failed - retrying',
      source: 'Clover saved-card charge',
      notes: 'Customer-visible status with internal Clover decline code',
      error: 'secret-clover-error',
      lastAutoChargeError: 'secret-last-charge-error',
      cloverPaymentId: 'secret-clover-payment-id',
      externalReferenceId: 'secret-external-reference'
    });
    portalPrivacyState.paymentRequests.unshift(
      {
        id: 'direct-customer-open-payment-link',
        organizationId: 'org-wheelsonauto',
        customer: 'Alicia Brown',
        recurringPaymentId: 'rec-002',
        vehicleId: 'veh-003',
        vehicle: '2015 Lincoln MKZ',
        amount: 229,
        frequency: 'Weekly',
        status: 'Open',
        createdAt: '2026-07-09T10:00:00.000Z',
        url: 'https://wheelsonauto-platform.onrender.com/pay/direct-customer-open-payment-link'
      },
      {
        id: 'direct-customer-paid-payment-link',
        organizationId: 'org-wheelsonauto',
        customer: 'Alicia Brown',
        recurringPaymentId: 'rec-002',
        vehicleId: 'veh-003',
        vehicle: '2015 Lincoln MKZ',
        amount: 111,
        frequency: 'Old paid link',
        status: 'Paid',
        url: 'https://wheelsonauto-platform.onrender.com/pay/direct-customer-paid-payment-link'
      }
    );
    portalPrivacyState.documents = portalPrivacyState.documents || [];
    portalPrivacyState.documents.unshift(
      {
        id: 'direct-customer-visible-doc',
        organizationId: 'org-wheelsonauto',
        type: 'Insurance',
        title: 'Visible insurance proof',
        customer: 'Alicia Brown',
        vehicleId: 'veh-003',
        vehicle: '2015 Lincoln MKZ',
        status: 'Active',
        visibility: 'Customer visible',
        customerVisible: true,
        portalVisible: true,
        reference: 'VISIBLE-DOC-PORTAL',
        notes: 'Visible customer document smoke test.'
      },
      {
        id: 'direct-customer-private-doc',
        organizationId: 'org-wheelsonauto',
        type: 'Claim evidence',
        title: 'Private claim evidence',
        customer: 'Alicia Brown',
        vehicleId: 'veh-003',
        status: 'Active',
        visibility: 'Staff only',
        customerVisible: false,
        portalVisible: false,
        reference: 'PRIVATE-DOC-SHOULD-HIDE',
        internalNotes: 'secret-internal-doc-note',
        notes: 'Private staff document smoke test.'
      }
    );
    portalPrivacyState.messages = portalPrivacyState.messages || [];
    portalPrivacyState.messages.unshift(
      {
        id: 'direct-customer-approved-star-reply',
        organizationId: 'org-wheelsonauto',
        customer: 'Alicia Brown',
        phone: '3135551111',
        direction: 'Outbound',
        channel: 'SMS',
        template: 'Star approved reply',
        status: 'Sent',
        source: 'Star AI + SMS provider',
        aiDraftId: 'direct-hidden-draft-id',
        aiApprovedAt: '2026-08-04T10:30:00.000Z',
        body: 'Approved Star reply visible to the customer after it is sent.'
      },
      {
        id: 'direct-customer-internal-star-draft',
        organizationId: 'org-wheelsonauto',
        customer: 'Alicia Brown',
        phone: '3135551111',
        direction: 'AI draft',
        channel: 'Star AI',
        status: 'Needs approval',
        source: 'WheelsonAuto Star AI',
        aiPlan: { actionType: 'reply' },
        body: 'INTERNAL_STAR_DRAFT_SHOULD_HIDE'
      }
    );
    const portalPrivacyWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: portalPrivacyState });
    assert(portalPrivacyWrite.status === 200 && portalPrivacyWrite.json.ok, 'Owner could not seed customer portal privacy fields.');
    const ownerPaymentLinkReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: ownerCookie });
    assert(ownerPaymentLinkReport.text.includes('Open payment requests') && ownerPaymentLinkReport.text.includes('direct-customer-open-payment-link') && ownerPaymentLinkReport.text.includes('WheelsonAuto hosted checkout') && ownerPaymentLinkReport.text.includes('Stale - follow up now') && !ownerPaymentLinkReport.text.includes('direct-customer-paid-payment-link'), 'Owner deep report should include open hosted checkout links, stale follow-up status, and exclude paid payment links.');
    const ownerPaymentLinkHealth = await request(server, 'GET', '/api/system/health', { cookie: ownerCookie });
    assert(ownerPaymentLinkHealth.json.issues.some(row => row.key === 'open_payment_requests') && ownerPaymentLinkHealth.json.issues.some(row => row.key === 'stale_payment_requests') && ownerPaymentLinkHealth.json.summary.openPaymentRequests >= 1 && ownerPaymentLinkHealth.json.summary.openPaymentRequestAmount >= 229 && ownerPaymentLinkHealth.json.summary.stalePaymentRequests >= 1, 'Owner system health should count open and stale hosted checkout follow-ups.');
    const managerPrivacyRead = await request(server, 'GET', '/api/state', { cookie: managerCookie });
    assert(managerPrivacyRead.status === 200 && !JSON.stringify(managerPrivacyRead.json).includes('secret-source-token') && !JSON.stringify(managerPrivacyRead.json).includes('secret-payment-token') && !JSON.stringify(managerPrivacyRead.json).includes('secret-raw-value') && !JSON.stringify(managerPrivacyRead.json).includes('customer-secret-source-token'), 'Manager state should not expose raw saved-card/source secrets.');
    const managerPrivacySave = await request(server, 'PUT', '/api/state', { cookie: managerCookie, json: managerPrivacyRead.json });
    assert(managerPrivacySave.status === 200 && managerPrivacySave.json.ok, 'Manager should be able to save scrubbed operational state.');
    const ownerPrivacyAfterManagerSave = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(JSON.stringify(ownerPrivacyAfterManagerSave.json).includes('customer-secret-source-token') && JSON.stringify(ownerPrivacyAfterManagerSave.json).includes('customer-secret-payment-token'), 'Manager save should preserve hidden owner-only customer payment fields.');
    const mechanicPrivacyRead = await request(server, 'GET', '/api/state', { cookie: mechanicCookie });
    assert(mechanicPrivacyRead.status === 200 && !JSON.stringify(mechanicPrivacyRead.json).includes('secret-source-token') && !JSON.stringify(mechanicPrivacyRead.json).includes('secret-payment-token') && !JSON.stringify(mechanicPrivacyRead.json).includes('secret-raw-value'), 'Mechanic state should not expose raw saved-card/source secrets.');

    const publicApplyPage = await request(server, 'GET', '/apply/' + encodeURIComponent(onlineVehicleOne.json.vehicle.slug));
    assert(publicApplyPage.status === 200 && publicApplyPage.text.includes('nativeApplicationForm'), 'Native vehicle application page should render its secure public form.');
    assert(publicApplyPage.text.includes('online-direct-001') && publicApplyPage.text.includes('2016 Ford Focus Hatch'), 'Native application page should be locked to the selected published online vehicle.');
    assert(!publicApplyPage.text.includes('secret-source-token') && !publicApplyPage.text.includes('secret-payment-token') && !publicApplyPage.text.includes('secret-raw-value'), 'Public application page should not expose private payment tokens.');
    assert(!publicApplyPage.text.includes('Direct Dispute Customer') && !publicApplyPage.text.includes('direct-customer'), 'Public application page should not expose customer, dispute, or portal login records.');

    const customerLoginRes = await request(server, 'POST', '/customer/login', { form: { username: 'direct-customer', password: 'DirectCustomer123!' } });
    assert(customerLoginRes.status === 302 && String(customerLoginRes.cookie).includes('woa_customer_session='), 'Customer login did not set a customer session.');
    assertSecureCookie(customerLoginRes.cookie, 'Customer login');
    const customerCookie = cleanCookie(customerLoginRes.cookie);

    const customerPortal = await request(server, 'GET', '/customer', { cookie: customerCookie });
    assert(customerPortal.status === 200 && customerPortal.text.includes('Alicia') && customerPortal.text.includes('Recent payments') && customerPortal.text.includes('/customer/message'), 'Customer portal did not render account details and message form.');
    assert(customerPortal.text.includes('customer-action-hub') && customerPortal.text.includes('#portal-payments') && customerPortal.text.includes('#portal-card') && customerPortal.text.includes('#portal-service') && customerPortal.text.includes('#portal-messages'), 'Customer portal should render the mobile-friendly quick action hub.');
    assert(customerPortal.text.includes('Open payment requests') && customerPortal.text.includes('direct-customer-open-payment-link') && customerPortal.text.includes('Pay securely') && customerPortal.text.includes('days open'), 'Customer portal should show linked open payment requests with age.');
	    assert(!customerPortal.text.includes('direct-customer-paid-payment-link') && !customerPortal.text.includes('Old paid link'), 'Customer portal should not show paid/closed payment requests in the open payment request panel.');
	    assert(customerPortal.text.includes('/customer/paid-outside') && customerPortal.text.includes('Report payment'), 'Customer portal should include paid-outside-app reporting.');
	    assert(customerPortal.text.includes('/customer/receipt-request') && customerPortal.text.includes('Request receipt'), 'Customer portal should include receipt request workflow.');
	    assert(customerPortal.text.includes('/customer/statement-request') && customerPortal.text.includes('Request account document'), 'Customer portal should include account statement/payoff request workflow.');
	    assert(customerPortal.text.includes('/customer/service-request') && customerPortal.text.includes('Send service request'), 'Customer portal should include a connected service request form.');
    assert(customerPortal.text.includes('/customer/issue-report') && customerPortal.text.includes('Report issue'), 'Customer portal should include toll/claim/issue reporting.');
    assert(customerPortal.text.includes('/customer/document-update') && customerPortal.text.includes('Send document / proof update') && customerPortal.text.includes('name="documentFile"') && customerPortal.text.includes('/customer-portal.js'), 'Customer portal should include secure document upload intake and its focused client script.');
    assert(customerPortal.text.includes('/customer/card-change') && customerPortal.text.includes('Change card on file'), 'Customer portal should include a secure card-change action.');
    assert(customerPortal.text.includes('Documents & receipts') && customerPortal.text.includes('VISIBLE-DOC-PORTAL'), 'Customer portal should render customer-visible documents.');
    assert(!customerPortal.text.includes('PRIVATE-DOC-SHOULD-HIDE') && !customerPortal.text.includes('secret-internal-doc-note'), 'Customer portal should not render staff-only documents.');

    const customerPaidOutsideNoAuth = await request(server, 'POST', '/customer/paid-outside');
    assert(customerPaidOutsideNoAuth.status === 302 && customerPaidOutsideNoAuth.location === '/customer/login', 'Customer paid-outside report should require customer login.');

    const customerPaidOutside = await request(server, 'POST', '/customer/paid-outside', {
      cookie: customerCookie,
      form: {
        amount: '229',
        method: 'Cash',
        paidDate: '2026-08-02',
        proofUrl: 'https://proof.example/cash-receipt',
        note: 'Receipt handed to office during smoke test.'
      }
    });
    assert(customerPaidOutside.status === 302 && customerPaidOutside.location === '/customer#portal-payments', 'Customer paid-outside report should return to Payments.');
    const customerPaidOutsideState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const paidOutsideCandidates = (customerPaidOutsideState.json.payments || []).filter(item => item.source === 'Customer portal' && item.customer === 'Alicia Brown');
    const paidOutsidePayment = paidOutsideCandidates.find(item => item.status === 'Paid outside app - needs verification' && item.date === '2026-08-02' && String(item.notes || '').includes('smoke test'));
    assert(paidOutsidePayment && paidOutsidePayment.amount === 229 && paidOutsidePayment.vehicleId === 'veh-003' && paidOutsidePayment.vin === '3LN6L2G91FR123456' && paidOutsidePayment.requiresVerification === true && paidOutsidePayment.proofUrl === 'https://proof.example/cash-receipt', 'Customer paid-outside report should create a review-only linked payment record with proof: ' + JSON.stringify(paidOutsideCandidates));
    assert((customerPaidOutsideState.json.messages || []).some(message => message.paymentId === paidOutsidePayment.id && message.customer === 'Alicia Brown' && message.status === 'Needs admin verification' && String(message.body || '').includes('Proof link/note: https://proof.example/cash-receipt')), 'Customer paid-outside report should be logged in Messages for staff review with proof context.');
    const managerPaidOutsideReview = await request(server, 'POST', '/api/verification/paid-outside', { cookie: managerCookie, json: { paymentId: paidOutsidePayment.id, action: 'verify' } });
    assert(managerPaidOutsideReview.status === 403, 'Manager should not be allowed to verify paid-outside money reports.');
    const paidOutsideReview = await request(server, 'POST', '/api/verification/paid-outside', { cookie: ownerCookie, json: { paymentId: paidOutsidePayment.id, action: 'verify', note: 'Verified against cash receipt in smoke test.' } });
    assert(paidOutsideReview.status === 200 && paidOutsideReview.json.ok && paidOutsideReview.json.payment.status === 'Paid outside app', 'Owner should be able to verify paid-outside proof.');
	    const paidOutsideReviewRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
	    assert((paidOutsideReviewRead.json.payments || []).some(item => item.id === paidOutsidePayment.id && item.requiresVerification === false && item.status === 'Paid outside app' && String(item.notes || '').includes('Verified by')), 'Verified paid-outside report should leave review mode and keep proof notes.');
	    assert((paidOutsideReviewRead.json.auditLogs || []).some(item => item.action === 'Paid-outside payment verified' && String(item.details || '').includes('Alicia Brown')), 'Paid-outside verification should be audit logged.');

	    const customerReceiptNoAuth = await request(server, 'POST', '/customer/receipt-request');
	    assert(customerReceiptNoAuth.status === 302 && customerReceiptNoAuth.location === '/customer/login', 'Customer receipt request should require customer login.');
	    const customerReceiptRequest = await request(server, 'POST', '/customer/receipt-request', { cookie: customerCookie, form: { paymentHint: 'Need receipt for the latest $229 payment.' } });
	    assert(customerReceiptRequest.status === 302 && customerReceiptRequest.location === '/customer#portal-documents', 'Customer receipt request should return to Documents.');
	    const customerReceiptState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
	    const receiptMessage = (customerReceiptState.json.messages || []).find(item => item.event === 'customer_receipt_request' && item.customer === 'Alicia Brown');
	    assert(receiptMessage && receiptMessage.status === 'Needs admin approval' && receiptMessage.aiPlan && receiptMessage.aiPlan.actionType === 'send_receipt' && receiptMessage.aiPlan.approvalRequired === true, 'Customer receipt request should create an admin-approved send_receipt message.');
	    assert(receiptMessage.vin === '3LN6L2G91FR123456' && receiptMessage.plate === 'LNZ-229' && Number(receiptMessage.amount || 0) > 0, 'Customer receipt request should keep vehicle, VIN/tag, and payment amount context.');
	    assert((customerReceiptState.json.auditLogs || []).some(row => row.action === 'Customer portal receipt requested' && String(row.details || '').includes('Alicia Brown')), 'Customer receipt request should be audit logged.');

	    const customerStatementNoAuth = await request(server, 'POST', '/customer/statement-request');
	    assert(customerStatementNoAuth.status === 302 && customerStatementNoAuth.location === '/customer/login', 'Customer account statement request should require customer login.');
	    const customerStatementRequest = await request(server, 'POST', '/customer/statement-request', { cookie: customerCookie, form: { requestType: 'Payoff balance', note: 'Need payoff amount before Friday.' } });
	    assert(customerStatementRequest.status === 302 && customerStatementRequest.location === '/customer#portal-documents', 'Customer statement request should return to Documents.');
	    const customerStatementState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
	    const statementMessage = (customerStatementState.json.messages || []).find(item => item.event === 'customer_statement_request' && item.customer === 'Alicia Brown');
	    assert(statementMessage && statementMessage.status === 'Needs admin approval' && statementMessage.aiPlan && statementMessage.aiPlan.actionType === 'send_account_statement' && statementMessage.aiPlan.approvalRequired === true, 'Customer statement request should create an admin-approved send_account_statement message.');
	    assert(statementMessage.vin === '3LN6L2G91FR123456' && statementMessage.plate === 'LNZ-229' && String(statementMessage.body || '').includes('Payoff balance'), 'Customer statement request should keep vehicle, VIN/tag, and request type context.');
	    const statementDocument = (customerStatementState.json.documents || []).find(item => item.id === statementMessage.documentId && item.customer === 'Alicia Brown');
	    assert(statementDocument && statementDocument.kind === 'Account document request' && statementDocument.status === 'Needs staff preparation' && statementDocument.requiresVerification === true && statementDocument.customerVisible === false && statementDocument.vin === '3LN6L2G91FR123456' && statementDocument.plate === 'LNZ-229', 'Customer statement request should create a staff-only document preparation item linked to the message with vehicle context.');
	    assert((customerStatementState.json.auditLogs || []).some(row => row.action === 'Customer portal statement requested' && String(row.details || '').includes('Alicia Brown') && String(row.details || '').includes('Payoff balance')), 'Customer statement request should be audit logged.');

	    const customerServiceNoAuth = await request(server, 'POST', '/customer/service-request');
    assert(customerServiceNoAuth.status === 302 && customerServiceNoAuth.location === '/customer/login', 'Customer service request should require customer login.');

    const customerServiceRequest = await request(server, 'POST', '/customer/service-request', {
      cookie: customerCookie,
      form: {
        type: 'Warning light',
        preferredDate: '2026-08-01',
        proofUrl: 'https://proof.example/check-engine-light',
        notes: 'Check engine light came on during the customer portal smoke test.'
      }
    });
    assert(customerServiceRequest.status === 302 && customerServiceRequest.location === '/customer#portal-service', 'Customer service request should return to Service.');
    const customerServiceState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const customerServiceJob = (customerServiceState.json.maintenance || []).find(item => item.source === 'Customer portal' && item.customer === 'Alicia Brown' && item.type === 'Warning light' && item.due === '2026-08-01' && String(item.notes || '').includes('smoke test'));
    assert(customerServiceJob && customerServiceJob.vehicleId === 'veh-003' && customerServiceJob.vin === '3LN6L2G91FR123456' && customerServiceJob.proofUrl === 'https://proof.example/check-engine-light', 'Customer service request should create a vehicle-linked maintenance job with proof: ' + JSON.stringify(customerServiceJob || null));
    assert((customerServiceState.json.messages || []).some(message => message.maintenanceId === customerServiceJob.id && message.customer === 'Alicia Brown' && String(message.body || '').includes('Proof link/note: https://proof.example/check-engine-light')), 'Customer service request should be logged in Messages with proof context.');

    const customerIssueNoAuth = await request(server, 'POST', '/customer/issue-report');
    assert(customerIssueNoAuth.status === 302 && customerIssueNoAuth.location === '/customer/login', 'Customer issue report should require customer login.');

    const customerIssueRequest = await request(server, 'POST', '/customer/issue-report', {
      cookie: customerCookie,
      form: {
        type: 'Toll / E-ZPass notice',
        incidentDate: '2026-08-03',
        amount: '12.50',
        proofUrl: 'https://proof.example/ezpass-notice',
        notes: 'Notice number PORTAL-TOLL-SMOKE.'
      }
    });
    assert(customerIssueRequest.status === 302 && customerIssueRequest.location === '/customer#portal-issues', 'Customer issue report should return to Issues.');
    const customerIssueState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const customerIssue = (customerIssueState.json.claims || []).find(item => item.source === 'Customer portal' && item.customer === 'Alicia Brown' && item.type === 'Toll / E-ZPass notice' && item.incidentDate === '2026-08-03');
    assert(customerIssue && customerIssue.vehicleId === 'veh-003' && customerIssue.vin === '3LN6L2G91FR123456' && customerIssue.amount === 12.5 && customerIssue.customerMatchStatus === 'Matched from customer portal' && customerIssue.proofUrl === 'https://proof.example/ezpass-notice', 'Customer issue report should create a vehicle-linked claim/issue with proof: ' + JSON.stringify(customerIssue || null));
    assert((customerIssueState.json.messages || []).some(message => message.claimId === customerIssue.id && message.customer === 'Alicia Brown' && String(message.body || '').includes('Proof link/note: https://proof.example/ezpass-notice')), 'Customer issue report should be logged in Messages with proof context.');

    const customerDocumentNoAuth = await request(server, 'POST', '/customer/document-update');
    assert(customerDocumentNoAuth.status === 302 && customerDocumentNoAuth.location === '/customer/login', 'Customer document update should require customer login.');

    const customerDocumentUpdate = await request(server, 'POST', '/customer/document-update', {
      cookie: customerCookie,
      form: {
        type: 'Insurance proof',
        provider: 'Smoke Test Insurance',
        reference: 'POLICY-PORTAL-SMOKE',
        expires: '2026-12-31',
        proofUrl: 'https://proof.example/insurance-photo',
        notes: 'Customer portal proof update smoke test.'
      }
    });
    assert(customerDocumentUpdate.status === 302 && customerDocumentUpdate.location === '/customer#portal-documents', 'Customer document update should return to Documents.');
    const customerDocumentState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const customerDocument = (customerDocumentState.json.documents || []).find(item => item.source === 'Customer portal' && item.customer === 'Alicia Brown' && item.reference === 'POLICY-PORTAL-SMOKE');
    assert(customerDocument && customerDocument.vehicleId === 'veh-003' && customerDocument.vin === '3LN6L2G91FR123456' && customerDocument.status === 'Needs verification' && customerDocument.requiresVerification === true && customerDocument.url === 'https://proof.example/insurance-photo', 'Customer document update should create a vehicle-linked verification document with proof URL: ' + JSON.stringify(customerDocument || null));
    assert((customerDocumentState.json.messages || []).some(message => message.documentId === customerDocument.id && message.customer === 'Alicia Brown' && message.status === 'Needs admin verification' && String(message.body || '').includes('Proof link/note: https://proof.example/insurance-photo')), 'Customer document update should be logged in Messages for staff verification.');
    const customerSecureUpload = await request(server, 'POST', '/customer/document-update', {
      cookie: customerCookie,
      json: {
        type: 'Driver license',
        provider: 'New Jersey MVC',
        reference: 'DIRECT-SECURE-UPLOAD',
        expires: '2030-12-31',
        notes: 'Secure customer portal upload smoke test.',
        file: { name: 'license-update.png', type: 'image/png', dataUrl: pngDataUrl() }
      }
    });
    assert(customerSecureUpload.status === 201 && customerSecureUpload.json.ok && customerSecureUpload.json.document.portalDownloadUrl, 'Customer portal should accept a validated private JPG/PNG/PDF upload.');
    const customerSecureUploadState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const uploadedDocument = (customerSecureUploadState.json.documents || []).find(item => item.reference === 'DIRECT-SECURE-UPLOAD');
    assert(uploadedDocument && uploadedDocument.customerAccountId === 'direct-customer-login' && uploadedDocument.contentType === 'image/png' && uploadedDocument.size > 0 && uploadedDocument.sha256 && /^onboarding-uploads\//.test(uploadedDocument.storagePath || ''), 'Secure customer upload should store only validated private-file metadata on the linked customer record.');
    const ownDocumentDownload = await request(server, 'GET', '/customer/documents/' + encodeURIComponent(uploadedDocument.id), { cookie: customerCookie });
    assert(ownDocumentDownload.status === 200 && String(ownDocumentDownload.headers['Content-Type'] || ownDocumentDownload.headers['content-type']).includes('image/png'), 'Customer should be able to reopen their own uploaded document through the authenticated route.');
    const unauthenticatedDocumentDownload = await request(server, 'GET', '/customer/documents/' + encodeURIComponent(uploadedDocument.id));
    assert(unauthenticatedDocumentDownload.status === 302 && unauthenticatedDocumentDownload.location === '/customer/login', 'Private customer document download must require a customer login.');
    const otherCustomerDocumentDownload = await request(server, 'GET', '/customer/documents/' + encodeURIComponent(uploadedDocument.id), { cookie: cleanCookie(franchiseCustomerLogin.cookie) });
    assert(otherCustomerDocumentDownload.status === 404, 'A customer from another company must not be able to read another customer private upload.');
    const managerUploadedDocumentState = await request(server, 'GET', '/api/state', { cookie: managerCookie });
    const managerUploadedDocument = (managerUploadedDocumentState.json.documents || []).find(item => item.id === uploadedDocument.id);
    assert(managerUploadedDocument && managerUploadedDocument.privateFileAvailable === true && !managerUploadedDocument.storagePath, 'Manager state should expose review availability without leaking the private storage path.');
    const managerUploadedDocumentView = await request(server, 'GET', '/api/onboarding/documents/' + encodeURIComponent(uploadedDocument.id), { cookie: managerCookie });
    assert(managerUploadedDocumentView.status === 200 && String(managerUploadedDocumentView.headers['Content-Type'] || managerUploadedDocumentView.headers['content-type']).includes('image/png'), 'Manager should be able to open a scoped customer upload for verification.');
    const mechanicUploadedDocumentView = await request(server, 'GET', '/api/onboarding/documents/' + encodeURIComponent(uploadedDocument.id), { cookie: mechanicCookie });
    assert(mechanicUploadedDocumentView.status === 403, 'Mechanic must not be able to open private identity or insurance uploads.');
    const ownerDocumentRoundTrip = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: customerSecureUploadState.json });
    assert(ownerDocumentRoundTrip.status === 200 && ownerDocumentRoundTrip.json.ok, 'Owner state round trip should preserve the secure upload.');
    const rawDocumentRoundTrip = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8')).documents.find(item => item.id === uploadedDocument.id);
    assert(rawDocumentRoundTrip && rawDocumentRoundTrip.storagePath && !Object.prototype.hasOwnProperty.call(rawDocumentRoundTrip, 'privateFileAvailable'), 'Derived private-file availability must not be persisted into business data during a staff save.');
    const invalidSecureUpload = await request(server, 'POST', '/customer/document-update', { cookie: customerCookie, json: { type: 'Insurance proof', file: { name: 'fake.pdf', type: 'application/pdf', dataUrl: pngDataUrl().replace('image/png', 'application/pdf') } } });
    assert(invalidSecureUpload.status === 400 && /does not match/i.test(invalidSecureUpload.json.error), 'Customer upload must reject a file whose bytes do not match its declared format.');
    const portalProofReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: ownerCookie });
    assert(portalProofReport.status === 200 && portalProofReport.text.includes('Verification inbox') && portalProofReport.text.includes('3LN6L2G91FR123456') && portalProofReport.text.includes('Tag LNZ-229') && portalProofReport.text.includes('https://proof.example/check-engine-light') && portalProofReport.text.includes('https://proof.example/ezpass-notice') && portalProofReport.text.includes('https://proof.example/insurance-photo'), 'Deep report verification inbox should keep customer portal proof linked to vehicle, VIN, tag, and proof evidence.');
    const mechanicDocumentReview = await request(server, 'POST', '/api/verification/document', { cookie: mechanicCookie, json: { documentId: customerDocument.id, action: 'verify' } });
    assert(mechanicDocumentReview.status === 403, 'Mechanic should not be allowed to verify customer proof documents.');
    const managerDocumentReview = await request(server, 'POST', '/api/verification/document', { cookie: managerCookie, json: { documentId: customerDocument.id, action: 'verify', provider: 'Smoke Test Insurance', reference: 'POLICY-PORTAL-SMOKE' } });
    assert(managerDocumentReview.status === 200 && managerDocumentReview.json.ok && managerDocumentReview.json.document.status === 'Verified', 'Manager should be able to verify customer proof documents.');
    const managerDocumentReviewRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert((managerDocumentReviewRead.json.documents || []).some(item => item.id === customerDocument.id && item.status === 'Verified' && item.requiresVerification === false && item.portalVisible === true), 'Verified document proof should clear review mode and remain visible to the customer portal.');
    assert((managerDocumentReviewRead.json.auditLogs || []).some(item => item.action === 'Document proof verified' && String(item.details || '').includes('Alicia Brown')), 'Document verification should be audit logged.');
    const documentReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: ownerCookie });
    assert(documentReport.status === 200 && documentReport.text.includes('Documents / verification') && documentReport.text.includes('POLICY-PORTAL-SMOKE') && documentReport.text.includes('Insurance proof') && documentReport.text.includes('Background checks'), 'Deep report should include verified customer documents and Star proof QA rows.');

    const customerCardChangeNoAuth = await request(server, 'POST', '/customer/card-change');
    assert(customerCardChangeNoAuth.status === 302 && customerCardChangeNoAuth.location === '/customer/login', 'Customer card-change request should require customer login.');

    const customerCardChange = await request(server, 'POST', '/customer/card-change', { cookie: customerCookie });
    assert(customerCardChange.status === 302 && String(customerCardChange.location || '').startsWith('/setup-card/'), 'Customer card-change request should redirect to a secure setup-card page.');
    const customerCardSetupId = String(customerCardChange.location || '').split('/').pop();
    const customerCardChangeRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const customerCardSetupRequest = (customerCardChangeRead.json.cardSetupRequests || []).find(request => request.id === customerCardSetupId);
    assert(customerCardSetupRequest && customerCardSetupRequest.customer === 'Alicia Brown' && customerCardSetupRequest.cardOnlyUpdate === true, 'Customer card-change request should create a card-only setup request for the logged-in customer.');
    assert((customerCardChangeRead.json.messages || []).some(message => message.cardSetupRequestId === customerCardSetupId && message.customer === 'Alicia Brown'), 'Customer card-change request should be logged in Messages.');
    assert((customerCardChangeRead.json.auditLogs || []).some(row => row.action === 'Customer portal card setup link opened' && String(row.details || '').includes('Alicia Brown') && String(row.details || '').includes(customerCardSetupId)), 'Customer card-change request should be audit logged with the setup request.');
    const customerCardSetupPage = await request(server, 'GET', customerCardChange.location);
    assert(customerCardSetupPage.status === 200 && customerCardSetupPage.text.includes('Set up automatic payments') && customerCardSetupPage.text.includes('Alicia Brown'), 'Customer-created card setup page should render.');
    assert(!customerCardSetupPage.text.includes('secret-source-token') && !customerCardSetupPage.text.includes('secret-payment-token') && !customerCardSetupPage.text.includes('secret-raw-value'), 'Customer-created card setup page should not expose private payment tokens.');
    const customerPortalWithCardSetup = await request(server, 'GET', '/customer', { cookie: customerCookie });
    assert(customerPortalWithCardSetup.status === 200 && customerPortalWithCardSetup.text.includes(customerCardSetupId) && customerPortalWithCardSetup.text.includes('Set up card'), 'Customer portal should show open card setup/change links after a customer requests card change.');
    const customerPortalCardSetupState = await request(server, 'GET', '/api/customer/portal-state', { cookie: customerCookie });
    assert((customerPortalCardSetupState.json.portal.cardSetupRequests || []).some(request => request.id === customerCardSetupId && request.customer === 'Alicia Brown'), 'Customer portal API should expose the logged-in customer open card setup request.');
    assert(!JSON.stringify(customerPortalCardSetupState.json.portal.cardSetupRequests || []).includes('secret-source-token') && !JSON.stringify(customerPortalCardSetupState.json.portal.cardSetupRequests || []).includes('paymentToken'), 'Customer portal card setup links should not expose private payment tokens.');

    const portalMessageNotificationSettings = await request(server, 'POST', '/api/notifications/email/settings', {
      cookie: ownerCookie,
      json: { emailRecipients: ['notify@example.com'], emailEnabled: true }
    });
    assert(portalMessageNotificationSettings.status === 200 && portalMessageNotificationSettings.json.ok, 'Owner could not enable portal message notifications.');

    const customerPortalMessageNoAuth = await request(server, 'POST', '/customer/message', { form: { body: 'I need help with my account.' } });
    assert(customerPortalMessageNoAuth.status === 302 && customerPortalMessageNoAuth.location === '/customer/login', 'Customer portal messages should require customer login.');

    const customerPortalMessage = await request(server, 'POST', '/customer/message', { cookie: customerCookie, form: { body: 'Can you help me update my card and confirm my next payment?' } });
    assert(customerPortalMessage.status === 302 && customerPortalMessage.location === '/customer#portal-messages', 'Customer portal message should return to Messages.');
    const customerPortalMessageRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const savedPortalMessage = (customerPortalMessageRead.json.messages || []).find(message => message.channel === 'Customer portal' && message.customer === 'Alicia Brown' && /update my card/i.test(message.body || ''));
    assert(savedPortalMessage, 'Customer portal message should be saved in staff Messages.');
    assert(savedPortalMessage.status === 'Needs admin review' && savedPortalMessage.approvalRequired === true && savedPortalMessage.intent === 'Money/account question', 'Customer portal money/card questions should be triaged for admin review.');
    assert(savedPortalMessage.vehicleId === 'veh-003' && savedPortalMessage.vin === '3LN6L2G91FR123456' && savedPortalMessage.plate === 'LNZ-229' && Number(savedPortalMessage.amount) === 229, 'Customer portal messages should carry vehicle, VIN/tag, and payment context into staff Messages.');
    assert((customerPortalMessageRead.json.messages || []).some(message => message.source === 'WheelsonAuto Star AI' && message.aiSourceMessageId === savedPortalMessage.id), 'Customer portal message should create a Star draft for staff review.');
    assert((customerPortalMessageRead.json.messages || []).some(note => note.event === 'customer_message' && /money\/account review/i.test(note.subject || '') && /Admin approval required: Yes/.test(note.body || '')), 'Customer portal message should notify the owner by email with triage and approval context.');
    assert((customerPortalMessageRead.json.auditLogs || []).some(row => row.action === 'Customer portal message received' && String(row.details || '').includes('Alicia Brown') && String(row.details || '').includes('Money/account question')), 'Customer portal messages should be audit logged with triage context.');

    const customerPortalState = await request(server, 'GET', '/api/customer/portal-state', { cookie: customerCookie });
    assert(customerPortalState.status === 200 && customerPortalState.json.ok, 'Customer portal API did not load.');
    assert(customerPortalState.json.portal.recurring.customer === 'Alicia Brown', 'Customer portal should link the assigned recurring payment.');
    assert((customerPortalState.json.portal.documents || []).some(doc => doc.reference === 'VISIBLE-DOC-PORTAL'), 'Customer portal state should include customer-visible documents.');
    assert((customerPortalState.json.portal.documents || []).some(doc => doc.reference === 'POLICY-PORTAL-SMOKE' && doc.status === 'Verified'), 'Customer portal state should show customer-submitted document updates after staff verification.');
    assert((customerPortalState.json.portal.documents || []).some(doc => doc.kind === 'Receipt' && Number(doc.amount) === 229), 'Customer portal state should include generated customer payment receipts.');
	    assert((customerPortalState.json.portal.messages || []).some(message => message.channel === 'Customer portal' && /update my card/i.test(message.body || '')), 'Customer portal should show the customer-submitted portal message.');
	    assert((customerPortalState.json.portal.messages || []).some(message => message.channel === 'Customer portal' && /requested a payment receipt/i.test(message.body || '') && message.status === 'Needs admin approval'), 'Customer portal should show customer-submitted receipt requests while hiding internal approval metadata.');
	    assert((customerPortalState.json.portal.messages || []).some(message => message.channel === 'Customer portal' && /requested an account document/i.test(message.body || '') && message.status === 'Needs admin approval'), 'Customer portal should show customer-submitted statement/payoff requests while hiding internal approval metadata.');
	    assert(!(customerPortalState.json.portal.documents || []).some(doc => doc.kind === 'Account document request' && doc.status === 'Needs staff preparation'), 'Customer portal should not show staff-only statement/payoff preparation documents before staff marks them visible.');
	    assert((customerPortalState.json.portal.messages || []).some(message => /Approved Star reply visible/.test(message.body || '') && message.direction === 'Outbound'), 'Customer portal should show approved Star-assisted replies after they are sent.');
    assert(!(customerPortalState.json.portal.messages || []).some(message => /Star AI|AI draft|AI action/i.test(String([message.source, message.channel, message.direction].filter(Boolean).join(' '))) || message.aiPlan), 'Customer portal must not expose internal Star drafts or AI plans.');
    assert(!JSON.stringify(customerPortalState.json.portal.messages || []).includes('INTERNAL_STAR_DRAFT_SHOULD_HIDE') && !JSON.stringify(customerPortalState.json.portal.messages || []).includes('direct-hidden-draft-id'), 'Customer portal should hide internal Star draft bodies and approval identifiers.');
    assert(!JSON.stringify(customerPortalState.json.portal.documents || []).includes('PRIVATE-DOC-SHOULD-HIDE'), 'Customer portal state should not expose staff-only document references.');
    assert(!JSON.stringify(customerPortalState.json.portal.documents || []).includes('needs staff verification before the account is marked complete'), 'Customer portal state should not expose staff-only verification notes.');
    assert(!JSON.stringify(customerPortalState.json.portal.documents || []).includes('secret-internal-doc-note'), 'Customer portal state should not expose internal document notes.');
    assert(!JSON.stringify(customerPortalState.json).includes('Direct Dispute Customer'), 'Customer portal state should not expose another customer payment/dispute record.');
    assert(!customerPortal.text.includes('Direct Dispute Customer'), 'Customer portal page should not render another customer record.');
    assert(!JSON.stringify(customerPortalState.json).includes('passwordHash'), 'Customer portal state should not expose password secrets.');
    assert(!JSON.stringify(customerPortalState.json).includes('secret-source-token'), 'Customer portal state should not expose saved-card payment sources.');
    assert(!JSON.stringify(customerPortalState.json).includes('secret-payment-token'), 'Customer portal state should not expose payment tokens.');
    assert(!JSON.stringify(customerPortalState.json).includes('secret-raw-value'), 'Customer portal state should not expose raw provider payloads.');
    assert(!JSON.stringify(customerPortalState.json).includes('Customer portal private tracker location') && !JSON.stringify(customerPortalState.json).includes('39.752'), 'Customer portal state must never expose precise tracker locations or coordinates.');
    assert(!JSON.stringify(customerPortalState.json.portal.messages || []).includes('approvalRequired') && !JSON.stringify(customerPortalState.json.portal.messages || []).includes('customerAccountId'), 'Customer portal message history should not expose staff triage fields or internal account ids.');
    assert(!JSON.stringify(customerPortalState.json.portal.payments || []).includes('secret-clover-error') && !JSON.stringify(customerPortalState.json.portal.payments || []).includes('secret-clover-payment-id') && !JSON.stringify(customerPortalState.json.portal.payments || []).includes('secret-external-reference'), 'Customer portal payments should not expose Clover/internal error or reference fields.');
    assert((customerPortalState.json.portal.payments || []).some(payment => payment.id === 'direct-customer-private-payment-row' && /Please contact WheelsonAuto/.test(payment.notes || '')), 'Customer portal failed payments should show a clean customer-safe note.');

    const customerBlockedState = await request(server, 'GET', '/api/state', { cookie: customerCookie });
    assert(customerBlockedState.status === 401 && customerBlockedState.json && customerBlockedState.json.error === 'Authentication required.', 'Customer session should not access staff/admin API state.');

    const disabledCustomerLogin = await request(server, 'POST', '/api/customer-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-customer-login',
        name: 'Alicia Brown',
        customer: 'Alicia Brown',
        username: 'direct-customer',
        phone: '(856) 555-0171',
        email: 'alicia@example.com',
        recurringPaymentId: 'rec-001',
        status: 'Disabled'
      }
    });
    assert(disabledCustomerLogin.status === 200 && disabledCustomerLogin.json.ok, 'Owner could not disable customer login.');
    const disabledCustomerLoginAttempt = await request(server, 'POST', '/customer/login', { form: { username: 'direct-customer', password: 'DirectCustomer123!' } });
    assert(disabledCustomerLoginAttempt.status === 401, 'Disabled customer login should not sign in.');
    const disabledSessionPortal = await request(server, 'GET', '/customer', { cookie: customerCookie });
    assert(disabledSessionPortal.status === 302 && disabledSessionPortal.location === '/customer/login', 'Existing customer session should be redirected after account is disabled.');
    assertSecureCookie(disabledSessionPortal.cookie, 'Disabled customer session cleanup', { clear: true });
    const disabledSessionApi = await request(server, 'GET', '/api/customer/portal-state', { cookie: customerCookie });
    assert(disabledSessionApi.status === 401, 'Existing customer session should lose portal API access after account is disabled.');

    const reenabledCustomerLogin = await request(server, 'POST', '/api/customer-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-customer-login',
        name: 'Alicia Brown',
        customer: 'Alicia Brown',
        username: 'direct-customer',
        phone: '(856) 555-0171',
        email: 'alicia@example.com',
        recurringPaymentId: 'rec-001',
        status: 'Active'
      }
    });
    assert(reenabledCustomerLogin.status === 200 && reenabledCustomerLogin.json.ok, 'Owner could not reactivate customer login without replacing password.');
    const reenabledCustomerLoginAttempt = await request(server, 'POST', '/customer/login', { form: { username: 'direct-customer', password: 'DirectCustomer123!' } });
    assert(reenabledCustomerLoginAttempt.status === 302, 'Reactivated customer login should keep the existing password.');
    assertSecureCookie(reenabledCustomerLoginAttempt.cookie, 'Reactivated customer login');
    const reenabledCustomerCookie = cleanCookie(reenabledCustomerLoginAttempt.cookie);
    const customerLogout = await request(server, 'GET', '/customer/logout', { cookie: reenabledCustomerCookie });
    assert(customerLogout.status === 302 && customerLogout.location === '/customer/login', 'Customer logout should redirect to customer login.');
    assertSecureCookie(customerLogout.cookie, 'Customer logout', { clear: true });

    const resetCustomerPassword = await request(server, 'POST', '/api/customer-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-customer-login',
        name: 'Alicia Brown',
        customer: 'Alicia Brown',
        username: 'direct-customer',
        password: 'DirectCustomer456!',
        phone: '(856) 555-0171',
        email: 'alicia@example.com',
        recurringPaymentId: 'rec-001',
        status: 'Active'
      }
    });
    assert(resetCustomerPassword.status === 200 && resetCustomerPassword.json.ok && resetCustomerPassword.json.account.passwordResetStatus === 'Reset complete', 'Owner password reset should clear the customer reset request.');
    assert(!resetCustomerPassword.json.account.passwordHash && !resetCustomerPassword.json.account.passwordSalt, 'Customer reset response should not expose password secrets.');
    const oldCustomerPasswordAttempt = await request(server, 'POST', '/customer/login', { form: { username: 'direct-customer', password: 'DirectCustomer123!' } });
    assert(oldCustomerPasswordAttempt.status === 401, 'Old customer password should stop working after owner reset.');
    const newCustomerPasswordAttempt = await request(server, 'POST', '/customer/login', { form: { username: 'direct-customer', password: 'DirectCustomer456!' } });
    assert(newCustomerPasswordAttempt.status === 302, 'New owner-set customer password should sign in.');
    assertSecureCookie(newCustomerPasswordAttempt.cookie, 'Customer reset password login');

    const notificationSettings = await request(server, 'POST', '/api/notifications/email/settings', {
      cookie: ownerCookie,
      json: { emailRecipients: ['notify@example.com'], emailEnabled: true }
    });
    assert(notificationSettings.status === 200 && notificationSettings.json.ok, 'Owner could not save email notification settings.');
    assert(notificationSettings.json.notifications.emailRecipients[0] === 'notify@example.com', 'Notification recipient did not save.');

    const fakeConnectedApi = await request(server, 'POST', '/api/api-providers', {
      cookie: ownerCookie,
      json: {
        id: 'api-direct-fake-connected',
        name: 'Direct Fake API',
        group: 'Risk',
        status: 'Connected',
        envKeys: 'DIRECT_FAKE_KEY',
        endpoint: '/api/direct/fake',
        liveTest: 'Run direct fake sync'
      }
    });
    assert(fakeConnectedApi.status === 400 && /last test result/i.test(fakeConnectedApi.json.error || ''), 'Connected API providers should require a live-test result before saving.');
    const fakeConnectedNoDateApi = await request(server, 'POST', '/api/api-providers', {
      cookie: ownerCookie,
      json: {
        id: 'api-direct-fake-connected-no-date',
        name: 'Direct Fake API No Date',
        group: 'Risk',
        status: 'Connected',
        envKeys: 'DIRECT_FAKE_KEY',
        endpoint: '/api/direct/fake',
        liveTest: 'Run direct fake sync',
        lastTestResult: 'Passed but missing date'
      }
    });
    assert(fakeConnectedNoDateApi.status === 400 && /last test date/i.test(fakeConnectedNoDateApi.json.error || ''), 'Connected API providers should require a live-test date before saving.');
    const connectedApi = await request(server, 'POST', '/api/api-providers', {
      cookie: ownerCookie,
      json: {
        id: 'api-direct-connected',
        name: 'Direct Connected API',
        group: 'Risk',
        status: 'Connected',
        owner: 'Owner',
        envKeys: 'DIRECT_CONNECTED_KEY',
        endpoint: '/api/direct/connected',
        liveTest: 'Run direct connected smoke sync',
        lastTestAt: '2026-08-04',
        lastTestResult: 'Passed direct smoke test'
      }
    });
    assert(connectedApi.status === 200 && connectedApi.json.ok && connectedApi.json.provider.lastTestResult === 'Passed direct smoke test', 'Connected API provider should save only after credentials, endpoint, live test, and result are recorded.');
    const incompleteApi = await request(server, 'POST', '/api/api-providers', {
      cookie: ownerCookie,
      json: {
        id: 'api-direct-needs-task',
        name: 'Direct API Needs Task',
        group: 'Comms',
        status: 'Provider needed',
        owner: 'Owner',
        envKeys: 'DIRECT_PROVIDER_KEY',
        endpoint: 'Future /api/direct/provider',
        liveTest: 'Run provider sync after credentials are live.'
      }
    });
    assert(incompleteApi.status === 200 && incompleteApi.json.ok && incompleteApi.json.task && incompleteApi.json.task.status === 'Open' && incompleteApi.json.task.id === 'task-api-api-direct-needs-task', 'Incomplete API provider should create or update one open Dispatch task.');
    const completedApi = await request(server, 'POST', '/api/api-providers', {
      cookie: ownerCookie,
      json: {
        id: 'api-direct-needs-task',
        name: 'Direct API Needs Task',
        group: 'Comms',
        status: 'Connected',
        owner: 'Owner',
        envKeys: 'DIRECT_PROVIDER_KEY',
        endpoint: 'Future /api/direct/provider',
        liveTest: 'Run provider sync after credentials are live.',
        lastTestAt: '2026-08-05',
        lastTestResult: 'Passed provider connection smoke test'
      }
    });
    assert(completedApi.status === 200 && completedApi.json.ok && completedApi.json.task && completedApi.json.task.status === 'Done' && /Auto-closed/.test(completedApi.json.task.notes || ''), 'Connected live-tested API provider should close the related Dispatch task.');

    const defaultNotificationEvents = ['payment_failed', 'payment_not_found', 'application_submitted', 'maintenance_due', 'claim_dispute', 'daily_closeout', 'customer_password_reset', 'staff_password_reset', 'card_setup_completed', 'customer_message'];
    const filteredNotificationSettings = await request(server, 'POST', '/api/notifications/email/settings', {
      cookie: ownerCookie,
      json: { emailRecipients: ['notify@example.com'], emailEnabled: true, events: ['customer_message'] }
    });
    assert(filteredNotificationSettings.status === 200 && filteredNotificationSettings.json.notifications.events.length === 1 && filteredNotificationSettings.json.notifications.events[0] === 'customer_message', 'Notification event filters should save exactly.');
    const filteredApplication = await request(server, 'POST', '/api/public/applications', {
      json: nativePublicApplicationPayload({ onlineVehicleId: 'online-direct-002', firstName: 'Direct Filtered', lastName: 'Applicant', phone: '3135550333', email: 'direct-filtered@example.com', password: 'DirectFiltered123!', income: 5100 })
    });
    assert(filteredApplication.status === 201 && filteredApplication.json.ok, 'Filtered public application path did not save.');
    const filteredNotificationState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(!filteredNotificationState.json.messages.some(message => message.event === 'application_submitted' && message.customer === 'Direct Filtered Applicant'), 'Disabled notification event should not create an application email alert.');
    const restoredNotificationSettings = await request(server, 'POST', '/api/notifications/email/settings', {
      cookie: ownerCookie,
      json: { emailRecipients: ['notify@example.com'], emailEnabled: true, events: defaultNotificationEvents }
    });
    assert(restoredNotificationSettings.status === 200 && restoredNotificationSettings.json.notifications.events.includes('application_submitted'), 'Notification events should restore application alerts.');

    const notifiedApplication = await request(server, 'POST', '/api/public/applications', {
      json: nativePublicApplicationPayload({ onlineVehicleId: 'online-direct-002', firstName: 'Direct Notified', lastName: 'Applicant', phone: '3135550222', email: 'direct-notified@example.com', password: 'DirectNotified123!', income: 5200 })
    });
    assert(notifiedApplication.status === 201 && notifiedApplication.json.ok, 'Public application notification path did not save.');

    const notificationTest = await request(server, 'POST', '/api/notifications/email/test', {
      cookie: ownerCookie,
      json: {
        to: 'notify@example.com',
        subject: 'Direct notification test',
        body: 'Direct smoke notification email body.',
        event: 'direct_smoke'
      }
    });
    assert([200, 202].includes(notificationTest.status) && notificationTest.json.ok, 'Owner notification test failed.');
    assert(notificationTest.json.message.channel === 'Email', 'Notification test should save an Email message.');
    assert(notificationTest.json.message.direction === 'Outbound notification', 'Notification test should save as an outbound notification.');
    const linkedOutboundMessage = await request(server, 'POST', '/api/messages/send', {
      cookie: ownerCookie,
      json: {
        customer: 'Alicia Brown',
        body: 'Direct smoke linked outbound message.',
        channel: 'SMS'
      }
    });
    assert([200, 202].includes(linkedOutboundMessage.status) && linkedOutboundMessage.json.ok, 'Linked outbound customer message failed.');
    assert(linkedOutboundMessage.json.message.customer === 'Alicia Brown' && linkedOutboundMessage.json.message.vehicleId === 'veh-003' && linkedOutboundMessage.json.message.vin === '3LN6L2G91FR123456' && linkedOutboundMessage.json.message.plate === 'LNZ-229' && linkedOutboundMessage.json.message.tracker === 'Bouncie' && linkedOutboundMessage.json.message.recurringPaymentId === 'rec-001' && Number(linkedOutboundMessage.json.message.amount) === 229, 'Outbound messages should carry customer, recurring, vehicle, VIN/tag, tracker, and amount context: ' + JSON.stringify(linkedOutboundMessage.json.message));
    const linkedOutboundAuditState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert((linkedOutboundAuditState.json.auditLogs || []).some(item => /Customer message (sent|drafted)/.test(item.action || '') && String(item.details || '').includes('Alicia Brown') && String(item.details || '').includes('2015 Lincoln MKZ')), 'Manual outbound messages should be tracked in the owner audit trail with customer and vehicle context.');
    const closeoutDedupState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const closeoutDedupData = JSON.parse(JSON.stringify(closeoutDedupState.json));
    closeoutDedupData.recurringPayments = closeoutDedupData.recurringPayments || [];
    closeoutDedupData.payments = closeoutDedupData.payments || [];
    closeoutDedupData.vehicles = closeoutDedupData.vehicles || [];
    closeoutDedupData.recurringPayments.unshift({
      id: 'rec-direct-closeout-dedup',
      customer: 'Direct Closeout Customer',
      phone: '3135550777',
      email: 'direct-closeout@example.com',
      vehicle: 'Direct Closeout Vehicle',
      amount: 777,
      frequency: 'Weekly',
      nextRun: '2099-12-31',
      cloverCustomerId: 'direct-closeout-clover-customer',
      status: 'Active'
    }, {
      id: 'rec-direct-closeout-failed-twice',
      customer: 'Direct Closeout Failed Twice',
      phone: '3135552222',
      email: 'direct-closeout-failed-twice@example.com',
      vehicleId: 'veh-direct-closeout-failed-twice',
      vehicle: '2024 Direct Failed Twice Car',
      amount: 50,
      frequency: 'Weekly',
      nextRun: '2099-12-31',
      failedAttempts: 2,
      status: '2x failed - contact customer'
    }, {
      id: 'rec-direct-closeout-payment-not-found',
      customer: 'Direct Closeout Payment Missing',
      phone: '3135553333',
      email: 'direct-closeout-payment-missing@example.com',
      vehicleId: 'veh-direct-closeout-payment-not-found',
      vehicle: '2024 Direct Missing Payment Car',
      amount: 60,
      frequency: 'Weekly',
      nextRun: '2099-12-31',
      status: 'Payment not found'
    }, {
      id: 'rec-direct-closeout-stale-autopay',
      customer: 'Direct Closeout Stale Autopay',
      phone: '3135554444',
      email: 'direct-closeout-stale@example.com',
      vehicleId: 'veh-direct-closeout-stale-autopay',
      vehicle: '2024 Direct Stale Autopay Car',
      amount: 70,
      frequency: 'Weekly',
      nextRun: '2099-12-30',
      status: 'Active'
    }, {
      id: 'rec-direct-closeout-removed',
      customer: 'Direct Closeout Removed',
      amount: 987654,
      frequency: 'Weekly',
      nextRun: 'Removed',
      lastAutoChargeAttemptDate: '2099-12-31',
      retryCount: 2,
      status: 'Active'
    }, {
      id: 'rec-direct-report-candidate',
      customer: 'Direct Report Candidate',
      phone: '3135550456',
      email: 'direct-report-candidate@example.com',
      vehicleId: 'veh-direct-report-candidate',
      vehicle: '2024 Direct Report Candidate Car',
      amount: 456,
      frequency: 'Weekly',
      nextRun: '2099-12-31',
      status: 'Active'
    }, {
      id: 'rec-direct-report-candidate-backup',
      customer: 'Direct Report Candidate Backup',
      phone: '3135551456',
      email: 'direct-report-candidate-backup@example.com',
      vehicleId: 'veh-direct-report-candidate-backup',
      vehicle: '2024 Direct Report Candidate Backup',
      amount: 456,
      frequency: 'Weekly',
      nextRun: '2099-12-31',
      status: 'Active'
    });
    closeoutDedupData.vehicles.unshift(
      { id: 'veh-direct-closeout-failed-twice', year: 2024, make: 'Direct', model: 'Failed Twice Car', vin: 'DIRECTFAILED2VIN', plate: 'DIR-F2X', tracker: 'TRK-F2X', status: 'Rented', currentCustomer: 'Direct Closeout Failed Twice' },
      { id: 'veh-direct-closeout-payment-not-found', year: 2024, make: 'Direct', model: 'Missing Payment Car', vin: 'DIRECTPAYMISSINGVIN', plate: 'DIR-PNF', tracker: 'TRK-PNF', status: 'Rented', currentCustomer: 'Direct Closeout Payment Missing' },
      { id: 'veh-direct-closeout-stale-autopay', year: 2024, make: 'Direct', model: 'Stale Autopay Car', vin: 'DIRECTSTALEVIN', plate: 'DIR-STL', tracker: 'TRK-STL', status: 'Rented', currentCustomer: 'Direct Closeout Stale Autopay' },
      { id: 'veh-direct-report-candidate', year: 2024, make: 'Direct', model: 'Report Candidate Car', vin: 'DIRECTREPORTVIN', plate: 'DIR-RPT', tracker: 'TRK-RPT', status: 'Rented', currentCustomer: 'Direct Report Candidate' },
      { id: 'veh-direct-report-candidate-backup', year: 2024, make: 'Direct', model: 'Report Candidate Backup', vin: 'DIRECTREPORTBACKUPVIN', plate: 'DIR-RP2', tracker: 'TRK-RP2', status: 'Rented', currentCustomer: 'Direct Report Candidate Backup' }
    );
    closeoutDedupData.payments.unshift(
      { id: 'clover-payment-closeout-dedup-one', cloverPaymentId: 'pay-closeout-dedup', customer: 'Unmatched Clover payment', date: '2099-12-31', method: 'Debit Card', source: 'Clover', amount: 777, status: 'Paid', notes: 'WheelsonAuto weekly payment' },
      { id: 'clover-payment-closeout-dedup-two', cloverPaymentId: 'pay-closeout-dedup', customer: 'Direct Closeout Customer', date: '2099-12-31', method: 'Debit Card', source: 'Clover', amount: 777, status: 'Paid', notes: 'WheelsonAuto weekly payment - Direct Closeout Customer' },
      { id: 'clover-payment-closeout-external-customer', cloverPaymentId: 'pay-closeout-external-customer', customer: 'Unmatched Clover payment', externalCustomerReference: 'direct-closeout-clover-customer', date: '2099-12-31', method: 'Debit Card', source: 'Clover', amount: 123, status: 'Paid', notes: 'WheelsonAuto weekly payment' },
      { id: 'clover-payment-report-candidate', cloverPaymentId: 'pay-report-candidate', customer: 'Unmatched Clover payment', date: '2099-12-31', method: 'Debit Card', source: 'Clover', amount: 456, status: 'Paid', notes: 'WheelsonAuto weekly payment' },
      { id: 'payment-direct-reconciled-link', paymentRequestId: 'plink-direct-closeout-already-paid', customer: 'Direct Reconciled Link', date: '2099-12-30', method: 'Clover Hosted Checkout', source: 'Clover Hosted Checkout', amount: 77, status: 'Paid' },
      { id: 'payment-closeout-paid-outside', customer: 'Direct Closeout Customer', date: '2099-12-31', method: 'Paid outside app', source: 'WheelsonAuto', amount: 45, status: 'Paid outside app', notes: 'Cash verified' },
      { id: 'payment-closeout-paid-outside-unverified', customer: 'Direct Closeout Customer', date: '2099-12-31', method: 'Paid outside app', source: 'Customer portal', amount: 9999, status: 'Paid outside app - needs verification', requiresVerification: true, notes: 'Customer report awaiting staff review' },
      { id: 'clover-payment-closeout-failed', cloverPaymentId: 'pay-closeout-failed', customer: 'Direct Closeout Customer', date: '2099-12-31', method: 'Debit Card', source: 'Clover', amount: 777, status: 'FAIL', notes: 'Declined' },
      { id: 'clover-payment-closeout-removed-history', cloverPaymentId: 'pay-closeout-removed-history', customer: 'Direct Closeout Removed', date: '2099-12-31', method: 'Debit Card', source: 'Clover', amount: 99, status: 'FAIL', notes: 'Historical failed attempt' }
    );
    closeoutDedupData.paymentRequests = Array.isArray(closeoutDedupData.paymentRequests) ? closeoutDedupData.paymentRequests : [];
    closeoutDedupData.paymentRequests.unshift({
      id: 'plink-direct-closeout-open',
      customer: 'Direct Closeout Payment Link',
      vehicleId: 'veh-direct-report-candidate',
      vehicle: '2024 Direct Report Candidate Car',
      amount: 88,
      status: 'Open',
      source: 'WheelsonAuto hosted checkout',
      createdAt: '2099-12-31T18:00:00.000Z',
      url: 'https://wheelsonauto-platform.onrender.com/pay/plink-direct-closeout-open'
    }, {
      id: 'plink-direct-closeout-already-paid',
      customer: 'Direct Reconciled Link',
      amount: 77,
      status: 'Open',
      source: 'WheelsonAuto hosted checkout',
      createdAt: '2099-12-30T18:00:00.000Z',
      url: 'https://wheelsonauto-platform.onrender.com/pay/plink-direct-closeout-already-paid'
    }, {
      id: 'plink-direct-closeout-paid',
      customer: 'Direct Closeout Paid Link',
      amount: 99,
      status: 'Paid',
      source: 'WheelsonAuto hosted checkout',
      createdAt: '2099-12-31T18:05:00.000Z',
      url: 'https://wheelsonauto-platform.onrender.com/pay/plink-direct-closeout-paid'
    });
    closeoutDedupData.dailyCloseouts = Array.isArray(closeoutDedupData.dailyCloseouts) ? closeoutDedupData.dailyCloseouts : [];
    closeoutDedupData.dailyCloseouts.unshift({
      id: 'closeout-2099-12-31',
      dateKey: '2099-12-31',
      note: 'Signed smoke closeout note',
      status: 'Signed off',
      signedAt: '2099-12-31T23:59:00.000Z',
      signedBy: 'Owner Smoke',
      snapshot: { expected: 1689, collected: 1401, stillOpen: 288, failedTwice: 0, openPaymentLinks: 1, openPaymentLinkAmount: 88, stalePaymentLinks: 1, stalePaymentLinkAmount: 44, staleAutopaySchedules: 1, staleAutopayAmount: 70, openCardSetupLinks: 2, pendingStarApprovals: 3, vehicleAssignmentConflicts: 1 }
    });
    const closeoutDedupWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: closeoutDedupData });
    assert(closeoutDedupWrite.status === 200 && closeoutDedupWrite.json.ok, 'Owner could not seed closeout duplicate payment records.');
    const closeoutReconciledState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const reconciledPaymentLink = (closeoutReconciledState.json.paymentRequests || []).find(row => row.id === 'plink-direct-closeout-already-paid');
    assert(reconciledPaymentLink && /paid/i.test(reconciledPaymentLink.status || '') && reconciledPaymentLink.matchedPaymentId === 'payment-direct-reconciled-link', 'Open hosted payment links should auto-close when a matching paid payment record exists.');
    const closeoutCandidateReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: ownerCookie });
    assert(closeoutCandidateReport.status === 200 && closeoutCandidateReport.text.includes('Possible match Direct Report Candidate') && closeoutCandidateReport.text.includes('DIRECTREPORTVIN') && closeoutCandidateReport.text.includes('Tag DIR-RPT'), 'Deep report should show possible customer/vehicle evidence for unmatched transaction rows.');
    assert(closeoutCandidateReport.text.includes('Stale autopay schedules') && closeoutCandidateReport.text.includes('Direct Closeout Stale Autopay') && closeoutCandidateReport.text.includes('DIRECTSTALEVIN') && closeoutCandidateReport.text.includes('DIR-STL'), 'Deep report should export stale autopay schedule rows with customer, VIN, and tag evidence.');
    const closeoutDedupNotification = await request(server, 'POST', '/api/notifications/daily-closeout', {
      cookie: ownerCookie,
      json: { dateKey: '2099-12-31' }
    });
    assert([200, 202].includes(closeoutDedupNotification.status) && closeoutDedupNotification.json.ok, 'Duplicate-safe daily closeout notification failed.');
    assert(closeoutDedupNotification.json.summary.collected === 1401, 'Daily closeout should dedupe duplicate Clover paid rows, count verified paid-outside payments, resolve external customer refs, and ignore failed rows.');
    assert(closeoutDedupNotification.json.summary.transactions === 7, 'Daily closeout should report unique transaction rows after dedupe, including historical failures and unverified paid-outside reports without counting the latter as collected.');
    assert(closeoutDedupNotification.json.summary.expected < 987654 && !closeoutDedupNotification.json.summary.contactRows.some(row => row.customer === 'Direct Closeout Removed'), 'Removed recurring customers must not count toward Today expected money or contact work.');
    assert(closeoutDedupNotification.json.summary.paidOutsideApp === 1 && closeoutDedupNotification.json.summary.paidOutsideAmount === 45, 'Daily closeout should break out paid-outside-app records separately.');
    assert(closeoutDedupNotification.json.summary.cloverCollected === 1356 && closeoutDedupNotification.json.summary.cloverTransactions === 3, 'Daily closeout should keep Clover collected totals separate from paid-outside-app records.');
    assert(closeoutDedupNotification.json.summary.openPaymentRequests >= 1 && closeoutDedupNotification.json.summary.openPaymentRequestAmount >= 88 && Object.prototype.hasOwnProperty.call(closeoutDedupNotification.json.summary, 'stalePaymentRequests') && closeoutDedupNotification.json.summary.paymentRequestRows.some(row => row.customer === 'Direct Closeout Payment Link' && row.vin === 'DIRECTREPORTVIN' && row.tag === 'DIR-RPT' && row.ageLabel), 'Daily closeout should expose open hosted checkout links with customer, VIN, tag, amount, and age.');
    assert(closeoutDedupNotification.json.summary.openCardSetupRequests >= 1 && Array.isArray(closeoutDedupNotification.json.summary.cardSetupRows) && closeoutDedupNotification.json.summary.cardSetupRows.some(row => row.customer === 'Alicia Brown'), 'Daily closeout should expose open card setup/change links with customer context.');
    assert(closeoutDedupNotification.json.summary.staleAutopaySchedules >= 1 && closeoutDedupNotification.json.summary.staleAutopayAmount >= 70 && Array.isArray(closeoutDedupNotification.json.summary.staleAutopayRows) && closeoutDedupNotification.json.summary.staleAutopayRows.some(row => row.customer === 'Direct Closeout Stale Autopay' && row.vin === 'DIRECTSTALEVIN' && row.tag === 'DIR-STL'), 'Daily closeout should expose stale autopay schedules with customer, VIN, tag, amount, and review status.');
    assert(closeoutDedupNotification.json.summary.pendingStarApprovals >= 1 && Array.isArray(closeoutDedupNotification.json.summary.starApprovalRows) && closeoutDedupNotification.json.summary.starApprovalRows.some(row => row.customer === 'Alicia Brown'), 'Daily closeout should expose pending Star approval rows with customer context.');
    assert(closeoutDedupNotification.json.summary.receiptRequests >= 1 && closeoutDedupNotification.json.summary.statementRequests >= 1, 'Daily closeout should separately count receipt and statement/payoff requests waiting for approval.');
    assert(closeoutDedupNotification.json.summary.pendingToday >= 1 && closeoutDedupNotification.json.summary.expected === 1799 && closeoutDedupNotification.json.summary.appliedToExpected === 777 && closeoutDedupNotification.json.summary.stillOpenAmount === 1022 && closeoutDedupNotification.json.summary.outstandingCustomers === 4, 'Daily closeout must only apply a collected payment to the matching customer due; unrelated or ambiguously unmatched money cannot reduce still-open balances.');
    assert(closeoutDedupNotification.json.summary.peopleToContact === 2 && closeoutDedupNotification.json.summary.paidTransactions === 4, 'Daily closeout should expose contact and paid transaction counts.');
    assert(Array.isArray(closeoutDedupNotification.json.summary.contactRows) && closeoutDedupNotification.json.summary.contactRows.some(row => row.customer === 'Direct Closeout Failed Twice' && row.vin === 'DIRECTFAILED2VIN') && closeoutDedupNotification.json.summary.contactRows.some(row => row.customer === 'Direct Closeout Payment Missing' && row.tag === 'DIR-PNF'), 'Daily closeout should return structured contact rows with customer, VIN, and tag evidence.');
    assert(closeoutDedupNotification.json.summary.vehicleAssignmentConflicts >= 1, 'Daily closeout should expose vehicle assignment conflicts before owner signoff.');
    assert(closeoutDedupNotification.json.summary.signedOff === true && closeoutDedupNotification.json.summary.signedBy === 'Owner Smoke', 'Daily closeout should expose saved owner signoff metadata.');
    assert(closeoutDedupNotification.json.summary.signoffSnapshot && closeoutDedupNotification.json.summary.signoffSnapshot.collected === 1401, 'Daily closeout should carry the frozen signoff snapshot.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Owner signoff: Signed off by Owner Smoke') && String(closeoutDedupNotification.json.message.body || '').includes('Signed snapshot: expected $1,689') && String(closeoutDedupNotification.json.message.body || '').includes('open links 1 / $88') && String(closeoutDedupNotification.json.message.body || '').includes('stale links 1 / $44') && String(closeoutDedupNotification.json.message.body || '').includes('stale autopay 1 / $70') && String(closeoutDedupNotification.json.message.body || '').includes('card setup links 2') && String(closeoutDedupNotification.json.message.body || '').includes('Star approvals 3'), 'Daily closeout message should include signoff status, snapshot numbers, payment links, stale autopay, card setup links, and Star approval counts.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Customer | $777') && String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Customer | $123'), 'Daily closeout should keep the customer name for deduped and externally referenced Clover transactions.');
    const closeoutReviewBlock = String(closeoutDedupNotification.json.message.body || '').split('Customers to review:')[1].split('Contact list:')[0];
    assert(!closeoutReviewBlock.includes('Direct Closeout Removed') && String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Removed | $99 | FAIL'), 'Removed recurring customers must stay out of Today review while their transaction history remains visible.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Paid outside app: 1 / $45'), 'Daily closeout body should show paid-outside-app totals.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Open payment requests:') && String(closeoutDedupNotification.json.message.body || '').includes('Stale payment links:') && String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Payment Link | $88 | Open | New link') && !String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Paid Link'), 'Daily closeout body should list open hosted checkout link age and exclude paid links.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Open card setup/change links:') && String(closeoutDedupNotification.json.message.body || '').includes('Pending Star approvals:') && String(closeoutDedupNotification.json.message.body || '').includes('Receipt requests waiting:') && String(closeoutDedupNotification.json.message.body || '').includes('Statement/payoff requests waiting:'), 'Daily closeout body should list open card setup links, pending Star approvals, and customer document request counts.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Stale autopay schedules:') && String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Stale Autopay | $70 | Stale autopay schedule - review next run') && String(closeoutDedupNotification.json.message.body || '').includes('DIRECTSTALEVIN'), 'Daily closeout body should list stale autopay schedules with customer, VIN/tag, and review status.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Contact list:') && String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Failed Twice | $50 | Failed twice - contact now') && String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Payment Missing | $60 | Payment not found - verify Clover/card'), 'Daily closeout body should list exact customers needing follow-up.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Vehicle assignment conflicts:') && String(closeoutDedupNotification.json.message.body || '').includes('DIRECTCONFLICTVIN'), 'Daily closeout body should list vehicle assignment conflicts with VIN/tag evidence.');

    const receiptDraft = await request(server, 'POST', '/api/messages/send', {
      cookie: ownerCookie,
      json: {
        customer: 'Direct Closeout Customer',
        email: 'direct-closeout@example.com',
        channel: 'Email',
        subject: 'WheelsonAuto payment receipt $777',
        template: 'Payment receipt',
        body: 'Receipt for Direct Closeout Customer payment pay-closeout-dedup.',
        paymentId: 'clover-payment-closeout-dedup-two'
      }
    });
    assert([200, 202].includes(receiptDraft.status) && receiptDraft.json.ok, 'Payment receipt message should send or save as a draft.');
    assert(receiptDraft.json.message.paymentId === 'clover-payment-closeout-dedup-two', 'Payment receipt message should keep the linked payment ID.');
    assert(receiptDraft.json.message.template === 'Payment receipt', 'Payment receipt message should be labeled as a receipt.');

    const closeoutNotification = await request(server, 'POST', '/api/notifications/daily-closeout', {
      cookie: ownerCookie,
      json: { ownerNote: 'Owner smoke note: count cash drawer and call failed-twice customers.' }
    });
    assert([200, 202].includes(closeoutNotification.status) && closeoutNotification.json.ok, 'Daily closeout notification failed.');
    assert(closeoutNotification.json.message.event === 'daily_closeout', 'Daily closeout should save a daily_closeout notification message.');
    assert(closeoutNotification.json.summary && Object.prototype.hasOwnProperty.call(closeoutNotification.json.summary, 'collected'), 'Daily closeout should return a money summary.');
    assert(String(closeoutNotification.json.message.body || '').includes('Owner smoke note'), 'Daily closeout should include the owner closeout note in the message body.');
    assert(String(closeoutNotification.json.message.body || '').includes('Verification inbox:'), 'Daily closeout should include the verification inbox section.');
    assert(closeoutNotification.json.summary && Object.prototype.hasOwnProperty.call(closeoutNotification.json.summary, 'verificationItems'), 'Daily closeout summary should return the verification inbox count.');
    assert(closeoutNotification.json.summary && Object.prototype.hasOwnProperty.call(closeoutNotification.json.summary, 'vehicleAssignmentConflicts'), 'Daily closeout summary should return the vehicle assignment conflict count.');
    assert(Array.isArray(closeoutNotification.json.summary.auditRows) && closeoutNotification.json.summary.auditRows.some(row => /password help|Customer portal|Star AI|message/i.test(String(row.action || ''))), 'Daily closeout summary should return structured sensitive-change audit rows.');
    assert(closeoutNotification.json.summary.ownerNote === 'Owner smoke note: count cash drawer and call failed-twice customers.', 'Daily closeout summary should return the owner note.');
    const notificationState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(notificationState.json.messages.some(message => message.event === 'application_submitted' && message.customer === 'Direct Notified Applicant'), 'Application notification should be saved in Messages.');
    assert(notificationState.json.messages.some(message => message.event === 'daily_closeout'), 'Daily closeout notification should be saved in Messages.');
    assert((notificationState.json.dailyCloseouts || []).some(row => row.note === 'Owner smoke note: count cash drawer and call failed-twice customers.'), 'Daily closeout owner note should be saved to state.');

    const alertState = JSON.parse(JSON.stringify(notificationState.json));
    alertState.maintenance = alertState.maintenance || [];
    alertState.claims = alertState.claims || [];
    alertState.maintenance.unshift({
      id: 'direct-maintenance-alert',
      vehicle: 'Direct Alert Vehicle',
      customer: 'Direct Maintenance Customer',
      type: 'Monthly inspection',
      issue: 'Due inspection',
      due: 'Today',
      status: 'Scheduled'
    });
    alertState.claims.unshift({
      id: 'direct-dispute-alert',
      type: 'Clover dispute',
      source: 'Clover',
      customer: 'Unassigned',
      amount: 44,
      status: 'Open',
      customerMatchStatus: 'Needs payment/customer match',
      externalId: 'direct-dispute-alert-id'
    });
    const alertWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: alertState });
    assert(alertWrite.status === 200 && alertWrite.json.ok, 'State-change notification write failed.');
    const alertRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(alertRead.json.messages.some(message => message.event === 'maintenance_due' && message.customer === 'Direct Maintenance Customer'), 'Maintenance due notification should be saved.');
    assert(alertRead.json.messages.some(message => message.event === 'claim_dispute' && /Direct|Unassigned|Unmatched/i.test(message.customer || message.subject || '')), 'Claim/dispute notification should be saved.');

    const autopayTodayParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const autopayTodayKey = (autopayTodayParts.find(part => part.type === 'year') || {}).value + '-' + (autopayTodayParts.find(part => part.type === 'month') || {}).value + '-' + (autopayTodayParts.find(part => part.type === 'day') || {}).value;
    const autopayDateOffset = days => {
      const date = new Date(autopayTodayKey + 'T12:00:00Z');
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };
    const stalePaidDueDate = autopayDateOffset(-14);
    const overdueChargeDueDate = autopayDateOffset(-7);
    const amountEditNextRun = autopayDateOffset(14);
    const autopayState = JSON.parse(JSON.stringify(notificationState.json));
    autopayState.recurringPayments = autopayState.recurringPayments || [];
    autopayState.recurringPayments.unshift({
      id: 'direct-autopay-missing-token',
      customer: 'Direct Missing Token',
      phone: '3135550333',
      email: 'missing-token@example.com',
      vehicle: '2016 Ford Focus Hatch',
      vin: 'DIRECTMISSINGTOKEN',
      amount: 88,
      frequency: 'Weekly',
      nextRun: 'Today',
      chargeTime: '00:01',
      status: 'Active',
      tone: 'good',
      autoChargeEnabled: true,
      autopayManagedBy: 'WheelsonAuto',
      paymentSetup: 'Card saved through WheelsonAuto',
      cardSavedAt: new Date().toISOString()
    }, {
      id: 'direct-autopay-fail-once',
      customer: 'Direct Failed Once',
      phone: '3135550444',
      email: 'failed-once@example.com',
      vehicle: '2017 Ford Fusion',
      vin: 'DIRECTFAILEDONCE',
      amount: 77,
      frequency: 'Weekly',
      nextRun: 'Today',
      chargeTime: '00:01',
      status: 'Active',
      tone: 'good',
      autoChargeEnabled: true,
      autopayManagedBy: 'WheelsonAuto',
      cloverCustomerId: 'custfail001',
      paymentSetup: 'Card saved through WheelsonAuto',
      cardSavedAt: new Date().toISOString()
    }, {
      id: 'direct-autopay-fail-twice',
      customer: 'Direct Failed Twice',
      phone: '3135550555',
      email: 'failed-twice@example.com',
      vehicle: '2018 Nissan Altima',
      vin: 'DIRECTFAILEDTWICE',
      amount: 66,
      frequency: 'Weekly',
      nextRun: 'Today',
      chargeTime: '00:01',
      status: '1x failed - retrying',
      tone: 'warn',
      retryCount: 1,
      failedAttempts: 1,
      autoChargeEnabled: true,
      autopayManagedBy: 'WheelsonAuto',
      cloverCustomerId: 'custfail002',
      paymentSetup: 'Card saved through WheelsonAuto',
      cardSavedAt: new Date().toISOString()
    }, {
      id: 'direct-autopay-paid-stale',
      customer: 'Direct Paid Stale Schedule',
      phone: '3135550666',
      email: 'paid-stale@example.com',
      vehicle: '2019 Honda Accord',
      vin: 'DIRECTPAIDSTALEVIN',
      amount: 279,
      frequency: 'Weekly',
      nextRun: stalePaidDueDate,
      paymentDay: calendarDayName(stalePaidDueDate),
      chargeTime: '18:00',
      status: 'Active',
      tone: 'good',
      autoChargeEnabled: true,
      autopayManagedBy: 'WheelsonAuto',
      cloverCustomerId: 'custpaidstale001',
      paymentSetup: 'Card saved through WheelsonAuto',
      cardSavedAt: new Date().toISOString(),
      lastPaymentResult: 'Paid',
      lastPaymentAt: new Date().toISOString(),
      lastCloverChargeId: 'charge-paid-stale-001'
    }, {
      id: 'direct-autopay-success-overdue',
      customer: 'Direct Overdue Charge',
      phone: '3135550777',
      email: 'overdue-charge@example.com',
      vehicle: '2020 Toyota Camry',
      vin: 'DIRECTOVERDUEVIN',
      amount: 91,
      frequency: 'Weekly',
      nextRun: overdueChargeDueDate,
      paymentDay: calendarDayName(overdueChargeDueDate),
      chargeTime: '18:00',
      status: 'Active',
      tone: 'good',
      autoChargeEnabled: true,
      autopayManagedBy: 'WheelsonAuto',
      cloverCustomerId: 'custsuccess001',
      paymentSetup: 'Card saved through WheelsonAuto',
      cardSavedAt: new Date().toISOString()
    }, {
      id: 'direct-autopay-amount-edit',
      customer: 'Direct Amount Edit',
      phone: '3135550888',
      email: 'amount-edit@example.com',
      vehicle: '2021 Kia K5',
      vin: 'DIRECTAMOUNTEDITVIN',
      amount: 229,
      frequency: 'Weekly',
      nextRun: amountEditNextRun,
      paymentDay: calendarDayName(amountEditNextRun),
      chargeTime: '18:00',
      status: 'Active',
      tone: 'good',
      autoChargeEnabled: true,
      autopayManagedBy: 'WheelsonAuto',
      cloverCustomerId: 'custamount001',
      paymentSetup: 'Card saved through WheelsonAuto',
      cardSavedAt: new Date().toISOString()
    });
    const autopayWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: autopayState });
    assert(autopayWrite.status === 200 && autopayWrite.json.ok, 'Autopay smoke setup failed.');
    const wrongAmountEditDay = calendarDayName(amountEditNextRun) === 'Thursday' ? 'Friday' : 'Thursday';
    const amountOnlyEdit = await request(server, 'POST', '/api/recurring-payments/update', {
      cookie: ownerCookie,
      json: {
        recurringPaymentId: 'direct-autopay-amount-edit',
        amount: 279,
        frequency: 'Weekly',
        nextRun: amountEditNextRun,
        paymentDay: wrongAmountEditDay,
        chargeTime: '18:00',
        status: 'Active',
        autopayManagedBy: 'WheelsonAuto'
      }
    });
    assert(amountOnlyEdit.status === 200 && amountOnlyEdit.json.ok && amountOnlyEdit.json.amountChanged && !amountOnlyEdit.json.scheduleChanged, 'Changing only an autopay amount should not be treated as a schedule change.');
    assert(amountOnlyEdit.json.paymentDay === calendarDayName(amountEditNextRun), 'The server must derive the weekly charge day from the calendar date instead of saving a conflicting weekday.');
    const amountEditRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const amountEditRow = amountEditRead.json.recurringPayments.find(row => row.id === 'direct-autopay-amount-edit');
    assert(amountEditRow && amountEditRow.amount === 279 && amountEditRow.nextRun === amountEditNextRun && amountEditRow.paymentDay === calendarDayName(amountEditNextRun) && amountEditRow.chargeTime === '18:00' && amountEditRow.frequency === 'Weekly' && amountEditRow.status === 'Active' && amountEditRow.autoChargeEnabled === true, 'An amount edit must preserve date, weekday, time, frequency, status, and enabled autopay state.');
    const enrichedPaymentLink = await request(server, 'POST', '/api/payment-links', {
      cookie: ownerCookie,
      json: { recurringPaymentId: 'direct-autopay-fail-once' }
    });
    assert(enrichedPaymentLink.status === 201 && enrichedPaymentLink.json.ok, 'Owner payment-link creation failed.');
    assert(enrichedPaymentLink.json.paymentLink.customer === 'Direct Failed Once' && enrichedPaymentLink.json.paymentLink.vehicle === '2017 Ford Fusion' && enrichedPaymentLink.json.paymentLink.vin === 'DIRECTFAILEDONCE' && enrichedPaymentLink.json.paymentLink.amount === 77, 'Payment links should inherit customer, vehicle, VIN, and amount from the recurring row.');
    const autopayOriginalFetch = global.fetch;
    let successfulAutopayChargeCalls = 0;
    global.fetch = async (url, options = {}) => {
      if (String(url).includes('/v1/charges')) {
        const body = JSON.parse(String(options.body || '{}'));
        if (body.source === 'custsuccess001') {
          successfulAutopayChargeCalls += 1;
          return { ok: true, status: 200, async text() { return JSON.stringify({ id: 'charge-direct-overdue-001', status: 'succeeded', paid: true, captured: true }); } };
        }
        return { ok: false, status: 402, async text() { return JSON.stringify({ message: 'Direct card decline' }); } };
      }
      if (String(url).includes('api.resend.com')) return { ok: true, status: 200, async json() { return { id: 'direct-email-autopay' }; }, async text() { return JSON.stringify({ id: 'direct-email-autopay' }); } };
      return autopayOriginalFetch(url, options);
    };
    let autopayRun;
    let secondAutopayRun;
    try {
      autopayRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie: ownerCookie, json: {} });
      secondAutopayRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie: ownerCookie, json: {} });
    } finally {
      global.fetch = autopayOriginalFetch;
    }
    assert([200, 207].includes(autopayRun.status) && autopayRun.json.notFound === 1 && autopayRun.json.charged === 1 && autopayRun.json.reconciled === 1, 'Autopay should charge one overdue unpaid row, reconcile one already-paid stale row, and keep the payment-not-found path visible.');
    assert(successfulAutopayChargeCalls === 1 && secondAutopayRun.json.charged === 0, 'Repeating the autopay runner must not charge a completed scheduled occurrence twice.');
    const autopayRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(autopayRead.json.messages.some(message => message.event === 'payment_not_found' && message.customer === 'Direct Missing Token'), 'Payment-not-found notification should be saved in Messages.');
    assert(autopayRead.json.messages.some(message => message.event === 'payment_failed' && message.customer === 'Direct Failed Once' && /1x failed/i.test(message.subject || '')), '1x failed payment notification should be saved in Messages.');
    assert(autopayRead.json.messages.some(message => message.event === 'payment_failed' && message.customer === 'Direct Failed Twice' && /2x failed/i.test(message.subject || '')), '2x failed payment notification should be saved in Messages.');
    assert(autopayRead.json.payments.some(payment => payment.customer === 'Direct Missing Token' && String(payment.status || '').includes('Payment not found')), 'Payment-not-found transaction should be saved.');
    assert(autopayRead.json.payments.some(payment => payment.customer === 'Direct Failed Once' && String(payment.status || '').includes('1x failed') && payment.vin === 'DIRECTFAILEDONCE'), '1x failed autopay should save a named failed transaction with vehicle evidence.');
    assert(autopayRead.json.payments.some(payment => payment.customer === 'Direct Failed Twice' && String(payment.status || '').includes('2x failed') && payment.vin === 'DIRECTFAILEDTWICE'), '2x failed autopay should save a named failed transaction with vehicle evidence.');
    const failedTwiceRow = autopayRead.json.recurringPayments.find(row => row.id === 'direct-autopay-fail-twice');
    assert(failedTwiceRow && String(failedTwiceRow.status || '').includes('2x failed'), 'Second failed autopay should mark the customer as 2x failed.');
    const reconciledPaidRow = autopayRead.json.recurringPayments.find(row => row.id === 'direct-autopay-paid-stale');
    assert(reconciledPaidRow && reconciledPaidRow.nextRun > autopayTodayKey && calendarDayName(reconciledPaidRow.nextRun) === calendarDayName(stalePaidDueDate) && reconciledPaidRow.lastScheduleReconciledFrom === stalePaidDueDate, 'A manually paid stale schedule should move to its next future weekday without another card charge.');
    const overdueChargedRow = autopayRead.json.recurringPayments.find(row => row.id === 'direct-autopay-success-overdue');
    assert(overdueChargedRow && overdueChargedRow.nextRun > autopayTodayKey && calendarDayName(overdueChargedRow.nextRun) === calendarDayName(overdueChargeDueDate) && overdueChargedRow.lastAutoChargeResult === 'Paid', 'A successful overdue autopay must persist the next future occurrence on the original weekday.');

    const managerMessage = await request(server, 'POST', '/api/messages/send', {
      cookie: managerCookie,
      json: { customer: 'Direct Customer', phone: '3135550199', body: 'Direct smoke manager message.' }
    });
    assert([200, 202].includes(managerMessage.status) && managerMessage.json.ok, 'Manager SMS message failed.');

    const managerEmail = await request(server, 'POST', '/api/messages/send', {
      cookie: managerCookie,
      json: { customer: 'Direct Customer', email: 'direct-customer@example.com', channel: 'Email', body: 'Direct smoke email message.' }
    });
    assert([200, 202].includes(managerEmail.status) && managerEmail.json.ok, 'Manager email draft/send failed.');
    assert(managerEmail.json.message.channel === 'Email', 'Email message should be saved as Email channel.');

    const blockedInboundSms = await request(server, 'POST', '/api/webhooks/messages', {
      json: { MessageSid: 'direct-sms-blocked', From: '+13135550199', To: '+13135550000', Body: 'Unsigned inbound text.' }
    });
    assert(blockedInboundSms.status === 401, 'Inbound SMS webhook should require the configured secret.');
    const inboundSms = await request(server, 'POST', '/api/webhooks/messages', {
      headers: { 'x-woa-webhook-secret': 'direct-message-secret' },
      json: { MessageSid: 'direct-sms-001', From: '+13135550199', To: '+13135550000', Body: 'Can I get my account balance?' }
    });
    assert(inboundSms.status === 200 && inboundSms.json.ok && inboundSms.json.received, 'Inbound SMS webhook with secret failed.');
    assert(inboundSms.json.ai && inboundSms.json.ai.actionType === 'send_account_statement' && inboundSms.json.ai.status === 'Needs approval', 'Inbound SMS should create a Star account-statement approval draft instead of silently stopping.');
    const inboundSmsState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert((inboundSmsState.json.messages || []).some(message => message.aiSourceMessageId === 'direct-sms-001' && message.customer === 'Direct Customer' && message.phone === '+13135550199' && message.channel === 'Star AI'), 'Inbound SMS Star draft should stay linked to the customer and phone context.');

    const blockedInboundEmail = await request(server, 'POST', '/api/webhooks/email', {
      json: {
        id: 'direct-email-blocked',
        from: 'Direct Customer <direct-customer@example.com>',
        to: 'office@wheelsonauto.com',
        subject: 'Blocked payment question',
        text: 'This should not save without the webhook secret.'
      }
    });
    assert(blockedInboundEmail.status === 401, 'Inbound email webhook should require the configured secret.');
    const inboundEmail = await request(server, 'POST', '/api/webhooks/email', {
      headers: { 'x-woa-webhook-secret': 'direct-message-secret' },
      json: {
        id: 'direct-email-001',
        from: 'Direct Customer <direct-customer@example.com>',
        to: 'office@wheelsonauto.com',
        subject: 'Payment question',
        text: 'Can you send me my payment link?'
      }
    });
    assert(inboundEmail.status === 200 && inboundEmail.json.ok && inboundEmail.json.received, 'Inbound email webhook failed.');
    assert(inboundEmail.json.ai && inboundEmail.json.ai.actionType === 'send_payment_link', 'Inbound email should create a Star payment-link draft from the customer email.');
    const inboundEmailState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert((inboundEmailState.json.messages || []).some(message => message.aiSourceMessageId === 'direct-email-001' && message.customer === 'Direct Customer' && message.email === 'direct-customer@example.com' && message.channel === 'Star AI' && message.deliveryChannel === 'Email'), 'Inbound email Star draft should stay linked to the customer, email, and Email delivery channel.');

    const starCardSetup = await request(server, 'POST', '/api/messages/ai-reply', {
      cookie: managerCookie,
      json: { customer: 'Direct Failed Once', phone: '3135550444', channel: 'SMS', body: 'I need to update my card on file.' }
    });
    assert(starCardSetup.status === 201 && starCardSetup.json.ok, 'Star card setup draft failed.');
    assert(starCardSetup.json.plan.actionType === 'send_card_setup', 'Star should recognize card-on-file update requests.');
    assert(starCardSetup.json.plan.context && starCardSetup.json.plan.context.systemHealth && Array.isArray(starCardSetup.json.plan.context.systemHealth.nextActions), 'Star drafts should include compact system health context.');
    assert(String(starCardSetup.json.draft.body || '').includes('/setup-card/'), 'Star card setup reply should include a secure setup link.');
    assert(starCardSetup.json.plan.related.cardSetupRequestId, 'Star card setup should save the setup request ID.');
    assert(starCardSetup.json.plan.preparedAction && starCardSetup.json.plan.preparedAction.type === 'send_card_setup' && starCardSetup.json.plan.preparedAction.cardSetupRequestId === starCardSetup.json.plan.related.cardSetupRequestId, 'Star card setup should expose a prepared card setup action.');
    assert(starCardSetup.json.plan.preparedAction.vehicle && starCardSetup.json.plan.preparedAction.vin, 'Star prepared card setup action should include vehicle and VIN context when those fields exist.');
    const starCardState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert((starCardState.json.cardSetupRequests || []).some(request => request.id === starCardSetup.json.plan.related.cardSetupRequestId && request.recurringPaymentId === 'direct-autopay-fail-once'), 'Star card setup request should attach to the existing autopay row.');
    assert((starCardState.json.auditLogs || []).some(row => row.action === 'Star AI reply drafted' && String(row.details || '').includes('Direct Failed Once') && String(row.details || '').includes('Card setup link prepared')), 'Star card setup drafts should create an owner audit trail.');
    const starCardSetupPage = await request(server, 'GET', '/setup-card/' + starCardSetup.json.plan.related.cardSetupRequestId);
    assert(starCardSetupPage.status === 200 && starCardSetupPage.text.includes('Set up automatic payments') && starCardSetupPage.text.includes('Direct Failed Once'), 'Star-created card setup page should render for the customer.');
    assert(!starCardSetupPage.text.includes('secret-source-token') && !starCardSetupPage.text.includes('secret-payment-token') && !starCardSetupPage.text.includes('secret-raw-value'), 'Star-created card setup page should not expose private payment tokens.');
    assert(!starCardSetupPage.text.includes('Direct Dispute Customer') && !starCardSetupPage.text.includes('direct-customer'), 'Star-created card setup page should not expose unrelated customer records.');

    const starDraft = await request(server, 'POST', '/api/messages/ai-reply', {
      cookie: managerCookie,
      json: { customer: 'Direct Customer', email: 'direct-customer@example.com', channel: 'Email', body: 'What time can I come in for service?' }
    });
    assert(starDraft.status === 201 && starDraft.json.ok, 'Manager could not create Star draft.');
    assert(starDraft.json.draft.deliveryChannel === 'Email', 'Star draft should preserve Email delivery channel.');
    assert(starDraft.json.plan.canAutoSend === true, 'Safe Star service reply should be auto-ready.');

    const starSend = await request(server, 'POST', '/api/messages/ai-action', {
      cookie: managerCookie,
      json: { draftId: starDraft.json.draft.id, channel: 'Email' }
    });
    assert([200, 202].includes(starSend.status) && starSend.json.ok, 'Star email approval failed.');

    const starChargeDraft = await request(server, 'POST', '/api/messages/ai-reply', {
      cookie: managerCookie,
      json: { customer: 'Direct Failed Once', phone: '3135550444', channel: 'SMS', body: 'Can you charge the card on file right now?' }
    });
    assert(starChargeDraft.status === 201 && starChargeDraft.json.plan.actionType === 'charge_saved_card' && starChargeDraft.json.plan.approvalRequired === true, 'Star should classify saved-card charge requests as approval-required money actions.');
    assert(starChargeDraft.json.plan.preparedAction && starChargeDraft.json.plan.preparedAction.type === 'charge_saved_card' && starChargeDraft.json.plan.preparedAction.requiresAdminApproval === true, 'Star saved-card charge request should expose a review-only prepared action.');
    assert(/No charge was run/i.test(starChargeDraft.json.plan.preparedAction.adminGuardrail || ''), 'Star charge prepared action should clearly say no charge was run.');
    const blockedStarChargeSend = await request(server, 'POST', '/api/messages/ai-action', {
      cookie: managerCookie,
      json: { draftId: starChargeDraft.json.draft.id, channel: 'SMS', approveMoneyAction: true }
    });
    assert(blockedStarChargeSend.status === 403 && /Only the owner/i.test(blockedStarChargeSend.json.error || ''), 'Manager must not approve a sensitive Star money action even by forging the owner approval flag.');
    const starReceiptDraft = await request(server, 'POST', '/api/messages/ai-reply', {
      cookie: managerCookie,
      json: { customer: 'Direct Closeout Customer', email: 'direct-closeout@example.com', channel: 'Email', body: 'Can you send me a receipt for my payment?' }
    });
    assert(starReceiptDraft.status === 201 && starReceiptDraft.json.plan.actionType === 'send_receipt' && starReceiptDraft.json.plan.approvalRequired === true, 'Star should classify receipt requests as approval-required payment actions.');
    const blockedStarReceiptSend = await request(server, 'POST', '/api/messages/ai-action', {
      cookie: managerCookie,
      json: { draftId: starReceiptDraft.json.draft.id, channel: 'Email', approveMoneyAction: true }
    });
    assert(blockedStarReceiptSend.status === 403 && /Only the owner/i.test(blockedStarReceiptSend.json.error || ''), 'Manager must not send an approval-gated receipt draft by forging the owner approval flag.');
    const pendingStarHealth = await request(server, 'GET', '/api/system/health', { cookie: ownerCookie });
    assert(pendingStarHealth.json.issues.some(row => row.key === 'pending_star_approvals' && Number(row.count) >= 1 && row.view === 'Messages' && row.tab === 'Star'), 'System health should surface pending Star approvals for admin review.');
    assert(pendingStarHealth.json.issues.some(row => row.key === 'open_card_setup_links' && Number(row.count) >= 1 && row.view === 'Messages' && row.tab === 'Queue'), 'System health should surface open card setup/change links for follow-up.');
    assert(Number(pendingStarHealth.json.summary.pendingStarApprovals || 0) >= 1 && Number(pendingStarHealth.json.summary.openCardSetupRequests || 0) >= 1, 'System health summary should count pending Star approvals and open card setup links.');
    const pendingStarReadiness = await request(server, 'POST', '/api/system/readiness', { cookie: ownerCookie });
    assert(pendingStarReadiness.json.truthChecks.some(row => row.key === 'pending_star_approvals' && Number(row.count) >= 1), 'System readiness should include pending Star approval review rows.');
    assert(pendingStarReadiness.json.truthChecks.some(row => row.key === 'open_card_setup_links' && Number(row.count) >= 1), 'System readiness should include open card setup link review rows.');
    const pendingStarReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: ownerCookie });
    assert(pendingStarReport.text.includes('Pending Star approvals') && pendingStarReport.text.includes('Open card setup links'), 'Deep report should include pending Star approval and open card setup QA rows.');

    const starOff = await request(server, 'POST', '/api/messages/settings', {
      cookie: ownerCookie,
      json: { aiEnabled: false }
    });
    assert(starOff.status === 200 && starOff.json.messaging.aiEnabled === false, 'Owner should be able to turn Star off.');
    const starBlockedWhileOff = await request(server, 'POST', '/api/messages/ai-reply', {
      cookie: managerCookie,
      json: { customer: 'Direct Customer', phone: '3135550101', body: 'Can you send me a payment link?' }
    });
    assert(starBlockedWhileOff.status === 423, 'Star AI should respect the WheelsonAuto off switch.');
    const starBackOn = await request(server, 'POST', '/api/messages/settings', {
      cookie: ownerCookie,
      json: { aiEnabled: true, aiAutoSend: true }
    });
    assert(starBackOn.status === 200 && starBackOn.json.messaging.aiEnabled === true, 'Owner should be able to turn Star back on after the off-switch test.');

    const mechanicMessage = await request(server, 'POST', '/api/messages/send', {
      cookie: mechanicCookie,
      json: { customer: 'Blocked', phone: '3135550199', body: 'Should not save.' }
    });
    assert(mechanicMessage.status === 403, 'Mechanic message API should be blocked.');

    const mechanicAutopay = await request(server, 'POST', '/api/recurring-payments', {
      cookie: mechanicCookie,
      json: { customer: 'Blocked Autopay', amount: 1 }
    });
    assert(mechanicAutopay.status === 403, 'Mechanic recurring payment API should be blocked.');

    const managerFranchise = await request(server, 'POST', '/api/organizations', {
      cookie: managerCookie,
      json: { id: 'manager-should-not-create', name: 'Blocked manager company' }
    });
    assert(managerFranchise.status === 403, 'Manager organization API should be blocked.');

    const managerNotification = await request(server, 'POST', '/api/notifications/email/test', {
      cookie: managerCookie,
      json: { to: 'blocked@example.com', subject: 'Blocked', body: 'Should not save.' }
    });
    assert(managerNotification.status === 403, 'Manager notification API should be blocked.');

    const ownerAuditState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const auditLogs = ownerAuditState.json.auditLogs || [];
    const auditActions = auditLogs.map(row => row.action);
    ['Autopay created', 'Staff account created', 'Staff account updated', 'Customer login created', 'Customer login updated', 'Company account created', 'API provider saved', 'Staff password help requested', 'Customer password help requested', 'Customer portal paid-outside reported', 'Customer portal receipt requested', 'Customer portal service requested', 'Customer portal issue reported', 'Customer portal document submitted', 'Customer portal card setup link opened', 'Customer portal message received', 'Star AI reply drafted', 'Star AI approval drafted', 'Star AI reply approved'].forEach(action => {
      assert(auditActions.includes(action), 'Owner audit trail should include route action: ' + action);
    });
    assert(auditLogs.some(row => String(row.details || '').includes('Direct Autopay File Customer')), 'Owner audit trail should include customer names for autopay work.');
    assert(!JSON.stringify(auditLogs).includes('DirectCustomer123!') && !JSON.stringify(auditLogs).includes('DirectManager123!') && !JSON.stringify(auditLogs).includes('DirectManager456!'), 'Owner audit trail must not store raw passwords.');

    const managerState = await request(server, 'GET', '/api/state', { cookie: managerCookie });
    assert(managerState.status === 200 && Array.isArray(managerState.json.messages), 'Manager should see message state.');
    assert(managerState.json.messages.some(message => message.channel === 'Email'), 'Manager state should include email history.');
    const normalizeBefore = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const ownerNormalizeSave = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: normalizeBefore.json });
    assert(ownerNormalizeSave.status === 200 && ownerNormalizeSave.json.ok && Array.isArray(ownerNormalizeSave.json.changes), 'Owner state save should return changed status and changes array.');
    const noopBefore = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const noopBeforeAuditCount = (noopBefore.json.auditLogs || []).filter(row => row.action === 'Platform state saved').length;
    const ownerNoopSave = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: noopBefore.json });
    assert(ownerNoopSave.status === 200 && ownerNoopSave.json.ok && ownerNoopSave.json.changed === false && Array.isArray(ownerNoopSave.json.changes), 'Stable no-op owner state save should return changed=false and changes array: ' + JSON.stringify(ownerNoopSave.json));
    const noopAfter = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const noopAfterAuditCount = (noopAfter.json.auditLogs || []).filter(row => row.action === 'Platform state saved').length;
    assert(noopAfterAuditCount === noopBeforeAuditCount, 'No-op state save should not add a noisy Platform state saved audit row.');

    const mechanicState = await request(server, 'GET', '/api/state', { cookie: mechanicCookie });
    assert(mechanicState.status === 200 && mechanicState.json, 'Mechanic state should load.');
    assert(!Object.prototype.hasOwnProperty.call(mechanicState.json, 'messages'), 'Mechanic state should not include messages.');
    assert(!Object.prototype.hasOwnProperty.call(mechanicState.json, 'payments'), 'Mechanic state should not include payments.');
    assert(!Object.prototype.hasOwnProperty.call(mechanicState.json, 'recurringPayments'), 'Mechanic state should not include recurring payments.');
    assert(!JSON.stringify(mechanicState.json.vehicles || []).includes('"price"') && !JSON.stringify(mechanicState.json.maintenance || []).includes('"cost"') && !JSON.stringify(mechanicState.json.claims || []).includes('"amount"'), 'Mechanic state should not expose vehicle, maintenance, or claim money fields.');
    assert(!/toll|ezpass|e-zpass|clover|dispute|chargeback|reimbursement|recovery/i.test(JSON.stringify(mechanicState.json.claims || [])), 'Mechanic state should not expose toll, Clover dispute, or recovery claim records.');
    const mechanicWriteState = JSON.parse(JSON.stringify(mechanicState.json));
    const mechanicVehicle = (mechanicWriteState.vehicles || []).find(vehicle => vehicle.currentCustomer);
    if (mechanicVehicle) {
      const oldCustomer = mechanicVehicle.currentCustomer;
      mechanicVehicle.currentCustomer = 'Mechanic Should Not Reassign';
      mechanicVehicle.price = 99999;
      mechanicVehicle.trackerStatus = 'Mechanic smoke checked';
      const mechanicSave = await request(server, 'PUT', '/api/state', { cookie: mechanicCookie, json: mechanicWriteState });
      assert(mechanicSave.status === 200 && mechanicSave.json.ok && mechanicSave.json.changed === true && mechanicSave.json.changes.some(row => /vehicles updated/i.test(row)), 'Mechanic should be able to save service-safe state updates and receive changed section details.');
      const ownerAfterMechanicSave = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
      const savedMechanicVehicle = (ownerAfterMechanicSave.json.vehicles || []).find(vehicle => vehicle.id === mechanicVehicle.id);
      assert(savedMechanicVehicle && savedMechanicVehicle.currentCustomer === oldCustomer && savedMechanicVehicle.price !== 99999 && savedMechanicVehicle.trackerStatus === 'Mechanic smoke checked', 'Mechanic vehicle save should preserve customer assignment and money fields while allowing service-safe fields.');
    }

    const status = await request(server, 'GET', '/api/messages/status', { cookie: managerCookie });
    assert(status.status === 200 && status.json.messaging.emailWebhookUrl, 'Messaging status should expose email webhook.');

    const revocableStaff = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-revocable-staff',
        name: 'Direct Revocable Staff',
        username: 'direct-revocable-staff',
        password: 'DirectRevocable123!',
        role: 'Manager',
        organizationId: 'org-wheelsonauto',
        status: 'Active'
      }
    });
    assert(revocableStaff.status === 200 && revocableStaff.json.ok, 'Owner could not create the staff session-revocation test account.');
    const revocableCookie = await login(server, { username: 'direct-revocable-staff', password: 'DirectRevocable123!' });
    const revocableBeforeRemoval = await request(server, 'GET', '/api/state', { cookie: revocableCookie });
    assert(revocableBeforeRemoval.status === 200, 'Active staff session should work before the account is removed.');
    const removedStaff = await request(server, 'POST', '/api/staff-accounts', {
      cookie: ownerCookie,
      json: {
        id: 'direct-revocable-staff',
        name: 'Direct Revocable Staff',
        username: 'direct-revocable-staff',
        role: 'Manager',
        organizationId: 'org-wheelsonauto',
        status: 'Removed'
      }
    });
    assert(removedStaff.status === 200 && removedStaff.json.ok, 'Owner could not remove the staff session-revocation test account.');
    const revokedStaffRead = await request(server, 'GET', '/api/state', { cookie: revocableCookie });
    assert(revokedStaffRead.status === 401 && revokedStaffRead.json && revokedStaffRead.json.error === 'Authentication required.', 'Removing a staff account must revoke its already-issued session immediately.');

    console.log('Direct server smoke passed: login, customer portal privacy/logout, company accounts, duplicate guards, dispute matching, state repair, public application, role filters, SMS/email messages, email notifications, autopay failure tracking, inbound email webhook, Star email approval, and staff permissions.');
  } finally {
    try { server.close(); } catch (_) {}
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
