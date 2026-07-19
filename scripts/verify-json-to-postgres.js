'use strict';

const path = require('node:path');
const stateRepository = require('../state-repository');
const migrationSource = require('../postgres-migration-source');
const dataBackendCutover = require('../data-backend-cutover');
const { firstUserArgument } = require('./cli-arguments');

const root = path.resolve(__dirname, '..');
const dataFile = path.resolve(firstUserArgument() || path.join(root, 'data.json'));
const seedFile = path.join(root, 'seed.json');

async function main() {
  if (process.env.WOA_POSTGRES_MIGRATION_PROOF_CONFIRM !== '1') {
    throw new Error('Refusing to record a migration proof without WOA_POSTGRES_MIGRATION_PROOF_CONFIRM=1. This command never rewrites the JSON or PostgreSQL business state.');
  }
  const source = await migrationSource.readSource(dataFile);
  const expectedSourceChecksum = migrationSource.requiredExpectedChecksum();
  migrationSource.assertExpectedChecksum(source.sourceFileChecksum, expectedSourceChecksum);
  const state = source.state;
  stateRepository.assertTransactionalSourceReady(state);
  const sourceProvenance = await migrationSource.assertProvenanceManifest(dataFile, source.sourceFileChecksum);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to verify PostgreSQL import evidence.');
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
    const target = await repository.read();
    if (!target.exists) throw new Error('PostgreSQL has no WheelsonAuto state yet. Run the controlled importer instead of recording a proof.');
    const canonicalSource = repository.repair(stateRepository.clone(state));
    const sourceChecksum = stateRepository.checksum(state);
    const canonicalSourceChecksum = stateRepository.checksum(canonicalSource);
    const sourceRecordCounts = stateRepository.migrationRecordCounts(canonicalSource);
    const targetRecordCounts = stateRepository.migrationRecordCounts(target.state);
    if (canonicalSourceChecksum !== target.checksum || stateRepository.stableJson(sourceRecordCounts) !== stateRepository.stableJson(targetRecordCounts)) {
      throw new Error('The supplied JSON source does not exactly match the current PostgreSQL state. No state was changed and no proof was recorded. Use the exact protected migration copy, not a later or earlier data.json.');
    }
    await migrationSource.assertSourceUnchanged(dataFile, source.sourceFileChecksum);
    const proof = await repository.recordMigrationProof({
      sourceChecksum,
      canonicalSourceChecksum,
      targetChecksum: target.checksum,
      sourceRecordCounts,
      targetRecordCounts,
      importedVersion: target.version,
      sourceProvenance,
      actor: 'read-only PostgreSQL migration verification'
    });
    const health = await repository.health();
    if (!proof.migrationProofReady || !health.migrationProofReady || !health.snapshotRecoveryReady) {
      throw new Error('PostgreSQL import proof or current recovery snapshot verification failed. No state was changed.');
    }
    const cutoverSentinel = await dataBackendCutover.writePostgresSentinel({
      dataDir: process.env.WOA_DATA_BACKEND_SENTINEL_DIR || process.env.DATA_DIR || path.dirname(dataFile),
      health,
      organizationId: process.env.WOA_ORGANIZATION_ID || 'org-wheelsonauto',
      protectedSourceFileChecksum: source.sourceFileChecksum
    });
    console.log(JSON.stringify({
      ok: true,
      source: dataFile,
      sourceFileChecksum: source.sourceFileChecksum,
      sourceProvenance,
      databaseVersion: target.version,
      checksum: target.checksum,
      migrationProof: proof,
      cutoverSentinel: {
        created: cutoverSentinel.created,
        file: cutoverSentinel.file,
        protectedSourceFileChecksum: cutoverSentinel.sentinel.protectedSourceFileChecksum
      },
      message: 'The signed Render live-disk JSON source exactly matches PostgreSQL. Import proof metadata and the persistent cutover sentinel were verified without rewriting either business state.'
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
