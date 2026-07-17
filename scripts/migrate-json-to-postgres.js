'use strict';

const path = require('node:path');
const stateRepository = require('../state-repository');
const migrationSource = require('../postgres-migration-source');

const root = path.resolve(__dirname, '..');
const dataFile = path.resolve(process.argv[2] || path.join(root, 'data.json'));
const seedFile = path.join(root, 'seed.json');

async function main() {
  if (process.env.WOA_POSTGRES_MIGRATION_CONFIRM !== '1') {
    throw new Error('Refusing to copy live data without WOA_POSTGRES_MIGRATION_CONFIRM=1. This command never deletes data.json.');
  }
  if (process.env.WOA_POSTGRES_MIGRATION_MAINTENANCE_CONFIRM !== '1') {
    throw new Error('Refusing to import PostgreSQL state without WOA_POSTGRES_MIGRATION_MAINTENANCE_CONFIRM=1. Pause production writes and import an exact protected JSON copy so no customer change is lost during cutover.');
  }
  const source = await migrationSource.readSource(dataFile);
  const expectedSourceChecksum = migrationSource.requiredExpectedChecksum();
  migrationSource.assertExpectedChecksum(source.sourceFileChecksum, expectedSourceChecksum);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the PostgreSQL migration.');
  const state = source.state;
  const conflicts = stateRepository.identityConflicts(state);
  if (conflicts.length) {
    const error = new Error('Migration blocked by ' + conflicts.length + ' duplicate immutable identity value(s). Run node scripts/postgres-preflight.js first.');
    error.conflicts = conflicts;
    throw error;
  }
  const repository = stateRepository.createStateRepository({
    backend: 'postgres',
    dataFile,
    seedFile,
    organizationId: process.env.WOA_ORGANIZATION_ID || 'org-wheelsonauto',
    databaseUrl: process.env.DATABASE_URL,
    sslMode: process.env.WOA_POSTGRES_SSL_MODE || '',
    snapshotLimit: Number(process.env.WOA_POSTGRES_SNAPSHOT_LIMIT || 180)
  });
  try {
    const before = await repository.read();
    if (before.exists && process.env.WOA_POSTGRES_MIGRATION_REPLACE !== '1') {
      throw new Error('PostgreSQL already contains WheelsonAuto state. Refusing to replace it. Review the database and use WOA_POSTGRES_MIGRATION_REPLACE=1 only for an intentional recovery import.');
    }
    const canonicalSource = repository.repair(stateRepository.clone(state));
    const sourceChecksum = stateRepository.checksum(state);
    const canonicalSourceChecksum = stateRepository.checksum(canonicalSource);
    const sourceRecordCounts = stateRepository.migrationRecordCounts(canonicalSource);
    await migrationSource.assertSourceUnchanged(dataFile, source.sourceFileChecksum);
    const written = await repository.write(state, { reason: 'controlled JSON-to-PostgreSQL import', actor: 'production migration script' });
    const verified = await repository.read();
    const targetRecordCounts = stateRepository.migrationRecordCounts(verified.state);
    if (written.checksum !== verified.checksum || canonicalSourceChecksum !== written.checksum || stateRepository.checksum(verified.state) !== written.checksum) {
      throw new Error('PostgreSQL checksum verification failed after import. JSON source was not changed.');
    }
    await migrationSource.assertSourceUnchanged(dataFile, source.sourceFileChecksum);
    const migrationProof = await repository.recordMigrationProof({
      sourceChecksum,
      canonicalSourceChecksum,
      targetChecksum: verified.checksum,
      sourceRecordCounts,
      targetRecordCounts,
      importedVersion: verified.version,
      actor: 'production migration script'
    });
    const health = await repository.health();
    if (!migrationProof.migrationProofReady || !health.migrationProofReady || !health.snapshotRecoveryReady) {
      throw new Error('PostgreSQL import proof or current recovery snapshot verification failed. JSON source was not changed.');
    }
    console.log(JSON.stringify({
      ok: true,
      source: dataFile,
      sourceFileChecksum: source.sourceFileChecksum,
      databaseVersion: verified.version,
      checksum: verified.checksum,
      migrationProof,
      message: 'PostgreSQL import and checksum/count evidence verified against the preflight-confirmed protected source. Keep the JSON rollback snapshot until the dedicated recovery test is complete.'
    }, null, 2));
  } finally {
    await repository.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  if (error.conflicts) console.error(JSON.stringify(error.conflicts.slice(0, 20), null, 2));
  process.exit(1);
});
