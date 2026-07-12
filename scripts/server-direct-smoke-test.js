const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const adminPin = '1234';

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
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
  if (options.form) {
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
  process.env.PUBLIC_BASE_URL = 'https://wheelsonauto-platform.onrender.com';
  process.env.CLOVER_WEBHOOK_SECRET = 'direct-clover-secret';
  process.env.MESSAGING_WEBHOOK_SECRET = 'direct-message-secret';
  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');

  try {
    const loginPage = await request(server, 'GET', '/login');
    assert(loginPage.status === 200, 'Login page did not load.');
    assert(loginPage.text.includes('WheelsonAuto Portal'), 'Login page content is missing.');
    assert(loginPage.text.includes('Forgot password?') && loginPage.text.includes('/forgot'), 'Staff login should include owner-approved password help.');

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

    const ownerCookie = await login(server, { pin: adminPin });
    const tamperedOwnerCookie = ownerCookie.replace(/\.[^.]+$/, '.bad-signature');
    const tamperedOwnerRead = await request(server, 'GET', '/api/state', { cookie: tamperedOwnerCookie });
    assert(!tamperedOwnerRead.json && tamperedOwnerRead.text.includes('WheelsonAuto Portal'), 'Tampered staff session cookie should not authenticate API access.');
    const ownerState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(ownerState.status === 200 && ownerState.json, 'Owner could not read state.');

    const duplicateState = JSON.parse(JSON.stringify(ownerState.json));
    duplicateState.vehicles = duplicateState.vehicles || [];
    duplicateState.vehicles = duplicateState.vehicles.filter(vehicle => vehicle.id !== 'veh-signal-text-car');
    duplicateState.vehicles.push(
      { id: 'veh-direct-duplicate', name: 'Direct Duplicate One', vin: 'DIRECTVIN001', plate: 'DIR-001', status: 'Ready' },
      { id: 'veh-direct-duplicate', name: 'Direct Duplicate Two', vin: 'DIRECTVIN002', plate: 'DIR-002', status: 'Ready' },
      { id: 'veh-direct-autopay-file', year: 2026, make: 'Direct', model: 'Autopay File Car', vin: 'DIRECTAUTOPAYFILEVIN', plate: 'DIR-AUTO', tempTag: 'TMP-AUTO', tracker: 'TRK-AUTO', status: 'Ready' },
      { id: 'veh-direct-dispute-car', year: 2025, make: 'Direct', model: 'Dispute Car', vin: 'DIRECTDISPUTEVIN', plate: 'DIR-DSP', tempTag: 'TMP-DSP', tracker: 'TRK-DSP', currentCustomer: 'Direct Dispute Customer', status: 'Rented' },
      { id: 'veh-signal-text-car', year: 2024, make: 'Signal', model: 'Text Car', vin: 'SIGNALVIN123456789', plate: 'SIG-77', tempTag: 'TMP-SIG', tracker: 'TRK-SIG', currentCustomer: 'Signal Match Person', status: 'Rented' }
    );
    duplicateState.payments = duplicateState.payments || [];
    duplicateState.claims = duplicateState.claims || [];
    duplicateState.recurringPayments = duplicateState.recurringPayments || [];
    duplicateState.customerAccounts = duplicateState.customerAccounts || [];
    duplicateState.maintenance = duplicateState.maintenance || [];
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
      { id: 'pay-signal-alpha-983', cloverPaymentId: 'charge-signal-alpha-983', customer: 'Signal Match Person', date: 'Today', method: 'Clover', amount: 144, status: 'Paid', source: 'Clover', vehicleId: 'veh-signal-text-car', vehicle: '2024 Signal Text Car', vin: 'SIGNALVIN123456789', plate: 'SIG-77', tracker: 'TRK-SIG', phone: '3135550201', email: 'signal-match@example.com' },
      { id: 'clover-payment-direct-webhook-dispute', cloverPaymentId: 'pay-direct-webhook-dispute', customer: 'Direct Webhook Dispute Customer', date: 'Today', method: 'Clover', amount: 88, status: 'Paid', source: 'Clover' }
    );
    duplicateState.recurringPayments.unshift({ id: 'rec-direct-dispute-match', customer: 'Direct Recurring Dispute Customer', cloverCustomerId: 'direct-dispute-customer-id', phone: '3135550100', email: 'direct-dispute@example.com', vehicle: 'Direct Dispute Vehicle', amount: 111, status: 'Active' });
    duplicateState.recurringPayments.unshift({ id: 'rec-direct-draft-portal', customer: 'Direct Draft Portal Customer', phone: '3135550188', email: 'direct-draft-portal@example.com', vehicle: 'Direct Draft Portal Car', amount: 77, status: 'Active' });
    duplicateState.recurringPayments.unshift({ id: 'rec-direct-missing-portal-draft', customer: 'Direct Missing Portal Draft Customer', phone: '3135550189', email: 'direct-missing-portal@example.com', vehicle: 'Direct Missing Portal Draft Car', amount: 79, status: 'Active' });
    duplicateState.customerAccounts.unshift({ id: 'direct-draft-portal-login', name: 'Direct Draft Portal Customer', customer: 'Direct Draft Portal Customer', username: 'direct-draft-portal', phone: '3135550188', email: 'direct-draft-portal@example.com', status: 'Active', recurringPaymentId: 'rec-direct-draft-portal' });
    duplicateState.maintenance.unshift({ id: 'mnt-direct-autopay-file-open', vehicleId: 'veh-direct-autopay-file', vehicle: '2026 Direct Autopay File Car', vin: 'DIRECTAUTOPAYFILEVIN', plate: 'DIR-AUTO', tracker: 'TRK-AUTO', customer: 'Previous Direct Service Customer', type: 'Monthly inspection', issue: 'Open inspection should follow reassigned vehicle', due: '2026-07-20', status: 'Scheduled' });
    duplicateState.claims.unshift(
      { id: 'claim-direct-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', externalId: 'pay-direct-dispute', amount: 199, status: 'Open' },
      { id: 'claim-direct-recurring-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', cloverCustomerId: 'direct-dispute-customer-id', amount: 111, status: 'Open' },
      { id: 'claim-signal-text-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', amount: 321, status: 'Open', notes: 'Clover dispute note: Signal Match Person / VIN SIGNALVIN123456789 / tag SIG-77.' },
      { id: 'claim-direct-candidate-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', amount: 199, status: 'Open' },
      { id: 'claim-direct-toll-review', type: 'Toll', source: 'Manual toll import', provider: 'E-ZPass', customer: 'Unassigned', plate: 'DIR-TOLL', reference: 'TOLL-DIRECT-001', amount: 12.75, status: 'Open', customerMatchStatus: 'Needs payment/customer match' },
      { id: 'claim-direct-unmatched-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', externalId: 'missing-payment-id', amount: 55, status: 'Open' }
    );
    const duplicateWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: duplicateState });
    assert(duplicateWrite.status === 200 && duplicateWrite.json.ok, 'Owner state write failed.');
    const duplicateRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const duplicateRows = (duplicateRead.json.vehicles || []).filter(vehicle => String(vehicle.name || '').startsWith('Direct Duplicate'));
    assert(duplicateRows.length === 2, 'Duplicate ID repair should preserve both rows.');
    assert(new Set(duplicateRows.map(vehicle => vehicle.id)).size === 2, 'Duplicate ID repair should make unique vehicle IDs.');
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
    driftRepairState.maintenance.unshift({ id: 'mnt-direct-drift-repair', organizationId: 'org-wheelsonauto', vehicleId: 'veh-direct-drift-repair', vehicle: '2025 Direct Drift Repair', customer: 'Old Drift Customer', status: 'Scheduled', type: 'Inspection', issue: 'Should follow active assignment' });
    const driftRepairWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: driftRepairState });
    assert(driftRepairWrite.status === 200 && driftRepairWrite.json.ok, 'Owner could not save drift repair scenario.');
    const driftRepairRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const driftVehicle = (driftRepairRead.json.vehicles || []).find(row => row.id === 'veh-direct-drift-repair');
    const driftRecurring = (driftRepairRead.json.recurringPayments || []).find(row => row.id === 'rec-direct-drift-repair');
    const driftService = (driftRepairRead.json.maintenance || []).find(row => row.id === 'mnt-direct-drift-repair');
    assert(driftVehicle && driftVehicle.currentCustomer === 'New Drift Customer', 'Active autopay should repair stale vehicle current customer.');
    assert(driftRecurring && driftRecurring.vin === 'DIRECTDRIFTVIN' && driftRecurring.plate === 'DIR-DRIFT' && driftRecurring.tracker === 'TRK-DRIFT', 'Active autopay should inherit vehicle VIN/tag/tracker during truth repair.');
    assert(driftService && driftService.customer === 'New Drift Customer' && driftService.previousCustomer === 'Old Drift Customer' && driftService.vin === 'DIRECTDRIFTVIN', 'Open service should follow repaired active vehicle assignment.');
    const assignmentConflictState = JSON.parse(JSON.stringify(driftRepairRead.json));
    assignmentConflictState.vehicles.unshift({ id: 'veh-direct-assignment-conflict', organizationId: 'org-wheelsonauto', year: 2025, make: 'Direct', model: 'Conflict Car', vin: 'DIRECTCONFLICTVIN', plate: 'DIR-CNF', tracker: 'TRK-CNF', status: 'Rented' });
    assignmentConflictState.recurringPayments.unshift(
      { id: 'rec-direct-conflict-one', organizationId: 'org-wheelsonauto', customer: 'Direct Conflict One', vehicleId: 'veh-direct-assignment-conflict', amount: 111, status: 'Active', nextRun: '2026-07-24' },
      { id: 'rec-direct-conflict-two', organizationId: 'org-wheelsonauto', customer: 'Direct Conflict Two', vehicleId: 'veh-direct-assignment-conflict', amount: 112, status: 'Active', nextRun: '2026-07-24' }
    );
    const assignmentConflictWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: assignmentConflictState });
    assert(assignmentConflictWrite.status === 200 && assignmentConflictWrite.json.ok, 'Owner could not save assignment conflict scenario.');
    const assignmentConflictRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const conflictVehicle = (assignmentConflictRead.json.vehicles || []).find(row => row.id === 'veh-direct-assignment-conflict');
    assert(conflictVehicle && /Direct Conflict One/.test(conflictVehicle.assignmentConflict || '') && /Direct Conflict Two/.test(conflictVehicle.assignmentConflict || ''), 'Competing active autopays should mark the vehicle assignment conflict.');
    const conflictHealth = await request(server, 'GET', '/api/system/health', { cookie: ownerCookie });
    assert(conflictHealth.status === 200 && conflictHealth.json && Array.isArray(conflictHealth.json.issues), 'System health should return JSON after assignment conflict save. Got ' + conflictHealth.status + ': ' + String(conflictHealth.text || '').slice(0, 220));
    assert(conflictHealth.json.issues.some(row => row.key === 'vehicle_assignment_conflict' && row.count >= 1 && row.view === 'Operations' && row.tab === 'Assigned'), 'System health should flag vehicle assignment conflicts and route to Operations / Assigned.');
    const conflictReadiness = await request(server, 'POST', '/api/system/readiness', { cookie: ownerCookie });
    assert(conflictReadiness.json.truthChecks.some(row => row.key === 'vehicle_assignment_conflict' && row.count >= 1 && row.view === 'Operations' && row.tab === 'Assigned'), 'System readiness should flag vehicle assignment conflicts and route to Operations / Assigned.');
    const conflictReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: ownerCookie });
    assert(conflictReport.text.includes('Vehicle assignment conflicts') && conflictReport.text.includes('DIRECTCONFLICTVIN'), 'Deep report should include vehicle assignment conflict QA and fleet evidence.');

    const publicApplication = await request(server, 'POST', '/api/public/applications', {
      json: {
        id: 'direct-public-app',
        name: 'Direct Applicant',
        phone: '3135550111',
        email: 'direct-applicant@example.com',
        vehicleId: 'veh-001',
        vehicle: '2016 Ford Focus Hatch',
        income: 4500,
        down: 500
      }
    });
    assert(publicApplication.status === 201 && publicApplication.json.ok, 'Public application did not save.');

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
        dataScope: 'Isolated tenant',
        billingOwner: 'WheelsonAuto'
      }
    });
    assert(franchise.status === 200 && franchise.json.ok && franchise.json.organization.id === 'direct-franchise', 'Owner could not create company/franchise account.');
    assert(franchise.json.organization.dataScope === 'Shared owner account', 'Company/franchise should stay owner-managed until multi-tenant isolation is enabled.');

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
    const franchiseState = await request(server, 'GET', '/api/state', { cookie: franchiseManagerCookie });
    assert(franchiseState.status === 200 && franchiseState.json && Array.isArray(franchiseState.json.organizations), 'Franchise manager state did not load.');
    assert((franchiseState.json.organizations || []).length === 1 && franchiseState.json.organizations[0].id === 'direct-franchise', 'Franchise manager should only see their company account.');
    assert(!(franchiseState.json.vehicles || []).some(vehicle => vehicle.id === 'veh-001'), 'Franchise manager should not see main WheelsonAuto fleet records.');
    assert(!JSON.stringify(franchiseState.json).includes('Direct Dispute Customer'), 'Franchise manager should not see main customer/payment/dispute records.');

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
    const ownerReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: ownerCookie });
    assert(ownerReport.status === 200 && /attachment; filename="wheelsonauto-deep-report-/.test(ownerReport.headers['Content-Disposition'] || ownerReport.headers['content-disposition'] || ''), 'Owner deep report should download with a dated filename.');
    assert(ownerReport.text.includes('Transactions') && ownerReport.text.includes('Autopay roster') && ownerReport.text.includes('Verification inbox') && ownerReport.text.includes('Messages / communications') && ownerReport.text.includes('Star QA') && ownerReport.text.includes('Audit trail'), 'Owner deep report should include money, customer, verification, communication, Star QA, and audit sections.');
    assert(ownerReport.text.includes('Failed twice') && ownerReport.text.includes('Payment not found') && ownerReport.text.includes('Unmatched payments') && ownerReport.text.includes('Missing contact') && ownerReport.text.includes('Customer portal access'), 'Owner deep report should include operational Star QA truth rows.');
    assert(ownerReport.text.includes('Toll/violation recovery') && ownerReport.text.includes('need customer/vehicle/plate review before charge or message'), 'Owner deep report should include toll/violation recovery review rows.');
    assert(ownerReport.text.includes('API provider readiness') && ownerReport.text.includes('Provider needed'), 'Owner deep report should include API provider readiness rows before outside providers are live-tested.');
    assert(ownerReport.text.includes('Session signing secret') && ownerReport.text.includes('WOA_SESSION_SECRET'), 'Owner deep report should include the stable signed-session secret setup row.');
    assert(ownerReport.text.includes('login-ready customer portal account'), 'Owner deep report should treat draft customer portal records without passwords as unfinished access.');
    assert(ownerReport.text.includes('Possible match Direct Dispute Customer') && ownerReport.text.includes('DIRECTDISPUTEVIN') && ownerReport.text.includes('Tag DIR-DSP') && ownerReport.text.includes('Phone 3135550199') && ownerReport.text.includes('Email direct-dispute-customer@example.com'), 'Owner deep report should include possible dispute customer, vehicle, and contact evidence.');
    assert(ownerReport.text.includes('staff_password_reset') && ownerReport.text.includes('Staff login direct-manager'), 'Owner deep report should include safe staff reset/help communication rows.');
    ['DirectManager123!', 'DirectManager456!', 'DirectCustomer123!', 'DirectCustomer456!', 'passwordHash', 'passwordSalt', 'sourceToken', 'paymentSource'].forEach(secret => {
      assert(!ownerReport.text.includes(secret), 'Owner deep report should not expose secret material: ' + secret);
    });
    const ownerHealth = await request(server, 'GET', '/api/system/health', { cookie: ownerCookie });
    assert(ownerHealth.status === 200 && ownerHealth.json.summary && ownerHealth.json.star && Array.isArray(ownerHealth.json.issues), 'Owner system health should return summary, Star, and issue rows.');
    assert(ownerHealth.json.issues.some(row => row.key === 'unmatched_payments') && ownerHealth.json.issues.some(row => row.key === 'missing_vin') && ownerHealth.json.issues.some(row => row.key === 'dispute_match_review') && ownerHealth.json.issues.some(row => row.key === 'customer_portal_access'), 'Owner system health should include payment, dispute, portal, and fleet truth checks.');
    const tollHealth = ownerHealth.json.issues.find(row => row.key === 'toll_violation_recovery');
    assert(tollHealth && Number(tollHealth.count) > 0 && /Open tolls\/violations/.test(tollHealth.detail || ''), 'Owner system health should include toll/violation recovery with amount and review context.');
    const apiHealth = ownerHealth.json.issues.find(row => row.key === 'api_provider_readiness');
    assert(apiHealth && Number(apiHealth.count) >= 4 && /Provider dependency matrix/.test(apiHealth.detail || ''), 'Owner system health should include default API provider readiness before providers are live-tested.');
    const sessionSecretHealth = ownerHealth.json.issues.find(row => row.key === 'session_signing_secret');
    assert(sessionSecretHealth && sessionSecretHealth.tone === 'warn' && /WOA_SESSION_SECRET|WOA_COOKIE_SECRET/.test(sessionSecretHealth.detail || ''), 'Owner system health should flag missing stable session signing secret.');
    const portalHealth = ownerHealth.json.issues.find(row => row.key === 'customer_portal_access');
    assert(portalHealth && Number(portalHealth.count) > 0 && /login-ready/i.test(portalHealth.detail || ''), 'Owner system health should flag active customers whose portal record is not login ready.');
    const ownerReadiness = await request(server, 'POST', '/api/system/readiness', { cookie: ownerCookie });
    assert(ownerReadiness.status === 200 && Array.isArray(ownerReadiness.json.truthChecks) && Object.prototype.hasOwnProperty.call(ownerReadiness.json, 'dataOk'), 'System readiness should return customer/payment/fleet truth checks.');
    assert(ownerReadiness.json.truthChecks.some(row => row.key === 'unmatched_payments') && ownerReadiness.json.truthChecks.some(row => row.key === 'autopay_vehicle_link') && ownerReadiness.json.truthChecks.some(row => row.key === 'payment_request_truth') && ownerReadiness.json.truthChecks.some(row => row.key === 'open_payment_requests'), 'System readiness should include unmatched payment, payment-link, and autopay vehicle-link checks.');
    assert(ownerReadiness.json.truthChecks.some(row => row.key === 'toll_violation_recovery' && row.severity === 'critical'), 'System readiness should mark unmatched toll/violation recovery as critical before charge/message follow-up.');
    assert(ownerReadiness.json.truthChecks.some(row => row.key === 'api_provider_readiness' && row.severity === 'warning'), 'System readiness should include warning-level API provider readiness for future integrations.');
    assert(ownerReadiness.json.envChecks.some(row => row.key === 'WOA_SESSION_SECRET' && row.status === 'Missing'), 'System readiness should list missing WOA_SESSION_SECRET for stable signed cookies.');

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

    const publicApplyPage = await request(server, 'GET', '/apply');
    assert(publicApplyPage.status === 200 && publicApplyPage.text.includes('window.__PUBLIC_MODE__=true'), 'Public application page should render in public mode.');
    assert(publicApplyPage.text.includes('veh-001'), 'Public application page should include public ready fleet choices.');
    assert(!publicApplyPage.text.includes('secret-source-token') && !publicApplyPage.text.includes('secret-payment-token') && !publicApplyPage.text.includes('secret-raw-value'), 'Public application page should not expose private payment tokens.');
    assert(!publicApplyPage.text.includes('Direct Dispute Customer') && !publicApplyPage.text.includes('direct-customer'), 'Public application page should not expose customer, dispute, or portal login records.');

    const customerLoginRes = await request(server, 'POST', '/customer/login', { form: { username: 'direct-customer', password: 'DirectCustomer123!' } });
    assert(customerLoginRes.status === 302 && String(customerLoginRes.cookie).includes('woa_customer_session='), 'Customer login did not set a customer session.');
    assertSecureCookie(customerLoginRes.cookie, 'Customer login');
    const customerCookie = cleanCookie(customerLoginRes.cookie);

    const customerPortal = await request(server, 'GET', '/customer', { cookie: customerCookie });
    assert(customerPortal.status === 200 && customerPortal.text.includes('Alicia') && customerPortal.text.includes('Recent payments') && customerPortal.text.includes('/customer/message'), 'Customer portal did not render account details and message form.');
    assert(customerPortal.text.includes('Open payment requests') && customerPortal.text.includes('direct-customer-open-payment-link') && customerPortal.text.includes('Pay securely') && customerPortal.text.includes('days open'), 'Customer portal should show linked open payment requests with age.');
    assert(!customerPortal.text.includes('direct-customer-paid-payment-link') && !customerPortal.text.includes('Old paid link'), 'Customer portal should not show paid/closed payment requests in the open payment request panel.');
    assert(customerPortal.text.includes('/customer/paid-outside') && customerPortal.text.includes('Report payment'), 'Customer portal should include paid-outside-app reporting.');
    assert(customerPortal.text.includes('/customer/service-request') && customerPortal.text.includes('Send service request'), 'Customer portal should include a connected service request form.');
    assert(customerPortal.text.includes('/customer/issue-report') && customerPortal.text.includes('Report issue'), 'Customer portal should include toll/claim/issue reporting.');
    assert(customerPortal.text.includes('/customer/document-update') && customerPortal.text.includes('Send document / proof update'), 'Customer portal should include document/proof update intake.');
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
    assert(customerPaidOutside.status === 302 && customerPaidOutside.location === '/customer', 'Customer paid-outside report should return to the portal.');
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
    assert(customerServiceRequest.status === 302 && customerServiceRequest.location === '/customer', 'Customer service request should return to the customer portal.');
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
    assert(customerIssueRequest.status === 302 && customerIssueRequest.location === '/customer', 'Customer issue report should return to the customer portal.');
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
    assert(customerDocumentUpdate.status === 302 && customerDocumentUpdate.location === '/customer', 'Customer document update should return to the customer portal.');
    const customerDocumentState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const customerDocument = (customerDocumentState.json.documents || []).find(item => item.source === 'Customer portal' && item.customer === 'Alicia Brown' && item.reference === 'POLICY-PORTAL-SMOKE');
    assert(customerDocument && customerDocument.vehicleId === 'veh-003' && customerDocument.vin === '3LN6L2G91FR123456' && customerDocument.status === 'Needs verification' && customerDocument.requiresVerification === true && customerDocument.url === 'https://proof.example/insurance-photo', 'Customer document update should create a vehicle-linked verification document with proof URL: ' + JSON.stringify(customerDocument || null));
    assert((customerDocumentState.json.messages || []).some(message => message.documentId === customerDocument.id && message.customer === 'Alicia Brown' && message.status === 'Needs admin verification' && String(message.body || '').includes('Proof link/note: https://proof.example/insurance-photo')), 'Customer document update should be logged in Messages for staff verification.');
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
    assert(customerPortalMessage.status === 302 && customerPortalMessage.location === '/customer', 'Customer portal message should return to portal.');
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
    assert(!JSON.stringify(customerPortalState.json.portal.messages || []).includes('approvalRequired') && !JSON.stringify(customerPortalState.json.portal.messages || []).includes('customerAccountId'), 'Customer portal message history should not expose staff triage fields or internal account ids.');
    assert(!JSON.stringify(customerPortalState.json.portal.payments || []).includes('secret-clover-error') && !JSON.stringify(customerPortalState.json.portal.payments || []).includes('secret-clover-payment-id') && !JSON.stringify(customerPortalState.json.portal.payments || []).includes('secret-external-reference'), 'Customer portal payments should not expose Clover/internal error or reference fields.');
    assert((customerPortalState.json.portal.payments || []).some(payment => payment.id === 'direct-customer-private-payment-row' && /Please contact WheelsonAuto/.test(payment.notes || '')), 'Customer portal failed payments should show a clean customer-safe note.');

    const customerBlockedState = await request(server, 'GET', '/api/state', { cookie: customerCookie });
    assert(customerBlockedState.status === 200 && customerBlockedState.text.includes('WheelsonAuto Portal'), 'Customer session should not access staff/admin API state.');

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
      json: {
        id: 'direct-filtered-public-app',
        name: 'Direct Filtered Applicant',
        phone: '3135550333',
        email: 'direct-filtered@example.com',
        vehicleId: 'veh-002',
        vehicle: '2017 Ford Fusion',
        income: 5100,
        down: 600
      }
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
      json: {
        id: 'direct-notified-public-app',
        name: 'Direct Notified Applicant',
        phone: '3135550222',
        email: 'direct-notified@example.com',
        vehicleId: 'veh-002',
        vehicle: '2017 Ford Fusion',
        income: 5200,
        down: 700
      }
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
      { id: 'clover-payment-closeout-failed', cloverPaymentId: 'pay-closeout-failed', customer: 'Direct Closeout Customer', date: '2099-12-31', method: 'Debit Card', source: 'Clover', amount: 777, status: 'FAIL', notes: 'Declined' }
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
      snapshot: { expected: 1689, collected: 1401, stillOpen: 288, failedTwice: 0, openPaymentLinks: 1, openPaymentLinkAmount: 88, stalePaymentLinks: 1, stalePaymentLinkAmount: 44, openCardSetupLinks: 2, pendingStarApprovals: 3, vehicleAssignmentConflicts: 1 }
    });
    const closeoutDedupWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: closeoutDedupData });
    assert(closeoutDedupWrite.status === 200 && closeoutDedupWrite.json.ok, 'Owner could not seed closeout duplicate payment records.');
    const closeoutReconciledState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    const reconciledPaymentLink = (closeoutReconciledState.json.paymentRequests || []).find(row => row.id === 'plink-direct-closeout-already-paid');
    assert(reconciledPaymentLink && /paid/i.test(reconciledPaymentLink.status || '') && reconciledPaymentLink.matchedPaymentId === 'payment-direct-reconciled-link', 'Open hosted payment links should auto-close when a matching paid payment record exists.');
    const closeoutCandidateReport = await request(server, 'GET', '/api/reports/deep.csv', { cookie: ownerCookie });
    assert(closeoutCandidateReport.status === 200 && closeoutCandidateReport.text.includes('Possible match Direct Report Candidate') && closeoutCandidateReport.text.includes('DIRECTREPORTVIN') && closeoutCandidateReport.text.includes('Tag DIR-RPT'), 'Deep report should show possible customer/vehicle evidence for unmatched transaction rows.');
    const closeoutDedupNotification = await request(server, 'POST', '/api/notifications/daily-closeout', {
      cookie: ownerCookie,
      json: { dateKey: '2099-12-31' }
    });
    assert([200, 202].includes(closeoutDedupNotification.status) && closeoutDedupNotification.json.ok, 'Duplicate-safe daily closeout notification failed.');
    assert(closeoutDedupNotification.json.summary.collected === 1401, 'Daily closeout should dedupe duplicate Clover paid rows, count verified paid-outside payments, resolve external customer refs, and ignore failed rows.');
    assert(closeoutDedupNotification.json.summary.transactions === 5, 'Daily closeout should report unique transaction rows after dedupe.');
    assert(closeoutDedupNotification.json.summary.paidOutsideApp === 1 && closeoutDedupNotification.json.summary.paidOutsideAmount === 45, 'Daily closeout should break out paid-outside-app records separately.');
    assert(closeoutDedupNotification.json.summary.cloverCollected === 1356 && closeoutDedupNotification.json.summary.cloverTransactions === 3, 'Daily closeout should keep Clover collected totals separate from paid-outside-app records.');
    assert(closeoutDedupNotification.json.summary.openPaymentRequests >= 1 && closeoutDedupNotification.json.summary.openPaymentRequestAmount >= 88 && Object.prototype.hasOwnProperty.call(closeoutDedupNotification.json.summary, 'stalePaymentRequests') && closeoutDedupNotification.json.summary.paymentRequestRows.some(row => row.customer === 'Direct Closeout Payment Link' && row.vin === 'DIRECTREPORTVIN' && row.tag === 'DIR-RPT' && row.ageLabel), 'Daily closeout should expose open hosted checkout links with customer, VIN, tag, amount, and age.');
    assert(closeoutDedupNotification.json.summary.openCardSetupRequests >= 1 && Array.isArray(closeoutDedupNotification.json.summary.cardSetupRows) && closeoutDedupNotification.json.summary.cardSetupRows.some(row => row.customer === 'Alicia Brown'), 'Daily closeout should expose open card setup/change links with customer context.');
    assert(closeoutDedupNotification.json.summary.pendingStarApprovals >= 1 && Array.isArray(closeoutDedupNotification.json.summary.starApprovalRows) && closeoutDedupNotification.json.summary.starApprovalRows.some(row => row.customer === 'Alicia Brown'), 'Daily closeout should expose pending Star approval rows with customer context.');
    assert(closeoutDedupNotification.json.summary.pendingToday >= 1 && closeoutDedupNotification.json.summary.stillOpenAmount === Math.max(0, closeoutDedupNotification.json.summary.expected - closeoutDedupNotification.json.summary.collected), 'Daily closeout should expose due customer counts and still-open amount.');
    assert(closeoutDedupNotification.json.summary.peopleToContact === 2 && closeoutDedupNotification.json.summary.paidTransactions === 4, 'Daily closeout should expose contact and paid transaction counts.');
    assert(Array.isArray(closeoutDedupNotification.json.summary.contactRows) && closeoutDedupNotification.json.summary.contactRows.some(row => row.customer === 'Direct Closeout Failed Twice' && row.vin === 'DIRECTFAILED2VIN') && closeoutDedupNotification.json.summary.contactRows.some(row => row.customer === 'Direct Closeout Payment Missing' && row.tag === 'DIR-PNF'), 'Daily closeout should return structured contact rows with customer, VIN, and tag evidence.');
    assert(closeoutDedupNotification.json.summary.vehicleAssignmentConflicts >= 1, 'Daily closeout should expose vehicle assignment conflicts before owner signoff.');
    assert(closeoutDedupNotification.json.summary.signedOff === true && closeoutDedupNotification.json.summary.signedBy === 'Owner Smoke', 'Daily closeout should expose saved owner signoff metadata.');
    assert(closeoutDedupNotification.json.summary.signoffSnapshot && closeoutDedupNotification.json.summary.signoffSnapshot.collected === 1401, 'Daily closeout should carry the frozen signoff snapshot.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Owner signoff: Signed off by Owner Smoke') && String(closeoutDedupNotification.json.message.body || '').includes('Signed snapshot: expected $1,689') && String(closeoutDedupNotification.json.message.body || '').includes('open links 1 / $88') && String(closeoutDedupNotification.json.message.body || '').includes('stale links 1 / $44') && String(closeoutDedupNotification.json.message.body || '').includes('card setup links 2') && String(closeoutDedupNotification.json.message.body || '').includes('Star approvals 3'), 'Daily closeout message should include signoff status, snapshot numbers, payment links, card setup links, and Star approval counts.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Customer | $777') && String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Customer | $123'), 'Daily closeout should keep the customer name for deduped and externally referenced Clover transactions.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Paid outside app: 1 / $45'), 'Daily closeout body should show paid-outside-app totals.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Open payment requests:') && String(closeoutDedupNotification.json.message.body || '').includes('Stale payment links:') && String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Payment Link | $88 | Open | New link') && !String(closeoutDedupNotification.json.message.body || '').includes('Direct Closeout Paid Link'), 'Daily closeout body should list open hosted checkout link age and exclude paid links.');
    assert(String(closeoutDedupNotification.json.message.body || '').includes('Open card setup/change links:') && String(closeoutDedupNotification.json.message.body || '').includes('Pending Star approvals:'), 'Daily closeout body should list open card setup links and pending Star approvals.');
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
    });
    const autopayWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: autopayState });
    assert(autopayWrite.status === 200 && autopayWrite.json.ok, 'Autopay smoke setup failed.');
    const enrichedPaymentLink = await request(server, 'POST', '/api/payment-links', {
      cookie: ownerCookie,
      json: { recurringPaymentId: 'direct-autopay-fail-once' }
    });
    assert(enrichedPaymentLink.status === 201 && enrichedPaymentLink.json.ok, 'Owner payment-link creation failed.');
    assert(enrichedPaymentLink.json.paymentLink.customer === 'Direct Failed Once' && enrichedPaymentLink.json.paymentLink.vehicle === '2017 Ford Fusion' && enrichedPaymentLink.json.paymentLink.vin === 'DIRECTFAILEDONCE' && enrichedPaymentLink.json.paymentLink.amount === 77, 'Payment links should inherit customer, vehicle, VIN, and amount from the recurring row.');
    const autopayRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie: ownerCookie, json: {} });
    assert([200, 207].includes(autopayRun.status) && autopayRun.json.notFound === 1, 'Autopay payment-not-found path did not run.');
    const autopayRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(autopayRead.json.messages.some(message => message.event === 'payment_not_found' && message.customer === 'Direct Missing Token'), 'Payment-not-found notification should be saved in Messages.');
    assert(autopayRead.json.messages.some(message => message.event === 'payment_failed' && message.customer === 'Direct Failed Once' && /1x failed/i.test(message.subject || '')), '1x failed payment notification should be saved in Messages.');
    assert(autopayRead.json.messages.some(message => message.event === 'payment_failed' && message.customer === 'Direct Failed Twice' && /2x failed/i.test(message.subject || '')), '2x failed payment notification should be saved in Messages.');
    assert(autopayRead.json.payments.some(payment => payment.customer === 'Direct Missing Token' && String(payment.status || '').includes('Payment not found')), 'Payment-not-found transaction should be saved.');
    assert(autopayRead.json.payments.some(payment => payment.customer === 'Direct Failed Once' && String(payment.status || '').includes('1x failed') && payment.vin === 'DIRECTFAILEDONCE'), '1x failed autopay should save a named failed transaction with vehicle evidence.');
    assert(autopayRead.json.payments.some(payment => payment.customer === 'Direct Failed Twice' && String(payment.status || '').includes('2x failed') && payment.vin === 'DIRECTFAILEDTWICE'), '2x failed autopay should save a named failed transaction with vehicle evidence.');
    const failedTwiceRow = autopayRead.json.recurringPayments.find(row => row.id === 'direct-autopay-fail-twice');
    assert(failedTwiceRow && String(failedTwiceRow.status || '').includes('2x failed'), 'Second failed autopay should mark the customer as 2x failed.');

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

    const starCardSetup = await request(server, 'POST', '/api/messages/ai-reply', {
      cookie: managerCookie,
      json: { customer: 'Direct Failed Once', phone: '3135550444', channel: 'SMS', body: 'I need to update my card on file.' }
    });
    assert(starCardSetup.status === 201 && starCardSetup.json.ok, 'Star card setup draft failed.');
    assert(starCardSetup.json.plan.actionType === 'send_card_setup', 'Star should recognize card-on-file update requests.');
    assert(starCardSetup.json.plan.context && starCardSetup.json.plan.context.systemHealth && Array.isArray(starCardSetup.json.plan.context.systemHealth.nextActions), 'Star drafts should include compact system health context.');
    assert(String(starCardSetup.json.draft.body || '').includes('/setup-card/'), 'Star card setup reply should include a secure setup link.');
    assert(starCardSetup.json.plan.related.cardSetupRequestId, 'Star card setup should save the setup request ID.');
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
    const blockedStarChargeSend = await request(server, 'POST', '/api/messages/ai-action', {
      cookie: managerCookie,
      json: { draftId: starChargeDraft.json.draft.id, channel: 'SMS' }
    });
    assert(blockedStarChargeSend.status === 409 && /money or account change/i.test(blockedStarChargeSend.json.error || ''), 'Star should not approve/send money-action drafts without explicit admin workflow approval.');
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
    ['Autopay created', 'Staff account created', 'Staff account updated', 'Customer login created', 'Customer login updated', 'Company account created', 'API provider saved', 'Customer portal paid-outside reported', 'Customer portal service requested', 'Customer portal issue reported', 'Customer portal document submitted', 'Customer portal card setup link opened', 'Customer portal message received', 'Star AI reply drafted', 'Star AI approval drafted', 'Star AI reply approved'].forEach(action => {
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
