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

function run(script, dataFile, env) {
  return spawnSync(process.execPath, [script, dataFile], { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8' });
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-postgres-source-check-'));
  try {
    const dataFile = path.join(temp, 'protected-data.json');
    const value = { vehicles: [{ id: 'vehicle-source-1', vin: 'SOURCEVIN00000001' }], customers: [{ id: 'customer-source-1', email: 'source@example.com' }] };
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
    const serverSource = await fs.readFile(path.resolve(__dirname, '..', 'server.js'), 'utf8');
    const importerSource = await fs.readFile(importer, 'utf8');
    assert.match(serverSource, /stateMigrationLock\.assertWritesAllowed/, 'The production write path must enforce the shared PostgreSQL cutover lock.');
    assert.match(importerSource, /stateMigrationLock\.acquire/, 'The controlled PostgreSQL importer must acquire the shared cutover lock.');
    assert.match(importerSource, /stateMigrationLock\.release/, 'The controlled PostgreSQL importer must release its lock after success or failure.');
    console.log('PostgreSQL protected-source check passed: exact preflight checksum, immutable source guard, enforced application write lock, single-import ownership, and changed-source rejection are verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
