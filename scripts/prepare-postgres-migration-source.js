'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const stateRepository = require('../state-repository');
const migrationSource = require('../postgres-migration-source');
const stateMigrationLock = require('../state-migration-lock');
const { userArguments } = require('./cli-arguments');

function structuralReadiness(state = {}) {
  const conflicts = stateRepository.identityConflicts(state);
  const structuralErrors = [];
  let criticalResources = [];
  let activeAssignments = [];
  try {
    criticalResources = stateRepository.criticalResourceIndexRows(state);
  } catch (error) {
    structuralErrors.push({
      kind: String(error && error.code || 'woa_resource_index_error'),
      message: String(error && error.message || error).slice(0, 1000),
      resourceType: String(error && error.resourceType || ''),
      resourceId: String(error && error.resourceId || '')
    });
  }
  try {
    activeAssignments = stateRepository.activeAssignmentIndexRows(state);
  } catch (error) {
    structuralErrors.push({
      kind: String(error && error.code || 'woa_assignment_index_error'),
      message: String(error && error.message || error).slice(0, 1000),
      vehicleId: String(error && error.vehicleId || ''),
      customers: Array.isArray(error && error.customers) ? error.customers.slice(0, 10) : [],
      claims: Array.isArray(error && error.claims) ? error.claims.slice(0, 20) : []
    });
  }
  return {
    postgresqlImportAllowed: conflicts.length === 0 && structuralErrors.length === 0,
    conflicts,
    structuralErrors,
    warnings: stateRepository.identityWarnings(state),
    counts: {
      criticalResources: criticalResources.length,
      activeAssignments: activeAssignments.length,
      immutableProviderIdentities: stateRepository.identityEntries(state).length,
      privateDocuments: stateRepository.privateDocumentRows(state).length
    }
  };
}

async function writeExclusive(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.open(file, 'wx', 0o600);
  let complete = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    complete = true;
  } finally {
    await handle.close();
    if (!complete) await fs.unlink(file).catch(() => {});
  }
}

