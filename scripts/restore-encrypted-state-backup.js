'use strict';

const path = require('path');
const encryptedStateBackup = require('../encrypted-state-backup');
const encryptedStateRecovery = require('../encrypted-state-recovery');
const migrationMaintenanceLease = require('../migration-maintenance-lease');
const secureDocumentStore = require('../secure-document-store');
const stateRepository = require('../state-repository');

async function assertSameMaintenanceLease(expected) {
  const current = await migrationMaintenanceLease.assertActiveLease({ environment: process.env });
  if (current.serviceId !== expected.serviceId
    || current.renderCommit !== expected.renderCommit
    || current.instanceId !== expected.instanceId
    || current.startedAt !== expected.startedAt) {
    throw new Error('The deployed maintenance process restarted during encrypted state recovery. Keep maintenance enabled and restart the recovery review from the beginning.');
  }
  return current;
}

async function main() {
  if (process.env.WOA_DATA_BACKEND !== 'postgres') throw new Error('Set WOA_DATA_BACKEND=postgres before controlled encrypted state recovery.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for controlled encrypted state recovery.');
  if (process.env.WOA_MIGRATION_MAINTENANCE_MODE !== '1') throw new Error('Set WOA_MIGRATION_MAINTENANCE_MODE=1 and verify /healthz before recovery.');
  if (process.env.WOA_ENCRYPTED_STATE_RESTORE_CONFIRM !== encryptedStateRecovery.RESTORE_CONFIRMATION_PHRASE) {
    throw new Error('Set WOA_ENCRYPTED_STATE_RESTORE_CONFIRM="' + encryptedStateRecovery.RESTORE_CONFIRMATION_PHRASE + '" to authorize this one recovery run.');
  }
  const activeMaintenanceLease = await migrationMaintenanceLease.assertActiveLease({ environment: process.env });

  const organizationId = String(process.env.WOA_MAIN_ORGANIZATION_ID || 'org-wheelsonauto');
  const objectStore = secureDocumentStore.createSecureDocumentStore({
    provider: process.env.WOA_DOCUMENT_STORAGE_PROVIDER || 'local',
    localRoot: path.resolve(process.env.DATA_DIR || __dirname, 'private-documents'),
    encryptionKey: process.env.WOA_DOCUMENT_ENCRYPTION_KEY || '',
    keyVersion: process.env.WOA_DOCUMENT_ENCRYPTION_KEY_VERSION || 'v1',
    decryptionKeys: process.env.WOA_DOCUMENT_DECRYPTION_KEYS || '',
    bucket: process.env.WOA_OBJECT_STORAGE_BUCKET || process.env.S3_BUCKET || '',
    endpoint: process.env.WOA_OBJECT_STORAGE_ENDPOINT || process.env.S3_ENDPOINT || '',
    region: process.env.WOA_OBJECT_STORAGE_REGION || process.env.S3_REGION || '',
    accessKeyId: process.env.WOA_OBJECT_STORAGE_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.WOA_OBJECT_STORAGE_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || '',
    sessionToken: process.env.AWS_SESSION_TOKEN || '',
    pathStyle: process.env.WOA_OBJECT_STORAGE_PATH_STYLE === '1'
  });
  const backupStore = encryptedStateBackup.createEncryptedStateBackupStore({
    objectStore,
    organizationId,
    encryptionKey: process.env.WOA_STATE_BACKUP_ENCRYPTION_KEY || process.env.WOA_DOCUMENT_ENCRYPTION_KEY || '',
    keyVersion: process.env.WOA_STATE_BACKUP_KEY_VERSION || process.env.WOA_DOCUMENT_ENCRYPTION_KEY_VERSION || 'v1',
    decryptionKeys: process.env.WOA_STATE_BACKUP_DECRYPTION_KEYS || process.env.WOA_DOCUMENT_DECRYPTION_KEYS || ''
  });
  if (!backupStore.status().productionReady) throw new Error('Controlled production recovery requires HTTPS S3-compatible encrypted offsite backup storage.');

  const repository = stateRepository.createStateRepository({
    backend: 'postgres',
    organizationId,
    databaseUrl: process.env.DATABASE_URL,
    sslMode: process.env.WOA_POSTGRES_SSL_MODE || '',
    maxConnections: 1,
    snapshotLimit: process.env.WOA_POSTGRES_SNAPSHOT_LIMIT || 180,
    rateLimitSecret: process.env.WOA_SESSION_SECRET || organizationId,
    seed: async () => ({}),
    repair: value => value,
    applicationName: 'wheelsonauto-encrypted-state-recovery'
  });
  try {
    const result = await encryptedStateRecovery.restoreLatestEncryptedStateBackup({
      repository,
      backupStore,
      maintenanceMode: true,
      maintenanceAssertion: () => assertSameMaintenanceLease(activeMaintenanceLease),
      confirmationPhrase: process.env.WOA_ENCRYPTED_STATE_RESTORE_CONFIRM,
      actor: process.env.WOA_ENCRYPTED_STATE_RESTORE_ACTOR || 'maintenance recovery command'
    });
    console.log(JSON.stringify({
      ok: true,
      backup: result.backup,
      previousVersion: result.previousVersion,
      restoredVersion: result.restoredVersion,
      restoredChecksum: result.restoredChecksum,
      maintenanceRenderServiceId: activeMaintenanceLease.serviceId,
      maintenanceRenderCommit: activeMaintenanceLease.renderCommit,
      maintenanceInstanceId: activeMaintenanceLease.instanceId,
      maintenanceStartedAt: activeMaintenanceLease.startedAt,
      maintenanceLeaseSignatureChecksum: activeMaintenanceLease.signatureChecksum,
      reauthenticate: result.reauthenticate,
      message: 'Encrypted offsite state backup restored into a new PostgreSQL version. Keep maintenance mode active until owner login, checksums, customer/vehicle identity, and provider queues are reviewed.'
    }, null, 2));
  } finally {
    await repository.close();
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
