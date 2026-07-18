'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const encryptedStateBackup = require('../encrypted-state-backup');
const encryptedStateRecovery = require('../encrypted-state-recovery');
const secureDocumentStore = require('../secure-document-store');
const stateRepository = require('../state-repository');

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
      () => encryptedStateRecovery.restoreLatestEncryptedStateBackup({ repository: fakeRepository(currentState, { transactional: false }), backupStore, maintenanceMode: true, confirmationPhrase: encryptedStateRecovery.RESTORE_CONFIRMATION_PHRASE }),
      /PostgreSQL/i,
      'Recovery must refuse the JSON fallback backend.'
    );

    const repository = fakeRepository(currentState);
    const revokedAt = '2026-07-18T15:00:00.000Z';
    const result = await encryptedStateRecovery.restoreLatestEncryptedStateBackup({
      repository,
      backupStore,
      maintenanceMode: true,
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
    assert.strictEqual(result.restoredChecksum, stateRepository.checksum(restored), 'Recovery must verify the committed state through a second repository read.');

    console.log('Encrypted state recovery check passed: maintenance guard, exact confirmation, PostgreSQL requirement, authenticated backup restore, access-control preservation, session revocation, audit trail, snapshot write, and read-back checksum verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
