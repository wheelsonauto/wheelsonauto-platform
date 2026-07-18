'use strict';

const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const stateRepository = require('../state-repository');
const secureDocumentStore = require('../secure-document-store');
const stripeMigration = require('../stripe-migration');
const { runCliArgumentChecks } = require('./cli-argument-check');

async function verifyGracefulShutdown(root, dataDir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      TMPDIR: process.env.TMPDIR || '',
      LANG: process.env.LANG || 'en_US.UTF-8',
      DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PORT: '0',
      WOA_DATA_BACKEND: 'json',
      WOA_PRODUCTION_HARDENING_REQUIRED: '0',
      WOA_AUTO_SYNC_MS: '3600000',
      WOA_AUTOPAY_MS: '3600000',
      WOA_AUTO_SYNC_STARTUP_DELAY_MS: '3600000',
      WOA_MESSAGING_ENABLED: '0',
      WOA_EMAIL_ENABLED: '0',
      WOA_STAR_AI_ENABLED: '0',
      WOA_TRACKER_PROVIDER: 'none',
      PUBLIC_BASE_URL: 'http://127.0.0.1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const capture = chunk => {
    output += String(chunk || '');
    if (/WheelsonAuto platform running/i.test(output)) startedResolve(true);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const startupTimer = setTimeout(() => startedResolve(false), 10000);
  const didStart = await started;
  clearTimeout(startupTimer);
  if (!didStart) {
    child.kill('SIGKILL');
    await exited;
    throw new Error('The isolated graceful-shutdown server did not start: ' + output.slice(-2000));
  }
  child.kill('SIGTERM');
  const exitResult = await Promise.race([
    exited,
    new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 10000))
  ]);
  if (exitResult.timedOut) {
    child.kill('SIGKILL');
    await exited;
    throw new Error('The isolated server did not finish graceful shutdown within 10 seconds: ' + output.slice(-2000));
  }
  assert.strictEqual(exitResult.code, 0, 'The isolated production process must exit cleanly after SIGTERM. Output: ' + output.slice(-2000));
  assert.match(output, /draining active requests and state writes/i, 'The production process must enter its explicit drain path before exiting.');
}

