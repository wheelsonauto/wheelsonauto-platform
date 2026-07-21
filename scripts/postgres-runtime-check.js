'use strict';

const assert = require('node:assert');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const stateRepository = require('../state-repository');

let databaseUrl = String(process.env.WOA_TEST_DATABASE_URL || '').trim();
let databaseSslMode = String(process.env.WOA_TEST_DATABASE_SSL_MODE || '').trim().toLowerCase();
let confirmed = process.env.WOA_POSTGRES_RUNTIME_TEST_CONFIRM === '1';
let ciPostgresContainer = '';
const recoveryProofRequested = process.env.WOA_POSTGRES_RUNTIME_PROOF_RECORD === '1';
const recoveryProofConfirmed = process.env.WOA_POSTGRES_RUNTIME_PROOF_CONFIRM === '1';
const recoveryProofDatabaseUrl = String(process.env.WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const recoveryProofOrganizationId = String(process.env.WOA_POSTGRES_RUNTIME_PROOF_ORGANIZATION_ID || stateRepository.DEFAULT_ORGANIZATION_ID).trim() || stateRepository.DEFAULT_ORGANIZATION_ID;
const recoveryProofSecret = String(process.env.WOA_RECOVERY_DRILL_CONFIGURATION_SECRET || process.env.WOA_SESSION_SECRET || '').trim();
const RECOVERY_DRILL_SCRIPT_VERSION = stateRepository.RECOVERY_DRILL_SCRIPT_VERSION;

function dockerCommand(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: Number(options.timeout || 120000),
    stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
  });
  if (result.error) throw new Error('GitHub PostgreSQL runtime check could not run Docker: ' + result.error.message);
  return result;
}

function stopCiPostgres() {
  if (!ciPostgresContainer) return;
  dockerCommand(['rm', '--force', ciPostgresContainer], { timeout: 30000, quiet: true });
  ciPostgresContainer = '';
}

async function waitForHostPostgres(url) {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const client = new Client({ connectionString: url, ssl: false, connectionTimeoutMillis: 3000 });
    try {
      await client.connect();
      await client.query('SELECT 1 AS ready');
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error('GitHub PostgreSQL runtime container never accepted a stable host SQL connection: ' + String(lastError && lastError.message || lastError || 'unknown error'));
}

async function startGitHubPostgres() {
  const container = 'wheelsonauto-postgres-ci-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  const started = dockerCommand([
    'run', '--detach', '--rm', '--name', container,
    '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_DB=wheelsonauto_ci',
    '--env', 'POSTGRES_USER=wheelsonauto_ci',
    '--env', 'POSTGRES_PASSWORD=wheelsonauto_ci',
    'postgres:18-alpine'
  ]);
  if (started.status !== 0) throw new Error('GitHub PostgreSQL runtime container failed to start: ' + String(started.stderr || started.stdout || '').trim());
  ciPostgresContainer = container;
  try {
    const portResult = dockerCommand(['port', container, '5432/tcp'], { timeout: 30000, quiet: true });
    if (portResult.status !== 0) throw new Error('GitHub PostgreSQL runtime container did not publish its test port.');
    const match = String(portResult.stdout || '').match(/127\.0\.0\.1:(\d+)/);
    if (!match) throw new Error('GitHub PostgreSQL runtime container returned an invalid test port.');
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const probe = dockerCommand(['exec', container, 'pg_isready', '-U', 'wheelsonauto_ci', '-d', 'wheelsonauto_ci'], { timeout: 10000, quiet: true });
      if (probe.status === 0) {
        ready = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error('GitHub PostgreSQL runtime container did not become healthy within 20 seconds.');
    databaseUrl = 'postgresql://wheelsonauto_ci:wheelsonauto_ci@127.0.0.1:' + match[1] + '/wheelsonauto_ci';
    databaseSslMode = 'disable';
    await waitForHostPostgres(databaseUrl);
    confirmed = true;
    console.log('GitHub PostgreSQL 18 runtime container is ready for transactional recovery checks.');
  } catch (error) {
    stopCiPostgres();
    throw error;
  }
}

function databaseTargetIdentity(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return [
      parsed.protocol.toLowerCase(),
      parsed.hostname.toLowerCase(),
      parsed.port,
      decodeURIComponent(parsed.pathname || '/').replace(/\/+$/, '') || '/'
    ].join('|');
  } catch {
    return raw
      .replace(/\/\/[^@/]+@/, '//')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
}

function recoveryProofUsesTestDatabase() {
  const testTarget = databaseTargetIdentity(databaseUrl);
  const proofTarget = databaseTargetIdentity(recoveryProofDatabaseUrl);
  return !!(testTarget && proofTarget && testTarget === proofTarget);
}

async function removeTestRows(repository, organizationId) {
  const pool = repository.pool;
  await pool.query('DELETE FROM woa_rate_limits WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_idempotency_keys WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_identity_index WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_active_assignments WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_resource_index WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_documents WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_job_errors WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_webhook_events WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_ai_usage WHERE organization_id = $1', [organizationId]);
  await pool.query('DELETE FROM woa_state WHERE organization_id = $1', [organizationId]);
}

