'use strict';

const assert = require('node:assert');
const authPolicy = require('../auth-policy');

function main() {
  const development = authPolicy.ownerAuthenticationReadiness({
    environment: { loginPassword: '', loginPasswordHash: '' },
    ownerPinFallbackEnabled: true,
    productionHardeningRequired: false
  });
  assert.strictEqual(development.passwordLoginConfigured, false, 'A PIN alone must not count as a production owner password login.');
  assert.strictEqual(development.pinFallbackAllowed, true, 'Development may retain an explicit owner PIN recovery fallback.');
  assert.strictEqual(development.readyForProduction, false, 'Production readiness must reject an owner PIN-only login.');

  const environmentPasswordRecord = { passwordHash: 'pbkdf2$310000$' + 'a'.repeat(64), passwordSalt: 'password-only-salt' };
  const passwordOnly = authPolicy.ownerAuthenticationReadiness({
    environment: { loginPasswordHash: environmentPasswordRecord.passwordHash, loginPasswordSalt: environmentPasswordRecord.passwordSalt },
    state: { security: { ownerLogin: { passwordLoginVerifiedAt: '2026-07-19T09:00:00.000Z', passwordLoginVerifiedFingerprint: authPolicy.passwordRecordFingerprint(environmentPasswordRecord) } } },
    ownerPinFallbackEnabled: false,
    productionHardeningRequired: false
  });
  assert.strictEqual(passwordOnly.readyForProduction, true, 'A verified password-backed owner login with the PIN fallback disabled must satisfy the auth launch gate.');

  const storedPasswordRecord = { username: 'owner', passwordHash: 'pbkdf2$310000$' + 'b'.repeat(64), passwordSalt: 'stored-owner-salt', passwordUpdatedAt: '2026-07-19T09:01:00.000Z' };
  const storedOwner = authPolicy.ownerAuthenticationReadiness({
    state: { security: { ownerLogin: { ...storedPasswordRecord, passwordLoginVerifiedAt: '2026-07-19T09:02:00.000Z', passwordLoginVerifiedFingerprint: authPolicy.passwordRecordFingerprint(storedPasswordRecord) } } },
    ownerPinFallbackEnabled: true,
    productionHardeningRequired: true
  });
  assert.strictEqual(storedOwner.passwordLoginConfigured, true, 'A password set in the protected owner account record must count for production.');
  assert.strictEqual(storedOwner.passwordLoginStrong, true, 'A current PBKDF2 owner password record must satisfy the production strength gate.');
  assert.strictEqual(storedOwner.passwordLoginVerified, true, 'The exact current owner password record must have a successful sign-in proof.');
  assert.strictEqual(storedOwner.pinFallbackAllowed, false, 'Production hardening must override any attempt to leave owner PIN fallback enabled.');
  assert.strictEqual(storedOwner.readyForProduction, true, 'Production hardening should accept the stored owner password path after PIN fallback is disabled.');

  const incomplete = authPolicy.ownerAuthenticationReadiness({
    state: { security: { ownerLogin: { username: 'owner' } } },
    productionHardeningRequired: true
  });
  assert.deepStrictEqual(incomplete.missing, ['owner username/password login'], 'The preflight must explain when no owner password login is configured.');
  const legacyPassword = authPolicy.ownerAuthenticationReadiness({
    environment: { loginPassword: 'legacy-environment-password' },
    ownerPinFallbackEnabled: false,
    productionHardeningRequired: true
  });
  assert.deepStrictEqual(legacyPassword.missing, ['PBKDF2 owner password record'], 'A plain environment password must remain a recovery path but cannot clear the production launch gate.');
  const unverifiedPassword = authPolicy.ownerAuthenticationReadiness({
    state: { security: { ownerLogin: storedPasswordRecord } },
    ownerPinFallbackEnabled: false,
    productionHardeningRequired: false
  });
  assert.deepStrictEqual(unverifiedPassword.missing, ['verified owner password sign-in'], 'A strong password must not clear the gate until the exact password version completes a sign-in.');
  const stateDisabledPin = authPolicy.ownerAuthenticationReadiness({
    state: { security: { ownerLogin: { ...storedPasswordRecord, passwordLoginVerifiedAt: '2026-07-19T09:02:00.000Z', passwordLoginVerifiedFingerprint: authPolicy.passwordRecordFingerprint(storedPasswordRecord), pinFallbackDisabledAt: '2026-07-19T09:03:00.000Z' } } },
    ownerPinFallbackEnabled: true,
    productionHardeningRequired: false
  });
  assert.strictEqual(stateDisabledPin.pinFallbackAllowed, false, 'A verified owner cutover must disable the PIN without waiting for a risky environment toggle.');
  assert.strictEqual(stateDisabledPin.readyForProduction, true, 'A verified password and state-backed PIN cutover must clear the owner auth gate.');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(storedOwner, 'passwordHash'), false, 'Auth readiness must only expose booleans, never credentials.');

  console.log('Owner authentication policy check passed: production requires an exact verified password sign-in before the PIN fallback can be disabled.');
}

main();
