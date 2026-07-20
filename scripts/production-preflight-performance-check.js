'use strict';

const assert = require('node:assert');

process.env.WOA_SESSION_SECRET = 'preflight-performance-session-secret';

const { productionInfrastructurePreflight } = require('../server');

function wait(ms, value, error = null) {
  return new Promise((resolve, reject) => {
    setTimeout(() => error ? reject(error) : resolve(value), ms);
  });
}

function stateFixture() {
  return {
    customers: [],
    vehicles: [],
    recurringPayments: [],
    payments: [],
    documents: [],
    eSignatures: [],
    claims: [],
    integrations: {},
    security: {}
  };
}

function databaseFixture(overrides = {}) {
  return {
    backend: 'postgres',
    connected: true,
    transactional: true,
    productionReady: true,
    snapshotRecoveryReady: true,
    migrationProofReady: true,
    migrationSourceProvenanceReady: true,
    recoveryDrill: { ready: true, verified: true },
    ...overrides
  };
}

function backupFixture(overrides = {}) {
  return {
    enabled: true,
    configured: true,
    productionReady: true,
    dedicatedKeyConfigured: true,
    verified: true,
    fresh: true,
    live: true,
    marker: 'backup-completed',
    ...overrides
  };
}

async function main() {
  const delayMs = 120;
  const concurrentStartedAt = Date.now();
  const concurrent = await productionInfrastructurePreflight(null, {
    timeoutMs: 1000,
    repository: { kind: 'postgres', health: () => wait(delayMs, databaseFixture()) },
    backendCutoverEvidence: () => wait(delayMs, { backend: 'postgres', ready: true, marker: 'sentinel-completed' }),
    stateBackupEvidence: () => wait(delayMs, backupFixture()),
    readState: () => wait(delayMs, stateFixture())
  });
  const concurrentDurationMs = Date.now() - concurrentStartedAt;
  assert(concurrentDurationMs < delayMs * 2.5, 'Independent preflight checks must run concurrently instead of adding every provider delay together.');
  assert.strictEqual(concurrent.backendCutover.marker, 'sentinel-completed');
  assert.strictEqual(concurrent.stateBackup.marker, 'backup-completed');
  assert.strictEqual(concurrent.stateRead.ready, true);
  assert.strictEqual(concurrent.checkTimings.database.ok, true);
  assert.strictEqual(concurrent.checkTimings['encrypted backup'].ok, true);

  const independentFailure = await productionInfrastructurePreflight(null, {
    timeoutMs: 1000,
    repository: { kind: 'postgres', health: () => wait(10, null, new Error('database evidence unavailable')) },
    backendCutoverEvidence: () => wait(15, { backend: 'postgres', ready: true, marker: 'sentinel-survived' }),
    stateBackupEvidence: () => wait(5, backupFixture({ marker: 'backup-survived' })),
    readState: () => wait(5, stateFixture())
  });
  assert.strictEqual(independentFailure.database.productionReady, false, 'A failed database check must fail its own gate closed.');
  assert.match(independentFailure.database.error, /database evidence unavailable/);
  assert.strictEqual(independentFailure.backendCutover.marker, 'sentinel-survived', 'One failed check must not erase successful cutover evidence.');
  assert.strictEqual(independentFailure.stateBackup.marker, 'backup-survived', 'One failed check must not erase successful backup evidence.');
  assert.strictEqual(independentFailure.checkTimings.database.ok, false);

  const timeoutStartedAt = Date.now();
  const timedOut = await productionInfrastructurePreflight(null, {
    timeoutMs: 25,
    repository: { kind: 'postgres', health: () => wait(150, databaseFixture()) },
    backendCutoverEvidence: () => ({ backend: 'postgres', ready: true }),
    stateBackupEvidence: () => backupFixture(),
    readState: () => stateFixture()
  });
  const timeoutDurationMs = Date.now() - timeoutStartedAt;
  assert(timeoutDurationMs < 120, 'A stalled readiness dependency must not freeze the owner interface.');
  assert.strictEqual(timedOut.database.productionReady, false);
  assert.strictEqual(timedOut.checkTimings.database.timedOut, true);
  assert.match(timedOut.database.error, /did not answer within/);

  console.log('Production preflight performance check passed: readiness evidence runs concurrently, failures stay isolated, and slow providers fail closed within a bounded response time.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
