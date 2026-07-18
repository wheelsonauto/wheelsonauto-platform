'use strict';

const path = require('node:path');
const stateMigrationLock = require('../state-migration-lock');
const { firstUserArgument } = require('./cli-arguments');

const CONFIRMATION = 'RECOVER STALE POSTGRES MIGRATION LOCK';
const root = path.resolve(__dirname, '..');
const dataFile = path.resolve(firstUserArgument() || path.join(root, 'data.json'));

async function main() {
  if (process.env.WOA_POSTGRES_MIGRATION_LOCK_RECOVERY_CONFIRM !== CONFIRMATION) {
    throw new Error('Refusing to recover a migration lock without WOA_POSTGRES_MIGRATION_LOCK_RECOVERY_CONFIRM="' + CONFIRMATION + '".');
  }
  const expectedSourceChecksum = String(process.env.WOA_POSTGRES_MIGRATION_SOURCE_SHA256 || '').trim();
  const minAgeSeconds = Math.max(60, Number(process.env.WOA_POSTGRES_MIGRATION_LOCK_MIN_AGE_SECONDS || 300));
  const result = await stateMigrationLock.recoverStale({
    dataFile,
    expectedSourceChecksum,
    minAgeMs: minAgeSeconds * 1000
  });
  console.log(JSON.stringify({
    ok: true,
    recoveredAt: result.recoveredAt,
    acquiredAt: result.acquiredAt,
    sourceFile: result.sourceFile,
    sourceFileChecksum: result.sourceFileChecksum,
    preservedLockEvidence: result.recoveryFile,
    message: 'The stale cutover lock was preserved as evidence and application writes may resume. Re-run PostgreSQL preflight before starting another import.'
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
