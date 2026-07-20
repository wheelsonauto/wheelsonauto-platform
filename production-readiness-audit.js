'use strict';

function bool(value) {
  return value === true;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function evidenceRow(evidence = {}) {
  return {
    live: bool(evidence.live),
    configured: evidence.configured === undefined ? undefined : bool(evidence.configured),
    verified: evidence.verified === undefined ? undefined : bool(evidence.verified),
    fresh: evidence.fresh === undefined ? undefined : bool(evidence.fresh),
    configurationMatched: evidence.configurationMatched === undefined ? undefined : bool(evidence.configurationMatched)
  };
}

function compactRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function buildProductionReadinessAudit({ environment = {}, infrastructure = {}, checkedAt = new Date().toISOString() } = {}) {
  const database = infrastructure.database || {};
  const owner = infrastructure.ownerAuthentication || {};
  const storage = infrastructure.documentStorage || {};
  const storageProof = infrastructure.documentStorageValidation || {};
  const storageKeys = infrastructure.documentEncryptionKeys || {};
  const artifacts = infrastructure.privateArtifacts || {};
  const backup = infrastructure.stateBackup || {};
  const providerProof = infrastructure.providerProofCollection || {};
  const environmentMissing = uniqueStrings(environment.missing);
  const infrastructureMissing = uniqueStrings(infrastructure.missing);
  const nextActions = uniqueStrings([...environmentMissing, ...infrastructureMissing]);
  const foundationReady = bool(providerProof.ready);
  const readyForLiveStripe = bool(environment.ready) && bool(infrastructure.readyForLiveStripe);

  return {
    checkedAt,
    phase: 'controlled-clover-to-stripe-launch',
    readyForLiveStripe,
    launchStage: String(infrastructure.launchStage || (foundationReady ? 'provider_proof_collection' : 'foundation_blocked')),
    environment: {
      ready: bool(environment.ready),
      missing: environmentMissing
    },
    foundation: {
      readyForProviderProof: foundationReady,
      postgres: {
        connected: bool(database.connected),
        transactional: bool(database.transactional),
        productionReady: bool(database.productionReady),
        stateImported: bool(database.stateImported),
        integrityVerified: String(database.integrity || '').toLowerCase() === 'verified',
        migrationProofReady: bool(database.migrationProofReady),
        snapshotRecoveryReady: bool(database.snapshotRecoveryReady),
        recoveryDrillReady: bool(database.recoveryDrillReady),
        resourceIndexReady: bool(database.resourceIndexReady),
        assignmentIndexReady: bool(database.assignmentIndexReady),
        identityIndexReady: bool(database.identityIndexReady),
        documentIndexReady: bool(database.documentIndexReady),
        snapshotCount: Math.max(0, Number(database.snapshotCount || 0)),
        recoveryHistoryCount: Math.max(0, Number(database.recoveryHistoryCount || 0))
      },
      privateStorage: {
        provider: String(storage.provider || ''),
        productionReady: bool(storage.productionReady),
        validationLive: bool(storageProof.live),
        validationFresh: bool(storageProof.fresh),
        publicReadBlocked: bool(storageProof.publicReadBlocked),
        immutableWriteProtected: bool(storageProof.immutableWriteProtected),
        validationObjectDeleted: bool(storageProof.objectDeleted),
        encryptionKeysReady: bool(storageKeys.ready),
        encryptedDocuments: Math.max(0, Number(storageKeys.encryptedDocuments || 0)),
        privateArtifactsReady: bool(artifacts.ready)
      },
      encryptedBackup: {
        enabled: bool(backup.enabled),
        productionReady: bool(backup.productionReady),
        dedicatedKeyConfigured: bool(backup.dedicatedKeyConfigured),
        verified: bool(backup.verified),
        fresh: bool(backup.fresh)
      },
      ownerAccess: {
        usernameConfigured: bool(owner.usernameConfigured || owner.passwordLoginConfigured),
        passwordLoginConfigured: bool(owner.passwordLoginConfigured),
        passwordRecordStrong: bool(owner.passwordLoginStrong),
        passwordLoginVerified: bool(owner.passwordLoginVerified),
        pinFallbackDisabled: !bool(owner.pinFallbackAllowed)
      }
    },
    providers: {
      stripeAccount: compactRow(evidenceRow(infrastructure.stripeAccount)),
      stripePaymentsWebhook: compactRow(evidenceRow(infrastructure.stripeWebhook)),
      stripeIdentityWebhook: compactRow(evidenceRow(infrastructure.stripeIdentityWebhook)),
      telnyxSms: compactRow(evidenceRow(infrastructure.telnyxMessaging)),
      resendEmail: compactRow(evidenceRow(infrastructure.resendEmail)),
      starAi: compactRow(evidenceRow(infrastructure.starAi)),
      operationalAlerts: compactRow(evidenceRow(infrastructure.operationalAlerts)),
      cloverRecurringRoster: {
        ready: bool((infrastructure.cloverRecurring || {}).ready),
        fresh: bool((infrastructure.cloverRecurring || {}).fresh),
        configurationMatched: bool((infrastructure.cloverRecurring || {}).configurationMatched),
        eligibleRows: Math.max(0, Number((infrastructure.cloverRecurring || {}).eligibleRows || 0)),
        quarantinedRows: Math.max(0, Number((infrastructure.cloverRecurring || {}).quarantinedRows || 0)),
        reviewRequired: bool((infrastructure.cloverRecurring || {}).reviewRequired)
      }
    },
    dataReview: {
      providerIdentityConflicts: Math.max(0, Number(infrastructure.identityConflictCount || 0)),
      assignmentConflicts: Math.max(0, Number(infrastructure.assignmentConflictCount || 0)),
      blockingAssignmentConflicts: Math.max(0, Number(infrastructure.blockingAssignmentConflictCount || 0)),
      assignmentReviewWarnings: Math.max(0, Number(infrastructure.assignmentReviewWarningCount || 0)),
      vehicleIdentityWarnings: Array.isArray(infrastructure.identityWarnings) ? infrastructure.identityWarnings.length : 0
    },
    safety: {
      stripeMoneyActionsLocked: providerProof.stripeMoneyActionsLocked !== false,
      hardeningEnabled: bool(infrastructure.hardeningRequired),
      noLiveActionPerformed: true,
      auditMode: 'read_only'
    },
    nextActions
  };
}

module.exports = {
  buildProductionReadinessAudit
};
