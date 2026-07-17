'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { firstUserArgument, userArguments } = require('./cli-arguments');

const root = path.resolve(__dirname, '..');
const migrationScripts = [
  'data-consistency-check.js',
  'client-state-budget-check.js',
  'migrate-json-to-postgres.js',
  'migrate-private-documents.js',
  'postgres-preflight.js',
  'repair-data.js',
  'verify-json-to-postgres.js',
  'workflow-integrity-check.js'
];

function runCliArgumentChecks() {
  assert.deepStrictEqual(userArguments(['node', 'script.js', '--', 'data.json']), ['data.json'], 'The package-run delimiter must not become a file path.');
  assert.strictEqual(firstUserArgument(['node', 'script.js', '--', 'data.json']), 'data.json', 'The first real command argument must follow the package-run delimiter.');
  assert.strictEqual(firstUserArgument(['node', 'script.js', 'data.json']), 'data.json', 'Direct node execution must keep the first path argument.');
  assert.strictEqual(firstUserArgument(['node', 'script.js']), '', 'Scripts without a path must keep their documented default target.');

  migrationScripts.forEach(file => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert(source.includes("require('./cli-arguments')"), file + ' must normalize package-run arguments before resolving a file path.');
  });

  const probe = spawnSync(process.execPath, ['scripts/postgres-preflight.js', '--', 'seed.json'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.ifError(probe.error);
  assert.strictEqual(probe.status, 0, 'The PostgreSQL preflight must accept the documented package-run delimiter form.');
  assert.match(probe.stdout, /"source":\s*".*seed\.json"/, 'The preflight must resolve the path after -- instead of treating -- as the source file.');
}

if (require.main === module) {
  try {
    runCliArgumentChecks();
    console.log('CLI argument check passed: direct-node and pnpm-run file arguments resolve safely for migration and data tools.');
  } catch (error) {
    console.error(error.stack || error);
    process.exit(1);
  }
}

module.exports = { runCliArgumentChecks };
