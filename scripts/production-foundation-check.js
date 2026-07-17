'use strict';

const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const stateRepository = require('../state-repository');
const secureDocumentStore = require('../secure-document-store');
const stripeMigration = require('../stripe-migration');
const { runCliArgumentChecks } = require('./cli-argument-check');

async function main() {
  runCliArgumentChecks();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-production-foundation-'));
  try {
    const seedFile = path.join(temp, 'seed.json');
    const dataFile = path.join(temp, 'data.json');
    await fs.writeFile(seedFile, JSON.stringify({ vehicles: [], customers: [], payments: [], documents: [], eSignatures: [] }), 'utf8');

    const repository = stateRepository.createStateRepository({ backend: 'json', dataFile, seedFile });
    const jsonAutopayLock = await repository.acquireJobLock('wheelsonauto-autopay');
    assert.strictEqual(jsonAutopayLock.acquired, true, 'The JSON development fallback should retain the in-process autopay lock contract.');
    await jsonAutopayLock.release();
    const firstJsonWebhookClaim = await repository.claimWebhookEvent('stripe', 'evt-foundation-1', { type: 'payment_intent.succeeded' });
    assert.strictEqual(firstJsonWebhookClaim.accepted, true, 'The first development webhook event should be claimable.');
    const activeJsonWebhookDuplicate = await repository.claimWebhookEvent('stripe', 'evt-foundation-1', { type: 'payment_intent.succeeded' });
    assert.strictEqual(activeJsonWebhookDuplicate.inProgress, true, 'An in-progress development webhook duplicate should not execute twice.');
    await repository.failWebhookEvent('stripe', 'evt-foundation-1', new Error('retry test'));
    assert.strictEqual((await repository.claimWebhookEvent('stripe', 'evt-foundation-1', { type: 'payment_intent.succeeded' })).accepted, true, 'A failed development webhook event should be retryable.');
    await repository.completeWebhookEvent('stripe', 'evt-foundation-1');
    assert.strictEqual((await repository.claimWebhookEvent('stripe', 'evt-foundation-1')).accepted, false, 'A completed development webhook event must remain deduplicated.');
    const idempotencyScope = 'stripe_recurring_charge';
    const idempotencyKey = 'period:rec-foundation-1:2026-07-24';
    const idempotencyRequest = { recurringPaymentId: 'rec-foundation-1', billingPeriodKey: 'due:2026-07-24', amountCents: 22900 };
    const firstJsonIdempotencyClaim = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, idempotencyRequest);
    assert.strictEqual(firstJsonIdempotencyClaim.accepted, true, 'The first local Stripe billing-period claim must be accepted.');
    const activeJsonIdempotencyDuplicate = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, idempotencyRequest);
    assert.strictEqual(activeJsonIdempotencyDuplicate.inProgress, true, 'A concurrent local Stripe billing-period claim must remain protected while the first request is processing.');
    await assert.rejects(
      () => repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 }),
      error => error && error.code === 'woa_idempotency_request_mismatch',
      'A protected Stripe billing period must reject a changed amount until the first request reaches a terminal state.'
    );
    await repository.failIdempotencyKey(idempotencyScope, idempotencyKey, new Error('controlled decline'));
    const retryJsonIdempotencyClaim = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 });
    assert.strictEqual(retryJsonIdempotencyClaim.accepted, true, 'A terminal local Stripe decline must allow a deliberate corrected retry.');
    assert.strictEqual(retryJsonIdempotencyClaim.retried, true, 'A corrected local Stripe retry must be labeled as a retry.');
    await repository.completeIdempotencyKey(idempotencyScope, idempotencyKey, { paymentIntentId: 'pi_foundation_idempotency_1', status: 'succeeded' });
    const completedJsonIdempotencyDuplicate = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 });
    assert.strictEqual(completedJsonIdempotencyDuplicate.completed, true, 'A completed local Stripe billing-period claim must be permanently deduplicated.');
    assert.strictEqual(completedJsonIdempotencyDuplicate.response.paymentIntentId, 'pi_foundation_idempotency_1', 'A completed local Stripe billing-period claim must retain its reconciliation result.');
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
    const stateBeforeJsonJobError = await fs.readFile(dataFile, 'utf8');
    await repository.recordJobError('json-fallback-monitor', new Error('Controlled JSON fallback error'), { route: 'foundation check' });
    const jsonJobErrors = await repository.recentJobErrors(5);
    assert.strictEqual(jsonJobErrors.length, 1, 'The JSON fallback must retain a bounded operational error record until PostgreSQL is enabled.');
    assert.strictEqual(jsonJobErrors[0].source, 'json-fallback-monitor', 'The JSON fallback error record must retain its source.');
    assert.strictEqual(jsonJobErrors[0].context.route, 'foundation check', 'The JSON fallback error record must retain safe context.');
    assert.strictEqual(await fs.readFile(dataFile, 'utf8'), stateBeforeJsonJobError, 'Recording a JSON fallback operational error must not rewrite business data.json.');
    assert((await fs.stat(dataFile + '.job-errors.json')).size > 0, 'The JSON fallback error log must live beside, not inside, the protected business state file.');
    const aiReservation = await repository.reserveAiUsage({ dayKey: '2026-07-17', monthKey: '2026-07', dailyLimit: 1, monthlyLimit: 2 });
    assert.strictEqual(aiReservation.allowed, true, 'The local development guard must reserve the first Star model request.');
    const aiBlocked = await repository.reserveAiUsage({ dayKey: '2026-07-17', monthKey: '2026-07', dailyLimit: 1, monthlyLimit: 2 });
    assert.strictEqual(aiBlocked.allowed, false, 'The local development guard must stop a repeated Star request at the configured daily cap.');
    assert.strictEqual(aiBlocked.reason, 'daily_limit', 'The quota guard must explain why Star fell back to rules.');

    const duplicate = { ...next, vehicles: next.vehicles.concat({ id: 'vehicle-2', vin: '1HGCM82633A004352' }) };
    assert.strictEqual(stateRepository.identityConflicts(duplicate).length, 1, 'A duplicate immutable VIN must be found before PostgreSQL migration.');
    const missingVinWarnings = stateRepository.identityWarnings({ vehicles: [{ id: 'vehicle-missing-vin', year: 2013, make: 'BMW', model: '528XI' }] });
    assert.strictEqual(missingVinWarnings.length, 1, 'A vehicle without a VIN must remain visible for owner review before Stripe cutover.');
    assert.strictEqual(missingVinWarnings[0].kind, 'vehicle_missing_vin', 'A missing VIN warning must retain a stable review category.');

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

    console.log('Production foundation check passed: atomic state fallback, durable money-action idempotency, migration-proof guard, checksum fail-closed behavior, immutable identity preflight, encrypted private storage, tamper rejection, Star request caps, durable job-lock contract, and Clover-to-Stripe duplicate protection are verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
