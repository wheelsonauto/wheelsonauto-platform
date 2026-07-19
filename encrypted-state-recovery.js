'use strict';

const crypto = require('crypto');
const recoveryGuard = require('./recovery-guard');
const stateRepository = require('./state-repository');

const RESTORE_CONFIRMATION_PHRASE = 'RESTORE LATEST ENCRYPTED STATE BACKUP';

function recoveryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeBackupMetadata(metadata = {}) {
  return {
    organizationId: String(metadata.organizationId || ''),
    createdAt: String(metadata.createdAt || ''),
    stateVersion: String(metadata.stateVersion == null ? '' : metadata.stateVersion),
    stateChecksum: String(metadata.stateChecksum || ''),
    stateSize: Math.max(0, Number(metadata.stateSize || 0)),
    keyVersion: String(metadata.keyVersion || '')
  };
}

function appendRecoveryAudit(state, options = {}) {
  state.auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs : [];
  state.auditLogs.unshift({
    id: 'audit-encrypted-state-recovery-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'),
    organizationId: String(options.organizationId || 'org-wheelsonauto'),
    action: 'Encrypted offsite state backup restored',
    actor: String(options.actor || 'controlled recovery').slice(0, 160),
    details: [
      'Backup created ' + String(options.backupCreatedAt || 'unknown'),
      'Backup source version ' + String(options.backupVersion || 'unknown'),
      'Backup checksum ' + String(options.backupChecksum || '').slice(0, 16),
      'Current staff and customer access controls preserved',
      'All signed sessions revoked',
      'PostgreSQL recovery snapshot created automatically'
    ],
    createdAt: String(options.revokedAt || new Date().toISOString())
  });
  return state;
}

async function restoreLatestEncryptedStateBackup(options = {}) {
  const repository = options.repository;
  const backupStore = options.backupStore;
  if (options.maintenanceMode !== true) {
    throw recoveryError('Encrypted offsite recovery requires WOA_MIGRATION_MAINTENANCE_MODE=1 so application and provider writes remain frozen.', 'woa_encrypted_restore_maintenance_required');
  }
  if (String(options.confirmationPhrase || '').trim() !== RESTORE_CONFIRMATION_PHRASE) {
    throw recoveryError('Type exactly "' + RESTORE_CONFIRMATION_PHRASE + '" before restoring an encrypted offsite backup.', 'woa_encrypted_restore_confirmation_required');
  }
  if (!repository || typeof repository.isTransactional !== 'function' || !repository.isTransactional()) {
    throw recoveryError('Encrypted offsite recovery requires PostgreSQL transactional storage.', 'woa_encrypted_restore_requires_postgres');
  }
  if (!backupStore || typeof backupStore.readLatest !== 'function') {
    throw recoveryError('Encrypted offsite backup storage is unavailable.', 'woa_encrypted_restore_storage_missing');
  }

  const recovered = await backupStore.readLatest();
  const backup = safeBackupMetadata(recovered.metadata);
  if (stateRepository.checksum(recovered.state) !== backup.stateChecksum) {
    throw recoveryError('Encrypted offsite backup checksum verification failed before recovery.', 'woa_encrypted_restore_checksum_failed');
  }
  const current = await repository.read();
  if (!current || !current.state || typeof current.state !== 'object') {
    throw recoveryError('Current PostgreSQL state is unavailable. Refusing recovery.', 'woa_encrypted_restore_current_state_missing');
  }
  const currentChecksum = stateRepository.checksum(current.state);
  if (current.checksum && current.checksum !== currentChecksum) {
    throw recoveryError('Current PostgreSQL checksum verification failed. Refusing recovery.', 'woa_encrypted_restore_current_checksum_failed');
  }

  const revokedAt = String(options.revokedAt || new Date().toISOString());
  const actor = String(options.actor || 'controlled encrypted state recovery').slice(0, 160);
  const restored = recoveryGuard.preserveAccessControlAcrossRecovery(current.state, recovered.state, { revokedAt });
  appendRecoveryAudit(restored, {
    organizationId: backup.organizationId,
    actor,
    revokedAt,
    backupCreatedAt: backup.createdAt,
    backupVersion: backup.stateVersion,
    backupChecksum: backup.stateChecksum
  });
  const recoveryEventId = 'encrypted-backup-' + crypto.createHash('sha256')
    .update([backup.stateChecksum, backup.createdAt, revokedAt].join('\u0000'), 'utf8')
    .digest('hex');
  const written = await repository.write(restored, {
    reason: 'controlled encrypted offsite state recovery',
    actor,
    recoveryEvent: {
      eventType: 'encrypted_offsite_restore',
      eventId: recoveryEventId,
      sourceVersion: Math.max(0, Number(backup.stateVersion || 0)),
      sourceChecksum: backup.stateChecksum,
      result: 'completed',
      actor,
      details: {
        backupCreatedAt: backup.createdAt,
        backupKeyVersion: backup.keyVersion,
        accessControlPreserved: true,
        sessionsRevoked: true
      }
    }
  });
  const verified = await repository.read();
  const verifiedChecksum = stateRepository.checksum(verified.state);
  if (written.checksum !== verifiedChecksum || verified.checksum && verified.checksum !== verifiedChecksum) {
    throw recoveryError('PostgreSQL read-back checksum failed after encrypted state recovery.', 'woa_encrypted_restore_readback_failed');
  }
  return {
    backup,
    previousVersion: current.version,
    previousChecksum: currentChecksum,
    restoredVersion: verified.version,
    restoredChecksum: verifiedChecksum,
    revokedAt,
    reauthenticate: true
  };
}

module.exports = {
  RESTORE_CONFIRMATION_PHRASE,
  safeBackupMetadata,
  appendRecoveryAudit,
  restoreLatestEncryptedStateBackup
};
