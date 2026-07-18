'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const stateRepository = require('../state-repository');
const secureDocumentStore = require('../secure-document-store');
const encryptedStateBackup = require('../encrypted-state-backup');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-encrypted-backup-check-'));
  const key = crypto.randomBytes(32).toString('base64');
  const nextKey = crypto.randomBytes(32).toString('base64');
  const organizationId = 'org-backup-check';
  const objectStore = secureDocumentStore.createSecureDocumentStore({
    provider: 'local',
    localRoot: temp,
    encryptionKey: key,
    keyVersion: 'v1'
  });
  const backups = encryptedStateBackup.createEncryptedStateBackupStore({
    objectStore,
    organizationId,
    encryptionKey: key,
    keyVersion: 'v1'
  });

  try {
    assert.strictEqual(backups.status().configured, true, 'Encrypted offsite backups should use any configured object store in test mode.');
    assert.strictEqual(backups.status().productionReady, false, 'A local object store must never claim production backup readiness.');
    await assert.rejects(
      () => backups.verifyLatest(),
      error => error && error.code === 'woa_state_backup_not_found' && error.message === 'No encrypted state backup has been created yet.' && !error.message.includes(temp),
      'A missing backup must return an actionable public-safe status without exposing its private filesystem path.'
    );

    const firstState = {
      vehicles: [{ id: 'vehicle-backup-1', vin: 'BACKUPVIN00000001', currentCustomer: 'Backup Customer' }],
      customers: [{ id: 'customer-backup-1', name: 'Backup Customer', email: 'backup@example.com' }],
      payments: [{ id: 'payment-backup-1', customer: 'Backup Customer', amount: 229, status: 'Paid' }],
      integrations: { stripe: { lastEventId: 'evt_backup_1' } }
    };
    const first = await backups.create(firstState, { stateVersion: 7, createdAt: '2026-07-18T12:00:00.000Z' });
    assert.strictEqual(first.verified, true, 'A backup must be read back and verified before creation succeeds.');
    assert.strictEqual(first.stateChecksum, stateRepository.checksum(firstState), 'The backup must retain the canonical state checksum.');
    const firstRead = await backups.readLatest();
    assert.strictEqual(stateRepository.stableJson(firstRead.state), stateRepository.stableJson(firstState), 'The latest backup must decrypt to the exact canonical state.');
    assert.strictEqual(firstRead.metadata.stateVersion, '7', 'The backup must retain its source database version.');

    const compactLimits = encryptedStateBackup.createEncryptedStateBackupStore({
      objectStore,
      organizationId: 'org-backup-size-check',
      encryptionKey: key,
      keyVersion: 'v1',
      maxEnvelopeBytes: 4096,
      maxStateBytes: 128 * 1024
    });
    const compressibleLargeState = { payload: 'state-data-'.repeat(7000) };
    assert(Buffer.byteLength(stateRepository.stableJson(compressibleLargeState), 'utf8') > 4096, 'The scale regression fixture must be larger than the encrypted-envelope limit.');
    await compactLimits.create(compressibleLargeState, { stateVersion: 1, createdAt: '2026-07-18T12:30:00.000Z' });
    assert.strictEqual((await compactLimits.readLatest()).state.payload, compressibleLargeState.payload, 'A valid compressed state larger than the envelope limit must still restore under the independent state-size limit.');

    const secondState = { ...firstState, payments: firstState.payments.concat({ id: 'payment-backup-2', customer: 'Backup Customer', amount: 15, status: 'Paid' }) };
    const second = await backups.create(secondState, { stateVersion: 8, createdAt: '2026-07-18T13:00:00.000Z' });
    assert.notStrictEqual(second.storageKey, first.storageKey, 'Each encrypted backup must be immutable and use a unique object key.');
    assert.strictEqual((await backups.verifyLatest()).stateChecksum, stateRepository.checksum(secondState), 'The atomic latest pointer must advance to the newest verified backup.');
    await objectStore.readObject(first.storageKey);

    const pointerKey = backups.latestPointerKey();
    const originalReadObject = objectStore.readObject.bind(objectStore);
    const originalReplaceObject = objectStore.replaceObject.bind(objectStore);
    let injectedReadFailureKey = '';
    objectStore.replaceObject = async (storageKey, bytes) => {
      const result = await originalReplaceObject(storageKey, bytes);
      if (storageKey === pointerKey) {
        const candidate = JSON.parse(bytes.toString('utf8'));
        if (candidate.stateVersion === '9') injectedReadFailureKey = candidate.storageKey;
      }
      return result;
    };
    objectStore.readObject = async storageKey => {
      if (storageKey === injectedReadFailureKey) {
        injectedReadFailureKey = '';
        throw new Error('Injected post-pointer read-back failure.');
      }
      return originalReadObject(storageKey);
    };
    try {
      await assert.rejects(
        () => backups.create({ ...secondState, interrupted: true }, { stateVersion: 9, createdAt: '2026-07-18T14:00:00.000Z' }),
        /Injected post-pointer read-back failure/i,
        'A backup must fail if the newly published pointer cannot be read back and authenticated.'
      );
    } finally {
      objectStore.readObject = originalReadObject;
      objectStore.replaceObject = originalReplaceObject;
    }
    assert.strictEqual((await backups.verifyLatest()).stateChecksum, stateRepository.checksum(secondState), 'A failed post-pointer verification must atomically restore the previous known-good latest pointer.');

    const pointerBytes = await objectStore.readObject(pointerKey);
    const pointer = JSON.parse(pointerBytes.toString('utf8'));
    const backupBytes = await objectStore.readObject(pointer.storageKey);
    const signingKey = secureDocumentStore.decodeEncryptionKey(key);

    const wrongKeyStore = encryptedStateBackup.createEncryptedStateBackupStore({
      objectStore,
      organizationId,
      encryptionKey: nextKey,
      keyVersion: 'v1'
    });
    await assert.rejects(() => wrongKeyStore.readLatest(), /signature verification failed/i, 'The wrong encryption key must not authenticate the signed latest pointer.');

    const tamperedPointer = { ...pointer, stateVersion: '999' };
    await objectStore.replaceObject(pointerKey, Buffer.from(stateRepository.stableJson(tamperedPointer), 'utf8'));
    await assert.rejects(() => backups.readLatest(), /signature verification failed/i, 'A modified latest pointer must fail closed before object retrieval.');
    await objectStore.replaceObject(pointerKey, pointerBytes);

    const sizeTamperedPointer = { ...pointer, stateSize: pointer.stateSize + 1 };
    sizeTamperedPointer.signature = crypto.createHmac('sha256', signingKey).update(encryptedStateBackup.pointerSigningValue(sizeTamperedPointer), 'utf8').digest('hex');
    await objectStore.replaceObject(pointerKey, Buffer.from(stateRepository.stableJson(sizeTamperedPointer), 'utf8'));
    await assert.rejects(() => backups.readLatest(), /size does not match/i, 'A signed pointer with inconsistent state-size metadata must fail closed.');
    await objectStore.replaceObject(pointerKey, pointerBytes);

    const tamperedBackup = Buffer.from(backupBytes);
    tamperedBackup[Math.max(0, tamperedBackup.length - 10)] ^= 1;
    await objectStore.replaceObject(pointer.storageKey, tamperedBackup);
    await assert.rejects(() => backups.readLatest(), /object checksum/i, 'A modified encrypted backup object must fail its signed pointer checksum.');
    await objectStore.replaceObject(pointer.storageKey, backupBytes);

    const envelope = JSON.parse(backupBytes.toString('utf8'));
    const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    ciphertext[0] ^= 1;
    envelope.ciphertext = ciphertext.toString('base64');
    envelope.ciphertextSha256 = crypto.createHash('sha256').update(ciphertext).digest('hex');
    const forgedBytes = Buffer.from(stateRepository.stableJson(envelope), 'utf8');
    const forgedPointer = { ...pointer, backupSha256: crypto.createHash('sha256').update(forgedBytes).digest('hex') };
    forgedPointer.signature = crypto.createHmac('sha256', signingKey).update(encryptedStateBackup.pointerSigningValue(forgedPointer), 'utf8').digest('hex');
    await objectStore.replaceObject(pointer.storageKey, forgedBytes);
    await objectStore.replaceObject(pointerKey, Buffer.from(stateRepository.stableJson(forgedPointer), 'utf8'));
    await assert.rejects(() => backups.readLatest(), /authentication failed/i, 'Even a re-signed envelope with changed ciphertext must fail AES-GCM authentication.');

    await objectStore.replaceObject(pointer.storageKey, backupBytes);
    await objectStore.replaceObject(pointerKey, pointerBytes);
    assert.strictEqual((await backups.verifyLatest()).verified, true, 'The original encrypted backup must remain recoverable after fail-closed tamper checks.');

    console.log('Encrypted state backup check passed: safe missing-backup status, immutable backup objects, atomic latest pointer, canonical checksum, AES-GCM authentication, key isolation, tamper rejection, and read-back recovery verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
