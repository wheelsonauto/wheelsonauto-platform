'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MIGRATION_ID = '20260717_production_state_foundation_v1';
const TRANSACTIONAL_INDEX_MIGRATION_ID = '20260718_transactional_resource_assignment_indexes_v2';
const DURABLE_RATE_LIMIT_MIGRATION_ID = '20260718_durable_security_rate_limits_v3';
const DOCUMENT_TENANT_PRIMARY_KEY_MIGRATION_ID = '20260718_document_tenant_primary_key_v4';
const DEFAULT_ORGANIZATION_ID = 'org-wheelsonauto';
const RECOVERY_DRILL_REQUIRED_CHECKS = Object.freeze([
  'durableJobLock',
  'durableRateLimit',
  'webhookLeaseRecovery',
  'idempotencyLeaseRecovery',
  'snapshotRestore',
  'serverRestartRead',
  'stateChecksum',
  'migrationProof'
]);
const DEFAULT_RECOVERY_DRILL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function clone(value) {
  return JSON.parse(JSON.stringify(value === undefined ? {} : value));
}

function normalizedStateTransactionEffects(options = {}) {
  const effects = options && options.transactionEffects && typeof options.transactionEffects === 'object'
    ? options.transactionEffects
    : {};
  const webhookCompletions = (Array.isArray(effects.webhookCompletions) ? effects.webhookCompletions : [])
    .map(item => ({ provider: String(item && item.provider || '').trim(), eventId: String(item && item.eventId || '').trim() }))
    .filter(item => item.provider && item.eventId);
  const idempotencySettlements = (Array.isArray(effects.idempotencySettlements) ? effects.idempotencySettlements : [])
    .map(item => ({
      action: String(item && item.action || '').trim().toLowerCase(),
      scope: String(item && item.scope || '').trim(),
      key: String(item && item.key || '').trim(),
      response: clone(item && item.response || {}),
      error: String(item && item.error || '').slice(0, 3000),
      claimToken: String(item && item.claimToken || '').trim(),
      providerAuthoritative: item && item.providerAuthoritative === true
    }))
    .filter(item => ['complete', 'fail'].includes(item.action) && item.scope && item.key);
  return {
    webhookCompletions: [...new Map(webhookCompletions.map(item => [item.provider + '|' + item.eventId, item])).values()],
    idempotencySettlements: [...new Map(idempotencySettlements.map(item => [item.action + '|' + item.scope + '|' + item.key, item])).values()]
  };
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}

function checksum(value) {
  return crypto.createHash('sha256').update(stableJson(value || {}), 'utf8').digest('hex');
}

function jobErrorFingerprint(source, severity, message, context = {}, explicit = '') {
  const supplied = String(explicit || '').trim();
  if (supplied) return supplied.slice(0, 128);
  const fingerprintContext = context && typeof context === 'object' && !Array.isArray(context) ? { ...context } : {};
  delete fingerprintContext.source;
  return checksum({
    source: String(source || 'server').slice(0, 120),
    severity: String(severity || 'error').slice(0, 20),
    message: String(message || 'Unknown error').slice(0, 3000),
    context: fingerprintContext
  });
}

function jobErrorTime(value, fallback = '') {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value || fallback || '');
}

function groupedOpenJobErrors(rows = [], limit = 20) {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    if (!row || row.resolvedAt || row.resolved_at) return;
    const fingerprint = jobErrorFingerprint(row.source, row.severity, row.message, row.context, row.fingerprint);
    const occurrenceCount = Math.max(1, Number(row.occurrenceCount || row.occurrence_count || 1));
    const firstSeenAt = jobErrorTime(row.firstSeenAt || row.first_seen_at || row.createdAt || row.created_at);
    const lastSeenAt = jobErrorTime(row.lastSeenAt || row.last_seen_at || row.createdAt || row.created_at, firstSeenAt);
    const existing = groups.get(fingerprint);
    if (!existing) {
      groups.set(fingerprint, {
        ...row,
        fingerprint,
        firstSeenAt,
        lastSeenAt,
        occurrenceCount,
        relatedIds: [row.id]
      });
      return;
    }
    existing.occurrenceCount += occurrenceCount;
    existing.relatedIds.push(row.id);
    if (Date.parse(firstSeenAt || '') < Date.parse(existing.firstSeenAt || '')) existing.firstSeenAt = firstSeenAt;
    if (Date.parse(lastSeenAt || '') > Date.parse(existing.lastSeenAt || '')) {
      existing.id = row.id;
      existing.source = row.source;
      existing.severity = row.severity;
      existing.message = row.message;
      existing.context = row.context || {};
      existing.createdAt = row.createdAt || row.created_at;
      existing.lastSeenAt = lastSeenAt;
    }
  });
  return [...groups.values()]
    .sort((left, right) => Date.parse(right.lastSeenAt || right.createdAt || 0) - Date.parse(left.lastSeenAt || left.createdAt || 0))
    .slice(0, Math.max(1, Math.min(100, Number(limit || 20))));
}

function idempotencyRequestHash(request = {}) {
  return checksum(request && typeof request === 'object' ? request : { value: request });
}

function idempotencyClaimToken() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(24).toString('hex');
}

function idempotencyScopeKey(scope, key) {
  const normalizedScope = String(scope || '').trim().slice(0, 120);
  const normalizedKey = String(key || '').trim().slice(0, 255);
  if (!normalizedScope || !normalizedKey) {
    const error = new Error('A durable idempotency scope and key are required before a money action can run.');
    error.code = 'woa_idempotency_key_required';
    error.statusCode = 400;
    throw error;
  }
  return { scope: normalizedScope, key: normalizedKey };
}

function rateLimitIdentity(scope, key, secret, organizationId) {
  const normalizedScope = String(scope || '').trim().slice(0, 120);
  const rawKey = String(key || '').trim();
  if (!normalizedScope || !rawKey) {
    const error = new Error('A rate-limit scope and identity are required.');
    error.code = 'woa_rate_limit_identity_required';
    throw error;
  }
  const signingKey = String(secret || organizationId || DEFAULT_ORGANIZATION_ID);
  return {
    scope: normalizedScope,
    keyHash: crypto.createHmac('sha256', signingKey)
      .update([normalizeOrganizationId(organizationId), normalizedScope, rawKey].join('\u0000'), 'utf8')
      .digest('hex')
  };
}

function rateLimitPolicy(limit, windowMs) {
  return {
    limit: Math.max(1, Math.min(1000000, Math.floor(Number(limit || 1)))),
    windowMs: Math.max(1000, Math.min(30 * 24 * 60 * 60 * 1000, Math.floor(Number(windowMs || 60000))))
  };
}

function rateLimitResult(count, limit, expiresAt, consumed) {
  const requestCount = Math.max(0, Number(count || 0));
  const maximum = Math.max(1, Number(limit || 1));
  const expiresAtMs = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt || '');
  const allowed = consumed ? requestCount <= maximum : requestCount < maximum;
  const retryAfterMs = allowed || !Number.isFinite(expiresAtMs) ? 0 : Math.max(1000, expiresAtMs - Date.now());
  return {
    allowed,
    count: requestCount,
    limit: maximum,
    remaining: Math.max(0, maximum - requestCount),
    retryAfterMs,
    retryAfterSeconds: retryAfterMs ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : 0,
    expiresAt: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : ''
  };
}

function idempotencyRequestMismatchError(scope, key) {
  const error = new Error('This billing action is already protected by a different request. Do not change the amount, customer, or card while the original charge is pending or completed.');
  error.code = 'woa_idempotency_request_mismatch';
  error.statusCode = 409;
  error.scope = String(scope || '');
  error.key = String(key || '');
  return error;
}

function checksumEvidence(value, expectedChecksum) {
  const expected = String(expectedChecksum || '').trim();
  const actual = checksum(value);
  return {
    expected,
    actual,
    matches: !!expected && actual === expected
  };
}

function assertChecksum(value, expectedChecksum, label = 'PostgreSQL state') {
  const evidence = checksumEvidence(value, expectedChecksum);
  if (evidence.matches) return evidence;
  const error = new Error(label + ' checksum verification failed. Refusing to serve, mutate, or restore a corrupted state payload.');
  error.code = 'woa_state_checksum_mismatch';
  throw error;
}

function recoverySnapshotEvidence(snapshot, current = {}) {
  const hasSnapshot = !!(snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'state'));
  const currentVersion = Number(current.version || 0);
  const currentChecksum = String(current.checksum || '').trim();
  const snapshotVersion = hasSnapshot ? Number(snapshot.version || 0) : 0;
  const snapshotChecksum = hasSnapshot ? String(snapshot.checksum || '').trim() : '';
  const integrity = hasSnapshot
    ? checksumEvidence(snapshot.state, snapshotChecksum)
    : { expected: '', actual: '', matches: false };
  const versionMatchesCurrent = hasSnapshot && snapshotVersion === currentVersion;
  const checksumMatchesCurrent = hasSnapshot && !!currentChecksum && snapshotChecksum === currentChecksum;
  const ready = integrity.matches && versionMatchesCurrent && checksumMatchesCurrent;
  const status = !hasSnapshot ? 'missing' : !integrity.matches ? 'failed' : ready ? 'verified' : 'stale';
  return {
    snapshotCount: Math.max(0, Number(current.snapshotCount || 0)),
    latestSnapshotId: hasSnapshot ? Number(snapshot.id || 0) : 0,
    latestSnapshotVersion: snapshotVersion,
    latestSnapshotAt: hasSnapshot ? snapshot.createdAt || snapshot.created_at || '' : '',
    snapshotIntegrity: status,
    snapshotChecksumMatchesCurrent: checksumMatchesCurrent,
    snapshotVersionMatchesCurrent: versionMatchesCurrent,
    snapshotRecoveryReady: ready
  };
}

function migrationRecordCounts(state = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {};
  return Object.keys(state).sort().reduce((counts, key) => {
    if (Array.isArray(state[key])) counts[key] = state[key].length;
    return counts;
  }, {});
}

function migrationProofEvidence(proof) {
  const row = proof || {};
  const sourceChecksum = String(row.sourceChecksum || row.source_checksum || '').trim();
  const canonicalSourceChecksum = String(row.canonicalSourceChecksum || row.canonical_source_checksum || '').trim();
  const targetChecksum = String(row.targetChecksum || row.target_checksum || '').trim();
  const sourceRecordCounts = row.sourceRecordCounts || row.source_record_counts || {};
  const targetRecordCounts = row.targetRecordCounts || row.target_record_counts || {};
  const importedVersion = Number(row.importedVersion || row.imported_version || 0);
  const snapshotChecksum = String(row.snapshotChecksum || row.snapshot_checksum || '').trim();
  const verifiedAt = row.verifiedAt || row.verified_at || '';
  const hasProof = !!(sourceChecksum && canonicalSourceChecksum && targetChecksum && importedVersion > 0 && snapshotChecksum && verifiedAt);
  const canonicalChecksumMatchesTarget = hasProof && canonicalSourceChecksum === targetChecksum;
  const countsMatch = hasProof && stableJson(sourceRecordCounts) === stableJson(targetRecordCounts);
  const snapshotChecksumMatchesTarget = hasProof && snapshotChecksum === targetChecksum;
  const ready = canonicalChecksumMatchesTarget && countsMatch && snapshotChecksumMatchesTarget;
  return {
    importedVersion,
    importedAt: verifiedAt,
    sourceChecksum,
    canonicalSourceChecksum,
    targetChecksum,
    sourceRecordCounts,
    targetRecordCounts,
    migrationProofIntegrity: !hasProof ? 'missing' : ready ? 'verified' : 'failed',
    migrationChecksumMatchesTarget: canonicalChecksumMatchesTarget,
    migrationRecordCountsMatch: countsMatch,
    migrationSnapshotMatchesTarget: snapshotChecksumMatchesTarget,
    migrationProofReady: ready
  };
}

function recoveryDrillConfigurationFingerprint(secret, databaseUrl, organizationId = DEFAULT_ORGANIZATION_ID) {
  const key = String(secret || '');
  const database = String(databaseUrl || '');
  const organization = String(organizationId || DEFAULT_ORGANIZATION_ID).trim() || DEFAULT_ORGANIZATION_ID;
  if (!key || !database) return '';
  return crypto.createHmac('sha256', key)
    .update(['wheelsonauto-recovery-drill-v1', database, organization].join('\u0000'), 'utf8')
    .digest('hex');
}

