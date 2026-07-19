'use strict';

const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const repairScript = path.join(__dirname, 'repair-data.js');

function run(args) {
  return spawnSync(process.execPath, [repairScript, ...args], {
    cwd: root,
    env: process.env,
    encoding: 'utf8'
  });
}

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'woa-repair-data-check-'));
  try {
    const source = path.join(temp, 'source.json');
    const output = path.join(temp, 'protected-repair.json');
    const original = JSON.stringify({
      vehicles: [
        { id: 'veh-duplicate', year: '2019', make: 'Mitsubishi', model: 'Mirage', vin: 'ML32A3HJ9KH000001', status: 'Ready' },
        { id: 'veh-duplicate', year: '2018', make: 'Ford', model: 'Focus', vin: '1FADP3K20JL000001', status: 'Ready' }
      ],
      customers: [{ name: 'Repair Test Customer', vehicle: '2019 Mitsubishi Mirage' }],
      payments: []
    }, null, 2);
    await fs.writeFile(source, original, 'utf8');

    const missingOutput = run([source]);
    assert.notStrictEqual(missingOutput.status, 0, 'Repair must require a separate output path.');
    assert.match(missingOutput.stderr, /never rewrites its source/i);
    assert.strictEqual(await fs.readFile(source, 'utf8'), original, 'A refused repair must leave its source byte-for-byte unchanged.');

    const samePath = run([source, source]);
    assert.notStrictEqual(samePath.status, 0, 'Repair must reject an in-place output path.');
    assert.match(samePath.stderr, /separate new file/i);
    assert.strictEqual(await fs.readFile(source, 'utf8'), original, 'An in-place repair attempt must leave its source byte-for-byte unchanged.');

    const completed = run([source, output]);
    assert.strictEqual(completed.status, 0, completed.stderr || 'Repair must create an isolated protected copy.');
    const result = JSON.parse(completed.stdout);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.source, source);
    assert.strictEqual(result.output, output);
    assert.match(result.sourceChecksum, /^[a-f0-9]{64}$/);
    assert.match(result.outputChecksum, /^[a-f0-9]{64}$/);
    assert.strictEqual(result.outputMode, '0600');
    assert.strictEqual(await fs.readFile(source, 'utf8'), original, 'Successful repair must never change its source.');
    assert.strictEqual((await fs.stat(output)).mode & 0o777, 0o600, 'Protected repair output must be owner-readable only.');
    const repaired = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.strictEqual(repaired.vehicles[0].id, 'veh-duplicate', 'Repair must preserve the first valid vehicle identity.');
    assert.notStrictEqual(repaired.vehicles[1].id, 'veh-duplicate', 'Repair output must normalize a duplicate vehicle identity.');

    const beforeOverwrite = await fs.readFile(output);
    const overwrite = run([source, output]);
    assert.notStrictEqual(overwrite.status, 0, 'Repair must refuse to replace an existing protected copy.');
    assert.match(overwrite.stderr, /EEXIST/i);
    assert((await fs.readFile(output)).equals(beforeOverwrite), 'Overwrite refusal must preserve the existing protected copy exactly.');
    assert.strictEqual(await fs.readFile(source, 'utf8'), original, 'Overwrite refusal must preserve the source exactly.');

    console.log('Repair-data check passed: explicit source/output, in-place refusal, source preservation, exclusive mode-0600 copy, normalized IDs, checksum proof, and overwrite refusal are verified.');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
