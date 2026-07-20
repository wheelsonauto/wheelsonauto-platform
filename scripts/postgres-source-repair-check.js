'use strict';

const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const migrationSource = require('../postgres-migration-source');
const migrationMaintenanceLease = require('../migration-maintenance-lease');

const root = path.resolve(__dirname, '..');
const repairScript = path.join(__dirname, 'prepare-postgres-migration-source.js');
const preflightScript = path.join(__dirname, 'postgres-preflight.js');
const importerScript = path.join(__dirname, 'migrate-json-to-postgres.js');
const verifierScript = path.join(__dirname, 'verify-json-to-postgres.js');

function run(script, args, env = {}) {
  return spawnSync(process.execPath, [script].concat(args), {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-postgres-source-repair-'));
  try {
    const captureEnvironment = {
      DATA_DIR: temp,
      WOA_MIGRATION_MAINTENANCE_MODE: '1',
      WOA_POSTGRES_SOURCE_ORIGIN_CONFIRM: migrationSource.SOURCE_ORIGIN_CONFIRMATION,
      WOA_SESSION_SECRET: 'postgres-source-repair-test-secret-2026',
      RENDER_SERVICE_ID: 'srv-wheelsonauto-source-repair-test',
      RENDER_GIT_COMMIT: 'abcdef1234567890abcdef1234567890abcdef12'
    };
    const activeLease = await migrationMaintenanceLease.publishLease({ environment: captureEnvironment, maintenanceMode: true });
    const sourceFile = path.join(temp, 'live-source.json');
    const outputFile = path.join(temp, 'protected-source.json');
    const exactPayment = {
      id: 'clover-payment-exact-duplicate',
      customer: 'Exact Duplicate Customer',
      amount: 229,
      status: 'FAIL',
      date: '7/10/2026',
      cloverPaymentId: 'CLOVER-EXACT-DUPLICATE',
      source: 'Clover'
    };
    const exactState = {
      vehicles: [{ id: 'vehicle-source-repair-1', vin: 'REPAIRVIN00000001', status: 'Ready' }],
      payments: [exactPayment, { ...exactPayment }],
      customers: [],
      recurringPayments: []
    };
    const sourceBytes = JSON.stringify(exactState, null, 2) + '\n';
    await fs.writeFile(sourceFile, sourceBytes, 'utf8');
    const sourceChecksum = (await migrationSource.readSource(sourceFile)).sourceFileChecksum;

    const unconfirmed = run(repairScript, [sourceFile, outputFile]);
    assert.notStrictEqual(unconfirmed.status, 0, 'Protected-source repair must require an explicit exact-duplicate confirmation.');
    assert.match(unconfirmed.stderr, /WOA_POSTGRES_SOURCE_REPAIR_CONFIRM/, 'The repair tool must name its confirmation guard.');
    assert.strictEqual(await exists(outputFile), false, 'An unconfirmed repair must not create an output file.');

    const wrongChecksum = run(repairScript, [sourceFile, outputFile], {
      ...captureEnvironment,
      WOA_POSTGRES_SOURCE_REPAIR_CONFIRM: 'EXACT_DUPLICATES_ONLY',
      WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM: '1',
      WOA_POSTGRES_SOURCE_REPAIR_SHA256: '0'.repeat(64)
    });
    assert.notStrictEqual(wrongChecksum.status, 0, 'A changed or wrong live-source checksum must block protected-copy preparation.');
    assert.match(wrongChecksum.stderr, /checksum does not match/i, 'The checksum refusal must be explicit.');
    assert.strictEqual(await exists(outputFile), false, 'A checksum mismatch must not create an output file.');

    const missingOriginOutput = path.join(temp, 'missing-origin-output.json');
    const missingOrigin = run(repairScript, [sourceFile, missingOriginOutput], {
      ...captureEnvironment,
      WOA_POSTGRES_SOURCE_ORIGIN_CONFIRM: '',
      WOA_POSTGRES_SOURCE_REPAIR_CONFIRM: 'EXACT_DUPLICATES_ONLY',
      WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM: '1',
      WOA_POSTGRES_SOURCE_REPAIR_SHA256: sourceChecksum
    });
    assert.notStrictEqual(missingOrigin.status, 0, 'A developer checkout or unproven source must not produce an importable migration snapshot.');
    assert.match(missingOrigin.stderr, /WOA_POSTGRES_SOURCE_ORIGIN_CONFIRM/, 'Protected-source capture must require the Render live-disk origin confirmation.');
    assert.strictEqual(await exists(missingOriginOutput), false, 'A failed provenance check must remove its incomplete protected copy.');

    const repaired = run(repairScript, [sourceFile, outputFile], {
      ...captureEnvironment,
      WOA_POSTGRES_SOURCE_REPAIR_CONFIRM: 'EXACT_DUPLICATES_ONLY',
      WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM: '1',
      WOA_POSTGRES_SOURCE_REPAIR_SHA256: sourceChecksum
    });
    assert.strictEqual(repaired.status, 0, repaired.stderr || 'An exact duplicate should produce a structurally ready protected copy.');
    const report = JSON.parse(repaired.stdout);
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.postgresqlImportAllowed, true);
    assert.strictEqual(report.exactDuplicateRepairs.length, 1);
    assert.strictEqual(report.exactDuplicateRepairs[0].removedCount, 1);
    assert.strictEqual(await fs.readFile(sourceFile, 'utf8'), sourceBytes, 'Protected-copy preparation must never rewrite the live source.');
    const prepared = JSON.parse(await fs.readFile(outputFile, 'utf8'));
    assert.strictEqual(prepared.payments.length, 1, 'Only one canonical copy of an exact duplicate critical record should survive.');
    assert.strictEqual(prepared.payments[0].id, exactPayment.id);
    assert.strictEqual(prepared.migrationSourceRepairs.length, 1, 'The protected copy must retain its exact-repair evidence.');
    assert.strictEqual(prepared.migrationSourceRepairs[0].sourceFileChecksum, sourceChecksum);
    assert.strictEqual((await fs.stat(outputFile)).mode & 0o777, 0o600, 'The protected copy must be owner-readable only.');
    const manifestFile = outputFile + '.repair-manifest.json';
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    assert.strictEqual(manifest.sourceFileChecksum, sourceChecksum);
    assert.strictEqual(manifest.protectedCopyChecksum, report.protectedCopyChecksum);
    assert.strictEqual(manifest.sourceOrigin, 'render-live-disk');
    assert.strictEqual(manifest.version, migrationSource.PROVENANCE_VERSION);
    assert.strictEqual(manifest.renderServiceId, captureEnvironment.RENDER_SERVICE_ID);
    assert.strictEqual(manifest.maintenanceInstanceId, activeLease.instanceId);
    assert.strictEqual(manifest.maintenanceRenderCommit, captureEnvironment.RENDER_GIT_COMMIT);
    assert.strictEqual(manifest.signature.algorithm, 'HMAC-SHA256');
    assert.strictEqual((await fs.stat(manifestFile)).mode & 0o777, 0o600, 'The repair manifest must be owner-readable only.');
    const verifiedProvenance = await migrationSource.assertProvenanceManifest(outputFile, report.protectedCopyChecksum, {
      ...captureEnvironment,
      WOA_POSTGRES_MIGRATION_PROVENANCE_CONFIRM: migrationSource.MIGRATION_PROVENANCE_CONFIRMATION,
      WOA_POSTGRES_MIGRATION_SOURCE_MANIFEST: manifestFile
    });
    assert.strictEqual(verifiedProvenance.renderServiceId, captureEnvironment.RENDER_SERVICE_ID, 'The importer must verify the service-bound signed manifest.');
    const preparedPreflight = run(preflightScript, [outputFile]);
    assert.strictEqual(preparedPreflight.status, 0, 'The repaired protected copy must pass the ordinary PostgreSQL preflight.');

    const vehicleSource = path.join(temp, 'duplicate-vehicle-source.json');
    const vehicleOutput = path.join(temp, 'duplicate-vehicle-output.json');
    const duplicateVehicleState = {
      vehicles: [
        { id: 'veh-sheet-004', year: '2017', make: 'Chevy', model: 'trax Red', vin: '3GNCJNSB9HL190487', plate: 'M97wuv', status: 'Rented', currentCustomer: 'Rudolph vernon Hawkes', sourceRow: 51 },
        { id: 'veh-sheet-004', year: '2014', make: 'Dodge', model: 'Ram Cargo', vin: '2C4JRGAG5ER182015', plate: 'Y61www', status: 'Rented', currentCustomer: 'Dominique tatiana bruce', sourceRow: 4 }
      ],
      maintenance: [
        { id: 'mnt-sheet-oil-overdue-51', vehicleId: 'veh-sheet-004', vehicle: '2017 Chevy trax Red', customer: 'Rudolph vernon Hawkes', sourceRow: 51, status: 'Scheduled' },
        { id: 'mnt-sheet-oil-overdue-4', vehicleId: 'veh-sheet-004', vehicle: '2014 Dodge Ram Cargo', customer: 'Dominique tatiana bruce', sourceRow: 4, status: 'Scheduled' }
      ],
      customers: [],
      recurringPayments: [],
      payments: []
    };
    const duplicateVehicleBytes = JSON.stringify(duplicateVehicleState, null, 2) + '\n';
    await fs.writeFile(vehicleSource, duplicateVehicleBytes, 'utf8');
    const duplicateVehicleChecksum = (await migrationSource.readSource(vehicleSource)).sourceFileChecksum;
    const vehicleRekeyUnconfirmed = run(repairScript, [vehicleSource, vehicleOutput], {
      ...captureEnvironment,
      WOA_POSTGRES_SOURCE_REPAIR_CONFIRM: 'EXACT_DUPLICATES_ONLY',
      WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM: '1',
      WOA_POSTGRES_SOURCE_REPAIR_SHA256: duplicateVehicleChecksum
    });
    assert.notStrictEqual(vehicleRekeyUnconfirmed.status, 0, 'A non-identical duplicate vehicle ID must require its own narrow confirmation.');
    assert.match(vehicleRekeyUnconfirmed.stderr, /WOA_POSTGRES_SOURCE_VEHICLE_REKEY_CONFIRM/);
    assert.strictEqual(await exists(vehicleOutput), false, 'An unconfirmed vehicle re-key must not create a protected output.');

    const vehicleRekey = run(repairScript, [vehicleSource, vehicleOutput], {
      ...captureEnvironment,
      WOA_POSTGRES_SOURCE_REPAIR_CONFIRM: 'EXACT_DUPLICATES_ONLY',
      WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM: '1',
      WOA_POSTGRES_SOURCE_REPAIR_SHA256: duplicateVehicleChecksum,
      WOA_POSTGRES_SOURCE_VEHICLE_REKEY_CONFIRM: 'DETERMINISTIC_VIN_REFERENCES_ONLY'
    });
    assert.strictEqual(vehicleRekey.status, 0, vehicleRekey.stderr || 'Distinct VIN and maintenance evidence should allow a protected vehicle-ID repair.');
    const vehicleRekeyReport = JSON.parse(vehicleRekey.stdout);
    assert.strictEqual(vehicleRekeyReport.deterministicVehicleIdentityRepairs.length, 1);
    assert.strictEqual(vehicleRekeyReport.deterministicVehicleReferenceRepairs.length, 1);
    assert.strictEqual(await fs.readFile(vehicleSource, 'utf8'), duplicateVehicleBytes, 'Vehicle-ID repair must preserve the live source byte-for-byte.');
    const vehiclePrepared = JSON.parse(await fs.readFile(vehicleOutput, 'utf8'));
    assert.strictEqual(new Set(vehiclePrepared.vehicles.map(vehicle => vehicle.id)).size, 2, 'Protected output must contain unique vehicle IDs.');
    assert.strictEqual(vehiclePrepared.maintenance[0].vehicleId, vehiclePrepared.vehicles[0].id, 'The Chevy maintenance row must remain linked to the Chevy.');
    assert.strictEqual(vehiclePrepared.maintenance[1].vehicleId, vehiclePrepared.vehicles[1].id, 'The Dodge maintenance row must follow the re-keyed Dodge.');
    assert(vehiclePrepared.migrationSourceRepairs.some(row => /vehicle-rekey/.test(row.id)), 'Protected output must preserve an auditable vehicle re-key record.');
    const vehicleManifest = JSON.parse(await fs.readFile(vehicleOutput + '.repair-manifest.json', 'utf8'));
    assert.strictEqual(vehicleManifest.deterministicVehicleIdentityRepairs.length, 1);
    assert.strictEqual(vehicleManifest.deterministicVehicleReferenceRepairs.length, 1);

    const ambiguousVehicleSource = path.join(temp, 'ambiguous-vehicle-source.json');
    const ambiguousVehicleOutput = path.join(temp, 'ambiguous-vehicle-output.json');
    const ambiguousVehicleState = JSON.parse(JSON.stringify(duplicateVehicleState));
    ambiguousVehicleState.maintenance = [{ id: 'mnt-ambiguous-vehicle', vehicleId: 'veh-sheet-004', status: 'Scheduled' }];
    await fs.writeFile(ambiguousVehicleSource, JSON.stringify(ambiguousVehicleState, null, 2) + '\n', 'utf8');
    const ambiguousVehicleChecksum = (await migrationSource.readSource(ambiguousVehicleSource)).sourceFileChecksum;
    const ambiguousVehicleRepair = run(repairScript, [ambiguousVehicleSource, ambiguousVehicleOutput], {
      ...captureEnvironment,
      WOA_POSTGRES_SOURCE_REPAIR_CONFIRM: 'EXACT_DUPLICATES_ONLY',
      WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM: '1',
      WOA_POSTGRES_SOURCE_REPAIR_SHA256: ambiguousVehicleChecksum,
      WOA_POSTGRES_SOURCE_VEHICLE_REKEY_CONFIRM: 'DETERMINISTIC_VIN_REFERENCES_ONLY'
    });
    assert.notStrictEqual(ambiguousVehicleRepair.status, 0, 'An evidence-free duplicate vehicle reference must keep migration blocked.');
    assert.match(ambiguousVehicleRepair.stderr, /cannot be repaired deterministically/i);
    assert.strictEqual(await exists(ambiguousVehicleOutput), false, 'An ambiguous vehicle reference must not produce a migration copy.');

    const overwriteAttempt = run(repairScript, [sourceFile, outputFile], {
      ...captureEnvironment,
      WOA_POSTGRES_SOURCE_REPAIR_CONFIRM: 'EXACT_DUPLICATES_ONLY',
      WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM: '1',
      WOA_POSTGRES_SOURCE_REPAIR_SHA256: sourceChecksum
    });
    assert.notStrictEqual(overwriteAttempt.status, 0, 'The repair tool must never overwrite an existing protected copy.');
    assert.strictEqual(JSON.parse(await fs.readFile(outputFile, 'utf8')).payments.length, 1, 'A refused overwrite must leave the original protected copy intact.');

    const conflictSource = path.join(temp, 'nonidentical-source.json');
    const conflictOutput = path.join(temp, 'nonidentical-output.json');
    await fs.writeFile(conflictSource, JSON.stringify({
      payments: [exactPayment, { ...exactPayment, status: 'Paid' }]
    }, null, 2) + '\n', 'utf8');
    const conflictChecksum = (await migrationSource.readSource(conflictSource)).sourceFileChecksum;
    const nonidentical = run(repairScript, [conflictSource, conflictOutput], {
      ...captureEnvironment,
      WOA_POSTGRES_SOURCE_REPAIR_CONFIRM: 'EXACT_DUPLICATES_ONLY',
      WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM: '1',
      WOA_POSTGRES_SOURCE_REPAIR_SHA256: conflictChecksum
    });
    assert.notStrictEqual(nonidentical.status, 0, 'Two different records sharing an ID must never be collapsed automatically.');
    assert.match(nonidentical.stderr, /different data/i);
    assert.strictEqual(await exists(conflictOutput), false, 'A non-identical duplicate must not create a protected copy.');

    const assignmentSource = path.join(temp, 'assignment-source.json');
    const assignmentOutput = path.join(temp, 'assignment-output.json');
    await fs.writeFile(assignmentSource, JSON.stringify({
      vehicles: [{ id: 'vehicle-assignment-review', vin: 'ASSIGNMENTVIN002', status: 'Rented', currentCustomer: 'Customer Alpha' }],
      payments: [exactPayment, { ...exactPayment }],
      customers: [
        { id: 'customer-assignment-alpha', customer: 'Customer Alpha', vehicleId: 'vehicle-assignment-review', status: 'Active' },
        { id: 'customer-assignment-beta', customer: 'Customer Beta', vehicleId: 'vehicle-assignment-review', status: 'Active' }
      ]
    }, null, 2) + '\n', 'utf8');
    const assignmentChecksum = (await migrationSource.readSource(assignmentSource)).sourceFileChecksum;
    const assignmentRepair = run(repairScript, [assignmentSource, assignmentOutput], {
      ...captureEnvironment,
      WOA_POSTGRES_SOURCE_REPAIR_CONFIRM: 'EXACT_DUPLICATES_ONLY',
      WOA_POSTGRES_SOURCE_REPAIR_MAINTENANCE_CONFIRM: '1',
      WOA_POSTGRES_SOURCE_REPAIR_SHA256: assignmentChecksum
    });
    assert.strictEqual(assignmentRepair.status, 2, 'A safe exact-duplicate copy may be created, but an unrelated customer-assignment conflict must keep it blocked.');
    const assignmentReport = JSON.parse(assignmentRepair.stdout);
    assert.strictEqual(assignmentReport.postgresqlImportAllowed, false);
    assert(assignmentReport.structuralErrors.some(error => error.kind === 'woa_assignment_identity_conflict'));
    assert.strictEqual(JSON.parse(await fs.readFile(assignmentOutput, 'utf8')).payments.length, 1, 'The safe exact duplicate should still be collapsed in the review copy.');
    const assignmentOutputChecksum = (await migrationSource.readSource(assignmentOutput)).sourceFileChecksum;
    const importerBlocked = run(importerScript, [assignmentOutput], {
      WOA_POSTGRES_MIGRATION_CONFIRM: '1',
      WOA_POSTGRES_MIGRATION_MAINTENANCE_CONFIRM: '1',
      WOA_POSTGRES_MIGRATION_SOURCE_SHA256: assignmentOutputChecksum,
      DATABASE_URL: ''
    });
    assert.notStrictEqual(importerBlocked.status, 0);
    assert.match(importerBlocked.stderr, /multiple customers/i, 'The importer must reject an assignment conflict before asking for or opening PostgreSQL.');
    assert.doesNotMatch(importerBlocked.stderr, /DATABASE_URL is required/, 'An unsafe source must fail before database configuration is considered.');
    const verifierBlocked = run(verifierScript, [assignmentOutput], {
      WOA_POSTGRES_MIGRATION_PROOF_CONFIRM: '1',
      WOA_POSTGRES_MIGRATION_SOURCE_SHA256: assignmentOutputChecksum,
      DATABASE_URL: ''
    });
    assert.notStrictEqual(verifierBlocked.status, 0);
    assert.match(verifierBlocked.stderr, /multiple customers/i, 'Migration proof must reject an assignment conflict before opening PostgreSQL.');

    console.log('PostgreSQL source repair check passed: live source preservation, checksum lock, maintenance lock, exact duplicate collapse, immutable manifest, no overwrite, non-identical refusal, assignment review, and pre-database importer/proof guards are verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
