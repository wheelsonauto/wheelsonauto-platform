'use strict';

const assert = require('node:assert');
const runner = require('./run-postgres-recovery-drill');

class FakeClient {
  constructor(configuration, behavior, calls) {
    this.configuration = configuration;
    this.behavior = behavior;
    this.calls = calls;
  }

  async connect() {
    this.calls.push(['connect', this.configuration.connectionString]);
  }

  async query(sql, values) {
    this.calls.push(['query', sql, values || []]);
    return this.behavior(sql, values || [], this.configuration);
  }

  async end() {
    this.calls.push(['end', this.configuration.connectionString]);
  }
}

async function main() {
  assert.strictEqual(runner.normalizeDatabaseName('WheelsonAuto_Recovery_Drill'), 'wheelsonauto_recovery_drill');
  assert.throws(() => runner.normalizeDatabaseName('production'), /include "recovery_drill"/i);
  assert.throws(() => runner.normalizeDatabaseName('recovery_drill;drop database live'), /lowercase letters/i);
  assert.throws(() => runner.parsePostgresUrl('https://example.com/database', 'DATABASE_URL'), /PostgreSQL/i);

  const target = runner.buildDrillDatabaseUrl(
    'postgresql://owner:secret@private-db.internal:5432/wheelsonauto_prod?sslmode=require',
    'wheelsonauto_recovery_drill'
  );
  assert.strictEqual(target.productionDatabaseName, 'wheelsonauto_prod');
  assert.strictEqual(target.drillDatabaseName, 'wheelsonauto_recovery_drill');
  assert.strictEqual(new URL(target.testUrl).pathname, '/wheelsonauto_recovery_drill');
  assert.strictEqual(new URL(target.testUrl).searchParams.get('sslmode'), 'require');
  assert.throws(
    () => runner.buildDrillDatabaseUrl('postgresql://owner:secret@private-db.internal/wheelsonauto_recovery_drill', 'wheelsonauto_recovery_drill'),
    /different from the production database/i
  );

  const calls = [];
  const clientFactory = configuration => new FakeClient(configuration, sql => {
    if (sql.startsWith('SELECT 1 FROM pg_database')) return { rowCount: 0, rows: [] };
    if (sql.startsWith('CREATE DATABASE')) return { rowCount: 0, rows: [] };
    if (sql.includes('FROM pg_tables')) return { rowCount: 0, rows: [] };
    if (sql.includes("to_regclass('public.woa_state')")) return { rowCount: 1, rows: [{ table_name: null }] };
    throw new Error('Unexpected query: ' + sql);
  }, calls);
  const created = await runner.ensureIsolatedDatabase({
    productionUrl: 'postgresql://owner:secret@private-db.internal/wheelsonauto_prod',
    databaseName: 'wheelsonauto_recovery_drill',
    sslMode: 'require',
    clientFactory
  });
  assert.strictEqual(created.created, true);
  assert(calls.some(call => call[0] === 'query' && call[1] === 'CREATE DATABASE "wheelsonauto_recovery_drill" TEMPLATE template0'), 'The runner must create only the validated isolated database identifier.');
  assert(calls.some(call => call[0] === 'connect' && String(call[1]).includes('/wheelsonauto_recovery_drill')), 'The runner must inspect the new isolated database before running writes.');

  const blockedFactory = configuration => new FakeClient(configuration, sql => {
    if (sql.startsWith('SELECT 1 FROM pg_database')) return { rowCount: 1, rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM pg_tables')) return { rowCount: 1, rows: [{ tablename: 'customer_records' }] };
    throw new Error('Unexpected query: ' + sql);
  }, []);
  await assert.rejects(
    () => runner.ensureIsolatedDatabase({
      productionUrl: 'postgresql://owner:secret@private-db.internal/wheelsonauto_prod',
      databaseName: 'wheelsonauto_recovery_drill',
      clientFactory: blockedFactory
    }),
    /non-WheelsonAuto tables/i,
    'A reused database containing unrelated tables must fail closed.'
  );

  const realStateFactory = configuration => new FakeClient(configuration, sql => {
    if (sql.startsWith('SELECT 1 FROM pg_database')) return { rowCount: 1, rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM pg_tables')) return { rowCount: 0, rows: [] };
    if (sql.includes("to_regclass('public.woa_state')")) return { rowCount: 1, rows: [{ table_name: 'woa_state' }] };
    if (sql.includes('FROM woa_state')) return { rowCount: 1, rows: [{ organization_id: 'wheelsonauto' }] };
    throw new Error('Unexpected query: ' + sql);
  }, []);
  await assert.rejects(
    () => runner.ensureIsolatedDatabase({
      productionUrl: 'postgresql://owner:secret@private-db.internal/wheelsonauto_prod',
      databaseName: 'wheelsonauto_recovery_drill',
      clientFactory: realStateFactory
    }),
    /non-test organization state/i,
    'A reused database containing real organization state must fail closed even when its table names look valid.'
  );

  const environment = runner.runtimeEnvironment({
    DATABASE_URL: 'postgresql://owner:secret@private-db.internal/wheelsonauto_prod',
    WOA_POSTGRES_SSL_MODE: 'require',
    WOA_SESSION_SECRET: 'private-proof-secret',
    UNRELATED: 'preserved'
  }, target);
  assert.strictEqual(environment.WOA_TEST_DATABASE_URL, target.testUrl);
  assert.strictEqual(environment.WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL, 'postgresql://owner:secret@private-db.internal/wheelsonauto_prod');
  assert.strictEqual(environment.WOA_TEST_DATABASE_SSL_MODE, 'require');
  assert.strictEqual(environment.WOA_POSTGRES_RUNTIME_TEST_CONFIRM, '1');
  assert.strictEqual(environment.WOA_POSTGRES_RUNTIME_PROOF_RECORD, '1');
  assert.strictEqual(environment.WOA_POSTGRES_RUNTIME_PROOF_CONFIRM, '1');
  assert.strictEqual(environment.UNRELATED, 'preserved');

  await assert.rejects(
    () => runner.main({}),
    /WOA_POSTGRES_RECOVERY_DRILL_CONFIRM/,
    'The runner must refuse to create or use a database without the exact one-run confirmation.'
  );

  console.log('PostgreSQL recovery drill runner check passed: exact confirmation, isolated target naming, production-target refusal, unrelated-table/state refusal, and signed proof environment are guarded.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
