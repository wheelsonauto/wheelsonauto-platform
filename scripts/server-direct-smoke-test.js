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
  delete require.cache[require.resolve('../server.js')];
  const { server } = require('../server.js');

  try {
    const loginPage = await request(server, 'GET', '/login');
    assert(loginPage.status === 200, 'Login page did not load.');
    assert(loginPage.text.includes('WheelsonAuto Portal'), 'Login page content is missing.');

    const ownerCookie = await login(server, { pin: adminPin });
    const ownerState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(ownerState.status === 200 && ownerState.json, 'Owner could not read state.');

    const duplicateState = JSON.parse(JSON.stringify(ownerState.json));
    duplicateState.vehicles = duplicateState.vehicles || [];
    duplicateState.vehicles.push(
      { id: 'veh-direct-duplicate', name: 'Direct Duplicate One', vin: 'DIRECTVIN001', plate: 'DIR-001', status: 'Ready' },
      { id: 'veh-direct-duplicate', name: 'Direct Duplicate Two', vin: 'DIRECTVIN002', plate: 'DIR-002', status: 'Ready' }
    );
    duplicateState.payments = duplicateState.payments || [];
    duplicateState.claims = duplicateState.claims || [];
    duplicateState.recurringPayments = duplicateState.recurringPayments || [];
    duplicateState.payments.unshift(
      { id: 'clover-payment-direct-dispute', cloverPaymentId: 'pay-direct-dispute', customer: 'Direct Dispute Customer', date: 'Today', method: 'Clover', amount: 199, status: 'Paid', source: 'Clover' },
      { id: 'clover-payment-direct-webhook-dispute', cloverPaymentId: 'pay-direct-webhook-dispute', customer: 'Direct Webhook Dispute Customer', date: 'Today', method: 'Clover', amount: 88, status: 'Paid', source: 'Clover' }
    );
    duplicateState.recurringPayments.unshift({ id: 'rec-direct-dispute-match', customer: 'Direct Recurring Dispute Customer', cloverCustomerId: 'direct-dispute-customer-id', phone: '3135550100', email: 'direct-dispute@example.com', vehicle: 'Direct Dispute Vehicle', amount: 111, status: 'Active' });
    duplicateState.claims.unshift(
      { id: 'claim-direct-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', externalId: 'pay-direct-dispute', amount: 199, status: 'Open' },
      { id: 'claim-direct-recurring-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', cloverCustomerId: 'direct-dispute-customer-id', amount: 111, status: 'Open' },
      { id: 'claim-direct-candidate-dispute', type: 'Clover dispute', source: 'Clover', customer: 'Unassigned', amount: 199, status: 'Open' },
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
    const unmatchedDispute = (duplicateRead.json.claims || []).find(claim => claim.id === 'claim-direct-unmatched-dispute');
    assert(unmatchedDispute && unmatchedDispute.customerMatchStatus === 'Needs payment/customer match', 'Unmatched Clover dispute should be clearly flagged for manual match.');
    const candidateDispute = (duplicateRead.json.claims || []).find(claim => claim.id === 'claim-direct-candidate-dispute');
    assert(candidateDispute && candidateDispute.customerMatchStatus === 'Needs payment/customer match', 'Amount-only Clover dispute should still require manual match.');
    assert((candidateDispute.matchCandidates || []).some(candidate => candidate.customer === 'Direct Dispute Customer'), 'Amount-only Clover dispute should surface possible customer/payment matches.');

    const webhookDispute = await request(server, 'POST', '/api/webhooks/clover', {
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

    const mechanicCookie = await login(server, { username: 'direct-mechanic', password: 'DirectMechanic123!' });
    const managerCookie = await login(server, { username: 'direct-manager', password: 'DirectManager123!' });
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

    const portalPrivacyState = JSON.parse(JSON.stringify(resetRequestState.json));
    portalPrivacyState.recurringPayments = portalPrivacyState.recurringPayments || [];
    let portalPrivacyRecurring = portalPrivacyState.recurringPayments.find(row => row.id === 'rec-001');
    if (!portalPrivacyRecurring) {
      portalPrivacyRecurring = { id: 'rec-001', customer: 'Alicia Brown', amount: 229, status: 'Active' };
      portalPrivacyState.recurringPayments.unshift(portalPrivacyRecurring);
    }
    Object.assign(portalPrivacyRecurring, {
      customer: 'Alicia Brown',
      cloverPaymentSource: 'secret-source-token',
      paymentToken: 'secret-payment-token',
      raw: { private: 'secret-raw-value' }
    });
    const portalPrivacyWrite = await request(server, 'PUT', '/api/state', { cookie: ownerCookie, json: portalPrivacyState });
    assert(portalPrivacyWrite.status === 200 && portalPrivacyWrite.json.ok, 'Owner could not seed customer portal privacy fields.');

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
    assert((customerPortalMessageRead.json.messages || []).some(message => message.source === 'WheelsonAuto Star AI' && message.aiSourceMessageId === savedPortalMessage.id), 'Customer portal message should create a Star draft for staff review.');
    assert((customerPortalMessageRead.json.messages || []).some(note => note.event === 'customer_message' && /Alicia Brown/.test(note.subject || '')), 'Customer portal message should notify the owner by email when notifications are configured.');

    const customerPortalState = await request(server, 'GET', '/api/customer/portal-state', { cookie: customerCookie });
    assert(customerPortalState.status === 200 && customerPortalState.json.ok, 'Customer portal API did not load.');
    assert(customerPortalState.json.portal.recurring.customer === 'Alicia Brown', 'Customer portal should link the assigned recurring payment.');
    assert(!JSON.stringify(customerPortalState.json).includes('Direct Dispute Customer'), 'Customer portal state should not expose another customer payment/dispute record.');
    assert(!customerPortal.text.includes('Direct Dispute Customer'), 'Customer portal page should not render another customer record.');
    assert(!JSON.stringify(customerPortalState.json).includes('passwordHash'), 'Customer portal state should not expose password secrets.');
    assert(!JSON.stringify(customerPortalState.json).includes('secret-source-token'), 'Customer portal state should not expose saved-card payment sources.');
    assert(!JSON.stringify(customerPortalState.json).includes('secret-payment-token'), 'Customer portal state should not expose payment tokens.');
    assert(!JSON.stringify(customerPortalState.json).includes('secret-raw-value'), 'Customer portal state should not expose raw provider payloads.');

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

    const notificationSettings = await request(server, 'POST', '/api/notifications/email/settings', {
      cookie: ownerCookie,
      json: { emailRecipients: ['notify@example.com'], emailEnabled: true }
    });
    assert(notificationSettings.status === 200 && notificationSettings.json.ok, 'Owner could not save email notification settings.');
    assert(notificationSettings.json.notifications.emailRecipients[0] === 'notify@example.com', 'Notification recipient did not save.');

    const defaultNotificationEvents = ['payment_failed', 'payment_not_found', 'application_submitted', 'maintenance_due', 'claim_dispute', 'daily_closeout', 'customer_password_reset', 'card_setup_completed', 'customer_message'];
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
    const closeoutNotification = await request(server, 'POST', '/api/notifications/daily-closeout', {
      cookie: ownerCookie,
      json: {}
    });
    assert([200, 202].includes(closeoutNotification.status) && closeoutNotification.json.ok, 'Daily closeout notification failed.');
    assert(closeoutNotification.json.message.event === 'daily_closeout', 'Daily closeout should save a daily_closeout notification message.');
    assert(closeoutNotification.json.summary && Object.prototype.hasOwnProperty.call(closeoutNotification.json.summary, 'collected'), 'Daily closeout should return a money summary.');
    const notificationState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(notificationState.json.messages.some(message => message.event === 'application_submitted' && message.customer === 'Direct Notified Applicant'), 'Application notification should be saved in Messages.');
    assert(notificationState.json.messages.some(message => message.event === 'daily_closeout'), 'Daily closeout notification should be saved in Messages.');

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
    const autopayRun = await request(server, 'POST', '/api/woa-autopay/run', { cookie: ownerCookie, json: {} });
    assert([200, 207].includes(autopayRun.status) && autopayRun.json.notFound === 1, 'Autopay payment-not-found path did not run.');
    const autopayRead = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert(autopayRead.json.messages.some(message => message.event === 'payment_not_found' && message.customer === 'Direct Missing Token'), 'Payment-not-found notification should be saved in Messages.');
    assert(autopayRead.json.messages.some(message => message.event === 'payment_failed' && message.customer === 'Direct Failed Once' && /1x failed/i.test(message.subject || '')), '1x failed payment notification should be saved in Messages.');
    assert(autopayRead.json.messages.some(message => message.event === 'payment_failed' && message.customer === 'Direct Failed Twice' && /2x failed/i.test(message.subject || '')), '2x failed payment notification should be saved in Messages.');
    assert(autopayRead.json.payments.some(payment => payment.customer === 'Direct Missing Token' && String(payment.status || '').includes('Payment not found')), 'Payment-not-found transaction should be saved.');
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

    const inboundEmail = await request(server, 'POST', '/api/webhooks/email', {
      headers: { 'x-woa-webhook-secret': '' },
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
    assert(String(starCardSetup.json.draft.body || '').includes('/setup-card/'), 'Star card setup reply should include a secure setup link.');
    assert(starCardSetup.json.plan.related.cardSetupRequestId, 'Star card setup should save the setup request ID.');
    const starCardState = await request(server, 'GET', '/api/state', { cookie: ownerCookie });
    assert((starCardState.json.cardSetupRequests || []).some(request => request.id === starCardSetup.json.plan.related.cardSetupRequestId && request.recurringPaymentId === 'direct-autopay-fail-once'), 'Star card setup request should attach to the existing autopay row.');
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

    const managerState = await request(server, 'GET', '/api/state', { cookie: managerCookie });
    assert(managerState.status === 200 && Array.isArray(managerState.json.messages), 'Manager should see message state.');
    assert(managerState.json.messages.some(message => message.channel === 'Email'), 'Manager state should include email history.');

    const mechanicState = await request(server, 'GET', '/api/state', { cookie: mechanicCookie });
    assert(mechanicState.status === 200 && mechanicState.json, 'Mechanic state should load.');
    assert(!Object.prototype.hasOwnProperty.call(mechanicState.json, 'messages'), 'Mechanic state should not include messages.');
    assert(!Object.prototype.hasOwnProperty.call(mechanicState.json, 'payments'), 'Mechanic state should not include payments.');
    assert(!Object.prototype.hasOwnProperty.call(mechanicState.json, 'recurringPayments'), 'Mechanic state should not include recurring payments.');

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
