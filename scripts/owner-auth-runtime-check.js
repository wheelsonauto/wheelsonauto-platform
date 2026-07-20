'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

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

  writeHead(status, headers = {}) {
    this.statusCode = status;
    this.headers = { ...this.headers, ...headers };
  }

  setHeader(name, value) {
    this.headers[name] = value;
  }

  end(body = '') {
    this.body += String(body || '');
    this.resolve({ status: this.statusCode, headers: this.headers, text: this.body });
  }
}

function rawRequest(server, method, route, body = '', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = new MockRequest(method, route, {
      'content-length': String(Buffer.byteLength(body)),
      ...headers
    }, body);
    const res = new MockResponse(resolve);
    try {
      server.emit('request', req, res);
    } catch (error) {
      reject(error);
    }
  });
}

function request(server, method, route, form = null, headers = {}) {
  const body = form ? new URLSearchParams(form).toString() : '';
  return rawRequest(server, method, route, body, {
    'content-type': form ? 'application/x-www-form-urlencoded' : '',
    ...headers
  });
}

function requestJson(server, method, route, payload, headers = {}) {
  return rawRequest(server, method, route, JSON.stringify(payload || {}), {
    'content-type': 'application/json',
    ...headers
  });
}

function clearOwnerEnvironmentPassword() {
  delete process.env.WOA_ADMIN_PASSWORD;
  delete process.env.WOA_OWNER_PASSWORD;
  delete process.env.WOA_ADMIN_PASSWORD_HASH;
  delete process.env.WOA_OWNER_PASSWORD_HASH;
  delete process.env.WOA_ADMIN_PASSWORD_SALT;
  delete process.env.WOA_OWNER_PASSWORD_SALT;
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
    process.env.DATA_DIR = dataDir;
    process.env.WOA_ADMIN_PIN = '9999';
    process.env.WOA_ADMIN_USERNAME = 'owner';
    process.env.WOA_SESSION_SECRET = 'owner-cutover-runtime-session-secret';
    process.env.WOA_AUTO_SYNC_MS = '3600000';
    process.env.WOA_AUTOPAY_MS = '3600000';
    process.env.WOA_AUTO_SYNC_STARTUP_DELAY_MS = '3600000';

    // Phase one mirrors the live transition: use the temporary recovery PIN once,
    // create the durable owner password, and prove the old session is revoked.
    process.env.WOA_PRODUCTION_HARDENING_REQUIRED = '0';
    process.env.WOA_OWNER_PIN_FALLBACK_ENABLED = '1';
    clearOwnerEnvironmentPassword();
    let server = loadServer();
    try {
      const initialPage = await request(server, 'GET', '/login');
      assert(initialPage.text.includes('Access PIN'), 'The temporary recovery phase must expose the explicitly enabled owner PIN field.');

      const pinLogin = await request(server, 'POST', '/login', { username: 'owner', pin: '9999' });
      assert.strictEqual(pinLogin.status, 302, 'The explicitly enabled recovery PIN must allow the owner to begin the password cutover.');
      const oldSession = cookieHeader(pinLogin);
      assert(oldSession.includes('woa_session='), 'The temporary owner login must create a signed session.');

      const newPassword = 'StoredOwnerPassword123!';
      const passwordUpdate = await requestJson(server, 'POST', '/api/account/password', {
        username: 'owner',
        currentPassword: '9999',
        newPassword
      }, { cookie: oldSession });
      assert.strictEqual(passwordUpdate.status, 200, 'The authenticated owner must be able to store a strong password through Settings.');
      const updatePayload = JSON.parse(passwordUpdate.text);
      assert.strictEqual(updatePayload.reauthenticate, true, 'Changing the owner password must require a fresh login.');

      const staleSession = await request(server, 'GET', '/api/state', null, { cookie: oldSession });
      assert.strictEqual(staleSession.status, 401, 'Saving a new owner password must immediately revoke the older PIN-backed session.');

      const savedState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      const ownerRecord = savedState.security && savedState.security.ownerLogin || {};
      assert.strictEqual(ownerRecord.username, 'owner', 'The owner username must persist with the password record.');
      assert(/^pbkdf2\$310000\$[a-f0-9]{64}$/i.test(String(ownerRecord.passwordHash || '')), 'The owner password must persist only as the current PBKDF2 record.');
      assert(ownerRecord.passwordSalt && ownerRecord.passwordUpdatedAt, 'The stored owner password needs a salt and revocation timestamp.');
      assert(!JSON.stringify(savedState).includes(newPassword), 'The plain owner password must never be written to state.');

      const verifiedLogin = await request(server, 'POST', '/login', { username: 'owner', password: newPassword });
      assert.strictEqual(verifiedLogin.status, 302, 'The owner must prove the newly stored password through a real sign-in before PIN removal.');
      const verifiedSession = cookieHeader(verifiedLogin);
      const verifiedState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      const verifiedOwner = verifiedState.security && verifiedState.security.ownerLogin || {};
      assert(verifiedOwner.passwordLoginVerifiedAt, 'A successful owner password login must persist its verification time.');
      assert.strictEqual(verifiedOwner.passwordLoginVerifiedFingerprint, authFingerprint(verifiedOwner), 'The verification proof must belong to the exact active password version.');

      const verifiedApp = await request(server, 'GET', '/', null, { cookie: verifiedSession });
      assert.strictEqual(verifiedApp.status, 200, 'The verified password session must open the owner platform.');
      assert(verifiedApp.text.includes('"passwordLoginVerified":true') && verifiedApp.text.includes('"passwordSessionVerified":true'), 'The owner Account UI must receive only safe password-verification booleans.');
      assert(!verifiedApp.text.includes(verifiedOwner.passwordHash) && !verifiedApp.text.includes(verifiedOwner.passwordSalt) && !verifiedApp.text.includes(verifiedOwner.passwordLoginVerifiedFingerprint), 'The owner page must not expose password records or proof fingerprints while showing cutover readiness.');

      const unconfirmedDisable = await requestJson(server, 'POST', '/api/account/owner-access/disable-pin', {
        currentPassword: newPassword,
        confirmation: 'DISABLE',
        acknowledged: true
      }, { cookie: verifiedSession });
      assert.strictEqual(unconfirmedDisable.status, 400, 'PIN removal must require the exact explicit confirmation phrase.');

      const disablePin = await requestJson(server, 'POST', '/api/account/owner-access/disable-pin', {
        currentPassword: newPassword,
        confirmation: 'DISABLE PIN',
        acknowledged: true
      }, { cookie: verifiedSession });
      assert.strictEqual(disablePin.status, 200, 'A verified password session plus current-password confirmation must disable the PIN safely.');
      const disablePayload = JSON.parse(disablePin.text);
      assert.strictEqual(disablePayload.ownerAuthentication.readyForProduction, true, 'The verified password-only owner account must clear its authentication launch gate.');

      const passwordOnlyPage = await request(server, 'GET', '/login');
      assert(!passwordOnlyPage.text.includes('Access PIN'), 'State-backed PIN removal must immediately hide the PIN field without waiting for a deploy.');
      const rejectedDisabledPin = await request(server, 'POST', '/login', { username: 'owner', pin: '9999' });
      assert.strictEqual(rejectedDisabledPin.status, 401, 'State-backed PIN removal must immediately reject the old PIN.');
      const retainedPasswordSession = await request(server, 'GET', '/api/state', null, { cookie: verifiedSession });
      assert.strictEqual(retainedPasswordSession.status, 200, 'Disabling the PIN must preserve the already verified password session.');

      const passwordOnlyState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      assert(passwordOnlyState.security.ownerLogin.pinFallbackDisabledAt, 'The owner cutover must persist when and by whom PIN access was disabled.');
      assert.strictEqual(passwordOnlyState.security.ownerLogin.pinFallbackDisabled, true, 'The durable owner record must reject PIN fallback after restart.');

      const staleClientStateResponse = await request(server, 'GET', '/api/state', null, { cookie: verifiedSession });
      const staleClientState = JSON.parse(staleClientStateResponse.text);
      staleClientState.security.ownerLogin.pinFallbackDisabled = false;
      staleClientState.security.ownerLogin.pinFallbackDisabledAt = '';
      const staleClientSave = await requestJson(server, 'PUT', '/api/state', staleClientState, { cookie: verifiedSession });
      assert.strictEqual(staleClientSave.status, 200, 'Normal owner state saves must remain usable after the PIN cutover.');
      const protectedCutoverState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      assert.strictEqual(protectedCutoverState.security.ownerLogin.pinFallbackDisabled, true, 'A stale full-state save must not silently re-enable the recovery PIN.');
      assert(protectedCutoverState.security.ownerLogin.pinFallbackDisabledAt, 'A stale full-state save must preserve the owner PIN cutover audit time.');

      const changedPassword = 'ChangedStoredOwnerPassword456!';
      const passwordOnlyUpdate = await requestJson(server, 'POST', '/api/account/password', {
        username: 'secure-owner',
        currentPassword: newPassword,
        newPassword: changedPassword
      }, { cookie: verifiedSession });
      assert.strictEqual(passwordOnlyUpdate.status, 200, 'A password-only owner must be able to change username and password.');
      const changedOwnerState = JSON.parse(await fs.readFile(path.join(dataDir, 'data.json'), 'utf8'));
      assert.strictEqual(changedOwnerState.security.ownerLogin.username, 'secure-owner', 'Changing the owner login must persist the new username.');
      assert.strictEqual(changedOwnerState.security.ownerLogin.pinFallbackDisabled, true, 'Changing a password-only owner login must never re-enable PIN fallback.');
      assert(changedOwnerState.security.ownerLogin.pinFallbackDisabledAt, 'Changing the owner login must preserve the PIN cutover audit time.');
      const rejectedPinAfterPasswordChange = await request(server, 'POST', '/login', { username: 'secure-owner', pin: '9999' });
      assert.strictEqual(rejectedPinAfterPasswordChange.status, 401, 'The old PIN must remain rejected after an owner password change.');
      const changedPasswordLogin = await request(server, 'POST', '/login', { username: 'secure-owner', password: changedPassword });
      assert.strictEqual(changedPasswordLogin.status, 302, 'The changed owner username and password must authenticate successfully.');
    } finally {
      try { server.close(); } catch (_) {}
    }

    // Phase two simulates the next deploy with hardening enabled. The recovery
    // PIN must disappear and fail while the stored password remains usable.
    process.env.WOA_PRODUCTION_HARDENING_REQUIRED = '1';
    process.env.WOA_OWNER_PIN_FALLBACK_ENABLED = '0';
    clearOwnerEnvironmentPassword();
    server = loadServer();
    try {
      const hardenedPage = await request(server, 'GET', '/login');
      assert.strictEqual(hardenedPage.status, 200, 'The hardened stored-password login page must render.');
      assert(!hardenedPage.text.includes('Access PIN'), 'The hardened login page must hide the owner PIN field.');

      const rejectedPin = await request(server, 'POST', '/login', { username: 'owner', pin: '9999' });
      assert.strictEqual(rejectedPin.status, 401, 'The hardened restart must reject the old owner PIN.');

      const storedLogin = await request(server, 'POST', '/login', { username: 'secure-owner', password: 'ChangedStoredOwnerPassword456!' });
      assert.strictEqual(storedLogin.status, 302, 'The password stored through Settings must survive restart and remain usable after PIN removal.');
      const hardenedSession = cookieHeader(storedLogin);
      const sessionParts = hardenedSession.split('=')[1].split('.');
      const sessionPayload = JSON.parse(Buffer.from(sessionParts[2], 'base64url').toString('utf8'));
      assert.strictEqual(sessionPayload.authSource, 'owner_stored', 'The hardened owner session must identify the durable stored-password source.');

      const preflightResponse = await request(server, 'GET', '/api/system/infrastructure/preflight', null, { cookie: hardenedSession });
      assert.strictEqual(preflightResponse.status, 200, 'The authenticated owner must be able to inspect the hardened launch preflight.');
      const preflight = JSON.parse(preflightResponse.text);
      assert.strictEqual(preflight.ownerAuthentication.passwordLoginStrong, true, 'The stored PBKDF2 password must clear the owner password-strength gate.');
      assert.strictEqual(preflight.ownerAuthentication.pinFallbackAllowed, false, 'The hardened restart must clear the owner PIN-fallback gate.');

      const stateResponse = await request(server, 'GET', '/api/state', null, { cookie: hardenedSession });
      assert.strictEqual(stateResponse.status, 200, 'The stored-password owner session must retain normal platform access.');
      assert(!stateResponse.text.includes('passwordHash') && !stateResponse.text.includes('passwordSalt'), 'Owner password records must never leak through normal state reads.');
    } finally {
      try { server.close(); } catch (_) {}
    }

    // Retain coverage for deployments that use a PBKDF2 record in Render
    // instead of the in-app stored owner record.
    const environmentDir = path.join(dataDir, 'environment-password');
    await fs.mkdir(environmentDir, { recursive: true });
    process.env.DATA_DIR = environmentDir;
    process.env.WOA_PRODUCTION_HARDENING_REQUIRED = '1';
    process.env.WOA_ADMIN_PIN = '9999';
    process.env.WOA_ADMIN_USERNAME = 'owner';
    const password = 'OwnerPassword123!';
    const salt = 'runtime-owner-password-salt';
    process.env.WOA_ADMIN_PASSWORD_HASH = 'pbkdf2$310000$' + crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256').toString('hex');
    process.env.WOA_ADMIN_PASSWORD_SALT = salt;
    delete process.env.WOA_ADMIN_PASSWORD;
    server = loadServer();
    try {
      const page = await request(server, 'GET', '/login');
      assert.strictEqual(page.status, 200, 'The password-only production login page must render.');
      assert(!page.text.includes('Access PIN'), 'Production hardening must hide the owner PIN field.');

      const pinLogin = await request(server, 'POST', '/login', { pin: '9999' });
      assert.strictEqual(pinLogin.status, 401, 'Production hardening must reject owner PIN-only login.');

      const passwordLogin = await request(server, 'POST', '/login', { username: 'owner', password });
      assert.strictEqual(passwordLogin.status, 302, 'Production hardening must retain password-backed owner login.');
      const sessionCookie = String(passwordLogin.headers['Set-Cookie'] || '');
      assert(sessionCookie.includes('woa_session='), 'A production password login must create a signed owner session.');
      const sessionParts = sessionCookie.split(';')[0].split('=')[1].split('.');
      const sessionPayload = JSON.parse(Buffer.from(sessionParts[2], 'base64url').toString('utf8'));
      assert.strictEqual(sessionPayload.authSource, 'owner_environment_hash', 'Hardened owner sessions must remember the password-backed authentication source.');
      assert(String(sessionPayload.credentialVersion || '').length >= 24, 'Hardened owner sessions must carry a server-derived credential version for password-reset revocation.');
    } finally {
      try { server.close(); } catch (_) {}
    }
    console.log('Owner auth runtime check passed: Settings password cutover revokes the PIN session, survives restart, hides credentials, disables PIN fallback, and preserves stored or environment PBKDF2 login.');
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

function authFingerprint(owner) {
  return require('../auth-policy').passwordRecordFingerprint(owner);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
