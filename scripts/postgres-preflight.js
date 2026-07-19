'use strict';

const path = require('node:path');
const stateRepository = require('../state-repository');
const migrationSource = require('../postgres-migration-source');
const { firstUserArgument } = require('./cli-arguments');

const root = path.resolve(__dirname, '..');
const dataFile = path.resolve(firstUserArgument() || path.join(root, 'data.json'));

async function main() {
  const source = await migrationSource.readSource(dataFile);
  const state = source.state;
  const conflicts = stateRepository.identityConflicts(state);
  const warnings = stateRepository.identityWarnings(state);
  const privateDocuments = stateRepository.privateDocumentRows(state);
  const encryptedDocuments = privateDocuments.filter(row => row.storageKey && row.encryption && row.encryption.algorithm === 'AES-256-GCM');
  const legacyDocuments = privateDocuments.filter(row => !encryptedDocuments.includes(row));
  const structuralErrors = [];
  const duplicatePlan = stateRepository.exactDuplicateCriticalResourcePlan(state);
  const repairableExactDuplicates = duplicatePlan.repairs.map(row => ({
    collection: row.collection,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    occurrenceCount: row.occurrenceCount,
    removedCount: row.removedCount,
    recordHash: row.recordHash
  }));
  const nonidenticalCriticalDuplicates = duplicatePlan.conflicts.map(row => ({
    collection: row.collection,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    occurrenceCount: row.occurrenceCount,
    recordHashes: row.recordHashes
  }));
  if (repairableExactDuplicates.length) {
    structuralErrors.push({
      kind: 'woa_resource_exact_duplicate_set',
      message: repairableExactDuplicates.length + ' critical record ID group(s) contain canonical-identical copies. PostgreSQL import remains blocked until a checksum-locked protected source copy removes only those duplicate copies.',
      repairable: true,
      duplicateGroups: repairableExactDuplicates.length,
      duplicateCopies: repairableExactDuplicates.reduce((sum, row) => sum + row.removedCount, 0)
    });
  }
  nonidenticalCriticalDuplicates.forEach(row => {
    structuralErrors.push({
      kind: 'woa_resource_nonidentical_duplicate',
      message: 'Critical ' + row.resourceType + ' id ' + row.resourceId + ' appears more than once with different content. Owner review is required.',
      repairable: false,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      occurrenceCount: row.occurrenceCount,
      recordHashes: row.recordHashes
    });
  });
  let criticalResources = [];
  let activeAssignments = [];
  if (!nonidenticalCriticalDuplicates.length) {
    try {
      const indexState = repairableExactDuplicates.length
        ? stateRepository.collapseExactDuplicateCriticalResources(state).state
        : state;
      criticalResources = stateRepository.criticalResourceIndexRows(indexState);
    } catch (error) {
      structuralErrors.push({
        kind: String(error && error.code || 'woa_resource_index_error'),
        message: String(error && error.message || error || 'Critical resource index failed.').slice(0, 1000),
        resourceType: String(error && error.resourceType || ''),
        resourceId: String(error && error.resourceId || '')
      });
    }
  }
  try {
    activeAssignments = stateRepository.activeAssignmentIndexRows(state);
  } catch (error) {
    structuralErrors.push({
      kind: String(error && error.code || 'woa_assignment_index_error'),
      message: String(error && error.message || error || 'Active assignment index failed.').slice(0, 1000),
      vehicleId: String(error && error.vehicleId || ''),
      customers: Array.isArray(error && error.customers) ? error.customers.slice(0, 10) : []
    });
  }
  const immutableProviderIdentities = stateRepository.identityEntries(state);
  const postgresqlImportAllowed = conflicts.length === 0 && structuralErrors.length === 0;
  const controlledRecoveryDrill = 'Run the isolated PostgreSQL recovery drill after import: WOA_TEST_DATABASE_URL=<dedicated-test-db> WOA_POSTGRES_RUNTIME_TEST_CONFIRM=1 WOA_POSTGRES_RUNTIME_PROOF_RECORD=1 WOA_POSTGRES_RUNTIME_PROOF_CONFIRM=1 WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL=$DATABASE_URL node scripts/postgres-runtime-check.js. It records only proof metadata in the production database and uses the deployed WOA_SESSION_SECRET to bind that proof to the current database configuration.';
  const report = {
    source: dataFile,
    timestamp: new Date().toISOString(),
    sourceFileChecksum: source.sourceFileChecksum,
    canonicalStateChecksum: stateRepository.checksum(state),
    postgresqlImportAllowed,
    conflicts,
    structuralErrors,
    repairableExactDuplicates,
    nonidenticalCriticalDuplicates,
    warnings,
    counts: {
      vehicles: Array.isArray(state.vehicles) ? state.vehicles.length : 0,
      customers: Array.isArray(state.customers) ? state.customers.length : 0,
      recurringPayments: Array.isArray(state.recurringPayments) ? state.recurringPayments.length : 0,
      payments: Array.isArray(state.payments) ? state.payments.length : 0,
      privateDocuments: privateDocuments.length,
      encryptedDocuments: encryptedDocuments.length,
      legacyDocuments: legacyDocuments.length,
      repairableExactDuplicateGroups: repairableExactDuplicates.length,
      repairableExactDuplicateCopies: repairableExactDuplicates.reduce((sum, row) => sum + row.removedCount, 0),
      nonidenticalCriticalDuplicateGroups: nonidenticalCriticalDuplicates.length,
      criticalResources: criticalResources.length,
      activeAssignments: activeAssignments.length,
      immutableProviderIdentities: immutableProviderIdentities.length
    },
    nextSteps: !postgresqlImportAllowed
      ? [
          ...(repairableExactDuplicates.length ? ['Create a separate checksum-locked source with prepare-postgres-migration-source; never edit the live JSON or delete payment history by hand.'] : []),
          ...(nonidenticalCriticalDuplicates.length ? ['Review every non-identical duplicate with the owner. The preparation tool will not guess which record is authoritative.'] : []),
          ...(structuralErrors.some(row => row.kind === 'woa_assignment_identity_conflict') ? ['Resolve each customer-name assignment in Operations / Assigned. Confirm an alias only when both names are truly the same person.'] : []),
          'Resolve every listed immutable VIN, plate, portal-username, provider transaction/subscription, critical-record, and active vehicle-assignment conflict without deleting business history.',
          'Run this preflight again until postgresqlImportAllowed is true.'
        ]
      : (warnings.length
        ? ['Review and complete each missing vehicle VIN before enabling a controlled Stripe launch. PostgreSQL import remains available, but launch readiness stays blocked until these identity warnings are cleared.', 'Copy this exact source to protected backup storage and retain the sourceFileChecksum printed above.', 'Provision PostgreSQL and set DATABASE_URL.', 'Pause production writes, then run WOA_POSTGRES_MIGRATION_CONFIRM=1 WOA_POSTGRES_MIGRATION_MAINTENANCE_CONFIRM=1 WOA_POSTGRES_MIGRATION_SOURCE_SHA256=<sourceFileChecksum> node scripts/migrate-json-to-postgres.js <protected-copy>.', 'Verify the same checksum with WOA_POSTGRES_MIGRATION_PROOF_CONFIRM=1 WOA_POSTGRES_MIGRATION_SOURCE_SHA256=<sourceFileChecksum> node scripts/verify-json-to-postgres.js <protected-copy>.', controlledRecoveryDrill, 'Set WOA_DATA_BACKEND=postgres only after the dedicated recovery test and proof record pass.', 'Migrate legacy private files before setting WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED=1.']
        : ['Copy this exact source to protected backup storage and retain the sourceFileChecksum printed above.', 'Provision PostgreSQL and set DATABASE_URL.', 'Pause production writes, then run WOA_POSTGRES_MIGRATION_CONFIRM=1 WOA_POSTGRES_MIGRATION_MAINTENANCE_CONFIRM=1 WOA_POSTGRES_MIGRATION_SOURCE_SHA256=<sourceFileChecksum> node scripts/migrate-json-to-postgres.js <protected-copy>.', 'Verify the same checksum with WOA_POSTGRES_MIGRATION_PROOF_CONFIRM=1 WOA_POSTGRES_MIGRATION_SOURCE_SHA256=<sourceFileChecksum> node scripts/verify-json-to-postgres.js <protected-copy>.', controlledRecoveryDrill, 'Set WOA_DATA_BACKEND=postgres only after the dedicated recovery test and proof record pass.', 'Migrate legacy private files before setting WOA_PRIVATE_DOCUMENT_STORAGE_REQUIRED=1.'])
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = postgresqlImportAllowed ? 0 : 2;
}

main().catch(error => {
  console.error('PostgreSQL preflight failed:', error.message || error);
  process.exit(1);
});