async function recordRecoveryDrillProof(testOrganizationId, checks) {
  if (!recoveryProofRequested) return { recorded: false, reason: 'proof recording not requested' };
  if (!recoveryProofConfirmed) throw new Error('Set WOA_POSTGRES_RUNTIME_PROOF_CONFIRM=1 before recording a passed recovery drill against the production PostgreSQL evidence table.');
  if (!recoveryProofDatabaseUrl) throw new Error('Set WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL (or DATABASE_URL) to the production PostgreSQL database before recording recovery-drill evidence.');
  if (!recoveryProofSecret) throw new Error('Set WOA_SESSION_SECRET or WOA_RECOVERY_DRILL_CONFIGURATION_SECRET before recording recovery-drill evidence.');
  if (recoveryProofUsesTestDatabase()) throw new Error('WOA_TEST_DATABASE_URL must point to a different dedicated test database than WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL. Refusing a recovery drill that could touch production data.');
  const configurationFingerprint = stateRepository.recoveryDrillConfigurationFingerprint(recoveryProofSecret, recoveryProofDatabaseUrl, recoveryProofOrganizationId);
  const testDatabaseFingerprint = stateRepository.recoveryDrillConfigurationFingerprint(recoveryProofSecret, databaseUrl, testOrganizationId);
  if (!configurationFingerprint || !testDatabaseFingerprint) throw new Error('Recovery drill proof fingerprints could not be created. Check the protected database URLs and session secret.');
  const proofRepository = stateRepository.createStateRepository({
    backend: 'postgres',
    databaseUrl: recoveryProofDatabaseUrl,
    organizationId: recoveryProofOrganizationId,
    snapshotLimit: 12,
    applicationName: 'wheelsonauto-postgres-recovery-proof',
    seed: async () => ({})
  });
  try {
    const saved = await proofRepository.recordRecoveryDrill({
      runId: 'recovery-drill-' + new Date().toISOString().replace(/[^0-9]/g, '') + '-' + crypto.randomBytes(5).toString('hex'),
      result: 'passed',
      testDatabaseFingerprint,
      configurationFingerprint,
      checks,
      scriptVersion: RECOVERY_DRILL_SCRIPT_VERSION,
      actor: 'controlled PostgreSQL runtime recovery check'
    });
    const health = await proofRepository.health({
      recoveryDrillConfigurationFingerprint: configurationFingerprint
    });
    assert.strictEqual(saved.ready, true, 'The recorded PostgreSQL recovery drill must contain every successful test check.');
    assert.strictEqual(health.recoveryDrillReady, true, 'The production PostgreSQL recovery-drill record must be fresh and tied to the current protected database configuration.');
    assert.strictEqual(health.recoveryDrill && health.recoveryDrill.ready, true, 'PostgreSQL health must expose the verified recovery-drill evidence used by the startup gate.');
    return { recorded: true, evidence: health.recoveryDrill };
  } finally {
    await proofRepository.close();
  }
}

