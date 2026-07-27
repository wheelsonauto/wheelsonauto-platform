'use strict';

const assert = require('node:assert');
const stateRepository = require('../state-repository');

function highestPlaceholder(sql) {
  return [...String(sql || '').matchAll(/\$(\d+)/g)]
    .reduce((highest, match) => Math.max(highest, Number(match[1])), 0);
}

async function main() {
  const repository = Object.create(stateRepository.PostgresStateRepository.prototype);
  repository.organizationId = 'org-sql-contract-check';
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const expected = highestPlaceholder(sql);
      assert.strictEqual(
        values.length,
        expected,
        'PostgreSQL query values must exactly match the highest numbered placeholder.'
      );
      calls.push({ sql, values });
      return { rows: [{ id: '41', created_at: '2026-07-26T12:00:00.000Z' }], rowCount: 1 };
    }
  };

  const saved = await repository.appendRecoveryHistory(client, {
    eventType: 'restore',
    eventId: 'restore-contract-check',
    sourceSnapshotId: 17,
    sourceVersion: 22,
    sourceChecksum: 'source-checksum',
    result: 'restored',
    actor: 'Contract test',
    details: { reason: 'Verify SQL parameter alignment.' }
  }, {
    previousVersion: 23,
    previousChecksum: 'previous-checksum',
    targetVersion: 24,
    targetChecksum: 'target-checksum'
  });

  assert.strictEqual(calls.length, 1, 'Appending recovery history must issue exactly one insert.');
  assert.match(calls[0].sql, /INSERT INTO woa_recovery_history/i, 'The contract check must exercise the recovery-history insert.');
  assert.strictEqual(calls[0].values.length, 13, 'Recovery history has exactly thirteen persisted columns and values.');
  assert.strictEqual(calls[0].values[11], 'Contract test', 'Actor must occupy the twelfth SQL parameter.');
  assert.deepStrictEqual(JSON.parse(calls[0].values[12]), { reason: 'Verify SQL parameter alignment.' }, 'Details must occupy the final JSON parameter.');
  assert.strictEqual(saved.id, 41, 'The repository must return the stored recovery-history id.');

  console.log('State repository SQL contract check passed: recovery-history placeholders and values remain aligned.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
