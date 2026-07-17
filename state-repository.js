'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MIGRATION_ID = '20260717_production_state_foundation_v1';
const DEFAULT_ORGANIZATION_ID = 'org-wheelsonauto';

function clone(value) {
  return JSON.parse(JSON.stringify(value === undefined ? {} : value));
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function checksum(value) {
  return crypto.createHash('sha256').update(stableJson(value || {}), 'utf8').digest('hex');
}

function normalizeOrganizationId(value) {
  return String(value || DEFAULT_ORGANIZATION_ID).trim() || DEFAULT_ORGANIZATION_ID;
}

function normalizeBackend(value) {
  const backend = String(value || 'json').trim().toLowerCase();
  return backend === 'postgres' || backend === 'postgresql' ? 'postgres' : 'json';
}

function normalizedIdentity(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowId(row, fallback) {
  return String(row && (row.id || row.paymentRequestId || row.recurringPaymentId || row.providerPaymentId || row.stripePaymentIntentId || row.cloverPaymentId) || fallback || '').trim();
}

function pushIdentity(entries, kind, value, resourceType, resourceId) {
  const normalized = normalizedIdentity(value);
  const id = String(resourceId || '').trim();
  if (!normalized || !id) return;
  entries.push({ kind, normalizedValue: normalized, resourceType, resourceId: id });
}

function identityEntries(state = {}) {
  const entries = [];
  (state.vehicles || []).forEach((vehicle, index) => {
    const id = rowId(vehicle, 'vehicle-' + index);
    pushIdentity(entries, 'vehicle_vin', vehicle && vehicle.vin, 'vehicle', id);
    pushIdentity(entries, 'vehicle_plate', vehicle && (vehicle.plate || vehicle.stock), 'vehicle', id);
  });
  (state.customers || []).forEach((customer, index) => {
    const id = rowId(customer, 'customer-' + index);
    pushIdentity(entries, 'customer_email', customer && customer.email, 'customer', id);
  });
  (state.customerAccounts || []).forEach((account, index) => {
    const id = rowId(account, 'customer-account-' + index);
    pushIdentity(entries, 'portal_username', account && account.username, 'customer_account', id);
  });
  (state.payments || []).forEach((payment, index) => {
    const id = rowId(payment, 'payment-' + index);
    pushIdentity(entries, 'stripe_payment_intent', payment && payment.stripePaymentIntentId, 'payment', id);
    pushIdentity(entries, 'clover_payment', payment && payment.cloverPaymentId, 'payment', id);
    pushIdentity(entries, 'provider_payment', payment && payment.providerPaymentId, 'payment', id);
  });
  return entries;
}

function identityConflicts(state = {}) {
  const seen = new Map();
  const conflicts = [];
  identityEntries(state).forEach(entry => {
    const key = [entry.kind, entry.normalizedValue].join('|');
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, entry);
      return;
    }
    if (existing.resourceType === entry.resourceType && existing.resourceId === entry.resourceId) return;
    conflicts.push({ kind: entry.kind, value: entry.normalizedValue, records: [existing, entry] });
  });
  return conflicts;
}

function privateDocumentRows(state = {}) {
  const documents = Array.isArray(state.documents) ? state.documents : [];
  const signatures = Array.isArray(state.eSignatures) ? state.eSignatures : [];
  return documents.concat(signatures.map(signature => ({
    ...signature,
    id: signature.id,
    documentType: 'signature',
    storageKey: signature.storageKey || '',
    storagePath: signature.signatureImagePath || signature.storagePath || '',
    originalName: signature.originalName || 'signature.png',
    contentType: signature.contentType || 'image/png'
  }))).filter(row => row && row.id && (row.storageKey || row.storagePath));
}