async function main() {
  const args = userArguments();
  if (args.length !== 2) throw new Error('Usage: node scripts/prepare-postgres-migration-source.js <live-data.json> <new-protected-copy.json>');
  if (process.env.WOA_POSTGRES_SOURCE_REPAIR_CONFIRM !== 'EXACT_DUPLICATES_ONLY') {
    throw new Error('Set WOA_POSTGRES_SOURCE_REPAIR_CONFIRM=EXACT_DUPLICATES_ONLY to create a separate protected copy. The live source is never rewritten.');
  }
  if (process.env.WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM !== '1') {
    throw new Error('Set WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM=1 so the shared migration lock can briefly pause writes while the exact source copy is prepared.');
  }
  const sourceFile = path.resolve(args[0]);
  const outputFile = path.resolve(args[1]);
  const manifestFile = outputFile + '.repair-manifest.json';
  if (sourceFile === outputFile) throw new Error('The protected output must be a new file. Refusing to rewrite the live source.');
  const source = await migrationSource.readSource(sourceFile);
  const expectedChecksum = migrationSource.requiredExpectedChecksum(process.env, 'WOA_POSTGRES_SOURCE_REPAIR_SHA256');
  migrationSource.assertExpectedChecksum(source.sourceFileChecksum, expectedChecksum, 'Live JSON source selected for protected-copy preparation');
  const plan = stateRepository.exactDuplicateCriticalResourcePlan(source.state);
  if (plan.conflicts.length) {
    const error = new Error('A duplicated critical resource ID contains different data. No output was written; owner review is required.');
    error.code = 'woa_nonidentical_resource_duplicate';
    error.conflicts = plan.conflicts;
    throw error;
  }

  let lock = null;
  let outputCreated = false;
  let manifestCreated = false;
  try {
    lock = await stateMigrationLock.acquire({
      dataFile: sourceFile,
      sourceFileChecksum: source.sourceFileChecksum,
      reason: 'prepare checksum-locked PostgreSQL migration source copy'
    });
    await migrationSource.assertSourceUnchanged(sourceFile, source.sourceFileChecksum);
    const collapsed = stateRepository.collapseExactDuplicateCriticalResources(source.state);
    const preparedAt = new Date().toISOString();
    if (collapsed.repairs.length) {
      const repairId = 'postgres-source-repair-' + source.sourceFileChecksum.slice(0, 24);
      collapsed.state.migrationSourceRepairs = (Array.isArray(collapsed.state.migrationSourceRepairs) ? collapsed.state.migrationSourceRepairs : [])
        .filter(row => row && row.id !== repairId);
      collapsed.state.migrationSourceRepairs.push({
        id: repairId,
        preparedAt,
        sourceFileChecksum: source.sourceFileChecksum,
        policy: 'exact duplicate critical records only; first byte-equivalent record retained',
        repairs: collapsed.repairs.map(repair => ({
          collection: repair.collection,
          resourceType: repair.resourceType,
          resourceId: repair.resourceId,
          recordHash: repair.recordHash,
          occurrenceCount: repair.occurrenceCount,
          removedCount: repair.removedCount
        }))
      });
    }
    const readiness = structuralReadiness(collapsed.state);
    const outputBytes = Buffer.from(JSON.stringify(collapsed.state, null, 2) + '\n', 'utf8');
    await writeExclusive(outputFile, outputBytes);
    outputCreated = true;
    await migrationSource.assertSourceUnchanged(sourceFile, source.sourceFileChecksum);
    const prepared = await migrationSource.readSource(outputFile);
    const signedProvenance = migrationSource.createProvenanceManifest({
      preparedAt,
      source: sourceFile,
      sourceFileChecksum: source.sourceFileChecksum,
      protectedCopy: outputFile,
      protectedCopyChecksum: prepared.sourceFileChecksum,
      policy: 'Only canonical byte-equivalent records sharing one critical resource ID were collapsed. Non-identical duplicates and assignment conflicts are never guessed.',
      repairs: collapsed.repairs
    });
    const manifest = {
      ...signedProvenance,
      repairs: collapsed.repairs,
      readiness
    };
    await writeExclusive(manifestFile, Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));
    manifestCreated = true;
    await migrationSource.assertSourceUnchanged(sourceFile, source.sourceFileChecksum);
    console.log(JSON.stringify({
      ok: readiness.postgresqlImportAllowed,
      source: sourceFile,
      sourceFileChecksum: source.sourceFileChecksum,
      protectedCopy: outputFile,
      protectedCopyChecksum: prepared.sourceFileChecksum,
      repairManifest: manifestFile,
      sourceOrigin: manifest.sourceOrigin,
      renderServiceId: manifest.renderServiceId,
      provenanceSignatureAlgorithm: manifest.signature.algorithm,
      exactDuplicateRepairs: collapsed.repairs,
      ...readiness,
      message: readiness.postgresqlImportAllowed
        ? 'Signed Render live-disk PostgreSQL source is structurally ready. Use its protected-copy checksum and provenance manifest for preflight, import, and verification.'
        : 'The exact duplicate copy is preserved, but unresolved identities or assignments still block PostgreSQL import. Resolve them explicitly and prepare a fresh copy from the current live source.'
    }, null, 2));
    process.exitCode = readiness.postgresqlImportAllowed ? 0 : 2;
  } catch (error) {
    if (manifestCreated) await fs.unlink(manifestFile).catch(() => {});
    if (outputCreated) await fs.unlink(outputFile).catch(() => {});
    throw error;
  } finally {
    if (lock) await stateMigrationLock.release(lock);
  }
}

main().catch(error => {
  console.error(error.stack || error);
  if (error && error.conflicts) console.error(JSON.stringify(error.conflicts, null, 2));
  process.exit(1);
});
