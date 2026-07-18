'use strict';

const assert = require('node:assert');
const { PostgresStateRepository } = require('../state-repository');

function repositoryForUnitCheck(organizationId = 'org-tenant-a') {
  const repository = Object.create(PostgresStateRepository.prototype);
  repository.organizationId = organizationId;
  repository.webhookProcessingLeaseMs = 10 * 60 * 1000;
  repository.ensureSchema = async () => {};
  return repository;
}

async function verifyDocumentMetadataIsolation() {
  const repository = repositoryForUnitCheck();
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql: String(sql), values });
      return { rowCount: 1, rows: [{ id: values[0] || '' }] };
    }
  };
  await repository.syncDocumentMetadata(client, {
    documents: [{
      id: 'document-private-a',
      customer: 'Private Customer',
      storageProvider: 's3',
      storageKey: 'documents/org-tenant-a/document-private-a.enc',
      contentType: 'application/pdf',
      encryption: { algorithm: 'AES-256-GCM' }
    }]
  });
  const upsert = calls.find(call => /INSERT INTO woa_documents/.test(call.sql));
  assert(upsert, 'Private document metadata must be written to the PostgreSQL metadata table.');
  assert.strictEqual(upsert.values[1], 'org-tenant-a', 'Private document metadata must be owned by the repository company.');
  assert.match(upsert.sql, /WHERE woa_documents\.organization_id = EXCLUDED\.organization_id/, 'A document id collision must never overwrite another company metadata row.');
  const cleanup = calls.find(call => /DELETE FROM woa_documents/.test(call.sql));
  assert(cleanup, 'Document metadata synchronization must remove rows no longer present in authoritative state.');
  assert.strictEqual(cleanup.values[0], 'org-tenant-a', 'Document metadata cleanup must remain company-scoped.');
  assert.deepStrictEqual(cleanup.values[1], ['document-private-a'], 'Document metadata cleanup must retain only the current company document ids.');

  await assert.rejects(
    () => repository.syncDocumentMetadata({
      async query(sql) {
        return /INSERT INTO woa_documents/.test(String(sql)) ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [] };
      }
    }, { documents: [{ id: 'document-owned-elsewhere', storageKey: 'documents/org-tenant-a/conflict.enc' }] }),
    error => error && error.code === 'woa_document_tenant_conflict',
    'A private document id already owned by another company must fail the entire state transaction.'
  );
  await assert.rejects(
    () => repository.syncDocumentMetadata(client, {
      documents: [
        { id: 'document-duplicate', storageKey: 'documents/org-tenant-a/one.enc' },
        { id: 'document-duplicate', storageKey: 'documents/org-tenant-a/two.enc' }
      ]
    }),
    error => error && error.code === 'woa_document_identity_conflict',
    'Duplicate private document ids inside one state snapshot must fail closed.'
  );
}

async function verifyWebhookTenantScope() {
  const repository = repositoryForUnitCheck();
  const transactionCalls = [];
  const client = {
    async query(sql, values = []) {
      transactionCalls.push({ sql: String(sql), values });
      if (/SELECT status, attempts/.test(String(sql))) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  const poolCalls = [];
  repository.pool = {
    async connect() { return client; },
    async query(sql, values = []) {
      poolCalls.push({ sql: String(sql), values });
      return { rowCount: 1, rows: [] };
    }
  };
  const claim = await repository.claimWebhookEvent('stripe', 'evt-tenant-private', { type: 'payment_intent.succeeded' });
  assert.strictEqual(claim.accepted, true, 'A new company webhook event should be claimable.');
  const select = transactionCalls.find(call => /SELECT status, attempts/.test(call.sql));
  assert(select, 'Webhook claiming must lock an existing durable event row before processing.');
  assert.match(select.sql, /organization_id = \$1/, 'Webhook claim lookup must be company-scoped.');
  assert.deepStrictEqual(select.values, ['org-tenant-a', 'stripe', 'evt-tenant-private'], 'Webhook claim lookup must bind company, provider, and event id in that order.');
  const insert = transactionCalls.find(call => /INSERT INTO woa_webhook_events/.test(call.sql));
  assert(insert && insert.values[2] === 'org-tenant-a', 'A claimed webhook must persist its company owner.');

  await repository.completeWebhookEvent('stripe', 'evt-tenant-private');
  await repository.failWebhookEvent('stripe', 'evt-tenant-private', new Error('controlled failure'));
  assert.strictEqual(poolCalls.length, 2, 'Webhook completion and failure must each use one durable update.');
  poolCalls.forEach(call => {
    assert.match(call.sql, /organization_id = \$1/, 'Webhook terminal updates must remain company-scoped.');
    assert.strictEqual(call.values[0], 'org-tenant-a', 'Webhook terminal updates must bind the current company first.');
    assert.strictEqual(call.values[1], 'stripe', 'Webhook terminal updates must bind the provider after the company.');
    assert.strictEqual(call.values[2], 'evt-tenant-private', 'Webhook terminal updates must bind the exact event id.');
  });
}

async function main() {
  await verifyDocumentMetadataIsolation();
  await verifyWebhookTenantScope();
  console.log('PostgreSQL tenant privacy check passed: webhook claims and terminal updates are company-scoped; document metadata rejects cross-company overwrite, rejects duplicate ids, and purges stale rows transactionally.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
