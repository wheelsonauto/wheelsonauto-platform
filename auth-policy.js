'use strict';

const crypto = require('node:crypto');

function hasText(value) {
  return !!String(value || '').trim();
}

function enabled(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return value === true || String(value).trim().toLowerCase() === 'true' || String(value).trim() === '1';
}

function ownerPasswordLoginConfigured(options = {}) {
  const environment = options.environment || {};
  const state = options.state || {};
  const owner = state.security && state.security.ownerLogin || {};
  return hasText(environment.loginPassword) || hasText(environment.loginPasswordHash) || hasText(owner.passwordHash);
}

function strongPbkdf2PasswordRecord(passwordHash, passwordSalt) {
  const match = String(passwordHash || '').match(/^pbkdf2\$(\d+)\$([a-f0-9]{64})$/i);
  return !!(match && Number(match[1]) >= 100000 && hasText(passwordSalt));
}

function passwordRecordFingerprint(record = {}) {
  if (!strongPbkdf2PasswordRecord(record.passwordHash, record.passwordSalt)) return '';
  return crypto.createHash('sha256')
    .update([
      'wheelsonauto-owner-password-proof-v1',
      String(record.passwordHash || ''),
      String(record.passwordSalt || ''),
      String(record.passwordUpdatedAt || '')
    ].join('\u0000'))
    .digest('hex');
}

function effectiveStrongOwnerPasswordRecord(options = {}) {
  const environment = options.environment || {};
  const state = options.state || {};
  const owner = state.security && state.security.ownerLogin || {};
  if (strongPbkdf2PasswordRecord(environment.loginPasswordHash, environment.loginPasswordSalt)) {
    return {
      passwordHash: environment.loginPasswordHash,
      passwordSalt: environment.loginPasswordSalt,
      passwordUpdatedAt: environment.loginPasswordUpdatedAt || ''
    };
  }
  if (strongPbkdf2PasswordRecord(owner.passwordHash, owner.passwordSalt)) return owner;
  return {};
}

function ownerPasswordLoginStrong(options = {}) {
  return !!passwordRecordFingerprint(effectiveStrongOwnerPasswordRecord(options));
}

function ownerPasswordLoginVerified(options = {}) {
  const state = options.state || {};
  const owner = state.security && state.security.ownerLogin || {};
  const fingerprint = passwordRecordFingerprint(effectiveStrongOwnerPasswordRecord(options));
  return !!(fingerprint
    && hasText(owner.passwordLoginVerifiedAt)
    && hasText(owner.passwordLoginVerifiedFingerprint)
    && String(owner.passwordLoginVerifiedFingerprint) === fingerprint);
}

function ownerPinFallbackAllowed(options = {}) {
  if (options.productionHardeningRequired) return false;
  const state = options.state || {};
  const owner = state.security && state.security.ownerLogin || {};
  if (owner.pinFallbackDisabled === true || hasText(owner.pinFallbackDisabledAt)) return false;
  return enabled(options.ownerPinFallbackEnabled, true);
}

function ownerAuthenticationReadiness(options = {}) {
  const passwordLoginConfigured = ownerPasswordLoginConfigured(options);
  const passwordLoginStrong = ownerPasswordLoginStrong(options);
  const passwordLoginVerified = ownerPasswordLoginVerified(options);
  const pinFallbackAllowed = ownerPinFallbackAllowed(options);
  const missing = [];
  if (!passwordLoginConfigured) missing.push('owner username/password login');
  else if (!passwordLoginStrong) missing.push('PBKDF2 owner password record');
  else if (!passwordLoginVerified) missing.push('verified owner password sign-in');
  if (pinFallbackAllowed) missing.push('owner PIN fallback disabled');
  return {
    passwordLoginConfigured,
    passwordLoginStrong,
    passwordLoginVerified,
    passwordLoginVerifiedAt: passwordLoginVerified ? String(options.state && options.state.security && options.state.security.ownerLogin && options.state.security.ownerLogin.passwordLoginVerifiedAt || '') : '',
    pinFallbackAllowed,
    readyForProduction: missing.length === 0,
    missing
  };
}

module.exports = {
  ownerPasswordLoginConfigured,
  ownerPasswordLoginStrong,
  ownerPasswordLoginVerified,
  ownerPinFallbackAllowed,
  ownerAuthenticationReadiness,
  strongPbkdf2PasswordRecord,
  passwordRecordFingerprint
};
