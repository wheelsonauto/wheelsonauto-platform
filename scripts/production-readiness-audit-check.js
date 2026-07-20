'use strict';

const assert = require('node:assert');
const { buildProductionReadinessAudit } = require('../production-readiness-audit');

function readyInfrastructure() {
  return {
    launchStage: 'live_stripe_ready',
    readyForLiveStripe: true,
    hardeningRequired: true,
    database: {
      connected: true,
      transactional: true,
      productionReady: true,
      schemaContractReady: true,
      schemaContract: { ready: true, missingMigrations: [], missingConstraints: [], missingIndexes: [] },
      stateImported: true,
      integrity: 'verified',
      migrationProofReady: true,
      snapshotRecoveryReady: true,
      recoveryDrillReady: true,
      resourceIndexReady: true,
      assignmentIndexReady: true,
      identityIndexReady: true,
      documentIndexReady: true,
      snapshotCount: 170,
      recoveryHistoryCount: 2
    },
    documentStorage: { provider: 's3', productionReady: true },
    documentStorageValidation: { live: true, fresh: true, publicReadBlocked: true, immutableWriteProtected: true, objectDeleted: true },
    documentEncryptionKeys: { ready: true, encryptedDocuments: 112 },
    privateArtifacts: { ready: true },
    stateBackup: { enabled: true, productionReady: true, dedicatedKeyConfigured: true, verified: true, fresh: true },
    ownerAuthentication: { usernameConfigured: true, passwordLoginConfigured: true, passwordLoginStrong: true, passwordLoginVerified: true, pinFallbackAllowed: false },
    stripeAccount: { live: true, fresh: true, configurationMatched: true },
    stripeWebhook: { live: true, fresh: true, configurationMatched: true },
    stripeIdentityWebhook: { live: true, fresh: true, configurationMatched: true },
    telnyxMessaging: { live: true, configured: true, fresh: true, configurationMatched: true },
    resendEmail: { live: true, configured: true, fresh: true, configurationMatched: true },
    starAi: { live: true, configured: true, fresh: true, configurationMatched: true },
    operationalAlerts: { live: true, configured: true, verified: true, fresh: true, configurationMatched: true },
    cloverRecurring: { ready: true, fresh: true, configurationMatched: true, eligibleRows: 7, quarantinedRows: 2, reviewRequired: true },
    identityConflictCount: 0,
    assignmentConflictCount: 2,
    blockingAssignmentConflictCount: 0,
    assignmentReviewWarningCount: 2,
    identityWarnings: [],
    providerProofCollection: { ready: true, missing: [], providerEvidenceMissing: [], stripeMoneyActionsLocked: false },
    missing: []
  };
}

const ready = buildProductionReadinessAudit({
  checkedAt: '2026-07-20T12:00:00.000Z',
  environment: { ready: true, missing: [] },
  infrastructure: readyInfrastructure()
});
assert.strictEqual(ready.readyForLiveStripe, true);
assert.strictEqual(ready.foundation.postgres.productionReady, true);
assert.strictEqual(ready.foundation.postgres.schemaContractReady, true);
assert.strictEqual(ready.foundation.postgres.missingSchemaMigrations, 0);
assert.strictEqual(ready.foundation.postgres.missingSchemaConstraints, 0);
assert.strictEqual(ready.foundation.postgres.missingSchemaIndexes, 0);
assert.strictEqual(ready.foundation.privateStorage.validationLive, true);
assert.strictEqual(ready.foundation.ownerAccess.pinFallbackDisabled, true);
assert.strictEqual(ready.providers.cloverRecurringRoster.quarantinedRows, 2, 'Ambiguous Clover plans must remain visible without falsely blocking individually eligible rows.');
assert.strictEqual(ready.dataReview.blockingAssignmentConflicts, 0, 'Review-only renter history must remain distinct from an active assignment conflict.');
assert.strictEqual(ready.safety.stripeMoneyActionsLocked, false);
assert.deepStrictEqual(ready.nextActions, []);

const blockedInfrastructure = readyInfrastructure();
blockedInfrastructure.readyForLiveStripe = false;
blockedInfrastructure.launchStage = 'provider_proof_collection';
blockedInfrastructure.stripeAccount = {
  live: false,
  accountId: 'acct_private_identifier',
  eventId: 'evt_private_identifier',
  error: 'secret-sk_live_should_never_appear'
};
blockedInfrastructure.providerProofCollection = {
  ready: true,
  providerEvidenceMissing: ['Stripe live account activation proof'],
  stripeMoneyActionsLocked: true
};
blockedInfrastructure.missing = ['Stripe live secret key', 'Stripe live account activation proof', 'owner username/password login'];
blockedInfrastructure.ownerAuthentication = { pinFallbackAllowed: true };
blockedInfrastructure.identityWarnings = [{ vin: 'PRIVATEVIN1234567', customer: 'Private Customer' }];
blockedInfrastructure.database.schemaContractReady = false;
blockedInfrastructure.database.schemaContract = {
  ready: false,
  missingMigrations: ['private_migration_identifier'],
  missingConstraints: [{ tableName: 'private_table_identifier' }],
  missingIndexes: [{ name: 'private_index_identifier' }]
};

const blocked = buildProductionReadinessAudit({
  environment: { ready: false, missing: ['STRIPE_SECRET_KEY', 'WOA_PRODUCTION_HARDENING_REQUIRED'] },
  infrastructure: blockedInfrastructure
});
assert.strictEqual(blocked.readyForLiveStripe, false);
assert.strictEqual(blocked.safety.stripeMoneyActionsLocked, true);
assert.strictEqual(blocked.foundation.ownerAccess.pinFallbackDisabled, false);
assert.strictEqual(blocked.foundation.postgres.schemaContractReady, false);
assert.strictEqual(blocked.foundation.postgres.missingSchemaMigrations, 1);
assert.strictEqual(blocked.foundation.postgres.missingSchemaConstraints, 1);
assert.strictEqual(blocked.foundation.postgres.missingSchemaIndexes, 1);
assert(blocked.nextActions.includes('STRIPE_SECRET_KEY') && blocked.nextActions.includes('Stripe live account activation proof'));
assert.strictEqual(blocked.nextActions.filter(item => item === 'Stripe live account activation proof').length, 1, 'Repeated readiness gaps must be deduplicated.');
const serialized = JSON.stringify(blocked);
assert(!serialized.includes('secret-sk_live_should_never_appear'), 'Provider error text and secret-like values must not leak through the read-only audit.');
['acct_private_identifier', 'evt_private_identifier', 'PRIVATEVIN1234567', 'Private Customer', 'private_migration_identifier', 'private_table_identifier', 'private_index_identifier'].forEach(identifier => {
  assert(!serialized.includes(identifier), 'The readiness audit must remain aggregate and omit customer/provider identifiers.');
});

console.log('Production readiness audit check passed: aggregate launch evidence is read-only, deduplicated, provider-safe, and keeps historical renter warnings separate from active conflicts.');
