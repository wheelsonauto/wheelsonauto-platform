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

function ownerPinFallbackAllowed(options = {}) {
  if (options.productionHardeningRequired) return false;
  return enabled(options.ownerPinFallbackEnabled, true);
}

function ownerAuthenticationReadiness(options = {}) {
  const passwordLoginConfigured = ownerPasswordLoginConfigured(options);
  const pinFallbackAllowed = ownerPinFallbackAllowed(options);
  const missing = [];
  if (!passwordLoginConfigured) missing.push('owner username/password login');
  if (pinFallbackAllowed) missing.push('owner PIN fallback disabled');
  return {
    passwordLoginConfigured,
    pinFallbackAllowed,
    readyForProduction: missing.length === 0,
    missing
  };
}

module.exports = {
  ownerPasswordLoginConfigured,
  ownerPinFallbackAllowed,
  ownerAuthenticationReadiness
};
