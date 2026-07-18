'use strict';

const fs = require('fs/promises');
const path = require('path');

const SENTINEL_FORMAT = 'wheelsonauto-postgres-cutover';
const SENTINEL_VERSION = 1;
const SENTINEL_FILENAME = '.wheelsonauto-postgres-cutover.json';
const JSON_ROLLBACK_REVIEW_CONFIRMATION = 'REVIEW JSON ROLLBACK IN MAINTENANCE MODE';

function cutoverError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeChecksum(value) {
  const checksum = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(checksum) ? checksum : '';
}

function safeOrganizationId(value) {
  return String(value || 'org-wheelsonauto').trim().slice(0, 160) || 'org-wheelsonauto';
}

function sentinelPath(dataDir) {
  return path.join(path.resolve(dataDir || process.cwd()), SENTINEL_FILENAME);
}

function validateSentinel(value, file = SENTINEL_FILENAME) {
  const sentinel = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const organizationId = String(sentinel.organizationId || '').trim();
  const valid = sentinel.format === SENTINEL_FORMAT
    && Number(sentinel.version) === SENTINEL_VERSION
    && sentinel.backend === 'postgres'
    && !!organizationId
    && organizationId.length <= 160
    && !!safeChecksum(sentinel.sourceStateChecksum)
    && !!safeChecksum(sentinel.canonicalSourceChecksum)
    && !!safeChecksum(sentinel.targetChecksum)
    && Number.isInteger(Number(sentinel.importedVersion))
    && Number(sentinel.importedVersion) > 0
    && Number.isFinite(Date.parse(String(sentinel.createdAt || '')));
  if (!valid) {
    throw cutoverError('The PostgreSQL cutover sentinel at ' + file + ' is invalid. Refusing to choose a data backend until the retained migration evidence is reviewed.', 'woa_cutover_sentinel_invalid');
  }
  const protectedSourceFileChecksum = String(sentinel.protectedSourceFileChecksum || '').trim().toLowerCase();
  if (protectedSourceFileChecksum && !safeChecksum(protectedSourceFileChecksum)) {
    throw cutoverError('The PostgreSQL cutover sentinel contains an invalid protected-source checksum. Refusing to choose a data backend.', 'woa_cutover_sentinel_invalid');
  }
  return {
    format: SENTINEL_FORMAT,
    version: SENTINEL_VERSION,
    backend: 'postgres',
    organizationId,
    protectedSourceFileChecksum,
    sourceStateChecksum: safeChecksum(sentinel.sourceStateChecksum),
    canonicalSourceChecksum: safeChecksum(sentinel.canonicalSourceChecksum),
    targetChecksum: safeChecksum(sentinel.targetChecksum),
    importedVersion: Number(sentinel.importedVersion),
    createdAt: new Date(sentinel.createdAt).toISOString()
  };
}

async function readSentinel(dataDir) {
  const file = sentinelPath(dataDir);
  let bytes;
  try {
    bytes = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    throw cutoverError('The PostgreSQL cutover sentinel at ' + file + ' is unreadable. Refusing to fall back to JSON.', 'woa_cutover_sentinel_invalid');
  }
  return validateSentinel(parsed, file);
}

function sentinelEvidence(health = {}, options = {}) {
  if (!health || health.backend !== 'postgres' || health.connected !== true || health.transactional !== true || health.stateImported !== true) {
    throw cutoverError('PostgreSQL is not connected with imported WheelsonAuto state. Refusing to retire the JSON backend.', 'woa_postgres_cutover_not_ready');
  }
  if (health.productionReady !== true || health.snapshotRecoveryReady !== true || health.migrationProofReady !== true) {
    throw cutoverError('PostgreSQL must pass state integrity, transactional indexes, recovery snapshot, and import-proof checks before the JSON backend is retired.', 'woa_postgres_cutover_not_ready');
  }
  const evidence = {
    format: SENTINEL_FORMAT,
    version: SENTINEL_VERSION,
    backend: 'postgres',
    organizationId: safeOrganizationId(options.organizationId),
    protectedSourceFileChecksum: safeChecksum(options.protectedSourceFileChecksum),
    sourceStateChecksum: safeChecksum(health.sourceChecksum),
    canonicalSourceChecksum: safeChecksum(health.canonicalSourceChecksum),
    targetChecksum: safeChecksum(health.targetChecksum),
    importedVersion: Number(health.importedVersion || 0),
    createdAt: new Date(options.now || Date.now()).toISOString()
  };
  return validateSentinel(evidence);
}

