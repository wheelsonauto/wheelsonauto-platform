'use strict';

const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = require('../postgres-migration-source');
const stateMigrationLock = require('../state-migration-lock');

const importer = path.join(__dirname, 'migrate-json-to-postgres.js');
const verifier = path.join(__dirname, 'verify-json-to-postgres.js');
const lockRecovery = path.join(__dirname, 'recover-postgres-migration-lock.js');
const preflight = path.join(__dirname, 'postgres-preflight.js');

function run(script, dataFile, env) {
  return spawnSync(process.execPath, [script, dataFile], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' });
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-postgres-source-check-'));
  try {
    const dataFile = path.join(temp, 'protected-data.json');
    const value = { vehicles: [{ id: 'vehicle-source-1', vin: 'SOURCEVIN00000001' }], customers: [{ id: 'customer-source-1', email: 'source@example.com' }] };
    await fs.writeFile(dataFile, JSON.stringify(value, null, 2), 'utf8');
    const validPreflight = run(preflight, dataFile, process.env);
    assert.strictEqual(validPreflight.status, 0, 'A structurally coherent protected source must pass PostgreSQL preflight.');
    assert.strictEqual(JSON.parse(validPreflight.stdout).postgresqlImportAllowed, true, 'A passing preflight must explicitly authorize the protected source for import.');
    await fs.writeFile(dataFile, JSON.stringify({
      vehicles: [
        { id: 'vehicle-assignment-conflict', vin: 'ASSIGNMENTVIN0001', status: 'Rented' },
        { id: 'vehicle-assignment-conflict-2', vin: 'ASSIGNMENTVIN0002', status: 'Rented' }
      ],
      customers: [
        { id: 'customer-assignment-a', name: 'Customer Alpha', vehicleId: 'vehicle-assignment-conflict', status: 'Active' },
        { id: 'customer-assignment-b', name: 'Customer Beta', vehicleId: 'vehicle-assignment-conflict', status: 'Active' },
        { id: 'customer-assignment-c', name: 'Customer Gamma', vehicleId: 'vehicle-assignment-conflict-2', status: 'Active' },
        { id: 'customer-assignment-d', name: 'Customer Delta', vehicleId: 'vehicle-assignment-conflict-2', status: 'Active' }
      ]
    }, null, 2), 'utf8');
    const assignmentConflictPreflight = run(preflight, dataFile, process.env);
    assert.strictEqual(assignmentConflictPreflight.status, 2, 'Two active customers claiming one vehicle must block PostgreSQL preflight before migration starts.');
    const assignmentConflictReport = JSON.parse(assignmentConflictPreflight.stdout);
    assert.strictEqual(assignmentConflictReport.postgresqlImportAllowed, false);
    assert.strictEqual(assignmentConflictReport.structuralErrors.filter(error => error.kind === 'woa_assignment_identity_conflict').length, 2, 'Preflight must enumerate every active vehicle-assignment conflict in one run instead of stopping at the first car.');
    assert.strictEqual(assignmentConflictReport.counts.activeAssignmentConflicts, 2, 'Preflight counts must distinguish transactional assignment conflicts from valid assignment index rows.');
    await fs.writeFile(dataFile, JSON.stringify({
      payments: [
        { id: 'payment-provider-a', stripeChargeId: 'ch_preflight_duplicate' },
        { id: 'payment-provider-b', stripeChargeId: 'ch_preflight_duplicate' }
      ]
    }, null, 2), 'utf8');
    const providerConflictPreflight = run(preflight, dataFile, process.env);
    assert.strictEqual(providerConflictPreflight.status, 2, 'A duplicated provider transaction identity must block PostgreSQL preflight.');
    const providerConflictReport = JSON.parse(providerConflictPreflight.stdout);
    assert(providerConflictReport.conflicts.some(conflict => conflict.kind === 'stripe_charge'), 'Preflight must expose which immutable provider identity is duplicated.');
    await fs.writeFile(dataFile, JSON.stringify({
      payments: [
        { id: 'payment-exact-a', cloverPaymentId: 'exact-a', status: 'Paid' },
        { id: 'payment-exact-a', cloverPaymentId: 'exact-a', status: 'Paid' },
        { id: 'payment-exact-b', cloverPaymentId: 'exact-b', status: 'FAIL' },
        { id: 'payment-exact-b', cloverPaymentId: 'exact-b', status: 'FAIL' }
      ]
    }, null, 2), 'utf8');
    const exactDuplicatePreflight = run(preflight, dataFile, process.env);
    assert.strictEqual(exactDuplicatePreflight.status, 2, 'Canonical-identical critical records must remain blocked until a protected repair copy is prepared.');
    const exactDuplicateReport = JSON.parse(exactDuplicatePreflight.stdout);
    assert.strictEqual(exactDuplicateReport.repairableExactDuplicates.length, 2, 'Preflight must report every exact duplicate group in one run instead of stopping at the first ID.');
    assert.strictEqual(exactDuplicateReport.counts.repairableExactDuplicateGroups, 2);
    assert.strictEqual(exactDuplicateReport.counts.repairableExactDuplicateCopies, 2);
    assert.strictEqual(exactDuplicateReport.nonidenticalCriticalDuplicates.length, 0);
    assert(exactDuplicateReport.nextSteps.some(step => /prepare-postgres-migration-source/.test(step)), 'Exact duplicate preflight must direct the operator to the checksum-locked protected-copy tool.');
    await fs.writeFile(dataFile, JSON.stringify(value, null, 2), 'utf8');
    const snapshot = await source.readSource(dataFile);
    assert(source.validChecksum(snapshot.sourceFileChecksum), 'The protected-source checksum must be SHA-256.');
    assert.strictEqual(source.requiredExpectedChecksum({ WOA_POSTGRES_MIGRATION_SOURCE_SHA256: snapshot.sourceFileChecksum }), snapshot.sourceFileChecksum, 'The preflight source checksum must be accepted exactly.');
    assert.throws(() => source.requiredExpectedChecksum({}), /WOA_POSTGRES_MIGRATION_SOURCE_SHA256/, 'A PostgreSQL import must require the exact checksum printed by preflight.');
    await source.assertSourceUnchanged(dataFile, snapshot.sourceFileChecksum);
    await fs.writeFile(dataFile, JSON.stringify({ ...value, customers: value.customers.concat({ id: 'customer-source-2' }) }, null, 2), 'utf8');
    await assert.rejects(() => source.assertSourceUnchanged(dataFile, snapshot.sourceFileChecksum), /changed while the migration was running/i, 'A changed JSON source must block migration proof/import before cutover.');
    assert.throws(() => source.assertExpectedChecksum('f'.repeat(64), snapshot.sourceFileChecksum), /does not match/i, 'A source checksum mismatch must fail closed.');

    await stateMigrationLock.assertWritesAllowed({ dataFile });
    const lock = await stateMigrationLock.acquire({ dataFile, sourceFileChecksum: snapshot.sourceFileChecksum });
    await assert.rejects(() => stateMigrationLock.assertWritesAllowed({ dataFile }), error => error && error.code === 'woa_postgres_migration_write_lock' && error.statusCode === 503, 'The running app must reject every state write while the cutover lock exists.');
    await assert.rejects(() => stateMigrationLock.acquire({ dataFile }), /already exists/i, 'A second PostgreSQL import must not start while the first cutover lock exists.');
    await assert.rejects(() => stateMigrationLock.release({ ...lock, token: 'wrong-owner-token' }), /another or unknown process/i, 'One process must not release another migration process lock.');
    assert.strictEqual((await stateMigrationLock.lockStatus({ dataFile })).active, true, 'An ownership mismatch must leave the migration lock active.');
    assert.strictEqual((await stateMigrationLock.release(lock)).released, true, 'The process that acquired the cutover lock must be able to restore writes.');
    await stateMigrationLock.assertWritesAllowed({ dataFile });

    await fs.writeFile(dataFile, JSON.stringify(value, null, 2), 'utf8');
    const recoveryChecksum = (await source.readSource(dataFile)).sourceFileChecksum;
    const staleLock = await stateMigrationLock.acquire({ dataFile, sourceFileChecksum: recoveryChecksum });
    await assert.rejects(
      () => stateMigrationLock.recoverStale({ dataFile, expectedSourceChecksum: recoveryChecksum, minAgeMs: 60_000 }),
      error => error && error.code === 'woa_postgres_migration_lock_not_stale',
      'A fresh migration lock must never be force-recovered while its importer may still be active.'
    );
    const staleRecord = JSON.parse(await fs.readFile(staleLock.file, 'utf8'));
    staleRecord.acquiredAt = new Date(Date.now() - 10 * 60_000).toISOString();
    await fs.writeFile(staleLock.file, JSON.stringify(staleRecord, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    await assert.rejects(
      () => stateMigrationLock.recoverStale({ dataFile, expectedSourceChecksum: '0'.repeat(64), minAgeMs: 60_000 }),
      /does not match/i,
      'Stale-lock recovery must require the exact protected-source checksum.'
    );
    await fs.writeFile(dataFile, JSON.stringify({ ...value, changedAfterLock: true }, null, 2), 'utf8');
    await assert.rejects(
      () => stateMigrationLock.recoverStale({ dataFile, expectedSourceChecksum: recoveryChecksum, minAgeMs: 60_000 }),
      /source changed/i,
      'Stale-lock recovery must keep writes blocked if the protected source changed.'
    );
    await fs.writeFile(dataFile, JSON.stringify(value, null, 2), 'utf8');
    const recoveredLock = await stateMigrationLock.recoverStale({ dataFile, expectedSourceChecksum: recoveryChecksum, minAgeMs: 60_000 });
    assert.strictEqual(recoveredLock.recovered, true, 'A checksum-matched stale migration lock must be recoverable after the safety delay.');
    assert.strictEqual((await stateMigrationLock.lockStatus({ dataFile })).active, false, 'A verified stale-lock recovery must restore application writes.');
    assert.strictEqual((await fs.stat(recoveredLock.recoveryFile)).isFile(), true, 'Stale-lock recovery must preserve the original lock metadata as evidence.');
    await stateMigrationLock.assertWritesAllowed({ dataFile });

    await fs.writeFile(dataFile, JSON.stringify(value, null, 2), 'utf8');
    const exact = (await source.readSource(dataFile)).sourceFileChecksum;
    const base = { ...process.env, WOA_POSTGRES_MIGRATION_CONFIRM: '1', WOA_POSTGRES_MIGRATION_MAINTENANCE_CONFIRM: '1' };
    const noImporterChecksum = run(importer, dataFile, base);
    assert.notStrictEqual(noImporterChecksum.status, 0, 'The importer must reject a missing protected-source checksum before it opens a database connection.');
    assert.match(noImporterChecksum.stderr, /WOA_POSTGRES_MIGRATION_SOURCE_SHA256/, 'The importer must name the required protected-source checksum.');
    const wrongImporterChecksum = run(importer, dataFile, { ...base, WOA_POSTGRES_MIGRATION_SOURCE_SHA256: '0'.repeat(64) });
    assert.notStrictEqual(wrongImporterChecksum.status, 0, 'The importer must reject the wrong preflight source checksum.');
    assert.match(wrongImporterChecksum.stderr, /does not match/i, 'The importer must explain the changed-source block.');
    const validImporterWithoutDatabase = run(importer, dataFile, { ...base, WOA_POSTGRES_MIGRATION_SOURCE_SHA256: exact });
    assert.notStrictEqual(validImporterWithoutDatabase.status, 0, 'A valid source still needs an explicit PostgreSQL database URL.');
    assert.match(validImporterWithoutDatabase.stderr, /DATABASE_URL/, 'The importer must not connect without a database URL.');

    const proofBase = { ...process.env, WOA_POSTGRES_MIGRATION_PROOF_CONFIRM: '1' };
    const noProofChecksum = run(verifier, dataFile, proofBase);
    assert.notStrictEqual(noProofChecksum.status, 0, 'The proof verifier must reject a missing protected-source checksum before it opens a database connection.');
    assert.match(noProofChecksum.stderr, /WOA_POSTGRES_MIGRATION_SOURCE_SHA256/, 'The verifier must name the required protected-source checksum.');
    const validProofWithoutDatabase = run(verifier, dataFile, { ...proofBase, WOA_POSTGRES_MIGRATION_SOURCE_SHA256: exact });
    assert.notStrictEqual(validProofWithoutDatabase.status, 0, 'A proof verification with a valid source still needs an explicit PostgreSQL database URL.');
    assert.match(validProofWithoutDatabase.stderr, /DATABASE_URL/, 'The verifier must not connect without a database URL.');
    const unconfirmedRecovery = run(lockRecovery, dataFile, process.env);
    assert.notStrictEqual(unconfirmedRecovery.status, 0, 'The stale-lock recovery CLI must require the exact destructive-action confirmation phrase.');
    assert.match(unconfirmedRecovery.stderr, /WOA_POSTGRES_MIGRATION_LOCK_RECOVERY_CONFIRM/, 'The stale-lock recovery CLI must name its required confirmation guard.');
    const serverSource = await fs.readFile(path.resolve(__dirname, '..', 'server.js'), 'utf8');
    const importerSource = await fs.readFile(importer, 'utf8');
    const verifierSource = await fs.readFile(verifier, 'utf8');
    assert.match(serverSource, /stateMigrationLock\.assertWritesAllowed/, 'The production write path must enforce the shared PostgreSQL cutover lock.');
    assert.match(importerSource, /stateMigrationLock\.acquire/, 'The controlled PostgreSQL importer must acquire the shared cutover lock.');
    assert.match(importerSource, /stateMigrationLock\.release/, 'The controlled PostgreSQL importer must release its lock after success or failure.');
    assert.match(importerSource, /assertTransactionalSourceReady/, 'The importer must reject critical resource and assignment conflicts before opening PostgreSQL.');
    assert.match(verifierSource, /assertTransactionalSourceReady/, 'Migration proof must reject critical resource and assignment conflicts before opening PostgreSQL.');
    console.log('PostgreSQL protected-source check passed: exact preflight checksum, immutable source guard, enforced application write lock, single-import ownership, checksum-gated stale-lock recovery, and changed-source rejection are verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
