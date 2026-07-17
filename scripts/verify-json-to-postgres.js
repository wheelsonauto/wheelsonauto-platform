'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const stateRepository = require('../state-repository');

const root = path.resolve(__dirname, '..');
const dataFile = path.resolve(process.argv[2] || path.join(root, 'data.json'));
const seedFile = path.join(root, 'seed.json');

async function main() {
  if (process.env.WOA_POSTGRES_MIGRATION_PROOF_CONFIRM !== '1') {
    throw new Error('Refusing to record a migration proof without WOA_POSTGRES_MIGRATION_PROOF_CONFIRM=1. This command never rewrites the JSON or PostgreSQL business state.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to verify PostgreSQL import evidence.');
  const state = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  const conflicts = stateRepository.identityConflicts(state);
  if (conflicts.length) {
    const error = new Error('Migration proof blocked by ' + conflicts.length + ' duplicate immutable identity value(s). Resolve the source conflicts without deleting business history.');
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
    const proof = await repository.recordMigrationProof({
      sourceChecksum,
      canonicalSourceChecksum,
      targetChecksum: target.checksum,
      sourceRecordCounts,
      targetRecordCounts,
      importedVersion: target.version,
      actor: 'read-only PostgreSQL migration verification'
    });
    const health = await repository.health();
    if (!proof.migrationProofReady || !health.migrationProofReady || !health.snapshotRecoveryReady) {
      throw new Error('PostgreSQL import proof or current recovery snapshot verification failed. No state was changed.');
    }
    console.log(JSON.stringify({
      ok: true,
      source: dataFile,
      databaseVersion: target.version,
      checksum: target.checksum,
      migrationProof: proof,
      message: 'The JSON source exactly matches PostgreSQL. Import proof metadata was recorded without rewriting either state.'
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
