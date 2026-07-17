'use strict';

const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const stateRepository = require('../state-repository');
const secureDocumentStore = require('../secure-document-store');
const stripeMigration = require('../stripe-migration');

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-production-foundation-'));
  try {
    const seedFile = path.join(temp, 'seed.json');
    const dataFile = path.join(temp, 'data.json');
    await fs.writeFile(seedFile, JSON.stringify({ vehicles: [], customers: [], payments: [], documents: [], eSignatures: [] }), 'utf8');

    const repository = stateRepository.createStateRepository({ backend: 'json', dataFile, seedFile });
    await assert.rejects(() => repository.recordMigrationProof({}), /cannot record a PostgreSQL import proof/i, 'The JSON development fallback must never pretend it recorded production migration evidence.');
    assert.strictEqual(stateRepository.checksum({ b: 2, a: { z: 3, y: 4 } }), stateRepository.checksum({ a: { y: 4, z: 3 }, b: 2 }), 'State checksums must be stable when a JSONB database changes object key order.');
    const intactState = { records: [{ id: 'checksum-foundation-1', status: 'intact' }] };
    const intactChecksum = stateRepository.checksum(intactState);
    assert.strictEqual(stateRepository.checksumEvidence(intactState, intactChecksum).matches, true, 'A PostgreSQL state checksum must verify before the state is served or changed.');
    assert.strictEqual(stateRepository.checksumEvidence({ ...intactState, records: [{ id: 'checksum-foundation-1', status: 'tampered' }] }, intactChecksum).matches, false, 'A modified PostgreSQL state payload must fail checksum verification.');
    assert.throws(() => stateRepository.assertChecksum({ ...intactState, records: [{ id: 'checksum-foundation-1', status: 'tampered' }] }, intactChecksum, 'Foundation snapshot'), /checksum verification failed/i, 'A corrupted state snapshot must fail closed before recovery.');
    const verifiedRecoverySnapshot = stateRepository.recoverySnapshotEvidence({
      id: 5,
      version: 4,
      checksum: intactChecksum,
      state: intactState,
      createdAt: '2026-07-17T12:00:00.000Z'
    }, { version: 4, checksum: intactChecksum, snapshotCount: 5 });
    assert.strictEqual(verifiedRecoverySnapshot.snapshotRecoveryReady, true, 'A checksum-verified snapshot matching the current PostgreSQL version must satisfy the recovery launch gate.');
    assert.strictEqual(stateRepository.recoverySnapshotEvidence(null, { version: 4, checksum: intactChecksum }).snapshotIntegrity, 'missing', 'A PostgreSQL state without a retained snapshot must fail the recovery launch gate.');
    assert.strictEqual(stateRepository.recoverySnapshotEvidence({ id: 4, version: 3, checksum: intactChecksum, state: intactState }, { version: 4, checksum: intactChecksum }).snapshotIntegrity, 'stale', 'A previous PostgreSQL snapshot must not masquerade as the current recovery proof.');
    assert.strictEqual(stateRepository.recoverySnapshotEvidence({ id: 5, version: 4, checksum: intactChecksum, state: { records: [] } }, { version: 4, checksum: intactChecksum }).snapshotIntegrity, 'failed', 'A tampered recovery snapshot must fail checksum verification before live launch.');
    const sourceCounts = stateRepository.migrationRecordCounts({ vehicles: [{}], customers: [{}], payments: [], auditLogs: [] });
    const migrationProofInput = {
      sourceChecksum: 'raw-json-checksum',
      canonicalSourceChecksum: intactChecksum,
      targetChecksum: intactChecksum,
      sourceRecordCounts: sourceCounts,
      targetRecordCounts: sourceCounts,
      importedVersion: 4,
      snapshotChecksum: intactChecksum,
      verifiedAt: '2026-07-17T12:00:00.000Z'
    };
    assert.strictEqual(stateRepository.migrationProofEvidence(migrationProofInput).migrationProofReady, true, 'A JSON-to-PostgreSQL import proof must retain matching canonical source, target, snapshot, and collection-count evidence.');
    assert.strictEqual(stateRepository.migrationProofEvidence({ ...migrationProofInput, targetRecordCounts: { vehicles: 0 } }).migrationProofIntegrity, 'failed', 'A migration proof with changed collection counts must fail closed before live launch.');
    const first = await repository.read();
    assert.strictEqual(first.exists, false, 'A missing local data file must safely use the seed without writing it.');
    const next = {
      vehicles: [{ id: 'vehicle-1', vin: '1HGCM82633A004352', plate: 'WOA-101' }],
      customers: [{ id: 'customer-1', email: 'customer@example.com' }],
      customerAccounts: [{ id: 'account-1', username: 'customer@example.com' }],
      payments: [{ id: 'payment-1', stripePaymentIntentId: 'pi_foundation_1' }],
      documents: [],
      eSignatures: []
    };
    const written = await repository.write(next);
    assert.strictEqual(written.state.vehicles[0].vin, next.vehicles[0].vin, 'The state repository must persist a complete state snapshot.');
    assert.strictEqual((await repository.read()).exists, true, 'The local repository must report a persisted state after write.');
    const aiReservation = await repository.reserveAiUsage({ dayKey: '2026-07-17', monthKey: '2026-07', dailyLimit: 1, monthlyLimit: 2 });
    assert.strictEqual(aiReservation.allowed, true, 'The local development guard must reserve the first Star model request.');
    const aiBlocked = await repository.reserveAiUsage({ dayKey: '2026-07-17', monthKey: '2026-07', dailyLimit: 1, monthlyLimit: 2 });
    assert.strictEqual(aiBlocked.allowed, false, 'The local development guard must stop a repeated Star request at the configured daily cap.');
    assert.strictEqual(aiBlocked.reason, 'daily_limit', 'The quota guard must explain why Star fell back to rules.');

    const duplicate = { ...next, vehicles: next.vehicles.concat({ id: 'vehicle-2', vin: '1HGCM82633A004352' }) };
    assert.strictEqual(stateRepository.identityConflicts(duplicate).length, 1, 'A duplicate immutable VIN must be found before PostgreSQL migration.');

    const documentRoot = path.join(temp, 'private-documents');
    const store = secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: documentRoot,
      encryptionKey: Buffer.alloc(32, 9).toString('base64'),
      keyVersion: 'test-v1'
    });
    const source = Buffer.from('private identity proof must never be written in clear text', 'utf8');
    const stored = await store.save({
      id: 'doc-foundation-1',
      bytes: source,
      contentType: 'application/pdf',
      originalName: 'identity.pdf',
      organizationId: 'org-test'
    });
    const encrypted = await fs.readFile(path.join(temp, stored.storagePath));
    assert(!encrypted.equals(source), 'Private document bytes must be encrypted at rest.');
    assert((await store.read(stored)).equals(source), 'Encrypted private document reads must restore the original bytes.');
    await assert.rejects(() => store.read({ ...stored, encryption: { ...stored.encryption, authTag: Buffer.alloc(16).toString('base64') } }), /authenticate|Unsupported state|unable/i, 'Tampered encrypted document metadata must not decrypt.');
    const storageProbe = await store.probe({ organizationId: 'org-test' });
    assert(storageProbe.ok && storageProbe.encrypted && storageProbe.objectDeleted, 'Private document storage validation must prove encrypted write, read, and cleanup.');

    const recurring = {
      id: 'rec-foundation-1',
      paymentProvider: 'clover',
      cloverCustomerId: 'clover-foundation',
      cloverPaymentSource: 'source-foundation',
      stripeCustomerId: 'cus-foundation',
      stripePaymentMethodId: 'pm-foundation'
    };
    let migration = stripeMigration.transition(recurring, stripeMigration.STATES.STRIPE_SETUP_SENT, { at: '2026-07-17T10:00:00.000Z' });
    migration = stripeMigration.transition({ ...recurring, stripeMigration: migration }, stripeMigration.STATES.STRIPE_CARD_SAVED, { at: '2026-07-17T10:01:00.000Z' });
    migration = stripeMigration.transition({ ...recurring, stripeMigration: migration }, stripeMigration.STATES.CUTOVER_SCHEDULED, { at: '2026-07-17T10:02:00.000Z', cutoverDate: '2026-07-24' });
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-24'), false, 'A scheduled cutover must lock automatic Clover charging.');
    migration = stripeMigration.transition({ ...recurring, stripeMigration: migration }, stripeMigration.STATES.FIRST_STRIPE_CHARGE_PENDING, { at: '2026-07-24T17:55:00.000Z', cutoverDate: '2026-07-24', cloverStoppedConfirmedAt: '2026-07-24T17:55:00.000Z' });
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: migration }, 'stripe', '2026-07-24'), true, 'A confirmed same-day cutover may allow the protected first Stripe charge.');

    const periodState = { payments: [{ id: 'paid-clover-period', recurringPaymentId: recurring.id, paymentProvider: 'clover', billingPeriodKey: 'due:2026-07-24', status: 'Paid' }] };
    assert.throws(() => stripeMigration.assertBillingPeriodOpen(periodState, recurring, '2026-07-24'), /duplicate charge/i, 'A Stripe charge must be blocked when Clover already paid the same billing period.');
    assert.strictEqual(stripeMigration.existingPaidPayment(periodState, recurring, '2026-07-24').id, 'paid-clover-period', 'Cross-provider period lookup must retain the original payment record.');

    console.log('Production foundation check passed: atomic state fallback, migration-proof guard, checksum fail-closed behavior, immutable identity preflight, encrypted private storage, tamper rejection, Star request caps, and Clover-to-Stripe duplicate protection are verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
