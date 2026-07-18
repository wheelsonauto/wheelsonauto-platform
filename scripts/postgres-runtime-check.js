'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const stateRepository = require('../state-repository');

const databaseUrl = String(process.env.WOA_TEST_DATABASE_URL || '').trim();
const confirmed = process.env.WOA_POSTGRES_RUNTIME_TEST_CONFIRM === '1';

async function removeTestRows(repository, organizationId) {
  const pool = repository.pool;
  await pool.query('DELETE FROM woa_idempotency_keys WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_identity_index WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_documents WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_job_errors WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_webhook_events WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_ai_usage WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_state WHERE organization_id = $1', [organizationId]);
}

async function main() {
  if (!databaseUrl || !confirmed) {
    console.log('PostgreSQL runtime recovery check skipped. Set WOA_TEST_DATABASE_URL and WOA_POSTGRES_RUNTIME_TEST_CONFIRM=1 to run it against a dedicated test database.');
    return;
  }
  const organizationId = 'org-postgres-runtime-test-' + crypto.randomBytes(6).toString('hex');
  const repository = stateRepository.createStateRepository({
    backend: 'postgres',
    databaseUrl,
    organizationId,
    snapshotLimit: 12,
    applicationName: 'wheelsonauto-postgres-runtime-check',
    seed: async () => ({ vehicles: [], customers: [], payments: [] })
  });
  const competingRepository = stateRepository.createStateRepository({
    backend: 'postgres',
    databaseUrl,
    organizationId,
    snapshotLimit: 12,
    applicationName: 'wheelsonauto-postgres-runtime-lock-check',
    seed: async () => ({ vehicles: [], customers: [], payments: [] })
  });
  try {
    const firstAutopayLock = await repository.acquireJobLock('wheelsonauto-autopay');
    assert.strictEqual(firstAutopayLock.acquired, true, 'The first PostgreSQL autopay worker must acquire the durable job lock.');
    const blockedAutopayLock = await competingRepository.acquireJobLock('wheelsonauto-autopay');
    assert.strictEqual(blockedAutopayLock.acquired, false, 'A second PostgreSQL worker must not run the same autopay job concurrently.');
    await firstAutopayLock.release();
    const releasedAutopayLock = await competingRepository.acquireJobLock('wheelsonauto-autopay');
    assert.strictEqual(releasedAutopayLock.acquired, true, 'The PostgreSQL autopay lock must be available to the next worker after the first worker releases it.');
    await releasedAutopayLock.release();

    const firstWebhookClaim = await repository.claimWebhookEvent('stripe', 'evt-postgres-runtime-processing', { type: 'payment_intent.succeeded' });
    assert.strictEqual(firstWebhookClaim.accepted, true, 'The first PostgreSQL webhook worker must claim the event.');
    const activeWebhookDuplicate = await competingRepository.claimWebhookEvent('stripe', 'evt-postgres-runtime-processing', { type: 'payment_intent.succeeded' });
    assert.strictEqual(activeWebhookDuplicate.accepted, false, 'A second PostgreSQL webhook worker must not process an event that is already in progress.');
    assert.strictEqual(activeWebhookDuplicate.inProgress, true, 'An in-progress PostgreSQL webhook duplicate must be identified for provider retry.');
    await repository.failWebhookEvent('stripe', 'evt-postgres-runtime-processing', new Error('controlled retry'));
    const retriedWebhookClaim = await competingRepository.claimWebhookEvent('stripe', 'evt-postgres-runtime-processing', { type: 'payment_intent.succeeded' });
    assert.strictEqual(retriedWebhookClaim.accepted, true, 'A failed PostgreSQL webhook event must be retryable.');
    await competingRepository.completeWebhookEvent('stripe', 'evt-postgres-runtime-processing');
    const completedWebhookDuplicate = await repository.claimWebhookEvent('stripe', 'evt-postgres-runtime-processing');
    assert.strictEqual(completedWebhookDuplicate.accepted, false, 'A completed PostgreSQL webhook event must remain deduplicated.');
    assert.strictEqual(completedWebhookDuplicate.inProgress, undefined, 'A completed webhook duplicate must not be mistaken for an active lease.');

    const staleWebhookEventId = 'evt-postgres-runtime-stale';
    assert.strictEqual((await repository.claimWebhookEvent('stripe', staleWebhookEventId, { type: 'payment_intent.succeeded' })).accepted, true, 'A PostgreSQL webhook event should be claimable before stale-lease recovery is tested.');
    await repository.pool.query("UPDATE woa_webhook_events SET processing_started_at = now() - interval '15 minutes' WHERE provider = 'stripe' AND event_id = $1", [staleWebhookEventId]);
    const reclaimedWebhookClaim = await competingRepository.claimWebhookEvent('stripe', staleWebhookEventId, { type: 'payment_intent.succeeded' });
    assert.strictEqual(reclaimedWebhookClaim.accepted, true, 'A PostgreSQL webhook event with an expired processing lease must be recoverable.');
    assert.strictEqual(reclaimedWebhookClaim.reclaimed, true, 'Expired PostgreSQL webhook recovery should be recorded as a reclaimed claim.');
    await competingRepository.completeWebhookEvent('stripe', staleWebhookEventId);

    const idempotencyScope = 'stripe_recurring_charge';
    const idempotencyKey = 'period:rec-postgres-runtime:2026-07-24';
    const idempotencyRequest = { recurringPaymentId: 'rec-postgres-runtime', billingPeriodKey: 'due:2026-07-24', amountCents: 22900 };
    const firstIdempotencyClaim = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, idempotencyRequest);
    assert.strictEqual(firstIdempotencyClaim.accepted, true, 'The first PostgreSQL Stripe billing-period claim must be accepted.');
    assert(firstIdempotencyClaim.claimToken, 'A PostgreSQL Stripe billing-period claim must receive a unique lease token.');
    const activeIdempotencyDuplicate = await competingRepository.claimIdempotencyKey(idempotencyScope, idempotencyKey, idempotencyRequest);
    assert.strictEqual(activeIdempotencyDuplicate.inProgress, true, 'A competing PostgreSQL worker must not charge the same billing period while the first worker is active.');
    await assert.rejects(
      () => competingRepository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 }),
      error => error && error.code === 'woa_idempotency_request_mismatch',
      'A PostgreSQL Stripe billing-period claim must reject a changed amount while the original request is protected.'
    );
    await repository.failIdempotencyKey(idempotencyScope, idempotencyKey, new Error('controlled decline'));
    assert.strictEqual(await repository.completeIdempotencyKey(idempotencyScope, idempotencyKey, { paymentIntentId: 'pi_failed_postgres_claim_must_not_settle' }, { claimToken: firstIdempotencyClaim.claimToken }), false, 'A failed PostgreSQL Stripe claim must not be converted to paid by a late worker response.');
    const retriedIdempotencyClaim = await competingRepository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 });
    assert.strictEqual(retriedIdempotencyClaim.accepted, true, 'A terminal PostgreSQL Stripe decline must permit a corrected retry.');
    assert.strictEqual(retriedIdempotencyClaim.retried, true, 'A corrected PostgreSQL Stripe retry must be marked as a retry.');
    assert.notStrictEqual(retriedIdempotencyClaim.claimToken, firstIdempotencyClaim.claimToken, 'A retried PostgreSQL Stripe billing-period claim must replace the old worker lease token.');
    assert.strictEqual(await repository.completeIdempotencyKey(idempotencyScope, idempotencyKey, { paymentIntentId: 'pi_stale_postgres_worker_must_not_win' }, { claimToken: firstIdempotencyClaim.claimToken }), false, 'A stale PostgreSQL worker must not complete a newer billing-period claim.');
    await competingRepository.completeIdempotencyKey(idempotencyScope, idempotencyKey, { paymentIntentId: 'pi_postgres_runtime_idempotency_1', status: 'succeeded' }, { claimToken: retriedIdempotencyClaim.claimToken });
    const completedIdempotencyDuplicate = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 });
    assert.strictEqual(completedIdempotencyDuplicate.completed, true, 'A completed PostgreSQL Stripe billing-period claim must remain deduplicated after a process handoff.');
    assert.strictEqual(completedIdempotencyDuplicate.response.paymentIntentId, 'pi_postgres_runtime_idempotency_1', 'A completed PostgreSQL Stripe billing-period claim must keep its reconciliation response.');

    const staleIdempotencyKey = 'period:rec-postgres-runtime-stale:2026-07-31';
    assert.strictEqual((await repository.claimIdempotencyKey(idempotencyScope, staleIdempotencyKey, idempotencyRequest)).accepted, true, 'A PostgreSQL Stripe claim should be accepted before stale-lease recovery is tested.');
    await repository.pool.query("UPDATE woa_idempotency_keys SET processing_started_at = now() - interval '15 minutes' WHERE organization_id = $1 AND scope = $2 AND key = $3", [organizationId, idempotencyScope, staleIdempotencyKey]);
    const reclaimedIdempotencyClaim = await competingRepository.claimIdempotencyKey(idempotencyScope, staleIdempotencyKey, idempotencyRequest);
    assert.strictEqual(reclaimedIdempotencyClaim.accepted, true, 'An expired PostgreSQL Stripe claim must be safely recoverable after a worker crash.');
    assert.strictEqual(reclaimedIdempotencyClaim.reclaimed, true, 'Expired PostgreSQL Stripe claim recovery must be labeled as reclaimed.');
    await competingRepository.failIdempotencyKey(idempotencyScope, staleIdempotencyKey, new Error('stale recovery cleanup'));

    const firstState = {
      vehicles: [{ id: 'vehicle-runtime-1', vin: 'RUNTIMEVIN00000001', plate: 'RUNTIME-1' }],
      customers: [{ id: 'customer-runtime-1', name: 'Version One Customer', email: 'runtime-one@example.com' }],
      payments: [],
      auditLogs: []
    };
    const firstWrite = await repository.write(firstState, { reason: 'runtime test first state', actor: 'test' });
    const firstSnapshots = await repository.listSnapshots();
    assert.strictEqual(firstSnapshots.length, 1, 'The first PostgreSQL write must create a recoverable snapshot.');
    assert.strictEqual(firstSnapshots[0].version, firstWrite.version, 'Snapshot version must match the state write version.');
    const migrationProof = await repository.recordMigrationProof({
      sourceChecksum: stateRepository.checksum(firstState),
      canonicalSourceChecksum: stateRepository.checksum(firstState),
      targetChecksum: firstWrite.checksum,
      sourceRecordCounts: stateRepository.migrationRecordCounts(firstState),
      targetRecordCounts: stateRepository.migrationRecordCounts(firstWrite.state),
      importedVersion: firstWrite.version,
      actor: 'runtime migration proof test'
    });
    assert.strictEqual(migrationProof.migrationProofReady, true, 'A matching source checksum/count proof must be recorded with the imported PostgreSQL snapshot.');

    const secondState = {
      ...firstState,
      customers: [{ ...firstState.customers[0], name: 'Version Two Customer' }],
      payments: [{ id: 'payment-runtime-1', status: 'Paid', stripePaymentIntentId: 'pi_runtime_check_1' }]
    };
    const secondWrite = await repository.write(secondState, { reason: 'runtime test changed state', actor: 'test' });
    assert(secondWrite.version > firstWrite.version, 'The second PostgreSQL write must advance the version.');

    const firstAiReservation = await repository.reserveAiUsage({ dayKey: '2026-07-17', monthKey: '2026-07', dailyLimit: 1, monthlyLimit: 2 });
    assert.strictEqual(firstAiReservation.allowed, true, 'PostgreSQL must atomically reserve the first Star model request.');
    const blockedAiReservation = await repository.reserveAiUsage({ dayKey: '2026-07-17', monthKey: '2026-07', dailyLimit: 1, monthlyLimit: 2 });
    assert.strictEqual(blockedAiReservation.allowed, false, 'PostgreSQL must reject a Star request that would exceed the daily cap.');
    assert.strictEqual(blockedAiReservation.reason, 'daily_limit', 'PostgreSQL must report the correct Star quota guard reason.');

    const restored = await repository.restoreSnapshot(firstSnapshots[0].id, {
      reason: 'runtime test controlled restore',
      actor: 'test',
      transform: state => {
        state.auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs : [];
        state.auditLogs.unshift({ id: 'audit-runtime-restore', action: 'Runtime recovery verification' });
        return state;
      }
    });
    assert(restored.version > secondWrite.version, 'A restore must create a newer state version instead of rewinding history.');
    assert.strictEqual(restored.state.customers[0].name, 'Version One Customer', 'Recovery must restore the selected snapshot state.');
    assert.strictEqual(restored.state.payments.length, 0, 'Recovery must remove records introduced after the selected snapshot.');
    assert(restored.state.auditLogs.some(row => row.action === 'Runtime recovery verification'), 'Recovery must allow an audit entry in the new restored snapshot.');
    assert.strictEqual(stateRepository.checksum(restored.state), restored.checksum, 'Recovered state checksum must verify after the transaction commits.');
    const health = await repository.health();
    assert.strictEqual(health.productionReady, true, 'A reachable PostgreSQL state repository must report production-ready.');
    assert.strictEqual(health.stateImported, true, 'A production-ready PostgreSQL repository must contain imported WheelsonAuto state.');
    assert.strictEqual(health.integrity, 'verified', 'A production-ready PostgreSQL repository must verify the stored state checksum.');
    assert.strictEqual(health.snapshotIntegrity, 'verified', 'The latest PostgreSQL recovery snapshot must verify its own checksum.');
    assert.strictEqual(health.snapshotVersionMatchesCurrent, true, 'The latest PostgreSQL recovery snapshot must match the current state version.');
    assert.strictEqual(health.snapshotChecksumMatchesCurrent, true, 'The latest PostgreSQL recovery snapshot must match the current state checksum.');
    assert.strictEqual(health.snapshotRecoveryReady, true, 'A production-ready PostgreSQL repository must expose a verified current recovery snapshot.');
    assert.strictEqual(health.migrationProofIntegrity, 'verified', 'The PostgreSQL import proof must retain the source-to-target checksum/count evidence.');
    assert.strictEqual(health.migrationProofReady, true, 'A verified PostgreSQL import proof must remain available after normal state changes and recovery.');
    console.log('PostgreSQL runtime recovery check passed: durable autopay lock, Stripe money-action idempotency, write, import proof, snapshot, restore, audit, checksum, current recovery proof, Star quota, and cleanup verified.');
  } finally {
    await removeTestRows(repository, organizationId).catch(() => {});
    await competingRepository.close();
    await repository.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
