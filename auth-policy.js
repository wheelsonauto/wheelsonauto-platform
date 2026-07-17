'use strict';

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

function ownerPasswordLoginStrong(options = {}) {
  const environment = options.environment || {};
  const state = options.state || {};
  const owner = state.security && state.security.ownerLogin || {};
  return strongPbkdf2PasswordRecord(environment.loginPasswordHash, environment.loginPasswordSalt)
    || strongPbkdf2PasswordRecord(owner.passwordHash, owner.passwordSalt);
}

function ownerPinFallbackAllowed(options = {}) {
  if (options.productionHardeningRequired) return false;
  return enabled(options.ownerPinFallbackEnabled, true);
}

function ownerAuthenticationReadiness(options = {}) {
  const passwordLoginConfigured = ownerPasswordLoginConfigured(options);
  const passwordLoginStrong = ownerPasswordLoginStrong(options);
  const pinFallbackAllowed = ownerPinFallbackAllowed(options);
  const missing = [];
  if (!passwordLoginConfigured) missing.push('owner username/password login');
  else if (!passwordLoginStrong) missing.push('PBKDF2 owner password record');
  if (pinFallbackAllowed) missing.push('owner PIN fallback disabled');
  return {
    passwordLoginConfigured,
    passwordLoginStrong,
    pinFallbackAllowed,
    readyForProduction: missing.length === 0,
    missing
  };
}

module.exports = {
  ownerPasswordLoginConfigured,
  ownerPasswordLoginStrong,
  ownerPinFallbackAllowed,
  ownerAuthenticationReadiness,
  strongPbkdf2PasswordRecord
};
