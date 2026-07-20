'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const stateRepository = require('../state-repository');
const migrationSource = require('../postgres-migration-source');
const migrationMaintenanceLease = require('../migration-maintenance-lease');
const stateMigrationLock = require('../state-migration-lock');
const vehicleIdentityRepair = require('../vehicle-identity-repair');
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

function normalizedPortalIdentity(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function disabledPortalAccount(account = {}) {
  return /disabled|removed|inactive|closed/i.test(String(account.status || ''))
    || /denied|rejected|cancelled|removed/i.test(String(account.portalStage || ''));
}

function archiveDisabledDuplicatePortalUsernames(input = {}, options = {}) {
  const state = JSON.parse(JSON.stringify(input || {}));
  const accounts = Array.isArray(state.customerAccounts) ? state.customerAccounts : [];
  const groups = new Map();
  const used = new Set(accounts.map(account => normalizedPortalIdentity(account && account.username)).filter(Boolean));
  accounts.forEach((account, index) => {
    const username = normalizedPortalIdentity(account && account.username);
    if (!username) return;
    const rows = groups.get(username) || [];
    rows.push({ account, index });
    groups.set(username, rows);
  });

  const repairs = [];
  groups.forEach((rows, username) => {
    if (rows.length < 2) return;
    const active = rows.filter(row => !disabledPortalAccount(row.account));
    const archived = rows.filter(row => disabledPortalAccount(row.account));
    const names = new Set(rows.map(row => normalizedPortalIdentity(row.account.name || row.account.customer)).filter(Boolean));
    const samePerson = names.size === 1
      && rows.every(row => normalizedPortalIdentity(row.account.email) === username);
    if (active.length !== 1 || !archived.length || !samePerson) return;

    archived.forEach(row => {
      const accountId = String(row.account.id || ('customer-account-' + row.index)).trim();
      let archivedUsername = 'archived-' + accountId + '@wheelsonauto.invalid';
      let counter = 2;
      while (used.has(normalizedPortalIdentity(archivedUsername))) {
        archivedUsername = 'archived-' + accountId + '-' + counter + '@wheelsonauto.invalid';
        counter += 1;
      }
      used.add(normalizedPortalIdentity(archivedUsername));
      row.account.username = archivedUsername;
      row.account.loginReady = false;
      row.account.portalIdentityArchivedAt = String(options.preparedAt || new Date().toISOString());
      row.account.portalIdentityArchiveReason = 'Duplicate disabled login archived during protected PostgreSQL source preparation; application and customer history retained.';
      repairs.push({
        collection: 'customerAccounts',
        resourceType: 'customer_account',
        resourceId: accountId,
        authoritativeAccountId: String(active[0].account.id || '').trim(),
        applicationId: String(row.account.applicationId || '').trim(),
        previousUsername: username,
        archivedUsername,
        status: String(row.account.status || '').trim(),
        portalStage: String(row.account.portalStage || '').trim()
      });
    });
  });
  return { state, repairs };
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
  const captureLease = await migrationMaintenanceLease.assertActiveLease({ environment: process.env });
  const source = await migrationSource.readSource(sourceFile);
  const expectedChecksum = migrationSource.requiredExpectedChecksum(process.env, 'WOA_POSTGRES_SOURCE_REPAIR_SHA256');
  migrationSource.assertExpectedChecksum(source.sourceFileChecksum, expectedChecksum, 'Live JSON source selected for protected-copy preparation');
  const vehicleIdentity = vehicleIdentityRepair.repairDuplicateVehicleIdentities(source.state, {
    requireResolvableReferences: true
  });
  if (vehicleIdentity.repairs.length && process.env.WOA_POSTGRES_SOURCE_VEHICLE_REKEY_CONFIRM !== 'DETERMINISTIC_VIN_REFERENCES_ONLY') {
    throw new Error('Set WOA_POSTGRES_SOURCE_VEHICLE_REKEY_CONFIRM=DETERMINISTIC_VIN_REFERENCES_ONLY to re-key non-identical duplicate vehicle IDs only when every affected reference has unique VIN/source/plate/name/customer/tracker evidence.');
  }
  if (!vehicleIdentity.ready) {
    const error = new Error('A duplicated vehicle ID cannot be repaired deterministically. No output was written; owner review is required.');
    error.code = 'woa_ambiguous_duplicate_vehicle_identity';
    error.conflicts = vehicleIdentity.conflicts.concat(vehicleIdentity.unresolvedReferences);
    throw error;
  }
  const plan = stateRepository.exactDuplicateCriticalResourcePlan(vehicleIdentity.state);
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
    const collapsed = stateRepository.collapseExactDuplicateCriticalResources(vehicleIdentity.state);
    const preparedAt = new Date().toISOString();
    const portalIdentity = archiveDisabledDuplicatePortalUsernames(collapsed.state, { preparedAt });
    if (portalIdentity.repairs.length && process.env.WOA_POSTGRES_SOURCE_DISABLED_PORTAL_ARCHIVE_CONFIRM !== 'ARCHIVE_DISABLED_DUPLICATE_LOGINS_ONLY') {
      throw new Error('Set WOA_POSTGRES_SOURCE_DISABLED_PORTAL_ARCHIVE_CONFIRM=ARCHIVE_DISABLED_DUPLICATE_LOGINS_ONLY to archive only disabled or denied duplicate portal usernames when one active account for the same name and email remains authoritative.');
    }
    collapsed.state = portalIdentity.state;
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
    if (vehicleIdentity.repairs.length) {
      const vehicleRepairId = 'postgres-source-vehicle-rekey-' + source.sourceFileChecksum.slice(0, 24);
      collapsed.state.migrationSourceRepairs = (Array.isArray(collapsed.state.migrationSourceRepairs) ? collapsed.state.migrationSourceRepairs : [])
        .filter(row => row && row.id !== vehicleRepairId);
      collapsed.state.migrationSourceRepairs.push({
        id: vehicleRepairId,
        preparedAt,
        sourceFileChecksum: source.sourceFileChecksum,
        policy: 'non-identical duplicate vehicle IDs with unique VINs; dependent references changed only with one uniquely strongest VIN/source/plate/name/customer/tracker match',
        repairs: vehicleIdentity.repairs,
        referenceRepairs: vehicleIdentity.referenceRepairs,
        resolvedReferences: vehicleIdentity.resolvedReferences
      });
    }
    if (portalIdentity.repairs.length) {
      const portalRepairId = 'postgres-source-disabled-portal-archive-' + source.sourceFileChecksum.slice(0, 24);
      collapsed.state.migrationSourceRepairs = (Array.isArray(collapsed.state.migrationSourceRepairs) ? collapsed.state.migrationSourceRepairs : [])
        .filter(row => row && row.id !== portalRepairId);
      collapsed.state.migrationSourceRepairs.push({
        id: portalRepairId,
        preparedAt,
        sourceFileChecksum: source.sourceFileChecksum,
        policy: 'duplicate portal username archived only on disabled or denied same-name, same-email accounts while exactly one active account remains authoritative',
        repairs: portalIdentity.repairs
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
      maintenanceLease: captureLease,
      policy: 'Canonical byte-equivalent records may be collapsed. Non-identical duplicate vehicles may be re-keyed only with unique VINs and uniquely matching dependent-reference evidence. Disabled same-person duplicate portal usernames may be archived only when exactly one active account remains. Assignments are never guessed.',
      repairs: collapsed.repairs.concat(vehicleIdentity.repairs, portalIdentity.repairs)
    });
    const manifest = {
      ...signedProvenance,
      repairs: collapsed.repairs,
      deterministicVehicleIdentityRepairs: vehicleIdentity.repairs,
      deterministicVehicleReferenceRepairs: vehicleIdentity.referenceRepairs,
      deterministicVehicleResolvedReferences: vehicleIdentity.resolvedReferences,
      archivedDisabledPortalIdentityRepairs: portalIdentity.repairs,
      readiness
    };
    await writeExclusive(manifestFile, Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));
    manifestCreated = true;
    await migrationSource.assertSourceUnchanged(sourceFile, source.sourceFileChecksum);
    const completionLease = await migrationMaintenanceLease.assertActiveLease({ environment: process.env });
    if (completionLease.instanceId !== captureLease.instanceId
      || completionLease.renderCommit !== captureLease.renderCommit
      || completionLease.startedAt !== captureLease.startedAt) {
      throw new Error('The deployed maintenance process restarted while the protected PostgreSQL source was being prepared. The incomplete source was removed; capture a fresh copy.');
    }
    console.log(JSON.stringify({
      ok: readiness.postgresqlImportAllowed,
      source: sourceFile,
      sourceFileChecksum: source.sourceFileChecksum,
      protectedCopy: outputFile,
      protectedCopyChecksum: prepared.sourceFileChecksum,
      repairManifest: manifestFile,
      sourceOrigin: manifest.sourceOrigin,
      renderServiceId: manifest.renderServiceId,
      maintenanceRenderCommit: manifest.maintenanceRenderCommit,
      maintenanceInstanceId: manifest.maintenanceInstanceId,
      provenanceSignatureAlgorithm: manifest.signature.algorithm,
      exactDuplicateRepairs: collapsed.repairs,
      deterministicVehicleIdentityRepairs: vehicleIdentity.repairs,
      deterministicVehicleReferenceRepairs: vehicleIdentity.referenceRepairs,
      archivedDisabledPortalIdentityRepairs: portalIdentity.repairs,
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
