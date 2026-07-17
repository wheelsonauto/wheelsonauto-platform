'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const stateRepository = require('../state-repository');

const root = path.resolve(__dirname, '..');
const dataFile = path.resolve(process.argv[2] || path.join(root, 'data.json'));
const seedFile = path.join(root, 'seed.json');

async function main() {
  if (process.env.WOA_POSTGRES_MIGRATION_CONFIRM !== '1') {
    throw new Error('Refusing to copy live data without WOA_POSTGRES_MIGRATION_CONFIRM=1. This command never deletes data.json.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the PostgreSQL migration.');
  const state = JSON.parse(await fs.readFile(dataFile, 'utf8'));
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
    const written = await repository.write(state, { reason: 'controlled JSON-to-PostgreSQL import', actor: 'production migration script' });
    const verified = await repository.read();
    if (written.checksum !== verified.checksum || stateRepository.checksum(verified.state) !== written.checksum) {
      throw new Error('PostgreSQL checksum verification failed after import. JSON source was not changed.');
    }
    console.log(JSON.stringify({
      ok: true,
      source: dataFile,
      databaseVersion: verified.version,
      checksum: verified.checksum,
      message: 'PostgreSQL import verified. Keep data.json as a rollback snapshot until backup and recovery verification are complete.'
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