async function main() {
  runCliArgumentChecks();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-production-foundation-'));
  try {
    const seedFile = path.join(temp, 'seed.json');
    const dataFile = path.join(temp, 'data.json');
    await fs.writeFile(seedFile, JSON.stringify({ vehicles: [], customers: [], payments: [], documents: [], eSignatures: [] }), 'utf8');

    const serverSource = await fs.readFile(path.resolve(__dirname, '..', 'server.js'), 'utf8');
    const stateRepositorySource = await fs.readFile(path.resolve(__dirname, '..', 'state-repository.js'), 'utf8');
    const launchRunbook = await fs.readFile(path.resolve(__dirname, '..', 'docs', 'production-stripe-launch.md'), 'utf8');
    const renderBlueprint = await fs.readFile(path.resolve(__dirname, '..', 'render.yaml'), 'utf8');
    const productionWorkflow = await fs.readFile(path.resolve(__dirname, '..', '.github', 'workflows', 'production-gate.yml'), 'utf8');
    assert(serverSource.includes("url.pathname === '/healthz'") && serverSource.includes("release: ASSET_VERSION"), 'Production must expose a minimal unauthenticated health route without loading the staff workspace.');
    assert(serverSource.includes('process.env.RENDER_GIT_COMMIT') && serverSource.includes('commit: WOA_DEPLOY_COMMIT'), 'Production health must expose the short Render commit SHA for exact deploy verification.');
    assert(/healthCheckPath:\s*\/healthz/.test(renderBlueprint), 'Render must probe the dedicated health route instead of treating an open port as application readiness.');
    assert(/autoDeployTrigger:\s*checksPass/.test(renderBlueprint), 'Render must wait for the repository production gate before deploying main.');
    assert(/branches:\s*\[main\]/.test(productionWorkflow) && /npm run check/.test(productionWorkflow) && /timeout-minutes:\s*20/.test(productionWorkflow), 'The main production gate must run the complete regression suite with a bounded timeout.');
    assert(/maxShutdownDelaySeconds:\s*60/.test(renderBlueprint), 'Render must allow enough time for active money actions and state writes to drain.');
    assert(serverSource.includes('async function gracefulShutdown') && serverSource.includes("process.once('SIGTERM'") && serverSource.includes('await writeDataQueue.catch'), 'Production shutdown must stop accepting requests and drain queued state writes before exit.');
    await verifyGracefulShutdown(path.resolve(__dirname, '..'), path.join(temp, 'graceful-runtime'));
    assert(serverSource.includes('function reportBackgroundTaskFailure') && serverSource.includes("recordOperationalFailure(source, error, context, { alert: true })"), 'Every scheduled worker failure must use the shared durable monitor and owner-alert path.');
    assert(stateRepositorySource.includes('CREATE TABLE IF NOT EXISTS woa_resource_index') && stateRepositorySource.includes('CREATE TABLE IF NOT EXISTS woa_active_assignments'), 'PostgreSQL must normalize critical records and active vehicle assignments into transactionally synchronized indexes.');
    assert(stateRepositorySource.includes('PRIMARY KEY (organization_id, provider, event_id)') && stateRepositorySource.includes('$webhook_tenant_primary_key$'), 'Webhook uniqueness must be company-scoped for current and previously migrated PostgreSQL databases.');
    assert(stateRepositorySource.includes('await this.syncCriticalResourceIndex(client, next)') && stateRepositorySource.includes('await this.syncActiveAssignmentIndex(client, next)'), 'Normal writes and controlled recovery must synchronize critical record and assignment indexes in the state transaction.');
    assert(serverSource.includes('WOA_ERROR_RECORD_WINDOW_MS') && serverSource.includes('operationalErrorRecords'), 'Repeated background failures must be rate-limited before they flood durable operational logs.');
    const operationalFailureStart = serverSource.indexOf('async function recordOperationalFailure');
    const operationalFailureEnd = serverSource.indexOf('function reportBackgroundTaskFailure', operationalFailureStart);
    const operationalFailureBody = serverSource.slice(operationalFailureStart, operationalFailureEnd);
    assert(operationalFailureStart >= 0 && operationalFailureEnd > operationalFailureStart && !operationalFailureBody.includes('...context'), 'Operational monitoring must whitelist safe context instead of persisting arbitrary request or provider secrets.');
    [
      'clover-webhook-auto-sync',
      'telnyx-webhook-processing',
      'twilio-inbound-setup',
      'telnyx-inbound-setup',
      'twilio-inbound-sync',
      'telnyx-delivery-sync',
      'clover-auto-sync',
      'autopay-run',
      'verification-monitor',
      'passtime-gps-sync'
    ].forEach(sourceName => {
      assert(serverSource.includes("reportBackgroundTaskFailure('" + sourceName + "'"), 'Scheduled worker ' + sourceName + ' must report failures through the durable monitor.');
    });
    const recoveryTargetGuard = spawnSync(process.execPath, ['scripts/postgres-runtime-check.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        WOA_TEST_DATABASE_URL: 'postgres://test-user:test-password@localhost:5432/wheelsonauto',
        WOA_POSTGRES_RUNTIME_TEST_CONFIRM: '1',
        WOA_POSTGRES_RUNTIME_PROOF_RECORD: '1',
        WOA_POSTGRES_RUNTIME_PROOF_CONFIRM: '1',
        WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL: 'postgres://production-user:production-password@localhost:5432/wheelsonauto?sslmode=require',
        WOA_SESSION_SECRET: 'foundation-recovery-session-secret'
      },
      encoding: 'utf8'
    });
    assert.strictEqual(recoveryTargetGuard.status, 1, 'A recovery proof run must fail before opening a database when its test target matches the production proof target.');
    assert.match([recoveryTargetGuard.stdout, recoveryTargetGuard.stderr].filter(Boolean).join(''), /different dedicated test database/i, 'The recovery proof refusal must explain that the test database cannot be production.');
    assert(launchRunbook.includes('WOA_POSTGRES_RUNTIME_PROOF_RECORD=1') && launchRunbook.includes('WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL') && /same database as\n+the production proof target/i.test(launchRunbook), 'The production runbook must explain that recovery proof is recorded only after import from a separate test database.');
    assert(launchRunbook.includes('Validate private storage') && launchRunbook.includes('connect the Telnyx inbox') && launchRunbook.includes('Test Star provider') && launchRunbook.includes('Test failure alerts') && launchRunbook.includes('Live launch preflight'), 'The production runbook must give the owner the exact in-app provider proof actions needed to clear the launch gate.');
    const legacyPureStripe = { paymentProvider: 'stripe', stripeCustomerId: 'cus_foundation_pure', stripePaymentMethodId: 'pm_foundation_pure' };
    assert.strictEqual(stripeMigration.migrationRecord(legacyPureStripe).state, stripeMigration.STATES.STRIPE_ACTIVE, 'A legacy Stripe-only customer must remain Stripe-active without an unnecessary Clover cutover state.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed(legacyPureStripe, 'stripe', '2026-07-24'), true, 'A Stripe-only customer should remain eligible for its normal Stripe autopay run.');
    const ambiguousLegacyStripe = { ...legacyPureStripe, cloverCustomerId: 'clover-foundation-legacy', cloverPaymentSource: 'clover-foundation-source' };
    assert.strictEqual(stripeMigration.migrationRecord(ambiguousLegacyStripe).state, stripeMigration.STATES.STRIPE_CARD_SAVED, 'A legacy Stripe row that still has a Clover source must fail closed into the protected cutover state.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed(ambiguousLegacyStripe, 'stripe', '2026-07-24'), false, 'An ambiguous legacy Stripe/Clover row must not autocharge until the owner completes the controlled cutover.');
    const multiPlanCustomer = {
      recurringPayments: [
        { id: 'rec-plan-a', status: 'Active', paymentProvider: 'clover', customer: 'Same Customer', cloverCustomerId: 'clover-same-customer', cloverPaymentSource: 'source-plan-a', cloverSubscriptionId: 'sub-plan-a' },
        { id: 'rec-plan-b', status: 'Active', paymentProvider: 'clover', customer: 'Same Customer', cloverCustomerId: 'clover-same-customer', cloverPaymentSource: 'source-plan-b', cloverSubscriptionId: 'sub-plan-b' }
      ]
    };
    const multiPlanEligibility = stripeMigration.cutoverEligibility(multiPlanCustomer, multiPlanCustomer.recurringPayments[0]);
    assert.strictEqual(multiPlanEligibility.eligible, true, 'Separate plans for the same customer must remain eligible when each has its own Clover subscription ID.');
    assert.strictEqual(multiPlanEligibility.code, 'verified_multi_plan_customer', 'A verified multi-plan customer must remain explicit in cutover evidence.');
    assert.strictEqual(multiPlanEligibility.relatedPlanCount, 2, 'Cutover evidence must disclose the customer\'s other distinct Clover plans.');
    const missingSubscriptionEligibility = stripeMigration.cutoverEligibility({ recurringPayments: [{ ...multiPlanCustomer.recurringPayments[0], cloverSubscriptionId: '' }] }, { ...multiPlanCustomer.recurringPayments[0], cloverSubscriptionId: '' });
    assert.strictEqual(missingSubscriptionEligibility.eligible, false, 'A Clover row without an exact subscription ID must stay quarantined instead of relying on a customer-name guess.');
    assert.strictEqual(missingSubscriptionEligibility.code, 'missing_clover_subscription_id', 'The missing-subscription quarantine must expose a stable reason code.');
    const duplicatedSubscriptionState = {
      recurringPayments: [
        multiPlanCustomer.recurringPayments[0],
        { ...multiPlanCustomer.recurringPayments[1], cloverSubscriptionId: 'sub-plan-a' }
      ]
    };
    const duplicateSubscriptionEligibility = stripeMigration.cutoverEligibility(duplicatedSubscriptionState, duplicatedSubscriptionState.recurringPayments[0]);
    assert.strictEqual(duplicateSubscriptionEligibility.eligible, false, 'Two active local rows must never cut over against the same Clover subscription ID.');
    assert.strictEqual(duplicateSubscriptionEligibility.code, 'duplicate_clover_subscription_id', 'Duplicate-subscription quarantine must expose a stable reason code.');

    const repository = stateRepository.createStateRepository({ backend: 'json', dataFile, seedFile });
    const jsonReadiness = await repository.readiness();
    assert.strictEqual(jsonReadiness.connected, true, 'The deployment readiness probe must accept a readable JSON seed in compatibility mode.');
    assert.strictEqual(jsonReadiness.stateAvailable, true, 'The deployment readiness probe must confirm that application state is available.');
    const jsonAutopayLock = await repository.acquireJobLock('wheelsonauto-autopay');
    assert.strictEqual(jsonAutopayLock.acquired, true, 'The JSON development fallback should retain the in-process autopay lock contract.');
    await jsonAutopayLock.release();
    assert.strictEqual((await repository.checkRateLimit('login-failure', 'staff|198.51.100.10|owner', 2, 60000)).allowed, true, 'A fresh local security throttle must allow the first attempt.');
    assert.strictEqual((await repository.consumeRateLimit('login-failure', 'staff|198.51.100.10|owner', 2, 60000)).allowed, true, 'The local security throttle must consume the first attempt.');
    assert.strictEqual((await repository.consumeRateLimit('login-failure', 'staff|198.51.100.10|owner', 2, 60000)).allowed, true, 'The local security throttle must allow the configured final attempt.');
    const blockedJsonRateLimit = await repository.checkRateLimit('login-failure', 'staff|198.51.100.10|owner', 2, 60000);
    assert.strictEqual(blockedJsonRateLimit.allowed, false, 'The local security throttle must block after the configured limit.');
    assert(blockedJsonRateLimit.retryAfterSeconds > 0, 'A blocked local security throttle must return retry guidance.');
    await repository.clearRateLimit('login-failure', 'staff|198.51.100.10|owner');
    assert.strictEqual((await repository.checkRateLimit('login-failure', 'staff|198.51.100.10|owner', 2, 60000)).allowed, true, 'A successful local login must clear its failure throttle.');
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
    assert(firstJsonIdempotencyClaim.claimToken, 'A local Stripe billing-period claim must receive a unique lease token.');
    const activeJsonIdempotencyDuplicate = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, idempotencyRequest);
    assert.strictEqual(activeJsonIdempotencyDuplicate.inProgress, true, 'A concurrent local Stripe billing-period claim must remain protected while the first request is processing.');
    await assert.rejects(
      () => repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 }),
      error => error && error.code === 'woa_idempotency_request_mismatch',
      'A protected Stripe billing period must reject a changed amount until the first request reaches a terminal state.'
    );
    await repository.failIdempotencyKey(idempotencyScope, idempotencyKey, new Error('controlled decline'));
    assert.strictEqual(await repository.completeIdempotencyKey(idempotencyScope, idempotencyKey, { paymentIntentId: 'pi_failed_claim_must_not_settle' }, { claimToken: firstJsonIdempotencyClaim.claimToken }), false, 'A failed local Stripe claim must not be converted to paid by a late worker response.');
    const retryJsonIdempotencyClaim = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 });
    assert.strictEqual(retryJsonIdempotencyClaim.accepted, true, 'A terminal local Stripe decline must allow a deliberate corrected retry.');
    assert.strictEqual(retryJsonIdempotencyClaim.retried, true, 'A corrected local Stripe retry must be labeled as a retry.');
    assert.notStrictEqual(retryJsonIdempotencyClaim.claimToken, firstJsonIdempotencyClaim.claimToken, 'A retried local Stripe billing-period claim must replace the old worker lease token.');
    assert.strictEqual(await repository.completeIdempotencyKey(idempotencyScope, idempotencyKey, { paymentIntentId: 'pi_stale_worker_must_not_win' }, { claimToken: firstJsonIdempotencyClaim.claimToken }), false, 'A stale local Stripe worker must not complete a newer billing-period claim.');
    await repository.completeIdempotencyKey(idempotencyScope, idempotencyKey, { paymentIntentId: 'pi_foundation_idempotency_1', status: 'succeeded' }, { claimToken: retryJsonIdempotencyClaim.claimToken });
    const completedJsonIdempotencyDuplicate = await repository.claimIdempotencyKey(idempotencyScope, idempotencyKey, { ...idempotencyRequest, amountCents: 23000 });
    assert.strictEqual(completedJsonIdempotencyDuplicate.completed, true, 'A completed local Stripe billing-period claim must be permanently deduplicated.');
    assert.strictEqual(completedJsonIdempotencyDuplicate.response.paymentIntentId, 'pi_foundation_idempotency_1', 'A completed local Stripe billing-period claim must retain its reconciliation result.');
    const providerClaimKey = 'period:rec-foundation-provider:2026-07-24';
    const providerClaimRequest = { recurringPaymentId: 'rec-foundation-provider', billingPeriodKey: 'due:2026-07-24', amountCents: 22900 };
    const providerClaim = await repository.claimIdempotencyKey(idempotencyScope, providerClaimKey, providerClaimRequest);
    await repository.failIdempotencyKey(idempotencyScope, providerClaimKey, new Error('Worker received a provisional failure.'), { claimToken: providerClaim.claimToken });
    assert.strictEqual(await repository.completeIdempotencyKey(idempotencyScope, providerClaimKey, { paymentIntentId: 'pi_provider_late_success', status: 'succeeded' }, { providerAuthoritative: true }), true, 'A signed provider success must authoritatively settle a previously failed local claim.');
    const providerSettledDuplicate = await repository.claimIdempotencyKey(idempotencyScope, providerClaimKey, providerClaimRequest);
    assert.strictEqual(providerSettledDuplicate.completed, true, 'A provider-reconciled late success must permanently close the billing period against another charge.');
    assert.strictEqual(providerSettledDuplicate.response.paymentIntentId, 'pi_provider_late_success', 'Provider reconciliation must retain the exact Stripe PaymentIntent proof.');
    assert.strictEqual(await repository.completeIdempotencyKey(idempotencyScope, providerClaimKey, { paymentIntentId: 'pi_conflicting_later_event', status: 'succeeded' }, { providerAuthoritative: true }), true, 'Replaying provider success against a completed claim must remain idempotent.');
    const providerReplay = await repository.claimIdempotencyKey(idempotencyScope, providerClaimKey, providerClaimRequest);
    assert.strictEqual(providerReplay.response.paymentIntentId, 'pi_provider_late_success', 'A completed billing-period claim must preserve its first authoritative PaymentIntent proof.');
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
    const recoveryDrillFingerprint = stateRepository.recoveryDrillConfigurationFingerprint(
      'foundation-recovery-secret',
      'postgres://foundation-primary/wheelsonauto',
      'org-foundation'
    );
    const recoveryDrillChecks = Object.fromEntries(stateRepository.RECOVERY_DRILL_REQUIRED_CHECKS.map(check => [check, true]));
    const freshRecoveryDrill = {
      runId: 'foundation-recovery-drill-1',
      result: 'passed',
      testDatabaseFingerprint: stateRepository.recoveryDrillConfigurationFingerprint('foundation-recovery-secret', 'postgres://foundation-test/wheelsonauto', 'org-foundation-test'),
      configurationFingerprint: recoveryDrillFingerprint,
      checks: recoveryDrillChecks,
      scriptVersion: 'foundation-check-v1',
      verifiedAt: new Date().toISOString()
    };
    assert.strictEqual(stateRepository.recoveryDrillEvidence(freshRecoveryDrill, { configurationFingerprint: recoveryDrillFingerprint }).ready, true, 'A fresh passed recovery drill with every required check must satisfy the controlled launch gate.');
    assert.strictEqual(stateRepository.recoveryDrillEvidence({ ...freshRecoveryDrill, checks: { ...recoveryDrillChecks, serverRestartRead: false } }, { configurationFingerprint: recoveryDrillFingerprint }).ready, false, 'A recovery drill missing a server-restart read must fail closed before live launch.');
    assert.strictEqual(stateRepository.recoveryDrillEvidence({ ...freshRecoveryDrill, configurationFingerprint: 'old-database-configuration' }, { configurationFingerprint: recoveryDrillFingerprint }).ready, false, 'A recovery drill from an older database configuration must not satisfy the current launch gate.');
    assert.strictEqual(stateRepository.recoveryDrillEvidence({ ...freshRecoveryDrill, verifiedAt: '2020-01-01T00:00:00.000Z' }, { configurationFingerprint: recoveryDrillFingerprint, maxAgeMs: 60 * 60 * 1000 }).ready, false, 'A stale recovery drill must not satisfy the current launch gate.');
    await assert.rejects(() => repository.recordRecoveryDrill(freshRecoveryDrill), /cannot record a PostgreSQL recovery drill/i, 'The JSON development fallback must never pretend it recorded a controlled PostgreSQL recovery drill.');
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
    await repository.recordJobError('json-fallback-monitor', new Error('Controlled JSON fallback error'), { route: 'foundation check', source: 'startup' });
    await repository.recordJobError('json-fallback-monitor', new Error('Controlled JSON fallback error'), { route: 'foundation check', source: 'background' });
    const jsonJobErrors = await repository.recentJobErrors(5);
    assert.strictEqual(jsonJobErrors.length, 1, 'The JSON fallback must retain a bounded operational error record until PostgreSQL is enabled.');
    assert.strictEqual(jsonJobErrors[0].occurrenceCount, 2, 'Repeated JSON fallback failures must coalesce into one actionable incident with an occurrence count.');
    assert.strictEqual(jsonJobErrors[0].source, 'json-fallback-monitor', 'The JSON fallback error record must retain its source.');
    assert.strictEqual(jsonJobErrors[0].context.route, 'foundation check', 'The JSON fallback error record must retain safe context.');
    assert.strictEqual(await fs.readFile(dataFile, 'utf8'), stateBeforeJsonJobError, 'Recording a JSON fallback operational error must not rewrite business data.json.');
    assert((await fs.stat(dataFile + '.job-errors.json')).size > 0, 'The JSON fallback error log must live beside, not inside, the protected business state file.');
    const resolvedJsonJobError = await repository.resolveJobError(jsonJobErrors[0].id, { resolvedBy: 'foundation owner', note: 'Controlled review completed' });
    assert(resolvedJsonJobError && resolvedJsonJobError.resolvedAt && resolvedJsonJobError.resolvedBy === 'foundation owner', 'The JSON fallback must retain who reviewed an operational error and when.');
    assert.strictEqual(resolvedJsonJobError.occurrenceCount, 2, 'Resolving a grouped JSON fallback incident must retain its total occurrence count.');
    assert.strictEqual(resolvedJsonJobError.resolutionNote, 'Controlled review completed', 'The JSON fallback must retain the owner review note.');
    assert.strictEqual((await repository.recentJobErrors(5)).length, 0, 'A reviewed JSON fallback error must leave the open launch queue without being deleted.');
    assert.strictEqual(await repository.resolveJobError(jsonJobErrors[0].id, { resolvedBy: 'foundation owner' }), null, 'A resolved job error must not be resolved twice.');
    assert.strictEqual(await fs.readFile(dataFile, 'utf8'), stateBeforeJsonJobError, 'Resolving a JSON fallback operational error must not rewrite business data.json.');
    const aiReservation = await repository.reserveAiUsage({ dayKey: '2026-07-17', monthKey: '2026-07', dailyLimit: 1, monthlyLimit: 2 });
    assert.strictEqual(aiReservation.allowed, true, 'The local development guard must reserve the first Star model request.');
    const aiBlocked = await repository.reserveAiUsage({ dayKey: '2026-07-17', monthKey: '2026-07', dailyLimit: 1, monthlyLimit: 2 });
    assert.strictEqual(aiBlocked.allowed, false, 'The local development guard must stop a repeated Star request at the configured daily cap.');
    assert.strictEqual(aiBlocked.reason, 'daily_limit', 'The quota guard must explain why Star fell back to rules.');

    const duplicate = { ...next, vehicles: next.vehicles.concat({ id: 'vehicle-2', vin: '1HGCM82633A004352' }) };
    assert.strictEqual(stateRepository.identityConflicts(duplicate).length, 1, 'A duplicate immutable VIN must be found before PostgreSQL migration.');
    const sharedEmail = { ...next, customers: next.customers.concat({ id: 'customer-2', email: 'customer@example.com' }) };
    assert.strictEqual(stateRepository.identityConflicts(sharedEmail).length, 0, 'Repeated customer email aliases must not block migration when Clover or plan history contains multiple rows for one person.');
    const duplicatePortalUsername = { ...next, customerAccounts: next.customerAccounts.concat({ id: 'account-2', username: 'customer@example.com' }) };
    assert.strictEqual(stateRepository.identityConflicts(duplicatePortalUsername).length, 1, 'A duplicate portal username must still block migration because it can expose the wrong customer account.');
    const missingVinWarnings = stateRepository.identityWarnings({ vehicles: [{ id: 'vehicle-missing-vin', year: 2013, make: 'BMW', model: '528XI' }] });
    assert.strictEqual(missingVinWarnings.length, 1, 'A vehicle without a VIN must remain visible for owner review before Stripe cutover.');
    assert.strictEqual(missingVinWarnings[0].kind, 'vehicle_missing_vin', 'A missing VIN warning must retain a stable review category.');
    assert.strictEqual(stateRepository.identityWarnings({ vehicles: [{ id: 'application-placeholder', year: 'test', make: 'test', status: 'Pending application' }] }).length, 0, 'A pending application placeholder must not be treated as an operational fleet VIN blocker.');

    const indexedBusinessState = {
      vehicles: [{ id: 'vehicle-index-1', vin: 'INDEXVIN000000001', status: 'Rented', currentCustomer: 'Maya Stone' }],
      customers: [{ id: 'customer-index-1', name: 'Maya Stone', vehicleId: 'vehicle-index-1', status: 'Active' }],
      contracts: [{ id: 'file-index-1', customer: 'Maya R Stone', vehicleId: 'vehicle-index-1', status: 'Active' }],
      recurringPayments: [{ id: 'recurring-index-1', customer: 'Maya Stone', vehicleId: 'vehicle-index-1', status: 'Active' }],
      payments: [{ id: 'payment-index-1', customer: 'Maya Stone', vehicleId: 'vehicle-index-1', status: 'Paid' }]
    };
    const resourceIndexRows = stateRepository.criticalResourceIndexRows(indexedBusinessState);
    assert.strictEqual(resourceIndexRows.length, 5, 'The PostgreSQL resource index must include the vehicle, customer, customer file, autopay row, and payment record.');
    assert(resourceIndexRows.some(row => row.resourceType === 'customer_file' && row.resourceId === 'file-index-1' && row.vehicleId === 'vehicle-index-1'), 'A customer file index row must retain its stable file id and vehicle link.');
    assert.throws(
      () => stateRepository.criticalResourceIndexRows({ customers: [{ name: 'Missing Stable Id' }] }),
      error => error && error.code === 'woa_resource_identity_missing',
      'A critical record without a stable id must fail before a PostgreSQL state transaction commits.'
    );
    assert.throws(
      () => stateRepository.criticalResourceIndexRows({ contracts: [{ id: 'duplicate-file' }, { id: 'duplicate-file' }] }),
      error => error && error.code === 'woa_resource_identity_conflict',
      'Duplicate customer-file ids must fail before a PostgreSQL state transaction commits.'
    );
    const activeAssignments = stateRepository.activeAssignmentIndexRows(indexedBusinessState);
    assert.strictEqual(activeAssignments.length, 1, 'Matching active customer, file, and autopay rows must collapse into one vehicle assignment.');
    assert.strictEqual(activeAssignments[0].customerName, 'Maya Stone', 'The active assignment index must retain the canonical saved customer name.');
    assert.strictEqual(activeAssignments[0].sourceRefs.length, 3, 'The active assignment must preserve each authoritative source for later recovery review.');
    assert.strictEqual(stateRepository.activeAssignmentIndexRows({
      vehicles: [{ id: 'vehicle-history', status: 'Ready', currentCustomer: 'Old Customer' }],
      customers: [{ id: 'customer-history', name: 'Old Customer', vehicleId: 'vehicle-history', status: 'History' }]
    }).length, 0, 'History rows and stale current-customer values on ready fleet cars must not create active assignments.');
    const correctedStaleVehicle = stateRepository.activeAssignmentIndexRows({
      vehicles: [{ id: 'vehicle-stale-name', status: 'Rented', currentCustomer: 'Previous Customer' }],
      customers: [{ id: 'customer-current', name: 'Current Customer', vehicleId: 'vehicle-stale-name', status: 'Active' }]
    });
    assert.strictEqual(correctedStaleVehicle[0].customerName, 'Current Customer', 'An authoritative active record must replace a stale vehicle current-customer fallback without creating a false conflict.');
    const approvedAliasAssignment = stateRepository.activeAssignmentIndexRows({
      vehicles: [{ id: 'vehicle-alias', status: 'Rented' }],
      customers: [{ id: 'customer-alias', name: 'Khaled Jazzar', vehicleId: 'vehicle-alias', status: 'Active' }],
      contracts: [{ id: 'file-alias', customer: 'KJ Holdings', vehicleId: 'vehicle-alias', status: 'Active' }],
      assignmentCustomerAliases: [{ id: 'alias-1', vehicleId: 'vehicle-alias', canonicalCustomer: 'Khaled Jazzar', aliasCustomer: 'KJ Holdings', active: true }]
    });
    assert.strictEqual(approvedAliasAssignment.length, 1, 'An explicitly approved customer alias must reconcile to one active vehicle assignment.');
    assert.throws(
      () => stateRepository.activeAssignmentIndexRows({
        vehicles: [{ id: 'vehicle-conflict', status: 'Rented' }],
        customers: [{ id: 'customer-a', name: 'Customer Alpha', vehicleId: 'vehicle-conflict', status: 'Active' }],
        contracts: [{ id: 'file-b', customer: 'Customer Beta', vehicleId: 'vehicle-conflict', status: 'Active' }]
      }),
      error => error && error.code === 'woa_assignment_identity_conflict',
      'Two active customers claiming the same vehicle must fail the entire database write.'
    );
    assert.throws(
      () => stateRepository.activeAssignmentIndexRows({
        vehicles: [{ id: 'vehicle-present', status: 'Ready' }],
        customers: [{ id: 'customer-missing-car', name: 'Missing Car Customer', vehicleId: 'vehicle-not-found', status: 'Active' }]
      }),
      error => error && error.code === 'woa_assignment_vehicle_missing',
      'An active customer record pointing to a missing vehicle must fail instead of silently disappearing from Fleet.'
    );

    const documentRoot = path.join(temp, 'private-documents');
    const foundationV1Key = Buffer.alloc(32, 9).toString('base64');
    const store = secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: documentRoot,
      encryptionKey: foundationV1Key,
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
    assert.strictEqual(stored.organizationId, 'org-test', 'Encrypted document metadata must retain its owning organization.');
    assert((await store.read(stored)).equals(source), 'Encrypted private document reads must restore the original bytes.');
    await assert.rejects(() => store.read({ ...stored, encryption: { ...stored.encryption, authTag: Buffer.alloc(16).toString('base64') } }), /authenticate|Unsupported state|unable/i, 'Tampered encrypted document metadata must not decrypt.');
    await assert.rejects(() => store.read({ ...stored, organizationId: 'org-other-company' }), /ownership metadata/i, 'Moving a private document record into another company must fail authenticated ownership verification.');
    await assert.rejects(() => store.read({ ...stored, id: 'doc-other-customer' }), /ownership metadata/i, 'Relabeling a private document as another customer record must fail authenticated identity verification.');
    await assert.rejects(() => store.read({ ...stored, contentType: 'image/png' }), /ownership metadata/i, 'Changing the authenticated private document type must fail closed.');
    const rotatedStore = secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: documentRoot,
      encryptionKey: Buffer.alloc(32, 10).toString('base64'),
      keyVersion: 'test-v2',
      decryptionKeys: { 'test-v1': foundationV1Key }
    });
    assert((await rotatedStore.read(stored)).equals(source), 'A rotated document store must keep older private files readable through their versioned decryption key.');
    assert.deepStrictEqual(rotatedStore.status().availableKeyVersions, ['test-v1', 'test-v2'], 'Private storage readiness may expose key versions, but never key material, for recovery review.');
    const missingHistoricalKeyStore = secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: documentRoot,
      encryptionKey: Buffer.alloc(32, 10).toString('base64'),
      keyVersion: 'test-v2'
    });
    await assert.rejects(() => missingHistoricalKeyStore.read(stored), /key version test-v1 is not configured/i, 'A missing historical key must fail with an actionable recovery message instead of corrupting or replacing the file.');
    assert.throws(() => secureDocumentStore.createSecureDocumentStore({
      provider: 'local',
      localRoot: documentRoot,
      encryptionKey: Buffer.alloc(32, 10).toString('base64'),
      keyVersion: 'test-v2',
      decryptionKeys: { 'test-v2': Buffer.alloc(32, 11).toString('base64') }
    }), /conflicts/i, 'The active key version must not silently conflict with the recovery keyring.');
    const storageProbe = await store.probe({ organizationId: 'org-test' });
    assert(storageProbe.ok && storageProbe.encrypted && storageProbe.objectDeleted, 'Private document storage validation must prove encrypted write, read, and cleanup.');

    const s3Objects = new Map();
    const storageResponse = (status, bytes = Buffer.alloc(0)) => ({
      ok: status >= 200 && status < 300,
      status,
      async arrayBuffer() {
        const body = Buffer.from(bytes);
        return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      }
    });
    const privateS3Fetch = async (url, options = {}) => {
      const method = String(options.method || 'GET').toUpperCase();
      const headers = options.headers || {};
      const authorized = Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
      const objectKey = new URL(url).pathname;
      if (!authorized) return storageResponse(403);
      if (method === 'PUT') {
        s3Objects.set(objectKey, Buffer.from(options.body || Buffer.alloc(0)));
        return storageResponse(200);
      }
      if (method === 'GET') return s3Objects.has(objectKey) ? storageResponse(200, s3Objects.get(objectKey)) : storageResponse(404);
      if (method === 'DELETE') {
        s3Objects.delete(objectKey);
        return storageResponse(204);
      }
      return storageResponse(405);
    };
    const privateS3Store = secureDocumentStore.createSecureDocumentStore({
      provider: 's3',
      encryptionKey: Buffer.alloc(32, 10).toString('base64'),
      keyVersion: 'test-s3-v1',
      bucket: 'wheelsonauto-private-test',
      endpoint: 'https://objects.example.test',
      region: 'auto',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      pathStyle: true,
      fetch: privateS3Fetch
    });
    assert(privateS3Store.status().productionReady && privateS3Store.status().secureTransport, 'Production private storage must require a complete S3 configuration over HTTPS.');
    const privateS3Probe = await privateS3Store.probe({ organizationId: 'org-test-s3' });
    assert(privateS3Probe.ok && privateS3Probe.publicReadBlocked === true && privateS3Probe.objectDeleted, 'The production storage probe must prove anonymous reads are blocked before deleting its encrypted object.');
    const publicS3Store = secureDocumentStore.createSecureDocumentStore({
      provider: 's3',
      encryptionKey: Buffer.alloc(32, 11).toString('base64'),
      keyVersion: 'test-s3-public-v1',
      bucket: 'wheelsonauto-public-test',
      endpoint: 'https://objects.example.test',
      region: 'auto',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      pathStyle: true,
      fetch: async (url, options = {}) => {
        const headers = options.headers || {};
        const authorized = Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
        if (!authorized && String(options.method || 'GET').toUpperCase() === 'GET') return storageResponse(200, Buffer.from('public encrypted object'));
        return privateS3Fetch(url, options);
      }
    });
    await assert.rejects(() => publicS3Store.probe({ organizationId: 'org-test-public-s3' }), /publicly readable/i, 'A bucket that permits anonymous reads must fail the launch proof and clean up its probe object.');
    assert.strictEqual(s3Objects.size, 0, 'Both successful and rejected storage probes must remove their temporary objects.');
    const insecureS3Store = secureDocumentStore.createSecureDocumentStore({
      provider: 's3',
      encryptionKey: Buffer.alloc(32, 12).toString('base64'),
      bucket: 'wheelsonauto-insecure-test',
      endpoint: 'http://objects.example.test',
      region: 'auto',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      pathStyle: true,
      fetch: privateS3Fetch
    });
    assert.strictEqual(insecureS3Store.status().productionReady, false, 'An HTTP object-storage endpoint must never report production-ready.');
    assert.match(insecureS3Store.status().message, /HTTPS endpoint/i, 'The storage readiness message must explain the secure-transport requirement.');

    const recurring = {
      id: 'rec-foundation-1',
      paymentProvider: 'clover',
      cloverCustomerId: 'clover-foundation',
      cloverPaymentSource: 'source-foundation',
      stripeCustomerId: 'cus-foundation',
      stripePaymentMethodId: 'pm-foundation'
    };
    let migration = stripeMigration.transition(recurring, stripeMigration.STATES.STRIPE_SETUP_SENT, { at: '2026-07-17T10:00:00.000Z' });
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-17'), true, 'Sending a Stripe setup link must not stop the existing Clover schedule.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'stripe', '2026-07-17'), false, 'Stripe must remain inactive while card setup is only pending.');
    migration = stripeMigration.transition({ ...recurring, stripeMigration: migration }, stripeMigration.STATES.STRIPE_CARD_SAVED, { at: '2026-07-17T10:01:00.000Z' });
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-17'), true, 'Saving a Stripe card must not stop Clover before a protected cutover.');
    migration = stripeMigration.transition({ ...recurring, stripeMigration: migration }, stripeMigration.STATES.CUTOVER_SCHEDULED, { at: '2026-07-17T10:02:00.000Z', cutoverDate: '2026-07-24' });
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-23'), true, 'Clover must remain chargeable for billing periods before the scheduled cutover.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-24'), false, 'A scheduled cutover must lock automatic Clover charging.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, stripeMigration: migration }, 'clover', '2026-07-25'), false, 'Clover must remain locked after the scheduled cutover date.');
    migration = stripeMigration.transition({ ...recurring, stripeMigration: migration }, stripeMigration.STATES.FIRST_STRIPE_CHARGE_PENDING, { at: '2026-07-24T17:55:00.000Z', cutoverDate: '2026-07-24', cloverStoppedConfirmedAt: '2026-07-24T17:55:00.000Z' });
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: migration }, 'stripe', '2026-07-24'), true, 'A confirmed same-day cutover may allow the protected first Stripe charge.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: migration }, 'stripe', '2026-07-23'), false, 'The first Stripe charge must not run for a billing date before the protected cutover.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: { ...migration, cutoverDate: '' } }, 'stripe', '2026-07-24'), false, 'A Clover-to-Stripe first charge without a saved cutover date must fail closed.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: { state: stripeMigration.STATES.CLOVER_ACTIVE } }, 'stripe', '2026-07-24'), false, 'An inconsistent Stripe-provider row that is still Clover-active must fail closed.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'clover', stripeMigration: { state: stripeMigration.STATES.CLOVER_DISABLED } }, 'clover', '2026-07-24'), false, 'An inconsistent Clover-provider row marked Clover-disabled must fail closed.');
    assert.strictEqual(stripeMigration.automaticChargeAllowed({ ...recurring, paymentProvider: 'stripe', stripeMigration: { state: stripeMigration.STATES.STRIPE_ACTIVE } }, 'stripe', '2026-07-24'), true, 'A consistent Stripe-active row may use Stripe autopay.');

    const periodState = { payments: [{ id: 'paid-clover-period', recurringPaymentId: recurring.id, paymentProvider: 'clover', billingPeriodKey: 'due:2026-07-24', status: 'Paid' }] };
    assert.throws(() => stripeMigration.assertBillingPeriodOpen(periodState, recurring, '2026-07-24'), /duplicate charge/i, 'A Stripe charge must be blocked when Clover already paid the same billing period.');
    assert.strictEqual(stripeMigration.existingPaidPayment(periodState, recurring, '2026-07-24').id, 'paid-clover-period', 'Cross-provider period lookup must retain the original payment record.');

    console.log('Production foundation check passed: atomic state fallback, durable money-action idempotency, migration-proof guard, checksum fail-closed behavior, controlled recovery-drill evidence, immutable identity preflight, encrypted private storage, tamper rejection, reviewable background monitoring, Star request caps, durable job-lock contract, and Clover-to-Stripe duplicate protection are verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
