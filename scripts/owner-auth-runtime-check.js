'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const accountRecovery = require('../account-recovery');

class MockRequest extends Readable {
  constructor(method, url, headers = {}, body = '') {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.body = Buffer.from(body);
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
    this.body = '';
    this.resolve = resolve;
  }
  writeHead(status, headers = {}) { this.statusCode = status; this.headers = { ...this.headers, ...headers }; }
  setHeader(name, value) { this.headers[name] = value; }
  end(body = '') { this.body += String(body || ''); this.resolve({ status: this.statusCode, headers: this.headers, text: this.body, location: this.headers.Location || this.headers.location || '' }); }
}

function rawRequest(server, method, route, body = '', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = new MockRequest(method, route, { 'content-length': String(Buffer.byteLength(body)), ...headers }, body);
    const res = new MockResponse(resolve);
    try { server.emit('request', req, res); } catch (error) { reject(error); }
  });
}

function request(server, method, route, form = null, headers = {}) {
  const body = form ? new URLSearchParams(form).toString() : '';
  return rawRequest(server, method, route, body, { 'content-type': form ? 'application/x-www-form-urlencoded' : '', ...headers });
}

function requestJson(server, method, route, payload, headers = {}) {
  return rawRequest(server, method, route, JSON.stringify(payload || {}), { 'content-type': 'application/json', ...headers });
}

function loadServer() {
  delete require.cache[require.resolve('../server.js')];
  return require('../server.js').server;
}

function cookieHeader(response) {
  return String(response.headers['Set-Cookie'] || response.headers['set-cookie'] || '').split(';')[0];
}

