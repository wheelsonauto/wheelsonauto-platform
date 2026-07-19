'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const encryptedStateBackup = require('../encrypted-state-backup');
const encryptedStateRecovery = require('../encrypted-state-recovery');
const migrationMaintenanceLease = require('../migration-maintenance-lease');
const secureDocumentStore = require('../secure-document-store');
const stateRepository = require('../state-repository');

const root = path.resolve(__dirname, '..');
const restoreScript = path.join(__dirname, 'restore-encrypted-state-backup.js');

function runRestoreCommand(environment) {
  return spawnSync(process.execPath, [restoreScript], {
    cwd: root,
    env: environment,
    encoding: 'utf8'
  });
}

function fakeRepository(initialState, options = {}) {
  let state = JSON.parse(JSON.stringify(initialState));
  let version = 14;
  const writes = [];
  return {
    writes,
    isTransactional() { return options.transactional !== false; },
    async read() { return { state: JSON.parse(JSON.stringify(state)), version, checksum: stateRepository.checksum(state) }; },
    async write(next, metadata) {
      state = JSON.parse(JSON.stringify(next));
      version += 1;
      writes.push({ state: JSON.parse(JSON.stringify(state)), metadata });
      return { state, version, checksum: stateRepository.checksum(state) };
    }
  };
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-encrypted-recovery-check-'));
  const key = crypto.randomBytes(32).toString('base64');
  const objectStore = secureDocumentStore.createSecureDocumentStore({ provider: 'local', localRoot: temp, encryptionKey: key, keyVersion: 'v1' });
  const backupStore = encryptedStateBackup.createEncryptedStateBackupStore({ objectStore, organizationId: 'org-recovery-check', encryptionKey: key, keyVersion: 'v1' });
  const backupState = {
    vehicles: [{ id: 'vehicle-from-backup', status: 'Ready' }],
    payments: [{ id: 'payment-from-backup', amount: 229, status: 'Paid' }],
    security: { ownerLogin: { username: 'old-owner', passwordHash: 'old-owner-hash' } },
    staffAccounts: [{ id: 'old-staff', username: 'removed-staff', passwordHash: 'old-staff-hash' }],
    customerAccounts: [{ id: 'old-customer', username: 'removed-customer', passwordHash: 'old-customer-hash' }],
    auditLogs: []
  };
  await backupStore.create(backupState, { stateVersion: 8, createdAt: '2026-07-18T12:00:00.000Z' });
  const currentState = {
    vehicles: [{ id: 'vehicle-current', status: 'Rented' }],
    payments: [],
    security: { ownerLogin: { username: 'current-owner', passwordHash: 'current-owner-hash', passwordUpdatedAt: '2026-07-18T13:00:00.000Z' } },
    staffAccounts: [{ id: 'current-staff', username: 'manager', passwordHash: 'current-staff-hash', passwordUpdatedAt: '2026-07-18T13:00:00.000Z' }],
    customerAccounts: [{ id: 'current-customer', username: 'customer', passwordHash: 'current-customer-hash', passwordUpdatedAt: '2026-07-18T13:00:00.000Z' }],
    auditLogs: []
  };
  try {
    const commandEnvironment = {
      ...process.env,
      DATA_DIR: temp,
      WOA_DATA_BACKEND: 'postgres',
      DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
      WOA_MIGRATION_MAINTENANCE_MODE: '1',
      WOA_ENCRYPTED_STATE_RESTORE_CONFIRM: encryptedStateRecovery.RESTORE_CONFIRMATION_PHRASE,
      WOA_SESSION_SECRET: 'encrypted-recovery-maintenance-lease-secret-2026',
      WOA_SERVICE_ID: 'srv-encrypted-recovery-check',
      WOA_DEPLOY_COMMIT: '1234567890abcdef1234567890abcdef12345678',
      WOA_DOCUMENT_STORAGE_PROVIDER: 'local',
      WOA_DOCUMENT_ENCRYPTION_KEY: key,
      WOA_STATE_BACKUP_ENCRYPTION_KEY: key
    };
    const missingLease = runRestoreCommand(commandEnvironment);
    assert.notStrictEqual(missingLease.status, 0, 'A restore command must reject a shell maintenance flag without a deployed-service lease.');
    assert.match(missingLease.stderr, /has not published a migration-maintenance lease/i);

    await migrationMaintenanceLease.publishLease({ environment: commandEnvironment, maintenanceMode: false });
    const inactiveLease = runRestoreCommand(commandEnvironment);
    assert.notStrictEqual(inactiveLease.status, 0, 'A restore command must reject an inactive deployed-service lease.');
    assert.match(inactiveLease.stderr, /not in migration maintenance mode/i);

    const staleAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await migrationMaintenanceLease.publishLease({ environment: commandEnvironment, maintenanceMode: true, now: staleAt, startedAt: staleAt });
    const staleLease = runRestoreCommand(commandEnvironment);
    assert.notStrictEqual(staleLease.status, 0, 'A restore command must reject a stale deployed-service lease.');
    assert.match(staleLease.stderr, /lease is stale/i);

    await migrationMaintenanceLease.publishLease({ environment: commandEnvironment, maintenanceMode: true });
    const activeLease = runRestoreCommand(commandEnvironment);
    assert.notStrictEqual(activeLease.status, 0, 'Local object storage must remain insufficient for a production recovery even under a proven maintenance lease.');
    assert.match(activeLease.stderr, /requires HTTPS S3-compatible encrypted offsite backup storage/i, 'An active lease must allow the command to advance to the independent production-storage guard.');

    await assert.rejects(
      () => encryptedStateRecovery.restoreLatestEncryptedStateBackup({ repository: fakeRepository(currentState), backupStore, maintenanceMode: false, confirmationPhrase: encryptedStateRecovery.RESTORE_CONFIRMATION_PHRASE }),
      /maintenance/i,
      'Recovery must refuse to run while application writers are active.'
    );
    await assert.rejects(
      () => encryptedStateRecovery.restoreLatestEncryptedStateBackup({ repository: fakeRepository(currentState), backupStore, maintenanceMode: true, confirmationPhrase: 'RESTORE' }),
      /type exactly/i,
      'Recovery must require the exact destructive confirmation phrase.'
    );
    await assert.rejects(
      () => encryptedStateRecovery.restoreLatestEncryptedStateBackup({ repository: fakeRepository(currentState, { transactional: false }), backupStore, maintenanceMode: true, maintenanceAssertion: async () => {}, confirmationPhrase: encryptedStateRecovery.RESTORE_CONFIRMATION_PHRASE }),
      /PostgreSQL/i,
      'Recovery must refuse the JSON fallback backend.'
    );
    await assert.rejects(
      () => encryptedStateRecovery.restoreLatestEncryptedStateBackup({ repository: fakeRepository(currentState), backupStore, maintenanceMode: true, confirmationPhrase: encryptedStateRecovery.RESTORE_CONFIRMATION_PHRASE }),
      /signed lease/i,
      'The recovery core must require its caller to prove the deployed maintenance lease.'
    );

    const restartedRepository = fakeRepository(currentState);
    let restartAssertions = 0;
    await assert.rejects(
      () => encryptedStateRecovery.restoreLatestEncryptedStateBackup({
        repository: restartedRepository,
        backupStore,
        maintenanceMode: true,
        maintenanceAssertion: async stage => {
          restartAssertions += 1;
          if (stage === 'before_state_write') throw new Error('The deployed maintenance process restarted during recovery.');
        },
        confirmationPhrase: encryptedStateRecovery.RESTORE_CONFIRMATION_PHRASE
      }),
      /maintenance process restarted/i,
      'A service restart after backup verification but before the PostgreSQL write must abort recovery.'
    );
    assert.strictEqual(restartAssertions, 2, 'The restart simulation must fail at the second maintenance assertion.');
    assert.strictEqual(restartedRepository.writes.length, 0, 'A restarted maintenance process must not commit recovered state.');

    const repository = fakeRepository(currentState);
    const revokedAt = '2026-07-18T15:00:00.000Z';
    const maintenanceStages = [];
    const result = await encryptedStateRecovery.restoreLatestEncryptedStateBackup({
      repository,
      backupStore,
      maintenanceMode: true,
      maintenanceAssertion: async stage => { maintenanceStages.push(stage); },
      confirmationPhrase: encryptedStateRecovery.RESTORE_CONFIRMATION_PHRASE,
      actor: 'Recovery Check Owner',
      revokedAt
    });
    assert.strictEqual(result.previousVersion, 14);
    assert.strictEqual(result.restoredVersion, 15);
    assert.strictEqual(result.backup.stateChecksum, stateRepository.checksum(backupState));
    assert.strictEqual(repository.writes.length, 1, 'A recovery must produce exactly one new transactional state version.');
    const restored = repository.writes[0].state;
    assert.strictEqual(restored.vehicles[0].id, 'vehicle-from-backup', 'Business state must come from the authenticated backup.');
    assert.strictEqual(restored.payments[0].id, 'payment-from-backup', 'Payment history must come from the authenticated backup.');
    assert.strictEqual(restored.security.ownerLogin.username, 'current-owner', 'Recovery must preserve the current owner identity.');
    assert.strictEqual(restored.staffAccounts[0].id, 'current-staff', 'Recovery must not resurrect deleted staff accounts.');
    assert.strictEqual(restored.customerAccounts[0].id, 'current-customer', 'Recovery must not resurrect deleted customer portal accounts.');
    assert.strictEqual(restored.security.ownerLogin.passwordUpdatedAt, revokedAt, 'Recovery must revoke the owner session generation.');
    assert.strictEqual(restored.staffAccounts[0].passwordUpdatedAt, revokedAt, 'Recovery must revoke staff sessions.');
    assert.strictEqual(restored.customerAccounts[0].passwordUpdatedAt, revokedAt, 'Recovery must revoke customer sessions.');
    assert(restored.auditLogs.some(row => row.action === 'Encrypted offsite state backup restored'), 'Recovery must leave an auditable state record.');
    assert.strictEqual(repository.writes[0].metadata.reason, 'controlled encrypted offsite state recovery');
    assert.strictEqual(repository.writes[0].metadata.recoveryEvent.eventType, 'encrypted_offsite_restore', 'Encrypted offsite recovery must append a normalized PostgreSQL recovery-history event in the same write.');
    assert(/^encrypted-backup-[a-f0-9]{64}$/.test(repository.writes[0].metadata.recoveryEvent.eventId), 'Encrypted offsite recovery history must use a stable opaque event identity.');
    assert.strictEqual(repository.writes[0].metadata.recoveryEvent.sourceChecksum, result.backup.stateChecksum, 'Encrypted offsite recovery history must retain the authenticated source checksum.');
    assert.strictEqual(repository.writes[0].metadata.recoveryEvent.details.accessControlPreserved, true, 'Encrypted offsite recovery history must retain the access-control preservation proof.');
    assert.strictEqual(repository.writes[0].metadata.recoveryEvent.details.sessionsRevoked, true, 'Encrypted offsite recovery history must retain the session-revocation proof.');
    assert.strictEqual(result.restoredChecksum, stateRepository.checksum(restored), 'Recovery must verify the committed state through a second repository read.');
    assert.deepStrictEqual(maintenanceStages, ['before_backup_read', 'before_state_write', 'after_readback_verification'], 'Recovery must re-prove the same maintenance process across backup read, PostgreSQL commit, and read-back verification.');

    console.log('Encrypted state recovery check passed: signed live maintenance lease, inactive/stale/restart rejection, exact confirmation, PostgreSQL requirement, authenticated backup restore, access-control preservation, session revocation, audit trail, snapshot write, and read-back checksum verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