async function main() {
  if (!databaseUrl && process.env.GITHUB_ACTIONS === 'true') await startGitHubPostgres();
  if (databaseUrl && !confirmed && process.env.GITHUB_ACTIONS === 'true') {
    throw new Error('GitHub PostgreSQL runtime check received WOA_TEST_DATABASE_URL without WOA_POSTGRES_RUNTIME_TEST_CONFIRM=1.');
  }
  if (!databaseUrl || !confirmed) {
    console.log('PostgreSQL runtime recovery check skipped. Set WOA_TEST_DATABASE_URL and WOA_POSTGRES_RUNTIME_TEST_CONFIRM=1 to run it against a dedicated test database.');
    return;
  }
  if (recoveryProofRequested && recoveryProofUsesTestDatabase()) {
    throw new Error('WOA_TEST_DATABASE_URL must point to a different dedicated test database than WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL. Refusing a recovery drill that could touch production data.');
  }
  const organizationId = 'org-postgres-runtime-test-' + crypto.randomBytes(6).toString('hex');
  const foreignOrganizationId = 'org-postgres-runtime-foreign-' + crypto.randomBytes(6).toString('hex');
  const rateLimitSecret = 'postgres-runtime-rate-limit-secret';
  const repository = stateRepository.createStateRepository({
    backend: 'postgres',
    databaseUrl,
    sslMode: databaseSslMode,
    organizationId,
    snapshotLimit: 12,
    rateLimitSecret,
    applicationName: 'wheelsonauto-postgres-runtime-check',
    seed: async () => ({ vehicles: [], customers: [], payments: [] })
  });
  const competingRepository = stateRepository.createStateRepository({
    backend: 'postgres',
    databaseUrl,
    sslMode: databaseSslMode,
    organizationId,
    snapshotLimit: 12,
    rateLimitSecret,
    applicationName: 'wheelsonauto-postgres-runtime-lock-check',
    seed: async () => ({ vehicles: [], customers: [], payments: [] })
  });
  const foreignRepository = stateRepository.createStateRepository({
    backend: 'postgres',
    databaseUrl,
    sslMode: databaseSslMode,
    organizationId: foreignOrganizationId,
    snapshotLimit: 12,
    rateLimitSecret,
    applicationName: 'wheelsonauto-postgres-runtime-foreign-tenant-check',
    seed: async () => ({ vehicles: [], customers: [], payments: [] })
  });
  try {
    await Promise.all([
      repository.ensureSchema(),
      competingRepository.ensureSchema(),
      foreignRepository.ensureSchema()
    ]);
    const schemaMigrationRows = await repository.pool.query('SELECT id FROM woa_schema_migrations ORDER BY id');
    const recordedMigrationIds = new Set(schemaMigrationRows.rows.map(row => String(row.id || '')));
    const missingMigrationIds = stateRepository.REQUIRED_SCHEMA_MIGRATION_IDS.filter(id => !recordedMigrationIds.has(id));
    assert.deepStrictEqual(missingMigrationIds, [], 'Concurrent PostgreSQL startups must complete every exact required schema migration before recovery evidence can be recorded.');

    const firstAutopayLock = await repository.acquireJobLock('wheelsonauto-autopay');
    assert.strictEqual(firstAutopayLock.acquired, true, 'The first PostgreSQL autopay worker must acquire the durable job lock.');
    const blockedAutopayLock = await competingRepository.acquireJobLock('wheelsonauto-autopay');
    assert.strictEqual(blockedAutopayLock.acquired, false, 'A second PostgreSQL worker must not run the same autopay job concurrently.');
    await firstAutopayLock.release();
    const releasedAutopayLock = await competingRepository.acquireJobLock('wheelsonauto-autopay');
    assert.strictEqual(releasedAutopayLock.acquired, true, 'The PostgreSQL autopay lock must be available to the next worker after the first worker releases it.');
    await releasedAutopayLock.release();

    const rateLimitKey = 'staff|198.51.100.25|runtime-owner';
    assert.strictEqual((await repository.consumeRateLimit('login-failure', rateLimitKey, 2, 10 * 60 * 1000)).allowed, true, 'The first PostgreSQL login failure must consume the durable shared throttle.');
    assert.strictEqual((await competingRepository.consumeRateLimit('login-failure', rateLimitKey, 2, 10 * 60 * 1000)).allowed, true, 'A second worker must atomically consume the configured final login attempt.');
    const blockedSharedRateLimit = await repository.checkRateLimit('login-failure', rateLimitKey, 2, 10 * 60 * 1000);
    assert.strictEqual(blockedSharedRateLimit.allowed, false, 'The PostgreSQL throttle must block across competing workers after the configured limit.');
    assert(blockedSharedRateLimit.retryAfterSeconds > 0, 'The durable PostgreSQL throttle must return retry guidance.');
    const storedRateLimit = await repository.pool.query('SELECT key_hash FROM woa_rate_limits WHERE organization_id = $1 AND scope = $2', [organizationId, 'login-failure']);
    assert.strictEqual(storedRateLimit.rowCount, 1, 'The durable throttle must keep one tenant-scoped counter for the login identity.');
    assert(/^[a-f0-9]{64}$/.test(String(storedRateLimit.rows[0].key_hash || '')), 'The durable throttle must store only an HMAC identity instead of a raw IP address or username.');
    assert(!JSON.stringify(storedRateLimit.rows[0]).includes('198.51.100.25') && !JSON.stringify(storedRateLimit.rows[0]).includes('runtime-owner'), 'The PostgreSQL throttle row must not expose raw login identity details.');
    const rateLimitRestartRepository = stateRepository.createStateRepository({
      backend: 'postgres',
      databaseUrl,
      sslMode: databaseSslMode,
      organizationId,
      snapshotLimit: 12,
      rateLimitSecret,
      applicationName: 'wheelsonauto-postgres-runtime-rate-limit-restart',
      seed: async () => ({ vehicles: [], customers: [], payments: [] })
    });
    try {
      assert.strictEqual((await rateLimitRestartRepository.checkRateLimit('login-failure', rateLimitKey, 2, 10 * 60 * 1000)).allowed, false, 'A new server process must retain the PostgreSQL login throttle after restart.');
    } finally {
      await rateLimitRestartRepository.close();
    }
    await competingRepository.clearRateLimit('login-failure', rateLimitKey);
    assert.strictEqual((await repository.checkRateLimit('login-failure', rateLimitKey, 2, 10 * 60 * 1000)).allowed, true, 'A successful login from any worker must clear the durable shared failure throttle.');

    const firstWebhookClaim = await repository.claimWebhookEvent('stripe', 'evt-postgres-runtime-processing', { type: 'payment_intent.succeeded' });
    assert.strictEqual(firstWebhookClaim.accepted, true, 'The first PostgreSQL webhook worker must claim the event.');
    const activeWebhookDuplicate = await competingRepository.claimWebhookEvent('stripe', 'evt-postgres-runtime-processing', { type: 'payment_intent.succeeded' });
    assert.strictEqual(activeWebhookDuplicate.accepted, false, 'A second PostgreSQL webhook worker must not process an event that is already in progress.');
    assert.strictEqual(activeWebhookDuplicate.inProgress, true, 'An in-progress PostgreSQL webhook duplicate must be identified for provider retry.');
    await repository.failWebhookEvent('stripe', 'evt-postgres-runtime-processing', new Error('controlled retry'), { claimToken: firstWebhookClaim.claimToken });
    const retriedWebhookClaim = await competingRepository.claimWebhookEvent('stripe', 'evt-postgres-runtime-processing', { type: 'payment_intent.succeeded' });
    assert.strictEqual(retriedWebhookClaim.accepted, true, 'A failed PostgreSQL webhook event must be retryable.');
    assert.notStrictEqual(retriedWebhookClaim.claimToken, firstWebhookClaim.claimToken, 'A retried PostgreSQL webhook must replace the previous worker lease token.');
    assert.strictEqual(await repository.completeWebhookEvent('stripe', 'evt-postgres-runtime-processing', { claimToken: firstWebhookClaim.claimToken }), false, 'A stale PostgreSQL webhook worker must not complete the retried worker claim.');
    await competingRepository.completeWebhookEvent('stripe', 'evt-postgres-runtime-processing', { claimToken: retriedWebhookClaim.claimToken });
    const completedWebhookDuplicate = await repository.claimWebhookEvent('stripe', 'evt-postgres-runtime-processing');
    assert.strictEqual(completedWebhookDuplicate.accepted, false, 'A completed PostgreSQL webhook event must remain deduplicated.');
    assert.strictEqual(completedWebhookDuplicate.inProgress, undefined, 'A completed webhook duplicate must not be mistaken for an active lease.');

    const staleWebhookEventId = 'evt-postgres-runtime-stale';
    const staleOriginalWebhookClaim = await repository.claimWebhookEvent('stripe', staleWebhookEventId, { type: 'payment_intent.succeeded' });
    assert.strictEqual(staleOriginalWebhookClaim.accepted, true, 'A PostgreSQL webhook event should be claimable before stale-lease recovery is tested.');
    await repository.pool.query("UPDATE woa_webhook_events SET processing_started_at = now() - interval '15 minutes' WHERE organization_id = $1 AND provider = 'stripe' AND event_id = $2", [organizationId, staleWebhookEventId]);
    const listedStaleWebhooks = await repository.listRecoverableWebhookEvents('stripe', { staleAfterMs: 30 * 1000, retryAfterMs: 0 });
    assert(listedStaleWebhooks.some(event => event.eventId === staleWebhookEventId), 'The PostgreSQL recovery inbox must list a stale webhook lease before a worker reclaims it.');
    const reclaimedWebhookClaim = await competingRepository.claimWebhookEvent('stripe', staleWebhookEventId, { type: 'payment_intent.succeeded' });
    assert.strictEqual(reclaimedWebhookClaim.accepted, true, 'A PostgreSQL webhook event with an expired processing lease must be recoverable.');
    assert.strictEqual(reclaimedWebhookClaim.reclaimed, true, 'Expired PostgreSQL webhook recovery should be recorded as a reclaimed claim.');
    assert(reclaimedWebhookClaim.claimToken && reclaimedWebhookClaim.claimToken !== staleOriginalWebhookClaim.claimToken, 'A recovered PostgreSQL webhook must receive a new ownership token.');
    assert.strictEqual(await repository.failWebhookEvent('stripe', staleWebhookEventId, new Error('stale worker must lose'), { claimToken: staleOriginalWebhookClaim.claimToken }), false, 'An expired webhook worker must not fail the new owner claim.');
    const beforeStaleWebhookCommit = await repository.read();
    await assert.rejects(
      () => repository.write({ ...beforeStaleWebhookCommit.state, staleWebhookWorkerCommitProof: 'must-not-commit' }, {
        reason: 'stale webhook ownership rollback proof',
        transactionEffects: { webhookCompletions: [{ provider: 'stripe', eventId: staleWebhookEventId, claimToken: staleOriginalWebhookClaim.claimToken }] }
      }),
      error => error && error.code === 'woa_webhook_claim_not_owned',
      'A stale webhook worker must not commit authoritative state after another server reclaims the event.'
    );
    const afterStaleWebhookCommit = await repository.read();
    assert.strictEqual(afterStaleWebhookCommit.version, beforeStaleWebhookCommit.version, 'A stale webhook ownership failure must roll back the state version.');
    assert.strictEqual(afterStaleWebhookCommit.state.staleWebhookWorkerCommitProof, undefined, 'A stale webhook worker must not leak state after its transaction rolls back.');
    await competingRepository.completeWebhookEvent('stripe', staleWebhookEventId, { claimToken: reclaimedWebhookClaim.claimToken });

    const telnyxRecoveryEventId = 'telnyx:evt-postgres-runtime-recovery';
    const telnyxRecoveryEnvelope = { data: { id: 'evt-postgres-runtime-recovery', event_type: 'message.received', payload: { text: 'Durable recovery proof' } } };
    const telnyxInitialClaim = await repository.claimWebhookEvent('messaging:telnyx', telnyxRecoveryEventId, { type: 'message.received', event: telnyxRecoveryEnvelope });
    await repository.failWebhookEvent('messaging:telnyx', telnyxRecoveryEventId, new Error('controlled Telnyx recovery'), { claimToken: telnyxInitialClaim.claimToken });
    const listedFailedTelnyxWebhooks = await competingRepository.listRecoverableWebhookEvents('messaging:telnyx', { retryAfterMs: 0, now: Date.now() + 1000 });
    const listedTelnyxRecovery = listedFailedTelnyxWebhooks.find(event => event.eventId === telnyxRecoveryEventId);
    assert(listedTelnyxRecovery, 'A failed PostgreSQL Telnyx webhook must be discoverable by another server instance.');
    assert.strictEqual(listedTelnyxRecovery.payload.event.data.id, 'evt-postgres-runtime-recovery', 'PostgreSQL must retain the exact Telnyx event envelope needed after a restart.');
    const telnyxRecoveredClaim = await competingRepository.claimWebhookEvent('messaging:telnyx', telnyxRecoveryEventId, listedTelnyxRecovery.payload);
    assert.strictEqual(telnyxRecoveredClaim.accepted, true, 'A recovery worker must atomically reclaim a failed Telnyx event.');
    await competingRepository.completeWebhookEvent('messaging:telnyx', telnyxRecoveryEventId, { claimToken: telnyxRecoveredClaim.claimToken });

    const atomicWebhookEventId = 'evt-postgres-runtime-atomic-state';
    const atomicIdempotencyScope = 'stripe_recurring_charge';
    const atomicIdempotencyKey = 'period:rec-postgres-runtime-atomic:2026-07-25';
    const atomicWebhookClaim = await repository.claimWebhookEvent('stripe', atomicWebhookEventId, { type: 'payment_intent.succeeded' });
    await repository.claimIdempotencyKey(atomicIdempotencyScope, atomicIdempotencyKey, { recurringPaymentId: 'rec-postgres-runtime-atomic', amountCents: 22900 });
    const beforeAtomicWrite = await repository.read();
    const atomicState = { ...beforeAtomicWrite.state, atomicProviderCommitProof: 'committed' };
    await repository.write(atomicState, {
      reason: 'PostgreSQL provider transaction proof',
      transactionEffects: {
        webhookCompletions: [{ provider: 'stripe', eventId: atomicWebhookEventId, claimToken: atomicWebhookClaim.claimToken }],
        idempotencySettlements: [{ action: 'complete', scope: atomicIdempotencyScope, key: atomicIdempotencyKey, providerAuthoritative: true, response: { paymentIntentId: 'pi-postgres-runtime-atomic' } }]
      }
    });
    const atomicProviderRows = await repository.pool.query(`SELECT
      (SELECT status FROM woa_webhook_events WHERE organization_id = $1 AND provider = 'stripe' AND event_id = $2) AS webhook_status,
      (SELECT status FROM woa_idempotency_keys WHERE organization_id = $1 AND scope = $3 AND key = $4) AS idempotency_status`, [organizationId, atomicWebhookEventId, atomicIdempotencyScope, atomicIdempotencyKey]);
    assert.strictEqual(atomicProviderRows.rows[0].webhook_status, 'processed', 'The PostgreSQL state transaction must complete its webhook claim.');
    assert.strictEqual(atomicProviderRows.rows[0].idempotency_status, 'completed', 'The PostgreSQL state transaction must settle its Stripe billing-period claim.');
    assert.strictEqual((await repository.read()).state.atomicProviderCommitProof, 'committed', 'The authoritative state must commit with its provider ledger effects.');

    const beforeRejectedAtomicWrite = await repository.read();
    await assert.rejects(
      () => repository.write({ ...beforeRejectedAtomicWrite.state, atomicProviderRollbackProof: 'must-not-commit' }, {
        reason: 'PostgreSQL provider rollback proof',
        transactionEffects: { webhookCompletions: [{ provider: 'stripe', eventId: 'evt-postgres-runtime-missing-claim', claimToken: 'missing-webhook-claim-token' }] }
      }),
      /durable webhook claim was missing/i,
      'A state write must roll back when its claimed webhook cannot be completed in the same transaction.'
    );
    const afterRejectedAtomicWrite = await repository.read();
    assert.strictEqual(afterRejectedAtomicWrite.version, beforeRejectedAtomicWrite.version, 'A failed provider ledger effect must roll back the state version and snapshot write.');
    assert.strictEqual(afterRejectedAtomicWrite.state.atomicProviderRollbackProof, undefined, 'A failed provider ledger effect must not leak an uncommitted state mutation.');

    const foreignWebhookEventId = 'evt-postgres-runtime-processing';
    await repository.pool.query(`INSERT INTO woa_webhook_events (
      provider, event_id, organization_id, status, payload, attempts, claim_token, processing_started_at
    ) VALUES ('stripe', $1, $2, 'processing', '{}'::jsonb, 1, $3, now())`, [foreignWebhookEventId, foreignOrganizationId, 'foreign-company-webhook-token']);
    const sameProviderEventAcrossCompanies = await repository.pool.query('SELECT organization_id FROM woa_webhook_events WHERE provider = $1 AND event_id = $2 ORDER BY organization_id', ['stripe', foreignWebhookEventId]);
    assert.strictEqual(sameProviderEventAcrossCompanies.rowCount, 2, 'The same provider event id must remain independently unique inside each company instead of colliding across franchise accounts.');
    await repository.completeWebhookEvent('stripe', foreignWebhookEventId, { claimToken: 'foreign-company-webhook-token' });
    await repository.failWebhookEvent('stripe', foreignWebhookEventId, new Error('must not cross tenant boundary'), { claimToken: 'foreign-company-webhook-token' });
    const foreignWebhook = await repository.pool.query('SELECT status, last_error FROM woa_webhook_events WHERE organization_id = $1 AND provider = $2 AND event_id = $3', [foreignOrganizationId, 'stripe', foreignWebhookEventId]);
    assert.strictEqual(foreignWebhook.rows[0].status, 'processing', 'One company repository must not complete another company webhook event.');
    assert.strictEqual(foreignWebhook.rows[0].last_error, '', 'One company repository must not write an error into another company webhook event.');

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

    const paidProviderScope = 'telnyx_paid_campaign_submission';
    const paidProviderFingerprint = 'a'.repeat(64);
    const paidProviderRequest = { provider: 'telnyx', action: '10dlc_campaign_submission', fingerprint: paidProviderFingerprint, reviewFeeCents: 1500 };
    const paidProviderClaim = await repository.claimIdempotencyKey(paidProviderScope, paidProviderFingerprint, paidProviderRequest, { holdClaimUntilSettled: true });
    assert.strictEqual(paidProviderClaim.accepted, true, 'The first paid provider action must acquire a durable PostgreSQL claim.');
    await repository.pool.query("UPDATE woa_idempotency_keys SET processing_started_at = now() - interval '15 minutes' WHERE organization_id = $1 AND scope = $2 AND key = $3", [organizationId, paidProviderScope, paidProviderFingerprint]);
    const paidProviderDuplicate = await competingRepository.claimIdempotencyKey(paidProviderScope, paidProviderFingerprint, paidProviderRequest, { holdClaimUntilSettled: true });
    assert.strictEqual(paidProviderDuplicate.inProgress, true, 'A paid provider action with an uncertain result must remain blocked after the normal processing lease instead of being retried.');
    assert.strictEqual(await competingRepository.completeIdempotencyKey(paidProviderScope, paidProviderFingerprint, { status: 'submitted' }, { claimToken: 'wrong-paid-provider-token' }), false, 'A competing worker must not settle a paid provider action it does not own.');
    assert.strictEqual(await repository.completeIdempotencyKey(paidProviderScope, paidProviderFingerprint, { status: 'submitted' }, { claimToken: paidProviderClaim.claimToken }), true, 'The owning worker must permanently settle the paid provider action.');
    const paidProviderCompleted = await competingRepository.claimIdempotencyKey(paidProviderScope, paidProviderFingerprint, paidProviderRequest, { holdClaimUntilSettled: true });
    assert.strictEqual(paidProviderCompleted.completed, true, 'A paid provider action must remain deduplicated across processes after settlement.');
    assert.strictEqual(paidProviderCompleted.response.status, 'submitted', 'The durable paid-provider claim must retain its final reconciliation state.');

    const firstState = {
      vehicles: [{ id: 'vehicle-runtime-1', vin: 'RUNTIMEVIN00000001', plate: 'RUNTIME-1', status: 'Rented', currentCustomer: 'Version One Customer' }],
      customers: [{ id: 'customer-runtime-1', name: 'Version One Customer', email: 'runtime-one@example.com', vehicleId: 'vehicle-runtime-1', status: 'Active' }],
      contracts: [{ id: 'file-runtime-1', customer: 'Version One Customer', vehicleId: 'vehicle-runtime-1', status: 'Active' }],
      payments: [],
      documents: [{
        id: 'document-runtime-1',
        customer: 'Version One Customer',
        storageProvider: 's3',
        storageKey: 'documents/' + organizationId + '/document-runtime-1.enc',
        contentType: 'application/pdf',
        sha256: 'a'.repeat(64),
        encryption: { algorithm: 'AES-256-GCM', keyVersion: 'v1' }
      }],
      auditLogs: []
    };
    const firstWrite = await repository.write(firstState, { reason: 'runtime test first state', actor: 'test' });
    const firstResourceIndex = await repository.pool.query('SELECT resource_type, resource_id FROM woa_resource_index WHERE organization_id = $1 ORDER BY resource_type, resource_id', [organizationId]);
    assert.strictEqual(firstResourceIndex.rowCount, stateRepository.criticalResourceIndexRows(firstState).length, 'A PostgreSQL state write must transactionally synchronize every critical resource id.');
    const firstAssignmentIndex = await repository.pool.query('SELECT vehicle_id, customer_name, source_refs FROM woa_active_assignments WHERE organization_id = $1', [organizationId]);
    assert.strictEqual(firstAssignmentIndex.rowCount, 1, 'A PostgreSQL state write must create one authoritative active assignment for the rented vehicle.');
    assert.strictEqual(firstAssignmentIndex.rows[0].customer_name, 'Version One Customer', 'The transactional assignment index must retain the active customer name.');
    const firstDocumentMetadata = await repository.pool.query('SELECT organization_id, customer, object_key FROM woa_documents WHERE organization_id = $1 AND id = $2', [organizationId, 'document-runtime-1']);
    assert.strictEqual(firstDocumentMetadata.rowCount, 1, 'A PostgreSQL state write must transactionally synchronize private document metadata.');
    assert.strictEqual(firstDocumentMetadata.rows[0].customer, 'Version One Customer', 'Private document metadata must retain its customer owner.');
    await foreignRepository.write({
      vehicles: [],
      customers: [{ id: 'customer-runtime-foreign', name: 'Foreign Tenant Customer', status: 'Active' }],
      payments: [],
      documents: [{
        id: 'document-runtime-1',
        customer: 'Foreign Tenant Customer',
        storageProvider: 's3',
        storageKey: 'documents/' + foreignOrganizationId + '/document-runtime-1.enc',
        contentType: 'application/pdf',
        sha256: 'b'.repeat(64),
        encryption: { algorithm: 'AES-256-GCM', keyVersion: 'v1' }
      }]
    }, { reason: 'runtime cross-company document identity test', actor: 'test' });
    const sameDocumentIdAcrossCompanies = await repository.pool.query('SELECT organization_id, customer FROM woa_documents WHERE id = $1 ORDER BY organization_id', ['document-runtime-1']);
    assert.strictEqual(sameDocumentIdAcrossCompanies.rowCount, 2, 'The same local document id must be independently usable by two franchise companies.');
    assert.deepStrictEqual(sameDocumentIdAcrossCompanies.rows.map(row => row.organization_id), [foreignOrganizationId, organizationId].sort(), 'Cross-company document rows must retain separate company ownership.');
    assert.deepStrictEqual(new Set(sameDocumentIdAcrossCompanies.rows.map(row => row.customer)), new Set(['Version One Customer', 'Foreign Tenant Customer']), 'Cross-company document rows must retain separate customer ownership.');
    const firstSnapshots = await repository.listSnapshots();
    const firstWriteSnapshot = firstSnapshots.find(snapshot => snapshot.version === firstWrite.version);
    assert(firstWriteSnapshot, 'The PostgreSQL state write must create a recoverable snapshot for its exact version.');
    const migrationProof = await repository.recordMigrationProof({
      sourceChecksum: stateRepository.checksum(firstState),
      canonicalSourceChecksum: stateRepository.checksum(firstState),
      targetChecksum: firstWrite.checksum,
      sourceRecordCounts: stateRepository.migrationRecordCounts(firstState),
      targetRecordCounts: stateRepository.migrationRecordCounts(firstWrite.state),
      importedVersion: firstWrite.version,
      sourceProvenance: {
        version: 2,
        sourceOrigin: 'render-live-disk',
        renderServiceId: 'srv-postgres-runtime-proof',
        preparedAt: new Date().toISOString(),
        sourceFileChecksum: '1'.repeat(64),
        protectedCopyChecksum: '2'.repeat(64),
        manifestChecksum: '3'.repeat(64),
        signatureChecksum: '4'.repeat(64)
      },
      actor: 'runtime migration proof test'
    });
    assert.strictEqual(migrationProof.migrationProofReady, true, 'A matching source checksum/count proof must be recorded with the imported PostgreSQL snapshot.');

    const stateBeforeConflict = await repository.read();
    await assert.rejects(
      () => repository.write({
        ...firstState,
        customers: firstState.customers.concat({ id: 'customer-runtime-conflict', name: 'Different Runtime Customer', vehicleId: 'vehicle-runtime-1', status: 'Active' })
      }, { reason: 'runtime conflict must roll back', actor: 'test' }),
      error => error && error.code === 'woa_assignment_identity_conflict',
      'A conflicting active vehicle owner must roll back the whole PostgreSQL state transaction.'
    );
    const stateAfterConflict = await repository.read();
    assert.strictEqual(stateAfterConflict.version, stateBeforeConflict.version, 'A rejected assignment conflict must not advance the authoritative state version.');
    assert.strictEqual(stateAfterConflict.checksum, stateBeforeConflict.checksum, 'A rejected assignment conflict must leave the authoritative state checksum unchanged.');
    const assignmentAfterConflict = await repository.pool.query('SELECT customer_name FROM woa_active_assignments WHERE organization_id = $1 AND vehicle_id = $2', [organizationId, 'vehicle-runtime-1']);
    assert.strictEqual(assignmentAfterConflict.rows[0].customer_name, 'Version One Customer', 'A rejected assignment conflict must preserve the last known-good assignment index.');

    const secondState = {
      ...firstState,
      customers: [{ ...firstState.customers[0], name: 'Version Two Customer' }],
      payments: [{ id: 'payment-runtime-1', status: 'Paid', stripePaymentIntentId: 'pi_runtime_check_1' }],
      documents: []
    };
    const secondWrite = await repository.write(secondState, { reason: 'runtime test changed state', actor: 'test' });
    assert(secondWrite.version > firstWrite.version, 'The second PostgreSQL write must advance the version.');
    const removedDocumentMetadata = await repository.pool.query('SELECT id FROM woa_documents WHERE organization_id = $1 AND id = $2', [organizationId, 'document-runtime-1']);
    assert.strictEqual(removedDocumentMetadata.rowCount, 0, 'Removing a private document from authoritative state must purge its metadata in the same transaction.');

    await repository.recordJobError('postgres-runtime-monitor', new Error('Controlled runtime job failure'), { route: 'runtime check', source: 'startup' });
    await repository.recordJobError('postgres-runtime-monitor', new Error('Controlled runtime job failure'), { route: 'runtime check', source: 'background' });
    const openRuntimeErrors = await repository.recentJobErrors(5);
    const runtimeJobError = openRuntimeErrors.find(row => row.source === 'postgres-runtime-monitor');
    assert(runtimeJobError && runtimeJobError.id, 'PostgreSQL must retain a durable open job failure for owner review.');
    assert.strictEqual(runtimeJobError.occurrenceCount, 2, 'Repeated PostgreSQL failures must coalesce into one actionable incident with an occurrence count.');
    const postgresAlertBase = Date.parse('2026-07-21T12:00:00.000Z');
    const firstPostgresAlertClaim = await repository.claimJobErrorAlert(runtimeJobError.id, 6 * 60 * 60 * 1000, postgresAlertBase);
    assert.strictEqual(firstPostgresAlertClaim.claimed, true, 'PostgreSQL must atomically claim the first owner alert for an open incident.');
    assert.strictEqual((await repository.claimJobErrorAlert(runtimeJobError.id, 6 * 60 * 60 * 1000, postgresAlertBase + 60 * 60 * 1000)).claimed, false, 'PostgreSQL must suppress the same owner alert across workers and restarts inside the reminder window.');
    assert.strictEqual(await repository.releaseJobErrorAlert(runtimeJobError.id, firstPostgresAlertClaim.claimedAt), true, 'A failed provider send must atomically release the exact PostgreSQL alert claim.');
    assert.strictEqual((await repository.claimJobErrorAlert(runtimeJobError.id, 6 * 60 * 60 * 1000, postgresAlertBase + 60 * 60 * 1000)).claimed, true, 'A released PostgreSQL alert claim must permit a safe provider retry.');
    const resolvedRuntimeError = await repository.resolveJobError(runtimeJobError.id, { resolvedBy: 'runtime owner', note: 'Controlled PostgreSQL review completed' });
    assert(resolvedRuntimeError && resolvedRuntimeError.resolvedAt && resolvedRuntimeError.resolvedBy === 'runtime owner', 'PostgreSQL must retain durable job-error review evidence.');
    assert.strictEqual(resolvedRuntimeError.occurrenceCount, 2, 'Resolving a grouped PostgreSQL incident must retain its total occurrence count.');
    assert.strictEqual(resolvedRuntimeError.resolutionNote, 'Controlled PostgreSQL review completed', 'PostgreSQL must retain the controlled resolution note.');
    assert.strictEqual((await repository.recentJobErrors(5)).some(row => row.id === runtimeJobError.id), false, 'A reviewed PostgreSQL job error must leave the open launch queue.');
    assert.strictEqual(await repository.resolveJobError(runtimeJobError.id, { resolvedBy: 'runtime owner' }), null, 'PostgreSQL must not resolve the same error twice.');

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
    assert.strictEqual(restored.state.documents.length, 1, 'Recovery must restore the selected snapshot private-document record.');
    assert(restored.state.auditLogs.some(row => row.action === 'Runtime recovery verification'), 'Recovery must allow an audit entry in the new restored snapshot.');
    assert.strictEqual(stateRepository.checksum(restored.state), restored.checksum, 'Recovered state checksum must verify after the transaction commits.');
    assert(restored.recoveryHistoryEvent && restored.recoveryHistoryEvent.eventType === 'snapshot_restore', 'A controlled snapshot restore must append its durable recovery-history event in the same PostgreSQL transaction.');
    const snapshotRecoveryHistory = await repository.listRecoveryHistory(20);
    assert(snapshotRecoveryHistory.some(row => row.eventId === restored.recoveryHistoryEvent.eventId && row.sourceSnapshotId === firstSnapshots[0].id && row.targetVersion === restored.version), 'PostgreSQL recovery history must retain the selected snapshot and committed target version.');
    const offsiteRecoveryEvent = {
      eventType: 'encrypted_offsite_restore',
      eventId: 'runtime-encrypted-backup-history',
      sourceVersion: 8,
      sourceChecksum: stateRepository.checksum(firstState),
      result: 'completed',
      actor: 'runtime recovery owner',
      details: { accessControlPreserved: true, sessionsRevoked: true }
    };
    const offsiteHistoryWrite = await repository.write(restored.state, {
      reason: 'runtime encrypted recovery history proof',
      actor: 'runtime recovery owner',
      recoveryEvent: offsiteRecoveryEvent
    });
    assert(offsiteHistoryWrite.recoveryHistoryEvent && offsiteHistoryWrite.recoveryHistoryEvent.eventId === offsiteRecoveryEvent.eventId, 'A transactional state write must return its committed recovery-history identity.');
    const beforeDuplicateRecoveryWrite = await repository.read();
    await assert.rejects(
      () => repository.write(offsiteHistoryWrite.state, {
        reason: 'duplicate runtime recovery event must roll back',
        actor: 'runtime recovery owner',
        recoveryEvent: offsiteRecoveryEvent
      }),
      error => error && error.code === '23505',
      'A reused PostgreSQL recovery event identity must fail closed at the database unique constraint.'
    );
    const afterDuplicateRecoveryWrite = await repository.read();
    assert.strictEqual(afterDuplicateRecoveryWrite.version, beforeDuplicateRecoveryWrite.version, 'A duplicate recovery-history event must roll back the authoritative state version.');
    assert.strictEqual(afterDuplicateRecoveryWrite.checksum, beforeDuplicateRecoveryWrite.checksum, 'A duplicate recovery-history event must roll back the authoritative state checksum.');
    const recoveryChecks = Object.fromEntries(stateRepository.RECOVERY_DRILL_REQUIRED_CHECKS.map(check => [check, true]));
    const recoveryConfigurationFingerprint = stateRepository.recoveryDrillConfigurationFingerprint('runtime-recovery-history-secret', databaseUrl, organizationId);
    const recoveryTestFingerprint = stateRepository.recoveryDrillConfigurationFingerprint('runtime-recovery-history-secret', databaseUrl, organizationId + '-drill');
    for (const runId of ['runtime-recovery-drill-1', 'runtime-recovery-drill-2']) {
      const savedDrill = await repository.recordRecoveryDrill({
        runId,
        result: 'passed',
        testDatabaseFingerprint: recoveryTestFingerprint,
        configurationFingerprint: recoveryConfigurationFingerprint,
        checks: recoveryChecks,
        scriptVersion: stateRepository.RECOVERY_DRILL_SCRIPT_VERSION,
        actor: 'runtime recovery owner'
      });
      assert.strictEqual(savedDrill.ready, true, 'Every controlled runtime recovery drill must satisfy the current recovery contract before it is recorded.');
    }
    const durableRecoveryHistory = await repository.listRecoveryHistory(20);
    assert(durableRecoveryHistory.some(row => row.eventType === 'snapshot_restore'), 'Recovery history must retain snapshot restores.');
    assert(durableRecoveryHistory.some(row => row.eventType === 'encrypted_offsite_restore'), 'Recovery history must retain encrypted offsite restores.');
    assert(durableRecoveryHistory.some(row => row.eventType === 'recovery_drill' && row.eventId === 'runtime-recovery-drill-1'), 'Recording a newer recovery drill must not overwrite the previous drill history.');
    assert(durableRecoveryHistory.some(row => row.eventType === 'recovery_drill' && row.eventId === 'runtime-recovery-drill-2'), 'Recovery history must retain the latest recovery drill as a separate immutable event.');
    const restoredDocumentMetadata = await repository.pool.query('SELECT id FROM woa_documents WHERE organization_id = $1 AND id = $2', [organizationId, 'document-runtime-1']);
    assert.strictEqual(restoredDocumentMetadata.rowCount, 1, 'Controlled snapshot recovery must transactionally restore private-document metadata.');
    const restartedRepository = stateRepository.createStateRepository({
      backend: 'postgres',
      databaseUrl,
      sslMode: databaseSslMode,
      organizationId,
      snapshotLimit: 12,
      applicationName: 'wheelsonauto-postgres-runtime-restart-check',
      seed: async () => ({ vehicles: [], customers: [], payments: [] })
    });
    try {
      const restarted = await restartedRepository.read();
      assert.strictEqual(restarted.version, offsiteHistoryWrite.version, 'A new PostgreSQL repository after a simulated server restart must read the latest recovered version.');
      assert.strictEqual(restarted.checksum, offsiteHistoryWrite.checksum, 'A new PostgreSQL repository after a simulated server restart must verify the latest recovered checksum.');
      assert.strictEqual(restarted.state.customers[0].name, 'Version One Customer', 'A server restart must retain the restored customer state.');
    } finally {
      await restartedRepository.close();
    }
    const health = await repository.health();
    const readiness = await repository.readiness();
    assert.strictEqual(readiness.connected, true, 'The lightweight PostgreSQL deployment probe must confirm database connectivity.');
    assert.strictEqual(readiness.stateAvailable, true, 'The lightweight PostgreSQL deployment probe must confirm the imported organization state without loading the full JSON document.');
    assert.strictEqual(health.productionReady, true, 'A reachable PostgreSQL state repository must report production-ready.');
    assert.strictEqual(health.schemaContractReady, true, 'A production-ready PostgreSQL repository must verify every required tenant key, uniqueness constraint, and safety index.');
    assert.deepStrictEqual(health.schemaContract.missingMigrations, [], 'PostgreSQL health must expose no missing required schema migrations.');
    assert.deepStrictEqual(health.schemaContract.missingConstraints, [], 'PostgreSQL health must expose no missing required uniqueness or tenant constraints.');
    assert.deepStrictEqual(health.schemaContract.missingIndexes, [], 'PostgreSQL health must expose no missing partial safety indexes.');
    assert.strictEqual(health.stateImported, true, 'A production-ready PostgreSQL repository must contain imported WheelsonAuto state.');
    assert.strictEqual(health.integrity, 'verified', 'A production-ready PostgreSQL repository must verify the stored state checksum.');
    assert.strictEqual(health.resourceIndexReady, true, 'A production-ready PostgreSQL repository must have a complete critical-resource index.');
    assert.strictEqual(health.assignmentIndexReady, true, 'A production-ready PostgreSQL repository must have a complete active-assignment index.');
    assert.strictEqual(health.identityIndexReady, true, 'A production-ready PostgreSQL repository must have a complete immutable provider-identity index.');
    assert.strictEqual(health.documentIndexReady, true, 'A production-ready PostgreSQL repository must have complete private-document metadata.');
    assert.strictEqual(health.identityIndexCount, health.expectedIdentityIndexCount, 'The provider-identity index count must match authoritative state after recovery.');
    assert.strictEqual(health.documentIndexCount, health.expectedDocumentIndexCount, 'The private-document metadata count must match authoritative state after recovery.');
    assert.strictEqual(health.snapshotIntegrity, 'verified', 'The latest PostgreSQL recovery snapshot must verify its own checksum.');
    assert.strictEqual(health.snapshotVersionMatchesCurrent, true, 'The latest PostgreSQL recovery snapshot must match the current state version.');
    assert.strictEqual(health.snapshotChecksumMatchesCurrent, true, 'The latest PostgreSQL recovery snapshot must match the current state checksum.');
    assert.strictEqual(health.snapshotRecoveryReady, true, 'A production-ready PostgreSQL repository must expose a verified current recovery snapshot.');
    assert(health.recoveryHistoryCount >= 4, 'PostgreSQL health must expose retained drill and restore history without loading private state payloads.');
    assert.strictEqual(health.migrationProofIntegrity, 'verified', 'The PostgreSQL import proof must retain the source-to-target checksum/count evidence.');
    assert.strictEqual(health.migrationProofReady, true, 'A verified PostgreSQL import proof must remain available after normal state changes and recovery.');
    assert.strictEqual(health.migrationSourceProvenanceReady, true, 'The PostgreSQL import proof must retain validated signed Render live-disk source provenance after restart and recovery.');
    assert.strictEqual(health.renderServiceId, 'srv-postgres-runtime-proof', 'Migration health must identify the Render service that captured the protected source.');
    await repository.pool.query('DROP INDEX woa_job_errors_open_fingerprint_unique');
    const driftedSchemaHealth = await repository.health();
    assert.strictEqual(driftedSchemaHealth.productionReady, false, 'PostgreSQL health must fail closed when a required safety index drifts after startup.');
    assert.strictEqual(driftedSchemaHealth.schemaContractReady, false, 'PostgreSQL health must identify schema drift without relying on the application write path.');
    assert(driftedSchemaHealth.schemaContract.missingIndexes.some(item => item.name === 'woa_job_errors_open_fingerprint_unique'), 'Schema drift evidence must identify the exact missing safety index.');
    const repairRepository = stateRepository.createStateRepository({
      backend: 'postgres',
      databaseUrl,
      sslMode: databaseSslMode,
      organizationId,
      snapshotLimit: 12,
      applicationName: 'wheelsonauto-postgres-schema-contract-repair',
      seed: async () => ({ vehicles: [], customers: [], payments: [] })
    });
    try {
      await repairRepository.ensureSchema();
      const repairedSchemaHealth = await repairRepository.health();
      assert.strictEqual(repairedSchemaHealth.schemaContractReady, true, 'A clean PostgreSQL startup must restore a missing idempotent safety index.');
      assert.strictEqual(repairedSchemaHealth.productionReady, true, 'A PostgreSQL repository must return to production-ready after schema drift is repaired.');
    } finally {
      await repairRepository.close();
    }
    const recoveryDrillProof = await recordRecoveryDrillProof(organizationId, {
      durableJobLock: true,
      durableRateLimit: true,
      webhookLeaseRecovery: true,
      idempotencyLeaseRecovery: true,
      paidProviderActionHold: true,
      snapshotRestore: true,
      serverRestartRead: true,
      stateChecksum: true,
      migrationProof: true
    });
    console.log('PostgreSQL runtime recovery check passed: durable autopay lock, restart-safe security throttles, Stripe money-action idempotency, non-expiring paid-provider action protection, reviewable job errors, write, import proof, snapshot, restore, server-restart read, audit, checksum, current recovery proof, Star quota, and cleanup verified.' + (recoveryDrillProof.recorded ? ' Fresh production recovery-drill evidence was recorded.' : ' Recovery-drill evidence was not recorded: ' + recoveryDrillProof.reason + '.'));
  } finally {
    await removeTestRows(repository, organizationId).catch(() => {});
    await removeTestRows(repository, foreignOrganizationId).catch(() => {});
    await foreignRepository.close();
    await competingRepository.close();
    await repository.close();
  }
}

main().finally(() => {
  stopCiPostgres();
}).catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
