'use strict';

const path = require('node:path');
const stateRepository = require('../state-repository');
const migrationSource = require('../postgres-migration-source');

const root = path.resolve(__dirname, '..');
const dataFile = path.resolve(process.argv[2] || path.join(root, 'data.json'));

async function main() {
  const source = await migrationSource.readSource(dataFile);
  const state = source.state;
  const conflicts = stateRepository.identityConflicts(state);
  const privateDocuments = stateRepository.privateDocumentRows(state);
  const encryptedDocuments = privateDocuments.filter(row => row.storageKey && row.encryption && row.encryption.algorithm === 'AES-256-GCM');
  const legacyDocuments = privateDocuments.filter(row => !encryptedDocuments.includes(row));
  const report = {
    source: dataFile,
    timestamp: new Date().toISOString(),
    sourceFileChecksum: source.sourceFileChecksum,
    canonicalStateChecksum: stateRepository.checksum(state),
    postgresqlImportAllowed: conflicts.length === 0,
    conflicts,
    counts: {
      vehicles: Array.isArray(state.vehicles) ? state.vehicles.length : 0,
      customers: Array.isArray(state.customers) ? state.customers.length : 0,
      recurringPayments: Array.isArray(state.recurringPayments) ? state.recurringPayments.length : 0,
      payments: Array.isArray(state.payments) ? state.payments.length : 0,
      privateDocuments: privateDocuments.length,
      encryptedDocuments: encryptedDocuments.length,
      legacyDocuments: legacyDocuments.length
    },
    nextSteps: conflicts.length
      ? ['Resolve each listed immutable VIN, plate, email, or payment-id conflict without deleting business history.', 'Run this preflight again until postgresqlImportAllowed is true.']
      : ['Copy this exact source to protected backup storage and retain the sourceFileChecksum printed above.', 'Provision PostgreSQL and set DATABASE_URL.', 'Pause production writes, then run WOA_POSTGRES_MIGRATION_CONFIRM=1 WOA_POSTGRES_MIGRATION_MAINTENANCE_CONFIRM=1 WOA_POSTGRES_MIGRATION_SOURCE_SHA256=<sourceFileChecksum> node scripts/migrate-json-to-postgres.js <protected-copy>.', 'Verify the same checksum with WOA_POSTGRES_MIGRATION_PROOF_CONFIRM=1 WOA_POSTGRES_MIGRATION_SOURCE_SHA256=<sourceFileChecksum> node scripts/verify-json-to-postgres.js <protected-copy>.', 'Set WOA_DATA_BACKEND=postgres only after the dedicated recovery test passes.', 'Migrate legacy private files before setting WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED=1.']
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = conflicts.length ? 2 : 0;
}

main().catch(error => {
  console.error('PostgreSQL preflight failed:', error.message || error);
  process.exit(1);
});