class JsonStateRepository {
  constructor(options = {}) {
    this.kind = 'json';
    this.dataFile = options.dataFile;
    this.seedFile = options.seedFile;
    this.organizationId = normalizeOrganizationId(options.organizationId);
    this.repair = typeof options.repair === 'function' ? options.repair : value => value;
    // JSON is a development fallback. Keep an in-process cap so a local test
    // cannot loop through model requests, while PostgreSQL provides the durable
    // cross-request/cross-instance quota used in production.
    this.aiUsageReservations = new Map();
  }

  isTransactional() {
    return false;
  }

  async read() {
    try {
      const raw = JSON.parse(await fs.readFile(this.dataFile, 'utf8'));
      return { state: this.repair(raw), version: await this.version(), exists: true };
    } catch {
      try {
        const seed = this.repair(JSON.parse(await fs.readFile(this.seedFile, 'utf8')));
        return { state: seed, version: 'missing', exists: false };
      } catch {
        return { state: {}, version: 'missing', exists: false };
      }
    }
  }

  async version() {
    try {
      const stat = await fs.stat(this.dataFile, { bigint: true });
      return stat.mtimeNs + '-' + stat.size + '-' + stat.ino;
    } catch {
      return 'missing';
    }
  }

  async write(state) {
    const next = this.repair(state);
    const directory = path.dirname(this.dataFile);
    await fs.mkdir(directory, { recursive: true });
    const temporary = this.dataFile + '.' + process.pid + '.' + Date.now() + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(temporary, this.dataFile);
    return { state: next, version: await this.version(), checksum: checksum(next) };
  }

  async health() {
    return { backend: 'json', connected: true, transactional: false, productionReady: false, version: await this.version() };
  }

  async claimWebhookEvent(provider, eventId) {
    return { accepted: true, duplicate: false, eventId: String(eventId || '') };
  }

  async completeWebhookEvent() {}

  async failWebhookEvent() {}

  async recordJobError() {}

  async recentJobErrors() {
    return [];
  }

  async listSnapshots() {
    return [];
  }

  async restoreSnapshot() {
    const error = new Error('Snapshot recovery requires PostgreSQL transactional storage.');
    error.code = 'snapshot_recovery_requires_postgres';
    throw error;
  }

  async reserveAiUsage(options = {}) {
    const dailyLimit = Math.max(0, Number(options.dailyLimit || 0));
    const monthlyLimit = Math.max(0, Number(options.monthlyLimit || 0));
    const dayKey = String(options.dayKey || '').trim();
    const monthKey = String(options.monthKey || '').trim();
    const prefix = this.organizationId + '|';
    const dailyKey = prefix + 'day|' + dayKey;
    const monthlyKey = prefix + 'month|' + monthKey;
    const dailyUsed = Number(this.aiUsageReservations.get(dailyKey) || 0);
    const monthlyUsed = Number(this.aiUsageReservations.get(monthlyKey) || 0);
    if (dailyLimit && dailyUsed >= dailyLimit) {
      return { allowed: false, reason: 'daily_limit', daily: { used: dailyUsed, limit: dailyLimit }, monthly: { used: monthlyUsed, limit: monthlyLimit } };
    }
    if (monthlyLimit && monthlyUsed >= monthlyLimit) {
      return { allowed: false, reason: 'monthly_limit', daily: { used: dailyUsed, limit: dailyLimit }, monthly: { used: monthlyUsed, limit: monthlyLimit } };
    }
    this.aiUsageReservations.set(dailyKey, dailyUsed + 1);
    this.aiUsageReservations.set(monthlyKey, monthlyUsed + 1);
    return {
      allowed: true,
      daily: { used: dailyUsed + 1, limit: dailyLimit },
      monthly: { used: monthlyUsed + 1, limit: monthlyLimit }
    };
  }

  async close() {}
}

