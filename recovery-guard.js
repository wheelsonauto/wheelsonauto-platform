'use strict';

function normalizedGeneration(value) {
  const generation = Number(value);
  return Number.isInteger(generation) && generation >= 0 ? generation : 0;
}

function recoveryWriteGenerationIsCurrent(metadata = {}, currentGeneration = 0) {
  if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, 'recoveryGeneration')) return true;
  return normalizedGeneration(metadata.recoveryGeneration) === normalizedGeneration(currentGeneration);
}

function assertCurrentRecoveryGeneration(metadata = {}, currentGeneration = 0) {
  if (recoveryWriteGenerationIsCurrent(metadata, currentGeneration)) return;
  const error = new Error('This update was prepared before a database recovery completed. Refresh the platform and try again so restored data is not overwritten.');
  error.code = 'state_recovery_stale_write';
  error.statusCode = 409;
  throw error;
}

function revokedAccountRows(rows, revokedAt) {
  return (Array.isArray(rows) ? rows : []).map(row => ({
    ...(row || {}),
    passwordUpdatedAt: revokedAt,
    recoverySessionRevokedAt: revokedAt
  }));
}

function preserveAccessControlAcrossRecovery(currentState = {}, restoredState = {}, options = {}) {
  const revokedAt = String(options.revokedAt || new Date().toISOString());
  const currentSecurity = currentState.security && typeof currentState.security === 'object' ? currentState.security : {};
  const restoredSecurity = restoredState.security && typeof restoredState.security === 'object' ? restoredState.security : {};
  const currentOwner = currentSecurity.ownerLogin && typeof currentSecurity.ownerLogin === 'object' ? currentSecurity.ownerLogin : null;
  const restoredOwner = restoredSecurity.ownerLogin && typeof restoredSecurity.ownerLogin === 'object' ? restoredSecurity.ownerLogin : {};
  const ownerLogin = currentOwner || restoredOwner;
  const currentStaff = Array.isArray(currentState.staffAccounts) ? currentState.staffAccounts : restoredState.staffAccounts;
  const currentCustomers = Array.isArray(currentState.customerAccounts) ? currentState.customerAccounts : restoredState.customerAccounts;

  return {
    ...(restoredState || {}),
    security: {
      ...restoredSecurity,
      ownerLogin: {
        ...ownerLogin,
        passwordUpdatedAt: revokedAt,
        recoverySessionRevokedAt: revokedAt
      }
    },
    staffAccounts: revokedAccountRows(currentStaff, revokedAt),
    customerAccounts: revokedAccountRows(currentCustomers, revokedAt)
  };
}

module.exports = {
  recoveryWriteGenerationIsCurrent,
  assertCurrentRecoveryGeneration,
  preserveAccessControlAcrossRecovery
};
