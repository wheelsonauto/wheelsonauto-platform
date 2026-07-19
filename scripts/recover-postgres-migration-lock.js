'use strict';

const path = require('node:path');
const migrationMaintenanceLease = require('../migration-maintenance-lease');
const stateMigrationLock = require('../state-migration-lock');
const { firstUserArgument } = require('./cli-arguments');

const CONFIRMATION = 'RECOVER STALE POSTGRES MIGRATION LOCK';
const root = path.resolve(__dirname, '..');
const dataFile = path.resolve(firstUserArgument() || path.join(root, 'data.json'));

async function assertSameMaintenanceLease(expected) {
  const current = await migrationMaintenanceLease.assertActiveLease({ environment: process.env });
  for (const field of ['serviceId', 'renderCommit', 'instanceId', 'startedAt', 'signatureChecksum']) {
    if (String(current[field] || '') !== String(expected[field] || '')) {
      throw new Error('The deployed migration-maintenance process changed during stale-lock recovery. Writes remain blocked; review the active Render deployment before retrying.');
    }
  }
  return current;
}

async function main() {
  if (process.env.WOA_POSTGRES_MIGRATION_LOCK_RECOVERY_CONFIRM !== CONFIRMATION) {
    throw new Error('Refusing to recover a migration lock without WOA_POSTGRES_MIGRATION_LOCK_RECOVERY_CONFIRM="' + CONFIRMATION + '".');
  }
  if (String(process.env.WOA_MIGRATION_MAINTENANCE_MODE || '') !== '1') {
    throw new Error('WOA_MIGRATION_MAINTENANCE_MODE=1 is required before stale-lock recovery. Confirm the deployed app is paused and its signed lease is active.');
  }
  const activeMaintenanceLease = await migrationMaintenanceLease.assertActiveLease({ environment: process.env });
  const expectedSourceChecksum = String(process.env.WOA_POSTGRES_MIGRATION_SOURCE_SHA256 || '').trim();
  const minAgeSeconds = Math.max(60, Number(process.env.WOA_POSTGRES_MIGRATION_LOCK_MIN_AGE_SECONDS || 300));
  const result = await stateMigrationLock.recoverStale({
    dataFile,
    expectedSourceChecksum,
    minAgeMs: minAgeSeconds * 1000,
    maintenanceAssertion: () => assertSameMaintenanceLease(activeMaintenanceLease)
  });
  console.log(JSON.stringify({
    ok: true,
    recoveredAt: result.recoveredAt,
    acquiredAt: result.acquiredAt,
    sourceFile: result.sourceFile,
    sourceFileChecksum: result.sourceFileChecksum,
    preservedLockEvidence: result.recoveryFile,
    maintenanceServiceId: activeMaintenanceLease.serviceId,
    maintenanceRenderCommit: activeMaintenanceLease.renderCommit,
    maintenanceInstanceId: activeMaintenanceLease.instanceId,
    maintenanceStartedAt: activeMaintenanceLease.startedAt,
    maintenanceLeaseSignatureChecksum: activeMaintenanceLease.signatureChecksum,
    message: 'The stale cutover lock was preserved as evidence and application writes may resume. Re-run PostgreSQL preflight before starting another import.'
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