function pgPool(options = {}) {
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch (error) {
    const missing = new Error('PostgreSQL support is not installed. Run pnpm install before enabling WOA_DATA_BACKEND=postgres.');
    missing.cause = error;
    throw missing;
  }
  const sslMode = String(options.sslMode || '').trim().toLowerCase();
  const ssl = sslMode === 'disable' ? false : options.ssl === false ? false : { rejectUnauthorized: false };
  return new Pool({
    connectionString: options.databaseUrl,
    max: Math.max(1, Math.min(12, Number(options.maxConnections || 4))),
    idleTimeoutMillis: Math.max(5000, Number(options.idleTimeoutMs || 30000)),
    connectionTimeoutMillis: Math.max(3000, Number(options.connectionTimeoutMs || 10000)),
    ssl,
    application_name: options.applicationName || 'wheelsonauto-platform'
  });
}

class PostgresStateRepository {
  constructor(options = {}) {
    if (!options.databaseUrl) throw new Error('WOA_DATA_BACKEND=postgres requires DATABASE_URL. Refusing to fall back to a JSON file.');
    this.kind = 'postgres';
    this.organizationId = normalizeOrganizationId(options.organizationId);
    this.seed = typeof options.seed === 'function' ? options.seed : async () => ({});
    this.repair = typeof options.repair === 'function' ? options.repair : value => value;
    this.snapshotLimit = Math.max(10, Math.min(1000, Number(options.snapshotLimit || 180)));
    this.pool = pgPool(options);
    this.schemaReady = null;
  }

  isTransactional() {
    return true;
  }

