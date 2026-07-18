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
  assert.match(upsert.sql, /ON CONFLICT \(organization_id, id\)/, 'A document upsert must use the company-scoped primary key.');
  assert.doesNotMatch(upsert.sql, /ON CONFLICT \(id\)/, 'A local document id must not be globally unique across franchise companies.');
  const cleanup = calls.find(call => /DELETE FROM woa_documents/.test(call.sql));
  assert(cleanup, 'Document metadata synchronization must remove rows no longer present in authoritative state.');
  assert.strictEqual(cleanup.values[0], 'org-tenant-a', 'Document metadata cleanup must remain company-scoped.');
  assert.deepStrictEqual(cleanup.values[1], ['document-private-a'], 'Document metadata cleanup must retain only the current company document ids.');

  const otherCompanyCalls = [];
  await repositoryForUnitCheck('org-tenant-b').syncDocumentMetadata({
    async query(sql, values = []) {
      otherCompanyCalls.push({ sql: String(sql), values });
      return { rowCount: 1, rows: [{ id: values[0] || '' }] };
    }
  }, { documents: [{ id: 'document-private-a', storageKey: 'documents/org-tenant-b/document-private-a.enc' }] });
  const otherCompanyUpsert = otherCompanyCalls.find(call => /INSERT INTO woa_documents/.test(call.sql));
  assert(otherCompanyUpsert, 'A second company must be able to persist its own local document id.');
  assert.strictEqual(otherCompanyUpsert.values[1], 'org-tenant-b', 'The same local document id must remain owned by the second company row.');
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

async function verifyTransientSchemaConnectionRecovery() {
  const repository = repositoryForUnitCheck();
  delete repository.ensureSchema;
  repository.schemaReady = null;
  repository.repair = value => value;
  repository.seed = async () => ({});
  let connectionAttempts = 0;
  let releases = 0;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql: String(sql), values });
      return { rowCount: 0, rows: [] };
    },
    release() { releases += 1; }
  };
  repository.pool = {
    async connect() {
      connectionAttempts += 1;
      if (connectionAttempts === 1) {
        const error = new Error('Connection terminated unexpectedly');
        error.code = '08006';
        throw error;
      }
      return client;
    }
  };
  await repository.ensureSchema();
  assert.strictEqual(connectionAttempts, 2, 'PostgreSQL schema startup must retry a transient pre-transaction connection failure.');
  assert.strictEqual(releases, 1, 'The recovered PostgreSQL schema connection must be released exactly once.');
  const beginIndex = calls.findIndex(call => /^BEGIN$/.test(call.sql));
  const schemaLockIndex = calls.findIndex(call => /pg_advisory_xact_lock/.test(call.sql));
  const firstCreateIndex = calls.findIndex(call => /CREATE TABLE IF NOT EXISTS woa_schema_migrations/.test(call.sql));
  assert(beginIndex >= 0 && schemaLockIndex > beginIndex && firstCreateIndex > schemaLockIndex, 'PostgreSQL schema upgrades must take a database-wide transaction lock before running any DDL.');
  assert.strictEqual(calls[schemaLockIndex].values.length, 2, 'The schema migration lock must use the stable two-key PostgreSQL advisory lock contract.');
  assert(calls.some(call => /PRIMARY KEY \(organization_id, id\)/.test(call.sql)), 'Schema recovery must still apply the company-scoped private document key.');
  assert(calls.some(call => call.values.includes('20260718_document_tenant_primary_key_v4')), 'Schema recovery must record the private-document tenant migration.');
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

async function verifyTransactionalIndexIsolation() {
  const repository = repositoryForUnitCheck();
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql: String(sql), values });
      return { rowCount: 1, rows: [] };
    }
  };
  const state = {
    vehicles: [{ id: 'vehicle-tenant-a', status: 'Rented', currentCustomer: 'Tenant A Customer' }],
    customers: [{ id: 'customer-tenant-a', name: 'Tenant A Customer', vehicleId: 'vehicle-tenant-a', status: 'Active' }],
    contracts: [{ id: 'file-tenant-a', customer: 'Tenant A Customer', vehicleId: 'vehicle-tenant-a', status: 'Active' }]
  };
  await repository.syncCriticalResourceIndex(client, state);
  await repository.syncActiveAssignmentIndex(client, state);
  const resourceDelete = calls.find(call => /DELETE FROM woa_resource_index/.test(call.sql));
  const resourceInsert = calls.find(call => /INSERT INTO woa_resource_index/.test(call.sql));
  const assignmentDelete = calls.find(call => /DELETE FROM woa_active_assignments/.test(call.sql));
  const assignmentInsert = calls.find(call => /INSERT INTO woa_active_assignments/.test(call.sql));
  assert(resourceDelete && resourceInsert && assignmentDelete && assignmentInsert, 'Both transactional indexes must replace their company rows in one repository transaction.');
  [resourceDelete, resourceInsert, assignmentDelete, assignmentInsert].forEach(call => {
    assert.strictEqual(call.values[0], 'org-tenant-a', 'Every critical-record and assignment index statement must bind the current company first.');
  });
  const resourceRows = JSON.parse(resourceInsert.values[1]);
  const assignmentRows = JSON.parse(assignmentInsert.values[1]);
  assert.strictEqual(resourceRows.length, 3, 'The tenant resource index must contain only the supplied company records.');
  assert.strictEqual(assignmentRows.length, 1, 'The tenant assignment index must contain one authoritative vehicle owner.');
  assert.strictEqual(assignmentRows[0].vehicleId, 'vehicle-tenant-a', 'The assignment index must retain the company vehicle id.');

  const conflictCalls = [];
  await assert.rejects(
    () => repository.syncActiveAssignmentIndex({
      async query(sql, values = []) {
        conflictCalls.push({ sql: String(sql), values });
        return { rowCount: 1, rows: [] };
      }
    }, {
      vehicles: [{ id: 'vehicle-conflict-a', status: 'Rented' }],
      customers: [{ id: 'customer-conflict-a', name: 'First Customer', vehicleId: 'vehicle-conflict-a', status: 'Active' }],
      contracts: [{ id: 'file-conflict-a', customer: 'Second Customer', vehicleId: 'vehicle-conflict-a', status: 'Active' }]
    }),
    error => error && error.code === 'woa_assignment_identity_conflict',
    'An ambiguous active assignment must fail before deleting the last known-good company index.'
  );
  assert.strictEqual(conflictCalls.length, 0, 'Assignment conflicts must be detected before any PostgreSQL index statement runs.');
}

async function main() {
  await verifyTransientSchemaConnectionRecovery();
  await verifyDocumentMetadataIsolation();
  await verifyWebhookTenantScope();
  await verifyTransactionalIndexIsolation();
  console.log('PostgreSQL tenant privacy check passed: webhooks, critical resources, active assignments, and private document metadata remain company-scoped and fail closed on conflicts.');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