function recoveryDrillEvidence(proof, options = {}) {
  const row = proof || {};
  const result = String(row.result || row.status || '').trim().toLowerCase();
  const runId = String(row.runId || row.run_id || '').trim();
  const testDatabaseFingerprint = String(row.testDatabaseFingerprint || row.test_database_fingerprint || '').trim();
  const configurationFingerprint = String(row.configurationFingerprint || row.configuration_fingerprint || '').trim();
  const scriptVersion = String(row.scriptVersion || row.script_version || '').trim();
  const checks = row.checks && typeof row.checks === 'object' && !Array.isArray(row.checks) ? row.checks : {};
  const requiredChecks = Array.isArray(options.requiredChecks) && options.requiredChecks.length
    ? options.requiredChecks.map(value => String(value || '').trim()).filter(Boolean)
    : RECOVERY_DRILL_REQUIRED_CHECKS;
  const missingChecks = requiredChecks.filter(check => checks[check] !== true);
  const verifiedAt = String(row.verifiedAt || row.verified_at || '');
  const verifiedAtMs = Date.parse(verifiedAt);
  const maxAgeMs = Math.max(60 * 60 * 1000, Number(options.maxAgeMs || DEFAULT_RECOVERY_DRILL_MAX_AGE_MS));
  const fresh = Number.isFinite(verifiedAtMs) && verifiedAtMs <= Date.now() + 5 * 60 * 1000 && Math.max(0, Date.now() - verifiedAtMs) <= maxAgeMs;
  const expectedFingerprint = String(options.configurationFingerprint || options.expectedConfigurationFingerprint || '').trim();
  const configurationMatched = expectedFingerprint
    ? !!configurationFingerprint && configurationFingerprint === expectedFingerprint
    : !!configurationFingerprint;
  const checksPassed = missingChecks.length === 0;
  const passed = result === 'passed' && !!runId && !!testDatabaseFingerprint && !!scriptVersion && checksPassed;
  const ready = passed && configurationMatched && fresh;
  let error = '';
  if (!runId || !testDatabaseFingerprint || !scriptVersion) error = 'No signed controlled PostgreSQL recovery drill record exists yet.';
  else if (result !== 'passed') error = 'The latest controlled PostgreSQL recovery drill did not pass.';
  else if (!checksPassed) error = 'The latest controlled PostgreSQL recovery drill is missing: ' + missingChecks.join(', ') + '.';
  else if (!configurationMatched) error = 'The recorded recovery drill belongs to an older or unknown PostgreSQL configuration. Run a new controlled drill after the current Render settings are deployed.';
  else if (!fresh) error = 'The controlled PostgreSQL recovery drill is stale. Run it again before the Stripe launch.';
  return {
    runId,
    result,
    verifiedAt,
    testDatabaseConfigured: !!testDatabaseFingerprint,
    scriptVersion,
    checks,
    requiredChecks,
    missingChecks,
    checksPassed,
    configurationMatched,
    fresh,
    maxAgeHours: Math.round(maxAgeMs / (60 * 60 * 1000)),
    ready,
    error
  };
}

function normalizeOrganizationId(value) {
  return String(value || DEFAULT_ORGANIZATION_ID).trim() || DEFAULT_ORGANIZATION_ID;
}

