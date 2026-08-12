'use strict';

const assert = require('node:assert');
const { PostgresStateRepository } = require('../state-repository');

function repositoryWith(query) {
  const repository = Object.create(PostgresStateRepository.prototype);
  repository.organizationId = 'org-message-test';
  repository.ensureSchema = async () => {};
  repository.pool = { query };
  return repository;
}

async function main() {
  const calls = [];
  const accepted = {
    id: 'msg-ledger-1',
    organizationId: 'org-message-test',
    customerAccountId: 'account-1',
    customer: 'Ledger Customer',
    phone: '856-555-0101',
    email: 'ledger@example.com',
    direction: 'Inbound',
    channel: 'Customer portal',
    providerIdempotencyKey: 'delivery-1',
    body: 'Fast message',
    createdAt: '2026-08-12T12:00:00.000Z'
  };
  const repository = repositoryWith(async (sql, values = []) => {
    calls.push({ sql: String(sql), values });
    if (/INSERT INTO woa_message_ledger/.test(String(sql))) return { rowCount: 1, rows: [{ payload: accepted, updated_at: accepted.createdAt }] };
    throw new Error('Unexpected query: ' + sql);
  });
  const saved = await repository.persistMessage(accepted);
  assert.strictEqual(saved.duplicate, false);
  assert.strictEqual(saved.message.id, accepted.id);
  assert.strictEqual(calls.length, 1, 'A first in-app send must use exactly one small INSERT.');
  assert.match(calls[0].sql, /ON CONFLICT \(organization_id, id\) DO NOTHING/, 'Message ids must be idempotent inside one company.');
  assert.strictEqual(calls[0].values[0], 'org-message-test', 'The ledger insert must be tenant scoped.');
  assert.strictEqual(calls[0].values[2], 'account-1', 'The exact portal account must be indexed.');
  assert.strictEqual(calls[0].values[9], 'delivery-1', 'The client delivery id must be persisted for retry suppression.');

  const readCalls = [];
  const reader = repositoryWith(async (sql, values = []) => {
    readCalls.push({ sql: String(sql), values });
    if (/FROM woa_resources/.test(String(sql))) return { rowCount: 1, rows: [{ payload: { ...accepted, id: 'msg-history-1', body: 'History' } }] };
    if (/FROM woa_message_ledger/.test(String(sql))) return { rowCount: 1, rows: [{ payload: accepted }] };
    if (/integrations,messaging/.test(String(sql))) return { rowCount: 1, rows: [{ messaging: { aiEnabled: true } }] };
    throw new Error('Unexpected query: ' + sql);
  });
  const feed = await reader.readMessageData({ customerAccountId: 'account-1', limit: 50 });
  assert.deepStrictEqual(feed.messages.map(row => row.id), ['msg-ledger-1', 'msg-history-1'], 'The live feed must combine new ledger messages with canonical history newest first.');
  assert.strictEqual(feed.messaging.aiEnabled, true);
  assert.strictEqual(readCalls.length, 3, 'A live feed must use only message history, the ledger, and messaging settings.');
  readCalls.slice(0, 2).forEach(call => {
    assert.strictEqual(call.values[0], 'org-message-test', 'Every message feed query must be tenant scoped.');
    assert.strictEqual(call.values[2], 'account-1', 'A customer feed must bind the exact portal account.');
  });
  assert(readCalls.every(call => !/SELECT state, version, checksum/.test(call.sql)), 'Realtime chat must never download the complete platform state.');

  let storedState = null;
  const previousState = {
    messages: [],
    auditLogs: [],
    integrations: { messaging: { aiEnabled: true } },
    systemRepairs: { stable: true },
    customers: [{ id: 'customer-live', name: 'Keep me' }]
  };
  const writer = Object.create(PostgresStateRepository.prototype);
  writer.organizationId = 'org-message-test';
  writer.snapshotLimit = 25;
  writer.ensureSchema = async () => {};
  writer.seed = async () => structuredClone(previousState);
  writer.repair = state => structuredClone(state);
  writer.syncCriticalResourceIndex = async () => {};
  writer.syncNormalizedResources = async () => {};
  writer.applyStateTransactionEffects = async () => ({ webhookCompletions: [], idempotencySettlements: [] });
  writer.connect = async () => ({
    query: async (sql, values = []) => {
      if (/SELECT state, version, checksum/.test(sql)) return { rowCount: 0, rows: [] };
      if (/INSERT INTO woa_state \(/.test(sql)) storedState = JSON.parse(values[1]);
      return { rowCount: 0, rows: [] };
    },
    release() {}
  });
  await writer.write({
    ...previousState,
    messages: [accepted],
    systemRepairs: { staleRequestOverwrite: true },
    customers: [{ id: 'customer-stale', name: 'Do not write me' }]
  }, {
    fastMessagingWrite: true,
    mergeState: latest => ({
      ...latest,
      messages: [accepted],
      systemRepairs: { staleRequestOverwrite: true },
      customers: [{ id: 'customer-stale', name: 'Do not write me' }]
    })
  });
  assert.deepStrictEqual(storedState.systemRepairs, previousState.systemRepairs, 'A fast message write must preserve current repair metadata.');
  assert.deepStrictEqual(storedState.customers, previousState.customers, 'A fast message write must never overwrite unrelated customer state.');
  assert.strictEqual(storedState.messages[0].id, accepted.id, 'The scoped fast write must still commit its message change.');

  console.log('Realtime message ledger check passed: one-row idempotent sends, exact-account privacy, canonical history, and small live feeds are verified.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
