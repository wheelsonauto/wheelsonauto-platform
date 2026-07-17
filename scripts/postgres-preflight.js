'use strict';

const fs = require('node:fs');
const path = require('node:path');
const stateRepository = require('../state-repository');

const root = path.resolve(__dirname, '..');
const dataFile = path.resolve(process.argv[2] || path.join(root, 'data.json'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

try {
  const state = readJson(dataFile);
  const conflicts = stateRepository.identityConflicts(state);
  const privateDocuments = stateRepository.privateDocumentRows(state);
  const encryptedDocuments = privateDocuments.filter(row => row.storageKey && row.encryption && row.encryption.algorithm === 'AES-256-GCM');
  const legacyDocuments = privateDocuments.filter(row => !encryptedDocuments.includes(row));
  const report = {
    source: dataFile,
    timestamp: new Date().toISOString(),
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
      : ['Provision PostgreSQL and set DATABASE_URL.', 'Run WOA_POSTGRES_MIGRATION_CONFIRM=1 node scripts/migrate-json-to-postgres.js.', 'Verify the state checksum, then set WOA_DATA_BACKEND=postgres in Render.', 'Migrate legacy private files before setting WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED=1.']
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = conflicts.length ? 2 : 0;
} catch (error) {
  console.error('PostgreSQL preflight failed:', error.message || error);
  process.exit(1);
}
