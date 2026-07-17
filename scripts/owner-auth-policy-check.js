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

  const passwordOnly = authPolicy.ownerAuthenticationReadiness({
    environment: { loginPasswordHash: 'pbkdf2$310000$' + 'a'.repeat(64), loginPasswordSalt: 'password-only-salt' },
    ownerPinFallbackEnabled: false,
    productionHardeningRequired: false
  });
  assert.strictEqual(passwordOnly.readyForProduction, true, 'A password-backed owner login with the PIN fallback disabled must satisfy the auth launch gate.');

  const storedOwner = authPolicy.ownerAuthenticationReadiness({
    state: { security: { ownerLogin: { username: 'owner', passwordHash: 'pbkdf2$310000$' + 'b'.repeat(64), passwordSalt: 'stored-owner-salt' } } },
    ownerPinFallbackEnabled: true,
    productionHardeningRequired: true
  });
  assert.strictEqual(storedOwner.passwordLoginConfigured, true, 'A password set in the protected owner account record must count for production.');
  assert.strictEqual(storedOwner.passwordLoginStrong, true, 'A current PBKDF2 owner password record must satisfy the production strength gate.');
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
  assert.strictEqual(Object.prototype.hasOwnProperty.call(storedOwner, 'passwordHash'), false, 'Auth readiness must only expose booleans, never credentials.');

  console.log('Owner authentication policy check passed: production requires password-backed owner access and disables PIN fallback.');
}

main();
