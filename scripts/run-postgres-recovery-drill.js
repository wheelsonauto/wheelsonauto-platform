'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const CONFIRMATION_PHRASE = 'CREATE ISOLATED POSTGRES RECOVERY DRILL DATABASE';
const DEFAULT_DATABASE_NAME = 'wheelsonauto_recovery_drill';

function normalizeDatabaseName(value) {
  const name = String(value || DEFAULT_DATABASE_NAME).trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(name) || !name.includes('recovery_drill')) {
    throw new Error('The isolated database name must be 3-63 lowercase letters, numbers, or underscores and include "recovery_drill".');
  }
  return name;
}

function parsePostgresUrl(value, label) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(label + ' is required.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(label + ' must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(label + ' must use the postgres or postgresql protocol.');
  }
  const databaseName = decodeURIComponent(parsed.pathname || '').replace(/^\/+|\/+$/g, '');
  if (!databaseName) throw new Error(label + ' must include a database name.');
  return { parsed, databaseName };
}

function buildDrillDatabaseUrl(productionUrl, databaseName) {
  const { parsed, databaseName: productionDatabaseName } = parsePostgresUrl(productionUrl, 'DATABASE_URL');
  const drillDatabaseName = normalizeDatabaseName(databaseName);
  if (productionDatabaseName.toLowerCase() === drillDatabaseName) {
    throw new Error('The recovery drill database must be different from the production database.');
  }
  const testUrl = new URL(parsed.toString());
  testUrl.pathname = '/' + drillDatabaseName;
  return {
    productionDatabaseName,
    drillDatabaseName,
    testUrl: testUrl.toString()
  };
}

function pgSsl(mode) {
  return String(mode || '').trim().toLowerCase() === 'disable'
    ? false
    : { rejectUnauthorized: false };
}

async function ensureIsolatedDatabase(options = {}) {
  const productionUrl = String(options.productionUrl || '').trim();
  const sslMode = String(options.sslMode || '').trim();
  const target = buildDrillDatabaseUrl(productionUrl, options.databaseName);
  const clientFactory = options.clientFactory || (configuration => new Client(configuration));
  const admin = clientFactory({
    connectionString: productionUrl,
    ssl: pgSsl(sslMode),
    connectionTimeoutMillis: 15000,
    application_name: 'wheelsonauto-create-recovery-drill-database'
  });
  let created = false;
  try {
    await admin.connect();
    const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [target.drillDatabaseName]);
    if (!existing.rowCount) {
      try {
        await admin.query('CREATE DATABASE "' + target.drillDatabaseName + '" TEMPLATE template0');
        created = true;
      } catch (error) {
        if (!error || error.code !== '42P04') throw error;
      }
    }
  } finally {
    await admin.end().catch(() => {});
  }

  const drill = clientFactory({
    connectionString: target.testUrl,
    ssl: pgSsl(sslMode),
    connectionTimeoutMillis: 15000,
    application_name: 'wheelsonauto-verify-recovery-drill-database'
  });
  try {
    await drill.connect();
    const unexpectedTables = await drill.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'woa_%' ORDER BY tablename LIMIT 10"
    );
    if (unexpectedTables.rowCount) {
      throw new Error('The isolated recovery drill database contains non-WheelsonAuto tables and will not be used.');
    }
    const stateTable = await drill.query("SELECT to_regclass('public.woa_state') AS table_name");
    if (stateTable.rows[0] && stateTable.rows[0].table_name) {
      const realState = await drill.query(
        "SELECT organization_id FROM woa_state WHERE organization_id NOT LIKE 'org-postgres-runtime-test-%' AND organization_id NOT LIKE 'org-postgres-runtime-foreign-%' LIMIT 1"
      );
      if (realState.rowCount) {
        throw new Error('The isolated recovery drill database contains non-test organization state and will not be used.');
      }
    }
  } finally {
    await drill.end().catch(() => {});
  }
  return { ...target, created };
}

function runtimeEnvironment(environment, target) {
  return {
    ...environment,
    WOA_TEST_DATABASE_URL: target.testUrl,
    WOA_TEST_DATABASE_SSL_MODE: String(environment.WOA_POSTGRES_SSL_MODE || ''),
    WOA_POSTGRES_RUNTIME_TEST_CONFIRM: '1',
    WOA_POSTGRES_RUNTIME_PROOF_RECORD: '1',
    WOA_POSTGRES_RUNTIME_PROOF_CONFIRM: '1',
    WOA_POSTGRES_RUNTIME_PROOF_DATABASE_URL: String(environment.DATABASE_URL || '').trim()
  };
}

function runRuntimeCheck(options = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, 'postgres-runtime-check.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: runtimeEnvironment(options.environment || process.env, options.target),
    stdio: 'inherit'
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) return reject(new Error('The PostgreSQL recovery drill was interrupted by ' + signal + '.'));
      if (code !== 0) return reject(new Error('The PostgreSQL recovery drill failed with exit code ' + code + '.'));
      resolve();
    });
  });
}

async function main(environment = process.env) {
  if (String(environment.WOA_POSTGRES_RECOVERY_DRILL_CONFIRM || '').trim() !== CONFIRMATION_PHRASE) {
    throw new Error('Set WOA_POSTGRES_RECOVERY_DRILL_CONFIRM="' + CONFIRMATION_PHRASE + '" for this one controlled run.');
  }
  if (String(environment.WOA_DATA_BACKEND || '').trim().toLowerCase() !== 'postgres') {
    throw new Error('The production service must already use WOA_DATA_BACKEND=postgres before recording recovery-drill proof.');
  }
  const productionUrl = String(environment.DATABASE_URL || '').trim();
  parsePostgresUrl(productionUrl, 'DATABASE_URL');
  if (!String(environment.WOA_SESSION_SECRET || environment.WOA_RECOVERY_DRILL_CONFIGURATION_SECRET || '').trim()) {
    throw new Error('A stable WOA_SESSION_SECRET or WOA_RECOVERY_DRILL_CONFIGURATION_SECRET is required to bind recovery evidence.');
  }
  const target = await ensureIsolatedDatabase({
    productionUrl,
    databaseName: environment.WOA_POSTGRES_RECOVERY_DRILL_DATABASE,
    sslMode: environment.WOA_POSTGRES_SSL_MODE
  });
  console.log((target.created ? 'Created' : 'Reusing') + ' the isolated PostgreSQL recovery drill database "' + target.drillDatabaseName + '".');
  await runRuntimeCheck({ environment, target });
  console.log('Controlled PostgreSQL recovery drill completed and signed proof metadata was recorded. No live customer rows were used by the drill.');
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error);
    process.exit(1);
  });
}

module.exports = {
  CONFIRMATION_PHRASE,
  DEFAULT_DATABASE_NAME,
  buildDrillDatabaseUrl,
  ensureIsolatedDatabase,
  normalizeDatabaseName,
  parsePostgresUrl,
  pgSsl,
  runtimeEnvironment,
  runRuntimeCheck,
  main
};