async function main() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-owner-auth-runtime-'));
  try {
    const environmentPassword = 'EnvironmentOwnerPassword123!';
    const salt = 'owner-auth-runtime-environment-salt';
    process.env.DATA_DIR = dataDir;
    process.env.WOA_ADMIN_PIN = 'LegacyPinPassword123!';
    process.env.WOA_ADMIN_USERNAME = 'owner';
    process.env.WOA_ADMIN_PASSWORD_HASH = 'pbkdf2$310000$' + crypto.pbkdf2Sync(environmentPassword, salt, 310000, 32, 'sha256').toString('hex');
    process.env.WOA_ADMIN_PASSWORD_SALT = salt;
    process.env.WOA_SESSION_SECRET = 'owner-cutover-runtime-session-secret';
    process.env.WOA_PRODUCTION_HARDENING_REQUIRED = '1';
    process.env.WOA_OWNER_PIN_FALLBACK_ENABLED = '1';
    process.env.WOA_STAFF_PIN_LOGIN_ENABLED = '1';
    process.env.WOA_AUTO_SYNC_MS = '3600000';
    process.env.WOA_AUTOPAY_MS = '3600000';
    process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';

    const server = loadServer();
    try {
      const page = await request(server, 'GET', '/login');
      assert.strictEqual(page.status, 200);
      assert(!page.text.includes('Access PIN'), 'PIN login must be absent even when old PIN environment flags remain set.');
      assert(page.text.includes('name="username" autocomplete="username" required'), 'The username field must be browser-required.');
      assert(page.text.includes('name="password" type="password" autocomplete="current-password" required'), 'The password field must be browser-required.');

      const blankUsername = await request(server, 'POST', '/login', { username: '', password: environmentPassword });
      assert.strictEqual(blankUsername.status, 400, 'A correct password must never authenticate without a username.');
      const wrongUsername = await request(server, 'POST', '/login', { username: 'someone-else', password: environmentPassword });
      assert.strictEqual(wrongUsername.status, 401, 'A correct password must never authenticate a different username.');
      const pinOnly = await request(server, 'POST', '/login', { username: 'owner', pin: process.env.WOA_ADMIN_PIN });
      assert.strictEqual(pinOnly.status, 400, 'PIN-only owner login must be permanently removed.');
      const pinAsPassword = await request(server, 'POST', '/login', { username: 'owner', password: process.env.WOA_ADMIN_PIN });
      assert.strictEqual(pinAsPassword.status, 401, 'The old PIN must not work through the password field.');

      const environmentLogin = await request(server, 'POST', '/login', { username: 'owner', password: environmentPassword });
      assert.strictEqual(environmentLogin.status, 302, 'The exact owner username and strong environment password must still allow credential setup.');
      const environmentSession = cookieHeader(environmentLogin);

      const storedPassword = 'StoredOwnerPassword456!';
      const passwordUpdate = await requestJson(server, 'POST', '/api/account/password', {
        username: 'secure-owner',
        currentPassword: environmentPassword,
        newPassword: storedPassword
      }, { cookie: environmentSession });
      assert.strictEqual(passwordUpdate.status, 200, 'The owner must be able to replace environment bootstrap credentials with a stored username/password.');

      const storedState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      assert.strictEqual(storedState.security.ownerLogin.username, 'secure-owner');
      assert.strictEqual(storedState.security.ownerLogin.pinFallbackDisabled, true, 'Saving owner credentials must make password-only access permanent.');
      assert(!JSON.stringify(storedState).includes(storedPassword), 'Plain passwords must never be stored.');

      const missingStoredUsername = await request(server, 'POST', '/login', { password: storedPassword });
      assert.strictEqual(missingStoredUsername.status, 400, 'Stored owner passwords must require the username field.');
      const oldEnvironmentLogin = await request(server, 'POST', '/login', { username: 'owner', password: environmentPassword });
      assert.strictEqual(oldEnvironmentLogin.status, 401, 'Creating the stored owner credential must retire the environment bootstrap credential.');
      const guessedOwner = await request(server, 'POST', '/login', { username: 'owner', password: storedPassword });
      assert.strictEqual(guessedOwner.status, 401, 'The server must not infer or substitute the new owner username.');
      const storedLogin = await request(server, 'POST', '/login', { username: 'secure-owner', password: storedPassword });
      assert.strictEqual(storedLogin.status, 302, 'The exact stored username/password pair must authenticate.');

      const originalProxyChain = { 'x-forwarded-for': '198.51.100.44, 10.0.0.11' };
      const recoveryProxyChain = { 'x-forwarded-for': '198.51.100.44, 10.0.0.12' };
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const failed = await request(server, 'POST', '/login', { username: 'secure-owner', password: 'WrongPassword' + attempt + '!' }, originalProxyChain);
        assert.strictEqual(failed.status, 401, 'Attempts one through four must fail without authenticating.');
      }
      const fifthFailure = await request(server, 'POST', '/login', { username: 'secure-owner', password: 'WrongPassword5!' }, originalProxyChain);
      assert.strictEqual(fifthFailure.status, 303, 'The fifth failed attempt must send the account to recovery.');
      assert(fifthFailure.location.startsWith('/forgot?locked=1&username='), 'The lock response must lead to the account recovery page.');
      const correctWhileLocked = await request(server, 'POST', '/login', { username: 'secure-owner', password: storedPassword });
      assert.strictEqual(correctWhileLocked.status, 303, 'A locked account must require recovery even when the old password is later entered correctly.');

      const lockedState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      assert.strictEqual(lockedState.security.ownerLogin.loginSecurity.failedAttempts, 5);
      assert.strictEqual(lockedState.security.ownerLogin.loginSecurity.recoveryRequired, true);

      const challenge = accountRecovery.createRecoveryChallenge({
        secret: process.env.WOA_SESSION_SECRET,
        accountId: 'staff:owner:owner',
        code: '483920'
      });
      challenge.record.requestId = 'owner-recovery-request-483920';
      lockedState.security.ownerLogin.loginSecurity.passwordRecovery = challenge.record;
      await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(lockedState, null, 2));

      const staffCodeScreen = await request(server, 'GET', '/forgot/code?username=secure-owner&request=owner-recovery-request-483920');
      assert.strictEqual(staffCodeScreen.status, 200, 'A valid staff recovery request must open the six-digit code screen.');
      assert(staffCodeScreen.text.includes('name="code"') && staffCodeScreen.text.includes('name="requestId" value="owner-recovery-request-483920"'), 'The staff code screen must retain its opaque account-bound request.');
      const wrongStaffCodeScreen = await request(server, 'GET', '/forgot/code?username=secure-owner&request=wrong-request');
      assert.strictEqual(wrongStaffCodeScreen.status, 410, 'A guessed staff recovery request must not open the reset form.');

      const wrongRecoveryUsername = await request(server, 'POST', '/forgot/verify', {
        username: 'someone-else',
        code: '483920',
        newPassword: 'RecoveredOwnerPassword789!',
        confirmPassword: 'RecoveredOwnerPassword789!'
      });
      assert.strictEqual(wrongRecoveryUsername.status, 400, 'A recovery code must not reset any other username.');

      const recoveredPassword = process.env.WOA_ADMIN_PIN;
      const recoveryResult = await request(server, 'POST', '/forgot/verify', {
        username: 'secure-owner',
        requestId: 'owner-recovery-request-483920',
        code: '483920',
        newPassword: recoveredPassword,
        confirmPassword: recoveredPassword
      }, recoveryProxyChain);
      assert.strictEqual(recoveryResult.status, 200, 'The exact one-time code must reset only its bound owner account.');
      assert(recoveryResult.text.includes('Password reset complete'));

      const oldPasswordAfterRecovery = await request(server, 'POST', '/login', { username: 'secure-owner', password: storedPassword });
      assert.strictEqual(oldPasswordAfterRecovery.status, 401, 'Recovery must revoke the previous password.');
      const recoveredLogin = await request(server, 'POST', '/login', { username: 'secure-owner', password: recoveredPassword }, originalProxyChain);
      assert.strictEqual(recoveredLogin.status, 302, 'Recovery must require a fresh login with the exact username and new password, even when the chosen password matches the retired PIN value.');
      assert(!recoveredLogin.location.startsWith('/forgot'), 'A changing internal proxy hop must not leave the recovered account trapped behind the old rate-limit key.');

      const finalState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      assert(!finalState.security.ownerLogin.loginSecurity, 'Successful recovery must clear the lock and one-time challenge: ' + JSON.stringify(finalState.security.ownerLogin.loginSecurity));
      assert(!JSON.stringify(finalState).includes('483920'), 'The recovery code must never appear in saved state.');

      const recoveredOwnerSession = cookieHeader(recoveredLogin);
      const firstCustomerPassword = 'FirstCustomerPassword123!';
      const secondCustomerPassword = 'SecondCustomerPassword123!';
      const firstCustomer = await requestJson(server, 'POST', '/api/customer-accounts', {
        id: 'recovery-customer-one',
        name: 'Recovery Customer One',
        customer: 'Recovery Customer One',
        username: 'recovery-customer-one',
        email: 'recovery-one@example.com',
        password: firstCustomerPassword,
        status: 'Active'
      }, { cookie: recoveredOwnerSession });
      const secondCustomer = await requestJson(server, 'POST', '/api/customer-accounts', {
        id: 'recovery-customer-two',
        name: 'Recovery Customer Two',
        customer: 'Recovery Customer Two',
        username: 'recovery-customer-two',
        email: 'recovery-two@example.com',
        password: secondCustomerPassword,
        status: 'Active'
      }, { cookie: recoveredOwnerSession });
      const ownerDisabledCustomer = await requestJson(server, 'POST', '/api/customer-accounts', {
        id: 'owner-disabled-customer',
        name: 'Owner Disabled Customer',
        customer: 'Owner Disabled Customer',
        username: 'owner-disabled-customer',
        email: 'owner-disabled@example.com',
        password: 'OwnerDisabledPassword123!',
        status: 'Active'
      }, { cookie: recoveredOwnerSession });
      assert.strictEqual(firstCustomer.status, 200, 'The first customer recovery fixture must be created.');
      assert.strictEqual(secondCustomer.status, 200, 'The second customer recovery fixture must be created.');
      assert.strictEqual(ownerDisabledCustomer.status, 200, 'The explicitly disabled customer fixture must be created.');

      const draftDuplicateState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      draftDuplicateState.customerAccounts.push({
        id: 'recovery-customer-one-old-draft',
        name: 'Recovery Customer One',
        customer: 'Recovery Customer One',
        username: 'old-draft-recovery-one',
        email: 'recovery-one@example.com',
        status: 'Active',
        source: 'Old application draft without a password'
      });
      const firstCustomerBeforeApplicationClose = draftDuplicateState.customerAccounts.find(account => account.id === 'recovery-customer-one');
      Object.assign(firstCustomerBeforeApplicationClose, {
        status: 'Disabled',
        portalStage: 'Application denied',
        applicationId: 'application-recovery-customer-one',
        disabledAt: new Date().toISOString(),
        disabledBy: 'Application review test'
      });
      const ownerDisabledCustomerRecord = draftDuplicateState.customerAccounts.find(account => account.id === 'owner-disabled-customer');
      Object.assign(ownerDisabledCustomerRecord, { status: 'Disabled', portalStage: 'Disabled by owner' });
      await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(draftDuplicateState, null, 2));
      const loginBesideOldDraft = await request(server, 'POST', '/customer/login', { username: 'recovery-one@example.com', password: firstCustomerPassword });
      assert.strictEqual(loginBesideOldDraft.status, 302, 'One password-ready customer account disabled only by an old application must be restored when its exact password works beside a passwordless draft.');
      const restoredApplicationAccountState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      const restoredApplicationAccount = restoredApplicationAccountState.customerAccounts.find(account => account.id === 'recovery-customer-one');
      assert.strictEqual(restoredApplicationAccount.status, 'Active', 'Closing one application must not permanently disable the reusable customer account.');
      assert.strictEqual(restoredApplicationAccount.portalStage, 'Choose a vehicle', 'A restored customer account must return to the reusable vehicle selection stage.');
      const ownerDisabledLogin = await request(server, 'POST', '/customer/login', { username: 'owner-disabled-customer', password: 'OwnerDisabledPassword123!' });
      assert.strictEqual(ownerDisabledLogin.status, 401, 'A deliberately owner-disabled customer account must never auto-reactivate from a correct password.');

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const failed = await request(server, 'POST', '/customer/login', { username: 'recovery-customer-one', password: 'WrongCustomerPassword' + attempt + '!' });
        assert.strictEqual(failed.status, 401, 'Customer attempts one through four must fail without authenticating.');
      }
      const customerFifthFailure = await request(server, 'POST', '/customer/login', { username: 'recovery-customer-one', password: 'WrongCustomerPassword5!' });
      assert.strictEqual(customerFifthFailure.status, 303, 'The fifth customer failure must lead to customer recovery.');
      assert(customerFifthFailure.location.startsWith('/customer/forgot?locked=1&username='));

      const customerLockedState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      const firstCustomerRecord = customerLockedState.customerAccounts.find(account => account.id === 'recovery-customer-one');
      const customerChallenge = accountRecovery.createRecoveryChallenge({
        secret: process.env.WOA_SESSION_SECRET,
        accountId: 'customer:customer:recovery-customer-one',
        code: '619274'
      });
      customerChallenge.record.requestId = 'customer-recovery-request-619274';
      firstCustomerRecord.loginSecurity.passwordRecovery = customerChallenge.record;
      Object.assign(firstCustomerRecord, {
        status: 'Disabled',
        portalStage: 'Application denied',
        disabledAt: new Date().toISOString(),
        disabledBy: 'Application review test'
      });
      await fs.writeFile(path.join(dataDir, 'data.json'), JSON.stringify(customerLockedState, null, 2));

      const customerCodeScreen = await request(server, 'GET', '/customer/forgot/code?username=recovery-customer-one&request=customer-recovery-request-619274');
      assert.strictEqual(customerCodeScreen.status, 200, 'A valid customer recovery request must open the six-digit code screen.');
      assert(customerCodeScreen.text.includes('name="code"') && customerCodeScreen.text.includes('name="requestId" value="customer-recovery-request-619274"'), 'The customer code screen must retain its opaque account-bound request.');
      const wrongCustomerCodeScreen = await request(server, 'GET', '/customer/forgot/code?username=recovery-customer-one&request=wrong-request');
      assert.strictEqual(wrongCustomerCodeScreen.status, 410, 'A guessed customer recovery request must not open the reset form.');

      const crossAccountRecovery = await request(server, 'POST', '/customer/forgot/verify', {
        username: 'recovery-customer-two',
        code: '619274',
        newPassword: 'WronglyChangedPassword123!',
        confirmPassword: 'WronglyChangedPassword123!'
      });
      assert.strictEqual(crossAccountRecovery.status, 400, 'A customer recovery code must never reset a different customer account.');
      const secondCustomerLogin = await request(server, 'POST', '/customer/login', { username: 'recovery-customer-two', password: secondCustomerPassword });
      assert.strictEqual(secondCustomerLogin.status, 302, 'The other customer password must remain unchanged after a cross-account recovery attempt.');

      const recoveredCustomerPassword = 'RecoveredCustomerPassword456!';
      const customerRecoveryResult = await request(server, 'POST', '/customer/forgot/verify', {
        username: 'recovery-customer-one',
        requestId: 'customer-recovery-request-619274',
        code: '619274',
        newPassword: recoveredCustomerPassword,
        confirmPassword: recoveredCustomerPassword
      });
      assert.strictEqual(customerRecoveryResult.status, 200, 'The customer code must reset only the exact bound customer account.');
      const firstCustomerOldPassword = await request(server, 'POST', '/customer/login', { username: 'recovery-customer-one', password: firstCustomerPassword });
      assert.strictEqual(firstCustomerOldPassword.status, 401, 'Customer recovery must revoke the previous password.');
      const firstCustomerRecoveredLogin = await request(server, 'POST', '/customer/login', { username: 'recovery-customer-one', password: recoveredCustomerPassword });
      assert.strictEqual(firstCustomerRecoveredLogin.status, 302, 'The recovered customer must sign in freshly with the exact username and new password.');

      const customerFinalState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      const customerFinalOne = customerFinalState.customerAccounts.find(account => account.id === 'recovery-customer-one');
      assert(!customerFinalOne.loginSecurity, 'Successful customer recovery must clear only that customer account lock and challenge.');
      assert.strictEqual(customerFinalOne.status, 'Active', 'Verified email recovery must reactivate an account disabled only by its closed application.');
      assert.strictEqual(customerFinalOne.portalStage, 'Choose a vehicle', 'Verified recovery must return the customer to the reusable portal instead of restoring the denied application.');
      assert(!JSON.stringify(customerFinalState).includes('619274'), 'The customer recovery code must never appear in saved state.');
    } finally {
      try { server.close(); } catch (_) {}
    }
    console.log('Owner and customer auth runtime check passed: exact username/password, no PIN path, five-attempt locks, one-account recovery binding, unchanged unrelated accounts, and fresh-login enforcement are active.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