  async ensureSchema() {
    if (this.schemaReady) return this.schemaReady;
    this.schemaReady = (async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS woa_state (
          organization_id TEXT PRIMARY KEY,
          state JSONB NOT NULL,
          version BIGINT NOT NULL DEFAULT 0,
          checksum TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CHECK (jsonb_typeof(state) = 'object')
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS woa_state_snapshots (
          id BIGSERIAL PRIMARY KEY,
          organization_id TEXT NOT NULL REFERENCES woa_state(organization_id) ON DELETE CASCADE,
          version BIGINT NOT NULL,
          checksum TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT 'state mutation',
          actor TEXT NOT NULL DEFAULT '',
          state JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (organization_id, version)
        )`);
        await client.query('CREATE INDEX IF NOT EXISTS woa_state_snapshots_org_created_idx ON woa_state_snapshots (organization_id, created_at DESC)');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_webhook_events (
          provider TEXT NOT NULL,
          event_id TEXT NOT NULL,
          organization_id TEXT NOT NULL DEFAULT '${DEFAULT_ORGANIZATION_ID}',
          status TEXT NOT NULL DEFAULT 'received',
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          attempts INTEGER NOT NULL DEFAULT 0,
          received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          processed_at TIMESTAMPTZ,
          last_error TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (provider, event_id)
        )`);
        await client.query('CREATE INDEX IF NOT EXISTS woa_webhook_events_org_status_idx ON woa_webhook_events (organization_id, status, received_at DESC)');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_idempotency_keys (
          organization_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          key TEXT NOT NULL,
          request_hash TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'claimed',
          response JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          completed_at TIMESTAMPTZ,
          PRIMARY KEY (organization_id, scope, key)
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS woa_identity_index (
          organization_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          normalized_value TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (organization_id, kind, normalized_value)
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS woa_documents (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          customer TEXT NOT NULL DEFAULT '',
          application_id TEXT NOT NULL DEFAULT '',
          onboarding_session_id TEXT NOT NULL DEFAULT '',
          storage_provider TEXT NOT NULL DEFAULT '',
          object_key TEXT NOT NULL DEFAULT '',
          content_type TEXT NOT NULL DEFAULT '',
          size_bytes BIGINT NOT NULL DEFAULT 0,
          sha256 TEXT NOT NULL DEFAULT '',
          encryption JSONB NOT NULL DEFAULT '{}'::jsonb,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await client.query('CREATE UNIQUE INDEX IF NOT EXISTS woa_documents_provider_key_unique ON woa_documents (storage_provider, object_key) WHERE object_key <> \'\'');
        await client.query('CREATE INDEX IF NOT EXISTS woa_documents_org_customer_idx ON woa_documents (organization_id, customer, updated_at DESC)');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_job_errors (
          id BIGSERIAL PRIMARY KEY,
          organization_id TEXT NOT NULL,
          source TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'error',
          message TEXT NOT NULL,
          context JSONB NOT NULL DEFAULT '{}'::jsonb,
          resolved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await client.query('CREATE INDEX IF NOT EXISTS woa_job_errors_open_idx ON woa_job_errors (organization_id, resolved_at, created_at DESC)');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_ai_usage (
          organization_id TEXT NOT NULL,
          period_type TEXT NOT NULL CHECK (period_type IN ('day', 'month')),
          period_key TEXT NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (organization_id, period_type, period_key)
        )`);
        await client.query('INSERT INTO woa_schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [MIGRATION_ID]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        this.schemaReady = null;
        throw error;
      } finally {
        client.release();
      }
    })();
    return this.schemaReady;
  }

  async read() {
    await this.ensureSchema();
    const result = await this.pool.query('SELECT state, version, checksum FROM woa_state WHERE organization_id = $1', [this.organizationId]);
    if (!result.rowCount) {
      const state = this.repair(await this.seed());
      return { state, version: 0, checksum: checksum(state), exists: false };
    }
    const row = result.rows[0];
    return { state: this.repair(clone(row.state)), version: Number(row.version || 0), checksum: row.checksum || checksum(row.state), exists: true };
  }

  async version() {
    const snapshot = await this.read();
    return 'pg-' + snapshot.version + '-' + String(snapshot.checksum || '').slice(0, 12);
  }

  async refreshIdentityIndex(client, state) {
    const conflicts = identityConflicts(state);
    if (conflicts.length) {
      const error = new Error('Database migration blocked by ' + conflicts.length + ' duplicate immutable identity value(s). Resolve the conflicting VIN, plate, email, or payment IDs before enabling PostgreSQL.');
      error.code = 'woa_identity_conflict';
      error.conflicts = conflicts.slice(0, 20);
      throw error;
    }
    await client.query('DELETE FROM woa_identity_index WHERE organization_id = $1', [this.organizationId]);
    const entries = identityEntries(state);
    for (const entry of entries) {
      await client.query(`INSERT INTO woa_identity_index (organization_id, kind, normalized_value, resource_type, resource_id)
        VALUES ($1, $2, $3, $4, $5)`, [this.organizationId, entry.kind, entry.normalizedValue, entry.resourceType, entry.resourceId]);
    }
  }

  async syncDocumentMetadata(client, state) {
    const rows = privateDocumentRows(state);
    for (const document of rows) {
      const metadata = {
        type: document.type || document.documentType || '',
        kind: document.kind || document.documentKind || '',
        originalName: document.originalName || '',
        status: document.status || '',
        visibility: document.visibility || '',
        vehicleId: document.vehicleId || '',
        vin: document.vin || '',
        licensePlate: document.licensePlate || document.plate || ''
      };
      await client.query(`INSERT INTO woa_documents (
        id, organization_id, customer, application_id, onboarding_session_id, storage_provider, object_key,
        content_type, size_bytes, sha256, encryption, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, COALESCE($13::timestamptz, now()), now())
      ON CONFLICT (id) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        customer = EXCLUDED.customer,
        application_id = EXCLUDED.application_id,
        onboarding_session_id = EXCLUDED.onboarding_session_id,
        storage_provider = EXCLUDED.storage_provider,
        object_key = EXCLUDED.object_key,
        content_type = EXCLUDED.content_type,
        size_bytes = EXCLUDED.size_bytes,
        sha256 = EXCLUDED.sha256,
        encryption = EXCLUDED.encryption,
        metadata = EXCLUDED.metadata,
        updated_at = now()`, [
        String(document.id), this.organizationId, String(document.customer || ''), String(document.applicationId || ''), String(document.onboardingSessionId || ''),
        String(document.storageProvider || document.storage || (document.storageKey ? 'encrypted' : 'legacy-local')), String(document.storageKey || document.storagePath || ''),
        String(document.contentType || ''), Number(document.size || 0), String(document.sha256 || ''), JSON.stringify(document.encryption || {}), JSON.stringify(metadata), document.createdAt || null
      ]);
    }
  }

  async write(incomingState, options = {}) {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT state, version FROM woa_state WHERE organization_id = $1 FOR UPDATE', [this.organizationId]);
      const previous = existing.rowCount ? this.repair(clone(existing.rows[0].state)) : this.repair(await this.seed());
      const merged = options.mergeState ? await options.mergeState(clone(previous)) : incomingState;
      const next = this.repair(clone(merged));
      const nextVersion = (existing.rowCount ? Number(existing.rows[0].version || 0) : 0) + 1;
      const nextChecksum = checksum(next);
      await client.query(`INSERT INTO woa_state (organization_id, state, version, checksum, created_at, updated_at)
        VALUES ($1, $2::jsonb, $3, $4, now(), now())
        ON CONFLICT (organization_id) DO UPDATE SET state = EXCLUDED.state, version = EXCLUDED.version, checksum = EXCLUDED.checksum, updated_at = now()`, [
        this.organizationId, JSON.stringify(next), nextVersion, nextChecksum
      ]);
      await this.refreshIdentityIndex(client, next);
      await this.syncDocumentMetadata(client, next);
      await client.query(`INSERT INTO woa_state_snapshots (organization_id, version, checksum, reason, actor, state)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (organization_id, version) DO NOTHING`, [
        this.organizationId, nextVersion, nextChecksum, String(options.reason || 'state mutation').slice(0, 160), String(options.actor || '').slice(0, 160), JSON.stringify(next)
      ]);
      await client.query(`DELETE FROM woa_state_snapshots
        WHERE organization_id = $1 AND id IN (
          SELECT id FROM woa_state_snapshots WHERE organization_id = $1 ORDER BY version DESC OFFSET $2
        )`, [this.organizationId, this.snapshotLimit]);
      await client.query('COMMIT');
      return { state: next, version: nextVersion, checksum: nextChecksum };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async claimWebhookEvent(provider, eventId, payload = {}) {
    if (!eventId) return { accepted: true, duplicate: false, eventId: '' };
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT status, attempts FROM woa_webhook_events WHERE provider = $1 AND event_id = $2 FOR UPDATE', [provider, eventId]);
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.status === 'processed') {
          await client.query('COMMIT');
          return { accepted: false, duplicate: true, eventId };
        }
        await client.query(`UPDATE woa_webhook_events
          SET status = 'processing', attempts = attempts + 1, payload = $3::jsonb, last_error = ''
          WHERE provider = $1 AND event_id = $2`, [provider, eventId, JSON.stringify(payload || {})]);
      } else {
        await client.query(`INSERT INTO woa_webhook_events (provider, event_id, organization_id, status, payload, attempts)
          VALUES ($1, $2, $3, 'processing', $4::jsonb, 1)`, [provider, eventId, this.organizationId, JSON.stringify(payload || {})]);
      }
      await client.query('COMMIT');
      return { accepted: true, duplicate: false, eventId };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async completeWebhookEvent(provider, eventId) {
    if (!eventId) return;
    await this.ensureSchema();
    await this.pool.query(`UPDATE woa_webhook_events
      SET status = 'processed', processed_at = now(), last_error = '' WHERE provider = $1 AND event_id = $2`, [provider, eventId]);
  }

  async failWebhookEvent(provider, eventId, error) {
    if (!eventId) return;
    await this.ensureSchema();
    await this.pool.query(`UPDATE woa_webhook_events
      SET status = 'failed', last_error = $3 WHERE provider = $1 AND event_id = $2`, [provider, eventId, String(error && error.message || error || '').slice(0, 3000)]);
  }

  async recordJobError(source, error, context = {}, severity = 'error') {
    await this.ensureSchema();
    await this.pool.query(`INSERT INTO woa_job_errors (organization_id, source, severity, message, context)
      VALUES ($1, $2, $3, $4, $5::jsonb)`, [this.organizationId, String(source || 'server').slice(0, 120), String(severity || 'error').slice(0, 20), String(error && error.message || error || 'Unknown error').slice(0, 3000), JSON.stringify(context || {})]);
  }

  async recentJobErrors(limit = 20) {
    await this.ensureSchema();
    const result = await this.pool.query(`SELECT id, source, severity, message, context, created_at
      FROM woa_job_errors
      WHERE organization_id = $1 AND resolved_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2`, [this.organizationId, Math.max(1, Math.min(100, Number(limit || 20)))]);
    return result.rows.map(row => ({
      id: Number(row.id),
      source: row.source,
      severity: row.severity,
      message: row.message,
      context: row.context || {},
      createdAt: row.created_at
    }));
  }

  async reserveAiUsage(options = {}) {
    const dailyLimit = Math.max(0, Number(options.dailyLimit || 0));
    const monthlyLimit = Math.max(0, Number(options.monthlyLimit || 0));
    const dayKey = String(options.dayKey || '').trim();
    const monthKey = String(options.monthKey || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || !/^\d{4}-\d{2}$/.test(monthKey)) {
      throw new Error('Star AI quota requires valid day and month keys.');
    }
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO woa_ai_usage (organization_id, period_type, period_key)
        VALUES ($1, 'day', $2), ($1, 'month', $3)
        ON CONFLICT (organization_id, period_type, period_key) DO NOTHING`, [this.organizationId, dayKey, monthKey]);
      const rows = await client.query(`SELECT period_type, request_count
        FROM woa_ai_usage
        WHERE organization_id = $1
          AND ((period_type = 'day' AND period_key = $2) OR (period_type = 'month' AND period_key = $3))
        FOR UPDATE`, [this.organizationId, dayKey, monthKey]);
      const counts = { day: 0, month: 0 };
      rows.rows.forEach(row => { counts[row.period_type] = Number(row.request_count || 0); });
      if (dailyLimit && counts.day >= dailyLimit) {
        await client.query('COMMIT');
        return { allowed: false, reason: 'daily_limit', daily: { used: counts.day, limit: dailyLimit }, monthly: { used: counts.month, limit: monthlyLimit } };
      }
      if (monthlyLimit && counts.month >= monthlyLimit) {
        await client.query('COMMIT');
        return { allowed: false, reason: 'monthly_limit', daily: { used: counts.day, limit: dailyLimit }, monthly: { used: counts.month, limit: monthlyLimit } };
      }
      await client.query(`UPDATE woa_ai_usage
        SET request_count = request_count + 1, updated_at = now()
        WHERE organization_id = $1
          AND ((period_type = 'day' AND period_key = $2) OR (period_type = 'month' AND period_key = $3))`, [this.organizationId, dayKey, monthKey]);
      await client.query('COMMIT');
      return {
        allowed: true,
        daily: { used: counts.day + 1, limit: dailyLimit },
        monthly: { used: counts.month + 1, limit: monthlyLimit }
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async listSnapshots(limit = 30) {
    await this.ensureSchema();
    const result = await this.pool.query(`SELECT id, version, checksum, reason, actor, created_at
      FROM woa_state_snapshots
      WHERE organization_id = $1
      ORDER BY version DESC
      LIMIT $2`, [this.organizationId, Math.max(1, Math.min(100, Number(limit || 30)))]);
    return result.rows.map(row => ({
      id: Number(row.id),
      version: Number(row.version || 0),
      checksum: row.checksum || '',
      reason: row.reason || '',
      actor: row.actor || '',
      createdAt: row.created_at
    }));
  }

  async restoreSnapshot(snapshotId, options = {}) {
    const id = Number(snapshotId || 0);
    if (!Number.isInteger(id) || id < 1) {
      const error = new Error('Choose a valid PostgreSQL snapshot to restore.');
      error.code = 'snapshot_not_found';
      throw error;
    }
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const snapshotResult = await client.query(`SELECT id, version, checksum, state
        FROM woa_state_snapshots
        WHERE id = $1 AND organization_id = $2
        FOR UPDATE`, [id, this.organizationId]);
      if (!snapshotResult.rowCount) {
        const error = new Error('The requested recovery snapshot was not found for this company.');
        error.code = 'snapshot_not_found';
        throw error;
      }
      const currentResult = await client.query('SELECT version FROM woa_state WHERE organization_id = $1 FOR UPDATE', [this.organizationId]);
      if (!currentResult.rowCount) {
        const error = new Error('No current PostgreSQL state exists to restore. Complete the controlled JSON import first.');
        error.code = 'state_not_found';
        throw error;
      }
      const snapshot = snapshotResult.rows[0];
      let restored = this.repair(clone(snapshot.state));
      if (typeof options.transform === 'function') {
        const transformed = await options.transform(restored);
        if (transformed && typeof transformed === 'object') restored = transformed;
      }
      const next = this.repair(clone(restored));
      const nextVersion = Number(currentResult.rows[0].version || 0) + 1;
      const nextChecksum = checksum(next);
      await client.query(`UPDATE woa_state
        SET state = $2::jsonb, version = $3, checksum = $4, updated_at = now()
        WHERE organization_id = $1`, [this.organizationId, JSON.stringify(next), nextVersion, nextChecksum]);
      await this.refreshIdentityIndex(client, next);
      await this.syncDocumentMetadata(client, next);
      await client.query(`INSERT INTO woa_state_snapshots (organization_id, version, checksum, reason, actor, state)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [
        this.organizationId,
        nextVersion,
        nextChecksum,
        String(options.reason || 'controlled snapshot recovery').slice(0, 160),
        String(options.actor || '').slice(0, 160),
        JSON.stringify(next)
      ]);
      await client.query(`DELETE FROM woa_state_snapshots
        WHERE organization_id = $1 AND id IN (
          SELECT id FROM woa_state_snapshots WHERE organization_id = $1 ORDER BY version DESC OFFSET $2
        )`, [this.organizationId, this.snapshotLimit]);
      await client.query('COMMIT');
      return {
        state: next,
        version: nextVersion,
        checksum: nextChecksum,
        restoredSnapshot: { id: Number(snapshot.id), version: Number(snapshot.version || 0), checksum: snapshot.checksum || '' }
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async health() {
    try {
      await this.ensureSchema();
      const result = await this.pool.query('SELECT version, updated_at FROM woa_state WHERE organization_id = $1', [this.organizationId]);
      return { backend: 'postgres', connected: true, transactional: true, productionReady: true, version: result.rowCount ? Number(result.rows[0].version || 0) : 0, updatedAt: result.rowCount ? result.rows[0].updated_at : '' };
    } catch (error) {
      return { backend: 'postgres', connected: false, transactional: true, productionReady: false, error: String(error && error.message || error) };
    }
  }

  async close() {
    await this.pool.end();
  }
}

function createStateRepository(options = {}) {
  const backend = normalizeBackend(options.backend || process.env.WOA_DATA_BACKEND);
  if (backend === 'postgres') return new PostgresStateRepository(options);
  return new JsonStateRepository(options);
}

module.exports = {
  MIGRATION_ID,
  DEFAULT_ORGANIZATION_ID,
  clone,
  stableJson,
  checksum,
  identityEntries,
  identityConflicts,
  privateDocumentRows,
  JsonStateRepository,
  PostgresStateRepository,
  createStateRepository
};