function sameMigration(left, right) {
  return left.organizationId === right.organizationId
    && left.sourceStateChecksum === right.sourceStateChecksum
    && left.canonicalSourceChecksum === right.canonicalSourceChecksum
    && left.targetChecksum === right.targetChecksum
    && left.importedVersion === right.importedVersion
    && (!left.protectedSourceFileChecksum || !right.protectedSourceFileChecksum || left.protectedSourceFileChecksum === right.protectedSourceFileChecksum);
}

async function writePostgresSentinel(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.cwd());
  const file = sentinelPath(dataDir);
  const evidence = sentinelEvidence(options.health, options);
  const existing = await readSentinel(dataDir);
  if (existing) {
    if (!sameMigration(existing, evidence)) {
      throw cutoverError('The retained PostgreSQL cutover sentinel belongs to different migration evidence. Refusing to overwrite it or reopen either backend automatically.', 'woa_cutover_sentinel_conflict');
    }
    return { created: false, file, sentinel: existing };
  }
  await fs.mkdir(dataDir, { recursive: true });
  const body = JSON.stringify(evidence, null, 2) + '\n';
  let handle;
  try {
    handle = await fs.open(file, 'wx', 0o600);
    await handle.writeFile(body, 'utf8');
    await handle.sync();
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      const raced = await readSentinel(dataDir);
      if (raced && sameMigration(raced, evidence)) return { created: false, file, sentinel: raced };
      throw cutoverError('Another process wrote different PostgreSQL cutover evidence. Refusing to continue.', 'woa_cutover_sentinel_conflict');
    }
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
  return { created: true, file, sentinel: evidence };
}

async function assertBackendTransition(options = {}) {
  const backend = String(options.backend || '').trim().toLowerCase();
  const dataDir = path.resolve(options.dataDir || process.cwd());
  if (backend === 'json') {
    const sentinel = await readSentinel(dataDir);
    if (!sentinel) return { backend: 'json', allowed: true, retired: false };
    const maintenanceReview = options.maintenanceMode === true
      && String(options.rollbackReviewConfirmation || '') === JSON_ROLLBACK_REVIEW_CONFIRMATION;
    if (maintenanceReview) {
      return { backend: 'json', allowed: true, retired: true, maintenanceReview: true, sentinel };
    }
    throw cutoverError('WheelsonAuto has already completed a protected PostgreSQL cutover. The retired JSON file cannot become writable again. Use PostgreSQL, or enter maintenance mode with the exact controlled rollback-review confirmation.', 'woa_json_backend_retired');
  }
  if (backend !== 'postgres') {
    throw cutoverError('Unsupported WheelsonAuto data backend "' + backend + '". Use exactly json or postgres; refusing to guess and fall back to a file.', 'woa_data_backend_invalid');
  }
  if (!options.repository || typeof options.repository.health !== 'function') {
    throw cutoverError('PostgreSQL cutover validation requires the transactional repository health check.', 'woa_postgres_cutover_not_ready');
  }
  const health = await options.repository.health();
  const written = await writePostgresSentinel({
    dataDir,
    health,
    organizationId: options.organizationId,
    protectedSourceFileChecksum: options.protectedSourceFileChecksum,
    now: options.now
  });
  return { backend: 'postgres', allowed: true, retired: true, health, ...written };
}

module.exports = {
  SENTINEL_FORMAT,
  SENTINEL_VERSION,
  SENTINEL_FILENAME,
  JSON_ROLLBACK_REVIEW_CONFIRMATION,
  sentinelPath,
  validateSentinel,
  readSentinel,
  sentinelEvidence,
  writePostgresSentinel,
  assertBackendTransition
};