function advisoryLockKeys(organizationId, name) {
  const digest = crypto.createHash('sha256').update(normalizeOrganizationId(organizationId) + '\u0000' + String(name || '').trim(), 'utf8').digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

function normalizeBackend(value) {
  const backend = String(value || 'json').trim().toLowerCase();
  if (backend === 'postgres' || backend === 'postgresql') return 'postgres';
  if (backend === 'json') return 'json';
  const error = new Error('Unsupported WOA_DATA_BACKEND "' + backend + '". Use exactly json or postgres; refusing to guess and fall back to a file.');
  error.code = 'woa_data_backend_invalid';
  throw error;
}

function normalizedIdentity(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function rowId(row, fallback) {
  return String(row && (row.id || row.paymentRequestId || row.recurringPaymentId || row.providerPaymentId || row.stripePaymentIntentId || row.cloverPaymentId || row.cloverSubscriptionId || row.subscriptionId || row.externalCaseId || row.providerCaseId) || fallback || '').trim();
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
  // Email is a contact alias, not an immutable customer identity. Clover can
  // legitimately return multiple customer/plan history rows for one person,
  // and family members can share an inbox. Portal usernames remain strict.
  (state.customerAccounts || []).forEach((account, index) => {
    const id = rowId(account, 'customer-account-' + index);
    pushIdentity(entries, 'portal_username', account && account.username, 'customer_account', id);
  });
  // Provider customer ids are intentionally not unique because one customer
  // can have multiple legitimate plans. Each provider subscription, however,
  // must identify exactly one local recurring-payment row.
  (state.recurringPayments || []).forEach((recurring, index) => {
    const id = String(recurring && (recurring.id || recurring.recurringPaymentId) || 'recurring-payment-' + index).trim();
    pushIdentity(entries, 'clover_subscription', recurring && recurring.cloverSubscriptionId, 'recurring_payment', id);
    pushIdentity(entries, 'stripe_subscription', recurring && recurring.stripeSubscriptionId, 'recurring_payment', id);
  });
  // A signed verification webhook resolves an external provider id back to one
  // customer case. Keep ids provider-scoped so different providers may reuse a
  // value, while preventing one provider event from matching two local cases.
  (state.verificationCases || []).forEach((verification, index) => {
    const id = String(verification && verification.id || 'verification-case-' + index).trim();
    const provider = normalizedIdentity(verification && verification.provider || 'unknown').replace(/[^a-z0-9]+/g, '_') || 'unknown';
    const externalIds = [...new Set([
      verification && verification.externalCaseId,
      verification && verification.providerCaseId,
      verification && verification.providerPullId,
      verification && verification.providerReportId,
      verification && verification.providerInvitationId
    ].map(normalizedIdentity).filter(Boolean))];
    externalIds.forEach(externalId => pushIdentity(entries, 'verification_provider_case:' + provider, externalId, 'verification_case', id));
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

function identityWarnings(state = {}) {
  const warnings = [];
  (state.vehicles || []).forEach((vehicle, index) => {
    if (normalizedIdentity(vehicle && vehicle.vin)) return;
    const status = normalizedIdentity(vehicle && vehicle.status);
    if (['pending application', 'application draft', 'draft', 'removed', 'deleted'].includes(status)) return;
    const id = rowId(vehicle, 'vehicle-' + index);
    const label = [vehicle && vehicle.year, vehicle && vehicle.make, vehicle && vehicle.model].filter(Boolean).join(' ').trim()
      || String(vehicle && (vehicle.name || vehicle.vehicle) || id).trim();
    warnings.push({
      kind: 'vehicle_missing_vin',
      resourceType: 'vehicle',
      resourceId: id,
      label: label || id,
      message: 'Vehicle is missing VIN: ' + (label || id)
    });
  });
  return warnings;
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

const CRITICAL_RESOURCE_COLLECTIONS = Object.freeze([
  ['vehicles', 'vehicle'],
  ['onlineVehicles', 'online_vehicle'],
  ['customers', 'customer'],
  ['contracts', 'customer_file'],
  ['applications', 'application'],
  ['verificationCases', 'verification_case'],
  ['documents', 'document'],
  ['eSignatures', 'e_signature'],
  ['onboardingSessions', 'onboarding_session'],
  ['pickupAppointments', 'pickup_appointment'],
  ['recurringPayments', 'recurring_payment'],
  ['payments', 'payment'],
  ['paymentRequests', 'payment_request'],
  ['refundRequests', 'refund_request'],
  ['cardSetupRequests', 'card_setup_request'],
  ['claims', 'claim'],
  ['maintenance', 'maintenance'],
  ['customerAccounts', 'customer_account']
]);
const INACTIVE_ASSIGNMENT_PATTERN = /(removed|history|returned|ended|closed|cancelled|canceled|inactive|stopped|pending application|pending approval|awaiting approval|awaiting pickup|pending pickup|\bdraft\b|\blead\b|\bprospect\b|\bnew\b)/i;
const AVAILABLE_VEHICLE_PATTERN = /\b(ready|available|in lot|fleet ready|prep|in prep)\b/i;

function criticalResourceIndexRows(state = {}) {
  const rows = [];
  const seen = new Set();
  CRITICAL_RESOURCE_COLLECTIONS.forEach(([collection, resourceType]) => {
    const records = Array.isArray(state[collection]) ? state[collection] : [];
    records.forEach((record, index) => {
      const resourceId = rowId(record);
      if (!resourceId) {
        const error = new Error('Critical ' + resourceType.replace(/_/g, ' ') + ' record at index ' + index + ' has no stable id. Refusing an unrecoverable database write.');
        error.code = 'woa_resource_identity_missing';
        error.resourceType = resourceType;
        error.recordIndex = index;
        throw error;
      }
      const identity = resourceType + '\u0000' + resourceId;
      if (seen.has(identity)) {
        const error = new Error('Critical ' + resourceType.replace(/_/g, ' ') + ' id ' + resourceId + ' appears more than once. Refusing an ambiguous database write.');
        error.code = 'woa_resource_identity_conflict';
        error.resourceType = resourceType;
        error.resourceId = resourceId;
        throw error;
      }
      seen.add(identity);
      const customer = resourceType === 'customer'
        ? record && (record.customer || record.name || record.email)
        : record && (record.customer || record.customerName || record.applicantName || record.renter || record.accountName);
      rows.push({
        resourceType,
        resourceId,
        customerKey: normalizedIdentity(customer),
        vehicleId: String(resourceType === 'vehicle' || resourceType === 'online_vehicle' ? resourceId : record && record.vehicleId || '').trim(),
        status: String(record && (record.status || record.stage || record.state) || '').trim().slice(0, 160)
      });
    });
  });
  return rows.sort((left, right) => left.resourceType.localeCompare(right.resourceType) || left.resourceId.localeCompare(right.resourceId));
}

function assignmentNameTokens(value) {
  return normalizedIdentity(value).split(/[^a-z0-9]+/).filter(token => token.length > 2 && !['and', 'the', 'jr', 'sr'].includes(token));
}

function sameAssignmentCustomer(a, b) {
  const first = normalizedIdentity(a);
  const second = normalizedIdentity(b);
  if (!first || !second) return false;
  if (first === second) return true;
  const firstTokens = assignmentNameTokens(first);
  const secondTokens = assignmentNameTokens(second);
  if (firstTokens.length < 2 || secondTokens.length < 2) return false;
  const shorter = firstTokens.length <= secondTokens.length ? firstTokens : secondTokens;
  const longer = firstTokens.length <= secondTokens.length ? secondTokens : firstTokens;
  if (shorter.every(token => longer.includes(token))) return true;
  return firstTokens[0] === secondTokens[0] && firstTokens[firstTokens.length - 1] === secondTokens[secondTokens.length - 1];
}

function approvedAssignmentAliases(state = {}, vehicleId = '') {
  const id = String(vehicleId || '').trim();
  if (!id) return [];
  return (Array.isArray(state.assignmentCustomerAliases) ? state.assignmentCustomerAliases : []).filter(row => {
    return row && row.active !== false && String(row.vehicleId || '').trim() === id;
  });
}

function sameApprovedAssignmentCustomer(state = {}, vehicleId = '', a, b) {
  if (sameAssignmentCustomer(a, b)) return true;
  const first = normalizedIdentity(a);
  const second = normalizedIdentity(b);
  if (!first || !second) return false;
  const graph = new Map();
  approvedAssignmentAliases(state, vehicleId).forEach(row => {
    const names = [row.canonicalCustomer, row.aliasCustomer]
      .concat(Array.isArray(row.aliases) ? row.aliases : [])
      .map(normalizedIdentity)
      .filter(Boolean);
    names.forEach(name => {
      if (!graph.has(name)) graph.set(name, new Set());
      names.forEach(other => {
        if (other !== name) graph.get(name).add(other);
      });
    });
  });
  if (!graph.has(first)) return false;
  const seen = new Set([first]);
  const queue = [first];
  while (queue.length) {
    const name = queue.shift();
    if (name === second) return true;
    (graph.get(name) || []).forEach(other => {
      if (seen.has(other)) return;
      seen.add(other);
      queue.push(other);
    });
  }
  return false;
}

function activeAssignmentCandidate(row = {}) {
  const customer = String(row.customer || row.name || '').trim();
  const vehicleId = String(row.vehicleId || '').trim();
  if (!customer || !vehicleId) return null;
  const status = String([row.status, row.stage, row.endStatus, row.nextRun, row.autopayManagedBy].filter(Boolean).join(' '));
  if (INACTIVE_ASSIGNMENT_PATTERN.test(status)) return null;
  return { customer, vehicleId };
}

function activeAssignmentIndexRows(state = {}) {
  const vehicles = Array.isArray(state.vehicles) ? state.vehicles : [];
  const vehicleById = new Map();
  vehicles.forEach((vehicle, index) => {
    const id = String(vehicle && vehicle.id || '').trim();
    if (!id) {
      const error = new Error('Vehicle at index ' + index + ' has no stable id. Refusing to build the active-assignment index.');
      error.code = 'woa_resource_identity_missing';
      error.resourceType = 'vehicle';
      throw error;
    }
    if (vehicleById.has(id)) {
      const error = new Error('Vehicle id ' + id + ' appears more than once. Refusing an ambiguous active-assignment index.');
      error.code = 'woa_resource_identity_conflict';
      error.resourceType = 'vehicle';
      error.resourceId = id;
      throw error;
    }
    vehicleById.set(id, vehicle);
  });
  const claimsByVehicle = new Map();
  const addClaims = (records, source) => {
    (Array.isArray(records) ? records : []).forEach((record, index) => {
      const candidate = activeAssignmentCandidate(record);
      if (!candidate) return;
      if (!vehicleById.has(candidate.vehicleId)) {
        const error = new Error('Active ' + source + ' record points to missing vehicle ' + candidate.vehicleId + '. Refusing to save a broken customer assignment.');
        error.code = 'woa_assignment_vehicle_missing';
        error.vehicleId = candidate.vehicleId;
        error.customer = candidate.customer;
        error.source = source;
        throw error;
      }
      const list = claimsByVehicle.get(candidate.vehicleId) || [];
      list.push({
        ...candidate,
        source,
        id: rowId(record, source + '-' + index),
        status: String(record && (record.status || record.stage) || 'Active').trim().slice(0, 160)
      });
      claimsByVehicle.set(candidate.vehicleId, list);
    });
  };
  addClaims(state.recurringPayments, 'recurring_payment');
  addClaims((((state.integrations || {}).clover || {}).recurringPlanMembers), 'clover_recurring');
  addClaims(state.contracts, 'customer_file');
  addClaims(state.customers, 'customer');

  const result = [];
  vehicles.forEach(vehicle => {
    const vehicleId = String(vehicle.id || '').trim();
    let claims = claimsByVehicle.get(vehicleId) || [];
    if (!claims.length) {
      const currentCustomer = String(vehicle.currentCustomer || '').trim();
      const status = String(vehicle.status || '').trim();
      if (currentCustomer && !AVAILABLE_VEHICLE_PATTERN.test(status) && !INACTIVE_ASSIGNMENT_PATTERN.test(status)) {
        claims = [{ customer: currentCustomer, vehicleId, source: 'vehicle', id: vehicleId, status: status || 'Assigned' }];
      }
    }
    if (!claims.length) return;
    const groups = [];
    claims.forEach(claim => {
      const group = groups.find(names => names.some(name => sameApprovedAssignmentCustomer(state, vehicleId, name, claim.customer)));
      if (group) group.push(claim.customer);
      else groups.push([claim.customer]);
    });
    if (groups.length !== 1) {
      const customers = [...new Set(claims.map(claim => claim.customer).filter(Boolean))];
      const error = new Error('Vehicle ' + vehicleId + ' has active records for multiple customers: ' + customers.join(' / ') + '. Refusing an ambiguous assignment write.');
      error.code = 'woa_assignment_identity_conflict';
      error.vehicleId = vehicleId;
      error.customers = customers;
      error.claims = claims.slice(0, 20);
      throw error;
    }
    const savedCustomer = String(vehicle.currentCustomer || '').trim();
    const customerName = savedCustomer && claims.some(claim => sameApprovedAssignmentCustomer(state, vehicleId, savedCustomer, claim.customer))
      ? savedCustomer
      : claims[0].customer;
    result.push({
      vehicleId,
      customerKey: normalizedIdentity(customerName),
      customerName,
      sourceRefs: claims.map(claim => ({ source: claim.source, id: claim.id, status: claim.status }))
    });
  });
  return result.sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
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
    this.webhookEventClaims = new Map();
    this.idempotencyClaims = new Map();
    this.rateLimitBuckets = new Map();
    this.rateLimitSecret = String(options.rateLimitSecret || this.organizationId);
    this.webhookProcessingLeaseMs = Math.max(30 * 1000, Math.min(60 * 60 * 1000, Number(options.webhookProcessingLeaseMs || 10 * 60 * 1000)));
    this.idempotencyProcessingLeaseMs = Math.max(30 * 1000, Math.min(60 * 60 * 1000, Number(options.idempotencyProcessingLeaseMs || 10 * 60 * 1000)));
    this.idempotencyClaimLimit = Math.max(100, Math.min(5000, Number(options.idempotencyClaimLimit || 1000)));
    this.jobErrorFile = options.jobErrorFile || (this.dataFile ? this.dataFile + '.job-errors.json' : '');
    this.jobErrorLimit = Math.max(10, Math.min(250, Number(options.jobErrorLimit || 80)));
    this.jobErrorWrite = Promise.resolve();
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

  async write(state, options = {}) {
    const next = this.repair(state);
    const directory = path.dirname(this.dataFile);
    await fs.mkdir(directory, { recursive: true });
    const temporary = this.dataFile + '.' + process.pid + '.' + Date.now() + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(temporary, this.dataFile);
    const effects = normalizedStateTransactionEffects(options);
    const appliedEffects = { webhookCompletions: [], idempotencySettlements: [] };
    for (const completion of effects.webhookCompletions) {
      await this.completeWebhookEvent(completion.provider, completion.eventId);
      appliedEffects.webhookCompletions.push({ ...completion, applied: true });
    }
    for (const settlement of effects.idempotencySettlements) {
      let applied;
      if (settlement.action === 'complete') {
        applied = await this.completeIdempotencyKey(settlement.scope, settlement.key, settlement.response, {
          claimToken: settlement.claimToken,
          providerAuthoritative: settlement.providerAuthoritative
        });
      } else {
        applied = await this.failIdempotencyKey(settlement.scope, settlement.key, new Error(settlement.error || 'Provider webhook confirmed the money action failed.'), {
          claimToken: settlement.claimToken
        });
      }
      appliedEffects.idempotencySettlements.push({ ...settlement, applied: applied === true });
    }
    return { state: next, version: await this.version(), checksum: checksum(next), transactionEffects: appliedEffects };
  }

  async readiness() {
    const version = await this.version();
    if (version !== 'missing') return { backend: 'json', connected: true, stateAvailable: true };
    try {
      await fs.access(this.seedFile);
      return { backend: 'json', connected: true, stateAvailable: true };
    } catch (error) {
      return { backend: 'json', connected: false, stateAvailable: false, error: String(error && error.message || error) };
    }
  }

  async health() {
    return {
      backend: 'json',
      connected: true,
      transactional: false,
      productionReady: false,
      migrationProofIntegrity: 'not_supported',
      migrationProofReady: false,
      snapshotIntegrity: 'not_supported',
      snapshotRecoveryReady: false,
      recoveryDrill: recoveryDrillEvidence(null),
      recoveryDrillReady: false,
      version: await this.version()
    };
  }

  async checkRateLimit(scope, key, limit, windowMs) {
    const identity = rateLimitIdentity(scope, key, this.rateLimitSecret, this.organizationId);
    const policy = rateLimitPolicy(limit, windowMs);
    const mapKey = [this.organizationId, identity.scope, identity.keyHash].join('|');
    const bucket = this.rateLimitBuckets.get(mapKey);
    if (!bucket || Number(bucket.expiresAt || 0) <= Date.now()) {
      this.rateLimitBuckets.delete(mapKey);
      return rateLimitResult(0, policy.limit, '', false);
    }
    return rateLimitResult(bucket.count, policy.limit, new Date(bucket.expiresAt), false);
  }

  async consumeRateLimit(scope, key, limit, windowMs) {
    const identity = rateLimitIdentity(scope, key, this.rateLimitSecret, this.organizationId);
    const policy = rateLimitPolicy(limit, windowMs);
    const mapKey = [this.organizationId, identity.scope, identity.keyHash].join('|');
    const now = Date.now();
    const current = this.rateLimitBuckets.get(mapKey);
    const bucket = !current || Number(current.expiresAt || 0) <= now
      ? { count: 1, expiresAt: now + policy.windowMs }
      : { count: Math.min(2147483647, Number(current.count || 0) + 1), expiresAt: current.expiresAt };
    this.rateLimitBuckets.set(mapKey, bucket);
    if (this.rateLimitBuckets.size > 5000) {
      for (const [bucketKey, value] of this.rateLimitBuckets.entries()) {
        if (Number(value.expiresAt || 0) <= now) this.rateLimitBuckets.delete(bucketKey);
      }
    }
    return rateLimitResult(bucket.count, policy.limit, new Date(bucket.expiresAt), true);
  }

  async clearRateLimit(scope, key) {
    const identity = rateLimitIdentity(scope, key, this.rateLimitSecret, this.organizationId);
    return this.rateLimitBuckets.delete([this.organizationId, identity.scope, identity.keyHash].join('|'));
  }

  async claimWebhookEvent(provider, eventId, payload = {}) {
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId) return { accepted: true, duplicate: false, eventId: '' };
    const normalizedProvider = String(provider || '').trim();
    const key = [this.organizationId, normalizedProvider, normalizedEventId].join('|');
    const existing = this.webhookEventClaims.get(key);
    if (existing && existing.status === 'processed') return { accepted: false, duplicate: true, eventId: normalizedEventId, attempts: existing.attempts || 1 };
    const processingStartedAt = Date.parse(existing && existing.processingStartedAt || 0);
    const activelyProcessing = existing && existing.status === 'processing'
      && Number.isFinite(processingStartedAt)
      && Date.now() - processingStartedAt < this.webhookProcessingLeaseMs;
    if (activelyProcessing) return { accepted: false, duplicate: true, inProgress: true, eventId: normalizedEventId, attempts: existing.attempts || 1 };
    const attempts = Number(existing && existing.attempts || 0) + 1;
    const now = new Date().toISOString();
    this.webhookEventClaims.set(key, {
      organizationId: this.organizationId,
      provider: normalizedProvider,
      eventId: normalizedEventId,
      status: 'processing',
      attempts,
      payload: clone(payload || {}),
      receivedAt: existing && existing.receivedAt || now,
      processingStartedAt: now,
      updatedAt: now,
      lastError: ''
    });
    return { accepted: true, duplicate: false, reclaimed: !!(existing && existing.status === 'processing'), eventId: normalizedEventId, attempts };
  }

  async completeWebhookEvent(provider, eventId) {
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId) return;
    const key = [this.organizationId, String(provider || ''), normalizedEventId].join('|');
    const existing = this.webhookEventClaims.get(key) || {};
    const now = new Date().toISOString();
    this.webhookEventClaims.set(key, { ...existing, status: 'processed', attempts: Number(existing.attempts || 1), processedAt: now, updatedAt: now, lastError: '' });
  }

  async failWebhookEvent(provider, eventId, error) {
    const normalizedEventId = String(eventId || '').trim();
    if (!normalizedEventId) return;
    const key = [this.organizationId, String(provider || ''), normalizedEventId].join('|');
    const existing = this.webhookEventClaims.get(key) || {};
    this.webhookEventClaims.set(key, { ...existing, status: 'failed', attempts: Number(existing.attempts || 1), updatedAt: new Date().toISOString(), lastError: String(error && error.message || error || '').slice(0, 3000) });
  }

  async listRecoverableWebhookEvents(provider, options = {}) {
    const normalizedProvider = String(provider || '').trim();
    const now = Number(options.now || Date.now());
    const retryAfterMs = Math.max(0, Number(options.retryAfterMs == null ? 60 * 1000 : options.retryAfterMs));
    const staleAfterMs = Math.max(30 * 1000, Number(options.staleAfterMs || this.webhookProcessingLeaseMs));
    const maxAttempts = Math.max(1, Math.min(100, Number(options.maxAttempts || 8)));
    const limit = Math.max(1, Math.min(100, Number(options.limit || 25)));
    return [...this.webhookEventClaims.values()]
      .filter(claim => {
        if (!claim || claim.provider !== normalizedProvider || Number(claim.attempts || 0) >= maxAttempts) return false;
        const processingStartedAt = Date.parse(claim.processingStartedAt || claim.receivedAt || 0);
        const updatedAt = Date.parse(claim.updatedAt || claim.processingStartedAt || claim.receivedAt || 0);
        if (claim.status === 'failed') return Number.isFinite(updatedAt) && now - updatedAt >= retryAfterMs;
        return claim.status === 'processing' && Number.isFinite(processingStartedAt) && now - processingStartedAt >= staleAfterMs;
      })
      .sort((left, right) => Date.parse(left.processingStartedAt || left.receivedAt || 0) - Date.parse(right.processingStartedAt || right.receivedAt || 0))
      .slice(0, limit)
      .map(claim => clone(claim));
  }

  pruneIdempotencyClaims() {
    if (this.idempotencyClaims.size <= this.idempotencyClaimLimit) return;
    const removable = [...this.idempotencyClaims.entries()]
      .filter(([, claim]) => claim.status === 'completed' || claim.status === 'failed')
      .sort(([, left], [, right]) => String(left.updatedAt || left.createdAt || '').localeCompare(String(right.updatedAt || right.createdAt || '')));
    while (this.idempotencyClaims.size > this.idempotencyClaimLimit && removable.length) {
      this.idempotencyClaims.delete(removable.shift()[0]);
    }
  }

  async claimIdempotencyKey(scope, key, request = {}, options = {}) {
    const identity = idempotencyScopeKey(scope, key);
    const requestHash = String(options.requestHash || idempotencyRequestHash(request));
    const mapKey = [this.organizationId, identity.scope, identity.key].join('|');
    const now = new Date().toISOString();
    const existing = this.idempotencyClaims.get(mapKey);
    if (existing) {
      if (existing.requestHash && requestHash && existing.requestHash !== requestHash && existing.status !== 'failed') {
        throw idempotencyRequestMismatchError(identity.scope, identity.key);
      }
      if (existing.status === 'completed') {
        return { accepted: false, duplicate: true, completed: true, scope: identity.scope, key: identity.key, attempts: Number(existing.attempts || 1), response: clone(existing.response || {}) };
      }
      const startedAt = Date.parse(existing.processingStartedAt || existing.updatedAt || existing.createdAt || 0);
      const active = existing.status === 'claimed' && Number.isFinite(startedAt) && Date.now() - startedAt < this.idempotencyProcessingLeaseMs;
      if (active) {
        return { accepted: false, duplicate: true, inProgress: true, scope: identity.scope, key: identity.key, attempts: Number(existing.attempts || 1) };
      }
      const next = {
        ...existing,
        status: 'claimed',
        claimToken: idempotencyClaimToken(),
        requestHash,
        attempts: Number(existing.attempts || 0) + 1,
        processingStartedAt: now,
        updatedAt: now,
        lastError: '',
        response: null
      };
      this.idempotencyClaims.set(mapKey, next);
      return { accepted: true, duplicate: false, reclaimed: existing.status === 'claimed', retried: existing.status === 'failed', scope: identity.scope, key: identity.key, claimToken: next.claimToken, attempts: next.attempts };
    }
    const claimToken = idempotencyClaimToken();
    this.idempotencyClaims.set(mapKey, {
      status: 'claimed',
      claimToken,
      requestHash,
      attempts: 1,
      response: null,
      lastError: '',
      createdAt: now,
      updatedAt: now,
      processingStartedAt: now
    });
    this.pruneIdempotencyClaims();
    return { accepted: true, duplicate: false, scope: identity.scope, key: identity.key, claimToken, attempts: 1 };
  }

  async completeIdempotencyKey(scope, key, response = {}, options = {}) {
    const identity = idempotencyScopeKey(scope, key);
    const mapKey = [this.organizationId, identity.scope, identity.key].join('|');
    const existing = this.idempotencyClaims.get(mapKey);
    const providerAuthoritative = options.providerAuthoritative === true;
    if (!existing) {
      if (providerAuthoritative) return false;
      throw new Error('The durable idempotency claim was not found while completing the money action.');
    }
    const claimToken = String(options.claimToken || '').trim();
    const status = String(existing.status || '');
    if (providerAuthoritative && status === 'completed') return true;
    if (status !== 'claimed' && !(providerAuthoritative && status === 'failed')) return false;
    if (claimToken && claimToken !== String(existing.claimToken || '')) return false;
    const now = new Date().toISOString();
    this.idempotencyClaims.set(mapKey, { ...existing, status: 'completed', response: clone(response || {}), completedAt: now, updatedAt: now, lastError: '' });
    this.pruneIdempotencyClaims();
    return true;
  }

  async failIdempotencyKey(scope, key, error, options = {}) {
    const identity = idempotencyScopeKey(scope, key);
    const mapKey = [this.organizationId, identity.scope, identity.key].join('|');
    const existing = this.idempotencyClaims.get(mapKey);
    if (!existing) return false;
    const claimToken = String(options.claimToken || '').trim();
    if (String(existing.status || '') !== 'claimed') return false;
    if (claimToken && claimToken !== String(existing.claimToken || '')) return false;
    this.idempotencyClaims.set(mapKey, {
      ...existing,
      status: 'failed',
      lastError: String(error && error.message || error || '').slice(0, 3000),
      updatedAt: new Date().toISOString()
    });
    this.pruneIdempotencyClaims();
    return true;
  }

  async readJobErrors() {
    if (!this.jobErrorFile) return [];
    try {
      const stored = JSON.parse(await fs.readFile(this.jobErrorFile, 'utf8'));
      const rows = Array.isArray(stored) ? stored : (Array.isArray(stored.errors) ? stored.errors : []);
      return rows.filter(row => row && typeof row === 'object').map(row => ({
        id: String(row.id || '').slice(0, 160),
        source: String(row.source || 'server').slice(0, 120),
        severity: String(row.severity || 'error').slice(0, 20),
        message: String(row.message || 'Unknown error').slice(0, 3000),
        context: clone(row.context || {}),
        fingerprint: jobErrorFingerprint(row.source, row.severity, row.message, row.context, row.fingerprint),
        createdAt: String(row.createdAt || row.created_at || ''),
        firstSeenAt: String(row.firstSeenAt || row.first_seen_at || row.createdAt || row.created_at || ''),
        lastSeenAt: String(row.lastSeenAt || row.last_seen_at || row.createdAt || row.created_at || ''),
        occurrenceCount: Math.max(1, Number(row.occurrenceCount || row.occurrence_count || 1)),
        resolvedAt: String(row.resolvedAt || row.resolved_at || ''),
        resolvedBy: String(row.resolvedBy || row.resolved_by || '').slice(0, 160),
        resolutionNote: String(row.resolutionNote || row.resolution_note || '').slice(0, 1000)
      }));
    } catch {
      return [];
    }
  }

  async writeJobErrors(rows = []) {
    if (!this.jobErrorFile) return;
    const directory = path.dirname(this.jobErrorFile);
    const temporary = this.jobErrorFile + '.' + process.pid + '.' + Date.now() + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporary, JSON.stringify({ version: 2, errors: rows.slice(0, this.jobErrorLimit) }, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, this.jobErrorFile);
  }

  async recordJobError(source, error, context = {}, severity = 'error', options = {}) {
    if (!this.jobErrorFile) return;
    const run = async () => {
      const rows = await this.readJobErrors();
      const now = new Date().toISOString();
      const safeSource = String(source || 'server').slice(0, 120);
      const safeSeverity = String(severity || 'error').slice(0, 20);
      const safeMessage = String(error && error.message || error || 'Unknown error').slice(0, 3000);
      const safeContext = clone(context || {});
      const fingerprint = jobErrorFingerprint(safeSource, safeSeverity, safeMessage, safeContext, options.fingerprint);
      const existingIndex = rows.findIndex(row => !row.resolvedAt && jobErrorFingerprint(row.source, row.severity, row.message, row.context, row.fingerprint) === fingerprint);
      if (existingIndex >= 0) {
        const existing = rows.splice(existingIndex, 1)[0];
        const updated = {
          ...existing,
          source: safeSource,
          severity: safeSeverity,
          message: safeMessage,
          context: safeContext,
          fingerprint,
          firstSeenAt: existing.firstSeenAt || existing.createdAt || now,
          lastSeenAt: now,
          occurrenceCount: Math.max(1, Number(existing.occurrenceCount || 1)) + 1
        };
        await this.writeJobErrors([updated, ...rows]);
        return { ...clone(updated), coalesced: true };
      }
      const entry = {
        id: 'json-error-' + Date.now() + '-' + crypto.randomBytes(5).toString('hex'),
        source: safeSource,
        severity: safeSeverity,
        message: safeMessage,
        context: safeContext,
        fingerprint,
        createdAt: now,
        firstSeenAt: now,
        lastSeenAt: now,
        occurrenceCount: 1
      };
      await this.writeJobErrors([entry, ...rows]);
      return clone(entry);
    };
    const pending = this.jobErrorWrite.then(run, run);
    this.jobErrorWrite = pending.catch(() => {});
    return pending;
  }

  async recentJobErrors(limit = 20) {
    await this.jobErrorWrite;
    return groupedOpenJobErrors(await this.readJobErrors(), limit);
  }

  async resolveJobError(id, options = {}) {
    const targetId = String(id || '').trim();
    if (!targetId) throw new Error('A job-error ID is required.');
    const run = async () => {
      const rows = await this.readJobErrors();
      const index = rows.findIndex(row => row.id === targetId && !row.resolvedAt);
      if (index < 0) return null;
      const targetFingerprint = jobErrorFingerprint(rows[index].source, rows[index].severity, rows[index].message, rows[index].context, rows[index].fingerprint);
      const resolvedAt = new Date().toISOString();
      const resolvedBy = String(options.resolvedBy || 'owner').trim().slice(0, 160);
      const resolutionNote = String(options.note || 'Reviewed by owner').trim().slice(0, 1000);
      const matching = rows.filter(row => !row.resolvedAt && jobErrorFingerprint(row.source, row.severity, row.message, row.context, row.fingerprint) === targetFingerprint);
      rows.forEach((row, rowIndex) => {
        if (row.resolvedAt || jobErrorFingerprint(row.source, row.severity, row.message, row.context, row.fingerprint) !== targetFingerprint) return;
        rows[rowIndex] = { ...row, resolvedAt, resolvedBy, resolutionNote };
      });
      await this.writeJobErrors(rows);
      return {
        ...clone(rows[index]),
        occurrenceCount: matching.reduce((total, row) => total + Math.max(1, Number(row.occurrenceCount || 1)), 0),
        relatedIds: matching.map(row => row.id)
      };
    };
    const pending = this.jobErrorWrite.then(run, run);
    this.jobErrorWrite = pending.catch(() => {});
    return pending;
  }

  async listSnapshots() {
    return [];
  }

  async restoreSnapshot() {
    const error = new Error('Snapshot recovery requires PostgreSQL transactional storage.');
    error.code = 'snapshot_recovery_requires_postgres';
    throw error;
  }

  async recordMigrationProof() {
    const error = new Error('JSON development storage cannot record a PostgreSQL import proof.');
    error.code = 'migration_proof_requires_postgres';
    throw error;
  }

  async recordRecoveryDrill() {
    const error = new Error('JSON development storage cannot record a PostgreSQL recovery drill.');
    error.code = 'recovery_drill_requires_postgres';
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

  async acquireJobLock(name) {
    return {
      acquired: true,
      backend: 'json',
      name: String(name || '').trim(),
      async release() {}
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

function transientPostgresConnectionError(error) {
  const code = String(error && error.code || '').toUpperCase();
  if (code === '57P03' || code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code.startsWith('08')) return true;
  return /connection terminated unexpectedly|connection refused|connection reset|server closed the connection|terminating connection|timeout expired/i.test(String(error && error.message || error || ''));
}

async function connectPostgresClient(pool) {
  const retryDelays = [0, 250, 500, 1000, 2000];
  let lastError;
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt]) await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
    try {
      return await pool.connect();
    } catch (error) {
      lastError = error;
      if (!transientPostgresConnectionError(error) || attempt === retryDelays.length - 1) throw error;
    }
  }
  throw lastError;
}

class PostgresStateRepository {
  constructor(options = {}) {
    if (!options.databaseUrl) throw new Error('WOA_DATA_BACKEND=postgres requires DATABASE_URL. Refusing to fall back to a JSON file.');
    this.kind = 'postgres';
    this.organizationId = normalizeOrganizationId(options.organizationId);
    this.seed = typeof options.seed === 'function' ? options.seed : async () => ({});
    this.repair = typeof options.repair === 'function' ? options.repair : value => value;
    this.snapshotLimit = Math.max(10, Math.min(1000, Number(options.snapshotLimit || 180)));
    this.webhookProcessingLeaseMs = Math.max(30 * 1000, Math.min(60 * 60 * 1000, Number(options.webhookProcessingLeaseMs || 10 * 60 * 1000)));
    this.idempotencyProcessingLeaseMs = Math.max(30 * 1000, Math.min(60 * 60 * 1000, Number(options.idempotencyProcessingLeaseMs || 10 * 60 * 1000)));
    this.rateLimitSecret = String(options.rateLimitSecret || this.organizationId);
    this.lastRateLimitPruneAt = 0;
    this.pool = pgPool(options);
    this.schemaReady = null;
  }

  isTransactional() {
    return true;
  }

  async connect() {
    return connectPostgresClient(this.pool);
  }

  async ensureSchema() {
    if (this.schemaReady) return this.schemaReady;
    this.schemaReady = (async () => {
      let client;
      try {
        client = await this.connect();
        await client.query('BEGIN');
        const [schemaLockKeyOne, schemaLockKeyTwo] = advisoryLockKeys('wheelsonauto-platform', 'postgres-schema-migrations');
        await client.query('SELECT pg_advisory_xact_lock($1::integer, $2::integer)', [schemaLockKeyOne, schemaLockKeyTwo]);
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
        await client.query(`CREATE TABLE IF NOT EXISTS woa_state_migration_proofs (
          organization_id TEXT PRIMARY KEY REFERENCES woa_state(organization_id) ON DELETE CASCADE,
          source_checksum TEXT NOT NULL,
          canonical_source_checksum TEXT NOT NULL,
          target_checksum TEXT NOT NULL,
          source_record_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
          target_record_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
          imported_version BIGINT NOT NULL,
          snapshot_id BIGINT NOT NULL,
          snapshot_checksum TEXT NOT NULL,
          actor TEXT NOT NULL DEFAULT '',
          verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS woa_recovery_drills (
          organization_id TEXT PRIMARY KEY REFERENCES woa_state(organization_id) ON DELETE CASCADE,
          run_id TEXT NOT NULL,
          result TEXT NOT NULL,
          test_database_fingerprint TEXT NOT NULL,
          configuration_fingerprint TEXT NOT NULL,
          checks JSONB NOT NULL DEFAULT '{}'::jsonb,
          script_version TEXT NOT NULL,
          actor TEXT NOT NULL DEFAULT '',
          verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS woa_webhook_events (
          provider TEXT NOT NULL,
          event_id TEXT NOT NULL,
          organization_id TEXT NOT NULL DEFAULT '${DEFAULT_ORGANIZATION_ID}',
          status TEXT NOT NULL DEFAULT 'received',
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          attempts INTEGER NOT NULL DEFAULT 0,
          received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          processing_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          processed_at TIMESTAMPTZ,
          last_error TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (organization_id, provider, event_id)
        )`);
        await client.query('ALTER TABLE woa_webhook_events ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ NOT NULL DEFAULT now()');
        await client.query(`DO $webhook_tenant_primary_key$
        DECLARE
          primary_key_name TEXT;
          primary_key_definition TEXT;
        BEGIN
          SELECT constraint_name, definition INTO primary_key_name, primary_key_definition
          FROM (
            SELECT constraint_row.conname AS constraint_name, pg_get_constraintdef(constraint_row.oid) AS definition
            FROM pg_constraint AS constraint_row
            JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
            JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
            WHERE table_row.relname = 'woa_webhook_events'
              AND namespace_row.nspname = current_schema()
              AND constraint_row.contype = 'p'
            LIMIT 1
          ) AS current_primary_key;
          IF primary_key_name IS NOT NULL AND position('(organization_id, provider, event_id)' in primary_key_definition) = 0 THEN
            EXECUTE format('ALTER TABLE woa_webhook_events DROP CONSTRAINT %I', primary_key_name);
            primary_key_name := NULL;
          END IF;
          IF primary_key_name IS NULL THEN
            ALTER TABLE woa_webhook_events
              ADD CONSTRAINT woa_webhook_events_pkey PRIMARY KEY (organization_id, provider, event_id);
          END IF;
        END
        $webhook_tenant_primary_key$`);
        await client.query('CREATE INDEX IF NOT EXISTS woa_webhook_events_org_status_idx ON woa_webhook_events (organization_id, status, received_at DESC)');
        await client.query('CREATE INDEX IF NOT EXISTS woa_webhook_events_recovery_idx ON woa_webhook_events (organization_id, provider, status, processing_started_at)');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_idempotency_keys (
          organization_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          key TEXT NOT NULL,
          request_hash TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'claimed',
          claim_token TEXT NOT NULL DEFAULT '',
          response JSONB,
          attempts INTEGER NOT NULL DEFAULT 0,
          processing_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_error TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          completed_at TIMESTAMPTZ,
          PRIMARY KEY (organization_id, scope, key)
        )`);
        await client.query('ALTER TABLE woa_idempotency_keys ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0');
        await client.query('ALTER TABLE woa_idempotency_keys ADD COLUMN IF NOT EXISTS claim_token TEXT NOT NULL DEFAULT \'\'');
        await client.query('ALTER TABLE woa_idempotency_keys ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ NOT NULL DEFAULT now()');
        await client.query('ALTER TABLE woa_idempotency_keys ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT \'\'');
        await client.query('ALTER TABLE woa_idempotency_keys ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');
        await client.query('CREATE INDEX IF NOT EXISTS woa_idempotency_keys_claim_idx ON woa_idempotency_keys (organization_id, status, processing_started_at DESC)');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_rate_limits (
          organization_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          key_hash TEXT NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
          window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (organization_id, scope, key_hash)
        )`);
        await client.query('CREATE INDEX IF NOT EXISTS woa_rate_limits_expiry_idx ON woa_rate_limits (organization_id, expires_at)');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_identity_index (
          organization_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          normalized_value TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (organization_id, kind, normalized_value)
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS woa_resource_index (
          organization_id TEXT NOT NULL REFERENCES woa_state(organization_id) ON DELETE CASCADE,
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          customer_key TEXT NOT NULL DEFAULT '',
          vehicle_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (organization_id, resource_type, resource_id)
        )`);
        await client.query('CREATE INDEX IF NOT EXISTS woa_resource_index_org_customer_idx ON woa_resource_index (organization_id, customer_key, resource_type)');
        await client.query('CREATE INDEX IF NOT EXISTS woa_resource_index_org_vehicle_idx ON woa_resource_index (organization_id, vehicle_id, resource_type) WHERE vehicle_id <> \'\'');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_active_assignments (
          organization_id TEXT NOT NULL REFERENCES woa_state(organization_id) ON DELETE CASCADE,
          vehicle_id TEXT NOT NULL,
          customer_key TEXT NOT NULL,
          customer_name TEXT NOT NULL,
          source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (organization_id, vehicle_id)
        )`);
        await client.query('CREATE INDEX IF NOT EXISTS woa_active_assignments_org_customer_idx ON woa_active_assignments (organization_id, customer_key)');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_documents (
          id TEXT NOT NULL,
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
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (organization_id, id)
        )`);
        await client.query(`DO $document_tenant_primary_key$
        DECLARE
          primary_key_name TEXT;
          primary_key_definition TEXT;
        BEGIN
          SELECT constraint_name, definition INTO primary_key_name, primary_key_definition
          FROM (
            SELECT constraint_row.conname AS constraint_name, pg_get_constraintdef(constraint_row.oid) AS definition
            FROM pg_constraint AS constraint_row
            JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
            JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
            WHERE table_row.relname = 'woa_documents'
              AND namespace_row.nspname = current_schema()
              AND constraint_row.contype = 'p'
            LIMIT 1
          ) AS current_primary_key;
          IF primary_key_name IS NOT NULL AND position('(organization_id, id)' in primary_key_definition) = 0 THEN
            EXECUTE format('ALTER TABLE woa_documents DROP CONSTRAINT %I', primary_key_name);
            primary_key_name := NULL;
          END IF;
          IF primary_key_name IS NULL THEN
            ALTER TABLE woa_documents
              ADD CONSTRAINT woa_documents_pkey PRIMARY KEY (organization_id, id);
          END IF;
        END
        $document_tenant_primary_key$`);
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
        await client.query('ALTER TABLE woa_job_errors ADD COLUMN IF NOT EXISTS resolved_by TEXT NOT NULL DEFAULT \'\'');
        await client.query('ALTER TABLE woa_job_errors ADD COLUMN IF NOT EXISTS resolution_note TEXT NOT NULL DEFAULT \'\'');
        await client.query('ALTER TABLE woa_job_errors ADD COLUMN IF NOT EXISTS fingerprint TEXT NOT NULL DEFAULT \'\'');
        await client.query('ALTER TABLE woa_job_errors ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ');
        await client.query('ALTER TABLE woa_job_errors ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ');
        await client.query('ALTER TABLE woa_job_errors ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1');
        await client.query('UPDATE woa_job_errors SET first_seen_at = created_at WHERE first_seen_at IS NULL');
        await client.query('UPDATE woa_job_errors SET last_seen_at = created_at WHERE last_seen_at IS NULL');
        await client.query('ALTER TABLE woa_job_errors ALTER COLUMN first_seen_at SET DEFAULT now()');
        await client.query('ALTER TABLE woa_job_errors ALTER COLUMN first_seen_at SET NOT NULL');
        await client.query('ALTER TABLE woa_job_errors ALTER COLUMN last_seen_at SET DEFAULT now()');
        await client.query('ALTER TABLE woa_job_errors ALTER COLUMN last_seen_at SET NOT NULL');
        await client.query('CREATE INDEX IF NOT EXISTS woa_job_errors_open_idx ON woa_job_errors (organization_id, resolved_at, created_at DESC)');
        await client.query('CREATE UNIQUE INDEX IF NOT EXISTS woa_job_errors_open_fingerprint_unique ON woa_job_errors (organization_id, fingerprint) WHERE resolved_at IS NULL AND fingerprint <> \'\'');
        await client.query(`CREATE TABLE IF NOT EXISTS woa_ai_usage (
          organization_id TEXT NOT NULL,
          period_type TEXT NOT NULL CHECK (period_type IN ('day', 'month')),
          period_key TEXT NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (organization_id, period_type, period_key)
        )`);
        await client.query('INSERT INTO woa_schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [MIGRATION_ID]);
        await client.query('INSERT INTO woa_schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [TRANSACTIONAL_INDEX_MIGRATION_ID]);
        await client.query('INSERT INTO woa_schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [DURABLE_RATE_LIMIT_MIGRATION_ID]);
        await client.query('INSERT INTO woa_schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [DOCUMENT_TENANT_PRIMARY_KEY_MIGRATION_ID]);
        const savedState = await client.query('SELECT state, checksum FROM woa_state WHERE organization_id = $1 FOR UPDATE', [this.organizationId]);
        if (savedState.rowCount) {
          assertChecksum(savedState.rows[0].state, savedState.rows[0].checksum, 'PostgreSQL state');
          const state = this.repair(clone(savedState.rows[0].state));
          await this.syncCriticalResourceIndex(client, state);
          await this.syncActiveAssignmentIndex(client, state);
        }
        await client.query('COMMIT');
      } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        this.schemaReady = null;
        throw error;
      } finally {
        if (client) client.release();
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
    assertChecksum(row.state, row.checksum, 'PostgreSQL state');
    return { state: this.repair(clone(row.state)), version: Number(row.version || 0), checksum: row.checksum || checksum(row.state), exists: true };
  }

  async version() {
    const snapshot = await this.read();
    return 'pg-' + snapshot.version + '-' + String(snapshot.checksum || '').slice(0, 12);
  }

  async refreshIdentityIndex(client, state) {
    const conflicts = identityConflicts(state);
    if (conflicts.length) {
      const error = new Error('Database migration blocked by ' + conflicts.length + ' duplicate immutable identity value(s). Resolve the conflicting VIN, plate, portal username, provider subscription ID, verification case ID, or payment ID before enabling PostgreSQL.');
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
    const retainedIds = [];
    const seenIds = new Set();
    for (const document of rows) {
      const documentId = String(document.id || '').trim();
      if (seenIds.has(documentId)) {
        const error = new Error('Private document metadata contains duplicate document id ' + documentId + '. Refusing an ambiguous database write.');
        error.code = 'woa_document_identity_conflict';
        throw error;
      }
      seenIds.add(documentId);
      retainedIds.push(documentId);
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
      const saved = await client.query(`INSERT INTO woa_documents (
        id, organization_id, customer, application_id, onboarding_session_id, storage_provider, object_key,
        content_type, size_bytes, sha256, encryption, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, COALESCE($13::timestamptz, now()), now())
      ON CONFLICT (organization_id, id) DO UPDATE SET
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
        updated_at = now()
      RETURNING id`, [
        documentId, this.organizationId, String(document.customer || ''), String(document.applicationId || ''), String(document.onboardingSessionId || ''),
        String(document.storageProvider || document.storage || (document.storageKey ? 'encrypted' : 'legacy-local')), String(document.storageKey || document.storagePath || ''),
        String(document.contentType || ''), Number(document.size || 0), String(document.sha256 || ''), JSON.stringify(document.encryption || {}), JSON.stringify(metadata), document.createdAt || null
      ]);
      if (!saved.rowCount) throw new Error('Private document metadata was not persisted for ' + documentId + '.');
    }
    if (retainedIds.length) {
      await client.query(`DELETE FROM woa_documents
        WHERE organization_id = $1 AND NOT (id = ANY($2::text[]))`, [this.organizationId, retainedIds]);
    } else {
      await client.query('DELETE FROM woa_documents WHERE organization_id = $1', [this.organizationId]);
    }
  }

  async syncCriticalResourceIndex(client, state) {
    const rows = criticalResourceIndexRows(state);
    await client.query('DELETE FROM woa_resource_index WHERE organization_id = $1', [this.organizationId]);
    if (!rows.length) return;
    await client.query(`INSERT INTO woa_resource_index (
      organization_id, resource_type, resource_id, customer_key, vehicle_id, status, updated_at
    ) SELECT $1, item->>'resourceType', item->>'resourceId', item->>'customerKey', item->>'vehicleId', item->>'status', now()
      FROM jsonb_array_elements($2::jsonb) AS item`, [this.organizationId, JSON.stringify(rows)]);
  }

  async syncActiveAssignmentIndex(client, state) {
    const rows = activeAssignmentIndexRows(state);
    await client.query('DELETE FROM woa_active_assignments WHERE organization_id = $1', [this.organizationId]);
    if (!rows.length) return;
    await client.query(`INSERT INTO woa_active_assignments (
      organization_id, vehicle_id, customer_key, customer_name, source_refs, updated_at
    ) SELECT $1, item->>'vehicleId', item->>'customerKey', item->>'customerName', COALESCE(item->'sourceRefs', '[]'::jsonb), now()
      FROM jsonb_array_elements($2::jsonb) AS item`, [this.organizationId, JSON.stringify(rows)]);
  }

  async applyStateTransactionEffects(client, options = {}) {
    const effects = normalizedStateTransactionEffects(options);
    const appliedEffects = { webhookCompletions: [], idempotencySettlements: [] };
    for (const completion of effects.webhookCompletions) {
      const completed = await client.query(`UPDATE woa_webhook_events
        SET status = 'processed', processed_at = now(), last_error = ''
        WHERE organization_id = $1 AND provider = $2 AND event_id = $3 AND status = 'processing'
        RETURNING attempts`, [this.organizationId, completion.provider, completion.eventId]);
      if (!completed.rowCount) {
        throw new Error('The durable webhook claim was missing or no longer processing while committing state for ' + completion.provider + '.');
      }
      appliedEffects.webhookCompletions.push({ ...completion, applied: true });
    }
    for (const settlement of effects.idempotencySettlements) {
      const identity = idempotencyScopeKey(settlement.scope, settlement.key);
      if (settlement.action === 'complete') {
        const tokenCondition = settlement.claimToken ? ' AND claim_token = $5' : '';
        const statusCondition = settlement.providerAuthoritative ? "status IN ('claimed', 'failed', 'completed')" : "status = 'claimed'";
        const responseExpression = settlement.providerAuthoritative ? "CASE WHEN status = 'completed' THEN response ELSE $4::jsonb END" : '$4::jsonb';
        const completedAtExpression = settlement.providerAuthoritative ? 'COALESCE(completed_at, now())' : 'now()';
        const params = [this.organizationId, identity.scope, identity.key, JSON.stringify(settlement.response || {})];
        if (settlement.claimToken) params.push(settlement.claimToken);
        const completed = await client.query(`UPDATE woa_idempotency_keys
          SET status = 'completed', response = ${responseExpression}, completed_at = ${completedAtExpression}, updated_at = now(), last_error = ''
          WHERE organization_id = $1 AND scope = $2 AND key = $3 AND ${statusCondition}${tokenCondition}
          RETURNING attempts`, params);
        if (!completed.rowCount && !settlement.providerAuthoritative) {
          throw new Error('The durable idempotency claim was missing while committing provider-confirmed state.');
        }
        appliedEffects.idempotencySettlements.push({ ...settlement, applied: completed.rowCount > 0 });
      } else {
        const tokenCondition = settlement.claimToken ? ' AND claim_token = $5' : '';
        const params = [this.organizationId, identity.scope, identity.key, settlement.error || 'Provider webhook confirmed the money action failed.'];
        if (settlement.claimToken) params.push(settlement.claimToken);
        const failed = await client.query(`UPDATE woa_idempotency_keys
          SET status = 'failed', last_error = $4, updated_at = now()
          WHERE organization_id = $1 AND scope = $2 AND key = $3 AND status = 'claimed'${tokenCondition}
          RETURNING attempts`, params);
        appliedEffects.idempotencySettlements.push({ ...settlement, applied: failed.rowCount > 0 });
      }
    }
    return appliedEffects;
  }

  async write(incomingState, options = {}) {
    await this.ensureSchema();
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT state, version, checksum FROM woa_state WHERE organization_id = $1 FOR UPDATE', [this.organizationId]);
      if (existing.rowCount) assertChecksum(existing.rows[0].state, existing.rows[0].checksum, 'Current PostgreSQL state');
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
      await this.syncCriticalResourceIndex(client, next);
      await this.syncActiveAssignmentIndex(client, next);
      await client.query(`INSERT INTO woa_state_snapshots (organization_id, version, checksum, reason, actor, state)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        ON CONFLICT (organization_id, version) DO NOTHING`, [
        this.organizationId, nextVersion, nextChecksum, String(options.reason || 'state mutation').slice(0, 160), String(options.actor || '').slice(0, 160), JSON.stringify(next)
      ]);
      await client.query(`DELETE FROM woa_state_snapshots
        WHERE organization_id = $1 AND id IN (
          SELECT id FROM woa_state_snapshots WHERE organization_id = $1 ORDER BY version DESC OFFSET $2
        )`, [this.organizationId, this.snapshotLimit]);
      const transactionEffects = await this.applyStateTransactionEffects(client, options);
      await client.query('COMMIT');
      return { state: next, version: nextVersion, checksum: nextChecksum, transactionEffects };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async pruneExpiredRateLimits() {
    const now = Date.now();
    if (now - this.lastRateLimitPruneAt < 60 * 60 * 1000) return;
    this.lastRateLimitPruneAt = now;
    await this.pool.query(`DELETE FROM woa_rate_limits
      WHERE organization_id = $1 AND expires_at < now() - interval '1 day'`, [this.organizationId]);
  }

  async checkRateLimit(scope, key, limit, windowMs) {
    const identity = rateLimitIdentity(scope, key, this.rateLimitSecret, this.organizationId);
    const policy = rateLimitPolicy(limit, windowMs);
    await this.ensureSchema();
    const result = await this.pool.query(`SELECT request_count, expires_at
      FROM woa_rate_limits
      WHERE organization_id = $1 AND scope = $2 AND key_hash = $3 AND expires_at > now()`, [
      this.organizationId, identity.scope, identity.keyHash
    ]);
    if (!result.rowCount) return rateLimitResult(0, policy.limit, '', false);
    return rateLimitResult(result.rows[0].request_count, policy.limit, result.rows[0].expires_at, false);
  }

  async consumeRateLimit(scope, key, limit, windowMs) {
    const identity = rateLimitIdentity(scope, key, this.rateLimitSecret, this.organizationId);
    const policy = rateLimitPolicy(limit, windowMs);
    await this.ensureSchema();
    await this.pruneExpiredRateLimits();
    const result = await this.pool.query(`INSERT INTO woa_rate_limits (
        organization_id, scope, key_hash, request_count, window_started_at, expires_at, updated_at
      ) VALUES ($1, $2, $3, 1, now(), now() + ($4::bigint * interval '1 millisecond'), now())
      ON CONFLICT (organization_id, scope, key_hash) DO UPDATE SET
        request_count = CASE
          WHEN woa_rate_limits.expires_at <= now() THEN 1
          ELSE LEAST(2147483647, woa_rate_limits.request_count + 1)
        END,
        window_started_at = CASE WHEN woa_rate_limits.expires_at <= now() THEN now() ELSE woa_rate_limits.window_started_at END,
        expires_at = CASE
          WHEN woa_rate_limits.expires_at <= now() THEN now() + ($4::bigint * interval '1 millisecond')
          ELSE woa_rate_limits.expires_at
        END,
        updated_at = now()
      RETURNING request_count, expires_at`, [
      this.organizationId, identity.scope, identity.keyHash, policy.windowMs
    ]);
    return rateLimitResult(result.rows[0].request_count, policy.limit, result.rows[0].expires_at, true);
  }

  async clearRateLimit(scope, key) {
    const identity = rateLimitIdentity(scope, key, this.rateLimitSecret, this.organizationId);
    await this.ensureSchema();
    const result = await this.pool.query(`DELETE FROM woa_rate_limits
      WHERE organization_id = $1 AND scope = $2 AND key_hash = $3`, [this.organizationId, identity.scope, identity.keyHash]);
    return result.rowCount > 0;
  }

  async claimWebhookEvent(provider, eventId, payload = {}) {
    if (!eventId) return { accepted: true, duplicate: false, eventId: '' };
    await this.ensureSchema();
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(`SELECT status, attempts, processing_started_at
        FROM woa_webhook_events
        WHERE organization_id = $1 AND provider = $2 AND event_id = $3
        FOR UPDATE`, [this.organizationId, provider, eventId]);
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.status === 'processed') {
          await client.query('COMMIT');
          return { accepted: false, duplicate: true, eventId, attempts: Number(row.attempts || 1) };
        }
        const processingStartedAt = new Date(row.processing_started_at || 0).getTime();
        const activelyProcessing = row.status === 'processing'
          && Number.isFinite(processingStartedAt)
          && Date.now() - processingStartedAt < this.webhookProcessingLeaseMs;
        if (activelyProcessing) {
          await client.query('COMMIT');
          return { accepted: false, duplicate: true, inProgress: true, eventId, attempts: Number(row.attempts || 1) };
        }
        await client.query(`UPDATE woa_webhook_events
          SET status = 'processing', attempts = attempts + 1, payload = $4::jsonb, last_error = '', processing_started_at = now()
          WHERE organization_id = $1 AND provider = $2 AND event_id = $3`, [this.organizationId, provider, eventId, JSON.stringify(payload || {})]);
        await client.query('COMMIT');
        return { accepted: true, duplicate: false, reclaimed: row.status === 'processing', eventId, attempts: Number(row.attempts || 0) + 1 };
      } else {
        await client.query(`INSERT INTO woa_webhook_events (provider, event_id, organization_id, status, payload, attempts, processing_started_at)
          VALUES ($1, $2, $3, 'processing', $4::jsonb, 1, now())`, [provider, eventId, this.organizationId, JSON.stringify(payload || {})]);
      }
      await client.query('COMMIT');
      return { accepted: true, duplicate: false, eventId, attempts: 1 };
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
      SET status = 'processed', processed_at = now(), last_error = ''
      WHERE organization_id = $1 AND provider = $2 AND event_id = $3`, [this.organizationId, provider, eventId]);
  }

  async failWebhookEvent(provider, eventId, error) {
    if (!eventId) return;
    await this.ensureSchema();
    await this.pool.query(`UPDATE woa_webhook_events
      SET status = 'failed', last_error = $4
      WHERE organization_id = $1 AND provider = $2 AND event_id = $3`, [this.organizationId, provider, eventId, String(error && error.message || error || '').slice(0, 3000)]);
  }

  async listRecoverableWebhookEvents(provider, options = {}) {
    const normalizedProvider = String(provider || '').trim();
    if (!normalizedProvider) return [];
    const now = Number(options.now || Date.now());
    const retryAfterMs = Math.max(0, Number(options.retryAfterMs == null ? 60 * 1000 : options.retryAfterMs));
    const staleAfterMs = Math.max(30 * 1000, Number(options.staleAfterMs || this.webhookProcessingLeaseMs));
    const maxAttempts = Math.max(1, Math.min(100, Number(options.maxAttempts || 8)));
    const limit = Math.max(1, Math.min(100, Number(options.limit || 25)));
    await this.ensureSchema();
    const result = await this.pool.query(`SELECT event_id, payload, status, attempts, received_at, processing_started_at, processed_at, last_error
      FROM woa_webhook_events
      WHERE organization_id = $1
        AND provider = $2
        AND attempts < $3
        AND (
          (status = 'failed' AND processing_started_at <= $4::timestamptz)
          OR (status = 'processing' AND processing_started_at <= $5::timestamptz)
        )
      ORDER BY processing_started_at ASC
      LIMIT $6`, [
      this.organizationId,
      normalizedProvider,
      maxAttempts,
      new Date(now - retryAfterMs).toISOString(),
      new Date(now - staleAfterMs).toISOString(),
      limit
    ]);
    return result.rows.map(row => ({
      organizationId: this.organizationId,
      provider: normalizedProvider,
      eventId: row.event_id,
      payload: clone(row.payload || {}),
      status: row.status,
      attempts: Number(row.attempts || 0),
      receivedAt: row.received_at ? new Date(row.received_at).toISOString() : '',
      processingStartedAt: row.processing_started_at ? new Date(row.processing_started_at).toISOString() : '',
      processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : '',
      lastError: String(row.last_error || '')
    }));
  }

  async claimIdempotencyKey(scope, key, request = {}, options = {}) {
    const identity = idempotencyScopeKey(scope, key);
    const requestHash = String(options.requestHash || idempotencyRequestHash(request));
    await this.ensureSchema();
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(`SELECT request_hash, status, claim_token, response, attempts, processing_started_at
        FROM woa_idempotency_keys
        WHERE organization_id = $1 AND scope = $2 AND key = $3
        FOR UPDATE`, [this.organizationId, identity.scope, identity.key]);
      if (existing.rowCount) {
        const row = existing.rows[0];
        const status = String(row.status || 'claimed');
        const existingHash = String(row.request_hash || '');
        if (existingHash && requestHash && existingHash !== requestHash && status !== 'failed') throw idempotencyRequestMismatchError(identity.scope, identity.key);
        if (status === 'completed') {
          await client.query('COMMIT');
          return { accepted: false, duplicate: true, completed: true, scope: identity.scope, key: identity.key, attempts: Number(row.attempts || 1), response: clone(row.response || {}) };
        }
        const startedAt = new Date(row.processing_started_at || 0).getTime();
        const active = status === 'claimed' && Number.isFinite(startedAt) && Date.now() - startedAt < this.idempotencyProcessingLeaseMs;
        if (active) {
          await client.query('COMMIT');
          return { accepted: false, duplicate: true, inProgress: true, scope: identity.scope, key: identity.key, attempts: Number(row.attempts || 1) };
        }
        const claimToken = idempotencyClaimToken();
        await client.query(`UPDATE woa_idempotency_keys
          SET request_hash = $4, claim_token = $5, status = 'claimed', response = NULL, attempts = attempts + 1,
            processing_started_at = now(), last_error = '', updated_at = now(), completed_at = NULL
          WHERE organization_id = $1 AND scope = $2 AND key = $3`, [this.organizationId, identity.scope, identity.key, requestHash, claimToken]);
        await client.query('COMMIT');
        return { accepted: true, duplicate: false, reclaimed: status === 'claimed', retried: status === 'failed', scope: identity.scope, key: identity.key, claimToken, attempts: Number(row.attempts || 0) + 1 };
      }
      const claimToken = idempotencyClaimToken();
      await client.query(`INSERT INTO woa_idempotency_keys (
        organization_id, scope, key, request_hash, claim_token, status, attempts, processing_started_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, 'claimed', 1, now(), now())`, [this.organizationId, identity.scope, identity.key, requestHash, claimToken]);
      await client.query('COMMIT');
      return { accepted: true, duplicate: false, scope: identity.scope, key: identity.key, claimToken, attempts: 1 };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async completeIdempotencyKey(scope, key, response = {}, options = {}) {
    const identity = idempotencyScopeKey(scope, key);
    const claimToken = String(options.claimToken || '').trim();
    const providerAuthoritative = options.providerAuthoritative === true;
    await this.ensureSchema();
    const tokenCondition = claimToken ? ' AND claim_token = $5' : '';
    const statusCondition = providerAuthoritative ? "status IN ('claimed', 'failed', 'completed')" : "status = 'claimed'";
    const responseExpression = providerAuthoritative ? "CASE WHEN status = 'completed' THEN response ELSE $4::jsonb END" : '$4::jsonb';
    const completedAtExpression = providerAuthoritative ? 'COALESCE(completed_at, now())' : 'now()';
    const params = [this.organizationId, identity.scope, identity.key, JSON.stringify(response || {})];
    if (claimToken) params.push(claimToken);
    const result = await this.pool.query(`UPDATE woa_idempotency_keys
      SET status = 'completed', response = ${responseExpression}, completed_at = ${completedAtExpression}, updated_at = now(), last_error = ''
      WHERE organization_id = $1 AND scope = $2 AND key = $3 AND ${statusCondition}${tokenCondition}
      RETURNING attempts`, params);
    if (!result.rowCount) {
      if (claimToken || providerAuthoritative) return false;
      throw new Error('The durable idempotency claim was not found while completing the money action.');
    }
    return true;
  }

  async failIdempotencyKey(scope, key, error, options = {}) {
    const identity = idempotencyScopeKey(scope, key);
    const claimToken = String(options.claimToken || '').trim();
    await this.ensureSchema();
    const tokenCondition = claimToken ? ' AND claim_token = $5' : '';
    const params = [this.organizationId, identity.scope, identity.key, String(error && error.message || error || '').slice(0, 3000)];
    if (claimToken) params.push(claimToken);
    const result = await this.pool.query(`UPDATE woa_idempotency_keys
      SET status = 'failed', last_error = $4, updated_at = now()
      WHERE organization_id = $1 AND scope = $2 AND key = $3 AND status = 'claimed'${tokenCondition}
      RETURNING attempts`, params);
    return result.rowCount > 0;
  }

  async recordJobError(source, error, context = {}, severity = 'error', options = {}) {
    await this.ensureSchema();
    const safeSource = String(source || 'server').slice(0, 120);
    const safeSeverity = String(severity || 'error').slice(0, 20);
    const safeMessage = String(error && error.message || error || 'Unknown error').slice(0, 3000);
    const safeContext = context && typeof context === 'object' && !Array.isArray(context) ? context : {};
    const fingerprint = jobErrorFingerprint(safeSource, safeSeverity, safeMessage, safeContext, options.fingerprint);
    const result = await this.pool.query(`INSERT INTO woa_job_errors
      (organization_id, source, severity, message, context, fingerprint, first_seen_at, last_seen_at, occurrence_count)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, now(), now(), 1)
      ON CONFLICT (organization_id, fingerprint) WHERE resolved_at IS NULL AND fingerprint <> ''
      DO UPDATE SET
        source = EXCLUDED.source,
        severity = EXCLUDED.severity,
        message = EXCLUDED.message,
        context = EXCLUDED.context,
        last_seen_at = now(),
        occurrence_count = woa_job_errors.occurrence_count + 1
      RETURNING id, source, severity, message, context, fingerprint, created_at, first_seen_at, last_seen_at, occurrence_count`, [this.organizationId, safeSource, safeSeverity, safeMessage, JSON.stringify(safeContext), fingerprint]);
    const row = result.rows[0];
    return {
      id: Number(row.id),
      source: row.source,
      severity: row.severity,
      message: row.message,
      context: row.context || {},
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      occurrenceCount: Math.max(1, Number(row.occurrence_count || 1))
    };
  }

  async recentJobErrors(limit = 20) {
    await this.ensureSchema();
    const result = await this.pool.query(`SELECT id, source, severity, message, context, fingerprint, created_at, first_seen_at, last_seen_at, occurrence_count
      FROM woa_job_errors
      WHERE organization_id = $1 AND resolved_at IS NULL
      ORDER BY last_seen_at DESC
      LIMIT 250`, [this.organizationId]);
    return groupedOpenJobErrors(result.rows.map(row => ({
      id: Number(row.id),
      source: row.source,
      severity: row.severity,
      message: row.message,
      context: row.context || {},
      fingerprint: row.fingerprint,
      createdAt: row.created_at,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      occurrenceCount: Math.max(1, Number(row.occurrence_count || 1))
    })), limit);
  }

  async resolveJobError(id, options = {}) {
    const targetId = Number(id);
    if (!Number.isSafeInteger(targetId) || targetId <= 0) throw new Error('A valid PostgreSQL job-error ID is required.');
    await this.ensureSchema();
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const targetResult = await client.query(`SELECT id, source, severity, message, context, fingerprint, created_at, first_seen_at, last_seen_at, occurrence_count
        FROM woa_job_errors
        WHERE organization_id = $1 AND id = $2 AND resolved_at IS NULL
        FOR UPDATE`, [this.organizationId, targetId]);
      if (!targetResult.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      const target = targetResult.rows[0];
      const targetFingerprint = jobErrorFingerprint(target.source, target.severity, target.message, target.context, target.fingerprint);
      let matchingIds = [targetId];
      if (target.fingerprint) {
        const matching = await client.query(`SELECT id FROM woa_job_errors
          WHERE organization_id = $1 AND fingerprint = $2 AND resolved_at IS NULL
          FOR UPDATE`, [this.organizationId, target.fingerprint]);
        matchingIds = matching.rows.map(row => Number(row.id));
      } else {
        const legacy = await client.query(`SELECT id, source, severity, message, context, fingerprint FROM woa_job_errors
          WHERE organization_id = $1 AND resolved_at IS NULL
          FOR UPDATE`, [this.organizationId]);
        matchingIds = legacy.rows
          .filter(row => jobErrorFingerprint(row.source, row.severity, row.message, row.context, row.fingerprint) === targetFingerprint)
          .map(row => Number(row.id));
      }
      const resolvedBy = String(options.resolvedBy || 'owner').trim().slice(0, 160);
      const resolutionNote = String(options.note || 'Reviewed by owner').trim().slice(0, 1000);
      const result = await client.query(`UPDATE woa_job_errors
        SET resolved_at = now(), resolved_by = $3, resolution_note = $4
        WHERE organization_id = $1 AND id = ANY($2::bigint[]) AND resolved_at IS NULL
        RETURNING id, source, severity, message, context, fingerprint, created_at, first_seen_at, last_seen_at, occurrence_count, resolved_at, resolved_by, resolution_note`, [this.organizationId, matchingIds, resolvedBy, resolutionNote]);
      await client.query('COMMIT');
      const row = result.rows.find(candidate => Number(candidate.id) === targetId) || result.rows[0];
      if (!row) return null;
      return {
        id: Number(row.id),
        source: row.source,
        severity: row.severity,
        message: row.message,
        context: row.context || {},
        fingerprint: row.fingerprint || targetFingerprint,
        createdAt: row.created_at,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        occurrenceCount: result.rows.reduce((total, candidate) => total + Math.max(1, Number(candidate.occurrence_count || 1)), 0),
        relatedIds: result.rows.map(candidate => Number(candidate.id)),
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
        resolutionNote: row.resolution_note
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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
    const client = await this.connect();
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

  async acquireJobLock(name) {
    const lockName = String(name || '').trim();
    if (!lockName) throw new Error('A durable job-lock name is required.');
    await this.ensureSchema();
    const client = await this.connect();
    const [keyOne, keyTwo] = advisoryLockKeys(this.organizationId, lockName);
    try {
      const result = await client.query('SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired', [keyOne, keyTwo]);
      const acquired = result.rows[0] && result.rows[0].acquired === true;
      if (!acquired) {
        client.release();
        return { acquired: false, backend: 'postgres', name: lockName, async release() {} };
      }
      let released = false;
      return {
        acquired: true,
        backend: 'postgres',
        name: lockName,
        async release() {
          if (released) return;
          released = true;
          try {
            await client.query('SELECT pg_advisory_unlock($1::integer, $2::integer)', [keyOne, keyTwo]);
          } finally {
            client.release();
          }
        }
      };
    } catch (error) {
      client.release();
      throw error;
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

  async recordMigrationProof(proof = {}) {
    await this.ensureSchema();
    const sourceChecksum = String(proof.sourceChecksum || '').trim();
    const canonicalSourceChecksum = String(proof.canonicalSourceChecksum || '').trim();
    const targetChecksum = String(proof.targetChecksum || '').trim();
    const importedVersion = Number(proof.importedVersion || 0);
    const sourceRecordCounts = proof.sourceRecordCounts || {};
    const targetRecordCounts = proof.targetRecordCounts || {};
    if (!sourceChecksum || !canonicalSourceChecksum || !targetChecksum || !Number.isInteger(importedVersion) || importedVersion < 1) {
      const error = new Error('PostgreSQL migration proof needs the source checksum, canonical checksum, target checksum, and imported version.');
      error.code = 'migration_proof_invalid';
      throw error;
    }
    if (canonicalSourceChecksum !== targetChecksum || stableJson(sourceRecordCounts) !== stableJson(targetRecordCounts)) {
      const error = new Error('PostgreSQL migration proof failed: canonical source checksum or record counts do not match the imported state.');
      error.code = 'migration_proof_mismatch';
      throw error;
    }
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT version, checksum FROM woa_state WHERE organization_id = $1 FOR UPDATE', [this.organizationId]);
      if (!current.rowCount || Number(current.rows[0].version || 0) !== importedVersion || String(current.rows[0].checksum || '') !== targetChecksum) {
        const error = new Error('PostgreSQL changed before the import proof was recorded. Re-run the read-only verification against the intended source; do not overwrite live state.');
        error.code = 'migration_proof_state_changed';
        throw error;
      }
      const snapshot = await client.query(`SELECT id, version, checksum, state
        FROM woa_state_snapshots
        WHERE organization_id = $1 AND version = $2
        FOR UPDATE`, [this.organizationId, importedVersion]);
      if (!snapshot.rowCount) {
        const error = new Error('The matching PostgreSQL import snapshot is missing. Refusing to record a migration proof.');
        error.code = 'migration_proof_snapshot_missing';
        throw error;
      }
      const snapshotRow = snapshot.rows[0];
      assertChecksum(snapshotRow.state, snapshotRow.checksum, 'PostgreSQL import snapshot');
      if (String(snapshotRow.checksum || '') !== targetChecksum) {
        const error = new Error('The PostgreSQL import snapshot does not match the verified target checksum.');
        error.code = 'migration_proof_snapshot_mismatch';
        throw error;
      }
      await client.query(`INSERT INTO woa_state_migration_proofs (
        organization_id, source_checksum, canonical_source_checksum, target_checksum,
        source_record_counts, target_record_counts, imported_version, snapshot_id,
        snapshot_checksum, actor, verified_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, now())
      ON CONFLICT (organization_id) DO UPDATE SET
        source_checksum = EXCLUDED.source_checksum,
        canonical_source_checksum = EXCLUDED.canonical_source_checksum,
        target_checksum = EXCLUDED.target_checksum,
        source_record_counts = EXCLUDED.source_record_counts,
        target_record_counts = EXCLUDED.target_record_counts,
        imported_version = EXCLUDED.imported_version,
        snapshot_id = EXCLUDED.snapshot_id,
        snapshot_checksum = EXCLUDED.snapshot_checksum,
        actor = EXCLUDED.actor,
        verified_at = now()`, [
        this.organizationId,
        sourceChecksum,
        canonicalSourceChecksum,
        targetChecksum,
        JSON.stringify(sourceRecordCounts),
        JSON.stringify(targetRecordCounts),
        importedVersion,
        Number(snapshotRow.id),
        String(snapshotRow.checksum || ''),
        String(proof.actor || '').slice(0, 160)
      ]);
      const saved = await client.query(`SELECT source_checksum, canonical_source_checksum, target_checksum,
        source_record_counts, target_record_counts, imported_version, snapshot_id,
        snapshot_checksum, actor, verified_at
        FROM woa_state_migration_proofs WHERE organization_id = $1`, [this.organizationId]);
      await client.query('COMMIT');
      return migrationProofEvidence(saved.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async recordRecoveryDrill(proof = {}) {
    await this.ensureSchema();
    const runId = String(proof.runId || '').trim().slice(0, 160);
    const result = String(proof.result || 'passed').trim().toLowerCase().slice(0, 32);
    const testDatabaseFingerprint = String(proof.testDatabaseFingerprint || '').trim();
    const configurationFingerprint = String(proof.configurationFingerprint || '').trim();
    const checks = proof.checks && typeof proof.checks === 'object' && !Array.isArray(proof.checks) ? proof.checks : {};
    const scriptVersion = String(proof.scriptVersion || '').trim().slice(0, 160);
    const evidence = recoveryDrillEvidence({
      runId,
      result,
      testDatabaseFingerprint,
      configurationFingerprint,
      checks,
      scriptVersion,
      verifiedAt: new Date().toISOString()
    });
    if (!evidence.ready || !configurationFingerprint) {
      const error = new Error('PostgreSQL recovery drill proof needs a passed run ID, private test-database fingerprint, current configuration fingerprint, script version, and every required drill check.');
      error.code = 'recovery_drill_invalid';
      error.missingChecks = evidence.missingChecks;
      throw error;
    }
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT version FROM woa_state WHERE organization_id = $1 FOR UPDATE', [this.organizationId]);
      if (!current.rowCount) {
        const error = new Error('PostgreSQL state must be imported before a production recovery drill record can be stored.');
        error.code = 'recovery_drill_state_missing';
        throw error;
      }
      await client.query(`INSERT INTO woa_recovery_drills (
        organization_id, run_id, result, test_database_fingerprint,
        configuration_fingerprint, checks, script_version, actor, verified_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())
      ON CONFLICT (organization_id) DO UPDATE SET
        run_id = EXCLUDED.run_id,
        result = EXCLUDED.result,
        test_database_fingerprint = EXCLUDED.test_database_fingerprint,
        configuration_fingerprint = EXCLUDED.configuration_fingerprint,
        checks = EXCLUDED.checks,
        script_version = EXCLUDED.script_version,
        actor = EXCLUDED.actor,
        verified_at = now()`, [
        this.organizationId,
        runId,
        result,
        testDatabaseFingerprint,
        configurationFingerprint,
        JSON.stringify(checks),
        scriptVersion,
        String(proof.actor || '').slice(0, 160)
      ]);
      const saved = await client.query(`SELECT run_id, result, test_database_fingerprint,
        configuration_fingerprint, checks, script_version, actor, verified_at
        FROM woa_recovery_drills WHERE organization_id = $1`, [this.organizationId]);
      await client.query('COMMIT');
      return recoveryDrillEvidence(saved.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async restoreSnapshot(snapshotId, options = {}) {
    const id = Number(snapshotId || 0);
    if (!Number.isInteger(id) || id < 1) {
      const error = new Error('Choose a valid PostgreSQL snapshot to restore.');
      error.code = 'snapshot_not_found';
      throw error;
    }
    await this.ensureSchema();
    const client = await this.connect();
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
      const currentResult = await client.query('SELECT state, version, checksum FROM woa_state WHERE organization_id = $1 FOR UPDATE', [this.organizationId]);
      if (!currentResult.rowCount) {
        const error = new Error('No current PostgreSQL state exists to restore. Complete the controlled JSON import first.');
        error.code = 'state_not_found';
        throw error;
      }
      const snapshot = snapshotResult.rows[0];
      const current = currentResult.rows[0];
      assertChecksum(current.state, current.checksum, 'Current PostgreSQL state before recovery');
      assertChecksum(snapshot.state, snapshot.checksum, 'Recovery snapshot');
      let restored = this.repair(clone(snapshot.state));
      if (typeof options.transform === 'function') {
        const transformed = await options.transform(restored, {
          currentState: this.repair(clone(current.state)),
          currentVersion: Number(current.version || 0),
          currentChecksum: String(current.checksum || ''),
          snapshot: {
            id: Number(snapshot.id),
            version: Number(snapshot.version || 0),
            checksum: String(snapshot.checksum || '')
          }
        });
        if (transformed && typeof transformed === 'object') restored = transformed;
      }
      const next = this.repair(clone(restored));
      const nextVersion = Number(current.version || 0) + 1;
      const nextChecksum = checksum(next);
      await client.query(`UPDATE woa_state
        SET state = $2::jsonb, version = $3, checksum = $4, updated_at = now()
        WHERE organization_id = $1`, [this.organizationId, JSON.stringify(next), nextVersion, nextChecksum]);
      await this.refreshIdentityIndex(client, next);
      await this.syncDocumentMetadata(client, next);
      await this.syncCriticalResourceIndex(client, next);
      await this.syncActiveAssignmentIndex(client, next);
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

  async readiness() {
    try {
      await this.ensureSchema();
      const result = await this.pool.query('SELECT version FROM woa_state WHERE organization_id = $1', [this.organizationId]);
      return {
        backend: 'postgres',
        connected: true,
        stateAvailable: result.rowCount === 1,
        version: result.rowCount === 1 ? Number(result.rows[0].version || 0) : 0
      };
    } catch (error) {
      return { backend: 'postgres', connected: false, stateAvailable: false, error: String(error && error.message || error) };
    }
  }

  async health() {
    try {
      await this.ensureSchema();
      const result = await this.pool.query(`SELECT state.state, state.version, state.checksum, state.updated_at,
        snapshot.id AS snapshot_id, snapshot.version AS snapshot_version, snapshot.checksum AS snapshot_checksum,
        snapshot.state AS snapshot_state, snapshot.created_at AS snapshot_created_at,
        migration.source_checksum AS migration_source_checksum,
        migration.canonical_source_checksum AS migration_canonical_source_checksum,
        migration.target_checksum AS migration_target_checksum,
        migration.source_record_counts AS migration_source_record_counts,
        migration.target_record_counts AS migration_target_record_counts,
        migration.imported_version AS migration_imported_version,
        migration.snapshot_id AS migration_snapshot_id,
        migration.snapshot_checksum AS migration_snapshot_checksum,
        migration.actor AS migration_actor,
        migration.verified_at AS migration_verified_at,
        recovery_drill.run_id AS recovery_drill_run_id,
        recovery_drill.result AS recovery_drill_result,
        recovery_drill.test_database_fingerprint AS recovery_drill_test_database_fingerprint,
        recovery_drill.configuration_fingerprint AS recovery_drill_configuration_fingerprint,
        recovery_drill.checks AS recovery_drill_checks,
        recovery_drill.script_version AS recovery_drill_script_version,
        recovery_drill.actor AS recovery_drill_actor,
        recovery_drill.verified_at AS recovery_drill_verified_at,
        (SELECT COUNT(*)::int FROM woa_state_snapshots WHERE organization_id = $1) AS snapshot_count,
        (SELECT COUNT(*)::int FROM woa_resource_index WHERE organization_id = $1) AS resource_index_count,
        (SELECT COUNT(*)::int FROM woa_active_assignments WHERE organization_id = $1) AS assignment_index_count
        FROM woa_state AS state
        LEFT JOIN LATERAL (
          SELECT id, version, checksum, state, created_at
          FROM woa_state_snapshots
          WHERE organization_id = $1
          ORDER BY version DESC
          LIMIT 1
        ) AS snapshot ON true
        LEFT JOIN woa_state_migration_proofs AS migration ON migration.organization_id = state.organization_id
        LEFT JOIN woa_recovery_drills AS recovery_drill ON recovery_drill.organization_id = state.organization_id
        WHERE state.organization_id = $1`, [this.organizationId]);
      if (!result.rowCount) {
        return {
          backend: 'postgres',
          connected: true,
          transactional: true,
          productionReady: false,
          stateImported: false,
          integrity: 'missing',
          migrationProofIntegrity: 'missing',
          migrationProofReady: false,
          snapshotCount: 0,
          latestSnapshotId: 0,
          latestSnapshotVersion: 0,
          latestSnapshotAt: '',
          snapshotIntegrity: 'missing',
          snapshotChecksumMatchesCurrent: false,
          snapshotVersionMatchesCurrent: false,
          snapshotRecoveryReady: false,
          recoveryDrill: recoveryDrillEvidence(null),
          recoveryDrillReady: false,
          resourceIndexReady: false,
          resourceIndexCount: 0,
          expectedResourceIndexCount: 0,
          assignmentIndexReady: false,
          assignmentIndexCount: 0,
          expectedAssignmentIndexCount: 0,
          version: 0,
          updatedAt: '',
          error: 'PostgreSQL is reachable but WheelsonAuto state has not been imported.'
        };
      }
      const row = result.rows[0];
      const integrity = checksumEvidence(row.state, row.checksum);
      const snapshot = row.snapshot_id === null || row.snapshot_id === undefined ? null : {
        id: row.snapshot_id,
        version: row.snapshot_version,
        checksum: row.snapshot_checksum,
        state: row.snapshot_state,
        createdAt: row.snapshot_created_at
      };
      const recovery = recoverySnapshotEvidence(snapshot, {
        version: row.version,
        checksum: row.checksum,
        snapshotCount: row.snapshot_count
      });
      const migration = row.migration_imported_version === null || row.migration_imported_version === undefined ? null : {
        sourceChecksum: row.migration_source_checksum,
        canonicalSourceChecksum: row.migration_canonical_source_checksum,
        targetChecksum: row.migration_target_checksum,
        sourceRecordCounts: row.migration_source_record_counts,
        targetRecordCounts: row.migration_target_record_counts,
        importedVersion: row.migration_imported_version,
        snapshotId: row.migration_snapshot_id,
        snapshotChecksum: row.migration_snapshot_checksum,
        actor: row.migration_actor,
        verifiedAt: row.migration_verified_at
      };
      const migrationProof = migrationProofEvidence(migration);
      const recoveryDrill = row.recovery_drill_run_id === null || row.recovery_drill_run_id === undefined ? null : {
        runId: row.recovery_drill_run_id,
        result: row.recovery_drill_result,
        testDatabaseFingerprint: row.recovery_drill_test_database_fingerprint,
        configurationFingerprint: row.recovery_drill_configuration_fingerprint,
        checks: row.recovery_drill_checks,
        scriptVersion: row.recovery_drill_script_version,
        actor: row.recovery_drill_actor,
        verifiedAt: row.recovery_drill_verified_at
      };
      const recoveryDrillEvidenceResult = recoveryDrillEvidence(recoveryDrill);
      const checkedState = this.repair(clone(row.state));
      const expectedResourceIndexCount = criticalResourceIndexRows(checkedState).length;
      const expectedAssignmentIndexCount = activeAssignmentIndexRows(checkedState).length;
      const resourceIndexCount = Number(row.resource_index_count || 0);
      const assignmentIndexCount = Number(row.assignment_index_count || 0);
      const resourceIndexReady = resourceIndexCount === expectedResourceIndexCount;
      const assignmentIndexReady = assignmentIndexCount === expectedAssignmentIndexCount;
      return {
        backend: 'postgres',
        connected: true,
        transactional: true,
        productionReady: integrity.matches && resourceIndexReady && assignmentIndexReady,
        stateImported: true,
        integrity: integrity.matches ? 'verified' : 'failed',
        ...recovery,
        ...migrationProof,
        recoveryDrill: recoveryDrillEvidenceResult,
        recoveryDrillReady: recoveryDrillEvidenceResult.ready,
        resourceIndexReady,
        resourceIndexCount,
        expectedResourceIndexCount,
        assignmentIndexReady,
        assignmentIndexCount,
        expectedAssignmentIndexCount,
        version: Number(row.version || 0),
        updatedAt: row.updated_at,
        error: !integrity.matches
          ? 'PostgreSQL state checksum verification failed.'
          : !resourceIndexReady
            ? 'PostgreSQL critical-record index does not match the authoritative state. Refusing production readiness.'
            : !assignmentIndexReady
              ? 'PostgreSQL active-assignment index does not match the authoritative state. Refusing production readiness.'
          : !recovery.snapshotRecoveryReady
            ? recovery.snapshotIntegrity === 'missing'
              ? 'PostgreSQL state is healthy but no current transactional recovery snapshot exists.'
              : recovery.snapshotIntegrity === 'failed'
                ? 'The latest PostgreSQL recovery snapshot checksum verification failed.'
                : 'The latest PostgreSQL recovery snapshot does not match the current state.'
            : !migrationProof.migrationProofReady
              ? migrationProof.migrationProofIntegrity === 'missing'
                ? 'PostgreSQL state is healthy but no verified JSON-to-PostgreSQL import proof exists.'
                : 'The stored JSON-to-PostgreSQL import proof no longer matches its checksum or record-count evidence.'
              : !recoveryDrillEvidenceResult.ready
                ? recoveryDrillEvidenceResult.error
                : ''
      };
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
  TRANSACTIONAL_INDEX_MIGRATION_ID,
  DURABLE_RATE_LIMIT_MIGRATION_ID,
  DOCUMENT_TENANT_PRIMARY_KEY_MIGRATION_ID,
  DEFAULT_ORGANIZATION_ID,
  clone,
  stableJson,
  checksum,
  idempotencyRequestHash,
  checksumEvidence,
  assertChecksum,
  recoverySnapshotEvidence,
  recoveryDrillConfigurationFingerprint,
  recoveryDrillEvidence,
  RECOVERY_DRILL_REQUIRED_CHECKS,
  migrationRecordCounts,
  migrationProofEvidence,
  normalizeBackend,
  advisoryLockKeys,
  identityEntries,
  identityConflicts,
  identityWarnings,
  privateDocumentRows,
  criticalResourceIndexRows,
  sameAssignmentCustomer,
  sameApprovedAssignmentCustomer,
  activeAssignmentCandidate,
  activeAssignmentIndexRows,
  JsonStateRepository,
  PostgresStateRepository,
  createStateRepository
};
